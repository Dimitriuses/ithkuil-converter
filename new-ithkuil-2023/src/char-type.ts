/**
 * Character-type detection for the composed-word orchestrator.
 *
 * A segmented character must be routed to the right decoder (secondary consonant,
 * quaternary, tertiary, or primary). We classify its base against one combined,
 * type-tagged template set spanning all four character types and read the type
 * from the winning template. The four types have very different base silhouettes
 * (angular consonant vs vertical bar vs horizontal bar vs diagonal blade), so a
 * single Chamfer match separates them cleanly.
 */
import "./dom-shim.js" // must precede @zsnout import
import {
  ILLOCUTION_TO_SECONDARY_EXTENSION,
  Quaternary,
  Secondary,
  Tertiary,
  VALENCE,
} from "@zsnout/ithkuil/script"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"
import { buildBaseTemplates, maskOfBox } from "./decompose.js"
import { classifyMask, type Template } from "./classify.js"
import { CONSONANTS } from "./glyph-classes.js"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment, type Bitmap, type SegmentedRegion } from "./segment.js"
import { loadCache, saveCache, serTemplate, deserTemplate, type SerTemplate } from "./template-cache.js"

export type CharType = "secondary" | "quaternary" | "tertiary" | "primary"

// Primary type templates are built from COMPOSED formatives (render a formative,
// segment, take the leftmost = primary character) rather than isolated Primary()
// renders — a primary embedded in a word (esp. the thin CTE blade) differs enough
// from its isolated render to mis-type. The other types match their isolated forms.
//
// The primary's silhouette varies with its Ca (perspective + configuration): the
// thin CTE blade under perspective A or a multiplex configuration otherwise mis-types
// as a secondary/tertiary/quaternary. So we cover a spec × perspective × configuration
// grid — enough shape variety that any primary matches a primary template first.
const PRIMARY_SPECS = ["BSC", "CTE", "CSV", "OBJ"]
const PRIMARY_PERSPECTIVES = ["M", "G", "N", "A"]
// One representative from each configuration family — uniplex, multiplex (MSS/MSC),
// and duplex (DPX) — since the families have distinct primary silhouettes.
const PRIMARY_CONFIGURATIONS = ["UPX", "MSS", "MSC", "DPX"]

function composedPrimaryTemplates(): Template[] {
  const templates: Template[] = []
  for (const spec of PRIMARY_SPECS) {
    for (const perspective of PRIMARY_PERSPECTIVES) {
      for (const configuration of PRIMARY_CONFIGURATIONS) {
        const text = formativeToIthkuil({
          root: "l",
          type: "UNF/C",
          specification: spec as never,
          ca: { perspective: perspective as never, configuration: configuration as never },
        })
        const r = encode(text, { margin: 10 })
        if (!r.ok) throw new Error(`encode failed for ${spec}/${perspective}/${configuration}: ${r.reason}`)
        const img = decodePng(svgToPng(r.svg, { width: 700 }))
        const bmp = binarize(img.data, img.width, img.height)
        const primary = segment(bmp)[0] // leftmost character is the primary
        // Label with spec only — type detection just needs "primary"; the spec is
        // re-read by the primary decoder. (Multiple templates share a spec label.)
        templates.push({ label: spec, class: `primary-${spec}`, mask: maskOfBox(bmp, primary.base, 64) })
      }
    }
  }
  return templates
}

// One combined, type-tagged template set. Type is read from the class prefix.
function buildTypedTemplates(): Template[] {
  return [
    ...buildBaseTemplates(
      CONSONANTS.map((c) => ({ label: c, class: `secondary-${c}`, el: () => Secondary({ core: c }) })),
    ),
    ...buildBaseTemplates([
      { label: "∅", class: "quaternary-none", el: () => Quaternary({}) },
      ...Object.keys(ILLOCUTION_TO_SECONDARY_EXTENSION).map((v) => ({
        label: v,
        class: `quaternary-${v}`,
        el: () => Quaternary({ value: v as never }),
      })),
    ]),
    ...buildBaseTemplates(
      Object.keys(VALENCE).map((v) => ({
        label: v,
        class: `tertiary-${v}`,
        el: () => Tertiary({ valence: v as never }),
      })),
    ),
    ...composedPrimaryTemplates(),
  ]
}

// Built lazily and cached to disk: the set is ~64 composed-formative renders plus the
// per-type base renders — ~44 s, which used to be paid at module load on EVERY process
// start (server and every test run). Bump CACHE_VERSION if the renders or value sets change.
const CACHE_NAME = "char-type"
const CACHE_VERSION = 1
let typedTemplates: Template[] | null = null

function ensureTemplates(): Template[] {
  if (typedTemplates) return typedTemplates
  const cached = loadCache<SerTemplate[]>(CACHE_NAME, CACHE_VERSION)
  if (cached) {
    typedTemplates = cached.map(deserTemplate)
    return typedTemplates
  }
  typedTemplates = buildTypedTemplates()
  saveCache(CACHE_NAME, CACHE_VERSION, typedTemplates.map(serTemplate))
  return typedTemplates
}

/** Build/load the type templates now (call at warmup so the first decode doesn't pay it). */
export function warmCharType(): void {
  ensureTemplates()
}

export interface CharTypeResult {
  type: CharType
  /** Best-matching template's label (informational; use the type-specific decoder for the value). */
  label: string
  score: number
}

/** Detect a segmented character's type from its base shape. */
export function classifyCharType(bmp: Bitmap, region: SegmentedRegion, size = 64): CharTypeResult {
  const best = classifyMask(maskOfBox(bmp, region.base, size), ensureTemplates())
  return { type: best.class.split("-")[0] as CharType, label: best.label, score: best.score }
}

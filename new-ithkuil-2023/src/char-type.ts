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

export type CharType = "secondary" | "quaternary" | "tertiary" | "primary"

// Primary type templates are built from COMPOSED formatives (render a formative,
// segment, take the leftmost = primary character) rather than isolated Primary()
// renders — a primary embedded in a word (esp. the thin CTE blade) differs enough
// from its isolated render to mis-type. The other types match their isolated forms.
function composedPrimaryTemplates(): Template[] {
  return ["BSC", "CTE", "CSV", "OBJ"].map((spec) => {
    const text = formativeToIthkuil({ root: "l", type: "UNF/C", specification: spec as never })
    const r = encode(text, { margin: 10 })
    if (!r.ok) throw new Error(`encode failed for ${spec}: ${r.reason}`)
    const img = decodePng(svgToPng(r.svg, { width: 700 }))
    const bmp = binarize(img.data, img.width, img.height)
    const primary = segment(bmp)[0] // leftmost character is the primary
    return { label: spec, class: `primary-${spec}`, mask: maskOfBox(bmp, primary.base, 64) }
  })
}

// One combined, type-tagged template set. Type is read from the class prefix.
const TYPED_TEMPLATES: Template[] = [
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

export interface CharTypeResult {
  type: CharType
  /** Best-matching template's label (informational; use the type-specific decoder for the value). */
  label: string
  score: number
}

/** Detect a segmented character's type from its base shape. */
export function classifyCharType(bmp: Bitmap, region: SegmentedRegion, size = 64): CharTypeResult {
  const best = classifyMask(maskOfBox(bmp, region.base, size), TYPED_TEMPLATES)
  return { type: best.class.split("-")[0] as CharType, label: best.label, score: best.score }
}

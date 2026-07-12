/**
 * Full secondary-character decoding: core consonant + top/bottom cluster
 * extensions + vowel diacritics.
 *
 * - Core + extension: the extension is connected to the core and perturbs the base
 *   shape, so decoding the core against bare-core templates fails when an extension
 *   is present. Instead we decode them JOINTLY — match the base against rendered
 *   `Secondary({ core, top|bottom: X })` references over *all* cores at once, so the
 *   correct core+extension template wins together. (Templates are rendered lazily
 *   once and cached; a single extension per character — the common case.)
 * - Vowels: the superposed/underposed diacritics are separable components; classify
 *   each and map its shape → vowel via the shared vowel map.
 */
import "./dom-shim.js" // must precede @zsnout import
import { Secondary } from "@zsnout/ithkuil/script"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, type Bitmap, type SegmentedRegion } from "./segment.js"
import { renderGlyphToSvg } from "./glyph-render.js"
import { maskFromBitmap, type Mask } from "./normalize.js"
import { maskOfBox } from "./decompose.js"
import { classifyMask, type Template } from "./classify.js"
import { buildVowelMap } from "./decode.js"
import { CONSONANTS } from "./glyph-classes.js"
import { cropRgba, type RgbaImage } from "./image-io.js"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"

const SIZE = 64
const vowelMap = buildVowelMap()

/**
 * Cluster extensions to consider — the **full consonant inventory**. A biconsonantal
 * root's second consonant is rendered as a *bottom* extension and can be any consonant,
 * so we build a template for every one (was a 5-consonant subset → out-of-set extensions
 * decoded at 0%). Only bottom extensions are built: top-only extensions don't occur in
 * real formatives (a triconsonantal root uses top AND bottom together, which these
 * single-extension templates don't model), so top templates were dead weight.
 */
export const EXTENSION_SET: readonly string[] = CONSONANTS

function renderSecondaryMask(spec: Parameters<typeof Secondary>[0]): Mask {
  const img = decodePng(svgToPng(renderGlyphToSvg(Secondary(spec), {}, { canvas: 128 }), { width: 128 }))
  return maskFromBitmap(binarize(img.data, img.width, img.height), SIZE)
}

/** Extra similarity an extension template must beat the best bare core by to be
 * accepted (prevents spurious extensions on plain cores, which sit between bare and
 * bare+extension templates). */
const EXTENSION_MARGIN = 0.04

function mkTemplate(core: string, top: string | null, bottom: string | null): Template {
  return {
    label: JSON.stringify([core, top, bottom]),
    class: "secondary",
    mask: renderSecondaryMask({
      core: core as never,
      ...(top ? { top: top as never } : {}),
      ...(bottom ? { bottom: bottom as never } : {}),
    }),
  }
}

// Bare-core vs with-extension templates, scored separately so a margin can favour
// the simpler (bare) reading. Built once, lazily.
//
// With the full extension set there are 28 bare + 28×28 core+bottom = 812 templates,
// each a ~260 ms resvg render (~3.5 min). So they're cached to disk (masks only) and
// loaded fast thereafter — mirrors the alphabetic base-template cache. Bump
// CACHE_VERSION when the render or the core/extension sets change.
let bareTemplates: Template[] | null = null
let extTemplates: Template[] | null = null

const CACHE_VERSION = 1
const CACHE_PATH = fileURLToPath(new URL("../models/secondary-ext.json", import.meta.url))

function loadCache(): { bare: Template[]; ext: Template[] } | null {
  try {
    const j = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as {
      version: number
      size: number
      bare: { l: string; m: string }[]
      ext: { l: string; m: string }[]
    }
    if (j.version !== CACHE_VERSION || j.size !== SIZE) return null
    const mk = (t: { l: string; m: string }): Template => ({
      label: t.l,
      class: "secondary",
      mask: { size: SIZE, data: new Uint8Array(Buffer.from(t.m, "base64")) },
    })
    return { bare: j.bare.map(mk), ext: j.ext.map(mk) }
  } catch {
    return null
  }
}

function saveCache(bare: Template[], ext: Template[]): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true })
    const ser = (t: Template) => ({ l: t.label, m: Buffer.from(t.mask.data).toString("base64") })
    writeFileSync(
      CACHE_PATH,
      JSON.stringify({ version: CACHE_VERSION, size: SIZE, bare: bare.map(ser), ext: ext.map(ser) }),
    )
  } catch {
    /* best-effort cache */
  }
}

function ensureTemplates(): void {
  if (bareTemplates) return
  const cached = loadCache()
  if (cached) {
    bareTemplates = cached.bare
    extTemplates = cached.ext
    return
  }
  bareTemplates = CONSONANTS.map((c) => mkTemplate(c, null, null))
  const ext: Template[] = []
  for (const core of CONSONANTS) {
    for (const x of EXTENSION_SET) {
      ext.push(mkTemplate(core, null, x)) // bottom extension (the real cluster case)
    }
  }
  extTemplates = ext
  saveCache(bareTemplates, extTemplates)
}

/** Build/load the secondary template set now (call at server warmup so the first
 * decode doesn't pay the one-time cache build). */
export function warmSecondary(): void {
  ensureTemplates()
}

export interface SecondaryDecode {
  core: string
  topExtension: string | null
  bottomExtension: string | null
  superposedVowel: string | null
  underposedVowel: string | null
  /** Raw classified diacritic SHAPE labels (e.g. "HORIZ_BAR"), before the vowel map.
   * The case (Vc) reader keys on these — the vowel map is calibrated for a different
   * (phonological) reading and mislabels the case diacritics. */
  superposedShape: string | null
  underposedShape: string | null
}

/**
 * Optional learned core classifier (the M9 CNN). Structural type so this module
 * stays tfjs-free; `loadCnnClassifier()` satisfies it. It consumes a *grayscale*
 * RGBA crop — the CNN trained on grayscale, so feeding it the binary mask loses
 * its noise-robustness advantage.
 */
export interface CoreClassifier {
  classifyImage(img: RgbaImage): { label: string }
}

/** Decode a segmented secondary character into consonant(s) + vowels. */
export function decodeSecondary(
  bmp: Bitmap,
  region: SegmentedRegion,
  diacriticTemplates: Template[],
  cnn?: CoreClassifier,
  /** Grayscale source image (same dimensions as `bmp`); required to use the CNN. */
  grayImage?: RgbaImage,
): SecondaryDecode {
  ensureTemplates()
  const baseMask = maskOfBox(bmp, region.base, SIZE)
  const bare = classifyMask(baseMask, bareTemplates!)
  const ext = classifyMask(baseMask, extTemplates!)
  // Accept an extension only if it clearly beats the best bare core.
  const chosen = ext.score > bare.score + EXTENSION_MARGIN ? ext : bare
  let [core] = JSON.parse(chosen.label) as [string, string | null, string | null]
  const [, topExtension, bottomExtension] = JSON.parse(chosen.label) as [
    string,
    string | null,
    string | null,
  ]

  // The CNN was trained on BARE grayscale cores, so use it to refine the core only
  // when no extension is present (its input domain); template handles extended clusters.
  if (cnn && grayImage && !topExtension && !bottomExtension) {
    core = cnn.classifyImage(cropRgba(grayImage, region.base)).label
  }

  let superposedVowel: string | null = null
  let underposedVowel: string | null = null
  let superposedShape: string | null = null
  let underposedShape: string | null = null
  for (const c of region.components) {
    if (c.role !== "superposed" && c.role !== "underposed") continue
    const d = classifyMask(maskOfBox(bmp, c.bbox, SIZE), diacriticTemplates)
    const vowel = vowelMap[d.label] ?? null
    if (c.role === "superposed") {
      superposedVowel = vowel
      superposedShape = d.label
    } else {
      underposedVowel = vowel
      underposedShape = d.label
    }
  }

  return {
    core,
    topExtension,
    bottomExtension,
    superposedVowel,
    underposedVowel,
    superposedShape,
    underposedShape,
  }
}

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
import { binarize, segment, type Bitmap, type BBox, type SegmentedRegion } from "./segment.js"
import { renderGlyphToSvg } from "./glyph-render.js"
import { type Mask } from "./normalize.js"
import { maskOfBox } from "./decompose.js"
import { classifyMask, type Template } from "./classify.js"
import { chamferSimilarity } from "./chamfer.js"
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

/** Fraction of the base height (from the top) excluded when reading core+bottom, so a
 * 3-consonant cluster's TOP extension doesn't corrupt the core+bottom match (with the
 * top included, core+bottom collapses 97%→24%; excluding it restores 93%, and it's a
 * pure win for bare/2-consonant too: 100%). */
const CORE_BOTTOM_TOP_EXCL = 0.35

function baseBoxOf(bmp: Bitmap): BBox {
  return segment(bmp)
    .map((r) => r.base)
    .reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b))
}
/** Lower portion of a base box (top excluded) — the core+bottom region. */
function lowerBox(base: BBox): BBox {
  const off = Math.round(base.h * CORE_BOTTOM_TOP_EXCL)
  return { x: base.x, y: base.y + off, w: base.w, h: base.h - off }
}

function renderSecondaryMask(spec: Parameters<typeof Secondary>[0]): Mask {
  const img = decodePng(svgToPng(renderGlyphToSvg(Secondary(spec), {}, { canvas: 128 }), { width: 128 }))
  const bmp = binarize(img.data, img.width, img.height)
  return maskOfBox(bmp, lowerBox(baseBoxOf(bmp)), SIZE) // core+bottom only (top excluded)
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

// ── Top-extension (3-consonant cluster) reading ────────────────────────────────
// A triconsonantal root C1-C2-C3 renders as top:C1 + core:C2 + bottom:C3 in ONE base
// (a full joint set would be 28³). So we read core+bottom with the joint templates
// above, then read the TOP separately. The top extension can't be read from the top
// zone alone — the core's own top interferes (37%) — so top templates are CONDITIONED
// on the (already-decoded) core: given the core, match the top zone against that core's
// {none, top:X} references. A margin keeps 2-consonant/bare bases from gaining a
// spurious top (0% spurious at TOP_MARGIN=0.09, while real tops read at ~81%).
const TOP_FRAC = 0.42
const TOP_MARGIN = 0.14

function topZoneBox(base: BBox): BBox {
  return { x: base.x, y: base.y, w: base.w, h: Math.round(base.h * TOP_FRAC) }
}
function renderTopZone(spec: Parameters<typeof Secondary>[0]): Mask {
  const img = decodePng(svgToPng(renderGlyphToSvg(Secondary(spec), {}, { canvas: 128 }), { width: 128 }))
  const bmp = binarize(img.data, img.width, img.height)
  return maskOfBox(bmp, topZoneBox(baseBoxOf(bmp)), SIZE)
}
interface TopSet {
  none: Mask
  tops: Template[]
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
let topByCore: Map<string, TopSet> | null = null

const CACHE_VERSION = 3 // bumped: core+bottom templates are now lower-portion (top-excluded)
const CACHE_PATH = fileURLToPath(new URL("../models/secondary-ext.json", import.meta.url))

interface CacheShape {
  version: number
  size: number
  bare: { l: string; m: string }[]
  ext: { l: string; m: string }[]
  /** Core-conditioned top-zone templates. `x` = "" is that core's "none" reference. */
  top: { c: string; x: string; m: string }[]
}

function loadCache(): { bare: Template[]; ext: Template[]; top: Map<string, TopSet> } | null {
  try {
    const j = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheShape
    if (j.version !== CACHE_VERSION || j.size !== SIZE) return null
    const mask = (m: string): Mask => ({ size: SIZE, data: new Uint8Array(Buffer.from(m, "base64")) })
    const mk = (t: { l: string; m: string }): Template => ({ label: t.l, class: "secondary", mask: mask(t.m) })
    const top = new Map<string, TopSet>()
    for (const t of j.top) {
      const set = top.get(t.c) ?? { none: mask(""), tops: [] }
      if (t.x === "") set.none = mask(t.m)
      else set.tops.push({ label: t.x, class: "top", mask: mask(t.m) })
      top.set(t.c, set)
    }
    return { bare: j.bare.map(mk), ext: j.ext.map(mk), top }
  } catch {
    return null
  }
}

function saveCache(bare: Template[], ext: Template[], top: Map<string, TopSet>): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true })
    const b64 = (m: Mask) => Buffer.from(m.data).toString("base64")
    const ser = (t: Template) => ({ l: t.label, m: b64(t.mask) })
    const topList: { c: string; x: string; m: string }[] = []
    for (const [c, set] of top) {
      topList.push({ c, x: "", m: b64(set.none) })
      for (const t of set.tops) topList.push({ c, x: t.label, m: b64(t.mask) })
    }
    const j: CacheShape = { version: CACHE_VERSION, size: SIZE, bare: bare.map(ser), ext: ext.map(ser), top: topList }
    writeFileSync(CACHE_PATH, JSON.stringify(j))
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
    topByCore = cached.top
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
  // Core-conditioned top templates for 3-consonant clusters.
  const top = new Map<string, TopSet>()
  for (const core of CONSONANTS) {
    const none = renderTopZone({ core: core as never })
    const tops = CONSONANTS.map((x) => ({
      label: x,
      class: "top",
      mask: renderTopZone({ core: core as never, top: x as never }),
    }))
    top.set(core, { none, tops })
  }
  topByCore = top
  saveCache(bareTemplates, extTemplates, top)
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
  // Read core+bottom from the lower portion (top excluded) so a 3-consonant cluster's
  // top extension doesn't corrupt the match; templates are built the same way.
  const baseMask = maskOfBox(bmp, lowerBox(region.base), SIZE)
  const bare = classifyMask(baseMask, bareTemplates!)
  const ext = classifyMask(baseMask, extTemplates!)
  // Accept an extension only if it clearly beats the best bare core.
  const chosen = ext.score > bare.score + EXTENSION_MARGIN ? ext : bare
  let [core] = JSON.parse(chosen.label) as [string, string | null, string | null]
  const [, , bottomExtension] = JSON.parse(chosen.label) as [string, string | null, string | null]

  // The CNN was trained on BARE grayscale cores, so use it to refine the core only
  // when no extension is present (its input domain); template handles extended clusters.
  if (cnn && grayImage && !bottomExtension) {
    core = cnn.classifyImage(cropRgba(grayImage, region.base)).label
  }

  // Top extension (3-consonant cluster: top C1 + core C2 + bottom C3): read the top
  // zone conditioned on the decoded core, gated by a margin so 2-consonant/bare bases
  // don't gain a spurious top (0% spurious at TOP_MARGIN; real tops read ~81%).
  let topExtension: string | null = null
  const topSet = topByCore?.get(core)
  if (topSet) {
    const topMask = maskOfBox(bmp, topZoneBox(region.base), SIZE)
    const best = classifyMask(topMask, topSet.tops)
    if (best.score > chamferSimilarity(topMask, topSet.none) + TOP_MARGIN) {
      topExtension = best.label
    }
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

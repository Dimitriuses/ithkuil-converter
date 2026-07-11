/**
 * Alphabetic-register decoding.
 *
 * When @zsnout can't parse a word as a formative in sentence position, it renders
 * the word PHONETICALLY in "alphabetic mode": each syllable becomes a Secondary
 * with an `ALPHABETIC_PLACEHOLDER` core whose letters are packed into slots —
 * `top`/`bottom` consonant extensions (merged into the base component) and
 * `superposed`/`underposed`/`left`/`right` vowel/tone diacritics (separable marks).
 * The span is bracketed by `Register{mode:"alphabetic"}` glyphs (the "colon" marks).
 *
 * This module inverts that packing:
 *   1. detect Register glyphs → the alphabetic span boundaries;
 *   2. group span regions into characters, re-associating `right`/`left` side
 *      diacritics (which the segmenter splits off) with their base;
 *   3. read each character's slots — consonants from base zones (top/mid/bottom),
 *      vowels from the separable diacritic components;
 *   4. reassemble in reading order: top, superposed, core, right, bottom, underposed.
 *
 * Consonant slots use a "none" template + margin so a bare placeholder spine isn't
 * mistaken for a consonant. See the reading-order derivation in the round-trip test.
 */
import "./dom-shim.js" // must precede @zsnout import
import { Secondary, Register } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment, type Bitmap, type BBox, type SegmentedRegion } from "./segment.js"
import { maskOfBox } from "./decompose.js"
import { classifyMask, type Template } from "./classify.js"
import { chamferSimilarity } from "./chamfer.js"
import type { Mask } from "./normalize.js"

/** Consonants that can appear in top/bottom/core slots (the secondary core set). */
const CONSONANTS = "pbtdkgfvţḑszšžçxhļcżčjmnňrlř".split("")
/** Vowels that can appear in diacritic slots. */
const VOWELS = ["a", "ä", "e", "ë", "i", "o", "ö", "u", "ü"]

const SIZE = 48
/** Vertical zone fractions for reading top/bottom extensions and the core spine.
 * Tight strips isolate the distinguishing extension from the shared placeholder
 * spine (a wider strip lets the common spine dominate the Chamfer score). */
const TOP_FRAC = 0.4
const BOTTOM_FRAC = 0.4
const MID_FRAC = 0.5
/** A consonant slot must beat the bare-placeholder "none" template by this margin.
 * Core is the noisiest zone (the placeholder spine resembles a consonant), so it
 * uses a larger margin. */
const EXT_MARGIN = 0.06
const CORE_MARGIN = 0.15
/** Chamfer score above which a region's base is a Register glyph. */
const REGISTER_THRESHOLD = 0.72
/** A span region shorter than this fraction of the tallest is a side diacritic. */
const SIDE_HEIGHT_FRAC = 0.55

function renderPlaceholder(spec: Record<string, string>): Bitmap {
  const img = decodePng(
    svgToPng(
      renderGlyphToSvg(Secondary({ core: "ALPHABETIC_PLACEHOLDER", ...spec } as never), {}, { canvas: 128 }),
      { width: 256 },
    ),
  )
  return binarize(img.data, img.width, img.height)
}

function renderCoreConsonant(core: string): Bitmap {
  const img = decodePng(
    svgToPng(renderGlyphToSvg(Secondary({ core: core as never }), {}, { canvas: 128 }), { width: 256 }),
  )
  return binarize(img.data, img.width, img.height)
}

/** Largest base box in a rendered reference (the main glyph, excluding side marks). */
function baseBoxOf(bmp: Bitmap): BBox {
  return segment(bmp)
    .map((r) => r.base)
    .reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b))
}

/** A vertical zone of a base box: the top strip, bottom strip, or middle band. */
function zoneBox(box: BBox, which: "top" | "bottom" | "mid", frac: number): BBox {
  const hh = Math.round(box.h * frac)
  if (which === "top") return { x: box.x, y: box.y, w: box.w, h: hh }
  if (which === "bottom") return { x: box.x, y: box.y + box.h - hh, w: box.w, h: hh }
  return { x: box.x, y: box.y + Math.round(box.h * (0.5 - frac / 2)), w: box.w, h: hh }
}

// ---- Lazily-built reference templates (rendered once). ------------------------

interface AlphaTemplates {
  top: Template[]
  bottom: Template[]
  core: Template[]
  superposed: Template[]
  underposed: Template[]
  side: Template[]
  register: Mask
}

let cache: AlphaTemplates | null = null

/** Reference of a single vowel diacritic in a given position (the separable mark). */
function vowelTemplates(position: string): Template[] {
  return VOWELS.map((v) => {
    const bmp = renderPlaceholder({ [position]: v })
    const base = baseBoxOf(bmp)
    let comp: BBox = base
    for (const r of segment(bmp)) {
      if ((r.base.x !== base.x || r.base.y !== base.y) && r.base.w * r.base.h < base.w * base.h) comp = r.base
      for (const c of r.components) {
        if (c.role !== "base" && (c.bbox.x !== base.x || c.bbox.y !== base.y)) comp = c.bbox
      }
    }
    return { label: v, class: position, mask: maskOfBox(bmp, comp, SIZE) }
  })
}

function ensureTemplates(): AlphaTemplates {
  if (cache) return cache
  const none = renderPlaceholder({})
  const noneBox = baseBoxOf(none)
  const noneTop: Template = { label: "", class: "none", mask: maskOfBox(none, zoneBox(noneBox, "top", TOP_FRAC), SIZE) }
  const noneBot: Template = {
    label: "",
    class: "none",
    mask: maskOfBox(none, zoneBox(noneBox, "bottom", BOTTOM_FRAC), SIZE),
  }
  const noneMid: Template = { label: "", class: "none", mask: maskOfBox(none, zoneBox(noneBox, "mid", MID_FRAC), SIZE) }

  const top = [
    noneTop,
    ...CONSONANTS.map((c) => {
      const b = renderPlaceholder({ top: c })
      return { label: c, class: "c", mask: maskOfBox(b, zoneBox(baseBoxOf(b), "top", TOP_FRAC), SIZE) }
    }),
  ]
  const bottom = [
    noneBot,
    ...CONSONANTS.map((c) => {
      const b = renderPlaceholder({ bottom: c })
      return { label: c, class: "c", mask: maskOfBox(b, zoneBox(baseBoxOf(b), "bottom", BOTTOM_FRAC), SIZE) }
    }),
  ]
  const core = [
    noneMid,
    ...CONSONANTS.map((c) => {
      const b = renderCoreConsonant(c)
      return { label: c, class: "c", mask: maskOfBox(b, zoneBox(baseBoxOf(b), "mid", MID_FRAC), SIZE) }
    }),
  ]

  const regImg = decodePng(
    svgToPng(renderGlyphToSvg(Register({ mode: "alphabetic" }), {}, { canvas: 128 }), { width: 256 }),
  )
  const regBmp = binarize(regImg.data, regImg.width, regImg.height)

  cache = {
    top,
    bottom,
    core,
    superposed: vowelTemplates("superposed"),
    underposed: vowelTemplates("underposed"),
    side: vowelTemplates("right"),
    register: maskOfBox(regBmp, baseBoxOf(regBmp), SIZE),
  }
  return cache
}

/** Pick a consonant for a zone, or "" if the bare "none" template wins (by margin). */
function pickConsonant(mask: Mask, templates: Template[], margin: number): string {
  const best = classifyMask(mask, templates)
  if (best.label === "") return ""
  const none = templates.find((t) => t.label === "")!
  return best.score > chamferSimilarity(mask, none.mask) + margin ? best.label : ""
}

/** True if a region's base is a Register (word-boundary) glyph. */
export function isRegister(bmp: Bitmap, region: SegmentedRegion): boolean {
  const t = ensureTemplates()
  return chamferSimilarity(maskOfBox(bmp, region.base, SIZE), t.register) > REGISTER_THRESHOLD
}

interface AlphaChar {
  base: BBox
  vowels: { role: "superposed" | "underposed" | "right"; box: BBox }[]
}

/** Group span regions into characters, folding side diacritics into their base. */
function groupChars(span: SegmentedRegion[]): AlphaChar[] {
  const maxH = Math.max(1, ...span.map((s) => s.base.h))
  const chars: AlphaChar[] = []
  for (const rg of span) {
    if (rg.base.h < maxH * SIDE_HEIGHT_FRAC) {
      // A short separate region is a side (right) diacritic of the previous char.
      if (chars.length) chars[chars.length - 1].vowels.push({ role: "right", box: rg.base })
      continue
    }
    const vowels = rg.components
      .filter((c) => c.role !== "base")
      .map((c) => ({
        role: (c.role === "unknown" || c.role === "right" ? "right" : c.role) as
          | "superposed"
          | "underposed"
          | "right",
        box: c.bbox,
      }))
    chars.push({ base: rg.base, vowels })
  }
  return chars
}

/** Decode one alphabetic character to its romanized letters, in reading order. */
function decodeChar(bmp: Bitmap, ch: AlphaChar, t: AlphaTemplates): string {
  const top = pickConsonant(maskOfBox(bmp, zoneBox(ch.base, "top", TOP_FRAC), SIZE), t.top, EXT_MARGIN)
  const bottom = pickConsonant(maskOfBox(bmp, zoneBox(ch.base, "bottom", BOTTOM_FRAC), SIZE), t.bottom, EXT_MARGIN)
  const core = pickConsonant(maskOfBox(bmp, zoneBox(ch.base, "mid", MID_FRAC), SIZE), t.core, CORE_MARGIN)
  let superposed = ""
  let underposed = ""
  let right = ""
  for (const v of ch.vowels) {
    const m = maskOfBox(bmp, v.box, SIZE)
    if (v.role === "superposed") superposed = classifyMask(m, t.superposed).label
    else if (v.role === "underposed") underposed = classifyMask(m, t.underposed).label
    else right = classifyMask(m, t.side).label
  }
  // Reading order within a character.
  return top + superposed + core + right + bottom + underposed
}

/**
 * Decode an alphabetic span (the regions strictly between the opening and closing
 * Register glyphs) into a romanized word.
 */
export function decodeAlphabeticSpan(bmp: Bitmap, span: SegmentedRegion[]): string {
  const t = ensureTemplates()
  return groupChars(span)
    .map((ch) => decodeChar(bmp, ch, t))
    .join("")
}

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
 *   3. read each character's consonants by matching the whole framed base against
 *      joint {core, top, bottom} references — one match, not three per-zone reads.
 *      The extensions perturb each other's zones and per-zone bbox-normalization
 *      discards where each mark sits, so a joint whole-base match is far more
 *      accurate (it fixed the top s/r and bottom n/r/b confusions). Vowels are read
 *      from the separable diacritic components;
 *   4. reassemble in reading order: top, superposed, core, right, bottom, underposed.
 *
 * See the reading-order derivation in the round-trip test.
 */
import "./dom-shim.js" // must precede @zsnout import
import { Secondary, Register } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment, type Bitmap, type BBox, type SegmentedRegion } from "./segment.js"
import { maskOfBox } from "./decompose.js"
import { classifyMask, type Template } from "./classify.js"
import { chamferSimilarity, distanceTransform, meanNearestDistance } from "./chamfer.js"
import { cropInk, type Mask } from "./normalize.js"
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"

/** Consonants that can appear in top/bottom/core slots (the secondary core set). */
const CONSONANTS = "pbtdkgfvţḑszšžçxhļcżčjmnňrlř".split("")
/** Vowels that can appear in diacritic slots. */
const VOWELS = ["a", "ä", "e", "ë", "i", "o", "ö", "u", "ü"]

const SIZE = 48 // vowel-diacritic + register masks
/** Square frame the whole base is stretched into for joint matching. Stretching (not
 * bbox-padding) keeps each extension at a consistent position for query and template. */
const FRAME = 56
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

/** Stretch a base box's ink to a FRAME×FRAME square mask (nearest-neighbour, no
 * padding) so the same (core,top,bottom) always frames identically. */
function frameSquare(bmp: Bitmap, box: BBox): Mask {
  const { ink, width, height } = cropInk(bmp, box)
  let minx = width, maxx = -1, miny = height, maxy = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ink[y * width + x]) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
      }
    }
  }
  const data = new Uint8Array(FRAME * FRAME)
  if (maxx < 0) return { size: FRAME, data }
  const w = maxx - minx + 1
  const h = maxy - miny + 1
  for (let ty = 0; ty < FRAME; ty++) {
    const sy = miny + Math.floor((ty * h) / FRAME)
    for (let tx = 0; tx < FRAME; tx++) {
      const sx = minx + Math.floor((tx * w) / FRAME)
      if (ink[sy * width + sx]) data[ty * FRAME + tx] = 1
    }
  }
  return { size: FRAME, data }
}

// ---- Lazily-built reference templates (rendered once). ------------------------

/** A whole-base reference: a (core, top, bottom) letter combination + its framed
 * mask and precomputed distance transform (so matching one query against all of
 * them doesn't recompute each template's transform). "" = slot empty. */
interface BaseTemplate {
  core: string
  top: string
  bottom: string
  mask: Mask
  dt: Float32Array
}

interface AlphaTemplates {
  base: BaseTemplate[]
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

function baseTemplate(core: string, top: string, bottom: string, bmp: Bitmap): BaseTemplate {
  const mask = frameSquare(bmp, baseBoxOf(bmp))
  return { core, top, bottom, mask, dt: distanceTransform(mask) }
}

// Rendering each reference costs ~260ms (resvg), and there are ~1200 of them, so the
// set is built once and cached to disk (masks only; the distance transform is cheap
// to recompute on load). Bump CACHE_VERSION when the render or consonant set changes.
const CACHE_VERSION = 1
const CACHE_PATH = fileURLToPath(new URL("../models/alphabetic-base.json", import.meta.url))

function loadBaseCache(): BaseTemplate[] | null {
  try {
    const j = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as {
      version: number
      frame: number
      templates: { c: string; t: string; b: string; m: string }[]
    }
    if (j.version !== CACHE_VERSION || j.frame !== FRAME) return null
    return j.templates.map((t) => {
      const mask: Mask = { size: FRAME, data: new Uint8Array(Buffer.from(t.m, "base64")) }
      return { core: t.c, top: t.t, bottom: t.b, mask, dt: distanceTransform(mask) }
    })
  } catch {
    return null // no/invalid cache → rebuild
  }
}

function saveBaseCache(templates: BaseTemplate[]): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true })
    const j = {
      version: CACHE_VERSION,
      frame: FRAME,
      templates: templates.map((t) => ({
        c: t.core,
        t: t.top,
        b: t.bottom,
        m: Buffer.from(t.mask.data).toString("base64"),
      })),
    }
    writeFileSync(CACHE_PATH, JSON.stringify(j))
  } catch {
    /* cache is best-effort — a failure just means we rebuild next time */
  }
}

/**
 * The joint base reference set. Two families cover how alphabetic mode packs
 * consonants (see the round-trip data):
 *   - placeholder core + top/bottom extensions (CVC-style syllables) — top × bottom;
 *   - a consonant core (+ optional bottom) — the CV / VCC-style syllables.
 * "" for a slot means empty; the bare placeholder is `("","","")`.
 */
function buildBaseTemplates(): BaseTemplate[] {
  const cached = loadBaseCache()
  if (cached) return cached

  const opts = ["", ...CONSONANTS]
  const out: BaseTemplate[] = []
  for (const top of opts) {
    for (const bottom of opts) {
      const spec: Record<string, string> = {}
      if (top) spec.top = top
      if (bottom) spec.bottom = bottom
      out.push(baseTemplate("", top, bottom, renderPlaceholder(spec)))
    }
  }
  for (const core of CONSONANTS) {
    out.push(baseTemplate(core, "", "", renderCoreConsonant(core)))
    for (const bottom of CONSONANTS) {
      out.push(baseTemplate(core, "", bottom, renderPlaceholder({ core, bottom })))
    }
  }
  saveBaseCache(out)
  return out
}

function ensureTemplates(): AlphaTemplates {
  if (cache) return cache
  const regImg = decodePng(
    svgToPng(renderGlyphToSvg(Register({ mode: "alphabetic" }), {}, { canvas: 128 }), { width: 256 }),
  )
  const regBmp = binarize(regImg.data, regImg.width, regImg.height)

  cache = {
    base: buildBaseTemplates(),
    superposed: vowelTemplates("superposed"),
    underposed: vowelTemplates("underposed"),
    side: vowelTemplates("right"),
    register: maskOfBox(regBmp, baseBoxOf(regBmp), SIZE),
  }
  return cache
}

/** Match a framed query base against the joint set → best (core, top, bottom). */
function matchBase(query: Mask, templates: BaseTemplate[]): BaseTemplate {
  const qDt = distanceTransform(query)
  let best = templates[0]!
  let bestDist = Infinity
  for (const t of templates) {
    const d = 0.5 * (meanNearestDistance(query, t.dt) + meanNearestDistance(t.mask, qDt))
    if (d < bestDist) {
      bestDist = d
      best = t
    }
  }
  return best
}

/** Build/load the reference templates now (call during server warmup so the first
 * real decode doesn't pay the one-time cache build). */
export function warmAlphabetic(): void {
  ensureTemplates()
}

/** Whether the on-disk base-template cache exists (for status display). */
export function alphaCacheExists(): boolean {
  return existsSync(CACHE_PATH)
}

/** Force a fresh rebuild: drop the on-disk cache and the in-process set, then
 * rebuild + re-save. Used by the "Build alphabetic cache" job. */
export function rebuildAlphabetic(): void {
  cache = null
  try {
    unlinkSync(CACHE_PATH)
  } catch {
    /* nothing to delete */
  }
  ensureTemplates()
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
  const { core, top, bottom } = matchBase(frameSquare(bmp, ch.base), t.base)
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

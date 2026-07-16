/**
 * The per-glyph class taxonomy for the reverse (OCR) pipeline.
 *
 * Enumerable, standalone-renderable glyph families:
 *   - secondary-consonant  : 28 consonant cores (Secondary character bases)
 *   - secondary-placeholder : 5 placeholder cores (standalone vowel/tone/stress/bias bases)
 *   - diacritic            : the unique superposed/underposed/right marks (isolated components)
 *   - extension            : consonant-cluster extension shapes (vert variant)
 *
 * NOT included: whole primary / tertiary / quaternary characters. Those encode
 * many grammatical categories simultaneously (combinatorial), so they can't be a
 * flat template set — they need a structural decomposition step, tracked as future
 * work. Diacritics and extensions cover the "other character types" that ARE
 * cleanly enumerable and separately recognizable.
 */
import { CORE_DIACRITICS, CORES, Diacritic, EXTENSIONS, Secondary } from "@zsnout/ithkuil/script"
import { shimWindow } from "./dom-shim.js" // ensures DOM globals before we build elements

const SVG_NS = "http://www.w3.org/2000/svg"

export interface GlyphClass {
  /** Filesystem-safe id, e.g. "secondary-c_hacek". */
  readonly id: string
  /** True romanized/descriptive label, e.g. "č" or "DOT". */
  readonly label: string
  /** Class family (grouping for the classifier / per-family eval). */
  readonly family: string
  /** Builds the glyph as an SVG graphics element (needs the DOM shim installed). */
  make(): SVGGraphicsElement
}

/** Render a raw SVG path string as a standalone path element (for extensions). */
function pathElement(d: string): SVGGraphicsElement {
  const p = shimWindow.document.createElementNS(SVG_NS, "path")
  p.setAttribute("d", d)
  return p as unknown as SVGGraphicsElement
}

// ── filesystem-safe slugs for non-ASCII / punctuation names ───────────────────
const CHAR_SLUG: Record<string, string> = {
  "č": "c_hacek", "ç": "c_cedilla", "ḑ": "d_cedilla", "ļ": "l_cedilla",
  "ň": "n_hacek", "ř": "r_hacek", "š": "s_hacek", "ţ": "t_cedilla",
  "ż": "z_dot", "ž": "z_hacek", "'": "apostrophe", '"': "dquote", "¿": "iquest",
}
function slug(name: string): string {
  return [...name]
    .map((ch) =>
      /[A-Za-z0-9_]/.test(ch)
        ? ch
        : (CHAR_SLUG[ch] ?? "u" + ch.codePointAt(0)!.toString(16)),
    )
    .join("")
}

// ── secondary consonant cores ─────────────────────────────────────────────────
const PLACEHOLDER_CORES = new Set([
  "ALPHABETIC_PLACEHOLDER",
  "STANDARD_PLACEHOLDER",
  "TONAL_PLACEHOLDER",
  "STRESSED_SYLLABLE_PLACEHOLDER",
  "BIAS",
])

/** All consonant core names (excludes placeholders/bias). */
export const CONSONANTS = Object.keys(CORES).filter(
  (n) => !PLACEHOLDER_CORES.has(n),
) as (keyof typeof CORES)[]

/**
 * Letters that can fill an *extension* (top/bottom) but never a core: @zsnout's `EXT` set
 * admits them while `CORE` does not, so they're absent from `CONSONANTS` above.
 *
 * `EXTENSIONS` also holds variant/marker glyphs (`p_WITH_LINE`, `CORE_GEMINATE`,
 * `EJECTIVE`, `VELARIZED`, `'`, `"`, `¿` …), but measuring the real root lexicon shows its
 * alphabet is exactly the 28 cores plus these two: **w (673 roots) and y (515)** — 27% of
 * all roots — and both occur ONLY root-finally, i.e. only ever in the bottom slot. Without
 * them the decoder had no template to match and emitted its nearest guess (a `w` read as
 * `dš`), making those roots undecodable by construction.
 */
export const EXTENSION_ONLY_CONSONANTS: readonly string[] = ["w", "y"]

/** Everything that can fill a top/bottom extension slot: the cores plus w/y. */
export const EXTENSION_CONSONANTS: readonly string[] = [...CONSONANTS, ...EXTENSION_ONLY_CONSONANTS]

const consonantClasses: GlyphClass[] = CONSONANTS.map((core) => ({
  id: `secondary-${slug(core)}`,
  label: core,
  family: "secondary-consonant",
  make: () => Secondary({ core }),
}))

// ── secondary placeholder cores (standalone bases) ────────────────────────────
const placeholderClasses: GlyphClass[] = [...PLACEHOLDER_CORES].map((core) => ({
  id: `placeholder-${slug(core.replace("_PLACEHOLDER", "").toLowerCase())}`,
  label: core,
  family: "secondary-placeholder",
  make: () => Secondary({ core: core as keyof typeof CORES }),
}))

// ── diacritics (dedup by path — vowel names alias the structural shapes) ───────
const diacriticClasses: GlyphClass[] = (() => {
  const seen = new Set<string>()
  const out: GlyphClass[] = []
  for (const name of Object.keys(CORE_DIACRITICS) as (keyof typeof CORE_DIACRITICS)[]) {
    const d = CORE_DIACRITICS[name]
    if (seen.has(d)) continue // skip alias of an already-added shape
    seen.add(d)
    out.push({
      id: `diacritic-${slug(name)}`,
      label: name,
      family: "diacritic",
      make: () => Diacritic({ name }),
    })
  }
  return out
})()

// ── consonant-cluster extensions (vert variant; dedup shapes that share a path) ─
const extensionClasses: GlyphClass[] = (() => {
  const seen = new Set<string>()
  const out: GlyphClass[] = []
  for (const name of Object.keys(EXTENSIONS) as (keyof typeof EXTENSIONS)[]) {
    const d = EXTENSIONS[name].vert
    if (seen.has(d)) continue // different name, identical vert shape → skip
    seen.add(d)
    out.push({
      id: `extension-${slug(name)}`,
      label: name,
      family: "extension",
      make: () => pathElement(d),
    })
  }
  return out
})()

/** The active glyph classes to generate a dataset for. */
export const GLYPH_CLASSES: readonly GlyphClass[] = [
  ...consonantClasses,
  ...placeholderClasses,
  ...diacriticClasses,
  ...extensionClasses,
]

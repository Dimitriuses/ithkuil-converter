/**
 * The per-glyph class taxonomy for the reverse (OCR) pipeline.
 *
 * Milestone 4 starts with the enumerable atomic set: the 28 New Ithkuil consonant
 * cores, each rendered as a standalone Secondary character. These are the cleanest
 * recognizable units (the "alphabet"). Other families (extensions, diacritics,
 * primary/tertiary/quaternary forms) can be added as further GlyphClass entries.
 */
import { CORES, Secondary } from "@zsnout/ithkuil/script"

export interface GlyphClass {
  /** Filesystem-safe id, e.g. "secondary-c_hacek". */
  readonly id: string
  /** True romanized label, e.g. "č". */
  readonly label: string
  /** Class family (grouping for the classifier). */
  readonly family: string
  /** Builds the glyph as an SVG group (needs the DOM shim to be installed). */
  make(): SVGGElement
}

// The CORES map also holds placeholders/bias, which aren't consonant glyphs.
const NON_CONSONANT = new Set([
  "ALPHABETIC_PLACEHOLDER",
  "STANDARD_PLACEHOLDER",
  "TONAL_PLACEHOLDER",
  "STRESSED_SYLLABLE_PLACEHOLDER",
  "BIAS",
])

/** ASCII slugs for consonants whose romanization isn't ASCII (for clean filenames). */
const SLUG: Record<string, string> = {
  "č": "c_hacek",
  "ç": "c_cedilla",
  "ḑ": "d_cedilla",
  "ļ": "l_cedilla",
  "ň": "n_hacek",
  "ř": "r_hacek",
  "š": "s_hacek",
  "ţ": "t_cedilla",
  "ż": "z_dot",
  "ž": "z_hacek",
}

/** All consonant core names (excludes placeholders/bias). */
export const CONSONANTS = Object.keys(CORES).filter(
  (name) => !NON_CONSONANT.has(name),
) as (keyof typeof CORES)[]

/** The active glyph classes to generate a dataset for. */
export const GLYPH_CLASSES: readonly GlyphClass[] = CONSONANTS.map((core) => ({
  id: `secondary-${SLUG[core] ?? core}`,
  label: core,
  family: "secondary-consonant",
  make: () => Secondary({ core }),
}))

/**
 * Structural decomposition of Tertiary characters (see decompose.ts for the recipe).
 *
 * Tertiary = a horizontal midline bar whose base varies by `valence` (9 values),
 * plus a superposed `absoluteLevel` diacritic and an underposed `relativeLevel`
 * diacritic (both from LEVEL_TO_DIACRITIC_MAP — same shape, position disambiguates).
 *
 * The optional top/bottom **segments** (aspect/phase/effect — 46 values each) are
 * connected to the bar and combinatorial; decoding them needs geometric zone-
 * splitting of the base and is deferred. This pilot recovers valence + both levels.
 */
import "./dom-shim.js" // must precede the @zsnout import
import { LEVEL_TO_DIACRITIC_MAP, Tertiary, VALENCE } from "@zsnout/ithkuil/script"
import type { Bitmap, SegmentedRegion } from "./segment.js"
import type { Candidate, Template } from "./classify.js"
import { buildBaseTemplates, decomposeCharacter, invertMap } from "./decompose.js"

const DIACRITIC_TO_LEVEL = invertMap(LEVEL_TO_DIACRITIC_MAP) // e.g. DOT → MIN

/** The 9 valence values (base of a tertiary character). */
export const VALENCES = Object.keys(VALENCE) as (keyof typeof VALENCE)[]

/** Base templates, one per valence. */
const BASE_TEMPLATES: Template[] = buildBaseTemplates(
  VALENCES.map((valence) => ({
    label: valence,
    class: `tertiary-${valence}`,
    el: () => Tertiary({ valence }),
  })),
)

export interface TertiaryDecode {
  isTertiary: boolean
  valence: string
  valenceScore: number
  /** superposed level diacritic → absolute level, or "none". */
  absoluteLevel: string
  /** underposed level diacritic → relative level, or "none". */
  relativeLevel: string
  baseCandidates: Candidate[]
}

/** Decompose a segmented character as a tertiary. */
export function decodeTertiary(
  bmp: Bitmap,
  region: SegmentedRegion,
  diacriticTemplates: Template[],
  minBaseScore = 0.6,
): TertiaryDecode {
  const d = decomposeCharacter(bmp, region, BASE_TEMPLATES, diacriticTemplates, {
    superposed: DIACRITIC_TO_LEVEL,
    underposed: DIACRITIC_TO_LEVEL,
  })
  return {
    isTertiary: d.base.score >= minBaseScore,
    valence: d.base.label,
    valenceScore: d.base.score,
    absoluteLevel: d.superposed ?? "none",
    relativeLevel: d.underposed ?? "none",
    baseCandidates: d.base.candidates,
  }
}

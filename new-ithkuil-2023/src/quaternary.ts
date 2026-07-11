/**
 * Structural decomposition of Quaternary characters (see decompose.ts for the recipe).
 *
 * Quaternary = a vertical bar whose base varies by `value` (VK illocution/validation
 * top-extension or VC case bottom-extension), plus a superposed `mood` diacritic and
 * an underposed `caseScope` diacritic. Mood/case-scope are separable, so the base is
 * enumerable by `value`; shapes map back via @zsnout's inverted maps.
 */
import "./dom-shim.js" // must precede the @zsnout import
import {
  CASE_SCOPE_TO_DIACRITIC_MAP,
  ILLOCUTION_TO_SECONDARY_EXTENSION,
  MOOD_TO_DIACRITIC_MAP,
  Quaternary,
} from "@zsnout/ithkuil/script"
import type { Bitmap, SegmentedRegion } from "./segment.js"
import type { Candidate, Template } from "./classify.js"
import { buildBaseTemplates, decomposeCharacter, invertMap } from "./decompose.js"

const DIACRITIC_TO_MOOD = invertMap(MOOD_TO_DIACRITIC_MAP) // e.g. DOT → SUB
const DIACRITIC_TO_CASE_SCOPE = invertMap(CASE_SCOPE_TO_DIACRITIC_MAP) // e.g. DOT → CCA

/** Base templates keyed by `value` (bare + each illocution/validation top-extension). */
const BASE_TEMPLATES: Template[] = buildBaseTemplates([
  { label: "∅", class: "quaternary-none", el: () => Quaternary({}) },
  ...Object.keys(ILLOCUTION_TO_SECONDARY_EXTENSION).map((value) => ({
    label: value,
    class: `quaternary-${value}`,
    el: () => Quaternary({ value: value as never }),
  })),
])

export interface QuaternaryDecode {
  isQuaternary: boolean
  value: string
  valueScore: number
  mood: string
  caseScope: string
  baseCandidates: Candidate[]
}

/** Decompose a segmented character as a quaternary. */
export function decodeQuaternary(
  bmp: Bitmap,
  region: SegmentedRegion,
  diacriticTemplates: Template[],
  minBaseScore = 0.6,
): QuaternaryDecode {
  const d = decomposeCharacter(bmp, region, BASE_TEMPLATES, diacriticTemplates, {
    superposed: DIACRITIC_TO_MOOD,
    underposed: DIACRITIC_TO_CASE_SCOPE,
  })
  return {
    isQuaternary: d.base.score >= minBaseScore,
    value: d.base.label,
    valueScore: d.base.score,
    mood: d.superposed ?? "FAC",
    caseScope: d.underposed ?? "CCN",
    baseCandidates: d.base.candidates,
  }
}

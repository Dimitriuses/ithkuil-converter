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
  Primary,
  Quaternary,
  Secondary,
  Tertiary,
  VALENCE,
} from "@zsnout/ithkuil/script"
import { buildBaseTemplates, maskOfBox } from "./decompose.js"
import { classifyMask, type Template } from "./classify.js"
import { CONSONANTS } from "./glyph-classes.js"
import type { Bitmap, SegmentedRegion } from "./segment.js"

export type CharType = "secondary" | "quaternary" | "tertiary" | "primary"

// One template per representative base shape of each type, tagged via the class prefix.
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
  ...buildBaseTemplates(
    ["BSC", "CTE", "CSV", "OBJ"].map((s) => ({
      label: s,
      class: `primary-${s}`,
      el: () => Primary({ specification: s as never, perspective: "M" }),
    })),
  ),
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

/**
 * Structural decomposition of Quaternary characters.
 *
 * A quaternary character is a vertical bar carrying:
 *   - value  : VK illocution/validation (top extension) or VC case (bottom
 *              extension) — part of the connected base component;
 *   - mood   : a superposed diacritic (separate component);
 *   - caseScope : an underposed diacritic (separate component).
 *
 * Because mood and case-scope are *separable* components (the segmenter isolates
 * them), the base shape depends only on `value` — an enumerable set. So we don't
 * geometrically split the bar: we template-match the base against rendered
 * `Quaternary({ value })` references, and read mood/case-scope from the diacritic
 * components using @zsnout's own value→shape maps (inverted). This is the reusable
 * recipe for decomposing the "combinatorial" character types.
 */
import "./dom-shim.js" // must precede the @zsnout import
import {
  CASE_SCOPE_TO_DIACRITIC_MAP,
  ILLOCUTION_TO_SECONDARY_EXTENSION,
  MOOD_TO_DIACRITIC_MAP,
  Quaternary,
} from "@zsnout/ithkuil/script"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, type Bitmap, type SegmentedRegion } from "./segment.js"
import { cropInk, maskFromBitmap, normalizeMask, type Mask } from "./normalize.js"
import { renderGlyphToSvg } from "./glyph-render.js"
import { classifyMask, type Candidate, type Template } from "./classify.js"

const SIZE = 64

/** Invert a {value: shapeName} map into {shapeName: value}. */
function invert(map: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [value, shape] of Object.entries(map)) if (shape) out[shape] = value
  return out
}

// diacritic-shape label → grammatical value (position disambiguates the two)
const DIACRITIC_TO_MOOD = invert(MOOD_TO_DIACRITIC_MAP) // e.g. DOT → SUB
const DIACRITIC_TO_CASE_SCOPE = invert(CASE_SCOPE_TO_DIACRITIC_MAP) // e.g. DOT → CCA

/** Render a quaternary character and normalize its whole shape to a mask. */
function renderBaseMask(spec: Parameters<typeof Quaternary>[0]): Mask {
  const img = decodePng(svgToPng(renderGlyphToSvg(Quaternary(spec), {}, { canvas: 128 }), { width: 128 }))
  return maskFromBitmap(binarize(img.data, img.width, img.height), SIZE)
}

/** Quaternary base templates, keyed by `value` (bare + each illocution/validation). */
const BASE_TEMPLATES: Template[] = [
  { label: "∅", class: "quaternary-none", mask: renderBaseMask({}) },
  ...Object.keys(ILLOCUTION_TO_SECONDARY_EXTENSION).map((value) => ({
    label: value,
    class: `quaternary-${value}`,
    mask: renderBaseMask({ value: value as never }),
  })),
]

export interface QuaternaryDecode {
  /** Whether the base matched a quaternary bar shape confidently. */
  isQuaternary: boolean
  /** Recognized value (illocution/validation label, or "∅" for none). */
  value: string
  valueScore: number
  /** Mood (superposed diacritic → mood), default "FAC". */
  mood: string
  /** Case-scope (underposed diacritic → case-scope), default "CCN". */
  caseScope: string
  baseCandidates: Candidate[]
}

function maskOfBox(bmp: Bitmap, box: SegmentedRegion["base"]): Mask {
  const crop = cropInk(bmp, box)
  return normalizeMask(crop.ink, crop.width, crop.height, SIZE)
}

/**
 * Decompose a segmented character as a quaternary. `diacriticTemplates` are the
 * diacritic-family templates (e.g. from the dataset).
 */
export function decodeQuaternary(
  bmp: Bitmap,
  region: SegmentedRegion,
  diacriticTemplates: Template[],
  minBaseScore = 0.6,
): QuaternaryDecode {
  const base = classifyMask(maskOfBox(bmp, region.base), BASE_TEMPLATES)

  let mood = "FAC"
  let caseScope = "CCN"
  for (const c of region.components) {
    if (c.role !== "superposed" && c.role !== "underposed") continue
    const d = classifyMask(maskOfBox(bmp, c.bbox), diacriticTemplates)
    if (c.role === "superposed") mood = DIACRITIC_TO_MOOD[d.label] ?? mood
    else caseScope = DIACRITIC_TO_CASE_SCOPE[d.label] ?? caseScope
  }

  return {
    isQuaternary: base.score >= minBaseScore,
    value: base.label,
    valueScore: base.score,
    mood,
    caseScope,
    baseCandidates: base.candidates,
  }
}

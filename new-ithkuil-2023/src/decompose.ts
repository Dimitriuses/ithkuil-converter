/**
 * The reusable recipe for decomposing "combinatorial" character types
 * (quaternary, tertiary, …) into grammatical features.
 *
 * A character = a base component (varies by its non-separable feature) + optional
 * superposed / underposed diacritic components (separable, isolated by the
 * segmenter). So we:
 *   1. template-match the base against on-the-fly `Constructor({ feature })` renders;
 *   2. classify each diacritic component and map its shape → value via @zsnout's own
 *      value→shape maps, inverted (position disambiguates same-shape/different-meaning).
 */
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, type Bitmap, type BBox, type SegmentedRegion } from "./segment.js"
import { cropInk, maskFromBitmap, normalizeMask, type Mask } from "./normalize.js"
import { renderGlyphToSvg } from "./glyph-render.js"
import { classifyMask, type ClassifiedGlyph, type Template } from "./classify.js"

/** Crop an image box to its ink and normalize to a size×size mask. */
export function maskOfBox(bmp: Bitmap, box: BBox, size = 64): Mask {
  const crop = cropInk(bmp, box)
  return normalizeMask(crop.ink, crop.width, crop.height, size)
}

/** Invert a {value: shapeName} map into {shapeName: value}. */
export function invertMap(map: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [value, shape] of Object.entries(map)) if (shape) out[shape] = value
  return out
}

/** Build base templates by rendering each spec's glyph element and normalizing it. */
export function buildBaseTemplates(
  specs: { label: string; class: string; el: () => SVGGraphicsElement }[],
  size = 64,
): Template[] {
  return specs.map(({ label, class: cls, el }) => {
    const img = decodePng(svgToPng(renderGlyphToSvg(el(), {}, { canvas: 128 }), { width: 128 }))
    return { label, class: cls, mask: maskFromBitmap(binarize(img.data, img.width, img.height), size) }
  })
}

export interface DecomposeMaps {
  /** superposed diacritic label → grammatical value */
  superposed?: Record<string, string>
  /** underposed diacritic label → grammatical value */
  underposed?: Record<string, string>
}

export interface Decomposition {
  base: ClassifiedGlyph
  superposed: string | null
  underposed: string | null
}

/** Decompose one segmented character into base value + super/under diacritic values. */
export function decomposeCharacter(
  bmp: Bitmap,
  region: SegmentedRegion,
  baseTemplates: Template[],
  diacriticTemplates: Template[],
  maps: DecomposeMaps,
  size = 64,
): Decomposition {
  const base = classifyMask(maskOfBox(bmp, region.base, size), baseTemplates)
  let superposed: string | null = null
  let underposed: string | null = null
  for (const c of region.components) {
    if (c.role === "superposed" && maps.superposed) {
      const d = classifyMask(maskOfBox(bmp, c.bbox, size), diacriticTemplates)
      superposed = maps.superposed[d.label] ?? null
    } else if (c.role === "underposed" && maps.underposed) {
      const d = classifyMask(maskOfBox(bmp, c.bbox, size), diacriticTemplates)
      underposed = maps.underposed[d.label] ?? null
    }
  }
  return { base, superposed, underposed }
}

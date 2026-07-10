/**
 * Milestone 6 — baseline glyph classifier.
 *
 * Template matching against the clean canonical samples in a generated dataset,
 * using the thickness-invariant Chamfer metric. This is the first image → labels
 * step; it's later swapped/augmented by a CNN (Milestone 9) for noisy input.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodePng } from "./image-io.js"
import { binarize, type Bitmap, type Role, type SegmentedRegion } from "./segment.js"
import { cropInk, maskFromBitmap, normalizeMask, type Mask } from "./normalize.js"
import { chamferSimilarity } from "./chamfer.js"

export interface Template {
  label: string
  class: string
  mask: Mask
}

export interface Candidate {
  label: string
  class: string
  score: number
}

export interface ClassifiedGlyph {
  label: string
  class: string
  score: number
  /** Top matches, best first (includes the winner). */
  candidates: Candidate[]
}

interface Manifest {
  classes: { id: string; label: string; family: string }[]
  samples: { file: string; label: string; class: string; clean: boolean }[]
}

/** Load one template per class from a dataset's clean canonical samples. */
export function loadTemplates(datasetDir: string, size = 64): Template[] {
  const manifest = JSON.parse(
    readFileSync(join(datasetDir, "manifest.json"), "utf8"),
  ) as Manifest
  const templates: Template[] = []
  for (const s of manifest.samples) {
    if (!s.clean) continue
    const img = decodePng(readFileSync(join(datasetDir, s.file)))
    const mask = maskFromBitmap(binarize(img.data, img.width, img.height), size)
    templates.push({ label: s.label, class: s.class, mask })
  }
  return templates
}

/** Classify a normalized mask against templates. */
export function classifyMask(mask: Mask, templates: Template[], topK = 3): ClassifiedGlyph {
  const scored: Candidate[] = templates
    .map((t) => ({ label: t.label, class: t.class, score: chamferSimilarity(mask, t.mask) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  return { label: best.label, class: best.class, score: best.score, candidates: scored.slice(0, topK) }
}

/** Classify each segmented region by cropping and normalizing its base component. */
export function classifyRegions(
  bmp: Bitmap,
  regions: readonly SegmentedRegion[],
  templates: Template[],
  size = 64,
): ClassifiedGlyph[] {
  return regions.map((r) => {
    const crop = cropInk(bmp, r.base)
    const mask = normalizeMask(crop.ink, crop.width, crop.height, size)
    return classifyMask(mask, templates)
  })
}

/** A character's base plus its classified diacritic marks. */
export interface DetailedGlyph {
  base: ClassifiedGlyph
  marks: { role: Role; glyph: ClassifiedGlyph }[]
}

/** Split a template set into diacritic vs everything-else (base) pools. */
export function partitionTemplates(templates: Template[]): { base: Template[]; diacritic: Template[] } {
  return {
    base: templates.filter((t) => t.class.split("-")[0] !== "diacritic"),
    diacritic: templates.filter((t) => t.class.split("-")[0] === "diacritic"),
  }
}

/**
 * Classify a whole character: the base against non-diacritic templates, and each
 * superposed/underposed/right component against the diacritic templates. This
 * uses the expanded taxonomy (consonants/placeholders/extensions for the base,
 * the diacritic family for the marks).
 */
export function classifyRegionsDetailed(
  bmp: Bitmap,
  regions: readonly SegmentedRegion[],
  templates: Template[],
  size = 64,
): DetailedGlyph[] {
  const { base: baseTpl, diacritic: diaTpl } = partitionTemplates(templates)
  const maskOf = (box: SegmentedRegion["base"]) => {
    const crop = cropInk(bmp, box)
    return normalizeMask(crop.ink, crop.width, crop.height, size)
  }
  return regions.map((r) => ({
    base: classifyMask(maskOf(r.base), baseTpl),
    marks: r.components
      .filter((c) => c.role !== "base")
      .map((c) => ({ role: c.role, glyph: classifyMask(maskOf(c.bbox), diaTpl) })),
  }))
}

/**
 * Thickness-invariant shape similarity via a symmetric Chamfer distance.
 *
 * Ported from the 2011 harness (build_glyph_similarity.py): for two binary masks
 * A and B, average the distance from each A-ink pixel to the nearest B-ink pixel
 * and vice-versa, then map to a score in (0, 1]. Because it measures how close the
 * shapes' pixels are to each other (not exact overlap), it tolerates differences
 * in stroke thickness — which matters when the query is a scan/render and the
 * template is a clean vector glyph.
 */
import type { Mask } from "./normalize.js"

const SQRT2 = Math.SQRT2
const INF = 1e9

/** Chamfer distance transform: distance from every cell to the nearest ink cell. */
export function distanceTransform(mask: Mask): Float32Array {
  const N = mask.size
  const d = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) d[i] = mask.data[i] ? 0 : INF

  // forward pass (from top-left)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 1)
      if (y > 0) v = Math.min(v, d[i - N] + 1)
      if (x > 0 && y > 0) v = Math.min(v, d[i - N - 1] + SQRT2)
      if (x < N - 1 && y > 0) v = Math.min(v, d[i - N + 1] + SQRT2)
      d[i] = v
    }
  }
  // backward pass (from bottom-right)
  for (let y = N - 1; y >= 0; y--) {
    for (let x = N - 1; x >= 0; x--) {
      const i = y * N + x
      let v = d[i]
      if (x < N - 1) v = Math.min(v, d[i + 1] + 1)
      if (y < N - 1) v = Math.min(v, d[i + N] + 1)
      if (x < N - 1 && y < N - 1) v = Math.min(v, d[i + N + 1] + SQRT2)
      if (x > 0 && y < N - 1) v = Math.min(v, d[i + N - 1] + SQRT2)
      d[i] = v
    }
  }
  return d
}

/** Mean distance from each ink pixel of `inkMask` to the nearest ink of another
 * shape (whose distance transform is `dtOfOther`). Exposed so callers matching one
 * query against many templates can precompute the templates' transforms. */
export function meanNearestDistance(inkMask: Mask, dtOfOther: Float32Array): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < inkMask.data.length; i++) {
    if (inkMask.data[i]) {
      sum += dtOfOther[i]
      n++
    }
  }
  return n === 0 ? INF : sum / n
}

/** Symmetric Chamfer similarity in (0, 1]; 1 = identical, → 0 as shapes diverge. */
export function chamferSimilarity(a: Mask, b: Mask): number {
  const dtA = distanceTransform(a)
  const dtB = distanceTransform(b)
  const dAB = meanNearestDistance(a, dtB)
  const dBA = meanNearestDistance(b, dtA)
  if (dAB >= INF || dBA >= INF) return 0
  const d = 0.5 * (dAB + dBA)
  return 1 / (1 + d)
}

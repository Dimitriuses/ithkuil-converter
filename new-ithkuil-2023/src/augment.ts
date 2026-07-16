/**
 * Scan-simulation augmentation for the pipeline-domain CNN trainers.
 *
 * The primary / top / secondary / alphabetic CNNs train only on CLEAN `encode()` renders,
 * so they're brittle to the noise, blur, skew, and stroke-width variation of a real scan or
 * hand-drawing. This perturbs a rendered glyph image toward those conditions so a retrain
 * (`AUGMENT=1 npm run cnn-…`) can build robustness — WITHOUT touching the clean-render path:
 * augmentation is opt-in per trainer, so the deployed models stay clean-trained until a
 * real-scan retrain is deliberately run.
 *
 * Operates on the RGBA image straight out of `decodePng`, before binarize / frameSquare /
 * toGrayNxN — so it works for every trainer regardless of how it later reads the pixels.
 * Glyphs are dark ink on a white ground; we work on a single intensity channel and expand
 * back to gray RGBA. Determinism comes from the caller's seeded `rand`.
 */
import type { RgbaImage } from "./image-io.js"

export interface AugmentOptions {
  /** Max absolute rotation in degrees (simulated skew). Default 3. */
  maxRotationDeg?: number
  /** P(apply a box blur) and its radius (scan softness). Default 0.5 / radius 1. */
  blurProb?: number
  /** P(apply speckle noise) and its max per-pixel magnitude 0–255. Default 0.6 / 38. */
  noiseProb?: number
  noiseMax?: number
  /** P(apply a stroke dilate/erode step) — thicker/thinner strokes. Default 0.45. */
  morphProb?: number
}

const DEFAULTS: Required<AugmentOptions> = {
  maxRotationDeg: 3,
  blurProb: 0.5,
  noiseProb: 0.6,
  noiseMax: 38,
  morphProb: 0.45,
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** Rotate a white-ground intensity buffer about its centre (bilinear, out-of-bounds = white). */
function rotate(src: Float32Array, w: number, h: number, deg: number): Float32Array<ArrayBuffer> {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // inverse-map the destination pixel back into the source
      const dx = x - cx
      const dy = y - cy
      const sx = cx + dx * cos + dy * sin
      const sy = cy - dx * sin + dy * cos
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) {
        out[y * w + x] = 255 // white background
        continue
      }
      const fx = sx - x0
      const fy = sy - y0
      const a = src[y0 * w + x0]!
      const b = src[y0 * w + x0 + 1]!
      const c = src[(y0 + 1) * w + x0]!
      const d = src[(y0 + 1) * w + x0 + 1]!
      out[y * w + x] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
    }
  }
  return out
}

/** 3×3 morphology on intensity. `dilateInk` (min filter) thickens dark strokes; else erodes. */
function morph(src: Float32Array, w: number, h: number, dilateInk: boolean): Float32Array<ArrayBuffer> {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = dilateInk ? 255 : 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const v = src[yy * w + xx]!
          acc = dilateInk ? Math.min(acc, v) : Math.max(acc, v)
        }
      }
      out[y * w + x] = acc
    }
  }
  return out
}

/** 3×3 box blur. */
function boxBlur(src: Float32Array, w: number, h: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          sum += src[yy * w + xx]!
          n++
        }
      }
      out[y * w + x] = sum / n
    }
  }
  return out
}

/** Apply randomized scan-like augmentation to a rendered glyph image. Returns a new image. */
export function augmentImage(img: RgbaImage, rand: () => number, opts: AugmentOptions = {}): RgbaImage {
  const o = { ...DEFAULTS, ...opts }
  const { width: w, height: h, data } = img

  // RGBA → intensity (luma). Dark ink low, white ground high.
  let g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!

  const deg = (rand() * 2 - 1) * o.maxRotationDeg
  if (Math.abs(deg) > 0.2) g = rotate(g, w, h, deg)
  if (rand() < o.morphProb) g = morph(g, w, h, rand() < 0.5)
  if (rand() < o.blurProb) g = boxBlur(g, w, h)
  if (rand() < o.noiseProb) for (let i = 0; i < g.length; i++) g[i] = clamp(g[i]! + (rand() * 2 - 1) * o.noiseMax)

  const out = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const v = clamp(g[i]!)
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v
    out[i * 4 + 3] = 255
  }
  return { width: w, height: h, data: out }
}

/** Whether augmentation is enabled for this trainer run (`AUGMENT=1`). Read once at startup. */
export const AUGMENT_ON = process.env.AUGMENT === "1" || process.env.AUGMENT === "true"

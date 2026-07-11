/**
 * Pixel-level augmentation for the synthetic dataset — Gaussian noise + light blur.
 * Geometric augmentation (scale/rotate/jitter) happens at render time; this adds the
 * appearance noise a CNN needs to generalize toward real/scanned input. All ops take
 * a seeded RNG for reproducibility and mutate the RGBA image in place.
 */
import type { RgbaImage } from "./image-io.js"

/** Standard normal sample (Box–Muller). */
function gaussian(rand: () => number): number {
  const u1 = Math.max(1e-9, rand())
  const u2 = rand()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** Add zero-mean Gaussian noise (std `sigma`, in 0–255 units) to RGB channels. */
export function addGaussianNoise(img: RgbaImage, sigma: number, rand: () => number): void {
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = gaussian(rand) * sigma
    d[i] = clamp(d[i] + n)
    d[i + 1] = clamp(d[i + 1] + n)
    d[i + 2] = clamp(d[i + 2] + n)
  }
}

/** Separable box blur of the given radius (0 = no-op). */
export function boxBlur(img: RgbaImage, radius: number): void {
  if (radius < 1) return
  const { width: W, height: H, data } = img
  const w = radius * 2 + 1
  const tmp = new Uint8Array(data.length)
  // horizontal
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(W - 1, Math.max(0, x + k))
        const j = (y * W + xx) * 4
        r += data[j]; g += data[j + 1]; b += data[j + 2]
      }
      const o = (y * W + x) * 4
      tmp[o] = r / w; tmp[o + 1] = g / w; tmp[o + 2] = b / w; tmp[o + 3] = 255
    }
  }
  // vertical
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(H - 1, Math.max(0, y + k))
        const j = (yy * W + x) * 4
        r += tmp[j]; g += tmp[j + 1]; b += tmp[j + 2]
      }
      const o = (y * W + x) * 4
      data[o] = r / w; data[o + 1] = g / w; data[o + 2] = b / w; data[o + 3] = 255
    }
  }
}

export interface PixelAugment {
  /** Gaussian noise std in 0–255 units. */
  noise?: number
  /** Box-blur radius (px). */
  blur?: number
}

/** Apply the configured pixel augmentation in place. */
export function augmentPixels(img: RgbaImage, opts: PixelAugment, rand: () => number): void {
  if (opts.blur) boxBlur(img, opts.blur)
  if (opts.noise) addGaussianNoise(img, opts.noise, rand)
}

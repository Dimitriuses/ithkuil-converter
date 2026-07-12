/**
 * Load a generated dataset into CNN-ready arrays: each sample is bbox-cropped,
 * padded square, and resized to N×N grayscale ink intensity in [0,1] (ink→1). Grayscale
 * (not binary) preserves the noise/blur augmentation the CNN should learn from.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodePng, type RgbaImage } from "./image-io.js"

// 48px now that the native tfjs-node backend makes training fast (was 24px, capped by
// the slow pure-JS CPU backend). Higher resolution preserves the fine features that
// separate the near-identical consonant pairs. Inference reads the size from the model.
export const CNN_SIZE = 48

/** bbox-crop → pad square → resize to N×N grayscale ink intensity (ink=1, bg=0). */
export function toGrayNxN(img: RgbaImage, n = CNN_SIZE): Float32Array {
  const { width: W, height: H, data } = img
  const g = new Float32Array(W * H)
  let minx = W, maxx = -1, miny = H, maxy = -1
  for (let i = 0; i < W * H; i++) {
    const l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    const v = (255 - l) / 255 // ink (dark) → 1
    g[i] = v
    if (v > 0.5) {
      const x = i % W, y = (i / W) | 0
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
    }
  }
  const out = new Float32Array(n * n)
  if (maxx < 0) return out
  const w = maxx - minx + 1, h = maxy - miny + 1
  const s = Math.max(w, h)
  const offX = (s - w) >> 1, offY = (s - h) >> 1
  for (let ty = 0; ty < n; ty++) {
    const sy = miny + Math.round((ty * s) / n - offY)
    if (sy < miny || sy > maxy) continue
    for (let tx = 0; tx < n; tx++) {
      const sx = minx + Math.round((tx * s) / n - offX)
      if (sx < minx || sx > maxx) continue
      out[ty * n + tx] = g[sy * W + sx]
    }
  }
  return out
}

export interface LoadedSample {
  gray: Float32Array
  label: string
  labelIndex: number
  clean: boolean
  file: string
}

export interface LoadedDataset {
  labels: string[]
  samples: LoadedSample[]
  size: number
}

export function loadDataset(dir: string, n = CNN_SIZE): LoadedDataset {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
    samples: { file: string; label: string; clean: boolean }[]
  }
  const labels = [...new Set(manifest.samples.map((s) => s.label))].sort()
  const labelIndex = new Map(labels.map((l, i) => [l, i]))
  const samples: LoadedSample[] = manifest.samples.map((s) => {
    const img = decodePng(readFileSync(join(dir, s.file)))
    return {
      gray: toGrayNxN(img, n),
      label: s.label,
      labelIndex: labelIndex.get(s.label)!,
      clean: s.clean,
      file: s.file,
    }
  })
  return { labels, samples, size: n }
}

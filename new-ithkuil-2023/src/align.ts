/**
 * Align a segmented primary (arbitrary scale/position) into the canonical fixed
 * frame, so its positional zones line up with the templates.
 *
 * Anchor: the primary's **bottom baseline is feature-invariant** (measured constant
 * across specification × perspective), so we place the query's ink bottom at a fixed
 * canvas row and horizontally centre it, scaling by ink height. This removes the
 * scale/position freedom a real segmentation introduces. (Perfect decoupling isn't
 * possible from pixels alone — features perturb the extent — but the bottom anchor
 * plus height scale is a robust approximation of the @zsnout coordinate frame.)
 */
import type { Bitmap } from "./segment.js"

export interface AlignOptions {
  canvas?: number
  /** Canvas row the ink bottom is placed on. Default 130 (matches the fixed frame). */
  bottom?: number
  /** Canvas x the ink is centred on. Default 78. */
  centerX?: number
  /** Target ink height in canvas px. Default 104. */
  targetHeight?: number
}

/** Resample a binary bitmap into the canonical frame (inverse-mapped, no holes). */
export function alignToFrame(bmp: Bitmap, opts: AlignOptions = {}): Bitmap {
  const canvas = opts.canvas ?? 160
  const bottom = opts.bottom ?? 130
  const centerX = opts.centerX ?? 78
  const targetH = opts.targetHeight ?? 104

  // source ink bbox + horizontal centre
  let minx = bmp.width, maxx = -1, miny = bmp.height, maxy = -1
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      if (bmp.ink[y * bmp.width + x]) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
      }
    }
  }
  const out = new Uint8Array(canvas * canvas)
  if (maxx < 0) return { width: canvas, height: canvas, ink: out }

  const srcH = maxy - miny + 1
  const s = targetH / srcH // scale
  const srcCx = (minx + maxx) / 2
  const srcBottom = maxy

  // inverse map: for each target pixel, sample the source
  for (let ty = 0; ty < canvas; ty++) {
    const sy = Math.round(srcBottom + (ty - bottom) / s)
    if (sy < 0 || sy >= bmp.height) continue
    for (let tx = 0; tx < canvas; tx++) {
      const sx = Math.round(srcCx + (tx - centerX) / s)
      if (sx < 0 || sx >= bmp.width) continue
      if (bmp.ink[sy * bmp.width + sx]) out[ty * canvas + tx] = 1
    }
  }
  return { width: canvas, height: canvas, ink: out }
}

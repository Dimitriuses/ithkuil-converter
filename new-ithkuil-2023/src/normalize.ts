/**
 * Normalize an ink region to a fixed square binary mask, so glyphs of different
 * size/position/aspect compare fairly. Mirrors the normalization used by the
 * 2011 similarity harness: crop to the ink bounding box, pad to a square, then
 * nearest-neighbour resize to N×N.
 */
import type { Bitmap, BBox } from "./segment.js"

export interface Mask {
  /** Side length (mask is size×size). */
  readonly size: number
  /** 1 = ink, 0 = background. Row-major, length size*size. */
  readonly data: Uint8Array
}

/** Extract the ink of a sub-rectangle of a bitmap into its own small mask. */
export function cropInk(bmp: Bitmap, box: BBox): { ink: Uint8Array; width: number; height: number } {
  const ink = new Uint8Array(box.w * box.h)
  for (let y = 0; y < box.h; y++) {
    const sy = box.y + y
    if (sy < 0 || sy >= bmp.height) continue
    for (let x = 0; x < box.w; x++) {
      const sx = box.x + x
      if (sx < 0 || sx >= bmp.width) continue
      ink[y * box.w + x] = bmp.ink[sy * bmp.width + sx]
    }
  }
  return { ink, width: box.w, height: box.h }
}

/**
 * Crop a raw ink mask to its bounding box, pad to a centred square, and resize to
 * N×N. Returns an all-zero mask if there is no ink.
 */
export function normalizeMask(
  ink: Uint8Array,
  width: number,
  height: number,
  size = 64,
): Mask {
  let minx = width, maxx = -1, miny = height, maxy = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ink[y * width + x]) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
      }
    }
  }
  const out = new Uint8Array(size * size)
  if (maxx < 0) return { size, data: out } // empty

  const w = maxx - minx + 1
  const h = maxy - miny + 1
  const s = Math.max(w, h)
  const offX = ((s - w) / 2) | 0
  const offY = ((s - h) / 2) | 0

  // For each target cell, sample the source (nearest neighbour) within the square.
  for (let ty = 0; ty < size; ty++) {
    // square coordinate, then into cropped-glyph coordinate
    const sqy = (ty * s) / size
    const cy = (sqy - offY) | 0
    if (cy < 0 || cy >= h) continue
    const srcY = miny + cy
    for (let tx = 0; tx < size; tx++) {
      const sqx = (tx * s) / size
      const cx = (sqx - offX) | 0
      if (cx < 0 || cx >= w) continue
      if (ink[srcY * width + (minx + cx)]) out[ty * size + tx] = 1
    }
  }
  return { size, data: out }
}

/** Convenience: normalize an entire bitmap (whole image) to a mask. */
export function maskFromBitmap(bmp: Bitmap, size = 64): Mask {
  return normalizeMask(bmp.ink, bmp.width, bmp.height, size)
}

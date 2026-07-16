/**
 * Image decode/encode (PNG via pngjs, JPEG via jpeg-js) and simple debug drawing for the
 * reverse pipeline. JPEG matters for real-scan input: phone cameras produce JPG, and both
 * pure-JS decoders keep the project free of native image dependencies.
 */
import { PNG } from "pngjs"
import * as jpeg from "jpeg-js"
import { readFileSync, writeFileSync } from "node:fs"
import type { BBox, SegmentedRegion, Role } from "./segment.js"

export interface RgbaImage {
  width: number
  height: number
  /** RGBA, row-major, length width*height*4. */
  data: Uint8Array
}

export function decodePng(buf: Buffer): RgbaImage {
  const png = PNG.sync.read(buf)
  return { width: png.width, height: png.height, data: png.data }
}

export function loadPng(path: string): RgbaImage {
  return decodePng(readFileSync(path))
}

/** Decode a JPEG buffer to RGBA. `tolerantDecoding` copes with slightly-off phone JPEGs,
 * and the resolution/memory caps are raised for high-megapixel captures. */
export function decodeJpeg(buf: Buffer): RgbaImage {
  const img = jpeg.decode(buf, {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: true,
    maxResolutionInMP: 200,
    maxMemoryUsageInMB: 1024,
  })
  return { width: img.width, height: img.height, data: img.data }
}

/** Decode a PNG or JPEG buffer, dispatching on the magic bytes (robust to a wrong file
 * extension — phone exports mislabel formats often enough to matter). */
export function decodeImage(buf: Buffer): RgbaImage {
  // PNG: 89 50 4E 47 · JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return decodeJpeg(buf)
  return decodePng(buf) // pngjs throws a clear error if it's neither
}

/** Load a PNG or JPEG from disk (format sniffed from the bytes, not the extension). */
export function loadImage(path: string): RgbaImage {
  return decodeImage(readFileSync(path))
}

/** Encode an RGBA image to a PNG buffer. */
export function encodePng(img: RgbaImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height })
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength)
  return PNG.sync.write(png)
}

export function savePng(path: string, img: RgbaImage): void {
  writeFileSync(path, encodePng(img))
}

/** Crop an RGBA image to a bounding box (out-of-bounds padded white). */
export function cropRgba(img: RgbaImage, box: BBox): RgbaImage {
  const data = new Uint8Array(box.w * box.h * 4)
  for (let ry = 0; ry < box.h; ry++) {
    for (let rx = 0; rx < box.w; rx++) {
      const sx = box.x + rx
      const sy = box.y + ry
      const d = (ry * box.w + rx) * 4
      if (sx >= 0 && sy >= 0 && sx < img.width && sy < img.height) {
        const s = (sy * img.width + sx) * 4
        data[d] = img.data[s]
        data[d + 1] = img.data[s + 1]
        data[d + 2] = img.data[s + 2]
        data[d + 3] = img.data[s + 3]
      } else {
        data[d] = data[d + 1] = data[d + 2] = data[d + 3] = 255
      }
    }
  }
  return { width: box.w, height: box.h, data }
}

type RGB = readonly [number, number, number]

/** Draw a rectangle outline (in place). */
export function drawRect(img: RgbaImage, box: BBox, color: RGB, thickness = 1): void {
  const { width: W, height: H, data } = img
  const put = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = (y * W + x) * 4
    data[i] = color[0]
    data[i + 1] = color[1]
    data[i + 2] = color[2]
    data[i + 3] = 255
  }
  for (let t = 0; t < thickness; t++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      put(x, box.y + t)
      put(x, box.y + box.h - 1 - t)
    }
    for (let y = box.y; y < box.y + box.h; y++) {
      put(box.x + t, y)
      put(box.x + box.w - 1 - t, y)
    }
  }
}

const ROLE_COLOR: Record<Role, RGB> = {
  base: [40, 180, 70], // green
  superposed: [60, 120, 230], // blue
  underposed: [230, 130, 40], // orange
  right: [40, 190, 200], // cyan
  unknown: [150, 150, 150], // grey
}
const REGION_COLOR: RGB = [210, 60, 190] // magenta — whole-character box

/** Return a copy of `img` with each segmented region + its components outlined. */
export function renderSegmentationOverlay(
  img: RgbaImage,
  regions: readonly SegmentedRegion[],
): RgbaImage {
  const out: RgbaImage = { width: img.width, height: img.height, data: new Uint8Array(img.data) }
  for (const r of regions) {
    drawRect(out, r.bbox, REGION_COLOR, 1)
    for (const c of r.components) drawRect(out, c.bbox, ROLE_COLOR[c.role], 2)
  }
  return out
}

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

/** Read the EXIF Orientation tag (1–8) from a JPEG buffer, or 1 if absent. Phone cameras
 * store pixels in the sensor's native orientation plus this tag; viewers rotate on display,
 * but `jpeg-js` returns the raw grid, so we must apply it ourselves. */
export function readExifOrientation(buf: Buffer): number {
  for (let i = 2; i + 4 < buf.length && buf[i] === 0xff; ) {
    const marker = buf[i + 1]!
    const len = (buf[i + 2]! << 8) | buf[i + 3]!
    if (marker === 0xda || marker === 0xd9) break // start-of-scan / end — no more metadata
    if (marker === 0xe1 && buf.toString("ascii", i + 4, i + 8) === "Exif") {
      const tiff = i + 10
      const le = buf.toString("ascii", tiff, tiff + 2) === "II"
      const u16 = (p: number) => (le ? buf.readUInt16LE(p) : buf.readUInt16BE(p))
      const u32 = (p: number) => (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p))
      const ifd = tiff + u32(tiff + 4)
      const n = u16(ifd)
      for (let e = 0; e < n; e++) {
        const ent = ifd + 2 + e * 12
        if (u16(ent) === 0x0112) return u16(ent + 8) // Orientation tag
      }
      return 1
    }
    i += 2 + len
  }
  return 1
}

/** Reorient RGBA pixels per an EXIF orientation (1–8). Dimensions swap for 5–8. */
export function applyOrientation(img: RgbaImage, o: number): RgbaImage {
  if (o <= 1 || o > 8) return img
  const { width: W, height: H, data } = img
  const swap = o >= 5
  const dW = swap ? H : W
  const dH = swap ? W : H
  const out = new Uint8Array(dW * dH * 4)
  for (let dy = 0; dy < dH; dy++) {
    for (let dx = 0; dx < dW; dx++) {
      let sx: number, sy: number
      // prettier-ignore
      switch (o) {
        case 2: sx = W - 1 - dx; sy = dy; break            // mirror horizontal
        case 3: sx = W - 1 - dx; sy = H - 1 - dy; break    // 180°
        case 4: sx = dx; sy = H - 1 - dy; break            // mirror vertical
        case 5: sx = dy; sy = dx; break                    // transpose
        case 6: sx = dy; sy = H - 1 - dx; break            // 90° CW
        case 7: sx = W - 1 - dy; sy = H - 1 - dx; break    // transverse
        case 8: sx = W - 1 - dy; sy = dx; break            // 90° CCW
        default: sx = dx; sy = dy
      }
      const s = (sy * W + sx) * 4
      const d = (dy * dW + dx) * 4
      out[d] = data[s]!
      out[d + 1] = data[s + 1]!
      out[d + 2] = data[s + 2]!
      out[d + 3] = data[s + 3]!
    }
  }
  return { width: dW, height: dH, data: out }
}

/** Decode a JPEG buffer to RGBA, applying EXIF orientation. `tolerantDecoding` copes with
 * slightly-off phone JPEGs, and the resolution/memory caps are raised for high-megapixel
 * captures. */
export function decodeJpeg(buf: Buffer): RgbaImage {
  const img = jpeg.decode(buf, {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: true,
    maxResolutionInMP: 200,
    maxMemoryUsageInMB: 1024,
  })
  return applyOrientation({ width: img.width, height: img.height, data: img.data }, readExifOrientation(buf))
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

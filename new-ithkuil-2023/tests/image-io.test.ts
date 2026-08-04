/**
 * Image decode/encode. The EXIF-orientation path matters specifically for real-scan input:
 * phone JPEGs are stored in the sensor's orientation with a tag saying how to rotate them,
 * and `jpeg-js` hands back the raw grid — so if this is wrong, a phone capture arrives
 * sideways and the whole pipeline is decoding a rotated page.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import * as jpeg from "jpeg-js"
import {
  applyOrientation,
  cropRgba,
  decodeImage,
  decodePng,
  encodePng,
  readExifOrientation,
  renderSegmentationOverlay,
  type RgbaImage,
} from "../src/image-io.js"
import { segment, type Bitmap } from "../src/segment.js"

/** An image whose every pixel encodes its own coordinates, so rotations are checkable. */
function coordImage(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = x
      data[i + 1] = y
      data[i + 2] = 0
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

const pixelAt = (img: RgbaImage, x: number, y: number) => {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1]]
}

/** A JPEG-shaped buffer carrying just an APP1/Exif segment with an Orientation tag. */
function exifJpeg(orientation: number, littleEndian = true): Buffer {
  const tiff = Buffer.alloc(26)
  tiff.write(littleEndian ? "II" : "MM", 0, "ascii")
  const u16 = (off: number, v: number) => (littleEndian ? tiff.writeUInt16LE(v, off) : tiff.writeUInt16BE(v, off))
  const u32 = (off: number, v: number) => (littleEndian ? tiff.writeUInt32LE(v, off) : tiff.writeUInt32BE(v, off))
  u16(2, 42) // TIFF magic
  u32(4, 8) // offset of IFD0, from the start of the TIFF header
  u16(8, 1) // one entry
  u16(10, 0x0112) // tag: Orientation
  u16(12, 3) // type: SHORT
  u32(14, 1) // count
  u16(18, orientation) // value, inline
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff])
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff])
  return Buffer.concat([header, payload])
}

test("PNG encode → decode is lossless", () => {
  const src = coordImage(7, 5)
  const round = decodePng(encodePng(src))
  assert.equal(round.width, 7)
  assert.equal(round.height, 5)
  assert.deepEqual([...round.data], [...src.data])
})

test("decodeImage dispatches on magic bytes, not the file extension", () => {
  const png = encodePng(coordImage(3, 3))
  assert.equal(decodeImage(png).width, 3, "PNG signature → PNG decoder")
  assert.throws(() => decodeImage(Buffer.from("not an image")), "neither signature → a clear error")
})

test("decodeImage reads a JPEG — the format a phone actually produces", () => {
  // The decode endpoint used to call the PNG decoder directly, so a camera capture was
  // rejected by the web tool even though the scan pipeline handles JPEG end to end.
  const src = coordImage(32, 16)
  const jpegBuf = Buffer.from(jpeg.encode({ data: Buffer.from(src.data), width: 32, height: 16 }, 90).data)
  assert.deepEqual([...jpegBuf.subarray(0, 3)], [0xff, 0xd8, 0xff], "it really is a JPEG")

  const out = decodeImage(jpegBuf)
  assert.equal(out.width, 32)
  assert.equal(out.height, 16)
  // Lossy, so compare loosely: the coordinate ramp must still be a ramp.
  const red = (x: number, y: number) => out.data[(y * 32 + x) * 4]!
  assert.ok(Math.abs(red(4, 8) - 4) < 12, `left edge ≈ 4, got ${red(4, 8)}`)
  assert.ok(red(28, 8) > red(4, 8) + 15, "and it still increases to the right")
})

test("readExifOrientation reads both TIFF byte orders, and defaults to 1", () => {
  assert.equal(readExifOrientation(exifJpeg(6)), 6, "little-endian (II)")
  assert.equal(readExifOrientation(exifJpeg(8, false)), 8, "big-endian (MM)")
  assert.equal(readExifOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00])), 1, "no Exif segment")
})

test("applyOrientation 6 rotates a phone capture 90° clockwise", () => {
  // Orientation 6 is what a phone held upright writes, and the case the scan loop hits.
  const src = coordImage(4, 3) // pixel (x, y) carries [x, y]
  const out = applyOrientation(src, 6)
  assert.equal(out.width, 3, "dimensions swap")
  assert.equal(out.height, 4)
  // Under a 90° CW rotation the source's bottom-left corner becomes the top-left.
  assert.deepEqual(pixelAt(out, 0, 0), [0, 2], "src (0, H-1) → dst (0, 0)")
  assert.deepEqual(pixelAt(out, 2, 0), [0, 0], "src (0, 0) → dst (W-1, 0)")
  assert.deepEqual(pixelAt(out, 0, 3), [3, 2], "src (W-1, H-1) → dst (0, H-1)")
})

test("applyOrientation is identity for 1 and for out-of-range tags", () => {
  const src = coordImage(3, 2)
  assert.equal(applyOrientation(src, 1), src, "no copy for the common case")
  assert.equal(applyOrientation(src, 0), src)
  assert.equal(applyOrientation(src, 99), src)
})

test("each orientation is undone by its inverse", () => {
  const src = coordImage(5, 3)
  // 2/4/5/7 are their own inverse (a mirror or a transpose); 3 too (180°); 6 and 8 pair up.
  const inverse: Record<number, number> = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 8, 7: 7, 8: 6 }
  for (const [o, inv] of Object.entries(inverse)) {
    const round = applyOrientation(applyOrientation(src, Number(o)), inv)
    assert.equal(round.width, src.width, `orientation ${o}: width restored`)
    assert.equal(round.height, src.height, `orientation ${o}: height restored`)
    assert.deepEqual([...round.data], [...src.data], `orientation ${o} then ${inv} is identity`)
  }
})

test("cropRgba pads out-of-bounds area with white", () => {
  const src = coordImage(4, 4)
  const crop = cropRgba(src, { x: -1, y: -1, w: 3, h: 3 })
  assert.equal(crop.width, 3)
  assert.deepEqual([...crop.data.slice(0, 4)], [255, 255, 255, 255], "outside the image is white")
  assert.deepEqual(pixelAt(crop, 1, 1), [0, 0], "inside is the source pixel")
})

test("the segmentation overlay draws boxes without touching the source image", () => {
  const width = 12
  const height = 6
  const ink = new Uint8Array(width * height)
  for (let y = 2; y < 4; y++) for (let x = 2; x < 5; x++) ink[y * width + x] = 1
  const bmp: Bitmap = { width, height, ink }

  const src = coordImage(width, height)
  const before = [...src.data]
  const overlay = renderSegmentationOverlay(src, segment(bmp, { minPixels: 1 }))

  assert.deepEqual([...src.data], before, "source is not mutated")
  assert.notDeepEqual([...overlay.data], before, "overlay differs")
  // The character box is magenta (210, 60, 190) — drawn at the region's top-left corner.
  const i = (2 * width + 2) * 4
  assert.deepEqual([overlay.data[i], overlay.data[i + 1], overlay.data[i + 2]], [40, 180, 70], "base box is green")
})

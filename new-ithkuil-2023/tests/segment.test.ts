/**
 * Segmentation — the first stage of the reverse pipeline. These tests use hand-built
 * bitmaps rather than rendered glyphs so a failure names the algorithm, not the renderer.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { binarize, flatFieldBinarize, connectedComponents, segment, type Bitmap } from "../src/segment.js"

/** Build a bitmap from an ASCII art block: '#' is ink, anything else is background. */
function bitmapOf(rows: string[]): Bitmap {
  const height = rows.length
  const width = rows[0]!.length
  const ink = new Uint8Array(width * height)
  rows.forEach((row, y) => {
    assert.equal(row.length, width, "ragged ascii-art row")
    ;[...row].forEach((ch, x) => (ink[y * width + x] = ch === "#" ? 1 : 0))
  })
  return { width, height, ink }
}

/** Grey RGBA canvas with an optional per-pixel value function. */
function rgbaOf(width: number, height: number, value: (x: number, y: number) => number): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = value(x, y)
      const i = (y * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return data
}

test("binarize marks pixels darker than the threshold as ink", () => {
  // Not tested at exactly 128: the luminance weights sum to 1 only to within floating
  // point, so a mid-grey lands a hair either side of the cut. Nothing depends on it.
  const rgba = rgbaOf(4, 1, (x) => [0, 120, 136, 255][x]!)
  const bmp = binarize(rgba, 4, 1)
  assert.deepEqual([...bmp.ink], [1, 1, 0, 0])
})

test("binarize weights channels by luminance, not by mean", () => {
  // Pure blue is dark by luminance (0.114 * 255 = 29) but a channel mean would call it 85.
  const blue = new Uint8Array([0, 0, 255, 255])
  const green = new Uint8Array([0, 255, 0, 255]) // 0.587 * 255 = 150 → not ink
  assert.equal(binarize(blue, 1, 1).ink[0], 1)
  assert.equal(binarize(green, 1, 1).ink[0], 0)
})

test("connected components use 8-connectivity", () => {
  // Two pixels touching only at a corner are ONE component under 8-connectivity.
  const diagonal = bitmapOf(["#.", ".#"])
  assert.equal(connectedComponents(diagonal).length, 1)

  const apart = bitmapOf(["#..#"])
  assert.equal(connectedComponents(apart).length, 2)
})

test("connected components report the tight bounding box and pixel count", () => {
  const bmp = bitmapOf([
    "....",
    ".##.",
    ".##.",
    "....",
  ])
  const [c] = connectedComponents(bmp)
  assert.deepEqual(c!.bbox, { x: 1, y: 1, w: 2, h: 2 })
  assert.equal(c!.pixels, 4)
})

test("connected components drop specks below minPixels", () => {
  const bmp = bitmapOf(["#...", "...#", "..##"])
  assert.equal(connectedComponents(bmp, 1).length, 2)
  assert.equal(connectedComponents(bmp, 2).length, 1, "the single-pixel speck is dropped")
})

test("segment groups vertically-stacked marks into one character by x-overlap", () => {
  // A base with a superposed dot above it and an underposed dot below — one character —
  // then a clearly separated second base.
  const bmp = bitmapOf([
    ".#.......",
    ".........",
    "###....##",
    "###....##",
    ".........",
    ".#.......",
  ])
  const regions = segment(bmp, { minPixels: 1 })
  assert.equal(regions.length, 2, "two characters")

  const [first, second] = regions
  assert.equal(first!.components.length, 3, "base + superposed + underposed")
  assert.deepEqual(first!.base, { x: 0, y: 2, w: 3, h: 2 }, "base is the largest component")
  assert.deepEqual(first!.bbox, { x: 0, y: 0, w: 3, h: 6 }, "region box spans the diacritics")
  assert.deepEqual(
    first!.components.map((c) => c.role).sort(),
    ["base", "superposed", "underposed"],
    "roles are assigned by vertical position relative to the base",
  )
  assert.equal(second!.components.length, 1)
  assert.equal(second!.index, 1, "regions are indexed left to right")
})

test("segment tags a mark to the right of the base as right-posed", () => {
  const bmp = bitmapOf([
    "###.#",
    "###..",
  ])
  const [region] = segment(bmp, { minPixels: 1, xMergeTolerance: 2 })
  const right = region!.components.find((c) => c.role === "right")
  assert.ok(right, "expected a right-posed component")
  assert.equal(right!.bbox.x, 4)
})

test("flat-field binarization recovers ink a global threshold loses under a gradient", () => {
  // A page lit from the left: background ramps 20 → 250. The glyph is always 60 darker
  // than its local paper, so it is visible everywhere to a human — and invisible to a
  // single global cut, which either floods the dark side or drops the bright side.
  const W = 120
  const H = 60
  const paper = (x: number) => 20 + Math.round((x / (W - 1)) * 230)
  const isGlyph = (x: number, y: number) => y >= 25 && y < 35 && ((x >= 10 && x < 20) || (x >= 100 && x < 110))
  const rgba = rgbaOf(W, H, (x, y) => Math.max(0, paper(x) - (isGlyph(x, y) ? 60 : 0)))

  const inkAt = (bmp: { ink: Uint8Array }, x: number, y: number) => bmp.ink[y * W + x] === 1
  const global = binarize(rgba, W, H)
  const flat = flatFieldBinarize(rgba, W, H)

  // The global cut cannot separate the two: the bright-side glyph (190) is far above any
  // threshold that also excludes the dark-side paper (20).
  assert.ok(inkAt(global, 105, 30) === false, "global threshold loses the glyph on the bright side")
  assert.ok(inkAt(global, 50, 30) === true, "…while calling mid-gradient paper ink")

  assert.ok(inkAt(flat, 15, 30), "flat field keeps the dark-side glyph")
  assert.ok(inkAt(flat, 105, 30), "flat field recovers the bright-side glyph")
  assert.ok(!inkAt(flat, 50, 30), "flat field levels the paper to background")
  assert.ok(!inkAt(flat, 60, 5), "…everywhere, not just near the glyphs")
})

test("flat-field binarization agrees with a global cut on evenly-lit input", () => {
  const W = 80
  const H = 40
  const isGlyph = (x: number, y: number) => x >= 30 && x < 50 && y >= 15 && y < 25
  const rgba = rgbaOf(W, H, (x, y) => (isGlyph(x, y) ? 30 : 245))
  const flat = flatFieldBinarize(rgba, W, H)
  const global = binarize(rgba, W, H)

  let same = 0
  for (let i = 0; i < W * H; i++) if (flat.ink[i] === global.ink[i]) same++
  // Not identical: levelling by a local mean thins the glyph's outermost ring, because
  // near an edge the "background" window is partly glyph. It must stay a boundary effect.
  assert.ok(same / (W * H) > 0.98, `${((100 * same) / (W * H)).toFixed(1)}% agreement`)
  assert.equal(flat.ink[20 * W + 40], 1, "glyph interior stays ink")
  assert.equal(flat.ink[5 * W + 5], 0, "far background stays background")
})

/**
 * Shape normalization + the Chamfer metric — the template-matching baseline the whole
 * reverse pipeline was built on top of, and still the fallback whenever a CNN is absent.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeMask, maskFromBitmap, type Mask } from "../src/normalize.js"
import { chamferSimilarity, distanceTransform, meanNearestDistance } from "../src/chamfer.js"
import type { Bitmap } from "../src/segment.js"

function bitmapOf(rows: string[]): Bitmap {
  const height = rows.length
  const width = rows[0]!.length
  const ink = new Uint8Array(width * height)
  rows.forEach((row, y) => [...row].forEach((ch, x) => (ink[y * width + x] = ch === "#" ? 1 : 0)))
  return { width, height, ink }
}

const inkCount = (m: Mask) => m.data.reduce((a, b) => a + b, 0)

test("normalizeMask crops to the ink and centres it in a square frame", () => {
  // The ink occupies rows 0–3 of an 8×8 canvas; cropping gives an 8×4 box, which is padded
  // to 8×8 and therefore lands two rows down — the long axis fills the frame, the short one
  // is centred.
  const bmp = bitmapOf([
    "########",
    "#.......",
    "#.......",
    "#.......",
    "........",
    "........",
    "........",
    "........",
  ])
  const mask = normalizeMask(bmp.ink, 8, 8, 8)
  assert.equal(mask.size, 8)
  const row = (y: number) => [...mask.data.slice(y * 8, y * 8 + 8)].join("")
  assert.equal(row(2), "11111111", "the horizontal bar spans the frame")
  assert.equal(row(0), "00000000", "vertical padding above")
  assert.equal(row(7), "00000000", "and below")
  assert.equal(inkCount(mask), 11)
})

test("normalizeMask makes the same shape at different scales and offsets identical", () => {
  const small = bitmapOf([
    "....",
    ".##.",
    ".#..",
    "....",
  ])
  const large = bitmapOf([
    "........",
    "........",
    "..####..",
    "..####..",
    "..##....",
    "..##....",
    "........",
    "........",
  ])
  assert.deepEqual(
    [...maskFromBitmap(small, 16).data],
    [...maskFromBitmap(large, 16).data],
    "normalization is scale- and translation-invariant",
  )
})

test("normalizeMask pads a non-square shape to a centred square", () => {
  // A 1×4 vertical bar must stay a bar in the middle of the frame, not stretch to fill it.
  const bar = bitmapOf(["#", "#", "#", "#"])
  const mask = maskFromBitmap(bar, 8)
  const columnsWithInk = new Set<number>()
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (mask.data[y * 8 + x]) columnsWithInk.add(x)
  assert.ok(columnsWithInk.size <= 3, `bar stays narrow (${columnsWithInk.size} columns)`)
  assert.ok(!columnsWithInk.has(0) && !columnsWithInk.has(7), "and is centred, not flush left")
})

test("an empty region normalizes to an empty mask instead of failing", () => {
  const mask = normalizeMask(new Uint8Array(16), 4, 4, 8)
  assert.equal(inkCount(mask), 0)
})

test("distanceTransform measures distance to the nearest ink, diagonals included", () => {
  const mask: Mask = { size: 5, data: new Uint8Array(25) }
  mask.data[2 * 5 + 2] = 1 // one ink pixel at the centre
  const dt = distanceTransform(mask)
  assert.equal(dt[2 * 5 + 2], 0)
  assert.equal(dt[2 * 5 + 3], 1, "orthogonal neighbour")
  assert.ok(Math.abs(dt[3 * 5 + 3]! - Math.SQRT2) < 1e-6, "diagonal neighbour")
  assert.ok(Math.abs(dt[0] - 2 * Math.SQRT2) < 1e-6, "corner, two diagonal steps away")
})

test("meanNearestDistance is zero for a shape against itself", () => {
  const mask = maskFromBitmap(bitmapOf(["##", "#."]), 8)
  assert.equal(meanNearestDistance(mask, distanceTransform(mask)), 0)
})

test("chamfer similarity is 1 for identical shapes and falls off as they diverge", () => {
  const l = maskFromBitmap(bitmapOf(["#...", "#...", "#...", "####"]), 32)
  const lAgain = maskFromBitmap(bitmapOf(["#...", "#...", "#...", "####"]), 32)
  const t = maskFromBitmap(bitmapOf(["####", ".#..", ".#..", ".#.."]), 32)

  assert.equal(chamferSimilarity(l, lAgain), 1)
  const cross = chamferSimilarity(l, t)
  assert.ok(cross > 0 && cross < 1, `different shapes score in (0,1): ${cross.toFixed(3)}`)
  assert.equal(chamferSimilarity(l, t), chamferSimilarity(t, l), "the metric is symmetric")
})

test("chamfer similarity tolerates stroke thickness — the reason it is used at all", () => {
  // The query is a scan (heavy strokes); the template is a clean vector glyph (light). An
  // overlap metric would punish that. Note normalization has already removed position and
  // scale, so what is being tested here is genuinely ink weight, not placement.
  const light = maskFromBitmap(
    bitmapOf(["#.....", "#.....", "#.....", "#.....", "#.....", "######"]),
    32,
  )
  const heavy = maskFromBitmap(
    bitmapOf(["##....", "##....", "##....", "##....", "######", "######"]),
    32,
  )
  const different = maskFromBitmap(
    bitmapOf(["######", "..#...", "..#...", "..#...", "..#...", "..#..."]),
    32,
  )
  const sameShape = chamferSimilarity(light, heavy)
  const otherShape = chamferSimilarity(light, different)
  assert.ok(sameShape > 0.5, `the same L drawn heavier still scores high: ${sameShape.toFixed(3)}`)
  assert.ok(
    sameShape > otherShape,
    `weight matters less than shape: L↔heavy L ${sameShape.toFixed(3)} > L↔T ${otherShape.toFixed(3)}`,
  )
})

test("chamfer similarity returns 0 when one shape has no ink", () => {
  const empty: Mask = { size: 8, data: new Uint8Array(64) }
  const shape = maskFromBitmap(bitmapOf(["##", "##"]), 8)
  assert.equal(chamferSimilarity(empty, shape), 0)
})

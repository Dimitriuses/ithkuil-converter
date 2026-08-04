/**
 * SVG path geometry — the shim that gives svgdom `isPointInFill` / `isPointInStroke`, which
 * is what unlocks @zsnout's compact (collision-kerned) layout under Node. If this is wrong
 * the kerning is wrong, and nothing throws.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { parsePath, pointInPolygons, distanceToPath } from "../src/path-geometry.js"

const SQUARE = "M 0 0 H 10 V 10 H 0 Z"

test("parsePath handles absolute M/H/V/L and closes on Z", () => {
  const subs = parsePath(SQUARE)
  assert.equal(subs.length, 1)
  assert.deepEqual(subs[0], [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ])
})

test("parsePath handles relative commands and repeated coordinate pairs", () => {
  // A bare "10 0" after an "l" repeats the command, per the SVG grammar.
  assert.deepEqual(parsePath("m 5 5 l 10 0 10 0"), [
    [
      [5, 5],
      [15, 5],
      [25, 5],
    ],
  ])
})

test("parsePath starts a new subpath at every M", () => {
  const subs = parsePath("M 0 0 L 5 0 M 20 0 L 25 0")
  assert.equal(subs.length, 2)
  assert.deepEqual(subs[1], [
    [20, 0],
    [25, 0],
  ])
})

test("parsePath flattens quadratic and cubic curves onto the curve", () => {
  const quad = parsePath("M 0 0 Q 10 20 20 0")[0]!
  assert.equal(quad.length, 11, "start point plus ten segments")
  assert.deepEqual(quad.at(-1), [20, 0], "ends at the on-curve point")
  // Apex of this quadratic is at t=0.5 → y = 10, x = 10.
  assert.deepEqual(quad[5], [10, 10])

  const cubic = parsePath("M 0 0 C 0 10 10 10 10 0")[0]!
  assert.deepEqual(cubic.at(-1), [10, 0])
  assert.ok(cubic.every(([, y]) => y >= 0 && y <= 7.5), "stays inside the control hull")
})

test("pointInPolygons is an even-odd test, so a hole reads as outside", () => {
  const ring = parsePath("M 0 0 H 20 V 20 H 0 Z M 5 5 H 15 V 15 H 5 Z")
  assert.equal(pointInPolygons(2, 10, ring), true, "between the outer and inner rings")
  assert.equal(pointInPolygons(10, 10, ring), false, "inside the hole")
  assert.equal(pointInPolygons(30, 10, ring), false, "outside everything")
})

test("distanceToPath measures to the outline, not to the interior", () => {
  const square = parsePath(SQUARE)
  assert.equal(distanceToPath(5, 0, square), 0, "on the edge")
  assert.equal(distanceToPath(-3, 5, square), 3, "outside, perpendicular to an edge")
  assert.equal(distanceToPath(5, 5, square), 5, "interior points are still 5 from the outline")
  assert.equal(distanceToPath(-3, -4, square), 5, "past a corner, measured to the corner")
})

test("an unsupported command is skipped rather than derailing the parse", () => {
  // Arcs never appear in @zsnout glyph data; the parser must not spin or throw if one does.
  const subs = parsePath("M 0 0 L 5 0 A 3 3 0 0 1 8 3 M 20 20 L 25 20")
  assert.ok(subs.length >= 2, "the subpath after the arc is still parsed")
  assert.deepEqual(subs.at(-1), [
    [20, 20],
    [25, 20],
  ])
})

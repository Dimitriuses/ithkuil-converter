/**
 * Printed-sheet geometry for the real-scan loop. Generator and ingester agree on these
 * constants by construction — but the sheet-id strip is read from a photograph, so its
 * layout has to survive being described twice (printed one way, located another).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  BIT_COUNT,
  BIT_SIZE,
  FIDUCIALS,
  FIDUCIAL_BOXES,
  GRID,
  H,
  MARGIN,
  W,
  WHITE_REF,
  WORDS_PER_SHEET,
  bitBox,
  sheetIdBits,
} from "../src/scan-layout.js"

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test("sheet ids round-trip through the bit strip, MSB first", () => {
  for (const id of [1, 2, 8, 37, 128, 255]) {
    const bits = sheetIdBits(id)
    assert.equal(bits.length, BIT_COUNT)
    const back = bits.reduce((acc, b) => (acc << 1) | b, 0)
    assert.equal(back, id, `sheet ${id}`)
  }
  assert.deepEqual(sheetIdBits(1).slice(0, 7), [0, 0, 0, 0, 0, 0, 0], "MSB first, so 1 is the last bit")
})

test("sheet numbering is 1-based so an all-blank strip means 'no strip'", () => {
  // A capture of a legacy sheet has no bits at all; that must not be read as sheet 0.
  assert.deepEqual(sheetIdBits(1).filter(Boolean).length > 0, true)
  assert.deepEqual(sheetIdBits(0), [0, 0, 0, 0, 0, 0, 0, 0], "id 0 is indistinguishable from blank — hence 1-based")
})

test("bit boxes are inside the top band, ordered, and never touch each other", () => {
  const boxes = Array.from({ length: BIT_COUNT }, (_, i) => bitBox(i))
  for (const [i, box] of boxes.entries()) {
    assert.ok(box.x >= MARGIN && box.x + box.w <= W - MARGIN, `bit ${i} is within the margins`)
    assert.ok(box.y >= MARGIN, `bit ${i} sits in the fiducial band`)
    assert.equal(box.w, BIT_SIZE)
    if (i > 0) assert.ok(box.x > boxes[i - 1]!.x + boxes[i - 1]!.w, `bit ${i} is clear of bit ${i - 1}`)
  }
})

test("the bit strip clears the corner fiducials", () => {
  for (const box of Array.from({ length: BIT_COUNT }, (_, i) => bitBox(i))) {
    for (const f of FIDUCIAL_BOXES) {
      assert.ok(!overlaps(box, { x: f.x, y: f.y, w: 150, h: 150 }), `bit box overlaps fiducial ${f.name}`)
    }
  }
})

test("the white reference is blank paper below the strip, not under a bit", () => {
  for (let i = 0; i < BIT_COUNT; i++) {
    assert.ok(!overlaps(WHITE_REF, bitBox(i)), `white reference overlaps bit ${i}`)
  }
  assert.ok(WHITE_REF.y > bitBox(0).y + BIT_SIZE, "it is below the strip")
  assert.ok(WHITE_REF.y + WHITE_REF.h < GRID.top, "and above the word grid")
})

test("exactly one fiducial is a ring, so orientation is unambiguous", () => {
  const rings = FIDUCIALS.filter((f) => f.ring)
  assert.equal(rings.length, 1)
  assert.equal(rings[0]!.name, "BR")
  // The four centres must be distinct in both axes, or a rotated capture cannot be matched.
  assert.equal(new Set(FIDUCIALS.map((f) => f.cx)).size, 2)
  assert.equal(new Set(FIDUCIALS.map((f) => f.cy)).size, 2)
})

test("the word grid fits inside the page between the fiducial rows", () => {
  assert.ok(GRID.top > MARGIN && GRID.bottom < H - MARGIN)
  assert.ok(GRID.left >= MARGIN && GRID.right <= W - MARGIN)
  assert.equal(WORDS_PER_SHEET, 30)
})

test("the canonical page is A4 at 300 dpi", () => {
  assert.ok(Math.abs(W / 300 - 8.27) < 0.02, "210 mm wide")
  assert.ok(Math.abs(H / 300 - 11.69) < 0.02, "297 mm tall")
})

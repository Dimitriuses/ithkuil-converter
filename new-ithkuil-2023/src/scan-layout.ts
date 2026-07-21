/**
 * Canonical sheet geometry, shared by the generator (scan-sheet.ts) and the ingester
 * (scan-ingest.ts). It lives in its own module for one specific reason: the ingester must read
 * a capture's SHEET ID before it can know which manifest to load, so the bit-strip geometry
 * cannot come from a manifest — it has to be a constant both sides agree on.
 *
 * Layout (A4 @ 300 dpi):
 *   - four corner fiducials; the bottom-right one is a RING (fixes orientation)
 *   - an 8-bit sheet-id strip across the top band: filled square = 1, blank = 0, MSB first.
 *     Sheet numbers are 1-based so at least one bit is always set (an all-blank strip means
 *     "no strip" — a legacy sheet — not "sheet 0").
 *   - a COLS×ROWS grid of word cells between the fiducial rows
 */
export const W = 2480
export const H = 3508
export const MARGIN = 120
export const F = 150 // fiducial side
export const GAP = 70 // gap between the fiducial rows and the content grid
export const COLS = 5
export const ROWS = 6
export const WORDS_PER_SHEET = COLS * ROWS
export const CELL_PAD = 30 // white padding inside each cell

/** Content-grid bounds. */
export const GRID = { left: MARGIN, right: W - MARGIN, top: MARGIN + F + GAP, bottom: H - MARGIN - F - GAP }
export const CELL_W = (GRID.right - GRID.left) / COLS
export const CELL_H = (GRID.bottom - GRID.top) / ROWS

/** Canonical fiducial squares (top-left corner of each). BR carries the orientation ring. */
export const FIDUCIAL_BOXES = [
  { name: "TL", x: MARGIN, y: MARGIN, ring: false },
  { name: "TR", x: W - MARGIN - F, y: MARGIN, ring: false },
  { name: "BL", x: MARGIN, y: H - MARGIN - F, ring: false },
  { name: "BR", x: W - MARGIN - F, y: H - MARGIN - F, ring: true },
] as const

/** Canonical fiducial centres — the deskew target. */
export const FIDUCIALS = FIDUCIAL_BOXES.map((f) => ({ name: f.name, cx: f.x + F / 2, cy: f.y + F / 2, ring: f.ring }))

// ── sheet-id bit strip ──────────────────────────────────────────────────────────
export const BIT_COUNT = 8 // 1..255 sheets
export const BIT_SIZE = 60
export const BIT_PITCH = 120
const STRIP_W = (BIT_COUNT - 1) * BIT_PITCH + BIT_SIZE
export const BIT_X0 = Math.round((W - STRIP_W) / 2)
export const BIT_Y = MARGIN + (F - BIT_SIZE) / 2

/** Canonical box of bit `i` (0 = most significant), in the top band between TL and TR. */
export function bitBox(i: number): { x: number; y: number; w: number; h: number } {
  return { x: BIT_X0 + i * BIT_PITCH, y: BIT_Y, w: BIT_SIZE, h: BIT_SIZE }
}

/** A guaranteed-blank strip just below the bits — the local white reference for reading them
 * (absolute thresholds fail under glare; a nearby paper sample tracks the local exposure). */
export const WHITE_REF = { x: BIT_X0, y: BIT_Y + BIT_SIZE + 20, w: STRIP_W, h: 40 }

/** Encode a 1-based sheet number as MSB-first bits. */
export function sheetIdBits(id: number): number[] {
  return Array.from({ length: BIT_COUNT }, (_, i) => (id >> (BIT_COUNT - 1 - i)) & 1)
}

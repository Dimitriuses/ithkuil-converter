/**
 * Scan-sheet generator — the print side of the real-scan (print-and-rescan) loop.
 *
 * We already have the forward path (`encode(text) → image`), so a real-scan dataset labels
 * itself: render a grid of KNOWN words, print it, scan/photograph it, and each captured cell
 * is paired with the text we told it to render. This emits one printable A4 page plus a
 * manifest (`scan-sheet.json`) describing the canonical geometry so `scan-ingest.ts` can
 * deskew a capture, crop each cell, and attach its label.
 *
 * Registration: four solid corner fiducials. The bottom-right one is a RING (square with a
 * white hole) so orientation is unambiguous even if the sheet is rotated 90/180°.
 *
 *   npm run scan-sheet            # → out/scan-sheet.png + out/scan-sheet.json
 */
import "./dom-shim.js"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng, savePng, type RgbaImage } from "./image-io.js"
import { sampleRootsOfLength } from "./lexicon.js"
import { writeFileSync, mkdirSync } from "node:fs"

// A4 at 300 dpi. Print at 100% / "actual size" (or fit-to-A4 — the aspect matches).
const W = 2480
const H = 3508
const MARGIN = 120
const F = 150 // fiducial side
const GAP = 70 // gap between the fiducial rows and the content grid
const COLS = 4
const ROWS = 4
const CELL_PAD = 44 // white padding inside each cell (glyph never touches the border)

// ── canvas helpers ────────────────────────────────────────────────────────────
function white(w: number, h: number): RgbaImage {
  const data = new Uint8Array(w * h * 4).fill(255)
  return { width: w, height: h, data }
}
function fillRect(img: RgbaImage, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = Math.max(0, y); yy < Math.min(img.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(img.width, x + w); xx++) {
      const i = (yy * img.width + xx) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
}
function borderRect(img: RgbaImage, x: number, y: number, w: number, h: number, v: number, t: number): void {
  fillRect(img, x, y, w, t, v)
  fillRect(img, x, y + h - t, w, t, v)
  fillRect(img, x, y, t, h, v)
  fillRect(img, x + w - t, y, t, h, v)
}
/** Alpha-composite `src` onto `dst` at (ox,oy) over the (white) background. */
function blit(dst: RgbaImage, src: RgbaImage, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = oy + y
    if (dy < 0 || dy >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const dx = ox + x
      if (dx < 0 || dx >= dst.width) continue
      const si = (y * src.width + x) * 4
      const di = (dy * dst.width + dx) * 4
      const a = src.data[si + 3]! / 255
      for (let c = 0; c < 3; c++) dst.data[di + c] = Math.round(src.data[si + c]! * a + dst.data[di + c]! * (1 - a))
    }
  }
}

// ── page ─────────────────────────────────────────────────────────────────────
const page = white(W, H)

// Fiducials — TL/TR/BL solid, BR a ring (orientation key).
const fid = [
  { name: "TL", x: MARGIN, y: MARGIN },
  { name: "TR", x: W - MARGIN - F, y: MARGIN },
  { name: "BL", x: MARGIN, y: H - MARGIN - F },
  { name: "BR", x: W - MARGIN - F, y: H - MARGIN - F, ring: true as const },
]
for (const f of fid) {
  fillRect(page, f.x, f.y, F, F, 0)
  if ("ring" in f) fillRect(page, f.x + F * 0.3, f.y + F * 0.3, F * 0.4, F * 0.4, 255)
}
const fiducials = fid.map((f) => ({ name: f.name, cx: f.x + F / 2, cy: f.y + F / 2, ring: "ring" in f }))

// Content grid, between the fiducial rows.
const L = MARGIN
const R = W - MARGIN
const T = MARGIN + F + GAP
const B = H - MARGIN - F - GAP
const cellW = (R - L) / COLS
const cellH = (B - T) / ROWS

// Words: a spread of real lexicon roots by length (the honest, hard distribution).
const words: { root: string; text: string }[] = []
for (const len of [2, 3, 4, 5]) {
  for (const root of sampleRootsOfLength(len, 4)) {
    try {
      words.push({ root, text: formativeToIthkuil({ root, type: "UNF/C" } as never) })
    } catch {
      /* skip */
    }
  }
}

interface Cell {
  index: number
  row: number
  col: number
  root: string
  text: string
  /** Canonical box of the actually-placed glyph (what the ingester crops after warping). */
  box: { x: number; y: number; w: number; h: number }
}
const cells: Cell[] = []

for (let i = 0; i < Math.min(words.length, COLS * ROWS); i++) {
  const row = Math.floor(i / COLS)
  const col = i % COLS
  const cx = L + col * cellW
  const cy = T + row * cellH
  borderRect(page, Math.round(cx), Math.round(cy), Math.round(cellW), Math.round(cellH), 205, 2)

  const boxW = cellW - 2 * CELL_PAD
  const boxH = cellH - 2 * CELL_PAD
  const r = encode(words[i]!.text, { margin: 10 })
  if (!r.ok) continue
  // Render to fit the box: width first, then shrink if too tall.
  let glyph = decodePng(svgToPng(r.svg, { width: Math.round(boxW) }))
  if (glyph.height > boxH) glyph = decodePng(svgToPng(r.svg, { width: Math.round((boxW * boxH) / glyph.height) }))
  const gx = Math.round(cx + CELL_PAD + (boxW - glyph.width) / 2)
  const gy = Math.round(cy + CELL_PAD + (boxH - glyph.height) / 2)
  blit(page, glyph, gx, gy)
  cells.push({ index: i, row, col, root: words[i]!.root, text: words[i]!.text, box: { x: gx, y: gy, w: glyph.width, h: glyph.height } })
}

mkdirSync("out", { recursive: true })
savePng("out/scan-sheet.png", page)
const manifest = {
  sheetId: `sheet-${Date.now()}`,
  canvas: { w: W, h: H, dpi: 300 },
  // Canonical fiducial centres define the deskew target; the ingester maps a capture's
  // detected fiducials onto these, then crops each cell's `box`.
  fiducials,
  cells,
}
writeFileSync("out/scan-sheet.json", JSON.stringify(manifest, null, 2))

console.log(`scan sheet → out/scan-sheet.png  (${cells.length} words, A4 300 dpi)`)
console.log(`manifest    → out/scan-sheet.json`)
console.log(`\nPrint at 100% (or fit-to-A4), then capture with the scanner and both phones.`)
console.log(`Keep the whole page in frame including all four corner marks; roughly upright is fine.`)

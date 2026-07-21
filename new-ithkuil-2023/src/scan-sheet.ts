/**
 * Scan-sheet generator — the print side of the real-scan (print-and-rescan) loop.
 *
 * We already have the forward path (`encode(text) → image`), so a real-scan dataset labels
 * itself: render a grid of KNOWN words, print it, scan/photograph it, and each captured cell
 * is paired with the text we told it to render. Emits N printable A4 pages plus a manifest per
 * sheet describing the canonical geometry, so `scan-ingest.ts` can deskew a capture, identify
 * WHICH sheet it is, crop each cell, and attach its label.
 *
 * Registration: four corner fiducials (BR is a ring → orientation is unambiguous) plus an
 * 8-bit sheet-id strip across the top — see scan-layout.ts. The strip matters because phone
 * captures arrive with meaningless auto-names (`20260716_185816.jpg`); without a self-describing
 * sheet a capture could be scored against the wrong manifest and silently corrupt every label.
 *
 * Word choice: sampled from the real lexicon WEIGHTED BY ROOT LENGTH (same distribution as
 * `lexicon-roundtrip`), so the real-scan number is directly comparable to the synthetic
 * benchmark. Roots are distinct across all sheets, and a coverage pass guarantees every
 * known-confusable letter appears at least once.
 *
 *   npm run scan-sheet -- [sheets]     # default 8 → out/sheets/sheet-01..08.{png,json}
 */
import "./dom-shim.js"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng, savePng, type RgbaImage } from "./image-io.js"
import { rootsOfLength, lengthShare, rootLengths } from "./lexicon.js"
import * as L from "./scan-layout.js"
import { writeFileSync, mkdirSync } from "node:fs"

const SHEETS = process.argv[2] ? Number(process.argv[2]) : 8

// Letters the secondary CNN actually confuses (held-out confusion analysis) — we guarantee
// each appears, so the dataset can show whether real imaging worsens these specifically.
const CONFUSABLE = ["v", "f", "b", "c", "d", "ḑ", "ļ", "š", "w", "x", "g", "t", "ţ", "z", "s"]

// Seeded RNG so a run is reproducible (a reprint must match the manifests already on disk).
let rng = 20260717 >>> 0
const rand = () => {
  rng = (rng + 0x6d2b79f5) | 0
  let t = Math.imul(rng ^ (rng >>> 15), 1 | rng)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
function shuffled<T>(a: readonly T[]): T[] {
  const out = a.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

// ── canvas helpers ────────────────────────────────────────────────────────────
function white(w: number, h: number): RgbaImage {
  return { width: w, height: h, data: new Uint8Array(w * h * 4).fill(255) }
}
function fillRect(img: RgbaImage, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = Math.max(0, Math.round(y)); yy < Math.min(img.height, Math.round(y + h)); yy++) {
    for (let xx = Math.max(0, Math.round(x)); xx < Math.min(img.width, Math.round(x + w)); xx++) {
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

// ── word selection: lexicon-weighted, distinct across sheets, confusable-covered ──
const TOTAL = SHEETS * L.WORDS_PER_SHEET

function selectRoots(total: number): string[] {
  // Allocate per-length quotas proportional to how common each root length actually is.
  const lens = rootLengths()
  const quota = new Map<number, number>()
  let assigned = 0
  for (const len of lens) {
    const q = Math.floor(total * lengthShare(len))
    quota.set(len, q)
    assigned += q
  }
  // Hand out the rounding remainder to the most common lengths first.
  for (const len of [...lens].sort((a, b) => lengthShare(b) - lengthShare(a))) {
    if (assigned >= total) break
    quota.set(len, (quota.get(len) ?? 0) + 1)
    assigned++
  }
  const picked: string[] = []
  const pools = new Map<number, string[]>()
  for (const len of lens) {
    const pool = shuffled(rootsOfLength(len))
    pools.set(len, pool)
    picked.push(...pool.slice(0, quota.get(len) ?? 0))
  }
  // Coverage pass: any confusable letter with zero occurrences gets a root swapped in.
  for (const ch of CONFUSABLE) {
    if (picked.some((r) => r.includes(ch))) continue
    const all = lens.flatMap((l) => pools.get(l)!)
    const cand = all.find((r) => r.includes(ch) && !picked.includes(r))
    if (!cand) continue
    // Replace a word that carries no confusable letter, so coverage only ever improves.
    const victim = picked.findIndex((r) => r.length === cand.length && !CONFUSABLE.some((c) => r.includes(c)))
    picked[victim >= 0 ? victim : picked.length - 1] = cand
  }
  return shuffled(picked)
}

interface Word {
  root: string
  text: string
}
const words: Word[] = []
for (const root of selectRoots(TOTAL)) {
  try {
    words.push({ root, text: formativeToIthkuil({ root, type: "UNF/C" } as never) })
  } catch {
    /* generator rejects this root — skip */
  }
}

// ── draw one sheet ────────────────────────────────────────────────────────────
interface Cell {
  index: number
  row: number
  col: number
  root: string
  text: string
  /** Canonical box of the actually-placed glyph (what the ingester crops after warping). */
  box: { x: number; y: number; w: number; h: number }
}

function renderSheet(sheetId: number, slice: Word[]): { page: RgbaImage; cells: Cell[] } {
  const page = white(L.W, L.H)
  for (const f of L.FIDUCIAL_BOXES) {
    fillRect(page, f.x, f.y, L.F, L.F, 0)
    if (f.ring) fillRect(page, f.x + L.F * 0.3, f.y + L.F * 0.3, L.F * 0.4, L.F * 0.4, 255)
  }
  // Sheet-id strip: filled square = 1, blank = 0, MSB first.
  L.sheetIdBits(sheetId).forEach((bit, i) => {
    if (!bit) return
    const b = L.bitBox(i)
    fillRect(page, b.x, b.y, b.w, b.h, 0)
  })

  const cells: Cell[] = []
  for (let i = 0; i < slice.length; i++) {
    const row = Math.floor(i / L.COLS)
    const col = i % L.COLS
    const cx = L.GRID.left + col * L.CELL_W
    const cy = L.GRID.top + row * L.CELL_H
    borderRect(page, cx, cy, L.CELL_W, L.CELL_H, 205, 2)

    const boxW = L.CELL_W - 2 * L.CELL_PAD
    const boxH = L.CELL_H - 2 * L.CELL_PAD
    const r = encode(slice[i]!.text, { margin: 10 })
    if (!r.ok) continue
    // Fit to the box: width first, then shrink if too tall.
    let glyph = decodePng(svgToPng(r.svg, { width: Math.round(boxW) }))
    if (glyph.height > boxH) glyph = decodePng(svgToPng(r.svg, { width: Math.round((boxW * boxH) / glyph.height) }))
    const gx = Math.round(cx + L.CELL_PAD + (boxW - glyph.width) / 2)
    const gy = Math.round(cy + L.CELL_PAD + (boxH - glyph.height) / 2)
    blit(page, glyph, gx, gy)
    cells.push({ index: i, row, col, root: slice[i]!.root, text: slice[i]!.text, box: { x: gx, y: gy, w: glyph.width, h: glyph.height } })
  }
  return { page, cells }
}

mkdirSync("out/sheets", { recursive: true })
const usedRoots: string[] = []
let written = 0
for (let s = 1; s <= SHEETS; s++) {
  const slice = words.slice((s - 1) * L.WORDS_PER_SHEET, s * L.WORDS_PER_SHEET)
  if (!slice.length) break
  const { page, cells } = renderSheet(s, slice)
  const tag = String(s).padStart(2, "0")
  savePng(`out/sheets/sheet-${tag}.png`, page)
  writeFileSync(
    `out/sheets/sheet-${tag}.json`,
    JSON.stringify(
      { sheetId: s, canvas: { w: L.W, h: L.H, dpi: 300 }, grid: { cols: L.COLS, rows: L.ROWS }, fiducials: L.FIDUCIALS, cells },
      null,
      2,
    ),
  )
  usedRoots.push(...cells.map((c) => c.root))
  written++
  console.log(`sheet ${tag}: ${cells.length} words → out/sheets/sheet-${tag}.{png,json}`)
}

// Report the distribution + confusable coverage so the dataset's shape is visible up front.
const byLen: Record<number, number> = {}
for (const r of usedRoots) byLen[r.length] = (byLen[r.length] ?? 0) + 1
const cov = CONFUSABLE.map((c) => `${c}:${usedRoots.filter((r) => r.includes(c)).length}`).join(" ")
console.log(`\n${written} sheets · ${usedRoots.length} distinct words (${L.WORDS_PER_SHEET}/sheet, ${L.COLS}×${L.ROWS})`)
console.log(`root-length mix: ${Object.entries(byLen).map(([l, n]) => `${l}c×${n}`).join("  ")}`)
console.log(`confusable coverage: ${cov}`)
console.log(`\nPrint all at 100% (or fit-to-A4), then capture each with the scanner and both phones.`)
console.log(`Keep all four corner marks in frame; rotation/perspective is fine (the ring + id strip handle it).`)

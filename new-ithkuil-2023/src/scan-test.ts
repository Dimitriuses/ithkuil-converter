/**
 * Scan-test — the first HONEST real-scan accuracy number.
 *
 * Deskews each real capture onto the sheet's canonical frame (scan-ingest), crops every cell
 * by its manifest box, decodes it with the deployed pipeline, and compares to the text we
 * printed. Labels are free (print-and-rescan), so this is a self-scoring benchmark of imaging
 * robustness — how much real scanner/phone noise, glare, and skew cost us vs. clean renders.
 *
 * Per-cell thresholding is flat-field + Otsu: real glyphs under glare survive as light grey,
 * and a global cut would erase them.
 *
 * Each capture identifies ITSELF: the deskewed page carries an 8-bit sheet-id strip, so a pile
 * of phone photos with auto-generated names is matched to the right manifest automatically —
 * no filename discipline, and no risk of scoring a capture against the wrong sheet's labels.
 * Captures with no strip fall back to the legacy single-sheet manifest.
 *
 *   npx tsx src/scan-test.ts export/*.jpg          # any number of captures, any sheets
 */
import "./dom-shim.js"
import { loadImage, cropRgba, type RgbaImage } from "./image-io.js"
import { flatFieldBinarize } from "./segment.js"
import { decodeWordToText, enableCoreCnn, enablePrimaryCnn, enableTopCnn, enableSecondaryCnn, enableAlphabeticCnn } from "./decode-word.js"
import { deskew, loadManifest, readSheetId, type Manifest } from "./scan-ingest.js"
import { readdirSync, existsSync } from "node:fs"

const SHEET_DIR = "out/sheets"
const CROP_MARGIN = 24 // white padding around each manifest box (deskew is not pixel-perfect)

function decodeCell(canon: RgbaImage, box: { x: number; y: number; w: number; h: number }): string {
  const crop = cropRgba(canon, {
    x: box.x - CROP_MARGIN,
    y: box.y - CROP_MARGIN,
    w: box.w + 2 * CROP_MARGIN,
    h: box.h + 2 * CROP_MARGIN,
  })
  // Flat-field + global Otsu: levels out glare so faint glyphs survive, with no penalty on
  // flat-lit captures (78.1% vs 76.6% for a plain global cut; adaptive local thresholding
  // regressed the clean scan by amplifying grain — see git history).
  const bmp = flatFieldBinarize(crop.data, crop.width, crop.height, 2)
  const { text } = decodeWordToText(bmp, crop)
  return text
}

const captures = process.argv.slice(2)
if (!captures.length) {
  console.log("usage: npx tsx src/scan-test.ts <capture.(jpg|png)> [more...]")
  process.exit(1)
}

await enableCoreCnn()
await enablePrimaryCnn()
await enableTopCnn()
await enableSecondaryCnn()
await enableAlphabeticCnn()

// Index every generated sheet by its id; fall back to the legacy single manifest.
const sheets = new Map<number, Manifest>()
if (existsSync(SHEET_DIR))
  for (const f of readdirSync(SHEET_DIR).filter((f) => f.endsWith(".json"))) {
    const m = loadManifest(`${SHEET_DIR}/${f}`)
    if (m.sheetId != null) sheets.set(m.sheetId, m)
  }
const legacy = existsSync("out/scan-sheet.json") ? loadManifest() : null
console.log(`\nreal-scan test — ${sheets.size} sheet manifest(s) indexed, ${captures.length} capture(s)\n`)

let grandOk = 0
let grandN = 0
const perSheet = new Map<string, { ok: number; n: number }>()
for (const cap of captures) {
  const name = cap.split(/[\\/]/).pop()!
  let canon: RgbaImage
  try {
    canon = deskew(loadImage(cap)) // shared layout — sheet not known yet
  } catch (e) {
    console.log(`${name}: DESKEW FAILED — ${(e as Error).message}\n`)
    continue
  }
  const id = readSheetId(canon)
  const man = (id != null ? sheets.get(id) : null) ?? legacy
  if (!man) {
    console.log(`${name}: sheet id ${id ?? "none"} — no matching manifest, skipped\n`)
    continue
  }
  let ok = 0
  const misses: string[] = []
  for (const cell of man.cells) {
    let got = ""
    try {
      got = decodeCell(canon, cell.box)
    } catch {
      got = "THREW"
    }
    if (got === cell.text) ok++
    else if (misses.length < 6) misses.push(`${cell.text}→${got || "∅"}`)
  }
  grandOk += ok
  grandN += man.cells.length
  const key = id != null ? `sheet ${id}` : "legacy"
  const acc = perSheet.get(key) ?? { ok: 0, n: 0 }
  perSheet.set(key, { ok: acc.ok + ok, n: acc.n + man.cells.length })
  console.log(`${name}  [${key}]:  ${ok}/${man.cells.length} = ${((100 * ok) / man.cells.length).toFixed(0)}%`)
  if (misses.length) console.log(`   e.g. ${misses.join("  ")}`)
  console.log()
}

for (const [k, v] of perSheet) console.log(`${k.padEnd(10)} ${v.ok}/${v.n} = ${((100 * v.ok) / v.n).toFixed(1)}%`)
console.log(`\nOVERALL real-scan round-trip: ${grandOk}/${grandN} = ${grandN ? ((100 * grandOk) / grandN).toFixed(1) : "0"}%`)

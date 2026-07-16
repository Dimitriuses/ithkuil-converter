/**
 * Scan-test — the first HONEST real-scan accuracy number.
 *
 * Deskews each real capture onto the sheet's canonical frame (scan-ingest), crops every cell
 * by its manifest box, decodes it with the deployed pipeline, and compares to the text we
 * printed. Labels are free (print-and-rescan), so this is a self-scoring benchmark of imaging
 * robustness — how much real scanner/phone noise, glare, and skew cost us vs. clean renders.
 *
 * Per-cell thresholding is Otsu (not the fixed 128 `binarize` default): real glyphs under
 * glare survive as light grey, and a global 128 would erase them.
 *
 *   npx tsx src/scan-test.ts export/Scan.jpg export/phone1.jpg ...   # any number of captures
 */
import "./dom-shim.js"
import { loadImage, cropRgba, type RgbaImage } from "./image-io.js"
import { binarize } from "./segment.js"
import { decodeWordToText, enableCoreCnn, enablePrimaryCnn, enableTopCnn, enableSecondaryCnn, enableAlphabeticCnn } from "./decode-word.js"
import { deskew, loadManifest, toGray, otsu } from "./scan-ingest.js"

const CROP_MARGIN = 24 // white padding around each manifest box (deskew is not pixel-perfect)

function decodeCell(canon: RgbaImage, box: { x: number; y: number; w: number; h: number }): string {
  const crop = cropRgba(canon, {
    x: box.x - CROP_MARGIN,
    y: box.y - CROP_MARGIN,
    w: box.w + 2 * CROP_MARGIN,
    h: box.h + 2 * CROP_MARGIN,
  })
  // Otsu on the crop, nudged so faint (glare) ink still falls below the threshold.
  const thr = Math.min(200, otsu(toGray(crop)) + 10)
  const bmp = binarize(crop.data, crop.width, crop.height, thr)
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

const man = loadManifest()
console.log(`\nreal-scan test — ${man.cells.length} cells/sheet, ${captures.length} capture(s)\n`)

let grandOk = 0
let grandN = 0
for (const cap of captures) {
  let canon: RgbaImage
  try {
    canon = deskew(loadImage(cap), man)
  } catch (e) {
    console.log(`${cap}: DESKEW FAILED — ${(e as Error).message}\n`)
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
  console.log(`${cap.split(/[\\/]/).pop()}:  ${ok}/${man.cells.length} = ${((100 * ok) / man.cells.length).toFixed(0)}%`)
  if (misses.length) console.log(`   e.g. ${misses.join("  ")}`)
  console.log()
}

console.log(`OVERALL real-scan round-trip: ${grandOk}/${grandN} = ${grandN ? ((100 * grandOk) / grandN).toFixed(1) : "0"}%`)

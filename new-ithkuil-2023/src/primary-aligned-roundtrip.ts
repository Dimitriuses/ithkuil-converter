/**
 * Primary zone-splitting with REAL-IMAGE ALIGNMENT.
 *
 * Simulates segmentation: renders each primary at a range of scales and offsets
 * (bbox-centred, like a segmenter crop), then decodes via decodePrimaryAligned —
 * which aligns the query into the canonical frame before zone-splitting. Tests
 * whether decoding survives arbitrary scale/position.
 *
 *   npm run primary-align-test
 */
import "./dom-shim.js"
import { Primary } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize } from "./segment.js"
import { decodePrimaryAligned } from "./primary.js"

const SPECIFICATIONS = ["BSC", "CTE", "CSV", "OBJ"]
const PERSPECTIVES = ["M", "G", "N", "A"]
const SCALES = [90, 120, 150] // simulate different segmentation scales

let total = 0
let ok = 0
let specOk = 0
let perspOk = 0
const misses: string[] = []

for (const specification of SPECIFICATIONS) {
  for (const perspective of PERSPECTIVES) {
    for (const canvas of SCALES) {
      // "segmented" query: primary rendered bbox-centred at this scale
      const img = decodePng(
        svgToPng(
          renderGlyphToSvg(Primary({ specification: specification as never, perspective: perspective as never }), {}, { canvas }),
          { width: canvas },
        ),
      )
      const got = decodePrimaryAligned(binarize(img.data, img.width, img.height))
      total++
      const sOk = got.specification === specification
      const pOk = got.perspective === perspective
      if (sOk) specOk++
      if (pOk) perspOk++
      if (sOk && pOk) ok++
      else misses.push(`${specification}/${perspective}@${canvas} → ${got.specification}/${got.perspective}`)
    }
  }
}

console.log(`primary aligned round-trip: ${ok}/${total} full = ${((100 * ok) / total).toFixed(1)}%`)
console.log(`  specification ${((100 * specOk) / total).toFixed(1)}%  ·  perspective ${((100 * perspOk) / total).toFixed(1)}%`)
if (misses.length) console.log(`  misses (${misses.length}): ${misses.slice(0, 12).join("  ")}`)

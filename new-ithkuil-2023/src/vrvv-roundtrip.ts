/**
 * Vr/Vv round-trip: the primary-feature CNN decodes context (Vr) and stem (Vv), which
 * template matching can't (they entangle in the primary under Ca co-variation). Renders
 * formatives with non-default context × stem, decodes via the full pipeline (CNN on),
 * and checks the romanization round-trips.
 *
 * function/version are intentionally NOT decoded yet — the current CNN mis-reads them
 * (confidently) on default-Ca minimal primaries, so they'd regress clean words; they
 * need a retrain with realistic (default-heavy) Ca sampling.
 *
 *   npm run vrvv-test
 */
import "./dom-shim.js"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize } from "./segment.js"
import { decodeWordToText, enableCoreCnn, enablePrimaryCnn } from "./decode-word.js"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"

await enableCoreCnn()
const primOn = await enablePrimaryCnn()

let ok = 0
let total = 0
const misses: string[] = []

for (const context of ["EXS", "FNC", "RPS", "AMG"]) {
  for (const stem of [1, 2, 3, 0]) {
    for (const specification of ["BSC", "OBJ"]) {
      const expected = formativeToIthkuil({ root: "l", type: "UNF/C", specification, context, stem } as never)
      const r = encode(expected, { margin: 10 })
      if (!r.ok) continue
      const img = decodePng(svgToPng(r.svg, { width: 500 }))
      const got = decodeWordToText(binarize(img.data, img.width, img.height), img).text
      total++
      if (got === expected) ok++
      else misses.push(`${expected} → ${got}`)
    }
  }
}

console.log(`Vr/Vv (context × stem) round-trip: ${ok}/${total} = ${((100 * ok) / total).toFixed(0)}%  (primary CNN ${primOn ? "on" : "off"})`)
if (misses.length) console.log(`  misses (${misses.length}): ${misses.join("  ")}`)

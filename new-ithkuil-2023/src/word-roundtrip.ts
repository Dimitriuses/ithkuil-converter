/**
 * Full composed-word round-trip: formative → text → image → decode → text.
 *
 * Uses formatives whose non-default features are exactly what the reverse pipeline
 * reads (root, specification, vn); every other slot defaults on both the forward
 * and reverse sides, so it regenerates identically (that's how elision is handled).
 *
 * ⚠️ SCOPE — this is a **feature-level regression gate, NOT an accuracy benchmark.** Its
 * roots are deliberately short and easy (`l`, `s`, `kt`, `sm`) so that a change to
 * specification / Vn / case / a CNN shows up in isolation, uncontaminated by root
 * difficulty. Its 48/48 says "the features it covers still work" — it does NOT say the
 * decoder reads real vocabulary: real @zsnout roots are mostly 3–5 consonants drawn from
 * the full inventory and score far lower. For the honest number use `npm run lexicon-test`
 * ([`lexicon-roundtrip.ts`](lexicon-roundtrip.ts)).
 *
 *   npm run word-test
 */
import "./dom-shim.js"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize } from "./segment.js"
import { decodeWordToText, enableCoreCnn, enablePrimaryCnn, enableTopCnn, enableSecondaryCnn } from "./decode-word.js"
import { gate } from "./harness.js"

const ROOTS = ["l", "s", "kt", "sm"] // single + cluster roots
const SPECIFICATIONS = ["BSC", "CTE", "CSV", "OBJ"]
const VNS = ["none", "PRL", "CPL"]

// Exercise both CNNs (on by default in the pipeline) so this guards against the CNN
// regressing clean full-word decoding.
const cnnOn = await enableCoreCnn()
const primOn = await enablePrimaryCnn()
const topOn = await enableTopCnn()
const secOn = await enableSecondaryCnn()

let total = 0
let ok = 0
const misses: string[] = []

for (const root of ROOTS) {
  for (const specification of SPECIFICATIONS) {
    for (const vn of VNS) {
      const F: Record<string, unknown> = { root, type: "UNF/C", specification }
      if (vn !== "none") F.vn = vn
      const expected = formativeToIthkuil(F as never)

      const r = encode(expected, { margin: 10 })
      if (!r.ok) throw new Error(`encode failed: ${r.reason}`)
      const img = decodePng(svgToPng(r.svg, { width: 700 }))
      const { text, features } = decodeWordToText(binarize(img.data, img.width, img.height), img)

      total++
      if (text === expected) ok++
      else misses.push(`"${expected}" → "${text}"  ${JSON.stringify(features)}`)
    }
  }
}

console.log(`composed word → text: ${ok}/${total} = ${((100 * ok) / total).toFixed(1)}%  (core CNN ${cnnOn ? "on" : "off"}, primary CNN ${primOn ? "on" : "off"}, top CNN ${topOn ? "on" : "off"})`)
if (misses.length) console.log(`  misses (${misses.length}):\n    ${misses.slice(0, 12).join("\n    ")}`)
else console.log("  every rendered formative decoded back to its exact romanization.")

gate("composed word → text", ok, total, 95)

/**
 * Case (Vc) decoding round-trip: text → script image → text, over all 68 cases.
 *
 * Case is drawn as superposed/underposed diacritics on the case-bearing secondary;
 * `case-vowel.ts` inverts the (shape, shape) → case mapping. Also spot-checks a
 * multi-consonant root to confirm the case lands on the right (last) secondary.
 *
 *   npm run case-test
 */
import "./dom-shim.js"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize } from "./segment.js"
import { decodeWordToText } from "./decode-word.js"
import { formativeToIthkuil, ALL_CASES } from "@zsnout/ithkuil/generate"

function roundTrip(formative: Record<string, unknown>): { expected: string; got: string } {
  const expected = formativeToIthkuil(formative as never)
  const r = encode(expected, { margin: 10 })
  if (!r.ok) return { expected, got: `ENCODE-FAIL(${r.reason})` }
  const img = decodePng(svgToPng(r.svg, { width: 400 }))
  const got = decodeWordToText(binarize(img.data, img.width, img.height)).text
  return { expected, got }
}

let ok = 0
let total = 0
const misses: string[] = []

// All 68 cases on a single-consonant root, plus a couple of multi-consonant spot checks.
const samples: Record<string, unknown>[] = [
  ...(ALL_CASES as readonly string[]).map((c) => ({ root: "l", type: "UNF/C", case: c })),
  { root: "kt", type: "UNF/C", case: "ERG" },
  { root: "s", type: "UNF/C", case: "DAT" },
]

for (const f of samples) {
  const { expected, got } = roundTrip(f)
  total++
  if (got === expected) ok++
  else misses.push(`${expected} → ${got}`)
}

console.log(`case round-trip: ${ok}/${total} = ${((100 * ok) / total).toFixed(1)}%`)
if (misses.length) console.log(`  misses (${misses.length}):\n    ${misses.slice(0, 15).join("\n    ")}`)

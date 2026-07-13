/**
 * Vr/Vv round-trip: the primary-feature CNN (80px) decodes the Vr context + function and
 * the Vv stem — which template matching can't (they entangle in the primary under Ca
 * co-variation). Renders formatives sweeping non-default context × function × stem,
 * decodes via the full pipeline (CNN on), and checks the romanization round-trips.
 *
 * version is only ~75% on clean primaries (its mark is subtler), so it's decoded only
 * when the CNN is very confident — swept separately to report its partial contribution.
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

function roundTrip(f: Record<string, unknown>): boolean | null {
  const expected = formativeToIthkuil(f as never)
  const r = encode(expected, { margin: 10 })
  if (!r.ok) return null
  const img = decodePng(svgToPng(r.svg, { width: 500 }))
  const got = decodeWordToText(binarize(img.data, img.width, img.height), img).text
  return got === expected
}

// (1) context × function × stem (the reliably-wired Vr/Vv)
let ok = 0
let n = 0
const misses: string[] = []
for (const context of ["EXS", "FNC", "RPS", "AMG"])
  for (const func of ["STA", "DYN"])
    for (const stem of [1, 2, 3, 0]) {
      const f = { root: "l", type: "UNF/C", specification: "BSC", context, function: func, stem }
      const res = roundTrip(f)
      if (res === null) continue
      n++
      if (res) ok++
      else misses.push(`ctx=${context} fn=${func} stem=${stem}`)
    }
console.log(`Vr/Vv (context × function × stem) round-trip: ${ok}/${n} = ${((100 * ok) / n).toFixed(0)}%  (primary CNN ${primOn ? "on" : "off"})`)
if (misses.length) console.log(`  misses (${misses.length}): ${misses.slice(0, 12).join("  ")}`)

// (2) version alone (guarded — reports how much it adds)
let vok = 0
let vn = 0
for (const version of ["PRC", "CPT"])
  for (const stem of [1, 2, 3]) {
    const res = roundTrip({ root: "l", type: "UNF/C", specification: "BSC", version, stem })
    if (res === null) continue
    vn++
    if (res) vok++
  }
console.log(`version × stem round-trip (version guarded): ${vok}/${vn} = ${((100 * vok) / vn).toFixed(0)}%`)

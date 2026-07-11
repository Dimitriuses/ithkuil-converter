/**
 * Primary zone-splitting round-trip.
 *
 * Renders Primary({ specification, perspective }) in the fixed frame, decodes it by
 * classifying positional zones, and checks both features are recovered.
 *
 *   npm run primary-test
 */
import { decodePrimaryFixed, renderFixed } from "./primary.js"

const SPECIFICATIONS = ["BSC", "CTE", "CSV", "OBJ"]
const PERSPECTIVES = ["M", "G", "N", "A"]

let total = 0
let ok = 0
let specOk = 0
let perspOk = 0
const misses: string[] = []

for (const specification of SPECIFICATIONS) {
  for (const perspective of PERSPECTIVES) {
    const bmp = renderFixed({ specification: specification as never, perspective: perspective as never })
    const got = decodePrimaryFixed(bmp)
    total++
    const sOk = got.specification === specification
    const pOk = got.perspective === perspective
    if (sOk) specOk++
    if (pOk) perspOk++
    if (sOk && pOk) ok++
    else misses.push(`${specification}/${perspective} → ${got.specification}/${got.perspective}`)
  }
}

console.log(`primary zone-split round-trip: ${ok}/${total} full = ${((100 * ok) / total).toFixed(1)}%`)
console.log(`  specification ${((100 * specOk) / total).toFixed(1)}%  ·  perspective ${((100 * perspOk) / total).toFixed(1)}%`)
if (misses.length) console.log(`  misses (${misses.length}): ${misses.join("  ")}`)

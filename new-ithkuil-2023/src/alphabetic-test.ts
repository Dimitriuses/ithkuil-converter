/**
 * Round-trip test for alphabetic-register decoding.
 *
 * We prefix each target word with a valid formative ("saläha") so @zsnout renders
 * the target in alphabetic mode (it can't parse a bare second formative), then
 * decode the phrase and check the alphabetic word came back verbatim.
 *
 *   npm run alphabetic
 */
import "./dom-shim.js"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize } from "./segment.js"
import { decodePhrase } from "./decode-word.js"

// A spread of CVCV / CV / VCV shapes exercising each slot (top/core/bottom/vowels).
const WORDS = [
  "mela", "kala", "tuni", "roba", "selu", "na", "pi", "alsi", "rana", "tila",
  "molu", "peka", "dina", "sula", "reno",
]

let ok = 0
let charOk = 0
let charTotal = 0
const misses: string[] = []

for (const word of WORDS) {
  const r = encode("saläha " + word, { margin: 10 })
  if (!r.ok) {
    misses.push(`${word}: ENCODE FAIL`)
    continue
  }
  const img = decodePng(svgToPng(r.svg, { width: 1000 }))
  const { words } = decodePhrase(binarize(img.data, img.width, img.height))
  const alpha = words.find((w) => w.kind === "alphabetic")
  const got = alpha?.text ?? "(none)"
  if (got === word) ok++
  else misses.push(`${word} → ${got}`)

  // char-level: longest-common alignment is overkill; compare position-by-position
  charTotal += word.length
  for (let i = 0; i < word.length; i++) if (got[i] === word[i]) charOk++
}

console.log(`alphabetic round-trip: ${ok}/${WORDS.length} exact = ${((100 * ok) / WORDS.length).toFixed(1)}%`)
console.log(`  char-level (positional): ${charOk}/${charTotal} = ${((100 * charOk) / charTotal).toFixed(1)}%`)
if (misses.length) console.log(`  misses:\n    ${misses.join("\n    ")}`)

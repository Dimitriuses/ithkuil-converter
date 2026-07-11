/**
 * Multi-formative phrase round-trip: formatives → phrase text → image → decode → text.
 *
 * Word boundaries are recovered structurally (each formative is primary-initial);
 * narrow inter-word separators are skipped. Tests running text, not just one word.
 *
 *   npm run phrase-test
 */
import "./dom-shim.js"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize } from "./segment.js"
import { decodePhrase } from "./decode-word.js"

// A small pool of formatives whose features the reverse pipeline models.
const POOL: Record<string, unknown>[] = [
  { root: "l", type: "UNF/C", specification: "OBJ" },
  { root: "s", type: "UNF/C", vn: "PRL" },
  { root: "m", type: "UNF/C", specification: "CSV" },
  { root: "r", type: "UNF/C" },
  { root: "kt", type: "UNF/C" },
  { root: "sm", type: "UNF/C", vn: "CPL" },
]

// Phrases: all adjacent pairs + a few triples.
const phrases: Record<string, unknown>[][] = []
for (let i = 0; i < POOL.length - 1; i++) phrases.push([POOL[i], POOL[i + 1]])
phrases.push([POOL[0], POOL[1], POOL[3]])
phrases.push([POOL[3], POOL[2], POOL[0]])

let total = 0
let ok = 0
let wordTotal = 0
let wordOk = 0
const misses: string[] = []

let skipped = 0
for (const formatives of phrases) {
  const words = formatives.map((f) => formativeToIthkuil(f as never))
  const expected = words.join(" ")

  const r = encode(expected, { margin: 10 })
  if (!r.ok) {
    // Some phrases need compact (collision) spacing to render, which svgdom can't
    // do (isPointInStroke) — the deferred M1 shim. Skip those here.
    skipped++
    continue
  }
  const img = decodePng(svgToPng(r.svg, { width: 300 * formatives.length }))
  const { text, words: got } = decodePhrase(binarize(img.data, img.width, img.height))

  total++
  if (text === expected) ok++
  else misses.push(`"${expected}" → "${text}"`)

  // per-word accuracy (aligns by index; also flags word-count mismatch)
  wordTotal += words.length
  for (let i = 0; i < words.length; i++) if (got[i]?.text === words[i]) wordOk++
}

console.log(`phrase → text: ${ok}/${total} exact = ${total ? ((100 * ok) / total).toFixed(1) : "—"}%  (${skipped} un-renderable phrases skipped)`)
console.log(`  per-word: ${wordOk}/${wordTotal} = ${wordTotal ? ((100 * wordOk) / wordTotal).toFixed(1) : "—"}%`)
if (misses.length) console.log(`  misses (${misses.length}):\n    ${misses.slice(0, 12).join("\n    ")}`)

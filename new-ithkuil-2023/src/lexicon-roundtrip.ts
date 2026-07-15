/**
 * Lexicon benchmark: round-trip real @zsnout roots, broken down by root length.
 *
 * This is the project's HONEST accuracy number. The other harnesses use hand-picked toy
 * roots and are feature-level gates, not benchmarks — `word-test` reports 48/48 = 100% on
 * roots like `l`/`kt`, while the real lexicon (dominated by 3–5 consonant roots from the
 * full inventory) scores far lower. Reports:
 *
 *   - per-length round-trip and the LEXICON-WEIGHTED total (weighted by how common each
 *     root length actually is, so the headline reflects real vocabulary);
 *   - the detected character-type shape (e.g. `ps` = primary+secondary), which exposes
 *     structural failures — 4–5 consonant roots pack into several secondaries and the
 *     extra ones currently mis-type (`psq`, `psp`);
 *   - crashes, counted rather than propagated.
 *
 * SAMPLE SIZE MATTERS: root difficulty varies a lot (which consonants a root uses), so the
 * default 25/length is a quick look only — two different 25-root samples of the same length
 * disagreed by ~3× in practice. Use ≥100/length when quoting or comparing a number.
 *
 *   npm run lexicon-test -- [perLength]     # default 25 (quick); use 100+ for a baseline
 */
import "./dom-shim.js"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize } from "./segment.js"
import { decodeWordToText, enableCoreCnn, enablePrimaryCnn, enableTopCnn, enableAlphabeticCnn } from "./decode-word.js"
import { sampleRootsOfLength, rootsOfLength, lengthShare, rootLengths, ROOT_FORMS } from "./lexicon.js"

const PER_LENGTH = process.argv[2] ? Number(process.argv[2]) : 25

// Warm the same CNNs the server uses, so this reflects the deployed pipeline.
await enableCoreCnn()
await enablePrimaryCnn()
await enableTopCnn()
await enableAlphabeticCnn()

console.log(`lexicon round-trip — ${ROOT_FORMS.length} roots, sampling ${PER_LENGTH} per length\n`)

let weighted = 0
let weightTotal = 0
for (const len of rootLengths()) {
  let ok = 0
  let n = 0
  let threw = 0
  const shapes: Record<string, number> = {}
  const misses: string[] = []

  for (const cr of sampleRootsOfLength(len, PER_LENGTH)) {
    let expected: string
    try {
      expected = formativeToIthkuil({ root: cr, type: "UNF/C" } as never)
    } catch {
      continue // root the generator won't accept — not a decoder failure
    }
    let r
    try {
      r = encode(expected, { margin: 10 })
    } catch {
      continue // forward path can throw on some inputs; not what we're measuring
    }
    if (!r.ok) continue
    const img = decodePng(svgToPng(r.svg, { width: 500 }))
    const bmp = binarize(img.data, img.width, img.height)
    n++
    try {
      const { text, characters } = decodeWordToText(bmp, img)
      const shape = characters.map((c) => c.type[0]).join("")
      shapes[shape] = (shapes[shape] ?? 0) + 1
      if (text === expected) ok++
      else if (misses.length < 3) misses.push(`${expected}→${text}`)
    } catch {
      threw++
      shapes.THREW = (shapes.THREW ?? 0) + 1
      if (misses.length < 3) misses.push(`${expected}→THREW`)
    }
  }
  if (!n) continue

  const share = lengthShare(len)
  weighted += (ok / n) * share
  weightTotal += share
  const shapeStr = Object.entries(shapes)
    .sort((a, b) => b[1] - a[1])
    .map(([s, c]) => `${s}×${c}`)
    .join(" ")
  console.log(
    `${len}-consonant  ${String(rootsOfLength(len).length).padStart(4)} roots (${(100 * share).toFixed(0)}% of lexicon)` +
      `   ${String(ok).padStart(2)}/${n} = ${((100 * ok) / n).toFixed(0)}%${threw ? `   [${threw} threw]` : ""}`,
  )
  console.log(`     char shapes: ${shapeStr}`)
  if (misses.length) console.log(`     e.g. ${misses.join("  ")}`)
}

const pct = weightTotal ? (100 * weighted) / weightTotal : 0
console.log(`\nLEXICON-WEIGHTED round-trip: ${pct.toFixed(1)}%`)
console.log(`  (weighted by how common each root length is — the honest real-vocabulary number)`)

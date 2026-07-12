/**
 * 3-consonant cluster (triconsonantal root) decode.
 *
 * A root C1-C2-C3 renders as one secondary: top:C1 + core:C2 + bottom:C3. The joint
 * templates read core+bottom; the top is read separately, conditioned on the decoded
 * core (secondary.ts). This checks:
 *   1. top+core+bottom recovery on triconsonantal bases;
 *   2. NO regression — bare and 2-consonant bases must not gain a spurious top;
 *   3. full word round-trip for a few triconsonantal roots.
 *
 *   npm run tricon-test
 */
import "./dom-shim.js"
import { Secondary } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment } from "./segment.js"
import { loadTemplates, partitionTemplates } from "./classify.js"
import { decodeSecondary } from "./secondary.js"
import { encode } from "./forward.js"
import { decodeWordToText } from "./decode-word.js"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"

const diac = partitionTemplates(loadTemplates("dataset", 64)).diacritic

function decodeGlyph(spec: Record<string, unknown>) {
  const img = decodePng(svgToPng(renderGlyphToSvg(Secondary(spec as never), {}, { canvas: 128 }), { width: 128 }))
  const bmp = binarize(img.data, img.width, img.height)
  return decodeSecondary(bmp, segment(bmp)[0], diac)
}

const cores = ["t", "l", "s", "k", "r", "p", "m", "d"]
const tops = ["s", "m", "k", "p", "r", "n", "t", "l"]
const bottoms = ["r", "k", "t", "p", "n"]

// (1) 3-consonant recovery
let full = 0
let topOk = 0
let n = 0
for (const top of tops)
  for (const core of cores)
    for (const bottom of bottoms) {
      if (top === core || core === bottom) continue
      const d = decodeGlyph({ core, top, bottom })
      n++
      if (d.topExtension === top) topOk++
      if (d.topExtension === top && d.core === core && d.bottomExtension === bottom) full++
    }
console.log(`3-consonant: top ${((100 * topOk) / n).toFixed(0)}%  ·  full(top+core+bottom) ${((100 * full) / n).toFixed(0)}%  (n=${n})`)

// (2) no-regression: bare + 2-consonant must not gain a spurious top
let clean = 0
let cn = 0
for (const core of cores) {
  cn++
  if (!decodeGlyph({ core }).topExtension) clean++
  for (const bottom of bottoms) {
    if (core === bottom) continue
    cn++
    if (!decodeGlyph({ core, bottom }).topExtension) clean++
  }
}
console.log(`no spurious top on bare/2-consonant: ${clean}/${cn} = ${((100 * clean) / cn).toFixed(0)}%`)

// (3) full word round-trip for triconsonantal roots
let wr = 0
let wn = 0
const misses: string[] = []
for (const root of ["str", "mlk", "ksp", "prt", "ndr", "skr"]) {
  const exp = formativeToIthkuil({ root, type: "UNF/C" } as never)
  const r = encode(exp, { margin: 10 })
  if (!r.ok) continue
  const img = decodePng(svgToPng(r.svg, { width: 400 }))
  const got = decodeWordToText(binarize(img.data, img.width, img.height)).text
  wn++
  if (got === exp) wr++
  else misses.push(`${exp}→${got}`)
}
console.log(`triconsonantal word round-trip: ${wr}/${wn}${misses.length ? "  misses: " + misses.join("  ") : ""}`)

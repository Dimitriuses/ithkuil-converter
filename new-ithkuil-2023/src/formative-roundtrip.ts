/**
 * End-to-end decode → assemble → generate round-trip.
 *
 * For each formative, renders its feature-bearing characters, decodes each with
 * the reverse pipeline (secondary consonants → root, tertiary → vn, primary →
 * specification), assembles the decoded features, and routes them through
 * `@zsnout/ithkuil/generate`. Passes if the regenerated romanization equals the
 * original.
 *
 * Scope: characters are rendered individually (the per-character decoders are
 * validated in isolation). Pulling these characters out of a single *composed*
 * formative image — segmentation merging, cluster extensions, elision — is the
 * documented remaining gap; here we validate the decode→assemble→generate leg.
 *
 *   npm run formative-test
 */
import "./dom-shim.js"
import { Secondary, Tertiary } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment } from "./segment.js"
import { classifyRegionsDetailed, loadTemplates, partitionTemplates } from "./classify.js"
import { decodeTertiary } from "./tertiary.js"
import { decodePrimaryFixed, renderFixed } from "./primary.js"
import { featuresToText } from "./assemble.js"

const templates = loadTemplates("dataset", 64)
const diacriticTemplates = partitionTemplates(templates).diacritic

function bmpOf(el: SVGGraphicsElement) {
  const img = decodePng(svgToPng(renderGlyphToSvg(el, {}, { canvas: 128 }), { width: 128 }))
  return binarize(img.data, img.width, img.height)
}

/** Decode one secondary consonant character → its label. */
function decodeConsonant(core: string): string {
  const bmp = bmpOf(Secondary({ core: core as never }))
  return classifyRegionsDetailed(bmp, segment(bmp), templates, 64)[0].base.label
}
/** Decode a tertiary character → its valence. */
function decodeVn(valence: string): string {
  const bmp = bmpOf(Tertiary({ valence: valence as never }))
  return decodeTertiary(bmp, segment(bmp)[0], diacriticTemplates).valence
}
/** Decode a primary character (fixed frame) → its specification. */
function decodeSpec(specification: string): string {
  return decodePrimaryFixed(renderFixed({ specification: specification as never, perspective: "M" })).specification
}

const ROOTS = ["kt", "sm", "rl", "pn"]
const SPECIFICATIONS = ["BSC", "CTE", "CSV", "OBJ"]
const VNS = ["MNO", "PRL", "CRO", "CPL"]

let total = 0
let ok = 0
const misses: string[] = []

for (const root of ROOTS) {
  for (const specification of SPECIFICATIONS) {
    for (const vn of VNS) {
      const expected = featuresToText({ root, specification, vn })
      const decoded = {
        root: [...root].map(decodeConsonant).join(""),
        specification: decodeSpec(specification),
        vn: decodeVn(vn),
      }
      const got = featuresToText(decoded)
      total++
      if (got === expected) ok++
      else
        misses.push(
          `${root}/${specification}/${vn}: "${expected}" → "${got}" (root=${decoded.root} spec=${decoded.specification} vn=${decoded.vn})`,
        )
    }
  }
}

console.log(`formative decode→assemble→generate: ${ok}/${total} = ${((100 * ok) / total).toFixed(1)}%`)
if (misses.length) console.log(`  misses (${misses.length}):\n    ${misses.slice(0, 10).join("\n    ")}`)
else console.log("  every decoded formative regenerated the original romanization.")

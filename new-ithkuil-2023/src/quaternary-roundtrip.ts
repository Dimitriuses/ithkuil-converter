/**
 * Quaternary structural-decomposition round-trip.
 *
 * Renders Quaternary({ value, mood, caseScope }) with @zsnout, then runs
 * image → segment → decodeQuaternary and checks all three features are recovered.
 *
 *   npm run quaternary-test
 */
import "./dom-shim.js"
import { Quaternary } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment } from "./segment.js"
import { loadTemplates, partitionTemplates } from "./classify.js"
import { decodeQuaternary } from "./quaternary.js"

const ILLOCUTIONS = ["ASR", "DIR", "DEC", "IRG", "VRF", "ADM", "POT", "HOR", "CNJ"]
const MOODS = ["FAC", "SUB", "ASM", "SPC", "COU", "HYP"] // FAC = no diacritic
const CASE_SCOPES = ["CCN", "CCA", "CCS", "CCQ", "CCP", "CCV"] // CCN = no diacritic

const diacriticTemplates = partitionTemplates(loadTemplates("dataset", 64)).diacritic

function run(spec: { value?: string; mood?: string; caseScope?: string }) {
  const el = Quaternary(spec as never)
  const img = decodePng(svgToPng(renderGlyphToSvg(el, {}, { canvas: 128 }), { width: 128 }))
  const bmp = binarize(img.data, img.width, img.height)
  const regions = segment(bmp)
  if (regions.length !== 1) return { value: `∘${regions.length}regions`, mood: "?", caseScope: "?" }
  return decodeQuaternary(bmp, regions[0], diacriticTemplates)
}

let total = 0
let ok = 0
let valOk = 0
let moodOk = 0
let csOk = 0
const misses: string[] = []

// Sweep value (illocution), and a representative mood × case-scope grid.
for (const value of ILLOCUTIONS) {
  for (const mood of ["FAC", "SUB", "HYP"]) {
    for (const caseScope of ["CCN", "CCA", "CCV"]) {
      const exp = { value, mood, caseScope }
      const got = run(exp)
      total++
      const vOk = got.value === value
      const mOk = got.mood === mood
      const cOk = got.caseScope === caseScope
      if (vOk) valOk++
      if (mOk) moodOk++
      if (cOk) csOk++
      if (vOk && mOk && cOk) ok++
      else misses.push(`${value}/${mood}/${caseScope} → ${got.value}/${got.mood}/${got.caseScope}`)
    }
  }
}

console.log(`quaternary round-trip: ${ok}/${total} full = ${((100 * ok) / total).toFixed(1)}%`)
console.log(`  value ${((100 * valOk) / total).toFixed(1)}%  ·  mood ${((100 * moodOk) / total).toFixed(1)}%  ·  case-scope ${((100 * csOk) / total).toFixed(1)}%`)
if (misses.length) console.log(`  misses (${misses.length}):\n    ${misses.slice(0, 12).join("\n    ")}`)

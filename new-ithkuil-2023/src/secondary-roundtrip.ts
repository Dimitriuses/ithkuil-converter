/**
 * Secondary decoding round-trip: core + cluster extension + vowel.
 *
 * Renders Secondary({ core, bottom: ext, underposed: vowel }), then
 * segment → decodeSecondary, and checks each part is recovered. A biconsonantal
 * root's second consonant is a *bottom* extension; the sample mixes formerly in-set
 * (t/k/s) and formerly out-of-set (l/n/r/d/ç) extensions to exercise the broadened set.
 *
 *   npm run secondary-test
 */
import "./dom-shim.js"
import { Secondary } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment } from "./segment.js"
import { loadTemplates, partitionTemplates } from "./classify.js"
import { decodeSecondary } from "./secondary.js"
import { gate } from "./harness.js"

const diacriticTemplates = partitionTemplates(loadTemplates("dataset", 64)).diacritic

const CORES = ["k", "t", "s", "m", "r"]
const EXTS = ["∅", "t", "k", "s", "l", "n", "r", "d", "ç"] // none + in/out-of-former-set
const VOWELS = ["∅", "a", "i"] // none + underposed a/i

function run(spec: Record<string, unknown>) {
  const img = decodePng(svgToPng(renderGlyphToSvg(Secondary(spec as never), {}, { canvas: 128 }), { width: 128 }))
  const bmp = binarize(img.data, img.width, img.height)
  const regions = segment(bmp)
  return decodeSecondary(bmp, regions[0], diacriticTemplates)
}

let total = 0
let ok = 0
let coreOk = 0
let extOk = 0
let vowOk = 0
const misses: string[] = []

// Sweep core × top-extension × underposed vowel.
for (const core of CORES) {
  for (const ext of EXTS) {
    for (const vowel of VOWELS) {
      const spec: Record<string, unknown> = { core }
      if (ext !== "∅") spec.bottom = ext
      if (vowel !== "∅") spec.underposed = vowel
      const got = run(spec)
      total++
      const cOk = got.core === core
      const eOk = (got.bottomExtension ?? "∅") === ext
      const vOk = (got.underposedVowel ?? "∅") === vowel
      if (cOk) coreOk++
      if (eOk) extOk++
      if (vOk) vowOk++
      if (cOk && eOk && vOk) ok++
      else misses.push(`${core}/${ext}/${vowel} → ${got.core}/${got.bottomExtension ?? "∅"}/${got.underposedVowel ?? "∅"}`)
    }
  }
}

console.log(`secondary round-trip: ${ok}/${total} full = ${((100 * ok) / total).toFixed(1)}%`)
console.log(`  core ${((100 * coreOk) / total).toFixed(1)}%  ·  bottom-ext ${((100 * extOk) / total).toFixed(1)}%  ·  vowel ${((100 * vowOk) / total).toFixed(1)}%`)
if (misses.length) console.log(`  misses (${misses.length}):\n    ${misses.slice(0, 12).join("\n    ")}`)

gate("secondary", ok, total, 95)

/**
 * Validate the CNN wiring in decodeSecondary: on NOISY bare consonants, compare the
 * decoded core with template-only vs template+CNN. The CNN should win on the
 * near-identical pairs — the whole point of Milestone 9.
 *
 *   npm run secondary-cnn
 */
import "./dom-shim.js"
import { Secondary } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { augmentPixels } from "./augment-pixels.js"
import { binarize, segment } from "./segment.js"
import { loadTemplates, partitionTemplates } from "./classify.js"
import { decodeSecondary } from "./secondary.js"
import { loadCnnClassifier } from "./cnn-classify.js"
import { CONSONANTS } from "./glyph-classes.js"

const diacriticTemplates = partitionTemplates(loadTemplates("dataset", 64)).diacritic
const cnn = await loadCnnClassifier()

let rngState = 99 >>> 0
const rand = () => {
  rngState = (rngState + 0x6d2b79f5) | 0
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

let total = 0
let tmplOk = 0
let cnnOk = 0
const tmplConf: string[] = []
const cnnConf: string[] = []

for (const core of CONSONANTS) {
  for (let i = 0; i < 5; i++) {
    const svg = renderGlyphToSvg(Secondary({ core }), { rotateDeg: rand() * 16 - 8, scale: 0.9 + rand() * 0.2 }, { canvas: 64 })
    const img = decodePng(svgToPng(svg, { width: 64 }))
    augmentPixels(img, { noise: 12, blur: 1 }, rand) // same appearance noise as training
    const bmp = binarize(img.data, img.width, img.height)
    const region = segment(bmp)[0]
    if (!region) continue

    const t = decodeSecondary(bmp, region, diacriticTemplates)
    const c = decodeSecondary(bmp, region, diacriticTemplates, cnn, img) // img = grayscale source
    total++
    if (t.core === core) tmplOk++
    else tmplConf.push(`${core}→${t.core}`)
    if (c.core === core) cnnOk++
    else cnnConf.push(`${core}→${c.core}`)
  }
}

const pct = (n: number) => ((100 * n) / total).toFixed(1)
const tally = (a: string[]) =>
  [...a.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())]
    .sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => `${k}×${n}`).join("  ")

console.log(`noisy bare consonants (${total} samples):`)
console.log(`  template core: ${pct(tmplOk)}%`)
console.log(`  +CNN core:     ${pct(cnnOk)}%`)
if (tmplConf.length) console.log(`  template errors: ${tally(tmplConf)}`)
if (cnnConf.length) console.log(`  +CNN errors:     ${tally(cnnConf)}`)

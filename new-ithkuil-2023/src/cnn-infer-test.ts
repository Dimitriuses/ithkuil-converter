/**
 * Verify the persisted CNN loads and does inference: render each consonant (clean +
 * augmented), classify with the loaded model, and report accuracy. Proves the
 * save→load→infer round-trip works outside the training process.
 *
 *   npm run cnn-infer
 */
import "./dom-shim.js"
import { Secondary } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg, type Augment } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { CONSONANTS } from "./glyph-classes.js"
import { loadCnnClassifier } from "./cnn-classify.js"

const cnn = await loadCnnClassifier()
console.log(`loaded CNN: ${cnn.labels.length} classes, ${cnn.size}×${cnn.size} input`)

const AUGS: Augment[] = [{}, { rotateDeg: 9, scale: 1.1 }, { rotateDeg: -9, dx: 5 }]
let ok = 0
let total = 0
const misses: string[] = []

for (const core of CONSONANTS) {
  for (const aug of AUGS) {
    const img = decodePng(svgToPng(renderGlyphToSvg(Secondary({ core }), aug, { canvas: 64 }), { width: 64 }))
    const pred = cnn.classifyImage(img)
    total++
    if (pred.label === core) ok++
    else misses.push(`${core}→${pred.label}(${pred.score.toFixed(2)})`)
  }
}

console.log(`inference: ${ok}/${total} = ${((100 * ok) / total).toFixed(1)}%`)
if (misses.length) console.log(`  misses: ${misses.join("  ")}`)

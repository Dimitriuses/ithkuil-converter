/**
 * End-to-end reverse demo: image → segment → classify → per-character labels.
 *
 *   npm run recognize -- --text "Wattunkí ruyün"        # render, then recognize
 *   npm run recognize -- --image word.png               # recognize a real image
 *
 * NOTE: the template set is currently the 28 bare consonant cores, so only
 * secondary (consonant) characters classify with high confidence. Other character
 * types (primary/tertiary/quaternary) and consonants-with-extensions will score
 * low until their own templates are added — the score exposes that honestly.
 */
import { parseArgs } from "node:util"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng, loadPng } from "./image-io.js"
import { binarize, segment } from "./segment.js"
import { classifyRegions, loadTemplates } from "./classify.js"

const { values } = parseArgs({
  options: {
    text: { type: "string", short: "t" },
    image: { type: "string", short: "i" },
    dataset: { type: "string", short: "d" },
    width: { type: "string", short: "w" },
    size: { type: "string", short: "s" },
  },
})

if (!values.text && !values.image) {
  console.log(`Usage: npm run recognize -- (--text "…" | --image file.png) [--dataset dataset]`)
  process.exit(1)
}

const size = values.size ? Number(values.size) : 64
const img = values.image
  ? loadPng(values.image)
  : (() => {
      const r = encode(values.text!, { margin: 10 })
      if (!r.ok) throw new Error(`encode failed: ${r.reason}`)
      return decodePng(svgToPng(r.svg, { width: values.width ? Number(values.width) : 700 }))
    })()

const bmp = binarize(img.data, img.width, img.height)
const regions = segment(bmp)
const templates = loadTemplates(values.dataset ?? "dataset", size)
const results = classifyRegions(bmp, regions, templates, size)

console.log(`${img.width}×${img.height} → ${regions.length} characters (templates: ${templates.length} consonants)\n`)
for (let i = 0; i < results.length; i++) {
  const g = results[i]
  const conf = g.score >= 0.6 ? "  " : g.score >= 0.45 ? " ?" : " ??"
  const alts = g.candidates.map((c) => `${c.label}:${c.score.toFixed(2)}`).join("  ")
  console.log(`  #${i}${conf}  ${g.label.padEnd(3)} ${g.score.toFixed(2)}   [${alts}]`)
}
const line = results.map((g) => (g.score >= 0.45 ? g.label : "·")).join("")
console.log(`\npredicted (conf ≥ 0.45): ${line}`)

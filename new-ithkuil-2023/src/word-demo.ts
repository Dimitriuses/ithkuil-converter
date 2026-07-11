/**
 * Composed-word demo: render a formative, then read it back character-by-character.
 *
 *   npm run word -- --text "aktalo"
 *   npm run word -- --formative '{"root":"l","type":"UNF/C","specification":"OBJ"}'
 *   npm run word -- --image word.png
 */
import "./dom-shim.js"
import { parseArgs } from "node:util"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng, loadPng } from "./image-io.js"
import { binarize } from "./segment.js"
import { decodeWord } from "./decode-word.js"

const { values } = parseArgs({
  options: {
    text: { type: "string", short: "t" },
    formative: { type: "string", short: "f" },
    image: { type: "string", short: "i" },
    width: { type: "string", short: "w" },
  },
})

let text = values.text
if (values.formative) text = formativeToIthkuil(JSON.parse(values.formative))
if (!text && !values.image) {
  console.log(`Usage: npm run word -- (--text "…" | --formative '{…}' | --image f.png)`)
  process.exit(1)
}

const img = values.image
  ? loadPng(values.image)
  : (() => {
      const r = encode(text!, { margin: 10 })
      if (!r.ok) throw new Error(`encode failed: ${r.reason}`)
      return decodePng(svgToPng(r.svg, { width: values.width ? Number(values.width) : 700 }))
    })()

if (text) console.log(`text: ${text}`)
const bmp = binarize(img.data, img.width, img.height)
const chars = decodeWord(bmp)
console.log(`${chars.length} characters:`)
for (const c of chars) {
  console.log(`  #${c.index}  ${c.type.padEnd(10)} (${c.typeScore.toFixed(2)})  ${JSON.stringify(c.decoded)}`)
}

/**
 * Decoder round-trip test (scoped domain: secondary consonant + vowel diacritic).
 *
 * For a grid of consonant × vowel × position, render the character with @zsnout,
 * run image → segment → classify → decode, and check the decoded romanization
 * matches. Proves the reverse pipeline end-to-end on the parts we model.
 *
 *   npm run decode-test
 */
import "./dom-shim.js" // must precede the @zsnout import
import { Secondary } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment } from "./segment.js"
import { classifyRegionsDetailed, loadTemplates } from "./classify.js"
import { decodeGlyphs } from "./decode.js"
import { gate } from "./harness.js"

const CONSONANTS = ["k", "t", "s", "m", "p", "n", "r", "l", "č", "f", "x", "z"] as const
const VOWELS = ["a", "e", "i", "o", "u"] as const

const templates = loadTemplates("dataset", 64)

function roundtrip(core: string, vowel: string, position: "superposed" | "underposed"): string {
  const el = Secondary({ core: core as never, [position]: vowel } as never)
  const svg = renderGlyphToSvg(el, {}, { canvas: 128 })
  const img = decodePng(svgToPng(svg, { width: 128 }))
  const bmp = binarize(img.data, img.width, img.height)
  const glyphs = classifyRegionsDetailed(bmp, segment(bmp), templates, 64)
  return decodeGlyphs(glyphs).text.trim()
}

let total = 0
let ok = 0
const misses: string[] = []
for (const position of ["underposed", "superposed"] as const) {
  for (const c of CONSONANTS) {
    for (const v of VOWELS) {
      // underposed vowel follows: "cv"; superposed vowel precedes: "vc"
      const expected = position === "underposed" ? c + v : v + c
      const got = roundtrip(c, v, position)
      total++
      if (got === expected) ok++
      else misses.push(`${expected}→${got || "∅"}`)
    }
  }
}

console.log(`decode round-trip: ${ok}/${total} = ${((100 * ok) / total).toFixed(1)}%`)
if (misses.length) console.log(`misses (${misses.length}): ${misses.join("  ")}`)

gate("decode (consonant+vowel)", ok, total, 98)

/**
 * Tertiary structural-decomposition round-trip.
 *
 * Renders Tertiary({ valence, absoluteLevel, relativeLevel }) with @zsnout, then
 * runs image → segment → decodeTertiary and checks all three are recovered.
 *
 *   npm run tertiary-test
 */
import "./dom-shim.js"
import { Tertiary } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment } from "./segment.js"
import { loadTemplates, partitionTemplates } from "./classify.js"
import { decodeTertiary, VALENCES } from "./tertiary.js"
import { gate } from "./harness.js"

const LEVELS = ["MIN", "SBE", "IFR", "DFT", "EQU", "SUR", "SPL", "SPQ", "MAX"]

const diacriticTemplates = partitionTemplates(loadTemplates("dataset", 64)).diacritic

function run(spec: { valence?: string; absoluteLevel?: string; relativeLevel?: string }) {
  const img = decodePng(svgToPng(renderGlyphToSvg(Tertiary(spec as never), {}, { canvas: 128 }), { width: 128 }))
  const bmp = binarize(img.data, img.width, img.height)
  const regions = segment(bmp)
  if (regions.length !== 1) return { valence: `∘${regions.length}`, absoluteLevel: "?", relativeLevel: "?" }
  return decodeTertiary(bmp, regions[0], diacriticTemplates)
}

let total = 0
let ok = 0
let valOk = 0
let absOk = 0
let relOk = 0
const misses: string[] = []

// Sweep valence, and a representative absolute × relative level grid.
for (const valence of VALENCES) {
  for (const absoluteLevel of ["none", "MIN", "MAX"]) {
    for (const relativeLevel of ["none", "EQU", "SUR"]) {
      const spec: Record<string, string> = { valence }
      if (absoluteLevel !== "none") spec.absoluteLevel = absoluteLevel
      if (relativeLevel !== "none") spec.relativeLevel = relativeLevel
      const got = run(spec)
      total++
      const vOk = got.valence === valence
      const aOk = got.absoluteLevel === absoluteLevel
      const rOk = got.relativeLevel === relativeLevel
      if (vOk) valOk++
      if (aOk) absOk++
      if (rOk) relOk++
      if (vOk && aOk && rOk) ok++
      else misses.push(`${valence}/${absoluteLevel}/${relativeLevel} → ${got.valence}/${got.absoluteLevel}/${got.relativeLevel}`)
    }
  }
}

console.log(`tertiary round-trip: ${ok}/${total} full = ${((100 * ok) / total).toFixed(1)}%`)
console.log(`  valence ${((100 * valOk) / total).toFixed(1)}%  ·  absLevel ${((100 * absOk) / total).toFixed(1)}%  ·  relLevel ${((100 * relOk) / total).toFixed(1)}%`)
if (misses.length) console.log(`  misses (${misses.length}):\n    ${misses.slice(0, 12).join("\n    ")}`)

gate("tertiary", ok, total, 98)

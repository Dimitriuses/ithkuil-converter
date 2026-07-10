/**
 * Segmentation demo / debug tool.
 *
 *   npm run segment -- --text "Wattunkí ruyün" [--out out/seg.png] [--width 700]
 *   npm run segment -- --image path/to/word.png [--out out/seg.png]
 *
 * Renders (or loads) a word image, segments it into per-character regions, prints
 * a summary, and writes an overlay PNG (magenta = character box; green = base;
 * blue = superposed; orange = underposed; cyan = right-posed diacritic).
 */
import { parseArgs } from "node:util"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { binarize, segment } from "./segment.js"
import { decodePng, loadPng, renderSegmentationOverlay, savePng } from "./image-io.js"

function main(): number {
  const { values } = parseArgs({
    options: {
      text: { type: "string", short: "t" },
      image: { type: "string", short: "i" },
      out: { type: "string", short: "o" },
      width: { type: "string", short: "w" },
      help: { type: "boolean", short: "h" },
    },
  })
  if (values.help || (!values.text && !values.image)) {
    console.log(`Usage: npm run segment -- (--text "…" | --image file.png) [--out out/seg.png] [--width px]`)
    return values.help ? 0 : 1
  }

  const img = values.image
    ? loadPng(values.image)
    : (() => {
        const r = encode(values.text!, { margin: 10 })
        if (!r.ok) throw new Error(`encode failed: ${r.reason}`)
        return decodePng(svgToPng(r.svg, { width: values.width ? Number(values.width) : 700 }))
      })()

  const bmp = binarize(img.data, img.width, img.height)
  const regions = segment(bmp)

  console.log(`image ${img.width}×${img.height} → ${regions.length} characters`)
  for (const r of regions) {
    const parts = r.components
      .map((c) => c.role)
      .reduce<Record<string, number>>((m, role) => ((m[role] = (m[role] ?? 0) + 1), m), {})
    const desc = Object.entries(parts)
      .map(([role, n]) => (n > 1 ? `${role}×${n}` : role))
      .join(" + ")
    console.log(`  #${r.index}  box[${r.bbox.x},${r.bbox.y} ${r.bbox.w}×${r.bbox.h}]  ${desc}`)
  }

  const outPath = values.out ?? "out/segment-overlay.png"
  mkdirSync(dirname(outPath), { recursive: true })
  savePng(outPath, renderSegmentationOverlay(img, regions))
  console.log(`overlay → ${outPath}`)
  return 0
}

process.exit(main())

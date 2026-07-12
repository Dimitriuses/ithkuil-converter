/**
 * Geometric zone-splitting for Primary characters.
 *
 * A primary is ONE connected blob encoding many features. Unlike quaternary/
 * tertiary (separable diacritic components), a primary's features are baked into
 * the single shape — but in a *fixed coordinate frame* they localize to positions:
 * perspective at the left, specification in the central core, configuration at the
 * bottom-right, etc. (found by difference-imaging). So we decompose by cropping
 * fixed positional zones and template-matching each against zone references built
 * the same way.
 *
 * Pilot: specification (core) + perspective (left). Extends to the other zones by
 * adding their rectangles + value sets. Alignment of a real segmented primary to
 * the reference frame is future work (here we render in the frame directly).
 */
import { shimWindow } from "./dom-shim.js" // must precede @zsnout import
import { getBBox, Primary } from "@zsnout/ithkuil/script"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment, type BBox, type Bitmap } from "./segment.js"
import { cropInk, normalizeMask, type Mask } from "./normalize.js"
import { classifyMask, type Template } from "./classify.js"
import { distanceTransform, meanNearestDistance } from "./chamfer.js"
import { alignToFrame } from "./align.js"
import { encode } from "./forward.js"

const NS = "http://www.w3.org/2000/svg"
const CANVAS = 160
const ZONE_SIZE = 48

// Fixed frame from a neutral base primary, so every render aligns.
const BASE: Parameters<typeof Primary>[0] = { specification: "BSC", perspective: "M" }
const bb = getBBox(Primary(BASE)) as { x: number; y: number; width: number; height: number }
const M = 20
const VIEWBOX = `${bb.x - M} ${bb.y - M} ${bb.width + 2 * M} ${bb.height + 2 * M}`

/** Render a primary in the shared fixed frame → binary bitmap. */
export function renderFixed(spec: Parameters<typeof Primary>[0]): Bitmap {
  const svg = shimWindow.document.createElementNS(NS, "svg")
  svg.setAttribute("xmlns", NS)
  svg.setAttribute("viewBox", VIEWBOX)
  svg.setAttribute("width", String(CANVAS))
  svg.setAttribute("height", String(CANVAS))
  svg.appendChild(Primary(spec) as unknown as never)
  const img = decodePng(svgToPng(svg.outerHTML, { width: CANVAS }))
  return binarize(img.data, img.width, img.height)
}

function zoneMask(bmp: Bitmap, rect: BBox): Mask {
  const crop = cropInk(bmp, rect)
  return normalizeMask(crop.ink, crop.width, crop.height, ZONE_SIZE)
}
// Positional zones in the fixed CANVAS frame (from difference-imaging: perspective
// marks land in x[0..33] y[24..54], the specification core spans x[32..126]).
const ZONE_PERSPECTIVE: BBox = { x: 0, y: 18, w: 34, h: 44 }
const ZONE_CORE: BBox = { x: 32, y: 18, w: 98, h: 120 }

const PERSPECTIVES = ["M", "G", "N", "A"] as const
const SPECIFICATIONS = ["BSC", "CTE", "CSV", "OBJ"] as const

// Every perspective (incl. M, whose left zone is just the shared core stroke) gets
// a template; classification is by shape.
const perspTemplates: Template[] = PERSPECTIVES.map((p) => ({
  label: p,
  class: `persp-${p}`,
  mask: zoneMask(renderFixed({ ...BASE, perspective: p }), ZONE_PERSPECTIVE),
}))
const specTemplates: Template[] = SPECIFICATIONS.map((s) => ({
  label: s,
  class: `spec-${s}`,
  mask: zoneMask(renderFixed({ specification: s, perspective: "M" }), ZONE_CORE),
}))

export interface PrimaryDecode {
  specification: string
  perspective: string
}

/** Decode a primary rendered in the fixed frame by classifying its zones. */
export function decodePrimaryFixed(bmp: Bitmap): PrimaryDecode {
  return {
    perspective: classifyMask(zoneMask(bmp, ZONE_PERSPECTIVE), perspTemplates).label,
    specification: classifyMask(zoneMask(bmp, ZONE_CORE), specTemplates).label,
  }
}

// ── Aligned path: decode a *segmented* primary (arbitrary scale/position) ──────
//
// The primary encodes specification, perspective, AND nuisance Ca (configuration,
// affiliation, …) in one blob. With single-Ca templates a non-default-Ca primary
// mis-decodes badly (spec drifts to CTE; perspectives G/N read as M → spec 80% /
// persp 63%). Two fixes, each matched to how a feature lives in the glyph:
//   - build a specification × perspective × configuration GRID so a template with the
//     query's feature exists regardless of Ca (mirrors the type-detection grid); and
//   - read each feature with the metric it suits — perspective is a global left mark,
//     so a JOINT whole-shape match wins; specification is a subtle central detail, so
//     the isolated (aligned) CORE zone wins. Hybrid → spec 92% / persp 88% held-out.
//
// Templates are extracted the same way a query is: rendered in a word, segmented,
// and cropped — so both land in the same distribution.

const PRIMARY_CONFIGS = ["UPX", "MSS", "MSC", "DPX"]
const FRAME = 64

/** Stretch a bitmap box's ink into a FRAME×FRAME square — a Ca-independent whole-shape
 * normalization (matches how the perspective grid templates are framed). */
function frameSquare(bmp: Bitmap, box: BBox): Mask {
  const { ink, width, height } = cropInk(bmp, box)
  let minx = width, maxx = -1, miny = height, maxy = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ink[y * width + x]) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
      }
    }
  }
  const data = new Uint8Array(FRAME * FRAME)
  if (maxx < 0) return { size: FRAME, data }
  const w = maxx - minx + 1
  const h = maxy - miny + 1
  for (let ty = 0; ty < FRAME; ty++) {
    const sy = miny + Math.floor((ty * h) / FRAME)
    for (let tx = 0; tx < FRAME; tx++) {
      const sx = minx + Math.floor((tx * w) / FRAME)
      if (ink[sy * width + sx]) data[ty * FRAME + tx] = 1
    }
  }
  return { size: FRAME, data }
}

/** Copy a region's ink into its own bitmap (for the aligner). */
function cropRegionBitmap(bmp: Bitmap, box: BBox): Bitmap {
  const { ink, width, height } = cropInk(bmp, box)
  return { width, height, ink }
}

interface WholeTemplate {
  label: string
  mask: Mask
  dt: Float32Array
}

// Build the grid once (rendered as words, primary = leftmost region). Perspective
// gets whole-shape masks (+ distance transforms for the joint match); specification
// gets aligned core-zone masks.
const perspWhole: WholeTemplate[] = []
const specCore: Template[] = []
for (const spec of SPECIFICATIONS) {
  for (const persp of PERSPECTIVES) {
    for (const cfg of PRIMARY_CONFIGS) {
      const text = formativeToIthkuil({
        root: "l",
        type: "UNF/C",
        specification: spec as never,
        ca: { perspective: persp as never, configuration: cfg as never },
      })
      const r = encode(text, { margin: 10 })
      if (!r.ok) continue
      const img = decodePng(svgToPng(r.svg, { width: 500 }))
      const bmp = binarize(img.data, img.width, img.height)
      const region = segment(bmp)[0]
      if (!region) continue
      const whole = frameSquare(bmp, region.bbox)
      perspWhole.push({ label: persp, mask: whole, dt: distanceTransform(whole) })
      specCore.push({
        label: spec,
        class: `spec-${spec}`,
        mask: zoneMask(alignToFrame(cropRegionBitmap(bmp, region.bbox)), ZONE_CORE),
      })
    }
  }
}

/** Nearest whole-shape template by symmetric Chamfer distance (templates carry a
 * precomputed distance transform, so only the query's is computed). */
function matchWhole(query: Mask, templates: WholeTemplate[]): string {
  const qDt = distanceTransform(query)
  let best = templates[0]!
  let bestDist = Infinity
  for (const t of templates) {
    const d = 0.5 * (meanNearestDistance(query, t.dt) + meanNearestDistance(t.mask, qDt))
    if (d < bestDist) {
      bestDist = d
      best = t
    }
  }
  return best.label
}

/** Decode a segmented primary of unknown scale/position. */
export function decodePrimaryAligned(queryBmp: Bitmap): PrimaryDecode {
  const whole = frameSquare(queryBmp, { x: 0, y: 0, w: queryBmp.width, h: queryBmp.height })
  const core = zoneMask(alignToFrame(queryBmp), ZONE_CORE)
  return {
    perspective: matchWhole(whole, perspWhole),
    specification: classifyMask(core, specCore).label,
  }
}

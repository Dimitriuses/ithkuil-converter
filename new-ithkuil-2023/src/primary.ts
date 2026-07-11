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
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, type BBox, type Bitmap } from "./segment.js"
import { cropInk, normalizeMask, type Mask } from "./normalize.js"
import { classifyMask, type Template } from "./classify.js"
import { renderGlyphToSvg } from "./glyph-render.js"
import { alignToFrame } from "./align.js"

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
// Templates are built from natural-scale renders passed through alignToFrame — the
// exact same processing a real query gets, so both land in the canonical frame.

/** Natural-scale render (bbox-centred, like a segmented crop) → binary bitmap. */
function renderNatural(spec: Parameters<typeof Primary>[0], canvas = 120): Bitmap {
  const img = decodePng(svgToPng(renderGlyphToSvg(Primary(spec), {}, { canvas }), { width: canvas }))
  return binarize(img.data, img.width, img.height)
}

const perspTemplatesAligned: Template[] = PERSPECTIVES.map((p) => ({
  label: p,
  class: `persp-${p}`,
  mask: zoneMask(alignToFrame(renderNatural({ ...BASE, perspective: p })), ZONE_PERSPECTIVE),
}))
const specTemplatesAligned: Template[] = SPECIFICATIONS.map((s) => ({
  label: s,
  class: `spec-${s}`,
  mask: zoneMask(alignToFrame(renderNatural({ specification: s, perspective: "M" })), ZONE_CORE),
}))

/** Decode a segmented primary of unknown scale/position (aligns it first). */
export function decodePrimaryAligned(queryBmp: Bitmap): PrimaryDecode {
  const aligned = alignToFrame(queryBmp)
  return {
    perspective: classifyMask(zoneMask(aligned, ZONE_PERSPECTIVE), perspTemplatesAligned).label,
    specification: classifyMask(zoneMask(aligned, ZONE_CORE), specTemplatesAligned).label,
  }
}

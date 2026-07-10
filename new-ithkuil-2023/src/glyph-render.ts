/**
 * Render a single glyph element onto a fixed square canvas, with optional
 * geometric augmentation (scale / rotation / translation jitter).
 *
 * The augmentation is applied as an SVG transform, and the glyph is centred using
 * its own (un-transformed) bounding box — svgdom computes that reliably, and the
 * final rotate/scale is honoured by the rasterizer (resvg). Output is a standalone
 * SVG string with a fixed `0 0 canvas canvas` viewBox, so every sample rasterizes
 * to the same pixel dimensions — what a classifier wants.
 */
import { shimWindow } from "./dom-shim.js" // MUST precede the @zsnout import
import { getBBox } from "@zsnout/ithkuil/script"

const SVG_NS = "http://www.w3.org/2000/svg"

export interface Augment {
  /** Extra scale factor on top of the fit-to-canvas base scale. Default 1. */
  scale?: number
  /** Rotation in degrees. Default 0. */
  rotateDeg?: number
  /** Horizontal jitter in canvas px. Default 0. */
  dx?: number
  /** Vertical jitter in canvas px. Default 0. */
  dy?: number
}

export interface RenderOptions {
  /** Canvas size in SVG units (== output px when rasterized 1:1). Default 128. */
  canvas?: number
  /** Fraction of the canvas the glyph's larger side fills at scale 1. Default 0.72. */
  fill?: number
}

/**
 * @param el A freshly-built glyph element (e.g. from `Secondary(...)`). Consumed
 *   (re-parented) by this function — build a new one per render.
 */
export function renderGlyphToSvg(
  el: SVGGraphicsElement,
  aug: Augment = {},
  opts: RenderOptions = {},
): string {
  const canvas = opts.canvas ?? 128
  const fill = opts.fill ?? 0.72

  const box = getBBox(el) as { x: number; y: number; width: number; height: number }
  const glyphCx = box.x + box.width / 2
  const glyphCy = box.y + box.height / 2
  const baseScale = (fill * canvas) / Math.max(box.width, box.height || 1)
  const scale = baseScale * (aug.scale ?? 1)
  const cx = canvas / 2 + (aug.dx ?? 0)
  const cy = canvas / 2 + (aug.dy ?? 0)

  const doc = shimWindow.document
  const g = doc.createElementNS(SVG_NS, "g")
  // Order: move glyph centre to origin, scale, rotate, then place at canvas centre.
  g.setAttribute(
    "transform",
    `translate(${cx} ${cy}) rotate(${aug.rotateDeg ?? 0}) scale(${scale}) translate(${-glyphCx} ${-glyphCy})`,
  )
  g.appendChild(el)

  const svg = doc.createElementNS(SVG_NS, "svg")
  svg.setAttribute("xmlns", SVG_NS)
  svg.setAttribute("viewBox", `0 0 ${canvas} ${canvas}`)
  svg.setAttribute("width", String(canvas))
  svg.setAttribute("height", String(canvas))
  svg.appendChild(g)
  return svg.outerHTML
}

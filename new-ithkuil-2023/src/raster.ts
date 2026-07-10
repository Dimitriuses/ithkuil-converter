/**
 * SVG → PNG rasterizer (Milestone 3 core). Uses @resvg/resvg-js — a self-contained
 * SVG renderer with no browser/DOM dependency.
 */
import { Resvg } from "@resvg/resvg-js"

export interface RasterOptions {
  /** Output width in px; height scales to preserve aspect. Default: 800. */
  width?: number
  /** Background colour. Default: "white". Pass `undefined`/"transparent" for none. */
  background?: string
}

/** Render a standalone SVG string to a PNG buffer. */
export function svgToPng(svg: string, opts: RasterOptions = {}): Buffer {
  const resvg = new Resvg(svg, {
    background: opts.background ?? "white",
    fitTo: { mode: "width", value: opts.width ?? 800 },
  })
  return Buffer.from(resvg.render().asPng())
}

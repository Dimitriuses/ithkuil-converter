/**
 * Browser-like globals that `@zsnout/ithkuil/script` needs to run under Node.
 *
 * Import this module (for its side effects) BEFORE `@zsnout/ithkuil/script`. In
 * ESM, imports evaluate in source order, so placing this import first guarantees
 * the globals exist before the library module is evaluated.
 *
 * Why svgdom and not linkedom: the library composes characters using a real SVG
 * `getBBox()` computed from path geometry — linkedom does no geometry, svgdom does.
 * `createHTMLWindow()` (not the SVG-only window) is used because its `document`
 * has a `body`, which the library's getBBox/fitViewBox helpers require.
 */
import * as svgdom from "svgdom"

const window = svgdom.createHTMLWindow()

// Install once (idempotent — safe if imported from multiple modules).
const g = globalThis as Record<string, unknown>
if (!g.document) {
  g.window = window
  g.document = window.document
  const classes: Record<string, unknown> = {
    SVGElement: svgdom.SVGElement,
    SVGGraphicsElement: svgdom.SVGGraphicsElement,
    SVGSVGElement: svgdom.SVGSVGElement,
    SVGPathElement: svgdom.SVGPathElement,
    SVGTextContentElement: svgdom.SVGTextContentElement,
    // svgdom has no distinct `<g>` class (a `<g>` is a plain SVGGraphicsElement).
    // Mapping SVGGElement here makes the library's Translate bake offsets into
    // path coordinates — its intended, browser-tested branch.
    SVGGElement: svgdom.SVGGraphicsElement,
  }
  for (const [k, v] of Object.entries(classes)) g[k] = v
}

/** The svgdom window whose `document` should be used to create root SVG elements. */
export const shimWindow = window as unknown as {
  document: {
    createElementNS(ns: string, tag: string): SVGElementLike
  }
}

/** Minimal structural type for the svgdom SVG elements we touch. */
export interface SVGElementLike {
  setAttribute(name: string, value: string): void
  getAttribute(name: string): string | null
  appendChild(child: unknown): void
  querySelectorAll(sel: string): ArrayLike<unknown>
  outerHTML: string
}

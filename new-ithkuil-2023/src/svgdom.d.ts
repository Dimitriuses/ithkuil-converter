// Minimal ambient types for `svgdom` (ships no types). We only touch a small surface;
// see dom-shim.ts. Runtime resolution is handled by tsx/esbuild.
declare module "svgdom" {
  export function createHTMLWindow(): {
    document: Document
    [key: string]: unknown
  }
  export function createSVGWindow(): { document: Document; [key: string]: unknown }
  export const SVGElement: unknown
  export const SVGGraphicsElement: unknown
  export const SVGSVGElement: unknown
  export const SVGPathElement: unknown
  export const SVGTextContentElement: unknown
}

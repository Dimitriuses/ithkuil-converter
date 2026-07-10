/**
 * Milestone 1 — forward spike.
 *
 * Proves that @zsnout/ithkuil can render romanized New Ithkuil text to script
 * SVG in *Node* (no browser). The library's character composition (Anchor, Row,
 * fitViewBox) depends on a real SVG `getBBox()`, which a plain DOM shim like
 * linkedom does NOT provide. `svgdom` (from the svg.js project) does: it computes
 * bounding boxes analytically from path data, and its HTML window also exposes a
 * `document.body` (which the library's getBBox/fitViewBox helpers require).
 *
 * Run:  npm run spike            (renders the default sample)
 *       npm run spike -- "text"  (renders your own text)
 */
import * as svgdom from "svgdom"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// --- DOM shim: install globals BEFORE importing the script module ---------
const window = svgdom.createHTMLWindow()
const g = globalThis as any
g.window = window
g.document = window.document
// The library does `instanceof SVG*Element` on nodes. Provide the classes as globals.
// svgdom has no distinct SVGGElement (`<g>` is a plain SVGGraphicsElement), so map it there:
// that makes Translate take its intended branch (bake offsets into path `d` coords).
const classes: Record<string, unknown> = {
  SVGElement: svgdom.SVGElement,
  SVGGraphicsElement: svgdom.SVGGraphicsElement,
  SVGSVGElement: svgdom.SVGSVGElement,
  SVGPathElement: svgdom.SVGPathElement,
  SVGTextContentElement: svgdom.SVGTextContentElement,
  SVGGElement: svgdom.SVGGraphicsElement,
}
for (const [k, v] of Object.entries(classes)) g[k] = v

// Import AFTER globals exist (the JSX runtime + composition read `document` at call time).
const { Anchor, CharacterRow, fitViewBox, textToScript } = await import(
  "@zsnout/ithkuil/script"
)

const TEXT = process.argv[2] ?? "Wattunkí ruyün" // example from the @zsnout docs

const result = textToScript(TEXT)
if (!result.ok) {
  console.error(`✗ textToScript(${JSON.stringify(TEXT)}) failed: ${result.reason}`)
  process.exit(1)
}

const doc = window.document
const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg") as any
svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
// NOTE: compact:false. Compact row layout uses collision detection via SVG
// isPointInStroke/isPointInFill hit-testing, which svgdom doesn't implement.
// Non-compact uses bbox spacing (looser but correct). Compact mode in Node is a
// follow-up: shim those two methods on svgdom (point-in-path geometry).
svg.appendChild(
  Anchor({ at: "cc", children: CharacterRow({ children: result.value, compact: false }) }),
)
fitViewBox(svg, 20)

const svgString: string = svg.outerHTML
const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "../out/spike.svg")
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, svgString)

const pathCount: number = svg.querySelectorAll("path").length
console.log(`✓ rendered ${JSON.stringify(TEXT)}`)
console.log(`  viewBox : ${svg.getAttribute("viewBox")}`)
console.log(`  <path>  : ${pathCount}`)
console.log(`  bytes   : ${svgString.length}`)
console.log(`  written : ${outPath}`)

if (pathCount === 0 || !svg.getAttribute("viewBox")) {
  console.error("✗ suspicious output — expected real paths and a fitted viewBox")
  process.exit(1)
}

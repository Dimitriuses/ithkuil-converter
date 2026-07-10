/**
 * Forward pipeline: romanized New Ithkuil text → native script SVG.
 *
 * Thin, Node-friendly wrapper over `@zsnout/ithkuil/script`. See `dom-shim.ts`
 * for why svgdom is required and why this must be imported after it.
 */
import { shimWindow } from "./dom-shim.js" // MUST be first — installs DOM globals
import { Anchor, CharacterRow, fitViewBox, textToScript } from "@zsnout/ithkuil/script"

const SVG_NS = "http://www.w3.org/2000/svg"

export interface EncodeOptions {
  /**
   * Compact (collision-kerned) row layout. NOTE: not yet supported under Node —
   * it needs SVG isPointInStroke/isPointInFill hit-testing that svgdom lacks, so
   * `encode` returns `{ ok: false }` with an explanatory reason. Default: false.
   */
  compact?: boolean
  /** Margin (SVG units) added around the fitted viewBox. Default: 20. */
  margin?: number
  /** Fill colour applied to the root `<svg>` (inherited by glyph paths). Default: none (black). */
  fill?: string
}

export type EncodeResult =
  | { ok: true; svg: string; viewBox: string; pathCount: number }
  | { ok: false; reason: string }

/**
 * Render one line of romanized New Ithkuil to a standalone SVG string.
 *
 * @returns `{ ok: true, svg }` on success, or `{ ok: false, reason }` if the text
 *   fails to parse or the layout can't be produced (e.g. compact mode under Node).
 */
export function encode(text: string, opts: EncodeOptions = {}): EncodeResult {
  const parsed = textToScript(text)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }

  try {
    const svg = shimWindow.document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("xmlns", SVG_NS)
    if (opts.fill) svg.setAttribute("fill", opts.fill)

    const row = CharacterRow({ children: parsed.value, compact: opts.compact ?? false })
    svg.appendChild(Anchor({ at: "cc", children: row }))
    fitViewBox(svg as never, opts.margin ?? 20)

    return {
      ok: true,
      svg: svg.outerHTML,
      viewBox: svg.getAttribute("viewBox") ?? "",
      pathCount: svg.querySelectorAll("path").length,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      reason: opts.compact
        ? `compact layout is not supported under Node yet (needs isPointInStroke): ${reason}`
        : reason,
    }
  }
}

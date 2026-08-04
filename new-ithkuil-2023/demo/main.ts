/**
 * Browser entry point for the live demo (GitHub Pages).
 *
 * Only the FORWARD path runs here: `@zsnout/ithkuil/script` composes the script from
 * romanized text using the real DOM, so the demo needs no server and no `svgdom` shim.
 * That also means compact (collision-kerned) layout works in the browser for free —
 * under Node it needs the hit-testing shim in `src/dom-shim.ts`.
 *
 * The REVERSE path (script image → text) is deliberately absent: it needs the template
 * caches (~15 MB of Float32) and the tfjs-node CNNs, which is a local/Node story. The
 * page shows its measured results instead.
 */
import { Anchor, CharacterRow, fitViewBox, textToScript } from "@zsnout/ithkuil/script"

const SVG_NS = "http://www.w3.org/2000/svg"

export interface EncodeResult {
  ok: boolean
  svg?: string
  reason?: string
  pathCount?: number
  viewBox?: string
}

/** Render one line of romanized New Ithkuil to a standalone SVG string. */
export function encode(text: string, opts: { compact?: boolean; margin?: number } = {}): EncodeResult {
  const parsed = textToScript(text)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  try {
    const svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("xmlns", SVG_NS)
    const row = CharacterRow({ children: parsed.value, compact: opts.compact ?? false })
    svg.appendChild(Anchor({ at: "cc", children: row }))
    fitViewBox(svg, opts.margin ?? 20)
    return {
      ok: true,
      svg: svg.outerHTML,
      viewBox: svg.getAttribute("viewBox") ?? "",
      pathCount: svg.querySelectorAll("path").length,
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

// ── page wiring ────────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const input = $<HTMLTextAreaElement>("text")
const compact = $<HTMLInputElement>("compact")
const stage = $<HTMLDivElement>("stage")
const status = $<HTMLParagraphElement>("status")
const dlSvg = $<HTMLAnchorElement>("dl-svg")

let lastSvg = ""

function render(): void {
  const text = input.value.trim()
  if (!text) {
    stage.innerHTML = ""
    status.textContent = "Type some romanized New Ithkuil above."
    status.className = "status"
    dlSvg.classList.add("hidden")
    return
  }
  const t0 = performance.now()
  const result = encode(text, { compact: compact.checked })
  const ms = performance.now() - t0

  if (!result.ok) {
    stage.innerHTML = ""
    status.textContent = `✗ ${result.reason}`
    status.className = "status bad"
    dlSvg.classList.add("hidden")
    return
  }
  lastSvg = result.svg!
  stage.innerHTML = lastSvg
  // Let the SVG size itself to the stage rather than to its intrinsic units.
  const el = stage.querySelector("svg")
  if (el) {
    el.removeAttribute("width")
    el.removeAttribute("height")
    el.setAttribute("preserveAspectRatio", "xMidYMid meet")
  }
  const viewBox = (result.viewBox ?? "")
    .split(/\s+/)
    .map((n) => Number(n).toFixed(1))
    .join(" ")
  status.textContent = `${result.pathCount} paths · viewBox ${viewBox} · ${ms.toFixed(1)} ms`
  status.className = "status ok"

  dlSvg.href = URL.createObjectURL(new Blob([lastSvg], { type: "image/svg+xml" }))
  dlSvg.download = `${text.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) || "ithkuil"}.svg`
  dlSvg.classList.remove("hidden")
}

input.addEventListener("input", render)
compact.addEventListener("change", render)

for (const chip of document.querySelectorAll<HTMLButtonElement>("[data-sample]")) {
  chip.addEventListener("click", () => {
    input.value = chip.dataset.sample ?? ""
    render()
    input.focus()
  })
}

render()

// A hook so the smoke test can drive the page without scraping the canvas-free DOM.
declare global {
  interface Window {
    __ithkuilDemo: { encode: typeof encode; get svg(): string }
  }
}
Object.defineProperty(window, "__ithkuilDemo", {
  value: {
    encode,
    get svg() {
      return lastSvg
    },
  },
})

#!/usr/bin/env node
/**
 * Smoke test for the demo page, driven in headless Chromium.
 *
 *   npm run demo:build && npm run demo:smoke        # the local build in dist-demo/
 *   npm run demo:smoke -- --url https://…/repo/     # the DEPLOYED site
 *
 * The `--url` form is the one that matters after a deploy: a green Pages workflow and a 200
 * on index.html both say nothing about whether the assets resolve under the project
 * sub-path. Running the identical assertions against the live URL does.
 *
 * It serves the build under the SUB-PATH the build actually emitted (read back out of
 * `dist-demo/index.html`) rather than at `/`, because that is how GitHub Pages serves a
 * project site and a wrong `base` fails only there — the page still returns 200 while every
 * asset 404s. Any console error or failed request fails the run, so that cannot pass
 * silently. Whether the emitted base matches the *repo name* is asserted separately, in the
 * Pages workflow, where the repo name is known.
 *
 * The last check re-encodes the same words through the Node pipeline (`src/forward.ts`) and
 * compares path counts: the demo and the converter must agree, or one of them is broken.
 */
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, extname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { encode as nodeEncode } from "../src/forward.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(ROOT, "dist-demo")

const urlArg = process.argv.indexOf("--url")
const LIVE_URL = urlArg >= 0 ? process.argv[urlArg + 1] : process.env.DEMO_URL

let BASE = "/"
if (!LIVE_URL) {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error(`✗ ${DIST}/index.html not found — run: npm run demo:build`)
    process.exit(1)
  }
  // Serve under the base the build emitted, so the harness mirrors the deployed layout
  // whatever `base` was set to. (`/assets/…` ⇒ base `/`; `/repo/assets/…` ⇒ base `/repo/`.)
  const html = await readFile(join(DIST, "index.html"), "utf8")
  const emitted = html.match(/(?:src|href)="([^"]*)\/assets\//)
  BASE = `${emitted ? emitted[1] : ""}/`
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost")
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404).end("outside base path")
    return
  }
  let rel = url.pathname.slice(BASE.length) || "index.html"
  if (rel.endsWith("/")) rel += "index.html"
  const file = resolve(DIST, rel)
  // No path traversal out of the build directory.
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end("forbidden")
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(body)
  } catch {
    res.writeHead(404).end("not found")
  }
})

let pageUrl = LIVE_URL
if (!LIVE_URL) {
  const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)))
  pageUrl = `http://127.0.0.1:${port}${BASE}`
}

let pass = 0
let fail = 0
const check = (label, condition, detail = "") => {
  if (condition) {
    pass++
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

console.log(`\ndemo smoke — ${pageUrl}${LIVE_URL ? "  (deployed site)" : "  (local build)"}\n`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })

const consoleErrors = []
const failedRequests = []
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()))
page.on("pageerror", (e) => consoleErrors.push(String(e)))
page.on("requestfailed", (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ""}`))
page.on("response", (r) => r.status() >= 400 && failedRequests.push(`${r.url()} → HTTP ${r.status()}`))

const response = await page.goto(pageUrl, { waitUntil: "networkidle" })

check("page returns 200", response?.status() === 200, `HTTP ${response?.status()}`)
check("stylesheet + script resolved under the base path", failedRequests.length === 0, failedRequests.join(" | ") || "0 failed requests")
check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | ") || "clean")

// ── the default word renders ────────────────────────────────────────────────────
const initial = await page.evaluate(() => ({
  text: document.getElementById("text").value,
  paths: document.querySelectorAll("#stage svg path").length,
  status: document.getElementById("status").textContent,
}))
check("default word renders script", initial.paths > 0, `${initial.paths} paths for "${initial.text}"`)
check("status line reports the render", /paths · viewBox/.test(initial.status ?? ""), initial.status ?? "")

// ── sample chips swap the rendering ─────────────────────────────────────────────
await page.click('[data-sample="saläha"]')
const sample = await page.evaluate(() => ({
  text: document.getElementById("text").value,
  paths: document.querySelectorAll("#stage svg path").length,
}))
check("sample chip loads its word", sample.text === "saläha", `"${sample.text}"`)
check("sample renders a different character count", sample.paths > 0 && sample.paths !== initial.paths, `${sample.paths} paths`)

// ── compact layout (browser-only code path: needs SVG hit-testing) ──────────────
await page.fill("#text", "Wattunkí ruyün")
const viewBox = () => page.evaluate(() => document.querySelector("#stage svg")?.getAttribute("viewBox") ?? "")
const looseBox = await viewBox()
await page.check("#compact")
const compactBox = await viewBox()
const widthOf = (vb) => Number(vb.split(/\s+/)[2] ?? NaN)
check(
  "compact layout kerns the row tighter",
  widthOf(compactBox) < widthOf(looseBox),
  `${widthOf(looseBox).toFixed(0)} → ${widthOf(compactBox).toFixed(0)} units`,
)
await page.uncheck("#compact")

// ── unparseable input degrades gracefully ───────────────────────────────────────
await page.fill("#text", "qqqq")
const bad = await page.evaluate(() => ({
  status: document.getElementById("status").textContent,
  cls: document.getElementById("status").className,
  paths: document.querySelectorAll("#stage svg path").length,
}))
check("bad input reports a reason instead of throwing", bad.cls.includes("bad") && bad.paths === 0, bad.status ?? "")

// ── the download link is wired to the current render ────────────────────────────
await page.fill("#text", "saläha")
const dl = await page.evaluate(() => {
  const a = document.getElementById("dl-svg")
  return { hidden: a.classList.contains("hidden"), href: a.getAttribute("href"), name: a.getAttribute("download") }
})
check("SVG download is offered", !dl.hidden && dl.href.startsWith("blob:"), dl.name ?? "")

// ── the browser and Node renderers agree ────────────────────────────────────────
const WORDS = ["Wattunkí ruyün", "saläha", "aktäläha", "malëuţřait", "ušmal"]
const browserCounts = await page.evaluate((words) => words.map((w) => window.__ithkuilDemo.encode(w).pathCount), WORDS)
const nodeCounts = WORDS.map((w) => {
  const r = nodeEncode(w)
  return r.ok ? r.pathCount : -1
})
for (let i = 0; i < WORDS.length; i++) {
  check(
    `browser and Node agree on "${WORDS[i]}"`,
    browserCounts[i] === nodeCounts[i] && nodeCounts[i] > 0,
    `${browserCounts[i]} vs ${nodeCounts[i]} paths`,
  )
}

// ── the images the page references actually exist ───────────────────────────────
const images = await page.evaluate(() =>
  [...document.images].map((i) => ({ src: i.getAttribute("src"), w: i.naturalWidth, h: i.naturalHeight })),
)
for (const img of images) {
  check(`image loads: ${img.src}`, img.w > 0 && img.h > 0, `${img.w}×${img.h}`)
}

await browser.close()
if (!LIVE_URL) server.close()

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)

#!/usr/bin/env node
/**
 * Regenerate every image in `screenshots/` (repo root) by driving the real thing.
 *
 *   npm run screenshots            # all of them
 *   npm run screenshots -- hero    # just one section: hero | dataset | sheet | tool | demo
 *
 * Nothing here is mocked: the pipeline figure runs a genuine encode → rasterize → segment →
 * decode round trip and prints whatever the decoder actually returned, the tool captures are
 * a real `npm run serve` driven through its own UI, and the demo capture is the built
 * `dist-demo/`. That means this script doubles as an end-to-end check — if a panel looks
 * wrong, the pipeline is wrong.
 *
 * Requires the dataset and template caches (`npm run setup`). The decode step is slow on a
 * cold cache; that is the pipeline's real warm-up, not this script being slow.
 */
import { chromium } from "playwright"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { join, extname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url)) // new-ithkuil-2023/
const OUT = join(ROOT, "..", "screenshots")
const TMP = join(ROOT, "out", "screenshot-panels")

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const wants = (name) => only.length === 0 || only.includes(name)

await mkdir(OUT, { recursive: true })
await mkdir(TMP, { recursive: true })

const dataUrl = (buf) => `data:image/png;base64,${buf.toString("base64")}`
const log = (m) => console.log(`  ${m}`)

/** Screenshot a self-contained HTML string at a fixed width, cropped to its content. */
async function shootHtml(browser, html, file, { width = 1200, scale = 2 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: scale })
  await page.setContent(html, { waitUntil: "networkidle" })
  const target = (await page.$("#shot")) ?? page
  await target.screenshot({ path: join(OUT, file) })
  await page.close()
  log(`wrote screenshots/${file}`)
}

const PAGE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 "Segoe UI", system-ui, sans-serif; color: #1a1c1f; background: #fff; }
  #shot { padding: 26px; background: #fff; }
  .row { display: flex; align-items: stretch; gap: 14px; }
  .panel { flex: 1 1 0; border: 1px solid #dfe3e8; border-radius: 10px; padding: 14px; background: #fff;
           display: flex; flex-direction: column; min-width: 0; }
  .panel h3 { margin: 0 0 3px; font-size: 12px; letter-spacing: .07em; text-transform: uppercase; color: #8b93a1; font-weight: 700; }
  .panel .note { margin: 0 0 10px; font-size: 12px; color: #8b93a1; }
  .panel .body { flex: 1; display: flex; align-items: center; justify-content: center; }
  .panel img { max-width: 100%; }
  .word { font-family: ui-monospace, Consolas, monospace; font-size: 25px; font-weight: 600; color: #1a1c1f; word-break: break-word; text-align: center; }
  .arrow { align-self: center; color: #b9c0cb; font-size: 26px; flex: 0 0 auto; }
  .ok { color: #2b8a3e; }
  .cap { margin: 16px 2px 0; font-size: 13px; color: #6b7280; }
`

// ── 1. the hero: one real round trip, panel by panel ────────────────────────────
async function hero(browser) {
  const { encode } = await import("../src/forward.js")
  const { svgToPng } = await import("../src/raster.js")
  const { decodePng, encodePng, renderSegmentationOverlay } = await import("../src/image-io.js")
  const { binarize, segment } = await import("../src/segment.js")
  const decodeMod = await import("../src/decode-word.js")

  const TEXT = "aktäläha"
  log(`encoding "${TEXT}"…`)
  const enc = encode(TEXT, { margin: 12 })
  if (!enc.ok) throw new Error(`encode failed: ${enc.reason}`)
  const png = svgToPng(enc.svg, { width: 760 })
  const img = decodePng(png)

  const bmp = binarize(img.data, img.width, img.height)
  const regions = segment(bmp)
  const overlay = encodePng(renderSegmentationOverlay(img, regions))

  log("warming the decoder (template caches)…")
  await decodeMod.enableCoreCnn()
  await decodeMod.enablePrimaryCnn()
  await decodeMod.enableTopCnn()
  await decodeMod.enableSecondaryCnn()
  const decoded = decodeMod.decodePhrase(bmp, img)
  const back = decoded.text.trim()
  log(`decoded → "${back}" ${back === TEXT ? "(exact)" : "(differs)"}`)

  await writeFile(join(TMP, "script.png"), png)
  await writeFile(join(TMP, "overlay.png"), overlay)

  const chars = regions.length
  const html = `<style>${PAGE_CSS}</style><div id="shot">
    <div class="row">
      <div class="panel"><h3>1 · romanized text</h3><p class="note">what you type</p>
        <div class="body"><div class="word">${TEXT}</div></div></div>
      <div class="arrow">→</div>
      <div class="panel" style="flex:1.5"><h3>2 · script</h3><p class="note">@zsnout/ithkuil, rendered headlessly</p>
        <div class="body"><img src="${dataUrl(png)}" /></div></div>
      <div class="arrow">→</div>
      <div class="panel" style="flex:1.5"><h3>3 · segmentation</h3><p class="note">${chars} characters, diacritics attached</p>
        <div class="body"><img src="${dataUrl(overlay)}" /></div></div>
      <div class="arrow">→</div>
      <div class="panel"><h3>4 · decoded text</h3><p class="note">read back out of the pixels</p>
        <div class="body"><div class="word ${back === TEXT ? "ok" : ""}">${back || "—"}${back === TEXT ? " ✓" : ""}</div></div></div>
    </div>
    <p class="cap">Forward is reuse; steps 3–4 are the original work. Generated by <code>npm run screenshots</code> — the decoded text is whatever the pipeline actually returned.</p>
  </div>`
  await shootHtml(browser, html, "03-pipeline.png", { width: 1400 })

  // A closer look at the same overlay, on its own.
  const closeup = `<style>${PAGE_CSS}</style><div id="shot" style="max-width:900px">
    <div class="panel"><h3>segmentation overlay</h3>
      <p class="note">magenta = character · green = base · blue = superposed diacritic · orange = underposed</p>
      <div class="body"><img src="${dataUrl(overlay)}" style="width:100%" /></div></div>
  </div>`
  await shootHtml(browser, closeup, "04-segmentation.png", { width: 940 })
}

// ── 2. the synthetic glyph dataset the classifiers learn from ───────────────────
async function dataset(browser) {
  const dir = join(ROOT, "dataset")
  if (!existsSync(join(dir, "manifest.json"))) {
    log("skipping dataset sheet — run `npm run dataset` first")
    return
  }
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"))
  const clean = manifest.samples.filter((s) => s.clean)
  // One clean sample per class, spread across the families so the sheet shows the variety.
  const byFamily = new Map()
  for (const s of clean) {
    if (!byFamily.has(s.family)) byFamily.set(s.family, [])
    byFamily.get(s.family).push(s)
  }
  const picks = []
  for (const [family, list] of byFamily) {
    const step = Math.max(1, list.length / (family === "secondary-consonant" ? 28 : 10))
    for (let i = 0; i < list.length; i += step) picks.push(list[Math.floor(i)])
  }

  const cells = await Promise.all(
    picks.map(async (s) => {
      const buf = await readFile(join(dir, s.file))
      return `<div class="cell"><img src="${dataUrl(buf)}" /><span>${s.label
        .replace(/_PLACEHOLDER$/, "")
        .toLowerCase()}</span></div>`
    }),
  )

  const html = `<style>${PAGE_CSS}
    /* min-width:0 on the tracks AND the cells: a grid item defaults to min-content width, so
       one long class label would otherwise widen its column and squeeze every other one. */
    .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 8px; }
    .cell { min-width: 0; border: 1px solid #eceff3; border-radius: 7px; padding: 5px 3px 3px; text-align: center; background: #fff; }
    .cell img { width: 100%; display: block; }
    .cell span { display: block; font: 10px ui-monospace, Consolas, monospace; color: #8b93a1; margin-top: 2px;
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    h2 { margin: 0 0 4px; font-size: 17px; }
  </style><div id="shot" style="width:1180px">
    <h2>Synthetic glyph dataset — ${manifest.classCount} classes × ${manifest.perClass} augmented samples</h2>
    <p class="cap" style="margin:0 0 16px">The forward renderer labels its own training data. Shown: the clean reference sample of ${picks.length} classes (consonant cores, placeholders, diacritics, cluster extensions).</p>
    <div class="grid">${cells.join("")}</div>
  </div>`
  await shootHtml(browser, html, "05-glyph-dataset.png", { width: 1220, scale: 1.5 })
}

// ── 3. a real capture sheet from the print-and-rescan loop ──────────────────────
async function sheet(browser) {
  const sheetPng = join(ROOT, "out", "sheets", "sheet-01.png")
  if (!existsSync(sheetPng)) {
    log("generating one capture sheet…")
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", join(ROOT, "src", "scan-sheet.ts"), "1"], {
        cwd: ROOT,
        stdio: "inherit",
      })
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`scan-sheet exited ${code}`))))
    })
  }
  const buf = await readFile(sheetPng)
  const html = `<style>${PAGE_CSS}
    h2 { margin: 0 0 4px; font-size: 17px; }
    .sheet { border: 1px solid #dfe3e8; box-shadow: 0 2px 14px rgba(0,0,0,.09); }
  </style><div id="shot" style="max-width:760px">
    <h2>Self-labelling capture sheet</h2>
    <p class="cap" style="margin:0 0 14px">Known words on an A4 grid with four corner fiducials — the bottom-right is a ring, so orientation is unambiguous — and an 8-bit sheet id across the top band. Print it, photograph it, and the ingester deskews the capture by homography and scores every cell against its printed label.</p>
    <img class="sheet" src="${dataUrl(buf)}" style="width:100%" />
  </div>`
  await shootHtml(browser, html, "06-scan-sheet.png", { width: 800, scale: 1.5 })
}

// ── 4. the local web tool, driven through its own UI ────────────────────────────
async function tool(browser) {
  const port = 3941
  log(`starting the server on :${port}…`)
  const server = spawn(process.execPath, ["--import", "tsx", join(ROOT, "src", "server.ts")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let serverLog = ""
  server.stdout.on("data", (c) => (serverLog += c))
  server.stderr.on("data", (c) => (serverLog += c))

  try {
    const base = `http://127.0.0.1:${port}`
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${base}/api/status`)
        if (r.ok) break
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 })
    await page.goto(base, { waitUntil: "networkidle" })

    // A three-word phrase from the phrase harness's corpus: it exercises word splitting
    // (each formative is primary-initial) and is known to round-trip, so the capture shows
    // the tool working rather than the decoder's worst case. What it CANNOT do is on the
    // README's numbers table, not hidden in a screenshot.
    const PHRASE = "lila saläha rala"
    await page.fill("#enc-text", PHRASE)
    await page.click("#enc-go")
    await page.waitForSelector("#enc-out svg", { timeout: 60_000 })
    await page.screenshot({ path: join(OUT, "01-web-encode.png"), fullPage: false })
    log("wrote screenshots/01-web-encode.png")

    // Decode tab — feed it the render we just made and wait for the pipeline to warm.
    await page.click('[data-tab="decode"]')
    await page.click("#dec-use-encoded")
    await page.click("#dec-go")
    await page.waitForSelector("#dec-out .result", { timeout: 900_000 })
    await page.waitForSelector("#dec-out img", { timeout: 60_000 })
    const decoded = (await page.textContent("#dec-out .result"))?.trim()
    log(`web tool decoded → "${decoded}" ${decoded === PHRASE ? "(exact)" : `✗ EXPECTED "${PHRASE}"`}`)
    await page.screenshot({ path: join(OUT, "02-web-decode.png"), fullPage: false })
    log("wrote screenshots/02-web-decode.png")

    await page.close()
  } finally {
    server.kill()
  }
}

// ── 5. the published demo page ──────────────────────────────────────────────────
async function demo(browser) {
  const dist = join(ROOT, "dist-demo")
  if (!existsSync(join(dist, "index.html"))) {
    log("skipping demo capture — run `npm run demo:build` first")
    return
  }
  const html = await readFile(join(dist, "index.html"), "utf8")
  const emitted = html.match(/(?:src|href)="([^"]*)\/assets\//)
  const base = `${emitted ? emitted[1] : ""}/`
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" }
  const srv = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname
    const rel = path.startsWith(base) ? path.slice(base.length) || "index.html" : "index.html"
    try {
      const body = await readFile(join(dist, rel))
      res.writeHead(200, { "content-type": MIME[extname(rel)] ?? "application/octet-stream" }).end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  const port = await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)))
  const page = await browser.newPage({ viewport: { width: 1000, height: 820 }, deviceScaleFactor: 2 })
  await page.goto(`http://127.0.0.1:${port}${base}`, { waitUntil: "networkidle" })
  await page.waitForSelector("#stage svg")
  await page.screenshot({ path: join(OUT, "07-demo.png") })
  log("wrote screenshots/07-demo.png")
  await page.close()
  srv.close()
}

// ── run ─────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch()
try {
  if (wants("hero")) await hero(browser)
  if (wants("dataset")) await dataset(browser)
  if (wants("sheet")) await sheet(browser)
  if (wants("tool")) await tool(browser)
  if (wants("demo")) await demo(browser)
} finally {
  await browser.close()
}
console.log(`\nscreenshots → ${OUT}`)
console.log(`(${(await readdir(OUT)).filter((f) => f.endsWith(".png")).length} PNGs)`)

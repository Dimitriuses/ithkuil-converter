/**
 * Local web tool for the New Ithkuil converter (Milestone 8).
 *
 * A zero-dependency Node HTTP server over the same core functions the CLI uses, plus
 * a self-contained single-page frontend (src/web/index.html). It's a *local* dev/
 * inspection dashboard, not a released service — it binds to localhost only.
 *
 *   npm run serve            # then open http://localhost:3939
 *
 * Endpoints (JSON in/out; images are base64 data-URLs so there's no multipart parsing):
 *   POST /api/encode  {text, compact?, margin?, width?}  → {ok, svg, viewBox, pathCount, pngBase64}
 *   POST /api/decode  {imageBase64}                       → {ok, text, words, overlayBase64}
 *
 * The forward (encode) path is light and available immediately; the reverse (decode)
 * path builds template sets at import (~1 min), so it's warmed lazily in the
 * background — /api/decode awaits that warmup on the first call.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFileSync } from "node:fs"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { alphaCacheExists } from "./alphabetic.js"
import {
  JOB_KINDS,
  startJob,
  cancelJob,
  listJobs,
  jobLog,
  installJobShutdownHooks,
} from "./jobs.js"

const PORT = Number(process.env.PORT) || 3939
const MAX_BODY = 32 * 1024 * 1024 // 32 MB — images can be a few MB

// The decode pipeline builds template sets at module load; import it lazily so the
// server (and the encode endpoint) come up instantly, and warm it in the background.
type DecodeModule = typeof import("./decode-word.js")
type SegmentModule = typeof import("./segment.js")
type ImageModule = typeof import("./image-io.js")
let decodeReady: Promise<{ decode: DecodeModule; seg: SegmentModule; img: ImageModule }> | null = null
let decodeDone = false // true once warmup has actually finished (for /api/status)
function warmDecode() {
  if (!decodeReady) {
    decodeReady = (async () => {
      const [decode, seg, img, alpha, secondary] = await Promise.all([
        import("./decode-word.js"),
        import("./segment.js"),
        import("./image-io.js"),
        import("./alphabetic.js"),
        import("./secondary.js"),
      ])
      // build/load the cached template sets now, not on the first decode
      alpha.warmAlphabetic()
      secondary.warmSecondary()
      decodeDone = true
      return { decode, seg, img }
    })()
  }
  return decodeReady
}

// ---- tiny helpers -------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error("request body too large"))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body)
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(s) })
  res.end(s)
}

/** Strip a `data:...;base64,` prefix (if present) and decode to a Buffer. */
function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",")
  const b64 = comma >= 0 && dataUrl.slice(0, comma).includes("base64") ? dataUrl.slice(comma + 1) : dataUrl
  return Buffer.from(b64, "base64")
}

// ---- endpoint handlers --------------------------------------------------------

function handleEncode(body: Record<string, unknown>, res: ServerResponse): void {
  const text = typeof body.text === "string" ? body.text : ""
  if (!text.trim()) return sendJson(res, 400, { ok: false, error: "empty text" })
  const result = encode(text, {
    compact: body.compact === true,
    margin: body.margin != null ? Number(body.margin) : undefined,
  })
  if (!result.ok) return sendJson(res, 200, { ok: false, error: result.reason })
  const width = body.width != null ? Number(body.width) : 800
  const pngBase64 = svgToPng(result.svg, { width }).toString("base64")
  sendJson(res, 200, {
    ok: true,
    svg: result.svg,
    viewBox: result.viewBox,
    pathCount: result.pathCount,
    pngBase64,
  })
}

async function handleDecode(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  if (typeof body.imageBase64 !== "string" || !body.imageBase64) {
    return sendJson(res, 400, { ok: false, error: "no image" })
  }
  const { decode, seg, img } = await warmDecode()
  let rgba
  try {
    rgba = img.decodePng(decodeDataUrl(body.imageBase64))
  } catch {
    return sendJson(res, 200, { ok: false, error: "could not decode PNG" })
  }
  const bmp = seg.binarize(rgba.data, rgba.width, rgba.height)
  const regions = seg.segment(bmp)
  const { text, words } = decode.decodePhrase(bmp)
  const overlay = img.renderSegmentationOverlay(rgba, regions)
  const overlayBase64 = img.encodePng(overlay).toString("base64")
  sendJson(res, 200, { ok: true, text, words, overlayBase64 })
}

// ---- server -------------------------------------------------------------------

const INDEX_HTML = readFileSync(new URL("./web/index.html", import.meta.url), "utf8")

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(INDEX_HTML)
      return
    }
    if (req.method === "GET" && req.url === "/api/status") {
      return sendJson(res, 200, {
        ok: true,
        decodeWarm: decodeDone,
        alphaCache: alphaCacheExists(),
      })
    }
    if (req.method === "POST" && req.url === "/api/encode") {
      return handleEncode(JSON.parse((await readBody(req)) || "{}"), res)
    }
    if (req.method === "POST" && req.url === "/api/decode") {
      return await handleDecode(JSON.parse((await readBody(req)) || "{}"), res)
    }

    // ---- jobs (data/model control panel) ----
    if (req.method === "GET" && req.url === "/api/jobs/kinds") {
      const kinds = Object.entries(JOB_KINDS).map(([id, k]) => ({ id, label: k.label, heavy: !!k.heavy }))
      return sendJson(res, 200, { ok: true, kinds })
    }
    if (req.method === "GET" && req.url === "/api/jobs") {
      return sendJson(res, 200, { ok: true, jobs: listJobs() })
    }
    if (req.method === "POST" && req.url === "/api/jobs") {
      const body = JSON.parse((await readBody(req)) || "{}") as { kind?: string; args?: Record<string, unknown> }
      const r = startJob(String(body.kind), body.args ?? {})
      return sendJson(res, r.ok ? 200 : 400, r)
    }
    const logMatch = req.method === "GET" && req.url?.match(/^\/api\/jobs\/([^/]+)\/log$/)
    if (logMatch) {
      const log = jobLog(decodeURIComponent(logMatch[1]!))
      return sendJson(res, log ? 200 : 404, log ? { ok: true, log } : { ok: false, error: "no such job" })
    }
    const cancelMatch = req.method === "POST" && req.url?.match(/^\/api\/jobs\/([^/]+)\/cancel$/)
    if (cancelMatch) {
      const ok = cancelJob(decodeURIComponent(cancelMatch[1]!))
      return sendJson(res, ok ? 200 : 404, { ok })
    }

    sendJson(res, 404, { ok: false, error: "not found" })
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})

installJobShutdownHooks() // never let a background job outlive the server

server.listen(PORT, "127.0.0.1", () => {
  console.log(`New Ithkuil tool → http://localhost:${PORT}`)
  console.log(`  encode is ready now; warming the decode pipeline (templates)…`)
  console.log(`  (first ever run builds the alphabetic template cache — several minutes, one-time)`)
  warmDecode().then(() => console.log(`  decode pipeline ready.`))
})

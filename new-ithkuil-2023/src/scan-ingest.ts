/**
 * Scan-ingest — the capture side of the real-scan loop (pairs with scan-sheet.ts).
 *
 * A capture (scanner or phone, PNG/JPEG, any rotation/perspective) → deskewed to the
 * sheet's canonical geometry → each cell cropped and paired with its known text.
 *
 * Pipeline: detect the four corner fiducials (the bottom-right one is a RING, which fixes
 * orientation); solve the perspective homography from their centres onto the manifest's
 * canonical centres; warp the capture into canonical space (upright, ring at BR by
 * construction); then crop each cell's manifest box. Fiducials are found by connected
 * components filtered to large, solid, square blobs — glyphs are thin (low fill) and the
 * carpet is irregular, so they drop out.
 *
 *   npx tsx src/scan-ingest.ts <capture.jpg> [--canonical out.png]   # deskew + save upright
 */
import { loadImage, savePng, type RgbaImage } from "./image-io.js"
import { readFileSync } from "node:fs"

interface Manifest {
  canvas: { w: number; h: number }
  fiducials: { name: string; cx: number; cy: number; ring: boolean }[]
  cells: { index: number; root: string; text: string; box: { x: number; y: number; w: number; h: number } }[]
}
export const loadManifest = (path = "out/scan-sheet.json"): Manifest => JSON.parse(readFileSync(path, "utf8"))

// ── grayscale + Otsu ────────────────────────────────────────────────────────────
export function toGray(img: RgbaImage): Uint8Array {
  const g = new Uint8Array(img.width * img.height)
  for (let i = 0; i < g.length; i++) g[i] = (img.data[i * 4]! + img.data[i * 4 + 1]! + img.data[i * 4 + 2]!) / 3
  return g
}
export function otsu(gray: Uint8Array): number {
  const hist = new Array(256).fill(0)
  for (const v of gray) hist[v]++
  const total = gray.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let max = 0
  let thr = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > max) {
      max = between
      thr = t
    }
  }
  return thr
}

// ── connected components on a boolean mask (4-connectivity, iterative flood) ──────
interface Comp {
  area: number
  minx: number
  miny: number
  maxx: number
  maxy: number
}
function components(mask: Uint8Array, w: number, h: number, minArea: number): Comp[] {
  const seen = new Uint8Array(w * h)
  const out: Comp[] = []
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue
    let area = 0
    let minx = w
    let miny = h
    let maxx = 0
    let maxy = 0
    stack.length = 0
    stack.push(s)
    seen[s] = 1
    while (stack.length) {
      const p = stack.pop()!
      const x = p % w
      const y = (p / w) | 0
      area++
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
      if (x > 0 && mask[p - 1] && !seen[p - 1]) (seen[p - 1] = 1), stack.push(p - 1)
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) (seen[p + 1] = 1), stack.push(p + 1)
      if (y > 0 && mask[p - w] && !seen[p - w]) (seen[p - w] = 1), stack.push(p - w)
      if (y < h - 1 && mask[p + w] && !seen[p + w]) (seen[p + w] = 1), stack.push(p + w)
    }
    if (area >= minArea) out.push({ area, minx, miny, maxx, maxy })
  }
  return out
}

export interface Fiducials {
  TL: [number, number]
  TR: [number, number]
  BL: [number, number]
  BR: [number, number]
}

/** Detect the four fiducial centres (in full-res image coords) and identify the ring (BR). */
export function detectFiducials(img: RgbaImage): Fiducials {
  // Detect on a downscaled copy for speed; fiducials are large and survive it.
  const scale = Math.max(1, Math.round(Math.max(img.width, img.height) / 1400))
  const w = Math.floor(img.width / scale)
  const h = Math.floor(img.height / scale)
  const gray = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = ((y * scale) * img.width + x * scale) * 4
      gray[y * w + x] = (img.data[si]! + img.data[si + 1]! + img.data[si + 2]!) / 3
    }
  const thr = otsu(gray)
  const dark = new Uint8Array(w * h)
  for (let i = 0; i < dark.length; i++) dark[i] = gray[i]! < thr ? 1 : 0

  // Candidate fiducials: solid (high fill), square-ish, reasonably large.
  const comps = components(dark, w, h, Math.round(w * h * 0.0004))
  const cand = comps
    .map((c) => {
      const bw = c.maxx - c.minx + 1
      const bh = c.maxy - c.miny + 1
      const fill = c.area / (bw * bh)
      const aspect = bw / bh
      const cx = (c.minx + c.maxx) / 2
      const cy = (c.miny + c.maxy) / 2
      // Ring vs solid: sample the blob's bbox centre in the gray image.
      const centreBright = gray[Math.round(cy) * w + Math.round(cx)]! > thr
      return { c, bw, bh, fill, aspect, cx, cy, centreBright, size: (bw + bh) / 2 }
    })
    .filter((k) => k.fill > 0.55 && k.aspect > 0.6 && k.aspect < 1.7)
    .sort((a, b) => b.c.area - a.c.area)

  if (cand.length < 4) throw new Error(`only ${cand.length} fiducial candidates found (need 4)`)
  // The 4 fiducials are the 4 largest similarly-sized solid squares. Take the largest, then
  // the next ones within 60–160% of its size (guards against a big non-fiducial blob).
  const base = cand[0]!.size
  const four = cand.filter((k) => k.size > base * 0.6 && k.size < base * 1.6).slice(0, 4)
  if (four.length < 4) throw new Error(`only ${four.length} consistent-size fiducials`)

  // The ring (BR) has a hole ⇒ bright centre and/or lowest fill.
  const ring = four.reduce((a, b) => (b.centreBright && !a.centreBright ? b : b.fill < a.fill && b.centreBright === a.centreBright ? b : a))
  const others = four.filter((k) => k !== ring)
  // TL is the fiducial diagonally OPPOSITE the ring (BR) — i.e. farthest from it (all four
  // are roughly equidistant from the centroid, so that can't disambiguate). The remaining
  // two are TR/BL by the sign of the cross product of (ring→TL) with (ring→pt).
  const tl = others.reduce((a, b) => (dist(b, ring.cx, ring.cy) > dist(a, ring.cx, ring.cy) ? b : a), others[0]!)
  const rest = others.filter((k) => k !== tl)
  const vx = tl.cx - ring.cx
  const vy = tl.cy - ring.cy
  const cross = (k: (typeof rest)[number]) => vx * (k.cy - ring.cy) - vy * (k.cx - ring.cx)
  // Cross of (ring→TL)×(ring→pt): TR is on the positive side, BL on the negative.
  const [tr, bl] = cross(rest[0]!) > 0 ? [rest[0]!, rest[1]!] : [rest[1]!, rest[0]!]

  const S = (k: { cx: number; cy: number }): [number, number] => [k.cx * scale, k.cy * scale]
  return { TL: S(tl), TR: S(tr), BL: S(bl), BR: S(ring) }
}
const dist = (k: { cx: number; cy: number }, x: number, y: number) => Math.hypot(k.cx - x, k.cy - y)

// ── homography (canonical → image), solved from 4 correspondences ─────────────────
/** Solve the 3×3 homography H (h33=1) mapping src→dst, given 4 point pairs. */
function homography(src: [number, number][], dst: [number, number][]): number[] {
  // 8×8 linear system for [h11..h32].
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]!
    const [X, Y] = dst[i]!
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X])
    b.push(X)
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y])
    b.push(Y)
  }
  const hv = solve(A, b)
  return [hv[0]!, hv[1]!, hv[2]!, hv[3]!, hv[4]!, hv[5]!, hv[6]!, hv[7]!, 1]
}
/** Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]!])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r
    ;[M[col], M[piv]] = [M[piv]!, M[col]!]
    const d = M[col]![col]!
    for (let c = col; c <= n; c++) M[col]![c]! /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r]![col]!
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!
    }
  }
  return M.map((row) => row[n]!)
}

/** Warp `img` into a canonical `cw×ch` frame using H (canonical→image), bilinear. */
export function warpToCanonical(img: RgbaImage, H: number[], cw: number, ch: number): RgbaImage {
  const out = new Uint8Array(cw * ch * 4).fill(255)
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const d = H[6]! * x + H[7]! * y + H[8]!
      const sx = (H[0]! * x + H[1]! * y + H[2]!) / d
      const sy = (H[3]! * x + H[4]! * y + H[5]!) / d
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const di = (y * cw + x) * 4
      if (x0 < 0 || y0 < 0 || x0 + 1 >= img.width || y0 + 1 >= img.height) continue
      const fx = sx - x0
      const fy = sy - y0
      for (let c = 0; c < 3; c++) {
        const a = img.data[(y0 * img.width + x0) * 4 + c]!
        const b = img.data[(y0 * img.width + x0 + 1) * 4 + c]!
        const cc = img.data[((y0 + 1) * img.width + x0) * 4 + c]!
        const dd = img.data[((y0 + 1) * img.width + x0 + 1) * 4 + c]!
        out[di + c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + cc * (1 - fx) * fy + dd * fx * fy
      }
      out[di + 3] = 255
    }
  }
  return { width: cw, height: ch, data: out }
}

/** Solve the homography mapping canonical → image space from a capture's detected fiducials. */
export function canonToImage(f: Fiducials, man: Manifest): number[] {
  const byName = Object.fromEntries(man.fiducials.map((m) => [m.name, [m.cx, m.cy] as [number, number]]))
  const canon: [number, number][] = [byName.TL!, byName.TR!, byName.BL!, byName.BR!]
  const image: [number, number][] = [f.TL, f.TR, f.BL, f.BR]
  return homography(canon, image)
}
const project = (H: number[], x: number, y: number): [number, number] => {
  const d = H[6]! * x + H[7]! * y + H[8]!
  return [(H[0]! * x + H[1]! * y + H[2]!) / d, (H[3]! * x + H[4]! * y + H[5]!) / d]
}

/** Deskew a capture onto the manifest's canonical frame (H maps canonical → image; inverse-sampled). */
export function deskew(img: RgbaImage, man: Manifest): RgbaImage {
  const H = canonToImage(detectFiducials(img), man)
  return warpToCanonical(img, H, man.canvas.w, man.canvas.h)
}

// ── debug overlay: draw detected fiducials + projected cell boxes on the raw image ──
function drawLine(img: RgbaImage, fx0: number, fy0: number, fx1: number, fy1: number, c: [number, number, number], t = 3): void {
  if (![fx0, fy0, fx1, fy1].every(Number.isFinite)) return // degenerate projection ⇒ skip
  // Integer Bresenham — endpoints MUST be rounded up front, or float stepping overshoots the
  // exact-equality termination and loops forever.
  let x = Math.round(fx0)
  let y = Math.round(fy0)
  const x1 = Math.round(fx1)
  const y1 = Math.round(fy1)
  const dx = Math.abs(x1 - x)
  const dy = Math.abs(y1 - y)
  const sx = x < x1 ? 1 : -1
  const sy = y < y1 ? 1 : -1
  let err = dx - dy
  const r = (t / 2) | 0
  for (;;) {
    for (let oy = -r; oy <= r; oy++)
      for (let ox = -r; ox <= r; ox++) {
        const px = x + ox
        const py = y + oy
        if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue
        const i = (py * img.width + px) * 4
        img.data[i] = c[0]
        img.data[i + 1] = c[1]
        img.data[i + 2] = c[2]
        img.data[i + 3] = 255
      }
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) (err -= dy), (x += sx)
    if (e2 < dx) (err += dx), (y += sy)
  }
}
const quad = (img: RgbaImage, p: [number, number][], c: [number, number, number], t: number) => {
  for (let i = 0; i < 4; i++) drawLine(img, p[i]![0], p[i]![1], p[(i + 1) % 4]![0], p[(i + 1) % 4]![1], c, t)
}

/** Return a copy of the RAW (as-decoded) capture with the detected fiducials and each cell's
 * projected box drawn on top — a visual check that detection locked onto the right marks. */
export function renderOverlay(img: RgbaImage, man: Manifest): RgbaImage {
  const f = detectFiducials(img)
  const H = canonToImage(f, man)
  const out: RgbaImage = { width: img.width, height: img.height, data: new Uint8Array(img.data) }
  const F = 150 // fiducial side (from scan-sheet)
  // Cell boxes (magenta), projected canonical → image as perspective quads.
  for (const cell of man.cells) {
    const { x, y, w, h } = cell.box
    quad(out, [project(H, x, y), project(H, x + w, y), project(H, x + w, y + h), project(H, x, y + h)], [230, 40, 200], 4)
  }
  // Fiducial boxes from the manifest centres, projected (green); the ring gets a cyan inner box.
  for (const m of man.fiducials) {
    const c: [number, number, number] = m.ring ? [40, 200, 210] : [40, 190, 70]
    quad(out, [project(H, m.cx - F / 2, m.cy - F / 2), project(H, m.cx + F / 2, m.cy - F / 2), project(H, m.cx + F / 2, m.cy + F / 2), project(H, m.cx - F / 2, m.cy + F / 2)], c, 6)
    if (m.ring) quad(out, [project(H, m.cx - F * 0.2, m.cy - F * 0.2), project(H, m.cx + F * 0.2, m.cy - F * 0.2), project(H, m.cx + F * 0.2, m.cy + F * 0.2), project(H, m.cx - F * 0.2, m.cy + F * 0.2)], c, 4)
  }
  return out
}

// ── CLI: deskew one capture, save the upright canonical image ─────────────────────
if (process.argv[1]?.endsWith("scan-ingest.ts")) {
  const src = process.argv[2]
  if (!src) {
    console.log("usage: npx tsx src/scan-ingest.ts <capture.(jpg|png)> [--canonical out.png]")
    process.exit(1)
  }
  const argAfter = (flag: string) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 ? process.argv[i + 1] : undefined
  }
  const man = loadManifest()
  const img = loadImage(src)
  const f = detectFiducials(img)
  console.log(`${src}: ${img.width}x${img.height} (raw pixel grid — EXIF orientation not applied)`)
  console.log(`  fiducials  TL=${f.TL.map(Math.round)} TR=${f.TR.map(Math.round)} BL=${f.BL.map(Math.round)} BR(ring)=${f.BR.map(Math.round)}`)
  // --overlay: draw detection on the raw image (the orientation the decoder actually sees).
  const ovPath = argAfter("--overlay")
  if (ovPath !== undefined && process.argv.includes("--overlay")) {
    savePng(ovPath, renderOverlay(img, man))
    console.log(`  overlay  → ${ovPath} (fiducials + word boxes on the raw capture)`)
  }
  const canon = deskew(img, man)
  const outPath = argAfter("--canonical") ?? "out/ingest-canonical.png"
  savePng(outPath, canon)
  console.log(`  deskewed → ${outPath} (${canon.width}x${canon.height}, upright, ring at BR)`)
}

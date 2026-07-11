/**
 * Minimal SVG path geometry, enough to implement `isPointInFill` / `isPointInStroke`
 * for svgdom (which ships neither). @zsnout glyph paths use M/L/H/V + quadratic (Q)
 * and cubic (C) curves and Z — curves are flattened to polylines.
 *
 * - fill: even-odd point-in-polygon over the subpaths.
 * - stroke: point within strokeWidth/2 of the centreline (round caps/joins ⇒ this
 *   is just distance-to-polyline < w/2).
 */
export type Pt = readonly [number, number]

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g
const CURVE_STEPS = 10

function flattenQuad(out: Pt[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): void {
  for (let k = 1; k <= CURVE_STEPS; k++) {
    const t = k / CURVE_STEPS
    const mt = 1 - t
    out.push([mt * mt * x0 + 2 * mt * t * x1 + t * t * x2, mt * mt * y0 + 2 * mt * t * y1 + t * t * y2])
  }
}
function flattenCubic(out: Pt[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
  for (let k = 1; k <= CURVE_STEPS; k++) {
    const t = k / CURVE_STEPS
    const mt = 1 - t
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, e = t * t * t
    out.push([a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3])
  }
}

/** Parse a path `d` into subpaths (polylines, curves flattened). */
export function parsePath(d: string): Pt[][] {
  const toks = d.match(TOKEN) ?? []
  const subs: Pt[][] = []
  let cur: Pt[] = []
  let cx = 0, cy = 0, sx = 0, sy = 0
  let cmd = ""
  let i = 0
  const n = () => parseFloat(toks[i++])
  const flush = () => {
    if (cur.length > 1) subs.push(cur)
    cur = []
  }
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++]
    switch (cmd) {
      case "M": flush(); cx = n(); cy = n(); sx = cx; sy = cy; cur = [[cx, cy]]; cmd = "L"; break
      case "m": flush(); cx += n(); cy += n(); sx = cx; sy = cy; cur = [[cx, cy]]; cmd = "l"; break
      case "L": cx = n(); cy = n(); cur.push([cx, cy]); break
      case "l": cx += n(); cy += n(); cur.push([cx, cy]); break
      case "H": cx = n(); cur.push([cx, cy]); break
      case "h": cx += n(); cur.push([cx, cy]); break
      case "V": cy = n(); cur.push([cx, cy]); break
      case "v": cy += n(); cur.push([cx, cy]); break
      case "Q": { const x1 = n(), y1 = n(), x = n(), y = n(); flattenQuad(cur, cx, cy, x1, y1, x, y); cx = x; cy = y; break }
      case "q": { const x1 = cx + n(), y1 = cy + n(), x = cx + n(), y = cy + n(); flattenQuad(cur, cx, cy, x1, y1, x, y); cx = x; cy = y; break }
      case "C": { const x1 = n(), y1 = n(), x2 = n(), y2 = n(), x = n(), y = n(); flattenCubic(cur, cx, cy, x1, y1, x2, y2, x, y); cx = x; cy = y; break }
      case "c": { const x1 = cx + n(), y1 = cy + n(), x2 = cx + n(), y2 = cy + n(), x = cx + n(), y = cy + n(); flattenCubic(cur, cx, cy, x1, y1, x2, y2, x, y); cx = x; cy = y; break }
      case "Z": case "z": cur.push([sx, sy]); flush(); cx = sx; cy = sy; break
      default: i++ // unsupported command (e.g. arc) — skip a token to make progress
    }
  }
  flush()
  return subs
}

/** Even-odd point-in-polygon over all subpaths. */
export function pointInPolygons(px: number, py: number, subs: Pt[][]): boolean {
  let inside = false
  for (const poly of subs) {
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const [xi, yi] = poly[a]
      const [xj, yj] = poly[b]
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = ax + t * dx, qy = ay + t * dy
  return Math.hypot(px - qx, py - qy)
}

/** Minimum distance from a point to the path's polyline. */
export function distanceToPath(px: number, py: number, subs: Pt[][]): number {
  let min = Infinity
  for (const poly of subs) {
    for (let a = 0; a < poly.length - 1; a++) {
      const d = distToSegment(px, py, poly[a][0], poly[a][1], poly[a + 1][0], poly[a + 1][1])
      if (d < min) min = d
    }
  }
  return min
}

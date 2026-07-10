/**
 * Milestone 5 — segmentation.
 *
 * Splits a rendered New Ithkuil word/line image into per-character regions. The
 * script's structure makes this tractable: each character is a cluster of ink in
 * a central band, its diacritics are smaller marks directly above/below (their
 * x-range falls within the base character's), and adjacent characters are
 * separated by clear horizontal gaps. So the algorithm is:
 *
 *   1. binarize → 2. connected components → 3. merge components whose x-intervals
 *   overlap into characters → 4. within each character, tag the base vs its
 *   superposed / underposed / right-posed diacritics by vertical position.
 *
 * Scope: single text line (a word or phrase). Multi-line paragraph splitting is
 * future work (naive y-projection would wrongly split a line's diacritics off).
 */

export interface Bitmap {
  readonly width: number
  readonly height: number
  /** 1 = ink (foreground), 0 = background. Row-major, length width*height. */
  readonly ink: Uint8Array
}

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Component {
  bbox: BBox
  /** Ink pixel count. */
  pixels: number
}

export type Role = "base" | "superposed" | "underposed" | "right" | "unknown"

export interface RegionComponent extends Component {
  role: Role
}

export interface SegmentedRegion {
  /** Left-to-right index of this character in the line. */
  index: number
  /** Union bounding box of the whole character (base + diacritics). */
  bbox: BBox
  /** Bounding box of the base (main) component. */
  base: BBox
  /** All components making up this character, tagged by role. */
  components: RegionComponent[]
}

export interface SegmentOptions {
  /** Drop components smaller than this many ink pixels (noise). Default 4. */
  minPixels?: number
  /** Extra px of tolerance when merging x-intervals into a character. Default 2. */
  xMergeTolerance?: number
}

/** Convert RGBA pixel data to a binary ink bitmap (ink = luminance below threshold). */
export function binarize(
  rgba: Uint8Array | Buffer,
  width: number,
  height: number,
  threshold = 128,
): Bitmap {
  const ink = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
    ink[i] = l < threshold ? 1 : 0
  }
  return { width, height, ink }
}

/** Find connected components (8-connectivity) via iterative flood fill. */
export function connectedComponents(bmp: Bitmap, minPixels = 1): Component[] {
  const { width: W, height: H, ink } = bmp
  const label = new Int32Array(W * H)
  const stack: number[] = []
  const comps: Component[] = []
  let next = 0
  for (let p = 0; p < W * H; p++) {
    if (!ink[p] || label[p]) continue
    next++
    stack.length = 0
    stack.push(p)
    label[p] = next
    let minx = W, maxx = 0, miny = H, maxy = 0, n = 0
    while (stack.length) {
      const q = stack.pop()!
      const x = q % W
      const y = (q / W) | 0
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
      n++
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const np = ny * W + nx
          if (ink[np] && !label[np]) {
            label[np] = next
            stack.push(np)
          }
        }
      }
    }
    if (n >= minPixels) {
      comps.push({ bbox: { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 }, pixels: n })
    }
  }
  return comps
}

/** Union of two bounding boxes. */
function unionBox(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.max(a.x + a.w, b.x + b.w) - x
  const h = Math.max(a.y + a.h, b.y + b.h) - y
  return { x, y, w, h }
}

/** Tag a component's role relative to its character's base component. */
function roleOf(c: Component, base: Component): Role {
  if (c === base) return "base"
  const bTop = base.bbox.y
  const bBottom = base.bbox.y + base.bbox.h
  const bRight = base.bbox.x + base.bbox.w
  const cBottom = c.bbox.y + c.bbox.h
  if (cBottom <= bTop) return "superposed"
  if (c.bbox.y >= bBottom) return "underposed"
  if (c.bbox.x >= bRight) return "right"
  return "unknown"
}

/**
 * Segment a binary bitmap into left-to-right character regions.
 */
export function segment(bmp: Bitmap, opts: SegmentOptions = {}): SegmentedRegion[] {
  const minPixels = opts.minPixels ?? 4
  const tol = opts.xMergeTolerance ?? 2

  const comps = connectedComponents(bmp, minPixels).sort((a, b) => a.bbox.x - b.bbox.x)

  // Merge components whose x-intervals overlap (within tolerance) into characters.
  const groups: Component[][] = []
  let cur: Component[] = []
  let curMaxX = -Infinity
  for (const c of comps) {
    if (cur.length === 0 || c.bbox.x <= curMaxX + tol) {
      cur.push(c)
      curMaxX = Math.max(curMaxX, c.bbox.x + c.bbox.w - 1)
    } else {
      groups.push(cur)
      cur = [c]
      curMaxX = c.bbox.x + c.bbox.w - 1
    }
  }
  if (cur.length) groups.push(cur)

  return groups.map((group, index) => {
    // Base = component with the most ink (the main stroke).
    const base = group.reduce((a, b) => (b.pixels > a.pixels ? b : a))
    const bbox = group.map((c) => c.bbox).reduce(unionBox)
    const components: RegionComponent[] = group.map((c) => ({ ...c, role: roleOf(c, base) }))
    return { index, bbox, base: base.bbox, components }
  })
}

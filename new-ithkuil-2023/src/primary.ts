/**
 * Geometric zone-splitting for Primary characters.
 *
 * A primary is ONE connected blob encoding many features. Unlike quaternary/
 * tertiary (separable diacritic components), a primary's features are baked into
 * the single shape — but in a *fixed coordinate frame* they localize to positions:
 * perspective at the left, specification in the central core, configuration at the
 * bottom-right, etc. (found by difference-imaging). So we decompose by cropping
 * fixed positional zones and template-matching each against zone references built
 * the same way.
 *
 * Pilot: specification (core) + perspective (left). Extends to the other zones by
 * adding their rectangles + value sets. Alignment of a real segmented primary to
 * the reference frame is future work (here we render in the frame directly).
 */
import { shimWindow } from "./dom-shim.js" // must precede @zsnout import
import { getBBox, Primary } from "@zsnout/ithkuil/script"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment, type BBox, type Bitmap } from "./segment.js"
import { cropInk, normalizeMask, type Mask } from "./normalize.js"
import { classifyMask, type Template } from "./classify.js"
import { distanceTransform, meanNearestDistance } from "./chamfer.js"
import { alignToFrame } from "./align.js"
import { encode } from "./forward.js"
import {
  loadCache,
  saveCache,
  serTemplate,
  deserTemplate,
  maskToB64,
  b64ToMask,
  type SerTemplate,
} from "./template-cache.js"

const NS = "http://www.w3.org/2000/svg"
const CANVAS = 160
const ZONE_SIZE = 48

// Fixed frame from a neutral base primary, so every render aligns.
const BASE: Parameters<typeof Primary>[0] = { specification: "BSC", perspective: "M" }
const bb = getBBox(Primary(BASE)) as { x: number; y: number; width: number; height: number }
const M = 20
const VIEWBOX = `${bb.x - M} ${bb.y - M} ${bb.width + 2 * M} ${bb.height + 2 * M}`

/** Render a primary in the shared fixed frame → binary bitmap. */
export function renderFixed(spec: Parameters<typeof Primary>[0]): Bitmap {
  const svg = shimWindow.document.createElementNS(NS, "svg")
  svg.setAttribute("xmlns", NS)
  svg.setAttribute("viewBox", VIEWBOX)
  svg.setAttribute("width", String(CANVAS))
  svg.setAttribute("height", String(CANVAS))
  svg.appendChild(Primary(spec) as unknown as never)
  const img = decodePng(svgToPng(svg.outerHTML, { width: CANVAS }))
  return binarize(img.data, img.width, img.height)
}

function zoneMask(bmp: Bitmap, rect: BBox): Mask {
  const crop = cropInk(bmp, rect)
  return normalizeMask(crop.ink, crop.width, crop.height, ZONE_SIZE)
}
// Positional zones in the fixed CANVAS frame (from difference-imaging: perspective
// marks land in x[0..33] y[24..54], the specification core spans x[32..126]).
const ZONE_PERSPECTIVE: BBox = { x: 0, y: 18, w: 34, h: 44 }
const ZONE_CORE: BBox = { x: 32, y: 18, w: 98, h: 120 }

const PERSPECTIVES = ["M", "G", "N", "A"] as const
const SPECIFICATIONS = ["BSC", "CTE", "CSV", "OBJ"] as const

export interface PrimaryDecode {
  specification: string
  perspective: string
}

/** Decode a primary rendered in the fixed frame by classifying its zones. */
export function decodePrimaryFixed(bmp: Bitmap): PrimaryDecode {
  const t = ensureTemplates()
  return {
    perspective: classifyMask(zoneMask(bmp, ZONE_PERSPECTIVE), t.persp).label,
    specification: classifyMask(zoneMask(bmp, ZONE_CORE), t.spec).label,
  }
}

// ── Aligned path: decode a *segmented* primary (arbitrary scale/position) ──────
//
// The primary encodes specification, perspective, AND nuisance Ca (configuration,
// affiliation, …) in one blob. With single-Ca templates a non-default-Ca primary
// mis-decodes badly (spec drifts to CTE; perspectives G/N read as M → spec 80% /
// persp 63%). Two fixes, each matched to how a feature lives in the glyph:
//   - build a specification × perspective × configuration GRID so a template with the
//     query's feature exists regardless of Ca (mirrors the type-detection grid); and
//   - read each feature with the metric it suits — perspective is a global left mark,
//     so a JOINT whole-shape match wins; specification is a subtle central detail, so
//     the isolated (aligned) CORE zone wins. Hybrid → spec 92% / persp 88% held-out.
//
// Templates are extracted the same way a query is: rendered in a word, segmented,
// and cropped — so both land in the same distribution.

const PRIMARY_CONFIGS = ["UPX", "MSS", "MSC", "DPX"]
const FRAME = 64

/** Stretch a bitmap box's ink into a FRAME×FRAME square — a Ca-independent whole-shape
 * normalization (matches how the perspective grid templates are framed). */
function frameSquare(bmp: Bitmap, box: BBox): Mask {
  const { ink, width, height } = cropInk(bmp, box)
  let minx = width, maxx = -1, miny = height, maxy = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ink[y * width + x]) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
      }
    }
  }
  const data = new Uint8Array(FRAME * FRAME)
  if (maxx < 0) return { size: FRAME, data }
  const w = maxx - minx + 1
  const h = maxy - miny + 1
  for (let ty = 0; ty < FRAME; ty++) {
    const sy = miny + Math.floor((ty * h) / FRAME)
    for (let tx = 0; tx < FRAME; tx++) {
      const sx = minx + Math.floor((tx * w) / FRAME)
      if (ink[sy * width + sx]) data[ty * FRAME + tx] = 1
    }
  }
  return { size: FRAME, data }
}

/** Copy a region's ink into its own bitmap (for the aligner). */
function cropRegionBitmap(bmp: Bitmap, box: BBox): Bitmap {
  const { ink, width, height } = cropInk(bmp, box)
  return { width, height, ink }
}

interface WholeTemplate {
  label: string
  mask: Mask
  dt: Float32Array
}

interface PrimaryTemplates {
  /** Fixed-frame zone templates (decodePrimaryFixed). */
  persp: Template[]
  spec: Template[]
  /** Ca-covering grid, rendered as words (decodePrimaryAligned). */
  perspWhole: WholeTemplate[]
  specCore: Template[]
}

/** Render every template set: the fixed-frame zones, plus the spec × perspective ×
 * configuration grid (rendered as words, primary = leftmost region). Perspective gets
 * whole-shape masks; specification gets aligned core-zone masks. */
function buildTemplates(): PrimaryTemplates {
  const persp: Template[] = PERSPECTIVES.map((p) => ({
    label: p,
    class: `persp-${p}`,
    mask: zoneMask(renderFixed({ ...BASE, perspective: p }), ZONE_PERSPECTIVE),
  }))
  const spec: Template[] = SPECIFICATIONS.map((s) => ({
    label: s,
    class: `spec-${s}`,
    mask: zoneMask(renderFixed({ specification: s, perspective: "M" }), ZONE_CORE),
  }))
  const perspWhole: WholeTemplate[] = []
  const specCore: Template[] = []
  for (const s of SPECIFICATIONS) {
    for (const p of PERSPECTIVES) {
      for (const cfg of PRIMARY_CONFIGS) {
        const text = formativeToIthkuil({
          root: "l",
          type: "UNF/C",
          specification: s as never,
          ca: { perspective: p as never, configuration: cfg as never },
        })
        const r = encode(text, { margin: 10 })
        if (!r.ok) continue
        const img = decodePng(svgToPng(r.svg, { width: 500 }))
        const bmp = binarize(img.data, img.width, img.height)
        const region = segment(bmp)[0]
        if (!region) continue
        const whole = frameSquare(bmp, region.bbox)
        perspWhole.push({ label: p, mask: whole, dt: distanceTransform(whole) })
        specCore.push({
          label: s,
          class: `spec-${s}`,
          mask: zoneMask(alignToFrame(cropRegionBitmap(bmp, region.bbox)), ZONE_CORE),
        })
      }
    }
  }
  return { persp, spec, perspWhole, specCore }
}

// Built lazily and cached to disk: the grid is 64 word renders + alignment, ~28 s, which
// used to be paid at module load on EVERY process start. The distance transforms are
// recomputed on load (cheap) rather than stored. Bump CACHE_VERSION if the renders,
// zones, or value sets change.
const CACHE_NAME = "primary-templates"
const CACHE_VERSION = 1
interface SerShape {
  persp: SerTemplate[]
  spec: SerTemplate[]
  perspWhole: { l: string; s: number; m: string }[]
  specCore: SerTemplate[]
}
let templates: PrimaryTemplates | null = null

function ensureTemplates(): PrimaryTemplates {
  if (templates) return templates
  const cached = loadCache<SerShape>(CACHE_NAME, CACHE_VERSION)
  if (cached) {
    templates = {
      persp: cached.persp.map(deserTemplate),
      spec: cached.spec.map(deserTemplate),
      perspWhole: cached.perspWhole.map((t) => {
        const mask = b64ToMask(t.s, t.m)
        return { label: t.l, mask, dt: distanceTransform(mask) }
      }),
      specCore: cached.specCore.map(deserTemplate),
    }
    return templates
  }
  templates = buildTemplates()
  saveCache(CACHE_NAME, CACHE_VERSION, {
    persp: templates.persp.map(serTemplate),
    spec: templates.spec.map(serTemplate),
    perspWhole: templates.perspWhole.map((t) => ({ l: t.label, s: t.mask.size, m: maskToB64(t.mask) })),
    specCore: templates.specCore.map(serTemplate),
  } satisfies SerShape)
  return templates
}

/** Build/load the primary templates now (call at warmup so the first decode doesn't pay it). */
export function warmPrimary(): void {
  ensureTemplates()
}

/** Nearest whole-shape template by symmetric Chamfer distance (templates carry a
 * precomputed distance transform, so only the query's is computed). */
function matchWhole(query: Mask, templates: WholeTemplate[]): string {
  const qDt = distanceTransform(query)
  let best = templates[0]!
  let bestDist = Infinity
  for (const t of templates) {
    const d = 0.5 * (meanNearestDistance(query, t.dt) + meanNearestDistance(t.mask, qDt))
    if (d < bestDist) {
      bestDist = d
      best = t
    }
  }
  return best.label
}

/** Decode a segmented primary of unknown scale/position. */
export function decodePrimaryAligned(queryBmp: Bitmap): PrimaryDecode {
  const t = ensureTemplates()
  const whole = frameSquare(queryBmp, { x: 0, y: 0, w: queryBmp.width, h: queryBmp.height })
  const core = zoneMask(alignToFrame(queryBmp), ZONE_CORE)
  return {
    perspective: matchWhole(whole, t.perspWhole),
    specification: classifyMask(core, t.specCore).label,
  }
}

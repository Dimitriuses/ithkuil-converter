/**
 * Disk cache for rendered template sets.
 *
 * Several modules build their reference templates by rasterizing glyphs (~260 ms per
 * resvg render), which is far too slow to redo on every process start — a cold decode
 * warmup was ~86 s, ~72 s of which was `char-type.ts` and `primary.ts` re-rendering their
 * grids at module load. `alphabetic.ts` and `secondary.ts` had each grown their own copy
 * of a mask→base64→JSON cache; this is that pattern factored out so new call sites don't
 * add a fourth.
 *
 * Masks are stored as base64 (they're plain Uint8Array bitmaps); anything derived and
 * cheap — e.g. a chamfer distance transform — is recomputed on load rather than stored.
 * Bump the caller's `version` whenever its render or value set changes; a mismatch (or a
 * missing/corrupt file) simply rebuilds.
 *
 * Caches live in `models/` alongside the trained CNNs — gitignored and regenerable.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"
import type { Mask } from "./normalize.js"
import type { Template } from "./classify.js"

/** Absolute path of a cache file in `models/`, e.g. `cachePath("char-type")`. */
export function cachePath(name: string): string {
  return fileURLToPath(new URL(`../models/${name}.json`, import.meta.url))
}

export const maskToB64 = (m: Mask): string => Buffer.from(m.data).toString("base64")
export const b64ToMask = (size: number, s: string): Mask => ({
  size,
  data: new Uint8Array(Buffer.from(s, "base64")),
})

/** Serialized form of a `Template` (label / class / mask). */
export interface SerTemplate {
  l: string
  c: string
  s: number
  m: string
}
export const serTemplate = (t: Template): SerTemplate => ({
  l: t.label,
  c: t.class,
  s: t.mask.size,
  m: maskToB64(t.mask),
})
export const deserTemplate = (t: SerTemplate): Template => ({
  label: t.l,
  class: t.c,
  mask: b64ToMask(t.s, t.m),
})

/** Read a cache payload, or null when absent/corrupt/stale. Never throws. */
export function loadCache<T>(name: string, version: number): T | null {
  try {
    const j = JSON.parse(readFileSync(cachePath(name), "utf8")) as { version: number; data: T }
    return j.version === version ? j.data : null
  } catch {
    return null // missing, unreadable, or invalid JSON → rebuild
  }
}

/** Write a cache payload. Best-effort: a failure just means we rebuild next start. */
export function saveCache(name: string, version: number, data: unknown): void {
  try {
    const p = cachePath(name)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify({ version, data }))
  } catch {
    /* best-effort */
  }
}

export const cacheExists = (name: string): boolean => existsSync(cachePath(name))

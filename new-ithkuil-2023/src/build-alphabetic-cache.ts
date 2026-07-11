/**
 * Build (or rebuild) the alphabetic base-template cache used by the reverse decoder.
 *
 * The joint whole-base matcher compares a segmented base against ~1200 rendered
 * `{core, top, bottom}` references. Each render is resvg-bound (~260 ms), so the set
 * is built once and cached to `models/alphabetic-base.json`. This script is what the
 * web tool's "Build alphabetic cache" job runs; it's also usable directly.
 *
 *   npx tsx src/build-alphabetic-cache.ts          # build if missing
 *   npx tsx src/build-alphabetic-cache.ts --force  # rebuild from scratch
 */
import "./dom-shim.js"
import { warmAlphabetic, rebuildAlphabetic, alphaCacheExists } from "./alphabetic.js"

const force = process.argv.includes("--force")
const t = Date.now()

if (force) {
  console.log("Rebuilding alphabetic base-template cache (~1200 glyph renders, several minutes)…")
  rebuildAlphabetic()
} else if (alphaCacheExists()) {
  console.log("Alphabetic cache already present — loading to verify…")
  warmAlphabetic()
} else {
  console.log("Building alphabetic base-template cache (~1200 glyph renders, several minutes)…")
  warmAlphabetic()
}

console.log(`Done in ${((Date.now() - t) / 1000).toFixed(0)}s → models/alphabetic-base.json`)

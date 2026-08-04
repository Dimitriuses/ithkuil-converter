/**
 * Build config for the browser demo (`demo/`) that ships to GitHub Pages.
 *
 * This is ONLY for the demo page — the converter itself runs on Node via tsx and has no
 * bundler. The demo bundles the forward path (`@zsnout/ithkuil/script`), which is browser
 * code to begin with.
 *
 *   npm run demo         # dev server
 *   npm run demo:build   # → dist-demo/
 *
 * `base` must match the path the site is served from. A project Pages site lives at
 * `<owner>.github.io/<repo>/`, and GitHub does NOT redirect that path when a repo is
 * renamed — so the workflow passes the repo name in via DEMO_BASE rather than hard-coding
 * it here, and then asserts the emitted asset paths agree.
 */
import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: here("demo"),
  base: process.env.DEMO_BASE || "/",
  // Screenshots are generated into the repo-root `screenshots/` and are what the README
  // uses; the demo serves the same files rather than keeping a second copy.
  publicDir: here("../screenshots"),
  build: {
    outDir: here("dist-demo"),
    emptyOutDir: true,
    target: "es2022",
  },
})

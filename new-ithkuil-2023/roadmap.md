# New Ithkuil (2023) Converter — Roadmap

> Bidirectional converter between romanized **New Ithkuil** and its native block script.
> This is the active project. The 2011-font work in [`../ithkuil-2011/`](../ithkuil-2011/)
> is a *reference/harness* only — New Ithkuil is a different writing system and its glyphs
> and composition rules do not carry over.

---

## 1. Goal

- **Forward:** romanized New Ithkuil text → native script image (SVG, and PNG).
- **Reverse:** script image → romanized text.

Motivating use case (from the original plan): rendering and reading Ithkuil place names /
short texts, embeddable as a library + CLI.

---

## 2. Key decision: reuse `@zsnout/ithkuil` for the forward path

The forward direction (text → script) is **already solved** by
[`@zsnout/ithkuil`](https://github.com/zsakowitz/ithkuil) (MIT, TypeScript, npm
`@zsnout/ithkuil`) — a complete New Ithkuil toolkit. So we do **not** build or
reverse-engineer a font. We reuse it and spend our effort on the **reverse** direction,
which no existing tool does.

What `@zsnout/ithkuil` gives us:

| Sub-module | Use |
|---|---|
| `@zsnout/ithkuil/parse` | romanized text → structured word JSON |
| `@zsnout/ithkuil/generate` | word JSON → romanized text |
| `@zsnout/ithkuil/gloss` | interlinear gloss (debugging / validation) |
| `@zsnout/ithkuil/script` | word JSON / text → **script SVG** (composes primary/secondary/tertiary/quaternary chars + diacritics + extensions) |
| `@zsnout/ithkuil/data` | root & affix data |

Known caveats to design around:
- **DOM dependency:** `/script` uses `document.createElementNS`, so server-side/Node use
  needs a lightweight DOM shim (`linkedom`). Milestone 1 validates this.
- **No top-level export:** import from sub-paths (`@zsnout/ithkuil/script`, etc.).
- **Text-to-script only:** there is no OCR — the reverse pipeline is entirely ours.

---

## 3. Architecture

```
FORWARD:   text ─(parse)→ word JSON ─(script)→ SVG ─(rasterize)→ PNG
                                          │
                                          ▼
SYNTHETIC DATA:  render all chars/glyphs + augment (scale/rotate/noise) → labeled set
                                          │
                                          ▼
REVERSE:   image ─(preprocess)→ segment → classify → reconstruct word JSON ─(generate)→ text
```

The reverse pipeline targets the **word JSON structure**, not free-form romanization —
`@zsnout` converts JSON→text for us, so the recognizer's job is "image → structured
characters," a much smaller target.

---

## 4. Milestones

| # | Milestone | Depends on | Deliverable |
|---|---|---|---|
| **1** ✅ | **Forward spike** — `@zsnout/ithkuil` renders a word to SVG in **Node** | — | DONE — [`src/spike-forward.ts`](src/spike-forward.ts) renders text → SVG → PNG. See findings below. |
| **2** ✅ | **Forward module** — clean `encode(text) → SVG` API + CLI | 1 | DONE — [`src/forward.ts`](src/forward.ts), [`src/dom-shim.ts`](src/dom-shim.ts), [`src/cli.ts`](src/cli.ts). `npm run encode -- "…" -o w.svg --png w.png` |
| **3** ✅ | **Rasterizer** — SVG → PNG at configurable width (`@resvg/resvg-js`) | 2 | DONE (core) — [`src/raster.ts`](src/raster.ts), wired into the CLI `--png` |
| **4** ✅ | **Synthetic dataset generator** — per-glyph × augmentations, with labels | 2, 3 | DONE — [`src/generate-dataset.ts`](src/generate-dataset.ts) → labeled PNGs + `manifest.json` |
| **5** ✅ | **Reverse: preprocess + segment** — binarize, char split, diacritic merge | — | DONE — [`src/segment.ts`](src/segment.ts) → `SegmentedRegion[]`; demo [`src/segment-demo.ts`](src/segment-demo.ts) |
| 6 | **Reverse: baseline classifier** — template match vs `@zsnout`-rendered reference glyphs | 4, 5 | `ClassifiedGlyph[]` (reuses `ithkuil-2011/build_glyph_similarity.py` approach) |
| 7 | **Reverse: decoder** — classified glyphs → word JSON → `@zsnout/generate` → text | 6 | `decode(image) → text` |
| 8 | **CLI + library API** — `encode` / `decode` commands and typed exports | 2, 7 | published-shape package |
| 9 | **CNN classifier** (robustness for noisy/photo input), trained on synthetic data | 4, 6 | ONNX/TF.js model + integration |
| 10 | **Round-trip test corpus + metrics** | 8 | `text → image → text ≈ original` |

Milestones 1–4 are integration/plumbing and unlock everything. The genuine research is 5–7 (and 9).

### Milestone 1 — findings (2026-07-10)

Forward rendering in Node **works**. Proven by [`src/spike-forward.ts`](src/spike-forward.ts)
(`npm run spike -- "Wattunkí ruyün"`): text → SVG (16 paths, fitted viewBox) → PNG shows
correct New Ithkuil block script. Key learnings, all baked into the spike:

- **The DOM shim must be `svgdom`, NOT `linkedom`.** The library's composition (`Anchor`,
  `Row`, `fitViewBox`) depends on a real SVG `getBBox()` computed from path data — linkedom
  doesn't do geometry; `svgdom` does. Use `createHTMLWindow()` (its `document` has a `body`,
  which `getBBox`/`fitViewBox` require; the SVG-only window has no `body`).
- **Globals to install before importing `@zsnout/ithkuil/script`:** `window`, `document`, and
  the classes `SVGElement`, `SVGGraphicsElement`, `SVGSVGElement`, `SVGPathElement`,
  `SVGTextContentElement`, and `SVGGElement` → map to svgdom's `SVGGraphicsElement` (svgdom has
  no distinct `<g>` class; this makes `Translate` bake offsets into path coords, its intended path).
- **`compact: false` for now.** Compact row layout uses collision kerning via SVG
  `isPointInStroke`/`isPointInFill` hit-testing, which svgdom lacks. Non-compact uses bbox
  spacing (looser but correct). Compact-in-Node is a follow-up: shim those two methods
  (point-in-path geometry) on svgdom, or run that step in a headless browser.
- **Errors are graceful:** `textToScript` returns a `{ ok, reason }` Result — bad input yields
  a message, not a crash.
- **Rasterizing:** `@resvg/resvg-js` renders the SVG string → PNG cleanly in Node (feeds
  Milestone 3).

### Milestones 2–3 — done

- **Public API** ([`src/forward.ts`](src/forward.ts)): `encode(text, opts?) → { ok, svg, viewBox, pathCount } | { ok:false, reason }`.
  Options: `margin`, `fill`, `compact` (rejected gracefully in Node for now). Verified: repeated
  calls in one process are independent (no getBBox state leakage); parse errors return a reason.
- **Rasterizer** ([`src/raster.ts`](src/raster.ts)): `svgToPng(svg, { width, background }) → Buffer`.
- **CLI** ([`src/cli.ts`](src/cli.ts), `npm run encode`): uses Node's built-in `util.parseArgs`
  (no CLI dependency). SVG to stdout or `-o`, optional `--png`, `-w/--width`, `-m/--margin`.
- **tsconfig:** `moduleResolution: "Bundler"` (matches the tsx runtime — `@zsnout/ithkuil` ships
  no `exports` map, so NodeNext can't resolve its subpath types). `svgdom` gets a minimal ambient
  d.ts. `npm run typecheck` passes.

### Milestone 4 — done

Per-glyph synthetic dataset generator. `npm run dataset -- [--per-class N] [--size px] [--seed n] [--clean]`.

- **Class taxonomy** ([`src/glyph-classes.ts`](src/glyph-classes.ts)): the **28 New Ithkuil consonant
  cores** (from `@zsnout`'s `CORES`), each rendered as a standalone `Secondary` character — the clean,
  finite atomic set. Designed to extend (add extensions/diacritics/other character families later).
- **Fixed-canvas renderer** ([`src/glyph-render.ts`](src/glyph-render.ts)): centres a glyph on a
  square canvas by its own bbox, applies a scale/rotate/jitter transform, emits a same-size SVG so
  every sample rasterizes to identical dimensions (what a classifier wants).
- **Generator** ([`src/generate-dataset.ts`](src/generate-dataset.ts)): per class, 1 clean canonical
  sample (also the template reference for M6) + N seeded-random augmented samples; writes
  `dataset/<class>/<class>_NNN.png` + a `manifest.json` (per-sample label/class/family/aug params).
  Reproducible via `--seed`. `dataset/` is gitignored.
- **Augmentation:** geometric (scale 0.85–1.15, rotate ±10°, jitter ±8px), applied as SVG transforms
  (rasterizer honours them). Pixel noise/blur deferred to when the CNN (M9) needs it — the template
  baseline (M6) works on clean/geometric variation. Note: rendering is ~0.3 s/image (svgdom getBBox);
  fine for one-off generation, optimize if it becomes a bottleneck.

### Milestone 5 — done

Single-line segmentation. `npm run segment -- --text "…"` (or `--image file.png`) prints the
per-character breakdown and writes a colour-coded overlay.

- **Algorithm** ([`src/segment.ts`](src/segment.ts)): binarize → 8-connected components → merge
  components whose **x-intervals overlap** into characters → tag each component `base` /
  `superposed` / `underposed` / `right` by vertical position vs the base. Chosen after inspecting a
  real word: characters sit in a central band with clear horizontal gaps, and each diacritic's
  x-range falls within its base — so x-overlap grouping is robust and simple.
- **Verified:** "Wattunkí ruyün" → 7 characters with correct base + super/under-posed diacritic
  tagging (overlay confirms boxes); a single-glyph dataset image → 1 region (base only).
- **I/O** ([`src/image-io.ts`](src/image-io.ts), pngjs): PNG decode/encode + `renderSegmentationOverlay`
  (magenta = character, green = base, blue = superposed, orange = underposed, cyan = right).
- **Output** `SegmentedRegion[]`: `{ index, bbox, base, components: [{ bbox, pixels, role }] }` — the
  base bbox is what the M6 classifier crops; diacritic components feed later vowel/tone recognition.
- **Scope/deferrals:** single text line (words/phrases). Multi-line paragraph splitting is future
  (naive y-projection would split a line's diacritics off). Deskew/denoise (for real scans) and the
  compact-layout Node shim remain deferred until needed.

### Next up

- **Milestone 6 — baseline classifier.** Crop each region's base, normalize, and template-match
  against the **clean canonical samples** already in `dataset/` (the thickness-invariant Chamfer
  metric from `ithkuil-2011/build_glyph_similarity.py`, reused). Output `ClassifiedGlyph[]` — the
  first end-to-end image → labels step.

---

## 5. Reverse pipeline — design notes (the hard, novel part)

- **Preprocess:** greyscale → adaptive threshold (Otsu) → deskew (Hough) → morphological denoise.
- **Segment:** horizontal projection for lines; connected-components for characters; merge
  vertically-adjacent components within a primary's span (diacritics belong to their base).
- **Classify:** start with **template matching** against reference glyphs rendered by `@zsnout`
  at canonical size (normalized-cross-correlation / the thickness-invariant Chamfer metric
  already prototyped in the 2011 harness). Upgrade to a small **CNN** (milestone 9) trained on
  the synthetic data for real scans/photos.
- **Decode:** map the recognized character sequence into the `@zsnout` word-JSON shape, then
  `generate` → romanized text. Optionally validate with `parse` (round-trip) to catch
  misclassifications.

Hardest problems: touching/overlapping diacritics in segmentation; distinguishing near-identical
character variants; reconstructing valid word JSON from a noisy character stream.

---

## 6. Tech stack

| Concern | Choice |
|---|---|
| Language / runtime | TypeScript, Node 20+ |
| Forward script | `@zsnout/ithkuil` (+ `linkedom` DOM shim) |
| SVG → PNG | `resvg-js` or `sharp` |
| Image processing (reverse) | `jimp` / OpenCV.js (Node); `cv2` for offline scripts |
| ML classifier | ONNX Runtime / TensorFlow.js (train in Python, export) |
| CLI | `commander` or `citty` |
| Test / build | `vitest` / `tsup` |

---

## 7. What we reuse from `ithkuil-2011/`

- The **template-match / similarity harness** (`build_glyph_similarity.py`): thickness-invariant
  Chamfer scoring of a glyph bitmap against a reference set — directly the baseline classifier.
- The **validator UX pattern** (`build_validator.py`): a self-contained HTML review tool with
  per-glyph reference + candidate matches — reusable for reviewing reverse-pipeline output.
- General lessons: SVG y-flip, normalization/bbox-crop conventions, PUA encoding awareness.

Nothing about the 2011 *glyph shapes*, GPOS anchors, or class taxonomy transfers — New Ithkuil
composition comes entirely from `@zsnout/ithkuil`.

---

## 8. Immediate next step

**Milestone 1 — the forward spike.** Add `@zsnout/ithkuil` + `linkedom`, render one known
formative to an SVG string in Node, and confirm it's valid. This de-risks the entire forward
path and data-generation chain (the last unproven assumption is whether the DOM shim works cleanly).

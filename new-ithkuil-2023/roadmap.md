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
| **6** ✅ | **Reverse: baseline classifier** — template match vs clean dataset samples | 4, 5 | DONE — [`src/classify.ts`](src/classify.ts); **90.3% top-1 / 99.7% top-3** on augmented consonants |
| **7** ✅ | **Reverse: decoder** (scoped) — classified glyphs → romanized text | 6 | DONE — [`src/decode.ts`](src/decode.ts); **100%** round-trip on consonant+vowel |
| **8** ✅ | **Local tool** — web dashboard + CLI + data/model job panel over the shared core (reframed from a published library) | 2, 7 | DONE — [`src/server.ts`](src/server.ts), [`src/web/index.html`](src/web/index.html), [`src/jobs.ts`](src/jobs.ts); `npm run serve` |
| **9** ✅ | **CNN classifier** (robustness for noisy input), trained on synthetic data | 4, 6 | DONE (proof-of-concept) — **97.6% vs 82.5%** template on noisy consonants |
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

### Milestone 6 — done

Baseline template-match classifier + the first end-to-end image → labels pipeline.

- **Pipeline** ([`src/normalize.ts`](src/normalize.ts) → [`src/chamfer.ts`](src/chamfer.ts) →
  [`src/classify.ts`](src/classify.ts)): crop a region's base → normalize (bbox-crop, pad square,
  resize 64×64) → thickness-invariant **symmetric Chamfer** similarity vs one template per class
  (the clean canonical dataset samples). Ported from `ithkuil-2011/build_glyph_similarity.py`.
- **Eval** (`npm run eval`): train on clean templates, test on augmented samples →
  **90.3% top-1, 99.7% top-3** across the 28 consonants. Errors concentrate in **voiceless/voiced
  pairs** (p↔b, f↔v, t↔d, g↔k) and cedilla pairs (ḑ↔ţ) — near-identical base shapes distinguished
  only by a small mark, which a coarse Chamfer misses under rotation. The near-perfect top-3 shows
  the shape is right; the fix is finer features (the M9 CNN, or a mark-focused second stage).
- **End-to-end demo** (`npm run recognize -- --text "…"`): image → `segment` → `classifyRegions` →
  per-character label + confidence. Honest scores: bare consonants match at ~0.98 (correctly picked
  out the `r` and `n` in "ru**y**ü**n**"), non-consonant character types score low and are flagged.

### Coverage expansion — done

Extended the taxonomy in [`src/glyph-classes.ts`](src/glyph-classes.ts) from 28 consonants to
**88 classes across 4 families**, and made the pipeline use them:

- **Families:** secondary-consonant (28) · secondary-placeholder (5) · diacritic (16 unique shapes,
  deduped — the vowel names alias the structural ones) · extension (39, `vert` variant, deduped).
- **Eval** (`npm run eval`): **96.1% top-1, 99.8% top-3** across all 88 classes (up from 90.3% on
  consonants alone — the extra families are mostly distinct). Remaining errors are the genuinely
  near-identical pairs: voiceless/voiced consonants (p↔b, f↔v, t↔d, g↔k) and cedilla pairs (ḑ↔ţ).
- **Detailed recognition** ([`classifyRegionsDetailed`](src/classify.ts)): base components classify
  against consonant/placeholder/extension templates; each diacritic component classifies against the
  diacritic family. `npm run recognize` now reports base **and** marks — diacritics come back at
  **0.97–1.00** confidence (DOT, HORIZ_BAR, CURVE_TO_LEFT correctly identified) even where the base
  is an as-yet-unmodelled character type.
- **Still out of scope (needs structure, not flat templates):** whole **primary / tertiary /
  quaternary** characters are combinatorial (they encode many categories at once), so they can't be
  enumerated as classes — recognizing them needs a structural decomposition step. That's the main
  remaining gap, and a natural companion to M7's decoder.

### Milestone 7 — done (scoped)

Decoder for the modeled domain: **secondary consonant + vowel diacritics → romanized text**. The
full `text → image → text` round-trip is now closed for that domain.

- **Shape → letter mapping** ([`src/decode.ts`](src/decode.ts)): consonant cores are already
  romanized (base label is "k"/"t"/…); vowel diacritics map via `buildVowelMap()`, derived from
  `@zsnout`'s `CORE_DIACRITICS` (its vowel names alias the structural shapes). Reading rule (§12.7):
  superposed vowel precedes the consonant, underposed follows it.
- **Round-trip** (`npm run decode-test`): render `Secondary(core, {super|under}posed: vowel)` →
  segment → classify → decode → compare. **100% (120/120)** across 12 consonants × 5 vowels × 2
  positions (clean renders; the 96.1% classifier figure is the harder augmented case).
- **Integrated** into `npm run recognize`: prints a `decoded:` line; characters whose base isn't a
  modeled consonant show `·`. On "Wattunkí ruyün" it correctly reads the two secondary consonants
  with their vowels (`är`, `än`) and marks the rest.

### Structural decomposition — Quaternary + Tertiary (done)

Two combinatorial character types decomposed, via one shared, validated recipe.

- **Insight:** superposed/underposed diacritics are *separable* components (the segmenter isolates
  them), so a character's base varies only by its non-separable feature — an enumerable set. No
  geometric zone-splitting needed for these.
- **Shared recipe** ([`src/decompose.ts`](src/decompose.ts)): template-match the base against
  on-the-fly `Constructor({ feature })` renders; classify each diacritic component and map shape→value
  with `@zsnout`'s own value→shape maps, inverted. Same shape means different things by position,
  which the segmenter's role tags disambiguate. Both decoders below are ~30 lines on top of this.
- **Quaternary** ([`src/quaternary.ts`](src/quaternary.ts), `npm run quaternary-test`): base →
  `value` (illocution/validation), superposed → `mood`, underposed → `caseScope`. **95.1% full**
  (77/81); mood 100%, case-scope 100%, value 95.1% (only ḑ/ţ-shaped DIR↔ADM confuse).
- **Tertiary** ([`src/tertiary.ts`](src/tertiary.ts), `npm run tertiary-test`): base → `valence`,
  superposed → `absoluteLevel`, underposed → `relativeLevel` (both via `LEVEL_TO_DIACRITIC_MAP`).
  **100% full** (81/81) — valence/absLevel/relLevel all 100%.

### Geometric zone-splitting — Primary (pilot, done)

The primary is a *single connected blob* (not separable components), so the decompose recipe
doesn't apply — this is the genuine zone-splitting case. Key finding from difference-imaging: a
primary's features only localize in a **fixed coordinate frame** (bbox-recentering scrambles them,
because features change the overall size). In a fixed frame: perspective → left zone, specification
→ central core, configuration → bottom-right.

- **Method** ([`src/primary.ts`](src/primary.ts)): render in a shared fixed frame (a neutral
  primary's bbox), crop fixed positional zones, template-match each against zone references built
  the same way.
- **Round-trip** (`npm run primary-test`): **93.8%** (15/16) over specification × perspective —
  **specification 100%** (core zone), perspective 93.8% (one CSV/M→N where the core bleeds left).
- **Scope/limits:** pilot covers 2 of ~10 primary features (add zones + value sets for the rest,
  e.g. configuration bottom-right). Aligning a *real segmented* primary to the reference frame is
  future work — the round-trip renders directly in-frame.

### Findings — which technique each character needs

- **Quaternary / tertiary:** superposed/underposed features are **separable components** (gaps
  between them) → the `decompose.ts` recipe. Tertiary top/bottom **segments** are *also* separate
  components (not connected to the bar), so they need multi-component role-assignment by vertical
  order, not zone-splitting — a small future extension.
- **Primary:** one connected blob → **fixed-frame geometric zone-splitting**.
- **Near-identical shapes** (voiced/voiceless, ḑ/ţ, DIR/ADM) remain the ceiling for all template
  matching → the M9 CNN.

### Real-image alignment — Primary (done)

Lets a *segmented* primary (arbitrary scale/position) decode, not just an in-frame render.

- **Invariant anchor:** measured across all 16 spec×perspective variants, the **bottom baseline is
  feature-invariant** (`B≈130`) while the top/left move with the features. So [`src/align.ts`](src/align.ts)
  places the query's ink bottom on a fixed row, centres it horizontally, and scales by ink height —
  approximating the @zsnout coordinate frame from pixels alone. Templates are rebuilt through the same
  alignment so query and reference land identically.
- **Round-trip** (`npm run primary-align-test`, simulating segmentation at scales 90/120/150px):
  **70.8% full** — **specification 95.8%** (the large core survives alignment; scale-invariance
  achieved) but **perspective 70.8%** (a small top-left mark, and perspective changes the height the
  aligner scales by — coupling). Confirms the concept: large features decode after alignment; small
  marks need a better anchor (or the CNN).

### Routing through `@zsnout/ithkuil/generate` (done)

Closes the loop: decoded features → partial formative → romanized text (the inverse of the forward
`text → parse → JSON → script` path).

- **Assembler** ([`src/assemble.ts`](src/assemble.ts)): `featuresToText(features)` maps decoded
  values (root, specification, vn, case, mood, …) into a partial formative and calls
  `formativeToIthkuil`, which fills defaults.
- **End-to-end round-trip** (`npm run formative-test`): render each feature's character → decode
  (secondary → root consonants, tertiary → vn, primary → specification) → assemble → generate.
  **100% (64/64)** — every decoded formative regenerated the original romanization.
- **Documented gap:** characters are decoded *individually*. Pulling them out of a single **composed
  formative image** is unsolved — a rendered formative merges characters under the current x-overlap
  segmentation, uses cluster **extensions** (root "kt" → one secondary + extension, not two), and
  **elides** default slots. That composed-word segmentation is the main remaining work for true
  image→text on running text.

### Composed-word orchestrator (done)

Reads a real composed formative image into typed, decoded characters — the integration layer over
the per-character decoders.

- **Segmentation** already separates a composed formative correctly (characters have clear gaps in
  the non-compact rendering): "aktalo" → Primary (diagonal blade) + Secondary (root + diacritic).
- **Character-type detection** ([`src/char-type.ts`](src/char-type.ts)): classify a character's base
  against one combined, type-tagged template set (secondary/quaternary/tertiary/primary). The four
  base silhouettes are very different → **9/9** on the type test, all at 1.00.
- **Orchestrator** ([`src/decode-word.ts`](src/decode-word.ts), `npm run word`): segment → detect
  type → route to the matching decoder (secondary consonant+diacritics / quaternary / tertiary /
  primary-aligned). On composed formatives it correctly types every character (0.94–0.98) and
  decodes primary specification (e.g. OBJ), secondary consonants, and tertiary valence.
### Full secondary decoding — core + extensions + vowels (done)

Closes the biggest composed-word gap: multi-consonant roots and vowels.

- **Core + cluster extension** ([`src/secondary.ts`](src/secondary.ts)): the extension is connected
  to the core and perturbs the base, so bare-core matching fails (core dropped to 72% with an
  extension present). Fixed by **joint** decoding — match the base against `Secondary({ core, top|bottom: X })`
  over *all* cores at once (lazy-built, cached), so the correct core+extension template wins together.
- **Vowels:** the superposed/underposed diacritics are separable components → classify + map
  shape→vowel via the shared vowel map.
- **Round-trip** (`npm run secondary-test`): **98.7% full** — **core 100%, top-ext 98.7%, vowel 100%**.
- **Integrated:** `decodeWord` now uses the full secondary decoder — the composed formative "aktalo"
  decodes its root as **"kt"** (core k + bottom-extension t) with vowel ë, not just "k".

### Full composed-word → text (done — the headline loop, 100%)

`image → segment → type-detect → per-character decode → map to formative slots → formativeToIthkuil`.

- **Orchestration** ([`decodeWordToText`](src/decode-word.js) in `decode-word.ts`, `npm run word-test`):
  maps decoded features to slots — root ← secondaries, specification ← primary, vn ← tertiary,
  case/mood ← quaternary — and routes the whole word through `formativeToIthkuil`. **Elision is
  automatic:** unread slots are omitted and default identically on both sides.
- **Round-trip:** render formative → image → decode → text. **100% (48/48)** exact-string match over
  root × specification × vn (single + cluster roots).
- Three fixes got it there:
  1. **Extension margin** ([`secondary.ts`](src/secondary.ts)) — accept a with-extension reading only
     if it beats the bare core by `EXTENSION_MARGIN`; removed spurious extensions ("s" → "ss").
  2. **Composed-context primary templates** ([`char-type.ts`](src/char-type.ts)) — primary type
     templates built from actual formative renders (segment, take the leftmost), not isolated renders.
  3. **Primary-initial prior** ([`decode-word.ts`](src/decode-word.ts)) — a formative is
     primary-initial, so if the leftmost character doesn't confidently type as another type, treat it
     as the primary. This resolved the thin **CTE** blade that otherwise mis-types as a secondary.

### Multi-formative phrases (done)

Running text — multiple formatives — not just a single word.

- **Word boundaries are structural, not gaps:** measured inter-character gaps in a phrase are
  *uniform* (~21px), so gaps don't mark words. Instead, a formative is **primary-initial**, so each
  primary character starts a new word. `decodePhrase` ([`decode-word.ts`](src/decode-word.ts))
  splits the segmented characters at each primary, skips the narrow inter-word separator glyphs
  (much thinner than content chars), and decodes each group as a formative.
- **Round-trip** (`npm run phrase-test`): formatives → phrase text → image → decode → text.
  **100% exact (5/5)**, **11/11 per-word** on the renderable phrases.
- **CTE primaries mid-phrase:** word splitting relies on primary detection, and the thin CTE
  blade mis-types as a secondary (the primary-initial prior only rescues the *first* character).
  Non-CTE phrases split cleanly.

### svgdom hit-testing shim (done) — compact rendering unblocked

The long-deferred M1 item. svgdom ships no `isPointInStroke`/`isPointInFill`, which @zsnout's compact
(collision-kerned) layout needs.

- **Implementation** ([`src/path-geometry.ts`](src/path-geometry.ts) + patch in
  [`dom-shim.ts`](src/dom-shim.ts)): parse the path `d` (M/L/H/V + Q/C flattened) → subpaths;
  **fill** = even-odd point-in-polygon, **stroke** = distance-to-polyline < strokeWidth/2 (round
  caps/joins). Patched onto `SVGPathElement.prototype`, cached per (element, d).
- **Verified:** the previously-unrenderable phrase "saläha mela" now encodes; `compact: true` produces
  valid, tighter script (viewBox 379 vs 413 px non-compact). **Every phrase renders now** (0 skipped).
- **New finding:** compact collision-adjustment *compresses* tight words — in "saläha mela", the last
  word's primary shrinks to w=39 (vs 101) and mis-types, so it's dropped (phrase round-trip 5/7 when
  the 2 compact phrases are included). The reverse pipeline's templates are built from non-compact
  renders; decoding compact-compressed characters needs compact-context templates (or the CNN).

### Milestone 9 — CNN classifier (done, proof-of-concept)

A learned classifier that beats the template baseline on the near-identical pairs and noise.

- **Pixel augmentation** ([`src/augment-pixels.ts`](src/augment-pixels.ts)): Gaussian noise + box
  blur, wired into the generator (`--noise`, `--blur`, `--family`). Adds the appearance variation a
  CNN needs to generalize toward real/scanned input.
- **Pipeline** ([`src/cnn-data.ts`](src/cnn-data.ts) → normalized grayscale tensors;
  [`src/cnn.ts`](src/cnn.ts), `npm run cnn`): trains a small conv net (2 conv + pool + dense) and
  compares it **head-to-head with the template baseline on the same held-out noisy test set**.
- **Result** (28 consonants, noisy test): **CNN 97.6% vs template 82.5%**. The CNN eliminates the
  confusions template matching makes on the voiced/voiceless + cedilla pairs — template errors
  ḑ→ţ, g→k, v→f, t→d, č→j (×3–5 each) drop to 0–1 for the CNN. Confirms the CNN direction end-to-end.
- **Backend — RESOLVED (native `tfjs-node` now works).** History: `tfjs-wasm` can't train conv
  (`Conv2DBackpropFilter` unregistered) and pure-JS CPU was slow (~45 s/epoch at 24px), forcing a tiny
  config. `tfjs-node` (native libtensorflow CPU) initially failed to load on Node 22 — but the cause was
  a *packaging split*, not incompatibility: pre-gyp put `tfjs_binding.node` in `lib/napi-v8/` without its
  dependent `tensorflow.dll` (Windows error 126). Fix ([`scripts/fix-tfjs-node.mjs`](scripts/fix-tfjs-node.mjs),
  wired to `postinstall`): copy `tensorflow.dll` next to the binding. Now the native backend loads and
  **trains conv layers at ~1.4 s/epoch on a 48px / 32-filter model vs ~45 s/epoch pure-JS at 24px — ~30×
  faster on a 4× larger model.** Full-scale training (higher res, all classes, more epochs) is now feasible
  in seconds/minutes. GPU is *not* needed (and not available anyway: AMD card → no CUDA). Next: switch the
  training scripts from `@tensorflow/tfjs` to `@tensorflow/tfjs-node` and retrain, then expose it in the
  web tool's job panel.

### CNN persistence + inference (done)

The trained model is now **saved and reloadable** for inference — the plug-in point for the pipeline.

- **Persistence** ([`src/cnn-io.ts`](src/cnn-io.ts)): filesystem save/load IOHandlers (pure-JS tfjs
  has no `file://` handler). `cnn.ts` now writes `models/consonant-cnn/{model.json, weights.bin,
  labels.json}` after training.
- **Loadable classifier** ([`src/cnn-classify.ts`](src/cnn-classify.ts)): `loadCnnClassifier()` →
  `classifyImage(img)` / `classifyGray(gray)` → label + candidates. Inference runs fine on the
  pure-JS backend (only conv *training* was slow/unsupported).
- **Verified round-trip** (`npm run cnn-infer`): a fresh process loads the saved model and classifies
  rendered consonants at **89.3%** (weights load correctly; clean renders are slightly
  out-of-distribution vs the noise-trained model).

### Consonant CNN — ON BY DEFAULT (done) + the native-backend flip

- **Wiring** ([`secondary.ts`](src/secondary.ts) + [`decode-word.ts`](src/decode-word.ts)): the core CNN
  refines a bare core from the **grayscale** crop (`cropRgba`) — grayscale because that's its training
  domain. It's now **on by default**: `enableCoreCnn()` warm-loads the model (server warmup / tests), the
  source RGBA is threaded through `decodePhrase`/`decodeWordToText`/`decodeRegions`, and it's used when
  loaded. Falls back to template with no change if the model is absent or no gray image is passed.
- **The native-backend flip.** At 24px (pure-JS-CPU limit) the CNN *lost* to the pipeline template
  (88.6% vs 90.7%). Root cause was resolution/training, not the approach — and `tfjs-node` (~30× faster)
  fixed it: a 48px model (`npm run cnn`, ~1 min) hits 100% on its own noisy test, and the in-pipeline
  head-to-head FLIPS — `npm run secondary-cnn` → **+CNN core 90.7% vs template 85.0%**, with CNN errors a
  strict subset of the template's on the near-identical pairs (v→f, g→k, ḑ→ţ). On CLEAN cores the CNN is
  also ≥ template (96.4% vs 92.9%), so **`word-test` stays 48/48 with the CNN on** — no regression.

### Primary-feature CNN — cracks the Vr/Vv entanglement (done + wired; 80px)

The primary bakes specification, perspective, context, function, version, stem + nuisance Ca into ONE
blob. Template matching reads spec/persp only when the rest are held at *defaults*; when they co-vary it
collapses — spec 100%→65% (once context varies), and function/version/stem ~chance. Root cause (found by
difference-imaging): context sits at the top (decoupled) but function/version/stem overlap in the
bottom-right and the aligner shifts with them, and each per-feature template grid is built holding the
others at defaults — covering the full space (spec×persp×config×context×function×version×stem) is a
combinatorial wall. So this needs a **learned joint classifier, not more template grids** — feasible now
that native training is fast.

- **Model** ([`cnn-primary.ts`](src/cnn-primary.ts), `npm run cnn-primary -- [nSamples] [epochs] [size]`):
  render primaries over the FULL feature space (all targets + nuisance Ca randomized, Ca biased toward
  its defaults so default-Ca minimal primaries are in-distribution), cache them (`models/primary-cnn-data.json`,
  so re-training skips the ~13-min render), train a multi-task CNN (shared conv trunk → one softmax head
  per feature). 3000 samples / 60 epochs, **80px input**, native ~16 s/epoch.
- **Held-out, everything co-varying** (the regime template collapses on): **specification 100%, context
  ~99%, perspective ~97%, stem ~97%, version ~96%, function ~95%** — vs template ~50-65%. Cracks the entanglement.
- Model saved to `models/primary-cnn/` (`targets.json` records `size: 80`). Other sizes get suffixed paths
  (`models/primary-cnn-48/…`) so an experiment never clobbers the deployed model.
- **Wired into decode (`decode-word.ts`, [`primary-cnn.ts`](src/primary-cnn.ts)):** `enablePrimaryCnn()`
  warm-loads it (server + tests), and the primary case runs it on the grayscale crop to fill the Vr
  **context** + **function** and Vv **stem** (plus a more Ca-robust specification and **perspective** — its
  `perspective` head, ~97% held-out, is now wired through `assemble.ts` into the Ca). **`vrvv-test`: non-default
  context × function × stem round-trip 32/32 = 100%** (was 0% — completely undecoded), and **`word-test`
  stays 48/48** (these read 100% on clean/default primaries, so default words don't regress).
- **The 80px bump was what cracked function.** At 48px, function read **83% co-varying but only ~52% on
  *minimal* (default-Ca) primaries** — near-invisible, so wiring it regressed clean words. Its mark is a
  subtle bottom-right detail that 48px throws away; **at 80px it survives — function reads 100% on clean
  defaults** and round-trips end-to-end.
- **version is decoded but guarded.** Even at 80px version reads only ~75% on clean defaults (its mark is
  subtler still), so `decode-word.ts` takes it **only when the CNN is ≥0.97 confident** (`PRIMARY_VER_CONF`)
  — enough to add non-default version where it's sure without misfiring on clean words. `vrvv-test`'s
  version × stem sweep round-trips **5/6 = 83%**. Closing the last gap likely needs real (non-synthetic)
  scans or a version-specialized head.

### Warm-up: disk-cache the rendered template sets (done) — ~86 s → ~19 s per start

The decode pipeline's startup cost turned out to have nothing to do with the CNNs (all four load in
**0.07 s combined**). Timing each stage of `warmDecode` showed the cost was template grids rebuilt at
**module load**, on every server start *and every test run*: `char-type.ts` **44 s** (it renders a
4×4×4 spec × perspective × configuration grid of *composed formatives* — primary type templates can't come
from isolated renders) and `primary.ts` **28 s** (its own 64-cell Ca grid). `alphabetic.ts`/`secondary.ts`
already disk-cached theirs, which is exactly why they imported in 0.02 s.

- **Fix:** [`template-cache.ts`](src/template-cache.ts) factors out the mask→base64→JSON pattern (rather
  than adding a 4th copy of it), and both modules now build **lazily** behind `ensureTemplates()` +
  `warmCharType()` / `warmPrimary()`, cached to `models/char-type.json` + `models/primary-templates.json`.
  Derived data (chamfer distance transforms) is recomputed on load rather than stored.
- **Result:** module import **77 s → 9.5 s**, `warmCharType` **44 s → 0.01 s**, `warmPrimary` **28 s → 0.01 s**;
  total warm start **~86 s → ~19 s**, stable across runs. Cold (no cache) is unchanged (~94 s) and writes the
  caches. **Behaviourally identical** — `word` 48/48, `phrase` 7/7, `alphabetic` 15/15, `primary-aligned`
  48/48, `tricon` (top 93% / full 65% / 44/44) all match their pre-cache numbers exactly.

### Alphabetic-register decoding (done, first version) — the real multi-word fix

Investigating multi-word decode failures ("saläha mela" dropping the 2nd word) disproved
both the "compact-context templates" and "word-split segmentation" hypotheses. **Root cause:**
`textToScript` renders a word it can't parse as a formative *in sentence position* in
**ALPHABETIC mode** — it spells the word phonetically with `ALPHABETIC_PLACEHOLDER` secondaries
(letters packed into `top`/`bottom` extensions + `superposed`/`underposed`/`left`/`right`
diacritics), bracketed by `Register` glyphs. The same word isolated parses as a normal formative
(hence single-word decode is 100%). The "fragmentation" we saw was the segmenter splitting off
the side (`right`) diacritics.

- **New module** [`src/alphabetic.ts`](src/alphabetic.ts): detect `Register` glyphs → span
  boundaries; group span regions into characters (folding split-off side diacritics back in); read
  consonants from base zones (top/mid/bottom, with a "none" template + margin so the bare spine
  isn't read as a consonant) and vowels from the separable diacritic components; reassemble in
  reading order **top → superposed → core → right → bottom → underposed** (derived by round-trip).
- **Integrated** into [`decodePhrase`](src/decode-word.ts): scans regions, toggling into an
  alphabetic span at each `Register`; formative words decode as before, alphabetic words via
  `decodeAlphabeticSpan`. Returns `PhraseWord[]` tagged `formative | alphabetic`.
- **Accuracy** (`npm run alphabetic`, 15 CVCV/CV words): **13/15 exact, 94.6% char-level** — up from
  6/15 / 82%. The gain came from replacing the three per-zone consonant reads (top/mid/bottom, each
  bbox-normalized, which discarded where a mark sat and confused top s↔r, bottom n↔r/b↔c) with a
  **joint whole-base match**: stretch the base into a fixed square and match it against ~1200 rendered
  `{core, top, bottom}` references at once. Because each render costs ~260 ms (resvg), the reference
  set is **built once and cached to `models/alphabetic-base.json`** (masks only; distance transforms
  recomputed on load) — warmed at server startup so the first decode doesn't pay the build.
- **Alphabetic-base CNN — fixes n↔ż / d↔ļ** ([`cnn-alpha.ts`](src/cnn-alpha.ts) → [`alphabetic-cnn.ts`](src/alphabetic-cnn.ts),
  `npm run cnn-alpha`; warm-loaded via `enableAlphabeticCnn()`). The chamfer joint match confused those
  two pairs, and the fix took a real investigation. Ruled out along the way: **higher frame resolution**
  (no effect — the pipeline query genuinely matches the wrong template even at 96px) and a CNN on
  **isolated-render** crops (99% held-out but collapsed in-pipeline — it *drops/adds* consonants). The
  root cause: the pipeline (`textToScript`) renders an alphabetic base **subtly differently** from
  `renderGlyphToSvg(Secondary(spec))`, enough to flip these near-identical pairs — and BOTH the chamfer
  templates and the first CNN inherited that isolated-render gap. `textToSecondaries` confirmed the true
  slots (and that the encoder core is `STANDARD_PLACEHOLDER`, though rendering *that* in isolation looks
  nothing like the pipeline — the gap is in how the pipeline draws it, not the spec). **Fix:** train the
  multi-task CNN (core/top/bottom heads, on the shared `frameSquare` binary mask) on data rendered
  through the **actual `encode()` pipeline** and labelled by `textToSecondaries` — so training and
  inference share one exact domain. Deployed config: **80px** frame, 8000 samples, 50 epochs.
  Held-out (pipeline domain): core 98% / top 94% / bottom 95%.
  **In-pipeline `npm run alphabetic`: 15/15 exact, 100% char** (was 13/15, 94.6%) — n↔ż, d↔ļ **and p↔v**
  resolved; `phrase-test` **7/7**, `word-test` unaffected. p↔v (the last miss at 64px) needed the 80px
  bump: the top/bottom extension marks are small, and 64px left the top slot weakest — raising resolution
  lifted bottom 92→95% and cleared both p↔v cases (`peka`, `pika`) with zero regression.
- **Stress + gemination** (added on top of the above; same 80px pipeline-domain CNN). `textToSecondaries`
  marks a stressed syllable with a distinct `STRESSED_SYLLABLE_PLACEHOLDER` core and an intervocalic
  geminate with a `CORE_GEMINATE` bottom mark — glyphs the templates never modelled, so **before this
  those inputs actively mis-decoded** (`kalá → kalla`, `atta → ačla`). Added as two classes: **`STRESS`**
  on the core head (→ acute-accent the syllable's vowel) and **`GEM`** on the bottom head (→ double the
  core consonant); the generator now renders accented/geminated words so both are trained. Held-out
  STRESS 167/167, GEM 241/242 (they're visually distinct → near-perfect). **In-pipeline stress 0→10/10,
  gemination 0→8/8, zero regression** (plain 15/15, p/v 9/9). Stressed **diaeresis** vowels take a
  circumflex, not an acute (`ä→â`, per @zsnout's `STRESSED_TO_UNSTRESSED_VOWEL_MAP`) — handled.
- **Extension letters, top-slot gemination, reading order** (found by *reading* @zsnout's `from-text.js`
  rather than probing it — the lesson: read the encoder, don't guess from samples). Three real gaps, fixed
  together in one retrain:
  - **`w y ' " ¿`** — @zsnout's `EXT` set admits these in top/bottom, but the label space held only the 28
    **core** consonants, so any word using them was unreadable (`awka → baa`). Label space now mirrors the
    encoder: core ∈ `CORE_CONS`, top/bottom ∈ `EXT_CONS` (= CORE_CONS + the 5 ext-only letters) → **36 classes**.
  - **Top-slot gemination** — the encoder emits `CORE_GEMINATE` in `top` when `core == top` (`attka`), not
    only in `bottom`; ~40% of geminates in a random corpus are top-slot. The label guard had been *skipping*
    those samples. `GEM` is now allowed on the top head and repeats the core into whichever slot carries it.
  - **Reading order** — the encoder consumes the superposed vowel *before* the letter-core, so the true
    order is `superposed → top → core → right → bottom → underposed` (we had `top → superposed`). It only
    differs when both are present, which needs an ext-only letter — so no earlier test could catch it.
  - **Sizing matters:** at 8000 samples the 36-class space thinned per-class density (bottom head 96→92%)
    and regressed the common letters (`tuni→tuzi`, `tapi→tavi`). **12000 samples / 60 epochs** restored it
    (bottom 95.5%, w 98% / y 99% / `'` 97%, STRESS 259/259, GEM 498/503) — that's the deployed config.
  - **Result:** ext letters **0→8/8**, top-slot gemination **0→6/6**, with **zero regression** (plain 15/15,
    p/v 9/9, stress 10/10, bottom-gem 8/8; `alphabetic` 15/15, `phrase` 7/7, `word` 48/48). Combined
    alphabetic probe suite **42/56 → 54/56**.
- **The dense 3-letter core — a training-distribution hole, not a model limit.** The last top-gem misses
  (`attka→attxa`) were bottom-*letter* errors, so we measured bottom accuracy **conditioned on how crowded
  the base is** rather than tuning blind. That exposed a cliff: `core+bottom` 97%, `placeholder+top+bottom`
  96%, but **`core+top+bottom` (a full 3-letter core, e.g. `atkra`) only 47%** — because *no generator form
  produced it*. It arose only when random syllables happened to abut (~380 train samples vs thousands for
  every other context). Adding an explicit `V X c Y V` form (~12% of syllables) 4×'d its data and lifted
  every context: dense **47→75%**, top-GEM+bottom **88.5→94%**, core+bottom **97→98.5%**,
  placeholder+top+bottom **96→97%** — and took **top-slot gemination to 6/6** with no regression.
  **Lesson: when one case lags, condition the metric on context before touching hyper-parameters — the
  aggregate (bottom 95%) completely hid a 47% sub-population.**

### Robust primary detection (CTE) — done

The primary's silhouette varies with its Ca (perspective × configuration); the thin **CTE** blade under
a multiplex/duplex configuration or perspective A otherwise mis-typed as secondary/tertiary/quaternary.
Fix ([`composedPrimaryTemplates` in char-type.ts](src/char-type.ts)): build the primary type templates
over a **spec × perspective × configuration grid** (4×4×4) instead of 4 default-Ca renders.

- Original CTE-failing grid (spec × persp × {UPX,MSS,MSC,MDS}): **58/64 → 64/64**.
- Held-out harder configs (duplex/multiplex-dual + extension variation not in the grid): 89–96% raw,
  and **100% with the existing first-char primary prior** (every miss scores <0.7, where the prior
  corrects it — and a formative's primary is always its first character).
- No regression: `word-test` 48/48, `phrase-test` 7/7 (the larger template set didn't pull non-primary
  characters into the primary class).

### Aligned-primary decode (spec + perspective) — done

Primary *detection* was already robust (CTE, above); the aligned *decode* — reading specification +
perspective from a segmented primary — was the weak link: single-Ca templates gave spec 80% /
perspective 63% under Ca variation (spec drifted to CTE; perspectives G/N read as M). Fixed in
[`decodePrimaryAligned`](src/primary.ts) with two changes, each matched to how a feature lives in the glyph:

- **A specification × perspective × configuration grid** of templates (extracted the same way a query
  is — rendered in a word, segmented, cropped) so a template with the query's feature exists whatever
  the nuisance Ca is (same idea as the type-detection grid).
- **The right metric per feature:** perspective is a *global left mark* → a **joint whole-shape** match
  (bbox-stretched to a square, symmetric Chamfer) wins; specification is a *subtle central detail* →
  the isolated (aligned) **core zone** wins. (Empirically: whole-shape gave persp 88% but spec only
  63%; core-zone gave spec 92% — so each feature uses its own.)

Result: on a broad Ca grid (spec × perspective × configuration × affiliation) **spec 80%→98%,
perspective 63%→84%**; the dedicated `primary-align-test` went **70.8%→100%** (spec 100%, perspective
100%). No regression (`word-test` 48/48). Remaining perspective errors are mostly A→G under
affiliations the grid doesn't cover — adding an affiliation axis lifts it a further ~4–7 pp at ~2×
the (module-load) build cost, deferred as not worth it yet.

### Secondary cluster extensions — full breadth (done)

`EXTENSION_SET` was a 5-consonant subset (`t k p s m`), so a biconsonantal root whose second consonant
was any of the other 23 decoded that extension at **0%**. Structural check first: a 2-consonant root
renders as core + **bottom** extension (15/15), a 3-consonant root as top + core + bottom *together*
(never top-only). So top-only extensions never occur — the old top templates were dead weight, and
3-consonant clusters aren't modelled by single-extension templates anyway.

Fix ([`secondary.ts`](src/secondary.ts)): `EXTENSION_SET` = the **full 28-consonant** inventory, and
build **bottom-only** joint templates (28 bare + 28×28 core+bottom = 812). Since each is a ~260 ms
resvg render (~3.5 min), the set is **cached to `models/secondary-ext.json`** (masks only) and warmed
at server startup — same pattern as the alphabetic/primary caches.

- **Bottom-extension recovery: 0% → 97%** across all 28 extensions × 8 cores (7 misses: mostly `s`
  dropped on k/t/p via the extension margin, plus a couple of near-consonant pairs).
- `secondary-test` (broadened to bottom extensions incl. formerly out-of-set l/n/r/d/ç): **94.8%**
  (core 100%, bottom-ext 94.8%, vowel 100%).
- No regression: `word-test` 48/48; **bare cores 28/28 clean** (the margin still blocks spurious
  extensions).

### 3-consonant clusters (top+core+bottom) — decompose reader + top-extension CNN

A triconsonantal root C1-C2-C3 renders as top:C1 + core:C2 + bottom:C3 in one base; a full joint is 28³.
So it's decomposed ([`secondary.ts`](src/secondary.ts)):

- **Read core+bottom from the LOWER portion** (top 35% excluded). With the top included, the core+bottom
  match collapses (97%→24%); excluding it restores **93%** on 3-consonant bases — and it's a *pure win*
  for the common case too (2-consonant 97%→**100%**, so `secondary-test` rose 94.8%→**97%**).
- **Read the top with the top-extension CNN** ([`cnn-top.ts`](src/cnn-top.ts) → [`top-cnn.ts`](src/top-cnn.ts),
  `npm run cnn-top`). The old margin-gated top-zone template capped at ~68% top / 48% full — it both
  **missed** real tops (19%, the `TOP_MARGIN` gate said "none") and **mis-IDed** them (13%, it conditioned
  on a possibly-wrong core). A single CNN over the whole base crop classifies the top as `{NONE} ∪ consonants`,
  so the **NONE class is the top-vs-none detector** and the consonant classes fix identity — in one model,
  learning the core conditioning implicitly. 6000 secondaries (realistic bare/+bottom/+top+bottom mix,
  64px), native ~17 s/epoch. **Held-out: presence (top vs none) 99%, identity | top 93%, spurious-on-NONE 0%.**
  0% spurious means no confidence guard is needed — it never invents a top on bare/2-consonant bases.
- **Result:** 3-consonant **top 68%→93%**, **full (top+core+bottom) 48%→65%** (`npm run tricon-test`),
  no-spurious **98%→100%**, whole-word round-trip 2/6→3/6. No regression: `word-test` **48/48** (all three
  CNNs on), `secondary-test` **97%**.
- **Next bottleneck is now core+bottom, not the top.** With top at 93%, `full` is capped by the core+bottom
  template in the 3-consonant regime (~12% coreWrong); the remaining word misses (`strala→sprala`,
  `kspala→ksmala`, `aprtala→avrtala`) are all core/bottom, not top. Lifting `full` further means a core+bottom
  classifier (or extending the secondary CNN), separate work.

### Case (Vc) decoding — all 68 cases (done)

The pipeline never decoded case — it always defaulted to THM. Case rides on the *case-bearing*
secondary (the last one) as **superposed + underposed diacritics**, and the (superposed-shape,
underposed-shape) pair **uniquely identifies all 68 cases** (0 collisions; the 32 glottal-stop cases
are told apart by the `_WITH_LINE`/`_WITH_DOT` diacritic variants). So [`case-vowel.ts`](src/case-vowel.ts)
inverts @zsnout's forward case→Vc mapping into a shape-pair → case table (built from data, no rendering).

- **Key on the raw diacritic SHAPE labels, not vowel letters.** `decodeSecondary`'s vowel map is
  calibrated for a phonological reading and *mislabels* the case diacritics (reads HORIZ_BAR as "ä"
  where ABS wants "e") and drops CURVE_TO_LEFT/RIGHT. So `decodeSecondary` now also returns
  `superposedShape`/`underposedShape` (raw classifier labels), and the case reader uses those.
- **`case-test` round-trip: 70/70 = 100%** (all 68 cases on a single-consonant root + 2 multi-consonant
  spot checks — the case correctly lands on the last secondary, e.g. `aktalo` = kt+ERG). No regression
  (`word-test` 48/48).
- **Vr** is *not* a secondary diacritic — it's in the **primary** (function/specification/context;
  specification already decoded). So "vowel→slot Vr" is really further primary decoding, tracked below.

### Milestone 8 — local tool: web UI + CLI (done, v1 + v2 + UI polish)

Reframed from "released library" to a **local tool** — no npm publish, no single binary (native deps
like `@resvg/resvg-js` make single-executable bundling fragile, and there's no distribution need).

- **v1 (done) — visual dashboard** ([`src/server.ts`](src/server.ts) + [`src/web/index.html`](src/web/index.html),
  `npm run serve` → http://localhost:3939): a zero-dependency Node `http` server over the same core
  functions the CLI uses. `POST /api/encode` (text → SVG/PNG) and `POST /api/decode` (image → text with a
  segmentation overlay + per-word/char breakdown, formative vs alphabetic tagged). The forward path is
  instant; the decode path warms its template sets lazily (~1 min) so the server starts immediately.
  Verified end-to-end over real HTTP: encode "saläha mela" → decode → "saläha mela". The CLI
  ([`src/cli.ts`](src/cli.ts)) is kept for scripted/console use; both wrap the same core.
- **v2 (done) — data/model control panel** ([`src/jobs.ts`](src/jobs.ts) + `/api/jobs*` endpoints +
  the UI's "Data & models" panel): run the project's own scripts — **dataset generation, CNN training,
  and every round-trip/eval harness** — as tracked background jobs with live polled logs and cancel.
  - **Process lifecycle** (the whole point — earlier training left orphaned workers): each job is a
    **single** process, `node --import tsx <script>` (no npm/shell wrapper), and cancel/shutdown kill
    the whole **process tree** (`taskkill /T` on Windows). The server kills every running job on exit.
  - **Safety:** only whitelisted scripts run, and each job's argv is built server-side from a typed
    args object (no arbitrary path/flag from the client); one heavy (dataset/train) job at a time.
  - **Verified:** heavy-guard rejects a concurrent dataset/train; cancel takes the process 1→0 (no
    orphan); killing the server takes its jobs down (no orphan); a test harness job runs to completion
    with captured logs.
- **UI polish (done):** the three areas are now **tabs** (Encode · Decode · Data & models), each
  URL-hash-linked, wired up by a single `loadscene()` init. The Data tab gained a **Pipeline & caches**
  status strip (decode-warm + alphabetic-cache-present, mirrored by the header pill, driven by
  `/api/status`'s new `alphaCache`/completed-`decodeWarm` fields) and a **Build / rebuild alphabetic
  cache** action backed by a new `cache:alphabetic` job ([`src/build-alphabetic-cache.ts`](src/build-alphabetic-cache.ts))
  — so the ~1200-glyph joint base-template cache (see alphabetic decoding above) can be (re)built from
  the browser, honestly labelled as a several-minute one-time job.
- Supporting change: `encodePng` added to [`image-io.ts`](src/image-io.ts) (PNG buffer for the overlay).

---

### Status at a glance

Everything through Milestone 9 is built; the reverse pipeline round-trips at 100% on formative words
and phrases. What remains is accuracy polish on specific character classes and the optional heavier
tooling — none of it blocks the tool being usable today.

| Milestone / feature | State |
|---|---|
| M1 DOM shim · M5 segmentation · M6 classifier · M7 decoder | ✅ done |
| Full composed-word → text · multi-formative phrases | ✅ done — 100% round-trip |
| svgdom compact-render hit-testing shim | ✅ done |
| **M9** CNN — native training (tfjs-node), 48px | ✅ done — **beats template 90.7% vs 85.0%** in-pipeline |
| Alphabetic-register decoding — **base CNN** | ✅ done — **100% char / 100% exact** (was 94.6%/87%); n↔ż, d↔ļ, p↔v fixed + **stress, gemination (both slots), ext letters `w y ' " ¿`** decoded. Pipeline-domain 80px CNN, 36 classes, 12k/60. Probe suite 42/56→**54/56** |
| Robust primary **detection** (CTE) | ✅ done — 64/64 grid |
| Aligned primary **decode** (spec + perspective) | ✅ done — spec 98% / persp 84% under Ca (was 80%/63%) |
| Secondary cluster extensions (bottom) — full breadth | ✅ done — 97% over all 28 (was 0% out-of-set) |
| 3-consonant clusters (top+core+bottom) — **top-extension CNN** | ✅ top 68%→**93%**, full 48%→**65%** (was 0%); no-spurious **100%**, word-test 48/48. Cap now core+bottom, not top |
| Case (Vc) decoding | ✅ done — 100% over all 68 cases (was always THM) |
| Consonant CNN — **on by default** (native 48px) | ✅ done — beats template on noise, no clean regression |
| Primary-feature CNN (entanglement) — trained + wired (80px) | ✅ decodes Vr **context + function** + Vv **stem** (100% round-trip, was 0%; word-test 48/48). **version** guarded (~0.97 conf, 83% round-trip) |
| Secondary core+bottom CNN (80px, formative-domain) | ✅ done — **real-lexicon round-trip 23.5% → 92.6%** (L1–L4); reads core/top/bottom per-slot, hybrid bare-vs-ext gate |
| **M8** local tool — tabbed web dashboard + CLI + data/model job panel | ✅ v1 + v2 + UI polish done |

### ⚠️→✅ Reality check: the REAL-lexicon number was 23.5%, not ~100% — now 92.6% (2026-07-14)

Every headline number *above* is measured on a **hand-picked, easy corpus**. Measured against the actual
@zsnout lexicon (4387 roots; `npm run lexicon-test -- 100`, 100 roots sampled per length) the story was very
different — and fixing it (tasks L1–L4 below) took it from **23.5% → 92.6%**:

| Root length | share of lexicon | baseline | after L1–L4 |
|---|---|---|---|
| 1-consonant | 1% | 100% | **100%** |
| 2-consonant | 15% | 67% | **95%** |
| **3-consonant** | **37%** (largest class) | 35% | **91%** |
| **4-consonant** | **33%** | 0% | **93%** |
| **5-consonant** | **14%** | 0% | **93%** |
| **WEIGHTED** | | **23.5%** | **92.6%** |

The 23.5% baseline (vs `word-test`'s 100%) also **crashed on ~13% of samples** (56/425). Three separate
problems, found together — all fixed below:

1. **The test corpus is unrepresentative — the root cause of the blind spot.** `word-test`'s 48/48 uses
   toy roots (`l`, `s`, `m`, `r`, `kt`, `sm`); `tricon-test`'s 3/6 uses hand-picked `str`/`mlk`/`ksp`. Real
   3-consonant roots score **12%**, because real roots use the full inventory (`ţ ç ż š ň ḑ` …), not
   convenient Latin letters. We were optimizing against an easy sample.
2. **4–5 consonant roots (47% of the lexicon) are at 0%.** They pack into **multiple secondary
   characters**, and `char-type` mis-types the extra one: for 4-consonant roots the observed shapes are
   `psq`×61 (primary-secondary-**quaternary**), `pss`×35, `psp`×2 — the same structural slot typed
   inconsistently, so trailing root consonants are routed to the wrong decoder and dropped
   (`armpwala → armmala`). **But char-type is necessary, not sufficient:** the 35 that *did* get the correct
   `pss` shape still scored **0%**, so the per-secondary decode is failing on these roots too (they use the
   full consonant inventory — the same weakness as L4). Expect to need both fixes.
3. **`decodeWordToText` throws on real input** (~13% of samples): when no secondary is detected there is no
   root, and `featuresToText` → `formativeToIthkuil` raises *"You must provide the root of a formative"*.
   Uncaught ⇒ `/api/decode` would 500.

**Agreed plan (in order):** L1 re-baseline the harnesses on real lexicon roots so everything downstream is
measured honestly → L2 fix the crash (graceful degradation) → L3 fix `char-type` for multi-secondary roots
(unlocks ~47% of the lexicon) → L4 the core+bottom classifier for 3-consonant clusters.

#### Lexicon benchmark harness (done) — the honest number, and how to keep it honest

[`lexicon.ts`](src/lexicon.ts) exposes the real root forms (`ROOT_FORMS`, `rootsOfLength`, and a
deterministic, evenly-spread `sampleRootsOfLength` so a run is comparable to the last one).
[`lexicon-roundtrip.ts`](src/lexicon-roundtrip.ts) — `npm run lexicon-test -- [perLength]` — reports
per-length round-trip, the **lexicon-weighted total**, the detected char-type shapes (how structural
failures surface), and crash counts.

- **Baseline to beat: 23.5%.**
- `word-test` keeps its easy corpus but is now documented as a **feature-level regression gate, not a
  benchmark** — it isolates spec/Vn/case/CNN changes, and still passes 48/48. Never cite it as accuracy.
- **Sample size matters:** two different 25-root samples of the same length disagreed by ~3× (3-consonant
  read 12% vs 40%). Quote ≥100/length; the 25 default is a quick look only.

#### Graceful decode failure (done) — a recognizer must not throw

`featuresToText` fed `formativeToIthkuil`, which throws outright without a root ("You must provide the root
of a formative") — and on a hard image the pipeline can legitimately decode **no secondary at all**, leaving
no root. That crashed **~13% of real-lexicon inputs** (56/425) and would have 500'd `/api/decode`.

- [`assemble.ts`](src/assemble.ts) now returns `""` when there's no root, and catches other combinations
  @zsnout rejects (a garbled decode can yield an impossible feature set). A failed decode is a *reported*
  outcome, not an exception. [`server.ts`](src/server.ts) also wraps `decodePhrase` as a backstop → 200
  `{ok:false, error}` rather than 500.
- **Crashes 56 → 0; lexicon-weighted unchanged at 23.5%** — correct, since a crash was already a failure.
- **It was masking a diagnosis:** those inputs now report their char shapes — `pp` (primary+**primary**),
  `pq`, `ppq`, `pqq`, `ppp` — i.e. **no secondary detected**. Every crash was a char-type mis-typing of the
  root character, which is direct evidence for L3.

#### Char-type on real roots (done) — composed secondaries, 80% → 97%

The type templates for **secondaries** were isolated bare cores (`Secondary({ core })`), while the primary
ones had long since been rebuilt from **composed formatives** (with a comment explaining exactly why). But a
real root's secondary carries top/bottom extensions, and roots >3 consonants spill into extra secondaries —
none of which looks like a bare core. Real secondaries matched at only **~0.43**, so primary/quaternary
templates won by default, and the mis-typed characters were routed to the wrong decoder and dropped.

- **Every failure was a secondary** (→quaternary ×48, →primary ×21); the primary never mis-typed.
- **Fix:** `composedSecondaryTemplates()` renders real lexicon roots (12 per length, lengths 1–5) as
  formatives and lifts the secondaries out — region 0 is the primary, the rest are the root's secondaries.
  Covers the whole shape space: bare core, core+bottom, top+core+bottom, and the multi-secondary spill.
  Bare-core templates are kept alongside. `CACHE_VERSION` bumped (a stale cache would hide the fix).
- **char-type on real roots: 80.3% → 96.9% held-out** (5-consonant **59% → 98%**, 4-consonant 74% → 93%).
  Measured on roots *excluded* from the template sample — testing on the same deterministic sample would
  have been contamination, and it inflated the figure by ~1.4 pp (98.3% → 96.9%).
- **Structure is now correct:** 4/5-consonant shapes went `psq`×61 → **`pss`×93** / `pss`×96. Crashes stay 0.
- **Lexicon-weighted 23.5% → 26.1%**; no regressions (`word` 48/48, `phrase` 7/7, `alphabetic` 15/15,
  `primary-aligned` 48/48, `tricon` unchanged).
- **As predicted, necessary but not sufficient:** 4/5-consonant roots are still 0% — the characters are now
  routed correctly, but `decodeSecondary` misreads them. That is L4, and the misses named the cause (below).

#### Secondary decoding for real roots — inventory + spilled placeholders (done) — 26.1% → 52.0%

`decodeSecondary` was built for the toy corpus and broke on real roots two structural ways, both fixed by
reading @zsnout's encoder (`construct/formative.js` packs a root via `textToSecondaries(root,
{ forcePlaceholderCharacters: true })` — the same encoder already reverse-engineered for alphabetic mode):

- **(a) Extension inventory was the 28 cores only.** `EXTENSION_SET = CONSONANTS`, but @zsnout's `EXT` also
  admits `w y ' " ¿`. Measuring the lexicon, its alphabet is *exactly* the 28 cores plus **`w` (673 roots)
  and `y` (515)** — **27% of all roots** — and both occur ONLY root-finally (0 start with or carry one
  medially), so only the bottom slot needed them. Without a template, a `w` was read as its nearest guess
  (`dš`). Added `EXTENSION_ONLY_CONSONANTS = ["w","y"]` → `EXTENSION_SET = EXTENSION_CONSONANTS`. **+7 pts
  (26.1 → 33.1%)** on its own.
- **(b) Roots >1 secondary "spill" into placeholder-core characters.** `forcePlaceholderCharacters` means
  only the FIRST secondary of a root takes a consonant core; the rest are `STANDARD_PLACEHOLDER` with
  extensions only. The decoder had no such template, so it forced the placeholder onto a consonant and
  injected a phantom letter (`rmpw → rmpdw`), pinning 4–5 consonant roots at **0%**. Added placeholder+bottom
  templates (no bare variant — always a bottom, per the encoder), and — crucially — **routed by position, not
  by score**: `decodeRegions` marks the 2nd+ secondary in a consecutive run as *spilled* and matches those
  against the placeholder set only. A spilled secondary is placeholder by construction, so it never competes
  with (and steals) a real core. Placeholder decodes to no letter of its own.
- **Result: lexicon-weighted 26.1% → 52.0%** (4-consonant **0% → 55%**, 3-consonant 40% → 55%, 2-consonant
  72% → 81%, 5-consonant 0% → 5%). No regression: `word` 48/48, `phrase` 7/7, `alphabetic` 15/15,
  `secondary` unchanged, and — the trap avoided — `tricon` full stays **65%** (an earlier score-based attempt
  had dropped it to 59% with `andrala → nrala`; position routing fixes that).

#### Secondary core+bottom CNN (done) — 52.0% → 92.6%

The remaining cap was core+bottom *accuracy*: chamfer is 100% on a bare/2-consonant base but collapses to
~69% once a top extension is present (the top makes the base taller, every mark shifts, and a whole-frame
match trades slots off) — the entanglement the alphabetic CNN already solved. Same recipe on a *formative
root*: a multi-task CNN ([`cnn-secondary.ts`](src/cnn-secondary.ts) → [`secondary-cnn.ts`](src/secondary-cnn.ts),
`npm run cnn-secondary`), one softmax head per slot over the `frameSquare` binary mask.

- **Pipeline-domain data (relearned again):** reusing the *alphabetic* CNN on these transferred poorly
  (core 64–95%, top 32–81%) — different render domain. So each sample is a real lexicon root rendered as a
  formative (`encode(formativeToIthkuil({ root }))`), its secondaries extracted, and labelled from
  `textToSecondaries(root, { forcePlaceholderCharacters: true })` — the exact call `construct/formative.js`
  uses. ~6000 samples (bounded by the # of distinct root secondaries), 80px, 60 epochs. Held-out **core 99.0%
  / top 96.1% / bottom 94.9% / core+bottom-both 94.2%**.
- **Hybrid, because the CNN hallucinates a bottom on a *lone* core** (bare `s` read as `{s, bottom:m}` — it's
  trained mostly on extension-bearing secondaries), which alone dropped 1-consonant roots 100%→72% and
  `word-test` 48→34. Fix: the CNN reads the slot *identities*, but when there's **no top**, chamfer's reliable
  bare-vs-extension gate decides whether a **bottom is present at all** (it drove the old 48/48); a lone core
  then defers to the consonant CNN (100% in its domain). With a top or a spilled placeholder, the CNN's
  bottom is trusted (it's strong on dense bases; chamfer's top-excluded gate is the weaker one there).
- **Result: lexicon-weighted 52.0% → 92.6%** (2-consonant 81→95%, 3-consonant 55→**91%**, 4-consonant
  55→**93%**, 5-consonant 5→**93%**, 1-consonant **100%**). `phrase` 7/7, `alphabetic` 15/15, `tricon` word
  round-trip 3/6→**4/6**. `word-test` **46/48** — the 2 misses are a `t↔ḑ` bottom-extension confusion (a
  near-identical pair) on root `kt`; a small letter-level cost for a **+40-point** lexicon gain.

### Next up (planned — nothing below is built yet)

- **Real scans — the big frontier.** Everything above is measured on clean synthetic renders; real
  photos/scans/hand-drawing are unhandled. Two parts: (1) **deskew/denoise preprocessing** to normalize a
  scan toward the clean domain; (2) a **retrain of the four pipeline-domain CNNs with `AUGMENT=1`** — the
  augmentation infra is already built ([`augment.ts`](src/augment.ts): rotation/blur/speckle/stroke
  morphology; augmented runs write to `-aug` paths, so they don't touch the deployed clean models). Needs a
  small set of real labelled scans to validate against.
- **Secondary CNN — the remaining ~7% of the lexicon** (round-trip 92.6%). Residual is per-slot letter
  confusions on hard bases: `t↔ḑ` on 2-consonant `kt` (the 2 word-test misses), and the dense 3-letter-core /
  spilled cases in 4–5 consonant roots (~93%). Levers, in effort order: **oversample the confusable pairs**;
  **`AUGMENT=1` retrain** (the flag now exists — jitter expands the ~6000 distinct root secondaries); more
  epochs; a near-identical-pair tie-break. Diminishing returns vs the +40 points already banked.
- **Multi-line segmentation.** Split a multi-line image into lines before decoding. Pure upstream
  preprocessing — **no retrain** (the CNNs see identical per-character crops); it just feeds the existing
  pipeline line by line.
- **Warm-up — the remaining ~19 s** (down from ~86 s; see the done section). What's left: `warmAlphabetic`
  9.4 s (recomputing ~1200 chamfer distance transforms on load — storable, but they're ~15 MB of Float32, so
  it'd want a binary sidecar not base64 JSON) and ~9.5 s of module import (`tsx` compiling the graph +
  tfjs-node native load — a `tsc`/`dist` build would cut it). Both modest and optional.
- **Vr/Vv `version` — the last primary-feature gap.** context + function + stem + perspective all round-trip;
  version still reads only ~75% on clean defaults even at 80px (its mark is subtler), so it's taken only
  above a 0.97 confidence guard (83% round-trip). Closing it likely needs **real scanned data** or a
  **version-specialized head**, not more resolution.
- **Alphabetic — the dense 3-letter core** (`core + top + bottom` in one base, e.g. `atkra`) — lowest
  priority. It's the last weak alphabetic context (probe 2/6; all others 94–98.5%), but re-weighting is
  exhausted (zero-sum: 12→25% share lifted dense 75→79% but regressed the common `mela` shape and the probe
  suite 58/62→57/62). Remaining levers are ~2.5 h each — **more total data** (N 12k→20k) or **more capacity**
  (trunk is only 16/32/32) — and the shape needs a 3-consonant cluster inside one syllable, so it's rare.
  Known-good model preserved at `models/alpha-cnn.keep`.

#### Resolved / decided-against (kept so they aren't re-proposed)

- **Alphabetic tone (`left` diacritic) — not a feature.** `textToSecondaries` never assigns `left` (verified
  in the encoder source *and* 0/20 000 random words); tone is formative-level, absent from alphabetic
  spelling. Nothing to build.
- **"Non-CNN polish" — superseded by the CNNs.** Aligned perspective is now read by the primary CNN's
  perspective head (wired through `assemble.ts`); the `s`-on-k/t/p bottom extension is subsumed by the
  secondary CNN (~95% bottom). No standalone chamfer-tuning task remains.

**Web-tool (M8) polish ideas — design & functionality:**

- **Decode inspector:** click a segmented region in the overlay to see its cropped glyph, detected
  type, and the top candidate matches with scores (turn the flat words-table into a drill-down).
- **Round-trip in one view:** an "encode → decode" button that renders text, decodes its own image,
  and diffs the result inline (great for spotting regressions without leaving the page).
- **Job ergonomics:** per-job elapsed timer that ticks live; "clear finished" button; download-log;
  a small toast when a background job finishes while you're on another tab.
- **Cache/dataset visibility:** list what's on disk (which datasets, model dirs, the alphabetic cache
  with size/date) and let a dataset be previewed (a few sample glyphs) — the server already has the pieces.
- **Encode niceties:** dark/light-aware SVG preview zoom/pan; copy-SVG-to-clipboard; a few example
  words as quick-fill chips; show the parsed structure (primary/secondary/…) alongside the render.
- **Persisted UI state:** remember the last tab, encode text, and form values in `localStorage`.
- **Robustness:** friendlier errors when the decode pipeline is still warming (the UI knows via
  `/api/status` — disable Decode with a "warming…" hint instead of letting the first call block).
- **Accessibility/keyboard:** tab via arrow keys, `Enter` to encode, focus management on tab switch.

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

The pipeline is built and usable end-to-end (`npm run serve` for the web tool, or the CLI). The
original M1 forward-spike and everything through M9 are done — see **Status at a glance** and the
completed `### … (done)` sections above. Pick the next task from **Next up (planned)**; the natural
candidates are **M8 v2** (data/model control panel) or an accuracy item (alphabetic → past 82%, or
the perspective-independent primary *alignment*/decode path). No milestone is currently blocking.

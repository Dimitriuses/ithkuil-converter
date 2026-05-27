# Ithkuil OpenType ↔ Glyph Image Converter — Project Plan

## Overview

This project converts Ithkuil text between two representations:

- **Forward:** Ligature/OpenType encoded text (ithkey format) → official Ithkuil script image (SVG/PNG)
- **Reverse:** Official Ithkuil script image → Ligature/OpenType encoded text

The glyph source is the [`mklcp/ithkey`](https://github.com/mklcp/ithkey) project, which ships `ithkuil.ttf` (authored by Ykulvaarlck) — a font that encodes glyphs using Unicode combining diacritics stacked on base characters. The font's own OpenType engine (GSUB substitution + GPOS positioning) already resolves inter-glyph placement, so the compositor does not need to implement layout rules from scratch. What it does need is a validation pass to confirm that each glyph's shape and position matches the official New Ithkuil script specification at [Chapter 12](https://ithkuil.net/newithkuil_12_script.htm).

---

## Architecture

```
Encoded text ──► Parser ──► Glyph Resolver ──► Compositor ──► Glyph image
                                   ▲                                      │
                            Glyph Catalog                                 │
                            (SVG map +                                    │
                           encoding table)                                │
                                   ▲                                      │
Encoded text ◄── Decoder ◄── Classifier ◄── Segmenter ◄── Preprocessor ◄──┘
```

---

## Phase 0 — Research & Encoding Analysis

This is the most critical phase. Before writing any converter code, both encodings must be fully understood. The key insight going in: the ithkey font already has inter-glyph positioning resolved via its combining-diacritic mechanism and OpenType GPOS tables. The work here is to audit and map that encoding, not to re-derive layout rules.

### 0.1 — Ithkey Encoding Audit

Clone `mklcp/ithkey` and catalogue every key sequence the keyboard produces. Each "Ithkuil character" in input text is a Unicode base codepoint followed by one or more combining marks (Unicode category `M`). The font maps these stacked sequences to the correct composed glyph. Document every valid `(base, [...combiners])` combination and the glyph it renders to, using the included font maps (`ithkuil_font_map_00-4f.png`, `ithkuil_font_map_00-7f.png`) as a visual reference.

### 0.2 — OpenType Table Extraction

Use `opentype.js` or Python's `fonttools` to extract from `ithkuil.ttf`:

- **GSUB table** — all Glyph Substitution lookups (ligature substitution, contextual, chained-context). Every lookup type must be audited, not just `LookupType 4` (simple ligatures).
- **GPOS table** — all Glyph Positioning lookups (mark-to-base, mark-to-mark). These encode exactly where each combining diacritic is placed relative to its base glyph. Because this is already resolved in the font, the compositor does not need to reimplement this logic; it only needs to consume the font's rendered output.

This produces the authoritative encoding map: which input codepoint sequences produce which final positioned glyphs.

### 0.3 — Official Glyph SVG Inventory

Extract every glyph outline from `ithkuil.ttf` as an SVG path (using `fonttools`'s `ttx` command or `opentype.js`'s `glyph.getPath()`). Assign each a stable, descriptive `GlyphID` (e.g. `PRIMARY_3_EXT_UPPER_TONAL`). These IDs are the shared language between all modules in the project.

### 0.3 — Glyph SVG Inventory (`build_glyph_inventory.py`)

**Input:** `font_analysis/cmap.json`, `font_analysis/glyphs.json`  
**Output:** `inventory/glyph_inventory.json`, `inventory/glyph_inventory.md`, `inventory/svg/*.svg`, `inventory/class_*.json`

Assigns a stable `GlyphID` to every codepoint in the ithkey range, exports one SVG file per unique glyph (with corrected y-axis flip), and writes a markdown catalog for use during Phase 0.5 validation. GlyphIDs follow the scheme `CLASS_DESCRIPTOR` (e.g. `PRIMARY_Q`, `CONSONANT_T_EJ`, `DIACRITIC_01`, `PLACEHOLDER_VBAR`).

### 0.4 — Bidirectional Mapping Table (`build_mapping_table.py`)

**Input:** `inventory/glyph_inventory.json`, `font_analysis/diacritic_sequences.json`, `font_analysis/cmap.json`  
**Output:** `mapping/mapping_table.json`, `mapping/forward_index.json`, `mapping/reverse_index.json`, `mapping/composed_glyphs.json`, `mapping/diacritic_slot_analysis.json`, `mapping/mapping_table.md`

Combines the base-glyph inventory with the full enumeration of base+diacritic sequences from the font's GSUB ligature table. Produces:
- `forward_index.json` — `sequenceKey → GlyphID` (used by the encoder/compositor)
- `reverse_index.json` — `GlyphID → [sequences]` (used by the decoder)
- `diacritic_slot_analysis.json` — every `(baseClass, slotIndex, diacriticCodepoint)` triple, mapping to the resolved glyphs it produces. This is the empirical evidence for the slot assignment open question in the encoding audit.

Produce a JSON/YAML file with entries of the form:

```json
{
  "sequence": ["U+A80A", "U+0308"],
  "glyphId": "PRIMARY_3_EXT_UPPER_TONAL",
  "category": "primary",
  "ch12Section": "12.1"
}
```

Valid categories: `primary`, `secondary`, `secondary-rotated`, `tertiary`, `quaternary`, `diacritic`, `bias`, `register`. The `ch12Section` field links each glyph directly to its governing rule in Chapter 12. This file is the heart of the entire project — both pipelines depend on it being correct.

### 0.5 — Glyph Validation Against Chapter 12

> **This step is the core addition relative to a naive encoding-only approach.** The ithkey font handles positioning, but its glyph *shapes* must be checked against the official New Ithkuil script specification.

For each glyph in the inventory, compare its rendered form against the corresponding figure in [Chapter 12 of the New Ithkuil grammar](https://ithkuil.net/newithkuil_12_script.htm). Produce a validation report with a ✓/✗/⚠ status per glyph and a description of any discrepancy.

The full checklist, by section:

**Primary Characters (Sec. 12.1, Figures 1–5):**
- Specification × Context combinations (Figure 1)
- Perspective × Extension strokes (Figure 2)
- Configuration × Affiliation × Essence variants (Figure 3)
- Stem × Function × Version × Plexity markings (Figure 4)
- Correct assembly of all of the above in a complete Primary Character (Figure 5)

**Secondary Characters (Sec. 12.2):**
- All 28 core consonantal forms match the official table
- Upper and lower consonant-cluster extensions (Sec. 12.2.1) are correct
- VXCS Degree diacritics (underposed; Sec. 12.2.2) are correctly positioned
- Type-2 (superposed dot) and Type-3 (superposed bar) diacritics on Secondary Characters
- Right-side dot for whole-formative scope (Sec. 12.2.2)
- Rotated Secondary Characters for Slot VII are laterally rotated exactly 180° — not vertically flipped (Sec. 12.2.3)
- Specialized CS-Root and Personal-Reference Root forms (Sec. 12.2.4)

**Tertiary Characters (Sec. 12.3):**
- Composite glyph represents correct combinations of Valence, Aspect, Phase, Effect, Level

**Quaternary Characters (Sec. 12.4):**
- Plain vertical bar base is correct
- VC Case and VK Illocution+Validation extensions (top and bottom) are correct
- Mood diacritics (superposed; Sec. 12.4.1)
- Case-Scope diacritics (underposed; Sec. 12.4.1)
- Case-Accessor Affix forms and Slot V vs. Slot VII dot distinction
- Alternative CR-based VC/VK diacritics (Sec. 12.4.2) — for when Mood and Case-Scope are default
- Referential form: Quaternary + Secondary with superposed bar (Sec. 12.4.3)

**Bias Characters (Sec. 12.5):**
- All bias forms present; DCC/PSM dot-distinguished from ACC/FSC

**Register Symbols (Sec. 12.6):**
- All four modes of each register symbol present
- Transcriptive and Transliterative mode markers (Sec. 12.6.1)

**Alphabetic Writing (Sec. 12.7):**
- Vowel diacritics (preceding vowel above, following vowel below) are correctly placed
- Placeholder character for standalone vowels is present

---

## Phase 1 — Shared: Glyph Catalog Module

A TypeScript library consumed by both the forward and reverse pipelines.

**Responsibilities:**

- Load the mapping table and SVG source files at startup.
- `resolve(sequence: string[]): GlyphEntry` — forward lookup (token sequence → glyph).
- `identify(glyphId: string): string[]` — reverse lookup (glyph → token sequence).
- SVG asset loading: embed SVGs as strings in a JSON bundle for browser use, or read from disk in Node.

**Key types:**

```ts
interface GlyphEntry {
  glyphId: string;
  category: 'primary' | 'secondary' | 'secondary-rotated' | 'tertiary' | 'quaternary' | 'diacritic' | 'bias' | 'register';
  ch12Section: string;       // e.g. "12.1", "12.2.3"
  svg: string;
  advanceWidth: number;
  anchors: Record<string, { x: number; y: number }>;
  validationStatus: 'confirmed' | 'discrepancy' | 'unchecked';
}
```

---

## Phase 2 — Forward Pipeline: Encoded Text → Image

### 2.1 — Parser / Tokeniser

Takes raw ithkey-encoded text (a Unicode string) and splits it into a list of character tokens — each being one base character plus its combining marks.

**Steps:**

1. Apply Unicode NFC/NFD normalisation.
2. Iterate codepoints; accumulate combining marks (Unicode category `M`) onto the preceding base character.
3. Emit each `(base, [...combiners])` pair as a `Token`.
4. Handle edge cases: ligature sequences spanning multiple base characters, bidirectionality.

### 2.2 — Glyph Resolver

Passes each `Token` through the `GlyphCatalog` to retrieve a `GlyphEntry`, including:

- SVG path data.
- Layout metadata: advance width, anchor points for diacritics.
- Whether the glyph stacks vertically or horizontally with its neighbours.

Falls back to an `.notdef` placeholder glyph for unrecognised sequences and logs a warning.

### 2.3 — Compositor

Because the ithkey font resolves inter-glyph positioning at the OpenType level (GPOS mark-to-base and mark-to-mark lookups handle diacritic attachment; GSUB handles ligature substitution), the compositor does not need to implement layout rules manually. Its job is to drive the font engine and produce a clean SVG or raster output.

**Two implementation strategies — choose based on environment:**

**Strategy A — Font-driven rendering (preferred for Node):**
Use `opentype.js` to shape the input token sequence into a list of positioned glyph records (applying GSUB then GPOS), then draw each glyph's path at its computed `(x, y)` offset onto an SVG canvas. This gives full control over output size, viewBox, and styling without requiring a browser.

```ts
import opentype from 'opentype.js';

const font = opentype.loadSync('ithkuil.ttf');
// shape returns an array of { glyph, x, y } records, GSUB + GPOS applied
const glyphRun = font.stringToGlyphs(tokenString);
const path = new opentype.Path();
let cursor = 0;
for (const glyph of glyphRun) {
  glyph.getPath(cursor, baseline, fontSize).draw(path);
  cursor += glyph.advanceWidth * scale;
}
// path.toSVG() emits the composed SVG path string
```

**Strategy B — Browser canvas rendering (preferred for the web UI):**
Load the font via the CSS `@font-face` rule and render the encoded text into an `OffscreenCanvas` using the browser's own text layout engine. This is the zero-effort path for the web harness but is less portable.

**Shared post-processing steps (both strategies):**
1. Trim whitespace from the canvas bounding box.
2. Embed the result in an `<svg>` element with a correctly computed `viewBox`.
3. Apply configurable stroke width and fill colour (default: black on transparent).
4. Optionally annotate each glyph's bounding box for debugging (toggled by a `--debug` flag).

**What the compositor does *not* need to do:**
- Manually compute diacritic anchor offsets — the GPOS table handles this.
- Merge extension glyph paths into the primary — the GSUB ligature table handles this.
- Implement Slot VII 180° rotation — this is already a distinct glyph in the font.

### 2.4 — Rasteriser

Converts the composed SVG to the requested output format.

| Output | Node tool | Browser tool |
|---|---|---|
| PNG | `sharp` + `resvg-js` | `OffscreenCanvas` + `drawImage` on Blob URL |
| SVG | Write file directly | Return SVG string |

Configurable DPI for PNG output (default: 144 dpi).

---

## Phase 3 — Reverse Pipeline: Image → Encoded Text

This direction is significantly harder than the forward direction. Plan for iteration and incremental improvement.

### 3.1 — Preprocessor

Normalises the input image to prepare it for segmentation.

**Steps:**

1. Convert to greyscale.
2. Adaptive thresholding / binarisation (Otsu's method).
3. Deskew: detect and correct rotation using the Hough line transform.
4. Noise removal: morphological opening/closing operations.
5. Normalise contrast (histogram equalisation if needed).

**Tools:** `jimp` or `OpenCV.js` in Node; `cv2` in Python for an offline preprocessing script.

### 3.2 — Segmenter

Identifies individual glyph regions in the binarised image.

**Steps:**

1. **Line detection:** split the image into text rows using horizontal projection profile analysis (sum pixel values per row; valleys are line separators).
2. **Character segmentation:** connected component analysis (CCA) to find bounding boxes of each glyph cluster within a row.
3. **Diacritic merging:** merge bounding boxes that are vertically adjacent and within the horizontal span of a primary — these belong to the same character.
4. Return an ordered list of `SegmentedRegion { bbox, pixels }`.

### 3.3 — Classifier

Matches each segmented region to a `GlyphID`. Uses two complementary strategies:

**Template matching (baseline — implement first):**
- Resize each segment to a canonical size (e.g. 64×64 px).
- Compute normalised cross-correlation against pre-rendered reference images of every known glyph.
- Assign the `GlyphID` of the highest-scoring template.
- Works perfectly for clean renders produced by your own compositor; fast and interpretable.

**CNN-based classifier (robustness — implement second):**
- Train a small convolutional network on synthetic data generated by the forward pipeline (all known glyphs at varied sizes, rotations, and noise levels).
- Architecture: 3–4 conv layers + max-pool + 2 dense layers + softmax over the glyph vocabulary.
- Necessary for recognising glyphs in photographs or non-clean scans.
- Use `TensorFlow.js` or `ONNX Runtime Web` to keep the runtime in the TypeScript ecosystem.
- Training can be done in Python (PyTorch/Keras) and exported to ONNX or TFJS format.

Output: `ClassifiedGlyph { glyphId: string; confidence: number }[]`

### 3.4 — Decoder

Converts the ordered sequence of classified `GlyphID`s back to ithkey-encoded text.

**Steps:**

1. Reverse-lookup each `GlyphID` in the `GlyphCatalog` to get the original Unicode token sequence.
2. Reconstruct the combining-diacritic structure (base + combiners).
3. Join all tokens into a single Unicode string.
4. Optionally validate the output against known Ithkuil morphological rules to catch misclassifications (low-confidence glyphs near morphological violations are prime candidates for correction).

---

## Phase 4 — Interface Layer

### CLI Tool

Built with `commander` or `citty`. Entry point: `ithkuil-convert`.

```sh
# Forward: text file → SVG image
ithkuil-convert encode --input text.txt --output glyphs.svg

# Forward: text file → PNG image at 300 dpi
ithkuil-convert encode --input text.txt --output glyphs.png --dpi 300

# Reverse: image → text file
ithkuil-convert decode --input glyphs.png --output text.txt

# Reverse: image → stdout
ithkuil-convert decode --input glyphs.png
```

### Web UI (optional — test harness)

A single-page React app:

- Left panel: ithkey text input → live glyph render.
- Right panel: image upload → decoded text output.
- Serves as a live test harness during development and a usability demo.

### Library API

Export all four pipeline modules as a typed TypeScript package so the converter can be embedded in other tools (e.g. a Town Forge extension that annotates maps with Ithkuil place names).

```ts
import { encode, decode, GlyphCatalog } from 'ithkuil-converter';

const svg = await encode('...ithkey text...');
const text = await decode('./glyphs.png');
```

---

## Phase 5 — Training Data & Test Suite

### Synthetic Dataset (for CNN training)

Run the forward pipeline over the full Ithkuil glyph vocabulary with augmentation:

- Random scale (±20%).
- Random rotation (±5°).
- Gaussian noise at varying intensities.
- Simulated scan artifacts (blur, uneven illumination).

Target: at least 500 synthetic samples per glyph class.

### Integration Test Corpus

A curated set of ithkey-encoded texts with known correct glyph images, used to assert round-trip fidelity:

```
text → image → text === original
```

Cover all glyph categories, all diacritic positions, and common multi-glyph words.

### Metrics

| Metric | Target |
|---|---|
| Per-glyph classification accuracy (clean renders) | ≥ 99% |
| Per-glyph classification accuracy (noisy/photo) | ≥ 90% |
| End-to-end round-trip fidelity (forward + reverse) | ≥ 95% of characters |
| Forward render time (single word) | < 50 ms |
| Reverse decode time (single word, template matching) | < 200 ms |

---

## Recommended Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript (Node 20+) | Consistent with existing tooling |
| SVG manipulation | `svgson` + manual DOM | Lightweight, no browser dependency |
| Image I/O & processing | `sharp` + `jimp` | Fast, Node-native |
| Font introspection | `opentype.js` / `fonttools` (Python, offline) | Full GSUB table access |
| ML classifier | `TensorFlow.js` or ONNX Runtime | Stays in TS ecosystem |
| CLI | `commander` or `citty` | Minimal, types-first |
| Testing | `vitest` | Fast, ESM-native |
| Build | `tsup` | Zero-config TS bundler |

---

## Suggested Milestone Order

| # | Milestone | Depends on |
|---|---|---|
| 1 | Phase 0.1–0.2 — Encoding audit + OpenType table extraction | — |
| 2 | Phase 0.3–0.4 — Glyph inventory + mapping table | Phase 0.1–0.2 |
| 3 | Phase 0.5 — Glyph validation against Chapter 12 | Phase 0.3–0.4 |
| 4 | Phase 1 — Glyph catalog module | Phase 0.3–0.5 |
| 5 | Phase 2.1–2.2 — Parser + glyph resolver | Phase 1 |
| 6 | Phase 2.3–2.4 — Compositor + rasteriser | Phase 2.1–2.2 |
| 7 | Phase 3.1–3.2 — Preprocessor + segmenter | — |
| 8 | Phase 3.3 — Template matching classifier | Phase 1, Phase 3.1–3.2 |
| 9 | Phase 4 — CLI | Phase 2, Phase 3.3 |
| 10 | Phase 5 — Test suite | Phase 4 |
| 11 | Phase 3.3 — CNN classifier | Phase 5 (needs synthetic data) |
| 12 | Phase 3.4 — Morphological decoder validation | Phase 3.3, Phase 5 |

---

## Key Risks & Mitigations

**ithkey was built for 2011 Ithkuil, not New Ithkuil.**
The font by Ykulvaarlck predates the current New Ithkuil grammar (finalised 2023). The official script specification at `newithkuil_12_script.htm` may describe glyph forms, categories, or diacritic rules that differ from what the 2011-era font encodes. Phase 0.5 (glyph validation) is the mechanism for detecting these gaps. Any discrepancy found there must be resolved before the mapping table is treated as authoritative — either by finding a corrected glyph source or by noting the deviation explicitly in the validation report.

**GSUB extraction may miss contextual substitutions.**
Ithkuil glyphs may use GSUB lookup types beyond simple ligatures (contextual, chained-context). Audit all lookup types in the GSUB table, not just `LookupType 4`.

**Slot VII 180° rotation must be lateral, not vertical.**
Chapter 12 (Sec. 12.2.3) specifies that rotated Secondary Characters are *laterally* rotated 180° — they are upside-down but are not horizontal mirror-images. Verify that the font's rotated forms obey this exactly, since a mirror-flip would be visually close but semantically wrong, and easy to miss in a casual inspection.

**Segmenter will struggle with touching glyphs.**
Ithkuil diacritics may touch or overlap the primary in the image. Implement the diacritic-merging heuristic early (Phase 3.2) and tune it against the synthetic test corpus before attempting real images.

**CNN training requires sufficient glyph diversity.**
If the glyph vocabulary is large (100+ classes), a small CNN may underfit. Consider a pre-trained MobileNet backbone fine-tuned on synthetic data rather than training from scratch.

---

## Notes

- The **glyph catalog mapping table** (Phase 0.4) and the **Chapter 12 validation report** (Phase 0.5) together are the single most important artefacts in the project. Errors or omissions here propagate to every other module.
- The compositor (Phase 2.3) is substantially simpler than originally anticipated because the font engine handles positioning. The real complexity has shifted to Phase 0.5 — confirming that what the font does matches what the spec requires.
- The forward pipeline also produces the **synthetic training data** for the reverse pipeline's CNN. Completing Phase 2 before Phase 3.3 is therefore not just a dependency — it is a force multiplier.
- If validation (Phase 0.5) reveals that ithkey's glyphs diverge from the New Ithkuil spec in material ways, a corrected or supplemental glyph source will be needed before the project can produce spec-compliant output. Budget time for this contingency.

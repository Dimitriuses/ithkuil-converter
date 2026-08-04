# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout — two separate sub-projects

This repo holds **two independent projects** for converting Ithkuil script. They share no
code and no assets; work in one folder does not affect the other. The root holds only the
shared docs (`README.md`, `CLAUDE.md`, `ROADMAP.md`, `KNOWNISSUES.md`, `NOTICE.md`,
`LICENSE`), `.github/workflows/`, `screenshots/` and `.gitignore`.

- **[new-ithkuil-2023/](new-ithkuil-2023/) — the ACTIVE project.**
  A working bidirectional converter for **New Ithkuil** (the current 2020s script,
  `ithkuil.net/newithkuil_12_script.htm`, ch. 12). ~8,000 lines of TypeScript. Forward
  (text → script) reuses `@zsnout/ithkuil`; reverse (script image → text) is original work.
- **[ithkuil-2011/](ithkuil-2011/) — COMPLETE, now a reference/harness.**
  Analysis + spec-validation of the `mklcp/ithkey` OpenType font, which encodes the
  **older 2004–2011 script** (`ithkuil.net/11_script.htm`, ch. 11). Phase 0.5 is done.
  Python + one TS extractor. **Read [NOTICE.md](NOTICE.md) before touching it** — the font
  it analyses is under a non-commercial licence that forbids redistribution.

The 2011 script and New Ithkuil are **different writing systems** (different character
types, different phoneme inventory), so the 2011 glyphs/rules do NOT carry over to
New Ithkuil — the split is deliberate. Details in
[ithkuil-2011/ithkuil-validation-report.md](ithkuil-2011/ithkuil-validation-report.md).

---

## new-ithkuil-2023/ — active project

**Status:** built and working end to end. Real-vocabulary round trip **92.6%**; see
[README](README.md) for the full result table, [ROADMAP.md](ROADMAP.md) for what is next,
[KNOWNISSUES.md](KNOWNISSUES.md) for measured limits, and
[new-ithkuil-2023/roadmap.md](new-ithkuil-2023/roadmap.md) for the full engineering log
(every milestone, measurement and dead end — read it before re-proposing anything).

```
FORWARD   text ─parse→ word JSON ─script→ SVG ─resvg→ PNG
                                     │
SYNTHETIC │ the same renderer labels its own training data
                                     ▼
REVERSE   image ─binarize→ segment → char-type → per-type decoders → features
                                                     ─@zsnout/generate→ text
```

### Commands (run from `new-ithkuil-2023/`)

```bash
npm run setup            # provision everything, idempotent (~25 min cold); --with-models trains the CNNs
npm run doctor           # readiness report; exit 1 if something required is missing
npm run serve            # local web tool on :3939 (encode + decode + job panel)
npm run encode -- "saläha" -o word.svg --png word.png

npm run typecheck        # tsc --noEmit (TypeScript 7)
npm test                 # node:test unit suite, ~4 s, no dataset needed
npm run demo:build       # browser demo → dist-demo/ (DEMO_BASE sets the Pages base path)
npm run demo:smoke       # drive the built demo in headless Chromium
npm run screenshots      # regenerate screenshots/ by driving the real pipeline

npm run lexicon-test -- 100   # THE accuracy number (real lexicon, frequency-weighted)
npm run word-test             # feature regression gate — NOT an accuracy benchmark
npm run scan-test             # printed-and-rephotographed sheets
```

The round-trip harnesses are listed in `package.json`; each prints its numbers and, through
`gate()` in [src/harness.ts](new-ithkuil-2023/src/harness.ts), exits non-zero below a floor.

### Invariants — break these and things fail quietly

- **`dom-shim.js` must be imported before `@zsnout/ithkuil/script`.** ESM evaluates imports
  in source order, so the shim's import goes first in any module that touches `/script`.
- **The DOM shim is `svgdom`, not `linkedom`.** The library composes characters using a real
  SVG `getBBox()` computed from path geometry; linkedom does no geometry. Use
  `createHTMLWindow()` — the SVG-only window has no `body`, which `fitViewBox` needs.
- **`decode-word.ts` loads `dataset/` templates at module scope**, so importing it without a
  generated dataset throws. That is why the unit tests never import it, and why
  `npm test` runs on a bare clone while the round-trip harnesses do not.
- **Template caches are versioned.** Bump the caller's `version` in
  [template-cache.ts](new-ithkuil-2023/src/template-cache.ts) whenever a render or value set
  changes — a stale cache will silently hide the change. A version mismatch just rebuilds.
- **All five CNNs are optional.** Every `enable*Cnn()` returns `false` and leaves the
  template path in place when the model is absent. Nothing may assume a model exists.
- **CI floors are the template-only numbers**, because CI trains nothing. Re-measure on a
  clean checkout before raising one.
- **`word-test` is a regression gate, never an accuracy claim.** Its roots are deliberately
  easy. The honest number is `lexicon-test`. This distinction cost a 4× overstatement once
  (100% claimed vs 23.5% real) and the harness header says so.
- **A recognizer must not throw.** `assemble.ts` returns `""` when a decode yields no root
  (`formativeToIthkuil` throws without one), and `server.ts` wraps `decodePhrase` as a
  backstop. A failed decode is a reported outcome, not an exception.
- **Spilled secondaries are routed by position, not by score.** A root longer than one
  secondary packs the rest as extension-only placeholders (`forcePlaceholderCharacters`), so
  the 2nd+ secondary in a consecutive run is matched against the placeholder set only. An
  earlier score-based attempt regressed 3-consonant clusters.
- **Sheet geometry lives in `scan-layout.ts` on purpose.** The ingester must read a
  capture's sheet id *before* it knows which manifest to load, so the bit-strip layout
  cannot come from a manifest — both sides import the constants.
- **Do NOT reverse-engineer a font for the forward path.** It is solved by `@zsnout/ithkuil`.
  Effort goes to the reverse direction, which nothing else does.

### Gotchas

- `@tensorflow/tfjs-node` is a **runtime** dependency (the decode pipeline imports the CNN
  loaders statically), not a dev one. On Windows its native addon needs
  `scripts/fix-tfjs-node.mjs`, which runs from `postinstall`.
- `tsconfig` uses `moduleResolution: "Bundler"` — `@zsnout/ithkuil` ships no `exports` map,
  so NodeNext cannot resolve its subpath types.
- Compact (collision-kerned) layout needs SVG `isPointInStroke`/`isPointInFill`;
  `dom-shim.ts` implements both from the path geometry. The parser handles M/L/H/V/Q/C/Z —
  a test asserts the renderer emits nothing else, so a library update that introduces arcs
  fails loudly instead of kerning subtly wrong.
- The demo's Pages base path is derived from the repo name in the workflow, never written
  down: a rename moves a project Pages site and GitHub does not redirect it.
- Generated artifacts (`dataset/`, `cnn-dataset/`, `models/`, `out/`, `dist-demo/`,
  `export/`) are all gitignored and rebuilt by setup.

---

## ithkuil-2011/ — 2011 font analysis (complete)

Analysis of `ithkuil.ttf` (by Ykulvaarlck), which encodes the 2004–2011 Ithkuil script.
**Phase 0.5 validation is complete** — see
[ithkuil-2011/ithkuil-validation-report.md](ithkuil-2011/ithkuil-validation-report.md).
Verdict: the font is faithful to the 2011 script wherever a reference figure exists
(primary 24/24, tertiary 7/7, 11 consonants); only 2 genuine glyph discrepancies (`k'`,
`y`); ~55 glyphs have no isolated reference (diacritics, numerals, font-only secondaries)
and are *not* errors. All paths below are **relative to `ithkuil-2011/`**.

⚠️ **The font is not in this repository, and must not be added back.** It is under a
FontStruct Non-Commercial License forbidding redistribution, which covers its extracted
glyph outlines too. Supply your own copy locally (it is gitignored) and regenerate.
`python strip_outlines.py` removes outlines from regenerated artifacts;
`--check` runs in CI. Full record in [NOTICE.md](NOTICE.md).

### Core domain facts (read before touching 2011 encoding logic)

- All ithkey codepoints live in Unicode PUA-B: **`U+C0000`–`U+C007F`** (128 codepoints). `ITHKEY_BASE = 0xC0000`.
- Codepoints are partitioned into classes by offset from the base — the authoritative split is
  the `ithkey_class`/`ithkeyClass` function in
  [extract_font_tables.py](ithkuil-2011/extract_font_tables.py) and
  [extract_font_tables.ts](ithkuil-2011/extract_font_tables.ts):
  `punctuation 0x00–0x03 · number 0x04–0x0D · tenthPower 0x0E–0x11 · primary 0x12–0x29 · secondary 0x2A–0x2F · tertiary 0x30–0x36 · consonantal 0x37–0x4D · placeholder 0x4E–0x4F · diacritic 0x50–0x70 · grid 0x7F`.
- **The font is a mark-positioning (GPOS) font, not a ligature (GSUB) font.** Diacritics are
  separate glyphs placed by GPOS mark-to-base anchors. `diacritic_sequences.json` is expected to
  be empty — that is correct. (The old plan's GSUB-ligature framing is wrong for this font; trust the code.)
- **The font's `primary`/`secondary`/`tertiary`/`consonantal` classes are the 2011 character
  model (§11.3.1–11.3.4)** — these names mean different glyphs than New Ithkuil's ch.12 characters.
  The font has plain/ejective/aspirated consonants (New Ithkuil does not); confirmed against
  `ithkuil.net/images/11-*.jpg`.
- **GlyphIDs** (`CLASS_DESCRIPTOR`, e.g. `CONSONANT_T_EJ`, `PRIMARY_Q`) are the stable shared key
  across every 2011 artifact; assigned in [build_glyph_inventory.py](ithkuil-2011/build_glyph_inventory.py).

### Phase 0 pipeline (run from `ithkuil-2011/`)

```
(supply your own ithkuil.ttf — gitignored, see NOTICE.md)
extract_font_tables.py / .ts   →  font_analysis/  or  font_analysis_ts/
build_glyph_inventory.py        →  inventory/  (glyph_inventory.json, svg/*.svg, class_*.json)
build_mapping_table.py          →  mapping/  (forward_index, reverse_index, anchors)
build_glyph_similarity.py       →  inventory/glyph_similarity.json  (optional font↔ref shape scores; needs numpy+scipy)
build_validator.py              →  validator.html  (review tool; refs 2011 ch11 images + cross-match panel)
     ↓ human reviews in browser, exports validation_results.json ↓
apply_validation.py             →  updates inventory/glyph_inventory.json in place
strip_outlines.py               →  removes svgPath from the artifacts BEFORE committing them
```

`inventory/svg/` and `validator.html` are gitignored: they are pure glyph outlines. The two
scripts that need outlines exit with an explanatory error when they are absent, rather than
emitting blank glyphs.

Two extractors produce two analysis dirs: [extract_font_tables.py](ithkuil-2011/extract_font_tables.py)
(fonttools) → `font_analysis/` (better `cmap.json`/`glyphs.json`);
[extract_font_tables.ts](ithkuil-2011/extract_font_tables.ts) (opentype.js) → `font_analysis_ts/`
(has `gpos_anchors.json`). Downstream scripts auto-detect either format.

### Commands (run from `ithkuil-2011/`)

The venv is **not** checked in (it is gitignored); create it once:

```bash
python -m venv .venv
.venv/Scripts/pip install fonttools pillow numpy scipy   # .venv/bin/pip on macOS/Linux

# ithkuil.ttf is NOT in the repo — put your own copy here first (NOTICE.md explains why)
.venv/Scripts/python.exe extract_font_tables.py ./ithkuil.ttf ./font_analysis/
.venv/Scripts/python.exe build_glyph_inventory.py ./font_analysis ./inventory
.venv/Scripts/python.exe build_mapping_table.py ./inventory ./font_analysis ./mapping
.venv/Scripts/python.exe build_glyph_similarity.py ./inventory
.venv/Scripts/python.exe build_validator.py ./inventory ./validator.html
.venv/Scripts/python.exe apply_validation.py ./validation_results.json ./inventory/glyph_inventory.json
npx tsx extract_font_tables.ts ./ithkuil.ttf ./font_analysis_ts/   # TS extractor (node_modules here)

.venv/Scripts/python.exe strip_outlines.py           # BEFORE committing regenerated output
.venv/Scripts/python.exe strip_outlines.py --check   # what CI runs
ruff check .                                         # config in ruff.toml; CI gates this
```

The pipeline is deterministic: regenerating `font_analysis/`, `inventory/` and `mapping/`
into a scratch directory and running `strip_outlines.py` reproduces the committed artifacts
byte for byte (verified on Python 3.13), so a diff against them is a valid regression check.

### Conventions

- Every script's module docstring documents its exact inputs/outputs/run command — read it first.
- SVG glyph exports need `transform="scale(1,-1)"` (font Y grows up, SVG Y grows down); `fix_svgs.py` retrofits it.
- `apply_validation.py` writes `glyph_inventory.json` in place after backing up to `.bak`.
- Reference images cached under `inventory/.ref_cache/` (gitignored, regenerable).
- `ruff.toml` selects rules explicitly and ignores `E701`/`E702` — one-line guard clauses are
  this codebase's house style. Formatting is not gated.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout — two separate sub-projects

This repo holds **two independent projects** for converting Ithkuil script. They share
no code; work in one folder does not affect the other. The root holds only `CLAUDE.md`
and `.gitignore`.

- **[new-ithkuil-2023/](new-ithkuil-2023/) — the ACTIVE project.**
  A bidirectional converter for **New Ithkuil** (the current 2020s script,
  `ithkuil.net/newithkuil_12_script.htm`, ch. 12). Not built yet — see
  [new-ithkuil-2023/roadmap.md](new-ithkuil-2023/roadmap.md).
- **[ithkuil-2011/](ithkuil-2011/) — COMPLETE, now a reference/harness.**
  Analysis + spec-validation of the `mklcp/ithkey` OpenType font, which encodes the
  **older 2004–2011 script** (`ithkuil.net/11_script.htm`, ch. 11). Phase 0.5 is done;
  a "2011 converter" may be built here in the future. Python + one TS extractor.

The 2011 script and New Ithkuil are **different writing systems** (different character
types, different phoneme inventory), so the 2011 glyphs/rules do NOT carry over to
New Ithkuil — the split is deliberate. Details in
[ithkuil-2011/ithkuil-validation-report.md](ithkuil-2011/ithkuil-validation-report.md).

---

## new-ithkuil-2023/ — active project

**Goal:** bidirectional New Ithkuil converter (text ↔ script image). **Status:** roadmap
only, nothing built. Full plan in [new-ithkuil-2023/roadmap.md](new-ithkuil-2023/roadmap.md);
original vision in [new-ithkuil-2023/ithkuil-converter-plan.md](new-ithkuil-2023/ithkuil-converter-plan.md)
(predates the decision below — treat as background, the roadmap supersedes it).

- **Forward (text → script SVG):** reuse [`@zsnout/ithkuil`](https://github.com/zsakowitz/ithkuil)
  (MIT, TypeScript, npm `@zsnout/ithkuil`). Its `/script` module composes primary/secondary/
  tertiary/quaternary characters + diacritics algorithmically. Caveat: SVG generation uses the
  DOM (`document.createElementNS`), so Node use needs a shim like `linkedom`. **Do NOT
  reverse-engineer a font for the forward path** — it is a solved problem.
- **Synthetic data:** the forward pipeline renders labeled, augmented glyph images to
  train/evaluate the reverse pipeline.
- **Reverse (script image → text):** the novel, unsolved part — the project's actual
  contribution. `@zsnout/ithkuil` is text→script ONLY (no OCR). Pipeline: preprocess →
  segment → classify → reconstruct word JSON → `@zsnout/ithkuil` `/generate` → text.
  The classifier baseline reuses the template-match harness from
  `ithkuil-2011/build_glyph_similarity.py`.

---

## ithkuil-2011/ — 2011 font analysis (complete)

Analysis of `ithkuil.ttf` (by Ykulvaarlck), which encodes the 2004–2011 Ithkuil script.
**Phase 0.5 validation is complete** — see
[ithkuil-2011/ithkuil-validation-report.md](ithkuil-2011/ithkuil-validation-report.md).
Verdict: the font is faithful to the 2011 script wherever a reference figure exists
(primary 24/24, tertiary 7/7, 11 consonants); only 2 genuine glyph discrepancies (`k'`,
`y`); ~55 glyphs have no isolated reference (diacritics, numerals, font-only secondaries)
and are *not* errors. All paths below are **relative to `ithkuil-2011/`**.

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
extract_font_tables.py / .ts   →  font_analysis/  or  font_analysis_ts/
build_glyph_inventory.py        →  inventory/  (glyph_inventory.json, svg/*.svg, class_*.json)
build_mapping_table.py          →  mapping/  (forward_index, reverse_index, anchors)
build_glyph_similarity.py       →  inventory/glyph_similarity.json  (optional font↔ref shape scores; needs numpy+scipy)
build_validator.py              →  validator.html  (review tool; refs 2011 ch11 images + cross-match panel)
     ↓ human reviews in browser, exports validation_results.json ↓
apply_validation.py             →  updates inventory/glyph_inventory.json in place
```

Two extractors produce two analysis dirs: [extract_font_tables.py](ithkuil-2011/extract_font_tables.py)
(fonttools) → `font_analysis/` (better `cmap.json`/`glyphs.json`);
[extract_font_tables.ts](ithkuil-2011/extract_font_tables.ts) (opentype.js) → `font_analysis_ts/`
(has `gpos_anchors.json`). Downstream scripts auto-detect either format.

### Commands (run from `ithkuil-2011/`)

```bash
# Python scripts use the checked-in venv (ithkuil-2011/.venv) with fonttools+PIL+numpy+scipy.
.venv/Scripts/python.exe extract_font_tables.py ./ithkuil.ttf ./font_analysis/
.venv/Scripts/python.exe build_glyph_inventory.py ./font_analysis ./inventory
.venv/Scripts/python.exe build_mapping_table.py ./inventory ./font_analysis ./mapping
.venv/Scripts/python.exe build_glyph_similarity.py ./inventory
.venv/Scripts/python.exe build_validator.py ./inventory ./validator.html
.venv/Scripts/python.exe apply_validation.py ./validation_results.json ./inventory/glyph_inventory.json
npx tsx extract_font_tables.ts ./ithkuil.ttf ./font_analysis_ts/   # TS extractor (node_modules here)
```

### Conventions

- Every script's module docstring documents its exact inputs/outputs/run command — read it first.
- SVG glyph exports need `transform="scale(1,-1)"` (font Y grows up, SVG Y grows down); `fix_svgs.py` retrofits it.
- `apply_validation.py` writes `glyph_inventory.json` in place after backing up to `.bak`.
- Reference images cached under `inventory/.ref_cache/` (gitignored, regenerable).

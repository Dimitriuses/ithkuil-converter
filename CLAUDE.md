# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A converter between Ithkuil text encoded in the `mklcp/ithkey` OpenType font and the official New Ithkuil script (Chapter 12). Two directions are planned:

- **Forward:** ithkey-encoded Unicode text → glyph image (SVG/PNG)
- **Reverse:** glyph image → ithkey-encoded text

The full design lives in [ithkuil-converter-plan.md](ithkuil-converter-plan.md). The encoding is documented in [ithkuil-encoding-audit.md](ithkuil-encoding-audit.md).

**Current state:** Only **Phase 0** (research, font extraction, glyph inventory, mapping table, validation tooling) is built. It consists of standalone Python scripts plus one TypeScript font extractor. The TypeScript *converter* library (Phases 1–5: catalog module, parser, compositor, reverse pipeline, CLI) does **not exist yet** — `package.json` and `tsconfig.json` are scaffolding for it.

## Core domain facts (read before touching encoding logic)

- All ithkey codepoints live in Unicode PUA-B: **`U+C0000`–`U+C007F`** (128 codepoints). `ITHKEY_BASE = 0xC0000`.
- Codepoints are partitioned into classes by their offset from the base. The authoritative split is the `ithkey_class`/`ithkeyClass` function duplicated in [extract_font_tables.py](extract_font_tables.py) and [extract_font_tables.ts](extract_font_tables.ts):
  `punctuation 0x00–0x03 · number 0x04–0x0D · tenthPower 0x0E–0x11 · primary 0x12–0x29 · secondary 0x2A–0x2F · tertiary 0x30–0x36 · consonantal 0x37–0x4D · placeholder 0x4E–0x4F · diacritic 0x50–0x70 · grid 0x7F`.
- **The font is a mark-positioning (GPOS) font, not a ligature (GSUB) font.** Diacritics are separate glyphs placed by GPOS mark-to-base anchors. `diacritic_sequences.json` is expected to be empty — that is correct, not a bug. Diacritic slot info is derived from GPOS mark-class assignments, not from GSUB ligatures. (The plan text describing a GSUB ligature table is aspirational/wrong for this font; trust the code.)
- **GlyphIDs** (`CLASS_DESCRIPTOR`, e.g. `CONSONANT_T_EJ`, `DIACRITIC_01`, `PRIMARY_Q`) are the stable shared key across every artifact and every future module. They are assigned in [build_glyph_inventory.py](build_glyph_inventory.py) via hardcoded ID tables per class.
- **The font (`ithkuil.ttf`, by Ykulvaarlck) is the 2004–2011 Ithkuil script, NOT New Ithkuil (ch12).** Confirmed: the ithkey readme references `ithkuil.net/11_script.htm` + `01_phonology.html`, and every font glyph matches its `11-cons-*.jpg` figure exactly (including the plain/ejective/aspirated consonant series that New Ithkuil lacks). The font's `primary`/`secondary`/`tertiary`/`consonantal` classes are the **2011** character model (§11.3.1–11.3.4), which reuses those names for entirely different glyphs than New Ithkuil ch12. The extraction, SVGs, and consonant romanisations are all verified correct.
- **Consequence:** Phase 0.5 validation must compare against the 2011 script (`ithkuil.net/11_script.htm`, images under `ithkuil.net/images/11-*.jpg`), which `build_validator.py` now does. The project *plan* targets New Ithkuil — that goal requires a different (New-Ithkuil) glyph source, since this font can't produce ch12-compliant output. Treat that as an open strategic question, not a bug.

## Phase 0 pipeline

Each stage consumes the previous stage's output directory. Run in order:

```
extract_font_tables.py / .ts   →  font_analysis/  or  font_analysis_ts/
build_glyph_inventory.py        →  inventory/  (glyph_inventory.json, svg/*.svg, class_*.json)
build_mapping_table.py          →  mapping/  (forward_index, reverse_index, mapping_table, anchors)
build_validator.py              →  validator.html  (review tool; refs 2011 ch11 images)
     ↓ human reviews in browser, exports validation_results.json ↓
apply_validation.py             →  updates inventory/glyph_inventory.json in place
```

There are **two** extractors producing **two** analysis dirs:
- [extract_font_tables.py](extract_font_tables.py) (fonttools) → `font_analysis/`. Preferred for `cmap.json` + `glyphs.json` (fonttools SVG paths are more reliable).
- [extract_font_tables.ts](extract_font_tables.ts) (opentype.js) → `font_analysis_ts/`. Preferred for `gpos_anchors.json` and `diacritic_sequences.json` (Python extractor doesn't produce the latter).

Downstream scripts auto-detect either format, so you may pass either dir (or a merged one).

## Commands

```bash
# Python scripts use the checked-in venv (.venv) with fonttools installed.
.venv/Scripts/python.exe extract_font_tables.py ./ithkuil.ttf ./font_analysis/
.venv/Scripts/python.exe build_glyph_inventory.py ./font_analysis ./inventory
.venv/Scripts/python.exe build_mapping_table.py ./inventory ./font_analysis ./mapping
.venv/Scripts/python.exe build_validator.py ./inventory ./validator.html
.venv/Scripts/python.exe apply_validation.py ./validation_results.json ./inventory/glyph_inventory.json

# TypeScript extractor (run directly, no build step):
npx tsx extract_font_tables.ts ./ithkuil.ttf ./font_analysis_ts/

# fix_svgs.py patches exported SVGs to add transform="scale(1,-1)" (y-axis flip); idempotent.
.venv/Scripts/python.exe fix_svgs.py ./inventory
```

There is no build, lint, or test setup yet (`npm test` is a placeholder). The plan calls for `vitest` + `tsup` when the TS converter is built.

## Conventions

- Every script's module docstring documents its exact inputs, outputs, and run command — read it before running or modifying the script.
- SVG glyph exports need `transform="scale(1,-1)"` because font Y grows upward while SVG Y grows downward. New SVG-generating code must emit this; `fix_svgs.py` retrofits it.
- `apply_validation.py` writes `glyph_inventory.json` in place after backing up to `.bak` — the `.bak` file in `inventory/` is expected.
- The mapping table (`mapping/`) and the Chapter 12 validation results are the highest-stakes artifacts: errors here propagate to every future module.

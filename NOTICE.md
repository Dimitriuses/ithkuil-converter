# Third-party material

[`LICENSE`](LICENSE) (MIT) covers **this repository's own code and documentation**. It does
not cover the third-party material listed here, which keeps its own terms.

---

## The 2011 font — analysed, not redistributed

**The font is no longer in this repository.** It is third-party, its licence forbids
redistribution, and so does it forbid redistributing the glyph outlines extracted from it.
What remains is the analysis: measurements *about* the font, which are this project's own
work. The full record is below, because "we removed a file" is not a useful answer to
anyone who wants to reproduce the results.

| | |
| --- | --- |
| File | `ithkuil.ttf` — 176,336 bytes, SHA-256 `eef702e358a6f87b7401b356d2b7b1c2dc81f6f6f89ed2e55d97fcf20e2a6966` |
| Name | *ithkuil Regular*, version 1.0 |
| Author | **Ykulvaarlck** — `Copyright Ykulvaarlck 2016` (font `name` table, ID 0) |
| Built with | FontStruct — <https://fontstruct.com/fontstructions/show/1337265/ithkuil-3> |
| Licence | **FontStruct Non-Commercial License** (font `name` table, ID 13) |
| Obtained via | the `mklcp/ithkey` keyboard-layout project — <https://github.com/mklcp/ithkey> |

The licence is stated inside the font file itself and on its FontStruct page — the upstream
project carries no `LICENSE` at all, so the font's own `name` table is the authority. Its
relevant clauses are:

> You may not sell, rent, license, sublicense, distribute, redistribute, give-away or make
> available (in any other way) the Font Software alone or as part of any collection.

> You may not modify, adapt, rename, translate, reverse engineer, decompile, disassemble,
> alter, or attempt to discover the source code of the Font Software.

A `svgPath` is a glyph's drawing — the design itself — so committing the *extracted outlines*
redistributes the artwork without the container. Both were removed.

### What was removed, and what stayed

| Removed | Why |
| --- | --- |
| `ithkuil.ttf` | the font |
| `inventory/svg/*.svg` (114 files) | one outline export per glyph |
| the `svgPath` field in `font_analysis/glyphs.json`, `font_analysis_ts/glyphs.json`, `inventory/glyph_inventory.json` | 370 outlines in total |
| `validator.html` | the review tool, with the outline-bearing inventory inlined |

| Kept | Why |
| --- | --- |
| `ithkuil-validation-report.md`, `ithkuil-encoding-audit.md` (652 lines) | the findings — prose and tables, zero outline data |
| `validation_results.json` | 114 human verdicts (43 confirmed / 56 discrepancy / 15 absent) |
| `mapping/*.json`, `inventory/class_*.json`, the stripped inventory | codepoint → class partition, GPOS anchor structure, advance widths — measurements, not artwork |
| all seven analysis scripts | this project's own code |

Facts measured about a file are not that file. The class partition, the anchor structure and
the validation verdicts are the research; the outlines were the only part that was ever
someone else's to license.

### Reproducing the analysis

The scripts take the font path as an argument, so nothing is lost but convenience: obtain
your own copy from the FontStruct page above and run the pipeline in
[`CLAUDE.md`](CLAUDE.md#phase-0-pipeline-run-from-ithkuil-2011). **Verified:** doing exactly
that regenerates `cmap.json`, `class_audit.json`, `gsub_rules.json`, `gpos_rules.json`,
`summary.txt`, the class files and `glyph_inventory.md` **byte-identically** to what is
committed, and `glyphs.json` / `glyph_inventory.json` byte-identically once
`python strip_outlines.py` has run. `strip_outlines.py --check` runs in CI, so a
regenerated, outline-bearing artifact cannot be committed back by accident.

### Two things this does not do

- **It does not remove the font from git history.** The binary was added in a single commit
  and is still reachable by `git clone`. Only a history rewrite removes it
  (`git filter-repo --path ithkuil-2011/ithkuil.ttf --invert-paths`), which rewrites every
  commit hash and is a repository-owner decision.
- **It does not retroactively license the analysis.** The licence also forbids reverse
  engineering, and the analysis was that. The work was interoperability research into an
  undocumented encoding, the writing system itself is © 2004–2011 John Quijada, and the font
  is a free hobby FontStruction — but "why" does not change what the licence says, and the
  clean resolution is the author's permission.

Nothing in `new-ithkuil-2023/` — the active project — ever touched this font or anything
derived from it. New Ithkuil script is composed algorithmically by `@zsnout/ithkuil` (MIT);
the two sub-projects share no code and no assets.

---

## Runtime dependencies (`new-ithkuil-2023/`)

| Package | Licence | Used for |
| --- | --- | --- |
| [`@zsnout/ithkuil`](https://github.com/zsakowitz/ithkuil) by sakawi | MIT | the entire forward path — parsing romanized text, composing script characters, and generating romanization back from word JSON. The reverse pipeline is measured against, and reassembles into, this library's data model. |
| [`@tensorflow/tfjs-node`](https://github.com/tensorflow/tfjs) | Apache-2.0 | native backend for training and running the five CNN classifiers |
| [`@resvg/resvg-js`](https://github.com/thx/resvg-js) | MPL-2.0 | SVG → PNG rasterization (used unmodified, as a library) |
| [`svgdom`](https://github.com/svgdotjs/svgdom) | MIT | the DOM + `getBBox` geometry that lets the browser-oriented renderer run under Node |
| [`pngjs`](https://github.com/pngjs/pngjs) | MIT | PNG decode/encode |
| [`jpeg-js`](https://github.com/jpeg-js/jpeg-js) | BSD-3-Clause | JPEG decode for camera captures |

Development-only: TypeScript, `tsx`, Vite, Playwright, `@tensorflow/tfjs` (types only).

## Reference material

- **Ithkuil** — the language and both writing systems are © 2004–2011 and © 2020s
  **John Quijada**, documented at <https://ithkuil.net>. This repository implements tooling
  for the script; it does not reproduce the grammar documentation.
- `ithkuil-2011/build_validator.py` builds a review page that **hot-links** the reference
  figures at `https://ithkuil.net/images/` rather than copying them. They are cached locally
  under `inventory/.ref_cache/` (gitignored) when the similarity harness runs.
- The root lexicon (4,387 roots) used by the benchmarks is `@zsnout/ithkuil`'s bundled data,
  under that package's MIT licence. No copy of it is committed here.

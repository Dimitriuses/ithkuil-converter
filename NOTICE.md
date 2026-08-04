# Third-party material

[`LICENSE`](LICENSE) (MIT) covers **this repository's own code and documentation**. It does
not cover the third-party material listed here, which keeps its own terms.

---

## ⚠️ `ithkuil-2011/ithkuil.ttf` — non-commercial font, redistribution not permitted

**This is an unresolved licensing problem, recorded here rather than papered over.**

| | |
| --- | --- |
| File | `ithkuil-2011/ithkuil.ttf` (176,336 bytes, SHA-256 `eef702e3…a6966`) |
| Name | *ithkuil Regular*, version 1.0 |
| Author | **Ykulvaarlck** — `Copyright Ykulvaarlck 2016` (font `name` table, ID 0) |
| Built with | FontStruct — <https://fontstruct.com/fontstructions/show/1337265/ithkuil-3> |
| Licence | **FontStruct Non-Commercial License** (font `name` table, ID 13) |
| Obtained via | the `mklcp/ithkey` keyboard-layout project — <https://github.com/mklcp/ithkey> |

The licence is stated inside the font file itself and on its FontStruct page. Its relevant
clauses are:

> You may not sell, rent, license, sublicense, distribute, redistribute, give-away or make
> available (in any other way) the Font Software alone or as part of any collection.

> You may not modify, adapt, rename, translate, reverse engineer, decompile, disassemble,
> alter, or attempt to discover the source code of the Font Software.

**So, plainly:** committing this font to a public repository is redistribution, which that
licence forbids, and the `ithkuil-2011/` analysis reads the font's internal tables, which is
what its second clause is about. The same applies to the artifacts derived from it that are
committed here — `ithkuil-2011/inventory/svg/*.svg` and the `svgPath` fields inside
`font_analysis/glyphs.json`, `inventory/glyph_inventory.json` and `validator.html` all carry
the font's glyph outlines verbatim.

Nothing in `new-ithkuil-2023/` — the active project — touches this font or anything derived
from it. New Ithkuil script is composed algorithmically by `@zsnout/ithkuil` (MIT); the two
sub-projects share no code and no assets.

**Context, not an excuse:** the analysis was interoperability research into an undocumented
encoding, the writing system itself is © 2004–2011 John Quijada, and the font is a free
hobby FontStruction. But "why" does not change what the licence says.

**If this is resolved by removing the font**, the analysis scripts already take the font path
as an argument, so nothing breaks except convenience — a reader supplies their own copy from
the FontStruct page above and re-runs the pipeline documented in
[`CLAUDE.md`](CLAUDE.md#phase-0-pipeline-run-from-ithkuil-2011) to regenerate the derived
files (verified: it reproduces them byte for byte). Note that deleting the files from the
working tree does **not** remove them from git history; only a history rewrite would, and
that is a repository-owner decision.

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

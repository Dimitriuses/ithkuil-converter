# Ithkuil script converter

Tooling for converting **Ithkuil** script to and from romanized text. The repository holds
two independent sub-projects (they share no code):

| Folder | What it is | Status |
| --- | --- | --- |
| [`new-ithkuil-2023/`](new-ithkuil-2023/) | **The active project.** A bidirectional converter for **New Ithkuil** (the current 2020s script). Forward (text → script SVG) reuses [`@zsnout/ithkuil`](https://github.com/zsakowitz/ithkuil); reverse (script image → text) is the novel work — segmentation + template matching + CNNs. TypeScript / Node. | **Active** |
| [`ithkuil-2011/`](ithkuil-2011/) | Analysis + spec-validation of the `mklcp/ithkey` OpenType font, which encodes the older **2004–2011 script**. A reference/harness, not a converter. Python + one TS extractor. | Complete |

> The 2011 script and New Ithkuil are **different writing systems**, so nothing carries over
> between the two folders — the split is deliberate. Background: [`CLAUDE.md`](CLAUDE.md).

Everything below deploys the **active project** (`new-ithkuil-2023/`). The 2011 project is
covered briefly at the [end](#the-2011-sub-project-reference-only).

---

## Quick start (automated)

**Prerequisites:** [Node.js](https://nodejs.org) **≥ 18** (20 or 22 recommended) and `git`.
No Python or C++ toolchain is needed — the one native dependency (`@tensorflow/tfjs-node`)
installs a prebuilt binary, and a `postinstall` step repairs it on Windows automatically.

```bash
git clone <this-repo-url>
cd ithkuil-converter/new-ithkuil-2023

npm run setup      # provisions everything and verifies it end-to-end (~15–20 min, one-time)
npm run serve      # then open http://localhost:3939
```

That's it. `npm run setup` is **idempotent** — safe to re-run — and doubles as installer,
repair tool, and verifier. To check an existing checkout without changing anything:

```bash
npm run doctor     # readiness report; exits non-zero if something required is missing
```

<details>
<summary>Example <code>npm run doctor</code> output</summary>

```
New Ithkuil 2023 — readiness check

Environment
  ✓ Node 22.20.0
  ✓ dependencies installed
  ✓ tfjs-node native backend loads

Reverse-decode data (required to decode script → text)
  ✓ glyph template dataset present (dataset/)
  ✓ alphabetic base-template cache built
  ✓ secondary-extension cache built

Optional CNN models (decode falls back to templates without these)
  • consonant-core CNN — not trained (npm run cnn)
  ...

READY — forward + reverse pipelines can run. Start with: npm run serve
```
</details>

### What `npm run setup` does

Each step is guarded by a check, so re-running only does what's still missing:

1. **Dependencies** — `npm install` (its `postinstall` runs `fix-tfjs-node`, which places the
   native `tfjs-node` shared library next to the addon — the Windows "error 126" fix).
2. **Native backend** — verifies `@tensorflow/tfjs-node` actually loads. This is a hard
   requirement: the decode pipeline statically imports the CNN loaders.
3. **Glyph template dataset** — generates `dataset/` (required; the reverse decoder can't even
   load without it). Gitignored, so a fresh clone always builds it.
4. **Reverse-decode caches** — pre-builds the alphabetic base-template cache so the first real
   request isn't slow.
5. **Verify** — runs the composed-word round-trip end-to-end (which also builds the
   secondary-extension cache). If this passes, the system is ready.

The four **CNN models are optional** accuracy upgrades — decoding falls back to template
matching when a model is absent — so setup does **not** train them by default. See
[Optional: train the CNNs](#optional-train-the-cnns).

---

## Using it

### Web tool (recommended)

```bash
npm run serve         # http://localhost:3939   (set PORT=… to change the port)
```

A local, single-page dashboard over the same core functions as the CLI:

- **Encode** — type romanized New Ithkuil → rendered script (SVG + PNG).
- **Decode** — upload/paste a script image → romanized text, with a segmentation overlay.
- **Data & model job panel** — run dataset generation, cache builds, CNN training, and the
  round-trip test harnesses as tracked background jobs (with live logs). This is the "web
  wrapper" for rebuilding data/models after a fresh clone, if you prefer clicking to typing.

The encode path is ready instantly; the decode path warms its template caches in the
background on server start (a few minutes the very first time, then cached to disk).

### Command line

```bash
npm run encode -- "saläha"                    # romanized text → script SVG (printed to stdout)
npm run encode -- "saläha" --out word.svg     # …or written to a file
```

### Test harnesses (round-trip accuracy)

```bash
npm run word-test        # composed word → text     (48/48)
npm run phrase-test      # multi-word phrase → text (7/7)
npm run alphabetic       # alphabetic-mode spelling (14/15, 98.2% char-level)
npm run tricon-test      # 3-consonant clusters
npm run case-test        # case (Vc) decoding
# …see package.json "scripts" for the full list
```

---

## Optional: train the CNNs

The reverse decoder works on template matching alone, but four CNNs push accuracy higher on
the hard cases. They are gitignored (each is tens of MB) and trained locally:

| Model | Improves | Command | Rough time |
| --- | --- | --- | --- |
| `consonant-cnn` | near-identical consonant cores; noise robustness | `npm run cnn` | ~15 min |
| `primary-cnn` | Vr/Vv — function, context, stem (the "entanglement") | `npm run cnn-primary` | ~30 min |
| `top-cnn` | 3-consonant cluster tops | `npm run cnn-top` | ~20 min |
| `alpha-cnn` | alphabetic-mode `n↔ż` / `d↔ļ` | `npm run cnn-alpha` | ~30 min |

Train all of them in one go (long — budget a couple of hours; each is skipped if already
present):

```bash
npm run setup -- --with-models
```

…or individually with the commands above, or from the web tool's **job panel**. Times assume
the native `tfjs-node` backend (verified by setup). Re-run `npm run doctor` to see which
models are present.

---

## Manual setup (without the script)

If you'd rather run the steps yourself:

```bash
cd new-ithkuil-2023
npm install                              # deps + native-addon repair (postinstall)
npm run fix-tfjs-node                     # re-run the repair if tfjs-node won't load
npm run dataset                           # build dataset/  (required for reverse decode)
npx tsx src/build-alphabetic-cache.ts     # optional: pre-build the alphabetic cache
npm run word-test                         # verify + build the secondary-ext cache
npm run serve
```

---

## Troubleshooting

- **`tfjs-node` fails to load / Windows "error 126"** — run `npm run fix-tfjs-node`. If it
  still fails, do a clean reinstall: remove `node_modules/` and `npm install` again. The
  repair copies the native `tensorflow.dll`/`.so` next to the addon; `npm run doctor` reports
  whether it loads.
- **First decode is slow** — the reverse decoder builds ~2000 template masks on first use
  (alphabetic ≈ 5 min, secondary ≈ 4 min), cached to `models/*.json` thereafter. `npm run
  setup` builds these ahead of time so the first request is fast.
- **Decode accuracy seems low** — you probably haven't trained the CNNs; decoding falls back
  to template matching. See [Optional: train the CNNs](#optional-train-the-cnns).
- **Port already in use** — `PORT=4000 npm run serve`.

Generated artifacts — `dataset/`, `cnn-dataset/`, `models/`, `out/`, `node_modules/` — are
all gitignored and rebuilt by setup, so a fresh clone is small.

---

## The 2011 sub-project (reference only)

[`ithkuil-2011/`](ithkuil-2011/) is a completed Python analysis of the 2004–2011 Ithkuil
font — not part of the converter deployment. To run its scripts:

```bash
cd ithkuil-2011
python -m venv .venv
.venv/Scripts/pip install fonttools pillow numpy scipy   # (.venv/bin/pip on macOS/Linux)
.venv/Scripts/python extract_font_tables.py ./ithkuil.ttf ./font_analysis/
# …see CLAUDE.md and ithkuil-validation-report.md for the full pipeline
```

Findings are written up in
[`ithkuil-2011/ithkuil-validation-report.md`](ithkuil-2011/ithkuil-validation-report.md).

---

## Project docs

- [`new-ithkuil-2023/roadmap.md`](new-ithkuil-2023/roadmap.md) — detailed status, design
  decisions, and accuracy numbers for every part of the reverse pipeline.
- [`CLAUDE.md`](CLAUDE.md) — repository conventions and domain facts.

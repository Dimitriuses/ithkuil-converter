# Known issues and measured limits

Every number here was measured, not estimated, and each entry says how to reproduce it.
Forward plans for the ones that are being worked on are in [`ROADMAP.md`](ROADMAP.md).

---

## Accuracy

### Real vocabulary decodes at 92.6%, not 100%

`npm run word-test` reports **48/48** and it is *not a benchmark* — its roots (`l`, `s`,
`kt`, `sm`) are short, ASCII and hand-picked, so it isolates feature regressions and
nothing else. Against the actual 4,387-root lexicon the honest number is **92.6%**
(`npm run lexicon-test -- 100`), and it was **23.5%** before that gap was found. Never
quote the 48/48 as accuracy; the harness file says so at the top for the same reason.

Per root length: 1-consonant 100%, 2 95%, 3 91%, 4 93%, 5 93%. The residual is diffuse
confusion between small extension marks (`v↔f`, `b↔c`, `d↔ḑ`, `š↔w`), diagnosed in
[`ROADMAP.md`](ROADMAP.md#4-the-last-7-of-the-lexicon) along with the four fixes that were
tried and did not work.

### Printed-and-photographed pages decode at 78.1%

Measured on a 16-word sheet across three devices (`npm run scan-test`): clean-sheet
ceiling 88% → flatbed scan 81% → good phone 75% → weak phone 69%.

Two residuals, and neither is a preprocessing problem any more. Cells whose ink is blown
to paper-white by glare are unrecoverable at any threshold. The rest are the same decode
errors that occur on clean renders — i.e. capped by the item above, not by imaging.

The measurement itself is also weak: 16 words gives a ±6% confidence interval at p≈0.8,
which is wider than the last improvement it was used to justify. The 240-word sheet set
that fixes this is generated and waiting to be printed.

### `version` (Vv) is read at ~75% and mostly declined

The primary CNN reads context, function, stem and perspective reliably; `version` has a
subtler mark and reads ~75% even at 80px, so it is only accepted above a 0.97 confidence
guard. When the guard passes, round trip is 83%. Below it, the slot falls back to the
default (`PRC`) — which is right far more often than a coin flip on a 4-way choice.

### The dense 3-letter alphabetic core is the weak alphabetic shape

Alphabetic-register spelling is 100% at character level overall
(`npm run alphabetic`), but the probe suite scores **2/6** on the one shape that packs
core + top + bottom into a single base (e.g. `atkra`). Every other context is 94–98.5%.
Re-weighting the training mix was tried and is zero-sum.

## Setup and runtime

### A fresh clone needs ~25 minutes of one-time provisioning

`npm run setup` is idempotent and does this once, but it is not fast. Measured cold on a
Windows laptop: glyph dataset ~10 min (2,112 renders), alphabetic base-template cache
~8 min (~1,200 renders), char-type cache ~44 s, primary cache ~28 s, then the verification
round trip. Everything lands in `dataset/` and `models/`, both gitignored, both
regenerable. `npm run doctor` reports exactly which pieces exist.

### The five CNNs are not trained by default, and the headline numbers assume them

They are tens of MB each, so they are gitignored and opt-in
(`npm run setup -- --with-models`, budget a couple of hours on CPU). Without them decoding
still works — it falls back to template matching — but **the real-lexicon round trip is
42.6%, not 92.6%**, measured on a clean checkout with zero models present
(`npm run lexicon-test -- 50`: 1-consonant 88%, 2 82%, 3 34%, 4 48%, 5 10%).

That 50-point gap is the CNNs' contribution, and it is why every CI floor is a
template-only number: CI trains nothing, so it gates the *fallback* path. The structural
harnesses are much less affected — word 48/48, phrase 7/7, case 70/70, tertiary 81/81 and
primary 48/48 all pass on templates alone — because they test features rather than the
full consonant inventory.

### `@tensorflow/tfjs-node` is a hard requirement, including on Windows

The decode pipeline imports the CNN loaders statically, so the native addon must load even
when no model is present. On Windows + Node 22 the pre-gyp install puts the binding and
its `tensorflow.dll` in different folders and it fails with error 126;
`scripts/fix-tfjs-node.mjs` runs from `postinstall` and repairs it. If a decode ever fails
at import, `npm run doctor` will say so and `npm run fix-tfjs-node` is the fix.

### Warm start is ~19 seconds

Down from ~86 s once the rendered template sets were cached to disk. What remains is
~9.4 s of chamfer distance transforms recomputed on load and ~9.5 s of module import.
The web tool hides this by warming in the background, so encode is usable immediately and
the first decode waits.

## Scope

### One line of script at a time

Segmentation splits a line into characters; it does not split an image into lines. A
multi-line photograph decodes its first line and produces nonsense from the rest. This is
pure preprocessing and needs no retraining — see [`ROADMAP.md`](ROADMAP.md).

### The live demo is forward-only

The GitHub Pages page renders text → script in the browser, where the real DOM supplies the
geometry the layout engine needs (and gets compact kerning for free, which Node needs a shim
for). It cannot decode: that needs ~15 MB of cached templates plus the tfjs-node models, so
the reverse direction stays a local/Node story. The page shows the reverse pipeline's
measured results instead of pretending otherwise.

### The web tool is a local dashboard, not a service

`npm run serve` binds to `127.0.0.1` only. There is no authentication, no rate limiting and
no upload size policy beyond a 32 MB body cap, and its job panel deliberately starts
CPU-heavy background processes. It is a development tool; do not expose it.

### The forward path handles what `@zsnout/ithkuil` handles

Anything that library rejects (an invalid vowel form, a word it cannot parse) comes back as
`{ ok: false, reason }` rather than an exception — but it comes back unrendered. The
converter adds no grammar of its own.

## Repository hygiene

### `npm audit` reports 4 advisories, all install-time, and they are not fixable

Three high, one critical, every one inside `@tensorflow/tfjs-node`'s install toolchain
(`@mapbox/node-pre-gyp`, `tar`, `adm-zip`) — code that runs while unpacking the native
addon, not code the converter calls. tfjs-node 4.22.0 is the current release; the only
remediation npm offers is `--force` down to tfjs-node **0.1.11**, which would remove the
CNN pipeline entirely. Recorded rather than chased.

### The 2011 analysis cannot be re-run without supplying your own font

The font it analyses carries a **FontStruct Non-Commercial License** forbidding
redistribution, so neither it nor its extracted glyph outlines are committed — see
[`NOTICE.md`](NOTICE.md) for what was removed, what stayed and why. Consequences:

- `build_glyph_inventory.py` and `build_validator.py` **exit with an explanatory error**
  rather than silently producing blank glyphs, until a font is supplied.
- The visual review tool (`validator.html`) is no longer shipped; it regenerates.
- The findings themselves are unaffected — the report, the encoding audit, the 114
  validation verdicts and every mapping table contain no outline data.

The font also remains in git history, in the one commit that added it. Removing it there
needs a history rewrite, which has not been done.

# Roadmap

Where this project is going, what it has ruled out, and why. The blow-by-blow engineering
log — every milestone, every measurement, every dead end — lives in
[`new-ithkuil-2023/roadmap.md`](new-ithkuil-2023/roadmap.md); this file is the short version
plus the forward plan.

Measured limits are in [`KNOWNISSUES.md`](KNOWNISSUES.md).

---

## Where it stands today

The whole loop works: romanized text → script image → romanized text, in one process, with
no manual steps. What is left is accuracy on specific character classes, and reading script
that was printed and photographed rather than rendered.

| | Measured | How to reproduce |
| --- | --- | --- |
| Real-vocabulary round trip (4,387 roots, frequency-weighted) | **92.6%** | `npm run lexicon-test -- 100` |
| Alphabetic-register spelling, character level | **100%** | `npm run alphabetic` |
| Feature regression gate (spec × Vn × root) | **48/48** | `npm run word-test` |
| Multi-word phrases | **7/7** | `npm run phrase-test` |
| Case (Vc), all 68 cases | **100%** | `npm run case-test` |
| Printed, then re-scanned on paper | **78.1%** | `npm run scan-test` |

The gap between the last row and the one above it is the project's real frontier.

---

## Next

### 1. Real scans — scale the capture set

The self-labelling loop is built and has produced its first honest number: print a sheet of
known words with corner fiducials, photograph it, and the ingester deskews the capture by
4-point homography and scores every cell against its printed label. On a 16-word sheet
across three devices: clean-sheet ceiling 88% → flatbed 81% → good phone 75% → weak phone
69%, **78.1% overall**.

**The blocker is sample size, not code.** At p≈0.8 a 16-word sheet gives a ±6% confidence
interval — wide enough that the last preprocessing improvement (76.6% → 78.1%) sat inside
the noise. `npm run scan-sheet -- 8` already emits 8 sheets × 30 words = **240 distinct
words**, lexicon-weighted by root length and guaranteed to cover every known-confusable
letter, which tightens that to ±5% per device. Each sheet carries its own id as an 8-bit
strip so a capture named `20260716_185816.jpg` can never be scored against the wrong
manifest.

What remains is physical: print the eight sheets at 100%, capture each on all three devices
(~24 captures), and ingest. Then, and only then, the next item becomes measurable.

### 2. Retrain the classifiers on augmented data

Augmentation infrastructure exists (`augment.ts`: rotation, blur, speckle, stroke
morphology) and writes to `-aug` model paths so the deployed clean models stay untouched.
It is deliberately unused: teaching scan-robustness from 16 labelled cells would be
fitting noise. This waits on item 1.

### 3. Multi-line segmentation

Split an image into text lines before decoding. Pure upstream preprocessing — the
classifiers see identical per-character crops, so **no retraining** — it just feeds the
existing pipeline line by line. Currently a whole paragraph is treated as one line, so
anything past the first line is garbage.

### 4. The last ~7% of the lexicon

Round trip is 92.6%; the residual is not where it looks. Diagnosed rather than guessed:

- The **core slot is solved** (99% held-out). The whole residual is **small extension
  marks** in the top/bottom slots — about 15 letter pairs contributing 1–4 errors each
  (`v↔f`, `b↔c`, `d↔ḑ`, `š↔w`, plus presence/absence drops), with no dominant pair.
- The model **hard-overfits**: 100% train against 94.2% held-out on the joint metric that
  caps the round trip. There is no more data — all ~6,000 distinct root secondaries are
  already in use.
- **Ruled out empirically, do not re-propose:** targeted oversampling (errors too diffuse),
  more capacity or epochs (already overfitting), augmentation + regularization (tested:
  zero gain — it teaches invariances the model already has, not mark identity), and higher
  input resolution (the confused 80px masks are already visually crisp).

The one lever left is a **region-cropped extension head**: feed the top and bottom zones as
their own higher-resolution sub-images to dedicated heads, so a two-pixel mark is not
diluted by a core that dominates the frame. That is real architecture work with an unproven
payoff, and each retrain is ~25 minutes per 30-epoch run on CPU. Treat 92.6% as near the
practical ceiling of the current representation unless this is explicitly wanted.

### 5. Vr/Vv `version` — the last primary-feature gap

Context, function, stem and perspective all round-trip. `version` reads ~75% even at 80px
because its mark is subtler, so it is only accepted above a 0.97 confidence guard (83%
round trip when it fires). Closing it likely needs **real scanned data** or a
version-specialized head — not more resolution, which has already been tried.

---

## Later

### A New Ithkuil OpenType font — and a UI written in it

Two milestones that share a dependency. The end goal is a **language switch on the demo
page**: pick "Ithkuil" and every label, button and heading renders in the native script.

**F1 — the font.** `@zsnout/ithkuil` exposes the glyph geometry under MIT, and it is already
shaped for this: 33 cores, 41 extensions, 25 diacritics, and each core carries its own
attachment metadata —

```js
CORES["…"] = { shape: "M -13.15 -35 l -10 10 …", top: ["horiz", 36.85], bottom: ["diag", -10.5] }
```

— which is exactly what OpenType GPOS mark-to-base anchors need. So ~99 glyphs into a PUA
block plus anchors built from that metadata, emitted with `fontTools`. This is a few days of
work, not research, and it is licence-clean end to end.

The 2004–2011 font analysed in [`ithkuil-2011/`](ithkuil-2011/) is the **prior art**, and the
reason that sub-project earns its keep: it establishes that this script family wants a
mark-positioning (GPOS) font rather than a ligature (GSUB) one, and its
[encoding audit](ithkuil-2011/ithkuil-encoding-audit.md) is a worked example of a PUA block
layout and class partition for exactly this problem. The difference in framing matters —
reading how someone else's font was built, then building your own from openly-licensed
geometry, is a better position than depending on theirs.

**What a font cannot do, and where the line is.** A primary character encodes ~8 grammatical
categories at once through rotation and quadrant placement, which `@zsnout` handles with
arbitrary programmatic transforms. That combinatorial space does not fit in a glyph
inventory, so full romanized-text → script shaping is out of scope. Realistically:

| Coverage | Feasible in-font? |
| --- | --- |
| Alphabetic register (phonetic spelling) | **yes, fully** — a bounded inventory, and it is how the language writes foreign words |
| Secondaries with top/bottom extensions | **yes** — cores + extensions + GPOS anchors |
| Primaries | a fixed subset of common combinations, not the full space |
| Arbitrary formatives | no — that is what the renderer is for |

**F2 — the multilingual UI.** With F1 in place, `lang="izm"` plus the font makes the script
behave like text: it wraps, scales, is selectable, and needs no per-label SVG. The first
version spells UI labels in the **alphabetic register** — which is linguistically correct
usage, not a cheat, since that register exists precisely for words the language has not
lexicalised. Hand-written formatives for a few real terms can follow, and full translation
is the [`translation-plan.md`](new-ithkuil-2023/translation-plan.md) track below.

Worth building because it exercises the forward path in a way nothing else does: if a button
label renders wrong at 14px, the layout engine is wrong.

### English → Ithkuil, AI-assisted

A semantic layer in front of the converter, planned in
[`new-ithkuil-2023/translation-plan.md`](new-ithkuil-2023/translation-plan.md) (milestones
T1–T6): an English sentence → LLM-proposed **interpretation options** (Ithkuil forces
distinctions English leaves implicit) → the user picks → a constrained per-word
intermediate representation, with the root chosen from the real lexicon's glosses and every
category enum-constrained → deterministic `formativeToIthkuil` → the existing renderer.

The design constraint is the point: **the model never writes romanized Ithkuil.** It only
selects from enumerated options, so the output is always a well-formed word by construction
rather than by hope.

### Warm-up — the remaining ~19 seconds

Down from ~86 s by disk-caching the rendered template sets. What is left is
`warmAlphabetic` (9.4 s recomputing ~1,200 chamfer distance transforms — storable, but
they are ~15 MB of `Float32` and would want a binary sidecar, not base64 JSON) and ~9.5 s
of module import (`tsx` compiling the graph plus the tfjs-node native load, which a `tsc`
build step would cut). Both modest, both optional.

### Web-tool ergonomics

The local dashboard does encode, decode and background jobs. Wanted, in rough order of
value: a **decode inspector** (click a segmented region to see its crop, detected type and
the top candidate matches with scores); a one-click **encode → decode → diff** view for
spotting regressions without leaving the page; on-disk **cache/dataset visibility**; live
job timers and downloadable logs; persisted UI state.

### The 2011 sub-project

[`ithkuil-2011/`](ithkuil-2011/) is complete and is not planned to grow as a converter — a
2004–2011 converter would share the *method* and none of the data, being a different writing
system with a different phoneme inventory. Its ongoing value is as the reference for **F1
above**: it is the worked example of how a font for this script family is encoded.

Its font-licence problem is resolved in-tree (the font and its outlines are gone; see
[`NOTICE.md`](NOTICE.md)), with two loose ends that are the repository owner's call: the
binary is still in git history, and the cleanest outcome would be permission from the font's
author, which would also settle the reverse-engineering clause.

---

## Decided against — kept so they are not re-proposed

- **Building or reverse-engineering a font for the forward path.** `@zsnout/ithkuil` already
  composes the script algorithmically and correctly. Effort goes to the reverse direction,
  which nothing else does.
- **Per-pixel adaptive thresholding for scans.** Tested: it amplifies scanner grain into
  spurious diacritics and regressed the clean scan to 31%. Flat-field levelling plus a
  single global Otsu cut is what shipped.
- **A QR code for sheet identity.** A sheet index needs 8 bits, and the fiducial blob
  detector already reads squares. Revisit only if sheets must carry rich metadata.
- **Alphabetic tone (the `left` diacritic).** Verified in the encoder source and across
  20,000 random words: `textToSecondaries` never assigns it. Tone is formative-level and
  absent from alphabetic spelling — there is nothing to build.
- **Re-weighting the alphabetic training mix for dense 3-letter cores.** Zero-sum: lifting
  the dense case 75% → 79% regressed the common shape and the probe suite. The remaining
  levers are more data or more capacity, and the shape is rare.
- **Chasing `npm audit` to zero.** The four advisories are all inside `@tensorflow/tfjs-node`'s
  *install-time* toolchain (`node-pre-gyp`, `tar`, `adm-zip`), reachable only while
  unpacking the native addon. The only "fix" npm offers is downgrading tfjs-node to 0.1.11,
  which would delete the CNN pipeline. See [`KNOWNISSUES.md`](KNOWNISSUES.md).

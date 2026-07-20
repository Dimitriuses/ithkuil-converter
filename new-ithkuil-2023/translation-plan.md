# English → Ithkuil translation (AI-assisted) — plan

> A new layer **in front of** the existing converter. Today the tool converts
> *romanized Ithkuil ↔ script image*. This adds *English → romanized Ithkuil*
> (which then feeds the existing `encode()` for script rendering, and can be
> checked by the existing reverse pipeline). Nothing here changes the OCR work.

---

## 1. The core idea: interpretation is the architecture, not a UI extra

Translating into Ithkuil is not sentence → sentence. Ithkuil **forces explicit
commitment** on dozens of categories English leaves ambiguous — perspective
(a specific dog vs. dogs-as-a-class), configuration (one dog vs. a pack),
aspect/phase (Vn), evidentiality/validation (witnessed? inferred? hearsay?),
case roles, illocution, extension, essence… A faithful translation *requires*
resolving these first.

So the requested "intermediate level" — enter an English sentence, get
suggested **objective interpretations** — is not a convenience feature; it is
the semantically correct pipeline stage. The flow:

```
English sentence
  │  [T3] LLM semantic analysis
  ▼
2–4 interpretation options — each a plain-English unambiguous paraphrase
plus the grammatical commitments it implies (per Ithkuil category)
  │  user picks one (or edits commitments per word)
  ▼
  │  [T4] LLM realization: interpretation → per-word IR
  │       (root chosen from the real lexicon via retrieval, slot values
  │        constrained to closed enums)
  ▼
  │  [T2] deterministic: IR → partial formative → formativeToIthkuil
  ▼
romanized Ithkuil ──→ glossWord round-trip check ──→ repair if needed
  │
  ▼
existing encode() → script SVG / PNG
```

**Guiding principle (same one that made the reverse pipeline work):** the LLM
never writes romanized Ithkuil. It produces structured semantic JSON; the
morphophonology is done deterministically by `@zsnout/ithkuil`. The reverse
pipeline targets "word JSON, not free-form romanization" — the forward
translation pipeline targets exactly the same thing from the other side.

## 2. Assets already in place

| Asset | Use here |
|---|---|
| `@zsnout/ithkuil/data` — **4387 roots with English stem glosses** (e.g. root `ţlw` → "screen / partitioning with a screen / filtering / projecting"), **530 affixes with per-degree glosses** | The retrieval corpus for root/affix selection. No external dictionary needed. |
| `@zsnout/ithkuil/generate` (`formativeToIthkuil`, referential/adjunct builders) | The deterministic backend. Already used by [`assemble.ts`](src/assemble.ts). |
| `@zsnout/ithkuil/gloss` + `/ungloss` + `/parse` | Validation loop: generate → gloss → check against the chosen interpretation; parse for well-formedness. |
| [`assemble.ts`](src/assemble.ts) `featuresToText` | The decoded-features → formative slot mapping. The translation IR is the same slot model, built from meaning instead of pixels — extend, don't duplicate. |
| Alphabetic register (encode + decode, 100%) | Fallback for proper names / untranslatable words: carrier root + alphabetic spelling — already fully supported end-to-end. |
| Web dashboard + jobs ([`server.ts`](src/server.ts), tabs) | Natural home for a **Translate** tab; the server keeps the API key server-side. |
| `lexicon-test` harness discipline | Same honesty rule: measure against real sentences, not hand-picked toys. |

## 3. Key design decisions

1. **LLM output is schema-constrained JSON, never prose grammar.** Every
   grammatical category is a closed enum in the schema (values exported from
   `@zsnout/ithkuil`'s own tables, not typed from memory), so the model cannot
   invent a case or aspect that doesn't exist. Use the SDK's structured
   outputs (`client.messages.parse` + `zodOutputFormat`).
2. **Root selection = retrieval + choice, not generation.** A local index over
   the 4387 stem glosses returns top-k candidates; the LLM picks root + stem +
   specification (and the UI shows the alternatives so the user can override).
   Exposed as `lookup_root` / `lookup_affix` tools in a tool-runner loop.
3. **Don't trust the model's pretrained Ithkuil.** LLMs "know of" Ithkuil but
   reliably garble its morphology. The system prompt carries a compact,
   *generated-from-`@zsnout`-data* category primer (what each category means,
   its legal values, defaults) and is prompt-cached; the model's job is only
   semantic analysis + choosing among presented options.
4. **Validation loop, bounded.** IR → `formativeToIthkuil` → `glossWord` →
   the gloss is compared against the chosen interpretation (cheap check by the
   model, shown to the user in the UI). On mismatch or a generation error,
   repair with at most 2 retries; a failure is a *reported* outcome (same rule
   as L2 in the decode pipeline — never throw at the user).
5. **Scope ladder for syntax.** v1 = single clause: one verbal formative,
   nominal formatives with case from role assignment, referentials for
   pronouns; canonical word order. Defer: affixual/modular adjuncts, register
   stacking, formative concatenation, multi-clause sentences.
6. **API choice.** TypeScript `@anthropic-ai/sdk` (fits the repo),
   `claude-opus-4-8`, adaptive thinking, prompt-cached system primer. Key via
   `ANTHROPIC_API_KEY` (or an `ant auth login` profile), read server-side
   only — the browser talks to our local server, never to Anthropic.

## 4. Milestones (T-series; rename to descriptive names when done)

| # | Task | Deliverable / gate |
|---|---|---|
| **T1** | **Lexicon index + category catalog** (no LLM). `src/lexicon-index.ts`: tokenized search over root stem glosses + affix degree glosses; `npm run root-search -- "dog"` prints top-k with glosses. Also dump every category's legal values from `@zsnout` into a machine-readable catalog (feeds both the zod schemas and the system primer). | Spot-check retrieval quality on ~20 common English words; catalog covers all formative slots. |
| **T2** | **Deterministic backend: IR → text.** Define the `TranslationIR` type (zod): per word — root id + stem + specification + function + Ca (configuration/affiliation/perspective/extension/essence) + Vn + case + illocution/validation + optional affixes; or `{ alphabetic: "name" }`. Compile IR → partial formative (extending `assemble.ts`'s mapping) → `formativeToIthkuil`; also emit the `glossWord` gloss. | `npm run ir-test`: IR → text → `parse` → slots match the IR (defaults elide identically on both sides). Errors return reasons, never throw. |
| **T3** | **Interpretation generator.** `src/translate.ts` + `npm run translate -- "sentence"`: one structured-output call producing 2–4 interpretations — paraphrase, per-word commitments (only where they *differ* between interpretations or from defaults), and a short "why you might mean this". | Manual review on ~15 sentences: options are genuinely distinct, cover the plausible readings, and every commitment names a legal category value. |
| **T4** | **Realization.** Chosen interpretation → per-word IR via a tool-runner loop with `lookup_root`/`lookup_affix`; assemble via T2; gloss-back validation + bounded repair. CLI: pick an interpretation by number → romanized text + gloss (+ `--png`). | End-to-end on the T3 sentence set: ≥ 90% produce valid formatives (generation succeeds + parse round-trips); gloss faithful to the interpretation on manual check. |
| **T5** | **Web UI "Translate" tab.** Sentence box → interpretation cards → pick → per-word cards (root candidate dropdown with glosses, category dropdowns pre-filled, alphabetic-fallback toggle) → romanized + gloss + rendered script (reuses `/api/encode`). New `/api/translate/*` endpoints; graceful "no API key configured" state. | Round-trip demo in the browser; key never reaches the client. |
| **T6** | **Eval harness.** `npm run translate-test`: a graded corpus (~30–50 sentences: simple SV, SVO, adjectives, plurals/collectives, tense/aspect, names). Metrics: valid-formative rate, gloss-consistency (model-judged + spot-checked), interpretation-coverage, cost/latency per sentence. This is the honest number — same discipline as `lexicon-test`. | Baseline report checked into the roadmap; regressions gate future prompt changes. |

Ordering: T1 → T2 are pure local work and de-risk everything; T3/T4 are the
LLM core; T5 polish; T6 keeps it honest. T1+T2 can be validated without ever
calling an API.

## 5. Risks / open questions

- **Lexicon gaps.** Many English concepts need affix stacking or derivation
  rather than a bare root. v1 answers with the nearest root + a note; proper
  affix composition is the main post-T6 extension. Names/loanwords go through
  the alphabetic register.
- **Case assignment is ergative-ish and role-driven.** The interpretation
  stage assigns thematic roles in plain English; role → case mapping is a
  deterministic table with an LLM/user override — don't let the model pick
  cases directly from vibes.
- **The 68-case / full-category space is large.** Defaults matter: the IR only
  states what the interpretation *commits to*; everything else stays unset and
  `formativeToIthkuil` fills defaults — mirroring how the decoder elides
  unread slots.
- **Quality ceiling is the semantics, not the morphology.** The deterministic
  half can't produce ill-formed Ithkuil; every real error will be a wrong
  *choice* (root, stem, category). That's why T6 measures gloss-consistency,
  not just validity.
- **Cost/latency:** ~2 model calls per sentence (analysis + realization), plus
  the cached primer. Fine for an interactive tool; batch translation would
  want the Batches API later.

## 6. Explicitly out of scope (for now)

- Ithkuil → English (the `gloss` module already gives interlinear glosses;
  fluent English rendering is a separate, easier LLM task — natural follow-up).
- Multi-clause sentences, adjunct types beyond the v1 set, concatenated
  formatives, register/quotation nesting.
- Fine-tuning or training anything — this is retrieval + constrained
  generation over a deterministic backend, on purpose.

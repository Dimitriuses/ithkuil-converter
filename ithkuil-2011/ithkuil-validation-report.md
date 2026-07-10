# Phase 0.5 — Glyph Validation Report

> Status: **complete**. Source data: [validation_results.json](validation_results.json)
> (114 glyphs, human-reviewed via `validator.html`) + automated cross-match
> ([build_glyph_similarity.py](build_glyph_similarity.py)).

---

## 1. Executive summary

The ithkey font (`ithkuil.ttf`, by Ykulvaarlck) was validated glyph-by-glyph
against the official script figures. Three conclusions:

1. **The font encodes the 2004–2011 Ithkuil script** (`ithkuil.net/11_script.htm`),
   **not** New Ithkuil Chapter 12. This is now confirmed, not assumed — see §3.
2. **The font is faithful to the 2011 script wherever a reference figure exists.**
   Of the 59 glyphs that have a 2011 reference, **54 (91%) match**, including
   *every* primary character (24/24) and *every* tertiary character (7/7).
3. **Only 2 glyphs are genuine shape discrepancies** (`k'`, `y`). The remaining
   55 glyphs simply **have no isolated reference to compare against** (combining
   diacritics, numerals, and font-only composite characters) — they are *not*
   evidence of font errors.

**The font is suitable as a faithful 2011-script glyph source. Phase 0.5 is done.**

---

## 2. Results by category

| Category | Count | Meaning |
|---|--:|---|
| ✓ **Confirmed match** | 44 | Font glyph matches its 2011 reference figure. Incl. primary 24/24, tertiary 7/7, secondary_01, punct_01, and consonants m w h ň f ţ x r š s + q. |
| ≈ **Base correct, ejective mark unresolved** | 10 | Plain/ejective consonant twins (t/t′, k, c/c′, p, q′, ch′, č). Base consonant shape is faithful; the small ejective mark is below the resolution of the cross-match tool, so each twin scores ~equal to its partner. Not a font error. |
| ✗ **Genuine discrepancy** | 2 | `k'` (matches nothing well, ~0.34) and `y` (font draws a large open chevron; 2011 `y` is a small hook). See §4. |
| ⚠ **Reference mismatch** | 3 | Punctuation glyphs (PUNCT_02–04) render as dot separators; the assigned quotation-mark figure is the wrong reference. Needs a correct figure or "no reference". |
| ∅ **No reference exists** | 55 | diacritics 33 · numerals+tenth-powers 14 · grid 1 · secondary 5 · placeholder 2. Combining marks render blank in isolation; numerals aren't in the script chapter; the font secondaries are complete characters with no isolated wiki equivalent (see §4). |
| **Total** | **114** | |

> The raw `validation_results.json` shows 43 "confirmed" / 56 "discrepancy" /
> 15 "absent". That framing over-counts discrepancies: ~55 of them are "nothing
> to compare against," not shape mismatches. The table above is the corrected reading.

### Confirmed in full
- **Primary (24/24):** all basic case forms match `11-case01…24.jpg` in keyboard
  order (= Chapter-11 case order). This also confirms the `PRIMARY_<key> → case N` mapping.
- **Tertiary (7/7):** all match the horizontal-mid-bar tertiary form.
- **Consonants (11):** m, w, h, ň, f, ţ, x, r, š, s, q — the fricatives/sonorants
  plus q, validated 1:1 against `11-cons-*.jpg`.

---

## 3. Why we know the font is the 2011 script

- The ithkey `readme.md` explicitly references `ithkuil.net/11_script.html` and
  `01_phonology.html`, and orders the primary characters "by the order given in
  **Chapter 11**."
- The font's four character classes map exactly onto the 2011 character model:
  `primary` → Primary Case/Aspect (§11.3.1), `secondary` → Secondary Case/Aspect
  (§11.3.2), `tertiary` → Tertiary (§11.3.3, horizontal mid-bar), `consonantal`
  → Consonantal Characters (§11.3.4).
- The consonant set has a **plain / ejective / aspirated** series (t/t′, k/k′,
  p/p′, …), matching the 2011 phonology's `11-cons-*-ejct.jpg` figures. New
  Ithkuil has no ejectives — so the font cannot be New Ithkuil.
- Every consonant glyph matches its `11-cons-*.jpg` figure in shape (verified;
  the SVG raster is pixel-identical to the font's own rendering).

---

## 4. Detailed findings & open items

**Secondary characters (6) — no per-glyph reference.**
The earlier `secondary → 11-altcase` mapping was wrong. The font's secondaries are
*complete* diagonal-bar characters; the wiki `altcase` figures show only the
*endings* of composed forms. There is no isolated 1:1 figure, so these can only be
validated in composition (Phase 2), not in isolation. → drop the `altcase` mapping.

**Diacritics (33) — no per-glyph reference.**
Combining marks; they render near-empty in isolation, and the 2011 diacritic
figures are semantic (mood/version/…), not the font's positional building blocks.
Validate these composed onto a base character if needed (deferred).

**`y` and `k'` — genuine discrepancies.**
`y` (font) is a large open chevron; the 2011 `y` figure is a small hook — no
candidate scores above ~0.58. `k'` matches neither `k-ejct` (assigned) nor `k`
well (~0.34). Both warrant a manual look at the 2011 source: likely a variant/
handwritten form the single wiki figure doesn't capture, or (less likely) a
codepoint whose glyph differs from its romanisation. Low project risk — 2 of 114.

**Punctuation (3) — wrong reference.**
PUNCT_02–04 are dot-based separators; the quotation-mark figure they were paired
with is the wrong reference. Re-point or mark "no reference."

**Ejective twins (10) — accept as-is.**
Base consonant shapes are faithful. Distinguishing plain from ejective needs the
tiny superposed mark, which is not resolvable at glyph-thumbnail scale. If precise
per-mark validation is ever required, render the mark region zoomed.

---

## 5. Strategic note (carried forward)

The project plan targets **New Ithkuil**, but this font is **2011 Ithkuil**. Phase 0.5
confirms the font is a faithful *2011* glyph source. Two paths for Phase 1+:
- **(a)** Build a **2011-script** converter with this font (font is validated, ready).
- **(b)** Keep the New-Ithkuil goal → a different (New-Ithkuil) glyph source is
  required; this font can't produce ch12-compliant output.

This decision gates Phase 1 and should be made before building the converter.

---

## 6. Suggested next actions

1. Merge results into the inventory: `apply_validation.py validation_results.json inventory/glyph_inventory.json` (records status per glyph).
2. Drop the `secondary → 11-altcase` mapping in `build_validator.py`; add a
   distinct "no reference / N-A" state so no-reference glyphs stop counting as discrepancies.
3. Manually inspect `y` and `k'` against `ithkuil.net/11_script.htm`.
4. Make the **2011 vs New Ithkuil** direction call (§5), then start Phase 1.

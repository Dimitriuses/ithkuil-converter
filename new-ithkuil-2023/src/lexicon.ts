/**
 * Real-lexicon root access, for measuring the decoder against actual vocabulary.
 *
 * Why this exists: the round-trip harnesses grew hand-picked roots (`l`, `s`, `kt`, `str`,
 * `mlk`) that are convenient ASCII and 1–3 consonants long. That is NOT what Ithkuil roots
 * look like — the real lexicon is dominated by longer roots drawn from the full consonant
 * inventory (`ţ ç ż š ň ḑ` …). Measured against it the decoder scored ~14%, while
 * `word-test` reported 100%. Any benchmark that wants an honest number must sample from
 * here; see `lexicon-roundtrip.ts`.
 *
 * Source: `roots` in `@zsnout/ithkuil/data` — 4387 entries keyed by root id, each with a
 * `cr` field holding the root's consonant form.
 */
import * as data from "@zsnout/ithkuil/data"

interface RootEntry {
  cr?: string
}

/** Every root's Cr (consonant) form, e.g. "l", "kt", "mpw", "rmpw". */
export const ROOT_FORMS: readonly string[] = Object.values(
  (data as Record<string, unknown>).roots as Record<string, RootEntry>,
)
  .map((r) => r?.cr)
  .filter((c): c is string => typeof c === "string" && c.length > 0)

/** Roots whose Cr has exactly `n` consonants. */
export function rootsOfLength(n: number): string[] {
  return ROOT_FORMS.filter((c) => c.length === n)
}

/** Share of the lexicon made up of `n`-consonant roots (0–1). */
export function lengthShare(n: number): number {
  return ROOT_FORMS.length ? rootsOfLength(n).length / ROOT_FORMS.length : 0
}

/**
 * A deterministic, evenly-spread sample of `k` roots of length `n` — stable across runs
 * (no RNG) so a benchmark's number is comparable run-to-run, and spread across the list
 * rather than taking the first `k` (which would cluster on similar roots).
 */
export function sampleRootsOfLength(n: number, k: number): string[] {
  const all = rootsOfLength(n)
  if (all.length <= k) return all
  const step = all.length / k
  return Array.from({ length: k }, (_, i) => all[Math.floor(i * step)]!)
}

/** The root lengths present in the lexicon, ascending. */
export function rootLengths(): number[] {
  return [...new Set(ROOT_FORMS.map((c) => c.length))].sort((a, b) => a - b)
}

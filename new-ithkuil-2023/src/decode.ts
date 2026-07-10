/**
 * Milestone 7 — decoder (scoped to secondary consonants + vowel diacritics).
 *
 * Turns classified characters (base + diacritic marks) into a romanized string.
 * The consonant cores are already romanized (base.label is "k", "t", …), and the
 * diacritic shapes map to vowels: @zsnout's CORE_DIACRITICS exposes vowel names
 * (a, ä, e, …) that alias the structural shapes, so shape-label → vowel is derived
 * from that map. Alphabetic reading rule (§12.7): a superposed vowel precedes the
 * consonant, an underposed vowel follows it.
 *
 * Out of scope (returns "·" placeholders): primary/tertiary/quaternary characters
 * and non-vowel diacritics — they need the structural decomposition still to come.
 */
import { CORE_DIACRITICS } from "@zsnout/ithkuil/script"
import type { DetailedGlyph } from "./classify.js"

const VOWEL_NAMES = new Set(["a", "ä", "e", "ë", "i", "o", "ö", "u", "ü"])

/** Map a structural diacritic label (e.g. "DOT") to its vowel letter (e.g. "a"). */
export function buildVowelMap(): Record<string, string> {
  const byPath = new Map<string, { struct?: string; vowel?: string }>()
  for (const [name, path] of Object.entries(CORE_DIACRITICS)) {
    const e = byPath.get(path) ?? {}
    if (VOWEL_NAMES.has(name)) e.vowel = name
    else e.struct ??= name
    byPath.set(path, e)
  }
  const map: Record<string, string> = {}
  for (const { struct, vowel } of byPath.values()) if (struct && vowel) map[struct] = vowel
  return map
}

export interface DecodeOptions {
  /** Min base score to accept a consonant. Default 0.6. */
  baseMinScore?: number
  /** Min mark score to accept a diacritic. Default 0.6. */
  markMinScore?: number
}

export interface DecodedChar {
  /** Romanized text for this character (or "·" if the base isn't recognized). */
  text: string
  consonant: string | null
  preceding: string | null
  following: string | null
  /** True when the base was confidently a secondary consonant. */
  confident: boolean
}

/** Decode a single classified character. */
export function decodeCharacter(
  g: DetailedGlyph,
  vowelMap: Record<string, string>,
  opts: DecodeOptions = {},
): DecodedChar {
  const baseMin = opts.baseMinScore ?? 0.6
  const markMin = opts.markMinScore ?? 0.6

  const isConsonant = g.base.class.split("-")[0] === "secondary" && g.base.score >= baseMin
  const consonant = isConsonant ? g.base.label : null

  let preceding: string | null = null
  let following: string | null = null
  for (const m of g.marks) {
    if (m.glyph.score < markMin) continue
    const vowel = vowelMap[m.glyph.label]
    if (!vowel) continue
    if (m.role === "superposed") preceding = vowel
    else if (m.role === "underposed") following = vowel
  }

  const confident = consonant != null
  const text = confident ? (preceding ?? "") + consonant + (following ?? "") : "·"
  return { text, consonant, preceding, following, confident }
}

export interface DecodeResult {
  /** Concatenated romanized text. */
  text: string
  chars: DecodedChar[]
}

/** Decode a sequence of classified characters into romanized text. */
export function decodeGlyphs(glyphs: readonly DetailedGlyph[], opts?: DecodeOptions): DecodeResult {
  const vowelMap = buildVowelMap()
  const chars = glyphs.map((g) => decodeCharacter(g, vowelMap, opts))
  return { text: chars.map((c) => c.text).join(" "), chars }
}

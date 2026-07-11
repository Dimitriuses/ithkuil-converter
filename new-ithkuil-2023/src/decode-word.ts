/**
 * Composed-word orchestrator: a formative/phrase image → per-character type +
 * decoded features.
 *
 * Segments the image, detects each character's type (char-type.ts), and routes it
 * to the matching decoder (secondary consonant+diacritics / quaternary / tertiary /
 * primary). This is the integration layer over the per-character decoders.
 */
import "./dom-shim.js" // must precede @zsnout imports (via the decoders)
import { segment, type Bitmap, type SegmentedRegion } from "./segment.js"
import { classifyCharType, type CharType } from "./char-type.js"
import { loadTemplates, partitionTemplates } from "./classify.js"
import { decodeQuaternary } from "./quaternary.js"
import { decodeTertiary } from "./tertiary.js"
import { decodePrimaryAligned } from "./primary.js"
import { decodeSecondary } from "./secondary.js"
import { featuresToText, type DecodedFeatures } from "./assemble.js"

const templates = loadTemplates("dataset", 64)
const diacriticTemplates = partitionTemplates(templates).diacritic

/** Copy a region's bounding box into a standalone bitmap (for the primary aligner). */
function cropRegionBitmap(bmp: Bitmap, region: SegmentedRegion): Bitmap {
  const { x, y, w, h } = region.bbox
  const ink = new Uint8Array(w * h)
  for (let ry = 0; ry < h; ry++) {
    for (let rx = 0; rx < w; rx++) {
      const sx = x + rx
      const sy = y + ry
      if (sx >= 0 && sy >= 0 && sx < bmp.width && sy < bmp.height && bmp.ink[sy * bmp.width + sx]) {
        ink[ry * w + rx] = 1
      }
    }
  }
  return { width: w, height: h, ink }
}

export interface DecodedCharacter {
  index: number
  type: CharType
  typeScore: number
  decoded: Record<string, unknown>
}

/** Decode a composed word image into typed, decoded characters (left to right). */
export function decodeWord(bmp: Bitmap): DecodedCharacter[] {
  return segment(bmp).map((region) => {
    const ct = classifyCharType(bmp, region)
    let decoded: Record<string, unknown> = {}
    switch (ct.type) {
      case "secondary": {
        const s = decodeSecondary(bmp, region, diacriticTemplates)
        const consonants = [s.topExtension, s.core, s.bottomExtension].filter(Boolean).join("")
        decoded = {
          consonants,
          core: s.core,
          topExtension: s.topExtension,
          bottomExtension: s.bottomExtension,
          vowel: s.underposedVowel ?? s.superposedVowel,
        }
        break
      }
      case "quaternary": {
        const q = decodeQuaternary(bmp, region, diacriticTemplates)
        decoded = { value: q.value, mood: q.mood, caseScope: q.caseScope }
        break
      }
      case "tertiary": {
        const t = decodeTertiary(bmp, region, diacriticTemplates)
        decoded = { valence: t.valence, absoluteLevel: t.absoluteLevel, relativeLevel: t.relativeLevel }
        break
      }
      case "primary": {
        const p = decodePrimaryAligned(cropRegionBitmap(bmp, region))
        decoded = { specification: p.specification, perspective: p.perspective }
        break
      }
    }
    return { index: region.index, type: ct.type, typeScore: ct.score, decoded }
  })
}

export interface WordDecode {
  /** Romanized formative produced by routing decoded features through @zsnout. */
  text: string
  /** The assembled partial formative (omitted slots default). */
  features: DecodedFeatures
  characters: DecodedCharacter[]
}

/**
 * Full composed-word → text: decode each character, map to formative slots (only
 * the features we can read — the rest default via @zsnout), and romanize.
 * Elision is handled implicitly: unread slots are simply left to their defaults.
 */
export function decodeWordToText(bmp: Bitmap): WordDecode {
  const characters = decodeWord(bmp)
  const features: DecodedFeatures = { type: "UNF/C" }
  const rootParts: string[] = []
  for (const c of characters) {
    switch (c.type) {
      case "primary":
        if (c.decoded.specification) features.specification = c.decoded.specification as string
        break
      case "secondary":
        if (c.decoded.consonants) rootParts.push(c.decoded.consonants as string)
        break
      case "tertiary":
        if (c.decoded.valence) features.vn = c.decoded.valence as string
        break
      case "quaternary":
        if (c.decoded.mood && c.decoded.mood !== "FAC") features.mood = c.decoded.mood as string
        if (c.decoded.caseScope && c.decoded.caseScope !== "CCN") features.caseScope = c.decoded.caseScope as string
        break
    }
  }
  if (rootParts.length) features.root = rootParts.join("")
  return { text: featuresToText(features), features, characters }
}

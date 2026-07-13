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
import { diacriticsToCase } from "./case-vowel.js"
import { isRegister, decodeAlphabeticSpan } from "./alphabetic.js"
import { loadAlphabeticCnn, type AlphabeticCnn } from "./alphabetic-cnn.js"
import { loadCnnClassifier, type CnnClassifier } from "./cnn-classify.js"
import { loadPrimaryCnn, type PrimaryCnn } from "./primary-cnn.js"
import { loadTopCnn, type TopCnn } from "./top-cnn.js"
import { featuresToText, type DecodedFeatures } from "./assemble.js"
import { cropRgba, type RgbaImage } from "./image-io.js"

const templates = loadTemplates("dataset", 64)
const diacriticTemplates = partitionTemplates(templates).diacritic

// The consonant-core CNN, on by default once loaded — it beats the template on the
// near-identical pairs (native 48px model: +CNN 90.7% vs template 85.0% in-pipeline).
// It refines a bare core only when the grayscale image is available (its input domain);
// if unloaded or no gray image, decoding falls back to the template with no change.
let coreCnn: CnnClassifier | null = null

/** Load the consonant-core CNN so subsequent decodes use it. Call at warmup. Returns
 * false (and stays template-only) if the model isn't present. */
export async function enableCoreCnn(dir = "models/consonant-cnn"): Promise<boolean> {
  try {
    coreCnn = await loadCnnClassifier(dir)
    return true
  } catch {
    coreCnn = null
    return false
  }
}

// The primary-feature CNN (80px) — decodes the Vr context/function and Vv stem, which
// template matching can't under Ca co-variation. context/stem/function read 100% on
// clean/default primaries; version only ~75%, so it's taken only when very confident.
let primaryCnn: PrimaryCnn | null = null
const PRIMARY_VER_CONF = 0.97

/** Load the primary-feature CNN so subsequent decodes read Vr/Vv. Call at warmup. */
export async function enablePrimaryCnn(dir = "models/primary-cnn"): Promise<boolean> {
  try {
    primaryCnn = await loadPrimaryCnn(dir)
    return true
  } catch {
    primaryCnn = null
    return false
  }
}

// The top-extension CNN — reads a 3-consonant cluster's top consonant (or NONE) from the
// secondary base crop, replacing the margin-gated top-zone template (which capped clusters
// at ~68% top / 48% full). Used only when a grayscale image is available (its input domain).
let topCnn: TopCnn | null = null

/** Load the top-extension CNN so subsequent secondary decodes read the top via CNN. */
export async function enableTopCnn(dir = "models/top-cnn"): Promise<boolean> {
  try {
    topCnn = await loadTopCnn(dir)
    return true
  } catch {
    topCnn = null
    return false
  }
}

// The alphabetic-base CNN — reads a phonetically-spelt syllable's core/top/bottom
// consonants, replacing the joint chamfer match (which confused n↔ż, d↔ļ via slot
// trade-offs). Used only when a grayscale image is available (its input domain).
let alphaCnn: AlphabeticCnn | null = null

/** Load the alphabetic-base CNN so alphabetic spans read their consonants via CNN. */
export async function enableAlphabeticCnn(dir = "models/alpha-cnn"): Promise<boolean> {
  try {
    alphaCnn = await loadAlphabeticCnn(dir)
    return true
  } catch {
    alphaCnn = null
    return false
  }
}

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

/** Confidence below which the first character defaults to primary (see below). */
const FIRST_CHAR_PRIMARY_THRESHOLD = 0.7

/** Decode an explicit list of regions (one formative) into typed characters. The
 * optional `grayImage` (the source RGBA, same size as `bmp`) enables the core CNN. */
export function decodeRegions(
  bmp: Bitmap,
  regions: SegmentedRegion[],
  grayImage?: RgbaImage,
): DecodedCharacter[] {
  return regions.map((region, i) => {
    const ct = classifyCharType(bmp, region)
    // Structural prior: a formative is primary-initial. The thin CTE primary blade
    // otherwise mis-types as a secondary consonant, so if the leftmost character
    // isn't confidently another type, treat it as the primary.
    const type =
      i === 0 && ct.type !== "primary" && ct.score < FIRST_CHAR_PRIMARY_THRESHOLD
        ? "primary"
        : ct.type
    let decoded: Record<string, unknown> = {}
    switch (type) {
      case "secondary": {
        const s = decodeSecondary(bmp, region, diacriticTemplates, coreCnn ?? undefined, grayImage, topCnn ?? undefined)
        const consonants = [s.topExtension, s.core, s.bottomExtension].filter(Boolean).join("")
        decoded = {
          consonants,
          core: s.core,
          topExtension: s.topExtension,
          bottomExtension: s.bottomExtension,
          vowel: s.underposedVowel ?? s.superposedVowel,
          // Case (Vc) rides on the case-bearing secondary as super/underposed
          // diacritics; keyed by raw shape, resolved in charactersToFeatures.
          case: diacriticsToCase(s.superposedShape, s.underposedShape),
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
        // The CNN reads the Vr/Vv features the template can't — context + function (Vr),
        // stem (Vv) — plus a more Ca-robust specification. These read 100% on clean/default
        // primaries at 80px, so they don't regress default words. version is only ~75% on
        // clean primaries (its mark is even subtler), so it's taken only when very confident.
        if (primaryCnn && grayImage) {
          const pf = primaryCnn.classifyImage(cropRgba(grayImage, region.bbox))
          decoded.specification = pf.specification
          decoded.context = pf.context
          decoded.function = pf.function
          decoded.stem = pf.stem
          if (pf.confidence.version >= PRIMARY_VER_CONF) decoded.version = pf.version
        }
        break
      }
    }
    return { index: region.index, type, typeScore: ct.score, decoded }
  })
}

/** Decode a whole single-formative image into typed characters. */
export function decodeWord(bmp: Bitmap, grayImage?: RgbaImage): DecodedCharacter[] {
  return decodeRegions(bmp, segment(bmp), grayImage)
}

export interface WordDecode {
  /** Romanized formative produced by routing decoded features through @zsnout. */
  text: string
  /** The assembled partial formative (omitted slots default). */
  features: DecodedFeatures
  characters: DecodedCharacter[]
}

/** Map decoded characters (one formative) to formative slots. */
function charactersToFeatures(characters: DecodedCharacter[]): DecodedFeatures {
  const features: DecodedFeatures = { type: "UNF/C" }
  const rootParts: string[] = []
  for (const c of characters) {
    switch (c.type) {
      case "primary":
        if (c.decoded.specification) features.specification = c.decoded.specification as string
        // Vr/Vv (only when non-default, so unread/default slots elide identically).
        if (c.decoded.context && c.decoded.context !== "EXS") features.context = c.decoded.context as string
        if (c.decoded.function && c.decoded.function !== "STA") features.function = c.decoded.function as string
        if (c.decoded.version && c.decoded.version !== "PRC") features.version = c.decoded.version as string
        if (c.decoded.stem && c.decoded.stem !== "1") features.stem = Number(c.decoded.stem)
        break
      case "secondary":
        if (c.decoded.consonants) rootParts.push(c.decoded.consonants as string)
        // Case (Vc) is carried by the case-bearing secondary; the last one that
        // resolves to a real case wins (a plain root secondary resolves to null).
        if (c.decoded.case) features.case = c.decoded.case as string
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
  return features
}

/**
 * Single composed-word → text: decode each character, map to formative slots (only
 * the features we can read — the rest default via @zsnout), and romanize.
 * Elision is handled implicitly: unread slots are simply left to their defaults.
 */
export function decodeWordToText(bmp: Bitmap, grayImage?: RgbaImage): WordDecode {
  const characters = decodeWord(bmp, grayImage)
  const features = charactersToFeatures(characters)
  return { text: featuresToText(features), features, characters }
}

/** A decoded phrase word: either a formative or an alphabetic-register spelling. */
export interface PhraseWord {
  /** Romanized text for the word. */
  text: string
  /** "formative" words carry decoded features/characters; "alphabetic" ones don't. */
  kind: "formative" | "alphabetic"
  features?: DecodedFeatures
  characters?: DecodedCharacter[]
}

/**
 * Multi-word phrase → text. Words come in two rendering modes:
 *
 *  - **formative** — the normal character stack; primary-initial, so each primary
 *    starts a new word (narrow separators are skipped);
 *  - **alphabetic** — a word @zsnout couldn't parse as a formative in context, spelt
 *    phonetically between a pair of `Register` glyphs (alphabetic.ts).
 *
 * We scan regions, toggling into an alphabetic span at each Register glyph; regions
 * inside a span are decoded by `decodeAlphabeticSpan`, the rest grouped as formatives.
 */
export function decodePhrase(
  bmp: Bitmap,
  grayImage?: RgbaImage,
): { text: string; words: PhraseWord[] } {
  const all = segment(bmp)
  const sortedW = all.map((r) => r.bbox.w).sort((a, b) => a - b)
  const medianW = sortedW[sortedW.length >> 1] ?? 0

  const words: PhraseWord[] = []
  let formative: SegmentedRegion[] = []
  let alphabetic: SegmentedRegion[] | null = null // non-null while inside a span

  const flushFormative = () => {
    if (!formative.length) return
    const characters = decodeRegions(bmp, formative, grayImage)
    const features = charactersToFeatures(characters)
    words.push({ text: featuresToText(features), kind: "formative", features, characters })
    formative = []
  }

  for (const region of all) {
    if (isRegister(bmp, region)) {
      if (alphabetic) {
        // closing register — decode the accumulated span
        words.push({ text: decodeAlphabeticSpan(bmp, alphabetic, alphaCnn ?? undefined), kind: "alphabetic" })
        alphabetic = null
      } else {
        flushFormative()
        alphabetic = []
      }
      continue
    }
    if (alphabetic) {
      alphabetic.push(region)
      continue
    }
    if (region.bbox.w < medianW * 0.45) continue // skip narrow inter-word separators
    if (classifyCharType(bmp, region).type === "primary" && formative.length) flushFormative()
    formative.push(region)
  }
  if (alphabetic?.length) words.push({ text: decodeAlphabeticSpan(bmp, alphabetic), kind: "alphabetic" })
  flushFormative()

  return { text: words.map((w) => w.text).join(" "), words }
}

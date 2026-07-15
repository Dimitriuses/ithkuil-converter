/**
 * Alphabetic-base CNN — reads the consonant slots of an alphabetic-mode secondary.
 *
 * In alphabetic mode a syllable is a Secondary whose consonants pack into the base as
 * core + top/bottom extensions (vowels are separable diacritics, read elsewhere). The
 * joint chamfer match over ~1200 {core,top,bottom} references reads them at 94.6% but
 * confuses n↔ż and d↔ļ — NOT because those glyphs alias (in isolation they're *more*
 * separated than their controls) but because a whole-frame mean-distance lets slots
 * trade off: a globally-closer template can win with the wrong bottom. A multi-task CNN
 * (shared trunk → one softmax head per slot) reads each slot independently, learning to
 * attend to that slot's region instead of averaging the whole frame.
 *
 * CRITICAL — data is rendered through the ACTUAL pipeline, not an isolated glyph renderer.
 * The base glyph the pipeline (`textToScript`) draws for an alphabetic syllable differs
 * subtly from `renderGlyphToSvg(Secondary(spec))` — enough to flip n↔ż / d↔ļ — and that
 * gap defeated every isolated-render approach (chamfer templates AND two CNN variants).
 * So each sample is produced by rendering a real phrase with `encode("saläha " + word)`,
 * extracting the alphabetic-span char bases, and labelling them from `textToSecondaries`
 * (the same encoder the pipeline uses). Training and inference then share one exact domain.
 *
 *   npm run cnn-alpha -- [nSamples] [epochs] [size]
 */
import "./dom-shim.js"
import * as tf from "@tensorflow/tfjs-node"
import * as fromText from "@zsnout/ithkuil/script/secondary/from-text.js"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment, type SegmentedRegion } from "./segment.js"
import { frameSquare, isRegister, warmAlphabetic } from "./alphabetic.js"
import { fileSaveHandler } from "./cnn-io.js"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const textToSecondaries = (fromText as Record<string, unknown>).textToSecondaries as (
  s: string,
  o: unknown,
) => Record<string, string>[]

// 12000/60 is the deployed config: the label space is 36 classes (33 letters + STRESS + GEM),
// and 8000 samples spread that thin enough to regress the common letters (bottom head 96→92%).
const N = process.argv[2] ? Number(process.argv[2]) : 12000
const EPOCHS = process.argv[3] ? Number(process.argv[3]) : 60
// Frame side (arg 4). The base is stretched to SZ×SZ via `frameSquare` — the SAME
// normalized binary representation the chamfer match and in-pipeline decode use, so there
// is no train/inference domain gap (an aspect-preserving grayscale crop had one: 99%
// held-out but collapsed in-pipeline). 80px is the deployed default — the small top/bottom
// extension marks (p↔v lived there) need the extra rows; 64px left the top slot weaker.
const SZ = process.argv[4] ? Number(process.argv[4]) : 80
const SUFFIX = SZ === 80 ? "" : `-${SZ}`
const MODEL_DIR = `models/alpha-cnn${SUFFIX}`
const CACHE_PATH = `models/alpha-cnn-data${SUFFIX}.json`
const CACHE_VERSION = 5 // bumped: ext-only letters (w y ' " ¿) + GEM allowed on the top slot

// Letter inventories, mirroring @zsnout's from-text.js:
//   CORE_CONS — the 28 letters that can be a *core*;
//   EXT_ONLY  — letters that can ONLY be an extension (top/bottom), never a core;
//   EXT_CONS  — the full top/bottom inventory. Words using w/y/'/"/¿ were previously
//               unreadable because the label space held only CORE_CONS.
const CORE_CONS = "pbtdkgfvţḑszšžçxhļcżčjmnňrlř".split("")
const EXT_ONLY = ["w", "y", "'", '"', "¿"]
const EXT_CONS = [...CORE_CONS, ...EXT_ONLY]
const VOWS = ["a", "e", "i", "o", "u"]
// Stressed vowel forms (inverse of @zsnout's STRESSED_TO_UNSTRESSED_VOWEL_MAP).
const ACC: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú" }
// Shared label set across the three heads: NONE + every letter that can fill any slot +
// two special glyphs — STRESS (the STRESSED_SYLLABLE_PLACEHOLDER core, core head only) and
// GEM (the CORE_GEMINATE mark, which the encoder emits in EITHER top or bottom).
const LABELS = ["NONE", ...EXT_CONS, "STRESS", "GEM"]
const SLOTS = ["core", "top", "bottom"] as const
type Slot = (typeof SLOTS)[number]
// Encoder cores that mean "no consonant core" (a bare, *unstressed* placeholder base).
const PLACEHOLDERS = new Set(["STANDARD_PLACEHOLDER", "ALPHABETIC_PLACEHOLDER", "TONAL_PLACEHOLDER"])

let rng = 20260714 >>> 0
const rand = () => {
  rng = (rng + 0x6d2b79f5) | 0
  let t = Math.imul(rng ^ (rng >>> 15), 1 | rng)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(a: readonly T[]): T => a[(rand() * a.length) | 0]!

interface Sample {
  gray: Float32Array
  labels: Record<Slot, number>
}

/** A random phonetic word — a mix of CVC / CV / VCC syllables — so `textToSecondaries`
 * packs a spread of top+bottom, core+bottom, and core-only bases. A fraction carry an
 * intervocalic geminate (VCCV, same consonant → CORE_GEMINATE) or an acute-accented vowel
 * (→ STRESSED_SYLLABLE_PLACEHOLDER), so those two glyph classes are represented in training. */
function randWord(): string {
  const nSyl = 1 + ((rand() * 3) | 0)
  let w = ""
  for (let s = 0; s < nSyl; s++) {
    const f = rand()
    if (f < 0.12) {
      // VCCV, same core consonant → geminate in the BOTTOM slot ("atta")
      const c = pick(CORE_CONS)
      w += pick(VOWS) + c + c + pick(VOWS)
    } else if (f < 0.22) {
      // V C C X V, first two the same → 3-letter core ⇒ geminate in the TOP slot ("attka")
      const c = pick(CORE_CONS)
      w += pick(VOWS) + c + c + pick(EXT_CONS) + pick(VOWS)
    } else if (f < 0.34) {
      // V + ext-only + core + V → an ext-only letter in the TOP slot ("awka")
      w += pick(VOWS) + pick(EXT_ONLY) + pick(CORE_CONS) + pick(VOWS)
    } else if (f < 0.46) {
      // V X c Y V → a full 3-letter core: top + core + bottom in ONE base ("atkra").
      // The densest base there is, and the bottom letter is hardest to read in it. It only
      // arises incidentally from abutting syllables, so it must be generated explicitly —
      // without this the context is starved (~380 train samples ⇒ 47% bottom accuracy).
      const c = pick(CORE_CONS)
      let x = pick(EXT_CONS)
      while (x === c) x = pick(EXT_CONS) // x === c would make it a top-geminate instead
      w += pick(VOWS) + x + c + pick(EXT_CONS) + pick(VOWS)
    } else if (f < 0.7) w += pick(EXT_CONS) + pick(VOWS) + pick(EXT_CONS) // CVC → top+right+bottom
    else if (f < 0.86) w += pick(CORE_CONS) + pick(VOWS) // CV → top+right / core
    else w += pick(VOWS) + pick(CORE_CONS) + pick(EXT_CONS) // VCC → core+bottom
  }
  // ~22% of words: stress one syllable by accenting a random (plain) vowel.
  if (rand() < 0.22) {
    const vowelPos = [...w].map((ch, i) => (ACC[ch] ? i : -1)).filter((i) => i >= 0)
    if (vowelPos.length) {
      const i = pick(vowelPos)
      w = w.slice(0, i) + ACC[w[i]] + w.slice(i + 1)
    }
  }
  return w
}

/** The tall char bases of an alphabetic span, in reading order (side diacritics — short
 * separate regions — are excluded, matching the decoder's char grouping). */
function spanCharBases(regions: SegmentedRegion[]): SegmentedRegion[] {
  const maxH = Math.max(1, ...regions.map((r) => r.base.h))
  return regions.filter((r) => r.base.h >= maxH * 0.55)
}

function generate(n: number): Sample[] {
  warmAlphabetic() // build the register/base templates once so isRegister works
  const out: Sample[] = []
  let attempts = 0
  while (out.length < n && attempts < n * 6) {
    attempts++
    const word = randWord()
    let specs: Record<string, string>[]
    try {
      specs = textToSecondaries(word, { handwritten: false })
    } catch {
      continue
    }
    // encode() can THROW (not just return !ok) when textToScript parses the phrase as a
    // formative and hits an invalid Ca — guard it so one bad random word can't abort the run.
    let r
    try {
      r = encode("saläha " + word, { margin: 10 })
    } catch {
      continue
    }
    if (!r.ok) continue
    let img
    try {
      img = decodePng(svgToPng(r.svg, { width: 900 }))
    } catch {
      continue
    }
    const bmp = binarize(img.data, img.width, img.height)
    // Collect the alphabetic span (regions between the two Register glyphs).
    const all = segment(bmp)
    let inSpan = false
    const span: SegmentedRegion[] = []
    for (const rg of all) {
      if (isRegister(bmp, rg)) {
        inSpan = !inSpan
        continue
      }
      if (inSpan) span.push(rg)
    }
    const bases = spanCharBases(span)
    if (bases.length !== specs.length) continue // extraction/encoder disagree → skip (keep labels honest)

    for (let ci = 0; ci < bases.length; ci++) {
      const spec = specs[ci]
      const coreRaw = spec.core ?? ""
      // core: a core consonant, "" (bare placeholder), or STRESS (stressed-syllable placeholder).
      const core = coreRaw === "STRESSED_SYLLABLE_PLACEHOLDER" ? "STRESS" : PLACEHOLDERS.has(coreRaw) ? "" : coreRaw
      // top/bottom: an EXT letter, "", or GEM — the encoder emits CORE_GEMINATE in either slot.
      const gem = (v: string) => (v === "CORE_GEMINATE" ? "GEM" : v)
      const top = gem(spec.top ?? "")
      const bottom = gem(spec.bottom ?? "")
      // Skip labels outside our inventory (defensive).
      const okExt = (v: string) => v === "" || v === "GEM" || EXT_CONS.includes(v)
      const okCore = core === "" || core === "STRESS" || CORE_CONS.includes(core)
      if (!okCore || !okExt(top) || !okExt(bottom)) continue
      const mask = frameSquare(bmp, bases[ci].base, SZ)
      const gray = new Float32Array(SZ * SZ)
      for (let p = 0; p < gray.length; p++) gray[p] = mask.data[p] ? 1 : 0
      out.push({
        gray,
        labels: {
          core: LABELS.indexOf(core || "NONE"),
          top: LABELS.indexOf(top || "NONE"),
          bottom: LABELS.indexOf(bottom || "NONE"),
        },
      })
      if (out.length % 200 === 0) console.log(`  generated ${out.length}/${n}`)
      if (out.length >= n) break
    }
  }
  return out
}

function loadCache(): Sample[] | null {
  try {
    const j = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as {
      version: number
      size: number
      labels: number[][]
      gray: string
    }
    if (j.version !== CACHE_VERSION || j.size !== SZ) return null
    const bytes = new Uint8Array(Buffer.from(j.gray, "base64"))
    const per = SZ * SZ
    return j.labels.map((l, i) => {
      const gray = new Float32Array(per)
      for (let p = 0; p < per; p++) gray[p] = bytes[i * per + p] / 255
      return { gray, labels: { core: l[0], top: l[1], bottom: l[2] } as Record<Slot, number> }
    })
  } catch {
    return null
  }
}

function saveCache(samples: Sample[]): void {
  try {
    mkdirSync("models", { recursive: true })
    const per = SZ * SZ
    const bytes = new Uint8Array(samples.length * per)
    for (let i = 0; i < samples.length; i++)
      for (let p = 0; p < per; p++) bytes[i * per + p] = Math.round(samples[i].gray[p] * 255)
    const labels = samples.map((s) => [s.labels.core, s.labels.top, s.labels.bottom])
    writeFileSync(
      CACHE_PATH,
      JSON.stringify({ version: CACHE_VERSION, size: SZ, labels, gray: Buffer.from(bytes).toString("base64") }),
    )
  } catch {
    /* best-effort */
  }
}

function loadOrGenerate(n: number): Sample[] {
  const cached = loadCache()
  if (cached && cached.length >= n) {
    console.log(`loaded ${n} of ${cached.length} cached alphabetic bases (${CACHE_PATH})`)
    return cached.slice(0, n)
  }
  console.log(`generating ${n} alphabetic bases (${SZ}px, placeholder+ext / core+bottom)…`)
  const gen = generate(n)
  saveCache(gen)
  console.log(`cached ${gen.length} alphabetic bases → ${CACHE_PATH}`)
  return gen
}

function stack(samples: Sample[]): tf.Tensor4D {
  const buf = new Float32Array(samples.length * SZ * SZ)
  for (let i = 0; i < samples.length; i++) buf.set(samples[i].gray, i * SZ * SZ)
  return tf.tensor4d(buf, [samples.length, SZ, SZ, 1])
}
const oneHots = (samples: Sample[], k: Slot) =>
  tf.oneHot(tf.tensor1d(samples.map((s) => s.labels[k]), "int32"), LABELS.length)

async function main(): Promise<void> {
  const all = loadOrGenerate(N)
  const nTest = Math.floor(all.length * 0.2)
  const test = all.slice(0, nTest)
  const train = all.slice(nTest)
  console.log(`generated ${all.length}: ${train.length} train / ${test.length} test · ${LABELS.length} classes/slot`)

  // Shared conv trunk → one softmax head per slot (multi-task).
  const input = tf.input({ shape: [SZ, SZ, 1] })
  let x: tf.SymbolicTensor = input
  for (const f of [16, 32, 32]) {
    x = tf.layers.conv2d({ filters: f, kernelSize: 3, activation: "relu" }).apply(x) as tf.SymbolicTensor
    x = tf.layers.maxPooling2d({ poolSize: 2 }).apply(x) as tf.SymbolicTensor
  }
  x = tf.layers.flatten().apply(x) as tf.SymbolicTensor
  x = tf.layers.dense({ units: 96, activation: "relu" }).apply(x) as tf.SymbolicTensor
  x = tf.layers.dropout({ rate: 0.3 }).apply(x) as tf.SymbolicTensor
  const outputs = SLOTS.map(
    (k) => tf.layers.dense({ units: LABELS.length, activation: "softmax", name: k }).apply(x) as tf.SymbolicTensor,
  )
  const model = tf.model({ inputs: input, outputs })
  model.compile({ optimizer: tf.train.adam(0.001), loss: "categoricalCrossentropy", metrics: ["accuracy"] })
  console.log(`model params: ${model.countParams()} · training ${EPOCHS} epochs…`)

  const xs = stack(train)
  const ys = SLOTS.map((k) => oneHots(train, k))
  const t0 = Date.now()
  await model.fit(xs, ys, {
    epochs: EPOCHS,
    batchSize: 32,
    validationSplit: 0.12,
    verbose: 0,
    callbacks: {
      onEpochEnd: (e, logs) => {
        if ((e + 1) % 5 === 0 || e === 0)
          console.log(`  epoch ${e + 1}/${EPOCHS}  loss ${logs?.loss?.toFixed(2)}  (${((Date.now() - t0) / (e + 1) / 1000).toFixed(1)}s/ep)`)
      },
    },
  })

  // Per-slot held-out accuracy, plus the two pairs that motivated this.
  const preds = tf.tidy(() => {
    const out = model.predict(stack(test)) as tf.Tensor[]
    return out.map((t) => t.argMax(1).arraySync() as number[])
  })
  console.log(`\nheld-out per-slot accuracy (${test.length} samples):`)
  SLOTS.forEach((k, ki) => {
    let ok = 0
    for (let i = 0; i < test.length; i++) if (preds[ki][i] === test[i].labels[k]) ok++
    console.log(`  ${k.padEnd(8)} ${((100 * ok) / test.length).toFixed(1)}%`)
  })
  // Per-class recall: the near-identical letters, the ext-only letters, and the special glyphs.
  const idx = Object.fromEntries(
    ["n", "ż", "d", "ļ", "p", "v", "w", "y", "'", "STRESS", "GEM"].map((c) => [c, LABELS.indexOf(c)]),
  )
  const rec: Record<string, [number, number]> = {}
  for (const c of Object.keys(idx)) rec[c] = [0, 0]
  for (let i = 0; i < test.length; i++)
    SLOTS.forEach((k, ki) => {
      const y = test[i].labels[k], p = preds[ki][i]
      for (const [c, ci] of Object.entries(idx)) if (y === ci) { rec[c][1]++; if (p === ci) rec[c][0]++ }
    })
  console.log(`  target letters — ${Object.entries(rec).map(([c, [o, t]]) => `${c} ${o}/${t}`).join(", ")}`)

  mkdirSync(MODEL_DIR, { recursive: true })
  await model.save(fileSaveHandler(MODEL_DIR))
  writeFileSync(join(MODEL_DIR, "slots.json"), JSON.stringify({ size: SZ, slots: SLOTS, labels: LABELS }))
  console.log(`\nsaved model → ${MODEL_DIR}/ (model.json, weights.bin, slots.json)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

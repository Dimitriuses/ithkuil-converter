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

const N = process.argv[2] ? Number(process.argv[2]) : 6000
const EPOCHS = process.argv[3] ? Number(process.argv[3]) : 40
// Frame side (arg 4). The base is stretched to SZ×SZ via `frameSquare` — the SAME
// normalized binary representation the chamfer match and in-pipeline decode use, so there
// is no train/inference domain gap (an aspect-preserving grayscale crop had one: 99%
// held-out but collapsed in-pipeline). 64px gives the per-slot heads enough rows.
const SZ = process.argv[4] ? Number(process.argv[4]) : 64
const SUFFIX = SZ === 64 ? "" : `-${SZ}`
const MODEL_DIR = `models/alpha-cnn${SUFFIX}`
const CACHE_PATH = `models/alpha-cnn-data${SUFFIX}.json`
const CACHE_VERSION = 3 // bumped: data now rendered through the real pipeline (encode), not isolated glyphs

// The consonant inventory that can fill a core/top/bottom slot (matches alphabetic.ts).
const CONS = "pbtdkgfvţḑszšžçxhļcżčjmnňrlř".split("")
const VOWS = ["a", "e", "i", "o", "u"]
// Each slot's label set: NONE (slot empty / placeholder core) + every consonant.
const LABELS = ["NONE", ...CONS]
const SLOTS = ["core", "top", "bottom"] as const
type Slot = (typeof SLOTS)[number]
// Encoder cores that mean "no consonant core" (a bare placeholder base).
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
 * packs a spread of top+bottom, core+bottom, and core-only bases. */
function randWord(): string {
  const nSyl = 1 + ((rand() * 3) | 0)
  let w = ""
  for (let s = 0; s < nSyl; s++) {
    const f = rand()
    if (f < 0.55) w += pick(CONS) + pick(VOWS) + pick(CONS) // CVC → top+right+bottom
    else if (f < 0.8) w += pick(CONS) + pick(VOWS) // CV → top+right / core
    else w += pick(VOWS) + pick(CONS) + pick(CONS) // VCC → core+bottom
  }
  return w
}

/** The tall char bases of an alphabetic span, in reading order (side diacritics — short
 * separate regions — are excluded, matching the decoder's char grouping). */
function spanCharBases(bmp: ReturnType<typeof binarize>, regions: SegmentedRegion[]): SegmentedRegion[] {
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
    const bases = spanCharBases(bmp, span)
    if (bases.length !== specs.length) continue // extraction/encoder disagree → skip (keep labels honest)

    for (let ci = 0; ci < bases.length; ci++) {
      const spec = specs[ci]
      const coreRaw = spec.core ?? ""
      const core = PLACEHOLDERS.has(coreRaw) ? "" : coreRaw
      const top = spec.top ?? ""
      const bottom = spec.bottom ?? ""
      // Skip labels outside our inventory (defensive).
      if ((core && !CONS.includes(core)) || (top && !CONS.includes(top)) || (bottom && !CONS.includes(bottom)))
        continue
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
  const zi = LABELS.indexOf("ż"), ni = LABELS.indexOf("n"), di = LABELS.indexOf("d"), li = LABELS.indexOf("ļ")
  SLOTS.forEach((k, ki) => {
    let ok = 0
    for (let i = 0; i < test.length; i++) if (preds[ki][i] === test[i].labels[k]) ok++
    console.log(`  ${k.padEnd(8)} ${((100 * ok) / test.length).toFixed(1)}%`)
  })
  // Confusion on the target pairs across all slots.
  let nOk = 0, nN = 0, zOk = 0, zN = 0, dOk = 0, dN = 0, lOk = 0, lN = 0
  for (let i = 0; i < test.length; i++)
    SLOTS.forEach((k, ki) => {
      const y = test[i].labels[k], p = preds[ki][i]
      if (y === ni) { nN++; if (p === ni) nOk++ }
      if (y === zi) { zN++; if (p === zi) zOk++ }
      if (y === di) { dN++; if (p === di) dOk++ }
      if (y === li) { lN++; if (p === li) lOk++ }
    })
  console.log(`  target pairs — n ${nOk}/${nN}, ż ${zOk}/${zN}, d ${dOk}/${dN}, ļ ${lOk}/${lN}`)

  mkdirSync(MODEL_DIR, { recursive: true })
  await model.save(fileSaveHandler(MODEL_DIR))
  writeFileSync(join(MODEL_DIR, "slots.json"), JSON.stringify({ size: SZ, slots: SLOTS, labels: LABELS }))
  console.log(`\nsaved model → ${MODEL_DIR}/ (model.json, weights.bin, slots.json)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

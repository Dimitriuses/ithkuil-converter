/**
 * Secondary core+bottom CNN — reads a formative-root secondary's consonant slots.
 *
 * The chamfer core+bottom match is 100% on a bare/2-consonant base but collapses to ~69%
 * once a TOP extension is present (the top makes the base taller, so every mark shifts and
 * the whole-frame match trades slots off) — exactly the entanglement the alphabetic CNN
 * solved. This is the same recipe, on a *formative root* rather than an alphabetic syllable:
 * a multi-task CNN (shared trunk → one softmax head per slot) over the `frameSquare` binary
 * mask, so each slot is read independently.
 *
 * PIPELINE-DOMAIN DATA (the lesson relearned every time): the reuse of the *alphabetic* CNN
 * on these secondaries was mediocre (core 64–95%, top 32–81%) because it was trained on the
 * alphabetic render domain. So each sample is a real lexicon root rendered as a formative
 * with `encode(formativeToIthkuil({ root }))`, its secondary characters extracted, and the
 * slots labelled from `textToSecondaries(root, { forcePlaceholderCharacters: true })` — the
 * exact call `construct/formative.js` uses to pack a root. Train and inference share a domain.
 *
 *   npm run cnn-secondary -- [nSamples] [epochs] [size]
 */
import "./dom-shim.js"
import * as tf from "@tensorflow/tfjs-node"
import * as fromText from "@zsnout/ithkuil/script/secondary/from-text.js"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, segment } from "./segment.js"
import { classifyCharType } from "./char-type.js"
import { frameSquare } from "./alphabetic.js"
import { fileSaveHandler } from "./cnn-io.js"
import { ROOT_FORMS } from "./lexicon.js"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const textToSecondaries = (fromText as Record<string, unknown>).textToSecondaries as (
  s: string,
  o: unknown,
) => Record<string, string>[]

const N = process.argv[2] ? Number(process.argv[2]) : 100000 // soft cap; real caps at the # of root secondaries
const EPOCHS = process.argv[3] ? Number(process.argv[3]) : 60
const SZ = process.argv[4] ? Number(process.argv[4]) : 80
const SUFFIX = SZ === 80 ? "" : `-${SZ}`
const MODEL_DIR = `models/secondary-cnn${SUFFIX}`
const CACHE_PATH = `models/secondary-cnn-data${SUFFIX}.json`
const CACHE_VERSION = 1

// Letter inventories (mirroring @zsnout): a core is one of the 28 consonants; a top/bottom
// extension can also be w/y (the only ext-only letters that occur in roots).
const CORE_CONS = "pbtdkgfvţḑszšžçxhļcżčjmnňrlř".split("")
const EXT_LETTERS = [...CORE_CONS, "w", "y"]
// Shared label set across the three heads: NONE + every letter + GEM (CORE_GEMINATE, which
// the encoder can emit in the top or bottom of a doubled-consonant root).
const LABELS = ["NONE", ...EXT_LETTERS, "GEM"]
const SLOTS = ["core", "top", "bottom"] as const
type Slot = (typeof SLOTS)[number]
const PLACEHOLDERS = new Set(["STANDARD_PLACEHOLDER", "ALPHABETIC_PLACEHOLDER", "TONAL_PLACEHOLDER"])

// Deterministic shuffle of the root list (seeded), so a run is reproducible and the roots
// aren't processed in lexicographic clumps.
let rng = 20260715 >>> 0
const rand = () => {
  rng = (rng + 0x6d2b79f5) | 0
  let t = Math.imul(rng ^ (rng >>> 15), 1 | rng)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
function shuffled<T>(a: readonly T[]): T[] {
  const out = a.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

interface Sample {
  gray: Float32Array
  labels: Record<Slot, number>
}

const gem = (v: string) => (v === "CORE_GEMINATE" ? "GEM" : v)

function generate(n: number): Sample[] {
  const out: Sample[] = []
  const roots = shuffled(ROOT_FORMS)
  let done = 0
  for (const cr of roots) {
    if (out.length >= n) break
    done++
    let specs: Record<string, string>[]
    try {
      specs = textToSecondaries(cr, { handwritten: false, forcePlaceholderCharacters: true })
    } catch {
      continue
    }
    let text: string
    try {
      text = formativeToIthkuil({ root: cr, type: "UNF/C" } as never)
    } catch {
      continue
    }
    let r
    try {
      r = encode(text, { margin: 10 })
    } catch {
      continue
    }
    if (!r.ok) continue
    const img = decodePng(svgToPng(r.svg, { width: 500 }))
    const bmp = binarize(img.data, img.width, img.height)
    const secs = segment(bmp).filter((rg) => classifyCharType(bmp, rg).type === "secondary")
    if (secs.length !== specs.length) continue // char-type/encoder disagree → keep labels honest

    for (let i = 0; i < secs.length; i++) {
      const spec = specs[i]
      const coreRaw = spec.core ?? ""
      const core = PLACEHOLDERS.has(coreRaw) ? "" : coreRaw // placeholder ⇒ NONE (spilled)
      const top = gem(spec.top ?? "")
      const bottom = gem(spec.bottom ?? "")
      const okCore = core === "" || CORE_CONS.includes(core)
      const okExt = (v: string) => v === "" || v === "GEM" || EXT_LETTERS.includes(v)
      if (!okCore || !okExt(top) || !okExt(bottom)) continue
      const mask = frameSquare(bmp, secs[i].base, SZ)
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
      if (out.length % 500 === 0) console.log(`  generated ${out.length} (from ${done} roots)`)
    }
  }
  return out
}

function loadCache(): Sample[] | null {
  try {
    const j = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as { version: number; size: number; labels: number[][]; gray: string }
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
    for (let i = 0; i < samples.length; i++) for (let p = 0; p < per; p++) bytes[i * per + p] = Math.round(samples[i].gray[p] * 255)
    const labels = samples.map((s) => [s.labels.core, s.labels.top, s.labels.bottom])
    writeFileSync(CACHE_PATH, JSON.stringify({ version: CACHE_VERSION, size: SZ, labels, gray: Buffer.from(bytes).toString("base64") }))
  } catch {
    /* best-effort */
  }
}

function loadOrGenerate(n: number): Sample[] {
  const cached = loadCache()
  if (cached && cached.length >= Math.min(n, cached.length)) {
    console.log(`loaded ${cached.length} cached secondaries (${CACHE_PATH})`)
    return cached
  }
  console.log(`generating secondaries (${SZ}px) from real lexicon roots…`)
  const gen = generate(n)
  saveCache(gen)
  console.log(`cached ${gen.length} secondaries → ${CACHE_PATH}`)
  return gen
}

function stack(samples: Sample[]): tf.Tensor4D {
  const buf = new Float32Array(samples.length * SZ * SZ)
  for (let i = 0; i < samples.length; i++) buf.set(samples[i].gray, i * SZ * SZ)
  return tf.tensor4d(buf, [samples.length, SZ, SZ, 1])
}
const oneHots = (samples: Sample[], k: Slot) => tf.oneHot(tf.tensor1d(samples.map((s) => s.labels[k]), "int32"), LABELS.length)

async function main(): Promise<void> {
  const all = loadOrGenerate(N)
  const nTest = Math.floor(all.length * 0.2)
  const test = all.slice(0, nTest)
  const train = all.slice(nTest)
  console.log(`total ${all.length}: ${train.length} train / ${test.length} test · ${LABELS.length} classes/slot`)

  const input = tf.input({ shape: [SZ, SZ, 1] })
  let x: tf.SymbolicTensor = input
  for (const f of [16, 32, 32]) {
    x = tf.layers.conv2d({ filters: f, kernelSize: 3, activation: "relu" }).apply(x) as tf.SymbolicTensor
    x = tf.layers.maxPooling2d({ poolSize: 2 }).apply(x) as tf.SymbolicTensor
  }
  x = tf.layers.flatten().apply(x) as tf.SymbolicTensor
  x = tf.layers.dense({ units: 96, activation: "relu" }).apply(x) as tf.SymbolicTensor
  x = tf.layers.dropout({ rate: 0.3 }).apply(x) as tf.SymbolicTensor
  const outputs = SLOTS.map((k) => tf.layers.dense({ units: LABELS.length, activation: "softmax", name: k }).apply(x) as tf.SymbolicTensor)
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

  const preds = tf.tidy(() => (model.predict(stack(test)) as tf.Tensor[]).map((t) => t.argMax(1).arraySync() as number[]))
  console.log(`\nheld-out per-slot accuracy (${test.length} samples):`)
  SLOTS.forEach((k, ki) => {
    let ok = 0
    for (let i = 0; i < test.length; i++) if (preds[ki][i] === test[i].labels[k]) ok++
    console.log(`  ${k.padEnd(8)} ${((100 * ok) / test.length).toFixed(1)}%`)
  })
  // core+bottom jointly (the metric that caps the round-trip).
  let cbOk = 0
  for (let i = 0; i < test.length; i++) if (preds[0][i] === test[i].labels.core && preds[2][i] === test[i].labels.bottom) cbOk++
  console.log(`  core+bottom BOTH ${((100 * cbOk) / test.length).toFixed(1)}%`)

  mkdirSync(MODEL_DIR, { recursive: true })
  await model.save(fileSaveHandler(MODEL_DIR))
  writeFileSync(join(MODEL_DIR, "slots.json"), JSON.stringify({ size: SZ, slots: SLOTS, labels: LABELS }))
  console.log(`\nsaved model → ${MODEL_DIR}/ (model.json, weights.bin, slots.json)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

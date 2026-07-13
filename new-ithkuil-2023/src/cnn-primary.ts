/**
 * Primary-feature CNN — the entanglement-limited decode that template matching can't do.
 *
 * The primary character bakes MANY features into one blob (specification, perspective,
 * context, function, version, stem, + nuisance Ca). Template matching reads spec/persp
 * only when the rest are held at defaults; when they co-vary it collapses (spec 100%→65%,
 * function/version/stem ~chance). A CNN can learn them jointly. Here we render primaries
 * over the FULL feature space (all targets + nuisance Ca randomized), train a multi-task
 * CNN (shared conv trunk → one softmax head per feature), and measure each on held-out.
 *
 *   npm run cnn-primary -- [nSamples] [epochs]
 */
import "./dom-shim.js"
import * as tf from "@tensorflow/tfjs-node"
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"
import { decodePng, cropRgba } from "./image-io.js"
import { binarize, segment } from "./segment.js"
import { toGrayNxN } from "./cnn-data.js"
import { fileSaveHandler } from "./cnn-io.js"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const N = process.argv[2] ? Number(process.argv[2]) : 3000
const EPOCHS = process.argv[3] ? Number(process.argv[3]) : 60
// Input resolution (arg 4). 80 is the deployed model (higher res resolves the subtle
// function/version marks that 48px lost); other sizes get their own paths so an
// experiment never clobbers the deployed model.
const SZ = process.argv[4] ? Number(process.argv[4]) : 80
const SUFFIX = SZ === 80 ? "" : `-${SZ}`
const MODEL_DIR = `models/primary-cnn${SUFFIX}`
const CACHE_PATH = `models/primary-cnn-data${SUFFIX}.json`
const CACHE_VERSION = 2 // bumped: nuisance Ca now biased toward defaults (v1 was always-random)

// Predicted features (the heads) — each a small closed set.
const TARGETS = {
  specification: ["BSC", "CTE", "CSV", "OBJ"],
  perspective: ["M", "G", "N", "A"],
  context: ["EXS", "FNC", "RPS", "AMG"],
  function: ["STA", "DYN"],
  version: ["PRC", "CPT"],
  stem: ["0", "1", "2", "3"],
} as const
type TargetKey = keyof typeof TARGETS
const KEYS = Object.keys(TARGETS) as TargetKey[]

// Nuisance Ca the CNN must be invariant to (rendered, not predicted). The FIRST value
// of each is its default; real formatives are mostly default-Ca, so we bias sampling
// toward the default — otherwise the always-random distribution leaves default-Ca minimal
// primaries out-of-distribution and the CNN mis-reads function/version on them (v1 flaw).
const CONFIGS = ["UPX", "MSS", "MSC", "MDS", "DPX", "DSS"]
const AFFILIATIONS = ["CSL", "ASO", "COA", "VAR"]
const EXTENSIONS = ["DEL", "PRX", "ICP", "ATV", "GRA"]
const ESSENCES = ["NRM", "RPV"]

let rng = 20260713 >>> 0
const rand = () => {
  rng = (rng + 0x6d2b79f5) | 0
  let t = Math.imul(rng ^ (rng >>> 15), 1 | rng)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(a: readonly T[]): T => a[(rand() * a.length) | 0]!
/** Nuisance-Ca pick biased toward the default (a[0]) so default-Ca is in-distribution. */
const pickCa = <T>(a: readonly T[]): T => (rand() < 0.5 ? a[0]! : pick(a))

interface Sample {
  gray: Float32Array
  labels: Record<TargetKey, number>
}

function generate(n: number): Sample[] {
  const out: Sample[] = []
  for (let i = 0; i < n; i++) {
    const choice: Record<TargetKey, string> = {
      specification: pick(TARGETS.specification),
      perspective: pick(TARGETS.perspective),
      context: pick(TARGETS.context),
      function: pick(TARGETS.function),
      version: pick(TARGETS.version),
      stem: pick(TARGETS.stem),
    }
    const formative = {
      root: "l",
      type: "UNF/C",
      specification: choice.specification,
      function: choice.function,
      version: choice.version,
      stem: Number(choice.stem),
      context: choice.context,
      ca: {
        perspective: choice.perspective, // a predicted target → keep uniform
        configuration: pickCa(CONFIGS),
        affiliation: pickCa(AFFILIATIONS),
        extension: pickCa(EXTENSIONS),
        essence: pickCa(ESSENCES),
      },
    }
    let text: string
    try {
      text = formativeToIthkuil(formative as never)
    } catch {
      continue
    }
    const r = encode(text, { margin: 10 })
    if (!r.ok) continue
    const img = decodePng(svgToPng(r.svg, { width: 500 }))
    const bmp = binarize(img.data, img.width, img.height)
    const region = segment(bmp)[0]
    if (!region) continue
    const gray = toGrayNxN(cropRgba(img, region.bbox), SZ)
    const labels = Object.fromEntries(
      KEYS.map((k) => [k, TARGETS[k].indexOf(choice[k] as never)]),
    ) as Record<TargetKey, number>
    out.push({ gray, labels })
    if ((i + 1) % 200 === 0) console.log(`  generated ${i + 1}/${n}`)
  }
  return out
}

// Rendering is ~260 ms/sample, so the generated set is cached (gray quantized to bytes)
// and reused — lets training be re-run/tuned without re-rendering.
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
      return { gray, labels: Object.fromEntries(KEYS.map((k, ki) => [k, l[ki]])) as Record<TargetKey, number> }
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
    const labels = samples.map((s) => KEYS.map((k) => s.labels[k]))
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
    console.log(`loaded ${n} of ${cached.length} cached primaries (${CACHE_PATH})`)
    return cached.slice(0, n)
  }
  console.log(`generating ${n} primaries (${SZ}px, all features + Ca randomized)…`)
  const gen = generate(n)
  saveCache(gen)
  console.log(`cached ${gen.length} primaries → ${CACHE_PATH}`)
  return gen
}

function stack(samples: Sample[]): tf.Tensor4D {
  const buf = new Float32Array(samples.length * SZ * SZ)
  for (let i = 0; i < samples.length; i++) buf.set(samples[i].gray, i * SZ * SZ)
  return tf.tensor4d(buf, [samples.length, SZ, SZ, 1])
}
const oneHots = (samples: Sample[], k: TargetKey) =>
  tf.oneHot(tf.tensor1d(samples.map((s) => s.labels[k]), "int32"), TARGETS[k].length)

async function main(): Promise<void> {
  const all = loadOrGenerate(N)
  const nTest = Math.floor(all.length * 0.2)
  const test = all.slice(0, nTest)
  const train = all.slice(nTest)
  console.log(`generated ${all.length}: ${train.length} train / ${test.length} test`)

  // Shared conv trunk → one softmax head per target feature (multi-task).
  const input = tf.input({ shape: [SZ, SZ, 1] })
  let x: tf.SymbolicTensor = input
  for (const f of [16, 32, 32]) {
    x = tf.layers.conv2d({ filters: f, kernelSize: 3, activation: "relu" }).apply(x) as tf.SymbolicTensor
    x = tf.layers.maxPooling2d({ poolSize: 2 }).apply(x) as tf.SymbolicTensor
  }
  x = tf.layers.flatten().apply(x) as tf.SymbolicTensor
  x = tf.layers.dense({ units: 96, activation: "relu" }).apply(x) as tf.SymbolicTensor
  x = tf.layers.dropout({ rate: 0.3 }).apply(x) as tf.SymbolicTensor
  const outputs = KEYS.map(
    (k) => tf.layers.dense({ units: TARGETS[k].length, activation: "softmax", name: k }).apply(x) as tf.SymbolicTensor,
  )
  const model = tf.model({ inputs: input, outputs })
  model.compile({ optimizer: tf.train.adam(0.001), loss: "categoricalCrossentropy", metrics: ["accuracy"] })
  console.log(`model params: ${model.countParams()} · training ${EPOCHS} epochs…`)

  const xs = stack(train)
  const ys = KEYS.map((k) => oneHots(train, k))
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

  // Per-feature held-out accuracy.
  const preds = tf.tidy(() => {
    const out = model.predict(stack(test)) as tf.Tensor[]
    return out.map((t) => (t.argMax(1).arraySync() as number[]))
  })
  console.log(`\nheld-out per-feature accuracy (${test.length} samples, all features co-varying):`)
  KEYS.forEach((k, ki) => {
    let ok = 0
    for (let i = 0; i < test.length; i++) if (preds[ki][i] === test[i].labels[k]) ok++
    const baseline: Record<string, string> = { specification: " (template ~65%)", perspective: " (template ~84%)", context: "", function: " (template ~50%)", version: " (template ~50%)", stem: " (template ~50%)" }
    console.log(`  ${k.padEnd(14)} ${((100 * ok) / test.length).toFixed(0)}%${baseline[k] ?? ""}`)
  })

  // Persist the model + target label lists so it can later be wired into decodePrimaryAligned.
  mkdirSync(MODEL_DIR, { recursive: true })
  await model.save(fileSaveHandler(MODEL_DIR))
  writeFileSync(join(MODEL_DIR, "targets.json"), JSON.stringify({ size: SZ, targets: TARGETS }))
  console.log(`\nsaved model → ${MODEL_DIR}/ (model.json, weights.bin, targets.json)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

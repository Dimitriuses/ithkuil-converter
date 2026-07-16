/**
 * Top-extension CNN — reads the top consonant of a 3-consonant cluster (or NONE).
 *
 * A triconsonantal root C1-C2-C3 renders as one secondary: top:C1 + core:C2 + bottom:C3.
 * The core-conditioned top-zone template caps at ~68% top recovery (full top+core+bottom
 * 48%): it both MISSES real tops (19%, the margin gate says "none") and mis-IDs them (13%,
 * it conditions on a possibly-wrong core). A CNN over the whole base crop learns the core
 * conditioning implicitly and reads presence + identity jointly: it classifies the top as
 * one of {NONE} ∪ consonants, so the NONE class *is* the top-vs-none detector and the
 * consonant classes fix identity — in one model.
 *
 * Trained on the realistic secondary distribution (bare / core+bottom / core+top+bottom),
 * so bare and 2-consonant bases learn NONE (no spurious top — the no-regression rule).
 *
 *   npm run cnn-top -- [nSamples] [epochs] [size]
 */
import "./dom-shim.js"
import * as tf from "@tensorflow/tfjs-node"
import { Secondary } from "@zsnout/ithkuil/script"
import { renderGlyphToSvg } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng, cropRgba } from "./image-io.js"
import { binarize, segment } from "./segment.js"
import { toGrayNxN } from "./cnn-data.js"
import { augmentImage, AUGMENT_ON } from "./augment.js"
import { fileSaveHandler } from "./cnn-io.js"
import { CONSONANTS } from "./glyph-classes.js"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const N = process.argv[2] ? Number(process.argv[2]) : 6000
const EPOCHS = process.argv[3] ? Number(process.argv[3]) : 40
// Input resolution (arg 4). The top mark sits in the upper ~42% of the base, so it needs
// enough rows to survive the resize — 64px is the deployed default. Other sizes get
// suffixed paths so an experiment never clobbers the deployed model.
const SZ = process.argv[4] ? Number(process.argv[4]) : 64
// `-aug` keeps an augmented (scan-robust) run from clobbering the deployed clean model/cache.
const SUFFIX = `${SZ === 64 ? "" : `-${SZ}`}${AUGMENT_ON ? "-aug" : ""}`
const MODEL_DIR = `models/top-cnn${SUFFIX}`
const CACHE_PATH = `models/top-cnn-data${SUFFIX}.json`
const CACHE_VERSION = 1

// The label set: NONE (no top) + every consonant that can be a top extension.
const CONS = CONSONANTS.map(String)
const LABELS = ["NONE", ...CONS]

let rng = 20260713 >>> 0
const rand = () => {
  rng = (rng + 0x6d2b79f5) | 0
  let t = Math.imul(rng ^ (rng >>> 15), 1 | rng)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(a: readonly T[]): T => a[(rand() * a.length) | 0]!

interface Sample {
  gray: Float32Array
  label: number
}

function generate(n: number): Sample[] {
  const out: Sample[] = []
  for (let i = 0; i < n; i++) {
    // Realistic secondary shape: bare (15%) / core+bottom (25%) / core+top+bottom (60%).
    // A top only ever co-occurs with a bottom (real triconsonantal roots), so we never
    // render top-without-bottom — that keeps bare/2-consonant firmly in the NONE class.
    const r = rand()
    const hasBottom = r >= 0.15
    const hasTop = r >= 0.4
    const core = pick(CONS)
    const top = hasTop ? pick(CONS) : null
    const bottom = hasBottom ? pick(CONS) : null
    const spec = {
      core: core as never,
      ...(top ? { top: top as never } : {}),
      ...(bottom ? { bottom: bottom as never } : {}),
    }
    let img
    try {
      const raw = decodePng(svgToPng(renderGlyphToSvg(Secondary(spec), {}, { canvas: 128 }), { width: 256 }))
      img = AUGMENT_ON ? augmentImage(raw, rand) : raw
    } catch {
      continue
    }
    const bmp = binarize(img.data, img.width, img.height)
    const region = segment(bmp)[0]
    if (!region) continue
    const gray = toGrayNxN(cropRgba(img, region.base), SZ)
    out.push({ gray, label: LABELS.indexOf(top ?? "NONE") })
    if ((i + 1) % 200 === 0) console.log(`  generated ${i + 1}/${n}`)
  }
  return out
}

// Rendering is ~130 ms/sample, so the generated set is cached (gray quantized to bytes)
// and reused — lets training be re-run/tuned without re-rendering.
function loadCache(): Sample[] | null {
  try {
    const j = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as {
      version: number
      size: number
      labels: number[]
      gray: string
    }
    if (j.version !== CACHE_VERSION || j.size !== SZ) return null
    const bytes = new Uint8Array(Buffer.from(j.gray, "base64"))
    const per = SZ * SZ
    return j.labels.map((l, i) => {
      const gray = new Float32Array(per)
      for (let p = 0; p < per; p++) gray[p] = bytes[i * per + p] / 255
      return { gray, label: l }
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
    writeFileSync(
      CACHE_PATH,
      JSON.stringify({
        version: CACHE_VERSION,
        size: SZ,
        labels: samples.map((s) => s.label),
        gray: Buffer.from(bytes).toString("base64"),
      }),
    )
  } catch {
    /* best-effort */
  }
}

function loadOrGenerate(n: number): Sample[] {
  const cached = loadCache()
  if (cached && cached.length >= n) {
    console.log(`loaded ${n} of ${cached.length} cached secondaries (${CACHE_PATH})`)
    return cached.slice(0, n)
  }
  console.log(`generating ${n} secondaries (${SZ}px, bare / +bottom / +top+bottom)…`)
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

async function main(): Promise<void> {
  const all = loadOrGenerate(N)
  const nTest = Math.floor(all.length * 0.2)
  const test = all.slice(0, nTest)
  const train = all.slice(nTest)
  const nNone = all.filter((s) => s.label === 0).length
  console.log(`generated ${all.length}: ${train.length} train / ${test.length} test · ${nNone} NONE / ${all.length - nNone} with-top`)

  const model = tf.sequential()
  model.add(tf.layers.conv2d({ inputShape: [SZ, SZ, 1], filters: 16, kernelSize: 3, activation: "relu" }))
  model.add(tf.layers.maxPooling2d({ poolSize: 2 }))
  model.add(tf.layers.conv2d({ filters: 32, kernelSize: 3, activation: "relu" }))
  model.add(tf.layers.maxPooling2d({ poolSize: 2 }))
  model.add(tf.layers.conv2d({ filters: 32, kernelSize: 3, activation: "relu" }))
  model.add(tf.layers.maxPooling2d({ poolSize: 2 }))
  model.add(tf.layers.flatten())
  model.add(tf.layers.dense({ units: 96, activation: "relu" }))
  model.add(tf.layers.dropout({ rate: 0.3 }))
  model.add(tf.layers.dense({ units: LABELS.length, activation: "softmax" }))
  model.compile({ optimizer: tf.train.adam(0.001), loss: "categoricalCrossentropy", metrics: ["accuracy"] })
  console.log(`model params: ${model.countParams()} · ${LABELS.length} classes · training ${EPOCHS} epochs…`)

  const xs = stack(train)
  const ys = tf.oneHot(tf.tensor1d(train.map((s) => s.label), "int32"), LABELS.length)
  const t0 = Date.now()
  await model.fit(xs, ys, {
    epochs: EPOCHS,
    batchSize: 32,
    validationSplit: 0.12,
    verbose: 0,
    callbacks: {
      onEpochEnd: (e, logs) => {
        if ((e + 1) % 5 === 0 || e === 0)
          console.log(`  epoch ${e + 1}/${EPOCHS}  loss ${logs?.loss?.toFixed(2)}  acc ${logs?.acc?.toFixed(3)}  (${((Date.now() - t0) / (e + 1) / 1000).toFixed(1)}s/ep)`)
      },
    },
  })

  // Held-out: overall, plus the two decisions that matter — presence (NONE vs top) and,
  // among true tops, identity.
  const preds = tf.tidy(() => (model.predict(stack(test)) as tf.Tensor).argMax(1).arraySync() as number[])
  let ok = 0, presOk = 0, idOk = 0, idN = 0, spurious = 0, noneN = 0
  for (let i = 0; i < test.length; i++) {
    const y = test[i].label, p = preds[i]
    if (p === y) ok++
    const yHasTop = y !== 0, pHasTop = p !== 0
    if (yHasTop === pHasTop) presOk++
    if (!yHasTop) {
      noneN++
      if (pHasTop) spurious++
    } else {
      idN++
      if (p === y) idOk++
    }
  }
  console.log(`\nheld-out (${test.length}):`)
  console.log(`  overall (NONE+id)      ${((100 * ok) / test.length).toFixed(0)}%`)
  console.log(`  presence (top vs none) ${((100 * presOk) / test.length).toFixed(0)}%`)
  console.log(`  identity | top present ${((100 * idOk) / idN).toFixed(0)}%  (n=${idN})`)
  console.log(`  spurious top on NONE   ${((100 * spurious) / noneN).toFixed(0)}%  (n=${noneN})`)

  mkdirSync(MODEL_DIR, { recursive: true })
  await model.save(fileSaveHandler(MODEL_DIR))
  writeFileSync(join(MODEL_DIR, "labels.json"), JSON.stringify({ size: SZ, labels: LABELS }))
  console.log(`\nsaved model → ${MODEL_DIR}/ (model.json, weights.bin, labels.json)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

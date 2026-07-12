/**
 * Milestone 9 — CNN consonant classifier: train on the synthetic (geometric + noise
 * augmented) dataset and compare head-to-head with the template baseline on the same
 * held-out noisy test set. The CNN is expected to win on the near-identical pairs
 * (p/b, f/v, t/d, g/k, ḑ/ţ) that a coarse Chamfer template match confuses.
 *
 * Uses the native @tensorflow/tfjs-node backend (~30× faster than pure-JS CPU), so it
 * trains a full-size model (48px, 16/32 filters, all samples) in seconds/minutes.
 *
 *   npm run cnn -- [dataset-dir] [epochs] [trainPerClass]
 */
import * as tf from "@tensorflow/tfjs-node"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { CNN_SIZE, loadDataset, type LoadedSample } from "./cnn-data.js"
import { chamferSimilarity } from "./chamfer.js"
import { fileSaveHandler } from "./cnn-io.js"
import type { Mask } from "./normalize.js"

const MODEL_DIR = "models/consonant-cnn"

const DIR = process.argv[2] ?? "cnn-dataset"
const EPOCHS = process.argv[3] ? Number(process.argv[3]) : 30

const ds = loadDataset(DIR, CNN_SIZE)
const K = ds.labels.length
const SZ = CNN_SIZE

// Split: clean sample per class → template references; augmented → 75% train / 25% test.
const cleanByLabel = new Map(ds.samples.filter((s) => s.clean).map((s) => [s.label, s]))
const augByLabel = new Map<string, LoadedSample[]>()
for (const s of ds.samples) if (!s.clean) (augByLabel.get(s.label) ?? augByLabel.set(s.label, []).get(s.label)!).push(s)

// Native backend is fast, so use all augmented samples per class by default (the tiny
// cap was a pure-JS-CPU workaround).
const TRAIN_PER_CLASS = process.argv[4] ? Number(process.argv[4]) : 1000
const train: LoadedSample[] = []
const test: LoadedSample[] = []
for (const arr of augByLabel.values()) {
  const nTest = Math.max(1, Math.floor(arr.length * 0.25))
  test.push(...arr.slice(0, nTest))
  train.push(...arr.slice(nTest, nTest + TRAIN_PER_CLASS))
}

// Shuffle train (seeded) so tfjs `validationSplit` — which takes the LAST fraction
// without shuffling — samples across all classes instead of holding out whole
// classes (our data is class-ordered).
let rngState = 12345 >>> 0
const rng = () => {
  rngState = (rngState + 0x6d2b79f5) | 0
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
for (let i = train.length - 1; i > 0; i--) {
  const j = (rng() * (i + 1)) | 0
  ;[train[i], train[j]] = [train[j], train[i]]
}

function stack(samples: LoadedSample[]): tf.Tensor4D {
  const buf = new Float32Array(samples.length * SZ * SZ)
  for (let i = 0; i < samples.length; i++) buf.set(samples[i].gray, i * SZ * SZ)
  return tf.tensor4d(buf, [samples.length, SZ, SZ, 1])
}
const maskOf = (gray: Float32Array): Mask => {
  const data = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i++) data[i] = gray[i] > 0.5 ? 1 : 0
  return { size: SZ, data }
}

async function main(): Promise<void> {
  console.log(`dataset ${DIR}: ${K} classes, ${train.length} train / ${test.length} test (${SZ}×${SZ})`)

  const model = tf.sequential()
  model.add(tf.layers.conv2d({ filters: 16, kernelSize: 3, activation: "relu", inputShape: [SZ, SZ, 1] }))
  model.add(tf.layers.maxPooling2d({ poolSize: 2 }))
  model.add(tf.layers.conv2d({ filters: 32, kernelSize: 3, activation: "relu" }))
  model.add(tf.layers.maxPooling2d({ poolSize: 2 }))
  model.add(tf.layers.conv2d({ filters: 32, kernelSize: 3, activation: "relu" }))
  model.add(tf.layers.maxPooling2d({ poolSize: 2 }))
  model.add(tf.layers.flatten())
  model.add(tf.layers.dense({ units: 64, activation: "relu" }))
  model.add(tf.layers.dropout({ rate: 0.3 }))
  model.add(tf.layers.dense({ units: K, activation: "softmax" }))
  model.compile({ optimizer: tf.train.adam(0.001), loss: "categoricalCrossentropy", metrics: ["accuracy"] })
  console.log(`model params: ${model.countParams()} · training ${EPOCHS} epochs…`)

  const xs = stack(train)
  const ys = tf.oneHot(tf.tensor1d(train.map((s) => s.labelIndex), "int32"), K)
  const t0 = Date.now()
  let epochStart = t0
  await model.fit(xs, ys, {
    epochs: EPOCHS,
    batchSize: 32,
    validationSplit: 0.15,
    verbose: 0,
    callbacks: {
      onEpochBegin: () => {
        epochStart = Date.now()
      },
      onEpochEnd: (e, logs) => {
        const done = e + 1
        const epSecs = (Date.now() - epochStart) / 1000
        const etaMin = ((EPOCHS - done) * (Date.now() - t0)) / done / 60000
        const valAcc = (logs?.val_acc ?? logs?.val_accuracy) as number | undefined
        console.log(
          `  epoch ${done}/${EPOCHS}  loss ${logs?.loss?.toFixed(3)}  valAcc ${valAcc?.toFixed(3)}  (${epSecs.toFixed(0)}s/epoch, ETA ${etaMin.toFixed(1)}m)`,
        )
      },
    },
  })

  // --- CNN on test set ---
  const predIdx = (tf.tidy(() => (model.predict(stack(test)) as tf.Tensor).argMax(1)).arraySync()) as number[]
  let cnnOk = 0
  for (let i = 0; i < test.length; i++) if (predIdx[i] === test[i].labelIndex) cnnOk++

  // --- template baseline on the same test set (clean samples as templates) ---
  const templates = [...cleanByLabel.entries()].map(([label, s]) => ({ label, mask: maskOf(s.gray) }))
  let tmplOk = 0
  const cnnConf: string[] = []
  const tmplConf: string[] = []
  for (let i = 0; i < test.length; i++) {
    const m = maskOf(test[i].gray)
    let best = "", bestScore = -1
    for (const t of templates) {
      const sc = chamferSimilarity(m, t.mask)
      if (sc > bestScore) { bestScore = sc; best = t.label }
    }
    if (best === test[i].label) tmplOk++
    else tmplConf.push(`${test[i].label}→${best}`)
    if (predIdx[i] !== test[i].labelIndex) cnnConf.push(`${test[i].label}→${ds.labels[predIdx[i]]}`)
  }

  const pct = (n: number) => ((100 * n) / test.length).toFixed(1)
  console.log(`\nheld-out noisy test (${test.length} samples):`)
  console.log(`  CNN accuracy:      ${pct(cnnOk)}%`)
  console.log(`  template baseline: ${pct(tmplOk)}%`)
  const tally = (a: string[]) => [...a.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())]
    .sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => `${k}×${n}`).join("  ")
  if (tmplConf.length) console.log(`  template errors: ${tally(tmplConf)}`)
  if (cnnConf.length) console.log(`  CNN errors:      ${tally(cnnConf)}`)

  // Persist the trained model + label list so inference can reuse it.
  mkdirSync(MODEL_DIR, { recursive: true })
  await model.save(fileSaveHandler(MODEL_DIR))
  writeFileSync(join(MODEL_DIR, "labels.json"), JSON.stringify({ labels: ds.labels, size: SZ }))
  console.log(`\nsaved model → ${MODEL_DIR}/ (model.json, weights.bin, labels.json)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * Load the persisted multi-task primary-feature CNN (see cnn-primary.ts) and read a
 * primary glyph's features — specification, perspective, context, function, version,
 * stem. This is the inference side that lets `decodePrimaryAligned` decode Vr/Vv
 * (function/context and stem/version), which template matching can't do under Ca
 * co-variation (it collapses to ~50-65%; the CNN reads 84-100%).
 */
import * as tf from "@tensorflow/tfjs-node"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileLoadHandler } from "./cnn-io.js"
import { toGrayNxN } from "./cnn-data.js"
import type { RgbaImage } from "./image-io.js"

export interface PrimaryFeatures {
  specification: string
  perspective: string
  context: string
  function: string
  version: string
  stem: string
  /** Per-feature softmax confidence of the winning class, keyed by feature name. */
  confidence: Record<string, number>
}

export interface PrimaryCnn {
  size: number
  keys: string[]
  classifyImage(img: RgbaImage): PrimaryFeatures
}

export async function loadPrimaryCnn(dir = "models/primary-cnn"): Promise<PrimaryCnn> {
  const model = await tf.loadLayersModel(fileLoadHandler(dir))
  const { size, targets } = JSON.parse(readFileSync(join(dir, "targets.json"), "utf8")) as {
    size: number
    targets: Record<string, string[]>
  }
  // Map each model output tensor to its feature by the head's NAME (robust to output
  // ordering), falling back to targets-key order if names are missing.
  const keys = Object.keys(targets)
  const outNames = (model.outputNames ?? []).map((n) => n.split("/")[0])

  const classifyImage = (img: RgbaImage): PrimaryFeatures => {
    const gray = toGrayNxN(img, size)
    const probsByOutput = tf.tidy(() => {
      const preds = model.predict(tf.tensor4d(gray, [1, size, size, 1])) as tf.Tensor[]
      const arr = Array.isArray(preds) ? preds : [preds]
      return arr.map((p) => Array.from(p.dataSync()))
    })
    const result: Record<string, unknown> = { confidence: {} as Record<string, number> }
    keys.forEach((k, ki) => {
      // find this feature's output tensor by name, else assume same order
      const oi = outNames.indexOf(k)
      const probs = probsByOutput[oi >= 0 ? oi : ki]
      let bi = 0
      for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bi]) bi = i
      result[k] = targets[k][bi]
      ;(result.confidence as Record<string, number>)[k] = probs[bi]
    })
    return result as unknown as PrimaryFeatures
  }

  return { size, keys, classifyImage }
}

/**
 * Load the persisted alphabetic-base CNN (see cnn-alpha.ts) and read a syllable's
 * consonant slots — core, top, bottom — from the SAME `frameSquare` binary mask the
 * chamfer match uses. Sharing that normalized shape representation is what makes the CNN
 * robust to the isolated-vs-pipeline rendering gap (an aspect-preserving grayscale crop
 * was not — it read clean in training but collapsed in-pipeline). Per-slot softmax heads
 * then fix the joint match's n↔ż / d↔ļ slot trade-offs. Empty slots come back as "".
 */
import * as tf from "@tensorflow/tfjs-node"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileLoadHandler } from "./cnn-io.js"
import type { Mask } from "./normalize.js"

export interface AlphaBase {
  core: string
  top: string
  bottom: string
  /** Per-slot softmax confidence of the winning class. */
  confidence: Record<string, number>
}

export interface AlphabeticCnn {
  size: number
  classifyBase(mask: Mask): AlphaBase
}

export async function loadAlphabeticCnn(dir = "models/alpha-cnn"): Promise<AlphabeticCnn> {
  const model = await tf.loadLayersModel(fileLoadHandler(dir))
  const { size, slots, labels } = JSON.parse(readFileSync(join(dir, "slots.json"), "utf8")) as {
    size: number
    slots: string[]
    labels: string[]
  }
  // Map each output tensor to its slot by the head's NAME (robust to output ordering).
  const outNames = (model.outputNames ?? []).map((n) => n.split("/")[0])

  const classifyBase = (mask: Mask): AlphaBase => {
    const buf = new Float32Array(size * size)
    for (let i = 0; i < buf.length; i++) buf[i] = mask.data[i] ? 1 : 0
    const probsByOutput = tf.tidy(() => {
      const preds = model.predict(tf.tensor4d(buf, [1, size, size, 1])) as tf.Tensor[]
      const arr = Array.isArray(preds) ? preds : [preds]
      return arr.map((p) => Array.from(p.dataSync()))
    })
    const result = { confidence: {} as Record<string, number> } as AlphaBase
    slots.forEach((slot, si) => {
      const oi = outNames.indexOf(slot)
      const probs = probsByOutput[oi >= 0 ? oi : si]
      let bi = 0
      for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bi]) bi = i
      const label = labels[bi]
      ;(result as unknown as Record<string, string>)[slot] = label === "NONE" ? "" : label
      result.confidence[slot] = probs[bi]
    })
    return result
  }

  return { size, classifyBase }
}

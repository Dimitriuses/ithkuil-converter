/**
 * Load the formative-root secondary CNN (see cnn-secondary.ts) and read a secondary's
 * consonant slots — core, top, bottom — from the SAME `frameSquare` binary mask the chamfer
 * match uses. Per-slot softmax heads read core+bottom independently, fixing the joint
 * match's collapse (100% → 69%) when a top extension is present. Empty slots come back as
 * "" (a `""` core also marks a spilled placeholder secondary); `GEM` (CORE_GEMINATE) is
 * returned raw so the caller can double the core consonant.
 */
import * as tf from "@tensorflow/tfjs-node"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileLoadHandler } from "./cnn-io.js"
import type { Mask } from "./normalize.js"

export interface SecondarySlots {
  core: string
  top: string
  bottom: string
  /** Per-slot softmax confidence of the winning class. */
  confidence: Record<string, number>
}

export interface SecondaryCnn {
  size: number
  classifyBase(mask: Mask): SecondarySlots
}

export async function loadSecondaryCnn(dir = "models/secondary-cnn"): Promise<SecondaryCnn> {
  const model = await tf.loadLayersModel(fileLoadHandler(dir))
  const { size, slots, labels } = JSON.parse(readFileSync(join(dir, "slots.json"), "utf8")) as {
    size: number
    slots: string[]
    labels: string[]
  }
  const outNames = (model.outputNames ?? []).map((n) => n.split("/")[0])

  const classifyBase = (mask: Mask): SecondarySlots => {
    const buf = new Float32Array(size * size)
    for (let i = 0; i < buf.length; i++) buf[i] = mask.data[i] ? 1 : 0
    const probsByOutput = tf.tidy(() => {
      const preds = model.predict(tf.tensor4d(buf, [1, size, size, 1])) as tf.Tensor[]
      const arr = Array.isArray(preds) ? preds : [preds]
      return arr.map((p) => Array.from(p.dataSync()))
    })
    const result = { confidence: {} as Record<string, number> } as SecondarySlots
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

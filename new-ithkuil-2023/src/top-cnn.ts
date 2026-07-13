/**
 * Load the persisted top-extension CNN (see cnn-top.ts) and read a secondary base's top
 * consonant. Returns the top consonant, or null for NONE — the "top-vs-none detector"
 * that replaces the margin-gated top-zone template (which capped 3-consonant clusters at
 * ~68% top / 48% full: it missed real tops and mis-IDed them).
 */
import * as tf from "@tensorflow/tfjs-node"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileLoadHandler } from "./cnn-io.js"
import { toGrayNxN } from "./cnn-data.js"
import type { RgbaImage } from "./image-io.js"

export interface TopPrediction {
  /** The decoded top consonant, or null when the CNN reads NONE. */
  top: string | null
  /** Softmax confidence of the winning class. */
  confidence: number
  /** Confidence that a top is present (1 − P(NONE)). */
  present: number
}

export interface TopCnn {
  size: number
  classifyImage(img: RgbaImage): TopPrediction
}

export async function loadTopCnn(dir = "models/top-cnn"): Promise<TopCnn> {
  const model = await tf.loadLayersModel(fileLoadHandler(dir))
  const { size, labels } = JSON.parse(readFileSync(join(dir, "labels.json"), "utf8")) as {
    size: number
    labels: string[]
  }
  const noneIdx = labels.indexOf("NONE")

  const classifyImage = (img: RgbaImage): TopPrediction => {
    const gray = toGrayNxN(img, size)
    const probs = tf.tidy(() => {
      const p = model.predict(tf.tensor4d(gray, [1, size, size, 1])) as tf.Tensor
      return Array.from(p.dataSync())
    })
    let bi = 0
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bi]) bi = i
    return {
      top: bi === noneIdx ? null : labels[bi],
      confidence: probs[bi],
      present: 1 - (probs[noneIdx] ?? 0),
    }
  }

  return { size, classifyImage }
}

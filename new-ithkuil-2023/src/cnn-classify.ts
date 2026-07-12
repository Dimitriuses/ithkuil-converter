/**
 * Load a persisted CNN and classify glyph images — the inference side of Milestone 9,
 * usable by the reverse pipeline (e.g. as the consonant classifier for a segmented
 * secondary base). Inference runs fine on the pure-JS backend (only conv *training*
 * is slow / unsupported on wasm).
 */
import * as tf from "@tensorflow/tfjs-node"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileLoadHandler } from "./cnn-io.js"
import { toGrayNxN } from "./cnn-data.js"
import type { RgbaImage } from "./image-io.js"

export interface CnnPrediction {
  label: string
  score: number
  candidates: { label: string; score: number }[]
}

export interface CnnClassifier {
  labels: string[]
  size: number
  /** Classify a pre-normalized N×N grayscale array. */
  classifyGray(gray: Float32Array): CnnPrediction
  /** Classify an RGBA image (bbox-crops + normalizes internally). */
  classifyImage(img: RgbaImage): CnnPrediction
}

export async function loadCnnClassifier(dir = "models/consonant-cnn"): Promise<CnnClassifier> {
  const model = await tf.loadLayersModel(fileLoadHandler(dir))
  const { labels, size } = JSON.parse(readFileSync(join(dir, "labels.json"), "utf8")) as {
    labels: string[]
    size: number
  }

  const classifyGray = (gray: Float32Array): CnnPrediction => {
    const probs = tf.tidy(() =>
      (model.predict(tf.tensor4d(gray, [1, size, size, 1])) as tf.Tensor).dataSync(),
    )
    const scored = labels
      .map((label, i) => ({ label, score: probs[i] }))
      .sort((a, b) => b.score - a.score)
    return { label: scored[0].label, score: scored[0].score, candidates: scored.slice(0, 3) }
  }

  return {
    labels,
    size,
    classifyGray,
    classifyImage: (img) => classifyGray(toGrayNxN(img, size)),
  }
}

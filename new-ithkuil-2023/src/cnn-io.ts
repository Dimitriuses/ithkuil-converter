/**
 * Filesystem save/load for tfjs models. The pure-JS `@tensorflow/tfjs` build has no
 * `file://` IO handler (that's tfjs-node only), so we implement minimal handlers that
 * write/read the model topology + weight specs (model.json) and raw weights (weights.bin).
 */
// Type-only import: these handlers do no runtime tf calls (they just serialize the
// model artifacts), so we borrow the `io` types from tfjs without loading a second
// runtime alongside tfjs-node. tfjs-node's own type declarations don't re-export `io`.
import type * as tf from "@tensorflow/tfjs"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** IOHandler that writes a model to `dir`. Use with `model.save(fileSaveHandler(dir))`. */
export function fileSaveHandler(dir: string): tf.io.IOHandler {
  return {
    save: async (artifacts: tf.io.ModelArtifacts): Promise<tf.io.SaveResult> => {
      mkdirSync(dir, { recursive: true })
      const { modelTopology, weightSpecs, format, generatedBy, convertedBy } = artifacts
      writeFileSync(
        join(dir, "model.json"),
        JSON.stringify({ modelTopology, weightSpecs, format, generatedBy, convertedBy }),
      )
      const weightData = artifacts.weightData as ArrayBuffer
      writeFileSync(join(dir, "weights.bin"), Buffer.from(weightData))
      return {
        modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" },
      }
    },
  }
}

/** IOHandler that reads a model from `dir`. Use with `tf.loadLayersModel(fileLoadHandler(dir))`. */
export function fileLoadHandler(dir: string): tf.io.IOHandler {
  return {
    load: async (): Promise<tf.io.ModelArtifacts> => {
      const meta = JSON.parse(readFileSync(join(dir, "model.json"), "utf8"))
      const buf = readFileSync(join(dir, "weights.bin"))
      return {
        modelTopology: meta.modelTopology,
        weightSpecs: meta.weightSpecs,
        weightData: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      }
    },
  }
}

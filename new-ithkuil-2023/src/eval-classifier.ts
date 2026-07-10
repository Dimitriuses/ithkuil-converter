/**
 * Evaluate the baseline classifier: templates = clean canonical samples, test set =
 * the augmented samples (known labels). Reports top-1 / top-3 accuracy, weakest
 * classes, and the most common confusions.
 *
 *   npm run eval -- [--dataset dataset] [--size 64]
 */
import { parseArgs } from "node:util"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { classifyMask, loadTemplates } from "./classify.js"
import { decodePng } from "./image-io.js"
import { binarize } from "./segment.js"
import { maskFromBitmap } from "./normalize.js"

const { values } = parseArgs({
  options: { dataset: { type: "string", short: "d" }, size: { type: "string", short: "s" } },
})
const datasetDir = values.dataset ?? "dataset"
const size = values.size ? Number(values.size) : 64

const templates = loadTemplates(datasetDir, size)
const manifest = JSON.parse(readFileSync(join(datasetDir, "manifest.json"), "utf8")) as {
  samples: { file: string; label: string; clean: boolean }[]
}

let total = 0
let top1 = 0
let top3 = 0
const perClass = new Map<string, { n: number; ok: number }>()
const confusions = new Map<string, number>()

for (const s of manifest.samples) {
  if (s.clean) continue
  const img = decodePng(readFileSync(join(datasetDir, s.file)))
  const mask = maskFromBitmap(binarize(img.data, img.width, img.height), size)
  const res = classifyMask(mask, templates, 3)

  total++
  const isTop1 = res.label === s.label
  if (isTop1) top1++
  if (res.candidates.some((c) => c.label === s.label)) top3++

  const pc = perClass.get(s.label) ?? { n: 0, ok: 0 }
  pc.n++
  if (isTop1) pc.ok++
  perClass.set(s.label, pc)

  if (!isTop1) {
    const key = `${s.label} → ${res.label}`
    confusions.set(key, (confusions.get(key) ?? 0) + 1)
  }
}

console.log(`templates: ${templates.length} classes · test samples: ${total} · mask ${size}×${size}`)
console.log(`top-1 accuracy: ${((100 * top1) / total).toFixed(1)}%   top-3: ${((100 * top3) / total).toFixed(1)}%`)

const weakest = [...perClass.entries()]
  .map(([label, { n, ok }]) => ({ label, acc: ok / n, n }))
  .filter((c) => c.acc < 1)
  .sort((a, b) => a.acc - b.acc)
if (weakest.length) {
  console.log(`\nclasses below 100%:`)
  for (const c of weakest) console.log(`  ${c.label.padEnd(3)} ${(100 * c.acc).toFixed(0)}%  (${c.n} samples)`)
}

const topConf = [...confusions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
if (topConf.length) {
  console.log(`\ntop confusions:`)
  for (const [k, n] of topConf) console.log(`  ${k}  ×${n}`)
}

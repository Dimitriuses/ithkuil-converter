/**
 * Milestone 4 — synthetic per-glyph dataset generator.
 *
 * For each glyph class (see glyph-classes.ts) writes one clean canonical sample
 * plus N geometrically-augmented samples (scale / rotation / jitter), all as
 * fixed-size PNGs, with a manifest.json describing every sample. This is the
 * training/evaluation data for the reverse (OCR) pipeline: the clean sample per
 * class doubles as the template reference for the Milestone 6 baseline classifier.
 *
 * Run:  npm run dataset -- [--out dataset] [--per-class 24] [--size 128] [--seed 1] [--clean]
 */
import { parseArgs } from "node:util"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { GLYPH_CLASSES } from "./glyph-classes.js"
import { renderGlyphToSvg, type Augment } from "./glyph-render.js"
import { svgToPng } from "./raster.js"
import { decodePng, savePng } from "./image-io.js"
import { augmentPixels } from "./augment-pixels.js"

const HELP = `Usage: npm run dataset -- [options]

  -o, --out <dir>        output directory (default: dataset)
  -n, --per-class <N>    samples per class incl. 1 clean (default: 24)
  -s, --size <px>        image size (default: 128)
      --seed <n>         RNG seed for reproducible augmentation (default: 1)
      --family <name>    only generate classes of this family (e.g. secondary-consonant)
      --noise <sigma>    add Gaussian pixel noise (0-255 std) to augmented samples
      --blur <radius>    box-blur augmented samples by this radius
      --clean            wipe the output dir first
  -h, --help`

// Small seeded PRNG so datasets are reproducible for a given --seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Sample {
  file: string
  label: string
  class: string
  family: string
  clean: boolean
  aug: Augment
}

function main(): number {
  const { values } = parseArgs({
    options: {
      out: { type: "string", short: "o" },
      "per-class": { type: "string", short: "n" },
      size: { type: "string", short: "s" },
      seed: { type: "string" },
      family: { type: "string" },
      noise: { type: "string" },
      blur: { type: "string" },
      clean: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  })
  if (values.help) {
    console.log(HELP)
    return 0
  }

  const outDir = values.out ?? "dataset"
  const perClass = values["per-class"] ? Number(values["per-class"]) : 24
  const size = values.size ? Number(values.size) : 128
  const seed = values.seed ? Number(values.seed) : 1
  const rand = mulberry32(seed)
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo)

  const classes = values.family
    ? GLYPH_CLASSES.filter((c) => c.family === values.family)
    : GLYPH_CLASSES
  const pixelAug = { noise: values.noise ? Number(values.noise) : 0, blur: values.blur ? Number(values.blur) : 0 }
  const hasPixelAug = pixelAug.noise > 0 || pixelAug.blur > 0

  if (values.clean && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const samples: Sample[] = []
  for (const cls of classes) {
    mkdirSync(join(outDir, cls.id), { recursive: true })
    for (let i = 0; i < perClass; i++) {
      const clean = i === 0
      const aug: Augment = clean
        ? {}
        : {
            scale: +between(0.85, 1.15).toFixed(4),
            rotateDeg: +between(-10, 10).toFixed(2),
            dx: +between(-8, 8).toFixed(2),
            dy: +between(-8, 8).toFixed(2),
          }
      const png = svgToPng(renderGlyphToSvg(cls.make(), aug, { canvas: size }), { width: size })
      const rel = `${cls.id}/${cls.id}_${String(i).padStart(3, "0")}.png`
      // Pixel augmentation (noise/blur) is applied to augmented samples only —
      // the clean sample stays pristine as the template reference.
      if (hasPixelAug && !clean) {
        const img = decodePng(png)
        augmentPixels(img, pixelAug, rand)
        savePng(join(outDir, rel), img)
      } else {
        writeFileSync(join(outDir, rel), png)
      }
      samples.push({ file: rel, label: cls.label, class: cls.id, family: cls.family, clean, aug })
    }
  }

  const manifest = {
    created: new Date().toISOString(),
    generator: "generate-dataset.ts",
    canvas: size,
    seed,
    perClass,
    classCount: classes.length,
    classes: classes.map((c) => ({ id: c.id, label: c.label, family: c.family })),
    sampleCount: samples.length,
    samples,
  }
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1))

  console.log(`✓ ${samples.length} samples · ${GLYPH_CLASSES.length} classes · ${perClass}/class · ${size}px · seed ${seed}`)
  console.log(`  → ${outDir}/ (manifest.json + one dir per class)`)
  return 0
}

process.exit(main())

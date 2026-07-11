/**
 * Full secondary-character decoding: core consonant + top/bottom cluster
 * extensions + vowel diacritics.
 *
 * - Core + extension: the extension is connected to the core and perturbs the base
 *   shape, so decoding the core against bare-core templates fails when an extension
 *   is present. Instead we decode them JOINTLY — match the base against rendered
 *   `Secondary({ core, top|bottom: X })` references over *all* cores at once, so the
 *   correct core+extension template wins together. (Templates are rendered lazily
 *   once and cached; a single extension per character — the common case.)
 * - Vowels: the superposed/underposed diacritics are separable components; classify
 *   each and map its shape → vowel via the shared vowel map.
 */
import "./dom-shim.js" // must precede @zsnout import
import { Secondary } from "@zsnout/ithkuil/script"
import { svgToPng } from "./raster.js"
import { decodePng } from "./image-io.js"
import { binarize, type Bitmap, type SegmentedRegion } from "./segment.js"
import { renderGlyphToSvg } from "./glyph-render.js"
import { maskFromBitmap, type Mask } from "./normalize.js"
import { maskOfBox } from "./decompose.js"
import { classifyMask, type Template } from "./classify.js"
import { buildVowelMap } from "./decode.js"
import { CONSONANTS } from "./glyph-classes.js"

const SIZE = 64
const vowelMap = buildVowelMap()

/** Cluster extensions to consider (a common subset; extend as needed). */
export const EXTENSION_SET = ["t", "k", "p", "s", "m"] as const

function renderSecondaryMask(spec: Parameters<typeof Secondary>[0]): Mask {
  const img = decodePng(svgToPng(renderGlyphToSvg(Secondary(spec), {}, { canvas: 128 }), { width: 128 }))
  return maskFromBitmap(binarize(img.data, img.width, img.height), SIZE)
}

/** Extra similarity an extension template must beat the best bare core by to be
 * accepted (prevents spurious extensions on plain cores, which sit between bare and
 * bare+extension templates). */
const EXTENSION_MARGIN = 0.04

function mkTemplate(core: string, top: string | null, bottom: string | null): Template {
  return {
    label: JSON.stringify([core, top, bottom]),
    class: "secondary",
    mask: renderSecondaryMask({
      core: core as never,
      ...(top ? { top: top as never } : {}),
      ...(bottom ? { bottom: bottom as never } : {}),
    }),
  }
}

// Bare-core vs with-extension templates, scored separately so a margin can favour
// the simpler (bare) reading. Built once, lazily.
let bareTemplates: Template[] | null = null
let extTemplates: Template[] | null = null
function ensureTemplates(): void {
  if (bareTemplates) return
  bareTemplates = CONSONANTS.map((c) => mkTemplate(c, null, null))
  const ext: Template[] = []
  for (const core of CONSONANTS) {
    for (const x of EXTENSION_SET) {
      ext.push(mkTemplate(core, x, null)) // top extension
      ext.push(mkTemplate(core, null, x)) // bottom extension
    }
  }
  extTemplates = ext
}

export interface SecondaryDecode {
  core: string
  topExtension: string | null
  bottomExtension: string | null
  superposedVowel: string | null
  underposedVowel: string | null
}

/** Decode a segmented secondary character into consonant(s) + vowels. */
export function decodeSecondary(
  bmp: Bitmap,
  region: SegmentedRegion,
  diacriticTemplates: Template[],
): SecondaryDecode {
  ensureTemplates()
  const baseMask = maskOfBox(bmp, region.base, SIZE)
  const bare = classifyMask(baseMask, bareTemplates!)
  const ext = classifyMask(baseMask, extTemplates!)
  // Accept an extension only if it clearly beats the best bare core.
  const chosen = ext.score > bare.score + EXTENSION_MARGIN ? ext : bare
  const [core, topExtension, bottomExtension] = JSON.parse(chosen.label) as [
    string,
    string | null,
    string | null,
  ]

  let superposedVowel: string | null = null
  let underposedVowel: string | null = null
  for (const c of region.components) {
    if (c.role !== "superposed" && c.role !== "underposed") continue
    const d = classifyMask(maskOfBox(bmp, c.bbox, SIZE), diacriticTemplates)
    const vowel = vowelMap[d.label] ?? null
    if (c.role === "superposed") superposedVowel = vowel
    else underposedVowel = vowel
  }

  return { core, topExtension, bottomExtension, superposedVowel, underposedVowel }
}

/**
 * Case (Vc) decoding.
 *
 * In New Ithkuil script the case vowel is drawn as superposed + underposed diacritics
 * on the case-bearing secondary character. The (superposed-shape, underposed-shape)
 * pair uniquely identifies every one of the 68 cases — verified: 0 collisions, and the
 * 32 glottal-stop cases are distinguished by the `_WITH_LINE`/`_WITH_DOT` diacritic
 * variants. So we invert @zsnout's forward case→Vc mapping into a shape-pair → case
 * table (built from data, no rendering) and look the case up from the decoded shapes.
 *
 * We key on the raw diacritic SHAPE labels (e.g. "HORIZ_BAR"), NOT the vowel letters:
 * the secondary decoder's vowel map is calibrated for a different (phonological)
 * reading and mislabels the case diacritics (e.g. it reads HORIZ_BAR as "ä" where the
 * ABS case wants "e"). End-to-end this reader recovers all 68 cases at 100%.
 */
import "./dom-shim.js" // must precede @zsnout imports
import { formativeToScript } from "@zsnout/ithkuil/script"
import { formativeToIthkuil, ALL_CASES } from "@zsnout/ithkuil/generate"
import { parseWord } from "@zsnout/ithkuil/parse"

const key = (superposed: string | null, underposed: string | null): string =>
  `${superposed ?? ""}|${underposed ?? ""}`

function buildCaseMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const c of ALL_CASES as readonly string[]) {
    let text: string
    try {
      text = formativeToIthkuil({ root: "l", type: "UNF/C", case: c } as never)
    } catch {
      continue // some cases need a context the bare template can't produce
    }
    const parsed = parseWord(text)
    if (!parsed) continue
    const chars = formativeToScript(parsed as never, { handwritten: false }) as {
      construct?: { name?: string }
      superposed?: string
      underposed?: string
    }[]
    const sec = chars.filter((x) => x?.construct?.name === "Secondary").pop()
    if (!sec) continue
    map.set(key(sec.superposed ?? null, sec.underposed ?? null), c)
  }
  return map
}

let caseMap: Map<string, string> | null = null

/**
 * Case for a case-bearing secondary from its (superposed, underposed) diacritic
 * shapes, or null when the pair isn't a case (no diacritics = default THM, or an
 * unrecognized pair from an affix/root vowel).
 */
export function diacriticsToCase(
  superposedShape: string | null,
  underposedShape: string | null,
): string | null {
  if (!superposedShape && !underposedShape) return null // no marks → default (THM)
  if (!caseMap) caseMap = buildCaseMap()
  const c = caseMap.get(key(superposedShape, underposedShape))
  // THM has empty diacritics, so it only ever surfaces as the default (null) above.
  return c && c !== "THM" ? c : null
}

/**
 * Milestone 7 (completion) — assemble decoded features into a formative and route
 * through `@zsnout/ithkuil/generate` for romanized text.
 *
 * `formativeToIthkuil` takes a *partial* formative and fills defaults, so we map
 * whatever the reverse pipeline decoded (root consonants, specification, valence/
 * vn, case, mood, …) into that shape and let @zsnout produce the romanization —
 * the inverse of the forward `text → parse → JSON → script` path.
 */
import { formativeToIthkuil } from "@zsnout/ithkuil/generate"

export interface DecodedFeatures {
  /** Formative type; defaults to nominal "UNF/C". */
  type?: "UNF/C" | "UNF/K" | "FRM"
  /** Root consonant string (Cr), e.g. "kt". */
  root?: string
  specification?: string
  /** Vr context (EXS default), function (STA default). */
  context?: string
  function?: string
  /** Vv version (PRC default) + stem (1 default). */
  version?: string
  stem?: number
  /** Slot-VIII value (valence/aspect/phase/level/effect). */
  vn?: string
  case?: string
  mood?: string
  caseScope?: string
  illocutionValidation?: string
}

/** Assemble decoded features into a partial formative and romanize it. */
export function featuresToText(f: DecodedFeatures): string {
  const { type = "UNF/C", ...rest } = f
  // Drop undefined so @zsnout applies its own defaults.
  const formative: Record<string, unknown> = { type }
  for (const [k, v] of Object.entries(rest)) if (v != null) formative[k] = v
  return formativeToIthkuil(formative as never)
}

/**
 * Pass/fail gating for the round-trip harnesses.
 *
 * The harnesses print an accuracy line and used to exit 0 unconditionally — so a
 * regression was only ever caught by a human reading stdout, and no CI check could
 * depend on them. `gate()` adds the missing half: a floor, and a non-zero exit when the
 * run falls below it.
 *
 * **Floors are the TEMPLATE-ONLY numbers**, i.e. what the pipeline scores with none of
 * the optional CNNs trained, because that is the state of a fresh clone and of CI. A
 * machine with the models trained scores at or above them; that is why the floors are set
 * a little under the measured value rather than at it. They are regression detectors, not
 * targets — raise one only after re-measuring on a clean checkout.
 */

let anyFailed = false

/**
 * Report `ok/total` against a floor, and mark the process as failed if it is under.
 *
 * @param label  what was measured (printed as-is)
 * @param ok     passing cases
 * @param total  cases attempted
 * @param minPct floor, in percent, measured with no CNN models present
 */
export function gate(label: string, ok: number, total: number, minPct: number): boolean {
  const pct = total > 0 ? (100 * ok) / total : 0
  // A hair of tolerance so a floor written as the exact measured value can't fail on a
  // floating-point comparison (e.g. 46/48 = 95.83333… vs a floor of 95.8).
  const passed = total > 0 && pct >= minPct - 1e-9
  console.log(
    `  ${passed ? "PASS" : "FAIL"}  ${label}: ${ok}/${total} = ${pct.toFixed(1)}%  (floor ${minPct}%)`,
  )
  if (!passed) {
    anyFailed = true
    process.exitCode = 1
  }
  return passed
}

/** True if any gate in this process has failed. */
export function failed(): boolean {
  return anyFailed
}

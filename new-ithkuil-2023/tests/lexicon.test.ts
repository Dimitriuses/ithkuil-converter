/**
 * Real-lexicon sampling. This module exists because the hand-picked test roots flattered the
 * decoder by ~4× (100% on `word-test` vs 23.5% on real vocabulary), so the sampling has to be
 * deterministic and spread — otherwise the honest benchmark stops being comparable run to run.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { ROOT_FORMS, lengthShare, rootLengths, rootsOfLength, sampleRootsOfLength } from "../src/lexicon.js"

test("the lexicon is the real @zsnout root list", () => {
  assert.ok(ROOT_FORMS.length > 4000, `${ROOT_FORMS.length} roots`)
  assert.ok(
    ROOT_FORMS.every((r) => typeof r === "string" && r.length > 0),
    "every entry is a non-empty Cr form",
  )
})

test("roots are dominated by 3–5 consonant forms, not the easy short ones", () => {
  // The premise of the honest benchmark: 1–2 consonant roots are a small minority.
  const shortShare = lengthShare(1) + lengthShare(2)
  assert.ok(shortShare < 0.25, `1–2 consonant roots are ${(100 * shortShare).toFixed(1)}% of the lexicon`)
  assert.ok(lengthShare(3) > 0.25, "3-consonant roots are the largest class")
})

test("lengthShare sums to 1 across the lengths present", () => {
  const total = rootLengths().reduce((a, n) => a + lengthShare(n), 0)
  assert.ok(Math.abs(total - 1) < 1e-9)
})

test("rootsOfLength returns only roots of that length", () => {
  for (const n of rootLengths()) {
    const roots = rootsOfLength(n)
    assert.ok(roots.length > 0)
    assert.ok(roots.every((r) => r.length === n))
  }
})

test("sampling is deterministic — the same call gives the same roots", () => {
  assert.deepEqual(sampleRootsOfLength(3, 25), sampleRootsOfLength(3, 25))
})

test("sampling spreads across the list instead of taking a prefix", () => {
  const all = rootsOfLength(3)
  const sample = sampleRootsOfLength(3, 20)
  assert.equal(sample.length, 20)
  assert.notDeepEqual(sample, all.slice(0, 20), "not the first 20")
  assert.ok(all.indexOf(sample.at(-1)!) > all.length * 0.9, "the sample reaches the end of the list")
})

test("asking for more roots than exist returns all of them, not padding", () => {
  const all = rootsOfLength(1)
  assert.deepEqual(sampleRootsOfLength(1, all.length + 100), all)
})

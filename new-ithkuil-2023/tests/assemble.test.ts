/**
 * Reassembly of decoded features into romanized text. The important property is not that a
 * good decode romanizes — it is that a BAD one degrades to "" instead of throwing: on a hard
 * image the pipeline can legitimately find no root at all, and `formativeToIthkuil` throws
 * outright in that case. That crashed ~13% of real-lexicon inputs before it was handled.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { featuresToText } from "../src/assemble.js"

test("a root alone romanizes with every other slot defaulted", () => {
  assert.equal(featuresToText({ root: "l" }), "lala")
})

test("non-default slots change the romanization", () => {
  assert.equal(featuresToText({ root: "kt", specification: "CTE", vn: "PRL" }), "aktäläha")
  assert.equal(featuresToText({ root: "sm", specification: "OBJ" }), "smila")
})

test("a decode that found no root yields an empty string, not an exception", () => {
  assert.equal(featuresToText({}), "")
  assert.equal(featuresToText({ specification: "CTE", vn: "PRL", case: "ERG" }), "")
})

test("an impossible feature combination is reported as failure, not propagated", () => {
  assert.doesNotThrow(() => featuresToText({ root: "l", specification: "NOT_A_SPECIFICATION" }))
  assert.equal(featuresToText({ root: "l", specification: "NOT_A_SPECIFICATION" }), "")
})

test("perspective is routed into the Ca complex rather than a top-level slot", () => {
  // Perspective is not a slot of its own — it rides inside Ca. Passing it at the top level
  // is silently ignored by @zsnout, so a regression here looks like "the decoder never
  // reads perspective" rather than an error.
  const monadic = featuresToText({ root: "l" })
  const agglomerative = featuresToText({ root: "l", perspective: "G" })
  assert.notEqual(agglomerative, monadic)
  assert.ok(agglomerative.length > 0)
})

test("undefined slots are dropped so they take @zsnout's defaults", () => {
  const explicit = featuresToText({ root: "l", specification: undefined, vn: undefined })
  assert.equal(explicit, featuresToText({ root: "l" }))
})

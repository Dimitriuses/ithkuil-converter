/**
 * The forward path (text → script SVG) under Node, i.e. the svgdom shim doing the job a
 * browser does natively. Two things here are worth guarding: that a parse failure comes
 * back as a value rather than an exception, and that repeated calls in one process are
 * independent (the layout engine measures glyphs with getBBox, which is stateful).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { encode } from "../src/forward.js"
import { featuresToText } from "../src/assemble.js"

const widthOf = (viewBox: string) => Number(viewBox.split(/\s+/)[2])

test("encode renders a formative to a standalone SVG", () => {
  const r = encode("saläha")
  assert.ok(r.ok, r.ok ? "" : r.reason)
  assert.ok(r.svg.startsWith("<svg"), "standalone element")
  assert.match(r.svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.equal(r.pathCount, 3)
  assert.ok(widthOf(r.viewBox) > 0)
})

test("encode renders a multi-word phrase as one row", () => {
  const one = encode("saläha")
  const two = encode("Wattunkí ruyün")
  assert.ok(one.ok && two.ok)
  assert.ok(two.pathCount > one.pathCount, `${two.pathCount} > ${one.pathCount} paths`)
  assert.ok(widthOf(two.viewBox) > widthOf(one.viewBox), "a longer phrase lays out wider")
})

test("unparseable text returns a reason instead of throwing", () => {
  const r = encode("qqqq")
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.reason.length > 0, "carries a human-readable reason")
})

test("empty input is rejected, not rendered as an empty SVG", () => {
  assert.equal(encode("").ok, false)
})

test("repeated calls are independent — no layout state leaks between renders", () => {
  // The library measures glyphs through a shared document; a leak here would show up as a
  // drifting viewBox for the same input.
  const first = encode("saläha")
  encode("Wattunkí ruyün")
  encode("malëuţřait")
  const again = encode("saläha")
  assert.ok(first.ok && again.ok)
  assert.equal(again.viewBox, first.viewBox)
  assert.equal(again.svg, first.svg)
})

test("margin widens the fitted viewBox by exactly twice the margin", () => {
  const tight = encode("saläha", { margin: 0 })
  const loose = encode("saläha", { margin: 25 })
  assert.ok(tight.ok && loose.ok)
  assert.equal(Math.round(widthOf(loose.viewBox) - widthOf(tight.viewBox)), 50)
})

test("compact layout works under Node via the hit-testing shim", () => {
  // Collision kerning needs SVG isPointInStroke/isPointInFill, which svgdom does not ship —
  // `dom-shim.ts` implements both from the path geometry. Compact must therefore produce a
  // *narrower* row than the bbox-spaced default, and must not fall over.
  const loose = encode("Wattunkí ruyün", { compact: false })
  const compact = encode("Wattunkí ruyün", { compact: true })
  assert.ok(loose.ok && compact.ok, compact.ok ? "" : `compact failed: ${(compact as { reason: string }).reason}`)
  assert.equal(compact.pathCount, loose.pathCount, "same characters, different spacing")
  assert.ok(widthOf(compact.viewBox) < widthOf(loose.viewBox), `${widthOf(loose.viewBox)} → ${widthOf(compact.viewBox)}`)
})

test("fill is applied to the root element so glyph paths inherit it", () => {
  const r = encode("saläha", { fill: "#c92a2a" })
  assert.ok(r.ok)
  assert.match(r.svg, /^<svg[^>]*fill="#c92a2a"/)
})

test("the renderer only emits path commands the geometry shim implements", () => {
  // `path-geometry.ts` implements M/L/H/V/Q/C/Z and skips anything else — an arc would be
  // silently dropped, and compact kerning would be quietly wrong rather than broken. Across
  // a spread of the real lexicon @zsnout emits only M, l, q and z today. If a library
  // update introduces S/T/A, this fails here instead of drifting the layout.
  const implemented = new Set([..."MmLlHhVvQqCcZz"])
  const seen = new Set<string>()
  let rendered = 0
  for (const text of ["saläha", "aktäläha", "malëuţřait", "Wattunkí ruyün", "ušmal", "eţřalá", "smila"]) {
    const r = encode(text)
    assert.ok(r.ok, r.ok ? "" : r.reason)
    rendered++
    for (const [, d] of r.svg.matchAll(/ d="([^"]+)"/g)) {
      for (const c of d.match(/[A-Za-z]/g) ?? []) seen.add(c)
    }
  }
  assert.ok(rendered > 0 && seen.size > 0)
  const unsupported = [...seen].filter((c) => !implemented.has(c))
  assert.deepEqual(unsupported, [], `unhandled path command(s): ${unsupported.join(" ")}`)
})

test("the forward path round-trips text the reverse assembler generates", () => {
  // assemble.ts turns decoded features back into romanized text; whatever it emits must be
  // renderable again, or the two halves of the converter disagree about the language.
  const text = featuresToText({ root: "kt", specification: "CTE", vn: "PRL" })
  assert.ok(text.length > 0)
  const r = encode(text)
  assert.ok(r.ok, r.ok ? "" : `${text} → ${r.reason}`)
  assert.ok(r.pathCount > 0)
})

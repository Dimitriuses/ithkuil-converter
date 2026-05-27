/**
 * Phase 0.2 -- OpenType extractor (TypeScript / opentype.js)
 * ===========================================================
 * Run:  npx tsx extract_font_tables.ts ./ithkuil.ttf ./out/
 *
 * Install deps first:
 *   npm install opentype.js
 *   npm install --save-dev @types/node tsx
 *
 * Keyboard layout files (ithkey, ithkey.keylayout, ithm.klc) are NOT needed.
 * Only ithkuil.ttf is required.
 *
 * Outputs (all in ./out/):
 *   cmap.json               -- codepoint -> glyph name + class
 *   glyphs.json             -- every glyph: SVG path, advance width, bbox
 *   gsub_ligatures.json     -- all ligature sequences (LookupType 4)
 *   gsub_chained.json       -- all chained-context rules (LookupType 6)
 *   gpos_anchors.json       -- mark-to-base and mark-to-mark anchors
 *   diacritic_sequences.json -- base+diacritic combos the font recognises
 *   class_audit.json        -- gap check per ithkey class
 *   summary.txt             -- human-readable overview
 */

import * as fs   from "fs";
import * as path from "path";
// opentype.js ships its own types; cast to `any` where internal tables are needed.
import * as opentype from "opentype.js";

// ---------------------------------------------------------------------------
// ithkey class helpers
// ---------------------------------------------------------------------------

const ITHKEY_BASE = 0xc0000;

type IthkeyClass =
  | "punctuation" | "number"     | "tenthPower"  | "primary"
  | "secondary"   | "tertiary"   | "consonantal" | "placeholder"
  | "diacritic"   | "grid"       | "unassigned"  | "external";

function ithkeyClass(cp: number): IthkeyClass {
  if (cp < ITHKEY_BASE || cp > ITHKEY_BASE + 0x7f) return "external";
  const off = cp - ITHKEY_BASE;
  if (off <= 0x03) return "punctuation";
  if (off <= 0x0d) return "number";
  if (off <= 0x11) return "tenthPower";
  if (off <= 0x29) return "primary";
  if (off <= 0x2f) return "secondary";
  if (off <= 0x36) return "tertiary";
  if (off <= 0x4d) return "consonantal";
  if (off <= 0x4f) return "placeholder";
  if (off <= 0x70) return "diacritic";
  if (off === 0x7f) return "grid";
  return "unassigned";
}

// ---------------------------------------------------------------------------
// Font loading
// ---------------------------------------------------------------------------

function loadFont(fontPath: string): opentype.Font {
  // opentype.loadSync is deprecated. Use opentype.parse() with a raw Buffer.
  const buffer = fs.readFileSync(fontPath);
  // opentype.parse accepts an ArrayBuffer; convert the Node Buffer.
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  return opentype.parse(arrayBuffer);
}

// ---------------------------------------------------------------------------
// cmap
// ---------------------------------------------------------------------------

interface CmapEntry {
  codepoint: string;       // "U+C0012"
  offset:    string;       // "0x12" (relative to ITHKEY_BASE)
  glyphIndex: number;
  glyphName:  string;
  ithkeyClass: IthkeyClass;
}

/**
 * Build the cmap by scanning every codepoint in the known ithkey range
 * (U+C0000–U+C007F) using font.charToGlyphIndex().  This is format-agnostic
 * and works correctly with Format 12 (UCS-4) subtables that cover codepoints
 * outside the BMP, which is exactly what this font uses.
 */
function extractCmap(font: opentype.Font): CmapEntry[] {
  const entries: CmapEntry[] = [];

  for (let offset = 0; offset <= 0x7f; offset++) {
    const cp    = ITHKEY_BASE + offset;
    const char  = String.fromCodePoint(cp);
    const gi    = font.charToGlyphIndex(char);
    if (gi === 0) continue;               // 0 = .notdef = not mapped

    const glyph = font.glyphs.get(gi);
    entries.push({
      codepoint:   `U+${cp.toString(16).toUpperCase().padStart(5, "0")}`,
      offset:      `0x${offset.toString(16).toUpperCase().padStart(2, "0")}`,
      glyphIndex:  gi,
      glyphName:   glyph?.name ?? `glyph${gi}`,
      ithkeyClass: ithkeyClass(cp),
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Glyph outlines
// ---------------------------------------------------------------------------

interface GlyphRecord {
  glyphIndex:   number;
  glyphName:    string;
  codepoints:   string[];
  ithkeyClass:  IthkeyClass;
  advanceWidth: number;
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
  svgPath:      string;
}

function extractGlyphs(font: opentype.Font, cmap: CmapEntry[]): GlyphRecord[] {
  // Build glyph-index -> codepoints reverse map
  const indexToCps = new Map<number, string[]>();
  for (const e of cmap) {
    const list = indexToCps.get(e.glyphIndex) ?? [];
    list.push(e.codepoint);
    indexToCps.set(e.glyphIndex, list);
  }

  const seen    = new Set<number>();
  const records: GlyphRecord[] = [];

  for (const e of cmap) {
    if (seen.has(e.glyphIndex)) continue;
    seen.add(e.glyphIndex);

    const glyph = font.glyphs.get(e.glyphIndex);
    if (!glyph) continue;

    // getPath(x, y, fontSize) -- use fontSize = unitsPerEm to stay in font units
    const p    = glyph.getPath(0, 0, font.unitsPerEm);
    const bbox = glyph.getBoundingBox();

    records.push({
      glyphIndex:   e.glyphIndex,
      glyphName:    glyph.name ?? `glyph${e.glyphIndex}`,
      codepoints:   indexToCps.get(e.glyphIndex) ?? [e.codepoint],
      ithkeyClass:  e.ithkeyClass,
      advanceWidth: glyph.advanceWidth ?? 0,
      bbox: bbox ? { x1: bbox.x1, y1: bbox.y1, x2: bbox.x2, y2: bbox.y2 } : null,
      // toPathData returns just the "d" attribute value, not a full SVG element
      svgPath: (p as any).toPathData(2) ?? "",
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// GSUB helpers
// ---------------------------------------------------------------------------

/** Resolve a glyph index or name to a glyph name string. */
function glyphRef(font: opentype.Font, val: number | string): string {
  if (typeof val === "string") return val;
  return font.glyphs.get(val)?.name ?? `glyph${val}`;
}

// ---------------------------------------------------------------------------
// GSUB -- LookupType 4: Ligature substitution
// ---------------------------------------------------------------------------

interface LigatureRule {
  lookupIndex: number;
  sequence:    string[];     // glyph names
  sequenceCps: string[];     // corresponding codepoints ("?" if unmapped)
  output:      string;       // glyph name
  outputCp:    string;       // codepoint of output ("?" if unmapped)
}

function extractGsubLigatures(
  font:      opentype.Font,
  nameToCp:  Map<string, string>
): LigatureRule[] {
  const rules: LigatureRule[] = [];
  const gsub = (font.tables as any).GSUB ?? (font.tables as any).gsub;
  if (!gsub?.lookups) return rules;

  for (const [li, lookup] of (gsub.lookups as any[]).entries()) {
    if (lookup.lookupType !== 4) continue;

    for (const sub of lookup.subtables as any[]) {
      // sub.ligatures: { [glyphNameOrIndex]: [{ ligGlyph, components }] }
      const ligMap: Record<string, any[]> = sub.ligatures ?? {};

      for (const [first, ligSet] of Object.entries(ligMap)) {
        const firstName = glyphRef(font, first as any);
        for (const lig of ligSet) {
          const components: string[] = (lig.components ?? lig.Component ?? [])
            .map((c: any) => glyphRef(font, c));
          const sequence = [firstName, ...components];
          const output   = glyphRef(font, lig.ligGlyph ?? lig.LigGlyph);

          rules.push({
            lookupIndex: li,
            sequence,
            sequenceCps: sequence.map((g) => nameToCp.get(g) ?? "?"),
            output,
            outputCp:    nameToCp.get(output) ?? "?",
          });
        }
      }
    }
  }

  return rules;
}

// ---------------------------------------------------------------------------
// GSUB -- LookupType 6: Chained context substitution (all 3 formats)
// ---------------------------------------------------------------------------

interface ChainedRule {
  lookupIndex:       number;
  format:            number;
  backtrackGlyphs:   string[][];   // one array per backtrack coverage
  inputGlyphs:       string[][];   // one array per input coverage
  lookAheadGlyphs:   string[][];   // one array per lookahead coverage
  substLookups:      Array<{ sequenceIndex: number; lookupIndex: number }>;
}

function coverageGlyphs(cov: any): string[] {
  if (!cov) return [];
  if (Array.isArray(cov.glyphs)) return cov.glyphs;
  if (Array.isArray(cov.ranges)) {
    // coverage stored as ranges -- expand to glyph list not practical here;
    // return a descriptive note instead
    return cov.ranges.map((r: any) => `range[${r.start}..${r.end}]`);
  }
  return [];
}

function substLookupRecords(records: any[]): Array<{ sequenceIndex: number; lookupIndex: number }> {
  return (records ?? []).map((r: any) => ({
    sequenceIndex: r.sequenceIndex ?? r.SequenceIndex ?? 0,
    lookupIndex:   r.lookupListIndex ?? r.LookupListIndex ?? 0,
  }));
}

function extractGsubChained(font: opentype.Font): ChainedRule[] {
  const rules: ChainedRule[] = [];
  const gsub = (font.tables as any).GSUB ?? (font.tables as any).gsub;
  if (!gsub?.lookups) return rules;

  for (const [li, lookup] of (gsub.lookups as any[]).entries()) {
    if (lookup.lookupType !== 6) continue;

    for (const sub of lookup.subtables as any[]) {
      const fmt: number = sub.format ?? sub.Format ?? 0;

      try {
        if (fmt === 1) {
          // Format 1: per-glyph rule sets
          const coverage: string[] = coverageGlyphs(sub.coverage ?? sub.Coverage);
          const ruleSets: any[]    = sub.chainSubRuleSet ?? sub.ChainSubRuleSet ?? [];
          for (const [i, ruleSet] of ruleSets.entries()) {
            if (!ruleSet) continue;
            for (const rule of ruleSet.chainSubRule ?? ruleSet.ChainSubRule ?? []) {
              rules.push({
                lookupIndex:     li,
                format:          1,
                backtrackGlyphs: (rule.backtrack ?? rule.Backtrack ?? []).map((g: string) => [g]),
                inputGlyphs:     [[coverage[i] ?? "?"], ...(rule.input ?? rule.Input ?? []).map((g: string) => [g])],
                lookAheadGlyphs: (rule.lookAhead ?? rule.LookAhead ?? []).map((g: string) => [g]),
                substLookups:    substLookupRecords(rule.substLookupRecords ?? rule.SubstLookupRecord ?? []),
              });
            }
          }

        } else if (fmt === 2) {
          // Format 2: class-based rule sets
          const ruleSets: any[] = sub.chainSubClassSet ?? sub.ChainSubClassSet ?? [];
          for (const [i, ruleSet] of ruleSets.entries()) {
            if (!ruleSet) continue;
            for (const rule of ruleSet.chainSubClassRule ?? ruleSet.ChainSubClassRule ?? []) {
              rules.push({
                lookupIndex:     li,
                format:          2,
                backtrackGlyphs: (rule.backtrack ?? rule.Backtrack ?? []).map((c: number) => [`class${c}`]),
                inputGlyphs:     [[`class${i}`], ...(rule.input ?? rule.Input ?? []).map((c: number) => [`class${c}`])],
                lookAheadGlyphs: (rule.lookAhead ?? rule.LookAhead ?? []).map((c: number) => [`class${c}`]),
                substLookups:    substLookupRecords(rule.substLookupRecords ?? rule.SubstLookupRecord ?? []),
              });
            }
          }

        } else if (fmt === 3) {
          // Format 3: coverage-based (most common in practice)
          const backtrack  = (sub.backtrackCoverage  ?? sub.BacktrackCoverage  ?? []).map(coverageGlyphs);
          const input      = (sub.inputCoverage       ?? sub.InputCoverage      ?? []).map(coverageGlyphs);
          const lookAhead  = (sub.lookAheadCoverage   ?? sub.LookAheadCoverage  ?? []).map(coverageGlyphs);
          const subst      = substLookupRecords(sub.substLookupRecords ?? sub.SubstLookupRecord ?? []);
          rules.push({
            lookupIndex:     li,
            format:          3,
            backtrackGlyphs: backtrack,
            inputGlyphs:     input,
            lookAheadGlyphs: lookAhead,
            substLookups:    subst,
          });

        } else {
          rules.push({
            lookupIndex:     li,
            format:          fmt,
            backtrackGlyphs: [],
            inputGlyphs:     [["unknown_format"]],
            lookAheadGlyphs: [],
            substLookups:    [],
          });
        }
      } catch (err: any) {
        rules.push({
          lookupIndex:     li,
          format:          fmt,
          backtrackGlyphs: [],
          inputGlyphs:     [[`error: ${err?.message}`]],
          lookAheadGlyphs: [],
          substLookups:    [],
        });
      }
    }
  }

  return rules;
}

// ---------------------------------------------------------------------------
// GPOS -- mark-to-base (Type 4) and mark-to-mark (Type 6)
// ---------------------------------------------------------------------------

interface AnchorEntry {
  lookupIndex: number;
  lookupType:  number;
  role:        "mark" | "base" | "mark2" | "mark2base";
  glyph:       string;
  codepoint:   string;
  classIndex:  number;
  x: number;
  y: number;
}

function anchorXY(a: any): { x: number; y: number } | null {
  if (!a) return null;
  const x = a.x ?? a.XCoordinate ?? 0;
  const y = a.y ?? a.YCoordinate ?? 0;
  return { x, y };
}

function extractGposAnchors(
  font:     opentype.Font,
  nameToCp: Map<string, string>
): AnchorEntry[] {
  const entries: AnchorEntry[] = [];
  const gpos = (font.tables as any).GPOS ?? (font.tables as any).gpos;
  if (!gpos?.lookups) return entries;

  for (const [li, lookup] of (gpos.lookups as any[]).entries()) {
    const ltype: number = lookup.lookupType;
    if (ltype !== 4 && ltype !== 6) continue;

    for (const sub of lookup.subtables as any[]) {
      try {
        // Mark coverage + records (same structure for Type 4 and 6)
        const markGlyphs:   string[] = coverageGlyphs(sub.markCoverage   ?? sub.MarkCoverage);
        const markRecords:  any[]    = (sub.markArray ?? sub.MarkArray)?.markRecords
                                     ?? (sub.markArray ?? sub.MarkArray)?.MarkRecord ?? [];

        for (const [i, glyph] of markGlyphs.entries()) {
          const rec    = markRecords[i];
          const anchor = anchorXY(rec?.markAnchor ?? rec?.MarkAnchor);
          if (!anchor) continue;
          entries.push({
            lookupIndex: li,
            lookupType:  ltype,
            role:        ltype === 6 ? "mark2" : "mark",
            glyph,
            codepoint:   nameToCp.get(glyph) ?? "?",
            classIndex:  rec?.markClass ?? rec?.Class ?? 0,
            ...anchor,
          });
        }

        // Base coverage + records (Type 4) or Mark2 coverage (Type 6)
        const baseCovKey  = ltype === 4 ? ["baseCoverage",  "BaseCoverage"]
                                        : ["mark2Coverage", "Mark2Coverage"];
        const baseArrKey  = ltype === 4 ? ["baseArray",     "BaseArray"]
                                        : ["mark2Array",    "Mark2Array"];
        const baseRecKey  = ltype === 4 ? ["baseRecords",   "BaseRecord"]
                                        : ["mark2Records",  "Mark2Record"];
        const baseAncKey  = ltype === 4 ? ["baseAnchors",   "BaseAnchor"]
                                        : ["mark2Anchors",  "Mark2Anchor"];

        const baseCov    = sub[baseCovKey[0]]   ?? sub[baseCovKey[1]];
        const baseArr    = sub[baseArrKey[0]]   ?? sub[baseArrKey[1]];
        const baseRecs: any[] = baseArr?.[baseRecKey[0]] ?? baseArr?.[baseRecKey[1]] ?? [];
        const baseGlyphs: string[] = coverageGlyphs(baseCov);

        for (const [i, glyph] of baseGlyphs.entries()) {
          const rec     = baseRecs[i];
          const anchors: any[] = rec?.[baseAncKey[0]] ?? rec?.[baseAncKey[1]] ?? [];
          for (const [ci, a] of anchors.entries()) {
            const anchor = anchorXY(a);
            if (!anchor) continue;
            entries.push({
              lookupIndex: li,
              lookupType:  ltype,
              role:        ltype === 6 ? "mark2base" : "base",
              glyph,
              codepoint:   nameToCp.get(glyph) ?? "?",
              classIndex:  ci,
              ...anchor,
            });
          }
        }
      } catch (err: any) {
        entries.push({
          lookupIndex: li,
          lookupType:  ltype,
          role:        "mark",
          glyph:       `error: ${err?.message}`,
          codepoint:   "?",
          classIndex:  -1,
          x: 0, y: 0,
        });
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Diacritic sequence enumeration
// ---------------------------------------------------------------------------

interface DiacriticSequence {
  baseGlyph:     string;
  baseCp:        string;
  baseClass:     IthkeyClass;
  diacritics:    string[];
  diacriticCps:  string[];
  resolvedGlyph: string;
  resolvedCp:    string;
}

function enumerateDiacriticSequences(
  ligatures: LigatureRule[],
  cmap:      CmapEntry[]
): DiacriticSequence[] {
  const diacriticCps = new Set(
    cmap.filter((e) => e.ithkeyClass === "diacritic").map((e) => e.codepoint)
  );

  return ligatures
    .filter((r) => r.sequence.length >= 2 && r.sequenceCps.slice(1).some((c) => diacriticCps.has(c)))
    .map((r) => ({
      baseGlyph:     r.sequence[0],
      baseCp:        r.sequenceCps[0],
      baseClass:     ithkeyClass(parseInt(r.sequenceCps[0].replace("U+", ""), 16)),
      diacritics:    r.sequence.slice(1),
      diacriticCps:  r.sequenceCps.slice(1),
      resolvedGlyph: r.output,
      resolvedCp:    r.outputCp,
    }));
}

// ---------------------------------------------------------------------------
// Class audit
// ---------------------------------------------------------------------------

interface AuditRow {
  class:             IthkeyClass;
  expectedRange:     string;
  expectedCount:     number;
  actualCount:       number;
  missingCodepoints: string[];
  status:            "OK" | "GAP" | "EXCESS";
}

const EXPECTED: Array<[IthkeyClass, number, number, number]> = [
  ["punctuation",  0x00, 0x03,  4],
  ["number",       0x04, 0x0d, 10],
  ["tenthPower",   0x0e, 0x11,  4],
  ["primary",      0x12, 0x29, 24],
  ["secondary",    0x2a, 0x2f,  6],
  ["tertiary",     0x30, 0x36,  7],
  ["consonantal",  0x37, 0x4d, 23],
  ["placeholder",  0x4e, 0x4f,  2],
  ["diacritic",    0x50, 0x70, 33],
  ["grid",         0x7f, 0x7f,  1],
];

function classAudit(cmap: CmapEntry[]): AuditRow[] {
  const presentCps = new Set(cmap.map((e) => e.codepoint));

  return EXPECTED.map(([cls, lo, hi, expected]) => {
    const range  = `U+${(ITHKEY_BASE + lo).toString(16).toUpperCase()}–U+${(ITHKEY_BASE + hi).toString(16).toUpperCase()}`;
    const actual = cmap.filter((e) => e.ithkeyClass === cls).length;
    const missing: string[] = [];
    for (let off = lo; off <= hi; off++) {
      const cp = `U+${(ITHKEY_BASE + off).toString(16).toUpperCase().padStart(5, "0")}`;
      if (!presentCps.has(cp)) missing.push(cp);
    }
    const status = actual === expected && !missing.length ? "OK"
                 : actual > expected                      ? "EXCESS"
                 :                                          "GAP";
    return { class: cls, expectedRange: range, expectedCount: expected, actualCount: actual, missingCodepoints: missing, status };
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function writeSummary(
  font:      opentype.Font,
  glyphs:    GlyphRecord[],
  ligs:      LigatureRule[],
  chained:   ChainedRule[],
  anchors:   AnchorEntry[],
  audit:     AuditRow[],
  outPath:   string,
): void {
  const upm   = font.unitsPerEm;
  const fname = (font as any).names?.fullName?.en ?? (font.names as any)?.fullName ?? "unknown";

  const lines = [
    "=".repeat(60),
    `Font          : ${fname}`,
    `Units per em  : ${upm}`,
    "=".repeat(60),
    "",
    `Glyphs mapped    : ${glyphs.length}`,
    `GSUB ligatures   : ${ligs.length} rules`,
    `GSUB chained ctx : ${chained.length} rules`,
    `GPOS anchors     : ${anchors.length} entries`,
    "",
    "Class audit:",
    ...audit.map((r) =>
      `  [${r.status === "OK" ? "OK" : "!!"}] ${r.class.padEnd(16)}`
      + `  expected=${String(r.expectedCount).padStart(3)}`
      + `  actual=${String(r.actualCount).padStart(3)}`
      + (r.missingCodepoints.length ? `  MISSING: ${r.missingCodepoints.join(", ")}` : "")
    ),
  ];

  const text = lines.join("\n");
  fs.writeFileSync(outPath, text, "utf-8");
  console.log("\n" + text);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function write(dir: string, filename: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [,, fontArg, outArg] = process.argv;
  if (!fontArg) {
    console.log("Usage: npx tsx extract_font_tables.ts <font.ttf> [out_dir]");
    process.exit(1);
  }

  const fontPath = path.resolve(fontArg);
  const outDir   = path.resolve(outArg ?? "./out");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Loading ${fontPath} ...`);
  const font = loadFont(fontPath);
  console.log(`  -> loaded OK  (${font.glyphs.length} total glyphs, UPM=${font.unitsPerEm})`);

  console.log("Extracting cmap ...");
  const cmap = extractCmap(font);
  write(outDir, "cmap.json", cmap);
  console.log(`  -> ${cmap.length} ithkey codepoints mapped`);

  // Build name->codepoint lookup for use in GSUB/GPOS parsers
  const nameToCp = new Map<string, string>(cmap.map((e) => [e.glyphName, e.codepoint]));

  console.log("Extracting glyph outlines ...");
  const glyphs = extractGlyphs(font, cmap);
  write(outDir, "glyphs.json", glyphs);
  console.log(`  -> ${glyphs.length} unique glyphs`);

  console.log("Extracting GSUB ligatures ...");
  const ligs = extractGsubLigatures(font, nameToCp);
  write(outDir, "gsub_ligatures.json", ligs);
  console.log(`  -> ${ligs.length} ligature rules`);

  console.log("Extracting GSUB chained-context rules ...");
  const chained = extractGsubChained(font);
  write(outDir, "gsub_chained.json", chained);
  console.log(`  -> ${chained.length} chained-context rules`);

  console.log("Extracting GPOS anchors ...");
  const anchors = extractGposAnchors(font, nameToCp);
  write(outDir, "gpos_anchors.json", anchors);
  console.log(`  -> ${anchors.length} anchor entries`);

  console.log("Enumerating diacritic sequences ...");
  const diaSeqs = enumerateDiacriticSequences(ligs, cmap);
  write(outDir, "diacritic_sequences.json", diaSeqs);
  console.log(`  -> ${diaSeqs.length} base+diacritic combos`);

  console.log("Running class audit ...");
  const audit = classAudit(cmap);
  write(outDir, "class_audit.json", audit);

  writeSummary(font, glyphs, ligs, chained, anchors, audit, path.join(outDir, "summary.txt"));
  console.log(`\nAll files written to ${outDir}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });

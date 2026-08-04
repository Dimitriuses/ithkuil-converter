"""
Phase 0.2 -- OpenType table extractor for ithkuil.ttf
======================================================
Run:  python extract_font_tables.py ./ithkuil.ttf ./out/

Outputs (all in ./out/):
  glyphs.json          -- every glyph: name, codepoint(s), SVG path, bbox
  gsub_rules.json      -- all GSUB lookups, typed and flattened
  gpos_rules.json      -- all GPOS lookups (mark anchors, kerning)
  cmap.json            -- Unicode codepoint -> glyph-name mapping
  class_audit.json     -- each codepoint classified by ithkey class
  summary.txt          -- human-readable overview

Note: keyboard layout files (ithkey, ithkey.keylayout, ithm.klc) are NOT
needed here -- only ithkuil.ttf is required.
"""

import json
import sys
from pathlib import Path

try:
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit("fonttools not found. Run: pip install fonttools")


# ---------------------------------------------------------------------------
# ithkey codepoint helpers
# ---------------------------------------------------------------------------

ITHKEY_BASE = 0xC0000


def ithkey_class(codepoint):
    if codepoint < ITHKEY_BASE or codepoint > ITHKEY_BASE + 0x7F:
        return "external"
    off = codepoint - ITHKEY_BASE
    if off <= 0x03: return "punctuation"
    if off <= 0x0D: return "number"
    if off <= 0x11: return "tenthPower"
    if off <= 0x29: return "primary"
    if off <= 0x2F: return "secondary"
    if off <= 0x36: return "tertiary"
    if off <= 0x4D: return "consonantal"
    if off <= 0x4F: return "placeholder"
    if off <= 0x70: return "diacritic"
    if off == 0x7F: return "grid"
    return "unassigned"


# ---------------------------------------------------------------------------
# Glyph outline extraction
# ---------------------------------------------------------------------------

def glyph_to_svg_path(font, glyph_name):
    pen = SVGPathPen(font.getGlyphSet())
    try:
        font.getGlyphSet()[glyph_name].draw(pen)
    except Exception:
        return ""
    return pen.getCommands()


def glyph_bbox(font, glyph_name):
    try:
        return font.getGlyphSet()[glyph_name].boundingBox()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# cmap
# ---------------------------------------------------------------------------

def extract_cmap(font):
    best = font.getBestCmap()
    if not best:
        return {}
    return {hex(cp): name for cp, name in sorted(best.items())}


# ---------------------------------------------------------------------------
# GSUB
# ---------------------------------------------------------------------------

GSUB_TYPE_NAMES = {
    1: "SingleSubstitution",
    2: "MultipleSubstitution",
    3: "AlternateSubstitution",
    4: "LigatureSubstitution",
    5: "ContextSubstitution",
    6: "ChainedContextSubstitution",
    7: "ExtensionSubstitution",
    8: "ReverseChainedContextSubstitution",
}


def _parse_gsub_subtable(rules, ltype, type_name, sub_idx, subtable):
    """Dispatch to the right parser for each GSUB lookup type and format."""

    # --- Type 1: Single substitution ---
    if ltype == 1:
        for inp, out in subtable.mapping.items():
            rules.append({"type": "single", "input": inp, "output": out})

    # --- Type 2: Multiple substitution ---
    elif ltype == 2:
        for inp, seq in subtable.mapping.items():
            rules.append({"type": "multiple", "input": inp, "output": list(seq)})

    # --- Type 3: Alternate substitution ---
    elif ltype == 3:
        for inp, alts in subtable.alternates.items():
            rules.append({"type": "alternate", "input": inp, "alternates": list(alts)})

    # --- Type 4: Ligature substitution ---
    elif ltype == 4:
        for first_glyph, lig_set in subtable.ligatures.items():
            for lig in lig_set:
                sequence = [first_glyph] + list(lig.Component)
                rules.append({
                    "type": "ligature",
                    "sequence": sequence,
                    "output": lig.LigGlyph,
                })

    # --- Type 6: Chained context substitution (3 format variants) ---
    elif ltype == 6:
        fmt = getattr(subtable, "Format", None)

        # Format 1 -- rule sets indexed by glyph class
        if fmt == 1:
            rule_sets = getattr(subtable, "ChainSubRuleSet", None) or []
            coverage_glyphs = getattr(subtable.Coverage, "glyphs", [])
            for rule_idx, rule_set in enumerate(rule_sets):
                if rule_set is None:
                    continue
                first_glyph = coverage_glyphs[rule_idx] if rule_idx < len(coverage_glyphs) else "?"
                for rule in getattr(rule_set, "ChainSubRule", []):
                    rules.append({
                        "type": "chainedContext_fmt1",
                        "subtable": sub_idx,
                        "firstGlyph": first_glyph,
                        "backtrackCount": getattr(rule, "BacktrackGlyphCount", 0),
                        "inputCount": getattr(rule, "InputGlyphCount", 1),
                        "lookAheadCount": getattr(rule, "LookAheadGlyphCount", 0),
                        "substLookups": [
                            {"sequenceIndex": sl.SequenceIndex, "lookupIndex": sl.LookupListIndex}
                            for sl in getattr(rule, "SubstLookupRecord", [])
                        ],
                    })

        # Format 2 -- rule sets indexed by class
        elif fmt == 2:
            rule_sets = getattr(subtable, "ChainSubClassSet", None) or []
            for rule_idx, rule_set in enumerate(rule_sets):
                if rule_set is None:
                    continue
                for rule in getattr(rule_set, "ChainSubClassRule", []):
                    rules.append({
                        "type": "chainedContext_fmt2",
                        "subtable": sub_idx,
                        "classIndex": rule_idx,
                        "backtrackClasses": list(getattr(rule, "Backtrack", [])),
                        "inputClasses": list(getattr(rule, "Input", [])),
                        "lookAheadClasses": list(getattr(rule, "LookAhead", [])),
                        "substLookups": [
                            {"sequenceIndex": sl.SequenceIndex, "lookupIndex": sl.LookupListIndex}
                            for sl in getattr(rule, "SubstLookupRecord", [])
                        ],
                    })

        # Format 3 -- coverage-based (most common in practice)
        elif fmt == 3:
            backtrack_coverages = [
                list(getattr(c, "glyphs", []))
                for c in getattr(subtable, "BacktrackCoverage", [])
            ]
            input_coverages = [
                list(getattr(c, "glyphs", []))
                for c in getattr(subtable, "InputCoverage", [])
            ]
            lookahead_coverages = [
                list(getattr(c, "glyphs", []))
                for c in getattr(subtable, "LookAheadCoverage", [])
            ]
            subst_lookups = [
                {"sequenceIndex": sl.SequenceIndex, "lookupIndex": sl.LookupListIndex}
                for sl in getattr(subtable, "SubstLookupRecord", [])
            ]
            rules.append({
                "type": "chainedContext_fmt3",
                "subtable": sub_idx,
                "backtrackCoverages": backtrack_coverages,
                "inputCoverages": input_coverages,
                "lookAheadCoverages": lookahead_coverages,
                "substLookups": subst_lookups,
            })

        else:
            rules.append({
                "type": "chainedContext_unknownFormat",
                "subtable": sub_idx,
                "format": fmt,
                "note": "Run `fonttools ttx -t GSUB` for raw dump",
            })

    # --- Everything else: note and skip ---
    else:
        rules.append({
            "type": "unparsed",
            "lookupType": ltype,
            "lookupTypeName": type_name,
            "subtable": sub_idx,
            "note": f"LookupType {ltype} not fully parsed -- run `fonttools ttx -t GSUB`",
        })


def extract_gsub(font):
    if "GSUB" not in font:
        print("  [!] No GSUB table found in font.")
        return []

    results = []
    for lookup_idx, lookup in enumerate(font["GSUB"].table.LookupList.Lookup):
        ltype = lookup.LookupType
        type_name = GSUB_TYPE_NAMES.get(ltype, f"Type{ltype}")
        entry = {
            "lookupIndex": lookup_idx,
            "lookupType": ltype,
            "lookupTypeName": type_name,
            "rules": [],
        }
        for sub_idx, subtable in enumerate(lookup.SubTable):
            try:
                _parse_gsub_subtable(entry["rules"], ltype, type_name, sub_idx, subtable)
            except Exception as exc:
                entry["rules"].append({
                    "type": "error",
                    "subtable": sub_idx,
                    "note": str(exc),
                    "hint": "Run `fonttools ttx -t GSUB` for the raw dump.",
                })
        results.append(entry)
    return results


# ---------------------------------------------------------------------------
# GPOS
# ---------------------------------------------------------------------------

GPOS_TYPE_NAMES = {
    1: "SingleAdjustment",
    2: "PairAdjustment",
    3: "CursiveAttachment",
    4: "MarkToBaseAttachment",
    5: "MarkToLigatureAttachment",
    6: "MarkToMarkAttachment",
    7: "ContextPositioning",
    8: "ChainedContextPositioning",
    9: "ExtensionPositioning",
}


def _anchor_dict(anchor):
    if anchor is None:
        return None
    return {"x": anchor.XCoordinate, "y": anchor.YCoordinate}


def extract_gpos(font):
    if "GPOS" not in font:
        print("  [!] No GPOS table found in font.")
        return []

    results = []
    for lookup_idx, lookup in enumerate(font["GPOS"].table.LookupList.Lookup):
        ltype = lookup.LookupType
        type_name = GPOS_TYPE_NAMES.get(ltype, f"Type{ltype}")
        entry = {
            "lookupIndex": lookup_idx,
            "lookupType": ltype,
            "lookupTypeName": type_name,
            "anchors": [],
        }

        for subtable in lookup.SubTable:
            try:
                # Type 4 -- Mark-to-Base
                if ltype == 4:
                    mark_glyphs = subtable.MarkCoverage.glyphs
                    mark_records = subtable.MarkArray.MarkRecord
                    for glyph, rec in zip(mark_glyphs, mark_records, strict=True):
                        entry["anchors"].append({
                            "role": "mark",
                            "glyph": glyph,
                            "classIndex": rec.Class,
                            "anchor": _anchor_dict(rec.MarkAnchor),
                        })

                    base_glyphs = subtable.BaseCoverage.glyphs
                    base_records = subtable.BaseArray.BaseRecord
                    for glyph, rec in zip(base_glyphs, base_records, strict=True):
                        for cls_idx, anchor in enumerate(rec.BaseAnchor):
                            if anchor is not None:
                                entry["anchors"].append({
                                    "role": "base",
                                    "glyph": glyph,
                                    "classIndex": cls_idx,
                                    "anchor": _anchor_dict(anchor),
                                })

                # Type 6 -- Mark-to-Mark (same structure as Type 4)
                elif ltype == 6:
                    mark_glyphs = subtable.MarkCoverage.glyphs
                    mark_records = subtable.MarkArray.MarkRecord
                    for glyph, rec in zip(mark_glyphs, mark_records, strict=True):
                        entry["anchors"].append({
                            "role": "mark2",
                            "glyph": glyph,
                            "classIndex": rec.Class,
                            "anchor": _anchor_dict(rec.MarkAnchor),
                        })

                    mark2_glyphs = subtable.Mark2Coverage.glyphs
                    mark2_records = subtable.Mark2Array.Mark2Record
                    for glyph, rec in zip(mark2_glyphs, mark2_records, strict=True):
                        for cls_idx, anchor in enumerate(rec.Mark2Anchor):
                            if anchor is not None:
                                entry["anchors"].append({
                                    "role": "mark2base",
                                    "glyph": glyph,
                                    "classIndex": cls_idx,
                                    "anchor": _anchor_dict(anchor),
                                })

                else:
                    entry["anchors"].append({
                        "role": "unparsed",
                        "lookupType": ltype,
                        "note": "Run `fonttools ttx -t GPOS` for full detail",
                    })

            except Exception as exc:
                entry["anchors"].append({
                    "role": "error",
                    "note": str(exc),
                    "hint": "Run `fonttools ttx -t GPOS` for the raw dump.",
                })

        results.append(entry)
    return results


# ---------------------------------------------------------------------------
# Glyph records
# ---------------------------------------------------------------------------

def extract_glyphs(font, cmap):
    glyph_set = font.getGlyphSet()
    upm = font["head"].unitsPerEm

    # glyph-name -> list of codepoints
    name_to_cps = {}
    for cp_hex, name in cmap.items():
        name_to_cps.setdefault(name, []).append(cp_hex)

    seen = set()
    records = []
    for cp_hex, name in cmap.items():
        if name in seen:
            continue
        seen.add(name)

        cp = int(cp_hex, 16)
        bbox = glyph_bbox(font, name)
        advance = 0
        try:
            advance = glyph_set[name].width
        except Exception:
            pass

        records.append({
            "glyphName": name,
            "codepoints": name_to_cps.get(name, [cp_hex]),
            "ithkeyClass": ithkey_class(cp),
            "advanceWidth": advance,
            "unitsPerEm": upm,
            "bbox": {
                "xMin": bbox.xMin, "yMin": bbox.yMin,
                "xMax": bbox.xMax, "yMax": bbox.yMax,
            } if bbox else None,
            "svgPath": glyph_to_svg_path(font, name),
        })
    return records


# ---------------------------------------------------------------------------
# Class audit
# ---------------------------------------------------------------------------

EXPECTED_RANGES = [
    ("punctuation",  0x00, 0x03,  4),
    ("number",       0x04, 0x0D, 10),
    ("tenthPower",   0x0E, 0x11,  4),
    ("primary",      0x12, 0x29, 24),
    ("secondary",    0x2A, 0x2F,  6),
    ("tertiary",     0x30, 0x36,  7),
    ("consonantal",  0x37, 0x4D, 23),
    ("placeholder",  0x4E, 0x4F,  2),
    ("diacritic",    0x50, 0x70, 33),
    ("grid",         0x7F, 0x7F,  1),
]


def class_audit(cmap):
    present = set(cmap.keys())
    rows = []
    for cls, lo, hi, expected in EXPECTED_RANGES:
        missing = [
            hex(ITHKEY_BASE + off)
            for off in range(lo, hi + 1)
            if hex(ITHKEY_BASE + off) not in present
        ]
        actual = sum(
            1 for cp_hex in cmap
            if ithkey_class(int(cp_hex, 16)) == cls
        )
        rows.append({
            "class": cls,
            "expectedCount": expected,
            "actualCount": actual,
            "missingCodepoints": missing,
            "status": "OK" if not missing and actual == expected else "GAP",
        })
    return rows


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def write_summary(font, glyphs, gsub, gpos, audit, out_path):
    upm = font["head"].unitsPerEm
    fname = font["name"].getDebugName(4) or "unknown"
    fver  = font["name"].getDebugName(5) or "unknown"

    lines = [
        "=" * 60,
        f"Font:    {fname}",
        f"Version: {fver}",
        f"UPM:     {upm}",
        "=" * 60,
        "",
        f"Glyphs in cmap : {len(glyphs)}",
        f"GSUB lookups   : {len(gsub)}",
        f"GPOS lookups   : {len(gpos)}",
        "",
        "Class audit:",
    ]
    for row in audit:
        ok = "OK" if row["status"] == "OK" else "!!"
        lines.append(
            f"  [{ok}] {row['class']:<16}"
            f"  expected={row['expectedCount']:>3}  actual={row['actualCount']:>3}"
            + (f"  MISSING: {row['missingCodepoints']}" if row["missingCodepoints"] else "")
        )

    lines += ["", "GSUB lookup breakdown:"]
    for lk in gsub:
        rule_count = len(lk["rules"])
        lines.append(f"  [{lk['lookupIndex']:>2}] {lk['lookupTypeName']:<38} {rule_count} rules")

    lines += ["", "GPOS lookup breakdown:"]
    for lk in gpos:
        anchor_count = len(lk["anchors"])
        lines.append(f"  [{lk['lookupIndex']:>2}] {lk['lookupTypeName']:<38} {anchor_count} anchors")

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    font_path = Path(sys.argv[1])
    out_dir   = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("./out")
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading {font_path} ...")
    font = TTFont(str(font_path))

    print("Extracting cmap ...")
    cmap = extract_cmap(font)
    (out_dir / "cmap.json").write_text(json.dumps(cmap, indent=2), encoding="utf-8")
    print(f"  -> {len(cmap)} codepoints mapped")

    print("Extracting glyphs ...")
    glyphs = extract_glyphs(font, cmap)
    (out_dir / "glyphs.json").write_text(json.dumps(glyphs, indent=2), encoding="utf-8")
    print(f"  -> {len(glyphs)} unique glyphs")

    print("Extracting GSUB ...")
    gsub = extract_gsub(font)
    (out_dir / "gsub_rules.json").write_text(json.dumps(gsub, indent=2), encoding="utf-8")
    total_rules = sum(len(lk["rules"]) for lk in gsub)
    print(f"  -> {len(gsub)} lookups, {total_rules} rules")

    print("Extracting GPOS ...")
    gpos = extract_gpos(font)
    (out_dir / "gpos_rules.json").write_text(json.dumps(gpos, indent=2), encoding="utf-8")
    total_anchors = sum(len(lk["anchors"]) for lk in gpos)
    print(f"  -> {len(gpos)} lookups, {total_anchors} anchors")

    print("Running class audit ...")
    audit = class_audit(cmap)
    (out_dir / "class_audit.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")

    print("Writing summary ...")
    write_summary(font, glyphs, gsub, gpos, audit, out_dir / "summary.txt")

    print(f"\nAll files written to {out_dir}/")


if __name__ == "__main__":
    main()

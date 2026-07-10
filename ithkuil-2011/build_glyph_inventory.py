"""
Phase 0.3 -- Glyph inventory builder
=====================================
Reads the output of Phase 0.2 and produces:

  glyph_inventory.json   -- stable GlyphID -> full metadata
  glyph_inventory.md     -- human-readable catalog for the Phase 0.5 audit
  svg/                   -- one .svg file per glyph, named by GlyphID

Run:
  python build_glyph_inventory.py <analysis_dir> <output_dir>

Where <analysis_dir> is the output of EITHER extract_font_tables.py (Python)
or extract_font_tables.ts (TypeScript). The script auto-detects both formats.

Recommended split:
  - Use Python analysis for cmap.json + glyphs.json  (fonttools paths are more reliable)
  - Use TypeScript analysis for diacritic_sequences.json  (Python script doesn't produce it)
  Both can be passed as the same dir if you copy/merge the files there.
"""

import json
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# GlyphID assignment tables
# ---------------------------------------------------------------------------

PUNCTUATION_IDS = ["PUNCT_01", "PUNCT_02", "PUNCT_03", "PUNCT_04"]

DIGIT_IDS = [
    "DIGIT_1", "DIGIT_2", "DIGIT_3", "DIGIT_4", "DIGIT_5",
    "DIGIT_6", "DIGIT_7", "DIGIT_8", "DIGIT_9", "DIGIT_0",
]

TENTHPOWER_IDS = [
    "TENTHPOWER_10", "TENTHPOWER_100", "TENTHPOWER_E4", "TENTHPOWER_E8",
]

PRIMARY_KEYS = [
    "Q","W","E","R","T","Y","U","I","O",   # top row
    "A","S","D","F","G","H","J","K","L",   # home row
    "X","C","V","B","N","M",               # bottom row
]
PRIMARY_IDS = [f"PRIMARY_{k}" for k in PRIMARY_KEYS]

SECONDARY_IDS = [f"SECONDARY_{i+1:02d}" for i in range(6)]
TERTIARY_IDS  = [f"TERTIARY_{i+1:02d}"  for i in range(7)]

# Consonant romanisations from ithm.klc + readme consonant map.
# Marked unchecked -- Phase 0.5 confirms or corrects these.
CONSONANT_MAP = {
    0xC0037: ("t_ej",   "t'",  "Ejective alveolar stop"),
    0xC0038: ("k_ej",   "k'",  "Ejective velar stop"),
    0xC0039: ("y",      "y",   "Palatal approximant"),
    0xC003A: ("p_ej",   "p'",  "Ejective bilabial stop"),
    0xC003B: ("m",      "m",   "Bilabial nasal"),
    0xC003C: ("w",      "w",   "Labio-velar approximant"),
    0xC003D: ("h",      "h",   "Glottal fricative"),
    0xC003E: ("t",      "t",   "Alveolar stop"),
    0xC003F: ("n_pal",  "ň",   "Palatal nasal"),
    0xC0040: ("k",      "k",   "Velar stop"),
    0xC0041: ("f",      "f",   "Labiodental fricative"),
    0xC0042: ("t_dent", "ţ",   "Dental fricative / alveolar lateral"),
    0xC0043: ("c",      "c",   "Alveolar affricate (ts)"),
    0xC0044: ("p",      "p",   "Bilabial stop"),
    0xC0045: ("q_ej",   "q'",  "Uvular ejective stop"),
    0xC0046: ("x",      "x",   "Velar fricative"),
    0xC0047: ("q",      "q",   "Uvular stop"),
    0xC0048: ("c_ej",   "c'",  "Ejective alveolar affricate"),
    0xC0049: ("ch_ej",  "ch'", "Ejective palato-alveolar affricate"),
    0xC004A: ("r",      "r",   "Alveolar trill"),
    0xC004B: ("sh",     "š",   "Palato-alveolar fricative"),
    0xC004C: ("s",      "s",   "Alveolar fricative"),
    0xC004D: ("ch",     "č",   "Palato-alveolar affricate"),
}

PLACEHOLDER_IDS = {
    0xC004E: "PLACEHOLDER_VBAR",
    0xC004F: "PLACEHOLDER_DASH",
}

DIACRITIC_NULL_CP = 0xC0050

CH12_SECTION = {
    "punctuation": "—",
    "number":      "—",
    "tenthPower":  "—",
    "primary":     "12.1",
    "secondary":   "12.2",
    "tertiary":    "12.3",
    "consonantal": "12.2",
    "placeholder": "12.7",
    "diacritic":   "12.2.1 / 12.2.2 / 12.4.1",
    "grid":        "—",
}


# ---------------------------------------------------------------------------
# Classification helpers
# ---------------------------------------------------------------------------

ITHKEY_BASE = 0xC0000

def ithkey_class(cp: int) -> str:
    if cp < ITHKEY_BASE or cp > ITHKEY_BASE + 0x7F:
        return "external"
    off = cp - ITHKEY_BASE
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

def assign_glyph_id(cp: int) -> str:
    cls = ithkey_class(cp)
    off = cp - ITHKEY_BASE
    if cls == "punctuation": return PUNCTUATION_IDS[off]
    if cls == "number":      return DIGIT_IDS[off - 0x04]
    if cls == "tenthPower":  return TENTHPOWER_IDS[off - 0x0E]
    if cls == "primary":     return PRIMARY_IDS[off - 0x12]
    if cls == "secondary":   return SECONDARY_IDS[off - 0x2A]
    if cls == "tertiary":    return TERTIARY_IDS[off - 0x30]
    if cls == "consonantal":
        info = CONSONANT_MAP.get(cp)
        return f"CONSONANT_{info[0].upper()}" if info else f"CONSONANT_{hex(cp)}"
    if cls == "placeholder": return PLACEHOLDER_IDS.get(cp, f"PLACEHOLDER_{hex(cp)}")
    if cls == "diacritic":
        return "DIACRITIC_NULL" if cp == DIACRITIC_NULL_CP else f"DIACRITIC_{cp - DIACRITIC_NULL_CP:02d}"
    if cls == "grid":        return "GRID_OVERLAY"
    return f"UNKNOWN_{hex(cp)}"


# ---------------------------------------------------------------------------
# Format detection and normalisation
# ---------------------------------------------------------------------------

def load_cmap(cmap_data) -> dict:
    """
    Return {int_codepoint: glyph_name_str}.
    Handles both analysis formats:
      Python  -> {"0xc0012": "glyphName", ...}       (dict, hex string keys)
      TypeScript -> [{codepoint:"U+C0012", glyphName:"..."}, ...]  (list of objects)
    """
    if isinstance(cmap_data, dict):
        return {int(k, 16): v for k, v in cmap_data.items()}

    if isinstance(cmap_data, list):
        result = {}
        for entry in cmap_data:
            cp_str = entry.get("codepoint", "")
            name   = entry.get("glyphName", "")
            if cp_str and name:
                cp_int = int(cp_str.replace("U+", "").replace("u+", ""), 16)
                result[cp_int] = name
        return result

    raise ValueError(f"Unrecognised cmap.json format: {type(cmap_data)}")


def normalise_bbox(bbox) -> dict | None:
    """
    Normalise bbox to {xMin, yMin, xMax, yMax}.
    Python analysis  -> {xMin, yMin, xMax, yMax}
    TypeScript analysis -> {x1, y1, x2, y2}
    """
    if bbox is None:
        return None
    if "xMin" in bbox:
        return bbox   # already in Python format
    if "x1" in bbox:
        return {
            "xMin": bbox["x1"],
            "yMin": bbox["y1"],
            "xMax": bbox["x2"],
            "yMax": bbox["y2"],
        }
    return None   # unknown format


def load_glyphs(glyphs_data: list) -> dict:
    """Return {glyph_name: normalised_record}."""
    result = {}
    for rec in glyphs_data:
        name = rec.get("glyphName", "")
        if not name:
            continue
        result[name] = {
            "glyphName":   name,
            "advanceWidth": rec.get("advanceWidth", 0),
            "unitsPerEm":  rec.get("unitsPerEm", 1000),
            "bbox":        normalise_bbox(rec.get("bbox")),
            "svgPath":     rec.get("svgPath", ""),
        }
    return result


# ---------------------------------------------------------------------------
# SVG export
# ---------------------------------------------------------------------------

SVG_PADDING = 50


def make_svg(svg_path_data: str, bbox: dict | None, upm: int) -> str:
    """
    Wrap a glyph path in a standalone SVG.
    Font y-axis (up) is flipped to SVG y-axis (down) via viewBox manipulation.
    """
    if not svg_path_data:
        w = h = upm + SVG_PADDING * 2
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
            f'  <!-- empty glyph -->\n</svg>'
        )

    # Safe bbox values with fallback
    if bbox and all(bbox.get(k) is not None for k in ("xMin","yMin","xMax","yMax")):
        x_min = bbox["xMin"] - SVG_PADDING
        y_min = bbox["yMin"] - SVG_PADDING
        x_max = bbox["xMax"] + SVG_PADDING
        y_max = bbox["yMax"] + SVG_PADDING
        bbox_comment = (
            f'xMin={bbox["xMin"]}, yMin={bbox["yMin"]}, '
            f'xMax={bbox["xMax"]}, yMax={bbox["yMax"]}'
        )
    else:
        x_min, y_min = -SVG_PADDING, -SVG_PADDING
        x_max, y_max = upm + SVG_PADDING, upm + SVG_PADDING
        bbox_comment = "no bbox data"

    width  = x_max - x_min
    height = y_max - y_min

    # Flip y-axis: SVG viewBox y goes down, font coords y goes up.
    # Setting viewBox yMin = -(font_yMax) maps font top to SVG top.
    view_x = x_min
    view_y = -y_max
    view_w = width
    view_h = height

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg"\n'
        f'     width="{width:.1f}" height="{height:.1f}"\n'
        f'     viewBox="{view_x:.1f} {view_y:.1f} {view_w:.1f} {view_h:.1f}">\n'
        f'  <!-- Font bbox: {bbox_comment} | UPM: {upm} -->\n'
        f'  <!-- scale(1,-1): font y-axis (up) -> SVG y-axis (down) -->\n'
        f'  <path transform="scale(1,-1)" fill="black" d="{svg_path_data}"/>\n'
        f'</svg>'
    )


# ---------------------------------------------------------------------------
# Markdown catalog row
# ---------------------------------------------------------------------------

def md_row(entry: dict) -> str:
    roman = entry.get("romanisation") or "—"
    desc  = entry.get("description")  or "—"
    val   = entry.get("validationStatus", "unchecked")
    return (
        f"| `{entry['glyphId']}` | `{entry['codepoint']}` "
        f"| {entry['ithkeyClass']} | {entry.get('ch12Section','—')} "
        f"| {roman} | {desc} | {entry.get('advanceWidth',0)} | {val} |"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    in_dir  = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("./inventory")
    svg_dir = out_dir / "svg"
    svg_dir.mkdir(parents=True, exist_ok=True)

    # Load and normalise inputs
    cmap_path   = in_dir / "cmap.json"
    glyphs_path = in_dir / "glyphs.json"

    for p in (cmap_path, glyphs_path):
        if not p.exists():
            sys.exit(f"Missing required file: {p}")

    cmap_raw   = json.loads(cmap_path.read_text("utf-8"))
    glyphs_raw = json.loads(glyphs_path.read_text("utf-8"))

    cp_to_name    = load_cmap(cmap_raw)
    name_to_glyph = load_glyphs(glyphs_raw)

    print(f"Loaded {len(cp_to_name)} cmap entries, {len(name_to_glyph)} glyph records")

    # Derive UPM from first glyph record that has it (fallback 1000)
    upm_default = next(
        (g["unitsPerEm"] for g in name_to_glyph.values() if g.get("unitsPerEm")),
        1000
    )

    # Build inventory
    inventory = []
    seen_glyph_names: set[str] = set()

    for cp_int in sorted(cp_to_name.keys()):
        cls = ithkey_class(cp_int)
        if cls in ("external", "unassigned"):
            continue

        glyph_name = cp_to_name[cp_int]
        glyph_rec  = name_to_glyph.get(glyph_name, {})
        glyph_id   = assign_glyph_id(cp_int)

        cons_info    = CONSONANT_MAP.get(cp_int)
        romanisation = cons_info[1] if cons_info else None
        description  = cons_info[2] if cons_info else None

        upm  = glyph_rec.get("unitsPerEm") or upm_default
        bbox = glyph_rec.get("bbox")
        path = glyph_rec.get("svgPath", "")

        entry = {
            "glyphId":          glyph_id,
            "codepoint":        f"U+{cp_int:05X}",
            "offset":           f"0x{cp_int - ITHKEY_BASE:02X}",
            "ithkeyClass":      cls,
            "ch12Section":      CH12_SECTION.get(cls, "—"),
            "fontGlyphName":    glyph_name,
            "advanceWidth":     glyph_rec.get("advanceWidth", 0),
            "unitsPerEm":       upm,
            "bbox":             bbox,
            "svgPath":          path,
            "romanisation":     romanisation,
            "description":      description,
            "validationStatus": "unchecked",
            "validationNotes":  "",
        }
        inventory.append(entry)

        # Export SVG for each unique glyph name (multiple codepoints may share one)
        if glyph_name not in seen_glyph_names:
            seen_glyph_names.add(glyph_name)
            if path:   # skip truly empty glyphs (e.g. space / .notdef)
                svg_content = make_svg(path, bbox, upm)
                (svg_dir / f"{glyph_id}.svg").write_text(svg_content, "utf-8")

    # Write inventory JSON
    inv_path = out_dir / "glyph_inventory.json"
    inv_path.write_text(json.dumps(inventory, indent=2, ensure_ascii=False), "utf-8")
    print(f"Wrote {len(inventory)} entries  ->  {inv_path}")

    # Write per-class JSON files
    by_class: dict[str, list] = {}
    for e in inventory:
        by_class.setdefault(e["ithkeyClass"], []).append(e)

    for cls, entries in by_class.items():
        p = out_dir / f"class_{cls}.json"
        p.write_text(json.dumps(entries, indent=2, ensure_ascii=False), "utf-8")

    # Write markdown catalog
    md_lines = [
        "# Ithkuil Glyph Inventory",
        "",
        "> Generated by Phase 0.3.  "
        "`validationStatus` values: `unchecked` | `confirmed` | `discrepancy` | `absent`",
        "",
        "| GlyphID | Codepoint | Class | Ch.12 § | Romanisation "
        "| Description | AdvWidth | Validation |",
        "|---------|-----------|-------|---------|--------------|"
        "-------------|----------|------------|",
    ]
    for entry in inventory:
        md_lines.append(md_row(entry))

    md_lines += [
        "",
        "## Summary by class",
        "",
        "| Class | Count | Codepoint range |",
        "|-------|-------|-----------------|",
    ]
    for cls, entries in sorted(by_class.items()):
        cps = [e["codepoint"] for e in entries]
        rng = f"{cps[0]} – {cps[-1]}" if len(cps) > 1 else cps[0]
        md_lines.append(f"| {cls} | {len(entries)} | {rng} |")

    md_path = out_dir / "glyph_inventory.md"
    md_path.write_text("\n".join(md_lines) + "\n", "utf-8")
    print(f"Wrote markdown catalog  ->  {md_path}")

    svg_count = len(list(svg_dir.glob("*.svg")))
    print(f"Exported {svg_count} SVG files  ->  {svg_dir}/")
    print()
    print("Class breakdown:")
    for cls, entries in sorted(by_class.items()):
        print(f"  {cls:<16} {len(entries):>3} glyphs")


if __name__ == "__main__":
    main()

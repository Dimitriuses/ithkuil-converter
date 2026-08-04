"""
Phase 0.4 -- Bidirectional mapping table builder
=================================================
Combines the glyph inventory (Phase 0.3) with GPOS anchor data (Phase 0.2)
to produce the central mapping table used by both converter pipelines.

The ithkey font is a mark-positioning font: diacritics are separate glyphs
positioned by GPOS mark-to-base anchors, NOT by GSUB ligatures.
diacritic_sequences.json will therefore be empty -- this is correct.
Diacritic slot information is derived from GPOS mark class assignments.

Run:
  python build_mapping_table.py <inventory_dir> <analysis_dir> <output_dir>

  <inventory_dir>  -- output of build_glyph_inventory.py
  <analysis_dir>   -- output of extract_font_tables.py  (Python analysis,
                      for gpos_rules.json and cmap.json)
                      OR extract_font_tables.ts (TypeScript, for gpos_anchors.json)
                      Script auto-detects both formats.

Output files in <output_dir>:
  mapping_table.json         -- full bidirectional mapping (base glyphs)
  forward_index.json         -- codepoint -> GlyphID  (encoder lookup)
  reverse_index.json         -- GlyphID   -> codepoint (decoder lookup)
  diacritic_classes.json     -- mark class -> [diacriticGlyphIds] (from GPOS)
  base_anchor_map.json       -- base GlyphID -> {markClass: {x,y}} (from GPOS)
  diacritic_slot_summary.md  -- human-readable diacritic slot table
  mapping_table.md           -- human-readable mapping catalog
  stats.txt                  -- summary statistics
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

# ---------------------------------------------------------------------------
# Helpers
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


def load_cmap(cmap_data) -> dict[int, str]:
    """
    Return {int_codepoint: glyph_name}.
    Handles both analysis formats:
      Python     -> {"0xc0012": "glyphName", ...}
      TypeScript -> [{codepoint:"U+C0012", glyphName:"..."}, ...]
    """
    if isinstance(cmap_data, dict):
        return {int(k, 16): v for k, v in cmap_data.items()}
    if isinstance(cmap_data, list):
        result: dict[int, str] = {}
        for entry in cmap_data:
            cp_str = entry.get("codepoint", "")
            name   = entry.get("glyphName", "")
            if cp_str and name:
                cp_int = int(cp_str.replace("U+", "").replace("u+", ""), 16)
                result[cp_int] = name
        return result
    raise ValueError(f"Unrecognised cmap.json format: {type(cmap_data)}")


def load_gpos(gpos_data: list) -> list:
    """
    Normalise GPOS data from either analysis format.
    Both Python (gpos_rules.json) and TypeScript (gpos_anchors.json) produce
    a list of lookup objects with an 'anchors' array.
    Each anchor entry has: role, glyph, classIndex, x, y
    """
    return gpos_data   # same schema from both extractors


def sequence_key(cps: list[str]) -> str:
    return "+".join(cps)


# ---------------------------------------------------------------------------
# GPOS anchor analysis
# ---------------------------------------------------------------------------

def analyse_gpos(
    gpos_lookups: list,
    name_to_cp:   dict[str, str],
    name_to_inv:  dict[str, dict],
) -> tuple[dict, dict, dict]:
    """
    Derive three structures from GPOS mark-to-base data:

    diacritic_classes: {markClassIndex -> [glyphId, ...]}
        Which diacritic glyphs belong to each mark class.

    base_anchor_map: {baseGlyphId -> {markClassIndex -> {x, y}}}
        For each base glyph, the attachment point per mark class.

    mark_anchor_map: {diacriticGlyphId -> {classIndex, x, y}}
        The attachment anchor on each mark glyph.
    """
    diacritic_classes: dict[int, list[str]] = defaultdict(list)
    base_anchor_map:   dict[str, dict]      = defaultdict(dict)
    mark_anchor_map:   dict[str, dict]      = {}

    for lookup in gpos_lookups:
        ltype = lookup.get("lookupType", 0)
        if ltype not in (4, 6):   # 4=mark-to-base, 6=mark-to-mark
            continue

        for anchor in lookup.get("anchors", []):
            role       = anchor.get("role", "")
            glyph_name = anchor.get("glyph", "")
            cls_idx    = anchor.get("classIndex", 0)
            x          = anchor.get("x") or anchor.get("anchor", {}).get("x", 0)
            y          = anchor.get("y") or anchor.get("anchor", {}).get("y", 0)

            # Resolve glyph name to inventory entry and GlyphID
            inv = name_to_inv.get(glyph_name, {})
            glyph_id = inv.get("glyphId", f"UNKNOWN_{glyph_name}")
            cp_str   = inv.get("codepoint", name_to_cp.get(glyph_name, "?"))
            cp_int   = int(cp_str.replace("U+",""), 16) if cp_str != "?" else 0
            g_class  = ithkey_class(cp_int) if cp_int else "unknown"

            if role == "mark":
                # Mark (diacritic) glyph: record its class assignment
                if glyph_id not in diacritic_classes[cls_idx]:
                    diacritic_classes[cls_idx].append(glyph_id)
                mark_anchor_map[glyph_id] = {
                    "classIndex": cls_idx,
                    "attachAnchor": {"x": x, "y": y},
                    "ithkeyClass": g_class,
                }

            elif role in ("base", "mark2base", "mark2"):
                # Base (or mark-base) glyph: record per-class attachment points
                base_anchor_map[glyph_id][cls_idx] = {
                    "x": x, "y": y,
                    "glyphName": glyph_name,
                    "ithkeyClass": g_class,
                }

    return dict(diacritic_classes), dict(base_anchor_map), mark_anchor_map


# ---------------------------------------------------------------------------
# Mapping table entry
# ---------------------------------------------------------------------------

def make_entry(
    codepoint:    str,
    glyph_id:     str,
    entry_type:   str,
    base_class:   str,
    ch12_section: str,
    romanisation: str | None,
    description:  str | None,
    font_glyph_name: str,
    mark_info:    dict | None = None,
) -> dict:
    entry: dict = {
        "codepoint":      codepoint,
        "glyphId":        glyph_id,
        "type":           entry_type,
        "baseClass":      base_class,
        "ch12Section":    ch12_section,
        "romanisation":   romanisation or "",
        "description":    description or "",
        "fontGlyphName":  font_glyph_name,
        "validationStatus": "unchecked",
    }
    if mark_info:
        entry["markClass"]    = mark_info.get("classIndex")
        entry["attachAnchor"] = mark_info.get("attachAnchor")
    return entry


# ---------------------------------------------------------------------------
# Diacritic slot summary markdown
# ---------------------------------------------------------------------------

def write_diacritic_summary(
    diacritic_classes: dict,
    mark_anchor_map:   dict,
    base_anchor_map:   dict,
    inventory:         list,
    out_path:          Path,
) -> None:
    inv_by_id = {e["glyphId"]: e for e in inventory}

    lines = [
        "# Diacritic Slot Summary (from GPOS mark-to-base analysis)",
        "",
        "> The ithkey font positions diacritics using GPOS mark-to-base anchors.",
        "> Each **mark class** groups diacritics that attach at the same anchor",
        "> point on a base glyph. This table is the empirical source for the",
        "> slot assignments described in the encoding audit (Phase 0.1 §4.4).",
        "",
        "## Mark classes (diacritic groupings)",
        "",
        "| Mark class | Diacritic GlyphIDs | Codepoints | Attach anchor (x,y) |",
        "|------------|-------------------|------------|---------------------|",
    ]

    for cls_idx in sorted(diacritic_classes.keys()):
        glyph_ids = diacritic_classes[cls_idx]
        for gid in glyph_ids:
            inv = inv_by_id.get(gid, {})
            cp  = inv.get("codepoint", "?")
            anc = mark_anchor_map.get(gid, {}).get("attachAnchor", {})
            anc_str = f"({anc.get('x','?')}, {anc.get('y','?')})" if anc else "—"
            lines.append(f"| {cls_idx} | `{gid}` | `{cp}` | {anc_str} |")

    lines += [
        "",
        "## Base glyph anchor points per mark class",
        "",
        "| Base GlyphID | Class | " +
        " | ".join(f"Mark class {i}" for i in sorted(
            {ci for anchors in base_anchor_map.values() for ci in anchors}
        )) + " |",
        "|---|---|" + "|".join(
            "---" for _ in sorted(
                {ci for anchors in base_anchor_map.values() for ci in anchors}
            )
        ) + "|",
    ]

    all_mark_classes = sorted(
        {ci for anchors in base_anchor_map.values() for ci in anchors}
    )
    for glyph_id, anchors in sorted(base_anchor_map.items()):
        inv = inv_by_id.get(glyph_id, {})
        g_class = inv.get("ithkeyClass", "?")
        cells = []
        for ci in all_mark_classes:
            a = anchors.get(ci)
            cells.append(f"({a['x']},{a['y']})" if a else "—")
        lines.append(f"| `{glyph_id}` | {g_class} | " + " | ".join(cells) + " |")

    out_path.write_text("\n".join(lines) + "\n", "utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    inv_dir = Path(sys.argv[1])
    ana_dir = Path(sys.argv[2])
    out_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("./mapping")
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── Load inputs ──────────────────────────────────────────────────────────

    inv_path = inv_dir / "glyph_inventory.json"
    if not inv_path.exists():
        sys.exit(f"Missing: {inv_path}")
    inventory: list = json.loads(inv_path.read_text("utf-8"))
    print(f"Loaded {len(inventory)} inventory entries")

    # cmap -- try Python format first, fall back to TypeScript format
    cmap_path = ana_dir / "cmap.json"
    if not cmap_path.exists():
        sys.exit(f"Missing: {cmap_path}")
    cp_to_name = load_cmap(json.loads(cmap_path.read_text("utf-8")))
    name_to_cp = {v: f"U+{k:05X}" for k, v in cp_to_name.items()}
    print(f"Loaded {len(cp_to_name)} cmap entries")

    # GPOS -- try Python filename first (gpos_rules.json), then TypeScript (gpos_anchors.json)
    gpos_path = (ana_dir / "gpos_rules.json")
    if not gpos_path.exists():
        gpos_path = ana_dir / "gpos_anchors.json"
    if not gpos_path.exists():
        print("  [!] No GPOS file found -- diacritic class analysis will be skipped")
        gpos_lookups = []
    else:
        gpos_lookups = json.loads(gpos_path.read_text("utf-8"))
        print(f"Loaded {len(gpos_lookups)} GPOS lookups from {gpos_path.name}")

    # Build lookup maps
    name_to_inv = {e["fontGlyphName"]: e for e in inventory}

    # ── GPOS analysis ─────────────────────────────────────────────────────────

    diacritic_classes, base_anchor_map, mark_anchor_map = analyse_gpos(
        gpos_lookups, name_to_cp, name_to_inv
    )

    total_marks = sum(len(v) for v in diacritic_classes.values())
    print(f"GPOS analysis: {len(diacritic_classes)} mark classes, "
          f"{total_marks} mark glyphs, {len(base_anchor_map)} base glyphs")

    # ── Build mapping entries ─────────────────────────────────────────────────

    all_entries:    list[dict] = []
    forward_index:  dict[str, str] = {}   # "U+C0012" -> "PRIMARY_Q"
    reverse_index:  dict[str, str] = {}   # "PRIMARY_Q" -> "U+C0012"

    for entry in inventory:
        cp        = entry["codepoint"]
        glyph_id  = entry["glyphId"]
        cls       = entry["ithkeyClass"]
        gname     = entry["fontGlyphName"]

        # For diacritics, attach the GPOS mark info if available
        mark_info = mark_anchor_map.get(glyph_id) if cls == "diacritic" else None

        mapping = make_entry(
            codepoint       = cp,
            glyph_id        = glyph_id,
            entry_type      = "diacritic" if cls == "diacritic" else "base",
            base_class      = cls,
            ch12_section    = entry.get("ch12Section", "—"),
            romanisation    = entry.get("romanisation"),
            description     = entry.get("description"),
            font_glyph_name = gname,
            mark_info       = mark_info,
        )
        all_entries.append(mapping)
        forward_index[cp] = glyph_id
        reverse_index[glyph_id] = cp

    # ── Write outputs ─────────────────────────────────────────────────────────

    def write(name: str, data) -> None:
        p = out_dir / name
        p.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")
        print(f"  Wrote {p}")

    write("mapping_table.json",  all_entries)
    write("forward_index.json",  forward_index)
    write("reverse_index.json",  reverse_index)
    write("diacritic_classes.json",  dict(diacritic_classes))
    write("base_anchor_map.json",    base_anchor_map)
    write("mark_anchor_map.json",    mark_anchor_map)

    # Diacritic slot summary markdown
    slot_md_path = out_dir / "diacritic_slot_summary.md"
    write_diacritic_summary(
        diacritic_classes, mark_anchor_map, base_anchor_map,
        inventory, slot_md_path
    )
    print(f"  Wrote {slot_md_path}")

    # Mapping table markdown
    md_lines = [
        "# Bidirectional Mapping Table",
        "",
        "> One row per ithkey codepoint. `type`: `base` or `diacritic`.",
        "> `markClass` and `attachAnchor` are populated for diacritics from GPOS data.",
        "",
        "| GlyphID | Codepoint | Class | Ch.12 § | Romanisation "
        "| Mark class | Validation |",
        "|---------|-----------|-------|---------|--------------|"
        "------------|------------|",
    ]
    for e in all_entries:
        mc  = str(e.get("markClass", "—")) if e["type"] == "diacritic" else "—"
        rom = e.get("romanisation") or "—"
        md_lines.append(
            f"| `{e['glyphId']}` | `{e['codepoint']}` | {e['baseClass']} "
            f"| {e['ch12Section']} | {rom} | {mc} | {e['validationStatus']} |"
        )
    (out_dir / "mapping_table.md").write_text("\n".join(md_lines) + "\n", "utf-8")
    print(f"  Wrote {out_dir / 'mapping_table.md'}")

    # Stats
    by_class: dict[str, int] = defaultdict(int)
    by_type:  dict[str, int] = defaultdict(int)
    for e in all_entries:
        by_class[e["baseClass"]] += 1
        by_type[e["type"]] += 1

    stats = [
        f"Total mapping entries : {len(all_entries)}",
        f"  base entries        : {by_type.get('base', 0)}",
        f"  diacritic entries   : {by_type.get('diacritic', 0)}",
        f"GPOS mark classes     : {len(diacritic_classes)}",
        f"GPOS base glyphs      : {len(base_anchor_map)}",
        "",
        "Entries per ithkey class:",
    ] + [f"  {cls:<16} {cnt:>3}" for cls, cnt in sorted(by_class.items())]

    stats_text = "\n".join(stats)
    (out_dir / "stats.txt").write_text(stats_text, "utf-8")
    print()
    print(stats_text)
    print(f"\nAll files written to {out_dir}/")


if __name__ == "__main__":
    main()

"""
Phase 0.5 -- Apply validation results to glyph inventory
=========================================================
Merges the validation_results.json exported from the HTML validator back
into glyph_inventory.json, updating validationStatus and validationNotes
for every reviewed glyph.

Run:
  python apply_validation.py <validation_results.json> <glyph_inventory.json>

Writes in-place (backs up the original to glyph_inventory.json.bak first).

Also prints a Phase 0.5 completion report.
"""

import json
import sys
import shutil
from pathlib import Path
from collections import Counter
from datetime import datetime


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    results_path   = Path(sys.argv[1])
    inventory_path = Path(sys.argv[2])

    if not results_path.exists():
        sys.exit(f"Missing: {results_path}")
    if not inventory_path.exists():
        sys.exit(f"Missing: {inventory_path}")

    results_data   = json.loads(results_path.read_text("utf-8"))
    inventory_data = json.loads(inventory_path.read_text("utf-8"))

    # Support both bare list and {summary, results} wrapper
    if isinstance(results_data, dict) and "results" in results_data:
        results   = results_data["results"]
        summary   = results_data.get("summary", {})
    else:
        results   = results_data
        summary   = {}

    # Index results by glyphId
    result_map = {r["glyphId"]: r for r in results}

    # Backup original
    bak_path = inventory_path.with_suffix(".json.bak")
    shutil.copy(inventory_path, bak_path)

    # Apply updates
    updated = 0
    status_counts: Counter = Counter()

    for entry in inventory_data:
        gid = entry["glyphId"]
        if gid in result_map:
            r = result_map[gid]
            entry["validationStatus"] = r.get("validationStatus", entry.get("validationStatus", "unchecked"))
            entry["validationNotes"]  = r.get("validationNotes",  entry.get("validationNotes",  ""))
            updated += 1
        status_counts[entry.get("validationStatus", "unchecked")] += 1

    # Write updated inventory
    inventory_path.write_text(
        json.dumps(inventory_data, indent=2, ensure_ascii=False), "utf-8"
    )

    # Print report
    total = len(inventory_data)
    confirmed    = status_counts["confirmed"]
    discrepancy  = status_counts["discrepancy"]
    absent       = status_counts["absent"]
    skipped      = status_counts["skipped"]
    unchecked    = status_counts["unchecked"]
    reviewed     = confirmed + discrepancy + absent
    pct          = reviewed / total * 100 if total else 0

    lines = [
        "",
        "═" * 52,
        "  Phase 0.5 — Validation Report",
        f"  {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "═" * 52,
        f"  Total glyphs      : {total}",
        f"  Updated entries   : {updated}",
        "",
        f"  ✓  Confirmed      : {confirmed:>4}  ({confirmed/total*100:.1f}%)",
        f"  ≠  Discrepancy    : {discrepancy:>4}  ({discrepancy/total*100:.1f}%)",
        f"  ∅  Absent         : {absent:>4}  ({absent/total*100:.1f}%)",
        f"  →  Skipped        : {skipped:>4}",
        f"  ?  Unchecked      : {unchecked:>4}",
        "",
        f"  Progress          : {reviewed}/{total}  ({pct:.1f}%)",
        "═" * 52,
    ]

    if discrepancy > 0:
        lines += [
            "",
            f"  Glyphs with discrepancies ({discrepancy}):",
        ]
        for entry in inventory_data:
            if entry.get("validationStatus") == "discrepancy":
                note = entry.get("validationNotes", "").strip()
                note_str = f"  -- {note}" if note else ""
                lines.append(f"    {entry['glyphId']:<30} {entry.get('codepoint','')}{note_str}")

    if absent > 0:
        lines += [
            "",
            f"  Glyphs absent from font ({absent}):",
        ]
        for entry in inventory_data:
            if entry.get("validationStatus") == "absent":
                lines.append(f"    {entry['glyphId']:<30} {entry.get('codepoint','')}")

    lines += [
        "",
        f"  Updated: {inventory_path}",
        f"  Backup:  {bak_path}",
        "",
    ]

    report = "\n".join(lines)
    print(report)

    # Write report to file
    report_path = inventory_path.parent / "validation_report.txt"
    report_path.write_text(report, "utf-8")
    print(f"  Report saved to: {report_path}")


if __name__ == "__main__":
    main()

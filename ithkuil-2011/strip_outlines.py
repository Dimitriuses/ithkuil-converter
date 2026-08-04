#!/usr/bin/env python3
"""
Remove the font's glyph OUTLINES from the analysis artifacts, keeping every measurement.

Why this exists: `ithkuil.ttf` is licensed under the FontStruct Non-Commercial License,
which forbids redistributing the font "alone or as part of any collection" (see
../NOTICE.md). A `svgPath` field is the glyph's drawing — the design itself — so committing
the extracted paths redistributes the artwork without the container. Everything else the
pipeline produces (codepoints, class partition, advance widths, GPOS anchor structure,
validation verdicts) is measurement *about* the font, not a copy of it, and stays.

    python strip_outlines.py            strip outlines from the committed artifacts
    python strip_outlines.py --check    exit 1 if any committed artifact still carries them

`--check` is what CI runs, so re-committing a freshly generated (outline-bearing) artifact
turns into a red build instead of a quiet licence problem.

Outlines are removed by deleting whole `"svgPath": …` lines rather than by re-serializing
the JSON, so indentation, key order, escaping and line endings are preserved byte for byte
and the operation is idempotent. A trailing comma left behind on the preceding line (when
`svgPath` was an object's last key, which it is in `glyphs.json`) is cleaned up.
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent

# JSON artifacts whose entries carry an `svgPath`.
JSON_TARGETS = [
    "font_analysis/glyphs.json",
    "font_analysis_ts/glyphs.json",
    "inventory/glyph_inventory.json",
]

# Whole files that are nothing *but* outlines, and so cannot be stripped — only excluded.
# They regenerate from a locally supplied font; see ../CLAUDE.md.
GENERATED_OUTLINE_PATHS = [
    "inventory/svg",  # one SVG per glyph: pure outline exports
    "validator.html",  # the review tool, with the inventory (paths included) inlined
]

OUTLINE_KEY = "svgPath"
_LINE = re.compile(r'^\s*"' + OUTLINE_KEY + r'"\s*:')


def strip_text(text: str) -> tuple[str, int]:
    """Drop every `"svgPath": …` line. Returns (new text, lines removed)."""
    # Keep the file's own newline convention: split on \n and reattach, so \r survives as
    # part of the line content on a CRLF file.
    lines = text.split("\n")
    out: list[str] = []
    removed = 0
    for line in lines:
        if _LINE.match(line):
            removed += 1
            continue
        # `svgPath` is the last key of each entry in glyphs.json, so the line before it now
        # ends in a comma that JSON will not accept before `}`.
        if out and line.lstrip().startswith(("}", "]")):
            prev = out[-1].rstrip()
            if prev.endswith(","):
                out[-1] = prev[:-1] + out[-1][len(prev) :]
        out.append(line)
    return "\n".join(out), removed


def has_outlines(path: Path) -> bool:
    if not path.exists():
        return False
    return any(_LINE.match(line) for line in path.read_text("utf-8").split("\n"))


def check() -> int:
    problems = []
    for rel in JSON_TARGETS:
        if has_outlines(HERE / rel):
            problems.append(f"{rel} still contains {OUTLINE_KEY} entries")
    for rel in GENERATED_OUTLINE_PATHS:
        p = HERE / rel
        if p.is_dir() and any(p.iterdir()):
            problems.append(f"{rel}/ exists and holds generated glyph outlines")
        elif p.is_file():
            problems.append(f"{rel} exists and inlines glyph outlines")

    if problems:
        print("Font outlines found in files that are committed:\n")
        for p in problems:
            print(f"  - {p}")
        print(
            "\nThese redistribute the font's design, which its licence forbids (../NOTICE.md)."
            f"\nRun `python {Path(__file__).name}` and make sure the paths above are gitignored."
        )
        return 1
    print("No font outlines in the committed analysis artifacts.")
    return 0


def strip() -> int:
    total = 0
    for rel in JSON_TARGETS:
        path = HERE / rel
        if not path.exists():
            print(f"  - {rel}: not present, skipped")
            continue
        original = path.read_text("utf-8")
        stripped, removed = strip_text(original)
        if removed == 0:
            print(f"  = {rel}: already clean")
            continue
        json.loads(stripped)  # refuse to write anything that is not valid JSON
        path.write_text(stripped, "utf-8", newline="")
        total += removed
        print(f"  - {rel}: removed {removed} outlines")
    print(f"\n{total} outline(s) removed. The measurements are untouched.")
    return 0


if __name__ == "__main__":
    sys.exit(check() if "--check" in sys.argv[1:] else strip())

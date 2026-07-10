"""
Fix existing SVG files from build_glyph_inventory.py
=====================================================
Patches every SVG in <svg_dir> (or regenerates from glyph_inventory.json)
to add the missing  transform="scale(1,-1)"  on the path element.

Run:
  python fix_svgs.py <inventory_dir>

  <inventory_dir>  -- contains glyph_inventory.json and svg/*.svg

Edits SVG files in-place. Safe to re-run (idempotent).
"""
import sys, re
from pathlib import Path

TRANSFORM_ATTR = 'transform="scale(1,-1)"'

def fix_svg_string(content: str) -> tuple[str, str]:
    """
    Returns (fixed_content, status) where status is
    'patched', 'already_fixed', or 'no_path'.
    """
    if TRANSFORM_ATTR in content:
        return content, "already_fixed"

    # Add transform to every <path ...> element that doesn't have one
    new, n = re.subn(
        r'(<path\b)(?![^>]*transform=)',
        rf'\1 {TRANSFORM_ATTR}',
        content,
    )
    if n == 0:
        return content, "no_path"
    return new, "patched"

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    inv_dir = Path(sys.argv[1])
    svg_dir = inv_dir / "svg"

    if not svg_dir.exists():
        sys.exit(f"SVG directory not found: {svg_dir}")

    svgs = list(svg_dir.glob("*.svg"))
    if not svgs:
        sys.exit(f"No SVG files found in {svg_dir}")

    counts = {"patched": 0, "already_fixed": 0, "no_path": 0}
    for svg_path in sorted(svgs):
        content = svg_path.read_text("utf-8")
        fixed, status = fix_svg_string(content)
        counts[status] += 1
        if status == "patched":
            svg_path.write_text(fixed, "utf-8")

    total = len(svgs)
    print(f"Processed {total} SVG files:")
    print(f"  Patched       : {counts['patched']}")
    print(f"  Already fixed : {counts['already_fixed']}")
    print(f"  No <path>     : {counts['no_path']}")
    if counts["patched"]:
        print(f"\nDone. Re-run build_validator.py to regenerate the HTML.")

if __name__ == "__main__":
    main()

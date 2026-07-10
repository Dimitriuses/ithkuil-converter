"""
Phase 0.5 -- Glyph <-> reference cross-match precompute
=======================================================
For every glyph that has a pool of candidate 2011-script reference images,
render the font glyph and score its visual similarity against EVERY candidate
in its class, then write the ranked top matches. The validator shows these as
"possible matches" so a reviewer can tell whether a glyph marked as a
discrepancy actually matches a DIFFERENT reference (a mapping error) or none
(a genuine font-vs-figure difference).

Run:
  python build_glyph_similarity.py <inventory_dir> [output_json]

  <inventory_dir>  -- output of build_glyph_inventory.py (needs glyph_inventory.json)
  output_json      -- default: <inventory_dir>/glyph_similarity.json

Requires: Pillow, numpy, scipy (dev-only; not needed to run build_validator.py).
The similarity metric is a thickness-invariant symmetric Chamfer score, so the
thin geometric font glyphs compare fairly against the thick hand-drawn figures.

Reference images are cached under <inventory_dir>/.ref_cache/ (regenerable).
"""

import json
import sys
import urllib.request
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageFont, ImageDraw
    from scipy.ndimage import distance_transform_edt, binary_dilation
except ImportError:
    sys.exit("Needs Pillow + numpy + scipy:  pip install Pillow numpy scipy")

import importlib.util

HERE = Path(__file__).resolve().parent
FONT_PATH = HERE / "ithkuil.ttf"
BASE_URL = "https://ithkuil.net/images/"
N = 64          # normalised glyph grid
TOP_K = 3       # candidate matches to keep per glyph


# ---------------------------------------------------------------------------
# Candidate reference pools per ithkey class.
# Each pool is a list of (filename, short_label). A glyph is scored against
# every entry in its class pool.
# ---------------------------------------------------------------------------

def load_validator_module():
    """Reuse CONSONANT_REF / PRIMARY_KEYS_ORDER from build_validator.py."""
    spec = importlib.util.spec_from_file_location("bv", HERE / "build_validator.py")
    bv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bv)
    return bv


def build_pools(bv):
    pools: dict[str, list[tuple[str, str]]] = {}
    # consonantal: the 23 per-consonant figures
    pools["consonantal"] = [
        (fn, cap.split("—")[-1].strip()) for fn, cap in bv.CONSONANT_REF.values()
    ]
    # primary: the 24 basic case forms
    pools["primary"] = [(f"11-case{n:02d}.jpg", f"case {n}") for n in range(1, 25)]
    # secondary: broaden to the 24 base secondary-case forms so a mis-mapped
    # glyph can find its true match beyond the 6 currently assigned.
    pools["secondary"] = [(f"11-altcase{n:02d}.jpg", f"altcase {n}") for n in range(1, 25)]
    return pools


# ---------------------------------------------------------------------------
# Rasterisation + normalisation
# ---------------------------------------------------------------------------

def _normalise(mask: np.ndarray) -> np.ndarray:
    """Crop a boolean ink-mask to its bbox, pad to square, resize to N x N."""
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return np.zeros((N, N), bool)
    m = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = m.shape
    s = max(h, w)
    sq = np.zeros((s, s), np.uint8)
    sq[(s - h) // 2:(s - h) // 2 + h, (s - w) // 2:(s - w) // 2 + w] = m
    return np.array(Image.fromarray(sq * 255).resize((N, N), Image.NEAREST)) > 127


def font_mask(font: ImageFont.FreeTypeFont, cp: int) -> np.ndarray:
    img = Image.new("L", (320, 320), 0)
    ImageDraw.Draw(img).text((160, 160), chr(cp), font=font, fill=255, anchor="mm")
    return _normalise(np.array(img) > 127)


def ref_mask(fname: str, cache: Path) -> np.ndarray:
    p = cache / fname
    if not p.exists():
        urllib.request.urlretrieve(BASE_URL + fname, p)
    g = np.array(Image.open(p).convert("L"))
    return _normalise(g < 170)   # ink = dark (works for red hand-drawn strokes)


# ---------------------------------------------------------------------------
# Thickness-invariant symmetric Chamfer similarity
# ---------------------------------------------------------------------------

def similarity(a: np.ndarray, b: np.ndarray) -> float:
    if not a.any() or not b.any():
        return 0.0
    # light dilation closes 1px gaps from NEAREST resize
    a = binary_dilation(a); b = binary_dilation(b)
    d_to_b = distance_transform_edt(~b)
    d_to_a = distance_transform_edt(~a)
    d = 0.5 * (d_to_b[a].mean() + d_to_a[b].mean())
    return round(1.0 / (1.0 + d), 4)


# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    inv_dir = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else inv_dir / "glyph_similarity.json"
    cache = inv_dir / ".ref_cache"
    cache.mkdir(parents=True, exist_ok=True)

    inventory = json.loads((inv_dir / "glyph_inventory.json").read_text("utf-8"))
    bv = load_validator_module()
    pools = build_pools(bv)
    font = ImageFont.truetype(str(FONT_PATH), 220)

    # pre-rasterise each class pool once
    ref_masks = {
        cls: [(fn, lab, ref_mask(fn, cache)) for fn, lab in pool]
        for cls, pool in pools.items()
    }

    result: dict[str, list[dict]] = {}
    for e in inventory:
        cls = e.get("ithkeyClass")
        if cls not in ref_masks:
            continue
        cp = int(e["codepoint"].replace("U+", ""), 16)
        fm = font_mask(font, cp)
        scored = sorted(
            ((similarity(fm, rm), fn, lab) for fn, lab, rm in ref_masks[cls]),
            reverse=True,
        )
        result[e["glyphId"]] = [
            {"file": fn, "label": lab, "score": sc} for sc, fn, lab in scored[:TOP_K]
        ]
        best = scored[0]
        print(f"{e['glyphId']:<18} best: {best[2]:<12} {best[0]:.3f}")

    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), "utf-8")
    print(f"\nWrote {out}  ({len(result)} glyphs scored)")


if __name__ == "__main__":
    main()

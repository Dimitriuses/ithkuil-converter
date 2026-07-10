"""
Phase 0.5 -- Glyph validation tool builder
==========================================
Reads glyph_inventory.json and the exported SVG files, then generates a
self-contained HTML validation tool (validator.html).

Run:
  python build_validator.py <inventory_dir> <output_html>

  <inventory_dir>  -- output of build_glyph_inventory.py
                      must contain glyph_inventory.json and svg/*.svg
  <output_html>    -- path to write the generated HTML file
                      (default: ./validator.html)

The HTML tool:
  - Shows each glyph's SVG alongside the relevant 2011-script (Chapter 11) reference
    image (the ithkey font encodes the 2004-2011 script, NOT New Ithkuil ch12)
  - Lets you mark each glyph as: confirmed / discrepancy / absent / skip
  - Has a freeform notes field per glyph
  - Tracks progress across sessions via localStorage
  - Exports a validation_results.json you feed into apply_validation.py
"""

import json
import sys
import base64
from pathlib import Path

BASE_URL = "https://ithkuil.net/images/"

# ---------------------------------------------------------------------------
# Reference images: 2011 Ithkuil script (Chapter 11), NOT New Ithkuil (ch12).
#
# The ithkey font (by Ykulvaarlck) encodes the 2004-2011 script per
# ithkuil.net/11_script.htm -- confirmed by its readme (references 11_script.html
# + 01_phonology.html) and by exact glyph-shape matches against the 11-cons-*.jpg
# figures, including the plain/ejective/aspirated consonant series that New Ithkuil
# does not have. The font's primary/secondary/tertiary/consonantal classes are the
# 2011 character model, which reuses those names for entirely different glyphs than
# New Ithkuil ch12 -- which is why validating against ch12 made everything "mismatch".
# ---------------------------------------------------------------------------

# Human-readable 2011-script section per ithkey class (shown as the reference label).
CH11_SECTION: dict[str, str] = {
    "primary":     "§11.3.1 — Primary (Case/Aspect) Characters",
    "secondary":   "§11.3.2 — Secondary (Case/Aspect) Characters",
    "tertiary":    "§11.3.3 — Tertiary Characters",
    "consonantal": "§11.3.4 — Consonantal Characters",
    "placeholder": "§11.4.1 — Alphabetic writing / placeholder",
    "diacritic":   "§11.3 — Diacritics (superposed / underposed / lateral)",
    "punctuation": "§11.4 — Punctuation & quotation",
    "number":      "numerals (separate chapter — no script figure)",
    "tenthPower":  "numerals (separate chapter — no script figure)",
    "grid":        "font debug grid — no reference",
}

# Class-level fallback reference images. Used ONLY for glyphs that have no exact
# per-glyph figure in the 2011 source (see per_glyph_ref for the 1:1 cases:
# primary -> 11-caseNN, secondary -> 11-altcaseNN, consonantal -> 11-cons-*).
# (filename, caption); BASE_URL is prefixed at render time.
CH11_IMAGES: dict[str, list[tuple[str, str]]] = {
    # primary / secondary / consonantal resolve 1:1 via per_glyph_ref; the neutral
    # examples are kept only as a defensive fallback and normally never shown.
    "primary":     [("11-character-example.jpg",  "§11.3.1 — Neutral Primary Character (fallback)")],
    "secondary":   [("11-character-example2.jpg", "§11.3.2 — Neutral Secondary Character (fallback)")],
    # Tertiary characters are not enumerated per-form in the 2011 source; the reviewer
    # checks the shape against the structural explanation (horizontal mid-line bar).
    "tertiary": [
        ("11-tertiary_character-explanation.jpg", "§11.3.3 — Tertiary Character structure (type reference — no per-glyph figure)"),
    ],
    # Diacritics are combining marks (they render near-empty in isolation) and the
    # 2011 diacritic figures are semantic, not the font's positional building blocks,
    # so there is no 1:1 mapping. Shown as type references only.
    "diacritic": [
        ("11-diacritic01-sup.jpg", "§11.3 — superposed diacritic (type reference)"),
        ("11-diacritic01-sub.jpg", "§11.3 — underposed diacritic (type reference)"),
        ("11-diacritic01-lat.jpg", "§11.3 — lateral diacritic (type reference)"),
    ],
    "placeholder": [
        ("11-alphabetic.jpg", "§11.4.1 — Alphabetic transliteration & placeholder marks"),
    ],
    "punctuation": [
        ("11-quotemarks.jpg", "§11.4 — Quotation marks"),
    ],
    # Numbers / tenth-powers are numerals, not part of the script chapter — no figure.
    "number": [],
    "tenthPower": [],
    "grid": [],
}

# Per-consonant 1:1 reference: GlyphID -> (2011 consonant image, caption).
# Verified: every font consonant glyph matches its 11-cons-*.jpg exactly in shape.
CONSONANT_REF: dict[str, tuple[str, str]] = {
    "CONSONANT_T_EJ":   ("11-cons-t-ejct.jpg",        "§11.3.4 — t’ (ejective)"),
    "CONSONANT_K_EJ":   ("11-cons-k-ejct.jpg",        "§11.3.4 — k’ (ejective)"),
    "CONSONANT_Y":      ("11-cons-y.jpg",             "§11.3.4 — y"),
    "CONSONANT_P_EJ":   ("11-cons-p-ejct.jpg",        "§11.3.4 — p’ (ejective)"),
    "CONSONANT_M":      ("11-cons-m.jpg",             "§11.3.4 — m"),
    "CONSONANT_W":      ("11-cons-w.jpg",             "§11.3.4 — w"),
    "CONSONANT_H":      ("11-cons-h.jpg",             "§11.3.4 — h"),
    "CONSONANT_T":      ("11-cons-t.jpg",             "§11.3.4 — t"),
    "CONSONANT_N_PAL":  ("11-cons-n-hacek.jpg",       "§11.3.4 — ň"),
    "CONSONANT_K":      ("11-cons-k.jpg",             "§11.3.4 — k"),
    "CONSONANT_F":      ("11-cons-f.jpg",             "§11.3.4 — f"),
    "CONSONANT_T_DENT": ("11-cons-t-cedilla.jpg",     "§11.3.4 — ţ"),
    "CONSONANT_C":      ("11-cons-c.jpg",             "§11.3.4 — c"),
    "CONSONANT_P":      ("11-cons-p.jpg",             "§11.3.4 — p"),
    "CONSONANT_Q_EJ":   ("11-cons-q-ejct.jpg",        "§11.3.4 — q’ (ejective)"),
    "CONSONANT_X":      ("11-cons-x.jpg",             "§11.3.4 — x"),
    "CONSONANT_Q":      ("11-cons-q.jpg",             "§11.3.4 — q"),
    "CONSONANT_C_EJ":   ("11-cons-c-ejct.jpg",        "§11.3.4 — c’ (ejective)"),
    "CONSONANT_CH_EJ":  ("11-cons-c-hacek-ejct.jpg",  "§11.3.4 — č’ (ejective)"),
    "CONSONANT_R":      ("11-cons-r.jpg",             "§11.3.4 — r"),
    "CONSONANT_SH":     ("11-cons-s-hacek.jpg",       "§11.3.4 — š"),
    "CONSONANT_S":      ("11-cons-s.jpg",             "§11.3.4 — s"),
    "CONSONANT_CH":     ("11-cons-c-hacek.jpg",       "§11.3.4 — č"),
}

# Primary character keyboard order == the order of the first 24 cases in Chapter 11.
# Spec (§11.3.1): "there are 24 basic forms corresponding to the first 24 cases."
# So PRIMARY_<key> (in this order) validates 1:1 against 11-case01..24.jpg.
# Verified: every font primary glyph matches its 11-caseNN figure.
PRIMARY_KEYS_ORDER = [
    "Q", "W", "E", "R", "T", "Y", "U", "I", "O",
    "A", "S", "D", "F", "G", "H", "J", "K", "L",
    "X", "C", "V", "B", "N", "M",
]


def per_glyph_ref(entry: dict) -> list[tuple[str, str]]:
    """Exact 1:1 reference image(s) for this specific glyph, or [] if none exists.

    A 1:1 reference is available for consonantal, primary and secondary glyphs;
    tertiary/diacritic/number glyphs have no per-glyph figure in the 2011 source
    (they fall back to the class-level CH11_IMAGES reference).
    """
    gid = entry.get("glyphId", "")
    cls = entry.get("ithkeyClass", "")
    if gid in CONSONANT_REF:
        return [CONSONANT_REF[gid]]
    if cls == "primary" and gid.startswith("PRIMARY_"):
        key = gid[len("PRIMARY_"):]
        if key in PRIMARY_KEYS_ORDER:
            n = PRIMARY_KEYS_ORDER.index(key) + 1
            return [(f"11-case{n:02d}.jpg", f"§11.3.1 — Primary case form #{n} (basic form {n} of 24)")]
    if cls == "secondary" and gid.startswith("SECONDARY_"):
        try:
            n = int(gid.rsplit("_", 1)[-1])
        except ValueError:
            n = 0
        if 1 <= n <= 6:
            return [(f"11-altcase{n:02d}.jpg", f"§11.3.2 — Secondary case form #{n}")]
    return []


def load_svg(svg_path: Path) -> str:
    """Return SVG file content, or empty string if missing."""
    if svg_path.exists():
        return svg_path.read_text("utf-8")
    return ""


def ref_images_html(entry: dict) -> str:
    cls = entry.get("ithkeyClass", "")
    # Prefer an exact 1:1 reference; only fall back to the (shared) class reference
    # when no per-glyph figure exists. This avoids showing the same generic image
    # on every glyph of a class.
    images: list[tuple[str, str]] = per_glyph_ref(entry) or CH11_IMAGES.get(cls, [])
    if not images:
        return ('<p class="no-ref">No 2011-script (Ch. 11) reference figure exists for '
                'this glyph — validate its shape by eye against the character type.</p>')
    parts = []
    for fname, caption in images:
        url = BASE_URL + fname
        parts.append(
            f'<figure class="ref-fig">'
            f'<a href="{url}" target="_blank">'
            f'<img src="{url}" alt="{caption}" loading="lazy" onerror="this.parentElement.parentElement.classList.add(\'img-error\')">'
            f'</a>'
            f'<figcaption>{caption}</figcaption>'
            f'</figure>'
        )
    return "\n".join(parts)


def build_glyph_data(inventory: list, svg_dir: Path) -> list[dict]:
    glyphs = []
    for entry in inventory:
        gid  = entry["glyphId"]
        svg  = load_svg(svg_dir / f"{gid}.svg")
        glyphs.append({
            "glyphId":        gid,
            "codepoint":      entry.get("codepoint", "?"),
            "offset":         entry.get("offset", "?"),
            "ithkeyClass":    entry.get("ithkeyClass", "?"),
            "ch12Section":    entry.get("ch12Section", "—"),
            "refSection":     CH11_SECTION.get(entry.get("ithkeyClass", ""), "—"),
            "romanisation":   entry.get("romanisation") or "",
            "description":    entry.get("description") or "",
            "advanceWidth":   entry.get("advanceWidth", 0),
            "fontGlyphName":  entry.get("fontGlyphName", ""),
            "refImagesHtml":  ref_images_html(entry),
            "svgContent":     svg,
            "validationStatus": entry.get("validationStatus", "unchecked"),
            "validationNotes":  entry.get("validationNotes", ""),
        })
    return glyphs


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ithkuil Glyph Validator — Phase 0.5</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Playfair+Display:wght@600&family=DM+Sans:wght@300;400;500&display=swap');

  :root {
    --bg:       #0f0f11;
    --panel:    #17171c;
    --border:   #2a2a35;
    --accent:   #c8a96e;
    --accent2:  #6e9ec8;
    --text:     #ddd8ce;
    --muted:    #6a6878;
    --ok:       #4caf7d;
    --warn:     #e07b54;
    --info:     #5b9bd5;
    --radius:   8px;
    --mono:     'DM Mono', monospace;
    --serif:    'Playfair Display', Georgia, serif;
    --sans:     'DM Sans', system-ui, sans-serif;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-weight: 300;
    min-height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr auto;
  }

  /* ── Header ── */
  header {
    border-bottom: 1px solid var(--border);
    padding: 14px 28px;
    display: flex;
    align-items: center;
    gap: 20px;
    background: var(--panel);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  header h1 {
    font-family: var(--serif);
    font-size: 1.1rem;
    color: var(--accent);
    letter-spacing: .04em;
    flex: 1;
  }
  .progress-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: .78rem;
    color: var(--muted);
    font-family: var(--mono);
  }
  .progress-bar {
    width: 160px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width .3s ease;
  }
  .btn {
    font-family: var(--mono);
    font-size: .75rem;
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    transition: border-color .15s, color .15s, background .15s;
  }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #111;
    font-weight: 500;
  }
  .btn.primary:hover { background: #dfc080; }

  /* ── Main layout ── */
  main {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    height: calc(100vh - 57px - 60px);
    overflow: hidden;
  }

  /* ── Left: glyph panel ── */
  .glyph-panel {
    border-right: 1px solid var(--border);
    display: grid;
    grid-template-rows: auto 1fr auto;
    overflow: hidden;
  }
  .glyph-meta {
    padding: 18px 24px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  .glyph-id {
    font-family: var(--mono);
    font-size: 1.05rem;
    color: var(--accent);
    margin-bottom: 8px;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px 16px;
    font-size: .75rem;
    color: var(--muted);
    font-family: var(--mono);
  }
  .meta-grid span { color: var(--text); }
  .glyph-canvas {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1c1c22;
    padding: 32px;
    overflow: hidden;
    position: relative;
  }
  .glyph-canvas svg {
    max-width: 100%;
    max-height: 100%;
    filter: invert(1) brightness(0.9);  /* white glyph on dark bg */
  }
  .glyph-canvas .no-svg {
    color: var(--muted);
    font-family: var(--mono);
    font-size: .8rem;
    text-align: center;
  }
  .class-badge {
    position: absolute;
    top: 12px;
    left: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: .68rem;
    font-family: var(--mono);
    color: var(--muted);
  }
  .status-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: .68rem;
    font-family: var(--mono);
    font-weight: 500;
  }
  .status-badge.confirmed  { background: #1a3a2a; color: var(--ok); }
  .status-badge.discrepancy{ background: #3a1a0e; color: var(--warn); }
  .status-badge.absent     { background: #2a1a30; color: #a070d0; }
  .status-badge.unchecked  { background: var(--panel); color: var(--muted); border: 1px solid var(--border); }
  .status-badge.skipped    { background: var(--panel); color: var(--muted); border: 1px solid var(--border); }

  /* ── Right: reference panel ── */
  .ref-panel {
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: hidden;
  }
  .ref-header {
    padding: 14px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    font-size: .78rem;
    color: var(--muted);
  }
  .ref-header strong { color: var(--accent2); font-weight: 500; }
  .ref-scroll {
    overflow-y: auto;
    padding: 20px 24px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .ref-fig {
    margin-bottom: 24px;
  }
  .ref-fig img {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: block;
    background: #222;
    min-height: 80px;
  }
  .ref-fig.img-error img { display: none; }
  .ref-fig.img-error::after {
    content: "⚠ Image unavailable — open ithkuil.net directly";
    display: block;
    padding: 12px;
    font-size: .75rem;
    color: var(--muted);
    font-family: var(--mono);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    text-align: center;
  }
  .ref-fig figcaption {
    font-size: .72rem;
    color: var(--muted);
    margin-top: 6px;
    font-family: var(--mono);
  }
  .ref-fig a { display: block; }
  .no-ref {
    font-size: .78rem;
    color: var(--muted);
    font-family: var(--mono);
    padding: 12px 0;
  }

  /* ── Footer: controls ── */
  footer {
    border-top: 1px solid var(--border);
    background: var(--panel);
    padding: 12px 24px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 16px;
    align-items: center;
  }
  .verdict-btns { display: flex; gap: 8px; }
  .verdict-btn {
    font-family: var(--mono);
    font-size: .72rem;
    padding: 7px 14px;
    border-radius: var(--radius);
    border: 1px solid;
    cursor: pointer;
    transition: opacity .15s, transform .1s;
    font-weight: 500;
  }
  .verdict-btn:active { transform: scale(.96); }
  .verdict-btn.v-confirmed   { border-color: var(--ok);   color: var(--ok);   background: #0d2018; }
  .verdict-btn.v-discrepancy { border-color: var(--warn);  color: var(--warn); background: #200e06; }
  .verdict-btn.v-absent      { border-color: #a070d0; color: #a070d0; background: #180d22; }
  .verdict-btn.v-skip        { border-color: var(--border); color: var(--muted); background: transparent; }
  .verdict-btn.active        { opacity: 1; }
  .verdict-btn:not(.active)  { opacity: .55; }
  .notes-area {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-family: var(--mono);
    font-size: .72rem;
    padding: 7px 10px;
    resize: none;
    height: 36px;
    width: 100%;
    transition: border-color .15s, height .2s;
    line-height: 1.5;
  }
  .notes-area:focus {
    outline: none;
    border-color: var(--accent2);
    height: 60px;
  }
  .nav-btns { display: flex; gap: 8px; align-items: center; }
  .nav-idx {
    font-family: var(--mono);
    font-size: .72rem;
    color: var(--muted);
    min-width: 70px;
    text-align: center;
  }

  /* ── Quick-jump sidebar dots ── */
  .dot-map {
    position: fixed;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 3px;
    z-index: 50;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--border);
    cursor: pointer;
    transition: background .15s, transform .15s;
  }
  .dot.confirmed  { background: var(--ok); }
  .dot.discrepancy{ background: var(--warn); }
  .dot.absent     { background: #a070d0; }
  .dot.current    { transform: scale(1.8); background: var(--accent); }
  .dot:hover      { transform: scale(1.8); }
</style>
</head>
<body>

<header>
  <h1>Ithkuil Glyph Validator — Phase 0.5</h1>
  <div class="progress-wrap">
    <div class="progress-bar"><div class="progress-fill" id="progFill"></div></div>
    <span id="progLabel">0 / 0</span>
  </div>
  <button class="btn" onclick="exportResults()">Export JSON</button>
</header>

<main>
  <!-- Left: glyph -->
  <div class="glyph-panel">
    <div class="glyph-meta">
      <div class="glyph-id" id="metaId"></div>
      <div class="meta-grid">
        <div>codepoint<br><span id="metaCp"></span></div>
        <div>class<br><span id="metaCls"></span></div>
        <div>ch.12 §<br><span id="metaSec"></span></div>
        <div>romanisation<br><span id="metaRom"></span></div>
        <div>advance width<br><span id="metaAdv"></span></div>
        <div>font name<br><span id="metaFnt"></span></div>
      </div>
    </div>
    <div class="glyph-canvas" id="glyphCanvas">
      <div class="class-badge" id="classBadge"></div>
      <div class="status-badge unchecked" id="statusBadge">unchecked</div>
      <div id="svgWrap"></div>
    </div>
  </div>

  <!-- Right: reference images -->
  <div class="ref-panel">
    <div class="ref-header">
      2011 script (Ch. 11) reference — <strong id="refSecLabel"></strong>
      &nbsp;·&nbsp;
      <a href="https://ithkuil.net/11_script.htm" target="_blank"
         style="color:var(--accent2);text-decoration:none;font-size:.72rem;">
        open full chapter ↗
      </a>
    </div>
    <div class="ref-scroll" id="refScroll"></div>
  </div>
</main>

<footer>
  <div class="verdict-btns">
    <button class="verdict-btn v-confirmed"   onclick="setVerdict('confirmed')">✓ Confirmed</button>
    <button class="verdict-btn v-discrepancy" onclick="setVerdict('discrepancy')">≠ Discrepancy</button>
    <button class="verdict-btn v-absent"      onclick="setVerdict('absent')">∅ Absent</button>
    <button class="verdict-btn v-skip"        onclick="setVerdict('skipped')">→ Skip</button>
  </div>
  <textarea class="notes-area" id="notesArea" placeholder="Validation notes…"
            oninput="saveNotes()"></textarea>
  <div class="nav-btns">
    <button class="btn" onclick="navigate(-1)">← Prev</button>
    <div class="nav-idx" id="navIdx">0 / 0</div>
    <button class="btn" onclick="navigate(1)">Next →</button>
  </div>
</footer>

<div class="dot-map" id="dotMap"></div>

<script>
const GLYPHS = __GLYPH_DATA__;

// Load saved state from localStorage
const STORAGE_KEY = 'ithkuil_validator_v1';
function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state  = loadState();
let cursor = parseInt(localStorage.getItem(STORAGE_KEY + '_cursor') || '0', 10);
if (cursor >= GLYPHS.length) cursor = 0;

// Merge persisted state into glyph data
GLYPHS.forEach(g => {
  if (state[g.glyphId]) {
    g.validationStatus = state[g.glyphId].status || g.validationStatus;
    g.validationNotes  = state[g.glyphId].notes  || g.validationNotes;
  }
});

// ── Rendering ──────────────────────────────────────────────────────────────

function render() {
  const g = GLYPHS[cursor];

  // Meta
  document.getElementById('metaId').textContent  = g.glyphId;
  document.getElementById('metaCp').textContent  = g.codepoint;
  document.getElementById('metaCls').textContent = g.ithkeyClass;
  document.getElementById('metaSec').textContent = g.refSection;
  document.getElementById('metaRom').textContent = g.romanisation || '—';
  document.getElementById('metaAdv').textContent = g.advanceWidth;
  document.getElementById('metaFnt').textContent = g.fontGlyphName;

  // SVG
  const wrap = document.getElementById('svgWrap');
  if (g.svgContent) {
    wrap.innerHTML = g.svgContent;
    // Safety net: ensure every <path> that lacks a y-flip transform gets one.
    // This corrects SVGs generated before the fix_svgs.py patch was applied.
    const svgEl = wrap.querySelector('svg');
    if (svgEl) {
      svgEl.querySelectorAll('path').forEach(p => {
        const t = p.getAttribute('transform') || '';
        if (!t.includes('scale')) {
          p.setAttribute('transform', (t + ' scale(1,-1)').trim());
        }
      });
    }
  } else {
    wrap.innerHTML = '<div class="no-svg">No SVG exported<br><small>' + g.glyphId + '</small></div>';
  }

  // Class badge
  document.getElementById('classBadge').textContent = g.ithkeyClass;

  // Status badge
  const badge = document.getElementById('statusBadge');
  badge.textContent = g.validationStatus;
  badge.className = 'status-badge ' + g.validationStatus;

  // Verdict buttons highlight
  document.querySelectorAll('.verdict-btn').forEach(b => b.classList.remove('active'));
  const active = document.querySelector('.v-' + g.validationStatus);
  if (active) active.classList.add('active');

  // Notes
  document.getElementById('notesArea').value = g.validationNotes || '';

  // Reference panel
  document.getElementById('refSecLabel').textContent = g.refSection;
  document.getElementById('refScroll').innerHTML = g.refImagesHtml;

  // Nav
  document.getElementById('navIdx').textContent = (cursor + 1) + ' / ' + GLYPHS.length;

  // Progress
  const done  = GLYPHS.filter(x => x.validationStatus !== 'unchecked').length;
  const pct   = (done / GLYPHS.length * 100).toFixed(1);
  document.getElementById('progFill').style.width = pct + '%';
  document.getElementById('progLabel').textContent = done + ' / ' + GLYPHS.length;

  // Dots
  renderDots();

  // Keyboard hint
  localStorage.setItem(STORAGE_KEY + '_cursor', cursor);
}

function renderDots() {
  const map = document.getElementById('dotMap');
  map.innerHTML = '';
  const max = Math.min(GLYPHS.length, 80);
  const step = GLYPHS.length > max ? Math.ceil(GLYPHS.length / max) : 1;
  for (let i = 0; i < GLYPHS.length; i += step) {
    const g   = GLYPHS[i];
    const dot = document.createElement('div');
    dot.className = 'dot ' + g.validationStatus + (i === cursor ? ' current' : '');
    dot.title = g.glyphId;
    const idx = i;
    dot.onclick = () => { cursor = idx; render(); };
    map.appendChild(dot);
  }
}

// ── Controls ────────────────────────────────────────────────────────────────

function setVerdict(status) {
  const g = GLYPHS[cursor];
  g.validationStatus = status;
  state[g.glyphId] = { status, notes: g.validationNotes };
  saveState(state);
  render();
  // Auto-advance on verdict
  if (status !== 'unchecked') setTimeout(() => navigate(1), 180);
}

function saveNotes() {
  const g = GLYPHS[cursor];
  g.validationNotes = document.getElementById('notesArea').value;
  state[g.glyphId] = { status: g.validationStatus, notes: g.validationNotes };
  saveState(state);
}

function navigate(dir) {
  cursor = (cursor + dir + GLYPHS.length) % GLYPHS.length;
  render();
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA') return;
  const map = {
    'ArrowRight': () => navigate(1),
    'ArrowLeft':  () => navigate(-1),
    'ArrowUp':    () => navigate(-1),
    'ArrowDown':  () => navigate(1),
    'c': () => setVerdict('confirmed'),
    'd': () => setVerdict('discrepancy'),
    'a': () => setVerdict('absent'),
    's': () => setVerdict('skipped'),
  };
  if (map[e.key]) { e.preventDefault(); map[e.key](); }
});

// ── Export ──────────────────────────────────────────────────────────────────

function exportResults() {
  const results = GLYPHS.map(g => ({
    glyphId:          g.glyphId,
    codepoint:        g.codepoint,
    ithkeyClass:      g.ithkeyClass,
    ch12Section:      g.ch12Section,
    romanisation:     g.romanisation,
    validationStatus: g.validationStatus,
    validationNotes:  g.validationNotes || '',
  }));

  const summary = {
    total:       results.length,
    confirmed:   results.filter(r => r.validationStatus === 'confirmed').length,
    discrepancy: results.filter(r => r.validationStatus === 'discrepancy').length,
    absent:      results.filter(r => r.validationStatus === 'absent').length,
    skipped:     results.filter(r => r.validationStatus === 'skipped').length,
    unchecked:   results.filter(r => r.validationStatus === 'unchecked').length,
  };

  const output = { summary, results };
  const blob   = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href = url;
  a.download = 'validation_results.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Boot ────────────────────────────────────────────────────────────────────
render();
</script>
</body>
</html>
"""


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    inv_dir  = Path(sys.argv[1])
    out_html = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("./validator.html")

    inv_path = inv_dir / "glyph_inventory.json"
    svg_dir  = inv_dir / "svg"

    if not inv_path.exists():
        sys.exit(f"Missing: {inv_path}")

    inventory = json.loads(inv_path.read_text("utf-8"))
    print(f"Loaded {len(inventory)} inventory entries")

    if not svg_dir.exists():
        print(f"  [!] SVG directory not found at {svg_dir} — glyphs will show placeholder text")

    glyph_data = build_glyph_data(inventory, svg_dir)

    present    = sum(1 for g in glyph_data if g["svgContent"])
    print(f"SVGs embedded: {present} / {len(glyph_data)}")

    glyph_json = json.dumps(glyph_data, ensure_ascii=False, indent=None)
    html = HTML_TEMPLATE.replace("__GLYPH_DATA__", glyph_json)
    out_html.write_text(html, "utf-8")

    size_kb = out_html.stat().st_size // 1024
    print(f"Wrote {out_html}  ({size_kb} KB)")
    print()
    print("Keyboard shortcuts in the validator:")
    print("  c — confirmed    d — discrepancy")
    print("  a — absent       s — skip")
    print("  ← / → — navigate")
    print()
    print("After validating, click 'Export JSON' to save validation_results.json")
    print("Then run: python apply_validation.py validation_results.json glyph_inventory.json")


if __name__ == "__main__":
    main()

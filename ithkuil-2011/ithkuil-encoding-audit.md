# Ithkuil Encoding Audit — Phase 0.1

> Sources: [`mklcp/ithkey` readme](https://github.com/mklcp/ithkey/blob/master/readme.md) and
> [`ithm.klc`](https://github.com/mklcp/ithkey/blob/master/ithm.klc) (Windows keyboard layout file).  
> Purpose: Document every codepoint the ithkey font uses and how they combine to form glyphs.

---

## 1. Unicode Block

All ithkey font codepoints live in the **Unicode Supplementary Private Use Area-B**:

```
Range : U+C0000 – U+C007F  (128 codepoints)
```

This range is completely private — no standard Unicode meaning applies. The font's internal GSUB/GPOS tables define all semantics.

---

## 2. Character Classes

The 128 codepoints are divided into classes. The table below uses the offset from `0xC0000`
(i.e., offset `0x00` = codepoint `U+C0000`):

```
offset | 0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F
-------+------------------------------------------------
0x00   | M  M  M  M  N  N  N  N  N  N  N  N  N  N  B  B
0x10   | B  B  1  1  1  1  1  1  1  1  1  1  1  1  1  1
0x20   | 1  1  1  1  1  1  1  1  1  1  2  2  2  2  2  2
0x30   | 3  3  3  3  3  3  3  C  C  C  C  C  C  C  C  C
0x40   | C  C  C  C  C  C  C  C  C  C  C  C  C  C  P  P
0x50   | =  =  =  =  =  =  =  =  =  =  =  =  =  =  =  =
0x60   | =  =  =  =  =  =  =  =  =  =  =  =  =  =  =  =
0x70   | =  =  =  =  =  =  =  =  =  =  =  =  =  =  =  @
```

| Symbol | Class name | Offset range | Count | Description |
|---|---|---|---|---|
| M | Punctuation | `0x00–0x03` | 4 | Sentence/word delimiters |
| N | Numbers | `0x04–0x0D` | 10 | Digit characters 1–0 |
| B | Tenth powers | `0x0E–0x11` | 4 | ×10, ×100, ×10⁴, ×10⁸ |
| 1 | Primary chars | `0x12–0x29` | 24 | Word-initial morphological characters |
| 2 | Secondary chars | `0x2A–0x2F` | 6 | Secondary-position base frames |
| 3 | Tertiary chars | `0x30–0x36` | 7 | Tertiary composite base frames |
| C | Consonantal chars | `0x37–0x4D` | 23 | Consonant-carrying characters |
| P | Placeholder | `0x4E–0x4F` | 2 | Placeholder marks (two variants) |
| = | Combining diacritics | `0x50–0x70` | 33 | Stacking combining marks |
| @ | Grid char | `0x7F` | 1 | Zero-width debug grid overlay |

> **Note on `0x71–0x7E`:** These 14 codepoints are currently unassigned but reserved for future use.

---

## 3. Complete Codepoint Listing

All codepoints are written as full Unicode scalars (`U+C00xx`).

### 3.1 Punctuation (M) — `U+C0000–U+C0003`

| Codepoint | Keyboard key | Notes |
|---|---|---|
| `U+C0000` | `,` / Shift-`,` | Punctuation mark 1 |
| `U+C0001` | `.` / Shift-`.` | Punctuation mark 2 |
| `U+C0002` | `/` / Shift-`/` | Punctuation mark 3 |
| `U+C0003` | `Z` / Shift-`Z` | Punctuation mark 4 |

### 3.2 Numbers (N) — `U+C0004–U+C000D`

| Codepoint | Keyboard key | Digit |
|---|---|---|
| `U+C0004` | Shift-`1` | 1 |
| `U+C0005` | Shift-`2` | 2 |
| `U+C0006` | Shift-`3` | 3 |
| `U+C0007` | Shift-`4` | 4 |
| `U+C0008` | Shift-`5` | 5 |
| `U+C0009` | Shift-`6` | 6 |
| `U+C000A` | Shift-`7` | 7 |
| `U+C000B` | Shift-`8` | 8 |
| `U+C000C` | Shift-`9` | 9 |
| `U+C000D` | Shift-`0` | 0 |

### 3.3 Tenth Powers (B) — `U+C000E–U+C0011`

| Codepoint | Keyboard key | Value |
|---|---|---|
| `U+C000E` | Shift-`-` | ×10 |
| `U+C000F` | Shift-`=` | ×100 |
| `U+C0010` | Shift-`]` | ×10⁴ |
| `U+C0011` | Shift-`\` | ×10⁸ |

### 3.4 Primary Characters (1) — `U+C0012–U+C0029`

24 characters, ordered left-to-right, top-to-bottom by the key layout, following the
order of Cases from the 2011 Ithkuil Chapter 11.

| Codepoint | Keyboard key | Layout position |
|---|---|---|
| `U+C0012` | `Q` (base) | Top row, key 1 |
| `U+C0013` | `W` (base) | Top row, key 2 |
| `U+C0014` | `E` (base) | Top row, key 3 |
| `U+C0015` | `R` (base) | Top row, key 4 |
| `U+C0016` | `T` (base) | Top row, key 5 |
| `U+C0017` | `Y` (base) | Top row, key 6 |
| `U+C0018` | `U` (base) | Top row, key 7 |
| `U+C0019` | `I` (base) | Top row, key 8 |
| `U+C001A` | `O` (base) | Top row, key 9 |
| `U+C001B` | `A` (base) | Home row, key 1 |
| `U+C001C` | `S` (base) | Home row, key 2 |
| `U+C001D` | `D` (base) | Home row, key 3 |
| `U+C001E` | `F` (base) | Home row, key 4 |
| `U+C001F` | `G` (base) | Home row, key 5 |
| `U+C0020` | `H` (base) | Home row, key 6 |
| `U+C0021` | `J` (base) | Home row, key 7 |
| `U+C0022` | `K` (base) | Home row, key 8 |
| `U+C0023` | `L` (base) | Home row, key 9 |
| `U+C0024` | `X` (base) | Bottom row, key 2 |
| `U+C0025` | `C` (base) | Bottom row, key 3 |
| `U+C0026` | `V` (base) | Bottom row, key 4 |
| `U+C0027` | `B` (base) | Bottom row, key 5 |
| `U+C0028` | `N` (base) | Bottom row, key 6 |
| `U+C0029` | `M` (base) | Bottom row, key 7 |

### 3.5 Secondary Characters (2) — `U+C002A–U+C002F`

6 base frame shapes for secondary-position glyphs.

| Codepoint | Keyboard key |
|---|---|
| `U+C002A` | AltGr-`` ` `` |
| `U+C002B` | AltGr-`1` |
| `U+C002C` | AltGr-`2` |
| `U+C002D` | AltGr-`3` |
| `U+C002E` | AltGr-`4` |
| `U+C002F` | AltGr-`5` |

### 3.6 Tertiary Characters (3) — `U+C0030–U+C0036`

7 composite base frames for tertiary-position glyphs.

| Codepoint | Keyboard key |
|---|---|
| `U+C0030` | AltGr-`6` |
| `U+C0031` | AltGr-`7` |
| `U+C0032` | AltGr-`8` |
| `U+C0033` | AltGr-`9` |
| `U+C0034` | AltGr-`0` |
| `U+C0035` | AltGr-`-` |
| `U+C0036` | AltGr-`=` |

### 3.7 Consonantal Characters (C) — `U+C0037–U+C004D`

23 consonant-carrying characters. The shift-level key layout maps them to romanised
consonant values as follows (using the readme's romanisation notation):

| Codepoint | Keyboard key | Romanisation |
|---|---|---|
| `U+C0037` | Shift-`T` | t |
| `U+C0038` | Shift-`I` | i (vowel placeholder?) |
| `U+C0039` | Shift-`Y` | y |
| `U+C003A` | Shift-`O` | o (vowel placeholder?) |
| `U+C003B` | Shift-`M` | m |
| `U+C003C` | Shift-`W` | w |
| `U+C003D` | Shift-`H` | h |
| `U+C003E` | Shift-`G` | g? (č or similar) |
| `U+C003F` | Shift-`N` | n (ň) |
| `U+C0040` | Shift-`K` | k |
| `U+C0041` | Shift-`F` | f |
| `U+C0042` | Shift-`E` | ţ |
| `U+C0043` | Shift-`D` | d |
| `U+C0044` | Shift-`L` | l |
| `U+C0045` | Shift-`Q` | q |
| `U+C0046` | Shift-`X` | x |
| `U+C0047` | Shift-`A` | a? (š or similar) |
| `U+C0048` | Shift-`C` | c |
| `U+C0049` | Shift-`U` | u? (č') |
| `U+C004A` | Shift-`R` | r |
| `U+C004B` | Shift-`V` | v |
| `U+C004C` | Shift-`S` | s |
| `U+C004D` | Shift-`J` | j |

> **⚠ Validation note:** The romanisation assignments in this table are inferred from the
> keyboard key layout described in the readme and need to be verified against the
> `ithkuil_font_map_00-4f.png` and `ithkuil_font_map_00-7f.png` images in the repo.

### 3.8 Placeholder Characters (P) — `U+C004E–U+C004F`

Two placeholder variants with different diacritic support profiles (see §5):

| Codepoint | Symbol | Keyboard key | Description |
|---|---|---|---|
| `U+C004E` | P\| | Shift-`B` | Vertical-bar placeholder |
| `U+C004F` | P- | AltGr-`\` / `OEM_102` | Dash/horizontal placeholder |

### 3.9 Combining Diacritics (=) — `U+C0050–U+C0070`

33 combining marks in total. `U+C0050` is the **null diacritic** — it has no visual
effect but advances the position counter (used to skip a slot to its default value).

#### Diacritic codepoint table

| Codepoints | Count | Primary keyboard level |
|---|---|---|
| `U+C0050–U+C0061` | 18 | **Base** level (keys `1`–`9`, `0`, `-`, `=`, `Q`–`O`, `A`–`H`) |
| `U+C0050–U+C0053` | 4 (repeat) | **Shift** level (keys `;`, `'`, `P`, `[`) |
| `U+C0050–U+C0070` | 33 (all) | **AltGr** level (full set, top row → bottom row) |

Full AltGr layout, row by row:

| AltGr key | Codepoint | AltGr key | Codepoint |
|---|---|---|---|
| `Q` | `U+C0050` | `P` | `U+C0059` |
| `W` | `U+C0051` | `[` | `U+C005A` |
| `E` | `U+C0052` | `]` | `U+C005B` |
| `R` | `U+C0053` | `A` | `U+C005C` |
| `T` | `U+C0054` | `S` | `U+C005D` |
| `Y` | `U+C0055` | `D` | `U+C005E` |
| `U` | `U+C0056` | `F` | `U+C005F` |
| `I` | `U+C0057` | `G` | `U+C0060` |
| `O` | `U+C0058` | `H` | `U+C0061` |
| `Z` | `U+C0067` | `J` | `U+C0062` |
| `X` | `U+C0068` | `K` | `U+C0063` |
| `C` | `U+C0069` | `L` | `U+C0064` |
| `V` | `U+C006A` | `;` | `U+C0065` |
| `B` | `U+C006B` | `'` | `U+C0066` |
| `N` | `U+C006C` | `,` | `U+C006E` |
| `M` | `U+C006D` | `.` | `U+C006F` |
| `/` | `U+C0070` | | |

### 3.10 Special Character (@) — `U+C007F`

| Codepoint | Keyboard key | Description |
|---|---|---|
| `U+C007F` | `` ` `` / Shift-`` ` `` | Zero-width debug grid overlay; both base and shift produce the same codepoint |

---

## 4. The Combining Diacritic System

### 4.1 Core mechanic

A rendered ithkey glyph is a **base character codepoint followed by up to 7 combining
diacritics**. The font's GSUB/GPOS tables interpret the sequence positionally: the
1st diacritic after the base fills slot 1, the 2nd fills slot 2, and so on up to slot 7.
**The same diacritic codepoint produces a different visual result depending on which slot
it occupies.** The null diacritic `U+C0050` is used to skip a slot and leave it at its
default value.

```
[base char] [diacritic₁] [diacritic₂] [diacritic₃] … [diacritic₇]
     ↓            ↓             ↓             ↓
  glyph      slot 1 mod    slot 2 mod    slot 3 mod
```

### 4.2 Diacritic types

| Symbol | Name | Visual effect |
|---|---|---|
| `+` | Rotation | Rotates the base character (used for Slot VII secondary chars) |
| `'` | Top tail | Extension/stroke at the top end of the character |
| `,` | Bottom tail | Extension/stroke at the bottom end |
| `/'` | Top wing | Wing or arc at the top |
| `/,` | Bottom wing | Wing or arc at the bottom |
| `^` | Top diacritic | Superposed mark (above the body) |
| `V` | Low diacritic | Underposed mark (below the body) |
| `>` | Mid diacritic | Mark along the right side / mid position |
| `-'` | Variant top tail | Variant form of the top tail (not fully "top") |
| `-,` | Variant bottom tail | Variant form of the bottom tail |

### 4.3 Diacritic support by character class

Not every class accepts every diacritic type. The table below shows which diacritic
types each class can receive:

| Class | `+` | `'` | `,` | `/'` | `/,` | `^` | `V` | `>` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 Primary | ✓ | ✓ | ✓ | — | — | ✓ | ✓ | ✓ |
| 2 Secondary | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 3 Tertiary | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| C Consonantal | ✓ | `-'` | ✓ | — | — | ✓ | ✓ | ✓ |
| P\| Placeholder | — | ✓ | ✓ | — | — | ✓ | ✓ | ✓ |
| P- Placeholder | — | `-'` | `-,` | — | — | ✓ | ✓ | ✓ |
| N Numbers | — | — | ✓ | — | — | — | — | — |

### 4.4 Diacritic slots per class

Based on the diacritic support tables, the slot layout per class is:

**Primary chars (1):** up to 7 slots
```
slot 1 : rotation (+)
slot 2 : top tail (')
slot 3 : bottom tail (,)
slot 4 : [unused / gap]
slot 5 : [unused / gap]
slot 6 : top diacritic (^)
slot 7 : low diacritic (V)
slot ? : mid diacritic (>)
```

**Consonantal chars (C):** up to 7 slots
```
slot 1 : rotation (+)
slot 2 : variant top tail (-')
slot 3 : bottom tail (,)
slot 6 : top diacritic (^)
slot 7 : low diacritic (V)
slot ? : mid diacritic (>)
```

**Secondary chars (2):** up to 7 slots
```
slot 2 : top tail (')
slot 3 : bottom tail (,)
slot 4 : top wing (/')
slot 5 : bottom wing (/,)
slot 6 : top diacritic (^)
slot 7 : low diacritic (V)
slot ? : mid diacritic (>)
```

**Tertiary chars (3):**
```
slot 4 : top wing (/')
slot 5 : bottom wing (/,)
slot 6 : top diacritic (^)
slot 7 : low diacritic (V)
slot ? : mid diacritic (>)
```

> **⚠ Validation note:** The exact assignment of diacritic types to slot numbers (1–7)
> must be confirmed by reading the `test.html` file in the repo, which contains
> "tests of the max range of diacritic uses for one diacritic slot after a base char."
> The slot assignments above are inferred from the class support table; they are not
> explicitly listed in the readme.

---

## 5. Keyboard Layout Summary

The ithkey keyboard has three active levels: **Base**, **Shift**, and **AltGr**.

### Base level — primary characters + most-used diacritics

```
U+C007F  U+C0050 U+C0051 U+C0052 U+C0053 U+C0054 U+C0055 U+C0056 U+C0057 U+C0058 U+C0059 U+C005A U+C005B
         U+C0012 U+C0013 U+C0014 U+C0015 U+C0016 U+C0017 U+C0018 U+C0019 U+C001A U+C005C U+C005D U+C005E
         U+C001B U+C001C U+C001D U+C001E U+C001F U+C0020 U+C0021 U+C0022 U+C0023 U+C005F U+C0060 U+C0061
U+C0003  U+C0024 U+C0025 U+C0026 U+C0027 U+C0028 U+C0029 U+C0000 U+C0001 U+C0002
```

Keys `Q`–`O`, `A`–`L`, `X`–`M` → primary chars (`1` class, 24 chars)  
Number row → diacritics (`=` class, `U+C0050`–`U+C005B`)  
`P`, `[`, `]`, `;`, `'` → remaining diacritics  

### Shift level — consonantal characters + numbers

```
U+C007F  U+C0004 U+C0005 U+C0006 U+C0007 U+C0008 U+C0009 U+C000A U+C000B U+C000C U+C000D U+C000E U+C000F
         U+C0045 U+C003C U+C0042 U+C004A U+C0037 U+C0039 U+C0049 U+C0038 U+C003A U+C0052 U+C0053 U+C0010
         U+C0047 U+C004C U+C0043 U+C0041 U+C003E U+C003D U+C004D U+C0040 U+C0044 U+C0050 U+C0051 U+C0011
U+C0003  U+C0046 U+C0048 U+C004B U+C004E U+C003F U+C003B U+C0000 U+C0001 U+C0002
```

Keys `Q`–`O`, `A`–`L`, `X`–`M` → consonantal chars (`C` class, 23 chars)  
Number row → digit glyphs (`N` class) and tenth powers (`B` class, on `-`, `=`, `]`, `\`)  
`B` (Shift-`B`) → placeholder `U+C004E`  
`P`, `[` → diacritics `U+C0052`, `U+C0053`  
`;`, `'` → diacritics `U+C0050`, `U+C0051`  

### AltGr level — secondary/tertiary chars + full diacritic set

```
U+C002A  U+C002B U+C002C U+C002D U+C002E U+C002F U+C0030 U+C0031 U+C0032 U+C0033 U+C0034 U+C0035 U+C0036
         U+C0050 U+C0051 U+C0052 U+C0053 U+C0054 U+C0055 U+C0056 U+C0057 U+C0058 U+C0059 U+C005A U+C005B
         U+C005C U+C005D U+C005E U+C005F U+C0060 U+C0061 U+C0062 U+C0063 U+C0064 U+C0065 U+C0066 U+C004F
U+C0067  U+C0068 U+C0069 U+C006A U+C006B U+C006C U+C006D U+C006E U+C006F U+C0070
```

Number row AltGr:
- `1`–`5` → secondary chars `U+C002B`–`U+C002F` (`2` class)
- `` ` `` → secondary char `U+C002A`
- `6`–`=` → tertiary chars `U+C0030`–`U+C0036` (`3` class)

Letter keys AltGr → diacritics `U+C0050`–`U+C0070` (the full 33-char set, rows top-to-bottom)  
`\` (AltGr) → placeholder `U+C004F`

---

## 6. Codepoint → Class Quick Reference

```typescript
// Utility: classify any ithkey codepoint
function getCharClass(cp: number): string {
  const offset = cp - 0xC0000;
  if (offset < 0x00 || offset > 0x7F) return 'unknown';
  if (offset <= 0x03) return 'punctuation';   // M
  if (offset <= 0x0D) return 'number';         // N
  if (offset <= 0x11) return 'tenthPower';     // B
  if (offset <= 0x29) return 'primary';        // 1
  if (offset <= 0x2F) return 'secondary';      // 2
  if (offset <= 0x36) return 'tertiary';       // 3
  if (offset <= 0x4D) return 'consonantal';    // C
  if (offset <= 0x4F) return 'placeholder';    // P
  if (offset <= 0x70) return 'diacritic';      // =
  if (offset === 0x7F) return 'grid';          // @
  return 'unassigned'; // 0x71–0x7E
}
```

---

## 6. Cross-Reference: oltartkhica Diacritics Summary (2011 Ithkuil)

The [`madmansnest/oltartkhica`](https://github.com/madmansnest/oltartkhica) project is an
independent 2011 Ithkuil font with explicit diacritic documentation. Its
`Diacritics summary.txt` lists diacritic forms by **spatial position** (mid / top /
bottom) — directly mappable to the ithkey `>` / `^` / `V` slots. This is the most
detailed public cross-reference available for the 2011 glyph system.

> **Important:** These are the 2011 Ithkuil categories, not New Ithkuil. They are
> useful for understanding the font's internal logic but must be compared against
> Chapter 12 in Phase 0.5 to identify divergences.

### Mid diacritics (`>` slot in ithkey)

| Symbol | Encoded values |
|---|---|
| `-` | u+inf, dir |
| `/` | n+inf, adm |
| `\` | a+inf, neg-asr |
| `.` | m+fml, irg |
| `\|` | u+fml, neg-irg |
| `<` | n+fml, hor |
| `>` | a+fml, dec |
| `\¯` | neg-dir |
| `¯/` | neg-adm |
| `/_` | neg-hor |
| `_\` | neg-dec |

### Top diacritics (`^` slot in ithkey)

| Symbol | Encoded values |
|---|---|
| `.` | sub, pct, dyn, deg1 |
| `/` | asm, itr, deg3 |
| `\` | spc, deg7 |
| `\¯` | cou, rep, deg4 |
| `¯/` | hyp, itm, deg6 |
| `/_` | rct |
| `_\` | fre |
| `<` | ipl, frg, deg2, dyn+fnc |
| `>` | asc, flc, deg8 |
| `-` | pr, mnf, deg9 |
| `\|` | dsc |

### Bottom diacritics (`V` slot in ithkey)

The bottom position encodes two kinds of value simultaneously: morphological categories
and **consonant cluster extensions** (the `C+x` entries). This is the primary mechanism
for encoding multi-consonant roots.

| Symbol | Morphological value | Consonant extension |
|---|---|---|
| `.` | cpt, epi | C+w (low-tone) |
| `\` | ine, alg | C+ř (falling-tone) |
| `/` | inc | C+r (rising-tone) |
| `<` | pst, exv | C+m (fall-rise-tone) |
| `>` | efc, axm | C+n (rise-fall-tone) |
| `-` | alt-prc | C+y (high-tone) |
| `\|` | alt-cpt | C+l (mid-tone) |
| `/_` | alt-ine, ipu | ţ/dh + C |
| `_\` | alt-inc, rfu | z + C |
| `\¯` | alt-pct, reb | f/v + C |
| `¯/` | alt-efc, thr | ž + C |
| `~\` | — | s + C |
| `/~` | — | š + C |

### Key implications for the converter

1. The **bottom slot doubles as a consonant cluster mechanism**. A single diacritic at
   position `V` may mean "add the consonant `r` before/after the base" rather than a
   morphological modifier. The font must distinguish these by the base character's class
   (consonantal chars use bottom-slot diacritics differently from secondary chars).

2. The **diacritic shape** (`.`, `/`, `\`, `<`, `>`, `-`, `|`, `/_`, `_\`, `\¯`, `¯/`,
   `~\`, `/~`) encodes both position and value. Thirteen distinct shapes are documented
   just for the bottom position.

3. Because oltartkhica was abandoned due to the impossibility of fitting 100,000+
   combinatorial glyphs in a font, the ithkey approach of using GSUB-driven positional
   diacritics is architecturally justified — but it means the font is selective: it only
   encodes combinations actually needed for 2011 Ithkuil, not all theoretically possible
   ones.

---

## 7. Open Questions for Phase 0.5 Validation

The following points require hands-on inspection of the font file and `test.html` before
the mapping table can be considered complete.

1. **Exact slot-to-diacritic-type mapping.** The readme describes diacritic *types* but
   not which slot number each type occupies for each class. The `test.html` file in the
   repo explicitly tests "the max range of diacritic uses for one diacritic slot after a
   base char" — this is the primary source for slot assignments.

2. **Consonantal char romanisation.** The mapping of the 23 `C`-class codepoints to
   specific Ithkuil consonants must be confirmed against the font map images
   (`ithkuil_font_map_00-4f.png`, `ithkuil_font_map_00-7f.png`).

3. **Secondary char (2) vs. consonantal char (C) distinction.** The readme lists 6
   "secondary chars" (class `2`) and 23 "consonantal chars" (class `C`) separately.
   Chapter 12 refers to "Secondary Characters" as the consonant-carrying characters.
   It must be determined whether:
   - Class `2` corresponds to Ch. 12 "Secondary Characters" (with class `C` being
     a sub-component / extension mechanism), or
   - Class `C` corresponds to Ch. 12 "Secondary Characters" and class `2` is a
     different structure (perhaps related to the old 2011 chapter 11).

4. **Font version alignment.** The ithkey font is credited as being based on the 2011
   Ithkuil writing system. Chapter 12 of the New Ithkuil grammar (2023) may describe
   a revised glyph inventory. Any divergence discovered during validation must be
   catalogued and a resolution strategy agreed before building the mapping table.

5. **GSUB table lookups.** The font uses OpenType GSUB for ligature substitution.
   Contextual or chained-context lookups (beyond simple `LookupType 4`) may encode
   additional rules not reflected in the codepoint-level description above. These must
   be extracted with `fonttools`/`opentype.js` in Phase 0.2.

6. **Quaternary characters.** The codepoint map has no explicit class for Quaternary
   characters (Ch. 12 §12.4). They may be encoded as a combination of existing classes
   or may be absent (if the font predates that structure). This must be determined.

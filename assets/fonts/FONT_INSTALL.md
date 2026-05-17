# Font installation — Groovy Operations print design system

The print engine (`/js/print-engine.js`) and the screen `@font-face` rules in
`/css/main.css` expect **real TTF files** at the exact filenames below.

## Current status (updated)

Real Aptos TTFs have been **partially** uploaded. Per-family/style the engine
embeds real fonts where present and falls back to Helvetica where a stub
remains (validation is per file, so this mixed state is safe):

| File | State | Source |
|---|---|---|
| `Aptos-Regular.ttf` | ✅ real (~235 KB) | aptos.ttf |
| `Aptos-Bold.ttf` | ✅ real (~236 KB) | aptos-bold.ttf |
| `Aptos-BoldItalic.ttf` | ✅ real (~236 KB) | aptos-bold.ttf (bold used as bold-italic substitute) |
| `AptosDisplay-Bold.ttf` | ✅ real (~236 KB) | aptos-black.ttf (black used for Display Bold weight) |
| `Aptos-Italic.ttf` | ⏳ still placeholder | needs **aptos-italic.ttf** (not yet provided) |
| `AptosDisplay-Regular.ttf` | ⏳ still placeholder | needs **aptos-semibold.ttf** (not yet provided) |
| `JameelNooriNastaleeq-Regular.ttf` | ⏳ still placeholder | Urdu font not yet provided |
| `JameelNooriNastaleeq-Bold.ttf` | ⏳ still placeholder | Urdu font not yet provided |

To finish: upload `aptos-italic.ttf` → `Aptos-Italic.ttf`,
`aptos-semibold.ttf` → `AptosDisplay-Regular.ttf`, and the two Jameel Noori
Nastaleeq weights. No code change needed — the engine picks them up on deploy.

---

The remaining stub files in this directory are **placeholders** (small text
stubs). They were committed because those fonts could not be fetched
programmatically from this sandbox (Microsoft does not publish Aptos on an
open CDN, and the Jameel Noori Nastaleeq mirrors are not reachable from the
build network).

While any placeholder remains, for that specific file:

- Generated PDFs render correctly but in **Helvetica** (the engine detects the
  invalid placeholder signature and falls back automatically — nothing breaks).
- On screen, the browser ignores the unparseable placeholder and uses the
  CSS fallback stack (`font-display: swap`).

## Required files (exact names — do not rename)

| File                               | Font                         | Use            |
|------------------------------------|------------------------------|----------------|
| `Aptos-Regular.ttf`                | Aptos Regular                | body text      |
| `Aptos-Bold.ttf`                   | Aptos Bold                   | body text      |
| `Aptos-Italic.ttf`                 | Aptos Italic                 | body text      |
| `Aptos-BoldItalic.ttf`             | Aptos Bold Italic            | body text      |
| `AptosDisplay-Regular.ttf`         | Aptos Display Regular        | hero / titles  |
| `AptosDisplay-Bold.ttf`            | Aptos Display Bold           | hero / titles  |
| `JameelNooriNastaleeq-Regular.ttf` | Jameel Noori Nastaleeq       | Urdu text      |
| `JameelNooriNastaleeq-Bold.ttf`    | Jameel Noori Nastaleeq Bold  | Urdu text      |

## How to install

1. **Aptos / Aptos Display** — Microsoft ships these free with Microsoft 365.
   Download the family from Microsoft's official Aptos distribution
   (https://aka.ms/aptos or the "Aptos fonts" package), then extract the
   `.ttf` files and rename them to match the table above (the engine needs
   plain `.ttf`, not `.ttc`/`.otf`).

2. **Jameel Noori Nastaleeq** — download the regular and bold `.ttf` from a
   reputable Urdu font source (e.g. urdufonts.net / Jameel Noori Nastaleeq
   official release) and rename to `JameelNooriNastaleeq-Regular.ttf` /
   `JameelNooriNastaleeq-Bold.ttf`.

3. Replace the placeholder files in this directory (`/assets/fonts/`) with the
   real TTFs, keeping the exact filenames.

4. (Optional, for faster screen loads) also drop `.woff2` versions next to the
   `.ttf` files using the same base names. The `@font-face` rules already
   reference `.ttf`; add a `woff2` `src` entry if you supply them.

5. Commit, push, hard-refresh the app on devices. No code changes are needed —
   the engine validates the TTF signature at runtime and switches from the
   Helvetica fallback to the embedded fonts automatically.

## Notes / known limitation

`jsPDF` does **not** perform complex-script shaping. Even with the real
Jameel Noori Nastaleeq TTF embedded, Urdu (Nastaleeq) glyphs are drawn
unshaped/left-to-right by jsPDF 2.5.1. The font will render correct letterforms
but not full Nastaleeq ligature shaping. This is a jsPDF limitation, not a
configuration issue — treat the Urdu output as a labelling aid, not
typeset Urdu. (Screen rendering via `@font-face` is unaffected and shapes
correctly.)

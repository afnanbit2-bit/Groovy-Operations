# Font installation — Groovy Operations print design system

The print engine (`/js/print-engine.js`) and the screen `@font-face` rules in
`/css/main.css` expect **real TTF files** at the exact filenames below.

## Current status (updated)

7 of 8 fonts are now real. Only the JNN **Bold** weight remains a stub
(bold-Urdu source not available). Validation is per file, so the engine
embeds all real fonts and falls back to Helvetica only for that one stub:

| File | State | Source |
|---|---|---|
| `Aptos-Regular.ttf` | ✅ real (~230 KB) | aptos.ttf |
| `Aptos-Bold.ttf` | ✅ real (~230 KB) | aptos-bold.ttf |
| `Aptos-Italic.ttf` | ✅ real (~232 KB) | aptos-italic.ttf |
| `Aptos-BoldItalic.ttf` | ✅ real (~230 KB) | aptos-bold.ttf (bold used as bold-italic substitute) |
| `AptosDisplay-Regular.ttf` | ✅ real (~230 KB) | aptos-semibold.ttf (semibold for Display Regular weight) |
| `AptosDisplay-Bold.ttf` | ✅ real (~230 KB) | aptos-black.ttf (black for Display Bold weight) |
| `JameelNooriNastaleeq-Regular.ttf` | ✅ real (~10.3 MB) | Jameel Noori Nastaleeq Regular |
| `JameelNooriNastaleeq-Bold.ttf` | ⏳ still placeholder | bold Urdu source not available (skipped) |

To finish: supply a Jameel Noori Nastaleeq **Bold** TTF →
`JameelNooriNastaleeq-Bold.ttf`. No code change needed — the engine picks
it up on deploy. (Note: the JNN Regular TTF is ~10 MB; jsPDF base64-embeds
it into every PDF that uses Urdu, so those PDFs will be large.)

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

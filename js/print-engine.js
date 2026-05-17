/* Groovy Operations — print-engine.js
   ──────────────────────────────────────────────────────────────────────────
   FOUNDATIONAL print/PDF engine. Plain global classic script (NO modules).
   Load order (index.html): shared.js → print-engine.js → auth.js → domain → boot.

   Public API (the ONLY global it exposes):

     window.printDocument({
       type: 'po' | 'embroidery-vendor' | 'sublimation-vendor' |
             'gate-pass' | 'placement-sheet' | 'qc-report' | 'generic',
       data: { ...,                         // type-specific payload
               urduLevel: 'none'|'minimal'|'full' },  // optional; see below
       filename: 'optional-name.pdf'        // default: {type}-{id}-{date}.pdf
     })

   - Uses jsPDF (loaded via CDN in index.html) at point units, A4 portrait.
   - Embeds Aptos / Aptos Display via addFileToVFS()+addFont() (Helvetica
     fallback if missing). The ~10 MB Jameel Noori Nastaleeq TTF is fetched
     and embedded ONLY when urduLevel resolves to 'full' — see the
     _PRINT_URDU_DEFAULTS table for per-type defaults. 'minimal'/'none' never
     download or embed JNN: the footer is English-only and every bilingual
     component drops its Urdu side cleanly (no tofu). This keeps light
     documents small (~tens of KB) instead of ~14 MB.
   - Opens the PDF in a new tab AND triggers a download.
   - Only the 'generic' variant is implemented. Every other `type` logs a
     console.warn and renders the generic fallback. Variant builders
     (po, embroidery-vendor, …) are added in later prompts and MUST reuse the
     internal `_render*` components below — do not bypass this engine.

   Internal-only (NOT global) reusable components, all documented with JSDoc:
     _renderHeader, _renderFooter, _renderSectionHeader, _renderBilingualLabel,
     _renderInfoTable, _renderSignatureRow, _renderDivider, _renderTitleBlock.

   Internal doc contract: printDocument stashes two things on the jsPDF
   instance so the fixed-signature components can find them:
     doc.__groovyFonts   → { logicalFamily: actualJsPDFFontName } resolver map
     doc.__groovyDocType  → document-type label (used by the per-page footer)
     doc.__groovyY        → running content cursor (Y), maintained by builders
   ────────────────────────────────────────────────────────────────────────── */

/* Print engine is now the DEFAULT path for all 5 legacy PDF generators.
   Default true. Escape hatch preserved: set `window.__usePrintEngine = false`
   in the browser console to fall back to the old jsPDF generators (their
   code is intact below each guard in pos.js / gatepass.js / hrm.js). An
   explicit pre-load `window.__usePrintEngine = false` is also honored. */
window.__usePrintEngine = (window.__usePrintEngine !== false);

/* ── PART 4 — Color / font / size / layout constants ───────────────────── */
const PRINT_COLORS = {
  black: '#000000',
  text: '#1A1A1A',
  greyAccent: '#555555',
  greyLine: '#CCCCCC',
  greyShade: '#F4F4F4',
  greyShadeLight: '#F9F9F9',
  white: '#FFFFFF'
};
const PRINT_FONTS = {
  bodyRegular: 'Aptos',
  bodyBold: 'Aptos',
  display: 'AptosDisplay',
  urdu: 'JameelNooriNastaleeq'
};
const PRINT_SIZES = {
  hero: 22,
  sectionTitle: 14,
  subsectionTitle: 12,
  body: 11,
  bodySmall: 10,
  footer: 8,
  urduSmall: 8.5,
  urduBody: 10
};
const PRINT_LAYOUT = {
  pageWidth: 595,    // A4 portrait in points
  pageHeight: 842,
  marginLeft: 36,
  marginRight: 36,
  marginTop: 36,
  marginBottom: 36,
  contentWidth: 523  // pageWidth - marginLeft - marginRight
};

/* Document-type → human label (footer text + default filename + fallback). */
const _PRINT_DOC_LABELS = {
  'po': 'Production Order',
  'embroidery-vendor': 'Embroidery Vendor Sheet',
  'sublimation-vendor': 'Sublimation Vendor Sheet',
  'gate-pass': 'Gate Pass',
  'placement-sheet': 'Placement Sheet',
  'qc-report': 'QC Report',
  'generic': 'Document'
};

/* Per-document Urdu policy. `data.urduLevel` ∈ none|minimal|full overrides;
   otherwise the per-type default below applies (unknown type → 'minimal').
   - 'full'    → fetch + embed the (~10 MB) Jameel Noori Nastaleeq TTF and
                 render the full bilingual document.
   - 'minimal' → never fetch/embed JNN; footer is English-only and every
                 bilingual component silently drops its Urdu side (no tofu).
   - 'none'    → identical handling to 'minimal' here (no JNN, no Urdu); kept
                 distinct so callers can express "deliberately no Urdu".
   Only 'full' incurs the ~14 MB base64 font payload per PDF. */
const _PRINT_URDU_DEFAULTS = {
  'generic': 'minimal',
  'gate-pass': 'full',
  'payroll-sheet': 'minimal',
  'payslip': 'minimal',
  'po': 'full',
  'embroidery-vendor': 'full',
  'sublimation-vendor': 'full',
  'qc-report': 'full',
  'placement-sheet': 'full'
};

/* Urdu footer tail, keyed by the English documentType label so each
   variant gets the right phrase (not a hardcoded "Production Order").
   Falls back to a generic "internal use only" for unmapped types. */
const _PRINT_FOOTER_UR = 'پروڈکشن آرڈر — صرف اندرونی استعمال'; // Production Order (default/legacy)
const _PRINT_FOOTER_UR_BY_TYPE = {
  'Production Order': 'پروڈکشن آرڈر — صرف اندرونی استعمال',
  'Gate Pass': 'گیٹ پاس — صرف اندرونی استعمال'
};
function _footerUr(docType) {
  return _PRINT_FOOTER_UR_BY_TYPE[docType] || 'صرف اندرونی استعمال';
}

/* Self-hosted font manifest, split so the heavy Urdu TTF is only ever
   fetched when a document actually needs it. style values match jsPDF
   addFont() styles. */
const _PRINT_FONT_FILES_CORE = [
  { vfs: 'Aptos-Regular.ttf',        family: PRINT_FONTS.bodyRegular, style: 'normal',     url: '/assets/fonts/Aptos-Regular.ttf' },
  { vfs: 'Aptos-Bold.ttf',           family: PRINT_FONTS.bodyRegular, style: 'bold',       url: '/assets/fonts/Aptos-Bold.ttf' },
  { vfs: 'Aptos-Italic.ttf',         family: PRINT_FONTS.bodyRegular, style: 'italic',     url: '/assets/fonts/Aptos-Italic.ttf' },
  { vfs: 'Aptos-BoldItalic.ttf',     family: PRINT_FONTS.bodyRegular, style: 'bolditalic', url: '/assets/fonts/Aptos-BoldItalic.ttf' },
  { vfs: 'AptosDisplay-Regular.ttf', family: PRINT_FONTS.display,     style: 'normal',     url: '/assets/fonts/AptosDisplay-Regular.ttf' },
  { vfs: 'AptosDisplay-Bold.ttf',    family: PRINT_FONTS.display,     style: 'bold',       url: '/assets/fonts/AptosDisplay-Bold.ttf' }
];
/* ~10 MB — fetched + embedded ONLY when urduLevel === 'full'. */
const _PRINT_FONT_FILES_URDU = [
  { vfs: 'JameelNooriNastaleeq-Regular.ttf', family: PRINT_FONTS.urdu, style: 'normal', url: '/assets/fonts/JameelNooriNastaleeq-Regular.ttf' },
  { vfs: 'JameelNooriNastaleeq-Bold.ttf',    family: PRINT_FONTS.urdu, style: 'bold',   url: '/assets/fonts/JameelNooriNastaleeq-Bold.ttf' }
];

let _fontCacheCore = null; // [{...,ok,base64}] — Aptos, fetched once
let _fontCacheUrdu = null; // [{...,ok,base64}] — JNN, fetched once, lazily

/* hex '#RRGGBB' → [r,g,b] ints. */
function _pc(hex) {
  const h = String(hex || '#000000').replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0
  ];
}

/* ArrayBuffer → base64 (chunked to avoid call-stack limits). */
function _ab2b64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

/* True only for a real sfnt (TTF/OTF) signature jsPDF can embed.
   Rejects our text placeholders, WOFF/WOFF2, HTML error pages, etc. */
function _isValidSfnt(bytes) {
  if (!bytes || bytes.length < 4) return false;
  const b = bytes;
  const u32 = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  if (u32 === 0x00010000) return true;                 // TrueType
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  return tag === 'true' || tag === 'typ1' || tag === 'OTTO' || tag === 'ttcf';
}

/* Fetch + validate one manifest. Best-effort: a missing/placeholder file is
   marked ok:false so that family/style falls back to Helvetica. */
async function _fetchFontSet(manifest) {
  try {
    return await Promise.all(manifest.map(async (f) => {
      try {
        const r = await fetch(f.url, { cache: 'force-cache' });
        if (!r.ok) return Object.assign({}, f, { ok: false });
        const buf = await r.arrayBuffer();
        const bytes = new Uint8Array(buf);
        if (bytes.length < 2048 || !_isValidSfnt(bytes)) {
          return Object.assign({}, f, { ok: false });
        }
        return Object.assign({}, f, { ok: true, base64: _ab2b64(buf) });
      } catch (e) {
        return Object.assign({}, f, { ok: false });
      }
    }));
  } catch (e) {
    return manifest.map((f) => Object.assign({}, f, { ok: false }));
  }
}

/**
 * Ensure fonts are loaded + cached. Core (Aptos) is always loaded once. The
 * heavy Urdu TTF is fetched (and cached) ONLY when `includeUrdu` is true —
 * this is the whole point of conditional embedding: a 'minimal'/'none'
 * document never triggers the ~10 MB JNN download or embed.
 * @param {boolean} includeUrdu
 * @returns {Promise<{embedded:boolean, urduEmbedded:boolean, files:Array}>}
 */
async function _ensurePrintFonts(includeUrdu) {
  if (!_fontCacheCore) {
    _fontCacheCore = await _fetchFontSet(_PRINT_FONT_FILES_CORE);
    if (!_fontCacheCore.some((f) => f.ok)) {
      console.warn(
        '[print-engine] Custom fonts unavailable (placeholders or unreachable) — ' +
        'PDFs will use Helvetica. See /assets/fonts/FONT_INSTALL.md.'
      );
    }
  }
  let files = _fontCacheCore.slice();
  let urduEmbedded = false;
  if (includeUrdu) {
    if (!_fontCacheUrdu) _fontCacheUrdu = await _fetchFontSet(_PRINT_FONT_FILES_URDU);
    files = files.concat(_fontCacheUrdu);
    urduEmbedded = _fontCacheUrdu.some((f) => f.ok);
  }
  return { embedded: files.some((f) => f.ok), urduEmbedded: urduEmbedded, files: files };
}

/* Whether real Urdu (JNN) is embedded on this doc. Components consult this to
   decide whether to draw their Urdu side at all (never draw Urdu in
   Helvetica — that produces tofu). */
function _urduOn(doc) {
  return !!(doc && doc.__groovyUrdu);
}

/* Write a lightweight interim page into the pre-opened preview tab so it is
   never a stark about:blank while the (possibly slow, bilingual) PDF is
   generated. Best-effort; ignored if the blank window isn't writable. */
function _previewLoading(win, label) {
  if (!win) return;
  try {
    win.document.open();
    win.document.write(
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>' + label + ' — generating…</title><style>' +
      'html,body{height:100%;margin:0}' +
      'body{display:flex;align-items:center;justify-content:center;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'background:#F4F4F4;color:#111}.b{text-align:center;padding:24px}' +
      '.s{width:34px;height:34px;border:3px solid #ccc;border-top-color:#111;' +
      'border-radius:50%;margin:0 auto 14px;animation:r .8s linear infinite}' +
      '@keyframes r{to{transform:rotate(360deg)}}' +
      '.t{font-size:15px;font-weight:600}.h{font-size:12px;color:#6B6B6B;margin-top:6px}' +
      '</style></head><body><div class="b"><div class="s"></div>' +
      '<div class="t">Generating ' + label + ' PDF…</div>' +
      '<div class="h">Bilingual documents embed a large Urdu font — ' +
      'this can take a few seconds.</div></div></body></html>'
    );
    win.document.close();
  } catch (e) { /* not writable in some browsers — leave as-is */ }
}

/* Replace the preview tab with a readable error instead of a blank/closed
   tab when generation fails. */
function _previewError(win, msg) {
  if (!win) return;
  const safe = String(msg == null ? '' : msg).replace(/[<>&]/g, '');
  try {
    win.document.open();
    win.document.write(
      '<!doctype html><meta charset="utf-8">' +
      '<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
      'padding:24px;color:#7B1F2A"><h3 style="margin:0 0 8px">' +
      'PDF generation failed</h3><div style="color:#111;font-size:13px">' +
      safe + '</div><div style="color:#6B6B6B;font-size:12px;margin-top:10px">' +
      'Close this tab and retry. If it persists, report it.</div></body>'
    );
    win.document.close();
  } catch (e) {
    try { win.close(); } catch (e2) { /* noop */ }
  }
}

/* Register fetched fonts onto this jsPDF instance; build the resolver map.
   Logical family → actual jsPDF font name (Helvetica when not embedded). */
function _registerFonts(doc, fontState) {
  const map = {};
  map[PRINT_FONTS.bodyRegular] = 'helvetica';
  map[PRINT_FONTS.display] = 'helvetica';
  map[PRINT_FONTS.urdu] = 'helvetica';
  if (fontState && fontState.embedded) {
    fontState.files.forEach((f) => {
      if (!f.ok) return;
      try {
        doc.addFileToVFS(f.vfs, f.base64);
        doc.addFont(f.vfs, f.family, f.style);
        map[f.family] = f.family;
      } catch (e) { /* keep Helvetica fallback for this family */ }
    });
  }
  return map;
}

/* Resolve a logical PRINT_FONTS family to the real jsPDF font name. */
function _resolveFont(doc, logical) {
  const m = doc && doc.__groovyFonts;
  return (m && m[logical]) || 'helvetica';
}

/* Set font+style+size+colour in one call. style: normal|bold|italic|bolditalic.
   Helvetica supports all four, so the fallback path is safe. */
function _setFont(doc, logical, style, size, hexColor) {
  doc.setFont(_resolveFont(doc, logical), style || 'normal');
  if (size != null) doc.setFontSize(size);
  if (hexColor) {
    const c = _pc(hexColor);
    doc.setTextColor(c[0], c[1], c[2]);
  }
}

/* ── PART 3 — Shared internal components ───────────────────────────────────
   NOT exposed globally. Variant builders (added later) compose these. Every
   component returns the Y position just below what it drew and also updates
   doc.__groovyY so callers can chain without tracking Y manually. */

/**
 * Standard document header.
 * "GROOVY" (Aptos Display 22pt bold, left) + document type (Aptos 11pt grey)
 * on the left; document number (Aptos Display 16pt bold) + "Created: … by …"
 * (Aptos 9pt grey) right-aligned; a 0.5pt #CCCCCC rule below with 6pt of
 * breathing room above and below it.
 * @param {jsPDF} doc
 * @param {{documentType:string, documentNumber:string,
 *          issuedDate:string, issuedBy:string}} o
 * @returns {number} Y just below the header rule.
 */
function _renderHeader(doc, o) {
  o = o || {};
  const L = PRINT_LAYOUT.marginLeft;
  const R = PRINT_LAYOUT.pageWidth - PRINT_LAYOUT.marginRight;
  let top = PRINT_LAYOUT.marginTop;

  _setFont(doc, PRINT_FONTS.display, 'bold', PRINT_SIZES.hero, PRINT_COLORS.black);
  doc.text('GROOVY', L, top + 16);

  if (o.documentNumber) {
    _setFont(doc, PRINT_FONTS.display, 'bold', 16, PRINT_COLORS.black);
    doc.text(String(o.documentNumber), R, top + 14, { align: 'right' });
  }

  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.greyAccent);
  doc.text(String(o.documentType || 'Document'), L, top + 32);

  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 9, PRINT_COLORS.greyAccent);
  const created = 'Created: ' + (o.issuedDate || '—') + ' by ' + (o.issuedBy || '—');
  doc.text(created, R, top + 30, { align: 'right' });

  const ruleY = top + 38 + 6; // 6pt spacing above the rule
  const c = _pc(PRINT_COLORS.greyLine);
  doc.setDrawColor(c[0], c[1], c[2]);
  doc.setLineWidth(0.5);
  doc.line(L, ruleY, R, ruleY);

  const y = ruleY + 6; // 6pt spacing below the rule
  doc.__groovyY = y;
  return y;
}

/**
 * Per-page footer. Called for every page by _stampFooters() after the body is
 * laid out so it can show the correct total page count. Positioned 36pt from
 * the bottom. Left: "Page n of m" (Aptos 8pt grey). Right: the bilingual
 * confidentiality line, Latin in Aptos 8pt grey + the Urdu tail in Jameel
 * Noori Nastaleeq, right-aligned to the right margin.
 * @param {jsPDF} doc
 * @param {number} pageNum  1-based current page.
 * @param {number} totalPages
 * @returns {number} the footer baseline Y.
 */
function _renderFooter(doc, pageNum, totalPages) {
  const L = PRINT_LAYOUT.marginLeft;
  const R = PRINT_LAYOUT.pageWidth - PRINT_LAYOUT.marginRight;
  const y = PRINT_LAYOUT.pageHeight - 36;
  const dt = doc.__groovyDocType || 'Document';

  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.footer, PRINT_COLORS.greyAccent);
  doc.text('Page ' + pageNum + ' of ' + totalPages, L, y);

  if (_urduOn(doc)) {
    // Bilingual: Urdu tail right-aligned, Latin part ending just left of it.
    const urTail = _footerUr(dt);
    _setFont(doc, PRINT_FONTS.urdu, 'normal', PRINT_SIZES.footer, PRINT_COLORS.greyAccent);
    let urW = 0;
    try { urW = doc.getTextWidth(urTail); } catch (e) { urW = 0; }
    doc.text(urTail, R, y, { align: 'right' });
    const latin = 'GROOVY · ' + dt + ' · Internal Use Only · Confidential | ';
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.footer, PRINT_COLORS.greyAccent);
    doc.text(latin, R - urW, y, { align: 'right' });
  } else {
    // English-only — clean, no tofu, no trailing separator.
    const latin = 'GROOVY · ' + dt + ' · Internal Use Only · Confidential';
    doc.text(latin, R, y, { align: 'right' });
  }
  return y;
}

/**
 * Full-width section band: light-grey background, English title in Aptos
 * Display 12pt bold UPPERCASE, then " — " and the Urdu title in Jameel Noori
 * Nastaleeq 11pt, with an optional owner name (Aptos 10pt bold) flushed
 * right. 10pt margin above the block, 8pt vertical padding inside it.
 * Uses doc.__groovyY as the starting Y (no startY arg in the spec signature).
 * @param {jsPDF} doc
 * @param {{titleEn:string, titleUr?:string, ownerName?:string}} o
 * @returns {number} Y just below the band.
 */
function _renderSectionHeader(doc, o) {
  o = o || {};
  const L = PRINT_LAYOUT.marginLeft;
  const W = PRINT_LAYOUT.contentWidth;
  const startY = (doc.__groovyY || PRINT_LAYOUT.marginTop) + 10; // 10pt margin above
  const pad = 8;
  const bandH = pad + 14 + pad;

  const bg = _pc(PRINT_COLORS.greyShade);
  doc.setFillColor(bg[0], bg[1], bg[2]);
  doc.rect(L, startY, W, bandH, 'F');

  const textY = startY + pad + 11;
  _setFont(doc, PRINT_FONTS.display, 'bold', PRINT_SIZES.subsectionTitle, PRINT_COLORS.text);
  const en = String(o.titleEn || '').toUpperCase();
  doc.text(en, L + pad, textY);
  let x = L + pad + (en ? doc.getTextWidth(en) : 0);

  if (o.titleUr && _urduOn(doc)) {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.subsectionTitle, PRINT_COLORS.text);
    doc.text('  —  ', x, textY);
    x += doc.getTextWidth('  —  ');
    _setFont(doc, PRINT_FONTS.urdu, 'normal', 11, PRINT_COLORS.text);
    doc.text(String(o.titleUr), x, textY);
  }

  if (o.ownerName) {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, PRINT_COLORS.text);
    doc.text(String(o.ownerName), L + W - pad, textY, { align: 'right' });
  }

  const y = startY + bandH;
  doc.__groovyY = y;
  return y;
}

/**
 * Inline bilingual label rendered as `{en} / {ur}` on one line: English in
 * Aptos bold at `fontSize`, Urdu in Jameel Noori Nastaleeq at `fontSize - 1`.
 * @param {jsPDF} doc
 * @param {{en:string, ur:string, x:number, y:number, fontSize:number}} o
 * @returns {number} the total horizontal width consumed (so the caller can
 *                   position whatever comes next on the same line).
 */
function _renderBilingualLabel(doc, o) {
  o = o || {};
  const fs = o.fontSize || PRINT_SIZES.body;
  let x = o.x || PRINT_LAYOUT.marginLeft;
  const startX = x;
  const y = o.y || (doc.__groovyY || PRINT_LAYOUT.marginTop);

  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', fs, PRINT_COLORS.text);
  const en = String(o.en || '');
  doc.text(en, x, y);
  x += doc.getTextWidth(en);

  // Urdu side only when JNN is embedded; otherwise English-only (no tofu).
  if (o.ur && _urduOn(doc)) {
    const sep = ' / ';
    doc.text(sep, x, y);
    x += doc.getTextWidth(sep);
    _setFont(doc, PRINT_FONTS.urdu, 'normal', Math.max(1, fs - 1), PRINT_COLORS.text);
    const ur = String(o.ur);
    doc.text(ur, x, y);
    x += doc.getTextWidth(ur);
  }

  return x - startX;
}

/**
 * Two- or four-column info table.
 * rows: array of either
 *   { labelEn, labelUr, value }                                   (1 pair)
 * or
 *   { labelEn, labelUr, value, labelEn2, labelUr2, value2 }        (2 pairs)
 * Thin grey borders (#CCCCCC, 0.25pt). Label cells get a #F9F9F9 shade with
 * the English label in Aptos bold and the Urdu label in JNN beneath it; value
 * cells are white with Aptos regular 11pt. 6pt cell padding.
 * @param {jsPDF} doc
 * @param {{rows:Array, startY:number, columnWidths?:number[]}} o
 * @returns {number} Y just below the table.
 */
function _renderInfoTable(doc, o) {
  o = o || {};
  const rows = o.rows || [];
  const L = PRINT_LAYOUT.marginLeft;
  const W = PRINT_LAYOUT.contentWidth;
  let y = o.startY != null ? o.startY : (doc.__groovyY || PRINT_LAYOUT.marginTop);
  const pad = 6;
  const twoPair = rows.some((r) => r && (r.labelEn2 != null || r.value2 != null));
  const cw = (o.columnWidths && o.columnWidths.length)
    ? o.columnWidths
    : (twoPair ? [W * 0.18, W * 0.32, W * 0.18, W * 0.32] : [W * 0.30, W * 0.70]);
  const rowH = pad + 11 + 3 + 9 + pad; // En line + gap + Ur line + padding
  const line = _pc(PRINT_COLORS.greyLine);
  const shade = _pc(PRINT_COLORS.greyShadeLight);
  const white = _pc(PRINT_COLORS.white);

  const cell = (x, w, isLabel, labelEn, labelUr, value) => {
    if (isLabel) doc.setFillColor(shade[0], shade[1], shade[2]);
    else doc.setFillColor(white[0], white[1], white[2]);
    doc.rect(x, y, w, rowH, 'F');
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(0.25);
    doc.rect(x, y, w, rowH, 'S');
    if (isLabel) {
      _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, PRINT_COLORS.text);
      doc.text(String(labelEn || ''), x + pad, y + pad + 9, {
        maxWidth: w - pad * 2
      });
      if (labelUr && _urduOn(doc)) {
        _setFont(doc, PRINT_FONTS.urdu, 'normal', PRINT_SIZES.urduSmall, PRINT_COLORS.greyAccent);
        doc.text(String(labelUr), x + pad, y + pad + 9 + 12, { maxWidth: w - pad * 2 });
      }
    } else {
      _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
      doc.text(String(value == null ? '' : value), x + pad, y + pad + 10, {
        maxWidth: w - pad * 2
      });
    }
  };

  rows.forEach((r) => {
    if (y + rowH > PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginBottom - 24) {
      doc.addPage();
      y = PRINT_LAYOUT.marginTop;
    }
    let x = L;
    cell(x, cw[0], true, r.labelEn, r.labelUr); x += cw[0];
    cell(x, cw[1], false, null, null, r.value); x += cw[1];
    if (twoPair) {
      cell(x, cw[2] || cw[0], true, r.labelEn2, r.labelUr2); x += (cw[2] || cw[0]);
      cell(x, cw[3] || cw[1], false, null, null, r.value2);
    }
    y += rowH;
  });

  doc.__groovyY = y;
  return y;
}

/**
 * Signature line: `Signature: ____________  Name: {name} ({roleEn} / {roleUr})`
 * in Aptos 11pt regular with the role names bold and the Urdu role in JNN.
 * Leaves 24pt of vertical space above the line.
 * @param {jsPDF} doc
 * @param {{roleEn:string, roleUr:string, name?:string, startY:number}} o
 * @returns {number} Y just below the signature line.
 */
function _renderSignatureRow(doc, o) {
  o = o || {};
  const L = PRINT_LAYOUT.marginLeft;
  const y = (o.startY != null ? o.startY : (doc.__groovyY || PRINT_LAYOUT.marginTop)) + 24;
  let x = L;

  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
  const sig = 'Signature: ________________     Name: ' + (o.name || '________________') + '   (';
  doc.text(sig, x, y);
  x += doc.getTextWidth(sig);

  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.body, PRINT_COLORS.text);
  const re = String(o.roleEn || '');
  doc.text(re, x, y);
  x += doc.getTextWidth(re);

  if (o.roleUr && _urduOn(doc)) {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
    doc.text(' / ', x, y);
    x += doc.getTextWidth(' / ');
    _setFont(doc, PRINT_FONTS.urdu, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
    const ru = String(o.roleUr);
    doc.text(ru, x, y);
    x += doc.getTextWidth(ru);
  }

  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
  doc.text(')', x, y);

  doc.__groovyY = y;
  return y;
}

/**
 * Thin grey horizontal rule (0.5pt #CCCCCC) at Y, with 8pt of space above
 * and below.
 * @param {jsPDF} doc
 * @param {number} y
 * @returns {number} Y just below the divider (y + 8 + 8).
 */
function _renderDivider(doc, y) {
  const L = PRINT_LAYOUT.marginLeft;
  const R = PRINT_LAYOUT.pageWidth - PRINT_LAYOUT.marginRight;
  const ruleY = (y != null ? y : (doc.__groovyY || PRINT_LAYOUT.marginTop)) + 8;
  const c = _pc(PRINT_COLORS.greyLine);
  doc.setDrawColor(c[0], c[1], c[2]);
  doc.setLineWidth(0.5);
  doc.line(L, ruleY, R, ruleY);
  const out = ruleY + 8;
  doc.__groovyY = out;
  return out;
}

/**
 * Hero title block (used when a big title sits below the standard header,
 * e.g. "Complexity Tiers Framework"): title in Aptos Display 22pt bold,
 * subtitle below in Aptos 11pt regular grey.
 * @param {jsPDF} doc
 * @param {{title:string, subtitle?:string, startY:number}} o
 * @returns {number} Y just below the block.
 */
function _renderTitleBlock(doc, o) {
  o = o || {};
  const L = PRINT_LAYOUT.marginLeft;
  let y = (o.startY != null ? o.startY : (doc.__groovyY || PRINT_LAYOUT.marginTop)) + 10;

  _setFont(doc, PRINT_FONTS.display, 'bold', PRINT_SIZES.hero, PRINT_COLORS.text);
  doc.text(String(o.title || ''), L, y + 18);
  y += 26;

  if (o.subtitle) {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.greyAccent);
    doc.text(String(o.subtitle), L, y + 6);
    y += 16;
  }

  doc.__groovyY = y;
  return y;
}

/* ── Footer stamping (every page, after layout) ─────────────────────────── */
function _stampFooters(doc) {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    _renderFooter(doc, p, total);
  }
}

/* ── Generic fallback renderer ─────────────────────────────────────────────
   Minimal sheet: standard header + optional hero title block + body text.
   data.bodyHtml is rendered as plain text (tags stripped, block tags →
   line breaks) since jsPDF has no DOM renderer here. Paginates long bodies;
   footers are stamped on every page afterwards. */
function _stripHtml(html) {
  if (html == null) return '';
  let s = String(html);
  s = s.replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*>/gi, '\n');
  s = s.replace(/<\s*li[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
       .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function _renderGeneric(doc, data) {
  data = data || {};
  let sess = (typeof session !== 'undefined' && session) ? session : null;
  const today = new Date().toLocaleDateString('en-GB');

  _renderHeader(doc, {
    documentType: doc.__groovyDocType || 'Document',
    documentNumber: data.documentNumber || data.id || '',
    issuedDate: data.issuedDate || today,
    issuedBy: data.issuedBy || (sess && sess.name) || 'system'
  });

  if (data.title) {
    _renderTitleBlock(doc, {
      title: data.title,
      subtitle: data.subtitle || '',
      startY: doc.__groovyY
    });
  }

  const body = _stripHtml(data.bodyHtml);
  let y = (doc.__groovyY || PRINT_LAYOUT.marginTop) + 14;
  if (body) {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
    const maxY = PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginBottom - 28;
    const lineH = 16;
    body.split('\n').forEach((para) => {
      if (para.trim() === '') { y += lineH * 0.6; return; }
      const lines = doc.splitTextToSize(para, PRINT_LAYOUT.contentWidth);
      lines.forEach((ln) => {
        if (y > maxY) { doc.addPage(); y = PRINT_LAYOUT.marginTop + 8; }
        doc.text(ln, PRINT_LAYOUT.marginLeft, y);
        y += lineH;
      });
    });
  } else {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.greyAccent);
    doc.text('(No body content provided.)', PRINT_LAYOUT.marginLeft, y);
  }
  doc.__groovyY = y;
}

/* ── Gate Pass variant ─────────────────────────────────────────────────────
   Single-page bilingual transit document. Composes the shared components
   (_renderHeader / _renderInfoTable / _renderSectionHeader /
   _renderBilingualLabel / _renderFooter via _stampFooters) plus a few
   bespoke blocks (type banner, items table, signature boxes). Requires
   urduLevel 'full' (forced in printDocument for this type). */

function _gpTo12(h, mi) {
  const ap = h >= 12 ? 'PM' : 'AM';
  let hh = h % 12; if (hh === 0) hh = 12;
  return hh + ':' + String(mi).padStart(2, '0') + ' ' + ap;
}
/* Tolerant DD - MM - YYYY formatter; unparseable → original; empty → em-dash. */
function _gpFmtDate(v) {
  if (v == null || v === '') return '—';
  let d = null, m;
  if (v instanceof Date) d = v;
  else {
    const s = String(v).trim();
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) d = new Date(+m[1], +m[2] - 1, +m[3]);
    else if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) d = new Date(+m[3], +m[2] - 1, +m[1]);
    else { const t = Date.parse(s); if (!isNaN(t)) d = new Date(t); }
  }
  if (!d || isNaN(d.getTime())) return String(v);
  return String(d.getDate()).padStart(2, '0') + ' - ' +
    String(d.getMonth() + 1).padStart(2, '0') + ' - ' + d.getFullYear();
}
/* Tolerant 12-hour formatter; already-12h passes through; empty → em-dash. */
function _gpFmtTime(v) {
  if (v == null || v === '') return '—';
  const s = String(v).trim();
  if (/[ap]\.?\s?m/i.test(s)) return s;
  let m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return _gpTo12(+m[1], +m[2]);
  const t = Date.parse(s);
  if (!isNaN(t)) { const d = new Date(t); return _gpTo12(d.getHours(), d.getMinutes()); }
  return String(v);
}
/* Transit-type → bilingual labels. Unknown/garments → outward (per spec). */
function _gpTypeLabels(t) {
  switch (String(t || '').toLowerCase()) {
    case 'returns':
      return { en: 'GATE PASS — RETURNS', ur: 'گیٹ پاس — واپسی', word: 'Returns' };
    case 'fabric-in': case 'fabric_in': case 'fabric':
      return { en: 'GATE PASS — FABRIC-IN', ur: 'گیٹ پاس — کپڑے کی آمد', word: 'Fabric-in' };
    case 'outward': case 'garments': default:
      return { en: 'GATE PASS — OUTWARD', ur: 'گیٹ پاس — باہر', word: 'Outward' };
  }
}
function _gpDash(v) {
  return (v == null || String(v).trim() === '') ? '—' : String(v);
}

/**
 * Render the Gate Pass variant.
 * @param {jsPDF} doc
 * @param {object} data  the gate-pass record (+ documentType/documentNumber/
 *                       id/issuedBy meta added by the caller's guard).
 */
function _renderGatePass(doc, data) {
  data = data || {};
  const L = PRINT_LAYOUT.marginLeft;
  const W = PRINT_LAYOUT.contentWidth;
  const R = L + W;
  const sess = (typeof session !== 'undefined' && session) ? session : null;
  const line = _pc(PRINT_COLORS.greyLine);
  const shade = _pc(PRINT_COLORS.greyShade);

  const issuedBy = _gpDash(data.issuedBy || data.issuer || data.name);
  // 1) HEADER
  _renderHeader(doc, {
    documentType: 'Gate Pass',
    documentNumber: data.documentNumber || data.id || '',
    issuedDate: data.date ? _gpFmtDate(data.date) : new Date().toLocaleDateString('en-GB'),
    issuedBy: (issuedBy === '—' && sess) ? sess.name : issuedBy
  });

  // 2) TYPE BANNER — full-width grey, centred bilingual
  const tl = _gpTypeLabels(data.gpType);
  let y = (doc.__groovyY || PRINT_LAYOUT.marginTop) + 12;
  const bPad = 10, bandH = bPad + 16 + bPad;
  doc.setFillColor(shade[0], shade[1], shade[2]);
  doc.rect(L, y, W, bandH, 'F');
  const baseY = y + bPad + 13;
  _setFont(doc, PRINT_FONTS.display, 'bold', PRINT_SIZES.sectionTitle, PRINT_COLORS.text);
  const enW = doc.getTextWidth(tl.en);
  const sep = '  —  ';
  const sepW = doc.getTextWidth(sep);
  _setFont(doc, PRINT_FONTS.urdu, 'normal', 12, PRINT_COLORS.text);
  const urW = _urduOn(doc) ? doc.getTextWidth(tl.ur) : 0;
  const totalW = enW + (_urduOn(doc) ? sepW + urW : 0);
  let bx = L + (W - totalW) / 2;
  _setFont(doc, PRINT_FONTS.display, 'bold', PRINT_SIZES.sectionTitle, PRINT_COLORS.text);
  doc.text(tl.en, bx, baseY);
  bx += enW;
  if (_urduOn(doc)) {
    _setFont(doc, PRINT_FONTS.display, 'bold', PRINT_SIZES.sectionTitle, PRINT_COLORS.text);
    doc.text(sep, bx, baseY);
    bx += sepW;
    _setFont(doc, PRINT_FONTS.urdu, 'normal', 12, PRINT_COLORS.text);
    doc.text(tl.ur, bx, baseY);
  }
  doc.__groovyY = y + bandH;

  // 3) SECTION 1 — IDENTITY TABLE
  _renderInfoTable(doc, {
    startY: doc.__groovyY + 12,
    rows: [
      { labelEn: 'Date', labelUr: 'تاریخ', value: _gpFmtDate(data.date) },
      { labelEn: 'Time', labelUr: 'وقت', value: _gpFmtTime(data.time) },
      { labelEn: 'Type', labelUr: 'قسم', value: tl.word },
      { labelEn: 'Person', labelUr: 'شخص', value: _gpDash(data.person || data.recipientName || data.name) },
      { labelEn: 'Destination', labelUr: 'منزل', value: _gpDash(data.destination || data.dest) },
      { labelEn: 'Purpose', labelUr: 'مقصد', value: _gpDash(data.purpose) }
    ]
  });

  // 4) SECTION 2 — ITEMS
  _renderSectionHeader(doc, { titleEn: 'ITEMS', titleUr: 'اشیاء' });
  const cols = [
    { en: '#', ur: '', w: 28 },
    { en: 'Article', ur: 'مضمون', w: 207 },
    { en: 'Spec', ur: '', w: 120 },
    { en: 'Units', ur: 'مقدار', w: 84 },
    { en: 'Weight', ur: 'وزن', w: 84 }
  ];
  const items = Array.isArray(data.items) ? data.items : [];
  const hdrH = 30, rowH = 22;
  const maxY = PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginBottom - 28;

  const drawItemsHeader = (yy) => {
    doc.setFillColor(shade[0], shade[1], shade[2]);
    doc.rect(L, yy, W, hdrH, 'F');
    let cx = L;
    cols.forEach((c) => {
      doc.setDrawColor(line[0], line[1], line[2]);
      doc.setLineWidth(0.25);
      doc.rect(cx, yy, c.w, hdrH, 'S');
      _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, PRINT_COLORS.text);
      doc.text(c.en, cx + 5, yy + 12, { maxWidth: c.w - 8 });
      if (c.ur && _urduOn(doc)) {
        _setFont(doc, PRINT_FONTS.urdu, 'normal', 9, PRINT_COLORS.greyAccent);
        doc.text(c.ur, cx + 5, yy + 24, { maxWidth: c.w - 8 });
      }
      cx += c.w;
    });
    return yy + hdrH;
  };

  let ty = drawItemsHeader(doc.__groovyY + 4);
  const drawRow = (cells) => {
    if (ty + rowH > maxY) { doc.addPage(); ty = drawItemsHeader(PRINT_LAYOUT.marginTop); }
    let cx = L;
    cols.forEach((c, i) => {
      doc.setDrawColor(line[0], line[1], line[2]);
      doc.setLineWidth(0.25);
      doc.rect(cx, ty, c.w, rowH, 'S');
      _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.bodySmall, PRINT_COLORS.text);
      const v = cells[i];
      if (v != null && v !== '') doc.text(String(v), cx + 5, ty + 14, { maxWidth: c.w - 8 });
      cx += c.w;
    });
    ty += rowH;
  };

  if (items.length) {
    items.forEach((it, idx) => {
      drawRow([
        idx + 1,
        _gpDash(it.article || data.article),
        _gpDash(it.spec || it.size || data.spec),
        _gpDash(it.units),
        _gpDash(it.weight)
      ]);
    });
  } else {
    for (let i = 0; i < 4; i++) drawRow([i + 1, '', '', '', '']);
  }
  doc.__groovyY = ty;

  // 5) SECTION 3 — REMARKS
  _renderSectionHeader(doc, { titleEn: 'REMARKS', titleUr: 'تبصرہ' });
  let ry = doc.__groovyY + 8;
  const remarks = data.remarks || data.notes;
  if (remarks && String(remarks).trim()) {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
    const lines = doc.splitTextToSize(String(remarks).trim(), W);
    lines.forEach((ln) => {
      if (ry > maxY) { doc.addPage(); ry = PRINT_LAYOUT.marginTop; }
      doc.text(ln, L, ry); ry += 15;
    });
  } else {
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(0.5);
    for (let i = 0; i < 3; i++) { ry += 16; doc.line(L, ry, R, ry); }
    ry += 6;
  }
  doc.__groovyY = ry;

  // 6) SECTION 4 — SIGNATURE BLOCKS
  const blockGap = 6;
  const blockW = (W - blockGap) / 2;
  const blockH = 96;
  let sy = doc.__groovyY + 12;
  if (sy + blockH + 70 > PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginBottom) {
    doc.addPage(); sy = PRINT_LAYOUT.marginTop;
  }

  const drawSigBlock = (bxx, byy, headEn, headUr, nameVal) => {
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(0.5);
    doc.rect(bxx, byy, blockW, blockH, 'S');
    const pad = 12;
    _renderBilingualLabel(doc, { en: headEn, ur: headUr, x: bxx + pad, y: byy + pad + 9, fontSize: 11 });
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.bodySmall, PRINT_COLORS.text);
    doc.text('Name: ' + (nameVal && nameVal !== '—' ? nameVal : '________________'), bxx + pad, byy + pad + 33);
    doc.text('Signature: ________________', bxx + pad, byy + pad + 53);
    doc.text('Date: ________________', bxx + pad, byy + pad + 73);
  };
  drawSigBlock(L, sy, 'Issued by', 'جاری کردہ', issuedBy);
  drawSigBlock(L + blockW + blockGap, sy, 'Received by', 'وصول کنندہ', null);

  // Gate guard — centred 60% box
  const gW = W * 0.6;
  const gx = L + (W - gW) / 2;
  const gy = sy + blockH + 12;
  const gH = 58;
  doc.setDrawColor(line[0], line[1], line[2]);
  doc.setLineWidth(0.5);
  doc.rect(gx, gy, gW, gH, 'S');
  _renderBilingualLabel(doc, { en: 'Gate Guard Sign', ur: 'گیٹ گارڈ کے دستخط', x: gx + 12, y: gy + 21, fontSize: 11 });
  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.bodySmall, PRINT_COLORS.greyAccent);
  doc.text('Signature: ________________     Time: ________', gx + 12, gy + 43);
  doc.__groovyY = gy + gH;
}

/* ── PART 2 — Public API ───────────────────────────────────────────────────
   The ONLY global this engine exposes. */
window.printDocument = async function (opts) {
  opts = opts || {};
  const type = opts.type || 'generic';
  const data = opts.data || {};

  if (!window.jspdf || !window.jspdf.jsPDF) {
    console.error('[print-engine] jsPDF not loaded.');
    if (typeof showToast === 'function') showToast('PDF library not loaded yet, retry in a moment.', true);
    return;
  }

  const known = ['po', 'embroidery-vendor', 'sublimation-vendor',
    'gate-pass', 'placement-sheet', 'qc-report', 'generic'];
  const _VARIANTS = { 'gate-pass': _renderGatePass };
  const render = _VARIANTS[type] || _renderGeneric;
  if (known.indexOf(type) === -1) {
    console.warn("Unknown print type '" + type + "' — falling back to generic");
  } else if (type !== 'generic' && !_VARIANTS[type]) {
    console.warn("Print variant '" + type + "' not yet implemented — falling back to generic");
  }

  // Open the preview tab synchronously NOW (before the async font fetch) so
  // it counts as part of the click gesture and isn't popup-blocked. Show an
  // interim page immediately so it's never a stark about:blank during the
  // (slow for bilingual) font fetch + subset.
  const _docLabel = data.documentType || _PRINT_DOC_LABELS[type] || 'Document';
  let previewWin = null;
  try { previewWin = window.open('', '_blank'); } catch (e) { previewWin = null; }
  _previewLoading(previewWin, _docLabel);

  // Resolve the Urdu policy: explicit data.urduLevel wins, else the per-type
  // default, else 'minimal'. Only 'full' fetches/embeds the heavy JNN TTF.
  const _levels = ['none', 'minimal', 'full'];
  let urduLevel = data.urduLevel;
  if (_levels.indexOf(urduLevel) === -1) {
    urduLevel = _PRINT_URDU_DEFAULTS[type] || 'minimal';
  }
  if (type === 'gate-pass') urduLevel = 'full'; // variant requires bilingual
  const embedUrdu = (urduLevel === 'full');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const fontState = await _ensurePrintFonts(embedUrdu);
  doc.__groovyFonts = _registerFonts(doc, fontState);
  // Real Urdu only if 'full' AND a valid JNN actually registered; if 'full'
  // was asked but JNN is unavailable, components degrade to English-only
  // (clean) rather than tofu.
  doc.__groovyUrdu = embedUrdu && fontState.urduEmbedded &&
    (doc.__groovyFonts[PRINT_FONTS.urdu] !== 'helvetica');
  doc.__groovyUrduLevel = urduLevel;
  doc.__groovyDocType = data.documentType || _PRINT_DOC_LABELS[type] || 'Document';
  doc.__groovyY = PRINT_LAYOUT.marginTop;

  try {
    render(doc, data);
    _stampFooters(doc);
  } catch (e) {
    console.error('[print-engine] render failed:', e);
    if (typeof showToast === 'function') showToast('PDF generation failed: ' + e.message, true);
    _previewError(previewWin, e.message);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const idPart = data.id || data.documentNumber || 'doc';
  const filename = opts.filename || (type + '-' + idPart + '-' + stamp + '.pdf');

  // Serialize ONCE — a 'full' (Urdu-embedded) PDF can be ~14 MB; doing it
  // twice (once for preview, once for doc.save) would double the cost.
  let blob;
  try {
    blob = doc.output('blob');
  } catch (e) {
    console.error('[print-engine] PDF serialization failed:', e);
    if (typeof showToast === 'function') showToast('PDF generation failed: ' + e.message, true);
    _previewError(previewWin, e.message);
    return;
  }

  const sizeKB = Math.max(1, Math.round(blob.size / 1024));
  console.log('[print-engine] Generated ' + type + ' PDF — urduLevel: ' +
    urduLevel + ', size: ~' + sizeKB + 'KB');

  let url = null;
  try {
    url = URL.createObjectURL(blob);
    if (previewWin && !previewWin.closed) {
      previewWin.location = url;                  // navigate the pre-opened tab
    } else {
      window.open(url, '_blank');                 // fallback (may be blocked)
    }
  } catch (e) {
    console.warn('[print-engine] could not open preview tab:', e);
    try { if (previewWin) previewWin.close(); } catch (e2) { /* noop */ }
  }
  // Download from the SAME blob (no second serialization).
  try {
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      doc.save(filename);
    }
  } catch (e) {
    try { doc.save(filename); } catch (e2) { console.error('[print-engine] download failed:', e2); }
  }
  if (url) setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  if (typeof showToast === 'function') showToast('PDF generated ✓');
};

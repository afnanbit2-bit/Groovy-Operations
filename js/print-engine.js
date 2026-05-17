/* Groovy Operations — print-engine.js
   ──────────────────────────────────────────────────────────────────────────
   FOUNDATIONAL print/PDF engine. Plain global classic script (NO modules).
   Load order (index.html): shared.js → print-engine.js → auth.js → domain → boot.

   Public API (the ONLY global it exposes):

     window.printDocument({
       type: 'po' | 'embroidery-vendor' | 'sublimation-vendor' |
             'gate-pass' | 'placement-sheet' | 'qc-report' | 'generic',
       data: { ... },                       // type-specific payload
       filename: 'optional-name.pdf'        // default: {type}-{id}-{date}.pdf
     })

   - Uses jsPDF (loaded via CDN in index.html) at point units, A4 portrait.
   - Embeds Aptos / Aptos Display / Jameel Noori Nastaleeq via addFileToVFS()
     + addFont(); if the TTFs are missing/placeholders it transparently falls
     back to Helvetica (PDF still renders, nothing breaks).
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

/* Fixed Urdu footer string per the print spec. */
const _PRINT_FOOTER_UR = 'پروڈکشن آرڈر — صرف اندرونی استعمال';

/* Self-hosted font manifest. style values match jsPDF addFont() styles. */
const _PRINT_FONT_FILES = [
  { vfs: 'Aptos-Regular.ttf',                family: PRINT_FONTS.bodyRegular, style: 'normal',     url: '/assets/fonts/Aptos-Regular.ttf' },
  { vfs: 'Aptos-Bold.ttf',                   family: PRINT_FONTS.bodyRegular, style: 'bold',       url: '/assets/fonts/Aptos-Bold.ttf' },
  { vfs: 'Aptos-Italic.ttf',                 family: PRINT_FONTS.bodyRegular, style: 'italic',     url: '/assets/fonts/Aptos-Italic.ttf' },
  { vfs: 'Aptos-BoldItalic.ttf',             family: PRINT_FONTS.bodyRegular, style: 'bolditalic', url: '/assets/fonts/Aptos-BoldItalic.ttf' },
  { vfs: 'AptosDisplay-Regular.ttf',         family: PRINT_FONTS.display,     style: 'normal',     url: '/assets/fonts/AptosDisplay-Regular.ttf' },
  { vfs: 'AptosDisplay-Bold.ttf',            family: PRINT_FONTS.display,     style: 'bold',       url: '/assets/fonts/AptosDisplay-Bold.ttf' },
  { vfs: 'JameelNooriNastaleeq-Regular.ttf', family: PRINT_FONTS.urdu,        style: 'normal',     url: '/assets/fonts/JameelNooriNastaleeq-Regular.ttf' },
  { vfs: 'JameelNooriNastaleeq-Bold.ttf',    family: PRINT_FONTS.urdu,        style: 'bold',       url: '/assets/fonts/JameelNooriNastaleeq-Bold.ttf' }
];

let _printFontCache = null; // { embedded:boolean, files:[{...,ok,base64}] }

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

/**
 * Fetch + validate the self-hosted fonts once, cache the result.
 * Best-effort and non-fatal: if a file is missing or a placeholder it is
 * marked `ok:false` and the engine renders that family in Helvetica.
 * @returns {Promise<{embedded:boolean, files:Array}>}
 */
async function _ensurePrintFonts() {
  if (_printFontCache) return _printFontCache;
  const result = { embedded: false, files: [] };
  try {
    result.files = await Promise.all(_PRINT_FONT_FILES.map(async (f) => {
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
    result.embedded = result.files.some((f) => f.ok);
  } catch (e) {
    result.files = _PRINT_FONT_FILES.map((f) => Object.assign({}, f, { ok: false }));
    result.embedded = false;
  }
  _printFontCache = result;
  if (!result.embedded) {
    console.warn(
      '[print-engine] Custom fonts unavailable (placeholders or unreachable) — ' +
      'PDFs will use Helvetica. See /assets/fonts/FONT_INSTALL.md.'
    );
  }
  return result;
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

  // Urdu tail first (measure width, right-align to margin).
  _setFont(doc, PRINT_FONTS.urdu, 'normal', PRINT_SIZES.footer, PRINT_COLORS.greyAccent);
  let urW = 0;
  try { urW = doc.getTextWidth(_PRINT_FOOTER_UR); } catch (e) { urW = 0; }
  doc.text(_PRINT_FOOTER_UR, R, y, { align: 'right' });

  // Latin part ends just left of the Urdu tail.
  const latin = 'GROOVY · ' + dt + ' · Internal Use Only · Confidential | ';
  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.footer, PRINT_COLORS.greyAccent);
  doc.text(latin, R - urW, y, { align: 'right' });
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

  if (o.titleUr) {
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

  const sep = ' / ';
  doc.text(sep, x, y);
  x += doc.getTextWidth(sep);

  _setFont(doc, PRINT_FONTS.urdu, 'normal', Math.max(1, fs - 1), PRINT_COLORS.text);
  const ur = String(o.ur || '');
  doc.text(ur, x, y);
  x += doc.getTextWidth(ur);

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
      if (labelUr) {
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

  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
  doc.text(' / ', x, y);
  x += doc.getTextWidth(' / ');

  _setFont(doc, PRINT_FONTS.urdu, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
  const ru = String(o.roleUr || '');
  doc.text(ru, x, y);
  x += doc.getTextWidth(ru);

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
  if (type !== 'generic') {
    console.warn("Print variant '" + type + "' not yet implemented — falling back to generic");
  } else if (known.indexOf(type) === -1) {
    console.warn("Unknown print type '" + type + "' — falling back to generic");
  }

  // Open the preview tab synchronously NOW (before the async font fetch) so
  // it counts as part of the click gesture and isn't popup-blocked.
  let previewWin = null;
  try { previewWin = window.open('', '_blank'); } catch (e) { previewWin = null; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const fontState = await _ensurePrintFonts();
  doc.__groovyFonts = _registerFonts(doc, fontState);
  doc.__groovyDocType = data.documentType || _PRINT_DOC_LABELS[type] || 'Document';
  doc.__groovyY = PRINT_LAYOUT.marginTop;

  try {
    // Only the generic variant exists today; every type renders generic.
    _renderGeneric(doc, data);
    _stampFooters(doc);
  } catch (e) {
    console.error('[print-engine] render failed:', e);
    if (typeof showToast === 'function') showToast('PDF generation failed: ' + e.message, true);
    try { if (previewWin) previewWin.close(); } catch (e2) { /* noop */ }
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const idPart = data.id || data.documentNumber || 'doc';
  const filename = opts.filename || (type + '-' + idPart + '-' + stamp + '.pdf');

  try {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    if (previewWin && !previewWin.closed) {
      previewWin.location = url;                  // navigate the pre-opened tab
    } else {
      window.open(url, '_blank');                 // fallback (may be blocked)
    }
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  } catch (e) {
    console.warn('[print-engine] could not open preview tab:', e);
    try { if (previewWin) previewWin.close(); } catch (e2) { /* noop */ }
  }
  try {
    doc.save(filename);                          // trigger download
  } catch (e) {
    console.error('[print-engine] download failed:', e);
  }
  if (typeof showToast === 'function') showToast('PDF generated ✓');
};

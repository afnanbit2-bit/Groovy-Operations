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
  white: '#FFFFFF',
  red: '#DC2626'   // PO notes — always rendered in this color, never the default text color
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
/* A4 LANDSCAPE, same margins — the page of a document that asks for it
   (`data.orientation: 'landscape'`, or its type's default below; Master
   Accounts' ledger, M1.4). Only printDocument ever hands it out, through
   doc.__groovyPage — see _pageBox(). */
const PRINT_LAYOUT_LANDSCAPE = {
  pageWidth: 842,
  pageHeight: 595,
  marginLeft: 36,
  marginRight: 36,
  marginTop: 36,
  marginBottom: 36,
  contentWidth: 770
};

/* Document-type → human label (footer text + default filename + fallback). */
const _PRINT_DOC_LABELS = {
  'po': 'Production Order',
  'embroidery-vendor': 'Embroidery Vendor Sheet',
  'sublimation-vendor': 'Sublimation Vendor Sheet',
  'gate-pass': 'Gate Pass',
  'placement-sheet': 'Placement Sheet',
  'qc-report': 'QC Report',
  'payslip': 'Payslip',
  'daily-performance': 'Daily Performance',
  'stock-transfer': 'Stock Transfer',
  'mood-board': 'Mood Board',
  'pattern-label': 'Pattern Label',
  'consumable-log': 'Consumable Log',
  'ma-ledger': 'Ledger',
  'ma-statement-party': 'Statement of Account',
  'ma-statement-holder': 'Holder Statement',
  'ma-receipt': 'Handover Receipt',
  'ma-voucher': 'Payment Voucher',
  'ma-collection': 'Collection Receipt',
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
  'daily-performance': 'minimal',
  'stock-transfer': 'minimal',
  'mood-board': 'minimal',
  'po': 'full',
  'embroidery-vendor': 'full',
  'sublimation-vendor': 'full',
  'qc-report': 'full',
  'placement-sheet': 'full',
  'pattern-label': 'none',
  'consumable-log': 'minimal',
  'ma-ledger': 'none',
  'ma-statement-party': 'minimal',
  'ma-statement-holder': 'none',
  'ma-receipt': 'full',
  'ma-voucher': 'full',
  'ma-collection': 'full'
};

/* Page per type, when the caller names none. The two slips a person signs
   are A5 (420×595 pt — a custom page, so they draw their own layout like the
   pattern label); the ledger's eight columns want A4 LANDSCAPE. Every other
   type is A4 portrait exactly as before. `data.page` / `data.orientation`
   still win when given. */
const _PRINT_PAGE_DEFAULTS = {
  'ma-receipt': { w: 420, h: 595 },
  'ma-voucher': { w: 420, h: 595 },
  'ma-collection': { w: 420, h: 595 }
};
const _PRINT_ORIENTATION_DEFAULTS = {
  'ma-ledger': 'landscape'
};
/* Types that lay out off _pageBox(doc) — the shared components only, or
   their own page-aware drawing — and so may be drawn landscape. Every other
   variant carries its own A4-portrait geometry and STAYS portrait whatever
   it is asked (printDocument says so in the console). The generic renderer
   also serves every known-but-unbuilt type, so it is ready by renderer. */
const _PRINT_LANDSCAPE_READY = {
  'generic': 1,
  'ma-ledger': 1,
  'ma-statement-party': 1,
  'ma-statement-holder': 1
};

/* Urdu footer tail, keyed by the English documentType label so each
   variant gets the right phrase (not a hardcoded "Production Order").
   Falls back to a generic "internal use only" for unmapped types. */
const _PRINT_FOOTER_UR = 'پروڈکشن آرڈر — صرف اندرونی استعمال'; // Production Order (default/legacy)
const _PRINT_FOOTER_UR_BY_TYPE = {
  'Production Order': 'پروڈکشن آرڈر — صرف اندرونی استعمال',
  'Gate Pass': 'گیٹ پاس — صرف اندرونی استعمال',
  'Payslip': 'پے سلپ — صرف اندرونی استعمال',
  'Handover Receipt': 'رسید — صرف اندرونی استعمال',
  'Payment Voucher': 'واؤچر — صرف اندرونی استعمال',
  'Collection Receipt': 'وصولی رسید — صرف اندرونی استعمال'
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

/* Load a (possibly remote) image URL into a data URL + intrinsic size so the
   synchronous variant renderers can addImage() it. Best-effort: resolves to
   null on CORS taint, load error, or timeout (the caller then just skips the
   image). Cloudinary serves the CORS header, so product photos load fine. */
function _loadImgDataURL(url) {
  return new Promise(function (resolve) {
    if (!url) { resolve(null); return; }
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let done = false;
      const finish = function (v) { if (!done) { done = true; resolve(v); } };
      const to = setTimeout(function () { finish(null); }, 8000);
      img.onload = function () {
        clearTimeout(to);
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          c.getContext('2d').drawImage(img, 0, 0);
          finish({ dataUrl: c.toDataURL('image/jpeg', 0.85), fmt: 'JPEG', w: c.width, h: c.height });
        } catch (e) { finish(null); }
      };
      img.onerror = function () { clearTimeout(to); finish(null); };
      img.src = url;
    } catch (e) { resolve(null); }
  });
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
      '.t{font-size:16px;font-weight:600}.h{font-size:13px;color:#6B6B6B;margin-top:6px}' +
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
      'PDF generation failed</h3><div style="color:#111;font-size:14px">' +
      safe + '</div><div style="color:#6B6B6B;font-size:13px;margin-top:10px">' +
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

/* The page the shared components lay out on. It is PRINT_LAYOUT itself —
   the same object, so the same numbers — for every A4 portrait document:
   every existing variant draws exactly as it did. Only a document
   printDocument made landscape carries doc.__groovyPage
   (PRINT_LAYOUT_LANDSCAPE), and then the header, the footer, the section
   band, the tables' page breaks and the generic body all use ITS width and
   height, never 595/842. A custom page (the pattern label, the A5 slips)
   gets no box here: those variants draw their whole page themselves. */
function _pageBox(doc) {
  return (doc && doc.__groovyPage) || PRINT_LAYOUT;
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
  const P = _pageBox(doc);
  const L = P.marginLeft;
  const R = P.pageWidth - P.marginRight;
  let top = P.marginTop;

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
  const P = _pageBox(doc);
  const L = P.marginLeft;
  const R = P.pageWidth - P.marginRight;
  const y = P.pageHeight - 36;
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
  const P = _pageBox(doc);
  const L = P.marginLeft;
  const W = P.contentWidth;
  const startY = (doc.__groovyY || P.marginTop) + 10; // 10pt margin above
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
  const P = _pageBox(doc);
  let x = o.x || P.marginLeft;
  const startX = x;
  const y = o.y || (doc.__groovyY || P.marginTop);

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
  const P = _pageBox(doc);
  const L = P.marginLeft;
  const W = P.contentWidth;
  let y = o.startY != null ? o.startY : (doc.__groovyY || P.marginTop);
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
    if (y + rowH > P.pageHeight - P.marginBottom - 24) {
      doc.addPage();
      y = P.marginTop;
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
  const P = _pageBox(doc);
  const L = P.marginLeft;
  const y = (o.startY != null ? o.startY : (doc.__groovyY || P.marginTop)) + 24;
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
  const P = _pageBox(doc);
  const L = P.marginLeft;
  const R = P.pageWidth - P.marginRight;
  const ruleY = (y != null ? y : (doc.__groovyY || P.marginTop)) + 8;
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
  const P = _pageBox(doc);
  const L = P.marginLeft;
  let y = (o.startY != null ? o.startY : (doc.__groovyY || P.marginTop)) + 10;

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
  const P = _pageBox(doc);
  let y = (doc.__groovyY || P.marginTop) + 14;
  if (body) {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
    const maxY = P.pageHeight - P.marginBottom - 28;
    const lineH = 16;
    body.split('\n').forEach((para) => {
      if (para.trim() === '') { y += lineH * 0.6; return; }
      const lines = doc.splitTextToSize(para, P.contentWidth);
      lines.forEach((ln) => {
        if (y > maxY) { doc.addPage(); y = P.marginTop + 8; }
        doc.text(ln, P.marginLeft, y);
        y += lineH;
      });
    });
  } else {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.greyAccent);
    doc.text('(No body content provided.)', P.marginLeft, y);
  }
  doc.__groovyY = y;
}

/* ── Stock Transfer variant ────────────────────────────────────────────────
   Faizan's finished-goods handoff receipt: header + title + info table +
   an items-by-size table with a bold total (the summary), + issue/receive
   signatures. English-only (urduLevel 'minimal') — an internal transfer doc.
   data: { poId, poName, productCode, items:[{size,qty}], total, fromLabel,
           toLabel, documentNumber/id, issuedBy, issuedDate }. */
function _renderStockTransfer(doc, data) {
  data = data || {};
  const sess = (typeof session !== 'undefined' && session) ? session : null;
  const today = new Date().toLocaleDateString('en-GB');
  const L = PRINT_LAYOUT.marginLeft, W = PRINT_LAYOUT.contentWidth;
  const by = data.issuedBy || (sess && sess.name) || 'system';

  _renderHeader(doc, {
    documentType: doc.__groovyDocType || 'Stock Transfer',
    documentNumber: data.documentNumber || data.id || '',
    issuedDate: data.issuedDate || today,
    issuedBy: by
  });
  _renderTitleBlock(doc, {
    title: 'STOCK TRANSFER',
    subtitle: (data.poId || '') + (data.poName ? ('  —  ' + data.poName) : ''),
    startY: doc.__groovyY
  });
  _renderInfoTable(doc, {
    startY: doc.__groovyY + 8,
    rows: [
      { labelEn: 'PO Number', value: data.poId || '—', labelEn2: 'Article', value2: data.productCode || '—' },
      { labelEn: 'From', value: data.fromLabel || 'Packing (Faizan)', labelEn2: 'To', value2: data.toLabel || 'Warehouse' },
      { labelEn: 'Booked by', value: by, labelEn2: 'Date', value2: data.issuedDate || today }
    ]
  });

  _renderSectionHeader(doc, { titleEn: 'Items transferred' });
  let y = doc.__groovyY + 4;
  const items = data.items || [];
  const col1 = W * 0.6;
  const line = _pc(PRINT_COLORS.greyLine), shade = _pc(PRINT_COLORS.greyShade);
  const rowH = 22;
  // Header
  doc.setFillColor(shade[0], shade[1], shade[2]); doc.rect(L, y, W, rowH, 'F');
  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, PRINT_COLORS.text);
  doc.text('SIZE', L + 8, y + 14); doc.text('QTY', L + col1 + 8, y + 14);
  y += rowH;
  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
  items.forEach(function (it) {
    if (y + rowH > PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginBottom - 60) { doc.addPage(); y = PRINT_LAYOUT.marginTop; }
    doc.setDrawColor(line[0], line[1], line[2]); doc.setLineWidth(0.25); doc.rect(L, y, W, rowH, 'S');
    doc.text(String(it.size || ''), L + 8, y + 14);
    doc.text(String(it.qty || 0), L + col1 + 8, y + 14);
    y += rowH;
  });
  // Total
  const total = data.total != null ? data.total : items.reduce(function (a, it) { return a + (Number(it.qty) || 0); }, 0);
  doc.setFillColor(shade[0], shade[1], shade[2]); doc.rect(L, y, W, rowH, 'F');
  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.body, PRINT_COLORS.text);
  doc.text('TOTAL PIECES', L + 8, y + 14); doc.text(String(total), L + col1 + 8, y + 14);
  y += rowH;
  doc.__groovyY = y;

  _renderSignatureRow(doc, { roleEn: 'Issued by', roleUr: '', name: by, startY: doc.__groovyY });
  _renderSignatureRow(doc, { roleEn: 'Received by', roleUr: '', name: '', startY: doc.__groovyY });
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
  // A fabric issue carries the cutting master who cut it (js/fabric.js — any
  // name, not only Hassan/Alam). It TAKES THE PURPOSE ROW'S PLACE when there
  // is no purpose, which is always true of a fabric issue (the issue payload
  // has no purpose field, so that row would only ever print "—"). Adding a
  // ninth row instead was MEASURED to push a single-fabric issue's signature
  // blocks onto a second page (gate-guard box at y=765 of 806 → over), so
  // the row count stays eight. With both fields, both print. A pass with no
  // cutting master prints exactly as it did.
  const cutMaster = String(data.cutMaster == null ? '' : data.cutMaster).trim();
  const purpose = String(data.purpose == null ? '' : data.purpose).trim();
  const cutRow = { labelEn: 'Cutting master', labelUr: 'کٹنگ ماسٹر', value: cutMaster };
  const purposeRow = { labelEn: 'Purpose', labelUr: 'مقصد', value: _gpDash(data.purpose) };
  _renderInfoTable(doc, {
    startY: doc.__groovyY + 12,
    rows: [
      { labelEn: 'Date', labelUr: 'تاریخ', value: _gpFmtDate(data.date) },
      { labelEn: 'Time', labelUr: 'وقت', value: _gpFmtTime(data.time) },
      { labelEn: 'Type', labelUr: 'قسم', value: tl.word },
      { labelEn: 'Person', labelUr: 'شخص', value: _gpDash(data.person || data.recipientName || data.name) },
      { labelEn: 'Article', labelUr: 'آرٹیکل', value: _gpDash(data.article || data.articleName) },
      { labelEn: 'Spec', labelUr: '', value: _gpDash(data.spec) },
      { labelEn: 'Destination', labelUr: 'منزل', value: _gpDash(data.destination || data.dest) }
    ].concat(!cutMaster ? [purposeRow] : (purpose ? [cutRow, purposeRow] : [cutRow]))
  });

  // 4) SECTION 2 — ITEMS
  _renderSectionHeader(doc, { titleEn: 'ITEMS', titleUr: 'اشیاء' });
  // Type-aware table: garments → Size/Units/Weight, item/asset → Item/Qty/
  // Returnable, fabric → the fabric split, everything else → Article/Spec.
  let cols, rowsData, totalRow = null;
  const _items = Array.isArray(data.items) ? data.items : [];
  if (data.gpType === 'item' && Array.isArray(data.assetItems)) {
    cols = [{ en: '#', ur: '', w: 28 }, { en: 'Item', ur: 'اشیاء', w: 315 }, { en: 'Qty', ur: 'مقدار', w: 90 }, { en: 'Returnable', ur: '', w: 90 }];
    rowsData = data.assetItems.map((it, i) => [i + 1, _gpDash(it.name), _gpDash(it.qty), it.returnable ? 'Yes' : 'No']);
  } else if (data.gpType === 'fabric') {
    cols = [{ en: '#', ur: '', w: 28 }, { en: 'Fabric', ur: 'کپڑا', w: 275 }, { en: 'Rolls', ur: '', w: 100 }, { en: 'Weight', ur: 'وزن', w: 120 }];
    const fabs = (Array.isArray(data.fabrics) && data.fabrics.length) ? data.fabrics
      : [{ fabType: data.fabricType, gsm: data.fabricGsm, color: data.fabricColor, rollsCount: data.rollsCount, weight: data.fabricQty, unit: data.fabricUnit }];
    rowsData = fabs.map((f, i) => [i + 1, _gpDash([f.fabType, f.gsm ? f.gsm + 'gsm' : '', f.color].filter(Boolean).join(' ')), _gpDash(f.rollsCount) + ' rolls', _gpDash(f.weight) + ' ' + (f.unit || 'kg')]);
  } else if (data.gpType === 'garments' || _items.some(it => it && it.size != null)) {
    cols = [{ en: '#', ur: '', w: 28 }, { en: 'Size', ur: 'سائز', w: 150 }, { en: 'Bundles', ur: '', w: 215 }, { en: 'Units', ur: 'مقدار', w: 130 }];
    const nz = _items.filter(it => (Number(it.units) || 0) > 0 || (Array.isArray(it.bundles) && it.bundles.length));
    rowsData = (nz.length ? nz : _items).map((it, i) => [i + 1, _gpDash(it.size), _gpDash(Array.isArray(it.bundles) ? it.bundles.join('-') : ''), _gpDash(it.units)]);
    const tU = _items.reduce((s, it) => s + (Number(it.units) || 0), 0);
    const tB = _items.reduce((s, it) => s + (Number(it.bundleCount) || (Array.isArray(it.bundles) ? it.bundles.length : 0)), 0);
    totalRow = ['', 'TOTAL', tB ? tB + ' bundles' : '', tU || ''];
  } else {
    cols = [{ en: '#', ur: '', w: 28 }, { en: 'Article', ur: 'مضمون', w: 207 }, { en: 'Spec', ur: '', w: 120 }, { en: 'Units', ur: 'مقدار', w: 84 }, { en: 'Weight', ur: 'وزن', w: 84 }];
    rowsData = _items.map((it, i) => [i + 1, _gpDash(it.article || data.article), _gpDash(it.spec || it.size || data.spec), _gpDash(it.units), _gpDash(it.weight)]);
  }
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

  if (rowsData && rowsData.length) {
    rowsData.forEach((cells) => drawRow(cells));
    if (totalRow) drawRow(totalRow);
  } else {
    for (let i = 0; i < 4; i++) drawRow([i + 1, ...cols.slice(1).map(() => '')]);
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

/* ── Payslip variant ──────────────────────────────────────────────────────
   Professional structured payslip: employee info grid, earnings/deductions
   side-by-side, attendance summary, prominent NET PAYABLE band. */

function _psFmt(n) {
  return 'PKR ' + (Number(n) || 0).toLocaleString('en-PK');
}

function _renderPayslip(doc, data) {
  data = data || {};
  var sess = (typeof session !== 'undefined' && session) ? session : null;
  var today = new Date().toLocaleDateString('en-GB');
  var L = PRINT_LAYOUT.marginLeft;
  var R = PRINT_LAYOUT.pageWidth - PRINT_LAYOUT.marginRight;
  var W = PRINT_LAYOUT.contentWidth;
  var monthLabel = data.monthLabel || '—';

  _renderHeader(doc, {
    documentType: 'Payslip',
    documentNumber: data.employeeId || data.id || '',
    issuedDate: data.issuedDate || today,
    issuedBy: data.issuedBy || (sess && sess.name) || 'system'
  });

  _renderTitleBlock(doc, {
    title: 'Payslip — ' + (data.employeeName || '—'),
    subtitle: [data.designation, data.department, monthLabel].filter(Boolean).join(' · '),
    startY: doc.__groovyY
  });

  // ── Employee info grid ────────────────────────────────────────────────
  _renderInfoTable(doc, { rows: [
    { labelEn: 'EMPLOYEE NAME',  value: data.employeeName || '—',
      labelEn2: 'EMPLOYEE ID',   value2: data.employeeId || '—' },
    { labelEn: 'DEPARTMENT',     value: data.department || '—',
      labelEn2: 'DESIGNATION',   value2: (data.designation || '—') + (data.paygrade ? '  [' + data.paygrade + ']' : '') },
    { labelEn: 'PAY GRADE',      value: data.paygrade || '—',
      labelEn2: 'PAY PERIOD',    value2: monthLabel }
  ]});

  // ── Earnings + Deductions side-by-side table ──────────────────────────
  var y = (doc.__groovyY || L) + 14;
  var colW = W / 4;
  var rowH = 22;
  var line = _pc(PRINT_COLORS.greyLine);
  var shade = _pc(PRINT_COLORS.greyShade);
  var white = _pc(PRINT_COLORS.white);

  var earnings = data.earnings || [['Basic Salary', data.basicSalary || 0]];
  var deductions = data.deductions || [];
  var maxRows = Math.max(earnings.length, deductions.length);

  // Table header
  var headH = 24;
  doc.setFillColor(shade[0], shade[1], shade[2]);
  doc.rect(L, y, W, headH, 'F');
  doc.setDrawColor(line[0], line[1], line[2]);
  doc.setLineWidth(0.25);
  doc.rect(L, y, W, headH, 'S');

  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, '#14532D');
  doc.text('Earnings', L + 6, y + 15);
  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, '#14532D');
  doc.text('Amount (PKR)', L + colW - 6, y + 15, { align: 'right' });

  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, '#991B1B');
  doc.text('Deductions', L + colW * 2 + 6, y + 15);
  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, '#991B1B');
  doc.text('Amount (PKR)', L + W - 6, y + 15, { align: 'right' });

  // Vertical separator
  doc.setDrawColor(line[0], line[1], line[2]);
  doc.setLineWidth(0.5);
  doc.line(L + colW * 2, y, L + colW * 2, y + headH + maxRows * rowH);

  y += headH;

  for (var i = 0; i < maxRows; i++) {
    doc.setFillColor(white[0], white[1], white[2]);
    doc.rect(L, y, W, rowH, 'F');
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(0.25);
    doc.rect(L, y, colW * 2, rowH, 'S');
    doc.rect(L + colW * 2, y, colW * 2, rowH, 'S');

    if (i < earnings.length) {
      _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
      doc.text(String(earnings[i][0] || ''), L + 6, y + 14);
      doc.text((Number(earnings[i][1]) || 0).toLocaleString('en-PK'), L + colW * 2 - 6, y + 14, { align: 'right' });
    }
    if (i < deductions.length) {
      _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
      doc.text(String(deductions[i][0] || ''), L + colW * 2 + 6, y + 14);
      doc.text((Number(deductions[i][1]) || 0).toLocaleString('en-PK'), L + W - 6, y + 14, { align: 'right' });
    }
    y += rowH;
  }

  doc.__groovyY = y;

  // ── Attendance summary ────────────────────────────────────────────────
  y += 10;
  _setFont(doc, PRINT_FONTS.display, 'bold', PRINT_SIZES.subsectionTitle, PRINT_COLORS.text);
  doc.text('ATTENDANCE SUMMARY', L, y + 12);
  y += 20;

  var attItems = [
    { label: 'Present',   value: data.presentDays   || 0, color: '#14532D', bg: '#DCFCE7' },
    { label: 'Late',      value: data.lateDays       || 0, color: '#92400E', bg: '#FEF3C7' },
    { label: 'Late→Abs', value: data.lateAbsentEquivalent || 0, color: '#92400E', bg: '#FEF3C7' },
    { label: 'Absent',    value: data.actualAbsentDays || 0, color: '#991B1B', bg: '#FEE2E2' }
  ];
  var boxW = (W - 18) / 4; // 6pt gap between boxes
  for (var a = 0; a < 4; a++) {
    var bx = L + a * (boxW + 6);
    var bgC = _pc(attItems[a].bg);
    doc.setFillColor(bgC[0], bgC[1], bgC[2]);
    doc.roundedRect(bx, y, boxW, 44, 4, 4, 'F');

    _setFont(doc, PRINT_FONTS.display, 'bold', 18, attItems[a].color);
    var numStr = String(attItems[a].value);
    var numW = doc.getTextWidth(numStr);
    doc.text(numStr, bx + (boxW - numW) / 2, y + 22);

    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 8, PRINT_COLORS.greyAccent);
    var lblW = doc.getTextWidth(attItems[a].label);
    doc.text(attItems[a].label, bx + (boxW - lblW) / 2, y + 36);
  }
  y += 54;
  doc.__groovyY = y;

  // ── Earnings summary box ──────────────────────────────────────────────
  y += 6;
  var summBg = _pc('#F8FAFC');
  var summBorder = _pc('#E2E8F0');
  var summH = 8 + (earnings.length + 1) * 18 + 10;
  doc.setFillColor(summBg[0], summBg[1], summBg[2]);
  doc.roundedRect(L, y, W, summH, 4, 4, 'F');
  doc.setDrawColor(summBorder[0], summBorder[1], summBorder[2]);
  doc.setLineWidth(0.5);
  doc.roundedRect(L, y, W, summH, 4, 4, 'S');

  _setFont(doc, PRINT_FONTS.display, 'bold', PRINT_SIZES.subsectionTitle, '#14532D');
  doc.text('Earnings Summary', L + 10, y + 16);
  var sy = y + 28;

  var gross = 0;
  for (var e = 0; e < earnings.length; e++) {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
    doc.text(String(earnings[e][0] || ''), L + 10, sy);
    doc.text(_psFmt(earnings[e][1] || 0), L + W - 10, sy, { align: 'right' });
    gross += (Number(earnings[e][1]) || 0);
    sy += 18;
  }
  // Gross total line
  var grossLineY = sy - 4;
  doc.setDrawColor(line[0], line[1], line[2]);
  doc.setLineWidth(0.25);
  doc.line(L + 10, grossLineY, L + W - 10, grossLineY);
  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.body, PRINT_COLORS.text);
  doc.text('Gross Pay', L + 10, sy + 2);
  doc.text(_psFmt(data.grossSalary || gross), L + W - 10, sy + 2, { align: 'right' });

  y += summH + 8;
  doc.__groovyY = y;

  // ── NET PAYABLE band ──────────────────────────────────────────────────
  var netH = 48;
  var netBg = _pc('#1A1A2E');
  doc.setFillColor(netBg[0], netBg[1], netBg[2]);
  doc.roundedRect(L, y, W, netH, 4, 4, 'F');

  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 10, '#FFFFFF');
  doc.text('NET PAYABLE', L + (W / 2), y + 16, { align: 'center' });

  _setFont(doc, PRINT_FONTS.display, 'bold', 22, '#FFFFFF');
  doc.text(_psFmt(data.netPayable || 0), L + (W / 2), y + 36, { align: 'center' });

  y += netH;

  // ── Payment status (if paid) ──────────────────────────────────────────
  if (data.status === 'paid' && data.paidOn) {
    y += 8;
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 9, PRINT_COLORS.greyAccent);
    doc.text('Paid on ' + data.paidOn + (data.paidBy ? ' by ' + data.paidBy : ''), L + (W / 2), y + 6, { align: 'center' });
    y += 14;
  }

  // ── Footer disclaimer ─────────────────────────────────────────────────
  y += 20;
  if (y > PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginBottom - 40) {
    doc.addPage();
    y = PRINT_LAYOUT.marginTop;
  }
  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 8, PRINT_COLORS.greyAccent);
  doc.text(
    'This is a computer-generated payslip and does not require a signature. For queries, contact management.',
    L + (W / 2), y + 4, { align: 'center' }
  );

  doc.__groovyY = y + 12;
}

/* ── Daily Performance variant ─────────────────────────────────────────────
   Single-page dispatch & returns report for one calendar day. English-only
   (urduLevel 'minimal' by default) — this is an internal logistics sheet, no
   Urdu needed. Draws two 4-column tables (Brand · Courier · Shipments ·
   Amount) with grand-total rows, then a short summary block.
   data: { dateLabel, issuedDate, issuedBy, dispatched:[{brand,courier,
           shipments,amount}], returns:[…], dispatchedTotal:{shipments,amount},
           returnsTotal:{…} } */
function _dpNum(n) { return Number(n || 0).toLocaleString('en-US'); }

function _dpTable(doc, rows, totals) {
  const L = PRINT_LAYOUT.marginLeft;
  const W = PRINT_LAYOUT.contentWidth;
  const cols = [{ w: 205, a: 'left' }, { w: 95, a: 'left' }, { w: 108, a: 'right' }, { w: 115, a: 'right' }];
  const xs = []; let acc = L; cols.forEach((c) => { xs.push(acc); acc += c.w; });
  const rowH = 20;
  let y = (doc.__groovyY || PRINT_LAYOUT.marginTop) + 2;
  const line = _pc(PRINT_COLORS.greyLine);
  const shade = _pc(PRINT_COLORS.greyShade);
  const white = _pc(PRINT_COLORS.white);

  const drawRow = (cells, opts) => {
    opts = opts || {};
    if (y + rowH > PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginBottom - 24) {
      doc.addPage(); y = PRINT_LAYOUT.marginTop;
    }
    const bg = opts.head ? shade : white;
    doc.setFillColor(bg[0], bg[1], bg[2]);
    doc.rect(L, y, W, rowH, 'F');
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(opts.total ? 0.8 : 0.25);
    doc.rect(L, y, W, rowH, 'S');
    cells.forEach((txt, i) => {
      const bold = opts.head || opts.total;
      const size = opts.head ? PRINT_SIZES.bodySmall : PRINT_SIZES.body;
      const color = opts.head ? PRINT_COLORS.greyAccent : PRINT_COLORS.text;
      _setFont(doc, PRINT_FONTS.bodyRegular, bold ? 'bold' : 'normal', size, color);
      const c = cols[i];
      const tx = c.a === 'right' ? xs[i] + c.w - 6 : xs[i] + 6;
      doc.text(String(txt), tx, y + 13, { align: c.a === 'right' ? 'right' : 'left' });
    });
    y += rowH;
  };

  drawRow(['Brand', 'Courier', 'Shipments', 'Amount (Rs)'], { head: true });
  (rows || []).forEach((r) => drawRow([r.brand, r.courier, _dpNum(r.shipments), _dpNum(r.amount)]));
  drawRow(['GRAND TOTAL', '', _dpNum((totals || {}).shipments), _dpNum((totals || {}).amount)], { total: true });

  doc.__groovyY = y;
  return y;
}

function _renderDailyPerformance(doc, data) {
  data = data || {};
  const dateLabel = data.dateLabel || data.date || '';
  _renderHeader(doc, {
    documentType: 'Daily Performance',
    documentNumber: dateLabel,
    issuedDate: data.issuedDate || dateLabel,
    issuedBy: data.issuedBy || '—'
  });

  _renderSectionHeader(doc, { titleEn: 'Dispatched' });
  _dpTable(doc, data.dispatched || [], data.dispatchedTotal || { shipments: 0, amount: 0 });

  _renderSectionHeader(doc, { titleEn: 'Returns' });
  _dpTable(doc, data.returns || [], data.returnsTotal || { shipments: 0, amount: 0 });

  const dS = (data.dispatchedTotal || {}).shipments || 0;
  const dA = (data.dispatchedTotal || {}).amount || 0;
  const rS = (data.returnsTotal || {}).shipments || 0;
  const rA = (data.returnsTotal || {}).amount || 0;
  const rate = dS ? ((100 * rS / dS).toFixed(1) + '%') : '—';

  let y = (doc.__groovyY || PRINT_LAYOUT.marginTop) + 20;
  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.body, PRINT_COLORS.text);
  doc.text('Summary', PRINT_LAYOUT.marginLeft, y); y += 16;
  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.greyAccent);
  [
    'Dispatched:  ' + _dpNum(dS) + ' shipments  ·  Rs ' + _dpNum(dA),
    'Returns:  ' + _dpNum(rS) + ' shipments  ·  Rs ' + _dpNum(rA),
    'Return rate:  ' + rate + '     ·     Net value:  Rs ' + _dpNum(dA - rA)
  ].forEach((l) => { doc.text(l, PRINT_LAYOUT.marginLeft, y); y += 15; });
  doc.__groovyY = y;
}

/* ── Consumable Log variant ────────────────────────────────────────────────
   Store Accounts (js/store-accounts.js): one daily-consumable vendor
   (bottled water, gas) for one month — every day's entry, the month total,
   and the bill that was generated from it, so the sheet that goes to the
   vendor or into the file says what happened on each day AND what it cost.
   English-only: an internal reconciliation sheet.

   data: { vendorName, monthLabel, unit, weighed, rate,
           rows:[{day, weekday, qty, residual, net, amount, byName, note}],
           totalQty, totalAmount, daysLogged,
           bill:{amount, date, vendorBillAmount, variance} | null,
           issuedBy, issuedDate } */
function _renderConsumableLog(doc, data) {
  data = data || {};
  const L = PRINT_LAYOUT.marginLeft;
  const W = PRINT_LAYOUT.contentWidth;
  const unit = String(data.unit || 'unit');
  const weighed = !!data.weighed;
  const today = new Date().toLocaleDateString('en-GB');

  _renderHeader(doc, {
    documentType: 'Consumable Log',
    documentNumber: (data.vendorName || '') + (data.monthLabel ? ' · ' + data.monthLabel : ''),
    issuedDate: data.issuedDate || today,
    issuedBy: data.issuedBy || '—'
  });
  _renderTitleBlock(doc, {
    title: data.vendorName || 'Consumable',
    subtitle: (data.monthLabel || '') + '  ·  ' + (weighed ? 'weighed, net = delivered − returned' : 'counted') +
      '  ·  Rs ' + _dpNum(data.rate) + ' / ' + unit,
    startY: doc.__groovyY
  });
  _renderSectionHeader(doc, { titleEn: 'Daily log' });

  // Columns sum to the content width (523). A weighed vendor carries two
  // more numbers (delivered, returned) than a counted one.
  // The unit is in the subtitle, so the heads stay short enough for their
  // columns (a head that clips to "Delivered …" says nothing).
  const cols = weighed
    ? [{ w: 56, h: 'Day' }, { w: 66, h: 'Delivered', a: 'right' }, { w: 66, h: 'Returned', a: 'right' },
       { w: 56, h: 'Net', a: 'right' }, { w: 76, h: 'Amount (Rs)', a: 'right' }, { w: 88, h: 'Logged by' }, { w: 115, h: 'Note' }]
    : [{ w: 56, h: 'Day' }, { w: 84, h: 'Received', a: 'right' }, { w: 90, h: 'Amount (Rs)', a: 'right' },
       { w: 110, h: 'Logged by' }, { w: 183, h: 'Note' }];
  const xs = []; let acc = L; cols.forEach((c) => { xs.push(acc); acc += c.w; });
  const rowH = 18;
  const line = _pc(PRINT_COLORS.greyLine);
  const shade = _pc(PRINT_COLORS.greyShade);
  const white = _pc(PRINT_COLORS.white);
  const maxY = PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginBottom - 24;
  let y = (doc.__groovyY || PRINT_LAYOUT.marginTop) + 2;

  const clip = (txt, w) => {
    txt = String(txt == null ? '' : txt);
    const maxChars = Math.max(3, Math.floor((w - 10) / 4.8));   // ~4.8pt per char at 10pt Aptos
    return txt.length > maxChars ? txt.slice(0, maxChars - 1) + '…' : txt;
  };
  const drawRow = (cells, opts) => {
    opts = opts || {};
    const bg = opts.head ? shade : white;
    doc.setFillColor(bg[0], bg[1], bg[2]);
    doc.rect(L, y, W, rowH, 'F');
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(opts.total ? 0.8 : 0.25);
    doc.rect(L, y, W, rowH, 'S');
    cells.forEach((txt, i) => {
      const c = cols[i];
      const bold = opts.head || opts.total;
      _setFont(doc, PRINT_FONTS.bodyRegular, bold ? 'bold' : 'normal',
        opts.head ? PRINT_SIZES.bodySmall : PRINT_SIZES.bodySmall, opts.head ? PRINT_COLORS.greyAccent : PRINT_COLORS.text);
      const tx = c.a === 'right' ? xs[i] + c.w - 5 : xs[i] + 5;
      doc.text(clip(txt, c.w), tx, y + 12, { align: c.a === 'right' ? 'right' : 'left' });
    });
    y += rowH;
  };
  const head = () => drawRow(cols.map((c) => c.h), { head: true });
  head();
  (data.rows || []).forEach((r) => {
    if (y + rowH > maxY) { doc.addPage(); y = PRINT_LAYOUT.marginTop; head(); }
    const logged = r.qty != null && r.qty !== '';
    const day = String(r.day) + (r.weekday ? ' ' + r.weekday : '');
    if (weighed) {
      drawRow([day, logged ? _dpNum(r.qty) : '—', logged ? _dpNum(r.residual || 0) : '—',
        logged ? _dpNum(r.net) : '', logged ? _dpNum(r.amount) : '', r.byName || '', r.note || '']);
    } else {
      drawRow([day, logged ? _dpNum(r.qty) : '—', logged ? _dpNum(r.amount) : '', r.byName || '', r.note || '']);
    }
  });
  if (y + rowH > maxY) { doc.addPage(); y = PRINT_LAYOUT.marginTop; head(); }
  const totalCells = weighed
    ? ['TOTAL', '', '', _dpNum(data.totalQty), _dpNum(data.totalAmount), (data.daysLogged || 0) + ' days logged', '']
    : ['TOTAL', _dpNum(data.totalQty), _dpNum(data.totalAmount), (data.daysLogged || 0) + ' days logged', ''];
  drawRow(totalCells, { total: true });
  doc.__groovyY = y;

  // Billing — what the log came to and what was actually put on the account.
  if (y + 110 > maxY) { doc.addPage(); doc.__groovyY = PRINT_LAYOUT.marginTop; }
  _renderSectionHeader(doc, { titleEn: 'Billing' });
  y = (doc.__groovyY || PRINT_LAYOUT.marginTop) + 14;
  const lines = [
    'Month total:  ' + _dpNum(data.totalQty) + ' ' + unit + (weighed ? '' : 's') + '  ×  Rs ' + _dpNum(data.rate) + '  =  Rs ' + _dpNum(data.totalAmount)
  ];
  const b = data.bill;
  if (b) {
    lines.push('Bill generated:  Rs ' + _dpNum(b.amount) + (b.date ? '  on ' + b.date : '') + '  ·  on ' + (data.vendorName || 'the vendor') + "'s account");
    if (b.vendorBillAmount != null) {
      const v = Number(b.variance || 0);
      lines.push("Vendor's own bill:  Rs " + _dpNum(b.vendorBillAmount) + '  ·  ' +
        (v === 0 ? 'matches our log' : (v > 0 ? 'vendor bills Rs ' + _dpNum(v) + ' MORE than our log' : 'vendor bills Rs ' + _dpNum(-v) + ' LESS than our log')));
    } else {
      lines.push("Vendor's own bill:  not entered yet");
    }
  } else {
    lines.push('No bill generated for this month yet.');
  }
  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
  lines.forEach((l, i) => {
    _setFont(doc, PRINT_FONTS.bodyRegular, i === 0 ? 'bold' : 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
    doc.text(l, L, y); y += 16;
  });
  doc.__groovyY = y;
}

/* ── Mood Board variant ────────────────────────────────────────────────────
   A board exported for people who are not in the app — a vendor, the
   factory floor, a partner. Two parts: the board itself as one picture,
   scaled to fit the page, then a text index of every card that carries
   text, so the PDF is searchable and readable even where the picture is
   small.

   The picture is rasterised by the CALLER (js/boards.js draws the board
   onto a 2D canvas and passes a JPEG data URL) — this variant stays
   synchronous like every other one, and the engine never has to know how a
   board is drawn. English-only by default: an internal design reference
   does not need the ~10 MB Urdu font.

   data: { boardTitle, visibility, ownerName, cardCount, imageDataUrl,
           imageW, imageH, index:[{kind,text}], indexTruncated } */
function _renderMoodBoard(doc, data) {
  data = data || {};
  const L = PRINT_LAYOUT.marginLeft;
  const W = PRINT_LAYOUT.contentWidth;
  const sess = (typeof session !== 'undefined' && session) ? session : null;
  const today = new Date().toLocaleDateString('en-GB');

  _renderHeader(doc, {
    documentType: 'Mood Board',
    documentNumber: data.boardTitle || '',
    issuedDate: data.issuedDate || today,
    issuedBy: data.issuedBy || (sess && sess.name) || 'system'
  });

  const bits = [];
  if (data.visibility) bits.push(data.visibility);
  if (data.cardCount != null) bits.push(data.cardCount + ' card' + (data.cardCount === 1 ? '' : 's'));
  if (data.ownerName) bits.push(data.ownerName);
  _renderTitleBlock(doc, {
    title: data.boardTitle || 'Untitled board',
    subtitle: bits.join('  ·  '),
    startY: doc.__groovyY
  });

  // The board picture, fitted to the content width and to whatever height
  // is left on the page. A tall board gets its own page rather than being
  // squeezed into a strip.
  if (data.imageDataUrl && data.imageW && data.imageH) {
    const ratio = data.imageH / data.imageW;
    let y = (doc.__groovyY || PRINT_LAYOUT.marginTop) + 14;
    let avail = PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginBottom - 24 - y;
    let w = W, h = W * ratio;
    if (h > avail) {
      const ownPage = PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginTop - PRINT_LAYOUT.marginBottom - 24;
      if (avail < ownPage * 0.55) {         // too little room left to be worth it
        doc.addPage();
        y = PRINT_LAYOUT.marginTop;
        avail = ownPage;
      }
      if (h > avail) { h = avail; w = h / ratio; }
    }
    try {
      doc.addImage(data.imageDataUrl, 'JPEG', L + (W - w) / 2, y, w, h);
    } catch (e) {
      console.warn('[print-engine] board image could not be embedded:', e);
      _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.greyAccent);
      doc.text('(Board image could not be embedded.)', L, y + 14);
      h = 20;
    }
    doc.__groovyY = y + h;
  }

  const index = Array.isArray(data.index) ? data.index : [];
  if (!index.length) return;

  _renderSectionHeader(doc, { titleEn: 'Card index' });
  let y = (doc.__groovyY || PRINT_LAYOUT.marginTop) + 14;
  const maxY = PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginBottom - 28;
  const kindW = 74;
  index.forEach((row) => {
    const lines = doc.splitTextToSize(String(row.text || ''), W - kindW);
    if (y + lines.length * 13 > maxY) { doc.addPage(); y = PRINT_LAYOUT.marginTop + 8; }
    _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, PRINT_COLORS.greyAccent);
    doc.text(String(row.kind || '').toUpperCase(), L, y);
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.bodySmall, PRINT_COLORS.text);
    lines.forEach((ln, i) => { doc.text(ln, L + kindW, y + i * 13); });
    y += lines.length * 13 + 5;
  });
  if (data.indexTruncated) {
    if (y > maxY) { doc.addPage(); y = PRINT_LAYOUT.marginTop + 8; }
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.bodySmall, PRINT_COLORS.greyAccent);
    doc.text('(Index truncated — this board has more cards than are listed here.)', L, y);
    y += 13;
  }
  doc.__groovyY = y;
}

/* ── Production Order variant ──────────────────────────────────────────────
   Full manufacturing traveler / routing sheet matching the "Production Order
   2.0" reference: header + "Department: Manufacturing", an order-info block
   with the product photo on the right, then the signed per-station size grids
   (Cutting + Bundling, Printing & Emb QC, Bundling Before Stitching,
   Stitching, Washing). The quantity/bundle cells are intentionally left blank
   for hand-entry on the floor; only the order header is pre-filled. Bilingual
   (urduLevel defaults to 'full'). Composes the shared _render* components and
   two local table closures. */
function _renderPO(doc, data) {
  data = data || {};
  const L = PRINT_LAYOUT.marginLeft;
  const W = PRINT_LAYOUT.contentWidth;
  const R = L + W;
  const sess = (typeof session !== 'undefined' && session) ? session : null;
  const line = _pc(PRINT_COLORS.greyLine);
  const shade = _pc(PRINT_COLORS.greyShade);
  const shadeL = _pc(PRINT_COLORS.greyShadeLight);
  const maxY = PRINT_LAYOUT.pageHeight - PRINT_LAYOUT.marginBottom - 22;
  const SIZE_ROWS = ['Small', 'Medium', 'Large', 'X-Large'];

  const need = function (h) {
    if ((doc.__groovyY || PRINT_LAYOUT.marginTop) + h > maxY) {
      doc.addPage();
      doc.__groovyY = PRINT_LAYOUT.marginTop;
    }
    return doc.__groovyY;
  };

  // Generic bordered table: cols=[{title,ur,w}], rows=array of cell arrays
  // (null/'' → blank cell). o.shadeFirst shades+bolds the first column.
  const tableGrid = function (cols, rows, o) {
    o = o || {};
    const hdrH = o.hdrH || 26, rowH = o.rowH || 20;
    const totalW = cols.reduce(function (s, c) { return s + c.w; }, 0);
    const drawHdr = function () {
      const yy = doc.__groovyY;
      doc.setFillColor(shade[0], shade[1], shade[2]);
      doc.rect(L, yy, totalW, hdrH, 'F');
      let cx = L;
      cols.forEach(function (c) {
        doc.setDrawColor(line[0], line[1], line[2]);
        doc.setLineWidth(0.4);
        doc.rect(cx, yy, c.w, hdrH, 'S');
        const bilingual = c.ur && _urduOn(doc);
        _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', 9, PRINT_COLORS.text);
        doc.text(String(c.title || ''), cx + 5, yy + (bilingual ? 11 : hdrH / 2 + 3), { maxWidth: c.w - 8 });
        if (bilingual) {
          _setFont(doc, PRINT_FONTS.urdu, 'normal', 9, PRINT_COLORS.greyAccent);
          doc.text(String(c.ur), cx + 5, yy + 22, { maxWidth: c.w - 8 });
        }
        cx += c.w;
      });
      doc.__groovyY = yy + hdrH;
    };
    need(hdrH + rowH);
    drawHdr();
    rows.forEach(function (r) {
      if (doc.__groovyY + rowH > maxY) {
        doc.addPage();
        doc.__groovyY = PRINT_LAYOUT.marginTop;
        drawHdr();
      }
      const yy = doc.__groovyY;
      let cx = L;
      cols.forEach(function (c, i) {
        if (o.shadeFirst && i === 0) {
          doc.setFillColor(shadeL[0], shadeL[1], shadeL[2]);
          doc.rect(cx, yy, c.w, rowH, 'F');
        }
        doc.setDrawColor(line[0], line[1], line[2]);
        doc.setLineWidth(0.3);
        doc.rect(cx, yy, c.w, rowH, 'S');
        const v = r ? r[i] : '';
        if (v != null && v !== '') {
          _setFont(doc, PRINT_FONTS.bodyRegular, (o.shadeFirst && i === 0) ? 'bold' : 'normal', PRINT_SIZES.bodySmall, PRINT_COLORS.text);
          doc.text(String(v), cx + 5, yy + rowH / 2 + 3.5, { maxWidth: c.w - 8 });
        }
        cx += c.w;
      });
      doc.__groovyY = yy + rowH;
    });
  };

  // "Grand Total Quantity Processed ______" line (bilingual).
  const grandTotalLine = function () {
    need(28);
    const yy = doc.__groovyY + 16;
    const en = 'Grand Total Quantity Processed';
    _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, PRINT_COLORS.text);
    doc.text(en, L, yy);
    let gx = L + doc.getTextWidth(en) + 4;
    if (_urduOn(doc)) {
      _setFont(doc, PRINT_FONTS.urdu, 'normal', PRINT_SIZES.urduBody, PRINT_COLORS.greyAccent);
      doc.text('مقدار مکمل کی گئی', gx, yy);
    }
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(0.5);
    doc.line(R - 120, yy + 2, R, yy + 2);
    doc.__groovyY = yy + 4;
  };

  // "Signature (دستخط) : ______   With Name: ______" line.
  const signWithName = function (owner) {
    need(28);
    const yy = doc.__groovyY + 18;
    let x = L;
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
    doc.text('Signature', x, yy); x += doc.getTextWidth('Signature');
    if (_urduOn(doc)) {
      _setFont(doc, PRINT_FONTS.urdu, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
      doc.text(' (دستخط)', x, yy); x += doc.getTextWidth(' (دستخط)');
    }
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
    const s = ': ________________';
    doc.text(s, x, yy); x += doc.getTextWidth(s) + 20;
    doc.text('With Name: ' + (owner ? owner : '________________'), x, yy);
    doc.__groovyY = yy + 4;
  };

  // A label followed by two blank ruled lines (used for Remarks / Defects).
  const remarksLine = function (en, ur) {
    need(42);
    let yy = doc.__groovyY + 18;
    let x = L;
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
    doc.text(en, x, yy); x += doc.getTextWidth(en);
    if (ur && _urduOn(doc)) {
      _setFont(doc, PRINT_FONTS.urdu, 'normal', PRINT_SIZES.body, PRINT_COLORS.text);
      doc.text(' (' + ur + ')', x, yy); x += doc.getTextWidth(' (' + ur + ')');
    }
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(0.5);
    doc.line(x + 8, yy + 2, R, yy + 2);
    yy += 18;
    doc.line(L, yy + 2, R, yy + 2);
    doc.__groovyY = yy + 4;
  };

  // 1) HEADER + department line
  _renderHeader(doc, {
    documentType: 'Production Order',
    documentNumber: data.documentNumber || data.id || '',
    issuedDate: data.issuedDate || new Date().toLocaleDateString('en-GB'),
    issuedBy: data.issuedBy || (sess && sess.name) || '—'
  });
  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 9, PRINT_COLORS.greyAccent);
  doc.text('Department: Manufacturing', L, doc.__groovyY + 4);

  // 2) ORDER INFO BLOCK (label/value grid on the left, product photo right)
  const im = (data.__productImg && data.__productImg.dataUrl) ? data.__productImg : null;
  const imgW = 150, imgGap = 14;
  const gridW = im ? (W - imgW - imgGap) : W;
  const gy0 = (doc.__groovyY || PRINT_LAYOUT.marginTop) + 14;
  let gy = gy0;
  const cellH = 22;

  const drawKV = function (x, w, label, value) {
    const labW = Math.min(84, w * 0.42);
    doc.setFillColor(shadeL[0], shadeL[1], shadeL[2]);
    doc.rect(x, gy, labW, cellH, 'F');
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(0.3);
    doc.rect(x, gy, labW, cellH, 'S');
    doc.rect(x + labW, gy, w - labW, cellH, 'S');
    _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', 8, PRINT_COLORS.text);
    doc.text(String(label), x + 4, gy + cellH / 2 + 3, { maxWidth: labW - 6 });
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', PRINT_SIZES.bodySmall, PRINT_COLORS.text);
    doc.text(String(value == null ? '' : value), x + labW + 4, gy + cellH / 2 + 3, { maxWidth: w - labW - 8 });
  };
  const halfW = gridW / 2;
  const kvRow = function (l1, v1, l2, v2) {
    drawKV(L, halfW, l1, v1);
    if (l2 != null) drawKV(L + halfW, gridW - halfW, l2, v2);
    gy += cellH;
  };
  const kvSpan = function (l, v) {
    drawKV(L, gridW, l, v);
    gy += cellH;
  };

  kvRow('PO Number', data.poNumber || data.id || '', 'Start Date', data.startDate || '');
  kvRow('Pattern # / Name', data.pattern || '', 'Issued By', data.issuedBy || '');
  kvSpan('Article Name', data.articleName || '');
  kvRow('Article Code', data.articleCode || '', 'Sizes', data.sizes || '');
  kvRow('Fabric Name', data.fabricName || '', 'Fabric Code', data.fabricCode || '');
  kvRow('Total Quantity', data.totalQty || '', 'Ratio', data.ratio || '');
  kvRow('Total Weight / Mtr', data.totalWeight || '', 'Average Per Unit', data.avgPerUnit || '');

  if (im) {
    const boxH = gy - gy0;
    const ar = (im.w && im.h) ? (im.w / im.h) : 0.75;
    let dw = imgW, dh = dw / ar;
    if (dh > boxH) { dh = boxH; dw = dh * ar; }
    const ix = L + gridW + imgGap;
    const ox = ix + (imgW - dw) / 2;
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(0.3);
    doc.rect(ix, gy0, imgW, boxH, 'S');
    try { doc.addImage(im.dataUrl, im.fmt || 'JPEG', ox, gy0, dw, dh); } catch (e) { /* skip */ }
  }
  doc.__groovyY = gy;

  // NOTES — free text from PO creation (renderPOCreate() in js/pos.js, saved
  // as po.notes). Always rendered in PRINT_COLORS.red so it stands out on
  // the printed traveler to every station handling this PO, never the
  // default body text color.
  if (data.notes) {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, PRINT_COLORS.red);
    const label = 'Notes: ';
    const labelW = doc.getTextWidth(label) + 2;
    const wrapped = doc.splitTextToSize(String(data.notes), W - labelW);
    const lineH = PRINT_SIZES.bodySmall * 1.15;
    need(12 + wrapped.length * lineH + 6);
    const notesY0 = doc.__groovyY + 12;
    _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', PRINT_SIZES.bodySmall, PRINT_COLORS.red);
    doc.text(label, L, notesY0);
    doc.text(wrapped, L + labelW, notesY0);
    doc.__groovyY = notesY0 + (wrapped.length - 1) * lineH + 6;
  }

  // STATION — CUTTING + BUNDLING
  _renderSectionHeader(doc, { titleEn: 'Cutting + Bundling', titleUr: 'بنڈلنگ اور ٹرانسپورٹیشن', ownerName: 'Raees' });
  doc.__groovyY += 6;
  tableGrid(
    [{ title: 'Size', ur: 'سائز', w: 175 }, { title: 'Bundles', ur: '', w: 174 }, { title: 'Total', ur: '', w: 174 }],
    SIZE_ROWS.map(function (s) { return [s, '', '']; }),
    { shadeFirst: true }
  );
  grandTotalLine();
  signWithName();

  // 6) STATION — PRINTING & EMB QC
  _renderSectionHeader(doc, { titleEn: 'Printing & Emb QC', titleUr: '', ownerName: 'Haris' });
  doc.__groovyY += 6;
  tableGrid(
    [{ title: 'Size', ur: 'سائز', w: 100 },
     { title: 'Total Passed', ur: '', w: 130 },
     { title: 'QA Not Passed But Forwarded', ur: '', w: 173 },
     { title: 'Rejected', ur: '', w: 120 }],
    SIZE_ROWS.map(function (s) { return [s, '', '', '']; }).concat([['Grand Total', '', '', '']]),
    { shadeFirst: true }
  );
  remarksLine('Remarks', 'تبصرے');

  // 7) STATION — BUNDLING BEFORE STITCHING
  _renderSectionHeader(doc, { titleEn: 'Bundling Before Stitching', titleUr: 'بنڈلنگ اور ٹرانسپورٹیشن', ownerName: 'Zuhaib' });
  doc.__groovyY += 6;
  tableGrid(
    [{ title: 'Size', ur: 'سائز', w: 175 }, { title: 'Bundles', ur: '', w: 174 }, { title: 'Total', ur: '', w: 174 }],
    SIZE_ROWS.map(function (s) { return [s, '', '']; }),
    { shadeFirst: true }
  );
  grandTotalLine();
  signWithName();

  // 8) STATION — STITCHING
  _renderSectionHeader(doc, { titleEn: 'Stitching', titleUr: '', ownerName: 'Waqas' });
  doc.__groovyY += 6;
  tableGrid(
    [{ title: 'Date', ur: '', w: 110 },
     { title: 'Size + Bundle', ur: '', w: 180 },
     { title: 'OFFLINE', ur: '', w: 110 },
     { title: 'Total', ur: '', w: 123 }],
    [['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']],
    {}
  );
  signWithName('Waqas');
  remarksLine('Defects / Remarks', 'خامیوں / تبصرے');

  // 9) STATION — WASHING DEPARTMENT
  _renderSectionHeader(doc, { titleEn: 'Washing Department', titleUr: '', ownerName: 'Abbas' });
  doc.__groovyY += 6;
  tableGrid(
    [{ title: 'Date Out', ur: '', w: 131 },
     { title: 'PCs / Kgs', ur: '', w: 130 },
     { title: 'Date Received', ur: '', w: 132 },
     { title: 'PCs / Kgs', ur: '', w: 130 }],
    [['', '', '', ''], ['', '', '', ''], ['', '', '', '']],
    {}
  );
  remarksLine('Defects / Remarks', 'خامیوں / تبصرے');
  signWithName();
}

/* ── Custom page size ──────────────────────────────────────────────────────
   Only a variant that draws its whole page itself may ask for one. Points. */
function _customPage(data) {
  const pg = data && data.page;
  if (!pg) return null;
  const w = Number(pg.w), h = Number(pg.h);
  if (!(w > 36 && h > 36 && w < 3000 && h < 3000)) return null;
  return { w: w, h: h };
}

/**
 * Pattern label — the Pattern Hub's 5 × 6 in sticker (M4). ONE PAGE PER
 * LABEL; the caller passes `data.page = {w:360, h:432}` and `data.labels`,
 * one entry per (block, size). Draws its own layout — the A4 components are
 * not used — and the QR is passed in as a boolean matrix the caller built
 * (the engine never learns about the QR library, the same way the mood-board
 * variant never learns how a board is drawn).
 *
 * label = { code, name, category, fit, size, sizes[], hook, slot,
 *           articles[] (codes), more (n not shown), measurements [{label,value}],
 *           qr (bool[][]), url, printedOn, gridUpdated, tol }
 */
function _renderPatternLabel(doc, data) {
  const labels = (data && data.labels) || [];
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  const grey = PRINT_COLORS.greyAccent, ink = PRINT_COLORS.text, black = PRINT_COLORS.black;
  labels.forEach(function (L, i) {
    if (i > 0) doc.addPage();
    let y = M;
    // brand line + print date
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 7, grey);
    doc.text('GROOVY  ·  PATTERN', M, y + 6);
    if (L.printedOn) doc.text('printed ' + L.printedOn, W - M, y + 6, { align: 'right' });
    y += 12;
    // the size box, top right
    const bw = 96, bh = 46;
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(1.2);
    doc.rect(W - M - bw, y, bw, bh);
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 7, grey);
    doc.text('SIZE', W - M - bw / 2, y + 11, { align: 'center' });
    _setFont(doc, PRINT_FONTS.display, 'bold', 26, black);
    doc.text(String(L.size || '—'), W - M - bw / 2, y + 38, { align: 'center' });
    // code + name, left of the box
    const leftW = W - 2 * M - bw - 10;
    _setFont(doc, PRINT_FONTS.display, 'bold', 30, black);
    doc.text(String(L.code || ''), M, y + 27);
    y += 34;
    _setFont(doc, PRINT_FONTS.bodyBold, 'bold', 12, ink);
    const nameLines = doc.splitTextToSize(String(L.name || ''), leftW).slice(0, 2);
    doc.text(nameLines, M, y + 6);
    y += 14 * Math.max(1, nameLines.length);
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 8, grey);
    doc.text([L.category, L.fit].filter(Boolean).join('  ·  '), M, y + 4);
    y = Math.max(y + 12, M + 12 + bh + 8);
    // home + bundle
    doc.setDrawColor(204, 204, 204); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 6;
    _setFont(doc, PRINT_FONTS.bodyBold, 'bold', 12, black);
    doc.text(L.hook && L.slot ? 'HOOK ' + L.hook + '   ·   SLOT ' + L.slot : 'NOT ON A HOOK', M, y + 10);
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 8, grey);
    doc.text('bundle: ' + ((L.sizes || []).join(' ') || '—'), W - M, y + 10, { align: 'right' });
    y += 20;
    // articles
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 7, grey);
    doc.text('ARTICLES USING THIS BLOCK', M, y + 6); y += 9;
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 8, ink);
    // ALL of L.articles, never truncated to a line count — this used to be
    // .slice(0, 3) with a "+N more" appended by the caller, which sent
    // whoever read the physical label to a screen for the rest of it. The
    // measurement rows below already shrink to whatever vertical room is
    // left (unchanged); a long article list costs those rows before it
    // costs anything else on the label.
    const artText = (L.articles || []).join('   ') || '—';
    const artLines = doc.splitTextToSize(artText, W - 2 * M);
    doc.text(artLines, M, y + 6);
    y += 10 * artLines.length + 4;
    doc.setDrawColor(204, 204, 204); doc.line(M, y, W - M, y); y += 6;
    // measurements for THIS size, two columns, above the QR / footer band
    const qrSize = 84;
    const bandTop = H - M - qrSize - 4;
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 7, grey);
    doc.text('MEASUREMENTS  ·  SIZE ' + String(L.size || '') + '  ·  inches  ·  ±' + (L.tol != null ? L.tol : 0.5) + ' in', M, y + 6);
    y += 10;
    const rows = L.measurements || [];
    const lineH = 10.5, colW = (W - 2 * M) / 2;
    const perCol = Math.max(0, Math.floor((bandTop - 4 - y) / lineH));
    const shown = rows.slice(0, perCol * 2);
    const half = Math.ceil(shown.length / 2);
    shown.forEach(function (r, k) {
      const col = k < half ? 0 : 1, row = k < half ? k : k - half;
      const x = M + col * colW, yy = y + row * lineH + 7;
      _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 8, ink);
      doc.text(doc.splitTextToSize(String(r.label || ''), colW - 40)[0] || '', x, yy);
      _setFont(doc, PRINT_FONTS.bodyBold, 'bold', 8, black);
      doc.text(String(r.value == null ? '—' : r.value), x + colW - 8, yy, { align: 'right' });
    });
    if (!rows.length) {
      _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 8, grey);
      doc.text('no measurements recorded yet', M, y + 7);
    } else if (rows.length > shown.length) {
      _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 7, grey);
      doc.text('+' + (rows.length - shown.length) + ' more in the app', M, bandTop - 2);
    }
    // QR, bottom right
    _drawQrMatrix(doc, L.qr, W - M - qrSize, H - M - qrSize, qrSize);
    // footer, bottom left
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 7, grey);
    const foot = [];
    if (L.gridUpdated) foot.push('measurements updated ' + L.gridUpdated);
    foot.push('scan for the full grid');
    if (L.url) foot.push(doc.splitTextToSize(String(L.url), W - 2 * M - qrSize - 10)[0] || '');
    doc.text(foot, M, H - M - qrSize + 10);
  });
}
/* Draw a QR module matrix (bool[][]) as filled squares with a quiet zone. */
function _drawQrMatrix(doc, matrix, x, y, size) {
  if (!matrix || !matrix.length) return;
  const n = matrix.length;
  const quiet = 2;                      // modules of white margin, per the spec's minimum for print
  const cell = size / (n + quiet * 2);
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, size, size, 'F');
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < n; c++) {
      if (row[c]) doc.rect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell, cell, 'F');
    }
  }
}

/* ── Master Accounts — five variants (M1.4, MASTER_ACCOUNTS_PLAN.md §31) ──
     ma-ledger            A4 LANDSCAPE · urdu none    one account, a range
     ma-statement-party   A4 portrait  · minimal      their account + paid directly
     ma-statement-holder  A4 portrait  · none         movements, confirmations, count
     ma-receipt           A5 (420×595) · FULL         a transfer's handover slip
     ma-voucher           A5 (420×595) · FULL         a money-out payment voucher
     ma-collection        A5 (420×595) · FULL         a courier collection's receipt (M2)
   The three A4 ones use the shared header, section band and footer — page-
   aware through _pageBox() — plus one table (_prMaTable) whose head repeats
   on every page. The two slips are a custom page and draw their own layout,
   like the pattern label, and stamp their own footer.
   EVERY FIGURE ARRIVES COMPUTED by js/ma-core.js (maPdf*Data): nothing here
   adds, nets or balances — it formats and draws. Money prints the way the
   screen prints it (₨1,50,000, −₨2,500), falling back to "Rs " and "-" only
   when Aptos did not embed: Helvetica has neither glyph. Urdu is drawn only
   when the JNN font really embedded (_urduOn) — never tofu. Names are
   `_prMa*` / `_PR_MA_*`: classic scripts share one lexical scope. */
const _PR_MA_UR = {
  receipt: 'رقم حوالگی کی رسید',
  voucher: 'ادائیگی واؤچر',
  amount: 'رقم',
  paid: 'ادا شدہ رقم',
  from: 'منجانب',
  to: 'بنام',
  paidTo: 'بنام',
  paidFrom: 'ادائیگی از',
  forWhat: 'مد',
  tax: 'ٹیکس',
  particulars: 'تفصیل',
  note: 'نوٹ',
  centre: 'شعبہ',
  date: 'تاریخ',
  number: 'نمبر',
  state: 'کیفیت',
  givenBy: 'دینے والا',
  receivedBy: 'وصول کنندہ',
  voided: 'منسوخ',
  revised: 'ترمیم شدہ'
};
/* The collection receipt's own words. Kept apart from _PR_MA_UR so that
   _prMaUrduOk asks the font about these ONLY for a collection receipt — the
   receipt and the voucher are asked exactly what they always were. */
const _PR_MA_UR_COL = {
  title: 'وصولی کی رسید',
  amount: 'وصول شدہ رقم',
  courier: 'کوریئر',
  holder: 'ہولڈر',
  collectedBy: 'وصول کرنے والا',
  covers: 'رسیدیں',
  expected: 'متوقع',
  counted: 'گنتی',
  difference: 'فرق'
};
const _PR_MA_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const _PR_MA_MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ₨ and U+2212 only where the embedded Aptos can draw them. */
function _prMaGlyphs(doc) {
  const m = doc && doc.__groovyFonts;
  const ok = !!(m && m[PRINT_FONTS.bodyRegular] && m[PRINT_FONTS.bodyRegular] !== 'helvetica' &&
    m[PRINT_FONTS.display] && m[PRINT_FONTS.display] !== 'helvetica');
  return ok ? { rs: '₨', minus: '−' } : { rs: 'Rs ', minus: '-' };
}
/* 1,50,000 — three digits, then twos (maGroup's rule, js/ma-core.js). */
function _prMaGroup(n) {
  const s = String(Math.abs(Math.round(Number(n) || 0)));
  if (s.length <= 3) return s;
  const last = s.slice(-3); let rest = s.slice(0, -3); const parts = [];
  while (rest.length > 2) { parts.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
  if (rest) parts.unshift(rest);
  return parts.join(',') + ',' + last;
}
/* maRs's shape: −₨2,500. */
function _prMaRs(doc, n) {
  const v = Math.round(Number(n) || 0);
  const g = _prMaGlyphs(doc);
  return (v < 0 ? g.minus : '') + g.rs + _prMaGroup(v);
}
/* A debit or credit cell: blank for nothing, like the screen. */
function _prMaCell(doc, n) {
  return Math.round(Number(n) || 0) ? _prMaRs(doc, n) : '';
}
/* A party's balance: > 0 is a credit (Groovy owes them), < 0 a debit. */
function _prMaSide(doc, n) {
  const v = Math.round(Number(n) || 0);
  return v ? _prMaRs(doc, Math.abs(v)) + (v > 0 ? ' Cr' : ' Dr') : _prMaRs(doc, 0);
}
/* 'YYYY-MM-DD' → 'Tue 20 Oct 2026' (maDayLabel(day, true)'s shape). */
function _prMaDay(iso) {
  const s = String(iso == null ? '' : iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  return _PR_MA_WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' + d + ' ' + _PR_MA_MO[m - 1] + ' ' + y;
}
/* A stored millisecond stamp → 'Tue 20 Oct 2026, 14:05' in this device's zone. */
function _prMaWhen(ms) {
  if (!Number.isFinite(ms) || !ms) return '';
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, '0');
  return _prMaDay(d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())) + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}
function _prMaRange(r) {
  r = r || {};
  const span = r.from && r.to ? _prMaDay(r.from) + ' – ' + _prMaDay(r.to) : (r.to ? 'to ' + _prMaDay(r.to) : '');
  return [r.label, span].filter(Boolean).join('  ·  ');
}
/* Cut to a width with an ellipsis — measured with getTextWidth, never a
   character guess — for every cell that does not wrap. */
function _prMaFit(doc, txt, w) {
  txt = String(txt == null ? '' : txt);
  if (w <= 0) return '';
  let tw = 0;
  try { tw = doc.getTextWidth(txt); } catch (e) { return txt; }
  if (tw <= w) return txt;
  let lo = 0, hi = txt.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(txt.slice(0, mid) + '…') <= w) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? txt.slice(0, lo) + '…' : '';
}
function _prMaSplit(doc, txt, w) {
  txt = String(txt == null ? '' : txt);
  if (!txt) return [''];
  try {
    const out = doc.splitTextToSize(txt, w);
    return Array.isArray(out) && out.length ? out : [txt];
  } catch (e) { return [txt]; }
}
/* A particulars cell: each non-empty part on a line of its own, so an
   account name ("Payable — vendors") never runs into a note. */
function _prMaLines() {
  return Array.prototype.slice.call(arguments).filter(Boolean).join('\n');
}
/* Can the embedded Urdu font draw what jsPDF will actually emit? jsPDF 2.5.1
   rewrites every Arabic-script letter into a Unicode PRESENTATION FORM
   before drawing (its arabic plugin runs on every text() call), and the
   Jameel Noori Nastaleeq TTF carries none of those forms — measured 28 Sept
   2026: "گیٹ پاس" goes out as six code points and the font has none of
   them — so Urdu that "embedded" draws NOTHING, here and on the gate pass
   alike. A slip therefore asks the font itself, for every Urdu string it may
   draw, and prints clean English when the answer is no: an empty gap under
   every label reads as broken. A font that does carry the forms passes the
   same check, and the slip turns bilingual with no code change. */
function _prMaUrduOk(doc) {
  if (!_urduOn(doc)) return false;
  if (doc.__prMaUrduOk !== undefined) return doc.__prMaUrduOk;
  let ok = false;
  try {
    const font = doc.getFont(_resolveFont(doc, PRINT_FONTS.urdu), 'normal');
    const m = font && font.metadata;
    if (m && typeof m.characterToGlyph === 'function') {
      const all = Object.keys(_PR_MA_UR).map(function (k) { return _PR_MA_UR[k]; })
        .concat(doc.__groovyDocType === 'Collection Receipt'
          ? Object.keys(_PR_MA_UR_COL).map(function (k) { return _PR_MA_UR_COL[k]; }) : [])
        .concat([_footerUr(doc.__groovyDocType)]).join(' ');
      const drawn = typeof doc.processArabic === 'function' ? doc.processArabic(all) : all;
      ok = Array.from(String(drawn)).every(function (ch) { return /\s/.test(ch) || m.characterToGlyph(ch.codePointAt(0)) > 0; });
    }
  } catch (e) { ok = false; }
  doc.__prMaUrduOk = ok;
  return ok;
}

/* ── the three A4 documents: title, figures, notes, sections, the table ── */
function _prMaBottom(doc) {
  const P = _pageBox(doc);
  return P.pageHeight - P.marginBottom - 24;     // clear of the footer at pageHeight − 36
}
function _prMaTitle(doc, title, lines) {
  const P = _pageBox(doc);
  let y = (doc.__groovyY || P.marginTop) + 6;
  _setFont(doc, PRINT_FONTS.display, 'bold', 18, PRINT_COLORS.text);
  doc.text(_prMaFit(doc, title, P.contentWidth), P.marginLeft, y + 16);
  y += 24;
  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 10, PRINT_COLORS.greyAccent);
  (lines || []).filter(Boolean).forEach(function (s) {
    _prMaSplit(doc, s, P.contentWidth).forEach(function (ln) { doc.text(ln, P.marginLeft, y + 9); y += 13; });
  });
  doc.__groovyY = y + 4;
  return doc.__groovyY;
}
/* A row of figures: [[label, value], …] across the content width. */
function _prMaFigures(doc, items) {
  const P = _pageBox(doc);
  const y = (doc.__groovyY || P.marginTop) + 4;
  const w = P.contentWidth / items.length;
  items.forEach(function (it, i) {
    const x = P.marginLeft + i * w;
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 9, PRINT_COLORS.greyAccent);
    doc.text(_prMaFit(doc, it[0], w - 12), x, y + 9);
    _setFont(doc, PRINT_FONTS.display, 'bold', 15, PRINT_COLORS.text);
    doc.text(_prMaFit(doc, it[1], w - 12), x, y + 27);
  });
  doc.__groovyY = y + 38;
  return doc.__groovyY;
}
/* A small paragraph, breaking to a new page when it has to. */
function _prMaNote(doc, text, o) {
  o = o || {};
  const P = _pageBox(doc);
  const size = o.size || 9;
  const lh = size + 3;
  let y = doc.__groovyY || P.marginTop;
  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', size, o.color || PRINT_COLORS.greyAccent);
  _prMaSplit(doc, text, P.contentWidth).forEach(function (ln) {
    if (y + lh > _prMaBottom(doc)) {
      doc.addPage(); y = P.marginTop;
      _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', size, o.color || PRINT_COLORS.greyAccent);
    }
    doc.text(ln, P.marginLeft, y + size);
    y += lh;
  });
  doc.__groovyY = y + 4;
  return doc.__groovyY;
}
/* The shared grey section band — on a fresh page if the band and the first
   rows under it would not fit. */
function _prMaSection(doc, title, need) {
  const P = _pageBox(doc);
  if ((doc.__groovyY || P.marginTop) + (need || 80) > _prMaBottom(doc)) { doc.addPage(); doc.__groovyY = P.marginTop; }
  _renderSectionHeader(doc, { titleEn: title });
  doc.__groovyY += 2;
  return doc.__groovyY;
}
/**
 * A table that breaks across pages and REPEATS ITS HEAD on every page it
 * reaches, under a "— continued" line naming what it continues.
 * o = { cols: [{ h, w (pt) | 'flex', a: 'right', wrap: true }],
 *       rows: [{ cells: [string], strong, rule }], size, continued }
 * A `wrap` column wraps — a description is never truncated — and every
 * other cell is fitted to its width with an ellipsis. The page geometry is
 * _pageBox(doc): portrait or landscape alike.
 * @returns {number} Y just below the last row.
 */
function _prMaTable(doc, o) {
  const P = _pageBox(doc);
  const size = o.size || 9;
  const lineH = size + 2.5;
  const pad = 5;
  const fixed = o.cols.reduce(function (t, c) { return t + (c.w === 'flex' ? 0 : c.w); }, 0);
  const flexN = o.cols.filter(function (c) { return c.w === 'flex'; }).length || 1;
  const ws = o.cols.map(function (c) { return c.w === 'flex' ? Math.max(40, (P.contentWidth - fixed) / flexN) : c.w; });
  const xs = []; let acc = P.marginLeft;
  ws.forEach(function (w) { xs.push(acc); acc += w; });
  const R = P.marginLeft + P.contentWidth;
  const line = _pc(PRINT_COLORS.greyLine), soft = _pc('#E6E6E6'), shade = _pc(PRINT_COLORS.greyShade), ink = _pc(PRINT_COLORS.text);
  let y = (doc.__groovyY || P.marginTop) + 4;
  const head = function () {
    const h = lineH + 9;
    doc.setFillColor(shade[0], shade[1], shade[2]);
    doc.rect(P.marginLeft, y, P.contentWidth, h, 'F');
    _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', size, PRINT_COLORS.greyAccent);
    o.cols.forEach(function (c, i) {
      const t = _prMaFit(doc, c.h, ws[i] - pad * 2);
      if (c.a === 'right') doc.text(t, xs[i] + ws[i] - pad, y + h - 6, { align: 'right' });
      else doc.text(t, xs[i] + pad, y + h - 6);
    });
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(0.6);
    doc.line(P.marginLeft, y + h, R, y + h);
    y += h;
  };
  head();
  (o.rows || []).forEach(function (r) {
    _setFont(doc, PRINT_FONTS.bodyRegular, r.strong ? 'bold' : 'normal', size, PRINT_COLORS.text);
    const cells = o.cols.map(function (c, i) {
      const v = r.cells[i] == null ? '' : String(r.cells[i]);
      return c.wrap ? _prMaSplit(doc, v, ws[i] - pad * 2) : [_prMaFit(doc, v, ws[i] - pad * 2)];
    });
    const n = cells.reduce(function (m, c) { return Math.max(m, c.length); }, 1);
    const h = n * lineH + 7;
    if (y + h > _prMaBottom(doc)) {
      doc.addPage();
      y = P.marginTop;
      if (o.continued) {
        _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 8.5, PRINT_COLORS.greyAccent);
        doc.text(_prMaFit(doc, o.continued + ' — continued', P.contentWidth), P.marginLeft, y + 9);
        y += 16;
      }
      head();
      _setFont(doc, PRINT_FONTS.bodyRegular, r.strong ? 'bold' : 'normal', size, PRINT_COLORS.text);
    }
    if (r.rule) {
      doc.setDrawColor(ink[0], ink[1], ink[2]);
      doc.setLineWidth(0.9);
      doc.line(P.marginLeft, y, R, y);
    }
    cells.forEach(function (ls, i) {
      if (o.cols[i].a === 'right') doc.text(ls, xs[i] + ws[i] - pad, y + lineH + 1.5, { align: 'right' });
      else doc.text(ls, xs[i] + pad, y + lineH + 1.5);
    });
    y += h;
    doc.setDrawColor(soft[0], soft[1], soft[2]);
    doc.setLineWidth(0.3);
    doc.line(P.marginLeft, y, R, y);
  });
  doc.__groovyY = y;
  return y;
}
function _prMaHeader(doc, type, number, data) {
  _renderHeader(doc, {
    documentType: type, documentNumber: number || '',
    issuedDate: _prMaDay(data.printedOn) || '—', issuedBy: data.printedBy || '—'
  });
}

/**
 * ma-ledger — one account for a range: opening, every posting with a
 * running balance, the period's totals, closing. A4 LANDSCAPE.
 * data (maPdfLedgerData) = { account:{code,name,normal}, range:{from,to,label},
 *   filters:[string], opening, closing, totals:{dr,cr,count},
 *   balanceHidden: null | {narrow:[string], mirror, why, mirrorBalance},
 *   rows:[{date,no,kind,who,contra,note,dr,cr,balance}], printedOn, printedBy }
 * balanceHidden (M1.6b): no opening, closing or Balance column — under a
 * narrowing filter the lines shown are not the account's balance, and the
 * drawer's balance is Store Accounts' (its figure, or "not read").
 */
function _renderMaLedger(doc, data) {
  data = data || {};
  const a = data.account || {};
  const t = data.totals || {};
  const rows = data.rows || [];
  const r = data.range || {};
  // M1.6b (money F4/F5): no running balance, opening or closing when the
  // core says it would not be the account's balance — a narrowing filter, or
  // the drawer, whose balance is Store Accounts' (printed as that module has
  // it, or "not read", the holder statement's way).
  const hid = data.balanceHidden || null;
  const name = (a.code ? a.code + ' · ' : '') + (a.name || 'Account');
  const why = hid && hid.why ? String(hid.why) : '';
  _prMaHeader(doc, 'Ledger', a.code, data);
  _prMaTitle(doc, name, [
    _prMaRange(r),
    (data.filters && data.filters.length) ? 'Filtered — ' + data.filters.join('  ·  ') : '',
    hid ? (hid.mirror ? 'Kept in Store Accounts: its balance is that module’s, and only handovers to and from it are listed here.'
      : (why ? why.charAt(0).toUpperCase() + why.slice(1) + '.' : 'No running balance under this filter.'))
      : (a.normal === 'cr' ? 'Credit' : 'Debit') + '-normal: the balance is in the account’s own sense; a minus sign is a balance on the other side.'
  ]);
  _prMaFigures(doc, !hid
    ? [['Opening', _prMaRs(doc, data.opening)], ['Debits', _prMaRs(doc, t.dr)], ['Credits', _prMaRs(doc, t.cr)], ['Closing', _prMaRs(doc, data.closing)]]
    : hid.mirror
      ? [['Debits', _prMaRs(doc, t.dr)], ['Credits', _prMaRs(doc, t.cr)],
         ['Balance in Store Accounts', hid.mirrorBalance == null ? 'not read' : _prMaRs(doc, hid.mirrorBalance)]]
      : [['Debits', _prMaRs(doc, t.dr)], ['Credits', _prMaRs(doc, t.cr)]]);
  const bal = function (cells, v) { if (!hid) cells.push(v); return cells; };
  const body = [];
  if (!hid) body.push({ cells: [_prMaDay(r.from), '', '', '', 'Opening balance', '', '', _prMaRs(doc, data.opening)], strong: true });
  rows.forEach(function (x) {
    body.push({ cells: bal([_prMaDay(x.date), x.no, x.kind, x.who, _prMaLines(x.contra, x.note),
      _prMaCell(doc, x.dr), _prMaCell(doc, x.cr)], _prMaRs(doc, x.balance)) });
  });
  if (!rows.length) body.push({ cells: bal(['', '', '', '', 'Nothing was posted to this account in the period.', '', ''], '') });
  body.push({ cells: bal(['', '', '', '', 'Period totals · ' + (t.count || 0) + ' posting' + (t.count === 1 ? '' : 's'),
    _prMaRs(doc, t.dr), _prMaRs(doc, t.cr)], ''), strong: true, rule: true });
  if (!hid) body.push({ cells: [_prMaDay(r.to), '', '', '', 'Closing balance', '', '', _prMaRs(doc, data.closing)], strong: true });
  const cols = [{ h: 'Date', w: 80 }, { h: 'No.', w: 62 }, { h: 'Kind', w: 92, wrap: true }, { h: 'Party / holder', w: 118, wrap: true },
    { h: 'Particulars', w: 'flex', wrap: true }, { h: 'Debit', w: 76, a: 'right' }, { h: 'Credit', w: 76, a: 'right' }];
  if (!hid) cols.push({ h: 'Balance', w: 84, a: 'right' });
  _prMaTable(doc, {
    size: 8.5, rows: body, continued: name + '  ·  ' + _prMaRange(r),
    cols: cols
  });
  doc.__groovyY += 8;
  _prMaNote(doc, 'Void documents post nothing and are not listed. A transfer still waiting to be confirmed counts in neither holder until it is.');
}

/**
 * ma-statement-holder — one holder for a range. A4 portrait.
 * data (maPdfHolderStatementData) = { holder:{code,name,person,mirror},
 *   range, opening, closing, mirrorBalance, totals:{in,out,count},
 *   rows:[{date,no,kind,who,contra,note,in,out,balance}], waiting:{in,out},
 *   confirmations:[{date,no,direction,other,amount,state,by,forWho,at,via,paper}],
 *   lastCount:{date,no,counted,difference}|null, printedOn, printedBy }
 * A holder kept in Store Accounts (mirror) prints no opening, closing or
 * running balance — its balance is that module's.
 */
function _renderMaStatementHolder(doc, data) {
  data = data || {};
  const h = data.holder || {};
  const t = data.totals || {};
  const rows = data.rows || [];
  const r = data.range || {};
  const mirror = !!h.mirror;
  _prMaHeader(doc, 'Holder Statement', h.code, data);
  _prMaTitle(doc, h.name || 'Holder', [
    [h.person ? 'Held by ' + h.person : '', _prMaRange(r)].filter(Boolean).join('  ·  '),
    mirror ? 'Kept in Store Accounts: its balance is that module’s, and only handovers to and from it are listed here.' : ''
  ]);
  _prMaFigures(doc, mirror
    ? [['Money in', _prMaRs(doc, t.in)], ['Money out', _prMaRs(doc, t.out)],
       ['Balance in Store Accounts', data.mirrorBalance == null ? 'not read' : _prMaRs(doc, data.mirrorBalance)]]
    : [['Opening', _prMaRs(doc, data.opening)], ['Money in', _prMaRs(doc, t.in)],
       ['Money out', _prMaRs(doc, t.out)], ['Closing', _prMaRs(doc, data.closing)]]);
  // Who (and the kind, unless In/Out already says it), the other side, the note.
  const what = function (x) {
    const kind = x.kind === 'Money out' || x.kind === 'Money in' ? '' : x.kind;
    return _prMaLines([kind, x.who].filter(Boolean).join(' · '), x.contra, x.note);
  };
  const body = [];
  if (!mirror) body.push({ cells: [_prMaDay(r.from), '', 'Opening balance', '', '', _prMaRs(doc, data.opening)], strong: true });
  rows.forEach(function (x) {
    const c = [_prMaDay(x.date), x.no, what(x), _prMaCell(doc, x.in), _prMaCell(doc, x.out)];
    if (!mirror) c.push(_prMaRs(doc, x.balance));
    body.push({ cells: c });
  });
  if (!rows.length) body.push({ cells: ['', '', 'Nothing moved in the period.', '', '', ''] });
  const tot = ['', '', 'Period totals · ' + (t.count || 0) + ' movement' + (t.count === 1 ? '' : 's'), _prMaRs(doc, t.in), _prMaRs(doc, t.out)];
  if (!mirror) tot.push('');
  body.push({ cells: tot, strong: true, rule: true });
  if (!mirror) body.push({ cells: [_prMaDay(r.to), '', 'Closing balance', '', '', _prMaRs(doc, data.closing)], strong: true });
  const cols = [{ h: 'Date', w: 80 }, { h: 'No.', w: 60 }, { h: 'Particulars', w: 'flex', wrap: true },
    { h: 'In', w: 70, a: 'right' }, { h: 'Out', w: 70, a: 'right' }];
  if (!mirror) cols.push({ h: 'Balance', w: 80, a: 'right' });
  _prMaTable(doc, { size: 9, rows: body, cols: cols, continued: (h.name || 'Holder') + '  ·  ' + _prMaRange(r) });

  const conf = data.confirmations || [];
  doc.__groovyY += 6;
  _prMaSection(doc, 'Confirmations');
  if (conf.length) {
    _prMaTable(doc, {
      size: 9, continued: (h.name || 'Holder') + ' — confirmations',
      cols: [{ h: 'Date', w: 80 }, { h: 'No.', w: 62 }, { h: 'Handover', w: 'flex', wrap: true },
        { h: 'Amount', w: 80, a: 'right' }, { h: 'State', w: 150, wrap: true }],
      rows: conf.map(function (x) {
        const state = x.state === 'waiting'
          ? 'Waiting for ' + (x.by || 'the receiver') + (x.paper ? ' — a signed receipt, then an owner confirms' : '')
          : 'Confirmed by ' + (x.by || '—') + (x.forWho ? ' for ' + x.forWho : '') + (x.via === 'paper' ? ', on paper' : '') + (x.at ? ' · ' + _prMaWhen(x.at) : '');
        return { cells: [_prMaDay(x.date), x.no, (x.direction === 'in' ? 'In from ' : 'Out to ') + (x.other || ''), _prMaRs(doc, x.amount), state] };
      })
    });
    doc.__groovyY += 6;
  } else {
    _prMaNote(doc, 'No handover to or from this holder needed a confirmation in the period.');
  }
  const w = data.waiting || {};
  if (w.in || w.out) {
    const sides = [w.in ? _prMaRs(doc, w.in) + ' in' : '', w.out ? _prMaRs(doc, w.out) + ' out' : ''].filter(Boolean).join(' · ');
    _prMaNote(doc, 'Waiting now: ' + sides + ' — money waiting to be confirmed counts in neither holder until it is.');
  }
  _prMaSection(doc, 'Last count', 50);
  const lc = data.lastCount;
  let text;
  if (lc) {
    const d = Math.round(Number(lc.difference) || 0);
    text = 'Counted ' + _prMaRs(doc, lc.counted) + ' on ' + _prMaDay(lc.date) + (lc.no ? ' (' + lc.no + ')' : '') + ' — ' +
      (d ? _prMaRs(doc, Math.abs(d)) + (d > 0 ? ' over' : ' short') + ' against the book.' : 'it matched the book.');
  } else {
    text = mirror ? 'Counted in Store Accounts, not here.' : 'This holder has never been counted.';
  }
  _prMaNote(doc, text, { size: 10, color: PRINT_COLORS.text });
}

/**
 * ma-statement-party — a party's statement for a range. A4 portrait.
 * data (maPdfPartyStatementData) = { party:{name,code,kind,terms,phone},
 *   range, opening, closing, totals:{dr,cr,count},
 *   rows:[{date,no,kind,account,contra,note,dr,cr,balance}],
 *   direct:{paid,received,count,rows:[{date,no,kind,holder,contra,note,paid,received}]},
 *   printedOn, printedBy }
 * Balance > 0 is a CREDIT (Groovy owes them), < 0 a DEBIT (they owe Groovy).
 */
function _renderMaStatementParty(doc, data) {
  data = data || {};
  const p = data.party || {};
  const t = data.totals || {};
  const rows = data.rows || [];
  const r = data.range || {};
  const dir = data.direct || {};
  const who = p.name || 'this party';
  _prMaHeader(doc, 'Statement of Account', p.code, data);
  _prMaTitle(doc, p.name || 'Party', [[p.kind, p.code, p.terms, p.phone].filter(Boolean).join('  ·  '), _prMaRange(r)]);
  _prMaFigures(doc, [['Opening', _prMaSide(doc, data.opening)], ['Debits', _prMaRs(doc, t.dr)],
    ['Credits', _prMaRs(doc, t.cr)], ['Closing', _prMaSide(doc, data.closing)]]);
  _prMaNote(doc, 'Cr — Groovy owes ' + who + '. Dr — ' + who + ' owes Groovy. Their account is every bill, payment, advance and opening balance booked against them.');

  _prMaSection(doc, 'Their account');
  const body = [{ cells: [_prMaDay(r.from), '', 'Opening balance', '', '', _prMaSide(doc, data.opening)], strong: true }];
  rows.forEach(function (x) {
    body.push({ cells: [_prMaDay(x.date), x.no, _prMaLines(x.kind, x.contra, x.note),
      _prMaCell(doc, x.dr), _prMaCell(doc, x.cr), _prMaSide(doc, x.balance)] });
  });
  if (!rows.length) body.push({ cells: ['', '', 'Nothing was booked against ' + who + '’s account in the period.', '', '', ''] });
  body.push({ cells: ['', '', 'Period totals · ' + (t.count || 0) + ' posting' + (t.count === 1 ? '' : 's'),
    _prMaRs(doc, t.dr), _prMaRs(doc, t.cr), ''], strong: true, rule: true });
  body.push({ cells: [_prMaDay(r.to), '', 'Closing balance', '', '', _prMaSide(doc, data.closing)], strong: true });
  _prMaTable(doc, {
    size: 9, rows: body, continued: who + ' — their account',
    cols: [{ h: 'Date', w: 80 }, { h: 'No.', w: 60 }, { h: 'Particulars', w: 'flex', wrap: true },
      { h: 'Debit', w: 70, a: 'right' }, { h: 'Credit', w: 70, a: 'right' }, { h: 'Balance', w: 86, a: 'right' }]
  });

  doc.__groovyY += 6;
  _prMaSection(doc, 'Paid and received directly');
  _prMaNote(doc, 'Settled on the spot, from or into one of Groovy’s holders — it did not go through their account, so the balance above does not move.');
  const drows = dir.rows || [];
  if (drows.length) {
    const b2 = drows.map(function (x) {
      return { cells: [_prMaDay(x.date), x.no, _prMaLines([x.kind, x.holder].filter(Boolean).join(' · '), x.contra, x.note),
        _prMaCell(doc, x.paid), _prMaCell(doc, x.received)] };
    });
    b2.push({ cells: ['', '', 'Totals · ' + (dir.count || 0) + ' posting' + (dir.count === 1 ? '' : 's'),
      _prMaRs(doc, dir.paid), _prMaRs(doc, dir.received)], strong: true, rule: true });
    _prMaTable(doc, {
      size: 9, rows: b2, continued: who + ' — paid and received directly',
      cols: [{ h: 'Date', w: 80 }, { h: 'No.', w: 60 }, { h: 'Particulars', w: 'flex', wrap: true },
        { h: 'Paid to them', w: 80, a: 'right' }, { h: 'Received', w: 76, a: 'right' }]
    });
  } else {
    _prMaNote(doc, 'Nothing was paid to or received from ' + who + ' directly in the period.');
  }
}

/* ── the two A5 slips: their own page, their own footer ─────────────────── */
function _prMaA5(doc) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 24;
  return { W: W, H: H, M: M, L: M, R: W - M, CW: W - 2 * M };
}
/* English label, and — only when JNN really embedded — its Urdu under it.
   @returns {number} the height used. */
function _prMaLabel(doc, en, ur, x, y, size) {
  size = size || 9;
  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', size, PRINT_COLORS.greyAccent);
  doc.text(String(en || ''), x, y);
  if (ur && _prMaUrduOk(doc)) {
    _setFont(doc, PRINT_FONTS.urdu, 'normal', size + 1, PRINT_COLORS.greyAccent);
    doc.text(String(ur), x, y + size + 5);
    return size * 2 + 7;
  }
  return size + 2;
}
function _prMaSlipHead(doc, o) {
  const b = _prMaA5(doc);
  const top = b.M;
  _setFont(doc, PRINT_FONTS.display, 'bold', 18, PRINT_COLORS.black);
  doc.text('GROOVY', b.L, top + 15);
  _setFont(doc, PRINT_FONTS.display, 'bold', 13, PRINT_COLORS.black);
  doc.text(_prMaFit(doc, o.number || '', b.CW * 0.5), b.R, top + 13, { align: 'right' });
  _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 10, PRINT_COLORS.greyAccent);
  doc.text(String(o.title || ''), b.L, top + 31);
  doc.text(_prMaFit(doc, o.date || '', b.CW * 0.5), b.R, top + 29, { align: 'right' });
  let y = top + 31;
  if (o.titleUr && _prMaUrduOk(doc)) {
    _setFont(doc, PRINT_FONTS.urdu, 'normal', 12, PRINT_COLORS.greyAccent);
    doc.text(String(o.titleUr), b.L, y + 17);
    y += 17;
  }
  const c = _pc(PRINT_COLORS.greyLine);
  doc.setDrawColor(c[0], c[1], c[2]);
  doc.setLineWidth(0.5);
  doc.line(b.L, y + 9, b.R, y + 9);
  return y + 17;
}
/* VOID (a red box with who, when and why) and "Revised · rev N". */
function _prMaStamps(doc, data, y) {
  const b = _prMaA5(doc);
  if (data.void) {
    const v = data.void;
    const red = _pc(PRINT_COLORS.red);
    _setFont(doc, PRINT_FONTS.display, 'bold', 26, PRINT_COLORS.red);
    const tagW = doc.getTextWidth('VOID') + 26;
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 9, PRINT_COLORS.red);
    const why = [].concat(
      _prMaSplit(doc, 'Voided' + (v.at ? ' ' + _prMaWhen(v.at) : '') + (v.by ? ' by ' + v.by : '') + '.', b.CW - tagW - 10),
      v.reason ? _prMaSplit(doc, 'Reason: ' + v.reason, b.CW - tagW - 10) : [],
      _prMaSplit(doc, 'It moves no money.', b.CW - tagW - 10));
    const h = Math.max(_prMaUrduOk(doc) ? 58 : 46, 12 + why.length * 11);
    doc.setDrawColor(red[0], red[1], red[2]);
    doc.setLineWidth(2);
    doc.rect(b.L, y, b.CW, h, 'S');
    _setFont(doc, PRINT_FONTS.display, 'bold', 26, PRINT_COLORS.red);
    doc.text('VOID', b.L + 12, y + 31);
    if (_prMaUrduOk(doc)) {
      _setFont(doc, PRINT_FONTS.urdu, 'normal', 12, PRINT_COLORS.red);
      doc.text(_PR_MA_UR.voided, b.L + 12, y + 49);
    }
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 9, PRINT_COLORS.red);
    doc.text(why, b.L + tagW, y + 15);
    y += h + 10;
  }
  if (data.revised) {
    const rv = data.revised;
    _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', 10, PRINT_COLORS.text);
    const head = 'Revised · rev ' + rv.n;
    doc.text(head, b.L, y + 10);
    let x = b.L + doc.getTextWidth(head) + 8;
    if (_prMaUrduOk(doc)) {
      _setFont(doc, PRINT_FONTS.urdu, 'normal', 10, PRINT_COLORS.text);
      doc.text(_PR_MA_UR.revised, b.R, y + 10, { align: 'right' });
    }
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 9, PRINT_COLORS.greyAccent);
    const tail = [(rv.at ? _prMaWhen(rv.at) : '') + (rv.by ? ' by ' + rv.by : ''), rv.reason].filter(Boolean).join(' — ');
    const lines = _prMaSplit(doc, tail, b.CW - (x - b.L) - (_prMaUrduOk(doc) ? 60 : 0));
    doc.text(lines, x, y + 10);
    y += 8 + lines.length * 11;
    y += 6;
  }
  return y;
}
function _prMaAmountBox(doc, y, en, ur, amount, words, isVoid) {
  const b = _prMaA5(doc);
  const shade = _pc(PRINT_COLORS.greyShade);
  _setFont(doc, PRINT_FONTS.bodyRegular, 'italic', 10, PRINT_COLORS.text);
  const lines = _prMaSplit(doc, String(words || ''), b.CW - 24);
  const h = 50 + lines.length * 13;
  doc.setFillColor(shade[0], shade[1], shade[2]);
  doc.rect(b.L, y, b.CW, h, 'F');
  _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', 9, PRINT_COLORS.greyAccent);
  doc.text(String(en), b.L + 12, y + 15);
  if (ur && _prMaUrduOk(doc)) {
    _setFont(doc, PRINT_FONTS.urdu, 'normal', 11, PRINT_COLORS.greyAccent);
    doc.text(String(ur), b.R - 12, y + 16, { align: 'right' });
  }
  _setFont(doc, PRINT_FONTS.display, 'bold', 24, PRINT_COLORS.black);
  const fig = _prMaRs(doc, amount);
  doc.text(fig, b.L + 12, y + 40);
  if (isVoid) {
    // Struck through in red: a void slip's figure must never read as live.
    const red = _pc(PRINT_COLORS.red);
    doc.setDrawColor(red[0], red[1], red[2]);
    doc.setLineWidth(2.2);
    doc.line(b.L + 8, y + 32, b.L + 16 + doc.getTextWidth(fig), y + 32);
  }
  _setFont(doc, PRINT_FONTS.bodyRegular, 'italic', 10, PRINT_COLORS.text);
  doc.text(lines, b.L + 12, y + 56);
  return y + h + 10;
}
/* Label / value rows. rows: [[en, ur, value, strong]] — a blank value is
   left out. A value wraps; it is never cut. */
function _prMaSlipRows(doc, y, rows, stopAt) {
  const b = _prMaA5(doc);
  const lw = 112;
  const soft = _pc('#E6E6E6');
  rows.filter(function (r) { return r && r[2] !== undefined && r[2] !== null && r[2] !== ''; }).forEach(function (r) {
    _setFont(doc, PRINT_FONTS.bodyRegular, r[3] ? 'bold' : 'normal', 10.5, PRINT_COLORS.text);
    const vl = _prMaSplit(doc, r[2], b.CW - lw - 4);
    const lh = _prMaUrduOk(doc) && r[1] ? 27 : 12;
    const h = Math.max(lh, vl.length * 13) + 9;
    if (y + h > stopAt) { doc.addPage(); y = b.M; }
    _prMaLabel(doc, r[0], r[1], b.L, y + 11, 9);
    _setFont(doc, PRINT_FONTS.bodyRegular, r[3] ? 'bold' : 'normal', 10.5, PRINT_COLORS.text);
    doc.text(vl, b.L + lw, y + 11);
    y += h;
    doc.setDrawColor(soft[0], soft[1], soft[2]);
    doc.setLineWidth(0.3);
    doc.line(b.L, y - 3, b.R, y - 3);
  });
  return y;
}
/* Signature blocks side by side, sitting on the foot of the last page. A
   single block takes the right half — where a receiver signs. */
function _prMaSignatures(doc, y, sigs, top) {
  const b = _prMaA5(doc);
  if (y > top) { doc.addPage(); }
  const gap = 24;
  const w = (b.CW - gap) / 2;
  const x0 = sigs.length === 1 ? b.L + w + gap : b.L;
  const ink = _pc(PRINT_COLORS.text);
  sigs.forEach(function (s, i) {
    const x = x0 + i * (w + gap);
    doc.setDrawColor(ink[0], ink[1], ink[2]);
    doc.setLineWidth(0.7);
    doc.line(x, top + 28, x + w, top + 28);
    const used = _prMaLabel(doc, s.en, s.ur, x, top + 40, 9);
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 9.5, PRINT_COLORS.text);
    doc.text(_prMaFit(doc, s.name ? s.name : 'Name: _______________', w), x, top + 40 + used + 3);
  });
}
/* Every page of a slip: who recorded it and who printed it, then the page
   count, the confidentiality line (+ its Urdu tail) and VOID if it is. */
function _prMaSlipFooter(doc, data) {
  const b = _prMaA5(doc);
  const total = doc.getNumberOfPages();
  const dt = doc.__groovyDocType || 'Document';
  const rec = data.recorded || {};
  const meta = [rec.by ? 'Recorded by ' + rec.by + (rec.at ? ', ' + _prMaWhen(rec.at) : '') : '',
    data.printedOn ? 'Printed ' + _prMaDay(data.printedOn) + (data.printedBy ? ' by ' + data.printedBy : '') : ''].filter(Boolean).join('  ·  ');
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const y = b.H - 20;
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 7.5, PRINT_COLORS.greyAccent);
    if (meta) doc.text(_prMaFit(doc, meta, b.CW), b.L, y - 12);
    doc.text('Page ' + p + ' of ' + total, b.L, y);
    if (data.void) {
      _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', 8, PRINT_COLORS.red);
      doc.text('VOID', b.L + 58, y);
    }
    const latin = 'GROOVY · ' + dt + ' · Internal Use Only';
    if (_prMaUrduOk(doc)) {
      const ur = _footerUr(dt);
      _setFont(doc, PRINT_FONTS.urdu, 'normal', 7.5, PRINT_COLORS.greyAccent);
      let urW = 0;
      try { urW = doc.getTextWidth(ur); } catch (e) { urW = 0; }
      doc.text(ur, b.R, y, { align: 'right' });
      _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 7.5, PRINT_COLORS.greyAccent);
      doc.text(latin + ' | ', b.R - urW, y, { align: 'right' });
    } else {
      _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 7.5, PRINT_COLORS.greyAccent);
      doc.text(latin, b.R, y, { align: 'right' });
    }
  }
}

/**
 * ma-receipt — a transfer's handover slip. A5, bilingual.
 * data (maPdfReceiptData) = { no, date, amount, amountWords,
 *   from:{code,name,person}, to:{code,name,person}, note,
 *   state:'pending'|'confirmed'|'posted'|'void', waitingFor, paper,
 *   confirm:{by,at,via,forWho}|null, revised:{n,at,by,reason}|null,
 *   void:{reason,by,at}|null, recorded:{by,at}, printedOn, printedBy }
 */
function _renderMaReceipt(doc, data) {
  data = data || {};
  const b = _prMaA5(doc);
  const f = data.from || {}, t = data.to || {};
  let y = _prMaSlipHead(doc, { title: 'Handover receipt', titleUr: _PR_MA_UR.receipt, number: data.no, date: _prMaDay(data.date) });
  y = _prMaStamps(doc, data, y);
  y = _prMaAmountBox(doc, y, 'Amount', _PR_MA_UR.amount, data.amount, data.amountWords, !!data.void);
  let state;
  if (data.state === 'void') state = 'Void — it moves no money.';
  else if (data.state === 'pending') {
    state = 'Waiting for ' + (data.waitingFor || 'the receiver') + ' to confirm' +
      (data.paper ? ' — sign below on receipt; an owner then confirms it in the app.' : ' in the app.') +
      ' It counts in neither holder until then.';
  } else if (data.state === 'confirmed' && data.confirm) {
    const c = data.confirm;
    state = 'Confirmed by ' + (c.by || '—') + (c.forWho ? ' for ' + c.forWho : '') + (c.via === 'paper' ? ', on paper' : ' in the app') +
      (c.at ? ' · ' + _prMaWhen(c.at) : '') + '.';
  } else state = 'Posted — nobody else had to confirm it.';
  const sigTop = b.H - 24 - 36 - 72;
  y = _prMaSlipRows(doc, y, [
    ['From', _PR_MA_UR.from, [f.name, f.person ? '(' + f.person + ')' : ''].filter(Boolean).join(' '), true],
    ['To', _PR_MA_UR.to, [t.name, t.person ? '(' + t.person + ')' : ''].filter(Boolean).join(' '), true],
    ['Date', _PR_MA_UR.date, _prMaDay(data.date)],
    ['Number', _PR_MA_UR.number, data.no],
    ['Note', _PR_MA_UR.note, data.note],
    ['State', _PR_MA_UR.state, state]
  ], sigTop);
  _prMaSignatures(doc, y, [
    { en: 'Given by', ur: _PR_MA_UR.givenBy, name: f.person || '' },
    { en: 'Received by', ur: _PR_MA_UR.receivedBy, name: t.person || '' }
  ], sigTop);
  _prMaSlipFooter(doc, data);
}

/**
 * ma-voucher — a money-out payment voucher. A5, bilingual.
 * data (maPdfVoucherData) = { no, date, paidTo:{name,code,party},
 *   from:{code,name,person}, account:{code,name}, amount,
 *   tax:{kind,label,rate,inclusive,claimable,amount,net,gross}|null,
 *   paid, paidWords, note, costCentre, commitment:{name,period}|null,
 *   revised, void, recorded, printedOn, printedBy }
 * `tax` is null for "No tax": the block prints only when there is one.
 */
function _renderMaVoucher(doc, data) {
  data = data || {};
  const b = _prMaA5(doc);
  const to = data.paidTo || {}, f = data.from || {}, a = data.account || {}, tx = data.tax;
  let y = _prMaSlipHead(doc, { title: 'Payment voucher', titleUr: _PR_MA_UR.voucher, number: data.no, date: _prMaDay(data.date) });
  y = _prMaStamps(doc, data, y);
  y = _prMaAmountBox(doc, y, 'Amount paid', _PR_MA_UR.paid, data.paid, data.paidWords, !!data.void);
  let taxText = '';
  if (tx) {
    if (tx.kind === 'withholding') {
      taxText = (tx.label || 'Withholding') + ' ' + tx.rate + '% on ' + _prMaRs(doc, tx.gross) + ': ' + _prMaRs(doc, tx.amount) +
        ' withheld from the payee — owed to the government.';
    } else if (tx.inclusive) {
      taxText = (tx.label || tx.kind) + ' ' + tx.rate + '%, included in ' + _prMaRs(doc, tx.gross) + ': ' + _prMaRs(doc, tx.amount) +
        (tx.claimable ? ' (claimable).' : '.');
    } else {
      taxText = (tx.label || tx.kind) + ' ' + tx.rate + '% on top of ' + _prMaRs(doc, tx.net) + ': ' + _prMaRs(doc, tx.amount) +
        (tx.claimable ? ' (claimable).' : '.');
    }
  }
  const cm = data.commitment;
  const sigTop = b.H - 24 - 36 - 72;
  y = _prMaSlipRows(doc, y, [
    ['Paid to', _PR_MA_UR.paidTo, [to.name, to.code ? '(' + to.code + ')' : ''].filter(Boolean).join(' '), true],
    ['Paid from', _PR_MA_UR.paidFrom, [f.name, f.person ? '(' + f.person + ')' : ''].filter(Boolean).join(' ')],
    ['For', _PR_MA_UR.forWhat, [a.code, a.name].filter(Boolean).join(' · ')],
    ['Tax', _PR_MA_UR.tax, taxText],
    ['Particulars', _PR_MA_UR.particulars, data.note],
    ['Cost centre', _PR_MA_UR.centre, data.costCentre],
    ['Commitment', null, cm ? [cm.name, cm.period].filter(Boolean).join(' · ') : ''],
    ['Date', _PR_MA_UR.date, _prMaDay(data.date)],
    ['Number', _PR_MA_UR.number, data.no]
  ], sigTop);
  _prMaSignatures(doc, y, [{ en: 'Received by', ur: _PR_MA_UR.receivedBy, name: to.name || '' }], sigTop);
  _prMaSlipFooter(doc, data);
}

/**
 * ma-collection — the receipt for cash collected from a courier. A5, bilingual.
 * data (maPdfCollectionData) = { no, date, amount, amountWords,
 *   courier:{key,name}, holder:{code,name,person}, collectedBy,
 *   covers:[{no,date,net}], expected, difference:int|null, note,
 *   state:'pending'|'confirmed'|'posted'|'void', waitingFor, paper,
 *   confirm:{by,at,via,forWho}|null, revised, void, recorded, printedOn, printedBy }
 * The covered receipts are listed one per line; a long list CONTINUES onto
 * further pages with its head redrawn, and the reconciliation and the
 * signatures follow the last row. Plain text only — every string is drawn
 * with doc.text, never parsed.
 */
function _renderMaCollection(doc, data) {
  data = data || {};
  const b = _prMaA5(doc);
  const h = data.holder || {}, cr = data.courier || {};
  const covers = data.covers || [];
  let y = _prMaSlipHead(doc, { title: 'Collection receipt', titleUr: _PR_MA_UR_COL.title, number: data.no, date: _prMaDay(data.date) });
  y = _prMaStamps(doc, data, y);
  y = _prMaAmountBox(doc, y, 'Amount collected', _PR_MA_UR_COL.amount, data.amount, data.amountWords, !!data.void);
  let state;
  if (data.state === 'void') state = 'Void — it moves no money.';
  else if (data.state === 'pending') {
    state = 'Waiting for ' + (data.waitingFor || 'the receiver') + ' to confirm' +
      (data.paper ? ' — sign below on receipt; an owner then confirms it in the app.' : ' in the app.') +
      ' It counts in no holder until then.';
  } else if (data.state === 'confirmed' && data.confirm) {
    const c = data.confirm;
    state = 'Confirmed by ' + (c.by || '—') + (c.forWho ? ' for ' + c.forWho : '') + (c.via === 'paper' ? ', on paper' : ' in the app') +
      (c.at ? ' · ' + _prMaWhen(c.at) : '') + '.';
  } else state = 'Posted — nobody else had to confirm it.';
  const sigTop = b.H - 24 - 36 - 72;
  y = _prMaSlipRows(doc, y, [
    ['Courier', _PR_MA_UR_COL.courier, cr.name, true],
    ['Into', _PR_MA_UR_COL.holder, [h.name, h.person ? '(' + h.person + ')' : ''].filter(Boolean).join(' '), true],
    ['Collected by', _PR_MA_UR_COL.collectedBy, data.collectedBy],
    ['Date', _PR_MA_UR.date, _prMaDay(data.date)],
    ['Number', _PR_MA_UR.number, data.no],
    ['Note', _PR_MA_UR.note, data.note],
    ['State', _PR_MA_UR.state, state]
  ], sigTop);

  // The receipts this collection covers: number · date · net, one per line.
  const RH = 12.5, colDate = b.L + 150, colNet = b.R;
  const soft = _pc('#E6E6E6');
  const head = function (cont) {
    _prMaLabel(doc, cont ? 'Receipts covered — continued' : 'Receipts covered', cont ? null : _PR_MA_UR_COL.covers, b.L, y + 10, 9);
    y += _prMaUrduOk(doc) && !cont ? 24 : 14;
    _setFont(doc, PRINT_FONTS.bodyRegular, 'bold', 8.5, PRINT_COLORS.greyAccent);
    doc.text('Receipt', b.L, y + 8);
    doc.text('Date', colDate, y + 8);
    doc.text('Net', colNet, y + 8, { align: 'right' });
    doc.setDrawColor(soft[0], soft[1], soft[2]);
    doc.setLineWidth(0.5);
    doc.line(b.L, y + 12, b.R, y + 12);
    y += 15;
  };
  y += 4;
  if (y + 60 > sigTop) { doc.addPage(); y = b.M; }
  head(false);
  if (!covers.length) {
    _setFont(doc, PRINT_FONTS.bodyRegular, 'italic', 9, PRINT_COLORS.greyAccent);
    doc.text('No receipts are listed — entered as the amount collected.', b.L, y + 9);
    y += RH + 2;
  }
  covers.forEach(function (c) {
    c = c || {};
    if (y + RH > sigTop - 4) { doc.addPage(); y = b.M; head(true); }
    _setFont(doc, PRINT_FONTS.bodyRegular, 'normal', 9, PRINT_COLORS.text);
    doc.text(_prMaFit(doc, c.no || '', 140), b.L, y + 9);
    doc.text(c.date ? _prMaDay(c.date) : '', colDate, y + 9);
    doc.text(_prMaRs(doc, c.net), colNet, y + 9, { align: 'right' });
    y += RH;
  });

  // Reconciliation: expected · counted · difference, as handed over.
  const d = data.difference == null ? null : Math.round(Number(data.difference) || 0);
  const recon = [
    ['Expected', _PR_MA_UR_COL.expected, _prMaRs(doc, data.expected)],
    ['Counted', _PR_MA_UR_COL.counted, _prMaRs(doc, data.amount)],
    ['Difference', _PR_MA_UR_COL.difference, d === null ? '—' : d === 0 ? 'Matches — nothing over or short.' :
      _prMaRs(doc, Math.abs(d)) + (d > 0 ? ' over' : ' short')]
  ];
  const need = recon.length * (_prMaUrduOk(doc) ? 36 : 21) + 6;
  y += 10;
  if (y + need > sigTop) { doc.addPage(); y = b.M; }
  y = _prMaSlipRows(doc, y, recon.map(function (r, i) { return [r[0], r[1], r[2], i === 2]; }), sigTop);
  _prMaSignatures(doc, y, [
    { en: 'Given by', ur: _PR_MA_UR.givenBy, name: data.collectedBy || '' },
    { en: 'Received by', ur: _PR_MA_UR.receivedBy, name: h.person || '' }
  ], sigTop);
  _prMaSlipFooter(doc, data);
}

/* ── PART 2 — Public API ───────────────────────────────────────────────────
   The ONLY global this engine exposes.

   opts.deliver === 'blob' (Master Accounts M1.4 — a later milestone uploads
   these bytes for a share link): NO preview tab, NO download, NO toast; the
   promise RESOLVES {blob, filename}, and a failure REJECTS so the caller can
   say what went wrong. It sits on `opts` beside type/data/filename because
   it is about where the PDF goes, not what is on it. Without it every call
   behaves exactly as it always has. */
window.printDocument = async function (opts) {
  opts = opts || {};
  const type = opts.type || 'generic';
  const data = opts.data || {};
  const toBlob = opts.deliver === 'blob';

  if (!window.jspdf || !window.jspdf.jsPDF) {
    console.error('[print-engine] jsPDF not loaded.');
    if (toBlob) throw new Error('PDF library not loaded yet, retry in a moment.');
    if (typeof showToast === 'function') showToast('PDF library not loaded yet, retry in a moment.', true);
    return;
  }

  const known = ['po', 'embroidery-vendor', 'sublimation-vendor',
    'gate-pass', 'placement-sheet', 'qc-report', 'payslip',
    'daily-performance', 'stock-transfer', 'mood-board',
    'ma-ledger', 'ma-statement-party', 'ma-statement-holder', 'ma-receipt', 'ma-voucher', 'ma-collection',
    'pattern-label', 'consumable-log', 'generic'];
  const _VARIANTS = {
    'po': _renderPO,
    'gate-pass': _renderGatePass,
    'payslip': _renderPayslip,
    'daily-performance': _renderDailyPerformance,
    'stock-transfer': _renderStockTransfer,
    'mood-board': _renderMoodBoard,
    'pattern-label': _renderPatternLabel,
    'consumable-log': _renderConsumableLog,
    'ma-ledger': _renderMaLedger,
    'ma-statement-party': _renderMaStatementParty,
    'ma-statement-holder': _renderMaStatementHolder,
    'ma-receipt': _renderMaReceipt,
    'ma-voucher': _renderMaVoucher,
    'ma-collection': _renderMaCollection
  };
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
  if (!toBlob) {
    try { previewWin = window.open('', '_blank'); } catch (e) { previewWin = null; }
    _previewLoading(previewWin, _docLabel);
  }

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
  // Page size: A4 portrait for every document EXCEPT one that asks for its
  // own (data.page = {w,h} in points) — the Pattern Hub's 5×6 in label. The
  // shared components (_renderHeader, _renderFooter, _renderInfoTable, …)
  // are A4 by construction through PRINT_LAYOUT, so a custom-page variant
  // must draw its own layout and gets no automatic footer. A type may name
  // its own page (_PRINT_PAGE_DEFAULTS — the A5 slips); data.page wins.
  const customPage = _customPage(data.page ? data : { page: _PRINT_PAGE_DEFAULTS[type] });
  // A4 LANDSCAPE when asked (data.orientation, else the type's default) —
  // only for a renderer that lays out off _pageBox(); any other variant has
  // its own portrait geometry and stays portrait.
  const orientation = data.orientation || _PRINT_ORIENTATION_DEFAULTS[type] || 'portrait';
  let landscape = false;
  if (!customPage && orientation === 'landscape') {
    if (render === _renderGeneric || _PRINT_LANDSCAPE_READY[type]) landscape = true;
    else console.warn('[print-engine] ' + type + ' is laid out for A4 portrait — orientation "landscape" ignored.');
  }
  const doc = customPage
    ? new jsPDF({ unit: 'pt', format: [customPage.w, customPage.h], orientation: customPage.w > customPage.h ? 'landscape' : 'portrait' })
    : landscape
      ? new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
      : new jsPDF({ unit: 'pt', format: 'a4' });
  if (landscape) doc.__groovyPage = PRINT_LAYOUT_LANDSCAPE;

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

  // Preload the product photo (if any) into a data URL so the synchronous
  // renderer can embed it. Best-effort — a failed/blocked load just omits it.
  if (data && data.productImage && !data.__productImg) {
    try { data.__productImg = await _loadImgDataURL(data.productImage); }
    catch (e) { data.__productImg = null; }
  }

  try {
    render(doc, data);
    if (!customPage) _stampFooters(doc);
  } catch (e) {
    console.error('[print-engine] render failed:', e);
    if (toBlob) throw e;
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
    if (toBlob) throw e;
    if (typeof showToast === 'function') showToast('PDF generation failed: ' + e.message, true);
    _previewError(previewWin, e.message);
    return;
  }

  const sizeKB = Math.max(1, Math.round(blob.size / 1024));
  console.log('[print-engine] Generated ' + type + ' PDF — urduLevel: ' +
    urduLevel + ', size: ~' + sizeKB + 'KB');
  if (toBlob) return { blob: blob, filename: filename };

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

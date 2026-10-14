/* ─────────────────────────────────────────────────────────────────────────
   Print PO after the cut (WP6, Oct 2026). Plain classic script, loaded right after js/pos.js.

   The first stage (draft, issue, fabric issue, cut) is digital, so once the cut is recorded the
   system holds the true numbers. Other mills still work on paper, so the PO traveler still exists
   but is meant for AFTER the cut, carrying what was really cut. js/pos.js has ONE hook
   (generatePOPdf -> window.poPrintRun, typeof-guarded) and the button/info slots on the PO page.

   - cut recorded (po.cutAt and a cutQty with pieces): the traveler prints the ACTUAL cut: per-size
     quantities and total from po.cutQty, the bundles read by poId, the fabric used if the PO records it.
     The bundles are read first; if they cannot be read (failed, offline copy, or none returned for a PO
     that lists bundleIds) the ORDERED values are printed instead and the PO page says so. Never blank.
   - no cut yet: still available, labelled "before cut"; the page is marked ORDERED QUANTITIES.
   - every print is recorded in an additive field on the pos document, po.printLog =
     [{at,by,byName,stage:'before-cut'|'after-cut'}], appended inside a transaction. NO firestore.rules
     change: the pos document is `write: if signedIn()` and the pos/{id}/history rule is isProdOps()-gated
     (not every printing user is on the Production Ops team), so history could not be used. A failed log
     write never blocks the print; it is said on the PO page.
   ───────────────────────────────────────────────────────────────────────── */
var _poPrintState = {};   // fbKey -> { unread:string|'', logFail:string }

function _poPrintEsc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

/* Pure. Is the cut recorded on this PO? */
function poPrintCutRecorded(po) {
  if (!po || !po.cutAt || !po.cutQty || typeof po.cutQty !== 'object') return false;
  return Object.keys(po.cutQty).reduce(function (a, k) { return a + (Number(po.cutQty[k]) || 0); }, 0) > 0;
}
/* Pure. The print log of a PO, oldest first, junk dropped. */
function poPrintLogOf(po) {
  const l = po && Array.isArray(po.printLog) ? po.printLog : [];
  return l.filter(function (e) { return e && typeof e === 'object' && Number(e.at) > 0; });
}

window.poPrintButtonHTML = function (po, cancelled) {
  const k = _poPrintEsc(po.fbKey);
  if (cancelled) return '<button class="btn-pdf" onclick="window.generatePOPdf(\'' + k + '\')">⬇ PDF</button>';
  if (poPrintCutRecorded(po)) {
    return '<button class="mark-done-btn" id="po-print-btn" style="width:auto;padding:9px 18px" onclick="window.generatePOPdf(\'' + k + '\')">Print PO - after cut</button>';
  }
  return '<button class="btn-pdf" id="po-print-btn" onclick="window.generatePOPdf(\'' + k + '\')">⬇ Print PO (before cut)</button>';
};

window.poPrintInfoHTML = function (po) {
  const st = _poPrintState[po.fbKey] || {};
  const log = poPrintLogOf(po);
  const parts = [];
  if (log.length) {
    const last = log[log.length - 1];
    parts.push('Printed ' + log.length + ' time' + (log.length === 1 ? '' : 's') + ', last by ' + _poPrintEsc(last.byName || last.by || '?') +
      ' on ' + _poPrintEsc(new Date(Number(last.at)).toLocaleDateString('en-GB')) + (last.stage === 'after-cut' ? ' (after cut)' : ' (before cut)'));
  } else {
    parts.push('Not printed yet.');
  }
  let warn = '';
  if (st.unread) warn += '<div style="color:var(--accent-warning);margin-top:4px">The bundles could not be read (' + _poPrintEsc(st.unread) + '), so the ORDERED quantities were printed, not the actual cut. Try again when you are online.</div>';
  if (st.logFail) warn += '<div style="color:var(--accent-warning);margin-top:4px">The print was NOT recorded (' + _poPrintEsc(st.logFail) + '). The PDF itself was made.</div>';
  return '<div id="po-print-info" style="font-size:13px;color:var(--muted);margin-bottom:10px">' + parts.join('') + warn + '</div>';
};

function _poPrintRefresh(po) {
  try {
    const el = typeof document !== 'undefined' && document.getElementById ? document.getElementById('po-print-info') : null;
    if (el) { const t = document.createElement('div'); t.innerHTML = window.poPrintInfoHTML(po); el.outerHTML = t.innerHTML; }
  } catch (e) { /* the page repaints on the next visit */ }
}

/* Bundles of the PO. {ok:true,list} or {ok:false,error}. Never rejects. */
async function poPrintReadBundles(po) {
  try {
    const snap = await getDocs(query(collection(db, 'bundles'), where('poId', '==', po.id)));
    if (snap && snap.metadata && snap.metadata.fromCache) return { ok: false, error: 'offline copy only' };
    const list = snap.docs.map(function (d) { return d.data(); })
      .sort(function (a, b) { return (Number(a.bundleNumber) || 0) - (Number(b.bundleNumber) || 0); })
      .map(function (b) { return { no: b.bundleNumber != null ? b.bundleNumber : b.bundleId, size: b.size || '', units: b.units }; });
    if (!list.length && Array.isArray(po.bundleIds) && po.bundleIds.length) return { ok: false, error: 'none came back for ' + po.bundleIds.length + ' on the PO' };
    return { ok: true, list: list };
  } catch (e) { return { ok: false, error: (e && e.message) || 'read failed' }; }
}

/* Append {at,by,byName,stage} to po.printLog in a transaction. Resolves '' or the failure text. Never rejects. */
async function poPrintRecord(po, stage) {
  const entry = { at: Date.now(), by: (session && session.u) || '', byName: (session && session.name) || '', stage: stage };
  if (typeof window._gvSilentSaveStart === 'function') window._gvSilentSaveStart();
  try {
    let next = null;
    await runTransaction(db, async function (tx) {
      const ref = doc(db, 'pos', po.fbKey);
      const s = await tx.get(ref);
      if (!s.exists()) throw new Error('the PO document was not found');
      const cur = Array.isArray(s.data().printLog) ? s.data().printLog : [];
      next = cur.concat([entry]).slice(-200);
      tx.update(ref, { printLog: next });
    });
    po.printLog = next;
    return '';
  } catch (e) { return (e && e.message) || 'write failed'; }
  finally { if (typeof window._gvSilentSaveStop === 'function') window._gvSilentSaveStop(); }
}

window.poPrintRun = async function (po, data) {
  const st = _poPrintState[po.fbKey] = { unread: '', logFail: '' };
  const d = Object.assign({}, data);
  let stage = 'before-cut';
  if (poPrintCutRecorded(po)) {
    const rb = await poPrintReadBundles(po);
    if (rb.ok) {
      const fc = po.fabricConsumed && typeof po.fabricConsumed === 'object' ? po.fabricConsumed : null;
      d.cut = {
        sizes: Object.assign({}, po.cutQty), bundles: rb.list, by: po.cutBy || '',
        fabricUsed: fc && Number(fc.qty) > 0 ? String(Math.round(Number(fc.qty) * 100) / 100) + (Array.isArray(fc.rollCodes) && fc.rollCodes.length ? ' (' + fc.rollCodes.length + ' rolls)' : '') : ''
      };
      stage = 'after-cut';
    } else { st.unread = rb.error; d.qtyBasis = 'ordered'; }
  } else { d.qtyBasis = 'ordered'; }
  let r;
  try { r = await window.printDocument({ type: 'po', filename: po.id + '.pdf', data: d }); }
  catch (e) { if (typeof showToast === 'function') showToast('Print failed: ' + ((e && e.message) || e), true); _poPrintRefresh(po); return; }
  st.logFail = await poPrintRecord(po, stage);
  if (st.logFail && typeof showToast === 'function') showToast('PDF made, but the print was not recorded: ' + st.logFail, true);
  _poPrintRefresh(po);
  return r;
};

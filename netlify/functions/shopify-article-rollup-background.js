/* shopify-article-rollup-background — the server-side per-article rollup for
 * Inventory Intel (plan 10, P0). SCHEDULED daily (netlify.toml, 06:15 UTC =
 * 11:15 PKT, after the 04:00 UTC catalog sync and the 05:00 UTC snapshot) and
 * callable on demand through shopify-article-rollup-now-background.js.
 *
 * It READS the collections the app already fills — shopify_line_items,
 * shopify_products, shopify_inventory_snapshots — and WRITES three new ones,
 * all read-only for clients (firestore.rules):
 *   shopify_article_daily/{CODE}_{YYYY}  parallel arrays indexed by day of the
 *       year (0 = 1 Jan): u units · rev revenue · vd voided units · rf
 *       refunded units · st stock on hand (null = no snapshot that day) · ins
 *       in-stock flag · rc inferred receipts · sz {SIZE:{u:[],st:[]}}.
 *       u / rev / vd / rf are null BEFORE the synced history begins
 *       (coverage_from) — "not in the data" is never a zero.
 *   shopify_article_summary/all          one compact list (scorecard data).
 *   shopify_rollup_meta/status           version, window, counters, data-quality
 *       counts (excluded rows BY RULE), the shadow-compare result.
 *
 * Output is a PURE function of the inputs (buildRollup): deterministic ids, no
 * run timestamps inside the article/summary docs, so a rerun writes nothing
 * that did not change (unchanged docs are skipped). Nightly mode recomputes
 * the trailing 60 days (read window + 7 days of buffer for the receipt
 * inference) and merges them into the stored year docs; 'full' rebuilds all.
 *
 * CLEANING RULES. js/shopify.js has no single "clean" function at the time of
 * writing (the client is being rewritten alongside this); the rules here are
 * the ones the client applies scattered (_siAxIndex, _siNormSize, _siAxSizeOf)
 * plus plan 10 §3. THEY MUST STAY IN STEP with the client — see cleanLineItem:
 *   - no SKU ('' / NO-SKU)                      -> skipped, counted
 *   - price under Rs 1 (Tip/Gratuity Rs 0.01)  -> non-merchandise, excluded
 *   - financial_status 'voided' (or cancelled_at) -> voided units (vd), not sold
 *   - 'refunded' -> refunded units (rf); a refunded_quantity (partial refund)
 *     moves just those units to rf, when the field is present
 *   - negative stock                            -> clamped to 0 per entry, raw
 *     count and minimum recorded
 *   - duplicate SKUs (two snapshot entries / two variants) are SUMMED, counted
 *   - size: the option that IS a size wins (options are swapped on some
 *     products; numeric waists count), then the SKU suffix.
 * TIMING. A snapshot taken before 18:00 PKT is the PREVIOUS day's close.
 */
'use strict';

const ROLLUP_VERSION = 1;
const TRAILING_DAYS = 60;
const BUFFER_DAYS = 7;
const SUMMARY_DAYS = 90;
const SNAPSHOT_CLOSE_HOUR_PKT = 18;
const PARTIAL_SNAPSHOT_RATIO = 0.8;
const RECEIPT_MIN = 5;
const RECEIPT_PCT = 0.10;
const DOC_SOFT_LIMIT = 700 * 1024;      // a year doc above this is refused (plan 10 §2)
const SUMMARY_LIMIT = 900 * 1024;       // the summary must stay well under 1 MiB
const COL = { daily: 'shopify_article_daily', summary: 'shopify_article_summary', meta: 'shopify_rollup_meta' };

const KNOWN_SIZES = new Set(['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', 'XXXL', '4XL', '5XL', 'ONE SIZE', 'OS', 'FREE SIZE', 'ONESIZE']);
const isSizeLabel = (x) => !!x && (KNOWN_SIZES.has(x) || /^[2-4]\d$/.test(x));   // numeric waist 20-49

// ── days ────────────────────────────────────────────────────────
const dayNum = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null; };
const dayStr = (n) => { const d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };
const pktDay = (ms) => new Date(ms + 5 * 3600000).toISOString().slice(0, 10);
const dayOf = (iso) => { const s = String(iso || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && dayNum(s) != null ? s : ''; };
const yearStart = (y) => dayNum(y + '-01-01');
const yearLen = (y) => yearStart(y + 1) - yearStart(y);
const r2 = (x) => Math.round(x * 100) / 100;
const tsMs = (v) => {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return null;
};

// ── Firestore size estimate (documented rule: strings utf8+1, numbers 8,
// null/bool 1, maps key+1+value, arrays the sum of their values) ─────────
function estimateValueSize(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 8;
  if (typeof v === 'string') return Buffer.byteLength(v, 'utf8') + 1;
  if (Array.isArray(v)) { let n = 0; for (const x of v) n += estimateValueSize(x); return n; }
  let n = 0; for (const k of Object.keys(v)) n += Buffer.byteLength(k, 'utf8') + 1 + estimateValueSize(v[k]); return n;
}
const estimateDocSize = (path, data) => Buffer.byteLength(path, 'utf8') + 1 + 16 + 32 + estimateValueSize(data);

// ── cleaning (THE rules) ────────────────────────────────────────
const skuOf = (s) => { const x = String(s || '').trim().toUpperCase(); return x === 'NO-SKU' ? '' : x; };
const codeOf = (sku) => (sku ? sku.split('-')[0] : '');
const sizeKey = (s) => String(s).replace(/[.\/\[\]*~`]/g, '_');

// → {rule} for a row excluded outright (no_sku | bad_day | zero_qty |
// non_merch), or the counted row {code,sku,day,qty,price,voided,refunded,net,status}.
function cleanLineItem(li) {
  const sku = skuOf(li.sku);
  if (!sku) return { rule: 'no_sku', qty: Number(li.quantity) || 0 };
  const day = dayOf(li.order_created_at);
  if (!day) return { rule: 'bad_day' };
  const qty = Number(li.quantity) || 0;
  if (qty <= 0) return { rule: 'zero_qty' };
  const price = Number(li.price) || 0;
  if (price < 1) return { rule: 'non_merch', qty };
  const fs = String(li.financial_status || '').toLowerCase();
  const out = { code: codeOf(sku), sku, day, qty, price, voided: 0, refunded: 0, net: qty, partial: false, status: 'sold' };
  if (fs === 'voided' || li.cancelled_at) { out.voided = qty; out.net = 0; out.status = 'voided'; return out; }
  if (fs === 'refunded') { out.refunded = qty; out.net = 0; out.status = 'refunded'; return out; }
  const rq = Math.min(qty, Math.max(0, Number(li.refunded_quantity) || 0));
  if (rq > 0) { out.refunded = rq; out.net = qty - rq; out.partial = true; }
  return out;
}

// Which size a variant is. Options are swapped on some products (colour in
// the size field, size in the colour field) and a waist is a plain number.
function sizeFor(sku, p, li) {
  const cand = [p && p.size, p && p.color, li && li.size, li && li.color];
  for (let i = 0; i < cand.length; i++) {
    const x = String(cand[i] || '').trim().toUpperCase();
    if (isSizeLabel(x)) return { size: x, swapped: i === 1 || i === 3 };
  }
  const m = /^[A-Z]{2,3}\d{3,}(?:-[TB])?-([A-Z0-9]+)$/.exec(sku);
  if (m) return { size: m[1], swapped: false };
  const s = String((p && p.size) || (li && li.size) || '').trim().toUpperCase();
  return { size: s || 'Unknown', swapped: false };
}

// ── snapshots ───────────────────────────────────────────────────
// A snapshot is the close of the day BEFORE when taken before 18:00 PKT.
function effectiveDay(snapMs, idDay) {
  if (snapMs == null) return { day: idDay, noTime: true, shifted: false };
  const p = new Date(snapMs + 5 * 3600000);
  const day = p.toISOString().slice(0, 10);
  if (p.getUTCHours() < SNAPSHOT_CLOSE_HOUR_PKT) return { day: dayStr(dayNum(day) - 1), shifted: true };
  return { day, shifted: false };
}

// ── the build ───────────────────────────────────────────────────
// input: {lineItems, products, snapshots:[{id,data}], today, readFrom,
//   windowFrom, coverageFrom, prior: Map(id->doc)|null, limits}
function buildRollup(input) {
  const today = input.today, readFrom = input.readFrom, windowFrom = input.windowFrom;
  const limits = Object.assign({ doc: DOC_SOFT_LIMIT, summary: SUMMARY_LIMIT }, input.limits || {});
  const prior = input.prior || new Map();
  const q = {
    rows_read: 0, rows_counted: 0,
    excluded: { no_sku: 0, bad_day: 0, zero_qty: 0, non_merch: 0, voided: 0, refunded: 0 },
    excluded_units: { no_sku: 0, non_merch: 0, voided: 0, refunded: 0 },
    partial_refund_rows: 0,
    negative_stock_entries: 0, negative_stock_min: 0,
    duplicate_sku_products: 0, duplicate_sku_snapshot_rows: 0, no_sku_stock_rows: 0,
    snapshots_read: 0, snapshots_partial: 0, snapshots_shifted: 0, snapshots_no_time: 0, snapshots_collided: 0,
    swapped_size_products: 0, unknown_size_rows: 0
  };
  const errors = [];

  // products
  const prods = (input.products || []).slice().sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  const prodBySku = new Map(), meta = new Map();
  const dupSku = new Set(), swappedSkus = new Set();
  for (const p of prods) {
    const sku = skuOf(p.sku); if (!sku) continue;
    if (prodBySku.has(sku)) { if (!dupSku.has(sku)) { dupSku.add(sku); q.duplicate_sku_products++; } continue; }
    prodBySku.set(sku, p);
    const code = codeOf(sku);
    let m = meta.get(code); if (!m) { m = { title: '', color: '', category: '', pub: '', created: '', sizes: new Set() }; meta.set(code, m); }
    if (!m.title && p.product_title) m.title = p.product_title;
    const sz = sizeFor(sku, p, null);
    if (sz.swapped) swappedSkus.add(sku);
    if (!m.color) { const c = String(p.color || '').trim(); m.color = isSizeLabel(c.toUpperCase()) ? String(p.size || '').trim() : c; }
    if (!m.category && p.product_type) m.category = p.product_type;
    const pub = dayOf(p.published_at), cr = dayOf(p.created_at);
    if (pub && (!m.pub || pub < m.pub)) m.pub = pub;
    if (cr && (!m.created || cr < m.created)) m.created = cr;
    if (sz.size !== 'Unknown') m.sizes.add(sizeKey(sz.size));
  }
  q.swapped_size_products = swappedSkus.size;

  // sales[code][day] = {u,rev,vd,rf,sz:{size:u}}
  const sales = new Map();
  let earliest = '';
  for (const li of input.lineItems || []) {
    q.rows_read++;
    const c = cleanLineItem(li);
    if (c.rule) {
      q.excluded[c.rule]++;
      if (c.rule === 'no_sku' || c.rule === 'non_merch') q.excluded_units[c.rule] += c.qty || 0;
      continue;
    }
    if (c.day < readFrom) continue;
    if (!earliest || c.day < earliest) earliest = c.day;
    q.rows_counted++;
    if (c.status === 'voided') { q.excluded.voided++; q.excluded_units.voided += c.qty; }
    else if (c.status === 'refunded') { q.excluded.refunded++; q.excluded_units.refunded += c.qty; }
    else if (c.partial) { q.partial_refund_rows++; q.excluded_units.refunded += c.refunded; }
    let byDay = sales.get(c.code); if (!byDay) { byDay = new Map(); sales.set(c.code, byDay); }
    let d = byDay.get(c.day); if (!d) { d = { u: 0, rev: 0, vd: 0, rf: 0, sz: {} }; byDay.set(c.day, d); }
    d.u += c.net; d.rev += c.net * c.price; d.vd += c.voided; d.rf += c.refunded;
    if (c.net > 0) {
      const sz = sizeFor(c.sku, prodBySku.get(c.sku), li);
      if (sz.size === 'Unknown') q.unknown_size_rows++;
      const k = sizeKey(sz.size); d.sz[k] = (d.sz[k] || 0) + c.net;
    }
  }
  const coverageFrom = input.coverageFrom || earliest || null;

  // snapshots -> effective days (partial ones dropped, collisions resolved)
  const snapIn = (input.snapshots || []).map((s) => ({ id: s.id, data: s.data || {} }));
  const counts = snapIn.map((s) => Number(s.data.variant_count) || Object.keys(s.data.items || {}).length).filter((n) => n > 0).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  const byEff = new Map();
  for (const s of snapIn) {
    q.snapshots_read++;
    const n = Number(s.data.variant_count) || Object.keys(s.data.items || {}).length;
    if (s.data.partial === true || (median && n < PARTIAL_SNAPSHOT_RATIO * median)) { q.snapshots_partial++; continue; }
    const ms = tsMs(s.data.snapshot_at);
    const e = effectiveDay(ms, dayOf(s.data.date || s.id));
    if (!e.day) continue;
    if (e.noTime) q.snapshots_no_time++;
    if (e.shifted) q.snapshots_shifted++;
    if (e.day > today || e.day < readFrom) continue;
    const prev = byEff.get(e.day);
    if (prev) { q.snapshots_collided++; if ((ms || 0) < (prev.ms || 0)) continue; }
    byEff.set(e.day, { ms, data: s.data });
  }
  const stock = new Map(); // code -> Map(day -> {t, sz:{}})
  for (const day of [...byEff.keys()].sort()) {
    const items = byEff.get(day).data.items || {};
    const seenHere = new Set();
    for (const id of Object.keys(items).sort()) {
      const it = items[id] || {};
      const sku = skuOf(it.sku);
      if (!sku) { q.no_sku_stock_rows++; continue; }
      let av = Number(it.available) || 0;
      if (av < 0) { q.negative_stock_entries++; if (av < q.negative_stock_min) q.negative_stock_min = av; av = 0; }
      const code = codeOf(sku);
      const sz = sizeKey(sizeFor(sku, prodBySku.get(sku), null).size);
      if (seenHere.has(sku)) q.duplicate_sku_snapshot_rows++; else seenHere.add(sku);
      let byDay = stock.get(code); if (!byDay) { byDay = new Map(); stock.set(code, byDay); }
      let d = byDay.get(day); if (!d) { d = { t: 0, sz: {} }; byDay.set(day, d); }
      d.t += av; d.sz[sz] = (d.sz[sz] || 0) + av;
    }
  }

  const codes = new Set([...meta.keys(), ...sales.keys(), ...stock.keys()]);
  const today_n = dayNum(today), from_n = dayNum(windowFrom), read_n = dayNum(readFrom);
  const years = [];
  for (let y = +windowFrom.slice(0, 4); y <= +today.slice(0, 4); y++) years.push(y);
  const covN = coverageFrom ? dayNum(coverageFrom) : Infinity;

  const docs = new Map(), changed = new Set(), unchanged = new Set(), oversize = [];
  const final = (code, y) => docs.get(code + '_' + y) || prior.get(code + '_' + y);

  for (const code of [...codes].sort()) {
    const sal = sales.get(code) || new Map(), stk = stock.get(code) || new Map();
    const rec = new Map(); let prevSnap = null, runSold = 0;
    const sizesSeen = new Set(meta.get(code) ? meta.get(code).sizes : []);
    for (const d of sal.values()) for (const k of Object.keys(d.sz)) sizesSeen.add(k);
    for (const d of stk.values()) for (const k of Object.keys(d.sz)) sizesSeen.add(k);
    for (let n = read_n; n <= today_n; n++) {
      const day = dayStr(n), s = sal.get(day), st = stk.get(day);
      const r = { u: s ? s.u : 0, rev: s ? r2(s.rev) : 0, vd: s ? s.vd : 0, rf: s ? s.rf : 0, st: null, ins: null, rc: null, hasSnap: !!st, szu: s ? s.sz : {}, szs: st ? st.sz : null };
      runSold += r.u;
      if (st) {
        r.st = st.t; r.ins = st.t > 0 ? 1 : 0; r.rc = 0;
        if (prevSnap) {
          // expected close = opening - sold; anything above that came in
          const rcv = st.t - prevSnap.t + runSold;
          if (rcv >= Math.max(RECEIPT_MIN, RECEIPT_PCT * prevSnap.t)) r.rc = rcv;
        }
        prevSnap = { t: st.t }; runSold = 0;
      }
      rec.set(day, r);
    }
    for (const y of years) {
      const id = code + '_' + y, had = prior.get(id);
      const y0 = yearStart(y), n = y === +today.slice(0, 4) ? today_n - y0 + 1 : yearLen(y);
      const lo = Math.max(from_n, y0), hi = Math.min(today_n, y0 + yearLen(y) - 1);
      const doc = had ? JSON.parse(JSON.stringify(had)) : { code, year: y, version: ROLLUP_VERSION, n: 0, u: [], rev: [], vd: [], rf: [], st: [], ins: [], rc: [], sz: {} };
      const grow = (arr) => { while (arr.length < n) arr.push(null); };
      ['u', 'rev', 'vd', 'rf', 'st', 'ins', 'rc'].forEach((f) => grow(doc[f]));
      for (const k of sizesSeen) if (!doc.sz[k]) doc.sz[k] = { u: [], st: [] };
      for (const k of Object.keys(doc.sz)) { grow(doc.sz[k].u); grow(doc.sz[k].st); }
      let signal = !!had;
      for (let dn = lo; dn <= hi; dn++) {
        const r = rec.get(dayStr(dn)), i = dn - y0, cov = dn >= covN;
        doc.u[i] = cov ? r.u : null; doc.rev[i] = cov ? r.rev : null; doc.vd[i] = cov ? r.vd : null; doc.rf[i] = cov ? r.rf : null;
        doc.st[i] = r.st; doc.ins[i] = r.ins; doc.rc[i] = r.rc;
        if (r.u || r.vd || r.rf || r.st != null) signal = true;
        for (const k of Object.keys(doc.sz)) {
          doc.sz[k].u[i] = cov ? (r.szu[k] || 0) : null;
          doc.sz[k].st[i] = r.hasSnap ? ((r.szs && r.szs[k]) || 0) : null;
        }
      }
      if (!signal) continue;
      doc.n = n; doc.version = ROLLUP_VERSION;
      const szSorted = {}; for (const k of Object.keys(doc.sz).sort()) szSorted[k] = doc.sz[k]; doc.sz = szSorted;   // key order must not depend on discovery order
      const sized = estimateDocSize(COL.daily + '/' + id, doc);
      if (sized > limits.doc) { oversize.push({ id, bytes: sized }); continue; }
      docs.set(id, doc);
      if (had && JSON.stringify(had) === JSON.stringify(doc)) unchanged.add(id); else changed.add(id);
    }
  }

  // the summary — built from the docs as they will be stored
  const codeYears = new Map();
  for (const id of new Set([...prior.keys(), ...docs.keys()])) {
    const m = /^(.+)_(\d{4})$/.exec(id); if (!m) continue;
    if (!codeYears.has(m[1])) codeYears.set(m[1], []);
    codeYears.get(m[1]).push(+m[2]);
  }
  const at = (code, f, dn, sz) => {
    const y = +dayStr(dn).slice(0, 4), d = final(code, y); if (!d) return null;
    const a = sz ? (d.sz[sz] ? d.sz[sz][f] : null) : d[f]; if (!a) return null;
    const v = a[dn - yearStart(y)]; return v === undefined ? null : v;
  };
  const arts = [];
  for (const code of [...codes].sort()) {
    const ys = (codeYears.get(code) || []).sort();
    if (!ys.length) continue;
    const m = meta.get(code) || { title: '', color: '', category: '', pub: '', created: '' };
    let fs = '', ll = '', fin = '', utot = 0;
    for (const y of ys) {
      const d = final(code, y), y0 = yearStart(y);
      for (let i = 0; i < d.n; i++) {
        if (d.u[i] > 0) { const day = dayStr(y0 + i); if (!fs || day < fs) fs = day; if (!ll || day > ll) ll = day; utot += d.u[i]; }
        if (d.ins[i] === 1) { const day = dayStr(y0 + i); if (!fin || day < fin) fin = day; }
      }
    }
    let lv = '', ls = '-';
    if (m.pub) { lv = m.pub; ls = 'p'; } else if (m.created) { lv = m.created; ls = 'c'; } else if (fin) { lv = fin; ls = 'i'; } else if (fs) { lv = fs; ls = 's'; }
    const sum = (f, days) => { let t = 0; for (let n = today_n - days + 1; n <= today_n; n++) t += at(code, f, n) || 0; return t; };
    const u7 = sum('u', 7), u28 = sum('u', 28), u90 = sum('u', SUMMARY_DAYS), r28 = sum('rev', 28), rev90 = sum('rev', SUMMARY_DAYS);
    const vd90 = sum('vd', SUMMARY_DAYS), rf90 = sum('rf', SUMMARY_DAYS);
    let withSnap = 0, inS = 0, so = 0, stNow = null, stDay = null, lr = '';
    for (let n = today_n; n > today_n - SUMMARY_DAYS; n--) {
      const s = at(code, 'st', n);
      if (s != null && stNow == null) { stNow = s; stDay = n; }
      if (n > today_n - 28) { const f = at(code, 'ins', n); if (f != null) { withSnap++; if (f === 1) inS++; else so++; } }
      if (!lr && (at(code, 'rc', n) || 0) > 0) lr = dayStr(n);
    }
    const ss = {}, su = {};
    const dy = final(code, +today.slice(0, 4)) || final(code, ys[ys.length - 1]);
    if (dy) for (const k of Object.keys(dy.sz).sort()) {
      if (stDay != null) { const v = at(code, 'st', stDay, k); if (v != null) ss[k] = v; }
      let t = 0; for (let n = today_n - 27; n <= today_n; n++) t += at(code, 'u', n, k) || 0;
      if (t) su[k] = t;
    }
    arts.push({
      code, t: m.title, c: m.color, k: m.category, lv, ls, fs: fs || null, ll: ll || null,
      u7, u28, u90, ut: utot, r28: r2(r28), st: stNow,
      ins28: withSnap ? Math.round(inS / withSnap * 1000) / 1000 : null, so28: withSnap ? so : null,
      cov: stNow != null && u28 > 0 ? Math.round(stNow / (u28 / 28) * 10) / 10 : null,
      stp: stNow != null && u28 + stNow > 0 ? Math.round(u28 / (u28 + stNow) * 1000) / 1000 : null,
      ap: u90 > 0 ? Math.round(rev90 / u90) : null,
      vr: u90 + vd90 > 0 ? Math.round(vd90 / (u90 + vd90) * 1000) / 1000 : null,
      rr: u90 + rf90 > 0 ? Math.round(rf90 / (u90 + rf90) * 1000) / 1000 : null,
      lr: lr || null, ss, su
    });
  }
  arts.sort((a, b) => (b.u28 - a.u28) || (a.code < b.code ? -1 : 1));
  const summary = { version: ROLLUP_VERSION, as_of: today, coverage_from: coverageFrom, count: arts.length, articles: arts };
  const summaryBytes = estimateDocSize(COL.summary + '/all', summary);
  let summaryOk = true;
  if (summaryBytes > limits.summary) { summaryOk = false; errors.push('summary ' + summaryBytes + ' B exceeds ' + limits.summary + ' B - not written'); }
  for (const o of oversize) errors.push('year doc ' + o.id + ' ' + o.bytes + ' B exceeds ' + limits.doc + ' B - not written');

  const byCode = new Map();
  for (const [code, ys] of codeYears) byCode.set(code, ys.map((y) => final(code, y)));
  const shadow = shadowCompare(input.lineItems || [], windowFrom, today, byCode, covN);

  let maxYear = 0;
  for (const id of changed) { const b = estimateDocSize(COL.daily + '/' + id, docs.get(id)); if (b > maxYear) maxYear = b; }
  return { docs, changed, unchanged, summary, summaryOk, summaryBytes, quality: q, shadow, errors, oversize, coverageFrom, maxYearDocBytes: maxYear, articles: arts.length };
}

// ── shadow compare ──────────────────────────────────────────────
// Recomputes NET units per article straight from the raw line items — its own
// loop, not cleanLineItem — and compares with what the stored year docs add
// up to over the same days. docsByCode: Map(code -> [year docs]).
function shadowCompare(lineItems, from, to, docsByCode, covN) {
  const exp = new Map();
  const floor = covN === undefined ? -Infinity : covN;
  for (const li of lineItems) {
    const sku = String(li.sku || '').trim().toUpperCase();
    if (!sku || sku === 'NO-SKU') continue;
    const day = String(li.order_created_at || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < from || day > to) continue;
    if (dayNum(day) < floor) continue;
    const qty = Number(li.quantity) || 0, price = Number(li.price) || 0;
    if (qty <= 0 || price < 1) continue;
    const st = String(li.financial_status || '').toLowerCase();
    if (st === 'voided' || st === 'refunded' || li.cancelled_at) continue;
    const rq = Math.min(qty, Math.max(0, Number(li.refunded_quantity) || 0));
    const code = sku.split('-')[0];
    exp.set(code, (exp.get(code) || 0) + (qty - rq));
  }
  const fn = dayNum(from), tn = dayNum(to), mism = [];
  const codes = new Set([...exp.keys(), ...docsByCode.keys()]);
  for (const code of [...codes].sort()) {
    let g = 0;
    for (const d of docsByCode.get(code) || []) {
      const y0 = yearStart(d.year);
      for (let i = 0; i < d.u.length; i++) { const n = y0 + i; if (n >= fn && n <= tn && d.u[i] != null) g += d.u[i]; }
    }
    const e = exp.get(code) || 0;
    if (e !== g) mism.push({ code, expected: e, got: g });
  }
  return { checked: codes.size, mismatches: mism.length, sample: mism.slice(0, 20) };
}

// ── the run ─────────────────────────────────────────────────────
const BATCH = 400;
async function runRollup(opts) {
  const db = opts.db, nowMs = opts.nowMs || Date.now();
  const today = pktDay(nowMs), nowIso = new Date(nowMs).toISOString();
  const metaRef = db.collection(COL.meta).doc('status');
  let prev = null;
  try { const s = await metaRef.get(); prev = s.exists ? s.data() : null; } catch (e) { prev = null; }
  let mode = opts.mode === 'full' ? 'full' : 'nightly', upgraded = false;
  if (mode === 'nightly' && (!prev || prev.version !== ROLLUP_VERSION || prev.state === 'failed' || !prev.coverage_from)) { mode = 'full'; upgraded = true; }
  let windowFrom = mode === 'full' ? '0000-01-01' : dayStr(dayNum(today) - (TRAILING_DAYS - 1));
  let readFrom = mode === 'full' ? windowFrom : dayStr(dayNum(windowFrom) - BUFFER_DAYS);
  const base = { version: ROLLUP_VERSION, mode, upgraded_to_full: upgraded, triggered_by: opts.triggeredBy || 'schedule', started_at: nowIso, window: { from: mode === 'full' ? null : windowFrom, to: today } };
  try {
    await metaRef.set(Object.assign({}, prev || {}, base, { state: 'running' }));

    const snapQ = mode === 'full' ? db.collection('shopify_inventory_snapshots') : db.collection('shopify_inventory_snapshots').where('date', '>=', readFrom);
    const liQ = mode === 'full' ? db.collection('shopify_line_items') : db.collection('shopify_line_items').where('order_created_at', '>=', readFrom);
    const [liS, prS, snS] = await Promise.all([liQ.get(), db.collection('shopify_products').get(), snapQ.get()]);
    const lineItems = [], products = [], snapshots = [];
    liS.forEach((d) => lineItems.push(d.data()));
    prS.forEach((d) => products.push(d.data()));
    snS.forEach((d) => snapshots.push({ id: d.id, data: d.data() }));

    if (mode === 'full') {
      // a full rebuild starts on the first day any data exists
      let first = today;
      for (const li of lineItems) { const d = dayOf(li.order_created_at); if (d && d < first) first = d; }
      for (const s of snapshots) { const d = dayOf(s.data && (s.data.date || s.id)); if (d && d < first) first = d; }
      windowFrom = readFrom = dayStr(dayNum(first) - 1);
      base.window.from = windowFrom;
    }
    let prior = new Map();
    if (mode !== 'full') {
      const minYear = Math.min(+windowFrom.slice(0, 4), +dayStr(dayNum(today) - SUMMARY_DAYS).slice(0, 4));
      const dS = await db.collection(COL.daily).where('year', '>=', minYear).get();
      dS.forEach((d) => prior.set(d.id, d.data()));
    }
    const out = buildRollup({ lineItems, products, snapshots, today, readFrom, windowFrom, coverageFrom: mode === 'full' ? null : prev.coverage_from, prior, limits: opts.limits });

    const writes = [];
    for (const id of out.changed) writes.push([COL.daily, id, out.docs.get(id)]);
    if (out.summaryOk) writes.push([COL.summary, 'all', out.summary]);
    for (let i = 0; i < writes.length; i += BATCH) {
      const b = db.batch();
      for (const [c, id, data] of writes.slice(i, i + BATCH)) b.set(db.collection(c).doc(id), data);
      await b.commit();
    }
    const state = out.errors.length ? 'partial' : (out.shadow.mismatches ? 'mismatch' : 'done');
    const report = Object.assign({}, base, {
      state, finished_at: nowIso, last_success_at: state === 'done' || state === 'mismatch' ? nowIso : (prev && prev.last_success_at) || null,
      coverage_from: out.coverageFrom, articles: out.articles,
      counts: { line_items_read: lineItems.length, products_read: products.length, snapshots_read: snapshots.length, year_docs_written: out.changed.size, year_docs_unchanged: out.unchanged.size, summary_written: out.summaryOk },
      sizes: { summary_bytes: out.summaryBytes, max_year_doc_bytes: out.maxYearDocBytes },
      quality: out.quality, shadow: out.shadow, errors: out.errors
    });
    await metaRef.set(report);
    return report;
  } catch (e) {
    const failed = Object.assign({}, prev || {}, base, { state: 'failed', error: String((e && e.message) || e), finished_at: nowIso });
    try { await metaRef.set(failed); } catch (_) { /* the run already failed; the log has it */ }
    return failed;
  }
}

let _db;
function getDb() {
  if (!_db) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    _db = admin.firestore();
  }
  return _db;
}

// Scheduled entry. Netlify ignores a background function's return value; the
// result is shopify_rollup_meta/status.
exports.handler = async function (event) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.error('[article-rollup] FIREBASE_SERVICE_ACCOUNT missing'); return { statusCode: 500, body: '{"error":"not configured"}' }; }
  const mode = event && event.mode === 'full' ? 'full' : 'nightly';
  const report = await runRollup({ db: getDb(), nowMs: Date.now(), mode, triggeredBy: (event && event.triggeredBy) || 'schedule' });
  console.log('[article-rollup]', report.state, JSON.stringify({ mode: report.mode, counts: report.counts, shadow: report.shadow && report.shadow.mismatches, errors: report.errors, error: report.error }));
  return { statusCode: report.state === 'failed' ? 500 : 200, body: JSON.stringify({ state: report.state }) };
};

exports.runRollup = runRollup;
exports.buildRollup = buildRollup;
exports.shadowCompare = shadowCompare;
exports.estimateDocSize = estimateDocSize;
exports.cleanLineItem = cleanLineItem;
exports.sizeFor = sizeFor;
exports.effectiveDay = effectiveDay;
exports.ROLLUP_VERSION = ROLLUP_VERSION;
exports.COL = COL;

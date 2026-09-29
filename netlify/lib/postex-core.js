/* postex-core — shared PostEx COD sync logic (read-only).
 *
 * Required by the Netlify functions (postex-sync-background, postex-status).
 * Lives OUTSIDE netlify/functions so Netlify does not treat it as its own
 * function; esbuild bundles it into each caller.
 *
 * Pulls parcels from the PostEx Merchant API get-all-order endpoint and
 * upserts a normalised, PII-free record per parcel into Firestore
 * `postex_orders/{trackingNumber}`, plus a run summary to
 * `postex_sync_meta/last_run`. NEVER stores customer name/phone/address.
 *
 * The PostEx API is slow (a 4-day window can take >6s to respond), so this is
 * meant to run inside a BACKGROUND function (15-min budget). Windows are split
 * into <=CHUNK_DAYS slices, each fetched with a generous abort guard; a failed
 * chunk is recorded and skipped, never fatal.
 */
const admin = require("firebase-admin");

const POSTEX_BASE = "https://api.postex.pk/services/integration/api/order/v1/get-all-order";
const CHUNK_DAYS = 5;            // days per fetch window
const FETCH_TIMEOUT_MS = 30000;  // per-window abort guard (background has 15 min)

// ── Firebase Admin ──────────────────────────────────────────────
let _db;
function getDb() {
  if (!_db) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
    _db = admin.firestore();
  }
  return _db;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

// PostEx status string → coarse lifecycle category.
function statusCategory(s) {
  const x = String(s || "").toLowerCase();
  if (x.includes("unbooked")) return "pending";
  if (x.includes("delivered")) return "delivered";           // "Delivered" only (not "Out For Delivery")
  if (x.includes("return")) return "returned";               // Returned, Out For Return
  if (x.includes("cancel") || x.includes("expired") || x.includes("un-assigned") || x.includes("unassigned")) return "cancelled";
  return "in_transit";  // Booked, Picked, Warehouse, Out For Delivery, Attempted, En-Route, Delivery Under Review
}

// Fetch one date window from get-all-order.
// Confirmed via live probe: GET only, params orderStatusId (case-sensitive) +
// startDate + endDate.
async function fetchWindow(token, startDate, endDate) {
  const qs = `?orderStatusId=0&startDate=${startDate}&endDate=${endDate}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(POSTEX_BASE + qs, { method: "GET", headers: { token }, signal: ctrl.signal });
    const data = await r.json().catch(() => ({ _nonJson: true }));
    return { httpStatus: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// Split an inclusive [fromDate,toDate] range into <= CHUNK_DAYS slices. Noon
// anchoring dodges any DST/offset edge on the day boundaries.
function dateChunks(fromDate, toDate) {
  const DAY = 86400000;
  const fromMs = new Date(`${fromDate}T12:00:00`).getTime();
  const toMs = new Date(`${toDate}T12:00:00`).getTime();
  const out = [];
  for (let s = fromMs; s <= toMs; s += CHUNK_DAYS * DAY) {
    const e = Math.min(s + (CHUNK_DAYS - 1) * DAY, toMs);
    out.push([isoDate(new Date(s)), isoDate(new Date(e))]);
  }
  return out;
}

// Recursively blank out customer PII so ?debug output never leaks it.
const _PII = new Set(["customername", "customerphone", "deliveryaddress", "phone1", "phone2", "phone3", "contactpersonname"]);
function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = _PII.has(k.toLowerCase()) ? "***" : redact(v[k]);
    return o;
  }
  return v;
}

// Normalise one PostEx order (dropping customer PII) into a Firestore doc.
function normalize(order) {
  return {
    trackingNumber: order.trackingNumber || null,
    orderRefNumber: order.orderRefNumber || null,   // = Shopify order number
    status: order.transactionStatus || null,
    statusCategory: statusCategory(order.transactionStatus),
    dispatched: statusCategory(order.transactionStatus) !== "pending"
      && statusCategory(order.transactionStatus) !== "cancelled",
    transactionDate: order.transactionDate || null,   // order creation date (ship cohort)
    orderPickupDate: order.orderPickupDate || null,
    orderDeliveryDate: order.orderDeliveryDate || null,
    cityName: order.cityName || null,
    items: num(order.items),
    orderDetail: order.orderDetail || null,           // SKU / product text
    // ── COD / money ──
    cod: num(order.invoicePayment),
    transactionFee: num(order.transactionFee),
    transactionTax: num(order.transactionTax),
    reversalFee: num(order.reversalFee),
    reversalTax: num(order.reversalTax),
    upfrontPayment: num(order.upfrontPayment),
    upfrontPaymentDate: order.upfrontPaymentDate || null,   // when PostEx released COD
    reservePayment: num(order.reservePayment),
    balancePayment: num(order.balancePayment),
    invoiceDivision: num(order.invoiceDivision),
    merchantName: order.merchantName || null,
    courier: "postex",
    syncedAt: Date.now(),
  };
}

// Default rolling window ending today, `lookbackDays` inclusive.
function defaultRange(lookbackDays) {
  const today = new Date();
  const d = new Date(today);
  d.setDate(d.getDate() - (lookbackDays - 1));
  return { fromDate: isoDate(d), toDate: isoDate(today) };
}

// Fetch [fromDate,toDate] chunk-by-chunk, normalise, BulkWrite to Firestore,
// and persist a run summary. Returns the summary object.
async function syncRange({ token, fromDate, toDate }) {
  const start = Date.now();
  const chunks = dateChunks(fromDate, toDate);

  const byTracking = new Map();
  const fetchErrors = [];
  let postexStatus = null, postexMessage = null;
  for (const [s, e] of chunks) {
    let w;
    try {
      w = await fetchWindow(token, s, e);
    } catch (err) {
      fetchErrors.push({ chunk: [s, e], error: String((err && err.message) || err) });
      continue;
    }
    const data = w.data || {};
    postexStatus = data.statusCode || postexStatus;
    postexMessage = data.statusMessage || postexMessage;
    const rows = Array.isArray(data.dist) ? data.dist : [];
    for (const r of rows) {
      const o = r && r.trackingResponse ? r.trackingResponse : r;   // rows may be wrapped
      if (o && o.trackingNumber) byTracking.set(String(o.trackingNumber), o);
    }
  }
  const orders = [...byTracking.values()];

  // BulkWriter streams writes with high concurrency + auto-retry.
  const db = getDb();
  const byStatus = {};
  const col = db.collection("postex_orders");
  const writer = db.bulkWriter();
  for (const o of orders) {
    const doc = normalize(o);
    byStatus[doc.statusCategory] = (byStatus[doc.statusCategory] || 0) + 1;
    writer.set(col.doc(String(doc.trackingNumber)), doc, { merge: true });
  }
  await writer.close();

  const summary = {
    lastRun: Date.now(),
    fromDate, toDate,
    chunks: chunks.length,
    postexStatus,
    postexMessage,
    fetched: orders.length,
    written: orders.length,
    byStatus,
    fetchErrors,
    durationMs: Date.now() - start,
  };
  await db.collection("postex_sync_meta").doc("last_run").set(summary, { merge: true });
  return summary;
}

// Fetch only the first chunk, PII-redacted, dist truncated to 2 rows — a fast,
// safe shape check that fits inside a synchronous function.
async function debugFirstChunk({ token, fromDate, toDate }) {
  const chunks = dateChunks(fromDate, toDate);
  const w = await fetchWindow(token, chunks[0][0], chunks[0][1]);
  const dbg = JSON.parse(JSON.stringify(w.data || {}));
  if (Array.isArray(dbg.dist)) { dbg._distLength = dbg.dist.length; dbg.dist = dbg.dist.slice(0, 2); }
  return { httpStatus: w.httpStatus, chunk: chunks[0], data: redact(dbg) };
}

// ── Payment / CPR enrichment (section 3.14 Payment Status API) ──────
// One call per tracking number — there is no bulk CPR endpoint — so enrich
// incrementally: only delivered/returned parcels, rate-limited via a small
// concurrency pool. Each call returns the CPR numbers (cprNumber_1 = upfront
// receipt, cprNumber_2 = reserve receipt), the settle flag and dates, which we
// merge onto the parcel doc.
//
// A parcel used to be skipped for good the moment it held EITHER receipt
// number, so its reserve receipt, cpr2Date, settle and settlementDate never
// arrived. It is now asked about until it is FINISHED (cprState), and a later
// answer can add or replace a value but never blank one (cprUpdate). Every
// answered re-check also stamps cprRecheckedAt, which is what lets the
// give-up window close on a parcel at all (cprRechecked).
const POSTEX_PAYMENT_BASE = "https://api.postex.pk/services/integration/api/order/v1/payment-status/";

async function fetchPaymentStatus(token, trackingNumber) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(POSTEX_PAYMENT_BASE + encodeURIComponent(trackingNumber), { method: "GET", headers: { token }, signal: ctrl.signal });
    const data = await r.json().catch(() => ({ _nonJson: true }));
    return { httpStatus: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

const DAY_MS = 86400000;
// The give-up window: a parcel holding a receipt number stops being asked
// about CPR_GIVE_UP_DAYS after its first receipt — and only once it has been
// asked again at least once since that receipt appeared (cprRechecked).
// 120 is an ASSUMPTION: how long a reserve receipt takes to follow the upfront
// one is not known from here. The books start on 1 July 2026, and a window
// that closed on a parcel before anyone asked for its reserve would lose the
// very receipts the books need.
const CPR_GIVE_UP_DAYS = 120;
// It is asked again at most once every 3 days, less an hour. The daily run
// scans at about 03:00 UTC and stamps cprCheckedAt as it goes, minutes later;
// measured exactly, a parcel stamped at 03:04 is still 4 minutes short of
// 3 days when the scan three days on starts at 03:00, and every re-check would
// slide to the fourth day. The hour covers the run's own 15-minute budget.
const CPR_RECHECK_MS = 3 * DAY_MS - 3600000;

// A value PostEx actually gave: the `||` test this file has always used
// (0, "", false, null and undefined are not values), and not a blank string.
function cprHas(v) {
  return !!v && !(typeof v === "string" && !v.trim());
}

// A stored date, read as the app reads these fields (js/fulfillment.js takes
// the first ten characters as YYYY-MM-DD): the start of that day, UTC, in ms;
// null when there is no such day (2026-02-30 is not one).
function cprDayMs(v) {
  const m = typeof v === "string" && /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return new Date(ms).toISOString().slice(0, 10) === m[0] ? ms : null;
}

// When the give-up window opens: the parcel's FIRST receipt, from the first
// of these fields that holds a readable day.
//   cpr1Date           the upfront receipt's own date;
//   upfrontPaymentDate the same upfront payment as the order sync stored it
//                      (normalize) — and what this function has always written
//                      into cpr1Date itself when cpr1Date was missing;
//   cpr2Date           a parcel with no upfront date at all (a return paid on
//                      one receipt) opens from the receipt it has;
//   transactionDate    the booking, earlier than any receipt: it can only close
//                      the window sooner, never keep a parcel open forever.
// A parcel with none of the four readable has no window: it finishes only
// when settled, or — not a return — when both numbers are in.
const CPR_WINDOW_FROM = ["cpr1Date", "upfrontPaymentDate", "cpr2Date", "transactionDate"];
function cprWindowStart(d) {
  for (const f of CPR_WINDOW_FROM) {
    const ms = cprDayMs(d[f]);
    if (ms !== null) return ms;
  }
  return null;
}

// Whether the parcel has been asked about again since it first held a receipt
// number. cprRecheckedAt is written only by such a re-check, so the check that
// FOUND the receipt does not count — and no parcel enriched before this field
// existed has one. An unreadable value counts as none: the cost of that
// mistake is one more request, never a lost receipt.
function cprRechecked(d) {
  return typeof d.cprRecheckedAt === "number" && isFinite(d.cprRecheckedAt);
}

// What a scanned parcel is to this run:
//   "new"      no receipt number yet: asked every run, first, in the order the
//              query returns it — exactly as before this change, even when
//              PostEx has already said settle:true;
//   "finished" settled; or both receipt numbers in — except a RETURN, which
//              PostEx may issue only one receipt, so a return holding a
//              receipt finishes only when settled or past the window;
//   "gaveUp"   holds a receipt, not finished, CPR_GIVE_UP_DAYS past its first
//              receipt, and asked again at least once since that receipt
//              appeared;
//   "lastCheck" the same, but never asked again since its receipt appeared —
//              every parcel enriched before cprRecheckedAt existed. Asked once
//              more, exactly like "waiting" (the same throttle, the same
//              queue), and given up after that;
//   "waiting"  holds a receipt and is not finished: asked again, at most once
//              every CPR_RECHECK_MS, least recently checked first.
function cprState(d, nowMs) {
  const has1 = cprHas(d.cprNumber_1), has2 = cprHas(d.cprNumber_2);
  if (!has1 && !has2) return "new";
  if (d.settle === true) return "finished";
  if (has1 && has2 && d.statusCategory !== "returned") return "finished";
  const from = cprWindowStart(d);
  if (from !== null && nowMs - from >= CPR_GIVE_UP_DAYS * DAY_MS) return cprRechecked(d) ? "gaveUp" : "lastCheck";
  return "waiting";
}

// The write for one answered parcel. Only a value PostEx actually gave is
// written, so an answer that omits a receipt number, a date or the settle flag
// can add a value or replace it with another, never blank it; settle is only
// ever written as true. The stamp (cprCheckedAt, and cprRecheckedAt on a
// re-check) always goes with it.
function cprUpdate(dist, stamp) {
  const upd = Object.assign({}, stamp);
  const put = (field, ...vals) => {
    const v = vals.find(cprHas);
    if (v !== undefined) upd[field] = v;
  };
  if (dist.settle === true) upd.settle = true;
  put("settlementDate", dist.settlementDate);
  // Actual API field names are cpr1 / cpr1Date (not the PDF's
  // cprNumber_1 / upfrontPaymentDate); cpr2 / cpr2Date carry the
  // reserve-payment receipt. Fall back to the PDF names just in case.
  put("cprNumber_1", dist.cpr1, dist.cprNumber_1);
  put("cpr1Date", dist.cpr1Date, dist.upfrontPaymentDate);
  put("cprNumber_2", dist.cpr2, dist.cprNumber_2);
  put("cpr2Date", dist.cpr2Date, dist.reservePaymentDate);
  return upd;
}

// `fetchStatus` and `now` are seams for tests/postex-core.test.js; production
// passes neither, so the real Payment Status API and the real clock are used.
async function enrichPayments({ token, limit = 1000, concurrency = 5, fetchStatus = fetchPaymentStatus, now = Date.now }) {
  const start = now();
  const db = getDb();
  // ONE query, as before: delivered/returned parcels, projected to the fields
  // the decision reads so the scan stays cheap even at tens of thousands of
  // docs. No orderBy — the ordering happens below, in memory, so no composite
  // index is needed. Returns ARE part of CPRs too (they collect 0 COD but still
  // carry shipping+GST, and their receipt lands once the return settles), so
  // they are asked about like deliveries.
  const snap = await db.collection("postex_orders")
    .where("statusCategory", "in", ["delivered", "returned"])
    .select("trackingNumber", "statusCategory", "cprNumber_1", "cprNumber_2", "cprCheckedAt",
      "settle", "cpr1Date", "cpr2Date", "upfrontPaymentDate", "transactionDate", "cprRecheckedAt")
    .get();
  const fresh = [], due = [];
  let throttled = 0, gaveUp = 0, pastWindowUnchecked = 0;
  snap.forEach((doc) => {
    const d = doc.data();
    const c = { id: doc.id, trackingNumber: d.trackingNumber || doc.id, hadReserve: cprHas(d.cprNumber_2) };
    const state = cprState(d, start);
    if (state === "new") { fresh.push(c); return; }
    if (state === "gaveUp") gaveUp++;
    if (state === "lastCheck") pastWindowUnchecked++;
    if (state !== "waiting" && state !== "lastCheck") return;
    const at = typeof d.cprCheckedAt === "number" && isFinite(d.cprCheckedAt) ? d.cprCheckedAt : null;
    if (at !== null && start - at < CPR_RECHECK_MS) { throttled++; return; }
    c.recheck = true;
    c.at = at;
    c.n = due.length;
    due.push(c);
  });
  // Least recently checked first; one never stamped goes before them all.
  due.sort((a, b) => (a.at === b.at ? a.n - b.n : a.at === null ? -1 : b.at === null ? 1 : a.at - b.at));
  // No receipt number yet comes first, exactly as before; the re-checks share
  // whatever the per-run limit leaves.
  const candidates = fresh.concat(due);
  const batch = candidates.slice(0, limit);
  const rechecked = batch.filter((c) => c.recheck).length;

  let enriched = 0, settled = 0, errors = 0, notFound = 0, cprFound = 0, reserveFound = 0;
  let idx = 0;
  async function worker() {
    while (idx < batch.length) {
      const c = batch[idx++];
      try {
        const { httpStatus, data } = await fetchStatus(token, c.trackingNumber);
        const ref = db.collection("postex_orders").doc(c.id);
        // A re-check's cprCheckedAt IS its throttle clock, so it moves whenever
        // PostEx answered, found or not — or a parcel PostEx no longer knows
        // would be asked about every run — and cprRecheckedAt moves with it,
        // since the give-up window closes only on a parcel that has had one.
        // A failed request (an error status, a timeout) moves nothing and is
        // asked again next run. A parcel with no receipt number is stamped
        // only on a real answer, as before, and never with cprRecheckedAt.
        const stamp = () => {
          const t = now();
          return c.recheck ? { cprCheckedAt: t, cprRecheckedAt: t } : { cprCheckedAt: t };
        };
        const markChecked = () => ref.set(stamp(), { merge: true });
        if (httpStatus === 404) {
          notFound++;
          if (c.recheck) await markChecked();
          continue;
        }
        const dist = data && data.dist;
        if (dist && (dist.trackingNumber || dist.orderRefNumber)) {
          const upd = cprUpdate(dist, stamp());
          await ref.set(upd, { merge: true });
          enriched++;
          if (dist.settle === true) settled++;
          if (dist.cpr1 || dist.cpr2 || dist.cprNumber_1 || dist.cprNumber_2) cprFound++;
          if (upd.cprNumber_2 !== undefined && !c.hadReserve) reserveFound++;
        } else if (c.recheck && httpStatus >= 200 && httpStatus < 300) {
          await markChecked();
        }
      } catch (e) { errors++; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length || 1) }, () => worker()));

  const summary = {
    lastRun: now(),
    scope: "payments",
    candidates: candidates.length,  // all this run could ask about: awaitingCpr + recheckDue
    processed: batch.length,
    enriched, settled, cprFound, notFound, errors,
    awaitingCpr: fresh.length,      // no receipt number yet (asked first)
    recheckDue: due.length,         // hold a receipt, not finished, due a re-check
    throttled,                      // hold a receipt, not finished, asked in the last 3 days
    gaveUp,                         // hold a receipt, not finished, past the window, re-checked since
    pastWindowUnchecked,            // the same, never re-checked since the receipt: asked once more
    rechecked,                      // of processed, the re-checks
    reserveFound,                   // gained a reserve receipt number this run
    durationMs: now() - start,
  };
  await db.collection("postex_sync_meta").doc("payments_run").set(summary, { merge: true });
  return summary;
}

module.exports = { getDb, syncRange, debugFirstChunk, defaultRange, isoDate, statusCategory, normalize, enrichPayments, fetchPaymentStatus };

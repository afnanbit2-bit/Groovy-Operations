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
// incrementally: only delivered/returned parcels, only until they are settled,
// rate-limited via a small concurrency pool. Each call returns the CPR numbers
// (cprNumber_1 = upfront receipt, cprNumber_2 = reserve receipt), the settle
// flag and dates, which we merge onto the parcel doc.
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

async function enrichPayments({ token, limit = 1000, concurrency = 5 }) {
  const start = Date.now();
  const db = getDb();
  // Candidates: delivered/returned parcels not yet marked settled. Project only
  // the fields we need so the scan stays cheap even at tens of thousands of docs.
  const snap = await db.collection("postex_orders")
    .where("statusCategory", "in", ["delivered", "returned"])
    .select("trackingNumber", "settle", "statusCategory", "cprCheckedAt")
    .get();
  const candidates = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d.settle === true) return;                 // already settled + enriched
    // Returns rarely produce an upfront CPR — check once, then stop re-polling
    // them. Deliveries keep getting rechecked until they settle.
    if (d.statusCategory === "returned" && d.cprCheckedAt) return;
    candidates.push({ id: doc.id, trackingNumber: d.trackingNumber || doc.id });
  });
  const batch = candidates.slice(0, limit);

  let enriched = 0, settled = 0, errors = 0, notFound = 0, cprFound = 0;
  let idx = 0;
  async function worker() {
    while (idx < batch.length) {
      const c = batch[idx++];
      try {
        const { httpStatus, data } = await fetchPaymentStatus(token, c.trackingNumber);
        if (httpStatus === 404) { notFound++; continue; }
        const dist = data && data.dist;
        if (dist && (dist.trackingNumber || dist.orderRefNumber)) {
          // Actual API field names are cpr1 / cpr1Date (not the PDF's
          // cprNumber_1 / upfrontPaymentDate); cpr2 / cpr2Date carry the
          // reserve-payment receipt. Fall back to the PDF names just in case.
          await db.collection("postex_orders").doc(c.id).set({
            settle: dist.settle === true,
            settlementDate: dist.settlementDate || null,
            cprNumber_1: dist.cpr1 || dist.cprNumber_1 || null,
            cpr1Date: dist.cpr1Date || dist.upfrontPaymentDate || null,
            cprNumber_2: dist.cpr2 || dist.cprNumber_2 || null,
            cpr2Date: dist.cpr2Date || dist.reservePaymentDate || null,
            cprCheckedAt: Date.now(),
          }, { merge: true });
          enriched++;
          if (dist.settle === true) settled++;
          if (dist.cpr1 || dist.cprNumber_1) cprFound++;
        }
      } catch (e) { errors++; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length || 1) }, () => worker()));

  const summary = {
    lastRun: Date.now(),
    scope: "payments",
    candidates: candidates.length,
    processed: batch.length,
    enriched, settled, cprFound, notFound, errors,
    durationMs: Date.now() - start,
  };
  await db.collection("postex_sync_meta").doc("payments_run").set(summary, { merge: true });
  return summary;
}

module.exports = { getDb, syncRange, debugFirstChunk, defaultRange, isoDate, statusCategory, normalize, enrichPayments, fetchPaymentStatus };

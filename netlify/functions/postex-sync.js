/* postex-sync — read-only PostEx COD sync (Part 1 of the courier integration).
 *
 * Pulls parcels from the PostEx Merchant API "List Orders" (get-all-order)
 * endpoint for a rolling window and upserts a normalised, PII-free record per
 * parcel into Firestore `postex_orders/{trackingNumber}`. Also writes a run
 * summary to `postex_sync_meta/last_run`. This is the data foundation every
 * downstream view (pipeline, COD reconciliation, RTO, Shopify linkage) reads.
 *
 * Env vars (set in Netlify, NEVER in code):
 *   POSTEX_API_TOKEN        — the merchant `token` header value
 *   FIREBASE_SERVICE_ACCOUNT — service-account JSON (same as the shopify-* fns)
 *
 * Triggers:
 *   - scheduled (netlify.toml) every 4h — rolling LOOKBACK_DAYS window
 *   - on-demand GET with ?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD for backfill
 *
 * Read-only: this function never creates, cancels, or modifies orders in PostEx.
 */
const admin = require("firebase-admin");

const POSTEX_BASE = "https://api.postex.pk/services/integration/api/order/v1/get-all-order";
const LOOKBACK_DAYS = 10;   // re-pull recent orders so their status stays fresh
const WRITE_CHUNK = 400;    // Firestore batch cap is 500; stay under it
const CHUNK_DAYS = 4;       // fetch the window in <=4-day slices to bound payload size
const FETCH_TIMEOUT_MS = 6000;  // per-window fetch abort guard

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
// startDate + endDate. A single window can return hundreds of orders, so guard
// each call with an AbortController timeout — a hung fetch must not eat the
// whole function budget (Netlify caps sync/scheduled invocations ~10s).
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

// Split an inclusive [fromDate,toDate] range into <= CHUNK_DAYS slices so no
// single fetch pulls a huge (=slow, memory-heavy) payload. Noon anchoring
// dodges any DST/offset edge on the day boundaries.
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

exports.handler = async function (event) {
  const start = Date.now();
  const q = (event && event.queryStringParameters) || {};
  const token = process.env.POSTEX_API_TOKEN;
  if (!token || !process.env.FIREBASE_SERVICE_ACCOUNT) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing POSTEX_API_TOKEN or FIREBASE_SERVICE_ACCOUNT" }) };
  }

  const today = new Date();
  const toDate = q.toDate || isoDate(today);
  const fromDate = q.fromDate || (() => { const d = new Date(today); d.setDate(d.getDate() - (LOOKBACK_DAYS - 1)); return isoDate(d); })();
  const chunks = dateChunks(fromDate, toDate);

  // ?debug=1 → fetch only the first (small, fast) chunk, redact PII and truncate
  // dist to 2 rows so the field shape can be confirmed without leaking customer
  // data, dumping every order, or risking a wide-window timeout.
  if (q.debug) {
    let w;
    try {
      w = await fetchWindow(token, chunks[0][0], chunks[0][1]);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: "PostEx request failed", detail: String(e.message || e) }) };
    }
    const dbg = JSON.parse(JSON.stringify(w.data || {}));
    if (Array.isArray(dbg.dist)) { dbg._distLength = dbg.dist.length; dbg.dist = dbg.dist.slice(0, 2); }
    return { statusCode: 200, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ httpStatus: w.httpStatus, chunk: chunks[0], data: redact(dbg) }, null, 2) };
  }

  // Fetch every chunk, deduping by trackingNumber (windows are disjoint but a
  // parcel could in theory appear twice). A failed/timed-out chunk is recorded
  // and skipped, not fatal — partial freshness beats a hard 502.
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

  const db = getDb();
  const byStatus = {};
  let written = 0;
  for (let i = 0; i < orders.length; i += WRITE_CHUNK) {
    const batch = db.batch();
    for (const o of orders.slice(i, i + WRITE_CHUNK)) {
      const doc = normalize(o);
      byStatus[doc.statusCategory] = (byStatus[doc.statusCategory] || 0) + 1;
      batch.set(db.collection("postex_orders").doc(String(doc.trackingNumber)), doc, { merge: true });
    }
    await batch.commit();
    written += Math.min(WRITE_CHUNK, orders.length - i);
  }

  const summary = {
    lastRun: Date.now(),
    fromDate, toDate,
    chunks: chunks.length,
    postexStatus,
    postexMessage,
    fetched: orders.length,
    written,
    byStatus,
    fetchErrors,
    durationMs: Date.now() - start,
  };
  await db.collection("postex_sync_meta").doc("last_run").set(summary, { merge: true });

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(summary) };
};

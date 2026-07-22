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
const LOOKBACK_DAYS = 21;   // re-pull recent orders so their status stays fresh
const WRITE_CHUNK = 400;    // Firestore batch cap is 500; stay under it

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
  if (x.includes("expired") || x.includes("un-assigned") || x.includes("unassigned")) return "cancelled";
  return "in_transit";  // Booked, Picked, Warehouse, Out For Delivery, Attempted, En-Route, Delivery Under Review
}

// Call get-all-order. The guide shows the params as a JSON body labelled "GET";
// tenants vary, so try POST+JSON first, then GET+query, then GET+body. Returns
// { method, httpStatus, data } of the first attempt that yields orders (or the
// last attempt for diagnostics).
async function fetchOrders(token, fromDate, toDate) {
  // Confirmed via live probe: GET only, params startDate/endDate + orderStatusID.
  const qs = `?orderStatusId=0&startDate=${fromDate}&endDate=${toDate}`;
  const attempts = [];
  try {
    const r = await fetch(POSTEX_BASE + qs, { method: "GET", headers: { token } });
    const d = await r.json().catch(() => ({ _nonJson: true }));
    attempts.push({ method: "GET", httpStatus: r.status, data: d });
  } catch (e) {
    attempts.push({ method: "GET", error: String(e.message || e) });
  }
  return { attempts, best: attempts[0] || {} };
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

  let result;
  try {
    result = await fetchOrders(token, fromDate, toDate);
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: "PostEx request failed", detail: String(e.message || e) }) };
  }
  const data = (result && result.best && result.best.data) || {};

  // ?debug=1 → PII-redacted, dist truncated to 2 rows so the field shape can be
  // confirmed once without leaking customer data or dumping every order.
  if (q.debug) {
    const dbg = JSON.parse(JSON.stringify(data));
    if (Array.isArray(dbg.dist)) { dbg._distLength = dbg.dist.length; dbg.dist = dbg.dist.slice(0, 2); }
    return { statusCode: 200, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ httpStatus: result && result.best && result.best.httpStatus, data: redact(dbg) }, null, 2) };
  }

  // dist rows may be flat orders or wrapped as { trackingResponse: {...} }.
  const rows = Array.isArray(data.dist) ? data.dist : [];
  const orders = rows.map((r) => (r && r.trackingResponse ? r.trackingResponse : r)).filter((o) => o && o.trackingNumber);

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
    method: result && result.best && result.best.method,
    postexStatus: data.statusCode || null,
    postexMessage: data.statusMessage || null,
    fetched: orders.length,
    written,
    byStatus,
    durationMs: Date.now() - start,
  };
  await db.collection("postex_sync_meta").doc("last_run").set(summary, { merge: true });

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(summary) };
};

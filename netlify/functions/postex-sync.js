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

// Call get-all-order. The guide labels it GET with a JSON body; different PostEx
// tenants accept GET+query or POST+JSON, so try query first then fall back.
async function fetchOrders(token, fromDate, toDate) {
  const headers = { token, "Content-Type": "application/json" };
  const qs = `?orderStatusID=0&fromDate=${fromDate}&toDate=${toDate}`;
  try {
    const r = await fetch(POSTEX_BASE + qs, { method: "GET", headers });
    const d = await r.json().catch(() => null);
    if (d && (d.dist || d.statusCode)) return d;
  } catch (e) { /* fall through */ }
  const r2 = await fetch(POSTEX_BASE, {
    method: "POST", headers,
    body: JSON.stringify({ orderStatusID: 0, fromDate, toDate }),
  });
  return r2.json();
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

  let data;
  try {
    data = await fetchOrders(token, fromDate, toDate);
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: "PostEx request failed", detail: String(e.message || e) }) };
  }
  if (!data || (data.dist == null && data.statusCode && String(data.statusCode) !== "200")) {
    return { statusCode: 502, body: JSON.stringify({ error: "PostEx returned no data", response: data }) };
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
    fetched: orders.length,
    written,
    byStatus,
    durationMs: Date.now() - start,
  };
  await db.collection("postex_sync_meta").doc("last_run").set(summary, { merge: true });

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(summary) };
};

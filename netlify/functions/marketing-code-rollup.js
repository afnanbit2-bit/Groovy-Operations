// ── Marketing M4: nightly discount-code rollup ────────────────────────────
// For every discount code the Marketing module created, count the Shopify
// orders that used it and add up their value, then write the totals back to
// the code and to its creator. Scheduled in netlify.toml; the same routine is
// also run on demand by marketing-discounts.js (action "rollup").
//
// It reads ONLY the orders that carry a given code
// (shopify_orders where discount_codes array-contains CODE) — never the whole
// order history. shopify-order-sync.js writes that `discount_codes` field;
// orders synced before it did so carry none, which is fine because every
// code here is newer than that change.
//
// Known limit, stated rather than hidden: the order sync skips an order it has
// already stored, so a refund that happens AFTER an order was synced is not
// seen here. Revenue is "orders placed with the code", refunded-at-sync-time
// and cancelled orders excluded.
const admin = require("firebase-admin");

let _db;
function getDb() {
  if (!_db) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
    _db = admin.firestore();
  }
  return _db;
}

const DAY_MS = 86400000;

/** Orders that used one code → the totals stored on it. Pure. */
function summariseOrders(orders) {
  const out = { redemption_count: 0, revenue_attributed_pkr: 0, revenue_by_month: {} };
  for (const o of orders || []) {
    if (!o || o.cancelled_at) continue;
    if (/refund|void/i.test(String(o.financial_status || ""))) continue;
    const amount = Number(o.total_price) || 0;
    out.redemption_count += 1;
    out.revenue_attributed_pkr += amount;
    // Shopify's created_at carries the STORE's offset (e.g. +05:00), so the
    // first seven characters are the store-local month.
    const month = String(o.created_at || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      out.revenue_by_month[month] = (out.revenue_by_month[month] || 0) + amount;
    }
  }
  out.revenue_attributed_pkr = Math.round(out.revenue_attributed_pkr * 100) / 100;
  for (const k of Object.keys(out.revenue_by_month)) {
    out.revenue_by_month[k] = Math.round(out.revenue_by_month[k] * 100) / 100;
  }
  return out;
}

/** A code's own status from its expiry. Pure. */
function codeStatus(code, nowMs) {
  const ends = Number(code && code.expires_at);
  return ends && nowMs >= ends ? "expired" : "active";
}

/** Per-creator totals across all of a creator's codes. Pure. */
function creatorTotals(codes) {
  const by = {};
  for (const c of codes || []) {
    if (!c || !c.creator_id) continue;
    const t = by[c.creator_id] || (by[c.creator_id] = {
      lifetime_codes_issued: 0, lifetime_code_redemptions: 0, lifetime_code_revenue_attributed: 0,
    });
    t.lifetime_codes_issued += 1;
    t.lifetime_code_redemptions += Number(c.redemption_count) || 0;
    t.lifetime_code_revenue_attributed += Number(c.revenue_attributed_pkr) || 0;
  }
  for (const k of Object.keys(by)) {
    by[k].lifetime_code_revenue_attributed = Math.round(by[k].lifetime_code_revenue_attributed * 100) / 100;
  }
  return by;
}

async function runRollup(db, nowMs) {
  const now = nowMs || Date.now();
  const snap = await db.collection("discount_codes").get();
  const codes = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  let updated = 0;
  const batchWrites = [];
  for (const c of codes) {
    // A code that expired more than 60 days ago cannot gain orders any more.
    const ends = Number(c.expires_at) || 0;
    const settled = c.status === "expired" && ends && now - ends > 60 * DAY_MS && c.rolled_up_at;
    if (settled) continue;
    const orders = await db.collection("shopify_orders")
      .where("discount_codes", "array-contains", String(c.code).toUpperCase()).get();
    const totals = summariseOrders(orders.docs.map((d) => d.data()));
    Object.assign(c, totals, { status: codeStatus(c, now) });
    batchWrites.push({ ref: db.collection("discount_codes").doc(c.id),
      data: Object.assign({}, totals, { status: c.status, rolled_up_at: now }) });
    updated++;
  }
  const byCreator = creatorTotals(codes);
  // Only creators that still exist — an update would fail the whole batch on
  // a deleted one, and a merge-set would resurrect it as a stub.
  const creatorRefs = Object.keys(byCreator).map((id) => db.collection("creators").doc(id));
  const creatorSnaps = creatorRefs.length ? await db.getAll(...creatorRefs) : [];
  for (const s of creatorSnaps) {
    if (s.exists) batchWrites.push({ ref: s.ref, data: byCreator[s.id] });
  }
  for (let i = 0; i < batchWrites.length; i += 400) {
    const b = db.batch();
    for (const w of batchWrites.slice(i, i + 400)) b.update(w.ref, w.data);
    await b.commit();
  }
  const summary = { last_run_at: now, codes_total: codes.length, codes_updated: updated,
    creators_updated: creatorSnaps.filter((s) => s.exists).length };
  await db.collection("shopify_sync_meta").doc("marketing_codes").set(summary, { merge: true });
  return summary;
}

exports.handler = async function () {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing env var: FIREBASE_SERVICE_ACCOUNT" }) };
  }
  try {
    const summary = await runRollup(getDb());
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

exports.runRollup = runRollup;
exports.summariseOrders = summariseOrders;
exports.codeStatus = codeStatus;
exports.creatorTotals = creatorTotals;

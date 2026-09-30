/* shopify-order-refresh-background — SCHEDULED (netlify.toml, every 4h at :20)
 * status refresh of orders already in Firestore: later refunds and
 * cancellations. See netlify/lib/shopify-order-refresh.js for the rules.
 * Background function (15-min budget). Window = last complete run start minus
 * the overlap (default 48h; env SHOPIFY_REFRESH_OVERLAP_HOURS), first run 7
 * days. Result: shopify_sync_meta/order_refresh.
 */
"use strict";
const lib = require("../lib/shopify-order-refresh.js");

exports.handler = async function () {
  const missing = lib.REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) return { statusCode: 500, body: JSON.stringify({ error: `Missing env vars: ${missing.join(", ")}` }) };
  try {
    const hrs = Number(process.env.SHOPIFY_REFRESH_OVERLAP_HOURS);
    const out = await lib.refreshOrders({
      db: lib.getDb(),
      token: await lib.getShopifyToken(),
      store: process.env.SHOPIFY_STORE_DOMAIN,
      metaDoc: "order_refresh",
      mode: "scheduled",
      overlapHours: hrs > 0 ? hrs : 48,
      defaultDays: 7,
    });
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(out) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

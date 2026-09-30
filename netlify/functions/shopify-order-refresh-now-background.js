/* shopify-order-refresh-now-background — owners' ON-DEMAND status re-sync for
 * the last N days (default 60, max 365) of orders already held.
 * POST { idToken, days? }. The caller's Firebase ID token is verified here and
 * checked against OWNER_EMAILS (mirrors isOwner() in firestore.rules, and
 * admin-reset-password.js). Netlify answers a background function 202 at once
 * and ignores the return value; the result is in
 * shopify_sync_meta/order_refresh_now (status complete|partial, counts). A
 * partial run continues when the same request is sent again.
 */
"use strict";
const admin = require("firebase-admin");
const lib = require("../lib/shopify-order-refresh.js");

const OWNER_EMAILS = ["afnan@groovy.op", "ammar@groovy.op"]; // mirrors firestore.rules isOwner()
const DEFAULT_DAYS = 60;
const MAX_DAYS = 365;

const json = (statusCode, obj) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

exports.handler = async function (event) {
  if (event && event.httpMethod && event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return json(500, { error: "Missing env var FIREBASE_SERVICE_ACCOUNT" });
  let body;
  try { body = JSON.parse((event && event.body) || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }
  if (!body.idToken) return json(400, { error: "idToken is required" });

  let days = DEFAULT_DAYS;
  if (body.days !== undefined && body.days !== null) {
    days = Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return json(400, { error: `days must be a whole number from 1 to ${MAX_DAYS}` });
  }

  let caller;
  try {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    caller = await admin.auth().verifyIdToken(body.idToken);
  } catch { return json(401, { error: "Could not verify who you are — sign in again and retry." }); }
  const email = String(caller.email || "").toLowerCase();
  if (!OWNER_EMAILS.includes(email)) return json(403, { error: "Only an owner can re-sync order statuses." });

  const missing = lib.REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(", ")}` });
  try {
    const out = await lib.refreshOrders({
      db: lib.getDb(),
      token: await lib.getShopifyToken(),
      store: process.env.SHOPIFY_STORE_DOMAIN,
      metaDoc: "order_refresh_now",
      mode: "manual",
      days,
    });
    return json(200, Object.assign({ ran_by: email, days }, out));
  } catch (err) {
    return json(500, { error: err.message });
  }
};

exports.OWNER_EMAILS = OWNER_EMAILS;

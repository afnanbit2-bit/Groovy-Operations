/* pattern-sync-now-background — run the Shopify catalog sync ON DEMAND.
 *
 * Why this exists: shopify-catalog-sync is a SCHEDULED function
 * (netlify.toml, 9am PKT), and Netlify answers a direct HTTP request to a
 * scheduled function with 403 — verified from Afnan's browser on 17 Sept
 * 2026. The Pattern Hub's reconcile page needs today's rollup, not
 * tomorrow's, so this wraps the same handler behind a POST that verifies
 * the caller's Firebase ID token server-side.
 *
 * A BACKGROUND function (the `-background` suffix, 15-minute budget) because
 * the sync fetches ~490 products and makes ~2,000 Firestore writes — too
 * close to a synchronous function's 10s limit to trust. Netlify returns 202
 * immediately and ignores the handler's result, so the client cannot see a
 * refusal here; it polls shopify_sync_meta/catalog_sync.last_run_at
 * instead and reads the run summary from that document when it lands.
 * The client-side button is already limited to pattern admins; this check
 * is the boundary behind it, not the UI.
 *
 * PATTERN_ADMIN_EMAILS mirrors isPatternAdmin() in firestore.rules and
 * _PATTERN_HUB_USERS in js/patterns.js — a test holds the three equal.
 */
const admin = require("firebase-admin");
const sync = require("./shopify-catalog-sync.js");

const PATTERN_ADMIN_EMAILS = ["afnan@groovy.op", "ammar@groovy.op", "mustafa@groovy.op"];

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

function ensureAdmin() {
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
}

exports.handler = async function (event) {
  if (event && event.httpMethod && event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return json(500, { error: "Missing env var FIREBASE_SERVICE_ACCOUNT" });

  let body;
  try { body = JSON.parse((event && event.body) || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }
  if (!body.idToken) return json(400, { error: "idToken is required" });

  let caller;
  try { ensureAdmin(); caller = await admin.auth().verifyIdToken(body.idToken); }
  catch { return json(401, { error: "Could not verify who you are — sign in again and retry." }); }
  const email = String(caller.email || "").toLowerCase();
  if (!PATTERN_ADMIN_EMAILS.includes(email)) return json(403, { error: "Your account cannot run the catalog sync." });

  // The scheduled function's own handler, unchanged — it writes its run
  // summary to shopify_sync_meta/catalog_sync, which is what the client polls.
  const res = await sync.handler({ triggeredBy: email });
  let out = {};
  try { out = JSON.parse(res.body || "{}"); } catch {}
  return json(res.statusCode || 500, Object.assign({ ran_by: email }, out));
};

exports.PATTERN_ADMIN_EMAILS = PATTERN_ADMIN_EMAILS;

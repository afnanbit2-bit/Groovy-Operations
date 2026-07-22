/* postex-payments-background — enrich parcels with PostEx CPR / payment data.
 *
 * Calls the Payment Status API (section 3.14) one tracking number at a time
 * (no bulk endpoint exists) for delivered/returned parcels that aren't settled
 * yet, and merges the CPR numbers + settlement dates onto each parcel doc. Runs
 * as a BACKGROUND function (15-min budget); enrichment is incremental so a full
 * backfill spreads across a few runs.
 *
 * Triggers:
 *   - scheduled (netlify.toml) daily — settlements land over days, not hours.
 *   - on-demand GET ?limit=1500 to push a bigger batch during backfill.
 *
 * Env vars: POSTEX_API_TOKEN, FIREBASE_SERVICE_ACCOUNT.
 * Read-only toward orders (never creates/cancels); only writes payment fields.
 */
const { enrichPayments } = require("../lib/postex-core");

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const token = process.env.POSTEX_API_TOKEN;
  if (!token || !process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error("[postex-payments] Missing POSTEX_API_TOKEN or FIREBASE_SERVICE_ACCOUNT");
    return;
  }
  const limit = Math.min(4000, Math.max(1, parseInt(q.limit) || 1000));
  const concurrency = Math.min(10, Math.max(1, parseInt(q.concurrency) || 5));
  try {
    const summary = await enrichPayments({ token, limit, concurrency });
    console.log("[postex-payments] done", JSON.stringify(summary));
  } catch (e) {
    console.error("[postex-payments] failed", String((e && e.message) || e));
  }
};

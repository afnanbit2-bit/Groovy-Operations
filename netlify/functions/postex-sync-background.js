/* postex-sync-background — read-only PostEx COD sync (Part 1 of the courier
 * integration), as a Netlify BACKGROUND function (15-min budget).
 *
 * The `-background` suffix is what gives Netlify the long execution window; the
 * PostEx API is too slow to reliably finish inside a 10s synchronous function.
 * Background functions return 202 immediately with no body — check results via
 * the `postex-status` function (reads postex_sync_meta/last_run).
 *
 * Triggers:
 *   - scheduled (netlify.toml) every 4h — rolling LOOKBACK_DAYS window so late
 *     status changes (deliveries/returns days after dispatch) are re-pulled.
 *   - on-demand GET ?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD — historical backfill
 *     of an arbitrary range in a single call.
 *
 * Env vars (set in Netlify, NEVER in code):
 *   POSTEX_API_TOKEN, FIREBASE_SERVICE_ACCOUNT
 *
 * Read-only: never creates, cancels, or modifies orders in PostEx.
 */
const { syncRange, defaultRange } = require("../lib/postex-core");

const LOOKBACK_DAYS = 14;  // cover the full dispatch→deliver/return lifecycle

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const token = process.env.POSTEX_API_TOKEN;
  if (!token || !process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error("[postex-sync] Missing POSTEX_API_TOKEN or FIREBASE_SERVICE_ACCOUNT");
    return;
  }

  const def = defaultRange(LOOKBACK_DAYS);
  const fromDate = q.fromDate || def.fromDate;
  const toDate = q.toDate || def.toDate;

  try {
    const summary = await syncRange({ token, fromDate, toDate });
    console.log("[postex-sync] done", JSON.stringify(summary));
  } catch (e) {
    console.error("[postex-sync] failed", String((e && e.message) || e));
  }
};

/* postex-status — read the last PostEx sync run summary (fast, synchronous).
 *
 * The heavy sync runs in postex-sync-background (returns 202, no body), so use
 * this to see what the last run did:
 *   GET /.netlify/functions/postex-status
 *     → the postex_sync_meta/last_run summary as JSON.
 *   GET /.netlify/functions/postex-status?debug=1[&fromDate=&toDate=]
 *     → a single-chunk, PII-redacted, 2-row sample of the live PostEx response
 *       (shape check only; does not write anything).
 *
 * Read-only.
 */
const { getDb, debugFirstChunk, defaultRange } = require("../lib/postex-core");

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const token = process.env.POSTEX_API_TOKEN;
  if (!token || !process.env.FIREBASE_SERVICE_ACCOUNT) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing POSTEX_API_TOKEN or FIREBASE_SERVICE_ACCOUNT" }) };
  }

  try {
    if (q.debug) {
      const def = defaultRange(3);
      const d = await debugFirstChunk({ token, fromDate: q.fromDate || def.fromDate, toDate: q.toDate || def.toDate });
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(d, null, 2) };
    }
    const snap = await getDb().collection("postex_sync_meta").doc("last_run").get();
    const data = snap.exists ? snap.data() : { note: "No sync has run yet." };
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data, null, 2) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: "postex-status failed", detail: String((e && e.message) || e) }) };
  }
};

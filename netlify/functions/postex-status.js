/* postex-status — read the last PostEx sync run summary (fast, synchronous).
 *
 * The heavy sync runs in postex-sync-background (returns 202, no body), so use
 * this to see what the last run did:
 *   GET /.netlify/functions/postex-status
 *     → the postex_sync_meta/last_run summary as JSON.
 *   GET /.netlify/functions/postex-status?debug=1[&fromDate=&toDate=]
 *     → a single-chunk, PII-redacted, 2-row sample of the live PostEx response.
 *   GET /.netlify/functions/postex-status?payments=1
 *     → the postex_sync_meta/payments_run summary (enriched/errors/etc).
 *   GET /.netlify/functions/postex-status?paydebug=TRACKINGNUMBER
 *     → the raw Payment Status API response for one parcel (verify CPR shape).
 *
 * Read-only.
 */
const { getDb, debugFirstChunk, defaultRange, fetchPaymentStatus } = require("../lib/postex-core");

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
    if (q.paydebug) {
      const r = await fetchPaymentStatus(token, q.paydebug);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(r, null, 2) };
    }
    if (q.counts) {
      // Diagnose the enrichment candidate query: what does the server actually
      // see for delivered/returned parcels and their settle/CPR state?
      const db = getDb();
      const snap = await db.collection("postex_orders")
        .where("statusCategory", "in", ["delivered", "returned"])
        .select("statusCategory", "settle", "cprNumber_1", "cprCheckedAt").get();
      const c = { queryTotal: snap.size, delivered: 0, returned: 0, settledTrue: 0, hasCpr: 0, checked: 0 };
      snap.forEach((d) => {
        const x = d.data();
        if (x.statusCategory === "delivered") c.delivered++; else if (x.statusCategory === "returned") c.returned++;
        if (x.settle === true) c.settledTrue++;
        if (x.cprNumber_1) c.hasCpr++;
        if (x.cprCheckedAt) c.checked++;
      });
      // Also a total collection count via aggregate.
      let allCount = null;
      try { const agg = await db.collection("postex_orders").count().get(); allCount = agg.data().count; } catch (e) {}
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...c, collectionTotal: allCount }, null, 2) };
    }
    const docId = q.payments ? "payments_run" : "last_run";
    const snap = await getDb().collection("postex_sync_meta").doc(docId).get();
    const data = snap.exists ? snap.data() : { note: `No ${docId} yet.` };
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data, null, 2) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: "postex-status failed", detail: String((e && e.message) || e) }) };
  }
};

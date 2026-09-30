/* shopify-order-refresh — bring ORDER STATUS on existing Firestore docs up to
 * date with Shopify.
 *
 * Why: shopify-order-sync.js skips an order it already holds, so a refund or
 * cancellation made after the first sync never reached shopify_orders /
 * shopify_line_items (the app read ~22% high in Sep 2026).
 *
 * What it does: fetches orders with updated_at_min (REST orders.json),
 * and for each order that ALREADY EXISTS in shopify_orders updates, in place,
 * only the status fields from netlify/lib/shopify-order-status.js:
 *   order: financial_status, cancelled_at, refunded_at
 *   line : financial_status, cancelled_at, refunded_quantity, refunded_at
 * plus status_synced_at, and only when a value actually changed (so a second
 * run over the same data writes nothing). It never creates an order or a line
 * item (orders older than the history held are therefore ignored; new orders
 * are the order sync's job) and never touches title, sku, price, quantity,
 * synced_at or any other field.
 *
 * Resume: progress is checkpointed per page in a shopify_sync_meta doc
 * (resume_url + window_start). A run that runs out of time or is rate limited
 * stops "partial" and the next run continues from resume_url. A finished run
 * records last_complete_at = when it STARTED; the next scheduled window starts
 * at last_complete_at - overlap.
 */
"use strict";
const admin = require("firebase-admin");
const status = require("./shopify-order-status.js");

const SHOPIFY_API_VERSION = "2026-04";
const PAGE_SIZE = 100;
const MAX_RETRIES = 3;

function parseNextUrl(linkHeader) {
  if (!linkHeader) return null;
  for (const part of String(linkHeader).split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
function diff(existing, next) {
  const out = {};
  for (const k of Object.keys(next)) if (!same(existing && existing[k], next[k])) out[k] = next[k];
  return out;
}

/* opts: { db, token, store, metaDoc, mode: 'scheduled'|'manual', days,
 *         overlapHours, defaultDays, budgetMs, sleep, now, fetchFn } */
async function refreshOrders(opts) {
  const {
    db, token, store, metaDoc, mode,
  } = opts;
  const days = opts.days || opts.defaultDays || 7;
  const overlapMs = (opts.overlapHours == null ? 48 : opts.overlapHours) * 3600000;
  const budgetMs = opts.budgetMs || 12 * 60000;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const fetchFn = opts.fetchFn || fetch;
  const startMs = (opts.now ? opts.now() : Date.now());
  const clock = opts.clock || (() => Date.now());
  const t0 = clock();
  const left = () => budgetMs - (clock() - t0);
  const TS = admin.firestore.FieldValue.serverTimestamp();

  const metaRef = db.collection("shopify_sync_meta").doc(metaDoc);
  const prev = ((await metaRef.get()).data()) || {};

  // Window and resume point.
  let windowStart;
  let url = null;
  let runStarted = new Date(startMs).toISOString();
  const canResume = prev.status === "partial" && prev.resume_url && prev.window_start &&
    (mode === "scheduled" || prev.days === days);
  if (canResume) {
    windowStart = prev.window_start;
    url = prev.resume_url;
    runStarted = prev.run_started_at || runStarted;
  } else if (mode === "manual") {
    windowStart = new Date(startMs - days * 86400000).toISOString();
  } else if (prev.last_complete_at) {
    windowStart = new Date(Date.parse(prev.last_complete_at) - overlapMs).toISOString();
  } else {
    windowStart = new Date(startMs - days * 86400000).toISOString();
  }
  if (!url) {
    url = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=${PAGE_SIZE}&status=any&updated_at_min=${encodeURIComponent(windowStart)}`;
  }

  const c = {
    orders_seen: 0, orders_missing: 0, orders_changed: 0,
    line_items_changed: 0, line_items_missing: 0, pages: 0, retries_429: 0,
  };
  let stoppedBecause = null;

  const save = (extra) => metaRef.set(Object.assign({
    mode, days, window_start: windowStart, run_started_at: runStarted,
    last_run_at: TS, resume_url: null,
  }, extra), { merge: true });

  try {
    while (url) {
      if (left() < 3000) { stoppedBecause = "time_budget"; break; }

      // Fetch with 429 back-off.
      let res;
      for (let attempt = 0; ; attempt++) {
        res = await fetchFn(url, { headers: { "X-Shopify-Access-Token": token } });
        if (res.status !== 429) break;
        c.retries_429++;
        const ra = Number(res.headers && res.headers.get && res.headers.get("retry-after"));
        const waitMs = (ra > 0 ? ra : Math.pow(2, attempt + 1)) * 1000;
        if (attempt >= MAX_RETRIES || waitMs > left() - 3000) { res = null; break; }
        await sleep(waitMs);
      }
      if (!res) { stoppedBecause = "rate_limited"; break; }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Shopify ${res.status}: ${String(text).slice(0, 300)}`);
      }
      const orders = (await res.json()).orders || [];
      const next = parseNextUrl(res.headers && res.headers.get && res.headers.get("link"));
      c.orders_seen += orders.length;

      if (orders.length) {
        const oRefs = orders.map((o) => db.collection("shopify_orders").doc(String(o.id)));
        const oSnaps = await db.getAll(...oRefs);
        const have = orders.filter((o, i) => oSnaps[i].exists);
        c.orders_missing += orders.length - have.length;

        const lRefs = [];
        for (const o of have) for (const li of o.line_items || []) {
          lRefs.push(db.collection("shopify_line_items").doc(`${o.id}_${li.id}`));
        }
        const lSnaps = lRefs.length ? await db.getAll(...lRefs) : [];
        const lSnapById = new Map(lSnaps.map((s) => [s.id, s]));
        const oSnapById = new Map(oSnaps.map((s) => [s.id, s]));

        const writer = db.bulkWriter();
        for (const o of have) {
          const d = diff(oSnapById.get(String(o.id)).data(), status.orderStatusFields(o));
          if (Object.keys(d).length) {
            writer.update(db.collection("shopify_orders").doc(String(o.id)), Object.assign(d, { status_synced_at: TS }));
            c.orders_changed++;
          }
          const byLine = status.refundsByLine(o);
          for (const li of o.line_items || []) {
            const id = `${o.id}_${li.id}`;
            const snap = lSnapById.get(id);
            if (!snap || !snap.exists) { c.line_items_missing++; continue; }
            const ld = diff(snap.data(), status.lineStatusFields(o, li, byLine));
            if (Object.keys(ld).length) {
              writer.update(db.collection("shopify_line_items").doc(id), Object.assign(ld, { status_synced_at: TS }));
              c.line_items_changed++;
            }
          }
        }
        await writer.close();
      }

      c.pages++;
      url = next;
      if (url) await save({ status: "partial", resume_url: url, last_status: "partial" });
    }

    if (url) {
      await save(Object.assign({ status: "partial", resume_url: url, last_status: "partial", stopped_because: stoppedBecause, last_error: null }, c));
    } else {
      await save(Object.assign({
        status: "complete", last_status: "success", last_error: null, stopped_because: null,
        last_complete_at: runStarted, last_success_at: TS,
      }, c));
    }
    return Object.assign({ status: url ? "partial" : "complete", stopped_because: stoppedBecause, window_start: windowStart }, c);
  } catch (err) {
    try { await metaRef.set({ last_run_at: TS, last_status: "error", last_error: err.message }, { merge: true }); } catch (_) {}
    throw err;
  }
}

async function getShopifyToken() {
  const res = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token exchange failed");
  return data.access_token;
}

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return admin.firestore();
}

const REQUIRED_ENV = ["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_STORE_DOMAIN", "FIREBASE_SERVICE_ACCOUNT"];

module.exports = { getShopifyToken, getDb, REQUIRED_ENV, refreshOrders, parseNextUrl, PAGE_SIZE };

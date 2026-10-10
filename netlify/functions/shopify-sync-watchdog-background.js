/* shopify-sync-watchdog-background — automatic recovery for the Shopify syncs.
 *
 * Why: the daily catalog sync (shopify_sync_meta/catalog_sync) and the stock
 * snapshot (shopify_sync_meta/inventory_sync) both failed with
 * "8 RESOURCE_EXHAUSTED: Quota exceeded." and nothing retried them until the
 * next scheduled day (~41 h and ~2 days stale). No button: this retries by
 * itself, with back-off, and tells the owners if it cannot recover.
 *
 * A BACKGROUND function (15-min budget, the sync handlers are too slow for a plain scheduled one), scheduled hourly (netlify.toml, "15 * * * *" UTC). A healthy run costs one
 * meta read per source plus the watchdog doc (3 reads) and writes nothing.
 * It writes ONLY shopify_sync_meta/watchdog, hrm_notifications rows, and
 * whatever the two sync handlers write. The handlers are called in-process
 * (never by HTTP), the way pattern-sync-now-background.js calls the catalog one.
 *
 * firebase-admin and the handlers are required lazily, so a test can inject
 * a fake db and fake handlers into run() without installing anything.
 */
"use strict";

// ── Defaults (all tunable here) ─────────────────────────────────
const HOUR = 3600000;
const MIN = 60000;
const SOURCES = {
  catalog_sync: { label: "Shopify catalog sync", intervalMs: 24 * HOUR, module: "./shopify-catalog-sync.js" },
  inventory_sync: { label: "Shopify stock snapshot", intervalMs: 12 * HOUR, module: "./shopify-inventory-snapshot.js" },
};
const STALE_FACTOR = 1.5;                    // retry when last success is older than 1.5 x interval
const MIN_GAP_AFTER_RUN_MS = 10 * MIN;       // never while a run started in the last 10 min
const BACKOFF_MS = [15 * MIN, 30 * MIN, 1 * HOUR, 2 * HOUR, 4 * HOUR, 6 * HOUR]; // cap = last
const QUOTA_START_MS = 1 * HOUR;             // quota errors start here (do not hammer a spent quota)
const BACKOFF_CAP_MS = 6 * HOUR;
const MAX_ATTEMPTS_PER_DAY = 8;              // per source, per UTC day
const ALERT_AFTER_MS = 48 * HOUR;            // no success for 48 h ...
const ALERT_AFTER_FAILED_RETRIES = 3;        // ... or 3 consecutive failed watchdog retries
const RUN_BUDGET_MS = 10 * 60 * 1000;       // total handler time per run (background function: 15-min limit, headroom kept)
const ALERT_USERS = ["afnan", "ammar"];
const WATCHDOG_PATH = ["shopify_sync_meta", "watchdog"];

// ── Pure helpers ────────────────────────────────────────────────
function toMs(v) {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v.seconds === "number") return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  if (typeof v._seconds === "number") return v._seconds * 1000 + Math.floor((v._nanoseconds || 0) / 1e6);
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") { const t = Date.parse(v); return isNaN(t) ? null : t; }
  return null;
}
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function isQuotaError(meta) {
  const s = String((meta && (meta.last_error || "")) + " " + (meta && (meta.last_error_reason || ""))).toLowerCase();
  return /resource[_ -]?exhausted|quota/.test(s);
}

// Delay before the next attempt after `attempts` failures so far (0 = first retry).
function backoffMs(attempts, quotaError) {
  const n = Math.max(0, attempts | 0);
  let ms = BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)];
  if (quotaError) ms = Math.max(ms, QUOTA_START_MS);
  return Math.min(ms, BACKOFF_CAP_MS);
}

/* decideRetry({source, meta, watch, now}) -> {action, reason, nextAt}
   action: 'none' (healthy) | 'retry' (due now) | 'wait' (due, but backing off /
   running / day cap) | 'alert' (due and the owners must be told; also retry-able
   by the caller via .retry === true). nextAt is ms or null. */
function decideRetry(input) {
  const source = input && input.source;
  const meta = (input && input.meta) || {};
  const watch = (input && input.watch) || {};
  const now = input && input.now;
  const cfg = SOURCES[source];
  const interval = cfg ? cfg.intervalMs : 24 * HOUR;

  const failed = meta.last_status === "error";
  const lastOk = toMs(meta.last_success_at);
  const lastRun = toMs(meta.last_run_at);
  const stale = lastOk == null ? true : now - lastOk > STALE_FACTOR * interval;
  const quota = isQuotaError(meta);

  const sinceOk = lastOk == null ? null : now - lastOk;
  const failedRetries = watch.consecutiveFailures | 0;
  const alertDue = failed || stale
    ? (sinceOk == null || sinceOk >= ALERT_AFTER_MS || failedRetries >= ALERT_AFTER_FAILED_RETRIES)
    : false;
  const wrap = (action, reason, nextAt, retry) => ({ action, reason, nextAt: nextAt == null ? null : nextAt, retry: !!retry, alert: alertDue });

  if (!failed && !stale) return { action: "none", reason: "healthy", nextAt: null, retry: false, alert: false };

  // Success since the watchdog last recorded state resets attempts (handled by caller);
  // here "attempts" already reflects that if lastOk is newer than the recorded reset.
  const attempts = watch.attempts | 0;
  const lastAttempt = toMs(watch.lastAttemptAt);

  // 1. a run started in the last 10 min (the sync's own, or ours)
  const latestStart = Math.max(lastRun == null ? -Infinity : lastRun, lastAttempt == null ? -Infinity : lastAttempt);
  if (latestStart > -Infinity && now - latestStart < MIN_GAP_AFTER_RUN_MS) {
    return wrap(alertDue ? "alert" : "wait", "a run started less than 10 minutes ago", latestStart + MIN_GAP_AFTER_RUN_MS, false);
  }
  // 2. daily cap
  const dayCount = watch.dayKey === utcDay(now) ? (watch.dayAttempts | 0) : 0;
  if (dayCount >= MAX_ATTEMPTS_PER_DAY) {
    const next = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
    return wrap(alertDue ? "alert" : "wait", "daily attempt cap (" + MAX_ATTEMPTS_PER_DAY + ") reached", next, false);
  }
  // 3. back-off
  const nextAttempt = toMs(watch.nextAttemptAt);
  if (nextAttempt != null && now < nextAttempt) {
    return wrap(alertDue ? "alert" : "wait", "backing off after " + attempts + " attempt(s)", nextAttempt, false);
  }
  // 4. due. First retry of a fresh failure: wait the first back-off after the sync's own run.
  if (attempts === 0 && lastRun != null && failed) {
    const first = lastRun + backoffMs(0, quota);
    if (now < first) return wrap(alertDue ? "alert" : "wait", "first retry after the failed run", first, false);
  }
  return wrap(alertDue ? "alert" : "retry", failed ? "last run failed" : "last success is older than " + STALE_FACTOR + "x the interval", now, true);
}

// ── Firestore plumbing (db is an Admin Firestore handle) ────────
function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("watchdog budget exceeded")), Math.max(1, ms)); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function readMeta(db, id) {
  const s = await db.collection("shopify_sync_meta").doc(id).get();
  return s.exists ? s.data() || {} : {};
}

function alertText(source, meta, now) {
  const cfg = SOURCES[source];
  const lastOk = toMs(meta.last_success_at);
  const hours = lastOk == null ? null : Math.floor((now - lastOk) / HOUR);
  const err = String(meta.last_error || "no error recorded").slice(0, 160);
  return {
    title: cfg.label + " is out of date",
    message: cfg.label + " has had no successful run" +
      (hours == null ? " on record" : " for about " + hours + " hours") +
      ". Last error: " + err + ". The system keeps retrying automatically; no action needed unless this repeats.",
  };
}

async function raiseAlert(db, source, meta, now) {
  const day = utcDay(now);
  const { title, message } = alertText(source, meta, now);
  let made = 0;
  for (const u of ALERT_USERS) {
    const id = "syncwd_" + source + "_" + day + "_" + u;
    const ref = db.collection("hrm_notifications").doc(id);
    const s = await ref.get();
    if (s.exists) continue; // once per source per day, even if dismissed
    await ref.set({
      id, type: "shopify_sync_watchdog", title, message,
      forUser: u, forRole: "", relatedTo: source, createdAt: now, readBy: [],
      priority: "high", actionRequired: false, actionUrl: "shopify-intel",
    });
    made++;
  }
  return made;
}

/* run(db, handlers, now): handlers = { catalog_sync: fn, inventory_sync: fn }.
   Returns a summary per source. One source failing never skips the other. */
async function run(db, handlers, now, opts) {
  const budget = (opts && opts.budgetMs) || RUN_BUDGET_MS;
  const started = Date.now();
  const wdRef = db.collection(WATCHDOG_PATH[0]).doc(WATCHDOG_PATH[1]);
  let wd = {};
  try { const s = await wdRef.get(); wd = s.exists ? s.data() || {} : {}; } catch (e) { wd = {}; }
  const out = {};

  for (const source of Object.keys(SOURCES)) {
    const res = { action: "none" };
    out[source] = res;
    try {
      const meta = await readMeta(db, source);
      let watch = Object.assign({}, wd[source] || {});
      // A success newer than our last attempt resets the counters.
      const lastOk = toMs(meta.last_success_at);
      const lastAttempt = toMs(watch.lastAttemptAt);
      if (meta.last_status !== "error" && lastOk != null && (lastAttempt == null || lastOk > lastAttempt) && ((watch.attempts | 0) > 0 || (watch.consecutiveFailures | 0) > 0)) {
        watch = { attempts: 0, consecutiveFailures: 0, dayKey: watch.dayKey, dayAttempts: watch.dayAttempts | 0, lastResult: "recovered", nextAttemptAt: null, lastAttemptAt: watch.lastAttemptAt || null };
        wd[source] = watch;
        await wdRef.set({ [source]: watch }, { merge: true });
      }
      const d = decideRetry({ source, meta, watch, now });
      res.action = d.action; res.reason = d.reason; res.nextAt = d.nextAt;

      if (d.alert) {
        try { res.alertsRaised = await raiseAlert(db, source, meta, now); } catch (e) { res.alertError = String(e && e.message || e); }
      }
      if (!d.retry) continue;

      const left = budget - (Date.now() - started);
      if (left < 3000) { res.action = "wait"; res.reason = "no time budget left in this run"; continue; }

      const quota = isQuotaError(meta);
      let thrown = null;
      try { await withTimeout(Promise.resolve(handlers[source]({ triggeredBy: "shopify-sync-watchdog" })), left); }
      catch (e) { thrown = e; }
      const after = await readMeta(db, source);
      const ok = after.last_status === "success" && (toMs(after.last_success_at) || 0) >= (lastOk || 0) && !thrown;
      const attempts = ok ? 0 : (watch.attempts | 0) + 1;
      const day = utcDay(now);
      const dayAttempts = (watch.dayKey === day ? (watch.dayAttempts | 0) : 0) + 1;
      const next = {
        attempts, consecutiveFailures: ok ? 0 : (watch.consecutiveFailures | 0) + 1,
        lastAttemptAt: now, dayKey: day, dayAttempts,
        nextAttemptAt: ok ? null : now + backoffMs(attempts - 1, quota || isQuotaError(after)),
        lastResult: ok ? "success" : (thrown ? "threw: " + String(thrown.message || thrown).slice(0, 120) : "failed: " + String(after.last_error || "unknown").slice(0, 120)),
      };
      wd[source] = next;
      await wdRef.set({ [source]: next }, { merge: true });
      res.action = "retry"; res.ok = ok; res.lastResult = next.lastResult;
      if (!ok && ((next.consecutiveFailures >= ALERT_AFTER_FAILED_RETRIES) || d.alert)) {
        try { res.alertsRaised = (res.alertsRaised || 0) + await raiseAlert(db, source, after, now); } catch (e) { res.alertError = String(e && e.message || e); }
      }
    } catch (e) {
      res.error = String(e && e.message || e);
    }
  }
  return out;
}

// ── Netlify entry point ─────────────────────────────────────────
exports.handler = async function () {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing env var FIREBASE_SERVICE_ACCOUNT" }) };
    }
    const admin = require("firebase-admin");
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const handlers = {};
    for (const k of Object.keys(SOURCES)) {
      handlers[k] = (ev) => require(SOURCES[k].module).handler(ev);
    }
    const out = await run(admin.firestore(), handlers, Date.now());
    return { statusCode: 200, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

exports.decideRetry = decideRetry;
exports.backoffMs = backoffMs;
exports.run = run;
exports.isQuotaError = isQuotaError;
exports.SOURCES = SOURCES;
exports.constants = { STALE_FACTOR, MIN_GAP_AFTER_RUN_MS, BACKOFF_MS, QUOTA_START_MS, BACKOFF_CAP_MS, MAX_ATTEMPTS_PER_DAY, ALERT_AFTER_MS, ALERT_AFTER_FAILED_RETRIES, RUN_BUDGET_MS, ALERT_USERS };

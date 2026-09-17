// ── Marketing: the Instagram access token ───────────────────────────────
// Owns the one credential the Instagram auto-fetch uses, and checks it every
// night so it can never go dark silently.
//
// Where the token lives:
//   • IG_ACCESS_TOKEN (Netlify env) is only the SEED — a token generated in
//     Graph API Explorer. It is never used directly once seeded.
//   • The working token is kept in Firestore at integration_secrets/instagram.
//     firestore.rules has no match block for that collection, so every client
//     read and write is denied (rules are default-deny); only this Admin-SDK
//     code can touch it. It is never returned to a browser.
//
// Why a PAGE token (verified against Meta's "Long-Lived Access Tokens" doc,
// Sept 2026): a long-lived USER token lasts 60 days and the doc describes no
// way to renew an active one. A Page token obtained with a long-lived user
// token "do[es] not have an expiration date". So seeding goes
//   seed → fb_exchange_token (long-lived user token)
//        → /me/accounts → the Page linked to GRVY's Instagram account
//        → store that Page token.
// If no linked Page is found (the seed was already a Page token, say), the
// best token available is stored and its expiry recorded, and the nightly
// check warns in the bell from 14 days out.
//
// Changing IG_ACCESS_TOKEN re-seeds automatically: the stored doc remembers a
// fingerprint of the seed it came from. (A Netlify env change only reaches
// functions after a redeploy.)
const admin = require("firebase-admin");
const crypto = require("crypto");

const GRAPH_VERSION = "v26.0"; // newest version graph.facebook.com recognised, probed Sept 2026
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DEFAULT_APP_ID = "2573791029752857"; // "API GRVY Ops" — an app id is public, the secret is not
const DEFAULT_IG_ACCOUNT_ID = "17841409780333939"; // GRVY's Instagram Business account
const SECRET_PATH = ["integration_secrets", "instagram"];
const STATUS_PATH = ["shopify_sync_meta", "instagram"]; // readable status, never the token
const WARN_DAYS = 14;
const DAY_MS = 86400000;
const ALERT_USERS = ["afnan", "ammar"];

let _db;
function getDb() {
  if (!_db) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
    _db = admin.firestore();
  }
  return _db;
}

function igConfig() {
  return {
    seed: process.env.IG_ACCESS_TOKEN || "",
    appId: process.env.META_APP_ID || DEFAULT_APP_ID,
    appSecret: process.env.META_APP_SECRET || "",
    igId: process.env.IG_BUSINESS_ACCOUNT_ID || DEFAULT_IG_ACCOUNT_ID,
  };
}
const isConfigured = (c) => !!(c.seed && c.appSecret && process.env.FIREBASE_SERVICE_ACCOUNT);

const fingerprint = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
// Sent with every call, so the app works whether or not "Require App Secret" is on.
const appsecretProof = (token, secret) => crypto.createHmac("sha256", secret).update(token).digest("hex");

/** A Graph error, keeping Meta's code/subcode for the caller to classify. */
async function graphGet(pathAndQuery, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GRAPH}/${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const g = data.error || {};
    const err = new Error(g.error_user_msg || g.message || `Graph API ${res.status}`);
    err.graph = { code: g.code, subcode: g.error_subcode, type: g.type, status: res.status };
    throw err;
  }
  return data;
}

/** The kind of failure, from Meta's own codes. */
function classifyGraphError(err) {
  const g = (err && err.graph) || {};
  // Business Discovery's ONLY shape for "can't read that account": it does not
  // tell a Personal account from a typo or a deleted one.
  if (g.subcode === 2207013 || g.code === 110) return "not_found";
  if (g.code === 190 || g.code === 102 || g.code === 463 || g.code === 467) return "token";
  if ([4, 17, 32, 613, 80002].includes(g.code) || g.status === 429) return "rate";
  if (g.code === 10 || g.code === 200 || (g.code >= 200 && g.code < 300)) return "permission";
  return "other";
}

async function debugToken(cfg, token) {
  const d = await graphGet("debug_token", { input_token: token, access_token: `${cfg.appId}|${cfg.appSecret}` });
  const x = d.data || {};
  return {
    valid: !!x.is_valid,
    type: x.type || null,
    // Meta reports 0 for "never expires".
    expires_at: x.expires_at ? x.expires_at * 1000 : null,
    scopes: x.scopes || [],
  };
}

/** seed → long-lived user token → the linked Page's token. */
async function seedToken(cfg) {
  let userToken = cfg.seed;
  let exchanged = false;
  try {
    const ex = await graphGet("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      fb_exchange_token: cfg.seed,
    });
    if (ex.access_token) { userToken = ex.access_token; exchanged = true; }
  } catch (e) {
    // A Page token, or an already long-lived one, may not exchange. Carry on
    // with the seed itself; the health check below says whether it works.
    console.warn("[instagram] exchange failed, using the seed as-is:", e.message);
  }
  let token = userToken, kind = "user";
  try {
    const acc = await graphGet("me/accounts", {
      fields: "id,name,access_token,instagram_business_account",
      limit: "100",
      access_token: userToken,
      appsecret_proof: appsecretProof(userToken, cfg.appSecret),
    });
    const page = (acc.data || []).find((p) => p.instagram_business_account && String(p.instagram_business_account.id) === String(cfg.igId));
    if (page && page.access_token) { token = page.access_token; kind = "page"; }
  } catch (e) {
    console.warn("[instagram] could not list pages:", e.message);
  }
  const info = await debugToken(cfg, token);
  return { token, kind, exchanged, ...info };
}

/**
 * The working token, seeding (or re-seeding after IG_ACCESS_TOKEN changed)
 * when needed. Never hand the result to a client.
 */
async function getToken(db, cfg) {
  const ref = db.collection(SECRET_PATH[0]).doc(SECRET_PATH[1]);
  const snap = await ref.get();
  const fp = fingerprint(cfg.seed);
  const cur = snap.exists ? snap.data() : null;
  if (cur && cur.token && cur.seed_fp === fp) return cur;
  const s = await seedToken(cfg);
  const rec = {
    token: s.token, kind: s.kind, seed_fp: fp, seeded_at: Date.now(),
    expires_at: s.expires_at, valid: s.valid, scopes: s.scopes,
  };
  await ref.set(rec);
  await writeStatus(db, { kind: s.kind, expires_at: s.expires_at, valid: s.valid, seeded_at: rec.seeded_at, last_error: s.valid ? null : "Meta says the token is not valid." });
  return rec;
}

async function writeStatus(db, patch) {
  await db.collection(STATUS_PATH[0]).doc(STATUS_PATH[1]).set(Object.assign({ updated_at: Date.now() }, patch), { merge: true });
}

/** Mark the stored token bad so the next call re-seeds instead of retrying it. */
async function markTokenBad(db, message) {
  await db.collection(SECRET_PATH[0]).doc(SECRET_PATH[1]).set({ valid: false, seed_fp: null }, { merge: true });
  await writeStatus(db, { valid: false, last_error: message });
}

/** Days left, or null for a token that does not expire. Pure. */
function daysLeft(expiresAt, now) {
  if (!expiresAt) return null;
  return Math.floor((expiresAt - now) / DAY_MS);
}

/** What the nightly check should say, if anything. Pure. */
function planAlert(state, now) {
  if (!state.configured) return null;
  if (!state.valid) {
    return { key: "invalid", priority: "high", title: "Instagram fetch has stopped working",
      message: "Meta no longer accepts the Instagram token. Generate a new one in Graph API Explorer and replace IG_ACCESS_TOKEN in Netlify, then redeploy." + (state.error ? " (" + state.error + ")" : "") };
  }
  const d = daysLeft(state.expires_at, now);
  if (d != null && d <= WARN_DAYS) {
    return { key: "exp_" + new Date(state.expires_at).toISOString().slice(0, 10), priority: d <= 3 ? "high" : "normal",
      title: `Instagram token expires in ${Math.max(d, 0)} day${d === 1 ? "" : "s"}`,
      message: "Instagram auto-fetch will stop when it does. Generate a new token in Graph API Explorer (with the Page linked to GRVY's Instagram selected) and replace IG_ACCESS_TOKEN in Netlify, then redeploy." };
  }
  return null;
}

/** The nightly check. Returns a summary; never the token. */
async function runCheck(db, cfg, now) {
  const t = now || Date.now();
  if (!isConfigured(cfg)) {
    await writeStatus(db, { configured: false, checked_at: t });
    return { configured: false };
  }
  let state;
  try {
    const rec = await getToken(db, cfg);
    const info = await debugToken(cfg, rec.token);
    state = { configured: true, valid: info.valid, kind: rec.kind, expires_at: info.expires_at, error: null };
    if (!info.valid) await markTokenBad(db, "Meta says the token is not valid.");
  } catch (e) {
    state = { configured: true, valid: false, kind: null, expires_at: null, error: e.message };
  }
  await writeStatus(db, { configured: true, checked_at: t, valid: state.valid, kind: state.kind, expires_at: state.expires_at, last_error: state.error });
  const alert = planAlert(state, t);
  if (alert) {
    for (const u of ALERT_USERS) {
      const id = `ig_token_${alert.key}_${u}`;
      const ref = db.collection("hrm_notifications").doc(id);
      const s = await ref.get();
      if (s.exists) continue; // raised before, maybe dismissed — never twice
      await ref.set({
        id, type: "marketing_ig_token", title: alert.title, message: alert.message,
        forUser: u, forRole: "", relatedTo: "instagram", createdAt: t, readBy: [],
        priority: alert.priority, actionRequired: true, actionUrl: "mkt-reports",
      });
    }
  }
  return Object.assign({}, state, { alerted: !!alert });
}

exports.handler = async function () {
  try {
    const cfg = igConfig();
    const out = await runCheck(isConfigured(cfg) ? getDb() : getDbIfPossible(), cfg);
    return { statusCode: 200, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
function getDbIfPossible() {
  return process.env.FIREBASE_SERVICE_ACCOUNT ? getDb() : { collection: () => ({ doc: () => ({ set: async () => {} }) }) };
}

Object.assign(exports, {
  GRAPH, GRAPH_VERSION, DEFAULT_IG_ACCOUNT_ID, WARN_DAYS,
  igConfig, isConfigured, getDb, graphGet, classifyGraphError, appsecretProof,
  getToken, markTokenBad, writeStatus, debugToken, daysLeft, planAlert, runCheck, fingerprint,
});

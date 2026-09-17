// ── Marketing: "Fetch from Instagram" ───────────────────────────────────
// Reads a creator's public numbers through Instagram Business Discovery,
// using GRVY's OWN Business account (so Standard Access is enough — an app
// that only serves a business its owner manages needs no App Review).
//
// POST { idToken, action: 'lookup', username }  → follower_count and the
//        average likes / comments / views over the posts Instagram returns.
// POST { idToken, action: 'status' }            → is the connection healthy.
//
// The caller's Firebase ID token is verified here and checked against
// MARKETING_EMAILS (the same list the discount-code function uses, which a
// test holds equal to isMarketing() in firestore.rules). The Meta token and
// app secret never leave the server — see instagram-token-refresh.js.
//
// Business Discovery only reads BUSINESS and CREATOR accounts, and its one
// failure shape ("Cannot find User", code 110 / subcode 2207013) does not
// say whether the account is Personal, misspelled or gone. The message says
// exactly that much and no more.
const admin = require("firebase-admin");
const ig = require("./instagram-token-refresh.js");
const { MARKETING_EMAILS } = require("./marketing-discounts.js");

const NOT_FOUND_MESSAGE =
  "Couldn't find a Business or Creator account with that handle — check the spelling, or use manual/screenshot entry if this is a Personal account.";

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

/** Instagram's own rules: letters, numbers, dots, underscores, up to 30. Pure. */
function normUsername(raw) {
  let h = String(raw || "").trim();
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : "";
}

/** The Graph field expansion. The username is validated before it gets here. */
function discoveryFields(username) {
  return `business_discovery.username(${username}){username,name,followers_count,media_count,media{like_count,comments_count,view_count}}`;
}

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const isNum = (v) => typeof v === "number" && isFinite(v) && v >= 0;

/**
 * Averages over the posts Instagram returned. A post whose like count is
 * hidden simply has no like_count, and a photo has no view_count — each
 * average is taken over the posts that carry that number, never padding the
 * rest with zeros. Pure.
 */
function summarize(bd) {
  const media = ((bd && bd.media && bd.media.data) || []);
  const likes = media.map((m) => m.like_count).filter(isNum);
  const comments = media.map((m) => m.comments_count).filter(isNum);
  const views = media.map((m) => m.view_count).filter(isNum);
  return {
    username: bd.username || null,
    name: bd.name || "",
    follower_count: isNum(bd.followers_count) ? bd.followers_count : null,
    media_count: isNum(bd.media_count) ? bd.media_count : null,
    posts_sampled: media.length,
    likes_sampled: likes.length,
    views_sampled: views.length,
    avg_likes: avg(likes),
    avg_comments: avg(comments),
    avg_views: avg(views),
  };
}

async function lookup(db, cfg, username) {
  const run = async () => {
    const rec = await ig.getToken(db, cfg);
    const d = await ig.graphGet(cfg.igId, {
      fields: discoveryFields(username),
      access_token: rec.token,
      appsecret_proof: ig.appsecretProof(rec.token, cfg.appSecret),
    });
    return d.business_discovery;
  };
  let bd;
  try {
    bd = await run();
  } catch (e) {
    const kind = ig.classifyGraphError(e);
    if (kind === "not_found") return json(200, { found: false, username, message: NOT_FOUND_MESSAGE });
    if (kind === "token") {
      // Re-seed once from IG_ACCESS_TOKEN — the stored token may simply be stale.
      await ig.markTokenBad(db, e.message).catch(() => {});
      try { bd = await run(); }
      catch (e2) {
        const k2 = ig.classifyGraphError(e2);
        if (k2 === "not_found") return json(200, { found: false, username, message: NOT_FOUND_MESSAGE });
        await ig.markTokenBad(db, e2.message).catch(() => {});
        return json(503, { error: "The Instagram connection has expired. Ask Ammar to replace IG_ACCESS_TOKEN in Netlify. Enter the numbers by hand for now.", kind: "token" });
      }
    } else if (kind === "rate") {
      return json(429, { error: "Instagram is rate-limiting lookups — wait a few minutes, or enter the numbers by hand.", kind });
    } else if (kind === "permission") {
      return json(502, { error: "Instagram refused the lookup (the app is missing a permission): " + e.message, kind });
    } else {
      return json(502, { error: "Instagram lookup failed: " + e.message, kind });
    }
  }
  if (!bd) return json(200, { found: false, username, message: NOT_FOUND_MESSAGE });
  return json(200, Object.assign({ found: true, fetched_at: Date.now() }, summarize(bd)));
}

async function status(db, cfg) {
  if (!ig.isConfigured(cfg)) return json(200, { configured: false });
  try {
    const rec = await ig.getToken(db, cfg);
    const info = await ig.debugToken(cfg, rec.token);
    if (!info.valid) await ig.markTokenBad(db, "Meta says the token is not valid.").catch(() => {});
    return json(200, {
      configured: true, valid: info.valid, kind: rec.kind, expires_at: info.expires_at,
      days_left: ig.daysLeft(info.expires_at, Date.now()),
      has_scope: ["instagram_basic", "pages_show_list"].every((s) => info.scopes.includes(s)),
      graph_version: ig.GRAPH_VERSION,
    });
  } catch (e) {
    return json(200, { configured: true, valid: false, error: e.message });
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return json(500, { error: "Missing env var: FIREBASE_SERVICE_ACCOUNT" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }
  const { idToken, action } = body;
  if (!idToken) return json(400, { error: "idToken is required" });

  const db = ig.getDb();
  let caller;
  try { caller = await admin.auth().verifyIdToken(idToken); }
  catch { return json(401, { error: "Could not verify who you are — sign in again and retry." }); }
  if (!MARKETING_EMAILS.includes(String(caller.email || "").toLowerCase())) {
    return json(403, { error: "Your account does not have Marketing access." });
  }

  const cfg = ig.igConfig();
  try {
    if (action === "status") return await status(db, cfg);
    if (action === "lookup") {
      if (!ig.isConfigured(cfg)) {
        return json(503, { configured: false, error: "Instagram fetch is not set up yet (IG_ACCESS_TOKEN / META_APP_SECRET in Netlify). Enter the numbers by hand." });
      }
      const username = normUsername(body.username);
      if (!username) return json(400, { error: "Enter a valid Instagram handle first — letters, numbers, dots and underscores." });
      return await lookup(db, cfg, username);
    }
    return json(400, { error: "Unknown action" });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

Object.assign(exports, { normUsername, discoveryFields, summarize, NOT_FOUND_MESSAGE });

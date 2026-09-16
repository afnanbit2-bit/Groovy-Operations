// ── Marketing M4: Shopify discount codes ─────────────────────────────────
// The only place a discount code is created. Runs server-side because it
// needs the Shopify app secret, and because the code record it writes
// (discount_codes, plus the dispatch's has_discount_code/discount_code_id)
// must not be something a browser can forge — firestore.rules deny client
// writes to all three.
//
// Every call carries the caller's Firebase ID token and is checked here, on
// the server, against MARKETING_EMAILS (mirrors isMarketing() in
// firestore.rules; tests/marketing.test.js holds the two lists equal). A
// role sent by the client is never trusted.
//
// Actions:
//   status  — which Admin API scopes Shopify has actually granted the app,
//             and whether that is enough to create codes.
//   create  — create the code for one dispatch (idempotent: a dispatch that
//             already has a code returns it; a concurrent second call is
//             refused by a short lock).
//   rollup  — run the redemption rollup now (marketing-code-rollup.js).
//
// Policy is FIXED, per the spec — not a per-dispatch setting: 10% off, every
// product, any buyer, once per customer, ends 20 days after creation.
const admin = require("firebase-admin");
const { runRollup } = require("./marketing-code-rollup.js");

const SHOPIFY_API_VERSION = "2026-04";
const MARKETING_EMAILS = ["afnan@groovy.op", "ammar@groovy.op", "daniyal@groovy.op"];
const REQUIRED_SCOPES = ["write_discounts", "read_discounts"];
const CODE_PERCENT = 10;
const CODE_DAYS = 20;
const LOCK_MS = 2 * 60 * 1000;
const DAY_MS = 86400000;

let _db;
function getDb() {
  if (!_db) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
    _db = admin.firestore();
  }
  return _db;
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

// ── Pure helpers (tests/marketing.test.js) ──────────────────────────────
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

/** GRVY-<HANDLE>-<RANDOM>. Shopify codes are kept to A–Z, 0–9 and hyphens. */
function buildCode(handle, rand) {
  const h = String(handle || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) || "CREATOR";
  const r = rand || (() => Math.random());
  let tail = "";
  for (let i = 0; i < 4; i++) tail += CODE_ALPHABET[Math.floor(r() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return `GRVY-${h}-${tail}`;
}

/** The DiscountCodeBasicInput for one code (validated against the Admin schema). */
function buildDiscountInput(code, handle, dispatchId, nowMs) {
  return {
    title: `GRVY creator code — @${handle} (${dispatchId})`,
    code,
    startsAt: new Date(nowMs).toISOString(),
    endsAt: new Date(nowMs + CODE_DAYS * DAY_MS).toISOString(),
    context: { all: "ALL" },
    customerGets: { value: { percentage: CODE_PERCENT / 100 }, items: { all: true } },
    appliesOncePerCustomer: true,
  };
}

function missingScopes(granted) {
  const have = new Set((granted || []).map(String));
  return REQUIRED_SCOPES.filter((s) => !have.has(s));
}

// ── Shopify ─────────────────────────────────────────────────────────────
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
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error("Shopify refused the app's credentials (token exchange failed).");
  return data.access_token;
}

async function shopifyGraphql(token, query, variables) {
  const res = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  if (data.errors && data.errors.length) {
    const msg = data.errors.map((e) => e.message).join("; ");
    const err = new Error(msg);
    if (/access denied|scope/i.test(msg)) err.code = "scope";
    throw err;
  }
  return data.data;
}

async function grantedScopes(token) {
  const d = await shopifyGraphql(token, "query GrvyScopes { currentAppInstallation { accessScopes { handle } } }");
  return ((d && d.currentAppInstallation && d.currentAppInstallation.accessScopes) || []).map((s) => s.handle);
}

const CREATE_MUTATION = `mutation GrvyCreateCode($input: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $input) {
    codeDiscountNode { id }
    userErrors { field message code }
  }
}`;

// ── Actions ─────────────────────────────────────────────────────────────
async function actionStatus() {
  const token = await getShopifyToken();
  const scopes = await grantedScopes(token);
  const missing = missingScopes(scopes);
  return json(200, { scopes, missing, canCreate: missing.length === 0 });
}

async function actionCreate(db, dispatchId, callerUid) {
  if (!dispatchId || typeof dispatchId !== "string") return json(400, { error: "dispatchId is required" });
  const dRef = db.collection("dispatches").doc(dispatchId);
  const now = Date.now();

  // Reserve the dispatch first, so a double click cannot make two codes.
  let dispatch, creator;
  try {
    const out = await db.runTransaction(async (tx) => {
      const ds = await tx.get(dRef);
      if (!ds.exists) return { error: json(404, { error: "That dispatch no longer exists." }) };
      const d = ds.data();
      if (d.has_discount_code && d.discount_code_id) return { existing: d.discount_code_id };
      if (d.code_lock_at && now - Number(d.code_lock_at) < LOCK_MS) {
        return { error: json(409, { error: "A code for this dispatch is already being created — wait a moment and refresh." }) };
      }
      const cs = await tx.get(db.collection("creators").doc(d.creator_id));
      if (!cs.exists) return { error: json(404, { error: "This dispatch's creator no longer exists." }) };
      tx.update(dRef, { code_lock_at: now });
      return { d, c: cs.data() };
    });
    if (out.error) return out.error;
    if (out.existing) {
      const cs = await db.collection("discount_codes").doc(out.existing).get();
      return json(200, { already: true, code: cs.exists ? Object.assign({ id: cs.id }, cs.data()) : null });
    }
    dispatch = out.d;
    creator = out.c;
  } catch (e) {
    return json(500, { error: "Could not reserve the dispatch: " + e.message });
  }

  const release = () => dRef.update({ code_lock_at: admin.firestore.FieldValue.delete() }).catch(() => {});
  try {
    const token = await getShopifyToken();
    const missing = missingScopes(await grantedScopes(token));
    if (missing.length) {
      await release();
      return json(403, { error: `Shopify has not granted the app ${missing.join(" and ")} yet. Release an app version with those scopes and approve it on the store.`, missing });
    }
    let created = null, code = "", lastErrors = [];
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      code = buildCode(creator.ig_handle);
      const d = await shopifyGraphql(token, CREATE_MUTATION, {
        input: buildDiscountInput(code, creator.ig_handle, dispatchId, now),
      });
      const r = d && d.discountCodeBasicCreate;
      lastErrors = (r && r.userErrors) || [];
      if (r && r.codeDiscountNode && !lastErrors.length) created = r.codeDiscountNode.id;
      // Only a clash on the code itself is worth retrying with a new suffix.
      else if (!lastErrors.some((e) => /taken|unique|already/i.test(`${e.code} ${e.message}`))) break;
    }
    if (!created) {
      await release();
      return json(502, { error: "Shopify did not create the code: " + (lastErrors.map((e) => e.message).join("; ") || "no reason given") });
    }
    const codeRef = db.collection("discount_codes").doc();
    const record = {
      dispatch_id: dispatchId,
      dispatch_type: dispatch.type || "organic",
      creator_id: dispatch.creator_id,
      shopify_discount_id: created,
      code,
      value_percent: CODE_PERCENT,
      applies_once_per_customer: true,
      created_at: now,
      created_by_user_id: callerUid || null,
      expires_at: now + CODE_DAYS * DAY_MS,
      status: "active",
      redemption_count: 0,
      revenue_attributed_pkr: 0,
      revenue_by_month: {},
    };
    const b = db.batch();
    b.set(codeRef, record);
    b.update(dRef, { has_discount_code: true, discount_code_id: codeRef.id, code_lock_at: admin.firestore.FieldValue.delete() });
    b.update(db.collection("creators").doc(dispatch.creator_id), { lifetime_codes_issued: admin.firestore.FieldValue.increment(1) });
    await b.commit();
    return json(200, { code: Object.assign({ id: codeRef.id }, record) });
  } catch (e) {
    await release();
    if (e.code === "scope") return json(403, { error: "Shopify refused: the app is missing discount permissions. " + e.message });
    return json(500, { error: e.message });
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const required = ["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_STORE_DOMAIN", "FIREBASE_SERVICE_ACCOUNT"];
  const missingEnv = required.filter((k) => !process.env[k]);
  if (missingEnv.length) return json(500, { error: `Missing env vars: ${missingEnv.join(", ")}` });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }
  const { idToken, action } = body;
  if (!idToken) return json(400, { error: "idToken is required" });

  const db = getDb();
  let caller;
  try { caller = await admin.auth().verifyIdToken(idToken); }
  catch { return json(401, { error: "Could not verify who you are — sign in again and retry." }); }
  const email = String(caller.email || "").toLowerCase();
  if (!MARKETING_EMAILS.includes(email)) return json(403, { error: "Your account does not have Marketing access." });

  try {
    if (action === "status") return await actionStatus();
    if (action === "create") return await actionCreate(db, body.dispatchId, caller.uid);
    if (action === "rollup") return json(200, await runRollup(db));
    return json(400, { error: "Unknown action" });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

exports.buildCode = buildCode;
exports.buildDiscountInput = buildDiscountInput;
exports.missingScopes = missingScopes;
exports.MARKETING_EMAILS = MARKETING_EMAILS;

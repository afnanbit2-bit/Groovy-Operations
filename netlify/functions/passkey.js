// ── Passkey sign-in: "Sign in with fingerprint" ──────────────────────────
// Afnan, 26 Sept 2026: the app lock (a fingerprint over a KEPT session) was
// not what he meant — he wanted to sign in from the login screen with his
// fingerprint, like a banking app. That needs a server, because a browser
// cannot mint a Firebase session on its own. This function is that server.
//
// WebAuthn in one paragraph: when a phone registers a passkey it hands us
// a PUBLIC key; the private key never leaves the phone's secure hardware,
// and the phone only uses it after checking a fingerprint/face/PIN. To sign
// in, we send a random CHALLENGE, the phone signs it, and we verify that
// signature with the stored public key. A valid signature over OUR
// challenge, from OUR origin, with the user-verified flag set, proves the
// person holds that phone and passed its biometric check. Only then does
// the Admin SDK mint a custom token for the uid stored WITH THE KEY — never
// a uid the client names.
//
// Actions (POST JSON {action, ...}):
//   register-options  idToken                     → a challenge to register
//   register          idToken, challengeId, cred  → stores the public key
//   login-options     (none)                      → a challenge to sign in
//   login             challengeId, assertion      → {token} for signInWithCustomToken
//   remove            idToken, id                 → deletes one of YOUR keys
//
// Firestore: passkeys/{credentialId}, passkey_challenges/{id}. Neither has a
// firestore.rules match block, on purpose: default-deny, so NO CLIENT can
// read or write either. Only this function (Admin SDK) touches them.
//
// Checked on every sign-in: the challenge exists, is unexpired and is
// single-use (deleted in the same transaction that reads it); the client
// data says webauthn.get, carries that challenge and our origin; the
// authenticator data's rpIdHash is SHA-256 of our host; the UP and UV flags
// are set; the signature verifies; the signature counter did not go
// backwards (a cloned key); the Firebase user exists and is not disabled.
const crypto = require("crypto");
const admin = require("firebase-admin");

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
// The deployed site. A preview deploy lives on its own host, and a passkey
// is bound to the host it was made on, so previews are allowed as origins
// (each with its own rpId) — they simply get their own passkeys.
const SITE_HOST = "groovyoperations.netlify.app";

function getAdmin() {
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin;
}
const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// ── helpers (exported for tests/passkey.test.js) ──
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

// Which origins may use this, and the rpId each implies. Exact match only —
// "groovyoperations.netlify.app.evil.test" and "http://" are refused.
function originInfo(origin) {
  let u;
  try { u = new URL(String(origin || "")); } catch { return null; }
  if (u.protocol !== "https:" || u.port) return null;
  const h = u.hostname.toLowerCase();
  if (h === SITE_HOST || /^[a-z0-9-]+--groovyoperations\.netlify\.app$/.test(h)) {
    return { origin: "https://" + h, rpId: h };
  }
  return null;
}

// authenticatorData: rpIdHash(32) · flags(1) · signCount(4, big-endian) · …
function parseAuthData(buf) {
  const b = Buffer.from(buf);
  if (b.length < 37) throw new Error("authenticator data too short");
  const flags = b[32];
  return {
    rpIdHash: b.subarray(0, 32),
    up: !!(flags & 0x01),
    uv: !!(flags & 0x04),
    signCount: b.readUInt32BE(33),
  };
}

function parseClientData(buf) {
  try { return JSON.parse(Buffer.from(buf).toString("utf8")); } catch { return null; }
}

// The shared checks for both ceremonies. Returns an error string or null.
function checkCeremony({ clientDataJSON, authData, type, challenge, info }) {
  const cd = parseClientData(clientDataJSON);
  if (!cd) return "unreadable client data";
  if (cd.type !== type) return "wrong ceremony type";
  if (cd.challenge !== challenge) return "challenge mismatch";
  if (cd.origin !== info.origin) return "origin mismatch";
  let ad;
  try { ad = parseAuthData(authData); } catch (e) { return e.message; }
  if (!ad.rpIdHash.equals(sha256(Buffer.from(info.rpId, "utf8")))) return "rpId mismatch";
  if (!ad.up) return "user not present";
  if (!ad.uv) return "user not verified (no fingerprint/face/PIN check)";
  return null;
}

// The signature is over authenticatorData ‖ SHA-256(clientDataJSON), with
// the key the phone registered. ES256 (-7) arrives DER-encoded, which is
// node's default for ECDSA; RS256 (-257) is PKCS#1 v1.5.
function verifySignature({ publicKeySpki, alg, authData, clientDataJSON, signature }) {
  const data = Buffer.concat([Buffer.from(authData), sha256(Buffer.from(clientDataJSON))]);
  const key = crypto.createPublicKey({ key: Buffer.from(publicKeySpki), format: "der", type: "spki" });
  if (alg === -7 || alg === -257) return crypto.verify("sha256", data, key, Buffer.from(signature));
  return false;
}

async function newChallenge(db, fields) {
  const challenge = b64u(crypto.randomBytes(32));
  const ref = db.collection("passkey_challenges").doc();
  await ref.set(Object.assign({ challenge, exp: Date.now() + CHALLENGE_TTL_MS }, fields));
  return { challengeId: ref.id, challenge };
}

// Read and DELETE the challenge in one transaction: a challenge can be
// answered once, and a replayed assertion finds nothing.
async function takeChallenge(db, id, type) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const ref = db.collection("passkey_challenges").doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const c = snap.data();
    tx.delete(ref);
    if (c.type !== type || !(c.exp > Date.now())) return null;
    return c;
  });
}

async function uidFromToken(app, idToken) {
  if (!idToken) return null;
  try { return await app.auth().verifyIdToken(idToken); } catch { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }
  const hdr = event.headers || {};
  const info = originInfo(hdr.origin || hdr.Origin);
  if (!info) return json(403, { error: "This site is not allowed to use fingerprint sign-in." });

  const app = getAdmin();
  const db = app.firestore();
  const action = body.action;

  try {
    if (action === "register-options") {
      const caller = await uidFromToken(app, body.idToken);
      if (!caller) return json(401, { error: "Sign in again first." });
      const c = await newChallenge(db, { type: "reg", uid: caller.uid, rpId: info.rpId });
      return json(200, Object.assign(c, { rpId: info.rpId, userId: b64u(Buffer.from(caller.uid, "utf8")) }));
    }

    if (action === "register") {
      const caller = await uidFromToken(app, body.idToken);
      if (!caller) return json(401, { error: "Sign in again first." });
      const c = await takeChallenge(db, body.challengeId, "reg");
      if (!c || c.uid !== caller.uid || c.rpId !== info.rpId) return json(400, { error: "That set-up expired. Try again." });
      const cred = body.credential || {};
      const id = String(cred.id || "");
      if (!/^[A-Za-z0-9_-]{16,512}$/.test(id)) return json(400, { error: "Bad credential id." });
      const alg = Number(cred.alg);
      if (alg !== -7 && alg !== -257) return json(400, { error: "This phone's key type is not supported." });
      const clientDataJSON = fromB64u(cred.clientDataJSON);
      const authData = fromB64u(cred.authenticatorData);
      const err = checkCeremony({ clientDataJSON, authData, type: "webauthn.create", challenge: c.challenge, info });
      if (err) return json(400, { error: "Set-up refused: " + err });
      const spki = fromB64u(cred.publicKey);
      try { crypto.createPublicKey({ key: spki, format: "der", type: "spki" }); }
      catch { return json(400, { error: "Unreadable public key." }); }
      const ref = db.collection("passkeys").doc(id);
      const existing = await ref.get();
      if (existing.exists && existing.data().uid !== caller.uid) return json(409, { error: "That key belongs to someone else." });
      await ref.set({
        uid: caller.uid,
        email: String(caller.email || "").toLowerCase(),
        publicKey: b64u(spki),
        alg,
        rpId: info.rpId,
        signCount: parseAuthData(authData).signCount,
        label: String(body.label || "").slice(0, 80),
        createdAt: Date.now(),
        lastUsedAt: null,
      });
      return json(200, { ok: true });
    }

    if (action === "login-options") {
      const c = await newChallenge(db, { type: "auth", rpId: info.rpId });
      return json(200, Object.assign(c, { rpId: info.rpId }));
    }

    if (action === "login") {
      const a = body.assertion || {};
      const id = String(a.id || "");
      if (!/^[A-Za-z0-9_-]{16,512}$/.test(id)) return json(400, { error: "Bad credential id." });
      const c = await takeChallenge(db, body.challengeId, "auth");
      if (!c || c.rpId !== info.rpId) return json(400, { error: "That sign-in expired. Try again." });
      const snap = await db.collection("passkeys").doc(id).get();
      if (!snap.exists) return json(404, { error: "This fingerprint sign-in is not set up any more. Sign in with your password and turn it on again." });
      const k = snap.data();
      if (k.rpId !== info.rpId) return json(400, { error: "This key was made on another site." });
      const clientDataJSON = fromB64u(a.clientDataJSON);
      const authData = fromB64u(a.authenticatorData);
      const err = checkCeremony({ clientDataJSON, authData, type: "webauthn.get", challenge: c.challenge, info });
      if (err) return json(401, { error: "Sign-in refused: " + err });
      let ok = false;
      try {
        ok = verifySignature({ publicKeySpki: fromB64u(k.publicKey), alg: k.alg, authData, clientDataJSON, signature: fromB64u(a.signature) });
      } catch { ok = false; }
      if (!ok) return json(401, { error: "Sign-in refused: the signature did not verify." });
      const count = parseAuthData(authData).signCount;
      // Most phones report 0 always; a counter that is in use must rise.
      if ((count || k.signCount) && count <= k.signCount) return json(401, { error: "Sign-in refused: this key looks copied." });
      let user;
      try { user = await app.auth().getUser(k.uid); } catch { return json(404, { error: "That account no longer exists." }); }
      if (user.disabled) return json(403, { error: "That account is disabled." });
      await snap.ref.update({ signCount: count, lastUsedAt: Date.now() });
      const token = await app.auth().createCustomToken(k.uid);
      return json(200, { token, email: String(user.email || "").toLowerCase() });
    }

    if (action === "remove") {
      const caller = await uidFromToken(app, body.idToken);
      if (!caller) return json(401, { error: "Sign in again first." });
      const ref = db.collection("passkeys").doc(String(body.id || "x"));
      const snap = await ref.get();
      if (snap.exists && snap.data().uid !== caller.uid) return json(403, { error: "That key is not yours." });
      if (snap.exists) await ref.delete();
      return json(200, { ok: true });
    }

    return json(400, { error: "Unknown action." });
  } catch (e) {
    return json(500, { error: "Fingerprint sign-in failed: " + (e && e.message || "unknown error") });
  }
};

exports._test = { originInfo, parseAuthData, checkCeremony, verifySignature, b64u, fromB64u, sha256, SITE_HOST };

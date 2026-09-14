// ── Seed a user_profiles row for every account ───────────────────────────
// Profiles are keyed by Firebase uid, and NOTHING client-side maps a
// username to one — there is no directory, and building one from the
// client would mean giving the client a way to enumerate uids. So a row is
// normally created by each person the first time they sign in
// (profileBootstrap in js/profile.js), which means an admin cannot edit
// anyone's profile until they have logged in once.
//
// This is the way out of that chicken-and-egg: the Admin SDK can resolve an
// email to a uid, so an owner can create every row at once. It writes ONLY
// {uid, username} and always with {merge:true}, so a real profile that
// already exists is never overwritten — this seeds, it does not reset.
//
// Same gate as admin-reset-password.js, and for the same reason: the check
// runs server-side on the caller's own verified ID token, where the client
// cannot reach it. Keep the two lists in step with isOwner()/isMustafa() in
// firestore.rules and _PROFILE_ADMINS in js/profile.js.
const admin = require("firebase-admin");

const OWNER_EMAILS = ["afnan@groovy.op", "ammar@groovy.op"];
const SEED_ADMIN_EMAILS = ["mustafa@groovy.op"];

function getAdmin() {
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin;
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { idToken, accounts } = body;
  if (!idToken) return json(400, { error: "idToken is required" });
  if (!Array.isArray(accounts) || !accounts.length) {
    return json(400, { error: "accounts must be a non-empty array" });
  }
  if (accounts.length > 200) return json(400, { error: "too many accounts" });

  const app = getAdmin();
  let caller;
  try {
    caller = await app.auth().verifyIdToken(idToken);
  } catch {
    return json(401, { error: "Could not verify caller identity — sign in again and retry." });
  }
  const callerEmail = String(caller.email || "").toLowerCase();
  if (!OWNER_EMAILS.includes(callerEmail) && !SEED_ADMIN_EMAILS.includes(callerEmail)) {
    return json(403, { error: "You are not allowed to sync accounts." });
  }

  const db = app.firestore();
  const created = [];
  const existing = [];
  const missing = [];
  const failed = [];

  for (const a of accounts) {
    const username = String((a && a.username) || "").trim().toLowerCase();
    const email = String((a && a.email) || "").trim().toLowerCase();
    // Only this company's accounts, and only a plausible username — these
    // values come from the client, so they are checked rather than trusted.
    if (!username || !/^[a-z0-9_-]{1,40}$/.test(username) || !email.endsWith("@groovy.op")) {
      failed.push({ username: username || "(blank)", error: "invalid account" });
      continue;
    }
    let user;
    try {
      user = await app.auth().getUserByEmail(email);
    } catch (e) {
      // No Firebase Auth account for this USER_DEFS entry. Worth reporting
      // rather than swallowing: it means somebody is in the app's account
      // list but cannot actually sign in.
      if (e.code === "auth/user-not-found") missing.push(username);
      else failed.push({ username, error: e.message || "lookup failed" });
      continue;
    }
    try {
      const ref = db.collection("user_profiles").doc(user.uid);
      const snap = await ref.get();
      if (snap.exists) {
        // Already has a row. Repair the username if it is absent or wrong —
        // firestore.rules pins an admin edit to it — but touch nothing else.
        const cur = snap.data() || {};
        if (cur.username !== username || cur.uid !== user.uid) {
          await ref.set({ uid: user.uid, username }, { merge: true });
        }
        existing.push(username);
      } else {
        await ref.set({ uid: user.uid, username, updatedAt: Date.now() }, { merge: true });
        created.push(username);
      }
    } catch (e) {
      failed.push({ username, error: e.message || "write failed" });
    }
  }

  return json(200, { success: true, created, existing, missing, failed });
};

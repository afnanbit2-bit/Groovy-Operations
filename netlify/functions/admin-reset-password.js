// ── Owner password reset ─────────────────────────────────────────────────
// The Firebase Console can only email a reset link, and every @groovy.op
// address is fake — so an owner has no way to help a locked-out teammate.
// This gives Afnan/Ammar a direct path: verify the CALLER is really an
// owner (their own Firebase ID token, checked server-side — never trust a
// client-asserted role), then use the Admin SDK to set the TARGET user's
// password directly. Admin SDK writes bypass Firestore/Auth rules by
// design, which is exactly why this only runs server-side, gated here.
const admin = require("firebase-admin");

const OWNER_EMAILS = ["afnan@groovy.op", "ammar@groovy.op"]; // mirrors firestore.rules isOwner()

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

  const { idToken, targetEmail, newPassword } = body;
  if (!idToken || !targetEmail || !newPassword) {
    return json(400, { error: "idToken, targetEmail and newPassword are all required" });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return json(400, { error: "newPassword must be at least 8 characters" });
  }
  if (typeof targetEmail !== "string" || !targetEmail.endsWith("@groovy.op")) {
    return json(400, { error: "targetEmail must be a groovy.op account" });
  }

  const app = getAdmin();
  let caller;
  try {
    caller = await app.auth().verifyIdToken(idToken);
  } catch {
    return json(401, { error: "Could not verify caller identity — sign in again and retry." });
  }
  if (!OWNER_EMAILS.includes(caller.email)) {
    return json(403, { error: "Only owners can reset another user's password." });
  }

  try {
    const targetUser = await app.auth().getUserByEmail(targetEmail);
    await app.auth().updateUser(targetUser.uid, { password: newPassword });
    return json(200, { success: true });
  } catch (e) {
    if (e.code === "auth/user-not-found") return json(404, { error: "No account with that email." });
    return json(500, { error: "Reset failed: " + (e.message || "unknown error") });
  }
};

// ── The Board: "Run seed", for Board owners ──────────────────────────────
// POST {idToken, dryRun?} → {ok, report}
//
// The seed writes items owned by OTHER people (a milestone's owner is its
// first assignee), which firestore.rules forbids a client — rightly: an
// item's ownerUid must be the caller's own uid. So the seed runs here, with
// the Admin SDK and the same service account every other function uses,
// behind a gate that runs server-side on the caller's VERIFIED ID token —
// the client cannot reach it or assert its own role.
//
// The body of the seed is scripts/board-seed-plan.js, shared with the
// command-line fallback (scripts/seed-board.js), so the button and the
// script cannot disagree about what a seeded board is. Idempotent: ids are
// derived from lane + title, and a re-run leaves every item, the list's own
// fields and the markers exactly as they are -- it only creates what was
// never made and adds people who had no login last time. A missing login
// is skipped and named, never fatal.
//
// BOARD_OWNER_EMAILS mirrors isBoardOwner() in firestore.rules and
// BOARD_OWNERS in js/auth.js; tests/theboard.test.js fails if they drift.
const admin = require("firebase-admin");
const { runSeed } = require("../../scripts/board-seed-plan.js");

const BOARD_OWNER_EMAILS = ["ammar@groovy.op", "afnan@groovy.op"];

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
  const { idToken } = body;
  if (!idToken) return json(400, { error: "idToken is required" });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    return json(503, { error: "The seed is not configured on this site (no FIREBASE_SERVICE_ACCOUNT)." });
  }

  let app;
  try {
    app = getAdmin();
  } catch (e) {
    return json(503, { error: "The seed could not start: " + (e && e.message || e) });
  }
  let caller;
  try {
    caller = await app.auth().verifyIdToken(idToken);
  } catch {
    return json(401, { error: "Could not verify who you are — sign in again and retry." });
  }
  const email = String(caller.email || "").toLowerCase();
  if (!BOARD_OWNER_EMAILS.includes(email)) {
    return json(403, { error: "Only a Board owner can run the seed." });
  }

  const notes = [];
  try {
    const report = await runSeed({
      db: app.firestore(),
      auth: app.auth(),
      fieldValue: app.firestore.FieldValue,
      dryRun: body.dryRun === true,
      by: email,
      now: Date.now(),
      log: (m) => notes.push(m),
    });
    return json(200, { ok: true, report, notes, by: email });
  } catch (e) {
    return json(500, { error: "The seed failed part-way: " + (e && e.message || e), notes });
  }
};

exports._test = { BOARD_OWNER_EMAILS };

// ── The Board: the 08:00 PKT reminder ─────────────────────────────────────
// Scheduled at 03:00 UTC = 08:00 PKT (netlify.toml). Writes today's
// `due_today` and `overdue` rows into hrm_notifications for everyone on an
// open item -- the bell and The Board's inbox both read them. The body is
// scripts/board-reminder-plan.js; read its header.
//
// A scheduled function cannot be opened by URL: Netlify answers a direct
// HTTP request to one with 403 (CLAUDE.md, the catalog sync). It runs on
// the schedule, and only on a PUBLISHED production deploy.
//
// The Admin SDK bypasses firestore.rules by design, which is why this runs
// here and never in a browser: a reminder is written FOR other people, and
// the client rules rightly let nobody write a notification on someone
// else's behalf at scale.
const admin = require("firebase-admin");
const { runReminder } = require("../../scripts/board-reminder-plan.js");

function getAdmin() {
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin;
}

exports.handler = async function () {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn("[board-reminder] FIREBASE_SERVICE_ACCOUNT is not set — nothing sent.");
    return { statusCode: 503, body: JSON.stringify({ error: "not configured" }) };
  }
  try {
    const app = getAdmin();
    const report = await runReminder({ db: app.firestore(), nowMs: Date.now() });
    console.log("[board-reminder]", JSON.stringify(report));
    return { statusCode: 200, body: JSON.stringify({ ok: true, report }) };
  } catch (e) {
    console.error("[board-reminder] failed", e);
    return { statusCode: 500, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  }
};

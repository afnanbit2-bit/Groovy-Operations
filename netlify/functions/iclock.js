// ── ZKTeco "push" (ADMS / iclock) receiver ───────────────────────────────
// The attendance clock POSTs punches straight to us over the internet — no PC,
// no Access-DB scraping. The device firmware hardcodes the `/iclock/` path
// prefix; netlify.toml rewrites `/iclock/*` → this function.
//
// It speaks the minimal slice of the push protocol needed to collect punches:
//   • GET  /iclock/cdata      → handshake; we reply with a config that turns on
//                               real-time upload.
//   • POST /iclock/cdata?table=ATTLOG → attendance rows (tab-separated); we
//                               parse + write to RTDB, reply "OK: <n>".
//   • GET  /iclock/getrequest → device polls for commands; we reply "OK".
//   • anything else           → "OK" (accept and ignore, e.g. OPERLOG).
//
// Writes match the structure the app + old PC sync used, so the frontend is
// unchanged:
//   attendance/{date}/{userId}/{safeTs} = {userId,name,date,time,type,timestamp,synced,source}
//   attendance/live/{userId}            = {userId,name,status,lastSeen,updatedAt}
//   attendance/_meta                    = heartbeat (drives the "last synced" pill)
const admin = require("firebase-admin");

const RTDB_URL = "https://groovy-gatepass-default-rtdb.firebaseio.com";
let _db;
function getDb() {
  if (!_db) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: RTDB_URL });
    }
    _db = admin.database();
  }
  return _db;
}

const TEXT = { "Content-Type": "text/plain;charset=utf-8" };
const ok = (body) => ({ statusCode: 200, headers: TEXT, body: body == null ? "OK" : String(body) });

// Device allowlist — comma-separated serials, e.g. "CLKA204860123".
// Empty (unset) means "accept any serial", i.e. the pre-hardening behaviour.
const ALLOWED_SNS = String(process.env.ICLOCK_ALLOWED_SNS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
// Optional shared secret. Dormant unless ICLOCK_SECRET is set in Netlify.
const ICLOCK_SECRET = process.env.ICLOCK_SECRET || "";
const MAX_LINES = 500;          // one push should never exceed this
const MAX_SKEW_DAYS = 7;        // reject punches far outside a sane window

const crypto = require("crypto");
function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

// PKT "today" — the device sends local (PKT) timestamps already; used only to
// decide whether a punch should update the live-presence board.
function pktToday() {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

// ZK check state → in/out. 0 CheckIn · 1 CheckOut · 2 BreakOut · 3 BreakIn ·
// 4 OT-In · 5 OT-Out. Many K40s in simple mode always send 0 (treated as in).
function typeFromStatus(s) {
  const n = parseInt(s, 10);
  return n === 1 || n === 2 || n === 5 ? "out" : "in";
}

// Handshake config — the key line is Realtime=1, which tells the device to
// stream each punch as it happens instead of batching.
function handshakeConfig(sn) {
  return [
    `GET OPTION FROM: ${sn || "device"}`,
    "Stamp=9999",
    "OpStamp=9999",
    "ErrorDelay=30",
    "Delay=30",
    "TransTimes=00:00;23:59",
    "TransInterval=1",
    "TransFlag=1111000000",
    "TimeZone=5",
    "Realtime=1",
    "Encrypt=0",
    "",
  ].join("\n");
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const sn = q.SN || q.sn || "";
  const p = event.path || "";
  const method = (event.httpMethod || "GET").toUpperCase();
  let body = event.body || "";
  if (event.isBase64Encoded && body) body = Buffer.from(body, "base64").toString("utf8");

  // Layer B — optional shared secret, accepted in the path or as ?key=.
  // Dormant unless ICLOCK_SECRET is configured.
  if (ICLOCK_SECRET) {
    const supplied = q.key || q.KEY || "";
    const inPath = p.includes("/" + ICLOCK_SECRET + "/");
    if (!inPath && !safeEqual(supplied, ICLOCK_SECRET)) return ok("OK");
  }
  // Layer A — device serial allowlist.
  if (ALLOWED_SNS.length && !ALLOWED_SNS.includes(sn)) return ok("OK");

  try {
    // 1) Command poll — nothing queued.
    if (/getrequest/i.test(p)) return ok("OK");

    // 2) Attendance upload.
    if (method === "POST" && String(q.table || "").toUpperCase() === "ATTLOG") {
      const db = getDb();
      const today = pktToday();
      const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_LINES);
      let pushed = 0;
      for (const line of lines) {
        const f = line.split("\t");
        if (f.length < 2) continue;
        const userId = String(f[0]).trim();
        const ts = String(f[1]).trim(); // "YYYY-MM-DD HH:MM:SS"
        if (!userId || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(ts)) continue;
        const norm = ts.replace("T", " ");
        const date = norm.slice(0, 10);
        const time = norm.slice(11, 16);
        // norm is PKT local, same as pktToday()'s idiom (Date.now() + 5h) —
        // treat both as the same "naive UTC" clock so the offset cancels.
        const nowPkt = Date.now() + 5 * 3600 * 1000;
        const tsPkt = new Date(norm.replace(" ", "T") + "Z").getTime();
        if (!Number.isFinite(tsPkt) || Math.abs(nowPkt - tsPkt) > MAX_SKEW_DAYS * 24 * 3600 * 1000) continue;
        const type = typeFromStatus(f[2] != null ? f[2] : "0");
        const safeTs = norm.replace(/[:\s]/g, "-");
        const record = { userId, name: `User${userId}`, date, time, type, timestamp: norm, synced: true, source: "push" };
        const ref = db.ref(`attendance/${date}/${userId}/${safeTs}`);
        const cur = await ref.once("value");
        if (!cur.exists()) { await ref.set(record); pushed++; }
        if (date === today) {
          await db.ref(`attendance/live/${userId}`).set({
            userId, name: `User${userId}`, status: type,
            lastSeen: `${date} ${time}`, updatedAt: new Date().toISOString(),
          });
        }
      }
      await db.ref("attendance/_meta").set({
        lastSyncAt: new Date().toISOString(), lastSyncOk: true, lastError: "",
        recordsPushed: pushed, cursor: "", host: "device-push", sn,
      }).catch(() => {});
      return ok(`OK: ${pushed}`);
    }

    // 3) Other POST tables (OPERLOG, etc.) — accept and ignore.
    if (method === "POST") return ok("OK");

    // 4) Handshake / registry (GET cdata) — hand back the config.
    return ok(handshakeConfig(sn));
  } catch (err) {
    // Never return 5xx to the clock or it retries forever; log to _meta instead.
    try {
      await getDb().ref("attendance/_meta").update({
        lastSyncAt: new Date().toISOString(), lastSyncOk: false,
        lastError: String((err && err.message) || err), host: "device-push",
      });
    } catch (_) {}
    return ok("OK");
  }
};

// ── K40 network puller (the Raspberry Pi route) ──────────────────────────
// Reads the attendance clock DIRECTLY over TCP/IP using the native ZK protocol
// (the same way the ZKTeco desktop app connects), then forwards new punches to
// the /iclock receiver Function — which writes them to Firebase.
//
// Why this instead of sync.js: it never touches the Access database or the Jet
// OLEDB driver (the cause of "mostly results in errors"). It only needs to run
// on any always-on machine that can reach the clock on the LAN. No Firebase
// credentials live here — the receiver Function owns all the writes.
//
//   Run:  cd attendance-sync && npm install && node pull.js
//   IP/port override:  ZK_IP=192.168.100.201 ZK_PORT=4370 node pull.js
//
// ── Three things here are load-bearing; read before editing ──────────────
//
// 1. A FAILED POST MUST NOT ADVANCE THE CURSOR. post() rejects on a non-2xx
//    status AND on a reply that isn't "OK: <n>" — the receiver catches its own
//    errors and answers a bare "OK" with status 200, so the status code alone
//    cannot tell success from failure. The cursor is only saved after a POST
//    the receiver confirmed, so a Netlify 502 costs a retry, never a punch.
//
// 2. A HEARTBEAT IS SENT EVEN WHEN THERE ARE NO PUNCHES. The app's sync pill
//    is driven by attendance/_meta, which the receiver only writes when an
//    ATTLOG POST arrives. Posting nothing overnight would show "stale" on a
//    perfectly healthy puller — and, worse, make a DEAD puller look identical
//    to a quiet one. An empty body parses to zero rows and still stamps _meta,
//    so this needs no change on the server.
//
// 3. IN/OUT IS DERIVED, BECAUSE THE PROTOCOL DOES NOT CARRY IT. node-zklib's
//    record decoder returns only {userSn, deviceUserId, recordTime} — there is
//    no check-state field to read. Punches therefore alternate per user per
//    day: 1st = in, 2nd = out, 3rd = in. HOURS DO NOT DEPEND ON THIS — the app
//    computes them from the first and last punch of the day (_attPunchesByUser
//    in js/hrm.js), so a wrong guess costs the live "who's in" dot and never
//    payroll. That is the whole reason it is safe to guess at all.
const ZKLib = require("node-zklib");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEVICE_IP = process.env.ZK_IP || "192.168.100.201";
const DEVICE_PORT = parseInt(process.env.ZK_PORT || "4370", 10);
const HOST_TAG = (os.hostname() || "pi").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "pi";
const SN = `PULLER-${HOST_TAG}`;
const ENDPOINT =
  "https://groovyoperations.netlify.app/iclock/cdata" +
  `?SN=${encodeURIComponent(SN)}&table=ATTLOG&Stamp=9999`;
const STATE_FILE = process.env.ZK_STATE_FILE || path.join(__dirname, "last_pull.json");
const INTERVAL_MS = 60000;
// How far back a COLD START reaches. With the SD card read-only (see
// README.txt) the state file is discarded at every power cut, so this runs
// every morning, not just on the first install. 48h clears the longest
// overnight or weekend gap with room to spare while keeping the replay
// small. A longer outage is recovered by hand — see the README.
const BACKFILL_HOURS = parseInt(process.env.ZK_BACKFILL_HOURS || "48", 10);
// Punches per POST. The receiver writes each punch to RTDB sequentially —
// up to two round trips each — inside one Netlify function call, and that
// call is capped at 10s. 28 staff replayed over 48h is a few hundred
// punches, which as ONE request would run past the cap, fail, and retry
// forever every 60s. Chunking bounds the work per request instead.
const CHUNK = parseInt(process.env.ZK_CHUNK || "50", 10);
const POST_TIMEOUT_MS = 20000;
// Same user, two reads inside this window = one punch. A double-tap on the
// reader would otherwise flip the in/out parity for the rest of that day.
const DEDUPE_MS = 60000;

// "YYYY-MM-DD HH:MM:SS" in LOCAL time. node-zklib builds its Dates with the
// local constructor new Date(y,m,d,...), so formatting with the local getters
// round-trips the device's wall clock exactly, whatever timezone the Pi is in.
// The format is also lexicographically ordered, so the cursor compares as text.
function fmt(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const stamp = () => new Date().toLocaleTimeString();

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { last: s.last || "", day: s.day || "", users: s.users || {} };
  } catch {
    return { last: "", day: "", users: {} };
  }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s));
}

// Turn fresh punches into ATTLOG lines, deriving in/out and dropping repeats.
// Pure, so tests can drive it without a clock or a network.
function buildLines(fresh, prev) {
  const state = { last: prev.last || "", day: prev.day || "", users: { ...(prev.users || {}) } };
  const lines = [];
  for (const r of fresh) {
    const ts = fmt(r.t);
    const day = ts.slice(0, 10);
    // A new day resets the alternation — an unclosed shift must not make every
    // punch tomorrow read inverted.
    if (day !== state.day) {
      state.day = day;
      state.users = {};
    }
    const u = state.users[r.id] || { n: 0, ms: 0 };
    const ms = r.t.getTime();
    if (u.ms && ms - u.ms < DEDUPE_MS) {
      // Swallowed as a double-tap, but still passed, so the cursor moves on.
      if (ts > state.last) state.last = ts;
      continue;
    }
    const status = u.n % 2 === 0 ? 0 : 1; // even → check-in, odd → check-out
    lines.push(`${r.id}\t${ts}\t${status}\t1\t0\t0`);
    state.users[r.id] = { n: u.n + 1, ms };
    if (ts > state.last) state.last = ts;
  }
  return { lines, state };
}

// POST tab-separated ATTLOG lines to the receiver (the device's own format).
// Resolves with the number of rows the receiver says it stored; rejects on
// anything else so the caller knows not to advance the cursor.
function post(lines) {
  return new Promise((resolve, reject) => {
    const body = lines.join("\n");
    const u = new URL(ENDPOINT);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          const reply = d.trim();
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode} — ${reply.slice(0, 120)}`));
          }
          // The receiver answers a bare "OK" from its own catch block, so only
          // "OK: <n>" proves the rows were actually written.
          const m = /^OK:\s*(\d+)/.exec(reply);
          if (!m) return reject(new Error(`unexpected reply ${JSON.stringify(reply.slice(0, 120))}`));
          resolve(parseInt(m[1], 10));
        });
      }
    );
    req.setTimeout(POST_TIMEOUT_MS, () =>
      req.destroy(new Error(`POST timed out after ${POST_TIMEOUT_MS / 1000}s`))
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// One pull at a time. A hung clock read or a slow POST must not let the next
// interval stack a second pull on top and race the cursor.
let running = false;

async function pull() {
  if (running) {
    console.warn(`[${stamp()}] previous pull still running — skipping this tick`);
    return;
  }
  running = true;
  const zk = new ZKLib(DEVICE_IP, DEVICE_PORT, 10000, 4000);
  try {
    await zk.createSocket();
    const res = await zk.getAttendances();
    const recs = (res && res.data) || [];
    const prev = loadState();
    // First run: only the last 24h, so we don't replay the clock's whole log.
    const cutoff = prev.last || fmt(new Date(Date.now() - BACKFILL_HOURS * 3600000));
    const fresh = recs
      .map((r) => ({
        id: String(r.deviceUserId != null ? r.deviceUserId : r.userId != null ? r.userId : r.uid || "").trim(),
        t: new Date(r.recordTime),
      }))
      .filter((r) => r.id && !isNaN(r.t) && fmt(r.t) > cutoff)
      .sort((a, b) => a.t - b.t);

    if (!fresh.length) {
      await post([]); // heartbeat — see note 2 at the top
      console.log(`[${stamp()}] no new punches · heartbeat sent`);
      return;
    }

    // Send in chunks, saving the cursor after each one. A chunk that fails
    // stops the run with everything before it already banked, so the retry
    // resumes from there instead of replaying the whole window again.
    let st = prev;
    let sent = 0;
    let chunks = 0;
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const { lines, state } = buildLines(fresh.slice(i, i + CHUNK), st);
      if (lines.length) {
        const accepted = await post(lines);
        if (accepted < lines.length) {
          console.warn(`[${stamp()}] receiver stored ${accepted} of ${lines.length} rows — the rest failed to parse`);
        }
        sent += lines.length;
        chunks++;
      }
      // Saved even when every punch in the chunk was deduped, so the cursor
      // still moves past them and they are not re-read on the next tick.
      saveState(state);
      st = state;
    }
    console.log(
      `[${stamp()}] forwarded ${sent} punch(es)` +
        (chunks > 1 ? ` in ${chunks} batches` : "") +
        (fresh.length !== sent ? ` (${fresh.length - sent} deduped)` : "") +
        ` · cursor ${st.last}`
    );
  } catch (e) {
    // Nothing is saved on this path, so the same punches are retried next tick.
    console.error(`[${stamp()}] pull error: ${(e && e.message) || e}`);
  } finally {
    try {
      await zk.disconnect();
    } catch (_) {}
    running = false;
  }
}

if (require.main === module) {
  console.log(`K40 puller → ${DEVICE_IP}:${DEVICE_PORT} every ${INTERVAL_MS / 1000}s`);
  console.log(`cold start reaches back ${BACKFILL_HOURS}h · ${CHUNK} punches per batch`);
  console.log(`reporting as ${SN} → ${new URL(ENDPOINT).host}`);
  console.log(`state file: ${STATE_FILE}`);
  pull();
  setInterval(pull, INTERVAL_MS);
}

module.exports = { buildLines, fmt, post, pull, DEDUPE_MS, CHUNK, BACKFILL_HOURS, STATE_FILE };

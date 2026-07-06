// ── K40 network puller (recommended replacement for sync.js) ─────────────
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
//   IP/port override:  set ZK_IP=192.168.100.201 & set ZK_PORT=4370
const ZKLib = require("node-zklib");
const https = require("https");
const fs = require("fs");
const path = require("path");

const DEVICE_IP = process.env.ZK_IP || "192.168.100.201";
const DEVICE_PORT = parseInt(process.env.ZK_PORT || "4370", 10);
const ENDPOINT = "https://groovyoperations.netlify.app/iclock/cdata?SN=PULLER&table=ATTLOG&Stamp=9999";
const STATE_FILE = path.join(__dirname, "last_pull.json");
const INTERVAL_MS = 60000;

function fmt(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function getLast() { try { return JSON.parse(fs.readFileSync(STATE_FILE)).last || ""; } catch { return ""; } }
function saveLast(ts) { fs.writeFileSync(STATE_FILE, JSON.stringify({ last: ts })); }

// POST tab-separated ATTLOG lines to the receiver (same format the device uses).
function post(lines) {
  return new Promise((resolve, reject) => {
    const body = lines.join("\n");
    const u = new URL(ENDPOINT);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "POST",
        headers: { "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(body) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(d)); }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function pull() {
  const zk = new ZKLib(DEVICE_IP, DEVICE_PORT, 10000, 4000);
  try {
    await zk.createSocket();
    const res = await zk.getAttendances();
    const recs = (res && res.data) || [];
    // First run: only forward the last 24h so we don't replay the whole log.
    let last = getLast() || fmt(new Date(Date.now() - 86400000));
    const fresh = recs
      .map((r) => ({ id: String(r.deviceUserId || r.userId || r.uid || "").trim(), t: new Date(r.recordTime) }))
      .filter((r) => r.id && !isNaN(r.t) && fmt(r.t) > last)
      .sort((a, b) => a.t - b.t);
    if (fresh.length) {
      const lines = fresh.map((r) => `${r.id}\t${fmt(r.t)}\t0\t1\t0\t0`);
      await post(lines);
      saveLast(fmt(fresh[fresh.length - 1].t));
      console.log(`[${new Date().toLocaleTimeString()}] forwarded ${fresh.length} punch(es)`);
    } else {
      console.log(`[${new Date().toLocaleTimeString()}] no new punches`);
    }
  } catch (e) {
    console.error("pull error:", e.message);
  } finally {
    try { await zk.disconnect(); } catch (_) {}
  }
}

pull();
setInterval(pull, INTERVAL_MS);
console.log(`K40 network puller → ${DEVICE_IP}:${DEVICE_PORT} every ${INTERVAL_MS / 1000}s. Ctrl+C to stop.`);

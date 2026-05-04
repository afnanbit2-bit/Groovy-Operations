const ADODB = require('node-adodb');
const https = require('https');
const fs = require('fs');
const path = require('path');

const DB_PATH = 'C:\\Program Files (x86)\\ZKTeco\\att2000.mdb';
const STATE_FILE = path.join(__dirname, 'last_sync.json');
const RTDB_HOST = 'groovy-gatepass-default-rtdb.firebaseio.com';

// Format a Date or parseable string as "YYYY-MM-DD HH:MM:SS" in LOCAL time.
// Access JET stores CHECKTIME as local datetime, so the cursor must be local
// too — otherwise WHERE CHECKTIME > #...# behaves unpredictably.
function fmtTs(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

function getLastSync() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE));
    // Older versions stored an ISO 8601 string (with T...Z). Normalize back to
    // local "YYYY-MM-DD HH:MM:SS" so the SQL date literal parses correctly.
    return fmtTs(data.lastSync) || '2026-01-01 00:00:00';
  } catch {
    return '2026-01-01 00:00:00';
  }
}

function saveLastSync(ts) {
  // Always store as the canonical local-time string format.
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSync: fmtTs(ts) }));
}

function rtdbPut(p, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: RTDB_HOST,
      path: p,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(options, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function pushToFirebase(date, userId, timestamp, record) {
  const safets = String(timestamp).replace(/[:\s]/g, '-');
  return rtdbPut(`/attendance/${date}/${userId}/${safets}.json`, record);
}

function pushLivePresence(userId, name, status, time, date) {
  return rtdbPut(`/attendance/live/${userId}.json`, {
    userId, name, status,
    lastSeen: `${date} ${time}`,
    updatedAt: new Date().toISOString()
  });
}

// Heartbeat — written on EVERY sync attempt (success or failure) so the
// frontend can show "Last synced N minutes ago" and surface the most
// recent error if the script is alive but failing.
function pushHeartbeat(stats) {
  return rtdbPut('/attendance/_meta.json', {
    lastSyncAt: new Date().toISOString(),
    lastSyncOk: !!stats.ok,
    lastError: stats.error || '',
    recordsPushed: stats.recordsPushed || 0,
    cursor: stats.cursor || '',
    host: stats.host || ''
  }).catch(() => {});
}

async function sync() {
  console.log(`[${new Date().toLocaleTimeString()}] Syncing...`);
  // Hard 24-hour ceiling: never push records older than yesterday, even if state
  // file is missing or reset. Prevents replaying months of history.
  const oneDayAgo = new Date(Date.now() - 86400000);
  const cutoff = fmtTs(oneDayAgo);
  const lastSync = getLastSync();
  const effectiveCutoff = lastSync > cutoff ? lastSync : cutoff;
  const today = fmtTs(new Date()).slice(0, 10);
  const host = require('os').hostname();
  let recordsPushed = 0;

  try {
    const connection = ADODB.open(`Provider=Microsoft.Jet.OLEDB.4.0;Data Source=${DB_PATH};`);
    const records = await connection.query(
      `SELECT CHECKINOUT.USERID, CHECKINOUT.CHECKTIME, CHECKINOUT.CHECKTYPE, USERINFO.NAME
       FROM CHECKINOUT LEFT JOIN USERINFO ON CHECKINOUT.USERID = USERINFO.USERID
       WHERE CHECKINOUT.CHECKTIME > #${effectiveCutoff}#
       ORDER BY CHECKINOUT.CHECKTIME ASC`
    );
    if (!records || records.length === 0) {
      console.log(`No new records (cursor: ${effectiveCutoff}).`);
      await pushHeartbeat({ ok: true, recordsPushed: 0, cursor: effectiveCutoff, host });
      return;
    }
    console.log(`Found ${records.length} new records (cursor: ${effectiveCutoff}).`);
    let latest = effectiveCutoff;
    for (const row of records) {
      const dt = new Date(row.CHECKTIME);
      const date = dt.toISOString().split('T')[0];
      const time = dt.toTimeString().slice(0, 5);
      const userId = String(row.USERID);
      const name = row.NAME || `User${userId}`;
      const type = (row.CHECKTYPE || 'I').toUpperCase() === 'O' ? 'out' : 'in';
      const tsStr = fmtTs(row.CHECKTIME);
      const record = { userId, name, date, time, type, timestamp: tsStr, synced: true };
      await pushToFirebase(date, userId, tsStr, record);
      // Live presence reflects current state only — don't let yesterday's last
      // punch overwrite today's status when historical records are replayed.
      if (date === today) {
        await pushLivePresence(userId, name, type, time, date);
      }
      // Both `latest` and `tsStr` are now strings in the same local-time format,
      // so the lex comparison is safe and equivalent to chronological order.
      if (tsStr > latest) latest = tsStr;
      recordsPushed++;
      console.log(`  Pushed: ${name} ${type} at ${time} (${date})`);
    }
    saveLastSync(latest);
    console.log(`Sync complete. Pushed ${recordsPushed}. Cursor: ${latest}. Next in 60s.`);
    await pushHeartbeat({ ok: true, recordsPushed, cursor: latest, host });
  } catch (err) {
    console.error('Sync error:', err.message);
    await pushHeartbeat({ ok: false, recordsPushed, cursor: effectiveCutoff, error: err.message, host });
  }
}

sync();
setInterval(sync, 60000);
console.log('Groovy Attendance Sync running. Press Ctrl+C to stop.');

const ADODB = require('node-adodb');
const https = require('https');
const fs = require('fs');
const path = require('path');

const DB_PATH = 'C:\\Program Files (x86)\\ZKTeco\\att2000.mdb';
const STATE_FILE = path.join(__dirname, 'last_sync.json');

function getLastSync() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE));
    return data.lastSync || '2026-01-01 00:00:00';
  } catch {
    return '2026-01-01 00:00:00';
  }
}

function saveLastSync(ts) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSync: ts }));
}

function pushToFirebase(date, userId, timestamp, record) {
  return new Promise((resolve, reject) => {
    const safets = timestamp.replace(/[:\s]/g, '-');
    const path = `/attendance/${date}/${userId}/${safets}.json`;
    const body = JSON.stringify(record);
    const options = {
      hostname: 'groovy-gatepass-default-rtdb.firebaseio.com',
      path, method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function pushLivePresence(userId, name, status, time, date) {
  return new Promise((resolve, reject) => {
    const path = `/attendance/live/${userId}.json`;
    const body = JSON.stringify({ userId, name, status, lastSeen: `${date} ${time}`, updatedAt: new Date().toISOString() });
    const options = {
      hostname: 'groovy-gatepass-default-rtdb.firebaseio.com',
      path, method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sync() {
  console.log(`[${new Date().toLocaleTimeString()}] Syncing...`);
  // Hard 24-hour ceiling: never push records older than yesterday, even if state
  // file is missing or reset. Prevents replaying months of history.
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const cutoff = yesterday.toISOString().slice(0, 19).replace('T', ' ');
  const lastSync = getLastSync();
  const effectiveCutoff = lastSync > cutoff ? lastSync : cutoff;
  const today = new Date().toISOString().split('T')[0];
  try {
    const connection = ADODB.open(`Provider=Microsoft.Jet.OLEDB.4.0;Data Source=${DB_PATH};`);
    const records = await connection.query(
      `SELECT CHECKINOUT.USERID, CHECKINOUT.CHECKTIME, CHECKINOUT.CHECKTYPE, USERINFO.NAME
       FROM CHECKINOUT LEFT JOIN USERINFO ON CHECKINOUT.USERID = USERINFO.USERID
       WHERE CHECKINOUT.CHECKTIME > #${effectiveCutoff}#
       ORDER BY CHECKINOUT.CHECKTIME ASC`
    );
    if (!records || records.length === 0) { console.log('No new records.'); return; }
    console.log(`Found ${records.length} new records (cutoff: ${effectiveCutoff}).`);
    let latest = effectiveCutoff;
    for (const row of records) {
      const dt = new Date(row.CHECKTIME);
      const date = dt.toISOString().split('T')[0];
      const time = dt.toTimeString().slice(0, 5);
      const userId = String(row.USERID);
      const name = row.NAME || `User${userId}`;
      const type = (row.CHECKTYPE || 'I').toUpperCase() === 'O' ? 'out' : 'in';
      const timestamp = row.CHECKTIME;
      const record = { userId, name, date, time, type, timestamp, synced: true };
      await pushToFirebase(date, userId, timestamp, record);
      // Live presence reflects current state only — don't let yesterday's last
      // punch overwrite today's status when historical records are replayed.
      if (date === today) {
        await pushLivePresence(userId, name, type, time, date);
      }
      if (timestamp > latest) latest = timestamp;
      console.log(`  Pushed: ${name} ${type} at ${time} (${date})`);
    }
    saveLastSync(latest);
    console.log(`Sync complete. Last cursor: ${latest}. Next in 60s.`);
  } catch (err) {
    console.error('Sync error:', err.message);
  }
}

sync();
setInterval(sync, 60000);
console.log('Groovy Attendance Sync running. Press Ctrl+C to stop.');

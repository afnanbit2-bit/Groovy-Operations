// ── Master Accounts: the nightly backup (MASTER_ACCOUNTS_PLAN.md §30) ─────
// Layer 1 of the plan's three: a Firestore managed export of the books and
// their feeders to a Cloud Storage bucket, one run a day, each run written
// to ma_backups — which is what the Today page's "needs attention" reads
// (maNeedsAttention in js/ma-core.js: the LATEST row by `at`, read by its
// `state` through maBackupState — 'failed' is "Last night’s backup failed:
// <error>.", 'not_configured' is "Backups are not set up yet — <what is
// missing>.", a 'done' row older than settings.backupWatchHours (36) is
// "The last backup ran <how long> ago.", a 'starting'/'running' row that
// old is "The backup that started <how long> ago has not finished.", and no
// row at all is "No nightly backup has run yet — …").
//
// WHY IT WAKES EVERY HOUR (netlify.toml "30 * * * *") when the plan says
// "03:30 UTC daily": an export takes minutes and a scheduled function gets
// seconds, so a run cannot wait for its own result. Each wake therefore
//   1. RESOLVES every run still in progress — asks Firestore how its export
//      ended and records done (documents, bytes) or failed (Google's own
//      error), plus one ma_audit row; and then
//   2. STARTS today's export, once, at the first wake at or after 03:30 UTC
//      (08:30 PKT — the plan's time; START_UTC_MINUTES). The row's id is
//      `nightly-<UTC day>`, claimed in a transaction, so a second wake the
//      same day — or two at once — never starts a second export.
// The core reads only the LATEST row. Resolved once a day, last night's
// failure would be discovered by tonight's run and at once buried under
// tonight's fresh row; resolved within the hour, it is the latest row for
// the rest of the day, which is what "a concern line the next morning"
// needs.
//
// NOT CONFIGURED is a state, never a crash and never a success: with no
// usable MA_BACKUP_BUCKET, today's row is written {state:'not_configured',
// ok:false, configured:false, missing:[…], error:'Backups are not set up
// yet — …'}. The core reads that state (maBackupState) and words it as what
// it is: on Today, a concern "Backups are not set up yet — MA_BACKUP_BUCKET
// is not set in Netlify." (maBackupMissing takes the reason after the dash,
// or else the names in `missing`), never "failed" and never a backup that
// worked; on Close & audit → Backups, "not set up" with the missing names.
// Setting the bucket later the same day turns that row into a real run at
// the next wake. Without FIREBASE_SERVICE_ACCOUNT nothing can be written at
// all; that is logged, and Today goes on reading whatever the latest row
// already says — "No nightly backup has run yet" when there is none.
//
// The export asks for a consistent snapshot (snapshotTime, a minute ago —
// without it Firestore promises no consistency across documents). If the
// database refuses that (HTTP 400), the run retries once without it and
// records consistent:false.
//
// A scheduled function cannot be opened by URL (Netlify answers 403 — see
// board-reminder.js). There is no "back up now": the plan does not ask for
// one; the first run after 03:30 UTC is the test, and it writes its own
// result.
//
// UNVERIFIED from the sandbox: the bucket, the service account's roles on it
// and on Firestore, and PITR — none can be reached from here.
'use strict';
const lib = require('../lib/ma-server.js');

// The books (every ma_* / ma_sv_* collection) and their feeders (§30).
// tests/ma-backup.test.js fails if a collection the Master Accounts client
// reads or writes, or an ma_* / acct_* block in firestore.rules, is missing.
const MA_BACKUP_COLLECTIONS = [
  'ma_accounts', 'ma_sv_accounts', 'ma_parties', 'ma_items', 'ma_settings', 'ma_commitments',
  'ma_counters', 'ma_feedback', 'ma_journal', 'ma_transfer', 'ma_counts', 'ma_closes',
  'ma_audit', 'ma_backups', 'ma_shares', 'ma_cpr', 'ma_collection', 'ma_runs',
  'postex_orders', 'wh_sales', 'acct_entries', 'acct_vendors', 'acct_meter_logs',
  'acct_settings', 'acct_closes', 'payroll_runs', 'payslips', 'shopify_orders'
];
const START_UTC_MINUTES = 3 * 60 + 30;              // 03:30 UTC = 08:30 PKT
const STARTING_STUCK_MS = 15 * 60 * 1000;           // claimed, but no export was ever recorded
const RUNNING_STUCK_MS = 12 * 3600 * 1000;          // an export this small takes minutes
const FIRESTORE_API = 'https://firestore.googleapis.com/v1/';
const FETCH_MS = 8000;
const OP_NAME = /^projects\/[a-z0-9-]+\/databases\/[^/]+\/operations\/[A-Za-z0-9_-]+$/;

const pad = n => String(n).padStart(2, '0');
function utcDay(ms) { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
function utcMinutes(ms) { const d = new Date(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function stamp(ms) { const d = new Date(ms); return utcDay(ms) + '_' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'; }
function humanBytes(b) {
  if (!Number.isFinite(b) || b < 0) return null;
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
const int64 = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const clip = (s, n) => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 300);

// What is needed to start an export. → {ok, bucket, projectId} or
// {ok:false, reason, missing}.
function backupConfig(env) {
  const sa = lib.serviceAccount(env);
  if (!sa) return { ok: false, reason: 'FIREBASE_SERVICE_ACCOUNT is missing or unreadable', missing: ['FIREBASE_SERVICE_ACCOUNT'] };
  if (typeof sa.project_id !== 'string' || !/^[a-z][a-z0-9-]{4,29}$/.test(sa.project_id)) {
    return { ok: false, reason: 'the service account names no project', missing: ['FIREBASE_SERVICE_ACCOUNT'] };
  }
  const raw = String(env.MA_BACKUP_BUCKET || '').trim();
  if (!raw) return { ok: false, reason: 'MA_BACKUP_BUCKET is not set in Netlify', missing: ['MA_BACKUP_BUCKET'] };
  const bucket = raw.replace(/^gs:\/\//i, '').replace(/\/+$/, '');
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket) || bucket.indexOf('..') >= 0 || /^goog/.test(bucket)) {
    return { ok: false, reason: 'MA_BACKUP_BUCKET is not a Cloud Storage bucket name', missing: ['MA_BACKUP_BUCKET'] };
  }
  return { ok: true, bucket, projectId: sa.project_id };
}

async function fetchJson(fetchImpl, url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const r = await fetchImpl(url, Object.assign({}, init, { signal: ctrl.signal }));
    let body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    return { ok: !!r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e && e.name === 'AbortError' ? 'no answer within ' + (FETCH_MS / 1000) + ' s' : clip((e && e.message) || e, 200) };
  } finally { clearTimeout(timer); }
}
const googleError = r => clip((r.body && r.body.error && (r.body.error.message || r.body.error.status)) || r.error || ('HTTP ' + r.status), 300);

// A run reaches its end: the row, and one audit row, in one batch. The core
// prints `error` inside its own sentence and adds the full stop itself, so a
// stored error never ends in one.
const unstop = e => String(e).replace(/[\s.]+$/, '');
async function finish(db, ref, row, patch, nowMs) {
  const out = Object.assign({ checkedAt: nowMs, endedAt: patch.endedAt || nowMs }, patch);
  if (typeof out.error === 'string') out.error = unstop(out.error);
  const detail = out.ok
    ? 'Done — ' + [out.documents !== null && out.documents !== undefined ? out.documents.toLocaleString('en-US') + ' documents' : '', out.size || '', (row.collections || 0) + ' collections'].filter(Boolean).join(' · ')
    : 'Failed — ' + out.error;
  const b = db.batch();
  b.update(ref, out);
  b.set(db.collection('ma_audit').doc(lib.auditId(nowMs, 'ma-backup')),
    lib.auditRow('backup', { dt: 'backup', id: row.id || ref.id, no: row.id || ref.id }, { detail, by: 'ma-backup', byName: 'Nightly backup', at: nowMs }));
  await b.commit();
  return out;
}

async function resolve(o, report) {
  const { db, nowMs } = o;
  const snap = await db.collection('ma_backups').where('state', 'in', ['starting', 'running']).get();
  for (const doc of snap.docs) {
    const row = Object.assign({ id: doc.id }, doc.data());
    const age = nowMs - (Number(row.at) || 0);
    const done = (patch) => finish(db, doc.ref, row, patch, nowMs).then(() => report.resolved.push({ id: row.id, state: patch.state }));
    if (row.state === 'starting') {
      if (age > STARTING_STUCK_MS) await done({ state: 'failed', ok: false, error: 'This run stopped before it recorded an export, so whether one ran is unknown; tomorrow’s run tries again' });
      continue;
    }
    if (typeof row.operation !== 'string' || !OP_NAME.test(row.operation)) {
      await done({ state: 'failed', ok: false, error: 'No export operation was recorded for this run' });
      continue;
    }
    let token;
    try { token = await o.getToken(); }
    catch (e) { report.errors.push('access token: ' + clip((e && e.message) || e, 200)); return; }
    const r = await fetchJson(o.fetch, FIRESTORE_API + row.operation, { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 404) { await done({ state: 'failed', ok: false, error: 'Firestore no longer knows this export (its operation was not found)' }); continue; }
    if (!r.ok || !r.body) {
      await doc.ref.update({ checkedAt: nowMs, lastCheckError: 'Could not ask Firestore how the export went: ' + googleError(r) });
      report.pending.push(row.id);
      continue;
    }
    const op = r.body, md = op.metadata || {};
    if (!op.done) {
      if (age > RUNNING_STUCK_MS) await done({ state: 'failed', ok: false, operationState: clip(md.operationState, 40) || null, error: 'The export did not finish within 12 hours' });
      else { await doc.ref.update({ checkedAt: nowMs, operationState: clip(md.operationState, 40) || null, lastCheckError: null }); report.pending.push(row.id); }
      continue;
    }
    const endedAt = Date.parse(md.endTime) || nowMs;
    if (op.error || md.operationState === 'FAILED' || md.operationState === 'CANCELLED') {
      const e = op.error || {};
      await done({ state: 'failed', ok: false, endedAt, operationState: clip(md.operationState, 40) || null,
        error: 'The Firestore export ' + (md.operationState === 'CANCELLED' || e.code === 1 ? 'was cancelled' : 'failed') + ': ' + clip(e.message || md.operationState || 'no reason given', 240) + (e.code ? ' (code ' + e.code + ')' : '') });
      continue;
    }
    const bytes = int64(md.progressBytes && md.progressBytes.completedWork);
    await done({ state: 'done', ok: true, endedAt, operationState: clip(md.operationState, 40) || 'SUCCESSFUL', error: null, lastCheckError: null,
      documents: int64(md.progressDocuments && md.progressDocuments.completedWork), bytes, size: humanBytes(bytes),
      outputUriPrefix: (op.response && typeof op.response.outputUriPrefix === 'string' && op.response.outputUriPrefix) || row.outputUriPrefix || null });
  }
}

async function start(o, report) {
  const { db, env, nowMs } = o;
  if (utcMinutes(nowMs) < START_UTC_MINUTES) { report.start = 'before 03:30 UTC'; return; }
  const id = 'nightly-' + utcDay(nowMs);
  const ref = db.collection('ma_backups').doc(id);
  const cfg = backupConfig(env);
  const base = { id, kind: 'nightly', day: utcDay(nowMs), at: nowMs, checkedAt: nowMs, by: 'ma-backup',
    collectionIds: MA_BACKUP_COLLECTIONS.slice(), collections: MA_BACKUP_COLLECTIONS.length,
    operation: null, operationState: null, consistent: null, snapshotTime: null,
    documents: null, bytes: null, size: null, endedAt: null, lastCheckError: null };
  if (!cfg.ok) {
    const wrote = await db.runTransaction(async tx => {
      const s = await tx.get(ref);
      if (s.exists) return false;
      tx.set(ref, Object.assign({}, base, { state: 'not_configured', ok: false, configured: false, missing: cfg.missing,
        bucket: null, outputUriPrefix: null, error: 'Backups are not set up yet — ' + cfg.reason }));
      return true;
    });
    report.start = wrote ? 'not configured: ' + cfg.reason : 'already recorded today';
    return;
  }
  const outputUriPrefix = 'gs://' + cfg.bucket + '/ma-backups/' + stamp(nowMs);
  // Claim the day. A day that was only "not set up" is claimed again the
  // moment it is set up; a day that already started is never started twice.
  const claimed = await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (s.exists && (s.data() || {}).state !== 'not_configured') return false;
    tx.set(ref, Object.assign({}, base, { state: 'starting', ok: null, configured: true, missing: [],
      bucket: cfg.bucket, outputUriPrefix, error: null }));
    return true;
  });
  if (!claimed) { report.start = 'already started today'; return; }
  const row = Object.assign({}, base, { outputUriPrefix });
  let token;
  try { token = await o.getToken(); }
  catch (e) {
    await finish(db, ref, row, { state: 'failed', ok: false, error: 'Could not get a Google access token for the service account: ' + clip((e && e.message) || e, 200) }, nowMs);
    report.start = 'failed: access token';
    return;
  }
  const snapshotTime = new Date(Math.floor(nowMs / 60000) * 60000 - 60000).toISOString();
  const url = FIRESTORE_API + 'projects/' + cfg.projectId + '/databases/(default):exportDocuments';
  const call = body => fetchJson(o.fetch, url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let r = await call({ collectionIds: MA_BACKUP_COLLECTIONS, outputUriPrefix, snapshotTime });
  let consistent = true, note = null;
  if (!r.ok && r.status === 400) {
    note = 'A consistent snapshot was refused (' + googleError(r) + '); exported without one.';
    consistent = false;
    r = await call({ collectionIds: MA_BACKUP_COLLECTIONS, outputUriPrefix });
  }
  if (!r.ok || !r.body || typeof r.body.name !== 'string' || !OP_NAME.test(r.body.name)) {
    await finish(db, ref, row, { state: 'failed', ok: false, note,
      error: 'Firestore refused the export' + (r.status ? ' (HTTP ' + r.status + ')' : '') + ': ' + googleError(r) }, nowMs);
    report.start = 'failed: HTTP ' + r.status;
    return;
  }
  await ref.update({ state: 'running', operation: r.body.name, consistent, snapshotTime: consistent ? snapshotTime : null, note,
    operationState: clip(r.body.metadata && r.body.metadata.operationState, 40) || null, checkedAt: nowMs });
  report.start = 'started ' + id;
}

async function runBackup(o) {
  const report = { at: o.nowMs, resolved: [], pending: [], start: null, errors: [] };
  await resolve(o, report);
  await start(o, report);
  return report;
}

exports.handler = async function () {
  if (!lib.serviceAccount(process.env)) {
    console.error('[ma-backup] FIREBASE_SERVICE_ACCOUNT is missing or unreadable — nothing was backed up and nothing could be recorded.');
    return { statusCode: 503, body: JSON.stringify({ error: 'not configured' }) };
  }
  try {
    const app = lib.getAdmin();
    const report = await runBackup({ db: app.firestore(), env: process.env, nowMs: Date.now(), fetch: global.fetch, getToken: () => lib.accessToken(app) });
    console.log('[ma-backup]', JSON.stringify(report));
    return { statusCode: 200, body: JSON.stringify({ ok: true, report }) };
  } catch (e) {
    console.error('[ma-backup] failed', (e && e.stack) || e);
    return { statusCode: 500, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  }
};
exports._test = { runBackup, backupConfig, utcDay, utcMinutes, stamp, humanBytes, MA_BACKUP_COLLECTIONS, START_UTC_MINUTES, STARTING_STUCK_MS, RUNNING_STUCK_MS, OP_NAME };

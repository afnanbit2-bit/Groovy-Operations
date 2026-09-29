// ── Master Accounts: the nightly courier rollup (M2) ──────────────────────
// Turns PostEx parcels (postex_orders) into the courier documents the books
// post from: a `day` per delivery day, the `opening`, and one document per
// PostEx receipt, all in ma_cpr with derived:true (js/ma-core.js, "The
// derived documents"). THIS FILE DECIDES NOTHING ABOUT ACCOUNTING: every
// figure comes from maCprDerive, every document from maCourierDocs and every
// merge/void/lock decision from maCourierPlan; the 1120 check is
// maCourier1120Check. It reads, calls those, and writes what the plan says.
//
// Schedule: 45 3 * * * UTC (netlify.toml) — 08:45 PKT, after the 03:00 UTC
// PostEx payments run (postex-payments-background) has filled in the CPR
// numbers. A BACKGROUND function (15-minute budget): postex_orders is read
// whole. A scheduled function cannot be opened by URL (Netlify answers 403 —
// see board-reminder.js); ma-rollup-now-background.js is the owners' "run it
// now", the pattern-sync-now-background.js precedent.
//
// READS  ma_settings/main · ma_closes · ma_cpr · ma_collection · ma_accounts,
//        ma_journal, ma_transfer, ma_counts (only for the 1120 check) and
//        postex_orders with .select() of exactly the fields the derivation
//        reads (PARCEL_FIELDS; tests/ma-rollup.test.js records every field
//        the core reads and fails if one is missing from the list).
// DAY    `today` is the Pakistan day (UTC+5, no daylight saving) — never
//        a UTC ISO-string slice, which names the previous day between
//        19:00 UTC and midnight.
// WRITES only what the plan says (created, updated, voided), in batches of at
//        most 400; nothing in a locked quarter, nothing typed (derived not
//        true), nothing ever deleted. The LAST batch also carries the run
//        document ma_runs/rollup and ONE ma_audit row {action:'rollup',
//        by:'ma-rollup'}. A failure replaces the run document with
//        {state:'failed', error} and still writes its audit row.
// REFUSES to write (fails the run) when the derivation cannot be trusted:
//        bad options (would void everything), or postex_orders answering
//        with no parcels at all while derived documents exist.
// Concurrency: two runs at once (the schedule and an owner's button) derive
//        the same documents from the same parcels; a rev may be bumped twice
//        for one change at worst. No lock document — a crash would leave it
//        stuck.
'use strict';
const lib = require('../lib/ma-server.js');
const core = lib.core;

const BATCH_MAX = 400;
const ISSUES_KEPT = 50;
const SKIPPED_KEPT = 100;
const PARCEL_FIELDS = [
  'trackingNumber', 'statusCategory', 'dispatched', 'cod', 'transactionFee', 'transactionTax',
  'reversalFee', 'reversalTax', 'upfrontPayment', 'reservePayment', 'balancePayment',
  'upfrontPaymentDate', 'settlementDate', 'cprNumber_1', 'cprNumber_2', 'cpr1Date', 'cpr2Date',
  'orderPickupDate', 'orderDeliveryDate', 'transactionDate', 'settle', 'cprCheckedAt', 'syncedAt'
];

const pad = n => String(n).padStart(2, '0');
// Pakistan is UTC+5 all year. → 'YYYY-MM-DD'.
function karachiDay(ms) {
  const d = new Date(ms + 5 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
const clip = (s, n) => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 300);
const clean = o => JSON.parse(JSON.stringify(o));   // Firestore refuses undefined
const rows = snap => snap.docs.map(d => Object.assign({ id: d.id }, d.data()));

async function readAll(db) {
  const ask = (name, q) => q.get().catch(e => { const err = new Error('could not read ' + name + ': ' + clip((e && e.message) || e, 200)); err.cause = e; throw err; });
  const settingsSnap = await db.collection('ma_settings').doc('main').get().catch(e => { throw new Error('could not read ma_settings: ' + clip((e && e.message) || e, 200)); });
  const [closes, cpr, coll, accounts, journal, transfer, counts, parcels] = await Promise.all([
    ask('ma_closes', db.collection('ma_closes')),
    ask('ma_cpr', db.collection('ma_cpr')),
    ask('ma_collection', db.collection('ma_collection')),
    ask('ma_accounts', db.collection('ma_accounts')),
    ask('ma_journal', db.collection('ma_journal')),
    ask('ma_transfer', db.collection('ma_transfer')),
    ask('ma_counts', db.collection('ma_counts')),
    ask('postex_orders', db.collection('postex_orders').select(...PARCEL_FIELDS))
  ]);
  return {
    settings: core.maSettings(settingsSnap.exists ? settingsSnap.data() : null),
    closes: rows(closes), cpr: rows(cpr), collections: rows(coll), accounts: rows(accounts),
    journal: rows(journal), transfer: rows(transfer), counts: rows(counts),
    parcels: parcels.docs.map(d => d.data())
  };
}

// The 1120 check needs the books' lines after this run's writes.
function check1120(data, plan, der) {
  const next = {};
  data.cpr.forEach(d => { next[d.id] = d; });
  plan.writes.forEach(w => { next[w.id] = w.doc; });
  const idx = core.maChartIndex(core.maChart('groovy', data.accounts));
  const docs = []
    .concat(data.journal.map(d => Object.assign({ dt: 'journal' }, d)), data.transfer.map(d => Object.assign({ dt: 'transfer' }, d)),
      data.counts.map(d => Object.assign({ dt: 'count' }, d)), Object.keys(next).map(k => Object.assign({ dt: 'cpr' }, next[k])),
      data.collections.map(d => Object.assign({ dt: 'collection' }, d)));
  const lines = core.maPostAll(docs, idx, data.settings);
  return core.maCourier1120Check(lines, idx, der);
}

async function runRollup(o) {
  const { db, nowMs } = o;
  const today = karachiDay(nowMs);
  const trigger = o.triggeredBy ? 'owner' : 'schedule';
  const runRef = db.collection('ma_runs').doc('rollup');
  const auditRef = () => db.collection('ma_audit').doc(lib.auditId(nowMs, core.MA_ROLLUP_BY));
  const audit = detail => lib.auditRow('rollup', { dt: 'rollup', id: 'rollup', no: 'rollup' },
    { detail, by: core.MA_ROLLUP_BY, byName: core.MA_ROLLUP_NAME, at: nowMs });
  const report = { at: nowMs, day: today, trigger, created: 0, updated: 0, voided: 0, unchanged: 0, skipped: 0, batches: 0 };
  try {
    const data = await readAll(db);
    const s = data.settings, from = s.couriers.from;
    const der = core.maCprDerive(data.parcels, { from, today });
    if (der.issues.some(i => i.rule === 'derive.opts')) {
      throw new Error('the rollup cannot run between ' + from + ' and ' + today + ' — nothing was written or voided. ' + clip((der.issues.find(i => i.rule === 'derive.opts') || {}).message, 200));
    }
    const liveDerived = data.cpr.filter(d => d.derived && d.status !== 'void').length;
    if (!data.parcels.length && liveDerived) {
      throw new Error('postex_orders returned no parcels while ' + liveDerived + ' derived documents exist — nothing was written or voided');
    }
    const next = core.maCourierDocs(der, s);
    const lockedQ = q => data.closes.some(x => x && x.quarter === q && x.locked === true && !x.reopenedAt);
    const coll = data.collections.map(d => Object.assign({ dt: 'collection' }, d));
    const plan = core.maCourierPlan(data.cpr, next, { at: nowMs, locked: lockedQ, docs: coll });
    let checks = null;
    try { checks = check1120(data, plan, der); } catch (e) { checks = { error: clip((e && e.message) || e, 200) }; }

    const skipped = plan.skipped;
    const run = {
      id: 'rollup', state: 'done', ok: true, at: nowMs, day: today, from, trigger,
      triggeredBy: o.triggeredBy || null, by: core.MA_ROLLUP_BY,
      parcels: data.parcels.length, documents: next.length,
      created: plan.created, updated: plan.updated, voided: plan.voided, unchanged: plan.unchanged,
      skippedCount: skipped.length, skipped: skipped.slice(0, SKIPPED_KEPT),
      transit: der.transit, opening: der.opening,
      excluded: { receipts: der.excluded.receipts, parcels: der.excluded.parcels, net: der.excluded.net, first: der.excluded.first, last: der.excluded.last },
      issueCount: der.issues.length,
      issues: der.issues.slice(0, ISSUES_KEPT).map(i => ({ rule: i.rule, message: clip(i.message, 400) })),
      checks
    };
    const detail = 'Done — ' + [plan.created + ' created', plan.updated + ' updated', plan.voided + ' voided', plan.unchanged + ' unchanged',
      skipped.length + ' skipped'].join(', ') + ' · ' + data.parcels.length + ' parcels' + (o.triggeredBy ? ' · run by ' + o.triggeredBy : '');

    // The writes in batches of at most BATCH_MAX; the run document and its
    // audit row ride in the LAST one (their own if it is full).
    const writes = plan.writes.slice();
    const chunks = [];
    while (writes.length) chunks.push(writes.splice(0, BATCH_MAX));
    if (!chunks.length || chunks[chunks.length - 1].length > BATCH_MAX - 2) chunks.push([]);
    for (let i = 0; i < chunks.length; i++) {
      const b = db.batch();
      chunks[i].forEach(w => b.set(db.collection('ma_cpr').doc(w.id), clean(w.doc)));
      if (i === chunks.length - 1) {
        b.set(runRef, clean(Object.assign(run, { batches: chunks.length })));
        b.set(auditRef(), audit(clip(detail, 300)));
      }
      await b.commit();
      report.batches++;
    }
    Object.assign(report, { created: plan.created, updated: plan.updated, voided: plan.voided, unchanged: plan.unchanged, skipped: skipped.length, state: 'done' });
    return report;
  } catch (e) {
    const error = clip((e && e.message) || e, 500).replace(/[\s.]+$/, '');
    report.state = 'failed'; report.error = error;
    const b = db.batch();
    b.set(runRef, clean({ id: 'rollup', state: 'failed', ok: false, at: nowMs, day: today, trigger, triggeredBy: o.triggeredBy || null, by: core.MA_ROLLUP_BY, error,
      written: { created: report.created, updated: report.updated, voided: report.voided }, batches: report.batches }));
    b.set(auditRef(), audit(clip('Failed — ' + error, 300)));
    await b.commit();
    return report;
  }
}

exports.handler = async function () {
  if (!lib.serviceAccount(process.env)) {
    console.error('[ma-rollup] FIREBASE_SERVICE_ACCOUNT is missing or unreadable — nothing was derived and nothing could be recorded.');
    return { statusCode: 503, body: JSON.stringify({ error: 'not configured' }) };
  }
  try {
    const app = lib.getAdmin();
    const report = await runRollup({ db: app.firestore(), nowMs: Date.now() });
    console.log('[ma-rollup]', JSON.stringify(report));
    return { statusCode: report.state === 'done' ? 200 : 500, body: JSON.stringify({ ok: report.state === 'done', report }) };
  } catch (e) {
    console.error('[ma-rollup] failed and could not record it', (e && e.stack) || e);
    return { statusCode: 500, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  }
};
exports.runRollup = runRollup;
exports._test = { runRollup, karachiDay, PARCEL_FIELDS, BATCH_MAX };

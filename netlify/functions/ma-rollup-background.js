// ── Master Accounts: the nightly courier rollup (M2) ──────────────────────
// Turns PostEx parcels (postex_orders) into the courier documents the books
// post from: a `day` per delivery day, the `opening`, and one document per
// PostEx receipt, all in ma_cpr with derived:true (js/ma-core.js, "The
// derived documents"). THIS FILE DECIDES NOTHING ABOUT ACCOUNTING: every
// figure comes from maCprDerive, every document from maCourierDocs and every
// merge/void/lock decision from maCourierMerge / maCourierGone (maCourierPlan
// is the up-front plan); the 1120 check is maCourier1120Check. It reads,
// calls those, and writes what they say.
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
//
// WRITES — THE PLAN IS MADE UP FRONT, AND NOTHING IN IT IS TRUSTED AT WRITE TIME.
//        The run reads everything once, derives and plans; that takes seconds,
//        and an owner records a collection, opens a dispute or closes a quarter
//        in the meantime. Writing the plan's documents as they stood would
//        overwrite that (M2 review, S3: a receipt collected mid-run was voided
//        anyway; a dispute opened mid-run was erased). So:
//        · A CREATE is a create() in a batch of at most 400 — it refuses a
//          document that has appeared since the read. A batch that is refused
//          for that reason wrote nothing (all-or-nothing) and is taken again
//          one document at a time through the transactional path below, where
//          what is there now is merged with, never replaced.
//        · Every UPDATE and every VOID is its OWN transaction over the document
//          as it is NOW: it reads the document, the quarter locks (ma_closes)
//          and — for a void — the claim ma_claims/{id} and the collections that
//          name it, decides again with the core (maCourierMerge / maCourierGone,
//          the same functions the plan used) and writes only that. The owner's
//          fields on the document (a review, a dispute, the dispute history)
//          come from that fresh read, never from the plan. Nothing is decided
//          outside the transaction and carried in: a body that runs twice reads
//          twice.
//        · A document a live collection covers is NEVER voided, and neither is
//          one a live claim covers. "A live claim" is ma_claims/{id} with no
//          releasedAt whose `collection` names a collection that exists and is
//          not void. The refusal is reported twice: in `skipped` (why:
//          'collected') and as a run issue (rollup.collected), so PostEx data
//          issues on the Money in page name it — cash was collected against a
//          receipt PostEx no longer reports, and an owner has to look.
//        · The run document ma_runs/rollup and ONE ma_audit row {action:
//          'rollup', by:'ma-rollup'} are written LAST, in a batch of their own,
//          and say what was actually done: created / updated / voided count
//          what committed, `unchanged` includes a document the fresh read found
//          already right, `skipped` includes what the write-time read refused.
//          Nothing is ever deleted; nothing typed (derived not true) is ever
//          touched; nothing in a locked quarter is written.
//        A failure replaces the run document with {state:'failed', error,
//        written:{created,updated,voided}, inDoubt, batches, transactions} and
//        still writes its audit row. `written` is what committed before it
//        stopped (the M2 review's partial-run finding: it used to read all
//        zeros after 400 documents were in); `inDoubt` is how many writes were
//        in flight when a commit failed for a reason that does not say whether
//        it applied (a timeout) — up to that many more may exist.
//        Transactions run one after another, on purpose: they touch different
//        documents, the night's changes are few, and a run that is slow is a
//        run that reads the owners' work more freshly, not less.
// REFUSES to write (fails the run) when the derivation cannot be trusted:
//        bad options (would void everything), or postex_orders answering
//        with no parcels at all while derived documents exist.
// Concurrency: two runs at once (the schedule and an owner's button) derive
//        the same documents from the same parcels. Each write reads the
//        document as the other run left it, finds it already right and counts
//        it unchanged — a rev is bumped once, not twice. No lock document — a
//        crash would leave it stuck.
// WHAT COVERS WHAT. Verified by reading the source of @google-cloud/firestore
//        7.11.6 (what firebase-admin 13.10.0 resolves to) and by running this
//        file's write path against the Firestore EMULATOR with that client
//        (tests/rollup-emulator.js) — NOT against production Firestore:
//        · Transaction.get takes a document or a query, several reads may run
//          at once, and a read after a write is refused; a transaction body is
//          run again (five attempts) when Firestore aborts it. All as used here.
//        · The SDK documents its lock as "a pessimistic lock on all returned
//          documents": what a transaction READ is held until it commits. Here
//          that is the receipt — the collection form reads it and the void
//          writes it, so the two cannot both commit against the state each saw
//          — and its claim ma_claims/{receipt}. For a query the same words
//          cover the documents it RETURNED; nothing there promises to keep a
//          collection recorded after the query out until the commit. So the
//          receipt and its claim carry the guarantee against a collection
//          recorded while a void runs (the collection form reads the receipt
//          and writes the claim in the same transaction as the collection —
//          the page side of M2 review S3, not in this file), and the query is
//          what covers the collections recorded before claims existed: they
//          exist, so the query returns them.
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
  'orderPickupDate', 'orderDeliveryDate', 'transactionDate', 'settle', 'cprCheckedAt', 'cprConflict', 'syncedAt'
];
// The fields an owner writes on a derived document. A rewrite from the fresh
// read never drops one the core's merge left out (the dispute history,
// `disputes`, is not in MA_DERIVED_OWNER_FIELDS today; it costs nothing to keep it).
const OWNER_KEEP = Array.from(new Set(['dispute', 'disputes'].concat(core.MA_DERIVED_OWNER_FIELDS || [])));
// What maCourierMerge carries across a rewrite by itself (its own keep list): the
// review and the dispute. The rest of OWNER_KEEP is taken out of the copy the
// merge compares, so its history row never says PostEx changed a field an owner
// wrote, and put back from the document as read (keepOwner).
const MERGE_KEEPS = ['reviewedAt', 'reviewedBy', 'dispute'];

const pad = n => String(n).padStart(2, '0');
// Pakistan is UTC+5 all year. → 'YYYY-MM-DD'.
function karachiDay(ms) {
  const d = new Date(ms + 5 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
const clip = (s, n) => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 300);
const clean = o => JSON.parse(JSON.stringify(o));   // Firestore refuses undefined
const rows = snap => snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
// firebase-admin: a create() on a document that exists is gRPC 6, ALREADY_EXISTS.
const alreadyExists = e => !!e && (e.code === 6 || e.code === 'already-exists' || /ALREADY_EXISTS/.test(String(e.message || '')));

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

// A quarter is locked while its close says so and it has not been reopened.
const lockedIn = closes => q => closes.some(x => x && x.quarter === q && x.locked === true && !x.reopenedAt);

// The 1120 check needs the books' lines after this run's writes: the courier
// documents as they stood at the start, with what was ACTUALLY written laid over.
function check1120(data, applied, der) {
  const next = {};
  data.cpr.forEach(d => { next[d.id] = d; });
  Object.keys(applied).forEach(id => { next[id] = applied[id]; });
  const idx = core.maChartIndex(core.maChart('groovy', data.accounts));
  const docs = []
    .concat(data.journal.map(d => Object.assign({ dt: 'journal' }, d)), data.transfer.map(d => Object.assign({ dt: 'transfer' }, d)),
      data.counts.map(d => Object.assign({ dt: 'count' }, d)), Object.keys(next).map(k => Object.assign({ dt: 'cpr' }, next[k])),
      data.collections.map(d => Object.assign({ dt: 'collection' }, d)));
  const lines = core.maPostAll(docs, idx, data.settings);
  return core.maCourier1120Check(lines, idx, der);
}

// A void PostEx no longer justifies but a collection stands behind: kept, and named.
function collectedIssue(no, by) {
  const names = (by || []).filter(Boolean).map(String);
  const who = names.length ? (names.length > 1 ? 'collections ' : 'collection ') + names.join(', ') : 'a collection';
  return {
    rule: 'rollup.collected',
    message: clip('PostEx no longer reports ' + no + ', but ' + who + ' covers it, so it was NOT voided. Check with PostEx, or void ' +
      (names.length > 1 ? 'those collections' : 'that collection') + ' first.', 400)
  };
}

// A rewrite of a document from what is stored NOW keeps whatever an owner
// wrote on it that the core's merge did not carry across.
function keepOwner(stored, doc) {
  if (!stored) return doc;
  OWNER_KEEP.forEach(k => { if (stored[k] !== undefined && doc[k] === undefined) doc[k] = JSON.parse(JSON.stringify(stored[k])); });
  return doc;
}

// ONE plan write as its own transaction, over the documents as they are now.
// `next` is the rollup's new document for the id (absent for a void). Returns
// what happened — it is read only AFTER the transaction resolved, because the
// body may run more than once. Every read comes before the write.
async function applyOne(db, w, next, nowMs) {
  const ref = db.collection('ma_cpr').doc(w.id);
  const isVoid = w.action === 'void';
  return db.runTransaction(async tx => {
    const reads = [tx.get(ref), tx.get(db.collection('ma_closes'))];
    if (isVoid) {
      reads.push(tx.get(db.collection('ma_claims').doc(w.id)));
      reads.push(tx.get(db.collection('ma_collection').where('refs.cprNos', 'array-contains', w.id)));
    }
    const got = await Promise.all(reads);
    const stored = got[0].exists ? Object.assign({ id: got[0].id }, got[0].data()) : null;
    const meta = { at: nowMs, locked: lockedIn(rows(got[1])) };
    if (!isVoid) {
      const forMerge = stored ? Object.assign({}, stored) : null;
      if (forMerge) OWNER_KEEP.filter(k => MERGE_KEEPS.indexOf(k) < 0).forEach(k => { delete forMerge[k]; });
      const r = core.maCourierMerge(forMerge, next, meta);
      if (r.action === 'none') return { kind: 'unchanged' };
      if (r.action === 'skip') return { kind: 'skipped', why: r.why, quarter: r.quarter || null };
      const doc = keepOwner(stored, clean(r.doc));
      if (r.action === 'create') tx.create(ref, doc); else tx.set(ref, doc);
      return { kind: r.action === 'create' ? 'created' : 'updated', doc };
    }
    // A void: a live collection, or a live claim, covers the receipt → it stays.
    const claim = got[2].exists ? got[2].data() : null;
    // A claim protects only while it names a collection that exists and is not void. A claim that names
    // something that cannot even be an id (Firestore refuses a path like "a/b") names no collection.
    let claimRef = null;
    if (claim && !claim.releasedAt && typeof claim.collection === 'string' && claim.collection) {
      try { claimRef = db.collection('ma_collection').doc(claim.collection); } catch (e) { claimRef = null; }
    }
    const claimed = claimRef ? await tx.get(claimRef) : null;
    const live = rows(got[3]).filter(d => d.status !== 'void').map(d => Object.assign({ dt: 'collection' }, d));
    const claimLive = !!(claimed && claimed.exists && claimed.data().status !== 'void');
    const by = live.map(d => d.no || d.id);
    if (claimLive && by.indexOf(claim.collection) < 0) by.push(claim.collection);
    const g = core.maCourierGone(stored, Object.assign({ docs: live }, meta));
    if (g.action === 'none') return { kind: 'unchanged' };
    if (g.action === 'skip') return { kind: 'skipped', why: g.why, quarter: g.quarter || null, no: stored.no || stored.id, by };
    if (claimLive) return { kind: 'skipped', why: 'collected', quarter: null, no: stored.no || stored.id, by };
    const doc = clean(g.doc);
    tx.set(ref, doc);
    return { kind: 'voided', doc };
  });
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
  // What actually committed, counted as it happens — the failure record reads
  // this too, so a run that stops half way says how far it got.
  const tally = { created: 0, updated: 0, voided: 0, unchanged: 0, skipped: [], refusals: [], applied: {}, batches: 0, transactions: 0, inDoubt: 0 };
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
    const nextById = {};
    next.forEach(n => { nextById[n.id] = n; });
    const coll = data.collections.map(d => Object.assign({ dt: 'collection' }, d));
    const plan = core.maCourierPlan(data.cpr, next, { at: nowMs, locked: lockedIn(data.closes), docs: coll });
    // A receipt PostEx dropped that a collection stands behind is refused by the
    // plan itself; say so as an issue, like the same refusal at write time.
    plan.skipped.filter(x => x.why === 'collected').forEach(x => {
      const sd = data.cpr.find(d => d.id === x.id) || {};
      tally.refusals.push(collectedIssue(sd.no || x.id, core.maCollectionsOf(coll, x.id).map(c => c.no || c.id)));
    });

    const cprRef = id => db.collection('ma_cpr').doc(id);
    // Anything one at a time, through the transaction, once its batch was refused
    // or for an update / void.
    const one = async w => {
      let out;
      try { out = await applyOne(db, w, nextById[w.id], nowMs); } catch (e) { tally.inDoubt += 1; throw e; }
      if (out.kind === 'created') { tally.created++; tally.transactions++; tally.applied[w.id] = out.doc; }
      else if (out.kind === 'updated') { tally.updated++; tally.transactions++; tally.applied[w.id] = out.doc; }
      else if (out.kind === 'voided') { tally.voided++; tally.transactions++; tally.applied[w.id] = out.doc; }
      else if (out.kind === 'unchanged') tally.unchanged++;
      else {
        tally.skipped.push({ id: w.id, why: out.why, quarter: out.quarter || null });
        if (out.why === 'collected') tally.refusals.push(collectedIssue(out.no || w.id, out.by));
      }
    };

    // 1. The creates, in batches of at most BATCH_MAX: create() refuses what is already there.
    const creates = plan.writes.filter(w => w.action === 'create');
    for (let i = 0; i < creates.length; i += BATCH_MAX) {
      // A quarter closed since the read is not written into: ask again, just before the batch.
      const lockedNow = lockedIn(rows(await db.collection('ma_closes').get()));
      const chunk = [];
      creates.slice(i, i + BATCH_MAX).forEach(w => {
        if (w.doc.quarter && lockedNow(w.doc.quarter)) tally.skipped.push({ id: w.id, why: 'locked', quarter: w.doc.quarter });
        else chunk.push(w);
      });
      if (!chunk.length) continue;
      const b = db.batch();
      chunk.forEach(w => b.create(cprRef(w.id), clean(w.doc)));
      try {
        await b.commit();
      } catch (e) {
        if (!alreadyExists(e)) { tally.inDoubt += chunk.length; throw e; }
        // Something appeared at one of these ids since the read. Nothing was written (a batch is
        // all-or-nothing): each document now goes through the transaction, which merges with what is there.
        for (const w of chunk) await one(w);
        continue;
      }
      tally.batches++;
      chunk.forEach(w => { tally.created++; tally.applied[w.id] = w.doc; });
    }
    // 2. The updates and the voids, each its own transaction, in the plan's order.
    for (const w of plan.writes.filter(x => x.action !== 'create')) await one(w);

    // 3. The run document and its audit row, last, saying what was done.
    let checks = null;
    try { checks = check1120(data, tally.applied, der); } catch (e) { checks = { error: clip((e && e.message) || e, 200) }; }
    const skipped = plan.skipped.concat(tally.skipped);
    const unchanged = plan.unchanged + tally.unchanged;
    const issues = tally.refusals.concat(der.issues.map(i => ({ rule: i.rule, message: clip(i.message, 400) })));
    const run = {
      id: 'rollup', state: 'done', ok: true, at: nowMs, day: today, from, trigger,
      triggeredBy: o.triggeredBy || null, by: core.MA_ROLLUP_BY,
      parcels: data.parcels.length, documents: next.length,
      created: tally.created, updated: tally.updated, voided: tally.voided, unchanged,
      skippedCount: skipped.length, skipped: skipped.slice(0, SKIPPED_KEPT),
      transit: der.transit, opening: der.opening,
      excluded: { receipts: der.excluded.receipts, parcels: der.excluded.parcels, net: der.excluded.net, first: der.excluded.first, last: der.excluded.last },
      issueCount: issues.length,
      issues: issues.slice(0, ISSUES_KEPT),
      checks,
      batches: tally.batches + 1, transactions: tally.transactions
    };
    const detail = 'Done — ' + [tally.created + ' created', tally.updated + ' updated', tally.voided + ' voided', unchanged + ' unchanged',
      skipped.length + ' skipped'].join(', ') + ' · ' + data.parcels.length + ' parcels' + (o.triggeredBy ? ' · run by ' + o.triggeredBy : '');
    const fin = db.batch();
    fin.set(runRef, clean(run));
    fin.set(auditRef(), audit(clip(detail, 300)));
    await fin.commit();
    tally.batches++;
    Object.assign(report, { created: tally.created, updated: tally.updated, voided: tally.voided, unchanged, skipped: skipped.length,
      batches: tally.batches, transactions: tally.transactions, state: 'done' });
    return report;
  } catch (e) {
    const error = clip((e && e.message) || e, 500).replace(/[\s.]+$/, '');
    Object.assign(report, { created: tally.created, updated: tally.updated, voided: tally.voided, batches: tally.batches,
      transactions: tally.transactions, inDoubt: tally.inDoubt, state: 'failed', error });
    const done = tally.created + tally.updated + tally.voided;
    const tail = done || tally.inDoubt
      ? ' — ' + tally.created + ' created, ' + tally.updated + ' updated, ' + tally.voided + ' voided before it stopped' + (tally.inDoubt ? ', up to ' + tally.inDoubt + ' more in doubt' : '')
      : '';
    const b = db.batch();
    b.set(runRef, clean({ id: 'rollup', state: 'failed', ok: false, at: nowMs, day: today, trigger, triggeredBy: o.triggeredBy || null, by: core.MA_ROLLUP_BY, error,
      written: { created: tally.created, updated: tally.updated, voided: tally.voided }, inDoubt: tally.inDoubt, batches: tally.batches, transactions: tally.transactions }));
    b.set(auditRef(), audit(clip('Failed — ' + clip(error, 180) + tail, 300)));
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

/* ─────────────────────────────────────────────────────────────────────────
   tests/rollup-emulator.js — the nightly courier rollup's WRITE PATH, run with
   the REAL Firestore client against the Firestore EMULATOR (M2 review, S3).

   Not a *.test.js: it needs firebase-admin, firebase-tools, the emulator and
   Java, and CI installs nothing (tests/ma-rollup.test.js is the CI suite, over
   an in-memory Firestore, tests/ma-fake-admin.js). What this adds is what a
   fake cannot say: that the calls the function makes are legal in the real
   client — every read before every write in a transaction, tx.get(query),
   tx.create, batch.create refused with code 6 (ALREADY_EXISTS) and recognised
   as that, no undefined field in a document — and that the outcomes hold:
   an owner's dispute, review, collection, claim or quarter close that lands
   just before the run writes is honoured; a run that fails part-way says what
   it had written.

   Run it by hand whenever ma-rollup-background.js changes:
     mkdir -p /tmp/emu && cd /tmp/emu && npm init -y >/dev/null && npm install firebase-tools@13
     mkdir -p /tmp/adm && cd /tmp/adm && npm init -y >/dev/null && npm install firebase-admin@13.10.0
     mkdir -p /tmp/rollup-emu && cd /tmp/rollup-emu
     echo '{"firestore":{"rules":"firestore.rules"},"emulators":{"firestore":{"port":8181},"ui":{"enabled":false}}}' > firebase.json
     echo "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }" > firestore.rules
     ADM=/tmp/adm NODE_PATH=/tmp/adm/node_modules \
       /tmp/emu/node_modules/.bin/firebase emulators:exec --only firestore \
       --project demo-rollup "node <repo>/tests/rollup-emulator.js"
   (a scratch directory, because the emulator writes firestore-debug.log into
   the directory it runs from). A demo- project id and the emulator host keep
   it offline: nothing here can reach groovy-gatepass, and the script refuses to
   start without FIRESTORE_EMULATOR_HOST.

   Every scenario lands the owner's write BEFORE the run's first transaction or
   batch commit, which is deterministic. What the emulator does when a write
   lands BETWEEN a transaction's reads and its commit is the emulator's own
   behaviour, not production's; that retry is exercised in the fake instead
   (five attempts, as the SDK's DEFAULT_MAX_TRANSACTION_ATTEMPTS). Production's
   locking is not tested here: what a session cannot check is how live
   Firestore orders two transactions that touch the same documents.
   Run against the pre-fix function (7e41206) 14 of these 26 checks fail.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const path=require('path');
// The real client: firebase-admin's Firestore. ADM = the directory holding node_modules/firebase-admin (default: resolve it
// from where node looks, i.e. NODE_PATH). Nothing below runs without the emulator — it DELETES whole collections first.
if(!process.env.FIRESTORE_EMULATOR_HOST||!/^(127\.0\.0\.1|localhost|\[?::1\]?)(:|$)/.test(process.env.FIRESTORE_EMULATOR_HOST)){
  console.error('refusing to run: FIRESTORE_EMULATOR_HOST is not set to a local emulator (this script wipes collections)');process.exit(2);
}
const W=path.join(__dirname,'..');
const ADM=process.env.ADM;
const {Firestore}=ADM?require(path.join(ADM,'node_modules/@google-cloud/firestore')):require('@google-cloud/firestore');
const db=new Firestore({projectId:'demo-rollup'});
const mod=require(W+'/netlify/functions/ma-rollup-background.js');
const core=require(W+'/js/ma-core.js');
const S=core.maSettings(null),IDX=core.maChartIndex(core.maChart('groovy',[]));
const NOW=Date.UTC(2026,9,20,5,0,0),TODAY='2026-10-20';
let seq=0;
const px=o=>{seq++;return Object.assign({trackingNumber:'PX'+String(seq).padStart(5,'0'),statusCategory:'delivered',dispatched:true,
  transactionDate:'2026-09-01T11:20:00',orderPickupDate:'2026-09-02T09:05:00',orderDeliveryDate:'2026-09-04T16:40:00',
  cod:3000,transactionFee:180,transactionTax:28.8,reversalFee:0,reversalTax:0,upfrontPayment:0,reservePayment:0,balancePayment:0,
  cprNumber_1:'',cprNumber_2:'',cityName:'Lahore',orderDetail:'GST073-M',merchantName:'GROOVY',syncedAt:1790000000000},o);};
const parcels=()=>{seq=0;return [
  px({trackingNumber:'A1',cprNumber_1:'U100',cpr1Date:'2026-09-05',upfrontPayment:2000,cprNumber_2:'R200',cpr2Date:'2026-09-12',reservePayment:791.2,settle:true}),
  px({trackingNumber:'A2',cod:1500,transactionFee:150,transactionTax:24,cprNumber_1:'U100',cpr1Date:'2026-09-05',upfrontPayment:1000}),
  px({trackingNumber:'B1',orderDeliveryDate:'2026-09-10T12:00:00'}),
  px({trackingNumber:'C1',statusCategory:'returned',cod:0,transactionFee:0,transactionTax:0,reversalFee:100,reversalTax:16,orderDeliveryDate:'2026-09-15T12:00:00'}),
  px({trackingNumber:'D1',orderDeliveryDate:'2026-06-20T12:00:00',cprNumber_1:'U050',cpr1Date:'2026-06-30',upfrontPayment:2000}),
  px({trackingNumber:'Z1',orderDeliveryDate:'2026-09-20T12:00:00',cprNumber_1:'U900',cpr1Date:'2026-09-25',upfrontPayment:2000})];};
let pass=0,fail=0;
const check=(name,ok,detail)=>{if(ok)pass++;else fail++;console.log((ok?'  ok   ':'  FAIL ')+name+(ok?'':'   → '+(typeof detail==='string'?detail:JSON.stringify(detail))));};
// canonical: Firestore maps have no key order, and the emulator hands them back in its own
const J=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).sort().reduce((o,k2)=>{o[k2]=x[k2];return o;},{}):x);
async function wipe(){
  for(const c of ['ma_cpr','ma_collection','ma_claims','ma_closes','ma_runs','ma_audit','ma_settings','ma_accounts','ma_journal','ma_transfer','ma_counts','postex_orders']){
    const snap=await db.collection(c).get();
    if(!snap.empty){const b=db.batch();snap.docs.forEach(d=>b.delete(d.ref));await b.commit();}
  }
}
async function putParcels(list){
  const snap=await db.collection('postex_orders').get();
  const b=db.batch();snap.docs.forEach(d=>b.delete(d.ref));
  list.forEach((p,i)=>b.set(db.collection('postex_orders').doc(p.trackingNumber+'-'+i),p));await b.commit();
}
const get=async p=>{const d=await db.doc(p).get();return d.exists?d.data():undefined;};
const ids=async c=>(await db.collection(c).get()).docs.map(d=>d.id).sort();
const runOnce=(now,o)=>mod.runRollup(Object.assign({db,nowMs:now||NOW},o||{}));
// a db whose first transaction / batch commit is preceded by `fn` (the owner's write)
const withHook=(fn)=>{
  let done=false;const go=async()=>{if(!done){done=true;await fn();}};
  const w=Object.create(db);
  w.runTransaction=async(f,o)=>{await go();return db.runTransaction(f,o);};
  w.batch=()=>{const b=db.batch();const c=b.commit.bind(b);b.commit=async()=>{await go();return c();};return b;};
  return w;
};
(async()=>{
  const P=parcels(),EXP=core.maCourierDocs(core.maCprDerive(P,{from:S.couriers.from,today:TODAY}),S);
  const collectionOf=async(gone,over)=>{
    const cprs=(await db.collection('ma_cpr').get()).docs.map(d=>Object.assign({dt:'cpr'},d.data()));
    const rc=cprs.find(c=>c.id===gone);
    const d=core.maBuildDoc('collection',{courier:'postex',holder:'1011',amount:rc.amount,date:'2026-10-20',cprNos:[gone]},{by:'afnan',byName:'Afnan',ts:NOW,cprs},IDX,S);
    d.no=d.id='CL-27-0001';return Object.assign(d,over||{});
  };

  console.log('\n1. a first run: creates in batches (batch.create), then the run document and audit row');
  await wipe();await putParcels(P);
  let rep=await runOnce();
  check('the run is done',rep.state==='done',rep);
  check('every document the core builds was created',J(await ids('ma_cpr'))===J(EXP.map(d=>d.id).sort()),J(await ids('ma_cpr')));
  const r1=await get('ma_runs/rollup');
  check('the run document says done, with the counts',J([r1.state,r1.created,r1.updated,r1.voided])===J(['done',EXP.length,0,0]),r1);
  check('one audit row, by ma-rollup',(await db.collection('ma_audit').get()).size===1);

  console.log('\n2. a second run over the same parcels writes no ma_cpr document');
  const before={};for(const id of await ids('ma_cpr'))before[id]=await get('ma_cpr/'+id);
  rep=await runOnce(NOW+3600000);
  const after={};for(const id of await ids('ma_cpr'))after[id]=await get('ma_cpr/'+id);
  check('nothing changed, nothing counted as written',J(before)===J(after)&&rep.created===0&&rep.updated===0&&rep.voided===0&&rep.unchanged===EXP.length,rep);
  check('no transaction was needed',rep.transactions===0,rep);

  console.log('\n3. a changed parcel: each update is a transaction of its own (reads before writes, in the real client)');
  const P2=JSON.parse(J(P));P2.find(p=>p.trackingNumber==='A1').cod=3500;await putParcels(P2);
  const want=core.maCourierDocs(core.maCprDerive(P2,{from:S.couriers.from,today:TODAY}),S).filter(d=>{const o=EXP.find(x=>x.id===d.id);return !o||o.sig!==d.sig;}).map(d=>d.id).sort();
  rep=await runOnce(NOW+7200000);
  check('the run is done and counted every changed document',rep.state==='done'&&rep.updated===want.length&&want.length>=2,[rep,want]);
  let ok=true;for(const id of want){const d=await get('ma_cpr/'+id);if(!d||d.rev!==2||d.edits.length!==1)ok=false;}
  check('each changed document went to rev 2 with one history row',ok);
  check('one transaction per update',rep.transactions===want.length,rep);

  console.log('\n4. an owner\'s dispute and review made just before the update are kept (fresh read inside the transaction)');
  const dayId=want.find(x=>/day/.test(x))||want[0];
  const P3=JSON.parse(J(P2));P3.find(p=>p.trackingNumber==='A1').cod=3600;await putParcels(P3);
  const dispute={state:'open',reason:'PostEx paid less',by:'afnan',at:NOW+1},hist=[{state:'open',by:'afnan',at:NOW+1}];
  rep=await runOnce(NOW+9000000,{db:withHook(async()=>{await db.doc('ma_cpr/'+dayId).set({dispute,disputes:hist,reviewedAt:9,reviewedBy:'afnan'},{merge:true});})});
  const dd=await get('ma_cpr/'+dayId);
  check('the dispute and its history are still there, the rev went up',J([dd.dispute,dd.disputes,dd.rev])===J([dispute,hist,3]),dd);
  check('the review of the old figures was cleared (a figure moved)',dd.reviewedAt===null&&dd.reviewedBy===null,[dd.reviewedAt,dd.reviewedBy]);
  check('its history row does not claim PostEx changed the dispute history',!(dd.edits[dd.edits.length-1].fields||[]).includes('disputes'),dd.edits[dd.edits.length-1]);

  const voidScenario=async(label,seed,expectKept)=>{
    await wipe();await putParcels(P);await runOnce();
    await putParcels(P.filter(p=>p.trackingNumber!=='Z1'));
    const hook=withHook(async()=>{await seed();});
    const r=await runOnce(NOW+3600000,{db:hook});
    const rc=await get('ma_cpr/postex-U900'),run=await get('ma_runs/rollup');
    if(expectKept){
      check(label+': the receipt is NOT voided',rc.status==='posted',rc.status);
      check('… reported skipped as collected, and raised as an issue',(run.skipped||[]).some(x=>x.id==='postex-U900'&&x.why==='collected')&&(run.issues||[]).some(i=>i.rule==='rollup.collected'),[run.skipped,run.issues]);
    }else{
      check(label+': the receipt IS voided',rc.status==='void'&&r.voided===2,[rc.status,r.voided]);
    }
  };
  console.log('\n5. a void decided over the document as it is NOW');
  await voidScenario('a collection that lists the receipt (the query, inside the transaction)',async()=>{await db.doc('ma_collection/CL-27-0001').set(await collectionOf('postex-U900'));},true);
  await voidScenario('a claim naming a live collection that lists nothing',async()=>{await db.doc('ma_collection/CL-27-0001').set(await collectionOf('postex-U900',{refs:{cprNos:[]}}));await db.doc('ma_claims/postex-U900').set({doc:'postex-U900',collection:'CL-27-0001',at:NOW,by:'afnan'});},true);
  await voidScenario('a released claim',async()=>{await db.doc('ma_collection/CL-27-0001').set(await collectionOf('postex-U900',{refs:{cprNos:[]}}));await db.doc('ma_claims/postex-U900').set({doc:'postex-U900',collection:'CL-27-0001',at:NOW,by:'afnan',releasedAt:NOW});},false);
  await voidScenario('a claim with no collection',async()=>{await db.doc('ma_claims/postex-U900').set({doc:'postex-U900',collection:null,at:NOW,by:'afnan'});},false);
  await voidScenario('nothing recorded',async()=>{},false);

  console.log('\n6. a create batch that meets documents which appeared since the read (ALREADY_EXISTS, code 6) is retried through transactions');
  await wipe();await putParcels(P);
  const A=EXP.find(d=>d.id==='postex-day-2026-09-04'),B=EXP.find(d=>d.id==='postex-U100'),C=EXP.find(d=>d.id==='postex-R200');
  const aStored=Object.assign({},A,{ts:NOW-1000}),bStored=Object.assign({},B,{ts:NOW-1000,note:'stale',sig:'older',reviewedAt:77,reviewedBy:'ammar',dispute:{state:'open',reason:'r',by:'ammar',at:1},disputes:[{state:'open',by:'ammar',at:1}]});
  const cTyped={id:C.id,dt:'cpr',kind:'reserve',status:'posted',date:'2026-09-12',net:7,note:'an owner typed this',derived:false};
  rep=await runOnce(NOW,{db:withHook(async()=>{await db.doc('ma_cpr/'+A.id).set(aStored);await db.doc('ma_cpr/'+B.id).set(bStored);await db.doc('ma_cpr/'+C.id).set(cTyped);})});
  check('the run is done: created / updated / unchanged / skipped follow what was written',J([rep.state,rep.created,rep.updated,rep.unchanged,rep.skipped])===J(['done',EXP.length-3,1,1,1]),rep);
  check('the document another run wrote is left as it is',J(await get('ma_cpr/'+A.id))===J(aStored));
  const bb=await get('ma_cpr/'+B.id);
  check('the reviewed and disputed document was brought up to date with both kept',J([bb.rev,bb.note,bb.reviewedAt,bb.dispute,bb.disputes])===J([2,'',77,bStored.dispute,bStored.disputes]),bb);
  check('the typed document is untouched',J(await get('ma_cpr/'+C.id))===J(cTyped));

  console.log('\n7. a quarter closed after the plan is not written into');
  await wipe();await putParcels(P);await runOnce();
  const q=EXP.find(d=>d.kind==='day').quarter;
  await putParcels(P2);
  const beforeDay=await get('ma_cpr/'+dayId);
  rep=await runOnce(NOW+3600000,{db:withHook(async()=>{await db.doc('ma_closes/'+q).set({id:q,quarter:q,locked:true});})});
  check('a document in the closed quarter was not written, and is reported skipped (locked)',J(await get('ma_cpr/'+dayId))===J(beforeDay)&&(await get('ma_runs/rollup')).skipped.some(x=>x.id===dayId&&x.why==='locked'),rep);

  console.log('\n8. a run that fails part-way says what it wrote (the second create batch fails with DEADLINE_EXCEEDED)');
  await wipe();
  const many=[];for(let i=0;i<450;i++)many.push(px({trackingNumber:'W'+i,orderDeliveryDate:'2026-09-10T12:00:00',cprNumber_1:'V'+i,cpr1Date:'2026-09-15',upfrontPayment:1000}));
  await putParcels(many);
  let commits=0;
  const flaky=Object.create(db);flaky.batch=()=>{const b=db.batch();const c=b.commit.bind(b);b.commit=async()=>{commits++;if(commits===2)throw Object.assign(new Error('DEADLINE_EXCEEDED'),{code:4});return c();};return b;};
  rep=await runOnce(NOW,{db:flaky});
  const run8=await get('ma_runs/rollup');
  check('failed, with 400 documents really written',rep.state==='failed'&&(await ids('ma_cpr')).length===400,[rep.state,(await ids('ma_cpr')).length]);
  check('the run document says written.created 400 and how many were in doubt',run8.written.created===400&&run8.inDoubt>0&&run8.batches===1,run8);

  console.log('\n'+(fail?fail+' FAILED, ':'all ')+pass+' passed');
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});

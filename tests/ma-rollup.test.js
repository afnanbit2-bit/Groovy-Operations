/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts M2 — the nightly courier rollup
   (netlify/functions/ma-rollup-background.js and ma-rollup-now-background.js)

   The functions against an in-memory Firestore (tests/ma-fake-admin.js) and
   scripted PostEx parcels. What is held: a first run creates the documents
   the core builds; a second run over the same parcels writes only the run
   document and its audit row; a changed parcel updates exactly the affected
   documents and bumps rev; a review is kept unless a figure moved; a locked
   quarter is skipped and reported; a typed statement is never touched; a
   document PostEx stops producing is voided, unless a live collection covers
   it; batches never exceed 400 and the run document rides in the last one;
   a failure writes state:'failed'; the Karachi day; the on-demand wrapper's
   owner gate; that every parcel field the core reads is in the .select().
   Every accounting decision is the core's (maCprDerive / maCourierDocs /
   maCourierPlan) — expected values here are that same core run directly, so
   this suite proves the function READS and WRITES them faithfully, and
   cannot prove they are right (that is tests/master-accounts-couriers.test.js
   and, for the real CPR net, one CPR PDF nobody has compared yet).
   Cannot prove: the live volume of postex_orders or the Netlify run time.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {suite,ROOT}=require('./harness');
const {makeAdmin,loadFn,TOKENS,FAKE_SA,withEnv,clone}=require('./ma-fake-admin');
const core=require('../js/ma-core.js');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

const NOW=Date.UTC(2026,9,20,5,0,0);            // Tue 20 Oct 2026 10:00 PKT
const TODAY='2026-10-20';
const S=core.maSettings(null);
let seq=0;
function px(o){
  seq++;
  return Object.assign({trackingNumber:'PX'+String(seq).padStart(5,'0'),statusCategory:'delivered',dispatched:true,
    transactionDate:'2026-09-01T11:20:00',orderPickupDate:'2026-09-02T09:05:00',orderDeliveryDate:'2026-09-04T16:40:00',
    cod:3000,transactionFee:180,transactionTax:28.8,reversalFee:0,reversalTax:0,upfrontPayment:0,reservePayment:0,balancePayment:0,
    cprNumber_1:'',cprNumber_2:'',cityName:'Lahore',orderDetail:'GST073-M',merchantName:'GROOVY',syncedAt:1790000000000},o);
}
function parcels(){
  seq=0;
  return [
    px({trackingNumber:'A1',cprNumber_1:'U100',cpr1Date:'2026-09-05',upfrontPayment:2000,cprNumber_2:'R200',cpr2Date:'2026-09-12',reservePayment:791.2,settle:true}),
    px({trackingNumber:'A2',cod:1500,transactionFee:150,transactionTax:24,cprNumber_1:'U100',cpr1Date:'2026-09-05',upfrontPayment:1000}),
    px({trackingNumber:'B1',orderDeliveryDate:'2026-09-10T12:00:00'}),
    px({trackingNumber:'C1',statusCategory:'returned',cod:0,transactionFee:0,transactionTax:0,reversalFee:100,reversalTax:16,orderDeliveryDate:'2026-09-15T12:00:00'}),
    px({trackingNumber:'D1',orderDeliveryDate:'2026-06-20T12:00:00',cprNumber_1:'U050',cpr1Date:'2026-06-30',upfrontPayment:2000}),
    px({trackingNumber:'Z1',orderDeliveryDate:'2026-09-20T12:00:00',cprNumber_1:'U900',cpr1Date:'2026-09-25',upfrontPayment:2000})
  ];
}
// What the core says the parcels produce — the expected value of every test.
function expectDocs(ps,settings){
  const s=settings||S;
  return core.maCourierDocs(core.maCprDerive(ps,{from:s.couriers.from,today:TODAY}),s);
}

const ALL=[];
function mk(ps,extra){
  const st=Object.assign({tokens:TOKENS,docs:{}},extra||{});
  ALL.push(st);
  const mod=loadFn('netlify/functions/ma-rollup-background.js',st);
  const db=makeAdmin(st).firestore();
  st.putParcels=list=>{Object.keys(st.docs).filter(k=>k.indexOf('postex_orders/')===0).forEach(k=>delete st.docs[k]);
    list.forEach((p,i)=>{st.docs['postex_orders/'+(p.trackingNumber||('n'+i))+'-'+i]=clone(p);});};
  st.putParcels(ps);
  st.run=async(now,o)=>{
    try{return await mod.runRollup(Object.assign({db,nowMs:now||NOW},o||{}));}
    catch(e){st.thrown=(st.thrown||[]).concat(String(e&&e.message||e));return {threw:String(e&&e.message||e)};}
  };
  st.mod=mod;
  return st;
}
const cprIds=st=>Object.keys(st.docs).filter(k=>k.indexOf('ma_cpr/')===0).map(k=>k.slice(7)).sort();
const cprDoc=(st,id)=>st.docs['ma_cpr/'+id];
const batchesOf=(st,from)=>st.batches.slice(from||0);
const pathsOf=b=>b.map(w=>w.path);
const auditRows=st=>Object.keys(st.docs).filter(k=>k.indexOf('ma_audit/')===0).map(k=>st.docs[k]);
const runDoc=st=>st.docs['ma_runs/rollup']||{};

module.exports=async function(){
  const s=suite('ma-rollup');
  const P=parcels();
  const EXP=expectDocs(P);
  const EXP_IDS=EXP.map(d=>d.id).sort();

  s.section('the fixture: the core produces days, an opening, receipts and a before-the-books receipt');
  s.ok('at least one of each kind',['day','opening','upfront','reserve','mixed'].filter(k=>EXP.some(d=>d.kind===k)).length>=4&&EXP.some(d=>d.status==='before'),J(EXP.map(d=>d.id)));

  s.section('a first run creates exactly what the core builds');
  {
    const st=mk(clone(P));
    const rep=await st.run();
    s.eq('the run is done',rep.state,'done');
    s.eq('the documents written are the core\'s documents, by id',J(cprIds(st)),J(EXP_IDS));
    const one=EXP.find(d=>d.kind==='day');
    const w=cprDoc(st,one.id);
    s.eq('a written document is the core\'s, with ts set to the run\'s time',J(Object.assign({},w,{ts:0})),J(JSON.parse(J(one))));
    s.eq('… and ts is the run time',w.ts,NOW);
    s.ok('every one is derived:true',cprIds(st).every(id=>cprDoc(st,id).derived===true));
    const r=runDoc(st);
    s.eq('the run document: state done, at, day',J([r.state,r.at,r.day]),J(['done',NOW,TODAY]));
    s.eq('… created = every document, nothing else',J([r.created,r.updated,r.voided,r.unchanged,r.skippedCount]),J([EXP.length,0,0,0,0]));
    s.eq('… parcels read',r.parcels,P.length);
    s.eq('… transit is the core\'s',J(r.transit),J(core.maCprDerive(P,{from:S.couriers.from,today:TODAY}).transit));
    s.eq('… checks carry the 1120 ledger and the parcels\' transit as whole rupees',J([Number.isInteger(r.checks.ledger1120),Number.isInteger(r.checks.transit1120)]),J([true,true]));
    const rows=auditRows(st);
    s.eq('exactly one audit row',rows.length,1);
    s.eq('… action rollup, by ma-rollup, named as the core names it',J([(rows[0]||{}).action,(rows[0]||{}).by,(rows[0]||{}).byName,(rows[0]||{}).at]),J(['rollup','ma-rollup',core.MA_ROLLUP_NAME,NOW]));
    s.ok('… its detail says what was done',/^Done — \d+ created, 0 updated, 0 voided, 0 unchanged, 0 skipped/.test((rows[0]||{}).detail),(rows[0]||{}).detail);
    s.ok('… and it is in the core\'s audit shape',J(Object.keys((rows[0]||{})).sort())===J(Object.keys(core.maAuditRow('rollup',{dt:'rollup',id:'rollup',no:'rollup'},{at:1})).sort()));
    s.eq('the last batch carries the run document and the audit row',J(pathsOf(st.batches[st.batches.length-1]).filter(p=>!/^ma_cpr\//.test(p)).map(p=>p.split('/')[0]).sort()),J(['ma_audit','ma_runs']));
    s.ok('nothing is ever deleted (the fake has no delete; the run used none)',!/\.delete\(/.test(read('netlify/functions/ma-rollup-background.js')));
    // The postex_orders scan reads only the selected fields.
    const q=(st.queries||[]).find(x=>x.collection==='postex_orders');
    s.eq('postex_orders is read with .select() of exactly PARCEL_FIELDS',J(q&&q.fields),J(st.mod._test.PARCEL_FIELDS));
    s.ok('… the other collections are read whole (not selected)',(st.queries||[]).filter(x=>x.collection!=='postex_orders').every(x=>!x.fields));
    // What the app's own core makes of the run document.
    const nA=core.maCourierConcerns({docs:[],today:TODAY,settings:S,run:r,nowMs:NOW+3600000,missing:[]}).map(x=>x.sentence).join(' | ');
    s.ok('the core reads a done run: no "not run yet", no "failed"',!/not run yet|failed/.test(nA),nA);
    s.eq('… checks are the core\'s 1120 check over the books as written',J(r.checks),J(core.maCourier1120Check(
      core.maPostAll(cprIds(st).map(id=>Object.assign({dt:'cpr'},cprDoc(st,id))),core.maChartIndex(core.maChart('groovy',[])),S),core.maChartIndex(core.maChart('groovy',[])),core.maCprDerive(P,{from:S.couriers.from,today:TODAY}))));
  }

  s.section('every field the core reads from a parcel is in the .select()');
  {
    const seen=new Set();
    const wrap=p=>new Proxy(Object.assign({},p),{get(t,k){if(typeof k==='string')seen.add(k);return t[k];}});
    const full=P.map(wrap).concat([wrap(Object.assign({},P[0],{trackingNumber:'DUP',statusCategory:'returned'})),wrap(Object.assign({},P[0],{trackingNumber:'DUP'}))]);
    core.maCprDerive(full,{from:S.couriers.from,today:TODAY});
    const missing=[...seen].filter(k=>k!=='cityName'&&k!=='orderDetail'&&k!=='merchantName'&&require('../netlify/functions/ma-rollup-background.js')._test.PARCEL_FIELDS.indexOf(k)<0);
    s.eq('no field read is missing from PARCEL_FIELDS (a duplicate\'s tiebreak canon reads the whole copy: only then are the others read)',J(missing),J([]));
  }

  s.section('a second run over the same parcels writes nothing but the run document and its audit row');
  {
    const st=mk(clone(P));
    await st.run();
    const before=clone(st.docs);
    const nb=st.batches.length;
    const rep=await st.run(NOW+86400000-3600000);
    s.eq('done, and everything unchanged',J([rep.state,rep.created,rep.updated,rep.voided,rep.unchanged]),J(['done',0,0,0,EXP.length]));
    const w=batchesOf(st,nb).flat();
    s.eq('the writes are exactly ma_runs/rollup and one ma_audit row',J(w.map(x=>x.path.split('/')[0]).sort()),J(['ma_audit','ma_runs']));
    s.ok('no ma_cpr document changed (not even a ts or rev)',cprIds(st).every(id=>J(cprDoc(st,id))===J(before['ma_cpr/'+id])));
    s.eq('two audit rows now, one per run',auditRows(st).length,2);
    s.eq('the run document was replaced with the new run\'s time',runDoc(st).at,NOW+86400000-3600000);
  }

  s.section('a changed parcel updates exactly the affected documents, and rev goes up');
  {
    const st=mk(clone(P));
    await st.run();
    const before=clone(st.docs);
    const P2=clone(P);P2.find(p=>p.trackingNumber==='B1').cod=4000;       // a delivered-on-09-10 parcel: its day changes
    st.putParcels(P2);
    const want=expectDocs(P2).filter(d=>{const o=EXP.find(x=>x.id===d.id);return !o||o.sig!==d.sig;}).map(d=>d.id).sort();
    const nb=st.batches.length;
    const rep=await st.run(NOW+3600000);
    const touched=batchesOf(st,nb).flat().filter(x=>x.path.indexOf('ma_cpr/')===0).map(x=>x.path.slice(7)).sort();
    s.ok('something changed (the scenario is not vacuous)',want.length>0,J(want));
    s.eq('exactly the documents whose signature moved are written',J(touched),J(want));
    s.eq('… counted as updated',rep.updated,want.length);
    const id=want[0];
    s.eq('rev went up by one',cprDoc(st,id).rev,before['ma_cpr/'+id].rev+1);
    const last=cprDoc(st,id).edits[cprDoc(st,id).edits.length-1];
    s.eq('… with one history row by ma-rollup naming what moved',J([last.by,last.reason,last.fields.length>0]),J([core.MA_ROLLUP_BY,'PostEx records changed',true]));
    s.eq('the documents that did not move are byte-identical',J(cprIds(st).filter(x=>want.indexOf(x)<0).every(x=>J(cprDoc(st,x))===J(before['ma_cpr/'+x]))),'true');
    // and a new parcel that makes a new receipt creates it
    const P3=P2.concat([px({trackingNumber:'N1',orderDeliveryDate:'2026-10-01T10:00:00',cprNumber_1:'U777',cpr1Date:'2026-10-06',upfrontPayment:2000})]);
    st.putParcels(P3);
    const rep3=await st.run(NOW+7200000);
    s.ok('a new receipt is created',rep3.created>=1&&!!cprDoc(st,'postex-U777'),J(rep3));
  }

  s.section('a review is kept unless a figure moved');
  {
    const st=mk(clone(P));
    await st.run();
    const day=EXP.find(d=>d.kind==='day'),rc=EXP.find(d=>d.kind==='upfront'&&d.status==='posted');
    // The owners reviewed both; then the stored copies drift (their sigs no longer match).
    st.docs['ma_cpr/'+rc.id]=Object.assign(clone(st.docs['ma_cpr/'+rc.id]),{reviewedAt:111,reviewedBy:'afnan',note:'typed by nobody',sig:'old'});
    st.docs['ma_cpr/'+day.id]=Object.assign(clone(st.docs['ma_cpr/'+day.id]),{reviewedAt:222,reviewedBy:'ammar',net:1,sig:'old'});
    await st.run(NOW+3600000);
    const a=cprDoc(st,rc.id),b=cprDoc(st,day.id);
    s.eq('a non-figure change (note): the review is kept',J([a.reviewedAt,a.reviewedBy]),J([111,'afnan']));
    s.eq('a figure moved (net): the review is cleared',J([b.reviewedAt,b.reviewedBy]),J([null,null]));
    s.eq('both were rewritten to the parcels\' truth',J([a.note,b.net]),J(['',day.net]));
  }

  s.section('a locked quarter is skipped and reported, on creation and on change');
  {
    const q=EXP.find(d=>d.kind==='day').quarter;
    const inQ=EXP.filter(d=>d.quarter===q).map(d=>d.id).sort();
    const outQ=EXP.filter(d=>d.quarter!==q).map(d=>d.id).sort();
    const lock={id:q,quarter:q,locked:true};
    const st=mk(clone(P),{docs:{['ma_closes/'+q]:lock}});
    const rep=await st.run();
    s.eq('creation: only the documents outside the locked quarter are written',J(cprIds(st)),J(outQ));
    s.eq('… the skipped are reported by id, with the reason and the quarter',J(runDoc(st).skipped.map(x=>x.id).sort()),J(inQ));
    s.ok('… each says locked',runDoc(st).skipped.every(x=>x.why==='locked'&&x.quarter===q));
    s.eq('… counted in the run',rep.skipped,inQ.length);
    // now a run with the quarter open creates them; then lock and change a parcel in it
    delete st.docs['ma_closes/'+q];
    await st.run(NOW+3600000);
    st.docs['ma_closes/'+q]=lock;
    const before=clone(st.docs);
    const P2=clone(P);P2.find(p=>p.trackingNumber==='B1').cod=4000;st.putParcels(P2);
    const nb=st.batches.length;
    const rep2=await st.run(NOW+7200000);
    const moved=expectDocs(P2).filter(d=>d.quarter===q&&(EXP.find(x=>x.id===d.id)||{}).sig!==d.sig).map(d=>d.id);
    s.ok('the scenario changes a document in the locked quarter',moved.length>0);
    s.ok('a changed document in the locked quarter is NOT written',moved.every(id=>J(cprDoc(st,id))===J(before['ma_cpr/'+id])));
    s.ok('… and is reported skipped',moved.every(id=>runDoc(st).skipped.some(x=>x.id===id&&x.why==='locked')),J(runDoc(st).skipped));
    s.eq('a reopened quarter is not locked (reopenedAt)',(()=>{st.docs['ma_closes/'+q]=Object.assign({},lock,{reopenedAt:5});return true;})(),true);
    await st.run(NOW+10800000);
    s.ok('… so the change lands',moved.every(id=>cprDoc(st,id).rev===2),J(moved.map(id=>cprDoc(st,id).rev)));
    void rep2;void nb;
  }

  s.section('a typed statement is never touched');
  {
    const typed={id:'st1',no:'CS-27-0001',dt:'cpr',kind:'statement',courier:'tcs',status:'posted',date:'2026-09-30',net:5000,amount:5000,lines:[]};
    const clash={id:EXP.find(d=>d.kind==='day').id,dt:'cpr',kind:'day',status:'posted',date:'2026-09-01',net:7,note:'an owner typed this',derived:false};
    const st=mk([],{docs:{'ma_cpr/st1':typed,['ma_cpr/'+clash.id]:clash}});
    st.putParcels(clone(P));
    const t0=clone(typed),c0=clone(clash);
    const rep=await st.run();
    s.eq('a typed statement is unchanged',J(cprDoc(st,'st1')),J(t0));
    s.eq('a typed document at a derived id is unchanged (skipped, typed)',J(cprDoc(st,clash.id)),J(c0));
    s.ok('… and reported skipped as typed',runDoc(st).skipped.some(x=>x.id===clash.id&&x.why==='typed'),J(runDoc(st).skipped));
    s.ok('the rest are created',rep.created===EXP.length-1,J(rep));
    // no parcels, only typed docs: nothing voided
    const st2=mk([],{docs:{'ma_cpr/st1':clone(typed)}});
    const r2=await st2.run();
    s.eq('a run with no parcels and only typed documents is done and voids nothing',J([r2.state,r2.voided,cprDoc(st2,'st1').status]),J(['done',0,'posted']));
  }

  s.section('a document PostEx no longer produces is voided — unless a live collection covers it');
  {
    const st=mk(clone(P));
    await st.run();
    const P2=P.filter(p=>p.trackingNumber!=='Z1');st.putParcels(clone(P2));
    const gone='postex-U900';
    const rep=await st.run(NOW+3600000);
    const v=cprDoc(st,gone);
    s.ok('the receipt Z1 alone made is void, not deleted',!!v&&v.status==='void',J(v&&v.status));
    s.eq('… by the rollup, with the reason',J([v.voidedBy,v.voidReason]),J([core.MA_ROLLUP_BY,'PostEx no longer reports it']));
    s.ok('… counted',rep.voided>=1,J(rep));
    s.eq('… and the documents count is unchanged (nothing deleted)',cprIds(st).length>=EXP.length,true);
    // covered by a live collection: stays
    const st2=mk(clone(P),{});
    await st2.run();
    st2.docs['ma_collection/CL1']={id:'CL1',no:'CL-27-0001',dt:'collection',status:'posted',courier:'postex',amount:1,refs:{cprNos:[gone]},covers:[],date:'2026-09-26'};
    st2.putParcels(clone(P2));
    await st2.run(NOW+3600000);
    s.eq('a receipt a live collection covers is NOT voided',cprDoc(st2,gone).status,'posted');
    s.ok('… and is reported skipped as collected',runDoc(st2).skipped.some(x=>x.id===gone&&x.why==='collected'),J(runDoc(st2).skipped));
    // a void collection does not protect it
    st2.docs['ma_collection/CL1'].status='void';
    await st2.run(NOW+7200000);
    s.eq('a VOID collection does not protect it',cprDoc(st2,gone).status,'void');
  }

  s.section('the guards that refuse to write');
  {
    const st=mk(clone(P));
    await st.run();
    const before=clone(st.docs);
    st.putParcels([]);
    const nb=st.batches.length;
    const rep=await st.run(NOW+3600000);
    s.eq('postex_orders answering with no parcels while derived documents exist fails the run',rep.state,'failed');
    s.ok('… it says so',/no parcels/.test(runDoc(st).error||''),runDoc(st).error);
    s.ok('… and voided nothing',cprIds(st).every(id=>J(cprDoc(st,id))===J(before['ma_cpr/'+id])));
    s.eq('… the failed run wrote only the run document and its audit row',J(batchesOf(st,nb).flat().map(x=>x.path.split('/')[0]).sort()),J(['ma_audit','ma_runs']));
    // bad options: books start after today
    const st2=mk(clone(P),{docs:{'ma_settings/main':{couriers:{from:'2026-10-21'}}}});
    const r2=await st2.run();
    s.eq('books starting after today: the run fails',r2.state,'failed');
    s.ok('… naming the two days, and writing no ma_cpr document',/2026-10-21/.test(runDoc(st2).error||'')&&!cprIds(st2).length,runDoc(st2).error);
    // no parcels and no derived documents: an honest empty run
    const st3=mk([]);
    const r3=await st3.run();
    s.ok('no parcels and nothing derived yet: done, with the opening only',r3.state==='done',J(r3));
  }

  s.section('a failure writes state:failed and an audit row; the batch is all-or-nothing');
  {
    const st=mk(clone(P),{failRead:'firestore unavailable: boom'});
    const rep=await st.run();
    s.eq('a refused read: failed',rep.state,'failed');
    s.eq('the run document says failed with the error text',J([runDoc(st).state,runDoc(st).ok,/boom/.test(runDoc(st).error),runDoc(st).at]),J(['failed',false,true,NOW]));
    s.ok('the error does not end in a full stop (the core adds it)',!/[.\s]$/.test(runDoc(st).error||'.'));
    const rows=auditRows(st);
    s.eq('one audit row records the failure',J([rows.length,rows[0]&&rows[0].action,rows[0]&&rows[0].by,/^Failed — .*boom/.test(rows[0]&&rows[0].detail)]),J([1,'rollup','ma-rollup',true]));
    s.eq('nothing was written to ma_cpr',cprIds(st).length,0);
    const nA=core.maCourierConcerns({docs:[],today:TODAY,settings:S,run:runDoc(st),nowMs:NOW}).map(x=>x.sentence).join(' | ');
    s.ok('the core reads it as "The courier rollup failed: …"',/rollup failed: .*boom/.test(nA),nA);
    // a refused commit: the first batch fails as a whole, the failure is recorded
    const st2=mk(clone(P),{failWrite:'ABORTED: write refused'});
    const r2=await st2.run();
    s.eq('a refused write: failed, nothing in ma_cpr',J([r2.state,cprIds(st2).length]),J(['failed',0]));
    s.ok('… and the failed run is on record',runDoc(st2)&&runDoc(st2).state==='failed'&&/write refused/.test(runDoc(st2).error||''));
    // a failed run after a good one replaces the run document (the page reads the latest)
    const st3=mk(clone(P));
    await st3.run();
    st3.failRead='later boom';
    await st3.run(NOW+3600000);
    s.eq('a later failure replaces the earlier done run',J([runDoc(st3).state,runDoc(st3).transit]),J(['failed',undefined]));
    s.ok('… but the documents of the good run are still there',cprIds(st3).length===EXP.length);
  }

  s.section('batches: at most 400, the run document only in the last');
  {
    const many=[];
    for(let i=0;i<450;i++)many.push(px({trackingNumber:'M'+i,orderDeliveryDate:'2026-09-10T12:00:00',cprNumber_1:'K'+i,cpr1Date:'2026-09-15',upfrontPayment:1000}));
    const st=mk(many);
    const rep=await st.run();
    const bs=st.batches;
    s.ok('more than 400 documents were planned',rep.created>400,J(rep.created));
    s.ok('there are at least two batches, none over 400 writes',bs.length>=2&&bs.every(b=>b.length<=400),J(bs.map(b=>b.length)));
    s.eq('the run document and the audit row are in the LAST batch only',J(bs.map(b=>b.filter(w=>w.path.indexOf('ma_runs')===0||w.path.indexOf('ma_audit')===0).length)),J(bs.map((b,i)=>i===bs.length-1?2:0)));
    s.eq('every document landed',cprIds(st).length,rep.created);
    // a last chunk that would overflow gets its own batch for the run document
    const nDocs=core.maCourierDocs(core.maCprDerive(many,{from:S.couriers.from,today:TODAY}),S).length;
    s.ok('(the batch count follows the plan)',bs.length===Math.ceil(nDocs/400)||bs.length===Math.ceil(nDocs/400)+1,J([nDocs,bs.length]));
    s.eq('the run says how many batches',runDoc(st).batches,bs.length);
  }
  {
    // exactly 399 planned documents: 399 + run + audit > 400, so the run document takes its own batch
    const one=[];
    for(let i=0;i<397;i++)one.push(px({trackingNumber:'E'+i,orderDeliveryDate:'2026-09-10T12:00:00',cprNumber_1:'J'+i,cpr1Date:'2026-09-15',upfrontPayment:1000}));
    const n=core.maCourierDocs(core.maCprDerive(one,{from:S.couriers.from,today:TODAY}),S).length;
    const st=mk(one);
    await st.run();
    s.eq('(the scenario plans exactly 399 documents)',n,399);
    s.eq('399 writes + the run document and audit row would be 401: the run document takes its own batch',J(st.batches.map(b=>b.length)),J([399,2]));
  }

  s.section('the Pakistan day');
  {
    const kd=st=>st.mod._test.karachiDay;
    const st=mk([]);
    const K=kd(st);
    s.eq('18:59 UTC on 20 Oct is still 20 Oct in Karachi',K(Date.UTC(2026,9,20,18,59,59)),'2026-10-20');
    s.eq('19:00 UTC on 20 Oct is 21 Oct in Karachi (00:00 PKT)',K(Date.UTC(2026,9,20,19,0,0)),'2026-10-21');
    s.eq('20:30 UTC on 20 Oct is already 21 Oct in Karachi',K(Date.UTC(2026,9,20,20,30,0)),'2026-10-21');
    s.eq('a year boundary: 31 Dec 20:00 UTC is 1 Jan',K(Date.UTC(2026,11,31,20,0,0)),'2027-01-01');
    s.eq('and 04:00 UTC (the nightly run) is the same day',K(Date.UTC(2026,9,20,3,45,0)),'2026-10-20');
    // Functional: books that start on Karachi's 21 Oct are valid at 20:30 UTC on the 20th; a UTC day would refuse them.
    const st2=mk(clone(P),{docs:{'ma_settings/main':{couriers:{from:'2026-10-21'}}}});
    const rep=await st2.run(Date.UTC(2026,9,20,20,30,0));
    s.eq('at 20:30 UTC the run is dated 21 Oct and the books\' start (21 Oct) is not after it',J([rep.state,runDoc(st2).day]),J(['done','2026-10-21']));
    const src=read('netlify/functions/ma-rollup-background.js');
    s.ok('the function never takes a day from toISOString',!/toISOString/.test(src));
  }

  s.section('the on-demand wrapper: owners only');
  {
    const src=path.join(ROOT,'netlify/functions/ma-rollup-background.js');
    const mkNow=(state)=>{delete require.cache[src];const st=Object.assign({tokens:TOKENS,docs:{}},state||{});ALL.push(st);
      const fn=loadFn('netlify/functions/ma-rollup-now-background.js',st);return {st,fn};};
    const call=(fn,method,tok,body)=>fn.handler({httpMethod:method,headers:tok?{authorization:'Bearer '+tok}:{},body:body||''});
    await withEnv({FIREBASE_SERVICE_ACCOUNT:FAKE_SA},async()=>{
      {const {st,fn}=mkNow();
        const r=await call(fn,'POST','');
        s.eq('no token: 401',r.statusCode,401);
        s.eq('… and nothing was written',J([st.batches.length,cprIds(st).length]),J([0,0]));}
      for(const [who,tok,code] of [['a manager (Mustafa)','t_mustafa',403],['the store (Raees)','t_raees',403],['a mixed-case owner address','t_ammar_mixed',403],['an unknown token','t_nobody',401],['a token with no email','t_noemail',403]]){
        const {st,fn}=mkNow();
        const r=await call(fn,'POST',tok);
        s.eq(who+': '+code,r.statusCode,code);
        s.eq('… nothing read, nothing written',J([st.batches.length,Object.keys(st.docs).length]),J([0,0]));
      }
      {const {st,fn}=mkNow();const r=await call(fn,'GET','t_afnan');s.eq('GET: 405',r.statusCode,405);s.eq('… nothing written',st.batches.length,0);}
      {const {st,fn}=mkNow();
        st.docs={};for(let i=0;i<P.length;i++)st.docs['postex_orders/p'+i]=clone(P[i]);
        const r=await call(fn,'POST','t_afnan');
        const body=JSON.parse(r.body||'{}');
        s.eq('an owner: 200 and the run is done',J([r.statusCode,body.ok,body.report&&body.report.state]),J([200,true,'done']));
        s.eq('… the ID token was verified with checkRevoked',J(st.verify.map(v=>v.checkRevoked)),J([true]));
        s.eq('… the run records who triggered it',J([runDoc(st).trigger,runDoc(st).triggeredBy]),J(['owner','afnan@groovy.op']));
        s.ok('… and the audit row says who',/run by afnan@groovy.op/.test(auditRows(st)[0].detail),auditRows(st)[0].detail);
        s.ok('… documents were written',cprIds(st).length===EXP.length);}
      {const {st,fn}=mkNow();st.docs={};
        st.failRead='no way';
        const r=await call(fn,'POST','t_ammar');
        s.eq('a failing run through the wrapper: 500, and the failure is on record',J([r.statusCode,runDoc(st)&&runDoc(st).state]),J([500,'failed']));}
    });
    await withEnv({FIREBASE_SERVICE_ACCOUNT:undefined},async()=>{
      const {fn}=mkNow();const r=await call(fn,'POST','t_afnan');
      s.eq('no service account: a generic 503, no reason in the body',J([r.statusCode,/FIREBASE/.test(r.body)]),J([503,false]));
    });
    // the schedule's handler
    await withEnv({FIREBASE_SERVICE_ACCOUNT:undefined},async()=>{
      const st=mk([]);const r=await st.mod.handler({});
      s.eq('the scheduled handler with no service account: 503, nothing thrown',r.statusCode,503);
    });
    await withEnv({FIREBASE_SERVICE_ACCOUNT:FAKE_SA},async()=>{
      const st=mk(clone(P));
      const r=await st.mod.handler({});
      s.eq('the scheduled handler runs against the Admin SDK and answers 200',J([r.statusCode,JSON.parse(r.body).ok]),J([200,true]));
    });
  }

  s.section('wiring: the schedule, the audit action, the backup list');
  {
    const toml=read('netlify.toml');
    s.ok('scheduled at 45 3 * * * as a background function',/\[functions\."ma-rollup-background"\]\s*\n\s*schedule = "45 3 \* \* \*"/.test(toml));
    s.ok('the on-demand wrapper is NOT scheduled',!/ma-rollup-now/.test(toml));
    const lib=require('../netlify/lib/ma-server.js');
    s.ok('rollup is a server audit action, and a row builds',lib.SERVER_AUDIT_ACTIONS.indexOf('rollup')>=0&&lib.auditRow('rollup',{dt:'rollup',id:'rollup',no:'rollup'},{at:1}).action==='rollup');
    s.ok('the core lists rollup too (nothing is relabelled post)',core.MA_AUDIT_ACTIONS.indexOf('rollup')>=0);
    const bk=read('netlify/functions/ma-backup.js');
    s.ok('the backup exports ma_cpr, ma_collection and ma_runs',['ma_cpr','ma_collection','ma_runs'].every(c=>new RegExp("'"+c+"'").test(bk.split('const START_UTC_MINUTES')[0])));
    s.ok('the schedule leaves the 03:00 UTC PostEx payments run before it',/postex-payments-background"\]\s*\n\s*schedule = "0 3 \* \* \*"/.test(toml));
  }

  s.section('no run threw');
  s.eq('not one run of the function threw, in any section above',J(ALL.map(st=>st.thrown||[]).reduce((x,y)=>x.concat(y),[])),J([]));
  return s;
};

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
   a failure writes state:'failed' and says how much it had written before it
   stopped; the Karachi day; the on-demand wrapper's owner gate; that every
   parcel field the core reads is in the .select(). And, since the M2 review
   (S3, S8), what happens when an OWNER WRITES WHILE THE RUN IS: a receipt
   collected mid-run is not voided (the claim, or a collection that names it),
   a dispute or a review opened mid-run is kept through the rewrite, a create
   that meets a document which appeared meanwhile merges with it instead of
   replacing it, a quarter closed mid-run is not written into, and a PostEx
   receipt-number conflict reaches the books as a flag and a run issue. The run
   is driven against an in-memory Firestore whose hooks (tests/ma-fake-admin.js)
   land a write at the moments that matter: before the run's first write, and
   between one transaction's reads and its commit.
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
const IDX=core.maChartIndex(core.maChart('groovy',[]));
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
  // strictTx: a transaction that reads after it wrote is refused, as Firestore refuses it.
  const st=Object.assign({tokens:TOKENS,docs:{},strictTx:true},extra||{});
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
const cpd=(st,id)=>st.docs['ma_cpr/'+id]||{};        // the same, for a chained read: a missing document is a failed assertion, not a crash
const batchesOf=(st,from)=>st.batches.slice(from||0);
const pathsOf=b=>b.map(w=>w.path);
const auditRows=st=>Object.keys(st.docs).filter(k=>k.indexOf('ma_audit/')===0).map(k=>st.docs[k]);
const runDoc=st=>st.docs['ma_runs/rollup']||{};
// Every write since a mark, however it went in: a batch (the creates, the run document) or a
// transaction (an update, a void — each its own).
const mark=st=>({b:st.batches.length,t:st.txs.length});
const wrote=(st,m)=>st.batches.slice(m?m.b:0).concat(st.txs.slice(m?m.t:0)).reduce((a,b)=>a.concat(b),[]);
const wroteCpr=(st,m)=>wrote(st,m).filter(x=>x.path.indexOf('ma_cpr/')===0).map(x=>x.path.slice(7)).sort();
// A concurrent writer. `fn` runs once, at the first moment the run is about to write: before its first
// transaction or before its first batch commit, whichever comes first.
const beforeFirstWrite=(st,fn)=>{let done=false;const go=()=>{if(!done){done=true;fn();}};st.txBefore=go;st.batchBefore=go;};
// … or after the body of the transaction that writes `path` has run and before it commits: the write
// lands between that transaction's reads and its commit (the fake then runs the body again).
const midTx=(st,path,fn)=>{let done=false;st.txAfterBody=x=>{if(!done&&(x.paths||[]).indexOf(path)>=0){done=true;fn();}};};

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
    s.ok('… and cprConflict is one of them (postex-core records a refused receipt number there; the core raises cpr.number_conflict from it)',
      require('../netlify/functions/ma-rollup-background.js')._test.PARCEL_FIELDS.indexOf('cprConflict')>=0&&seen.has('cprConflict'));
  }

  s.section('a second run over the same parcels writes nothing but the run document and its audit row');
  {
    const st=mk(clone(P));
    await st.run();
    const before=clone(st.docs);
    const m0=mark(st);
    const rep=await st.run(NOW+86400000-3600000);
    s.eq('done, and everything unchanged',J([rep.state,rep.created,rep.updated,rep.voided,rep.unchanged]),J(['done',0,0,0,EXP.length]));
    const w=wrote(st,m0);
    s.eq('the writes are exactly ma_runs/rollup and one ma_audit row',J(w.map(x=>x.path.split('/')[0]).sort()),J(['ma_audit','ma_runs']));
    s.eq('… and no transaction was opened: nothing needed writing',st.txs.length-m0.t,0);
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
    const m0=mark(st);
    const rep=await st.run(NOW+3600000);
    const touched=wroteCpr(st,m0);
    s.ok('something changed (the scenario is not vacuous)',want.length>0,J(want));
    s.eq('exactly the documents whose signature moved are written',J(touched),J(want));
    s.eq('… each update in a transaction of its own, writing that one document',J(st.txs.slice(m0.t).map(t=>t.length)),J(want.map(()=>1)));
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
    s.ok('… and named as a PostEx data issue, with the collection that covers it',(runDoc(st2).issues||[]).some(i=>i.rule==='rollup.collected'&&/CL-27-0001/.test(i.message)&&/U900/.test(i.message)),J(runDoc(st2).issues));
    s.ok('… the issue is in the run\'s count',runDoc(st2).issueCount>=1);
    // a void collection does not protect it
    st2.docs['ma_collection/CL1'].status='void';
    await st2.run(NOW+7200000);
    s.eq('a VOID collection does not protect it',cprDoc(st2,gone).status,'void');
  }

  // ── S3 (M2 review): the rollup used to read, plan, and then overwrite whole documents in batches. ──
  // Anything an owner wrote between its reads and its commit was lost: a receipt collected mid-run was
  // voided anyway; a dispute opened mid-run was erased. Each update and void is now its own transaction
  // over the document as it is NOW. Every scenario below lands the owner's write at a chosen moment.
  s.section('S3: a collection recorded while the run is writing keeps its receipt — a void is decided over the document as it is NOW');
  {
    const gone='postex-U900';
    const P2=clone(P.filter(p=>p.trackingNumber!=='Z1'));      // PostEx stops reporting Z1: its receipt is to be voided
    const night2=async inject=>{
      const st=mk(clone(P));
      await st.run();
      st.putParcels(clone(P2));
      inject(st);
      const rep=await st.run(NOW+3600000);
      return {st,rep};
    };
    // A collection the way the page stores it: built by the core, covering the receipt.
    const collectionOf=(st,over)=>{
      const cprs=Object.keys(st.docs).filter(k=>k.indexOf('ma_cpr/')===0).map(k=>Object.assign({dt:'cpr'},st.docs[k]));
      const d=core.maBuildDoc('collection',{courier:'postex',holder:'1011',amount:st.docs['ma_cpr/'+gone].amount,date:'2026-10-20',cprNos:[gone]},{by:'afnan',byName:'Afnan',ts:NOW,cprs},IDX,S);
      d.no=d.id='CL-27-0001';return Object.assign(d,over||{});
    };
    const claimOf=over=>Object.assign({doc:gone,collection:'CL-27-0001',at:NOW,by:'afnan'},over||{});
    const kept=(label,r)=>{
      s.eq(label+': the receipt is NOT voided',cpd(r.st,gone).status,'posted');
      s.eq('… the only void is the day PostEx no longer has (no collection covers a day)',J([r.rep.state,r.rep.voided,cpd(r.st,'postex-day-2026-09-20').status]),J(['done',1,'void']));
      s.ok('… it is reported skipped as collected',(runDoc(r.st).skipped||[]).some(x=>x.id===gone&&x.why==='collected'),J(runDoc(r.st).skipped));
      s.ok('… and named as a PostEx data issue, with the collection and the receipt',(runDoc(r.st).issues||[]).some(i=>i.rule==='rollup.collected'&&/CL-27-0001/.test(i.message)&&/U900/.test(i.message)),J(runDoc(r.st).issues));
      s.ok('… the issue is in the count the Money in page shows',runDoc(r.st).issueCount>=1&&runDoc(r.st).issueCount>=(runDoc(r.st).issues||[]).length);
    };
    // The collection lists the receipt — the way every collection recorded so far stores it (no claim).
    const A=await night2(st=>beforeFirstWrite(st,()=>st.poke('ma_collection/CL-27-0001',collectionOf(st))));
    kept('a collection recorded after the run planned and before its first write',A);
    {
      const docs=Object.keys(A.st.docs).filter(k=>k.indexOf('ma_cpr/')===0).map(k=>Object.assign({dt:'cpr'},A.st.docs[k])).concat([Object.assign({dt:'collection'},A.st.docs['ma_collection/CL-27-0001'])]);
      const bal=core.maBalanceOf(core.maPostAll(docs,IDX,S),IDX,'1121');
      s.ok('the books: 1121 is not left short by a collection against a void receipt (the reviewer read −the amount)',bal>=0,bal);
    }
    // Between the void's reads and its commit: the transaction is run again and sees it (the query is read INSIDE it).
    const B=await night2(st=>midTx(st,'ma_cpr/'+gone,()=>st.poke('ma_collection/CL-27-0001',collectionOf(st))));
    kept('a collection recorded between the void\'s reads and its commit',B);
    s.ok('… the transaction really was run a second time',(B.st.txRetries||0)>=1,B.st.txRetries);
    // The claim alone: the collection does NOT list the receipt, so only ma_claims/{receipt} says it is covered.
    const C=await night2(st=>beforeFirstWrite(st,()=>{st.poke('ma_collection/CL-27-0001',collectionOf(st,{refs:{cprNos:[]}}));st.poke('ma_claims/'+gone,claimOf());}));
    kept('a claim that names a live collection (the collection lists nothing)',C);
    const D=await night2(st=>midTx(st,'ma_cpr/'+gone,()=>{st.poke('ma_collection/CL-27-0001',collectionOf(st,{refs:{cprNos:[]}}));st.poke('ma_claims/'+gone,claimOf());}));
    kept('… the same, written between the void\'s reads and its commit',D);
    // What is NOT a live claim, exactly: the void goes ahead.
    for(const [label,seed] of [
      ['a claim that was released',st=>{st.docs['ma_collection/CL-27-0001']=collectionOf(st,{refs:{cprNos:[]}});st.docs['ma_claims/'+gone]=claimOf({releasedAt:NOW});}],
      ['a claim with no collection yet',st=>{st.docs['ma_claims/'+gone]=claimOf({collection:null});}],
      ['a claim naming a VOID collection',st=>{st.docs['ma_collection/CL-27-0001']=collectionOf(st,{refs:{cprNos:[]},status:'void'});st.docs['ma_claims/'+gone]=claimOf();}],
      ['a claim naming a collection that does not exist',st=>{st.docs['ma_claims/'+gone]=claimOf();}],
      ['a claim whose collection cannot even be an id (Firestore refuses the path)',st=>{st.docs['ma_claims/'+gone]=claimOf({collection:'CL-27/0001'});}],
      ['a VOID collection that lists the receipt',st=>{st.docs['ma_collection/CL-27-0001']=collectionOf(st,{status:'void'});}]]){
      const r=await night2(seed);
      s.eq(label+' does not protect the receipt: it is voided, with the day',J([cpd(r.st,gone).status,r.rep.voided]),J(['void',2]));
      s.ok('… and nothing is reported as collected',!(runDoc(r.st).skipped||[]).some(x=>x.why==='collected')&&!(runDoc(r.st).issues||[]).some(i=>i.rule==='rollup.collected'),J(runDoc(r.st).skipped));
    }
    // The void is its own transaction and reads the receipt as it is now.
    const V=await night2(st=>{});
    s.ok('a void is a transaction of its own, writing that one document',V.st.txs.some(t=>t.length===1&&t[0].path==='ma_cpr/'+gone),J(V.st.txs.map(t=>t.map(x=>x.path))));
    const R=await night2(st=>beforeFirstWrite(st,()=>st.poke('ma_cpr/'+gone,Object.assign({},clone(st.docs['ma_cpr/'+gone]),{status:'void',voidedBy:'afnan',voidReason:'an owner voided it first'}))));
    s.eq('a receipt an owner voided meanwhile is left as they voided it, and not counted as voided by this run (the day is)',J([R.rep.voided,cpd(R.st,gone).voidedBy]),J([1,'afnan']));
  }

  s.section('S3: a dispute and a review an owner writes while the run is writing are kept through the rewrite');
  {
    const P2=clone(P);P2.find(p=>p.trackingNumber==='B1').cod=4000;               // B1's day moves a figure
    const want=expectDocs(P2).filter(d=>{const o=EXP.find(x=>x.id===d.id);return !o||o.sig!==d.sig;}).map(d=>d.id).sort();
    const id=want[0];
    const dispute={state:'open',reason:'PostEx paid less than the receipt says',by:'afnan',at:NOW+1};
    const history=[{state:'open',reason:'PostEx paid less than the receipt says',by:'afnan',at:NOW+1}];
    const timings=[
      ['before the run\'s first write',(st,f)=>beforeFirstWrite(st,f)],
      ['between the update\'s reads and its commit',(st,f)=>midTx(st,'ma_cpr/'+id,f)]];
    s.ok('(the scenario changes a document)',want.length>0,J(want));
    for(const [label,at] of timings){
      const st=mk(clone(P));
      await st.run();
      st.putParcels(clone(P2));
      at(st,()=>st.patch('ma_cpr/'+id,{dispute,disputes:history,reviewedAt:5150,reviewedBy:'afnan'}));
      const rep=await st.run(NOW+3600000);
      const d=cpd(st,id);
      s.eq('a dispute opened '+label+' is kept, exactly',J(d.dispute),J(dispute));
      s.eq('… and so is its history',J(d.disputes),J(history));
      s.eq('… the run still brought the document up to the parcels',J([d.rev,d.net]),J([2,expectDocs(P2).find(x=>x.id===id).net]));
      s.eq('… a review of the OLD figures is cleared, as it is whenever a figure moves',J([d.reviewedAt,d.reviewedBy]),J([null,null]));
      s.eq('… counted as the update it was',rep.updated,want.length);
    }
    // A change that moves no figure: the review an owner made meanwhile stays.
    const rc=EXP.find(d=>d.kind==='upfront'&&d.status==='posted');
    for(const [label,at] of [
      ['before the run\'s first write',(st,f)=>beforeFirstWrite(st,f)],
      ['between the update\'s reads and its commit',(st,f)=>midTx(st,'ma_cpr/'+rc.id,f)]]){
      const st=mk(clone(P));
      await st.run();
      st.docs['ma_cpr/'+rc.id]=Object.assign(clone(st.docs['ma_cpr/'+rc.id]),{note:'typed by nobody',sig:'old'});   // drifted; no figure differs
      at(st,()=>st.patch('ma_cpr/'+rc.id,{reviewedAt:111,reviewedBy:'afnan',dispute,disputes:history}));
      const rep=await st.run(NOW+3600000);
      const a=cpd(st,rc.id);
      s.eq('a review made '+label+' survives an update that moves no figure',J([a.reviewedAt,a.reviewedBy]),J([111,'afnan']));
      s.eq('… with the dispute and its history',J([a.dispute,a.disputes]),J([dispute,history]));
      s.eq('… while the document itself was rewritten to the parcels\' truth',J([a.note,a.rev,rep.updated]),J(['',2,1]));
    }
  }

  s.section('S3: a create that meets a document which appeared since the read merges with it — it never replaces it');
  {
    const A=EXP.find(d=>d.id==='postex-day-2026-09-04'),B=EXP.find(d=>d.id==='postex-U100'),C=EXP.find(d=>d.id==='postex-R200');
    s.ok('(three distinct documents to meet)',!!A&&!!B&&!!C);
    const st=mk(clone(P));
    // Between the run's read and its first batch: another run wrote A exactly as the core builds it; an owner
    // reviewed and disputed B after another run wrote it (its stored copy has drifted, no figure differs);
    // and an owner TYPED a document at C's id.
    const bStored=Object.assign(clone(B),{ts:NOW-1000,note:'stale',sig:'older',reviewedAt:77,reviewedBy:'ammar',dispute:{state:'open',reason:'r',by:'ammar',at:NOW-500},disputes:[{state:'open',by:'ammar',at:NOW-500}]});
    const aStored=Object.assign(clone(A),{ts:NOW-1000});
    const cTyped={id:C.id,dt:'cpr',kind:'reserve',status:'posted',date:'2026-09-12',net:7,note:'an owner typed this',derived:false};
    beforeFirstWrite(st,()=>{st.poke('ma_cpr/'+A.id,aStored);st.poke('ma_cpr/'+B.id,bStored);st.poke('ma_cpr/'+C.id,cTyped);});
    const rep=await st.run();
    const N=EXP.length;
    s.eq('the run is done',rep.state,'done');
    s.eq('created / updated / unchanged / skipped follow what was really written',J([rep.created,rep.updated,rep.unchanged,rep.skipped]),J([N-3,1,1,1]));
    s.eq('a document another run had already written correctly is left exactly as it is',J(cprDoc(st,A.id)),J(aStored));
    const b=cpd(st,B.id);
    s.eq('a document with an owner\'s review and dispute on it is brought up to the parcels, with both kept',J([b.rev,b.note,b.reviewedAt,b.reviewedBy,b.dispute,b.disputes]),J([2,'',77,'ammar',bStored.dispute,bStored.disputes]));
    s.eq('… and its history row names only what PostEx changed, not the dispute history an owner keeps',J(((b.edits||[]).slice(-1)[0]||{}).fields),J(['note']));
    s.eq('a typed document at a derived id is not touched',J(cprDoc(st,C.id)),J(cTyped));
    s.ok('… and it is reported skipped as typed',(runDoc(st).skipped||[]).some(x=>x.id===C.id&&x.why==='typed'),J(runDoc(st).skipped));
    s.eq('every other document was created, as the core builds it',J(EXP.filter(d=>[A.id,B.id,C.id].indexOf(d.id)<0).every(d=>J(Object.assign({},cprDoc(st,d.id),{ts:0}))===J(JSON.parse(J(d))))),'true');
    s.eq('the refused batch wrote nothing (a batch is all-or-nothing): only the run document\'s batch is on record',J(st.batches.map(b=>b.length)),J([2]));
    s.eq('… the documents went in one transaction each',st.txs.filter(t=>t.length).length,N-2);
    // a batch refused for any OTHER reason is not retried one by one: the run fails, and says so
    const st2=mk(clone(P),{failWrite:'PERMISSION_DENIED: the caller does not have permission'});
    const r2=await st2.run();
    s.eq('a batch refused for another reason fails the run — it is not retried document by document',J([r2.state,cprIds(st2).length,st2.txs.length]),J(['failed',0,0]));
  }

  s.section('S3: a quarter closed while the run is writing is not written into — on creation, on change and on void');
  {
    const q=EXP.find(d=>d.kind==='day').quarter;
    const inQ=EXP.filter(d=>d.quarter===q).map(d=>d.id).sort();
    const outQ=EXP.filter(d=>d.quarter!==q).map(d=>d.id).sort();
    const lock={id:q,quarter:q,locked:true};
    s.ok('(the scenario has documents on both sides of the quarter)',inQ.length>0&&outQ.length>0,J([inQ,outQ]));
    {
      // The run reads ma_closes with the rest, and once more just before each batch of creates: the close lands between the two.
      const st=mk(clone(P));
      let n=0;const base=makeAdmin(st).firestore();
      const db=Object.assign(Object.create(base),{collection(c){const col=base.collection(c);if(c!=='ma_closes')return col;
        return Object.assign(Object.create(col),{get(){n++;if(n===2)st.poke('ma_closes/'+q,lock);return col.get();}});}});
      const rep=await st.run(NOW,{db});
      s.eq('creation: a quarter closed after the run\'s first read is not written into',J(cprIds(st)),J(outQ));
      s.eq('… what was left out is reported skipped, locked, with the quarter',J((runDoc(st).skipped||[]).map(x=>x.id).sort()),J(inQ));
      s.ok('… each says locked',(runDoc(st).skipped||[]).every(x=>x.why==='locked'&&x.quarter===q));
      s.eq('… the report counts them, and creates only the rest',J([rep.skipped,rep.created]),J([inQ.length,outQ.length]));
    }
    {
      const st=mk(clone(P));
      await st.run();
      const P2=clone(P);P2.find(p=>p.trackingNumber==='B1').cod=4000;st.putParcels(P2);
      const moved=expectDocs(P2).filter(d=>d.quarter===q&&(EXP.find(x=>x.id===d.id)||{}).sig!==d.sig).map(d=>d.id);
      const before=clone(st.docs);
      beforeFirstWrite(st,()=>st.poke('ma_closes/'+q,lock));
      const rep=await st.run(NOW+3600000);
      s.ok('(the scenario changes a document in that quarter)',moved.length>0,J(moved));
      s.ok('change: a document in a quarter closed after the plan is NOT written',moved.every(id=>J(cprDoc(st,id))===J(before['ma_cpr/'+id])));
      s.ok('… it is reported skipped, locked',moved.every(id=>(runDoc(st).skipped||[]).some(x=>x.id===id&&x.why==='locked')),J(runDoc(st).skipped));
      s.eq('… counted as skipped, not updated',J([rep.updated,rep.skipped>=moved.length]),J([0,true]));
    }
    {
      const st=mk(clone(P));
      await st.run();
      st.putParcels(clone(P.filter(p=>p.trackingNumber!=='Z1')));
      const before=clone(st.docs);
      beforeFirstWrite(st,()=>st.poke('ma_closes/'+q,lock));
      const rep=await st.run(NOW+3600000);
      s.eq('void: a receipt in a quarter closed after the plan is NOT voided',J([cpd(st,'postex-U900').status,J(cprDoc(st,'postex-U900'))===J(before['ma_cpr/postex-U900']),rep.voided]),J(['posted',true,0]));
      s.ok('… and is reported skipped, locked',(runDoc(st).skipped||[]).some(x=>x.id==='postex-U900'&&x.why==='locked'),J(runDoc(st).skipped));
    }
  }

  s.section('two runs at once (the schedule and an owner\'s button): each document is written once, and a rev goes up once');
  {
    const st=mk(clone(P));
    const [a,b]=await Promise.all([st.run(NOW),st.run(NOW+1)]);
    s.eq('first night: both runs are done',J([a.state,b.state]),J(['done','done']));
    s.eq('… every document was created by exactly one of them',a.created+b.created,EXP.length);
    s.eq('… and the other found it already right',a.unchanged+b.unchanged,EXP.length);
    s.eq('… no document exists twice, none was bumped',J(cprIds(st).every(id=>cpd(st,id).rev===1)),'true');
    const P2=clone(P);P2.find(p=>p.trackingNumber==='A1').cod=3500;st.putParcels(P2);
    const want=expectDocs(P2).filter(d=>{const o=EXP.find(x=>x.id===d.id);return !o||o.sig!==d.sig;}).map(d=>d.id).sort();
    const [c,d]=await Promise.all([st.run(NOW+3600000),st.run(NOW+3600001)]);
    s.ok('(the scenario changes at least two documents)',want.length>=2,J(want));
    s.eq('a night of changes: both runs are done',J([c.state,d.state]),J(['done','done']));
    s.eq('… every changed document was updated by exactly one of them',c.updated+d.updated,want.length);
    s.eq('… and each rev went up ONCE, not twice',J(want.map(id=>cpd(st,id).rev)),J(want.map(()=>2)));
    s.eq('… every history row is one row',J(want.map(id=>cpd(st,id).edits.length)),J(want.map(()=>1)));
  }
  {
    // deterministic: another run brought one document up to date after this run planned
    const st=mk(clone(P));
    await st.run();
    const P2=clone(P);P2.find(p=>p.trackingNumber==='A1').cod=3500;st.putParcels(P2);
    const nextDocs=expectDocs(P2);
    const want=nextDocs.filter(d=>{const o=EXP.find(x=>x.id===d.id);return !o||o.sig!==d.sig;}).map(d=>d.id).sort();
    const id=want[0];
    beforeFirstWrite(st,()=>{const other=core.maCourierMerge(st.docs['ma_cpr/'+id],nextDocs.find(x=>x.id===id),{at:NOW+9,locked:()=>false});st.poke('ma_cpr/'+id,other.doc);});
    const rep=await st.run(NOW+3600000);
    s.eq('a document another run already updated is counted unchanged, and its rev is bumped once',J([rep.updated,cpd(st,id).rev,cpd(st,id).edits.length]),J([want.length-1,2,1]));
    s.ok('… and the others were still written',want.filter(x=>x!==id).every(x=>cpd(st,x).rev===2));
  }

  s.section('the guards that refuse to write');
  {
    const st=mk(clone(P));
    await st.run();
    const before=clone(st.docs);
    st.putParcels([]);
    const m0=mark(st);
    const rep=await st.run(NOW+3600000);
    s.eq('postex_orders answering with no parcels while derived documents exist fails the run',rep.state,'failed');
    s.ok('… it says so',/no parcels/.test(runDoc(st).error||''),runDoc(st).error);
    s.ok('… and voided nothing',cprIds(st).every(id=>J(cprDoc(st,id))===J(before['ma_cpr/'+id])));
    s.eq('… the failed run wrote only the run document and its audit row',J(wrote(st,m0).map(x=>x.path.split('/')[0]).sort()),J(['ma_audit','ma_runs']));
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

  // ── The reviewer's partial-run finding: a run that failed after some batches recorded written:{created:0,…}
  // although hundreds of documents were in. It says what committed, and how many writes were in flight when
  // a commit failed in a way that does not say whether it applied. ──
  s.section('a run that fails part-way records what it had written (450 receipts, the second batch fails)');
  {
    const many=[];
    for(let i=0;i<450;i++)many.push(px({trackingNumber:'W'+i,orderDeliveryDate:'2026-09-10T12:00:00',cprNumber_1:'V'+i,cpr1Date:'2026-09-15',upfrontPayment:1000}));
    const total=core.maCourierDocs(core.maCprDerive(many,{from:S.couriers.from,today:TODAY}),S).length;
    const st=mk(many);
    st.batchBefore=({n})=>{if(n===2)throw new Error('DEADLINE_EXCEEDED');};
    const rep=await st.run();
    const r=runDoc(st);
    s.eq('the run failed, with the error',J([rep.state,rep.error]),J(['failed','DEADLINE_EXCEEDED']));
    s.eq('400 documents are in ma_cpr (the first batch committed)',cprIds(st).length,400);
    s.eq('the run document says what was written: 400 created',J(r.written),J({created:400,updated:0,voided:0}));
    s.eq('… and how many writes were in flight when the commit failed (it may or may not have applied)',r.inDoubt,total-400);
    s.eq('… and how many batches committed',r.batches,1);
    s.eq('the report the function returns says the same',J([rep.created,rep.updated,rep.voided,rep.inDoubt]),J([400,0,0,total-400]));
    const row=auditRows(st)[0]||{};
    s.ok('the audit row says how far it got',/400 created/.test(row.detail)&&new RegExp('up to '+(total-400)+' more in doubt').test(row.detail),row.detail);
    // the next run finishes the job: what is there is left alone, what is missing is created
    st.batchBefore=null;
    const rep2=await st.run(NOW+3600000);
    s.eq('a later run is done, creates the rest and finds the 400 already right',J([rep2.state,rep2.created,rep2.unchanged]),J(['done',total-400,400]));
    s.ok('… and the done run carries no failure fields',runDoc(st).written===undefined&&runDoc(st).error===undefined&&cprIds(st).length===total);
  }
  {
    // the update phase: the second transaction's commit fails
    const st=mk(clone(P));
    await st.run();
    const P2=clone(P);P2.find(p=>p.trackingNumber==='A1').cod=3500;st.putParcels(P2);
    const want=expectDocs(P2).filter(d=>{const o=EXP.find(x=>x.id===d.id);return !o||o.sig!==d.sig;}).map(d=>d.id).sort();
    s.ok('(the scenario updates at least three documents)',want.length>=3,J(want));
    st.txBefore=({n})=>{if(n===2)st.failWrite='DEADLINE_EXCEEDED';};
    const rep=await st.run(NOW+3600000);
    const r=runDoc(st);
    s.eq('the run failed',rep.state,'failed');
    s.eq('one update had committed, and the run says so',J([r.written,r.transactions]),J([{created:0,updated:1,voided:0},1]));
    s.eq('the write that failed is counted as in doubt, once',r.inDoubt,1);
    s.eq('exactly one document was rewritten',want.filter(id=>cpd(st,id).rev===2).length,1);
    s.ok('the audit row says how far it got',/1 updated/.test((auditRows(st).slice(-1)[0]||{}).detail),J(auditRows(st).map(x=>x.detail)));
  }

  // ── S8: the books' side of a PostEx receipt-number conflict. postex-core keeps the receipt's own number and
  // no longer writes the new receipt's date under it; the rollup must carry the doubt to an owner. ──
  s.section('S8: a receipt-number conflict reaches the books as a flag on the stored receipt and an issue on the run');
  {
    const at0=1790100000000;
    const mkP=(tn,extra)=>px(Object.assign({trackingNumber:tn,orderDeliveryDate:'2026-09-12T10:00:00',cod:2500,transactionFee:0,transactionTax:0,cprNumber_1:'NCA',cpr1Date:'2026-09-14',upfrontPayment:2000},extra||{}));
    const NC=[mkP('NC1'),mkP('NC2'),mkP('NC3',{cprConflict:{field:'cprNumber_1',stored:'NCA',received:'NCB',at:at0}})];
    const st=mk(clone(NC));
    await st.run();
    const r=runDoc(st);
    const iss=(r.issues||[]).find(i=>i.rule==='cpr.number_conflict');
    s.ok('the run names the conflict as an issue (so the field is in the .select())',!!iss,J(r.issues));
    s.ok('… naming the parcel and both receipt numbers',!!iss&&/NC3/.test(iss.message)&&/NCA/.test(iss.message)&&/NCB/.test(iss.message),iss&&iss.message);
    const rc=cprDoc(st,'postex-NCA');
    s.ok('the receipt that is counted carries it as a flag, where the money is',!!rc&&(rc.flags||[]).some(f=>f.rule==='cpr.number_conflict'),J(rc&&rc.flags));
    s.ok('the refused number makes no receipt of its own',!cprDoc(st,'postex-NCB')&&cprIds(st).indexOf('postex-NCB')<0);
    s.ok('the run\'s count includes it',r.issueCount>=1);
    const rep2=await st.run(NOW+3600000);
    s.eq('a second run over the same parcels writes no document (the flag is part of the signature, and stable)',J([rep2.created,rep2.updated,rep2.voided]),J([0,0,0]));
    // the same parcels with the conflict record taken off: no issue, no flag — proves the record is what raised both
    const st2=mk(clone(NC.map(p=>{const q=clone(p);delete q.cprConflict;return q;})));
    await st2.run();
    s.ok('without the record there is no issue and no flag',!(runDoc(st2).issues||[]).some(i=>i.rule==='cpr.number_conflict')&&!cpd(st2,'postex-NCA').flags.length,J(runDoc(st2).issues));
    // a conflict appearing on a later night updates the receipt (a flag is part of the document)
    const st3=mk(clone(NC.map(p=>{const q=clone(p);delete q.cprConflict;return q;})));
    await st3.run();
    st3.putParcels(clone(NC));
    const rep3=await st3.run(NOW+3600000);
    s.eq('a conflict that appears later updates the receipt it is flagged on, once',J([rep3.updated,cpd(st3,'postex-NCA').rev,cpd(st3,'postex-NCA').flags.length]),J([1,2,1]));
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
    const mkNow=(state)=>{delete require.cache[src];const st=Object.assign({tokens:TOKENS,docs:{},strictTx:true},state||{});ALL.push(st);
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

  s.section('the fake Firestore enforces what the write path relies on (so the sections above prove something)');
  {
    const a={docs:{'x/1':{a:1}},strictTx:true};const dbA=makeAdmin(a).firestore();
    let err='';
    try{await dbA.runTransaction(async tx=>{tx.set(dbA.collection('x').doc('1'),{a:2});await tx.get(dbA.collection('x').doc('1'));});}catch(e){err=e.message;}
    s.ok('a transaction that reads after it wrote is refused, as Firestore refuses it',/all reads/.test(err),err);
    const b={docs:{},strictTx:true};const dbB=makeAdmin(b).firestore();
    let runs=0;
    b.txAfterBody=x=>{if(x.attempt===0)b.poke('y/1',{k:['a']});};
    await dbB.runTransaction(async tx=>{runs++;const r=await tx.get(dbB.collection('y').where('k','array-contains','a'));if(r.empty)tx.set(dbB.collection('z').doc('1'),{n:0});});
    s.eq('a matching document that appears after a transaction\'s query makes its body run again (a phantom)',runs,2);
    const c={docs:{'x/1':{a:1}}};const dbC=makeAdmin(c).firestore();
    let code=null;
    try{const bt=dbC.batch();bt.create(dbC.collection('x').doc('1'),{a:2});await bt.commit();}catch(e){code=e.code;}
    s.eq('create() on a document that exists is ALREADY_EXISTS (gRPC 6), and the batch wrote nothing',J([code,c.docs['x/1']]),J([6,{a:1}]));
    let n=0;const d={docs:{'x/1':{a:1}}};const dbD=makeAdmin(d).firestore();
    d.txBefore=()=>{n++;};d.batchBefore=()=>{n+=10;};
    await dbD.runTransaction(async tx=>{await tx.get(dbD.collection('x').doc('1'));});await dbD.batch().commit();
    s.eq('the hooks fire: once before a transaction, once before a batch',n,11);
  }

  s.section('no run threw');
  s.eq('not one run of the function threw, in any section above',J(ALL.map(st=>st.thrown||[]).reduce((x,y)=>x.concat(y),[])),J([]));
  return s;
};

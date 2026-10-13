/* ─────────────────────────────────────────────────────────────────────────
   PO numbering, delete and cancel (B12 / B13 / B14, Oct 2026)

   B12/B13 — a PO number used to be minted BEFORE the PO was written
   (getNextId's own transaction, then a plain setDoc), so a refused or offline
   write spent a number, and a counter that had been reset restarted at 1 and
   setDoc silently OVERWROTE PO-001. The number is now minted inside the same
   transaction as the PO write (createWithNextId, js/shared.js).

   B14 — deletePO removed only the PO document and left every bundle,
   embellishment job, gate pass, transfer and trim request that named it. It
   now REFUSES when anything is linked and offers a non-destructive Cancel.

   These DRIVE the real entry points (window.submitPO, window.deletePO,
   window.cancelPO) against the real js/shared.js createWithNextId and an
   in-memory Firestore whose transactions are all-or-nothing and enforce
   "every read before every write" — the two rules a transaction mock that
   just runs the callback would never catch. They prove the logic, not how it
   looks on a screen, and not what the live Firestore does.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');

const FILES=['js/shared.js','js/pos.js'];
const J=v=>JSON.stringify(v);
// Null-safe read of a document: an assertion should NAME a missing document,
// not crash the whole suite on `undefined.pos` (a revert would then show as
// "suite threw" and hide every section after it).
const at=(a,p)=>a.db.get(p)||{};
const OWNER={uid:'u1',u:'afnan',name:'Afnan',role:'owner',canPO:true};
const MUSTAFA={uid:'u2',u:'mustafa',name:'Mustafa',role:'manager',canPO:true};
const ARFAT={uid:'u3',u:'arfat',name:'Arfat',role:'manager',canPO:true};

// The real HTML escape lives in js/gatepass.js and pos.js calls it by bare
// name. Lifted from the source rather than re-typed, so it cannot drift.
const ESC_SRC=fs.readFileSync(path.join(ROOT,'js/gatepass.js'),'utf8').match(/function _gpEsc\(s\)\{[^\n]*\}/)[0];

/* An in-memory Firestore with the properties that matter here:
     - a transaction applies ALL its writes or NONE (commit can be made to fail)
     - a read after a write inside a transaction throws, as in the real SDK
     - tx.update on a document that does not exist throws, as in the real SDK
     - getDocs honours where(field,'==',value) on a collection            */
function fakeFirestore(seed){
  const store=new Map(Object.entries(seed||{}).map(([k,v])=>[k,JSON.parse(J(v))]));
  const fail={commit:null,read:null,cached:null,err:null};
  const log={commits:0,attempts:0,deleted:[]};
  const snap=path=>({exists:()=>store.has(path),data:()=>store.has(path)?JSON.parse(J(store.get(path))):undefined});
  const apply=w=>{
    if(w.op==='set')store.set(w.ref.path,JSON.parse(J(w.data)));
    else if(w.op==='update'){
      if(!store.has(w.ref.path))throw new Error('NOT_FOUND: no document to update: '+w.ref.path);
      store.set(w.ref.path,Object.assign({},store.get(w.ref.path),JSON.parse(J(w.data))));
    }else if(w.op==='delete')store.delete(w.ref.path);
  };
  const globals={
    db:{},
    doc:(db,col,id)=>({path:col+'/'+id,col,id}),
    collection:(db,col)=>({col}),
    where:(f,op,v)=>({f,op,v}),
    orderBy:()=>({}),limit:()=>({}),
    query:(c,...cs)=>({col:c.col,cs}),
    getDocs:async q=>{
      if(fail.read&&fail.read(q.col))throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      const docs=[];
      store.forEach((v,k)=>{
        const i=k.indexOf('/');if(k.slice(0,i)!==q.col)return;
        if((q.cs||[]).every(w=>w.op!=='=='||v[w.f]===w.v))docs.push({id:k.slice(i+1),data:()=>JSON.parse(J(v))});
      });
      return{docs,empty:docs.length===0,size:docs.length,metadata:{fromCache:!!(fail.cached&&fail.cached(q.col))}};
    },
    getDoc:async ref=>snap(ref.path),
    setDoc:async(ref,data)=>{apply({op:'set',ref,data});},
    updateDoc:async(ref,data)=>{apply({op:'update',ref,data});},
    deleteDoc:async ref=>{log.deleted.push(ref.path);apply({op:'delete',ref});},
    runTransaction:async(db,fn)=>{
      log.attempts++;
      const pending=[];
      const tx={
        get:async ref=>{
          if(pending.length)throw new Error('Firestore transactions require all reads to be executed before all writes.');
          return snap(ref.path);
        },
        set(ref,data){pending.push({op:'set',ref,data});return tx;},
        update(ref,data){pending.push({op:'update',ref,data});return tx;},
        delete(ref){pending.push({op:'delete',ref});return tx;}
      };
      const r=await fn(tx);
      if(fail.commit&&fail.commit(pending))throw Object.assign(new Error((fail.err&&fail.err.message)||'Missing or insufficient permissions.'),{code:(fail.err&&fail.err.code)||'permission-denied'});
      // All-or-nothing: validate every write before applying any.
      pending.forEach(w=>{if(w.op==='update'&&!store.has(w.ref.path))throw new Error('NOT_FOUND: no document to update: '+w.ref.path);});
      pending.forEach(apply);
      log.commits++;
      return r;
    }
  };
  return{store,fail,log,globals,get:p=>store.has(p)?JSON.parse(J(store.get(p))):undefined};
}

function mkApp(seed,opts){
  opts=opts||{};
  const db=fakeFirestore(seed);
  const calls={restock:[]};
  const a=loadApp({files:FILES,currentPage:'dashboard',globals:Object.assign({},db.globals,{
    _poEmbellishment:null,
    fabReleaseForPO:async id=>{calls.restock.push(id);return 2;},
    confirm:m=>{(calls.confirms=calls.confirms||[]).push(String(m));return opts.confirm===undefined?true:(typeof opts.confirm==='function'?opts.confirm(m):opts.confirm);},
    prompt:m=>{(calls.prompts=calls.prompts||[]).push(String(m));return opts.prompt===undefined?'':opts.prompt;}
  },opts.globals||{})});
  a.run('session='+J(opts.session||OWNER));
  a.run(ESC_SRC);
  // shared.js defines its own showToast/logActivity/uploadToCloudinary/loadData
  // (pos.js defines loadData), which shadow the harness stubs — replace them
  // AFTER load. None of the four is what is under test.
  a.run('globalThis.__toasts=[];showToast=function(m){__toasts.push(String(m));};');
  a.run('globalThis.__acts=[];logActivity=async function(x,d){__acts.push(x+" | "+d);};');
  a.run("uploadToCloudinary=async function(){return 'https://res.cloudinary.com/x/up.jpg';};");
  a.run('loadData=async function(){};');
  a.run('allPOs=[];allPasses=[];allFabricInventory=[];');
  return Object.assign(a,{db,calls,toasts:()=>a.run('__toasts'),acts:()=>a.run('__acts')});
}

// Fill the New-PO form the way a person would and press Create.
async function createPO(a,over){
  const v=Object.assign({'po-name':'Tee','po-code':'GST001','po-qty':'100','po-fabric':'Terry'},over||{});
  Object.keys(v).forEach(k=>{a.el(k).value=v[k];});
  a.run("poImages.front='x';");
  await a.run('window.submitPO()');
}
const po=(n,extra)=>Object.assign({id:'PO-'+String(n).padStart(3,'0'),fbKey:'PO-'+String(n).padStart(3,'0'),name:'PO '+n,qty:100,fabric:'Terry',createdAt:'2026-09-01',poStatus:'reserved',currentStage:null,stages:{cutting:{done:false}}},extra||{});
const seedPOs=(...ns)=>ns.reduce((m,n)=>{m['pos/'+po(n).id]=po(n);return m;},{});
const load=(a,...ns)=>a.run('allPOs='+J(ns.map(n=>po(n))));

module.exports=async function(){
  const s=suite('po-numbering');

  // ── B12: a write that does not land never moves the counter ───────────
  s.section('a failed PO write keeps the counter (no burnt number)');
  {
    const a=mkApp(Object.assign({'counters/main':{pos:6,gatepasses:2,bundles:9,fabricin:4}},seedPOs(1,2,3,4,5,6)));
    load(a,1,2,3,4,5,6);
    // The rules refuse the PO write (or the connection drops): the commit fails.
    a.db.fail.commit=pending=>pending.some(w=>w.ref.path.indexOf('pos/')===0);
    await createPO(a);
    s.ok('the person is told it failed',a.toasts().some(t=>/^Error:/.test(t)),a.toasts().join('|'));
    s.eq('no PO-007 exists',a.db.get('pos/PO-007'),undefined);
    s.eq('the counter did NOT move',at(a,'counters/main').pos,6);
    s.eq('the other counters are untouched',J([at(a,'counters/main').gatepasses,at(a,'counters/main').bundles,at(a,'counters/main').fabricin]),J([2,9,4]));
    // Retrying once the write can land gets the very next number — no gap.
    a.db.fail.commit=null;
    await createPO(a);
    const made=a.db.get('pos/PO-007')||null;
    s.ok('the retry is PO-007, not PO-008',!!made&&made.id==='PO-007',J(made&&made.id));
    s.eq('and the counter is now 7',at(a,'counters/main').pos,7);
    s.ok('the success toast is clean (no trim-request noise)',a.toasts().some(t=>/^PO-007 created ✓$/.test(t)),a.toasts().join('|'));
    s.eq('the PO carries what was typed',J([made&&made.name,made&&made.code,made&&made.qty,made&&made.fabric]),J(['Tee','GST001',100,'Terry']));
    s.eq('stored status is reserved with no stage',J([made&&made.poStatus,made&&made.currentStage]),J(['reserved',null]));
  }

  s.section('the counter and the PO are ONE transaction');
  {
    const a=mkApp(Object.assign({'counters/main':{pos:2}},seedPOs(1,2)));
    load(a,1,2);
    let kinds=null;
    a.db.fail.commit=pending=>{kinds=pending.map(w=>w.op+':'+w.ref.path);return false;};
    await createPO(a);
    s.eq('exactly one commit carried both writes',J(kinds),J(['update:counters/main','set:pos/PO-003']));
    s.eq('one transaction in total',a.db.log.commits,1);
  }

  // ── B13: an existing id is never overwritten ──────────────────────────
  s.section('an existing PO id is never overwritten');
  {
    const original=po(1,{name:'ORIGINAL PO-001',qty:480});
    // counters/main was reset and this screen's list is stale (it loaded, but
    // does not hold PO-001): floor 0, counter 0 -> the mint lands on PO-001.
    const stale='allPOs=[{id:"junk",fbKey:"junk"}]';
    const a=mkApp({'counters/main':{pos:0,gatepasses:5},'pos/PO-001':original});
    a.run(stale);
    await createPO(a);
    s.eq('PO-001 is byte-identical',J(a.db.get('pos/PO-001')),J(original));
    s.eq('no other PO appeared',[...a.db.store.keys()].filter(k=>k.indexOf('pos/')===0).length,1);
    s.eq('the counter did not move',at(a,'counters/main').pos,0);
    s.ok('the refusal says it already exists',a.toasts().some(t=>/PO-001 already exists/.test(t)),a.toasts().join('|'));
    s.ok('and says nothing was overwritten',a.toasts().some(t=>/nothing was overwritten/.test(t)));
    s.ok('the button is usable again',a.el('po-submit-btn').disabled===false);

    // The same with the counter doc missing outright.
    const b=mkApp({'pos/PO-001':original});
    b.run(stale);
    await createPO(b);
    s.eq('counters/main missing: PO-001 still untouched',J(b.db.get('pos/PO-001')),J(original));
    s.eq('and no counters document was invented',b.db.get('counters/main'),undefined);
  }

  s.section('no PO list loaded: the floor comes from the server, or the create is refused');
  {
    const original=po(1,{name:'ORIGINAL PO-001'}),third=po(3);
    // List never loaded, counter reset, PO-001 and PO-003 exist: do NOT loop on
    // "already exists" — read the ids, mint PO-004.
    const a=mkApp({'counters/main':{pos:0},'pos/PO-001':original,'pos/PO-003':third});
    await createPO(a);
    s.ok('PO-004 is minted past the highest existing PO',!!a.db.get('pos/PO-004'),[...a.db.store.keys()].join(','));
    s.eq('PO-001 untouched',J(a.db.get('pos/PO-001')),J(original));
    s.eq('counter healed to 4',at(a,'counters/main').pos,4);
    // The very first PO in an empty system still works.
    const f=mkApp({});
    await createPO(f);
    s.ok('an empty system mints PO-001',!!f.db.get('pos/PO-001'),f.toasts().join('|'));
    // The PO read is refused: refuse, say reload first, change nothing.
    const b=mkApp({'counters/main':{pos:0},'pos/PO-001':original});
    b.db.fail.read=col=>col==='pos';
    await createPO(b);
    s.ok('a refused read says to reload first',b.toasts().some(t=>/PO list did not load.*Reload the page first.*Nothing was created/.test(t)),b.toasts().join('|'));
    s.eq('nothing written',J([b.db.get('pos/PO-001'),at(b,'counters/main').pos,b.db.store.size]),J([original,0,2]));
    s.ok('and the button is usable',b.el('po-submit-btn').disabled===false);
    // An answer from the offline cache is not an answer either.
    const c=mkApp({'counters/main':{pos:0},'pos/PO-001':original});
    c.db.fail.cached=col=>col==='pos';
    await createPO(c);
    s.ok('a cached PO list is refused too',c.toasts().some(t=>/PO list did not load/.test(t))&&c.db.store.size===2,c.toasts().join('|'));
  }

  s.section('offline: a clear message, nothing created, the form kept');
  {
    const a=mkApp({'counters/main':{pos:6},'pos/PO-006':po(6)});
    load(a,6);
    a.db.fail.commit=()=>true;
    a.db.fail.err={code:'unavailable',message:'Failed to get document because the client is offline.'};
    await createPO(a);
    s.ok('says it needs a connection and nothing was created',a.toasts().some(t=>/^Needs a connection; nothing was created/.test(t)),a.toasts().join('|'));
    s.ok('and is not the generic Error: toast',!a.toasts().some(t=>/^Error:/.test(t)));
    s.eq('no PO and the counter unmoved',J([a.db.get('pos/PO-007'),at(a,'counters/main').pos]),J([undefined,6]));
    s.eq('the typed form is still there',J([a.el('po-name').value,a.el('po-qty').value,a.run('poImages.front')]),J(['Tee','100','x']));
    s.ok('the button is usable again',a.el('po-submit-btn').disabled===false);
    // A failure AFTER the PO was written must not claim nothing was created.
    const c=mkApp({'counters/main':{pos:6},'pos/PO-006':po(6)});load(c,6);
    c.run('loadData=async function(){throw new Error("Failed to get document because the client is offline.")};');
    await createPO(c);
    s.ok('the PO exists',!!c.db.get('pos/PO-007'));
    s.ok('and the toast does not say nothing was created',!c.toasts().some(t=>/nothing was created/.test(t)),c.toasts().join('|'));
    // A refusal that is NOT connectivity keeps the plain error.
    const b=mkApp({'counters/main':{pos:6},'pos/PO-006':po(6)});load(b,6);
    b.db.fail.commit=()=>true;
    await createPO(b);
    s.ok('a permission refusal still reads Error:',b.toasts().some(t=>/^Error: Missing or insufficient/.test(t))&&!b.toasts().some(t=>/Needs a connection/.test(t)));
  }

  // ── B13: the floor ────────────────────────────────────────────────────
  s.section('a reset counter cannot mint at or below a loaded PO');
  {
    const seed=Object.assign({},seedPOs(1,2,3,4,5));
    const a=mkApp(seed);                     // counters/main does not exist at all
    load(a,1,2,3,4,5);
    const before=J([1,2,3,4,5].map(n=>a.db.get('pos/PO-00'+n)));
    await createPO(a);
    s.ok('the new PO is PO-006',!!a.db.get('pos/PO-006'),[...a.db.store.keys()].join(','));
    s.eq('PO-001..005 are byte-identical',J([1,2,3,4,5].map(n=>a.db.get('pos/PO-00'+n))),before);
    s.eq('the counter was created at 6',at(a,'counters/main').pos,6);

    const b=mkApp(Object.assign({'counters/main':{pos:2,returns:9}},seedPOs(1,2,3,4,5)));
    load(b,1,2,3,4,5);
    await createPO(b);
    s.ok('a counter BEHIND the loaded POs still mints PO-006',!!b.db.get('pos/PO-006'));
    s.eq('and is healed to 6',at(b,'counters/main').pos,6);
    s.eq('without touching the other counters',at(b,'counters/main').returns,9);

    const c=mkApp(Object.assign({'counters/main':{pos:40}},seedPOs(1,2)));
    load(c,1,2);
    await createPO(c);
    s.ok('a counter AHEAD of the loaded POs is respected (PO-041)',!!c.db.get('pos/PO-041')&&!c.db.get('pos/PO-003'));

    s.eq('the floor reads ids and keys, ignores non-PO ids',
      a.run('(allPOs=[{id:"PO-012",fbKey:"PO-012"},{id:"junk",fbKey:"fabric-issue-9"},{id:"PO-12x"},{fbKey:"PO-0040"},null],_poNumberFloor())'),40);
    s.eq('an empty list floors at 0',a.run('(allPOs=[],_poNumberFloor())'),0);
    s.eq('ids past 999 keep counting (PO-1000)',a.run('_poIdFor(1000)'),'PO-1000');
  }

  s.section('createWithNextId itself');
  {
    const a=mkApp({});
    // (the closures cannot be JSON'd — drive it from inside the sandbox)
    a.run('globalThis.__mint=(floor)=>createWithNextId({field:"pos",collection:"pos",floor,idFor:n=>"X-"+n,build:(n,id)=>({id,n})})');
    const mint=async f=>{try{return await a.run('__mint('+f+')');}catch(e){return{err:e.message};}};
    const r1=await mint(0),r2=await mint(0);
    s.eq('first mint is 1',J([r1.n,r1.id]),J([1,'X-1']));
    s.eq('second mint is 2 — consecutive',J([r2.n,r2.id]),J([2,'X-2']));
    s.eq('a floor lifts the number past it',(await mint(10)).n,11);
    s.eq('a negative or junk floor is ignored',(await mint(-5)).n,12);
    let threw=null;try{await a.run('createWithNextId({field:"pos"})');}catch(e){threw=e.message;}
    s.ok('missing arguments are refused up front',/required/.test(threw||''),threw);
    // A build() that throws must leave the counter exactly where it was.
    const counterBefore=at(a,'counters/main').pos;let thrown=null;
    try{await a.run('createWithNextId({field:"pos",collection:"pos",idFor:n=>"Y-"+n,build:()=>{throw new Error("nope")}})');}catch(e){thrown=e.message;}
    s.ok('a throwing build is reported',thrown==='nope',thrown);
    s.eq('and moved nothing',at(a,'counters/main').pos,counterBefore);
  }

  s.section('getNextId: existing callers unchanged, floor optional');
  {
    const a=mkApp({'counters/main':{pos:3,gatepasses:5,returns:2}});
    const gn=async c=>{try{return await a.run(c);}catch(e){return 'threw: '+e.message;}};
    s.eq('no opts: counter+1 as before',await gn('getNextId("gatepasses")'),6);
    s.eq('and only that field moved',J(a.db.get('counters/main')),J({pos:3,gatepasses:6,returns:2}));
    s.eq('a floor above the counter lifts it',await gn('getNextId("gatepasses",{floor:20})'),21);
    s.eq('a floor below the counter changes nothing',await gn('getNextId("gatepasses",{floor:3})'),22);
    const b=mkApp({});
    s.eq('missing counters doc: starts at 1',await b.run('getNextId("returns")'),1);
    s.eq('and seeds the other fields at 0, as before',J(b.db.get('counters/main')),J({pos:0,gatepasses:0,bundles:0,returns:1}));
  }

  // ── B19 (PO part): the date is the PKT day ────────────────────────────
  s.section('createdAt is the PKT day, not the UTC day');
  {
    const a=mkApp({});
    const at=(y,m,d,h,mi)=>Date.UTC(y,m,d,h,mi||0);
    // 01:00 PKT on 10 Oct is 20:00 UTC on 9 Oct. toISOString().slice(0,10)
    // names the PREVIOUS day — that is the bug.
    const ms=at(2026,9,9,20,0);
    s.eq('(the old expression gives the UTC day)',new Date(ms).toISOString().slice(0,10),'2026-10-09');
    s.eq('01:00 PKT is the 10th',a.run('_poPktDay('+ms+')'),'2026-10-10');
    s.eq('04:59 PKT is still the 10th',a.run('_poPktDay('+at(2026,9,9,23,59)+')'),'2026-10-10');
    s.eq('23:59 PKT is still the 9th',a.run('_poPktDay('+at(2026,9,9,18,59)+')'),'2026-10-09');
    s.eq('00:00 PKT rolls to the 10th',a.run('_poPktDay('+at(2026,9,9,19,0)+')'),'2026-10-10');
    s.eq('month and year roll over',a.run('_poPktDay('+at(2026,11,31,19,30)+')'),'2027-01-01');
    s.eq('a non-number falls back to now (a valid day)',/^\d{4}-\d{2}-\d{2}$/.test(a.run('_poPktDay(undefined)')),true);
    // And the STORED PO uses it. Freeze every clock read — Date.now() AND a
    // bare new Date() — at 01:00 PKT on the 10th (20:00 UTC on the 9th), the
    // window in which the UTC day is the wrong one.
    const FixedDate=class extends Date{
      constructor(...a){if(a.length===0)super(ms);else super(...a);}
      static now(){return ms;}
    };
    const b=mkApp({},{globals:{Date:FixedDate}});
    await createPO(b);
    const stored=b.db.get('pos/PO-001')||{};
    s.eq('the clock really is frozen at 01:00 PKT (stored ts)',stored.ts,ms);
    s.eq('a PO made at 01:00 PKT on the 10th is stored dated the 10th',stored.createdAt,'2026-10-10');
    s.ok('(the UTC date of that instant is the 9th — the old value)',new FixedDate().toISOString().slice(0,10)==='2026-10-09');
  }

  // ── B14: delete is refused while anything is linked ───────────────────
  const linked={
    bundles:{'bundles/B-0001':{bundleId:'B-0001',poId:'PO-010'},'bundles/B-0002':{bundleId:'B-0002',poId:'PO-010'},'bundles/B-0003':{bundleId:'B-0003',poId:'PO-010'}},
    gp:{'gatepasses/GP-001':{id:'GP-001',gpType:'fabric',poId:'PO-010'}},
    job:{'printing_jobs/J1':{poNumber:'PO-010'}}
  };
  const reg=(extra)=>Object.assign({'pos/PO-010':po(10,{poStatus:'in_production',currentStage:'cutting'})},extra||{});

  s.section('delete is REFUSED when bundles exist — and nothing changes');
  {
    const a=mkApp(reg(linked.bundles),{confirm:false});
    load(a,10);
    await a.run('window.deletePO("PO-010","PO-010")');
    s.eq('no delete was issued',a.db.log.deleted.length,0);
    s.ok('the PO document is still there',!!a.db.get('pos/PO-010'));
    s.eq('all three bundles are still there',[...a.db.store.keys()].filter(k=>k.indexOf('bundles/')===0).length,3);
    const t=a.toasts().join(' | ');
    s.ok('the message says cannot be deleted',/PO-010 cannot be deleted/.test(t),t);
    s.ok('it lists the count: 3 bundles',/3 bundles/.test(t),t);
    s.ok('and that nothing was changed',/Nothing was changed/.test(t));
    s.eq('the fabric restock did NOT run for a refused delete',a.calls.restock.length,0);
    s.eq('no "PO deleted" activity',a.acts().filter(x=>/^PO deleted/.test(x)).length,0);
    s.ok('Cancel was offered instead',(a.calls.confirms||[]).some(m=>/Cancel PO PO-010 instead/.test(m)),J(a.calls.confirms));
    s.eq('declining the offer writes nothing',at(a,'pos/PO-010').poStatus,'in_production');
  }

  s.section('every kind of link counts');
  {
    const cases=[
      ['a fabric-issue gate pass',reg(linked.gp),/1 fabric issue \/ gate pass\b/],
      ['an embellishment job (by poNumber)',reg(linked.job),/1 embellishment job\b/],
      ['a stock transfer',reg({'stock_transfers/T1':{poId:'PO-010'}}),/1 stock transfer\b/],
      ['a B-stock item',reg({'bstock_items/I1':{poId:'PO-010'}}),/1 B-stock item\b/],
      ['a trim issue request',reg({'po_issue_requests/PIR-PO-010':{poId:'PO-010'}}),/1 trim issue request\b/],
      ['a Production Ops cut job (po_cut_jobs/PO-010, 14 Oct 2026)',reg({'po_cut_jobs/PO-010':{poId:'PO-010',status:'open',plannedCutDate:'2026-10-14'}}),/1 Production Ops cut job\b/],
      ['a Production Ops draft issued as this PO (po_drafts, issuedPoId)',reg({'po_drafts/DRAFT-1-ABCD':{status:'ready',issuedPoId:'PO-010'}}),/1 Production Ops draft\b/],
      ['all of them at once',reg(Object.assign({},linked.bundles,linked.gp,linked.job)),/3 bundles.*1 fabric issue.*1 embellishment job|1 fabric issue.*3 bundles.*1 embellishment job/]
    ];
    for(const [label,seed,re] of cases){
      const a=mkApp(seed,{confirm:false});load(a,10);
      await a.run('window.deletePO("PO-010","PO-010")');
      s.ok(label+': refused',a.db.log.deleted.length===0&&!!a.db.get('pos/PO-010'));
      s.ok(label+': named in the message',re.test(a.toasts().join(' | ')),a.toasts().join(' | '));
    }
    // A record ANOTHER spelling points at: a free-text 'po-10' on a gate pass.
    const b=mkApp(reg({}),{confirm:false});load(b,10);
    b.run('allPasses='+J([{id:'GP-009',poId:'po-10',gpType:'fabric'}]));
    await b.run('window.deletePO("PO-010","PO-010")');
    s.ok('a gate pass loaded in memory under "po-10" counts (the server has none)',b.db.log.deleted.length===0&&/fabric issue/.test(b.toasts().join(' | ')),b.toasts().join(' | '));
    const c=mkApp(reg({}),{confirm:true});load(c,10);
    c.run('allPasses='+J([{id:'GP-011',poId:'PO-011'}]));
    await c.run('window.deletePO("PO-010","PO-010")');
    s.ok('a gate pass for ANOTHER PO does not block this one',c.db.log.deleted.length===1,J(c.db.log.deleted));
  }

  s.section('production written into the PO itself also blocks a delete');
  {
    const withStage=po(10,{poStatus:'in_production',currentStage:'bundling',stages:{cutting:{done:true},bundling:{done:false}}});
    const a=mkApp({'pos/PO-010':withStage},{confirm:false});a.run('allPOs='+J([withStage]));
    await a.run('window.deletePO("PO-010","PO-010")');
    s.ok('a finished stage blocks it',a.db.log.deleted.length===0&&/production already recorded on the PO itself/.test(a.toasts().join(' | ')),a.toasts().join(' | '));
    const withCut=po(10,{cutQty:{M:40,L:60}});
    const b=mkApp({'pos/PO-010':withCut},{confirm:false});b.run('allPOs='+J([withCut]));
    await b.run('window.deletePO("PO-010","PO-010")');
    s.ok('a recorded cut blocks it',b.db.log.deleted.length===0);
    const withRecv=po(10,{packingReceipts:[{size:'M',qty:5}]});
    const c=mkApp({'pos/PO-010':withRecv},{confirm:false});c.run('allPOs='+J([withRecv]));
    await c.run('window.deletePO("PO-010","PO-010")');
    s.ok('packing receipts block it',c.db.log.deleted.length===0);
    s.eq('a fresh PO has none',mkApp({}).run('_poOwnRecords('+J(po(1))+')'),0);
    s.eq('an all-zero cut is not a cut',mkApp({}).run('_poOwnRecords({cutQty:{M:0,L:0},stages:{cutting:{done:false}}})'),0);
  }

  s.section('a lookup that cannot be trusted refuses the delete');
  {
    const a=mkApp(reg({}),{confirm:true});load(a,10);
    a.db.fail.read=col=>col==='bundles';
    await a.run('window.deletePO("PO-010","PO-010")');
    s.eq('a refused read of bundles: nothing deleted',a.db.log.deleted.length,0);
    s.ok('and the message names bundles',/could not read bundles/.test(a.toasts().join(' | ')),a.toasts().join(' | '));
    s.eq('no restock either',a.calls.restock.length,0);
    s.eq('and no confirm was asked (nothing to confirm)',(a.calls.confirms||[]).length,0);

    const b=mkApp(reg({}),{confirm:true});load(b,10);
    b.db.fail.cached=col=>col==='printing_jobs';     // answered from the offline cache
    await b.run('window.deletePO("PO-010","PO-010")');
    s.ok('an answer from the offline cache is not trusted',b.db.log.deleted.length===0&&/could not read printing_jobs/.test(b.toasts().join(' | ')),b.toasts().join(' | '));
  }

  s.section('a PO with nothing linked is still deletable, exactly as before');
  {
    const a=mkApp(reg({}),{confirm:true});load(a,10);
    await a.run('window.deletePO("PO-010","PO-010")');
    s.eq('the PO document was deleted',J(a.db.log.deleted),J(['pos/PO-010']));
    s.eq('reserved fabric was restocked, as before',J(a.calls.restock),J(['PO-010']));
    s.ok('and says so',a.toasts().some(t=>/PO PO-010 deleted · 2 fabric roll\(s\) restocked/.test(t)),a.toasts().join('|'));
    s.ok('and was logged',a.acts().some(x=>/^PO deleted \| PO PO-010 deleted/.test(x)));
    const b=mkApp(reg({}),{confirm:false});load(b,10);
    await b.run('window.deletePO("PO-010","PO-010")');
    s.ok('answering no to the confirm deletes nothing',b.db.log.deleted.length===0&&!!b.db.get('pos/PO-010'));
    const c=mkApp(reg({}),{session:ARFAT});load(c,10);
    await c.run('window.deletePO("PO-010","PO-010")');
    s.ok('a manager who is not Mustafa cannot delete (and no lookup ran)',c.db.log.deleted.length===0&&!(c.calls.confirms||[]).length&&/Not authorized/.test(c.toasts().join('|')));
  }

  // ── Cancel ────────────────────────────────────────────────────────────
  s.section('cancel writes only new fields, keeps the old values, deletes nothing');
  {
    const a=mkApp(reg(linked.bundles),{prompt:'  Buyer pulled the order  '});
    load(a,10);a.run('allPOs[0].poStatus="in_production";allPOs[0].currentStage="cutting"');
    const before=a.db.get('pos/PO-010')||{};
    await a.run('window.cancelPO("PO-010","PO-010")');
    const after=a.db.get('pos/PO-010')||{};
    s.eq('status is cancelled',after.poStatus,'cancelled');
    s.eq('the stage is cleared so pipeline counts drop it',after.currentStage,null);
    s.eq('the old status is kept',after.cancelledFromStatus,'in_production');
    s.eq('the old stage is kept',after.cancelledFromStage,'cutting');
    s.eq('the reason is trimmed and kept',after.cancelledReason,'Buyer pulled the order');
    s.eq('who',after.cancelledBy,'Afnan');
    s.ok('when (ISO)',/^\d{4}-\d{2}-\d{2}T/.test(after.cancelledAt||''),after.cancelledAt);
    const changed=Object.keys(after).filter(k=>J(after[k])!==J(before[k])).sort();
    s.eq('exactly these fields changed — nothing else',J(changed),J(['cancelledAt','cancelledBy','cancelledFromStage','cancelledFromStatus','cancelledReason','currentStage','poStatus']));
    s.eq('nothing was deleted',a.db.log.deleted.length,0);
    s.eq('the bundles are all still there',[...a.db.store.keys()].filter(k=>k.indexOf('bundles/')===0).length,3);
    s.ok('it was logged',a.acts().some(x=>/^PO cancelled \| PO-010 cancelled by Afnan — Buyer pulled the order/.test(x)),J(a.acts()));
    s.eq('the fabric restock did not run (cancel does not touch inventory)',a.calls.restock.length,0);
  }

  s.section('cancel through the refused delete (the offer)');
  {
    const a=mkApp(reg(linked.bundles),{confirm:true,prompt:'Duplicate of PO-011'});
    load(a,10);
    await a.run('window.deletePO("PO-010","PO-010")');
    s.eq('still nothing deleted',a.db.log.deleted.length,0);
    s.eq('accepting the offer cancelled it',at(a,'pos/PO-010').poStatus,'cancelled');
    s.eq('with the reason typed at the prompt',at(a,'pos/PO-010').cancelledReason,'Duplicate of PO-011');
    // Once cancelled, a delete is refused and the offer is not repeated.
    const b=mkApp(Object.assign(reg(linked.bundles),{'pos/PO-010':po(10,{poStatus:'cancelled',currentStage:null})}),{confirm:true,prompt:'x'});
    load(b,10);b.run('allPOs[0].poStatus="cancelled"');
    await b.run('window.deletePO("PO-010","PO-010")');
    s.ok('a cancelled PO with bundles is still refused',b.db.log.deleted.length===0);
    s.eq('and Cancel is not offered again',(b.calls.confirms||[]).length,0);
  }

  s.section('cancel: who, and the guards');
  {
    const a=mkApp(reg({}),{prompt:'why not',session:MUSTAFA});load(a,10);
    await a.run('window.cancelPO("PO-010","PO-010")');
    s.eq('Mustafa can cancel',at(a,'pos/PO-010').poStatus,'cancelled');
    const b=mkApp(reg({}),{prompt:'why not',session:ARFAT});load(b,10);
    await b.run('window.cancelPO("PO-010","PO-010")');
    s.ok('Arfat (same role, not Mustafa) cannot',at(b,'pos/PO-010').poStatus==='in_production'&&/Not authorized/.test(b.toasts().join('|')));
    const c=mkApp(reg({}),{prompt:'   '});load(c,10);
    await c.run('window.cancelPO("PO-010","PO-010")');
    s.ok('a blank reason cancels nothing',at(c,'pos/PO-010').poStatus==='in_production'&&/a reason is required/.test(c.toasts().join('|')));
    const d=mkApp(reg({}),{prompt:null});load(d,10);
    await d.run('window.cancelPO("PO-010","PO-010")');
    s.eq('dismissing the prompt cancels nothing',at(d,'pos/PO-010').poStatus,'in_production');
    const e=mkApp({'pos/PO-010':po(10,{poStatus:'cancelled'})},{prompt:'again'});load(e,10);e.run('allPOs[0].poStatus="cancelled"');
    await e.run('window.cancelPO("PO-010","PO-010")');
    s.ok('cancelling twice is refused',/already cancelled/.test(e.toasts().join('|'))&&!at(e,'pos/PO-010').cancelledReason);
    const f=mkApp({'pos/PO-010':po(10,{poStatus:'complete',currentStage:'completed'})},{prompt:'late'});f.run('allPOs='+J([po(10,{poStatus:'complete',currentStage:'completed'})]));
    await f.run('window.cancelPO("PO-010","PO-010")');
    s.ok('a completed PO cannot be cancelled',/completed and cannot be cancelled/.test(f.toasts().join('|'))&&at(f,'pos/PO-010').poStatus==='complete');
    const g=mkApp({},{prompt:'x'});
    await g.run('window.cancelPO("PO-404","PO-404")');
    s.ok('an unknown PO is refused, not invented',/PO not found/.test(g.toasts().join('|'))&&g.db.store.size===0);
  }

  s.section('a cancelled PO leaves the pipeline but stays in the registry');
  {
    const live=po(11,{poStatus:'in_production',currentStage:'cutting'});
    const res=po(12,{poStatus:'reserved'});
    const a=mkApp({'pos/PO-010':po(10,{poStatus:'in_production',currentStage:'cutting'}),'pos/PO-011':live,'pos/PO-012':res},{prompt:'Out of fabric'});
    a.run('allPOs='+J([po(10,{poStatus:'in_production',currentStage:'cutting'}),live,res]));
    await a.run('window.cancelPO("PO-010","PO-010")');
    // What loadData would now hand back:
    const fresh=['PO-010','PO-011','PO-012'].map(id=>Object.assign({fbKey:id},a.db.get('pos/'+id)));
    a.run('allPOs='+J(fresh));
    s.eq('poStatusOf says cancelled — not reserved, not in production',a.run('poStatusOf(allPOs[0])'),'cancelled');
    s.eq('the cutting queue (currentStage==="cutting") no longer has it',a.run('allPOs.filter(p=>p.currentStage==="cutting").map(p=>p.id).join()'),'PO-011');
    s.eq('the in-production list no longer has it',a.run('allPOs.filter(p=>poStatusOf(p)===PO_STATUS.IN_PRODUCTION).map(p=>p.id).join()'),'PO-011');
    s.eq('nor does the reserved list',a.run('allPOs.filter(p=>poStatusOf(p)===PO_STATUS.RESERVED).map(p=>p.id).join()'),'PO-012');
    const html=a.run('renderRegistry()');
    s.ok('the registry still lists it',html.indexOf('PO-010')>=0);
    s.ok('with a Cancelled chip',/stage-badge[^>]*>Cancelled</.test(html),html.slice(html.indexOf('PO-010')-80,html.indexOf('PO-010')+400));
    s.ok('and the chip is not mislabelled Completed',!/PO-010<\/span>\s*<span class="stage-badge"[^>]*>Completed/.test(html));
    s.ok('the header counts live orders apart from cancelled: "2 production orders"',/2 production orders/.test(html)&&/1 cancelled/.test(html),html.slice(html.indexOf('page-sub'),html.indexOf('page-sub')+330));
    s.ok('the stage filter offers Cancelled (1)',/<option value="cancelled">Cancelled \(1\)<\/option>/.test(html));
    a.run('window.filterStage("cancelled")');
    const listed=a.el('po-list-wrap').innerHTML;
    s.ok('filtering Cancelled lists only it',listed.indexOf('PO-010')>=0&&listed.indexOf('PO-011')<0&&listed.indexOf('PO-012')<0);
    a.run('window.filterStage("cutting")');
    s.ok('filtering Cutting does not',a.el('po-list-wrap').innerHTML.indexOf('PO-010')<0);
    a.run('window.filterStage("")');
    s.ok('All stages still shows it',a.el('po-list-wrap').innerHTML.indexOf('PO-010')>=0);
    const noCancel=mkApp({});noCancel.run('allPOs='+J([po(1)]));
    const h2=noCancel.run('renderRegistry()');
    s.ok('with no cancelled PO there is no Cancelled option and no chip text',!/Cancelled/.test(h2));
  }

  s.section('the detail page says it, escapes the reason and hides the buttons');
  {
    const evil=po(10,{poStatus:'cancelled',currentStage:null,cancelledBy:'Afnan',cancelledAt:'2026-10-09T10:00:00.000Z',cancelledReason:'<img src=x onerror=alert(1)>'});
    const a=mkApp({'pos/PO-010':evil});
    a.run('allPOs='+J([evil])+';viewingPO="PO-010"');
    a.run('renderDetailPage()');
    const h=a.el('main-content').innerHTML;
    s.ok('banner says Cancelled',/Cancelled — nothing was removed/.test(h));
    s.ok('the reason is escaped',h.indexOf('&lt;img src=x onerror=alert(1)&gt;')>=0&&h.indexOf('<img src=x')<0,h.slice(h.indexOf('Cancelled —'),h.indexOf('Cancelled —')+400));
    s.ok('no Cancel button on an already-cancelled PO',h.indexOf('window.cancelPO')<0);
    s.ok('Delete is still there (it will refuse if linked)',h.indexOf('window.deletePO')>=0);
    const live=po(10,{poStatus:'in_production',currentStage:'cutting'});
    const b=mkApp({'pos/PO-010':live});b.run('allPOs='+J([live])+';viewingPO="PO-010"');b.run('renderDetailPage()');
    const hb=b.el('main-content').innerHTML;
    s.ok('a live PO offers Cancel PO to an owner',hb.indexOf("window.cancelPO('PO-010','PO-010')")>=0);
    s.ok('and has no cancelled banner',hb.indexOf('Cancelled — nothing')<0);
    const c=mkApp({'pos/PO-010':live},{session:ARFAT});c.run('allPOs='+J([live])+';viewingPO="PO-010"');c.run('renderDetailPage()');
    s.ok('Arfat is not offered Cancel PO',c.el('main-content').innerHTML.indexOf('window.cancelPO')<0);
  }

  // ── cancelled POs must not look active anywhere else ──────────────────
  const wide=(session)=>{
    const a=loadApp({files:['js/shared.js','js/auth.js','js/pos.js','js/fabric.js','js/embellishments.js','js/activity.js'],currentPage:'dashboard',
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},_poEmbellishment:null}});
    a.run('session='+J(session||{uid:'u1',u:'afnan',name:'Afnan',role:'owner',stages:[]}));
    a.run(ESC_SRC);
    return a;
  };
  const mixed=[po(11,{poStatus:'in_production',currentStage:'cutting'}),po(12,{poStatus:'reserved'}),po(13,{poStatus:'cancelled',currentStage:null,cancelledReason:'x'})];

  s.section('Cancelled POs are not offered as active work (embellishments.js, fabric.js)');
  {
    const a=wide();
    a.run('allPOs='+J(mixed));
    const html=a.run('_renderMyWorkInner()');
    s.ok('"All Active Orders" lists the live POs',html.indexOf('PO-011')>=0&&html.indexOf('PO-012')>=0,html.slice(0,200));
    s.ok('and not the cancelled one',html.indexOf('PO-013')<0);
    s.ok('the count says 2 in progress',/2 in progress/.test(html),(/(\d+) in progress/.exec(html)||[])[0]);
    const modal=a.run('renderCreateJobModal()');
    s.ok('the job-form PO list has the live POs',/<option value="PO-011">/.test(modal)&&/<option value="PO-012">/.test(modal));
    s.ok('and not the cancelled one',modal.indexOf('<option value="PO-013">')<0);
    a.run('allFabricInventory=[{_id:"k",fabType:"Terry",gsm:200,color:"Black",rolls:[{rollCode:"R1",status:"in_stock",weight:10}]}]');
    const fab=a.run('renderFabricIssueTab()');
    s.ok('the fabric-issue PO list has the live POs',/<option value="PO-011">/.test(fab)&&/<option value="PO-012">/.test(fab),fab.slice(fab.indexOf('fab-iss-po-list'),fab.indexOf('fab-iss-po-list')+200));
    s.ok('and not the cancelled one',fab.indexOf('<option value="PO-013">')<0);
  }

  s.section('The dashboard\'s Total POs headline leaves cancelled POs out (embellishments.js renderDashboard)');
  {
    const stat=(html,label)=>{const m=new RegExp('<div class="stat-label">'+label+'</div><div class="stat-val">(\\d+)</div>').exec(html);return m?+m[1]:null;};
    const a=wide();
    a.run('allPOs='+J(mixed));
    const html=a.run('renderDashboard()');
    s.eq('3 POs on file, one cancelled: Total POs reads 2',stat(html,'Total POs'),2);
    s.eq('Active is unchanged (the cancelled PO has no stage)',stat(html,'Active'),1);
    const day=new Date().toISOString().slice(0,10);
    a.run('allPOs='+J([po(21,{poStatus:'reserved',createdAt:day}),po(22,{poStatus:'cancelled',currentStage:null,createdAt:day})]));
    const h2=a.run('renderDashboard()');
    s.eq('a PO cancelled today is not counted in Today either',stat(h2,'Today'),1);
    s.eq('and Total POs reads 1',stat(h2,'Total POs'),1);
    a.run('allPOs=[]');
    s.eq('no POs: 0',stat(a.run('renderDashboard()'),'Total POs'),0);
  }

  s.section('the Activity Log escapes the detail it prints (the cancel reason is typed text)');
  {
    const hostile='Out of fabric <img src=x onerror=alert(1)> & "more"';
    const row={user:'Afnan',u:'afnan',action:'PO cancelled',detail:'PO-013 cancelled by Afnan — '+hostile,ts:1791666000000};
    const a=wide();
    a.ctx.getDocs=async()=>({docs:[{data:()=>row}]});
    await a.run('loadActivity()');
    const h=a.el('main-content').innerHTML;
    s.ok('the row rendered',h.indexOf('PO cancelled')>=0,h.slice(0,160));
    s.ok('the markup in the reason is shown as text',h.indexOf('&lt;img src=x onerror=alert(1)&gt;')>=0&&h.indexOf('&amp; &quot;more&quot;')>=0);
    s.ok('and no live <img> reached the page',h.indexOf('<img src=x')<0);
  }

  return s;
};

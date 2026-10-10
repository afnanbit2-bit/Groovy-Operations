/* ─────────────────────────────────────────────────────────────────────────
   Gate pass + fabric inventory engine (js/gatepass.js)

   What this guards (audit ids from the P7 bug audit):
     B2    the engine used to SKIP a roll that was not issuable (`if(!r)continue`)
           while the caller still committed its gate-pass doc. It now aborts the
           whole transaction with an error naming the rolls, unless the caller
           passes {tolerateMissing:true}.
     B4    submitGP had no busy guard (double tap = two passes, two sale posts)
           and wrote the pass with setDoc BEFORE the stock decrement (a failure
           between them left a pass with its rolls still in stock). One submit
           at a time, and the pass is committed in the SAME transaction as the
           decrement.
     B5/B6 deleting a fabric gate pass never restocked its rolls, and the one
           path that did could not restore a PARTLY drawn roll, swallowed every
           failure and let the pass be deleted anyway.
     dates the file wrote UTC days (toISOString) — wrong between 00:00-05:00 PKT.

   The Firestore stand-in below is a real transaction: writes are buffered and
   applied only if the callback resolves, so "the transaction aborted" and
   "nothing was written" are things this file can actually assert. Plain node,
   no network — it proves the LOGIC, not what a phone shows.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

const KEY='jersey__220gsm__black';        // _fabInvKey('Jersey',220,'Black')
const KEY2='rib__250gsm__black';          // a second bucket (rib) for multi-fabric issues
const IVKEY='fabric_inventory/'+KEY;
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));

// ── an in-memory Firestore with real transaction semantics ───────────────
function makeFs(){
  const store=new Map();                  // 'coll/id' -> data
  const counters={};
  const stats={tx:0,txFailed:0,plainSets:[],plainDeletes:[],plainUpdates:[]};
  const failures=[];                      // [{prefix,message,times}]
  let auto=0;
  const ref=path=>({path,id:path.split('/').pop()});
  const apply=b=>{
    const p=b.ref.path;
    if(b.op==='delete'){store.delete(p);return;}
    if(b.op==='update'||(b.op==='set'&&b.merge))store.set(p,Object.assign({},store.get(p)||{},b.data));
    else store.set(p,b.data);
  };
  const api={
    db:{__db:1},
    collection:(_db,name)=>({__coll:name}),
    doc:(a,...segs)=>(a&&a.__coll)?ref(a.__coll+'/auto'+(++auto)):ref(segs.join('/')),
    runTransaction:async(_db,fn)=>{
      stats.tx++;
      const buf=[];
      const tx={
        get:async r=>({exists:()=>store.has(r.path),data:()=>clone(store.get(r.path))}),
        set(r,data,opts){buf.push({op:'set',ref:r,data:clone(data),merge:!!(opts&&opts.merge)});return tx;},
        update(r,data){buf.push({op:'update',ref:r,data:clone(data)});return tx;},
        delete(r){buf.push({op:'delete',ref:r});return tx;}
      };
      await fn(tx);                       // a throw here aborts: nothing in buf is applied
      const f=failures.find(x=>x.times>0&&buf.some(b=>b.ref.path.startsWith(x.prefix)));
      if(f){f.times--;stats.txFailed++;throw new Error(f.message);}
      buf.forEach(apply);
    },
    setDoc:async(r,data)=>{stats.plainSets.push(r.path);store.set(r.path,clone(data));},
    updateDoc:async(r,data)=>{
      if(!store.has(r.path))throw new Error('No document to update: '+r.path);
      stats.plainUpdates.push(r.path);store.set(r.path,Object.assign({},store.get(r.path),clone(data)));
    },
    deleteDoc:async r=>{stats.plainDeletes.push(r.path);store.delete(r.path);},
    // A real await, so two overlapping submits genuinely interleave.
    getNextId:async field=>{await new Promise(r=>setTimeout(r,0));counters[field]=(counters[field]||0)+1;return counters[field];}
  };
  return{store,counters,stats,api,
    failNext(prefix,message,times){failures.push({prefix,message:message||'injected commit failure',times:times||1});},
    keys:prefix=>[...store.keys()].filter(k=>k.startsWith(prefix))};
}

const roll=(code,w,extra)=>Object.assign({rollCode:code,weight:w,gsm:220,unit:'kg',status:'in_stock',sourceFabId:'FAB-001'},extra||{});

function app(opts){
  opts=opts||{};
  const fs=makeFs();
  const sales=[];
  // By default the "delete it ANYWAY" override is declined (every other confirm is accepted),
  // so a test of a refusal sees the refusal; override `confirm` in opts.globals to accept it.
  let a;
  a=loadApp({files:['js/gatepass.js'],globals:Object.assign({},fs.api,{
    confirm:m=>{a.state.confirms.push(String(m));return !/anyway/.test(String(m));},
    allPasses:[],allFabricInventory:[],allFabricMovements:[],allReturns:[],allGPEditRequests:[],allFabricIn:[],
    gpActiveTab:'registry',
    loadData:async()=>{},
    acctPostSale:async o=>{sales.push(o);return{_id:'CL-'+sales.length};}
  },opts.globals||{})});
  a.fs=fs;a.sales=sales;
  return a;
}
// Put a bucket into the fake Firestore AND the page's in-memory copy.
function seed(a,rolls,key,type,gsm,color){
  key=key||KEY;
  const doc={key,fabType:type||'Jersey',gsm:gsm||220,color:color||'Black',unit:'kg',rolls:clone(rolls),
    totalWeight:rolls.filter(r=>(r.status||'in_stock')==='in_stock').reduce((n,r)=>n+r.weight,0),lastMovementAt:1};
  a.fs.store.set('fabric_inventory/'+key,doc);
  a.ctx.allFabricInventory.push(Object.assign(clone(doc),{_id:key}));
}
const invOf=(a,key)=>a.fs.store.get('fabric_inventory/'+(key||KEY));
const rollOf=(a,code,key)=>(invOf(a,key).rolls||[]).find(r=>r.rollCode===code);
const movs=a=>a.fs.keys('fabric_movements/').map(k=>a.fs.store.get(k));
const J=x=>JSON.stringify(x);
const lastToast=a=>a.state.toasts[a.state.toasts.length-1]||'';

// The engine, driven with the same arguments the app's own callers use.
const up=(a,args)=>a.run('_fabInvUpsert(Object.assign({fabType:"Jersey",gsm:220,color:"Black",unit:"kg"},'+args+'))');
async function attempt(p){try{return{res:await p};}catch(e){return{err:e};}}
// An await that cannot hang the run: node exits 0, silently, when a promise
// nobody can settle is all that is left — a "green" run that ran nothing.
const TIMEOUT='__timeout__';
function within(p,ms){let t;return Promise.race([p,new Promise(r=>{t=setTimeout(()=>r(TIMEOUT),ms||3000);})]).finally(()=>clearTimeout(t));}

// A fabric-issue gate pass record as submitFabricIssue writes it.
function issueGp(id,o){
  return Object.assign({id,ts:5000,gpType:'fabric',poId:'PO-7',fabricUnit:'kg',fabricType:'Jersey',fabricGsm:220,fabricColor:'Black',inventoryKey:KEY,
    rollCodes:['R1'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R1']}],partialRolls:[]},o||{});
}
function addPass(a,gp){a.fs.store.set('gatepasses/'+gp.id,clone(gp));a.ctx.allPasses.push(clone(gp));}

// Fill the outward gate-pass form the way a person would.
function fillOutward(a,o){
  o=o||{};
  a.el('gp-article').value=o.article===undefined?'Jersey 220 Black':o.article;
  a.el('gp-dest').value='FebKnit';a.el('gp-spec').value='lot 1';
  a.el('gp-date').value='2026-10-10';a.el('gp-time').value='09:00';
  a.el('gp-type').value=o.type||'fabric_kg';
  a.el('gp-fab-stock').value=KEY;
  a.el('gp-fab-qty').value=String(o.qty==null?10:o.qty);
  a.el('gp-sale-cust').value=o.cust||'';a.el('gp-sale-rate').value=String(o.rate==null?'':o.rate);a.el('gp-sale-acc').value='cash';
  a.run("_gpReason="+J(o.reason||'other'));
  a.ctx.__rolls=(o.rolls||['R1']).map(c=>({rollCode:c,weight:10}));
  a.run('_gpOutwardFabRolls=__rolls');
}

module.exports=async function(){
  const s=suite('gatepass-engine');

  // ═══ B2 — the engine fails loudly ═════════════════════════════════════
  s.section('B2 — a roll that is not issuable aborts the transaction, naming it');
  {
    const a=app();
    seed(a,[roll('R1',10),roll('R2',20,{status:'issued',issuedTo:'GP-050'}),roll('R3',30)]);
    a.fs.store.set('gatepasses/GP-100',{id:'GP-100',stale:true});    // must NOT be touched by the failed call
    const before=J(invOf(a));
    const r=await attempt(up(a,`{removeRollCodes:['R1','R2','R9'],sourceCol:'gatepasses',sourceId:'GP-100',extraWrites:[{ref:doc(db,'gatepasses','GP-100'),data:{id:'GP-100',fresh:true}}]}`));
    s.ok('the call rejects (it used to resolve)',!!r.err);
    s.eq('with the engine error code',r.err&&r.err.code,'fabric/rolls-unavailable');
    s.eq('.rollCodes lists exactly the rolls that were not issuable',J(r.err&&r.err.rollCodes),'["R2","R9"]');
    s.ok('the message names the issued roll and its state',/R2 \(issued\)/.test(r.err&&r.err.message||''));
    s.ok('and the missing roll',/R9 \(not in inventory\)/.test(r.err&&r.err.message||''));
    s.eq('NOTHING was written to the bucket',J(invOf(a)),before);
    s.eq('the caller\'s gate-pass doc (extraWrites) was not written either',J(a.fs.store.get('gatepasses/GP-100')),J({id:'GP-100',stale:true}));
    s.eq('no movement row exists',movs(a).length,0);
    s.eq('the issuable roll in the same call was NOT issued',rollOf(a,'R1').status,'in_stock');
  }

  s.section('B2 — {tolerateMissing:true} keeps the old skip-silently behaviour, reported');
  {
    const a=app();
    seed(a,[roll('R1',10),roll('R2',20,{status:'issued',issuedTo:'GP-050'}),roll('R3',30)]);
    const r=await attempt(up(a,`{removeRollCodes:['R1','R2','R9'],tolerateMissing:true,sourceCol:'gatepasses',sourceId:'GP-100',extraWrites:[{ref:doc(db,'gatepasses','GP-100'),data:{id:'GP-100'}}]}`));
    s.ok('it resolves',!r.err,r.err&&r.err.message);
    s.eq('the codes it skipped come back',J(r.res&&r.res.skipped),'["R2","R9"]');
    s.eq('the issuable roll was issued',rollOf(a,'R1').status,'issued');
    s.eq('to this gate pass',rollOf(a,'R1').issuedTo,'GP-100');
    s.eq('the already-issued roll was left alone',rollOf(a,'R2').issuedTo,'GP-050');
    s.eq('the movement lists only what moved',J(movs(a)[0]&&movs(a)[0].rollCodes),'["R1"]');
    s.ok('and the caller doc committed',a.fs.store.has('gatepasses/GP-100'));
  }

  s.section('B2 — the normal paths still work, byte for byte');
  {
    const a=app();
    seed(a,[roll('R1',10),roll('R3',100)]);
    const r=await attempt(up(a,`{removeRollCodes:['R1','R3','R1','R3'],partialUse:{R3:40},reservePO:'PO-7',sourceCol:'gatepasses',sourceId:'GP-101'}`));
    s.ok('a whole roll plus a partial draw (and a code named twice) resolves',!r.err,r.err&&r.err.message);
    s.eq('the whole roll is issued',rollOf(a,'R1').status,'issued');
    s.eq('issued ONCE — a repeated code did not draw it twice',J(movs(a)[0]&&movs(a)[0].rollCodes),'["R1","R3"]');
    s.eq('the partial roll stays in stock, lighter',rollOf(a,'R3').weight,60);
    s.eq('…still in_stock',rollOf(a,'R3').status,'in_stock');
    s.eq('the draw is logged with its PO and weight',J([rollOf(a,'R3').consumptionLog[0].po,rollOf(a,'R3').consumptionLog[0].weight]),'["PO-7",40]');
    s.eq('and stamped with the gate pass that drew it',rollOf(a,'R3').consumptionLog[0].gp,'GP-101');
    s.eq('the aggregate counts only what is available',invOf(a).totalWeight,60);
    s.eq('the movement quantity is what left',movs(a)[0]&&movs(a)[0].qty,50);
  }

  s.section('B24 — deleting a roll that is in use aborts; an already-absent roll is fine');
  {
    const a=app();
    seed(a,[roll('R1',10),roll('R2',20,{status:'issued',issuedTo:'GP-050'}),roll('R3',30,{status:'reserved',reservedPO:'PO-9'})]);
    a.fs.store.set('fabricin/FAB-1',{id:'FAB-1'});
    const del=`{deleteRollCodes:%C%,sourceCol:'fabricin',sourceId:'FAB-1',extraDeletes:[doc(db,'fabricin','FAB-1')]}`;
    const r1=await attempt(up(a,del.replace('%C%',`['R1','R2','R3']`)));
    s.ok('a receipt delete naming an issued/reserved roll rejects',!!r1.err);
    s.eq('naming both',J(r1.err&&r1.err.rollCodes),'["R2","R3"]');
    s.ok('the receipt doc survives (it used to be deleted while its rolls stayed)',a.fs.store.has('fabricin/FAB-1'));
    s.ok('and the in-stock roll was not removed either',!!rollOf(a,'R1'));
    const r2=await attempt(up(a,del.replace('%C%',`['R1','R9']`)));
    s.ok('a roll already absent is tolerated (the delete\'s end state holds)',!r2.err,r2.err&&r2.err.message);
    s.ok('the in-stock roll is removed',!rollOf(a,'R1'));
    s.ok('and the receipt deleted',!a.fs.store.has('fabricin/FAB-1'));
    const r3=await attempt(up(a,`{deleteRollCodes:['R2'],tolerateMissing:true,sourceCol:'fabricin',sourceId:'FAB-1'}`));
    s.ok('tolerateMissing skips an in-use roll, reported',!r3.err&&J(r3.res.skipped)==='["R2"]');
  }

  s.section('operations whose callers rely on tolerance keep it');
  {
    const a=app();
    seed(a,[roll('R1',10),roll('R2',20,{status:'issued',issuedTo:'GP-050'})]);
    const rel=await attempt(up(a,`{releaseRollCodes:['R9','R1'],sourceCol:'pos',sourceId:'PO-9'}`));
    s.ok('release of a roll that is not reserved does not throw (PO delete relies on it)',!rel.err,rel.err&&rel.err.message);
    const res=await attempt(up(a,`{reserveRollCodes:['R2','R9'],reservePO:'PO-9',sourceCol:'pos',sourceId:'PO-9'}`));
    s.ok('reserve of an issued / unknown roll does not throw (best-effort PO form)',!res.err,res.err&&res.err.message);
    const ret=await attempt(up(a,`{returnRollCodes:['R9'],sourceCol:'gatepasses',sourceId:'GP-1'}`));
    s.ok('the legacy returnRollCodes still skips silently',!ret.err,ret.err&&ret.err.message);
  }

  // ═══ B4 — submitGP ═════════════════════════════════════════════════════
  s.section('B4/B2 — a pass for a roll someone else already issued is refused, whole');
  {
    const a=app();
    seed(a,[roll('R1',10)]);                                        // the page still believes R1 is in stock…
    a.fs.store.get(IVKEY).rolls[0]=roll('R1',10,{status:'issued',issuedTo:'GP-050'});   // …Firestore says it is not
    fillOutward(a);
    await a.run('window.submitGP()');
    s.eq('no gate pass was written',a.fs.keys('gatepasses/').length,0);
    s.ok('the person is told, naming the roll',/^Error/.test(lastToast(a))&&/R1/.test(lastToast(a)),lastToast(a));
    s.eq('the other device\'s issue is untouched',rollOf(a,'R1').issuedTo,'GP-050');
    s.eq('no movement row',movs(a).length,0);
  }

  s.section('B4 — the pass and its stock decrement are ONE transaction');
  {
    const a=app();
    seed(a,[roll('R1',10),roll('R2',20)]);
    fillOutward(a,{rolls:['R1','R2'],qty:30});
    await a.run('window.submitGP()');
    const gp=a.fs.store.get('gatepasses/GP-001');
    s.ok('the pass exists',!!gp);
    s.eq('listing both rolls',J(gp&&gp.rollCodes),'["R1","R2"]');
    s.eq('and both rolls are issued to it',J([rollOf(a,'R1').issuedTo,rollOf(a,'R2').issuedTo]),'["GP-001","GP-001"]');
    s.eq('ONE transaction did it all',a.fs.stats.tx,1);
    s.ok('the pass was NOT written with a separate setDoc (that was the non-atomic path)',!a.fs.stats.plainSets.includes('gatepasses/GP-001'));
    s.eq('the pass id was minted once',a.fs.counters.gatepasses,1);
    s.ok('the success toast',/GP-001 issued/.test(lastToast(a)),lastToast(a));
  }

  s.section('B4 — a failed commit leaves neither a pass nor a stock change, and the button is free again');
  {
    const a=app();
    seed(a,[roll('R1',10)]);
    fillOutward(a);
    a.fs.failNext('fabric_inventory/','network went away',1);
    await a.run('window.submitGP()');
    s.eq('no pass in Firestore',a.fs.keys('gatepasses/').length,0);
    s.eq('the roll is still in stock',rollOf(a,'R1').status,'in_stock');
    s.ok('the error is shown',/network went away/.test(lastToast(a)),lastToast(a));
    s.eq('the submit button is enabled again',a.el('gp-submit-btn').disabled,false);
    await a.run('window.submitGP()');
    s.eq('a second try issues exactly one pass',a.fs.keys('gatepasses/').length,1);
  }

  s.section('B4 — double submit: ONE pass, ONE sale post');
  {
    const a=app();
    fillOutward(a,{type:'garments',reason:'sale',cust:'Walk-in',rate:50});
    a.el('gp-fab-stock').value='';
    a.run("_gpSizes=[{size:'M',bundles:'10-10'}]");
    const p1=a.run('window.submitGP()');
    const disabledWhileSaving=a.el('gp-submit-btn').disabled;
    const p2=a.run('window.submitGP()');                 // the second tap, before the first has finished
    await Promise.all([p1,p2]);
    s.eq('the button is disabled while the first is saving',disabledWhileSaving,true);
    s.eq('exactly ONE gate pass exists',a.fs.keys('gatepasses/').length,1);
    s.eq('only ONE number was minted (the 2nd tap never reached it)',a.fs.counters.gatepasses,1);
    s.eq('the sale was posted to Store Accounts ONCE',a.sales.length,1);
    s.eq('exactly one success toast',a.state.toasts.filter(t=>/issued/.test(t)).length,1);
    s.eq('and no error toast',a.state.toasts.filter(t=>/^Error/.test(t)).length,0);
    s.eq('the button is free afterwards',a.el('gp-submit-btn').disabled,false);
  }
  {
    const a=app();
    seed(a,[roll('R1',10)]);
    fillOutward(a);
    await Promise.all([a.run('window.submitGP()'),a.run('window.submitGP()'),a.run('window.submitGP()')]);
    s.eq('three taps on a fabric pass: one pass',a.fs.keys('gatepasses/').length,1);
    s.eq('one number',a.fs.counters.gatepasses,1);
    s.eq('one stock movement',movs(a).length,1);
    s.eq('no error toast from a refused duplicate',a.state.toasts.filter(t=>/^Error/.test(t)).length,0);
  }

  s.section('B4 — the 30s failsafe frees a HUNG submit; the late finish of the old one never frees a newer submit');
  {
    const timers=[];
    let calls=0,n=0;
    const releases=[];
    const holds=[0,1].map(()=>new Promise(r=>releases.push(r)));
    const a=app({globals:{
      setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},
      getNextId:async()=>{calls++;if(holds[calls-1])await holds[calls-1];return++n;}
    }});
    fillOutward(a,{type:'garments',reason:'other'});
    a.el('gp-fab-stock').value='';
    a.run("_gpSizes=[{size:'M',bundles:'10-10'}]");
    const p1=a.run('window.submitGP()');                      // hangs minting its number
    s.eq('the hung submit holds the button',a.el('gp-submit-btn').disabled,true);
    const fail=timers.filter(t=>t.ms===30000).pop();
    s.ok('a 30s failsafe was armed',!!fail);
    if(fail)fail.fn();                                        // 30 seconds pass…
    s.eq('…and the failsafe frees the button',a.el('gp-submit-btn').disabled,false);
    const p2=a.run('window.submitGP()');                      // the person tries again; this one hangs too
    s.eq('a new submit takes the guard',a.el('gp-submit-btn').disabled,true);
    releases[0]();
    s.ok('the old submit finished',(await within(p1))!==TIMEOUT);       // the OLD submit finally finishes
    s.eq('the old one finishing does NOT free the guard of the newer submit',a.el('gp-submit-btn').disabled,true);
    const p3=a.run('window.submitGP()');                      // a third tap (never awaited blindly: if the guard was wrongly free it would hang on the 2nd hold)
    s.eq('a third tap is still ignored (it never reached the number)',calls,2);
    releases[1]();
    s.ok('the newer submit finished',(await within(p2))!==TIMEOUT);
    s.ok('and the third tap returned',(await within(p3))!==TIMEOUT);
    s.eq('the newer submit frees the button when it is done',a.el('gp-submit-btn').disabled,false);
  }

  s.section('B4 — a refused form does not burn a gate pass number, and does not stick the guard');
  {
    const a=app();
    fillOutward(a,{type:'garments',reason:'sale',cust:'Walk-in',rate:0});   // a sale with no rate is refused
    a.el('gp-fab-stock').value='';
    a.run("_gpSizes=[{size:'M',bundles:'10-10'}]");
    await a.run('window.submitGP()');
    s.ok('refused with the rate message',/Enter a sale rate/.test(lastToast(a)),lastToast(a));
    s.ok('no number was minted',!a.fs.counters.gatepasses);
    a.el('gp-sale-rate').value='50';
    await a.run('window.submitGP()');
    s.eq('a corrected form goes through (the guard was released)',a.fs.keys('gatepasses/').length,1);
    s.eq('as GP-001',a.fs.keys('gatepasses/')[0],'gatepasses/GP-001');
  }

  // ═══ dates ═════════════════════════════════════════════════════════════
  s.section('dates — the LOCAL day, never the UTC day');
  {
    const FIXED=Date.parse('2026-10-09T21:30:00Z');            // 02:30 on 10 Oct in PKT, still 9 Oct in UTC
    class FakeDate extends Date{constructor(...x){super(...(x.length?x:[FIXED]));}static now(){return FIXED;}}
    const prevTZ=process.env.TZ;
    process.env.TZ='Asia/Karachi';
    try{
      s.ok('the test environment honours TZ (02:30 PKT is the 10th)',new Date(FIXED).getDate()===10);
      s.eq('…while the UTC day is still the 9th (what toISOString gave)',new Date(FIXED).toISOString().slice(0,10),'2026-10-09');
      const a=app({globals:{Date:FakeDate}});
      s.eq('_gpDayStr names the local day',a.run('_gpDayStr()'),'2026-10-10');
      s.eq('…given a Date',a.run("_gpDayStr(new Date(2026,0,5,0,30))"),'2026-01-05');
      s.eq('…and junk gives an empty string, not "NaN-NaN"',a.run("_gpDayStr('not a date')"),'');
      s.ok('the Issue-new-pass date defaults to the local day',a.run('renderOutward()').includes('id="gp-date" type="date" value="2026-10-10"'));
      a.ctx.allPasses.push({id:'GP-700',gpType:'garments',expectReturn:true,totalUnits:10,items:[]});
      a.el('gp-ret-form-card').scrollIntoView=()=>{};
      a.run("window.gpPickReturn('GP-700')");
      s.ok('the return date defaults to the local day',a.el('gp-ret-form-card').innerHTML.includes('id="ret2-date" type="date" value="2026-10-10"'));
      a.run("_gpType='fabric_kg';_gpReason='process';_gpApplyReasonFields()");
      s.eq('"expected back by" is local today + 7 days',a.el('gp-exp-back').value,'2026-10-17');
    }finally{
      if(prevTZ===undefined)delete process.env.TZ;else process.env.TZ=prevTZ;
    }
  }

  // ═══ B5 / B6 — delete + restock ════════════════════════════════════════
  s.section('B5 — deleting a FABRIC gate pass puts its whole rolls back');
  {
    const a=app();
    seed(a,[roll('R1',10),roll('R2',20),roll('R3',30)]);
    await up(a,`{removeRollCodes:['R1','R2'],sourceCol:'gatepasses',sourceId:'GP-200'}`);
    const gp=issueGp('GP-200',{rollCodes:['R1','R2'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R1','R2']}]});
    addPass(a,gp);
    s.eq('(setup) both rolls are out',J([rollOf(a,'R1').status,rollOf(a,'R2').status]),'["issued","issued"]');
    await a.run('window.requestDeleteGP("GP-200")');
    s.eq('both rolls are back in stock',J([rollOf(a,'R1').status,rollOf(a,'R2').status]),'["in_stock","in_stock"]');
    s.eq('the bucket total is whole again',invOf(a).totalWeight,60);
    s.ok('the pass is deleted',!a.fs.store.has('gatepasses/GP-200'));
    s.ok('and gone from the page\'s list',!a.ctx.allPasses.some(p=>p.id==='GP-200'));
    const m=movs(a).filter(x=>x.subtype==='return_in');
    s.eq('one return_in movement names both rolls',J(m.map(x=>x.rollCodes)),'[["R1","R2"]]');
    s.ok('the confirm said the rolls would go back to stock',/2 fabric roll\(s\) will be RETURNED/.test(a.state.confirms[a.state.confirms.length-1]||''));
    s.ok('the toast says how many',/2 roll\(s\) returned to stock/.test(lastToast(a)),lastToast(a));
    s.ok('the activity log says so too',a.state.activity.some(x=>x.action==='Gate pass deleted'&&/2 roll\(s\) returned/.test(x.detail)));
  }

  s.section('B6 — a PARTLY drawn roll gets its weight back from its consumptionLog');
  {
    const a=app();
    seed(a,[roll('R1',10),roll('R3',100)]);
    await up(a,`{removeRollCodes:['R1','R3'],partialUse:{R3:40},reservePO:'PO-7',sourceCol:'gatepasses',sourceId:'GP-201'}`);
    addPass(a,issueGp('GP-201',{rollCodes:['R1','R3'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R1','R3']}],
      partialRolls:[{rollCode:'R3',weightBefore:100,usedWeight:40,weightAfter:60}]}));
    s.eq('(setup) the roll was drawn down to 60',rollOf(a,'R3').weight,60);
    await a.run('window.requestDeleteGP("GP-201")');
    s.eq('the partial roll is back to 100 kg',rollOf(a,'R3').weight,100);
    s.eq('its draw is gone from the consumption log',(rollOf(a,'R3').consumptionLog||[]).length,0);
    s.eq('it is no longer flagged as partly consumed',rollOf(a,'R3').partiallyConsumed,false);
    s.eq('the printed label is right again (whole, never relabelled, original weight)',rollOf(a,'R3').labelStale,false);
    s.eq('the whole roll is back',rollOf(a,'R1').status,'in_stock');
    s.eq('the bucket total includes the restored weight',invOf(a).totalWeight,110);
    const m=movs(a).filter(x=>x.subtype==='return_in')[0]||{};
    s.eq('the movement records the restored draw',J(m.partialRestored&&m.partialRestored.map(p=>[p.rollCode,p.restoredWeight,p.weightAfter])),'[["R3",40,100]]');
    s.eq('and counts it in qty',m.qty,50);
    s.ok('the pass is deleted',!a.fs.store.has('gatepasses/GP-201'));
    s.ok('the toast counts the restored draw as a roll',/2 roll\(s\) returned/.test(lastToast(a)),lastToast(a));
  }

  s.section('B6 — two draws on one roll: deleting one pass restores exactly ITS draw');
  {
    const a=app();
    seed(a,[roll('R3',100)]);
    await up(a,`{removeRollCodes:['R3'],partialUse:{R3:40},reservePO:'PO-1',sourceCol:'gatepasses',sourceId:'GP-A'}`);
    await up(a,`{removeRollCodes:['R3'],partialUse:{R3:20},reservePO:'PO-1',sourceCol:'gatepasses',sourceId:'GP-B'}`);
    s.eq('(setup) 100 − 40 − 20',rollOf(a,'R3').weight,40);
    const gpA=issueGp('GP-A',{rollCodes:['R3'],poId:'PO-1',fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R3']}],partialRolls:[{rollCode:'R3',usedWeight:40}]});
    addPass(a,gpA);
    await a.run('window.requestDeleteGP("GP-A")');
    s.eq('only the 40 kg draw came back',rollOf(a,'R3').weight,80);
    s.eq('the other pass\'s draw is still logged',J((rollOf(a,'R3').consumptionLog||[]).map(e=>[e.gp,e.weight])),'[["GP-B",20]]');
    s.eq('the roll is still partly consumed',rollOf(a,'R3').partiallyConsumed,true);
    s.eq('and its label is still stale',rollOf(a,'R3').labelStale,true);
  }

  s.section('B6 — an OLDER draw (a log entry with no gate-pass stamp) is matched by PO and weight');
  {
    const a=app();
    seed(a,[roll('R3',60,{originalWeight:100,partiallyConsumed:true,labelStale:true,consumptionLog:[{po:'PO-1',weight:40,ts:1000,by:'X'}]})]);
    addPass(a,issueGp('GP-OLD',{ts:1005,poId:'PO-1',rollCodes:['R3'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R3']}],partialRolls:[{rollCode:'R3',usedWeight:40}]}));
    await a.run('window.requestDeleteGP("GP-OLD")');
    s.eq('the weight came back',rollOf(a,'R3').weight,100);
    s.ok('and the pass is deleted',!a.fs.store.has('gatepasses/GP-OLD'));
  }
  {
    const a=app();
    seed(a,[roll('R3',60,{originalWeight:100,partiallyConsumed:true,consumptionLog:[{po:'PO-OTHER',weight:40,ts:1000,by:'X'}]})]);
    addPass(a,issueGp('GP-X',{ts:1005,poId:'PO-1',rollCodes:['R3'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R3']}],partialRolls:[{rollCode:'R3',usedWeight:40}]}));
    await a.run('window.requestDeleteGP("GP-X")');
    s.ok('a draw that cannot be located refuses the delete — weight is never silently dropped',a.fs.store.has('gatepasses/GP-X')&&/NOT deleted/.test(lastToast(a))&&/R3/.test(lastToast(a)),lastToast(a));
    s.eq('and the roll is untouched',rollOf(a,'R3').weight,60);
  }

  s.section('B6 — restock is idempotent: a retry restores once, not twice');
  {
    const a=app();
    seed(a,[roll('R1',10),roll('R3',100)]);
    await up(a,`{removeRollCodes:['R1','R3'],partialUse:{R3:40},reservePO:'PO-7',sourceCol:'gatepasses',sourceId:'GP-202'}`);
    const gp=issueGp('GP-202',{rollCodes:['R1','R3'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R1','R3']}],partialRolls:[{rollCode:'R3',usedWeight:40}]});
    const firstTry=await attempt(a.run(`_gpRestockIssue(${J(gp)})`));
    s.ok('the first restock does not throw',!firstTry.err,firstTry.err&&firstTry.err.message);
    const first=firstTry.res||{rolls:-1};
    const movsAfterFirst=movs(a).length;
    const secondTry=await attempt(a.run(`_gpRestockIssue(${J(gp)})`));
    const second=secondTry.res||{rolls:-1,alreadyInStock:[]};
    s.ok('the retry does not throw',!secondTry.err,secondTry.err&&secondTry.err.message);
    s.eq('first run: both rolls',first.rolls,2);
    s.eq('second run: nothing to do',second.rolls,0);
    s.eq('the partial roll is 100, not 140',rollOf(a,'R3').weight,100);
    s.eq('the whole roll was not "returned" twice',J(second.alreadyInStock.sort()),'["R1","R3"]');
    s.eq('a no-op retry writes no movement row',movs(a).length,movsAfterFirst);
  }

  s.section('a restock never changes what the bucket IS (its stored unit is kept)');
  {
    const a=app();
    seed(a,[roll('R1',10,{status:'issued',issuedTo:'GP-800'})]);
    a.fs.store.get(IVKEY).unit='m';
    await up(a,`{unit:'meters',restockRollCodes:['R1'],sourceCol:'gatepasses',sourceId:'GP-800'}`);
    s.eq('the bucket is still in metres',invOf(a).unit,'m');
    s.eq('and the roll is back',rollOf(a,'R1').status,'in_stock');
  }

  s.section('B5/B6 — if the restock fails the gate pass is NOT deleted, and the person is told');
  {
    const a=app();
    seed(a,[roll('R1',10),roll('R2',20)]);
    await up(a,`{removeRollCodes:['R1','R2'],sourceCol:'gatepasses',sourceId:'GP-203'}`);
    addPass(a,issueGp('GP-203',{rollCodes:['R1','R2'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R1','R2']}]}));
    a.fs.failNext('fabric_inventory/','Firestore unavailable',1);
    await a.run('window.requestDeleteGP("GP-203")');
    s.ok('the pass still exists',a.fs.store.has('gatepasses/GP-203'));
    s.ok('and is still in the page list',a.ctx.allPasses.some(p=>p.id==='GP-203'));
    s.ok('the toast says it was NOT deleted and why',/GP-203 was NOT deleted/.test(lastToast(a))&&/Firestore unavailable/.test(lastToast(a)),lastToast(a));
    s.eq('no roll moved',J([rollOf(a,'R1').status,rollOf(a,'R2').status]),'["issued","issued"]');
    s.ok('no "deleted" activity was logged',!a.state.activity.some(x=>x.action==='Gate pass deleted'));
    await a.run('window.requestDeleteGP("GP-203")');
    s.ok('retrying once the fault clears completes it',!a.fs.store.has('gatepasses/GP-203')&&rollOf(a,'R1').status==='in_stock');
  }
  {
    const a=app();
    seed(a,[roll('R1',10)]);
    await up(a,`{removeRollCodes:['R1'],sourceCol:'gatepasses',sourceId:'GP-204'}`);
    addPass(a,issueGp('GP-204',{rollCodes:['R1','R9'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R1','R9']}]}));
    await a.run('window.requestDeleteGP("GP-204")');
    s.ok('a roll missing from inventory refuses the delete and names it',a.fs.store.has('gatepasses/GP-204')&&/NOT deleted/.test(lastToast(a))&&/R9/.test(lastToast(a)),lastToast(a));
    s.eq('the other roll in the same bucket was not half-restocked',rollOf(a,'R1').status,'issued');
    const tol=await attempt(a.run(`_gpRestockIssue(${J(a.ctx.allPasses[0])},{tolerateMissing:true})`));
    s.ok('with tolerateMissing the engine path skips it and reports it',!tol.err&&J(tol.res.skipped)==='["R9"]'&&tol.res.returned[0]==='R1',tol.err&&tol.err.message);
  }

  s.section('B3-shaped — a multi-fabric issue where the second fabric fails: the first is back, the pass stays, a retry finishes');
  {
    const a=app();
    seed(a,[roll('R1',10)]);
    seed(a,[roll('B1',5,{gsm:250})],KEY2,'Rib',250,'Black');
    await up(a,`{removeRollCodes:['R1'],sourceCol:'gatepasses',sourceId:'GP-205'}`);
    await a.run(`_fabInvUpsert({fabType:'Rib',gsm:250,color:'Black',unit:'kg',removeRollCodes:['B1'],sourceCol:'gatepasses',sourceId:'GP-205'})`);
    addPass(a,issueGp('GP-205',{rollCodes:['R1','B1'],fabrics:[
      {inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R1']},
      {inventoryKey:KEY2,fabType:'Rib',gsm:250,color:'Black',unit:'kg',rollCodes:['B1']}]}));
    a.fs.failNext('fabric_inventory/'+KEY2,'rib bucket unavailable',1);
    await a.run('window.requestDeleteGP("GP-205")');
    s.eq('the first fabric is already back',rollOf(a,'R1').status,'in_stock');
    s.eq('the second is still out',rollOf(a,'B1',KEY2).status,'issued');
    s.ok('the pass is kept',a.fs.store.has('gatepasses/GP-205'));
    s.ok('the message says part of it already happened and that a retry is safe',/NOT deleted/.test(lastToast(a))&&/already returned/.test(lastToast(a))&&/safe/.test(lastToast(a)),lastToast(a));
    await a.run('window.requestDeleteGP("GP-205")');
    s.eq('the retry finishes the second fabric',rollOf(a,'B1',KEY2).status,'in_stock');
    s.eq('without touching the first again',invOf(a).totalWeight,10);
    s.ok('and deletes the pass',!a.fs.store.has('gatepasses/GP-205'));
  }

  s.section('B5 — what a restock must leave alone');
  {
    const a=app();
    seed(a,[roll('R5',50,{status:'issued',issuedTo:'GP-301'}),roll('R3',30,{status:'issued',issuedTo:'GP-303',partiallyConsumed:true,consumptionLog:[{po:'PO-1',weight:20,ts:10,gp:'GP-302'}]})]);
    addPass(a,issueGp('GP-300',{rollCodes:['R5'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R5']}]}));
    await a.run('window.requestDeleteGP("GP-300")');
    s.ok('a roll that was re-issued under another pass is not stolen back, and the delete still goes ahead',rollOf(a,'R5').issuedTo==='GP-301'&&!a.fs.store.has('gatepasses/GP-300'),lastToast(a));
    addPass(a,issueGp('GP-302',{poId:'PO-1',rollCodes:['R3'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R3']}],partialRolls:[{rollCode:'R3',usedWeight:20}]}));
    await a.run('window.requestDeleteGP("GP-302")');
    s.ok('a part-draw whose roll was issued onward cannot be put back: refused, named',a.fs.store.has('gatepasses/GP-302')&&/R3/.test(lastToast(a))&&/GP-303/.test(lastToast(a)),lastToast(a));
  }
  {
    const a=app();
    seed(a,[roll('R1',10,{status:'issued',issuedTo:'GP-400'})]);
    addPass(a,issueGp('GP-400',{gpReason:'process',rollCodes:['R1'],fabrics:undefined}));
    a.ctx.allReturns.push({id:'RET-001',gpNum:'GP-400',returnedQty:10});
    const txBefore=a.fs.stats.tx;
    await a.run('window.requestDeleteGP("GP-400")');
    s.ok('a process pass that already has returns is refused (they added new rolls; restocking too would count it twice)',a.fs.store.has('gatepasses/GP-400')&&/returns recorded/.test(lastToast(a)),lastToast(a));
    s.eq('and no inventory transaction ran',a.fs.stats.tx,txBefore);
  }

  s.section('B5 — a double-clicked Delete restocks once, and asks once');
  {
    const a=app();
    seed(a,[roll('R1',10)]);
    await up(a,`{removeRollCodes:['R1'],sourceCol:'gatepasses',sourceId:'GP-900'}`);
    addPass(a,issueGp('GP-900',{rollCodes:['R1']}));
    const p1=a.run('window.requestDeleteGP("GP-900")'),p2=a.run('window.requestDeleteGP("GP-900")');
    await Promise.all([p1,p2]);
    s.eq('one confirm dialog',a.state.confirms.length,1);
    s.eq('one restock movement',movs(a).filter(m=>m.subtype==='return_in').length,1);
    s.ok('the pass is deleted and nobody was shown a failure',!a.fs.store.has('gatepasses/GP-900')&&!a.state.toasts.some(t=>/NOT deleted/.test(t)),a.state.toasts.join(' | '));
  }

  s.section('B5 — a non-fabric pass is deleted exactly as before');
  {
    const a=app();
    addPass(a,{id:'GP-500',gpType:'garments',items:[]});
    await a.run('window.requestDeleteGP("GP-500")');
    s.ok('deleted',!a.fs.store.has('gatepasses/GP-500'));
    s.eq('with no inventory transaction',a.fs.stats.tx,0);
    s.ok('and the plain confirm',/^Delete GP-500\? This cannot be undone\.$/.test(a.state.confirms[a.state.confirms.length-1]||''),a.state.confirms[a.state.confirms.length-1]);
  }

  s.section('B5 — approving a delete REQUEST takes the same restock path');
  {
    const a=app();
    seed(a,[roll('R1',10),roll('R3',100)]);
    await up(a,`{removeRollCodes:['R1','R3'],partialUse:{R3:40},reservePO:'PO-7',sourceCol:'gatepasses',sourceId:'GP-600'}`);
    const gp=issueGp('GP-600',{rollCodes:['R1','R3'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R1','R3']}],partialRolls:[{rollCode:'R3',usedWeight:40}]});
    addPass(a,gp);
    const req={id:'RQ1',status:'pending',type:'gp',action:'delete',targetId:'GP-600',currentData:clone(gp),requestedBy:'uzaib'};
    a.ctx.allGPEditRequests.push(req);a.fs.store.set('gatepass_edit_requests/RQ1',clone(req));
    a.fs.failNext('fabric_inventory/','Firestore unavailable',1);
    await a.run('window.gpApproveRequest("RQ1")');
    s.ok('a failed restock fails the approval…',/Approve failed/.test(lastToast(a)),lastToast(a));
    s.ok('…keeps the pass',a.fs.store.has('gatepasses/GP-600'));
    s.eq('…and leaves the request pending',a.fs.store.get('gatepass_edit_requests/RQ1').status,'pending');
    await a.run('window.gpApproveRequest("RQ1")');
    s.eq('approved on the retry',a.fs.store.get('gatepass_edit_requests/RQ1').status,'approved');
    s.eq('rolls restocked (whole)',rollOf(a,'R1').status,'in_stock');
    s.eq('and the part-draw restored',rollOf(a,'R3').weight,100);
    s.ok('and the pass deleted',!a.fs.store.has('gatepasses/GP-600'));
  }

  s.section('B6 — two UNSTAMPED equal draws: a retry never restores the OTHER pass\'s draw (no phantom weight)');
  {
    const mk=()=>{
      const a=app();
      seed(a,[roll('R3',20,{originalWeight:100,partiallyConsumed:true,labelStale:true,consumptionLog:[{po:'PO-1',weight:40,ts:1000,by:'X'},{po:'PO-1',weight:40,ts:1002,by:'X'}]})]);
      const pass=(id,ts)=>issueGp(id,{ts,poId:'PO-1',rollCodes:['R3'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R3']}],partialRolls:[{rollCode:'R3',usedWeight:40}]});
      return{a,A:pass('GP-A',1001),B:pass('GP-B',1003)};
    };
    const {a,A,B}=mk();
    await a.run(`_gpRestockIssue(${J(A)})`);
    s.eq('restoring A gives back 40',rollOf(a,'R3').weight,60);
    const retry=await attempt(a.run(`_gpRestockIssue(${J(A)})`));
    s.ok('a RETRY of A does not throw',!retry.err,retry.err&&retry.err.message);
    s.eq('a retry of A restores nothing — B\'s draw is untouched (60, not 100)',rollOf(a,'R3').weight,60);
    s.eq('B\'s draw is still in the log',(rollOf(a,'R3').consumptionLog||[]).length,1);
    s.eq('the retry says A was already back',J(retry.res&&retry.res.alreadyInStock),'["R3"]');
    const bTry=await attempt(a.run(`_gpRestockIssue(${J(B)})`));
    s.ok('B\'s own restock still finds its draw',!bTry.err,bTry.err&&bTry.err.message);
    s.eq('then B restores its own 40: the roll is whole again',rollOf(a,'R3').weight,100);
    s.eq('with an empty log',(rollOf(a,'R3').consumptionLog||[]).length,0);
  }
  {
    // invariant: whatever order and however many retries, never more is restored than was drawn
    const a=app();
    seed(a,[roll('R3',20,{originalWeight:100,partiallyConsumed:true,consumptionLog:[{po:'PO-1',weight:40,ts:1000,by:'X'},{po:'PO-1',weight:40,ts:1002,by:'X'}]})]);
    const pass=(id,ts)=>issueGp(id,{ts,poId:'PO-1',rollCodes:['R3'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R3']}],partialRolls:[{rollCode:'R3',usedWeight:40}]});
    const A=pass('GP-A',1001),B=pass('GP-B',1003);
    let restored=0,max=0;
    for(const g of [A,A,B,A,B,B,A]){
      const r=await attempt(a.run(`_gpRestockIssue(${J(g)})`));
      restored+=((r.res&&r.res.restoredPartial)||[]).reduce((n,p)=>n+p.restoredWeight,0);
      max=Math.max(max,rollOf(a,'R3').weight);
    }
    s.eq('total restored is exactly what was drawn (80), however many retries',restored,80);
    s.ok('the roll never weighed more than its original 100',max<=100,'max '+max);
    s.eq('and ends at 100',rollOf(a,'R3').weight,100);
  }

  // ═══ the escape hatch ═══════════════════════════════════════════════════
  const orphan=(a,id)=>{
    seed(a,[roll('R1',10,{status:'issued',issuedTo:id})]);
    addPass(a,issueGp(id,{rollCodes:['R1','R9'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R1','R9']}]}));
  };
  const as=(a,u,role)=>{a.ctx.session={uid:'u-'+u,name:u[0].toUpperCase()+u.slice(1),u,role,email:u+'@groovy.op'};};

  s.section('no dead end — an owner / Mustafa may delete a pass whose roll is gone, after a confirm that names what is lost');
  {
    const a=app({globals:{confirm:m=>{a.state.confirms.push(String(m));return true;}}});orphan(a,'GP-950');
    await a.run('window.requestDeleteGP("GP-950")');
    const c=a.state.confirms;
    s.eq('two confirms: the plain one, then the "anyway" one',c.length,2);
    s.ok('the second names the missing roll and says it will NOT be restored',/R9/.test(c[1]||'')&&/NOT be restored/.test(c[1]||'')&&/anyway/.test(c[1]||''),c[1]);
    s.ok('the pass is deleted',!a.fs.store.has('gatepasses/GP-950'));
    s.eq('the roll that could be restocked was',rollOf(a,'R1').status,'in_stock');
    s.ok('the toast says what was not restored',/NOT restored: R9/.test(lastToast(a)),lastToast(a));
    s.ok('the activity log records the skipped roll',a.state.activity.some(x=>/NOT restored/.test(x.action)&&/R9/.test(x.detail)),J(a.state.activity));
  }
  {
    const a=app({globals:{confirm:m=>{a.state.confirms.push(String(m));return !/anyway/.test(m);}}});orphan(a,'GP-951');
    await a.run('window.requestDeleteGP("GP-951")');
    s.ok('declining the "anyway" confirm keeps the pass',a.fs.store.has('gatepasses/GP-951')&&/NOT deleted/.test(lastToast(a)),lastToast(a));
    s.eq('and restocks nothing',rollOf(a,'R1').status,'issued');
    s.ok('and logs nothing',!a.state.activity.some(x=>/NOT restored/.test(x.action)));
  }
  {
    const a=app();orphan(a,'GP-952');as(a,'arfat','manager');
    await a.run('window.requestDeleteGP("GP-952")');
    s.ok('a manager (not owner / Mustafa) is refused, told who can, and never offered the override',a.fs.store.has('gatepasses/GP-952')&&/Only an owner/.test(lastToast(a))&&a.state.confirms.length===1,lastToast(a));
    const b=app({globals:{confirm:m=>{b.state.confirms.push(String(m));return true;}}});orphan(b,'GP-953');as(b,'mustafa','manager');
    await b.run('window.requestDeleteGP("GP-953")');
    s.ok('Mustafa (by username) can',!b.fs.store.has('gatepasses/GP-953'));
  }
  {
    const a=app({globals:{confirm:m=>{a.state.confirms.push(String(m));return true;}}});orphan(a,'GP-954');
    const req=(id)=>({id,status:'pending',type:'gp',action:'delete',targetId:'GP-954',currentData:clone(a.ctx.allPasses[0]),requestedBy:'uzaib'});
    a.ctx.allGPEditRequests.push(req('RQ9'));a.fs.store.set('gatepass_edit_requests/RQ9',clone(req('RQ9')));
    as(a,'arfat','manager');
    await a.run('window.gpApproveRequest("RQ9")');
    s.ok('approving as a manager: refused, pass kept, request still pending',/Approve failed/.test(lastToast(a))&&a.fs.store.has('gatepasses/GP-954')&&a.fs.store.get('gatepass_edit_requests/RQ9').status==='pending',lastToast(a));
    as(a,'afnan','owner');
    await a.run('window.gpApproveRequest("RQ9")');
    s.ok('approving as an owner, after the confirm: deleted and approved',!a.fs.store.has('gatepasses/GP-954')&&a.fs.store.get('gatepass_edit_requests/RQ9').status==='approved');
    s.ok('the skipped roll is in the activity log',a.state.activity.some(x=>/NOT restored/.test(x.action)&&/R9/.test(x.detail)));
  }
  {
    const a=app({globals:{confirm:m=>{a.state.confirms.push(String(m));return true;}}});   // a missing BUCKET (not just a roll)
    addPass(a,issueGp('GP-955',{rollCodes:['R1'],fabrics:[{inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R1']}]}));
    await a.run('window.requestDeleteGP("GP-955")');
    s.ok('a missing inventory bucket takes the same override route',!a.fs.store.has('gatepasses/GP-955')&&a.fs.keys('fabric_inventory/').length===0,lastToast(a));
  }

  s.section('the role gate is in the functions that delete, not only in the UI wrapper');
  {
    for(const [u,role] of [['arfat','manager'],['viewer1','viewer']]){
      const a=app();orphan(a,'GP-960');as(a,u,role);
      const snap=()=>J([[...a.fs.store.entries()],a.fs.stats.tx]);
      addPass(a,{id:'GP-962',gpType:'garments',items:[]});
      const before=snap();
      const d=await attempt(a.run(`window._gpDeleteGatePass('GP-960',{tolerateMissing:true})`));
      const r=await attempt(a.run(`window._gpRestockIssue(${J(a.ctx.allPasses[0])},{tolerateMissing:true})`));
      s.ok(u+': _gpDeleteGatePass with tolerateMissing is refused',!!d.err&&/Only an owner/.test(d.err.message),d.err&&d.err.message);
      const g=await attempt(a.run(`window._gpDeleteGatePass('GP-962',{tolerateMissing:true})`));
      s.ok(u+': the gate is in _gpDeleteGatePass itself — it holds even for a pass with no rolls',!!g.err&&/Only an owner/.test(g.err.message)&&a.fs.store.has('gatepasses/GP-962'),g.err&&g.err.message);
      s.ok(u+': _gpRestockIssue with tolerateMissing is refused',!!r.err&&/Only an owner/.test(r.err.message),r.err&&r.err.message);
      s.eq(u+': NOTHING changed (pass, inventory, movements, no transaction)',snap(),before);
      s.ok(u+': the pass is still in the page list',a.ctx.allPasses.some(p=>p.id==='GP-960'));
    }
    for(const [u,role] of [['afnan','owner'],['mustafa','manager']]){
      const a=app();orphan(a,'GP-961');as(a,u,role);
      const d=await attempt(a.run(`window._gpDeleteGatePass('GP-961',{tolerateMissing:true})`));
      s.ok(u+' may call it directly',!d.err&&!a.fs.store.has('gatepasses/GP-961'),d.err&&d.err.message);
    }
  }

  s.section('other refusals are NOT offered the override');
  {
    const a=app();
    seed(a,[roll('R1',10,{status:'issued',issuedTo:'GP-970'})]);
    addPass(a,issueGp('GP-970',{gpReason:'process',rollCodes:['R1'],fabrics:undefined}));
    a.ctx.allReturns.push({id:'RET-9',gpNum:'GP-970',returnedQty:10});
    await a.run('window.requestDeleteGP("GP-970")');
    s.ok('an owner refused for "has returns recorded" is told so',a.fs.store.has('gatepasses/GP-970')&&/returns recorded/.test(lastToast(a)),lastToast(a));
    s.ok('and is never shown the "anyway" confirm',a.state.confirms.length===1&&!a.state.confirms.some(c=>/anyway/.test(c)),J(a.state.confirms));
    s.ok('nothing was logged as forced',!a.state.activity.some(x=>/NOT restored/.test(x.action)));
  }

  s.section('a refused or declined delete on a MULTI-bucket pass says plainly that some rolls are already back');
  {
    const mk=(extra)=>{
      const a=app(extra);
      seed(a,[roll('R1',10,{status:'issued',issuedTo:'GP-980'})]);
      addPass(a,issueGp('GP-980',{rollCodes:['R1','B9'],fabrics:[
        {inventoryKey:KEY,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['R1']},
        {inventoryKey:KEY2,fabType:'Rib',gsm:250,color:'Black',unit:'kg',rollCodes:['B9']}]}));
      return a;
    };
    const a=mk();                                  // second bucket missing; default confirm declines the override
    await a.run('window.requestDeleteGP("GP-980")');
    s.ok('declined override: the pass stays',a.fs.store.has('gatepasses/GP-980'));
    s.eq('the first fabric really was restocked',rollOf(a,'R1').status,'in_stock');
    s.ok('and the message says so, and that retrying is safe',/already returned to stock; retrying is safe/.test(lastToast(a))&&!/Nothing was saved/.test(lastToast(a)),lastToast(a));
    const b=mk();as(b,'arfat','manager');
    await b.run('window.requestDeleteGP("GP-980")');
    s.ok('refused (not an owner): same plain wording',/already returned to stock; retrying is safe/.test(lastToast(b)),lastToast(b));
  }

  return s;
};

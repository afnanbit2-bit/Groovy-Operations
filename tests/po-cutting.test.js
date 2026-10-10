/* ─────────────────────────────────────────────────────────────────────────
   Cutting done, the cutting tolerance, the owner override and force-advance
   (js/pos.js — markCuttingDone, poCutOverride, ownerAdvance, completeQC).

   Why this suite exists. markCuttingDone committed the bundles in one batch
   and updated the PO in a second write (audit B1): anything failing between
   the two left bundles behind a PO still at cutting, and the retry minted a
   second full set; a second tap or a second device did the same because
   nothing asked whether cutting had already happened. ownerAdvance read the
   next stage from shared.js STAGE_KEYS — a DISPLAY order that is not the real
   flow — so force-advancing cutting skipped bundling and stitching, and
   force-advancing printing moved the PO BACKWARDS.

   Everything here DRIVES the real entry points against an in-memory Firestore
   that behaves like the real one where it matters: a transaction buffers its
   writes and lands them all or none (a failed commit leaves nothing), refuses
   a read after a write, and re-runs when a document it read changed under it
   (so two devices really do race). A test that asserted only the helpers
   would have stayed green against the old wiring.

   Not covered, and cannot be from here: a real browser, a real Firestore
   (the emulator is not run by this suite) and a real phone.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');

const FILES=['js/pos.js'];
const FIXED=Date.UTC(2026,9,10,22,30,0);          // 10 Oct 2026 22:30 UTC = 11 Oct 03:30 PKT
class FixedDate extends Date{
  constructor(...a){if(a.length===0)super(FIXED);else super(...a);}
  static now(){return FIXED;}
}

const OWNER={uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op',stages:null};
const AMMAR={uid:'u3',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op',stages:null};
const MUSTAFA={uid:'u4',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op',stages:null};
const ARFAT={uid:'u5',u:'arfat',name:'Arfat',role:'manager',email:'arfat@groovy.op',stages:null};
const UZAIB={uid:'u2',u:'uzaib',name:'Uzaib',role:'viewer',email:'uzaib@groovy.op',stages:['cutting']};
const HARIS={uid:'u6',u:'haris',name:'Haris',role:'worker',email:'haris@groovy.op',stages:['qc']};

const STAGE_LIST=['cutting','bundling','stitching','printing','washing','qc'];
function po1(o){
  const stages={};STAGE_LIST.forEach(k=>stages[k]={done:false,doneAt:null,doneBy:null,dueDate:'',notes:''});
  return Object.assign({id:'PO-001',name:'Live In Pants',code:'GD007',qty:100,sizes:{S:50,M:50},
    poStatus:'in_production',currentStage:'cutting',stages,totalRoll:'12',createdAt:'2026-10-01'},o||{});
}
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));

/* ── an in-memory Firestore ─────────────────────────────────────────────── */
function makeStore(seed){
  const docs=new Map(),ver=new Map();
  const put=(p,v)=>{docs.set(p,clone(v));ver.set(p,(ver.get(p)||0)+1);};
  Object.keys(seed||{}).forEach(p=>put(p,seed[p]));
  const st={docs,commits:[],plain:[],txRuns:0,getDocCalls:0,failNextCommit:null,stale:null,rejectPaths:[]};
  // A write to one of these paths is REFUSED (rules, quota, a dead connection):
  // inside a commit it rejects the whole commit; on its own it just throws.
  const refuse=ws=>{const bad=ws.find(w=>st.rejectPaths.indexOf(w.ref._p)>-1);if(bad)throw new Error('Missing or insufficient permissions ('+bad.ref._p+')');};
  const dref=(col,id)=>({_p:col+'/'+id,_col:col,_id:id});
  const setPath=(obj,p,val)=>{const ks=p.split('.');let o=obj;for(let i=0;i<ks.length-1;i++){if(typeof o[ks[i]]!=='object'||o[ks[i]]===null)o[ks[i]]={};o=o[ks[i]];}o[ks[ks.length-1]]=val;};
  const snap=p=>({id:p.split('/')[1],exists:()=>docs.has(p),data:()=>clone(docs.get(p))});
  function apply(ws){
    ws.forEach(w=>{if(w.op==='update'&&!docs.has(w.ref._p))throw new Error('No document to update: '+w.ref._p);});
    ws.forEach(w=>{
      const p=w.ref._p;
      if(w.op==='set'){
        if(w.merge&&docs.has(p)){const cur=clone(docs.get(p));Object.assign(cur,clone(w.data));put(p,cur);}
        else put(p,w.data);
      }else if(w.op==='update'){
        const cur=clone(docs.get(p));Object.keys(w.patch).forEach(k=>setPath(cur,k,clone(w.patch[k])));put(p,cur);
      }else if(w.op==='delete'){docs.delete(p);ver.set(p,(ver.get(p)||0)+1);}
    });
  }
  st.put=put;
  st.get=p=>clone(docs.get(p));
  st.ids=col=>[...docs.keys()].filter(p=>p.indexOf(col+'/')===0).map(p=>p.slice(col.length+1)).sort();
  st.api={
    doc:(a,col,id)=>dref(col,id),
    collection:(db,name)=>({_col:name}),
    query:(c,...cons)=>({_col:c._col,_cons:cons.filter(Boolean)}),
    where:(f,op,v)=>({k:'where',f,op,v}),
    orderBy:()=>({k:'order'}),limit:()=>({k:'limit'}),
    getDocs:async q=>{
      const rows=[...docs.keys()].filter(p=>p.indexOf(q._col+'/')===0).filter(p=>(q._cons||[]).every(c=>c.k!=='where'||(c.op==='=='&&docs.get(p)[c.f]===c.v)));
      return{docs:rows.map(p=>({id:p.split('/')[1],data:()=>clone(docs.get(p))}))};
    },
    getDoc:async r=>{st.getDocCalls++;if(st.stale&&st.stale[r._p])return st.stale[r._p];return snap(r._p);},
    updateDoc:async(r,patch)=>{refuse([{ref:r}]);st.plain.push({op:'update',path:r._p,patch});apply([{op:'update',ref:r,patch}]);},
    setDoc:async(r,data)=>{refuse([{ref:r}]);st.plain.push({op:'set',path:r._p,data});apply([{op:'set',ref:r,data}]);},
    addDoc:async()=>({id:'new'}),
    deleteDoc:async r=>{st.plain.push({op:'delete',path:r._p});apply([{op:'delete',ref:r}]);},
    runTransaction:async(db,fn)=>{
      for(let attempt=0;attempt<6;attempt++){
        st.txRuns++;
        const reads={};let wrote=false;const ws=[];
        const tx={
          async get(r){
            if(wrote)throw new Error('Firestore transactions require all reads to be executed before all writes.');
            reads[r._p]=ver.get(r._p)||0;
            await Promise.resolve();                 // let a second device interleave
            return snap(r._p);
          },
          set(r,data,o){wrote=true;ws.push({op:'set',ref:r,data,merge:!!(o&&o.merge)});return tx;},
          update(r,patch){wrote=true;ws.push({op:'update',ref:r,patch});return tx;},
          delete(r){wrote=true;ws.push({op:'delete',ref:r});return tx;}
        };
        const result=await fn(tx);
        if(st.failNextCommit){const m=st.failNextCommit;st.failNextCommit=null;throw new Error(m);}   // nothing applied
        refuse(ws);                                                                                    // nothing applied
        if(Object.keys(reads).some(p=>(ver.get(p)||0)!==reads[p]))continue;                           // changed under us: re-run
        apply(ws);
        // A transaction that decided to write nothing commits nothing — the
        // blocked paths return without a write, and must read as "no commit".
        if(ws.length)st.commits.push(ws.map(w=>({op:w.op,path:w.ref._p})));
        return result;
      }
      throw new Error('transaction contention');
    }
  };
  return st;
}

/* ── one signed-in device ───────────────────────────────────────────────── */
function boot(o){
  o=o||{};
  const store=o.store||makeStore(o.seed||{'pos/PO-001':po1(),'counters/main':{pos:1,gatepasses:0,bundles:40}});
  const calls={fab:[],emb:[],pages:[]};
  const globals=Object.assign({},store.api,{
    Date:FixedDate,currentPage:o.currentPage||'stage-work',
    allPOs:[],allPasses:[],allReturns:[],allFabricIn:[],allGPEditRequests:[],allFabricMovements:[],
    allFabricInventory:o.inventory||[],currentBundles:[],viewingPO:o.viewingPO||null,stageWorkPO:null,
    cutState:o.cutState||{poId:'PO-001',actualQty:{XS:0,S:50,M:50,L:0,XL:0,'2XL':0},
      pendingBundles:[{tempId:1,size:'S',units:30},{tempId:2,size:'S',units:20},{tempId:3,size:'M',units:50}]},
    _fabInvUpsert:async a=>{calls.fab.push(a);if(o.fabFail){const e=new Error('roll R1 is not issuable');e.code='fabric/rolls-unavailable';throw e;}return{movCodes:a.removeRollCodes.filter(c=>(o.skip||[]).map(x=>x.rollCode||x).indexOf(c)<0),movQty:0,skipped:o.skip||[]};}
  },o.globals||{});
  if(o.withEmb!==false)globals.embOnCuttingDone=async(p,s)=>{calls.emb.push({po:p,sizes:s});};
  const app=loadApp({files:FILES,session:o.session||OWNER,globals});
  // The real stage list, straight from shared.js — so the display order the
  // fix is about is the one in the file, not a copy that could drift.
  const sh=fs.readFileSync(path.join(ROOT,'js/shared.js'),'utf8');
  const m=/const STAGES=\[[\s\S]*?\n\];/.exec(sh);
  app.run(m[0]+';const STAGE_KEYS=STAGES.map(s=>s.key);');
  app.ctx.window.showPage=p=>calls.pages.push(p);
  const reload=()=>app.run('loadData()');
  return{app,store,calls,reload,toasts:()=>app.state.toasts,
    syncPOs:()=>{app.run('allPOs='+JSON.stringify(store.ids('pos').map(id=>Object.assign({},store.get('pos/'+id),{fbKey:id}))));},
    cut:()=>app.run("window.markCuttingDone('PO-001')"),
    bundles:()=>store.ids('bundles'),
    lastToast:()=>app.state.toasts[app.state.toasts.length-1]||''};
}
const commitPaths=st=>st.commits.map(c=>c.map(w=>w.path));

module.exports=async function(){
  const s=suite('po-cutting');

  /* ═══ the tolerance is a named constant: 70–130% is the everyday gate ═══ */
  s.section('the cutting tolerance');
  {
    const d=boot();
    const G=JSON.parse(d.app.run('JSON.stringify(PO_CUT_GATE)'));
    s.eq('the everyday gate is 70–130%, one named constant',G.min+'-'+G.max,'0.7-1.3');
    s.eq('no stale override-window constant is left behind',d.app.run('typeof PO_CUT_GATE_OVERRIDE'),'undefined');
    s.eq('its label is derived, not typed',d.app.run('poCutPct(PO_CUT_GATE)'),'70–130%');
    s.eq('an override has no window: the label says so',d.app.run('poCutPct(poCutGateFor({cutOverride:{by:"afnan"}}))'),'any quantity');
    // The arithmetic the gate has always used (ceil down-bound, floor up-bound), restated as the reference.
    let bad=0;
    for(let t=0;t<=3000;t++){
      const r=d.app.run(`poCutRange(${t})`);
      if(r.min!==Math.ceil(t*0.7)||r.max!==Math.floor(t*1.3))bad++;
    }
    s.eq('poCutRange(n) is exactly ceil(n*0.7)..floor(n*1.3) for every n 0–3000',bad,0);
    s.eq('500 ordered: everyday window 350–650',JSON.stringify(d.app.run('poCutRange(500)')),JSON.stringify({min:350,max:650}));
    s.eq('no PO override: the everyday window applies',d.app.run('poCutGateFor({qty:100})===PO_CUT_GATE'),true);
    s.eq('an override on the PO opens the window',d.app.run('poCutGateFor({qty:100,cutOverride:{by:"afnan"}}).open'),true);
    s.eq('open means no upper limit',d.app.run('poCutRange(100,poCutGateFor({cutOverride:{by:"afnan"}})).max===Infinity'),true);
    s.eq('a hollow override object does not',d.app.run('poCutGateFor({qty:100,cutOverride:{}})===PO_CUT_GATE'),true);
    // The button gate, at the edges (100 ordered, bundles always matching).
    const edge=n=>boot({cutState:{poId:'PO-001',actualQty:{XS:0,S:n,M:0,L:0,XL:0,'2XL':0},pendingBundles:[{tempId:1,size:'S',units:n}]}}).app.run("cutValidationOk({qty:100})");
    s.eq('69 of 100 is refused',edge(69),false);
    s.eq('70 of 100 is allowed, no override',edge(70),true);
    s.eq('130 of 100 is allowed, no override',edge(130),true);
    s.eq('131 of 100 is refused',edge(131),false);
    const wide=n=>boot({cutState:{poId:'PO-001',actualQty:{XS:0,S:n,M:0,L:0,XL:0,'2XL':0},pendingBundles:[{tempId:1,size:'S',units:n}]}})
      .app.run('cutValidationOk({qty:100,cutOverride:{by:"afnan"}})');
    [69,131,40,250,1000].forEach(n=>s.eq('with an override '+n+' of 100 is allowed (no outer limit)',wide(n),true));
  }

  /* ═══ dates: the PKT day, never the UTC one ═══ */
  s.section('dates are PKT days');
  {
    const d=boot();
    s.eq('22:30 UTC on the 10th is already the 11th in PKT',d.app.run(`_poCutPktDay(${Date.UTC(2026,9,10,22,30)})`),'2026-10-11');
    s.eq('(the UTC day it replaces is the 10th)',new Date(Date.UTC(2026,9,10,22,30)).toISOString().slice(0,10),'2026-10-10');
    s.eq('18:59:59 UTC is still 23:59 PKT on the 10th',d.app.run(`_poCutPktDay(${Date.UTC(2026,9,10,18,59,59)})`),'2026-10-10');
    s.eq('19:00:00 UTC is midnight PKT — the 11th',d.app.run(`_poCutPktDay(${Date.UTC(2026,9,10,19,0,0)})`),'2026-10-11');
    s.eq('across a month end',d.app.run(`_poCutPktDay(${Date.UTC(2026,9,31,20,0)})`),'2026-11-01');
    s.eq('across a year end',d.app.run(`_poCutPktDay(${Date.UTC(2026,11,31,19,30)})`),'2027-01-01');
    ['window.markCuttingDone','window.poCutOverride','window.ownerAdvance','window.completeQC'].forEach(fn=>{
      s.ok(fn.slice(7)+' never takes a date from toISOString().slice(0,10)',!/toISOString\(\)\s*\.(slice|split|substring)/.test(d.app.run(fn+'.toString()')));
    });
  }

  /* ═══ markCuttingDone — the happy path is one transaction ═══ */
  s.section('markCuttingDone: one transaction, the PKT day, ids from the counter');
  {
    const d=boot();d.syncPOs();
    await d.cut();
    s.eq('three bundles, numbered from the counter',JSON.stringify(d.bundles()),JSON.stringify(['B-0041','B-0042','B-0043']));
    s.eq('in ONE transaction commit',d.store.commits.length,1);
    const paths=commitPaths(d.store)[0]||[];
    s.ok('that commit carries the bundles, the counter and the PO together',
      ['bundles/B-0041','bundles/B-0042','bundles/B-0043','counters/main','pos/PO-001'].every(p=>paths.indexOf(p)>-1),paths.join(','));
    s.eq('and nothing else was written outside it',d.store.plain.length,0);
    s.eq('the counter moved by exactly the bundles minted',d.store.get('counters/main').bundles,43);
    s.eq('the counter doc kept its other fields',d.store.get('counters/main').pos,1);
    const b=d.store.get('bundles/B-0042');
    s.eq('a bundle carries its PO',b.poId,'PO-001');
    s.eq('its size and units',b.size+':'+b.units,'S:20');
    s.eq('its number',b.bundleNumber,42);
    s.eq('its day is the PKT day (11th), not the UTC one (10th)',b.createdAt,'2026-10-11');
    s.eq('born at the cutting stage, not yet bundled',b.stage+':'+b.bundlingDone+':'+b.stitchingDone,'cutting:false:false');
    const p=d.store.get('pos/PO-001');
    s.eq('the PO moves to the next REAL stage',p.currentStage,'bundling');
    s.eq('cutting is marked done',p.stages.cutting.done,true);
    s.eq('by whom',p.stages.cutting.doneBy,'Afnan');
    s.eq('cutAt stays a full ISO timestamp',p.cutAt,new Date(FIXED).toISOString());
    s.eq('cutDate is the PKT day',p.cutDate,'2026-10-11');
    s.eq('the bundle ids are on the PO',JSON.stringify(p.bundleIds),JSON.stringify(['B-0041','B-0042','B-0043']));
    s.eq('the cut per size is on the PO',JSON.stringify(p.cutQty),JSON.stringify({XS:0,S:50,M:50,L:0,XL:0,'2XL':0}));
    s.eq('and as cutBySize',JSON.stringify(p.cutBySize),JSON.stringify(p.cutQty));
    s.eq('other PO fields are untouched',p.name+':'+p.qty+':'+p.createdAt,'Live In Pants:100:2026-10-01');
    s.eq('a BLANK rolls box does not erase the rolls figure the PO was created with',p.totalRoll,'12');
    // …and a figure the cutter really entered still replaces it, as it always did.
    const r=boot();r.syncPOs();r.app.el('cut-rolls').value='9';
    await r.cut();
    s.eq('a rolls figure the cutter entered is recorded',r.store.get('pos/PO-001').totalRoll,'9');
    s.eq('the embellishment job is topped up once',d.calls.emb.length,1);
    s.eq('with the bundle ids the transaction minted',JSON.stringify(d.calls.emb[0].po.bundleIds),JSON.stringify(['B-0041','B-0042','B-0043']));
    s.eq('and the ACTUAL cut per size',d.calls.emb[0].sizes.S+':'+d.calls.emb[0].sizes.M,'50:50');
    s.ok('the success toast is the one it always was',/Cutting done ✓ — 3 bundles/.test(d.lastToast()),d.lastToast());
    s.eq('it goes back to My Work',d.calls.pages[d.calls.pages.length-1],'my-work');
    s.ok('the activity row is logged',d.app.state.activity.some(a=>a.action==='Stage done'&&/Cutting done — 3 bundles/.test(a.detail)));
  }

  s.section('markCuttingDone: no embellishments module is no change');
  {
    const d=boot({withEmb:false});d.syncPOs();
    await d.cut();
    s.eq('cutting still completes',d.store.get('pos/PO-001').currentStage,'bundling');
  }

  /* ═══ B1: a failed save leaves nothing, and the retry does not duplicate ═══ */
  s.section('B1: a failed save, then a retry — no duplicate bundles');
  {
    const d=boot();d.syncPOs();
    d.store.failNextCommit='network went away mid-commit';
    await d.cut();
    s.ok('the failure is reported',/Error: network went away/.test(d.lastToast()),d.lastToast());
    s.eq('NO bundle was left behind',d.bundles().length,0);
    s.eq('the counter did not move (no numbers burnt)',d.store.get('counters/main').bundles,40);
    s.eq('the PO is still at cutting',d.store.get('pos/PO-001').currentStage,'cutting');
    s.eq('the PO is not marked done',d.store.get('pos/PO-001').stages.cutting.done,false);
    s.eq('the button is usable again',d.app.el('cut-done-btn').disabled,false);
    s.eq('…and says what it did',d.app.el('cut-done-btn').textContent,'Mark Cutting Done ✓');
    await d.cut();                                   // the retry
    s.eq('the retry makes exactly the bundles entered — no second set',d.bundles().length,3);
    s.eq('numbered from where the counter was, no gap',JSON.stringify(d.bundles()),JSON.stringify(['B-0041','B-0042','B-0043']));
    s.eq('the counter is 43, not 46',d.store.get('counters/main').bundles,43);
    s.eq('the PO lists exactly those three',JSON.stringify(d.store.get('pos/PO-001').bundleIds),JSON.stringify(['B-0041','B-0042','B-0043']));
    s.eq('the embellishment job was topped up once, after the real commit',d.calls.emb.length,1);

    // The exact failure the audit describes: the bundles go in, then the write
    // to the PO is refused. Now they cannot go in without it.
    const r=boot();r.syncPOs();
    r.store.rejectPaths=['pos/PO-001'];
    await r.cut();
    s.ok('a refused write to the PO is reported',/Missing or insufficient permissions/.test(r.lastToast()),r.lastToast());
    s.eq('and the bundles did NOT go in ahead of it',r.bundles().length,0);
    s.eq('no number was spent',r.store.get('counters/main').bundles,40);
    s.eq('the embellishment job was not touched',r.calls.emb.length,0);
    r.store.rejectPaths=[];
    await r.cut();
    s.eq('once the write is allowed, the retry makes one set of bundles',JSON.stringify(r.bundles()),JSON.stringify(['B-0041','B-0042','B-0043']));
  }

  s.section('B1: a second tap, a second device and a stale screen');
  {
    // (a) two taps in the same instant
    const d=boot();d.syncPOs();
    await Promise.all([d.cut(),d.cut()]);
    s.eq('two simultaneous taps make ONE set of bundles',d.bundles().length,3);
    s.eq('in one commit',d.store.commits.length,1);
    s.eq('the second tap did not even read the database',d.store.getDocCalls,1);
    s.eq('the activity row was written once',d.app.state.activity.filter(a=>a.action==='Stage done').length,1);

    // (b) a later tap on a stale copy of the PO (this device never saw it finish)
    const stale=clone(d.app.run('allPOs'));
    stale.forEach(p=>{p.currentStage='cutting';p.stages.cutting.done=false;});
    d.app.run('allPOs='+JSON.stringify(stale));
    const before=d.store.commits.length;
    await d.cut();
    s.eq('a tap on a stale screen writes nothing',d.store.commits.length,before);
    s.eq('and makes no bundle',d.bundles().length,3);
    s.ok('it says cutting was already recorded',/already recorded by Afnan/.test(d.app.state.toasts.join('|')),d.app.state.toasts.join('|'));
    s.eq('that is not shown as an error',d.app.state.toasts.some(t=>/^Error/.test(t)),false);

    // (c) the in-transaction guard on its own: the early read answers "not done"
    const e=boot();e.syncPOs();
    const notDone=e.store.api.getDoc({_p:'pos/PO-001'});
    e.store.stale={'pos/PO-001':await notDone};
    e.store.put('pos/PO-001',Object.assign(po1(),{currentStage:'bundling',stages:Object.assign(po1().stages,{cutting:{done:true,doneBy:'Uzaib'}})}));
    await e.cut();
    s.eq('a save that passed the early read is still stopped INSIDE the transaction',e.bundles().length,0);
    s.eq('with no commit at all',e.store.commits.length,0);
    s.ok('and told who did it',/already recorded by Uzaib/.test(e.app.state.toasts.join('|')),e.app.state.toasts.join('|'));

    // (d) two devices racing for real
    const store=makeStore({'pos/PO-001':po1(),'counters/main':{pos:1,gatepasses:0,bundles:40}});
    const a=boot({store}),b=boot({store,session:UZAIB});
    a.syncPOs();b.syncPOs();
    await Promise.all([a.cut(),b.cut()]);
    s.eq('two devices racing make ONE set of bundles',store.ids('bundles').length,3);
    s.eq('one commit',store.commits.length,1);
    s.eq('the counter moved once',store.get('counters/main').bundles,43);
    s.eq('exactly one embellishment top-up between them',a.calls.emb.length+b.calls.emb.length,1);
  }

  /* ═══ reuse and no-overwrite ═══ */
  s.section('B1: bundles already on file for this PO');
  {
    const orphan=(n,size,units)=>['bundles/B-000'+n,{bundleId:'B-000'+n,bundleNumber:n,poId:'PO-001',size,units,stage:'cutting',bundlingDone:false,stitchingDone:false,qcStatus:null,qcReason:'',createdBy:'Old build',createdAt:'2026-10-09',ts:1}];
    const seed={'pos/PO-001':po1(),'counters/main':{pos:1,gatepasses:0,bundles:7}};
    [orphan(5,'S',30),orphan(6,'S',20),orphan(7,'M',50)].forEach(o=>{seed[o[0]]=o[1];});
    const d=boot({seed});d.syncPOs();
    const before=JSON.stringify([5,6,7].map(n=>d.store.get('bundles/B-000'+n)));
    await d.cut();
    s.eq('debris from a dead save that MATCHES is reused: no new bundle',d.bundles().length,3);
    s.eq('the PO adopts the existing ids',JSON.stringify(d.store.get('pos/PO-001').bundleIds),JSON.stringify(['B-0005','B-0006','B-0007']));
    s.eq('the counter did not move',d.store.get('counters/main').bundles,7);
    s.eq('the existing bundle documents were not rewritten',JSON.stringify([5,6,7].map(n=>d.store.get('bundles/B-000'+n))),before);
    s.ok('the commit touches no bundle at all',(commitPaths(d.store)[0]||[]).every(p=>p.indexOf('bundles/')!==0),(commitPaths(d.store)[0]||[]).join(','));
    s.eq('the PO is done',d.store.get('pos/PO-001').stages.cutting.done,true);

    // Different from what was just entered: refuse — never duplicate, never overwrite.
    const seed2={'pos/PO-001':po1(),'counters/main':{pos:1,gatepasses:0,bundles:5}};
    const o=orphan(5,'S',10);seed2[o[0]]=o[1];
    const e=boot({seed:seed2,inventory:[{_id:'k',fabType:'Denim',gsm:300,color:'Blue',unit:'kg',totalWeight:100,rolls:[]}]});e.syncPOs();
    e.app.el('cut-fab-stock').value='k';e.app.run("_cutFabRolls=[{rollCode:'R1',weight:20}]");
    await e.cut();
    s.eq('debris that does NOT match is refused: nothing written',e.store.commits.length,0);
    s.eq('no second bundle beside it',e.bundles().length,1);
    s.eq('the debris itself is untouched',JSON.stringify(e.store.get('bundles/B-0005')),JSON.stringify(o[1]));
    s.ok('and it says why',/earlier save that did not finish/.test(e.lastToast()),e.lastToast());
    s.eq('fabric was NOT deducted for a save that was refused',e.calls.fab.length,0);
    s.eq('the PO is untouched',e.store.get('pos/PO-001').currentStage,'cutting');
    s.eq('the button is usable again',e.app.el('cut-done-btn').disabled,false);
  }

  s.section('B1: a counter that has fallen behind never overwrites a bundle in use');
  {
    const seed={'pos/PO-001':po1(),'counters/main':{pos:1,gatepasses:0,bundles:0},
      'bundles/B-0001':{bundleId:'B-0001',bundleNumber:1,poId:'PO-000',size:'L',units:11,createdBy:'Waqas'},
      'bundles/B-0002':{bundleId:'B-0002',bundleNumber:2,poId:'PO-000',size:'L',units:12,createdBy:'Waqas'}};
    const d=boot({seed});d.syncPOs();
    const a1=JSON.stringify(d.store.get('bundles/B-0001')),a2=JSON.stringify(d.store.get('bundles/B-0002'));
    await d.cut();
    s.eq('it steps over the ids that exist',JSON.stringify(d.store.get('pos/PO-001').bundleIds),JSON.stringify(['B-0003','B-0004','B-0005']));
    s.eq('B-0001 is exactly as it was',JSON.stringify(d.store.get('bundles/B-0001')),a1);
    s.eq('B-0002 is exactly as it was',JSON.stringify(d.store.get('bundles/B-0002')),a2);
    s.eq('the counter is brought up to the last number used',d.store.get('counters/main').bundles,5);

    const e=boot({seed:{'pos/PO-001':po1()}});e.syncPOs();
    await e.cut();
    s.eq('a missing counter document is created, from 1',JSON.stringify(e.bundles()),JSON.stringify(['B-0001','B-0002','B-0003']));
    s.eq('holding only what it owns',JSON.stringify(e.store.get('counters/main')),JSON.stringify({bundles:3}));
  }

  /* ═══ the gate, judged on the live document ═══ */
  s.section('the cut must sit inside the window — and the live document decides');
  {
    const cs=n=>({poId:'PO-001',actualQty:{XS:0,S:n,M:0,L:0,XL:0,'2XL':0},pendingBundles:[{tempId:1,size:'S',units:n}]});
    const out=boot({cutState:cs(69)});
    out.syncPOs();
    await out.cut();
    s.ok('69 of 100 is refused at the button, before any read',/Validation failed/.test(out.lastToast()),out.lastToast());
    s.eq('no database access',out.store.getDocCalls+out.store.txRuns,0);
    const hi=boot({cutState:cs(131)});hi.syncPOs();await hi.cut();
    s.ok('131 of 100 is refused too',/Validation failed/.test(hi.lastToast())&&hi.bundles().length===0,hi.lastToast());

    // Exactly on the edge: allowed with NO override.
    for(const n of [70,130]){
      const e=boot({cutState:cs(n)});e.syncPOs();await e.cut();
      const ep=e.store.get('pos/PO-001');
      s.eq('exactly '+n+' of 100 passes with no override',ep.currentStage+':'+e.bundles().length,'bundling:1');
      s.eq('and no override is involved',ep.cutOverride,undefined);
    }

    // The local copy says 60 ordered (69 is fine); the live document says 100.
    const d=boot({cutState:cs(69)});
    d.app.run('allPOs='+JSON.stringify([Object.assign(po1({qty:60}),{fbKey:'PO-001'})]));
    await d.cut();
    s.eq('the gate is judged on the LIVE order quantity: nothing saved',d.store.commits.length,0);
    s.ok('and it says what the window is, from the constant',/69 pcs is outside the 70–130 allowed for 100 ordered \(70–130%\)/.test(d.lastToast()),d.lastToast());
    s.eq('no bundles',d.bundles().length,0);

    // An owner-approved variance lets any quantity through, and records it.
    for(const [n,pct] of [[69,69],[131,131],[250,250]]){
      const ov=boot({seed:{'pos/PO-001':po1({cutOverride:{by:'afnan',byName:'Afnan',at:'x',reason:'fabric short',gateMin:0.7,gateMax:1.3,ordered:100}}),
        'counters/main':{pos:1,bundles:0}},cutState:cs(n)});
      ov.syncPOs();
      await ov.cut();
      const p=ov.store.get('pos/PO-001');
      s.eq('an approved variance lets '+n+' of 100 through',p.currentStage,'bundling');
      s.eq(n+': the actual total is recorded on the override',p.cutOverride.actualTotal,n);
      s.eq(n+': and the percentage',p.cutOverride.pct,pct);
      s.eq(n+': the ordered quantity is on the override',p.cutOverride.ordered,100);
      s.eq(n+': with the time',p.cutOverride.usedAt,new Date(FIXED).toISOString());
      s.eq(n+': the record is otherwise intact',p.cutOverride.reason+':'+p.cutOverride.by,'fabric short:afnan');
      s.ok(n+': the activity row says so',ov.app.state.activity.some(a=>/inside an owner-approved variance/.test(a.detail)));
    }

    // Within the everyday window the override is not "used".
    const w=boot({seed:{'pos/PO-001':po1({cutOverride:{by:'afnan',byName:'Afnan',at:'x',reason:'r',ordered:100}}),'counters/main':{pos:1,bundles:0}}});
    w.syncPOs();
    await w.cut();
    s.eq('a cut inside 70–130 does not stamp the override as used',w.store.get('pos/PO-001').cutOverride.usedAt,undefined);

    // The whole path: approve through the hook, then cut at 69% — the bell fires once.
    const f=boot({seed:{'pos/PO-001':po1(),'counters/main':{pos:1,bundles:0}},cutState:cs(69)});
    f.syncPOs();
    await f.cut();
    s.eq('(before approval 69 of 100 is refused)',f.store.get('pos/PO-001').stages.cutting.done,false);
    await f.app.run("window.poCutOverride('PO-001','fabric ran short')");
    f.syncPOs();
    await f.cut();
    const fp=f.store.get('pos/PO-001');
    s.eq('after approval the 69% cut is recorded',fp.currentStage+':'+fp.cutOverride.actualTotal+':'+fp.cutOverride.pct,'bundling:69:69');
    s.eq('Mustafa was notified exactly once (approving; cutting does not notify again)',f.store.ids('hrm_notifications').length,1);
    // A second approval attempt on the same PO adds nothing.
    await f.app.run("window.poCutOverride('PO-001','again')");
    s.eq('still one notification',f.store.ids('hrm_notifications').length,1);

    // The in-transaction gate stays the authority when the early read was stale.
    const g=boot({cutState:cs(60)});
    g.app.run('allPOs='+JSON.stringify([Object.assign(po1({qty:60}),{fbKey:'PO-001'})]));
    g.store.stale={'pos/PO-001':{exists:()=>true,data:()=>po1({qty:60})}};   // the early read is stale; the live PO says 100
    await g.cut();
    s.eq('a stale early read does not get a 60-of-100 cut past the transaction',g.store.commits.length+':'+g.bundles().length,'0:0');
    s.ok('the transaction says why',/60 pcs is outside the 70–130 allowed for 100 ordered/.test(g.lastToast()),g.lastToast());
  }

  /* ═══ fabric: deducted once, never for a refused save ═══ */
  s.section('fabric inventory is deducted once');
  {
    const inv=[{_id:'k',fabType:'Denim',gsm:300,color:'Blue',unit:'kg',totalWeight:100,rolls:[{rollCode:'R1',weight:20,status:'in_stock'},{rollCode:'R2',weight:30,status:'in_stock'}]}];
    const d=boot({inventory:inv});d.syncPOs();
    d.app.el('cut-fab-stock').value='k';d.app.el('cut-weight').value='50';d.app.el('cut-rolls').value='2';
    d.app.run("_cutFabRolls=[{rollCode:'R1',weight:20},{rollCode:'R2',weight:30}]");
    d.store.failNextCommit='lost the connection';
    await d.cut();
    s.eq('the deduction ran before the failed save',d.calls.fab.length,1);
    s.ok('the failure says the fabric already went through',/fabric deduction already went through/.test(d.lastToast()),d.lastToast());
    s.eq('no bundles from the failed save',d.bundles().length,0);
    await d.cut();                                    // retry
    s.eq('the retry did NOT deduct the rolls a second time',d.calls.fab.length,1);
    s.eq('the bundles are made once',d.bundles().length,3);
    const fc=d.store.get('pos/PO-001').fabricConsumed;
    s.eq('the PO records what was consumed',(fc&&fc.rollCodes||[]).join(','),'R1,R2');
    s.eq('and how much',fc&&fc.qty,50);
    s.eq('weight and rolls are recorded as before',d.store.get('pos/PO-001').totalWeight+'/'+d.store.get('pos/PO-001').totalRoll+'/'+d.store.get('pos/PO-001').avgPerUnit,'50/2/500g');
    s.ok('the toast mentions the fabric',/fabric deducted/.test(d.lastToast()),d.lastToast());
    const call=d.calls.fab[0]||{};
    s.eq('the engine was asked for those rolls, against this PO',(call.removeRollCodes||[]).join(',')+'|'+call.sourceId+'|'+call.sourceCol,'R1,R2|PO-001|pos');

    // A cut that has already happened deducts nothing.
    const e=boot({inventory:inv,seed:{'pos/PO-001':po1({currentStage:'bundling',stages:Object.assign(po1().stages,{cutting:{done:true,doneBy:'Uzaib'}})}),'counters/main':{pos:1,bundles:3}}});
    e.syncPOs();
    e.app.el('cut-fab-stock').value='k';e.app.run("_cutFabRolls=[{rollCode:'R1',weight:20}]");
    await e.cut();
    s.eq('no fabric is deducted for a cut that was already recorded',e.calls.fab.length,0);

    // The engine REFUSING a roll (a stale one: code fabric/rolls-unavailable) must
    // never block or corrupt cutting-done: the cut is saved, the failure is
    // reported and recorded, and a retry cannot duplicate anything.
    const f=boot({inventory:inv,fabFail:true});f.syncPOs();
    f.app.el('cut-fab-stock').value='k';f.app.run("_cutFabRolls=[{rollCode:'R1',weight:20}]");
    await f.cut();
    const fp=f.store.get('pos/PO-001');
    s.eq('the engine was asked to tolerate a missing roll',f.calls.fab[0]&&f.calls.fab[0].tolerateMissing,true);
    s.eq('a refused deduction does NOT block cutting-done: the PO moves on',fp.currentStage+':'+fp.stages.cutting.done,'bundling:true');
    s.eq('the bundles are made, once',f.bundles().length,3);
    s.eq('in one commit, with the PO',f.store.commits.length+':'+(commitPaths(f.store)[0]||[]).filter(x=>x==='pos/PO-001').length,'1:1');
    s.eq('no consumption is claimed',fp.fabricConsumed,undefined);
    s.eq('the failure is recorded on the PO, with the engine\'s code and the rolls',(fp.fabricConsumeFailed||{}).code+'|'+((fp.fabricConsumeFailed||{}).rollCodes||[]).join(','),'fabric/rolls-unavailable|R1');
    s.eq('and who/when',(fp.fabricConsumeFailed||{}).by+'|'+(fp.fabricConsumeFailed||{}).at,'Afnan|'+new Date(FIXED).toISOString());
    s.ok('it is REPORTED, as a warning, naming the fix',/Cutting done ✓ — 3 bundles\. Fabric was NOT deducted/.test(f.lastToast())&&/by hand/.test(f.lastToast()),f.lastToast());
    s.eq('the embellishment job was still topped up',f.calls.emb.length,1);
    await f.cut();
    s.eq('pressing again after that creates nothing more',f.bundles().length+':'+f.store.commits.length,'3:1');
    s.eq('and does not call the engine again',f.calls.fab.length,1);
  }

  s.section('fabric: rolls the engine SKIPPED are not claimed as consumed');
  {
    const inv=[{_id:'k',fabType:'Denim',gsm:300,color:'Blue',unit:'kg',totalWeight:100,rolls:[]}];
    const setup=o=>{const d=boot(Object.assign({inventory:inv},o));d.syncPOs();d.app.el('cut-fab-stock').value='k';
      d.app.run("_cutFabRolls=[{rollCode:'R1',weight:20},{rollCode:'R2',weight:30}]");return d;};
    const p=setup({skip:['R2']});await p.cut();
    const pp=p.store.get('pos/PO-001');
    s.eq('partly skipped: only the rolls really deducted are recorded as consumed',(pp.fabricConsumed.rollCodes||[]).join(',')+'|'+pp.fabricConsumed.qty,'R1|20');
    s.eq('the skipped roll is recorded as a failure, flagged partial',(pp.fabricConsumeFailed.rollCodes||[]).join(',')+'|'+pp.fabricConsumeFailed.partial+'|'+pp.fabricConsumeFailed.code,'R2|true|fabric/rolls-skipped');
    s.ok('the toast does not say fabric was deducted, names the skipped roll',/only PARTLY deducted/.test(p.lastToast())&&/R2/.test(p.lastToast())&&!/fabric deducted/.test(p.lastToast()),p.lastToast());
    s.eq('the cut itself still completes, once',pp.currentStage+':'+p.bundles().length+':'+p.store.commits.length,'bundling:3:1');
    const a=setup({skip:[{rollCode:'R1'},{rollCode:'R2'}]});await a.cut();
    const ap=a.store.get('pos/PO-001');
    s.eq('all skipped (object form): nothing is claimed as consumed',ap.fabricConsumed,undefined);
    s.eq('the failure lists both rolls, not partial',(ap.fabricConsumeFailed.rollCodes||[]).join(',')+'|'+ap.fabricConsumeFailed.partial,'R1,R2|false');
    s.ok('and the toast says NOT deducted',/NOT deducted/.test(a.lastToast())&&!/fabric deducted/.test(a.lastToast()),a.lastToast());
    const n=setup({});await n.cut();
    s.eq('nothing skipped: no failure recorded, both rolls consumed',(n.store.get('pos/PO-001').fabricConsumeFailed===undefined)+'|'+n.store.get('pos/PO-001').fabricConsumed.rollCodes.join(','),'true|R1,R2');
    s.ok('and the toast says fabric deducted',/fabric deducted/.test(n.lastToast()),n.lastToast());
    // A failed save then a retry keeps the partial result and calls the engine once.
    const r=setup({skip:['R2']});r.store.failNextCommit='lost';await r.cut();await r.cut();
    s.eq('retry after a failed save: engine called once',r.calls.fab.length,1);
    s.eq('and the retry still records the partial result',(r.store.get('pos/PO-001').fabricConsumed.rollCodes||[]).join(',')+'|'+(r.store.get('pos/PO-001').fabricConsumeFailed.rollCodes||[]).join(','),'R1|R2');
  }

  s.section('a stale screen cannot deduct fabric and then save nothing');
  {
    const inv=[{_id:'k',fabType:'Denim',gsm:300,color:'Blue',unit:'kg',totalWeight:100,rolls:[]}];
    const cs=n=>({poId:'PO-001',actualQty:{XS:0,S:n,M:0,L:0,XL:0,'2XL':0},pendingBundles:[{tempId:1,size:'S',units:n}]});
    // Local copy says 60 ordered (69 is in range); the live PO says 100 (69 is not).
    const d=boot({inventory:inv,cutState:cs(69)});
    d.app.run('allPOs='+JSON.stringify([Object.assign(po1({qty:60}),{fbKey:'PO-001'})]));
    d.app.el('cut-fab-stock').value='k';d.app.run("_cutFabRolls=[{rollCode:'R1',weight:20}]");
    await d.cut();
    s.eq('stale quantity outside the live gate: NO deduction call at all',d.calls.fab.length,0);
    s.eq('nothing saved',d.store.commits.length+':'+d.bundles().length,'0:0');
    s.ok('and the toast explains the live window',/69 pcs is outside the 70–130 allowed for 100 ordered/.test(d.lastToast()),d.lastToast());
    s.eq('the button is usable again',d.app.el('cut-done-btn').disabled,false);
    // Stale OVERRIDE: the local copy has one, the live PO does not: 60 of 100.
    const e=boot({inventory:inv,cutState:cs(60)});
    e.app.run('allPOs='+JSON.stringify([Object.assign(po1({cutOverride:{by:'afnan',byName:'Afnan',at:'x',reason:'r'}}),{fbKey:'PO-001'})]));
    e.app.el('cut-fab-stock').value='k';e.app.run("_cutFabRolls=[{rollCode:'R1',weight:20}]");
    await e.cut();
    s.eq('an override only the stale screen knows about: no deduction',e.calls.fab.length,0);
    s.eq('and nothing saved',e.store.commits.length,0);
  }

  s.section('mismatched bundles on file: the refusal names them');
  {
    const seed={'pos/PO-001':po1(),'counters/main':{pos:1,bundles:12}};
    for(let n=1;n<=12;n++)seed['bundles/B-'+String(n).padStart(4,'0')]={bundleId:'B-'+String(n).padStart(4,'0'),bundleNumber:n,poId:'PO-001',size:'L',units:1};
    const d=boot({seed});d.syncPOs();
    await d.cut();
    const t=d.lastToast();
    s.ok('it names the PO',/PO-001 already has/.test(t),t);
    s.ok('and the number of bundles',/12 bundles/.test(t),t);
    s.ok('and the first ten ids, in order',t.indexOf('B-0001, B-0002, B-0003, B-0004, B-0005, B-0006, B-0007, B-0008, B-0009, B-0010')>-1,t);
    s.ok('and a count for the rest, not the ids',/and 2 more/.test(t)&&t.indexOf('B-0011')===-1,t);
    s.ok('and says an owner must review them in the bundles collection',/owner must review/.test(t)&&/bundles collection/.test(t),t);
    s.eq('no delete/adopt path: nothing written',d.store.commits.length+':'+d.store.plain.length+':'+d.bundles().length,'0:0:12');
    const f=boot({seed:{'pos/PO-001':po1(),'counters/main':{bundles:5},'bundles/B-0005':{bundleId:'B-0005',bundleNumber:5,poId:'PO-001',size:'L',units:1}}});f.syncPOs();
    await f.cut();
    s.ok('one bundle: singular, no "more"',/already has 1 bundle on file/.test(f.lastToast())&&!/and \d+ more/.test(f.lastToast()),f.lastToast());
  }

  /* ═══ typed numbers: the open override gate is not a licence for nonsense ═══ */
  s.section('typed numbers: negatives, NaN, fractions and zero-unit bundles are refused, override or not');
  {
    const inv=[{_id:'k',fabType:'Denim',gsm:300,color:'Blue',unit:'kg',totalWeight:100,rolls:[]}];
    const Q=o=>Object.assign({XS:0,S:0,M:0,L:0,XL:0,'2XL':0},o);
    const B=(...a)=>a.map(([size,units],i)=>({tempId:i+1,size,units}));
    const OV={cutOverride:{by:'afnan',byName:'Afnan',at:'x',reason:'fabric short',ordered:100}};
    const trial=async(aq,bundles,withOverride)=>{
      const d=boot({inventory:inv,seed:{'pos/PO-001':po1(withOverride?OV:{}),'counters/main':{pos:1,bundles:0}},
        cutState:{poId:'PO-001',actualQty:Q(aq),pendingBundles:B(...bundles)}});
      d.syncPOs();d.app.el('cut-fab-stock').value='k';d.app.run("_cutFabRolls=[{rollCode:'R1',weight:20}]");
      await d.cut();return d;
    };
    const refused=async(label,aq,bundles,withOverride,rx)=>{
      const d=await trial(aq,bundles,withOverride);
      const t=d.lastToast();
      s.eq(label+': nothing saved',d.store.commits.length+':'+d.bundles().length+':'+d.store.get('pos/PO-001').stages.cutting.done,'0:0:false');
      s.eq(label+': no fabric deduction call',d.calls.fab.length,0);
      s.ok(label+': the message names what is wrong',rx.test(t)&&/Nothing was saved/.test(t),t);
      s.eq(label+': no database read at all (refused at the button)',d.store.getDocCalls+d.store.txRuns,0);
      s.eq(label+': the button check refuses it too',d.app.run('cutValidationOk('+JSON.stringify(Object.assign(po1(withOverride?OV:{}),{fbKey:'PO-001'}))+')'),false);
    };
    // The reported case: S=50 / M=-50 under an override (total 0, two bundles).
    await refused('S=50 M=-50 under an override',{S:50,M:-50},[['S',50],['M',-50]],true,/Size M: .*whole number, 0 or more \(got -50\)/);
    await refused('negative size, no override',{S:130,M:-5},[['S',130]],false,/Size M/);
    await refused('negative bundle units under an override',{S:50},[['S',100],['S',-50]],true,/Bundle 2 \(S\): the units must be a whole number above 0 \(got -50\)/);
    await refused('negative bundle units, no override',{S:100},[['S',130],['S',-30]],false,/Bundle 2 \(S\)/);
    await refused('zero-unit bundle',{S:50},[['S',50],['S',0]],true,/Bundle 2 \(S\): .*above 0 \(got 0\)/);
    await refused('NaN size quantity',{S:NaN},[['S',50]],true,/Size S: .*\(got NaN\)/);
    await refused('NaN bundle units',{S:50},[['S',NaN]],true,/Bundle 1 \(S\): .*\(got NaN\)/);
    await refused('fractional size quantity',{S:50.5},[['S',50]],true,/Size S: .*\(got 50\.5\)/);
    await refused('fractional bundle units',{S:50},[['S',12.5],['S',37.5]],true,/Bundle 1 \(S\): .*\(got 12\.5\)/);
    await refused('a size typed as text',{S:'50'},[['S',50]],true,/Size S: .*\(got "50"\)/);
    await refused('infinite size quantity',{S:Infinity},[['S',50]],true,/Size S: .*\(got Infinity\)/);
    await refused('a bundle for a size that cannot be cut',{S:50},[['S',20],['3XL',30]],true,/Bundle 2: "3XL" is not a size that can be cut/);
    await refused('a total of zero under an override',{},[['S',10]],true,/The total cut must be above 0/);

    // The pure checker says the same, in the same words.
    const pc=(aq,b)=>d0.app.run('poCutInputProblem('+JSON.stringify(Q(aq))+','+JSON.stringify(B(...b))+')');
    const d0=boot();
    s.eq('a sound cut has no problem',pc({S:50,M:50},[['S',50],['M',50]]),null);
    s.eq('a sound cut of any size under an override is the gate\'s business, not the checker\'s',pc({S:1000},[['S',1000]]),null);
    s.eq('the checker reports the first size at fault, in size order',pc({XS:-1,S:-2},[['S',1]]),'Size XS: the cut quantity must be a whole number, 0 or more (got -1).');

    // Legit cuts are unaffected.
    const ok=await trial({S:50,M:50},[['S',30],['S',20],['M',50]],false);
    s.eq('a normal cut still saves',ok.store.get('pos/PO-001').currentStage+':'+ok.bundles().length,'bundling:3');
    const ok2=await trial({S:250},[['S',250]],true);
    s.eq('an override still lets 250 of 100 through',ok2.store.get('pos/PO-001').currentStage+':'+ok2.store.get('pos/PO-001').cutOverride.pct,'bundling:250');
    const ok3=await trial({XS:10,'2XL':60},[['XS',10],['2XL',60]],false);
    s.eq('XS and 2XL (the ends of the size set) still save',ok3.store.get('pos/PO-001').currentStage,'bundling');

    // The TRANSACTION is the authority on its own: slip past both early checks
    // (the button and the first look in markCuttingDone) and it still refuses.
    const t=boot({inventory:inv,seed:{'pos/PO-001':po1(OV),'counters/main':{pos:1,bundles:0}},
      cutState:{poId:'PO-001',actualQty:Q({S:50,M:-50}),pendingBundles:B(['S',50],['M',-50])}});
    t.syncPOs();
    t.app.run("cutValidationOk=()=>true;const __real=poCutInputProblem;let __n=0;poCutInputProblem=(a,b)=>(++__n===1?null:__real(a,b));");
    await t.cut();
    s.eq('the transaction alone refuses S=50 / M=-50 under an override: nothing saved',t.store.commits.length+':'+t.bundles().length+':'+t.store.get('pos/PO-001').stages.cutting.done,'0:0:false');
    s.ok('and names the size at fault',/Size M: .*\(got -50\)/.test(t.lastToast())&&/Nothing was saved/.test(t.lastToast()),t.lastToast());
    s.eq('the PO is not marked done and no override use is stamped',t.store.get('pos/PO-001').cutOverride.usedAt,undefined);
  }

  /* ═══ the PO must be at cutting ═══ */
  s.section('only a PO that is waiting to be cut can be cut');
  {
    const wrong=boot({seed:{'pos/PO-001':po1({currentStage:'stitching'}),'counters/main':{pos:1,bundles:0}}});
    wrong.app.run('allPOs='+JSON.stringify([Object.assign(po1(),{fbKey:'PO-001'})]));
    await wrong.cut();
    s.eq('a PO that moved on is not cut again',wrong.bundles().length,0);
    s.ok('and the toast names where it is',/Stitching/.test(wrong.lastToast()),wrong.lastToast());
    const res=boot({seed:{'pos/PO-001':po1({poStatus:'reserved',currentStage:null}),'counters/main':{pos:1,bundles:0}}});
    res.app.run('allPOs='+JSON.stringify([Object.assign(po1(),{fbKey:'PO-001'})]));
    await res.cut();
    s.eq('a reserve order is not cut',res.bundles().length,0);
    s.ok('it says to release it first',/reserve order/.test(res.lastToast()),res.lastToast());
    // The PO's own record that cutting happened stops it even where the stage
    // field was never moved (a hand-reset, a half-applied repair).
    const flag=boot({seed:{'pos/PO-001':po1({stages:Object.assign(po1().stages,{cutting:{done:true,doneBy:'Uzaib'}})}),'counters/main':{pos:1,bundles:0}}});
    flag.app.run('allPOs='+JSON.stringify([Object.assign(po1(),{fbKey:'PO-001'})]));
    await flag.cut();
    s.eq('stages.cutting.done alone is enough to refuse, whatever currentStage says',flag.bundles().length,0);
    s.eq('with no commit',flag.store.commits.length,0);
    s.ok('and the toast names who cut it',/already recorded by Uzaib/.test(flag.lastToast()),flag.lastToast());
  }

  /* ═══ the owner override hook ═══ */
  s.section('poCutOverride: who may, what it records, who is told');
  {
    const NASTY='<img src=x onerror=alert(1)> & "q" \'z\'';
    const run=async(sess,reason,po)=>{
      const d=boot({session:sess,seed:{'pos/PO-001':po||po1({name:'Pants <b>X</b>'})}});d.syncPOs();
      await d.app.run(`window.poCutOverride('PO-001',${JSON.stringify(reason)})`);
      return d;
    };
    for(const [label,sess] of [['Uzaib (viewer)',UZAIB],['Arfat (manager)',ARFAT],['Haris (worker)',HARIS]]){
      const d=await run(sess,'a good reason');
      s.eq(label+' cannot approve a variance',d.store.commits.length,0);
      s.eq(label+': the PO is untouched',d.store.get('pos/PO-001').cutOverride,undefined);
      s.ok(label+': and is told so',/Only an owner or Mustafa/.test(d.lastToast()),d.lastToast());
    }
    const a=await run(OWNER,NASTY);
    const po=a.store.get('pos/PO-001');
    s.eq('an owner can: the override is on the PO',po.cutOverride&&po.cutOverride.by,'afnan');
    s.eq('with the overrider\'s name',po.cutOverride.byName,'Afnan');
    s.eq('when',po.cutOverride.at,new Date(FIXED).toISOString());
    s.eq('and the reason AS TYPED (it is escaped where it is drawn)',po.cutOverride.reason,NASTY);
    s.eq('the everyday gate it goes beyond is recorded',po.cutOverride.gateMin+'-'+po.cutOverride.gateMax,'0.7-1.3');
    s.eq('and what was ordered',po.cutOverride.ordered,100);
    const nid=a.store.ids('hrm_notifications')[0];
    s.eq('ONE transaction wrote the override and the notification',a.store.commits.length+':'+a.store.plain.length,'1:0');
    s.eq('…and that one commit carries BOTH documents',JSON.stringify((commitPaths(a.store)[0]||[]).slice().sort()),JSON.stringify(['hrm_notifications/'+nid,'pos/PO-001'].sort()));
    s.ok('a notification row was written',!!nid,String(nid));
    const n=a.store.get('hrm_notifications/'+nid)||{};
    s.eq('it is Mustafa\'s',n.forUser,'mustafa');
    s.eq('addressed by username, not by role',n.forRole,'');
    s.eq('with the bell\'s own row shape',[n.id===nid,Array.isArray(n.readBy)&&n.readBy.length===0,typeof n.createdAt,n.priority,n.actionRequired].join('|'),'true|true|number|high|false');
    s.eq('View goes to the PO registry',n.actionUrl,'po-registry');
    s.eq('and it names the PO to the bell',n.relatedTo,'PO-001');
    s.ok('the bell prints title and message RAW, so neither contains a tag',!/[<>]/.test(String(n.title)+String(n.message)),n.title+' || '+n.message);
    s.ok('the reason arrives escaped',String(n.message).indexOf('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot; &#39;z&#39;')>-1,n.message);
    s.ok('so does the PO name',String(n.message).indexOf('Pants &lt;b&gt;X&lt;/b&gt;')>-1,n.message);
    s.ok('it says who approved it',/Afnan approved a cut beyond 70–130% \(any quantity\)/.test(n.message),n.message);
    s.eq('the cutting screen note is escaped too',/[<>]/.test(a.app.run('_poCutOverrideNote('+JSON.stringify(po)+')').replace(/<\/?div[^>]*>/g,'')),false);
    s.ok('and says any quantity is allowed',/any quantity allowed/.test(a.app.run('_poCutOverrideNote('+JSON.stringify(po)+')')));
    s.ok('the activity row records it',a.app.state.activity.some(x=>x.action==='Cut variance approved'&&/PO PO-001/.test(x.detail)));
    s.ok('the toast says Mustafa was told',/Mustafa has been told/.test(a.lastToast()),a.lastToast());
    s.eq('the override opens the gate for that PO from now on',a.app.run('poCutGateFor('+JSON.stringify(po)+').open'),true);

    const am=await run(AMMAR,'second owner');
    s.eq('Ammar (owner) can too, and Mustafa is told',am.store.ids('hrm_notifications').length,1);

    const m=await run(MUSTAFA,'my own call');
    s.eq('Mustafa can approve (by username)',m.store.get('pos/PO-001').cutOverride&&m.store.get('pos/PO-001').cutOverride.by,'mustafa');
    s.eq('and is not notified of his own override',m.store.ids('hrm_notifications').length,0);
    s.ok('his toast does not claim he was told',!/has been told/.test(m.lastToast()),m.lastToast());

    // Idempotent
    await a.app.run("window.poCutOverride('PO-001','again')");
    s.eq('approving twice does not send a second notification',a.store.ids('hrm_notifications').length,1);
    s.eq('or write a second record',a.store.commits.length,1);
    s.ok('it says it is already approved',/already approved/.test(a.lastToast()),a.lastToast());
    // …also when THIS screen has not seen the first approval yet (a second device).
    const two=boot({seed:{'pos/PO-001':po1({cutOverride:{by:'ammar',byName:'Ammar',at:'x',reason:'first',ordered:100}})}});
    two.app.run('allPOs='+JSON.stringify([Object.assign(po1(),{fbKey:'PO-001'})]));
    await two.app.run("window.poCutOverride('PO-001','second device')");
    s.eq('a stale screen cannot approve over an approval it has not seen',two.store.commits.length,0);
    s.eq('the first approver is kept',two.store.get('pos/PO-001').cutOverride.by,'ammar');
    s.eq('and no second notification is sent',two.store.ids('hrm_notifications').length,0);
    s.ok('it says who approved it',/already approved on PO-001 \(by Ammar\)/.test(two.lastToast()),two.lastToast());
    // The title is escaped too — the bell prints it raw.
    const odd=boot({seed:{'pos/PO-001':po1({id:'PO-<i>1'})}});odd.syncPOs();
    await odd.app.run("window.poCutOverride('PO-001','a fine reason')");
    const on=odd.store.get('hrm_notifications/'+odd.store.ids('hrm_notifications')[0])||{};
    s.ok('a title carrying a tag is escaped',/PO-&lt;i&gt;1/.test(on.title)&&!/[<>]/.test(on.title),on.title);

    // A reason is required
    for(const bad of ['','  ','ab',null]){
      const d=boot({seed:{'pos/PO-001':po1()}});d.syncPOs();
      await d.app.run(`window.poCutOverride('PO-001',${JSON.stringify(bad)})`);
      s.eq('a reason of '+JSON.stringify(bad)+' approves nothing',d.store.commits.length,0);
    }
    // The prompt path
    const pr=boot({seed:{'pos/PO-001':po1()},globals:{prompt:()=>'asked in the prompt'}});pr.syncPOs();
    await pr.app.run("window.poCutOverride('PO-001')");
    s.eq('with no reason passed it asks, and uses the answer',pr.store.get('pos/PO-001').cutOverride&&pr.store.get('pos/PO-001').cutOverride.reason,'asked in the prompt');
    const pc=boot({seed:{'pos/PO-001':po1()},globals:{prompt:()=>null}});pc.syncPOs();
    await pc.app.run("window.poCutOverride('PO-001')");
    s.eq('cancelling the prompt approves nothing',pc.store.commits.length,0);

    // Only a PO waiting to be cut
    for(const [label,over] of [['already cut',{currentStage:'bundling',stages:Object.assign(po1().stages,{cutting:{done:true}})}],['a reserve order',{poStatus:'reserved',currentStage:null}],['past cutting',{currentStage:'stitching'}]]){
      const d=boot({seed:{'pos/PO-001':po1(over)}});d.syncPOs();
      await d.app.run("window.poCutOverride('PO-001','a good reason')");
      s.eq('no variance on a PO that is '+label,d.store.commits.length,0);
    }
    // The live document decides, not the screen
    const live=boot({seed:{'pos/PO-001':po1({currentStage:'bundling',stages:Object.assign(po1().stages,{cutting:{done:true}})})}});
    live.app.run('allPOs='+JSON.stringify([Object.assign(po1(),{fbKey:'PO-001'})]));
    await live.app.run("window.poCutOverride('PO-001','a good reason')");
    s.eq('a stale screen cannot approve a variance on a PO that has been cut',live.store.commits.length,0);
    s.eq('no notification for it',live.store.ids('hrm_notifications').length,0);
  }

  s.section('the cutting screen shows the window it is held to');
  {
    const d=boot();
    const plain=d.app.run('renderCuttingWork('+JSON.stringify(po1())+')');
    s.ok('everyday: "Allowed: 70–130 pcs (70–130%)" from the constant',/Allowed: 70–130 pcs \(70–130%\)/.test(plain),(/Allowed:[^<]*/.exec(plain)||[''])[0]);
    s.ok('and no override note',!/Owner override/.test(plain));
    const OV=po1({cutOverride:{by:'afnan',byName:'Afn<b>an',at:'x',reason:'<script>alert(1)</script>',ordered:100}});
    const wide=d.app.run('renderCuttingWork('+JSON.stringify(OV)+')');
    s.ok('approved: the window reads "any quantity (owner override)"',/Allowed: any quantity \(owner override\)/.test(wide),(/Allowed:[^<]*/.exec(wide)||[''])[0]);
    s.ok('and says an owner approved it',/Owner override: any quantity allowed — approved by/.test(wide));
    s.ok('the approver and the reason are escaped in the screen',wide.indexOf('Afn&lt;b&gt;an')>-1&&wide.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;')>-1&&wide.indexOf('<script>alert(1)')===-1);
    // The live recalculation (refreshCutPartial) writes the same words.
    d.app.run('window.__po='+JSON.stringify(OV));
    d.app.run('refreshCutPartial(window.__po)');
    const row=d.app.el('cut-total-row').innerHTML;
    s.ok('the live total row says any quantity too',/any quantity/.test(row)&&/Owner override/.test(row),row.slice(0,200));
    d.app.run('window.__po='+JSON.stringify(po1()));
    d.app.run('refreshCutPartial(window.__po)');
    s.ok('and 70–130% without an override',/\(70–130%\)/.test(d.app.el('cut-total-row').innerHTML)&&!/Owner override/.test(d.app.el('cut-total-row').innerHTML));
  }

  s.section('poCutOverride on the PO page');
  {
    const render=async sess=>{
      const d=boot({session:sess,currentPage:'po-detail',viewingPO:'PO-001'});d.syncPOs();
      d.app.run("viewingPO='PO-001'");
      d.app.run('renderDetailPage()');
      return d.app.el('main-content').innerHTML;
    };
    const o=await render(OWNER);
    s.ok('the owner sees Approve cut variance on the cutting row',/Approve cut variance/.test(o));
    s.ok('and the old Force advance is still there (it explains itself)',/Force advance/.test(o));
    s.ok('Mustafa sees it',/Approve cut variance/.test(await render(MUSTAFA)));
    s.ok('Arfat (a manager) does NOT',!/Approve cut variance/.test(await render(ARFAT)));
    s.ok('Uzaib does NOT',!/Approve cut variance/.test(await render(UZAIB)));
  }

  /* ═══ the real stage order and force-advance ═══ */
  s.section('the real stage order');
  {
    const d=boot();
    s.eq('the real flow',d.app.run('JSON.stringify(PO_REAL_STAGE_ORDER)'),JSON.stringify(['cutting','bundling','stitching','printing','washing','qc']));
    s.ok('shared.js STAGE_KEYS is a different (display) order — that is the bug',d.app.run('JSON.stringify(STAGE_KEYS)')!==d.app.run('JSON.stringify(PO_REAL_STAGE_ORDER)'),d.app.run('JSON.stringify(STAGE_KEYS)'));
    const nxt=k=>d.app.run(`poRealNextStage(${JSON.stringify(k)})`);
    s.eq('cutting → bundling',nxt('cutting'),'bundling');
    s.eq('bundling → stitching',nxt('bundling'),'stitching');
    s.eq('stitching → printing',nxt('stitching'),'printing');
    s.eq('printing → washing',nxt('printing'),'washing');
    s.eq('washing → qc',nxt('washing'),'qc');
    s.eq('qc → completed',nxt('qc'),'completed');
    s.eq('an unknown stage has no next',nxt('packing'),null);
    s.eq('the next stage is never earlier in the flow',STAGE_LIST.every(k=>{const n=nxt(k);return n==='completed'||STAGE_LIST.indexOf(n)>STAGE_LIST.indexOf(k);}),true);
    // What the old code did, for the record: STAGE_KEYS[idx+1].
    s.eq('(the old answer for cutting was printing — skipping bundling and stitching)',d.app.run("STAGE_KEYS[STAGE_KEYS.indexOf('cutting')+1]"),'printing');
    s.eq('(and for printing it was bundling — BACKWARDS)',d.app.run("STAGE_KEYS[STAGE_KEYS.indexOf('printing')+1]"),'bundling');
  }

  s.section('ownerAdvance follows the real flow and records who forced it');
  {
    const cases=[['bundling','stitching'],['stitching','printing'],['printing','washing'],['washing','qc'],['qc','completed']];
    for(const [from,to] of cases){
      const d=boot({seed:{'pos/PO-001':po1({currentStage:from})}});d.syncPOs();
      await d.app.run(`window.ownerAdvance('PO-001','${from}')`);
      const p=d.store.get('pos/PO-001'),st=p.stages[from];
      s.eq(from+' → '+to,p.currentStage,to);
      s.eq(from+': marked done',st.done,true);
      s.eq(from+': the existing text is kept',st.doneBy,'Afnan (override)');
      s.eq(from+': doneAt is the ISO time',st.doneAt,new Date(FIXED).toISOString());
      s.eq(from+': forcedBy is the username',st.forcedBy,'afnan');
      s.eq(from+': forcedAt',st.forcedAt,new Date(FIXED).toISOString());
      s.eq(from+': forcedFrom',st.forcedFrom,from);
      s.eq(from+': forcedTo',st.forcedTo,to);
      s.eq(from+': one transaction, nothing else written',d.store.commits.length+':'+d.store.plain.length,'1:0');
      s.ok(from+': logged as a stage override naming where it went',d.app.state.activity.some(a=>a.action==='Stage override'&&new RegExp('PO PO-001').test(a.detail)&&/→/.test(a.detail)));
      s.eq(from+': other PO fields untouched',p.name+':'+p.qty,'Live In Pants:100');
    }
    // It never touches the stages it is not forcing.
    const d=boot({seed:{'pos/PO-001':po1({currentStage:'stitching'})}});d.syncPOs();
    await d.app.run("window.ownerAdvance('PO-001','stitching')");
    const p=d.store.get('pos/PO-001');
    s.eq('the next stage is not marked done',p.stages.printing.done,false);
    s.eq('nor given forced fields',p.stages.printing.forcedBy,undefined);
    s.eq('an earlier stage is not touched',p.stages.bundling.done,false);
    s.ok('it asked first, naming the destination',d.app.state.confirms.some(c=>/Stitching/.test(c)&&/Printing|Embellishment QC/.test(c)),d.app.state.confirms.join('|'));
  }

  s.section('ownerAdvance acts only on the stage the PO is at');
  {
    const attempt=async(po,stage,sess)=>{
      const d=boot({session:sess||OWNER,seed:{'pos/PO-001':po}});d.syncPOs();
      await d.app.run(`window.ownerAdvance('PO-001','${stage}')`);
      return d;
    };
    let d=await attempt(po1({currentStage:'stitching'}),'bundling');
    s.eq('going BACKWARDS (bundling when it is at stitching) is refused',d.store.commits.length+d.store.plain.length,0);
    s.eq('the PO has not moved',d.store.get('pos/PO-001').currentStage,'stitching');
    s.ok('the message names the stage it is at',/at Stitching, not at Bundling/.test(d.lastToast()),d.lastToast());
    s.eq('it never even asked for confirmation',d.app.state.confirms.length,0);
    d=await attempt(po1({currentStage:'stitching'}),'washing');
    s.eq('skipping AHEAD (washing when it is at stitching) is refused',d.store.commits.length+d.store.plain.length,0);
    d=await attempt(po1({currentStage:'completed'}),'qc');
    s.eq('a completed PO is refused',d.store.commits.length+d.store.plain.length,0);
    s.ok('and said to be complete',/already complete/.test(d.lastToast()),d.lastToast());
    d=await attempt(po1({poStatus:'reserved',currentStage:null}),'cutting');
    s.eq('a reserve order is refused',d.store.commits.length+d.store.plain.length,0);
    s.ok('and told to release it first',/reserve order/.test(d.lastToast()),d.lastToast());
    d=await attempt(po1({currentStage:'stitching'}),'packing');
    s.eq('a stage that is not in the flow is refused',d.store.commits.length+d.store.plain.length,0);
    d=await attempt(po1({currentStage:'stitching'}),'stitching',HARIS);
    s.eq('a worker is not authorised',d.store.commits.length+d.store.plain.length,0);
    s.ok('and is told so',/Not authorized/.test(d.lastToast()),d.lastToast());
    d=await attempt(po1({currentStage:'stitching'}),'stitching',ARFAT);
    s.eq('a manager still may (the existing gate is unchanged)',d.store.get('pos/PO-001').currentStage,'printing');
    d=boot({seed:{'pos/PO-001':po1({currentStage:'stitching'})},globals:{confirm:()=>false}});d.syncPOs();
    await d.app.run("window.ownerAdvance('PO-001','stitching')");
    s.eq('declining the confirmation writes nothing',d.store.commits.length+d.store.plain.length,0);

    // The screen is stale: it still says stitching, the PO has since reached washing.
    const st=boot({seed:{'pos/PO-001':po1({currentStage:'washing'})}});
    st.app.run('allPOs='+JSON.stringify([Object.assign(po1({currentStage:'stitching'}),{fbKey:'PO-001'})]));
    await st.app.run("window.ownerAdvance('PO-001','stitching')");
    s.eq('a stale screen cannot drag the PO back: the LIVE stage is judged inside the transaction',st.store.get('pos/PO-001').currentStage,'washing');
    s.eq('nothing was committed',st.store.commits.length,0);
    s.ok('and it says where the PO is now',/at Washing, not at Stitching/.test(st.app.state.toasts.join('|')),st.app.state.toasts.join('|'));
  }

  s.section('ownerAdvance cannot force cutting — and says why');
  {
    const d=boot({seed:{'pos/PO-001':po1()},globals:{}});d.syncPOs();
    await d.app.run("window.ownerAdvance('PO-001','cutting')");
    s.eq('cutting is refused: nothing written',d.store.commits.length+d.store.plain.length,0);
    s.eq('the PO stays at cutting',d.store.get('pos/PO-001').currentStage,'cutting');
    s.eq('no bundles were made out of thin air',d.bundles().length,0);
    s.ok('the message points at the cutting screen',/cutting screen/.test(d.lastToast()),d.lastToast());
    s.ok('and at the owner override for a cut outside the window',/70–130%/.test(d.lastToast())&&/approve it/.test(d.lastToast()),d.lastToast());
    s.eq('it did not ask for confirmation of something it would refuse',d.app.state.confirms.length,0);
    s.eq('the embellishment job was not touched',d.calls.emb.length,0);
    s.eq('the pure planner agrees',d.app.run("poForceAdvancePlan({id:'PO-001',poStatus:'in_production',currentStage:'cutting'},'cutting').ok"),false);
    s.eq('and approves every other current stage',['bundling','stitching','printing','washing','qc'].every(k=>d.app.run(`poForceAdvancePlan({id:'PO-1',poStatus:'in_production',currentStage:'${k}'},'${k}').ok`)),true);
  }

  /* ═══ completeQC ═══ */
  s.section('completeQC: only the stage the PO is at; poStatus is left alone');
  {
    const at=async(stage,fbPatch)=>{
      const d=boot({seed:{'pos/PO-001':po1(Object.assign({currentStage:stage},fbPatch||{}))}});d.syncPOs();
      await d.app.run("window.completeQC('PO-001')");
      return d;
    };
    let d=await at('qc');
    let p=d.store.get('pos/PO-001');
    s.eq('at Final QC it completes',p.currentStage,'completed');
    s.eq('with its stage record',p.stages.qc.done+':'+p.stages.qc.doneBy,'true:Afnan');
    s.eq('poStatus is NOT flipped (Packing still selects in_production POs — js/production.js:37)',p.poStatus,'in_production');
    s.ok('and that is not even in the write',!d.store.plain.some(w=>w.patch&&Object.prototype.hasOwnProperty.call(w.patch,'poStatus')));
    d=await at('washing');
    s.eq('a PO still at washing cannot be QC-completed',d.store.get('pos/PO-001').currentStage,'washing');
    s.eq('nothing was written',d.store.plain.length,0);
    s.ok('and it says so',/not at Final QC/.test(d.lastToast()),d.lastToast());
    d=await at('completed',{stages:Object.assign(po1().stages,{qc:{done:true,doneBy:'Haris',doneAt:'2026-10-01T00:00:00.000Z'}})});
    s.eq('a completed PO is not completed again (who finished QC is not overwritten)',d.store.get('pos/PO-001').stages.qc.doneBy,'Haris');
    s.eq('nothing was written',d.store.plain.length,0);
    s.ok('and it says it was already done',/already completed Final QC/.test(d.lastToast()),d.lastToast());
  }

  return s;
};

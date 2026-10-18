/* Production Ops: the PO key, Find-the-issue, Data health, the stuck basis and the verifier's UI fixes (14 Oct 2026).

   What this drives -- the REAL js/ph-core.js, ph-data.js, ph-write.js, ph-ui.js, ph-mod-health.js, ph-mod-cutting.js, ph-mod-monitor.js,
   ph-mod-admin.js, ph-mod-calendar.js and ph-mod-drafts.js loaded together in one vm (as the page loads them), over tests/ph-dom.js's small
   DOM and a fake Firestore, with REAL documents trimmed from the 10 Oct 2026 production backup (tests/ph-health-fixture.js):
     1  PO ID MATCH      phPoKey: 'PO-125', '125', '090', 'po-0125', ' PO 125 ' are one key; 'Sample' and blank are none; Today's Cutting asks
                         Firestore for every spelling (an `in` query); Reports and the master log match through the same key
     2  FIND THE ISSUE   a job with no fabric issue lists the passes that point at no real PO, best guess first; a tap keeps the choice IN
                         MEMORY (the published rules allow no fabricPassIds on po_cut_jobs) and writes NOTHING; the checklist then works
     3  DATA HEALTH      the seven checks, every count worked out by hand from the fixture, honest unavailable states, the drill list
     4  UI FIXES         a, b, c, d, e, g, h, i, j, k, l (the letters of the verifier's list; f is a stylesheet rule)
     5  STUCK BASIS      a PO at cutting is counted from its FIRST fabric issue when there is one, else from its release date, and the
                         caption says how many used each
     6  DELETES / BACKUP is held in tests/po-numbering.test.js and tests/prod-backup.test.js (the link guard and the collection list)
   What it does NOT prove: geometry (tests/smoke-layout.js), the real Firestore SDK, a real phone. Each "break" mutates a source and requires
   the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const fx=require('./ph-health-fixture');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const FILES={core:'js/ph-core.js',data:'js/ph-data.js',write:'js/ph-write.js',ui:'js/ph-ui.js',health:'js/ph-mod-health.js',cutting:'js/ph-mod-cutting.js',
  monitor:'js/ph-mod-monitor.js',admin:'js/ph-mod-admin.js',calendar:'js/ph-mod-calendar.js',drafts:'js/ph-mod-drafts.js',queue:'js/ph-mod-queue.js'};
const SRC={};Object.keys(FILES).forEach(k=>{SRC[k]=read(FILES[k]);});
const CSS=read('css/main.css');
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'}
};
const FIXED=Date.UTC(2026,9,12,20,0,0);   // 01:00 PKT on 13 Oct 2026
class FixedDate extends Date{constructor(...a){if(a.length)super(...a);else super(FIXED);}static now(){return FIXED;}}
const TODAY='2026-10-13';
const J=JSON.stringify;
const clone=x=>JSON.parse(JSON.stringify(x));
const PERM=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));await new Promise(r=>setTimeout(r,5));};
const POS=Object.fromEntries(fx.pos.map(p=>[p.id,p]));
const PASS=Object.fromEntries(fx.passes.map(p=>[p.id,p]));

function fakeFs(o){
  o=o||{};
  const reads=[],txs=[],plain=[];
  const api={
    db:{},collection:(db,...s)=>({path:s.join('/')}),doc:(db,...s)=>({path:s.join('/')}),
    query:(c,...cs)=>({path:c.path,w:cs.filter(x=>x&&x.w).map(x=>x.w)}),
    where:(f,op,v)=>({w:[f,op,v]}),orderBy:()=>({}),limit:()=>({}),
    getDocs:async q=>{
      reads.push({path:q.path,w:q.w});
      const f=o.fail&&o.fail[q.path];if(f)throw f();
      if(o.failUnfiltered&&o.failUnfiltered[q.path]&&!(q.w&&q.w.length))throw o.failUnfiltered[q.path]();
      let rows=(o.data&&o.data[q.path])||[];
      (q.w||[]).forEach(w=>{rows=rows.filter(r=>w[1]==='in'?w[2].indexOf(r[w[0]])>-1:r[w[0]]===w[2]);});
      return{docs:rows.map(r=>({id:r.id,data:()=>Object.assign({},r)})),metadata:{fromCache:!!(o.fromCache&&o.fromCache[q.path])}};
    },
    getDoc:async r=>{
      reads.push({path:r.path});
      const f=o.fail&&o.fail[r.path];if(f)throw f();
      const d=o.data&&o.data[r.path];
      return{exists:()=>!!d,data:()=>Object.assign({},d),metadata:{fromCache:false}};
    },
    setDoc:async r=>{plain.push('setDoc '+r.path);},updateDoc:async r=>{plain.push('updateDoc '+r.path);},addDoc:async()=>{plain.push('addDoc');},
    deleteDoc:async()=>{plain.push('deleteDoc');},writeBatch:()=>{plain.push('writeBatch');return{set(){},update(){},delete(){},commit:async()=>{}};},
    runTransaction:async(db,fn)=>{
      const ops=[];
      const tx={get:async ref=>{const d=o.data&&o.data[ref.path];return{exists:()=>!!d,data:()=>clone(d||{})};},
        set:(ref,d)=>{ops.push({op:'set',path:ref.path,data:clone(d)});},update:(ref,d)=>{ops.push({op:'update',path:ref.path,data:clone(d)});}};
      await fn(tx);txs.push(ops);
    }
  };
  return{api,reads,txs,plain};
}
const job=(id,o)=>Object.assign({id,poId:id,status:'open',rev:2,plannedCutDate:TODAY,masterId:'CM-001',masterName:'Hassan',plannedFabric:null,rollsChecklist:null,note:'',createdAt:1,createdBy:'u',updatedAt:1,updatedBy:'u'},o||{});
function baseData(extra){
  const d={
    po_drafts:[],cutting_masters:[{id:'CM-001',name:'Hassan'},{id:'CM-002',name:'Alam'}],ph_standards:[],'ph_settings/main':{},
    po_cut_jobs:[job('PO-048'),job('PO-090'),job('PO-125',{plannedCutDate:'2026-10-20'}),job('PO-030',{plannedCutDate:'2026-10-20'})],
    pos:fx.pos.map(p=>clone(p)),gatepasses:fx.passes.map(p=>clone(p))
  };
  fx.pos.forEach(p=>{d['pos/'+p.id]=clone(p);});
  return Object.assign(d,extra||{});
}

function load(src,opts){
  opts=opts||{};
  src=src||SRC;
  const data=opts.data||baseData();
  const fk=fakeFs({data:data,fail:opts.fail,failUnfiltered:opts.failUnfiltered,fromCache:opts.fromCache});
  const calls=[];
  const a=harness.loadApp({files:['js/ph-i18n.js'],session:opts.session||USERS.afnan,currentPage:'dashboard',
    globals:Object.assign({},fk.api,{Date:FixedDate,allPOs:opts.allPOs,allPasses:opts.allPasses,
      localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
      history:{replaceState(s,t,u){calls.push(String(u));},pushState(){}}},opts.globals||{})});
  const ctx=a.ctx;if(typeof ctx.phI18nSetLang==='function')ctx.phI18nSetLang('en');
  const dom=domkit.install(ctx);
  ctx.window.showPage=function(id){ctx.currentPage=id;if(id==='prod-ops')ctx.phRenderPage(id);return Promise.resolve();};
  ctx.window.startApp=async function(){};
  ctx.console={warn(){},log(){},error(){}};
  if(opts.pre)opts.pre(ctx);
  ['core','data','write'].forEach(k=>{vm.runInContext(src[k],ctx,{filename:FILES[k]});});
  ['ui','health','queue','drafts','calendar','cutting','monitor','admin'].forEach(k=>{vm.runInContext(src[k],ctx,{filename:FILES[k]});});
  const T={a,ctx,dom,fk,R:c=>a.run(c),panel:()=>dom.find('ph-panel'),text:n=>n?n.textContent:'',
    card:id=>dom.all(dom.body,n=>n.getAttribute('data-po')===id)[0]||null,
    btns:(root,t)=>dom.all(root||dom.body,n=>n.tagName==='BUTTON'&&n.textContent===t),
    byClass:(root,c)=>dom.all(root||dom.body,n=>n.classList.contains(c)),
    click:n=>dom.click(n),
    open:async(tab)=>{await ctx.window.showPage('prod-ops');await settle();ctx.phGoTab(tab);await settle();await settle();}
  };
  return T;
}

async function checks(src,only){
  const o={};
  const grp={cur:''};
  const want=g=>!only||only.indexOf(g)>-1;
  const set=(k,v)=>{o[k]=v;};
  const T0=load(src);
  const R0=c=>T0.R(c);

  /* ── 1. the PO key ── */
  if(want('key')){
    const key=v=>R0('phPoKey('+J(v)+')');
    set('key: PO-125 / 125 / 090 / po-0125 / " PO 125 " / PO_125 / the number 125 are ONE key',[key('PO-125'),key('125'),key('po-0125'),key(' PO 125 '),key('PO_125'),key(125)].every(k=>k==='PO-125')&&key('090')==='PO-090'&&key('PO-017')==='PO-017'&&key('17')==='PO-017');
    set('key: free text, blank, zero and a missing value are NOT a PO key (null)',[key('Sample'),key('SAMPLE'),key('Sample & Sleeve'),key(''),key(null),key('0'),key('PO-0'),key('12ab')].every(k=>k===null));
    set('key: a bare number with no PO ("538") still gets a key, so a lookup can say "PO-538 does not exist"',key('538')==='PO-538');
    set('key: the spelling is told apart (prefixed / digits / none)',R0('[phPoSpelling("PO-125"),phPoSpelling("125"),phPoSpelling("Sample")].join("|")')==='prefixed|digits|');
    set('key: the Firestore spellings of PO-017 are PO-017, 017, 17 (an `in` query takes at most 10)',J(R0('phPoSpellings("PO-017")'))===J(['PO-017','017','17','PO-17'])&&R0('phPoSpellings("PO-125").length')<=10&&R0('phPoSpellings("Sample").length')===0);
  }

  /* ── 3. the data-health model, over the real fixture ── */
  if(want('model')){
    const M=(pos,passes,jobs,picks)=>JSON.parse(J(R0('phhBuildModel('+J({pos:pos,passes:passes,jobs:jobs,picks:picks||{}})+')')));
    const jobs=[job('PO-030'),job('PO-048'),job('PO-090'),job('PO-017'),job('PO-088',{status:'complete'})];
    const m=M(fx.pos,fx.passes,jobs);
    const ids=c=>m.byId[c].items.map(i=>i.id).sort().join(',');
    set('health: POs at cutting with no fabric issue = PO-030, PO-048, PO-088 (3)',ids('cutting_no_pass')==='PO-030,PO-048,PO-088'&&m.byId.cutting_no_pass.count===3);
    set('health: POs matched ONLY by the digit spelling = PO-090 ("090") and PO-125 ("125") (2); PO-017 ("PO-017") is not',ids('digits_only')==='PO-090,PO-125');
    set('health: fabric passes pointing at no real PO = GP-108 ("538"), GP-109 ("533"), GP-172 ("Sample") (3); a digit pass for a real PO is not',ids('orphan_passes')==='GP-108,GP-109,GP-172');
    set('health: reserved POs that already have fabric issued = PO-061 (1)',ids('reserved_issued')==='PO-061');
    set('health: qty != sum of sizes = PO-048 (20 vs 2) and PO-088 (60 vs 80) (2); PO-017 (90 = 15+30+30+15) is fine',ids('qty_mismatch')==='PO-048,PO-088'&&/qty 20 but sizes add to 2/.test(m.byId.qty_mismatch.items.filter(i=>i.id==='PO-048')[0].text));
    set('health: fabric issues with no cutting master = GP-108, GP-109 (2); a master on the pass (GP-172 Hassan) counts as one',ids('pass_no_master')==='GP-108,GP-109');
    set('health: open cut jobs with no fabric link = PO-030 and PO-048 (PO-090/PO-017 have passes, PO-088 is complete)',ids('jobs_no_fabric')==='PO-030,PO-048');
    set('health: a pass picked in Find-the-issue links its job (PO-048 drops out)',(()=>{const mm=M(fx.pos,fx.passes,jobs,{'PO-048':['GP-108']});return mm.byId.jobs_no_fabric.items.map(i=>i.id).join()==='PO-030';})());
    set('health: the total is the sum of the counts that ran',m.total===3+2+3+1+2+2+2);
    set('health: a cancelled PO is out of the PO lists but is a REAL PO for the orphan test (its passes are not orphans)',(()=>{
      const c=clone(POS['PO-017']);c.id='PO-538';c.poStatus='cancelled';
      const mm=M(fx.pos.concat([c]),fx.passes,null);
      return mm.byId.orphan_passes.items.map(i=>i.id).sort().join()==='GP-109,GP-172'&&!mm.byId.cutting_no_pass.items.some(i=>i.id==='PO-538');})());
    set('health: POs not loaded -> every PO check is UNAVAILABLE naming pos, count null (never 0)',(()=>{
      const mm=M(null,fx.passes,jobs);
      return mm.byId.cutting_no_pass.state==='unavailable'&&mm.byId.cutting_no_pass.count===null&&mm.byId.cutting_no_pass.unavailable.join()==='pos'&&mm.byId.pass_no_master.state==='ok'&&mm.byId.qty_mismatch.state==='unavailable';})());
    set('health: gate passes not loaded -> checks that need them are UNAVAILABLE naming gatepasses; qty_mismatch still runs',(()=>{
      const mm=M(fx.pos,null,jobs);
      return mm.byId.orphan_passes.unavailable.join()==='gatepasses'&&mm.byId.jobs_no_fabric.unavailable.join()==='gatepasses'&&mm.byId.qty_mismatch.state==='ok'&&mm.byId.qty_mismatch.count===2;})());
    set('health: cut jobs not loaded -> only the job check is unavailable, naming po_cut_jobs',(()=>{
      const mm=M(fx.pos,fx.passes,null);
      return mm.byId.jobs_no_fabric.unavailable.join()==='po_cut_jobs'&&mm.byId.cutting_no_pass.state==='ok';})());
    set('health: junk input never throws',(()=>{try{R0('phhBuildModel(null)');R0('phhBuildModel({pos:[null,3,"x"],passes:[null,{gpType:"fabric"}],jobs:[7]})');return true;}catch(e){return false;}})());
    set('health: a pass whose poId is a NUMBER maps to its PO',(()=>{const g=clone(PASS['GP-345']);g.poId=125;const mm=M(fx.pos,[g],null);return mm.byId.orphan_passes.count===0&&mm.byId.cutting_no_pass.items.every(i=>i.id!=='PO-125');})());
  }

  /* ── 3b. the three QC checks (16 Oct 2026), hand-computed from synthetic recon / lot documents beside the real PO shapes ── */
  if(want('qc')){
    const T_=Date.UTC;
    const mkQ=(id,o)=>Object.assign({id:id,code:'GST073',name:'Tee '+id,qty:120,sizes:{S:20,M:40,L:40,XL:20},poStatus:'in_production',currentStage:'qc',
      cutAt:'2026-10-14T08:00:00Z',cutQty:{S:20,M:40,L:40,XL:20},stages:{cutting:{done:true,doneAt:'2026-10-14T08:00:00Z'}},ts:1784891095206},o||{});
    const LK=(sizes)=>({sizes:sizes,total:Object.values(sizes).reduce((a,b)=>a+b,0),cutAt:'2026-10-14T08:00:00Z',cutBy:'Uzaib',lockedAt:1,lockedBy:'faizan',source:'first_lot'});
    const RC=(id,status,lock,created,o)=>Object.assign({id:id,fbKey:id,poId:id,status:status,rev:1,cutLock:lock,lotCount:1,voidCount:0,lastLotAt:created,overrides:[],legacyIds:[],createdAt:created,createdBy:'faizan',updatedAt:created,updatedBy:'faizan'},o||{});
    const LOT=(poId,seq,sizes,o)=>Object.assign({id:poId+'-'+seq,fbKey:poId+'-'+seq,poId:poId,seq:seq,sizes:sizes,total:Object.values(sizes).reduce((a,b)=>a+b,0),day:'2026-10-16',note:'',at:T_(2026,9,16,5,0),by:'faizan',byName:'Faizan',status:'live',src:'qc'},o||{});
    const MIR=(lotId,size,qty,o)=>Object.assign({id:'QL-'+lotId+'-'+size,receiptId:lotId,size:size,qty:qty,ts:'2026-10-16T05:00:00.000Z',by:'Faizan',src:'qc'},o||{});
    const OLD=(id,size,qty)=>({id:id,receiptId:id.split('-')[0],size:size,qty:qty,ts:'2026-10-01T05:00:00.000Z',by:'Haris'});
    const FIRST=T_(2026,9,13,5,0,0);                                    // 13 Oct 10:00 PKT = the oldest reconciliation -> go-live 2026-10-13
    const posQ=[
      mkQ('PO-201'),                                                    // lock == cut: no drift
      mkQ('PO-202',{cutQty:{S:22,M:38,L:40,XL:20}}),                    // drift S 20->22, M 40->38, totals equal (120)
      mkQ('PO-203',{cutQty:{S:10,M:15},sizes:{S:10,M:15},qty:25}),      // drift M 10->15, total 20->25
      mkQ('PO-204'),                                                    // lock unreadable
      mkQ('PO-206'),mkQ('PO-207'),                                       // closed short (118 of 120) / closed exact
      mkQ('PO-205',{poStatus:'cancelled',cutQty:{S:99}}),               // cancelled: out of every list
      mkQ('PO-301',{packingReceipts:[OLD('R1-S','S',10),MIR('PO-301-1','S',5)]}),           // old units not adopted + a lot
      mkQ('PO-302',{packingReceipts:[MIR('PO-302-1','S',20),MIR('PO-302-1','M',10)]}),      // counter == lot: fine
      mkQ('PO-303',{packingReceipts:[MIR('PO-303-1','S',15)]}),                              // counter 15, lot 20
      mkQ('PO-304',{packingReceipts:[MIR('PO-304-1','S',10),MIR('PO-304-2','S',10),MIR('PO-304-2','S',-10,{voidOf:'PO-304-2'})]}),   // net 10, live 10, one void lot
      mkQ('PO-305',{packingReceipts:[OLD('R9-S','S',10)]}),                                  // adopted: fine
      mkQ('PO-306',{packingReceipts:[OLD('R8-S','S',10)]}),                                  // old Packing only, no lots: the classic way
      mkQ('PO-307',{packingReceipts:[MIR('PO-307-1','S',5)]}),                               // counter 5, no lot rows at all
      mkQ('PO-308',{packingReceipts:[MIR('PO-308-1','XXL',7)]}),                             // 'XXL' (counter) vs '2XL' (lot)
      mkQ('PO-401',{currentStage:'completed',stages:{qc:{done:true,doneAt:'2026-10-17T10:00:00.000Z'}}}),   // after go-live, no recon
      mkQ('PO-402',{currentStage:'completed',stages:{qc:{done:true,doneAt:'2026-10-10T10:00:00.000Z'}}}),   // before go-live
      mkQ('PO-403',{currentStage:'completed',cutQty:null,stages:{qc:{done:true,doneAt:'2026-10-17T10:00:00.000Z'}}}),   // recon closed
      mkQ('PO-404',{currentStage:'completed',cutQty:null,stages:{qc:{done:true,doneAt:'2026-10-14T10:00:00.000Z'}}}),   // recon reopened
      mkQ('PO-405',{currentStage:'completed',cutAt:'2026-10-18T08:00:00Z',stages:{}}),                        // no doneAt: cut date after go-live
      mkQ('PO-406',{currentStage:'completed',cutAt:null,stages:{}}),                                         // undated
      mkQ('PO-407',{currentStage:'completed',stages:{qc:{doneAt:'2026-10-12T19:30:00.000Z'}}}),              // 13 Oct 00:30 PKT = go-live day: counted
      mkQ('PO-408',{currentStage:'completed',stages:{qc:{doneAt:'2026-10-12T18:59:00.000Z'}}}),              // 12 Oct 23:59 PKT: before
      mkQ('PO-409',{currentStage:'completed',poStatus:'cancelled',stages:{qc:{doneAt:'2026-10-17T10:00:00.000Z'}}})  // cancelled: out
    ];
    posQ.forEach(p=>{p.fbKey=p.id;});
    const recQ=[
      RC('PO-201','locked',LK({S:20,M:40,L:40,XL:20}),FIRST),
      RC('PO-202','locked',LK({S:20,M:40,L:40,XL:20}),T_(2026,9,14,5,0)),
      RC('PO-203','locked',LK({S:10,M:10}),T_(2026,9,14,6,0)),
      RC('PO-204','locked',{sizes:{S:'x'},total:20},T_(2026,9,14,7,0)),
      RC('PO-205','locked',LK({S:50}),T_(2026,9,14,8,0)),
      RC('PO-299','locked',LK({S:50}),T_(2026,9,14,9,0)),                // its PO is not in the list: skipped
      RC('PO-403','closed',LK({S:10}),T_(2026,9,15,5,0)),
      RC('PO-206','closed',LK({S:20,M:40,L:40,XL:20}),T_(2026,9,15,8,0),{closeVerdict:{state:'short',phase:'short',total:{cut:120,recv:118,diff:-2}},overrides:[{kind:'close_short',cause:'lost_line',reason:'two lost'}]}),
      RC('PO-207','closed',LK({S:20,M:40,L:40,XL:20}),T_(2026,9,15,9,0),{closeVerdict:{state:'exact',phase:'ready',total:{cut:120,recv:120,diff:0}}}),
      RC('PO-404','reopened',LK({S:10}),T_(2026,9,15,6,0)),
      RC('PO-305','locked',LK({S:20,M:40,L:40,XL:20}),T_(2026,9,15,7,0),{legacyIds:['R9-S']})
    ];
    const lotsQ=[
      LOT('PO-301',1,{S:5}),LOT('PO-302',1,{S:20,M:10}),LOT('PO-303',1,{S:20}),
      LOT('PO-304',1,{S:10}),LOT('PO-304',2,{S:10},{status:'void',poId:'304'}),
      LOT('PO-305',1,{S:10},{src:'legacy'}),LOT('PO-308',1,{'2XL':7})
    ];
    const MQ=(over)=>JSON.parse(J(R0('phhBuildModel('+J(Object.assign({pos:posQ,passes:[],jobs:[],picks:{},recon:recQ,lots:lotsQ},over||{}))+')')));
    const ids=(m,c)=>m.byId[c].items.map(i=>i.id).sort().join(',');
    const m=MQ();
    set('qc closed short (wave 2): PO-206 (118 of 120, −2, cause lost_line) = 1; PO-207 (closed exact) and PO-403 (closed, no verdict) are not',ids(m,'qc_closed_short')==='PO-206'&&m.byId.qc_closed_short.count===1&&/closed with a shortfall: 118 of 120 received \(-2\), cause: lost_line/.test(m.byId.qc_closed_short.items[0].text));
    set('qc closed short: po_qc_recon not read -> unavailable naming po_qc_recon, never 0',(()=>{const x=MQ({recon:null});return x.byId.qc_closed_short.state==='unavailable'&&x.byId.qc_closed_short.count===null&&x.byId.qc_closed_short.unavailable.join()==='po_qc_recon';})());
    set('qc drift: PO-202 (S 20->22, M 40->38; totals EQUAL), PO-203 (M 10->15) and PO-204 (unreadable lock) = 3; PO-201 (same), cancelled PO-205 and the orphan recon PO-299 are not',ids(m,'qc_cut_drift')==='PO-202,PO-203,PO-204'&&m.byId.qc_cut_drift.count===3);
    set('qc drift: the line says what moved, size by size',/locked cut 120, the PO now says 120 \(S 20→22, M 40→38\)/.test(m.byId.qc_cut_drift.items.filter(i=>i.id==='PO-202')[0].text)&&/locked cut 20, the PO now says 25 \(M 10→15\)/.test(m.byId.qc_cut_drift.items.filter(i=>i.id==='PO-203')[0].text)&&/locked cut could not be read/.test(m.byId.qc_cut_drift.items.filter(i=>i.id==='PO-204')[0].text));
    set('qc ledgers: PO-301 (10 old units not adopted + a lot), PO-303 (counter 15 vs lot 20), PO-307 (counter 5, no lot rows) = 3',ids(m,'qc_two_ledgers')==='PO-301,PO-303,PO-307'&&m.byId.qc_two_ledgers.count===3);
    const tx=id=>m.byId.qc_two_ledgers.items.filter(i=>i.id===id)[0].text;
    set('qc ledgers: the reasons are named (not adopted / counter vs lots)',/10 units from the old Packing page are not adopted/.test(tx('PO-301'))&&/packing counter \(S 15\) does not equal the live QC lots \(S 20\)/.test(tx('PO-303'))&&/packing counter \(S 5\) does not equal the live QC lots \(nothing\)/.test(tx('PO-307')));
    set('qc ledgers: NOT flagged - counter == lots (302), a void lot netted out incl. a bare-digit lot poId (304), an adopted legacy entry (305), old Packing only with no lots (306), XXL vs 2XL (308)',['PO-302','PO-304','PO-305','PO-306','PO-308'].every(x=>ids(m,'qc_two_ledgers').indexOf(x)<0));
    set('qc completed: after go-live with no reconciliation = PO-401 (QC done 17 Oct), PO-405 (no doneAt, cut 18 Oct), PO-407 (13 Oct 00:30 PKT, the go-live day itself); PO-404 (reconciliation reopened) = 4',ids(m,'qc_completed_unreconciled')==='PO-401,PO-404,PO-405,PO-407'&&m.byId.qc_completed_unreconciled.count===4);
    set('qc completed: PO-403 (reconciliation closed), PO-409 (cancelled) and every non-completed PO are not listed',['PO-403','PO-409','PO-201','PO-301'].every(x=>ids(m,'qc_completed_unreconciled').indexOf(x)<0));
    set('qc completed: PO-402 (10 Oct) and PO-408 (12 Oct 23:59 PKT) are BEFORE QC Ops - counted apart, 2; PO-406 has no date at all - counted apart, 1',m.qc.beforeQcOps===2&&m.qc.undated===1&&/2 POs finished before QC Ops \(first reconciliation 2026-10-13\) not counted; 1 completed PO with no completion or cut date not counted/.test(m.byId.qc_completed_unreconciled.note));
    set('qc go-live: derived from the OLDEST reconciliation (13 Oct 10:00 PKT) -> 2026-10-13, source recon',m.qc.liveDay==='2026-10-13'&&m.qc.liveSource==='recon');
    set('qc go-live: a later reconciliation cannot move it, an earlier one does (createdAt as a Firestore-style {seconds}); junk createdAt is ignored',(()=>{
      const early=recQ.concat([RC('PO-210','locked',LK({S:5}),{seconds:Math.floor(T_(2026,9,11,5,0)/1000),nanoseconds:0})]);
      const junk=recQ.map(r=>Object.assign({},r,{createdAt:'soon'}));
      return MQ({recon:early}).qc.liveDay==='2026-10-11'&&MQ({recon:junk}).qc.liveSource==='fallback';})());
    const mnone=MQ({recon:[],pos:[posQ.find(p=>p.id==='PO-401'),posQ.find(p=>p.id==='PO-402'),posQ.find(p=>p.id==='PO-407'),mkQ('PO-411',{currentStage:'completed',stages:{qc:{doneAt:'2026-10-15T19:30:00.000Z'}}}),mkQ('PO-412',{currentStage:'completed',stages:{qc:{doneAt:'2026-10-15T18:59:00.000Z'}}})]});
    set('qc go-live: with NO reconciliation the named fallback 2026-10-16 is used and labelled assumed',mnone.qc.liveDay==='2026-10-16'&&mnone.qc.liveSource==='fallback'&&R0('PHH_QC_LIVE_DAY_FALLBACK')==='2026-10-16'&&/assumed go-live 2026-10-16/.test(mnone.byId.qc_completed_unreconciled.note));
    set('qc go-live: ...so PO-401 (17 Oct) and PO-411 (16 Oct 00:30 PKT) count, PO-402, PO-407 (13 Oct) and PO-412 (15 Oct 23:59 PKT) are before QC Ops',ids(mnone,'qc_completed_unreconciled')==='PO-401,PO-411'&&mnone.qc.beforeQcOps===3);
    set('qc unavailable: recon not read -> drift and completed say "unavailable - po_qc_recon" with a null count; the ledger check too (adoption is recorded on the reconciliation, so without it PO-305 would be wrongly flagged)',(()=>{
      const x=MQ({recon:null});
      return x.byId.qc_cut_drift.state==='unavailable'&&x.byId.qc_cut_drift.count===null&&x.byId.qc_cut_drift.unavailable.join()==='po_qc_recon'&&x.byId.qc_completed_unreconciled.unavailable.join()==='po_qc_recon'&&x.byId.qc_two_ledgers.state==='unavailable'&&x.byId.qc_two_ledgers.unavailable.join()==='po_qc_recon';})());
    set('qc unavailable: lots not read -> only the ledger check is unavailable, naming po_qc_lots',(()=>{
      const x=MQ({lots:null});
      return x.byId.qc_two_ledgers.unavailable.join()==='po_qc_lots'&&x.byId.qc_two_ledgers.count===null&&x.byId.qc_cut_drift.state==='ok'&&x.byId.qc_completed_unreconciled.state==='ok';})());
    set('qc unavailable: a list cut at its limit is NOT complete -> unavailable (a missing reconciliation would read "never reconciled"; a missing lot "counter disagrees"), named',(()=>{
      const x=MQ({reconTruncated:true,lotsTruncated:true});
      return x.byId.qc_completed_unreconciled.state==='unavailable'&&/po_qc_recon \(list cut at its limit/.test(x.byId.qc_completed_unreconciled.unavailable.join())&&/po_qc_lots \(list cut at its limit/.test(x.byId.qc_two_ledgers.unavailable.join())&&x.byId.qc_completed_unreconciled.count===null;})());
    set('qc unavailable: POs not read -> all three unavailable naming pos',(()=>{const x=MQ({pos:null});return['qc_cut_drift','qc_two_ledgers','qc_completed_unreconciled'].every(c=>x.byId[c].state==='unavailable'&&x.byId[c].unavailable.indexOf('pos')>-1);})());
    set('qc model: qc:false (a non-manager) leaves the four QC checks out altogether - 7 checks, no qc block',(()=>{const x=MQ({qc:false});return x.checks.length===7&&x.qc===null&&!x.byId.qc_cut_drift&&!x.byId.qc_closed_short;})()&&m.checks.length===11);
    set('qc model: the total adds the QC counts (3 + 3 + 4 + 1) to the others that ran; an unavailable QC check adds nothing',m.total===11&&MQ({recon:null}).total===0&&MQ({lots:null}).total===8);
    set('qc model: junk recon / lot rows never throw',(()=>{try{R0('phhBuildModel('+J({pos:posQ,passes:[],jobs:[],recon:[null,3,'x',{}],lots:[null,{poId:'PO-1'},{poId:'PO-301',status:'live',sizes:'bad'}]})+')');return true;}catch(e){return false;}})());
    set('qc source: the file writes nothing and has no i18n call (English-only like the other seven)',!/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\b/.test(src.health.replace(/\/\*[\s\S]*?\*\//g,''))&&!/phI18n/.test(src.health));
  }
  if(want('qcui')){
    const rcDoc=(id,status,created)=>({id:id,poId:id,status:status,rev:1,cutLock:{sizes:{S:10},total:10},lotCount:1,createdAt:created,legacyIds:[]});
    const completed=(id,doneAt)=>({id:id,code:'GST073',name:'Tee '+id,qty:10,sizes:{S:10},poStatus:'in_production',currentStage:'completed',ts:1784891095206,cutAt:'2026-10-14T08:00:00Z',cutQty:{S:10},stages:{cutting:{done:true},qc:{done:true,doneAt:doneAt}}});
    const dataQ=()=>{
      const d=baseData();
      d.pos=d.pos.concat([completed('PO-901','2026-10-17T10:00:00.000Z'),completed('PO-902','2026-10-14T10:00:00.000Z')]);
      d.po_qc_recon=[rcDoc('PO-902','closed',Date.UTC(2026,9,13,5,0))];
      d.po_qc_lots=[];
      return d;
    };
    const rowOf=(T,sec,n)=>T.dom.all(sec,x=>x.getAttribute('data-check')===n)[0];
    const secOf=T=>T.dom.all(T.dom.body,n=>n.getAttribute('data-health')==='1')[0];
    const T=load(src,{session:USERS.afnan,data:dataQ()});
    await T.open('monitor');await settle();
    const sec=secOf(T);
    const cnt=n=>T.byClass(rowOf(T,sec,n),'phh-count')[0].textContent;
    set('qc ui: a manager\'s Monitor reads the two QC stages (one read each) and shows the three QC rows with real counts',T.fk.reads.filter(r=>r.path==='po_qc_recon').length===1&&T.fk.reads.filter(r=>r.path==='po_qc_lots').length===1&&cnt('qc_cut_drift')==='0'&&cnt('qc_two_ledgers')==='0'&&cnt('qc_completed_unreconciled')==='1');
    T.click(T.dom.all(rowOf(T,sec,'qc_completed_unreconciled'),n=>n.tagName==='BUTTON'&&n.classList.contains('phh-head'))[0]);await settle();
    const lst=T.dom.all(T.dom.body,n=>n.getAttribute('data-check')==='qc_completed_unreconciled')[0];
    set('qc ui: the drill list names PO-901 (17 Oct, never reconciled); PO-902 has a closed reconciliation and is not listed',/PO-901/.test(T.text(lst))&&!/PO-902/.test(T.text(lst)));
    set('qc ui: the Overview card for the manager counts the QC finding (+1 over the same data with po_qc_recon refused)',await (async()=>{
      const big=async(opts)=>{const T2=load(src,Object.assign({session:USERS.afnan,data:dataQ()},opts));await T2.open('overview');await settle();const tile=T2.dom.all(T2.dom.body,n=>n.getAttribute('data-tile')==='health')[0];return tile?Number(T2.byClass(tile,'phh-big')[0].textContent):NaN;};
      const a=await big(),b=await big({fail:{po_qc_recon:PERM}});
      return a===b+1;})());
    const F=load(src,{session:USERS.afnan,data:dataQ(),fail:{po_qc_recon:PERM}});
    await F.open('monitor');await settle();
    const secF=secOf(F);
    set('qc ui: po_qc_recon REFUSED -> an alert naming it, "unavailable - po_qc_recon" and a dash (never 0) on all three QC checks (the ledger check needs it for the adopted receipts)',/po_qc_recon: could not be read/.test(F.text(secF))&&/unavailable - po_qc_recon/.test(F.text(rowOf(F,secF,'qc_cut_drift')))&&F.byClass(rowOf(F,secF,'qc_cut_drift'),'phh-count')[0].textContent==='—'&&F.byClass(rowOf(F,secF,'qc_completed_unreconciled'),'phh-count')[0].textContent==='—'&&F.byClass(rowOf(F,secF,'qc_two_ledgers'),'phh-count')[0].textContent==='—');
    const C=load(src,{session:USERS.afnan,data:dataQ(),fromCache:{po_qc_lots:true}});
    await C.open('monitor');await settle();
    const secC=secOf(C);
    set('qc ui: po_qc_lots answered from the OFFLINE COPY is a failed read, not an empty list: "unavailable - po_qc_lots", dash, and the alert names it',/unavailable - po_qc_lots/.test(C.text(rowOf(C,secC,'qc_two_ledgers')))&&C.byClass(rowOf(C,secC,'qc_two_ledgers'),'phh-count')[0].textContent==='—'&&/po_qc_lots: only this device/.test(C.text(secC)));
    const K=load(src,{session:USERS.uzaib,data:dataQ()});
    await K.open('overview');await settle();
    set('qc ui: Kashif\'s Overview never reads the QC collections (the stages are lazy and manager-only)',K.fk.reads.filter(r=>/^po_qc_/.test(r.path)).length===0);
  }

  /* ── 2. candidates ── */
  if(want('cand')){
    const C=(po,pos,passes)=>JSON.parse(J(R0('phhCandidates('+J(po)+','+J(pos)+','+J(passes)+')')));
    const c=C(POS['PO-048'],fx.pos,fx.passes);
    set('find: candidates are the passes that point at no real PO (GP-108, GP-109, GP-172); GP-343/345/220/264 belong to real POs and never appear',c.map(r=>r.id).sort().join()==='GP-108,GP-109,GP-172');
    set('find: the Terry Fresh passes rank above the Jersey Heavy "Sample" one for PO-048 (Terry Fresh, military green); the reason says why',c[2].id==='GP-172'&&c[0].score>c[2].score&&/fabric matches: terry, fresh/.test(c[0].why.join(';')));
    const c2=C(POS['PO-088'],fx.pos,[PASS['GP-108'],Object.assign(clone(PASS['GP-108']),{id:'GP-X',date:'2026-08-19',fabricType:'Poly Sublimation Jersey',fabricColor:'Black',article:'100% Poly Sublimation Jersey 260gsm Black'})]);
    set('find: a pass issued within 3 days of the PO release AND named like its fabric ranks first',c2[0].id==='GP-X'&&c2[0].score>c2[1].score&&c2[0].why.some(w=>/within 3 days/.test(w)));
    set('find: not fabric (garments) passes and junk are ignored; lists not given -> nothing',C(POS['PO-048'],fx.pos,[{id:'GP-G',gpType:'garments',poId:'Sample'},null,3]).length===0&&R0('phhCandidates(null,[],[]).length')===0);
  }

  /* ── 5. the stuck basis (Monitor) ── */
  if(want('stuck')){
    const NOW=Date.UTC(2026,9,12,7,0,0);                       // 12 Oct 2026 12:00 PKT
    const mkPo=(id,rel)=>({id:id,currentStage:'cutting',poStatus:'in_production',code:'GST073',name:'Tee '+id,qty:100,sizes:{S:100},releasedAt:rel,ts:Date.UTC(2026,8,1)});
    const pos=[mkPo('PO-701','2026-10-01T09:00:00.000Z'),mkPo('PO-702','2026-10-01T09:00:00.000Z'),mkPo('PO-703','2026-10-01T09:00:00.000Z')];
    const run=(extra)=>JSON.parse(J(R0('(function(){const M=phmBuildModel('+J(Object.assign({now:NOW,range:{},pos:pos,jobs:[],settingsRaw:null},extra||{}))+');return {stuck:M.attention.counts.stuck,basis:M.stuckBasis,cap:M.tiles.stuck.cap,ids:M.attention.rows.filter(r=>r.kind==="stuck").map(r=>r.id).sort().join(),texts:M.attention.rows.map(r=>r.detail).join("|")};})()')));
    const a=run({});
    set('stuck: with no gate-pass dates every PO at cutting is counted from its RELEASE (11 days): 3 stuck, basis 0 issue / 3 release',a.stuck===3&&a.basis.issue===0&&a.basis.release===3);
    const b=run({firstIssueById:{'PO-701':Date.UTC(2026,9,9,0,0,0)},passesOk:true});
    set('stuck: PO-701 first fabric issue was 9 Oct (3 days ago): not stuck; the other two (release 11 days) are',b.stuck===2&&b.ids==='PO-702,PO-703'&&b.basis.issue===1&&b.basis.release===2);
    set('stuck: the caption says which start was used and how many POs used each',/Start used at cutting: 1 PO from the first fabric issue, 2 POs from the release date/.test(b.cap));
    set('stuck: with the passes unread the caption says every PO was counted from release',/could not be read, so every PO at cutting was counted from its release date/.test(a.cap));
    const c=run({firstIssueById:{'PO-701':Date.UTC(2026,8,20,0,0,0)},passesOk:true});
    set('stuck: an OLDER first issue (22 days) is stuck and its reason names the first fabric issue',c.stuck===3&&/at Cutting \(since 20 Sep, first fabric issue\)/.test(c.texts));
    const tq=fi=>JSON.parse(J(R0('(function(){const t=phqTileOf('+J(pos[0])+',null,{today:"2026-10-12",now:'+NOW+',S:phSettings({}),alloc:null,jobsLoaded:false,firstIssue:'+J(fi||null)+'});return {age:t.age,delay:t.delay};})()')));
    const q1=tq(null),q2=tq({'PO-701':Date.UTC(2026,9,9,0,0,0)});
    set('stuck (PO Queue): with no issue date the tile age is from the release (11 d, "released") and the tile says Stuck 11d',q1.age.days===11&&q1.age.basis==='released'&&/Stuck 11d/.test(q1.delay.text));
    set('stuck (PO Queue): with the first fabric issue 3 days ago the age is 3 d from "issued" and nothing is stuck',q2.age.days===3&&q2.age.basis==='issued'&&q2.delay.delayed===false);
    set('stuck: the default limit is still 7 days (ph-core)',R0('PH_DEFAULT_SETTINGS.stuckDays')===7);
    const key=R0('phhFirstIssueMap('+J([PASS['GP-343'],PASS['GP-345'],PASS['GP-220'],Object.assign(clone(PASS['GP-220']),{id:'GP-221',date:'2026-07-01'}),PASS['GP-108']])+')');
    set('stuck: the first-issue map uses phPoKey (090 -> PO-090, 125 -> PO-125) and keeps the OLDEST pass of a PO',J(Object.keys(key).sort())===J(['PO-017','PO-090','PO-125','PO-538'])&&key['PO-017']===R0('phMs("2026-07-01")'));
  }

  /* ── the screens (one app, as the page loads them) ── */
  if(want('cutting')){
    const T=load(src,{session:USERS.uzaib});
    await T.open('cutting');
    const pass090=T.card('PO-090');
    const reads=T.fk.reads.filter(r=>r.path==='gatepasses'&&r.w&&r.w.length);
    set('cutting: the fabric issue is asked for with EVERY spelling of the PO (an `in` query: PO-090, 090, 90, PO-90)',reads.some(r=>r.w[0][1]==='in'&&r.w[0][2].indexOf('090')>-1&&r.w[0][2].indexOf('PO-090')>-1));
    set('cutting: PO-090, whose pass stores "090", now finds its fabric issue and its roll (1 roll in all)',!!pass090&&!/No fabric issue was found/.test(T.text(pass090))&&/1 roll/.test(T.text(pass090)));
    const t090=T.text(pass090);
    set('cutting: before anything is scanned there is NO red MISMATCH - it says "Not checked yet"',!/MISMATCH/.test(t090)&&/Not checked yet/.test(t090));
    const inp=T.dom.find('phk-scan-PO-090');
    inp.value='ZZ-NOT-ON-ISSUE';T.dom.dispatch(inp,'keydown',{key:'Enter'});
    set('cutting: after a scan the mismatch IS shown (the unknown roll and the roll still missing)',/MISMATCH/.test(T.text(T.card('PO-090'))));
    set('cutting: the reference table (the issue groups) sits in a collapsed <details>, not open on the card',T.dom.all(pass090,n=>n.tagName==='DETAILS'&&n.classList.contains('phk-ref')).length===1);
  }
  if(want('find')){
    const T=load(src,{session:USERS.uzaib});
    await T.open('cutting');
    const card=T.card('PO-048');
    const txt=T.text(card);
    set('find: a job with no fabric issue shows "Find the fabric issue" and the three candidate passes, not a dead end',/Find the fabric issue/.test(txt)&&T.byClass(card,'phk-cand').length===3);
    const b=T.byClass(card,'phk-cand-b').filter(n=>/GP-108/.test(n.textContent))[0];
    set('find: a candidate line carries the pass number, date, fabric, weight, rolls and the PO field it was written with',!!b&&/2026-07-03/.test(b.textContent)&&/Terry Fresh/.test(b.textContent)&&/30\.3 kg/.test(b.textContent)&&/1 roll/.test(b.textContent)&&/PO field: 538/.test(b.textContent));
    set('find: nothing is written before the tap',T.fk.txs.length===0&&T.fk.plain.length===0);
    T.click(b);await settle();await settle();
    const after=T.text(T.card('PO-048'));
    set('find: tapping GP-108 keeps the pick IN MEMORY for PO-048 only',J(T.R('phhPicked("PO-048")'))===J(['GP-108'])&&T.R('phhPicked("PO-030").length')===0);
    set('find: ...and the checklist now has the pass\'s roll (1 roll) and says the pick is for this visit only',/1 roll/.test(after)&&/you picked/.test(after)&&/this visit only/.test(after)&&!!T.dom.find('phk-scan-PO-048'));
    set('find: the pick writes NOTHING - not to po_cut_jobs (the rules allow no fabricPassIds), not to gatepasses, no transaction, no setDoc',T.fk.txs.length===0&&T.fk.plain.length===0);
    set('find: the source never names a fabricPassIds write field',!/fabricPassIds/.test(src.cutting.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,''))&&!/fabricPassIds/.test(src.health.replace(/\/\*[\s\S]*?\*\//g,'')));
    const T2=load(src,{session:USERS.uzaib,failUnfiltered:{gatepasses:PERM}});
    await T2.open('cutting');
    const t2=T2.text(T2.card('PO-048'));
    set('find: gate passes unreadable -> the card says so by name (no empty list, no "nothing to pick")',/gatepasses/.test(t2)&&!/nothing to pick/.test(t2));
  }
  if(want('health')){
    const T=load(src,{session:USERS.afnan,data:baseData()});
    await T.open('monitor');await settle();
    const sec=T.dom.all(T.dom.body,n=>n.getAttribute('data-health')==='1')[0];
    set('health ui: the Monitor tab has a Data health section with the eleven checks (seven + the four QC checks, for a manager)',!!sec&&T.dom.all(sec,n=>n.getAttribute('data-check')).length===11);
    const row=n=>T.dom.all(sec,x=>x.getAttribute('data-check')===n)[0];
    set('health ui: each row shows its count (orphan passes 3, reserved with fabric 1, qty mismatch 2)',/3/.test(T.text(row('orphan_passes')))&&T.text(row('reserved_issued')).indexOf('1')>-1&&T.text(row('qty_mismatch')).indexOf('2')>-1);
    set('health ui: the cut-jobs check ran (jobs loaded): 2 open jobs with no fabric link (PO-048 and PO-030; PO-090 and PO-125 have digit passes)',T.text(row('jobs_no_fabric')).indexOf('2')>-1);
    const head=T.dom.all(row('qty_mismatch'),n=>n.tagName==='BUTTON'&&n.classList.contains('phh-head'))[0];
    T.click(head);await settle();
    const list=T.dom.all(T.dom.body,n=>n.getAttribute('data-check')==='qty_mismatch')[0];
    set('health ui: pressing a count opens the drill list with the PO ids and an Open PO action (when the PO page exists)',T.dom.all(list,n=>n.classList.contains('phh-item')).length===2&&/PO-048/.test(T.text(list)));
    const T2=load(src,{session:USERS.afnan,fail:{gatepasses:PERM}});
    await T2.open('monitor');await settle();
    const sec2=T2.dom.all(T2.dom.body,n=>n.getAttribute('data-health')==='1')[0];
    const r2=n=>T2.dom.all(sec2,x=>x.getAttribute('data-check')===n)[0];
    set('health ui: gate passes refused -> an alert naming gatepasses; every check that needs them reads "unavailable - gatepasses" with a dash, never a 0',!!sec2&&/gatepasses: could not be read/.test(T2.text(sec2))&&/unavailable - gatepasses/.test(T2.text(r2('orphan_passes')))&&T2.byClass(r2('orphan_passes'),'phh-count')[0].textContent==='—'&&T2.byClass(r2('pass_no_master'),'phh-count')[0].textContent==='—');
    set('health ui: ...while the check that needs no gate passes (qty != sum) still runs and shows its 2',T2.byClass(r2('qty_mismatch'),'phh-count')[0].textContent==='2');
    const T3=load(src,{session:USERS.uzaib});
    await T3.open('overview');await settle();
    const tile=T3.dom.all(T3.dom.body,n=>n.getAttribute('data-tile')==='health')[0];
    set('health ui: Overview (Uzaib) shows the Data health card with the total and no "Open the checks" button',!!tile&&T3.dom.find('ph-panel')&&/\d+/.test(T3.text(tile))&&T3.btns(tile,'Open the checks').length===0);
    const T5=load(src,{session:USERS.uzaib,fail:{gatepasses:PERM}});
    await T5.open('overview');await settle();
    const tile5=T5.dom.all(T5.dom.body,n=>n.getAttribute('data-tile')==='health')[0];
    set('health ui: Overview with the gate passes refused says "unavailable - gatepasses" and prints no total',!!tile5&&/unavailable - gatepasses/.test(T5.text(tile5))&&T5.byClass(tile5,'phh-big').length===0);
    const T4=load(src,{session:USERS.afnan});
    await T4.open('overview');await settle();
    const tile4=T4.dom.all(T4.dom.body,n=>n.getAttribute('data-tile')==='health')[0];
    set('health ui: Overview (manager) has the "Open the checks" button',!!tile4&&T4.btns(tile4,'Open the checks').length===1);
  }
  if(want('overview')){
    const T=load(src,{session:USERS.afnan});
    await T.open('overview');await settle();
    const panel=T.panel();
    const kids=T.dom.all(panel,n=>n.classList.contains('phm-grid')||n.classList.contains('phm-sources'));
    set('overview: the real tiles come first, the "Data sources" disclosure after them',kids.length>=2&&kids[0].classList.contains('phm-grid')&&kids[kids.length-1].classList.contains('phm-sources'));
    const det=T.dom.all(panel,n=>n.tagName==='DETAILS'&&n.classList.contains('phm-sources'))[0];
    set('overview: with everything read fine the sources panel is COLLAPSED (no open attribute) and says "Data sources"',!!det&&!det.hasAttribute('open')&&det.getAttribute('data-sources')==='ok'&&/Data sources/.test(T.text(det)));
    const F=load(src,{session:USERS.afnan,fail:{po_drafts:PERM}});
    await F.open('overview');await settle();
    const det2=F.dom.all(F.panel(),n=>n.tagName==='DETAILS'&&n.classList.contains('phm-sources'))[0];
    set('overview: a failed collection keeps the strip OPEN and marked failed, and names the collection',!!det2&&det2.hasAttribute('open')&&det2.getAttribute('data-sources')==='failed'&&/failed/.test(T.text(det2)+F.text(det2))&&/po_drafts/.test(F.text(det2)));
  }
  if(want('shell')){
    const T=load(src);
    const mkNode=(attrs)=>{const n=T.ctx.document.createElement('div');Object.keys(attrs||{}).forEach(k=>n.setAttribute(k,attrs[k]));return n;};
    const top=mkNode(),side=mkNode({'aria-hidden':'false'}),mob=mkNode({inert:''});
    const map={'.topbar':[top],'#sidebar':[side],'#mob-nav':[mob]};
    T.ctx.document.querySelectorAll=sel=>map[sel]||[];
    T.R('_phTkApplyClasses(true)');
    set('shell: while the takeover is up the app\'s own top bar is inert and aria-hidden (Tab and Enter cannot reach Sign out)',top.hasAttribute('inert')&&top.getAttribute('aria-hidden')==='true');
    set('shell: the sidebar and phone nav too',side.hasAttribute('inert')&&side.getAttribute('aria-hidden')==='true'&&mob.hasAttribute('inert'));
    T.R('_phTkApplyClasses(true)');
    T.R('_phTkApplyClasses(false)');
    set('shell: on leave the top bar is exactly as it was (no inert, no aria-hidden)',!top.hasAttribute('inert')&&!top.hasAttribute('aria-hidden'));
    set('shell: ...a sidebar that had aria-hidden="false" gets it back, and a node that was ALREADY inert stays inert',side.getAttribute('aria-hidden')==='false'&&!side.hasAttribute('inert')&&mob.hasAttribute('inert')&&!mob.hasAttribute('aria-hidden'));
    set('shell: _phTkApplyClasses drives it (on and off), so every route in and out is covered',/_phTkInert\(!!on\)/.test(src.ui));
    let scrolled=0;
    const rail={querySelector:s=>s==='.ph-tk-item.on'?{scrollIntoView(o){scrolled++;set.last=o;}}:null};
    T.ctx.__rail=rail;T.R('_phTkRevealActive(__rail)');
    set('shell: the active tab is scrolled into view (centred) in the phone dock',scrolled===1);
    set('shell: ...and _phTkPaintRail does it on every paint (every route into a tab)',/_phTkRevealActive\(rail\);\s*\}/.test(src.ui));
    set('shell: the report-bug button leaves room (bottom padding in the takeover canvas, sticky bars clear of it)',/#main-content\.ph-takeover \.ph-canvas\{padding-bottom:88px\}/.test(CSS)&&/\.phd-actions \.phd-btnrow\{padding-right:72px\}/.test(CSS));
  }
  if(want('admin')){
    const T=load(src,{session:USERS.afnan});
    set('admin: the master log with the gate passes NOT loaded says so (state nopasses) instead of treating every cut as unassigned',T.R('phaMasterLogModel({mode:"month",month:"2026-10"},{pos:[],passes:null,passesLoaded:false,jobRows:[],masters:[]}).state')==='nopasses');
    set('admin: loaded passes (or an env that does not say) behave as before',T.R('phaMasterLogModel({mode:"month",month:"2026-10"},{pos:[],passes:[],jobRows:[],masters:[]}).state')==='nodata');
    set('admin: a pass that stores "125" names the master of PO-125 (matched through phPoKey)',(()=>{
      const jobs=T.R('phaCutJobs('+J([Object.assign(clone(POS['PO-125']),{fbKey:'PO-125',cutAt:'2026-09-20T08:00:00Z',cutQty:{M:40}})])+','+J([PASS['GP-345']])+',[],[])');
      return jobs.length===1&&jobs[0].master==='Alam';})());
    set('admin: ... and a pass written PO-125 / po 125 does the same',(()=>{
      const g=Object.assign(clone(PASS['GP-345']),{poId:' po 125 '});
      const jobs=T.R('phaCutJobs('+J([Object.assign(clone(POS['PO-125']),{fbKey:'PO-125',cutAt:'2026-09-20T08:00:00Z',cutQty:{M:40}})])+','+J([g])+',[],[])');
      return jobs[0].master==='Alam';})());
    await T.open('settings');
    const t=T.text(T.panel());
    set('admin: the hard PC-only text says the Drafts form reads it',/The PO Drafts form \(PO Queue, Drafts\) reads this/.test(t)&&!/nothing reads it yet/.test(t));
    set('admin: no developer path "(js/pos.js)" on the settings screen',!/js\/pos\.js/.test(t));
    set('admin: nothing saved yet -> no green "Saved" pill beside an untouched field (defaults still say so)',T.byClass(T.panel(),'ph-chip-ok').filter(n=>n.textContent==='Saved').length===0&&/Default/.test(t));
    const S=load(src,{session:USERS.afnan,data:baseData({'ph_settings/main':{rev:3,dailyCapacity:500,updatedBy:'afnan',updatedAt:1}})});
    await S.open('settings');
    set('admin: with one saved setting, exactly that field carries a "Saved" pill (it has the Back to default button); untouched fields carry none',S.byClass(S.panel(),'ph-chip-ok').filter(n=>n.textContent==='Saved').length===1);
    const M=load(src,{session:USERS.afnan});
    let focused='';
    M.ctx.document.querySelector=sel=>({focus(){focused=sel;}});
    await M.open('masters');
    const ren=M.btns(M.panel(),'Rename')[0];
    M.click(ren);await settle();
    set('admin: opening Rename moves focus into the editor\'s input',focused==='.pha-edit input');
    // a refused add: the duplicate "Hassan"
    const nameIn=M.dom.all(M.panel(),n=>n.getAttribute&&n.getAttribute('data-f')==='newname')[0];
    nameIn.value='Hassan';M.dom.dispatch(nameIn,'input');
    M.click(M.btns(M.panel(),'Add master')[0]);await settle();await settle();
    set('admin: a REFUSED add shows the refusal (no old success banner) and does not keep the rejected name in the box',M.R('_phaM.newName')===''&&M.R('_phaFlash&&_phaFlash.kind')==='bad');
  }
  if(want('calendar')){
    const T=load(src);
    const model=(jobs,pos)=>JSON.parse(J(T.R('(function(){const m=phcBuildModel({jobs:'+J(jobs)+',pos:'+J(pos)+',S:phSettings({dailyCapacity:100}),capKnown:true,today:"2026-10-13"});return {spills:m.chips.filter(c=>c.spill).map(c=>c.poId),fin:m.chips.filter(c=>c.finished).map(c=>c.poId),planned:phcDayInfo(m,phSettings({dailyCapacity:100}),"2026-10-14").planned,over:phcDayInfo(m,phSettings({dailyCapacity:100}),"2026-10-14").over};})()')));
    const P=(id,qty,st)=>({fbKey:id,id:id,currentStage:st||'cutting',poStatus:'in_production',qty:qty,sizes:{S:qty},code:'GST073',name:id});
    const J1=(id,st)=>({fbKey:id,id:id,status:st||'open',plannedCutDate:'2026-10-14'});
    const base=model([J1('PO-801'),J1('PO-802')],[P('PO-801',80),P('PO-802',80)]);
    set('calendar: two open jobs of 80 on one day with capacity 100 -> over capacity, one spills',base.over===true&&base.planned===160&&base.spills.length===1);
    const fin=model([J1('PO-801','complete'),J1('PO-802')],[P('PO-801',80),P('PO-802',80)]);
    set('calendar: a COMPLETE job takes no capacity and nothing spills (planned 80, not over)',fin.fin.join()==='PO-801'&&fin.planned===80&&fin.over===false&&fin.spills.length===0);
    const done=model([J1('PO-801','done'),J1('PO-802')],[P('PO-801',80),P('PO-802',80)]);
    set('calendar: a DONE job is ignored the same way',done.over===false&&done.spills.length===0);
    const past=model([J1('PO-801'),J1('PO-802')],[P('PO-801',80,'bundling'),P('PO-802',80)]);
    set('calendar: a job whose PO is already past cutting is finished work too',past.fin.join()==='PO-801'&&past.over===false);
    const touch=load(src,{globals:{matchMedia:()=>({matches:true})}});
    set('calendar: on a touch screen the copy never says "Drag" (it says Move to...)',!/Drag/.test(touch.R('_phcMoveHow(true)')+touch.R('_phcMoveHow(false)'))&&/Move to/.test(touch.R('_phcMoveHow(false)')));
    const mouse=load(src,{globals:{matchMedia:()=>({matches:false})}});
    set('calendar: with a mouse it still says Drag',/Drag/.test(mouse.R('_phcMoveHow(false)')));
  }
  if(want('drafts')){
    const T=load(src);
    const txt=st=>T.R('(function(){_phdForm={status:"'+st+'"};return _phdCompleteness({problems:[]},{ok:true,missing:[],warnings:[]}).textContent;})()');
    set('drafts: a READY draft never says it "can be marked ready"; a draft still does',!/can be marked ready/.test(txt('ready'))&&/already marked ready/.test(txt('ready'))&&/can be marked ready/.test(txt('draft')));
    const q=[];
    T.ctx.setTimeout=function(fn){q.push(fn);return 0;};
    let focusOn=0;
    T.R('(function(){_phdForm={status:"ready",f:{}};_phdAsk={kind:"sendback"};})()');
    const node=T.R('_phdAskNode()');
    const ta=T.dom.all(node,n=>n.tagName==='TEXTAREA')[0];
    ta.focus=function(){focusOn++;};
    q.splice(0).forEach(f=>f());
    set('drafts: opening the Send-back reason box puts the caret in it (once)',focusOn===1);
    const node2=T.R('_phdAskNode()');q.splice(0).forEach(f=>f());
    const ta2=T.dom.all(node2,n=>n.tagName==='TEXTAREA')[0];
    set('drafts: ... and a repaint of the same ask does not steal focus again',!!ta2&&T.ctx.document.activeElement!==ta2);
    set('drafts: the action bar is sticky (bottom of the screen when stacked, top of the column beside the form) and clear of the bug button',/\.phd-actions\{position:sticky;bottom:0;/.test(CSS)&&/\.phd-aside\{display:contents\}/.test(CSS)&&/\.phd-actions\{bottom:auto;top:12px\}/.test(CSS));
  }
  if(want('css')){
    set('phone: the roll check comes ABOVE the reference facts on a phone',/@media \(max-width:899px\)\{\s*\/\*[^*]*\*\/\s*\.phk-card-body>\.phk-check\{order:-1\}/.test(CSS));
    set('phone: the Remove button is 48px',/\.phk-x\{min-height:48px\}/.test(CSS));
    set('health css: a block ph-mod-health START/END with only .phh- selectors',(()=>{const m=/\/\* ph-mod-health START \*\/([\s\S]*?)\/\* ph-mod-health END \*\//.exec(CSS);if(!m)return false;const sels=m[1].replace(/\/\*[\s\S]*?\*\//g,'').split('}').map(x=>x.split('{')[0].trim()).filter(Boolean);return sels.length>10&&sels.every(s=>s.split(',').every(p=>/\.phh-/.test(p)));})());
  }
  return o;
}

module.exports=async function(){
  const s=suite('ph-health');
  const base=await checks(SRC);
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.ok('checks ran: '+Object.keys(base).length,Object.keys(base).length>=80,String(Object.keys(base).length));
  /* ── deliberate breaks: each guard reverted once; a named check must FAIL ── */
  const GROUP={};
  const names=g=>Object.keys(base).filter(k=>true);
  let broken=0;
  const brk=async(label,file,from,to,failing,group)=>{
    const mut=Object.assign({},SRC);
    if(mut[file].split(from).length-1<1){s.ok('break target exists: '+label,false);return;}
    mut[file]=mut[file].split(from).join(to);
    let r;try{r=await checks(mut,group);}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{
      if(!(f in base)){s.ok('break "'+label+'": the named check exists ('+f.slice(0,50)+')',false);return;}
      broken++;s.ok('break "'+label+'" fails "'+f.slice(0,70)+'"',r[f]!==true);
    });
  };
  await brk('the PO key forgets bare digits','core',"const m=/^(?:PO[-_]?)?0*([0-9]{1,9})$/.exec(s);","const m=/^PO[-_]?0*([0-9]{1,9})$/.exec(s);",['key: PO-125 / 125 / 090 / po-0125 / " PO 125 " / PO_125 / the number 125 are ONE key'],['key']);
  await brk('the PO key invents a number for free text','core',"if(!m)return null;\n  const n=parseInt(m[1],10);","if(!m)return'PO-000';\n  const n=parseInt(m[1],10);",['key: free text, blank, zero and a missing value are NOT a PO key (null)'],['key']);
  await brk('spellings drop the digits','core',"const out=[k,n,bare,'PO-'+bare];","const out=[k];",['key: the Firestore spellings of PO-017 are PO-017, 017, 17 (an `in` query takes at most 10)'],['key']);
  await brk('cutting asks for one spelling only','cutting',"const q=spell.length>1?where('poId','in',spell):where('poId','==',poId);","const q=where('poId','==',poId);",['cutting: the fabric issue is asked for with EVERY spelling of the PO (an `in` query: PO-090, 090, 90, PO-90)','cutting: PO-090, whose pass stores "090", now finds its fabric issue and its roll (1 roll in all)'],['cutting']);
  await brk('a red MISMATCH before any scan','cutting',"if(!res.active){","if(false){",['cutting: before anything is scanned there is NO red MISMATCH - it says "Not checked yet"'],['cutting']);
  await brk('the reference table always open','cutting',"const det=_phkE('details','phk-ref');","const det=_phkE('div','phk-ref');",['cutting: the reference table (the issue groups) sits in a collapsed <details>, not open on the card'],['cutting']);
  await brk('no candidates on a dead end','cutting',"if(!is.groups.length)kids.push(_phkFindBlock(job,entry));","if(!is.groups.length)kids.push(_phkE('p','phk-muted','No fabric issue was found for this PO yet.'));",['find: a job with no fabric issue shows "Find the fabric issue" and the three candidate passes, not a dead end'],['find']);
  await brk('a pick that is not applied','cutting',"if(hit){passes.push(","if(false){passes.push(",['find: ...and the checklist now has the pass\'s roll (1 roll) and says the pick is for this visit only'],['find']);
  await brk('a pick that writes the job','cutting',"if(typeof phhPick==='function'){phhPick(poId,r.id);phkLoadPO(poId,true);}","if(typeof phhPick==='function'){phhPick(poId,r.id);phSaveCutJob(poId,{note:'picked '+r.id});phkLoadPO(poId,true);}",['find: the pick writes NOTHING - not to po_cut_jobs (the rules allow no fabricPassIds), not to gatepasses, no transaction, no setDoc'],['find']);
  await brk('a closed-exact reconciliation counted as a shortfall','health',"if(!v||(phStr(v.phase)!=='short'&&phStr(v.phase)!=='receiving'))return;","if(!v)return;",['qc closed short (wave 2): PO-206 (118 of 120, −2, cause lost_line) = 1; PO-207 (closed exact) and PO-403 (closed, no verdict) are not'],['qc']);
  await brk('candidates include passes of real POs','health',"if(k!==null&&keys.has(k))return;                       // it belongs to a real PO","",['find: candidates are the passes that point at no real PO (GP-108, GP-109, GP-172); GP-343/345/220/264 belong to real POs and never appear'],['cand']);
  await brk('candidates ranked by date only','health',"if(hit.length){score+=Math.min(3,hit.length);why.push('fabric matches: '+hit.slice(0,3).join(', '));}","",['find: the Terry Fresh passes rank above the Jersey Heavy "Sample" one for PO-048 (Terry Fresh, military green); the reason says why'],['cand']);
  await brk('a failed gate-pass read drawn as an empty list','health',"if(bad.length)return{state:'error',rows:null,text:bad.map(function(n){return S[n].text||(n+': not loaded');}).join(' ')};","if(bad.length)return{state:'ok',rows:[],text:''};",['find: gate passes unreadable -> the card says so by name (no empty list, no "nothing to pick")'],['find']);
  await brk('digit-only POs not told apart','health',"x.spelling==='digits'","true",['health: POs matched ONLY by the digit spelling = PO-090 ("090") and PO-125 ("125") (2); PO-017 ("PO-017") is not'],['model']);
  await brk('orphan test by exact id text','health',"else if(!allKeys.has(k))r.items.push(passRow(g,k+' does not exist'));","else if(!allKeys.has(k)||false)r.items.push(passRow(g,k+' does not exist'));\n        if(k!==null&&allKeys.has(k)&&phStr(_phhPassPoRaw(g))!==k)r.items.push(passRow(g,'spelt differently'));",['health: fabric passes pointing at no real PO = GP-108 ("538"), GP-109 ("533"), GP-172 ("Sample") (3); a digit pass for a real PO is not'],['model']);
  await brk('a cancelled PO is not a real PO','health',"if(k!==null)allKeys.add(k);\n    const st=phStageOf(po);","const st=phStageOf(po);if(k!==null&&st!=='cancelled')allKeys.add(k);",['health: a cancelled PO is out of the PO lists but is a REAL PO for the orphan test (its passes are not orphans)'],['model']);
  await brk('an unloaded list counted as zero','health',"const miss=c.need.filter(function(n){return!avail[n];});","const miss=[];",['health: POs not loaded -> every PO check is UNAVAILABLE naming pos, count null (never 0)'],['model']);
  await brk('picks ignored by the job check','health',"if(Array.isArray(picks[k])&&picks[k].length)return;","",['health: a pass picked in Find-the-issue links its job (PO-048 drops out)'],['model']);
  await brk('a complete job counted as open','health',"if(!_phhObj(j)||phStr(j.status)!=='open')return;","if(!_phhObj(j))return;",['health: open cut jobs with no fabric link = PO-030 and PO-048 (PO-090/PO-017 have passes, PO-088 is complete)'],['model']);
  await brk('reserved POs not checked','health',"if(e.stage==='reserved'&&e.key&&pidx.byPo.has(e.key))","if(e.stage==='cutting'&&e.key&&pidx.byPo.has(e.key))",['health: reserved POs that already have fabric issued = PO-061 (1)'],['model']);
  await brk('an unavailable check printed as a number','health',"head.appendChild(phEl('span','phh-count',c.state==='ok'?String(c.count):'—'));","head.appendChild(phEl('span','phh-count',String(c.count||0)));",['health ui: gate passes refused -> an alert naming gatepasses; every check that needs them reads "unavailable - gatepasses" with a dash, never a 0'],['health']);
  await brk('the Overview card shows a total over a failed read','health',"if(bad.length){\n    const p=E('p','phh-err','unavailable - '+bad.join(', '));p.setAttribute('role','alert');card.appendChild(p);\n    return card;\n  }","",['health ui: Overview with the gate passes refused says "unavailable - gatepasses" and prints no total'],['health']);
  await brk('stuck always from the release date','monitor',"l=phLeadTime(ep,fi!==null?Object.assign({},O,{issueAt:fi}):O);","l=phLeadTime(ep,O);",['stuck: PO-701 first fabric issue was 9 Oct (3 days ago): not stuck; the other two (release 11 days) are'],['stuck']);
  await brk('the PO Queue age from release only','queue',"const lt=phLeadTime(po,fi!==null?{now:x.now,settings:x.S,issueAt:fi}:{now:x.now,settings:x.S});","const lt=phLeadTime(po,{now:x.now,settings:x.S});",['stuck (PO Queue): with the first fabric issue 3 days ago the age is 3 d from "issued" and nothing is stuck'],['stuck']);
  await brk('the stuck caption without the basis','monitor',"phI18nD('ov.stuck_cap_ok',{a:_phmPoD(basis.issue,'po'),b:_phmPoD(basis.release,'po')})","'Start: '+basis.issue",['stuck: the caption says which start was used and how many POs used each'],['stuck']);
  await brk('the first-issue map takes the newest pass','health',"const f=l.filter(function(x){return x.ms!==null;});if(f.length)out[k]=f[0].ms;","const f=l.filter(function(x){return x.ms!==null;});if(f.length)out[k]=f[f.length-1].ms;",['stuck: the first-issue map uses phPoKey (090 -> PO-090, 125 -> PO-125) and keeps the OLDEST pass of a PO'],['stuck']);
  await brk('the first-issue map matches the raw text','health',"const raw=_phhPassPoRaw(g),k=phPoKey(raw);","const raw=_phhPassPoRaw(g),k=phStr(raw).trim().toUpperCase()||null;",['stuck: the first-issue map uses phPoKey (090 -> PO-090, 125 -> PO-125) and keeps the OLDEST pass of a PO','health: a pass whose poId is a NUMBER maps to its PO'],['stuck','model']);
  await brk('sources panel open when all is well','monitor',"if(failed)d.setAttribute('open','');","d.setAttribute('open','');",['overview: with everything read fine the sources panel is COLLAPSED (no open attribute) and says "Data sources"'],['overview']);
  await brk('a failed collection hidden in the closed panel','monitor',"if(failed)d.setAttribute('open','');","",['overview: a failed collection keeps the strip OPEN and marked failed, and names the collection'],['overview']);
  await brk('the sources panel above the tiles','monitor',"host.appendChild(_phmTilesEl(PHM_OVERVIEW_TILES,M,host));\n  host.appendChild(_phmAttentionCard(M,host,{limit:5}));","host.appendChild(_phmSourcesCard(ctx));host.appendChild(_phmTilesEl(PHM_OVERVIEW_TILES,M,host));\n  host.appendChild(_phmAttentionCard(M,host,{limit:5}));",['overview: the real tiles come first, the "Data sources" disclosure after them'],['overview']);
  await brk('the top bar left reachable','ui',"  _phTkInert(!!on);","",['shell: while the takeover is up the app\'s own top bar is inert and aria-hidden (Tab and Enter cannot reach Sign out)','shell: _phTkApplyClasses drives it (on and off), so every route in and out is covered'],['shell']);
  await brk('inert not undone on leave','ui',"if(mark.indexOf('|had')<0)n.removeAttribute('inert');","",['shell: on leave the top bar is exactly as it was (no inert, no aria-hidden)'],['shell']);
  await brk('a prior aria-hidden lost','ui',"if(mark.charAt(0)==='h')n.setAttribute('aria-hidden',mark.slice(1).split('|')[0]);else n.removeAttribute('aria-hidden');","n.removeAttribute('aria-hidden');",['shell: ...a sidebar that had aria-hidden="false" gets it back, and a node that was ALREADY inert stays inert'],['shell']);
  await brk('the active dock tab not revealed','ui',"if(typeof a.scrollIntoView==='function')a.scrollIntoView({block:'nearest',inline:'center'});","",['shell: the active tab is scrolled into view (centred) in the phone dock'],['shell']);
  await brk('the reveal not called on paint','ui',"  _phTkRevealActive(rail);\n}","}",['shell: ...and _phTkPaintRail does it on every paint (every route into a tab)'],['shell']);
  await brk('master log with passes missing treated as none','admin',"if(env.passesLoaded===false){out.state='nopasses';return out;}","",['admin: the master log with the gate passes NOT loaded says so (state nopasses) instead of treating every cut as unassigned'],['admin']);
  await brk('the admin master log matches raw poId text','admin',"const id=_phaPoKey(g.poId),n=phNorm(g.cutMaster)","const id=String(g.poId||'').trim().toUpperCase(),n=phNorm(g.cutMaster)",['admin: a pass that stores "125" names the master of PO-125 (matched through phPoKey)'],['admin']);
  await brk('the PC-only text unchanged','admin',"The PO Drafts form (PO Queue, Drafts) reads this.","Today this is only stored: nothing reads it yet.",['admin: the hard PC-only text says the Drafts form reads it'],['admin']);
  await brk('the developer path back','admin',"The classic PO cutting screen reads","The classic PO cutting screen (js/pos.js) reads",['admin: no developer path "(js/pos.js)" on the settings screen'],['admin']);
  await brk('Saved pill drawn on every field','admin',"if(!saved(k))return _phaChip('Default '+defTxt+' - defaults, unconfirmed');","if(!saved(k))return _phaChip('Saved','ph-chip-ok');",['admin: with one saved setting, exactly that field carries a "Saved" pill (it has the Back to default button); untouched fields carry none'],['admin']);
  await brk('no focus into the Rename editor','admin',"ctx.repaint();_phaFocusSoon('.pha-edit input');}","ctx.repaint();}",['admin: opening Rename moves focus into the editor\'s input'],['admin']);
  await brk('a rejected name kept after a refused add','admin',"if(r&&r.ok===false){_phaM.newName='';","if(r&&r.ok===false){",['admin: a REFUSED add shows the refusal (no old success banner) and does not keep the rejected name in the box'],['admin']);
  await brk('finished jobs take capacity','calendar',"chip.finished=phcIsFinished(j,po);","chip.finished=false;",['calendar: a COMPLETE job takes no capacity and nothing spills (planned 80, not over)','calendar: a DONE job is ignored the same way','calendar: a job whose PO is already past cutting is finished work too'],['calendar']);
  await brk('touch copy says Drag','calendar',"return _phcTouch()?(","return false?(",['calendar: on a touch screen the copy never says "Drag" (it says Move to...)'],['calendar']);
  await brk('a ready draft says it can be marked ready','drafts',"_phdForm&&_phdForm.status==='ready'?phI18nD('drafts.complete_ready')","false?'x'",['drafts: a READY draft never says it "can be marked ready"; a draft still does'],['drafts']);
  await brk('the send-back reason box not focused','drafts',"if(!a._focused){","if(false){",['drafts: opening the Send-back reason box puts the caret in it (once)'],['drafts']);
  await brk('focus stolen on every repaint','drafts',"if(!a._focused){a._focused=true;","if(true){a._focused=true;",["drafts: ... and a repaint of the same ask does not steal focus again"],['drafts']);
  /* ── QC checks (16 Oct 2026): each rule reverted once; a named check must FAIL ── */
  const nm=p=>{const k=Object.keys(base).filter(x=>x.indexOf(p)===0);return k.length===1?k[0]:'(no unique check starts with: '+p+')';};
  const Q=['qc'],QU=['qc','qcui'];
  await brk('QC drift never fires','health',"else if(x.drift)r.items.push(","else if(false)r.items.push(",[nm('qc drift: PO-202')],Q);
  await brk('an unreadable locked cut is not reported','health',"if(!x.ok)r.items.push(poRow(e,'the locked cut could not be read","if(false)r.items.push(poRow(e,'the locked cut could not be read",[nm('qc drift: PO-202'),nm('qc drift: the line says')],Q);
  await brk('adopted old receipts are counted again','health',"&&!adopted.has(id))legacyUnits+=q","&&true)legacyUnits+=q",[nm('qc ledgers: NOT flagged')],Q);
  await brk('XXL and 2XL are different sizes','health',"return s==='XXL'?'2XL':s;","return s;",[nm('qc ledgers: NOT flagged')],Q);
  await brk('an adopted (legacy) lot is counted as a QC lot','health',"||l.src==='legacy'||!_phhObj(l.sizes))return;","||!_phhObj(l.sizes))return;",[nm('qc ledgers: NOT flagged')],Q);
  await brk('a void lot is counted as live','health',"if(!_phhObj(l)||l.status!=='live'||l.src","if(!_phhObj(l)||l.src",[nm('qc ledgers: NOT flagged')],Q);
  await brk('old Packing units alone (no lots) are flagged','health',"if(L.legacyUnits>0&&L.lotRows>0)","if(L.legacyUnits>0)",[nm('qc ledgers: NOT flagged')],Q);
  await brk('the go-live day is the NEWEST reconciliation','health',"if(ms!==null&&(min===null||ms<min))min=ms;","if(ms!==null&&(min===null||ms>min))min=ms;",[nm('qc go-live: derived from the OLDEST')],Q);
  await brk('the go-live day is always the fallback','health',"return d?{day:d,source:'recon'}:","return false?{day:d,source:'recon'}:",[nm('qc go-live: derived from the OLDEST')],Q);
  await brk('the fallback constant moves','health',"const PHH_QC_LIVE_DAY_FALLBACK='2026-10-16';","const PHH_QC_LIVE_DAY_FALLBACK='2026-10-17';",[nm('qc go-live: with NO reconciliation')],Q);
  await brk('POs finished before go-live are counted as failures','health',"if(f.day<M.qc.liveDay){M.qc.beforeQcOps++;return;}","",[nm('qc completed: after go-live'),nm('qc completed: PO-402')],Q);
  await brk('the finish day is the UTC day, not the PKT day','health',"const q=_phhObj(po.stages)&&_phhObj(po.stages.qc)?phDay(po.stages.qc.doneAt):null;","const q=_phhObj(po.stages)&&_phhObj(po.stages.qc)&&po.stages.qc.doneAt?String(po.stages.qc.doneAt).slice(0,10):null;",[nm('qc completed: after go-live')],Q);
  await brk('a closed reconciliation is listed','health',"if(phStr(rc.status)!=='closed')r.items.push(","if(true)r.items.push(",[nm('qc completed: PO-403')],Q);
  await brk('an undated completed PO is counted as a failure','health',"if(f.day===null){M.qc.undated++;return;}","if(f.day===null){r.items.push(poRow(e,'undated'));return;}",[nm('qc completed: PO-402')],Q);
  await brk('a list cut at its limit is trusted as complete','health',"const reconOk=Array.isArray(I.recon)&&I.reconTruncated!==true,","const reconOk=Array.isArray(I.recon),",[nm('qc unavailable: a list cut at its limit')],Q);
  await brk('the ledger check does not need the reconciliations','health',"need:['pos','po_qc_lots','po_qc_recon']","need:['pos','po_qc_lots']",[nm('qc unavailable: recon not read')],Q);
  await brk('a non-manager is shown the QC checks','health',"if(c.qc&&!qcOn)return;","",[nm('qc model: qc:false')],Q);
  await brk('the QC stages are read for everyone','health',"const qc=_phhIsManager(ctx);","const qc=true;",[nm("qc ui: Kashif")],QU);
  await brk('the QC stages are never read','health',"const qc=wantQc?_phhEnsureQc(force):null;","const qc=null;",[nm("qc ui: a manager's Monitor reads")],QU);
  await brk('an offline-copy answer is trusted as the collection','data',"if(_phFromCache(snap))throw _phCacheError();","",[nm('qc ui: po_qc_lots answered from the OFFLINE COPY')],QU);
  await brk('the unavailable QC count printed as a number','health',"head.appendChild(phEl('span','phh-count',c.state==='ok'?String(c.count):'—'));","head.appendChild(phEl('span','phh-count',String(c.count||0)));",[nm('qc ui: po_qc_recon REFUSED')],QU);
  s.ok('breaks run: '+broken,broken>=60,String(broken));
  return s;
};

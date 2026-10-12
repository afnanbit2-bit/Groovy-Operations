/* Production Ops ▸ PO Queue (12 Oct 2026): js/ph-mod-queue.js, the tile board.

   What this drives (the real handlers: the REAL js/ph-core.js, ph-data.js, ph-write.js, ph-ui.js and js/pos.js over tests/ph-dom.js's small
   real DOM and an in-memory Firestore with transaction semantics that RECORDS EVERY WRITE):
     · the model: lanes by real stage, reserved / completed / unknown apart, cancelled hidden and counted; season stored vs guessed
       (flagged); the plan from po_cut_jobs; the age / delay badge (plan passed, capacity, age since created is never a delay)
     · the filters (season, master, article search, delayed only) and the repaint of the board alone
     · honesty: a failed pos read prints an error and NO tile and no count; a failed refresh keeps the old tiles and says so; a failed
       po_cut_jobs / cutting_masters read says "not loaded", never "unassigned"; a persistent failure is not retried in a loop
     · the ONE write: Plan -> phSaveCutJob only (po_cut_jobs/{PO} + pos/{PO}/history/{row}); nothing changed writes nothing; a stale
       revision is refused; every recorded write path is checked
     · Force-advance: delegated to the existing window.ownerAdvance (its confirm, its transaction), never for cutting, owners + Mustafa only,
       ownerAdvance's trailing renderDetailPage held off and restored; this file has no Firestore write API of its own
     · the audiences: afnan / ammar / mustafa = the full board; uzaib (Kashif) = Drafts + a READ-ONLY board, no Plan, no Force-advance
     · the Drafts sub-panel (phDraftsPanel, another file) is called behind a guard
     · XSS: stored text only ever reaches textContent
   What it does NOT prove: geometry (the stylesheet assertions below and tests/smoke-layout.js's "production ops — po queue" fragment hold that
   in real Chromium); real Firestore; a real screen or phone. Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-mod-queue.js');
const CSS=read('css/main.css');
const J=JSON.stringify;
const NOW=Date.UTC(2026,9,12,5,0,0);          // 12 Oct 2026, 10:00 PKT
const DAY=86400000;
class FixedDate extends Date{
  constructor(...a){if(a.length===0)super(NOW);else super(...a);}
  static now(){return NOW;}
}
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},
  ammar:{uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer',email:'uzaib@groovy.op'},
  arfat:{uid:'u-arfat',u:'arfat',name:'Arfat',role:'manager',email:'arfat@groovy.op'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store',email:'raees@groovy.op'}
};
const STAGES=['cutting','bundling','stitching','printing','washing','qc'];
function po(id,o){
  const stages={};STAGES.forEach(k=>{stages[k]={done:false,doneAt:null,doneBy:null,dueDate:'',notes:''};});
  return Object.assign({id:id,name:'Effortless Tee',code:'GST073',qty:300,sizes:{S:100,M:200},poStatus:'in_production',currentStage:'cutting',
    stages:stages,ts:NOW-30*DAY,createdAt:'2026-09-12'},o||{});
}
function fixture(){
  const stBundling={};STAGES.forEach(k=>{stBundling[k]={done:false,doneAt:null,doneBy:null};});
  stBundling.cutting={done:true,doneAt:new Date(NOW-4*DAY).toISOString(),doneBy:'Uzaib'};
  return{
    'pos/PO-101':po('PO-101',{ts:NOW-30*DAY}),
    'pos/PO-102':po('PO-102',{code:'GD007',name:'Live In Pants',qty:200,ts:NOW-20*DAY}),
    'pos/PO-103':po('PO-103',{code:'GHW001',name:'Winter Hoodie',qty:6000,season:'winter',seasonYear:2026,ts:NOW-10*DAY}),
    'pos/PO-104':po('PO-104',{code:'GST073',name:'Effortless Tee',qty:300,currentStage:'bundling',stages:stBundling,cutAt:new Date(NOW-4*DAY).toISOString(),cutQty:{S:100,M:195},ts:NOW-25*DAY}),
    'pos/PO-105':po('PO-105',{code:'GD009',name:'Baggy Denim',currentStage:'stitching',ts:NOW-40*DAY}),
    'pos/PO-106':po('PO-106',{code:'GST100',name:'Reserve Tee',poStatus:'reserved',currentStage:undefined,ts:NOW-2*DAY}),
    'pos/PO-107':po('PO-107',{code:'GST101',name:'Cancelled Tee',poStatus:'cancelled',currentStage:null,ts:NOW-50*DAY}),
    'pos/PO-108':po('PO-108',{code:'GST102',name:'Done Tee',poStatus:'complete',currentStage:'completed',ts:NOW-90*DAY}),
    'pos/PO-109':po('PO-109',{code:'GX<b>1',name:'<img src=x onerror=alert(1)>',qty:50,ts:NOW-1*DAY}),
    'pos/PO-110':po('PO-110',{code:'GZZ',name:'Odd Stage',currentStage:'zzz',ts:NOW-60*DAY}),
    'po_cut_jobs/PO-102':{poId:'PO-102',status:'open',rev:1,plannedCutDate:'2026-10-09',masterId:'CM-001',masterName:'Hassan',createdAt:NOW-3*DAY,createdBy:'afnan',updatedAt:NOW-3*DAY,updatedBy:'afnan'},
    'po_cut_jobs/PO-103':{poId:'PO-103',status:'open',rev:3,plannedCutDate:'2026-10-20',masterId:'CM-002',masterName:'Alam',createdAt:NOW-3*DAY,createdBy:'afnan',updatedAt:NOW-1*DAY,updatedBy:'afnan'},
    'cutting_masters/CM-001':{id:'CM-001',name:'Hassan',nameKey:'hassan',kind:'inhouse',active:true},
    'cutting_masters/CM-002':{id:'CM-002',name:'Alam',nameKey:'alam',kind:'inhouse',active:true},
    'cutting_masters/CM-003':{id:'CM-003',name:'Retired Master',nameKey:'retired master',kind:'inhouse',active:false},
    'ph_settings/main':{dailyCapacity:400}
  };
}

/* ── an in-memory Firestore with transaction semantics, recording every write ── */
function makeStore(seed,o){
  o=o||{};
  const docs=new Map(),clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
  Object.keys(seed).forEach(p=>{if(seed[p]!==undefined)docs.set(p,clone(seed[p]));});
  const log={reads:{},writes:[],tx:0,plain:0};
  const setPath=(obj,p,val)=>{const ks=p.split('.');let t=obj;for(let i=0;i<ks.length-1;i++){if(typeof t[ks[i]]!=='object'||t[ks[i]]===null)t[ks[i]]={};t=t[ks[i]];}t[ks[ks.length-1]]=val;};
  const snap=p=>({id:p.split('/').pop(),exists:()=>docs.has(p),data:()=>clone(docs.get(p)),metadata:{fromCache:false}});
  const colOf=p=>p.split('/').slice(0,-1).join('/');
  const api={
    db:{},
    doc:(db,...s)=>({path:s.join('/'),id:s[s.length-1]}),
    collection:(db,...s)=>({path:s.join('/')}),
    query:(c)=>({path:c.path}),orderBy:()=>({}),limit:()=>({}),where:()=>({}),
    getDoc:async r=>{log.reads[r.path]=(log.reads[r.path]||0)+1;return snap(r.path);},
    getDocs:async q=>{
      log.reads[q.path]=(log.reads[q.path]||0)+1;
      if(log.reads[q.path]>60)return new Promise(()=>{});     // a runaway read loop (a broken build) is cut off here instead of hanging the suite
      if(o.gate&&o.gate[q.path])await o.gate[q.path].p;
      if(o.fail&&o.fail[q.path]){const f=o.fail[q.path];if(f.times===undefined||f.times>0){if(f.times!==undefined)f.times--;throw f.err();}}
      const rows=[...docs.keys()].filter(p=>colOf(p)===q.path).sort();
      return{docs:rows.map(snap),metadata:{fromCache:false}};
    },
    setDoc:async(r,d)=>{log.plain++;log.writes.push({op:'set',path:r.path,tx:0,data:clone(d)});docs.set(r.path,clone(d));},
    updateDoc:async(r,d)=>{log.plain++;log.writes.push({op:'update',path:r.path,tx:0,data:clone(d)});},
    addDoc:async(c,d)=>{log.plain++;log.writes.push({op:'add',path:c.path,tx:0});return{id:'x'};},
    deleteDoc:async r=>{log.plain++;log.writes.push({op:'delete',path:r.path,tx:0});docs.delete(r.path);},
    writeBatch:()=>{const ops=[];return{set(r,d){ops.push({op:'set',path:r.path});return this;},update(r,d){ops.push({op:'update',path:r.path});return this;},delete(r){ops.push({op:'delete',path:r.path});return this;},async commit(){log.tx++;ops.forEach(x=>log.writes.push(Object.assign({tx:log.tx},x)));}};},
    runTransaction:async(db,fn)=>{
      const id=++log.tx,buf=[];
      const tx={
        get:async r=>snap(r.path),
        set:(r,d)=>{buf.push({op:'set',path:r.path,data:clone(d)});return tx;},
        update:(r,d)=>{if(!docs.has(r.path))throw new Error('No document to update: '+r.path);buf.push({op:'update',path:r.path,data:clone(d)});return tx;},
        delete:r=>{buf.push({op:'delete',path:r.path});return tx;}
      };
      const res=await fn(tx);
      buf.forEach(b=>{
        log.writes.push({op:b.op,path:b.path,tx:id,data:b.data});
        if(b.op==='set')docs.set(b.path,b.data);
        else if(b.op==='update'){const cur=clone(docs.get(b.path));Object.keys(b.data).forEach(k=>setPath(cur,k,b.data[k]));docs.set(b.path,cur);}
        else docs.delete(b.path);
      });
      return res;
    }
  };
  return{docs,log,api,get:p=>clone(docs.get(p)),put:(p,v)=>docs.set(p,clone(v))};
}
const settle=(ms)=>new Promise(r=>setTimeout(r,ms||25));
const PERM=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});

/* ── one signed-in device ── */
function load(src,opts){
  opts=opts||{};
  const st=makeStore(opts.seed||fixture(),{fail:opts.fail,gate:opts.gate});
  const shown=[];
  const detail={calls:0};
  const globals=Object.assign({},st.api,{
    Date:FixedDate,currentPage:'dashboard',
    allPOs:[],allPasses:[],allReturns:[],allFabricIn:[],allGPEditRequests:[],allFabricMovements:[],allFabricInventory:[],currentBundles:[],viewingPO:null,
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    history:{replaceState(){},pushState(){}},
    auth:{currentUser:{getIdToken:async()=>{}}},
    confirm:opts.confirm||undefined
  },opts.globals||{});
  if(globals.confirm===undefined)delete globals.confirm;
  const files=['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/pos.js'];
  const a=harness.loadApp({files:files,session:opts.session===undefined?USERS.afnan:opts.session,globals:globals});
  const ctx=a.ctx;
  // what loadData left in the app's own PO list
  if(!opts.noAllPOs)ctx.allPOs=[...st.docs.keys()].filter(k=>/^pos\/[^/]+$/.test(k)).map(k=>Object.assign({},st.get(k),{fbKey:k.slice(4)}));
  const dom=domkit.install(ctx);
  // spy on renderDetailPage (pos.js defined the real one): the board must hold it off while ownerAdvance runs
  ctx.renderDetailPage=function(){detail.calls++;};
  detail.stub=ctx.renderDetailPage;
  ctx.window.showPage=function(id){
    shown.push(id);
    if(id==='dashboard'&&opts.noNav)return Promise.resolve();
    ctx.currentPage=id;
    if(id==='prod-ops')ctx.phRenderPage(id);
    return Promise.resolve();
  };
  ctx.window.startApp=async function(){};
  ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(read('js/ph-ui.js'),ctx,{filename:'ph-ui.js'});
  if(opts.drafts!==false){
    ctx.__drafts=[];
    if(opts.drafts==='throw')vm.runInContext('function phDraftsPanel(host,ctx){throw new Error("drafts boom");}',ctx);
    else if(opts.drafts==='blank')vm.runInContext('function phDraftsPanel(host,ctx){}',ctx);
    else vm.runInContext('function phDraftsPanel(host,ctx){__drafts.push({user:ctx.user,canManage:ctx.canManage});host.appendChild(ctx.el("p","drafts-stub","DRAFTS PANEL for "+ctx.user));}',ctx);
  }
  vm.runInContext(src,ctx,{filename:'ph-mod-queue.js'});
  const T={a,ctx,dom,st,log:st.log,shown,detail,
    R:c=>a.run(c),
    as(u){ctx.session=u;},
    panel:()=>dom.find('ph-panel'),
    text:n=>n?n.textContent:'',
    html:n=>n?domkit.toHtml(n):'',
    q:(root,pred)=>dom.all(root||dom.main,pred),
    byClass:(c,root)=>dom.byClass(root||dom.main,c),
    tile:id=>dom.all(dom.main,n=>/\bphq-tile\b/.test(n.className)&&n.getAttribute('data-po')===id)[0]||null,
    tiles:()=>dom.all(dom.main,n=>/\bphq-tile\b/.test(n.className)),
    btn:(root,re)=>dom.all(root,n=>n.tagName==='BUTTON'&&re.test(n.textContent))[0]||null,
    lane:id=>dom.all(dom.main,n=>hc(n,'phq-lane')&&n.getAttribute('data-lane')===id)[0]||null,
    show:async(tab,sub)=>{
      ctx.currentPage='dashboard';
      if(tab)ctx.phGoTab&&vm.runInContext('_phUiTab='+J(tab),ctx);
      await ctx.window.showPage('prod-ops');
      await settle(40);
    },
    tab:async(sub)=>{if(sub)vm.runInContext('_phqSub='+J(sub),ctx);vm.runInContext('_phUiTab="queue";_phUiPaintPanel()',ctx);await settle(40);},
    paths:()=>st.log.writes.map(w=>w.path)
  };
  return T;
}
async function open(user,opts,sub){
  const T=load(opts&&opts.src||SRC,Object.assign({session:USERS[user]},opts||{}));
  await T.show('queue');
  if(sub)T.R('_phqSub='+J(sub));
  T.R('_phUiTab="queue"');T.R('_phUiPaintPanel()');
  await settle(60);
  return T;
}
const hc=(n,c)=>String(n.className||'').split(/\s+/).indexOf(c)>=0;
const ev=(extra)=>Object.assign({currentTarget:null,preventDefault(){}},extra||{});

async function checks(src){
  const o={};
  const bd=(src===SRC);
  const writesOnly=(T,res)=>T.paths().every(p=>res.some(r=>r.test(p)));
  const PLAN_PATHS=[/^po_cut_jobs\/PO-\d+$/,/^pos\/PO-\d+\/history\/[0-9]{13}-[A-Za-z0-9]{4}$/];

  /* ═══ the model (pure) ═══ */
  {
    const T=await open('afnan',{src});
    const M=T.R('(()=>{const rows=_phqPos.rows,jobs=phGet("jobs").rows;const m=phqModel(rows,jobs,{settings:phSettingsNow(),now:'+NOW+'});'
      +'return JSON.stringify({lanes:Object.fromEntries(Object.keys(m.lanes).map(k=>[k,m.lanes[k].map(t=>t.id)])),cancelled:m.cancelled,pipe:m.pipeline,tiles:m.tiles.map(t=>({id:t.id,units:t.units,basis:t.unitsBasis,afloat:t.afloat,season:t.season,plan:t.plan,age:t.age,delay:t.delay}))});})()');
    const m=JSON.parse(M);
    const tile=id=>m.tiles.filter(t=>t.id===id)[0]||{};
    o['model: cutting lane holds the released POs at cutting, plan day first']=J(m.lanes.cutting)===J(['PO-102','PO-103','PO-101','PO-109']);
    o['model: later stages are in their own lanes']=J(m.lanes.bundling)===J(['PO-104'])&&J(m.lanes.stitching)===J(['PO-105'])&&!m.lanes.printing.length&&!m.lanes.washing.length&&!m.lanes.qc.length;
    o['model: reserved, completed and an unrecognised stage are apart (never counted as cutting)']=J(m.lanes.reserved)===J(['PO-106'])&&J(m.lanes.completed)===J(['PO-108'])&&J(m.lanes.unknown)===J(['PO-110']);
    o['model: a cancelled PO has no tile and is counted']=m.cancelled===1&&m.tiles.every(t=>t.id!=='PO-107');
    o['model: the pipeline strip numbers come from phPipeline (afloat = POs at cutting, issued pieces)']=m.pipe.afloat.pos===4&&m.pipe.afloat.units===300+200+6000+50&&m.pipe.counts.reserved===1&&m.pipe.counts.completed===1;
    o['model: afloat marks only POs at cutting']=tile('PO-101').afloat===true&&tile('PO-104').afloat===false&&tile('PO-105').afloat===false;
    o['model: quantity is the ordered qty at cutting and the ACTUAL cut once past it']=tile('PO-101').units===300&&tile('PO-101').basis==='ordered'&&tile('PO-104').units===295&&tile('PO-104').basis==='cut';
    o['model: a season stored on the PO wins and is not a guess']=tile('PO-103').season.key==='winter-2026'&&tile('PO-103').season.guess===false;
    o['model: a season with nothing stored is GUESSED from the dates and flagged']=tile('PO-101').season.guess===true&&/^(summer|winter)-\d{4}$/.test(tile('PO-101').season.key||'');
    o['model: the plan comes from po_cut_jobs (day and master)']=tile('PO-102').plan.day==='2026-10-09'&&tile('PO-102').plan.masterName==='Hassan'&&tile('PO-101').plan.exists===false;
    o['delay: a plan day that passed while the PO is still at cutting is OVERDUE, with the days']=tile('PO-102').delay.level==='overdue'&&/Plan passed 3d ago/.test(tile('PO-102').delay.text)&&tile('PO-102').delay.delayed===true;
    o['delay: a plan the capacity cannot meet is flagged (phAllocate), with the finish day']=tile('PO-103').delay.level==='late'&&/Capacity: finishes/.test(tile('PO-103').delay.text)&&tile('PO-103').delay.delayed===true;
    o['delay: age since CREATED is shown but never counted as a delay (no recorded issue date)']=tile('PO-101').age&&tile('PO-101').age.basis==='created'&&tile('PO-101').age.days===30&&tile('PO-101').delay.delayed===false;
    o['delay: a later lane shows how long the PO has been there, neutral']=tile('PO-104').age&&tile('PO-104').age.basis==='stage'&&tile('PO-104').age.days===4&&tile('PO-104').delay.delayed===false;
    // pure filters
    const F=f=>T.R('(()=>{const m=phqModel(_phqPos.rows,phGet("jobs").rows,{settings:phSettingsNow(),now:'+NOW+'});return JSON.stringify(phqFilterTiles(m.tiles,'+J(f)+').map(t=>t.id));})()');
    o['filter: season winter-2026 keeps the stored-winter PO and drops the summer ones']=(()=>{const r=JSON.parse(F({season:'winter-2026'}));return r.indexOf('PO-103')>=0&&r.indexOf('PO-101')<0&&r.indexOf('PO-105')<0;})();
    o['filter: master Hassan (by its registry key) keeps his tiles; Unassigned keeps the rest']=F({master:'hassan'})===J(['PO-102'])&&JSON.parse(F({master:'__none'})).indexOf('PO-102')<0&&JSON.parse(F({master:'__none'})).indexOf('PO-101')>=0;
    o['filter: article search matches code or name, case-insensitively, and the PO number']=F({q:'LIVE in'})===J(['PO-102'])&&F({q:'gd009'})===J(['PO-105'])&&F({q:'po-104'})===J(['PO-104']);
    o['filter: delayed only keeps the flagged tiles']=F({delayed:true})===J(['PO-102','PO-103']);
    o['filter: filters combine (AND)']=F({delayed:true,master:'alam'})===J(['PO-103'])&&F({delayed:true,q:'zzz'})===J([]);
  }

  /* ═══ drawing: the manager's board ═══ */
  {
    const T=await open('afnan',{src});
    const cut=T.lane('cutting');
    o['board: six real-stage lanes in order, cutting first']=T.byClass('phq-board')[0]&&T.q(T.byClass('phq-board')[0],n=>hc(n,'phq-lane')).map(n=>n.getAttribute('data-lane')).join()==='cutting,bundling,stitching,printing,washing,qc';
    o['board: tiles drawn with their PO numbers (cutting 4, bundling 1, stitching 1)']=T.q(cut,n=>/\bphq-tile\b/.test(n.className)).length===4&&!!T.tile('PO-104')&&!!T.tile('PO-105');
    o['board: reserved and completed are collapsed lanes (no tiles drawn); cancelled is nowhere']=T.q(T.lane('reserved'),n=>/\bphq-tile\b/.test(n.className)).length===0&&T.lane('reserved').children[0].getAttribute('aria-expanded')==='false'&&!T.tile('PO-107')&&!/Cancelled Tee/.test(T.text(T.panel()));
    o['board: a lane header says how many POs it holds']=/Cutting/.test(T.text(cut))&&T.text(T.q(cut,n=>/\bphq-lane-count\b/.test(n.className))[0])==='4';
    o['board: the unrecognised-stage lane exists because one PO is in an odd stage']=!!T.lane('unknown');
    o['board: opening the reserved lane shows its tile']=(()=>{T.dom.click(T.lane('reserved').children[0]);return !!T.tile('PO-106');})();
    const t101=T.tile('PO-101'),t102=T.tile('PO-102'),t103=T.tile('PO-103'),t104=T.tile('PO-104');
    o['tile: shows article code, name, quantity, season chip and the Afloat mark']=/GST073/.test(T.text(t101))&&/Effortless Tee/.test(T.text(t101))&&/300 pcs/.test(T.text(t101))&&/Afloat/.test(T.text(t101))&&T.byClass('phq-season',t101).length===1;
    o['tile: a guessed season is marked with ~ and a title that says so']=/^~ /.test(T.text(T.byClass('phq-season',t101)[0]))&&/Guessed/.test(T.byClass('phq-season',t101)[0].getAttribute('title'))&&!/^~/.test(T.text(T.byClass('phq-season',t103)[0]));
    o['tile: planned day and master shown from the job; a PO with no job says "Not planned"']=/Cut 9 Oct · Hassan/.test(T.text(t102))&&/Not planned/.test(T.text(t101));
    o['tile: the overdue badge is words, and the tile edge class repeats it']=/Plan passed 3d ago/.test(T.text(t102))&&/phq-lvl-overdue/.test(t102.className)&&/phq-lvl-late/.test(t103.className);
    o['tile: a tile in a later lane has no Afloat mark and a "here" age']=!/Afloat/.test(T.text(t104))&&/4d here/.test(T.text(t104));
    o['strip: afloat / in production / reserved / completed / cancelled-hidden are stated']=(()=>{const s=T.text(T.byClass('phq-strip')[0]);return /Afloat 4 POs/.test(s)&&/6,550 pcs/.test(s)&&/Reserved 1/.test(s)&&/Completed 1/.test(s)&&/Cancelled 1 \(hidden\)/.test(s);})();
    // XSS
    const hostile=T.tile('PO-109');
    o['XSS: a hostile article name reaches the page only as escaped text (no element made from it)']=/<img src=x/.test(T.text(hostile))&&T.q(hostile,n=>n.tagName==='IMG'||n.tagName==='B').length===0&&!/<img src=x/.test(T.html(hostile).replace(/&lt;img src=x[^&]*&gt;/g,''));
    // filters repaint the board only
    const input=T.byClass('phq-f-q')[0];
    input.value='live';T.dom.dispatch(input,'input');
    o['filters: typing in the search repaints the board only (the input node is the same one)']=T.byClass('phq-f-q')[0]===input&&T.tiles().length===1&&!!T.tile('PO-102')&&/1 of 9 POs/.test(T.text(T.dom.find('phq-count')));
    o['filters: a lane with matches hidden says "No POs match the filters."']=/No POs match the filters/.test(T.text(T.lane('bundling')));
    input.value='';T.dom.dispatch(input,'input');
    const dl=T.byClass('phq-f-delayed')[0];dl.checked=true;T.dom.dispatch(dl,'change');
    o['filters: Delayed only shows only the flagged tiles']=T.tiles().map(n=>n.getAttribute('data-po')).sort().join()==='PO-102,PO-103';
    dl.checked=false;T.dom.dispatch(dl,'change');
    const ms=T.byClass('phq-f-master')[0];ms.value='alam';T.dom.dispatch(ms,'change');
    o['filters: the master select filters by master']=T.tiles().map(n=>n.getAttribute('data-po')).join()==='PO-103';
    o['filters: the master list is the registry plus names on plans (retired master not offered unless planned)']=(()=>{const opts=T.q(ms,n=>n.tagName==='OPTION').map(n=>T.text(n));return opts.indexOf('Hassan')>=0&&opts.indexOf('Alam')>=0&&opts.indexOf('Unassigned')>=0&&opts.indexOf('All masters')>=0;})();
    ms.value='';T.dom.dispatch(ms,'change');
    const ss=T.byClass('phq-f-season')[0];ss.value='winter-2026';T.dom.dispatch(ss,'change');
    o['filters: the season select filters by season']=(()=>{const ids=T.tiles().map(n=>n.getAttribute('data-po'));return ids.indexOf('PO-103')>=0&&ids.indexOf('PO-101')<0&&ids.length<9;})();
    ss.value='';T.dom.dispatch(ss,'change');
    o['filters: clearing them brings every tile back']=T.tiles().length>=7;
    // the lane cap
    const big=fixture();for(let i=0;i<60;i++){const id='PO-'+(300+i);big['pos/'+id]=po(id,{code:'GB'+i,ts:NOW-i*3600000});}
    const B=await open('afnan',{src,seed:big});
    o['lane cap: 40 tiles are drawn, the rest sit behind a "Show N more" button that reveals them']=(()=>{
      const n0=B.q(B.lane('cutting'),n=>/\bphq-tile\b/.test(n.className)).length;
      const more=B.btn(B.lane('cutting'),/Show \d+ more/);
      if(!more)return false;B.dom.click(more);
      return n0===40&&B.q(B.lane('cutting'),n=>/\bphq-tile\b/.test(n.className)).length===64;})();
  }

  /* ═══ reads and honesty ═══ */
  {
    // never drawn before the read; skeleton while it is out
    const g={'pos':(()=>{let open;const p=new Promise(r=>{open=r;});return{p,open};})()};
    const T=load(src,{session:USERS.afnan,gate:g});
    await T.show('queue');vm_set(T,'queue');await settle(40);
    o['loading: while the pos read is out the panel is a skeleton and draws no tile']=T.byClass('ph-skelwrap').length>=1&&T.tiles().length===0;
    g.pos.open();await settle(60);
    o['loading: once it lands the tiles appear']=T.tiles().length>=7;
  }
  {
    // a failed pos read: error, NO tile, NO count, retry works; a persistent failure is not retried in a loop
    const f={pos:{err:PERM}};
    const T=await open('afnan',{src,fail:f});
    const reads0=T.log.reads.pos;
    o['failed pos read: an alert names pos, prints no tile and no PO count']=T.tiles().length===0&&/Could not read the POs/.test(T.text(T.panel()))&&/pos:/.test(T.text(T.panel()))&&!/\d+ POs?\b/.test(T.text(T.panel()))&&!!T.q(T.panel(),n=>n.getAttribute('role')==='alert')[0];
    await settle(120);
    o['failed pos read: not retried in a loop (one read plus one token-refresh retry, then it waits for the button)']=T.log.reads.pos===reads0&&reads0<=2;
    delete f.pos;
    T.dom.click(T.btn(T.panel(),/^Retry$/));await settle(80);
    o['failed pos read: Retry re-reads and the board appears']=T.tiles().length>=7;
    // a failed REFRESH keeps the old tiles and says so
    f.pos={err:PERM};
    T.dom.click(T.btn(T.panel(),/^Refresh$/));await settle(100);
    o['failed refresh: the old tiles stay, an alert says the refresh failed and when the tiles are from']=T.tiles().length>=7&&/Could not refresh the POs/.test(T.text(T.panel()))&&/read at \d\d:\d\d/.test(T.text(T.panel()));
  }
  {
    // jobs / masters failed: "not loaded", never "unassigned"; no plan buttons
    const T=await open('afnan',{src,fail:{po_cut_jobs:{err:PERM},cutting_masters:{err:PERM}}});
    const t=T.tile('PO-102');
    o['failed cut plans: tiles say "Plan: not loaded", not "Not planned"']=!!t&&/Plan: not loaded/.test(T.text(t))&&!/Not planned/.test(T.text(T.panel()));
    o['failed cut plans: the board says so and draws no Plan / Change plan button']=/po_cut_jobs\) are not loaded/.test(T.text(T.panel()))&&!T.btn(T.panel(),/Plan cut|Change plan/);
    o['failed cut plans: the master filter does not claim "Unassigned" without plans']=T.q(T.byClass('phq-f-master')[0],n=>n.tagName==='OPTION').some(n=>/plans not loaded/.test(T.text(n)));
    o['failed masters: the board says masters are not loaded']=/Cutting masters are not loaded/.test(T.text(T.panel()));
  }
  {
    const T=await open('afnan',{src,seed:Object.assign({},fixture(),{'pos/PO-111':undefined})});
    const E=await open('afnan',{src,seed:{'ph_settings/main':{dailyCapacity:400}}});
    o['an empty collection is said to be empty (it was read)']=/there are none/.test(E.text(E.panel()))&&E.tiles().length===0;
  }

  /* ═══ the Drafts sub-panel ═══ */
  {
    const T=await open('afnan',{src});
    o['sub-tabs: Board and Drafts, Board selected for a manager']=T.q(T.panel(),n=>/\bphq-subtab\b/.test(n.className)).map(n=>n.getAttribute('data-sub')+':'+n.getAttribute('aria-selected')).join()==='board:true,drafts:false';
    T.dom.click(T.q(T.panel(),n=>n.getAttribute('data-sub')==='drafts')[0]);await settle(30);
    o['drafts: phDraftsPanel(host, ctx) is called with the shell ctx']=/DRAFTS PANEL for afnan/.test(T.text(T.panel()))&&T.ctx.__drafts.length>=1&&T.ctx.__drafts[T.ctx.__drafts.length-1].canManage===true;
    const N=await open('afnan',{src,drafts:false},'drafts');
    o['drafts: without the other file, the sub-tab says it is not part of this build (no crash)']=/not part of this build/.test(N.text(N.panel()));
    const X=await open('afnan',{src,drafts:'throw'},'drafts');
    o['drafts: a panel that throws draws an error card, not a blank']=/The drafts panel could not be drawn/.test(X.text(X.panel()))&&/PO Queue/.test(X.text(X.panel()))&&/drafts boom/.test(X.text(X.panel()));
    const Y=await open('afnan',{src,drafts:'blank'},'drafts');
    o['drafts: a panel that draws nothing says so']=/drew nothing/.test(Y.text(Y.panel()));
  }

  /* ═══ PLAN: the one write ═══ */
  {
    const T=await open('afnan',{src});
    const planBtn=T.btn(T.tile('PO-101'),/Plan cut/);
    o['plan: a Plan cut button on a cutting tile without a plan; Change plan where one exists']=!!planBtn&&!!T.btn(T.tile('PO-102'),/Change plan/);
    o['plan: no Plan button on a tile that is past cutting']=!T.btn(T.tile('PO-104'),/Plan|Change/);
    T.dom.click(planBtn);
    const dlg=T.dom.all(T.dom.body,n=>n.getAttribute('role')==='dialog')[0];
    o['plan: opens a modal dialog on <body> (above the rail), titled with the PO']=!!dlg&&dlg.parentNode.parentNode===T.dom.body&&/PO-101/.test(T.text(dlg))&&dlg.getAttribute('aria-modal')==='true';
    o['plan: the master list offers active masters only, plus "No master"']=(()=>{const sel=T.byClass('phq-d-master',dlg)[0];const o2=T.q(sel,n=>n.tagName==='OPTION').map(n=>T.text(n));return o2.join()==='— No master —,Hassan,Alam';})();
    const before=T.log.writes.length;
    T.dom.click(T.byClass('phq-d-save',dlg)[0]);await settle(30);
    o['plan: saving with nothing changed writes nothing and says so']=T.log.writes.length===before&&/Nothing changed/.test(T.text(dlg));
    const day=T.byClass('phq-d-day',dlg)[0];day.value='2026-10-15';
    const sel=T.byClass('phq-d-master',dlg)[0];sel.value='CM-002';
    T.dom.click(T.byClass('phq-d-save',dlg)[0]);await settle(60);
    const job=T.st.get('po_cut_jobs/PO-101');
    o['plan: Save writes po_cut_jobs/PO-101 (day, master id and name) and nothing else but the history row, in ONE transaction']=!!job&&job.plannedCutDate==='2026-10-15'&&job.masterId==='CM-002'&&job.masterName==='Alam'&&T.log.writes.length===2&&new Set(T.log.writes.map(w=>w.tx)).size===1&&T.log.writes[0].tx>0&&T.log.plain===0;
    o['plan: every recorded write path is po_cut_jobs/{PO} or pos/{PO}/history/{row} (nothing in pos itself)']=T.paths().length>0&&writesOnly(T,PLAN_PATHS);
    o['plan: the dialog closes, the tile shows the plan and a toast confirms']=T.dom.all(T.dom.body,n=>n.getAttribute('role')==='dialog').length===0&&/Cut 15 Oct · Alam/.test(T.text(T.tile('PO-101')))&&T.a.state.toasts.some(m=>/Plan saved for PO-101/.test(m));
    o['plan: the history row names the action (cut_job_opened) and the actor']=(()=>{const h=T.log.writes.filter(w=>/history/.test(w.path))[0];return !!h&&h.data.type==='cut_job_opened'&&h.data.by==='afnan';})();
    // change an existing plan: only the changed key is sent, with the loaded revision
    T.dom.click(T.btn(T.tile('PO-102'),/Change plan/));
    const d2=T.dom.all(T.dom.body,n=>n.getAttribute('role')==='dialog')[0];
    o['plan: an existing plan opens prefilled (day and master)']=T.byClass('phq-d-day',d2)[0].value==='2026-10-09'&&T.byClass('phq-d-master',d2)[0].value==='CM-001';
    T.byClass('phq-d-day',d2)[0].value='2026-10-14';
    T.log.writes.length=0;
    T.dom.click(T.byClass('phq-d-save',d2)[0]);await settle(60);
    const j2=T.st.get('po_cut_jobs/PO-102');
    o['plan: editing the day changes the day and leaves the master alone; revision +1']=j2.plannedCutDate==='2026-10-14'&&j2.masterId==='CM-001'&&j2.rev===2;
    o['plan: the update names ONLY the keys that changed (plus rev and the stamp)']=(()=>{const w=T.log.writes.filter(x=>x.path==='po_cut_jobs/PO-102')[0];return !!w&&!('masterId' in w.data)&&!('masterName' in w.data)&&w.data.plannedCutDate==='2026-10-14';})();
    // clearing the day / the master
    T.dom.click(T.btn(T.tile('PO-103'),/Change plan/));
    const d3=T.dom.all(T.dom.body,n=>n.getAttribute('role')==='dialog')[0];
    T.byClass('phq-d-day',d3)[0].value='';T.byClass('phq-d-master',d3)[0].value='';
    T.dom.click(T.byClass('phq-d-save',d3)[0]);await settle(60);
    const j3=T.st.get('po_cut_jobs/PO-103');
    o['plan: an empty day and "No master" clear the plan (null / empty), they are not ignored']=j3.plannedCutDate===null&&j3.masterId===null&&j3.masterName==='';
    // stale revision refused
    T.dom.click(T.btn(T.tile('PO-102'),/Change plan/));
    const d4=T.dom.all(T.dom.body,n=>n.getAttribute('role')==='dialog')[0];
    T.st.put('po_cut_jobs/PO-102',Object.assign(T.st.get('po_cut_jobs/PO-102'),{rev:9,plannedCutDate:'2026-10-30'}));   // someone else saved
    T.byClass('phq-d-day',d4)[0].value='2026-11-02';T.log.writes.length=0;
    T.dom.click(T.byClass('phq-d-save',d4)[0]);await settle(80);
    o['plan: a plan changed by someone else since it was loaded is refused (no write) and the plans are re-read']=T.log.writes.length===0&&/changed by someone else/.test(T.text(d4))&&T.st.get('po_cut_jobs/PO-102').plannedCutDate==='2026-10-30'&&(T.log.reads.po_cut_jobs||0)>=2;
    // cancel and Escape write nothing; Escape closes via the guard
    T.dom.click(T.byClass('phq-d-cancel',d4)[0]);
    T.dom.click(T.btn(T.tile('PO-101'),/Change plan/));
    T.log.writes.length=0;
    const open1=T.dom.all(T.dom.body,n=>n.getAttribute('role')==='dialog').length===1;
    const guardHit=T.R('PH_ESCAPE_GUARDS.map(function(f){try{return f();}catch(e){return false;}}).some(Boolean)');
    o['plan: Escape closes the dialog through the registered guard and writes nothing']=open1&&guardHit===true&&T.dom.all(T.dom.body,n=>n.getAttribute('role')==='dialog').length===0&&T.log.writes.length===0;
    T.dom.click(T.btn(T.tile('PO-101'),/Change plan/));
    await T.ctx.window.showPage('dashboard');
    o['plan: leaving Production Ops by any route closes an open dialog']=T.dom.all(T.dom.body,n=>n.getAttribute('role')==='dialog').length===0;
    // an invalid day
    const T2=await open('afnan',{src});
    T2.dom.click(T2.btn(T2.tile('PO-101'),/Plan cut/));
    const d5=T2.dom.all(T2.dom.body,n=>n.getAttribute('role')==='dialog')[0];
    T2.byClass('phq-d-day',d5)[0].value='2026-13-45';
    T2.dom.click(T2.byClass('phq-d-save',d5)[0]);await settle(30);
    o['plan: a bad day is refused before any write']=T2.log.writes.length===0&&/real day/.test(T2.text(d5));
    // direct call is gated too (the button is not the boundary)
    const r=await T2.R('phqSavePlan("PO-101",{plannedCutDate:"2026-10-20"},null)');
    o['plan: phqSavePlan writes through phSaveCutJob only (a call from a manager lands, one transaction)']=r.ok===true&&T2.log.tx===1;
  }

  /* ═══ FORCE-ADVANCE: delegated to the existing guarded function ═══ */
  {
    const spy=T=>{T.ctx.__adv=[];T.R('(()=>{const o=window.ownerAdvance;window.ownerAdvance=function(){__adv.push([].slice.call(arguments));return o.apply(this,arguments);};})()');};
    const T=await open('afnan',{src});
    spy(T);
    const adv=T.btn(T.tile('PO-104'),/Force-advance/);
    o['advance: a Force-advance button on a bundling tile, naming where it goes']=!!adv&&/Stitching/.test(T.text(adv));
    o['advance: none on a cutting tile, a reserved tile or a completed tile']=!T.btn(T.tile('PO-101'),/Force-advance/);
    o['advance: nothing is written when the board is merely drawn']=T.paths().length===0;
    T.dom.click(adv);await settle(120);
    const p104=T.st.get('pos/PO-104');
    o['advance: it calls window.ownerAdvance(fbKey, the stage the PO is at) and the existing function asks its own confirm first']=T.ctx.__adv.length===1&&J(T.ctx.__adv[0])===J(['PO-104','bundling'])&&T.a.state.confirms.some(c=>/Force-advance "bundling" for PO PO-104/i.test(c));
    o['advance: the write is ownerAdvance\'s own (stage moved, forcedBy recorded); this file wrote nothing itself']=p104.currentStage==='stitching'&&p104.stages.bundling.forcedBy==='afnan'&&T.paths().join()==='pos/PO-104'&&T.log.tx===1&&T.log.plain===0;
    o['advance: ownerAdvance\'s trailing renderDetailPage was held off (no PO page painted over the board) and then restored']=T.detail.calls===0&&T.ctx.renderDetailPage===T.detail.stub;
    o['advance: the board re-reads and the PO now sits in Stitching']=!!T.q(T.lane('stitching'),n=>/\bphq-tile\b/.test(n.className)&&n.getAttribute('data-po')==='PO-104')[0];
    // declining the confirm
    const D=await open('afnan',{src,confirm:()=>false});spy(D);
    D.dom.click(D.btn(D.tile('PO-104'),/Force-advance/));await settle(100);
    o['advance: declining the confirm writes nothing and the PO stays']=D.paths().length===0&&D.st.get('pos/PO-104').currentStage==='bundling';
    // cutting is refused even when called directly
    const C=await open('afnan',{src});spy(C);
    const rc=await C.R('phqAdvance("PO-101",{repaint(){}})');
    o['advance: cutting is refused before ownerAdvance is even called (cut is recorded on the cutting screen)']=rc.ok===false&&rc.code==='refused'&&/Cutting cannot be forced/.test(rc.error)&&C.ctx.__adv.length===0&&C.paths().length===0&&C.a.state.confirms.length===0;
    // a reserved PO is not forceable
    const rr=await C.R('phqAdvance("PO-106",{repaint(){}})');
    o['advance: a reserved PO is refused too']=rr.ok===false&&C.paths().length===0;
    // owners + Mustafa
    const M=await open('mustafa',{src});spy(M);
    o['advance: Mustafa gets the button and it works (his role is manager, gate = _poCanEdit)']=!!M.btn(M.tile('PO-105'),/Force-advance/);
    M.dom.click(M.btn(M.tile('PO-105'),/Force-advance/));await settle(120);
    o['advance: Mustafa\'s move lands through ownerAdvance']=M.st.get('pos/PO-105').currentStage==='printing'&&M.st.get('pos/PO-105').stages.stitching.forcedBy==='mustafa';
    const AR=load(src,{session:USERS.arfat});
    o['advance: Arfat (a manager, not Mustafa) cannot: the gate is a list, not the role']=AR.R('phqCanAdvance()')===false&&AR.R('phqCanAdvance("arfat")')===false;
    const ra=await AR.R('phqAdvance("PO-104",{repaint(){}})');
    o['advance: a refused caller writes nothing and ownerAdvance is not called']=ra.ok===false&&ra.code==='forbidden'&&AR.paths().length===0;
    const MS=load(src,{session:USERS.mustafa});
    MS.R('_poCanEdit=function(){return false;}');
    o['advance: if pos.js\'s own gate says no, the board says no (even for a module manager)']=MS.R('phqCanAdvance()')===false;
    const NOP=load(src,{session:USERS.afnan});
    NOP.R('delete window.ownerAdvance');
    o['advance: without window.ownerAdvance (an older pos.js) there is no advance at all']=NOP.R('phqCanAdvance()')===false;
    // the app's own PO list may not hold the PO yet (ownerAdvance would return silently): the board loads it first
    const NA=await open('afnan',{src,noAllPOs:true});spy(NA);
    NA.dom.click(NA.btn(NA.tile('PO-104'),/Force-advance/));await settle(160);
    o['advance: if the app\'s own PO list does not hold the PO, loadData() runs first and the move still goes through ownerAdvance']=NA.ctx.__adv.length===1&&NA.st.get('pos/PO-104').currentStage==='stitching'&&(NA.log.reads.gatepasses||0)>=1;
    // the source of this file has no write API of its own
    const noComments=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/.*$/gm,'$1');
    o['source: this file calls NO Firestore write API (no setDoc / updateDoc / addDoc / deleteDoc / writeBatch / runTransaction)']=!/\b(?:setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(noComments);
    o['source: the only ph-write function it calls is phSaveCutJob']=(()=>{const m=noComments.match(/\b(?:phSaveDraft|phMarkDraftReady|phSendBackDraft|phAbandonDraft|phSaveCutJob|phAppendHistory|phMasterAdd|phMasterRename|phMasterSetActive|phStandardSave|phSettingsSave)\s*\(/g)||[];return m.length>=1&&m.every(x=>/^phSaveCutJob\s*\($/.test(x.replace(/\s+/g,'')));})();
    o['source: the existing ownerAdvance asks a confirm BEFORE its transaction (the confirm this board relies on)']=(()=>{const p=read('js/pos.js');const i=p.indexOf('window.ownerAdvance=async');const j=p.indexOf('confirm(',i),k=p.indexOf('runTransaction',i);return i>0&&j>0&&k>j;})();
  }

  /* ═══ Kashif (uzaib): Drafts + a read-only board ═══ */
  {
    const T=await open('uzaib',{src});
    o['uzaib: the shell lists the PO Queue tab for him (registered roles = the whole audience)']=T.R('phTabsFor("uzaib").map(t=>t.id).indexOf("queue")')>=0;
    o['uzaib: he still has no other manager tab (Calendar, Monitor, Masters, Settings stay hidden)']=T.R('phTabsFor("uzaib").map(t=>t.id).join()')==='overview,queue,cutting';
    o['uzaib: the tab opens on DRAFTS, and phDraftsPanel receives his ctx (canManage false)']=/DRAFTS PANEL for uzaib/.test(T.text(T.panel()))&&T.ctx.__drafts.length>=1&&T.ctx.__drafts[0].canManage===false&&T.tiles().length===0;
    o['uzaib: the tab says View only for the board']=/View only/.test(T.text(T.panel()))&&/cannot plan or move a PO/.test(T.text(T.panel()));
    T.dom.click(T.q(T.panel(),n=>n.getAttribute('data-sub')==='board')[0]);await settle(80);
    o['uzaib: the read-only board shows the tiles']=T.tiles().length>=7&&!!T.tile('PO-102')&&/Cut 9 Oct · Hassan/.test(T.text(T.tile('PO-102')));
    o['uzaib: NO Plan cut / Change plan button and NO Force-advance button anywhere on the board']=!T.btn(T.panel(),/Plan cut|Change plan|Force-advance/);
    o['uzaib: Open is still offered (it is a link to the PO page, a read)']=!!T.btn(T.tile('PO-101'),/^Open$/);
    const r=await T.R('phqSavePlan("PO-101",{plannedCutDate:"2026-10-20"},null)');
    o['uzaib: phqSavePlan is refused (forbidden) and writes nothing, even though phSaveCutJob would let the floor save']=r.ok===false&&r.code==='forbidden'&&T.paths().length===0;
    const ra=await T.R('phqAdvance("PO-104",{repaint(){}})');
    o['uzaib: phqAdvance is refused and writes nothing']=ra.ok===false&&ra.code==='forbidden'&&T.paths().length===0&&T.a.state.confirms.length===0;
    const tl=T.tile('PO-101');
    T.R('_phqOpenPlan(phqModel(_phqPos.rows,phGet("jobs").rows,{now:'+NOW+'}).tiles[0],{user:"uzaib",canManage:false,get:phGet,repaint(){}},null)');
    o['uzaib: even calling the dialog directly opens nothing']=T.dom.all(T.dom.body,n=>n.getAttribute('role')==='dialog').length===0;
    o['uzaib: he can reach the drafts panel again from the sub-tab']=(()=>{T.dom.click(T.q(T.panel(),n=>n.getAttribute('data-sub')==='drafts')[0]);return /DRAFTS PANEL for uzaib/.test(T.text(T.panel()));})();
    // managers' default is the board
    const M=await open('mustafa',{src});
    o['managers: the tab opens on the Board (not Drafts) and the panel is not View only']=T.q(M.panel(),n=>n.getAttribute('data-sub')==='board')[0].getAttribute('aria-selected')==='true'&&!/View only/.test(M.text(M.panel()))&&M.tiles().length>=7;
    const SW=await open('afnan',{src});
    SW.dom.click(SW.q(SW.panel(),n=>n.getAttribute('data-sub')==='board')[0]);await settle(30);   // the manager picks the Board explicitly
    SW.as(USERS.uzaib);SW.R('_phUiPaintPanel()');await settle(40);
    o['switching person on one page load resets the sub-tab: the next person gets their own default (Drafts for uzaib), not the manager\'s board']=/DRAFTS PANEL for uzaib/.test(SW.text(SW.panel()))&&SW.tiles().length===0;
    // audience: the shell still refuses everyone else
    const RA=load(src,{session:USERS.raees});
    o['audience: raees gets no tabs at all (the queue\'s widened roles cannot reach someone off the audience)']=RA.R('phTabsFor("raees").length')===0&&RA.R('phTabsFor("arfat").length')===0;
  }

  /* ═══ Open PO ═══ */
  {
    const T=await open('afnan',{src,globals:{}});
    T.R('window.openPODetail=function(k){window.__opened=k;};');
    const sawOn=T.R('_phUiOn');
    T.R('_phqPos.stale=true');
    await T.tab();
    T.dom.click(T.btn(T.tile('PO-105'),/^Open$/));
    o['open: the takeover comes down FIRST, then the existing PO page is opened']=sawOn===true&&T.R('_phUiOn')===false&&T.R('window.__opened')==='PO-105'&&!T.dom.body.classList.contains('ph-fullscreen');
  }

  /* ═══ the source and the stylesheet ═══ */
  {
    const code=src.replace(/\/\*[\s\S]*?\*\//g,'');
    o['XSS: the source never assigns innerHTML / outerHTML / insertAdjacentHTML or parses a string as HTML']=!/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|DOMParser|document\.write/.test(code);
    const a=CSS.indexOf('/* ph-mod-queue START */'),b=CSS.indexOf('/* ph-mod-queue END */');
    const blk=CSS.slice(a,b).replace(/\/\*[\s\S]*?\*\//g,'');
    o['css: the block exists, is in the trailing run of ph-mod-* blocks at the END of the file, and its braces balance']=a>0&&b>a&&CSS.slice(b+'/* ph-mod-queue END */'.length).replace(/\/\* ph-mod-[a-z]+ START \*\/[\s\S]*?\/\* ph-mod-[a-z]+ END \*\//g,'').trim()===''&&(blk.match(/\{/g)||[]).length===(blk.match(/\}/g)||[]).length;
    o['css: tokens only (no literal colour)']=!/#[0-9a-fA-F]{3,8}\b/.test(blk)&&!/\b(?:rgb|rgba|hsl|hsla)\(/.test(blk);
    o['css: every selector is .phq-prefixed']=(blk.match(/[^{}]+(?=\{)/g)||[]).filter(s=>!/^\s*@media/.test(s)).every(s=>s.split(',').every(p=>/phq-/.test(p)));
    o['css: nothing under 12px']=!/font-size:(?:[0-9]|10|11)(?:\.\d+)?px/.test(blk);
    o['css: touch targets are 44px (buttons, selects, lane heads, sub-tabs, checkbox rows)']=/\.phq-btn\{min-height:44px/.test(blk)&&/\.phq-sel,\.phq-in\{min-height:44px/.test(blk)&&/\.phq-lane-head\{[^}]*min-height:44px/.test(blk)&&/\.phq-subtab\{min-height:44px/.test(blk)&&/\.phq-check\{[^}]*min-height:44px/.test(blk);
    o['css: the board is a wrapping grid (no hidden columns, no sideways scroll); on a phone one stacked column; the dialog a bottom sheet']=/\.phq-board\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(240px,1fr\)\)/.test(blk)&&!/\.phq-board\{[^}]*overflow-x:auto/.test(blk)&&/@media \(max-width:700px\)\{[\s\S]*\.phq-board\{grid-template-columns:1fr\}[\s\S]*\.phq-lane\{width:100%\}[\s\S]*\.phq-ov\{align-items:flex-end/.test(blk);
    o['css: the dialog sits above the rail (130 > 121) and under the bug FAB (500)']=/\.phq-ov\{[^}]*z-index:130/.test(blk);
    o['css: ink on --dark is --on-dark (the lane count chip)']=/\.phq-lane-count\{[^}]*background:var\(--dark\)[^}]*color:var\(--on-dark\)/.test(blk);
    o['css: a keyboard focus ring is drawn']=/\.phq-btn:focus-visible[^}]*outline:2px solid var\(--text\)/.test(blk);
    const idx=read('index.html'),sw=read('sw.js');
    o['wiring: the script tag follows ph-ui.js in index.html and the precache lists the file']=/ph-ui\.js\?v=[^"]*"><\/script>\s*<script src="\/js\/ph-mod-queue\.js\?v=[^"]*"><\/script>/.test(idx)&&/'\/js\/ph-ui\.js',\s*'\/js\/ph-mod-queue\.js',/.test(sw);
  }
  return o;
}
function vm_set(T,tab){T.R('_phUiTab='+J(tab));T.R('_phUiPaintPanel()');}

module.exports=async function(){
  const s=suite('ph-mod-queue');
  const base=await checks(SRC);
  s.section('production ops - po queue');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));

  if(process.env.PHQ_ONLY_BASE)return s;     // a development shortcut: skip the (slow) breaks
  s.section('deliberate breaks - each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const pairs=Array.isArray(from)?from:[[from,to]];
    let mut=SRC;
    for(const [f,t] of pairs){
      if(mut.split(f).length-1<1){s.ok('break target exists: '+label+' ('+f.slice(0,50)+')',false);return;}
      mut=mut.split(f).join(t);
    }
    let r;try{r=await checks.call(null,mut);}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  await brk('plan gate widened to the whole floor',"function phqCanPlan(u){return typeof phCanManage==='function'&&phCanManage(_phqUser(u))===true;}","function phqCanPlan(u){return typeof phCanSee==='function'&&phCanSee(_phqUser(u))===true;}",['uzaib: phqSavePlan is refused (forbidden) and writes nothing, even though phSaveCutJob would let the floor save','uzaib: phqAdvance is refused and writes nothing']);
  await brk('board draws manager buttons for everyone',"const manage=phqCanPlan(ctx.user)&&ctx.canManage!==false;","const manage=true;",['uzaib: NO Plan cut / Change plan button and NO Force-advance button anywhere on the board','uzaib: the tab opens on DRAFTS, and phDraftsPanel receives his ctx (canManage false)']);
  await brk('uzaib lands on the board',"function _phqSubDefault(manage){return manage?'board':'drafts';}","function _phqSubDefault(manage){return'board';}",['uzaib: the tab opens on DRAFTS, and phDraftsPanel receives his ctx (canManage false)']);
  await brk('tab hidden from uzaib (manager-only roles)',"roles:function(u){return typeof phCanSee==='function'&&phCanSee(u)===true;}","roles:function(u){return typeof phCanManage==='function'&&phCanManage(u)===true;}",["uzaib: the shell lists the PO Queue tab for him (registered roles = the whole audience)"]);
  await brk('the dialog opens for anyone who calls it',"function _phqOpenPlan(t,ctx,opener){\n  if(!phqCanPlan(ctx.user))return;","function _phqOpenPlan(t,ctx,opener){",['uzaib: even calling the dialog directly opens nothing']);
  await brk('the advance gate ignores pos.js\'s own helper',"try{if(_poCanEdit()!==true)return false;}catch(e){return false;}","",['advance: if pos.js\'s own gate says no, the board says no (even for a module manager)']);
  await brk('advance without the ownerAdvance function check',"return typeof window!=='undefined'&&!!window&&typeof window.ownerAdvance==='function'&&typeof poForceAdvancePlan==='function';","return true;",['advance: without window.ownerAdvance (an older pos.js) there is no advance at all']);
  await brk('cutting is handed to ownerAdvance',"if(!plan.ok){if(typeof showToast==='function')showToast(plan.msg,true);return{ok:false,code:'refused',error:plan.msg};}","",['advance: cutting is refused before ownerAdvance is even called (cut is recorded on the cutting screen)']);
  await brk('a Force-advance button on a cutting tile',"&&t.lane!=='cutting'){\n    const i=","){\n    const i=",['advance: none on a cutting tile, a reserved tile or a completed tile']);
  await brk('renderDetailPage is not held off',"globalThis.renderDetailPage=function(){};","",["advance: ownerAdvance's trailing renderDetailPage was held off (no PO page painted over the board) and then restored"]);
  await brk('renderDetailPage is not restored',"if(prev===undefined)delete globalThis.renderDetailPage;else globalThis.renderDetailPage=prev;","",["advance: ownerAdvance's trailing renderDetailPage was held off (no PO page painted over the board) and then restored"]);
  await brk('the board writes the stage itself',"await window.ownerAdvance(fbKey,stage);","await updateDoc(doc(db,'pos',fbKey),{currentStage:'stitching'});",['source: this file calls NO Firestore write API (no setDoc / updateDoc / addDoc / deleteDoc / writeBatch / runTransaction)','advance: it calls window.ownerAdvance(fbKey, the stage the PO is at) and the existing function asks its own confirm first']);
  await brk('plan writes the job with setDoc',"try{return await phSaveCutJob(poId,input,opts);}","try{await setDoc(doc(db,'po_cut_jobs',poId),input);return{ok:true};}",['source: this file calls NO Firestore write API (no setDoc / updateDoc / addDoc / deleteDoc / writeBatch / runTransaction)','plan: Save writes po_cut_jobs/PO-101 (day, master id and name) and nothing else but the history row, in ONE transaction']);
  await brk('plan skips the revision check',"if(job&&typeof job.rev==='number')opts.expectedRev=job.rev;","",['plan: a plan changed by someone else since it was loaded is refused (no write) and the plans are re-read']);
  await brk('an unchanged save still writes',"if(!r.changed){msg.textContent='Nothing changed.';return;}","",['plan: saving with nothing changed writes nothing and says so']);
  await brk('only changed keys is dropped (the master is always sent)',"if(sel!=='__keep'&&sel!==curId){","if(sel!=='__keep'){",['plan: the update names ONLY the keys that changed (plus rev and the stamp)']);
  await brk('clearing the master is ignored',"if(sel===''){out.masterId=null;out.masterName='';}","if(sel===''){}",['plan: an empty day and "No master" clear the plan (null / empty), they are not ignored']);
  await brk('Plan shown while plans are not loaded',"if(manage&&t.lane==='cutting'&&jobsOk&&_phqPlannable(t.id)","if(manage&&t.lane==='cutting'&&_phqPlannable(t.id)",['failed cut plans: the board says so and draws no Plan / Change plan button']);
  await brk('a failed plans read printed as "Not planned"',"if(!jobsOk)plan='Plan: not loaded';\n    else if","if(false)plan='';\n    else if",['failed cut plans: tiles say "Plan: not loaded", not "Not planned"']);
  await brk('no Escape guard on the dialog',"if(typeof phAddEscapeGuard==='function')phAddEscapeGuard(_phqEscape);","",['plan: Escape closes the dialog through the registered guard and writes nothing']);
  await brk('a dialog outlives the page',"try{if(typeof currentPage==='undefined'||currentPage!=='prod-ops')_phqCloseDlg();}catch(e){}","",['plan: leaving Production Ops by any route closes an open dialog']);
  await brk('cancelled POs shown',"if(st==='cancelled'){cancelled++;return;}","if(st==='cancelled'){cancelled++;}",['model: a cancelled PO has no tile and is counted']);
  await brk('reserved POs fall into cutting',"const lane=PHQ_LANES.some(function(l){return l.id===stage;})?stage:(stage==='reserved'||stage==='completed'?stage:'unknown');","const lane=PHQ_LANES.some(function(l){return l.id===stage;})?stage:(stage==='reserved'?'cutting':stage==='completed'?stage:'unknown');",['model: reserved, completed and an unrecognised stage are apart (never counted as cutting)']);
  await brk('a guessed season is not flagged',"guess:!!season.guess&&season.key!==null","guess:false",['model: a season with nothing stored is GUESSED from the dates and flagged','tile: a guessed season is marked with ~ and a title that says so']);
  await brk('age since created counted as a delay',"else if(tile.age&&tile.age.basis!=='created'&&(","else if(tile.age&&(",['delay: age since CREATED is shown but never counted as a delay (no recorded issue date)']);
  await brk('overdue plan not detected',"if(planDay!==null&&gap.state==='overdue'){","if(false){",['delay: a plan day that passed while the PO is still at cutting is OVERDUE, with the days']);
  await brk('capacity lateness not detected',"if(planDay!==null&&rec&&rec.delayDays!==null&&rec.delayDays>0){","if(false){",['delay: a plan the capacity cannot meet is flagged (phAllocate), with the finish day']);
  await brk('delayed-only filter ignored',"if(F.delayed&&!t.delayed&&!t.delay.delayed)return false;","",['filter: delayed only keeps the flagged tiles','filters: Delayed only shows only the flagged tiles']);
  await brk('search filter ignored',"if(q&&(t.code+' '+t.name+' '+t.po+' '+t.id).toLowerCase().indexOf(q)<0)return false;","",['filter: article search matches code or name, case-insensitively, and the PO number']);
  await brk('master filter ignored',"if(F.master){","if(false){",['filter: master Hassan (by its registry key) keeps his tiles; Unassigned keeps the rest']);
  await brk('season filter ignored',"if(F.season){","if(false){",['filter: season winter-2026 keeps the stored-winter PO only']);
  await brk('a failed read drawn as an empty board',"if(_phqPos.state==='error'&&!loading){\n      body.appendChild(_phqErrCard('Could not read the POs'","if(false){\n      body.appendChild(_phqErrCard('Could not read the POs'",['failed pos read: an alert names pos, prints no tile and no PO count']);
  await brk('a failed read retried in a loop',"const due=_phqPos.state==='idle'||(_phqPos.state==='ok'&&","const due=_phqPos.state==='idle'||_phqPos.state==='error'||(_phqPos.state==='ok'&&",['failed pos read: not retried in a loop (one read plus one token-refresh retry, then it waits for the button)']);
  await brk('a failed refresh drops the old tiles',"_phqPos={state:'error',rows:_phqPos.rows,at:_phqPos.at,err:err,truncated:_phqPos.truncated,stale:true};\n      if(typeof console","_phqPos={state:'error',rows:null,at:_phqPos.at,err:err,truncated:_phqPos.truncated,stale:true};\n      if(typeof console",['failed refresh: the old tiles stay, an alert says the refresh failed and when the tiles are from']);
  await brk('the Drafts panel called unguarded',"if(typeof phDraftsPanel!=='function'){","if(false){",['drafts: without the other file, the sub-tab says it is not part of this build (no crash)']);
  await brk('a throwing Drafts panel not caught',"try{phDraftsPanel(body,ctx);}\n  catch(e){","try{phDraftsPanel(body,ctx);}\n  catch(e){throw e;",['drafts: a panel that throws draws an error card, not a blank']);
  await brk('article name parsed as HTML',"if(t.name)art.appendChild(phEl('span','phq-name',t.name));","if(t.name){const sp=phEl('span','phq-name');sp.innerHTML=t.name;art.appendChild(sp);}",['XSS: the source never assigns innerHTML / outerHTML / insertAdjacentHTML or parses a string as HTML']);
  await brk('Open leaves the takeover up',"try{if(typeof _phTkLeave==='function')_phTkLeave();}catch(e){}","",['open: the takeover comes down FIRST, then the existing PO page is opened']);
  await brk('lane cap removed',"const cap=_phqShowAll[l.id]?list.length:PHQ_LANE_CAP;","const cap=list.length;",['lane cap: 40 tiles are drawn, the rest sit behind a "Show N more" button that reveals them']);
  await brk('the previous person\'s sub-tab is kept',"if(_phqSeenUser&&_phqSeenUser!==ctx.user){","if(false){",["switching person on one page load resets the sub-tab: the next person gets their own default (Drafts for uzaib), not the manager's board"]);
  await brk('a search keystroke repaints the whole tab',"const onq=function(){_phqF.q=q.value;_phqRepaintBoard(ctx);};","const onq=function(){_phqF.q=q.value;ctx.repaint();};",['filters: typing in the search repaints the board only (the input node is the same one)']);
  s.ok('breaks run: '+broken,broken>=35);
  return s;
};

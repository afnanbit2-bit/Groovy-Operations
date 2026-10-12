/* Production Ops ▸ Calendar tab (12 Oct 2026): js/ph-mod-calendar.js registered into js/ph-ui.js's tab registry.

   What this drives (the REAL files over tests/ph-dom.js's small DOM and an in-memory Firestore with real transaction semantics):
     · the pure decisions: lock reasons, the day check, the plan/move decision, the month/week ranges, the model (load per day, over-capacity,
       spill from phAllocate, the tray, today's jobs)
     · the screen: month and week, load vs capacity flagged with text + glyph, the tray (released, still at cutting, no date; reserved/cancelled/
       already-cut never), today's list and its link to Today's Cutting, honest failure states (jobs unreadable = no grid; settings unreadable =
       no capacity and no planning; POs not loaded = the tray says so, never "nothing to plan")
     · the DRAG, end to end through the document-level listeners the handler registers: a 3px move is a click (no ghost, no capture), past 4px
       it drags (late capture), the drop writes ONE transaction (po_cut_jobs + its pos/{id}/history row; never the pos document), the click that
       ends a drag opens nothing, Escape / pointercancel / a lost release / a second finger / a drop outside end it without a write
     · the refusals: skip day, weekly off day, a past day, a done job, an overridden job, an already-cut PO, a stale revision, view-only,
       settings or jobs unreadable
     · the "Move to..." menu (keyboard and phone route) and touch input never dragging
     · XSS (stored text reaches textContent only), the audience (Uzaib has no Calendar tab) and the wiring (script tag, precache)
   What it does NOT prove: geometry (the harness has no layout; tests/smoke-layout.js's "production ops — calendar" fragment holds that in
   real Chromium), real Firestore, a real pointer or a phone. Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-mod-calendar.js');
const CSS=read('css/main.css');
const J=JSON.stringify;
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store'}
};
const TODAY='2026-10-12';   // a Monday
const HOSTILE='<img src=x onerror=alert(1)>';
const settle=(ms)=>new Promise(r=>setTimeout(r,ms||4));

/* ── an in-memory Firestore: transactions that buffer and apply, everything recorded ─ */
function makeFake(o){
  o=o||{};
  const store={},log={writes:[],tx:0,reads:[]};
  const clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
  const snapDoc=p=>({id:p.split('/').pop(),exists:()=>Object.prototype.hasOwnProperty.call(store,p),data:()=>clone(store[p]),metadata:{fromCache:false}});
  const perm=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
  const api={
    db:{},
    doc:(db,...s)=>({path:s.join('/'),id:s[s.length-1]}),
    collection:(db,...s)=>({path:s.join('/')}),
    query:(c,...cons)=>({path:c.path}),orderBy:()=>({}),limit:()=>({}),where:()=>({}),
    getDoc:async r=>{log.reads.push(r.path);if(o.fail&&o.fail[r.path])throw perm();return snapDoc(r.path);},
    getDocs:async q=>{
      log.reads.push(q.path);
      if(o.fail&&o.fail[q.path])throw perm();
      const docs=Object.keys(store).filter(k=>k.indexOf(q.path+'/')===0&&k.slice(q.path.length+1).indexOf('/')===-1).sort();
      return{docs:docs.map(snapDoc),metadata:{fromCache:false}};
    },
    setDoc:async(r,d)=>{log.writes.push({op:'set',path:r.path,tx:0,data:clone(d)});store[r.path]=clone(d);},
    updateDoc:async(r,d)=>{log.writes.push({op:'update',path:r.path,tx:0,data:clone(d)});store[r.path]=Object.assign({},store[r.path],clone(d));},
    deleteDoc:async r=>{log.writes.push({op:'delete',path:r.path,tx:0});},
    addDoc:async(c,d)=>{log.writes.push({op:'add',path:c.path,tx:0,data:clone(d)});return{id:'x'};},
    writeBatch:()=>({set(){return this;},update(){return this;},delete(){return this;},async commit(){log.writes.push({op:'batch',path:'?',tx:0});}}),
    runTransaction:async(db,fn)=>{
      const id=++log.tx,buf=[];
      const tx={
        get:async r=>snapDoc(r.path),
        set:(r,d)=>{buf.push({op:'set',path:r.path,data:clone(d)});return tx;},
        update:(r,d)=>{if(!Object.prototype.hasOwnProperty.call(store,r.path)&&!buf.some(b=>b.path===r.path))throw new Error('not-found');buf.push({op:'update',path:r.path,data:clone(d)});return tx;},
        delete:r=>{buf.push({op:'delete',path:r.path});return tx;}
      };
      const res=await fn(tx);
      buf.forEach(b=>{log.writes.push({op:b.op,path:b.path,tx:id,data:b.data});
        if(b.op==='set')store[b.path]=b.data;else if(b.op==='update')store[b.path]=Object.assign({},store[b.path],b.data);else delete store[b.path];});
      return res;
    }
  };
  return{store,log,api};
}

/* ── the scenario: Monday 12 Oct 2026, capacity 400, Sundays off, 16 Oct a skip day ─ */
function seed(store){
  const po=(id,o)=>{store['pos/'+id]=Object.assign({id:id,name:'Effortless Tee',code:'GST073',qty:100,poStatus:'in_production',currentStage:'cutting',ts:1790000000000},o||{});};
  po('PO-101',{qty:700});po('PO-102',{qty:300,name:'Zip Hoodie'});po('PO-103',{qty:150});po('PO-104',{qty:200});po('PO-105',{qty:100});
  po('PO-106',{qty:250,name:'Core Tee'});
  po('PO-107',{qty:90,poStatus:'reserved',currentStage:null});
  po('PO-108',{qty:120,currentStage:'bundling'});
  po('PO-109',{qty:80,poStatus:'cancelled',currentStage:null});
  po('PO-110',{qty:60,name:HOSTILE});
  const job=(id,o)=>{store['po_cut_jobs/'+id]=Object.assign({poId:id,status:'open',rev:1,plannedCutDate:null,masterId:null,masterName:'',plannedFabric:null,rollsChecklist:null,note:'',createdAt:1,createdBy:'afnan',updatedAt:1,updatedBy:'afnan'},o);};
  job('PO-101',{plannedCutDate:'2026-10-12',masterName:'Hassan'});
  job('PO-102',{plannedCutDate:'2026-10-12',masterName:'Alam'});
  job('PO-103',{plannedCutDate:'2026-10-14',masterName:'Hassan'});
  job('PO-104',{plannedCutDate:'2026-10-09',status:'done',rev:4});
  job('PO-105',{plannedCutDate:'2026-10-15',status:'overridden',rev:3});
  job('PO-108',{plannedCutDate:'2026-10-13'});
  job('PO-109',{plannedCutDate:'2026-10-14'});
  store['ph_settings/main']={dailyCapacity:400,skipDays:['2026-10-16'],offWeekdays:[0],rev:1};
}
function posOf(store){return Object.keys(store).filter(k=>/^pos\/PO-\d+$/.test(k)).map(k=>Object.assign({},store[k],{fbKey:k.slice(4)}));}

function load(src,opts){
  opts=opts||{};
  const fk=makeFake({fail:opts.fail});
  if(!opts.noSeed)seed(fk.store);
  if(opts.mutate)opts.mutate(fk.store);
  const store={},calls=[];
  const globals=Object.assign({},fk.api,{
    allPOs:opts.noPOs?[]:posOf(fk.store),
    localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},
    history:{replaceState(s,t,u){calls.push(String(u));},pushState(){}},
    loadData:()=>{fk.log.reloaded=(fk.log.reloaded||0)+1;}
  },opts.globals||{});
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js'],session:opts.session===undefined?USERS.afnan:opts.session,currentPage:'dashboard',phone:!!opts.phone,globals});
  const ctx=a.ctx;
  const dom=domkit.install(ctx);
  ctx.window.showPage=function(id){ctx.currentPage=id;if(id==='prod-ops')ctx.phRenderPage(id);return Promise.resolve();};
  ctx.window.startApp=async function(){};
  ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(read('js/ph-ui.js'),ctx,{filename:'ph-ui.js'});
  vm.runInContext(src,ctx,{filename:'ph-mod-calendar.js'});
  const R=c=>a.run(c);
  R('_phcToday=function(){return '+J(TODAY)+';}');
  const T={a,ctx,dom,fk,R,calls,store,
    panel:()=>dom.find('ph-panel'),
    text:n=>n?n.textContent:'',
    as(u){ctx.session=u;},
    open:async(tab)=>{await ctx.window.showPage('prod-ops');await settle();ctx.phGoTab(tab||'calendar');await settle(2);},
    cells:()=>dom.all(T.panel(),n=>n.getAttribute&&n.getAttribute('data-phc-day')),
    cell:d=>dom.all(T.panel(),n=>n.getAttribute&&n.getAttribute('data-phc-day')===d)[0]||null,
    chips:id=>dom.all(T.panel(),n=>n.getAttribute&&n.getAttribute('data-phc-po')===id),
    chip:id=>T.chips(id).filter(n=>!/\btray\b/.test(n.className))[0]||null,
    tray:id=>T.chips(id).filter(n=>/\btray\b/.test(n.className))[0]||null,
    dayOf:id=>{const c=T.chip(id);for(let p=c;p;p=p.parentNode){const d=p.getAttribute&&p.getAttribute('data-phc-day');if(d)return d;}return null;},
    msg:()=>{const m=dom.byClass(T.panel(),'phc-msg')[0];return m?m.textContent:'';},
    dialog:()=>dom.byClass(T.panel(),'phc-dialog')[0]||null,
    dlgInput:()=>dom.find('phc-dlg-date'),
    dlgGo:()=>dom.find('phc-dlg-go'),
    docL:(type,ev)=>(a.state.listeners[type]||[]).slice().forEach(f=>f(ev)),
    nListeners:type=>(a.state.listeners[type]||[]).length,
    keys:e=>(a.state.listeners.keydown||[]).forEach(f=>f(e)),
    writes:()=>fk.log.writes,
    // pointer helpers: down on an element, move to (x,y), up
    down:(el,x,y,extra)=>dom.dispatch(el,'pointerdown',Object.assign({pointerType:'mouse',button:0,pointerId:1,clientX:x,clientY:y},extra||{})),
    move:(x,y,extra)=>T.docL('pointermove',Object.assign({pointerId:1,clientX:x,clientY:y,buttons:1},extra||{})),
    up:(x,y,extra)=>T.docL('pointerup',Object.assign({pointerId:1,clientX:x,clientY:y},extra||{})),
    // make the drop target a day
    dropOn(day){R('_phcDayFromPoint=function(){return '+J(day)+';}');},
    drag:async(el,day,extra)=>{
      T.dropOn(day);T.down(el,100,100,extra);T.move(120,120,extra);T.move(150,150,extra);T.up(150,150,extra);await settle();
    }
  };
  return T;
}
const ev=(k,tgt,extra)=>Object.assign({key:k,target:tgt||{tagName:'DIV'},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}},extra||{});
const nWrites=T=>T.writes().length;
const rootsOf=T=>T.writes().map(w=>w.path.split('/')[0]);

async function checks(src){
  const o={};
  // a block that throws is reported as a failing check of its own (and, under a deliberate break, leaves its later checks unset = failing)
  const blk=async(n,fn)=>{try{await fn();}catch(e){o['block '+n+' ran without throwing ('+String(e&&e.message||e).slice(0,70)+')']=false;}};
  const S=(over)=>Object.assign({dailyCapacity:400,skipDays:['2026-10-16'],offWeekdays:[0]},over||{});

  /* ═══ pure ═══ */
  await blk(1,async()=>{
    const T=load(src);
    const R=c=>T.R(c);
    o['pure: phcRange month is whole Monday-start weeks (Oct 2026: 29 Sep .. 1 Nov, 5 weeks)']=R('JSON.stringify(phcRange("month","2026-10-12").days.slice(0,1).concat(phcRange("month","2026-10-12").days.slice(-1)))')===J(['2026-09-28','2026-11-01'])&&R('phcRange("month","2026-10-12").days.length')===35&&R('phcRange("month","2026-10-12").month')==='2026-10';
    o['pure: phcRange week starts Monday and has 7 days (any day of the week gives the same Monday)']=R('phcRange("week","2026-10-18").from')==='2026-10-12'&&R('phcRange("week","2026-10-14").days.length')===7&&R('phcRange("week","2026-10-14").days[6]')==='2026-10-18';
    o['pure: phcRange with junk gives no days, never a throw']=R('phcRange("month","nope").days.length')===0;
    o['pure: phcMonthAdd crosses a year']=R('phcMonthAdd("2026-12-15",1)')==='2027-01-01'&&R('phcMonthAdd("2026-01-31",-1)')==='2025-12-01';
    o['pure: labels are PKT-day strings, no Date parsing (Mon 12 Oct)']=R('phcDayLabel("2026-10-12",true)')==='Mon 12 Oct'&&R('phcDayLabel("2026-10-12")')==='12 Oct'&&R('phcMonthLabel("2026-10-12")')==='October 2026';
    o['pure: phcCheckDay refuses a skip day by name']=(()=>{const r=JSON.parse(R('JSON.stringify(phcCheckDay("2026-10-16",'+J(S())+',"'+TODAY+'"))'));return r.ok===false&&/skip day/.test(r.why)&&/Fri 16 Oct/.test(r.why);})();
    o['pure: phcCheckDay refuses a weekly off day (Sunday) by name']=(()=>{const r=JSON.parse(R('JSON.stringify(phcCheckDay("2026-10-18",'+J(S())+',"'+TODAY+'"))'));return r.ok===false&&/weekly off day/.test(r.why)&&/Sundays/.test(r.why);})();
    o['pure: phcCheckDay refuses a day before today']=(()=>{const r=JSON.parse(R('JSON.stringify(phcCheckDay("2026-10-09",'+J(S())+',"'+TODAY+'"))'));return r.ok===false&&/before today/.test(r.why);})();
    o['pure: phcCheckDay accepts a working day, today included']=R('phcCheckDay("2026-10-13",'+J(S())+',"'+TODAY+'").ok')===true&&R('phcCheckDay("'+TODAY+'",'+J(S())+',"'+TODAY+'").ok')===true;
    o['pure: phcLockReason: done and overridden are fixed, an already-cut PO is fixed, an open job is not']=
      /Done/.test(R('phcLockReason({status:"done"},null)'))&&/Overridden/.test(R('phcLockReason({status:"overridden"},null)'))&&/only an owner/.test(R('phcLockReason({status:"overridden"},null,false)'))&&R('phcLockReason({status:"overridden"},null,true)')===null&&/Already cut/.test(R('phcLockReason({status:"open"},{currentStage:"bundling"})'))&&R('phcLockReason({status:"open"},{currentStage:"cutting"})')===null&&R('phcLockReason({status:"complete"},null)')===null;
    const base={canManage:true,jobsOk:true,settings:{known:true,failed:false,settings:S()},job:{status:'open',rev:2,plannedCutDate:'2026-10-14'},po:{currentStage:'cutting',poStatus:'in_production'},poId:'PO-103',to:'2026-10-15',today:TODAY};
    const plan=m=>JSON.parse(R('JSON.stringify(phcPlanMove('+J(Object.assign({},base,m))+'))'));
    o['pure: phcPlanMove accepts a normal move and carries the revision']=(()=>{const r=plan({});return r.ok===true&&r.from==='2026-10-14'&&r.to==='2026-10-15'&&r.create===false&&r.rev===2;})();
    o['pure: a view-only person is refused']=plan({canManage:false}).ok===false&&/View only/.test(plan({canManage:false}).why);
    o['pure: unreadable jobs refuse']=plan({jobsOk:false}).ok===false&&/could not be read/.test(plan({jobsOk:false}).why);
    o['pure: unreadable settings refuse (skip days unknown)']=plan({settings:{known:false,failed:true,settings:S()}}).ok===false&&/settings could not be read/.test(plan({settings:{known:false,failed:true,settings:S()}}).why);
    o['pure: a done job is refused']=/Done/.test(plan({job:{status:'done',rev:1,plannedCutDate:'2026-10-14'}}).why||'');
    o['pure: an overridden job is refused (for a non-owner)']=/Overridden/.test(plan({job:{status:'overridden',rev:1,plannedCutDate:'2026-10-14'}}).why||'');
    o['pure: an overridden job is movable by an OWNER (the writer table: overridden -> overridden is an owner step)']=plan({isOwner:true,job:{status:'overridden',rev:1,plannedCutDate:'2026-10-14'}}).ok===true;
    o['pure: an already-cut PO is refused']=/Already cut/.test(plan({po:{currentStage:'stitching',poStatus:'in_production'}}).why||'');
    o['pure: a skip day, an off day and a past day are refused']=[ '2026-10-16','2026-10-18','2026-10-09'].every(d=>plan({to:d}).ok===false);
    o['pure: the same day is a "same" no-op, not an error write']=(()=>{const r=plan({to:'2026-10-14'});return r.ok===false&&r.same===true;})();
    o['pure: planning a PO with no job: a reserved PO and a cut PO are refused, a released one is a create']=
      plan({job:null,po:{poStatus:'reserved',currentStage:null}}).ok===false&&plan({job:null,po:{currentStage:'bundling'}}).ok===false&&(()=>{const r=plan({job:null});return r.ok===true&&r.create===true&&r.rev===undefined&&r.from===null;})();
    o['pure: planning a PO that is not loaded (no job) is refused']=plan({job:null,po:null}).ok===false;
    o['pure: junk date and junk PO id are refused']=plan({to:'12/10/2026'}).ok===false&&plan({poId:'../pos/PO-1'}).ok===false;
    // the model
    const jobs=[{fbKey:'PO-A01',plannedCutDate:'2026-10-12',status:'open',masterName:'Hassan'},{fbKey:'PO-A02',plannedCutDate:'2026-10-12',status:'open'},{fbKey:'PO-A03',plannedCutDate:'2026-10-18',status:'open'},{fbKey:'PO-A04',plannedCutDate:'2026-10-13',status:'open'}];
    const pos=[{fbKey:'PO-A01',qty:700,currentStage:'cutting',poStatus:'in_production'},{fbKey:'PO-A02',qty:300,currentStage:'cutting',poStatus:'in_production'},{fbKey:'PO-A03',qty:50,currentStage:'cutting',poStatus:'in_production'}];
    const model=JSON.parse(R('JSON.stringify((()=>{const m=phcBuildModel({jobs:'+J(jobs)+',pos:'+J(pos)+',S:'+J(S())+',capKnown:true,today:"'+TODAY+'"});return{over:phcDayInfo(m,'+J(S())+',"2026-10-12"),ok:phcDayInfo(m,'+J(S())+',"2026-10-13"),sun:phcDayInfo(m,'+J(S())+',"2026-10-18"),fri:phcDayInfo(m,'+J(S())+',"2026-10-16"),spill:m.chips.map(c=>[c.poId,c.spill]),unk:m.chips.filter(c=>c.units===null).length};})())'));
    o['model: a day planned past the capacity is flagged over, with the excess']=model.over.planned===1000&&model.over.cap===400&&model.over.over===true&&model.over.overBy===600;
    o['model: a job whose PO is not loaded has no quantity and is COUNTED, not added as 0']=model.ok.planned===0&&model.ok.unknown===1&&model.ok.over===false&&model.unk===1;
    o['model: a Sunday is an off day, a listed day is a skip day (reasons in words)']=model.sun.work===false&&/Off \(Sunday\)/.test(model.sun.why)&&model.fri.work===false&&model.fri.why==='Skip day';
    o['model: phAllocate says where the spill goes (finish day and working days)']=/Over capacity: finishes Tue 13 Oct \(\+1 working day\)/.test((model.spill.filter(x=>x[0]==='PO-A01')[0]||[])[1]||'');
    const noCap=JSON.parse(R('JSON.stringify((()=>{const m=phcBuildModel({jobs:'+J(jobs)+',pos:'+J(pos)+',S:'+J(S())+',capKnown:false,today:"'+TODAY+'"});const i=phcDayInfo(m,'+J(S())+',"2026-10-12");return{cap:i.cap,over:i.over,alloc:m.alloc};})())'));
    o['model: with the capacity unknown there is no capacity, no over flag and no allocation']=noCap.cap===null&&noCap.over===false&&noCap.alloc===null;
    const trayM=JSON.parse(R('JSON.stringify(phcBuildModel({jobs:[{fbKey:"PO-502",plannedCutDate:null,status:"open"},{fbKey:"PO-505",plannedCutDate:null,status:"done"}],pos:[{fbKey:"PO-501",currentStage:"cutting",poStatus:"in_production",qty:5},{fbKey:"PO-502",currentStage:"cutting",poStatus:"in_production",qty:5},{fbKey:"PO-503",poStatus:"reserved",currentStage:null,qty:5},{fbKey:"PO-504",currentStage:"qc",poStatus:"in_production",qty:5},{fbKey:"PO-505",currentStage:"cutting",poStatus:"in_production",qty:5},{fbKey:"PO-506",poStatus:"cancelled",currentStage:null,qty:5}],S:'+J(S())+',capKnown:true,today:"'+TODAY+'"}).tray.map(t=>t.poId))'));
    o['model: the tray is released POs still at cutting with no date (reserved, cut, done and cancelled are never in it; a job with a null date still is)']=J(trayM)===J(['PO-501','PO-502']);
  });

  /* ═══ the screen ═══ */
  await blk(2,async()=>{
    const T=load(src);await T.open();
    const days=T.cells().map(c=>c.getAttribute('data-phc-day'));
    o['screen: the month view draws Monday-start weeks (35 cells, 28 Sep to 1 Nov)']=days.length===35&&days[0]==='2026-09-28'&&days[34]==='2026-11-01';
    o['screen: each PO sits on its planned day (PO-101, PO-102 on 12 Oct, PO-103 on 14 Oct, PO-105 on 15 Oct)']=T.dayOf('PO-101')==='2026-10-12'&&T.dayOf('PO-102')==='2026-10-12'&&T.dayOf('PO-103')==='2026-10-14'&&T.dayOf('PO-105')==='2026-10-15';
    const ct=T.text(T.chip('PO-101'));
    o['screen: a chip shows the PO number, the article, the quantity and the master']=/PO-101/.test(ct)&&/Effortless Tee/.test(ct)&&/700 pcs/.test(ct)&&/Hassan/.test(ct);
    o['screen: a cancelled PO\'s job is not drawn, and the page says how many were left out']=T.chip('PO-109')===null&&/1 planned job belongs to cancelled POs/.test(T.text(T.panel()));
    const over=T.cell('2026-10-12');
    o['screen: an over-capacity day is flagged with TEXT and a glyph, not colour only']=/over/.test(over.className)&&/▲ Over capacity by 600/.test(T.text(over))&&/1000 \/ 400 pcs/.test(T.text(over));
    o['screen: a day within capacity carries no over flag']=!/over/.test(T.cell('2026-10-14').className)&&!/Over capacity/.test(T.text(T.cell('2026-10-14')));
    o['screen: the skip day and the Sunday say so in words']=/Skip day/.test(T.text(T.cell('2026-10-16')))&&/\boff\b/.test(T.cell('2026-10-16').className)&&/Off \(Sunday\)/.test(T.text(T.cell('2026-10-18')));
    o['screen: today is marked']=/Today/.test(T.text(T.cell(TODAY)))&&/\btoday\b/.test(T.cell(TODAY).className);
    o['screen: a spilling chip says so (the allocation, not just the load)']=/Spills/.test(T.text(T.chip('PO-102')))&&/Over capacity: finishes Wed 14 Oct \(\+2 working days\)/.test(T.chip('PO-102').getAttribute('title')||'');
    o['screen: a locked chip says Locked, with the reason in its label']=/Locked/.test(T.text(T.chip('PO-104')))&&/Done/.test(T.chip('PO-104').getAttribute('aria-label')||'')&&T.chip('PO-104').getAttribute('aria-disabled')==='true'&&!/Locked/.test(T.text(T.chip('PO-105')))&&/Locked/.test(T.text(T.chip('PO-108')));
    {const MM=load(src,{session:USERS.mustafa});await MM.open();o['screen: an OVERRIDDEN chip says Locked for Mustafa (a manager, not an owner) but not for an owner']=/Locked/.test(T.text(MM.chip('PO-105')))&&/only an owner/.test(MM.chip('PO-105').getAttribute('aria-label')||'')&&MM.chip('PO-105').getAttribute('aria-disabled')==='true';}
    const trayIds=T.R('JSON.stringify(_phcLast.tray.map(t=>t.poId))');
    o['screen: the tray is PO-106 and PO-110 only (reserved PO-107, bundling PO-108, cancelled PO-109 and the planned ones are not)']=trayIds===J(['PO-106','PO-110'])&&!!T.tray('PO-106')&&!!T.tray('PO-110')&&!T.tray('PO-107')&&!T.tray('PO-101');
    o['screen: the tray says reserved POs are not listed and counts its items']=/Not planned yet \(2\)/.test(T.text(T.panel()))&&/Reserved POs are not listed/.test(T.text(T.panel()));
    const today=T.text(T.panel());
    o['screen: today\'s list holds today\'s planned jobs with a link to Today\'s Cutting']=/Today in cutting · Mon 12 Oct/.test(today)&&dd(T,'phc-today-row').length===2&&/Open Today's Cutting/.test(today);
    const link=T.dom.all(T.panel(),n=>/Open Today's Cutting/.test(n.textContent)&&n.tagName==='BUTTON')[0];
    T.dom.click(link);
    o['screen: the link switches to the Today\'s Cutting tab through the shell\'s tab API']=T.R('_phUiTab')==='cutting';
    // week view
    await T.open('calendar');
    T.dom.click(T.dom.all(T.panel(),n=>n.tagName==='BUTTON'&&n.textContent==='Week')[0]);
    o['screen: Week shows 7 days Monday to Sunday of the anchor week']=T.cells().length===7&&T.cells()[0].getAttribute('data-phc-day')==='2026-10-12'&&T.cells()[6].getAttribute('data-phc-day')==='2026-10-18';
    T.dom.click(T.dom.all(T.panel(),n=>n.tagName==='BUTTON'&&n.getAttribute('aria-label')==='Next week')[0]);
    o['screen: Next week moves 7 days; Today returns']=T.cells()[0].getAttribute('data-phc-day')==='2026-10-19'&&(T.dom.click(T.dom.all(T.panel(),n=>n.tagName==='BUTTON'&&n.textContent==='Today')[0]),T.cells()[0].getAttribute('data-phc-day')==='2026-10-12');
    T.dom.click(T.dom.all(T.panel(),n=>n.tagName==='BUTTON'&&n.textContent==='Month')[0]);
    o['screen: a month cell with more than 3 jobs folds the rest into "+N more" that opens the week']=(()=>{
      const T2=load(src,{mutate:st=>{['PO-111','PO-112','PO-113','PO-114'].forEach((id,i)=>{st['pos/'+id]={id,name:'X'+i,code:'X',qty:10,poStatus:'in_production',currentStage:'cutting'};st['po_cut_jobs/'+id]={poId:id,status:'open',rev:1,plannedCutDate:'2026-10-13',masterName:''};});}});
      return T2.open().then(()=>{const more=T2.dom.all(T2.panel(),n=>n.tagName==='BUTTON'&&/more$/.test(n.textContent))[0];if(!more)return false;T2.dom.click(more);return T2.cells().length===7&&T2.cells()[1].getAttribute('data-phc-day')==='2026-10-13'&&T2.chips('PO-114').length>=1;});
    })();
    o['screen: a month cell with more than 3 jobs folds the rest into "+N more" that opens the week']=await o['screen: a month cell with more than 3 jobs folds the rest into "+N more" that opens the week'];
  });

  /* ═══ honest states ═══ */
  await blk(3,async()=>{
    const T=load(src,{fail:{po_cut_jobs:1}});await T.open();
    o['failed: unreadable cutting jobs draw NO grid and NO empty calendar']=T.cells().length===0&&T.chips('PO-101').length===0;
    o['failed: the card names po_cut_jobs and says why nothing is drawn, with Retry']=/The calendar cannot be drawn/.test(T.text(T.panel()))&&/po_cut_jobs/.test(T.text(T.panel()))&&/nothing is planned/.test(T.text(T.panel()))&&T.dom.all(T.panel(),n=>n.tagName==='BUTTON'&&n.textContent==='Retry').length>=1;
    const S2=load(src,{fail:{'ph_settings/main':1}});await S2.open();
    o['settings failed: the jobs are still drawn but nothing is compared with a capacity']=S2.chip('PO-101')!==null&&!/Over capacity/.test(S2.text(S2.panel()))&&/Capacity and skip days unknown/.test(S2.text(S2.panel()))&&/ph_settings/.test(S2.text(S2.panel()));
    S2.dropOn('2026-10-15');S2.down(S2.chip('PO-103'),100,100);S2.move(130,130);S2.up(130,130);await settle();
    o['settings failed: a drop is refused with the reason and nothing is written']=nWrites(S2)===0&&/settings could not be read/.test(S2.msg());
    const P=load(src,{noPOs:true});await P.open();
    o['POs not loaded: the tray says so (not "nothing to plan") and offers a reload']=/No POs are loaded on this device/.test(P.text(P.panel()))&&!/Every released PO/.test(P.text(P.panel()))&&/Not planned yet \(\?\)/.test(P.text(P.panel()))&&P.dom.all(P.panel(),n=>n.tagName==='BUTTON'&&n.textContent==='Reload POs').length===1;
    o['POs not loaded: a chip still shows its PO number and says the PO is not loaded, with the quantity unknown']=/PO-101/.test(P.text(P.chip('PO-101')))&&/PO not loaded/.test(P.text(P.chip('PO-101')))&&/qty \?/.test(P.text(P.chip('PO-101')));
    P.dom.click(P.dom.all(P.panel(),n=>n.textContent==='Reload POs')[0]);
    o['POs not loaded: Reload POs calls the app\'s own loader']=P.fk.log.reloaded===1;
  });

  /* ═══ the drag, end to end ═══ */
  await blk(4,async()=>{
    const T=load(src);await T.open();
    const chip=T.chip('PO-103');
    const spy={cap:0,rel:0};chip.setPointerCapture=()=>{spy.cap++;};chip.releasePointerCapture=()=>{spy.rel++;};
    const before=T.nListeners('pointermove');
    T.dropOn('2026-10-15');
    T.down(chip,100,100);
    o['drag: pointerdown alone registers the document-level tracking (and captures nothing yet)']=T.nListeners('pointermove')===before+1&&T.nListeners('pointerup')>=1&&T.nListeners('pointercancel')>=1&&spy.cap===0;
    T.move(102,101);T.move(103,102);
    o['drag: a 3px move is still a click: no ghost, no capture, no body class, no hover']=spy.cap===0&&T.dom.byClass(T.dom.body,'phc-ghost').length===0&&!T.dom.body.classList.contains('phc-dragging')&&!/drop-ok|drop-bad/.test(T.cell('2026-10-15').className);
    T.move(120,120);
    o['drag: past 4px it drags: the pointer is captured NOW, a ghost follows it, the chip dims']=spy.cap===1&&T.dom.byClass(T.dom.body,'phc-ghost').length===1&&T.dom.body.classList.contains('phc-dragging')&&/dragging/.test(chip.className);
    o['drag: the ghost carries the PO and its pieces, as text']=T.text(T.dom.byClass(T.dom.body,'phc-ghost')[0])==='PO-103 · 150 pcs';
    o['drag: the day under the pointer shows it will accept (drop-ok class and a message in words)']=/drop-ok/.test(T.cell('2026-10-15').className)&&/Drop to move PO-103 on Thu 15 Oct/.test(T.msg());
    o['drag: the ghost is positioned from the pointer']=T.dom.byClass(T.dom.body,'phc-ghost')[0].style.left==='132px';
    T.up(120,120);
    T.dom.click(chip);                      // the click a browser fires right after the pointerup that ends a drag
    o['drop: the click that ends a drag opens nothing (the suppressor)']=T.dialog()===null;
    await settle();
    const w=T.writes();
    o['drop: ONE transaction wrote po_cut_jobs/PO-103 and its pos/PO-103/history row — both in it']=w.length===2&&w.every(x=>x.tx===1)&&w[0].path==='po_cut_jobs/PO-103'&&w[0].op==='update'&&w[0].data.plannedCutDate==='2026-10-15'&&/^pos\/PO-103\/history\/\d{13}-/.test(w[1].path)&&w[1].op==='set';
    o['drop: the pos document itself is never written (only the new collection and the history sub-collection)']=!w.some(x=>x.path==='pos/PO-103')&&rootsOf(T).every(r=>r==='po_cut_jobs'||r==='pos')&&w.filter(x=>x.path.split('/')[0]==='pos').every(x=>x.path.split('/')[2]==='history');
    o['drop: the revision moved by one and the history row names the move']=w[0].data.rev===2&&/Calendar: planned cut date 2026-10-14 -> 2026-10-15/.test(w[1].data.reason)&&w[1].data.type==='cut_job_updated';
    o['drop: the chip is now on the new day and the ghost and the tracking are gone']=T.dayOf('PO-103')==='2026-10-15'&&T.dom.byClass(T.dom.body,'phc-ghost').length===0&&!T.dom.body.classList.contains('phc-dragging')&&T.nListeners('pointermove')===before&&spy.rel===1;
    o['drop: the message says what happened, in words with a tick']=/^✓ PO-103 moved to Thu 15 Oct \(was Wed 14 Oct\)\./.test(T.msg());
    T.dom.click(T.chip('PO-103'));
    o['drop: a later click does open the menu again']=T.dialog()!==null;
  });
  // a plain click (no move) opens the menu
  await blk(5,async()=>{
    const T=load(src);await T.open();
    const chip=T.chip('PO-103');
    T.down(chip,100,100);T.up(100,100);T.dom.click(chip);
    o['click: a press that never moved opens the Move menu, no write']=T.dialog()!==null&&nWrites(T)===0&&T.nListeners('pointermove')===0;
    o['click: the dialog is a modal dialog with a labelled title and a date field holding the current day']=T.dialog().getAttribute('role')==='dialog'&&T.dialog().getAttribute('aria-modal')==='true'&&/Move PO-103/.test(T.text(T.dialog()))&&T.dlgInput().value==='2026-10-14'&&T.dlgInput().getAttribute('type')==='date';
  });
  // refusals on drop
  await blk(6,async()=>{
    const refuse=async(label,id,day,re,opts)=>{
      const T=load(src,opts);await T.open();
      const el=id.indexOf('tray:')===0?T.tray(id.slice(5)):T.chip(id);
      await T.drag(el,day);
      return nWrites(T)===0&&re.test(T.msg())&&T.dialog()===null;
    };
    o['refuse: dropping on the skip day writes nothing and says why']=await refuse('skip','PO-103','2026-10-16',/skip day/);
    o['refuse: dropping on a Sunday (weekly off day) writes nothing and says why']=await refuse('off','PO-103','2026-10-18',/weekly off day/);
    o['refuse: dropping on a day before today writes nothing and says why']=await refuse('past','PO-103','2026-10-09',/before today/);
    o['refuse: the same day is a no-op with a plain message']=await refuse('same','PO-103','2026-10-14',/already planned/);
    o['refuse: a tray PO dropped on a skip day is refused too']=await refuse('tray skip','tray:PO-106','2026-10-16',/skip day/);
    const D=load(src,{session:USERS.mustafa});await D.open();
    D.down(D.chip('PO-104'),100,100);D.move(150,150);
    o['refuse: a DONE job cannot even start a drag (no tracking, no ghost)']=D.nListeners('pointermove')===0&&D.dom.byClass(D.dom.body,'phc-ghost').length===0;
    D.up(150,150);D.dom.click(D.chip('PO-104'));
    o['refuse: pressing a done chip explains it and opens no menu']=/Done: the cut is recorded/.test(D.msg())&&D.dialog()===null&&nWrites(D)===0;
    D.dom.click(D.chip('PO-105'));
    o['refuse: an OVERRIDDEN job is fixed for a non-owner manager (the UI says only an owner can)']=/Overridden by an owner: only an owner/.test(D.msg())&&D.dialog()===null;
    D.dom.click(D.chip('PO-108'));
    o['refuse: a PO that is already cut (bundling) is fixed']=/Already cut/.test(D.msg());
    // the same refusals reach the writer-side path through _phcApply too
    const A=load(src,{session:USERS.mustafa});await A.open();
    const r1=await A.R('_phcApply("PO-104","2026-10-20")');
    const r2=await A.R('_phcApply("PO-105","2026-10-20")');
    o['refuse: _phcApply itself refuses done, and overridden for a non-owner (no write)']=r1.ok===false&&r2.ok===false&&nWrites(A)===0;
    // even if the screen's lock were bypassed, the WRITER refuses a non-owner on an overridden job (PH_JOB_TRANSITIONS), with a reason that agrees with the screen
    const w=await A.R('phSaveCutJob("PO-105",{plannedCutDate:"2026-10-20"},{})');
    o['refuse: the writer itself refuses Mustafa on an overridden job (forbidden, only an owner), nothing written']=w.ok===false&&w.code==='forbidden'&&/Only an owner/.test(w.error||'')&&nWrites(A)===0;
    // an OWNER may move it: screen and writer agree
    const O=load(src,{session:USERS.afnan});await O.open();
    const ro=await O.R('_phcApply("PO-105","2026-10-20")');
    o['owner: an owner CAN move an overridden job (screen and writer agree): the job and its history row are written']=ro.ok===true&&nWrites(O)===2&&O.writes()[0].data.status===undefined&&O.writes()[0].data.plannedCutDate==='2026-10-20';
    const rd=await O.R('_phcApply("PO-104","2026-10-21")');
    o['owner: a DONE job is still fixed for an owner (terminal)']=rd.ok===false&&nWrites(O)===2;
    // stale revision
    const St=load(src);await St.open();
    St.fk.store['po_cut_jobs/PO-103'].rev=5;
    await St.drag(St.chip('PO-103'),'2026-10-15');
    o['refuse: a job changed by someone else since the page loaded is refused (stale revision), nothing written']=nWrites(St)===0&&/changed by someone else/.test(St.msg());
    // done on the server but open on this page
    const Dn=load(src);await Dn.open();
    Dn.fk.store['po_cut_jobs/PO-103'].status='done';
    Dn.fk.store['po_cut_jobs/PO-103'].rev=2;
    await Dn.drag(Dn.chip('PO-103'),'2026-10-15');
    o['refuse: a job that became done on the server is refused by the writer, nothing written']=nWrites(Dn)===0&&/✕/.test(Dn.msg());
  });
  // tray plan = create
  await blk(7,async()=>{
    const T=load(src);await T.open();
    await T.drag(T.tray('PO-106'),'2026-10-13');
    const w=T.writes();
    o['tray: dropping a tray PO on a day PLANS it: a created po_cut_jobs doc (open, dated) + its history row in one transaction']=w.length===2&&w[0].tx===w[1].tx&&w[0].path==='po_cut_jobs/PO-106'&&w[0].op==='set'&&w[0].data.status==='open'&&w[0].data.plannedCutDate==='2026-10-13'&&w[0].data.rev===1&&w[1].data.type==='cut_job_opened';
    o['tray: the PO leaves the tray and appears on the day; the message says planned']=T.tray('PO-106')===null&&T.dayOf('PO-106')==='2026-10-13'&&/PO-106 planned for Tue 13 Oct/.test(T.msg());
    const R2=load(src);await R2.open();
    o['tray: a reserved PO is refused by the plan even if asked for directly']=(await R2.R('_phcApply("PO-107","2026-10-13")')).ok===false&&nWrites(R2)===0;
    // dropping into an over-full day warns but still plans
    const O=load(src);await O.open();
    await O.drag(O.tray('PO-106'),'2026-10-12');
    o['tray: dropping on an over-full day still plans it and warns that the excess spills']=nWrites(O)===2&&/over capacity/.test(O.msg())&&/spills/.test(O.msg());
  });
  // lost drags
  await blk(8,async()=>{
    const T=load(src);await T.open();
    const chip=T.chip('PO-103');T.dropOn('2026-10-15');
    T.down(chip,100,100);T.move(140,140);
    T.move(150,150,{pointerId:2});
    o['end: a move by a second finger (another pointerId) is ignored']=T.dom.byClass(T.dom.body,'phc-ghost')[0].style.left==='152px';
    T.up(150,150,{pointerId:2});
    o['end: a pointerup by another pointer does not drop']=nWrites(T)===0&&T.dom.byClass(T.dom.body,'phc-ghost').length===1;
    T.docL('pointercancel',{pointerId:1});await settle();
    o['end: pointercancel ends the drag: ghost gone, tracking gone, nothing written']=T.dom.byClass(T.dom.body,'phc-ghost').length===0&&T.nListeners('pointermove')===0&&nWrites(T)===0&&/Move cancelled/.test(T.msg());
    T.down(chip,100,100);T.move(140,140);
    T.move(145,145,{buttons:0});
    o['end: a move with no button held (the release was lost) ends the drag']=T.dom.byClass(T.dom.body,'phc-ghost').length===0&&T.nListeners('pointermove')===0&&nWrites(T)===0;
    T.down(chip,100,100);T.move(140,140);
    T.keys(ev('Escape'));
    o['end: Escape cancels the drag and does NOT leave the page']=T.dom.byClass(T.dom.body,'phc-ghost').length===0&&T.nListeners('pointermove')===0&&nWrites(T)===0&&T.dom.body.classList.contains('ph-fullscreen')&&T.ctx.currentPage==='prod-ops';
    T.dropOn(null);
    T.down(chip,100,100);T.move(140,140);T.up(140,140);await settle();
    o['end: a drop outside every day writes nothing and says so']=nWrites(T)===0&&/outside the calendar/.test(T.msg());
    // a second press while one is in flight
    T.down(chip,100,100);const n1=T.nListeners('pointermove');T.down(chip,100,100);
    o['end: a second pointerdown while one drag is live registers nothing more']=T.nListeners('pointermove')===n1;
    T.docL('pointercancel',{pointerId:1});
    // right button
    T.down(chip,100,100,{button:2});
    o['end: a right-button press never starts a drag']=T.nListeners('pointermove')===0;
  });
  // touch / phone
  await blk(9,async()=>{
    const T=load(src);await T.open();
    T.down(T.chip('PO-103'),100,100,{pointerType:'touch'});T.move(160,160);
    o['touch: a touch press never starts a drag (a tap opens the menu instead)']=T.nListeners('pointermove')===0&&T.dom.byClass(T.dom.body,'phc-ghost').length===0;
    T.dom.click(T.chip('PO-103'));
    o['touch: the tap opens the Move menu']=T.dialog()!==null;
    const P=load(src,{phone:true});await P.open();
    o['phone: the calendar is a week list (7 days), there is no month grid and no Month/Week toggle']=P.cells().length===7&&P.dom.all(P.panel(),n=>n.tagName==='BUTTON'&&n.textContent==='Month').length===0;
    P.dom.click(P.dom.all(P.panel(),n=>n.getAttribute&&n.getAttribute('aria-label')==='Next week')[0]);
    o['phone: the week list navigates by weeks']=P.cells()[0].getAttribute('data-phc-day')==='2026-10-19';
  });

  /* ═══ the Move to… menu ═══ */
  await blk(10,async()=>{
    const T=load(src);await T.open();
    T.dom.click(T.chip('PO-103'));
    o['menu: opening it focuses the date field']=T.ctx.document.activeElement===T.dlgInput();
    T.dlgInput().value='2026-10-16';T.dom.dispatch(T.dlgInput(),'input');
    o['menu: choosing a skip day shows the refusal live, before anything is pressed']=/skip day/.test(T.text(dd(T,'phc-hint')[0]))&&/bad/.test(dd(T,'phc-hint')[0].className);
    T.dom.click(T.dlgGo());await settle();
    o['menu: pressing Move on a skip day writes nothing and keeps the menu open with the reason']=nWrites(T)===0&&T.dialog()!==null&&/skip day/.test(T.text(dd(T,'phc-hint')[0]));
    T.dlgInput().value='2026-10-21';T.dom.dispatch(T.dlgInput(),'change');
    o['menu: a good day reads "Will be moved to ..."']=/Will be moved to Wed 21 Oct/.test(T.text(dd(T,'phc-hint')[0]));
    T.dom.click(T.dlgGo());await settle();
    const w=T.writes();
    o['menu: Move writes the same ONE transaction and closes the menu']=w.length===2&&w[0].tx===w[1].tx&&w[0].path==='po_cut_jobs/PO-103'&&w[0].data.plannedCutDate==='2026-10-21'&&T.dialog()===null&&T.dayOf('PO-103')==='2026-10-21';
    // plan from the tray via the menu
    const P=load(src);await P.open();
    P.dom.click(P.tray('PO-106'));
    o['menu: a tray item opens "Plan PO-106" with the next working day as default']=/Plan PO-106/.test(P.text(P.dialog()))&&P.dlgInput().value===TODAY;
    // Enter / Escape in the dialog
    P.dlgInput().value='2026-10-22';P.dom.dispatch(P.dlgInput(),'input');
    P.dom.dispatch(P.dialog(),'keydown',ev('Enter',P.dlgInput()));await settle();
    o['menu: Enter in the date field confirms']=P.writes().length===2&&P.writes()[0].path==='po_cut_jobs/PO-106';
    const E=load(src);await E.open();
    E.dom.click(E.chip('PO-103'));
    E.dom.dispatch(E.dialog(),'keydown',ev('Escape',E.dlgInput()));
    o['menu: Escape in the dialog closes it and writes nothing']=E.dialog()===null&&nWrites(E)===0;
    E.dom.click(E.chip('PO-103'));
    E.keys(ev('Escape'));
    o['menu: the shell\'s Escape closes the dialog first and does not leave the page']=E.dialog()===null&&E.dom.body.classList.contains('ph-fullscreen');
    E.dom.click(E.chip('PO-103'));
    E.dom.dispatch(E.dialog().parentNode,'click',{target:E.dialog().parentNode});
    o['menu: pressing the backdrop closes it']=E.dialog()===null;
    // view-only (a read-only context)
    const V=load(src);await V.open();
    const r=V.R('(function(){const c=_phUiCtx(phResolveTab("calendar"));c.canManage=false;c.readOnly=true;const h=phEl("div","x");phcRender(h,c);return h;})()');
    const rv=await V.R('_phcApply("PO-103","2026-10-20")');
    o['view-only: _phcApply refuses with no write']=rv.ok===false&&nWrites(V)===0&&/View only/.test(rv.why||'');
    const vc=V.dom.all(r,n=>n.getAttribute&&n.getAttribute('data-phc-po')==='PO-103')[0];
    V.down(vc,100,100);V.move(150,150);
    o['view-only: the chip does not drag, the screen says View only']=V.nListeners('pointermove')===0&&/View only/.test(r.textContent);
  });

  /* ═══ XSS, audience, source ═══ */
  await blk(11,async()=>{
    const T=load(src);await T.open();
    const html=domkit.toHtml(T.panel());
    o['xss: a hostile article name reaches the page as escaped text, never as a tag']=/&lt;img src=x onerror=alert\(1\)&gt;/.test(html)&&!/<img/.test(html)&&T.text(T.tray('PO-110')).indexOf(HOSTILE)>-1;
    const badSrc=/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|new DOMParser|document\.write|\beval\(/.test(SRC_STRIP(src));
    o['xss: the source never assigns innerHTML/outerHTML or parses a string as HTML']=!badSrc;
    const U=load(src,{session:USERS.uzaib});await U.open('overview');
    o['audience: Uzaib has no Calendar tab and cannot go there']=U.R('phTabsFor().some(t=>t.id==="calendar")')===false&&U.ctx.phGoTab('calendar')===false;
    const Ra=load(src,{session:USERS.raees});
    o['audience: Raees has no tabs at all']=Ra.R('phTabsFor().length')===0;
    const M=load(src,{session:USERS.mustafa});await M.open();
    o['audience: Mustafa (a manager) gets the calendar and can plan']=M.cells().length===35;
    await M.drag(M.chip('PO-103'),'2026-10-15');
    o['audience: a manager\'s drop writes (his name is the actor)']=M.writes().length===2&&M.writes()[0].data.updatedBy==='mustafa';
    const code=SRC_STRIP(src);
    o['source: the only ph-write function called is phSaveCutJob']=!/\bphSaveDraft|phMarkDraftReady|phSendBackDraft|phAbandonDraft|phAppendHistory|phMasterAdd|phMasterRename|phMasterSetActive|phStandardSave|phSettingsSave\b/.test(code)&&/phSaveCutJob\(/.test(code);
    o['source: no Firestore write API or transaction is used directly']=!/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(code);
    o['source: days are PKT (never toISOString/getDate/new Date for a day)']=!/toISOString|getUTCDate|getDate\(\)|new Date\(/.test(code);
  });
  return o;
}
function dd(T,cls){return T.dom.byClass(T.panel(),cls);}
function SRC_STRIP(s){return s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');}

async function wiring(s){
  const html=read('index.html'),sw=read('sw.js');
  const tag=f=>html.indexOf('/js/'+f+'?v=');
  s.section('wiring and the stylesheet');
  s.ok('the script tag follows ph-ui.js and precedes the Firebase module',tag('ph-mod-calendar.js')>tag('ph-ui.js')&&tag('ph-ui.js')>0&&html.indexOf('<script type="module">')>tag('ph-mod-calendar.js'));
  s.ok('it is precached, after ph-ui.js',/'\/js\/ph-mod-calendar\.js'/.test(sw)&&sw.indexOf("'/js/ph-mod-calendar.js'")>sw.indexOf("'/js/ph-ui.js'"));
  const a=CSS.indexOf('/* ph-mod-calendar START */'),b=CSS.indexOf('/* ph-mod-calendar END */');
  s.ok('the CSS block exists, delimited, and sits in the trailing run of ph-mod-* blocks at the END of the stylesheet',a>0&&b>a&&CSS.slice(b+'/* ph-mod-calendar END */'.length).replace(/\/\* ph-mod-[a-z]+ START \*\/[\s\S]*?\/\* ph-mod-[a-z]+ END \*\//g,'').trim()==='');
  const css=CSS.slice(a,b).replace(/\/\*[\s\S]*?\*\//g,'');
  s.ok('tokens only: no literal colour in the block',!/#[0-9a-fA-F]{3,8}\b/.test(css)&&!/\b(?:rgb|rgba|hsl|hsla)\(/.test(css));
  s.ok('every selector is .phc- scoped (or the body.phc-dragging hook)',(css.match(/[^{}]+(?=\{)/g)||[]).filter(x=>!/^\s*@media/.test(x)).every(sel=>sel.split(',').every(p=>/phc-/.test(p))));
  s.ok('nothing under 12px in the block',!/font-size:(?:[0-9]|10|11)(?:\.\d+)?px/.test(css));
  s.ok('buttons and chips meet 44px / 48px tap height',/\.phc-btn\{min-height:44px/.test(css)&&/\.phc-chip\{[^}]*min-height:48px/.test(css)&&/\.phc-more\{min-height:44px/.test(css));
  s.ok('over capacity is not colour only: the stylesheet has the text rule class and the bar turns to the urgent token',/\.phc-over\{[^}]*color:var\(--accent-urgent\)/.test(css)&&/\.phc-load\.over \.phc-load-fill\{background:var\(--accent-urgent\)\}/.test(css));
  s.ok('the ghost never takes the pointer (pointer-events:none) and sits under the bug FAB (z-index < 500)',/\.phc-ghost\{[^}]*pointer-events:none/.test(css)&&/\.phc-ghost\{[^}]*z-index:400/.test(css));
  s.ok('phone: the weekday header is hidden and the cells stack in one column',/@media \(max-width:640px\)\{[\s\S]*\.phc-wds\{display:none\}[\s\S]*\.phc-cells\{grid-template-columns:minmax\(0,1fr\)\}/.test(css));
  s.ok('prefers-reduced-motion switches the bar transition off',/prefers-reduced-motion:reduce\)\{\s*\.phc-load-fill\{transition:none\}/.test(css));
  s.ok('a focus ring is drawn on chips and buttons',/\.phc-chip:focus-visible[^{]*\{outline:2px solid var\(--text\)/.test(css));
  s.ok('the dialog scrim uses the --text token at opacity (no literal black)',/\.phc-dialog-back::before\{[^}]*background:var\(--text\);opacity:\.45/.test(css));
  // global uniqueness
  const own=[...SRC_STRIP(SRC).matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map(m=>m[1]);
  const others=fs.readdirSync(path.join(ROOT,'js')).filter(f=>f.endsWith('.js')&&f!=='ph-mod-calendar.js').map(f=>read('js/'+f));
  s.ok('every top-level name is ph/_ph/PH_ prefixed',own.every(n=>/^(?:ph|_ph|PH_|_PHC_)/.test(n)),own.filter(n=>!/^(?:ph|_ph|PH_|_PHC_)/.test(n)).join(','));
  const clash=own.filter(n=>others.some(t=>new RegExp('^(?:function|const|let|var)\\s+'+n.replace(/\$/g,'\\$')+'\\b','m').test(t)));
  s.ok('none of the '+own.length+' top-level names is declared in another js file',clash.length===0,clash.join(','));
  s.ok('no window.X= handler names a top-level function of the file (the Board calendar freeze)',!/window\.([A-Za-z_]\w*)\s*=(?!=)/.test(SRC_STRIP(SRC)));
}

module.exports=async function(){
  const s=suite('ph-mod-calendar');
  const base=await checks(SRC);
  s.section('calendar tab');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  await wiring(s);

  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const pairs=Array.isArray(from)?from:[[from,to]];
    let mut=SRC;
    for(const [f,t] of pairs){
      if(mut.split(f).length-1<1){s.ok('break target exists: '+label+' ('+f.slice(0,50)+')',false);return;}
      mut=mut.split(f).join(t);
    }
    let r;try{r=await checks(mut);}catch(e){s.ok('break "'+label+'" runs the checks (it threw: '+String(e&&e.message||e).slice(0,80)+')',false);return;}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true,r[f]===undefined?'UNSET (the block crashed before it)':undefined);});
  };
  await brk('no drag threshold',"if(Math.hypot(e.clientX-d.x0,e.clientY-d.y0)<PH_CAL_DRAG_PX)return;","",['drag: a 3px move is still a click: no ghost, no capture, no body class, no hover']);
  await brk('captured eagerly on pointerdown',"_phcDrag={poId:poId,kind:kind,id:e.pointerId,x0:e.clientX,y0:e.clientY,started:false,over:null,el:el,ghost:null};","_phcDrag={poId:poId,kind:kind,id:e.pointerId,x0:e.clientX,y0:e.clientY,started:false,over:null,el:el,ghost:null};try{el.setPointerCapture(e.pointerId);}catch(x){}",['drag: pointerdown alone registers the document-level tracking (and captures nothing yet)']);
  await brk('the click that ends a drag opens the menu',"_phcJustDragged=true;setTimeout(function(){_phcJustDragged=false;},0);","",['drop: the click that ends a drag opens nothing (the suppressor)']);
  await brk('touch may drag',"if(e.pointerType==='touch')return;","",['touch: a touch press never starts a drag (a tap opens the menu instead)']);
  await brk('skip day not checked',"if(S&&Array.isArray(S.skipDays)&&S.skipDays.indexOf(day)>-1)return{ok:false","if(false)return{ok:false",['refuse: dropping on the skip day writes nothing and says why','pure: phcCheckDay refuses a skip day by name']);
  await brk('weekly off day not checked',"if(S&&Array.isArray(S.offWeekdays)&&S.offWeekdays.indexOf(wd)>-1)return{ok:false","if(false)return{ok:false",['refuse: dropping on a Sunday (weekly off day) writes nothing and says why','pure: phcCheckDay refuses a weekly off day (Sunday) by name']);
  await brk('past day allowed',"if(phIsDay(today)&&day<today)return","if(false)return",['refuse: dropping on a day before today writes nothing and says why','pure: phcCheckDay refuses a day before today']);
  await brk('done lock dropped',"if(job&&job.status==='done')return'Done: the cut is recorded, so its date is fixed.';","",['refuse: a DONE job cannot even start a drag (no tracking, no ghost)','pure: a done job is refused']);
  await brk('overridden lock dropped',"if(job&&job.status==='overridden'&&isOwner!==true)return'Overridden by an owner: only an owner (Afnan or Ammar) can change its date.';","",['refuse: an OVERRIDDEN job is fixed for a non-owner manager (the UI says only an owner can)','pure: an overridden job is refused (for a non-owner)']);
  await brk('overridden locked for owners too',"if(job&&job.status==='overridden'&&isOwner!==true)","if(job&&job.status==='overridden')",['owner: an owner CAN move an overridden job (screen and writer agree): the job and its history row are written','pure: an overridden job is movable by an OWNER (the writer table: overridden -> overridden is an owner step)']);
  await brk('already-cut lock dropped',"if(st&&st!=='cutting'&&st!=='reserved'&&st!=='cancelled'&&st!=='unknown')return","if(false)return",['refuse: a PO that is already cut (bundling) is fixed','pure: an already-cut PO is refused']);
  await brk('view-only allowed to plan',"if(!i.canManage)return{ok:false,why:'View only: only the Production Ops managers can plan cutting.'};","",['pure: a view-only person is refused','view-only: _phcApply refuses with no write']);
  await brk('settings failure ignored',"if(!si.known||si.failed)return","if(false)return",['pure: unreadable settings refuse (skip days unknown)','settings failed: a drop is refused with the reason and nothing is written']);
  await brk('jobs failure ignored in the plan',"if(!i.jobsOk)return","if(false)return",['pure: unreadable jobs refuse']);
  await brk('a reserved PO may be planned',"if(st!=='cutting')return{ok:false,why:i.poId+' is '","if(false)return{ok:false,why:i.poId+' is '",['pure: planning a PO with no job: a reserved PO and a cut PO are refused, a released one is a create','tray: a reserved PO is refused by the plan even if asked for directly']);
  await brk('expectedRev dropped (stale writes allowed)',"if(plan.rev!==undefined)o.expectedRev=plan.rev;","",['refuse: a job changed by someone else since the page loaded is refused (stale revision), nothing written']);
  await brk('over-capacity flag removed',"over:cap!==null&&planned>cap,overBy:cap!==null&&planned>cap?planned-cap:0","over:false,overBy:0",['model: a day planned past the capacity is flagged over, with the excess','screen: an over-capacity day is flagged with TEXT and a glyph, not colour only']);
  await brk('the glyph and words dropped from the over flag',"phEl('span','phc-over','▲ Over capacity by '+info.overBy)","phEl('span','phc-over','')",['screen: an over-capacity day is flagged with TEXT and a glyph, not colour only']);
  await brk('reserved POs listed in the tray',"phStageOf(p)!=='cutting')return;\n    const j=out.jobByPo[id]","false)return;\n    const j=out.jobByPo[id]",['model: the tray is released POs still at cutting with no date (reserved, cut, done and cancelled are never in it; a job with a null date still is)','screen: the tray is PO-106 and PO-110 only (reserved PO-107, bundling PO-108, cancelled PO-109 and the planned ones are not)']);
  await brk('cancelled POs drawn',"if(po&&phStageOf(po)==='cancelled'){out.cancelled++;return;}","",['screen: a cancelled PO\'s job is not drawn, and the page says how many were left out']);
  await brk('failed jobs drawn as an empty calendar',"if(!jg||!jg.ok){","if(false){",['failed: unreadable cutting jobs draw NO grid and NO empty calendar','failed: the card names po_cut_jobs and says why nothing is drawn, with Retry']);
  await brk('PO-less tray hidden as "nothing to plan"',"if(!posList||!posList.length){","if(false){",['POs not loaded: the tray says so (not "nothing to plan") and offers a reload']);
  await brk('Escape does not cancel the drag',"if(_phcDrag&&_phcDrag.started){_phcEnd(false);_phcSay('info','Move cancelled.');return true;}","",['end: Escape cancels the drag and does NOT leave the page']);
  await brk('pointercancel not wired',"document.addEventListener('pointercancel',_phcCancel);","",['end: pointercancel ends the drag: ghost gone, tracking gone, nothing written']);
  await brk('lost release not handled',"if(e.buttons===0){_phcEnd(false);return;}","",['end: a move with no button held (the release was lost) ends the drag']);
  await brk('pointerId not checked on move',"const d=_phcDrag;if(!d||e.pointerId!==d.id)return;\n  if(e.buttons===0)","const d=_phcDrag;if(!d)return;\n  if(e.buttons===0)",['end: a move by a second finger (another pointerId) is ignored']);
  await brk('pointerId not checked on up',"const d=_phcDrag;if(!d||e.pointerId!==d.id)return;\n  const r=_phcEnd(true,e);","const d=_phcDrag;if(!d)return;\n  const r=_phcEnd(true,e);",['end: a pointerup by another pointer does not drop']);
  await brk('right button drags',"if(e.button!==undefined&&e.button!==0)return;","",['end: a right-button press never starts a drag']);
  await brk('a second press stacks listeners',"if(!ctx||!ctx.canManage||_phcBusy||_phcDrag||_phcDialog)return;","if(!ctx||!ctx.canManage)return;",['end: a second pointerdown while one drag is live registers nothing more']);
  await brk('view-only chips drag',[["const ctx=_phcCtx,canDrag=!!(ctx&&ctx.canManage)&&!c.lock;","const ctx=_phcCtx,canDrag=!c.lock;"],["if(!ctx||!ctx.canManage||_phcBusy||_phcDrag||_phcDialog)return;","if(!ctx||_phcBusy||_phcDrag||_phcDialog)return;"]],null,['view-only: the chip does not drag, the screen says View only']);
  await brk('a locked chip opens the menu',[["if(c.lock){_phcSay('bad',c.poId+': '+c.lock);_phcRepaint();return;}\n    _phcOpenDialog","_phcOpenDialog"],["if(lock){_phcSay('bad',poId+': '+lock);_phcRepaint();return;}",""]],null,['refuse: pressing a done chip explains it and opens no menu']);
  await brk('the dialog does not preview refusals',"const txt=d.error||(plan.ok?","const txt=d.error||(true?",['menu: choosing a skip day shows the refusal live, before anything is pressed']);
  await brk('apply skips the plan',"const plan=_phcPlanFor(poId,day);\n  if(!plan.ok){_phcSay(plan.same?'info':'bad',plan.why);_phcRepaint();return plan;}","const plan={ok:true,from:null,to:day,create:false};",['refuse: _phcApply itself refuses done and overridden (no write)','view-only: _phcApply refuses with no write']);
  await brk('the escape guard is not registered',"phAddEscapeGuard(_phcEscape);","",['menu: the shell\'s Escape closes the dialog first and does not leave the page','end: Escape cancels the drag and does NOT leave the page']);
  await brk('the date is not written (wrong field)',"phSaveCutJob(poId,{plannedCutDate:plan.to},o)","phSaveCutJob(poId,{note:plan.to},o)",['drop: ONE transaction wrote po_cut_jobs/PO-103 and its pos/PO-103/history row — both in it']);
  await brk('a direct pos write sneaks in',"r=await phSaveCutJob(poId,{plannedCutDate:plan.to},o);","r=await phSaveCutJob(poId,{plannedCutDate:plan.to},o);await updateDoc(doc(db,'pos',poId),{plannedCutDate:plan.to});",['drop: the pos document itself is never written (only the new collection and the history sub-collection)','source: no Firestore write API or transaction is used directly']);
  await brk('stored text parsed as HTML',"b.appendChild(phEl('span','phc-chip-art',art));","const ar=phEl('span','phc-chip-art');ar.innerHTML=art;b.appendChild(ar);",['xss: a hostile article name reaches the page as escaped text, never as a tag','xss: the source never assigns innerHTML/outerHTML or parses a string as HTML']);
  await brk('a UTC day sneaks in',"function _phcToday(){return phDay(Date.now());}","function _phcToday(){return new Date().toISOString().slice(0,10);}",['source: days are PKT (never toISOString/getDate/new Date for a day)']);
  s.ok('breaks run: '+broken,broken>=40,String(broken));
  return s;
};

module.exports.load=load;

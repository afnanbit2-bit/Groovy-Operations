/* Production Ops ▸ Monitor and Overview (12 Oct 2026): js/ph-mod-monitor.js and its wiring (index.html, sw.js, css/main.css).

   What this drives: the REAL js/ph-core.js + js/ph-data.js + js/ph-ui.js + js/ph-mod-monitor.js over tests/ph-dom.js's small DOM and a fake
   Firestore, with a fifteen-PO fixture (tests/ph-mod-monitor-fixture.js, now = Mon 12 Oct 2026 09:00 PKT) designed so that every number on
   every tile is worked out BY HAND below, next to the assertion that holds it:
     · each tile's number and the list of POs behind it (the drawer's rows must equal the number, tile by tile and link by link)
     · the "no data" states (a PO book with no cut recorded says `No cut recorded yet`, never 0), the failed-collection states (a tile whose
       collection failed says `unavailable — <collection>` and prints no number), missing settings shown as defaults
     · the date range (today / week / month / all / custom), the working-day vs calendar-day delay, the 14-day load against capacity
     · read-only (a recorded-write test and a source scan), XSS (hostile PO names reach the page as text only), the audience (Uzaib sees
       Overview read-only, a manager sees Monitor, others see nothing), the shell's FAILED status strip kept on Overview
   What it does NOT prove: geometry (the harness has no layout; the stylesheet assertions below and tests/smoke-layout.js's "production ops
   — monitor" fragments hold that in real Chromium), the live `pos` collection, or anything on a real screen/phone. Each "break" mutates
   the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const fx=require('./ph-mod-monitor-fixture');
const qcfx=require('./ph-mod-monitor-qc-fixture');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-mod-monitor.js');
const UI=read('js/ph-ui.js');
const CSS=read('css/main.css');
const PERM=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store'},
  claude:{uid:'u-claude',u:'claude',name:'Claude',role:'qa'},
  faizan:{uid:'u-faizan',u:'faizan',name:'Faizan',role:'packing'}
};
const settle=(ms)=>new Promise(r=>setTimeout(r,ms||25));
const evKey=(k,tgt,extra)=>Object.assign({key:k,target:tgt||{tagName:'DIV'},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}},extra||{});

function fakeDb(o){
  o=o||{};
  const reads={},writes=[],api={
    db:{},
    collection:(db,...s)=>({path:s.join('/')}),doc:(db,...s)=>({path:s.join('/')}),
    query:c=>({path:c.path}),orderBy:()=>({}),limit:()=>({}),where:()=>({}),
    getDocs:async q=>{
      reads[q.path]=(reads[q.path]||0)+1;
      if(o.gate&&q.path===(o.gatePath||'pos'))await o.gate.p;
      const f=o.fail&&o.fail[q.path];
      if(f&&(!o.failTimes||reads[q.path]<=o.failTimes))throw f();
      if((o.fromCache&&q.path==='pos')||(o.cachePaths&&o.cachePaths.indexOf(q.path)>-1))return{docs:[],metadata:{fromCache:true}};   // QC8: cachePaths answers other collections from the offline copy too
      const rows=(o.data&&o.data[q.path])||[];
      return{docs:rows.map(r=>({id:r.id,data:()=>Object.assign({},r)})),metadata:{fromCache:false}};
    },
    getDoc:async r=>{
      reads[r.path]=(reads[r.path]||0)+1;
      const f=o.fail&&o.fail[r.path];if(f)throw f();
      const d=o.data&&o.data[r.path];
      return{exists:()=>!!d,data:()=>Object.assign({},d),metadata:{fromCache:false}};
    },
    setDoc:async()=>{writes.push('setDoc');},updateDoc:async()=>{writes.push('updateDoc');},addDoc:async()=>{writes.push('addDoc');},
    deleteDoc:async()=>{writes.push('deleteDoc');},writeBatch:()=>{writes.push('writeBatch');return{set(){},update(){},delete(){},commit:async()=>{}};},
    runTransaction:async()=>{writes.push('runTransaction');}
  };
  return{api,reads,writes};
}
function gate(){let open;const p=new Promise(r=>{open=r;});return{p,open};}

// the real files in the real order, over the small DOM; Date is pinned to the fixture's clock
function load(src,opts){
  opts=opts||{};
  const store={},calls=[],shown=[];
  const data=opts.data||fx.dbData();
  const fk=fakeDb(Object.assign({data:data},opts.db||{}));
  let tokenRefreshes=0;
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-i18n.js'],session:opts.session===undefined?USERS.afnan:opts.session,currentPage:'dashboard',
    globals:Object.assign({},fk.api,{
      auth:{currentUser:{getIdToken:async()=>{tokenRefreshes++;return'tok';}}},
      localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},
      history:{replaceState(s,t,u){calls.push(String(u));const i=String(u).indexOf('#');a.ctx.location.hash=i<0?'':String(u).slice(i);},pushState(){}}
    },opts.globals||{})});
  const ctx=a.ctx;if(typeof ctx.phI18nSetLang==='function')ctx.phI18nSetLang('en');
  const dom=domkit.install(ctx);
  const RealDate=Date;
  ctx.Date=class extends RealDate{constructor(...x){if(x.length===0)super(fx.NOW);else super(...x);}static now(){return fx.NOW;}};
  ctx.window.showPage=function(id){
    shown.push(id);
    ctx.currentPage=id;
    if(id==='prod-ops'&&!opts.noRender)ctx.phRenderPage(id);
    return Promise.resolve();
  };
  ctx.window.startApp=async function(){};
  ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(UI,ctx,{filename:'ph-ui.js'});
  vm.runInContext(src,ctx,{filename:'ph-mod-monitor.js'});
  const T={a,ctx,dom,fk,store,calls,shown,
    R:c=>a.run(c),
    keys:e=>(a.state.listeners.keydown||[]).forEach(f=>f(e)),
    as(u){ctx.session=u;},
    panel:()=>dom.find('ph-panel'),
    text:n=>n?n.textContent:'',
    tiles:()=>dom.all(dom.find('ph-panel')||dom.body,n=>n.getAttribute&&n.getAttribute('data-tile')),
    tile:id=>dom.all(dom.find('ph-panel')||dom.body,n=>n.getAttribute&&n.getAttribute('data-tile')===id)[0]||null,
    tileText:id=>{const t=T.tile(id);return t?t.textContent:'';},
    main:id=>{const t=T.tile(id);return t?t.children[0]:null;},
    drawer:()=>dom.byClass(dom.find('ph-panel')||dom.body,'phm-drawer')[0]||null,
    drawerRows:()=>{const d=T.drawer();return d?dom.byClass(d,'phm-row').filter(r=>!/phm-row-empty/.test(r.className)):[];},
    tokenRefreshes:()=>tokenRefreshes,
    show:async id=>{await ctx.window.showPage(id);await settle();},
    go:async id=>{ctx.phGoTab(id);await settle();},
    btn:(label)=>dom.all(dom.find('ph-panel')||dom.body,n=>n.tagName==='BUTTON'&&n.textContent===label)[0]||null
  };
  return T;
}

// the pure model, in one context (no DOM needed beyond what the shell file wants)
function modelCtx(src){
  const T=load(src);
  return{T,build:over=>{
    T.ctx.__in=Object.assign({now:fx.NOW,range:{from:'2026-10-01',to:'2026-10-12'},pos:fx.posRows(),jobs:fx.jobRows(),settingsRaw:fx.clone(fx.SETTINGS),errors:{}},over||{});
    return vm.runInContext('phmBuildModel(__in)',T.ctx);
  }};
}
const ids=rows=>rows.map(r=>r.id).join();
const noPoOf=(M,po)=>Object.keys(M.tiles).every(k=>M.tiles[k].rows.every(r=>r.id!==po)&&M.tiles[k].links.every(l=>l.rows.every(r=>r.id!==po)));
const stripCuts=pos=>pos.map(p=>{const c=Object.assign({},p);delete c.cutQty;delete c.cutAt;return c;});
const ALL_TILES=['pipeline','afloat','inProduction','reserved','stuck','attention','capacity','queueDelay','seasons','avgIssue','avgCut','leadTime','cutGap'];

async function checks(src,opts){
  opts=opts||{};          // skipOld: run only the QC8 sections; skipQc: run only the older ones (a deliberate break names which side its checks are on)
  let qcPhase=false;
  const o={},threw=[];
  // a section that throws (a broken source, a missing node) must NAME a finding, not take the suite down: later checks in it are simply absent (= failed)
  let qcIdx=0;            // the QC8 sections are numbered 1..5 in order; opts.qcSecs (a Set) runs only those
  const sec=async fn=>{const q=qcPhase?++qcIdx:0;if((opts.skipOld&&!qcPhase)||(opts.skipQc&&qcPhase)||(qcPhase&&opts.qcSecs&&!opts.qcSecs.has(q)))return;try{await fn();}catch(e){threw.push(String(e&&e.message||e).slice(0,100));}if(q&&opts.keySecOut)Object.keys(o).forEach(k=>{if(!(k in opts.keySecOut))opts.keySecOut[k]=q;});};
  const {build}=modelCtx(src);

  /* ── A. the model, tile by tile, against hand arithmetic ─────────────────
     Fixture facts (today Mon 2026-10-12; saved settings capacity 300 and Sunday off; stuck 7 days, delay target 3, gate 70-130 are defaults):
       cutting:    PO-101 400 (released 10-10)  PO-102 300 (10-08)  PO-103 200 (10-02)  PO-104 150 (no release date)  PO-113 (no quantity)
       bundling:   PO-105 500 ordered, cut 450 (10-06)   PO-115 60 ordered, cut 50 (10-08, no release date)
       stitching:  PO-106 300 ordered, cut 200 (10-01)   printing: PO-107 250 ordered, cut 260 (10-09)   qc: PO-108 100 ordered, cut 150 (10-05)
       completed PO-109 (cut 09-20)   reserved PO-110, PO-111   cancelled PO-112   unknown stage PO-114 */
  await sec(async()=>{
    const M=build();
    const t=id=>M.tiles[id];
    o['pipeline: 10 released POs from cutting to final QC (5+2+1+1+0+1), with the stage counts']=t('pipeline').state==='ok'&&t('pipeline').value==='10'&&t('pipeline').count===10&&/Cutting 5 · Bundling 2 · Stitching 1 · Printing 1 · Washing 0 · Final QC 1/.test(t('pipeline').sub);
    o['pipeline: the list is the ten POs and holds no reserved, completed, cancelled or unknown PO']=ids(t('pipeline').rows)==='PO-101,PO-102,PO-103,PO-104,PO-105,PO-106,PO-107,PO-108,PO-113,PO-115'.split(',').sort().join()||t('pipeline').rows.map(r=>r.id).sort().join()==='PO-101,PO-102,PO-103,PO-104,PO-105,PO-106,PO-107,PO-108,PO-113,PO-115'
      &&['PO-109','PO-110','PO-111','PO-112','PO-114'].every(id=>!t('pipeline').rows.some(r=>r.id===id));
    o['pipeline: a PO in an unrecognised stage is surfaced apart (PO-114), not counted as cutting']=t('pipeline').links.length===1&&t('pipeline').links[0].count===1&&ids(t('pipeline').links[0].rows)==='PO-114';
    o['units afloat: 1,050 = 400+300+200+150 pieces ISSUED of the POs at cutting (PO-113 has no quantity and is said so)']=t('afloat').value==='1,050'&&t('afloat').count===5&&t('afloat').sum===1050&&/1 PO with no quantity/.test(t('afloat').sub);
    o['units afloat: the caption says afloat is the issued quantity not yet cut, and in production says it uses the actual cut']=/ISSUED/.test(t('afloat').cap)&&/not yet cut done/.test(t('afloat').cap)&&/ACTUAL cut quantity/.test(t('inProduction').cap)&&/differs from units afloat/.test(t('inProduction').cap);
    o['units in production: 2,160 = 1,050 + (450+50) + 200 + 260 + 150 (actual cut once past cutting)']=t('inProduction').value==='2,160'&&t('inProduction').count===10&&t('inProduction').sum===2160;
    o['reserved: 2 (PO-110, PO-111), kept out of the pipeline']=t('reserved').value==='2'&&t('reserved').count===2&&ids(t('reserved').rows.slice().sort((a,b)=>a.id<b.id?-1:1))==='PO-110,PO-111'&&!t('pipeline').rows.some(r=>/PO-11[01]/.test(r.id));
    o['a cancelled PO (PO-112, 999 pcs) is in no tile and no list']=noPoOf(M,'PO-112')&&t('afloat').value!=='2,049';
    o['stuck: 2 = PO-103 (10 days at cutting) and PO-106 (9 days at stitching); PO-105 at 6 days is not stuck']=t('stuck').value==='2'&&t('stuck').count===2&&t('stuck').rows.map(r=>r.id).sort().join()==='PO-103,PO-106'&&!t('stuck').rows.some(r=>r.id==='PO-105');
    o['stuck: PO-104 has no release date so it is NOT judged — it is counted apart as "no start date"']=t('stuck').links.length===1&&t('stuck').links[0].count===1&&ids(t('stuck').links[0].rows)==='PO-104'&&/no start date/.test(t('stuck').links[0].label);
    o['attention: 4 items, worst first (stuck PO-103 10 d, stuck PO-106 9 d, PO-106 over the gate, delayed PO-102)']=M.attention.count===4&&M.attention.rows.map(r=>r.kind+':'+r.id).join()==='stuck:PO-103,stuck:PO-106,overgate:PO-106,delayed:PO-102'&&t('attention').value==='4';
    o['attention: PO-106 cut 200 of 300 (66.7 %) is under the 70 % gate; PO-108 cut 150 of 100 is over it but an owner approved it, so it is not listed']=/cut 200 pcs against 300 ordered \(67%\)/.test(M.attention.rows[2].detail)&&!M.attention.rows.some(r=>r.id==='PO-108');
    o['attention: PO-102 is delayed for BOTH reasons (4 days since release over the 3-day target; planned cut day 9 Oct passed 3 days ago)']=/4 days since release/.test(M.attention.rows[3].detail)&&/planned cut day 9 Oct passed 3 days ago/.test(M.attention.rows[3].detail);
    o['attention: a completed PO (PO-109) and an in-gate cut (PO-105 90 %) are not listed']=!M.attention.rows.some(r=>r.id==='PO-109'||r.id==='PO-105');
    o['load: 29 % = 1,050 pcs queued of 3,600 (300/day x 12 working days: 14 days with two Sundays off), within capacity']=t('capacity').value==='29%'&&t('capacity').over===false&&t('capacity').load===1050&&t('capacity').capacity===3600&&t('capacity').workdays===12&&/Within capacity/.test(t('capacity').cap);
    o['load: the five POs at cutting are the list (PO-113 has no quantity and says so)']=t('capacity').count===5&&t('capacity').rows.length===5&&/no quantity/.test(t('capacity').rows.filter(r=>r.id==='PO-113')[0].detail);
    o['queue delay: PO-102 finishes Mon 12 Oct against Fri 9 Oct = +2 WORKING days (Sunday off) but +3 CALENDAR days']=t('queueDelay').value==='+2 working days'&&/\+3 calendar days/.test(t('queueDelay').sub)&&t('queueDelay').count===1&&ids(t('queueDelay').rows)==='PO-102';
    const sl=t('seasons').lines;
    o['seasons: 9 POs issued in October = Summer 2026 {PO-103 guessed, PO-107 stored} + Winter 2026/27 {7, 6 of them guessed}']=t('seasons').value==='9 POs'&&sl.length===2&&/^Summer 2026 · 2 POs · 450 pcs/.test(sl[0].text)&&/^Winter 2026\/27 · 7 POs · 1,510 pcs \(\+1 with none\)/.test(sl[1].text);
    o['seasons: a guessed season is flagged guessed (1 of 2, 6 of 7)']=sl[0].flag==='1 guessed'&&sl[1].flag==='6 guessed'&&t('seasons').rows.some(r=>/\(guessed\)/.test(r.detail))&&t('seasons').rows.some(r=>/\(stored\)/.test(r.detail));
    o['average PO issue quantity: 245 = 1,960 / 8 POs with a quantity (PO-113 has none)']=t('avgIssue').value==='245 pcs'&&/n = 8/.test(t('avgIssue').sub)&&/1,960/.test(t('avgIssue').sub)&&t('avgIssue').count===8&&!t('avgIssue').rows.some(r=>r.id==='PO-113');
    o['average cut quantity: 222 = 1,110 / 5 cuts in October (PO-105, 106, 107, 108, 115); PO-109 cut in September is outside']=t('avgCut').value==='222 pcs'&&/n = 5/.test(t('avgCut').sub)&&t('avgCut').rows.map(r=>r.id).sort().join()==='PO-105,PO-106,PO-107,PO-108,PO-115'&&!t('avgCut').rows.some(r=>r.id==='PO-109');
    o['lead time: 2.3 days = (3+3+2+1) / 4, n shown; PO-115 has no start date, is counted apart and NOT averaged']=t('leadTime').value==='2.3 days'&&/n = 4/.test(t('leadTime').sub)&&t('leadTime').links.length===1&&ids(t('leadTime').links[0].rows)==='PO-115'&&!t('leadTime').rows.some(r=>r.id==='PO-115');
    o['delay gap (cut vs planned, calendar days): 0 = (+1, 0, -1) / 3, one late, one on time, one early; two cut POs have no planned day']=t('cutGap').value==='0 days'&&/n = 3 · 1 late · 1 on time · 1 early · 33\.3% late/.test(t('cutGap').sub)&&t('cutGap').links.length===1&&t('cutGap').links[0].count===2&&t('cutGap').links[0].rows.map(r=>r.id).sort().join()==='PO-106,PO-115';
    // every figure is auditable: the list behind it is as long as the number says
    o['drill: every tile\'s list has exactly as many rows as the number says, and no tile carries a warning']=ALL_TILES.every(k=>t(k).count===t(k).rows.length&&!t(k).warn);
    o['drill: every extra link (no start date, no planned day, unrecognised stage) lists exactly the POs it counts']=ALL_TILES.every(k=>t(k).links.every(l=>l.count===l.rows.length));
    o['drill: the pieces in the afloat and in-production lists add up to the number on the tile']=t('afloat').rows.reduce((a,r)=>a+(r.units||0),0)===1050&&t('inProduction').rows.reduce((a,r)=>a+(r.units||0),0)===2160;
    o['drill: a PO appears once in each list (the attention list is per reason)']=ALL_TILES.filter(k=>k!=='attention').every(k=>new Set(t(k).rows.map(r=>r.id)).size===t(k).rows.length);
    o['settings: capacity and the off day are saved, the rest are defaults — and the tiles say so']=M.settings.source.indexOf('saved settings')===0&&M.settings.isDefault.stuckDays===true&&M.settings.isDefault.dailyCapacity===false&&/7 days or more \(default\)/.test(t('stuck').sub)&&/300\/day \(default\)/.test(t('capacity').sub)===false&&/300\/day/.test(t('capacity').sub);
    o['tiles are scoped: pipeline/afloat/stuck/load are "now", season/issue/cut/lead/delay are "in range"']=['pipeline','afloat','inProduction','reserved','stuck','capacity','queueDelay'].every(k=>t(k).scope==='now')&&['seasons','avgIssue','avgCut','leadTime','cutGap'].every(k=>t(k).scope==='range');
  });
  /* ── the date range ── */
  await sec(async()=>{
    const today=build({range:{from:'2026-10-12',to:'2026-10-12'}}).tiles;
    o['range today: nothing issued, cut or led today -> "no data yet" on the range tiles, and the cut tile says it is THIS range (others exist)']=['seasons','avgIssue','leadTime','cutGap'].every(k=>today[k].state==='nodata'&&today[k].value==='no data yet')&&today.avgCut.state==='nodata'&&today.avgCut.value==='No cut recorded in this range'&&/6 cuts on record in other periods/.test(today.avgCut.sub);
    o['range today: the "now" tiles do not move with the range']=today.pipeline.value==='10'&&today.afloat.value==='1,050'&&today.stuck.value==='2';
    const all=build({range:{}}).tiles;
    o['range all: issue quantity 246 = 2,460 / 10; cut 218.3 = 1,310 / 6; lead 2.8 = 14 / 5 (PO-109 5 days is the one over the target); gap n=3 with 3 unplanned']=all.avgIssue.value==='246 pcs'&&/n = 10/.test(all.avgIssue.sub)&&all.avgCut.value==='218.3 pcs'&&/n = 6/.test(all.avgCut.sub)&&all.leadTime.value==='2.8 days'&&/n = 5/.test(all.leadTime.sub)&&/1 over the 3-day target \(default\)/.test(all.leadTime.sub)&&/n = 3/.test(all.cutGap.sub)&&all.cutGap.links[0].count===3;
    const bad=build({range:{from:'2026-10-12',to:'2026-10-01'}}).tiles;
    o['an impossible range (start after end) is unavailable, never a number']=['seasons','avgIssue','avgCut','leadTime','cutGap'].every(k=>bad[k].state==='unavailable'&&/unavailable — a valid date range/.test(bad[k].value));
    const rf=(p,c)=>vm.runInContext('phmRangeFor('+JSON.stringify(p)+','+JSON.stringify(c||{})+',"2026-10-14")',modelCtx(src).T.ctx);
    const wk=rf('week'),mo=rf('month'),td=rf('today'),al=rf('all'),cu=rf('custom',{from:'2026-09-01',to:'2026-09-30'}),cb=rf('custom',{from:'2026-09-30',to:'2026-09-01'}),cj=rf('custom',{from:'nope'});
    o['phmRangeFor: today / week (Monday to date) / month (1st to date) / all / custom, PKT days']=td.from==='2026-10-14'&&td.to==='2026-10-14'&&wk.from==='2026-10-12'&&wk.to==='2026-10-14'&&mo.from==='2026-10-01'&&mo.to==='2026-10-14'&&al.from===null&&al.to===null&&cu.from==='2026-09-01'&&cu.to==='2026-09-30';
    o['phmRangeFor: a reversed or unreadable custom range is refused with a reason']=cb.bad===true&&/after the end/.test(cb.error)&&cj.bad===true&&/real dates/.test(cj.error);
  });
  /* ── no data is "no data", never 0 ── */
  await sec(async()=>{
    const M=build({pos:stripCuts(fx.posRows())});
    o['no cut recorded anywhere: "No cut recorded yet" (not 0), lead time and delay gap "no data yet"']=M.tiles.avgCut.value==='No cut recorded yet'&&M.tiles.avgCut.state==='nodata'&&M.tiles.leadTime.value==='no data yet'&&M.tiles.cutGap.value==='no data yet';
    o['no cut recorded: no range tile shows a 0 as a measurement']=['avgCut','leadTime','cutGap'].every(k=>!/(^|\s)0(\s|$)/.test(M.tiles[k].value));
    o['a PO list or a cutting-job list that hit its read limit is flagged in the data-quality line']=build({jobsTruncated:true,truncated:true}).quality.jobsTruncated===true&&build({truncated:true}).quality.truncated===true&&build().quality.truncated===false;
    const E=build({pos:[]});
    o['an empty PO book that WAS read: pipeline and reserved are a real 0, every average is "no data yet"']=E.tiles.pipeline.value==='0'&&E.tiles.pipeline.state==='ok'&&E.tiles.reserved.value==='0'&&E.tiles.stuck.value==='0'&&E.tiles.avgIssue.value==='no data yet'&&E.tiles.avgCut.value==='No cut recorded yet'&&E.attention.count===0;
  });
  /* ── failed collections ── */
  await sec(async()=>{
    const M=build({pos:null,errors:{pos:'pos: boom'}});
    o['pos failed: EVERY tile reads "unavailable — pos" and prints no number']=ALL_TILES.every(k=>M.tiles[k].state==='unavailable'&&String(M.tiles[k].value)==='unavailable — pos'&&!/\d/.test(M.tiles[k].value))&&M.attention.unavailable[0]==='pos';
    const J=build({jobs:null,errors:{po_cut_jobs:'x'}}).tiles;
    o['po_cut_jobs failed: the two tiles that need planned days say "unavailable — po_cut_jobs"; the rest still show numbers']=String(J.cutGap.value)==='unavailable — po_cut_jobs'&&String(J.queueDelay.value)==='unavailable — po_cut_jobs'&&J.pipeline.value==='10'&&J.afloat.value==='1,050'&&J.leadTime.value==='2.3 days';
    const Ja=build({jobs:null});
    o['po_cut_jobs failed: the planned-day reason is not applied (PO-102 stays delayed on the lead time alone) and the list says so']=!/planned cut day/.test(Ja.attention.rows.filter(r=>r.id==='PO-102')[0].detail)&&/po_cut_jobs could not be read/.test(Ja.attention.note);
    const S0=build({settingsRaw:null});
    o['settings unreadable: ph-core defaults, SHOWN as defaults (400/day, 7 days, gate 70-130) with the reason']=S0.settings.source==='defaults — ph_settings could not be read'&&/400\/day \(default\)/.test(S0.tiles.capacity.sub)&&/\(default\)/.test(S0.tiles.stuck.sub)&&S0.settings.isDefault.dailyCapacity===true&&S0.settings.isDefault.cutGate===true;
    const S1=build({settingsRaw:{}});
    o['settings read but nothing saved: "defaults — nothing saved yet"']=S1.settings.source==='defaults — nothing saved yet'&&S1.settings.S.dailyCapacity===400;
  });
  /* ── settings flow through, and capacity can be exceeded ── */
  await sec(async()=>{
    const C=build({settingsRaw:{dailyCapacity:50}}).tiles.capacity;
    // 50/day, no off days: 14 working days = 700 pcs; PO-102 300 (6 days), PO-101 400 (8 days) fill the window; PO-103, PO-104 finish after 25 Oct
    o['over capacity: 1,050 queued against 700 -> 100 %, "Over capacity by 350 pcs", and the two POs that finish after the window are marked']=C.over===true&&C.spill===350&&C.load===700&&C.capacity===700&&C.value==='100%'&&/Over capacity by 350 pcs/.test(C.cap)&&C.rows.filter(r=>r.after).map(r=>r.id).sort().join()==='PO-103,PO-104';
    const S=build({settingsRaw:{stuckDays:20,delayTargetDays:3,cutGate:[60,140],dailyCapacity:300,offWeekdays:[0]}});
    o['the settings are honoured: a 20-day stuck limit empties the stuck list (a real 0), a 60-140 % gate clears PO-106, and the two old cutting POs (PO-102, PO-103) are delayed instead']=S.tiles.stuck.value==='0'&&S.tiles.stuck.state==='ok'&&S.attention.counts.overgate===0&&S.attention.counts.delayed===2&&S.attention.count===2;
    const T1=build({settingsRaw:{dailyCapacity:300,offWeekdays:[]}}).tiles.queueDelay;
    o['working days and calendar days agree when no weekday is off (+3 and +3), and differ when Sunday is off (+2 and +3)']=T1.value==='+3 working days'&&/\+3 calendar days/.test(T1.sub);
  });
  /* ── B. the tabs over the real shell ── */
  const DATA=()=>fx.dbData();
  await sec(async()=>{
    const T=load(src);
    await T.show('prod-ops');
    const idsOv=T.tiles().map(n=>n.getAttribute('data-tile'));
    o['Overview: the six headline tiles, then the attention list']=idsOv.join()==='pipeline,afloat,inProduction,reserved,stuck,attention'&&/Needs attention/.test(T.text(T.panel()));
    o['Overview: values on screen are the hand-worked ones (10, 1,050, 2,160, 2, 2, 4)']=['10','1,050','2,160','2','2','4'].every((v,i)=>T.dom.byClass(T.tiles()[i],'phm-tile-val')[0].textContent===v);
    o['Overview: the PO documents are read once for the page (one pos read)']=T.fk.reads.pos===1;
    o['Overview: the attention list shows at most five rows and the four listed are the hand-worked ones']=T.dom.byClass(T.panel(),'phm-att-row').length===4&&/PO-103/.test(T.text(T.dom.byClass(T.panel(),'phm-att-row')[0]));
    await T.go('monitor');
    const idsMo=T.tiles().map(n=>n.getAttribute('data-tile'));
    o['Monitor: seven "now" tiles then five "in range" tiles, with the range selector, the stage bars, the attention card and the settings in use']=idsMo.join()==='pipeline,afloat,inProduction,reserved,stuck,capacity,queueDelay,seasons,avgIssue,avgCut,leadTime,cutGap'&&T.dom.byClass(T.panel(),'phm-range').length===1&&T.dom.byClass(T.panel(),'phm-bar-row').length===6&&/Settings in use/.test(T.text(T.panel()))&&/Needs attention/.test(T.text(T.panel()));
    o['Monitor: switching tab did not read pos again (cached)']=T.fk.reads.pos===1;
    o['Monitor: the default range is this month and it is said, with which tiles it moves']=/Showing: This month \(1 Oct – 12 Oct\)/.test(T.text(T.panel()))&&/"Now" tiles are snapshots/.test(T.text(T.panel()));
    o['Monitor: every tile is labelled Now or In range']=T.tiles().every(n=>/phm-scope/.test(n.children[0].children[0].children[1].className));
    // drawer
    const main=T.main('afloat');T.dom.click(main);
    o['a tile opens the list of POs behind it: 5 rows = the 5 on the tile, with the pieces total shown (1,050)']=!!T.drawer()&&T.drawerRows().length===5&&/5 POs/.test(T.text(T.drawer()))&&/Sum of the list: 1,050 pieces ordered/.test(T.text(T.drawer()));
    o['the drawer is a labelled dialog with a Close button']=T.drawer().getAttribute('role')==='dialog'&&T.drawer().getAttribute('aria-modal')==='true'&&/afloat|Units afloat/.test(T.drawer().getAttribute('aria-label'))&&!!T.btn('Close');
    T.keys(evKey('Escape'));
    o['Escape closes the open drawer FIRST and does not leave the page']=!T.drawer()&&T.ctx.document.body.classList.contains('ph-fullscreen');
    T.dom.click(T.main('stuck'));
    o['drawer for Stuck POs lists exactly the 2 stuck POs, with the reason']=T.drawerRows().length===2&&/10 days at Cutting/.test(T.text(T.drawer()));
    T.dom.click(T.btn('Close'));
    o['Close closes it']=!T.drawer();
    const link=T.dom.all(T.tile('leadTime'),n=>/phm-sublink/.test(n.className))[0];
    T.dom.click(link);
    o['the "no start date" link opens exactly the one PO that is not averaged (PO-115)']=T.drawerRows().length===1&&/PO-115/.test(T.text(T.drawer()));
    T.keys(evKey('Escape'));
    // every tile's drawer equals its number
    let okAll=true;
    for(const id of ['pipeline','afloat','inProduction','reserved','stuck','capacity','queueDelay','seasons','avgIssue','avgCut','leadTime','cutGap']){
      T.dom.click(T.main(id));
      const n=T.drawerRows().length,say=/(\d+) POs?/.exec(T.text(T.dom.byClass(T.drawer(),'phm-drawer-count')[0]));
      const tileCount=T.R('(function(){return 0})()');
      if(!say||+say[1]!==n)okAll=false;
      T.keys(evKey('Escape'));
    }
    o['every tile on screen: the drawer says N POs and lists N rows']=okAll;
    // range selector
    T.dom.click(T.btn('Today'));await settle();
    o['range chip Today: the range tiles go to "no data yet" and the cut tile says it is this range; the Now tiles keep their numbers']=/Showing: Today \(12 Oct\)/.test(T.text(T.panel()))&&/no data yet/.test(T.tileText('avgIssue'))&&/No cut recorded in this range/.test(T.tileText('avgCut'))&&T.dom.byClass(T.tile('pipeline'),'phm-tile-val')[0].textContent==='10';
    T.dom.click(T.btn('All time'));await settle();
    o['range chip All time: 246 pcs, n = 10']=/246 pcs/.test(T.tileText('avgIssue'))&&/n = 10/.test(T.tileText('avgIssue'));
    T.dom.click(T.btn('Custom'));await settle();
    const inputs=T.dom.all(T.panel(),n=>n.tagName==='INPUT'&&n.getAttribute('type')==='date');
    inputs[0].value='2026-10-12';inputs[1].value='2026-10-01';T.dom.click(T.btn('Apply'));await settle();
    o['a reversed custom range is refused on screen and the range tiles read unavailable, not a number']=/The start is after the end/.test(T.text(T.panel()))&&/unavailable — a valid date range/.test(T.tileText('avgCut'));
    const inputs2=T.dom.all(T.panel(),n=>n.tagName==='INPUT'&&n.getAttribute('type')==='date');
    inputs2[0].value='2026-09-01';inputs2[1].value='2026-09-30';T.dom.click(T.btn('Apply'));await settle();
    o['custom 1-30 Sep: only PO-109 (cut 20 Sep, 200) counts -> average cut 200 pcs, n = 1, lead time 5 days']=/200 pcs/.test(T.tileText('avgCut'))&&/n = 1/.test(T.tileText('avgCut'))&&/5 days/.test(T.tileText('leadTime'));
    // refresh
    T.dom.click(T.btn('Refresh'));await settle(50);
    o['Refresh reads pos again (2 reads in all)']=T.fk.reads.pos===2;
    o['read-only: nothing was written through the whole session']=T.fk.writes.length===0;
  });
  /* ── the shell's FAILED strip is kept on Overview ── */
  await sec(async()=>{
    const T=load(src,{db:{fail:{ph_standards:PERM,cutting_masters:()=>new Error('boom: masters')}}});
    await T.show('prod-ops');
    const txt=T.text(T.panel());
    const lineOf=label=>{const l=T.dom.all(T.panel(),n=>/\bph-line\b/.test(n.className)&&n.children[0]&&n.children[0].textContent===label)[0];return l?l.textContent:'';};
    o['Overview keeps the per-collection status strip: both failed collections read FAILED by name']=/FAILED/.test(lineOf('Consumption standards'))&&/ph_standards/.test(lineOf('Consumption standards'))&&/FAILED/.test(lineOf('Cutting masters'))&&/cutting_masters/.test(lineOf('Cutting masters'));
    o['Overview strip: the collections that loaded read Loaded, and so does pos, which this tab reads itself']=/Loaded/.test(lineOf('Cutting jobs'))&&/Loaded/.test(lineOf('Purchase orders'))&&/10 records|15 records/.test(lineOf('Purchase orders'));
    o['Overview strip: a failed collection prints no record count']=!/\d+ records?/.test(lineOf('Consumption standards'));
    o['unrelated failed collections do not blank the tiles (the PO numbers are still there)']=T.dom.byClass(T.tile('pipeline'),'phm-tile-val')[0].textContent==='10';
  });
  /* ── pos failed: the tiles say so, Retry recovers and re-reads only pos ── */
  await sec(async()=>{
    const T=load(src,{db:{fail:{pos:PERM},failTimes:2}});    // refused twice (the first read and the one retry behind a token refresh), then fine
    await T.show('prod-ops');
    o['pos refused: every Overview tile reads "unavailable — pos" and there is no zero']=T.tiles().length===6&&T.tiles().every(n=>T.dom.byClass(n,'phm-tile-val')[0].textContent==='unavailable — pos');
    o['pos refused: the alert card names pos and says permission, and one retry was made behind a token refresh']=/Could not read the purchase orders/.test(T.text(T.panel()))&&/pos: could not be read - permission denied/.test(T.text(T.panel()))&&T.tokenRefreshes()===1&&T.fk.reads.pos===2;
    o['pos refused: the attention card reads unavailable too (not "nothing needs attention")']=/unavailable — pos/.test(T.text(T.dom.byClass(T.panel(),'phm-att')[0]))&&!/Nothing is stuck/.test(T.text(T.panel()));
    const before=T.fk.reads.ph_standards||0;
    T.dom.click(T.btn('Retry'));await settle(50);
    o['Retry reads again and the real numbers come back']=T.fk.reads.pos===3&&T.dom.byClass(T.tile('pipeline'),'phm-tile-val')[0].textContent==='10'&&(T.fk.reads.ph_standards||0)===before;
  });
  await sec(async()=>{
    const T=load(src,{db:{fromCache:true}});
    await T.show('prod-ops');
    o['an offline-copy answer for pos is not a read: unavailable, with the reason']=/offline copy/.test(T.text(T.panel()))&&T.tiles().every(n=>/unavailable — pos/.test(n.textContent));
  });
  await sec(async()=>{
    const g=gate();
    const T=load(src.replace('PHM_READ_TIMEOUT_MS=20000','PHM_READ_TIMEOUT_MS=40'),{db:{gate:g}});
    await T.show('prod-ops');
    const sk=!!T.dom.byClass(T.panel(),'ph-skelwrap')[0];
    const first=await Promise.race([T.R('phmLoadPos()'),settle(400).then(()=>'hung')]);
    await settle(120);
    o['pos read that never settles: the tab shows a skeleton while it waits']=sk;
    o['pos read that never settles is cut off by the timeout, reported and does not reject']=first!=='hung'&&T.R('_phmPos.state')==='error'&&/did not finish/.test(T.R('_phmPos.errText'));
    g.open();
  });
  await sec(async()=>{
    const T=load(src);
    await T.show('prod-ops');
    await T.R('phmLoadPos()');
    const afterPlain=T.fk.reads.pos;
    await T.R('phmLoadPos(true)');
    o['phmLoadPos reuses a fresh read (no second read inside the stale window) and re-reads when forced']=afterPlain===1&&T.fk.reads.pos===2;
    const stale=load(src);
    await stale.show('prod-ops');
    stale.R('_phmPos.at=Date.now()-PHM_STALE_MS-1');
    await stale.R('phmLoadPos()');
    o['phmLoadPos re-reads a read older than the stale window']=stale.fk.reads.pos===2;
  });
  /* ── an empty PO book ── */
  await sec(async()=>{
    const T=load(src,{data:Object.assign(fx.dbData(),{pos:[]})});
    await T.show('prod-ops');
    o['pos read and EMPTY: a real 0 on pipeline, not "unavailable"']=T.dom.byClass(T.tile('pipeline'),'phm-tile-val')[0].textContent==='0'&&!/unavailable/.test(T.tileText('pipeline'));
  });
  /* ── XSS ── */
  await sec(async()=>{
    const evil='<img src=x onerror=alert(1)>';
    const d=fx.dbData();d.pos=d.pos.map(p=>p.id==='PO-103'?Object.assign(p,{name:evil,code:'"><script>alert(2)</script>'}):p);
    const T=load(src,{data:d});
    await T.show('prod-ops');await T.go('monitor');
    T.dom.click(T.main('stuck'));
    const html=domkit.toHtml(T.dom.body);
    o['XSS: a hostile PO name reaches the drawer as TEXT (escaped), never as markup']=T.text(T.drawer()).indexOf(evil)>-1&&html.indexOf('<img')<0&&html.indexOf('<script')<0&&html.indexOf('&lt;img')>-1;
  });
  /* ── open a PO from an attention row (managers only) ── */
  await sec(async()=>{
    const J=JSON.stringify;
    const setup=(T)=>{T.R('window.openPODetail=function(k){__log.push("open:"+k);};');T.ctx.__log=[];T.R('(function(){const o=_phTkLeave;_phTkLeave=function(){__log.push("leave");return o.apply(this,arguments);};})()');};
    const M=load(src,{session:USERS.mustafa});
    setup(M);
    await M.show('prod-ops');
    const rows=M.dom.byClass(M.panel(),'phm-att-row');
    const opens=r=>M.dom.all(r,n=>n.getAttribute&&n.getAttribute('data-act')==='open-po');
    o['open PO: a manager gets an Open button on every attention row (4 rows, 4 buttons), naming the PO']=rows.length===4&&rows.every(r=>opens(r).length===1)&&/^Open PO-103$/.test(M.text(opens(rows[0])[0]))&&/detail page of PO-103/.test(opens(rows[0])[0].getAttribute('aria-label'));
    o['open PO: showing the buttons opened nothing']=M.ctx.__log.length===0;
    M.dom.click(opens(rows[0])[0]);
    o['open PO: pressing it leaves the Production Ops takeover FIRST, then calls openPODetail with that PO']=J(M.ctx.__log)===J(['leave','open:PO-103']);
    // the drawer behind the Needs attention tile
    const D=load(src,{session:USERS.afnan});
    setup(D);
    await D.show('prod-ops');
    D.dom.click(D.main('attention'));
    const dBtns=D.dom.all(D.drawer(),n=>n.getAttribute&&n.getAttribute('data-act')==='open-po');
    o['open PO: the Needs attention drawer rows carry the button too (owner)']=D.drawerRows().length===4&&dBtns.length===4;
    D.dom.click(dBtns[1]);
    o['open PO: from the drawer it closes the drawer, leaves the takeover, then opens the PO']=!D.drawer()&&J(D.ctx.__log)===J(['leave','open:'+dBtns[1].getAttribute('data-po')]);
    const D2=load(src,{session:USERS.afnan});
    setup(D2);
    await D2.show('prod-ops');
    D2.dom.click(D2.main('stuck'));
    o['open PO: the other tiles\' drawers (Stuck POs) have NO Open button (only the attention rows do)']=D2.drawerRows().length>0&&D2.dom.all(D2.drawer(),n=>n.getAttribute&&n.getAttribute('data-act')==='open-po').length===0;
    // Kashif
    const U=load(src,{session:USERS.uzaib});
    setup(U);
    await U.show('prod-ops');
    // WP10: Kashif's Overview is the short view and he has no Monitor tab, so the attention card is rendered through the Monitor builder directly (what a
    // build that showed it to him would draw): plain text rows, no Open button, because phmCanOpenPO() reads HIS session.
    await U.R('phmLoadPos(true)');   // he lands on Today's Cutting now, so Monitor's own read of pos has not run
    const mon=U.R('(function(){const h=document.createElement("div");_phmRenderMonitor(h,_phUiCtx(PH_TABS.filter(function(t){return t.id==="monitor";})[0]));return h;})()');
    o['open PO: uzaib (Kashif) sees the attention rows as plain text, NO Open button']=U.dom.byClass(mon,'phm-att-row').length===4&&U.dom.all(mon,n=>n.getAttribute&&n.getAttribute('data-act')==='open-po').length===0;
    U.R('phGoTab("overview")');
    o['open PO: and his real Overview (the short view) has no attention rows and no Open button at all']=U.dom.byClass(U.panel(),'phm-att-row').length===0&&U.dom.all(U.panel(),n=>n.getAttribute&&n.getAttribute('data-act')==='open-po').length===0;
    o['open PO: phmOpenPO refuses him and calls nothing']=U.R('phmOpenPO("PO-103")')===false&&U.ctx.__log.length===0;
    // no openPODetail in this build: no button, nothing thrown
    const N=load(src,{session:USERS.mustafa});
    await N.show('prod-ops');
    o['open PO: without openPODetail (an older build) there is no button']=N.dom.byClass(N.panel(),'phm-att-row').length===4&&N.dom.all(N.panel(),n=>n.getAttribute&&n.getAttribute('data-act')==='open-po').length===0&&N.R('phmOpenPO("PO-103")')===false;
    o['open PO: an id that is not a plain PO key is refused']=M.R('phmOpenPO("PO-103/../x")')===false&&M.R('phmOpenPO("")')===false;
  });
  /* ── the audience ── */
  await sec(async()=>{
    const U=load(src,{session:USERS.uzaib});
    await U.show('prod-ops');
    U.R('phGoTab("overview")');await settle(60);   // WP10: he lands on Today's Cutting now; his Overview is the short view (no tiles, no per-page View only chip)
    o['uzaib: Overview is the SHORT view: a jobs line and one button, no tiles, no per-page View only chip']=U.tiles().length===0&&!/View only/.test(U.text(U.panel()))&&U.dom.byClass(U.panel(),'phm-floor').length===1&&/planned today/.test(U.text(U.panel()));
    o['uzaib: no button leads to the Monitor (he is not allowed it) and phGoTab refuses it']=!U.btn('Open the Monitor')&&U.R('phGoTab("monitor")')===false;
    o['uzaib: nothing was written']=U.fk.writes.length===0;
    const M=load(src,{session:USERS.mustafa});
    await M.show('prod-ops');
    o['a manager (mustafa): Overview has the Open the Monitor button and the Monitor tab opens']=!!M.btn('Open the Monitor')&&(M.dom.click(M.btn('Open the Monitor')),await settle(),M.tiles().length===12);
    const R=load(src,{session:USERS.raees});
    await R.show('prod-ops');
    o['raees (off the audience): no tab content, no PO read at all']=R.tiles().length===0&&!R.fk.reads.pos;
    const Q=load(src,{session:USERS.claude});
    await Q.show('prod-ops');
    o['the QA account sees nothing and reads nothing']=Q.tiles().length===0&&!Q.fk.reads.pos;
    const X=load(src);X.as(null);
    o['signed out: no tab (so no render function) is reachable']=X.R('phTabsFor().length')===0&&X.R('phGoTab("monitor")')===false;
  });
  /* ── source scans ── */
  await sec(async()=>{
    const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:\\])\/\/[^\n]*/g,'$1');
    o['read-only: the source calls no Firestore write API']=!/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction|arrayUnion|serverTimestamp)\s*\(/.test(code);
    o['read-only: the source calls no ph-write.js function']=!/\bph(Save|Mark|Master|Standard|Settings?Save|Draft|Abandon|Send|Set|Create|Retire|Build)[A-Za-z]*\s*\(/.test(code.replace(/phSettings\(/g,'').replace(/phMarkOf\(|phMarksState\(/g,''))   /* WP10: phMarkOf / phMarksState are READS (the hold lines) */&&!/\b_phSilent\b|_phLog\b|logActivity\s*\(/.test(code);
    o['XSS: the source never assigns innerHTML/outerHTML or parses a string as HTML']=!/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|DOMParser|document\.write|\beval\s*\(|new Function/.test(code);
    o['the only collection it reads itself is pos']=(code.match(/collection\(db,'[^']+'/g)||[]).join()==="collection(db,'pos'"&&!/\bgetDoc\(/.test(code);
    o['every rule comes from ph-core: the source calls phPipeline, phReport, phAllocate, phLeadTime, phDelayGap, phCutCheck, phStageOf, phPoUnits and phSettings']=['phPipeline','phReport','phAllocate','phLeadTime','phDelayGap','phCutCheck','phStageOf','phPoUnits','phSettings'].every(f=>new RegExp('\\b'+f+'\\(').test(code));
    const top=(code.match(/^(?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/gm)||[]).map(x=>x.replace(/^(?:const|let|var|function|async function)\s+/,''));
    o['globals: every top-level name is phm / _phm / PHM_ prefixed']=top.length>20&&top.every(n=>/^(phm|_phm|PHM_)/.test(n));
    const others=['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-ui.js'].map(read).join('\n');
    o['globals: none of them is declared by another Production Ops script']=top.every(n=>!new RegExp('^(?:const|let|var|function|async function)\\s+'+n.replace(/\$/g,'\\$')+'\\b','m').test(others));
  });
  /* ── QC8: the QC reconciliation touch points ─────────────────────────────
     The fixture (tests/ph-mod-monitor-qc-fixture.js) is the owner's 120-piece 20/40/40/20 PO in nineteen states; its header lists, per PO, the list it must
     land in. Allowances under the 2 % rule: S 0, M 1, L 1, XL 0, total 2. Clock: Mon 12 Oct 2026 09:00 PKT, idle limit 3 days, look-back 7 days. */
  qcPhase=true;
  const ids2=l=>l.map(r=>r.id).join();
  const allNull=q=>Object.keys(q.counts).every(k=>q.counts[k]===null);
  await sec(async()=>{
    const T=load(src);
    const bq=over=>{const b=qcfx.build();T.ctx.__q=Object.assign({now:qcfx.NOW,pos:b.pos,recon:b.recon,lots:b.lots,loading:{},errors:{},truncated:{}},over||{});return vm.runInContext('phmQcBuild(__q)',T.ctx);};
    const Q=bq();
    o['qc model: ready = PO-201 (exact), 202 (119, 1 short inside the allowance), 203 (121, 1 over inside it), 210 (exact) -> 4']=Q.counts.ready===4&&ids2(Q.lists.ready)==='PO-201,PO-202,PO-203,PO-210';
    o['qc model: ready rows say how close: exact / 1 short inside the 2 % allowance / 1 over inside it']=/120 of 120 received — exact/.test(Q.lists.ready[0].detail)&&/119 of 120 received — 1 short, inside the 2 % allowance/.test(Q.lists.ready[1].detail)&&/121 of 120 received — 1 over, inside the 2 % allowance/.test(Q.lists.ready[2].detail);
    o['qc model: short = PO-204 only (M 2 short > allowance 1, though the total 118 is inside its allowance of 2), worded per size']=Q.counts.short===1&&ids2(Q.lists.short)==='PO-204'&&/118 of 120 received — M is 2 short \(allowance 1\)/.test(Q.lists.short[0].detail);
    o['qc model: receiving = PO-205, 206, 218 (100 of 120, 20 XL still expected) -> 3']=Q.counts.receiving===3&&ids2(Q.lists.receiving)==='PO-205,PO-206,PO-218'&&/100 of 120 received — 20 XL still expected/.test(Q.lists.receiving[0].detail);
    o['qc model: idle = PO-207 (at QC 5 days, no lot), 206 (newest lot 4 days ago), 218 (exactly 3 days: the boundary counts), longest first -> 3']=Q.counts.idle===3&&ids2(Q.lists.idle)==='PO-207,PO-206,PO-218'&&/At QC for 5 days/.test(Q.lists.idle[0].detail)&&/No new lot for 4 days/.test(Q.lists.idle[1].detail)&&/No new lot for 3 days/.test(Q.lists.idle[2].detail);
    o['qc model: not idle - PO-205 (newest lot 2 days ago), PO-208 (at QC 1 day), PO-219 (still at stitching: it has not reached QC)']=['PO-205','PO-208','PO-219'].every(id=>Q.lists.idle.every(r=>r.id!==id));
    o['qc model: a PO at QC whose washing has no finish date is not judged late - it is counted apart (1: PO-209)']=Q.idleNoDate===1&&Q.lists.idle.every(r=>r.id!=='PO-209');
    o['qc model: drift = PO-210 (locked M 40, the PO now says 45) with the sizes named']=Q.counts.drift===1&&ids2(Q.lists.drift)==='PO-210'&&/Locked cut 120; the PO now records 125 \(M 40 → 45\)/.test(Q.lists.drift[0].detail);
    o['qc model: closed with a shortfall = PO-211 only (closed 2 days ago, close_short); PO-212 closed 10 days ago and PO-213 closed clean are not listed']=Q.counts.closedShort===1&&ids2(Q.lists.closedShort)==='PO-211'&&/Closed by Mustafa 2 days ago with 118 of 120 received \(2 short\) — lost in line: two lost in the line/.test(Q.lists.closedShort[0].detail);
    o['qc model: voided = 2 POs (PO-201 two lots, PO-204 one) and 3 lots; the lot voided 8 days ago on PO-202 is outside the 7 days']=Q.counts.voided===2&&Q.lotsVoided===3&&ids2(Q.lists.voided)==='PO-201,PO-204'&&/2 lots voided in the last 7 days — latest yesterday by faizan: wrong size/.test(Q.lists.voided[0].detail);
    o['qc model: a void lot is never received - PO-201 stays exact (the 5 and 3 voided pieces are not added)']=/120 of 120 received — exact/.test(Q.lists.ready[0].detail);
    o['qc model: cancelled, reserved and a classic-completed PO that was never reconciled appear in no list']=['PO-214','PO-215','PO-216'].every(id=>Object.keys(Q.lists).every(k=>Q.lists[k].every(r=>r.id!==id)));
    o['qc model: a PO ph-core cannot judge (PO-217: a lot with an unknown status) is named in notJudged with the reason, not dropped and not counted']=Q.notJudged.length===1&&Q.notJudged[0].id==='PO-217'&&/status is neither live nor void/.test(Q.notJudged[0].detail)&&Object.keys(Q.lists).every(k=>Q.lists[k].every(r=>r.id!=='PO-217'));
    o['qc model: everything was read -> state ok, nothing pending or failed, nothing truncated']=Q.state==='ok'&&!Q.failed.length&&!Q.pending.length&&!Q.truncated.length;
    // honest states
    const L=bq({lots:null,errors:{po_qc_lots:'po_qc_lots: could not be read - republish'}});
    o['qc failed: lots not read -> ready, short, receiving, idle, drift and voided are null (NEVER 0) and name po_qc_lots']=['ready','short','receiving','idle','drift','voided'].every(k=>L.counts[k]===null&&L.unavail[k].join()==='po_qc_lots'&&L.lists[k].length===0)&&L.failed.join()==='po_qc_lots';
    o['qc failed: closed-with-a-shortfall needs only po_qc_recon, so it is still 1 when lots failed']=L.counts.closedShort===1&&ids2(L.lists.closedShort)==='PO-211'&&L.state==='partial';
    const R=bq({recon:null});
    o['qc failed: recon not read -> voided (needs only lots) is still 2 POs; closed-with-a-shortfall is null']=R.counts.voided===2&&R.counts.closedShort===null&&R.unavail.closedShort.join()==='po_qc_recon'&&R.counts.ready===null;
    const P=bq({pos:null});
    o['qc failed: pos not read -> the PO lists are null, closed-with-a-shortfall and voided still count (their rows fall back to the bare PO id)']=P.counts.ready===null&&P.counts.closedShort===1&&P.counts.voided===2&&P.lists.closedShort[0].title==='PO-211'&&P.lists.closedShort[0].stage===null;
    const A=bq({pos:null,recon:null,lots:null,errors:{po_qc_recon:'e1',po_qc_lots:'e2'}});
    o['qc failed: everything unread -> every count null, state unavailable, nothing printed as 0']=allNull(A)&&A.state==='unavailable';
    const W=bq({recon:null,lots:null,loading:{po_qc_recon:true,po_qc_lots:true}});
    o['qc pending: stages still being read are pending, not failed (the card says "reading", not "unavailable")']=W.pending.join()==='po_qc_recon,po_qc_lots'&&!W.failed.length&&W.counts.ready===null;
    const Tr=bq({truncated:{pos:true,po_qc_lots:true}});
    o['qc truncated: a read that hit its limit is reported by name (pos, po_qc_lots)']=Tr.truncated.join()==='pos,po_qc_lots';
    o['qc model: an empty book that WAS read is a real zero (0), not unavailable']=(()=>{const E=bq({pos:[],recon:[],lots:[]});return Object.keys(E.counts).every(k=>E.counts[k]===0)&&E.state==='ok';})();
    o['qc model: the model never changes its inputs']=(()=>{const b=qcfx.build(),before=JSON.stringify(b);T.ctx.__q={now:qcfx.NOW,pos:b.pos,recon:b.recon,lots:b.lots};vm.runInContext('phmQcBuild(__q)',T.ctx);return JSON.stringify(b)===before;})();
    o['qc model: the two day limits are stated defaults - idle 3 days, look-back 7 days']=T.R('PHM_QC_IDLE_DAYS')===3&&T.R('PHM_QC_RECENT_DAYS')===7;
    o['qc model: the look-back equals the Afloat tab\'s closed list (PHAF_CLOSED_DAYS), so a closed PO listed here is still on that tab']=(()=>{const m=/const PHAF_CLOSED_DAYS=(\d+);/.exec(read('js/ph-mod-afloat.js'));return !!m&&+m[1]===T.R('PHM_QC_RECENT_DAYS');})();
    // the same rule as the Afloat tab (ph-core's phQcReconcile + phQcGroup): its Ready group = my ready + my short
    vm.runInContext(read('js/ph-mod-afloat.js'),T.ctx,{filename:'ph-mod-afloat.js'});
    const b2=qcfx.build();T.ctx.__a={pos:b2.pos,recon:b2.recon,lots:b2.lots};
    const AF=vm.runInContext('phqcModel(__a.pos,__a.recon,__a.lots,{now:'+qcfx.NOW+'}).counts',T.ctx);
    o['qc model: agrees with the Afloat tab - its Ready group (ready + short, 5) minus its short count (1) is my ready (4), and its short is my short (1)']=AF.ready===5&&AF.short===1&&AF.ready-AF.short===Q.counts.ready&&AF.short===Q.counts.short;
  });
  /* ── the Overview card, the Monitor groups, the jump to Afloat POs ── */
  await sec(async()=>{
    const T=load(src,{data:qcfx.dbData()});
    await T.show('prod-ops');await settle(120);
    const card=()=>T.dom.all(T.panel(),n=>n.getAttribute&&n.getAttribute('data-card')==='qc')[0]||null;
    const line=k=>{const c=card();return c?T.dom.all(c,n=>n.getAttribute&&n.getAttribute('data-qc-line')===k)[0]||null:null;};
    const chip=k=>{const l=line(k);return l?l.children[0].children[1].textContent:null;};
    o['qc card: a manager\'s Overview has the card, titled QC reconciliation']=!!card()&&/QC reconciliation/.test(T.text(card()));
    o['qc card: counts - ready 4, short 1, receiving 3, no new lot 3, cut changed 1, closed with a shortfall 1, voided "2 POs · 3 lots"']=chip('ready')==='4'&&chip('short')==='1'&&chip('receiving')==='3'&&chip('idle')==='3'&&chip('drift')==='1'&&chip('closedShort')==='1'&&chip('voided')==='2 POs · 3 lots';
    o['qc card: every line is a glyph AND a word (the colour is a third cue)']=['ready','short','receiving','idle','drift','closedShort','voided'].every(k=>/^[●✗◐◷△↺] \S/.test(line(k).children[0].children[0].textContent));
    o['qc card: the data was read once - one read of po_qc_recon and one of po_qc_lots after several repaints']=T.fk.reads.po_qc_recon===1&&T.fk.reads.po_qc_lots===1;
    o['qc card: Show the POs on the short line opens the list: PO-204 with its worded reason and an Open in Afloat POs button']=(()=>{
      const b=T.dom.all(line('short'),n=>n.tagName==='BUTTON'&&n.getAttribute('data-act')==='qc-list')[0];
      if(!b)return false;T.dom.click(b);
      const rows=T.drawerRows();
      return rows.length===1&&/PO-204/.test(T.text(rows[0]))&&/M is 2 short \(allowance 1\)/.test(T.text(rows[0]))&&T.dom.all(rows[0],n=>n.getAttribute&&n.getAttribute('data-act')==='open-qc').length===1&&!T.dom.all(rows[0],n=>n.getAttribute&&n.getAttribute('data-act')==='open-po').length;
    })();
    // the jump: Afloat clears an opened PO it has no tile for, so its own pos read has to land first
    const log=[];
    let landed;const gate1=new Promise(r=>{landed=r;});
    T.ctx.phqcLoadPos=function(){log.push('load');return gate1.then(()=>{log.push('loaded');return{state:'ok'};});};
    T.ctx.phqcOpen=function(id){log.push('open:'+id+'@'+T.R('_phUiTab'));};
    const ob=T.dom.all(T.drawer(),n=>n.getAttribute&&n.getAttribute('data-act')==='open-qc')[0];
    T.dom.click(ob);await settle(20);
    o['qc open: the drawer closes, Afloat\'s own pos read is awaited, and the PO is opened only after it has landed']=!T.drawer()&&log.join()==='load'&&T.R('_phUiTab')==='overview';
    landed();await settle(40);
    o['qc open: then the shell is on the afloat tab (deep link #prodops/afloat) and phqcOpen(PO-204) ran there']=log.join()==='load,loaded,open:PO-204@afloat'&&T.R('_phUiTab')==='afloat'&&T.calls.some(u=>/#prodops\/afloat$/.test(u));
    T.R('phGoTab("overview")');await settle(60);
    o['qc open: the Overview still works after coming back from the jump']=!!card();
    // no Afloat module (an older build): the jump still lands on the tab
    const N=load(src,{data:qcfx.dbData()});
    await N.show('prod-ops');await settle(100);
    o['qc open: without the Afloat module phmQcOpen still switches to the tab and calls nothing else']=N.R('phmQcOpen("PO-204")')===true&&N.R('_phUiTab')==='afloat';
    o['qc open: an id that is not a plain PO key is refused']=N.R('phmQcOpen("PO-204/../x")')===false&&N.R('phmQcOpen("")')===false;
    // Monitor tab
    const M=load(src,{data:qcfx.dbData()});
    await M.show('prod-ops');await settle(100);
    const qcGroups=()=>M.dom.all(M.panel(),n=>/^qc-/.test((n.getAttribute&&n.getAttribute('data-att-group'))||''));
    const overviewGroups=qcGroups().length;
    M.R('phGoTab("monitor")');await settle(100);
    const groups=qcGroups();
    const gid=g=>g.getAttribute('data-att-group');
    o['qc monitor: Needs attention gets exactly five QC groups, in this order: short, cut changed, no new lot, closed with a shortfall, voided']=groups.map(gid).join()==='qc-short,qc-drift,qc-idle,qc-closedShort,qc-voided';
    o['qc monitor: ready and receiving are normal flow and are NOT attention groups; the Overview\'s attention card has no QC groups at all']=!groups.some(g=>/ready|receiving/.test(gid(g)))&&overviewGroups===0;
    const rowsOf=g=>M.dom.all(g,n=>n.getAttribute&&n.getAttribute('data-qc-po')).map(n=>n.getAttribute('data-qc-po'));
    o['qc monitor: group rows - short PO-204; cut changed PO-210; no new lot PO-207, 206, 218; closed short PO-211; voided PO-201, 204']=groups.length===5&&rowsOf(groups[0]).join()==='PO-204'&&rowsOf(groups[1]).join()==='PO-210'&&rowsOf(groups[2]).join()==='PO-207,PO-206,PO-218'&&rowsOf(groups[3]).join()==='PO-211'&&rowsOf(groups[4]).join()==='PO-201,PO-204';
    o['qc monitor: every QC row has an "Open ... in Afloat POs" button naming the PO, and no classic Open PO button']=groups.length===5&&M.dom.all(M.panel(),n=>n.getAttribute&&n.getAttribute('data-act')==='open-qc').length===8&&M.dom.all(groups[0],n=>n.getAttribute&&n.getAttribute('data-act')==='open-qc')[0].textContent==='Open PO-204 in Afloat POs'&&M.dom.all(groups[0],n=>n.getAttribute&&n.getAttribute('data-act')==='open-po').length===0;
    o['qc monitor: the existing attention rows are untouched (the stuck / delayed rows are still there)']=M.dom.all(M.panel(),n=>/phm-att-row/.test(n.className||'')).length>=1;
    // the Data sources rows
    const S=T.dom.all(T.panel(),n=>n.getAttribute&&n.getAttribute('data-sources'))[0];
    o['qc sources: the Overview\'s Data sources lists the two QC collections, loaded']=!!S&&/po_qc_recon/.test(T.text(S))&&/po_qc_lots/.test(T.text(S))&&S.getAttribute('data-sources')==='ok';
  });
  /* ── failed reads on the screen: named, never 0, not re-read in a loop ── */
  await sec(async()=>{
    const BOOM=()=>Object.assign(new Error('boom'),{code:'unavailable'});
    const T=load(src,{data:qcfx.dbData(),db:{fail:{po_qc_lots:BOOM}}});
    await T.show('prod-ops');await settle(120);
    const card=T.dom.all(T.panel(),n=>n.getAttribute&&n.getAttribute('data-card')==='qc')[0];
    const line=k=>T.dom.all(card,n=>n.getAttribute&&n.getAttribute('data-qc-line')===k)[0];
    const chip=k=>line(k).children[0].children[1].textContent;
    o['qc card failed: lots refused -> the six lists say "unavailable — po_qc_lots", none says 0']=['ready','short','receiving','idle','drift','voided'].every(k=>chip(k)==='unavailable — po_qc_lots');
    o['qc card failed: closed with a shortfall (needs only po_qc_recon) still counts 1']=chip('closedShort')==='1';
    o['qc card failed: the card names the failure in an alert and offers Retry the QC reads']=T.dom.all(card,n=>n.getAttribute&&n.getAttribute('role')==='alert'&&/po_qc_lots/.test(n.textContent)).length===1&&!!T.dom.all(card,n=>n.getAttribute&&n.getAttribute('data-act')==='qc-retry')[0];
    o['qc card failed: no "Show the POs" button on an unavailable line']=T.dom.all(line('ready'),n=>n.tagName==='BUTTON').length===0;
    const r1=T.fk.reads.po_qc_lots;
    T.ctx.phGoTab('monitor');await settle(60);T.ctx.phGoTab('overview');await settle(60);
    o['qc card failed: a failed stage is read once, then NOT re-read by repaints (no loop on a persistent refusal)']=r1===1&&T.fk.reads.po_qc_lots===1;
    o['qc card failed: the Data sources card opens itself and marks po_qc_lots FAILED']=(()=>{const S=T.dom.all(T.panel(),n=>n.getAttribute&&n.getAttribute('data-sources'))[0];return !!S&&S.getAttribute('data-sources')==='failed'&&/po_qc_lots/.test(T.text(S))&&/FAILED/.test(T.text(S));})();
    T.ctx.phGoTab('monitor');await settle(80);
    o['qc card failed: Monitor says it too - the unavailable kinds are named, the short group is not drawn empty']=/unavailable — po_qc_lots/.test(T.text(T.panel()))&&T.dom.all(T.panel(),n=>(n.getAttribute&&n.getAttribute('data-att-group'))==='qc-short').length===0;
    // Retry re-reads only what failed
    T.ctx.phGoTab('overview');await settle(60);
    const rb=T.dom.all(T.panel(),n=>n.getAttribute&&n.getAttribute('data-act')==='qc-retry')[0];
    const rc0=T.fk.reads.po_qc_recon;
    if(rb)T.dom.click(rb);
    await settle(80);
    o['qc card failed: Retry the QC reads re-reads po_qc_lots again and not po_qc_recon']=!!rb&&T.fk.reads.po_qc_lots===2&&T.fk.reads.po_qc_recon===rc0;
    // an offline-copy answer is a failure
    const C=load(src,{data:qcfx.dbData(),db:{cachePaths:['po_qc_recon']}});
    await C.show('prod-ops');await settle(120);
    const cc=C.dom.all(C.panel(),n=>n.getAttribute&&n.getAttribute('data-card')==='qc')[0];
    o['qc card failed: an answer from the device\'s offline copy is not a read - po_qc_recon is named unavailable (not an empty list)']=!!cc&&/unavailable — po_qc_recon/.test(C.text(cc))&&/offline copy/.test(C.text(cc))&&C.dom.all(cc,n=>n.getAttribute&&n.getAttribute('data-qc-line')==='closedShort')[0].children[0].children[1].textContent==='unavailable — po_qc_recon';
    // Refresh reads both again
    const F=load(src,{data:qcfx.dbData()});
    await F.show('prod-ops');await settle(120);
    const rf=F.btn('Refresh');
    if(rf)F.dom.click(rf);
    await settle(120);
    o['qc refresh: Refresh re-reads both QC collections (2 reads each in all)']=!!rf&&F.fk.reads.po_qc_recon===2&&F.fk.reads.po_qc_lots===2;
  });
  /* ── who sees it: managers only ── */
  await sec(async()=>{
    const U=load(src,{session:USERS.uzaib,data:qcfx.dbData()});
    await U.show('prod-ops');U.R('phGoTab("overview")');await settle(100);
    o['qc audience: Kashif (uzaib) - no QC card on his Overview and not one QC collection read']=U.dom.all(U.panel(),n=>n.getAttribute&&n.getAttribute('data-card')==='qc').length===0&&!U.fk.reads.po_qc_recon&&!U.fk.reads.po_qc_lots&&!/QC reconciliation/.test(U.text(U.panel()));
    o['qc audience: Kashif cannot jump (phmQcOpen refuses him) and cannot reach the Monitor']=U.R('phmQcOpen("PO-204")')===false&&U.R('phGoTab("monitor")')===false&&U.R('_phUiTab')!=='afloat';
    const Fz=load(src,{session:USERS.faizan,data:qcfx.dbData()});
    await Fz.show('prod-ops');await settle(100);
    o['qc audience: Faizan\'s tab list is exactly [afloat] - he has neither Overview nor Monitor, so he gets none of this']=Fz.R('JSON.stringify(phTabsFor("faizan").map(t=>t.id))')==='["afloat"]'&&Fz.R('phGoTab("overview")')===false&&Fz.R('phGoTab("monitor")')===false;
    o['qc audience: Faizan\'s takeover draws no QC card, no Monitor tile and reads nothing from this file (no pos, no QC collection)']=Fz.dom.all(Fz.panel()||Fz.dom.body,n=>n.getAttribute&&(n.getAttribute('data-card')==='qc'||n.getAttribute('data-tile'))).length===0&&!Fz.fk.reads.pos&&!Fz.fk.reads.po_qc_recon&&!Fz.fk.reads.po_qc_lots;
    o['qc audience: phmQcOpen refuses Faizan too (the jump is a manager\'s from the Monitor; he is already on Afloat POs)']=Fz.R('phmQcOpen("PO-204")')===false;
    const Rs=load(src,{session:USERS.raees,data:qcfx.dbData()});
    await Rs.show('prod-ops');await settle(60);
    o['qc audience: Raees (off the audience) reads nothing at all']=!Rs.fk.reads.po_qc_recon&&!Rs.fk.reads.po_qc_lots&&!Rs.fk.reads.pos&&Rs.dom.all(Rs.panel()||Rs.dom.body,n=>n.getAttribute&&n.getAttribute('data-card')==='qc').length===0;
    const G=load(src,{data:qcfx.dbData()});
    G.R('_phmQcEnsure({canManage:false,repaint(){}},false)');G.R('_phmQcEnsure({canManage:false,repaint(){}},true)');await settle(40);
    o['qc audience: _phmQcEnsure on a non-manager context reads nothing, even forced']=!G.fk.reads.po_qc_recon&&!G.fk.reads.po_qc_lots;
    // text from a user is text
    const X=qcfx.dbData();
    X.po_qc_recon.filter(r=>r.poId==='PO-211')[0].overrides[0].reason='<img src=x onerror=alert(1)>';
    X.po_qc_lots.filter(l=>l.status==='void'&&l.poId==='PO-201')[0].voidReason='<script>alert(2)</script>';
    const H=load(src,{data:X});
    await H.show('prod-ops');H.R('phGoTab("monitor")');await settle(120);
    o['qc XSS: a hostile close reason and void reason reach the Monitor as text only (no img, no script element)']=/<img src=x onerror=alert\(1\)>/.test(H.text(H.panel()))&&/<script>alert\(2\)<\/script>/.test(H.text(H.panel()))&&H.dom.all(H.panel(),n=>n.tagName==='IMG'||n.tagName==='SCRIPT').length===0;
    o['qc read-only: nothing was written by any of these runs']=H.fk.writes.length===0&&G.fk.writes.length===0&&U.fk.writes.length===0;
  });
  await sec(async()=>{
    const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:\\])\/\/[^\n]*/g,'$1');
    o['qc source: the QC rules come from ph-core (phQcReconcile, phQcGroup) - this file calls both and re-implements neither allowance nor verdict']=/\bphQcReconcile\(/.test(code)&&/\bphQcGroup\(/.test(code)&&!/\bphQcAllowance\(|\bphQcVerdict\(|\bphQcReceived\(/.test(code);
    o['qc source: it reads the QC collections only through the data layer (phLoadStage), never collection(db, po_qc_*)']=/\bphLoadStage\(/.test(code)&&!/collection\(db,\s*'po_qc/.test(code);
    o['qc source: no strings added to js/ph-i18n.js - the QC lines are plain English (they would need Urdu pairs)']=!/phI18nD\('(qc|afloat)\./.test(code.split('/* ── QC reconciliation model')[1]||'');
  });
  o['every check section ran to the end (none threw)']=threw.length===0;
  if(threw.length)o['(sections that threw)']=threw.join(' | ');
  return o;
}

const secOf=f=>/^qc (model|failed|pending|truncated):/.test(f)?1:/^qc (card failed|refresh)/.test(f)?3:/^qc (card|open|monitor|sources):/.test(f)?2:/^qc (audience|XSS|read-only)/.test(f)?4:/^qc source/.test(f)?5:0;
module.exports=async function(){
  const s=suite('ph-mod-monitor');
  s.section('Monitor and Overview over the real shell');
  const keySec={};
  const base=await checks(SRC,{keySecOut:keySec});
  Object.keys(base).forEach(k=>{if(k==='(sections that threw)')return s.ok('no section threw: '+base[k],false);s.ok(k,base[k]===true);});

  s.ok('QC8 break routing: every qc check is mapped to the section it really lives in (a wrong map would run the wrong section and fake a failure)',Object.keys(base).filter(k=>/^qc /.test(k)).every(k=>secOf(k)===keySec[k]&&secOf(k)>0));
  s.section('wiring: script order, precache, the tabs, the audience');
  const IDX=read('index.html'),SW=read('sw.js');
  const iUi=IDX.indexOf('<script src="/js/ph-ui.js'),iMon=IDX.indexOf('<script src="/js/ph-mod-monitor.js');
  s.ok('index.html loads js/ph-mod-monitor.js once, after js/ph-ui.js',iUi>0&&iMon>iUi&&(IDX.match(/ph-mod-monitor\.js/g)||[]).length===1);
  s.ok('the script is loaded before the Firebase module (it is a classic script)',iMon<IDX.indexOf('<script type="module">'));
  s.ok('sw.js precaches it after js/ph-ui.js',SW.indexOf("'/js/ph-mod-monitor.js'")>SW.indexOf("'/js/ph-ui.js'")&&SW.indexOf("'/js/ph-ui.js'")>0);
  {
    const T=load(SRC);
    s.ok('the overview and monitor tabs render with this file\'s functions, and the others are still the shell\'s placeholders',T.R('PH_TABS.filter(t=>t.id==="overview")[0].render===_phmRenderOverview&&PH_TABS.filter(t=>t.id==="monitor")[0].render===_phmRenderMonitor&&PH_TABS.filter(t=>!/^(overview|monitor)$/.test(t.id)).every(t=>t.render!==_phmRenderOverview&&t.render!==_phmRenderMonitor)'));
    s.ok('the audience is the shell\'s: Overview for all four, Monitor for the three managers only',T.R('JSON.stringify(["afnan","ammar","mustafa","uzaib","raees"].map(u=>phTabsFor(u).filter(t=>t.id==="overview"||t.id==="monitor").map(t=>t.id)))')===JSON.stringify([['overview','monitor'],['overview','monitor'],['overview','monitor'],['overview'],[]]));
    s.ok('the Escape guard is registered once at load',T.R('PH_ESCAPE_GUARDS.indexOf(_phmEscape)>-1&&PH_ESCAPE_GUARDS.filter(f=>f===_phmEscape).length===1'));
  }

  s.section('stylesheet contract (geometry the harness cannot lay out)');
  const a0=CSS.indexOf('/* ph-mod-monitor START */'),b0=CSS.indexOf('/* ph-mod-monitor END */');
  const blk=CSS.slice(a0,b0).replace(/\/\*[\s\S]*?\*\//g,'');
  s.ok('the block exists, is delimited and sits in the trailing run of ph-mod-* blocks at the END of the stylesheet',a0>0&&b0>a0&&CSS.slice(b0+'/* ph-mod-monitor END */'.length).replace(/\/\* ph-mod-[a-z]+ START \*\/[\s\S]*?\/\* ph-mod-[a-z]+ END \*\//g,'').trim()==='');
  s.ok('tokens only: no literal colour',!/#[0-9a-fA-F]{3,8}\b/.test(blk)&&!/\b(?:rgb|rgba|hsl|hsla)\(/.test(blk));
  s.ok('every selector is .phm- prefixed',(blk.match(/[^{}]+(?=\{)/g)||[]).filter(x=>!/^\s*@(media|keyframes)/.test(x)&&!/^\s*(from|to)\s*$/.test(x)).every(sel=>sel.split(',').every(p=>/phm-/.test(p))));
  s.ok('no text under 12px',!/font-size:(?:[0-9]|10|11)(?:\.\d+)?px/.test(blk));
  s.ok('touch targets: a tile button, a sub-link, a range chip, a date field, Refresh, Close and Show all are 44px high',/button\.phm-tile-main\{[^}]*min-height:44px/.test(blk)&&/\.phm-sublink\{[^}]*min-height:44px/.test(blk)&&/\.phm-chip-btn\{min-height:44px/.test(blk)&&/\.phm-date\{min-height:44px/.test(blk)&&/\.phm-more,\.phm-refresh,\.phm-drawer-close,\.phm-actions \.ph-btn\{min-height:44px\}/.test(blk));
  s.ok('tiles stack to one column on a phone',/@media \(max-width:600px\)\{[\s\S]*\.phm-grid\{grid-template-columns:1fr\}/.test(blk));
  s.ok('the drawer sits under the top bar (z-index 122, under the bug FAB) and is full width above the dock on a phone',/\.phm-drawer-wrap\{[^}]*top:var\(--ph-tk-bar,52px\)[^}]*z-index:122/.test(blk)&&/\.phm-drawer-wrap\{left:0;bottom:calc\(var\(--ph-tk-dock,60px\) \+ env\(safe-area-inset-bottom\)\)\}/.test(blk)&&/\.phm-drawer\{width:100%/.test(blk));
  s.ok('prefers-reduced-motion drops the drawer animation',/prefers-reduced-motion:reduce\)\{\.phm-drawer\{animation:none\}\}/.test(blk));
  s.ok('a focus ring is drawn on the tile button, sub-link, chips and drawer close',/button\.phm-tile-main:focus-visible[^{]*\{outline:2px solid var\(--text\)/.test(blk));
  s.ok('the ink on the active range chip is --on-dark (anything painted on --dark takes its ink from it)',/\.phm-chip-btn\.on\{[^}]*background:var\(--dark\)[^}]*color:var\(--on-dark\)/.test(blk));
  s.ok('a stuck/over-gate chip and a delayed chip carry a glyph and a word as well as a colour',(function(){const I=read('js/ph-i18n.js');return /ov\.reason_stuck/.test(SRC)&&/ov\.reason_delayed/.test(SRC)&&/ov\.reason_gate/.test(SRC)&&/'ov\.reason_stuck','▲ Stuck'/.test(I)&&/'ov\.reason_delayed','◆ Delayed'/.test(I)&&/'ov\.reason_gate','■ Over the cut gate'/.test(I);})());

  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    if(process.env.PH_MON_QC_ONLY==='1'&&!/^QC:/.test(label))return;   // a local shortcut (CI never sets it): only the QC8 breaks, when the machine is busy
    const pairs=Array.isArray(from)?from:[[from,to]];
    let mut=SRC;
    for(const [f,t] of pairs){
      if(mut.split(f).length-1<1){s.ok('break target exists: '+label+' ('+f.slice(0,50)+')',false);return;}
      mut=mut.split(f).join(t);
    }
    // which sections can possibly hold the named checks: the older ones (keys not starting "qc "), and the QC8 sections 1 model, 2 card/monitor/open, 3 failed reads, 4 audience, 5 source
    const qcKeys=failing.filter(f=>/^qc /.test(f)),hasOld=failing.some(f=>!/^qc /.test(f));
    const ropts={skipOld:!hasOld,skipQc:qcKeys.length===0,qcSecs:new Set(qcKeys.map(secOf))};
    let r;try{r=await checks(mut,ropts);}catch(e){s.ok('break "'+label+'" still loads and runs (it threw: '+String(e&&e.message).slice(0,80)+')',false);return;}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f.slice(0,90)+'"',r[f]!==true);});
  };
  const K=prefix=>Object.keys(base).filter(k=>k.indexOf(prefix)===0);
  await brk('Open on the attention rows for everyone',"    if(typeof phmkApply==='function')phmkApply(li,r.fbKey||r.id);\n    if(phmCanOpenPO())li.appendChild(_phmOpenBtn(r));","    if(typeof phmkApply==='function')phmkApply(li,r.fbKey||r.id);\n    li.appendChild(_phmOpenBtn(r));",K('open PO: uzaib (Kashif) sees'));
  await brk('phmOpenPO does not check who',"  if(!phmCanOpenPO()||!/^[A-Za-z0-9_-]{1,60}$/.test(k))return false;","  if(!/^[A-Za-z0-9_-]{1,60}$/.test(k))return false;",K('open PO: phmOpenPO refuses him'));
  await brk('the takeover stays up when a PO opens',"  try{if(typeof _phTkLeave==='function')_phTkLeave();}catch(e){}\n  window.openPODetail(k);","  window.openPODetail(k);",K('open PO: pressing it leaves'));
  await brk('every drawer gets Open buttons',"openable:t.id==='attention'","openable:true",K('open PO: the other tiles'));
  await brk('the attention rows lose the button',"    if(phmCanOpenPO())li.appendChild(_phmOpenBtn(r));\n    return li;","    return li;",K('open PO: a manager gets an Open button'));
  await brk('the PO key is not validated',"!/^[A-Za-z0-9_-]{1,60}$/.test(k)","false",K('open PO: an id that is not a plain PO key'));
  await brk('pipeline counts every PO (reserved and completed too)','value:_phmN(pl.state===\'ok\'?pl.inProduction.pos:0),sub:cnt','value:_phmN(pl.state===\'ok\'?pl.total:0),sub:cnt',K('pipeline: 10 released'));
  await brk('afloat uses the in-production pieces',"value:_phmN(pl.state==='ok'?pl.afloat.units:0)","value:_phmN(pl.state==='ok'?pl.inProduction.units:0)",K('units afloat: 1,050'));
  await brk('reserved POs fall into the pipeline',"const inProd=function(e){return PH_REAL_STAGE_ORDER.indexOf(stageOf(e))>-1;};","const inProd=function(e){return PH_REAL_STAGE_ORDER.indexOf(stageOf(e))>-1||stageOf(e)==='reserved';};",K('pipeline: the list is'));
  await brk('stuck judged on the delayed status',"if(l.status==='stuck'){kind='stuck';","if(l.status==='delayed'){kind='stuck';",K('stuck: 2 ='));
  await brk('a PO with no start date is judged (its creation date used)',"if(l.quality.indexOf('start_from_ts')>-1||l.quality.indexOf('no_issue')>-1){noStart.push(ep);return;}","",K('stuck: PO-104'));
  await brk('an owner-approved over-gate cut is listed',"if(_phmObj(ep.cutOverride)&&ep.cutOverride.by)return;","",K('attention: PO-106 cut 200'));
  await brk('attention sorted by age only',"items.sort(function(a,b){return(PHM_KIND_RANK[b.kind]-PHM_KIND_RANK[a.kind])||(b.age-a.age)","items.sort(function(a,b){return(a.age-b.age)||(PHM_KIND_RANK[b.kind]-PHM_KIND_RANK[a.kind])",K('attention: 4 items'));
  await brk('capacity ignores the weekly off days',"for(let i=0;i<PHM_CAP_DAYS;i++){if(phIsWorkday(phDayAdd(today,i),rawS))wd++;}","for(let i=0;i<PHM_CAP_DAYS;i++){if(phIsWorkday(phDayAdd(today,i),{}))wd++;}",K('load: 29 %'));
  await brk('over capacity never reported',"const status=queued===0?'Nothing queued for cutting':(spill>0?","const status=queued===0?'Nothing queued for cutting':(false?",K('over capacity:'));
  await brk('the queue is allocated without the saved settings',"const alloc=phAllocate(allocIn,Object.assign({},rawS,{startDay:today}));","const alloc=phAllocate(allocIn,{startDay:today});",K('queue delay'));
  await brk('the lead-time average includes a PO with no start date',"if(r.leadTime.noStart>0)mem.noStart.push(ep);","if(r.leadTime.noStart>0){mem.noStart.push(ep);mem.lead.push(ep);}",K('lead time: 2.3'));
  await brk('a list behind a number uses another rule than the report (every PO counted as led)',"if(r.leadTime.n>0)mem.lead.push(ep);","mem.lead.push(ep);",K('drill: every tile'));
  await brk('no cut recorded shows 0 pcs',"_phmNoData('avgCut','Average cut quantity','range',none?'No cut recorded yet':'No cut recorded in this range',","_phmNoData('avgCut','Average cut quantity','range','0 pcs',",K('no cut recorded anywhere').concat(K('no cut recorded: no range')).concat(K('range today: nothing')));
  await brk('an unavailable tile prints a number',"value:phI18nD('ov.unavailable_x',{names:names.join(', ')}),unavailable:names.slice()","value:'0',unavailable:names.slice()",K('pos failed: EVERY tile'));
  await brk('a failed po_cut_jobs still gives a delay gap',"if(!jobsOk)M.tiles.cutGap=_phmUnavail('cutGap','Delay gap, cut vs planned','range',['po_cut_jobs']);\n  else{","if(false)M.tiles.cutGap=null;\n  {",K('po_cut_jobs failed: the two tiles'));
  await brk('defaults are not flagged as defaults',[["function _phmDef(sv,k){return sv.isDefault[k]?' (default)':'';}","function _phmDef(sv,k){return'';}"],["function _phmDefD(sv,k){return sv.isDefault[k]?phI18nD('ov.default_sp'):'';}","function _phmDefD(sv,k){return'';}"],["phI18nD(sv.isDefault.stuckDays?'ov.stuck_sub_def':'ov.t_stuck_sub'","phI18nD(false?'ov.stuck_sub_def':'ov.t_stuck_sub'"]],null,K('settings: capacity and the off day').concat(K('settings unreadable')));
  await brk('the range is ignored by the report',"const rep=phReport(eps,jobsD,rg,O);","const rep=phReport(eps,jobsD,{},O);",K('range today: nothing'));
  await brk('a guessed season is not flagged',"flag:s.guessed?(s.guessed===s.pos?'all guessed':s.guessed+' guessed'):''","flag:''",K('seasons: a guessed season'));
  await brk('a PO read failure is treated as an empty book',"_phmPos={state:'error',rows:null,at:Date.now(),err:err,errText:_phmErrText(err),truncated:false,p:null,refreshing:false};","_phmPos={state:'ok',rows:[],at:Date.now(),err:null,errText:'',truncated:false,p:null,refreshing:false};",K('pos refused'));
  await brk('the offline-copy answer is accepted as a read',"if(snap&&snap.metadata&&snap.metadata.fromCache===true){","if(false){",K('an offline-copy answer'));
  await brk('no timeout on the pos read',"rej(e);},ms);});","},ms);});",K('pos read that never settles is cut off'));
  await brk('pos is read on every render (no cache)',"if(!force&&_phmPos.state==='ok'&&_phmPos.at!==null&&Date.now()-_phmPos.at<PHM_STALE_MS)return Promise.resolve(_phmPos);","",K('phmLoadPos reuses'));
  await brk('the Escape guard is not registered',"if(typeof phAddEscapeGuard==='function')phAddEscapeGuard(_phmEscape);","",K('Escape closes the open drawer'));
  await brk('the drawer shows one row too few',"spec.rows.forEach(function(r){\n    const li=E('li','phm-row');","spec.rows.slice(1).forEach(function(r){\n    const li=E('li','phm-row');",K('a tile opens the list of POs behind it').concat(K('every tile on screen')));
  await brk('a PO title written as HTML',"if(r.detail)li.appendChild(E('div','phm-row-detail',r.detail));","if(r.detail)li.appendChild(E('div','phm-row-detail',r.detail));li.children[1].innerHTML=r.title;",K('XSS: the source never'));
  await brk('a write sneaks in',"function phmCloseDrawer(restore){","function phmCloseDrawer(restore){ setDoc(doc(db,'pos','x'),{});",K('read-only: the source calls no Firestore write API'));
  await brk('the status strip is dropped from Overview',"(ctx.status.stages||[]).forEach(function(r){strip.appendChild(_phmStageLine(r));});","",K('Overview keeps the per-collection'));
  await brk('the view-only account gets the Monitor button (WP10: and loses the short view that returns before it)',[["if(ctx.canManage)foot.appendChild(_phmBtn('ph-btn',phI18nD('shell.open_monitor')","if(true)foot.appendChild(_phmBtn('ph-btn',phI18nD('shell.open_monitor')"],["  if(!ctx.canManage)return _phmFloorOverview(host,ctx);\n",""]],null,K('uzaib: no button'));
  await brk('a global without the prefix',"function _phmObj(x){","function monObj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}\nfunction _phmObj(x){",K('globals: every top-level'));
  await brk('a global that collides with another script',"function _phmObj(x){","function phEl(){return 1;}\nfunction _phmObj(x){",K('globals: none of them'));
  await brk('queue delay reports calendar days as working days',".map(function(j){return j.delayDays;})",".map(function(j){return j.delayCalendarDays;})",K('queue delay'));
  await brk('the cut gate setting is ignored',"phCutCheck(qty,u.units,{gate:S.cutGate})","phCutCheck(qty,u.units,{})",K('the settings are honoured'));
  await brk('the saved settings are not given to ph-core\'s lead-time rule',"const O={settings:rawS,now:now,today:today};","const O={now:now,today:today};",K('the settings are honoured'));
  await brk('no Retry button on the pos error card',"c.appendChild(_phmBtn('ph-btn ph-btn-primary',phI18nD('shell.retry'),function(){_phmEnsure(ctx,true);ctx.repaint();}));","",K('Retry reads again'));
  await brk('Refresh does not re-read pos',"phmCloseDrawer(false);_phmEnsure(ctx,true);ctx.repaint();","phmCloseDrawer(false);ctx.repaint();",K('Refresh reads pos again'));
  await brk('the po_cut_jobs note is dropped from the attention list',"note:jobsOk?'':phI18nD('ov.jobs_unread_delays')","note:''",K('po_cut_jobs failed: the planned-day reason'));
  await brk('a view-only user cannot open a list (the tile button is inert)',"if(clickable)main.addEventListener('click',function(){phmOpenDrawer(host,{title:t.label,rows:t.rows,note:t.cap,sum:t.sum,sumLabel:t.sumLabel,openable:t.id==='attention'},main);});","",K('a tile opens the list'));
  await brk('the sum of the list is not shown',"if(spec.sum!==null&&spec.sum!==undefined)panel.appendChild","if(false)panel.appendChild",K('a tile opens the list'));
  /* QC8 breaks: each rule above is undone once in the source and the named checks must fail */
  await brk('QC: a short PO is listed as ready',"if(rec.phase==='ready')Q.lists.ready.push(","if(rec.phase==='ready'||rec.phase==='short')Q.lists.ready.push(",K('qc model: ready =').concat(K('qc model: short =')));
  await brk('QC: a receiving PO is listed as short',"else if(rec.phase==='short')Q.lists.short.push(","else if(rec.phase==='short'||rec.phase==='receiving')Q.lists.short.push(",K('qc model: short =').concat(K('qc model: receiving =')));
  await brk('QC: the idle limit is exclusive (exactly 3 days does not count)',[["if(days>=PHM_QC_IDLE_DAYS)Q.lists.idle.push","if(days>PHM_QC_IDLE_DAYS)Q.lists.idle.push"],["if(days!==null&&days>=PHM_QC_IDLE_DAYS)Q.lists.idle.push","if(days!==null&&days>PHM_QC_IDLE_DAYS)Q.lists.idle.push"]],null,K('qc model: idle ='));
  await brk('QC: a PO that has not reached QC can be late with its lots',"if(st!=='qc')return;","",K('qc model: idle =').concat(K('qc model: not idle')));
  await brk('QC: a PO with no washing date is silently dropped',"if(days===null){Q.idleNoDate++;return;}","if(days===null){return;}",K('qc model: a PO at QC whose washing'));
  await brk('QC: idle sorted shortest first',"Q.lists.idle.sort(function(a,b){return(b.idleDays-a.idleDays)||_phmQcCmpId(a,b);});","Q.lists.idle.sort(function(a,b){return(a.idleDays-b.idleDays)||_phmQcCmpId(a,b);});",K('qc model: idle ='));
  await brk('QC: no drift list',"if(rec.drift){","if(false){",K('qc model: drift ='));
  await brk('QC: closed POs of any age are listed',"      if(at!==null&&now-at>recentMs)return;\n","",K('qc model: closed with a shortfall'));
  await brk('QC: any closed PO is a shortfall (the close_short kind is not checked)',"return _phmObj(o)&&o.kind==='close_short';","return _phmObj(o);",K('qc model: closed with a shortfall'));
  await brk('QC: lots voided long ago are listed',"||!isFinite(l.voidedAt)||now-l.voidedAt>recentMs)return;","||!isFinite(l.voidedAt))return;",K('qc model: voided ='));
  await brk('QC: a live lot is read as a voided one',"if(!_phmObj(l)||l.status!=='void'||","if(!_phmObj(l)||l.status!=='live'||",K('qc model: voided ='));
  await brk('QC: a PO ph-core cannot judge is dropped without a word',"if(!rec.ok){Q.notJudged.push(","if(!rec.ok){0&&Q.notJudged.push(",K('qc model: a PO ph-core cannot judge'));
  await brk('QC: an unread list counts 0',"if(miss.length){Q.counts[k]=null;","if(miss.length){Q.counts[k]=0;",K('qc failed:').concat(K('qc card failed: lots refused')));
  await brk('QC: the look-back constant drifts from the Afloat tab',"const PHM_QC_RECENT_DAYS=7;","const PHM_QC_RECENT_DAYS=8;",K('qc model: the look-back equals').concat(K('qc model: the two day limits')));
  await brk('QC: ready and receiving become attention groups',"const PHM_QC_ATTENTION=Object.freeze(['short',","const PHM_QC_ATTENTION=Object.freeze(['ready','short',",K('qc monitor: Needs attention gets exactly five'));
  await brk('QC: the jump does not wait for Afloat\'s own pos read',"  if(typeof phqcLoadPos==='function'){Promise.resolve(phqcLoadPos(false)).then(go,go);return true;}\n","",K('qc open: the drawer closes'));
  await brk('QC: the jump is open to anyone on the audience',"return typeof phCanManage==='function'&&phCanManage(w)===true&&typeof phGoTab==='function';","return typeof phGoTab==='function';",K('qc audience: phmQcOpen refuses Faizan'));
  await brk('QC: a non-manager context reads the QC stages',"if(!ctx||!ctx.canManage||typeof phLoadStage","if(!ctx||typeof phLoadStage",K('qc audience: _phmQcEnsure on a non-manager'));
  await brk('QC: Refresh does not force the QC stages',"  _phmQcEnsure(ctx,force);\n","  _phmQcEnsure(ctx,false);\n",K('qc refresh: Refresh re-reads'));
  await brk('QC: Retry re-reads every stage, not only the failed one',"if(typeof phLoadFailed==='function'&&phLoadFailed(s))phLoadStage(s,{force:true})","if(true)phLoadStage(s,{force:true})",K('qc card failed: Retry'));
  await brk('QC: a QC row detail written as HTML',"  li.appendChild(E('div','phm-row-detail',r.detail));\n  if(phmQcCanOpen())","  li.appendChild(E('div','phm-row-detail',r.detail));li.children[1].innerHTML=r.detail;\n  if(phmQcCanOpen())",K('XSS: the source never'));
  await brk('QC: the card shows to the floor too (the manager guard on the Overview is gone)',"  if(!ctx.canManage)return _phmFloorOverview(host,ctx);\n  _phmEnsure(ctx,false);","  _phmEnsure(ctx,false);",K('uzaib: Overview is the SHORT view').concat(K('qc audience: Kashif (uzaib)')));
  s.ok('breaks run: '+broken,broken>=(process.env.PH_MON_QC_ONLY==='1'?30:60));
  return s;
};

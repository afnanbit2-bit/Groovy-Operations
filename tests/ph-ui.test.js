/* Production Ops UI shell (12 Oct 2026): js/ph-ui.js and its wiring in js/shared.js, js/hrm.js, index.html, sw.js, css/main.css.

   What this drives (the real handlers, against tests/ph-dom.js's small real DOM and the REAL js/ph-core.js + js/ph-data.js over a fake Firestore):
     · the audience (afnan, ammar, mustafa, uzaib in; raees, umair, arfat, a worker, the QA account, signed-out out) and the tab roles
       (Uzaib sees ONLY Overview, PO Queue and Today's Cutting), honoured by the tab list, the rail, the hash and the render path
     · the takeover: enters and leaves on showPage (the page decides), Exit never strands, Escape, deep links #prodops[/tab], replaceState only
     · the honest states: a skeleton while the read is out (the shell is already up), a banner naming each failed collection with Retry that
       re-reads ONLY the failed ones, a failed collection never printed as a number, a render that throws or draws nothing says so
     · XSS: stored text only ever reaches textContent; nothing parses a string as HTML
     · read-only: no write of any kind
     · the wiring in the other files: nav, More sheet, Me page, the renderPage line, script/precache/version
   What it does NOT prove: geometry (the harness has no layout) -- the stylesheet assertions below and tests/smoke-layout.js's "production ops"
   fragments hold that in real Chromium; and nothing here has been seen on a real screen or phone. Each "break" mutates the source and
   requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-ui.js');
const CSS=read('css/main.css');
const J=JSON.stringify;
const PERM=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  ammar:{uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store'},
  umair:{uid:'u-umair',u:'umair',name:'Umair',role:'fulfillment'},
  arfat:{uid:'u-arfat',u:'arfat',name:'Arfat',role:'manager'},
  asghar:{uid:'u-asghar',u:'asghar',name:'Asghar',role:'worker'},
  claude:{uid:'u-claude',u:'claude',name:'Claude',role:'qa'}
};
const ALL_TABS=['overview','queue','calendar','cutting','monitor','reports','masters','standards','settings'];

function fakeDb(o){
  o=o||{};
  const reads={},api={
    db:{},
    collection:(db,...s)=>({path:s.join('/')}),doc:(db,...s)=>({path:s.join('/')}),
    query:c=>({path:c.path}),orderBy:()=>({}),limit:()=>({}),where:()=>({}),
    getDocs:async q=>{
      reads[q.path]=(reads[q.path]||0)+1;
      if(o.gate)await o.gate.p;
      const f=o.fail&&o.fail[q.path];if(f)throw f();
      const rows=(o.data&&o.data[q.path])||[];
      return{docs:rows.map(r=>({id:r.id,data:()=>{const c=Object.assign({},r);delete c.id;return c;}})),metadata:{fromCache:false}};
    },
    getDoc:async r=>{
      reads[r.path]=(reads[r.path]||0)+1;
      if(o.gate)await o.gate.p;
      const f=o.fail&&o.fail[r.path];if(f)throw f();
      const d=o.data&&o.data[r.path];
      return{exists:()=>!!d,data:()=>Object.assign({},d),metadata:{fromCache:false}};
    },
    // writes exist so that ANY write by the shell is recorded and fails the read-only check
    setDoc:async()=>{writes.push('setDoc');},updateDoc:async()=>{writes.push('updateDoc');},addDoc:async()=>{writes.push('addDoc');},
    deleteDoc:async()=>{writes.push('deleteDoc');},writeBatch:()=>{writes.push('writeBatch');return{set(){},update(){},delete(){},commit:async()=>{}};},
    runTransaction:async()=>{writes.push('runTransaction');}
  };
  const writes=[];
  return{api,reads,writes};
}
function gate(){let open;const p=new Promise(r=>{open=r;});return{p,open};}
const settle=(ms)=>new Promise(r=>setTimeout(r,ms||25));

function load(src,opts){
  opts=opts||{};
  const store=opts.store||{},calls=[],shown=[];
  const fk=fakeDb(opts.db);
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-i18n.js'],session:opts.session===undefined?USERS.afnan:opts.session,currentPage:'dashboard',
    globals:Object.assign({},fk.api,{
      localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},
      history:{replaceState(s,t,u){calls.push(String(u));const i=String(u).indexOf('#');a.ctx.location.hash=i<0?'':String(u).slice(i);},pushState(s,t,u){calls.push('PUSH '+u);}}
    },opts.globals||{})});
  const ctx=a.ctx;if(typeof ctx.phI18nSetLang==='function')ctx.phI18nSetLang('en');
  const dom=domkit.install(ctx);
  ctx.window.showPage=function(id){
    shown.push(id);
    if(opts.peek)opts.peek.tab=vm.runInContext('_phUiTab',ctx);   // the tab the deep link chose, before the page or the takeover can correct it
    if(opts.noNav&&id==='dashboard')return Promise.resolve();
    if(opts.rewrite&&opts.rewrite[id])id=opts.rewrite[id];
    ctx.currentPage=id;
    if(opts.throwOn===id)throw new Error('boom');
    if(id==='prod-ops'&&!opts.noRender)ctx.phRenderPage(id);    // what renderPage's one line does
    return Promise.resolve();
  };
  let started=0;
  ctx.window.startApp=async function(){started++;};
  ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(src,ctx,{filename:'ph-ui.js'});
  const T={a,ctx,dom,fk,store,calls,shown,
    R:c=>a.run(c),
    body:()=>dom.body.classList,html:()=>dom.html.classList,main:()=>dom.main.classList,
    keys:e=>(a.state.listeners.keydown||[]).forEach(f=>f(e)),
    hash:()=>ctx.location.hash,
    started:()=>started,
    as(u){ctx.session=u;},
    bar:()=>dom.find('ph-tk-bar'),rail:()=>dom.find('ph-tk-rail'),panel:()=>dom.find('ph-panel'),banner:()=>dom.find('ph-banner'),
    text:n=>n?n.textContent:'',
    items:()=>T.rail()?T.rail().children:[],
    itemIds:()=>T.items().map(b=>b.getAttribute('data-tab')),
    show:async id=>{await ctx.window.showPage(id);await settle();}
  };
  return T;
}
// the text of the ph-line whose name span reads `label` ('' if none)
const lineText=(dom,root,label)=>{const l=dom.all(root,n=>/\bph-line\b/.test(n.className)&&n.children[0]&&n.children[0].textContent===label)[0];return l?l.textContent:'';};
const evKey=(k,tgt,extra)=>Object.assign({key:k,target:tgt||{tagName:'DIV'},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}},extra||{});

async function checks(src){
  const o={};
  const DATA={
    po_drafts:[{id:'DRAFT-1'}],po_cut_jobs:[],cutting_masters:[{id:'CM-001',name:'Hassan'},{id:'CM-002',name:'Alam'}],ph_standards:[{id:'GST073'}],
    'ph_settings/main':{capacity:1}
  };
  const mk=(u,db,more)=>load(src,Object.assign({session:USERS[u],db:Object.assign({data:DATA},db||{})},more||{}));

  // ── the audience ──
  {
    const T=mk('afnan');
    const see=u=>{T.as(USERS[u]);return T.R('_phUiCanSee()');};
    o['audience: afnan, ammar, mustafa and uzaib are in']=['afnan','ammar','mustafa','uzaib'].every(see);
    o['audience: raees, umair, arfat, a worker and the QA account are out']=['raees','umair','arfat','asghar','claude'].every(u=>!see(u));
    T.as(null);
    o['audience: signed out is out (fail closed)']=T.R('_phUiCanSee()')===false&&T.R('phTabsFor().length')===0;
    T.as(USERS.afnan);
    o['the tab list is exactly the nine, in the rail order']=T.R('JSON.stringify(phTabsFor().map(t=>t.id))')===J(ALL_TABS)&&T.R('JSON.stringify(PH_TABS.map(t=>t.label))')===J(['Overview','PO Queue','Calendar',"Today's Cutting",'Monitor','Reports','Masters','Standards','Settings']);
    for(const u of ['afnan','ammar','mustafa']){T.as(USERS[u]);o['tabs: '+u+' (a manager) has all nine']=T.R('JSON.stringify(phTabsFor().map(t=>t.id))')===J(ALL_TABS);}
    T.as(USERS.uzaib);
    o["tabs: uzaib (Kashif, PO data entry) sees ONLY Overview, PO Queue and Today's Cutting"]=T.R('JSON.stringify(phTabsFor().map(t=>t.id))')===J(['overview','queue','cutting']);
    o['tabs: Calendar, Monitor, Reports, Masters, Standards and Settings stay manager-only (not one of them is his)']=['calendar','monitor','reports','masters','standards','settings'].every(id=>T.R('phTabsFor().some(t=>t.id==='+J(id)+')')===false);
    T.as(USERS.raees);
    o['tabs: someone off the audience gets no tabs at all']=T.R('phTabsFor().length')===0&&T.R('phResolveTab("overview")')===null&&T.R('phGoTab("overview")')===false;
  }
  // ── tab roles honoured everywhere ──
  {
    const T=mk('uzaib');
    await T.show('prod-ops');
    o['uzaib: the rail lists his three tabs only (Overview, PO Queue, Today\'s Cutting)']=T.itemIds().join()==='overview,queue,cutting';
    o['uzaib: asking for a manager tab is refused and the tab does not change']=T.R('phGoTab("masters")')===false&&T.R('_phUiTab')==='overview'&&T.R('phGoTab("settings")')===false;
    T.R('_phUiTab="masters"');T.R('_phUiPaintPanel()');
    o['uzaib: even a forced tab id renders HIS default, never the manager tab']=/Overview/.test(T.text(T.panel()))&&!/Masters/.test(T.text(T.panel()))&&T.R('_phUiTab')==='overview';
    o['uzaib: the render function of a manager tab is never called for him']=(()=>{
      let hit=0;T.ctx.__probe=()=>{hit++;};
      T.R('phRegisterTab("masters",{render:function(h){__probe();h.appendChild(phEl("p","x","boom"));}})');
      T.R('_phUiTab="masters"');T.R('_phUiPaintPanel()');return hit===0;})();
    o["uzaib: Today's Cutting opens for him"]=T.R('phGoTab("cutting")')===true&&/Today's Cutting/.test(T.text(T.panel()));
    o['uzaib: the panel says View only (read-only account)']=/View only/.test(T.text(T.panel()));
    o['uzaib: the top bar chip is visible and says what his account does (Data entry & cutting), NOT View only']=!/ph-hidden/.test(T.dom.find('ph-tk-chip').className)&&T.dom.find('ph-tk-chip').textContent==='Data entry & cutting'&&!/View only/.test(T.dom.find('ph-tk-chip').textContent)&&/enters PO drafts and records the cut/.test(T.dom.find('ph-tk-chip').getAttribute('title')||'');
    o['phChipFor: a manager none, the floor Data entry & cutting, anyone else View only']=T.R('phChipFor("mustafa").show')===false&&T.R('phChipFor("afnan").show')===false&&T.R('phChipFor("uzaib").text')==='Data entry & cutting'&&T.R('phChipFor("raees").text')==='View only'&&T.R('phChipFor("").text')==='View only';
    const M=mk('mustafa');await M.show('prod-ops');
    o['a manager: no View only chip (it is hidden in the top bar)']=/ph-hidden/.test(M.dom.find('ph-tk-chip').className)&&!/View only/.test(M.text(M.panel()));
    o['a manager: all nine rail items']=M.itemIds().join()===ALL_TABS.join();
    // registry extension point
    const X=mk('afnan');
    X.R('phRegisterTab("queue",{render:function(h,c){h.appendChild(phEl("p","x","queue built: "+c.user+" "+c.canManage));}})');
    await X.show('prod-ops');X.R('phGoTab("queue")');
    o['phRegisterTab replaces a tab\'s render and hands it (host, ctx)']=/queue built: afnan true/.test(X.text(X.panel()));
    o['phRegisterTab adds a new tab, manager-only by default']=X.R('phRegisterTab("extra",{label:"Extra",render:function(h){h.appendChild(phEl("p","","e"));}})')===true&&X.R('phTabsFor("uzaib").some(t=>t.id==="extra")')===false&&X.R('phTabsFor("afnan").some(t=>t.id==="extra")')===true;
    o['a tab whose roles() widens it still cannot reach someone off the audience']=(()=>{X.R('phRegisterTab("extra",{roles:function(){return true;}})');return X.R('phTabsFor("raees").length')===0&&X.R('phTabsFor("uzaib").some(t=>t.id==="extra")')===true;})();
    o['a roles() that throws hides the tab (fail closed)']=(()=>{X.R('phRegisterTab("extra",{roles:function(){throw new Error("x");}})');return X.R('phTabsFor("afnan").some(t=>t.id==="extra")')===false;})();
    o['phRegisterTab refuses junk (no render for a new id, bad id)']=X.R('phRegisterTab("bad id!",{render:function(){}})')===false&&X.R('phRegisterTab("nope",{})')===false&&X.R('phRegisterTab(null,{})')===false;
  }
  // ── the takeover ──
  {
    const T=mk('afnan');
    o['before: no takeover, nothing mounted']=!T.body().contains('ph-fullscreen')&&T.bar()===null&&T.rail()===null;
    await T.show('prod-ops');
    o['entering sets ph-fullscreen on body and html and ph-takeover on #main-content']=T.body().contains('ph-fullscreen')&&T.html().contains('ph-fullscreen')&&T.main().contains('ph-takeover');
    o['the bar and the rail are direct children of <body>, once']=T.bar()&&T.bar().parentNode===T.dom.body&&T.rail().parentNode===T.dom.body&&T.dom.body.children.filter(c=>c.id==='ph-tk-bar').length===1;
    o['the bar carries an Exit control']=!!T.dom.find('ph-tk-exit')&&/Exit/.test(T.text(T.dom.find('ph-tk-exit')))&&T.dom.find('ph-tk-exit').getAttribute('type')==='button';
    o['the rail is a nav landmark with a label']=T.rail().tagName==='NAV'&&/Production Ops/.test(T.rail().getAttribute('aria-label')||'');
    o['the rail lists every tab of the one registry (9)']=T.items().length===9&&T.itemIds().join()===T.R('PH_TABS.map(t=>t.id).join()');
    o['the active tab is aria-current and .on, alone (Overview)']=(()=>{const cur=T.items().filter(b=>b.getAttribute('aria-current')==='page');return cur.length===1&&cur[0].getAttribute('data-tab')==='overview'&&/\bon\b/.test(cur[0].className);})();
    o['the address bar names the tab: #prodops/overview via replaceState']=T.hash()==='#prodops/overview'&&T.calls.length>=1;
    await T.show('prod-ops');await T.show('prod-ops');
    o['showing the page again never mounts a second rail or bar']=T.dom.body.children.filter(c=>c.id==='ph-tk-rail').length===1&&T.dom.body.children.filter(c=>c.id==='ph-tk-bar').length===1;
    // switching
    T.dom.click(T.items().filter(b=>b.getAttribute('data-tab')==='monitor')[0]);
    o['a rail click switches the tab, the hash follows and the panel redraws']=T.R('_phUiTab')==='monitor'&&T.hash()==='#prodops/monitor'&&/Monitor/.test(T.text(T.panel()))&&T.items().filter(b=>b.getAttribute('aria-current')==='page')[0].getAttribute('data-tab')==='monitor';
    o['the top bar title follows the tab']=/Monitor/.test(T.text(T.dom.find('ph-tk-title')));
    o['only replaceState is ever used (no history entries)']=T.calls.every(u=>/^\/#prodops\/[a-z]+$/.test(u));
    // collapse
    T.ctx.phToggleRail();
    o['Hide menu collapses the rail: body.ph-rail-min, stored per viewer, aria-expanded false']=T.body().contains('ph-rail-min')&&T.store['groovy-ph-rail']==='min'&&T.dom.find('ph-tk-toggle').getAttribute('aria-expanded')==='false'&&T.text(T.dom.find('ph-tk-toggle'))==='Show menu';
    T.ctx.phToggleRail();
    o['pressing it again restores it']=!T.body().contains('ph-rail-min')&&T.store['groovy-ph-rail']==='full';
    // keyboard
    T.ctx.phGoTab('overview');
    T.keys(evKey('Escape',{tagName:'INPUT'}));
    o['Escape in a text field does not leave the page']=T.body().contains('ph-fullscreen');
    T.keys(evKey('Escape',{tagName:'DIV',isContentEditable:true}));
    o['Escape in an editable region does not leave the page']=T.body().contains('ph-fullscreen');
    T.keys(evKey('Escape',null,{defaultPrevented:true}));
    o['an Escape something else already handled is not a second exit']=T.body().contains('ph-fullscreen');
    T.R('PH_ESCAPE_GUARDS.length=0');T.R('phAddEscapeGuard(function(){return true;})');
    T.keys(evKey('Escape'));
    o['Escape with an open drawer/dialog (a registered guard) leaves it to that overlay']=T.body().contains('ph-fullscreen');
    T.R('PH_ESCAPE_GUARDS.length=0');T.R('phAddEscapeGuard(function(){throw new Error("x");})');
    T.keys(evKey('a'));
    o['other keys do nothing']=T.body().contains('ph-fullscreen');
    // arrow keys move focus along the rail
    const first=T.items()[0],second=T.items()[1];
    T.keys(evKey('ArrowDown',first));
    o['ArrowDown in the rail moves focus to the next item']=T.dom.body&&T.ctx.document.activeElement===second;
    T.keys(evKey('End',first));
    o['End moves to the last item, Home to the first']=T.ctx.document.activeElement===T.items()[8]&&(T.keys(evKey('Home',T.items()[8])),T.ctx.document.activeElement===T.items()[0]);
    T.keys(evKey('ArrowUp',T.items()[0]));
    o['ArrowUp from the first wraps to the last']=T.ctx.document.activeElement===T.items()[8];
    T.R('PH_ESCAPE_GUARDS.length=0');
    const before=T.shown.length;
    T.keys(evKey('Escape'));
    o['Escape exits: the takeover is down and the dashboard is requested']=!T.body().contains('ph-fullscreen')&&!T.main().contains('ph-takeover')&&T.shown.length===before+1&&T.shown[T.shown.length-1]==='dashboard';
    o['exiting clears the #prodops hash']=T.hash()==='';
    T.keys(evKey('Escape'));
    o['Escape off the page does nothing (no stray navigation)']=T.shown.length===before+1;
    // leaving by any route
    await T.show('prod-ops');
    await T.show('hrm-employees');
    o['leaving through any other showPage removes the classes and the hash']=!T.body().contains('ph-fullscreen')&&!T.html().contains('ph-fullscreen')&&!T.main().contains('ph-takeover')&&T.hash()==='';
    await T.show('prod-ops');
    o['re-entering mounts nothing new']=T.dom.body.children.filter(c=>c.id==='ph-tk-rail').length===1&&T.body().contains('ph-fullscreen');
    // never strands
    const T2=mk('afnan',null,{throwOn:'dashboard'});
    await T2.show('prod-ops');T2.ctx.phExit();await settle(5);
    o['Exit still takes the takeover down when the navigation fails']=!T2.body().contains('ph-fullscreen')&&!T2.main().contains('ph-takeover');
    const T3=mk('afnan',null,{rewrite:{'prod-ops':'dashboard'}});
    await T3.show('prod-ops');
    o['a role scope that rewrites the page to the dashboard never enters the takeover']=!T3.body().contains('ph-fullscreen')&&T3.bar()===null;
    // off the audience: the page is a restricted note, no takeover
    for(const u of ['raees','umair','arfat','asghar','claude']){
      const N=mk(u);await N.show('prod-ops');
      o['takeover: '+u+' reaches the page but gets a restricted note and NO takeover']=!N.body().contains('ph-fullscreen')&&N.bar()===null&&N.rail()===null&&/restricted/i.test(N.text(N.dom.main))&&!N.panel();
    }
    const NS=mk('afnan');NS.as(null);await NS.show('prod-ops');
    o['takeover: signed out gets no takeover']=NS.bar()===null&&!NS.body().contains('ph-fullscreen');
    // a person whose account changes while on the page loses the takeover on the next navigation
    const T5=mk('afnan');await T5.show('prod-ops');T5.as(USERS.raees);await T5.show('prod-ops');
    o['the audience is re-checked on every show: losing access drops the takeover']=!T5.body().contains('ph-fullscreen');
  }
  // ── deep links ──
  {
    const D=(hash,u)=>{const t=mk(u||'afnan');t.ctx.location.hash=hash;const r=t.R('_phTkConsumeHash()');return{t,r};};
    let d=D('#prodops/queue');
    o['#prodops/queue opens the page on PO Queue']=d.r===true&&d.t.R('_phUiTab')==='queue'&&d.t.shown.join()==='prod-ops';
    d=D('#prodops');
    o['#prodops alone opens the default tab (Overview)']=d.r===true&&d.t.R('_phUiTab')==='overview'&&d.t.shown.length===1;
    d=D('#prodops/not-a-tab');
    o['an unknown tab lands on the default, never a blank page']=d.r===true&&d.t.R('_phUiTab')==='overview';
    {const peek={},t=mk('uzaib',null,{peek});t.ctx.location.hash='#prodops/masters';const r=t.R('_phTkConsumeHash()');
      o['a tab that is not yours (uzaib, masters) lands on HIS default tab']=r===true&&peek.tab==='overview'&&t.R('_phUiTab')==='overview';}
    d=D('#prodops/cutting','uzaib');
    o["uzaib's own tab opens (cutting)"]=d.r===true&&d.t.R('_phUiTab')==='cutting';
    d=D('#prodops/../x');
    o['a malformed hash is ignored']=d.r===false&&d.t.shown.length===0;
    d=D('#inventory/today');
    o['another module\'s hash is ignored']=d.r===false&&d.t.shown.length===0;
    for(const u of ['raees','umair','arfat','asghar','claude']){d=D('#prodops/queue',u);o['deep link: '+u+' is not on the audience: nothing opens']=d.r===false&&d.t.shown.length===0;}
    const TN=mk('afnan');TN.as(null);TN.ctx.location.hash='#prodops/queue';
    o['no session: nothing opens (fail closed)']=TN.R('_phTkConsumeHash()')===false&&TN.shown.length===0;
    const TL=mk('afnan');await TL.show('prod-ops');TL.ctx.location.hash='#prodops/reports';
    const n0=TL.shown.length;TL.R('_phTkConsumeHash()');
    o['a link pasted while on the page switches the tab in place (no navigation)']=TL.R('_phUiTab')==='reports'&&TL.shown.length===n0&&TL.hash()==='#prodops/reports'&&/Reports/.test(TL.text(TL.panel()));
    const TH=mk('afnan');TH.ctx.location.hash='#prodops/calendar';
    (TH.a.state.listeners['window:hashchange']||[]).forEach(f=>f());
    o['hashchange consumes a pasted #prodops link']=TH.R('_phUiTab')==='calendar'&&TH.shown.join()==='prod-ops';
    const TS=mk('afnan');TS.ctx.location.hash='#prodops/settings';
    await TS.ctx.window.startApp();
    o['startApp is wrapped: the original runs, then a cold #prodops link is consumed']=TS.started()===1&&TS.shown.join()==='prod-ops'&&TS.R('_phUiTab')==='settings';
  }
  // ── honest states ──
  {
    // loading: the shell is up before any read returns
    const g=gate();
    const T=mk('afnan',{gate:g});
    await T.show('prod-ops');
    o['loading: the shell (takeover, bar, rail) is up while the reads are still out']=T.body().contains('ph-fullscreen')&&T.items().length===9&&T.hash()==='#prodops/overview';
    o['loading: the panel is a skeleton (.gv-skel), not content and not blank']=T.dom.byClass(T.panel(),'gv-skel').length>=2&&!!T.dom.byClass(T.panel(),'ph-skelwrap')[0]&&T.dom.byClass(T.panel(),'ph-skelwrap')[0].getAttribute('aria-busy')==='true';
    o['loading: no tab content and no number is printed before the read settles']=T.dom.byClass(T.panel(),'ph-line').length===0&&!/Loaded|records|FAILED/.test(T.text(T.panel()));
    {
      const g2=gate(),S=mk('afnan',{gate:g2});
      S.ctx.currentPage='prod-ops';S.ctx.phRenderPage('prod-ops');
      o['loading: phRenderPage paints the skeleton SYNCHRONOUSLY, before any read returns']=!!S.panel()&&S.dom.byClass(S.panel(),'gv-skel').length>=2;
      g2.open();await settle();
    }
    g.open();await settle();
    o['loaded: the skeleton is replaced by the Overview with one line per collection']=T.dom.byClass(T.panel(),'gv-skel').length===0&&T.dom.byClass(T.panel(),'ph-line').length>=5&&/PO drafts/.test(T.text(T.panel()));
    o['loaded: counts come from the data layer (2 masters, 1 draft)']=/2 records$/.test(lineText(T.dom,T.panel(),'Cutting masters'))&&/1 record$/.test(lineText(T.dom,T.panel(),'PO drafts'));
    o['loaded: no failure banner when everything read']=T.banner().children.length===0;
    const reads0=JSON.stringify(T.fk.reads);
    await T.show('hrm-employees');await T.show('prod-ops');
    o['loads once on open: re-entering after a clean load reads nothing again']=JSON.stringify(T.fk.reads)===reads0;
    o['a successful load wrote nothing anywhere']=T.fk.writes.length===0;
  }
  {
    // failures
    const F=mk('afnan',{fail:{cutting_masters:PERM,ph_standards:()=>new Error('boom <script>alert(1)</script>')}});
    await F.show('prod-ops');
    const bn=F.text(F.banner());
    o['failed: the banner names BOTH failed collections']=/cutting_masters/.test(bn)&&/ph_standards/.test(bn)&&/Could not read 2 collections/.test(bn);
    o['failed: a permission failure says to republish the rules']=/republish firestore\.rules/.test(bn);
    o['failed: the banner is an alert with a Retry button']=F.banner().children[0].getAttribute('role')==='alert'&&F.dom.byClass(F.banner(),'ph-btn').filter(b=>/Retry/.test(b.textContent)).length===1;
    o['failed: the collections that DID read are not named in the banner']=!/po_drafts/.test(bn)&&!/ph_settings/.test(bn);
    const lm=lineText(F.dom,F.panel(),'Cutting masters'),ls=lineText(F.dom,F.panel(),'Consumption standards'),lq=lineText(F.dom,F.panel(),'PO drafts');
    o['failed: Overview marks them FAILED and prints no count for them']=/FAILED/.test(lm)&&/FAILED/.test(ls)&&!/\d+ records?/.test(lm)&&!/\d+ records?/.test(ls)&&/Loaded/.test(lq)&&/1 record$/.test(lq);
    // a placeholder tab for a failed collection reads "not loaded", never 0
    F.R('phGoTab("masters")');
    const mt=F.text(F.panel());
    o['failed: the Masters placeholder says FAILED for its collection, never "0 records"']=/FAILED/.test(mt)&&!/(?:^|\D)0 records/.test(mt);
    F.R('phGoTab("standards")');
    o['failed: Standards likewise']=/FAILED/.test(F.text(F.panel()))&&!/(?:^|\D)0 records/.test(F.text(F.panel()));
    F.R('phGoTab("queue")');
    F.R('phGoTab("queue")');
    const qline=lineText(F.dom,F.panel(),'PO drafts');
    F.R('phGoTab("calendar")');
    const cline=lineText(F.dom,F.panel(),'Cutting jobs');
    o['ok-but-empty is still honest: Queue reads 1 record, Calendar (no jobs) reads 0 records, loaded']=/1 record$/.test(qline)&&/0 records$/.test(cline)&&/Loaded/.test(cline);
  }
  {
    const failing={cutting_masters:PERM};
    const F=mk('afnan',{fail:failing});
    await F.show('prod-ops');
    const before=Object.assign({},F.fk.reads);
    F.R('phGoTab("masters")');
    delete failing.cutting_masters;
    F.dom.click(F.dom.byClass(F.banner(),'ph-btn')[0]);
    await settle(40);
    o['Retry re-reads ONLY the failed collection (every other count is unchanged)']=F.fk.reads.cutting_masters===before.cutting_masters+1&&F.fk.reads.po_drafts===before.po_drafts&&F.fk.reads.po_cut_jobs===before.po_cut_jobs&&F.fk.reads.ph_standards===before.ph_standards&&F.fk.reads['ph_settings/main']===before['ph_settings/main'];
    o['after a good Retry: the banner is gone and the tab shows the data']=F.banner().children.length===0&&/Loaded/.test(F.text(F.panel()))&&!/FAILED/.test(F.text(F.panel()));
    o['Retry wrote nothing']=F.fk.writes.length===0;
  }
  {
    // the shell paints even when the data layer is missing
    const T=mk('afnan');
    T.R('phLoadAll=undefined;phLoadState=undefined');
    await T.show('prod-ops');
    o['a data layer that is not loaded: an honest error, not a blank screen']=/did not load/.test(T.text(T.banner())+T.text(T.panel()))&&T.items().length===9;
  }
  // ── render failures ──
  {
    const T=mk('afnan');await T.show('prod-ops');
    T.R('phRegisterTab("queue",{render:function(){throw new Error("kaput")}})');T.R('phGoTab("queue")');
    o['a render that throws draws an error card with the message, not a blank panel']=/could not be drawn/.test(T.text(T.panel()))&&/kaput/.test(T.text(T.panel()))&&T.panel().children.length>=1;
    T.R('phRegisterTab("queue",{render:function(){}})');T.R('phGoTab("queue")');
    o['a render that draws nothing says so']=/drew nothing/.test(T.text(T.panel()));
    T.R('phRegisterTab("queue",{render:null})');T.R('phGoTab("queue")');
    o['a tab with no render function says so']=/no render function/.test(T.text(T.panel()));
    T.R('phRegisterTab("queue",{render:_phPlaceholder({title:"PO Queue",blurb:"b",stages:["drafts"]})})');
  }
  // ── XSS ──
  {
    const evil='<img src=x onerror=alert(1)>';
    const T=mk('afnan',{data:Object.assign({},DATA,{cutting_masters:[{id:'CM-001',name:evil}]}),fail:{ph_standards:()=>new Error('x <script>alert(2)</script> y')}});
    await T.show('prod-ops');
    let bad=0;
    let masters='';
    for(const id of ALL_TABS){T.R('phGoTab('+J(id)+')');T.dom.walk(T.dom.body,n=>{if(n.tagName==='IMG'||n.tagName==='SCRIPT')bad++;});if(id==='masters')masters=domkit.toHtml(T.dom.main);}
    o['XSS: no tab ever creates an element from stored or error text (no IMG/SCRIPT in the tree)']=bad===0;
    const html=domkit.toHtml(T.dom.main);
    o['XSS: the failure text reaches the page as escaped text']=/&lt;script&gt;alert\(2\)&lt;\/script&gt;/.test(html)&&!/<script/.test(html);
    o['XSS: a stored master name is shown, as escaped text, on the Masters tab']=/&lt;img src=x onerror=alert\(1\)&gt;/.test(masters)&&!/<img/.test(masters);
    const noHtmlApis=SRC_NOCOMMENT(src);
    o['XSS: the source never assigns innerHTML/outerHTML or parses a string as HTML']=!/\.innerHTML\s*=|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/.test(noHtmlApis);
  }
  // ── read-only ──
  {
    const T=mk('afnan');await T.show('prod-ops');
    for(const id of ALL_TABS)T.R('phGoTab('+J(id)+')');
    T.ctx.phToggleRail();T.ctx.phToggleRail();
    o['read-only: opening the page, visiting every tab and toggling the rail wrote nothing']=T.fk.writes.length===0;
    const s=SRC_NOCOMMENT(src);
    o['read-only: the source calls no Firestore write API and no ph-write function']=!/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\b/.test(s)&&!/\bph(AppendHistory|MasterAdd|SaveCutJob|SaveDraft|SettingsSave|StandardSave|AbandonDraft|Build[A-Z]\w*|Draft\w*Patch|DraftId|HistoryRowId|MarkDraftReady|MasterIdFor|MasterRename|MasterSetActive|SendBackDraft)\b/.test(s);
    o['read-only: it reads only through phLoadAll / phLoadState / phGet']=/phLoadAll\(/.test(s)&&!/\bgetDocs?\(|\bonSnapshot\(/.test(s);
  }
  return o;
}
function SRC_NOCOMMENT(s){return s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:\\'"`])\/\/[^\n]*/g,'$1');}

/* ── wiring in the other files ── */
async function wiring(s){
  const LS={getItem:()=>null,setItem(){},removeItem(){}};
  const NAV_FILES=['js/shared.js','js/auth.js','js/embellishments.js','js/hrm.js','js/store.js','js/store-accounts.js','js/ph-core.js','js/ph-data.js','js/ph-i18n.js'];
  const load2=u=>{
    const a=harness.loadApp({files:NAV_FILES,currentPage:'dashboard',globals:{localStorage:LS}});
    a.run('session='+J(Object.assign({},u)));
    return a;
  };
  s.section('wiring: the sidebar, the More sheet, the Me page and the renderPage line');
  const a0=harness.loadApp({files:NAV_FILES,currentPage:'dashboard',globals:{localStorage:LS}});
  const defs=JSON.parse(a0.run('JSON.stringify(USER_DEFS)'));
  const see={},more={};
  for(const d of defs){
    const b=load2(Object.assign({uid:'u-'+d.u},d));
    try{b.run('buildNav()');see[d.u]=/nav-prod-ops/.test(b.el('sidebar').innerHTML||'')&&/showPage\('prod-ops'\)/.test(b.el('sidebar').innerHTML||'');}catch(e){see[d.u]='threw '+e.message;}
    if(d.role==='owner'||d.role==='manager'){
      let items=null;b.ctx.window.openMobSheet=(t,i)=>{items=i;};
      try{b.ctx.window.openMoreSheet();more[d.u]=!!(items&&items.some(i=>i.pageId==='prod-ops'));}catch(e){more[d.u]='threw '+e.message;}
    }
  }
  s.eq('the sidebar entry shows for exactly afnan, ammar, mustafa and uzaib',J(Object.keys(see).filter(k=>see[k]===true).sort()),J(['afnan','ammar','mustafa','uzaib']));
  s.ok('buildNav() ran for every account without throwing',Object.keys(see).every(k=>typeof see[k]==='boolean'));
  s.eq('the owner/manager More sheet has it for afnan, ammar, mustafa and NOT arfat',J([more.afnan,more.ammar,more.mustafa,more.arfat]),J([true,true,true,false]));
  {
    const me=u=>{const b=load2(Object.assign({uid:'u-'+u.u},u));return b.run('renderMePage()');};
    s.ok("Uzaib's Me page (his phone route; his nav has no More sheet) carries a Production Ops button",/showPage\('prod-ops'\)/.test(me(USERS.uzaib)));
    s.ok('another worker\'s Me page does not',!/prod-ops/.test(me(USERS.asghar)));
  }
  {
    // fail closed: a data layer that did not parse hides every route
    const b=harness.loadApp({files:['js/shared.js','js/auth.js','js/embellishments.js','js/hrm.js','js/store.js','js/store-accounts.js'],currentPage:'dashboard',globals:{localStorage:LS}});
    b.run('session='+J(USERS.afnan));b.run('buildNav()');
    s.ok('without js/ph-data.js loaded, no route to Production Ops appears (typeof guard fails closed)',!/prod-ops/.test(b.el('sidebar').innerHTML||'')&&/Pattern Hub|Inventory Intel|Dashboard/.test(b.el('sidebar').innerHTML||''));
  }
  const shared=read('js/shared.js'),hrm=read('js/hrm.js');
  s.ok('renderPage has ONE line for it: id===prod-ops -> phRenderPage behind typeof',(shared.match(/id==='prod-ops'/g)||[]).length===1&&/else if\(id==='prod-ops'\)\{if\(typeof phRenderPage==='function'\)phRenderPage\(id\);else m\.innerHTML=/.test(shared));
  s.ok('every route is typeof-guarded on phCanSee (sidebar, More sheet, Me page)',(shared.match(/typeof phCanSee==='function'&&phCanSee\(\)/g)||[]).length===2&&/typeof phCanSee==='function'&&phCanSee\(\)\)\?`<button/.test(hrm));
  s.ok('shared.js adds nothing else for it besides the phone group map and the bug-page name',/'prod-ops':'more'/.test(shared)&&/'prod-ops':'Production Ops'/.test(shared)&&(shared.match(/prod-ops/g)||[]).length===5);
  s.ok('showPage has no role scope for a viewer, so none needed widening: every scoped role is sent away from prod-ops',(()=>{
    const fn=shared.slice(shared.indexOf('window.showPage=async function'),shared.indexOf('currentPage=id;',shared.indexOf('window.showPage=async function')));
    return!/role==='viewer'/.test(fn)&&!/prod-ops/.test(fn);
  })());

  s.section('the real renderPage / showPage with the shell loaded');
  {
    const FILES=NAV_FILES.concat([]);
    const real=(u,rewriteCheck)=>{
      const a=harness.loadApp({files:FILES,currentPage:'dashboard',globals:{localStorage:LS,
        history:{replaceState(){}},
        collection:(db,...p)=>({path:p.join('/')}),doc:(db,...p)=>({path:p.join('/')}),query:c=>c,orderBy:()=>({}),limit:()=>({}),
        getDocs:async()=>({docs:[],metadata:{fromCache:false}}),getDoc:async()=>({exists:()=>false,data:()=>({}),metadata:{fromCache:false}})}});
      const d=domkit.install(a.ctx);
      a.ctx.console={warn(){},log(){},error(){}};
      vm.runInContext(SRC,a.ctx,{filename:'ph-ui.js'});
      a.run('session='+J(u));
      return{a,d};
    };
    const go=async(X,id)=>{try{await X.a.run('window.showPage('+J(id)+')');}catch(e){}await settle();};
    const U=real(USERS.uzaib);
    await go(U,'prod-ops');
    s.ok('Uzaib (viewer): the REAL showPage opens the takeover and renderPage draws the canvas',U.d.body.classList.contains('ph-fullscreen')&&!!U.d.find('ph-panel')&&U.d.find('ph-tk-rail').children.length===3);
    const M=real(USERS.mustafa);await go(M,'prod-ops');
    s.ok('Mustafa (manager): same, with all nine tabs',M.d.body.classList.contains('ph-fullscreen')&&M.d.find('ph-tk-rail').children.length===9);
    await go(M,'dashboard');
    s.ok('and the REAL showPage to another page lets go of the takeover',!M.d.body.classList.contains('ph-fullscreen')&&!M.d.main.classList.contains('ph-takeover'));
    for(const u of ['raees','arfat','asghar']){
      const N=real(USERS[u]);await go(N,'prod-ops');
      s.ok('the REAL showPage as '+u+': a restricted note, no takeover',!N.d.body.classList.contains('ph-fullscreen')&&!N.d.find('ph-panel')&&/restricted/i.test(N.d.main.textContent));
    }
    for(const [role,u] of [['csr_lead',{uid:'u-s',u:'sami',role:'csr_lead'}],['fulfillment',USERS.umair],['designer',{uid:'u-d',u:'saim',role:'designer'}],['creator_content_ops_lead',{uid:'u-c',u:'daniyal',role:'creator_content_ops_lead'}]]){
      const N=real(u);await go(N,'prod-ops');
      s.ok('a scoped role ('+role+') is rewritten away by the real showPage: no takeover',!N.d.body.classList.contains('ph-fullscreen')&&!N.d.find('ph-tk-bar'));
    }
  }

  s.section('wiring: script order, precache, cache version');
  {
    const html=read('index.html'),sw=read('sw.js');
    const tag=f=>html.indexOf('/js/'+f+'?v=');
    s.ok('ph-ui.js has a script tag after ph-write.js and before the Firebase module',tag('ph-ui.js')>tag('ph-write.js')&&tag('ph-write.js')>0&&html.indexOf('<script type="module">')>tag('ph-ui.js'));
    s.ok('it is in PRECACHE_URLS',/'\/js\/ph-ui\.js'/.test(sw));
    s.ok('the stylesheet ?v= tag moved (css/main.css changed)',!/main\.css\?v=20261006v16/.test(html));
    const v=/CACHE_VERSION = 'v(\d+)'/.exec(sw);
    s.ok('CACHE_VERSION moved past v312',!!v&&+v[1]>=313,v?'v'+v[1]:'(unreadable)');
  }
}

module.exports=async function(){
  const s=suite('ph-ui');
  const base=await checks(SRC);
  s.section('production ops shell');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));

  await wiring(s);

  s.section('stylesheet contract (geometry the harness cannot lay out)');
  const rule=sel=>{const i=CSS.indexOf(sel+'{');return i<0?'':CSS.slice(i,CSS.indexOf('}',i));};
  const tk=rule('#main-content.ph-takeover');
  s.ok('the takeover is fixed at z-index 120 (above .topbar 100 and .cash-action-bar 115)',/position:fixed/.test(tk)&&/z-index:120/.test(tk));
  s.ok('120 stays below the bug FAB (500) and the toast (9999)',/#bug-report-fab\{[^}]*z-index:500/.test(CSS)&&/\.toast\{[^}]*z-index:9999/.test(CSS)&&!/#main-content\.ph-takeover\{[^}]*z-index:(?:[5-9]\d\d|\d{4})/.test(CSS));
  s.ok('height is 100dvh with a 100vh line before it',/height:calc\(100vh - [^;]*\);height:calc\(100dvh - /.test(tk));
  s.ok('html and body stop the page behind from scrolling',/body\.ph-fullscreen\{[^}]*overflow:hidden/.test(CSS)&&/html\.ph-fullscreen\{[^}]*overflow:hidden/.test(CSS)&&/body\.ph-fullscreen\{[^}]*height:100dvh/.test(CSS));
  s.ok('bar and rail are hidden unless body.ph-fullscreen is set',/\.ph-tk-bar,\.ph-tk-rail\{display:none\}/.test(CSS));
  s.ok('bar and rail sit at z-index 121, under 500',/body\.ph-fullscreen \.ph-tk-bar\{[^}]*z-index:121/.test(CSS)&&/body\.ph-fullscreen \.ph-tk-rail\{[^}]*z-index:121/.test(CSS));
  s.ok('the FAB is not hidden (it is on the Mood Boards canvas)',!/ph-fullscreen #bug-report-fab\{[^}]*display:none/.test(CSS));
  s.ok('on a phone the FAB clears the dock',/@media \(max-width:600px\)\{[\s\S]*body\.ph-fullscreen #bug-report-fab\{bottom:calc\(var\(--ph-tk-dock\)/.test(CSS));
  s.ok('the rail animates (width) and honours prefers-reduced-motion',/\.ph-tk-rail\{[^}]*transition:width \.22s/.test(CSS)&&/prefers-reduced-motion:reduce\)\{\s*body\.ph-fullscreen \.ph-tk-rail[^}]*transition:none/.test(CSS));
  s.ok('phone: the rail is a bottom dock with a safe-area inset',/height:calc\(var\(--ph-tk-dock\) \+ env\(safe-area-inset-bottom\)\)/.test(CSS));
  s.ok('touch targets: rail item 44px (desktop) and 48px (phone), Exit 36px+, phone button 44px',/\.ph-tk-item\{[^}]*min-height:44px/.test(CSS)&&/\.ph-tk-item\{flex:0 0 auto[^}]*min-height:48px/.test(CSS)&&/\.ph-tk-exit,\.ph-tk-toggle\{[^}]*min-height:36px/.test(CSS)&&/\.ph-btn\{min-height:44px\}/.test(CSS));
  const a0=CSS.indexOf('Production Ops: UI shell'),b0=CSS.indexOf('Inventory Intel — freshness strip');
  const phCss=CSS.slice(a0,b0).replace(/\/\*[\s\S]*?\*\//g,'');
  s.ok('the block exists and ends before the next module',a0>0&&b0>a0);
  s.ok('tokens only: no literal colour in the Production Ops block',!/#[0-9a-fA-F]{3,8}\b/.test(phCss)&&!/\b(?:rgb|rgba|hsl|hsla)\(/.test(phCss));
  s.ok('a focus ring is drawn (keyboard accessible)',/\.ph-tk-item:focus-visible[^}]*outline:2px solid var\(--text\)/.test(CSS)&&/\.ph-btn:focus-visible\{outline:2px solid var\(--text\)/.test(CSS));
  s.ok('text sizes: nothing under 11px in the block',!/font-size:(?:[0-9]|10)(?:\.\d+)?px/.test(phCss));
  s.ok('every selector in the block is .ph-/ph-prefixed or the takeover hooks (no collision with another module)',(phCss.match(/[^{}]+(?=\{)/g)||[]).filter(sel=>!/^\s*@media/.test(sel)).every(sel=>sel.split(',').every(p=>/ph-/.test(p))));
  s.ok('the ink on the active rail monogram is --on-dark (anything painted on --dark takes its ink from it)',/\.ph-tk-item\.on \.ph-tk-mono\{[^}]*background:var\(--dark\)[^}]*color:var\(--on-dark\)/.test(CSS)&&/\.ph-btn-primary\{[^}]*background:var\(--dark\)[^}]*color:var\(--on-dark\)/.test(CSS));

  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const pairs=Array.isArray(from)?from:[[from,to]];
    let mut=SRC;
    for(const [f,t] of pairs){
      if(mut.split(f).length-1<1){s.ok('break target exists: '+label+' ('+f.slice(0,40)+')',false);return;}
      mut=mut.split(f).join(t);
    }
    let r;try{r=await checks(mut);}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  await brk('audience gate opened to everyone',"function _phUiCanSee(u){return typeof phCanSee==='function'&&phCanSee(_phUiUser(u))===true;}","function _phUiCanSee(u){return true;}",['audience: raees, umair, arfat, a worker and the QA account are out','audience: signed out is out (fail closed)']);
  await brk('audience gate role-wide (viewers and managers)',"typeof phCanSee==='function'&&phCanSee(_phUiUser(u))===true","(typeof session!=='undefined'&&session&&(session.role==='manager'||session.role==='viewer'||session.role==='owner'))",['audience: raees, umair, arfat, a worker and the QA account are out']);
  await brk('tab roles ignored (every tab for the audience)',"try{return typeof t.roles==='function'?t.roles(_phUiUser(u))===true:_phUiCanManage(u);}catch(e){return false;}","return true;",["tabs: uzaib (Kashif, PO data entry) sees ONLY Overview, PO Queue and Today's Cutting",'uzaib: asking for a manager tab is refused and the tab does not change']);
  await brk('a throwing roles() shows the tab',"}catch(e){return false;}\n}\nfunction phTabsFor","}catch(e){return true;}\n}\nfunction phTabsFor",['a roles() that throws hides the tab (fail closed)']);
  await brk('render path ignores the roles (forced tab id renders)',"const tab=phResolveTab(_phUiTab,u);\n  if(!tab){host.appendChild(_phUiError(phI18nD('shell.no_tabs')","const tab=PH_TABS.filter(function(x){return x.id===_phUiTab;})[0]||phResolveTab(_phUiTab,u);\n  if(!tab){host.appendChild(_phUiError(phI18nD('shell.no_tabs')",['uzaib: even a forced tab id renders HIS default, never the manager tab','uzaib: the render function of a manager tab is never called for him']);
  await brk('phGoTab accepts any tab',"const l=phTabsFor(u).filter(function(t){return t.id===id;});\n  if(!l.length)return false;","const l=PH_TABS.filter(function(t){return t.id===id;});\n  if(!l.length)return false;",['uzaib: asking for a manager tab is refused and the tab does not change']);
  await brk('hash resolves to a tab that is not yours',"const t=phResolveTab(link.tab,_phUiUser());                                       // unknown or not-yours -> your default tab, never a blank page","const t=PH_TABS.filter(function(x){return x.id===link.tab;})[0]||phResolveTab(link.tab,_phUiUser());",['a tab that is not yours (uzaib, masters) lands on HIS default tab']);
  await brk('the page decides dropped (never leaves)','else if(!want&&_phUiOn)_phTkLeave();','',['leaving through any other showPage removes the classes and the hash']);
  await brk('takeover without the audience check',"currentPage===PH_PAGE_ID&&_phUiCanSee();","currentPage===PH_PAGE_ID;",['takeover: raees reaches the page but gets a restricted note and NO takeover','the audience is re-checked on every show: losing access drops the takeover']);
  await brk('exit navigates before it leaves',"_phTkLeave();\n  try{if(typeof window.showPage==='function')window.showPage('dashboard');}","try{if(typeof window.showPage==='function')window.showPage('dashboard');}",['Exit still takes the takeover down when the navigation fails']);
  await brk('Escape in a field exits',"if(e.defaultPrevented||tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(t&&t.isContentEditable===true))return;","",['Escape in a text field does not leave the page','Escape in an editable region does not leave the page','an Escape something else already handled is not a second exit']);
  await brk('Escape steals an open overlay','for(let i=0;i<PH_ESCAPE_GUARDS.length;i++){try{if(PH_ESCAPE_GUARDS[i]()===true)return;}catch(x){}}','',['Escape with an open drawer/dialog (a registered guard) leaves it to that overlay']);
  await brk('hash writes push history',"history.replaceState(null,'',base+want)","history.pushState(null,'',base+want)",['only replaceState is ever used (no history entries)']);
  await brk('hash left behind on leave',"if(was)_phTkSetHash('');",'',['exiting clears the #prodops hash']);
  await brk('a second rail on every show',"if(document.getElementById('ph-tk-bar')&&document.getElementById('ph-tk-rail'))return;",'',['re-entering mounts nothing new']);
  await brk('collapse not remembered',"localStorage.setItem(PH_RAIL_KEY,_phUiMin?'min':'full');",'',['Hide menu collapses the rail: body.ph-rail-min, stored per viewer, aria-expanded false']);
  await brk('hashchange not wired',"window.addEventListener('hashchange',function(){try{_phTkConsumeHash();}catch(e){}});",'',['hashchange consumes a pasted #prodops link']);
  await brk('startApp not wrapped',"window.startApp=async function(){\n    const out=await _phTkOrigStartApp","window._x=async function(){\n    const out=await _phTkOrigStartApp",['startApp is wrapped: the original runs, then a cold #prodops link is consumed']);
  await brk('no session still opens a link (both layers: the gate and the empty tab list)',[["if(!link||typeof session==='undefined'||!session||!_phUiCanSee())return false;","if(!link)return false;"],["  if(!t)return false;\n  _phUiTab=t.id;","  _phUiTab=t?t.id:'overview';"]],null,['no session: nothing opens (fail closed)','deep link: raees is not on the audience: nothing opens']);
  await brk('pasted link navigates instead of switching',"if(currentPage===PH_PAGE_ID){phGoTab(t.id);_phTkOnPage();return true;}","",['a link pasted while on the page switches the tab in place (no navigation)']);
  await brk('the skeleton never shows (content before data)',"if(_phUiState!=='done'){host.appendChild(_phUiSkeleton());return;}","",['loading: the panel is a skeleton (.gv-skel), not content and not blank','loading: no tab content and no number is printed before the read settles']);
  await brk('the shell waits for the read before painting (both paints removed)',[["  _phUiPaintData();      // the shell paints first (skeleton); nothing waits on the network\n  // Loads once on open.","  // Loads once on open."],["  _phUiState='loading';\n  _phUiPaintData();","  _phUiState='loading';"]],null,['loading: phRenderPage paints the skeleton SYNCHRONOUSLY, before any read returns']);
  await brk('banner does not name the failures',"st.failed.forEach(function(f){ul.appendChild(phEl('li','ph-line',null,[phEl('code','ph-code',f.name),phEl('span','ph-line-txt',_phUiErrText(f))]));});","",['failed: the banner names BOTH failed collections','failed: a permission failure says to republish the rules']);
  await brk('no Retry button',"card.appendChild(_phUiBtn('ph-btn ph-btn-primary',phI18nD('shell.retry'),function(){phRetry();}));","",['failed: the banner is an alert with a Retry button']);
  await brk('Retry re-reads everything',"return phUiLoad(only.length?{only:only}:{force:true});","return phUiLoad({force:true});",['Retry re-reads ONLY the failed collection (every other count is unchanged)']);
  await brk('a failed stage printed as a count',"txt=row.text?_phUiErrText(row):phI18nD('shell.read_failed');","txt=(row.n||0)+' records';",['failed: Overview marks them FAILED and prints no count for them','failed: the Masters placeholder says FAILED for its collection, never "0 records"']);
  await brk('a throwing render is swallowed into a blank panel',"    phClear(host);\n    host.appendChild(_phUiError(phI18nD('shell.tab_failed'),String(e&&e.message||e)));","    phClear(host);",['a render that throws draws an error card with the message, not a blank panel']);
  await brk('a render that draws nothing is left blank',"if(!host.firstChild)host.appendChild(_phUiError(tab.lkey?phI18nD(tab.lkey):tab.label,phI18nD('shell.tab_empty')));","",['a render that draws nothing says so']);
  await brk('error text parsed as HTML',"function _phUiError(title,msg){\n  const c=phEl('section','ph-card ph-card-err');c.setAttribute('role','alert');\n  c.appendChild(phEl('h3','ph-card-title',title));\n  c.appendChild(phEl('p','ph-note',msg));","function _phUiError(title,msg){\n  const c=phEl('section','ph-card ph-card-err');c.setAttribute('role','alert');\n  c.appendChild(phEl('h3','ph-card-title',title));\n  const p=phEl('p','ph-note');p.innerHTML=msg;c.appendChild(p);",['XSS: the source never assigns innerHTML/outerHTML or parses a string as HTML']);
  await brk('the chip still says View only for the floor',[["  if(typeof phCanRecordFloor==='function'&&phCanRecordFloor(w)===true)return{show:true,text:PH_CHIP_FLOOR,title:PH_CHIP_FLOOR_TITLE,key:'shell.chip_floor',tkey:'shell.chip_floor_tip'};\n",""]],null,['uzaib: the top bar chip is visible and says what his account does (Data entry & cutting), NOT View only','phChipFor: a manager none, the floor Data entry & cutting, anyone else View only']);
  await brk('the chip shows for a manager',"if(_phUiCanManage(w))return{show:false,text:'',title:''};","",['phChipFor: a manager none, the floor Data entry & cutting, anyone else View only','a manager: no View only chip (it is hidden in the top bar)']);
  await brk('a write sneaks into the shell',"function phRetry(){","function phRetry(){ setDoc(doc(db,'po_drafts','x'),{});",['read-only: the source calls no Firestore write API and no ph-write function']);
  s.ok('breaks run: '+broken,broken>=40);
  return s;
};

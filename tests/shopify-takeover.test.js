/* Inventory Intel ▸ full-view takeover and left rail (Oct 2026).
   Drives the real handlers in js/shopify.js (showPage wrap, _siTkExit, _siTkKey, _siTkConsumeHash, _siTkGo, _siTkToggleRail) against the
   harness. The harness has no layout, so the geometry (z-index, 100dvh, the dock, the FAB) is held by css assertions here and by the
   smoke-layout fragments, which hit-test in real Chromium. Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const CSS=fs.readFileSync(path.join(__dirname,'../css/main.css'),'utf8');

function load(src,opts){
  opts=opts||{};
  const store=opts.store||{},calls=[],reg={},mounted=[],orig=[];
  const a=harness.loadApp({files:[],session:opts.session||{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'dashboard',
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},
      getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false,data:()=>({})}),
      history:{replaceState(s,t,u){calls.push(String(u));const i=String(u).indexOf('#');a.ctx.location.hash=i<0?'':String(u).slice(i);}}}});
  const ctx=a.ctx,doc=ctx.document;
  // the harness's getElementById invents a node for any id; the takeover chrome must really be absent until mounted
  const orig0=doc.getElementById.bind(doc);
  doc.getElementById=id=>String(id).indexOf('si-tk-')===0?(reg[id]||null):orig0(id);
  const hold=orig0('__body');
  doc.body.classList=hold.classList;
  doc.body.insertAdjacentHTML=(w,h)=>{
    mounted.push(h);
    ['si-tk-bar','si-tk-rail','si-tk-toggle','si-tk-exit'].forEach(id=>{if(h.indexOf('id="'+id+'"')>=0){const n=doc.createElement('div');n.id=id;reg[id]=n;}});
  };
  const shown=[];
  ctx.window.showPage=function(id){shown.push(id);
    if(opts.noNav&&id==='dashboard')return Promise.resolve();   // a navigation that does nothing: only Exit's own teardown can help
    if(opts.rewrite&&opts.rewrite[id])id=opts.rewrite[id];
    ctx.currentPage=id;
    if(opts.throwOn===id)throw new Error('boom');
    return Promise.resolve();};
  let started=0;
  ctx.window.startApp=async function(){started++;};
  vm.runInContext(src,ctx,{filename:'shopify.js'});
  return{a,ctx,doc,store,calls,reg,mounted,shown,started:()=>started,
    R:c=>a.run(c),
    body:()=>doc.body.classList,html:()=>doc.documentElement.classList,main:()=>orig0('main-content').classList,
    keys:e=>(a.state.listeners.keydown||[]).forEach(f=>f(e)),
    hash:()=>ctx.location.hash};
}
const tick=()=>new Promise(r=>setTimeout(r,5));

async function checks(src){
  const o={};
  const T=load(src),R=T.R;
  // ── entering ──
  o['before: no takeover, no chrome']=!T.body().contains('si-fullscreen')&&T.mounted.length===0;
  await ctx_show(T,'shopify-intel');
  o['entering sets si-fullscreen on body and html and si-takeover on #main-content']=T.body().contains('si-fullscreen')&&T.html().contains('si-fullscreen')&&T.main().contains('si-takeover');
  o['the bar and the rail are mounted once, into <body>']=T.mounted.length===1&&/id="si-tk-bar"/.test(T.mounted[0])&&/id="si-tk-rail"/.test(T.mounted[0]);
  o['the bar carries an Exit control']=/id="si-tk-exit"[^>]*onclick="window\._siTkExit\(\)"/.test(T.mounted[0])&&/Exit/.test(T.mounted[0]);
  const rail=T.reg['si-tk-rail'];
  const items=(rail.innerHTML.match(/class="si-tk-item/g)||[]).length;
  o['the rail lists every entry of the one section list (4)']=items===4&&R('_siNavItems().length')===4&&R('JSON.stringify(_siNavItems().map(x=>x.id))')===R('JSON.stringify(_SI_SECTIONS.map(x=>x.id))');
  o['the active section is marked aria-current and .on (Today)']=/si-tk-item on" data-sec="today" aria-current="page"/.test(rail.innerHTML)&&(rail.innerHTML.match(/aria-current/g)||[]).length===1;
  o['the address bar names the section: #inventory/today via replaceState']=T.hash()==='#inventory/today'&&T.calls.length>=1;
  await ctx_show(T,'shopify-intel');await ctx_show(T,'shopify-intel');
  o['showing the page again never mounts a second rail']=T.mounted.length===1;
  // ── section switching ──
  T.ctx.window._siTkGo('skutable');
  o['a rail click switches the section and the hash follows']=R('_siSection')==='skutable'&&T.hash()==='#inventory/skutable'&&/si-tk-item on" data-sec="skutable"/.test(rail.innerHTML);
  o['only replaceState is ever used (no extra history entries)']=T.calls.every(u=>/^\/#inventory\/[a-z]+$/.test(u))&&!/pushState/.test(src.replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'').split('Full-view takeover')[1]||'');
  // ── the section list is the ONE source ──
  R('_siNavItems=function(){return[{id:"today",label:"Today"},{id:"attention",label:"Needs Attention",badge:true},{id:"articles",label:"Articles"}];}');
  T.ctx.window._siTkGo('today');
  o['changing the list changes the rail AND the tab bar (a restructure edits one place)']=(rail.innerHTML.match(/class="si-tk-item/g)||[]).length===3&&/Today/.test(rail.innerHTML)&&(R('_siTabBar()').match(/class="gp-tab[ "]/g)||[]).length===3;
  o['a monogram is the label\'s first letters unless the list gives one']=/si-tk-mono" aria-hidden="true">To</.test(rail.innerHTML);
  // badge
  R('_siNaBadge=function(){return 12;}');T.ctx.window._siTkGo('today');
  o['the Needs Attention pill shows in the rail']=/Needs Attention<\/span><span class="si-na-pill"[^>]*>12</.test(rail.innerHTML);
  R('_siNaBadge=function(){return 150;}');T.ctx.window._siTkGo('today');
  o['a count over 99 reads 99+ in the rail']=/si-na-pill"[^>]*>99\+</.test(rail.innerHTML);
  R('_siNaBadge=function(){return 0;}');
  // tab-bar repaints repaint the rail
  R('_siNaBadge=function(){return 7;}');R('_siTabBar()');await tick();
  o['any repaint of the tab bar repaints the rail (the history landing, a badge change)']=/si-na-pill"[^>]*>7</.test(rail.innerHTML);
  R('_siNaBadge=function(){return 0;}');
  // ── collapse ──
  T.ctx.window._siTkToggleRail();
  o['Hide menu collapses the rail: body.si-rail-min, stored per viewer, aria-expanded false']=T.body().contains('si-rail-min')&&T.store['groovy-si-rail']==='min'&&T.reg['si-tk-toggle'].getAttribute('aria-expanded')==='false'&&T.reg['si-tk-toggle'].textContent==='Show menu';
  T.ctx.window._siTkToggleRail();
  o['pressing it again restores it']=!T.body().contains('si-rail-min')&&T.store['groovy-si-rail']==='full';
  // ── keyboard ──
  const keyEv=(k,tgt,extra)=>Object.assign({key:k,target:tgt||{tagName:'DIV'},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}},extra||{});
  T.ctx.window._siTkToggleRail();T.ctx.window._siTkToggleRail();
  T.keys(keyEv('Escape',{tagName:'INPUT'}));
  o['Escape in a text field does not leave the page']=T.body().contains('si-fullscreen');
  R('_siNaSel="X1"');T.keys(keyEv('Escape'));R('_siNaSel=""');
  o['Escape with a situation view open leaves it to that view']=T.body().contains('si-fullscreen');
  R('_siAxOvSit="X1"');T.keys(keyEv('Escape'));R('_siAxOvSit=""');
  o['Escape with an Overview situation open leaves it to that view']=T.body().contains('si-fullscreen');
  T.keys(keyEv('Escape',null,{defaultPrevented:true}));
  o['an Escape something else already handled is not a second exit']=T.body().contains('si-fullscreen');
  T.keys(keyEv('a'));
  o['other keys do nothing']=T.body().contains('si-fullscreen');
  const TE=load(src,{throwOn:'dashboard'});TE.ctx.console={warn(){},log(){}};await ctx_show(TE,'shopify-intel');
  const before=TE.shown.length;
  TE.keys(keyEv('Escape'));
  o['Escape exits: the takeover is down and the dashboard is requested']=!TE.body().contains('si-fullscreen')&&!TE.main().contains('si-takeover')&&TE.shown.length===before+1&&TE.shown[TE.shown.length-1]==='dashboard';
  o['exiting clears the #inventory hash']=TE.hash()==='';
  TE.keys(keyEv('Escape'));
  o['Escape off the page does nothing (no stray navigation)']=TE.shown.length===before+1;
  // ── leaving by any route ──
  await ctx_show(T,'hrm-employees');
  o['leaving through any other showPage removes the classes and the hash']=!T.body().contains('si-fullscreen')&&!T.html().contains('si-fullscreen')&&!T.main().contains('si-takeover')&&T.hash()==='';
  await ctx_show(T,'shopify-intel');
  o['re-entering mounts nothing new']=T.mounted.length===1&&T.body().contains('si-fullscreen');
  // ── never strands ──
  await ctx_show(T,'shopify-intel');
  const T2=load(src,{throwOn:'dashboard'});T2.ctx.console={warn(){},log(){}};
  await ctx_show(T2,'shopify-intel');
  T2.ctx.window._siTkExit();await tick();
  o['Exit still takes the takeover down when the navigation fails']=!T2.body().contains('si-fullscreen')&&!T2.main().contains('si-takeover');
  const T3=load(src,{rewrite:{'shopify-intel':'dashboard'}});
  await ctx_show(T3,'shopify-intel');
  o['a role scope that rewrites the page to the dashboard never enters the takeover']=!T3.body().contains('si-fullscreen')&&T3.mounted.length===0;
  const T4=load(src);
  T4.ctx.console={warn(){},log(){}};
  T4.doc.body.insertAdjacentHTML=()=>{const n=T4.doc.createElement('div');n.id='si-tk-rail';Object.defineProperty(n,'innerHTML',{get(){return'';},set(){throw new Error('no DOM');}});T4.reg['si-tk-rail']=n;};
  await ctx_show(T4,'shopify-intel');
  o['a failure while entering leaves no class behind']=!T4.body().contains('si-fullscreen')&&!T4.main().contains('si-takeover');
  // ── deep links ──
  const D=(hash,sess)=>{const t=load(src,{session:sess});t.ctx.location.hash=hash;const r=t.R('_siTkConsumeHash()');return{t,r};};
  let d=D('#inventory/explorer');
  o['#inventory/explorer (an old id) opens the page on Articles']=d.r===true&&d.t.R('_siSection')==='articles'&&d.t.shown.join()==='shopify-intel';
  d=D('#inventory');
  o['#inventory alone opens Today']=d.r===true&&d.t.R('_siSection')==='today'&&d.t.shown.length===1;
  d=D('#inventory/not-a-section');
  o['an unknown section lands on Today, never a blank page']=d.r===true&&d.t.R('_siSection')==='today';
  d=D('#inventory/typeseason');
  o['#inventory/typeseason opens Articles with the Type & season sub-view']=d.r===true&&d.t.R('_siSection')==='articles'&&d.t.R('_siSub')==='typeseason';
  d=D('#inventory/../x');
  o['a malformed hash is ignored']=d.r===false&&d.t.shown.length===0;
  d=D('#board=abc');
  o['another module\'s hash is ignored']=d.r===false&&d.t.shown.length===0;
  d=D('#inventory/explorer',{uid:'w1',u:'asghar',name:'Asghar',role:'worker'});
  o['a worker is not on the audience: nothing opens']=d.r===false&&d.t.shown.length===0;
  d=D('#inventory/explorer',{uid:'m2',u:'arfat',name:'Arfat',role:'manager'});
  o['Arfat (manager role) is not on the audience: the gate is a list, not a role']=d.r===false&&d.t.shown.length===0;
  d=D('#inventory/explorer',{uid:'m1',u:'mustafa',name:'Mustafa',role:'manager'});
  o['Mustafa is on the audience']=d.r===true&&d.t.shown.length===1;
  d=D('#inventory/explorer',{uid:'s1',u:'sami',name:'Sami',role:'csr_lead'});
  o['the CSR lead is on the audience']=d.r===true;
  d=D('#inventory/explorer',{uid:'c1',u:'daniyal',name:'Daniyal',role:'creator_content_ops_lead'});
  o['the Marketing lead is on the audience']=d.r===true;
  const TN=load(src);TN.ctx.session=null;TN.ctx.location.hash='#inventory/explorer';
  o['no session: nothing opens (fail closed)']=TN.R('_siTkConsumeHash()')===false&&TN.shown.length===0;
  // already on the page, loaded: switch in place, no navigation
  const TL=load(src);await ctx_show(TL,'shopify-intel');TL.R('_siLoaded=true');TL.ctx.location.hash='#inventory/weekly';
  const n0=TL.shown.length;TL.R('_siTkConsumeHash()');
  o['a link pasted while on the page switches the section in place (no navigation)']=TL.R('_siSection')==='today'&&TL.R('_siSub')==='weekly'&&TL.shown.length===n0&&TL.hash()==='#inventory/weekly';
  // hashchange and startApp wiring
  const TH=load(src);TH.ctx.location.hash='#inventory/skutable';
  (TH.a.state.listeners['window:hashchange']||[]).forEach(f=>f());
  o['hashchange consumes a pasted #inventory link']=TH.R('_siSection')==='skutable'&&TH.shown.join()==='shopify-intel';
  const TS=load(src);TS.ctx.location.hash='#inventory/explorer';
  await TS.ctx.window.startApp();
  o['startApp is wrapped: the original runs, then a cold #inventory link is consumed']=TS.started()===1&&TS.shown.join()==='shopify-intel'&&TS.R('_siSection')==='articles';
  return o;
}
async function ctx_show(T,id){await T.ctx.window.showPage(id);await tick();}

module.exports=async function(){
  const s=suite('shopify-takeover');
  const base=await checks(SRC);
  s.section('full-view takeover and rail');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));

  s.section('stylesheet contract (geometry the harness cannot lay out)');
  const rule=sel=>{const i=CSS.indexOf(sel+'{');return i<0?'':CSS.slice(i,CSS.indexOf('}',i));};
  const tk=rule('#main-content.si-takeover');
  s.ok('the takeover is fixed at z-index 120 (above .topbar 100 and .cash-action-bar 115)',/position:fixed/.test(tk)&&/z-index:120/.test(tk));
  s.ok('120 stays below the bug FAB (500) and the toast (9999)',/#bug-report-fab\{[^}]*z-index:500/.test(CSS)&&/\.toast\{[^}]*z-index:9999/.test(CSS)&&!/#main-content\.si-takeover\{[^}]*z-index:(?:[5-9]\d\d|\d{4})/.test(CSS));
  s.ok('height is 100dvh with a 100vh line before it',/height:calc\(100vh - [^;]*\);height:calc\(100dvh - /.test(tk));
  s.ok('html and body stop the page behind from scrolling',/body\.si-fullscreen\{[^}]*overflow:hidden/.test(CSS)&&/html\.si-fullscreen\{[^}]*overflow:hidden/.test(CSS)&&/body\.si-fullscreen\{[^}]*height:100dvh/.test(CSS));
  s.ok('bar and rail are hidden unless body.si-fullscreen is set',/\.si-tk-bar,\.si-tk-rail\{display:none\}/.test(CSS));
  s.ok('bar and rail sit at z-index 121, under 500',/body\.si-fullscreen \.si-tk-bar\{[^}]*z-index:121/.test(CSS)&&/body\.si-fullscreen \.si-tk-rail\{[^}]*z-index:121/.test(CSS));
  s.ok('the FAB is not hidden (it is on the Mood Boards canvas)',!/si-fullscreen #bug-report-fab\{[^}]*display:none/.test(CSS));
  s.ok('on a phone the FAB clears the dock',/@media \(max-width:600px\)\{[\s\S]*body\.si-fullscreen #bug-report-fab\{bottom:calc\(var\(--si-tk-dock\)/.test(CSS));
  s.ok('the rail animates 200-250ms (width; labels fade) and honours prefers-reduced-motion',/\.si-tk-rail\{[^}]*transition:width \.22s/.test(CSS)&&/prefers-reduced-motion:reduce\)\{\s*body\.si-fullscreen \.si-tk-rail[^}]*transition:none/.test(CSS));
  s.ok('phone: the rail is a bottom dock with a safe-area inset',/height:calc\(var\(--si-tk-dock\) \+ env\(safe-area-inset-bottom\)\)/.test(CSS));
  s.ok('touch targets: rail item 44px (desktop) and 48px (phone), Exit 36px+',/\.si-tk-item\{[^}]*min-height:44px/.test(CSS)&&/\.si-tk-item\{flex:0 0 auto[^}]*min-height:48px/.test(CSS)&&/\.si-tk-exit,\.si-tk-toggle\{[^}]*min-height:36px/.test(CSS));
  const tkCss=CSS.slice(CSS.indexOf('Inventory Intel: full-view takeover'));
  s.ok('tokens only: no literal colour in the takeover block',!/#[0-9a-fA-F]{3,6}\b/.test(tkCss.replace(/\/\*[\s\S]*?\*\//g,'')));
  s.ok('a focus ring is drawn (keyboard accessible)',/\.si-tk-item:focus-visible[^}]*outline:2px solid var\(--text\)/.test(CSS));

  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  await brk('page decides dropped (never leaves)','else if(!want&&_siTkOn)_siTkLeave();','',['leaving through any other showPage removes the classes and the hash']);
  await brk('exit takes down after navigation','_siTkLeave();\n  try{if(typeof window.showPage===\'function\')window.showPage(\'dashboard\');}','try{if(typeof window.showPage===\'function\')window.showPage(\'dashboard\');}',['Exit still takes the takeover down when the navigation fails']);
  await brk('exit does not leave','window._siTkExit=function(){   // never strands: the takeover is taken down FIRST, then the navigation is attempted\n  _siTkLeave();','window._siTkExit=function(){',['Escape exits: the takeover is down and the dashboard is requested','Exit still takes the takeover down when the navigation fails']);
  await brk('Escape in a field exits','if(e.defaultPrevented||tag===\'INPUT\'||tag===\'TEXTAREA\'||tag===\'SELECT\'||(t&&t.isContentEditable))return;','',['Escape in a text field does not leave the page']);
  await brk('Escape steals the situation view','if(typeof _siNaSel!==\'undefined\'&&_siNaSel)return;','',['Escape with a situation view open leaves it to that view']);
  await brk('Escape steals the Overview situation','if(typeof _siAxOvSit!==\'undefined\'&&_siAxOvSit)return;','',['Escape with an Overview situation open leaves it to that view']);
  await brk('audience gate opened to every role','session.role===\'owner\'||session.u===\'mustafa\'||session.role===\'csr_lead\'||session.role===\'creator_content_ops_lead\'','true',['a worker is not on the audience: nothing opens','Arfat (manager role) is not on the audience: the gate is a list, not a role']);
  await brk('manager role granted wholesale','session.u===\'mustafa\'','session.role===\'manager\'',['Arfat (manager role) is not on the audience: the gate is a list, not a role']);
  await brk('no session still opens','if(!link||typeof session===\'undefined\'||!session||!_siTkAllowed())return false;','if(!link)return false;',['no session: nothing opens (fail closed)']);
  await brk('unknown section not defaulted','const r=_siSecResolve(m[1]||\'today\');return{section:r.sec,sub:r.sub};','return{section:m[1]||\'today\',sub:\'\'};',['an unknown section lands on Today, never a blank page']);
  await brk('hash writes push history','history.replaceState(null,\'\',base+want)','history.pushState(null,\'\',base+want)',['the address bar names the section: #inventory/today via replaceState']);
  await brk('hash left behind on leave','if(was)_siTkSetHash(\'\');','',['exiting clears the #inventory hash']);
  await brk('rail has its own list','return _siNavItems().map(t=>{\n    const on=_siSection===t.id;','return [{id:"today",label:"Today"}].map(t=>{\n    const on=_siSection===t.id;',['the rail lists every entry of the one section list (4)']);
  await brk('tab bar has its own list','${_siNavItems().map(t=>\n    `<button class="gp-tab','${[{id:"today",label:"Today"},{id:"attention",label:"x"}].map(t=>\n    `<button class="gp-tab',['changing the list changes the rail AND the tab bar (a restructure edits one place)']);
  await brk('active mark dropped','${on?\' aria-current="page"\':\'\'}','',['the active section is marked aria-current and .on (Today)']);
  await brk('tab bar repaint does not repaint the rail','if(typeof _siTkPaintSoon===\'function\')_siTkPaintSoon();','',['any repaint of the tab bar repaints the rail (the history landing, a badge change)']);
  await brk('a second rail on every show','if(document.getElementById(\'si-tk-bar\')&&document.getElementById(\'si-tk-rail\'))return;','',['re-entering mounts nothing new']);
  await brk('collapse not remembered','localStorage.setItem(_SI_TK_RAIL_KEY,_siTkMin?\'min\':\'full\');','',['Hide menu collapses the rail: body.si-rail-min, stored per viewer, aria-expanded false']);
  await brk('hashchange not wired','window.addEventListener(\'hashchange\',()=>{try{_siTkConsumeHash();}catch(e){}});','',['hashchange consumes a pasted #inventory link']);
  await brk('startApp not wrapped','window.startApp=async function(){\n    const out=await _siTkOrigStartApp','window._x=async function(){\n    const out=await _siTkOrigStartApp',['startApp is wrapped: the original runs, then a cold #inventory link is consumed']);
  await brk('pasted link navigates instead of switching','if(_siSection!==link.section||_siSub!==link.sub)window._siSwitchTab(link.sub||link.section);','window.showPage(\'shopify-intel\');',['a link pasted while on the page switches the section in place (no navigation)']);
  await brk('enter failure leaves the class','}catch(e){_siTkOn=true;_siTkLeave();console.warn(','}catch(e){console.warn(',['a failure while entering leaves no class behind']);
  await brk('rewritten page still enters','const want=typeof currentPage!==\'undefined\'&&currentPage===\'shopify-intel\';','const want=true;',['a role scope that rewrites the page to the dashboard never enters the takeover','leaving through any other showPage removes the classes and the hash']);
  s.ok('breaks run: '+broken,broken>=24);
  return s;
};

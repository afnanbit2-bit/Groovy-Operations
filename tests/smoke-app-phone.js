#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   The whole app on a phone.  `node tests/smoke-app-phone.js`

   smoke-layout.js measures FRAGMENTS and smoke-phone.js measures the Mood
   Boards canvas. Neither had ever seen an ordinary page the way a phone
   does: the real index.html shell, signed in, with the bottom nav, the bug
   FAB and the toast all fixed to one 390x844 screen. The phone sweep of 27
   Sept 2026 did exactly that for every page and every role, and found what
   no logic suite could: the Dashboard's stage tiles breaking their labels
   mid-word ("Cuttin g"), the Users page printing "Creator_content_ops_lead"
   and pushing its button off the screen, the toast painted over the bottom
   nav, 24px buttons, and — in dark mode — the Dashboard's KPI tiles left
   cream-white under near-white numbers (1.09:1). This is that sweep, kept.

   How: the real shell and scripts are served; only the Firebase module is
   swapped for the in-memory Firestore tests/smoke-board.js already uses
   (its STUB and CLOCK are read out of that file, not copied, so the two
   cannot drift). The page is rendered inside an <iframe> of the real phone
   width — headless Chromium clamps --window-size to 500px wide, the trap
   recorded in smoke-phone.js — and the driver inside it signs in, opens
   every page for that role, and measures:
     - the page never scrolls sideways;
     - nothing is laid out past the right edge of the screen (unless it sits
       in a strip that scrolls sideways on purpose, like a tab bar);
     - no text is below 2.2:1 against its background, in either theme
       (the smoke-layout threshold: "a human cannot read this at all");
       text over a gradient is skipped, as the probe cannot read one;
     - the small buttons and chips are at least 34px tall on a phone;
     - the toast sits above the bottom nav;
     - nothing threw.

   Skips cleanly (exit 0) when no browser is available.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const http=require('http');
const os=require('os');
const {execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');

function findBrowser(){
  if(process.env.CHROME_BIN&&fs.existsSync(process.env.CHROME_BIN))return process.env.CHROME_BIN;
  for(const c of ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'])if(fs.existsSync(c))return c;
  try{for(const d of fs.readdirSync('/opt/pw-browsers')){const p=path.join('/opt/pw-browsers',d,'chrome-linux','chrome');if(fs.existsSync(p))return p;}}catch(e){}
  return null;
}
const browser=findBrowser();
if(!browser){console.log('smoke-app-phone: no browser found — skipping');process.exit(0);}

// The in-memory Firestore and the pinned clock, read out of smoke-board.js.
const boardSrc=fs.readFileSync(path.join(__dirname,'smoke-board.js'),'utf8');
function grab(name){const i=boardSrc.indexOf('function '+name+'(){');const j=boardSrc.indexOf('\n}\n',i);
  if(i<0||j<0)throw new Error('smoke-app-phone: could not find '+name+' in smoke-board.js');return boardSrc.slice(i,j+2);}
const STUB=grab('STUB'),CLOCK=grab('CLOCK');

// USER_DEFS straight from js/auth.js, so a new account is covered by default.
const authSrc=fs.readFileSync(path.join(ROOT,'js','auth.js'),'utf8');
const USERS=Function('return '+/const USER_DEFS\s*=\s*(\[[\s\S]*?\n\]);/.exec(authSrc)[1])();

function seed(){
  const now=Date.UTC(2026,8,26,4);
  const cols={user_profiles:{},pos:{},gatepasses:{},activity:{},bug_reports:{},notes_pages:{}};
  USERS.forEach(u=>{cols.user_profiles['u-'+u.u]={uid:'u-'+u.u,username:u.u,updatedAt:now};});
  const stages=['cutting','printing','bundling','stitching','washing','qc','completed'];
  const names=['Effortless Tee | Deep Blue — Winter Drop 2027 Oversized Heavyweight','Live In Pants | Charcoal',
    'Combat Hoodie | Black','Baby Tee | Cream','Cargo Trouser | Olive','Jorts | Washed Indigo'];
  names.forEach((n,i)=>{cols.pos['k'+i]={id:'PO-10'+(40+i),name:n,code:'GST0'+(70+i),fabric:'Single Jersey 180 GSM',
    qty:120+i*40,sizes:{XS:10,S:20,M:40,L:30,XL:15,'2XL':5},currentStage:stages[i],status:'active',ts:now-i*86400000,
    date:'2026-09-2'+i,createdBy:'Afnan',embellishment:{required:i%2===0}};});
  // QC6: one PO at final QC with its cut recorded, so Faizan's "+ Receive units" sheet can be opened on the phone (keyed by its PO number, as a real pos document is)
  cols.pos['PO-1046']={id:'PO-1046',name:'Athletic Tee · Black — the 120-piece QC example',code:'GAT012',fabric:'Single Jersey 180 GSM',qty:120,
    sizes:{S:20,M:40,L:40,XL:20},cutQty:{S:20,M:40,L:40,XL:20},cutAt:'2026-09-24T08:00:00.000Z',cutDate:'2026-09-24',cutBy:'Uzaib',
    currentStage:'qc',poStatus:'in_production',status:'active',ts:now-3*86400000,date:'2026-09-23',createdBy:'Afnan',
    stages:{cutting:{done:true},qc:{done:false}},packingReceipts:[]};
  // QC7: one PO at final QC with two lots received and M 2 short, so a manager's "Close with a shortfall…" dialog can be opened on the phone
  cols.pos['PO-1047']={id:'PO-1047',name:'Athletic Tee · White — the short-close example',code:'GAT013',fabric:'Single Jersey 180 GSM',qty:120,
    sizes:{S:20,M:40,L:40,XL:20},cutQty:{S:20,M:40,L:40,XL:20},cutAt:'2026-09-24T08:00:00.000Z',cutDate:'2026-09-24',cutBy:'Uzaib',
    currentStage:'qc',poStatus:'in_production',status:'active',ts:now-4*86400000,date:'2026-09-22',createdBy:'Afnan',
    stages:{cutting:{done:true},qc:{done:false}},packingReceipts:[]};
  cols.po_qc_recon={'PO-1047':{poId:'PO-1047',status:'locked',rev:2,cutLock:{sizes:{S:20,M:40,L:40,XL:20},total:120,cutAt:'2026-09-24T08:00:00.000Z',cutBy:'Uzaib',
    lockedAt:now-2*86400000,lockedBy:'faizan',source:'first_lot'},lotCount:2,voidCount:0,lastLotAt:now-3600000,overrides:[],legacyIds:[],closedAt:0,closedBy:'',
    closedByName:'',closeVerdict:null,createdAt:now-2*86400000,createdBy:'faizan',updatedAt:now-3600000,updatedBy:'faizan',updatedByName:'Faizan'}};
  cols.po_qc_lots={
    'PO-1047-1758866400001-aaaa':{poId:'PO-1047',seq:1,sizes:{S:20,M:20,L:20,XL:10},total:70,day:'2026-09-25',note:'',at:now-2*3600000,by:'faizan',byName:'Faizan',status:'live',src:'qc'},
    'PO-1047-1758866400002-bbbb':{poId:'PO-1047',seq:2,sizes:{M:18,L:20,XL:10},total:48,day:'2026-09-25',note:'',at:now-3600000,by:'faizan',byName:'Faizan',status:'live',src:'qc'}};
  for(let i=0;i<4;i++)cols.gatepasses['g'+i]={id:'GP-031'+i,name:'Uzaib',date:'2026-09-25',type:'units',reason:'process',
    article:names[i],spec:'Black / 180 GSM',dest:'Rahim Gul Enterprise',qty:100,total:100,ts:now-i*3600000,status:'out'};
  for(let i=0;i<8;i++)cols.activity['a'+i]={user:'Mustafa',u:'mustafa',action:'Fabric roll deleted',
    detail:'Roll BLK-220 (42.5 kg) removed from Single Jersey Black — duplicate entry',ts:now-i*1800000};
  cols.bug_reports.b0={title:'Save does nothing on the gate pass form when the phone is offline',severity:'high',
    status:'open',page:'gatepass',ts:now,createdAt:now};
  cols.notes_pages.n1={title:'Cutting room SOP',visibility:'shared',ownerUid:'u-afnan',ownerName:'Afnan',
    blocks:[{type:'paragraph',text:'Relax the fabric 24 hours before cutting.'}],updatedAt:now,createdAt:now};
  return cols;
}

const OWNER_PAGES=['dashboard','po-create','po-registry','gatepass','fabric-inventory','qc-disposition','bstock',
  'fulfillment','activity','monitor','users','bug-tracker','profile','creative-hub','notes','boards-all',
  'store-dashboard','store-inventory','store-receive','store-issue','store-templates','store-log',
  'store-analytics','acct-ledger','po-issue-list','recipe-directory','printing-jobs','observer-tower',
  'color-library','shopify-intel','prod-ops','hrm-employees','attendance','hrm-payroll','hrm-advances','hrm-loans',
  'mkt-creators','mkt-dispatches','mkt-paid-pr','mkt-reports','pattern-hub','pattern-blocks',
  'tb-dash','tb-calendar','tb-lists','tb-inbox','me',
  'ma-overview','ma-money','ma-in','ma-out','ma-parties','ma-ledger','ma-close'];
const JOBS=[
  {id:'owner-light',user:'afnan',theme:'light',pages:OWNER_PAGES},
  {id:'owner-dark',user:'afnan',theme:'dark',pages:OWNER_PAGES},
  {id:'worker',user:'abbas',theme:'light',pages:['','gatepass','me','creative-hub']},
  {id:'viewer',user:'uzaib',theme:'dark',pages:['','fabric-inventory','prod-ops','me']},
  {id:'store',user:'raees',theme:'light',pages:['','store-inventory','acct-ledger','store-receive','profile']},
  {id:'fulfilment',user:'umair',theme:'light',pages:['']},
  {id:'marketing',user:'daniyal',theme:'dark',pages:['','mkt-dispatches','mkt-creators']},
  {id:'csr',user:'sami',theme:'light',pages:['','qc-disposition','bstock']},
  // QC5 (15 Oct 2026): Faizan (role packing, the QC floor): Packing, B-Stock and the Production Ops takeover with ONE tab (Afloat POs)
  {id:'packing',user:'faizan',theme:'light',pages:['','packing','bstock','prod-ops']}
];

// ── In the phone frame: sign in, open every page, measure ───────────────
function DRIVE(){
  var PAGES=window.__PAGES,res=[];
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(el){var p=el;while(p&&p!==document.body){var c=getComputedStyle(p);if(c.display==='none'||c.visibility==='hidden')return false;p=p.parentElement;}
    return el.getClientRects().length>0&&+getComputedStyle(el).opacity>0;}
  function nm(el){var c=typeof el.className==='string'?el.className:'';var t=(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,28);
    return el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(c?'.'+c.trim().split(/\s+/).slice(0,2).join('.'):'')+(t?' "'+t+'"':'');}
  function sideScroller(el){var p=el.parentElement;while(p&&p!==document.body){var c=getComputedStyle(p);
    if(/(auto|scroll|hidden)/.test(c.overflowX)&&p.scrollWidth>p.clientWidth+1)return true;if(c.position==='fixed')return true;p=p.parentElement;}return false;}
  function rgb(s){var m=String(s).match(/[\d.]+/g);return m?m.map(Number):[0,0,0,0];}
  function lum(c){var a=c.slice(0,3).map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];}
  // The first opaque background under the text, or null when a gradient or
  // picture is in the way (the probe cannot read one).
  function bgOf(el){while(el){var c=getComputedStyle(el);if(c.backgroundImage&&c.backgroundImage!=='none')return null;
    var b=rgb(c.backgroundColor);if(b.length<4||b[3]>0.5)return b;el=el.parentElement;}return[255,255,255,1];}
  function probe(){
    var out=[],vw=innerWidth,se=document.scrollingElement;
    if(se.scrollWidth>vw+1)out.push('the page scrolls sideways by '+(se.scrollWidth-vw)+'px');
    var all=[].slice.call(document.querySelectorAll('#scr-app *')).filter(vis);
    all.forEach(function(el){
      var r=el.getBoundingClientRect();if(!r.width&&!r.height)return;
      if(r.right>vw+1&&r.left<vw&&getComputedStyle(el).position!=='fixed'&&!sideScroller(el))out.push('past the right edge ('+Math.round(r.right)+'px): '+nm(el));
      var own=[].some.call(el.childNodes,function(n){return n.nodeType===3&&n.textContent.trim();});
      if(!own)return;
      var cs=getComputedStyle(el),f=rgb(cs.color);if(f.length>3&&f[3]<0.4)return;
      var b=bgOf(el);if(!b)return;
      var l1=lum(f),l2=lum(b),cr=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
      if(cr<2.2)out.push('unreadable text ('+cr.toFixed(2)+':1): '+nm(el));
    });
    [].slice.call(document.querySelectorAll('#scr-app .btn-sm,#scr-app .btn-outline,#scr-app .filter-chip,#scr-app .dest-chip')).filter(vis).forEach(function(el){
      var h=el.getBoundingClientRect().height;if(h<33.5)out.push('a '+Math.round(h)+'px tap target: '+nm(el));});
    var seen={};return out.filter(function(x){if(seen[x])return false;seen[x]=1;return true;}).slice(0,12);
  }
  async function go(){
    try{
      if(typeof window.__bootApp==='function')window.__bootApp();
      session=window.__SESSION;window.startApp();
      await wait(700);
      for(var i=0;i<PAGES.length;i++){
        var id=PAGES[i];
        var e0=window.__errs.length;
        if(id)try{window.showPage(id);}catch(e){window.__errs.push('showPage('+id+') threw: '+e.message);}
        await wait(500);
        document.scrollingElement.scrollTop=0;
        var errs=window.__errs.slice(e0).filter(function(e){return!/ERR_|Failed to load resource/.test(e);});
        res.push({page:id||'(landing: '+currentPage+')',issues:probe().concat(errs.map(function(e){return'threw: '+e;}))});
      }
      // The PO Registry (js/po-registry.js, RG3/RG4): the new body is the one drawn, every row is a button at least 44px tall inside the
      // screen, the view tabs are 34px+ tap targets, and a tap on a row opens the PO's detail (with the timeline).
      if(PAGES.indexOf('po-registry')>=0){
        var rg=[];
        try{
          window.showPage('po-registry');await wait(600);
          var body=document.getElementById('por-body');
          if(!body)rg.push('the new registry body (#por-body) is not drawn');
          else{
            var rws=[].slice.call(body.querySelectorAll('button.por-row'));
            if(!rws.length)rg.push('no PO rows');
            rws.forEach(function(r){var b=r.getBoundingClientRect();if(b.height<44)rg.push('a row is '+Math.round(b.height)+'px tall');if(b.right>innerWidth+1)rg.push('a row runs past the edge');});
            [].slice.call(body.querySelectorAll('.por-view,.por-chip')).filter(vis).forEach(function(v){var h=v.getBoundingClientRect().height;if(h<33.5)rg.push('a '+Math.round(h)+'px view or chip: '+nm(v));});
            [].slice.call(body.querySelectorAll('img')).forEach(function(im){if(!im.getAttribute('alt'))rg.push('a picture with no alt text');});
            if(rws.length){rws[0].click();await wait(600);
              if(currentPage!=='po-detail')rg.push('a tap on a row did not open the PO (page '+currentPage+')');
              else if(typeof porDetailBodyHTML==='function'&&!document.querySelector('#por-detail .por-tl'))rg.push('the detail has no timeline');
              else{var issues=probe();issues.forEach(function(x){rg.push('detail: '+x);});}
            }
          }
        }catch(e){rg.push('the registry check threw: '+e.message);}
        res.push({page:'(po registry)',issues:rg});
      }
      // Inventory Intel's full-view takeover, in the real shell on a phone: the bar and the dock are on screen and clear of the content and the
      // bug FAB, Escape and the deep link both work, and leaving removes every trace.
      if(PAGES.indexOf('shopify-intel')>=0){
        var tk=[];
        try{
          window.showPage('shopify-intel');await wait(600);
          var tb=document.getElementById('si-tk-bar'),tr=document.getElementById('si-tk-rail'),tm=document.getElementById('main-content');
          if(!document.body.classList.contains('si-fullscreen')||!tb||!tr)tk.push('the takeover did not open');
          else{
            var br=tb.getBoundingClientRect(),rr=tr.getBoundingClientRect(),mr=tm.getBoundingClientRect(),fab=document.getElementById('bug-report-fab');
            if(br.top!==0||br.height<40)tk.push('the bar is not at the top ('+Math.round(br.top)+','+Math.round(br.height)+')');
            if(Math.round(rr.bottom)!==innerHeight||rr.height<56)tk.push('the dock is not at the bottom ('+Math.round(rr.bottom)+' of '+innerHeight+', '+Math.round(rr.height)+'px tall)');
            if(Math.round(mr.top)!==Math.round(br.bottom)||Math.round(mr.bottom)>Math.round(rr.top))tk.push('the content overlaps the bar or the dock');
            if(fab&&fab.getClientRects().length&&fab.getBoundingClientRect().bottom>rr.top+0.5)tk.push('the bug button sits on the dock');
            var tz=+getComputedStyle(tm).zIndex,fz=fab?+getComputedStyle(fab).zIndex:500;
            if(!(tz>100&&tz<fz))tk.push('the takeover z-index '+tz+' is not between the topbar (100) and the bug button ('+fz+')');
            [].slice.call(tr.querySelectorAll('.si-tk-item')).forEach(function(it){var r=it.getBoundingClientRect();if(r.height<34||r.width<34)tk.push('a rail item is '+Math.round(r.width)+'x'+Math.round(r.height));if(r.right>innerWidth+1&&it.parentElement.scrollWidth<=it.parentElement.clientWidth)tk.push('a rail item is past the edge');});
          }
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(500);
          if(document.body.classList.contains('si-fullscreen')||document.getElementById('main-content').classList.contains('si-takeover'))tk.push('Escape did not leave the takeover');
          if(currentPage==='shopify-intel')tk.push('Escape did not leave the page');
          if(/^#inventory/.test(location.hash))tk.push('the hash was left behind');
          location.hash='#inventory/explorer';await wait(700);
          if(currentPage!=='shopify-intel'||!document.body.classList.contains('si-fullscreen'))tk.push('the legacy #inventory/explorer link (now Articles) did not open the page');
          if(location.hash!=='#inventory/articles')tk.push('the hash is '+location.hash);
          window.showPage('hrm-employees');await wait(500);
          if(document.body.classList.contains('si-fullscreen')||document.documentElement.classList.contains('si-fullscreen')||document.getElementById('main-content').classList.contains('si-takeover'))tk.push('leaving by showPage left the class behind');
          if(/^#inventory/.test(location.hash))tk.push('leaving by showPage left the hash behind');
        }catch(e){tk.push('the takeover check threw: '+e.message);}
        res.push({page:'(inventory takeover)',issues:tk});
      }
      // Production Ops' full-view takeover (12 Oct 2026), in the real shell on a phone: the same checks as Inventory Intel's, for js/ph-ui.js.
      // Afnan sees eleven tabs (QC5 added Afloat POs), Faizan (QC floor) one, Uzaib (a viewer, no More sheet) six (Overview, PO Queue for the drafts, Today's Cutting, then WP-15's hosted PO Registry, Pattern updates and Fabric Inventory; ph-mod-queue.js widens the queue tab to him); Escape and the #prodops deep link work; leaving removes every trace.
      if(PAGES.indexOf('prod-ops')>=0){
        // QC5: the managers' rail gained Afloat POs (11); Faizan (QC floor) has exactly that one tab; Uzaib is unchanged (6)
        var q7done=false,pk=[],who=window.__SESSION&&window.__SESSION.u,want=who==='uzaib'?6:who==='faizan'?1:11;
        if(who==='faizan'){
          var mb=[].slice.call(document.querySelectorAll('#mob-nav .mob-nav-btn')).map(function(b){return b.getAttribute('data-mob-id');});
          if(mb.join()!=='packing,bstock,prod-ops')pk.push('Faizan\'s phone nav is '+mb.join()+', expected packing,bstock,prod-ops');
        }
        try{
          window.showPage('prod-ops');await wait(900);
          var pb=document.getElementById('ph-tk-bar'),pr=document.getElementById('ph-tk-rail'),pm=document.getElementById('main-content');
          if(!document.body.classList.contains('ph-fullscreen')||!pb||!pr)pk.push('the takeover did not open');
          else{
            var b2=pb.getBoundingClientRect(),r2=pr.getBoundingClientRect(),m2=pm.getBoundingClientRect(),fab2=document.getElementById('bug-report-fab');
            if(b2.top!==0||b2.height<40)pk.push('the bar is not at the top ('+Math.round(b2.top)+','+Math.round(b2.height)+')');
            if(Math.round(r2.bottom)!==innerHeight||r2.height<56)pk.push('the dock is not at the bottom ('+Math.round(r2.bottom)+' of '+innerHeight+', '+Math.round(r2.height)+'px tall)');
            if(Math.round(m2.top)!==Math.round(b2.bottom)||Math.round(m2.bottom)>Math.round(r2.top))pk.push('the content overlaps the bar or the dock');
            if(fab2&&fab2.getClientRects().length&&fab2.getBoundingClientRect().bottom>r2.top+0.5)pk.push('the bug button sits on the dock');
            var tz2=+getComputedStyle(pm).zIndex,fz2=fab2?+getComputedStyle(fab2).zIndex:500;
            if(!(tz2>100&&tz2<fz2))pk.push('the takeover z-index '+tz2+' is not between the topbar (100) and the bug button ('+fz2+')');
            var its=[].slice.call(pr.querySelectorAll('.ph-tk-item'));
            if(its.length!==want)pk.push('the rail has '+its.length+' tabs, expected '+want);
            its.forEach(function(it){var r=it.getBoundingClientRect();if(r.height<44||r.width<44)pk.push('a rail item is '+Math.round(r.width)+'x'+Math.round(r.height));});
            if(!document.getElementById('ph-panel'))pk.push('the canvas has no panel');
            // QC6: Faizan opens a PO and its "+ Receive units" sheet at 390px: nothing sideways, boxes and buttons thumb-sized, Review reachable above the dock
            if(who==='faizan'){
              var findCard=function(){return[].slice.call(document.querySelectorAll('.phaf-card')).filter(function(c){return c.getAttribute('data-po')==='PO-1046';})[0];};
              for(var wi=0;wi<20&&!findCard();wi++)await wait(250);
              var card=findCard();
              if(!card)pk.push('QC6: the PO-1046 tile is not on Faizan\'s board (tiles: '+[].slice.call(document.querySelectorAll('.phaf-card')).map(function(c){return c.getAttribute('data-po');}).join()+')');
              else{card.click();await wait(500);
                var rb=document.getElementById('phaf-recv-btn');
                if(!rb||rb.disabled)pk.push('QC6: no live "+ Receive units" on the detail');
                else{rb.click();await wait(400);
                  var sh=document.querySelector('.phaf-sheet'),ins=[].slice.call(document.querySelectorAll('.phaf-rx-in'));
                  if(!sh)pk.push('QC6: the receive sheet did not open');
                  else{
                    if(document.documentElement.scrollWidth>innerWidth+1)pk.push('QC6: the sheet scrolls sideways ('+document.documentElement.scrollWidth+' > '+innerWidth+')');
                    if(ins.length!==4)pk.push('QC6: the sheet has '+ins.length+' size boxes, expected 4');
                    ins.forEach(function(n){var r=n.getBoundingClientRect();if(r.height<44||r.right>innerWidth+0.5||r.left<-0.5)pk.push('QC6: a size box is '+Math.round(r.width)+'x'+Math.round(r.height)+' at '+Math.round(r.left));});
                    [].slice.call(sh.querySelectorAll('.phaf-stepb')).forEach(function(n){var r=n.getBoundingClientRect();if(r.height<44||r.width<44)pk.push('QC6: a +/− button is '+Math.round(r.width)+'x'+Math.round(r.height));});
                    if(document.activeElement!==ins[0])pk.push('QC6: focus is not in the first size box');
                    ins[1].value='5';ins[1].dispatchEvent(new Event('input',{bubbles:true}));await wait(100);
                    var rv=document.getElementById('phaf-rx-review');
                    if(!rv)pk.push('QC6: no Review and save button');
                    else{rv.scrollIntoView({block:'end'});await wait(200);var rr=rv.getBoundingClientRect(),dk=document.getElementById('ph-tk-rail').getBoundingClientRect();
                      if(rr.bottom>dk.top+0.5||rr.height<44)pk.push('QC6: Review and save is under the dock or too small ('+Math.round(rr.bottom)+' vs dock '+Math.round(dk.top)+', '+Math.round(rr.height)+'px)');
                      var hit=document.elementFromPoint(rr.left+rr.width/2,rr.top+rr.height/2);if(!hit||(hit!==rv&&!rv.contains(hit)))pk.push('QC6: Review and save cannot be tapped (covered by '+(hit&&hit.className)+')');
                      rv.click();await wait(300);
                      var sv=document.getElementById('phaf-rx-save');if(!sv)pk.push('QC6: the review step has no Save lot button');
                      else{if(!/Once saved, this lot cannot be edited/.test(document.querySelector('.phaf-review').textContent))pk.push('QC6: the review does not say a saved lot cannot be edited');
                        if(document.documentElement.scrollWidth>innerWidth+1)pk.push('QC6: the review scrolls sideways');}}
                    var x=document.getElementById('phaf-sheet-x');if(x){x.click();await wait(300);}
                    if(document.querySelector('.phaf-sheet'))pk.push('QC6: Cancel did not close the sheet');
                    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(300);
                    if(document.querySelector('.phaf-detail'))pk.push('QC6: Escape did not close the PO detail (back to the board)');
                  }}
              }
            }
          }
          // QC7: a manager (Afnan) opens the short PO and its "Close with a shortfall…" dialog at 390px: nothing sideways, the boxes and
          // buttons thumb-sized and above the dock, Escape closes the dialog and gives focus back to the button that opened it
          if(who==='afnan'&&!q7done){q7done=true;
            location.hash='#prodops/afloat';await wait(900);
            var find7=function(){return[].slice.call(document.querySelectorAll('.phaf-card')).filter(function(c){return c.getAttribute('data-po')==='PO-1047';})[0];};
            for(var w7=0;w7<20&&!find7();w7++)await wait(250);
            var c7=find7();
            if(!c7)pk.push('QC7: the PO-1047 tile is not on the manager board (tiles: '+[].slice.call(document.querySelectorAll('.phaf-card')).map(function(c){return c.getAttribute('data-po');}).join()+')');
            else{c7.click();await wait(500);
              var cb=document.getElementById('phaf-close-btn');
              if(!cb||cb.disabled||!/phaf-short-btn/.test(cb.className))pk.push('QC7: no live "Close with a shortfall…" on the detail');
              else{cb.click();await wait(400);
                var dg=document.querySelector('.phaf-dlg'),cs=document.getElementById('phaf-dlg-cause'),rs=document.getElementById('phaf-dlg-reason'),gb=document.getElementById('phaf-dlg-go');
                if(!dg||!cs||!rs||!gb)pk.push('QC7: the close-short dialog did not open with a cause, a reason and a Continue button');
                else{
                  if(document.documentElement.scrollWidth>innerWidth+1)pk.push('QC7: the dialog scrolls sideways ('+document.documentElement.scrollWidth+' > '+innerWidth+')');
                  if(!/M/.test((document.querySelector('.phaf-ov-gaps')||{}).textContent||''))pk.push('QC7: the dialog does not name the short size');
                  [cs,rs,gb].forEach(function(n){var r=n.getBoundingClientRect();if(r.height<44||r.right>innerWidth+0.5||r.left<-0.5)pk.push('QC7: '+(n.id)+' is '+Math.round(r.width)+'x'+Math.round(r.height)+' at '+Math.round(r.left));});
                  if(document.activeElement!==cs)pk.push('QC7: focus is not in the cause box');
                  gb.scrollIntoView({block:'end'});await wait(200);var gr=gb.getBoundingClientRect(),dk7=document.getElementById('ph-tk-rail').getBoundingClientRect();
                  if(gr.bottom>dk7.top+0.5)pk.push('QC7: Continue is under the dock ('+Math.round(gr.bottom)+' vs '+Math.round(dk7.top)+')');
                  var h7=document.elementFromPoint(gr.left+gr.width/2,gr.top+gr.height/2);if(!h7||(h7!==gb&&!gb.contains(h7)))pk.push('QC7: Continue cannot be tapped (covered by '+(h7&&h7.className)+')');
                  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(300);
                  if(document.querySelector('.phaf-dlg'))pk.push('QC7: Escape did not close the dialog');
                  if(!document.querySelector('.phaf-detail'))pk.push('QC7: Escape closed the PO detail as well as the dialog');
                  var cb2=document.getElementById('phaf-close-btn');if(document.activeElement!==cb2)pk.push('QC7: focus did not go back to the button that opened the dialog');
                }
                document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(300);
              }}
          }
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(500);
          if(document.body.classList.contains('ph-fullscreen')||document.getElementById('main-content').classList.contains('ph-takeover'))pk.push('Escape did not leave the takeover');
          if(currentPage==='prod-ops')pk.push('Escape did not leave the page');
          if(/^#prodops/.test(location.hash))pk.push('the hash was left behind');
          location.hash='#prodops/cutting';await wait(900);
          if(currentPage!=='prod-ops'||!document.body.classList.contains('ph-fullscreen'))pk.push('the #prodops/cutting link did not open the page');
          if(location.hash!==(who==='faizan'?'#prodops/afloat':'#prodops/cutting'))pk.push('the hash is '+location.hash);
          if(who==='faizan'){var rl=[].slice.call(document.querySelectorAll('#ph-tk-rail .ph-tk-item')).map(function(b){return b.getAttribute('data-tab');});
            if(rl.join()!=='afloat')pk.push('Faizan\'s rail is '+rl.join()+', expected afloat');
            if(!document.querySelector('#ph-panel .phaf-groups, #ph-panel .phaf-empty, #ph-panel .phaf-alert, #ph-panel .phaf-skel'))pk.push('the Afloat POs tab did not draw');}
          if(want===6){location.hash='#prodops/patterns';await wait(700);if(!document.getElementById('ph-panel')||!document.querySelector('#ph-tk-rail .ph-tk-item.on, #ph-tk-rail .ph-tk-item[aria-current]'))pk.push('the #prodops/patterns link did not open a hosted tab');}
          window.showPage('dashboard');await wait(500);
          if(document.body.classList.contains('ph-fullscreen')||document.documentElement.classList.contains('ph-fullscreen')||document.getElementById('main-content').classList.contains('ph-takeover'))pk.push('leaving by showPage left the class behind');
          if(/^#prodops/.test(location.hash))pk.push('leaving by showPage left the hash behind');
        }catch(e){pk.push('the takeover check threw: '+e.message);}
        res.push({page:'(production ops takeover)',issues:pk});
      }
      // The toast must clear the bottom nav.
      var nav=document.getElementById('mob-nav');
      if(typeof showToast==='function')showToast('A toast on a phone');
      await wait(300);
      // Where the toast COMES TO REST: its bottom offset, not its rect --
      // under --virtual-time-budget the slide-up transition may not have run.
      var t=document.querySelector('.toast.show'),nr=nav&&nav.getBoundingClientRect();
      var rest=t?innerHeight-parseFloat(getComputedStyle(t).bottom):0;
      res.push({page:'(toast)',issues:(t&&nr&&nr.height&&rest>nr.top+1)?['the toast (rests at '+Math.round(rest)+'px) sits on the bottom nav ('+Math.round(nr.top)+'px)']:[]});
    }catch(e){res.push({page:'(driver)',issues:['the driver threw: '+e.message]});}
    window.parent.document.getElementById('__out').textContent=JSON.stringify(res);
  }
  go();
}

function appPage(job){
  const idx=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<script type="module">[\s\S]*?<\/script>/,'');
  const def=USERS.find(x=>x.u===job.user);
  const sess=Object.assign({},def,{uid:'u-'+def.u});
  const pre='<script>window.__SEED='+JSON.stringify(seed())+';window.__UID='+JSON.stringify(sess.uid)
    +';window.__EMAIL='+JSON.stringify(def.email)+';window.__SESSION='+JSON.stringify(sess)
    +';window.__PAGES='+JSON.stringify(job.pages)+';try{localStorage.setItem("groovy-theme","'+job.theme+'")}catch(e){}'
    +'</script><script>('+CLOCK+')();('+STUB+')();'
    // Master Accounts re-locks after idle; the owner was "here a moment ago"
    // so its pages are measured, not the lock screen (js/master-accounts.js).
    +'try{var __a={};__a[window.__UID]=Date.now();localStorage.setItem("groovy-ma-active",JSON.stringify(__a))}catch(e){}'
    // js/store.js is the one REST module: answer it with an empty collection.
    +'window.fetch=function(u){var s=String(u),b=s.indexOf("firestore.googleapis")>-1?(s.indexOf(":runQuery")>-1?[]:{documents:[]}):{};'
    +'return Promise.resolve({ok:true,status:200,headers:{get:function(){return null}},json:function(){return Promise.resolve(b)},text:function(){return Promise.resolve(JSON.stringify(b))}});};'
    +'</script>';
  return idx.replace('<head>','<head>'+pre).replace('</body>','<script>('+DRIVE+')();</script></body>');
}
function framePage(job){
  return '<!doctype html><html><body style="margin:0"><iframe src="/__app/'+job.id+'" style="width:390px;height:844px;border:0"></iframe>'
    +'<pre id="__out">running</pre></body></html>';
}

const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml','.jpg':'image/jpeg','.woff2':'font/woff2'};
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'groovy-appphone-'));
const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split('?')[0]);
  let m=/^\/__(frame|app)\/([\w-]+)$/.exec(url);
  if(m){const job=JOBS.find(j=>j.id===m[2]);if(!job){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':'text/html'});return res.end(m[1]==='frame'?framePage(job):appPage(job));}
  const file=path.join(ROOT,url.replace(/^\/+/,''));
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});

let failed=0,done=0,checks=0;
const results={};
server.listen(0,'127.0.0.1',()=>{
  const port=server.address().port;
  console.log('smoke-app-phone: '+path.basename(browser)+'\n');
  JOBS.forEach(job=>{
    // Async on purpose: this process is also the web server.
    execFile(browser,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
      '--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync',
      '--disable-extensions','--mute-audio','--no-proxy-server','--window-size=500,1000',
      '--user-data-dir='+profile+'-'+job.id,'--virtual-time-budget=120000','--dump-dom',
      'http://127.0.0.1:'+port+'/__frame/'+job.id],
      {encoding:'utf8',maxBuffer:64*1024*1024,timeout:240000},
      (err,dom)=>{results[job.id]={err,dom:dom||''};if(++done===JOBS.length)finish();});
  });
});

function finish(){
  JOBS.forEach(job=>{
    const {err,dom}=results[job.id];
    const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(dom);
    const raw=m?m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&'):'';
    console.log('  '+job.user+' ('+job.id+', '+job.theme+')');
    let rows=null;try{rows=JSON.parse(raw);}catch(e){}
    if(!rows){console.log('    FAIL the phone frame never reported'+(err?' ('+(err.killed?'timed out':err.message)+')':''));failed++;console.log('');return;}
    let bad=0;
    rows.forEach(r=>{checks++;if(r.issues.length){bad++;failed++;console.log('    FAIL '+r.page);r.issues.forEach(i=>console.log('         '+i));}});
    console.log('    '+(rows.length-bad)+' of '+rows.length+' screens clean\n');
  });
  server.close();
  JOBS.forEach(j=>{try{fs.rmSync(profile+'-'+j.id,{recursive:true,force:true});}catch(e){}});
  try{fs.rmSync(profile,{recursive:true,force:true});}catch(e){}
  if(failed){console.error('\x1b[31m'+failed+' of '+checks+' screens failed\x1b[0m\n');process.exit(1);}
  console.log('\x1b[32mevery page is clean on a 390px phone, for every role, in both themes\x1b[0m\n');
}

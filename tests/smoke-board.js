#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   The Board smoke test.  `node tests/smoke-board.js`

   WHY THIS EXISTS. The calendar shipped FROZEN: clicking it locked the tab
   for ~17 seconds until the stack overflowed. js/theboard.js declared the
   pure filter `function tbCalFilter(items,o)` and later assigned the
   dropdown handler to `window.tbCalFilter` — and in a browser a classic
   script's top-level function IS that window property, so the handler
   replaced the filter and the calendar recursed into its own repaint.
   5,466 logic assertions stayed green, because the node harness gives each
   script its own `window`, and the layout probe renders the calendar in
   node before serving it.

   So this serves the REAL index.html shell and the real scripts in real
   Chromium, swaps only the Firebase module for an in-memory Firestore
   (seeded with the Winter Drop 2027 milestones and all five Board users),
   signs in, and then DRIVES the Board: every page, and every control on
   the calendar's toolbar — each button clicked, each dropdown walked
   through every option, each checkbox toggled — timing each one. An action
   that takes longer than a second and a half, throws, or leaves the page
   without a Board on it is a failure.

   It also opens the calendar with the freeze's leftover — a 1.36 MB junk
   filter in localStorage — and requires it to be thrown away.

   The stub and the driver are real functions serialised with toString(),
   never template literals: a backtick in a comment inside a template
   closes it (the trap CLAUDE.md records for smoke-layout's probe).

   Skips cleanly (exit 0) when no browser is available — but it must pass
   locally before any Board change is pushed.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const http=require('http');
const os=require('os');
const {execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');
const seed=require(path.join(ROOT,'scripts','seed-board.js'));

function findBrowser(){
  if(process.env.CHROME_BIN&&fs.existsSync(process.env.CHROME_BIN))return process.env.CHROME_BIN;
  const c=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
  for(const p of c)if(fs.existsSync(p))return p;
  try{
    for(const d of fs.readdirSync('/opt/pw-browsers')){
      const p=path.join('/opt/pw-browsers',d,'chrome-linux','chrome');
      if(fs.existsSync(p))return p;
    }
  }catch(e){}
  return null;
}

// ── The data: what the seed writes, for five real-shaped users ──────────
const uidOf=h=>'u-'+h;
function seedCols(){
  const now=Date.now();
  const cols={user_profiles:{},board_items:{},board_lists:{},board_config:{},hrm_notifications:{}};
  seed.MEMBERS.forEach(h=>{cols.user_profiles[uidOf(h)]={uid:uidOf(h),username:h,updatedAt:now};});
  cols.board_config.markers={markers:seed.MARKERS};
  cols.board_lists[seed.LIST_ID]={title:'Winter Drop 2027',kind:'shared',adminUid:uidOf('ammar'),
    memberUids:seed.MEMBERS.map(uidOf),color:'moss',archived:false,sort:0,createdAt:now,updatedAt:now};
  seed.ITEMS.forEach(r=>{
    const [date,lane,title,who,kind,locked]=r;
    cols.board_items[seed.seedId(lane,title)]={title,notes:'',listId:seed.LIST_ID,ownerUid:uidOf(who[0]),
      assigneeUids:who.map(uidOf),visibility:'shared',kind,date,datePlanned:date,dateHistory:[],
      lane,priority:0,locked:!!locked,lockedBy:locked?uidOf('ammar'):null,status:'open',steps:[],
      attachments:[],myDay:{},commentCount:0,createdAt:now,updatedAt:now};
  });
  return cols;
}

// ── In-page: an in-memory Firestore with LIVE listeners ─────────────────
// Runs in the browser. Mirrors exactly the surface index.html bridges onto
// window. A write re-runs every listener on that collection, so a live
// board can be proven here without a network.
// THE PAGE'S CLOCK IS PINNED to Saturday 26 Sep 2026, 09:00 PKT — the day
// the seed was written for. Every date in the seed is fixed (Sep 25 to
// Nov 20 2026), so a test that read the real clock would stop finding them:
// the adversarial review of c06ad14 proved that from 1 Dec 2026 the month
// grid holds no seeded item and every push goes red with no code change.
// Only `new Date()` / `Date.now()` move; timers run in real time.
function CLOCK(){
  var Real=Date,off=Date.UTC(2026,8,26,4,0,0)-Real.now();
  function D(){
    if(!(this instanceof D))return new Real(Real.now()+off).toString();
    var a=[].slice.call(arguments);
    return a.length?new(Function.prototype.bind.apply(Real,[null].concat(a)))():new Real(Real.now()+off);
  }
  D.prototype=Real.prototype;
  D.now=function(){return Real.now()+off;};
  D.UTC=Real.UTC;D.parse=Real.parse;
  window.Date=D;
}
function STUB(){
  var S=window.__FS={cols:window.__SEED||{},writes:0,reads:0,listeners:[]};
  var n=0;
  function col(p){return(S.cols[p]=S.cols[p]||{});}
  function get(o,f){return String(f).split('.').reduce(function(a,k){return a==null?a:a[k];},o);}
  function clone(x){return x==null?x:JSON.parse(JSON.stringify(x));}
  function snapDoc(p,id,d){return{id:id,ref:{type:'doc',path:p+'/'+id,id:id,col:p},
    exists:function(){return d!=null;},data:function(){return clone(d);}};}
  function run(q){
    var m=col(q.path);
    var rows=Object.keys(m).map(function(id){return{id:id,d:m[id]};});
    (q.cons||[]).forEach(function(c){
      if(c.k!=='where')return;
      rows=rows.filter(function(r){var v=get(r.d,c.f);
        if(c.op==='==')return v===c.v;
        if(c.op==='array-contains')return Array.isArray(v)&&v.indexOf(c.v)>-1;
        if(c.op==='in')return(c.v||[]).indexOf(v)>-1;
        if(c.op==='>=')return v>=c.v;if(c.op==='<=')return v<=c.v;
        if(c.op==='>')return v>c.v;if(c.op==='<')return v<c.v;return true;});
    });
    var docs=rows.map(function(r){return snapDoc(q.path,r.id,r.d);});
    return{docs:docs,size:docs.length,empty:!docs.length,forEach:function(f){docs.forEach(f);},
      docChanges:function(){return docs.map(function(d){return{type:'added',doc:d};});}};
  }
  function notify(p){
    S.listeners.forEach(function(l){
      if(l.dead||l.q.path!==p)return;
      setTimeout(function(){ if(!l.dead)try{l.next(l.q.type==='doc'?snapDoc(l.q.col,l.q.id,col(l.q.col)[l.q.id]):run(l.q));}catch(e){console.error(e);} },5);
    });
  }
  function write(ref,fn){S.writes++;fn(col(ref.col));notify(ref.col);}
  var api={
    db:{},rtdb:{},
    auth:{currentUser:{uid:window.__UID,email:window.__EMAIL,getIdToken:function(){return Promise.resolve('t');}}},
    collection:function(db){var segs=[].slice.call(arguments,1);
      if(db&&db.type==='doc')segs.unshift(db.path);
      return{type:'col',path:segs.join('/')};},
    doc:function(a){var segs=[].slice.call(arguments,1);
      if(a&&a.type==='col'){var id=segs[0]||('auto'+(++n));return{type:'doc',path:a.path+'/'+id,id:id,col:a.path};}
      var parts=segs.join('/').split('/');var id2=parts.pop();
      return{type:'doc',path:segs.join('/'),id:id2,col:parts.join('/')};},
    where:function(f,op,v){return{k:'where',f:f,op:op,v:v};},
    orderBy:function(f,d){return{k:'orderBy',f:f,d:d};},limit:function(x){return{k:'limit',x:x};},
    query:function(c){return{type:'query',path:c.path,cons:[].slice.call(arguments,1)};},
    getDoc:function(ref){S.reads++;return Promise.resolve(snapDoc(ref.col,ref.id,col(ref.col)[ref.id]));},
    getDocs:function(q){S.reads++;return Promise.resolve(run(q));},
    setDoc:function(ref,d,o){write(ref,function(m){m[ref.id]=(o&&o.merge)?Object.assign({},m[ref.id]||{},clone(d)):clone(d);});return Promise.resolve();},
    updateDoc:function(ref,d){write(ref,function(m){m[ref.id]=Object.assign({},m[ref.id]||{},clone(d));});return Promise.resolve();},
    addDoc:function(c,d){var r=api.doc(c);return api.setDoc(r,d).then(function(){return r;});},
    deleteDoc:function(ref){write(ref,function(m){delete m[ref.id];});return Promise.resolve();},
    writeBatch:function(){var ops=[];return{
      set:function(r,d,o){ops.push(function(){return api.setDoc(r,d,o);});},
      update:function(r,d){ops.push(function(){return api.updateDoc(r,d);});},
      delete:function(r){ops.push(function(){return api.deleteDoc(r);});},
      commit:function(){return ops.reduce(function(p,f){return p.then(f);},Promise.resolve());}};},
    runTransaction:function(db,fn){return fn({get:api.getDoc,set:api.setDoc,update:api.updateDoc,delete:api.deleteDoc});},
    onSnapshot:function(q,next,err){
      var l={q:q,next:next,err:err,dead:false};S.listeners.push(l);
      setTimeout(function(){ if(!l.dead)try{next(q.type==='doc'?snapDoc(q.col,q.id,col(q.col)[q.id]):run(q));}catch(e){console.error(e);} },5);
      return function(){l.dead=true;};},
    signInWithEmailAndPassword:function(){return Promise.resolve({user:{uid:window.__UID}});},
    signOut:function(){return Promise.resolve();},
    onAuthStateChanged:function(){return function(){};},
    updatePassword:function(){return Promise.resolve();},
    reauthenticateWithCredential:function(){return Promise.resolve();},
    EmailAuthProvider:{credential:function(){return{};}},
    rtdbRef:function(){return{};},
    rtdbGet:function(){return Promise.resolve({val:function(){return null;},exists:function(){return false;}});},
    rtdbChild:function(){return{};},rtdbOnValue:function(){},rtdbOff:function(){}
  };
  Object.assign(window,api);
  // No service worker in a test: a registered one would serve its own
  // precache over the files under test.
  try{Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{
    controller:null,register:function(){return new Promise(function(){});},
    getRegistrations:function(){return Promise.resolve([]);},addEventListener:function(){}}});}catch(e){}
  window.prompt=function(){return window.__PROMPT||'';};
  window.confirm=function(){return true;};
  window.__errs=[];
  window.addEventListener('error',function(e){window.__errs.push(String(e.message||e));});
  window.addEventListener('unhandledrejection',function(e){window.__errs.push('unhandled: '+String(e.reason&&e.reason.message||e.reason));});
}

// ── In-page: sign in and DRIVE the Board ────────────────────────────────
function DRIVE(){
  var out=[];
  function L(ok,m){out.push((ok?'OK   ':'FAIL ')+m);}
  function show(){var el=document.getElementById('__out');if(el)el.textContent=out.join('\n');}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  var MAX_MS=1500;
  function onBoard(){return!!document.querySelector('#main-content .tb-wrap');}
  // THE FREEZE IS MEASURED STRUCTURALLY, NOT BY THE CLOCK. Under
  // --virtual-time-budget performance.now() does not advance while script
  // runs, so a timer here reads 0ms even for a 17-second lock. What the
  // freeze really was is a repaint nested inside a repaint, thousands deep
  // — so every _tbRepaint is counted and its nesting depth tracked. One
  // action may repaint a few times; it may never repaint INSIDE a repaint.
  var R={calls:0,depth:0,max:0};
  function instrument(){
    if(typeof _tbRepaint!=='function'||_tbRepaint.__smoke)return;
    var orig=_tbRepaint;
    _tbRepaint=function(){
      R.calls++;R.depth++;if(R.depth>R.max)R.max=R.depth;
      try{return orig.apply(this,arguments);}finally{R.depth--;}
    };
    _tbRepaint.__smoke=true;
  }
  var MAX_REPAINTS=4;
  function act(name,fn){
    instrument();
    R.calls=0;R.max=0;R.depth=0;
    var errs0=(window.__errs||[]).length;
    var t=performance.now(),err=null;
    try{fn();}catch(e){err=e;}
    var d=Math.round(performance.now()-t);
    var newErr=(window.__errs||[]).slice(errs0).filter(function(e){return!/ERR_|Failed to load resource/.test(e);})[0];
    var nested=R.max>1,many=R.calls>MAX_REPAINTS;
    var bad=err||newErr||d>MAX_MS||nested||many;
    L(!bad,name+' ('+R.calls+' repaint'+(R.calls===1?'':'s')+')'
      +(err?' threw: '+err.message:'')+(newErr?' raised: '+newErr:'')
      +(nested?' — a repaint NESTED '+R.max+' deep: the freeze':'')
      +(many?' — '+R.calls+' repaints for one action':'')
      +(d>MAX_MS?' — '+d+'ms, the tab would feel frozen':''));
    return!bad;
  }
  // Re-query each time: every action repaints #main-content wholesale.
  function nth(sel,i){return document.querySelectorAll(sel)[i];}
  function label(el){return(el.tagName+' '+(el.textContent||el.getAttribute('onchange')||'').replace(/\s+/g,' ').trim()).slice(0,48);}

  async function go(){
    try{
      if(typeof window.__bootApp==='function')window.__bootApp();
      session=window.__SESSION;
      window.startApp();
      await wait(400);
      L(currentPage==='tb-dash','a Board user lands on The Board ('+currentPage+')');

      // ── every page ──
      var pages=['tb-dash','tb-calendar','tb-lists','tb-inbox'];
      for(var p=0;p<pages.length;p++){
        act('open '+pages[p],function(){window.showPage(pages[p]);});
        await wait(300);
        L(onBoard(),pages[p]+' renders a Board screen');
      }

      L(_tbToday()==='2026-09-26','the page clock is pinned to 26 Sep 2026 ('+_tbToday()+')');
      L(/The Board/.test((document.getElementById('sidebar')||{}).textContent||''),'the sidebar says The Board');
      L(((document.querySelector('.tb-rail')||{}).textContent||'').indexOf('Dashboard')>-1,'the rail says Dashboard');

      // ── the rail (session 2, P1.2): icons draw, lists open, the header ──
      window.showPage('tb-dash');
      await wait(300);
      var ic=document.querySelector('.tb-rail svg.tb-ic use');
      var icb=ic&&ic.getBBox?ic.getBBox():{width:0};
      L(!!ic&&icb.width>0,'a rail icon draws from the vendored sprite ('+(icb.width||0)+'px)');
      L(!!document.querySelector('.tb-head .tb-h1'),'the screen opens with its header row');
      // innerText, not textContent: it is what is ON SCREEN, after CSS. A
      // text-transform once undid P0.6's Title Case and textContent never saw it.
      var hs=[].slice.call(document.querySelectorAll('.tb-cardh')).map(function(h){return(h.innerText||'').trim();});
      var lower=hs.filter(function(t){return /^[a-z]/.test(t);});
      L(hs.length>0&&!lower.length,'every card title is on screen in Title Case ('+(lower[0]||hs.slice(0,3).join(', '))+')');
      L(/^[A-Z]/.test(((document.querySelector('.tb-stripday')||{}).innerText||'').trim()),'the day heading is Title Case');
      L(!document.querySelector('.tb-rail #tb-search')&&!!document.querySelector('.tb-head #tb-search'),'the search box lives in the header, not the rail');
      var rl=document.querySelector('.tb-rail .tb-raillist');
      L(!!rl,'the rail lists the lists');
      if(rl){
        act('open a list from the rail',function(){document.querySelector('.tb-rail .tb-raillist').click();});
        await wait(300);
        L(currentPage==='tb-lists'&&!!_tbListId,'a rail list opens that list ('+currentPage+', '+_tbListId+')');
        L(!!document.querySelector('.tb-rail .tb-raillist.on'),'and is the current rail entry');
        act('the Lists header',function(){document.getElementById('tb-rail-tb-lists').click();});
        await wait(300);
        L(!_tbListId&&!!document.querySelector('.tb-listcard'),'the Lists header opens the overview');
      }

      // ── people: the whole team resolves (session 2, P0.2) ──
      window.showPage('tb-dash');
      await wait(300);
      var main=document.getElementById('main-content');
      L(document.querySelectorAll('.tb-teamrow').length===5,'Team today lists all five ('+document.querySelectorAll('.tb-teamrow').length+')');
      L(!/\bsomeone\b/.test(main.innerText||''),'nobody on the Dashboard renders as "someone"');
      var before=(typeof tbItems!=='undefined'?tbItems.length:0);
      await window.tbCreateFromQuick('smoke follow up @afnan',false);
      await wait(100);
      var made=tbItems[tbItems.length-1]||{};
      L(tbItems.length===before+1,'quick add created an item');
      L((made.assigneeUids||[]).indexOf('u-afnan')>-1,'@afnan became an assignee');
      L(String(made.title||'').indexOf('@afnan')<0,'and is not title text ('+made.title+')');

      // ── live: another person's write lands without a reload (P0.3) ──
      window.showPage('tb-dash');
      await wait(300);
      var remoteRef=doc(db,'board_items','smoke_remote');
      await setDoc(remoteRef,{title:'SMOKE REMOTE ITEM',visibility:'shared',ownerUid:'u-afnan',
        assigneeUids:[window.__UID,'u-afnan'],date:null,status:'open',kind:'task',steps:[],myDay:{},createdAt:Date.now()});
      await wait(200);
      L(tbItems.some(function(i){return i.id==='smoke_remote';}),'a colleague\u2019s new item is in memory without a reload');
      L(/SMOKE REMOTE ITEM/.test(document.getElementById('main-content').innerText||''),'and on screen');
      // While typing, it waits.
      var qa=document.getElementById('tb-qa');
      if(qa){
        qa.focus();qa.value='half typed';
        await updateDoc(remoteRef,{title:'SMOKE RENAMED'});
        await wait(200);
        var qa2=document.getElementById('tb-qa');
        L(qa2===qa&&qa2.value==='half typed'&&document.activeElement===qa2,'a remote change does not repaint under the caret');
        L(tbItems.some(function(i){return i.title==='SMOKE RENAMED';}),'but the data is already current');
        qa.value='';qa.blur();
        await wait(900);
        L(/SMOKE RENAMED/.test(document.getElementById('main-content').innerText||''),'and it lands once typing stops');
      }
      await deleteDoc(remoteRef);
      await wait(200);
      L(!tbItems.some(function(i){return i.id==='smoke_remote';}),'a remote delete takes it off');

      // ── the composer (P0.5) ──
      window.showPage('tb-dash');
      await wait(300);
      var qin=document.getElementById('tb-qa');
      qin.focus();
      await wait(50);
      L(!!document.querySelector('#tb-quick.open .tb-qarow'),'focusing quick add opens the composer');
      var btns=[].slice.call(document.querySelectorAll('#tb-qa-chips .tb-qachip'));
      var tomorrow=btns.filter(function(b){return(b.textContent||'').trim()==='tomorrow';})[0];
      var dani=btns.filter(function(b){return/Daniyal/.test(b.textContent||'');})[0];
      act('pick tomorrow',function(){tomorrow.click();});
      act('pick Daniyal',function(){[].slice.call(document.querySelectorAll('#tb-qa-chips .tb-qachip')).filter(function(b){return/Daniyal/.test(b.textContent||'');})[0].click();});
      qin=document.getElementById('tb-qa');
      qin.value='smoke composer item';qin.dispatchEvent(new Event('input',{bubbles:true}));
      var n0=tbItems.length;
      qin.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      await wait(300);
      var c=tbItems[tbItems.length-1]||{};
      L(tbItems.length===n0+1&&c.title==='smoke composer item','Enter created it');
      L(c.date===_tbDayAdd(_tbToday(),1),'with the picked date (tomorrow)');
      L((c.assigneeUids||[]).indexOf('u-daniyal')>-1,'and the picked person');
      var q2=document.getElementById('tb-qa');
      L(!!q2&&q2.value===''&&document.activeElement===q2,'the composer is cleared, caret back in it');
      q2.value='smoke undated item';q2.dispatchEvent(new Event('input',{bubbles:true}));
      q2.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      await wait(300);
      var u=tbItems[tbItems.length-1]||{};
      L(u.title==='smoke undated item'&&u.date===null,'a bare title is created with NO date');

      // ── the calendar, every control ──
      window.showPage('tb-calendar');
      await wait(300);
      var CTRL='.tb-calbar button, .tb-calbar select, .tb-calbar input[type=checkbox], .tb-trayhead';
      var n=document.querySelectorAll(CTRL).length;
      L(n>=8,'the calendar toolbar has its controls ('+n+')');
      for(var i=0;i<n;i++){
        var el=nth(CTRL,i);
        if(!el)continue;
        var name='calendar control '+label(el);
        if(el.tagName==='SELECT'){
          var opts=el.options.length;
          for(var j=0;j<opts;j++){
            (function(ii,jj){
              act(name+' → option '+jj,function(){
                var s=nth(CTRL,ii);s.selectedIndex=jj;s.dispatchEvent(new Event('change',{bubbles:true}));
              });
            })(i,j);
            await wait(20);
          }
          // put it back to "any", so the rest of the run sees items
          (function(ii){act(name+' → reset',function(){var s=nth(CTRL,ii);s.selectedIndex=0;s.dispatchEvent(new Event('change',{bubbles:true}));});})(i);
        }else{
          (function(ii){act(name,function(){nth(CTRL,ii).click();});})(i);
          await wait(20);
          if(el.type==='checkbox')(function(ii){act(name+' (again)',function(){nth(CTRL,ii).click();});})(i);
        }
        await wait(20);
        L(onBoard()&&!!document.querySelector('.tb-calbar'),'still on the calendar after '+name);
      }
      // both views, both scopes, stepping, by-person
      ['month','week'].forEach(function(v){act('view '+v,function(){window.tbCalView(v);});});
      ['all','me'].forEach(function(v){act('scope '+v,function(){window.tbCalScope(v);});});
      act('step back',function(){window.tbCalStep(-1);});
      act('step forward',function(){window.tbCalStep(1);});
      act('today',function(){window.tbCalToday();});
      act('week',function(){window.tbCalView('week');});
      act('by person on',function(){window.tbCalRows(true);});
      act('by person off',function(){window.tbCalRows(false);});
      act('month',function(){window.tbCalView('month');});
      var grid=document.querySelector('.tb-monthgrid,.tb-weekgrid');
      L(!!grid,'the month grid is drawn');
      L(document.querySelectorAll('.tb-day').length>=28,'with its days ('+document.querySelectorAll('.tb-day').length+')');
      L(document.querySelectorAll('.tb-pill').length>0,'and pills on them ('+document.querySelectorAll('.tb-pill').length+')');
      // a pill opens the drawer and it closes again
      var pill=document.querySelector('.tb-pill');
      L(!!pill,'there is a pill to click (none means the checks below would not run)');
      if(pill){
        act('click a pill',function(){document.querySelector('.tb-pill').click();});
        await wait(200);
        L(!!document.querySelector('.tb-drawer'),'the pill opened its drawer');
        act('close the drawer',function(){window.tbCloseItem();});
      }
      // the stored prefs are small and carry only known keys
      var raw='';try{raw=localStorage.getItem('groovy-tb-cal')||'';}catch(e){}
      L(raw.length<4096,'the saved calendar prefs stay small ('+raw.length+' bytes)');
      var keys=[];try{keys=Object.keys((JSON.parse(raw)||{}).filters||{});}catch(e){}
      var known=['scope','person','list','lane','color','hideDone'];
      L(keys.every(function(k){return known.indexOf(k)>-1;}),'and only known filter keys ('+keys.join(',')+')');

      // ── Board settings (P0.4): owners only; a function that is not
      // there says so rather than failing silently ──
      window.showPage('tb-dash');await wait(200);
      var sb=document.getElementById('tb-settings-btn');
      if(window.__SESSION.u==='ammar'){
        L(!!sb,'a Board owner has Board settings');
        act('open Board settings',function(){document.getElementById('tb-settings-btn').click();});
        L(!!document.querySelector('.tb-setcard #tb-seed-run'),'with Run seed in it');
        await window.tbRunSeed(true);
        await wait(100);
        L(/not on this site yet/.test(_tbSeedState.error||''),'a preview with no function deployed says so ('+(_tbSeedState.error||'nothing')+')');
        L(/not on this site yet/.test((document.querySelector('.tb-setresult')||{}).textContent||''),'on screen, as text');
        act('close Board settings',function(){window.tbToggleSettings();});
      }else{
        L(!sb,'a member has no Board settings');
      }

      // ── the rest of the Board ──
      window.showPage('tb-dash');await wait(200);
      var row=document.querySelector('.tb-rowmain');
      L(!!row,'there is a Dashboard row to open');
      if(row){act('open an item from the Dashboard',function(){document.querySelector('.tb-rowmain').click();});await wait(200);
        L(!!document.querySelector('.tb-drawer'),'the Dashboard row opened its drawer');
        act('close it',function(){window.tbCloseItem();});}
      // ── the row (P1.3): the star puts it in My Day, without opening it ──
      var star=document.querySelector('.tb-row .tb-star:not(.on)');
      L(!!star,'a Dashboard row carries a star');
      if(star){
        var sid=star.closest('.tb-row').getAttribute('data-id');
        star.click();
        await wait(300);
        var sit=tbItems.filter(function(i){return i.id===sid;})[0]||{};
        L(((sit.myDay||{})[_tbMe()])===_tbToday(),'the star put the item in My Day');
        L(!document.querySelector('.tb-drawer'),'and did not open it');
      }
      window.showPage('tb-lists');await wait(200);
      var list=document.querySelector('[onclick^="window.tbOpenList"]');
      L(!!list,'there is a list to open');
      if(list){act('open a list',function(){document.querySelector('[onclick^="window.tbOpenList"]').click();});
        act('close it',function(){window.tbCloseList();});}
      act('search',function(){window.tbSearchInput('shoot');});
      await wait(400);
      act('clear search',function(){window.tbSearchClear();});
      act('help on',function(){window.tbToggleHelp();});
      act('help off',function(){window.tbToggleHelp();});

      L(onBoard(),'the Board is still on screen at the end');
      var errs=(window.__errs||[]).filter(function(e){return!/ERR_|Failed to load resource/.test(e);});
      L(!errs.length,'no JavaScript errors'+(errs.length?': '+errs.slice(0,3).join(' | '):''));
    }catch(e){L(false,'the driver threw: '+e.message);}
    out.push('DONE');show();
  }
  go();
}

// ── Serving ─────────────────────────────────────────────────────────────
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml','.jpg':'image/jpeg','.woff2':'font/woff2'};

const USERS={
  ammar:{uid:uidOf('ammar'),u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op',canPO:true,canFabric:true},
  saim:{uid:uidOf('saim'),u:'saim',name:'Saim',role:'designer',email:'saim@groovy.op',canPO:false,canFabric:false,stages:[]}
};
// A freeze leaves a junk filter behind: this is its shape, at its size.
function poison(){
  let nest={uid:'u-ammar',scope:'me'};
  for(let i=0;i<400;i++)nest={uid:'u-ammar',scope:'me','[object Object],[object Object]':nest};
  const s=JSON.stringify({view:'month',filters:Object.assign({scope:'me',person:'',list:'',lane:'',color:'',hideDone:false},
    {'[object Object],[object Object]':nest}),tray:true,rows:false});
  return s+' '.repeat(Math.max(0,1400000-s.length));
}
const MODES=[
  {id:'ammar',label:'Ammar (Board owner), desktop',user:'ammar'},
  {id:'saim',label:'Saim (designer), desktop',user:'saim'},
  {id:'poisoned',label:'Ammar, with the freeze’s 1.36 MB junk filter in localStorage',user:'ammar',poison:true}
];

function pageFor(mode){
  const idx=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  // The Firebase module cannot load here (gstatic is out of reach) and is
  // replaced by the stub; everything else is the real shell.
  const noModule=idx.replace(/<script type="module">[\s\S]*?<\/script>/,'');
  const u=USERS[mode.user];
  const pre='<script>window.__SEED='+JSON.stringify(seedCols())+';window.__UID='+JSON.stringify(u.uid)
    +';window.__EMAIL='+JSON.stringify(u.email)+';window.__SESSION='+JSON.stringify(u)
    +';window.__PROMPT="smoke test item";'
    +(mode.poison?'try{localStorage.setItem("groovy-tb-cal",'+JSON.stringify(poison())+');}catch(e){}':'try{localStorage.removeItem("groovy-tb-cal");}catch(e){}')
    +'</script><script>('+CLOCK.toString()+')();('+STUB.toString()+')();</script>';
  return noModule.replace('<head>','<head>'+pre)
    .replace('</body>','<pre id="__out">running</pre><script>('+DRIVE.toString()+')();</script></body>');
}

const browser=findBrowser();
if(!browser){
  console.log('smoke-board: no Chrome/Chromium found — SKIPPING. This test must pass locally before a Board change is pushed.');
  process.exit(0);
}
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'groovy-board-'));
const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split('?')[0]);
  const m=/^\/__board\/(\w+)$/.exec(url);
  if(m){const mode=MODES.find(x=>x.id===m[1]);if(!mode){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':'text/html'});return res.end(pageFor(mode));}
  const file=path.join(ROOT,url.replace(/^\/+/,''));
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});

let failed=0,done=0;
server.listen(0,'127.0.0.1',()=>{
  const port=server.address().port;
  console.log('smoke-board: '+path.basename(browser)+'\n');
  MODES.forEach(mode=>runMode(port,mode));
});

function runMode(port,mode){
  // Async on purpose: this process is also the web server (a synchronous
  // spawn deadlocks it — see tests/smoke-browser.js).
  execFile(browser,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-first-run','--no-default-browser-check','--disable-background-networking',
    '--disable-component-update','--disable-sync','--disable-default-apps','--disable-extensions',
    '--metrics-recording-only','--mute-audio','--no-proxy-server','--window-size=1440,900',
    '--user-data-dir='+profile+'-'+mode.id,'--virtual-time-budget=60000','--dump-dom',
    'http://127.0.0.1:'+port+'/__board/'+mode.id],
    {encoding:'utf8',maxBuffer:64*1024*1024,timeout:150000},
    (err,stdout)=>report(mode,err,stdout||''));
}

function report(mode,err,dom){
  const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(dom);
  const raw=m?m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'"):'';
  const lines=raw.split('\n').filter(l=>l.trim()&&l.trim()!=='running');
  console.log('  '+mode.label);
  if(err&&!dom){console.log('    FAIL the browser did not finish — a frozen tab looks exactly like this ('+(err.killed?'killed after timeout':(err.message||err))+')');failed++;}
  else if(!lines.length){console.log('    FAIL the driver never reported — the page is stuck');failed++;}
  else{
    if(lines[lines.length-1]!=='DONE'){console.log('    FAIL the driver did not finish');failed++;}
    const quiet=process.env.SMOKE_BOARD_VERBOSE?lines:lines.filter(l=>l.indexOf('OK')!==0);
    const oks=lines.filter(l=>l.indexOf('OK')===0).length;
    quiet.forEach(l=>{if(l==='DONE')return;console.log('    '+l);if(l.indexOf('FAIL')===0)failed++;});
    console.log('    '+oks+' checks ok');
  }
  console.log('');
  if(++done===MODES.length)finish();
}

function finish(){
  server.close();
  MODES.forEach(m=>{try{fs.rmSync(profile+'-'+m.id,{recursive:true,force:true});}catch(e){}});
  try{fs.rmSync(profile,{recursive:true,force:true});}catch(e){}
  if(failed){
    console.error('\x1b[31m'+failed+' failed\x1b[0m\n');
    process.exit(1);
  }
  console.log('\x1b[32mevery Board page and calendar control answers in real Chromium\x1b[0m\n');
}

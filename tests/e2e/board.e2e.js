#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   tests/e2e/board.e2e.js — The Board and Milanote, on the REAL platform,
   as the QA harness account.
     node tests/e2e/board.e2e.js            the site in GROOVY_QA_URL
     node tests/e2e/board.e2e.js --stub     the in-memory stub (below)

   Every other Board test runs against a stub: the node harness, or real
   Chromium with an in-memory Firestore (tests/smoke-board.js). This one
   signs in at GROOVY_QA_URL through the real login form, as
   claude@groovy.op, against the live groovy-gatepass project, and drives
   the Board a person would. It is how a subagent debugs the real thing.

   ENVIRONMENT (the operator's shell -- never the repo, a log or a commit):
     GROOVY_QA_URL        the site, e.g. production or a deploy preview
     GROOVY_QA_EMAIL      claude@groovy.op
     GROOVY_QA_PASSWORD   its Firebase Auth password
     CHROME_BIN           optional: the browser to drive
   Missing any of the first three, no browser, or a Node without a global
   WebSocket (Node 22+) -> it prints why and exits 0. It is not in
   tests/run.js and CI never runs it: CI has no credentials, and the
   sandbox cannot reach *.netlify.app.

   --stub serves the real shell locally with tests/e2e/stub-site.js (the
   in-memory Firestore, the Winter Drop seed, the QA rules imitated) and
   runs the same drive against it. It needs no credentials and proves the
   pages, the assertions and the harness; it proves nothing about the live
   data, rules or network. Its report says STUB at the top.

   THE SITE MUST CARRY THE QA ACCOUNT. The login form takes a USERNAME and
   the app maps it to an email through USER_DEFS (js/auth.js). A deploy
   without the `claude` entry answers "Username not found" -- point
   GROOVY_QA_URL at a deploy preview of the branch until it is on main.

   The password is handed to the page as a DevTools call ARGUMENT, never
   inside an evaluated expression, so no error or log line can carry it.

   SAFETY, IN ORDER:
     1. It checks it is signed in with the `qa` ROLE, or stops.
     2. THE CONTAINMENT GATE: before IT writes anything it asks for `pos`
        and `bug_reports`, which the QA rules refuse. If either read is
        ALLOWED, the rules carrying isQa() are not deployed -- the account
        is an ordinary signed-in user -- and it signs out and exits 2
        without writing or screenshotting anything else. (The APP's own
        sign-in has already run by then: doLogin logs a "Claude (QA) signed
        in" row to `activity`, and profileBootstrap seeds its own
        user_profiles row. The QA rules refuse the first and allow the
        second; old rules allow both.)
     3. Every Board write goes into its own "QA Sandbox" list, which it
        creates PRIVATE on first run: its items are then unreadable to
        anyone else BY THE RULES, not just hidden by the client.
     4. It NEVER TOUCHES WINTER DROP 2027. The refused-path probe runs only
        on a locked gate OUTSIDE that list (none exists today, so it is
        skipped and says so), and the run ends by comparing every Winter
        Drop item with a snapshot taken before the first write.
     5. On the live site Milanote is driven READ-ONLY: every rename is
        abandoned with Escape and every dialog answered Cancel. (Opening
        Milanote at all creates the QA account's own private Home board
        on first use -- the app does that, inside the QA fence.) The stub
        also commits the renames, which is where Enter is proved.
     6. The item it creates is deleted at the end.

   WHAT IT ASSERTS, on every screen, at 1440 and 390 wide, light and dark:
     no console error and no uncaught exception or rejection; the page
     painted within 500 ms of navigation (two frames after its content
     is in); no leaf text wider than its own box (scrollWidth > clientWidth
     -- an ellipsis counts, and is marked); every avatar shows a photo or
     initials; every calendar pill carries a lane colour. Screens: the
     Dashboard, the calendar (Month, Week; Day is not built yet), the
     QA Sandbox list (Tasks; a list's Calendar/Lanes/Members tabs are not
     built yet), the item pane, the Inbox, Settings (Board owners only --
     the QA account is not one, so it is named as not reachable), and
     Milanote (a board, the confirm dialog, the in-place renames).

   OUTPUT: docs/board-screens/<local short commit>/ -- PNG screenshots, a
   report.json and a report.md (what passed, what failed, console errors,
   and the CACHE_VERSION the SITE served, which is what was actually
   tested; the folder name is only the local checkout). That folder is
   .gitignored ON PURPOSE: this repo is public and the screenshots show
   the live drop plan.

   Exit: 0 passed or skipped · 1 an assertion failed · 2 the gate refused.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawn,execFileSync}=require('child_process');
const ROOT=path.join(__dirname,'..','..');

const STUB=process.argv.includes('--stub');
let URL_=process.env.GROOVY_QA_URL||'';
let EMAIL=process.env.GROOVY_QA_EMAIL||'';
let PASS=process.env.GROOVY_QA_PASSWORD||'';
const skip=why=>{ console.log('board.e2e: SKIPPED — '+why); process.exit(0); };

const PAINT_MS=500;
const VIEWPORTS=[{id:'1440',width:1440,height:900,scale:1,mobile:false},
                 {id:'390',width:390,height:844,scale:2,mobile:true}];
const THEMES=['light','dark'];

function findBrowser(){
  const c=[process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
  for(const p of c)if(fs.existsSync(p))return p;
  try{
    for(const d of fs.readdirSync('/opt/pw-browsers')){
      const p=path.join('/opt/pw-browsers',d,'chrome-linux','chrome');
      if(fs.existsSync(p))return p;
    }
  }catch(e){}
  return null;
}

// ── A minimal DevTools-protocol client (no dependencies) ────────────────
function cdp(wsUrl){
  const ws=new WebSocket(wsUrl);
  let id=0;const wait=new Map();const subs=[];
  ws.onmessage=ev=>{
    const m=JSON.parse(typeof ev.data==='string'?ev.data:ev.data.toString());
    if(m.id&&wait.has(m.id)){const w=wait.get(m.id);wait.delete(m.id);m.error?w.rej(new Error(m.error.message)):w.res(m.result);}
    else if(m.method)subs.forEach(s=>{ if(s.m===m.method&&(!s.sid||s.sid===m.sessionId))s.cb(m.params); });
  };
  const open=new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('DevTools socket failed'));});
  return{
    open,
    send(method,params,sessionId){
      const m={id:++id,method,params:params||{}};if(sessionId)m.sessionId=sessionId;
      return new Promise((res,rej)=>{wait.set(m.id,{res,rej});ws.send(JSON.stringify(m));});
    },
    on(m,cb,sid){subs.push({m,cb,sid});},
    close(){try{ws.close();}catch(e){}}
  };
}

// ── In-page probes. Real functions, serialised with toString() (never a
// template: a backtick in a comment would close it -- CLAUDE.md's trap).
function PROBE_CLIPPED(){
  function desc(el){var s=el.tagName.toLowerCase();if(el.id)s+='#'+el.id;
    if(el.className&&typeof el.className==='string')s+='.'+el.className.trim().split(/\s+/).slice(0,2).join('.');return s;}
  var out=[],seen=0,done=new Set();
  var roots=document.querySelectorAll('#main-content, .tb-drawer, .board-confirm, .board-topbar');
  for(var r=0;r<roots.length;r++){
    var all=roots[r].querySelectorAll('*');
    for(var i=0;i<all.length;i++){
      var el=all[i];
      if(done.has(el))continue;done.add(el);   // the roots can nest
      if(el.children.length)continue;
      var tx=(el.textContent||'').replace(/\s+/g,' ').trim();
      if(!tx)continue;
      if(!el.getClientRects().length)continue;
      var cs=getComputedStyle(el);
      if(cs.visibility==='hidden'||cs.display==='none')continue;
      seen++;
      if(el.clientWidth>0&&el.scrollWidth>el.clientWidth+1)
        out.push(desc(el)+' "'+tx.slice(0,48)+'" '+el.scrollWidth+'>'+el.clientWidth+(cs.textOverflow==='ellipsis'?' (ellipsis)':''));
    }
  }
  return{seen:seen,bad:out.slice(0,25),total:out.length};
}
function PROBE_FACES_AND_PILLS(){
  var faces=[],pills=[],nFaces=0,nPills=0;
  document.querySelectorAll('.tb-av').forEach(function(a){
    if(!a.getClientRects().length)return;nFaces++;
    var img=a.querySelector('img');
    var photo=!!(img&&img.complete&&img.naturalWidth>0);
    if(!photo&&!(a.textContent||'').trim())faces.push((a.getAttribute('title')||'?'));
  });
  document.querySelectorAll('.tb-pill').forEach(function(p){
    if(!p.getClientRects().length)return;nPills++;
    var ck=[].slice.call(p.classList).filter(function(c){return /^tb-c-[a-z0-9]+$/.test(c);})[0];
    var bar=p.querySelector('.tb-pillbar');
    var bg=bar?getComputedStyle(bar).backgroundColor:'';
    if(!ck||!bar||/rgba\(0, 0, 0, 0\)|transparent/.test(bg))
      pills.push(((p.textContent||'').trim().slice(0,40))+' ['+(ck||'no tb-c-*')+', bar '+(bg||'missing')+']');
  });
  return{nFaces:nFaces,faces:faces,nPills:nPills,pills:pills};
}
// Navigate and time it: from showPage to two frames after the page's own
// content is in. Resolves -1 when it never is.
function NAV_TIMED(id,boardPage){
  var t0=performance.now();
  window.showPage(id);
  return new Promise(function(res){
    var end=t0+8000;
    (function poll(){
      var m=document.getElementById('main-content');
      var ready=typeof currentPage!=='undefined'&&currentPage===id&&m&&m.children.length>0
        &&(!boardPage||!!document.querySelector('#main-content .tb-wrap'));
      if(ready)return requestAnimationFrame(function(){requestAnimationFrame(function(){res(Math.round(performance.now()-t0));});});
      if(performance.now()>end)return res(-1);
      setTimeout(poll,4);
    })();
  });
}

(async()=>{
  let stubSite=null;
  if(STUB){
    stubSite=await require('./stub-site').start();
    URL_=stubSite.url;EMAIL=stubSite.email;PASS=stubSite.password;
  }else{
    const missing=['GROOVY_QA_URL','GROOVY_QA_EMAIL','GROOVY_QA_PASSWORD'].filter(k=>!process.env[k]);
    if(missing.length)skip('set '+missing.join(', ')+' in your shell (see BOARD.md, "Testing"), or run with --stub.');
  }
  if(typeof WebSocket!=='function')skip('needs Node 22+ (a global WebSocket); this is '+process.version+'.');
  const browser=findBrowser();
  if(!browser)skip('no Chrome/Chromium found; set CHROME_BIN.');
  const handle=EMAIL.split('@')[0].toLowerCase();

  let commit='nogit';
  try{ commit=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:ROOT}).toString().trim(); }catch(e){}
  let dirty=false;
  try{ dirty=!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:ROOT}).toString().trim(); }catch(e){}
  const folder=commit+(dirty?'-dirty':'')+(STUB?'-stub':'');
  const outDir=path.join(ROOT,'docs','board-screens',folder);
  fs.mkdirSync(outDir,{recursive:true});
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'board-e2e-'));

  const report={commit,dirty,stub:STUB,site:STUB?'in-memory stub (tests/e2e/stub-site.js)':URL_,
    startedAt:new Date().toISOString(),siteCacheVersion:null,
    checks:[],screens:[],consoleErrors:[],pageErrors:[],notes:[],notBuilt:[]};
  let failed=0;
  const check=(name,ok,detail)=>{ report.checks.push({name,ok:!!ok,detail:detail==null?null:String(detail)});
    if(!ok)failed++; console.log((ok?'  ok   ':'  FAIL ')+name+(detail!=null&&!ok?'   → '+detail:'')); };

  const proc=spawn(browser,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
    '--no-default-browser-check','--user-data-dir='+profile,'--remote-debugging-port=0','--window-size=1440,900','about:blank'],
    {stdio:['ignore','ignore','pipe']});
  const wsUrl=await new Promise((res,rej)=>{
    let buf='';const t=setTimeout(()=>rej(new Error('the browser did not start')),20000);
    proc.stderr.on('data',d=>{ buf+=d; const m=/DevTools listening on (ws:\/\/\S+)/.exec(buf); if(m){clearTimeout(t);res(m[1]);} });
    proc.on('exit',c=>{clearTimeout(t);rej(new Error('the browser exited ('+c+')'));});
  });
  const c=cdp(wsUrl); await c.open;
  const {targetId}=await c.send('Target.createTarget',{url:'about:blank'});
  const {sessionId:S}=await c.send('Target.attachToTarget',{targetId,flatten:true});
  const send=(m,p)=>c.send(m,p,S);
  await send('Page.enable');await send('Runtime.enable');
  // Headless gives the page no focus; typing needs a focused field.
  await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Page.bringToFront');
  // A prompt() is answered with whatever the next step queued -- the list
  // name when The Board asks "Name the list". A confirm() is accepted.
  // Milanote raises neither any more (its own dialog); one that did would
  // be counted as a failure below.
  let promptText=null,nativeDialogs=[];
  c.on('Page.javascriptDialogOpening',p=>{
    nativeDialogs.push(p.type+': '+String(p.message||'').slice(0,80));
    send('Page.handleJavaScriptDialog',{accept:true,promptText:p.type==='prompt'?(promptText||''):undefined}).catch(()=>{});
  },S);
  // Uncaught exceptions AND unhandled promise rejections both arrive here.
  c.on('Runtime.exceptionThrown',p=>{ const d=p.exceptionDetails||{};
    report.pageErrors.push(String((d.exception&&d.exception.description)||d.text||'exception').split('\n')[0]); },S);
  c.on('Runtime.consoleAPICalled',p=>{ if(p.type==='error')
    report.consoleErrors.push((p.args||[]).map(a=>a.value!=null?String(a.value):(a.description||'')).join(' ').slice(0,300)); },S);

  const ev=async(expr)=>{
    const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,userGesture:true});
    if(r.exceptionDetails)throw new Error(String((r.exceptionDetails.exception&&r.exceptionDetails.exception.description)||r.exceptionDetails.text).split('\n')[0]);
    return r.result&&r.result.value;
  };
  const fn=(f,...args)=>ev('('+f.toString()+')('+args.map(a=>JSON.stringify(a)).join(',')+')');
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const waitFor=async(expr,ms,what)=>{
    const end=Date.now()+(ms||15000);
    while(Date.now()<end){ try{ if(await ev('!!('+expr+')'))return true; }catch(e){} await sleep(250); }
    throw new Error('timed out waiting for '+(what||expr));
  };
  const key=async(k,code,vk,text)=>{
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,windowsVirtualKeyCode:vk,text});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,windowsVirtualKeyCode:vk});
  };
  const ENTER=()=>key('Enter','Enter',13,'\r'),ESC=()=>key('Escape','Escape',27),F2=()=>key('F2','F2',113);
  const clickEl=async sel=>{
    const r=await ev('(function(){var e=document.querySelector('+JSON.stringify(sel)+');if(!e)return null;e.scrollIntoView({block:"center"});var b=e.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2};})()');
    if(!r)throw new Error('nothing on screen matches '+sel);
    for(const type of ['mousePressed','mouseReleased'])
      await send('Input.dispatchMouseEvent',{type,x:r.x,y:r.y,button:'left',clickCount:1});
  };
  const shotRaw=async(name)=>{
    await sleep(400);   // let a repaint and the fonts settle
    const {data}=await send('Page.captureScreenshot',{format:'png'});
    const f=name+'.png'; fs.writeFileSync(path.join(outDir,f),Buffer.from(data,'base64'));
    report.screens.push(f); console.log('  shot '+f);
  };
  // One screen: screenshot, then every per-screen assertion, with the
  // console and exception counts scoped to what happened since the last one.
  let errMark={c:0,p:0};
  const markErrors=()=>{errMark={c:report.consoleErrors.length,p:report.pageErrors.length};};
  const screen=async(name,label)=>{
    await shotRaw(name);
    const ce=report.consoleErrors.slice(errMark.c),pe=report.pageErrors.slice(errMark.p);
    check(label+': no console errors',!ce.length,ce.join(' | '));
    check(label+': no uncaught exception or rejection',!pe.length,pe.join(' | '));
    const clip=await fn(PROBE_CLIPPED).catch(e=>({seen:0,bad:['probe failed: '+e.message],total:1}));
    check(label+': no text wider than its box ('+clip.seen+' leaves)',!clip.total,clip.bad.join(' ; ')+(clip.total>clip.bad.length?' … and '+(clip.total-clip.bad.length)+' more':''));
    const fp=await fn(PROBE_FACES_AND_PILLS).catch(e=>({nFaces:0,faces:['probe failed: '+e.message],nPills:0,pills:[]}));
    if(fp.nFaces)check(label+': every avatar has a photo or initials ('+fp.nFaces+')',!fp.faces.length,fp.faces.join(', '));
    if(fp.nPills)check(label+': every pill has a lane colour ('+fp.nPills+')',!fp.pills.length,fp.pills.join(' ; '));
    markErrors();
  };
  const nav=async(id,label)=>{
    const ms=await fn(NAV_TIMED,id,String(id).indexOf('tb-')===0);
    check(label+': painted within '+PAINT_MS+' ms of navigation',ms>=0&&ms<=PAINT_MS,ms<0?'never painted (8 s)':ms+' ms');
    return ms;
  };
  // A write probe the page runs with the app's own bridged SDK. Returns
  // 'allowed' or the Firestore error code.
  const probe=async(js)=>ev('(async()=>{try{'+js+';return "allowed";}catch(e){return (e&&e.code)||String(e&&e.message||e);}})()');
  const setTheme=t=>ev('(function(){try{localStorage.setItem("groovy-theme",'+JSON.stringify(t)+');}catch(e){}'
    +'if(typeof profileApplyTheme==="function")profileApplyTheme();return document.documentElement.getAttribute("data-theme");})()');
  const setViewport=async v=>{
    await send('Emulation.setDeviceMetricsOverride',{width:v.width,height:v.height,deviceScaleFactor:v.scale,mobile:v.mobile});
    await sleep(250);
  };

  let exit=0,item=null,wdBefore=null;
  try{
    console.log('board.e2e: '+(STUB?'STUB ':'')+report.site+' as '+handle+' → docs/board-screens/'+folder+'/');
    await send('Page.navigate',{url:URL_});
    await waitFor('document.getElementById("l-user")&&document.getElementById("l-pass")',30000,'the login form');
    report.siteCacheVersion=await ev('fetch("/sw.js",{cache:"no-store"}).then(r=>r.text()).then(t=>((/CACHE_VERSION\\s*=\\s*\'([^\']+)\'/.exec(t)||[])[1]||null)).catch(()=>null)');
    console.log('  the site serves CACHE_VERSION '+report.siteCacheVersion);

    // ── Sign in through the real form: fill its two fields, press its
    // button. The password is passed as a call ARGUMENT
    // (Runtime.callFunctionOn), never placed in an expression's text, so
    // no exception message or log line can carry it.
    const fill=async(id,value)=>{
      const {result}=await send('Runtime.evaluate',{expression:'document.getElementById('+JSON.stringify(id)+')'});
      if(!result||!result.objectId)throw new Error('the login form has no #'+id);
      await send('Runtime.callFunctionOn',{objectId:result.objectId,arguments:[{value:value}],
        functionDeclaration:'function(v){this.value=v;this.dispatchEvent(new Event("input",{bubbles:true}));}'});
    };
    // The Firebase SDK loads from gstatic; if it did not, no sign-in can
    // work and the USER_DEFS hint below would be the wrong answer.
    if(!(await ev('typeof signInWithEmailAndPassword==="function"').catch(()=>false)))
      await waitFor('typeof signInWithEmailAndPassword==="function"',20000,
        'the Firebase SDK (www.gstatic.com) -- a network that blocks it cannot sign in');
    await fill('l-user',handle);
    await fill('l-pass',PASS);
    // Remember me is ticked by default since the 26 Sept login round. The
    // harness must never keep a session, offer the QA password to the
    // browser's password manager, or raise the fingerprint-lock offer card
    // (z-index 600, over the pages it screenshots) -- so it is unticked.
    await ev('(function(){var r=document.getElementById("l-remember");if(r)r.checked=false;return !r||!r.checked;})()');
    // Every toast the app shows is kept, so a failure can say what the app said.
    await ev('(function(){if(window.__e2eToasts)return;window.__e2eToasts=[];var t=window.showToast;if(typeof t==="function")window.showToast=showToast=function(m,e){window.__e2eToasts.push(String(m));return t.apply(this,arguments);};})()').catch(()=>{});
    await ev('document.getElementById("login-btn").click()');
    try{ await waitFor('typeof session!=="undefined"&&session&&session.uid',30000,'sign-in'); }
    catch(e){ const why=await ev('(document.querySelector(".toast")||{}).textContent||""').catch(()=>'');
      throw new Error('sign-in failed'+(why?': '+why:'')+' (does this deploy carry the `'+handle+'` USER_DEFS entry?)'); }
    const role=await ev('session.role');
    check('signed in with the qa role',role==='qa','role is '+role);
    const kept=await ev('(function(){try{return localStorage.getItem("groovy-keep-signed-in");}catch(e){return null;}})()').catch(()=>null);
    check('signed in WITHOUT Remember me (no kept session, no saved password)',kept!=='1','groovy-keep-signed-in is '+kept);
    if(role!=='qa'){ exit=2; throw new Error('not the QA role -- stopping before the harness writes anything (the sign-in itself has already logged a Login row)'); }

    // ── THE CONTAINMENT GATE ──────────────────────────────────────────
    const pos=await probe('await getDocs(query(collection(db,"pos"),limit(1)))');
    const bugs=await probe('await getDoc(doc(db,"bug_reports","__qa_probe__"))');
    check('the rules refuse it pos (isQa() is deployed)',pos==='permission-denied',pos);
    check('the rules refuse it bug_reports',bugs==='permission-denied',bugs);
    if(pos!=='permission-denied'||bugs!=='permission-denied'){
      exit=2; report.notes.push('GATE: the QA rules are not live. Nothing was written. Deploy firestore.rules first.');
      throw new Error('the QA rules are not deployed -- stopped before the harness writes anything (the sign-in itself has already logged a Login row)');
    }

    // ── Winter Drop 2027, BEFORE anything is written: every item's id and
    // updatedAt. Compared at the end; the harness must never touch it.
    await ev('window.showPage("tb-dash")');
    await waitFor('typeof tbLoaded!=="undefined"&&tbLoaded',20000,'the Board data');
    // The QA account is not a member of Winter Drop 2027, so the LIST never
    // loads for it -- only the shared items do. So the snapshot is every
    // real (non-qa) item it can read, Winter Drop's among them: stricter.
    const WD='(tbLists||[]).filter(l=>l&&l.title==="Winter Drop 2027")[0]';
    const REAL='(function(){var o={};(tbItems||[]).forEach(function(i){if(i.qa!==true)o[i.id]=String(i.updatedAt||"")+"|"+String(i.date||"")+"|"+String(i.status||"")+"|"+String(i.title||"");});return o;})()';
    wdBefore={items:await ev(REAL)};
    if(!Object.keys(wdBefore.items).length)report.notes.push('No real item is readable to the QA account; the untouched check has nothing to compare.');

    // ── The sandbox: created PRIVATE on first run, through the app's own
    // "+ New" (it prompts for the name).
    const findSandbox='(tbLists||[]).filter(l=>l.qa===true&&l.adminUid===session.uid&&l.title==="QA Sandbox")[0]';
    let sandbox=await ev(findSandbox);
    if(!sandbox){
      promptText='QA Sandbox';
      await ev('window.tbNewList("private")');
      await waitFor(findSandbox,15000,'the new QA Sandbox list');
      sandbox=await ev(findSandbox);
      report.notes.push('Created the QA Sandbox list ('+sandbox.id+').');
    }
    check('the sandbox is a private qa list it runs alone',
      sandbox&&sandbox.kind==='private'&&sandbox.qa===true&&JSON.stringify(sandbox.memberUids)===JSON.stringify([await ev('session.uid')]),
      JSON.stringify(sandbox&&{kind:sandbox.kind,qa:sandbox.qa,members:sandbox.memberUids}));

    // ── Create an item through the composer (typed, then Enter).
    const title='e2e '+commit+' '+Date.now().toString(36);
    await ev('window.showPage("tb-dash")');await sleep(300);
    const hasComposer=await ev('!!document.getElementById("tb-qa")');
    if(hasComposer){
      // Clicked like a person would, then checked: a focus() can land on
      // an element a repaint is about to replace.
      await clickEl('#tb-qa');await sleep(250);
      if(!(await ev('document.activeElement&&document.activeElement.id==="tb-qa"'))){await ev('document.getElementById("tb-qa").focus()');await sleep(150);}
      check('the composer takes the caret',await ev('document.activeElement&&document.activeElement.id==="tb-qa"'),
        await ev('(document.activeElement&&(document.activeElement.id||document.activeElement.tagName))||"nothing"'));
      await send('Input.insertText',{text:title+' tomorrow'});
      await sleep(150);
      await ENTER();
    }else{
      report.notes.push('No composer on the Dashboard; created through tbCreateFromQuick.');
      await ev('window.tbCreateFromQuick('+JSON.stringify(title+' tomorrow')+',false,false)');
    }
    const findItem='(tbItems||[]).filter(i=>i.title==='+JSON.stringify(title)+')[0]';
    try{ await waitFor(findItem,15000,'the new item'); }
    catch(e){ const why=await ev('(document.querySelector(".toast")||{}).textContent||""').catch(()=>'');
      const left=await ev('(document.getElementById("tb-qa")||{}).value||""').catch(()=>'');
      const near=await ev('(tbItems||[]).filter(function(i){return /e2e/i.test(i.title||"");}).map(function(i){return i.title+" @"+i.listId;}).join(" / ")+" | stub writes: "+((window.__FS||{}).writes)+" | tb-qa: "+!!document.getElementById("tb-qa")').catch(()=>'');
      console.log('  debug: '+near);
      const toasts=await ev('(window.__e2eToasts||[]).slice(-3).join(" / ")').catch(()=>'');
      throw new Error(e.message+(why||toasts?' — the app said: '+(why||toasts):'')+(left?' — the composer still holds: '+left:'')); }
    item=await ev(findItem);
    check('the item landed in the sandbox',item.listId===sandbox.id,item.listId);
    check('flagged qa: true',item.qa===true,item.qa);
    check('assigned to nobody but the harness',JSON.stringify(item.assigneeUids)===JSON.stringify([await ev('session.uid')]),JSON.stringify(item.assigneeUids));
    check('private, so the rules hide it from everyone else',item.visibility==='private',item.visibility);
    check('dated (the quick-add grammar read "tomorrow")',!!item.date,item.date);

    // ── Not built yet: named once, never silently dropped.
    report.notBuilt.push('Calendar Day view (the calendar has Month and Week)');
    report.notBuilt.push('A list\'s own Calendar, Lanes and Members tabs (a list shows its Tasks)');
    const canSettings=await ev('typeof _tbIsBoardOwner==="function"?!!_tbIsBoardOwner():false').catch(()=>false);
    if(!canSettings)report.notBuilt.push('Settings: Board owners only; the QA account is not one, so it cannot reach it (by design)');

    // ── The screen matrix: every screen, both widths, both themes.
    markErrors();
    for(const theme of THEMES){
      const got=await setTheme(theme);
      check('the '+theme+' theme is applied',got===theme,got);
      for(const v of VIEWPORTS){
        await setViewport(v);
        const tag=theme+'-'+v.id;
        await nav('tb-dash','Dashboard '+tag); await screen('dash-'+tag,'Dashboard '+tag);
        await nav('tb-calendar','Calendar '+tag);
        const phoneCal=await ev('typeof _tbIsPhone==="function"&&_tbIsPhone()');
        if(!phoneCal){
          await ev('window.tbCalView("month")');await sleep(200);
          await screen('calendar-month-'+tag,'Calendar Month '+tag);
        }else report.notes.push('At '+v.id+' the calendar offers Week only (the app forces it on a phone); no Month screen there.');
        await ev('window.tbCalView("week")');await sleep(200);
        await screen('calendar-week-'+tag,'Calendar Week '+tag);
        await nav('tb-lists','Lists '+tag);
        await ev('window.tbOpenList('+JSON.stringify(sandbox.id)+')');await sleep(300);
        await screen('list-tasks-'+tag,'QA Sandbox list (Tasks) '+tag);
        await ev('window.tbOpenItem('+JSON.stringify(item.id)+')');await sleep(500);
        await screen('item-pane-'+tag,'Item pane '+tag);
        await ev('window.tbCloseItem()');
        await nav('tb-inbox','Inbox '+tag); await screen('inbox-'+tag,'Inbox '+tag);
        if(canSettings){
          await nav('tb-dash','Dashboard '+tag);
          await ev('typeof tbToggleSettings==="function"&&window.tbToggleSettings()');await sleep(400);
          await screen('settings-'+tag,'Settings '+tag);
          await ev('typeof tbToggleSettings==="function"&&window.tbToggleSettings()');
        }
      }
    }
    await send('Emulation.clearDeviceMetricsOverride');
    await setTheme('light');

    // ── The refused path, NEVER on Winter Drop 2027: a real locked gate in
    // another list. Written TO ITS CURRENT DATE, so even a rule that wrongly
    // allowed it would change nothing.
    // Only a gate whose list it can READ and see is not Winter Drop 2027;
    // a gate in a list it cannot see might be Winter Drop's, so it is left.
    const gate=await ev('(function(){return (tbItems||[]).filter(function(i){var l=(tbLists||[]).filter(function(x){return x&&x.id===i.listId;})[0];return i.kind==="gate"&&i.locked&&i.qa!==true&&i.date&&l&&l.title!=="Winter Drop 2027";})[0]||null;})()');
    if(gate){
      const r=await probe('await updateDoc(doc(db,"board_items",'+JSON.stringify(gate.id)+'),{date:'+JSON.stringify(gate.date)+'})');
      check('it cannot touch a real locked gate ("'+gate.title+'")',r==='permission-denied',r);
    }else report.notes.push('No locked gate in a list it can see (other than Winter Drop 2027) -- the refused-gate probe did not run. It never runs on Winter Drop.');
    const notify=await probe('await setDoc(doc(db,"hrm_notifications","qa_e2e_probe"),{forUser:"ammar",title:"probe",createdAt:Date.now()})');
    check('it cannot write a notification for a real person',notify==='permission-denied',notify);

    // ── Milanote: its own dialog and the in-place renames.
    await milanote();

    // ── Clean up the item it made (its own, so the rules allow it).
    const del=await probe('await deleteDoc(doc(db,"board_items",'+JSON.stringify(item.id)+'))');
    check('it deletes the item it made',del==='allowed',del);
    item=null;

    // ── Winter Drop 2027, AFTER: nothing it holds may have changed.
    if(wdBefore&&Object.keys(wdBefore.items).length){
      await sleep(600);
      const after=await ev(REAL);
      const ids=Object.keys(Object.assign({},wdBefore.items,after));
      const changed=ids.filter(id=>wdBefore.items[id]!==after[id]);
      check('no real item changed, Winter Drop 2027 included ('+Object.keys(wdBefore.items).length+' compared)',!changed.length,changed.slice(0,8).join(', '));
    }
    check('no browser prompt(), confirm() or alert() was raised by Milanote or the Board after sign-in',
      !nativeDialogs.filter(d=>!/^prompt: Name the list/i.test(d)).length,nativeDialogs.join(' | '));
  }catch(e){
    if(!exit)exit=1;
    check('the run completed',false,e.message);
  }finally{
    if(item){ try{ await probe('await deleteDoc(doc(db,"board_items",'+JSON.stringify(item.id)+'))'); }catch(e){} }
    try{ await ev('typeof signOut==="function"&&auth?signOut(auth):null'); }catch(e){}
    report.finishedAt=new Date().toISOString();
    report.exit=exit||(failed?1:0);
    fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2));
    const md=['# Board e2e — '+folder,'',
      STUB?'**STUB RUN** — the real shell against an in-memory Firestore with the QA rules imitated. It proves the pages and the harness, not the live data, rules or network.':'',
      '- Site: '+report.site+' (serves `'+report.siteCacheVersion+'`)',
      '- Checkout: `'+commit+'`'+(dirty?' with uncommitted changes':''),
      '- Run: '+report.startedAt+' → '+report.finishedAt,
      '- Result: '+(report.exit===0?'PASS':report.exit===2?'STOPPED AT THE GATE':'FAIL')+' — '
        +report.checks.filter(k=>k.ok).length+'/'+report.checks.length+' checks','',
      '| check | result | detail |','|---|---|---|']
      .concat(report.checks.map(k=>'| '+k.name.replace(/\|/g,'\\|')+' | '+(k.ok?'ok':'**FAIL**')+' | '+(k.ok?'':String(k.detail||'').replace(/\|/g,'\\|'))+' |'))
      .concat(['','## Not built or not reachable (named, not tested)','',...report.notBuilt.map(x=>'- '+x),
        '','## Screens','',...report.screens.map(f=>'- '+f),'',
        '## Page errors ('+report.pageErrors.length+')','',...report.pageErrors.map(x=>'- '+x),'',
        '## Console errors ('+report.consoleErrors.length+')','',...report.consoleErrors.map(x=>'- '+x),'',
        '## Notes','',...report.notes.map(x=>'- '+x),'']);
    fs.writeFileSync(path.join(outDir,'report.md'),md.join('\n'));
    c.close(); try{proc.kill();}catch(e){}
    if(stubSite)stubSite.close();
    try{ fs.rmSync(profile,{recursive:true,force:true}); }catch(e){}
    console.log('\nboard.e2e: '+(STUB?'STUB ':'')+(report.exit===0?'PASS':report.exit===2?'STOPPED AT THE GATE':'FAIL')
      +' — '+report.checks.filter(k=>k.ok).length+'/'+report.checks.length+' checks · report in docs/board-screens/'+folder+'/report.md');
    process.exit(report.exit);
  }

  // ── Milanote ────────────────────────────────────────────────────────
  async function milanote(){
    // A board of its own to work on: the stub seeds "QA board"; on the live
    // site it uses one if it owns one, else only the dialog is exercised.
    await ev('window.showPage("boards")');
    await waitFor('typeof currentPage!=="undefined"&&(currentPage==="board-canvas"||currentPage==="boards")',15000,'Milanote');
    await sleep(800);
    const hubBack=await ev('(function(){var b=document.querySelector(".board-topbar .back-btn");return b?b.textContent.trim():"";})()');
    if(hubBack)check('Milanote Home\'s back button says Milanote',/Milanote/.test(hubBack)&&!/Creative Hub/.test(hubBack),hubBack);
    const own=await ev('(function(){var b=(moodBoards||[]).filter(function(x){return x.ownerUid===session.uid&&!x.isHome&&(x.cards||[]).some(function(c){return c.type==="text"&&c.name;});})[0];return b?b.id:null;})()');
    if(own){
      await ev('window.boardsOpenFromAll('+JSON.stringify(own)+')');
      await waitFor('currentPage==="board-canvas"&&_editBoard&&_editBoard.id==='+JSON.stringify(own),15000,'the QA board');
      await sleep(600);
    }else report.notes.push('No Milanote board of its own with a named card: the in-place renames were not exercised here.');

    for(const theme of THEMES){
      await setTheme(theme);
      for(const v of VIEWPORTS){
        await setViewport(v);
        const tag=theme+'-'+v.id;
        if(own){ await ev('window.boardsOpenFromAll('+JSON.stringify(own)+')'); await sleep(500); }
        markErrors();
        await screen('milanote-board-'+tag,'Milanote board '+tag);
        // The dialog, raised the way "Move to Trash" raises it, then Escape.
        await ev('window.__e2eDlg=_boardsConfirm("Move \\"QA board\\" to Trash? You can restore it from the boards list.",{ok:"Move to Trash",danger:true});true');
        await sleep(200);
        check('Milanote '+tag+': the confirm is its own dialog, on screen',
          await ev('!!document.getElementById("board-confirm")&&document.getElementById("board-confirm").getClientRects().length>0'));
        await screen('milanote-confirm-'+tag,'Milanote confirm dialog '+tag);
        await ESC();
        check('Milanote '+tag+': Escape answers Cancel and closes it',
          (await ev('window.__e2eDlg.then(function(v){return v;})'))===false&&!(await ev('!!document.getElementById("board-confirm")')));
      }
    }
    await send('Emulation.clearDeviceMetricsOverride');await setTheme('light');
    if(!own)return;

    // ── In-place renames, with real keys. Escape first everywhere (no
    // write); Enter only on the stub.
    await ev('window.boardsOpenFromAll('+JSON.stringify(own)+')');await sleep(500);
    const card=await ev('(_editCards.filter(function(c){return c.type==="text"&&c.name;})[0]||{}).id||null');
    const oldName=await ev('(_editCards.filter(function(c){return c.id==='+JSON.stringify(card)+';})[0]||{}).name');
    await ev('_boardsSetSelection(['+JSON.stringify(card)+'])');
    await F2();await sleep(150);
    check('F2 turns the card name into a field where it sits',
      await ev('(function(){var e=document.getElementById("board-name-"+'+JSON.stringify(card)+');return !!e&&e.getAttribute("contenteditable")==="true"&&document.activeElement===e;})()'));
    await ev('document.execCommand("selectAll")');
    await send('Input.insertText',{text:'Abandoned name'});
    await shotRaw('milanote-rename-card-editing');
    await ESC();await sleep(150);
    check('Escape leaves the card name as it was',await ev('(_editCards.filter(function(c){return c.id==='+JSON.stringify(card)+';})[0]||{}).name')===oldName);
    check('and shows it again',await ev('document.getElementById("board-name-"+'+JSON.stringify(card)+').textContent')===oldName);

    await ev('document.getElementById("board-title-input").focus()');
    const oldTitle=await ev('_editBoard.title');
    await ev('document.getElementById("board-title-input").select()');
    await send('Input.insertText',{text:'Abandoned title'});
    await ESC();await sleep(150);
    check('Escape leaves the board title as it was',await ev('_editBoard.title')===oldTitle&&await ev('document.getElementById("board-title-input").value')===oldTitle);

    const sub=await ev('(_editCards.filter(function(c){return c.type==="board"&&c.boardId;})[0]||{}).id||null');
    if(sub){
      await ev('_boardsSetSelection(['+JSON.stringify(sub)+']);_boardsCtxRun("board-rename")');await sleep(150);
      check('"Rename the board…" edits the sub-board title in place, no prompt',
        await ev('(function(){var e=document.querySelector("#board-card-"+'+JSON.stringify(sub)+'+" .board-subboard-title");return !!e&&e.getAttribute("contenteditable")==="true";})()'));
      await shotRaw('milanote-rename-board-editing');
      await ESC();await sleep(150);
    }

    if(!STUB)return;   // the live site: read-only, nothing committed
    await ev('_boardsSetSelection(['+JSON.stringify(card)+'])');
    await F2();await sleep(150);
    await ev('document.execCommand("selectAll")');
    await send('Input.insertText',{text:'Rib spec v2'});
    await ENTER();await sleep(150);
    check('STUB: Enter saves the card name',await ev('(_editCards.filter(function(c){return c.id==='+JSON.stringify(card)+';})[0]||{}).name')==='Rib spec v2');
    await ev('_boardsSetSelection(['+JSON.stringify(card)+'])');
    await F2();await sleep(150);
    await ev('document.execCommand("selectAll");document.execCommand("delete")');
    await ENTER();await sleep(150);
    check('STUB: an emptied card name reverts',await ev('(_editCards.filter(function(c){return c.id==='+JSON.stringify(card)+';})[0]||{}).name')==='Rib spec v2');
    await ev('document.getElementById("board-title-input").focus();document.getElementById("board-title-input").select()');
    await send('Input.insertText',{text:'QA board FW27'});
    await ENTER();await sleep(150);
    check('STUB: Enter saves the board title',await ev('_editBoard.title')==='QA board FW27');
    if(sub){
      await ev('_boardsSetSelection(['+JSON.stringify(sub)+']);_boardsCtxRun("board-rename")');await sleep(150);
      await ev('document.execCommand("selectAll")');
      await send('Input.insertText',{text:'Knitwear FW27'});
      await ENTER();await sleep(600);
      check('STUB: Enter renames the linked board',
        await ev('((moodBoards||[]).filter(function(b){return b.id===(_editCards.filter(function(c){return c.id==='+JSON.stringify(sub)+';})[0]||{}).boardId;})[0]||{}).title')==='Knitwear FW27');
    }
    await screen('milanote-after-renames-light-1440','Milanote after the renames');
  }
})().catch(e=>{ console.error('board.e2e: '+e.message); process.exit(1); });

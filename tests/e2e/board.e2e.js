#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   tests/e2e/board.e2e.js — The Board, on the REAL platform, as the QA
   harness account.   `node tests/e2e/board.e2e.js`

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
        second; old rules allow both. Rehearsed both ways against the real
        shell with an in-memory Firestore.)
     3. Every write goes into its own "QA Sandbox" list, which it creates
        PRIVATE on first run: its items are then unreadable to anyone
        else BY THE RULES, not just hidden by the client -- so a person
        on an old cached build never sees them either.
     4. The refused-path probe on a real locked gate writes the gate's
        date TO ITS CURRENT VALUE, so even a rule that wrongly allowed it
        would change nothing.
     5. The item it creates is deleted at the end.

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

const URL_=process.env.GROOVY_QA_URL||'';
const EMAIL=process.env.GROOVY_QA_EMAIL||'';
const PASS=process.env.GROOVY_QA_PASSWORD||'';
const skip=why=>{ console.log('board.e2e: SKIPPED — '+why); process.exit(0); };

function findBrowser(){
  const c=[process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);
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

(async()=>{
  const missing=['GROOVY_QA_URL','GROOVY_QA_EMAIL','GROOVY_QA_PASSWORD'].filter(k=>!process.env[k]);
  if(missing.length)skip('set '+missing.join(', ')+' in your shell (see BOARD.md, "The QA identity").');
  if(typeof WebSocket!=='function')skip('needs Node 22+ (a global WebSocket); this is '+process.version+'.');
  const browser=findBrowser();
  if(!browser)skip('no Chrome/Chromium found; set CHROME_BIN.');
  const handle=EMAIL.split('@')[0].toLowerCase();

  let commit='nogit';
  try{ commit=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:ROOT}).toString().trim(); }catch(e){}
  const outDir=path.join(ROOT,'docs','board-screens',commit);
  fs.mkdirSync(outDir,{recursive:true});
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'board-e2e-'));

  const report={commit,site:URL_,startedAt:new Date().toISOString(),siteCacheVersion:null,
    checks:[],screens:[],consoleErrors:[],pageErrors:[],notes:[]};
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
  // Headless gives the page no focus; the composer step below types into
  // a focused field.
  await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Page.bringToFront');
  // A prompt() is answered with whatever the next step queued -- the list
  // name when the app asks "Name the list". A confirm() is accepted.
  let promptText=null;
  c.on('Page.javascriptDialogOpening',p=>{
    send('Page.handleJavaScriptDialog',{accept:true,promptText:p.type==='prompt'?(promptText||''):undefined}).catch(()=>{});
  },S);
  c.on('Runtime.exceptionThrown',p=>{ const d=p.exceptionDetails||{};
    report.pageErrors.push(String((d.exception&&d.exception.description)||d.text||'exception').split('\n')[0]); },S);
  c.on('Runtime.consoleAPICalled',p=>{ if(p.type==='error')
    report.consoleErrors.push((p.args||[]).map(a=>a.value!=null?String(a.value):(a.description||'')).join(' ').slice(0,300)); },S);

  const ev=async(expr)=>{
    const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails)throw new Error(String((r.exceptionDetails.exception&&r.exceptionDetails.exception.description)||r.exceptionDetails.text).split('\n')[0]);
    return r.result&&r.result.value;
  };
  const waitFor=async(expr,ms,what)=>{
    const end=Date.now()+(ms||15000);
    while(Date.now()<end){ try{ if(await ev('!!('+expr+')'))return true; }catch(e){} await new Promise(r=>setTimeout(r,250)); }
    throw new Error('timed out waiting for '+(what||expr));
  };
  const shot=async(name)=>{
    await new Promise(r=>setTimeout(r,600));   // let a repaint and the fonts settle
    const {data}=await send('Page.captureScreenshot',{format:'png'});
    const f=name+'.png'; fs.writeFileSync(path.join(outDir,f),Buffer.from(data,'base64'));
    report.screens.push(f); console.log('  shot '+f);
  };
  const page=async(id)=>{
    await ev('window.showPage('+JSON.stringify(id)+')');
    await waitFor('typeof currentPage!=="undefined"&&currentPage==='+JSON.stringify(id)
      +'&&document.getElementById("main-content")&&document.getElementById("main-content").children.length>0',15000,id);
    if(String(id).indexOf('tb-')===0)await waitFor('typeof tbLoaded!=="undefined"&&tbLoaded',20000,'the Board data');
  };
  // A write probe the page runs with the app's own bridged SDK. Returns
  // 'allowed' or the Firestore error code.
  const probe=async(js)=>ev('(async()=>{try{'+js+';return "allowed";}catch(e){return (e&&e.code)||String(e&&e.message||e);}})()');

  let exit=0;
  try{
    console.log('board.e2e: '+URL_+' as '+handle+' → docs/board-screens/'+commit+'/');
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
    // A deploy older than that round has no box, and nothing is lost.
    await ev('(function(){var r=document.getElementById("l-remember");if(r)r.checked=false;return !r||!r.checked;})()');
    await ev('document.getElementById("login-btn").click()');
    try{ await waitFor('typeof session!=="undefined"&&session&&session.uid',30000,'sign-in'); }
    catch(e){ const why=await ev('(document.querySelector(".toast")||{}).textContent||""').catch(()=>'');
      throw new Error('sign-in failed'+(why?': '+why:'')+' (does this deploy carry the `'+handle+'` USER_DEFS entry?)'); }
    const role=await ev('session.role');
    check('signed in with the qa role',role==='qa','role is '+role);
    const kept=await ev('(function(){try{return localStorage.getItem("groovy-keep-signed-in");}catch(e){return null;}})()').catch(()=>null);
    check('signed in WITHOUT Remember me (no kept session, no saved password)',kept!=='1','groovy-keep-signed-in is '+kept);
    if(role!=='qa'){ exit=2; throw new Error('not the QA role -- stopping before anything is written'); }

    // ── THE CONTAINMENT GATE ──────────────────────────────────────────
    const pos=await probe('await getDocs(query(collection(db,"pos"),limit(1)))');
    const bugs=await probe('await getDoc(doc(db,"bug_reports","__qa_probe__"))');
    check('the rules refuse it pos (isQa() is deployed)',pos==='permission-denied',pos);
    check('the rules refuse it bug_reports',bugs==='permission-denied',bugs);
    if(pos!=='permission-denied'||bugs!=='permission-denied'){
      exit=2; report.notes.push('GATE: the QA rules are not live. Nothing was written. Deploy firestore.rules first.');
      throw new Error('the QA rules are not deployed -- stopped before writing anything');
    }

    // ── Dashboard ─────────────────────────────────────────────────────
    await page('tb-dash');
    check('it lands on the Board',await ev('currentPage')==='tb-dash');
    check('no Board page error card',!(await ev('!!document.querySelector("#main-content .tb-err")')));
    await shot('01-dashboard');

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
    await page('tb-dash');
    const hasComposer=await ev('!!document.getElementById("tb-qa")');
    if(hasComposer){
      await ev('document.getElementById("tb-qa").focus()');
      await send('Input.insertText',{text:title+' tomorrow'});
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    }else{
      report.notes.push('No composer on the Dashboard; created through tbCreateFromQuick.');
      await ev('window.tbCreateFromQuick('+JSON.stringify(title+' tomorrow')+',false,false)');
    }
    const findItem='(tbItems||[]).filter(i=>i.title==='+JSON.stringify(title)+')[0]';
    await waitFor(findItem,15000,'the new item');
    const item=await ev(findItem);
    check('the item landed in the sandbox',item.listId===sandbox.id,item.listId);
    check('flagged qa: true',item.qa===true,item.qa);
    check('assigned to nobody but the harness',JSON.stringify(item.assigneeUids)===JSON.stringify([await ev('session.uid')]),JSON.stringify(item.assigneeUids));
    check('private, so the rules hide it from everyone else',item.visibility==='private',item.visibility);
    check('dated (the quick-add grammar read "tomorrow")',!!item.date,item.date);
    await shot('02-dashboard-after-add');

    // ── The other pages.
    await page('tb-calendar'); await shot('03-calendar');
    await page('tb-lists');
    await ev('window.tbOpenList('+JSON.stringify(sandbox.id)+')');
    await new Promise(r=>setTimeout(r,400)); await shot('04-sandbox-list');
    await ev('window.tbOpenItem('+JSON.stringify(item.id)+')');
    await new Promise(r=>setTimeout(r,600)); await shot('05-item-pane');
    await ev('window.tbCloseItem()');
    await page('tb-inbox'); await shot('06-inbox');

    // ── The refused path: a real, locked gate. Written TO ITS CURRENT
    // DATE, so even a rule that wrongly allowed it would change nothing.
    const gate=await ev('(tbItems||[]).filter(i=>i.kind==="gate"&&i.locked&&i.qa!==true&&i.date)[0]||null');
    if(gate){
      const r=await probe('await updateDoc(doc(db,"board_items",'+JSON.stringify(gate.id)+'),{date:'+JSON.stringify(gate.date)+'})');
      check('it cannot touch a real locked gate ("'+gate.title+'")',r==='permission-denied',r);
    }else report.notes.push('No real locked gate is readable to it; the refused-path probe did not run.');
    const notify=await probe('await setDoc(doc(db,"hrm_notifications","qa_e2e_probe"),{forUser:"ammar",title:"probe",createdAt:Date.now()})');
    check('it cannot write a notification for a real person',notify==='permission-denied',notify);

    // ── Mood Boards.
    await ev('window.showPage("boards")');
    await waitFor('typeof currentPage!=="undefined"&&(currentPage==="board-canvas"||currentPage==="boards")',15000,'Mood Boards');
    await new Promise(r=>setTimeout(r,1500)); await shot('07-mood-boards');

    // ── The phone.
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await page('tb-dash'); await shot('08-phone-dashboard');
    await page('tb-calendar'); await shot('09-phone-calendar');
    await send('Emulation.clearDeviceMetricsOverride');

    // ── Clean up the item it made (its own, so the rules allow it).
    const del=await probe('await deleteDoc(doc(db,"board_items",'+JSON.stringify(item.id)+'))');
    check('it deletes the item it made',del==='allowed',del);
  }catch(e){
    if(!exit)exit=1;
    check('the run completed',false,e.message);
  }finally{
    try{ await ev('typeof signOut==="function"&&auth?signOut(auth):null'); }catch(e){}
    report.finishedAt=new Date().toISOString();
    report.exit=exit||(failed?1:0);
    fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2));
    const md=['# Board e2e — '+commit,'',
      '- Site: '+report.site+' (serves `'+report.siteCacheVersion+'`)',
      '- Run: '+report.startedAt+' → '+report.finishedAt,
      '- Result: '+(report.exit===0?'PASS':report.exit===2?'STOPPED AT THE GATE':'FAIL'),'',
      '| check | result | detail |','|---|---|---|']
      .concat(report.checks.map(k=>'| '+k.name.replace(/\|/g,'\\|')+' | '+(k.ok?'ok':'**FAIL**')+' | '+(k.ok?'':String(k.detail||'').replace(/\|/g,'\\|'))+' |'))
      .concat(['','## Screens','',...report.screens.map(f=>'- '+f),'',
        '## Page errors ('+report.pageErrors.length+')','',...report.pageErrors.map(x=>'- '+x),'',
        '## Console errors ('+report.consoleErrors.length+')','',...report.consoleErrors.map(x=>'- '+x),'',
        '## Notes','',...report.notes.map(x=>'- '+x),'']);
    fs.writeFileSync(path.join(outDir,'report.md'),md.join('\n'));
    c.close(); try{proc.kill();}catch(e){}
    try{ fs.rmSync(profile,{recursive:true,force:true}); }catch(e){}
    console.log('\nboard.e2e: '+(report.exit===0?'PASS':report.exit===2?'STOPPED AT THE GATE':'FAIL')
      +' — '+report.checks.filter(k=>k.ok).length+'/'+report.checks.length+' checks · report in docs/board-screens/'+commit+'/report.md');
    process.exit(report.exit);
  }
})().catch(e=>{ console.error('board.e2e: '+e.message); process.exit(1); });

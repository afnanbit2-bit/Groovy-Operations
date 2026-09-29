/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts — the security fixes of the M1.6c verification round
   (29 Sept 2026). Every section drives the REAL page code (js/ma-core.js,
   js/master-accounts.js and, where the sign-out is involved, js/auth.js)
   against stubbed Firebase bridges, and every fix was checked by undoing
   it once and watching its section fail by name.

   V1  "Use password instead" on the fingerprint lock never reloads into a
       signed-in app: the lock stays up while the books are dealt with, the
       tab's `u` goes first (so any reload is a cold open that asks for the
       lock), and every answer signs out.
   V2  An owner's sign-out never deletes ANOTHER person's unsent offline
       writes: Firestore's own queue is read first, and anything it cannot
       read keeps the copy (fail safe). The same flow was run against the
       REAL SDK 10.12.2 in Chromium — that is the scratchpad probe, not this
       suite; this suite holds the decisions.
   V3  (client half) what firestore.rules now checks mirrors js/ma-core.js:
       the holder kinds, the code shape, the go-live default, the edit
       row's clock window. The rules themselves run in
       tests/rules-emulator-ma.js (not CI: it needs the emulator).
   V5  a Dashboard left open swaps its figures for the locked line.
   V7  one way out per tab: a second Sign out / "Use password instead" gets
       the first one's promise — but one that FAILED can be pressed again,
       and its error is not swallowed.
   V8  the other tabs: told before Firestore stops; a tab signed in as the
       same person, or whose Firestore was terminated under it, goes to the
       login.
   V9  the Master Accounts fingerprint unlock opens the books only on a
       real check.
   V11 a terminate that never settles is bounded.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const tick=ms=>new Promise(r=>setTimeout(r,ms||0));
/* Resolves to what p resolves to, or to 'TIMEOUT' — so a fix undone into
   a hang fails its assertion by name instead of hanging the suite. */
const within=(p,ms)=>Promise.race([Promise.resolve(p),tick(ms||1500).then(()=>'TIMEOUT')]);

function memLS(init){
  const m=Object.assign({},init||{});
  return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];},
    clear(){Object.keys(m).forEach(k=>{delete m[k];});},_m:m};
}
const AFNAN={uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'};
const MUSTAFA={uid:'u-must',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'};
const FSDB=()=>({_persistenceKey:'[DEFAULT]',_databaseId:{projectId:'groovy-gatepass',database:'(default)',isDefaultDatabase:true}});
const IDB_NAME='firestore/[DEFAULT]/groovy-gatepass/main';

/* One tab of the app with the sign-out bridges stubbed; every call lands
   in `calls` in order. */
function mk(o){
  o=o||{};
  const calls=o.calls||[];
  const SS=o.ss||memLS({u:'afnan'});
  const LS=o.ls||memLS({'groovy-keep-signed-in':'1','groovy_remembered_user':'afnan'});
  const who=o.session||AFNAN;
  const g=Object.assign({
    localStorage:LS,sessionStorage:SS,db:FSDB(),
    auth:{currentUser:{uid:who.uid,email:who.email,metadata:{lastSignInTime:new Date().toUTCString()}}},
    waitForPendingWrites:async()=>{calls.push('wait');},
    terminate:async()=>{calls.push('terminate');},
    clearIndexedDbPersistence:async()=>{calls.push('clear');},
    alert:m=>{calls.push('alert: '+m);},
    signOut:async()=>{calls.push('signOut');},
    location:{origin:'https://groovyoperations.netlify.app',pathname:'/',hash:'',reload(){calls.push('reload');}}
  },o.globals||{});
  const app=harness.loadApp({files:o.files||['js/ma-core.js','js/master-accounts.js'],currentPage:o.page||'dashboard',session:who,globals:g});
  app.run('session='+J(who));
  app.run('_maOffWait=30');
  return {app,calls,SS,LS};
}
const WITH_AUTH=['js/ma-core.js','js/master-accounts.js','js/auth.js'];

/* A fake IndexedDB — as much as _maQueuedAny touches, shaped like SDK
   10.12.2's store (read off the build: `mutations` keyed by batchId, each
   carrying its userId; `mutationQueues` per userId with
   lastAcknowledgedBatchId). Everything it does lands in `calls` too, so the
   order against terminate and clear is visible. */
function fakeIDB(dbs,opt,calls){
  opt=opt||{};
  const created=[];
  const idb={created,open(name){
    calls.push('open '+name);
    const req={};
    setTimeout(()=>{
      if(opt.never)return;
      if(opt.openError){req.error=new Error('The operation failed for reasons unrelated to the database itself');if(req.onerror)req.onerror({preventDefault(){}});return;}
      if(opt.blocked){if(req.onblocked)req.onblocked({});return;}
      let d=dbs[name];
      if(!d){
        let aborted=false;
        const tx={abort(){aborted=true;}};
        if(req.onupgradeneeded)req.onupgradeneeded({target:{transaction:tx,result:{}}});
        if(aborted){
          req.error=Object.assign(new Error('Version change transaction was aborted in upgradeneeded event handler.'),{name:'AbortError'});
          if(req.onerror)req.onerror({preventDefault(){}});
          return;
        }
        d=dbs[name]={stores:{}};created.push(name);
      }
      const conn={
        objectStoreNames:{contains:n=>Object.prototype.hasOwnProperty.call(d.stores,n)},
        transaction(names,mode){
          calls.push('read '+names.join(',')+' '+mode);
          const t={};
          setTimeout(()=>{
            if(opt.txError){t.error=new Error('The transaction was aborted.');if(t.onerror)t.onerror({});return;}
            setTimeout(()=>{if(t.oncomplete)t.oncomplete({});},0);
          },0);
          t.objectStore=n=>({getAll(){const r={};setTimeout(()=>{r.result=JSON.parse(JSON.stringify(d.stores[n]||[]));},0);return r;}});
          return t;
        },
        close(){calls.push('close');}
      };
      req.result=conn;
      if(req.onsuccess)req.onsuccess({target:req});
    },0);
    return req;
  }};
  return idb;
}
const queue=(mutations,queues)=>({[IDB_NAME]:{stores:{mutations,mutationQueues:queues}}});

/* A BroadcastChannel that records what it posts (V8). */
function fakeBC(calls){
  const inst=[];
  function BC(name){this.name=name;this.posted=[];inst.push(this);}
  BC.prototype.postMessage=function(m){this.posted.push(m);calls.push('broadcast '+(m&&m.uid));};
  BC.prototype.close=function(){};
  BC.inst=inst;
  return BC;
}

module.exports=async function(){
  const s=suite('ma-fix-sec');

  /* ── V1. "Use password instead" never reloads into a signed-in app ──── */
  s.section('V1 — "Use password instead" on the lock: the lock stays up, the tab forgets `u` first, and it always signs out');
  {
    // The books are held by another tab ("stay"). The stub records what the
    // tab looked like at the moment the books were asked about.
    const answers=[['stay',{stay:true}],['failed',{failed:true}],['kept',{kept:true,why:'queued'}],['cleared',{cleared:true}],['skipped',{skipped:'no bridge'}],['threw',null]];
    for(const [name,ans] of answers){
      const {app,calls,SS}=mk({files:WITH_AUTH});
      app.run('_lockShow(session,null)');   // the background lock is on screen
      let seen=null;
      app.ctx.window.maBooksOffDevice=async o=>{
        calls.push('books');
        let showing=null,hidden=null;try{showing=app.run('_lockShowing');hidden=app.el('scr-lock').hidden;}catch(_){}
        seen={o:o||null,u:SS.getItem('u'),showing,hidden};
        if(!ans)throw new Error('the bridge threw');
        return ans;
      };
      const r=await within(app.run('window.lockUsePassword()'));
      s.ok('"'+name+'": signs out, then reloads — never a reload into the signed-in app',r!=='TIMEOUT'&&J(calls)===J(['books','signOut','reload']),J(calls));
      s.ok('"'+name+'": the tab had forgotten `u` BEFORE the books were asked about',!!seen&&seen.u===null,J(seen));
      s.ok('"'+name+'": the lock was still on screen while they were',!!seen&&seen.showing===true&&seen.hidden===false,J(seen));
      s.ok('"'+name+'": the books were told this is the lock\'s way out (leaving)',!!seen&&!!seen.o&&seen.o.leaving===true,J(seen&&seen.o));
      // What the reload decides (js/shared.js onAuthStateChanged): cold =
      // the lock is asked for again if this person is still signed in.
      let d=null;try{d=JSON.parse(app.run('JSON.stringify(_authRestoreDecision({uid:"u-afnan",email:"afnan@groovy.op"},'+J(SS.getItem('u'))+',"1","afnan"))'));}catch(e){d={error:String(e)};}
      s.ok('"'+name+'": and the reload is a COLD open — the lock is asked for again',!!d&&d.cold===true,J(d));
    }
    // The fingerprint's own try (the lock's 250 ms auto-unlock, or a tap)
    // while the books are being dealt with must not take the lock down.
    {
      const {app,calls}=mk({files:WITH_AUTH});
      app.run('_lockShow(session,()=>{})');
      let release=null;
      app.ctx.window.maBooksOffDevice=()=>{calls.push('books');return new Promise(r=>{release=r;});};
      const p=app.run('window.lockUsePassword()');
      await tick(5);
      await app.run('window.lockUnlock()');   // no lock record here: before V1 this was "nothing to guard" — lock down
      await tick(5);
      let during=null;try{during={showing:app.run('_lockShowing'),hidden:app.el('scr-lock').hidden,msg:app.el('lock-msg').textContent};}catch(e){during={error:String(e)};}
      s.ok('while signing out, an unlock attempt leaves the lock on screen',!!during&&during.showing===true&&during.hidden===false,J(during));
      s.eq('…and the lock says what is happening',during&&during.msg,'Signing out…');
      if(release)release({stay:true});
      await within(p);
      s.eq('…and it still signs out when the books answer',J(calls),J(['books','signOut','reload']));
    }
    // Sign out (doLogout) keeps its "stay" meaning — still signed in, told to
    // close the other tabs — except that a reload under the lock is cold.
    {
      const {app,calls,SS}=mk({files:WITH_AUTH});
      app.ctx.window.maBooksOffDevice=async()=>{calls.push('books');return {stay:true};};
      await within(app.run('window.doLogout()'));
      s.eq('Sign out on "stay": still signed in, the tab reloads',J(calls),J(['books','reload']));
      s.eq('…and keeps `u` (a same-tab reload back into the app, as designed)',SS.getItem('u'),'afnan');
    }
    {
      const {app,calls,SS}=mk({files:WITH_AUTH});
      app.run('_lockShow(session,null)');
      app.ctx.window.maBooksOffDevice=async()=>{calls.push('books');return {stay:true};};
      await within(app.run('window.doLogout()'));
      s.ok('Sign out on "stay" while the lock is up: the tab forgets `u`, so the reload asks for the lock',J(calls)===J(['books','reload'])&&SS.getItem('u')===null,J({calls,u:SS.getItem('u')}));
    }
    // With the real books flow: another tab holds them → the lock's way out
    // still signs out, and says the copy stayed.
    {
      const {app,calls}=mk({files:WITH_AUTH,globals:{clearIndexedDbPersistence:async()=>{calls.push('clear');throw Object.assign(new Error('Failed to delete the IndexedDB database'),{code:'failed-precondition'});}}});
      app.run('_lockShow(session,null)');
      await within(app.run('window.lockUsePassword()'));
      s.ok('the real flow, the copy held by another tab: signed out and reloaded',calls.indexOf('signOut')>0&&calls[calls.length-1]==='reload',J(calls));
      s.ok('…and told the copy stayed — not "you are still signed in"',calls.some(c=>/^alert: You are signed out — but the books could not be taken off this device: another Groovy Ops tab still has them open\. Close the other Groovy Ops tabs, then sign in and sign out again: that removes them\./.test(c))&&!calls.some(c=>/you are still signed in/.test(c)),J(calls));
    }
  }

  /* ── V2. Another person's unsent writes are never deleted ──────────── */
  s.section('V2 — an owner\'s sign-out reads Firestore\'s own queue: anyone else\'s unsent writes keep the copy; unreadable keeps it too');
  {
    // The fake queue answers through a few 0 ms timers; the bound here is
    // a second, not mk's 30 ms, so a busy machine (CI, a GC pause) cannot
    // turn a readable queue into "unchecked". Only "never answers" waits it
    // out, and `within` gives it room.
    const run=async(dbs,opt,extra)=>{
      const calls=[];
      const idb=fakeIDB(dbs,opt,calls);
      const {app}=mk(Object.assign({calls,globals:Object.assign({indexedDB:idb},(extra&&extra.globals)||{})},extra&&extra.o||{}));
      app.run('_maOffWait=1000');
      const r=await within(app.run('window.maBooksOffDevice()'),4000);
      return {r,calls,idb,app};
    };
    const said=(calls,re)=>calls.some(c=>/^alert: /.test(c)&&re.test(c));
    // Mustafa wrote offline on this phone; Afnan signs in and out.
    let x=await run(queue([{batchId:5,userId:'u-must'}],[{userId:'u-must',lastAcknowledgedBatchId:3},{userId:'u-afnan',lastAcknowledgedBatchId:9}]));
    s.ok('Mustafa\'s write is waiting: the copy is KEPT (why: others)',x.r&&x.r.kept===true&&x.r.why==='others',J(x.r));
    s.ok('…nothing is deleted',x.calls.indexOf('clear')<0,J(x.calls));
    s.ok('…the queue was read AFTER Firestore stopped, from the database Firestore uses',x.calls.indexOf('terminate')>=0&&x.calls.indexOf('open '+IDB_NAME)>x.calls.indexOf('terminate'),J(x.calls));
    s.ok('…and it says so, in words that name someone else',said(x.calls,/Someone else who signs in on this device has changes that have not reached the server yet/),J(x.calls));
    // Acknowledged: not waiting.
    x=await run(queue([{batchId:3,userId:'u-must'}],[{userId:'u-must',lastAcknowledgedBatchId:3}]));
    s.ok('a batch at or below its user\'s last acknowledged one is not waiting: cleared',x.r&&x.r.cleared===true,J(x.r));
    s.ok('…and the connection was closed before the delete (an open one would block it)',x.calls.indexOf('close')>=0&&x.calls.indexOf('close')<x.calls.indexOf('clear'),J(x.calls));
    // Only mine (a write after the flush said none): keep — deleting loses it.
    x=await run(queue([{batchId:7,userId:'u-afnan'}],[{userId:'u-afnan',lastAcknowledgedBatchId:6}]));
    s.ok('only this owner\'s own write waits: kept (why: queued), nothing deleted',x.r&&x.r.kept===true&&x.r.why==='queued'&&x.calls.indexOf('clear')<0,J({r:x.r,calls:x.calls}));
    // Signed-out writes are nobody's — and not this owner's.
    x=await run(queue([{batchId:2,userId:''}],[]));
    s.ok('a write queued while signed out (userId "") keeps the copy',x.r&&x.r.kept===true&&x.r.why==='others',J(x.r));
    x=await run(queue([{batchId:1,userId:'u-x'}],[]));
    s.ok('a user with no queue row: every batch of theirs is waiting',x.r&&x.r.kept===true&&x.r.why==='others',J(x.r));
    // Fail SAFE: anything that cannot be read keeps the copy.
    for(const [label,opt,dbs] of [
      ['the database will not open',{openError:true},queue([],[])],
      ['the open is blocked',{blocked:true},queue([],[])],
      ['the read fails',{txError:true},queue([],[])],
      ['the queue never answers',{never:true},queue([],[])],
      ['it is not the shape this app knows',{},{[IDB_NAME]:{stores:{somethingElse:[]}}}]
    ]){
      x=await run(dbs,opt);
      s.ok(label+': kept (why: unchecked), nothing deleted',x.r&&x.r.kept===true&&x.r.why==='unchecked'&&x.calls.indexOf('clear')<0,J({r:x.r,calls:x.calls}));
    }
    x=await run({},{},{globals:{db:{}}});
    s.ok('an instance that cannot name its database: kept (unchecked)',x.r&&x.r.kept===true&&x.r.why==='unchecked'&&x.calls.indexOf('clear')<0,J({r:x.r,calls:x.calls}));
    // Nothing on this device: nothing to lose — and nothing created.
    x=await run({},{});
    s.ok('no copy on this device: cleared',x.r&&x.r.cleared===true,J(x.r));
    s.eq('…and the reader created no database looking for one',J(x.idb.created),J([]));
    {
      const calls=[];const {app}=mk({calls});   // the harness has no indexedDB at all
      const r=await within(app.run('window.maBooksOffDevice()'));
      s.ok('no IndexedDB in this browser: no copy can be here — cleared',r&&r.cleared===true&&J(calls)===J(['wait','terminate','clear']),J({r,calls}));
    }
    // The name, read off the instance the way SDK 10.12.2 builds it.
    {
      const {app}=mk();
      const nm=o=>{try{return app.run('_maIdbName('+J(o)+')');}catch(e){return 'THREW';}};
      s.eq('the default database: firestore/<app name>/<project>/main',nm({_persistenceKey:'[DEFAULT]',_databaseId:{projectId:'p1',database:'(default)',isDefaultDatabase:true}}),'firestore/[DEFAULT]/p1/main');
      s.eq('a named database: <project>.<database>',nm({_persistenceKey:'app2',_databaseId:{projectId:'p1',database:'other',isDefaultDatabase:false}}),'firestore/app2/p1.other/main');
      s.eq('an instance without them: refuses to guess',nm({}),'THREW');
    }
    // Through Sign out: "kept" is a sign-out.
    {
      const calls=[];
      const idb=fakeIDB(queue([{batchId:5,userId:'u-must'}],[]),{},calls);
      const {app}=mk({calls,files:WITH_AUTH,globals:{indexedDB:idb}});
      app.run('_maOffWait=1000');
      await within(app.run('window.doLogout()'),4000);
      s.ok('Sign out with Mustafa\'s write waiting: signed out, the copy kept, nothing deleted',calls.indexOf('signOut')>0&&calls[calls.length-1]==='reload'&&calls.indexOf('clear')<0,J(calls));
    }
  }

  /* ── V5. The Dashboard card ─────────────────────────────────────────── */
  s.section('V5 — a Dashboard left open swaps its figures for the locked line when the lock falls due');
  {
    const mkDash=who=>{
      const LS=memLS();
      const store={};const col=c=>(store[c]=store[c]||{});
      const cur={uid:who.uid,email:who.email,metadata:{lastSignInTime:new Date().toUTCString()}};
      const app=harness.loadApp({files:['js/ma-core.js','js/master-accounts.js'],currentPage:'dashboard',session:who,
        globals:{localStorage:LS,doc:(_d,c,id)=>({col:c,id}),collection:(_d,c)=>({col:c}),query:c=>c,orderBy:()=>({}),limit:()=>({}),where:()=>({}),
          getDocs:async q=>({docs:Object.keys(col(q.col)).map(id=>({id,data:()=>JSON.parse(JSON.stringify(col(q.col)[id]))}))}),auth:{currentUser:cur}}});
      app.run('session='+J(who));
      const idle=()=>{
        cur.metadata.lastSignInTime=new Date(Date.now()-2*3600000).toUTCString();
        app.run('_maLastTouch-=2*3600000');
        const a=JSON.parse(LS.getItem('groovy-ma-active')||'{}');Object.keys(a).forEach(k=>{a[k]-=2*3600000;});LS.setItem('groovy-ma-active',JSON.stringify(a));
      };
      return {app,idle};
    };
    const fire=(app,t)=>(app.state.listeners[t]||[]).forEach(fn=>fn({}));
    // In a browser innerHTML and textContent are one thing; the harness keeps
    // them apart, so a repaint sets both.
    const figures=card=>{card.innerHTML='<span class="ma-dash-num">₨4,20,000</span> cash in hand · nothing to worry about';card.textContent='₨4,20,000 cash in hand · nothing to worry about';};
    const locked=(app,card)=>{let line=null;try{line=app.run('_MA_CARD_LOCKED');}catch(_){}return !!line&&card.textContent===line&&!/cash in hand/.test(card.innerHTML);};
    const {app,idle}=mkDash(AFNAN);
    const card=app.el('ma-dash-body');
    card.innerHTML='Loading…';
    await app.run('_maPopulateDashboard()');
    s.ok('(signed in a moment ago: the card shows the figures)',/cash in hand/.test(card.innerHTML),card.innerHTML);
    app.run('_maRelockCheck()');fire(app,'pointerdown');fire(app,'visibilitychange');
    s.ok('while the lock is not due, the checks leave the card alone',/cash in hand/.test(card.innerHTML),card.innerHTML);
    idle();
    s.eq('(two hours idle: the lock is due)',app.run('_maNeedsRelock()'),true);
    fire(app,'visibilitychange');
    s.ok('the tab coming back swaps the figures for the locked line',locked(app,card),J({html:card.innerHTML,text:card.textContent}));
    figures(card);fire(app,'pointerdown');
    s.ok('so does a tap anywhere',locked(app,card),J({html:card.innerHTML,text:card.textContent}));
    figures(card);app.run('_maRelockCheck()');
    s.ok('and the 30-second check',locked(app,card),J({html:card.innerHTML,text:card.textContent}));
    card.innerHTML='';card.textContent='';
    await app.run('_maPopulateDashboard()');
    s.ok('the locked line is the one the card paints when it opens locked — one wording',locked(app,card),card.textContent);
    // Not an owner: the card is not theirs to touch.
    const m=mkDash(MUSTAFA);
    const mc=m.app.el('ma-dash-body');figures(mc);m.idle();
    let r=null;try{r=m.app.run('_maCardRelock()');}catch(e){r='THREW '+e.message;}
    s.ok('someone who cannot see Master Accounts: nothing touched',r===false&&/cash in hand/.test(mc.innerHTML),J({r,html:mc.innerHTML}));
  }

  /* ── V7. One way out per tab ────────────────────────────────────────── */
  s.section('V7 — a second Sign out (or "Use password instead") gets the first one\'s promise');
  {
    {
      const calls=[];
      const {app}=mk({calls,globals:{terminate:async()=>{calls.push('terminate');await tick(20);},clearIndexedDbPersistence:async()=>{calls.push('clear');await tick(20);}}});
      const p1=app.run('window.maBooksOffDevice()');
      const p2=app.run('window.maBooksOffDevice({leaving:true})');
      s.ok('two calls at once: the same promise',p1===p2);
      const r=await within(p1);
      s.ok('…one flow: Firestore stopped once, the copy deleted once',J(calls)===J(['wait','terminate','clear'])&&r&&r.cleared===true,J({calls,r}));
      const r3=await within(app.run('window.maBooksOffDevice()'));
      s.ok('…and a call after it has finished gets the same answer, running nothing again',r3===r&&J(calls)===J(['wait','terminate','clear']),J(calls));
    }
    // The review's probe: the first press has stopped Firestore and is
    // deleting the copy when the second lands.
    const pair=async(a,b)=>{
      const calls=[];let terminated=false;
      const {app}=mk({calls,files:WITH_AUTH,globals:{
        waitForPendingWrites:async()=>{if(terminated)throw Object.assign(new Error('The client has already been terminated.'),{code:'failed-precondition'});await tick(30);calls.push('wait');},
        terminate:async()=>{terminated=true;calls.push('terminate');},
        clearIndexedDbPersistence:async()=>{await tick(30);calls.push('clear');}}});
      app.run('_maOffWait=2000');   // each step takes 30 ms here; the bound is not what this tests
      const p1=app.run('window.'+a+'()');
      await tick(40);
      const p2=app.run('window.'+b+'()');
      await within(Promise.all([p1,p2]),2000);
      return {calls,same:p1===p2};
    };
    let x=await pair('doLogout','doLogout');
    s.eq('Sign out pressed twice: one sign-out, and no false "kept"',J(x.calls),J(['wait','terminate','clear','signOut','reload']));
    s.ok('…the second press is handed the first one\'s promise',x.same);
    x=await pair('doLogout','lockUsePassword');
    s.eq('Sign out, then "Use password instead": one flow',J(x.calls),J(['wait','terminate','clear','signOut','reload']));
    x=await pair('lockUsePassword','doLogout');
    s.eq('"Use password instead", then Sign out: one flow',J(x.calls),J(['wait','terminate','clear','signOut','reload']));
    x=await pair('lockUsePassword','lockUsePassword');
    s.eq('"Use password instead" pressed twice: one flow',J(x.calls),J(['wait','terminate','clear','signOut','reload']));
    // …but a way out that FAILED is not handed out again for ever.
    {
      const calls=[];let n=0;
      const {app}=mk({calls,files:WITH_AUTH,globals:{signOut:async()=>{n++;calls.push('signOut');if(n===1)throw new Error('The network went away.');}}});
      let first='resolved';try{await within(app.run('window.doLogout()'));}catch(e){first='rejected';}
      await tick(2);
      try{await within(app.run('window.doLogout()'));}catch(_){}
      s.ok('a Sign out whose sign-out failed can be pressed again — and signs out',first==='rejected'&&calls.filter(c=>c==='signOut').length===2&&calls[calls.length-1]==='reload',J({first,calls}));
      s.ok('…without taking the books off a second time (that answer is kept)',calls.filter(c=>c==='terminate').length===1&&calls.filter(c=>c==='clear').length===1,J(calls));
    }
    // …and the failure is not swallowed on the way: pressed the way the
    // button presses it (nobody awaits the answer), it still surfaces as an
    // unhandled rejection — what js/diagnostics.js records — as it did
    // before V7. Node raises the same event for a promise from the vm.
    {
      const calls=[];
      const {app}=mk({calls,files:WITH_AUTH,globals:{signOut:async()=>{calls.push('signOut');throw new Error('The network went away.');}}});
      const seen=[];const onUR=r=>{seen.push(String(r&&r.message||r));};
      process.on('unhandledRejection',onUR);
      try{app.run('window.doLogout()');await tick(60);await new Promise(r=>setImmediate(r));}
      finally{process.removeListener('unhandledRejection',onUR);}
      s.ok('…and the failure still surfaces as an unhandled rejection (what js/diagnostics.js records)',seen.some(m=>/network went away/.test(m)),J({seen,calls}));
    }
  }

  /* ── V8. The other tabs ─────────────────────────────────────────────── */
  s.section('V8 — the other tabs are told before Firestore stops, and a tab left with a dead Firestore goes to the login');
  {
    // The signing-out tab.
    {
      const calls=[];const BC=fakeBC(calls);const LS=memLS();
      const {app}=mk({calls,ls:LS,globals:{BroadcastChannel:BC}});
      const r=await within(app.run('window.maBooksOffDevice()'));
      s.eq('the order: queued writes, then the other tabs are told, then Firestore stops, then the copy goes',J(calls),J(['wait','broadcast u-afnan','terminate','clear']));
      let m=null;try{m=JSON.parse(LS.getItem('groovy-ma-signout'));}catch(_){}
      s.ok('…told on the channel AND in localStorage (a browser without BroadcastChannel)',!!m&&m.t==='signout'&&m.uid==='u-afnan'&&BC.inst.length===1&&BC.inst[0].name==='groovy-ma-signout',J(m));
      s.ok('(cleared)',r&&r.cleared===true,J(r));
    }
    {
      const calls=[];const BC=fakeBC(calls);
      const {app}=mk({calls,globals:{BroadcastChannel:BC,waitForPendingWrites:()=>new Promise(()=>{})}});
      await within(app.run('window.maBooksOffDevice()'));
      s.ok('writes still queued (the copy kept): the other tabs are still told — this person is signing out',calls.indexOf('broadcast u-afnan')>=0&&calls.indexOf('terminate')<0,J(calls));
    }
    // A receiving tab.
    const receiver=o=>{
      const calls=[];const BC=fakeBC(calls);const SS=memLS({u:(o&&o.who||AFNAN).u});
      const x=mk(Object.assign({calls,ss:SS,session:o&&o.who,globals:Object.assign({BroadcastChannel:BC},(o&&o.globals)||{})},(o&&o.mk)||{}));
      return Object.assign(x,{BC,SS});
    };
    const hear=(x,m)=>{try{x.BC.inst[0].onmessage({data:m});}catch(e){x.calls.push('THREW '+e.message);}};
    let x=receiver();
    hear(x,{t:'signout',uid:'u-afnan',at:1,n:'a'});await tick(5);
    s.ok('a tab signed in as the SAME person goes to the login: signed out, `u` forgotten, reloaded',J(x.calls)===J(['signOut','reload'])&&x.SS.getItem('u')===null&&x.SS.getItem('gv-no-auto-fp')==='1',J({calls:x.calls,u:x.SS.getItem('u')}));
    s.eq('…its session is gone',x.app.run('session'),null);
    x=receiver({who:MUSTAFA});
    hear(x,{t:'signout',uid:'u-afnan'});await tick(5);
    s.eq('a tab signed in as SOMEONE ELSE ignores it',J(x.calls),J([]));
    x=receiver({globals:{auth:{currentUser:null}}});x.app.run('session=null');
    hear(x,{t:'signout',uid:'u-afnan'});await tick(5);
    s.eq('a tab at the login already ignores it',J(x.calls),J([]));
    for(const bad of [null,{t:'hello',uid:'u-afnan'},{t:'signout'},{t:'signout',uid:''},'signout']){
      x=receiver();hear(x,bad);await tick(5);
      s.eq('a message that is not a sign-out ('+J(bad)+') is ignored',J(x.calls),J([]));
    }
    // localStorage, for a browser with no BroadcastChannel.
    {
      const calls=[];const SS=memLS({u:'afnan'});
      const {app}=mk({calls,ss:SS});
      const fireStorage=e=>(app.state.listeners['window:storage']||[]).forEach(fn=>fn(e));
      fireStorage({key:'something-else',newValue:J({t:'signout',uid:'u-afnan'})});
      fireStorage({key:'groovy-ma-signout',newValue:'{not json'});
      await tick(5);
      s.eq('the localStorage signal: another key or a garbled value does nothing',J(calls),J([]));
      fireStorage({key:'groovy-ma-signout',newValue:J({t:'signout',uid:'u-afnan',at:2,n:'b'})});
      await tick(5);
      s.ok('…the sign-out key sends the same person\'s tab to the login',J(calls)===J(['signOut','reload'])&&SS.getItem('u')===null,J(calls));
    }
    // The tab that is signing out never acts on its own message.
    {
      const calls=[];const BC=fakeBC(calls);
      const {app}=mk({calls,globals:{BroadcastChannel:BC,clearIndexedDbPersistence:async()=>{calls.push('clear');await tick(20);}}});
      const p=app.run('window.maBooksOffDevice()');
      await tick(2);
      try{BC.inst[0].onmessage({data:{t:'signout',uid:'u-afnan'}});}catch(e){calls.push('THREW');}
      await within(p);await tick(5);
      s.ok('the signing-out tab ignores the message it is sending (its own Sign out does the rest)',calls.indexOf('signOut')<0&&calls.indexOf('reload')<0,J(calls));
    }
    // A Firestore terminated under the tab (the database-deleted listener).
    {
      const calls=[];const SS=memLS({u:'mustafa'});
      const {app}=mk({calls,ss:SS,session:MUSTAFA});
      const fire=t=>(app.state.listeners[t]||[]).forEach(fn=>fn({}));
      fire('visibilitychange');fire('pointerdown');await tick(5);
      s.eq('(a live Firestore: coming back and tapping do nothing)',J(calls),J([]));
      app.run('db._queue={isShuttingDown:true}');
      fire('visibilitychange');await tick(5);
      s.ok('Firestore terminated under the tab: coming back to it goes to the login — whoever it belongs to',J(calls)===J(['signOut','reload'])&&SS.getItem('u')===null,J(calls));
      fire('pointerdown');fire('visibilitychange');await tick(5);
      s.eq('…once: more signals do not sign out or reload again',J(calls),J(['signOut','reload']));
    }
    {
      const calls=[];
      const {app}=mk({calls,session:MUSTAFA});
      app.run('db._queue={isShuttingDown:true}');
      (app.state.listeners['pointerdown']||[]).forEach(fn=>fn({}));await tick(5);
      s.eq('…a tap finds it too',J(calls),J(['signOut','reload']));
    }
    const rej=(app,reason)=>(app.state.listeners['window:unhandledrejection']||[]).forEach(fn=>fn({reason}));
    const err=(app,error)=>(app.state.listeners['window:error']||[]).forEach(fn=>fn({error}));
    const TERM=()=>Object.assign(new Error('The client has already been terminated.'),{code:'failed-precondition'});
    {
      const calls=[];const {app}=mk({calls,session:MUSTAFA});
      rej(app,Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'}));
      rej(app,Object.assign(new Error('Persistence can only be cleared before a Firestore instance is initialized or after it is terminated.'),{code:'failed-precondition'}));
      await tick(5);
      s.eq('an unhandled rejection that is not "terminated" does nothing',J(calls),J([]));
      rej(app,TERM());await tick(5);
      s.eq('an unhandled "The client has already been terminated." goes to the login',J(calls),J(['signOut','reload']));
    }
    {
      const calls=[];const {app}=mk({calls,session:MUSTAFA});
      err(app,TERM());await tick(5);
      s.eq('…so does an uncaught error carrying it',J(calls),J(['signOut','reload']));
    }
    {
      const calls=[];const {app}=mk({calls});app.run('session=null');
      app.run('db._queue={isShuttingDown:true}');
      rej(app,TERM());(app.state.listeners['visibilitychange']||[]).forEach(fn=>fn({}));await tick(5);
      s.eq('…but not at the login (nobody signed in)',J(calls),J([]));
    }
  }

  /* ── V9. The fingerprint unlock opens the books only on a real check ── */
  s.section('V9 — the Master Accounts fingerprint unlock: a real check or the password, never "nothing to guard"');
  {
    const mkLock=o=>{
      const calls=[];const sets=[];
      const LS=memLS(o.record?{'groovy-applock':J({'u-afnan':{id:'AAAA',u:'afnan',at:1}})}:{});
      const app=harness.loadApp({files:WITH_AUTH,currentPage:'ma-overview',session:AFNAN,
        globals:{localStorage:LS,sessionStorage:memLS({u:'afnan'}),
          crypto:{getRandomValues:a=>a},atob:v=>Buffer.from(v,'base64').toString('binary'),
          setDoc:async(ref,d)=>{sets.push(d);},
          auth:{currentUser:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{lastSignInTime:new Date(Date.now()-86400000).toUTCString()}}}}});
      app.run('session='+J(AFNAN));
      if(o.webauthn){
        app.ctx.window.PublicKeyCredential=function(){};
        const flags=o.flags;
        app.ctx.navigator.credentials={create(){},get:async()=>{calls.push('get');
          const ad=app.run('(()=>{const b=new Uint8Array(37);b[32]='+Number(flags||0)+';return b.buffer;})()');
          return {response:{authenticatorData:ad}};}};
      }
      const state=()=>{let r={};try{r={unlockedAt:app.run('_maUnlockedAt'),showing:app.run('_lockShowing'),err:app.el('ma-lock-err').textContent,msg:app.el('lock-msg').textContent};}catch(e){r={error:String(e)};}return r;};
      const audited=()=>sets.some(d=>/Unlocked with fingerprint/.test(J(d)));
      return {app,calls,LS,state,audited};
    };
    let t=mkLock({record:false,webauthn:true,flags:5});
    let ret=null;try{ret=t.app.run('window.maUnlockFinger()');}catch(e){ret='THREW '+e.message;}
    let st=t.state();
    s.ok('no lock record on this device: the fingerprint screen never comes up',ret===false&&st.showing===false,J({ret,st}));
    s.ok('…the books stay locked, nothing is audited as a fingerprint',st.unlockedAt===0&&!t.audited(),J(st));
    s.eq('…and it asks for the password',st.err,'No fingerprint can be checked on this device — type your password.');
    t=mkLock({record:true,webauthn:false});
    try{ret=t.app.run('window.maUnlockFinger()');}catch(e){ret='THREW '+e.message;}
    st=t.state();
    s.ok('a lock record but no WebAuthn in this browser: the same',ret===false&&st.showing===false&&st.unlockedAt===0&&st.err==='No fingerprint can be checked on this device — type your password.',J({ret,st}));
    // The review's reach: the record removed between the screen and the tap.
    t=mkLock({record:true,webauthn:true,flags:5});
    try{ret=t.app.run('window.maUnlockFinger()');}catch(e){ret='THREW '+e.message;}
    s.ok('(the fingerprint screen is up)',ret===true&&t.state().showing===true,J({ret,st:t.state()}));
    t.LS.removeItem('groovy-applock');
    await within(t.app.run('window.lockUnlock()'));
    st=t.state();
    s.ok('the lock record gone before the tap ("nothing to guard"): the books stay locked',st.unlockedAt===0&&!t.audited(),J(st));
    s.eq('…and it asks for the password',st.err,'Your fingerprint was not checked — type your password.');
    // A real check.
    t=mkLock({record:true,webauthn:true,flags:5});
    t.app.run('window.maUnlockFinger()');
    await within(t.app.run('window.lockUnlock()'));
    st=t.state();
    s.ok('a verified fingerprint (the UV bit): the books open, audited as a fingerprint',st.unlockedAt>0&&t.audited()&&t.calls.indexOf('get')>=0,J(st));
    // Presence alone is not a fingerprint.
    t=mkLock({record:true,webauthn:true,flags:1});
    t.app.run('window.maUnlockFinger()');
    await within(t.app.run('window.lockUnlock()'));
    st=t.state();
    s.ok('a touch without verification (UP only): still locked, the lock stays up and says so',st.unlockedAt===0&&st.showing===true&&st.msg==='Your fingerprint was not checked. Try again.',J(st));
    // The app lock itself keeps its rule: never strand anyone.
    t=mkLock({record:false,webauthn:true});
    const opened=[];t.app.ctx.__opened=opened;
    t.app.run('_lockShow(session,()=>{__opened.push("startApp");})');
    await within(t.app.run('window.lockUnlock()'));
    s.eq('the APP lock with its record gone still lets the person in (its callback ignores the answer)',J(opened),J(['startApp']));
    let v='unset';t.app.ctx.__v=x=>{v=x;};
    t.app.run('_lockShow(session,x=>__v(x));_lockDone()');
    s.eq('…and _lockDone says "verified" only when told so',v,false);
  }

  /* ── V11. A terminate that never settles ────────────────────────────── */
  s.section('V11 — a terminate that never settles is bounded like the other two steps');
  {
    const hang=calls=>({terminate:()=>{calls.push('terminate');return new Promise(()=>{});}});
    {
      const calls=[];const {app}=mk({calls,globals:hang(calls)});
      const r=await within(app.run('window.maBooksOffDevice()'));
      s.ok('Sign out: answers "stay" instead of waiting for ever',r!=='TIMEOUT'&&r&&r.stay===true&&calls.indexOf('clear')<0,J({r,calls}));
      s.ok('…and says the person is still signed in',calls.some(c=>/you are still signed in/.test(c)),J(calls));
    }
    {
      const calls=[];const {app}=mk({calls,globals:hang(calls)});
      const r=await within(app.run('window.maBooksOffDevice({leaving:true})'));
      s.ok('the lock\'s way out: "stay", phrased as signed out with the copy left',r&&r.stay===true&&calls.some(c=>/^alert: You are signed out — but the books could not be taken off this device/.test(c)),J({r,calls}));
    }
    {
      const calls=[];const {app}=mk({calls,files:WITH_AUTH,globals:hang(calls)});
      app.run('_lockShow(session,null)');
      const r=await within(app.run('window.lockUsePassword()'));
      s.ok('"Use password instead" with a hung terminate still signs out',r!=='TIMEOUT'&&calls.indexOf('signOut')>0&&calls[calls.length-1]==='reload',J(calls));
    }
    {
      const calls=[];const {app}=mk({calls,files:WITH_AUTH,globals:hang(calls)});
      const r=await within(app.run('window.doLogout()'));
      s.ok('Sign out with a hung terminate: reloads, still signed in (stay)',r!=='TIMEOUT'&&calls.indexOf('signOut')<0&&calls[calls.length-1]==='reload',J(calls));
    }
  }

  /* ── V3. The rules and the client say the same thing ────────────────── */
  s.section('V3 — what firestore.rules now checks mirrors js/ma-core.js');
  {
    const rules=read('firestore.rules');
    const {app}=mk();
    const fn=name=>{const i=rules.indexOf('function '+name+'(');if(i<0)return '';let d=0,j=rules.indexOf('{',i);for(let k=j;k<rules.length;k++){if(rules[k]==='{')d++;else if(rules[k]==='}'){d--;if(!d)return rules.slice(i,k+1);}}return '';};
    const shape=fn('maShapeOk');
    const kindsM=/in \[([^\]]*)\]\)\s*\|\|\s*maCodeOk\(d\.get\('holder'/.exec(shape);
    const ruleKinds=kindsM?kindsM[1].split(',').map(x=>x.trim().replace(/'/g,'')).filter(Boolean).sort():null;
    const clientKinds=JSON.parse(app.run('JSON.stringify(Object.keys(MA_JOURNAL_KINDS).filter(k=>MA_JOURNAL_KINDS[k].holder).sort())'));
    s.eq('the journal kinds whose holder must be a code are MA_JOURNAL_KINDS\' holder kinds',J(ruleKinds),J(clientKinds));
    const codeM=/function maCodeOk\(c\)\s*\{[^}]*matches\('([^']+)'\)/.exec(rules);
    let re=null;try{re=codeM?new RegExp(codeM[1]):null;}catch(_){re=null;}
    const samples=['1010','1011','9999','1000','0101','101','10100','1010 ',' 1010','1a10','S1010','','10-1'];
    const bad=samples.filter(v=>!re||re.test(v)!==app.run('maCodeOk('+J(v)+',"groovy")'));
    s.ok('the rules\' code shape accepts and refuses what maCodeOk does (groovy book)',!!re&&!bad.length,J({pattern:codeM&&codeM[1],bad}));
    s.ok('…and the rules require a STRING (the number 1010 is no code)',/function maCodeOk\(c\)\s*\{\s*return c is string && /.test(rules));
    const goM=/function maGoLive\(\)[\s\S]*?:\s*'(\d{4}-\d{2}-\d{2})'/.exec(fn('maGoLive'));
    s.eq('the rules\' go-live default is MA_DEFAULT_SETTINGS.goLive',goM&&goM[1],app.run('MA_DEFAULT_SETTINGS.goLive'));
    s.ok('…read from ma_settings/main.goLive, the document maSettings reads',/ma_settings\/main/.test(fn('maGoLive'))&&/get\('goLive'/.test(fn('maGoLive')));
    s.ok('the builder derives historical the way the rules check it (date before goLive)',/historical:maIsDay\(date\)&&date<s\.goLive/.test(read('js/ma-core.js'))&&/n\.historical == \(n\.date < maGoLive\(\)\)/.test(fn('maEditOk')));
    s.ok('every create and every edit keeps the shape (maShapeOk in maDocCreateOk and maEditOk)',/maShapeOk\(dt, d\)/.test(fn('maDocCreateOk'))&&/maShapeOk\(dt, n\)/.test(fn('maEditOk')));
    const winEdit=/math\.abs\(n\.edits\[o\.edits\.size\(\)\]\.at - request\.time\.toMillis\(\)\) <= (\d+)/.exec(fn('maEditOk'));
    const winAudit=/match \/ma_audit\/\{id\}[\s\S]*?math\.abs\(request\.resource\.data\.at - request\.time\.toMillis\(\)\) <= (\d+)/.exec(rules);
    s.ok('an edit row is written NOW: the same window as an audit row',!!winEdit&&!!winAudit&&winEdit[1]===winAudit[1],J({edit:winEdit&&winEdit[1],audit:winAudit&&winAudit[1]}));
    s.ok('…and it names only fields an edit may change',/n\.edits\[o\.edits\.size\(\)\]\.fields\.hasOnly\(editable\)/.test(fn('maEditOk')));
    // The page stamps every edit row with the clock (so the window holds).
    const page=read('js/master-accounts.js');
    const calls=page.split('\n').filter(l=>/maApplyEdit\(/.test(l));
    const stamped=calls.filter(l=>/\{at:Date\.now\(\)/.test(l)||/_maMeta\(\)/.test(l));
    s.ok('every edit the page writes stamps its row with the clock (at:Date.now() or _maMeta())',calls.length>0&&stamped.length===calls.length,J(calls.map(l=>l.trim().slice(0,90))));
    s.ok('…_maMeta carries at:Date.now()',/function _maMeta\(\)\{return \{[^}]*at:Date\.now\(\)/.test(page));
  }

  return s;
};

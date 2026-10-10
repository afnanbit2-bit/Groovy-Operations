/* ─────────────────────────────────────────────────────────────────────────
   Inventory Intel's saved copy comes off the device at sign-out (js/auth.js)

   Inventory Intel keeps loaded orders (customer-linked line items) in
   IndexedDB through window.siCache (js/si-cache.js). That is business data
   left on a phone, so Sign out removes it, the way it already takes the
   Master Accounts books off the device. What is held here:

   S1  Sign out (doLogout) and "Use password instead" (lockUsePassword) each
       call window.siCache.clear() ONCE, before signOut and the reload.
   S2  It never blocks or strands a sign-out: clear() rejecting, throwing,
       never settling (bounded at ~3 s), or siCache being undefined all fall
       through to signOut + reload. A clear that did not finish leaves a
       "pending" flag, and the next page load tries again.
   S3  One way out per tab: a double press (or Sign out then "Use password
       instead") clears once and signs out once.
   S4  Sign out that STAYS (another tab holds the books) clears nothing and
       tells nobody — the person is still signed in.
   S5  The other tabs: Sign out tells them through a localStorage key; a tab
       signed in as the SAME person clears the copy too and goes to the
       login; a tab for someone else, one at the login, a garbled value or
       another key does nothing.

   The scenarios are one function of the auth.js SOURCE, so the same checks
   run against copies of the source with one piece reverted: each revert
   must fail a named check ("the break landed" is asserted too).
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const harness=require('./harness');
const {suite,ROOT}=harness;
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(ROOT,'js/auth.js'),'utf8');
const tick=ms=>new Promise(r=>setTimeout(r,ms||0));
const within=(p,ms)=>Promise.race([Promise.resolve(p),tick(ms||1500).then(()=>'TIMEOUT')]);
function memLS(init){
  const m=Object.assign({},init||{});
  return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];},
    clear(){Object.keys(m).forEach(k=>{delete m[k];});},_m:m};
}
const AFNAN={uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'};
const AMMAR={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'};

/* One tab running `src` (js/auth.js, possibly with a piece reverted).
   siCache: undefined | 'ok' | 'reject' | 'throw' | 'hang'. Timers: the 3 s
   bound and the 2 s retry are shortened 100x so the suite stays quick. */
function tab(src,o){
  o=o||{};
  const calls=o.calls||[];
  const SS=o.ss||memLS({u:'afnan'});
  const LS=o.ls||memLS({'groovy-keep-signed-in':'1','groovy_remembered_user':'afnan'});
  const who=o.who||AFNAN;
  const g={
    localStorage:LS,sessionStorage:SS,
    auth:o.auth||{currentUser:{uid:who.uid,email:who.email}},
    signOut:async()=>{calls.push('signOut');},
    location:{origin:'https://x',pathname:'/',hash:'',reload(){calls.push('reload');}},
    setTimeout:(fn,ms)=>setTimeout(fn,ms>=1000?ms/100:ms)
  };
  const app=harness.loadApp({files:[],currentPage:'dashboard',session:who,
    USER_DEFS:[{u:'afnan',name:'Afnan',email:'afnan@groovy.op',role:'owner'},{u:'ammar',name:'Ammar',email:'ammar@groovy.op',role:'owner'}],
    globals:Object.assign({btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
      crypto:{getRandomValues:a=>a},Uint8Array,Buffer},g,o.globals||{})});
  const mode=o.si;
  if(mode){
    app.ctx.window.siCache={clear(){
      calls.push('siClear');
      if(mode==='throw')throw new Error('sync boom');
      if(mode==='reject')return Promise.reject(new Error('idb refused'));
      if(mode==='hang')return new Promise(()=>{});
      if(mode==='false')return Promise.resolve(false);   // what js/si-cache.js does when IndexedDB refuses
      return Promise.resolve();
    }};
  }
  vm.runInContext(src,app.ctx,{filename:'auth.js'});
  app.run('session='+J(who));
  return{app,calls,SS,LS,fire:e=>(app.state.listeners['window:storage']||[]).forEach(fn=>fn(e))};
}
const count=(a,x)=>a.filter(c=>c===x).length;

/* Every check as a named boolean, so a reverted source can be asked "which
   of these fail?" */
async function scenarios(src){
  const r={};
  // S1
  {const t=tab(src,{si:'ok'});await within(t.app.run('window.doLogout()'));
   r['S1 Sign out: clear once, before signOut and the reload']=J(t.calls)===J(['siClear','signOut','reload']);
   r['S1 Sign out: no pending flag after a clean clear']=t.LS.getItem('groovy-si-clear-pending')===null;}
  {const t=tab(src,{si:'ok'});t.app.run('_lockShow(session,null)');await within(t.app.run('window.lockUsePassword()'));
   r['S1 Use password instead: clear once, before signOut and the reload']=J(t.calls)===J(['siClear','signOut','reload']);}
  // S2
  for(const m of ['reject','throw']){
    const t=tab(src,{si:m});await within(t.app.run('window.doLogout()'));
    r['S2 clear() '+(m==='reject'?'rejecting':'throwing')+' still signs out']=J(t.calls)===J(['siClear','signOut','reload']);
    r['S2 clear() '+(m==='reject'?'rejecting':'throwing')+' leaves the pending flag']=t.LS.getItem('groovy-si-clear-pending')==='1';
    const u=tab(src,{si:m});u.app.run('_lockShow(session,null)');await within(u.app.run('window.lockUsePassword()'));
    r['S2 clear() '+(m==='reject'?'rejecting':'throwing')+' still signs out from the lock']=J(u.calls)===J(['siClear','signOut','reload']);
  }
  {const t=tab(src,{si:'false'});await within(t.app.run('window.doLogout()'));
   r['S2 clear() resolving false (what si-cache.js does on failure) still signs out']=J(t.calls)===J(['siClear','signOut','reload']);
   r['S2 clear() resolving false leaves the pending flag']=t.LS.getItem('groovy-si-clear-pending')==='1';}
  {const t=tab(src,{si:'hang'});const x=await within(t.app.run('window.doLogout()'),2000);
   r['S2 clear() never settling is bounded: sign-out completes']=x!=='TIMEOUT'&&J(t.calls)===J(['siClear','signOut','reload']);
   r['S2 clear() never settling leaves the pending flag']=t.LS.getItem('groovy-si-clear-pending')==='1';
   const u=tab(src,{si:'hang'});u.app.run('_lockShow(session,null)');const y=await within(u.app.run('window.lockUsePassword()'),2000);
   r['S2 clear() never settling is bounded from the lock too']=y!=='TIMEOUT'&&J(u.calls)===J(['siClear','signOut','reload']);}
  {const t=tab(src,{});await within(t.app.run('window.doLogout()'));
   r['S2 siCache undefined: plain sign-out']=J(t.calls)===J(['signOut','reload']);
   r['S2 siCache undefined: nothing broadcast, no flag']=t.LS.getItem('groovy-si-signout')===null&&t.LS.getItem('groovy-si-clear-pending')===null;
   const u=tab(src,{});u.app.run('_lockShow(session,null)');await within(u.app.run('window.lockUsePassword()'));
   r['S2 siCache undefined: plain sign-out from the lock']=J(u.calls)===J(['signOut','reload']);}
  {const t=tab(src,{si:'ok',globals:{}});t.app.ctx.window.siCache={};await within(t.app.run('window.doLogout()'));
   r['S2 siCache without clear(): plain sign-out']=J(t.calls)===J(['signOut','reload']);}
  // pending flag retried at the next load
  {const LS=memLS({'groovy-si-clear-pending':'1'});const calls=[];
   const t=tab(src,{si:'ok',ls:LS,calls});await tick(60);
   r['S2 a pending clear is retried at the next load']=count(calls,'siClear')===1;
   r['S2 …and the flag is dropped once it worked']=LS.getItem('groovy-si-clear-pending')===null;}
  {const LS=memLS({});const calls=[];tab(src,{si:'ok',ls:LS,calls});await tick(60);
   r['S2 no pending flag: nothing is cleared at load']=count(calls,'siClear')===0;}
  // S3
  {const t=tab(src,{si:'ok'});
   const p1=t.app.run('window.doLogout()');const p2=t.app.run('window.doLogout()');const p3=t.app.run('window.lockUsePassword()');
   await within(Promise.all([p1,p2,p3]));await tick(10);
   r['S3 pressed three ways at once: one clear, one signOut, one reload']=count(t.calls,'siClear')===1&&count(t.calls,'signOut')===1&&count(t.calls,'reload')===1;
   r['S3 …and the later presses get the first one\'s promise']=p1===p2&&p1===p3;}
  {const t=tab(src,{si:'hang'});
   const p1=t.app.run('window.doLogout()');await tick(5);const p2=t.app.run('window.doLogout()');
   await within(Promise.all([p1,p2]),2000);
   r['S3 a second press while the first clear is still running does not clear again']=count(t.calls,'siClear')===1&&count(t.calls,'signOut')===1;}
  // S4
  {const t=tab(src,{si:'ok'});t.app.ctx.window.maBooksOffDevice=async()=>{t.calls.push('books');return{stay:true};};
   await within(t.app.run('window.doLogout()'));
   r['S4 Sign out that stays: no clear, no broadcast, no signOut']=J(t.calls)===J(['books','reload'])&&t.LS.getItem('groovy-si-signout')===null;}
  {const t=tab(src,{si:'ok'});t.app.ctx.window.maBooksOffDevice=async()=>{t.calls.push('books');return{cleared:true};};
   await within(t.app.run('window.doLogout()'));
   r['S4 books answer cleared: books, then clear, then signOut']=J(t.calls)===J(['books','siClear','signOut','reload']);}
  // S5 sender
  {const t=tab(src,{si:'ok'});
   t.app.ctx.window.siCache.clear=()=>{t.calls.push('siClear');t.calls.push('key='+(t.LS.getItem('groovy-si-signout')?'set':'unset'));return Promise.resolve();};
   await within(t.app.run('window.doLogout()'));
   let m=null;try{m=JSON.parse(t.LS.getItem('groovy-si-signout'));}catch(_){}
   r['S5 Sign out tells the other tabs (this person\'s uid) before it clears']=!!m&&m.uid==='u-afnan'&&t.calls[1]==='key=set';}
  // S5 receivers
  const heard=(uid,o)=>{const t=tab(src,Object.assign({si:'ok'},o||{}));t.fire({key:'groovy-si-signout',newValue:J({uid,at:1,n:'a'})});return t;};
  {const t=heard('u-afnan');await tick(30);
   r['S5 same person\'s other tab: clears, signs out, reloads']=J(t.calls)===J(['siClear','signOut','reload']);
   r['S5 …forgets `u` (a cold start) and the session']=t.SS.getItem('u')===null&&t.app.run('session')===null;}
  {const t=heard('u-afnan',{si:'reject'});await tick(30);
   r['S5 other tab with a failing clear still goes to the login']=J(t.calls)===J(['siClear','signOut','reload'])&&t.LS.getItem('groovy-si-clear-pending')==='1';}
  {const t=heard('u-afnan',{si:'hang'});await tick(80);
   r['S5 other tab with a hanging clear still goes to the login']=J(t.calls)===J(['siClear','signOut','reload']);}
  {const t=heard('u-afnan',{si:null});await tick(30);
   r['S5 other tab with no siCache still goes to the login']=J(t.calls)===J(['signOut','reload']);}
  {const t=heard('u-ammar');await tick(30);
   r['S5 a tab signed in as SOMEONE ELSE ignores it']=J(t.calls)===J([]);}
  {const t=tab(src,{si:'ok',auth:{currentUser:null}});t.app.run('session=null');
   t.fire({key:'groovy-si-signout',newValue:J({uid:'u-afnan'})});await tick(30);
   r['S5 a tab at the login ignores it']=J(t.calls)===J([]);}
  {const t=tab(src,{si:'ok'});
   t.fire({key:'other-key',newValue:J({uid:'u-afnan'})});t.fire({key:'groovy-si-signout',newValue:'{not json'});
   t.fire({key:'groovy-si-signout',newValue:null});t.fire({key:'groovy-si-signout',newValue:J({})});t.fire({key:'groovy-si-signout',newValue:J({uid:7})});
   await tick(30);
   r['S5 another key, garbled, empty or uid-less values do nothing']=J(t.calls)===J([]);}
  {const t=heard('u-afnan');t.fire({key:'groovy-si-signout',newValue:J({uid:'u-afnan'})});await tick(30);
   r['S5 told twice: still one clear and one sign-out']=count(t.calls,'siClear')===1&&count(t.calls,'signOut')===1;}
  // S7 the sign-out flag and the stock-history copy
  for(const [nm,run,pre] of [['Sign out','window.doLogout()',''],['Use password instead','window.lockUsePassword()','_lockShow(session,null)']]){
    const LS=memLS({'groovy-si-histfold':'{}'});let flagAtClear=null;
    const t=tab(src,{si:'ok',ls:LS});
    t.app.ctx.window.siCache.clear=()=>{flagAtClear=t.app.ctx.window.__gvSignOutStarted;return Promise.resolve();};
    if(pre)t.app.run(pre);
    await within(t.app.run(run));
    r['S7 '+nm+': __gvSignOutStarted is set before clear()']=flagAtClear===true;
    r['S7 '+nm+': groovy-si-histfold is removed']=LS.getItem('groovy-si-histfold')===null;
  }
  {const LS=memLS({'groovy-si-histfold':'{}'});let flagAtClear=null;
   const t=tab(src,{si:'ok',ls:LS});t.app.ctx.window.siCache.clear=()=>{flagAtClear=t.app.ctx.window.__gvSignOutStarted;return Promise.resolve();};
   t.fire({key:'groovy-si-signout',newValue:J({uid:'u-afnan'})});await tick(30);
   r['S7 other tab: flag set before clear() and histfold removed']=flagAtClear===true&&LS.getItem('groovy-si-histfold')===null;}
  {const t=tab(src,{si:'ok'});t.app.ctx.window.maBooksOffDevice=async()=>({stay:true});
   await within(t.app.run('window.doLogout()'));
   r['S7 a "stay" sign-out sets no flag']=t.app.ctx.window.__gvSignOutStarted!==true;}
  {const LS=memLS({'groovy-si-histfold':'{}'});const t=tab(src,{si:'ok',ls:LS,globals:{localStorage:Object.assign(LS,{removeItem(){throw new Error('blocked');}})}});
   await within(t.app.run('window.doLogout()'));
   r['S7 a localStorage that throws never blocks sign-out']=J(t.calls)===J(['siClear','signOut','reload']);}
  r['S7 startApp resets the flag (source)']=/__gvSignOutStarted=false;\}catch\(_\)\{\}[^\n]*\n\s*_authSiOwnerCheck/.test(src);
  // S6 a different account on the same device
  {const LS=memLS({}),calls=[];const t=tab(src,{si:'ok',ls:LS,calls});
   t.app.run('_authSiOwnerCheck("u-afnan")');await tick(5);
   r['S6 first start-up of an account on this device clears the saved copy once']=count(calls,'siClear')===1&&LS.getItem('groovy-si-owner')==='u-afnan';
   t.app.run('_authSiOwnerCheck("u-afnan")');await tick(5);
   r['S6 the same account again: nothing cleared']=count(calls,'siClear')===1;
   t.app.run('_authSiOwnerCheck("u-ammar")');await tick(5);
   r['S6 a DIFFERENT account on the same device: the previous copy is cleared']=count(calls,'siClear')===2&&LS.getItem('groovy-si-owner')==='u-ammar';}
  {const LS=memLS({}),calls=[];const t=tab(src,{si:'hang',ls:LS,calls});
   const x=t.app.run('_authSiOwnerCheck("u-ammar")');
   r['S6 the check never blocks start-up (returns at once, even if clear() hangs)']=x===undefined;}
  {const calls=[];const t=tab(src,{ls:memLS({}),calls});t.app.run('_authSiOwnerCheck("u-ammar")');await tick(5);
   r['S6 no siCache: nothing happens, nothing stored']=J(calls)===J([])&&t.LS.getItem('groovy-si-owner')===null;}
  r['S6 startApp makes the check (source)']=/sessionStorage\.setItem\('u',session\.u\);[\s\S]{0,200}_authSiOwnerCheck\(session\.uid\)/.test(src);
  return r;
}

/* Reverts: [name, from, to, the check that must fail]. `from` is replaced
   in a scratch copy of js/auth.js (all occurrences unless `first`). */
const TELL_CLEAR='_authSiTell();await _authSiClear();';
const MUTANTS=[
 ['doLogout no longer clears',TELL_CLEAR,'','S1 Sign out: clear once, before signOut and the reload',{first:true}],
 ['lockUsePassword no longer clears',TELL_CLEAR,'','S1 Use password instead: clear once, before signOut and the reload',{second:true}],
 ['the 3 s bound is removed',"new Promise(r=>{t=setTimeout(()=>r('timeout'),_SI_CLEAR_MS);})",'new Promise(()=>{})','S2 clear() never settling is bounded: sign-out completes'],
 ['a false answer counts as cleared',"v===false?'failed':'ok'","'ok'",'S2 clear() resolving false leaves the pending flag'],
 ['a rejection is allowed to propagate',".then(v=>v===false?'failed':'ok',()=>'failed')",".then(v=>v===false?'failed':'ok')",'S2 clear() rejecting still signs out'],
 ['a synchronous throw is allowed to propagate',"Promise.resolve().then(()=>c.clear())",'Promise.resolve(c.clear())','S2 clear() throwing still signs out'],
 ['the typeof guard on siCache is removed',"if(!c||typeof c.clear!=='function')return 'absent';",'','S2 siCache undefined: nothing broadcast, no flag'],
 ['a failed clear leaves no pending flag',"else{try{localStorage.setItem(_SI_PENDING_KEY,'1');}catch(_){}}",'else{}','S2 clear() rejecting leaves the pending flag'],
 ['the retry at load is removed',"if(localStorage.getItem(_SI_PENDING_KEY)==='1')setTimeout(()=>{_authSiClear();},2000);",'','S2 a pending clear is retried at the next load'],
 ['one way out per tab is undone',"if(!_authLeaving)_authLeaving=",'_authLeaving=','S3 pressed three ways at once: one clear, one signOut, one reload'],
 ['the clear runs before the books answer "stay"',"if(r&&r.stay){","await _authSiClear();if(r&&r.stay){",'S4 Sign out that stays: no clear, no broadcast, no signOut'],
 ['the other tabs are not told',"_authSiTell();",'','S5 Sign out tells the other tabs (this person\'s uid) before it clears'],
 ['the storage listener does nothing',"      _authSiHeard(m);",'      void m;','S5 same person\'s other tab: clears, signs out, reloads'],
 ['the uid check is removed',"if(!mine||m.uid!==mine)return false;",'if(false)return false;','S5 a tab signed in as SOMEONE ELSE ignores it'],
 ['the other tab no longer clears',"      await _authSiClear();\n      try{sessionStorage.removeItem('u');sessionStorage.setItem('gv-no-auto-fp','1');}","      try{sessionStorage.removeItem('u');sessionStorage.setItem('gv-no-auto-fp','1');}",'S5 same person\'s other tab: clears, signs out, reloads']
 ,['a different account no longer clears the old copy',"if(prev===String(uid))return;","return;",'S6 a DIFFERENT account on the same device: the previous copy is cleared'],
 ['startApp no longer makes the owner check',"_authSiOwnerCheck(session.uid);","",'S6 startApp makes the check (source)']
 ,['the flag is never set',"try{window.__gvSignOutStarted=true;}catch(_){}","",'S7 Sign out: __gvSignOutStarted is set before clear()'],
 ['the flag is set after the clear',"_authSiStart();_authSiTell();await _authSiClear();","_authSiTell();await _authSiClear();_authSiStart();",'S7 Use password instead: __gvSignOutStarted is set before clear()',{second:true}],
 ['the stock-history copy is kept',"try{localStorage.removeItem('groovy-si-histfold');}catch(_){}","",'S7 Sign out: groovy-si-histfold is removed'],
 ['the other tab does not set the flag',"      _authSiStart();\n","",'S7 other tab: flag set before clear() and histfold removed'],
 ['startApp does not reset the flag',"try{window.__gvSignOutStarted=false;}catch(_){}","",'S7 startApp resets the flag (source)']
];
function mutate(src,m){
  const [,from,to,,opt]=m;
  const hay=src.replace(/\r\n/g,'\n');
  if(opt&&(opt.first||opt.second)){
    let i=hay.indexOf(from);
    if(i<0)return null;
    if(opt.second)i=hay.indexOf(from,i+1);
    if(i<0)return null;
    return hay.slice(0,i)+to+hay.slice(i+from.length);
  }
  if(hay.indexOf(from)<0)return null;
  return hay.split(from).join(to);
}

module.exports=async function(){
  const s=suite('si-cache-signout');
  s.section('Inventory Intel\'s saved copy at sign-out — the real js/auth.js against a fake window.siCache');
  const real=await scenarios(SRC.replace(/\r\n/g,'\n'));
  for(const k of Object.keys(real))s.ok(k,real[k]===true);
  s.ok('(the scenarios ran: '+Object.keys(real).length+' checks)',Object.keys(real).length>=30,String(Object.keys(real).length));

  s.section('each piece reverted in a scratch copy fails its named check');
  for(const m of MUTANTS){
    const mut=mutate(SRC,m);
    s.ok('"'+m[0]+'": the revert landed (text found in js/auth.js)',mut!==null&&mut!==SRC.replace(/\r\n/g,'\n'));
    if(mut===null)continue;
    let res={};
    try{res=await scenarios(mut);}catch(e){res={};res['(suite crashed: '+e.message+')']=false;}
    s.ok('"'+m[0]+'": fails "'+m[3]+'"',res[m[3]]!==true,J(Object.keys(res).filter(k=>res[k]!==true)));
  }
  return s;
};

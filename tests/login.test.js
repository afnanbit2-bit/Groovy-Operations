/* ─────────────────────────────────────────────────────────────────────────
   Login, "Remember me" and the fingerprint app lock — js/auth.js

   The three rules the section in js/auth.js holds, each asserted here:
   1. The app never stores a password (only the phone's password manager
      is offered it, and only when Remember me is ticked).
   2. Remember me means STAY SIGNED IN — the restore decision reads the
      signed-in email and the person's choice, not one tab's
      sessionStorage (which a phone clears whenever the app is closed).
   3. The lock opens only on a VERIFIED user (fingerprint/face/PIN), never
      on mere presence, and never strands anyone.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

const DEFS=[
  {u:'afnan',name:'Afnan',email:'afnan@groovy.op',role:'owner',title:'Co-Founder'},
  {u:'ammar',name:'Ammar',email:'ammar@groovy.op',role:'owner',title:'Co-Founder'},
  {u:'uzaib',name:'Uzaib',email:'uzaib@groovy.op',role:'viewer',title:'Supervisor'}
];

function memStore(init){
  const m=Object.assign({},init||{});
  return{m,getItem:k=>Object.prototype.hasOwnProperty.call(m,k)?m[k]:null,
    setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];},clear:()=>{for(const k in m)delete m[k];}};
}

function boot(extra){
  const ls=memStore(extra&&extra.ls);
  const rec={persist:[],stored:[],signIns:[],started:0,creates:[],gets:[]};
  const getResult={v:null};
  const app=loadApp({files:['js/auth.js'],USER_DEFS:DEFS,globals:Object.assign({
    localStorage:ls,
    sessionStorage:memStore(),
    btoa:s=>Buffer.from(s,'binary').toString('base64'),
    atob:s=>Buffer.from(s,'base64').toString('binary'),
    crypto:{getRandomValues:a=>{for(let i=0;i<a.length;i++)a[i]=i;return a;}},
    Uint8Array,Buffer,
    setPersistence:async(a,p)=>{rec.persist.push(p);},
    browserLocalPersistence:'LOCAL',browserSessionPersistence:'SESSION',
    signInWithEmailAndPassword:async(a,email,p)=>{rec.signIns.push(email);return{user:{uid:'uid-'+email.split('@')[0]}};},
    signOut:async()=>{},
    navigator:{credentials:{
      store:async c=>{rec.stored.push(c);},
      create:async o=>{rec.creates.push(o);return{rawId:new Uint8Array([1,2,3,250]).buffer};},
      get:async o=>{rec.gets.push(o);return getResult.v;}
    }},
    window:{PasswordCredential:function(d){Object.assign(this,d);},
      PublicKeyCredential:{isUserVerifyingPlatformAuthenticatorAvailable:async()=>true},
      isSecureContext:true,addEventListener(){},matchMedia:()=>({matches:false})}
  },(extra&&extra.globals)||{})});
  app.run('session=null;startApp=function(){__started++};var __started=0;');
  return{app,ls,rec,getResult,run:app.run};
}

module.exports=async function(){
  const s=suite('login');

  // ── the restore decision ──────────────────────────────────────────────
  {
    const {run}=boot();
    const D=(email,tab,flag,rem)=>run(`JSON.stringify(_authRestoreDecision({email:${JSON.stringify(email)}},${JSON.stringify(tab)},${JSON.stringify(flag)},${JSON.stringify(rem)}))`);
    const d=x=>JSON.parse(x);
    s.section('Remember me keeps a phone signed in (it used to need one tab\'s sessionStorage)');
    let r=d(D('afnan@groovy.op',null,'1',null));
    s.eq('a fresh app open with Remember me restores the account',r.allow,true);
    s.eq('… found by EMAIL, not by the tab',r.def&&r.def.u,'afnan');
    s.eq('… and it is a cold open, where the lock applies',r.cold,true);
    s.eq('Remember me unticked: a fresh open does not restore',d(D('afnan@groovy.op',null,'0',null)).allow,false);
    s.eq('a reload in the same tab always restores, whatever the box said',d(D('afnan@groovy.op','afnan','0',null)).allow,true);
    s.eq('… and a reload is not a cold open (no lock on every refresh)',d(D('afnan@groovy.op','afnan','0',null)).cold,false);
    s.eq('email matching ignores case',d(D('Ammar@Groovy.OP',null,'1',null)).def.u,'ammar');
    s.eq('an unknown email is never let in',d(D('stranger@x.com',null,'1',null)).allow,false);
    s.section('sessions signed in on the OLD build (no flag stored)');
    s.eq('kept when the old build remembered this username',d(D('uzaib@groovy.op',null,null,'uzaib')).allow,true);
    s.eq('not kept when it remembered someone else',d(D('uzaib@groovy.op',null,null,'afnan')).allow,false);
    s.eq('not kept when it remembered nobody',d(D('uzaib@groovy.op',null,null,null)).allow,false);
  }

  // ── signing in ────────────────────────────────────────────────────────
  for(const keep of [true,false]){
    const {app,ls,rec,run}=boot({ls:{groovy_remembered_user:'ammar'}});
    app.el('l-user').value='Afnan ';app.el('l-pass').value='s3cret-PASS';
    app.el('l-remember').checked=keep;
    await run('window.doLogin()');
    s.section('sign in with Remember me '+(keep?'TICKED':'UNTICKED'));
    s.eq('signed in as the account\'s email',rec.signIns[0],'afnan@groovy.op');
    s.eq('persistence set to '+(keep?'LOCAL (survives closing the app)':'SESSION (ends with the tab)'),rec.persist[0],keep?'LOCAL':'SESSION');
    s.eq('the choice is recorded for the next open',ls.m['groovy-keep-signed-in'],keep?'1':'0');
    s.eq('remembered username',ls.m.groovy_remembered_user||null,keep?'afnan':null);
    s.eq(keep?'the phone\'s password manager is OFFERED the password':'nothing is offered to a password manager on a shared device',rec.stored.length,keep?1:0);
    if(keep)s.eq('… under the username, which is what the login field takes',rec.stored[0]&&rec.stored[0].id,'afnan');
    s.ok('the password is NOWHERE in app storage',!JSON.stringify(ls.m).includes('s3cret-PASS'));
    s.eq('the app started',run('__started'),1);
  }

  // ── the user-verified flag ────────────────────────────────────────────
  {
    const {run}=boot();
    const ad=flags=>`(function(){var a=new Uint8Array(37);a[32]=${flags};return a.buffer})()`;
    s.section('the lock opens on a VERIFIED user, never on mere presence');
    s.eq('UP+UV (fingerprint checked) opens',run(`_lockUserVerified(${ad(0x05)})`),true);
    s.eq('UP only (a tap) does not',run(`_lockUserVerified(${ad(0x01)})`),false);
    s.eq('short / garbage data does not',run(`_lockUserVerified(new Uint8Array(10).buffer)`),false);
    s.eq('nothing does not',run(`_lockUserVerified(null)`),false);
  }

  // ── turning the lock on, and unlocking ────────────────────────────────
  {
    const {run,ls,rec,getResult}=boot();
    run(`session={u:'afnan',name:'Afnan',uid:'uid-afnan'}`);
    s.section('turning the lock on');
    s.eq('off before',run(`lockEnabledFor('uid-afnan')`),false);
    s.eq('enable resolves true',await run('window.lockEnable()'),true);
    const o=rec.creates[0]&&rec.creates[0].publicKey;
    s.eq('asks for the PHONE\'S own authenticator',o&&o.authenticatorSelection.authenticatorAttachment,'platform');
    s.eq('… with the user VERIFIED (fingerprint/face/PIN)',o&&o.authenticatorSelection.userVerification,'required');
    s.eq('on for this person on this device',run(`lockEnabledFor('uid-afnan')`),true);
    s.eq('… and not for anyone else',run(`lockEnabledFor('uid-ammar')`),false);
    s.ok('nothing but a credential id is stored',!/pass/i.test(ls.m['groovy-applock']||''));

    s.section('unlocking');
    run('var __unlocked=0;_lockShow(session,function(){__unlocked++})');
    const ad=f=>{const a=new Uint8Array(37);a[32]=f;return a.buffer;};
    getResult.v={response:{authenticatorData:ad(0x01)}};
    await run('window.lockUnlock()');
    s.eq('presence without verification stays locked',run('__unlocked'),0);
    s.ok('… and says why',/not checked/i.test(run(`document.getElementById('lock-msg').textContent`)));
    const lastGet=rec.gets[rec.gets.length-1].publicKey;
    s.eq('the unlock asks for THIS phone\'s credential only',lastGet.allowCredentials.length,1);
    s.eq('… verified',lastGet.userVerification,'required');
    getResult.v={response:{authenticatorData:ad(0x05)}};
    await run('window.lockUnlock()');
    s.eq('a verified fingerprint opens the app, once',run('__unlocked'),1);
    await run('window.lockUnlock()');
    s.eq('a second tap after unlocking does nothing',run('__unlocked'),1);

    s.section('never stranded');
    run('window.lockDisable()');
    run('_lockShow(session,function(){__unlocked++})');
    await run('window.lockUnlock()');
    s.eq('a lock whose record is gone lets the person straight in',run('__unlocked'),2);
  }

  // ── the profile switch ────────────────────────────────────────────────
  {
    const {run}=boot({globals:{}});
    s.section('the Profile card says what the lock is');
    const app2=loadApp({files:['js/auth.js','js/profile.js'],USER_DEFS:DEFS,globals:{
      localStorage:memStore(),window:{PublicKeyCredential:{},isSecureContext:true,addEventListener(){},matchMedia:()=>({matches:false})},
      navigator:{credentials:{create(){},get(){}}}
    }});
    app2.run(`session={u:'afnan',name:'Afnan',uid:'uid-afnan',role:'owner'}`);
    const html=app2.run('_profileSecurityHTML()');
    s.ok('offers Turn on where the phone can do it',/lockEnable/.test(html)&&/Turn on/.test(html));
    s.ok('says the fingerprint never leaves the phone',/never leaves the phone/.test(html));
    const app3=loadApp({files:['js/auth.js','js/profile.js'],USER_DEFS:DEFS,globals:{localStorage:memStore()}});
    app3.run(`session={u:'afnan',name:'Afnan',uid:'uid-afnan',role:'owner'}`);
    const h3=app3.run('_profileSecurityHTML()');
    s.ok('a browser without WebAuthn is told, and offered no button',/cannot do a fingerprint lock/.test(h3)&&!/lockEnable/.test(h3));
    void run;
  }

  // ── the markup a password manager needs ───────────────────────────────
  {
    const html=require('fs').readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
    const login=html.slice(html.indexOf('<div id="scr-login">'),html.indexOf('<!-- ══ APP LOCK'));
    s.section('the login is a real form a password manager can save and fill');
    s.ok('a <form> that submits to doLogin',/<form[^>]*id="login-form"[^>]*onsubmit="[^"]*doLogin/.test(login));
    s.ok('username field: autocomplete=username',/id="l-user"[^>]*autocomplete="username"/.test(login));
    s.ok('password field: autocomplete=current-password',/id="l-pass"[^>]*autocomplete="current-password"/.test(login));
    s.ok('Sign in is the submit button',/<button type="submit"[^>]*id="login-btn"/.test(login));
    s.ok('the password field no longer calls doLogin on Enter itself (the form does — twice would sign in twice)',
      !/id="l-pass"[^>]*doLogin/.test(login));
    s.ok('the lock screen exists and starts hidden',/<div id="scr-lock" hidden>/.test(html));
    s.ok('setPersistence is bridged from the Auth SDK',/setPersistence,browserLocalPersistence,browserSessionPersistence\}from'https:\/\/www\.gstatic\.com\/firebasejs\/[^']+firebase-auth\.js'/.test(html)
      &&/\n\s*setPersistence,browserLocalPersistence,browserSessionPersistence,\n/.test(html));
  }

  // ── the login screen does not scroll (Afnan's screenshot, 26 Sept) ────
  {
    const fs=require('fs'),path=require('path');
    const css=fs.readFileSync(path.join(__dirname,'..','css','main.css'),'utf8');
    const auth=fs.readFileSync(path.join(__dirname,'..','js','auth.js'),'utf8');
    const rule=(css.match(/#scr-login\{[^}]*\}/)||[''])[0];
    s.section('the login is a fixed layer; nothing behind it scrolls');
    s.ok('#scr-login is position:fixed, full height, scrolls only itself',/position:fixed/.test(rule)&&/height:100dvh/.test(rule)&&/overflow-y:auto/.test(rule));
    s.ok('… with no rubber band / pull-to-refresh',/overscroll-behavior:none/.test(rule));
    s.ok('html.gv-login stops the page behind it scrolling',/html\.gv-login,html\.gv-login body\{[^}]*overflow:hidden/.test(css));
    s.ok('the class is set on load and removed when the app starts',
      /classList\.add\('gv-login'\)/.test(auth)&&/async function startApp\(\)\{[^]*?classList\.remove\('gv-login'\)/.test(auth));
    s.ok('on a phone the card is NOT stretched (a stretched card squashed Sign in to 22px with the keyboard open)',
      /#scr-login,#scr-lock\{align-items:flex-start\}/.test(css)&&/\.login-box>\*\{flex-shrink:0\}/.test(css));
  }

  return s;
};

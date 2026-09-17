/* ─────────────────────────────────────────────────────────────────────────
   Login — the Username box accepts an email too.

   Sami's first sign-in typed `sami@groovy.ops` into a field that matched
   only USER_DEFS.u, and the app said "Username not found." before Firebase
   was asked anything. Guards: the three lookup forms (username, exact
   email, the part before an '@'), that what is SENT to Firebase is always
   the USER_DEFS email and never what was typed, that the remembered value
   is the canonical username, and that a miss is still refused before any
   network call — with a message that names what was typed.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite}=harness;

function app(){
  const store={};
  const LS={getItem:k=>(k in store?store[k]:null),setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}};
  const sent=[];
  const a=harness.loadApp({files:['js/shared.js','js/auth.js'],globals:{
    localStorage:LS,
    signInWithEmailAndPassword:async(auth,email,pass)=>{
      sent.push({email,pass});
      if(pass!=='right')throw Object.assign(new Error('bad'),{code:'auth/invalid-credential'});
      return{user:{uid:'uid-'+email}};
    }
  }});
  a.run('startApp=function(){globalThis.__started=true;}');
  a.store=store;a.sent=sent;
  return a;
}
async function login(a,user,pass,remember){
  a.el('l-user').value=user;a.el('l-pass').value=pass;
  a.el('l-remember').checked=!!remember;
  a.el('toast').textContent='';
  a.run('globalThis.__started=false');
  await a.run('window.doLogin()');
  return a.el('toast').textContent;
}

module.exports=async function(){
  const s=suite('login');

  s.section('the lookup');
  {
    const a=app();
    const r=x=>{const d=a.run('_loginResolveUser('+JSON.stringify(x)+')');return d?d.u:d;};
    s.eq('a username',r('sami'),'sami');
    s.eq('case and whitespace are forgiven',r('  SAMI '),'sami');
    s.eq('the exact email',r('sami@groovy.op'),'sami');
    s.eq('the email in any case',r('Sami@Groovy.OP'),'sami');
    s.eq('a mistyped domain resolves by the part before the @',r('sami@groovy.ops'),'sami');
    s.eq('the domain is ignored — def.email is what is sent',r('afnan@gmail.com'),'afnan');
    s.eq('an unknown username is null',r('nobody'),null);
    s.eq('an unknown email is null',r('nobody@groovy.op'),null);
    s.eq('an empty string is null',r(''),null);
    s.eq('a bare @domain is null',r('@groovy.op'),null);
    s.eq('undefined is null',a.run('_loginResolveUser(undefined)'),null);
  }

  s.section('what reaches Firebase');
  {
    const a=app();
    const toast=await login(a,'sami@groovy.ops','right',true);
    s.eq('one sign-in call',a.sent.length,1);
    s.eq('carrying the USER_DEFS email, not what was typed',a.sent[0]&&a.sent[0].email,'sami@groovy.op');
    s.eq('the session is sami',a.run('session.u'),'sami');
    s.eq('with the uid Firebase returned',a.run('session.uid'),'uid-sami@groovy.op');
    s.eq('the app started',a.run('__started'),true);
    s.eq('the remembered value is the canonical username',a.store.groovy_remembered_user,'sami');
    s.eq('no error toast',toast,'');
  }
  {
    const a=app();
    await login(a,'sami','right',false);
    s.eq('a plain username still works',a.sent[0]&&a.sent[0].email,'sami@groovy.op');
    s.ok('and nothing is remembered when the box is unticked',!('groovy_remembered_user' in a.store));
  }

  s.section('a miss is refused before any network call');
  {
    const a=app();
    const t1=await login(a,'nobody@groovy.op','right',true);
    s.eq('an unknown email makes no sign-in call',a.sent.length,0);
    s.eq('and says it was the email that missed',t1,'No account with that email.');
    s.ok('the field is marked',a.el('l-user').classList.contains('l-error'));
    const t2=await login(a,'nobody','right',true);
    s.eq('an unknown username makes no sign-in call',a.sent.length,0);
    s.eq('and says so',t2,'Username not found.');
    s.eq('the app never started',a.run('__started'),false);
  }
  {
    const a=app();
    const t=await login(a,'sami@groovy.op','wrong',true);
    s.eq('a wrong password reaches Firebase once',a.sent.length,1);
    s.ok('and is reported as a password problem',/Wrong password/.test(t));
    s.eq('the app did not start',a.run('__started'),false);
  }

  s.section('the form says so');
  {
    const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
    s.ok('the login label reads "Username or email"',/class="login-field-label">Username or email</.test(html));
  }
  return s;
};

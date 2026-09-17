/* ─────────────────────────────────────────────────────────────────────────
   Who a tab IS.

   Firebase Auth persistence is per ORIGIN; sessionStorage is per TAB. So a
   sign-in from a second tab replaces the user under the first, and until
   Sept 2026 the first tab kept its old session — "afnan" on screen, another
   account's token on every request. Guards: a restored session is resolved
   from the token's EMAIL, never the saved username; a token with no
   USER_DEFS entry is signed out, not guessed; a user change or sign-out
   under a live session raises a blocking notice, once, and never on the
   tab's own logout; and loadHRMData asks only for what the role can read.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const LS={getItem:()=>null,setItem(){},removeItem(){}};
const AFNAN={uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'};

function tab(){
  const ss={};
  const SS={getItem:k=>(k in ss?ss[k]:null),setItem(k,v){ss[k]=String(v);},removeItem(k){delete ss[k];},clear(){Object.keys(ss).forEach(k=>delete ss[k]);}};
  const t={ss,signOuts:0,reloads:0};
  const a=harness.loadApp({files:['js/shared.js','js/auth.js'],globals:{
    localStorage:LS,sessionStorage:SS,auth:{},
    signOut:async()=>{t.signOuts++;if(t.onSignOut)t.onSignOut();},
    location:{origin:'https://groovyoperations.netlify.app',pathname:'/',hash:'',reload(){t.reloads++;}}
  }});
  a.run('startApp=function(){globalThis.__started=session?session.u:null;}');
  a.run('globalThis.__started=null;session=null;loginInProgress=false;');
  t.a=a;
  t.fire=user=>a.run('_gvAuthChanged('+J(user)+')');
  t.notice=()=>a.bodyCount('gv-identity-notice');
  t.title=()=>a.el('gv-identity-title').textContent;
  t.msg=()=>a.el('gv-identity-msg').textContent;
  t.loginShown=()=>a.el('scr-login').style.display==='flex';
  return t;
}

function hrmTab(sess){
  const reads=[];
  const denied=()=>{const e=new Error('Missing or insufficient permissions.');e.code='permission-denied';return e;};
  const a=harness.loadApp({files:['js/shared.js','js/auth.js','js/hrm.js'],session:sess,globals:{
    localStorage:LS,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){},clear(){}},
    collection:(db,name)=>({name}),doc:(db,name,id)=>({name,id}),
    getDocs:async ref=>{reads.push(ref.name);
      if(ref.name==='employees')return{empty:false,docs:[{id:'e1',data:()=>({username:sess.u,name:'Me',paygrade:'G2',k40UserId:'40'})}]};
      throw denied();},
    getDoc:async ref=>{reads.push(ref.name+'/'+ref.id);
      if(ref.name==='hrm_policies'&&(sess.role==='owner'||sess.role==='manager'))return{exists:()=>true,data:()=>({lateCutoff:'09:30',fromServer:true})};
      throw denied();}
  }});
  // session is a top-level `let` in js/shared.js, so it has to be assigned
  // inside the sandbox — the harness's session option is shadowed by it.
  a.run('session='+J(sess)+';loadPayrollData=async()=>{};loadHRMSession4Data=async()=>{};');
  a.reads=reads;
  return a;
}

module.exports=async function(){
  const s=suite('session');

  s.section('a restored session is resolved from the token, not the saved username');
  {
    const t=tab();t.ss.u='afnan';
    t.fire({uid:'u-afnan',email:'afnan@groovy.op'});
    s.eq('the saved username and the token agree → that account',t.a.run('session.u'),'afnan');
    s.eq('with the uid from the token',t.a.run('session.uid'),'u-afnan');
    s.eq('and the app started',t.a.run('__started'),'afnan');
  }
  {
    const t=tab();t.ss.u='afnan';
    t.fire({uid:'u-sami',email:'sami@groovy.op'});
    s.eq('a stale saved username loses to the token email',t.a.run('session.u'),'sami');
    s.eq('the app starts as that account',t.a.run('__started'),'sami');
    s.eq('nothing is signed out',t.signOuts,0);
  }
  {
    const t=tab();t.ss.u='afnan';
    t.fire({uid:'u-x',email:'Afnan@Groovy.OP'});
    s.eq('email case is forgiven',t.a.run('session.u'),'afnan');
  }
  {
    const t=tab();t.ss.u='afnan';
    t.fire({uid:'u-typo',email:'sami@groovy.ops'});
    s.eq('a token with no USER_DEFS entry is never guessed from the saved username',t.a.run('session'),null);
    s.eq('it is signed out',t.signOuts,1);
    s.ok('the login screen is shown',t.loginShown());
    s.ok('and the saved username is dropped',!('u' in t.ss));
    s.eq('the app did not start',t.a.run('__started'),null);
  }
  {
    const t=tab();t.ss.u='mustafa';
    t.fire({uid:'u-m'});
    s.eq('a token with no email at all falls back to the saved username',t.a.run('session.u'),'mustafa');
  }
  {
    const t=tab();
    t.fire(null);
    s.ok('no user and no session → the login screen',t.loginShown());
    s.eq('no notice',t.notice(),0);
  }

  s.section('a live session that no longer matches the token is blocked, not ignored');
  {
    const t=tab();t.a.run('session='+J(AFNAN));
    t.fire({uid:'u-sami',email:'sami@groovy.op'});
    s.eq('a different account signed in elsewhere raises the notice',t.notice(),1);
    s.eq('titled',t.title(),'Signed in as someone else');
    s.ok('naming who the browser is now',/Sami \(sami\)/.test(t.msg()));
    s.ok('and who the screen still shows',/still showing Afnan/.test(t.msg()));
    s.ok('and how to get out',/Reload to continue as Sami/.test(t.msg()));
    s.eq('the session on screen is not silently swapped',t.a.run('session.u'),'afnan');
    s.eq('startApp is not re-run',t.a.run('__started'),null);
    s.eq('nothing is signed out',t.signOuts,0);
    t.fire({uid:'u-sami',email:'sami@groovy.op'});
    s.eq('a second event does not stack a second notice',t.notice(),1);
  }
  {
    const t=tab();t.a.run('session='+J(AFNAN));
    t.fire({uid:'u-afnan',email:'afnan@groovy.op'});
    s.eq('the same account again is not a mismatch',t.notice(),0);
  }
  {
    const t=tab();t.a.run('session='+J(AFNAN));
    t.fire({uid:'u-typo',email:'sami@groovy.ops'});
    s.eq('an unknown account signed in elsewhere still raises it',t.notice(),1);
    s.ok('and says it is not a Groovy Ops account',/sami@groovy\.ops .* not a Groovy Ops account/.test(t.msg()));
  }
  {
    const t=tab();t.a.run('session='+J(AFNAN));
    t.fire(null);
    s.eq('a sign-out elsewhere raises it',t.notice(),1);
    s.eq('titled',t.title(),'Signed out');
    s.ok('and says so',/signed out from another tab/.test(t.msg()));
  }
  {
    const t=tab();t.a.run('session='+J(AFNAN)+';loginInProgress=true;');
    t.fire({uid:'u-sami',email:'sami@groovy.op'});
    s.eq('nothing happens while a login is in progress',t.notice(),0);
    s.eq('and the session stands',t.a.run('session.u'),'afnan');
  }
  {
    // The tab's own logout: Firebase fires the listener with null while
    // signOut is still running. That must not read as "signed out elsewhere".
    const t=tab();t.a.run('session='+J(AFNAN));t.ss.u='afnan';
    t.onSignOut=()=>t.fire(null);
    await t.a.run('window.doLogout()');
    s.eq('signOut was called',t.signOuts,1);
    s.eq('no notice on the tab\'s own logout',t.notice(),0);
    s.eq('the tab reloads',t.reloads,1);
    s.ok('and the saved username is cleared',!('u' in t.ss));
  }
  {
    const src=fs.readFileSync(path.join(__dirname,'..','js','shared.js'),'utf8');
    s.ok('__bootApp registers the named handler',/onAuthStateChanged\(auth,_gvAuthChanged\)/.test(src));
    s.ok('the notice is built with textContent, never by interpolating the email',
      !/innerHTML=[^\n]*user\.email/.test(src)&&/gv-identity-msg'\);if\(p\)p\.textContent=msg/.test(src));
  }

  s.section('loadHRMData asks only for what the role can read');
  {
    const a=hrmTab({uid:'u-sami',u:'sami',name:'Sami',role:'csr_lead',email:'sami@groovy.op'});
    await a.run('loadHRMData()');
    s.eq('a csr_lead loads',a.run('hrmDataLoaded'),true);
    s.eq('with the employees list',a.run('allEmployees.length'),1);
    s.ok('and never asks for hrm_policies',!a.reads.some(r=>r.startsWith('hrm_policies')));
    s.ok('nor increment_logs',!a.reads.includes('increment_logs'));
    s.eq('policies are the defaults',a.run('JSON.stringify(hrmPolicies)===JSON.stringify(HRM_DEFAULT_POLICIES)'),true);
    s.eq('the employee record is attached to the session',a.run('session.employee&&session.employee.paygrade'),'G2');
  }
  {
    const a=hrmTab({uid:'u-w',u:'haris',name:'Haris',role:'worker',email:'haris@groovy.op',stages:['qc']});
    await a.run('loadHRMData()');
    s.eq('a worker loads too',a.run('hrmDataLoaded'),true);
    s.eq('with the employees list the paygrade widget needs',a.run('allEmployees.length'),1);
    s.ok('and no refused read was attempted',!a.reads.some(r=>r.startsWith('hrm_policies')||r==='increment_logs'));
  }
  {
    const a=hrmTab(AFNAN);
    await a.run('loadHRMData()');
    s.ok('an owner still reads hrm_policies',a.reads.includes('hrm_policies/main'));
    s.ok('and increment_logs',a.reads.includes('increment_logs'));
    s.eq('and gets the server document, not the defaults',a.run('hrmPolicies.fromServer'),true);
  }
  {
    const a=hrmTab({uid:'u-m',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'});
    await a.run('loadHRMData()');
    s.ok('a manager reads hrm_policies (isOM in the rules)',a.reads.includes('hrm_policies/main'));
  }
  return s;
};

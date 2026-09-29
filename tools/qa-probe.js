#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   tools/qa-probe.js — sign in AS the QA account and prove what it can and
   cannot do. This is the "probe test" step of the rollout in QA_ACCESS.md.

     QA_PASSWORD='…' node tools/qa-probe.js --live                # after the rules are published
     QA_PASSWORD=qa-emulator-only node tools/qa-probe.js --emulator   # rehearsal, no live contact

   Exactly one of --live / --emulator is required, so it cannot run against
   live by accident. The password comes from the environment only: it is
   never printed, stored or put on the command line. The web API key it
   signs in with is the public one already in index.html.

   THE MODEL (29 Sept 2026): claude@groovy.op READS every collection a rule
   lets any role read — employees, payslips, acct_*, bug_reports and the rest
   included — and WRITES only inside its own fenced sandbox. A path with no
   match block (integration_secrets, passkeys, passkey_challenges) is denied
   to everyone, QA included.

   FAIL-SAFE BY CONSTRUCTION. The probe only ever CREATES documents with
   unique names (qa-probe-<time>-<n>); it never updates or deletes anything
   that already existed. If the rules are NOT confining the account, a probe
   document will land — the script then deletes it, prints which paths were
   writable, and exits 1 telling you to disable the user (the kill switch).
   Every write in the first block is EXPECTED TO BE REFUSED. The sandbox
   block (a QA-only list, one item assigned to itself, one comment — all
   deleted straight after) is the one thing expected to succeed, and it is
   real writes to the target project, so it runs only with
   --sandbox-writes (always on for --emulator).

   Exit codes: 0 all as designed · 1 a write landed or a read is open that
   should not be · 2 could not run (sign-in failed, bad flags)
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');

const args=process.argv.slice(2);
const live=args.includes('--live'),emu=args.includes('--emulator');
const sandboxWrites=emu||args.includes('--sandbox-writes');
if(live===emu){console.error('give exactly one of --live or --emulator');process.exit(2);}
const password=process.env.QA_PASSWORD;
if(!password){console.error('QA_PASSWORD is not set (it is read from the environment only)');process.exit(2);}

const EMAIL='claude@groovy.op';
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const apiKey=(/apiKey:'(AIza[0-9A-Za-z_-]{35})'/.exec(html)||[])[1];
const project=live?'groovy-gatepass':(process.env.QA_PROJECT||'demo-groovy-ops');
if(!live&&!/^demo-/.test(project)){console.error('--emulator needs a demo- project id');process.exit(2);}
const authBase=live?'https://identitytoolkit.googleapis.com':'http://127.0.0.1:9099/identitytoolkit.googleapis.com';
const fsHost=live?'https://firestore.googleapis.com':'http://127.0.0.1:'+((process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:8080').split(':')[1]);
const DOCS=fsHost+'/v1/projects/'+project+'/databases/(default)/documents';
const stamp=Date.now();let n=0;
const id=()=>'qa-probe-'+stamp+'-'+(++n);

let token,uid;
async function signIn(){
  const r=await fetch(authBase+'/v1/accounts:signInWithPassword?key='+(live?apiKey:'demo-emulator-key'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:EMAIL,password,returnSecureToken:true})});
  const j=await r.json();
  if(!r.ok){console.error('sign-in failed: '+((j.error&&j.error.message)||r.status));process.exit(2);}
  token=j.idToken;uid=j.localId;
}
const H=()=>({'content-type':'application/json',Authorization:'Bearer '+token});
const S=v=>({stringValue:String(v)});
const fields=o=>{const f={};for(const k of Object.keys(o)){const v=o[k];f[k]=Array.isArray(v)?{arrayValue:{values:v.map(S)}}:typeof v==='number'?{integerValue:String(v)}:S(v);}return f;};
// create-only: the documentId query parameter + exists=false precondition, so it can never overwrite anything
async function create(coll,docId,data){
  const r=await fetch(DOCS+'/'+coll+'?documentId='+encodeURIComponent(docId),{method:'POST',headers:H(),body:JSON.stringify({fields:fields(data)})});
  return r.status;
}
async function createSub(p,docId,data){
  const r=await fetch(DOCS+'/'+p+'?documentId='+encodeURIComponent(docId),{method:'POST',headers:H(),body:JSON.stringify({fields:fields(data)})});
  return r.status;
}
async function del(p){const r=await fetch(DOCS+'/'+p,{method:'DELETE',headers:H()});return r.status;}
async function readDoc(p){return (await fetch(DOCS+'/'+p,{headers:H()})).status;}
async function listColl(coll){return (await fetch(DOCS+'/'+coll+'?pageSize=1',{headers:H()})).status;}

const problems=[];const landed=[];
function report(ok,label,extra){console.log((ok?'  ok   ':'  FAIL ')+label+(extra?'   '+extra:''));if(!ok)problems.push(label);}

(async()=>{
  console.log('QA probe — '+(live?'LIVE project '+project:'EMULATOR '+project)+' — signing in as '+EMAIL);
  await signIn();
  console.log('  signed in; uid '+uid+'  (put this in qaUid() in firestore.rules if it is still the placeholder)');

  console.log('\nwrites that MUST be refused (each is a create of a unique probe document):');
  const attempts=[
    ['counters',{v:1}],['pos',{poNo:'x'}],['bundles',{x:1}],['gatepasses',{x:1}],['returns',{x:1}],['fabricin',{x:1}],
    ['store_items',{code:'x'}],['store_transactions',{x:1}],['activity',{user:'x'}],['bug_reports',{x:1}],['products',{x:1}],
    ['printing_jobs',{x:1}],['fulfillment_reports',{x:1}],['settings',{x:1}],['articles',{code:'x',name:'x',category:'x'}],
    ['employees',{x:1}],['payslips',{x:1}],['acct_entries',{type:'cash_in'}],['wh_sales',{orderNo:'x'}],
    ['notes_pages',{ownerUid:uid,visibility:'shared'}],['mood_boards',{ownerUid:uid,visibility:'shared'}],
    ['user_profiles',{uid:'someone-else',username:'afnan'}],
    ['hrm_notifications',{forUser:'afnan',title:'probe'}],['hrm_notifications',{forRole:'owner',title:'probe'}],
    ['hrm_notifications',{forUser:'claude',forRole:'owner',title:'probe'}],
    ['board_items',{ownerUid:uid,assigneeUids:[uid],listId:'some-real-list'}],
    ['board_lists',{adminUid:uid,kind:'shared'}]
  ];
  for(const [coll,data] of attempts){
    const docId=id();const st=await create(coll,docId,data);
    const refused=st===403||st===401;
    if(!refused){landed.push(coll+'/'+docId);}
    report(refused,coll.padEnd(20)+(data.forUser?'(forUser '+data.forUser+') ':data.forRole?'(forRole '+data.forRole+') ':''),'HTTP '+st);
  }

  console.log('\nreads that MUST work — everything a rule lets any role read, role-gated and owner-only included:');
  for(const c of ['pos','bundles','store_items','printing_jobs','shopify_orders','postex_orders','patterns','articles','user_profiles',
                  'employees','payslips','gatepasses','activity','bug_reports','acct_entries','acct_vendors','acct_meter_logs','acct_closes','acct_settings',
                  'store_cash_accounts','wh_sales','advance_requests','loans','hrm_policies','payroll_runs','hrm_notifications','creators','dispatches','paid_pr_requests','discount_codes',
                  'mood_boards','notes_pages','board_lists','board_items','board_config'])
    { const st=await listColl(c);report(st===200,c.padEnd(22),'HTTP '+st); }

  console.log('\nreads that MUST be refused — no match block, so denied to everyone:');
  for(const c of ['integration_secrets','passkeys','passkey_challenges'])
    { const st=await listColl(c);report(st===403||st===401,c.padEnd(22),'HTTP '+st); }

  console.log('\nthe sandbox (a list only it admins, an item assigned only to itself):');
  if(!sandboxWrites){
    console.log('  ..   skipped: these are real writes to '+project+'. Re-run with --sandbox-writes to exercise them (each document is deleted straight after).');
  }else{
    const post=(p,docId,fields)=>fetch(DOCS+'/'+p+'?documentId='+encodeURIComponent(docId),{method:'POST',headers:H(),body:JSON.stringify({fields})}).then(r=>r.status);
    const B=v=>({booleanValue:v}),A=a=>({arrayValue:{values:a.map(S)}});
    const lid=id();
    const ls=await post('board_lists',lid,{adminUid:S(uid),memberUids:A([uid]),kind:S('shared'),qa:B(true),title:S('qa probe — safe to delete')});
    report(ls===200,'create a QA list it admins alone','HTTP '+ls);
    const badList=await post('board_lists',lid+'x',{adminUid:S(uid),memberUids:A([uid,'someone-else']),kind:S('shared'),qa:B(true)});
    if(badList===200)landed.push('board_lists/'+lid+'x');
    report(badList===403,'…but NOT with a second person in it','HTTP '+badList);
    if(ls===200){
      const item=id();
      const ir=await post('board_items',item,{title:S('qa probe'),ownerUid:S(uid),assigneeUids:A([uid]),listId:S(lid),qa:B(true),visibility:S('shared'),status:S('open')});
      report(ir===200,'create an item in it, assigned to itself','HTTP '+ir);
      const bad=await post('board_items',item+'x',{title:S('qa probe'),ownerUid:S(uid),assigneeUids:A([uid,'someone-else']),listId:S(lid),qa:B(true),visibility:S('shared')});
      if(bad===200)landed.push('board_items/'+item+'x');
      report(bad===403,'…but NOT with a second person assigned','HTTP '+bad);
      if(ir===200){
        const c=await createSub('board_items/'+item+'/comments',id(),{authorUid:uid,body:'probe'});
        report(c===200,'comment on it','HTTP '+c);
        report((await del('board_items/'+item))===200,'delete the item');
      }
      report((await del('board_lists/'+lid))===200,'delete the list');
    }
  }

  if(landed.length){
    console.log('\n!! THESE WRITES LANDED — THE RULES ARE NOT CONFINING THIS ACCOUNT:');
    for(const p of landed){const d=await del(p);console.log('   '+p+'   (delete attempt: HTTP '+d+')');}
    console.log('\n   KILL SWITCH NOW: Firebase Console → Authentication → Users → claude@groovy.op → ⋮ → Disable account.');
    console.log('   Then roll the Firestore rules back (QA_ACCESS.md, "Rollback").');
  }
  console.log('\n'+(problems.length?problems.length+' problem(s).':'All as designed.'));
  process.exit(problems.length?1:0);
})().catch(e=>{console.error('probe crashed: '+String(e&&e.message||e).split('\n')[0]);process.exit(2);});

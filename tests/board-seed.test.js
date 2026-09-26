/* ─────────────────────────────────────────────────────────────────────────
   The Board — the seed: one body for the "Run seed" button and the script.

   What this holds:
     · buildSeedPlan is PURE and is the whole decision: what is created,
       what an existing item keeps, who a missing login costs.
     · runSeed against an in-memory Firestore: a dry run writes nothing, a
       real run writes once, a re-run creates nothing new (idempotent),
       and a missing login is skipped and NAMED rather than fatal.
     · netlify/functions/board-seed.js: POST only, a verified ID token,
       Board owners only — by EMAIL, mirroring isBoardOwner() in
       firestore.rules and BOARD_OWNERS in js/auth.js.
     · scripts/seed-board.js writes by default and takes --dry-run.
   firebase-admin is not installed in CI (no dependencies anywhere in
   tests/), so it is replaced through Module._load, the pattern
   tests/marketing-codes.test.js uses.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const Module=require('module');
const {suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

// ── an in-memory Firestore + Auth, shaped like firebase-admin ────────────
function fakeAdmin(o){
  const store=(o&&o.store)||{};
  const users=(o&&o.users)||{};
  const state={store,commits:0,writes:0,tokens:(o&&o.tokens)||{}};
  const docRef=p=>({path:p,id:p.split('/').pop(),
    get:async()=>({exists:store[p]!=null,id:p.split('/').pop(),data:()=>store[p]})});
  const db={
    doc:docRef,
    getAll:async(...refs)=>refs.map(r=>({exists:store[r.path]!=null,id:r.id,data:()=>store[r.path]})),
    batch:()=>{const ops=[];return{
      set:(ref,data,opt)=>ops.push({ref,data,merge:!!(opt&&opt.merge)}),
      commit:async()=>{state.commits++;ops.forEach(op=>{state.writes++;
        store[op.ref.path]=op.merge?Object.assign({},store[op.ref.path]||{},op.data):Object.assign({},op.data);});}
    };}
  };
  const auth={
    getUserByEmail:async e=>{ if(!users[e])throw Object.assign(new Error('no user'),{code:'auth/user-not-found'}); return{uid:users[e]}; },
    verifyIdToken:async t=>{ if(!state.tokens[t])throw new Error('bad token'); return state.tokens[t]; }
  };
  const admin={apps:[],initializeApp(){this.apps.push({});return{};},
    credential:{cert:()=>({})},firestore:()=>db,auth:()=>auth};
  return{admin,db,auth,state,store};
}
const ALL={'ammar@groovy.op':'u-ammar','afnan@groovy.op':'u-afnan','daniyal@groovy.op':'u-dani',
  'mustafa@groovy.op':'u-must','saim@groovy.op':'u-saim'};

module.exports=async function(){
  const s=suite('board-seed');
  const plan=require('../scripts/board-seed-plan.js');

  s.section('buildSeedPlan: a fresh board, all five logins');
  {
    const uid={ammar:'u-ammar',afnan:'u-afnan',daniyal:'u-dani',mustafa:'u-must',saim:'u-saim'};
    const r=plan.buildSeedPlan({uidByHandle:uid,existing:{},listDoc:null,profiles:{},now:1000});
    s.eq('42 items created',r.report.created,42);
    s.eq('none already seeded',r.report.alreadySeeded,0);
    s.eq('nobody skipped',J(r.report.skippedUsers),J([]));
    s.eq('no item skipped',J(r.report.skippedItems),J([]));
    s.eq('a profile row for each of the five',r.writes.filter(w=>/^user_profiles\//.test(w.path)).length,5);
    s.eq('profile rows are {uid, username} merges — they seed, never reset',
      J(r.writes.filter(w=>/^user_profiles\//.test(w.path)).map(w=>Object.keys(w.data).sort().join()+':'+w.merge)[0]),J('uid,username:true'));
    const items=r.writes.filter(w=>/^board_items\//.test(w.path));
    s.eq('every item addressed by its deterministic id',
      J(items.map(w=>w.path.slice(12))),J(plan.ITEMS.map(x=>plan.seedId(x[1],x[2]))));
    const shade=items.filter(w=>w.data.title==='Shade list locked')[0].data;
    s.eq('a locked gate is held by Ammar',shade.lockedBy,'u-ammar');
    const brief=items.filter(w=>/^Brief Daniyal/.test(w.data.title))[0].data;
    s.eq('the owner is the first assignee',brief.ownerUid,'u-ammar');
    s.eq('assignees in order',J(brief.assigneeUids),J(['u-ammar','u-dani']));
    s.eq('shared, so every Board user reads it',brief.visibility,'shared');
    const list=r.writes.filter(w=>/^board_lists\//.test(w.path))[0].data;
    s.eq('the list admin is Ammar',list.adminUid,'u-ammar');
    s.eq('with all five as members',list.memberUids.length,5);
    s.ok('the markers are written',r.writes.some(w=>w.path==='board_config/markers'));
  }

  s.section('buildSeedPlan: a missing login is skipped and NAMED, never fatal');
  {
    const uid={ammar:'u-ammar',afnan:'u-afnan',daniyal:'u-dani',saim:'u-saim'};   // no mustafa
    const r=plan.buildSeedPlan({uidByHandle:uid,existing:{},listDoc:null,profiles:{},now:1});
    s.eq('mustafa is named',J(r.report.skippedUsers),J(['mustafa']));
    const onlyMustafa=plan.ITEMS.filter(x=>x[3].every(h=>h==='mustafa')).map(x=>x[2]);
    s.eq('an item he was the only assignee of is skipped, by name',J(r.report.skippedItems),J(onlyMustafa));
    s.eq('everything else is created',r.report.created,42-onlyMustafa.length);
    const hy=r.writes.filter(w=>w.data&&/^Hyderabad/.test(w.data.title||''))[0].data;
    s.eq('a shared item just loses him',J(hy.assigneeUids),J(['u-afnan']));
    s.eq('no profile row is minted for a missing login',
      r.writes.filter(w=>/^user_profiles\//.test(w.path)).length,4);
  }

  s.section('buildSeedPlan: a re-run never undoes real work');
  {
    const uid={ammar:'u-ammar',afnan:'u-afnan',daniyal:'u-dani',mustafa:'u-must',saim:'u-saim'};
    const id=plan.seedId('walika','Shade list locked');
    const existing={};existing[id]={date:'2026-09-30',status:'done',steps:[{id:'s',title:'x',done:true}],
      assigneeUids:['u-ammar','u-afnan'],createdAt:5,updatedAt:6};
    const r=plan.buildSeedPlan({uidByHandle:uid,existing,listDoc:{memberUids:['u-ammar','u-extra']},profiles:{'u-ammar':true},now:99});
    const w=r.writes.filter(x=>x.path==='board_items/'+id)[0];
    s.eq('an existing item is merged, not replaced',w.merge,true);
    plan.KEEP_FIELDS.concat(plan.CREATE_ONLY).forEach(k=>
      s.ok('a re-run leaves '+k+' alone',!(k in w.data)));
    s.eq('counted as already seeded',r.report.alreadySeeded,1);
    s.eq('the rest are new',r.report.created,41);
    const list=r.writes.filter(x=>/^board_lists\//.test(x.path))[0].data;
    s.ok('list members are a union — nobody is removed',list.memberUids.indexOf('u-extra')>-1);
    s.eq('and everyone missing is added',list.memberUids.length,6);
    s.ok('an existing list keeps its admin',!('adminUid' in list));
    s.eq('profile rows that already exist are not reported as created',r.report.profilesCreated.indexOf('ammar'),-1);
  }

  s.section('runSeed: dry run, real run, and a re-run that creates nothing');
  {
    const f=fakeAdmin({users:ALL});
    const dry=await plan.runSeed({db:f.db,auth:f.auth,dryRun:true,now:1});
    s.eq('a dry run writes nothing',f.state.writes,0);
    s.eq('but reports what it would do',dry.created,42);
    const real=await plan.runSeed({db:f.db,auth:f.auth,now:2});
    s.eq('a real run creates 42',real.created,42);
    s.eq('in one batch',f.state.commits,1);
    s.eq('42 items, 5 profiles, the list and the markers',f.state.writes,49);
    // Someone moves a date between runs.
    const id=plan.seedId('walika','Shade list locked');
    f.store['board_items/'+id].date='2026-10-02';
    const again=await plan.runSeed({db:f.db,auth:f.auth,now:3});
    s.eq('a re-run creates nothing new',again.created,0);
    s.eq('and finds all 42 already seeded',again.alreadySeeded,42);
    s.eq('and leaves the moved date where it was put',f.store['board_items/'+id].date,'2026-10-02');
    s.eq('and does not pretend the item was just created',f.store['board_items/'+id].createdAt,2);
  }
  {
    const users=Object.assign({},ALL);delete users['saim@groovy.op'];
    const f=fakeAdmin({users});
    const notes=[];
    const r=await plan.runSeed({db:f.db,auth:f.auth,now:1,log:m=>notes.push(m)});
    s.eq('a missing login does not stop the run',r.created,42);
    s.ok('and is warned about',notes.some(n=>/saim@groovy\.op/.test(n)));
    s.eq('and named in the report',J(r.skippedUsers),J(['saim']));
  }

  s.section('the Run seed function: POST, a verified token, Board owners only');
  {
    const f=fakeAdmin({users:ALL,tokens:{
      't-ammar':{email:'ammar@groovy.op'},'t-afnan':{email:'Afnan@groovy.op'},'t-must':{email:'mustafa@groovy.op'}}});
    const orig=Module._load;
    Module._load=function(req,...rest){ if(req==='firebase-admin')return f.admin; return orig.call(this,req,...rest); };
    const fnPath=path.join(ROOT,'netlify/functions/board-seed.js');
    delete require.cache[fnPath];
    const fn=require(fnPath);
    const env=process.env.FIREBASE_SERVICE_ACCOUNT;
    process.env.FIREBASE_SERVICE_ACCOUNT='{}';
    const call=async(body,method)=>{const r=await fn.handler({httpMethod:method||'POST',body:J(body)});
      return{status:r.statusCode,body:JSON.parse(r.body)};};
    try{
      s.eq('GET is refused',(await call({},'GET')).status,405);
      s.eq('no token is refused',(await call({})).status,400);
      s.eq('a bad token is refused',(await call({idToken:'nope'})).status,401);
      const m=await call({idToken:'t-must'});
      s.eq('a manager who is not a Board owner is refused',m.status,403);
      s.eq('and nothing was written',f.state.writes,0);
      const d=await call({idToken:'t-ammar',dryRun:true});
      s.eq('a Board owner may preview',d.status,200);
      s.eq('a preview writes nothing',f.state.writes,0);
      s.eq('and says what it would create',d.body.report.created,42);
      const w=await call({idToken:'t-afnan'});
      s.eq('a Board owner may run it (email case-insensitive)',w.status,200);
      s.eq('it writes',w.body.report.created,42);
      s.eq('and reports who ran it',w.body.by,'afnan@groovy.op');
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
      s.eq('an unconfigured site says so, not a crash',(await call({idToken:'t-ammar'})).status,503);
    }finally{
      Module._load=orig;
      if(env===undefined)delete process.env.FIREBASE_SERVICE_ACCOUNT;else process.env.FIREBASE_SERVICE_ACCOUNT=env;
    }
    // The gate, three places, one list.
    const emails=fn._test.BOARD_OWNER_EMAILS.slice().sort();
    const rules=read('firestore.rules');
    const body=(/function isBoardOwner\(\)\s*\{([\s\S]*?)\}/.exec(rules)||[])[1]||'';
    const ruleEmails=(body.match(/[a-z0-9._-]+@groovy\.op/g)||[]).sort();
    s.eq('the function’s owners are isBoardOwner() in firestore.rules',J(emails),J(ruleEmails));
    const auth=read('js/auth.js');
    const owners=((/const BOARD_OWNERS=\[([^\]]*)\]/.exec(auth)||[])[1]||'').match(/'([a-z0-9_-]+)'/g)||[];
    s.eq('and BOARD_OWNERS in js/auth.js',J(owners.map(x=>x.replace(/'/g,'')+'@groovy.op').sort()),J(emails));
  }

  s.section('the script writes by default and takes --dry-run');
  {
    const src=read('scripts/seed-board.js');
    s.ok('--dry-run is the flag',/'--dry-run'/.test(src));
    s.ok('--write is gone',!/'--write'/.test(src));
    s.ok('the body is the shared module',/require\('\.\/board-seed-plan\.js'\)/.test(src));
    const fnSrc=read('netlify/functions/board-seed.js');
    s.ok('so is the function’s',/require\("\.\.\/\.\.\/scripts\/board-seed-plan\.js"\)/.test(fnSrc));
  }

  return s;
};

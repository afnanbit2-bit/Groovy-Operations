/* ─────────────────────────────────────────────────────────────────────────
   The Board — the seed: one body for the "Run seed" button and the script.

   What this holds:
     · buildSeedPlan is PURE and is the whole decision: what is created,
       what an existing item keeps, who a missing login costs.
     · runSeed against an in-memory Firestore: a dry run writes nothing, a
       real run writes once, and a re-run WRITES NO EXISTING ITEM AT ALL --
       it only creates what was never made and adds people who had no
       login last time. A deleted milestone is not brought back, a person
       taken off the list is not put back, and a missing login is skipped
       and NAMED rather than fatal (an Auth error that is not "no such
       account" stops the run before anything is written).
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
  const state={store,commits:0,writes:0,paths:[],tokens:(o&&o.tokens)||{}};
  const docRef=p=>({path:p,id:p.split('/').pop(),
    get:async()=>({exists:store[p]!=null,id:p.split('/').pop(),data:()=>store[p]})});
  const db={
    doc:docRef,
    getAll:async(...refs)=>refs.map(r=>({exists:store[r.path]!=null,id:r.id,data:()=>store[r.path]})),
    batch:()=>{const ops=[];return{
      set:(ref,data,opt)=>ops.push({ref,data,merge:!!(opt&&opt.merge)}),
      commit:async()=>{state.commits++;ops.forEach(op=>{state.writes++;state.paths.push(op.ref.path);
        const cur=op.merge?Object.assign({},store[op.ref.path]||{}):{};
        Object.keys(op.data).forEach(k=>{const v=op.data[k];
          if(v&&v.__arrayUnion){const a=Array.isArray(cur[k])?cur[k].slice():[];
            v.__arrayUnion.forEach(x=>{if(a.indexOf(x)<0)a.push(x);});cur[k]=a;}
          else cur[k]=v;});
        store[op.ref.path]=cur;});}
    };}
  };
  const flaky=(o&&o.flaky)||{};
  const auth={
    getUserByEmail:async e=>{
      if(flaky[e])throw Object.assign(new Error('socket hang up'),{code:'app/network-error'});
      if(!users[e])throw Object.assign(new Error('no user'),{code:'auth/user-not-found'}); return{uid:users[e]}; },
    verifyIdToken:async t=>{ if(!state.tokens[t])throw new Error('bad token'); return state.tokens[t]; }
  };
  const FieldValue={arrayUnion:(...v)=>({__arrayUnion:v})};
  const firestore=()=>db;firestore.FieldValue=FieldValue;
  const admin={apps:[],initializeApp(){this.apps.push({});return{};},
    credential:{cert:()=>({})},firestore,auth:()=>auth};
  return{admin,db,auth,state,store,FieldValue};
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
    s.eq('and the report says so',r.report.markersWritten,true);
    const rec=r.writes.filter(w=>w.path==='board_config/seed')[0];
    s.ok('the seed leaves a record',!!rec&&rec.merge===false);
    s.eq('naming every milestone it made',rec&&rec.data.itemIds.length,42);
    s.eq('and every person it put on the list',rec&&rec.data.members.length,5);
    s.eq('with nobody missing from anything',rec&&J(rec.data.missing),J({}));
    s.eq('a fresh board is not an adoption',r.report.adopted,false);
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

  s.section('buildSeedPlan: a re-run writes no item that exists (review of 9e3b521)');
  {
    // Everything a person can change on a seeded item, changed. The old
    // re-run merged all but a short keep-list back: attachments emptied,
    // title, kind, priority and list put back, a private item made shared,
    // ownerUid moved to someone not on it.
    const uid={ammar:'u-ammar',afnan:'u-afnan',daniyal:'u-dani',mustafa:'u-must',saim:'u-saim'};
    const all=plan.ITEMS.map(x=>plan.seedId(x[1],x[2]));
    const id=plan.seedId('walika','Shade list locked');
    const existing={};
    all.forEach(k=>{existing[k]={title:'x'};});
    existing[id]={title:'Shade list LOCKED (renamed)',kind:'task',priority:2,listId:'tbl_private',visibility:'private',
      ownerUid:'u-afnan',assigneeUids:['u-afnan'],attachments:[{url:'https://res.cloudinary.com/x/a.pdf'}],
      date:'2026-09-30',datePlanned:'2026-09-28',status:'done',completedAt:5,completedByUid:'u-afnan',
      commentCount:7,locked:false,lockedBy:null,lane:'x',color:'red',createdAt:5,updatedAt:6,lastActivityAt:6};
    const record={itemIds:all,missing:{},members:['u-ammar','u-afnan','u-dani','u-must','u-saim'],runs:1};
    const r=plan.buildSeedPlan({uidByHandle:uid,existing,record,hasMarkers:true,
      listDoc:{title:'Winter Drop 2027 (renamed)',archived:true,color:'red',memberUids:['u-ammar','u-afnan','u-must','u-saim']},
      profiles:{'u-ammar':true},now:99});
    s.eq('NO board_items write at all',r.writes.filter(w=>/^board_items\//.test(w.path)).length,0);
    s.eq('no list write: its title, colour and archive state are its owner\'s',r.writes.filter(w=>/^board_lists\//.test(w.path)).length,0);
    s.ok('someone the seed put on the list and who is not there now stays off (daniyal)',r.report.listMembersAdded.length===0);
    s.eq('no markers write once markers exist',r.writes.filter(w=>w.path==='board_config/markers').length,0);
    s.eq('counted as already seeded',r.report.alreadySeeded,42);
    s.eq('nothing created',r.report.created,0);
    s.eq('profile rows that already exist are not reported as created',r.report.profilesCreated.indexOf('ammar'),-1);
    s.eq('the record is kept',r.record.runs,2);
  }
  {
    // Deleted since: the record says the seed made it; it is gone now.
    const uid={ammar:'u-ammar',afnan:'u-afnan',daniyal:'u-dani',mustafa:'u-must',saim:'u-saim'};
    const all=plan.ITEMS.map(x=>plan.seedId(x[1],x[2]));
    const gone=plan.seedId('walika','Shade list locked');
    const existing={};all.filter(k=>k!==gone).forEach(k=>{existing[k]={};});
    const r=plan.buildSeedPlan({uidByHandle:uid,existing,record:{itemIds:all,missing:{},members:[]},
      hasMarkers:true,listDoc:{memberUids:['u-ammar']},profiles:{},now:1});
    s.eq('a milestone deleted since the seed made it is NOT brought back',
      r.writes.filter(w=>w.path==='board_items/'+gone).length,0);
    s.eq('and is named',J(r.report.deletedSince),J(['Shade list locked']));
    s.ok('and stays in the record, so the next run knows too',r.record.itemIds.indexOf(gone)>-1);
  }
  {
    // A person with no login last time, who has one now: added to what
    // they were left off, by arrayUnion, and to the list -- and nothing
    // else on those items moves. Their own milestones are made now.
    const uid0={ammar:'u-ammar',afnan:'u-afnan',mustafa:'u-must',saim:'u-saim'};   // no daniyal
    const r0=plan.buildSeedPlan({uidByHandle:uid0,existing:{},listDoc:null,profiles:{},now:1});
    const cyc=plan.seedId('shoot','CYC vendor site visit; buildout starts');
    s.eq('the record says who each milestone is missing',J(r0.record.missing[cyc]),J(['daniyal']));
    const existing={};
    r0.writes.filter(w=>/^board_items\//.test(w.path)).forEach(w=>{existing[w.path.slice(12)]=Object.assign({},w.data);});
    const listDoc=r0.writes.filter(w=>/^board_lists\//.test(w.path))[0].data;
    const uid1=Object.assign({daniyal:'u-dani'},uid0);
    const r1=plan.buildSeedPlan({uidByHandle:uid1,existing,listDoc,record:r0.record,hasMarkers:true,profiles:{},now:2});
    const w=r1.writes.filter(x=>x.path==='board_items/'+cyc)[0];
    s.ok('he is added to it',!!w&&J(w.union)===J({assigneeUids:['u-dani']}));
    s.eq('and NOTHING else on it is written (the owner stays Ammar)',w&&J(w.data),J({}));
    s.eq('added by union, never a replaced array',w&&w.merge,true);
    const onlyDani=plan.ITEMS.filter(x=>x[3].every(h=>h==='daniyal')).map(x=>plan.seedId(x[1],x[2]));
    s.ok('his own milestones are made now',onlyDani.length>0&&onlyDani.every(k=>r1.writes.some(x=>x.path==='board_items/'+k&&x.merge===false)));
    s.eq('the list gains him, by union',J(r1.writes.filter(x=>/^board_lists\//.test(x.path)).map(x=>x.union)),J([{memberUids:['u-dani']}]));
    s.eq('and he is named',J(r1.report.listMembersAdded),J(['daniyal']));
    s.eq('the record forgets he was missing',r1.record.missing[cyc],undefined);
    const again=plan.buildSeedPlan({uidByHandle:uid1,existing:Object.assign({},existing,
      Object.fromEntries(onlyDani.map(k=>[k,{}]))),listDoc:{memberUids:listDoc.memberUids.concat('u-dani')},
      record:r1.record,hasMarkers:true,profiles:{},now:3});
    s.eq('so a third run adds him to nothing',again.writes.filter(x=>x.union).length,0);
  }
  {
    // Adopting a board seeded before the record existed.
    const uid={ammar:'u-ammar',afnan:'u-afnan',daniyal:'u-dani',mustafa:'u-must',saim:'u-saim'};
    const all=plan.ITEMS.map(x=>plan.seedId(x[1],x[2]));
    const existing={};all.slice(0,40).forEach(k=>{existing[k]={assigneeUids:['u-ammar']};});
    const r=plan.buildSeedPlan({uidByHandle:uid,existing,record:null,hasMarkers:true,
      listDoc:{memberUids:['u-ammar','u-afnan']},profiles:{},now:1});
    s.eq('it is an adoption',r.report.adopted,true);
    s.eq('no existing item is written',r.writes.filter(w=>/^board_items\//.test(w.path)&&existing[w.path.slice(12)]).length,0);
    s.eq('nobody is added to the list (they may have been taken off)',r.writes.filter(w=>/^board_lists\//.test(w.path)).length,0);
    s.eq('the two never made are made',r.report.created,2);
    s.eq('and the record starts from all 42',r.record.itemIds.length,42);
  }

  s.section('runSeed: dry run, real run, and a re-run that touches nothing');
  {
    const f=fakeAdmin({users:ALL});
    const dry=await plan.runSeed({db:f.db,auth:f.auth,fieldValue:f.FieldValue,dryRun:true,now:1});
    s.eq('a dry run writes nothing',f.state.writes,0);
    s.eq('but reports what it would do',dry.created,42);
    const real=await plan.runSeed({db:f.db,auth:f.auth,fieldValue:f.FieldValue,by:'afnan@groovy.op',now:2});
    s.eq('a real run creates 42',real.created,42);
    s.eq('in one batch',f.state.commits,1);
    s.eq('42 items, 5 profiles, the list, the markers and the record',f.state.writes,50);
    s.eq('the record says who ran it',f.store['board_config/seed'].lastRunBy,'afnan@groovy.op');
    // People use the board between runs.
    const id=plan.seedId('walika','Shade list locked');
    Object.assign(f.store['board_items/'+id],{date:'2026-10-02',title:'Shade list LOCKED',visibility:'private',
      priority:2,attachments:[{url:'https://res.cloudinary.com/x/a.pdf'}],commentCount:4});
    f.store['board_lists/'+plan.LIST_ID].title='Winter drop (renamed)';
    f.store['board_config/markers'].markers=[{label:'launch',date:'2026-11-02'}];
    const gone=plan.seedId('shoot','Last shoot slot');
    delete f.store['board_items/'+gone];
    const before=JSON.stringify(f.store['board_items/'+id]);
    f.state.paths.length=0;
    const again=await plan.runSeed({db:f.db,auth:f.auth,fieldValue:f.FieldValue,now:3});
    s.eq('a re-run creates nothing',again.created,0);
    s.eq('writes no item at all',f.state.paths.filter(p=>/^board_items\//.test(p)).length,0);
    s.eq('so the item comes back byte for byte',JSON.stringify(f.store['board_items/'+id]),before);
    s.eq('the list keeps its new name',f.store['board_lists/'+plan.LIST_ID].title,'Winter drop (renamed)');
    s.eq('the markers keep their edit',f.store['board_config/markers'].markers[0].date,'2026-11-02');
    s.ok('the deleted milestone stays deleted',!f.store['board_items/'+gone]);
    s.eq('and is named',J(again.deletedSince),J(['Last shoot slot']));
    s.eq('only the profile rows and the record are written',f.state.paths.length,6);
  }
  {
    // Saim has no login on the first run and gets one before the second.
    const users=Object.assign({},ALL);delete users['saim@groovy.op'];
    const f=fakeAdmin({users});
    const notes=[];
    const r=await plan.runSeed({db:f.db,auth:f.auth,fieldValue:f.FieldValue,now:1,log:m=>notes.push(m)});
    const onlySaim=plan.ITEMS.filter(x=>x[3].every(h=>h==='saim')).length;
    s.eq('a missing login does not stop the run',r.created,42-onlySaim);
    s.ok('and is warned about',notes.some(n=>/saim@groovy\.op/.test(n)));
    s.eq('and named in the report',J(r.skippedUsers),J(['saim']));
    const design=plan.seedId('design','Design production locked; prints to floor');
    f.store['board_items/'+design].ownerUid='u-ammar';
    f.store['board_items/'+design].notes='kept';
    f.state.tokens={};Object.assign(users,{'saim@groovy.op':'u-saim'});
    const r2=await plan.runSeed({db:f.db,auth:f.auth,fieldValue:f.FieldValue,now:2});
    s.eq('once he can sign in, the re-run adds him to what he was left off',
      J(f.store['board_items/'+design].assigneeUids),J(['u-ammar','u-saim']));
    s.eq('and leaves everything else on it',f.store['board_items/'+design].notes+'/'+f.store['board_items/'+design].ownerUid,'kept/u-ammar');
    s.eq('any milestone that was his alone is made now',r2.created,onlySaim);
    s.eq('and the re-run names what it added',J(r2.peopleAdded.map(p=>p.who.join())),J(plan.ITEMS.filter(x=>x[3].indexOf('saim')>-1&&x[3].some(h=>h!=='saim')).map(()=>'saim')));
    s.ok('and he is on the list',f.store['board_lists/'+plan.LIST_ID].memberUids.indexOf('u-saim')>-1);
  }
  {
    // A lookup that fails for any reason but "no such account" is NOT a
    // missing login: a blip must not make the run think Mustafa is gone.
    const f=fakeAdmin({users:ALL,flaky:{'mustafa@groovy.op':true}});
    let err=null;
    try{ await plan.runSeed({db:f.db,auth:f.auth,fieldValue:f.FieldValue,now:1}); }catch(e){ err=e; }
    s.ok('an Auth error that is not "no such account" stops the run',!!err&&/mustafa@groovy\.op/.test(err.message));
    s.eq('before anything is written',f.state.writes,0);
  }
  {
    // Adding people needs arrayUnion; without it, refuse rather than
    // replace an array.
    const users=Object.assign({},ALL);delete users['saim@groovy.op'];
    const f=fakeAdmin({users});
    await plan.runSeed({db:f.db,auth:f.auth,fieldValue:f.FieldValue,now:1});
    users['saim@groovy.op']='u-saim';
    const w0=f.state.writes;
    let err=null;
    try{ await plan.runSeed({db:f.db,auth:f.auth,now:2}); }catch(e){ err=e; }
    s.ok('a run that must add people and has no arrayUnion refuses',!!err&&/arrayUnion/.test(err.message));
    s.eq('and writes nothing',f.state.writes,w0);
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
      s.eq('it says it created 42',w.body.report.created,42);
      // A dry run reports created:42 too, so the count proves nothing about
      // writing (review of 9e3b521: a function that always dry-ran passed).
      s.eq('it is NOT a dry run',w.body.report.dryRun,false);
      s.eq('and it really wrote them',f.state.writes,50);
      s.eq('and reports who ran it',w.body.by,'afnan@groovy.op');
      s.eq('which the record keeps',(f.store['board_config/seed']||{}).lastRunBy,'afnan@groovy.op');
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

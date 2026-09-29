#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   scripts/board-inspect.js — read The Board's live data, server-side, to
   explain what a screenshot shows.   READ-ONLY BY CONSTRUCTION.

     node scripts/board-inspect.js counts [project]      per project: open / done / undated / by kind / by lane
     node scripts/board-inspect.js items <project>       every item in one project
     node scripts/board-inspect.js item <itemId>         one item: fields, dateHistory, activity
     node scripts/board-inspect.js notifications <user>  a user's bell rows (username, e.g. ammar)
     node scripts/board-inspect.js markers               the launch markers
     node scripts/board-inspect.js seed-check            every seeded milestone vs what is on the board

   <project> is a board_lists id or any part of its title ("winter").
   Output is markdown tables, for a log or a subagent.

   It reads with the Admin SDK, which BYPASSES firestore.rules -- that is
   the point: it sees private items and deleted-since milestones no app
   user can. So it must not be able to WRITE.

   CREDENTIALS: Application Default Credentials only -- no key file in the
   repo, and service-account JSON keys are blocked by the org's policy.
     GOOGLE_CLOUD_PROJECT   groovy-gatepass
     ADC                    `gcloud auth application-default login`, ideally
                            with --impersonate-service-account=<an account
                            holding ONLY roles/datastore.viewer>
   Missing either -> it prints why and exits 0.

   THE WRITE PROBE. Before reading anything it UPDATES a document that
   does not exist (board_config/inspect-probe-<random uuid>; update() never
   creates). Nothing can be written either way, and the error says which
   credential this is. NOT an id like __probe__: Firestore RESERVES
   __x__ ids and answers INVALID_ARGUMENT for every credential, which is
   what the first version did -- found by running it in the emulator:
     PERMISSION_DENIED  read-only       -> it runs
     NOT_FOUND          it could write  -> it REFUSES (exit 3)
   So ADC from the project owner's own Google account (an owner
   credential) is refused -- deliberately. Against the emulator
   (FIRESTORE_EMULATOR_HOST set, which routes every call to it) there is
   no IAM to probe, and it says so and runs.

   The decisions (the probe verdict, the counts, the seed check, the
   tables) are pure and exported; tests/board-inspect.test.js holds them.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');

// ── Pure ────────────────────────────────────────────────────────────────
/** What the write probe's outcome says about the credential. */
function probeVerdict(err){
  if(!err)return{run:false,why:'the probe WROTE a document -- this credential can write. Refusing.'};
  const code=err.code;
  const msg=String(err.message||'');
  if(code===7||code==='permission-denied'||/PERMISSION_DENIED/.test(msg))
    return{run:true,why:'read-only (the probe write was refused)'};
  if(code===5||code==='not-found'||/NOT_FOUND/.test(msg))
    return{run:false,why:'this credential CAN WRITE (the probe reached the document lookup). Refusing: use ADC that impersonates a roles/datastore.viewer account.'};
  return{run:false,why:'the probe failed for another reason, so the credential could not be classified: '+(msg.split('\n')[0]||code)};
}
/** One markdown table. Cells are single-line and pipe-safe. */
function mdTable(head,rows){
  const cell=v=>String(v==null?'':v).replace(/\r?\n/g,' ').replace(/\|/g,'\\|');
  return ['| '+head.map(cell).join(' | ')+' |','|'+head.map(()=>'---').join('|')+'|']
    .concat(rows.map(r=>'| '+r.map(cell).join(' | ')+' |')).join('\n');
}
/** Resolve a project argument to lists: an exact id, else a title match. */
function pickLists(lists,arg){
  if(!arg)return lists.slice();
  const byId=lists.filter(l=>l.id===arg);
  if(byId.length)return byId;
  const a=String(arg).toLowerCase();
  return lists.filter(l=>String(l.title||'').toLowerCase().indexOf(a)>-1);
}
/** The counts for one project's items. */
function countsFor(items){
  const c={total:items.length,open:0,done:0,undated:0,shared:0,private:0,qa:0,byKind:{},byLane:{}};
  items.forEach(i=>{
    if(i.status==='done')c.done++;else c.open++;
    if(!i.date)c.undated++;
    if(i.visibility==='shared')c.shared++;else c.private++;
    if(i.qa===true)c.qa++;
    const k=i.kind||'task';c.byKind[k]=(c.byKind[k]||0)+1;
    const l=i.lane||'(none)';c.byLane[l]=(c.byLane[l]||0)+1;
  });
  return c;
}
/** Every seeded milestone against what is on the board.
 *  seedRows: [{id,title,date,listId}], docs: {id: data}, record: the seed
 *  record ({itemIds}). */
function seedCheck(seedRows,docs,record,listId){
  const rec=(record&&Array.isArray(record.itemIds))?record.itemIds:[];
  return seedRows.map(r=>{
    const d=docs[r.id];
    let state;
    if(!d)state=rec.indexOf(r.id)>-1?'DELETED since seeding':'never written';
    else if(d.listId!==listId)state='moved to another list ('+d.listId+')';
    else if(d.status==='done')state='done';
    else if(d.visibility!=='shared')state='private (loaded, and counted, only for its owner)';
    else state='open, shared';
    // "Counted open" is what EVERYONE's list counter includes: in the list,
    // not done, and shared -- a private item is not even loaded for anyone
    // but its owner, so it is missing from every other person's count.
    return{id:r.id,title:r.title,seededDate:r.date,date:d?d.date:null,moved:!!(d&&d.date!==r.date),state:state,
      owner:d?d.ownerUid:null,
      countedOpen:!!(d&&d.listId===listId&&d.status!=='done'&&d.visibility==='shared')};
  });
}

module.exports={probeVerdict,mdTable,pickLists,countsFor,seedCheck};
if(require.main!==module)return;

// ── The run ─────────────────────────────────────────────────────────────
const say=s=>process.stdout.write(s+'\n');
const skip=why=>{ say('board-inspect: SKIPPED — '+why); process.exit(0); };
const [cmd,arg]=process.argv.slice(2);
const CMDS=['counts','items','item','notifications','markers','seed-check'];
if(CMDS.indexOf(cmd)<0){ say(fs.readFileSync(__filename,'utf8').split('\n').slice(4,12).map(l=>l.replace(/^\s{0,3}/,'')).join('\n')); process.exit(cmd?1:0); }

const EMU=!!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT=process.env.GOOGLE_CLOUD_PROJECT||process.env.GCLOUD_PROJECT||'';
if(!PROJECT)skip('set GOOGLE_CLOUD_PROJECT (groovy-gatepass) in your shell.');
const adcFile=process.env.GOOGLE_APPLICATION_CREDENTIALS
  ||path.join(process.env.CLOUDSDK_CONFIG||path.join(os.homedir(),'.config','gcloud'),'application_default_credentials.json');
if(!EMU&&!fs.existsSync(adcFile))skip('no Application Default Credentials at '+adcFile+' — run `gcloud auth application-default login` (see BOARD.md, "The QA identity").');
let admin;
try{ admin=require('firebase-admin'); }
catch(e){ try{ admin=require(require.resolve('firebase-admin',{paths:[process.env.EMU_DEPS||'',process.cwd()].filter(Boolean)})); }
  catch(e2){ skip('firebase-admin is not installed — run `npm install` at the repo root.'); } }

(async()=>{
  admin.initializeApp(EMU?{projectId:PROJECT}:{credential:admin.credential.applicationDefault(),projectId:PROJECT});
  const db=admin.firestore();

  if(EMU)say('> emulator at '+process.env.FIRESTORE_EMULATOR_HOST+' — no IAM to probe; reading.\n');
  else{
    let err=null;
    try{ await db.doc('board_config/inspect-probe-'+require('crypto').randomUUID()).update({probe:1}); }catch(e){ err=e; }
    const v=probeVerdict(err);
    if(!v.run){ console.error('board-inspect: REFUSED — '+v.why); process.exit(3); }
    say('> '+PROJECT+' · credential '+v.why+'\n');
  }

  const all=async col=>(await db.collection(col).get()).docs.map(d=>Object.assign({id:d.id},d.data()));
  const users={};
  (await all('user_profiles')).forEach(p=>{ users[p.id]=p.username||p.displayName||p.id; });
  const who=u=>users[u]||u||'';
  const lists=await all('board_lists');

  if(cmd==='counts'){
    const items=await all('board_items');
    const picked=pickLists(lists,arg);
    const rows=picked.map(l=>{ const c=countsFor(items.filter(i=>i.listId===l.id));
      return[l.title||l.id,l.id,c.total,c.open,c.done,c.undated,c.shared+'/'+c.private,
        Object.keys(c.byKind).map(k=>k+' '+c.byKind[k]).join(', '),
        Object.keys(c.byLane).sort().map(k=>k+' '+c.byLane[k]).join(', ')]; });
    if(!arg){ const c=countsFor(items.filter(i=>!i.listId));
      rows.push(['(no project)','—',c.total,c.open,c.done,c.undated,c.shared+'/'+c.private,
        Object.keys(c.byKind).map(k=>k+' '+c.byKind[k]).join(', '),
        Object.keys(c.byLane).sort().map(k=>k+' '+c.byLane[k]).join(', ')]); }
    say(mdTable(['project','id','items','open','done','undated','shared/private','by kind','by lane'],rows));
    say('\n"open" is what the app\'s list counters show (status != done), for every item regardless of who can read it.');
  }
  else if(cmd==='items'){
    if(!arg){ console.error('items needs a project (an id or part of a title)'); process.exit(1); }
    const picked=pickLists(lists,arg);
    if(picked.length!==1){ console.error('"'+arg+'" matches '+picked.length+' projects: '+picked.map(l=>l.title+' ('+l.id+')').join(', ')); process.exit(1); }
    const items=(await all('board_items')).filter(i=>i.listId===picked[0].id)
      .sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999'))||String(a.title).localeCompare(String(b.title)));
    say('## '+picked[0].title+' ('+picked[0].id+') — '+items.length+' items\n');
    say(mdTable(['date','title','status','visibility','kind','lane','owner','assignees','locked','id'],
      items.map(i=>[i.date||'—',i.title,i.status,i.visibility,i.kind,i.lane||'',who(i.ownerUid),
        (i.assigneeUids||[]).map(who).join(', '),i.locked?('by '+who(i.lockedBy)):'',i.id])));
  }
  else if(cmd==='item'){
    if(!arg){ console.error('item needs an item id'); process.exit(1); }
    const s=await db.doc('board_items/'+arg).get();
    if(!s.exists){ say('board_items/'+arg+' does not exist.'); process.exit(0); }
    const i=s.data();
    say('## '+i.title+'\n');
    say(mdTable(['field','value'],[['id',arg],['list',i.listId],['date',i.date],['datePlanned',i.datePlanned],
      ['status',i.status],['visibility',i.visibility],['kind',i.kind],['lane',i.lane],['owner',who(i.ownerUid)],
      ['assignees',(i.assigneeUids||[]).map(who).join(', ')],['locked',i.locked?('by '+who(i.lockedBy)):'no'],
      ['qa',i.qa===true?'yes':'no']]));
    say('\n### dateHistory ('+((i.dateHistory||[]).length)+')\n');
    say(mdTable(['at','from','to','by','reason'],(i.dateHistory||[]).map(h=>[
      h.at?new Date(h.at).toISOString():'',h.from||'—',h.to||'—',who(h.byUid),h.reason||''])));
    const acts=(await db.collection('board_items/'+arg+'/activity').get()).docs.map(d=>d.data())
      .sort((a,b)=>(a.at||0)-(b.at||0));
    say('\n### activity ('+acts.length+')\n');
    say(mdTable(['at','type','by','payload'],acts.map(a=>[a.at?new Date(a.at).toISOString():'',a.type,who(a.byUid),
      JSON.stringify(a.payload||{})])));
  }
  else if(cmd==='notifications'){
    if(!arg){ console.error('notifications needs a username'); process.exit(1); }
    const rows=(await db.collection('hrm_notifications').where('forUser','==',arg).get()).docs.map(d=>Object.assign({id:d.id},d.data()))
      .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    say('## notifications for '+arg+' — '+rows.length+'\n');
    say(mdTable(['created','source','type','title','read by','id'],rows.map(n=>[
      typeof n.createdAt==='number'?new Date(n.createdAt).toISOString():(n.createdAt||''),n.source||'',n.type||'',n.title||'',
      (n.readBy||[]).join(', '),n.id])));
  }
  else if(cmd==='markers'){
    const s=await db.doc('board_config/markers').get();
    const m=(s.exists&&s.data().markers)||[];
    say(mdTable(['date','label'],m.map(x=>[x.date,x.label||x.name||''])));
  }
  else if(cmd==='seed-check'){
    const plan=require('./board-seed-plan.js');
    const seedRows=plan.ITEMS.map(r=>({id:plan.seedId(r[1],r[2]),title:r[2],date:r[0]}));
    const refs=seedRows.map(r=>db.doc('board_items/'+r.id));
    const snaps=refs.length?await db.getAll(...refs):[];
    const docs={};snaps.forEach(s=>{ if(s.exists)docs[s.id]=s.data(); });
    const recS=await db.doc(plan.RECORD_PATH).get();
    const res=seedCheck(seedRows,docs,recS.exists?recS.data():null,plan.LIST_ID);
    const open=res.filter(r=>r.countedOpen).length;
    say('## seed check — '+seedRows.length+' seeded, '+open+' counted open for everyone in '+plan.LIST_ID+'\n');
    const off=res.filter(r=>!r.countedOpen);
    say('### not counted open ('+off.length+')\n');
    say(mdTable(['title','state','owner','seeded date','date now','id'],off.map(r=>[r.title,r.state,r.owner?who(r.owner):'',r.seededDate,r.date||'—',r.id])));
    const moved=res.filter(r=>r.moved&&r.date);
    say('\n### moved from their seeded date ('+moved.length+')\n');
    say(mdTable(['title','seeded','now','state'],moved.map(r=>[r.title,r.seededDate,r.date,r.state])));
  }
  process.exit(0);
})().catch(e=>{ console.error('board-inspect: '+(e&&e.message||e)); process.exit(1); });

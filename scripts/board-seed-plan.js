/* ─────────────────────────────────────────────────────────────────────────
   The Board — the seed, as ONE implementation.

   Two ways in, one body:
     scripts/seed-board.js              the command line (a fallback)
     netlify/functions/board-seed.js    the "Run seed" button, for Board owners

   Both hand this module a Firestore handle and an Auth handle from
   firebase-admin; neither builds a write of its own. So the two cannot
   disagree about what a seeded board is.

   This file does NOT require firebase-admin. The pure parts (the rows, the
   ids, buildSeedPlan) are what the tests read, and CI installs nothing —
   the suites here have no dependencies at all.

   IDEMPOTENT, by DETERMINISTIC ID: an item's id is derived from lane +
   title, so a re-run addresses the same documents and merges them. It also
   NEVER UNDOES REAL WORK: the fields in KEEP_FIELDS (a moved date, a
   ticked step, a handover) are written once, on create, and left alone
   after that.

   A MISSING LOGIN IS SKIPPED, NOT FATAL. The old script stopped outright if
   any of the five Auth accounts was missing, which is how a board goes
   unseeded for a day over one account nobody had created yet. Now that
   person is left off (and named in the report), an item they were the only
   assignee of is skipped (and named), and everything else is written.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';

const LIST_ID='tbl_winter_drop_2027';
const EMAIL=h=>h+'@groovy.op';
const MEMBERS=['ammar','afnan','daniyal','mustafa','saim'];
// Who holds a seeded lock, in order of preference. Both are Board owners.
const LOCKERS=['ammar','afnan'];
const MARKERS=[{label:'launch',date:'2026-10-30'},{label:'founders out',date:'2026-11-01'}];

// [date, lane, title, assignees, kind, locked]. A null date is deliberate.
const ITEMS=[
['2026-09-25','denim','Baber ENT meeting: lock sample date per article + bulk delivery date',['afnan','ammar'],'gate',true],
['2026-09-25','shoot','Brief Daniyal: models, ad assets, locations, Advegas window',['ammar','daniyal'],'task',false],
['2026-09-25','design','References start flowing to Saim via Milanote',['ammar','saim'],'task',false],
['2026-09-26','nov-ops','All-hands: sensitivity + calendar walkthrough',['ammar','afnan','daniyal','mustafa','saim'],'event',true],
['2026-09-26','shoot','CYC vendor site visit; buildout starts',['daniyal','ammar'],'event',false],
['2026-09-27','edits','Samad onboarding meeting: brief + grade references',['ammar'],'task',false],
['2026-09-28','knit','Hyderabad supplier in Karachi: lock sample date + bulk date (bulk must land by Oct 24)',['afnan','mustafa'],'gate',true],
['2026-09-28','walika','Shade list locked',['ammar'],'gate',true],
['2026-09-29','walika','Walika visit → Jibran procures → dye orders placed (200 kg MOQ per shade)',['ammar','mustafa'],'task',false],
['2026-09-29','factory','New patterns + first samples from stock fleece',['mustafa'],'task',false],
['2026-09-29','factory','Earmark used vs unused KG on the fleece swatch board',['mustafa'],'task',false],
['2026-10-03','factory','Samples approved → bulk cut starts',['ammar','mustafa'],'gate',true],
['2026-10-03','design','Design production locked; prints to floor',['ammar','saim'],'gate',true],
['2026-10-03','shoot','Shoot 1 locked: models, shot list, Advegas',['daniyal'],'gate',true],
['2026-10-03','factory','Febknit wash-shade approval (raw fleece washed line)',['ammar','mustafa'],'task',false],
['2026-10-05','shoot','CYC + wiring + fans complete',['daniyal'],'task',false],
['2026-10-05','denim','Denim shoot samples in (50/50 — confirm Sep 25)',['afnan'],'gate',false],
['2026-10-08','shoot','Shoot 1: denim + leather + blanks (Oct 8–9)',['daniyal','ammar'],'gate',true],
['2026-10-08','denim','Denim web shoot (office)',['ammar'],'task',false],
['2026-10-10','knit','Knit shoot samples in (latest for Shoot 2)',['afnan'],'gate',false],
['2026-10-12','edits','Samad first cut review — paid test',['ammar'],'gate',true],
['2026-10-15','shoot','Shoot 2: knit + outerwear + henley + washed (Oct 15–16)',['daniyal','ammar'],'gate',true],
['2026-10-17','shopify','Pricing tiers locked',['ammar','afnan'],'task',false],
['2026-10-17','walika','Dyed fabric in from Jibran (window Oct 14–20)',['mustafa'],'task',false],
['2026-10-19','shoot','Last shoot slot',['daniyal'],'task',false],
['2026-10-20','shoot','Hard content stop',['daniyal','ammar'],'gate',true],
['2026-10-24','shopify','Ad copy + headlines',['ammar','afnan'],'task',false],
['2026-10-24','leather','600 leather complete + QC',['mustafa'],'gate',false],
['2026-10-25','edits','ALL ASSETS IN — including website UI assets',['ammar'],'gate',true],
['2026-10-25','factory','First run complete + Haris QC',['mustafa'],'gate',true],
['2026-10-25','nov-ops','November runbook signed: restock triggers, daily report, cash authority',['mustafa','ammar'],'gate',true],
['2026-10-26','shoot','Creator seeding dispatch',['daniyal'],'task',false],
['2026-10-26','shopify','Shopify build, draft until launch (Oct 26–29)',['ammar'],'task',false],
['2026-10-28','shopify','Meta campaigns built (Oct 28–29)',['afnan'],'task',false],
['2026-10-29','nov-ops','Launch rehearsal: theme preview, stock count, CSR scripts, courier',['ammar','afnan','daniyal','mustafa'],'event',true],
['2026-10-30','nov-ops','LAUNCH',['ammar','afnan','daniyal','mustafa','saim'],'gate',true],
['2026-10-31','walika','Restock order #1 placed (blind, from last winter\'s shade ranking)',['mustafa'],'gate',true],
['2026-11-01','nov-ops','Founders → Islamabad; Ammar remote Nov 1–5',['ammar','afnan'],'event',false],
['2026-11-09','walika','Restock order #2 placed (on 9 days of sell-through)',['mustafa'],'gate',false],
['2026-11-20','walika','Restock order #3 placed',['mustafa'],'task',false],
[null,'denim','Denim bulk lands → Mustafa QC',['mustafa','afnan'],'gate',false],
[null,'knit','Knit bulk lands → QC',['mustafa','afnan'],'gate',false]
];

// A re-run must not undo real work. These belong to whoever has been using
// the board since the first run: written ONCE, on create, never again.
const KEEP_FIELDS=['date','status','completedAt','completedByUid','steps','notes',
                   'myDay','commentCount','dateHistory','assigneeUids','locked','lockedBy'];
// Nor may a re-run pretend the item was just touched.
const CREATE_ONLY=['createdAt','updatedAt','lastActivityAt'];

/** Deterministic, stable, and safe as a Firestore document id. */
function seedId(lane,title){
  const slug=String(title).toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
  return 'tb_'+lane+'_'+slug;
}

/**
 * Every write a seed run makes, and the report it returns. PURE: the
 * caller resolves the uids and reads what already exists.
 *
 *   uidByHandle   { ammar:'uid', … } — only the logins that exist
 *   existing      { itemId: data }   — seeded items already in Firestore
 *   listDoc       the list document if it exists, else null
 *   profiles      { uid: true }      — user_profiles rows that exist
 *   now           ms
 */
function buildSeedPlan(o){
  const uid=(o&&o.uidByHandle)||{};
  const existing=(o&&o.existing)||{};
  const listDoc=(o&&o.listDoc)||null;
  const profiles=(o&&o.profiles)||{};
  const now=Number((o&&o.now)||0);
  const writes=[];
  const report={created:0,alreadySeeded:0,skippedUsers:[],skippedItems:[],
    profilesCreated:[],listCreated:!listDoc,keptAssignees:0,items:ITEMS.length};

  MEMBERS.forEach(h=>{ if(!uid[h])report.skippedUsers.push(h); });
  const resolved=MEMBERS.filter(h=>uid[h]);
  const locker=LOCKERS.map(h=>uid[h]).filter(Boolean)[0]||null;

  // A profile row for every Board person who has a login: the Board's
  // only username<->uid link is user_profiles, so a person with no row
  // cannot be assigned or mentioned. {uid, username} with merge — the same
  // write admin-seed-profiles makes: it seeds, it never resets.
  resolved.forEach(h=>{
    writes.push({path:'user_profiles/'+uid[h],data:{uid:uid[h],username:h},merge:true,what:'profile '+h});
    if(!profiles[uid[h]])report.profilesCreated.push(h);
  });

  writes.push({path:'board_config/markers',data:{markers:MARKERS,updatedAt:now},merge:true,what:'config: markers'});

  // Members are a UNION with whoever is already on the list: a re-run adds
  // someone who was missing last time and never removes anyone.
  const had=(listDoc&&Array.isArray(listDoc.memberUids))?listDoc.memberUids:[];
  const members=had.slice();
  resolved.forEach(h=>{ if(members.indexOf(uid[h])<0)members.push(uid[h]); });
  const list={title:'Winter Drop 2027',kind:'shared',memberUids:members,color:'moss',
    emoji:null,sort:0,archived:false,updatedAt:now};
  if(!listDoc){list.adminUid=uid.ammar||locker||uid[resolved[0]]||null;list.createdAt=now;}
  writes.push({path:'board_lists/'+LIST_ID,data:list,merge:true,what:'list: Winter Drop 2027'});

  ITEMS.forEach(r=>{
    const [date,lane,title,who,kind,locked]=r;
    const id=seedId(lane,title);
    const assignees=who.filter(h=>uid[h]).map(h=>uid[h]);
    if(!assignees.length){ report.skippedItems.push(title); return; }
    const lockedBy=locked?locker:null;
    const full={
      title:title,notes:'',listId:LIST_ID,ownerUid:assignees[0],assigneeUids:assignees,
      visibility:'shared',kind:kind,date:date,datePlanned:date,dateHistory:[],
      dueAt:null,timeLabel:null,color:null,lane:lane,priority:0,
      locked:!!lockedBy,lockedBy:lockedBy,
      status:'open',completedAt:null,completedByUid:null,steps:[],attachments:[],
      myDay:{},commentCount:0,lastActivityAt:now,createdAt:now,updatedAt:now,seededAt:now
    };
    if(existing[id]){
      const data={};
      Object.keys(full).forEach(k=>{ if(KEEP_FIELDS.indexOf(k)<0&&CREATE_ONLY.indexOf(k)<0)data[k]=full[k]; });
      // An item seeded while someone was missing keeps its assignees (they
      // belong to whoever has used the board since) — but say so.
      const cur=Array.isArray(existing[id].assigneeUids)?existing[id].assigneeUids:[];
      if(assignees.some(u=>cur.indexOf(u)<0))report.keptAssignees++;
      writes.push({path:'board_items/'+id,data:data,merge:true,what:'update '+id});
      report.alreadySeeded++;
    }else{
      writes.push({path:'board_items/'+id,data:full,merge:false,what:'create '+id});
      report.created++;
    }
  });
  return{writes:writes,report:report};
}

/**
 * The run: resolve logins, read what exists, build the plan, write it.
 * `admin` is firebase-admin's namespace (for FieldPath), `db` and `auth`
 * its handles. `dryRun` writes nothing and returns the same report.
 */
async function runSeed(o){
  const db=o.db,auth=o.auth,log=o.log||function(){};
  const uidByHandle={};
  for(const h of MEMBERS){
    try{ uidByHandle[h]=(await auth.getUserByEmail(EMAIL(h))).uid; }
    catch(e){ log('No Firebase Auth account for '+EMAIL(h)+' — skipping '+h+'.'); }
  }
  const existing={};
  const ids=ITEMS.map(r=>seedId(r[1],r[2]));
  for(let i=0;i<ids.length;i+=100){
    const refs=ids.slice(i,i+100).map(id=>db.doc('board_items/'+id));
    (await db.getAll(...refs)).forEach(s=>{ if(s.exists)existing[s.id]=s.data(); });
  }
  const ls=await db.doc('board_lists/'+LIST_ID).get();
  const profiles={};
  const pu=Object.keys(uidByHandle).map(h=>uidByHandle[h]);
  if(pu.length)(await db.getAll(...pu.map(u=>db.doc('user_profiles/'+u)))).forEach(s=>{ if(s.exists)profiles[s.id]=true; });
  const plan=buildSeedPlan({uidByHandle,existing,listDoc:ls.exists?ls.data():null,profiles,now:o.now||Date.now()});
  if(!o.dryRun){
    for(let i=0;i<plan.writes.length;i+=400){
      const b=db.batch();
      plan.writes.slice(i,i+400).forEach(w=>{
        const ref=db.doc(w.path);
        if(w.merge)b.set(ref,w.data,{merge:true});else b.set(ref,w.data);
      });
      await b.commit();
    }
  }
  return Object.assign({dryRun:!!o.dryRun,writes:plan.writes.length},plan.report);
}

module.exports={LIST_ID,EMAIL,MEMBERS,LOCKERS,MARKERS,ITEMS,KEEP_FIELDS,CREATE_ONLY,seedId,buildSeedPlan,runSeed};

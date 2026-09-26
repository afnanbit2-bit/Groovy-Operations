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
   title, so a re-run addresses the same documents.

   A RE-RUN LEAVES WHAT EXISTS ALONE (review of 9e3b521, 26 Sept 2026). It
   used to merge every field but a short keep-list back onto each seeded
   item, which emptied its attachments, put back the seed title, kind,
   priority and list, made a privately-moved item shared again, and moved
   ownerUid to someone not on it. Now an existing item is not written at
   all, an existing list only gains people the seed could not add before,
   and the markers are written only if there are none. The one thing added
   to an existing item is a person the seed LEFT OFF for want of a login
   who has one now -- an arrayUnion, so it can only add, and only them.

   THE SEED KEEPS A RECORD, board_config/seed: every item id it created,
   who each one was missing, and who it put on the list. That is what lets
   a re-run tell "deleted since" from "never made" (a deleted milestone is
   not brought back), and "never added" from "taken off on purpose" (a
   person removed from the list is not put back). A board seeded before the
   record existed is adopted as it stands: nothing on it changes, and the
   record starts from what is there.

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

// Where the seed keeps its record (see the header).
const RECORD_PATH='board_config/seed';

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
 *   record        board_config/seed if it exists, else null
 *   hasMarkers    board_config/markers exists
 *   by            who ran it (an email), for the record
 *   now           ms
 *
 * A write is {path, data, merge, union?}: `union` names array fields whose
 * values are ADDED (arrayUnion), never replaced.
 */
function buildSeedPlan(o){
  const uid=(o&&o.uidByHandle)||{};
  const existing=(o&&o.existing)||{};
  const listDoc=(o&&o.listDoc)||null;
  const profiles=(o&&o.profiles)||{};
  const rec0=(o&&o.record)||null;
  const now=Number((o&&o.now)||0);
  const writes=[];
  const report={created:0,alreadySeeded:0,skippedUsers:[],skippedItems:[],
    profilesCreated:[],listCreated:!listDoc,items:ITEMS.length,
    deletedSince:[],peopleAdded:[],listMembersAdded:[],markersWritten:false,
    // Adopting = no record, but a board already there to take as it stands.
    adopted:!rec0&&(!!listDoc||Object.keys(existing).length>0)};

  MEMBERS.forEach(h=>{ if(!uid[h])report.skippedUsers.push(h); });
  const resolved=MEMBERS.filter(h=>uid[h]);
  const locker=LOCKERS.map(h=>uid[h]).filter(Boolean)[0]||null;

  // The record this run leaves. Adopting a board seeded before records
  // existed: every seeded item already there counts as made by the seed,
  // with nobody known to be missing (so nobody is added to it), and the
  // list's people count as already handled.
  const rec={
    itemIds:rec0&&Array.isArray(rec0.itemIds)?rec0.itemIds.slice():Object.keys(existing),
    missing:Object.assign({},(rec0&&rec0.missing)||{}),
    // Adopting: the people on the list AND everyone with a login now count
    // as handled, so an adopted list gains nobody -- someone missing from it
    // may have been taken off on purpose, and there is no record to say.
    members:rec0&&Array.isArray(rec0.members)?rec0.members.slice()
      :(listDoc&&Array.isArray(listDoc.memberUids)?listDoc.memberUids.slice():[])
        .concat(listDoc?resolved.map(h=>uid[h]):[]).filter((u,i,a)=>a.indexOf(u)===i),
    runs:((rec0&&rec0.runs)||0)+1,
    firstRunAt:(rec0&&rec0.firstRunAt)||now,
    lastRunAt:now,lastRunBy:(o&&o.by)||null
  };

  // A profile row for every Board person who has a login: the Board's
  // only username<->uid link is user_profiles, so a person with no row
  // cannot be assigned or mentioned. {uid, username} with merge — the same
  // write admin-seed-profiles makes: it seeds, it never resets.
  resolved.forEach(h=>{
    writes.push({path:'user_profiles/'+uid[h],data:{uid:uid[h],username:h},merge:true,what:'profile '+h});
    if(!profiles[uid[h]])report.profilesCreated.push(h);
  });

  // The markers are Board Settings' to edit once they exist.
  if(!(o&&o.hasMarkers)){
    writes.push({path:'board_config/markers',data:{markers:MARKERS,updatedAt:now},merge:false,what:'config: markers'});
    report.markersWritten=true;
  }

  // The list: made whole once. After that its title, colour, archive state
  // and admin are its owner's; the seed only adds a person it has never
  // put on it before (someone who had no login last time). Anyone the
  // record says it added and who is not there now was taken off on purpose.
  if(!listDoc){
    const members=resolved.map(h=>uid[h]);
    writes.push({path:'board_lists/'+LIST_ID,data:{title:'Winter Drop 2027',kind:'shared',memberUids:members,
      color:'moss',emoji:null,sort:0,archived:false,adminUid:uid.ammar||locker||members[0]||null,
      createdAt:now,updatedAt:now},merge:false,what:'list: Winter Drop 2027'});
    members.forEach(u=>{ if(rec.members.indexOf(u)<0)rec.members.push(u); });
  }else{
    const had=Array.isArray(listDoc.memberUids)?listDoc.memberUids:[];
    const add=resolved.filter(h=>rec.members.indexOf(uid[h])<0&&had.indexOf(uid[h])<0);
    if(add.length){
      writes.push({path:'board_lists/'+LIST_ID,data:{updatedAt:now},union:{memberUids:add.map(h=>uid[h])},
        merge:true,what:'list: add '+add.join(', ')});
      report.listMembersAdded=add;
    }
    resolved.forEach(h=>{ if(rec.members.indexOf(uid[h])<0)rec.members.push(uid[h]); });
  }

  ITEMS.forEach(r=>{
    const [date,lane,title,who,kind,locked]=r;
    const id=seedId(lane,title);
    if(existing[id]){
      report.alreadySeeded++;
      // The one addition: people the seed left off this item for want of a
      // login, who have one now.
      const was=Array.isArray(rec.missing[id])?rec.missing[id]:[];
      const now_=was.filter(h=>uid[h]);
      if(now_.length){
        writes.push({path:'board_items/'+id,data:{},union:{assigneeUids:now_.map(h=>uid[h])},
          merge:true,what:'add '+now_.join(', ')+' to '+id});
        report.peopleAdded.push({title:title,who:now_});
      }
      const still=was.filter(h=>!uid[h]);
      if(still.length)rec.missing[id]=still;else delete rec.missing[id];
      if(rec.itemIds.indexOf(id)<0)rec.itemIds.push(id);
      return;
    }
    if(rec.itemIds.indexOf(id)>-1){ report.deletedSince.push(title); return; }
    const assignees=who.filter(h=>uid[h]).map(h=>uid[h]);
    if(!assignees.length){ report.skippedItems.push(title); return; }
    const lockedBy=locked?locker:null;
    writes.push({path:'board_items/'+id,merge:false,what:'create '+id,data:{
      title:title,notes:'',listId:LIST_ID,ownerUid:assignees[0],assigneeUids:assignees,
      visibility:'shared',kind:kind,date:date,datePlanned:date,dateHistory:[],
      dueAt:null,timeLabel:null,color:null,lane:lane,priority:0,
      locked:!!lockedBy,lockedBy:lockedBy,
      status:'open',completedAt:null,completedByUid:null,steps:[],attachments:[],
      myDay:{},commentCount:0,lastActivityAt:now,createdAt:now,updatedAt:now,seededAt:now
    }});
    report.created++;
    rec.itemIds.push(id);
    const left=who.filter(h=>!uid[h]);
    if(left.length)rec.missing[id]=left;
  });

  writes.push({path:RECORD_PATH,data:rec,merge:false,what:'the seed record'});
  return{writes:writes,report:report,record:rec};
}

/**
 * The run: resolve logins, read what exists, build the plan, write it.
 * `db` and `auth` are firebase-admin handles; `fieldValue` is
 * admin.firestore.FieldValue (for arrayUnion). `dryRun` writes nothing and
 * returns the same report. `by` is who ran it, kept on the record.
 */
async function runSeed(o){
  const db=o.db,auth=o.auth,log=o.log||function(){};
  const uidByHandle={};
  for(const h of MEMBERS){
    try{ uidByHandle[h]=(await auth.getUserByEmail(EMAIL(h))).uid; }
    catch(e){
      // Only "there is no such account" means a missing login. Anything
      // else (a network blip, a quota) would make the run think a person
      // is missing when they are not, so it stops before writing anything.
      if(e&&e.code==='auth/user-not-found'){ log('No Firebase Auth account for '+EMAIL(h)+' — skipping '+h+'.'); continue; }
      throw new Error('Could not look up '+EMAIL(h)+' ('+((e&&(e.code||e.message))||e)+') — nothing was written. Try again.');
    }
  }
  const existing={};
  const ids=ITEMS.map(r=>seedId(r[1],r[2]));
  for(let i=0;i<ids.length;i+=100){
    const refs=ids.slice(i,i+100).map(id=>db.doc('board_items/'+id));
    (await db.getAll(...refs)).forEach(s=>{ if(s.exists)existing[s.id]=s.data(); });
  }
  const [ls,rs,ms]=await db.getAll(db.doc('board_lists/'+LIST_ID),db.doc(RECORD_PATH),db.doc('board_config/markers'));
  const profiles={};
  const pu=Object.keys(uidByHandle).map(h=>uidByHandle[h]);
  if(pu.length)(await db.getAll(...pu.map(u=>db.doc('user_profiles/'+u)))).forEach(s=>{ if(s.exists)profiles[s.id]=true; });
  const plan=buildSeedPlan({uidByHandle,existing,listDoc:ls.exists?ls.data():null,profiles,
    record:rs.exists?rs.data():null,hasMarkers:ms.exists,by:o.by||null,now:o.now||Date.now()});
  if(!o.dryRun){
    const FV=o.fieldValue;
    if(plan.writes.some(w=>w.union)&&!(FV&&typeof FV.arrayUnion==='function'))
      throw new Error('The seed needs FieldValue.arrayUnion to add people — nothing was written.');
    for(let i=0;i<plan.writes.length;i+=400){
      const b=db.batch();
      plan.writes.slice(i,i+400).forEach(w=>{
        const ref=db.doc(w.path);
        const data=Object.assign({},w.data);
        Object.keys(w.union||{}).forEach(f=>{ data[f]=FV.arrayUnion(...w.union[f]); });
        if(w.merge)b.set(ref,data,{merge:true});else b.set(ref,data);
      });
      await b.commit();
    }
  }
  return Object.assign({dryRun:!!o.dryRun,writes:plan.writes.length},plan.report);
}

module.exports={LIST_ID,EMAIL,MEMBERS,LOCKERS,MARKERS,ITEMS,RECORD_PATH,seedId,buildSeedPlan,runSeed};

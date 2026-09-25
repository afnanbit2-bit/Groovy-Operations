#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   The Board — seed the Winter Drop 2027 list and its milestones.

     node scripts/seed-board.js            # dry run, prints what it would do
     node scripts/seed-board.js --write    # actually writes

   Run LOCALLY by an owner, not from the app: it uses the Admin SDK, which
   bypasses security rules by design and must never be reachable from a
   browser. Plain JS, not TypeScript — this repo has no build step.

   Credentials, in the order it looks:
     FIREBASE_SERVICE_ACCOUNT   the JSON itself (what Netlify Functions use)
     GOOGLE_APPLICATION_CREDENTIALS   a path to the key file

   IDEMPOTENT, and by DETERMINISTIC ID rather than by "does something with
   this title already exist": the id is derived from lane + title, so a
   re-run addresses the same documents and a `set(..., {merge:true})`
   updates them in place. Re-running never duplicates anything, and never
   clobbers a date someone has since moved — see KEEP_FIELDS below.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
// Required INSIDE the run, not at the top: the pure exports at the foot
// of this file (the ids, the rows, KEEP_FIELDS) are what the tests read,
// and firebase-admin is not installed in CI -- the suites here have no
// dependencies at all. A top-level require would make the seed
// untestable for no benefit.
let admin=null;

const WRITE=process.argv.indexOf('--write')>-1;
const LIST_ID='tbl_winter_drop_2027';

// ── Who ───────────────────────────────────────────────────────────────
// Usernames here; resolved to Firebase uids at run time, because a uid is
// the only stable identity and nothing in the repo maps one to a name.
const EMAIL=h=>h+'@groovy.op';
const MEMBERS=['ammar','afnan','daniyal','mustafa','saim'];

// ── Config ────────────────────────────────────────────────────────────
const MARKERS=[{label:'launch',date:'2026-10-30'},{label:'founders out',date:'2026-11-01'}];

// ── The milestones (spec s12) ─────────────────────────────────────────
// [date, lane, title, assignees, kind, locked]. A null date is deliberate:
// those two land in Ammar's and Afnan's "needs a date" card on day one.
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

// A re-run must not undo real work. These fields belong to whoever has
// been using the board since the first run, so the seed writes them ONCE
// (on create) and never touches them again.
const KEEP_FIELDS=['date','status','completedAt','completedByUid','steps','notes',
                   'myDay','commentCount','dateHistory','assigneeUids','locked','lockedBy'];

/** Deterministic, stable, and safe as a Firestore document id. Derived
 *  from lane + title, so the same row always addresses the same document —
 *  which is the whole reason a re-run is safe. */
function seedId(lane,title){
  const slug=String(title).toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
  return 'tb_'+lane+'_'+slug;
}

function credential(){
  const raw=process.env.FIREBASE_SERVICE_ACCOUNT;
  if(raw)return admin.credential.cert(JSON.parse(raw));
  if(process.env.GOOGLE_APPLICATION_CREDENTIALS)return admin.credential.applicationDefault();
  console.error('No credentials. Set FIREBASE_SERVICE_ACCOUNT (the JSON) or');
  console.error('GOOGLE_APPLICATION_CREDENTIALS (a path to the key file).');
  process.exit(1);
}

// Exported so tests can check the ids, the row count and KEEP_FIELDS
// without a database. The run only happens when this file is EXECUTED,
// never when it is required.
module.exports={seedId,ITEMS,MEMBERS,MARKERS,KEEP_FIELDS,LIST_ID};
if(require.main!==module)return;

(async()=>{
  admin=require('firebase-admin');
  admin.initializeApp({credential:credential()});
  const db=admin.firestore();
  const auth=admin.auth();

  // ── resolve usernames to uids ──
  const uid={};
  for(const h of MEMBERS){
    try{ uid[h]=(await auth.getUserByEmail(EMAIL(h))).uid; }
    catch(e){
      console.error('\nNo Firebase Auth account for '+EMAIL(h)+'.');
      console.error('Create it in the Console first — see BOARD.md, "Adding the user".');
      process.exit(1);
    }
  }
  console.log('Resolved '+MEMBERS.length+' accounts.');

  const now=Date.now();
  const memberUids=MEMBERS.map(h=>uid[h]);
  const plan=[];

  plan.push({ref:db.doc('board_config/markers'),data:{markers:MARKERS,updatedAt:now},merge:true,what:'config: markers'});
  plan.push({ref:db.doc('board_lists/'+LIST_ID),what:'list: Winter Drop 2027',merge:true,data:{
    title:'Winter Drop 2027',kind:'shared',adminUid:uid.ammar,memberUids:memberUids,
    color:'moss',emoji:null,sort:0,archived:false,createdAt:now,updatedAt:now
  }});

  // Which seeded items already exist? Read first, so a re-run can leave
  // the fields people have since changed alone.
  const existing={};
  const ids=ITEMS.map(r=>seedId(r[1],r[2]));
  for(let i=0;i<ids.length;i+=100){
    const refs=ids.slice(i,i+100).map(id=>db.doc('board_items/'+id));
    (await db.getAll(...refs)).forEach(s=>{ if(s.exists)existing[s.id]=s.data(); });
  }

  ITEMS.forEach(r=>{
    const [date,lane,title,who,kind,locked]=r;
    const id=seedId(lane,title);
    const owner=uid[who[0]];
    const assignees=who.map(h=>uid[h]);
    const full={
      title:title,notes:'',listId:LIST_ID,ownerUid:owner,assigneeUids:assignees,
      visibility:'shared',kind:kind,date:date,datePlanned:date,dateHistory:[],
      dueAt:null,timeLabel:null,color:null,lane:lane,priority:0,
      locked:!!locked,lockedBy:locked?uid.ammar:null,
      status:'open',completedAt:null,completedByUid:null,steps:[],attachments:[],
      myDay:{},commentCount:0,lastActivityAt:now,createdAt:now,updatedAt:now,seededAt:now
    };
    if(existing[id]){
      const data={};
      Object.keys(full).forEach(k=>{ if(KEEP_FIELDS.indexOf(k)<0&&k!=='createdAt')data[k]=full[k]; });
      plan.push({ref:db.doc('board_items/'+id),data:data,merge:true,what:'update  '+id,already:true});
    }else{
      plan.push({ref:db.doc('board_items/'+id),data:full,merge:false,what:'create  '+id});
    }
  });

  const fresh=plan.filter(p=>!p.already).length;
  console.log('\n'+plan.length+' documents — '+fresh+' new, '+(plan.length-fresh)+' already seeded.');
  plan.forEach(p=>console.log('  '+p.what));

  if(!WRITE){
    console.log('\nDry run. Nothing was written. Re-run with --write.');
    process.exit(0);
  }
  for(let i=0;i<plan.length;i+=400){
    const b=db.batch();
    plan.slice(i,i+400).forEach(p=>p.merge?b.set(p.ref,p.data,{merge:true}):b.set(p.ref,p.data));
    await b.commit();
  }
  console.log('\nWritten. Re-running is safe: ids are derived from lane + title,');
  console.log('and a re-run leaves dates, status, steps and notes as they are.');
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });

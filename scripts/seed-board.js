#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   The Board — seed the Winter Drop 2027 list and its milestones, from the
   command line. THE FALLBACK: the normal way is the "Run seed" button in
   Board settings (Board owners), which runs the SAME code on Netlify.

     node scripts/seed-board.js              # writes
     node scripts/seed-board.js --dry-run    # prints what it would write

   It WRITES BY DEFAULT (session 2). It used to be a dry run unless
   --write was passed, which is one of the ways the board went live with
   nothing on it.

   Credentials, in the order it looks:
     FIREBASE_SERVICE_ACCOUNT          the JSON itself (what Netlify uses)
     GOOGLE_APPLICATION_CREDENTIALS    a path to the key file

   Idempotent by deterministic id; never undoes real work; a missing login
   is skipped with a warning, never fatal. The whole body lives in
   scripts/board-seed-plan.js — read its header.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const plan=require('./board-seed-plan.js');

// Re-exported: tests read the rows and ids from here as well as from the
// plan module. The run only happens when this file is EXECUTED.
module.exports=plan;
if(require.main!==module)return;

const DRY=process.argv.indexOf('--dry-run')>-1;

(async()=>{
  const admin=require('firebase-admin');
  let cred;
  if(process.env.FIREBASE_SERVICE_ACCOUNT)cred=admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  else if(process.env.GOOGLE_APPLICATION_CREDENTIALS)cred=admin.credential.applicationDefault();
  else{
    console.error('No credentials. Set FIREBASE_SERVICE_ACCOUNT (the JSON) or');
    console.error('GOOGLE_APPLICATION_CREDENTIALS (a path to the key file).');
    console.error('Or use the "Run seed" button in Board settings instead — it needs neither.');
    process.exit(1);
  }
  admin.initializeApp({credential:cred});
  const r=await plan.runSeed({db:admin.firestore(),auth:admin.auth(),dryRun:DRY,now:Date.now(),
    log:m=>console.warn('WARNING: '+m)});
  console.log((DRY?'DRY RUN — nothing written.\n':'Written.\n')
    +'  items created:        '+r.created+'\n'
    +'  items already seeded: '+r.alreadySeeded+' (dates, status, steps and people left as they are)\n'
    +'  profile rows created: '+(r.profilesCreated.join(', ')||'none')+'\n'
    +'  list:                 '+(r.listCreated?'created':'already there')+'\n'
    +(r.skippedUsers.length?'  SKIPPED (no login):   '+r.skippedUsers.join(', ')+'\n':'')
    +(r.skippedItems.length?'  SKIPPED items (their only assignee has no login):\n    '+r.skippedItems.join('\n    ')+'\n':'')
    +(r.keptAssignees?'  '+r.keptAssignees+' already-seeded item(s) name someone they do not carry — left alone\n':''));
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });

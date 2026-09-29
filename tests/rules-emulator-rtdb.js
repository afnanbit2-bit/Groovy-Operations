/* ─────────────────────────────────────────────────────────────────────────
   tests/rules-emulator-rtdb.js — database.rules.json (Realtime Database),
   QA read-everything edition (29 Sept 2026).

   The decision: claude@groovy.op reads everything the RTDB rules define.
   They define exactly one path, `attendance`, and its `.read` is
   `auth != null`, which already admits QA — so database.rules.json is
   BYTE-IDENTICAL to origin/main (this test asserts that), and nothing has to
   be republished for RTDB. The rest of the tree is denied to everyone.

   Not a *.test.js (needs the RTDB emulator). Run from a scratch directory so
   the repo's firebase.json is not used (RTDB rules are published by hand):

     mkdir -p /tmp/rtdb && cd /tmp/rtdb
     echo '{"database":{"rules":"database.rules.json"},"emulators":{"database":{"port":9000},"ui":{"enabled":false}}}' > firebase.json
     cp <repo>/database.rules.json . ; git -C <repo> show origin/main:database.rules.json > old.rules.json
     EMU_DEPS=/tmp/emu/node_modules RULES_DIR=/tmp/rtdb REPO=<repo> \
       /tmp/emu/node_modules/.bin/firebase emulators:exec --only database --project demo-rtdb \
       "node <repo>/tests/rules-emulator-rtdb.js"
   ───────────────────────────────────────────────────────────────────────── */
const fs=require('fs');
const dep=p=>require(require.resolve(p,{paths:[process.env.EMU_DEPS,process.cwd()].filter(Boolean)}));
const {initializeTestEnvironment}=dep('@firebase/rules-unit-testing');
const {ref,get,set}=dep('firebase/database');
const DIR=process.env.RULES_DIR||process.cwd();
let fail=0,pass=0;
const check=(n,c)=>{if(c){pass++;console.log('  ok   '+n);}else{fail++;console.log('  FAIL '+n);}};
(async()=>{
  const res={};
  const oldTxt=fs.readFileSync(DIR+'/old.rules.json','utf8'),newTxt=fs.readFileSync(DIR+'/database.rules.json','utf8');
  for(const [label,txt] of [['old',oldTxt],['new',newTxt]]){
    const env=await initializeTestEnvironment({projectId:'demo-rtdb-'+label,database:{rules:txt,host:'127.0.0.1',port:9000}});
    await env.withSecurityRulesDisabled(async c=>{await set(ref(c.database(),'attendance/2026-09-29/k1'),{name:'User1'});await set(ref(c.database(),'somewhere-else/x'),{v:1});});
    const who={owner:env.authenticatedContext('u1',{email:'afnan@groovy.op'}),worker:env.authenticatedContext('u2',{email:'haris@groovy.op'}),qa:env.authenticatedContext('uq',{email:'claude@groovy.op'}),anon:env.unauthenticatedContext()};
    res[label]={};
    for(const [n,c] of Object.entries(who)){
      let r=true,w=false,o=true,day=true;
      try{await get(ref(c.database(),'attendance/2026-09-29'));}catch(e){r=false;}
      try{await get(ref(c.database(),'attendance/2026-09-29/k1'));}catch(e){day=false;}
      try{await set(ref(c.database(),'attendance/2026-09-29/k2'),{x:1});w=true;}catch(e){}
      try{await get(ref(c.database(),'somewhere-else'));}catch(e){o=false;}
      res[label][n]={read:r,leaf:day,write:w,other:o};
    }
    await env.cleanup();
  }
  console.log('RTDB attendance');
  check('database.rules.json is byte-identical to origin/main (nothing to republish for RTDB)',oldTxt===newTxt);
  check('QA reads attendance (a day, and a single record)',res.new.qa.read===true&&res.new.qa.leaf===true);
  check('QA cannot write attendance (clients never write RTDB; Admin SDK only)',res.new.qa.write===false);
  for(const p of ['owner','worker','anon'])check('unchanged for '+p+' (read '+res.old[p].read+', write '+res.old[p].write+')',res.old[p].read===res.new[p].read&&res.old[p].write===res.new[p].write&&res.old[p].other===res.new[p].other);
  check('the unauthenticated cannot read attendance',res.new.anon.read===false);
  check('nobody writes attendance from a client',['owner','worker','qa','anon'].every(p=>res.new[p].write===false));
  check('nothing outside attendance is readable by anyone, QA included (no rule defines it)',['owner','worker','qa','anon'].every(p=>res.new[p].other===false));
  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});

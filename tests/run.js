#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Test runner.  `node tests/run.js`  (or `node tests/run.js boards`)

   No dependencies, no framework — same zero-new-deps policy as the app.
   Exits non-zero if anything fails, which is what the GitHub Action reads.

   Read the header of tests/harness.js for what these tests can and cannot
   prove. Short version: they check logic, not looks.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');

const only=process.argv.slice(2).filter(a=>!a.startsWith('-'));
const files=fs.readdirSync(__dirname)
  .filter(f=>f.endsWith('.test.js'))
  .filter(f=>!only.length||only.some(o=>f.indexOf(o)!==-1))
  .sort();

if(!files.length){
  console.error('No test files matched '+JSON.stringify(only));
  process.exit(1);
}

/* A suite that awaits a promise that never settles used to end the run with
   exit 0: once nothing is left to wait for, Node simply exits, and the pending
   async function is dropped without a word — a green tick for a run that never
   finished. Two guards, both naming the suite that was still pending:
     · process 'exit' while the run is unfinished (the event loop drained with
       a suite still pending) -> print it and exit 1, at once;
     · a watchdog timer for a suite that hangs while something keeps the loop
       alive (an interval, a socket): TEST_SUITE_TIMEOUT_MS per suite, default
       20 minutes. The timer is unref'd so it never keeps a finished run alive.
   Neither touches the output the CI greps ('all N assertions passed'). */
const SUITE_LIMIT_MS=(()=>{const n=Number(process.env.TEST_SUITE_TIMEOUT_MS);return n>0&&isFinite(n)?n:20*60*1000;})();
let pendingSuite=null,runFinished=false,dog=null,reported=false;
function pendingFail(why){
  if(reported)return;            // the watchdog's process.exit() also fires the 'exit' hook below
  reported=true;
  console.log('\n\x1b[31mFAIL suite "'+pendingSuite+'" '+why+'\x1b[0m');
  console.log('  (a test is awaiting a promise that never settles — the run did not finish)\n');
}
process.on('exit',()=>{
  if(runFinished||pendingSuite===null)return;
  pendingFail('never settled: the run ended with it still pending');
  process.exitCode=1;
});

(async()=>{
  let pass=0,fail=0;
  const failures=[];
  for(const f of files){
    const name=f.replace('.test.js','');
    console.log('\n\x1b[1m'+name+'\x1b[0m');
    pendingSuite=name;
    dog=setTimeout(()=>{pendingFail('did not settle within '+Math.round(SUITE_LIMIT_MS/1000)+'s (TEST_SUITE_TIMEOUT_MS)');process.exit(1);},SUITE_LIMIT_MS);
    dog.unref();
    let s;
    try{
      s=await require(path.join(__dirname,f))();
    }catch(e){
      clearTimeout(dog);pendingSuite=null;
      console.log('    FAIL suite threw: '+(e&&e.stack||e));
      fail++;failures.push(name+' / suite threw: '+(e&&e.message||e));
      continue;
    }
    clearTimeout(dog);pendingSuite=null;
    pass+=s.pass;fail+=s.fail;
    s.failures.forEach(x=>failures.push(name+' / '+x));
  }
  runFinished=true;
  console.log('\n'+'─'.repeat(60));
  if(fail){
    console.log('\x1b[31m'+fail+' failed\x1b[0m, '+pass+' passed\n');
    failures.forEach(x=>console.log('  ✗ '+x));
    console.log('');
    process.exit(1);
  }
  console.log('\x1b[32mall '+pass+' assertions passed\x1b[0m\n');
})();

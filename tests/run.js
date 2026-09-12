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

(async()=>{
  let pass=0,fail=0;
  const failures=[];
  for(const f of files){
    const name=f.replace('.test.js','');
    console.log('\n\x1b[1m'+name+'\x1b[0m');
    let s;
    try{
      s=await require(path.join(__dirname,f))();
    }catch(e){
      console.log('    FAIL suite threw: '+(e&&e.stack||e));
      fail++;failures.push(name+' / suite threw: '+(e&&e.message||e));
      continue;
    }
    pass+=s.pass;fail+=s.fail;
    s.failures.forEach(x=>failures.push(name+' / '+x));
  }
  console.log('\n'+'─'.repeat(60));
  if(fail){
    console.log('\x1b[31m'+fail+' failed\x1b[0m, '+pass+' passed\n');
    failures.forEach(x=>console.log('  ✗ '+x));
    console.log('');
    process.exit(1);
  }
  console.log('\x1b[32mall '+pass+' assertions passed\x1b[0m\n');
})();

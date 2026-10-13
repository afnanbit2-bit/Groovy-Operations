/* ─────────────────────────────────────────────────────────────────────────
   tests/run.js must not call a run that never finished a pass (Oct 2026).

   A suite that awaits a promise which never settles used to end the whole run
   with exit 0: Node exits once nothing is left to wait for, and the pending
   async function is dropped in silence. run.js now (1) fails at once, naming
   the suite, when the process exits with a suite still pending, and (2) fails
   a suite that hangs while something keeps the loop alive after
   TEST_SUITE_TIMEOUT_MS (default 20 minutes). The line the CI greps —
   "all N assertions passed" — is unchanged.

   Each case copies the REAL tests/run.js into a scratch directory next to a
   tiny fake suite and runs it as a child process, so what is asserted is the
   runner itself, not a re-implementation.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');
const {suite}=require('./harness');

const RUNNER=fs.readFileSync(path.join(__dirname,'run.js'),'utf8');

function runWith(files,env){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gv-runner-'));
  try{
    fs.writeFileSync(path.join(dir,'run.js'),RUNNER);
    Object.keys(files).forEach(f=>fs.writeFileSync(path.join(dir,f),files[f]));
    const r=spawnSync(process.execPath,[path.join(dir,'run.js')],{encoding:'utf8',timeout:60000,env:Object.assign({},process.env,{TEST_SUITE_TIMEOUT_MS:''},env||{})});
    return{code:r.status,out:(r.stdout||'')+(r.stderr||''),signal:r.signal};
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
const passing="module.exports=async()=>({pass:3,fail:0,failures:[]});";
const neverSettles="module.exports=()=>new Promise(()=>{});";
const hangsWithHandle="module.exports=()=>new Promise(()=>{setInterval(()=>{},1000);});";

module.exports=async function(){
  const s=suite('run-watchdog');
  // The child's whole output is only attached to a FAILING assertion: a passing one would otherwise
  // print the child's own 'all N assertions passed' into this suite's log.
  const ok=(label,cond,detail)=>s.ok(label,cond,cond?undefined:detail);

  s.section('a healthy run is unchanged');
  {
    const r=runWith({'a.test.js':passing,'b.test.js':passing});
    s.eq('exits 0',r.code,0);
    ok('and prints the line the CI greps, with the total',/all 6 assertions passed/.test(r.out),r.out.slice(-200));
    s.ok('no watchdog message',!/never settled|did not settle/.test(r.out));
  }

  s.section('a failing suite still exits 1 the way it always did');
  {
    const r=runWith({'a.test.js':"module.exports=async()=>({pass:1,fail:1,failures:['x / broke']});"});
    s.eq('exits 1',r.code,1);
    ok('with the old summary line',/1 failed/.test(r.out)&&/x \/ broke/.test(r.out),r.out.slice(-200));
  }

  s.section('a suite that never settles, with nothing else running, fails the run and names itself');
  {
    const r=runWith({'a.test.js':passing,'hang.test.js':neverSettles,'z.test.js':passing});
    s.eq('exits 1, not 0',r.code,1);
    ok('names the suite still pending',/FAIL suite "hang" never settled/.test(r.out),r.out.slice(-300));
    s.ok('never claims the run passed',!/assertions passed/.test(r.out));
  }

  s.section('a suite that hangs while something keeps the loop alive fails at the limit');
  {
    const t0=Date.now();
    const r=runWith({'hang.test.js':hangsWithHandle},{TEST_SUITE_TIMEOUT_MS:'700'});
    s.eq('exits 1',r.code,1);
    ok('names the suite and the limit',/FAIL suite "hang" did not settle within 1s \(TEST_SUITE_TIMEOUT_MS\)/.test(r.out),r.out.slice(-300));
    ok('and does so at the limit, not minutes later',Date.now()-t0<30000,String(Date.now()-t0));
    s.ok('never claims the run passed',!/assertions passed/.test(r.out));
  }

  s.section('the limit does not fire on a suite that finishes in time, and a bad value falls back');
  {
    const slow="module.exports=()=>new Promise(r=>setTimeout(()=>r({pass:2,fail:0,failures:[]}),300));";
    const r=runWith({'slow.test.js':slow},{TEST_SUITE_TIMEOUT_MS:'5000'});
    ok('a suite inside its limit passes',r.code===0&&/all 2 assertions passed/.test(r.out),r.out.slice(-200));
    const bad=runWith({'slow.test.js':slow},{TEST_SUITE_TIMEOUT_MS:'banana'});
    ok('a nonsense value means the default, not "fire at once"',bad.code===0&&/all 2 assertions passed/.test(bad.out),bad.out.slice(-200));
    s.ok('the default is documented as 20 minutes in the runner',/20\*60\*1000/.test(RUNNER));
  }

  return s;
};

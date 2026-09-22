/* ─────────────────────────────────────────────────────────────────────────
   attendance-sync/pull.js — the Raspberry Pi K40 puller.

   Written when the Pi route was chosen over ADMS push. The script had been
   committed but never run, and reviewing it against node-zklib's real API
   turned up four faults, each of which this suite pins:

   - a POST whose reply was not checked, so a Netlify 502 advanced the cursor
     and the punches behind it were lost for good;
   - no heartbeat when nobody punched, so the app's sync pill could not tell a
     DEAD puller from a quiet night;
   - in/out hardcoded to 0, because the ZK record carries no check-state —
     every punch read as a check-in and the live board never emptied;
   - no re-entrancy guard, so a slow tick could race the cursor.

   The strongest assertion here is the round-trip: what buildLines() emits is
   fed to the REAL netlify/functions/iclock.js handler, so the two halves
   cannot drift apart on the wire format.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const path=require('path');
const Module=require('module');
const {EventEmitter}=require('events');
const {suite}=require('./harness');

const ROOT=path.resolve(__dirname,'..');
const PULL=path.join(ROOT,'attendance-sync','pull.js');
const ICLOCK=path.join(ROOT,'netlify','functions','iclock.js');

// node-zklib is only installed on the Pi, and firebase-admin only on Netlify.
// Neither is a repo-root dependency, so both are stubbed for the load.
const rtdb={};
const adminStub={
  apps:[],initializeApp(){adminStub.apps.push({});},
  credential:{cert:x=>x},
  database:()=>({ref:p=>({set:async v=>{rtdb[p]={op:'set',v};},update:async v=>{rtdb[p]={op:'update',v};}})})
};
function withStubs(fn){
  const orig=Module._load;
  Module._load=function(req){
    if(req==='node-zklib')return function ZKLibStub(){};
    if(req==='firebase-admin')return adminStub;
    return orig.apply(this,arguments);
  };
  try{return fn();}finally{Module._load=orig;}
}

const at=str=>({t:new Date(str)});
const punch=(id,str)=>({id,t:new Date(str)});
const fields=line=>line.split('\t');

module.exports=async function(){
  const s=suite('attendance-puller');

  process.env.FIREBASE_SERVICE_ACCOUNT=JSON.stringify({project_id:'groovy-gatepass'});
  let pull,iclock;
  withStubs(()=>{
    delete require.cache[require.resolve(PULL)];
    delete require.cache[require.resolve(ICLOCK)];
    pull=require(PULL);
    iclock=require(ICLOCK);
  });

  const empty={last:'',day:'',users:{}};

  s.section('in/out is derived, because the protocol does not carry it');
  {
    // node-zklib's decodeRecordData40 returns {userSn, deviceUserId,
    // recordTime} and nothing else — there is no check-state to read.
    const {lines,state}=pull.buildLines([
      punch('7','2026-09-22 09:14:03'),
      punch('7','2026-09-22 13:02:00'),
      punch('7','2026-09-22 13:48:00'),
      punch('7','2026-09-22 18:30:00')
    ],empty);
    s.eq('four punches → four lines',lines.length,4);
    s.eq('1st is check-in',fields(lines[0])[2],'0');
    s.eq('2nd is check-out',fields(lines[1])[2],'1');
    s.eq('3rd is check-in again',fields(lines[2])[2],'0');
    s.eq('4th is check-out',fields(lines[3])[2],'1');
    s.eq('cursor is the last punch',state.last,'2026-09-22 18:30:00');
    s.eq('the day is recorded',state.day,'2026-09-22');
  }

  s.section('each person alternates independently');
  {
    const {lines}=pull.buildLines([
      punch('7','2026-09-22 09:00:00'),
      punch('12','2026-09-22 09:05:00'),
      punch('7','2026-09-22 18:00:00'),
      punch('12','2026-09-22 18:05:00')
    ],empty);
    s.eq('7 in',fields(lines[0])[2],'0');
    s.eq('12 in (not inheriting 7\'s parity)',fields(lines[1])[2],'0');
    s.eq('7 out',fields(lines[2])[2],'1');
    s.eq('12 out',fields(lines[3])[2],'1');
  }

  s.section('parity survives across pulls, and resets on a new day');
  {
    const first=pull.buildLines([punch('7','2026-09-22 09:00:00')],empty);
    s.eq('pull 1: in',fields(first.lines[0])[2],'0');
    const second=pull.buildLines([punch('7','2026-09-22 18:00:00')],first.state);
    s.eq('pull 2 carries the count forward: out',fields(second.lines[0])[2],'1');
    // Somebody forgot to punch out; tomorrow must not start inverted.
    const next=pull.buildLines([punch('7','2026-09-23 09:00:00')],second.state);
    s.eq('a new day starts at in again',fields(next.lines[0])[2],'0');
    s.eq('and the day rolled',next.state.day,'2026-09-23');
  }

  s.section('a double-tap is swallowed, but never re-read');
  {
    const {lines,state}=pull.buildLines([
      punch('7','2026-09-22 09:00:00'),
      punch('7','2026-09-22 09:00:02')   // same badge, two seconds later
    ],empty);
    s.eq('only one line forwarded',lines.length,1);
    s.eq('and it is the check-in',fields(lines[0])[2],'0');
    // If the cursor stopped at 09:00:00 the duplicate would come back every
    // tick forever, and each pass would re-evaluate the parity.
    s.eq('the cursor still passes the swallowed punch',state.last,'2026-09-22 09:00:02');
    s.eq('the swallowed punch did not consume a parity step',state.users['7'].n,1);
    // A genuine out-punch later in the day must still read as out.
    const later=pull.buildLines([punch('7','2026-09-22 18:00:00')],state);
    s.eq('a real second punch is still out',fields(later.lines[0])[2],'1');
  }

  s.section('the wire format the receiver expects');
  {
    const {lines}=pull.buildLines([punch('7','2026-09-22 09:14:03')],empty);
    const f=fields(lines[0]);
    s.eq('six tab-separated fields',f.length,6);
    s.eq('field 0 is the K40 user id',f[0],'7');
    s.eq('field 1 is YYYY-MM-DD HH:MM:SS',f[1],'2026-09-22 09:14:03');
    s.ok('the timestamp is lexicographically sortable',
      '2026-09-22 09:14:03'<'2026-09-22 13:00:00');
  }

  s.section('ROUND TRIP — the real iclock receiver reads what we emit');
  {
    const {lines}=pull.buildLines([
      punch('7','2026-09-22 09:14:03'),
      punch('7','2026-09-22 18:30:00')
    ],empty);
    let r;
    await withStubs(async()=>{
      r=await iclock.handler({
        httpMethod:'POST',path:'/iclock/cdata',
        queryStringParameters:{SN:'PULLER-pi',table:'ATTLOG'},
        body:lines.join('\n')
      });
    });
    s.eq('receiver accepts both rows',r.body,'OK: 2');
    const inRec=(rtdb['attendance/2026-09-22/7/2026-09-22-09-14-03']||{}).v;
    const outRec=(rtdb['attendance/2026-09-22/7/2026-09-22-18-30-00']||{}).v;
    s.ok('the morning punch was stored',!!inRec);
    s.eq('  and reads as in',inRec&&inRec.type,'in');
    s.ok('the evening punch was stored',!!outRec);
    s.eq('  and reads as OUT — the live board can empty',outRec&&outRec.type,'out');
    const meta=(rtdb['attendance/_meta']||{}).v;
    s.eq('the puller is identifiable in the heartbeat',meta&&meta.sn,'PULLER-pi');
  }

  s.section('an empty POST is a valid heartbeat');
  {
    let r;
    await withStubs(async()=>{
      r=await iclock.handler({
        httpMethod:'POST',path:'/iclock/cdata',
        queryStringParameters:{SN:'PULLER-pi',table:'ATTLOG'},body:''
      });
    });
    // This is what lets the sync pill mean something overnight: no punches is
    // still proof of life, and needs no change on the server to work.
    s.eq('receiver answers OK: 0',r.body,'OK: 0');
    s.ok('and still stamps _meta',!!rtdb['attendance/_meta']);
  }

  s.section('post() refuses to call a failure a success');
  {
    const https=require('https');
    const real=https.request;
    const fake=(status,body)=>{
      https.request=(opts,cb)=>{
        const req=new EventEmitter();
        req.setTimeout=()=>{};req.write=()=>{};
        req.end=()=>{
          const res=new EventEmitter();
          res.statusCode=status;
          cb(res);
          res.emit('data',body);res.emit('end');
        };
        return req;
      };
    };
    const caught=async()=>{try{return{v:await pull.post(['x'])};}catch(e){return{e:e.message};}};

    fake(200,'OK: 3');
    s.eq('a confirmed write resolves with the count',(await caught()).v,3);

    fake(502,'<html>Bad gateway</html>');
    let r=await caught();
    s.ok('a 502 rejects',!!r.e,r.e);
    s.ok('  and the message names the status',/502/.test(r.e||''),r.e);

    // The receiver catches its OWN errors and answers a bare "OK" with status
    // 200. Trusting the status code alone would advance the cursor here and
    // lose every punch in the batch — this is the data-loss guard.
    fake(200,'OK');
    r=await caught();
    s.ok('a bare "OK" (the receiver\'s catch path) rejects',!!r.e,r.e);

    fake(200,'<!DOCTYPE html><html>index.html</html>');
    r=await caught();
    s.ok('the SPA fallback page rejects',!!r.e,r.e);

    https.request=real;
  }

  s.section('the source still holds the guards');
  {
    const src=require('fs').readFileSync(PULL,'utf8');
    s.ok('the cursor is saved only after a post',
      /const\s+accepted\s*=\s*await\s+post\(lines\);[\s\S]{0,400}saveState\(state\)/.test(src));
    s.ok('an idle tick still posts a heartbeat',/if\s*\(!fresh\.length\)\s*\{\s*await post\(\[\]\)/.test(src));
    s.ok('a re-entrancy guard exists',/if\s*\(running\)/.test(src)&&/running\s*=\s*true/.test(src));
    s.ok('  and it is released in a finally',/finally\s*\{[\s\S]{0,200}running\s*=\s*false/.test(src));
    s.ok('the POST carries a timeout',/req\.setTimeout\(POST_TIMEOUT_MS/.test(src));
    s.ok('nothing hardcodes the check-state to 0 any more',!/\\t0\\t1\\t0\\t0`/.test(src));
    s.ok('no Firebase credential is referenced here',!/FIREBASE_SERVICE_ACCOUNT|serviceAccount|private_key/.test(src));
  }

  return s;
};

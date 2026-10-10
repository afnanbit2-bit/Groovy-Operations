/* ─────────────────────────────────────────────────────────────────────────
   Shopify sync watchdog — netlify/functions/shopify-sync-watchdog-background.js

   The watchdog gets an injected Admin-style db and injected handlers, so no
   firebase-admin is needed. The db below is an in-memory Firestore that
   COUNTS reads, writes and collection scans. All times are fixed UTC ms,
   every expected value is computed by hand in the comment beside it.
   Proves the rules (retry gating, back-off, daily cap, alert-once, no
   writes when healthy, one throwing handler does not stop the other).
   It does NOT prove the real sync handlers set the meta fields this way
   (that was read from the functions, not run) nor what Firestore bills.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);

const dir=path.join(ROOT,'netlify','functions');
const FILE=['shopify-sync-watchdog-background.js','shopify-sync-watchdog.js'].map(f=>path.join(dir,f)).find(f=>fs.existsSync(f));

const MIN=60000,HOUR=3600000;
const Ts=ms=>({toMillis:()=>ms,toDate:()=>new Date(ms)});     // Firestore Timestamp stand-in
const utc=(y,mo,d,h,mi)=>Date.UTC(y,mo-1,d,h||0,mi||0);
const NOW=utc(2026,10,10,12,0);                                // 2026-10-10 12:00 UTC

function makeDb(){
  const st={docs:{},reads:0,writes:[],scans:0,readPaths:[]};
  const clone=v=>{
    if(v&&typeof v==='object'){
      if(typeof v.toMillis==='function')return v;
      if(Array.isArray(v))return v.map(clone);
      const o={};for(const k of Object.keys(v))o[k]=clone(v[k]);return o;
    }
    return v;
  };
  const merge=(a,b)=>{for(const k of Object.keys(b)){
    if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&typeof b[k].toMillis!=='function'&&a[k]&&typeof a[k]==='object'&&typeof a[k].toMillis!=='function')merge(a[k],b[k]);
    else a[k]=clone(b[k]);}return a;};
  const ref=(col,id)=>({
    id,path:col+'/'+id,
    async get(){st.reads++;st.readPaths.push(col+'/'+id);const d=st.docs[col+'/'+id];return{id,exists:!!d,data:()=>d?clone(d):undefined};},
    async set(data,opt){st.writes.push(col+'/'+id);
      st.docs[col+'/'+id]=opt&&opt.merge?merge(st.docs[col+'/'+id]||{},data):clone(data);},
    async create(data){if(st.docs[col+'/'+id])throw new Error('ALREADY_EXISTS');st.writes.push(col+'/'+id);st.docs[col+'/'+id]=clone(data);},
    async update(data){if(!st.docs[col+'/'+id])throw new Error('NOT_FOUND');st.writes.push(col+'/'+id);merge(st.docs[col+'/'+id],data);}
  });
  const db={
    collection:col=>({
      doc:id=>ref(col,id),
      async get(){st.scans++;throw new Error('collection scan');},
      where(){st.scans++;return{async get(){throw new Error('collection scan');},limit(){return this;}};},
      orderBy(){st.scans++;return{async get(){throw new Error('collection scan');},limit(){return this;}};},
      limit(){st.scans++;return{async get(){throw new Error('collection scan');}};}
    }),
    async getAll(...r){return Promise.all(r.map(x=>x.get()));},
    batch(){const ops=[];return{set:(r,d,o)=>ops.push(()=>r.set(d,o)),create:(r,d)=>ops.push(()=>r.create(d)),update:(r,d)=>ops.push(()=>r.update(d)),async commit(){for(const f of ops)await f();}};},
    async runTransaction(fn){const w=[];const out=await fn({get:r=>r.get(),set:(r,d,o)=>w.push(()=>r.set(d,o)),create:(r,d)=>w.push(()=>r.create(d)),update:(r,d)=>w.push(()=>r.update(d))});for(const f of w)await f();return out;}
  };
  return{db,st};
}
const META='shopify_sync_meta/';
const okMeta=ms=>({last_status:'success',last_success_at:Ts(ms),last_run_at:Ts(ms),last_error:null,last_error_reason:null});
const failMeta=(runMs,okMs,err,reason)=>({last_status:'error',last_success_at:okMs==null?null:Ts(okMs),last_run_at:Ts(runMs),last_error:err||'boom',last_error_reason:reason||'error'});
const QUOTA='8 RESOURCE_EXHAUSTED: Quota exceeded.';

// handlers that behave like the real syncs: they rewrite their own meta doc
function makeHandlers(st,plan,clockRef){
  const calls=[];
  const h={};
  for(const src of ['catalog_sync','inventory_sync']){
    h[src]=async()=>{
      calls.push(src);
      const p=(plan[src]||{});
      if(p.throws)throw new Error(p.throws);
      const at=clockRef.now;
      if(p.fail)st.docs[META+src]=failMeta(at,(st.docs[META+src]||{}).last_success_at?(st.docs[META+src].last_success_at.toMillis()):null,p.fail,p.reason||'error');
      else st.docs[META+src]=okMeta(at);
    };
  }
  return{h,calls};
}

module.exports=async function(){
  const s=suite('shopify-sync-watchdog');
  if(!FILE){s.ok('the watchdog function file exists',false,'netlify/functions/shopify-sync-watchdog[-background].js not found');return s;}
  const W=require(FILE);
  const {decideRetry:D,backoffMs:B,run}=W;
  const C=W.constants;

  s.section('the contract is exported');
  s.ok('decideRetry, backoffMs and run are functions',typeof D==='function'&&typeof B==='function'&&typeof run==='function');
  s.eq('two sources only',J(Object.keys(W.SOURCES)),J(['catalog_sync','inventory_sync']));
  s.eq('catalog interval 24 h',W.SOURCES.catalog_sync.intervalMs,24*HOUR);
  s.eq('stock snapshot interval 12 h',W.SOURCES.inventory_sync.intervalMs,12*HOUR);
  s.eq('daily cap is 8',C.MAX_ATTEMPTS_PER_DAY,8);
  s.eq('the no-retry guard is 10 minutes',C.MIN_GAP_AFTER_RUN_MS,10*MIN);
  s.eq('stale factor is 1.5',C.STALE_FACTOR,1.5);
  s.eq('alert after 48 h',C.ALERT_AFTER_MS,48*HOUR);
  s.eq('alert after 3 failed retries',C.ALERT_AFTER_FAILED_RETRIES,3);

  s.section('backoffMs table (minutes: 15,30,60,120,240, cap 360)');
  [[0,15],[1,30],[2,60],[3,120],[4,240],[5,360],[6,360],[50,360]].forEach(([a,m])=>s.eq('attempts '+a+' → '+m+' min',B(a,false),m*MIN));
  s.section('backoffMs for quota errors (start 60, cap 360)');
  [[0,60],[1,60],[2,60],[3,120],[4,240],[5,360],[9,360]].forEach(([a,m])=>s.eq('quota attempts '+a+' → '+m+' min',B(a,true),m*MIN));
  s.eq('a negative attempt count is treated as 0',B(-3,false),15*MIN);
  s.eq('isQuotaError reads RESOURCE_EXHAUSTED in the message',W.isQuotaError({last_error:QUOTA}),true);
  s.eq('isQuotaError reads it in the reason too',W.isQuotaError({last_error:'x',last_error_reason:'resource_exhausted'}),true);
  s.eq('an ordinary error is not a quota error',W.isQuotaError({last_error:'socket hang up'}),false);

  s.section('decideRetry: healthy');
  {
    // catalog succeeded 10 h ago; stale line is 36 h → healthy
    let d=D({source:'catalog_sync',meta:okMeta(NOW-10*HOUR),watch:{},now:NOW});
    s.eq('catalog 10 h old: none',d.action,'none');
    s.eq('no alert when healthy',d.alert,false);
    // inventory 18 h = exactly 1.5 × 12 h → not older than → healthy
    d=D({source:'inventory_sync',meta:okMeta(NOW-18*HOUR),watch:{},now:NOW});
    s.eq('stock snapshot exactly 18 h old (1.5x) is still healthy',d.action,'none');
    // one ms past
    d=D({source:'inventory_sync',meta:okMeta(NOW-18*HOUR-1),watch:{},now:NOW});
    s.eq('stock snapshot 18 h + 1 ms old is stale → retry',d.action,'retry');
    d=D({source:'catalog_sync',meta:okMeta(NOW-36*HOUR),watch:{},now:NOW});
    s.eq('catalog exactly 36 h (1.5x) is healthy',d.action,'none');
    d=D({source:'catalog_sync',meta:okMeta(NOW-36*HOUR-1),watch:{},now:NOW});
    s.eq('catalog 36 h + 1 ms is stale → retry',d.action,'retry');
    s.eq('timestamps as plain ms are read too',D({source:'catalog_sync',meta:{last_status:'success',last_success_at:NOW-HOUR},watch:{},now:NOW}).action,'none');
  }

  s.section('decideRetry: failed');
  {
    // failed run 20 min ago, last success 5 h ago, never retried → first retry due at run+15min = now-5min → retry
    let d=D({source:'catalog_sync',meta:failMeta(NOW-20*MIN,NOW-5*HOUR),watch:{},now:NOW});
    s.eq('failed 20 min ago, no attempts: retry',d.action,'retry');
    s.eq('and the caller may retry',d.retry,true);
    s.eq('reason names the failed run',/failed/.test(d.reason),true);
    // failed 12 min ago: 10-min guard passed, first back-off (15 min after run) not yet → wait until run+15
    d=D({source:'catalog_sync',meta:failMeta(NOW-12*MIN,NOW-5*HOUR),watch:{},now:NOW});
    s.eq('failed 12 min ago: waits for the first 15 min back-off',d.action,'wait');
    s.eq('nextAt = run + 15 min',d.nextAt,NOW-12*MIN+15*MIN);
    s.eq('not retryable',d.retry,false);
    // no last success ever
    d=D({source:'inventory_sync',meta:failMeta(NOW-2*HOUR,null),watch:{},now:NOW});
    s.eq('no success ever + failed: retry',d.action==='retry'||d.action==='alert',true);
    s.eq('no success on record counts as needing an alert',d.alert,true);
  }

  s.section('decideRetry: a run started in the last 10 minutes');
  {
    // failed run began 9 min ago
    let d=D({source:'catalog_sync',meta:failMeta(NOW-9*MIN,NOW-5*HOUR),watch:{},now:NOW});
    s.eq('sync run 9 min ago: wait',d.action,'wait');
    s.eq('nextAt = run + 10 min',d.nextAt,NOW+1*MIN);
    // exactly 10 min → not "< 10 min"
    d=D({source:'catalog_sync',meta:failMeta(NOW-10*MIN,NOW-5*HOUR),watch:{attempts:1,nextAttemptAt:NOW-1},now:NOW});
    s.eq('exactly 10 min ago is allowed (guard is strictly less than)',d.retry,true);
    // stale but our own attempt 3 min ago
    d=D({source:'catalog_sync',meta:okMeta(NOW-40*HOUR),watch:{attempts:1,lastAttemptAt:NOW-3*MIN,nextAttemptAt:NOW-1},now:NOW});
    s.eq('our own attempt 3 min ago also blocks',d.action,'wait');
    // stale meta, meta.last_run_at 1 min ago (sync in progress, left stale)
    const m=okMeta(NOW-40*HOUR);m.last_run_at=Ts(NOW-MIN);
    s.eq('a stale source whose run began 1 min ago waits',D({source:'catalog_sync',meta:m,watch:{},now:NOW}).action,'wait');
  }

  s.section('decideRetry: back-off waiting');
  {
    const meta=failMeta(NOW-3*HOUR,NOW-5*HOUR);
    // 1 attempt done 20 min ago, next at +10 min → wait until then
    let d=D({source:'catalog_sync',meta,watch:{attempts:1,lastAttemptAt:NOW-20*MIN,nextAttemptAt:NOW+10*MIN},now:NOW});
    s.eq('before nextAttemptAt: wait',d.action,'wait');
    s.eq('nextAt is the recorded back-off end',d.nextAt,NOW+10*MIN);
    d=D({source:'catalog_sync',meta,watch:{attempts:1,lastAttemptAt:NOW-45*MIN,nextAttemptAt:NOW},now:NOW});
    s.eq('exactly at nextAttemptAt: retry',d.action,'retry');
    d=D({source:'catalog_sync',meta,watch:{attempts:2,lastAttemptAt:NOW-45*MIN,nextAttemptAt:NOW-1},now:NOW});
    s.eq('after nextAttemptAt: retry',d.action,'retry');
  }

  s.section('decideRetry: daily cap of 8 per UTC day');
  {
    const meta=failMeta(NOW-3*HOUR,NOW-5*HOUR);
    const day='2026-10-10';
    let d=D({source:'catalog_sync',meta,watch:{attempts:3,lastAttemptAt:NOW-2*HOUR,nextAttemptAt:NOW-1,dayKey:day,dayAttempts:7},now:NOW});
    s.eq('7 attempts today: still retries',d.retry,true);
    d=D({source:'catalog_sync',meta,watch:{attempts:3,lastAttemptAt:NOW-2*HOUR,nextAttemptAt:NOW-1,dayKey:day,dayAttempts:8},now:NOW});
    s.eq('8 attempts today: wait',d.action,'wait');
    s.eq('nextAt is the next UTC midnight (2026-10-11 00:00)',d.nextAt,utc(2026,10,11,0,0));
    s.eq('reason names the cap',/cap/.test(d.reason),true);
    d=D({source:'catalog_sync',meta,watch:{attempts:3,lastAttemptAt:NOW-2*HOUR,nextAttemptAt:NOW-1,dayKey:'2026-10-09',dayAttempts:8},now:NOW});
    s.eq('8 attempts YESTERDAY do not count today',d.retry,true);
    // day boundary: 23:59 on the 10th with 8 attempts → still capped; 00:00 on the 11th → free
    const w={attempts:5,lastAttemptAt:utc(2026,10,10,20,0),nextAttemptAt:utc(2026,10,10,21,0),dayKey:day,dayAttempts:8};
    const m2=failMeta(utc(2026,10,10,20,0),utc(2026,10,9,1,0));
    d=D({source:'catalog_sync',meta:m2,watch:w,now:utc(2026,10,10,23,59)});
    s.eq('23:59 UTC with 8 attempts today: capped',d.action,'wait');
    s.eq('...until midnight',d.nextAt,utc(2026,10,11,0,0));
    d=D({source:'catalog_sync',meta:m2,watch:w,now:utc(2026,10,11,0,0)});
    s.eq('00:00 UTC the next day: the cap has reset, retry',d.retry,true);
    d=D({source:'catalog_sync',meta:m2,watch:w,now:utc(2026,10,10,23,59)+59999});
    s.eq('23:59:59.999 is still the old day',d.action,'wait');
  }

  s.section('decideRetry: quota errors');
  {
    // quota failure 3 h ago, attempt 1 done 30 min ago; non-quota back-off would be 15 min (passed), quota needs 60 → recorded nextAttemptAt governs
    const meta=failMeta(NOW-3*HOUR,NOW-5*HOUR,QUOTA,'8');
    let d=D({source:'catalog_sync',meta,watch:{attempts:1,lastAttemptAt:NOW-30*MIN,nextAttemptAt:NOW-30*MIN+B(0,true)},now:NOW});
    s.eq('quota: next attempt = last attempt + 60 min, so 30 min later it waits',d.action,'wait');
    s.eq('nextAt = attempt + 60 min',d.nextAt,NOW+30*MIN);
    // fresh quota failure 20 min ago, no attempts: first retry is run + 60 (quota start)
    d=D({source:'catalog_sync',meta:failMeta(NOW-20*MIN,NOW-5*HOUR,QUOTA,'8'),watch:{},now:NOW});
    s.eq('fresh quota failure 20 min ago: waits (60 min start, a plain error would already retry)',d.action,'wait');
    s.eq('nextAt = run + 60 min',d.nextAt,NOW-20*MIN+60*MIN);
    d=D({source:'catalog_sync',meta:failMeta(NOW-61*MIN,NOW-5*HOUR,QUOTA,'8'),watch:{},now:NOW});
    s.eq('quota failure 61 min ago: retry',d.action,'retry');
    s.eq('the plain-error comparison retries at 20 min',D({source:'catalog_sync',meta:failMeta(NOW-20*MIN,NOW-5*HOUR,'boom'),watch:{},now:NOW}).action,'retry');
  }

  s.section('decideRetry: alerts');
  {
    // last success 47 h ago, failed, 0 failed retries → no alert
    let d=D({source:'catalog_sync',meta:failMeta(NOW-2*HOUR,NOW-47*HOUR),watch:{},now:NOW});
    s.eq('47 h without success, 0 failed retries: no alert',d.alert,false);
    d=D({source:'catalog_sync',meta:failMeta(NOW-2*HOUR,NOW-48*HOUR),watch:{},now:NOW});
    s.eq('exactly 48 h: alert',d.alert,true);
    s.eq('action is alert',d.action,'alert');
    s.eq('an alert source may still retry',d.retry,true);
    d=D({source:'catalog_sync',meta:failMeta(NOW-2*HOUR,NOW-5*HOUR),watch:{attempts:3,consecutiveFailures:2,nextAttemptAt:NOW-1},now:NOW});
    s.eq('2 failed retries: no alert',d.alert,false);
    d=D({source:'catalog_sync',meta:failMeta(NOW-2*HOUR,NOW-5*HOUR),watch:{attempts:3,consecutiveFailures:3,nextAttemptAt:NOW-1},now:NOW});
    s.eq('3 failed retries: alert',d.alert,true);
    d=D({source:'catalog_sync',meta:okMeta(NOW-HOUR),watch:{attempts:5,consecutiveFailures:5},now:NOW});
    s.eq('healthy never alerts, whatever the old state',J([d.action,d.alert]),J(['none',false]));
    d=D({source:'catalog_sync',meta:failMeta(NOW-2*HOUR,NOW-72*HOUR),watch:{attempts:2,nextAttemptAt:NOW+HOUR,lastAttemptAt:NOW-30*MIN},now:NOW});
    s.eq('an alert-worthy source in back-off is flagged alert but not retried',J([d.action,d.retry]),J(['alert',false]));
  }

  // ── run() ────────────────────────────────────────────────────────────
  s.section('run(): both sources healthy → zero writes, zero handler calls, few reads');
  {
    const {db,st}=makeDb();
    st.docs[META+'catalog_sync']=okMeta(NOW-6*HOUR);
    st.docs[META+'inventory_sync']=okMeta(NOW-3*HOUR);
    const clock={now:NOW};const {h,calls}=makeHandlers(st,{},clock);
    const out=await run(db,h,NOW);
    s.eq('no writes at all',st.writes.length,0);
    s.eq('no handler calls',calls.length,0);
    s.ok('reads are at most 3 (watchdog doc + one meta per source)',st.reads<=3,'reads='+st.reads);
    s.eq('no collection scans',st.scans,0);
    s.eq('catalog outcome none',out.catalog_sync.action,'none');
    s.eq('stock outcome none',out.inventory_sync.action,'none');
    s.eq('reads touched only the meta collection',st.readPaths.every(p=>p.indexOf('shopify_sync_meta/')===0),true);
  }

  s.section('run(): catalog failed only → only that handler, state written, outcome recorded');
  {
    const {db,st}=makeDb();
    st.docs[META+'catalog_sync']=failMeta(NOW-30*MIN,NOW-26*HOUR,QUOTA,'8');
    st.docs[META+'inventory_sync']=okMeta(NOW-3*HOUR);
    // a quota failure 30 min ago → not due until +60 → first call must WAIT
    const clock={now:NOW};let {h,calls}=makeHandlers(st,{},clock);
    let out=await run(db,h,NOW);
    s.eq('quota failure 30 min old is not retried yet',calls.length,0);
    s.eq('outcome wait',out.catalog_sync.action,'wait');
    s.eq('waiting writes nothing',st.writes.length,0);
    // an ordinary failure 30 min ago retries
    st.docs[META+'catalog_sync']=failMeta(NOW-30*MIN,NOW-26*HOUR,'socket hang up','error');
    ({h,calls}=makeHandlers(st,{},clock));
    out=await run(db,h,NOW);
    s.eq('only the catalog handler ran',J(calls),J(['catalog_sync']));
    s.eq('outcome retry',out.catalog_sync.action,'retry');
    s.eq('and it succeeded',out.catalog_sync.ok,true);
    const wd=st.docs[META+'watchdog'];
    s.ok('watchdog doc written',!!wd&&!!wd.catalog_sync);
    s.eq('success recorded',wd.catalog_sync.lastResult,'success');
    s.eq('attempts reset to 0 after the success',wd.catalog_sync.attempts,0);
    s.eq('lastAttemptAt = now',wd.catalog_sync.lastAttemptAt,NOW);
    s.eq('dayAttempts counts this attempt',wd.catalog_sync.dayAttempts,1);
    s.eq('dayKey is the UTC day',wd.catalog_sync.dayKey,'2026-10-10');
    s.eq('stock source untouched in the watchdog doc',wd.inventory_sync,undefined);
    s.eq('the only watchdog-written paths are the watchdog doc',J(st.writes.filter(p=>p!==META+'catalog_sync')),J([META+'watchdog']));
    s.eq('no alert rows for a recovered source',st.writes.filter(p=>p.indexOf('hrm_notifications/')===0).length,0);
    s.eq('no scans',st.scans,0);
  }

  s.section('run(): failed retry records state and backs off');
  {
    const {db,st}=makeDb();
    st.docs[META+'catalog_sync']=failMeta(NOW-30*MIN,NOW-26*HOUR,'socket hang up','error');
    st.docs[META+'inventory_sync']=okMeta(NOW-3*HOUR);
    const clock={now:NOW};const {h,calls}=makeHandlers(st,{catalog_sync:{fail:'socket hang up'}},clock);
    const out=await run(db,h,NOW);
    const w=st.docs[META+'watchdog'].catalog_sync;
    s.eq('handler called once',calls.length,1);
    s.eq('not ok',out.catalog_sync.ok,false);
    s.eq('attempts 1',w.attempts,1);
    s.eq('consecutiveFailures 1',w.consecutiveFailures,1);
    s.eq('next attempt = now + 15 min (first back-off)',toMs(w.nextAttemptAt),NOW+15*MIN);
    s.eq('lastResult names the failure',/failed: socket hang up/.test(w.lastResult),true);
    // run again 5 minutes later: guard + back-off → no handler call
    const c2=makeHandlers(st,{catalog_sync:{fail:'socket hang up'}},clock);
    await run(db,c2.h,NOW+5*MIN);
    s.eq('5 minutes later: no second call',c2.calls.length,0);
  }

  s.section('run(): quota failure backs off 60 min');
  {
    const {db,st}=makeDb();
    st.docs[META+'catalog_sync']=failMeta(NOW-2*HOUR,NOW-26*HOUR,QUOTA,'8');
    st.docs[META+'inventory_sync']=okMeta(NOW-3*HOUR);
    const clock={now:NOW};const {h}=makeHandlers(st,{catalog_sync:{fail:QUOTA,reason:'8'}},clock);
    await run(db,h,NOW);
    const w=st.docs[META+'watchdog'].catalog_sync;
    s.eq('next attempt = now + 60 min (quota start)',toMs(w.nextAttemptAt),NOW+60*MIN);
  }

  s.section('run(): both failed, one handler throws → the other still runs');
  {
    const {db,st}=makeDb();
    st.docs[META+'catalog_sync']=failMeta(NOW-40*MIN,NOW-26*HOUR,'x','error');
    st.docs[META+'inventory_sync']=failMeta(NOW-40*MIN,NOW-14*HOUR,'y','error');
    const clock={now:NOW};const {h,calls}=makeHandlers(st,{catalog_sync:{throws:'handler exploded'}},clock);
    let out,threw=null;
    try{out=await run(db,h,NOW);}catch(e){threw=e;}
    s.eq('run() did not throw',threw,null);
    s.eq('both handlers were called, catalog first',J(calls),J(['catalog_sync','inventory_sync']));
    const wd=st.docs[META+'watchdog'];
    s.eq('thrown handler recorded',/threw: handler exploded/.test(wd.catalog_sync.lastResult),true);
    s.eq('thrown handler counts as a failed attempt',wd.catalog_sync.attempts,1);
    s.eq('catalog not ok',out.catalog_sync.ok,false);
    s.eq('stock recovered',out.inventory_sync.ok,true);
    s.eq('stock state: success, attempts 0',J([wd.inventory_sync.lastResult,wd.inventory_sync.attempts]),J(['success',0]));
  }

  s.section('run(): the first source throwing at the db level does not skip the second');
  {
    const {db,st}=makeDb();
    st.docs[META+'inventory_sync']=failMeta(NOW-40*MIN,NOW-14*HOUR,'y','error');
    // catalog_sync meta read throws
    const orig=db.collection;
    db.collection=col=>{const c=orig(col);const d=c.doc;c.doc=id=>{const r=d(id);if(col==='shopify_sync_meta'&&id==='catalog_sync')r.get=async()=>{throw new Error('read denied');};return r;};return c;};
    const clock={now:NOW};const {h,calls}=makeHandlers(st,{},clock);
    const out=await run(db,h,NOW);
    s.eq('catalog reported an error, not a throw',/read denied/.test(out.catalog_sync.error||''),true);
    s.eq('stock handler still ran',J(calls),J(['inventory_sync']));
  }

  s.section('run(): success after earlier failures resets the counters');
  {
    const {db,st}=makeDb();
    st.docs[META+'catalog_sync']=okMeta(NOW-20*MIN);                  // healed by its own schedule
    st.docs[META+'inventory_sync']=okMeta(NOW-2*HOUR);
    st.docs[META+'watchdog']={catalog_sync:{attempts:4,consecutiveFailures:4,lastAttemptAt:Ts(NOW-3*HOUR),nextAttemptAt:Ts(NOW+HOUR),dayKey:'2026-10-10',dayAttempts:4,lastResult:'failed: x'}};
    const clock={now:NOW};const {h,calls}=makeHandlers(st,{},clock);
    await run(db,h,NOW);
    const w=st.docs[META+'watchdog'].catalog_sync;
    s.eq('no handler call needed',calls.length,0);
    s.eq('attempts reset',w.attempts,0);
    s.eq('consecutive failures reset',w.consecutiveFailures,0);
    s.eq('no pending back-off',w.nextAttemptAt,null);
    s.eq('recorded as recovered',w.lastResult,'recovered');
  }

  s.section('run(): alert once per source per UTC day, deterministic ids');
  {
    const {db,st}=makeDb();
    // catalog: no success for 60 h, failed with quota; inventory healthy
    st.docs[META+'catalog_sync']=failMeta(NOW-2*HOUR,NOW-60*HOUR,QUOTA,'8');
    st.docs[META+'inventory_sync']=okMeta(NOW-3*HOUR);
    const clock={now:NOW};const mk=()=>makeHandlers(st,{catalog_sync:{fail:QUOTA,reason:'8'}},clock);
    let r=mk();
    const out=await run(db,r.h,NOW);
    const ids=Object.keys(st.docs).filter(k=>k.indexOf('hrm_notifications/')===0).sort();
    s.eq('two rows: afnan and ammar',J(ids),J(['hrm_notifications/syncwd_catalog_sync_2026-10-10_afnan','hrm_notifications/syncwd_catalog_sync_2026-10-10_ammar']));
    const a=st.docs[ids[0]],b=st.docs[ids[1]];
    s.eq('afnan row is forUser afnan',a.forUser,'afnan');
    s.eq('ammar row is forUser ammar',b.forUser,'ammar');
    s.eq('type',a.type,'shopify_sync_watchdog');
    s.eq('text names the source',/catalog/i.test(a.message+a.title),true);
    s.eq('text states hours stale (60)',/60 hours/.test(a.message),true);
    s.eq('text carries the last error',/RESOURCE_EXHAUSTED/.test(a.message),true);
    s.eq('alertsRaised reported',out.catalog_sync.alertsRaised>=2,true);
    s.eq('no alert for the healthy source',ids.some(i=>/inventory_sync/.test(i)),false);
    // run again an hour later the same UTC day, past the back-off
    const writesBefore=st.writes.filter(p=>p.indexOf('hrm_notifications/')===0).length;
    const snap=J(ids.map(i=>st.docs[i]));
    r=mk();
    await run(db,r.h,NOW+2*HOUR);
    const idsAfter=Object.keys(st.docs).filter(k=>k.indexOf('hrm_notifications/')===0).sort();
    s.eq('second run same day: still exactly two alert rows',idsAfter.length,2);
    s.eq('and they were not rewritten',st.writes.filter(p=>p.indexOf('hrm_notifications/')===0).length,writesBefore);
    s.eq('row content unchanged',J(idsAfter.map(i=>st.docs[i])),snap);
    // next UTC day: fresh rows
    st.docs[META+'catalog_sync']=failMeta(NOW+10*HOUR,NOW-60*HOUR,QUOTA,'8');
    r=mk();
    await run(db,r.h,utc(2026,10,11,0,0)+HOUR);
    const idsNext=Object.keys(st.docs).filter(k=>k.indexOf('hrm_notifications/')===0).sort();
    s.eq('next UTC day adds a new pair',idsNext.length,4);
    s.eq('with the new day in the id',idsNext.some(i=>/2026-10-11_afnan$/.test(i)),true);
  }

  s.section('run(): alert after 3 consecutive failed retries even when under 48 h');
  {
    const {db,st}=makeDb();
    st.docs[META+'inventory_sync']=failMeta(NOW-30*MIN,NOW-14*HOUR,'y','error');
    st.docs[META+'catalog_sync']=okMeta(NOW-3*HOUR);
    st.docs[META+'watchdog']={inventory_sync:{attempts:2,consecutiveFailures:2,lastAttemptAt:Ts(NOW-3*HOUR),nextAttemptAt:Ts(NOW-HOUR),dayKey:'2026-10-10',dayAttempts:2,lastResult:'failed: y'}};
    const clock={now:NOW};const {h,calls}=makeHandlers(st,{inventory_sync:{fail:'y'}},clock);
    await run(db,h,NOW);
    s.eq('the third failed retry ran',J(calls),J(['inventory_sync']));
    const ids=Object.keys(st.docs).filter(k=>k.indexOf('hrm_notifications/')===0).sort();
    s.eq('and raised one pair for the stock snapshot',J(ids),J(['hrm_notifications/syncwd_inventory_sync_2026-10-10_afnan','hrm_notifications/syncwd_inventory_sync_2026-10-10_ammar']));
  }

  s.section('run(): daily cap enforced through run()');
  {
    const {db,st}=makeDb();
    st.docs[META+'catalog_sync']=failMeta(NOW-6*HOUR,NOW-30*HOUR,'boom','error');
    st.docs[META+'inventory_sync']=okMeta(NOW-3*HOUR);
    st.docs[META+'watchdog']={catalog_sync:{attempts:5,consecutiveFailures:2,lastAttemptAt:Ts(NOW-2*HOUR),nextAttemptAt:Ts(NOW-HOUR),dayKey:'2026-10-10',dayAttempts:8,lastResult:'failed: boom'}};
    const clock={now:NOW};const {h,calls}=makeHandlers(st,{catalog_sync:{fail:'boom'}},clock);
    const out=await run(db,h,NOW);
    s.eq('8 attempts today: handler not called',calls.length,0);
    s.eq('outcome wait',out.catalog_sync.action,'wait');
    // same state at 00:00 next day
    const c2=makeHandlers(st,{catalog_sync:{fail:'boom'}},clock);
    await run(db,c2.h,utc(2026,10,11,0,0));
    s.eq('after UTC midnight it tries again',J(c2.calls),J(['catalog_sync']));
    s.eq('and the new day starts at 1 attempt',st.docs[META+'watchdog'].catalog_sync.dayAttempts,1);
    s.eq('with the new dayKey',st.docs[META+'watchdog'].catalog_sync.dayKey,'2026-10-11');
  }

  s.section('run(): read budget stays small');
  {
    const {db,st}=makeDb();
    st.docs[META+'catalog_sync']=failMeta(NOW-40*MIN,NOW-26*HOUR,'x','error');
    st.docs[META+'inventory_sync']=failMeta(NOW-40*MIN,NOW-14*HOUR,'y','error');
    const clock={now:NOW};const {h}=makeHandlers(st,{},clock);
    await run(db,h,NOW);
    // 1 watchdog + 2 metas + 2 re-reads after handlers (+ up to 4 alert-existence checks only if alerting)
    s.ok('both recovering: at most 5 reads',st.reads<=5,'reads='+st.reads);
    s.eq('no scans',st.scans,0);
    s.eq('writes only watchdog doc (handlers write their own meta directly in this fake)',st.writes.filter(p=>p.indexOf('hrm_notifications/')===0).length,0);
  }

  return s;
};

function toMs(v){return v&&typeof v.toMillis==='function'?v.toMillis():v;}

/* netlify/functions/shopify-inventory-snapshot.js — scripted Shopify + in-memory
   Firestore (same pattern as catalog-sync.test.js). Proves: clean run writes a
   complete snapshot; 429 then success retries (honouring Retry-After); a
   persistent 429 writes NO snapshot, leaves an existing complete one untouched
   and records a failed status; overwrite rules; locations_seen + warning while
   stock summed across all locations. Does not prove live Shopify behaviour. */
'use strict';
const path=require('path');
const Module=require('module');
const {suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);

function makeAdmin(state){
  const ref=(col,id)=>({
    async get(){const d=state.docs[col+'/'+id];return{id,exists:!!d,data:()=>d};},
    async set(data,opt){state.docs[col+'/'+id]=Object.assign(opt&&opt.merge?(state.docs[col+'/'+id]||{}):{},JSON.parse(J(data)));state.log.push(['set',col+'/'+id]);}
  });
  const db={collection(col){return{
    doc(id){return ref(col,id);},
    select(){return this;},
    async get(){return{forEach(cb){Object.keys(state.docs).filter(k=>k.indexOf(col+'/')===0).forEach(k=>cb({id:k.slice(col.length+1),data:()=>state.docs[k]}));}};}
  };}};
  return{apps:[1],initializeApp(){},credential:{cert:()=>({})},firestore:Object.assign(()=>db,{FieldValue:{serverTimestamp:()=>'TS'}})};
}
function loadFn(state){
  const admin=makeAdmin(state),orig=Module._load;
  Module._load=function(req,...rest){if(req==='firebase-admin')return admin;return orig.call(this,req,...rest);};
  const f=path.join(ROOT,'netlify','functions','shopify-inventory-snapshot.js');
  delete require.cache[f];
  try{return require(f);}finally{Module._load=orig;}
}
const R=(status,body,headers)=>({ok:status>=200&&status<300,status,headers:{get:k=>(headers||{})[k.toLowerCase()]||null},text:async()=>'err',json:async()=>body});
function shopify(st,locations,script){
  return async url=>{
    st.calls.push(String(url));
    if(/oauth/.test(url))return R(200,{access_token:'t'});
    if(/locations\.json/.test(url))return R(200,{locations});
    if(/inventory_levels/.test(url)){st.levelCalls++;return script.shift();}
    return R(404,{});
  };
}
const PAGE1=()=>R(200,{inventory_levels:[{inventory_item_id:1,available:5},{inventory_item_id:2,available:null}]},{link:'<https://x/admin/api/2026-04/inventory_levels.json?page_info=p2>; rel="next"'});
const PAGE2=()=>R(200,{inventory_levels:[{inventory_item_id:3,available:7}]});
const ENV=['SHOPIFY_CLIENT_ID','SHOPIFY_CLIENT_SECRET','SHOPIFY_STORE_DOMAIN','FIREBASE_SERVICE_ACCOUNT'];

async function run(docs,locations,script,sleeps){
  const st={docs:Object.assign({},docs),log:[],calls:[],levelCalls:0};
  const fn=loadFn(st);fn._test.setSleep(async ms=>{sleeps.push(ms);});
  const saved={};ENV.forEach(k=>{saved[k]=process.env[k];process.env[k]=k==='FIREBASE_SERVICE_ACCOUNT'?'{}':'x';});
  const sf=global.fetch;global.fetch=shopify(st,locations,script);
  let res;try{res=await fn.handler({});}finally{global.fetch=sf;ENV.forEach(k=>{if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];});}
  return{st,res,body:JSON.parse(res.body),fn};
}
const today=()=>new Date(Date.now()+5*3600000).toISOString().split('T')[0];

module.exports=async function(){
  const s=suite('inventory-snapshot');
  const L1=[{id:11}];
  const SNAP='shopify_inventory_snapshots/'+today();
  const META='shopify_sync_meta/inventory_sync';
  const five429=()=>[1,2,3,4,5].map(()=>R(429,{}));

  s.section('clean run');
  {
    const sl=[];const r=await run({},L1,[PAGE1(),PAGE2()],sl);const d=r.st.docs[SNAP];
    s.eq('200',r.res.statusCode,200);
    s.eq('existing fields: total 5+0+7, 3 variants, location 11',J([d.total_available,d.variant_count,d.location_id,d.date]),J([12,3,11,today()]));
    s.eq('completeness metadata: complete, 2 pages, 3 items',J([d.complete,d.pages,d.item_count]),J([true,2,3]));
    s.eq('null available counted as 0',d.items['2'].available,0);
    s.eq('no retries, no sleeping',J([sl.length,r.st.levelCalls]),J([0,2]));
    s.eq('meta success, no warning, one location',J([r.st.docs[META].last_status,r.st.docs[META].last_warning,r.st.docs[META].locations_seen]),J(['success',null,1]));
  }

  s.section('429 then success');
  {
    const sl=[];const r=await run({},L1,[PAGE1(),R(429,{},{'retry-after':'2'}),PAGE2()],sl);const d=r.st.docs[SNAP];
    s.eq('retried and completed: 12 available, 2 pages',J([r.res.statusCode,d.total_available,d.pages,d.complete]),J([200,12,2,true]));
    s.eq('slept exactly Retry-After 2s = 2000ms',J(sl),J([2000]));
    s.eq('3 level calls (p1, 429, p2)',r.st.levelCalls,3);
    const s2=[];const r2=await run({},L1,[R(503,{}),PAGE2()],s2);
    s.eq('5xx without Retry-After backs off 1000ms then succeeds',J([r2.res.statusCode,s2]),J([200,[1000]]));
  }

  s.section('persistent 429: no snapshot, failed status, existing complete snapshot untouched');
  {
    const good={date:today(),total_available:99,variant_count:1,items:{9:{available:99}},complete:true,pages:1,item_count:1};
    const r=await run({[SNAP]:good,[META]:{last_success_at:'OLD'}},L1,[PAGE1()].concat(five429()),[]);
    s.eq('500',r.res.statusCode,500);
    s.eq('existing snapshot byte-identical',J(r.st.docs[SNAP]),J(good));
    s.ok('no write to the snapshots collection',!r.st.log.some(l=>l[1].indexOf('shopify_inventory_snapshots/')===0));
    const m=r.st.docs[META];
    s.eq('meta failed with reason',J([m.last_status,m.last_error_reason]),J(['error','INCOMPLETE_PAGING']));
    s.ok('error text names incomplete paging',/incomplete/i.test(m.last_error));
    s.eq('last_success_at not touched',m.last_success_at,'OLD');
    s.eq('bounded: 1 ok page + 5 attempts',r.st.levelCalls,6);
    const r3=await run({},L1,five429(),[]);
    s.ok('no snapshot created when none existed',!r3.st.docs[SNAP]);
  }

  s.section('Retry-After beyond the time budget gives up at once');
  {
    const sl=[];const r=await run({},L1,[R(429,{},{'retry-after':'600'})],sl);
    s.eq('no sleep, one call, failed',J([sl.length,r.st.levelCalls,r.res.statusCode]),J([0,1,500]));
  }

  s.section('non-retryable error still throws immediately');
  {
    const r=await run({},L1,[R(401,{})],[]);
    s.eq('401: one call, 500, not flagged incomplete',J([r.st.levelCalls,r.res.statusCode,r.st.docs[META].last_error_reason]),J([1,500,'error']));
  }

  s.section('overwrite rules');
  {
    const legacy={date:today(),total_available:1,variant_count:1,items:{}};
    const r=await run({[SNAP]:legacy},L1,[PAGE1(),PAGE2()],[]);
    s.eq('a legacy (no complete flag) doc is replaced by a complete run',J([r.st.docs[SNAP].complete,r.st.docs[SNAP].total_available]),J([true,12]));
    const old={date:today(),total_available:50,variant_count:2,items:{},complete:true,pages:1,item_count:2};
    const r2=await run({[SNAP]:old},L1,[PAGE2()],[]);
    s.eq('a complete doc is replaced by a later complete run',J([r2.st.docs[SNAP].total_available,r2.st.docs[SNAP].item_count]),J([7,1]));
    const t=r.fn._test;
    s.eq('canReplace: incomplete never replaces; complete may',J([t.canReplaceSnapshot(old,false),t.canReplaceSnapshot(old,true),t.canReplaceSnapshot(null,true)]),J([false,true,true]));
  }

  s.section('locations: stock is SUMMED across all locations');
  {
    // hand-computed: item1 5@11 + 4@22 + 1@22(page 2) = 10; item2 null@11 (=0) + 2@22 = 2; item3 7@11 = 7
    const P1=()=>R(200,{inventory_levels:[{inventory_item_id:1,location_id:11,available:5},{inventory_item_id:1,location_id:22,available:4},{inventory_item_id:2,location_id:11,available:null},{inventory_item_id:2,location_id:22,available:2}]},{link:'<https://x/admin/api/2026-04/inventory_levels.json?page_info=p2>; rel="next"'});
    const P2=()=>R(200,{inventory_levels:[{inventory_item_id:3,location_id:11,available:7},{inventory_item_id:1,location_id:22,available:1}]});
    const r=await run({},[{id:11},{id:22}],[P1(),P2()],[]);
    const d=r.st.docs[SNAP],m=r.st.docs[META];
    const lv=r.st.calls.filter(u=>/inventory_levels/.test(u));
    s.ok('every location asked for in one request',lv[0].indexOf('location_ids=11,22')>-1);
    s.eq('per-item sums 10 / 2 / 7',J([d.items['1'].available,d.items['2'].available,d.items['3'].available]),J([10,2,7]));
    s.eq('total 19, 3 distinct items, 6 level rows, 2 pages',J([d.total_available,d.variant_count,d.item_count,d.level_rows,d.pages]),J([19,3,3,6,2]));
    s.eq('location count recorded on snapshot and meta; ids listed; first id kept',J([d.locations_seen,m.locations_seen,d.location_ids,d.location_id]),J([2,2,['11','22'],11]));
    s.ok('no understatement warning, still complete and success',m.last_warning===null&&d.complete===true&&m.last_status==='success');
    // a location that fails to finish never produces a summed snapshot
    const f=await run({[SNAP]:{date:today(),total_available:99,complete:true,items:{}}},[{id:11},{id:22}],[P1(),R(429,{}),R(429,{}),R(429,{}),R(429,{}),R(429,{})],[]);
    s.eq('persistent 429 mid-way: existing snapshot untouched, failure recorded',J([f.res.statusCode,f.st.docs[SNAP].total_available,f.st.docs[META].last_error_reason]),J([500,99,'INCOMPLETE_PAGING']));
    // 51 locations -> two chunks of 50 + 1, summed together: item1 5 + 3 = 8
    const ids=[];for(let i=1;i<=51;i++)ids.push({id:i});
    const c=await run({},ids,[R(200,{inventory_levels:[{inventory_item_id:1,available:5}]}),R(200,{inventory_levels:[{inventory_item_id:1,available:3}]})],[]);
    const cl=c.st.calls.filter(u=>/inventory_levels/.test(u));
    s.eq('51 locations: 2 requests, 50 then 1 ids',J([cl.length,cl[0].match(/location_ids=([^&]+)/)[1].split(',').length,cl[1].match(/location_ids=([^&]+)/)[1].split(',').length]),J([2,50,1]));
    s.eq('chunks summed: 8, one item, 51 locations',J([c.st.docs[SNAP].items['1'].available,c.st.docs[SNAP].total_available,c.st.docs[SNAP].variant_count,c.st.docs[SNAP].locations_seen]),J([8,8,1,51]));
  }

  s.section('backoff arithmetic');
  {
    const t=loadFn({docs:{},log:[]})._test;
    s.eq('header wins; else 1s*2^n capped at 8s',J([t.retryDelayMs(R(429,{},{'retry-after':'3'}),0),t.retryDelayMs(R(429,{}),2),t.retryDelayMs(R(429,{}),9)]),J([3000,4000,8000]));
  }
  return s;
};

/* shopify-order-backfill — the ?days= / ?since= window.
   In-memory Firestore + scripted Shopify (catalog-sync.test.js pattern).
   Proves: validation, default stays 90 days, a larger window requests the
   earlier date, a finished backfill is re-opened only by an explicit earlier
   window and then fetches only the older slice, existing docs are skipped. */
'use strict';
const path=require('path');
const Module=require('module');
const {suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);
const DAY=86400000;

function makeAdmin(state){
  const ref=(col,id)=>({id,path:col+'/'+id,
    async get(){const d=state.docs[col+'/'+id];return{id,exists:!!d,data:()=>d};},
    async set(data,opt){state.docs[col+'/'+id]=Object.assign(opt&&opt.merge?(state.docs[col+'/'+id]||{}):{},JSON.parse(J(data)));}});
  const db={
    collection(col){return{doc:id=>ref(col,id),
      select(){return this;},
      async get(){const out=[];Object.keys(state.docs).forEach(k=>{if(k.indexOf(col+'/')===0)out.push({id:k.slice(col.length+1),data:()=>state.docs[k]});});return{forEach:f=>out.forEach(f)};}};},
    async getAll(...refs){return Promise.all(refs.map(r=>r.get()));},
    bulkWriter(){return{set(r,d){r.set(d);},async close(){}};}
  };
  return{apps:[1],initializeApp(){},credential:{cert:()=>({})},firestore:Object.assign(()=>db,{FieldValue:{serverTimestamp:()=>'TS'}})};
}
function loadFn(state){
  const admin=makeAdmin(state);const orig=Module._load;
  Module._load=function(req,...rest){if(req==='firebase-admin')return admin;return orig.call(this,req,...rest);};
  const f=path.join(ROOT,'netlify','functions','shopify-order-backfill.js');
  delete require.cache[f];
  try{return require(f);}finally{Module._load=orig;}
}
const ORDER=(id,at)=>({id,order_number:id,created_at:at,currency:'PKR',total_price:'100',line_items:[{id:id*10,variant_id:1,quantity:1,price:'100',title:'T',sku:'S'}],discount_codes:[]});

module.exports=async function(){
  const s=suite('shopify-backfill-window');
  const state={docs:{},calls:[]};
  const fn=loadFn(state);
  const keys=['SHOPIFY_CLIENT_ID','SHOPIFY_CLIENT_SECRET','SHOPIFY_STORE_DOMAIN','FIREBASE_SERVICE_ACCOUNT'];
  const saved={};keys.forEach(k=>{saved[k]=process.env[k];process.env[k]=k==='FIREBASE_SERVICE_ACCOUNT'?'{}':'x';});
  const savedFetch=global.fetch;
  let orders=[];
  global.fetch=async(url)=>{
    state.calls.push(String(url));
    if(/oauth/.test(url))return{ok:true,status:200,json:async()=>({access_token:'t'})};
    return{ok:true,status:200,headers:{get:()=>null},json:async()=>({orders})};
  };
  const run=async q=>{state.calls.length=0;const r=await fn.handler({queryStringParameters:q});return{code:r.statusCode,body:JSON.parse(r.body)};};
  const ordersUrl=()=>state.calls.find(c=>/orders\.json/.test(c))||'';
  const minOf=u=>{const m=/created_at_min=([^&]+)/.exec(u);return m?new Date(decodeURIComponent(m[1])).getTime():0;};
  try{
    s.section('validation — nothing is fetched on a bad value');
    for(const q of [{days:'0'},{days:'3651'},{days:'-5'},{days:'abc'},{days:'1.5'},{since:'2026-13-01'},{since:'2026-02-30'},{since:'yesterday'},{since:'2999-01-01'},{since:'2000-01-01'},{days:'5',since:'2026-01-01'}]){
      const r=await run(q);
      s.eq('400 for '+J(q),r.code,400);
      s.eq('no request made for '+J(q),state.calls.length,0);
    }
    s.ok('no state written by a refusal',!state.docs['shopify_sync_meta/order_backfill']);

    s.section('default is still 90 days');
    orders=[ORDER(1,new Date(Date.now()-10*DAY).toISOString())];
    let r=await run({});
    s.eq('200',r.code,200);
    let gap=(Date.now()-minOf(ordersUrl()))/DAY;
    s.ok('min is ~90 days back ('+gap.toFixed(2)+')',Math.abs(gap-90)<0.1);
    s.eq('complete',r.body.complete,true);
    s.ok('order written',!!state.docs['shopify_orders/1']);
    r=await run({});
    s.ok('no param on a finished run: already complete, no Shopify call',/already complete/.test(r.body.message)&&state.calls.length===0);
    r=await run({days:'60'});
    s.ok('a NARROWER explicit window does not reopen it',/already complete/.test(r.body.message)&&state.calls.length===0);

    s.section('a larger window reaches the earlier date and only fetches the older slice');
    const before=J(state.docs['shopify_orders/1']);
    orders=[ORDER(1,new Date(Date.now()-10*DAY).toISOString()),ORDER(2,new Date(Date.now()-200*DAY).toISOString())];
    r=await run({days:'365'});
    s.eq('200',r.code,200);
    gap=(Date.now()-minOf(ordersUrl()))/DAY;
    s.ok('min is ~365 days back ('+gap.toFixed(2)+')',Math.abs(gap-365)<0.1);
    s.ok('bounded above by the old minimum (created_at_max)',/created_at_max=/.test(ordersUrl()));
    s.ok('the older order is written',!!state.docs['shopify_orders/2']);
    s.eq('an existing order doc is not rewritten',J(state.docs['shopify_orders/1']),before);
    s.eq('existing one counted as skipped',r.body.skipped_orders,1);
    s.eq('meta window moved',new Date(state.docs['shopify_sync_meta/order_backfill'].created_at_min).getTime()<Date.now()-300*DAY,true);

    s.section('since= works and is validated as a date');
    r=await run({since:'2020-01-01'});
    s.eq('200',r.code,200);
    s.ok('min is 2020-01-01',/created_at_min=2020-01-01T00/.test(decodeURIComponent(ordersUrl())));
  }finally{global.fetch=savedFetch;keys.forEach(k=>{if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];});}
  return s;
};

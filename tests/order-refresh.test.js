/* ─────────────────────────────────────────────────────────────────────────
   netlify/lib/shopify-order-refresh.js + the two refresh functions + the
   status fields added to shopify-order-sync.js.

   Shopify and Firestore are NOT reachable here: firebase-admin is replaced by
   an in-memory Firestore (update() on a missing doc THROWS, like the real
   one, so "never creates" is proved by the run not failing) and fetch by a
   scripted Shopify. The REST field names (refunds[].refund_line_items[]
   .line_item_id/.quantity, refunds[].created_at, updated_at_min) are read
   from the Shopify docs/existing code, not from a live call.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const path=require('path');
const Module=require('module');
const {suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);

function makeAdmin(state){
  const ref=(col,id)=>({id,path:col+'/'+id,
    async get(){const d=state.docs[col+'/'+id];return{id,exists:!!d,data:()=>d};}
  ,
    async set(data,opt){state.docs[col+'/'+id]=Object.assign(opt&&opt.merge?(state.docs[col+'/'+id]||{}):{},JSON.parse(J(data)));}});
  const db={
    collection(col){return{doc:id=>ref(col,id),select(){return this;},async get(){return{forEach(f){Object.keys(state.docs).filter(k=>k.indexOf(col+'/')===0).forEach(k=>f({id:k.slice(col.length+1),data:()=>state.docs[k]}));}};}};},
    async getAll(...refs){return Promise.all(refs.map(r=>r.get()));},
    bulkWriter(){const ops=[];return{
      set(r,d){ops.push(['set',r,d]);},
      update(r,d){ops.push(['update',r,d]);},
      async close(){for(const [op,r,d] of ops){
        if(op==='update'){if(!state.docs[r.path])throw new Error('NOT_FOUND '+r.path);state.writes.push(r.path);Object.assign(state.docs[r.path],JSON.parse(J(d)));}
        else{state.writes.push(r.path);state.docs[r.path]=JSON.parse(J(d));}
      }}};}
  };
  return{apps:[1],initializeApp(){},credential:{cert:()=>({})},
    auth:()=>({verifyIdToken:async t=>{if(!state.tokens||!state.tokens[t])throw new Error('bad');return state.tokens[t];}}),
    firestore:Object.assign(()=>db,{FieldValue:{serverTimestamp:()=>'TS'}})};
}
function loadFresh(state,files){
  const admin=makeAdmin(state);const orig=Module._load;
  Module._load=function(req,...rest){if(req==='firebase-admin')return admin;return orig.call(this,req,...rest);};
  const out={};
  try{
    for(const f of [...files,'lib/shopify-order-refresh.js','lib/shopify-order-status.js'])delete require.cache[path.join(ROOT,'netlify',f)];
    for(const f of files)out[f]=require(path.join(ROOT,'netlify',f));
    out.lib=require(path.join(ROOT,'netlify','lib','shopify-order-refresh.js'));
  }finally{Module._load=orig;}
  out.db=admin.firestore();
  return out;
}
const H=h=>({get:k=>h[k.toLowerCase()]||null});
const L=(id,qty)=>({id,quantity:qty,price:'100.00',title:'T',variant_id:1,sku:'S'+id});

function seed(){
  const o=(st,can)=>({order_number:1,created_at:'2026-09-01T00:00:00Z',total_price:300,financial_status:st,cancelled_at:can||null,refunded_at:null,synced_at:'OLD'});
  const l=(oid,id,qty,st)=>({order_id:oid,line_item_id:id,sku:'S'+id,product_title:'T',quantity:qty,price:100,order_created_at:'2026-09-01T00:00:00Z',financial_status:st,synced_at:'OLD'});
  const d={};
  d['shopify_orders/1001']=o('paid');d['shopify_line_items/1001_11']=l(1001,11,3,'paid');d['shopify_line_items/1001_12']=l(1001,12,1,'paid');
  d['shopify_orders/1002']=o('paid');d['shopify_line_items/1002_21']=l(1002,21,2,'paid');
  d['shopify_orders/1003']=o('paid');d['shopify_line_items/1003_31']=l(1003,31,1,'paid');
  // 1004 is ALREADY what Shopify will say → must not be written
  d['shopify_orders/1004']=Object.assign(o('voided','2026-09-10T00:00:00Z'),{refunded_at:null});
  d['shopify_line_items/1004_41']=Object.assign(l(1004,41,1,'voided'),{cancelled_at:'2026-09-10T00:00:00Z',refunded_quantity:0,refunded_at:null});
  return d;
}
const R=(at,lid,q)=>({created_at:at,refund_line_items:[{line_item_id:lid,quantity:q}]});
function page1(){return[
  {id:1001,financial_status:'partially_refunded',cancelled_at:null,line_items:[L(11,3),L(12,1),L(13,1)],
   refunds:[R('2026-09-20T10:00:00Z',11,1),R('2026-09-22T10:00:00Z',11,1)]},
  {id:1002,financial_status:'refunded',cancelled_at:null,line_items:[L(21,2)],refunds:[R('2026-09-15T08:00:00Z',21,2)]},
  {id:1003,financial_status:'voided',cancelled_at:'2026-09-21T09:00:00Z',line_items:[L(31,1)],refunds:[]},
  {id:1004,financial_status:'voided',cancelled_at:'2026-09-10T00:00:00Z',line_items:[L(41,1)],refunds:[]},
  {id:9999,financial_status:'paid',cancelled_at:null,line_items:[L(91,1)],refunds:[]}];}

function scripted(state,pages){ // pages: array of order arrays, or functions returning a response
  return async(url)=>{
    state.urls.push(String(url));
    if(/oauth\/access_token/.test(url))return{ok:true,status:200,json:async()=>({access_token:'tok'})};
    const i=state.pageNo++;
    const p=typeof pages==='function'?pages(i,url):pages[Math.min(i,pages.length-1)];
    if(p&&p.status)return ({ok:p.status<300,status:p.status,headers:H(p.headers||{}),text:async()=>'x',json:async()=>({orders:[]})});
    if(state.onFetch)state.onFetch(i);
    const link=i<(state.nextPages||0)?{link:'<https://shop/admin/api/2026-04/orders.json?page_info=PG'+(i+2)+'&limit=100>; rel="next"'}:{};
    return{ok:true,status:200,headers:H(link),json:async()=>({orders:JSON.parse(J(p))}),text:async()=>''};
  };
}
const ENV=['SHOPIFY_CLIENT_ID','SHOPIFY_CLIENT_SECRET','SHOPIFY_STORE_DOMAIN','FIREBASE_SERVICE_ACCOUNT'];
function withEnv(fn){const sv={};ENV.forEach(k=>{sv[k]=process.env[k];process.env[k]=k==='FIREBASE_SERVICE_ACCOUNT'?'{}':'shop';});const f=global.fetch;
  return Promise.resolve(fn()).finally(()=>{global.fetch=f;ENV.forEach(k=>{if(sv[k]===undefined)delete process.env[k];else process.env[k]=sv[k];});});}

module.exports=async function(){
  const s=suite('order-refresh');
  const NOW=Date.parse('2026-09-30T00:00:00Z');
  const base=st=>({db:st.fresh.db,token:'t',store:'shop',metaDoc:'order_refresh',mode:'scheduled',now:()=>NOW,clock:()=>st.T,budgetMs:10000,sleep:async ms=>{st.sleeps.push(ms);}});
  const mk=(docs)=>{const st={docs:docs||seed(),writes:[],urls:[],pageNo:0,T:0,sleeps:[],tokens:{}};st.fresh=loadFresh(st,[]);return st;};

  s.section('partial refund, full refund, cancellation, void — first run');
  let st=mk();
  global.fetch=scripted(st,[page1()]);
  let r=await st.fresh.lib.refreshOrders(base(st));
  const D=st.docs;
  s.eq('complete',r.status,'complete');
  s.eq('5 seen, 1 not held (9999), 3 orders changed (1004 already right)',J([r.orders_seen,r.orders_missing,r.orders_changed]),J([5,1,3]));
  s.eq('4 line docs changed (11,12,21,31), 1 line with no doc (13)',J([r.line_items_changed,r.line_items_missing]),J([4,1]));
  s.eq('line 11: 1+1 refunded of 3, latest refund date',J([D['shopify_line_items/1001_11'].refunded_quantity,D['shopify_line_items/1001_11'].refunded_at]),J([2,'2026-09-22T10:00:00Z']));
  s.eq('line 12 untouched by the refund: 0, null, but takes the order status',J([D['shopify_line_items/1001_12'].refunded_quantity,D['shopify_line_items/1001_12'].refunded_at,D['shopify_line_items/1001_12'].financial_status]),J([0,null,'partially_refunded']));
  s.eq('order 1001 status + refunded_at',J([D['shopify_orders/1001'].financial_status,D['shopify_orders/1001'].refunded_at]),J(['partially_refunded','2026-09-22T10:00:00Z']));
  s.eq('full refund: line 21 refunded 2 of 2',D['shopify_line_items/1002_21'].refunded_quantity,2);
  s.eq('cancellation: order + line carry cancelled_at',J([D['shopify_orders/1003'].cancelled_at,D['shopify_line_items/1003_31'].cancelled_at,D['shopify_orders/1003'].financial_status]),J(['2026-09-21T09:00:00Z','2026-09-21T09:00:00Z','voided']));
  s.ok('an already-correct voided order was not written',!st.writes.some(p=>/1004/.test(p)));
  s.ok('no order or line doc was created (9999, line 13)',!D['shopify_orders/9999']&&!D['shopify_line_items/1001_13']&&!D['shopify_line_items/9999_91']);
  s.eq('quantity/price/sku/synced_at are not touched',J([D['shopify_line_items/1001_11'].quantity,D['shopify_line_items/1001_11'].price,D['shopify_line_items/1001_11'].sku,D['shopify_line_items/1001_11'].synced_at]),J([3,100,'S11','OLD']));
  s.eq('order synced_at not touched',D['shopify_orders/1001'].synced_at,'OLD');
  s.ok('first window is 7 days back',/updated_at_min=2026-09-23T00%3A00%3A00.000Z/.test(st.urls.find(u=>/orders\.json/.test(u))));

  s.section('idempotent, and an order updated twice');
  st.writes.length=0;st.pageNo=0;
  r=await st.fresh.lib.refreshOrders(base(st));
  s.eq('second run over the same data changes nothing',J([r.orders_changed,r.line_items_changed,st.writes.length]),J([0,0,0]));
  const p2=page1();p2[0].financial_status='refunded';p2[0].refunds.push(R('2026-09-25T12:00:00Z',11,1));
  st.pageNo=0;global.fetch=scripted(st,[p2]);
  r=await st.fresh.lib.refreshOrders(base(st));
  s.eq('third refund: line 11 is 3 of 3, later date; only 1001 + its lines 11,12 changed',J([D['shopify_line_items/1001_11'].refunded_quantity,D['shopify_line_items/1001_11'].refunded_at,r.orders_changed,r.line_items_changed]),J([3,'2026-09-25T12:00:00Z',1,2]));

  s.section('checkpoint: resume and the 48h overlap');
  st=mk();st.nextPages=1;
  global.fetch=scripted(st,[page1().slice(0,2),page1().slice(2)]);
  st.onFetch=i=>{if(i===0)st.T=8000;};         // page 1 eats the budget → 2000ms left < 3000 reserve
  r=await st.fresh.lib.refreshOrders(base(st));
  let m=st.docs['shopify_sync_meta/order_refresh'];
  s.eq('stopped partial on the time budget with a resume url',J([r.status,r.stopped_because,m.resume_url,m.status]),J(['partial','time_budget','https://shop/admin/api/2026-04/orders.json?page_info=PG2&limit=100','partial']));
  s.eq('page 1 was applied (1001, 1002), page 2 not yet',J([st.docs['shopify_orders/1001'].financial_status,st.docs['shopify_orders/1003'].financial_status]),J(['partially_refunded','paid']));
  st.urls.length=0;st.pageNo=1;st.T=0;st.onFetch=null;st.nextPages=0;
  global.fetch=scripted(st,[[],page1().slice(2)]);
  r=await st.fresh.lib.refreshOrders(Object.assign(base(st),{now:()=>NOW+86400000}));
  m=st.docs['shopify_sync_meta/order_refresh'];
  s.eq('next run continues from the stored url, not a fresh window',st.urls.filter(u=>/orders\.json/.test(u))[0],'https://shop/admin/api/2026-04/orders.json?page_info=PG2&limit=100');
  s.eq('complete; last_complete_at is when the FIRST run started',J([r.status,m.last_complete_at,m.resume_url]),J(['complete','2026-09-30T00:00:00.000Z',null]));
  s.eq('page 2 applied on resume',st.docs['shopify_orders/1003'].cancelled_at,'2026-09-21T09:00:00Z');
  st.urls.length=0;st.pageNo=0;global.fetch=scripted(st,[[]]);
  await st.fresh.lib.refreshOrders(Object.assign(base(st),{now:()=>Date.parse('2026-10-05T00:00:00Z')}));
  s.ok('next window = last_complete_at - 48h (overlap)',/updated_at_min=2026-09-28T00%3A00%3A00.000Z/.test(st.urls.find(u=>/orders\.json/.test(u))));
  st.urls.length=0;st.pageNo=0;
  await st.fresh.lib.refreshOrders(Object.assign(base(st),{overlapHours:6,now:()=>Date.parse('2026-10-05T00:00:00Z')}));
  s.ok('overlap is configurable (6h back from the previous complete run, 2026-10-05 → 2026-10-04T18:00Z)',/updated_at_min=2026-10-04T18%3A00%3A00.000Z/.test(st.urls.find(u=>/orders\.json/.test(u))));

  s.section('rate limit (429)');
  st=mk();
  global.fetch=scripted(st,i=>i===0?{status:429,headers:{'retry-after':'2'}}:page1());
  r=await st.fresh.lib.refreshOrders(base(st));
  s.eq('waited Retry-After (2s) once, retried, completed',J([st.sleeps,r.retries_429,r.status,r.orders_changed]),J([[2000],1,'complete',3]));
  st=mk();
  global.fetch=scripted(st,()=>({status:429,headers:{'retry-after':'2'}}));
  r=await st.fresh.lib.refreshOrders(base(st));
  m=st.docs['shopify_sync_meta/order_refresh'];
  s.eq('429 that never clears: 3 waits, stops partial, nothing written, resumable',J([st.sleeps.length,r.status,r.stopped_because,st.writes.length,!!m.resume_url]),J([3,'partial','rate_limited',0,true]));
  st=mk();
  global.fetch=scripted(st,i=>i===0?{status:429,headers:{'retry-after':'60'}}:page1());
  r=await st.fresh.lib.refreshOrders(Object.assign(base(st),{budgetMs:20000}));
  s.eq('a Retry-After longer than the time left is not slept on',J([st.sleeps.length,r.stopped_because]),J([0,'rate_limited']));
  st=mk();global.fetch=scripted(st,[{status:500}]);
  let threw=null;try{await st.fresh.lib.refreshOrders(base(st));}catch(e){threw=e.message;}
  s.ok('a 500 throws and is recorded as an error',/Shopify 500/.test(threw)&&st.docs['shopify_sync_meta/order_refresh'].last_status==='error');

  s.section('scheduled function and the owners\' on-demand wrapper');
  await withEnv(async()=>{
    st=mk();st.tokens={t_afnan:{email:'afnan@groovy.op'},t_ammar:{email:'Ammar@groovy.op'},t_mustafa:{email:'mustafa@groovy.op'}};
    const f=loadFresh(st,['functions/shopify-order-refresh-background.js','functions/shopify-order-refresh-now-background.js']);
    const sched=f['functions/shopify-order-refresh-background.js'],now=f['functions/shopify-order-refresh-now-background.js'];
    global.fetch=scripted(st,[page1()]);
    const res=await sched.handler({});
    s.eq('scheduled handler runs and writes order_refresh',J([res.statusCode,!!st.docs['shopify_sync_meta/order_refresh'],st.docs['shopify_orders/1002'].financial_status]),J([200,true,'refunded']));
    const call=b=>now.handler({httpMethod:'POST',body:JSON.stringify(b)});
    st.writes.length=0;
    s.eq('GET → 405',(await now.handler({httpMethod:'GET'})).statusCode,405);
    s.eq('no token → 400',(await call({})).statusCode,400);
    s.eq('bad token → 401',(await call({idToken:'nope'})).statusCode,401);
    s.eq('a manager (Mustafa) → 403',(await call({idToken:'t_mustafa'})).statusCode,403);
    s.eq('days 0 / 366 / "x" / 1.5 → 400',J(await Promise.all([0,366,'x',1.5].map(async d=>(await call({idToken:'t_afnan',days:d})).statusCode))),J([400,400,400,400]));
    s.eq('none of those touched Firestore',J([st.writes.length,!!st.docs['shopify_sync_meta/order_refresh_now']]),J([0,false]));
    st.pageNo=0;global.fetch=scripted(st,[[]]);
    let o=await call({idToken:'t_afnan'});
    let b=JSON.parse(o.body);
    s.eq('owner, default 60 days',J([o.statusCode,b.days,b.status,b.ran_by]),J([200,60,'complete','afnan@groovy.op']));
    s.eq('result is in shopify_sync_meta/order_refresh_now',st.docs['shopify_sync_meta/order_refresh_now'].days,60);
    st.pageNo=0;global.fetch=scripted(st,[[]]);
    o=await call({idToken:'t_afnan',days:365});
    s.eq('365 accepted',JSON.parse(o.body).days,365);
    s.eq('Ammar (mixed-case email) is an owner, compared lower-cased',(await call({idToken:'t_ammar',days:3})).statusCode,200);
    s.eq('OWNER_EMAILS is exactly the two owners in firestore.rules isOwner()',J(now.OWNER_EMAILS),J(['afnan@groovy.op','ammar@groovy.op']));
    const rules=require('fs').readFileSync(path.join(ROOT,'firestore.rules'),'utf8');
    s.ok('…and the rules still say the same',/function isOwner\(\) \{\s*return signedIn\(\) && userEmail\(\) in \['afnan@groovy.op','ammar@groovy.op'\];/.test(rules));
    s.ok('shopify_orders / shopify_line_items / shopify_sync_meta stay write:false',['shopify_orders','shopify_line_items','shopify_sync_meta'].every(c=>new RegExp('match /'+c+'/\\{doc\\} \\{\\s*allow read:[^\\n]*\\n\\s*allow write: if false;').test(rules)));
    const toml=require('fs').readFileSync(path.join(ROOT,'netlify.toml'),'utf8');
    s.ok('scheduled in netlify.toml, offset from the order sync',/\[functions\."shopify-order-refresh-background"\]\s*\n\s*schedule = "20 \*\/4 \* \* \*"/.test(toml));
  });

  s.section('order sync: NEW line items carry the same status fields (one helper)');
  await withEnv(async()=>{
    st={docs:{},writes:[],urls:[],pageNo:0,tokens:{}};
    const f=loadFresh(st,['functions/shopify-order-sync.js']);
    global.fetch=scripted(st,[[{id:5001,order_number:5,created_at:'2026-09-29T00:00:00Z',currency:'PKR',total_price:'200',financial_status:'partially_refunded',cancelled_at:null,
      line_items:[L(51,2),L(52,1)],refunds:[R('2026-09-29T05:00:00Z',51,1)]}]]);
    const res=await f['functions/shopify-order-sync.js'].handler({});
    s.eq('200',res.statusCode,200);
    const a=st.docs['shopify_line_items/5001_51'],b=st.docs['shopify_line_items/5001_52'];
    s.eq('refunded line: qty 1 and its date',J([a.refunded_quantity,a.refunded_at]),J([1,'2026-09-29T05:00:00Z']));
    s.eq('untouched line: 0 / null, cancelled_at null',J([b.refunded_quantity,b.refunded_at,b.cancelled_at]),J([0,null,null]));
    s.eq('order doc has refunded_at and cancelled_at',J([st.docs['shopify_orders/5001'].refunded_at,st.docs['shopify_orders/5001'].cancelled_at]),J(['2026-09-29T05:00:00Z',null]));
    s.eq('existing fields unchanged (quantity, price, financial_status)',J([a.quantity,a.price,a.financial_status]),J([2,100,'partially_refunded']));
  });
  return s;
};

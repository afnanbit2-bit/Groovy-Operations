/* Inventory Intel reads ONLY the cancelled orders (Oct 2026): getDocs(query(collection(db,'shopify_orders'), where('cancelled_at','>',''))),
   never the whole 33k-document collection. _siOrders is that list (entries keep _id = the document id); _siClean drops line items whose
   order id is in it; the page says "Cancelled orders: N"; the device copy of 'orders' holds only that list (shape tag bumped).
   Hand-computed fixture (T = today PKT, real clock; the fake clock for the device copy is anchored to the real PKT day as in tests/shopify-cache.test.js):
   - 300 orders, ids 1..300 (document id = String(order_id)). Cancelled = every 25th id: 25,50,...,300 = 12 orders (cancelled_at an ISO string).
     The other 288 carry cancelled_at null (even ids), a missing field (ids divisible by 3 and odd) or '' (the rest), none of which a string range '> ""' returns.
   - 300 line items, one per order (line id 1000+i, sku AA-S for even order ids and AA-M for odd, qty 1, price 100), all inside the 90-day window.
     Window read = 300 documents. Cleaned = 300 - 12 = 288 used, 12 left out as 'cancelledOrder'.
   - The fake Firestore HONOURS the string range (only string values greater than the bound) and counts, per collection, the calls, the documents
     returned and the recorded constraint list of every orders query ("UNFILTERED" when it has no where). A regression to an unfiltered read shows up as
     docs 300 instead of 12 and as a recorded UNFILTERED query.
   Each "break" mutates the source in a string and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const H=3600000;
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
const waitIdle=async()=>{await flush();await new Promise(r=>setTimeout(r,30));await flush();};
const dayShift=(T,k)=>new Date(new Date(T+'T00:00:00Z').getTime()-k*86400000).toISOString().slice(0,10);
const ts=ms=>({seconds:Math.floor(ms/1000)});
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const BIG=['shopify_products','shopify_orders','shopify_line_items','shopify_weekly_closes'];
const N_ORDERS=300,N_CANC=12,CANC_AT='2026-09-01T10:00:00+05:00';

function fakeFs(T,o){
  o=o||{};
  const st={calls:{},docs:{},orderQueries:[],lineQueries:[],fail:{},
    stamps:Object.assign({catalog_sync:0,order_sync:0,order_refresh:0,order_refresh_now:null,inventory_sync:0},o.stamps||{})};
  const D=k=>dayShift(T,k)+'T10:00:00+05:00';
  st.D=D;
  st.orders=[];st.lines=[];
  const cancelEvery=o.cancelEvery===undefined?25:o.cancelEvery;
  for(let i=1;i<=N_ORDERS;i++){
    const ord={order_id:i,created_at:D(1+Math.floor(i*80/N_ORDERS)),total_price:100};
    if(cancelEvery&&i%cancelEvery===0)ord.cancelled_at=CANC_AT;
    else if(i%2===0)ord.cancelled_at=null;
    else if(i%3===0){/* field missing */}
    else ord.cancelled_at='';
    st.orders.push(ord);
    st.lines.push({order_id:i,line_item_id:1000+i,sku:i%2===0?'AA-S':'AA-M',quantity:1,price:100,order_created_at:ord.created_at,financial_status:'paid'});
  }
  st.prods=[
    {sku:'AA-S',product_title:'Alpha',color:'Red',size:'S',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v1'},
    {sku:'AA-M',product_title:'Alpha',color:'Red',size:'M',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v2'}];
  st.closes=[{week_ending:dayShift(T,7),revenue:1000}];
  st.snap={date:T,snapshot_at:new Date().toISOString(),items:{a:{sku:'AA-S',variant_id:'v1',available:5},b:{sku:'AA-M',variant_id:'v2',available:3}}};
  const bump=(c,n)=>{st.calls[c]=(st.calls[c]||0)+1;st.docs[c]=(st.docs[c]||0)+n;};
  st.big=()=>BIG.map(n=>n.replace('shopify_','')+':'+(st.calls[n]||0)).join(',');
  st.reset=()=>{st.calls={};st.docs={};st.orderQueries=[];st.lineQueries=[];};
  st.unfiltered=()=>st.orderQueries.filter(q=>q==='UNFILTERED').length;
  st.g={
    collection:(db,name)=>({__c:name,cons:[]}),
    query:(c,...cons)=>({__c:c.__c,cons}),
    where:(f,op,v)=>({t:'where',f,op,v}),orderBy:(f,d)=>({t:'ob',f,d}),limit:n=>({t:'lim',n}),
    doc:(db,c,id)=>({c,id}),
    getDoc:async r=>{
      if(r.c==='shopify_inventory_snapshots'){if(r.id===T)return{exists:()=>true,data:()=>clone(st.snap)};return{exists:()=>false};}
      if(r.c==='shopify_sync_meta'){const v=st.stamps[r.id];return{exists:()=>v!=null,data:()=>({last_success_at:ts(v),last_status:'success'})};}
      return{exists:()=>false};
    },
    getDocs:async q=>{
      const name=q.__c;
      if(st.fail[name])throw st.fail[name];
      let rows=name==='shopify_line_items'?st.lines:name==='shopify_products'?st.prods:name==='shopify_orders'?st.orders:name==='shopify_weekly_closes'?st.closes:[];
      const w=q.cons.filter(c=>c.t==='where');
      if(name==='shopify_line_items'){
        st.lineQueries.push(w.map(c=>c.f+c.op+c.v));
        w.forEach(c=>{if(c.op==='>=')rows=rows.filter(x=>String(x.order_created_at)>=c.v);if(c.op==='<')rows=rows.filter(x=>String(x.order_created_at)<c.v);});
      }
      if(name==='shopify_orders'){
        st.orderQueries.push(w.length?w.map(c=>c.f+c.op+JSON.stringify(c.v)).join('&'):'UNFILTERED');
        // Firestore range semantics: a '>' on a string matches only documents whose field IS a string greater than the bound (null / missing / other types are excluded)
        w.forEach(c=>{if(c.op==='>')rows=rows.filter(x=>typeof x[c.f]==='string'&&x[c.f]>c.v);});
      }
      if(BIG.indexOf(name)>=0)bump(name,rows.length);
      return{forEach:f=>rows.forEach((x,i)=>f({data:()=>clone(x),id:name==='shopify_line_items'?x.order_id+'_'+x.line_item_id:name==='shopify_orders'?String(x.order_id):String(i)}))};
    }
  };
  return st;
}
function fakeCache(now){
  const c={m:new Map(),log:[],n:{put:0,get:0,del:0}};
  c.api={
    available:()=>true,
    get:async k=>{c.n.get++;c.log.push('get:'+k);const r=c.m.get(k);return r?clone(r):null;},
    put:async(k,v,meta)=>{c.n.put++;c.log.push('put:'+k);c.m.set(k,{value:clone(v),savedAt:now(),meta:clone(meta)});return true;},
    del:async k=>{c.n.del++;c.log.push('del:'+k);c.m.delete(k);return true;},
    clear:async()=>{c.m.clear();return true;},
    bytesApprox:async()=>1234567,lastError:''
  };
  return c;
}
function app(src,fx,cache,clk){
  const g=Object.assign({auth:{currentUser:{uid:'u1'}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}}},fx.g);
  if(cache)g.siCache=cache.api;
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',globals:g});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  if(clk){a.ctx.window.__t=clk.t;a.run('_siNow=function(){return window.__t}');}
  return a;
}
async function checks(src){
  const o={};
  const T=app(src,fakeFs('2000-01-01')).run('_siPktDate(0)');
  const B00=Math.floor((Date.now()+5*H)/(24*H))*24*H-5*H;
  const stamps0={catalog_sync:B00-5*H,order_sync:B00-5*H,order_refresh:B00-5*H,inventory_sync:B00-5*H};
  const cold=async(fxo,t0)=>{ // a cold visit with an empty device copy at fake time t0
    const fx=fakeFs(T,Object.assign({stamps:stamps0},fxo||{})),clk={t:t0==null?B00+1*H:t0},cache=fakeCache(()=>clk.t);
    const a=app(src,fx,cache,clk);
    await a.run('loadShopifyData()');await waitIdle();await a.run('window._siCacheFlush()');await waitIdle();
    return{fx,cache,clk,a,R:c=>a.run(c)};
  };
  const warm=async(base,t1,mod,cacheMod)=>{ // a later visit: new sandbox, same Firestore and device copy
    base.fx.reset();if(mod)mod();if(cacheMod)cacheMod(base.cache);
    base.clk.t=t1;
    const a=app(src,base.fx,base.cache,base.clk);
    await a.run('loadShopifyData()');await waitIdle();
    return{a,R:c=>a.run(c)};
  };
  const cancIds=[];for(let i=25;i<=300;i+=25)cancIds.push(String(i));

  // 1 + 8. the cold read
  const c1=await cold();
  {
    o['1. fixture sanity: 300 orders in the collection, exactly 12 with a string cancelled_at above the empty string']=c1.fx.orders.length===N_ORDERS&&c1.fx.orders.filter(x=>typeof x.cancelled_at==='string'&&x.cancelled_at>'').length===N_CANC;
    o['1. the page loaded (_siLoaded) and every collection was read once: products:1,orders:1,line_items:6,weekly_closes:1']=c1.R('_siLoaded')===true&&c1.fx.big()==='products:1,orders:1,line_items:6,weekly_closes:1';
    o['1. cold: exactly ONE orders query, and it carries where cancelled_at > "" (the recorded constraint is cancelled_at>"")']=c1.fx.orderQueries.length===1&&c1.fx.orderQueries[0]==='cancelled_at>""';
    o['1. cold: NO unfiltered getDocs(collection(shopify_orders)) happened']=c1.fx.unfiltered()===0;
    o['1. cold: _siOrders holds exactly the 12 cancelled orders, each with its document id in _id and a cancelled_at']=c1.R('_siOrders.length')===N_CANC&&JSON.stringify(c1.R('_siOrders.map(x=>x._id).sort((a,b)=>a-b)'))===JSON.stringify(cancIds.slice().sort((a,b)=>a-b))&&c1.R('_siOrders.every(x=>typeof x.cancelled_at==="string"&&x.cancelled_at.length>0)')===true;
    o['8. reads per cold visit: orders DOCUMENTS read = 12 (the filtered count)']=c1.fx.docs.shopify_orders===N_CANC;
    o['8. ...and that is not the collection total: 12 !== 300 (the fixture holds 300), the saving is 288 documents']=c1.fx.docs.shopify_orders!==N_ORDERS&&N_ORDERS-c1.fx.docs.shopify_orders===288;
    o['8. the other big reads are unchanged: 2 products, 300 line items (6 ranges), 1 close']=c1.fx.docs.shopify_products===2&&c1.fx.docs.shopify_line_items===N_ORDERS&&c1.fx.docs.shopify_weekly_closes===1;
  }
  // 2. equivalence with the old-style full read
  {
    const eq=c1.R('(function(){const lines=_siLineItems.slice(),prods=_siProducts,snap=_siSnapshot;'
      +'const full='+JSON.stringify(c1.fx.orders)+'.map(x=>Object.assign({_id:String(x.order_id)},x));'
      +'const a=_siClean({products:prods,lineItems:lines,orders:full,snapshot:snap}),b=_siClean({products:prods,lineItems:lines,orders:_siOrders,snapshot:snap});'
      +'const f=r=>JSON.stringify({q:r.quality,li:r.lineItems.map(x=>x.li.order_id+"_"+x.li.line_item_id+":"+x.qty),ex:r.excluded,st:r.stock.map(x=>x.nsku+":"+x.available)});'
      +'return JSON.stringify({same:f(a)===f(b),used:b.lineItems.length,canc:b.quality.lineItems.cancelledOrder,total:b.quality.lineItems.total,leaked:b.lineItems.filter(x=>x.li.order_id%25===0).length,kept:b.lineItems.filter(x=>x.li.order_id%25!==0).length});})()');
    const j=JSON.parse(eq);
    o['2. _siClean with the cancelled-only list gives output IDENTICAL to an old-style full-orders input (quality, kept lines, excluded, stock)']=j.same===true;
    o['2. _siClean leaves out the lines of the 12 cancelled orders (cancelledOrder 12, none of order ids 25,50,...,300 kept)']=j.canc===N_CANC&&j.leaked===0;
    o['2. ...and keeps the other 288 lines (300 total, 288 used)']=j.kept===288&&j.used===288&&j.total===300;
  }
  // 6. the page text
  {
    let html='';try{html=c1.R('_siOverview(_siComputeMetrics())');}catch(e){html='THROW '+e.message;}
    o['6. the Sync Status text says "Cancelled orders: 12" (the count of the filtered list)']=/Cancelled orders:\s*(<strong>)?\s*12\b/.test(html);
    o['6. ...and never "Orders: " with a total: no capital-O "Orders:" and the orders figure is not 300']=!/Orders:/.test(html)&&!/orders:\s*(<strong>)?\s*300\b/i.test(html);
  }
  // 7. the saved copy
  {
    const rec=c1.cache.m.get('orders');
    o['7. the saved copy for "orders" contains only the 12 cancelled orders (value length 12, count 12 in its meta)']=!!rec&&rec.value.length===N_CANC&&rec.meta.count===N_CANC&&rec.value.every(x=>typeof x.cancelled_at==='string'&&x.cancelled_at>'');
    o['7. the saved shape tag is not the pre-change whole-collection tag 2026-10-11a (it was bumped)']=!!rec&&rec.meta.shape!==undefined&&rec.meta.shape!=='2026-10-11a'&&rec.meta.shape===c1.R('_SI_CACHE_SHAPE');
    const w=await warm(c1,B00+2*H);
    o['7. a current-shape copy, nothing moved: zero big reads and NO orders query at all (device-copy revalidation reads nothing)']=c1.fx.big()==='products:0,orders:0,line_items:0,weekly_closes:0'&&c1.fx.orderQueries.length===0&&w.R('_siOrders.length')===N_CANC;
    // an old-shape copy: the whole collection, tagged with the old shape
    const old=await cold();
    const orec=old.cache.m.get('orders');
    const whole=old.fx.orders.map(x=>Object.assign({_id:String(x.order_id)},x));
    old.cache.m.set('orders',{value:whole,savedAt:orec.savedAt,meta:Object.assign({},orec.meta,{shape:'2026-10-11a',count:whole.length})});
    const w2=await warm(old,B00+2*H);
    o['7. an old-shape (whole-collection, 300 entries) saved copy is a MISS: orders is read from Firestore with the filtered query (1 call, 12 documents), the other collections come from their copies']=old.fx.big()==='products:0,orders:1,line_items:0,weekly_closes:0'&&old.fx.docs.shopify_orders===N_CANC&&old.fx.orderQueries.length===1&&old.fx.orderQueries[0]==='cancelled_at>""'&&w2.R('_siOrders.length')===N_CANC;
    o['7. ...the old copy was never used: no 300-order array is in memory and the stale record was deleted or replaced by the 12-entry one']=(()=>{const r=old.cache.m.get('orders');return!!r&&r.value.length===N_CANC;})()||old.cache.log.indexOf('del:orders')>=0;
    o['7. device-copy revalidation after the miss: NO unfiltered orders read']=old.fx.unfiltered()===0;
  }
  // 5. a new cancellation appears; the order sync moved
  {
    const fk=fakeFs(T,{stamps:stamps0}),a=app(src,fk,null,null);
    fk.stamps.order_sync=Date.parse('2026-01-01T00:00:00Z')/1000*1000; // any readable stamp
    await a.run('loadShopifyData()');await waitIdle();
    const before=JSON.parse(a.run('JSON.stringify((function(){const c=_siClean({products:_siProducts,lineItems:_siLineItems,orders:_siOrders,snapshot:_siSnapshot});return{canc:c.quality.lineItems.cancelledOrder,has7:c.lineItems.filter(x=>x.li.order_id===7).length};})())'));
    fk.orders.find(x=>x.order_id===7).cancelled_at=CANC_AT; // a customer cancelled order 7 after the first read
    fk.stamps.order_sync+=4*H;
    fk.reset();
    const res=await a.run('siRefresh()');
    const after=JSON.parse(a.run('JSON.stringify((function(){const c=_siClean({products:_siProducts,lineItems:_siLineItems,orders:_siOrders,snapshot:_siSnapshot});return{canc:c.quality.lineItems.cancelledOrder,has7:c.lineItems.filter(x=>x.li.order_id===7).length,n:_siOrders.length};})())'));
    o['5. before: order 7 is not cancelled, its line is counted (12 cancelled lines left out, 1 line for order 7 kept)']=before.canc===N_CANC&&before.has7===1;
    o['5. the order sync stamp moved: the refresh re-read orders (and lines), and the orders read was the FILTERED one (13 documents, not 300)']=(res.read||[]).indexOf('orders')>=0&&fk.calls.shopify_orders===1&&fk.docs.shopify_orders===N_CANC+1&&fk.orderQueries.length===1&&fk.orderQueries[0]==='cancelled_at>""';
    o['5. after: _siOrders has 13 entries and the line of order 7 is now left out (13 cancelled lines, 0 kept for order 7)']=after.n===N_CANC+1&&after.canc===N_CANC+1&&after.has7===0;
    o['5. no unfiltered orders read happened during the refresh']=fk.unfiltered()===0;
    // moved stamps through the device copy path: a warm visit whose order stamp moved
    const w=await cold();
    const w2=await warm(w,B00+2*H,()=>{w.fx.orders.find(x=>x.order_id===7).cancelled_at=CANC_AT;w.fx.stamps.order_sync=B00+1*H;});
    o['5. a warm visit after the order stamp moved re-reads orders once, filtered (13 documents), never the collection']=w.fx.calls.shopify_orders===1&&w.fx.docs.shopify_orders===N_CANC+1&&w.fx.unfiltered()===0&&w2.R('_siOrders.length')===N_CANC+1;
  }
  // 3. zero cancelled orders
  {
    const z=await cold({cancelEvery:0});
    const st0=z.R('JSON.stringify({loaded:_siLoaded,coll:!!_siColl.orders,n:_siOrders.length,state:_siLoad.state.orders,fails:Object.keys(_siLoad.fails||{})})');
    const j=JSON.parse(st0);
    o['3. zero cancelled orders: the fixture really has 0 documents the range can return']=z.fx.orders.every(x=>!(typeof x.cancelled_at==='string'&&x.cancelled_at>''));
    o['3. zero cancelled orders is a valid EMPTY result: the page loads, orders stage done, _siOrders is [], no failure recorded']=j.loaded===true&&j.coll===true&&j.n===0&&j.state==='done'&&j.fails.length===0;
    await new Promise(r=>setTimeout(r,200));await waitIdle();
    o['3. ...and it is not a retry loop: after waiting, orders was queried exactly once and returned 0 documents']=z.fx.calls.shopify_orders===1&&z.fx.docs.shopify_orders===0&&z.fx.orderQueries.length===1&&z.fx.orderQueries[0]==='cancelled_at>""';
    let html='';try{html=z.R('_siOverview(_siComputeMetrics())');}catch(e){html='THROW '+e.message;}
    o['3. the page says "Cancelled orders: 0"']=/Cancelled orders:\s*(<strong>)?\s*0\b/.test(html);
    o['3. the saved copy of an empty list is accepted: a warm visit with nothing moved reads no orders']=await(async()=>{const w=await warm(z,B00+2*H);return z.fx.calls.shopify_orders===undefined&&w.R('_siLoaded')===true&&w.R('_siColl.orders')===true;})();
  }
  // 4. a refused orders read still fails the stage
  {
    const fx=fakeFs(T,{stamps:stamps0});
    fx.fail.shopify_orders=Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
    const a=app(src,fx,null,null);
    await a.run('loadShopifyData()');await waitIdle();
    const j=JSON.parse(a.run('JSON.stringify({loaded:_siLoaded,stage:_siLoad.state.orders,cls:(_siLoad.fails.orders||{}).cls,coll:!!_siColl.orders})'));
    o['4. a refused (permission-denied) orders read FAILS the orders stage, classified as permission, and the page is not loaded']=j.stage==='failed'&&j.cls==='permission'&&j.coll===false&&j.loaded===false;
    await new Promise(r=>setTimeout(r,150));await waitIdle();
    o['4. a refusal is never auto-retried: still one orders read after waiting']=(fx.orderQueries.length===0)&&JSON.parse(a.run('JSON.stringify({s:_siLoad.state.orders})')).s==='failed';
    delete fx.fail.shopify_orders;fx.reset();
    await a.run('window._siRetryStage("orders")');await waitIdle();
    const k=JSON.parse(a.run('JSON.stringify({stage:_siLoad.state.orders,n:_siOrders.length})'));
    o['4. after the refusal is cleared, Retry reads orders with the filtered query only (12 documents, no unfiltered read) and the stage is done']=k.stage==='done'&&k.n===N_CANC&&fx.orderQueries.length===1&&fx.orderQueries[0]==='cancelled_at>""'&&fx.docs.shopify_orders===N_CANC;
  }
  // 1 (retry path), network failure then Retry stays filtered
  {
    const fx=fakeFs(T,{stamps:stamps0});
    fx.fail.shopify_orders=Object.assign(new Error('Failed to fetch'),{code:'unavailable'});
    const a=app(src,fx,null,null);
    await a.run('loadShopifyData()');await waitIdle();
    delete fx.fail.shopify_orders;fx.reset();
    await a.run('window._siRetryStage("orders")');await waitIdle();
    o['1. retry after a network failure: the orders read is the filtered query, never the whole collection']=fx.orderQueries.length>=1&&fx.orderQueries.every(q=>q==='cancelled_at>""')&&fx.unfiltered()===0&&a.run('_siOrders.length')===N_CANC;
  }
  return o;
}
module.exports=async function(){
  const s=suite('shopify-orders-cancelled');
  s.section('only the cancelled orders are read');
  const base=await checks(SRC);
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks - each must fail the named check');
  const names=Object.keys(base);
  const brk=async(label,from,to,failing)=>{
    if(SRC.indexOf(from)<0){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.replace(from,to));}catch(e){r=null;}
    const failed=names.filter(k=>!r||r[k]!==true);
    const hit=failing.filter(f=>failed.some(k=>k.indexOf(f)===0));
    s.ok('break "'+label+'" fails "'+failing.join('" and "')+'"',hit.length===failing.length,hit.length===failing.length?undefined:'failed: '+failed.slice(0,4).join(' | '));
  };
  const BREAKS=[
    ['orders read is unfiltered',"orders:_siColRunner('orders','shopify_orders',()=>query(collection(db,'shopify_orders'),where('cancelled_at','>',''))),","orders:_siColRunner('orders','shopify_orders'),",['1. cold: exactly ONE','1. cold: NO unfiltered','8. reads per cold visit','1. retry after a network failure']],
    ['range operator changed to >=',"where('cancelled_at','>','')","where('cancelled_at','>=','')",['1. cold: exactly ONE','5. the order sync stamp moved']],
    ['_siClean no longer drops cancelled orders',"orders.forEach(o=>{if(o&&o.cancelled_at)cancelled.add(","orders.forEach(o=>{if(false)cancelled.add(",['2. _siClean leaves out','5. after: _siOrders has 13']],
    ['page still says Orders',"· Cancelled orders: <strong>","· Orders: <strong>",['6. the Sync Status text','3. the page says']],
    ['shape tag not bumped',"_SI_CACHE_SHAPE='2026-10-11b'","_SI_CACHE_SHAPE='2026-10-11a'",['7. the saved shape tag','7. an old-shape']],
    ['an empty orders read fails the stage',"if(!a.length&&(id==='products'))","if(!a.length&&(id==='products'||id==='orders'))",['3. zero cancelled orders is a valid EMPTY result','3. ...and it is not a retry loop']],
    ['order sync move no longer re-reads orders',"orders:['orders','refresh'],lines:","orders:['catalog'],lines:",['5. the order sync stamp moved','5. after: _siOrders has 13']],
    ['device copy stores something else for orders',"id==='orders'?_siOrders:_siWeeklyCloses","id==='orders'?[]:_siWeeklyCloses",['7. the saved copy for "orders"']]
  ];
  for(const b of BREAKS)await brk(b[0],b[1],b[2],b[3]);
  return s;
};

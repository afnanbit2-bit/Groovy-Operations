/* Inventory Intel device copy, the page half (js/shopify.js "The device copy"): drives the REAL loadShopifyData / siRefresh against a FAKE
   siCache (a Map with savedAt, JSON-cloned like IndexedDB's structured clone), a fake Firestore that COUNTS every read per collection and
   a fake clock (_siNow). Time is anchored to the real PKT day (the line-item window and its cut use the real Date, as in
   tests/shopify-load-incremental.test.js) with B00 = today's 00:00 PKT and B12 = B00 + 12 h; everything the boundary rule decides is
   judged against those. Fixture: 200 filler lines AA-S at T-10..T-89, 1_11 AA-S @T-1, 2_12 AA-M @T-30, 9_19 AA-S @T-120 (phase 2 only):
   a full window read = 202 documents in 6 date ranges; an incremental read after "refund 1_11 and add 8_81 @T" = 2 documents.
   Each "break" mutates the source in a string and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const H=3600000,MIN=60000;
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
const dayShift=(T,k)=>new Date(new Date(T+'T00:00:00Z').getTime()-k*86400000).toISOString().slice(0,10);
const ts=ms=>({seconds:Math.floor(ms/1000)});
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const BIG=['shopify_products','shopify_orders','shopify_line_items','shopify_weekly_closes'];

/* ── a fake Firestore that counts ── */
function fakeFs(T,o){
  o=o||{};
  const st={calls:{},rows:{},lineQueries:[],metaGets:0,snapGets:0,fail:{},failMeta:null,hold:null,holdAfter:4,
    stamps:Object.assign({catalog_sync:0,order_sync:0,order_refresh:0,order_refresh_now:null,inventory_sync:0},o.stamps||{})};
  const D=k=>dayShift(T,k)+'T10:00:00+05:00';
  st.D=D;
  st.lines=[
    {order_id:1,line_item_id:11,sku:'AA-S',quantity:2,price:100,order_created_at:D(1),financial_status:'paid'},
    {order_id:2,line_item_id:12,sku:'AA-M',quantity:3,price:100,order_created_at:D(30),financial_status:'paid'},
    {order_id:9,line_item_id:19,sku:'AA-S',quantity:6,price:100,order_created_at:D(120),financial_status:'paid'}];
  for(let i=0;i<200;i++)st.lines.push({order_id:100+i,line_item_id:200+i,sku:'AA-S',quantity:1,price:100,order_created_at:D(10+Math.floor(i*79/199)),financial_status:'paid'});
  st.prods=[
    {sku:'AA-S',product_title:'Alpha',color:'Red',size:'S',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v1'},
    {sku:'AA-M',product_title:'Alpha',color:'Red',size:'M',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v2'}];
  st.orders=[{order_id:1,created_at:D(1),total_price:200},{order_id:2,created_at:D(30),total_price:300}];
  st.closes=[{week_ending:dayShift(T,7),revenue:1000}];
  st.snap={date:T,snapshot_at:new Date().toISOString(),items:{a:{sku:'AA-S',variant_id:'v1',available:5},b:{sku:'AA-M',variant_id:'v2',available:3}}};
  const bump=(c,n)=>{st.calls[c]=(st.calls[c]||0)+1;st.rows[c]=(st.rows[c]||0)+n;};
  st.big=()=>BIG.map(n=>n.replace('shopify_','')+':'+(st.calls[n]||0)).join(',');
  st.reset=()=>{st.calls={};st.rows={};st.lineQueries=[];st.metaGets=0;st.snapGets=0;};
  st.g={
    collection:(db,name)=>({__c:name,cons:[]}),
    query:(c,...cons)=>({__c:c.__c,cons}),
    where:(f,op,v)=>({t:'where',f,op,v}),orderBy:(f,d)=>({t:'ob',f,d}),limit:n=>({t:'lim',n}),
    doc:(db,c,id)=>({c,id}),
    getDoc:async r=>{
      if(r.c==='shopify_inventory_snapshots'){st.snapGets++;if(r.id===T)return{exists:()=>true,data:()=>clone(st.snap)};return{exists:()=>false};}
      if(r.c==='shopify_sync_meta'){
        st.metaGets++;
        if(st.hold&&st.metaGets>st.holdAfter)await Promise.race([st.hold,new Promise(r=>setTimeout(r,2000))]); /* bounded, so a broken page cannot hang the test */ // the page's own 'meta' stage makes 4 reads first; the held ones are the freshness check's
        if(st.failMeta)throw st.failMeta;
        const v=st.stamps[r.id];
        return{exists:()=>v!=null,data:()=>({last_success_at:ts(v),last_status:'success'})};
      }
      return{exists:()=>false};
    },
    getDocs:async q=>{
      const name=q.__c;
      if(st.fail[name])throw st.fail[name];
      let rows=name==='shopify_line_items'?st.lines:name==='shopify_products'?st.prods:name==='shopify_orders'?st.orders:name==='shopify_weekly_closes'?st.closes:[];
      if(name==='shopify_line_items'){
        const w=q.cons.filter(c=>c.t==='where');
        st.lineQueries.push(w.map(c=>c.f+c.op+c.v));
        w.forEach(c=>{if(c.op==='>=')rows=rows.filter(x=>String(x.order_created_at)>=c.v);if(c.op==='<')rows=rows.filter(x=>String(x.order_created_at)<c.v);});
      }
      if(BIG.indexOf(name)>=0)bump(name,rows.length);
      return{forEach:f=>rows.forEach((x,i)=>f({data:()=>clone(x),id:name==='shopify_line_items'?x.order_id+'_'+x.line_item_id:String(i)}))};
    }
  };
  return st;
}
/* ── a fake siCache: a Map of {value,savedAt,meta}, cloned both ways like structured clone ── */
function fakeCache(now){
  const c={m:new Map(),log:[],mode:{},lastError:'',n:{put:0,get:0,del:0,clear:0}};
  c.api={
    available:()=>c.mode.unavailable?false:true,
    get:async k=>{c.n.get++;c.log.push('get:'+k);if(c.mode.getReject)throw new Error('idb broke');if(c.mode.getNever)return new Promise(()=>{});const r=c.m.get(k);return r?clone(r):null;},
    put:async(k,v,meta)=>{c.n.put++;c.log.push('put:'+k);
      if(c.mode.putFalse){c.api.lastError='QuotaExceededError';return false;}
      if(c.mode.putReject)throw new Error('idb put broke');
      if(c.mode.putNever)return new Promise(()=>{});
      c.m.set(k,{value:clone(v),savedAt:now(),meta:clone(meta)});return true;},
    del:async k=>{c.n.del++;c.log.push('del:'+k);c.m.delete(k);return true;},
    clear:async()=>{c.n.clear++;c.log.push('clear');if(c.mode.clearReject)throw new Error('clear broke');c.m.clear();return true;},
    bytesApprox:async()=>1234567,lastError:''
  };
  return c;
}
/* ── one page load (a fresh sandbox, as a new tab would be) ── */
function app(src,fx,cache,clk,extra){
  const g=Object.assign({auth:{currentUser:{uid:'u1'}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}}},fx.g,extra||{});
  if(cache)g.siCache=cache.api;
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',globals:g});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  a.ctx.window.__t=clk.t;
  a.run('_siNow=function(){return window.__t}');
  a.set=t=>{clk.t=t;a.ctx.window.__t=t;};
  return a;
}
const waitIdle=async()=>{await flush();await new Promise(r=>setTimeout(r,30));await flush();};
async function checks(src){
  const o={};
  const probe=app(src,fakeFs('2000-01-01'),null,{t:0});
  const T=probe.run('_siPktDate(0)');
  const B00=probe.run('siFullBoundary(0)')===undefined?0:(Math.floor((Date.now()+5*H)/(24*H))*24*H-5*H),B12=B00+12*H;
  const mutate=fx=>{fx.lines.find(l=>l.order_id===1).financial_status='refunded';fx.lines.push({order_id:8,line_item_id:81,sku:'AA-M',quantity:5,price:100,order_created_at:fx.D(0),financial_status:'paid'});};
  // a cold visit at fake time t0 (empty cache): returns everything a later visit needs
  const cold=async(t0,extra,fxo)=>{
    if(process.env.SIC_TRACE)console.error('cold@'+(Date.now()%100000));
    const fx=fakeFs(T,fxo||{stamps:{catalog_sync:B00-5*H,order_sync:B00-5*H,order_refresh:B00-5*H,inventory_sync:B00-5*H}});
    const clk={t:t0},cache=fakeCache(()=>clk.t);
    const a=app(src,fx,cache,clk,extra);
    await a.run('loadShopifyData()');await waitIdle();await a.run('window._siCacheFlush()');await waitIdle();
    return{fx,cache,clk,a,R:c=>a.run(c)};
  };
  // a later visit: new sandbox, same Firestore + same cache, new time; the counters are reset first
  const warm=async(base,t1,mod)=>{
    base.fx.reset();
    if(mod)mod();
    base.clk.t=t1;
    const a=app(src,base.fx,base.cache,base.clk);
    await a.run('loadShopifyData()');await waitIdle();
    return{a,R:c=>a.run(c)};
  };

  // 1. cold visit puts every collection
  const c1=await cold(B00+1*H);
  {
    const R=c1.R,fx=c1.fx,cm=c1.cache.m;
    o['cold: loads from Firestore exactly as today (4 big collections once each; 6 date-range queries; 202 line documents)']=R('_siLoaded')===true&&fx.big()==='products:1,orders:1,line_items:6,weekly_closes:1'&&fx.lineQueries.length===6&&fx.rows.shopify_line_items===202;
    o['cold: every collection was put: products, orders, lines, closes, snap (and nothing was put for lines-old, which was not read)']=['products','orders','lines','closes','snap'].every(k=>cm.has(k))&&!cm.has('lines-old');
    o['cold: the stored arrays are the rows that were read (2 products, 2 orders, 202 line items, 1 close)']=cm.get('products').value.length===2&&cm.get('orders').value.length===2&&cm.get('lines').value.length===202&&cm.get('closes').value.length===1;
    const lm=cm.get('lines').meta;
    o['cold: the lines record carries its cut, the time of its full read (fullAt) and last read, and the stamps it was filed under']=lm.cut===dayShift(T,90)&&lm.fullAt===B00+1*H&&lm.lastReadAt===B00+1*H&&lm.stamps&&lm.stamps.orders===B00-5*H;
    o['cold: each collection record is filed under the sync stamps read BEFORE its read (catalog for products, order sync for orders)']=cm.get('products').meta.stamps.catalog===B00-5*H&&cm.get('orders').meta.stamps.orders===B00-5*H&&cm.get('snap').meta.stamps.inventory===B00-5*H;
    o['cold: every record carries a schema number in its meta']=['products','orders','lines','closes','snap'].every(k=>cm.get(k).meta.schema!=null);
    o['cold: the saved snapshot record holds the snapshot object']=cm.get('snap').value&&cm.get('snap').value.snap&&cm.get('snap').value.snap.date===T;
  }
  const mark=l=>{if(process.env.SIC_TRACE)console.error(l+' @'+(Date.now()%100000));};
  // 2. warm, nothing moved
  {
    const w=await warm(c1,B00+3*H);
    const fx=c1.fx;
    o['warm, unmoved stamps: ZERO big reads (no products, orders, line-item or closes query at all)']=fx.big()==='products:0,orders:0,line_items:0,weekly_closes:0'&&fx.lineQueries.length===0;
    o['warm: the page is loaded and holds the same data (2 products, 202 line items, 1 close, the snapshot) as the cold visit']=w.R('_siLoaded')===true&&w.R('_siProducts.length')===2&&w.R('_siLineItems.length')===202&&w.R('_siWeeklyCloses.length')===1&&w.R('_siSnapshot&&_siSnapshot.date')===T;
    o['warm: the five small sync-meta docs WERE read (the check that decides "unmoved" is made, not skipped)']=fx.metaGets>=5;
    o['warm: the page painted from the device copy first (the cache was read for all six keys, hydrate ran before any stage)']=['get:products','get:orders','get:lines','get:lines-old','get:closes','get:snap'].every(k=>c1.cache.log.indexOf(k)>=0);
    o['warm: the line items keep the cold visit\'s full-read time and cut (not re-stamped as read now)']=w.R('_siLinesFullAt')===B00+1*H&&w.R('_siLinesCut')===dayShift(T,90);
    o['warm, nothing moved: the copy is confirmed - the device-copy note is gone and the status says nothing new']=w.R('_siCache.pending')===false&&!/si-fr-cache/.test(w.R('_siFrHtml()'))&&/nothing new/.test(w.R('_siFrView(_siNow()).status'));
  }
  mark('3. orders');
  // 3. orders moved -> incremental lines, full orders, nothing else
  {
    const w=await warm(c1,B00+3*H,()=>{mutate(c1.fx);c1.fx.stamps.order_sync=B00+2*H;});
    const fx=c1.fx;
    o['orders stamp moved: exactly orders and line items are re-read (products 0, closes 0, snapshot not re-read)']=fx.big()==='products:0,orders:1,line_items:1,weekly_closes:0';
    o['orders stamp moved: the line items are read INCREMENTALLY - one range query (>= a recent day), 2 documents, not 202']=fx.lineQueries.length===1&&fx.lineQueries[0].length===1&&/^order_created_at>=/.test(fx.lineQueries[0][0])&&fx.rows.shopify_line_items===2;
    o['orders stamp moved: the merge is by id - 203 lines, no duplicates, the older rows kept, 1_11 now refunded, 8_81 present']=w.R('_siLineItems.length')===203&&w.R('new Set(_siLineItems.map(l=>l._id)).size')===203&&w.R('_siLineItems.find(l=>l._id==="1_11").financial_status')==='refunded'&&!!w.R('_siLineItems.find(l=>l._id==="8_81")')&&w.R('_siLineItems.filter(l=>l.order_created_at<"'+dayShift(T,9)+'").length')>=150;
    o['orders stamp moved: the mode says incremental and the full-read time is still the cold visit\'s']=w.R('_siLinesMode')==='incremental'&&w.R('_siLinesFullAt')===B00+1*H;
    await w.a.run('window._siCacheFlush()');await waitIdle();
    const lm=c1.cache.m.get('lines');
    o['orders stamp moved: the merged result was put back (203 lines, the new stamp, mode incremental, full-read time unchanged)']=lm.value.length===203&&lm.meta.stamps.orders===B00+2*H&&lm.meta.mode==='incremental'&&lm.meta.fullAt===B00+1*H;
    o['orders stamp moved: the orders copy was re-put with the new stamp; the products copy was NOT touched']=c1.cache.m.get('orders').meta.stamps.orders===B00+2*H&&c1.cache.m.get('products').meta.stamps.catalog===B00-5*H;
    // the next visit, nothing moved again
    const w2=await warm(c1,B00+4*H);
    o['the visit after that: 203 lines straight from the copy, zero big reads']=w2.R('_siLineItems.length')===203&&c1.fx.big()==='products:0,orders:0,line_items:0,weekly_closes:0';
  }
  mark('4. other');
  // 4. other single moves
  {
    const cc=await cold(B00+1*H);
    const w=await warm(cc,B00+3*H,()=>{cc.fx.stamps.catalog_sync=B00+2*H;});
    o['catalog stamp moved: only products are re-read (1 query), line items from the copy']=cc.fx.big()==='products:1,orders:0,line_items:0,weekly_closes:0'&&w.R('_siLineItems.length')===202;
    const cd=await cold(B00+1*H);
    const w2=await warm(cd,B00+3*H,()=>{cd.fx.stamps.inventory_sync=B00+2*H;});
    o['inventory stamp moved: no big collection is re-read (only the snapshot document)']=cd.fx.big()==='products:0,orders:0,line_items:0,weekly_closes:0'&&cd.fx.snapGets>=1;
    // the copy's own age limit is 24 h (siCacheFresh): inside it the copy is used, past it the WHOLE copy is a miss
    const ce=await cold(B00+1*H);
    await warm(ce,B00+1*H+23*H);
    o['a copy 23 hours old (inside the 24 hour limit), nothing moved: used, zero big reads']=ce.fx.big()==='products:0,orders:0,line_items:0,weekly_closes:0';
    const cf=await cold(B00+1*H);
    const wf=await warm(cf,B00+1*H+25*H);
    o['a copy 25 hours old: every record is past the age limit, so the page reads all four collections in full as if there were no copy']=cf.fx.big()==='products:1,orders:1,line_items:6,weekly_closes:1'&&wf.R('_siLoaded')===true&&wf.R('_siCache.used.length')===0;
    // a clock that runs backwards (savedAt in the future beyond the skew allowance) is a miss
    const cg=await cold(B00+1*H);
    await warm(cg,B00+1*H-20*MIN);
    o['a copy saved "in the future" (device clock set back by 20 minutes): ignored, read in full']=cg.fx.big()==='products:1,orders:1,line_items:6,weekly_closes:1';
    const ch=await cold(B00+1*H);
    await warm(ch,B00+1*H-2*MIN);
    o['a copy saved 2 minutes "in the future" (inside the 5 minute skew allowance): still used']=ch.fx.big()==='products:0,orders:0,line_items:0,weekly_closes:0';
  }
  mark('5. the 00:00');
  // 5. the 00:00 / 12:00 PKT boundary still forces a full lines read
  const full202=fx=>fx.lineQueries.length===6&&fx.rows.shopify_line_items===202;
  {
    const cases=[
      ['12:00 PKT crossed (cold 11:00, visit exactly 12:00)',B00+11*H,B12,true],
      ['11:59 PKT not crossed (cold 11:00, visit 11:59)',B00+11*H,B12-MIN,false],
      ['00:00 PKT crossed (cold 23:00 the day before, visit exactly 00:00)',B00-1*H,B00,true],
      ['23:59 PKT not crossed (cold 12:30, visit 23:59)',B00+12.5*H,B00+24*H-MIN,false]];
    for(const [label,t0,t1,wantFull] of cases){
      const cc=await cold(t0);
      const w=await warm(cc,t1,()=>{mutate(cc.fx);cc.fx.stamps.order_sync=Math.min(t1,t0+1*H);});
      if(wantFull){
        o['boundary: '+label+' forces a FULL lines read (6 date ranges, the whole window)']=full202(cc.fx)||(cc.fx.lineQueries.length===6&&cc.fx.rows.shopify_line_items===203);
        o['boundary: '+label+' - the result replaces the window and records a new full-read time']=w.R('_siLinesMode')==='full'&&w.R('_siLinesFullAt')===t1;
      }else{
        o['boundary: '+label+' stays INCREMENTAL (1 query, 2 documents)']=cc.fx.lineQueries.length===1&&cc.fx.rows.shopify_line_items===2&&w.R('_siLinesMode')==='incremental';
      }
    }
    // boundary but nothing moved: no read at all (the rule applies to a refresh, it does not invent one)
    const cn=await cold(B00+11*H);
    await warm(cn,B12+MIN);
    o['boundary crossed but NO sync stamp moved: still zero big reads (the boundary forces a full read only when a read is due)']=cn.fx.big()==='products:0,orders:0,line_items:0,weekly_closes:0';
  }
  mark('6. phase 2');
  // 6. phase 2 (older rows)
  {
    const cp=await cold(B00+1*H);
    await cp.a.run('_siFullStart(true)');await waitIdle();await cp.a.run('window._siCacheFlush()');await waitIdle();
    o['phase 2: the older rows are put under lines-old with the cut and the time the read began; the window record holds only the window rows']=cp.cache.m.has('lines-old')&&cp.cache.m.get('lines-old').value.length===1&&cp.cache.m.get('lines-old').meta.cut===dayShift(T,90)&&cp.cache.m.get('lines-old').meta.readAt===B00+1*H&&cp.cache.m.get('lines').value.length===202;
    const w=await warm(cp,B00+3*H);
    o['phase 2: a visit in the same half-day restores the whole history (203 lines, scope full) with zero reads']=w.R('_siLineItems.length')===203&&w.R('_siLinesScope')==='full'&&cp.fx.big()==='products:0,orders:0,line_items:0,weekly_closes:0';
    const w2=await warm(cp,B12+MIN);
    o['phase 2: after the 12:00 PKT boundary the older rows are IGNORED and deleted (refunds mutate them): 202 lines, scope window']=w2.R('_siLineItems.length')===202&&w2.R('_siLinesScope')==='window'&&cp.cache.log.indexOf('del:lines-old')>=0&&!cp.cache.m.has('lines-old');
  }
  mark('7. corrupt');
  // 7. corrupt / mismatched records
  {
    const bads=[
      ['products','value not an array',r=>{r.value={oops:1};}],
      ['products','an empty array (the catalog is never empty)',r=>{r.value=[];}],
      ['products','another schema number',r=>{r.meta.schema=99;}],
      ['products','no meta at all',r=>{delete r.meta;}],
      ['orders','savedAt missing',r=>{delete r.savedAt;}]];
    for(const [k,why,mut] of bads){
      const cc=await cold(B00+1*H);
      mut(cc.cache.m.get(k));
      const w=await warm(cc,B00+3*H);
      const big=cc.fx.big();
      const want=k==='products'?'products:1,orders:0,line_items:0,weekly_closes:0':'products:0,orders:1,line_items:0,weekly_closes:0';
      o['corrupt '+k+' ('+why+'): ignored - that collection is read from Firestore, the others still come from the copy']=big===want&&w.R('_siLoaded')===true;
      o['corrupt '+k+' ('+why+'): the bad record is deleted and replaced by a fresh put']=cc.cache.log.indexOf('del:'+k)>=0;
    }
    const lbad=[
      ['lines','no cut',r=>{delete r.meta.cut;}],
      ['lines','cut older than the window plus slack',r=>{r.meta.cut='2020-01-01';}],
      ['lines','no full-read time',r=>{delete r.meta.fullAt;}],
      ['lines','full-read time after the last read',r=>{r.meta.fullAt=r.meta.lastReadAt+H;}],
      ['lines','not an array',r=>{r.value='junk';}]];
    for(const [k,why,mut] of lbad){
      const cc=await cold(B00+1*H);
      mut(cc.cache.m.get(k));
      const w=await warm(cc,B00+3*H);
      o['corrupt lines ('+why+'): ignored - the window is read in full from Firestore (6 ranges), the rest comes from the copy']=cc.fx.big()==='products:0,orders:0,line_items:6,weekly_closes:0'&&cc.fx.lineQueries.length===6&&w.R('_siLineItems.length')===202;
    }
    for(const [why,val] of [['an array',[]],['an empty object',{}],['a string','junk']]){
      const cs=await cold(B00+1*H);
      cs.cache.m.get('snap').value=val;
      await warm(cs,B00+3*H);
      o['corrupt snapshot record ('+why+'): ignored and deleted']=cs.cache.log.indexOf('del:snap')>=0;
    }
    const cs2=await cold(B00+1*H);
    cs2.cache.m.get('snap').value={snap:7,none:false};
    const ws=await warm(cs2,B00+3*H);
    o['snapshot record whose snap is a number (not an object): ignored, never put into _siSnapshot']=typeof ws.R('_siSnapshot')!=='number';
    // the store itself failing
    for(const [name,mode] of [['get rejects',{getReject:true}],['unavailable()',{unavailable:true}]]){
      const cc=await cold(B00+1*H);
      cc.cache.mode=mode;
      const w=await warm(cc,B00+3*H);
      o['siCache '+name+': the page loads from Firestore as if there were no copy (all four big collections read)']=w.R('_siLoaded')===true&&cc.fx.big()==='products:1,orders:1,line_items:6,weekly_closes:1';
    }
    // a get that never answers: shorten the 4 s bound in a scratch copy of the source so the test does not wait four real seconds
    const quick=src.replace(/_SI_CACHE_GET_MS=\d+/,'_SI_CACHE_GET_MS=40');
    if(quick!==src){
      const fx=fakeFs(T,{stamps:{catalog_sync:B00-5*H,order_sync:B00-5*H,order_refresh:B00-5*H,inventory_sync:B00-5*H}});
      const clk={t:B00+3*H},cache=fakeCache(()=>clk.t);cache.mode={getNever:true};
      const a=app(quick,fx,cache,clk);
      const t0=Date.now();
      await a.run('loadShopifyData()');await waitIdle();
      o['siCache get never answers: the page is not held (loaded from Firestore after the bound, well under a second here)']=a.run('_siLoaded')===true&&fx.big()==='products:1,orders:1,line_items:6,weekly_closes:1'&&Date.now()-t0<3000;
    }else o['siCache get never answers: the page is not held (loaded from Firestore after the bound, well under a second here)']=false;
  }
  mark('8. Firestore refuses');
  // 8. Firestore refuses after a cache hit
  {
    const cc=await cold(B00+1*H);
    const put0=cc.cache.n.put;
    const w=await warm(cc,B00+3*H,()=>{mutate(cc.fx);cc.fx.stamps.order_sync=B00+2*H;cc.fx.fail.shopify_line_items=Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});});
    const v=w.R('_siFrView(_siNow())');
    o['refusal after a cache hit: the page stays loaded and the cached data stays on screen (202 lines, 2 products)']=w.R('_siLoaded')===true&&w.R('_siLineItems.length')===202&&w.R('_siProducts.length')===2;
    o['refusal after a cache hit: the failure is SHOWN (an error status naming the refused read), not swallowed']=v.statusKind==='err'&&/Could not refresh/.test(v.status)&&/insufficient permissions/.test(v.status)&&/role="alert"/.test(w.R('_siFrHtml()'));
    o['refusal after a cache hit: the page still says its data came from the device copy (it is not confirmed)']=w.R('_siCache.pending')===true&&/si-fr-cache/.test(w.R('_siFrHtml()'));
    await w.a.run('window._siCacheFlush()');await waitIdle();
    o['refusal after a cache hit: the refused lines read was NOT put (the stored lines record is unchanged: 202 lines, the old stamp)']=cc.cache.m.get('lines').value.length===202&&cc.cache.m.get('lines').meta.stamps.orders===B00-5*H;
    // the meta check itself refused
    const cm=await cold(B00+1*H);
    const w2=await warm(cm,B00+3*H,()=>{cm.fx.failMeta=Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});});
    const v2=w2.R('_siFrView(_siNow())');
    o['refused sync-meta check after a cache hit: data stays, the page says it could not check, still labelled as the device copy']=w2.R('_siLineItems.length')===202&&v2.statusKind==='err'&&/Could not check/.test(v2.status)&&w2.R('_siCache.pending')===true;
  }
  mark('9. the strip');
  // 9. the strip says device copy + age, never fresh off the copy alone
  {
    const cc=await cold(B00+1*H);
    let release;const gate=new Promise(r=>{release=r;});
    cc.fx.reset();cc.fx.hold=gate;
    cc.clk.t=B00+3*H;
    const a=app(src,cc.fx,cc.cache,cc.clk);
    await a.run('loadShopifyData()');await waitIdle();
    const html=a.run('_siFrHtml()'),v=a.run('_siFrView(_siNow())');
    o['strip, check still running: it says the data came from the copy saved on this device, with the save time']=/id="si-fr-cache"/.test(html)&&/Shown from the copy saved on this device at /.test(html)&&html.indexOf(a.run('_siFrFmt('+(B00+1*H)+')'))>=0;
    o['strip, check still running: it states the copy\'s age (2 hours) and says it is still checking']=/\(2 hours old\); checking for newer\./.test(html);
    o['strip, check still running: the headline line says "(from the copy saved on this device)"']=/\(from the copy saved on this device\)/.test(v.line);
    o['strip, check still running: it never claims fresh - no "nothing new" and no "Updated" status']=!/nothing new|Updated /.test(v.status||'')&&a.run('_siCache.pending')===true;
    release();await waitIdle();
    o['strip, once the check succeeds with nothing moved: the device-copy note is replaced by "nothing new"']=a.run('_siCache.pending')===false&&!/si-fr-cache/.test(a.run('_siFrHtml()'))&&/nothing new/.test(a.run('_siFrView(_siNow()).status'));
    // a cold visit never shows the note
    o['strip, cold visit: no device-copy note at all (it was read from Firestore)']=!/si-fr-cache/.test(c1.R('_siFrHtml()'))&&c1.R('_siCache.pending')===false;
  }
  mark('10. no siCache');
  // 10. no siCache: identical to today
  {
    const fx=fakeFs(T,{stamps:{catalog_sync:B00-5*H,order_sync:B00-5*H,order_refresh:B00-5*H,inventory_sync:B00-5*H}});
    const clk={t:B00+1*H};
    const a=app(src,fx,null,clk);
    await a.run('loadShopifyData()');await waitIdle();
    o['no siCache: loads exactly as before (the numbers of tests/shopify-load-incremental: 6 ranges, 202 documents, full mode, 4 collections once)']=a.run('_siLoaded')===true&&fx.big()==='products:1,orders:1,line_items:6,weekly_closes:1'&&fx.lineQueries.length===6&&fx.rows.shopify_line_items===202&&a.run('_siLinesMode')==='full'&&a.run('_siLinesFullAt')===clk.t;
    o['no siCache: no device-copy note, no "Clear saved data" control, no cache state']=!/si-fr-cache|si-cache/.test(a.run('_siFrHtml()')+a.run('_siNaTrustHtml({red:[],amber:[],quiet:[],unknown:[]})'))&&a.run('_siCache.pending')===false&&a.run('_siCache.used.length')===0;
    fx.reset();
    const b=app(src,fx,null,clk);
    await b.run('loadShopifyData()');await waitIdle();
    o['no siCache: a second visit reads everything again (nothing is remembered between visits)']=fx.big()==='products:1,orders:1,line_items:6,weekly_closes:1'&&fx.rows.shopify_line_items===202;
    // the same with the cache present but not available
    const fx2=fakeFs(T,{stamps:{catalog_sync:B00-5*H,order_sync:B00-5*H,order_refresh:B00-5*H,inventory_sync:B00-5*H}}),clk2={t:B00+1*H},cache2=fakeCache(()=>clk2.t);cache2.mode={unavailable:true};
    const c=app(src,fx2,cache2,clk2);
    await c.run('loadShopifyData()');await waitIdle();
    o['siCache.available() false: same as no siCache - four reads, nothing put, no control shown']=fx2.big()==='products:1,orders:1,line_items:6,weekly_closes:1'&&cache2.n.put===0&&!/si-cache/.test(c.run('_siNaTrustHtml({red:[],amber:[],quiet:[],unknown:[]})'));
    // incremental refresh behaves as today when there is no cache (the existing suite's numbers)
    const fx3=fakeFs(T,{stamps:{catalog_sync:B00-5*H,order_sync:B00-5*H,order_refresh:B00-5*H,inventory_sync:B00-5*H}}),clk3={t:B00+1*H};
    const d=app(src,fx3,null,clk3);
    await d.run('loadShopifyData()');await waitIdle();
    mutate(fx3);fx3.stamps.order_sync=B00+2*H;fx3.reset();clk3.t=B00+3*H;d.a=d;d.ctx.window.__t=clk3.t;
    await d.run('siRefresh()');await waitIdle();
    o['no siCache: a refresh after the order sync moved is incremental, 2 documents, merged to 203 (as in the existing suite)']=fx3.rows.shopify_line_items===2&&d.run('_siLineItems.length')===203;
  }
  mark('11. a failing put');
  // 11. a failing put is silent on the render path
  {
    for(const [name,mode] of [['put resolves false (quota)',{putFalse:true}],['put rejects',{putReject:true}],['put never answers',{putNever:true}]]){
      const fx=fakeFs(T,{stamps:{catalog_sync:B00-5*H,order_sync:B00-5*H,order_refresh:B00-5*H,inventory_sync:B00-5*H}}),clk={t:B00+1*H},cache=fakeCache(()=>clk.t);cache.mode=mode;
      const unhandled=[];const onU=e=>unhandled.push(e);process.on('unhandledRejection',onU);
      const a=app(src,fx,cache,clk);
      const t0=Date.now();
      await a.run('loadShopifyData()');await waitIdle();
      if(!mode.putNever){await a.run('window._siCacheFlush()');await waitIdle();}else{await new Promise(r=>setTimeout(r,200));await waitIdle();}
      process.removeListener('unhandledRejection',onU);
      o['put failure ('+name+'): the page loads normally and fast, with all its data (no hang, no throw)']=a.run('_siLoaded')===true&&a.run('_siLineItems.length')===202&&Date.now()-t0<3000&&unhandled.length===0;
      o['put failure ('+name+'): no toast and no activity is raised (silent on the render path)']=a.state.toasts.length===0&&a.state.activity.length===0;
      if(!mode.putNever)o['put failure ('+name+'): the failure is recorded for the strip and the control ("Saved copy unavailable: ...")']=!!a.run('_siCache.err')&&/Saved copy unavailable/.test(a.run('_siFrHtml()'))&&/Saved copy unavailable/.test(a.run('_siNaTrustHtml({red:[],amber:[],quiet:[],unknown:[]})'));
      else o['put failure ('+name+'): the page is rendered and usable while the save is still pending (the render path never waited on it)']=typeof a.run('_siFrHtml()')==='string'&&a.run('_siFrHtml()').length>0;
    }
  }
  mark('12. the clear');
  // 12. the clear control
  {
    const cc=await cold(B00+1*H);
    const html=cc.R('_siNaTrustHtml({red:[],amber:[],quiet:[],unknown:[]})');
    o['the control is rendered with the cache on: a "Clear saved data on this device" button wired to window._siCacheClear']=/id="si-cache-clear"/.test(html)&&/Clear saved data on this device/.test(html)&&/window\._siCacheClear\(\)/.test(html);
    o['setup: the store holds the five records before the clear']=cc.cache.m.size===5;
    await cc.a.run('window._siCacheClear()');
    o['clear: siCache.clear() was called and the store is EMPTY']=cc.cache.n.clear===1&&cc.cache.m.size===0;
    // a save waiting in the queue is cancelled by the clear, not written after it
    const c2=await cold(B00+1*H);
    c2.a.run('_siCachePut("products",[{x:1}],{})');
    await c2.a.run('window._siCacheClear()');
    await new Promise(r=>setTimeout(r,400));await waitIdle();
    o['clear: a save that was still waiting in the queue is cancelled (the store stays empty after the debounce time)']=c2.cache.m.size===0;
    // a failing clear does not claim success
    const c3=await cold(B00+1*H);c3.cache.mode={clearReject:true};
    await c3.a.run('window._siCacheClear()');
    o['clear that fails: the records stay and the failure is shown ("Saved copy unavailable: ...") instead of a success toast']=c3.cache.m.size===5&&/Saved copy unavailable/.test(c3.R('_siNaTrustHtml({red:[],amber:[],quiet:[],unknown:[]})'))&&c3.a.state.toasts.length===0;
  }
  return o;
}

module.exports=async function(){
  const s=suite('shopify-cache');
  if(process.env.SIC_BASE_ONLY){const b=await checks(SRC);Object.keys(b).forEach(k=>s.ok(k,b[k]===true));return s;}
  s.section('the device copy on the Inventory Intel page (fake siCache, counted Firestore reads, fake clock)');
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
  await brk('hydrate is skipped',"if(_siCacheOn())await _siCacheHydrate();","",['warm, unmoved stamps: ZERO big reads','warm: the line items keep']);
  await brk('collection reads are not saved',"_siColl[id]=true;_siFrNote(id,stamps);_siCachePutColl(id,stamps);","_siColl[id]=true;_siFrNote(id,stamps);",['cold: every collection was put']);
  await brk('the copy\'s stamps are not restored',"function _siCacheNoteStamps(id,rec){_siFr.seen[id]=rec.meta.stamps||null;","function _siCacheNoteStamps(id,rec){_siFr.seen[id]=null;",['warm, unmoved stamps: ZERO big reads']);
  await brk('the boundary no longer forces a full read',"!siLinesFullDue(_siLinesFullAt,t0,_siLinesForceFull)","true",['boundary: 12:00 PKT crossed','boundary: 00:00 PKT crossed']);
  await brk('the full-read time is not restored from the copy',"_siLinesFullAt=m.fullAt;","_siLinesFullAt=_siNow();",['warm: the line items keep','boundary: 12:00 PKT crossed']);
  await brk('any stored record is accepted',"return siCacheFresh(r,_siNow(),true)&&(!needRows||r.value.length>0);","return!!r;",['corrupt products (value not an array)','corrupt orders (savedAt missing)']);
  await brk('every refresh is a full read',"!siLinesFullDue(_siLinesFullAt,t0,_siLinesForceFull)","false",['boundary: 11:59 PKT not crossed','orders stamp moved: the line items are read INCREMENTALLY']);
  await brk('the 24 hour age limit is gone',"||nowMs-r.savedAt>_SI_CACHE_MAX_AGE_MS","",['a copy 25 hours old']);
  await brk('a copy from the future is trusted (the skew allowance is unlimited)',"_SI_CACHE_SKEW_MS=300000","_SI_CACHE_SKEW_MS=9e12",['a copy saved "in the future" (device clock set back by 20 minutes)']);
  await brk('a confirmed copy keeps its note',"function _siCacheSettled(){if(_siCache.pending){_siCache.pending=false;}}","function _siCacheSettled(){}",['warm, nothing moved: the copy is confirmed','strip, once the check succeeds']);
  await brk('a refused write is not recorded',"if(ok===false){","if(false){",['put failure (put resolves false (quota)): the failure is recorded']);
  await brk('clear does not clear the store',"try{await Promise.resolve(siCache.clear());}","try{await Promise.resolve(0);}",['clear: siCache.clear() was called']);
  await brk('the merge replaces instead of merging',"_siLineItems=siMergeLines(_siLineItems,a); // a NEW array: every cache keyed","_siLineItems=a; // a NEW array: every cache keyed",['orders stamp moved: the merge is by id']);
  await brk('the device-copy note is not drawn',"+(v.cacheNote?'<div class=\"si-fr-st pending\" id=\"si-fr-cache\" role=\"status\">'+_siEsc(v.cacheNote)+'</div>':'')","",['strip, check still running: it says the data came from the copy']);
  return s;
};

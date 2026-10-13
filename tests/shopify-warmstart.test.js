/* Inventory Intel ▸ the warm-start speed-up (js/shopify.js, "The device copy" + "Loading, honest percentage and retry").
   A WARM visit is one where a usable device copy exists (a fake siCache, a Map). What this holds, each as a hand-computed COUNT or a named state on a FAKE
   clock (timers, Date.now-style _siNow and the settle/hold windows all run off one counter), never "it seemed quicker":
     (1) the non-critical `meta` stage (previous-week snapshot, sync meta, order-sync meta: serial round trips) does not delay the first render;
         what needs it shows loading / "—" and repaints through the TARGETED repaints when it lands (main-content is never rewritten for it);
     (2) the 500 ms minimum card hold and the 400 ms settle are skipped when the load finished quickly (or on a warm start) and kept for a slow cold load;
     (3) the load card state begins BEFORE the hydrate, hydrated keys land in priority order (snapshot, products, 90-day lines first; closes, orders,
         lines-old after), the 1.5 s per-key cap stays, lines-old is lazy, and nothing a hydrate satisfied is read twice;
     (4) guarded performance marks and a pure window._siLoadMarks() (ms), shown in Data checks only with localStorage 'groovy-si-debug'==='1'.
   Existing guarantees (offline start, no siCache, sign-out guard, no timer left after leaving) are re-checked here, not re-argued.
   Fixture (same as tests/shopify-cache.test.js): 200 filler lines AA-S at T-10..T-89, 1_11 AA-S @T-1, 2_12 AA-M @T-30, 9_19 AA-S @T-120 (phase 2 only).
   A full window read = 202 documents in 6 date ranges; the older rows (phase 2) = 1 document. Each "break" mutates the source in a string and requires
   the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const H=3600000,MIN=60000;
const flush=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
const dayShift=(T,k)=>new Date(new Date(T+'T00:00:00Z').getTime()-k*86400000).toISOString().slice(0,10);
const ts=ms=>({seconds:Math.floor(ms/1000)});
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const BIG=['shopify_products','shopify_orders','shopify_line_items','shopify_weekly_closes'];
const FULL='products:1,orders:1,line_items:6,weekly_closes:1',NONE='products:0,orders:0,line_items:0,weekly_closes:0';

/* ── a fake clock: setTimeout/setInterval and window.__t (read by _siNow) run off one counter ── */
function clock(t0){
  const c={t:t0||0,seq:0,timers:[],win:null};
  c.setTimeout=(fn,ms)=>{const id=++c.seq;c.timers.push({id,at:c.t+(ms||0),fn});return id;};
  c.setInterval=(fn,ms)=>{const id=++c.seq;c.timers.push({id,at:c.t+ms,fn,every:ms});return id;};
  c.clear=id=>{c.timers=c.timers.filter(x=>x.id!==id);};
  c.sync=()=>{if(c.win)c.win.__t=c.t;};
  c.advance=async ms=>{
    const end=c.t+ms;
    for(;;){
      await flush();
      const due=c.timers.filter(x=>x.at<=end).sort((a,b)=>a.at-b.at||a.id-b.id)[0];
      if(!due)break;
      c.t=due.at;c.sync();
      if(due.every)due.at+=due.every;else c.timers=c.timers.filter(x=>x!==due);
      due.fn();
    }
    c.t=end;c.sync();await flush();
  };
  return c;
}
/* ── a fake Firestore that counts, with HOLDS the test releases by hand ── */
function fakeFs(T,o){
  o=o||{};
  const D=k=>dayShift(T,k)+'T10:00:00+05:00';
  const st={calls:{},rows:{},lineQueries:[],metaIds:[],snapIds:[],all:0,gate:{},holdPrev:null,holdBackfill:null,T7:dayShift(T,7),
    stamps:Object.assign({catalog_sync:0,order_sync:0,order_refresh:0,order_refresh_now:null,inventory_sync:0},o.stamps||{})};
  st.D=D;
  st.lines=[
    {order_id:1,line_item_id:11,sku:'AA-S',quantity:2,price:100,order_created_at:D(1),financial_status:'paid'},
    {order_id:2,line_item_id:12,sku:'AA-M',quantity:3,price:100,order_created_at:D(30),financial_status:'paid'},
    {order_id:9,line_item_id:19,sku:'AA-S',quantity:6,price:100,order_created_at:D(120),financial_status:'paid'}];
  for(let i=0;i<200;i++)st.lines.push({order_id:100+i,line_item_id:200+i,sku:'AA-S',quantity:1,price:100,order_created_at:D(10+Math.floor(i*79/199)),financial_status:'paid'});
  st.prods=[
    {sku:'AA-S',product_title:'Alpha',color:'Red',size:'S',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v1'},
    {sku:'AA-M',product_title:'Alpha',color:'Red',size:'M',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v2'}];
  st.orders=[{order_id:1,created_at:D(1),total_price:200},{order_id:2,created_at:D(30),total_price:300},{order_id:3,created_at:D(40),total_price:50,cancelled_at:'2026-09-01T00:00:00Z'}];
  st.closes=[{week_ending:dayShift(T,7),revenue:1000}];
  st.snap={date:T,snapshot_at:new Date().toISOString(),items:{a:{sku:'AA-S',variant_id:'v1',available:5},b:{sku:'AA-M',variant_id:'v2',available:3}}};
  // the snapshot a week ago: AA-S had 9, AA-M had 4 (so the week's stock movement is -4 and -1 once it lands)
  st.prev={date:st.T7,snapshot_at:new Date().toISOString(),items:{a:{sku:'AA-S',variant_id:'v1',available:9},b:{sku:'AA-M',variant_id:'v2',available:4}}};
  const bump=(c,n)=>{st.calls[c]=(st.calls[c]||0)+1;st.rows[c]=(st.rows[c]||0)+n;};
  st.big=()=>BIG.map(n=>n.replace('shopify_','')+':'+(st.calls[n]||0)).join(',');
  st.reset=()=>{st.calls={};st.rows={};st.lineQueries=[];st.metaIds=[];st.snapIds=[];st.all=0;};
  st.count=(arr,id)=>arr.filter(x=>x===id).length;
  st.older=()=>st.lineQueries.filter(w=>w.length===1&&/^order_created_at</.test(w[0])).length; // the phase-2 read: one '<' bound
  st.g={
    collection:(db,name)=>({__c:name,cons:[]}),
    query:(c,...cons)=>({__c:c.__c,cons}),
    where:(f,op,v)=>({t:'where',f,op,v}),orderBy:(f,d)=>({t:'ob',f,d}),limit:n=>({t:'lim',n}),
    doc:(db,c,id)=>({c,id}),
    getDoc:async r=>{
      st.all++;
      if(r.c==='shopify_inventory_snapshots'){
        st.snapIds.push(r.id);
        if(r.id===st.T7){if(st.holdPrev)await st.holdPrev;return st.prev?{exists:()=>true,data:()=>clone(st.prev)}:{exists:()=>false};}
        if(r.id===T)return{exists:()=>true,data:()=>clone(st.snap)};
        return{exists:()=>false};
      }
      if(r.c==='shopify_sync_meta'){
        st.metaIds.push(r.id);
        if(r.id==='order_backfill'){if(st.holdBackfill)await st.holdBackfill;return{exists:()=>true,data:()=>({last_success_at:ts(1),total_orders:3})};}
        const v=st.stamps[r.id];
        return{exists:()=>v!=null,data:()=>({last_success_at:ts(v),last_status:'success'})};
      }
      return{exists:()=>false};
    },
    getDocs:async q=>{
      st.all++;
      const name=q.__c;
      if(st.gate[name])await st.gate[name];
      let rows=name==='shopify_line_items'?st.lines:name==='shopify_products'?st.prods:name==='shopify_orders'?st.orders:name==='shopify_weekly_closes'?st.closes:[];
      if(name==='shopify_orders')q.cons.filter(c=>c.t==='where'&&c.f==='cancelled_at'&&c.op==='>').forEach(c=>{rows=rows.filter(x=>x.cancelled_at!=null&&String(x.cancelled_at)>c.v);});
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
/* ── a fake siCache: a Map of {value,savedAt,meta}; per-key HOLDS (a promise the test resolves, or never) ── */
function fakeCache(now){
  const c={m:new Map(),log:[],hold:{},n:{get:0,put:0,del:0,clear:0}};
  c.api={
    available:()=>true,
    get:async k=>{c.n.get++;c.log.push('get:'+k);if(c.hold[k])await c.hold[k];const r=c.m.get(k);return r?clone(r):null;},
    put:async(k,v,meta)=>{c.n.put++;c.log.push('put:'+k);c.m.set(k,{value:clone(v),savedAt:now(),meta:clone(meta)});return true;},
    del:async k=>{c.n.del++;c.log.push('del:'+k);c.m.delete(k);return true;},
    clear:async()=>{c.n.clear++;c.log.push('clear');c.m.clear();return true;},
    bytesApprox:async()=>1234567,lastError:''
  };
  return c;
}
const never=()=>new Promise(()=>{});
/* ── one page load (a fresh sandbox, as a new tab would be) ── */
function sandbox(src,fx,cache,ck,o){
  o=o||{};
  const ls=o.ls||{};
  const marks=[];
  const g=Object.assign({auth:{currentUser:{uid:'u1'}},
    localStorage:{getItem:k=>(Object.prototype.hasOwnProperty.call(ls,k)?ls[k]:null),setItem(k,v){ls[k]=String(v);},removeItem(k){delete ls[k];}}},fx.g);
  if(cache&&!o.noCache)g.siCache=cache.api;
  if(o.perf!==false)g.performance={mark:n=>{marks.push(n);},measure(){},now:()=>ck.t,getEntriesByName:()=>[]};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',globals:g});
  const ctx=a.ctx;
  ctx.navigator={onLine:o.online!==false};
  ctx.setTimeout=ck.setTimeout;ctx.clearTimeout=ck.clear;ctx.setInterval=ck.setInterval;ctx.clearInterval=ck.clear;
  ctx.window.showPage=function(id){ctx.currentPage=id;};
  ck.win=ctx.window;
  vm.runInContext(src,ctx,{filename:'shopify.js'});
  ck.sync();
  a.run('_siNow=function(){return window.__t}');
  a.run('_siRand=function(){return 0.5}');
  const raw=a.run;a.run=c=>{try{return raw(c);}catch(e){a.lastErr=e;return undefined;}}; // a name the build does not have yet makes the CHECK fail, not the suite
  a.ls=ls;a.marks=marks;a.ck=ck;
  return a;
}
// spy on an element's innerHTML writes (the harness node keeps a plain property)
function spy(a,id){
  const n=a.ctx.document.getElementById(id);let html=String(n.innerHTML||'');const rec={writes:[],get html(){return html;}};
  Object.defineProperty(n,'innerHTML',{configurable:true,get:()=>html,set:v=>{html=String(v);rec.writes.push(html);}});
  return rec;
}
// what showPage('shopify-intel') does: skeleton, then loadShopifyData, then render once it resolves
function openPage(a){
  const m=spy(a,'main-content'),fr=spy(a,'si-fr'),co=spy(a,'si-content'),rec={m,fr,co,resolved:false,rendered:false,resolvedAt:null,err:null};
  a.ctx.document.getElementById('main-content').innerHTML=a.run('_siLoadingSkeleton()');
  const p=Promise.resolve(a.run('loadShopifyData()'));
  rec.p=p.then(()=>{rec.resolved=true;rec.resolvedAt=a.ck.t;
    if(a.ctx.currentPage==='shopify-intel'){try{a.ctx.document.getElementById('main-content').innerHTML=a.run('renderShopifyDashboard()');rec.rendered=true;}catch(e){rec.err=e;}}},e=>{rec.err=e;});
  return rec;
}
const text=h=>String(h||'').replace(/<[^>]*>/g,' ').replace(/&#39;|&rsquo;|&apos;/g,"'").replace(/\s+/g,' ');

function a_err(v){return v.a.lastErr&&v.a.lastErr.message;}
async function checks(src){
  const o={};const v0={};
  const probe=sandbox(src,fakeFs('2000-01-01'),null,clock(0));
  const T=probe.run('_siPktDate(0)');
  const B00=Math.floor((Date.now()+5*H)/(24*H))*24*H-5*H;
  const world={ck:null};
  const stamps=()=>({catalog_sync:B00-5*H,order_sync:B00-5*H,order_refresh:B00-5*H,inventory_sync:B00-5*H});
  // a cold visit at B00+1h fills the device copy; withOld=true also reads and saves the older line items (phase 2, key lines-old)
  const prime=async(withOld)=>{
    const fx=fakeFs(T,{stamps:stamps()}),ck=clock(B00+1*H);world.ck=ck;
    const cache=fakeCache(()=>world.ck.t);
    const a=sandbox(src,fx,cache,ck);
    const rec=openPage(a);await ck.advance(0);await ck.advance(0);await rec.p;
    if(withOld){a.run('_siFullStart(true)');await ck.advance(0);await ck.advance(0);}
    await a.run('window._siCacheFlush()');await ck.advance(0);await ck.advance(0);
    return{fx,cache,a,ck,loaded:a.run('_siLoaded')};
  };
  // a later visit at B00+2h: a NEW sandbox on the same Firestore and the same cache, the counters reset, holds installed by `setup`
  const visit=async(base,t1,setup,ov)=>{
    base.fx.reset();
    const ck=clock(t1);world.ck=ck;
    base.fx.holdPrev=null;base.fx.holdBackfill=null;base.fx.gate={};base.cache.hold={};
    const a=sandbox(src,base.fx,base.cache,ck,ov);
    if(setup)setup({fx:base.fx,cache:base.cache,ck,a});
    return{a,ck,fx:base.fx,cache:base.cache,R:c=>{try{return a.run(c);}catch(e){return undefined;}}};
  };

  // ── the primes ──
  const P=await prime(true),P0=await prime(false);
  o['setup: the cold primes loaded and saved a copy (products, orders, lines, closes, snap; lines-old only on the first)']=P.loaded===true&&P0.loaded===true
    &&['products','orders','lines','closes','snap'].every(k=>P.cache.m.has(k))&&P.cache.m.has('lines-old')&&!P0.cache.m.has('lines-old');

  // ═══ (a) a warm visit whose META read never resolves ═══
  {
    const v=await visit(P,B00+2*H,x=>{x.fx.holdPrev=never();x.fx.holdBackfill=never();});
    const rec=openPage(v.a);
    await v.ck.advance(100);
    const R=v.R;
    o['a: with the meta reads never answering, loadShopifyData still RESOLVES (within 100 ms of fake time)']=rec.resolved===true&&rec.err==null;
    o['a: the page rendered and _siLoaded is true']=rec.rendered===true&&R('_siLoaded')===true&&R('_siLoadError')===null;
    o['a: the figures are present (2 products, 202 line items, the snapshot of today) while meta is still pending']=R('_siProducts.length')===2&&R('_siLineItems.length')===202&&R('_siSnapshot&&_siSnapshot.date')===T;
    o['a: no big collection was read (nothing moved), and today\'s snapshot document was not read (hydrate satisfied it)']=v.fx.big()===NONE&&v.fx.count(v.fx.snapIds,T)===0;
    const html=R('renderShopifyDashboard()'),tx=text(html);
    o['a: the dashboard shows the hydrated figures: Units On Hand 8 (5 + 3 from the snapshot) and the SKU table has both SKUs']=/Units On Hand 8/.test(tx)&&R('_siComputeSkuTable().length')===2;
    o['a: what needs meta is pending, not wrong: the meta side read is "loading", the week-ago figure of every SKU is unknown (null, shown "—"), never 0, and Data checks says the sync status is still loading']=
      R('_siMetaSide')==='loading'&&R('_siPrevSnapshot')===null&&R('_siComputeSkuTable().every(r=>r.prevOnHand===null)')===true;
    o['a: with no sync status at all yet (side read loading, nothing else supplied it), Data checks says "still loading" and does NOT claim the order sync status is unavailable']=(function(){
      v.a.run('_siSyncMeta={};_siMetaSide="loading"');const t=text(R('_siNaTrustHtml(_siNaTrust())'));
      return /Sync status is still loading/.test(t)&&!/Order sync status is not available/.test(t);})();
    o['a: ... and once that read has ended with still nothing, the plain "not available" note takes over']=(function(){
      v.a.run('_siMetaSide="done"');const t=text(R('_siNaTrustHtml(_siNaTrust())'));
      v.a.run('_siMetaSide="loading"');return !/Sync status is still loading/.test(t)&&/Order sync status is not available/.test(t);})();
    const mw=rec.m.writes.length,frw=rec.fr.writes.length,cow=rec.co.writes.length;
    // now the meta reads land
    v.fx.holdPrev=null;v.fx.holdBackfill=null;
    await v.ck.advance(0);
    o['a (held forever): the side read is still "loading", the page is still loaded, and no wholesale rewrite of the dashboard happened meanwhile']=rec.m.writes.length===mw&&R('_siLoaded')===true&&R('_siMetaSide')==='loading';
  }
  {
    // the same, with a hold we can RELEASE (so meta lands after the first render)
    let relPrev,relBack;
    const v=await visit(P,B00+2*H,x=>{x.fx.holdPrev=new Promise(r=>{relPrev=r;});x.fx.holdBackfill=new Promise(r=>{relBack=r;});});
    const rec=openPage(v.a),R=v.R;
    await v.ck.advance(100);
    const mw=rec.m.writes.length,frw=rec.fr.writes.length,cow=rec.co.writes.length;
    o['a: before meta lands: first render is done (main-content written once for the skeleton and once for the dashboard)']=rec.rendered===true&&mw===2;
    relPrev();relBack();
    await v.ck.advance(50);
    o['a: when meta lands, the previous-week snapshot is loaded (date a week ago, 2 SKUs) and the sync meta is filled in']=R('_siPrevSnapshot&&_siPrevSnapshot.date')===dayShift(T,7)&&R('Object.keys(_siPrevSnapshot.items).length')===2&&R('!!(_siSyncMeta&&_siSyncMeta.catalog&&_siSyncMeta.inventory)')===true;
    o['a: the dashboard (main-content) was NOT rewritten wholesale when meta landed - a sentinel node inside it survives']=rec.m.writes.length===mw;
    o['a: a TARGETED repaint happened instead (the freshness strip or the content region was rewritten)']=(rec.fr.writes.length+rec.co.writes.length)>(frw+cow);
    o['a: the counts are right once meta lands: the week\'s stock movement of AA-S is 5 - 9 = -4 and of AA-M is 3 - 4 = -1']=
      R('(_siComputeSkuTable().find(r=>r.sku==="AA-S")||{}).prevOnHand')===9&&R('(_siComputeSkuTable().find(r=>r.sku==="AA-M")||{}).prevOnHand')===4;
    o['a: the meta stage is done, the side read is no longer loading, and the "still loading" note is gone']=R('_siLoad.state.meta')==='done'&&R('_siMetaSide')==='done'&&!/Sync status is still loading/.test(text(R('_siNaTrustHtml(_siNaTrust())')));
    o['a: still no big collection read, and the page is not in an error state']=v.fx.big()===NONE&&R('_siLoadError')===null;
  }

  // ═══ (b) a meta read that FAILS later does not fail the page ═══
  {
    let rejPrev,rejBack;
    const v=await visit(P,B00+2*H,x=>{x.fx.holdPrev=new Promise((_,rej)=>{rejPrev=rej;});x.fx.holdBackfill=new Promise((_,rej)=>{rejBack=rej;});x.fx.holdPrev.catch(()=>{});x.fx.holdBackfill.catch(()=>{});});
    const rec=openPage(v.a),R=v.R;
    await v.ck.advance(100);
    const mw=rec.m.writes.length;
    rejPrev(new Error('network down'));rejBack(new Error('network down'));
    await v.ck.advance(50);
    const html=R('renderShopifyDashboard()');
    o['b: the meta reads failing after the render does not fail the page (loaded, no load error, no full-page error card)']=R('_siLoaded')===true&&R('_siLoadError')===null&&!/Could not load inventory data/.test(html)&&rec.m.writes.length===mw;
    o['b: the data is still there (2 products, 202 lines, today\'s snapshot) and no wrong number replaces the missing one (previous-week snapshot stays absent)']=R('_siProducts.length')===2&&R('_siLineItems.length')===202&&R('_siPrevSnapshot')===null;
    o['b: the failure is shown where it belongs: the side read has ended (not "loading" for ever), the week-ago figures stay unknown (null, "—"), and the "still loading" note is gone']=
      R('_siMetaSide')==='done'&&R('_siComputeSkuTable().every(r=>r.prevOnHand===null)')===true&&!/Sync status is still loading/.test(text(R('_siNaTrustHtml(_siNaTrust())')));
    o['b: it does not poison the critical stages: none of the five critical stages is marked failed']=R('["products","orders","lines","closes","snap"].every(id=>_siLoad.state[id]!=="failed")')===true;
  }

  // ═══ (c) the holds ═══
  {
    // a warm load that finishes in 200 ms of fake time
    const v=await visit(P,B00+2*H,x=>{x.cache.hold.products=new Promise(r=>x.ck.setTimeout(r,150));});
    const rec=openPage(v.a);
    await v.ck.advance(200);
    o['c: a warm load finishing in 200 ms resolves at once, it does not wait for 900 ms']=rec.resolved===true&&rec.resolvedAt<=B00+2*H+200&&v.R('_siLoaded')===true;
  }
  {
    // the card is on screen (shown at 300 ms) because the device copy answers slowly (400 ms); the load is done at ~400 ms: no 500 ms hold, no 400 ms settle
    const v=await visit(P,B00+2*H,x=>{['products','orders','lines','lines-old','closes','snap'].forEach(k=>{x.cache.hold[k]=new Promise(r=>x.ck.setTimeout(r,400));});});
    const rec=openPage(v.a);
    await v.ck.advance(420);
    const shown=v.R('_siLoad.shown');
    await v.ck.advance(40);
    o['c: warm, the card WAS shown (slow copy) and still the load resolves within ~60 ms of the data landing: the 500 ms hold and 400 ms settle are skipped']=shown===true&&rec.resolved===true&&rec.resolvedAt<=B00+2*H+460;
  }
  {
    // a fast cold load (no copy): card shown at 300 ms, reads done at 600 ms (< 1500 ms)
    const fx=fakeFs(T,{stamps:stamps()}),ck=clock(B00+2*H);world.ck=ck;
    const cache=fakeCache(()=>world.ck.t);
    let rel;fx.gate.shopify_products=new Promise(r=>{rel=r;});
    const a=sandbox(src,fx,cache,ck);
    const rec=openPage(a);
    await ck.advance(300);
    const shown=a.run('_siLoad.shown');
    await ck.advance(300);rel();
    await ck.advance(60);
    o['c: a fast cold load (reads done at ~600 ms, under the named threshold) with the card shown does not wait out the hold (resolved by 660 ms, not 1200)']=shown===true&&rec.resolved===true&&rec.resolvedAt<=B00+2*H+660;
    o['c: the named threshold exists as a constant of about 1.5 s']=(function(){const v=a.run('(typeof _SI_LOAD_FAST_MS!=="undefined"?_SI_LOAD_FAST_MS:(typeof _SI_LOAD_QUICK_MS!=="undefined"?_SI_LOAD_QUICK_MS:null))');return typeof v==='number'&&v>=1000&&v<=2000;})();
  }
  {
    // a genuinely slow cold load: reads released at 2000 ms; the card has been up for 1.7 s; the settle (400 ms) is still honoured
    const fx=fakeFs(T,{stamps:stamps()}),ck=clock(B00+2*H);world.ck=ck;
    const cache=fakeCache(()=>world.ck.t);
    let rel;fx.gate.shopify_products=new Promise(r=>{rel=r;});
    const a=sandbox(src,fx,cache,ck);
    const rec=openPage(a);
    await ck.advance(2000);rel();
    await ck.advance(100);
    const mid=rec.resolved;
    await ck.advance(400);
    o['c: a slow cold load (card up for 1.7 s) still honours the settle: not resolved 100 ms after the reads, resolved 500 ms after']=mid===false&&rec.resolved===true;
    o['c: ... and the card showed "Ready" (done) before leaving']=a.run('_siLoad.done')===true&&a.run('_siLoaded')===true;
  }

  // ═══ (d) hydrate order, the per-key cap, and the lazy older rows ═══
  {
    // orders, closes and lines-old never answer; snapshot, products, lines do
    const v=await visit(P,B00+2*H,x=>{x.cache.hold.orders=never();x.cache.hold.closes=never();x.cache.hold['lines-old']=never();});
    const rec=openPage(v.a),R=v.R;
    await v.ck.advance(100);
    o['d: the priority keys are applied AS THEY LAND (100 ms): products, the 90-day lines and the snapshot are in memory while orders/closes/lines-old are still pending']=
      R('_siProducts.length')===2&&R('_siLineItems.length')===202&&R('_siSnapshot&&_siSnapshot.date')===T&&rec.resolved===false;
    await v.ck.advance(1500);
    const dLoaded=R('_siLoaded');
    await v.ck.advance(600);
    o['d: the page still renders, bounded by the 1.5 s per-key cap: loaded at 1.6 s, and (a 1.6 s load is not quick) resolved after its 400 ms settle, by 2.2 s']=dLoaded===true&&rec.resolved===true&&rec.rendered===true;
    o['d: only what the copy did not give is read: orders 1 and closes 1 from Firestore, products 0, line items 0, no snapshot-of-today read']=v.fx.big()==='products:0,orders:1,line_items:0,weekly_closes:1'&&v.fx.count(v.fx.snapIds,T)===0;
  }
  {
    // lines-old never answers; everything else is instant: render is NOT held for it
    const v=await visit(P,B00+2*H,x=>{x.cache.hold['lines-old']=never();});
    const rec=openPage(v.a),R=v.R;
    await v.ck.advance(200);
    o['d: lines-old is NOT awaited before the first paint: with its get never answering, the page resolves within 200 ms (not after the 1.5 s cap)']=rec.resolved===true&&rec.rendered===true;
    o['d: and no Firestore read of the older line items was made for it at load (no "<" bound query)']=v.fx.older()===0;
    // opening a full-history section triggers it: the get never answers, the cap passes, the older rows are read once
    R('window._siSwitchTab("articles")');
    await v.ck.advance(2500);
    o['d: opening a full-history section (Articles) triggers the older rows: with the copy never answering, they are read from Firestore exactly once after the cap']=
      R('_siLinesScope')==='full'&&R('_siLineItems.length')===203&&v.fx.older()===1;
  }
  {
    // lines-old answers from the copy: the full-history section restores it with no Firestore read
    const v=await visit(P,B00+2*H);
    const rec=openPage(v.a),R=v.R;
    await v.ck.advance(200);
    const before=R('_siLinesScope');
    o['d: lines-old is not restored before the first paint (the scope is the 90-day window at first paint)']=rec.resolved===true&&before==='window'&&R('_siLineItems.length')===202;
    R('window._siSwitchTab("articles")');
    await v.ck.advance(300);
    o['d: a full-history section opening restores the older rows from the device copy: 203 lines, scope full, zero "<" reads of Firestore']=R('_siLinesScope')==='full'&&R('_siLineItems.length')===203&&v.fx.older()===0;
    o['d: the boundary rule is unchanged: a copy of the older rows read BEFORE the 00:00 PKT boundary is not trusted (read from Firestore instead)']=await(async()=>{
      const p2=await prime(true);
      // age the saved older rows to yesterday 23:00 PKT (before today's boundary), visit at 00:30 PKT today
      const rec2=p2.cache.m.get('lines-old');rec2.meta.readAt=B00-1*H;rec2.savedAt=B00-1*H;
      const v2=await visit(p2,B00+30*MIN);
      const r2=openPage(v2.a);await v2.ck.advance(200);
      v2.a.run('window._siSwitchTab("articles")');await v2.ck.advance(2500);
      return v2.fx.older()===1&&v2.a.run('_siLineItems.length')===203;
    })();
  }
  {
    // no lines-old saved at all: the first open of a full-history section reads once
    const v=await visit(P0,B00+2*H);
    const rec=openPage(v.a),R=v.R;
    await v.ck.advance(200);
    const before=v.fx.older();
    R('window._siSwitchTab("attention")');
    await v.ck.advance(2500);
    o['d: with no saved older rows, a full-history section (Needs Attention) reads them exactly once, and not before it opened']=before===0&&v.fx.older()===1&&R('_siLinesScope')==='full';
  }

  // ═══ (e) the load card state exists BEFORE the hydrate finishes ═══
  {
    const v=await visit(P,B00+2*H,x=>{['products','orders','lines','lines-old','closes','snap'].forEach(k=>{x.cache.hold[k]=never();});});
    const rec=openPage(v.a),R=v.R;
    await v.ck.advance(0);
    o['e: the load has BEGUN while every copy read is still pending (a load promise and a start time exist at 0 ms)']=R('!!_siLoad.promise')===true&&R('_siLoad.startedAt')>0&&R('_siCache.tried')===true;
    o['e: the card is on screen at 300 ms although the hydrate has not finished']=await(async()=>{await v.ck.advance(320);return v.R('_siLoad.shown');})()===true;
    await v.ck.advance(2100);
    o['e: the 1.5 s per-key cap still frees it: the page loads from Firestore (all four collections read in full) when no key ever answers']=rec.resolved===true&&v.fx.big()===FULL;
  }

  // ═══ (f) no double reads on a fully warm fixture with unmoved stamps ═══
  {
    const v=await visit(P,B00+2*H);
    const rec=openPage(v.a),R=v.R;
    await v.ck.advance(300);
    const fx=v.fx;
    o['f: ZERO big reads (no products, orders, line-item or closes query at all)']=fx.big()===NONE&&fx.lineQueries.length===0;
    o['f: the five sync-meta stamps of the freshness check WERE read (catalog_sync, order_sync, order_refresh, order_refresh_now, inventory_sync)']=
      ['catalog_sync','order_sync','order_refresh','order_refresh_now','inventory_sync'].every(id=>fx.count(fx.metaIds,id)>=1);
    o['f: no sync-meta doc is read more than twice (once for the meta stage at most, once for the freshness check); order_backfill exactly once']=
      Object.keys(fx.metaIds.reduce((m,x)=>{m[x]=(m[x]||0)+1;return m;},{})).every(id=>fx.count(fx.metaIds,id)<=2)&&fx.count(fx.metaIds,'order_backfill')===1;
    o['f: nothing hydrate satisfied is read again: today\'s snapshot doc 0 reads, the week-ago snapshot exactly 1']=fx.count(fx.snapIds,T)===0&&fx.count(fx.snapIds,fx.T7)===1;
    o['f: the device copy was read for the priority keys, and the page is loaded from it with the data of the cold visit']=['get:products','get:lines','get:snap'].every(k=>P.cache.log.indexOf(k)>=0)&&R('_siLoaded')===true&&R('_siLineItems.length')===202;
    o['f: the copy is confirmed by the check (nothing new)']=R('_siCache.pending')===false&&/nothing new/.test(R('_siFrView(_siNow()).status'));
  }

  // ═══ (g) the marks ═══
  {
    const v=await visit(P,B00+2*H,x=>{
      ['products','lines','snap'].forEach(k=>{x.cache.hold[k]=new Promise(r=>x.ck.setTimeout(r,40));});
      x.cache.hold.closes=new Promise(r=>x.ck.setTimeout(r,120));
      x.fx.holdPrev=new Promise(r=>x.ck.setTimeout(r,700));
    });
    const rec=openPage(v.a),R=v.R;
    await v.ck.advance(2000);
    const mk=R('window._siLoadMarks()')||{},mm=mk.marks||{},dd=mk.durations||{};
    o['g: _siLoadMarks() returns {marks,durations}: every mark a non-negative number of ms since the load began, durations hydrate / toCritical / toBuild / toMeta / toRender']=
      !!mk.marks&&!!mk.durations&&Object.keys(mm).every(k=>typeof mm[k]==='number'&&mm[k]>=0)&&['hydrate','toCritical','toBuild','toMeta','toRender'].every(k=>typeof dd[k]==='number'&&dd[k]>=0);
    o['g: the marks are the seven named ones, each recorded once: begin 0 ms, hydrate-start 0 ms']=
      ['begin','hydrate-start','hydrate-end','critical-done','meta-done','build-done','render'].every(k=>k in mm)&&mm.begin===0&&mm['hydrate-start']===0;
    o['g: durations come from the fake clock: the device copy took 120 ms (the slowest hand-set hold: closes), the sync status 700 ms (hand-set hold), within 1 ms']=
      Math.abs(dd.hydrate-120)<=1&&Math.abs(dd.toMeta-700)<=1;
    o['g: the first render came BEFORE sync status finished: toRender is ~120 ms (after the hydrate) and well under the 700 ms toMeta']=
      dd.toRender>=120&&dd.toRender<400&&dd.toRender<dd.toMeta;
    o['g: critical-done is not later than the render, and the stock count (build) is between them']=dd.toCritical<=dd.toRender&&dd.toBuild>=dd.toCritical&&dd.toBuild<=dd.toRender;
    o['g: performance.mark was called (guarded) once per mark, as si:<name>']=
      v.a.marks.length===7&&['si:begin','si:hydrate-start','si:hydrate-end','si:critical-done','si:meta-done','si:build-done','si:render'].every(n=>v.a.marks.indexOf(n)>=0);
    o['g: _siLoadMarks() is pure: two calls give the same answer and no Firestore read or timer is added']=(function(){const n=v.fx.all,t=v.ck.timers.length,a1=J(R('window._siLoadMarks()')),a2=J(R('window._siLoadMarks()'));return a1===a2&&v.fx.all===n&&v.ck.timers.length===t;})();
    const offTx=text(R('_siNaTrustHtml(_siNaTrust())'));
    o['g: without the localStorage flag the timings are NOT shown in Data checks']=!/Load timing/.test(offTx)&&!/id="si-marks"/.test(R('_siNaTrustHtml(_siNaTrust())'));
    const w=await visit(P,B00+2*H,null,{ls:{'groovy-si-debug':'1'}});
    const rec2=openPage(w.a);await w.ck.advance(1000);
    const onHtml=w.a.run('_siNaTrustHtml(_siNaTrust())'),onTx=text(onHtml);
    o['g: with localStorage groovy-si-debug=1 the timings appear in Data checks ("Load timing" line, device copy / critical / counting / sync status / first render, in ms)']=
      /id="si-marks"/.test(onHtml)&&/Load timing/.test(onTx)&&/device copy read \d+ ms/.test(onTx)&&/first render at \d+ ms/.test(onTx);
    const x=await visit(P,B00+2*H,null,{ls:{'groovy-si-debug':'0'}});
    const rec3=openPage(x.a);await x.ck.advance(1000);
    o['g: any other flag value (0) shows nothing']=!/id="si-marks"/.test(x.a.run('_siNaTrustHtml(_siNaTrust())'));
    // no performance object at all: nothing throws
    const y=await visit(P,B00+2*H,null,{perf:false});
    const rec4=openPage(y.a);await y.ck.advance(1000);
    o['g: with no performance object in the browser nothing throws and the page loads (marks are guarded)']=rec4.resolved===true&&rec4.err==null&&y.a.run('_siLoaded')===true&&typeof (y.a.run('window._siLoadMarks()')||{}).marks==='object';
  }

  // ═══ (h) the existing guarantees ═══
  {
    // offline start on a saved copy: no Firestore read at all, the page shows the copy with the offline note, meta not read either
    const v=await visit(P,B00+2*H,null,{online:false});
    const rec=openPage(v.a),R=v.R;
    await v.ck.advance(300);
    const tx=text(R('renderShopifyDashboard()'));
    o['h: offline start is unaffected: loaded from the copy, ZERO Firestore reads of any kind (meta included), the offline note is on screen']=R('_siLoaded')===true&&v.fx.all===0&&/offline/i.test(tx)&&R('_siLineItems.length')===202;
  }
  {
    // no siCache at all: the same reads as before the feature (cold: 4 collections, 6 date ranges), and the meta stage still runs once
    const fx=fakeFs(T,{stamps:stamps()}),ck=clock(B00+2*H);world.ck=ck;
    const a=sandbox(src,fx,null,ck,{noCache:true});
    const rec=openPage(a);
    await ck.advance(0);await ck.advance(0);await rec.p;
    await ck.advance(60);
    o['h: siCache undefined: the cold reads are exactly today\'s (products 1, orders 1, 6 line-item date ranges, closes 1), loaded, no cache call']=a.run('_siLoaded')===true&&fx.big()===FULL&&fx.lineQueries.length===6&&fx.rows.shopify_line_items===202;
    o['h: siCache undefined: the meta stage still reads its documents (week-ago snapshot once, order_backfill once) and fills the page in']=
      fx.count(fx.snapIds,fx.T7)===1&&fx.count(fx.metaIds,'order_backfill')===1&&a.run('_siPrevSnapshot&&_siPrevSnapshot.date')===fx.T7;
  }
  {
    // leaving the page clears every timer, including with a meta read still pending
    const v=await visit(P,B00+2*H,x=>{x.fx.holdPrev=never();x.fx.holdBackfill=never();});
    const rec=openPage(v.a),R=v.R;
    await v.ck.advance(300);
    await v.a.run('window._siCacheFlush()');await v.ck.advance(0);
    R('window.showPage("creative-hub")');
    await v.ck.advance(0);
    const left=v.ck.timers.map(t=>({every:t.every||0,in:t.at-v.ck.t}));
    if(process.env.WS_TRACE)console.error('LEFT',J(left));
    const n=v.fx.all;
    o['h: leaving the page (meta still pending): no interval is left running, and the only timers left are one-shot caps of the pending sync-status reads (each due within 10 s)']=left.every(t=>!t.every&&t.in<=10000);
    await v.ck.advance(11000);
    o['h: ... and 11 s later no timer remains and nothing was read after leaving']=v.ck.timers.length===0&&v.fx.all===n;
  }
  {
    // leaving while the load card is showing and the hydrate is pending: no timer left
    const v=await visit(P,B00+2*H,x=>{['products','orders','lines','lines-old','closes','snap'].forEach(k=>{x.cache.hold[k]=never();});});
    const rec=openPage(v.a);
    await v.ck.advance(350);
    v.a.run('window.showPage("creative-hub")');
    await v.ck.advance(0);
    await v.ck.advance(2000);
    await v.ck.advance(61000); // the freshness interval, if one was started after the page was left, clears itself at its first tick
    if(process.env.WS_TRACE)console.error('left',v.ck.timers.map(t=>t.at-v.ck.t+(t.every?'e'+t.every:'')+':'+String(t.fn).slice(0,60).replace(/\s+/g,' ')));
    o['h: leaving while the card shows and the hydrate is pending: no timer or interval is left running a minute later']=v.ck.timers.filter(t=>true).length===0;
  }
  {
    // sign-out guard: a save that was waiting when the sign-out started is refused (nothing re-creates a record after siCache.clear())
    const putsOf=c=>c.log.filter(x=>x==='put:products').length;
    const run=async(signOut,mv)=>{
      const v=await visit(P0,B00+2*H,x=>{x.fx.stamps.catalog_sync=B00+mv*MIN;let rel;x.fx.gate.shopify_products=new Promise(r=>{rel=r;});v0.rel=rel;});
      const before=putsOf(v.cache);
      openPage(v.a);
      await v.ck.advance(200);
      if(signOut)v.a.ctx.window.__gvSignOutStarted=true;
      v0.rel();
      await v.ck.advance(300);
      await v.a.run('window._siCacheFlush()');await v.ck.advance(0);
      const r={read:v.fx.big(),puts:putsOf(v.cache)-before};
      return r;
    };
    const ctl=await run(false,90),out=await run(true,100);
    if(process.env.WS_TRACE)console.error('signout',JSON.stringify(ctl),JSON.stringify(out));
    o['h: the sign-out guard holds: with a moved stamp the catalog is re-read and SAVED (control: 1 put), but once the sign-out has started it is read and NOT saved (0 puts)']=ctl.read==='products:1,orders:0,line_items:0,weekly_closes:0'&&ctl.puts===1&&out.read===ctl.read&&out.puts===0;
  }
  return o;
}
const J=JSON.stringify;

module.exports=async function(){
  const s=suite('shopify-warmstart');
  s.section('warm-start: meta off the critical path, holds, hydrate order, marks (fake siCache, counted Firestore reads, fake clock)');
  const base=await checks(SRC);
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks - each must fail the named check');
  const names=Object.keys(base);
  const brk=async(label,pairs,failing)=>{
    let t=SRC;
    for(const pr of pairs){if(t.indexOf(pr[0])<0){s.ok('break target exists: '+label,false);return;}t=t.replace(pr[0],pr[1]);}
    let r;try{r=await checks(t);}catch(e){r=null;}
    const failed=names.filter(k=>!r||r[k]!==true);
    const hit=failing.filter(f=>failed.some(k=>k.indexOf(f)===0));
    s.ok('break "'+label+'" fails "'+failing.join('" and "')+'"',hit.length===failing.length,hit.length===failing.length?undefined:'failed: '+failed.slice(0,4).join(' | '));
  };
  await brk('the sync-status stage holds the settle again',[["if(_SI_STAGES.some(s=>s.id!=='meta'&&st(s.id)==='active'))return;","if(_SI_STAGES.some(s=>st(s.id)==='active'))return;"]],['a: with the meta reads never answering','a: the page rendered','b: the meta reads failing after the render']);
  await brk('the load card begins only after the hydrate',[["  siLoadBegin(); // the loading card and the stall watch exist from the first millisecond, BEFORE the device copy is read\n","  if(!_siCacheOn())siLoadBegin();\n"],["  _siOffStart(); // offline: show the saved copy","  if(_siCacheOn())siLoadBegin();\n  _siOffStart(); // offline: show the saved copy"]],['e: the load has BEGUN','e: the card is on screen at 300 ms']);
  await brk('the minimum hold and settle are always kept',[["if(!L.shown||quick){finish();return;}","if(!L.shown){finish();return;}"]],['c: warm, the card WAS shown','c: a fast cold load']);
  await brk('every load counts as quick (the settle is never kept)',[["const quick=L.warm||(_siNow()-L.startedAt)<_SI_LOAD_QUICK_MS;","const quick=true;"]],['c: a slow cold load (card up for 1.7 s) still honours the settle']);
  await brk('lines-old is read with the first keys',[[":['snap','products','lines','closes','orders'];",":['snap','products','lines','lines-old','closes','orders'];"]],['d: lines-old is NOT awaited before the first paint']);
  await brk('a hydrated catalog is read again',[["  return!_siHave(id);\n}","  return id==='products'?true:!_siHave(id);\n}"]],['f: ZERO big reads','a: no big collection was read']);
  await brk('the meta landing rewrites the whole dashboard',[["    _siFrPaint();\n    if(prevChanged||_siSection==='attention')_siFrApply(false);","    {const m=document.getElementById('main-content');if(m)m.innerHTML=renderShopifyDashboard();}"]],['a: the dashboard (main-content) was NOT rewritten wholesale','a: a TARGETED repaint happened instead']);
  await brk('an unknown week-ago figure reads 0',[["noSnap||!(_siPrevSnapshot&&_siPrevSnapshot.items)?null:(prevInvMap[sku]||0)","noSnap?null:(prevInvMap[sku]||0)"]],['a: what needs meta is pending, not wrong','b: the failure is shown where it belongs']);
  await brk('the older rows are not offered from the device copy',[["_siCache.oldTry=!off&&ctx.used.indexOf('lines')>=0&&_siLinesScope==='window';","_siCache.oldTry=false;"]],['d: a full-history section opening restores the older rows from the device copy']);
  await brk('performance.mark is never called',[["performance.mark('si:'+name)","0"]],['g: performance.mark was called']);
  await brk('the debug flag is ignored (always on)',[["localStorage.getItem('groovy-si-debug')==='1'","true"]],['g: without the localStorage flag','g: any other flag value (0) shows nothing']);
  await brk('the quick threshold is zero',[["_SI_LOAD_QUICK_MS=1500,","_SI_LOAD_QUICK_MS=0,"]],['c: a fast cold load']);
  await brk('the per-key hydrate cap is gone',[["setTimeout(()=>fin(null),ms||_SI_CACHE_GET_MS)","setTimeout(()=>fin(null),ms||9e9)"]],['d: the page still renders, bounded by the 1.5 s per-key cap','e: the 1.5 s per-key cap still frees it']);
  return s;
};

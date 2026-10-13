/* Inventory Intel, offline mode for the device copy (js/shopify.js "The device copy"). Online, a saved copy older than 24 h is NOT trusted as
   fresh (unchanged). Offline (navigator.onLine===false) the page opens from the saved copy up to 7 DAYS old, never deletes it, makes NO Firestore
   read, says so in a persistent note and never calls the figures fresh. Coming back online runs the normal check and, for a copy older than 24 h,
   forces full reads. Drives the REAL loadShopifyData against a FAKE siCache (uid-aware Map with savedAt, JSON-cloned like structured clone), a fake
   Firestore that COUNTS EVERY call (getDocs and getDoc, every collection, the sync-meta docs and the PO/ignore/history reads included) and a fake
   clock (_siNow). Time is anchored to the real PKT day like tests/shopify-cache.test.js: B00 = today's 00:00 PKT, the cold visit is at B00+1h.
   Hand-computed ages (cold visit at t0 = B00+1h): 23 h, 25 h, 3 h, 165.6 h (6.9 d), 170.4 h (7.1 d). Fixture: 2 products, 1 cancelled order,
   202 window line items, 1 weekly close, a snapshot; a full online read = products:1,orders:1,line_items:6 (date ranges),weekly_closes:1.
   Each "break" mutates the source in a string and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const H=3600000,MIN=60000,DAY=24*H;
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
const waitIdle=async()=>{await flush();await new Promise(r=>setTimeout(r,30));await flush();};
const dayShift=(T,k)=>new Date(new Date(T+'T00:00:00Z').getTime()-k*86400000).toISOString().slice(0,10);
const ts=ms=>({seconds:Math.floor(ms/1000)});
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const BIG=['shopify_products','shopify_orders','shopify_line_items','shopify_weekly_closes'];
const FULL='products:1,orders:1,line_items:6,weekly_closes:1',NONE='products:0,orders:0,line_items:0,weekly_closes:0';
// independent PKT formatting ("12 Oct 01:00 PKT"): the expected text is computed here, not read from the page
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pkt=ms=>{const d=new Date(ms+5*H),p=n=>(n<10?'0':'')+n;return d.getUTCDate()+' '+MON[d.getUTCMonth()]+' '+p(d.getUTCHours())+':'+p(d.getUTCMinutes())+' PKT';};
const withTimeout=(p,ms)=>Promise.race([p.then(()=>'done'),new Promise(r=>setTimeout(()=>r('HUNG'),ms))]);

/* ── a fake Firestore that counts EVERY call ── */
function fakeFs(T,o){
  o=o||{};
  const st={calls:{},rows:{},lineQueries:[],all:0,metaGets:0,snapGets:0,fail:{},failMeta:null,
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
  st.orders=[{order_id:1,created_at:D(1),total_price:200},{order_id:2,created_at:D(30),total_price:300},{order_id:3,created_at:D(40),total_price:50,cancelled_at:'2026-09-01T00:00:00Z'}];
  st.closes=[{week_ending:dayShift(T,7),revenue:1000}];
  st.snap={date:T,snapshot_at:new Date().toISOString(),items:{a:{sku:'AA-S',variant_id:'v1',available:5},b:{sku:'AA-M',variant_id:'v2',available:3}}};
  const bump=(c,n)=>{st.calls[c]=(st.calls[c]||0)+1;st.rows[c]=(st.rows[c]||0)+n;};
  st.big=()=>BIG.map(n=>n.replace('shopify_','')+':'+(st.calls[n]||0)).join(',');
  st.reset=()=>{st.calls={};st.rows={};st.lineQueries=[];st.metaGets=0;st.snapGets=0;st.all=0;};
  st.g={
    collection:(db,name)=>({__c:name,cons:[]}),
    query:(c,...cons)=>({__c:c.__c,cons}),
    where:(f,op,v)=>({t:'where',f,op,v}),orderBy:(f,d)=>({t:'ob',f,d}),limit:n=>({t:'lim',n}),
    doc:(db,c,id)=>({c,id}),
    getDoc:async r=>{
      st.all++;
      if(r.c==='shopify_inventory_snapshots'){st.snapGets++;if(st.failSnap)throw st.failSnap;if(r.id===T)return{exists:()=>true,data:()=>clone(st.snap)};return{exists:()=>false};}
      if(r.c==='shopify_sync_meta'){
        st.metaGets++;
        if(st.failMeta)throw st.failMeta;
        const v=st.stamps[r.id];
        return{exists:()=>v!=null,data:()=>({last_success_at:ts(v),last_status:'success'})};
      }
      return{exists:()=>false};
    },
    getDocs:async q=>{
      st.all++;
      const name=q.__c;
      if(st.fail[name])throw st.fail[name];
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
/* ── a fake siCache: uid-aware like the real one ({value,savedAt,meta,uid}), cloned both ways, with counters ── */
function fakeCache(now,uidOf){
  const c={m:new Map(),log:[],mode:{},n:{put:0,get:0,del:0,clear:0}};
  c.api={
    available:()=>true,
    get:async k=>{c.n.get++;c.log.push('get:'+k);if(c.mode.getNever)return new Promise(()=>{});const r=c.m.get(k);return r&&r.uid===uidOf()?clone(r):null;},
    put:async(k,v,meta)=>{c.n.put++;c.log.push('put:'+k);c.m.set(k,{value:clone(v),savedAt:now(),meta:clone(meta),uid:uidOf()});return true;},
    del:async k=>{c.n.del++;c.log.push('del:'+k);c.m.delete(k);return true;},
    clear:async()=>{c.n.clear++;c.log.push('clear');c.m.clear();return true;},
    bytesApprox:async()=>1234567,lastError:''
  };
  return c;
}
/* ── one page load (a fresh sandbox, as a new tab would be); timers are TRACKED so "nothing left running" is a count ── */
function app(src,fx,cache,clk,o){
  o=o||{};
  const uid=o.uid||'u1';
  const g=Object.assign({auth:{currentUser:{uid}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}}},fx.g);
  if(cache&&!o.noCache)g.siCache=cache.api;
  const a=harness.loadApp({files:[],session:{uid,u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',globals:g});
  const ctx=a.ctx;
  ctx.navigator={onLine:o.online!==false};
  const tr={timeouts:new Map(),intervals:new Map(),seq:1000};
  ctx.setTimeout=(fn,ms)=>{const id=++tr.seq;tr.timeouts.set(id,ms||0);const t=setTimeout(()=>{if(tr.timeouts.has(id)){tr.timeouts.delete(id);fn();}},ms||0);if(t&&t.unref)t.unref();return id;};
  ctx.clearTimeout=id=>{tr.timeouts.delete(id);};
  ctx.setInterval=(fn,ms)=>{const id=++tr.seq;tr.intervals.set(id,ms||0);return id;}; // never fires: only counted
  ctx.clearInterval=id=>{tr.intervals.delete(id);};
  a.tr=tr;
  ctx.window.showPage=function(id){ctx.currentPage=id;};
  vm.runInContext(src,ctx,{filename:'shopify.js'});
  ctx.window.__t=clk.t;
  a.run('_siNow=function(){return window.__t}');
  a.set=t=>{clk.t=t;ctx.window.__t=t;};
  a.online=v=>{ctx.navigator.onLine=v;};
  return a;
}
// everything the page can say: the dashboard HTML, the strip, the loader host and the main-content element
function say(a){
  let s='';
  try{s+=a.run('renderShopifyDashboard()');}catch(_){}
  try{const e=a.el&&a.el('main-content');if(e&&e.innerHTML)s+=' '+e.innerHTML;}catch(_){}
  return s.replace(/<[^>]*>/g,' ').replace(/&#39;|&rsquo;|&apos;/g,"'").replace(/\s+/g,' ');
}
const OFFNOTE=/You[’']re offline — showing the copy saved on ([^(]*?) \((\d+) days? old\)\. Figures may be out of date\./;

async function checks(src){
  const o={};
  const probe=app(src,fakeFs('2000-01-01'),null,{t:0});
  const T=probe.run('_siPktDate(0)');
  const B00=Math.floor((Date.now()+5*H)/DAY)*DAY-5*H;
  const stampsOld={catalog_sync:B00-5*H,order_sync:B00-5*H,order_refresh:B00-5*H,inventory_sync:B00-5*H};
  const T0=B00+1*H;
  // a cold ONLINE visit at T0: the page saves every record
  const cold=async()=>{
    const fx=fakeFs(T,{stamps:stampsOld}),clk={t:T0},uidBox={u:'u1'},cache=fakeCache(()=>clk.t,()=>uidBox.u);
    const a=app(src,fx,cache,clk);
    await a.run('loadShopifyData()');await waitIdle();await a.run('window._siCacheFlush()');await waitIdle();
    return{fx,clk,cache,a,uidBox};
  };
  // a later visit: a new sandbox, the same Firestore and the same cache, a new time and an online flag; the counters are reset first
  const warm=async(base,ageMs,wo)=>{
    wo=wo||{};
    base.fx.reset();base.cache.n={put:0,get:0,del:0,clear:0};base.cache.log=[];
    if(wo.mod)wo.mod(base);
    base.clk.t=T0+ageMs;base.uidBox.u=wo.uid||'u1';
    const a=app(wo.src||src,base.fx,base.cache,base.clk,{online:wo.online,uid:wo.uid,noCache:wo.noCache});
    const r=await withTimeout(Promise.resolve(a.run('loadShopifyData()')),wo.limit||6000);
    await waitIdle();
    if(!wo.noFlush){await a.run('window._siCacheFlush()');await waitIdle();}
    return{a,R:c=>a.run(c),hung:r==='HUNG',say:()=>say(a)};
  };
  const nPut=b=>b.cache.n.put,nDel=b=>b.cache.n.del;
  const intact=b=>['products','orders','lines','closes','snap'].every(k=>b.cache.m.has(k));

  const c0=await cold();
  o['cold: baseline - 4 big collections once each, 6 date-range line queries, all five records saved']=c0.fx.big()===FULL&&c0.fx.lineQueries.length===6&&intact(c0)&&c0.a.run('_siLoaded')===true;

  // ── ONLINE: unchanged ──
  {
    const c=await cold();
    const w=await warm(c,23*H);
    const s=w.say();
    o['online, copy 23 h old: used as today - loaded from the copy, ZERO big reads, the copy list shows it was taken']=w.R('_siLoaded')===true&&c.fx.big()===NONE&&w.R('_siCache.used.length')>=4&&w.R('_siProducts.length')===2&&w.R('_siLineItems.length')===202;
    o['online, copy 23 h old: no offline note is shown']=!/You[’']re offline/.test(s)&&!OFFNOTE.test(s);
  }
  {
    const c=await cold();const oldSaved=c.cache.m.get('products').savedAt;
    const w=await warm(c,25*H);
    const s=w.say();
    o['online, copy 25 h old, network works: NOT trusted - all four collections read in full (the copy is a miss)']=c.fx.big()===FULL&&w.R('_siLoaded')===true&&w.R('_siCache.used.length')===0;
    o['online, copy 25 h old, network works: a NEW copy is saved (savedAt moved to now, the 25 h-old one is not what stays)']=c.cache.m.get('products').savedAt===T0+25*H&&c.cache.m.get('products').savedAt!==oldSaved&&c.cache.m.get('lines').savedAt===T0+25*H;
    o['online, copy 25 h old, network works: no offline note']=!/You[’']re offline/.test(s);
  }
  {
    // the network fails every read: the 25 h copy is the only thing there is, and every critical stage has one
    const c=await cold();
    const nets=()=>{const e=new Error('Failed to fetch');e.code='unavailable';BIG.forEach(n=>{c.fx.fail[n]=e;});c.fx.failMeta=e;c.fx.failSnap=e;};
    const w=await warm(c,25*H,{mod:nets,limit:20000});
    const s=w.say();
    o['online, copy 25 h old, every read fails with a network error: falls back to the copy - page loaded, 2 products and 202 line items from it']=!w.hung&&w.R('_siLoaded')===true&&w.R('_siProducts.length')===2&&w.R('_siLineItems.length')===202;
    o['online, copy 25 h old, network failure: the offline note names the save time and 1 day, and the copy was not written over']=OFFNOTE.test(s)&&(s.match(OFFNOTE)||[])[1]===pkt(T0)&&(s.match(OFFNOTE)||[])[2]==='1'&&nPut(c)===0&&intact(c);
  }

  // ── OFFLINE ──
  {
    const c=await cold();
    const w=await warm(c,25*H,{online:false});
    const s=w.say(),m=s.match(OFFNOTE)||[];
    o['offline, copy 25 h old: used - loaded, 2 products, 202 line items, 1 close and the snapshot, from the copy']=!w.hung&&w.R('_siLoaded')===true&&w.R('_siProducts.length')===2&&w.R('_siLineItems.length')===202&&w.R('_siWeeklyCloses.length')===1&&w.R('_siSnapshot&&_siSnapshot.date')===T;
    o['offline, copy 25 h old: ZERO Firestore reads of any kind (no collection, no sync-meta doc, no snapshot, no PO / ignore / history read)']=c.fx.all===0&&c.fx.big()===NONE&&c.fx.metaGets===0&&c.fx.snapGets===0;
    o['offline, copy 25 h old: the persistent note reads "You\'re offline — showing the copy saved on <PKT date time> (1 day old). Figures may be out of date."']=OFFNOTE.test(s)&&m[1]===pkt(T0)&&m[2]==='1';
    o['offline, copy 25 h old: the saved copy is NOT deleted and NOT written over (0 puts, 0 deletes, all five records still there with their old savedAt)']=nPut(c)===0&&nDel(c)===0&&c.cache.n.clear===0&&intact(c)&&c.cache.m.get('products').savedAt===T0;
    o['offline, copy 25 h old: nothing in the page, the strip or the note says "fresh"']=!/\bfresh\b/i.test(s)&&!/\bfresh\b/i.test(m[0]||'');
  }
  {
    const c=await cold();
    const w=await warm(c,165.6*H,{online:false}); // 6.9 days: 6 d 21 h 36 min
    const s=w.say(),m=s.match(OFFNOTE)||[];
    o['offline, copy 6.9 days old: still used - loaded from the copy with zero Firestore reads']=!w.hung&&w.R('_siLoaded')===true&&w.R('_siProducts.length')===2&&w.R('_siLineItems.length')===202&&c.fx.all===0;
    o['offline, copy 6.9 days old: the note carries the age in days (6 or 7 - rounding is the builder\'s call) and the save time']=OFFNOTE.test(s)&&(m[2]==='6'||m[2]==='7')&&m[1]===pkt(T0);
    o['offline, copy 6.9 days old: the copy is kept (0 deletes, 0 puts, all records present)']=nDel(c)===0&&nPut(c)===0&&intact(c);
  }
  {
    // 7.1 days = 170.4 h: past the limit even offline
    const c=await cold();
    const w=await warm(c,170.4*H,{online:false});
    const s=w.say();
    o['offline, copy 7.1 days old: a miss - nothing loaded, nothing taken from the copy']=!w.hung&&w.R('_siLoaded')===false&&w.R('_siProducts.length')===0&&w.R('_siLineItems.length')===0&&(w.R('_siCache.used.length')||0)===0;
    o['offline, copy 7.1 days old: zero Firestore reads, the honest "offline and nothing is saved on this device yet" state with a Retry, no offline note, no copy shown']=c.fx.all===0&&/offline and nothing is saved on this device yet/i.test(s)&&/Retry/.test(s)&&!OFFNOTE.test(s);
  }
  {
    // another shape (a record written under an older stored format) on every record
    const c=await cold();
    const w=await warm(c,25*H,{online:false,mod:b=>{b.cache.m.forEach(r=>{r.meta.shape='2026-01-01a';});}});
    const s=w.say();
    o['offline, shape mismatch on every record: a miss - not loaded, nothing taken, zero reads, honest nothing-saved state']=!w.hung&&w.R('_siLoaded')===false&&(w.R('_siCache.used.length')||0)===0&&c.fx.all===0&&/nothing is saved on this device yet/i.test(s);
  }
  {
    const c=await cold();
    const w=await warm(c,25*H,{online:false,mod:b=>{b.cache.m.forEach(r=>{r.meta.schema=99;});}});
    o['offline, schema mismatch on every record: a miss, zero reads']=!w.hung&&w.R('_siLoaded')===false&&c.fx.all===0&&/nothing is saved on this device yet/i.test(w.say());
  }
  {
    // saved 20 minutes "in the future" (a clock set back): beyond the 5 minute skew allowance
    const c=await cold();
    const w=await warm(c,25*H,{online:false,mod:b=>{b.cache.m.forEach(r=>{r.savedAt=T0+25*H+20*MIN;});}});
    o['offline, copy dated 20 minutes in the future (beyond the 5 minute skew): a miss, zero reads, nothing-saved state']=!w.hung&&w.R('_siLoaded')===false&&c.fx.all===0&&/nothing is saved on this device yet/i.test(w.say());
  }
  {
    const c=await cold();
    const w=await warm(c,25*H,{online:false,mod:b=>{b.cache.m.forEach(r=>{r.savedAt=T0+25*H+2*MIN;});}});
    o['offline, copy dated 2 minutes in the future (inside the 5 minute skew): still used']=!w.hung&&w.R('_siLoaded')===true&&w.R('_siProducts.length')===2&&c.fx.all===0;
  }
  {
    // another signed-in user opens the page on the same device
    const c=await cold();
    const w=await warm(c,25*H,{online:false,uid:'u2'});
    o['offline, the copy belongs to ANOTHER user: a miss - nothing of u1\'s is shown, zero reads, nothing-saved state, u1\'s records untouched']=!w.hung&&w.R('_siLoaded')===false&&w.R('_siProducts.length')===0&&c.fx.all===0&&/nothing is saved on this device yet/i.test(w.say())&&nDel(c)===0&&intact(c);
  }
  {
    // partial: no cancelled-orders list and no older line items
    const c=await cold();
    const w=await warm(c,25*H,{online:false,mod:b=>{b.cache.m.delete('orders');b.cache.m.delete('lines-old');}});
    const s=w.say();
    o['offline, no cancelled-orders record: the page still opens from the rest (products, lines, closes), zero reads']=!w.hung&&w.R('_siLoaded')===true&&w.R('_siProducts.length')===2&&w.R('_siLineItems.length')===202&&c.fx.all===0;
    o['offline, no cancelled-orders record: it SAYS "cancellations not applied" and still shows the offline note']=/cancellations not applied/i.test(s)&&OFFNOTE.test(s);
    o['offline, no lines-old record: the whole history is not claimed - scope stays the 90-day window and the full-history load is not marked done']=w.R('_siLinesScope')==='window'&&w.R('_siFull.st')!=='done';
    o['offline, partial copy: no put and no delete (the missing records are not "repaired" from stale data)']=nPut(c)===0&&nDel(c)===0;
  }
  {
    // with every part present the cancellation warning is NOT shown
    const c=await cold();
    const w=await warm(c,25*H,{online:false});
    o['offline, complete copy: no "cancellations not applied" wording']=!/cancellations not applied/i.test(w.say());
  }
  {
    // nothing saved at all
    const fx=fakeFs(T,{stamps:stampsOld}),clk={t:T0+5*H},cache=fakeCache(()=>clk.t,()=>'u1');
    const a=app(src,fx,cache,clk,{online:false});
    const r=await withTimeout(Promise.resolve(a.run('loadShopifyData()')),6000);await waitIdle();
    const s=say(a);
    o['offline, nothing saved: the load settles (no hang), not loaded, zero Firestore reads']=r==='done'&&a.run('_siLoaded')===false&&fx.all===0;
    o['offline, nothing saved: "You\'re offline and nothing is saved on this device yet" with a Retry; no zeros, no percentage, no loading text']=/You[’']re offline and nothing is saved on this device yet/i.test(s)&&/Retry/.test(s)&&!/\d+\s?%/.test(s)&&!/Loading|Reading /.test(s)&&!/Units|Revenue/.test(s);
    o['offline, nothing saved: no timer or interval is left running']=a.tr.timeouts.size===0&&a.tr.intervals.size===0;
    // Retry while still offline: still zero reads, still the honest state
    try{a.run('siRetryNow&&siRetryNow()');}catch(_){}
    await waitIdle();
    o['offline, nothing saved, Retry pressed while still offline: still zero reads']=fx.all===0;
  }
  {
    // a stuck IndexedDB: the copy read never answers
    const fx=fakeFs(T,{stamps:stampsOld}),clk={t:T0+5*H},cache=fakeCache(()=>clk.t,()=>'u1');cache.mode.getNever=true;
    const a=app(src,fx,cache,clk,{online:false});
    const r=await withTimeout(Promise.resolve(a.run('loadShopifyData()')),9000);await waitIdle();
    o['offline, the device copy never answers: the load still settles within the bound (no hang), zero reads, nothing-saved state']=r==='done'&&fx.all===0&&/nothing is saved on this device yet/i.test(say(a));
  }

  // ── BACK ONLINE ──
  {
    const c=await cold();
    const w=await warm(c,25*H,{online:false,noFlush:true});
    const before=OFFNOTE.test(w.say());
    c.fx.reset();c.cache.n={put:0,get:0,del:0,clear:0};
    w.a.online(true);
    const hs=w.a.state.listeners['window:online']||[];
    hs.forEach(h=>{try{h({type:'online'});}catch(_){}});
    await waitIdle();await waitIdle();await w.a.run('window._siCacheFlush()');await waitIdle();
    const s=w.say();
    o['online event: the offline note was up before it, and the registered window "online" listener exists']=before&&hs.length===1;
    o['online event, copy 25 h old: the normal check runs (the 5 sync-meta docs are read) AND full reads are forced although the stamps did not move']=c.fx.metaGets>=5&&c.fx.big()===FULL;
    o['online event: the note is cleared once the check succeeded, and the page is still loaded']=!OFFNOTE.test(s)&&!/You[’']re offline/.test(s)&&w.R('_siLoaded')===true;
    o['online event: a fresh copy is saved afterwards (savedAt = now), replacing the 25 h-old one']=c.cache.m.get('products').savedAt===T0+25*H;
    o['online event: the data is the fresh read (2 products, 202 line items, nothing dropped)']=w.R('_siProducts.length')===2&&w.R('_siLineItems.length')===202;
  }
  {
    // a 3 h old copy shown offline, then online: the ordinary rule - unmoved stamps mean zero big reads
    const c=await cold();
    const w=await warm(c,3*H,{online:false,noFlush:true});
    const s0=w.say();
    c.fx.reset();
    w.a.online(true);
    (w.a.state.listeners['window:online']||[]).forEach(h=>{try{h({type:'online'});}catch(_){}});
    await waitIdle();await waitIdle();
    o['offline with a 3 h copy: shown with the offline note; online event: only the meta check runs, ZERO big reads (stamps unmoved, copy under 24 h), note cleared']=/You[’']re offline — showing the copy saved on [^(]*\(3 hours old\)\. Figures may be out of date\./.test(s0)?(c.fx.metaGets>=5&&c.fx.big()===NONE&&!/You[’']re offline/.test(w.say())):false;
  }
  {
    // coming back online but the check itself FAILS: the note stays (the data is still the stale copy)
    const c=await cold();
    const w=await warm(c,25*H,{online:false,noFlush:true});
    const e=new Error('Failed to fetch');e.code='unavailable';
    c.fx.reset();c.fx.failMeta=e;c.fx.failSnap=e;BIG.forEach(n=>{c.fx.fail[n]=e;});
    w.a.online(true);
    (w.a.state.listeners['window:online']||[]).forEach(h=>{try{h({type:'online'});}catch(_){}});
    await waitIdle();await waitIdle();
    const s=w.say();
    o['online event whose check FAILS: the offline note is NOT cleared, the stale copy is still shown, and the copy is not written over']=OFFNOTE.test(s)&&w.R('_siLoaded')===true&&w.R('_siProducts.length')===2&&c.cache.n.put===0;
  }
  {
    // the listener is registered once, however often the page loads
    const c=await cold();
    const w=await warm(c,3*H,{online:false});
    await w.a.run('loadShopifyData()');await w.a.run('loadShopifyData()');
    w.a.run('renderShopifyDashboard()');
    w.a.online(true);w.a.online(false);
    await w.a.run('loadShopifyData()');await waitIdle();
    const n1=(w.a.state.listeners['window:online']||[]).length;
    w.a.run('window.showPage("creative-hub")');w.a.run('window.showPage("shopify-intel")');
    await w.a.run('loadShopifyData()');await waitIdle();
    const n2=(w.a.state.listeners['window:online']||[]).length;
    o['the window "online" listener is registered exactly once, even after repeated loads, a re-render and leaving and re-entering the page']=n1===1&&n2===1;
  }
  {
    // two online events in a row do not read twice
    const c=await cold();
    const w=await warm(c,25*H,{online:false,noFlush:true});
    c.fx.reset();w.a.online(true);
    const hs=w.a.state.listeners['window:online']||[];
    hs.forEach(h=>{try{h({type:'online'});}catch(_){}});hs.forEach(h=>{try{h({type:'online'});}catch(_){}});
    await waitIdle();await waitIdle();
    o['two online events back to back: the four collections are read once each, not twice']=c.fx.big()===FULL;
  }

  // ── timers, sign-out, no siCache ──
  {
    const c=await cold();
    const w=await warm(c,25*H,{online:false});
    w.a.run('window.showPage("creative-hub")');
    await waitIdle();
    o['offline copy shown, then the page is left: no timeout and no interval is left running, and nothing is read']=w.a.tr.timeouts.size===0&&w.a.tr.intervals.size===0&&c.fx.all===0;
  }
  {
    const c=await cold();
    const w=await warm(c,25*H,{online:false});
    const idle0=nPut(c)===0&&Object.keys(w.a.run('_siCacheQ')).length===0;
    w.R('_siCachePut("products",_siProducts,{readAt:_siNow()})'); // the page tries to save what it shows (a refresh landing, a late stage)
    await w.a.run('window._siCacheFlush()');await waitIdle();
    o['offline: while the stale data is shown nothing is queued for saving, and an attempt to save the shown (stale) data writes nothing over the saved copy']=idle0&&nPut(c)===0&&c.cache.m.get('products').savedAt===T0;
    // sign-out guard is unchanged: a started sign-out refuses writes
    w.a.ctx.window.__gvSignOutStarted=true;
    o['sign-out guard unchanged: _siCacheWriteOk() is false once a sign-out has started']=w.R('_siCacheWriteOk()')===false;
  }
  {
    // no siCache at all: identical to today
    const fx=fakeFs(T,{stamps:stampsOld}),clk={t:T0};
    const a=app(src,fx,null,clk);
    const r=await withTimeout(Promise.resolve(a.run('loadShopifyData()')),6000);await waitIdle();
    const s=say(a);
    o['no siCache, online: loads exactly as today (4 big collections once each, 6 range queries, loaded) and says nothing about a saved copy or being offline']=r==='done'&&fx.big()===FULL&&fx.lineQueries.length===6&&a.run('_siLoaded')===true&&!/offline|showing the copy saved/i.test(s);
    const fx2=fakeFs(T,{stamps:stampsOld}),clk2={t:T0};
    const a2=app(src,fx2,null,clk2,{online:false});
    const r2=await withTimeout(Promise.resolve(a2.run('loadShopifyData()')),6000);await waitIdle();
    o['no siCache, navigator offline: no crash, the load settles, and it never claims to show a saved copy']=r2==='done'&&!/showing the copy saved/i.test(say(a2));
  }
  return o;
}

/* [label, text in js/shopify.js, replacement, check-name prefixes that must FAIL] - applied to a COPY of the source in memory, never to the repo file */
const BREAKS=[
  ['offline age limit is the online 24 h one',"nowMs-r.savedAt>_SI_CACHE_OFFLINE_MAX_AGE_MS)return false;","nowMs-r.savedAt>_SI_CACHE_MAX_AGE_MS)return false;",['offline, copy 25 h old: used','offline, copy 6.9 days old: still used']],
  ['offline age limit is 30 days instead of 7',"const _SI_CACHE_OFFLINE_MAX_AGE_MS=7*86400000;","const _SI_CACHE_OFFLINE_MAX_AGE_MS=30*86400000;",['offline, copy 7.1 days old: a miss']],
  ['a copy dated in the future is accepted offline',"r.savedAt>nowMs+_SI_CACHE_SKEW_MS||nowMs-r.savedAt>_SI_CACHE_OFFLINE_MAX_AGE_MS","nowMs-r.savedAt>_SI_CACHE_OFFLINE_MAX_AGE_MS",['offline, copy dated 20 minutes in the future']],
  ['the PO read is made while offline',"if(_siOffBlocked()){_siPoState='error';_siOff.sideSkipped.po=true;_siPoVer++;_siPoMemo=null;return Promise.resolve();}","",['offline, copy 25 h old: ZERO Firestore reads']],
  ['the sync-meta read is made while offline',"if(_siOffBlocked())return; // offline on a saved copy: no read","",['offline, copy 25 h old: ZERO Firestore reads']],
  ['no window online listener',"window.addEventListener('online',_siOnOnline);","",['online event: the offline note was up before it','online event, copy 25 h old: the normal check runs']],
  ['coming back online does not force full reads for an aged copy',"_siOffForce(ids,id=>!C.running[id]);","",['online event, copy 25 h old: the normal check runs']],
  ['the note calls the figures fresh',"Figures may be out of date.","Figures are fresh.",['offline, copy 25 h old: the persistent note','offline, copy 25 h old: nothing in the page']],
  ['the nothing-saved state says Loading',"You're offline and nothing is saved on this device yet\"","Loading\"",['offline, copy 7.1 days old: zero Firestore reads','offline, nothing saved: "You']],
  ['an offline copy may be written over',"  if(_siOffBlocked())return false; // offline, showing a saved (possibly aged) copy: nothing may be written over it","",['offline: while the stale data is shown']],
  ['the sign-out guard is dropped',"window.__gvSignOutStarted)return false;","window.__gvSignOutStarted)return true;",['sign-out guard unchanged']],
];

module.exports=async function(){
  const s=suite('shopify-offline');
  s.section('offline mode for the Inventory Intel device copy (fake siCache, counted Firestore calls, fake clock)');
  const base=await checks(SRC);
  const names=Object.keys(base);
  names.forEach(k=>s.ok(k,base[k]===true));
  if(process.env.SIO_BASE_ONLY)return s;
  s.section('deliberate breaks - each must fail the named check');
  const brk=async(label,from,to,failing)=>{
    if(SRC.indexOf(from)<0){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.replace(from,to));}catch(e){r=null;}
    const failed=names.filter(k=>!r||r[k]!==true);
    const hit=failing.filter(f=>failed.some(k=>k.indexOf(f)===0));
    s.ok('break "'+label+'" fails "'+failing.join('" and "')+'"',hit.length===failing.length,hit.length===failing.length?undefined:'failed: '+failed.slice(0,4).join(' | '));
  };
  for(const b of BREAKS)await brk(b[0],b[1],b[2],b[3]);
  return s;
};

/* Inventory Intel ▸ freshness (js/shopify.js, "Freshness"): the "Data as of" line, a Refresh that re-reads only what moved, and a
   10-minute auto-refresh. Every clock is a FAKE clock and every read is COUNTED per collection / meta doc, so "meta-only when
   nothing moved" and "exactly the moved collections" are numbers, not beliefs. Each "break" mutates the source and requires the
   named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/shopify.js'),'utf8');
const flush=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
const T0=1790000000000,H=3600000,MIN=60000;

function clock(ctx){
  const c={t:0,seq:0,timers:[]};
  const sync=()=>{ctx.window.__t=T0+c.t;};
  c.setTimeout=(fn,ms)=>{const id=++c.seq;c.timers.push({id,at:c.t+(ms||0),fn});return id;};
  c.setInterval=(fn,ms)=>{const id=++c.seq;c.timers.push({id,at:c.t+ms,fn,every:ms});return id;};
  c.clear=id=>{c.timers=c.timers.filter(x=>x.id!==id);};
  c.advance=async ms=>{
    const end=c.t+ms;
    for(;;){
      await flush();
      const due=c.timers.filter(x=>x.at<=end).sort((a,b)=>a.at-b.at||a.id-b.id)[0];
      if(!due)break;
      c.t=due.at;sync();
      if(due.every)due.at+=due.every;else c.timers=c.timers.filter(x=>x!==due);
      due.fn();
    }
    c.t=end;sync();await flush();
  };
  c.sync=sync;
  return c;
}
const ts=ms=>({seconds:Math.floor(ms/1000)});
function mk(src,o){
  o=o||{};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  const ctx=a.ctx;
  const ck=clock(ctx);
  ctx.setTimeout=ck.setTimeout;ctx.setInterval=ck.setInterval;ctx.clearTimeout=ck.clear;ctx.clearInterval=ck.clear;
  ctx.navigator={onLine:true};
  ctx.window.showPage=function(id){ctx.window.__page=id;};
  vm.runInContext(src,ctx,{filename:'shopify.js'});
  a.run('collection=function(d,n){return{n}};query=function(c){return c};orderBy=function(){return 1};doc=function(d,c,id){return{c,id}};');
  a.run('_siNow=function(){return window.__t};_siRand=function(){return 0.5}');
  ck.sync();
  const st={reads:{},meta:{},fail:{},stamps:Object.assign({catalog_sync:T0-1*H,order_sync:T0-1*H,order_refresh:T0-1*H,order_refresh_now:null,inventory_sync:T0-2*H},o.stamps||{}),docExtra:o.docExtra||{}};
  ctx.getDocs=ref=>{
    st.reads[ref.n]=(st.reads[ref.n]||0)+1;
    if(st.fail[ref.n])return Promise.reject(st.fail[ref.n]);
    return Promise.resolve({forEach(f){((o.rows&&o.rows[ref.n])||[]).forEach(r=>f({id:r.id||'x',data:()=>Object.assign({},r)}));}});
  };
  ctx.getDoc=ref=>{
    if(ref.c==='shopify_inventory_snapshots'){
      const k='snap:'+ref.id;st.reads[k]=(st.reads[k]||0)+1;
      return Promise.resolve({exists:()=>true,data:()=>({date:ref.id,snapshot_at:ts(st.stamps.inventory_sync||T0),items:{}})});
    }
    const k='meta:'+ref.id;st.meta[ref.id]=(st.meta[ref.id]||0)+1;st.reads[k]=(st.reads[k]||0)+1;
    if(st.fail[k])return Promise.reject(st.fail[k]);
    const v=st.stamps[ref.id];
    return Promise.resolve({exists:()=>v!=null,data:()=>Object.assign({last_success_at:ts(v),last_status:'success'},st.docExtra[ref.id]||{})});
  };
  const bigReads=()=>['shopify_products','shopify_orders','shopify_line_items','shopify_weekly_closes'].map(n=>n+':'+(st.reads[n]||0)).join(',');
  const reset=()=>{st.reads={};st.meta={};};
  return{a,R:c=>{try{return a.run(c);}catch(e){return undefined;}},ck,st,bigReads,reset};
}
const E=(msg,code)=>{const e=new Error(msg);if(code)e.code=code;return e;};
async function loaded(m){
  m.R('loadShopifyData()');
  await m.ck.advance(2000);
  return m.R('_siLoaded');
}

async function checks(src){
  const o={};
  // ── 1. First load files the stamps captured BEFORE each read ──
  {
    const m=mk(src),R=m.R;
    const ok=await loaded(m);
    o['the first load finishes']=ok===true;
    o['products are filed under the catalog stamp read before the read']=R('_siFr.seen.products.catalog')===T0-1*H;
    o['orders and line items are filed under the order_sync stamp']=R('_siFr.seen.orders.orders')===T0-1*H&&R('_siFr.seen.lines.orders')===T0-1*H;
    o['the snapshot is filed under the inventory_sync stamp']=R('_siFr.seen.snap.inventory')===T0-2*H;
    o['the stamp read before the reads is shared: the four collection reads made ONE catalog_sync meta read (+1 from the status stage)']=m.st.meta.catalog_sync===2;
    o['exactly ONE interval is running after the load, held in the controller']=m.ck.timers.filter(t=>t.every).length===1&&R('_siRetryCtl.auto')!==null;
    o['each big collection was read exactly once by the load']=m.bigReads()==='shopify_products:1,shopify_orders:1,shopify_line_items:1,shopify_weekly_closes:1';
  }
  // ── 2. Nothing moved: meta only ──
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();
    const r=await R('siRefresh()');
    o['nothing moved: ZERO big reads']=m.bigReads()==='shopify_products:0,shopify_orders:0,shopify_line_items:0,shopify_weekly_closes:0'&&(m.st.reads['snap:'+R('_siPktDate(0)')]||0)===0;
    o['nothing moved: only the five small meta docs were read, once each']=Object.keys(m.st.meta).sort().join()==='catalog_sync,inventory_sync,order_refresh,order_refresh_now,order_sync'&&Object.values(m.st.meta).every(n=>n===1);
    o['nothing moved: the answer and the status line say so']=J(r.read)==='[]'&&/nothing new/.test(R('_siFrView(_siNow()).status'));
    const r2=await R('siRefresh()');
    o['a second press is again meta-only']=J(r2.read)==='[]'&&m.bigReads()==='shopify_products:0,shopify_orders:0,shopify_line_items:0,shopify_weekly_closes:0';
  }
  // ── 3. Exactly the moved collections ──
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();
    m.ck.advance(0);m.st.stamps.order_sync=T0+10*MIN;
    const r=await R('siRefresh()');
    o['orders moved: exactly orders and line items are re-read (once each)']=m.bigReads()==='shopify_products:0,shopify_orders:1,shopify_line_items:1,shopify_weekly_closes:0'&&J(r.read.slice().sort())===J(['lines','orders']);
    o['orders moved: the new stamp is filed, so the next check is meta-only']=R('_siFr.seen.lines.orders')===T0+10*MIN;
    m.reset();const r2=await R('siRefresh()');
    o['after that, nothing moved again: zero big reads']=m.bigReads()==='shopify_products:0,shopify_orders:0,shopify_line_items:0,shopify_weekly_closes:0'&&r2.read.length===0;
    m.reset();m.st.stamps.catalog_sync=T0+30*MIN;
    const r3=await R('siRefresh()');
    o['catalog moved: only products are re-read']=m.bigReads()==='shopify_products:1,shopify_orders:0,shopify_line_items:0,shopify_weekly_closes:0'&&J(r3.read)==='["products"]';
    m.reset();m.st.stamps.order_refresh=T0+40*MIN;
    const r4=await R('siRefresh()');
    o['the order status refresh moved: orders and line items (statuses live there), nothing else']=m.bigReads()==='shopify_products:0,shopify_orders:1,shopify_line_items:1,shopify_weekly_closes:0'&&r4.read.length===2;
    m.reset();m.st.stamps.inventory_sync=T0+50*MIN;
    const r5=await R('siRefresh()');
    o['inventory moved: only the snapshot (a one-document read), no big collection']=m.bigReads()==='shopify_products:0,shopify_orders:0,shopify_line_items:0,shopify_weekly_closes:0'&&J(r5.read)==='["snap"]'&&(m.st.reads['snap:'+R('_siPktDate(0)')]||0)===1;
    m.reset();m.st.stamps.order_refresh_now=T0+60*MIN;
    const r6=await R('siRefresh()');
    o['an owner-triggered refresh (order_refresh_now) counts as the order status refresh moving']=r6.read.length===2;
  }
  // ── 4. Closes: no sync doc, so a daily re-read ──
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();R('siRetryClearTimers()'); // manual presses only: the auto timer would itself re-read the closes
    await m.ck.advance(23*H);m.st.stamps.catalog_sync=T0-1*H;
    let r=await R('siRefresh()');
    o['closes are NOT re-read at 23 hours']=r.read.indexOf('closes')<0&&(m.st.reads.shopify_weekly_closes||0)===0;
    await m.ck.advance(1*H+MIN);
    m.reset();r=await R('siRefresh()');
    o['closes ARE re-read once 24 hours old (and nothing else)']=J(r.read)==='["closes"]'&&m.bigReads()==='shopify_products:0,shopify_orders:0,shopify_line_items:0,shopify_weekly_closes:1';
  }
  // ── 5. Failures never pass as fresh ──
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();
    m.st.stamps.order_sync=T0+10*MIN;m.st.fail.shopify_line_items=E('quota','resource-exhausted');
    const r=await R('siRefresh()');
    o['a failed read is reported, per stage']=J(r.failed)==='["lines"]'&&/Could not refresh line items/.test(R('_siFrView(_siNow()).status'))&&R('_siFrView(_siNow()).statusKind')==='err';
    o['a failed read keeps the OLD stamp, so the line still states the old age']=R('_siFr.seen.lines.orders')===T0-1*H&&R('_siFrView(_siNow()).sources.find(function(s){return s.id==="orders"}).ageMs')>=H&&R('_siFrView(_siNow()).sources.find(function(s){return s.id==="orders"}).ageMs')<H+MIN;
    o['a failed read is shown with role=alert in the strip']=/role="alert"/.test(R('_siFrHtml()'))&&/Still showing the earlier data/.test(R('_siFrHtml()'));
    m.reset();delete m.st.fail.shopify_line_items;
    const r2=await R('siRefresh()');
    o['the next refresh retries ONLY the stage that failed (orders was already filed)']=m.bigReads()==='shopify_products:0,shopify_orders:0,shopify_line_items:1,shopify_weekly_closes:0'&&J(r2.read)==='["lines"]';
    o['and the error clears once it lands']=R('_siFrView(_siNow()).statusKind')!=='err';
  }
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();
    m.st.fail['meta:order_sync']=E('offline');
    const r=await R('siRefresh()');
    o['a failed meta check re-reads NO big collection and says it could not check']=r.error==='meta'&&m.bigReads()==='shopify_products:0,shopify_orders:0,shopify_line_items:0,shopify_weekly_closes:0'&&/Could not check for new data \(offline\)/.test(R('_siFrView(_siNow()).status'));
    o['after a failed check the page is not "busy" and can try again']=R('_siFr.busy')===false;
    delete m.st.fail['meta:order_sync'];m.reset();
    const r2=await R('siRefresh()');
    o['the next attempt works and clears the error']=J(r2.read)==='[]'&&R('_siFrView(_siNow()).statusKind')!=='err';
  }
  // ── 6. "Data as of" and stale-in-words ──
  {
    const m=mk(src),R=m.R;await loaded(m);
    const v=JSON.parse(R('JSON.stringify(_siFrView(_siNow()))'));
    o['"Data as of" names the OLDEST source and its age (stock snapshot, 2 hours)']=/^Data as of /.test(v.line)&&/oldest source: stock snapshot, 2 hours ago/.test(v.line);
    o['the time is in PKT, from the stamp (T0-2h = 2026-09-21 ... checked by formatting)']=R('_siFrFmt('+(T0-2*H)+')')===R('(function(){var d=new Date('+(T0-2*H)+'+5*3600000),M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],p=function(n){return(n<10?"0":"")+n};return d.getUTCDate()+" "+M[d.getUTCMonth()]+" "+p(d.getUTCHours())+":"+p(d.getUTCMinutes())+" PKT"})()');
    o['nothing is flagged when every source is inside twice its schedule']=v.stale===false&&v.warnings.length===0;
    await m.ck.advance(7*H-2000);   // orders 8h old = exactly 2x4h: not stale yet
    let v2=JSON.parse(R('JSON.stringify(_siFrView(_siNow()))'));
    o['exactly twice the interval is NOT stale (orders 8h, schedule 4h)']=v2.sources.find(s=>s.id==='orders').state==='ok';
    await m.ck.advance(2*MIN);
    R('window.__ageNow=_siNow()');
    v2=JSON.parse(R('JSON.stringify(_siFrView(_siNow()+'+MIN*1+'))'));
    o['past twice the interval it is STALE, in words, with the age and the schedule']=v2.sources.find(s=>s.id==='orders').state==='stale'&&/Orders and line items are 8 hours old — more than twice the 4-hour schedule/.test(v2.warnings.join(' '));
    o['stale shows as a visible warning sentence (not just a colour), starting "Stale data."']=/Stale data\./.test(R('(function(){var t=_siNow;_siNow=function(){return t()+'+MIN+'};try{return _siFrHtml()}finally{_siNow=t}})()'));
    o['the per-source list is in the markup (hover title and an expandable list)']=/<details class="si-fr-det"/.test(R('_siFrHtml()'))&&/title="Catalog: /.test(R('_siFrHtml()'));
  }
  {
    const m=mk(src,{docExtra:{inventory_sync:{last_status:'error',last_error:'boom'}}}),R=m.R;await loaded(m);
    const v=JSON.parse(R('JSON.stringify(_siFrView(_siNow()))'));
    const s=v.sources.find(x=>x.id==='inventory');
    o['a source whose last run FAILED says so in words, not only by age']=s.state==='failed'&&/last run of the stock snapshot failed \(boom\)/.test(s.words);
  }
  {
    const m=mk(src,{stamps:{catalog_sync:null}}),R=m.R;await loaded(m);
    const v=JSON.parse(R('JSON.stringify(_siFrView(_siNow()))'));
    o['a missing stamp is "age unknown", never fresh, and never claims staleness']=v.sources.find(s=>s.id==='catalog').state==='unknown'&&/age unknown/.test(v.warnings.join(' '))&&/another source’s age is unknown/.test(v.line);
  }
  // ── 7. The refresh progress ──
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();
    m.st.stamps.order_sync=T0+10*MIN;
    const seen=[];
    m.a.ctx.window.__pct=p=>seen.push(p);
    R('(function(){var o=_siFrPaint;_siFrPaint=function(){window.__pct(_siFr.pct+":"+_siFr.busy);return o()}})()');
    await R('siRefresh()');
    const pcts=seen.map(x=>x.split(':')).filter(x=>x[1]==='true').map(x=>+x[0]);
    // check 3 + orders 10 + lines 50 = 63 -> after the check 3/63=4, after orders 13/63=20, then lines 100 capped at 99
    o['progress uses siProgress over the moved stages only: starts low, never goes down, ends below 100 while busy']=pcts.length>=3&&pcts.every((p,i)=>i===0||p>=pcts[i-1])&&Math.max.apply(null,pcts)<=99;
    o['progress weights are the loader\'s own: check 3 + orders 10 + line items 50 -> 4 after the check']=pcts.indexOf(4)>=0;
    o['after the refresh the bar is full and the strip is idle']=R('_siFr.pct')===100&&R('_siFr.busy')===false;
    o['the button stays in the DOM (aria-disabled) while busy, so focus is never lost']=/aria-disabled="true"/.test(R('(function(){_siFr.busy=true;try{return _siFrHtml()}finally{_siFr.busy=false}})()'));
  }
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();
    m.st.stamps.order_sync=T0+10*MIN;
    const p1=R('siRefresh()'),p2=R('siRefresh()'),p3=R('window._siFrRefresh()');
    const [a,b]=await Promise.all([p1,p2]);await p3;
    o['two presses at once make ONE refresh (the second is skipped as busy)']=b.skipped==='busy'&&a.read.length===2&&m.bigReads()==='shopify_products:0,shopify_orders:1,shopify_line_items:1,shopify_weekly_closes:0';
  }
  // ── 8. The 10-minute auto-refresh ──
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();
    await m.ck.advance(9*MIN);
    o['no check before 10 minutes']=Object.keys(m.st.meta).length===0;
    await m.ck.advance(2*MIN);
    o['one check at 10 minutes, and it is meta-only when nothing moved']=Object.values(m.st.meta).every(n=>n===1)&&Object.keys(m.st.meta).length===5&&m.bigReads()==='shopify_products:0,shopify_orders:0,shopify_line_items:0,shopify_weekly_closes:0';
    m.reset();m.st.stamps.order_sync=T0+11*MIN;
    await m.ck.advance(10*MIN);
    o['at 20 minutes it re-reads exactly orders and line items because they moved']=m.bigReads()==='shopify_products:0,shopify_orders:1,shopify_line_items:1,shopify_weekly_closes:0';
    o['the interval never stacks: still exactly one after repeated starts']=(R('_siFrStart(false);_siFrStart(false);_siFrStart(false);1'),m.ck.timers.filter(t=>t.every).length===1);
  }
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();
    m.a.ctx.document.hidden=true;
    await m.ck.advance(35*MIN);
    o['a hidden tab does no checks at all (35 minutes: zero meta reads)']=Object.keys(m.st.meta).length===0;
    m.a.ctx.document.hidden=false;
    const ls=(m.a.state&&m.a.state.listeners&&m.a.state.listeners.visibilitychange)||[];
    ls.forEach(f=>f());
    await m.ck.advance(0);
    o['becoming visible runs ONE catch-up check straight away']=Object.values(m.st.meta).every(n=>n===1)&&Object.keys(m.st.meta).length===5&&ls.length===1;
  }
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();
    R('window.showPage("creative-hub")');
    o['leaving the page clears the auto interval (no timer left)']=m.ck.timers.length===0&&R('_siRetryCtl.auto')===null;
    await m.ck.advance(30*MIN);
    o['and nothing is read after leaving']=Object.keys(m.st.meta).length===0;
    R('window.showPage("shopify-intel")');
    o['coming back restarts ONE interval and runs a catch-up check (the data is 30+ minutes old)']=m.ck.timers.filter(t=>t.every).length===1;
    await m.ck.advance(0);
    o['the catch-up is meta-only when nothing moved']=Object.keys(m.st.meta).length===5&&m.bigReads()==='shopify_products:0,shopify_orders:0,shopify_line_items:0,shopify_weekly_closes:0';
  }
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();
    m.st.stamps.order_sync=T0+10*MIN;
    R('window.__rp=0;_siIgRepaint=function(){window.__rp++}');
    const p=R('siRefresh()');
    R('window.showPage("creative-hub")'); // leave mid-refresh
    const r=await p;
    o['leaving mid-refresh cancels it: no repaint is made on a page nobody is on']=r.cancelled===true&&R('window.__rp')===0&&R('_siFr.busy')===false;
  }
  // ── 9. Applying new data never destroys what is open ──
  {
    const m=mk(src),R=m.R;await loaded(m);m.reset();
    R('window.__rp=0;_siIgRepaint=function(){window.__rp++}');
    m.st.stamps.order_sync=T0+10*MIN;
    await R('siRefresh()');
    o['idle page: new data is applied through the section repaint (once)']=R('window.__rp')===1&&R('_siFr.pending')===false;
    m.reset();R('window.__rp=0;_siNaSel="GST001"');m.st.stamps.order_sync=T0+20*MIN;
    await R('siRefresh()');
    o['an open situation drawer: data is read but NOT repainted; a "Show new data" button appears instead']=R('window.__rp')===0&&R('_siFr.pending')===true&&/Show new data/.test(R('_siFrHtml()'));
    R('_siNaSel="";_siAxLtEdit="GST001"');m.reset();m.st.stamps.order_sync=T0+30*MIN;
    await R('siRefresh()');
    o['an open lead-time editor is protected the same way']=R('window.__rp')===0&&R('_siFr.pending')===true;
    R("_siAxLtEdit=null");
    const inp=m.a.ctx.document.getElementById('x-input');inp.tagName='INPUT';inp.isContentEditable=false;inp.focus();
    m.reset();m.st.stamps.order_sync=T0+40*MIN;
    await R('siRefresh()');
    o['a focused input is protected the same way']=R('window.__rp')===0&&R('_siFr.pending')===true;
    inp.blur();
    const ce=m.a.ctx.document.getElementById('x-ce');ce.tagName='DIV';ce.isContentEditable=true;ce.focus();
    m.reset();R('window.__rp=0');m.st.stamps.order_sync=T0+45*MIN;
    await R('siRefresh()');
    o['a focused contenteditable (a note being typed) is protected the same way']=R('window.__rp')===0&&R('_siFr.pending')===true;
    ce.blur();R('window.__rp=0');
    R('window._siFrShow()');
    o['"Show new data" applies it once the person is ready, and clears the notice']=R('window.__rp')===1&&R('_siFr.pending')===false;
  }
  {
    const m=mk(src),R=m.R;await loaded(m);
    const html=R('(function(){_siSnapshot=_siSnapshot||{};return renderShopifyDashboard()})()');
    o['the dashboard carries the strip: id si-fr, the Data as of line and a Refresh button']=/id="si-fr"/.test(html)&&/Data as of /.test(html)&&/onclick="window\._siFrRefresh\(\)"/.test(html);
  }
  return o;
}
const J=JSON.stringify;

async function brk(s,name,pairs,expect){
  let src=SRC;
  for(const [from,to] of pairs){
    if(src.indexOf(from)<0){s.ok('break target exists: '+name,false);return;}
    src=src.replace(from,to);
  }
  const r=await checks(src);
  const failed=expect.filter(k=>r[k]!==true);
  s.ok('break "'+name+'" fails "'+(expect[0].length>70?expect[0].slice(0,70)+'…':expect[0])+'"',failed.length===expect.length,failed.length+' of '+expect.length+' expected checks failed');
}
module.exports=async function(){
  const s=suite('shopify-freshness');
  const base=await checks(SRC);
  s.section('data-as-of, meta-gated refresh, auto-refresh (fake clock, counted reads)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  const A=(f,t)=>[f,t];
  await brk(s,'refresh re-reads everything',[A("if(n==null)return;const o=was?was[k]:null;if(o==null||n>o)moved=true;","moved=true;")],['nothing moved: ZERO big reads','catalog moved: only products are re-read']);
  await brk(s,'gate ignores the order status refresh',[A("orders:['orders','refresh'],lines:['orders','refresh']","orders:['orders'],lines:['orders']")],['the order status refresh moved: orders and line items (statuses live there), nothing else']);
  await brk(s,'closes never re-read',[A("(!readAt.closes||now-readAt.closes>=_SI_FR_CLOSES_MS)","false")],['closes ARE re-read once 24 hours old (and nothing else)']);
  await brk(s,'closes always re-read',[A("(!readAt.closes||now-readAt.closes>=_SI_FR_CLOSES_MS)","true")],['nothing moved: ZERO big reads']);
  await brk(s,'stamp captured AFTER the read (would over-claim)',[A("const stamps=await _siFrStampsPre(); // captured BEFORE","const stamps=null; // captured BEFORE")],['products are filed under the catalog stamp read before the read']);
  await brk(s,'a failed read advances the stamp anyway',[A("}catch(e){F.state[id]='failed';F.fails[id]=_siLoadErr(e);}","}catch(e){_siFrNote(id,meta.stamps);F.state[id]='failed';F.fails[id]=_siLoadErr(e);}")],['a failed read keeps the OLD stamp, so the line still states the old age']);
  await brk(s,'a failed meta check falls through to big reads',[A("catch(e){finish();F.checkedAt=_siNow();F.check={ok:false,err:_siLoadErr(e).msg,at:_siNow()};_siFrPaint();return{error:'meta'};}","catch(e){meta={docs:{},stamps:{catalog:1e15,orders:1e15,refresh:1e15,inventory:1e15}};}")],['a failed meta check re-reads NO big collection and says it could not check']);
  await brk(s,'stale at exactly 2x',[A("age>limit","age>=limit")],['exactly twice the interval is NOT stale (orders 8h, schedule 4h)']);
  await brk(s,'stale threshold 3x',[A("_SI_FR_STALE_X=2","_SI_FR_STALE_X=3")],['past twice the interval it is STALE, in words, with the age and the schedule']);
  await brk(s,'stale shown by colour only',[A("(v.stale?'Stale data.':'Check the sync.')","''")],['stale shows as a visible warning sentence (not just a colour), starting "Stale data."']);
  await brk(s,'a missing stamp counts as fresh',[A("if(t==null){state=s.id==='refresh'?'quiet':'unknown';","if(t==null){state='ok';")],['a missing stamp is "age unknown", never fresh, and never claims staleness']);
  await brk(s,'auto interval 5 minutes',[A("_SI_FR_AUTO_MS=600000","_SI_FR_AUTO_MS=300000")],['no check before 10 minutes']);
  await brk(s,'hidden tab not honoured',[A("if(_siFrIsHidden())return;               //","if(false)return;               //")],['a hidden tab does no checks at all (35 minutes: zero meta reads)']);
  await brk(s,'no catch-up on visible',[A("if(!_siFrIsHidden()&&_siLoaded&&_siLoadAlive()&&_siRetryCtl.auto)_siFrTick();","")],['becoming visible runs ONE catch-up check straight away']);
  await brk(s,'interval survives leaving',[A("  if(C.auto){clearInterval(C.auto);C.auto=null;}\n}","}")],['leaving the page clears the auto interval (no timer left)']);
  await brk(s,'timers stack',[A("if(C.auto){clearInterval(C.auto);C.auto=null;}   // never two timers","")],['the interval never stacks: still exactly one after repeated starts']);
  await brk(s,'no catch-up on re-entry',[A("if(id==='shopify-intel'&&_siLoaded)_siFrStart(true);","if(id==='shopify-intel'&&_siLoaded)_siFrStart(false);")],['the catch-up is meta-only when nothing moved']);
  await brk(s,'refresh not cancelled by leaving',[A("if(C.gen!==gen){finish();return{cancelled:true,read:done};}\n  if(done.indexOf('snap')","if(done.indexOf('snap')"),A("if(C.gen!==gen){finish();return{cancelled:true};}\n  F.checkedAt","F.checkedAt")],['leaving mid-refresh cancels it: no repaint is made on a page nobody is on']);
  await brk(s,'no busy guard',[A("if(F.busy)return{skipped:'busy'};","")],['two presses at once make ONE refresh (the second is skipped as busy)']);
  await brk(s,'repaint over an open drawer',[A("if(_siNaSel||_siAxOvSit||_siAxLtEdit)return true;","")],['an open situation drawer: data is read but NOT repainted; a "Show new data" button appears instead','an open lead-time editor is protected the same way']);
  await brk(s,'repaint over a focused input',[A("if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName||'')&&a.id!=='si-fr-btn')return true;","")],['a focused input is protected the same way']);
  await brk(s,'repaint over a focused note',[A("if(a&&a.isContentEditable)return true;","")],['a focused contenteditable (a note being typed) is protected the same way']);
  await brk(s,'progress hits 100 early',[A("F.pct=siProgressNext(F.pct,siProgress(F.stages,F.state));if(C.gen===gen)_siFrPaint();","F.pct=100;if(C.gen===gen)_siFrPaint();")],['progress uses siProgress over the moved stages only: starts low, never goes down, ends below 100 while busy']);
  await brk(s,'button disabled instead of aria-disabled',[A('aria-disabled="\'+(v.busy?\'true\':\'false\')+\'"','disabled="\'+(v.busy?\'true\':\'false\')+\'"')],['the button stays in the DOM (aria-disabled) while busy, so focus is never lost']);
  return s;
};

/* Inventory Intel > the Stock snapshot stage: day basis, older-snapshot fallback, no-snapshot completion, real errors (Oct 2026).
   Owner report 2026-10-09T21:33Z (= 02:33 PKT on Oct 10): the load stopped at 68% on the Stock snapshot stage with
   "Inventory snapshot unavailable (no snapshot for today or yesterday)", 3/3 attempts.
   Writer (netlify/functions/shopify-inventory-snapshot.js): doc id = date = PKT day (UTC+5, no DST), snapshot_at = write time (ISO);
   it runs at 05:00Z and 17:00Z (10:00 and 22:00 PKT).

   Hand-computed clocks (PKT = UTC + 5h):
     2026-10-09T21:33:00Z -> 02:33 on Oct 10   today = 2026-10-10, yesterday = 2026-10-09
     2026-10-09T18:59:00Z -> 23:59 on Oct  9   today = 2026-10-09
     2026-10-09T19:00:00Z -> 00:00 on Oct 10   today = 2026-10-10
   Snapshot ages at 21:33Z Oct 9: doc 2026-10-09 snapshot_at 2026-10-09T17:00Z = 4h33m old; doc 2026-10-07 snapshot_at
   2026-10-07T17:00Z = 52h33m old (2 days 4 h); PKT days behind today: Oct 9 = 1, Oct 7 = 3.
   The clock is FAKE (Date.now, setTimeout, setInterval run off one counter) so the 3-attempt backoff is exact. Every check runs the real
   loader (loadShopifyData) and reads the state it leaves; nothing is asserted on a helper alone.
   Each "break" mutates the source in a scratch string and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const flush=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
const Z=s=>Date.parse(s);

function clock(base){
  const c={t:0,seq:0,timers:[],base};
  c.now=()=>c.base+c.t;
  c.setTimeout=(fn,ms)=>{const id=++c.seq;c.timers.push({id,at:c.t+(ms||0),fn});return id;};
  c.setInterval=(fn,ms)=>{const id=++c.seq;c.timers.push({id,at:c.t+ms,fn,every:ms});return id;};
  c.clear=id=>{c.timers=c.timers.filter(x=>x.id!==id);};
  c.advance=async ms=>{
    const end=c.t+ms;
    for(;;){
      await flush();
      const due=c.timers.filter(x=>x.at<=end).sort((a,b)=>a.at-b.at||a.id-b.id)[0];
      if(!due)break;
      c.t=due.at;
      if(due.every)due.at+=due.every;else c.timers=c.timers.filter(x=>x!==due);
      due.fn();
    }
    c.t=end;await flush();
  };
  return c;
}
const E=(msg,code)=>{const e=new Error(msg);if(code)e.code=code;return e;};
const snapDoc=(day,at)=>({date:day,snapshot_at:at,complete:true,items:{a:{sku:'AA-S',variant_id:'v1',available:5},b:{sku:'AA-M',variant_id:'v2',available:3}}});

/* o.nowZ: ISO clock. o.snaps: {docId: data}. o.snapErr: function(id, nth) -> Error|null for a single-doc snapshot read.
   o.listErr: Error thrown by any query read of the snapshots collection (the fallback may list instead of probing). */
function mk(src,o){
  const ck=clock(Z(o.nowZ));
  const st={snapReads:[],listReads:0,snaps:o.snaps||{}};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  const ctx=a.ctx;
  class FDate extends Date{constructor(...x){if(x.length)super(...x);else super(ck.now());}static now(){return ck.now();}}
  ctx.Date=FDate;
  ctx.setTimeout=ck.setTimeout;ctx.setInterval=ck.setInterval;ctx.clearTimeout=ck.clear;ctx.clearInterval=ck.clear;
  ctx.navigator={onLine:true,clipboard:{writeText:()=>Promise.resolve()}};
  vm.runInContext(src,ctx,{filename:'shopify.js'});
  a.run('collection=function(d,n){return{n}};where=function(f,op,v){return{t:"where",f:f,op:op,v:v}};query=function(c){return{n:c.n,w:[].slice.call(arguments,1)}};orderBy=function(f,d){return{t:"ob",f:f,d:d}};limit=function(n){return{t:"lim",n:n}};doc=function(d,c,id){return{c:c,id:id}};');
  let lineCalls=0;
  ctx.getDocs=ref=>{
    const n=ref.n;
    if(n==='shopify_inventory_snapshots'){
      st.listReads++;
      if(o.listErr)return Promise.reject(o.listErr);
      let ids=Object.keys(st.snaps).sort();
      const ob=(ref.w||[]).find(c=>c.t==='ob');
      const asc=!!ob&&ob.d==='asc';
      // the fake honours the direction of the orderBy it is given (default: ascending, as Firestore does)
      if(!asc)ids.reverse();
      (ref.w||[]).forEach(c=>{
        if(c.t==='where'){
          const key=x=>c.f==='date'||c.f==='__name__'||(c.f&&c.f.__documentId)||c.f==='documentId'?x:null;
          ids=ids.filter(id=>{const k=key(id);if(k==null)return true;
            return c.op==='<'?k<c.v:c.op==='<='?k<=c.v:c.op==='>='?k>=c.v:c.op==='>'?k>c.v:c.op==='=='?k===c.v:true;});
        }
      });
      const lim=(ref.w||[]).find(c=>c.t==='lim');if(lim)ids=ids.slice(0,lim.n);
      return Promise.resolve({empty:!ids.length,size:ids.length,docs:ids.map(id=>({id,exists:()=>true,data:()=>st.snaps[id]})),forEach(f){ids.forEach(id=>f({id,exists:()=>true,data:()=>st.snaps[id]}));}});
    }
    const rows=n==='shopify_products'?[{sku:'AA-S',product_title:'Alpha',color:'Red',size:'S',price:100,created_at:'2026-01-01T00:00:00Z',status:'active',tags:[],product_type:'Tee',variant_id:'v1'}]
      :n==='shopify_line_items'&&(lineCalls++%6===0)?[{order_id:1,line_item_id:11,sku:'AA-S',quantity:2,price:100,order_created_at:'2026-10-08T10:00:00+05:00',financial_status:'paid'}]:[];
    return Promise.resolve({forEach(f){rows.forEach((r,i)=>f({id:'r'+i+'_'+lineCalls,data:()=>Object.assign({},r)}));}});
  };
  ctx.getDoc=ref=>{
    if(ref.c==='shopify_inventory_snapshots'){
      st.snapReads.push(ref.id);
      const nth=st.snapReads.filter(x=>x===ref.id).length;
      const err=o.snapErr&&o.snapErr(ref.id,nth);
      if(err)return Promise.reject(err);
      const d=st.snaps[ref.id];
      return Promise.resolve({exists:()=>!!d,data:()=>d,id:ref.id});
    }
    return Promise.resolve({exists:()=>false});
  };
  return{a,R:c=>{try{return a.run(c);}catch(e){return undefined;}},ck,st}; // a missing identifier (the old code) makes the check fail, never throws the suite
}
async function load(src,o){
  const m=mk(src,o);let resolved=false;
  // the (never fatal) meta stage also reads the snapshot from 7 PKT days ago; the snap stage's own reads are everything else
  const wk=new Date(Z(o.nowZ)+5*3600000-7*864e5).toISOString().slice(0,10);
  m.mine=()=>m.st.snapReads.filter(x=>x!==wk);
  m.R('window.showPage=function(){}');
  m.R('loadShopifyData()').then(()=>{resolved=true;});
  await m.ck.advance(1);
  m.done=()=>resolved;
  return m;
}

async function checks(src){
  const o={};
  const NOW='2026-10-09T21:33:00Z';
  const S9=snapDoc('2026-10-09','2026-10-09T17:00:00Z');
  const S8=snapDoc('2026-10-08','2026-10-08T17:00:00Z');
  const S7=snapDoc('2026-10-07','2026-10-07T17:00:00Z');

  // ── (a) the day basis is PKT, exactly as the writer's pktDateStr() ──────────────────────────────
  {
    const m=await load(src,{nowZ:NOW,snaps:{'2026-10-09':S9}});
    o['(a) 21:33Z Oct 9 = 02:33 PKT Oct 10: the stage uses the Oct 9 snapshot and the load completes']=
      m.R('_siSnapshot&&_siSnapshot.date')==='2026-10-09'&&m.R('_siLoaded')===true&&m.R('_siLoadError')===null&&m.R('_siLoad.state.snap')==='done';
    o['(a) the first key asked for is the PKT day 2026-10-10 (not the UTC day 2026-10-09)']=m.mine()[0]==='2026-10-10';
    o['(a) a snapshot one PKT day old is NOT labelled stale (no fallback flag, no age words)']=m.R('_siSnapFallback')===false&&m.R('_siSnapNone')===false&&m.R('_siSnapAgeWords(Date.now())')===null;
  }
  {
    const m=await load(src,{nowZ:'2026-10-09T18:59:00Z',snaps:{'2026-10-09':S9}});
    o['(a) 18:59Z = 23:59 PKT Oct 9: today key is 2026-10-09 and that snapshot is used first']=m.mine()[0]==='2026-10-09'&&m.R('_siSnapshot.date')==='2026-10-09'&&m.R('_siLoaded')===true;
  }
  {
    const m=await load(src,{nowZ:'2026-10-09T19:00:00Z',snaps:{'2026-10-09':S9}});
    o['(a) 19:00Z = 00:00 PKT Oct 10: today key is 2026-10-10; with only Oct 9 present Oct 9 is used (yesterday)']=m.mine()[0]==='2026-10-10'&&m.R('_siSnapshot.date')==='2026-10-09'&&m.R('_siLoaded')===true&&m.R('_siLoadError')===null;
  }
  {
    const m=await load(src,{nowZ:'2026-10-09T19:00:00Z',snaps:{'2026-10-10':snapDoc('2026-10-10','2026-10-09T19:05:00Z'),'2026-10-09':S9}});
    o['(a) 19:00Z with both days present: the newer (Oct 10) wins']=m.R('_siSnapshot.date')==='2026-10-10';
  }

  // ── (b) neither day exists -> the most recent older snapshot, labelled stale with its age ──────
  {
    const m=await load(src,{nowZ:NOW,snaps:{'2026-10-07':S7,'2026-10-05':snapDoc('2026-10-05','2026-10-05T17:00:00Z')}});
    o['(b) only Oct 7 (and Oct 5): the stage completes with the Oct 7 snapshot (the most recent older one, not Oct 5)']=
      m.R('_siSnapshot&&_siSnapshot.date')==='2026-10-07'&&m.R('_siLoaded')===true&&m.R('_siLoad.state.snap')==='done'&&m.R('_siLoadError')===null;
    o['(b) it did not retry or fail: one load, the stage not failed']=m.done()&&m.R('_siLoadFailedIds().length')===0;
    const w=m.R('_siSnapAgeWords(Date.now())');
    o['(b) labelled stale with its age: "2026-10-07", "3 days old" (Oct 7 to Oct 10 PKT = 3 days)']=!!w&&w.none===false&&w.days===3&&/2026-10-07/.test(w.words)&&/3 days old/.test(w.words);
    o['(b) the Today line says "(stale)" next to the snapshot date']=/latest 2026-10-07 \(stale\)/.test(String(m.R('_siOverview({})')));
    o['(b) the freshness view marks the stock source stale with the same words']=(()=>{
      try{const v=m.R('_siFrView(Date.now())');const inv=(v.sources||v.rows||[]).find(x=>x.id==='inventory');return !!inv&&inv.state==='stale'&&/3 days old/.test(inv.words);}catch(e){return false;}
    })();
  }
  {
    const m=await load(src,{nowZ:NOW,snaps:{'2026-10-08':S8}});
    o['(b) only Oct 8 (two PKT days back): still used, load completes, 2 days old']=m.R('_siSnapshot&&_siSnapshot.date')==='2026-10-08'&&m.R('_siLoaded')===true&&m.R('_siSnapAgeWords(Date.now()).days')===2;
  }

  // ── (c) no snapshot at all -> the stage completes; stock figures are "—", never 0 ────────────────
  {
    const m=await load(src,{nowZ:NOW,snaps:{}});
    o['(c) zero snapshots: the load RESOLVES as loaded, no error, snap stage done (not failed)']=m.done()&&m.R('_siLoaded')===true&&m.R('_siLoadError')===null&&m.R('_siLoad.state.snap')==='done'&&m.R('_siLoadFailedIds().length')===0;
    o['(c) zero snapshots: no snapshot object, and nothing retried 3 times (no timer left)']=m.R('_siSnapshot')===null&&m.R('_siRetryCtl.timer')===null;
    o['(c) the other stages loaded normally (catalog read, one product in the index)']=m.R('_siProducts.length')===1&&m.R('_siLoad.state.products')==='done'&&m.R('_siLoad.state.lines')==='done';
    let idx=null;try{idx=m.R('(function(){var x=_siAxIndex();return JSON.stringify({n:x.list.length,hs:x.list.map(function(a){return a.hasStock}),oh:x.list.map(function(a){return a.onHand})})})()');}catch(e){}
    const j=idx?JSON.parse(idx):null;
    o['(c) zero snapshots: the article has hasStock=false (stock is unknown, not zero)']=!!j&&j.n===1&&j.hs[0]===false;
    let html='';try{html=String(m.R('_siAxVerdictKpis?"":""'));}catch(e){}
    let page='';try{page=String(m.R('(function(){var c=_siAxIndex().map;var a=c.get?c.get("AA"):c.AA;return a?_siAxArticleHtml?_siAxArticleHtml(a):"":""})()'));}catch(e){}
    const w=m.R('_siSnapAgeWords(Date.now())');
    o['(c) zero snapshots: flagged as none (words say "—", never 0)']=m.R('_siSnapNone')===true&&!!w&&w.none===true&&/“—”/.test(w.words);
    o['(c) zero snapshots: the Today line says "none yet"']=/Snapshots: none yet/.test(String(m.R('_siOverview({})')));
    o['(c) zero snapshots: the freshness view marks stock stale (no snapshot), not fine']=(()=>{
      try{const v=m.R('_siFrView(Date.now())');const inv=(v.sources||v.rows||[]).find(x=>x.id==='inventory');return !!inv&&inv.state==='stale'&&/No stock snapshot/.test(inv.words);}catch(e){return false;}
    })();
    o['(c) zero snapshots: the SKU table shows no stock as a number (on-hand is "—"/null, NOT 0)']=(()=>{
      try{const rows=m.R('_siComputeSkuTable()');const r=rows[0];return !!r&&(r.onHand==null||r.onHand==='—');}catch(e){return false;}
    })();
  }

  // ── (d) a real read error still fails the stage, with Retry ────────────────────────────────────
  {
    const m=await load(src,{nowZ:NOW,snaps:{'2026-10-09':S9},snapErr:id=>E('Missing or insufficient permissions.','permission-denied')});
    o['(d) permission-denied on the snapshot read: the stage FAILS (not silently "no snapshot")']=m.R('_siLoad.state.snap')==='failed'&&m.R('_siLoaded')===false&&m.done();
    o['(d) permission-denied: no automatic retry, one read of the snapshot key, no timer']=m.mine().length===1&&m.R('_siRetryCtl.timer')===null;
    o['(d) permission-denied: the error names the stock snapshot and carries the real message, not the "no snapshot" text']=/Stock snapshot/.test(m.R('_siLoadError')||'')&&/permission/i.test(m.R('_siLoadError')||'')&&!/no snapshot for today/.test(m.R('_siLoadError')||'');
    o['(d) permission-denied: the card offers "Retry this stage"']=/Retry this stage/.test(m.R('_siLoaderBtns(_siLoadView())'));
  }
  {
    // today is simply missing, but the YESTERDAY read is refused: that is a real error, never turned into "use something older"
    const m=await load(src,{nowZ:NOW,snaps:{'2026-10-07':S7},snapErr:id=>id==='2026-10-09'?E('Missing or insufficient permissions.','permission-denied'):null});
    o['(d) today missing then yesterday refused: the stage fails (a refusal is not "no snapshot")']=m.R('_siLoad.state.snap')==='failed'&&m.R('_siSnapshot')===null&&m.R('_siLoaded')===false;
  }
  {
    // a network error retries up to 3 attempts, then stops on the card
    const m=await load(src,{nowZ:NOW,snaps:{'2026-10-09':S9},snapErr:id=>E('Failed to get document because the client is offline.','unavailable')});
    await m.ck.advance(30000);
    o['(d) network error: the snapshot is attempted 3 times (the cap), then the stage is failed with Retry']=m.mine().filter(x=>x==='2026-10-10').length===3&&m.R('_siLoad.state.snap')==='failed'&&m.R('_siLoaded')===false&&/Retry this stage/.test(m.R('_siLoaderBtns(_siLoadView())'));
  }
  {
    // retry after the error clears loads it (the card's button works)
    let bad=true;
    const m=await load(src,{nowZ:NOW,snaps:{'2026-10-09':S9},snapErr:()=>bad?E('Missing or insufficient permissions.','permission-denied'):null});
    bad=false;
    m.R('window._siRetryStage("snap")');await m.ck.advance(3000);
    o['(d) Retry this stage after the cause is fixed: the snapshot loads and the page is loaded']=m.R('_siSnapshot&&_siSnapshot.date')==='2026-10-09'&&m.R('_siLoaded')===true;
  }
  return o;
}

module.exports=async function(){
  const s=suite('shopify-snapshot-fallback');
  s.section('day basis, older fallback, no snapshot, real errors');
  const base=await checks(SRC);
  const names=Object.keys(base);
  names.forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks - each must fail the named check');
  const brk=async(label,from,to,failing)=>{
    if(SRC.indexOf(from)<0){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.replace(from,to));}catch(e){r=null;}
    const failed=names.filter(k=>!r||r[k]!==true);
    const hit=failing.filter(f=>failed.some(k=>k.indexOf(f)===0));
    s.ok('break "'+label+'" fails "'+failing.join('" and "')+'"',hit.length===failing.length,hit.length===failing.length?undefined:'failed: '+failed.slice(0,4).join(' | '));
  };
  await brk('PKT day basis lost (UTC day)',"return new Date(Date.now()+5*3600000+(off||0)*864e5)","return new Date(Date.now()+(off||0)*864e5)",['(a) the first key asked for is the PKT day','(a) 19:00Z = 00:00 PKT']);
  await brk('no fallback to an older snapshot',"fallback=!!data;","fallback=false;data=null;",['(b) only Oct 7 (and Oct 5)','(b) only Oct 8']);
  await brk('fallback takes the OLDEST of the listed, not the newest',"orderBy('snapshot_at','desc'),limit(3)","orderBy('snapshot_at','asc'),limit(3)",['(b) only Oct 7 (and Oct 5)']);
  await brk('stale label dropped',"fallback=!!data;","fallback=false;",['(b) labelled stale with its age','(b) the Today line says "(stale)"']);
  await brk('no snapshot at all still throws',"else if(!_siSnapshot){_siSnapNone=true;_siSnapFallback=false;}","else if(!_siSnapshot){throw new Error('Inventory snapshot unavailable');}",['(c) zero snapshots: the load RESOLVES','(c) zero snapshots: flagged as none']);
  await brk('a read error is swallowed as "no snapshot"',"let snap=await getDoc(doc(db,'shopify_inventory_snapshots',today));\n    if(!snap.exists())snap=await getDoc(doc(db,'shopify_inventory_snapshots',yesterday));","let snap;try{snap=await getDoc(doc(db,'shopify_inventory_snapshots',today));if(!snap.exists())snap=await getDoc(doc(db,'shopify_inventory_snapshots',yesterday));}catch(_){snap={exists:()=>false};}",['(d) permission-denied on the snapshot read','(d) today missing then yesterday refused']);
  await brk('the fallback reads the wrong collection',"const q=await getDocs(query(collection(db,'shopify_inventory_snapshots')","const q=await getDocs(query(collection(db,'shopify_inventory_snapshots_x')",['(b) only Oct 7 (and Oct 5)']);
  return s;
};

/* Inventory Intel ▸ the stock-history read (load-time stage 1, Oct 2026).
   The read of up to 150 daily snapshots (~36 MB) was the second-heaviest part of a visit and every figure that uses it (in-stock
   rate, stock-out days, units per in-stock day, classes, cover, the timeline, Needs Attention, Portfolio exposure) reads the
   WHOLE counted window, so it cannot be capped or split without changing numbers (docs/UNITS_METRICS.md, "Where the stock history
   is used"). What changed instead: each closed day is folded once and cached on the device, and a warm visit reads only the newer
   days. These checks hold that (1) the history built from folds is IDENTICAL to the old whole-document build (a verbatim copy of
   the old code is kept below as the reference), (2) a warm read gives the same history as a full read, (3) what is read, (4) when
   the cache is ignored, (5) the pending, failed and landed states, (6) when the read starts. Every number is hand-computed or
   compared with the reference; every "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const flush=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
// The reference: the pre-change _siAxSnapKey/_siAxBuildHistory, verbatim (renamed).
const OLD=`function _oldSnapKey(d){
  const ms=_siAxSnapMs(d&&d.snapshot_at);
  if(ms==null)return String(d.date);
  const p=new Date(ms+5*3600000),day=_siAxDayNum(p.getUTCFullYear()+'-'+String(p.getUTCMonth()+1).padStart(2,'0')+'-'+String(p.getUTCDate()).padStart(2,'0'));
  return _siAxDayStr(p.getUTCHours()<_SI_AX_CFG.snapshotDayCutoffHour?day-1:day);
}
function _oldBuild(docs){
  const good=(docs||[]).filter(d=>d&&d.date&&d.items&&typeof d.items==='object'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(String(d.date)));
  const counts=good.map(d=>Object.keys(d.items).length).sort((x,y)=>x-y);
  const med=counts.length?counts[Math.floor(counts.length/2)]:0;
  const byCode=new Map(),dates=[],dropped=[],rekeyed=[],neg=new Map(),locs=new Map();
  // one document per closing day: two documents that map to the same day keep the EARLIER snapshot (the one closer to that day's end)
  const byKey=new Map();
  good.forEach(d=>{
    const n=Object.keys(d.items).length;
    if(med&&n<med*_SI_HIST_MIN_SHARE){dropped.push(d.date);return;}
    const key=_oldSnapKey(d);if(key!==String(d.date))rekeyed.push(d.date);
    const prev=byKey.get(key);
    if(!prev||(_siAxSnapMs(d.snapshot_at)||0)<(_siAxSnapMs(prev.snapshot_at)||0))byKey.set(key,d);
  });
  [...byKey.keys()].sort().forEach(key=>{
    const d=byKey.get(key);
    dates.push(key);
    const sums=new Map();
    // locations_seen is written only by snapshots taken after stock was summed across every location; older ones lack it
    const ls=Number(d.locations_seen);locs.set(key,(d.locations_seen!=null&&d.locations_seen!==''&&isFinite(ls))?ls:null);
    // oversold variants are counted as 0 in the sum and kept only as a per-day count
    for(const id in d.items){const it=d.items[id];const code=_siAxCode(it&&it.sku);if(!code)continue;sums.set(code,(sums.get(code)||0)+Math.max(0,it.available||0));
      if((it.available||0)<0){let nm=neg.get(code);if(!nm){nm=new Map();neg.set(code,nm);}nm.set(key,(nm.get(key)||0)+1);}}
    sums.forEach((v,code)=>{let m=byCode.get(code);if(!m){m=new Map();byCode.set(code,m);}m.set(key,v);});
  });
  const locVals=[...locs.values()].filter(v=>v!=null);
  const loc={max:locVals.length?Math.max.apply(null,locVals):null,missing:[...locs.values()].filter(v=>v==null).length,firstSeen:[...locs.keys()].sort().find(k=>locs.get(k)!=null)||''};
  return{dates,byCode,dropped,rekeyed,neg,loc,from:dates[0]||'',to:dates[dates.length-1]||'',docs:good.length};
}
`;
const mapJ=(k,v)=>v instanceof Map?{__map:[...v]}:v;
const ser=h=>JSON.stringify(h,mapJ);

/* A fake Firestore over a list of snapshot documents. collection/query/where/orderBy/limit build descriptors; getDocs applies
   them (a where on date, orderBy date desc, limit) and COUNTS the documents it returns per collection. */
function fake(snaps,o){
  o=o||{};
  const st={reads:{},queries:[],failSnap:o.failSnap||0,log:[]};
  const g={
    collection:(db,name)=>({__c:name,cons:[]}),
    query:(c,...cons)=>({__c:c.__c,cons}),
    where:(f,op,v)=>({t:'where',f,op,v}),orderBy:(f,d)=>({t:'ob',f,d}),limit:n=>({t:'lim',n}),
    doc:(db,c,id)=>({c,id}),
    getDoc:async r=>{
      if(r.c==='shopify_inventory_snapshots'&&(r.id===o.today||o.snapDoc))return{exists:()=>true,data:()=>o.snapDoc||snaps[snaps.length-1]};
      return{exists:()=>false};
    },
    getDocs:async q=>{
      const name=q.__c;st.log.push(name);
      if(name==='shopify_inventory_snapshots'){
        st.queries.push(q.cons);
        if(st.failSnap>0){st.failSnap--;throw new Error('snap read refused');}
        let d=snaps.slice();
        q.cons.forEach(c=>{if(!o.ignoreWhere&&c.t==='where'&&c.op==='>')d=d.filter(x=>String(x.date)>c.v);});
        d.sort((a,b)=>String(b.date)<String(a.date)?-1:1);
        const lim=q.cons.find(c=>c.t==='lim');if(lim)d=d.slice(0,lim.n);
        st.reads[name]=(st.reads[name]||0)+d.length;
        return{forEach:f=>d.forEach(x=>f({data:()=>x,id:x.date}))};
      }
      const rows=(o.cols&&o.cols[name])||[];
      st.reads[name]=(st.reads[name]||0)+rows.length;
      if(o.hold&&o.hold[name])await o.hold[name];
      return{forEach:f=>rows.forEach((x,i)=>f({data:()=>Object.assign({},x),id:String(i)}))};
    }
  };
  return{st,g};
}
function app(src,fk,store){
  store=store||{};
  const ls=store.__throw?{getItem(){throw new Error('no storage');},setItem(){throw new Error('no storage');},removeItem(){throw new Error('no storage');}}
    :{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},globals:Object.assign({localStorage:ls},fk.g)});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  vm.runInContext(OLD,a.ctx,{filename:'old.js'});
  return a;
}
const KEY='groovy-si-histfold';

/* FIXTURE A (hand-computed): three documents.
   08-01 22:00 PKT: AA-S 5 + AA-M 3 (one article AA, summed to 8), BB-S -2 (oversold: counts 0 and one oversold day), one item with no SKU (skipped but counted in n=4).
   08-02 22:00 PKT: the same four items, AA 6+3=9, BB 1.
   08-03: one item only (n=1 < 0.8 x median 4) -> an incomplete run: DROPPED, not read as a stock-out.
   counts sorted [1,4,4], median 4. dates 08-01, 08-02; dropped 08-03; docs 3; byCode AA {08-01:8, 08-02:9}, BB {08-01:0, 08-02:1}; neg BB {08-01:1}. */
const FA=[
  {date:'2026-08-01',snapshot_at:'2026-08-01T17:00:00Z',items:{a:{sku:'AA-S',available:5},b:{sku:'AA-M',available:3},c:{sku:'BB-S',available:-2},z:{available:9}}},
  {date:'2026-08-02',snapshot_at:'2026-08-02T17:00:00Z',items:{a:{sku:'AA-S',available:6},b:{sku:'AA-M',available:3},c:{sku:'BB-S',available:1},z:{available:9}}},
  {date:'2026-08-03',snapshot_at:'2026-08-03T17:00:00Z',items:{a:{sku:'AA-S',available:1}}}];
/* FIXTURE B: stresses every rule at once. 60 days; a negative day; a truncated day; locations_seen from day 30; a snapshot taken
   at 06:00 PKT (re-keyed to the previous day, and a second document for that closing day: the EARLIER one is kept); duplicate SKUs. */
function fixB(T){
  const base=new Date(T+'T00:00:00Z').getTime(),day=k=>new Date(base-k*86400000).toISOString().slice(0,10);
  const out=[];
  for(let k=59;k>=0;k--){
    const d=day(k),items={};
    for(const c of ['AA','BB','CC','DD'])for(const sz of ['S','M'])items[c+sz]={sku:c+'-'+sz,available:(k*7+c.charCodeAt(0)+(sz==='S'?0:3))%23-(k===20&&c==='BB'?30:0)};
    items.dup={sku:'AA-S',available:2};items.nosku={available:4};
    const doc={date:d,snapshot_at:d+'T17:00:00Z',items};
    if(k<=30)doc.locations_seen=2;
    if(k===40){doc.items={a:{sku:'AA-S',available:1}};}               // truncated run
    if(k===45){doc.snapshot_at=d+'T01:00:00Z';}                         // 06:00 PKT: the close of the day before
    out.push(doc);
  }
  return out;
}
function dayShift(T,k){return new Date(new Date(T+'T00:00:00Z').getTime()-k*86400000).toISOString().slice(0,10);}

async function checks(src,sink){
  const o={};
  const T=(()=>{const a0=app(src,fake([]),{});return a0.run('_siPktDate(0)');})();

  // ── 1. folds give the SAME history as the old whole-document build ──
  {
    const a=app(src,fake([]),{}),B=c=>a.run(c);
    B('var __fa='+J(FA));
    const h=B('_siAxBuildHistory(__fa)');
    o['hand fixture: dates, dropped and doc count']=J(h.dates)===J(['2026-08-01','2026-08-02'])&&J(h.dropped)===J(['2026-08-03'])&&h.docs===3;
    o['hand fixture: AA 8 then 9 (two sizes and a duplicate summed), BB 0 then 1 (an oversold -2 counts as 0)']=B('[..._siAxBuildHistory(__fa).byCode.get("AA")].join()')==='2026-08-01,8,2026-08-02,9'&&B('[..._siAxBuildHistory(__fa).byCode.get("BB")].join()')==='2026-08-01,0,2026-08-02,1';
    o['hand fixture: the oversold variant is a per-day count (BB, 08-01, 1), and the no-SKU item is skipped']=B('[..._siAxBuildHistory(__fa).neg.get("BB")].join()')==='2026-08-01,1'&&B('_siAxBuildHistory(__fa).byCode.size')===2;
    o['hand fixture: bad input never throws']=J(B('_siAxBuildHistory([null,{},{date:"x"}]).dates'))==='[]';
    const fb=fixB(T);B('var __fb='+J(fb));
    const nu=B('JSON.stringify(_siAxBuildHistory(__fb),(k,v)=>v instanceof Map?{__map:[...v]}:v)'),ol=B('JSON.stringify(_oldBuild(__fb),(k,v)=>v instanceof Map?{__map:[...v]}:v)');
    o['stress fixture (60 days, truncated, negative, re-keyed, duplicate day, locations): folds build == OLD build, byte for byte']=nu===ol&&nu.length>2000;
    o['stress fixture is not trivial: a drop, a re-key and a negative day were all exercised']=B('_siAxBuildHistory(__fb).dropped.length')===1&&B('_siAxBuildHistory(__fb).rekeyed.length')>=1&&B('_siAxBuildHistory(__fb).neg.size')>=1;
    // a fold survives JSON (the cache) unchanged
    const rt=B('JSON.stringify(_siAxHistoryFromFolds(JSON.parse(JSON.stringify(__fb.map(_siAxFoldDoc)))),(k,v)=>v instanceof Map?{__map:[...v]}:v)');
    o['folds round-tripped through JSON (the cache) give the same history']=rt===ol;
  }

  // ── 2. cold read, what it reads and what it keeps ──
  const snaps40=Array.from({length:40},(_,i)=>{const d=dayShift(T,39-i);const items={};for(const c of ['AA','BB'])items[c]={sku:c+'-M',available:(i*3+c.charCodeAt(0))%17};return{date:d,snapshot_at:d+'T17:00:00Z',items};});
  let coldH;
  {
    const fk=fake(snaps40),store={},a=app(src,fk,store);
    await a.run('_siAxEnsureHistory()');
    const q=fk.st.queries[0]||[];
    o['cold read: ONE query, newest first, limit 150, no where']=fk.st.queries.length===1&&q.some(c=>c.t==='ob'&&c.f==='date'&&c.d==='desc')&&q.some(c=>c.t==='lim'&&c.n===150)&&!q.some(c=>c.t==='where');
    o['cold read: all 40 documents read, history ok, 40 days']=fk.st.reads.shopify_inventory_snapshots===40&&a.run('_siHistState')==='ok'&&a.run('_siHist.dates.length')===40&&a.run('_siHistLast.warm')===false;
    const c=store[KEY]?JSON.parse(store[KEY]):null;
    o['cold read: only FINAL days are cached (up to two days ago: 38 of 40), never today or yesterday']=!!c&&c.folds.length===38&&c.folds.every(f=>f.date<=dayShift(T,2))&&c.v===1&&typeof c.full==='number';
    coldH=ser(a.run('_siHist'));
    o['cold read: the history equals the OLD build of the same documents']=coldH===a.run('JSON.stringify(_oldBuild('+J(snaps40)+'),(k,v)=>v instanceof Map?{__map:[...v]}:v)');
  }

  // ── 3. warm read ──
  const coldStore=(()=>{const s={};const a=app(src,fake(snaps40),s);a.run('_siAxEnsureHistory()');return s;})();
  await flush();
  {
    const store=Object.assign({},coldStore),fk=fake(snaps40),a=app(src,fk,store);
    await a.run('_siAxEnsureHistory()');
    const q=fk.st.queries[0]||[],w=q.find(c=>c.t==='where');
    o['warm read: the query asks only for days after the newest cached one (date > two days ago)']=!!w&&w.f==='date'&&w.op==='>'&&w.v===dayShift(T,2);
    o['warm read: 2 documents read instead of 40 (yesterday and today)']=fk.st.reads.shopify_inventory_snapshots===2&&a.run('_siHistLast.warm')===true&&a.run('_siHistLast.read')===2;
    o['warm read: the history is IDENTICAL to the full read (40 days, every number)']=ser(a.run('_siHist'))===coldH;
    // cache several days behind: reads exactly the missing days
    const c=JSON.parse(coldStore[KEY]);c.folds=c.folds.filter(f=>f.date<=dayShift(T,5));
    const s2={};s2[KEY]=J(c);const fk2=fake(snaps40),a2=app(src,fk2,s2);
    await a2.run('_siAxEnsureHistory()');
    o['warm read, cache 5 days behind: reads the 5 newer days (T-4..T) and equals the full read']=fk2.st.reads.shopify_inventory_snapshots===5&&ser(a2.run('_siHist'))===coldH;
    const w2=JSON.parse(s2[KEY]);
    o['the cache is extended with the newly final days, and its full-read time is kept (not reset by an incremental read)']=w2.folds.length===38&&w2.full===c.full;
  }

  // ── 4. the cache is ignored (a full read) when it cannot be trusted ──
  {
    const bad={};
    const base=JSON.parse(coldStore[KEY]);
    bad['another format version']=J(Object.assign({},base,{v:2}));
    bad['older than 7 days since the last FULL read']=J(Object.assign({},base,{full:Date.now()-8*86400000}));
    bad['not JSON']='{oops';
    bad['no folds']=J(Object.assign({},base,{folds:[]}));
    bad['a fold with a missing field']=J(Object.assign({},base,{folds:base.folds.map((f,i)=>i===3?{date:f.date}:f)}));
    let all=true,names=[];
    for(const k in bad){
      const fk=fake(snaps40),a=app(src,fk,{[KEY]:bad[k]});
      await a.run('_siAxEnsureHistory()');
      const q=fk.st.queries[0]||[];
      const ok=!q.some(c=>c.t==='where')&&fk.st.reads.shopify_inventory_snapshots===40&&ser(a.run('_siHist'))===coldH;
      if(!ok){all=false;names.push(k);}
    }
    o['cache ignored for a wrong version, 7-day expiry, corrupt JSON, no folds, a malformed fold — each a FULL read with the same history']=all;
    {
      const fresh=JSON.parse(coldStore[KEY]);fresh.full=Date.now()-6*86400000;
      const fk=fake(snaps40),a=app(src,fk,{[KEY]:J(fresh)});await a.run('_siAxEnsureHistory()');
      o['a cache whose last full read was 6 days ago is still used (the 7-day limit)']=fk.st.reads.shopify_inventory_snapshots===2;
    }
    {
      const fk=fake(snaps40),store=Object.assign({},coldStore),a=app(src,fk,store);
      await a.run('_siAxEnsureHistory(true)');
      const q=fk.st.queries[0]||[];
      o['force (Retry) bypasses the cache: a full read, and the cache is rewritten with a fresh full-read time']=!q.some(c=>c.t==='where')&&fk.st.reads.shopify_inventory_snapshots===40&&JSON.parse(store[KEY]).full>=JSON.parse(coldStore[KEY]).full&&JSON.parse(store[KEY]).folds.length===38;
    }
    {
      const fk=fake(snaps40),a=app(src,fk,{__throw:1});
      await a.run('_siAxEnsureHistory()');
      o['no usable localStorage: still a correct full read, every visit (the old behaviour)']=a.run('_siHistState')==='ok'&&fk.st.reads.shopify_inventory_snapshots===40&&ser(a.run('_siHist'))===coldH;
    }
  }

  // ── 5. the 150-day bound is kept ──
  {
    const many=Array.from({length:152},(_,i)=>{const d=dayShift(T,151-i);return{date:d,snapshot_at:d+'T17:00:00Z',items:{AA:{sku:'AA-M',available:i%9+1}}};});
    const fk=fake(many),s={},a=app(src,fk,s);await a.run('_siAxEnsureHistory()');
    const cold=ser(a.run('_siHist'));
    o['cold read of 152 stored days keeps the newest 150']=a.run('_siHist.dates.length')===150&&a.run('_siHist.to')===T&&a.run('_siHist.from')===dayShift(T,149);
    const fk2=fake(many),b=app(src,fk2,Object.assign({},s));await b.run('_siAxEnsureHistory()');
    o['warm read of the same store: still exactly the newest 150, identical history']=b.run('_siHist.dates.length')===150&&ser(b.run('_siHist'))===cold&&fk2.st.reads.shopify_inventory_snapshots===2;
    // cache already holds 150 final days (T-151..T-2) and 2 newer days exist: 152 folds meet, the newest 150 are kept
    const seed=many.filter(d=>d.date<=dayShift(T,2));
    const s3={[KEY]:J({v:1,full:Date.now(),folds:seed.map(d=>{const a3=app(src,fake([]),{});return a3.run('_siAxFoldDoc('+J(d)+')');})})};
    const fk4=fake(many),d4=app(src,fk4,s3);await d4.run('_siAxEnsureHistory()');
    o['150 cached days + 2 newer: the oldest is dropped, newest 150 kept, same as a full read']=seed.length===150&&d4.run('_siHist.dates.length')===150&&d4.run('_siHist.from')===dayShift(T,149)&&ser(d4.run('_siHist'))===cold;
    // a re-read day replaces its cached copy (the fake ignores the where so the days overlap)
    const dd=snaps40[10].date;
    const seed2={[KEY]:J({v:1,full:Date.now(),folds:[{date:dd,sms:null,n:1,loc:null,sums:[['ZZ',99]],neg:[]},{date:dayShift(T,50),sms:null,n:1,loc:null,sums:[['ZZ',1]],neg:[]}]})};
    const fk5=fake(snaps40,{ignoreWhere:true}),e5=app(src,fk5,seed2);
    const got=(await e5.run('_siAxReadFolds(false)')).folds.filter(f=>f.date===dd);
    o['a day read again replaces its cached copy (the fresh sums, not the cached ZZ 99)']=got.length===1&&got[0].sums.every(x=>x[0]!=='ZZ')&&got[0].sums.length===2;
  }

  // ── 6. consumers: every figure identical, pending before landing, correct after ──
  {
    // one article, sold 3 a day over 30 days, a stock-out in the middle (snapshot stock 0 for 6 days)
    const pk=dayShift(T,29);
    const days=Array.from({length:35},(_,i)=>dayShift(T,34-i));
    const snaps=days.map((d,i)=>({date:d,snapshot_at:d+'T17:00:00Z',items:{a:{sku:'RR-M',available:i>=15&&i<21?0:40+i},b:{sku:'SS-M',available:30}}}));
    const prods=[{_id:'RR-M',sku:'RR-M',product_title:'Art RR',color:'Blue',size:'M',product_type:'Tees',status:'active',published_at:'2025-01-01T10:00:00+05:00'},{_id:'SS-M',sku:'SS-M',product_title:'Art SS',color:'Blue',size:'M',product_type:'Tees',status:'active',published_at:'2025-01-01T10:00:00+05:00'}];
    const items=days.map(d=>({sku:'RR-M',quantity:3,price:1000,order_created_at:d+'T12:00:00+05:00',financial_status:'paid'}));
    items.push({sku:'SS-M',quantity:1,price:500,order_created_at:days[0]+'T12:00:00+05:00',financial_status:'paid'});
    const fk=fake(snaps,{cols:{}}),store={},a=app(src,fk,store),B=c=>a.run(c);
    B('_siProducts='+J(prods)+';_siLineItems='+J(items)+';_siOrders=[];_siWeeklyCloses=[];_siSnapshot='+J(snaps[34])+';_siPrevSnapshot='+J(snaps[27])+';_siAxCache=null;_siNaMemo=null;_siLoaded=true;_siSection="overview"');
    B('_siHistState="idle";_siHist=null');
    const tilesPending=B('_siOverview(_siComputeMetrics())');
    o['pending: the Overview says "Stock history: loading…" and the two counts are … (never 0)']=/Stock history: loading…/.test(tilesPending)&&/<div class="num">…<\/div>/.test(tilesPending)&&!/si-na-tile hot/.test(tilesPending)&&!/class="num">0</.test(tilesPending.slice(tilesPending.indexOf('si-na-tiles'),tilesPending.indexOf('si-na-tiles')+900));
    o['pending: the tab pill is absent (no count is invented) and the Explorer figures are —']=B('_siNaBadge()')===null&&B('_siAxStats(_siAxIndex().map.get("RR")).inRate')===null;
    // landed through the real read (cold), then compare EVERY consumer with the OLD-built history
    await B('_siAxEnsureHistory()');
    const snap=()=>B(`JSON.stringify((()=>{const idx=_siAxIndex();return idx.list.map(x=>{const m=_siAxStats(x);return [x.code,m.inRate,m.inDays,m.outDays,m.measured,m.perInDay,m.paceHead,m.cover,m.st&&m.st.value,_siAxClassify(x).cls];});})())+'|'+JSON.stringify(_siNaState().counts)+'|'+_siNaBadge()+'|'+JSON.stringify(_siAxTimeline(_siAxIndex().map.get('RR'),_siHist,{from:_siAxIndex().cov,to:_siPktDate(0)}).days.map(d=>[d.state,d.sold,d.stock]))+'|'+JSON.stringify(_siAxPf())`);
    const landed=snap();
    B('_siHist=_oldBuild('+J(snaps)+');_siAxCache=null;_siNaMemo=null;_siPfMemo=null');
    const ref=snap();
    o['landed: in-stock rate, stock-out days, units per in-stock day, pace, cover, sell-through, class, timeline days, Needs Attention counts, pill and Portfolio exposure are IDENTICAL to the old build']=landed===ref&&landed.length>800;
    o['landed: the stock-out is really seen (5 out days for RR, in-stock rate < 1) so the comparison is not vacuous']=B('_siAxStats(_siAxIndex().map.get("RR")).outDays')===5&&B('_siAxStats(_siAxIndex().map.get("RR")).inRate')<1;
    B('_siHistState="ok"');
    const tilesLanded=B('_siOverview(_siComputeMetrics())');
    o['landed: the strip is gone and the tiles carry real counts']=!/Stock history: loading/.test(tilesLanded)&&!/<div class="num">…<\/div>/.test(tilesLanded)&&!/si-hist-pend/.test(tilesLanded);
  }

  // ── 7. failure keeps Retry, and Retry is a FULL read ──
  {
    const fk=fake(snaps40,{failSnap:1}),store=Object.assign({},coldStore),a=app(src,fk,store),B=c=>a.run(c);
    B('_siProducts=[];_siLineItems=[];_siOrders=[];_siWeeklyCloses=[];_siSnapshot={date:"'+T+'",items:{}};_siAxCache=null;_siNaMemo=null;_siLoaded=true;_siSection="overview"');
    const before=store[KEY];
    await B('_siAxEnsureHistory()');
    const html=B('_siOverview(_siComputeMetrics())');
    o['failed read: state error, a strip with the reason and a Retry button, the cache untouched']=B('_siHistState')==='error'&&/si-hist-pend err/.test(html)&&/_siHistRetry/.test(html)&&/snap read refused/.test(html)&&store[KEY]===before;
    B('window._siHistRetry()');await flush();
    const q=fk.st.queries[fk.st.queries.length-1]||[];
    o['Retry: a full read (no where), history ok, strip gone']=B('_siHistState')==='ok'&&!q.some(c=>c.t==='where')&&B('_siHist.dates.length')===40&&!/si-hist-pend/.test(B('_siOverview(_siComputeMetrics())'));
  }

  // ── 8. when the read starts ──
  {
    const mkCols=()=>({shopify_products:[{sku:'AA-S'}],shopify_orders:[],shopify_line_items:[{sku:'AA-S',quantity:1,order_created_at:T+'T10:00:00+05:00'}],shopify_weekly_closes:[]}); // an empty catalog or line-item read now fails the stage (6 Oct 2026)
    // warm cache: the history read is issued while the line items are still being read
    let rel;const hold=new Promise(r=>{rel=r;});
    const fk=fake(snaps40,{cols:mkCols(),hold:{shopify_line_items:hold},today:T}),a=app(src,fk,Object.assign({},coldStore));
    const p=a.run('loadShopifyData()');await flush();
    const iSnap=fk.st.log.indexOf('shopify_inventory_snapshots'),iLines=fk.st.log.indexOf('shopify_line_items');
    o['warm cache: the history read starts WITH the load, before the line items have returned']=iSnap>=0&&iLines>=0&&a.run('_siHistState')==='ok'&&a.run('_siLoaded')===false;
    rel();await p;
    o['warm cache: by the first paint the history is landed (no pending state), 2 documents read']=a.run('_siLoaded')===true&&a.run('_siHistState')==='ok'&&fk.st.reads.shopify_inventory_snapshots===2&&!/si-hist-pend/.test(a.run('renderShopifyDashboard()'));
    // cold: nothing is read until the page renders, so it does not compete with the line items
    const fk2=fake(snaps40,{cols:mkCols(),today:T}),b=app(src,fk2,{});
    await b.run('loadShopifyData()');
    o['cold cache: loading the page reads NO snapshot history (it starts after the first paint, as before)']=fk2.st.log.indexOf('shopify_inventory_snapshots')===-1&&b.run('_siHistState')==='idle';
    const first=b.run('renderShopifyDashboard()');
    o['cold cache: the first render shows "Stock history: loading…" and starts the read once']=/Stock history: loading…/.test(first)&&b.run('_siHistState')==='loading';
    await b.run('_siHistPromise');
    o['cold cache: it lands and repaints, 40 documents read, and the line-item stage count is not changed (history stays outside the percentage)']=b.run('_siHistState')==='ok'&&fk2.st.reads.shopify_inventory_snapshots===40&&b.run('_SI_STAGES.map(s=>s.id).join()')==='products,orders,lines,closes,snap,meta,build'&&b.run('_SI_STAGES.reduce((t,s)=>t+s.w,0)')===100;
  }
  return o;
}

module.exports=async function(){
  const s=suite('shopify-history-cost');
  s.section('the folded history, the cache and the pending states');
  const base=await checks(SRC);
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  const names=Object.keys(base);
  const brk=async(label,from,to,failing)=>{
    if(SRC.indexOf(from)<0){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.replace(from,to));}catch(e){r=null;}
    // a break may crash a check instead of failing it: a missing result counts as failed
    const failed=names.filter(k=>!r||r[k]!==true);
    const hit=failing.filter(f=>failed.some(k=>k.indexOf(f)===0));
    s.ok('break "'+label+'" fails "'+failing.join('" and "')+'"',hit.length===failing.length,hit.length===failing.length?undefined:'failed: '+failed.slice(0,4).join(' | '));
  };
  await brk('oversold not clamped','sums.set(code,(sums.get(code)||0)+Math.max(0,it.available||0))','sums.set(code,(sums.get(code)||0)+(it.available||0))',['hand fixture: AA 8 then 9','stress fixture (60 days']);
  await brk('re-keying ignored','const key=_siAxSnapKeyOf(f.date,f.sms);','const key=String(f.date);',['stress fixture (60 days']);
  await brk('later snapshot wins','(f.sms||0)<(prev.sms||0)','(f.sms||0)>(prev.sms||0)',['stress fixture (60 days']);
  await brk('median share dropped','if(med&&f.n<med*_SI_HIST_MIN_SHARE){dropped.push(f.date);return;}','',['hand fixture: dates, dropped']);
  await brk('today and yesterday cached','const lim=_siPktDate(-_SI_HIST_FINAL_LAG);','const lim=_siPktDate(1);',['cold read: only FINAL days are cached']);
  await brk('warm read asks for everything','const q=cache?query(col,where(\'date\',\'>\',last),orderBy(\'date\',\'desc\'),limit(_SI_HIST_MAX)):','const q=cache?query(col,orderBy(\'date\',\'desc\'),limit(_SI_HIST_MAX)):',['warm read: the query asks only for days after']);
  await brk('cache never expires','||!(Date.now()-c.full<_SI_HIST_CACHE_MAX_DAYS*86400000)','',['cache ignored for a wrong version']);
  await brk('cache version ignored','c.v!==_SI_HIST_CACHE_VER||','',['cache ignored for a wrong version']);
  await brk('Retry reuses the cache','const cache=force?null:_siHistCacheRead();','const cache=_siHistCacheRead();',['force (Retry) bypasses the cache','Retry: a full read']);
  await brk('no trim to 150','all=all.slice(0,_SI_HIST_MAX);','',['150 cached days + 2 newer']);
  await brk('cached copy wins over a re-read day','cache.folds.forEach(f=>m.set(String(f.date),f));fresh.forEach(f=>m.set(String(f.date),f));','fresh.forEach(f=>m.set(String(f.date),f));cache.folds.forEach(f=>m.set(String(f.date),f));',['a day read again replaces its cached copy']);
  await brk('cache full-read time reset by an incremental read','return{folds:all,fullAt:cache?cache.full:Date.now()','return{folds:all,fullAt:Date.now()',['the cache is extended with the newly final days']);
  await brk('no early start with a warm cache','if(_siHistState===\'idle\'&&typeof getDocs===\'function\'&&_siHistCacheRead())_siAxEnsureHistory();','',['warm cache: the history read starts WITH the load']);
  await brk('early start even when cold','&&_siHistCacheRead())_siAxEnsureHistory();','&&true)_siAxEnsureHistory();',['cold cache: loading the page reads NO snapshot history']);
  await brk('pending strip removed','return\'<div class="si-hist-pend" id="si-hist-pend" role="status">Stock history: loading…','return\'<div class="si-hist-pend" id="si-hist-pend" role="status">',['pending: the Overview says']);
  await brk('failed strip loses its Retry','<button type="button" class="si-ax-btn" onclick="window._siHistRetry()">Retry</button>','',['failed read: state error']);
  await brk('cache kept on a failed read','_siHistState=\'error\';_siHistError=','_siHistState=\'error\';_siHistCacheWrite([],0);_siHistError=',['failed read: state error']);
  // the source-level rules
  const css=fs.readFileSync(path.join(__dirname,'../css/main.css'),'utf8');
  s.section('source rules');
  s.ok('the cap constant is still 150 (not lowered: a lower cap changes figures)',/const _SI_HIST_MAX=150;/.test(SRC));
  s.ok('the history stays out of the load stages and the percentage',!/id:'hist/.test(SRC.slice(SRC.indexOf('const _SI_STAGES'),SRC.indexOf('const _SI_LOAD_SHOW_MS'))));
  s.ok('CSS: the pending line uses tokens only',(()=>{const m=css.match(/\.si-hist-pend[^{]*\{[^}]*\}/g)||[];return m.length>=3&&m.every(x=>!/#[0-9a-fA-F]{3,8}\b/.test(x));})());
  return s;
};

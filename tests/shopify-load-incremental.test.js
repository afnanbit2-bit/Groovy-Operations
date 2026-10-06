/* Inventory Intel > line items: full re-read at 00:00 and 12:00 PKT, incremental in between (Oct 2026).
   Hand-computed. Boundary epochs (PKT = UTC+5, no DST): 2026-10-06 12:00 PKT = 2026-10-06T07:00:00Z; 00:00 PKT on 10-07 = 2026-10-06T19:00:00Z.
   Fixture (T = today PKT, real clock): window = 90 days. 200 filler lines AA-S qty 1 at T-10..T-89 (generated), plus
   1_11 AA-S qty 2 @T-1 (paid), 2_12 AA-M qty 3 @T-30, 9_19 AA-S qty 6 @T-120 (older, phase 2 only).
   Full window read = 202 documents. The incremental read starts 72 h before the previous read, floored to a PKT day.
   After the first load, the "server" gets: line 1_11 refunded, a NEW line 8_81 AA-M qty 5 @T-0. Incremental = lines with
   order_created_at >= start, i.e. 1_11, 8_81 (the fillers start at T-10) = 2 documents, against 202. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
const dayShift=(T,k)=>new Date(new Date(T+'T00:00:00Z').getTime()-k*86400000).toISOString().slice(0,10);
const Z=s=>Date.parse(s);

function fake(T,o){
  o=o||{};
  const st={reads:0,queries:[],meta:o.meta||null};
  const D=k=>dayShift(T,k)+'T10:00:00+05:00';
  const lines=[
    {order_id:1,line_item_id:11,sku:'AA-S',quantity:2,price:100,order_created_at:D(1),financial_status:'paid'},
    {order_id:2,line_item_id:12,sku:'AA-M',quantity:3,price:100,order_created_at:D(30),financial_status:'paid'},
    {order_id:9,line_item_id:19,sku:'AA-S',quantity:6,price:100,order_created_at:D(120),financial_status:'paid'}];
  for(let i=0;i<200;i++)lines.push({order_id:100+i,line_item_id:200+i,sku:'AA-S',quantity:1,price:100,order_created_at:D(10+Math.floor(i*79/199)),financial_status:'paid'});
  const prods=[
    {sku:'AA-S',product_title:'Alpha',color:'Red',size:'S',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v1'},
    {sku:'AA-M',product_title:'Alpha',color:'Red',size:'M',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v2'}];
  const snap={date:T,snapshot_at:new Date().toISOString(),items:{a:{sku:'AA-S',variant_id:'v1',available:5},b:{sku:'AA-M',variant_id:'v2',available:3}}};
  const g={
    collection:(db,name)=>({__c:name,cons:[]}),
    query:(c,...cons)=>({__c:c.__c,cons}),
    where:(f,op,v)=>({t:'where',f,op,v}),orderBy:(f,d)=>({t:'ob',f,d}),limit:n=>({t:'lim',n}),
    doc:(db,c,id)=>({c,id}),
    getDoc:async r=>{
      if(r.c==='shopify_inventory_snapshots'&&r.id===T)return{exists:()=>true,data:()=>snap};
      if(r.c==='shopify_sync_meta'&&r.id==='order_sync'&&st.meta)return{exists:()=>true,data:()=>({last_success_at:st.meta})};
      return{exists:()=>false};
    },
    getDocs:async q=>{
      const name=q.__c;
      let rows=name==='shopify_line_items'?st.lines:name==='shopify_products'?prods.map(p=>Object.assign({},p)):[];
      if(name==='shopify_line_items'){
        const w=q.cons.filter(c=>c.t==='where');
        st.queries.push(w.map(c=>c.f+c.op+c.v));
        w.forEach(c=>{if(c.op==='>=')rows=rows.filter(x=>String(x.order_created_at)>=c.v);if(c.op==='<')rows=rows.filter(x=>String(x.order_created_at)<c.v);});
        st.reads+=rows.length;
      }
      return{forEach:f=>rows.forEach((x,i)=>f({data:()=>Object.assign({},x),id:name==='shopify_line_items'?x.order_id+'_'+x.line_item_id:String(i)}))};
    }
  };
  st.lines=lines;st.D=D;
  return{st,g};
}
function app(src,fk,extra){
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',
    globals:Object.assign({localStorage:{getItem:()=>null,setItem(){},removeItem(){}}},fk.g,extra||{})});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
async function checks(src){
  const o={};
  const T=app(src,fake('2000-01-01')).run('_siPktDate(0)');
  const open=async(extra)=>{const fk=fake(T),a=app(src,fk,extra);await a.run('loadShopifyData()');return{fk,a,B:c=>a.run(c)};};
  const mutate=fk=>{fk.st.lines.find(l=>l.order_id===1).financial_status='refunded';fk.st.lines.push({order_id:8,line_item_id:81,sku:'AA-M',quantity:5,price:100,order_created_at:fk.st.D(0),financial_status:'paid'});};

  // 1. the boundary helper (pure)
  {
    const {B}=await open();
    const bd=ms=>B('siFullBoundary('+ms+')');
    o['boundary 23:59 PKT (18:59Z) is 12:00 PKT the same day (07:00Z)']=bd(Z('2026-10-06T18:59:00Z'))===Z('2026-10-06T07:00:00Z');
    o['boundary 00:00 PKT (19:00Z) is itself']=bd(Z('2026-10-06T19:00:00Z'))===Z('2026-10-06T19:00:00Z');
    o['boundary 11:59 PKT (06:59Z) is 00:00 PKT the same day (previous 19:00Z)']=bd(Z('2026-10-07T06:59:00Z'))===Z('2026-10-06T19:00:00Z');
    o['boundary 12:00 PKT (07:00Z) is itself']=bd(Z('2026-10-07T07:00:00Z'))===Z('2026-10-07T07:00:00Z');
    o['boundary has no DST: 12:00 PKT is 07:00Z in January and in July too']=bd(Z('2026-01-15T10:00:00Z'))===Z('2026-01-15T07:00:00Z')&&bd(Z('2026-07-15T10:00:00Z'))===Z('2026-07-15T07:00:00Z');
    const due=(l,n,f)=>B('siLinesFullDue('+l+','+n+','+(f?'true':'false')+')');
    o['due: no earlier full read is due']=due('null',Z('2026-10-06T10:00:00Z'))===true;
    o['due: last full 11:59 PKT, now 12:00 PKT is due']=due(Z('2026-10-07T06:59:00Z'),Z('2026-10-07T07:00:00Z'))===true;
    o['due: last full exactly at the boundary, now 23:59 PKT is NOT due']=due(Z('2026-10-06T07:00:00Z'),Z('2026-10-06T18:59:00Z'))===false;
    o['due: last full 23:59 PKT, now 00:00 PKT next day is due']=due(Z('2026-10-06T18:59:00Z'),Z('2026-10-06T19:00:00Z'))===true;
    o['due: forced is due even a minute after a full read']=due(Z('2026-10-06T10:00:00Z'),Z('2026-10-06T10:01:00Z'),true)===true;
    o['incStart: last read 14:00 PKT on 10-06 (09:00Z) starts at PKT day 2026-10-03 (72 h back = 14:00 PKT 10-03)']=B('siLinesIncStart('+Z('2026-10-06T09:00:00Z')+',"")')==='2026-10-03';
    o['incStart: never below the window cut (floor 2026-10-05 wins)']=B('siLinesIncStart('+Z('2026-10-06T09:00:00Z')+',"2026-10-05")')==='2026-10-05';
    o['incStart: no previous read gives null (a full read is needed)']=B('siLinesIncStart(null,"")')===null;
    const m=JSON.parse(B('JSON.stringify(siMergeLines([{_id:"a",v:1},{_id:"b",v:1}],[{_id:"b",v:2},{_id:"c",v:2},{_id:"c",v:3}]))'));
    o['merge: same id replaced in place, new appended, a later duplicate wins, no duplicates: a1 b2 c3']=m.map(x=>x._id+x.v).join(' ')==='a1 b2 c3';
    o['merge returns a new array and leaves the old one untouched']=B('(function(){const e=[{_id:"a",v:1}];const r=siMergeLines(e,[{_id:"a",v:9}]);return r!==e&&e[0].v===1&&r[0].v===9;})()')===true;
  }
  // 2. full first, then incremental
  {
    const {fk,B}=await open();
    const win=dayShift(T,90);
    o['first load is a full window read: 202 documents (the T-120 line is phase 2), mode full, a full-read time recorded']=fk.st.reads===202&&B('_siLineItems.length')===202&&B('_siLinesMode')==='full'&&B('_siLinesFullAt')>0&&fk.st.queries.length===6&&fk.st.queries[0].join().indexOf('order_created_at>='+win)===0; // SUPERSEDED single-range assumption: the full window is read as 6 date ranges (ii-fix-loading)
    mutate(fk);
    const before=B('_siLineItems'),r0=fk.st.reads;
    const idBefore=B('(globalThis.__arr=_siLineItems,0)');
    // not due: pretend the last full read is exactly at the latest boundary
    B('_siLinesFullAt=siFullBoundary(Date.now())');
    await B('_siRunners.lines(true)');
    const expStart=new Date(Date.now()-72*3600000+5*3600000).toISOString().slice(0,10);
    const q=fk.st.queries[fk.st.queries.length-1];
    o['incremental: ONE range order_created_at >= (previous read - 72 h, PKT day), not the 90-day cut']=fk.st.queries.length===7&&q.join()==='order_created_at>='+expStart&&expStart>win;
    o['incremental reads 2 documents, not 202 (read-count assertion)']=fk.st.reads-r0===2;
    o['incremental merge: 203 lines (202 + the new one), no duplicate ids']=B('_siLineItems.length')===203&&B('new Set(_siLineItems.map(l=>l._id)).size')===203;
    o['incremental merge: the existing line 1_11 now says refunded (newest wins), older filler lines are kept']=B('_siLineItems.find(l=>l._id==="1_11").financial_status')==='refunded'&&B('_siLineItems.filter(l=>l.order_created_at<"'+dayShift(T,9)+'").length')>=150;
    o['incremental: the array identity changed (caches keyed on it rebuild) and the mode says incremental']=B('globalThis.__arr!==_siLineItems')===true&&B('_siLinesMode')==='incremental'&&B('_siLinesIncN')===2;
    o['incremental does not touch the full-read time']=B('_siLinesFullAt')===B('siFullBoundary(Date.now())');
    // single source: the index excludes the refunded line and counts the new one
    const idx=B('(function(){const x=_siAxIndex();return JSON.stringify({n:_siAxCache.n,same:_siAxCache.li===_siLineItems,q:x.quality.lineItems.refunded});})()');
    const j=JSON.parse(idx);
    o['the exclusion rules still run through _siAxIndex: the refunded line is counted as left out, the cache is for the merged array']=j.n===203&&j.same===true&&j.q===1;
    const aaM=B('_siAxIndex().list.find(a=>a.code==="AA")');
    o['_siAxIndex sees the merged data: 203 rows loaded, index rebuilt (cache built for 203 lines)']=B('_siAxCache.n')===203;
    // freshness card
    const html=B('_siFrHtml()');
    o['the freshness card says Last full refresh, that line items are incremental, and the honest limit']=/Last full refresh: /.test(html)&&/incremental/.test(html)&&/Later refunds and voids on older lines show at the next full refresh/.test(html)&&/id="si-fr-lines"/.test(html);
  }
  // 3. full due -> full read
  {
    const {fk,B}=await open();
    mutate(fk);
    B('_siLinesFullAt=siFullBoundary(Date.now())-1');
    const r0=fk.st.reads;
    await B('_siRunners.lines(true)');
    o['full due (last full before the boundary): the refresh re-reads the whole window (203 documents) and replaces it']=fk.st.reads-r0===203&&B('_siLineItems.length')===203&&B('_siLinesMode')==='full'&&B('_siLinesFullAt')>=B('siFullBoundary(Date.now())');
    o['the card then says this is the full read']=/this is the full read/.test(B('_siFrHtml()'));
  }
  // 4. loaded history survives an incremental refresh
  {
    const {fk,B}=await open();
    B('_siSection="articles";_siSub=""');B('_siRenderSection(_siComputeMetrics(),_siComputeSkuTable())');await flush();
    const had=B('_siLineItems.length')===203&&B('_siLinesScope')==='full';
    mutate(fk);
    B('_siLinesFullAt=siFullBoundary(Date.now())');
    const r0=fk.st.reads;
    await B('_siRunners.lines(true)');
    o['with the full history loaded, an incremental refresh keeps the older rows (scope full, 204 lines, the T-120 line still there) and reads 2']=had&&B('_siLinesScope')==='full'&&B('_siLineItems.length')===204&&!!B('_siLineItems.find(l=>l._id==="9_19")')&&fk.st.reads-r0===2;
  }
  // 5. returns refresh forces full
  {
    const fetchStub=async()=>({status:202,ok:true,json:async()=>({})});
    const {fk,B,a}=await open({fetch:fetchStub,auth:{currentUser:{getIdToken:async()=>'tok'}}});
    mutate(fk);
    B('_siLinesFullAt=siFullBoundary(Date.now())');
    await B('window._siRrRun()');
    o['pressing the returns refresh sets the force-full flag']=B('_siLinesForceFull')===true;
    const r0=fk.st.reads;
    await B('_siRunners.lines(true)');
    o['after the returns refresh the next line-item read is a FULL one (203 documents) and clears the flag']=fk.st.reads-r0===203&&B('_siLinesMode')==='full'&&B('_siLinesForceFull')===false;
  }
  // 6. manual Retry forces full
  {
    const {fk,B}=await open();
    B('_siLinesFullAt=siFullBoundary(Date.now())');
    B('_siLoad.state.lines="failed";_siLoad.fails.lines={msg:"x",cls:"other",code:"",at:0};_siRetryCtl.running.lines=false');
    B('window._siRetryStage("lines")');
    o['a manual Retry of the line-item stage sets the force-full flag']=B('_siLinesForceFull')===true;
    await flush();
    o['...and the read that follows is full, which clears it']=B('_siLinesMode')==='full'&&B('_siLinesForceFull')===false;
  }
  // 7. end to end through siRefresh: the order sync moved
  {
    const fk=fake(T,{meta:'2026-01-01T00:00:00Z'}),a=app(src,fk);
    await a.run('loadShopifyData()');
    mutate(fk);fk.st.meta='2026-01-01T04:00:00Z';
    a.run('_siLinesFullAt=siFullBoundary(Date.now())');
    const r0=fk.st.reads;
    const res=await a.run('siRefresh()');
    o['end to end: siRefresh after the order sync moved reads the lines incrementally (2 documents) and merges them']=(res.read||[]).indexOf('lines')>=0&&fk.st.reads-r0===2&&a.run('_siLineItems.length')===203;
  }
  return o;
}
module.exports=async function(){
  const s=suite('shopify-load-incremental');
  s.section('full at 00:00 / 12:00 PKT, incremental in between');
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
  await brk('boundary every 24 h',"_SI_HALF_DAY_MS=12*3600000","_SI_HALF_DAY_MS=24*3600000",['boundary 23:59 PKT','boundary 12:00 PKT']);
  await brk('due ignores the boundary',"return lastFullMs<siFullBoundary(nowMs);","return false;",['due: last full 11:59 PKT','full due (last full before the boundary)']);
  await brk('forced is ignored',"if(force||lastFullMs==null","if(lastFullMs==null",['due: forced is due','after the returns refresh the next line-item read']);
  await brk('never incremental',"if(fresh&&_siLinesCanIncr()&&","if(false&&",['incremental: ONE range','incremental reads 2 documents']);
  await brk('incremental reads the whole window',"where('order_created_at','>=',start)","where('order_created_at','>=',_siLinesCut)",['incremental: ONE range','incremental reads 2 documents']);
  await brk('merge does not replace',"out[at.get(o._id)]=o;","/*kept*/",['merge: same id replaced','incremental merge: the existing line 1_11']);
  await brk('merge duplicates',"if(o&&o._id!=null&&at.has(o._id))out[at.get(o._id)]=o;\n    else{","if(false)out[0]=o;\n    else{",['merge: same id replaced','incremental merge: 203 lines']);
  await brk('incremental drops older rows',"_siLineItems=siMergeLines(_siLineItems,a); // a NEW array: every cache","_siLineItems=a; // a NEW array: every cache",['incremental merge: 203 lines','with the full history loaded']);
  await brk('start is not floored at the cut',"return floorDay&&floorDay>d?floorDay:d;","return d;",['incStart: never below the window cut']);
  await brk('returns refresh does not force',"  _siLinesForceFull=true; // pressing the returns refresh","  // pressing the returns refresh",['pressing the returns refresh sets the force-full flag']);
  await brk('manual Retry does not force',"if(id==='lines')_siLinesForceFull=true;","if(false)_siLinesForceFull=true;",['a manual Retry of the line-item stage']);
  await brk('the card says nothing',"const t=siLinesFreshText(_siLinesFullAt,_siLinesMode,_siLinesIncN,_siLinesIncFrom);return t?","const t='';return t?",['the freshness card says Last full refresh']);
  await brk('a full read does not record its time',"_siLinesFullAt=t0;_siLinesLastReadAt=t0;","_siLinesLastReadAt=t0;",['first load is a full window read']);
  s.section('source rules');
  s.ok('Firestore rules and the sync functions are untouched by this change (the incremental read uses the same single-field order_created_at range)',!/where\('synced_at'|where\('status_synced_at'/.test(SRC));
  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   Number-burn, the four remaining flows (Oct 2026)
     Fabric In (FAB-)  ·  Returns (RET-)  ·  Stock transfer (STN-)  ·  B-stock carton (CTN-)

   The bug (already fixed for gate passes and POs): each flow asked
   getNextId() for its number FIRST — its own committed transaction — and wrote
   its document afterwards, so a refused / offline / failed write spent a number
   for nothing. Now the counter read, the id-is-free check and the document(s)
   commit in ONE transaction (createWithNextId / mintDoc), floored at the highest
   number already on file.

   What this guards, each by DRIVING the real entry point
   (window.submitFabricIn, submitReturn, bookTransfer, bstockAssign):
     1 GOLDEN   the documents a good run writes are byte-for-byte what the old code
                wrote (tests/fixtures/number-burn-golden.json was captured from the
                UNCHANGED code before this change; NB_WRITE_GOLDEN=1 rewrites it)
     2 SUCCESS  one number, counter +1, in the same commit as the document(s)
     3 FAILED   a refused commit, a lost connection, a rules refusal on the second
     / OFFLINE  document: counters/main byte-identical, nothing half-written, and
                the retry gets the number the failure did not spend
     4 TAKEN    a counter that lags behind a document that exists never overwrites
                it (floor from the loaded list / the server list / the in-
                transaction exists check)
     5 CACHE    a list that cannot be trusted (cache-only read) refuses BEFORE any
                write and says to reload

   The Firestore stand-in is a real transaction (writes buffered, applied only if
   the callback resolves). Plain node: it proves the LOGIC, never real Firestore.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite}=require('./harness');
const {installMint}=require('./mint-helper');

const GOLDEN=path.join(__dirname,'fixtures','number-burn-golden.json');
const FIXED=Date.UTC(2026,9,11,9,0,0);
class FixedDate extends Date{
  constructor(...a){if(a.length===0)super(FIXED);else super(...a);}
  static now(){return FIXED;}
}
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const J=x=>JSON.stringify(x);
const _esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ── an in-memory Firestore with real transaction semantics ─────────────── */
function makeFs(){
  const store=new Map();
  const st={tx:0,plain:[],failCommit:null,offline:false,rejectPaths:[],cacheOnly:false};
  let auto=0;
  const ref=p=>({path:p,id:p.split('/').pop()});
  const refuse=ws=>{const bad=ws.find(w=>st.rejectPaths.indexOf(w.ref.path)>-1);if(bad)throw new Error('Missing or insufficient permissions ('+bad.ref.path+')');};
  const apply=b=>{
    const p=b.ref.path;
    if(b.op==='delete'){store.delete(p);return;}
    if(b.op==='update'||(b.op==='set'&&b.merge))store.set(p,Object.assign({},store.get(p)||{},b.data));
    else store.set(p,b.data);
  };
  const api={
    db:{__db:1},
    collection:(_db,name)=>({__coll:name}),
    doc:(a,...segs)=>(a&&a.__coll)?ref(a.__coll+'/auto'+(++auto)):ref(segs.join('/')),
    query:c=>c,orderBy:()=>({}),
    runTransaction:async(_db,fn)=>{
      st.tx++;
      if(st.offline)throw new Error('Failed to get document because the client is offline.');
      const buf=[];let wrote=false;
      const tx={
        get:async r=>{
          if(wrote)throw new Error('Firestore transactions require all reads to be executed before all writes.');
          return{exists:()=>store.has(r.path),data:()=>clone(store.get(r.path))};
        },
        set(r,data,opts){wrote=true;buf.push({op:'set',ref:r,data:clone(data),merge:!!(opts&&opts.merge)});return tx;},
        update(r,data){
          wrote=true;buf.push({op:'update',ref:r,data:clone(data),needs:true});return tx;
        },
        delete(r){wrote=true;buf.push({op:'delete',ref:r});return tx;}
      };
      await fn(tx);
      if(st.failCommit){const m=st.failCommit;st.failCommit=null;throw new Error(m);}   // nothing applied
      refuse(buf);                                                                          // nothing applied
      const missing=buf.find(w=>w.needs&&!store.has(w.ref.path));
      if(missing)throw new Error('No document to update: '+missing.ref.path);              // nothing applied
      buf.forEach(apply);
    },
    setDoc:async(r,data)=>{refuse([{ref:r}]);st.plain.push('set '+r.path);store.set(r.path,clone(data));},
    updateDoc:async(r,data)=>{refuse([{ref:r}]);st.plain.push('update '+r.path);if(!store.has(r.path))throw new Error('No document to update: '+r.path);store.set(r.path,Object.assign({},store.get(r.path),clone(data)));},
    deleteDoc:async r=>{store.delete(r.path);},
    getDocs:async c=>({metadata:{fromCache:st.cacheOnly||st.offline},docs:[...store.keys()].filter(k=>k.startsWith(c.__coll+'/')).map(k=>({id:k.split('/').pop(),data:()=>clone(store.get(k))}))})
  };
  const dump=()=>{const o={};[...store.keys()].sort().forEach(k=>{o[k]=clone(store.get(k));});return o;};
  return{store,st,api,dump,counters:()=>clone(store.get('counters/main')),keys:p=>[...store.keys()].filter(k=>k.startsWith(p))};
}

const SEED_COUNTERS={pos:3,gatepasses:5,bundles:2,fabricin:5,returns:11,stock_transfer:6,bstock_carton:2};

function boot(files,opts){
  opts=opts||{};
  const f=makeFs();
  f.store.set('counters/main',Object.assign({},SEED_COUNTERS,opts.counters||{}));
  const a=loadApp({files,globals:Object.assign({},f.api,{
    Date:FixedDate,_gpEsc:_esc,currentPage:'',
    allPasses:[],allFabricInventory:[],allFabricMovements:[],allReturns:[],allGPEditRequests:[],allFabricIn:[],allPOs:[],
    allBstockItems:undefined,
    console:{log:console.log,error:console.error,warn:()=>{},info:()=>{}},
    logActivity:async(act,detail)=>{a.state.activity.push({action:act,detail});}
  },opts.globals||{})});
  a.fs=f;
  installMint(a);
  a.run('loadData=async()=>{}');
  // The post-commit screen refresh touches a few DOM methods the harness stub lacks.
  const gebi=a.ctx.document.getElementById.bind(a.ctx.document);
  a.ctx.document.getElementById=id=>{const n=gebi(id);if(n&&!n.scrollIntoView)n.scrollIntoView=()=>{};return n;};
  return a;
}
const lastToast=a=>a.state.toasts[a.state.toasts.length-1]||'';
const counterOf=a=>a.fs.counters();
const snap=a=>J(a.fs.dump());

/* ═══ the four flows, each set up and driven the way a person does ═══════ */

// ── Fabric In ───────────────────────────────────────────────────────────
const FAB_FILES=['js/gatepass.js','js/fabric.js'];
function fabApp(opts){
  const a=boot(FAB_FILES,opts);
  a.el('fab-supplier').value='Gul Enterprises';a.el('fab-date').value='2026-10-11';a.el('fab-type').value='Jersey Heavy';
  a.el('fab-gsm').value='220';a.el('fab-color').value='Black';a.el('fab-notes').value='first lot';
  const rows=[{w:'10.5',qc:true},{w:'20',qc:false}].map(r=>({querySelector:s=>s==='.fab-roll-weight'?{value:r.w}:s==='.fab-roll-gsm'?{value:'220'}:s==='input[type=checkbox]'?{checked:r.qc}:null}));
  a.ctx.document.querySelectorAll=sel=>sel==='#fab-rolls-body .roll-row'?rows:[];
  return a;
}
const fabGo=a=>a.run('window.submitFabricIn()');

// ── Returns ─────────────────────────────────────────────────────────────
const PASS={id:'GP-004',ts:1,gpType:'garments',dest:'Vendor X',article:'Tee',totalUnits:100,expectReturn:true,date:'2026-10-01'};
function retApp(opts){
  opts=opts||{};
  const a=boot(['js/gatepass.js'],opts);
  a.fs.store.set('gatepasses/GP-004',clone(PASS));
  a.ctx.allPasses.push(clone(PASS));
  if(opts.returns)opts.returns.forEach(r=>{a.fs.store.set('returns/'+r.id,clone(r));a.ctx.allReturns.push(clone(r));});
  a.run('_gpRetSelGp="GP-004"');
  a.el('ret2-qty').value='40';a.el('ret2-date').value='2026-10-11';a.el('ret2-notes').value='first batch';
  return a;
}
const retGo=a=>a.run('window.submitReturn()');

// ── Stock transfer ──────────────────────────────────────────────────────
const PO_BASE={id:'PO-007',name:'Live In Pants',code:'GD007',qty:100,poStatus:'in_production',
  qcDispositions:[{size:'M',kind:'passed',qty:50},{size:'S',kind:'passed',qty:30}],
  stockTransfers:[{id:'STN-002-M',transferId:'STN-002',size:'M',qty:10,ts:'2026-10-01T00:00:00.000Z',by:'Faizan'}]};
function stnApp(opts){
  opts=opts||{};
  const a=boot(['js/pos.js','js/production.js'],opts);
  a.fs.store.set('pos/FB1',clone(PO_BASE));
  a.ctx.allPOs.push(Object.assign(clone(PO_BASE),{fbKey:'FB1'}));
  a.el('bc-in-M').value='20';a.el('bc-in-S').value='5';
  return a;
}
const stnGo=a=>a.run('window.bookTransfer("FB1")');

// ── B-stock carton ──────────────────────────────────────────────────────
const PO_BS=Object.assign({},PO_BASE,{qcDispositions:[{size:'M',kind:'bstock',qty:9}],stockTransfers:[]});
function ctnApp(opts){
  opts=opts||{};
  const a=boot(['js/pos.js','js/production.js'],opts);
  a.fs.store.set('pos/FB1',clone(PO_BS));
  a.ctx.allPOs.push(Object.assign(clone(PO_BS),{fbKey:'FB1'}));
  a.run('allBstockItems=[]');
  (opts.cartons||[]).forEach(c=>{a.fs.store.set('bstock_cartons/'+c.id,clone(c));});
  a.run('allBstockCartons='+J((opts.cartons||[]).map(c=>Object.assign({_id:c.id},c))));
  a.el('bs-qty-FB1-M').value='3';a.el('bs-carton-FB1-M').value=opts.carton||'__new__';
  return a;
}
const ctnGo=a=>a.run('window.bstockAssign("FB1","M")');

const FLOWS={
  'Fabric In':   {field:'fabricin',       col:'fabricin',       prefix:'FAB-',app:fabApp,go:fabGo,
                  lagFloor:{existing:{id:'FAB-009',fabCode:'OLD-01',ts:1,supplier:'x',rolls:[]}}},
  'Returns':     {field:'returns',        col:'returns',        prefix:'RET-',app:retApp,go:retGo},
  'Stock transfer':{field:'stock_transfer',col:'stock_transfers',prefix:'STN-',app:stnApp,go:stnGo},
  'B-stock carton':{field:'bstock_carton', col:'bstock_cartons', prefix:'CTN-',app:ctnApp,go:ctnGo}
};
const docsIn=(a,col)=>a.fs.keys(col+'/');

module.exports=async function(){
  const s=suite('number-burn');

  /* ═══ 1 — GOLDEN: the documents a good run writes did not change ═══════ */
  s.section('1 — golden: a good run writes byte-for-byte what the old code wrote');
  {
    const out={};
    for(const name of Object.keys(FLOWS)){
      const F=FLOWS[name];
      const a=F.app();
      await F.go(a);
      out[name]=a.fs.dump();
      s.ok(name+': the run completed without an error toast',!/^Error/.test(lastToast(a)),lastToast(a));
    }
    if(process.env.NB_WRITE_GOLDEN){
      fs.mkdirSync(path.dirname(GOLDEN),{recursive:true});
      fs.writeFileSync(GOLDEN,JSON.stringify(out,null,1)+'\n');
      console.log('    (golden written to '+GOLDEN+')');
    }
    const gold=JSON.parse(fs.readFileSync(GOLDEN,'utf8'));
    for(const name of Object.keys(FLOWS)){
      const g=gold[name],n=out[name];
      s.eq(name+': same set of documents',Object.keys(n).join(','),Object.keys(g).join(','));
      Object.keys(g).forEach(k=>{s.eq(name+': '+k+' is byte-identical to the old code\'s',J(n[k]),J(g[k]));});
    }
  }

  /* ═══ 2 — SUCCESS: one number, counter +1, same commit ════════════════ */
  s.section('2 — a good run mints exactly one number and moves the counter by one');
  for(const name of Object.keys(FLOWS)){
    const F=FLOWS[name];
    const a=F.app();
    const before=counterOf(a)[F.field];
    const txBefore=a.fs.st.tx;
    await F.go(a);
    const ids=docsIn(a,F.col).map(k=>k.split('/')[1]).filter(i=>i.startsWith(F.prefix));
    const newId=F.prefix+String(before+1).padStart(3,'0');
    s.ok(name+': the document is '+newId,ids.indexOf(newId)>-1,ids.join(','));
    s.eq(name+': counter '+before+' → '+(before+1),counterOf(a)[F.field],before+1);
    const others=o=>{const c=clone(o);delete c[F.field];Object.keys(c).forEach(k=>{if(k.indexOf('fablot_')===0)delete c[k];});return J(c);};
    s.eq(name+': the other counters are untouched',others(counterOf(a)),others(SEED_COUNTERS));
    // Fabric In also reserves its lot (a separate counter, not part of this fix): lot tx + the receipt tx.
    s.eq(name+': the number is spent in the SAME transaction as the document ('+(name==='Fabric In'?'lot tx + one':'one')+' in total)',a.fs.st.tx-txBefore,name==='Fabric In'?2:1);
    s.eq(name+': no plain (non-transactional) write of the numbered document',a.fs.st.plain.filter(p=>p.indexOf(' '+F.col+'/')>-1).length,0);
  }
  {
    // the multi-document flows land ALL their writes
    const r=retApp();await retGo(r);
    s.eq('Returns: the gate pass is updated in the same commit',J(r.fs.store.get('gatepasses/GP-004')),J(Object.assign({},PASS,{returnedQty:40,returnStatus:'Partial',expectReturn:true,closedAt:null})));
    s.eq('Returns: no plain write at all (it used to be setDoc then updateDoc)',r.fs.st.plain.length,0);
    const t=stnApp();await stnGo(t);
    s.eq('Stock transfer: the PO now carries the new entries after the old one',t.fs.store.get('pos/FB1').stockTransfers.map(e=>e.id).join(','),'STN-002-M,STN-007-S,STN-007-M');
    s.ok('Stock transfer: the stock_transfers document exists',t.fs.store.has('stock_transfers/STN-007'));
    s.eq('Stock transfer: no plain write at all',t.fs.st.plain.length,0);
    const c=ctnApp();await ctnGo(c);
    s.eq('Carton: the first item is in the new carton',J(c.fs.keys('bstock_items/').map(k=>[c.fs.store.get(k).cartonId,c.fs.store.get(k).cartonNo])),J([['CTN-003','CTN-003']]));
    s.eq('Carton: no plain write at all for a NEW carton',c.fs.st.plain.length,0);
  }
  {
    // an EXISTING carton mints nothing
    const c=ctnApp({cartons:[{id:'CTN-001',no:1,status:'open'}],carton:'CTN-001'});
    const before=counterOf(c);
    await ctnGo(c);
    s.eq('Carton: boxing into an existing carton leaves counters/main alone',J(counterOf(c)),J(before));
    s.eq('Carton: the item names that carton',c.fs.store.get(c.fs.keys('bstock_items/')[0]).cartonNo,'CTN-001');
  }

  /* ═══ 3 — FAILED / OFFLINE: nothing burned, nothing half-written ══════ */
  s.section('3 — a refused commit leaves counters/main exactly as it was, and the retry gets the same number');
  for(const name of Object.keys(FLOWS)){
    const F=FLOWS[name];
    const a=F.app();
    const wasCounter=counterOf(a)[F.field];
    const before=a.fs.dump();
    a.fs.st.failCommit='network lost before commit';
    await F.go(a);
    s.ok(name+': the error is shown',/network lost/.test(lastToast(a)),lastToast(a));
    const after=a.fs.dump();
    s.eq(name+': counter unchanged',counterOf(a)[F.field],wasCounter);
    s.eq(name+': no numbered document exists',docsIn(a,F.col).filter(k=>k.split('/')[1].startsWith(F.prefix)).length,0);
    if(name!=='Fabric In')s.eq(name+': the whole store is byte-identical',J(after),J(before));
    else{
      const strip=o=>{const c=clone(o);Object.keys(c['counters/main']).forEach(k=>{if(k.indexOf('fablot_')===0)delete c['counters/main'][k];});return J(c);};
      s.eq(name+': the whole store is byte-identical (the separate lot counter aside)',strip(after),strip(before));
    }
    await F.go(a);
    const newId=F.prefix+String(wasCounter+1).padStart(3,'0');
    s.ok(name+': the retry is '+newId+' — the failure spent nothing',a.fs.store.has(F.col+'/'+newId),docsIn(a,F.col).join(','));
  }

  s.section('3 — no connection (a transaction cannot use the offline cache): nothing is written, nothing burned');
  for(const name of Object.keys(FLOWS)){
    const F=FLOWS[name];
    const a=F.app();
    const wasCounter=counterOf(a)[F.field];
    a.fs.st.offline=true;
    await F.go(a);
    a.fs.st.offline=false;
    s.ok(name+': an error is shown',/Error|offline|reload/i.test(lastToast(a)),lastToast(a));
    s.eq(name+': counter unchanged',counterOf(a)[F.field],wasCounter);
    s.eq(name+': no numbered document written',docsIn(a,F.col).filter(k=>k.split('/')[1].startsWith(F.prefix)).length,0);
  }

  s.section('3 — the SECOND document is refused by the rules: the first is not left behind, no number spent');
  {
    const a=retApp();
    a.fs.st.rejectPaths=['gatepasses/GP-004'];
    const before=a.fs.dump();
    await retGo(a);
    s.ok('Returns: the refusal is shown',/insufficient permissions/.test(lastToast(a)),lastToast(a));
    s.eq('Returns: no return on file, counter unchanged, pass untouched',J(a.fs.dump()),J(before));
  }
  {
    const a=retApp();
    a.fs.store.delete('gatepasses/GP-004');
    const before=a.fs.dump();
    await retGo(a);
    s.ok('Returns: a pass that is gone refuses the whole return, by name',/GP-004 no longer exists/.test(lastToast(a)),lastToast(a));
    s.eq('Returns: nothing written',J(a.fs.dump()),J(before));
  }
  {
    const a=stnApp();
    a.fs.st.rejectPaths=['pos/FB1'];
    const before=a.fs.dump();
    await stnGo(a);
    s.ok('Stock transfer: the refusal is shown',/insufficient permissions/.test(lastToast(a)),lastToast(a));
    s.eq('Stock transfer: no transfer document, PO untouched, counter unchanged',J(a.fs.dump()),J(before));
  }
  {
    const a=stnApp();
    a.fs.store.delete('pos/FB1');
    const before=a.fs.dump();
    await stnGo(a);
    s.ok('Stock transfer: a PO that is gone refuses the whole booking, by name',/PO-007 no longer exists/.test(lastToast(a)),lastToast(a));
    s.eq('Stock transfer: nothing written',J(a.fs.dump()),J(before));
  }
  {
    const a=ctnApp();
    a.fs.st.rejectPaths=['bstock_items/BSI-'+FIXED];
    const before=a.fs.dump();
    await ctnGo(a);
    s.ok('Carton: the refusal is shown',/insufficient permissions/.test(lastToast(a)),lastToast(a));
    s.eq('Carton: no empty carton is left behind, counter unchanged',J(a.fs.dump()),J(before));
    a.fs.st.rejectPaths=[];
    await ctnGo(a);
    s.ok('Carton: the retry is CTN-003',a.fs.store.has('bstock_cartons/CTN-003')&&a.fs.store.has('bstock_items/BSI-'+FIXED),a.fs.keys('bstock_').join(','));
  }
  {
    // The stock transfer appends to what the PO holds NOW (read in the transaction), not to this page's older copy.
    const a=stnApp();
    const live=clone(PO_BASE);live.stockTransfers.push({id:'STN-005-L',transferId:'STN-005',size:'L',qty:4,ts:'2026-10-05T00:00:00.000Z',by:'Faizan'});
    a.fs.store.set('pos/FB1',live);
    await stnGo(a);
    s.eq('Stock transfer: a transfer booked on another phone is kept, not overwritten by this page\'s stale copy',
      a.fs.store.get('pos/FB1').stockTransfers.map(e=>e.id).join(','),'STN-002-M,STN-005-L,STN-007-S,STN-007-M');
  }

  /* ═══ 4 — TAKEN / LAGGING: the floor and the exists check ═════════════ */
  s.section('4 — a counter that LAGS behind a document that exists never overwrites it (loaded list → floor)');
  {
    const a=fabApp({counters:{fabricin:4}});
    const hi={id:'FAB-009',fabCode:'KEEPME-01',ts:2,supplier:'old',rolls:[]},lo={id:'FAB-005',fabCode:'AND-01',ts:1,supplier:'old',rolls:[]};
    [hi,lo].forEach(g=>{a.fs.store.set('fabricin/'+g.id,clone(g));a.ctx.allFabricIn.push(clone(g));});
    await fabGo(a);
    s.ok('Fabric In: minted ABOVE the highest receipt on file: FAB-010',a.fs.store.has('fabricin/FAB-010'),a.fs.keys('fabricin/').join(','));
    s.eq('Fabric In: FAB-009 untouched',J(a.fs.store.get('fabricin/FAB-009')),J(hi));
    s.eq('Fabric In: FAB-005 untouched',J(a.fs.store.get('fabricin/FAB-005')),J(lo));
    s.eq('Fabric In: counter lifted to 10',counterOf(a).fabricin,10);
  }
  {
    const a=retApp({counters:{returns:4},returns:[{id:'RET-005',ts:1,gpNum:'GP-001'},{id:'RET-012',ts:2,gpNum:'GP-002'}]});
    const keep=J(a.fs.store.get('returns/RET-012'));
    await retGo(a);
    s.ok('Returns: minted ABOVE the highest return on file: RET-013',a.fs.store.has('returns/RET-013'),a.fs.keys('returns/').join(','));
    s.eq('Returns: RET-012 untouched',J(a.fs.store.get('returns/RET-012')),keep);
    s.eq('Returns: counter lifted to 13',counterOf(a).returns,13);
  }
  {
    const a=stnApp({counters:{stock_transfer:1}});     // PO_BASE already carries STN-002
    await stnGo(a);
    s.ok('Stock transfer: floor from the loaded POs\' transfers: STN-003, never the STN-002 already booked',a.fs.store.has('stock_transfers/STN-003'),a.fs.keys('stock_transfers/').join(','));
    s.eq('Stock transfer: counter lifted to 3',counterOf(a).stock_transfer,3);
  }
  {
    const a=ctnApp({counters:{bstock_carton:0},cartons:[{id:'CTN-004',no:4,status:'open'},{id:'CTN-007',no:7,status:'transferred'}]});
    const keep=J(a.fs.store.get('bstock_cartons/CTN-007'));
    await ctnGo(a);
    s.ok('Carton: minted ABOVE the highest carton on file (a transferred one counts): CTN-008',a.fs.store.has('bstock_cartons/CTN-008'),a.fs.keys('bstock_cartons/').join(','));
    s.eq('Carton: CTN-007 untouched',J(a.fs.store.get('bstock_cartons/CTN-007')),keep);
    s.eq('Carton: its `no` is 8',a.fs.store.get('bstock_cartons/CTN-008').no,8);
  }

  {
    // A carton whose id does not carry its number still counts through its `no` field.
    const a=ctnApp({counters:{bstock_carton:0},cartons:[{id:'legacy-box',no:15,status:'open'}]});
    await ctnGo(a);
    s.ok('Carton: a carton known only by its `no` (15) sets the floor: CTN-016',a.fs.store.has('bstock_cartons/CTN-016'),a.fs.keys('bstock_cartons/').join(','));
  }

  s.section('4 — the page has not loaded the list: the floor is read from the server list');
  {
    const a=fabApp({counters:{fabricin:0}});
    a.fs.store.set('fabricin/FAB-003',{id:'FAB-003',supplier:'ON THE SERVER',rolls:[]});
    await fabGo(a);
    s.ok('Fabric In: with an empty page list the server list sets the floor: FAB-004',a.fs.store.has('fabricin/FAB-004'),a.fs.keys('fabricin/').join(','));
    s.eq('Fabric In: FAB-003 untouched',a.fs.store.get('fabricin/FAB-003').supplier,'ON THE SERVER');
  }
  {
    const a=retApp({counters:{returns:0}});
    a.fs.store.set('returns/RET-006',{id:'RET-006',gpNum:'GP-001',note:'ON THE SERVER'});
    await retGo(a);
    s.ok('Returns: server list sets the floor: RET-007',a.fs.store.has('returns/RET-007'),a.fs.keys('returns/').join(','));
    s.eq('Returns: RET-006 untouched',a.fs.store.get('returns/RET-006').note,'ON THE SERVER');
  }
  {
    const a=stnApp({counters:{stock_transfer:0}});
    a.ctx.allPOs[0].stockTransfers=[];                        // no transfer on any loaded PO: only the server list can set the floor
    a.fs.store.set('stock_transfers/STN-009',{id:'STN-009',poId:'PO-1',note:'ON THE SERVER'});
    await stnGo(a);
    s.ok('Stock transfer: server list sets the floor: STN-010',a.fs.store.has('stock_transfers/STN-010'),a.fs.keys('stock_transfers/').join(','));
    s.eq('Stock transfer: STN-009 untouched',a.fs.store.get('stock_transfers/STN-009').note,'ON THE SERVER');
  }
  {
    const a=ctnApp({counters:{bstock_carton:0}});
    a.fs.store.set('bstock_cartons/CTN-011',{id:'CTN-011',no:11,status:'open',note:'ON THE SERVER'});
    await ctnGo(a);
    s.ok('Carton: server list sets the floor: CTN-012',a.fs.store.has('bstock_cartons/CTN-012'),a.fs.keys('bstock_cartons/').join(','));
    s.eq('Carton: CTN-011 untouched',a.fs.store.get('bstock_cartons/CTN-011').note,'ON THE SERVER');
  }

  s.section('4 — a STALE page list (a document made on another phone): the in-transaction exists check is the backstop');
  {
    const a=fabApp({counters:{fabricin:5}});
    a.fs.store.set('fabricin/FAB-006',{id:'FAB-006',supplier:'MADE ON ANOTHER PHONE',rolls:[]});
    a.ctx.allFabricIn.push({id:'FAB-005',supplier:'x',rolls:[]});
    const before=a.fs.dump();
    await fabGo(a);
    s.ok('Fabric In: refused, the id is taken',/FAB-006 already exists/.test(lastToast(a)),lastToast(a));
    const strip=o=>{const c=clone(o);Object.keys(c['counters/main']).forEach(k=>{if(k.indexOf('fablot_')===0)delete c['counters/main'][k];});return J(c);};
    s.eq('Fabric In: nothing changed — FAB-006 not overwritten, counter not moved, no stock added',strip(a.fs.dump()),strip(before));
  }
  {
    const a=retApp({counters:{returns:11}});
    a.fs.store.set('returns/RET-012',{id:'RET-012',note:'MADE ON ANOTHER PHONE'});
    a.ctx.allReturns.push({id:'RET-011'});
    const before=snap(a);
    await retGo(a);
    s.ok('Returns: refused, the id is taken',/RET-012 already exists/.test(lastToast(a)),lastToast(a));
    s.eq('Returns: nothing changed',snap(a),before);
  }
  {
    const a=stnApp({counters:{stock_transfer:2}});
    a.fs.store.set('stock_transfers/STN-003',{id:'STN-003',note:'MADE ON ANOTHER PHONE'});
    const before=snap(a);
    await stnGo(a);
    s.ok('Stock transfer: refused, the id is taken',/STN-003 already exists/.test(lastToast(a)),lastToast(a));
    s.eq('Stock transfer: nothing changed',snap(a),before);
  }
  {
    const a=ctnApp({counters:{bstock_carton:2},cartons:[{id:'CTN-002',no:2,status:'open'}]});
    a.fs.store.set('bstock_cartons/CTN-003',{id:'CTN-003',no:3,note:'MADE ON ANOTHER PHONE'});
    const before=snap(a);
    await ctnGo(a);
    s.ok('Carton: refused, the id is taken',/CTN-003 already exists/.test(lastToast(a)),lastToast(a));
    s.eq('Carton: nothing changed',snap(a),before);
  }

  /* ═══ 5 — CACHE-ONLY: an untrustworthy list refuses before any write ═══ */
  s.section('5 — nothing trustworthy to floor from (cache-only read, no list): refuse BEFORE any write');
  for(const name of Object.keys(FLOWS)){
    const F=FLOWS[name];
    const a=F.app({counters:{}});
    // remove whatever the flow had loaded on the page, so only the server list could set the floor
    a.ctx.allFabricIn.length=0;a.ctx.allReturns.length=0;
    if(name==='Stock transfer')a.ctx.allPOs[0].stockTransfers=[];
    if(name==='B-stock carton')a.run('allBstockCartons=[]');
    a.fs.st.cacheOnly=true;
    const before=snap(a),txBefore=a.fs.st.tx;
    await F.go(a);
    s.ok(name+': told to reload, nothing saved',/Reload the page first/.test(lastToast(a))&&/Nothing was saved/.test(lastToast(a)),lastToast(a));
    s.eq(name+': no numbering transaction was attempted',a.fs.st.tx-txBefore,0);
    s.eq(name+': store untouched',snap(a),before);
  }

  /* ═══ 6 — the shared pieces ═══════════════════════════════════════════ */
  s.section('6 — createWithNextId without the new hooks is what it always was');
  {
    const a=boot(['js/gatepass.js']);
    const made=await a.run('createWithNextId({field:"returns",collection:"returns",idFor:n=>"RET-"+n,build:(n,id)=>({id,n})})');
    s.eq('id, number and record',J(made),J({n:12,id:'RET-12',record:{id:'RET-12',n:12}}));
    s.eq('counter moved',counterOf(a).returns,12);
  }
  return s;
};

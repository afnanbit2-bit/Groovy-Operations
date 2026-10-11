/* ─────────────────────────────────────────────────────────────────────────
   Fabric wave 2 (js/fabric.js + the engine in js/gatepass.js)

   What this guards, each by DRIVING the real functions:
     1  a multi-fabric issue is ONE transaction — a roll that is gone from the
        second fabric (or the rib) leaves the first fabric's rolls untouched and
        writes nothing: no stock change, no movement, no gate pass.
     2  deleting an issue from the registry goes through the single restock path
        (_gpDeleteGatePass → _gpRestockIssue): partly drawn rolls get their weight
        back, a failed restock deletes nothing and names the rolls, a retry
        restores nothing twice, and only afnan/ammar/mustafa may skip a roll.
     3  'm' and 'meters' are the same unit when READING (totals, registry
        roll-ups, the issue's own totalLength) — and nothing stored is rewritten.
     4  every date fabric.js writes is the PKT day, not the UTC one.
     5  a receipt cannot be deleted once rolls from it were used — named, never
        silent — on the page's data AND on the live data inside the transaction.
     6  (wave 2b) the GP NUMBER is minted inside the issue transaction: a refused
        or failed issue leaves counters/main untouched, a good one moves it by
        exactly one in the same commit, and a counter that lags behind a pass
        that exists can never overwrite it (floor + the in-transaction exists check).
     7  (wave 2b) 'm' is metres in the gate-pass edit label, the edit totals, the
        legacy PDF label and the outward fabric picker — read-only, nothing stored
        is rewritten.
     8  (wave 2b) Delete-all with many refused issues: the toast names the first 3
        and "and N more"; the activity log keeps the full list with the rolls.

   The Firestore stand-in is a real transaction (writes buffered, applied only if
   the callback resolves), so "nothing was written" is something this file can
   assert. Plain node, no network: it proves the LOGIC, not what a phone shows.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');
const {installMint}=require('./mint-helper');

const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const J=x=>JSON.stringify(x);
const _esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// _fabInvKey(type,gsm,color)
const K1='jersey__220gsm__black';
const K2='twill__300gsm__navy';
const K3='rib__250gsm__black';

function makeFs(){
  const store=new Map();
  // counters/main lives IN the store now (the gate pass number is minted inside the
  // issue transaction); `counters.gatepasses` reads it back.
  const counters=new Proxy({},{get:(_t,f)=>{const c=store.get('counters/main');return c?c[f]:undefined;}});
  const stats={tx:0};
  let auto=0;
  const ref=path=>({path,id:path.split('/').pop()});
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
    runTransaction:async(_db,fn)=>{
      stats.tx++;
      const buf=[];let wrote=false;
      const tx={
        get:async r=>{
          // Firestore's own rule: every read must come BEFORE the first write.
          if(wrote)throw new Error('Firestore transactions require all reads to be executed before all writes.');
          return{exists:()=>store.has(r.path),data:()=>clone(store.get(r.path))};
        },
        set(r,data,opts){wrote=true;buf.push({op:'set',ref:r,data:clone(data),merge:!!(opts&&opts.merge)});return tx;},
        update(r,data){wrote=true;buf.push({op:'update',ref:r,data:clone(data)});return tx;},
        delete(r){wrote=true;buf.push({op:'delete',ref:r});return tx;}
      };
      await fn(tx);
      buf.forEach(apply);
    },
    setDoc:async(r,data)=>{store.set(r.path,clone(data));},
    updateDoc:async(r,data)=>{if(!store.has(r.path))throw new Error('No document to update: '+r.path);store.set(r.path,Object.assign({},store.get(r.path),clone(data)));},
    deleteDoc:async r=>{store.delete(r.path);},
    // The server list, for _gpFloorNow when the page has not loaded the passes.
    getDocs:async c=>({metadata:{fromCache:false},docs:[...store.keys()].filter(k=>k.startsWith(c.__coll+'/')).map(k=>({id:k.split('/').pop(),data:()=>clone(store.get(k))}))})
  };
  return{store,counters,stats,api,keys:prefix=>[...store.keys()].filter(k=>k.startsWith(prefix))};
}

const roll=(code,w,extra)=>Object.assign({rollCode:code,weight:w,gsm:220,unit:'kg',status:'in_stock',sourceFabId:'FAB-001'},extra||{});

function app(opts){
  opts=opts||{};
  const fs=makeFs();
  const a=loadApp({files:['js/gatepass.js','js/fabric.js'],session:opts.session,globals:Object.assign({},fs.api,{
    _gpEsc:_esc,
    allPasses:[],allFabricInventory:[],allFabricMovements:[],allReturns:[],allGPEditRequests:[],allFabricIn:[],allPOs:[],
    currentPage:'',_fabInvDrillKey:null,_fabInvFilter:'all',_fabInvCatFilter:'',_fabInvSearchQ:'',loadData:async()=>{},
    console:{log:console.log,error:console.error,warn:()=>{},info:()=>{}},
    logActivity:async(act,detail)=>{a.state.activity.push({action:act,detail});},
    confirm:m=>{a.state.confirms.push(String(m));return !/Delete \S+ anyway/.test(String(m));}
  },opts.globals||{})});
  a.fs=fs;
  installMint(a);
  return a;
}
// A bucket in the fake Firestore AND the page's in-memory copy.
function seed(a,rolls,key,type,gsm,color,unit,memRolls){
  const doc={key,fabType:type,gsm,color,unit:unit||'kg',rolls:clone(rolls),
    totalWeight:rolls.filter(r=>(r.status||'in_stock')==='in_stock').reduce((n,r)=>n+r.weight,0),lastMovementAt:1};
  a.fs.store.set('fabric_inventory/'+key,doc);
  // `memRolls`: what THIS page believes (stale) when it differs from the server.
  a.ctx.allFabricInventory.push(Object.assign(clone(doc),{rolls:clone(memRolls||rolls),_id:key}));
}
const J1=(a,rolls,mem)=>seed(a,rolls,K1,'Jersey',220,'Black','kg',mem);
const T2=(a,rolls,mem,unit)=>seed(a,rolls,K2,'Twill',300,'Navy',unit||'kg',mem);
const R3=(a,rolls,mem)=>seed(a,rolls,K3,'Rib',250,'Black','kg',mem);
const inv=(a,key)=>a.fs.store.get('fabric_inventory/'+key);
const rollOf=(a,key,code)=>(inv(a,key).rolls||[]).find(r=>r.rollCode===code);
const movs=a=>a.fs.keys('fabric_movements/').map(k=>a.fs.store.get(k));
const lastToast=a=>a.state.toasts[a.state.toasts.length-1]||'';
async function attempt(p){try{return{res:await p};}catch(e){return{err:e};}}

// What the Issue tab holds when a person has picked rolls (page memory).
function pick(a,picks){
  // picks: [{key,type,gsm,color,code,weight,unit}]
  a.ctx.__picks=picks.map(p=>({rollCode:p.code,weight:p.weight,useWeight:p.use==null?p.weight:p.use,status:'in_stock',key:p.key,fabType:p.type,gsm:p.gsm,color:p.color,unit:p.unit||'kg'}));
  a.run('_fabIssueRolls=__picks;_fabIssueKey=__picks[0]&&__picks[0].key;_fabRibRolls=[];_fabRibKey=null');
  a.el('fab-iss-po').value='PO-7';
  a.el('fab-iss-article').value='Two-tone tee';
  a.el('fab-iss-code').value='GST100';
  a.el('fab-iss-cutmaster').value='Hassan';
}
const pickRib=(a,codes,weights)=>{
  a.ctx.__rib=codes.map((c,i)=>({rollCode:c,weight:weights[i],useWeight:weights[i],status:'in_stock'}));
  a.run('_fabRibRolls=__rib;_fabRibKey='+J(K3));
};

module.exports=async function(){
  const s=suite('fabric-wave2');

  // ═══ 1 — a multi-fabric issue is ONE transaction ═══════════════════════
  s.section('1 — all fabrics of an issue commit together');
  {
    const a=app();
    J1(a,[roll('A1',10),roll('A2',20)]);
    T2(a,[roll('B1',30)]);
    pick(a,[{key:K1,type:'Jersey',gsm:220,color:'Black',code:'A1',weight:10},{key:K2,type:'Twill',gsm:300,color:'Navy',code:'B1',weight:30}]);
    await a.run('window.submitFabricIssue()');
    s.eq('exactly ONE transaction for the whole issue (two fabrics)',a.fs.stats.tx,1);
    s.eq('fabric 1 roll issued',rollOf(a,K1,'A1').status,'issued');
    s.eq('fabric 2 roll issued',rollOf(a,K2,'B1').status,'issued');
    s.eq('both rolls name the same pass',rollOf(a,K1,'A1').issuedTo+'|'+rollOf(a,K2,'B1').issuedTo,'GP-001|GP-001');
    s.ok('the gate-pass doc is written',a.fs.store.has('gatepasses/GP-001'));
    s.eq('one movement per fabric',movs(a).length,2);
    s.eq('the page copy of BOTH buckets follows the commit',a.run('allFabricInventory.map(x=>x._id+":"+x.rollsCount).join(",")'),`${K1}:1,${K2}:0`);
    s.eq('gate pass records both fabrics',a.fs.store.get('gatepasses/GP-001').fabrics.length,2);
  }

  s.section('1 — a roll gone from the SECOND fabric: nothing is consumed, nothing is written');
  {
    const a=app();
    J1(a,[roll('A1',10),roll('A2',20)]);
    // The server has B2 already issued by someone else; THIS page still thinks it is in stock.
    T2(a,[roll('B1',30),roll('B2',40,{status:'issued',issuedTo:'GP-050'})],[roll('B1',30),roll('B2',40)]);
    const before=J([...a.fs.store.entries()]);
    pick(a,[{key:K1,type:'Jersey',gsm:220,color:'Black',code:'A1',weight:10},{key:K2,type:'Twill',gsm:300,color:'Navy',code:'B2',weight:40}]);
    await a.run('window.submitFabricIssue()');
    s.eq('NOTHING in Firestore changed (fabric 1 included)',J([...a.fs.store.entries()]),before);
    s.eq('fabric 1\'s roll is still in stock',rollOf(a,K1,'A1').status,'in_stock');
    s.ok('no gate pass was written',!a.fs.store.has('gatepasses/GP-001'));
    s.eq('no movement row exists',movs(a).length,0);
    s.ok('the user is told which roll was unavailable',/B2/.test(lastToast(a)),lastToast(a));
    s.ok('and that nothing was saved',/Nothing was saved/.test(lastToast(a)),lastToast(a));
    s.eq('page memory of fabric 1 still lists A1 in stock',a.ctx.allFabricInventory.find(x=>x._id===K1).rolls.find(r=>r.rollCode==='A1').status,'in_stock');
  }

  s.section('1 — the engine names EVERY unavailable roll across buckets, in one error');
  {
    const a=app();
    J1(a,[roll('A1',10,{status:'issued',issuedTo:'GP-040'})]);
    T2(a,[roll('B1',30,{status:'issued',issuedTo:'GP-041'})]);
    const r=await attempt(a.run(`_fabInvUpsert({fabType:'Jersey',gsm:220,color:'Black',unit:'kg',removeRollCodes:['A1'],moreBuckets:[{fabType:'Twill',gsm:300,color:'Navy',unit:'kg',removeRollCodes:['B1']}],sourceCol:'gatepasses',sourceId:'GP-9'})`));
    s.eq('rejects with the engine code',r.err&&r.err.code,'fabric/rolls-unavailable');
    s.eq('.rollCodes lists the unavailable rolls of BOTH buckets',J(r.err&&r.err.rollCodes),'["A1","B1"]');
    const r2=await attempt(a.run(`_fabInvUpsert({fabType:'Jersey',gsm:220,color:'Black',unit:'kg',removeRollCodes:['A1'],moreBuckets:[{fabType:'jersey',gsm:220,color:'black',unit:'kg',removeRollCodes:['A2']}],sourceCol:'gatepasses',sourceId:'GP-9'})`));
    s.ok('two buckets that are the SAME inventory doc are refused outright',!!r2.err&&/same fabric twice/.test(r2.err.message),r2.err&&r2.err.message);
  }

  s.section('1 — the matching rib is inside the same transaction');
  {
    const a=app();
    J1(a,[roll('A1',100)]);
    R3(a,[roll('RB1',4),roll('RB2',5,{status:'issued',issuedTo:'GP-060'})],[roll('RB1',4),roll('RB2',5)]);
    pick(a,[{key:K1,type:'Jersey',gsm:220,color:'Black',code:'A1',weight:100}]);
    pickRib(a,['RB2'],[5]);
    const before=J([...a.fs.store.entries()]);
    await a.run('window.submitFabricIssue()');
    s.eq('a rib roll that is gone aborts the WHOLE issue (it used to be a warning after the fact)',J([...a.fs.store.entries()]),before);
    s.ok('and the rib roll is named',/RB2/.test(lastToast(a)),lastToast(a));
    // Now a healthy one.
    const b=app();
    J1(b,[roll('A1',100)]);R3(b,[roll('RB1',4)]);
    pick(b,[{key:K1,type:'Jersey',gsm:220,color:'Black',code:'A1',weight:100}]);
    pickRib(b,['RB1'],[4]);
    await b.run('window.submitFabricIssue()');
    s.eq('rib + fabric in ONE transaction',b.fs.stats.tx,1);
    s.eq('the rib roll is issued too',rollOf(b,K3,'RB1').status,'issued');
    s.eq('with the pass on the rib roll',rollOf(b,K3,'RB1').issuedTo,'GP-001');
    // A rib that is the SAME inventory doc as the fabric joins its bucket (one doc is read once).
    const c=app();
    J1(c,[roll('A1',100),roll('A2',5)]);
    c.ctx.__rib=[{rollCode:'A2',weight:5,useWeight:5,status:'in_stock'}];
    pick(c,[{key:K1,type:'Jersey',gsm:220,color:'Black',code:'A1',weight:100}]);
    c.ctx.allFabricInventory.find(x=>x._id===K1);
    c.run('_fabRibRolls=__rib;_fabRibKey='+J(K1));
    await c.run('window.submitFabricIssue()');
    s.eq('rib sharing the fabric\'s bucket: one transaction',c.fs.stats.tx,1);
    s.eq('both rolls issued from the one bucket',rollOf(c,K1,'A1').status+'|'+rollOf(c,K1,'A2').status,'issued|issued');
  }

  // ═══ 2 — registry delete uses the single restock path ══════════════════
  s.section('2 — fabRegDeleteOne restocks through _gpRestockIssue, partial draws included');
  const issuedPass=()=>({id:'GP-010',ts:5000,gpType:'fabric',poId:'PO-7',fabricUnit:'kg',fabricType:'Jersey',fabricGsm:220,fabricColor:'Black',inventoryKey:K1,
    rollCodes:['A1','A2'],partialRolls:[{rollCode:'A2',weightBefore:20,usedWeight:8,weightAfter:12,unit:'kg'}],
    fabrics:[{inventoryKey:K1,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['A1','A2']},{inventoryKey:K2,fabType:'Twill',gsm:300,color:'Navy',unit:'kg',rollCodes:['B1']}]});
  function seedIssued(a){
    J1(a,[roll('A1',10,{status:'issued',issuedTo:'GP-010'}),
      roll('A2',12,{partiallyConsumed:true,originalWeight:20,labelStale:true,consumptionLog:[{po:'PO-7',weight:8,ts:5000,gp:'GP-010'}]})]);
    T2(a,[roll('B1',30,{status:'issued',issuedTo:'GP-010'})]);
    const gp=issuedPass();
    a.fs.store.set('gatepasses/GP-010',clone(gp));a.ctx.allPasses.push(clone(gp));
  }
  {
    const a=app();
    seedIssued(a);
    await a.run("window.fabRegDeleteOne('GP-010')");
    s.eq('whole roll back in stock',rollOf(a,K1,'A1').status,'in_stock');
    s.eq('the partly drawn roll got its 8 kg back (the legacy path could not)',rollOf(a,K1,'A2').weight,20);
    s.eq('fabric 2 roll back in stock',rollOf(a,K2,'B1').status,'in_stock');
    s.ok('the record is gone',!a.fs.store.has('gatepasses/GP-010'));
    s.ok('and gone from the page list',!a.ctx.allPasses.some(p=>p.id==='GP-010'));
    s.ok('the toast counts the rolls really returned',/Deleted/.test(lastToast(a))&&/3 roll/.test(lastToast(a)),lastToast(a));
    s.ok('the restock is a movement row (return_in)',movs(a).every(m=>m.subtype==='return_in')&&movs(a).length===2);
  }

  s.section('2 — a failed restock deletes NOTHING, names the roll, and a retry restores once');
  {
    const a=app();
    seedIssued(a);
    // fabric 2's roll vanished from inventory (the second bucket fails AFTER the first was put back)
    a.fs.store.get('fabric_inventory/'+K2).rolls=[];
    await a.run("window.fabRegDeleteOne('GP-010')");
    s.ok('the pass is NOT deleted',a.fs.store.has('gatepasses/GP-010'));
    s.ok('the failure names the roll',/B1/.test(lastToast(a))&&/Delete failed/.test(lastToast(a)),lastToast(a));
    s.eq('the first fabric was already put back (each bucket is its own transaction)',rollOf(a,K1,'A1').status,'in_stock');
    s.eq('its partial draw restored exactly once',rollOf(a,K1,'A2').weight,20);
    s.ok('and the error says retrying is safe',/retrying is safe/.test(lastToast(a)),lastToast(a));
    // The roll comes back (found / re-entered), then the retry.
    a.fs.store.get('fabric_inventory/'+K2).rolls=[roll('B1',30,{status:'issued',issuedTo:'GP-010'})];
    await a.run("window.fabRegDeleteOne('GP-010')");
    s.ok('the retry deletes the pass',!a.fs.store.has('gatepasses/GP-010'));
    s.eq('the partial draw is NOT restored a second time (still 20, never 28)',rollOf(a,K1,'A2').weight,20);
    s.eq('the draw is marked restored once',(rollOf(a,K1,'A2').drawsRestored||[]).length,1);
    s.eq('fabric 2 now back in stock',rollOf(a,K2,'B1').status,'in_stock');
  }

  s.section('2 — the role gate for skipping unrecoverable rolls lives in the restock path');
  {
    const a=app({session:{uid:'u9',name:'Arfat',u:'arfat',role:'manager',email:'arfat@groovy.op'}});
    seedIssued(a);
    a.fs.store.get('fabric_inventory/'+K2).rolls=[];
    await a.run("window.fabRegDeleteOne('GP-010')");
    s.ok('a manager who is not on the override list cannot delete past a missing roll',a.fs.store.has('gatepasses/GP-010'));
    s.ok('and is told who can',/Only an owner|Delete failed/.test(lastToast(a)),lastToast(a));
    const r=await attempt(a.run("_gpRestockIssue(allPasses[0],{tolerateMissing:true})"));
    s.ok('a direct tolerateMissing call is refused for him as well',!!r.err&&/Only an owner/.test(r.err.message),r.err&&r.err.message);
    const b=app({session:{uid:'u1',name:'Mustafa',u:'mustafa',role:'manager',email:'mustafa@groovy.op'},globals:{}});
    seedIssued(b);
    b.fs.store.get('fabric_inventory/'+K2).rolls=[];
    b.ctx.confirm=m=>{b.state.confirms.push(String(m));return true;};   // he says yes to "delete anyway"
    await b.run("window.fabRegDeleteOne('GP-010')");
    s.ok('Mustafa may, after a confirm that NAMES the roll',b.state.confirms.some(c=>/anyway/.test(c)&&/B1/.test(c)),J(b.state.confirms));
    s.ok('and then the pass is deleted',!b.fs.store.has('gatepasses/GP-010'));
  }

  s.section('2 — Delete all: an issue that cannot be restocked is left alone and listed');
  {
    const a=app();
    seedIssued(a);
    a.fs.store.get('fabric_inventory/'+K2).rolls=[];
    const ok2={id:'GP-011',ts:4000,gpType:'fabric',poId:'PO-8',fabricUnit:'kg',fabricType:'Jersey',fabricGsm:220,fabricColor:'Black',rollCodes:['A9'],partialRolls:[],
      fabrics:[{inventoryKey:K1,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['A9']}]};
    a.fs.store.get('fabric_inventory/'+K1).rolls.push(roll('A9',7,{status:'issued',issuedTo:'GP-011'}));
    a.fs.store.set('gatepasses/GP-011',clone(ok2));a.ctx.allPasses.push(clone(ok2));
    await a.run('window.fabRegDeleteAll()');
    s.ok('the restockable issue is deleted',!a.fs.store.has('gatepasses/GP-011'));
    s.ok('the one with a missing roll is kept',a.fs.store.has('gatepasses/GP-010'));
    s.ok('and named in the toast',/GP-010/.test(lastToast(a)),lastToast(a));
    s.ok('its roll is named in the activity log (the toast carries issue numbers only)',a.state.activity.some(x=>x.action==='Fabric issues cleared'&&/GP-010 \(B1\)/.test(x.detail)),J(a.state.activity));
  }

  // ═══ 3 — one unit for metres ═══════════════════════════════════════════
  s.section('3 — _fabUnitNorm: every spelling of metres is one unit, kg is kg, nothing is rewritten');
  {
    const a=app();
    const n=x=>a.run('_fabUnitNorm('+J(x)+')');
    s.eq("'m'",n('m'),'m');s.eq("'meters'",n('meters'),'m');s.eq("'Meter'",n('Meter'),'m');s.eq("' Metres '",n(' Metres '),'m');s.eq("'metre'",n('metre'),'m');
    s.eq("blank / null default to kg",n('')+n(null),'kgkg');s.eq("'KG'",n('KG'),'kg');
    s.eq("an unknown unit is kept (trimmed, lower-case), not guessed",n(' Pcs '),'pcs');
  }
  s.section('3 — totals and registry roll-ups treat both spellings as metres');
  {
    const a=app();
    T2(a,[roll('B1',30,{unit:'m'})],null,'m');          // a bucket stored as 'm'
    J1(a,[roll('A1',10)]);
    seed(a,[roll('C1',5,{unit:'meters'})],'drill__200gsm__grey','Drill',200,'Grey','meters');   // another stored as 'meters'
    const html=a.run('renderFabricInventory()');
    s.ok('stock tab: 35 m in total (30 m + 5 meters)',/35(\.0+)?\s*m/i.test(String(html).replace(/<[^>]+>/g,' ')),String(html).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,260));
    a.ctx.allPasses.push({id:'G1',gpType:'fabric',date:'2026-10-09',ts:1,fabricUnit:'m',fabricQty:12},
      {id:'G2',gpType:'fabric',date:'2026-10-09',ts:2,fabricUnit:'meters',fabricQty:8},
      {id:'G3',gpType:'fabric',date:'2026-10-09',ts:3,fabricUnit:'kg',fabricQty:5},
      {id:'G4',gpType:'fabric',date:'2026-10-09',ts:4,fabricQty:1},
      {id:'G5',gpType:'fabric',date:'2026-10-09',ts:5,fabricUnit:'KG',fabricQty:4});
    const t=a.run('_fabRegDayTotals(_fabIssueRecords()).get("2026-10-09")');
    s.eq('day roll-up: metres = 12 m + 8 meters',t.m,20);
    s.eq('day roll-up: kg = 5 + the blank-unit issue + a stray upper-case KG',t.kg,10);
    const ut=a.run('_fabRegUnitTotals(_fabIssueRecords())');
    s.eq('headline: metres total',ut.m,20);s.eq('headline: kg total',ut.kg,10);
    const st=String(a.run('_fabRegStatsHTML()')).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
    s.ok('the "Fabric out" tile never adds kg to metres',/10\.0 kg · 20\.0 m/.test(st),st);
    // The export: its own TOTAL (metres) row, a unit column that reads the same either way, no summed 26.
    const sheets=[];
    a.ctx.XLSX={utils:{aoa_to_sheet:aoa=>({aoa}),book_new:()=>({}),book_append_sheet:(wb,ws)=>{wb.ws=ws;}},writeFile:(wb,name)=>sheets.push({aoa:wb.ws.aoa,name})};
    a.run('window.fabExportIssueRegistry()');
    const aoa=sheets[0]&&sheets[0].aoa||[];
    const hdr=aoa[0]||[];const uCol=hdr.indexOf('Unit'),qCol=hdr.indexOf('Fabric used');
    const totKg=aoa.find(r=>r[0]==='TOTAL'),totM=aoa.find(r=>r[0]==='TOTAL (metres)');
    s.ok('export total (kg) row carries kg only',!!totKg&&totKg[qCol]===10&&totKg[uCol]==='kg',J(totKg));
    s.ok('export total (metres) row carries metres only',!!totM&&totM[qCol]===20&&totM[uCol]==='m'&&totM.length===hdr.length,J(totM));
    s.eq('export unit column is the one spelling',aoa.slice(1).filter(r=>r[0]==='2026-10-09').map(r=>r[uCol]).sort().join(','),'kg,kg,kg,m,m');
    s.eq('stored records were NOT rewritten (reading only)',a.ctx.allPasses.find(p=>p.id==='G2').fabricUnit,'meters');
    s.eq('stored stock bucket unit untouched',a.ctx.allFabricInventory.find(x=>x._id==='drill__200gsm__grey').unit,'meters');
  }
  s.section('3 — an issue taken from an \'m\' bucket records its length (it used to record 0 and 0)');
  {
    const a=app();
    T2(a,[roll('B1',30,{unit:'m'})],null,'m');
    pick(a,[{key:K2,type:'Twill',gsm:300,color:'Navy',code:'B1',weight:30,unit:'m'}]);
    await a.run('window.submitFabricIssue()');
    const gp=a.fs.store.get('gatepasses/GP-001')||{};
    s.eq('totalLength set',gp.totalLength,30);
    s.eq('totalWeight is 0 for a metres issue',gp.totalWeight,0);
    s.eq('fabricUnit stays exactly as the bucket stores it',gp.fabricUnit,'m');
  }

  // ═══ 4 — the PKT day ═══════════════════════════════════════════════════
  s.section('4 — dates are the PKT day (UTC+5), not the UTC day');
  {
    const prevTZ=process.env.TZ;
    process.env.TZ='Asia/Karachi';
    try{
      const probe=new Date('2026-10-10T23:30:00Z');
      s.ok('the test environment honours TZ (23:30 UTC on the 10th is the 11th in PKT)',probe.getDate()===11);
      const cases=[
        ['2026-10-10T23:30:00Z','2026-10-11','23:30 UTC = 04:30 PKT next day (the UTC date is the 10th)'],
        ['2026-10-11T00:30:00Z','2026-10-11','00:30 UTC = 05:30 PKT (same day both ways)'],
        ['2026-10-10T19:01:00Z','2026-10-11','19:01 UTC = 00:01 PKT, just past PKT midnight'],
        ['2026-10-10T18:59:00Z','2026-10-10','18:59 UTC = 23:59 PKT, still the 10th']
      ];
      for(const [iso,want,label] of cases){
        const T=new Date(iso).getTime();
        class FakeDate extends Date{constructor(...x){super(...(x.length?x:[T]));}static now(){return T;}}
        const a=app({globals:{Date:FakeDate}});
        s.eq('_fabToday — '+label,a.run('_fabToday()'),want);
        J1(a,[roll('A1',10)]);
        pick(a,[{key:K1,type:'Jersey',gsm:220,color:'Black',code:'A1',weight:10}]);
        await a.run('window.submitFabricIssue()');
        s.eq('the issue\'s date — '+label,(a.fs.store.get('gatepasses/GP-001')||{}).date,want);
        s.ok('Fabric In defaults to that day — '+label,String(a.run('renderFabricInTab()')).includes('id="fab-date" type="date" value="'+want+'"'));
        a.ctx.allPasses.push(a.fs.store.get('gatepasses/GP-001'));    // what loadData() would bring back
        const sheets=[];
        a.ctx.XLSX={utils:{aoa_to_sheet:aoa=>({aoa}),book_new:()=>({}),book_append_sheet:(wb,ws)=>{wb.ws=ws;}},writeFile:(wb,name)=>sheets.push(name)};
        a.run('window.fabExportIssueRegistry()');
        s.ok('export file name carries that day — '+label,(sheets[0]||'').endsWith('-'+want+'.xlsx'),sheets[0]);
      }
    }finally{
      if(prevTZ===undefined)delete process.env.TZ;else process.env.TZ=prevTZ;
    }
  }

  // ═══ 5 — receipt delete never silently deletes used stock ══════════════
  s.section('5 — a receipt whose rolls were issued is refused, every roll named');
  const receipt=(codes)=>({id:'FAB-001',fabType:'Jersey',gsm:220,color:'Black',unit:'kg',supplier:'Gul',rolls:codes.map(c=>({rollCode:c,weight:10}))});
  function seedReceipt(a,srvRolls,memRolls,codes){
    J1(a,srvRolls,memRolls);
    const f=receipt(codes);
    a.fs.store.set('fabricin/FAB-001',clone(f));a.ctx.allFabricIn.push(clone(f));
  }
  {
    const a=app();
    seedReceipt(a,[roll('R1',10,{status:'issued',issuedTo:'GP-1'}),roll('R2',10,{status:'reserved',reservedPO:'PO-3'}),roll('R3',10)],null,['R1','R2','R3']);
    const before=J([...a.fs.store.entries()]);
    const r=await attempt(a.run("window._fabDeleteReceipt('FAB-001')"));
    s.ok('it throws',!!r.err);
    s.ok('naming the issued roll',/R1 \(issued\)/.test(r.err&&r.err.message||''),r.err&&r.err.message);
    s.ok('AND the reserved one (not only the first)',/R2 \(reserved\)/.test(r.err&&r.err.message||''),r.err&&r.err.message);
    s.ok('the untouched roll is not blamed',!/R3/.test(r.err&&r.err.message||''));
    s.ok('refused on the page\'s own data, before any write is attempted',/Nothing was deleted/.test(r.err&&r.err.message||''),r.err&&r.err.message);
    s.eq('nothing deleted, nothing changed',J([...a.fs.store.entries()]),before);
    s.ok('the receipt is still in page memory',a.ctx.allFabricIn.some(x=>x.id==='FAB-001'));
  }
  s.section('5 — a partly used roll counts as used');
  {
    const a=app();
    seedReceipt(a,[roll('R1',12,{partiallyConsumed:true,originalWeight:20,consumptionLog:[{po:'PO-7',weight:8,ts:5000,gp:'GP-010'}]}),roll('R2',10)],null,['R1','R2']);
    const before=J([...a.fs.store.entries()]);
    const r=await attempt(a.run("window._fabDeleteReceipt('FAB-001')"));
    s.ok('refused, naming R1 as partly used',!!r.err&&/R1 \(partly used\)/.test(r.err.message),r.err&&r.err.message);
    s.ok('on the page\'s own data (before any write)',/Nothing was deleted/.test(r.err&&r.err.message||''),r.err&&r.err.message);
    s.eq('nothing deleted',J([...a.fs.store.entries()]),before);
  }
  s.section('5 — stale page: the LIVE data decides, inside the transaction');
  {
    const a=app();
    // The page believes both rolls are untouched; on the server R1 was issued and R2 was partly drawn since.
    seedReceipt(a,[roll('R1',10,{status:'issued',issuedTo:'GP-1'}),roll('R2',12,{partiallyConsumed:true,originalWeight:20,consumptionLog:[{po:'PO-7',weight:8,ts:5000,gp:'GP-010'}]})],[roll('R1',10),roll('R2',20)],['R1','R2']);
    const before=J([...a.fs.store.entries()]);
    const r=await attempt(a.run("window._fabDeleteReceipt('FAB-001')"));
    s.eq('the engine aborts with the roll-unavailable code',r.err&&r.err.code,'fabric/rolls-unavailable');
    s.eq('naming both rolls',J(r.err&&r.err.rollCodes),'["R1","R2"]');
    s.eq('the receipt doc and the stock are untouched',J([...a.fs.store.entries()]),before);
    s.ok('the receipt stays in page memory',a.ctx.allFabricIn.some(x=>x.id==='FAB-001'));
  }
  s.section('5 — an untouched receipt still deletes, in one transaction');
  {
    const a=app();
    seedReceipt(a,[roll('R1',10),roll('R2',10)],null,['R1','R2']);
    await a.run("window._fabDeleteReceipt('FAB-001')");
    s.ok('receipt doc deleted',!a.fs.store.has('fabricin/FAB-001'));
    s.eq('rolls removed from stock',(inv(a,K1).rolls||[]).length,0);
    s.eq('one transaction',a.fs.stats.tx,1);
    s.ok('and gone from page memory',!a.ctx.allFabricIn.some(x=>x.id==='FAB-001'));
  }
  s.section('5 — the single-roll delete is unchanged (refusePartlyUsed is opt-in)');
  {
    const a=app();
    J1(a,[roll('R1',12,{partiallyConsumed:true,consumptionLog:[{po:'PO-7',weight:8,ts:5000}]})]);
    await a.run("_fabInvUpsert({fabType:'Jersey',gsm:220,color:'Black',unit:'kg',deleteRollCodes:['R1'],sourceCol:'fabric_inventory',sourceId:'x'})");
    s.eq('a roll-level delete of a partly used in-stock roll still goes through (owner action, as before)',(inv(a,K1).rolls||[]).length,0);
  }

  // ═══ 6 — the GP number is minted INSIDE the issue transaction (wave 2b) ═
  const counterOf=a=>a.fs.store.get('counters/main');
  const snap=a=>J([...a.fs.store.entries()]);
  const twoFabrics=(a,gone)=>{
    J1(a,[roll('A1',10),roll('A2',20)]);
    T2(a,[roll('B1',30),roll('B2',40,{status:'issued',issuedTo:'GP-050'})],[roll('B1',30),roll('B2',40)]);
    pick(a,[{key:K1,type:'Jersey',gsm:220,color:'Black',code:'A1',weight:10},{key:K2,type:'Twill',gsm:300,color:'Navy',code:gone?'B2':'B1',weight:gone?40:30}]);
  };
  s.section('6 — a REFUSED issue (a roll is gone) leaves counters/main exactly as it was');
  {
    const a=app();
    a.fs.store.set('counters/main',{pos:3,gatepasses:5,bundles:2});
    twoFabrics(a,true);
    const before=snap(a);
    await a.run('window.submitFabricIssue()');
    s.eq('the whole store is byte-identical — counter included',snap(a),before);
    s.eq('gatepasses counter still 5',counterOf(a).gatepasses,5);
    s.ok('the refusal names the roll',/B2/.test(lastToast(a)),lastToast(a));
    // with no counters document at all, a refusal must not create one
    const b=app();
    twoFabrics(b,true);
    await b.run('window.submitFabricIssue()');
    s.ok('no counters/main is created by a refused issue',!b.fs.store.has('counters/main'),J(counterOf(b)));
    // the retry after the roll problem is fixed gets the number the refusal did not spend
    b.fs.store.get('fabric_inventory/'+K2).rolls[1]=roll('B2',40);
    await b.run('window.submitFabricIssue()');
    s.ok('the retry is GP-001 — the refusal burned nothing',b.fs.store.has('gatepasses/GP-001'),b.fs.keys('gatepasses/').join(','));
  }
  s.section('6 — a FAILED commit (network lost mid-transaction) spends no number');
  {
    const a=app();
    a.fs.store.set('counters/main',{pos:0,gatepasses:7,bundles:0});
    twoFabrics(a,false);
    const orig=a.ctx.runTransaction;
    a.ctx.runTransaction=async(d,fn)=>orig(d,async tx=>{await fn(tx);throw new Error('network lost before commit');});
    const before=snap(a);
    await a.run('window.submitFabricIssue()');
    s.ok('the error is shown',/network lost/.test(lastToast(a)),lastToast(a));
    s.eq('nothing changed: counter, pass, stock',snap(a),before);
    a.ctx.runTransaction=orig;
    await a.run('window.submitFabricIssue()');
    s.ok('the next press issues GP-008 — 7 was never spent',a.fs.store.has('gatepasses/GP-008'),a.fs.keys('gatepasses/').join(','));
  }
  s.section('6 — a GOOD issue moves the counter by exactly one, in the same commit as the roll takes');
  {
    const a=app();
    a.fs.store.set('counters/main',{pos:3,gatepasses:5,bundles:2});
    twoFabrics(a,false);
    await a.run('window.submitFabricIssue()');
    s.eq('counter 5 → 6, other counters untouched',J(counterOf(a)),J({pos:3,gatepasses:6,bundles:2}));
    s.ok('the pass is GP-006',a.fs.store.has('gatepasses/GP-006'));
    s.eq('the pass document carries its own id',a.fs.store.get('gatepasses/GP-006').id,'GP-006');
    s.eq('ONE transaction did the counter, the pass and both fabrics',a.fs.stats.tx,1);
    s.eq('rolls name the pass',rollOf(a,K1,'A1').issuedTo+'|'+rollOf(a,K2,'B1').issuedTo,'GP-006|GP-006');
    s.ok('movements are stamped with the minted id',movs(a).length===2&&movs(a).every(m=>m.sourceId==='GP-006'),J(movs(a).map(m=>m.sourceId)));
    s.ok('the success toast names it',/GP-006 issued/.test(lastToast(a)),lastToast(a));
    s.ok('the activity row names it',a.state.activity.some(x=>x.action==='Fabric issued'&&/^GP-006 /.test(x.detail)),J(a.state.activity));
    const b=app();
    twoFabrics(b,false);
    await b.run('window.submitFabricIssue()');
    s.eq('with no counters document the first issue creates it at 1',counterOf(b)&&counterOf(b).gatepasses,1);
    s.ok('and is GP-001',b.fs.store.has('gatepasses/GP-001'));
  }

  s.section('6 — a counter that LAGS behind a pass that exists never overwrites it (floor)');
  {
    const a=app();
    a.fs.store.set('counters/main',{pos:0,gatepasses:4,bundles:0});
    const old={id:'GP-005',ts:1,gpType:'garments',article:'KEEP ME',date:'2026-10-01'},hi={id:'GP-009',ts:2,gpType:'garments',article:'AND ME',date:'2026-10-02'};
    [old,hi].forEach(g=>{a.fs.store.set('gatepasses/'+g.id,clone(g));a.ctx.allPasses.push(clone(g));});
    twoFabrics(a,false);
    await a.run('window.submitFabricIssue()');
    s.ok('minted ABOVE the highest pass on file: GP-010',a.fs.store.has('gatepasses/GP-010'),a.fs.keys('gatepasses/').join(','));
    s.eq('GP-005 is untouched',J(a.fs.store.get('gatepasses/GP-005')),J(old));
    s.eq('GP-009 is untouched',J(a.fs.store.get('gatepasses/GP-009')),J(hi));
    s.eq('the counter is lifted to 10',counterOf(a).gatepasses,10);
  }
  {
    // The page has NOT loaded the passes: the floor is read from the server list.
    const a=app();
    a.fs.store.set('counters/main',{pos:0,gatepasses:0,bundles:0});
    a.fs.store.set('gatepasses/GP-003',{id:'GP-003',article:'ON THE SERVER'});
    twoFabrics(a,false);
    await a.run('window.submitFabricIssue()');
    s.ok('with an empty page list the server list sets the floor: GP-004',a.fs.store.has('gatepasses/GP-004'),a.fs.keys('gatepasses/').join(','));
    s.eq('GP-003 untouched',a.fs.store.get('gatepasses/GP-003').article,'ON THE SERVER');
  }
  {
    // A page list that is STALE (a pass made elsewhere): the in-transaction exists check is the backstop.
    const a=app();
    a.fs.store.set('counters/main',{pos:0,gatepasses:2,bundles:0});
    a.fs.store.set('gatepasses/GP-003',{id:'GP-003',article:'MADE ON ANOTHER PHONE'});
    a.ctx.allPasses.push({id:'GP-002',article:'x'});
    twoFabrics(a,false);
    const before=snap(a);
    await a.run('window.submitFabricIssue()');
    s.ok('refused: the id is taken',/GP-003 already exists/.test(lastToast(a)),lastToast(a));
    s.eq('nothing at all changed — GP-003 not overwritten, counter not moved, no roll taken',snap(a),before);
  }
  {
    // Nothing trustworthy to floor from (cache-only read, no list): refuse BEFORE any write.
    const a=app({globals:{getDocs:async()=>({metadata:{fromCache:true},docs:[]})}});
    a.fs.store.set('counters/main',{pos:0,gatepasses:2,bundles:0});
    twoFabrics(a,false);
    const before=snap(a);
    await a.run('window.submitFabricIssue()');
    s.ok('told to reload, nothing saved',/Reload the page first/.test(lastToast(a))&&/Nothing was saved/.test(lastToast(a)),lastToast(a));
    s.eq('no transaction was even attempted',a.fs.stats.tx,0);
    s.eq('store untouched',snap(a),before);
  }

  // ═══ 7 — 'm' is metres in js/gatepass.js too (wave 2b) ═════════════════
  s.section("7 — the gate-pass EDIT label and totals read 'm', 'meters' and 'kg' correctly");
  {
    const a=app();
    let cap=null;a.ctx.document.body.appendChild=e=>{cap=e;};
    const label=unit=>{a.ctx.allPasses.length=0;a.ctx.allPasses.push({id:'G1',gpType:'fabric',fabricUnit:unit,fabricQty:30,rollsCount:2,date:'2026-10-10'});cap=null;a.run("window.editGP('G1')");return String(cap&&cap.innerHTML).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');};
    s.ok("'m' (an issue taken from an 'm' bucket) reads as LENGTH",/Total length \(meters\)/i.test(label('m')),label('m'));
    s.ok("'meters' still reads as length",/Total length \(meters\)/i.test(label('meters')));
    s.ok("'Metres' (by hand) reads as length",/Total length \(meters\)/i.test(label('Metres')));
    s.ok("'kg' reads as weight",/Total weight \(kg\)/i.test(label('kg')));
    s.ok("no unit reads as weight",/Total weight \(kg\)/i.test(label('')));
    const payload=(unit)=>{
      a.el('gpe-type').value='fabric';a.el('gpe-fab-unit').value=unit;a.el('gpe-fab-qty').value='30';a.el('gpe-fab-rolls').value='2';
      return a.run('_collectGPEditPayload()');
    };
    const pm=payload('m'),pM=payload('meters'),pk=payload('kg');
    s.eq("edit totals: 'm' → totalLength 30, totalWeight 0",pm.totalLength+'|'+pm.totalWeight,'30|0');
    s.eq("edit totals: 'meters' → totalLength 30, totalWeight 0",pM.totalLength+'|'+pM.totalWeight,'30|0');
    s.eq("edit totals: 'kg' → totalWeight 30, totalLength 0",pk.totalWeight+'|'+pk.totalLength,'30|0');
    s.eq("the edit keeps the unit EXACTLY as stored (read-only normalisation)",pm.fabricUnit+'|'+pM.fabricUnit,'m|meters');
  }
  s.section("7 — the PDF: legacy path labels 'm' as Total Length; the engine path passes the stored unit through untouched");
  {
    const a=app();
    const texts=[];
    class FakePdf{constructor(){}setFillColor(){}rect(){}setTextColor(){}setFontSize(){}setFont(){}text(t){texts.push(String(t));}setDrawColor(){}setLineWidth(){}line(){}addPage(){}save(){}}
    a.ctx.window=a.ctx.window||a.ctx;
    a.ctx.window.jspdf={jsPDF:FakePdf};a.ctx.jspdf={jsPDF:FakePdf};
    const pass=(unit)=>({id:'G'+unit,gpType:'fabric',fabricUnit:unit,fabricQty:30,rollsCount:2,date:'2026-10-10',name:'x',article:'a',dest:'Factory'});
    a.ctx.allPasses.push(pass('m'),pass('meters'),pass('kg'));
    a.run('window.__usePrintEngine=false');
    const render=id=>{texts.length=0;a.run(`window.generateGPPdf(${J(id)})`);return texts.slice();};
    const tm=render('Gm');
    s.ok("legacy PDF, unit 'm': Total Length, '30 m'",tm.includes('Total Length')&&tm.includes('30 m')&&!tm.includes('Total Weight'),J(tm));
    s.ok("legacy PDF, unit 'meters': Total Length",render('Gmeters').includes('Total Length'));
    const tk=render('Gkg');
    s.ok("legacy PDF, unit 'kg': Total Weight, '30 kg'",tk.includes('Total Weight')&&tk.includes('30 kg')&&!tk.includes('Total Length'),J(tk));
    // engine path: the data handed to the engine keeps the stored unit (the engine prints it beside the number)
    let sent=null;a.run('window.__usePrintEngine=true');a.ctx.window.printDocument=d=>{sent=d;};a.ctx.printDocument=a.ctx.window.printDocument;
    a.run("window.generateGPPdf('Gm')");
    s.eq("engine data: unit passed through as stored ('m')",sent&&sent.data.fabricUnit,'m');
    s.eq('and the stored pass was not rewritten',a.ctx.allPasses.find(p=>p.id==='Gm').fabricUnit,'m');
  }
  s.section("7 — the outward fabric picker lists buckets stored as 'm' for a metres pass");
  {
    const a=app();
    seed(a,[roll('M1',30,{unit:'m'})],K2,'Twill',300,'Navy','m');
    seed(a,[roll('M2',5,{unit:'meters'})],'drill__200gsm__grey','Drill',200,'Grey','meters');
    seed(a,[roll('K1',9)],K1,'Jersey',220,'Black','kg');
    const listed=(unit)=>{const sel=a.el('gp-fab-stock');sel.innerHTML='';a.run(`_populateFabStockSelect(${J(unit)})`);return String(sel.innerHTML);};
    const m=listed('meters');
    s.ok("a 'meters' pass lists the 'm' bucket AND the 'meters' bucket",m.includes(K2)&&m.includes('drill__200gsm__grey'),m);
    s.ok('and not the kg bucket',!m.includes(K1),m);
    const k=listed('kg');
    s.ok('a kg pass lists only kg buckets',k.includes(K1)&&!k.includes(K2),k);
  }

  // ═══ 8 — Delete all: a capped toast, the full list in the log (wave 2b) ═
  s.section('8 — the delete-all toast names the first 3 refused issues, then "and N more"');
  {
    const mk=(a,n)=>{
      J1(a,[]);                                              // the bucket exists but holds none of the issued rolls
      for(let i=1;i<=n;i++){
        const id='GP-1'+String(i).padStart(2,'0');
        const g={id,ts:9000-i,gpType:'fabric',poId:'PO-7',fabricUnit:'kg',fabricType:'Jersey',fabricGsm:220,fabricColor:'Black',inventoryKey:K1,rollCodes:['X'+i],partialRolls:[],
          fabrics:[{inventoryKey:K1,fabType:'Jersey',gsm:220,color:'Black',unit:'kg',rollCodes:['X'+i]}]};
        a.fs.store.set('gatepasses/'+id,clone(g));a.ctx.allPasses.push(clone(g));
      }
    };
    const a=app();mk(a,6);
    await a.run('window.fabRegDeleteAll()');
    const t=lastToast(a);
    s.ok('the first three issue numbers are named',['GP-101','GP-102','GP-103'].every(k=>t.includes(k))||['GP-106','GP-105','GP-104'].every(k=>t.includes(k)),t);
    s.ok('"and 3 more" closes the list',/and 3 more/.test(t),t);
    s.eq('exactly 3 issue numbers appear',(t.match(/GP-1\d\d/g)||[]).length,3);
    s.ok('the toast says where the full list is',/Activity Log/.test(t),t);
    s.ok('it stays short (under 160 characters)',t.length<160,t.length+': '+t);
    const log=a.state.activity.find(x=>x.action==='Fabric issues cleared');
    s.ok('the activity log keeps ALL six, each with its rolls',!!log&&[1,2,3,4,5,6].every(i=>log.detail.includes(`GP-10${i} (X${i})`)),log&&log.detail);
    s.eq('nothing was deleted (all refused)',a.fs.keys('gatepasses/').length,6);
    const b=app();mk(b,3);
    await b.run('window.fabRegDeleteAll()');
    s.ok('exactly 3 refused: all named, no "and N more"',!/more/.test(lastToast(b))&&(lastToast(b).match(/GP-1\d\d/g)||[]).length===3,lastToast(b));
    s.eq('_fabRefusedToast([]) is empty',a.run('_fabRefusedToast([])'),'');
    s.eq('_fabRefusedToast with 4 → 3 + "and 1 more"',a.run("_fabRefusedToast(['a','b','c','d'])"),'a; b; c and 1 more');
  }

  return s;
};

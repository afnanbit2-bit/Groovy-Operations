/* QC reconciliation WRITERS (QC4, 15 Oct 2026): js/ph-write.js phQcLockCut / phQcAdoptLegacy and js/ph-qc-write.js phQcAddLot /
   phQcVoidLot / phQcClose / phQcRelock / phQcReopen, driven over an in-memory Firestore with real transaction semantics that records
   every read and write (and which transaction each write belongs to).

   What this holds: one transaction per action carrying the reconciliation, the lot, the classic packingReceipts mirror and the
   history row together; the lot counter; expectedRev; offline and forbidden refused before any write; a lot over cut + allowance
   refused BEFORE any round trip; the 24 h own-lot void; the close's pos patch is EXACTLY the classic completeQC fields (read from
   js/pos.js) plus the two additive keys; the CHANGE FROM THE PLAN (a manager closes a PO still receiving or short, with a reason, an
   overrides row and bell rows in the same transaction; the floor only a 'ready' one); relock only when the PO's cut changed; the old
   Packing receipts adopted once; no nested arrays anywhere.
   NOT proved here: the rules engine (tests/rules-emulator-ph.js runs these writers against the real emulator), real Firestore, a screen.
   Each "break" mutates one source line and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=JSON.stringify;
const FILES=['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-qc-write.js'];
const T0=Date.UTC(2026,9,15,6,0,0);            // 15 Oct 2026 11:00 PKT
const CUT={S:20,M:40,L:40,XL:20};
const P='PO-001';
const PEOPLE={faizan:{u:'faizan',name:'Faizan'},afnan:{u:'afnan',name:'Afnan'},ammar:{u:'ammar',name:'Ammar'},mustafa:{u:'mustafa',name:'Mustafa'},
  uzaib:{u:'uzaib',name:'Uzaib'},arfat:{u:'arfat',name:'Arfat'},raees:{u:'raees',name:'Raees'}};

/* ── an in-memory Firestore: transactions buffer their writes and commit all-or-nothing; where('==') filters ── */
function makeFake(o){
  o=o||{};
  const store={};const log={reads:[],writes:[],queries:[],tx:0,deletes:0};
  const clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
  const has=p=>Object.prototype.hasOwnProperty.call(store,p);
  const snapDoc=p=>({id:p.split('/').pop(),exists:()=>has(p),data:()=>clone(store[p]),metadata:{fromCache:false}});
  const api={
    db:{},
    doc:(db,...s)=>({path:s.join('/'),id:s[s.length-1]}),
    collection:(db,...s)=>({path:s.join('/'),isCol:true}),
    where:(f,op,v)=>({where:[f,op,v]}),limit:n=>({limit:n}),orderBy:(f,d)=>({orderBy:[f,d]}),
    query:(c,...cons)=>({path:c.path,wheres:cons.filter(x=>x&&x.where).map(x=>x.where),limit:(cons.filter(x=>x&&x.limit!==undefined)[0]||{}).limit}),
    getDoc:async r=>{log.reads.push(r.path);return snapDoc(r.path);},
    getDocs:async q=>{
      log.queries.push({path:q.path,wheres:q.wheres,limit:q.limit});
      if(o.failLots&&q.path==='po_qc_lots')throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      let docs=Object.keys(store).filter(k=>k.indexOf(q.path+'/')===0&&k.slice(q.path.length+1).indexOf('/')===-1).sort();
      (q.wheres||[]).forEach(w=>{docs=docs.filter(k=>w[1]==='=='&&store[k][w[0]]===w[2]);});
      if(q.limit!==undefined)docs=docs.slice(0,q.limit);
      return{docs:docs.map(snapDoc),metadata:{fromCache:false}};
    },
    setDoc:async(r,d)=>{log.writes.push({op:'set',path:r.path,tx:0,data:clone(d)});store[r.path]=clone(d);},
    updateDoc:async(r,d)=>{log.writes.push({op:'update',path:r.path,tx:0,data:clone(d)});store[r.path]=Object.assign({},store[r.path],clone(d));},
    deleteDoc:async r=>{log.deletes++;delete store[r.path];},
    runTransaction:async(db,fn)=>{
      const id=++log.tx;const buf=[];
      const tx={
        get:async r=>{log.reads.push(r.path);return snapDoc(r.path);},
        set:(r,d)=>{buf.push({op:'set',path:r.path,data:clone(d)});return tx;},
        update:(r,d)=>{if(!has(r.path)&&!buf.some(b=>b.path===r.path))throw new Error('not-found');buf.push({op:'update',path:r.path,data:clone(d)});return tx;},
        delete:r=>{log.deletes++;buf.push({op:'delete',path:r.path});return tx;}
      };
      const res=await fn(tx);
      buf.forEach(b=>{log.writes.push({op:b.op,path:b.path,tx:id,data:b.data});
        if(b.op==='set')store[b.path]=b.data;else if(b.op==='update')store[b.path]=Object.assign({},store[b.path],b.data);else delete store[b.path];});
      return res;
    }
  };
  return{store,log,api};
}
// mut: {file: [[from,to],...]} -- a source mutation for a "break"
function mk(o){
  o=o||{};
  const fk=makeFake(o);
  const globals=Object.assign({},fk.api,{navigator:{onLine:!o.offline},auth:{currentUser:null},console:{warn(){},log(){},error(){}}},o.globals||{});
  const app=harness.loadApp({files:[],session:o.session||{u:'faizan',name:'Faizan',role:'packing'},globals});
  const mut=o.mut||{};
  for(const f of FILES){
    let src=read(f);
    (mut[f]||[]).forEach(([a,b])=>{if(src.indexOf(a)<0)throw new Error('break target missing in '+f+': '+a.slice(0,60));src=src.split(a).join(b);});
    vm.runInContext(src,app.ctx,{filename:f});
  }
  const call=async(who,expr)=>{
    const p=PEOPLE[who];
    app.ctx.session={u:p.u,name:p.name,role:'x'};
    return app.run('(async()=>{return await '+expr+';})()');
  };
  return{app,fk,store:fk.store,log:fk.log,call,run:c=>app.run(c)};
}
let tick=0;const nx=()=>T0+(++tick)*1000;
const A=(who,extra)=>J(Object.assign({actor:PEOPLE[who],now:nx()},extra||{}));
const po=over=>Object.assign({id:P,qty:120,code:'GAT012',name:'Athletic Tee',poStatus:'in_production',currentStage:'qc',stages:{cutting:{done:true},qc:{done:false}},
  cutQty:Object.assign({},CUT),cutDate:'2026-10-01',cutAt:'2026-10-01T10:00:00.000Z',cutBy:'Uzaib',packingReceipts:[]},over||{});
const seedPo=(m,over)=>{m.store['pos/'+P]=po(over);};
const lotsOf=m=>Object.keys(m.store).filter(k=>k.indexOf('po_qc_lots/')===0).map(k=>m.store[k]);
const hist=m=>Object.keys(m.store).filter(k=>k.indexOf('pos/'+P+'/history/')===0).map(k=>m.store[k]);
const recvSum=m=>(m.store['pos/'+P].packingReceipts||[]).reduce((a,e)=>a+e.qty,0);
const nested=x=>{const f=(v,inArr)=>Array.isArray(v)?(inArr||v.some(e=>f(e,true))):(v&&typeof v==='object'?Object.keys(v).some(k=>f(v[k],false)):false);return f(x,false);};
const add=(m,who,sizes,rev,extra)=>m.call(who,'phQcAddLot("'+P+'",'+J(Object.assign({sizes:sizes},extra||{}))+','+A(who,{expectedRev:rev,rand:'r'+String(tick).padStart(3,'0').slice(-3)})+')');
// The classic Final QC patch, read from js/pos.js window.completeQC (so a change there is seen here)
const CLASSIC=(()=>{const t=read('js/pos.js');const m=/window\.completeQC=async function[\s\S]*?updateDoc\(doc\(db,'pos',fbKey\),\{([\s\S]*?)\}\);/.exec(t);
  return m?[...m[1].matchAll(/(?:^|,)\s*(?:\[`([^`]+)`\]|([A-Za-z]+))\s*:/g)].map(x=>x[1]||x[2]):[];})();

/* ── the named checks, each a scenario that returns true when the behaviour holds ── */
const SC={
  'the first lot locks the cut in ONE transaction: the reconciliation, the lot, the packingReceipts mirror and the history row':async(o)=>{
    const m=mk(o);seedPo(m);
    const r=await add(m,'faizan',{S:20,M:20,L:20,XL:10},0,{day:'2026-10-05',note:'  first rack  '});
    if(!r.ok)return false;
    const tw=m.log.writes.filter(w=>w.tx===m.log.tx);
    const paths=tw.map(w=>w.path).sort();
    const rec=m.store['po_qc_recon/'+P],lot=m.store['po_qc_lots/'+r.lotId];
    return m.log.tx===1&&paths.length===4&&paths[0]==='po_qc_lots/'+r.lotId&&paths[1]==='po_qc_recon/'+P&&paths[2]==='pos/'+P&&/^pos\/PO-001\/history\/[0-9]{13}-/.test(paths[3])
      &&J(rec.cutLock.sizes)===J(CUT)&&rec.cutLock.source==='first_lot'&&rec.status==='locked'&&rec.rev===1&&rec.lotCount===1
      &&lot.seq===1&&lot.total===70&&lot.src==='qc'&&lot.note==='first rack'&&lot.by==='faizan'&&lot.day==='2026-10-05'
      &&recvSum(m)===70&&m.store['pos/'+P].packingReceipts.every(e=>e.src==='qc'&&e.receiptId===r.lotId)
      &&hist(m).length===1&&hist(m)[0].type==='qc_lot_added'&&hist(m)[0].data.seq===1;
  },
  'the second lot is seq 2, lotCount 2, rev 2, and the cut snapshot is untouched':async(o)=>{
    const m=mk(o);seedPo(m);
    const a=await add(m,'faizan',{S:20},0);const b=await add(m,'faizan',{M:10},1);
    const rec=m.store['po_qc_recon/'+P];
    return a.ok&&b.ok&&b.seq===2&&rec.lotCount===2&&rec.rev===2&&J(rec.cutLock.sizes)===J(CUT)&&lotsOf(m).map(l=>l.seq).sort().join()==='1,2';
  },
  'a stale expectedRev is refused (stale) and nothing is written':async(o)=>{
    const m=mk(o);seedPo(m);
    await add(m,'faizan',{S:20},0);const n=m.log.writes.length;
    const r=await add(m,'faizan',{M:10},0);
    return!r.ok&&r.code==='stale'&&m.log.writes.length===n;
  },
  'offline: refused out loud before any read or write':async(o)=>{
    const m=mk(Object.assign({},o,{offline:true}));seedPo(m);
    const r=await add(m,'faizan',{S:20},0);
    return!r.ok&&r.code==='offline'&&m.log.writes.length===0&&m.log.queries.length===0&&m.log.tx===0;
  },
  'Faizan is refused relock, reopen and close outside the tolerance (forbidden, nothing written)':async(o)=>{
    const m=mk(o);seedPo(m);
    await add(m,'faizan',{S:20,M:38,L:40,XL:20},0);const n=m.log.writes.length;
    m.store['pos/'+P].cutQty={S:20,M:42,L:40,XL:20};
    const a=await m.call('faizan','phQcRelock("'+P+'",'+A('faizan',{expectedRev:1,reason:'recounted M'})+')');
    const c=await m.call('faizan','phQcClose("'+P+'",'+A('faizan',{expectedRev:1,reason:'two lost here',cause:'lost_in_line'})+')');
    m.store['po_qc_recon/'+P].status='closed';
    const b=await m.call('faizan','phQcReopen("'+P+'",'+A('faizan',{expectedRev:1,reason:'recount asked'})+')');
    return[a,b,c].every(r=>!r.ok&&r.code==='forbidden')&&m.log.writes.length===n;
  },
  'Arfat (the manager ROLE, on no list) and Kashif are refused every QC writer before any round trip':async(o)=>{
    const m=mk(o);seedPo(m);
    const out=[];
    for(const w of ['arfat','uzaib','raees']){
      out.push(await add(m,w,{S:1},0));
      out.push(await m.call(w,'phQcLockCut("'+P+'",'+A(w,{expectedRev:0})+')'));
      out.push(await m.call(w,'phQcClose("'+P+'",'+A(w,{expectedRev:1})+')'));
      out.push(await m.call(w,'phQcVoidLot("'+P+'-'+T0+'-abcd","wrong",'+A(w)+')'));
      out.push(await m.call(w,'phQcAdoptLegacy("'+P+'",'+A(w,{expectedRev:0,reason:'old receipts'})+')'));
    }
    return out.every(r=>!r.ok&&r.code==='forbidden')&&m.log.writes.length===0&&m.log.tx===0&&m.log.queries.length===0;
  },
  'a lot over cut + allowance is refused BEFORE any round trip, naming the size and the allowance':async(o)=>{
    const m=mk(o);seedPo(m);
    await add(m,'faizan',{S:20,M:40,L:40,XL:20},0);
    m.app.ctx.allPOs=[Object.assign({fbKey:P},m.store['pos/'+P])];
    await m.call('faizan','phLoadAll({only:["recon","lots"]})');
    const q=m.log.queries.length,t=m.log.tx;
    const r=await add(m,'faizan',{M:2},1);
    const r2=await add(m,'faizan',{XXS:1},1);
    return!r.ok&&r.code==='refused'&&/M has 40 cut, 40 received, this lot adds 2 - the allowance is 1/.test(r.error)&&!r2.ok&&/was not cut/.test(r2.error)&&m.log.queries.length===q&&m.log.tx===t;
  },
  'the transaction checks the lot again: over the allowance is refused and nothing is written':async(o)=>{
    const m=mk(o);seedPo(m);
    await add(m,'faizan',{S:20,M:40,L:40,XL:20},0);const n=m.log.writes.length;
    const r=await add(m,'faizan',{S:1},1);
    return!r.ok&&r.code==='refused'&&/allowance is 0/.test(r.error)&&m.log.writes.length===n;
  },
  'void: Faizan his OWN lot within 24 h (a counter entry nets the classic sum); after 24 h refused; another person\'s refused; a manager any time':async(o)=>{
    const m=mk(o);seedPo(m);
    const a=await add(m,'faizan',{S:10},0);
    const v=await m.call('faizan','phQcVoidLot("'+a.lotId+'","typed the wrong size",'+A('faizan')+')');
    const ok1=v.ok&&recvSum(m)===0&&m.store['po_qc_lots/'+a.lotId].status==='void'&&m.store['po_qc_recon/'+P].voidCount===1&&m.store['po_qc_lots/'+a.lotId].seq===1;
    const b=await add(m,'faizan',{S:10},2);
    const late=await m.call('faizan','phQcVoidLot("'+b.lotId+'","wrong one",'+J({actor:PEOPLE.faizan,now:T0+tick*1000+25*3600000})+')');
    const c=await add(m,'mustafa',{M:5},3);
    const other=await m.call('faizan','phQcVoidLot("'+c.lotId+'","not mine",'+A('faizan')+')');
    const mgr=await m.call('mustafa','phQcVoidLot("'+b.lotId+'","counted twice",'+J({actor:PEOPLE.mustafa,now:T0+tick*1000+30*3600000})+')');
    return ok1&&!late.ok&&late.code==='forbidden'&&!other.ok&&other.code==='forbidden'&&mgr.ok&&m.store['po_qc_recon/'+P].voidCount===2;
  },
  'a void appends NEGATIVE counter entries (src qc, voidOf) and never rewrites or removes the receipts already there':async(o)=>{
    const m=mk(o);seedPo(m,{packingReceipts:[{id:'RCV-1-S',receiptId:'RCV-1',size:'S',qty:3,ts:'x',by:'Faizan'}]});
    const a=await add(m,'faizan',{S:10,M:5},0);
    const before=J(m.store['pos/'+P].packingReceipts);
    await m.call('faizan','phQcVoidLot("'+a.lotId+'","wrong size",'+A('faizan')+')');
    const pr=m.store['pos/'+P].packingReceipts;
    const neg=pr.filter(e=>e.qty<0);
    return J(pr.slice(0,JSON.parse(before).length))===before&&neg.length===2&&neg.every(e=>e.src==='qc'&&e.voidOf===a.lotId&&/^QV-/.test(e.id))&&recvSum(m)===3;
  },
  'close inside the tolerance: the pos patch is EXACTLY the classic completeQC fields plus qcReconClosedAt / qcReconClosedBy, in the close\'s transaction':async(o)=>{
    const m=mk(o);seedPo(m);
    await add(m,'faizan',{S:20,M:39,L:40,XL:20},0);
    const c=await m.call('faizan','phQcClose("'+P+'",'+A('faizan',{expectedRev:1})+')');
    if(!c.ok)return false;
    const w=m.log.writes.filter(x=>x.tx===m.log.tx&&x.path==='pos/'+P)[0];
    const keys=Object.keys(w.data);
    const classic=CLASSIC.slice().sort(),mine=keys.filter(k=>k!=='qcReconClosedAt'&&k!=='qcReconClosedBy').sort();
    return CLASSIC.length===5&&J(mine)===J(classic)&&keys.length===7&&w.data.currentStage==='completed'&&w.data['stages.qc.done']===true
      &&/^2026-10-15T/.test(w.data['stages.qc.doneAt'])&&w.data['stages.qc.doneBy']==='Faizan'&&/119 of 120/.test(w.data['stages.qc.notes'])
      &&w.data.qcReconClosedBy==='faizan'&&typeof w.data.qcReconClosedAt==='number'&&c.action==='close'&&m.store['po_qc_recon/'+P].closeVerdict.state==='within'
      &&hist(m).some(h=>h.type==='qc_closed')&&!Object.keys(m.store).some(k=>/^hrm_notifications\//.test(k));
  },
  'a PO the classic flow already completed gets ONLY the two additive keys on close (nothing it stored is rewritten)':async(o)=>{
    const m=mk(o);seedPo(m);
    await add(m,'faizan',{S:20,M:40,L:40,XL:20},0);
    Object.assign(m.store['pos/'+P],{currentStage:'completed',stages:{cutting:{done:true},qc:{done:true,doneAt:'2026-10-10T00:00:00.000Z',doneBy:'Haris',notes:''}}});
    const c=await m.call('faizan','phQcClose("'+P+'",'+A('faizan',{expectedRev:1})+')');
    const w=m.log.writes.filter(x=>x.tx===m.log.tx&&x.path==='pos/'+P)[0];
    return c.ok&&J(Object.keys(w.data).sort())===J(['qcReconClosedAt','qcReconClosedBy'])&&m.store['pos/'+P].stages.qc.doneBy==='Haris';
  },
  'a SHORT close: refused for Faizan (nothing written); Mustafa with a reason and a cause closes it, an overrides row, qc_closed_short and bell rows to afnan and ammar IN THE SAME transaction':async(o)=>{
    const m=mk(o);seedPo(m);
    await add(m,'faizan',{S:20,M:38,L:40,XL:20},0);const n=m.log.writes.length;
    const f=await m.call('faizan','phQcClose("'+P+'",'+A('faizan',{expectedRev:1,reason:'two lost in line',cause:'lost_in_line'})+')');
    if(f.ok||f.code!=='forbidden'||m.log.writes.length!==n)return false;
    const c=await m.call('mustafa','phQcClose("'+P+'",'+A('mustafa',{expectedRev:1,reason:'  two lost in the line  ',cause:'lost_in_line'})+')');
    const tw=m.log.writes.filter(x=>x.tx===m.log.tx);
    const bells=tw.filter(x=>/^hrm_notifications\//.test(x.path)).map(x=>x.data.forUser).sort();
    const rec=m.store['po_qc_recon/'+P];
    return c.ok&&c.action==='close_short'&&J(bells)===J(['afnan','ammar'])&&tw.some(x=>x.path==='po_qc_recon/'+P)&&tw.some(x=>x.path==='pos/'+P)
      &&rec.overrides.length===1&&rec.overrides[0].kind==='close_short'&&rec.overrides[0].cause==='lost_in_line'&&rec.overrides[0].reason==='two lost in the line'&&rec.overrides[0].by==='mustafa'
      &&rec.closeVerdict.phase==='short'&&hist(m).some(h=>h.type==='qc_closed_short')
      &&tw.filter(x=>/^hrm_notifications\//.test(x.path)).every(x=>x.data.priority==='high'&&x.data.forRole===''&&!/[<>]/.test(x.data.message));
  },
  'CHANGE FROM THE PLAN: a manager closes a PO still RECEIVING with a reason (5+) and a cause; without either it is refused; the floor never':async(o)=>{
    const m=mk(o);seedPo(m);
    await add(m,'faizan',{S:20,M:40,L:40},0);
    const f=await m.call('faizan','phQcClose("'+P+'",'+A('faizan',{expectedRev:1,reason:'XL lost for good',cause:'lost_in_line'})+')');
    const nr=await m.call('afnan','phQcClose("'+P+'",'+A('afnan',{expectedRev:1,reason:'lost',cause:'lost_in_line'})+')');
    const nc=await m.call('afnan','phQcClose("'+P+'",'+A('afnan',{expectedRev:1,reason:'XL lost for good',cause:'stolen'})+')');
    const ok=await m.call('afnan','phQcClose("'+P+'",'+A('afnan',{expectedRev:1,reason:'XL lost for good',cause:'lost_in_line'})+')');
    return!f.ok&&f.code==='forbidden'&&!nr.ok&&nr.code==='invalid'&&!nc.ok&&nc.code==='invalid'&&ok.ok&&ok.phase==='receiving'&&ok.action==='close_short'&&J(ok.told)===J(['ammar','mustafa']);
  },
  'nothing received at QC yet (a manager\'s lock only) cannot be closed, by anyone':async(o)=>{
    const m=mk(o);seedPo(m);
    await m.call('mustafa','phQcLockCut("'+P+'",'+A('mustafa',{expectedRev:0})+')');
    const a=await m.call('mustafa','phQcClose("'+P+'",'+A('mustafa',{expectedRev:1,reason:'nothing came',cause:'other'})+')');
    return!a.ok&&a.code==='refused'&&/Nothing has been received/.test(a.error);
  },
  'a PO before stitching cannot be closed; a cancelled PO cannot receive':async(o)=>{
    const m=mk(o);seedPo(m,{currentStage:'bundling'});
    await add(m,'faizan',{S:20,M:40,L:40,XL:20},0);
    const c=await m.call('faizan','phQcClose("'+P+'",'+A('faizan',{expectedRev:1})+')');
    const m2=mk(o);seedPo(m2,{poStatus:'cancelled'});
    const l=await add(m2,'faizan',{S:1},0);
    return!c.ok&&/from stitching on/.test(c.error)&&!l.ok&&l.code==='refused'&&!m2.store['po_qc_recon/'+P];
  },
  'relock: only an OWNER, only when the PO\'s cut was corrected; the new snapshot is the PO\'s cut and the old one is kept in the overrides row':async(o)=>{
    const m=mk(o);seedPo(m);
    await add(m,'faizan',{S:20},0);
    const same=await m.call('afnan','phQcRelock("'+P+'",'+A('afnan',{expectedRev:1,reason:'just checking'})+')');
    m.store['pos/'+P].cutQty={S:20,M:42,L:40,XL:20};
    const mu=await m.call('mustafa','phQcRelock("'+P+'",'+A('mustafa',{expectedRev:1,reason:'M recounted'})+')');
    const ok=await m.call('afnan','phQcRelock("'+P+'",'+A('afnan',{expectedRev:1,reason:'M recounted at cutting'})+')');
    const rec=m.store['po_qc_recon/'+P];
    return!same.ok&&same.code==='refused'&&!mu.ok&&mu.code==='forbidden'&&ok.ok&&J(rec.cutLock.sizes)===J({S:20,M:42,L:40,XL:20})&&rec.cutLock.source==='relock'
      &&J(rec.overrides[0].before)===J(CUT)&&J(ok.told)===J(['ammar','mustafa'])&&hist(m).some(h=>h.type==='qc_cut_relocked');
  },
  'the cut is never taken from the ORDERED sizes: a PO with no cutQty (or cutting not done) is refused':async(o)=>{
    const m=mk(o);seedPo(m,{cutQty:undefined,sizes:{S:20,M:40}});delete m.store['pos/'+P].cutQty;
    const a=await m.call('faizan','phQcLockCut("'+P+'",'+A('faizan',{expectedRev:0})+')');
    const m2=mk(o);seedPo(m2,{stages:{cutting:{done:false}}});
    const b=await add(m2,'faizan',{S:1},0);
    const m3=mk(o);seedPo(m3,{cutQty:{S:'20',M:40}});
    const c=await m3.call('faizan','phQcLockCut("'+P+'",'+A('faizan',{expectedRev:0})+')');
    return!a.ok&&a.code==='refused'&&!b.ok&&b.code==='refused'&&!c.ok&&/whole number/.test(c.error)&&!m.store['po_qc_recon/'+P]&&!m2.store['po_qc_recon/'+P];
  },
  'the PO\'s lots are read FRESH and must equal what the reconciliation counts, else stale (nothing written)':async(o)=>{
    const m=mk(o);seedPo(m);
    await add(m,'faizan',{S:5},0);
    m.store['po_qc_recon/'+P].lotCount=2;              // a lot saved elsewhere that this read does not see
    const n=m.log.writes.length;
    const r=await add(m,'faizan',{S:5},1);
    const ok=m.log.queries.some(q=>q.path==='po_qc_lots'&&q.wheres.length===1&&q.wheres[0][0]==='poId'&&q.wheres[0][2]===P);
    const f=mk(Object.assign({},o,{failLots:true}));seedPo(f);
    const u=await add(f,'faizan',{S:5},0);
    return!r.ok&&r.code==='stale'&&m.log.writes.length===n&&ok&&!u.ok&&u.code==='unread'&&/po_qc_lots/.test(u.error)&&f.log.tx===0;
  },
  'adopt the old Packing receipts: a manager, one legacy lot from the entries without src qc, the ids kept, no pos write; never twice':async(o)=>{
    const m=mk(o);seedPo(m,{packingReceipts:[{id:'RCV-1-S',receiptId:'RCV-1',size:'S',qty:5,ts:'x',by:'Faizan'},{id:'RCV-1-M',receiptId:'RCV-1',size:'M',qty:10,ts:'x',by:'Faizan'}]});
    const f=await m.call('faizan','phQcAdoptLegacy("'+P+'",'+A('faizan',{expectedRev:0,reason:'old receipts'})+')');
    const r=await m.call('mustafa','phQcAdoptLegacy("'+P+'",'+A('mustafa',{expectedRev:0,reason:'before QC Ops existed'})+')');
    const posW=m.log.writes.filter(w=>w.path==='pos/'+P);
    const lot=m.store['po_qc_lots/'+r.lotId];
    const again=await m.call('mustafa','phQcAdoptLegacy("'+P+'",'+A('mustafa',{expectedRev:1,reason:'before QC Ops existed'})+')');
    const q=await add(m,'faizan',{S:0,M:5},1);
    const after=await m.call('mustafa','phQcAdoptLegacy("'+P+'",'+A('mustafa',{expectedRev:2,reason:'before QC Ops existed'})+')');
    const m2=mk(o);seedPo(m2);
    const none=await m2.call('mustafa','phQcAdoptLegacy("'+P+'",'+A('mustafa',{expectedRev:0,reason:'nothing here'})+')');
    return!f.ok&&f.code==='forbidden'&&r.ok&&r.adopted===2&&posW.length===0&&lot.src==='legacy'&&lot.total===15&&J(m.store['po_qc_recon/'+P].legacyIds)===J(['RCV-1-S','RCV-1-M'])
      &&!again.ok&&again.code==='refused'&&q.ok&&!after.ok&&after.code==='refused'&&!none.ok&&none.code==='refused'&&!m2.store['po_qc_recon/'+P];
  },
  'a closed reconciliation refuses a lot and a void; an owner reopens it (the pos document untouched); then a lot is accepted':async(o)=>{
    const m=mk(o);seedPo(m);
    const a=await add(m,'faizan',{S:20,M:40,L:40,XL:20},0);
    await m.call('faizan','phQcClose("'+P+'",'+A('faizan',{expectedRev:1})+')');
    const l=await add(m,'faizan',{M:1},2);
    const v=await m.call('mustafa','phQcVoidLot("'+a.lotId+'","wrong count",'+A('mustafa')+')');
    const pos0=J(m.store['pos/'+P]);
    const ro=await m.call('ammar','phQcReopen("'+P+'",'+A('ammar',{expectedRev:2,reason:'recount asked for'})+')');
    const l2=await add(m,'faizan',{M:1},3);
    return!l.ok&&l.code==='refused'&&!v.ok&&v.code==='refused'&&ro.ok&&m.store['po_qc_recon/'+P].status==='reopened'&&m.log.writes.filter(w=>w.tx===m.log.tx-1&&w.path==='pos/'+P).length===0
      &&J(JSON.parse(pos0).currentStage)===J('completed')&&l2.ok&&m.store['po_qc_recon/'+P].status==='reopened';
  },
  'no write anywhere holds an array inside an array; every stored text is trimmed and clipped':async(o)=>{
    const m=mk(o);seedPo(m);
    await add(m,'faizan',{S:20,M:38},0,{note:'n'.repeat(400)});
    await m.call('mustafa','phQcClose("'+P+'",'+A('mustafa',{expectedRev:1,reason:'r'.repeat(900),cause:'other'})+')');
    const lot=lotsOf(m)[0],rec=m.store['po_qc_recon/'+P];
    return m.log.writes.every(w=>!nested(w.data))&&lot.note.length===200&&rec.overrides[0].reason.length===500;
  }
};

module.exports=async function(){
  const s=suite('ph-qc-write');
  const W='js/ph-write.js',Q='js/ph-qc-write.js',D='js/ph-data.js';

  s.section('the writers over an in-memory Firestore (each check is a whole scenario)');
  for(const name of Object.keys(SC)){
    let r=false;try{r=await SC[name]({});}catch(e){r=false;s.ok(name+' (threw: '+((e&&e.message)||e)+')',false);continue;}
    s.ok(name,r===true);
  }

  s.section('the classic Final QC patch this mirrors was read from js/pos.js');
  s.eq('completeQC writes these five fields',J(CLASSIC.slice().sort()),J(['currentStage','stages.qc.done','stages.qc.doneAt','stages.qc.doneBy','stages.qc.notes'].sort()));
  {
    const m=mk({});
    s.eq('PHQC_CLOSE_POS_FIELDS = the classic five + the two additive keys',J(m.run('PHQC_CLOSE_POS_FIELDS.slice()')),J(['currentStage','stages.qc.done','stages.qc.doneAt','stages.qc.doneBy','stages.qc.notes','qcReconClosedAt','qcReconClosedBy']));
    s.eq('PHQC_WRITE_ROOTS',J(m.run('PHQC_WRITE_ROOTS.slice()')),J(['pos','po_qc_recon','po_qc_lots','hrm_notifications']));
    const src=read(Q).replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    const cols=Array.from(new Set((src.match(/doc\(db,\s*'[a-z_]+'/g)||[]).map(x=>/'([a-z_]+)'/.exec(x)[1]))).sort();
    s.eq('ph-qc-write.js names exactly the collections of PHQC_WRITE_ROOTS',J(cols),J(m.run('PHQC_WRITE_ROOTS.slice().sort()')));
    s.ok('every new global of ph-qc-write.js is phQc / _phQcw / PHQC_ prefixed',[...read(Q).matchAll(/^(?:async\s+)?(?:function\s+([A-Za-z0-9_$]+)|(?:const|let|var)\s+([A-Za-z0-9_$]+))/gm)].map(x=>x[1]||x[2]).every(n=>/^(phQc|_phQcw|PHQC_)/.test(n)));
  }

  s.section('breaks: each guard, undone, fails its named check');
  const brk=async(label,mut,scen)=>{
    let r;try{r=await SC[scen]({mut:mut});}catch(e){r=false;}
    s.ok('break "'+label+'" fails "'+scen.slice(0,90)+'"',r===false);
  };
  const K=Object.keys(SC);
  await brk('the history row dropped from the lot transaction',{[Q]:[["        tx.update(pref,{packingReceipts:receipts});\n        tx.set(doc(db,'pos',poId,'history',h.id),h.data);","        tx.update(pref,{packingReceipts:receipts});"]]},K[0]);
  await brk('the packingReceipts mirror dropped',{[Q]:[["        tx.update(pref,{packingReceipts:receipts});\n        tx.set(doc(db,'pos',poId,'history',h.id),h.data);\n        out={recon:rec,lot:lot","        tx.set(doc(db,'pos',poId,'history',h.id),h.data);\n        out={recon:rec,lot:lot"]]},K[0]);
  await brk('expectedRev ignored on a lot',{[Q]:[["          if(r.rev!==er)throw _phRefuse('stale','The QC reconciliation of '+poId+' was changed by someone else (revision '+r.rev+'). Reload it.',{rev:r.rev});\n        }else if(er!==0)throw _phRefuse('stale','The QC reconciliation of '+poId+' is not what this screen shows. Reload it.');\n        const mv=phQcMoveProblem(r?r.status:'',r?r.status:'locked',r?'lot':'lock',a.u);","        }\n        const mv=phQcMoveProblem(r?r.status:'',r?r.status:'locked',r?'lot':'lock',a.u);"]]},K[2]);
  await brk('the offline refusal removed',{[Q]:[["  if(_phOffline())return _phFail('offline','No connection. A QC lot is saved with a transaction, which cannot be queued - nothing was saved.');",""]]},K[3]);
  // the writer's own manager check AND the transition-table check (ph-write.js phQcMoveProblem) both stand in the way: undo both
  await brk('the floor allowed to close outside the tolerance',{[Q]:[["          if(!phCanManage(a.u))throw _phRefuse('forbidden',rc.phase==='short'","          if(false)throw _phRefuse('forbidden',rc.phase==='short'"]],[W]:[["  if(who==='manager'&&!phCanManage(u))","  if(false&&who==='manager'&&!phCanManage(u))"]]},'a SHORT close: refused for Faizan (nothing written); Mustafa with a reason and a cause closes it, an overrides row, qc_closed_short and bell rows to afnan and ammar IN THE SAME transaction');
  await brk('the floor allowed to close outside the tolerance (Faizan\'s own checks)',{[Q]:[["          if(!phCanManage(a.u))throw _phRefuse('forbidden',rc.phase==='short'","          if(false)throw _phRefuse('forbidden',rc.phase==='short'"]],[W]:[["  if(who==='manager'&&!phCanManage(u))","  if(false&&who==='manager'&&!phCanManage(u))"]]},K[4]);
  await brk('Arfat let through (phCanQcOps true for everyone)',{[D]:[["function phCanQcOps(u){return phCanQc(u)||phCanManage(u);}","function phCanQcOps(u){return true;}"]]},K[5]);
  await brk('the pre-check before the round trip removed',{[Q]:[["  if(mPo&&st&&st.ok){","  if(false){"]]},K[6]);
  await brk('the allowance check skipped in the transaction',{[Q]:[["        const pr=phQcLotProblem(lock.sizes,recv.sizes,inp.sizes,{model:model});\n        if(pr)throw _phRefuse('refused',pr);","        const pr=null;"]]},K[7]);
  await brk('the 24 h own-lot window removed',{[Q]:[["          if(now-(typeof L.at==='number'?L.at:0)>PHQC_VOID_WINDOW_MS)throw","          if(false)throw"]]},K[8]);
  await brk('another person\'s lot voidable by the floor',{[Q]:[["          if(L.by!==a.u)throw _phRefuse('forbidden','Only a manager can void a lot someone else received.');",""]]},K[8]);
  await brk('the void mirror written with the wrong sign',{[Q]:[["_phQcwMirror(lotId,L.sizes,-1,ctx)","_phQcwMirror(lotId,L.sizes,1,ctx)"]]},K[9]);
  await brk('the close rewrites a PO the classic flow already completed',{[Q]:[["  if(phStageOf(po)==='completed')return add;",""]]},K[11]);
  await brk('the bell rows written outside the transaction',{[Q]:[["        bells.forEach(function(b){tx.set(doc(db,'hrm_notifications',b.id),b.data);});\n        out={recon:Object.assign({},r,patch),posPatch:pp","        bells.forEach(function(b){setDoc(doc(db,'hrm_notifications',b.id),b.data);});\n        out={recon:Object.assign({},r,patch),posPatch:pp"]]},K[12]);
  await brk('the manager close of a RECEIVING PO removed (the plan\'s rule, before the owner\'s change)',{[Q]:[["else if(rc.phase==='receiving'||rc.phase==='short'){","else if(rc.phase==='short'){"]]},K[13]);
  await brk('the close-short reason length unchecked',{[Q]:[["          if(reason.length<PHQC_REASON_MIN)throw _phRefuse('invalid','A reason of at least '+PHQC_REASON_MIN+' characters is needed to close a PO outside the tolerance.');",""]]},K[13]);
  await brk('relock allowed with an unchanged cut',{[Q]:[["        if(!exp.drift)throw","        if(false)throw"]]},K[16]);
  await brk('relock open to a manager, not only an owner',{[Q]:[["  if(!phIsOwner(a.u))return _phFail('forbidden','Only an owner (Afnan or Ammar) can replace the cut snapshot.');",""]],[W]:[["  if(who==='owner'&&!phIsOwner(u))","  if(false&&who==='owner'&&!phIsOwner(u))"]]},K[16]);
  await brk('the lock taken from po.sizes when cutQty is missing (and the core\'s live-cut cross-check skipped)',{[W]:[["  const c=p.cutQty;\n","  const c=p.cutQty||p.sizes;\n"],["  const done=_phIsObj(p.stages)&&_phIsObj(p.stages.cutting)&&p.stages.cutting.done===true;","  const done=true;"],["  if(typeof phQcExpected==='function'){const e=","  if(false){const e="]]},K[17]);
  await brk('the fresh lots count check removed',{[W]:[["  return rows.length===want?null:","  return true?null:"]]},K[18]);
  await brk('adopt takes the new QC entries too',{[W]:[["if(!_phIsObj(e)||e.src==='qc'||typeof e.size!=='string'||!e.size)return;","if(!_phIsObj(e)||typeof e.size!=='string'||!e.size)return;"]]},K[19]);
  await brk('adopt forgets which receipts it already took',{[W]:[["          if(done.indexOf(id)>-1||ids.indexOf(id)>-1)return;","          if(ids.indexOf(id)>-1)return;"]]},K[19]);
  await brk('a closed reconciliation accepts a lot',{[Q]:[["          if(r.status==='closed')throw _phRefuse('refused','The QC reconciliation of '+poId+' is closed. An owner can reopen it.');\n          if(!_phQcwOpenStatus(r))throw _phRefuse('refused','The QC reconciliation of '+poId+' is '+r.status+'.');",""]]},K[20]);
  await brk('the note not clipped',{[W]:[["note:_phStr(x.note,PHQC_NOTE_MAX)","note:x.note"]]},K[21]);
  return s;
};

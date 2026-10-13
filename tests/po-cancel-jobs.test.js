/* ─────────────────────────────────────────────────────────────────────────
   Cancelling a PO closes its embellishment jobs (js/pos.js cancelPO,
   js/embellishments.js) — Oct 2026.

   WAS: cancelPO marked the PO cancelled and left every printing_jobs record
   for it open: live on the printing floor, in the Observer tower, running SLA
   clocks. NOW the PO's cancel and its jobs' cancel are ONE transaction and
   every write only ADDS fields (cancelled, cancelledAt/By/Reason,
   cancelledFromStage, cancelledByPO); nothing is deleted or rewritten.
   js/embellishments.js keeps the cancelled ones out of its lists and never
   re-creates a job for a cancelled PO.

   DRIVES window.cancelPO against the real js/shared.js, js/pos.js and
   js/embellishments.js and an in-memory Firestore whose transactions are
   all-or-nothing and enforce "every read before every write". It proves the
   logic, not what the live Firestore does and not how it looks on a screen.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');

const FILES=['js/shared.js','js/auth.js','js/pos.js','js/embellishments.js'];
const J=v=>JSON.stringify(v);
const OWNER={uid:'u1',u:'afnan',name:'Afnan',role:'owner',canPO:true};
const ESC_SRC=fs.readFileSync(path.join(ROOT,'js/gatepass.js'),'utf8').match(/function _gpEsc\(s\)\{[^\n]*\}/)[0];

function fakeFirestore(seed){
  const store=new Map(Object.entries(seed||{}).map(([k,v])=>[k,JSON.parse(J(v))]));
  const fail={commit:null,read:null,cached:null};
  const log={commits:[],attempts:0,deleted:[],updates:[],afterJobQuery:null,jobQueries:0};
  const snap=p=>({exists:()=>store.has(p),data:()=>store.has(p)?JSON.parse(J(store.get(p))):undefined});
  const apply=w=>{
    if(w.op==='set')store.set(w.ref.path,JSON.parse(J(w.data)));
    else if(w.op==='update'){
      if(!store.has(w.ref.path))throw new Error('NOT_FOUND: no document to update: '+w.ref.path);
      store.set(w.ref.path,Object.assign({},store.get(w.ref.path),JSON.parse(J(w.data))));
    }else if(w.op==='delete')store.delete(w.ref.path);
  };
  const globals={
    db:{},
    doc:(db,col,id)=>({path:col+'/'+id,col,id}),
    collection:(db,col)=>({col}),
    where:(f,op,v)=>({f,op,v}),orderBy:()=>({}),limit:()=>({}),
    query:(c,...cs)=>({col:c.col,cs}),
    getDocs:async q=>{
      if(fail.read&&fail.read(q.col))throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      const docs=[];
      store.forEach((v,k)=>{
        const i=k.indexOf('/');if(k.slice(0,i)!==q.col)return;
        if((q.cs||[]).every(w=>w.op!=='=='||v[w.f]===w.v))docs.push({id:k.slice(i+1),data:()=>JSON.parse(J(v))});
      });
      const res={docs,empty:docs.length===0,size:docs.length,metadata:{fromCache:!!(fail.cached&&fail.cached(q.col))}};
      if(q.col==='printing_jobs'&&(q.cs||[]).some(w=>w.op==='==')){log.jobQueries++;if(log.afterJobQuery&&log.jobQueries===1)log.afterJobQuery();}
      return res;
    },
    getDoc:async ref=>snap(ref.path),
    setDoc:async(ref,data)=>{apply({op:'set',ref,data});},
    updateDoc:async(ref,data)=>{log.updates.push(ref.path);apply({op:'update',ref,data});},
    deleteDoc:async ref=>{log.deleted.push(ref.path);apply({op:'delete',ref});},
    runTransaction:async(db,fn)=>{
      log.attempts++;
      const pending=[];
      const tx={
        get:async ref=>{
          if(pending.length)throw new Error('Firestore transactions require all reads to be executed before all writes.');
          return snap(ref.path);
        },
        set(ref,data){pending.push({op:'set',ref,data});return tx;},
        update(ref,data){pending.push({op:'update',ref,data});return tx;},
        delete(ref){pending.push({op:'delete',ref});return tx;}
      };
      const r=await fn(tx);
      if(fail.commit&&fail.commit(pending))throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      pending.forEach(w=>{if(w.op==='update'&&!store.has(w.ref.path))throw new Error('NOT_FOUND: no document to update: '+w.ref.path);});
      pending.forEach(apply);
      if(pending.length)log.commits.push(pending.map(w=>w.op+':'+w.ref.path));
      return r;
    }
  };
  return{store,fail,log,globals,get:p=>store.has(p)?JSON.parse(J(store.get(p))):undefined,put:(p,v)=>store.set(p,JSON.parse(J(v)))};
}

const po=(n,extra)=>Object.assign({id:'PO-'+String(n).padStart(3,'0'),fbKey:'PO-'+String(n).padStart(3,'0'),name:'PO '+n,qty:100,fabric:'Terry',createdAt:'2026-09-01',poStatus:'in_production',currentStage:'cutting',stages:{cutting:{done:false}}},extra||{});
const job=(id,poNumber,extra)=>Object.assign({poId:id,poNumber,articleCode:'GD007',articleName:'Live In Pants',currentStage:'bulk_printing',status:'active',totalQty:100,
  stageHistory:[{stage:'po_received',by:'System',at:'2026-10-01T00:00:00.000Z',note:'x'}],createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-02T00:00:00.000Z',slaCurrentDue:'2026-10-20T00:00:00.000Z'},extra||{});

function mkApp(seed,opts){
  opts=opts||{};
  const db=fakeFirestore(seed);
  const a=loadApp({files:FILES,currentPage:'dashboard',globals:Object.assign({},db.globals,{
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    _poEmbellishment:null,
    fabReleaseForPO:async()=>0,
    confirm:()=>true,
    prompt:()=>opts.prompt===undefined?'Buyer pulled the order':opts.prompt
  },opts.globals||{})});
  a.run('session='+J(opts.session||OWNER));
  a.run(ESC_SRC);
  a.run('globalThis.__toasts=[];showToast=function(m,e){__toasts.push(String(m));};');
  a.run('globalThis.__acts=[];logActivity=async function(x,d){__acts.push(x+" | "+d);};');
  a.run('loadData=async function(){};');
  a.run('allPasses=[];allFabricInventory=[];allSLAEvents=[];allRecipes=[];');
  return Object.assign(a,{db,toasts:()=>a.run('__toasts'),acts:()=>a.run('__acts')});
}
const seedFor=(extra)=>Object.assign({
  'pos/PO-010':po(10),
  'pos/PO-011':po(11),
  'printing_jobs/jA':job('jA','PO-010'),
  'printing_jobs/jB':job('jB','PO-010',{currentStage:'final_qc'}),
  'printing_jobs/jC':job('jC','PO-010',{currentStage:'closed',status:'closed'}),
  'printing_jobs/jD':job('jD','PO-011'),
  'printing_jobs/jE':job('jE','PO-010',{cancelled:true,cancelledAt:'2026-09-30T00:00:00.000Z',cancelledBy:'Someone',cancelledReason:'earlier',cancelledFromStage:'po_received'})
},extra||{});
const load=(a,n)=>a.run('allPOs='+J([po(n)]));
const JOB_FIELDS=['cancelled','cancelledAt','cancelledBy','cancelledByPO','cancelledFromStage','cancelledReason'];

module.exports=async function(){
  const s=suite('po-cancel-jobs');

  s.section('cancelling a PO cancels its open embellishment jobs in the SAME transaction');
  {
    const a=mkApp(seedFor());load(a,10);
    const before={};['jA','jB','jC','jD','jE'].forEach(k=>{before[k]=a.db.get('printing_jobs/'+k);});
    await a.run('window.cancelPO("PO-010","PO-010")');
    const jobAfter=k=>a.db.get('printing_jobs/'+k);
    s.eq('the PO is cancelled',(a.db.get('pos/PO-010')||{}).poStatus,'cancelled');
    s.eq('ONE commit carries the PO and both open jobs',J(a.db.log.commits),J([['update:pos/PO-010','update:printing_jobs/jA','update:printing_jobs/jB']]));
    ['jA','jB'].forEach(k=>{
      const j=jobAfter(k);
      s.eq(k+': flagged cancelled',j.cancelled,true);
      s.eq(k+': who',j.cancelledBy,'Afnan');
      s.eq(k+': the reason as typed',j.cancelledReason,'Buyer pulled the order');
      s.eq(k+': the stage it was at, kept',j.cancelledFromStage,before[k].currentStage);
      s.eq(k+': and which PO closed it',j.cancelledByPO,'PO-010');
      s.ok(k+': when (ISO)',/^\d{4}-\d{2}-\d{2}T/.test(j.cancelledAt||''),j.cancelledAt);
      const changed=Object.keys(j).filter(f=>J(j[f])!==J(before[k][f])).sort();
      s.eq(k+': ONLY those six fields were added — nothing rewritten',J(changed),J(JOB_FIELDS));
      s.eq(k+': stage, history, updatedAt and the SLA clock are untouched',J([j.currentStage,j.stageHistory,j.updatedAt,j.slaCurrentDue]),J([before[k].currentStage,before[k].stageHistory,before[k].updatedAt,before[k].slaCurrentDue]));
    });
    s.eq('a job already closed is left exactly as it was',J(jobAfter('jC')),J(before.jC));
    s.eq('a job already cancelled keeps its first cancel record',J(jobAfter('jE')),J(before.jE));
    s.eq('another PO\'s job is not touched',J(jobAfter('jD')),J(before.jD));
    s.eq('nothing was deleted',a.db.log.deleted.length,0);
    s.ok('the toast says how many jobs went with it',/2 embellishment jobs cancelled with it/.test(a.toasts().join('|')),a.toasts().join('|'));
    s.ok('the activity row says so',a.acts().some(x=>/^PO cancelled \| PO-010 cancelled by Afnan — Buyer pulled the order · 2 embellishment jobs cancelled with it/.test(x)),J(a.acts()));
    s.eq('no second pass was needed: nothing was written outside the transaction',a.db.log.updates.length,0);
  }

  s.section('a failed commit leaves the PO AND its jobs exactly as they were');
  {
    const a=mkApp(seedFor());load(a,10);
    a.db.fail.commit=()=>true;
    const pb=a.db.get('pos/PO-010'),jb=a.db.get('printing_jobs/jA');
    await a.run('window.cancelPO("PO-010","PO-010")');
    s.eq('the PO is not cancelled',J(a.db.get('pos/PO-010')),J(pb));
    s.eq('the job is not cancelled',J(a.db.get('printing_jobs/jA')),J(jb));
    s.eq('no sweep ran after a failed cancel',a.db.log.updates.length,0);
    s.ok('the error is shown',/^Error: Missing or insufficient permissions/.test(a.toasts().join('|')),a.toasts().join('|'));
    s.eq('nothing logged',a.acts().length,0);
  }

  s.section('the PO is judged on the LIVE document: a second owner who got there first');
  {
    const first=po(10,{poStatus:'cancelled',currentStage:null,cancelledBy:'Ammar',cancelledReason:'first',cancelledFromStatus:'in_production',cancelledFromStage:'cutting',cancelledAt:'2026-10-11T00:00:00.000Z'});
    const a=mkApp(seedFor({'pos/PO-010':first}));load(a,10);          // this screen still shows it in production
    const jb=a.db.get('printing_jobs/jA');
    await a.run('window.cancelPO("PO-010","PO-010")');
    s.eq('the first cancel record is not overwritten',J(a.db.get('pos/PO-010')),J(first));
    s.eq('the job is not written by the loser',J(a.db.get('printing_jobs/jA')),J(jb));
    s.eq('no commit',a.db.log.commits.length,0);
    s.ok('and it says it is already cancelled',/already cancelled/.test(a.toasts().join('|')),a.toasts().join('|'));
    const b=mkApp(seedFor({'pos/PO-010':po(10,{poStatus:'complete',currentStage:'completed'})}));load(b,10);
    await b.run('window.cancelPO("PO-010","PO-010")');
    s.ok('a PO completed meanwhile is not cancelled',b.db.log.commits.length===0&&/completed and cannot be cancelled/.test(b.toasts().join('|'))&&!b.db.get('printing_jobs/jA').cancelled,b.toasts().join('|'));
  }

  s.section('a job the lookup missed is caught by the sweep right after the commit');
  {
    const a=mkApp(seedFor());load(a,10);
    // A new job appears for the PO after the lookup has been answered, before the commit.
    a.db.log.afterJobQuery=()=>a.db.put('printing_jobs/jNew',job('jNew','PO-010',{currentStage:'po_received'}));
    await a.run('window.cancelPO("PO-010","PO-010")');
    const n=a.db.get('printing_jobs/jNew')||{};
    s.eq('the late job is cancelled too',n.cancelled,true);
    s.eq('with the same record',n.cancelledByPO+':'+n.cancelledFromStage,'PO-010:po_received');
    s.eq('(by a write after the transaction, not inside it)',J(a.db.log.updates),J(['printing_jobs/jNew']));
    s.ok('the toast counts all three',/3 embellishment jobs cancelled with it/.test(a.toasts().join('|')),a.toasts().join('|'));
  }

  s.section('a job lookup that fails cannot block the cancel, and says so');
  {
    const a=mkApp(seedFor());load(a,10);
    a.db.fail.read=col=>col==='printing_jobs';
    await a.run('window.cancelPO("PO-010","PO-010")');
    s.eq('the PO is cancelled',(a.db.get('pos/PO-010')||{}).poStatus,'cancelled');
    s.eq('no job was touched on a guess',a.db.get('printing_jobs/jA').cancelled,undefined);
    s.ok('and the toast says the jobs could not be checked',/embellishment jobs could NOT be checked/.test(a.toasts().join('|')),a.toasts().join('|'));
    // An answer from the offline cache is not an answer — but the app's own list still names the job.
    const b=mkApp(seedFor());load(b,10);
    b.db.fail.cached=col=>col==='printing_jobs';
    b.run('printingDataLoaded=true;allPrintingJobs='+J([Object.assign({_id:'jA'},job('jA','PO-010'))]));
    await b.run('window.cancelPO("PO-010","PO-010")');
    s.eq('a cached answer is not trusted, but the job the app holds in memory is still cancelled',b.db.get('printing_jobs/jA').cancelled,true);
    s.eq('(and only that one — the cache told us nothing else)',b.db.get('printing_jobs/jB').cancelled,undefined);
  }

  s.section('poCancelJobPatch: who is never touched');
  {
    const a=mkApp({});
    const run=(j,p)=>a.run('poCancelJobPatch('+J(j)+','+J(p||po(10))+',{at:"T",by:"B",reason:"R"})');
    s.eq('an active job of this PO gets the six fields',J(Object.keys(run(job('x','PO-010'))||{}).sort()),J(JOB_FIELDS));
    s.eq('a job of another PO gets nothing',run(job('x','PO-011')),null);
    s.eq('a job with no PO number gets nothing',run(job('x',undefined)),null);
    s.eq('a closed job gets nothing',run(job('x','PO-010',{currentStage:'closed'})),null);
    s.eq('a cancelled job gets nothing',run(job('x','PO-010',{cancelled:true})),null);
    s.eq('a missing job gets nothing',run(null),null);
  }

  s.section('js/embellishments.js: cancelled jobs are not live jobs');
  {
    const a=mkApp(seedFor());
    a.run('printingDataLoaded=false');
    await a.run('loadPrintingData()');
    s.eq('the loader keeps the cancelled job out of the live list (every list and count reads it)',a.run('allPrintingJobs.map(j=>j._id).sort().join()'),'jA,jB,jC,jD');
    s.eq('and holds it apart',a.run('allCancelledPrintingJobs.map(j=>j._id).join()'),'jE');
    s.ok('the jobs page header counts only live jobs',/4 total jobs/.test(String(a.run('renderPrintingJobsPage()'))),'');
    // cancelPO moves the ones it cancelled out of the loaded list at once (the loader runs once a session).
    load(a,10);
    await a.run('window.cancelPO("PO-010","PO-010")');
    s.eq('after a cancel, the live list in memory has lost the two',a.run('allPrintingJobs.map(j=>j._id).sort().join()'),'jC,jD');
    s.eq('and the cancelled list gained them with the record',a.run('allCancelledPrintingJobs.map(j=>j._id).sort().join()'),'jA,jB,jE');
    s.eq('the moved job carries what was written',a.run('allCancelledPrintingJobs.find(j=>j._id==="jA").cancelledByPO'),'PO-010');
    // No job is made or topped up for a cancelled PO — not even from a stale copy of the PO on another screen.
    const before=a.db.store.size;
    const emb={required:true,articleCode:'GD007',articleName:'Live In Pants',processType:'rubber'};
    a.run('window.__stale='+J(po(10,{embellishment:emb}))+';window.__dead='+J(po(12,{poStatus:'cancelled',embellishment:emb})));
    const r1=await a.run('embOnCuttingDone(window.__stale,{S:50})');
    const r2=await a.run('embOnCuttingDone(window.__dead,{S:50})');
    s.eq('a stale copy of a PO that has a cancelled job gets no new job',r1,null);
    s.eq('a PO marked cancelled gets none either',r2,null);
    s.eq('nothing was written',a.db.store.size+':'+a.db.log.updates.length,before+':0');
    // An ordinary PO is unaffected.
    a.run('window.__ok='+J(po(77,{embellishment:emb})));
    const r3=await a.run('embOnCuttingDone(window.__ok,{S:50})');
    s.ok('a live PO still gets its job',!!r3&&r3.poNumber==='PO-077');
  }

  return s;
};

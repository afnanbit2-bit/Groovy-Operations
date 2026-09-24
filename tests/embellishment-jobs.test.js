/* ─────────────────────────────────────────────────────────────────────────
   Fabric issue → Embellishment job (js/embellishments.js)

   The printing floor used to hear about a PO only when cutting finished, and
   the job it got was sized off what was ORDERED — the caller passed the real
   cut in and the payload read `po.qty`/`po.sizes` instead. This suite holds
   the chain that replaced it: the fabric issue creates the job carrying the
   fabric and the PLANNED cut, cutting-done tops up the SAME job with the
   ACTUAL cut, and the two are never allowed to overwrite each other.

   Everything here DRIVES the real entry points (`embOnFabricIssued`,
   `embOnCuttingDone`) rather than asserting the helpers — the helpers were
   green against the old wiring once already, which is the lesson CLAUDE.md
   records about `_boardsColumnForCard`.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

const FILES=['js/shared.js','js/auth.js','js/pos.js','js/embellishments.js'];
const SESSION={uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'};
const J=v=>JSON.stringify(v);

/* A PO that needs embellishment. `sizes` is what was ORDERED — deliberately
   different from everything cut below, so a job reading it is visible. */
function po(o){
  return Object.assign({
    id:'PO-001',name:'Live In Pants',code:'GD007',qty:500,
    sizes:{XS:100,S:100,M:100,L:100,XL:100},
    embellishment:{required:true,articleCode:'GD007',articleName:'Live In Pants',
      processType:'rubber',complexityTier:2,ratePerPiece:35,recipeStatus:'locked'}
  },o);
}
/* The gate pass `submitFabricIssue` writes — the fabric-issue record. */
function gp(o){
  return Object.assign({
    id:'GP-010',poId:'PO-001',date:'2026-09-21',cutMaster:'Hassan',
    gpType:'fabric',fabricUnit:'kg',fabricQty:120,
    fabricType:'Denim',fabricGsm:310,fabricColor:'Indigo',rollCodes:['R1','R2'],
    fabrics:[{inventoryKey:'k1',fabType:'Denim',gsm:310,color:'Indigo',unit:'kg',
      rollCodes:['R1','R2'],rollsCount:2,weight:120,avgConsumption:0.6}],
    sizeBreakdown:[{size:'30',qty:80,bundleCount:4},{size:'32',qty:120,bundleCount:6}],
    cutQty:200,plannedQty:200,totalBundles:10
  },o);
}

async function app(globals){
  const a=loadApp({files:FILES,session:SESSION,currentPage:'dashboard',
    globals:Object.assign({localStorage:{getItem:()=>null,setItem(){},removeItem(){}}},globals||{})});
  a.run('session='+J(SESSION));
  a.run('printingDataLoaded=true');       // the loader is not what is under test
  a.run('allPrintingJobs=[];allRecipes=[];allSLAEvents=[]');
  return a;
}
const jobs=a=>a.run('allPrintingJobs.map(j=>({...j}))');

const _pending=[];

_pending.push((async()=>{
  const s=suite('embellishment-jobs');

  // ── the fabric issue creates the job ─────────────────────────────────
  let r={};
  try{
    const a=await app();
    a.run('window.__po='+J(po())+';window.__gp='+J(gp()));
    await a.run('embOnFabricIssued(window.__po,window.__gp)');
    r.jobs=jobs(a);
  }catch(e){r.err=e&&e.message;}

  s.section('a fabric issue creates the job');
  try{
    const j=(r.jobs||[])[0]||{};
    s.eq('no error',r.err,undefined);
    s.eq('exactly one job',(r.jobs||[]).length,1);
    s.eq('carries the PO',j.poNumber,'PO-001');
    s.eq('the article code',j.articleCode,'GD007');
    s.eq('the article name',j.articleName,'Live In Pants');
    s.eq('the cut master',j.cutMaster,'Hassan');
    // The whole point: WHAT WAS CUT, not what was ordered.
    s.eq('the PLANNED cut per size, with the real labels',J(j.plannedSizes),J({'30':80,'32':120}));
    s.eq('planned total',j.plannedTotal,200);
    s.eq('nothing actual yet',j.actualTotal,0);
    s.eq('the display sizes are the plan',J(j.sizeBreakdown),J({'30':80,'32':120}));
    s.eq('and NOT the 500 ordered',j.totalQty,200);
  }catch(e){s.ok('the create block ran',false,e&&e.message);}

  s.section('and the fabric that was picked');
  try{
    const f=((r.jobs||[])[0]||{}).fabricIssues||[];
    s.eq('one issue recorded',f.length,1);
    s.eq('its gate pass',f[0]&&f[0].gpId,'GP-010');
    s.eq('the fabric',J((f[0]&&f[0].items||[])[0]||{}),
      J({type:'Denim',gsm:310,color:'Indigo',unit:'kg',qty:120,rolls:['R1','R2']}));
    s.eq('and the roll codes travel with it',J(((f[0]&&f[0].items||[])[0]||{}).rolls),J(['R1','R2']));
  }catch(e){s.ok('the fabric block ran',false,e&&e.message);}

  // ── cutting done tops up the SAME job ────────────────────────────────
  let c={};
  try{
    const a=await app();
    a.run('window.__po='+J(po())+';window.__gp='+J(gp()));
    await a.run('embOnFabricIssued(window.__po,window.__gp)');
    await a.run("embOnCuttingDone(window.__po,{'30':70,'32':115})");
    c.jobs=jobs(a);
  }catch(e){c.err=e&&e.message;}

  s.section('cutting done tops up the same job');
  try{
    const j=(c.jobs||[])[0]||{};
    s.eq('no error',c.err,undefined);
    s.eq('still ONE job, not a second',(c.jobs||[]).length,1);
    s.eq('the ACTUAL cut is recorded',J(j.actualSizes),J({'30':70,'32':115}));
    s.eq('actual total',j.actualTotal,185);
    // The load-bearing claim of the whole round.
    s.eq('the PLAN is still there beside it',J(j.plannedSizes),J({'30':80,'32':120}));
    s.eq('planned total untouched',j.plannedTotal,200);
    s.eq('the display switches to the actual',J(j.sizeBreakdown),J({'30':70,'32':115}));
    s.eq('and its total',j.totalQty,185);
    s.eq('the stage did NOT move',j.currentStage,'po_received');
  }catch(e){s.ok('the cutting block ran',false,e&&e.message);}

  // ── a second fabric issue adds to the plan ───────────────────────────
  let m={};
  try{
    const a=await app();
    a.run('window.__po='+J(po())+';window.__gp='+J(gp()));
    a.run('window.__gp2='+J(gp({id:'GP-011',fabricColor:'Black',
      fabrics:[{inventoryKey:'k2',fabType:'Denim',gsm:310,color:'Black',unit:'kg',rollCodes:['R9'],rollsCount:1,weight:40,avgConsumption:0.6}],
      sizeBreakdown:[{size:'32',qty:40,bundleCount:2}]})));
    await a.run('embOnFabricIssued(window.__po,window.__gp)');
    await a.run('embOnFabricIssued(window.__po,window.__gp2)');
    await a.run('embOnFabricIssued(window.__po,window.__gp2)');   // the same GP twice
    m.jobs=jobs(a);
  }catch(e){m.err=e&&e.message;}

  s.section('a second fabric issue on one PO');
  try{
    const j=(m.jobs||[])[0]||{};
    s.eq('no error',m.err,undefined);
    s.eq('still one job',(m.jobs||[]).length,1);
    s.eq('the plan ADDS UP',J(j.plannedSizes),J({'30':80,'32':160}));
    s.eq('planned total',j.plannedTotal,240);
    s.eq('both issues recorded',(j.fabricIssues||[]).length,2);
    s.eq('both fabric colours kept',
      J((j.fabricIssues||[]).map(i=>(i.items[0]||{}).color)),J(['Indigo','Black']));
    // Re-delivering the same gate pass must not double the plan.
    s.eq('the same gate pass twice changes nothing',
      J((j.fabricIssues||[]).map(i=>i.gpId)),J(['GP-010','GP-011']));
  }catch(e){s.ok('the multi-issue block ran',false,e&&e.message);}

  // ── a plain garment gets nothing, silently ───────────────────────────
  let n={};
  try{
    const a=await app();
    a.run('window.__po='+J(po({embellishment:{required:false}}))+';window.__gp='+J(gp()));
    const res=await a.run('embOnFabricIssued(window.__po,window.__gp)');
    n.jobs=jobs(a);n.res=res;n.toasts=a.state.toasts.length;
  }catch(e){n.err=e&&e.message;}

  s.section('a PO with no embellishment');
  try{
    s.eq('no error',n.err,undefined);
    s.eq('no job is created',(n.jobs||[]).length,0);
    s.eq('and nothing is returned',n.res,null);
    s.eq('silently — no toast',n.toasts,0);
  }catch(e){s.ok('the non-emb block ran',false,e&&e.message);}

  // ── cutting with no prior issue still creates one ────────────────────
  let o={};
  try{
    const a=await app();
    a.run('window.__po='+J(po()));
    await a.run("embOnCuttingDone(window.__po,{XS:90,S:95})");
    o.jobs=jobs(a);
  }catch(e){o.err=e&&e.message;}

  s.section('cutting done for a PO whose fabric never went through the issue screen');
  try{
    const j=(o.jobs||[])[0]||{};
    s.eq('no error',o.err,undefined);
    s.eq('a job is still created',(o.jobs||[]).length,1);
    s.eq('sized off the ACTUAL cut',J(j.sizeBreakdown),J({XS:90,S:95}));
    s.eq('not the 500 ordered',j.totalQty,185);
    s.eq('no fabric to record',(j.fabricIssues||[]).length,0);
  }catch(e){s.ok('the no-issue block ran',false,e&&e.message);}

  // ── alpha sizes still work exactly as before ─────────────────────────
  let al={};
  try{
    const a=await app();
    a.run('window.__po='+J(po({code:'GST073'}))+';window.__gp='+J(gp({
      sizeBreakdown:[{size:'M',qty:50},{size:'L',qty:60},{size:'XL',qty:25}]})));
    await a.run('embOnFabricIssued(window.__po,window.__gp)');
    al.jobs=jobs(a);
  }catch(e){al.err=e&&e.message;}

  s.section('alpha sizes are unchanged');
  try{
    const j=(al.jobs||[])[0]||{};
    s.eq('no error',al.err,undefined);
    s.eq('M/L/XL carried through',J(j.sizeBreakdown),J({M:50,L:60,XL:25}));
    s.eq('and totalled',j.totalQty,135);
  }catch(e){s.ok('the alpha block ran',false,e&&e.message);}

  return s;
})());

module.exports=async function(){
  const suites=await Promise.all(_pending);
  return suites[0];
};

/* ─────────────────────────────────────────────────────────────────────────
   Reserve removal (Oct 2026). Owner decision: Issue as PO means START; the Hold mark covers stops; the
   34 existing reserved POs keep working.

   Held here, by driving the real entry points:
     · a NEW PO from the classic form (window.submitPO) is born poStatus 'in_production' / currentStage 'cutting'
       with fabrics [] and fabPoReserveCommit is never called (the picker's state is only cleared)
     · a NEW PO from Issue as PO (phBuildIssuedPo, the pure builder phIssueDraft passes in_production/cutting to) has the same status
       and stage; the full phIssueDraft transaction vs submitPO is held key by key in tests/ph-issue.test.js
     · a LEGACY reserved PO is still read as its own lane (phStageOf 'reserved'), still offered "Release to production" (phNextAction),
       still refuses a cut until released (poCutLiveCheck), and releaseToProduction still moves it to in_production/cutting
     · the Release button/banner is drawn ONLY for a legacy reserved PO, never for a new one
     · a new PO appears in the fabric issue PO picker, can be cut (poCutLiveCheck ok) and a legacy reserved PO's issued fabric is
       not re-issued by anything here (releasing writes only status fields, no roll is touched)
   Proves logic only: not run against real Firestore, not seen on a screen. */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=v=>JSON.stringify(v);
const at=(a,p)=>a.db.get(p)||{};
const OWNER={uid:'u1',u:'afnan',name:'Afnan',role:'owner',canPO:true};
const ESC_SRC=read('js/gatepass.js').match(/function _gpEsc\(s\)\{[^\n]*\}/)[0];

function fakeFirestore(seed){
  const store=new Map(Object.entries(seed||{}).map(([k,v])=>[k,JSON.parse(J(v))]));
  const fail={commit:null,read:null,cached:null,err:null};
  const log={commits:0,attempts:0,deleted:[]};
  const snap=path=>({exists:()=>store.has(path),data:()=>store.has(path)?JSON.parse(J(store.get(path))):undefined});
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
    where:(f,op,v)=>({f,op,v}),
    orderBy:()=>({}),limit:()=>({}),
    query:(c,...cs)=>({col:c.col,cs}),
    getDocs:async q=>{
      if(fail.read&&fail.read(q.col))throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      const docs=[];
      store.forEach((v,k)=>{
        const i=k.indexOf('/');if(k.slice(0,i)!==q.col)return;
        if((q.cs||[]).every(w=>w.op!=='=='||v[w.f]===w.v))docs.push({id:k.slice(i+1),data:()=>JSON.parse(J(v))});
      });
      return{docs,empty:docs.length===0,size:docs.length,metadata:{fromCache:!!(fail.cached&&fail.cached(q.col))}};
    },
    getDoc:async ref=>snap(ref.path),
    setDoc:async(ref,data)=>{apply({op:'set',ref,data});},
    updateDoc:async(ref,data)=>{apply({op:'update',ref,data});},
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
      if(fail.commit&&fail.commit(pending))throw Object.assign(new Error((fail.err&&fail.err.message)||'Missing or insufficient permissions.'),{code:(fail.err&&fail.err.code)||'permission-denied'});
      // All-or-nothing: validate every write before applying any.
      pending.forEach(w=>{if(w.op==='update'&&!store.has(w.ref.path))throw new Error('NOT_FOUND: no document to update: '+w.ref.path);});
      pending.forEach(apply);
      log.commits++;
      return r;
    }
  };
  return{store,fail,log,globals,get:p=>store.has(p)?JSON.parse(J(store.get(p))):undefined};
}

function mkApp(seed,extraGlobals){
  const db=fakeFirestore(seed);
  const calls={commit:[],reset:0};
  const a=loadApp({files:['js/shared.js','js/pos.js','js/ph-core.js'],currentPage:'dashboard',globals:Object.assign({},db.globals,{
    _poEmbellishment:null,
    fabPoReserveCommit:async id=>{calls.commit.push(id);},
    fabPoReserveReset:()=>{calls.reset++;},
    fabPoSelected:()=>[{fabType:'Terry',gsm:220,color:'Black',rolls:2,rollCodes:['r1','r2']}],
    confirm:()=>true,prompt:()=>''
  },extraGlobals||{})});
  a.run('session='+J(OWNER));
  a.run(ESC_SRC);
  a.run('globalThis.__toasts=[];showToast=function(m){__toasts.push(String(m));};');
  a.run('globalThis.__acts=[];logActivity=async function(x,d){__acts.push(x+" | "+d);};');
  a.run("uploadToCloudinary=async function(){return 'https://res.cloudinary.com/x/up.jpg';};");
  a.run('loadData=async function(){};');
  a.run('allPOs=[];allPasses=[];allFabricInventory=[];');
  return Object.assign(a,{db,calls});
}
async function createPO(a){
  const v={'po-name':'Tee','po-code':'GST001','po-qty':'100','po-fabric':'Terry'};
  Object.keys(v).forEach(k=>{a.el(k).value=v[k];});
  a.run("poImages.front='x';");
  await a.run('window.submitPO()');
}
const LEGACY=(n,extra)=>Object.assign({id:'PO-'+String(n).padStart(3,'0'),fbKey:'PO-'+String(n).padStart(3,'0'),name:'Legacy '+n,code:'GST001',qty:100,fabric:'Terry',createdAt:'2026-09-01',poStatus:'reserved',stages:{cutting:{done:false}}},extra||{});
const NEWPO=(n,extra)=>Object.assign(LEGACY(n),{name:'New '+n,poStatus:'in_production',currentStage:'cutting'},extra||{});

module.exports=async function(){
  const s=suite('po-reserve-removal');

  s.section('classic form: a new PO is born in production at cutting');
  {
    const a=mkApp({'counters/main':{pos:6}});
    await createPO(a);
    const p=at(a,'pos/PO-007');
    s.eq('status and stage',J([p.poStatus,p.currentStage]),J(['in_production','cutting']));
    s.eq('no fabric is claimed as reserved: fabrics is empty',J(p.fabrics),'[]');
    s.eq('fabPoReserveCommit is NOT called for a new PO',a.calls.commit.length,0);
    s.ok('the picker state is still cleared after the save',a.calls.reset===1,String(a.calls.reset));
    s.ok('the PO is a plain pos document, born released (releasedAt is a ms number; see po-releasedat.test.js)',typeof p.releasedAt==='number'&&p.id==='PO-007');
    s.eq('the success toast is clean',a.run('__toasts').some(t=>/^PO-007 created/.test(t)),true);
    const src=read('js/pos.js').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
    s.ok('pos.js never names fabPoReserveCommit as a call any more',!/fabPoReserveCommit\s*\(/.test(src)&&!/typeof fabPoReserveCommit/.test(src));
  }

  s.section('Issue as PO: the builder gives the same status and stage');
  {
    const a=loadApp({files:['js/shared.js','js/pos.js','js/ph-core.js','js/ph-i18n.js','js/ph-data.js','js/ph-write.js','js/ph-issue.js'],currentPage:'dashboard'});
    const rec=a.run('phBuildIssuedPo({code:"GST073",name:"Tee",qty:100,sizes:{S:50,M:50}},{id:"PO-007",now:1,draftId:"D",enteredBy:"uzaib",issuedBy:"mustafa",issuedByName:"Mustafa",stageKeys:STAGE_KEYS,poStatus:PO_STATUS.IN_PRODUCTION,currentStage:"cutting",pktDay:"2026-10-15"})');
    s.eq('born in_production at cutting',J([rec.poStatus,rec.currentStage]),J(['in_production','cutting']));
    const legacyCtx=a.run('phBuildIssuedPo({code:"X",qty:1},{id:"PO-008",now:1,stageKeys:STAGE_KEYS,poStatus:PO_STATUS.RESERVED,pktDay:"2026-10-15"})');
    s.eq('a ctx with no currentStage still yields null (the builder invents nothing)',legacyCtx.currentStage,null);
    const isrc=read('js/ph-issue.js');
    s.ok('phIssueDraft passes IN_PRODUCTION and cutting, not RESERVED',/poStatus:PO_STATUS\.IN_PRODUCTION,currentStage:'cutting'/.test(isrc)&&!/poStatus:PO_STATUS\.RESERVED/.test(isrc));
    s.ok('phIssueDraft never calls fabPoReserveCommit',!/fabPoReserveCommit\s*\(/.test(isrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'')));
    s.eq('phStageOf reads a new PO as cutting',a.run('phStageOf('+J(NEWPO(1))+')'),'cutting');
  }

  s.section('legacy reserved POs keep working');
  {
    const a=mkApp({'pos/PO-010':LEGACY(10),'counters/main':{pos:10}});
    a.run('allPOs=['+J(LEGACY(10))+']');
    s.eq('phStageOf: its own lane',a.run('phStageOf(allPOs[0])'),'reserved');
    s.eq('phStageOf: the 34 real ones have poStatus reserved and NO currentStage key at all',a.run('phStageOf({id:"PO-1",poStatus:"reserved"})'),'reserved');
    s.eq('poStatusOf says reserved',a.run('poStatusOf(allPOs[0])'),'reserved');
    s.eq('phNextAction offers Release to production',a.run('phNextAction(allPOs[0],{}).action'),'release');
    s.eq('phNextAction on a new PO is NOT release',a.run('phNextAction('+J(NEWPO(11))+',{hasFabricIssue:false}).action'),'issue_fabric');
    s.eq('a cut is refused until released',a.run('poCutLiveCheck('+J(LEGACY(10))+').state'),'reserved');
    s.eq('a new PO can be cut',a.run('poCutLiveCheck('+J(NEWPO(11))+').state'),'ok');
    // release still works and writes only status fields (no fabric roll is touched)
    await a.run('window.releaseToProduction("PO-010")');
    const p=at(a,'pos/PO-010');
    s.eq('released: in_production at cutting',J([p.poStatus,p.currentStage]),J(['in_production','cutting']));
    s.ok('released: only the status/release fields changed on the document',J(Object.keys(p).filter(k=>LEGACY(10)[k]===undefined).sort())===J(['currentStage','releasedAt','releasedBy']));
    s.eq('releasing a PO that is already in production is refused with a toast',await (async()=>{a.run('allPOs=['+J(NEWPO(11))+']');a.run('__toasts.length=0');await a.run('window.releaseToProduction("PO-011")');return a.run('__toasts').join('|');})(),'This PO is already in production.');
  }

  s.section('the Release button is offered only on a legacy reserved PO');
  {
    const a=mkApp({});
    const html=(po)=>{a.run('allPOs=['+J(po)+'];viewingPO='+J(po.fbKey)+';document.getElementById("main-content")&&0;');try{a.run('renderDetailPage()');}catch(e){}return a.el('main-content').innerHTML||'';};
    const hl=html(LEGACY(10)),hn=html(NEWPO(11));
    s.ok('legacy reserved: banner and Release button',/Release to production/.test(hl)&&/releaseToProduction\('PO-010'\)/.test(hl),hl.slice(0,200));
    s.ok('new PO: no Release button and no reserve banner',!/Release to production/.test(hn)&&!/releaseToProduction/.test(hn)&&!/Reserve order/.test(hn));
  }

  s.section('a new PO can receive a fabric issue');
  {
    const f=loadApp({files:['js/fabric.js'],globals:{currentPage:'',allPasses:[],allFabricInventory:[{_id:'k1',fabType:'Terry',gsm:220,color:'Black',unit:'kg',rollsCount:1,rolls:[{rollCode:'r1',status:'in_stock',weight:20}]}],allFabricMovements:[],
      allPOs:[NEWPO(11,{poStatus:'in_production'}),LEGACY(10),NEWPO(12,{poStatus:'cancelled'})],_gpEsc:x=>String(x==null?'':x)}});
    const html=f.run('renderFabricIssueTab()');
    s.ok('the picker lists the new in_production/cutting PO',/value="PO-011"/.test(html));
    s.ok('and the legacy reserved PO (unchanged), but not a cancelled one',/value="PO-010"/.test(html)&&!/value="PO-012"/.test(html));
    s.ok('the PO picker has no poStatus/currentStage filter other than cancelled',/filter\(p=>p\.poStatus!=='cancelled'\)/.test(read('js/fabric.js')));
    const src=read('js/fabric.js');
    s.ok('the roll-reserved confirm is still there for legacy reserved rolls',/is reserved for \$\{roll\.reservedPO\}, not \$\{po\}/.test(src));
    s.ok('the New-PO picker no longer promises a reservation',!/reserve rolls/.test(src.slice(src.indexOf('window.fabPoFabricCard'),src.indexOf('window.fabPoAddRow')))&&/Nothing is reserved/.test(src));
  }

  s.section('embellishment job still starts at the fabric issue (Ammar\'s file is untouched)');
  {
    const e=read('js/embellishments.js');
    s.ok('embOnFabricIssued gates on the PO\'s embellishment flag, not on reserved/in_production',/embOnFabricIssued/.test(e)&&!/poStatus==='reserved'/.test(e.slice(e.indexOf('function embOnFabricIssued'),e.indexOf('function embOnFabricIssued')+3000)));
  }
  return s;
};
module.exports.helpers={mkApp,createPO,at,fakeFirestore};   // shared with tests/po-releasedat.test.js

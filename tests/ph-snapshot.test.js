/* WP3b: the standing product instructions are SNAPSHOTTED onto a PO at issue (js/ph-issue.js phIssueDraft), and a manager can
   deliberately refresh the snapshot (phPoInstructionsRefresh). Same in-memory optimistic-transaction Firestore as ph-issue.test.js.
   Held: with instructions the PO carries instructions / instructionsRev / instructionsAt AFTER the classic keys; without them it carries
   none of the three; a later edit of the product instructions does not change an issued PO; a read that fails refuses the issue
   (nothing written); refresh is managers only, stale revision refused, writes exactly the three fields + one history row.
   Each "break" mutates the source and requires the named check to FAIL. Not proven: real Firestore, a screen. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const harness=require('./harness');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-issue.js');
const RULES=read('firestore.rules').replace(/\r/g,'');
const J=JSON.stringify;
const clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(r=>setImmediate(r));
const T0=1790000000000;
// the md5 of the `match /pos/{doc} {...}` block as it was at the base commit 1ede640 (before this change): the pos rule is not ours to touch
const POS_BLOCK_MD5='9d49d63f1e2ab07f63150146d2a3e3ae';

/* ── an in-memory Firestore with OPTIMISTIC transactions, recording everything ── */
function makeDb(seed,o){
  o=o||{};
  const docs=new Map();
  Object.keys(seed||{}).forEach(k=>docs.set(k,{v:1,data:clone(seed[k])}));
  const log={commits:0,attempts:0,writes:[],overwrites:[],plain:[],commitBatches:[]};
  const fail={txGet:null,commit:null,getDocs:null,afterPreRead:null};
  const snap=p=>{const d=docs.get(p);return{id:p.split('/').pop(),exists:()=>!!d,data:()=>d?clone(d.data):undefined,metadata:{fromCache:false}};};
  const direct=col=>[...docs.keys()].filter(k=>k.indexOf(col+'/')===0&&k.slice(col.length+1).indexOf('/')===-1).sort();
  const apply=(w)=>{
    const prev=docs.get(w.path);
    if(w.op==='set'){if(prev)log.overwrites.push(w.path);docs.set(w.path,{v:(prev?prev.v:0)+1,data:clone(w.data)});}
    else if(w.op==='update'){docs.set(w.path,{v:prev.v+1,data:Object.assign({},prev.data,clone(w.data))});}
  };
  const api={
    db:{},
    doc:(db,...s)=>({path:s.join('/'),id:s[s.length-1]}),
    collection:(db,...s)=>({path:s.join('/')}),
    query:(c,...cons)=>({path:c.path,wh:cons.filter(x=>x&&x.where).map(x=>x.where)}),
    orderBy:()=>({}),limit:()=>({}),where:(...a)=>({where:a}),
    getDoc:async r=>{const s=snap(r.path);if(fail.afterPreRead&&/^po_drafts\//.test(r.path)){const f=fail.afterPreRead;fail.afterPreRead=null;setImmediate(f);}return s;},
    getDocs:async q=>{
      const f=fail.getDocs&&fail.getDocs(q.path);if(f)throw f;
      let ks=direct(q.path);
      (q.wh||[]).forEach(w=>{ks=ks.filter(k=>docs.get(k).data[w[0]]===w[2]);});
      return{docs:ks.map(snap),empty:ks.length===0,metadata:{fromCache:false}};
    },
    setDoc:async(r,d)=>{log.plain.push({op:'set',path:r.path});apply({op:'set',path:r.path,data:d});},
    updateDoc:async(r,d)=>{log.plain.push({op:'update',path:r.path});apply({op:'update',path:r.path,data:d});},
    deleteDoc:async r=>{log.plain.push({op:'delete',path:r.path});docs.delete(r.path);},
    addDoc:async(c,d)=>{log.plain.push({op:'add',path:c.path});return{id:'x'};},
    writeBatch:()=>{throw new Error('a batch is not expected');},
    runTransaction:async(db,fn)=>{
      for(let attempt=1;attempt<=6;attempt++){
        log.attempts++;
        const seen=new Map(),buf=[];
        const tx={
          get:async r=>{
            if(fail.txGet){const f=fail.txGet(r.path);if(f)throw f;}
            if(buf.length)throw new Error('Firestore transactions require all reads to be executed before all writes.');
            await tick();
            seen.set(r.path,docs.has(r.path)?docs.get(r.path).v:0);
            return snap(r.path);
          },
          set(r,d){buf.push({op:'set',path:r.path,data:clone(d)});return tx;},
          update(r,d){buf.push({op:'update',path:r.path,data:clone(d)});return tx;},
          delete(){throw new Error('a delete is not expected');}
        };
        const res=await fn(tx);
        await tick();
        let moved=false;seen.forEach((v,p)=>{const cur=docs.has(p)?docs.get(p).v:0;if(cur!==v)moved=true;});
        if(moved)continue;                                   // contention: the callback runs again
        if(fail.commit){const e=fail.commit(buf);if(e)throw e;}
        buf.forEach(w=>{if(w.op==='update'&&!docs.has(w.path))throw new Error('NOT_FOUND: no document to update: '+w.path);});
        buf.forEach(apply);
        log.commits++;log.commitBatches.push(buf.map(w=>w.op+':'+w.path));
        buf.forEach(w=>log.writes.push(Object.assign({commit:log.commits},w)));
        return res;
      }
      throw new Error('too much contention on this transaction');
    }
  };
  return{docs,log,fail,api,get:p=>docs.has(p)?clone(docs.get(p).data):undefined,
    dump:()=>J([...docs.keys()].sort().map(k=>[k,docs.get(k).v,docs.get(k).data]))};
}

const MASTER=(id,name,active)=>({id,name,nameKey:name.toLowerCase(),kind:'inhouse',active:active!==false,aliases:[],notes:'',createdAt:T0,createdBy:'afnan',createdByName:'Afnan',updatedAt:T0,updatedBy:'afnan',retiredAt:null,retiredBy:null,retiredReason:''});
const GOOD={code:'GST073',name:'Effortless Tee',pattern:'P-12',qty:100,sizes:{S:50,M:50},ratio:'1:1',fabric:'Jersey 180',fabricCode:'JER180',store:'Main store',totalRoll:'6',
  plannedFabricQty:30,plannedFabricUnit:'kg',season:'winter',plannedCutDate:'2026-10-20',requestedDate:'2026-10-25',cutMasterId:'CM-001',cutMaster:'Hassan',
  embellishment:{required:false},jobCopies:{embroidery:true,printing:false,washing:false},notes:'Handle with care'};
const DID='DRAFT-K1-AAAA',DID2='DRAFT-K1-BBBB';
const draft=(id,status,po,extra)=>Object.assign({id,status,rev:3,entryDevice:'pc',createdBy:'uzaib',createdByName:'Uzaib',createdAt:T0,updatedAt:T0+500,updatedBy:'uzaib',po:clone(po)},
  status==='ready'?{readyAt:T0+400,readyBy:'uzaib'}:{},extra||{});
const po=n=>({id:'PO-'+String(n).padStart(3,'0'),name:'PO '+n,qty:100,fabric:'Terry',createdAt:'2026-09-01',poStatus:'reserved',currentStage:null,stages:{cutting:{done:false}}});
const seedFor=(extra)=>Object.assign({
  'counters/main':{pos:6,gatepasses:2,bundles:9},
  'pos/PO-001':po(1),'pos/PO-006':po(6),
  'cutting_masters/CM-001':MASTER('CM-001','Hassan'),'cutting_masters/CM-003':MASTER('CM-003','Retired Rao',false),
  ['po_drafts/'+DID]:draft(DID,'ready',GOOD)
},extra||{});
const AF={u:'afnan',name:'Afnan'},MU={u:'mustafa',name:'Mustafa'},AM={u:'ammar',name:'Ammar'},UZ={u:'uzaib',name:'Uzaib'},RA={u:'raees',name:'Raees'},AR={u:'arfat',name:'Arfat'},QA={u:'claude',name:'Claude'};
const NOW=T0+3600000;

function mkApp(seed,o){
  o=o||{};
  const db=makeDb(seed);
  const acts=[];
  const a=harness.loadApp({files:['js/shared.js','js/pos.js','js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js'],currentPage:'dashboard',session:o.session||{uid:'u2',u:'mustafa',name:'Mustafa',role:'manager',canPO:true},
    globals:Object.assign({},db.api,{
      auth:{currentUser:{getIdToken:async()=>{}}},navigator:{onLine:o.offline?false:true},
      _poEmbellishment:null,
      localStorage:{getItem:()=>null,setItem(){},removeItem(){}}
    },o.globals||{})});
  a.run('session='+J(o.session||{uid:"u2",u:"mustafa",name:"Mustafa",role:"manager",canPO:true})+';');
  a.run('globalThis.__acts=[];logActivity=async function(x,d){__acts.push(x+" | "+d);};');
  a.run("uploadToCloudinary=async function(){return 'https://res.cloudinary.com/x/up.jpg';};loadData=async function(){};showToast=function(){};");
  a.run('allPOs='+J(o.allPOs||[])+';allPasses=[];allFabricInventory=[];');
  a.ctx.console={log(){},warn(){},error(){}};
  vm.runInContext(o.src||SRC,a.ctx,{filename:'ph-issue.js'});
  return Object.assign(a,{db,acts:()=>a.run('__acts.slice()'),
    async loadMasters(){await a.run('phLoadStage("masters")');},
    issue(id,opts){a.ctx.__o=a.ctx.__o||[];const i=a.ctx.__o.push(opts||{})-1;return a.run('(async()=>{return await phIssueDraft('+J(id)+',__o['+i+']);})()');}});
}
const loaded=async(seed,o)=>{const a=mkApp(seed,o);await a.loadMasters();return a;};
const OPT=(who,rev,extra)=>Object.assign({actor:who,expectedRev:rev===undefined?3:rev,now:NOW,rand:'abcd'},extra||{});
const INSTR={code:'GST073',rev:2,placements:[{en:'Left chest',ur:'',side:'front',templateId:''}],pantones:[{code:'485',system:'C',hex:'#DA291C'}],embroidery:[],notes:{en:'Mind the shade',ur:''},reason:'x',createdAt:T0,createdBy:'afnan',updatedAt:T0,updatedBy:'afnan'};
const withI=(extra)=>seedFor(Object.assign({'ph_article_instructions/GST073':INSTR},extra||{}));
async function checks(src){
  const R={};const K=(n,ok)=>{R[n]=!!ok;};
  const KEYS=['instructions','instructionsRev','instructionsAt'];
  {
    const a=await loaded(withI(),{src,allPOs:[po(1),po(6)]});
    const r=await a.issue(DID,OPT(MU));const p=a.db.get('pos/PO-007')||{};
    const ks=Object.keys(p);
    K('issue with instructions: ok',r.ok===true);
    K('issue with instructions: the three keys are the LAST three, after issuedBy',J(ks.slice(-4))===J(['issuedBy'].concat(KEYS)));
    K('issue with instructions: cleaned content, rev 2, at = now',J(p.instructions)===J(a.run('phInstructionsClean('+J(INSTR)+').value'))&&p.instructionsRev===2&&p.instructionsAt===NOW);
    K('issue with instructions: the instruction doc itself was not written',a.db.log.writes.every(w=>!/^ph_article_instructions/.test(w.path)));
    const h=[...a.db.docs.keys()].filter(k=>/^pos\/PO-007\/history\//.test(k)).map(k=>a.db.get(k))[0]||{};
    K('issue with instructions: the issued history row names the snapshot revision',h.data&&h.data.instructionsRev===2);
    // later edit does not change the PO
    a.db.docs.set('ph_article_instructions/GST073',{v:9,data:Object.assign({},INSTR,{rev:3,notes:{en:'CHANGED',ur:''}})});
    K('later edit of the product instructions leaves the issued PO unchanged',(a.db.get('pos/PO-007').instructions.notes.en==='Mind the shade')&&a.db.get('pos/PO-007').instructionsRev===2);
  }
  {
    const a=await loaded(seedFor(),{src,allPOs:[po(1),po(6)]});
    const r=await a.issue(DID,OPT(MU));const p=a.db.get('pos/PO-007')||{};
    K('issue without instructions: proceeds',r.ok===true);
    K('issue without instructions: none of the three keys exist',KEYS.every(k=>!(k in p)));
  }
  {
    const a=await loaded(withI({'ph_article_instructions/GST073':{code:'GST073',rev:1,placements:[],pantones:[],embroidery:[],notes:{en:'',ur:''}}}),{src,allPOs:[po(1),po(6)]});
    const r=await a.issue(DID,OPT(MU));
    K('empty instruction doc is no snapshot',r.ok===true&&!('instructions' in a.db.get('pos/PO-007')));
  }
  {
    const a=await loaded(withI(),{src});a.db.fail.txGet=p=>/^ph_article_instructions\//.test(p)?new Error('permission-denied: nope'):null;
    const before=a.db.dump();const r=await a.issue(DID,OPT(MU));
    K('unreadable instructions: issue refused as unread, naming the collection',r.ok===false&&r.code==='unread'&&/ph_article_instructions/.test(r.error));
    K('unreadable instructions: nothing written, counter untouched',a.db.dump()===before&&a.db.log.commits===0);
  }
  // refresh
  const issued=async()=>{const a=await loaded(withI(),{src,allPOs:[po(1),po(6)]});await a.issue(DID,OPT(MU));
    a.db.docs.set('ph_article_instructions/GST073',{v:9,data:Object.assign({},INSTR,{rev:3,notes:{en:'CHANGED',ur:''}})});
    a.refresh=(who,rev,extra)=>{a.ctx.__r=a.ctx.__r||[];const i=a.ctx.__r.push(Object.assign({actor:who,expectedRev:rev,now:NOW+5000,rand:'zzzz'},extra||{}))-1;return a.run('(async()=>await phPoInstructionsRefresh("PO-007",__r['+i+']))()');};
    return a;};
  {
    const a=await issued();const before=J(a.db.get('pos/PO-007'));
    const r=await a.refresh(MU,2);const p=a.db.get('pos/PO-007');
    K('refresh by a manager: ok, revision 3',r.ok===true&&p.instructionsRev===3&&p.instructions.notes.en==='CHANGED'&&p.instructionsAt===NOW+5000);
    K('refresh changes ONLY the three fields',J(Object.keys(JSON.parse(before)).sort())===J(Object.keys(p).sort())&&Object.keys(p).filter(k=>J(p[k])!==J(JSON.parse(before)[k])).every(k=>KEYS.indexOf(k)>-1));
    const w=a.db.log.writes.filter(x=>x.path==='pos/PO-007'&&x.commit===a.db.log.commits)[0]||{data:{}};
    K('refresh writes exactly instructions, instructionsRev, instructionsAt',J(Object.keys(w.data).sort())===J(KEYS.slice().sort()));
    const hs=[...a.db.docs.keys()].filter(k=>/^pos\/PO-007\/history\/.*/.test(k)).map(k=>a.db.get(k)).filter(h=>h.type==='instructions_refreshed');
    K('refresh appends one history row of type instructions_refreshed (rev 2 -> 3)',hs.length===1&&hs[0].by==='mustafa'&&hs[0].data.fromRev===2&&hs[0].data.toRev===3);
    const r2=await a.refresh(MU,3);
    K('refresh again with nothing newer is refused',r2.ok===false&&r2.code==='refused');
  }
  for(const w of [UZ,RA,AR,QA]){
    const a=await issued();const before=a.db.dump();const r=await a.refresh(w,2);
    K('refresh: '+w.u+' is refused forbidden, nothing written',r.ok===false&&r.code==='forbidden'&&a.db.dump()===before);
  }
  {
    const a=await issued();const before=a.db.dump();const r=await a.refresh(MU,1);
    K('refresh with a stale revision is refused (stale), nothing written',r.ok===false&&r.code==='stale'&&a.db.dump()===before);
    const r0=await a.refresh(MU,undefined);
    K('refresh without expectedRev is refused (invalid)',r0.ok===false&&r0.code==='invalid');
  }
  {
    const a=await loaded(seedFor({'pos/PO-007':Object.assign(po(7),{code:'GST073'}),'ph_article_instructions/GST073':INSTR}),{src});
    a.ctx.__o=[{actor:MU,expectedRev:0,now:NOW,rand:'abcd'}];
    const r=await a.run('(async()=>await phPoInstructionsRefresh("PO-007",__o[0]))()');
    K('refresh on a PO with no snapshot (expectedRev 0) adds one',r.ok===true&&a.db.get('pos/PO-007').instructionsRev===2);
  }
  return R;
}
let broken=0;
module.exports=async function(){
  const s=suite('ph-snapshot');
  s.section('instruction snapshot at issue, and the manager refresh');
  const base=await checks(SRC);
  const names=Object.keys(base);
  names.forEach(n=>s.ok(n,base[n]));
  const brk=async(label,from,to,expectFail)=>{
    const mut=SRC.split(from).join(to);
    if(mut===SRC){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(mut);}catch(e){r=null;}broken++;
    expectFail.forEach(n=>s.ok('break "'+label+'" fails: '+n,r===null||r[n]===false||r[n]===undefined));
  };
  await brk('snapshot keys not copied onto the PO',"if(snap)PH_ISSUE_INSTR_KEYS.forEach(function(k){rec[k]=snap[k];});","",['issue with instructions: the three keys are the LAST three, after issuedBy']);
  await brk('snapshot written even with none (empty keys)',"if(snap)PH_ISSUE_INSTR_KEYS.forEach(function(k){rec[k]=snap[k];});","PH_ISSUE_INSTR_KEYS.forEach(function(k){rec[k]=snap?snap[k]:null;});",['issue without instructions: none of the three keys exist']);
  await brk('instructions not cleaned',"const v=phInstructionsClean(d).value;","const v=d;",['issue with instructions: cleaned content, rev 2, at = now']);
  await brk('unreadable instructions are ignored',"throw _phRefuse('unread','The product instructions of '+icode+' (ph_article_instructions) could not be read","isn=null;if(0)throw _phRefuse('unread','The product instructions of '+icode+' (ph_article_instructions) could not be read",['unreadable instructions: issue refused as unread, naming the collection']);
  await brk('refresh not manager-gated',"if(!phCanManage(a.u))return _phFail('forbidden','Only a manager (Afnan, Ammar, Mustafa) can refresh","if(0)return _phFail('forbidden','Only a manager (Afnan, Ammar, Mustafa) can refresh",['refresh: uzaib is refused forbidden, nothing written','refresh: raees is refused forbidden, nothing written']);
  await brk('refresh ignores the revision',"if(have!==o.expectedRev)throw","if(0)throw",['refresh with a stale revision is refused (stale), nothing written']);
  await brk('refresh writes the whole snapshot plus extra field',"tx.update(pref,snap);","tx.update(pref,Object.assign({},snap,{qty:0}));",['refresh changes ONLY the three fields','refresh writes exactly instructions, instructionsRev, instructionsAt']);
  await brk('refresh writes no history row',"        tx.set(doc(db,'pos',poId,'history',hist.id),","        if(0)tx.set(doc(db,'pos',poId,'history',hist.id),",['refresh appends one history row of type instructions_refreshed (rev 2 -> 3)']);
  await brk('refresh without a newer revision is allowed',"if(snap.instructionsRev===have&&po.instructions)throw","if(0)throw",['refresh again with nothing newer is refused']);
  s.ok('breaks run: '+broken,broken>=9);
  return s;
};

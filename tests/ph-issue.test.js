/* Production Ops "Issue as PO" (14 Oct 2026): js/ph-issue.js phIssueDraft, and the firestore.rules clause that lets it land.

   What this drives: the REAL js/shared.js (mintNextIdInTx, createWithNextId), the REAL js/pos.js (submitPO, _poFloorNow, _poIdFor,
   PO_STATUS), the REAL js/ph-core.js / ph-data.js / ph-write.js / ph-issue.js, over an in-memory Firestore whose transactions are
   OPTIMISTIC like the real SDK's: every document read carries a version, a commit whose reads moved is retried (the callback runs
   again), all writes land or none, every read comes before every write, a `set` over an existing document is RECORDED as an
   overwrite, and every committed write is logged.
   Held here:
     · only managers issue (mustafa, afnan, ammar); uzaib, raees, arfat, the QA account and signed-out are refused with nothing written
     · the draft must be 'ready' and at the revision the person is looking at; the stored po is re-checked by phPoComplete
     · the number is minted ONCE, inside the one transaction (counter + pos + draft + history = ONE commit of four writes)
     · two concurrent issues of one draft: one wins, the other is refused ("already issued as PO-nnn") and burns NO number;
       two concurrent issues of two drafts get two consecutive numbers
     · an existing pos id is never overwritten; any failure (refused commit, offline, unread PO list, incomplete draft, stale
       revision) leaves the WHOLE store byte-for-byte what it was, counters/main included
     · the pos document has the keys submitPO builds, in its order, with the values submitPO builds for the same inputs (the real
       submitPO is driven and compared), plus id / season / fromDraftId / enteredBy / issuedBy
     · the rules text: the issue clause is a manager's, from ready only, with exactly the writer's key list, bound to a NEW pos
       document that names the draft; issued is terminal; the pos rule is unchanged
   What it does NOT prove: that real Firestore / the real SDK answer like the fake (tests/rules-emulator-ph.js runs the writer and
   the rules in the real emulator), a real screen, or anything about the live project. Each "break" mutates the source (or the
   rules text) and requires the named check to FAIL. */
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
  const fail={commit:null,getDocs:null,afterPreRead:null};
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

/* ── the whole battery as a function of the source under test, so a break can re-run it ── */
async function checks(src){
  const R={};
  const K=(name,ok)=>{R[name]=!!ok;};
  const only=(a,seed)=>{};    // placeholder to keep the shape obvious
  /* 1. only managers */
  for(const [who,okExpected] of [[MU,true],[AF,true],[AM,true],[UZ,false],[RA,false],[AR,false],[QA,false],[{u:'',name:'',signedOut:true},false]]){
    const a=await loaded(seedFor(),{src,session:who.signedOut?{u:'',name:''}:undefined});
    const before=a.db.dump();
    const r=await a.issue(DID,who.signedOut?{expectedRev:3,now:NOW}:OPT(who));
    if(okExpected)K('managers: '+who.u+' can issue',r.ok===true);
    else{
      K('managers: '+(who.u||'signed out')+' is refused, forbidden',r.ok===false&&r.code==='forbidden');
      K('managers: '+(who.u||'signed out')+' refused: nothing written, counters untouched',a.db.dump()===before&&a.db.log.commits===0);
    }
  }
  /* 2. the happy path */
  {
    const a=await loaded(seedFor(),{src,allPOs:[po(1),po(6)]});
    const r=await a.issue(DID,OPT(MU));
    K('happy: ok, PO-007 (counter 6 + 1)',r.ok===true&&r.poId==='PO-007'&&r.n===7);
    K('happy: ONE commit carrying exactly the four writes (counter, pos, draft, history)',a.db.log.commits===1&&J(a.db.log.commitBatches[0].map(x=>x.split(':')[0]+':'+x.split(':')[1].replace(/\/[0-9]{13}-[A-Za-z0-9]{4}$/,'/ROW')).sort())===J(['set:pos/PO-007','set:pos/PO-007/history/ROW','update:counters/main','update:po_drafts/'+DID].sort()));
    K('happy: the counter moved by exactly one and nothing else on it changed',J(a.db.get('counters/main'))===J({pos:7,gatepasses:2,bundles:9}));
    const p=a.db.get('pos/PO-007')||{};
    K('happy: the PO is born in_production at cutting (what submitPO creates since the reserve removal)',p.poStatus==='in_production'&&p.currentStage==='cutting');
    K('happy: the PO names its draft, who entered it and who issued it',p.fromDraftId===DID&&p.enteredBy==='uzaib'&&p.issuedBy==='mustafa'&&p.createdBy==='Mustafa'&&p.id==='PO-007');
    const d=a.db.get('po_drafts/'+DID)||{};
    K('happy: the draft is issued with poId / issuedAt / issuedBy, rev + 1, the po map untouched',d.status==='issued'&&d.poId==='PO-007'&&d.issuedAt===NOW&&d.issuedBy==='mustafa'&&d.rev===4&&J(d.po)===J(GOOD)&&d.updatedBy==='mustafa');
    const w=a.db.log.writes.filter(x=>x.path==='po_drafts/'+DID)[0]||{data:{}};
    K('happy: the draft write carries exactly the rules\' key list (status, rev, poId, issuedAt, issuedBy, updatedAt, updatedBy)',J(Object.keys(w.data).sort())===J(['status','rev','poId','issuedAt','issuedBy','updatedAt','updatedBy'].sort()));
    const hk=[...a.db.docs.keys()].filter(k=>/^pos\/PO-007\/history\//.test(k));
    const h=hk.length===1?a.db.get(hk[0]):{};
    K('happy: one history row of type issued, by the issuer, from ready to issued',hk.length===1&&h.type==='issued'&&h.by==='mustafa'&&h.from==='ready'&&h.to==='issued'&&h.at===NOW&&h.data&&h.data.poId==='PO-007'&&h.data.draftId===DID);
    K('happy: the new PO is in the loaded list so Open works',a.run("allPOs.some(p=>p.fbKey==='PO-007')"));
    K('happy: no plain (non-transaction) write was made',a.db.log.plain.length===0);
    K('happy: no existing document was overwritten',a.db.log.overwrites.length===0);
    K('happy: the existing POs are byte-identical',J(a.db.get('pos/PO-001'))===J(po(1))&&J(a.db.get('pos/PO-006'))===J(po(6)));
    K('happy: the follow-ups ran and the activity row was written',/PO created \| PO-007/.test(a.acts().join('|'))&&r.followUps&&r.followUps.activity==='logged');
    const r2=await a.issue(DID,OPT(MU,4));
    K('twice: a second issue of the same draft is refused, saying which PO it became',r2.ok===false&&r2.code==='refused'&&/already issued as PO-007/.test(r2.error));
    K('twice: and the counter did not move again',a.db.get('counters/main').pos===7&&a.db.log.commits===1);
  }
  /* 3. concurrency */
  {
    const a=await loaded(seedFor(),{src,allPOs:[po(1),po(6)]});
    const [x,y]=await Promise.all([a.issue(DID,OPT(MU)),a.issue(DID,OPT(AF,3,{rand:'efgh'}))]);
    const oks=[x,y].filter(r=>r.ok),bad=[x,y].filter(r=>!r.ok);
    K('concurrent: exactly one of two issues of the same draft wins',oks.length===1&&bad.length===1);
    K('concurrent: the loser is refused as already issued',bad.length===1&&bad[0].code==='refused'&&/already issued as PO-007/.test(bad[0].error));
    K('concurrent: one PO was created and no number was burned (counter 7, no PO-008)',a.db.get('counters/main').pos===7&&!a.db.get('pos/PO-008')&&!!a.db.get('pos/PO-007'));
    K('concurrent: the contended transaction really did run again',a.db.log.attempts>=3);
    K('concurrent: one history row, one commit',[...a.db.docs.keys()].filter(k=>/^pos\/PO-007\/history\//.test(k)).length===1&&a.db.log.commits===1);
  }
  {
    const two=seedFor({['po_drafts/'+DID2]:draft(DID2,'ready',Object.assign({},GOOD,{code:'GST074',name:'Second Tee'}))});
    const a=await loaded(two,{src,allPOs:[po(1),po(6)]});
    const [x,y]=await Promise.all([a.issue(DID,OPT(MU)),a.issue(DID2,OPT(MU,3,{rand:'wxyz'}))]);
    K('concurrent, two drafts: both succeed with two consecutive numbers',x.ok&&y.ok&&[x.poId,y.poId].sort().join()==='PO-007,PO-008');
    K('concurrent, two drafts: the counter ends at 8',a.db.get('counters/main').pos===8);
  }
  /* 4. incomplete / not ready / stale */
  {
    const bad=Object.assign({},GOOD,{fabric:''});
    const a=await loaded(seedFor({['po_drafts/'+DID]:draft(DID,'ready',bad)}),{src});
    const before=a.db.dump();
    const r=await a.issue(DID,OPT(MU));
    K('incomplete: a ready draft whose stored po is incomplete is refused, naming the field',r.ok===false&&r.code==='refused'&&/not complete/.test(r.error)&&/fabric/.test(r.error));
    K('incomplete: nothing written, counters untouched',a.db.dump()===before&&a.db.log.commits===0);
  }
  {
    const retired=Object.assign({},GOOD,{cutMasterId:'CM-003',cutMaster:'Retired Rao'});
    const a=await loaded(seedFor({['po_drafts/'+DID]:draft(DID,'ready',retired)}),{src});
    const before=a.db.dump();const r=await a.issue(DID,OPT(MU));
    K('incomplete: a master retired since the draft was readied refuses the issue',r.ok===false&&/retired/.test(r.error)&&a.db.dump()===before);
  }
  {   // a master retired AFTER this page loaded the registry but before the issue
    const a=await loaded(seedFor(),{src});
    a.db.docs.set('cutting_masters/CM-001',{v:9,data:MASTER('CM-001','Hassan',false)});
    const before=a.db.dump();const r=await a.issue(DID,OPT(MU));
    K('masters: a master retired after the page loaded is caught at issue time (the registry is re-read)',r.ok===false&&r.code==='refused'&&/retired/.test(r.error)&&a.db.dump()===before);
    const b=await loaded(seedFor(),{src});b.db.fail.getDocs=p=>p==='cutting_masters'?Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'}):null;
    const before2=b.db.dump();const r2=await b.issue(DID,OPT(MU));
    K('masters: an unreadable registry refuses the issue (unread), nothing written',r2.ok===false&&r2.code==='unread'&&b.db.dump()===before2);
  }
  for(const st of ['draft','abandoned']){
    const a=await loaded(seedFor({['po_drafts/'+DID]:draft(DID,st,GOOD)}),{src});
    const before=a.db.dump();const r=await a.issue(DID,OPT(MU));
    K('status: a '+st+' draft cannot be issued, nothing written',r.ok===false&&r.code==='refused'&&/not ready/.test(r.error)&&a.db.dump()===before);
  }
  {
    const a=await loaded(seedFor(),{src});const before=a.db.dump();
    const r=await a.issue(DID,OPT(MU,2));
    K('stale: a draft at another revision is refused with the revision',r.ok===false&&r.code==='stale'&&r.rev===3&&a.db.dump()===before);
    const n=await a.issue(DID,{actor:MU,now:NOW});
    K('stale: an issue with no expectedRev is refused as invalid',n.ok===false&&n.code==='invalid'&&a.db.dump()===before);
    const b=await a.issue('nonsense',OPT(MU));
    K('ids: a bad draft id is refused',b.ok===false&&b.code==='invalid');
    const m=await a.issue('DRAFT-ZZ-9999',OPT(MU));
    K('ids: a draft that does not exist is refused',m.ok===false&&m.code==='missing'&&a.db.dump()===before);
  }
  {   // the stored draft changed under the pre-read WITHOUT a revision bump (a hand edit): the basis the lookups used is gone
    const a=await loaded(seedFor(),{src});
    a.db.fail.afterPreRead=()=>{const d=a.db.docs.get('po_drafts/'+DID);d.v++;d.data.po.name='Something Else';};
    const before=null;const r=await a.issue(DID,OPT(MU));
    K('basis: a draft whose article changed between the lookup and the transaction is refused',r.ok===false&&r.code==='stale'&&!a.db.get('pos/PO-007')&&a.db.get('counters/main').pos===6);
  }
  /* 5. existing id never overwritten; counter untouched on every failure */
  {
    const seed=seedFor({'counters/main':{pos:0,gatepasses:5},'pos/PO-001':po(1)});
    delete seed['pos/PO-006'];
    const a=await loaded(seed,{src,allPOs:[{id:'junk',fbKey:'junk'}]});   // a stale list: floor 0, counter 0 -> the mint lands on PO-001
    const before=a.db.dump();
    const r=await a.issue(DID,OPT(MU));
    K('exists: the mint landing on a taken id is refused and PO-001 is untouched',r.ok===false&&/PO-001 already exists/.test(r.error)&&J(a.db.get('pos/PO-001'))===J(po(1)));
    K('exists: nothing was written at all (counter, draft, history)',a.db.dump()===before&&a.db.log.overwrites.length===0);
  }
  {
    const seed=seedFor({'counters/main':{pos:0},'pos/PO-002':po(2),'pos/PO-003':po(3),'pos/PO-004':po(4),'pos/PO-005':po(5)});
    const a=await loaded(seed,{src,allPOs:[po(1),po(2),po(3),po(4),po(5),po(6)]});
    const r=await a.issue(DID,OPT(MU));
    K('floor: a reset counter cannot mint at or below a loaded PO (PO-007, not PO-001)',r.ok===true&&r.poId==='PO-007');
    K('floor: the counter heals to 7',a.db.get('counters/main').pos===7);
  }
  {   // no PO list loaded: the floor is read from the server
    const a=await loaded(seedFor({'counters/main':{pos:0}}),{src,allPOs:[]});
    const r=await a.issue(DID,OPT(MU));
    K('floor: with no list loaded the ids are read from the server and the mint lands past them',r.ok===true&&r.poId==='PO-007');
  }
  {
    const a=await loaded(seedFor(),{src,allPOs:[]});
    a.db.fail.getDocs=p=>p==='pos'?Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'}):null;
    const before=a.db.dump();const r=await a.issue(DID,OPT(MU));
    K('unread: a PO list that cannot be read refuses the issue, saying nothing was created',r.ok===false&&r.code==='unread'&&/Nothing was created/.test(r.error)&&a.db.dump()===before);
  }
  {
    const a=await loaded(seedFor(),{src});
    a.db.fail.commit=buf=>buf.some(w=>/^pos\//.test(w.path))?Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'}):null;
    const before=a.db.dump();const r=await a.issue(DID,OPT(MU));
    K('refused commit: reported as a permission refusal',r.ok===false&&r.code==='permission');
    K('refused commit: the store is byte-identical (no PO, no counter move, draft still ready)',a.db.dump()===before&&a.db.get('po_drafts/'+DID).status==='ready');
    a.db.fail.commit=null;
    const r2=await a.issue(DID,OPT(MU));
    K('refused commit: the retry gets the very next number, no gap',r2.ok===true&&r2.poId==='PO-007');
  }
  {
    const a=await loaded(seedFor(),{src,offline:true});
    const before=a.db.dump();const r=await a.issue(DID,OPT(MU));
    K('offline: refused out loud, nothing created',r.ok===false&&r.code==='offline'&&/nothing was created/.test(r.error)&&a.db.dump()===before&&a.db.log.attempts===0);
  }
  {   // counters/main absent: a failed issue must not invent it
    const seed=seedFor();delete seed['counters/main'];delete seed['pos/PO-006'];delete seed['pos/PO-001'];
    const a=await loaded(seed,{src,allPOs:[]});
    a.db.fail.commit=()=>Object.assign(new Error('boom'),{code:'unavailable'});
    const before=a.db.dump();const r=await a.issue(DID,OPT(MU));
    K('no counters document: a failed first issue does not create counters/main',r.ok===false&&a.db.get('counters/main')===undefined&&a.db.dump()===before);
  }
  /* 6. embellishment */
  {
    const emb=Object.assign({},GOOD,{embellishment:{required:true}});
    const mk=async(recipes,rate,extra)=>{const a=await loaded(seedFor({['po_drafts/'+DID]:draft(DID,'ready',emb)}),{src});const r=await a.issue(DID,OPT(MU,3,Object.assign({recipes,rateOf:rate},extra||{})));return{a,r};};
    let t=await mk([],()=>({complexityTier:2,ratePerPiece:14}));
    K('embellishment: no recipe = missing, with the rate-list preview, as the classic form',t.r.ok&&J(t.a.db.get('pos/PO-007').embellishment)===J({required:true,recipeId:null,articleCode:'GST073',articleName:'Effortless Tee',recipeStatus:'missing',recipeRequiredBefore:'pp_approval',rateMasterPreview:{complexityTier:2,ratePerPiece:14}}));
    K('embellishment: the Recipe Missing activity row is written (post-commit follow-up)',/Recipe Missing \| PO-007/.test(t.a.acts().join('|')));
    t=await mk([{_id:'R1',articleCode:'gst073',articleName:'X',status:'draft'}],null);
    K('embellishment: an unlocked recipe = draft',t.r.ok&&t.a.db.get('pos/PO-007').embellishment.recipeStatus==='draft'&&t.a.db.get('pos/PO-007').embellishment.recipeId==='R1');
    t=await mk([{_id:'R2',articleCode:'GST073',articleName:'Effortless Tee',status:'locked',printing:{processTypes:['dtf'],complexityTier:3,ratePerPiece:22}}],null);
    K('embellishment: a locked recipe carries process, tier and rate',t.r.ok&&J(t.a.db.get('pos/PO-007').embellishment)===J({required:true,recipeId:'R2',articleCode:'GST073',articleName:'Effortless Tee',processType:'dtf',complexityTier:3,ratePerPiece:22,recipeStatus:'locked',recipeRequiredBefore:'pp_approval'}));
    const a=await loaded(seedFor({['po_drafts/'+DID]:draft(DID,'ready',emb)}),{src});
    const before=a.db.dump();const r=await a.issue(DID,OPT(MU));
    K('embellishment: required but the recipes cannot be had = refused (unread), nothing written',r.ok===false&&r.code==='unread'&&/recipe/.test(r.error)&&a.db.dump()===before);
  }
  /* 7. follow-ups never undo the PO */
  {
    const a=await loaded(seedFor({'trim_templates/T1':{productCode:'GST073',productName:'Tee trims'}}),{src,globals:{_createPoIssueRequest:async()=>{throw new Error('store down');}}});
    const r=await a.issue(DID,OPT(MU));
    K('follow-ups: a failing trim request is reported and the PO stands',r.ok===true&&/^failed: store down/.test(r.followUps.trim)&&!!a.db.get('pos/PO-007'));
    const b=await loaded(seedFor({'trim_templates/T1':{productCode:'GST073',productName:'Tee trims'}}),{src,globals:{_createPoIssueRequest:async(p,t)=>{b.R=[p,t];}}});
    const r2=await b.issue(DID,OPT(MU));
    K('follow-ups: a trim template for the article code creates the store\'s trim request for the new PO',r2.ok&&r2.followUps.trim==='created'&&b.R&&b.R[0].id==='PO-007'&&b.R[0].qty===100&&b.R[1]._id==='T1');
  }
  return R;
}

module.exports=async function(){
  const s=suite('ph-issue');

  /* ═══ the battery ═══ */
  s.section('phIssueDraft: managers only, one transaction, one number, nothing burnt');
  const base=await checks(SRC);
  Object.keys(base).forEach(k=>s.ok(k,base[k]));

  /* ═══ the document equals what the classic form builds (the REAL submitPO is driven) ═══ */
  s.section('the pos document equals what submitPO builds for the same inputs');
  {
    const seed=seedFor();
    const a=await loaded(seed,{allPOs:[po(1),po(6)]});
    // the classic form, filled the way a person would
    const v={'po-name':GOOD.name,'po-code':GOOD.code,'po-qty':'100','po-fabric':GOOD.fabric,'po-pattern':GOOD.pattern,'po-fabriccode':GOOD.fabricCode,'po-store':GOOD.store,'po-rolls':GOOD.totalRoll,'po-notes':GOOD.notes,'sz-S':'50','sz-M':'50'};
    Object.keys(v).forEach(k=>{a.el(k).value=v[k];});
    a.el('po-jc-embroidery').checked=true;
    a.run("poImages.front='x';");
    a.run('window.updateRatio()');
    await a.run('window.submitPO()');
    const classic=a.db.get('pos/PO-007');
    s.ok('the classic form created PO-007 (the comparison is real)',!!classic);
    const r=await a.issue(DID,OPT(MU,3,{now:Date.now()}));
    s.ok('and the draft issued as PO-008',r.ok===true&&r.poId==='PO-008');
    const mine=a.db.get('pos/PO-008')||{};
    const ck=Object.keys(classic||{}),mk=Object.keys(mine);
    s.eq('the keys: the classic keys in the classic order, then id, season, fromDraftId, enteredBy, issuedBy',J(mk),J(ck.filter(k=>k!=='id').concat(['id','season','fromDraftId','enteredBy','issuedBy'])));
    s.eq('the classic keys are exactly PH_ISSUE_CLASSIC_KEYS (+ id)',J(ck),J(a.run('PH_ISSUE_CLASSIC_KEYS').concat(['id'])));
    s.eq('the extra keys are exactly the documented ones',J(a.run('PH_ISSUE_EXTRA_KEYS')),J(['id','season','fromDraftId','enteredBy','issuedBy']));
    const norm=d=>{const x=clone(d);delete x.ts;delete x.id;delete x.imgFront;delete x.imgBack;delete x.season;delete x.fromDraftId;delete x.enteredBy;delete x.issuedBy;return J(x);};
    s.eq('every other value is identical to what submitPO stored (sizes, ratio, stages, bundlingParts, jobCopies, embellishment, status, createdBy, createdAt, notes ...)',norm(mine),norm(classic));
    s.eq('the six classic sizes with zeros, and the ratio the form computes',J([mine.sizes,mine.ratio]),J([{XS:0,S:50,M:50,L:0,XL:0,'2XL':0},'0:1:1:0:0:0']));
    s.eq('no photos: imgFront / imgBack are empty (the classic requires one; the app draws "No image")',J([mine.imgFront,mine.imgBack]),J(['','']));
    s.ok('no fabric rolls reserved: fabrics is empty and fabPoReserveCommit is never named',J(mine.fabrics)==='[]'&&!/fabPoReserveCommit\s*\(/.test(SRC.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'')));
    s.eq('the draft\'s season is carried (ph-core reads it)',mine.season,'winter');
  }
  s.section('sizes beyond the classic six keep their keys');
  {
    const wp=Object.assign({},GOOD,{code:'GD007',name:'Straight Denim',sizes:{'30':40,'32':60},ratio:'2:3',qty:100});
    const a=await loaded(seedFor({['po_drafts/'+DID]:draft(DID,'ready',wp)}));
    const r=await a.issue(DID,OPT(MU));
    const m=a.db.get('pos/PO-007')||{};
    s.ok('a waist-size draft issues, keeps its own sizes beside the six zeros, and keeps its own ratio',r.ok&&m.sizes['30']===40&&m.sizes['32']===60&&m.sizes.XS===0&&m.ratio==='2:3',J(r));
  }

  /* ═══ the rules text ═══ */
  s.section('firestore.rules: the issue clause');
  {
    const brace=(text,re)=>{const m=re.exec(text);if(!m)return null;let i=text.indexOf('{',m.index+m[0].length-1),d=0,st=i;for(;i<text.length;i++){const c=text[i];if(c==='{')d++;else if(c==='}'){d--;if(!d)return text.slice(st,i+1);}}return null;};
    const step=brace(RULES,/function\s+phDraftStep\s*\([^)]*\)\s*\{/)||'';
    const ok=brace(RULES,/function\s+phIssueOk\s*\([^)]*\)\s*\{/)||'';
    const clause=step.slice(step.indexOf('// issue as a PO'));
    const a=mkApp({});
    const list=(clause.match(/hasOnly\(\[([^\]]*)\]\)/)||[])[1];
    s.eq('the clause\'s key list = PH_DRAFT_ISSUE_FIELDS (the writer\'s patch keys)',J(list.split(',').map(x=>x.trim().replace(/'/g,'')).sort()),J(a.run('PH_DRAFT_ISSUE_FIELDS').slice().sort()));
    s.eq('and the writer\'s patch has exactly those keys',J(Object.keys(a.run('phDraftIssuePatch({rev:3},"PO-007",{u:"mustafa",now:'+NOW+'}).patch')).sort()),J(a.run('PH_DRAFT_ISSUE_FIELDS').slice().sort()));
    s.ok('only from ready, to issued, by a manager, in the issuer\'s own name',/r\.status == 'ready' && d\.status == 'issued' && isProdOpsManager\(\) && phBy\(d\.get\('issuedBy', ''\)\)/.test(clause));
    s.ok('issuedAt must be a number',/d\.get\('issuedAt', null\) is number/.test(clause));
    s.ok('the clause demands the new-PO check (phIssueOk)',/&& phIssueOk\(d\)\)\);/.test(clause));
    s.ok('phIssueOk: a PO number, did not exist, exists after, names this draft and this issuer',/matches\('\^PO-\[0-9\]\{3,\}\$'\)/.test(ok)&&/!exists\(\/databases\/\$\(database\)\/documents\/pos\//.test(ok)&&/existsAfter\(/.test(ok)&&/get\('fromDraftId', ''\) == d\.get\('id', ''\)/.test(ok)&&/get\('issuedBy', ''\) == d\.get\('issuedBy', ''\)/.test(ok));
    s.ok('issued is terminal: the step admits only a stored draft or ready draft, and nothing else leaves "issued"',/r\.get\('status', ''\) in \['draft', 'ready'\]/.test(step)&&!/r\.status == 'issued'/.test(step));
    s.ok('a draft goes to issued ONLY from ready (no draft -> issued clause)',(step.match(/d\.status == 'issued'/g)||[]).length===1&&/r\.status == 'ready' && d\.status == 'issued'/.test(step));
    s.ok('drafts are still never deletable',/match \/po_drafts\/\{id\}[\s\S]*?allow delete: if false;/.test(RULES));
    const pos=brace(RULES,/match\s+\/pos\/\{doc\}\s*\{/)||'';
    s.eq('the pos rule block is byte-for-byte what it was at the base commit (we only CREATE through it)',crypto.createHash('md5').update(pos).digest('hex'),POS_BLOCK_MD5);
    s.ok('and it is still a plain signedIn() write, with the history sub-rule inside',/allow write: if signedIn\(\);/.test(pos)&&/match \/history\/\{row\}/.test(pos));
  }

  /* ═══ source scope ═══ */
  s.section('scope: what ph-issue.js may write');
  {
    // WP3b: phPoInstructionsRefresh (below the marker) is a second, separate transaction, tested in tests/ph-snapshot.test.js
    const code=SRC.split('/* ── WP3b: deliberately refresh')[0].replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/.*$/gm,'$1');
    s.ok('no plain write API (setDoc, updateDoc, deleteDoc, addDoc, writeBatch) and no delete',!/\b(setDoc|updateDoc|deleteDoc|addDoc|writeBatch)\s*\(/.test(code)&&!/\.delete\s*\(/.test(code));
    s.ok('it never calls getNextId or createWithNextId itself: the number comes from mintNextIdInTx inside its own transaction',!/\bgetNextId\s*\(/.test(code)&&/mintNextIdInTx\(tx,/.test(code)&&(code.match(/runTransaction\(/g)||[]).length===1);
    const sets=[...code.matchAll(/tx\.(set|update)\(([^)]*)\)/g)].map(m=>m[1]+':'+m[2].split(',')[0].trim());
    s.eq('its transaction writes only the draft (update), the history row (set), and — through mintNextIdInTx — the counter and the NEW pos document',J(sets),J(['update:dref','set:doc(db']));
    s.ok('the pos id comes only from the minted id',/doc\(db,'pos',m\.id,'history'/.test(code)&&!/doc\(db,'pos',[^m]/.test(code));
  }

  /* ═══ deliberate breaks ═══ */
  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const pairs=Array.isArray(from)?from:[[from,to]];
    let mut=SRC;
    for(const [f,t] of pairs){
      if(mut.split(f).length-1<1){s.ok('break target exists: '+label+' ('+f.slice(0,50)+')',false);return;}
      mut=mut.split(f).join(t);
    }
    let r;try{r=await checks(mut);}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  await brk('the manager gate dropped',"  if(!phCanManage(a.u))return _phFail('forbidden','Only a manager (Afnan, Ammar, Mustafa) can issue a draft as a PO.');\n","",['managers: uzaib is refused, forbidden','managers: uzaib refused: nothing written, counters untouched']);
  await brk('the ready check dropped',"        if(prev.status!=='ready')throw _phRefuse('refused','Draft '+draftId+' is '+prev.status+', not ready, so it cannot be issued.');\n","",['status: a draft draft cannot be issued, nothing written','status: a abandoned draft cannot be issued, nothing written']);
  await brk('the issued check dropped',"        if(prev.status==='issued')throw","        if(false)throw",['twice: a second issue of the same draft is refused, saying which PO it became','concurrent: the loser is refused as already issued']);
  await brk('the issued, ready AND revision checks dropped (a second issue mints a second PO; each alone is covered by the other two)',[["        if(prev.status==='issued')throw","        if(false)throw"],["        if(prev.status!=='ready')throw","        if(false)throw"],["        if(prev.rev!==o.expectedRev)throw","        if(false)throw"]],'',['concurrent: one PO was created and no number was burned (counter 7, no PO-008)','twice: and the counter did not move again']);
  await brk('the revision check dropped',"        if(prev.rev!==o.expectedRev)throw","        if(false)throw",['stale: a draft at another revision is refused with the revision']);
  await brk('the expectedRev requirement dropped',"  if(!(typeof o.expectedRev==='number'&&isFinite(o.expectedRev)&&Math.floor(o.expectedRev)===o.expectedRev&&o.expectedRev>=1))return","  if(false)return",['stale: an issue with no expectedRev is refused as invalid']);
  await brk('phPoComplete not re-run on the stored po',"        if(!gate.ok)throw","        if(false)throw",['incomplete: a ready draft whose stored po is incomplete is refused, naming the field','incomplete: a master retired since the draft was readied refuses the issue']);
  await brk('the registry is not re-read at issue time',"    try{if(typeof phLoadStage==='function')await phLoadStage('masters',{force:true});}catch(e){}\n","",['masters: a master retired after the page loaded is caught at issue time (the registry is re-read)']);
  await brk('an unreadable registry is skipped',"    if(masters===null)return _phFail('unread','The cutting-master list was not read, so the draft cannot be checked. Nothing was created. Reload Production Ops and retry.');","",['masters: an unreadable registry refuses the issue (unread), nothing written']);
  await brk('the floor is ignored',"floor:floor,idFor:_poIdFor","floor:0,idFor:_poIdFor",['floor: a reset counter cannot mint at or below a loaded PO (PO-007, not PO-001)']);
  await brk('the draft is not updated',"        tx.update(dref,d.patch);\n","",['happy: the draft is issued with poId / issuedAt / issuedBy, rev + 1, the po map untouched','happy: ONE commit carrying exactly the four writes (counter, pos, draft, history)']);
  await brk('no history row',"        tx.set(doc(db,'pos',m.id,'history',hist.id),Object.assign({},hist.data,{data:Object.assign({},hist.data.data,{poId:m.id,qty:rec.qty},rec.instructionsRev!=null?{instructionsRev:rec.instructionsRev}:{})}));\n","",['happy: one history row of type issued, by the issuer, from ready to issued','happy: ONE commit carrying exactly the four writes (counter, pos, draft, history)']);
  await brk('the pos document is written outside the transaction',"        m.write(rec);\n","        await setDoc(doc(db,'pos',m.id),rec);tx.update(doc(db,'counters','main'),{pos:m.n});\n",['refused commit: the store is byte-identical (no PO, no counter move, draft still ready)','happy: no plain (non-transaction) write was made']);
  await brk('the offline refusal dropped',"  if(_phOffline())return _phFail('offline',","  if(false)return _phFail('offline',",['offline: refused out loud, nothing created']);
  await brk('the unread PO list is guessed (floor 0)',"    catch(e){return _phFail('unread',String((e&&e.message)||'The PO list did not load, so the next PO number cannot be checked.')+' Nothing was created.');}","    catch(e){floor=0;}",['unread: a PO list that cannot be read refuses the issue, saying nothing was created']);
  await brk('the basis check dropped',"        if(!sameBasis)throw","        if(false)throw",['basis: a draft whose article changed between the lookup and the transaction is refused']);
  await brk('PO born reserved again (status)',"poStatus:PO_STATUS.IN_PRODUCTION,currentStage:'cutting',","poStatus:PO_STATUS.RESERVED,currentStage:'cutting',",['happy: the PO is born in_production at cutting (what submitPO creates since the reserve removal)']);
  await brk('PO born with no stage',"poStatus:PO_STATUS.IN_PRODUCTION,currentStage:'cutting',","poStatus:PO_STATUS.IN_PRODUCTION,",['happy: the PO is born in_production at cutting (what submitPO creates since the reserve removal)']);
  await brk('the recipe lookup is guessed when unreadable',"throw _phRefuse('unread','This PO needs an embellishment recipe check, but the recipes are not loaded.","return{recipes:[],rateOf:null};throw _phRefuse('unread','This PO needs an embellishment recipe check, but the recipes are not loaded.",['embellishment: required but the recipes cannot be had = refused (unread), nothing written']);
  await brk('the draft id is not recorded on the PO',"  rec.fromDraftId=c.draftId;","  rec.fromDraftId='';",['happy: the PO names its draft, who entered it and who issued it']);
  await brk('the follow-up failure undoes the issue',"  try{\n    const emb=po.embellishment||{};","  throw new Error('x');\n  try{\n    const emb=po.embellishment||{};",['follow-ups: a failing trim request is reported and the PO stands']);
  // the document-shape breaks (checked in the dedicated section above, so run them directly)
  {
    const shape=async(label,from,to)=>{
      const mut=SRC.split(from).join(to);
      if(mut===SRC){s.ok('break target exists: '+label,false);return;}
      const a=await loaded(seedFor(),{src:mut,allPOs:[po(1),po(6)]});
      const v={'po-name':GOOD.name,'po-code':GOOD.code,'po-qty':'100','po-fabric':GOOD.fabric,'po-pattern':GOOD.pattern,'po-fabriccode':GOOD.fabricCode,'po-store':GOOD.store,'po-rolls':GOOD.totalRoll,'po-notes':GOOD.notes,'sz-S':'50','sz-M':'50'};
      Object.keys(v).forEach(k=>{a.el(k).value=v[k];});a.el('po-jc-embroidery').checked=true;a.run("poImages.front='x';");a.run('window.updateRatio()');
      await a.run('window.submitPO()');
      let same=false;
      try{const r=await a.issue(DID,OPT(MU,3,{now:Date.now()}));const c=a.db.get('pos/PO-007'),m=a.db.get('pos/PO-008')||{};
        const norm=d=>{const x=clone(d);['ts','id','imgFront','imgBack','season','fromDraftId','enteredBy','issuedBy'].forEach(k=>delete x[k]);return J(x);};
        same=r.ok&&norm(m)===norm(c)&&J(Object.keys(m))===J(Object.keys(c).filter(k=>k!=='id').concat(['id','season','fromDraftId','enteredBy','issuedBy']));}catch(e){same=false;}
      broken++;s.ok('break "'+label+'" fails the submitPO comparison',same===false);
    };
    await shape('the six zero sizes dropped',"PH_ISSUE_SIX.forEach(function(k){const n=phWhole(src[k]);sizes[k]=n!==null&&n>0?n:0;});","PH_ISSUE_SIX.forEach(function(k){const n=phWhole(src[k]);if(n!==null&&n>0)sizes[k]=n;});");
    await shape('the stages dropped',"    stages:stages,","    stages:{},");
    await shape('the bundling parts dropped',"    bundlingParts:[{name:'Full Garment',notes:'',dest:'Warehouse'}],","    bundlingParts:[],");
    await shape('the job copies dropped',"    jobCopies:jc,","    jobCopies:{},");
    await shape('the ratio dropped',"ratio:sz.extra&&typeof d.ratio==='string'&&d.ratio?d.ratio:_phiRatio(sz.sizes),","ratio:'',");
    await shape('createdBy is the draft creator instead of the issuer',"    createdBy:c.issuedByName,","    createdBy:c.enteredBy,");
    await shape('a key goes missing (notes)',"    notes:_phiStr(d.notes,500),\n","");
  }
  s.ok('breaks run: '+broken,broken>=24);
  return s;
};

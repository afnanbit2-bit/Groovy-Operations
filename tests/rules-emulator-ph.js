/* ─────────────────────────────────────────────────────────────────────────
   tests/rules-emulator-ph.js — the Production Ops data-layer rules, run in the
   REAL Firestore emulator (12 Oct 2026).

   Not a *.test.js on purpose: it needs firebase-tools, the emulator and Java,
   and CI installs nothing (the zero-new-deps line), so tests/run.js must not
   pick it up. Run it by hand whenever the Production Ops rules change:

     mkdir -p /tmp/emu && cd /tmp/emu && npm init -y >/dev/null
     npm install firebase-tools@13 @firebase/rules-unit-testing firebase
     cd <repo> && EMU_DEPS=/tmp/emu/node_modules \
       /tmp/emu/node_modules/.bin/firebase emulators:exec --only firestore \
       --project demo-ph "node tests/rules-emulator-ph.js"

   (firebase.json with {"firestore":{"rules":"firestore.rules"}} must exist in
   the directory the command runs from; the test loads the rules file itself.)

   The demo- project id keeps the emulator offline: nothing here can reach
   groovy-gatepass. The ALLOWED paths run the app's OWN writers (js/ph-write.js,
   through tests/harness.js, against the emulator's real SDK), so a rule and the
   client that has to satisfy it are tested together; the REFUSED paths are raw
   SDK writes, because a modified client is exactly what a rule is for.

   This checks the rules FILE. What the Firebase Console has published is a
   separate question only the human can answer.
   ───────────────────────────────────────────────────────────────────────── */
const fs=require('fs');
const path=require('path');
const REPO=path.join(__dirname,'..');
const dep=p=>require(require.resolve(p,{paths:[process.env.EMU_DEPS,process.cwd()].filter(Boolean)}));
const {initializeTestEnvironment,assertSucceeds,assertFails}=dep('@firebase/rules-unit-testing');
const fsdk=dep('firebase/firestore');
const {doc,setDoc,updateDoc,getDoc,getDocs,deleteDoc,collection,query,orderBy,limit,where,runTransaction,writeBatch}=fsdk;
const harness=require('./harness.js');

const PEOPLE={
  afnan:{uid:'u-afnan',email:'afnan@groovy.op',u:'afnan',name:'Afnan'},
  ammar:{uid:'u-ammar',email:'ammar@groovy.op',u:'ammar',name:'Ammar'},
  mustafa:{uid:'u-mustafa',email:'mustafa@groovy.op',u:'mustafa',name:'Mustafa'},
  uzaib:{uid:'u-uzaib',email:'uzaib@groovy.op',u:'uzaib',name:'Uzaib'},
  raees:{uid:'u-raees',email:'raees@groovy.op',u:'raees',name:'Raees'},
  umair:{uid:'u-umair',email:'umair@groovy.op',u:'umair',name:'Umair'},
  arfat:{uid:'u-arfat',email:'arfat@groovy.op',u:'arfat',name:'Arfat'},
  qa:{uid:'8TKOO3GKhBb0NSEEK15LFTIAshI2',email:'claude@groovy.op',u:'claude',name:'Claude QA'}
};
const {afnan:AFNAN,ammar:AMMAR,mustafa:MUSTAFA,uzaib:UZAIB,raees:RAEES,umair:UMAIR,arfat:ARFAT,qa:QA}=PEOPLE;

let pass=0,fail=0;
async function t(name,fn){
  try{await fn();pass++;console.log('  ok   '+name);}
  catch(e){fail++;console.log('  FAIL '+name+'\n       '+String(e&&e.message||e).split('\n')[0]);}
}

(async()=>{
  const env=await initializeTestEnvironment({projectId:'demo-ph',firestore:{rules:fs.readFileSync(process.env.RULES_FILE||path.join(REPO,'firestore.rules'),'utf8'),host:process.env.FIRESTORE_EMULATOR_HOST?process.env.FIRESTORE_EMULATOR_HOST.split(':')[0]:'127.0.0.1',port:process.env.FIRESTORE_EMULATOR_HOST?Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]):8080}});
  const as=w=>w==='anon'?env.unauthenticatedContext().firestore():env.authenticatedContext(w.uid,{email:w.email}).firestore();
  const seed=(p,data)=>env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),...p.split('/')),data);});
  const read=async p=>{let out=null;await env.withSecurityRulesDisabled(async c=>{const s=await getDoc(doc(c.firestore(),...p.split('/')));out=s.exists()?s.data():null;});return out;};
  const reset=()=>env.clearFirestore();

  // The app, loaded once. Its writers run against the emulator through globals that are re-pointed per actor.
  // The harness runs the app inside a node `vm` context, so an object literal the app builds has the
  // CONTEXT's Object.prototype, which the real SDK refuses ("Data must be an object, but it was: a
  // custom Object object"). That is an artefact of the harness, not of the app (a browser has one
  // realm), so every payload is passed through a realm-neutral clone on its way to the SDK.
  const clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
  const wrapTx=tx=>{const w={get:r=>tx.get(r),set:(r,d,o)=>{o===undefined?tx.set(r,clone(d)):tx.set(r,clone(d),o);return w;},update:(r,d)=>{tx.update(r,clone(d));return w;},delete:r=>{tx.delete(r);return w;}};return w;};
  const app=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js'],globals:{
    doc,collection,query,orderBy,limit,where,getDoc,getDocs,deleteDoc,writeBatch,
    setDoc:(r,d,o)=>o===undefined?setDoc(r,clone(d)):setDoc(r,clone(d),o),
    updateDoc:(r,d)=>updateDoc(r,clone(d)),
    runTransaction:(db,fn)=>runTransaction(db,tx=>fn(wrapTx(tx)))
  }});
  const asApp=w=>{
    app.ctx.db=as(w);
    app.ctx.session={uid:w.uid,u:w.u,name:w.name,email:w.email,role:'owner'};
    app.ctx.auth={currentUser:null};
    return app;
  };
  const call=async(w,expr)=>{asApp(w);app.ctx.__r=undefined;return await app.run('(async()=>{return await '+expr+';})()');};
  const NOW=1790000000000;
  let tick=0;
  const nx=()=>NOW+(++tick)*1000;
  const PO='PO-001';
  const seedPo=()=>seed('pos/'+PO,{id:PO,qty:100,code:'GST073'});
  const GOOD_PO={code:'GST073',name:'Effortless Tee',qty:100,sizes:{S:50,M:50},fabric:'Jersey 180',plannedFabricQty:30,plannedFabricUnit:'kg',season:'winter',plannedCutDate:'2026-10-20',requestedDate:'2026-10-25',cutMasterId:'CM-001'};
  const draftDoc=(w,over)=>Object.assign({id:'DRAFT-LZ4K9F2A-AB12',status:'draft',rev:1,entryDevice:'pc',createdBy:w.u,createdByName:w.name,createdAt:NOW,updatedAt:NOW,updatedBy:w.u,po:{code:'GST073'}},over||{});
  const DID='DRAFT-LZ4K9F2A-AB12';

  /* ═══ po_drafts ═══ */
  console.log('po_drafts');
  for(const w of [AFNAN,AMMAR,MUSTAFA,UZAIB])
    await t(w.u+' creates a draft with the app\'s own writer',async()=>{await reset();const r=await call(w,'phSaveDraft(null,{code:"GST073"},{now:'+nx()+'})');if(!r.ok)throw new Error('writer: '+r.error);
      const s=await read('po_drafts/'+r.id);if(!s||s.createdBy!==w.u||s.rev!==1||s.entryDevice!=='pc')throw new Error('stored draft wrong');});
  for(const w of [RAEES,UMAIR,ARFAT,QA,'anon'])
    await t((w.u||'signed-out')+' cannot create a draft',async()=>{await reset();await assertFails(setDoc(doc(as(w),'po_drafts',DID),draftDoc(w.u?w:AFNAN)));});
  await t('anyone signed in reads drafts (Raees, Umair); QA reads (get + list); signed-out does not',async()=>{await reset();await seed('po_drafts/'+DID,draftDoc(AFNAN));
    for(const w of [RAEES,UMAIR,QA]){await assertSucceeds(getDoc(doc(as(w),'po_drafts',DID)));await assertSucceeds(getDocs(query(collection(as(w),'po_drafts'),limit(5))));}
    await assertFails(getDoc(doc(as('anon'),'po_drafts',DID)));});
  await t('QA cannot write a draft even in its own name',async()=>{await reset();await assertFails(setDoc(doc(as(QA),'po_drafts',DID),draftDoc(QA)));});
  await t('create: an id outside the pattern is refused',async()=>{await reset();await assertFails(setDoc(doc(as(AFNAN),'po_drafts','draft-1'),draftDoc(AFNAN,{id:'draft-1'})));});
  await t('create: the id field must be the document id',async()=>{await reset();await assertFails(setDoc(doc(as(AFNAN),'po_drafts',DID),draftDoc(AFNAN,{id:'DRAFT-LZ4K9F2A-ZZ99'})));});
  await t('create: born ready / rev 2 / phone / in another person\'s name / with an extra key / po not a map are refused',async()=>{await reset();
    for(const over of [{status:'ready'},{rev:2},{entryDevice:'phone'},{createdBy:'ammar'},{updatedBy:'ammar'},{issuedPoId:'PO-001'},{po:'text'},{createdAt:'now'}])
      await assertFails(setDoc(doc(as(AFNAN),'po_drafts',DID),draftDoc(AFNAN,over)));
    await assertSucceeds(setDoc(doc(as(AFNAN),'po_drafts',DID),draftDoc(AFNAN)));});
  await t('edit with the writer bumps rev; a stale expectedRev is refused by the writer, naming stale',async()=>{await reset();await seed('po_drafts/'+DID,draftDoc(UZAIB));
    const ok=await call(UZAIB,'phSaveDraft("'+DID+'",{code:"GST073",qty:5},{now:'+nx()+',expectedRev:1})');if(!ok.ok||ok.rev!==2)throw new Error('edit: '+JSON.stringify(ok));
    const stale=await call(UZAIB,'phSaveDraft("'+DID+'",{code:"GST073",qty:6},{now:'+nx()+',expectedRev:1})');if(stale.ok||stale.code!=='stale')throw new Error('expected stale, got '+JSON.stringify(stale));});
  await t('edit: rev must move by exactly one (a raw skip to +2, or staying put, is refused)',async()=>{await reset();await seed('po_drafts/'+DID,draftDoc(AFNAN));
    await assertFails(updateDoc(doc(as(AFNAN),'po_drafts',DID),{rev:3,po:{a:1},updatedAt:NOW+1,updatedBy:'afnan'}));
    await assertFails(updateDoc(doc(as(AFNAN),'po_drafts',DID),{rev:1,po:{a:1},updatedAt:NOW+1,updatedBy:'afnan'}));
    await assertSucceeds(updateDoc(doc(as(AFNAN),'po_drafts',DID),{rev:2,po:{a:1},updatedAt:NOW+1,updatedBy:'afnan'}));});
  await t('edit: createdBy / createdAt / id cannot be rewritten, nor an unknown field added',async()=>{await reset();await seed('po_drafts/'+DID,draftDoc(AFNAN));
    for(const patch of [{createdBy:'uzaib'},{createdAt:1},{id:'DRAFT-X-AAAA'},{issuedPoId:'PO-001'},{status:'issued'}])
      await assertFails(updateDoc(doc(as(AFNAN),'po_drafts',DID),Object.assign({rev:2,updatedAt:NOW+1,updatedBy:'afnan'},patch)));});
  await t('edit: updatedBy must be the caller',async()=>{await reset();await seed('po_drafts/'+DID,draftDoc(AFNAN));
    await assertFails(updateDoc(doc(as(UZAIB),'po_drafts',DID),{rev:2,po:{a:1},updatedAt:NOW+1,updatedBy:'afnan'}));});
  await t('Raees, Umair, QA and signed-out cannot edit',async()=>{await reset();await seed('po_drafts/'+DID,draftDoc(AFNAN));
    for(const w of [RAEES,UMAIR,QA,'anon'])await assertFails(updateDoc(doc(as(w),'po_drafts',DID),{rev:2,po:{a:1},updatedAt:NOW+1,updatedBy:w.u||'afnan'}));});
  await t('mark ready: the writer refuses an incomplete draft naming what is missing; a complete one goes ready',async()=>{await reset();
    await seed('cutting_masters/CM-001',{id:'CM-001',name:'Master One',active:true,kind:'inhouse'});
    await seed('po_drafts/'+DID,draftDoc(UZAIB,{po:{code:'GST073'}}));
    await call(UZAIB,'phLoadAll({force:true})');
    const bad=await call(UZAIB,'phMarkDraftReady("'+DID+'",{now:'+nx()+'})');if(bad.ok||bad.code!=='refused'||!/not complete/.test(bad.error))throw new Error('expected refusal, got '+JSON.stringify(bad));
    await seed('po_drafts/'+DID,draftDoc(UZAIB,{po:GOOD_PO}));
    const ok=await call(UZAIB,'phMarkDraftReady("'+DID+'",{now:'+nx()+'})');if(!ok.ok||ok.status!=='ready'||ok.rev!==2)throw new Error('ready: '+JSON.stringify(ok));});
  await t('ready and abandon must name the CALLER (readyBy / abandonedBy of someone else is refused)',async()=>{await reset();await seed('po_drafts/'+DID,draftDoc(UZAIB));
    await assertFails(updateDoc(doc(as(UZAIB),'po_drafts',DID),{status:'ready',rev:2,readyAt:NOW,readyBy:'afnan',updatedAt:NOW+1,updatedBy:'uzaib'}));
    await assertFails(updateDoc(doc(as(UZAIB),'po_drafts',DID),{status:'abandoned',rev:2,abandonedAt:NOW,abandonedBy:'afnan',abandonedReason:'x',updatedAt:NOW+1,updatedBy:'uzaib'}));
    await assertSucceeds(updateDoc(doc(as(UZAIB),'po_drafts',DID),{status:'ready',rev:2,readyAt:NOW,readyBy:'uzaib',updatedAt:NOW+1,updatedBy:'uzaib'}));});
  await t('a ready draft cannot be edited (a raw edit of a ready draft is refused)',async()=>{await reset();await seed('po_drafts/'+DID,draftDoc(AFNAN,{status:'ready'}));
    await assertFails(updateDoc(doc(as(AFNAN),'po_drafts',DID),{rev:2,po:{a:1},updatedAt:NOW+1,updatedBy:'afnan'}));});
  await t('send back: a manager can (writer), uzaib cannot (raw)',async()=>{await reset();await seed('po_drafts/'+DID,draftDoc(UZAIB,{status:'ready'}));
    await assertFails(updateDoc(doc(as(UZAIB),'po_drafts',DID),{status:'draft',rev:2,sentBackAt:NOW,sentBackBy:'uzaib',sentBackReason:'x',updatedAt:NOW+1,updatedBy:'uzaib'}));
    const ok=await call(MUSTAFA,'phSendBackDraft("'+DID+'","fabric missing",{now:'+nx()+'})');if(!ok.ok||ok.status!=='draft')throw new Error('send back: '+JSON.stringify(ok));});
  await t('abandon: uzaib can (writer); the abandoned draft is terminal; no one deletes',async()=>{await reset();await seed('po_drafts/'+DID,draftDoc(UZAIB));
    const ok=await call(UZAIB,'phAbandonDraft("'+DID+'","entered twice",{now:'+nx()+'})');if(!ok.ok||ok.status!=='abandoned')throw new Error('abandon: '+JSON.stringify(ok));
    await assertFails(updateDoc(doc(as(AFNAN),'po_drafts',DID),{status:'draft',rev:3,updatedAt:NOW+9,updatedBy:'afnan'}));
    await assertFails(deleteDoc(doc(as(AFNAN),'po_drafts',DID)));await assertFails(deleteDoc(doc(as(UZAIB),'po_drafts',DID)));});

  /* ═══ po_cut_jobs (+ the history row in the same transaction) ═══ */
  console.log('po_cut_jobs and pos/{id}/history');
  const jobDoc=(w,over)=>Object.assign({poId:PO,status:'open',rev:1,plannedCutDate:'2026-10-20',masterId:'CM-001',masterName:'Master One',plannedFabric:{qty:30,unit:'kg',note:''},rollsChecklist:null,note:'',createdAt:NOW,createdBy:w.u,createdByName:w.name,updatedAt:NOW,updatedBy:w.u},over||{});
  for(const w of [AFNAN,AMMAR,MUSTAFA,UZAIB])
    await t(w.u+' saves a cut job with the writer; the job AND its history row land together',async()=>{await reset();await seedPo();
      const r=await call(w,'phSaveCutJob("'+PO+'",{plannedCutDate:"2026-10-20",masterId:"CM-001",masterName:"Master One",plannedFabric:{qty:30,unit:"kg"}},{now:'+nx()+'})');
      if(!r.ok)throw new Error('writer: '+r.error);
      const j=await read('po_cut_jobs/'+PO);const h=await read('pos/'+PO+'/history/'+r.historyId);
      if(!j||j.status!=='open'||j.rev!==1)throw new Error('job wrong');if(!h||h.type!=='cut_job_opened'||h.by!==w.u)throw new Error('history row wrong: '+JSON.stringify(h));});
  await t('the writer refuses a job for a PO that does not exist, and writes nothing',async()=>{await reset();
    const r=await call(UZAIB,'phSaveCutJob("PO-999",{note:"x"},{now:'+nx()+'})');if(r.ok||r.code!=='missing')throw new Error('expected missing, got '+JSON.stringify(r));
    if(await read('po_cut_jobs/PO-999'))throw new Error('a job was written');});
  await t('a second save updates (rev 2) and writes a second history row; the stale writer is refused',async()=>{await reset();await seedPo();
    await call(UZAIB,'phSaveCutJob("'+PO+'",{note:"a"},{now:'+nx()+'})');
    const r=await call(UZAIB,'phSaveCutJob("'+PO+'",{note:"b",rollsChecklist:{total:5,verified:4,short:1,missing:0,extra:0}},{now:'+nx()+',expectedRev:1})');if(!r.ok||r.rev!==2)throw new Error(JSON.stringify(r));
    const stale=await call(UZAIB,'phSaveCutJob("'+PO+'",{note:"c"},{now:'+nx()+',expectedRev:1})');if(stale.ok||stale.code!=='stale')throw new Error('expected stale: '+JSON.stringify(stale));});
  await t('create: Raees, Umair, Arfat, QA and signed-out cannot create a job',async()=>{await reset();await seedPo();
    for(const w of [RAEES,UMAIR,ARFAT,QA,'anon'])await assertFails(setDoc(doc(as(w),'po_cut_jobs',PO),jobDoc(w.u?w:AFNAN)));});
  await t('create: poId must be the id; status must be open; rev 1; extra key / bad day / bad master id refused',async()=>{await reset();await seedPo();
    for(const over of [{poId:'PO-002'},{status:'done'},{status:'overridden'},{rev:2},{surprise:1},{plannedCutDate:'20 Oct'},{masterId:'master one'},{createdBy:'ammar'}])
      await assertFails(setDoc(doc(as(AFNAN),'po_cut_jobs',PO),jobDoc(AFNAN,over)));
    await assertFails(setDoc(doc(as(AFNAN),'po_cut_jobs','po-1'),jobDoc(AFNAN,{poId:'po-1'})));
    await assertSucceeds(setDoc(doc(as(AFNAN),'po_cut_jobs',PO),jobDoc(AFNAN)));});
  await t('update: only an owner marks a job overridden',async()=>{await reset();await seedPo();await seed('po_cut_jobs/'+PO,jobDoc(UZAIB));
    const p={status:'overridden',rev:2,updatedAt:NOW+1};
    await assertFails(updateDoc(doc(as(UZAIB),'po_cut_jobs',PO),Object.assign({updatedBy:'uzaib'},p)));
    await assertFails(updateDoc(doc(as(MUSTAFA),'po_cut_jobs',PO),Object.assign({updatedBy:'mustafa'},p)));
    await assertSucceeds(updateDoc(doc(as(AFNAN),'po_cut_jobs',PO),Object.assign({updatedBy:'afnan'},p)));});
  await t('update: a done job is never changed again',async()=>{await reset();await seed('po_cut_jobs/'+PO,jobDoc(UZAIB,{status:'done'}));
    await assertFails(updateDoc(doc(as(AFNAN),'po_cut_jobs',PO),{note:'x',rev:2,updatedAt:NOW+1,updatedBy:'afnan'}));});
  await t('update: poId / createdAt / createdBy cannot move; an unknown status is refused; rev must be +1',async()=>{await reset();await seed('po_cut_jobs/'+PO,jobDoc(UZAIB));
    for(const patch of [{poId:'PO-002'},{createdAt:5},{createdBy:'afnan'},{status:'finished'},{rev:5},{surprise:1}])
      await assertFails(updateDoc(doc(as(UZAIB),'po_cut_jobs',PO),Object.assign({rev:2,updatedAt:NOW+1,updatedBy:'uzaib'},patch)));
    await assertSucceeds(updateDoc(doc(as(UZAIB),'po_cut_jobs',PO),{rev:2,note:'ok',updatedAt:NOW+1,updatedBy:'uzaib'}));});
  await t('Raees, Umair, QA and signed-out cannot update or delete a job; nobody deletes',async()=>{await reset();await seed('po_cut_jobs/'+PO,jobDoc(UZAIB));
    for(const w of [RAEES,UMAIR,QA,'anon'])await assertFails(updateDoc(doc(as(w),'po_cut_jobs',PO),{rev:2,note:'x',updatedAt:NOW+1,updatedBy:w.u||'afnan'}));
    for(const w of [AFNAN,UZAIB])await assertFails(deleteDoc(doc(as(w),'po_cut_jobs',PO)));});
  await t('reads: signed-in and QA read jobs; signed-out does not',async()=>{await reset();await seed('po_cut_jobs/'+PO,jobDoc(UZAIB));
    for(const w of [RAEES,UMAIR,QA])await assertSucceeds(getDoc(doc(as(w),'po_cut_jobs',PO)));await assertFails(getDoc(doc(as('anon'),'po_cut_jobs',PO)));});

  /* ═══ pos/{id}/history ═══ */
  const ROW='1790000001000-ab12';
  const rowDoc=(w,over)=>Object.assign({at:NOW,by:w.u,byName:w.name,type:'scheduled',from:'',to:'',reason:'',data:{}},over||{});
  for(const w of [AFNAN,AMMAR,MUSTAFA,UZAIB])
    await t(w.u+' appends a history row with the writer',async()=>{await reset();await seedPo();const r=await call(w,'phAppendHistory("'+PO+'",{type:"scheduled",to:"2026-10-21",data:{n:1}},{now:'+nx()+'})');if(!r.ok)throw new Error(r.error);
      const h=await read('pos/'+PO+'/history/'+r.id);if(!h||h.by!==w.u)throw new Error('row wrong');});
  for(const w of [RAEES,UMAIR,ARFAT,QA,'anon'])
    await t((w.u||'signed-out')+' cannot append a history row',async()=>{await reset();await seedPo();await assertFails(setDoc(doc(as(w),'pos',PO,'history',ROW),rowDoc(w.u?w:AFNAN)));});
  await t('a row for a PO that does not exist is refused (existsAfter)',async()=>{await reset();await assertFails(setDoc(doc(as(AFNAN),'pos','PO-404','history',ROW),rowDoc(AFNAN)));});
  await t('a PO and its first history row can be written in ONE batch (existsAfter sees the PO)',async()=>{await reset();
    const f=as(UZAIB);const b=writeBatch(f);b.set(doc(f,'pos','PO-010'),{id:'PO-010',qty:10});b.set(doc(f,'pos','PO-010','history',ROW),rowDoc(UZAIB,{type:'issued'}));await assertSucceeds(b.commit());});
  await t('a row in someone else\'s name, with a bad id / type / extra key / a non-map data is refused',async()=>{await reset();await seedPo();
    for(const over of [{by:'ammar'},{type:'Scheduled'},{type:'x'},{type:5},{surprise:1},{data:[1,2]},{data:'x'},{at:'now'}])
      await assertFails(setDoc(doc(as(UZAIB),'pos',PO,'history',ROW),rowDoc(UZAIB,over)));
    await assertFails(setDoc(doc(as(UZAIB),'pos',PO,'history','row-1'),rowDoc(UZAIB)));
    await assertFails(setDoc(doc(as(UZAIB),'pos',PO,'history','179000000100-ab12'),rowDoc(UZAIB)));
    await assertSucceeds(setDoc(doc(as(UZAIB),'pos',PO,'history',ROW),rowDoc(UZAIB)));});
  await t('append-only: no update, no delete, not even by an owner',async()=>{await reset();await seedPo();await seed('pos/'+PO+'/history/'+ROW,rowDoc(AFNAN));
    for(const w of [AFNAN,AMMAR,UZAIB]){await assertFails(updateDoc(doc(as(w),'pos',PO,'history',ROW),{reason:'edited'}));await assertFails(deleteDoc(doc(as(w),'pos',PO,'history',ROW)));}});
  await t('history reads: signed-in and QA read a PO\'s rows; signed-out does not; the writer\'s phHistoryOf reads them bounded',async()=>{await reset();await seedPo();
    await seed('pos/'+PO+'/history/'+ROW,rowDoc(AFNAN));
    for(const w of [RAEES,UMAIR,QA])await assertSucceeds(getDocs(query(collection(as(w),'pos',PO,'history'),orderBy('at','desc'),limit(5))));
    await assertFails(getDocs(collection(as('anon'),'pos',PO,'history')));
    const r=await call(RAEES,'phHistoryOf("'+PO+'",{limit:5})');if(!r.ok||r.rows.length!==1)throw new Error(JSON.stringify(r));});

  /* ═══ pos itself is exactly what it was ═══ */
  console.log('pos (unchanged)');
  await t('any signed-in user still creates, updates and deletes a pos document (Raees, Umair, Arfat)',async()=>{await reset();
    for(const [w,id] of [[RAEES,'PO-021'],[UMAIR,'PO-022'],[ARFAT,'PO-023']]){
      await assertSucceeds(setDoc(doc(as(w),'pos',id),{id,qty:1}));await assertSucceeds(updateDoc(doc(as(w),'pos',id),{qty:2}));await assertSucceeds(deleteDoc(doc(as(w),'pos',id)));}});
  await t('QA still cannot write pos; signed-out still cannot read or write it; QA still reads it',async()=>{await reset();await seedPo();
    await assertFails(setDoc(doc(as(QA),'pos','PO-031'),{id:'PO-031'}));await assertFails(updateDoc(doc(as(QA),'pos',PO),{qty:5}));
    await assertFails(getDoc(doc(as('anon'),'pos',PO)));await assertFails(setDoc(doc(as('anon'),'pos','PO-032'),{id:'PO-032'}));
    await assertSucceeds(getDoc(doc(as(QA),'pos',PO)));});
  await t('a PO with history rows can still be updated and deleted by a signed-in user (the rows are a sub-collection)',async()=>{await reset();await seedPo();await seed('pos/'+PO+'/history/'+ROW,rowDoc(AFNAN));
    await assertSucceeds(updateDoc(doc(as(RAEES),'pos',PO),{qty:200}));await assertSucceeds(deleteDoc(doc(as(RAEES),'pos',PO)));});

  /* ═══ cutting_masters ═══ */
  console.log('cutting_masters and ph_settings/counters');
  for(const w of [AFNAN,AMMAR,MUSTAFA])
    await t(w.u+' adds a master with the writer (id from ph_settings/counters, never counters/main)',async()=>{await reset();
      await seed('cutting_masters/CM-009',{id:'CM-009',name:'Other',nameKey:'other',active:true,kind:'unset'});await call(w,'phLoadAll({force:true})');
      const r=await call(w,'phMasterAdd("  Hassan  ",{kind:"inhouse",now:'+nx()+'})');if(!r.ok)throw new Error(r.error);
      const m=await read('cutting_masters/'+r.id);const c=await read('ph_settings/counters');
      if(m.name!=='Hassan'||m.nameKey!=='hassan'||m.active!==true)throw new Error('master wrong');if(c.cutting_masters!==1||r.id!=='CM-001')throw new Error('counter/id wrong '+JSON.stringify([r.id,c]));
      if(await read('counters/main'))throw new Error('counters/main was written');});
  await t('the counter floors against an existing id: with CM-001 already present the next master is CM-002',async()=>{await reset();
    await seed('cutting_masters/CM-001',{id:'CM-001',name:'First',nameKey:'first',active:true,kind:'unset'});await call(AFNAN,'phLoadAll({force:true})');
    const r=await call(AFNAN,'phMasterAdd("Second",{now:'+nx()+'})');if(!r.ok||r.id!=='CM-002')throw new Error(JSON.stringify(r));
    const c=await read('ph_settings/counters');if(c.cutting_masters!==2)throw new Error('counter '+c.cutting_masters);});
  await t('a duplicate name (case/space-insensitive, or an old name kept as an alias) is refused by the writer; an unread list refuses too',async()=>{await reset();
    await call(AFNAN,'phResetData()');
    await seed('cutting_masters/CM-001',{id:'CM-001',name:'Alam',nameKey:'alam',active:true,kind:'unset',aliases:['old alam']});
    const unread=await call(AFNAN,'phMasterAdd("Zed",{now:'+nx()+'})');if(unread.ok||unread.code!=='unread')throw new Error('expected unread: '+JSON.stringify(unread));
    await call(AFNAN,'phLoadAll({force:true})');
    const d1=await call(AFNAN,'phMasterAdd(" ALAM ",{now:'+nx()+'})');const d2=await call(AFNAN,'phMasterAdd("Old Alam",{now:'+nx()+'})');
    if(d1.ok||d1.code!=='exists'||d2.ok||d2.code!=='exists')throw new Error(JSON.stringify([d1,d2]));});
  await t('uzaib, Raees, Umair, Arfat, QA and signed-out cannot create a master (raw)',async()=>{await reset();
    const m=(w)=>({id:'CM-001',name:'X',nameKey:'x',kind:'unset',active:true,aliases:[],notes:'',createdAt:NOW,createdBy:w.u,createdByName:w.name,updatedAt:NOW,updatedBy:w.u,retiredAt:null,retiredBy:null,retiredReason:''});
    for(const w of [UZAIB,RAEES,UMAIR,ARFAT,QA])await assertFails(setDoc(doc(as(w),'cutting_masters','CM-001'),m(w)));
    await assertFails(setDoc(doc(as('anon'),'cutting_masters','CM-001'),m(AFNAN)));
    await assertSucceeds(setDoc(doc(as(AFNAN),'cutting_masters','CM-001'),m(AFNAN)));});
  await t('create: born retired / bad kind / bad id / extra key / long name / foreign createdBy are refused',async()=>{await reset();
    const m=(over)=>Object.assign({id:'CM-001',name:'X',nameKey:'x',kind:'unset',active:true,aliases:[],notes:'',createdAt:NOW,createdBy:'afnan',createdByName:'Afnan',updatedAt:NOW,updatedBy:'afnan',retiredAt:null,retiredBy:null,retiredReason:''},over||{});
    for(const over of [{active:false},{kind:'cousin'},{surprise:1},{name:'N'.repeat(41)},{createdBy:'ammar'},{name:''}])
      await assertFails(setDoc(doc(as(AFNAN),'cutting_masters','CM-001'),m(over)));
    await assertFails(setDoc(doc(as(AFNAN),'cutting_masters','master-1'),m({id:'master-1'})));});
  await t('rename (keeps the old name as an alias) and retire / reactivate with the writer; id and createdAt never move; nobody deletes',async()=>{await reset();
    await seed('cutting_masters/CM-001',{id:'CM-001',name:'Alam',nameKey:'alam',active:true,kind:'unset',aliases:[],notes:'',createdAt:NOW,createdBy:'afnan',createdByName:'Afnan',updatedAt:NOW,updatedBy:'afnan',retiredAt:null,retiredBy:null,retiredReason:''});
    await call(MUSTAFA,'phLoadAll({force:true})');
    const r=await call(MUSTAFA,'phMasterRename("CM-001","Alam Khan",{now:'+nx()+'})');if(!r.ok||r.master.aliases.join()!=='alam')throw new Error(JSON.stringify(r));
    const x=await call(MUSTAFA,'phMasterSetActive("CM-001",false,"left the company",{now:'+nx()+'})');if(!x.ok||x.master.active!==false)throw new Error(JSON.stringify(x));
    const y=await call(MUSTAFA,'phMasterSetActive("CM-001",true,"",{now:'+nx()+'})');if(!y.ok||y.master.active!==true)throw new Error(JSON.stringify(y));
    for(const patch of [{id:'CM-002'},{createdAt:1},{createdBy:'ammar'},{surprise:1}])
      await assertFails(updateDoc(doc(as(AFNAN),'cutting_masters','CM-001'),Object.assign({updatedAt:NOW+5,updatedBy:'afnan'},patch)));
    for(const w of [UZAIB,RAEES,QA])await assertFails(updateDoc(doc(as(w),'cutting_masters','CM-001'),{name:'Hacked',nameKey:'hacked',updatedAt:NOW+5,updatedBy:w.u}));
    for(const w of [AFNAN,MUSTAFA])await assertFails(deleteDoc(doc(as(w),'cutting_masters','CM-001')));});
  await t('masters are read by every signed-in user and by QA; not by signed-out',async()=>{await reset();await seed('cutting_masters/CM-001',{id:'CM-001',name:'A',nameKey:'a',active:true});
    for(const w of [RAEES,UMAIR,UZAIB,QA])await assertSucceeds(getDoc(doc(as(w),'cutting_masters','CM-001')));await assertFails(getDoc(doc(as('anon'),'cutting_masters','CM-001')));});
  await t('counters: a first counter must be 1..50 (0 and 99 are refused)',async()=>{await reset();
    for(const n of [0,51,99])await assertFails(setDoc(doc(as(AFNAN),'ph_settings','counters'),{cutting_masters:n,updatedAt:NOW,updatedBy:'afnan'}));
    await assertFails(setDoc(doc(as(UZAIB),'ph_settings','counters'),{cutting_masters:1,updatedAt:NOW,updatedBy:'uzaib'}));
    await assertSucceeds(setDoc(doc(as(AFNAN),'ph_settings','counters'),{cutting_masters:1,updatedAt:NOW,updatedBy:'afnan'}));});
  await t('counters: only managers, only upward, never above +50, no foreign key, no delete',async()=>{await reset();await seed('ph_settings/counters',{cutting_masters:5,updatedAt:NOW,updatedBy:'afnan'});
    await assertFails(updateDoc(doc(as(UZAIB),'ph_settings','counters'),{cutting_masters:6,updatedAt:NOW+1,updatedBy:'uzaib'}));
    await assertFails(updateDoc(doc(as(AFNAN),'ph_settings','counters'),{cutting_masters:4,updatedAt:NOW+1,updatedBy:'afnan'}));
    await assertFails(updateDoc(doc(as(AFNAN),'ph_settings','counters'),{cutting_masters:5,updatedAt:NOW+1,updatedBy:'afnan'}));
    await assertFails(updateDoc(doc(as(AFNAN),'ph_settings','counters'),{cutting_masters:99,updatedAt:NOW+1,updatedBy:'afnan'}));
    await assertFails(updateDoc(doc(as(AFNAN),'ph_settings','counters'),{cutting_masters:6,pos:0,updatedAt:NOW+1,updatedBy:'afnan'}));
    await assertSucceeds(updateDoc(doc(as(AFNAN),'ph_settings','counters'),{cutting_masters:6,updatedAt:NOW+1,updatedBy:'afnan'}));
    await assertFails(deleteDoc(doc(as(AFNAN),'ph_settings','counters')));});

  /* ═══ ph_standards ═══ */
  console.log('ph_standards');
  for(const w of [AFNAN,AMMAR,MUSTAFA])
    await t(w.u+' saves a standard with the writer; a re-save is rev 2',async()=>{await reset();
      const r=await call(w,'phStandardSave("gst073",{unit:"kg",grossPerPiece:0.31,tolerancePct:4,sizes:{S:0.3,M:0.32},sizeModel:"alpha",reason:"first"},{now:'+nx()+'})');if(!r.ok||r.id!=='GST073'||r.rev!==1)throw new Error(JSON.stringify(r));
      const r2=await call(w,'phStandardSave("GST073",{unit:"kg",grossPerPiece:0.33},{now:'+nx()+',expectedRev:1})');if(!r2.ok||r2.rev!==2)throw new Error(JSON.stringify(r2));
      const s=await read('ph_standards/GST073');if(s.grossPerPiece!==0.33||s.createdBy!==w.u)throw new Error('stored standard wrong');});
  await t('the writer refuses a unit it does not know and a zero gross, writing nothing',async()=>{await reset();
    const a=await call(AFNAN,'phStandardSave("GST073",{unit:"yards",grossPerPiece:1},{now:'+nx()+'})');const b=await call(AFNAN,'phStandardSave("GST073",{unit:"kg",grossPerPiece:0},{now:'+nx()+'})');
    if(a.ok||b.ok||await read('ph_standards/GST073'))throw new Error('should have refused');});
  await t('uzaib, Raees, Umair, Arfat, QA and signed-out cannot write a standard',async()=>{await reset();
    const d=(w)=>({code:'GST073',unit:'kg',grossPerPiece:0.3,tolerancePct:null,sizes:null,sizeModel:null,reason:'',rev:1,createdAt:NOW,createdBy:w.u,createdByName:w.name,updatedAt:NOW,updatedBy:w.u});
    for(const w of [UZAIB,RAEES,UMAIR,ARFAT,QA])await assertFails(setDoc(doc(as(w),'ph_standards','GST073'),d(w)));
    await assertFails(setDoc(doc(as('anon'),'ph_standards','GST073'),d(AFNAN)));});
  await t('create: unit yards / gross 0 / rev 2 / code not the id / extra key / bad tolerance / bad model refused',async()=>{await reset();
    const d=(over)=>Object.assign({code:'GST073',unit:'kg',grossPerPiece:0.3,tolerancePct:null,sizes:null,sizeModel:null,reason:'',rev:1,createdAt:NOW,createdBy:'afnan',createdByName:'Afnan',updatedAt:NOW,updatedBy:'afnan'},over||{});
    for(const over of [{unit:'yards'},{grossPerPiece:0},{grossPerPiece:'0.3'},{rev:2},{code:'GST074'},{surprise:1},{tolerancePct:150},{sizeModel:'huge'},{createdBy:'ammar'}])
      await assertFails(setDoc(doc(as(AFNAN),'ph_standards','GST073'),d(over)));
    await assertFails(setDoc(doc(as(AFNAN),'ph_standards','gst 073'),d({code:'gst 073'})));
    await assertSucceeds(setDoc(doc(as(AFNAN),'ph_standards','GST073'),d()));});
  await t('update: rev +1 only; code / createdAt / createdBy cannot move; no delete',async()=>{await reset();
    await seed('ph_standards/GST073',{code:'GST073',unit:'kg',grossPerPiece:0.3,tolerancePct:null,sizes:null,sizeModel:null,reason:'',rev:1,createdAt:NOW,createdBy:'afnan',createdByName:'Afnan',updatedAt:NOW,updatedBy:'afnan'});
    const p={unit:'kg',grossPerPiece:0.4,updatedAt:NOW+1,updatedBy:'afnan'};
    await assertFails(updateDoc(doc(as(AFNAN),'ph_standards','GST073'),Object.assign({rev:3},p)));
    await assertFails(updateDoc(doc(as(AFNAN),'ph_standards','GST073'),Object.assign({rev:1},p)));
    for(const patch of [{code:'GST999'},{createdAt:1},{createdBy:'ammar'}])await assertFails(updateDoc(doc(as(AFNAN),'ph_standards','GST073'),Object.assign({rev:2},p,patch)));
    await assertSucceeds(updateDoc(doc(as(AFNAN),'ph_standards','GST073'),Object.assign({rev:2},p)));
    for(const w of [AFNAN,MUSTAFA])await assertFails(deleteDoc(doc(as(w),'ph_standards','GST073')));});
  await t('standards are read by signed-in users and QA, not signed-out',async()=>{await reset();await seed('ph_standards/GST073',{code:'GST073',unit:'kg',grossPerPiece:0.3});
    for(const w of [RAEES,UZAIB,QA])await assertSucceeds(getDoc(doc(as(w),'ph_standards','GST073')));await assertFails(getDoc(doc(as('anon'),'ph_standards','GST073')));});

  /* ═══ ph_settings/main ═══ */
  console.log('ph_settings/main');
  await t('Mustafa (a manager, not an owner) saves capacity and skip days with the writer',async()=>{await reset();
    const r=await call(MUSTAFA,'phSettingsSave({dailyCapacity:500,skipDays:["2026-10-31"],offWeekdays:[0]},{now:'+nx()+'})');if(!r.ok||r.rev!==1)throw new Error(JSON.stringify(r));
    const s=await read('ph_settings/main');if(s.dailyCapacity!==500||s.skipDays.join()!=='2026-10-31'||'pcOnlyHard' in s)throw new Error('stored wrong '+JSON.stringify(s));
    const r2=await call(MUSTAFA,'phSettingsSave({dailyCapacity:450},{now:'+nx()+',expectedRev:1})');if(!r2.ok||r2.rev!==2)throw new Error(JSON.stringify(r2));
    const s2=await read('ph_settings/main');if(s2.skipDays.join()!=='2026-10-31')throw new Error('an earlier value was lost');});
  await t('the writer refuses a value the core would replace (capacity 0), naming it, and writes nothing',async()=>{await reset();
    const r=await call(AFNAN,'phSettingsSave({dailyCapacity:0},{now:'+nx()+'})');if(r.ok||r.code!=='invalid'||!/dailyCapacity/.test(r.error))throw new Error(JSON.stringify(r));if(await read('ph_settings/main'))throw new Error('wrote');});
  await t('pcOnlyHard: an owner can turn it on; Mustafa cannot (writer says forbidden; the raw write is refused by the rules)',async()=>{await reset();
    const m=await call(MUSTAFA,'phSettingsSave({pcOnlyHard:true},{now:'+nx()+'})');if(m.ok||m.code!=='forbidden')throw new Error(JSON.stringify(m));
    await assertFails(setDoc(doc(as(MUSTAFA),'ph_settings','main'),{pcOnlyHard:true,rev:1,updatedAt:NOW,updatedBy:'mustafa'}));
    const a=await call(AFNAN,'phSettingsSave({pcOnlyHard:true},{now:'+nx()+'})');if(!a.ok)throw new Error(JSON.stringify(a));
    const s=await read('ph_settings/main');if(s.pcOnlyHard!==true)throw new Error('not stored');});
  await t('once pcOnlyHard is on a manager can still save other values but cannot flip it back',async()=>{await reset();await seed('ph_settings/main',{pcOnlyHard:true,dailyCapacity:400,rev:1,updatedAt:NOW,updatedBy:'afnan'});
    await assertFails(updateDoc(doc(as(MUSTAFA),'ph_settings','main'),{pcOnlyHard:false,rev:2,updatedAt:NOW+1,updatedBy:'mustafa'}));
    await assertSucceeds(updateDoc(doc(as(MUSTAFA),'ph_settings','main'),{dailyCapacity:420,rev:2,updatedAt:NOW+1,updatedBy:'mustafa'}));
    await assertSucceeds(updateDoc(doc(as(AMMAR),'ph_settings','main'),{pcOnlyHard:false,rev:3,updatedAt:NOW+2,updatedBy:'ammar'}));});
  await t('uzaib, Raees, Umair, Arfat, QA and signed-out cannot write settings',async()=>{await reset();
    for(const w of [UZAIB,RAEES,UMAIR,ARFAT,QA])await assertFails(setDoc(doc(as(w),'ph_settings','main'),{dailyCapacity:400,rev:1,updatedAt:NOW,updatedBy:w.u}));
    await assertFails(setDoc(doc(as('anon'),'ph_settings','main'),{dailyCapacity:400,rev:1,updatedAt:NOW,updatedBy:'afnan'}));});
  await t('create/update: capacity 0 or 100001, a non-bool pcOnlyHard, an extra key, a foreign updatedBy, rev skip are refused; no other doc id works; no delete',async()=>{await reset();
    for(const over of [{dailyCapacity:0},{dailyCapacity:100001},{dailyCapacity:'400'},{pcOnlyHard:'yes'},{surprise:1},{updatedBy:'ammar'},{rev:2},{cutGate:[70]},{grossOverTolPct:101}])
      await assertFails(setDoc(doc(as(AFNAN),'ph_settings','main'),Object.assign({dailyCapacity:400,rev:1,updatedAt:NOW,updatedBy:'afnan'},over)));
    await assertFails(setDoc(doc(as(AFNAN),'ph_settings','other'),{dailyCapacity:400,rev:1,updatedAt:NOW,updatedBy:'afnan'}));
    await assertSucceeds(setDoc(doc(as(AFNAN),'ph_settings','main'),{dailyCapacity:400,rev:1,updatedAt:NOW,updatedBy:'afnan'}));
    await assertFails(updateDoc(doc(as(AFNAN),'ph_settings','main'),{rev:3,updatedAt:NOW+1,updatedBy:'afnan'}));
    await assertFails(deleteDoc(doc(as(AFNAN),'ph_settings','main')));});
  await t('settings are read by every signed-in user and by QA, not signed-out',async()=>{await reset();await seed('ph_settings/main',{dailyCapacity:400,rev:1});
    for(const w of [RAEES,UZAIB,QA])await assertSucceeds(getDoc(doc(as(w),'ph_settings','main')));await assertFails(getDoc(doc(as('anon'),'ph_settings','main')));});

  /* ═══ the loaders against the real rules ═══ */
  console.log('the loaders, against the real rules');
  await t('phLoadAll reads every stage as Raees (signed in, not in the audience) and as QA; nothing fails',async()=>{await reset();await seedPo();
    await seed('po_drafts/'+DID,draftDoc(AFNAN));await seed('cutting_masters/CM-001',{id:'CM-001',name:'A',nameKey:'a',active:true});
    for(const w of [RAEES,QA]){await call(w,'phResetData()');const r=await call(w,'phLoadAll({force:true})');if(!r.ok)throw new Error(w.u+': '+JSON.stringify(r.failed));
      const g=await call(w,'phGet("drafts")');if(!g.ok||g.rows.length!==1)throw new Error('drafts not read');}});
  await t('signed-out: phLoadAll never rejects and NAMES every refused collection; no stage reads as empty',async()=>{await reset();
    const app2=asApp(UZAIB);app2.ctx.db=as('anon');await app2.run('phResetData()');
    const r=await app2.run('(async()=>await phLoadAll({force:true}))()');
    if(r.ok||r.failed.length!==5)throw new Error('expected 5 failures, got '+JSON.stringify(r.failed.map(f=>f.name)));
    const g=await app2.run('phGet("drafts")');if(g.ok||g.rows!==null)throw new Error('a refused read looked like an empty list');
    if(!r.failed.every(f=>/republish firestore\.rules/.test(f.text)&&f.text.indexOf(f.name)===0))throw new Error('failures not named: '+r.failed.map(f=>f.text).join(' | '));});

  await env.cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});

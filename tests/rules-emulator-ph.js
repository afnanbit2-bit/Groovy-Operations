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

   Issue as PO (14 Oct 2026): the last section runs js/ph-issue.js's phIssueDraft (with the real js/shared.js and js/pos.js) against
   the emulator for Mustafa, Afnan and Ammar and shows Uzaib, Raees, Umair, QA and signed-out refused, every raw way of damaging the
   ready -> issued commit refused, and issued terminal.

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
  const NOW=Date.now();   // a history row's `at` must be within 2 days of the emulator's clock (the host clock)
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
  await t('abandoned is TERMINAL: no edit, no ready, no second abandon (who/why cannot be rewritten), no send back, no revive - by anyone, an owner included',async()=>{await reset();
    const ab=draftDoc(UZAIB,{status:'abandoned',rev:2,abandonedAt:NOW,abandonedBy:'uzaib',abandonedReason:'entered twice'});
    for(const w of [AFNAN,AMMAR,MUSTAFA,UZAIB]){
      await seed('po_drafts/'+DID,ab);
      const u=w.u,base={rev:3,updatedAt:NOW+9,updatedBy:u};
      for(const [what,patch] of [['edit',{po:{a:1}}],
          ['re-abandon with a new reason',{status:'abandoned',abandonedAt:NOW+9,abandonedBy:u,abandonedReason:'changed my mind'}],
          ['re-abandon with the same reason',{status:'abandoned',abandonedAt:NOW,abandonedBy:u,abandonedReason:'entered twice'}],
          ['mark ready',{status:'ready',readyAt:NOW+9,readyBy:u}],
          ['revive to draft',{status:'draft'}],
          ['send back',{status:'draft',sentBackAt:NOW+9,sentBackBy:u,sentBackReason:'oops'}]])
        await assertFails(updateDoc(doc(as(w),'po_drafts',DID),Object.assign({},base,patch)));
    }});
  await t('a READY draft: uzaib cannot edit, abandon or send it back (raw and writer); Mustafa and an owner can send it back or abandon it; uzaib still abandons a draft-status draft',async()=>{await reset();
    const rd=()=>seed('po_drafts/'+DID,draftDoc(UZAIB,{status:'ready',rev:2,readyAt:NOW,readyBy:'uzaib'}));
    const abandon=(w)=>updateDoc(doc(as(w),'po_drafts',DID),{status:'abandoned',rev:3,abandonedAt:NOW+1,abandonedBy:w.u,abandonedReason:'dup',updatedAt:NOW+1,updatedBy:w.u});
    const back=(w)=>updateDoc(doc(as(w),'po_drafts',DID),{status:'draft',rev:3,sentBackAt:NOW+1,sentBackBy:w.u,sentBackReason:'fabric',updatedAt:NOW+1,updatedBy:w.u});
    await rd();
    await assertFails(updateDoc(doc(as(UZAIB),'po_drafts',DID),{rev:3,po:{a:1},updatedAt:NOW+1,updatedBy:'uzaib'}));
    await assertFails(abandon(UZAIB));await assertFails(back(UZAIB));
    const wa=await call(UZAIB,'phAbandonDraft("'+DID+'","dup",{now:'+nx()+'})');if(wa.ok||wa.code!=='forbidden')throw new Error('writer let uzaib abandon: '+JSON.stringify(wa));
    const wb=await call(UZAIB,'phSendBackDraft("'+DID+'","x",{now:'+nx()+'})');if(wb.ok||wb.code!=='forbidden')throw new Error('writer let uzaib send back: '+JSON.stringify(wb));
    const we=await call(UZAIB,'phSaveDraft("'+DID+'",{code:"GST073",qty:3},{now:'+nx()+'})');if(we.ok||we.code!=='refused')throw new Error('writer let uzaib edit: '+JSON.stringify(we));
    for(const w of [MUSTAFA,AFNAN,AMMAR]){await rd();await assertSucceeds(abandon(w));await rd();await assertSucceeds(back(w));}
    await rd();const ok=await call(MUSTAFA,'phAbandonDraft("'+DID+'","duplicate",{now:'+nx()+'})');if(!ok.ok)throw new Error('writer: '+JSON.stringify(ok));
    await seed('po_drafts/'+DID,draftDoc(UZAIB));
    await assertSucceeds(updateDoc(doc(as(UZAIB),'po_drafts',DID),{status:'abandoned',rev:2,abandonedAt:NOW+1,abandonedBy:'uzaib',abandonedReason:'entered twice',updatedAt:NOW+1,updatedBy:'uzaib'}));});
  await t('abandon needs a stored reason: missing, empty, spaces only, a number, 501 characters are refused; 500 is fine; abandonedAt must be a number',async()=>{await reset();
    let W=UZAIB;   // a draft is abandoned by the floor, a ready draft only by a manager
    const go=(over,del)=>{const d=Object.assign({status:'abandoned',rev:2,abandonedAt:NOW,abandonedBy:W.u,updatedAt:NOW+1,updatedBy:W.u},over||{});(del||[]).forEach(k=>delete d[k]);return updateDoc(doc(as(W),'po_drafts',DID),d);};
    for(const status of ['draft','ready']){
      W=status==='ready'?MUSTAFA:UZAIB;
      await seed('po_drafts/'+DID,draftDoc(UZAIB,{status}));
      await assertFails(go({},['abandonedReason']));
      await assertFails(go({abandonedReason:''}));
      await assertFails(go({abandonedReason:'   '}));
      await assertFails(go({abandonedReason:7}));
      await assertFails(go({abandonedReason:'x'.repeat(501)}));
      await assertFails(go({abandonedReason:'ok',abandonedAt:'now'}));
      await assertSucceeds(go({abandonedReason:'x'.repeat(500)}));
    }});
  await t('send back needs a reason (1..500) and a numeric sentBackAt; mark ready needs a numeric readyAt',async()=>{await reset();
    const back=(over,del)=>{const d=Object.assign({status:'draft',rev:2,sentBackAt:NOW,sentBackBy:'mustafa',sentBackReason:'fabric missing',updatedAt:NOW+1,updatedBy:'mustafa'},over||{});(del||[]).forEach(k=>delete d[k]);return updateDoc(doc(as(MUSTAFA),'po_drafts',DID),d);};
    await seed('po_drafts/'+DID,draftDoc(UZAIB,{status:'ready'}));
    for(const o of [{sentBackReason:''},{sentBackReason:'  '},{sentBackReason:5},{sentBackReason:'x'.repeat(501)},{sentBackAt:'now'}])await assertFails(back(o));
    await assertFails(back({},['sentBackReason']));
    await assertSucceeds(back({}));
    await seed('po_drafts/'+DID,draftDoc(UZAIB));
    await assertFails(updateDoc(doc(as(UZAIB),'po_drafts',DID),{status:'ready',rev:2,readyAt:'now',readyBy:'uzaib',updatedAt:NOW+1,updatedBy:'uzaib'}));
    await assertSucceeds(updateDoc(doc(as(UZAIB),'po_drafts',DID),{status:'ready',rev:2,readyAt:NOW,readyBy:'uzaib',updatedAt:NOW+1,updatedBy:'uzaib'}));});

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
  await t('THE TRANSITION TABLE: every row of PH_JOB_TRANSITIONS, as raw writes by afnan, ammar, mustafa, uzaib, raees, QA and signed-out - allowed exactly for the role the table names',async()=>{await reset();await seedPo();
    const table=app.run('PH_JOB_TRANSITIONS.map(t=>t.slice())');
    if(table.length!==12)throw new Error('table has '+table.length+' rows');
    const roleOk=(who,w)=>who==='owner'?(w===AFNAN||w===AMMAR):who==='manager'?(w===AFNAN||w===AMMAR||w===MUSTAFA):(w===AFNAN||w===AMMAR||w===MUSTAFA||w===UZAIB);
    const wrong=[];
    for(const [from,to,who] of table){
      for(const w of [AFNAN,AMMAR,MUSTAFA,UZAIB,RAEES,QA,'anon']){
        const actor=w==='anon'?AFNAN:w;
        const patch={status:to,rev:2,updatedAt:NOW+1,updatedBy:actor.u,note:'n'+from+to};
        if(to==='complete'&&from!=='complete'){patch.completedAt=NOW+1;patch.completedBy=actor.u;}
        if(to==='done')patch.doneAt=NOW+1;
        if(from===to)delete patch.status;
        await seed('po_cut_jobs/'+PO,jobDoc(UZAIB,from==='complete'?{status:from,completedAt:NOW,completedBy:'uzaib'}:{status:from}));
        let ok=true;try{await assertSucceeds(updateDoc(doc(as(w),'po_cut_jobs',PO),patch));}catch(e){ok=false;}
        const want=(w!=='anon'&&w!==RAEES&&w!==QA)&&roleOk(who,w);
        if(ok!==want)wrong.push(from+'>'+to+' by '+(w.u||'signed-out')+': '+(ok?'allowed':'refused')+', table says '+(want?'allowed':'refused'));
      }
    }
    if(wrong.length)throw new Error(wrong.length+' rows differ: '+wrong.slice(0,4).join(' | '));});
  await t('done is TERMINAL: nothing leaves it for any status, nor is it edited, by anyone - an owner included',async()=>{await reset();await seedPo();
    for(const w of [AFNAN,AMMAR,MUSTAFA,UZAIB])for(const to of ['open','complete','overridden','done',null]){
      await seed('po_cut_jobs/'+PO,jobDoc(UZAIB,{status:'done',doneAt:NOW}));
      const patch={rev:2,updatedAt:NOW+1,updatedBy:w.u,note:'x'};if(to){patch.status=to;if(to==='complete'){patch.completedAt=NOW+1;patch.completedBy=w.u;}}
      await assertFails(updateDoc(doc(as(w),'po_cut_jobs',PO),patch));}});
  await t('a job cannot reach done without doneAt, or carry doneAt on another step; open -> done is a manager\'s and uzaib is refused',async()=>{await reset();await seedPo();
    const base={status:'done',rev:2,updatedAt:NOW+1,updatedBy:'mustafa'};
    await seed('po_cut_jobs/'+PO,jobDoc(UZAIB,{status:'complete',completedAt:NOW,completedBy:'uzaib'}));
    await assertFails(updateDoc(doc(as(MUSTAFA),'po_cut_jobs',PO),base));
    await assertFails(updateDoc(doc(as(MUSTAFA),'po_cut_jobs',PO),Object.assign({doneAt:'now'},base)));
    await assertFails(updateDoc(doc(as(MUSTAFA),'po_cut_jobs',PO),{rev:2,note:'x',doneAt:NOW,updatedAt:NOW+1,updatedBy:'mustafa'}));
    await assertSucceeds(updateDoc(doc(as(MUSTAFA),'po_cut_jobs',PO),Object.assign({doneAt:NOW+1},base)));
    await seed('po_cut_jobs/'+PO,jobDoc(UZAIB));
    await assertFails(updateDoc(doc(as(UZAIB),'po_cut_jobs',PO),Object.assign({doneAt:NOW+1},base,{updatedBy:'uzaib'})));
    await assertSucceeds(updateDoc(doc(as(MUSTAFA),'po_cut_jobs',PO),Object.assign({doneAt:NOW+1},base)));});
  await t('completedAt / completedBy: a number and the CALLER, set only as the job becomes complete, never rewritten later',async()=>{await reset();await seedPo();
    const go=(w,over,del)=>{const d=Object.assign({status:'complete',rev:2,completedAt:NOW+1,completedBy:w.u,updatedAt:NOW+1,updatedBy:w.u},over||{});(del||[]).forEach(k=>delete d[k]);return updateDoc(doc(as(w),'po_cut_jobs',PO),d);};
    await seed('po_cut_jobs/'+PO,jobDoc(UZAIB));
    await assertFails(go(UZAIB,{completedBy:'afnan'}));
    await assertFails(go(UZAIB,{completedAt:'now'}));
    await assertFails(go(UZAIB,{completedBy:7}));
    await assertFails(go(UZAIB,{},['completedBy']));
    await assertFails(go(UZAIB,{},['completedAt']));
    await assertFails(go(UZAIB,{doneAt:NOW+1}));
    await assertSucceeds(go(UZAIB,{}));
    // later steps may not move them
    await seed('po_cut_jobs/'+PO,jobDoc(UZAIB,{status:'complete',completedAt:NOW,completedBy:'uzaib'}));
    await assertFails(updateDoc(doc(as(MUSTAFA),'po_cut_jobs',PO),{rev:2,note:'x',completedAt:NOW+5,updatedAt:NOW+1,updatedBy:'mustafa'}));
    await assertFails(updateDoc(doc(as(MUSTAFA),'po_cut_jobs',PO),{rev:2,note:'x',completedBy:'mustafa',updatedAt:NOW+1,updatedBy:'mustafa'}));
    await assertFails(updateDoc(doc(as(MUSTAFA),'po_cut_jobs',PO),{status:'open',rev:2,completedBy:'mustafa',updatedAt:NOW+1,updatedBy:'mustafa'}));
    await assertSucceeds(updateDoc(doc(as(MUSTAFA),'po_cut_jobs',PO),{rev:2,note:'x',updatedAt:NOW+1,updatedBy:'mustafa'}));});
  await t('uzaib\'s floor: edits an open job and marks it complete; cannot edit a complete job, reopen it, un-override, override or close it',async()=>{await reset();await seedPo();
    await seed('po_cut_jobs/'+PO,jobDoc(UZAIB));
    await assertSucceeds(updateDoc(doc(as(UZAIB),'po_cut_jobs',PO),{rev:2,note:'edit',updatedAt:NOW+1,updatedBy:'uzaib'}));
    await assertSucceeds(updateDoc(doc(as(UZAIB),'po_cut_jobs',PO),{status:'complete',rev:3,completedAt:NOW+2,completedBy:'uzaib',updatedAt:NOW+2,updatedBy:'uzaib'}));
    await assertFails(updateDoc(doc(as(UZAIB),'po_cut_jobs',PO),{rev:4,note:'again',updatedAt:NOW+3,updatedBy:'uzaib'}));
    await assertFails(updateDoc(doc(as(UZAIB),'po_cut_jobs',PO),{status:'open',rev:4,updatedAt:NOW+3,updatedBy:'uzaib'}));
    await seed('po_cut_jobs/'+PO,jobDoc(AFNAN,{status:'overridden'}));
    await assertFails(updateDoc(doc(as(UZAIB),'po_cut_jobs',PO),{status:'open',rev:2,updatedAt:NOW+1,updatedBy:'uzaib'}));
    await assertFails(updateDoc(doc(as(MUSTAFA),'po_cut_jobs',PO),{status:'open',rev:2,updatedAt:NOW+1,updatedBy:'mustafa'}));
    await assertSucceeds(updateDoc(doc(as(AMMAR),'po_cut_jobs',PO),{status:'open',rev:2,updatedAt:NOW+1,updatedBy:'ammar'}));});
  await t('the app\'s own writer walks the legal path: uzaib completes, a manager closes, nothing moves after; and it refuses the illegal steps before the round trip',async()=>{await reset();await seedPo();
    await call(UZAIB,'phSaveCutJob("'+PO+'",{note:"a"},{now:'+nx()+'})');
    const c=await call(UZAIB,'phSaveCutJob("'+PO+'",{status:"complete"},{now:'+nx()+'})');if(!c.ok)throw new Error(JSON.stringify(c));
    const j=await read('po_cut_jobs/'+PO);if(j.completedBy!=='uzaib'||typeof j.completedAt!=='number'||'doneAt' in j)throw new Error('complete wrong '+JSON.stringify(j));
    const u=await call(UZAIB,'phSaveCutJob("'+PO+'",{status:"done"},{now:'+nx()+'})');if(u.ok||u.code!=='forbidden')throw new Error('uzaib closed it '+JSON.stringify(u));
    const d=await call(MUSTAFA,'phSaveCutJob("'+PO+'",{status:"done"},{now:'+nx()+'})');if(!d.ok)throw new Error(JSON.stringify(d));
    const j2=await read('po_cut_jobs/'+PO);if(typeof j2.doneAt!=='number'||j2.completedBy!=='uzaib')throw new Error('done wrong '+JSON.stringify(j2));
    const e=await call(AFNAN,'phSaveCutJob("'+PO+'",{note:"x"},{now:'+nx()+'})');if(e.ok||e.code!=='refused')throw new Error('done changed '+JSON.stringify(e));});
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
  await t('history limits: byName 60, from / to 80, reason 500, data 40 keys - one over is refused, the limit itself passes, wrong types are refused',async()=>{await reset();await seedPo();
    const keys=n=>{const o={};for(let i=0;i<n;i++)o['k'+i]=i;return o;};
    const put=over=>setDoc(doc(as(UZAIB),'pos',PO,'history',ROW),rowDoc(UZAIB,over));
    for(const over of [{byName:'n'.repeat(61)},{byName:7},{from:'f'.repeat(81)},{to:'t'.repeat(81)},{from:5},{to:{a:1}},{reason:'r'.repeat(501)},{reason:9},{data:keys(41)}])await assertFails(put(over));
    for(const ok of [{byName:'n'.repeat(60)},{from:'f'.repeat(80),to:'t'.repeat(80)},{reason:'r'.repeat(500)},{data:keys(40)}]){await reset();await seedPo();await assertSucceeds(put(ok));}});
  await t('history `at`: a positive whole number within 2 days of the server clock; zero, negative, fractional, text, far future and far past are refused',async()=>{await reset();await seedPo();
    const put=over=>setDoc(doc(as(UZAIB),'pos',PO,'history',ROW),rowDoc(UZAIB,over));
    const DAY=86400000;
    for(const at of [0,-NOW,NOW+0.5,'now',null,NOW+3*DAY,NOW-3*DAY,NOW*1000,1790000000000-DAY*400])await assertFails(put({at}));
    for(const at of [NOW+DAY,NOW-DAY,NOW+1000]){await reset();await seedPo();await assertSucceeds(put({at}));}
    await reset();await seedPo();const missing=rowDoc(UZAIB);delete missing.at;await assertFails(setDoc(doc(as(UZAIB),'pos',PO,'history',ROW),missing));});
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
  await t('delayTargetDays and stuckDays: 0..3650 numbers only (-1, 3651, 1e9 and text are refused; 0 and 3650 pass)',async()=>{await reset();
    const put=over=>setDoc(doc(as(AFNAN),'ph_settings','main'),Object.assign({dailyCapacity:400,rev:1,updatedAt:NOW,updatedBy:'afnan'},over));
    for(const k of ['delayTargetDays','stuckDays'])for(const v of [-1,3651,1e9,'3',null])await assertFails(put({[k]:v}));
    await assertSucceeds(put({delayTargetDays:0,stuckDays:3650}));
    await assertSucceeds(updateDoc(doc(as(AFNAN),'ph_settings','main'),{delayTargetDays:3650,stuckDays:0,rev:2,updatedAt:NOW+1,updatedBy:'afnan'}));
    await assertFails(updateDoc(doc(as(AFNAN),'ph_settings','main'),{stuckDays:3651,rev:3,updatedAt:NOW+2,updatedBy:'afnan'}));});
  await t('skipDays is a list of at most 5000 (5001 is refused, 5000 passes, a non-list is refused); the elements cannot be checked by the rules language',async()=>{await reset();
    const days=n=>{const a=[];for(let i=0;i<n;i++)a.push('2026-'+String(1+i%12).padStart(2,'0')+'-'+String(1+i%28).padStart(2,'0'));return a;};
    const put=over=>setDoc(doc(as(AFNAN),'ph_settings','main'),Object.assign({dailyCapacity:400,rev:1,updatedAt:NOW,updatedBy:'afnan'},over));
    await assertFails(put({skipDays:days(5001)}));
    await assertFails(put({skipDays:'2026-10-31'}));
    await assertFails(put({skipDays:{a:1}}));
    await assertSucceeds(put({skipDays:days(5000)}));});
  await t('offWeekdays: at most 6 elements, each a whole weekday 0..6 (7, -1, 1.5, text and a 7th element are refused)',async()=>{await reset();
    const put=over=>setDoc(doc(as(AFNAN),'ph_settings','main'),Object.assign({dailyCapacity:400,rev:1,updatedAt:NOW,updatedBy:'afnan'},over));
    for(const v of [[7],[-1],[1.5],['1'],[0,1,2,3,4,5,6],[0,0,0,0,0,0,0],[0,6,9],[1,2,3,4,5,'x'],'sun'])await assertFails(put({offWeekdays:v}));
    await assertSucceeds(put({offWeekdays:[0,6]}));
    await assertSucceeds(updateDoc(doc(as(AFNAN),'ph_settings','main'),{offWeekdays:[0,1,2,3,4,5],rev:2,updatedAt:NOW+1,updatedBy:'afnan'}));
    await assertSucceeds(updateDoc(doc(as(AFNAN),'ph_settings','main'),{offWeekdays:[],rev:3,updatedAt:NOW+2,updatedBy:'afnan'}));});
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
    if(r.ok||r.failed.length!==6)throw new Error('expected 6 failures, got '+JSON.stringify(r.failed.map(f=>f.name)));
    const g=await app2.run('phGet("drafts")');if(g.ok||g.rows!==null)throw new Error('a refused read looked like an empty list');
    if(!r.failed.every(f=>/republish firestore\.rules/.test(f.text)&&f.text.indexOf(f.name)===0))throw new Error('failures not named: '+r.failed.map(f=>f.text).join(' | '));});

  /* ═══ 14 Oct 2026 open items: the new writes against the UNCHANGED rules ═══ */
  console.log('open items: code lists, history data, clearing a setting, a master\'s kind');
  await t('rollsChecklist with missingCodes / extraCodes (200 codes of 40 characters) is accepted by the rules, by the app\'s own writer (uzaib)',async()=>{await reset();await seedPo();
    await seed('po_cut_jobs/'+PO,jobDoc(AFNAN,{rev:1}));
    const codes=Array.from({length:200},(_,i)=>('R-'+i+'x'.repeat(40)).slice(0,40));
    const r=await call(UZAIB,'phSaveCutJob("'+PO+'",{rollsChecklist:{total:206,verified:6,short:0,missing:200,extra:1,missingCodes:'+JSON.stringify(codes)+',extraCodes:["STRAY-1"]}},{now:'+nx()+'})');
    if(!r.ok)throw new Error('writer/rules: '+JSON.stringify(r));
    const j=await read('po_cut_jobs/'+PO);if(!j||j.rollsChecklist.missingCodes.length!==200||j.rollsChecklist.extraCodes[0]!=='STRAY-1')throw new Error('not stored');});
  await t('a history row whose data map has 40 keys (39 + jobRev) is accepted; the app\'s writer refuses 41 before the rules; a raw 41-key row is refused by the rules',async()=>{await reset();await seedPo();
    await seed('po_cut_jobs/'+PO,jobDoc(AFNAN,{rev:1}));
    const k39={};for(let i=0;i<39;i++)k39['k'+i]=i;
    const r=await call(MUSTAFA,'phSaveCutJob("'+PO+'",{note:"x"},{now:'+nx()+',data:'+JSON.stringify(k39)+'})');
    if(!r.ok)throw new Error('39 keys: '+JSON.stringify(r));
    const h=await read('pos/'+PO+'/history/'+r.historyId);if(Object.keys(h.data).length!==40)throw new Error('data not stored');
    const k40={};for(let i=0;i<40;i++)k40['k'+i]=i;
    const bad=await call(MUSTAFA,'phSaveCutJob("'+PO+'",{note:"y"},{now:'+nx()+',data:'+JSON.stringify(k40)+'})');
    if(bad.ok||bad.code!=='invalid')throw new Error('writer let 41 keys through: '+JSON.stringify(bad));
    const k41={};for(let i=0;i<41;i++)k41['k'+i]=i;
    await assertFails(setDoc(doc(as(MUSTAFA),'pos',PO,'history',String(NOW+777)+'-ab12'),{at:NOW+777,by:'mustafa',byName:'Mustafa',type:'cut_job_updated',from:'',to:'',reason:'',data:k41}));});
  await t('structured plan data: the Calendar-style move (phCutJobChangeData as history data) lands with the rules for a manager',async()=>{await reset();await seedPo();
    await seed('po_cut_jobs/'+PO,jobDoc(AFNAN,{rev:1}));
    const r=await call(MUSTAFA,'phSaveCutJob("'+PO+'",{plannedCutDate:"2026-10-22"},{now:'+nx()+',data:phCutJobChangeData({plannedCutDate:"2026-10-20"},{plannedCutDate:"2026-10-22"})})');
    if(!r.ok)throw new Error(JSON.stringify(r));
    const h=await read('pos/'+PO+'/history/'+r.historyId);if(h.data.field!=='plannedCutDate'||h.data.from!=='2026-10-20'||h.data.to!=='2026-10-22'||h.data.jobRev!==2)throw new Error('data wrong: '+JSON.stringify(h.data));});
  await t('clearing a saved setting (the key left out of the whole-document write) is accepted for a manager, with rev + 1',async()=>{await reset();
    await seed('ph_settings/main',{dailyCapacity:450,grossOverTolPct:4.5,delayTargetDays:5,stuckDays:20,cutGate:[75,125],rev:3,updatedAt:NOW,updatedBy:'afnan'});
    await call(MUSTAFA,'phLoadAll({force:true})');
    const r=await call(MUSTAFA,'phSettingsSave({dailyCapacity:null,delayTargetDays:null,stuckDays:null},{now:'+nx()+',expectedRev:3})');
    if(!r.ok)throw new Error(JSON.stringify(r));
    const d=await read('ph_settings/main');if('dailyCapacity' in d||'stuckDays' in d||'delayTargetDays' in d||d.grossOverTolPct!==4.5||d.rev!==4)throw new Error('doc wrong: '+JSON.stringify(d));});
  await t('clearing pcOnlyHard: a manager is refused by the writer AND by the rules (raw omit); an owner clears it with the writer',async()=>{await reset();
    await seed('ph_settings/main',{dailyCapacity:450,pcOnlyHard:true,rev:1,updatedAt:NOW,updatedBy:'afnan'});
    await call(MUSTAFA,'phLoadAll({force:true})');
    const w=await call(MUSTAFA,'phSettingsSave({pcOnlyHard:null},{now:'+nx()+'})');if(w.ok||w.code!=='forbidden')throw new Error('writer let a manager: '+JSON.stringify(w));
    await assertFails(setDoc(doc(as(MUSTAFA),'ph_settings','main'),{dailyCapacity:450,rev:2,updatedAt:NOW+1,updatedBy:'mustafa'}));
    await call(AFNAN,'phLoadAll({force:true})');
    const o=await call(AFNAN,'phSettingsSave({pcOnlyHard:null},{now:'+nx()+'})');if(!o.ok)throw new Error('owner: '+JSON.stringify(o));
    const d=await read('ph_settings/main');if('pcOnlyHard' in d||d.dailyCapacity!==450)throw new Error('doc wrong: '+JSON.stringify(d));});
  await t('a master\'s kind: a manager changes it with phMasterSetKind (only kind, updatedAt, updatedBy move); uzaib is refused by the writer and by the rules; a retired master\'s kind can be set',async()=>{await reset();
    await seed('cutting_masters/CM-001',{id:'CM-001',name:'Master One',nameKey:'master one',kind:'unset',active:true,aliases:[],notes:'',createdAt:NOW,createdBy:'afnan',createdByName:'Afnan',updatedAt:NOW,updatedBy:'afnan',retiredAt:null,retiredBy:null,retiredReason:''});
    const r=await call(MUSTAFA,'phMasterSetKind("CM-001","outsource",{now:'+nx()+'})');if(!r.ok)throw new Error(JSON.stringify(r));
    const m=await read('cutting_masters/CM-001');if(m.kind!=='outsource'||m.name!=='Master One'||m.updatedBy!=='mustafa')throw new Error('doc wrong: '+JSON.stringify(m));
    const u=await call(UZAIB,'phMasterSetKind("CM-001","inhouse",{now:'+nx()+'})');if(u.ok||u.code!=='forbidden')throw new Error('writer let uzaib: '+JSON.stringify(u));
    await assertFails(updateDoc(doc(as(UZAIB),'cutting_masters','CM-001'),{kind:'inhouse',updatedAt:NOW+5,updatedBy:'uzaib'}));
    await assertFails(updateDoc(doc(as(MUSTAFA),'cutting_masters','CM-001'),{kind:'freelance',updatedAt:NOW+5,updatedBy:'mustafa'}));
    await seed('cutting_masters/CM-002',{id:'CM-002',name:'Old',nameKey:'old',kind:'inhouse',active:false,aliases:[],notes:'',createdAt:NOW,createdBy:'afnan',createdByName:'Afnan',updatedAt:NOW,updatedBy:'afnan',retiredAt:NOW,retiredBy:'afnan',retiredReason:'left'});
    const rr=await call(AFNAN,'phMasterSetKind("CM-002","outsource",{now:'+nx()+'})');if(!rr.ok)throw new Error('retired: '+JSON.stringify(rr));});
  /* ═══ ISSUE AS PO (14 Oct 2026): ready -> issued, the pos document created in the SAME commit ═══ */
  console.log('issue as PO (po_drafts ready -> issued + a NEW pos document + counters/main + history, one transaction)');
  // A second app: the issue writer needs the real js/shared.js (mintNextIdInTx) and js/pos.js (_poFloorNow, _poIdFor, PO_STATUS, STAGE_KEYS).
  const appI=harness.loadApp({files:['js/shared.js','js/pos.js','js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-issue.js'],globals:{
    doc,collection,query,orderBy,limit,where,getDoc,getDocs,deleteDoc,writeBatch,
    setDoc:(r,d,o)=>o===undefined?setDoc(r,clone(d)):setDoc(r,clone(d),o),
    updateDoc:(r,d)=>updateDoc(r,clone(d)),
    runTransaction:(db,fn)=>runTransaction(db,tx=>fn(wrapTx(tx))),
    _poEmbellishment:null
  }});
  appI.run('globalThis.__acts=[];logActivity=async function(x,d){__acts.push(x);};loadData=async function(){};showToast=function(){};allPOs=[];');
  const callI=async(w,expr)=>{appI.ctx.db=as(w);appI.run('session='+JSON.stringify({uid:w.uid,u:w.u,name:w.name,email:w.email,role:'owner'})+';');return await appI.run('(async()=>{return await '+expr+';})()');};
  const IPO='PO-007';
  const ISS_PO=Object.assign({},GOOD_PO,{pattern:'P-12',ratio:'1:1',fabricCode:'JER180',store:'Main store',totalRoll:'6',cutMaster:'Hassan',embellishment:{required:false},jobCopies:{embroidery:true,printing:false,washing:false},notes:'Handle with care'});
  const readyDraft=(over)=>draftDoc(UZAIB,Object.assign({status:'ready',rev:2,readyAt:NOW,readyBy:'uzaib',po:ISS_PO},over||{}));
  const issueSeed=async(over)=>{await reset();
    await seed('counters/main',{pos:6,gatepasses:2,bundles:9});await seed('pos/PO-006',{id:'PO-006',name:'PO 6',qty:100,poStatus:'reserved'});
    await seed('cutting_masters/CM-001',{id:'CM-001',name:'Hassan',nameKey:'hassan',active:true,kind:'inhouse'});
    await seed('po_drafts/'+DID,readyDraft(over));
    appI.run('allPOs=[];');await callI(MUSTAFA,'phResetData()');await callI(MUSTAFA,'phLoadStage("masters",{force:true})');};
  const posDoc=(over)=>{const d=Object.assign({ts:NOW,name:'Effortless Tee',code:'GST073',qty:100,sizes:{XS:0,S:50,M:50,L:0,XL:0,'2XL':0},poStatus:'reserved',currentStage:null,id:IPO,season:'winter',fromDraftId:DID,enteredBy:'uzaib',issuedBy:'mustafa',createdBy:'Mustafa'},over||{});Object.keys(d).forEach(k=>{if(d[k]===null)delete d[k];});return d;};
  const issuedPatch=(w,over)=>Object.assign({status:'issued',rev:3,poId:IPO,issuedAt:NOW,issuedBy:w.u,updatedAt:NOW,updatedBy:w.u},over||{});
  // a raw transaction that does exactly what the writer does (counter + pos + draft), with a hook to damage one part
  const rawIssue=(w,o)=>{o=o||{};
    const fdb=as(w);
    return runTransaction(fdb,async tx=>{
      const dref=doc(fdb,'po_drafts',DID),cref=doc(fdb,'counters','main'),pref=doc(fdb,'pos',o.posId||IPO);
      await tx.get(dref);await tx.get(cref);await tx.get(pref);
      if(!o.noCounter)tx.update(cref,{pos:7});
      if(!o.noPos)tx.set(pref,posDoc(Object.assign({issuedBy:w.u},o.pos||{})));
      tx.update(dref,issuedPatch(w,o.patch));
    });};

  for(const w of [MUSTAFA,AFNAN,AMMAR])
    await t(w.u+' issues a ready draft with the app\'s own writer: PO-007, the counter, the draft and the history row land together',async()=>{await issueSeed();
      const r=await callI(w,'phIssueDraft("'+DID+'",{expectedRev:2,now:'+nx()+',followUps:false})');if(!r.ok)throw new Error('writer: '+JSON.stringify(r));
      if(r.poId!==IPO)throw new Error('expected PO-007, got '+r.poId);
      const p=await read('pos/'+IPO),d=await read('po_drafts/'+DID),c=await read('counters/main');
      if(!p||p.fromDraftId!==DID||p.issuedBy!==w.u||p.enteredBy!=='uzaib'||p.poStatus!=='reserved'||p.currentStage!==null)throw new Error('pos document wrong: '+JSON.stringify(p));
      if(!d||d.status!=='issued'||d.poId!==IPO||d.issuedBy!==w.u||d.rev!==3)throw new Error('draft wrong: '+JSON.stringify(d));
      if(c.pos!==7||c.gatepasses!==2||c.bundles!==9)throw new Error('counter wrong: '+JSON.stringify(c));
      let hs=[];await env.withSecurityRulesDisabled(async cx=>{const sn=await getDocs(collection(cx.firestore(),'pos',IPO,'history'));hs=sn.docs.map(x=>x.data());});
      if(hs.length!==1||hs[0].type!=='issued'||hs[0].by!==w.u)throw new Error('history wrong: '+JSON.stringify(hs));});
  await t('Mustafa\'s issue leaves PO-006 and every other existing document byte-identical',async()=>{await issueSeed();
    const before=JSON.stringify(await read('pos/PO-006'));
    const r=await callI(MUSTAFA,'phIssueDraft("'+DID+'",{expectedRev:2,now:'+nx()+',followUps:false})');if(!r.ok)throw new Error(JSON.stringify(r));
    if(JSON.stringify(await read('pos/PO-006'))!==before)throw new Error('PO-006 changed');
    const m=await read('cutting_masters/CM-001');if(!m||m.name!=='Hassan')throw new Error('master changed');});
  await t('Uzaib: the writer refuses (forbidden) and writes nothing',async()=>{await issueSeed();
    const r=await callI(UZAIB,'phIssueDraft("'+DID+'",{expectedRev:2,now:'+nx()+',followUps:false})');if(r.ok||r.code!=='forbidden')throw new Error(JSON.stringify(r));
    const d=await read('po_drafts/'+DID),c=await read('counters/main');if(d.status!=='ready'||c.pos!==6||(await read('pos/'+IPO)))throw new Error('something was written');});
  await t('Uzaib, raw: the same transaction (counter + new pos + draft -> issued) is refused as a whole; nothing is written',async()=>{await issueSeed();
    await assertFails(rawIssue(UZAIB));
    const d=await read('po_drafts/'+DID),c=await read('counters/main');if(d.status!=='ready'||c.pos!==6||(await read('pos/'+IPO)))throw new Error('a part of it landed');});
  await t('Uzaib, raw: setting only the draft to issued (no pos) is refused too; Raees, Umair, QA and signed-out likewise',async()=>{await issueSeed();
    for(const w of [UZAIB,RAEES,UMAIR,QA,'anon'])await assertFails(updateDoc(doc(as(w),'po_drafts',DID),issuedPatch(w.u?w:AFNAN,{issuedBy:(w.u||'afnan')})));});
  await t('Mustafa, raw: the full transaction is allowed (this is the exact write set the writer sends)',async()=>{await issueSeed();await assertSucceeds(rawIssue(MUSTAFA));});
  await t('refused: draft -> issued without the pos document in the commit',async()=>{await issueSeed();await assertFails(rawIssue(MUSTAFA,{noPos:true}));});
  await t('refused: the pos document names ANOTHER draft / has another issuer',async()=>{await issueSeed();
    await assertFails(rawIssue(MUSTAFA,{pos:{fromDraftId:'DRAFT-LZ4K9F2A-ZZ99'}}));
    await assertFails(rawIssue(MUSTAFA,{pos:{issuedBy:'ammar'}}));
    await assertFails(rawIssue(MUSTAFA,{pos:{fromDraftId:null}}));});
  await t('refused: the pos id already exists (an issue can never point at an existing PO)',async()=>{await issueSeed();await seed('pos/'+IPO,{id:IPO,name:'ALREADY HERE',qty:5});
    await assertFails(rawIssue(MUSTAFA));
    const p=await read('pos/'+IPO);if(p.name!=='ALREADY HERE')throw new Error('existing PO overwritten');});
  await t('refused: a poId that is not a PO number, or a draft pointing at a different PO than the one created',async()=>{await issueSeed();
    await assertFails(rawIssue(MUSTAFA,{patch:{poId:'PO-7'}}));
    await assertFails(rawIssue(MUSTAFA,{patch:{poId:'PO-008'}}));
    await assertFails(rawIssue(MUSTAFA,{patch:{poId:'x'}}));
    await assertFails(rawIssue(MUSTAFA,{patch:{poId:7}}));});
  await t('refused: wrong key list (an extra key, a missing key), issuedBy of someone else, issuedAt not a number, rev not +1, updatedBy of someone else',async()=>{await issueSeed();
    await assertFails(rawIssue(MUSTAFA,{patch:{extra:1}}));
    await assertFails(rawIssue(MUSTAFA,{patch:{po:{code:'X'}}}));
    await assertFails(rawIssue(MUSTAFA,{patch:{issuedBy:'afnan'}}));
    await assertFails(rawIssue(MUSTAFA,{patch:{issuedBy:'afnan'},pos:{issuedBy:'afnan'}}));    // spoofing the issuer on BOTH documents: only the caller binding refuses it
    await assertFails(rawIssue(MUSTAFA,{patch:{issuedAt:'now'}}));
    await assertFails(rawIssue(MUSTAFA,{patch:{rev:4}}));
    await assertFails(rawIssue(MUSTAFA,{patch:{rev:2}}));
    await assertFails(rawIssue(MUSTAFA,{patch:{updatedBy:'afnan'}}));
    await assertFails(rawIssue(MUSTAFA,{patch:{sentBackReason:'x'}}));
    {const fdb=as(MUSTAFA);
    await assertFails(runTransaction(fdb,async tx=>{const dref=doc(fdb,'po_drafts',DID);await tx.get(dref);await tx.get(doc(fdb,'counters','main'));await tx.get(doc(fdb,'pos',IPO));
      tx.update(doc(fdb,'counters','main'),{pos:7});tx.set(doc(fdb,'pos',IPO),posDoc());
      const p=issuedPatch(MUSTAFA);delete p.poId;tx.update(dref,p);}));}});
  for(const st of ['draft','abandoned']){
    await t('refused: a '+st+' draft cannot become issued (only ready can), even by an owner with a pos document',async()=>{await issueSeed({status:st,rev:2});
      await assertFails(rawIssue(AFNAN));
      const d=await read('po_drafts/'+DID);if(d.status!==st)throw new Error('changed');});}
  await t('issued is TERMINAL: nobody - an owner included - can edit, abandon, send back, re-ready, re-issue or delete it',async()=>{await issueSeed();
    const r=await callI(AFNAN,'phIssueDraft("'+DID+'",{expectedRev:2,now:'+nx()+',followUps:false})');if(!r.ok)throw new Error(JSON.stringify(r));
    for(const w of [AFNAN,AMMAR,MUSTAFA,UZAIB]){
      const u=w.u,base={rev:4,updatedAt:NOW+9,updatedBy:u};
      for(const patch of [{po:{a:1}},{status:'abandoned',abandonedAt:NOW,abandonedBy:u,abandonedReason:'x'},{status:'draft',sentBackAt:NOW,sentBackBy:u,sentBackReason:'x'},{status:'ready',readyAt:NOW,readyBy:u},
          {status:'issued',poId:'PO-008',issuedAt:NOW+9,issuedBy:u},{poId:'PO-099'},{status:'issued'}])
        await assertFails(updateDoc(doc(as(w),'po_drafts',DID),Object.assign({},base,patch)));
      await assertFails(deleteDoc(doc(as(w),'po_drafts',DID)));}
    const d=await read('po_drafts/'+DID);if(d.status!=='issued'||d.poId!==IPO)throw new Error('issued draft changed');});
  await t('the writer refuses a second issue of an issued draft ("already issued as PO-007") and spends no number',async()=>{await issueSeed();
    await callI(MUSTAFA,'phIssueDraft("'+DID+'",{expectedRev:2,now:'+nx()+',followUps:false})');
    const r=await callI(MUSTAFA,'phIssueDraft("'+DID+'",{expectedRev:3,now:'+nx()+',followUps:false})');
    if(r.ok||!/already issued as PO-007/.test(r.error))throw new Error(JSON.stringify(r));
    if((await read('counters/main')).pos!==7)throw new Error('a number was spent');});
  await t('two concurrent issues of one draft through the real SDK: one wins, the other is refused, one number is spent',async()=>{await issueSeed();
    const [x,y]=await Promise.all([callI(MUSTAFA,'phIssueDraft("'+DID+'",{expectedRev:2,now:'+nx()+',followUps:false,rand:"aaaa"})'),callI(MUSTAFA,'phIssueDraft("'+DID+'",{expectedRev:2,now:'+nx()+',followUps:false,rand:"bbbb"})')]);
    const oks=[x,y].filter(r=>r.ok);if(oks.length!==1)throw new Error('expected exactly one winner: '+JSON.stringify([x,y]));
    const c=await read('counters/main');if(c.pos!==7||(await read('pos/PO-008')))throw new Error('a number was burned or a second PO exists: '+JSON.stringify(c));});
  await t('a failed issue (incomplete stored po) writes nothing: no PO, the counter and the draft untouched',async()=>{await issueSeed({po:Object.assign({},ISS_PO,{fabric:''})});
    const r=await callI(MUSTAFA,'phIssueDraft("'+DID+'",{expectedRev:2,now:'+nx()+',followUps:false})');if(r.ok||r.code!=='refused'||!/not complete/.test(r.error))throw new Error(JSON.stringify(r));
    if((await read('counters/main')).pos!==6||(await read('pos/'+IPO))||(await read('po_drafts/'+DID)).status!=='ready')throw new Error('something changed');});
  await t('the pos rule is unchanged: a signed-in user can still create a pos document directly (only the draft transition is gated); the history row of the issue needs the audience',async()=>{await issueSeed();
    await assertSucceeds(setDoc(doc(as(RAEES),'pos','PO-050'),{id:'PO-050',name:'classic'}));
    await assertFails(setDoc(doc(as(RAEES),'pos','PO-050','history','1790000000000-abcd'),{at:NOW,by:'raees',byName:'Raees',type:'issued',from:'',to:'',reason:'',data:{}}));});

  /* ═══ ph_article_instructions (WP3a) ═══ */
  console.log('ph_article_instructions');
  const IGOOD={placements:[{en:'Front centre',ur:'',side:'front'}],pantones:[{system:'C',code:'485',name:'Red',hex:'#DA291C'}],embroidery:[],notes:{en:'n',ur:''},reason:'first'};
  const iDoc=(w,over)=>Object.assign({code:'GP042',rev:1,placements:[],pantones:[],embroidery:[],notes:{en:'',ur:''},reason:'',createdAt:NOW,createdBy:w.u,createdByName:w.name,updatedAt:NOW,updatedBy:w.u},over||{});
  const iRev=(w,over)=>Object.assign({code:'GP042',rev:1,placements:[],pantones:[],embroidery:[],notes:{en:'',ur:''},reason:'',at:NOW,by:w.u,byName:w.name},over||{});
  const iBatch=async(w,docData,revData,revId)=>{const db=as(w);const b=writeBatch(db);b.set(doc(db,'ph_article_instructions','GP042'),docData);b.set(doc(db,'ph_article_instructions','GP042','revisions',revId||String(revData.rev)),revData);await b.commit();};
  for(const w of [AFNAN,AMMAR,MUSTAFA])
    await t(w.u+' saves instructions with the app\'s own writer: revision 1, then 2, each with its revisions row',async()=>{await reset();
      const r=await call(w,'phInstructionsSave("gp042",'+JSON.stringify(IGOOD)+',{now:'+nx()+'})');if(!r.ok||r.rev!==1)throw new Error(JSON.stringify(r));
      const r2=await call(w,'phInstructionsSave("GP042",'+JSON.stringify(Object.assign({},IGOOD,{notes:{en:'changed',ur:''},reason:'why'}))+',{now:'+nx()+',expectedRev:1})');if(!r2.ok||r2.rev!==2)throw new Error(JSON.stringify(r2));
      const a=await read('ph_article_instructions/GP042/revisions/1'),b=await read('ph_article_instructions/GP042/revisions/2');
      if(!a||!b||a.notes.en!=='n'||b.notes.en!=='changed'||b.reason!=='why')throw new Error('revision snapshots wrong');});
  await t('Kashif (uzaib), Raees, Umair, Arfat, QA and signed-out cannot create instructions',async()=>{await reset();
    for(const w of [UZAIB,RAEES,UMAIR,ARFAT,QA])await assertFails(setDoc(doc(as(w),'ph_article_instructions','GP042'),iDoc(w)));
    await assertFails(setDoc(doc(as('anon'),'ph_article_instructions','GP042'),iDoc(AFNAN)));});
  await t('a manager create is bound to the code, rev 1, the caller and the key list',async()=>{await reset();
    for(const over of [{rev:2},{code:'GP099'},{createdBy:'ammar'},{updatedBy:'ammar'},{extra:1},{notes:'text'},{notes:{en:'x',ur:'',zz:'1'}},{createdAt:'now'},{reason:'x'.repeat(301)},
        {placements:Array.from({length:13},()=>({en:'p'}))},{pantones:Array.from({length:17},()=>({code:'1'}))},{embroidery:Array.from({length:17},()=>({code:'1'}))},{notes:{en:'y'.repeat(1001),ur:''}}])
      await assertFails(setDoc(doc(as(AFNAN),'ph_article_instructions','GP042'),iDoc(AFNAN,over)));
    await assertFails(setDoc(doc(as(AFNAN),'ph_article_instructions','gp 042'),iDoc(AFNAN,{code:'gp 042'})));
    await assertSucceeds(setDoc(doc(as(AFNAN),'ph_article_instructions','GP042'),iDoc(AFNAN)));});
  await t('update: rev must be +1, only the mutable keys, and a reason is required (stale or skipped revisions refused)',async()=>{await reset();
    await seed('ph_article_instructions/GP042',iDoc(AFNAN));
    const p={placements:[],pantones:[],embroidery:[],notes:{en:'z',ur:''},reason:'why',updatedAt:NOW+1,updatedBy:'afnan'};
    await assertFails(updateDoc(doc(as(AFNAN),'ph_article_instructions','GP042'),Object.assign({rev:3},p)));
    await assertFails(updateDoc(doc(as(AFNAN),'ph_article_instructions','GP042'),Object.assign({rev:1},p)));
    await assertFails(updateDoc(doc(as(AFNAN),'ph_article_instructions','GP042'),Object.assign({rev:2},p,{reason:''})));
    for(const patch of [{code:'GP099'},{createdAt:1},{createdBy:'ammar'}])await assertFails(updateDoc(doc(as(AFNAN),'ph_article_instructions','GP042'),Object.assign({rev:2},p,patch)));
    await assertFails(updateDoc(doc(as(UZAIB),'ph_article_instructions','GP042'),Object.assign({rev:2},p,{updatedBy:'uzaib'})));
    await assertSucceeds(updateDoc(doc(as(MUSTAFA),'ph_article_instructions','GP042'),Object.assign({rev:2},p,{updatedBy:'mustafa'})));});
  await t('nothing in the collection or its revisions can be deleted',async()=>{await reset();await seed('ph_article_instructions/GP042',iDoc(AFNAN));await seed('ph_article_instructions/GP042/revisions/1',iRev(AFNAN));
    for(const w of [AFNAN,AMMAR,MUSTAFA]){await assertFails(deleteDoc(doc(as(w),'ph_article_instructions','GP042')));await assertFails(deleteDoc(doc(as(w),'ph_article_instructions','GP042','revisions','1')));}});
  await t('a revision row: its id must equal its rev, the parent must be at that rev in the same commit, and it can never be changed',async()=>{await reset();
    await assertSucceeds(iBatch(AFNAN,iDoc(AFNAN),iRev(AFNAN)));
    await reset();await assertFails(iBatch(AFNAN,iDoc(AFNAN),iRev(AFNAN),'7'));                       // id != rev
    await reset();await assertFails(setDoc(doc(as(AFNAN),'ph_article_instructions','GP042','revisions','1'),iRev(AFNAN)));   // no parent in the commit
    await reset();await assertFails(iBatch(AFNAN,iDoc(AFNAN),iRev(AFNAN,{rev:2}),'2'));                // parent is rev 1
    await reset();await assertFails(iBatch(AFNAN,iDoc(AFNAN),iRev(AFNAN,{extra:1})));
    await reset();await assertFails(iBatch(AFNAN,iDoc(AFNAN),iRev(AFNAN,{by:'ammar'})));
    await reset();await assertFails(iBatch(AFNAN,iDoc(AFNAN),iRev(AFNAN,{code:'GP099'})));
    await reset();await seed('ph_article_instructions/GP042',iDoc(AFNAN));await seed('ph_article_instructions/GP042/revisions/1',iRev(AFNAN));
    await assertFails(updateDoc(doc(as(AFNAN),'ph_article_instructions','GP042','revisions','1'),{reason:'rewritten'}));
    await assertFails(setDoc(doc(as(AFNAN),'ph_article_instructions','GP042','revisions','1'),iRev(AFNAN,{reason:'overwritten'})));
    await assertFails(setDoc(doc(as(UZAIB),'ph_article_instructions','GP042','revisions','2'),iRev(UZAIB,{rev:2})));});
  await t('everyone signed in reads instructions and their revisions (Kashif, Raees, Umair); QA reads, QA cannot write; signed-out reads nothing',async()=>{await reset();
    await seed('ph_article_instructions/GP042',iDoc(AFNAN));await seed('ph_article_instructions/GP042/revisions/1',iRev(AFNAN));
    for(const w of [UZAIB,RAEES,UMAIR,QA]){await assertSucceeds(getDoc(doc(as(w),'ph_article_instructions','GP042')));await assertSucceeds(getDocs(collection(as(w),'ph_article_instructions')));await assertSucceeds(getDoc(doc(as(w),'ph_article_instructions','GP042','revisions','1')));}
    await assertFails(getDoc(doc(as('anon'),'ph_article_instructions','GP042')));await assertFails(getDoc(doc(as('anon'),'ph_article_instructions','GP042','revisions','1')));
    await assertFails(setDoc(doc(as(QA),'ph_article_instructions','GP043'),iDoc(QA,{code:'GP043'})));});

  await env.cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});

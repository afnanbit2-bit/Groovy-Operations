/* ─────────────────────────────────────────────────────────────────────────
   tests/rules-emulator.js — firestore.rules for wh_sales, run in the REAL
   Firestore emulator (Sept 2026).

   Not a *.test.js on purpose: it needs firebase-tools, the emulator and Java,
   and CI installs nothing (the zero-new-deps line), so tests/run.js must not
   pick it up. Run it by hand whenever the wh_sales rules change:

     mkdir -p /tmp/emu && cd /tmp/emu && npm init -y >/dev/null
     npm install firebase-tools@13 @firebase/rules-unit-testing firebase
     cd <repo> && EMU_DEPS=/tmp/emu/node_modules \
       /tmp/emu/node_modules/.bin/firebase emulators:exec --only firestore \
       --project demo-whs "node tests/rules-emulator.js"

   The demo- project id keeps the emulator offline: nothing here can reach
   groovy-gatepass. Every document is BUILT BY THE APP (whsBuildSale and
   _whsPriorVoids from js/warehouse-sales.js, through tests/harness.js), so a
   rule and the client that has to satisfy it are tested together — a rule
   that only a hand-written fixture passes proves nothing about the app.

   This checks the rules FILE. What the Firebase Console has published is a
   separate question only the human can answer.
   ───────────────────────────────────────────────────────────────────────── */
const fs=require('fs');
const path=require('path');
const REPO=path.join(__dirname,'..');
// The emulator packages live outside the repo (see above); resolve them from
// EMU_DEPS, else from wherever the command is run.
const dep=p=>require(require.resolve(p,{paths:[process.env.EMU_DEPS,process.cwd()].filter(Boolean)}));
const {initializeTestEnvironment,assertSucceeds,assertFails}=dep('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,deleteDoc,getDocs,collection}=dep('firebase/firestore');
const harness=require('./harness.js');

const LS={getItem:()=>null,setItem(){},removeItem(){}};
const app=harness.loadApp({files:['js/shared.js','js/auth.js','js/store.js','js/store-accounts.js','js/fulfillment.js','js/warehouse-sales.js'],globals:{localStorage:LS}});
const BILL={url:'https://res.cloudinary.com/deww4lpym/image/upload/v1/bill.jpg',kind:'image',name:'bill.jpg'};
function build(over,who){
  const f=Object.assign({
    bill:BILL,orderNo:'SO0334',date:'2026-09-20',customerName:'Sheikh Bilal',customerPhone:'0300-9225227',
    lines:[{variantId:'v1',sku:'GP092-M',code:'GP092',title:'EFFORTLESS TEE',variant:'M',price:'3490',catalogPrice:3490,qty:3}],
    discMode:'none',discVal:'',terms:'paid',paidVia:'cash',dueDate:'',note:''
  },over||{});
  const r=JSON.parse(app.run('JSON.stringify(whsBuildSale('+JSON.stringify(f)+','+JSON.stringify({today:'2026-09-25',uid:who.uid,name:who.name,u:who.u,now:1790000000000})+'))'));
  if(r.error)throw new Error('build refused: '+r.error);
  return r;
}
function priorVoids(old){return JSON.parse(app.run('JSON.stringify(_whsPriorVoids('+JSON.stringify(old)+'))'));}

const UMAIR={uid:'u-umair',email:'umair@groovy.op',u:'umair',name:'Umair'};
const AFNAN={uid:'u-afnan',email:'afnan@groovy.op',u:'afnan',name:'Afnan'};
const AMMAR={uid:'u-ammar',email:'ammar@groovy.op',u:'ammar',name:'Ammar'};
const MUSTAFA={uid:'u-mustafa',email:'mustafa@groovy.op',u:'mustafa',name:'Mustafa'};

let pass=0,fail=0;
async function t(name,fn){
  try{await fn();pass++;console.log('  ok   '+name);}
  catch(e){fail++;console.log('  FAIL '+name+'\n       '+String(e&&e.message||e).split('\n')[0]);}
}

(async()=>{
  const env=await initializeTestEnvironment({projectId:'demo-whs',firestore:{rules:fs.readFileSync(path.join(REPO,'firestore.rules'),'utf8'),host:process.env.FIRESTORE_EMULATOR_HOST?process.env.FIRESTORE_EMULATOR_HOST.split(':')[0]:'127.0.0.1',port:process.env.FIRESTORE_EMULATOR_HOST?Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]):8080}});
  const as=w=>env.authenticatedContext(w.uid,{email:w.email}).firestore();
  const seed=async(id,data)=>env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'wh_sales',id),data);});
  const reset=()=>env.clearFirestore();

  console.log('create');
  await t('Umair records a valid sale',async()=>{await reset();const r=build({},UMAIR);await assertSucceeds(setDoc(doc(as(UMAIR),'wh_sales',r.id),r.data));});
  await t('an owner records a valid sale',async()=>{await reset();const r=build({},AFNAN);await assertSucceeds(setDoc(doc(as(AFNAN),'wh_sales',r.id),r.data));});
  await t('a manager cannot record',async()=>{await reset();const r=build({},MUSTAFA);await assertFails(setDoc(doc(as(MUSTAFA),'wh_sales',r.id),r.data));});
  await t('a 20% discount is allowed',async()=>{await reset();const r=build({discMode:'pct',discVal:'20'},UMAIR);await assertSucceeds(setDoc(doc(as(UMAIR),'wh_sales',r.id),r.data));});
  await t('21% is refused by the rules even when the client is bypassed',async()=>{await reset();const r=build({},UMAIR);const d=Object.assign({},r.data,{discount:2199,total:r.data.subtotal-2199});await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),d));});
  await t('a total that is not subtotal less discount is refused',async()=>{await reset();const r=build({},UMAIR);await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign({},r.data,{total:1})));});
  await t('pay later with no due date is refused',async()=>{await reset();const r=build({terms:'later',dueDate:'2026-10-01'},UMAIR);const d=Object.assign({},r.data);delete d.dueDate;await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),d));});
  await t('pay later with a due date is allowed',async()=>{await reset();const r=build({terms:'later',dueDate:'2026-10-01'},UMAIR);await assertSucceeds(setDoc(doc(as(UMAIR),'wh_sales',r.id),r.data));});
  await t('a lookalike bill host is refused',async()=>{await reset();const r=build({},UMAIR);await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign({},r.data,{billUrl:'https://res.cloudinary.com.evil.test/x.jpg'})));});
  await t('the path must be the order number',async()=>{await reset();const r=build({},UMAIR);await assertFails(setDoc(doc(as(UMAIR),'wh_sales','SO9999'),r.data));});
  await t('Umair cannot record a sale as Afnan (createdByU)',async()=>{await reset();const r=build({},UMAIR);await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign({},r.data,{createdByU:'afnan'})));});
  await t('createdBy must be the caller uid',async()=>{await reset();const r=build({},UMAIR);await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign({},r.data,{createdBy:'u-afnan'})));});

  console.log('read');
  await t('Umair reads',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,r.data);await assertSucceeds(getDoc(doc(as(UMAIR),'wh_sales',r.id)));});
  await t('Ammar reads the list',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,r.data);await assertSucceeds(getDocs(collection(as(AMMAR),'wh_sales')));});
  await t('a manager cannot read',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,r.data);await assertFails(getDoc(doc(as(MUSTAFA),'wh_sales',r.id)));});

  console.log('a second entry of the same bill');
  await t('writing over an ACTIVE sale is refused',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,r.data);await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),r.data));});

  console.log('void');
  const voidPatch=w=>({status:'void',voidedAt:1790000100000,voidedBy:w.u,voidedByName:w.name,voidReason:'wrong qty'});
  await t('Umair voids with his own name',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,r.data);await assertSucceeds(updateDoc(doc(as(UMAIR),'wh_sales',r.id),voidPatch(UMAIR)));});
  await t('Umair cannot void in Afnan\'s name',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,r.data);await assertFails(updateDoc(doc(as(UMAIR),'wh_sales',r.id),voidPatch(AFNAN)));});
  await t('a void may not touch the money',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,r.data);await assertFails(updateDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign(voidPatch(UMAIR),{total:1})));});

  console.log('record again over a void');
  const voided=d=>Object.assign({},d,voidPatch(UMAIR));
  await t('Umair records the bill again, carrying the void forward',async()=>{await reset();const r=build({},UMAIR);const old=voided(r.data);await seed(r.id,old);
    const r2=build({lines:[{variantId:'v1',sku:'GP092-M',code:'GP092',title:'EFFORTLESS TEE',variant:'M',price:'3490',catalogPrice:3490,qty:1}]},UMAIR);
    await assertSucceeds(setDoc(doc(as(UMAIR),'wh_sales',r2.id),Object.assign({},r2.data,{priorVoids:priorVoids(old)})));});
  await t('a second void and re-record grows the history to two',async()=>{await reset();const r=build({},UMAIR);const old=voided(Object.assign({},r.data,{priorVoids:priorVoids(voided(r.data))}));await seed(r.id,old);
    const pv=priorVoids(old);if(pv.length!==2)throw new Error('history length '+pv.length);
    const r2=build({},UMAIR);await assertSucceeds(setDoc(doc(as(UMAIR),'wh_sales',r2.id),Object.assign({},r2.data,{priorVoids:pv})));});
  await t('a re-record that drops the history is refused',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,voided(r.data));await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),r.data));});
  await t('a re-record with an EMPTY history is refused — it must grow by one',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,voided(r.data));await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign({},r.data,{priorVoids:[]})));});
  await t('a re-record that wipes an earlier history is refused',async()=>{await reset();const r=build({},UMAIR);const old=voided(Object.assign({},r.data,{priorVoids:priorVoids(voided(r.data))}));await seed(r.id,old);
    await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign({},r.data,{priorVoids:priorVoids(voided(r.data))})));});
  await t('a re-record is held to the create checks (21%)',async()=>{await reset();const r=build({},UMAIR);const old=voided(r.data);await seed(r.id,old);
    const d=Object.assign({},r.data,{discount:2199,total:r.data.subtotal-2199,priorVoids:priorVoids(old)});await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),d));});
  await t('a re-record may not come back as void',async()=>{await reset();const r=build({},UMAIR);const old=voided(r.data);await seed(r.id,old);
    await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign({},voided(r.data),{priorVoids:priorVoids(old)})));});
  await t('a manager cannot re-record',async()=>{await reset();const r=build({},MUSTAFA);const old=voided(build({},UMAIR).data);await seed(r.id,old);
    await assertFails(setDoc(doc(as(MUSTAFA),'wh_sales',r.id),Object.assign({},r.data,{priorVoids:priorVoids(old)})));});

  console.log('review');
  const rev=w=>({needsReview:false,reviewedAt:1790000200000,reviewedBy:w.u,reviewedByName:w.name});
  await t('an owner marks reviewed in their own name',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,Object.assign({},r.data,{needsReview:true}));await assertSucceeds(updateDoc(doc(as(AFNAN),'wh_sales',r.id),rev(AFNAN)));});
  await t('an owner cannot mark reviewed in the other owner\'s name',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,Object.assign({},r.data,{needsReview:true}));await assertFails(updateDoc(doc(as(AFNAN),'wh_sales',r.id),rev(AMMAR)));});
  await t('Umair cannot mark reviewed',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,Object.assign({},r.data,{needsReview:true}));await assertFails(updateDoc(doc(as(UMAIR),'wh_sales',r.id),rev(UMAIR)));});

  console.log('delete');
  await t('Umair cannot delete',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,r.data);await assertFails(deleteDoc(doc(as(UMAIR),'wh_sales',r.id)));});
  await t('Ammar can delete',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,r.data);await assertSucceeds(deleteDoc(doc(as(AMMAR),'wh_sales',r.id)));});

  await env.cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});

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
  const env=await initializeTestEnvironment({projectId:'demo-whs',firestore:{rules:fs.readFileSync(process.env.RULES_FILE||path.join(REPO,'firestore.rules'),'utf8'),host:process.env.FIRESTORE_EMULATOR_HOST?process.env.FIRESTORE_EMULATOR_HOST.split(':')[0]:'127.0.0.1',port:process.env.FIRESTORE_EMULATOR_HOST?Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]):8080}});
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

  const expect=(cond,msg)=>{if(!cond)throw new Error(msg);};
  console.log('handover (26 Sept 2026): Raees reads; Umair collects a pay-later bill');
  const RAE={uid:'u-raees',email:'raees@groovy.op',u:'raees',name:'Raees'};
  const later=()=>build({terms:'later',paidVia:'',dueDate:'2026-10-01',date:'2026-09-20'},UMAIR);
  const collect=(r,f,w)=>JSON.parse(app.run('JSON.stringify(whsCollectPatch('+JSON.stringify(Object.assign({_id:r.id},r.data))+','+JSON.stringify(f)+','+JSON.stringify({today:'2026-09-25',u:(w||UMAIR).u,name:(w||UMAIR).name,now:1790000300000})+'))'));
  await t('Raees reads a sale (Store Accounts needs to see what is waiting)',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,r.data);await assertSucceeds(getDoc(doc(as(RAE),'wh_sales',r.id)));});
  await t('Raees cannot record, void or change a sale',async()=>{await reset();const r=build({},UMAIR);await assertFails(setDoc(doc(as(RAE),'wh_sales',r.id),r.data));await seed(r.id,r.data);await assertFails(updateDoc(doc(as(RAE),'wh_sales',r.id),voidPatch(RAE)));await assertFails(updateDoc(doc(as(RAE),'wh_sales',r.id),{note:'x'}));});
  await t('Umair marks a pay-later bill collected (the app\'s own patch)',async()=>{await reset();const r=later();await seed(r.id,r.data);const p=collect(r,{via:'bank',date:'2026-09-24'});expect(p.patch,'refused by the app: '+p.error);await assertSucceeds(updateDoc(doc(as(UMAIR),'wh_sales',r.id),p.patch));});
  await t('… not in Afnan\'s name',async()=>{await reset();const r=later();await seed(r.id,r.data);await assertFails(updateDoc(doc(as(UMAIR),'wh_sales',r.id),collect(r,{via:'cash',date:'2026-09-24'},AFNAN).patch));});
  await t('… not on a PAID sale',async()=>{await reset();const r=build({},UMAIR);await seed(r.id,r.data);const p=collect(later(),{via:'cash',date:'2026-09-24'}).patch;await assertFails(updateDoc(doc(as(UMAIR),'wh_sales',r.id),p));});
  await t('… not on a void one',async()=>{await reset();const r=later();await seed(r.id,Object.assign({},r.data,voidPatch(UMAIR)));await assertFails(updateDoc(doc(as(UMAIR),'wh_sales',r.id),collect(r,{via:'cash',date:'2026-09-24'}).patch));});
  await t('… not dated before the sale',async()=>{await reset();const r=later();await seed(r.id,r.data);await assertFails(updateDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign(collect(r,{via:'cash',date:'2026-09-24'}).patch,{collectedDate:'2026-09-19'})));});
  await t('… not by card (cash or bank only)',async()=>{await reset();const r=later();await seed(r.id,r.data);await assertFails(updateDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign(collect(r,{via:'cash',date:'2026-09-24'}).patch,{collectedVia:'card'})));});
  await t('… and a collection may not touch the money',async()=>{await reset();const r=later();await seed(r.id,r.data);await assertFails(updateDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign(collect(r,{via:'cash',date:'2026-09-24'}).patch,{total:1})));});
  await t('Umair undoes a collection',async()=>{await reset();const r=later();await seed(r.id,Object.assign({},r.data,collect(r,{via:'cash',date:'2026-09-24'}).patch));await assertSucceeds(updateDoc(doc(as(UMAIR),'wh_sales',r.id),{collectedAt:null,collectedBy:null,collectedByName:null,collectedVia:null,collectedDate:null}));});
  await t('a collected bill cannot be collected again (cash → bank rewritten in place)',async()=>{await reset();const r=later();await seed(r.id,Object.assign({},r.data,collect(r,{via:'cash',date:'2026-09-24'}).patch));await assertFails(updateDoc(doc(as(UMAIR),'wh_sales',r.id),{collectedVia:'bank',collectedDate:'2026-09-25',collectedAt:1790000400000,collectedBy:'umair',collectedByName:'Umair'}));});
  await t('an uncollected bill cannot be "un-collected"',async()=>{await reset();const r=later();await seed(r.id,r.data);await assertFails(updateDoc(doc(as(UMAIR),'wh_sales',r.id),{collectedAt:null,collectedBy:null,collectedByName:null,collectedVia:null,collectedDate:null}));});
  await t('a sale whose date is not a day is refused (it is drawn into Raees\'s page)',async()=>{await reset();const r=build({},UMAIR);await assertFails(setDoc(doc(as(UMAIR),'wh_sales',r.id),Object.assign({},r.data,{date:'<img src=x onerror=alert(1)>'})));});
  await t('Raees cannot mark a bill collected',async()=>{await reset();const r=later();await seed(r.id,r.data);await assertFails(updateDoc(doc(as(RAE),'wh_sales',r.id),collect(r,{via:'cash',date:'2026-09-24'},RAE).patch));});

  // ── Store Accounts: acct_entries (Sept 2026 — Raees can edit) ──
  // Here the WRITES are the app's own: js/store.js's REST helpers, aimed at
  // the emulator, driven by js/store-accounts.js's real edit / void / stock
  // code, signed in with an unsigned emulator token carrying the email the
  // rules read. So the masked PATCH, the currentDocument precondition and the
  // stock :commit are exercised as they are sent — not re-typed here.
  const EMU=process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:8080';
  const RAEES={uid:'u-raees',email:'raees@groovy.op',u:'raees',name:'Raees',role:'store'};
  const AFN={uid:'u-afnan',email:'afnan@groovy.op',u:'afnan',name:'Afnan',role:'owner'};
  const MUS={uid:'u-mustafa',email:'mustafa@groovy.op',u:'mustafa',name:'Mustafa',role:'manager'};
  const os=require('os');
  const storeSrc=fs.readFileSync(path.join(REPO,'js/store.js'),'utf8')
    .split('https://firestore.googleapis.com/v1/projects/groovy-gatepass/databases/(default)/documents').join('http://'+EMU+'/v1/projects/demo-whs/databases/(default)/documents')
    .replace(/const _FS_DOCS=[^\n]*/,"const _FS_DOCS='projects/demo-whs/databases/(default)/documents';");
  const tmpStore=path.join(os.tmpdir(),'store-emu-'+process.pid+'.js');
  fs.writeFileSync(tmpStore,storeSrc);
  const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  const tokenFor=w=>{const now=Math.floor(1790000000);return b64({alg:'none',typ:'JWT'})+'.'+b64({iss:'https://securetoken.google.com/demo-whs',aud:'demo-whs',auth_time:now,user_id:w.uid,sub:w.uid,iat:now,exp:now+36000000,email:w.email,email_verified:true,firebase:{identities:{email:[w.email]},sign_in_provider:'password'}})+'.';};
  const acct=(who)=>{
    const a=harness.loadApp({files:[path.relative(harness.ROOT,tmpStore),'js/store-accounts.js'],session:who,currentPage:'acct-ledger',
      globals:{fetch:globalThis.fetch,auth:{currentUser:{getIdToken:async()=>tokenFor(who)}},localStorage:LS,
        allItems:[],allTransactions:[],allTemplates:[],allRequests:[],allActivePOs:[],allStoreCategories:[],allPoIssueRequests:[],allPoEditRequests:[],allPoShortfalls:[],
        _ilPage:1,_ilQ:'',_ilPO:'',_ilDir:'',IL_PER:15,IL_MAX_PAGES:1000,_invFilterCat:'all',_invSearchQ:'',_invSort:'category'}});
    a.load=(entries,closes,items)=>a.run(`acctEntries=${JSON.stringify(entries)};acctVendors=[{_id:'V1',name:'Karachi Thread',active:true,terms:{mode:'credit'}},{_id:'V2',name:'Lahore Trims',active:true,terms:{mode:'credit'}}];acctCloses=${JSON.stringify(closes||[])};acctSettings=null;_acctLoaded=true;_storeLoadAttempted=true;allItems=${JSON.stringify(items||[])};_acctSort(acctEntries);1`);
    return a;
  };
  const MO=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
  const TODAY=MO+'-'+String(new Date().getDate()).padStart(2,'0');
  const prevMo=(()=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');})();
  const ENT=(o)=>Object.assign({type:'payment',date:TODAY,month:MO,ts:1790000000000,by:'raees',byName:'Raees',vendorId:'V1',vendorName:'Karachi Thread',person:'',account:'cash',toAccount:null,source:null,floatId:null,amount:1200,lines:[],category:'',ref:'',note:'',photo:null,status:'posted',needsReview:false,reviewFlags:[]},o||{});
  const seedAcct=async(col,id,data)=>env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),col,id),data);});
  const readAcct=async(col,id)=>{let v=null;await env.withSecurityRulesDisabled(async c=>{const snap=await getDoc(doc(c.firestore(),col,id));v=snap.exists()?snap.data():null;});return v;};
  const allOf=async(col)=>{let v=[];await env.withSecurityRulesDisabled(async c=>{const q=await getDocs(collection(c.firestore(),col));v=q.docs.map(d=>Object.assign({_id:d.id},d.data()));});return v;};
  // the app's edit: form values → _acctSaveEdit, with a reason in the field
  const edit=async(a,id,changes,reason)=>{a.el('f-edit-reason').value=reason==null?'typed it wrong':reason;a.run(`_acctEditId=${JSON.stringify(id)}`);return a.run(`(async()=>{const o=_acctById(${JSON.stringify(id)});const n=Object.assign({},o,${JSON.stringify(changes)});const r=await _acctSaveEdit(o,n);_acctEditId=null;return !!r;})()`);};

  console.log('store accounts — Raees confirms a warehouse payment (the app\'s own create)');
  const acctWh=(who)=>{const a=harness.loadApp({files:[path.relative(harness.ROOT,tmpStore),'js/store-accounts.js','js/warehouse-sales.js'],session:who,currentPage:'acct-ledger',
      globals:{fetch:globalThis.fetch,auth:{currentUser:{getIdToken:async()=>tokenFor(who)}},localStorage:LS,allItems:[],allTransactions:[]}});
    a.run('acctEntries=[];acctVendors=[];acctCloses=[];acctSettings=null;_acctLoaded=true;1');return a;};
  const whSale=Object.assign({_id:'SO0351'},build({orderNo:'SO0351',customerName:'RAVI KUMAR'},UMAIR).data);
  const whData=Object.assign({},whSale);delete whData._id;
  await t('Raees confirms: the cash in is created under the sale\'s id',async()=>{await reset();await seed('SO0351',whData);const a=acctWh(RAEES);
    a.run(`whSales=[${JSON.stringify(whSale)}];whSalesLoaded=true;whsConfirmations=[];whsConfLoaded=true;1`);
    const r=await a.run("_acctWhConfirmOne(_acctWhFind('SO0351#0'),_acctWhFind('SO0351#0').money.amount,'')");
    expect(r&&r.row,'refused: '+JSON.stringify(r));
    const d=await readAcct('acct_entries','whs_SO0351_0');expect(d&&d.type==='cash_in'&&d.src==='wh'&&d.whSale==='SO0351#0'&&d.amount===whSale.total&&d.account==='cash','stored '+JSON.stringify(d));});
  await t('a second device confirming the same sale is refused by the server',async()=>{const a=acctWh(RAEES);
    a.run(`whSales=[${JSON.stringify(whSale)}];whSalesLoaded=true;whsConfirmations=[];whsConfLoaded=true;1`);
    const r=await a.run("_acctWhConfirmOne(_acctWhFind('SO0351#0'),1,'')");
    expect(r&&r.error&&r.exists,'allowed a second create: '+JSON.stringify(r));
    const d=await readAcct('acct_entries','whs_SO0351_0');expect(d.amount===whSale.total,'the first was overwritten');});
  await t('a short handover is accepted — flagged for review',async()=>{await reset();await seed('SO0351',whData);const a=acctWh(RAEES);
    a.run(`whSales=[${JSON.stringify(whSale)}];whSalesLoaded=true;whsConfirmations=[];whsConfLoaded=true;1`);
    const r=await a.run("_acctWhConfirmOne(_acctWhFind('SO0351#0'),100,'short')");
    expect(r&&r.row,'refused: '+JSON.stringify(r));const d=await readAcct('acct_entries','whs_SO0351_0');expect(d.amount===100&&d.needsReview===true,'stored '+JSON.stringify(d));});
  // The rules, with the app bypassed: a confirmation must match its sale.
  const rawConf=o=>{const a=acctWh(RAEES);a.run(`whSales=[${JSON.stringify(whSale)}];whSalesLoaded=true;whsConfirmations=[];whsConfLoaded=true;1`);
    const e=JSON.parse(a.run("JSON.stringify(Object.assign(_acctWhEntry(_acctWhFind('SO0351#0'),_acctWhFind('SO0351#0').money.amount,''),{date:_acctToday(),month:_acctThisMonth()}))"));return Object.assign(e,o||{});};
  await t('raw: the app\'s confirmation passes the rules',async()=>{await reset();await seed('SO0351',whData);await assertSucceeds(setDoc(doc(as(RAE),'acct_entries','whs_SO0351_0'),rawConf()));});
  await t('raw: a short amount NOT flagged for review is refused',async()=>{await reset();await seed('SO0351',whData);await assertFails(setDoc(doc(as(RAE),'acct_entries','whs_SO0351_0'),rawConf({amount:1,needsReview:false,reviewFlags:[]})));});
  await t('raw: a bill total that is not the sale\'s is refused',async()=>{await reset();await seed('SO0351',whData);await assertFails(setDoc(doc(as(RAE),'acct_entries','whs_SO0351_0'),rawConf({amount:1,whSaleTotal:1})));});
  await t('raw: a confirmation for a VOID sale is refused',async()=>{await reset();await seed('SO0351',Object.assign({},whData,voidPatch(UMAIR)));await assertFails(setDoc(doc(as(RAE),'acct_entries','whs_SO0351_0'),rawConf()));});
  await t('raw: a confirmation for a pay-later bill not yet collected is refused',async()=>{await reset();await seed('SO0351',Object.assign({},whData,{terms:'later',paidVia:'',dueDate:'2026-10-01'}));await assertFails(setDoc(doc(as(RAE),'acct_entries','whs_SO0351_0'),rawConf()));});
  await t('raw: a confirmation for a sale that does not exist is refused',async()=>{await reset();await assertFails(setDoc(doc(as(RAE),'acct_entries','whs_SO0351_0'),rawConf()));});
  await t('raw: an ordinary cash in (no src) is unaffected',async()=>{await reset();await assertSucceeds(setDoc(doc(as(RAE),'acct_entries','c1'),ENT({type:'cash_in',vendorId:null,vendorName:''})));});
  await t('the app refuses a sale voided since the page loaded (re-read)',async()=>{await reset();await seed('SO0351',Object.assign({},whData,voidPatch(UMAIR)));const a=acctWh(RAEES);
    a.run(`whSales=[${JSON.stringify(whSale)}];whSalesLoaded=true;whsConfirmations=[];whsConfLoaded=true;1`);
    const r=await a.run("_acctWhConfirmOne(_acctWhFind('SO0351#0'),_acctWhFind('SO0351#0').money.amount,'')");
    expect(r&&r.stale,'not refused as stale: '+JSON.stringify(r));expect(!(await readAcct('acct_entries','whs_SO0351_0')),'written');});
  await t('Mustafa (a manager) cannot confirm — the app offers him nothing, and the rules refuse a raw write',async()=>{await reset();await seed('SO0351',whData);const a=acctWh(MUS);
    a.run(`whSales=[${JSON.stringify(whSale)}];whSalesLoaded=true;whsConfirmations=[];whsConfLoaded=true;1`);
    expect(a.run('_acctWh()')===null,'the queue is shown to a manager');
    const MUSC={uid:MUS.uid,email:MUS.email};
    await assertFails(setDoc(doc(as(MUSC),'acct_entries','whs_SO0351_0'),rawConf()));
    expect(!(await readAcct('acct_entries','whs_SO0351_0')),'written');});

  console.log('store accounts — Raees edits his own entry (the app\'s own REST writes)');
  await t('Raees corrects the amount of his own payment',async()=>{await reset();const e=ENT();await seedAcct('acct_entries','p1',e);
    const a=acct(RAEES);a.load([Object.assign({_id:'p1'},e)]);
    expect(await edit(a,'p1',{amount:1500}),'refused: '+JSON.stringify(a.state.toasts.slice(-1)));
    const d=await readAcct('acct_entries','p1');
    expect(d.amount===1500,'amount '+d.amount);expect(d.edits.length===1&&d.edits[0].by==='raees'&&d.edits[0].reason==='typed it wrong','history '+JSON.stringify(d.edits));
    expect(d.needsReview===true&&d.reviewFlags.includes('edited'),'not sent for review');
    expect(d.by==='raees'&&d.ts===1790000000000&&d.type==='payment','author changed');});
  await t('a second edit grows the history to two, the first untouched',async()=>{await reset();const e=ENT();await seedAcct('acct_entries','p1',e);
    const a=acct(RAEES);a.load([Object.assign({_id:'p1'},e)]);
    expect(await edit(a,'p1',{amount:1500}),'first refused');expect(await edit(a,'p1',{vendorId:'V2'},'wrong vendor'),'second refused: '+JSON.stringify(a.state.toasts.slice(-1)));
    const d=await readAcct('acct_entries','p1');expect(d.edits.length===2&&d.edits[0].after.amount===1500&&d.edits[1].reason==='wrong vendor'&&d.vendorName==='Lahore Trims','history '+JSON.stringify(d.edits));});
  await t('an edit that moves the date writes the month with it',async()=>{await reset();const e=ENT({date:MO+'-01'});await seedAcct('acct_entries','p1',e);
    const a=acct(RAEES);a.load([Object.assign({_id:'p1'},e)]);expect(await edit(a,'p1',{date:TODAY==(MO+'-01')?MO+'-01':TODAY,note:'x'}),'refused');
    const d=await readAcct('acct_entries','p1');expect(d.month===d.date.slice(0,7),'month '+d.month+' date '+d.date);});
  await t('a purchase line edit (rate) saves through the same rule',async()=>{await reset();const e=ENT({type:'purchase',source:'credit',account:null,amount:1000,category:'Store purchase',lines:[{itemCode:'',desc:'thread',qty:10,unit:'cone',rate:100,total:1000}]});await seedAcct('acct_entries','p1',e);
    const a=acct(RAEES);a.load([Object.assign({_id:'p1'},e)]);expect(await edit(a,'p1',{amount:1200,lines:[{itemCode:'',desc:'thread',qty:10,unit:'cone',rate:120,total:1200}]}),'refused: '+JSON.stringify(a.state.toasts.slice(-1)));
    const d=await readAcct('acct_entries','p1');expect(d.lines[0].rate===120&&d.amount===1200&&d.edits[0].before.lines[0].rate===100,'lines '+JSON.stringify(d.lines));});

  console.log('store accounts — what Raees cannot do, refused by the RULES (the client check bypassed)');
  // _acctFsMask straight at the server, the way a modified client would
  const raw=async(who,id,data)=>{const a=acct(who);try{await a.run(`_acctFsMask('acct_entries',${JSON.stringify(id)},${JSON.stringify(data)},${JSON.stringify(Object.keys(data))})`);return true;}catch(e){return false;}};
  const hist=(o)=>[Object.assign({at:1790000100000,by:'raees',byName:'Raees',reason:'typo',fields:['amount'],before:{amount:1200},after:{amount:1500}},o||{})];
  const good=(o)=>Object.assign({amount:1500,edits:hist(),editedAt:1790000100000,editedBy:'raees',needsReview:true,reviewFlags:['edited']},o||{});
  await t('control: a well-formed edit passes when sent raw',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(await raw(RAEES,'p1',good()),'refused');});
  await t('an entry Afnan entered',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({by:'afnan',byName:'Afnan'}));expect(!await raw(RAEES,'p1',good()),'allowed');});
  await t('an entry in a closed month',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({date:prevMo+'-10',month:prevMo}));await seedAcct('acct_closes',prevMo,{month:prevMo});expect(!await raw(RAEES,'p1',good()),'allowed');});
  await t('moving an entry OUT of a closed month (it is inside that close)',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({date:prevMo+'-10',month:prevMo}));await seedAcct('acct_closes',prevMo,{month:prevMo});expect(!await raw(RAEES,'p1',good({date:TODAY,month:MO})),'allowed');});
  await t('moving the date INTO a closed month',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());await seedAcct('acct_closes',prevMo,{month:prevMo});expect(!await raw(RAEES,'p1',good({date:prevMo+'-10',month:prevMo})),'allowed');});
  await t('a month that does not match the date (dodging the close check)',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());await seedAcct('acct_closes',prevMo,{month:prevMo});expect(!await raw(RAEES,'p1',good({date:prevMo+'-10',month:MO})),'allowed');});
  await t('an entry an owner has reviewed',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({reviewedAt:1790000050000,reviewedBy:'afnan'}));expect(!await raw(RAEES,'p1',good()),'allowed');});
  await t('a void entry',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({status:'void'}));expect(!await raw(RAEES,'p1',good()),'allowed');});
  await t('a pending cash in',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({type:'cash_in',status:'pending',vendorId:null}));expect(!await raw(RAEES,'p1',good()),'allowed');});
  await t('without a reason',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',good({edits:hist({reason:''})})),'allowed');});
  await t('without the edit going to review',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',good({needsReview:false})),'allowed');});
  await t('without the edited flag',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',good({reviewFlags:[]})),'allowed');});
  await t('with no history entry',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',good({edits:[]})),'allowed');});
  await t('control: a well-formed SECOND edit, history kept, passes raw',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({edits:hist()}));expect(await raw(RAEES,'p1',good({edits:hist().concat(hist({reason:'again'}))})),'refused');});
  await t('rewriting an earlier history entry',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({edits:hist()}));expect(!await raw(RAEES,'p1',good({edits:hist({reason:'changed'}).concat(hist())})),'allowed');});
  await t('in Afnan\'s name',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',good({editedBy:'afnan',edits:hist({by:'afnan'})})),'allowed');});
  await t('changing the type',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',good({type:'purchase'})),'allowed');});
  await t('changing who entered it',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',good({by:'afnan'})),'allowed');});
  await t('touching the stock stamps inside an edit',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',good({stockPosted:true})),'allowed');});
  await t('Mustafa (a manager) cannot edit anything',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({by:'mustafa'}));expect(!await raw(MUS,'p1',good({editedBy:'mustafa',edits:hist({by:'mustafa'})})),'allowed');});
  await t('a STALE tab: an owner reviewed it after the page was opened — the app\'s own edit is refused',async()=>{await reset();const e=ENT();await seedAcct('acct_entries','p1',Object.assign({},e,{reviewedAt:1790000050000,reviewedBy:'afnan'}));
    const a=acct(RAEES);a.load([Object.assign({_id:'p1'},e)]);expect(!(await edit(a,'p1',{amount:1500})),'allowed');
    const d=await readAcct('acct_entries','p1');expect(d.reviewedAt===1790000050000&&d.amount===1200,'the review was undone');});

  console.log('store accounts — void, confirm, review');
  await t('Raees voids his entry (the app\'s own masked write)',async()=>{await reset();const e=ENT();await seedAcct('acct_entries','p1',e);
    const a=harness.loadApp({files:[path.relative(harness.ROOT,tmpStore),'js/store-accounts.js'],session:RAEES,globals:{fetch:globalThis.fetch,auth:{currentUser:{getIdToken:async()=>tokenFor(RAEES)}},localStorage:LS,allItems:[],allTransactions:[],prompt:()=>'entered twice'}});
    a.run(`acctEntries=${JSON.stringify([Object.assign({_id:'p1'},e)])};acctVendors=[];acctCloses=[];_acctLoaded=true;1`);
    await a.run("window.acctVoid('p1')");const d=await readAcct('acct_entries','p1');expect(d.status==='void'&&d.voidedBy==='raees','not voided: '+JSON.stringify(a.state.toasts));});
  await t('a void in someone else\'s name is refused',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',{status:'void',voidedAt:1,voidedBy:'afnan',voidReason:'x'}),'allowed');});
  await t('a void in a closed month is refused',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({date:prevMo+'-10',month:prevMo}));await seedAcct('acct_closes',prevMo,{month:prevMo});expect(!await raw(RAEES,'p1',{status:'void',voidedAt:1,voidedBy:'raees',voidReason:'x'}),'allowed');});
  await t('un-voiding is refused',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({status:'void',voidedBy:'raees'}));expect(!await raw(RAEES,'p1',{status:'posted'}),'allowed');});
  await t('rewriting the void stamps on an entry already void (someone else\'s void)',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({status:'void',voidedBy:'afnan',voidedAt:1,voidReason:'duplicate'}));expect(!await raw(RAEES,'p1',{voidedBy:'raees',voidReason:'x'}),'allowed');});
  await t('voiding an entry an owner has reviewed (the app refuses; so do the rules)',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({reviewedAt:1790000050000,reviewedBy:'afnan'}));expect(!await raw(RAEES,'p1',{status:'void',voidedAt:1,voidedBy:'raees',voidReason:'x'}),'allowed');});
  await t('control: stock stamps on a void entry still pass (the status does not move)',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({status:'void',voidedBy:'raees'}));expect(await raw(RAEES,'p1',{stockError:'x'}),'refused');});
  await t('a history row marked admin (posing as an owner\'s correction)',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',good({edits:hist({admin:true})})),'allowed');});
  await t('a history row that hides a changed field',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',good({note:'quietly',edits:hist()})),'allowed');});
  await t('a history row naming a field that did not change',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(!await raw(RAEES,'p1',good({edits:hist({fields:['amount','note']})})),'allowed');});
  await t('Afnan\'s Clear from a stale page, after Raees edited: the re-read shows it and clears nothing',async()=>{await reset();const e=ENT({needsReview:true,reviewFlags:['over limit']});await seedAcct('acct_entries','p1',e);
    const a=acct(AFN);a.load([Object.assign({_id:'p1'},e)]);
    const r=acct(RAEES);r.load([Object.assign({_id:'p1'},e)]);expect(await edit(r,'p1',{amount:50000}),'the edit itself was refused');
    await a.run("window.acctReview('p1')");
    const d=await readAcct('acct_entries','p1');expect(!d.reviewedAt&&d.amount===50000,'cleared unseen: '+JSON.stringify([d.reviewedAt,d.amount]));
    expect(a.run("_acctById('p1').amount")===50000,'the page still shows the old amount');});
  await t('Afnan\'s Clear on an unchanged entry passes with the precondition',async()=>{await reset();const e=ENT({needsReview:true,reviewFlags:['over limit']});await seedAcct('acct_entries','p1',e);
    const a=acct(AFN);a.load([Object.assign({_id:'p1'},e)]);await a.run("window.acctReview('p1')");
    const d=await readAcct('acct_entries','p1');expect(d.reviewedAt>0&&d.reviewedBy==='afnan','not cleared: '+JSON.stringify(a.state.toasts.slice(-1)));});
  await t('Raees confirms a pending cash in',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({type:'cash_in',status:'pending',by:'afnan'}));expect(await raw(RAEES,'p1',{status:'posted',confirmedAt:1,confirmedBy:'raees'}),'refused');});
  await t('Raees cannot clear a review flag — not even his own edit\'s',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({needsReview:true,reviewFlags:['edited']}));expect(!await raw(RAEES,'p1',{reviewedAt:1,reviewedBy:'raees'}),'allowed reviewedAt');expect(!await raw(RAEES,'p1',{needsReview:false,reviewFlags:[]}),'allowed needsReview');});
  await t('Raees records stock posting stamps (the sync\'s own patch)',async()=>{await reset();await seedAcct('acct_entries','p1',ENT());expect(await raw(RAEES,'p1',{stockPosted:true,stockError:'',stockTx:['t1']}),'refused');});
  await t('Afnan clears a review',async()=>{await reset();await seedAcct('acct_entries','p1',ENT({needsReview:true,reviewFlags:['edited']}));expect(await raw(AFN,'p1',{reviewedAt:1,reviewedBy:'afnan'}),'refused');});
  await t('a masked patch never re-creates a deleted entry',async()=>{await reset();expect(!await raw(AFN,'gone',{note:'x'}),'allowed');expect((await readAcct('acct_entries','gone'))===null,'resurrected');});

  console.log('store accounts — the stock sync posts only the difference (real :commit)');
  await t('qty 12 → 15 posts +3; running it again posts nothing; 15 → 10 posts −5',async()=>{await reset();
    const e=ENT({type:'purchase',source:'credit',account:null,amount:2400,category:'Store purchase',lines:[{itemCode:'TH1',desc:'Thread',qty:12,unit:'cone',rate:200,total:2400}],stockPosted:true,stockTx:['t0']});
    await seedAcct('acct_entries','p1',e);await seedAcct('store_items','TH1',{code:'TH1',name:'Thread',unit:'cone',balance:32,sizeSpecific:false});
    await seedAcct('store_transactions','t0',{type:'received',itemCode:'TH1',itemName:'Thread',qty:12,unit:'cone',acctEntryId:'p1',ts:1});
    const a=acct(RAEES);a.load([Object.assign({_id:'p1'},e)],[],[{code:'TH1',name:'Thread',unit:'cone',balance:32,sizeSpecific:false,_id:'TH1'}]);
    expect(await edit(a,'p1',{amount:3000,lines:[{itemCode:'TH1',desc:'Thread',qty:15,unit:'cone',rate:200,total:3000}]}),'edit refused');
    await a.run("_acctStockSync(_acctById('p1'))");
    let it=await readAcct('store_items','TH1');let rows=(await allOf('store_transactions')).filter(r=>r.acctEntryId==='p1');
    expect(it.balance===35,'balance '+it.balance);expect(rows.length===2&&rows.some(r=>r.qty===3&&r.correction===true),'rows '+JSON.stringify(rows.map(r=>r.qty)));
    const d=await readAcct('acct_entries','p1');expect(d.stockPosted===true&&d.stockTx.length===2,'stamps '+JSON.stringify([d.stockPosted,d.stockTx]));
    await a.run("_acctStockSync(_acctById('p1'))");
    rows=(await allOf('store_transactions')).filter(r=>r.acctEntryId==='p1');it=await readAcct('store_items','TH1');
    expect(rows.length===2&&it.balance===35,'a second run posted again: '+rows.length+' rows, balance '+it.balance);
    expect(await edit(a,'p1',{amount:2000,lines:[{itemCode:'TH1',desc:'Thread',qty:10,unit:'cone',rate:200,total:2000}]},'only 10 came'),'second edit refused');
    await a.run("_acctStockSync(_acctById('p1'))");
    rows=(await allOf('store_transactions')).filter(r=>r.acctEntryId==='p1');it=await readAcct('store_items','TH1');
    expect(it.balance===30&&rows.some(r=>r.qty===-5),'balance '+it.balance+' rows '+JSON.stringify(rows.map(r=>r.qty)));});
  await t('Retry after a partial failure no longer double-posts',async()=>{await reset();
    const e=ENT({type:'purchase',source:'credit',account:null,amount:2410,category:'Store purchase',lines:[{itemCode:'TH1',desc:'Thread',qty:12,unit:'cone',rate:200,total:2400},{itemCode:'NOPE',desc:'Ghost',qty:1,unit:'',rate:10,total:10}],stockPosted:false,stockError:'NOPE: not in inventory',stockTx:['t0']});
    await seedAcct('acct_entries','p1',e);await seedAcct('store_items','TH1',{code:'TH1',name:'Thread',unit:'cone',balance:32,sizeSpecific:false});
    await seedAcct('store_transactions','t0',{type:'received',itemCode:'TH1',itemName:'Thread',qty:12,unit:'cone',acctEntryId:'p1',ts:1});
    const a=acct(RAEES);a.load([Object.assign({_id:'p1'},e)],[],[{code:'TH1',name:'Thread',unit:'cone',balance:32,sizeSpecific:false,_id:'TH1'}]);
    await a.run("window.acctRetryStock('p1')");await a.run("window.acctRetryStock('p1')");
    const it=await readAcct('store_items','TH1');expect(it.balance===32,'balance '+it.balance+' — Retry posted TH1 again');});
  await t('Afnan\'s admin edit is a masked write that appends the history',async()=>{await reset();const e=ENT();await seedAcct('acct_entries','p1',e);
    const a=acct(AFN);a.load([Object.assign({_id:'p1'},e)]);a.run("window.acctAdminEdit('p1')");
    const set=(k,v)=>{a.el('ae-'+k).value=v;};set('date',TODAY);set('amount','900');set('vendor','V1');set('payee','');set('person','');set('account','cash');set('to','');set('source','');set('category','');set('ref','');set('note','');set('reason','bank said 900');
    await a.run("window.acctAdminSave('p1')");const d=await readAcct('acct_entries','p1');
    expect(d.amount===900&&d.edits&&d.edits.length===1&&d.edits[0].admin===true&&d.edits[0].reason==='bank said 900','doc '+JSON.stringify(d));});

  fs.unlinkSync(tmpStore);
  await env.cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});

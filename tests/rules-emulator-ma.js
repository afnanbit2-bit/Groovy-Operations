/* ─────────────────────────────────────────────────────────────────────────
   tests/rules-emulator-ma.js — Master Accounts' firestore.rules, run in the
   REAL Firestore emulator (M1.2, Sept 2026). The app's FIRST owner-only
   reads: every ma_* block, both ways.

   Not a *.test.js: it needs firebase-tools, the emulator and Java, and CI
   installs nothing. Run it by hand whenever an ma_* rule or a writer in
   js/ma-core.js changes:
     mkdir -p /tmp/emu && cd /tmp/emu && npm init -y >/dev/null
     npm install firebase-tools@13 @firebase/rules-unit-testing firebase
     cd <repo> && EMU_DEPS=/tmp/emu/node_modules \
       /tmp/emu/node_modules/.bin/firebase emulators:exec --only firestore \
       --project demo-ma "node tests/rules-emulator-ma.js"
   The emulator writes firestore-debug.log into the directory it runs from,
   and the repo TRACKS that file: afterwards `git checkout firestore-debug.log`
   — or run from a scratch directory holding its own firebase.json
   ({"firestore":{"rules":"<a copy of firestore.rules>"}}) and point node at
   this file by its absolute path (it finds the repo from its own location).

   Every document is BUILT BY THE APP (maBuildDoc, maApplyEdit, maApplyVoid,
   maConfirmPatch, maAuditRow from js/ma-core.js, through tests/harness.js),
   with the number minted the way the writer will (no = maDocNo(...), and the
   document id IS the number). A rule and the code that has to satisfy it are
   tested together. A demo- project id keeps it offline: nothing here can
   reach groovy-gatepass. What the Console has PUBLISHED is a separate
   question only the human can answer.

   M1.6a (edits and confirmations hold at the rules) added the checks named
   "M1.6a: …". Each is a write the rules before M1.6a ALLOWED and these
   refuse — run this file against the previous firestore.rules and every
   one of them fails there, which is what proves it has teeth. Each works on
   its own freshly seeded document, so one landing under the old rules
   cannot spill into the next. Audit rows are stamped NOW: the rules hold
   them to within five minutes of the server's clock.

   V3 (29 Sept 2026) added the checks named "V3: …" — each a write the rules
   before V3 allowed (a code written as a number or with a space, a negative
   or fractional amount, a row naming only "flags", a row dated 0, a flipped
   `historical`) — and "V3 control: …", writes the app makes that must still
   pass. Since V3 an EDIT row's `at` is held to the server's clock too, so
   every edit the builders here make is stamped now (nowRow).
   ───────────────────────────────────────────────────────────────────────── */
const fs=require('fs');
const path=require('path');
const REPO=path.join(__dirname,'..');
const dep=p=>require(require.resolve(p,{paths:[process.env.EMU_DEPS,process.cwd()].filter(Boolean)}));
const {initializeTestEnvironment,assertSucceeds,assertFails}=dep('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,deleteDoc,getDocs,collection,writeBatch}=dep('firebase/firestore');
const harness=require('./harness.js');

const app=harness.loadApp({files:['js/ma-core.js']});
const J=v=>JSON.stringify(v);
// Round-tripped through JSON: an object built inside the harness belongs to
// another realm, and the Firestore SDK refuses it as "a custom Object".
const R=expr=>JSON.parse(app.run('JSON.stringify((()=>{const IDX=maChartIndex(maChart("groovy"));const S=MA_DEFAULT_SETTINGS;return '+expr+';})())'));
let seq=0;
// What the writer does: build, then mint the number in the same step.
function build(dt,input,meta){
  const d=R('maBuildDoc('+J(dt)+','+J(input)+','+J(meta)+',IDX,S)');
  seq++;
  d.no=R('maDocNo('+J(dt)+','+J(d.fy)+','+seq+')');
  d.id=d.no;
  return d;
}
// An edit row is written NOW (V3, 29 Sept 2026): the rules hold its `at` to
// the server's clock, like an audit row's. Every edit these builders make is
// stamped that way, whatever `at` a check passes; the checks named "V3: …"
// put a stale one back on purpose.
const nowRow=meta=>Object.assign({},meta,{at:Date.now()});
const edit=(before,input,meta)=>R('maApplyEdit('+J(before)+',maBuildDoc('+J(before.dt)+','+J(input)+','+J({by:before.by,byName:before.byName,ts:before.ts})+',IDX,S),'+J(nowRow(meta))+')');
// A count's edit, the way the writer builds it (M1.6a, money F2): the stored
// book is kept unless the day or the count moved — then it is `bookNow`.
const editCount=(before,input,bookNow,meta)=>R('maApplyEdit('+J(before)+',maBuildDoc("count",'+J(input)+',Object.assign('+J({by:before.by,byName:before.byName,ts:before.ts})+',{bookBalance:maCountBookOf('+J(before)+','+J(input)+','+J(bookNow)+')}),IDX,S),'+J(nowRow(meta))+')');
const voided=(d,meta)=>R('maApplyVoid('+J(d)+','+J(meta)+')');
const confirm=(d,who,meta)=>R('maConfirmPatch('+J(d)+','+J(who)+','+J(meta)+')');
const audit=(action,target,meta)=>R('maAuditRow('+J(action)+','+J(target)+','+J(meta)+')');
const relock=(close,meta)=>R('maCloseRelock('+J(close)+','+J(meta)+')');
const COL={journal:'ma_journal',transfer:'ma_transfer',count:'ma_counts'};
const pathOf=d=>COL[d.dt]+'/'+d.no;

const U={afnan:'u-afnan',ammar:'u-ammar',mustafa:'u-must',raees:'u-raees'};
const T=Date.UTC(2026,9,5,6,0);
const NOW=()=>Date.now();   // an audit row's `at` — the rules hold it to the server's clock (M1.6a)
// The page writer (js/master-accounts.js) — its _maEditShape is what an edit
// is actually written through.
const pages=harness.loadApp({files:['js/ma-core.js','js/master-accounts.js'],session:{uid:U.afnan,u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'}});
const P=expr=>JSON.parse(pages.run('JSON.stringify((()=>{const IDX=maChartIndex(maChart("groovy"));const S=MA_DEFAULT_SETTINGS;return '+expr+';})())'));
const shaped=(before,input,meta)=>P('_maEditShape('+J(before)+',maApplyEdit('+J(before)+',maBuildDoc('+J(before.dt)+','+J(input)+','+J({by:before.by,byName:before.byName,ts:before.ts})+',IDX,S),'+J(nowRow(meta))+'))');

let passed=0,failed=0;
async function check(name,fn){
  try{ await fn(); passed++; console.log('  ok   '+name); }
  catch(e){ failed++; console.log('  FAIL '+name+'\n       '+String(e&&e.message||e).split('\n')[0]); }
}

(async()=>{
  const env=await initializeTestEnvironment({
    projectId:'demo-ma',
    firestore:{rules:fs.readFileSync(path.join(REPO,'firestore.rules'),'utf8')}
  });
  const as=u=>env.authenticatedContext(U[u],{email:u+'@groovy.op'}).firestore();
  const anon=()=>env.unauthenticatedContext().firestore();
  const seed=async(p,d)=>env.withSecurityRulesDisabled(async c=>{ await setDoc(doc(c.firestore(),p),d); });
  const stored=async p=>{let x=null;await env.withSecurityRulesDisabled(async c=>{x=(await getDoc(doc(c.firestore(),p))).data();});return x;};

  const meta=u=>({by:u,byName:u[0].toUpperCase()+u.slice(1),ts:T});
  const jv=(u,o)=>build('journal',Object.assign({kind:'money_out',date:'2026-10-05',holder:'1011',account:'5010',payee:'Mill',amount:12000},o||{}),meta(u));

  console.log('what the builder produced');
  const j1=jv('afnan');
  const trA=build('transfer',{date:'2026-10-05',from:'1011',to:'1012',amount:5000},meta('afnan'));   // to Ammar: pending, in the app
  const trB=build('transfer',{date:'2026-10-06',from:'1011',to:'1012',amount:7000},meta('afnan'));
  const trU=build('transfer',{date:'2026-10-06',from:'1011',to:'1040',amount:3000},meta('afnan'));   // to Umair: pending, on paper
  const ct=build('count',{date:'2026-10-07',holder:'1011',counted:40000},Object.assign(meta('ammar'),{bookBalance:41000}));
  await check('journal posted in 2027-Q2 with its number as id; transfers pending (app and paper); count posted',async()=>{
    const ok=j1.status==='posted'&&j1.quarter==='2027-Q2'&&/^JV-27-\d{4}$/.test(j1.no)&&j1.id===j1.no
      &&trA.status==='pending'&&trA.confirmBy==='ammar'&&trA.confirmPaper===false
      &&trU.status==='pending'&&trU.confirmBy==='umair'&&trU.confirmPaper===true&&ct.status==='posted'&&ct.dt==='count';
    if(!ok)throw new Error(J({j1,trA,trU,ct}));
  });

  console.log('masters and settings — owner only, never deleted');
  const MASTERS=['ma_accounts','ma_sv_accounts','ma_parties','ma_items','ma_settings','ma_commitments','ma_counters','ma_feedback'];
  for(const c of MASTERS){
    await check(c+': Afnan creates, Ammar reads and updates',async()=>{
      await assertSucceeds(setDoc(doc(as('afnan'),c+'/x'),{name:'x',n:1}));
      await assertSucceeds(getDoc(doc(as('ammar'),c+'/x')));
      await assertSucceeds(updateDoc(doc(as('ammar'),c+'/x'),{n:2}));
    });
    await check(c+': Mustafa, Raees and signed-out are refused a READ',async()=>{
      await assertFails(getDoc(doc(as('mustafa'),c+'/x')));
      await assertFails(getDoc(doc(as('raees'),c+'/x')));
      await assertFails(getDoc(doc(anon(),c+'/x')));
      await assertFails(getDocs(collection(as('mustafa'),c)));
    });
    await check(c+': Mustafa and Raees are refused writes',async()=>{
      await assertFails(setDoc(doc(as('mustafa'),c+'/y'),{name:'y'}));
      await assertFails(updateDoc(doc(as('raees'),c+'/x'),{n:3}));
      await assertFails(setDoc(doc(anon(),c+'/y'),{name:'y'}));
    });
    await check(c+': an owner cannot delete',()=>assertFails(deleteDoc(doc(as('afnan'),c+'/x'))));
  }

  console.log('documents — create');
  await check('Afnan creates a journal the builder made',()=>assertSucceeds(setDoc(doc(as('afnan'),pathOf(j1)),j1)));
  await check('Afnan creates two pending transfers to Ammar and one to Umair',async()=>{
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(trA)),trA));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(trB)),trB));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(trU)),trU));
  });
  await check('Ammar creates a count',()=>assertSucceeds(setDoc(doc(as('ammar'),pathOf(ct)),ct)));
  await check('Ammar reads the journal; the whole collection is readable to an owner',async()=>{
    await assertSucceeds(getDoc(doc(as('ammar'),pathOf(j1))));
    await assertSucceeds(getDocs(collection(as('ammar'),'ma_journal')));
  });
  for(const d of [j1,trA,ct]){
    await check(COL[d.dt]+': Mustafa, Raees and signed-out cannot read',async()=>{
      await assertFails(getDoc(doc(as('mustafa'),pathOf(d))));
      await assertFails(getDoc(doc(as('raees'),pathOf(d))));
      await assertFails(getDoc(doc(anon(),pathOf(d))));
      await assertFails(getDocs(collection(as('raees'),COL[d.dt])));
    });
    await check(COL[d.dt]+': an owner cannot delete',()=>assertFails(deleteDoc(doc(as('afnan'),pathOf(d)))));
  }
  await check('Raees cannot create a journal, even one naming himself',async()=>{
    const r=jv('raees');await assertFails(setDoc(doc(as('raees'),pathOf(r)),r));
  });
  await check('Mustafa cannot create a count',async()=>{
    const m=build('count',{date:'2026-10-07',holder:'1011',counted:1},meta('mustafa'));await assertFails(setDoc(doc(as('mustafa'),pathOf(m)),m));
  });
  await check('Afnan cannot create a journal written as Ammar\'s (by ≠ caller)',async()=>{
    const x=jv('ammar');await assertFails(setDoc(doc(as('afnan'),pathOf(x)),x));
  });
  await check('the id must be the number',async()=>{
    const x=jv('afnan');await assertFails(setDoc(doc(as('afnan'),'ma_journal/JV-27-9999'),x));
  });
  await check('a quarter that is not the date\'s own is refused',async()=>{
    const x=jv('afnan');x.quarter='2027-Q3';await assertFails(setDoc(doc(as('afnan'),pathOf(x)),x));
  });
  await check('a journal cannot be born void, pending, or at rev 2',async()=>{
    const a=jv('afnan');a.status='void';await assertFails(setDoc(doc(as('afnan'),pathOf(a)),a));
    const b=jv('afnan');b.status='pending';await assertFails(setDoc(doc(as('afnan'),pathOf(b)),b));
    const c=jv('afnan');c.rev=2;await assertFails(setDoc(doc(as('afnan'),pathOf(c)),c));
  });
  await check('a journal cannot be filed in the transfers collection',async()=>{
    const x=jv('afnan');await assertFails(setDoc(doc(as('afnan'),'ma_transfer/'+x.no),x));
  });

  console.log('transfers are born with the map\'s answer, never the form\'s (M1.6a, security F2 · money F9)');
  // [from, to, recorded by, who confirms, on paper]. The drawer (1010) is
  // Raees's hands BOTH ways, and waits even when its receiver recorded it.
  const MAP=[['1011','1012','afnan','ammar',false],['1011','1012','ammar',null,false],['1011','1020','afnan',null,false],
    ['1011','1010','afnan','raees',true],['1010','1020','afnan','raees',true],['1020','1010','ammar','raees',true],
    ['1010','1011','afnan','afnan',false],['1010','1011','ammar','afnan',false],['1010','1012','ammar','ammar',false],
    ['1011','1040','afnan','umair',true],['1040','1020','afnan',null,false],['1012','1011','afnan',null,false],['1020','1012','afnan','ammar',false]];
  for(const [from,to,by,who,paper] of MAP){
    const t=build('transfer',{date:'2026-10-05',from,to,amount:1000},meta(by));
    await check(from+' → '+to+' by '+by+': '+(who?'waits for '+who+(paper?', on paper':', in the app'):'posts at once')+' — the builder and the rules agree',async()=>{
      if(!(t.confirmBy===who&&t.status===(who?'pending':'posted')&&t.confirmPaper===paper&&t.confirmVia===undefined))throw new Error(J({status:t.status,confirmBy:t.confirmBy,paper:t.confirmPaper,via:t.confirmVia}));
      await assertSucceeds(setDoc(doc(as(by),pathOf(t)),t));
    });
    const wrong=build('transfer',{date:'2026-10-05',from,to,amount:1000},meta(by));
    Object.assign(wrong,who?{status:'posted',confirmBy:null,confirmPaper:false}:{status:'pending',confirmBy:'ammar',confirmPaper:false});
    await check('M1.6a: '+from+' → '+to+' by '+by+' born '+(who?'posted, skipping '+who:'waiting for Ammar')+' is refused',()=>assertFails(setDoc(doc(as(by),pathOf(wrong)),wrong)));
  }
  const oldDrawer=build('transfer',{date:'2026-10-05',from:'1011',to:'1010',amount:25000},meta('afnan'));
  Object.assign(oldDrawer,{status:'posted',confirmBy:null,confirmPaper:false,confirmVia:'store'});
  await check('M1.6a: a handover into the drawer born posted "via store" (M1\'s special case, removed) is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(oldDrawer)),oldDrawer)));
  const onPaper=build('transfer',{date:'2026-10-05',from:'1011',to:'1012',amount:250000},meta('afnan'));
  onPaper.confirmPaper=true;
  await check('M1.6a: a transfer to Ammar born "on paper" is refused — it would let the sender confirm for him',()=>assertFails(setDoc(doc(as('afnan'),pathOf(onPaper)),onPaper)));

  console.log('a document is born with no confirmation, review or void (M1.6a, security F2)');
  const bornConfirmed=build('transfer',{date:'2026-10-05',from:'1011',to:'1012',amount:250000},meta('afnan'));
  Object.assign(bornConfirmed,{confirmedBy:'ammar',confirmedAt:T,confirmVia:'app'});
  await check('M1.6a: a transfer born already confirmed by Ammar is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(bornConfirmed)),bornConfirmed)));
  const bornReviewed=jv('afnan');Object.assign(bornReviewed,{reviewedAt:T,reviewedBy:'ammar'});
  await check('M1.6a: a journal born reviewed by Ammar is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(bornReviewed)),bornReviewed)));
  const bornVoidish=jv('afnan');Object.assign(bornVoidish,{voidedAt:T,voidedBy:'afnan',voidReason:'x'});
  await check('M1.6a: a posted journal born carrying a void is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(bornVoidish)),bornVoidish)));
  const bornWaiting=jv('afnan');Object.assign(bornWaiting,{confirmBy:'ammar',confirmPaper:false});
  await check('M1.6a: a journal born waiting on a confirmation is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(bornWaiting)),bornWaiting)));
  const ctReviewed=build('count',{date:'2026-10-07',holder:'1011',counted:40000},Object.assign(meta('afnan'),{bookBalance:41000}));
  Object.assign(ctReviewed,{reviewedAt:T,reviewedBy:'afnan'});
  await check('M1.6a: a count born reviewed is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(ctReviewed)),ctReviewed)));

  console.log('a count is born as counted less its book (M1.6a, money F2)');
  const ctOk=build('count',{date:'2026-10-07',holder:'1011',counted:40000},Object.assign(meta('afnan'),{bookBalance:41000}));
  await check('the builder\'s count (−₨1,000, amount 1,000) is created',async()=>{
    if(!(ctOk.difference===-1000&&ctOk.amount===1000))throw new Error(J(ctOk));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(ctOk)),ctOk));
  });
  const ctDiff=build('count',{date:'2026-10-07',holder:'1011',counted:40000},Object.assign(meta('afnan'),{bookBalance:41000}));
  Object.assign(ctDiff,{difference:-400000,amount:400000});
  await check('M1.6a: a count born with a difference that is not counted less the book is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(ctDiff)),ctDiff)));
  const ctAmt=build('count',{date:'2026-10-07',holder:'1011',counted:40000},Object.assign(meta('afnan'),{bookBalance:41000}));
  ctAmt.amount=5;
  await check('M1.6a: a count born with an amount that is not the size of its difference is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(ctAmt)),ctAmt)));

  console.log('every period label is its date\'s own; a date is a day (M1.6a, security F1 · F4)');
  const badMonth=jv('afnan');badMonth.month='2026-11';
  await check('M1.6a: a journal whose month is not its date\'s is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(badMonth)),badMonth)));
  const badFy=jv('afnan');badFy.fy='FY26';
  await check('M1.6a: a journal whose fiscal year is not its date\'s is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(badFy)),badFy)));
  // Labelled the way the old rules would have taken them (quarter from the
  // same arithmetic), so the only thing wrong is the day itself.
  for(const [d,q,m] of [['2026-00-01','2026-Q3','2026-00'],['2026-13-01','2027-Q2','2026-13'],['2026-10-32','2027-Q2','2026-10']]){
    const g=jv('afnan');Object.assign(g,{date:d,quarter:q,month:m});
    await check('M1.6a: a date that is not a day ('+d+') is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(g)),g)));
  }

  console.log('documents — edit');
  const j1e=edit(j1,{kind:'money_out',date:'2026-10-05',holder:'1011',account:'5010',payee:'Mill',amount:13000},{by:'ammar',byName:'Ammar',at:T+1,reason:'wrong amount'});
  await check('the builder\'s edit: rev 2, one row by Ammar naming amount',async()=>{
    if(!(j1e&&j1e.rev===2&&j1e.edits.length===1&&j1e.edits[0].by==='ammar'&&J(j1e.edits[0].fields)===J(['amount'])))throw new Error(J(j1e));
  });
  await check('a malformed edit is refused: rev not +1, edits not grown by exactly one, a row by someone else, a changed party',async()=>{
    const a=Object.assign({},j1e,{edits:[]});await assertFails(setDoc(doc(as('ammar'),pathOf(j1)),a));
    const b=Object.assign({},j1e,{edits:j1e.edits.concat(j1e.edits)});await assertFails(setDoc(doc(as('ammar'),pathOf(j1)),b));
    const c=Object.assign({},j1e,{rev:3});await assertFails(setDoc(doc(as('ammar'),pathOf(j1)),c));
    const d=Object.assign({},j1e);await assertFails(setDoc(doc(as('afnan'),pathOf(j1)),d)); // the row says ammar
    const e=Object.assign({},j1e,{party:'P-0001'});await assertFails(setDoc(doc(as('ammar'),pathOf(j1)),e));
  });
  await check('an edit changing a field it does not name, or naming one it did not change, is refused',async()=>{
    const a=JSON.parse(J(j1e));a.note='sneaky';await assertFails(setDoc(doc(as('ammar'),pathOf(j1)),a));
    const b=JSON.parse(J(j1e));b.edits[0].fields=['amount','note'];await assertFails(setDoc(doc(as('ammar'),pathOf(j1)),b));
  });
  for(const k of [{by:'ammar'},{ts:1},{kind:'money_in'},{status:'void'},{no:'JV-27-0999'},{source:'import'}]){
    await check('an edit cannot change '+J(k),()=>assertFails(setDoc(doc(as('ammar'),pathOf(j1)),Object.assign({},j1e,k))));
  }
  await check('the valid edit passes',()=>assertSucceeds(setDoc(doc(as('ammar'),pathOf(j1)),j1e)));
  await check('a second edit, on top of the first, passes (rev 3, two rows)',async()=>{
    const e2=edit(j1e,{kind:'money_out',date:'2026-10-05',holder:'1011',account:'5010',payee:'Mill',amount:13000,note:'invoice 44'},{by:'afnan',byName:'Afnan',at:T+2,reason:'note'});
    if(e2.rev!==3||e2.edits.length!==2)throw new Error(J(e2));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(j1)),e2));
  });
  // M1.6a: a transfer waiting for Ammar (trB) keeps its amount; one that
  // needs nobody (Afnan's cash into MCB) is edited as any document is.
  const trN=build('transfer',{date:'2026-10-06',from:'1011',to:'1020',amount:9000},meta('afnan'));
  await check('a transfer nobody has to confirm: its amount is edited (named); Mustafa cannot edit one',async()=>{
    if(!(trN.status==='posted'&&trN.confirmBy===null))throw new Error(J(trN));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(trN)),trN));
    const e=edit(trN,{date:'2026-10-06',from:'1011',to:'1020',amount:9500},{by:'afnan',at:T+1,reason:'x'});
    await assertFails(setDoc(doc(as('mustafa'),pathOf(trN)),e));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(trN)),e));
  });
  await check('M1.6a: a transfer waiting for Ammar cannot have its amount edited — void it and record it again',async()=>{
    const e=edit(trB,{date:'2026-10-06',from:'1011',to:'1012',amount:7500},{by:'afnan',at:T+1,reason:'x'});
    await assertFails(setDoc(doc(as('afnan'),pathOf(trB)),e));
  });

  console.log('an edit never moves a status or a confirmation (M1.6a, money F6)');
  const TIN={date:'2026-10-05',from:'1011',to:'1012',amount:5000};
  const tp=build('transfer',TIN,meta('afnan'));                       // waits for Ammar
  await check('a note on a transfer waiting for Ammar: it stays waiting, for Ammar',async()=>{
    await seed(pathOf(tp),tp);
    const e=edit(tp,Object.assign({},TIN,{note:'in an envelope'}),{by:'afnan',byName:'Afnan',at:T+1,reason:'note'});
    if(!(e.status==='pending'&&e.confirmBy==='ammar'&&e.confirmPaper===false&&J(e.edits[0].fields)===J(['note'])))throw new Error(J(e));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(tp)),e));
  });
  for(const [f,v] of [['amount',7500],['date','2026-10-06'],['from','1020']]){
    await check('M1.6a: a transfer waiting for Ammar cannot change its '+f+' (named in the row)',async()=>{
      await seed(pathOf(tp),tp);
      const e=edit(tp,Object.assign({},TIN,{[f]:v}),{by:'afnan',at:T+2,reason:'x'});
      if(J(e.edits[0].fields)!==J([f]))throw new Error(J(e.edits[0].fields));
      await assertFails(setDoc(doc(as('afnan'),pathOf(tp)),e));
    });
  }
  await check('M1.6a: …nor its receiver (1012 → 1040, leaving the confirmation owed by Ammar)',async()=>{
    await seed(pathOf(tp),tp);
    const e=edit(tp,Object.assign({},TIN,{to:'1040'}),{by:'afnan',at:T+2,reason:'x'});
    await assertFails(setDoc(doc(as('afnan'),pathOf(tp)),e));
  });
  await check('an edit cannot touch a confirmation field (confirmPaper, confirmedBy)',async()=>{
    await seed(pathOf(tp),tp);
    const e=edit(tp,Object.assign({},TIN,{note:'x'}),{by:'afnan',at:T+2,reason:'x'});
    await assertFails(setDoc(doc(as('afnan'),pathOf(tp)),Object.assign({},e,{confirmPaper:true})));
    await assertFails(setDoc(doc(as('afnan'),pathOf(tp)),Object.assign({},e,{confirmedBy:'ammar'})));
  });
  const tc=build('transfer',TIN,meta('afnan'));
  Object.assign(tc,confirm(tc,'ammar',{at:T+3}).patch);               // Ammar confirmed it
  await check('a note on a transfer Ammar confirmed: it stays posted, and confirmed by Ammar',async()=>{
    await seed(pathOf(tc),tc);
    const e=edit(tc,Object.assign({},TIN,{note:'receipt 12'}),{by:'afnan',byName:'Afnan',at:T+4,reason:'note'});
    if(!(e.status==='posted'&&e.confirmedBy==='ammar'&&e.confirmVia==='app'&&e.confirmBy==='ammar'&&J(e.edits[0].fields)===J(['note'])))throw new Error(J(e));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(tc)),e));
  });
  await check('M1.6a: a transfer Ammar confirmed cannot change its amount, even named',async()=>{
    await seed(pathOf(tc),tc);
    const e=edit(tc,Object.assign({},TIN,{amount:500000}),{by:'afnan',at:T+4,reason:'x'});
    await assertFails(setDoc(doc(as('afnan'),pathOf(tc)),e));
  });
  await check('M1.6a: …nor under a row that names only its note (₨5,000 → ₨5,00,000)',async()=>{
    await seed(pathOf(tc),tc);
    const e=edit(tc,Object.assign({},TIN,{note:'.'}),{by:'afnan',at:T+4,reason:'x'});
    e.amount=500000;
    await assertFails(setDoc(doc(as('afnan'),pathOf(tc)),e));
  });
  await check('M1.6a: an edit cannot send a confirmed transfer back to waiting (the old edit\'s shape)',async()=>{
    await seed(pathOf(tc),tc);
    const e=edit(tc,Object.assign({},TIN,{note:'receipt 12'}),{by:'afnan',at:T+4,reason:'note'});
    e.status='pending';
    await assertFails(setDoc(doc(as('afnan'),pathOf(tc)),e));
  });
  const tn=build('transfer',{date:'2026-10-05',from:'1011',to:'1020',amount:90000},meta('afnan'));   // needs nobody
  await check('M1.6a: a transfer nobody had to confirm cannot be edited into waiting (it would post nothing, and nobody could confirm it)',async()=>{
    await seed(pathOf(tn),tn);
    const e=edit(tn,{date:'2026-10-05',from:'1011',to:'1020',amount:90000,note:'x'},{by:'ammar',at:T+5,reason:'x'});
    e.status='pending';
    await assertFails(setDoc(doc(as('ammar'),pathOf(tn)),e));
  });
  await check('M1.6a: …nor re-routed out of the drawer, where Raees must confirm (an edit cannot start a confirmation)',async()=>{
    await seed(pathOf(tn),tn);
    const e=edit(tn,{date:'2026-10-05',from:'1010',to:'1020',amount:90000},{by:'afnan',at:T+5,reason:'x'});
    if(!(J(e.edits[0].fields)===J(['from'])&&e.status==='posted'&&e.confirmBy===null))throw new Error(J(e));
    await assertFails(setDoc(doc(as('afnan'),pathOf(tn)),e));
  });
  await check('…but it can be re-routed where nobody has to confirm (Ammar\'s cash into MCB)',async()=>{
    await seed(pathOf(tn),tn);
    const e=edit(tn,{date:'2026-10-05',from:'1012',to:'1020',amount:90000},{by:'afnan',at:T+5,reason:'it was Ammar\'s cash'});
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(tn)),e));
  });
  // A handover recorded before M1.6a, when the drawer posted at once.
  const legacy=build('transfer',{date:'2026-10-05',from:'1011',to:'1010',amount:25000},meta('afnan'));
  Object.assign(legacy,{status:'posted',confirmBy:null,confirmPaper:false,confirmVia:'store'});
  await check('a drawer handover recorded before M1.6a (posted at once) still takes a note, as it was',async()=>{
    await seed(pathOf(legacy),legacy);
    const e=edit(legacy,{date:'2026-10-05',from:'1011',to:'1010',amount:25000,note:'Raees has it'},{by:'afnan',at:T+6,reason:'note'});
    if(!(e.status==='posted'&&e.confirmVia==='store'&&e.confirmBy===null))throw new Error(J(e));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(legacy)),e));
  });
  await check('M1.6a: …but not a new amount — the map says Raees confirms it, so it is voided and recorded again',async()=>{
    await seed(pathOf(legacy),legacy);
    const e=edit(legacy,{date:'2026-10-05',from:'1011',to:'1010',amount:30000},{by:'afnan',at:T+6,reason:'x'});
    await assertFails(setDoc(doc(as('afnan'),pathOf(legacy)),e));
  });
  const tu=build('transfer',{date:'2026-10-06',from:'1011',to:'1040',amount:3000},meta('afnan'));
  Object.assign(tu,confirm(tu,'afnan',{at:T+7}).patch);               // confirmed on paper for Umair
  await check('M1.6a: a transfer confirmed on paper for Umair cannot be re-pointed at Ammar and stay posted',async()=>{
    await seed(pathOf(tu),tu);
    const e=edit(tu,{date:'2026-10-06',from:'1011',to:'1012',amount:3000},{by:'afnan',at:T+8,reason:'x'});
    await assertFails(setDoc(doc(as('afnan'),pathOf(tu)),e));
  });

  console.log('an edit that moves money names it (M1.6a, security F1)');
  const JIN={kind:'money_out',date:'2026-10-05',holder:'1011',account:'5010',payee:'Mill',amount:12000};
  const jm=build('journal',JIN,meta('afnan'));
  await check('an amount edit that names amount passes',async()=>{
    await seed(pathOf(jm),jm);
    const e=edit(jm,Object.assign({},JIN,{amount:13000}),{by:'afnan',at:T+1,reason:'the bill'});
    if(J(e.edits[0].fields)!==J(['amount']))throw new Error(J(e.edits[0]));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(jm)),e));
  });
  await check('M1.6a: an amount changed under a row that names only the note is refused (₨12,000 → ₨1,20,000)',async()=>{
    await seed(pathOf(jm),jm);
    const e=edit(jm,Object.assign({},JIN,{note:'typo fixed'}),{by:'afnan',at:T+1,reason:'typo'});
    e.amount=120000;
    await assertFails(setDoc(doc(as('afnan'),pathOf(jm)),e));
  });
  await check('M1.6a: a tax block rewritten (withholding 50%) under a row that names only the note is refused',async()=>{
    await seed(pathOf(jm),jm);
    const e=edit(jm,Object.assign({},JIN,{note:'x'}),{by:'afnan',at:T+1,reason:'x'});
    e.tax={kind:'withholding',rate:50,inclusive:true,claimable:false,amount:6000};
    await assertFails(setDoc(doc(as('afnan'),pathOf(jm)),e));
  });
  await check('a day moved to another month carries that month',async()=>{
    await seed(pathOf(jm),jm);
    const e=edit(jm,Object.assign({},JIN,{date:'2026-11-05'}),{by:'afnan',at:T+1,reason:'day'});
    if(!(e.month==='2026-11'&&e.quarter===jm.quarter))throw new Error(J([e.month,e.quarter]));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(jm)),e));
  });
  await check('M1.6a: …and one that leaves the month label behind is refused (the pages sum by month)',async()=>{
    await seed(pathOf(jm),jm);
    const e=edit(jm,Object.assign({},JIN,{date:'2026-11-05'}),{by:'afnan',at:T+1,reason:'day'});
    e.month='2026-10';
    await assertFails(setDoc(doc(as('afnan'),pathOf(jm)),e));
  });

  console.log('a count edit keeps its book unless the day or the count moves (M1.6a, money F2)');
  const CIN={date:'2026-10-07',holder:'1011',counted:40000};
  const cc=build('count',CIN,Object.assign(meta('afnan'),{bookBalance:41000}));
  await check('a note on a count keeps its book, its difference and its amount',async()=>{
    await seed(pathOf(cc),cc);
    const e=editCount(cc,Object.assign({},CIN,{note:'recounted, the same'}),0,{by:'afnan',at:T+1,reason:'note'});
    if(!(e.bookBalance===41000&&e.difference===-1000&&e.amount===1000&&J(e.edits[0].fields)===J(['note'])))throw new Error(J(e));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(cc)),e));
  });
  await check('M1.6a: a note-only edit that re-reads the book (the old writer\'s shape) is refused',async()=>{
    await seed(pathOf(cc),cc);
    const e=editCount(cc,Object.assign({},CIN,{note:'x'}),0,{by:'afnan',at:T+1,reason:'x'});
    Object.assign(e,{bookBalance:0,difference:40000,amount:40000});   // book re-read, difference re-derived, the row says "note"
    await assertFails(setDoc(doc(as('afnan'),pathOf(cc)),e));
  });
  await check('M1.6a: a difference of −₨1,000 rewritten to −₨4,00,000 under a note is refused',async()=>{
    await seed(pathOf(cc),cc);
    const e=editCount(cc,Object.assign({},CIN,{note:'x'}),0,{by:'afnan',at:T+1,reason:'x'});
    Object.assign(e,{difference:-400000,amount:400000,bookBalance:440000});
    await assertFails(setDoc(doc(as('afnan'),pathOf(cc)),e));
  });
  // The count clause itself (maCountOk on the edit, and the book moving only
  // with the day or the count): two forgeries that keep the AMOUNT the same,
  // so the naming rule alone would let them through.
  await check('M1.6a: a count\'s shortage flipped to an excess under a note, its amount left alone, is refused',async()=>{
    await seed(pathOf(cc),cc);
    const e=editCount(cc,Object.assign({},CIN,{note:'x'}),0,{by:'afnan',at:T+1,reason:'x'});
    Object.assign(e,{difference:1000});   // −₨1,000 → +₨1,000: the posting changes side, the amount does not
    await assertFails(setDoc(doc(as('afnan'),pathOf(cc)),e));
  });
  await check('M1.6a: a note-only edit that moves the book and the difference together, keeping the amount, is refused',async()=>{
    await seed(pathOf(cc),cc);
    const e=editCount(cc,Object.assign({},CIN,{note:'x'}),0,{by:'afnan',at:T+1,reason:'x'});
    Object.assign(e,{bookBalance:39000,difference:1000});   // consistent with each other — but nothing named moved the book
    await assertFails(setDoc(doc(as('afnan'),pathOf(cc)),e));
  });
  await check('a recount names counted and amount, and is held against the book as it stands',async()=>{
    await seed(pathOf(cc),cc);
    const e=editCount(cc,Object.assign({},CIN,{counted:40500}),41000,{by:'afnan',at:T+1,reason:'recount'});
    if(!(e.bookBalance===41000&&e.difference===-500&&e.amount===500&&J(e.edits[0].fields)===J(['counted','amount'])))throw new Error(J(e));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(cc)),e));
  });
  await check('a recount against a book that moved since is allowed too — the count is named',async()=>{
    await seed(pathOf(cc),cc);
    const e=editCount(cc,Object.assign({},CIN,{counted:40500}),41500,{by:'afnan',at:T+1,reason:'recount'});
    if(!(e.bookBalance===41500&&e.difference===-1000&&J(e.edits[0].fields)===J(['counted'])))throw new Error(J(e));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(cc)),e));
  });
  await check('a count moved to another day takes that day\'s book, naming the day',async()=>{
    await seed(pathOf(cc),cc);
    const e=editCount(cc,Object.assign({},CIN,{date:'2026-10-08'}),42000,{by:'afnan',at:T+1,reason:'day'});
    if(!(e.bookBalance===42000&&e.difference===-2000&&e.edits[0].fields.indexOf('date')>=0))throw new Error(J(e));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(cc)),e));
  });

  console.log('an edit stores its own flags, and a moved figure clears the review (M1.6a, money F8)');
  const jr=build('journal',Object.assign({},JIN,{amount:1000}),meta('afnan'));
  await check('an edit may store the flags it raised — flags are the edit\'s own now',async()=>{
    await seed(pathOf(jr),jr);
    const e=edit(jr,Object.assign({},JIN,{amount:95000}),{by:'afnan',at:T+1,reason:'the bill',flags:[{rule:'evidence.missing',message:'No bill or receipt attached (₨95,000).',field:'attachments'}]});
    if(!(Array.isArray(e.flags)&&e.flags.length===1))throw new Error(J(e.flags));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(jr)),e));
  });
  const jrv=Object.assign({},jr,{reviewedAt:T+2,reviewedBy:'ammar'});   // reviewed by Ammar
  await check('a reviewed document whose amount moves has its review cleared — and that edit passes',async()=>{
    await seed(pathOf(jrv),jrv);
    const e=shaped(jrv,Object.assign({},JIN,{amount:95000}),{by:'afnan',byName:'Afnan',at:T+3,reason:'the bill'});
    if(!(e.reviewedAt===null&&e.reviewedBy===null))throw new Error(J([e.reviewedAt,e.reviewedBy]));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(jrv)),e));
  });
  await check('M1.6a: a reviewed document whose amount moves cannot KEEP its review ("reviewedBy still ammar")',async()=>{
    await seed(pathOf(jrv),jrv);
    const e=shaped(jrv,Object.assign({},JIN,{amount:95000}),{by:'afnan',byName:'Afnan',at:T+3,reason:'the bill'});
    Object.assign(e,{reviewedAt:T+2,reviewedBy:'ammar'});
    await assertFails(setDoc(doc(as('afnan'),pathOf(jrv)),e));
  });
  await check('a note on a reviewed document keeps its review',async()=>{
    await seed(pathOf(jrv),jrv);
    const e=shaped(jrv,Object.assign({},JIN,{amount:1000,note:'receipt 7'}),{by:'afnan',byName:'Afnan',at:T+3,reason:'note'});
    if(!(e.reviewedBy==='ammar'&&e.reviewedAt===T+2))throw new Error(J([e.reviewedAt,e.reviewedBy]));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(jrv)),e));
  });
  await check('an edit cannot SET a review — the review path alone does',async()=>{
    await seed(pathOf(jr),jr);
    const e=edit(jr,Object.assign({},JIN,{amount:1000,note:'x'}),{by:'afnan',at:T+4,reason:'x'});
    await assertFails(setDoc(doc(as('afnan'),pathOf(jr)),Object.assign({},e,{reviewedAt:T+4,reviewedBy:'afnan'})));
  });

  console.log('documents — void');
  const ctv=voided(ct,{by:'ammar',byName:'Ammar',at:T+3,reason:'counted the wrong drawer'});
  await check('a void by someone else\'s name is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(ct)),ctv)));
  await check('a void with no reason is refused',async()=>{
    await assertFails(setDoc(doc(as('ammar'),pathOf(ct)),voided(ct,{by:'ammar',at:T+3,reason:'  '})));
  });
  await check('a void that also rewrites the document is refused',async()=>{
    await assertFails(setDoc(doc(as('ammar'),pathOf(ct)),Object.assign({},ctv,{counted:1})));
  });
  await check('Ammar voids the count',()=>assertSucceeds(setDoc(doc(as('ammar'),pathOf(ct)),ctv)));
  await check('un-voiding is refused',async()=>{
    await assertFails(setDoc(doc(as('ammar'),pathOf(ct)),ct));
    await assertFails(updateDoc(doc(as('ammar'),pathOf(ct)),{status:'posted'}));
  });
  await check('a void document cannot be edited',async()=>{
    const e=edit(ctv,{date:'2026-10-07',holder:'1011',counted:40500},{by:'ammar',at:T+4,reason:'x'});
    await assertFails(setDoc(doc(as('ammar'),pathOf(ct)),Object.assign({},e,{status:'void'})));
  });
  await check('a void document cannot be voided again',()=>assertFails(setDoc(doc(as('ammar'),pathOf(ct)),voided(ctv,{by:'ammar',at:T+5,reason:'again'}))));

  console.log('transfers — confirm');
  await check('the builder refuses Afnan confirming a transfer named for Ammar',async()=>{
    const r=confirm(trA,'afnan',{at:T+6});if(!r.error)throw new Error(J(r));
  });
  await check('Afnan confirming Ammar\'s transfer "in the app" is refused by the rules',()=>
    assertFails(updateDoc(doc(as('afnan'),pathOf(trA)),{status:'posted',confirmedBy:'afnan',confirmedAt:T+6,confirmVia:'app'})));
  await check('Afnan confirming Ammar\'s transfer "on paper" is refused (not a paper transfer)',()=>
    assertFails(updateDoc(doc(as('afnan'),pathOf(trA)),{status:'posted',confirmedBy:'afnan',confirmedAt:T+6,confirmedFor:'ammar',confirmVia:'paper'})));
  await check('a confirm that also changes the amount is refused',async()=>{
    const p=confirm(trA,'ammar',{at:T+6}).patch;
    await assertFails(updateDoc(doc(as('ammar'),pathOf(trA)),Object.assign({},p,{amount:1})));
  });
  await check('Ammar confirms his own transfer in the app',async()=>{
    const p=confirm(trA,'ammar',{at:T+6}).patch;
    await assertSucceeds(updateDoc(doc(as('ammar'),pathOf(trA)),p));
  });
  await check('a posted transfer cannot be confirmed again',()=>
    assertFails(updateDoc(doc(as('ammar'),pathOf(trA)),{confirmedAt:T+7})));
  await check('Afnan confirms Umair\'s transfer on paper (confirmPaper)',async()=>{
    const r=confirm(trU,'afnan',{at:T+6});
    if(!r.patch||r.patch.confirmVia!=='paper')throw new Error(J(r));
    await assertSucceeds(updateDoc(doc(as('afnan'),pathOf(trU)),r.patch));
  });

  console.log('documents — review');
  await check('an owner marks a document reviewed in their own name',()=>
    assertSucceeds(updateDoc(doc(as('afnan'),pathOf(j1)),{reviewedAt:T+8,reviewedBy:'afnan'})));
  await check('a review in someone else\'s name is refused',()=>
    assertFails(updateDoc(doc(as('afnan'),pathOf(j1)),{reviewedAt:T+9,reviewedBy:'ammar'})));
  await check('Mustafa cannot review',()=>
    assertFails(updateDoc(doc(as('mustafa'),pathOf(j1)),{reviewedAt:T+9,reviewedBy:'mustafa'})));

  console.log('the period lock');
  const q1=jv('afnan',{date:'2026-08-10'});                 // FY27 Q1, before the close
  const q1b=jv('afnan',{date:'2026-09-01'});
  await check('before the close, a Q1 journal is written',async()=>{
    if(q1.quarter!=='2027-Q1')throw new Error(q1.quarter);
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(q1)),q1));
  });
  const tq1=build('transfer',{date:'2026-09-01',from:'1011',to:'1012',amount:4000},meta('afnan'));   // waits for Ammar, in Q1
  await check('before the close, a Q1 transfer to Ammar is recorded (waiting)',()=>assertSucceeds(setDoc(doc(as('afnan'),pathOf(tq1)),tq1)));
  await check('M1.6a: a close born UNLOCKED is refused — it could never be locked afterwards',()=>
    assertFails(setDoc(doc(as('afnan'),'ma_closes/2027-Q3'),{quarter:'2027-Q3',locked:false,closedBy:'afnan',closedAt:T})));
  await check('Mustafa cannot close a quarter; a close in someone else\'s name is refused',async()=>{
    await assertFails(setDoc(doc(as('mustafa'),'ma_closes/2027-Q1'),{quarter:'2027-Q1',locked:true,closedBy:'mustafa',closedAt:T}));
    await assertFails(setDoc(doc(as('afnan'),'ma_closes/2027-Q1'),{quarter:'2027-Q1',locked:true,closedBy:'ammar',closedAt:T}));
    await assertFails(setDoc(doc(as('afnan'),'ma_closes/2027-Q9'),{quarter:'2027-Q9',locked:true,closedBy:'afnan',closedAt:T}));
  });
  await check('Afnan locks 2027-Q1',()=>assertSucceeds(setDoc(doc(as('afnan'),'ma_closes/2027-Q1'),{quarter:'2027-Q1',locked:true,closedBy:'afnan',closedAt:T})));
  await check('Mustafa cannot read a close',()=>assertFails(getDoc(doc(as('mustafa'),'ma_closes/2027-Q1'))));
  await check('a journal dated in the locked quarter is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(q1b)),q1b)));
  await check('an edit of a document in the locked quarter is refused',async()=>{
    const e=edit(q1,{kind:'money_out',date:'2026-08-10',holder:'1011',account:'5010',payee:'Mill',amount:1},{by:'afnan',at:T+1,reason:'x'});
    await assertFails(setDoc(doc(as('afnan'),pathOf(q1)),e));
  });
  await check('an edit moving an open-quarter document INTO the locked quarter is refused',async()=>{
    // trN needs nobody's confirmation, so its day may move — only the lock refuses this.
    const cur=await stored(pathOf(trN));
    const e=edit(Object.assign({},cur),{date:'2026-09-20',from:'1011',to:'1020',amount:9500},{by:'afnan',at:T+2,reason:'wrong month'});
    if(e.quarter!=='2027-Q1'||J(e.edits[e.edits.length-1].fields)!==J(['date']))throw new Error(J([e.quarter,e.edits]));
    await assertFails(setDoc(doc(as('afnan'),pathOf(trN)),e));
  });
  await check('a void of a document in the locked quarter is refused',()=>
    assertFails(setDoc(doc(as('afnan'),pathOf(q1)),voided(q1,{by:'afnan',at:T+3,reason:'x'}))));
  await check('a confirm of a transfer dated in the locked quarter is refused',async()=>{
    const p=confirm(tq1,'ammar',{at:T+3}).patch;
    await assertFails(updateDoc(doc(as('ammar'),pathOf(tq1)),p));
  });
  await check('M1.6a: a review of a document in the locked quarter is refused (security F3b)',async()=>{
    await seed(pathOf(q1),q1);
    await assertFails(updateDoc(doc(as('ammar'),pathOf(q1)),{reviewedAt:T+3,reviewedBy:'ammar'}));
  });
  await check('M1.6a: …and so is an un-review',async()=>{
    await seed(pathOf(q1),Object.assign({},q1,{reviewedAt:T,reviewedBy:'ammar'}));
    await assertFails(updateDoc(doc(as('afnan'),pathOf(q1)),{reviewedAt:null,reviewedBy:'afnan'}));
  });
  await seed(pathOf(q1),q1);
  await check('a close cannot be deleted, unlocked in place, or reopened without a reason / in another\'s name',async()=>{
    await assertFails(deleteDoc(doc(as('afnan'),'ma_closes/2027-Q1')));
    await assertFails(updateDoc(doc(as('afnan'),'ma_closes/2027-Q1'),{locked:false}));
    await assertFails(updateDoc(doc(as('ammar'),'ma_closes/2027-Q1'),{reopenedAt:T+4,reopenedBy:'ammar',reopenReason:''}));
    await assertFails(updateDoc(doc(as('ammar'),'ma_closes/2027-Q1'),{reopenedAt:T+4,reopenedBy:'afnan',reopenReason:'late bill'}));
    await assertFails(updateDoc(doc(as('mustafa'),'ma_closes/2027-Q1'),{reopenedAt:T+4,reopenedBy:'mustafa',reopenReason:'late bill'}));
  });
  await check('Ammar reopens 2027-Q1 with a reason',()=>
    assertSucceeds(updateDoc(doc(as('ammar'),'ma_closes/2027-Q1'),{reopenedAt:T+4,reopenedBy:'ammar',reopenReason:'late bill'})));
  await check('a reopened close cannot be reopened again',()=>
    assertFails(updateDoc(doc(as('afnan'),'ma_closes/2027-Q1'),{reopenedAt:T+5,reopenedBy:'afnan',reopenReason:'again'})));
  await check('in the reopened quarter, a journal is written again',()=>assertSucceeds(setDoc(doc(as('afnan'),pathOf(q1b)),q1b)));

  console.log('re-locking a reopened quarter — in one batch with its audit row (M1.6a, security F3b)');
  const relockBatch=async(who,q,r,auditId,patchOver)=>{
    const db=as(who);const b=writeBatch(db);
    b.set(doc(db,'ma_audit/'+auditId),r.audit);
    b.update(doc(db,'ma_closes/'+q),Object.assign({},r.patch,patchOver||{}));
    return b.commit();
  };
  await check('a re-lock with no audit row is refused',async()=>{
    const r=relock(await stored('ma_closes/2027-Q1'),{by:'afnan',byName:'Afnan',at:NOW(),auditId:'rl-none-'+NOW()});
    await assertFails(updateDoc(doc(as('afnan'),'ma_closes/2027-Q1'),r.patch));
  });
  await check('a re-lock pointing at an audit row written EARLIER is refused — the row must be new in this write',async()=>{
    const id='rl-old-'+NOW();
    const r=relock(await stored('ma_closes/2027-Q1'),{by:'afnan',byName:'Afnan',at:NOW(),auditId:id});
    await assertSucceeds(setDoc(doc(as('afnan'),'ma_audit/'+id),r.audit));
    await assertFails(updateDoc(doc(as('afnan'),'ma_closes/2027-Q1'),r.patch));
  });
  await check('a re-lock that drops the reopen it ends is refused',async()=>{
    const id='rl-drop-'+NOW();
    const r=relock(await stored('ma_closes/2027-Q1'),{by:'afnan',byName:'Afnan',at:NOW(),auditId:id});
    await assertFails(relockBatch('afnan','2027-Q1',r,id,{reopens:[]}));
  });
  await check('a re-lock in someone else\'s name is refused',async()=>{
    const id='rl-name-'+NOW();
    const r=relock(await stored('ma_closes/2027-Q1'),{by:'afnan',byName:'Afnan',at:NOW(),auditId:id});
    await assertFails(relockBatch('afnan','2027-Q1',r,id,{closedBy:'ammar'}));
  });
  await check('Mustafa cannot re-lock a quarter',async()=>{
    const id='rl-must-'+NOW();
    const r=relock(await stored('ma_closes/2027-Q1'),{by:'mustafa',byName:'Mustafa',at:NOW(),auditId:id});
    await assertFails(relockBatch('mustafa','2027-Q1',r,id));
  });
  await check('Afnan re-locks 2027-Q1: the close and its audit row in one batch; the reopen is kept in `reopens`',async()=>{
    const id='rl-1-'+NOW();
    const r=relock(await stored('ma_closes/2027-Q1'),{by:'afnan',byName:'Afnan',at:NOW(),auditId:id,reason:'late bill booked'});
    if(!(r.audit.action==='relock'&&r.audit.target.dt==='close'&&r.audit.target.id==='2027-Q1'))throw new Error(J(r.audit));
    await assertSucceeds(relockBatch('afnan','2027-Q1',r,id));
    const c=await stored('ma_closes/2027-Q1');
    if(!(c.locked===true&&c.reopenedAt===null&&c.closedBy==='afnan'&&c.reopens.length===1&&c.reopens[0].by==='ammar'&&c.reopens[0].reason==='late bill'))throw new Error(J(c));
  });
  await check('the re-locked quarter refuses a journal again',async()=>{
    const q1c=jv('afnan',{date:'2026-08-12'});
    await assertFails(setDoc(doc(as('afnan'),pathOf(q1c)),q1c));
  });
  await check('a quarter that is locked cannot be "re-locked" again',async()=>{
    const id='rl-2-'+NOW();
    const r=relock(await stored('ma_closes/2027-Q1'),{by:'ammar',byName:'Ammar',at:NOW(),auditId:id});
    await assertFails(relockBatch('ammar','2027-Q1',r,id));
  });
  await check('reopened and re-locked again, the close keeps BOTH reopens',async()=>{
    await assertSucceeds(updateDoc(doc(as('afnan'),'ma_closes/2027-Q1'),{reopenedAt:T+30,reopenedBy:'afnan',reopenReason:'a second late bill'}));
    const id='rl-3-'+NOW();
    const r=relock(await stored('ma_closes/2027-Q1'),{by:'ammar',byName:'Ammar',at:NOW(),auditId:id});
    await assertSucceeds(relockBatch('ammar','2027-Q1',r,id));
    const c=await stored('ma_closes/2027-Q1');
    if(!(c.locked===true&&c.reopens.length===2&&c.reopens[1].by==='afnan'&&c.closedBy==='ammar'))throw new Error(J(c));
  });
  await check('a close born unlocked before M1.6a is locked through the same audited re-lock',async()=>{
    await seed('ma_closes/2027-Q4',{quarter:'2027-Q4',locked:false,closedBy:'afnan',closedAt:T});
    const id='rl-4-'+NOW();
    const r=relock(await stored('ma_closes/2027-Q4'),{by:'afnan',byName:'Afnan',at:NOW(),auditId:id});
    await assertSucceeds(relockBatch('afnan','2027-Q4',r,id));
    const c=await stored('ma_closes/2027-Q4');
    if(!(c.locked===true&&Array.isArray(c.reopens)&&c.reopens.length===0))throw new Error(J(c));
  });

  console.log('the audit trail — append-only, and written now');
  const row=audit('post',j1,{by:'afnan',byName:'Afnan',at:NOW(),detail:'posted'});
  await check('an owner appends an audit row the builder made',()=>assertSucceeds(setDoc(doc(as('afnan'),'ma_audit/a1'),row)));
  await check('a row in someone else\'s name, or with no time, is refused',async()=>{
    await assertFails(setDoc(doc(as('ammar'),'ma_audit/a2'),Object.assign({},row,{at:NOW()})));
    await assertFails(setDoc(doc(as('afnan'),'ma_audit/a3'),Object.assign({},row,{at:'now'})));
  });
  await check('a row four minutes either side of the server\'s clock passes — a phone a little out still records',async()=>{
    await assertSucceeds(setDoc(doc(as('afnan'),'ma_audit/a5'),Object.assign({},row,{at:NOW()-240000})));
    await assertSucceeds(setDoc(doc(as('afnan'),'ma_audit/a6'),Object.assign({},row,{at:NOW()+240000})));
  });
  await check('M1.6a: a row back-dated to 0 — "Voided by Ammar", written by Afnan — is refused (security F3)',()=>
    assertFails(setDoc(doc(as('afnan'),'ma_audit/a7'),Object.assign({},row,{at:0,action:'void',byName:'Ammar',detail:'Voided by Ammar'}))));
  await check('M1.6a: a row stamped six minutes ago is refused',()=>
    assertFails(setDoc(doc(as('afnan'),'ma_audit/a8'),Object.assign({},row,{at:NOW()-360000}))));
  await check('M1.6a: a row stamped six minutes ahead is refused',()=>
    assertFails(setDoc(doc(as('afnan'),'ma_audit/a9'),Object.assign({},row,{at:NOW()+360000}))));
  await check('an audit row cannot be updated or deleted, even by an owner',async()=>{
    await assertFails(updateDoc(doc(as('afnan'),'ma_audit/a1'),{detail:'nothing happened'}));
    await assertFails(deleteDoc(doc(as('afnan'),'ma_audit/a1')));
  });
  await check('Mustafa, Raees and signed-out cannot read the trail or write to it',async()=>{
    await assertFails(getDoc(doc(as('mustafa'),'ma_audit/a1')));
    await assertFails(getDoc(doc(as('raees'),'ma_audit/a1')));
    await assertFails(getDoc(doc(anon(),'ma_audit/a1')));
    await assertFails(setDoc(doc(as('mustafa'),'ma_audit/a4'),Object.assign({},row,{by:'mustafa'})));
  });

  console.log('backups — server only');
  await seed('ma_backups/2026-10-05',{at:T,ok:true,collections:12});
  await check('an owner reads a backup row',()=>assertSucceeds(getDoc(doc(as('afnan'),'ma_backups/2026-10-05'))));
  await check('no client writes a backup row, not even an owner',async()=>{
    await assertFails(setDoc(doc(as('afnan'),'ma_backups/2026-10-06'),{at:T,ok:true}));
    await assertFails(updateDoc(doc(as('afnan'),'ma_backups/2026-10-05'),{ok:false}));
    await assertFails(deleteDoc(doc(as('afnan'),'ma_backups/2026-10-05')));
  });
  await check('Mustafa cannot read a backup row',()=>assertFails(getDoc(doc(as('mustafa'),'ma_backups/2026-10-05'))));

  console.log('share links — made and withdrawn by the ma-share function only (M1.6a, security F3)');
  // The page never writes ma_shares (tests/master-accounts-files.test.js
  // holds that); the function writes through the Admin SDK, with its audit
  // row in the same write. So no client may write one at all.
  const share={docKind:'journal',docId:j1.no,docNo:j1.no,pdfPublicId:'ma/'+'a'.repeat(64),format:'pdf',resourceType:'image',deliveryType:'authenticated',
    filename:'x.pdf',to:null,createdBy:'afnan',createdAt:NOW(),days:7,expiresAt:NOW()+7*86400000,revoked:false,revokedAt:null,revokedBy:null,opens:0,lastOpenedAt:null,previews:0,lastPreviewAt:null};
  await check('M1.6a: an owner cannot make a share link directly (a token of their choosing, no audit row)',()=>
    assertFails(setDoc(doc(as('afnan'),'ma_shares/'+'A'.repeat(43)),share)));
  await seed('ma_shares/tok1',share);                                // what ma-share writes
  await check('an owner reads a link the function made',()=>assertSucceeds(getDoc(doc(as('afnan'),'ma_shares/tok1'))));
  await check('M1.6a: an owner cannot withdraw a link directly — it goes through ma-share, with its audit row',()=>
    assertFails(updateDoc(doc(as('ammar'),'ma_shares/tok1'),{revoked:true,revokedAt:NOW(),revokedBy:'ammar'})));
  await check('un-revoking, resetting the open count and deleting are refused',async()=>{
    await seed('ma_shares/tok2',Object.assign({},share,{revoked:true,revokedAt:NOW(),revokedBy:'ammar',opens:4}));
    await assertFails(updateDoc(doc(as('afnan'),'ma_shares/tok2'),{revoked:false}));
    await assertFails(updateDoc(doc(as('afnan'),'ma_shares/tok2'),{opens:0}));
    await assertFails(deleteDoc(doc(as('afnan'),'ma_shares/tok1')));
  });
  await check('Mustafa cannot read a share link',()=>assertFails(getDoc(doc(as('mustafa'),'ma_shares/tok1'))));

  console.log('the page writer\'s own shapes (js/master-accounts.js, M1.3 · M1.6a)');
  // The writer stores the core's document plus `flags`; an edit stores the
  // flags IT raised (M1.6a, money F8) and keeps every key the rules do not
  // let an edit touch (_maEditShape) — proven both ways below.
  const jf=jv('afnan',{date:'2026-10-08',amount:5000,payee:'Painter'});
  jf.flags=[{rule:'evidence.missing',message:'No bill or receipt attached (₨5,000).',field:'attachments'}];
  await check('a flagged journal, as the writer stores it, is created',()=>assertSucceeds(setDoc(doc(as('afnan'),pathOf(jf)),jf)));
  const jfIn={kind:'money_out',date:'2026-10-08',holder:'1011',account:'5010',payee:'Painter',amount:5200};
  await check('its edit through _maEditShape passes, storing the flag the edit raised (₨5,200, not the old ₨5,000)',async()=>{
    const e=shaped(jf,jfIn,{by:'afnan',byName:'Afnan',at:T+20,reason:'bill said 5,200',flags:[{rule:'evidence.missing',message:'No bill or receipt attached (₨5,200).',field:'attachments'}]});
    if(!(e.flags&&e.flags.length===1&&/5,200/.test(e.flags[0].message)&&e.rev===2))throw new Error(J(e));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(jf)),e));
  });
  await check('without the shape, a key only the stored document carries is dropped — and the rules refuse that',async()=>{
    const lg=jv('afnan',{date:'2026-10-08',amount:700,payee:'Tea'});lg.importRef='sheet row 12';
    await seed(pathOf(lg),lg);
    const lgIn={kind:'money_out',date:'2026-10-08',holder:'1011',account:'5010',payee:'Tea',amount:750};
    const raw=P('maApplyEdit('+J(lg)+',maBuildDoc("journal",'+J(lgIn)+','+J({by:lg.by,byName:lg.byName,ts:lg.ts})+',IDX,S),'+J(nowRow({by:'afnan',byName:'Afnan',at:T+22,reason:'again'}))+')');
    if(raw.importRef!==undefined)throw new Error('expected the raw edit to drop importRef');
    await assertFails(setDoc(doc(as('afnan'),pathOf(lg)),raw));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(lg)),P('_maEditShape('+J(lg)+','+J(raw)+')')));
  });
  await check('the writer\'s counter document and audit row pass',async()=>{
    await assertSucceeds(setDoc(doc(as('afnan'),'ma_counters/journal'),{FY27:7,updatedAt:T}));
    const row=P('_maClean(maAuditRow("post",{dt:"journal",id:"JV-27-0007",no:"JV-27-0007"},{by:"afnan",byName:"Afnan",at:'+NOW()+',detail:"Money out ₨5,000"}))');
    await assertSucceeds(setDoc(doc(as('afnan'),'ma_audit/w1'),row));
  });

  console.log('files on a document (M1.5b): a reference rides in, or arrives later as an edit');
  // A bill or receipt is a REFERENCE the core cleans (maAttachList) — never
  // a URL. Recorded with the document it is just a field; added afterwards
  // it is an EDIT (rev + 1, one row by the caller naming exactly
  // attachments), which the rules already allow for journal, transfer and
  // count. A file changes no figure, so the rail's edit leaves the stored
  // flags and the review alone; the evidence flag is answered by
  // derivation (maLiveFlags).
  const REF={publicId:'ma/'+'ab'.repeat(32),format:'pdf',type:'authenticated',version:1790000001,bytes:204800,name:'mill-bill.pdf',mime:'application/pdf',by:'afnan',at:T,
    secure_url:'https://res.cloudinary.com/x/image/authenticated/v1/ma/'+'ab'.repeat(32)+'.pdf'};
  const withBill=build('journal',{kind:'money_out',date:'2026-10-09',holder:'1011',account:'5010',payee:'Mill',amount:15000,attachments:[REF]},meta('afnan'));
  await check('a journal recorded WITH its bill is created; the reference carries no URL',async()=>{
    if(!(withBill.attachments.length===1&&!/cloudinary\.com|secure_url/.test(J(withBill.attachments))))throw new Error(J(withBill.attachments));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(withBill)),withBill));
  });
  // The rail's writer, exactly (_maRailAttach): the document as it stands,
  // its files plus the new one, through maApplyEdit and _maEditShape.
  const railAttach=(cur,added,by,at)=>P('_maEditShape('+J(cur)+',maApplyEdit('+J(cur)+',Object.assign({},_maClean('+J(cur)+'),{attachments:maAttachList('+J(cur.attachments||[])+').concat('+J(added)+')}),'+
    J(nowRow({by,byName:by[0].toUpperCase()+by.slice(1),at,reason:'Attached '+added.map(a=>a.name).join(', ')}))+'))');
  const ADD=Object.assign({},REF,{publicId:'ma/'+'cd'.repeat(32),format:'jpg',name:'bill-photo.jpg',mime:'image/jpeg',secure_url:undefined});
  delete ADD.secure_url;
  let jfNow=null;
  await check('attaching a bill to the flagged journal afterwards (the rail\'s edit) passes — flags untouched',async()=>{
    await env.withSecurityRulesDisabled(async c=>{jfNow=(await getDoc(doc(c.firestore(),pathOf(jf)))).data();});
    const e=railAttach(jfNow,[ADD],'ammar',T+40);
    const row=e.edits[e.edits.length-1];
    if(!(e.rev===jfNow.rev+1&&J(row.fields)===J(['attachments'])&&J(e.flags)===J(jfNow.flags)&&e.attachments.length===1))throw new Error(J({rev:e.rev,row,flags:e.flags}));
    await assertSucceeds(setDoc(doc(as('ammar'),pathOf(jf)),e));
    jfNow=e;
  });
  await check('an attach that also SETS a review is refused — the review path alone sets one',async()=>{
    const e=railAttach(jfNow,[Object.assign({},ADD,{publicId:'ma/'+'ef'.repeat(32),name:'second.jpg'})],'afnan',T+41);
    await assertFails(setDoc(doc(as('afnan'),pathOf(jf)),Object.assign({},e,{reviewedAt:T+41,reviewedBy:'afnan'})));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(jf)),e));
    jfNow=e;
  });
  await check('taking a file off again is an edit naming attachments too',async()=>{
    const after=P('Object.assign({},_maClean('+J(jfNow)+'),{attachments:maAttachList('+J(jfNow.attachments)+').slice(1)})');
    const e=P('_maEditShape('+J(jfNow)+',maApplyEdit('+J(jfNow)+','+J(after)+','+J(nowRow({by:'afnan',byName:'Afnan',at:T+42,reason:'wrong photo'}))+'))');
    if(J(e.edits[e.edits.length-1].fields)!==J(['attachments']))throw new Error(J(e.edits[e.edits.length-1]));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(jf)),e));
  });
  await check('a transfer takes a file afterwards the same way',async()=>{
    const tf=build('transfer',{date:'2026-10-09',from:'1011',to:'1040',amount:60000,note:'Float'},meta('afnan'));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(tf)),tf));
    const e=railAttach(tf,[ADD],'afnan',T+43);
    if(!(e.status===tf.status&&J(e.edits[0].fields)===J(['attachments'])))throw new Error(J({status:e.status,row:e.edits[0]}));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(tf)),e));
  });
  await check('Mustafa cannot attach a file to anything',async()=>{
    const e=railAttach(withBill,[ADD],'mustafa',T+44);
    await assertFails(setDoc(doc(as('mustafa'),pathOf(withBill)),e));
  });

  console.log('V3 (29 Sept 2026): codes are strings, amounts whole rupees above zero, an edit row is honest');
  // Every document below is built by the app (maBuildDoc / maApplyEdit),
  // then forged the way the verifier's probe forged it (review-verify
  // fresh-rules.js, A2–A5, B2, C1–C3, C5). Each "V3:" check is a write the
  // rules before V3 ALLOWED; each "V3 control:" is a write the app makes,
  // which must still pass.
  const vT={date:'2026-10-05'};
  const tr=(from,to,amount,by)=>build('transfer',Object.assign({},vT,{from,to,amount}),meta(by));
  const drawerOut=tr('1010','1020',90000,'afnan');
  await check('(the builder: out of the drawer waits for Raees, on paper)',async()=>{
    if(!(drawerOut.status==='pending'&&drawerOut.confirmBy==='raees'&&drawerOut.confirmPaper===true))throw new Error(J(drawerOut));
  });
  const a2=Object.assign({},drawerOut,{from:1010,status:'posted',confirmBy:null,confirmPaper:false});
  await check('V3: a transfer out of the drawer with `from` as the NUMBER 1010, posted at once, is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(a2)),a2)));
  const a5src=tr('1010','1020',90000,'afnan');
  const a5=Object.assign({},a5src,{from:'1010 ',status:'posted',confirmBy:null,confirmPaper:false});
  await check('V3: …nor with `from` "1010 " (a trailing space: no holder at all, money into MCB from nowhere)',()=>assertFails(setDoc(doc(as('afnan'),pathOf(a5)),a5)));
  const toAfnan=tr('1012','1011',5000,'afnan');                     // posts at once: Afnan records money reaching him
  await check('(the builder: Ammar → Afnan recorded by Afnan posts at once)',async()=>{if(!(toAfnan.status==='posted'&&toAfnan.confirmBy===null))throw new Error(J(toAfnan));});
  const a3=Object.assign({},toAfnan,{amount:-500000});
  await check('V3: …at −₨5,00,000 it would post INTO Ammar\'s hands, unconfirmed — refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(a3)),a3)));
  for(const [label,amount] of [['a STRING "5000"','5000'],['₨0',0],['a fraction (₨5,000.50)',5000.5]]){
    const x=Object.assign(tr('1011','1020',5000,'afnan'),{amount});
    await check('V3: a transfer whose amount is '+label+' is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(x)),x)));
  }
  await check('V3 control: the same transfer at ₨5,000 is created',async()=>{const x=tr('1011','1020',5000,'afnan');await assertSucceeds(setDoc(doc(as('afnan'),pathOf(x)),x));});
  const b2=tr('1012','1020',3000,'ammar');                           // Ammar's cash into MCB: nobody confirms
  await check('V3: Afnan editing Ammar\'s posted 1012 → 1020 to −₨3,00,000, the row naming amount, is refused',async()=>{
    await seed(pathOf(b2),b2);
    const e=edit(b2,{date:'2026-10-05',from:'1012',to:'1020',amount:-300000},{by:'afnan',byName:'Afnan',reason:'typo'});
    if(!(e&&J(e.edits[0].fields)===J(['amount'])&&e.amount===-300000))throw new Error(J(e&&e.edits));
    await assertFails(setDoc(doc(as('afnan'),pathOf(b2)),e));
  });
  await check('V3 control: …the same edit to ₨3,500 passes',async()=>{
    await seed(pathOf(b2),b2);
    const e=edit(b2,{date:'2026-10-05',from:'1012',to:'1020',amount:3500},{by:'afnan',byName:'Afnan',reason:'the slip'});
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(b2)),e));
  });
  const MO={kind:'money_out',date:'2026-10-05',holder:'1011',account:'5010',payee:'Mill',amount:12000};
  const mo=o=>Object.assign(build('journal',MO,meta('afnan')),o);
  for(const [label,over] of [['a NEGATIVE amount (−₨12,00,000: money in, not out)',{amount:-1200000}],['a fraction (₨12,000.50)',{amount:12000.5}],
    ['holder "1011 " (a trailing space)',{holder:'1011 '}],['holder as the NUMBER 1011',{holder:1011}],['no holder at all',{holder:undefined}]]){
    const x=mo(over);if(over.holder===undefined&&'holder' in over)delete x.holder;
    await check('V3: a Money out with '+label+' is refused',()=>assertFails(setDoc(doc(as('afnan'),pathOf(x)),x)));
  }
  const CAP={kind:'capital',date:'2026-10-05',holder:'1011',owner:'afnan',amount:50000};
  const capNoHolder=build('journal',CAP,meta('afnan'));delete capNoHolder.holder;
  const cap=build('journal',CAP,meta('afnan'));   // its own number: an attack landing under older rules cannot turn this create into an update
  await check('V3: an "Owner put money in" with no holder is refused (a holder kind names its holder)',()=>assertFails(setDoc(doc(as('afnan'),pathOf(capNoHolder)),capNoHolder)));
  await check('V3 control: …and with its holder it is created',()=>assertSucceeds(setDoc(doc(as('afnan'),pathOf(cap)),cap)));
  const gen=build('journal',{kind:'general',date:'2026-10-05',lines:[{account:'6040',dr:2500},{account:'2010',cr:2500}]},meta('afnan'));
  await check('V3 control: a journal with its own lines (no holder) is created',async()=>{
    if(!(gen.amount===2500&&!('holder' in gen)))throw new Error(J(gen));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(gen)),gen));
  });
  const CT={date:'2026-10-07',holder:'1011'};
  const ct0=build('count',Object.assign({},CT,{counted:41000}),Object.assign(meta('afnan'),{bookBalance:41000}));
  await check('V3 control: a count that matches the book (amount ₨0) is created — a count\'s amount may be zero',async()=>{
    if(!(ct0.amount===0&&ct0.difference===0))throw new Error(J(ct0));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(ct0)),ct0));
  });
  for(const [label,over] of [['a NEGATIVE count (−₨1,000 counted)',{counted:-1000,difference:-42000,amount:42000}],
    ['a fraction (₨40,000.50 counted)',{counted:40000.5,difference:-999.5,amount:999.5}],['holder as the NUMBER 1011',{holder:1011}]]){
    const x=Object.assign(build('count',Object.assign({},CT,{counted:40000}),Object.assign(meta('afnan'),{bookBalance:41000})),over);
    await check('V3: a count with '+label+' is refused (its difference and amount agree with it)',()=>assertFails(setDoc(doc(as('afnan'),pathOf(x)),x)));
  }
  // The edit row (C1–C3). A journal carrying two flags, as the writer stores it.
  const jflags=[{rule:'evidence.missing',message:'No bill',field:'attachments'},{rule:'duplicate',message:'dup',field:null}];
  const jf1=mo({flags:jflags});
  await check('V3: an edit whose row names only "flags" (emptying them, nothing visible changed) is refused',async()=>{
    await seed(pathOf(jf1),jf1);
    const x=Object.assign({},jf1,{flags:[],rev:2,edits:[{at:NOW(),by:'ammar',byName:'Ammar',reason:'x',fields:['flags'],before:{flags:jflags},after:{flags:[]}}]});
    await assertFails(setDoc(doc(as('ammar'),pathOf(jf1)),x));
  });
  await check('V3 control: …an edit that names the note, and stores the flags it raised, passes',async()=>{
    await seed(pathOf(jf1),jf1);
    const e=edit(jf1,Object.assign({},MO,{note:'invoice 7'}),{by:'ammar',byName:'Ammar',reason:'note',flags:[jflags[0]]});
    if(!(J(e.edits[0].fields)===J(['note'])&&e.flags.length===1))throw new Error(J(e));
    await assertSucceeds(setDoc(doc(as('ammar'),pathOf(jf1)),e));
  });
  const jd=mo({});
  for(const [label,at]of[['dated 0',()=>0],['stamped six minutes ago',()=>NOW()-360000],['stamped six minutes ahead',()=>NOW()+360000]]){
    await check('V3: an edit row '+label+' is refused (the amount really moved, and is named)',async()=>{
      await seed(pathOf(jd),jd);
      const e=edit(jd,Object.assign({},MO,{amount:12500}),{by:'afnan',byName:'Afnan',reason:'the bill'});
      e.edits[e.edits.length-1].at=at();
      await assertFails(setDoc(doc(as('afnan'),pathOf(jd)),e));
    });
  }
  await check('V3 control: an edit row four minutes either side of the server\'s clock passes — a phone a little out still records',async()=>{
    for(const off of [-240000,240000]){
      await seed(pathOf(jd),jd);
      const e=edit(jd,Object.assign({},MO,{amount:12500}),{by:'afnan',byName:'Afnan',reason:'the bill'});
      e.edits[e.edits.length-1].at=NOW()+off;
      await assertSucceeds(setDoc(doc(as('afnan'),pathOf(jd)),e));
    }
  });
  const jh=mo({});
  await check('V3: `historical` flipped by an edit whose row names only the note is refused',async()=>{
    await seed(pathOf(jh),jh);
    const e=edit(jh,Object.assign({},MO,{note:'n'}),{by:'afnan',byName:'Afnan',reason:'note'});
    if(!(jh.historical===false&&J(e.edits[0].fields)===J(['note'])))throw new Error(J([jh.historical,e.edits[0].fields]));
    e.historical=true;
    await assertFails(setDoc(doc(as('afnan'),pathOf(jh)),e));
  });
  // goLive is read where maSettings reads it: ma_settings/main, else the
  // default. With it moved to 10 Oct, a day moved to 6 Oct is history.
  const LATE=Object.assign({},JSON.parse(app.run('JSON.stringify(MA_DEFAULT_SETTINGS)')),{goLive:'2026-10-10'});
  const RL=expr=>JSON.parse(app.run('JSON.stringify((()=>{const IDX=maChartIndex(maChart("groovy"));const S='+J(LATE)+';return '+expr+';})())'));
  const jl=RL('maBuildDoc("journal",'+J(Object.assign({},MO,{date:'2026-10-12'}))+','+J(meta('afnan'))+',IDX,S)');
  seq++;jl.no=R('maDocNo("journal",'+J(jl.fy)+','+seq+')');jl.id=jl.no;
  const moveTo6=()=>RL('maApplyEdit('+J(jl)+',maBuildDoc("journal",'+J(Object.assign({},MO,{date:'2026-10-06'}))+','+J({by:jl.by,byName:jl.byName,ts:jl.ts})+',IDX,S),'+J(nowRow({by:'afnan',byName:'Afnan',reason:'day'}))+')');
  await seed('ma_settings/main',{goLive:'2026-10-10'});
  await check('V3 control: with goLive moved to 10 Oct in ma_settings/main, a day moved to 6 Oct becomes history, its date named',async()=>{
    await seed(pathOf(jl),jl);
    const e=moveTo6();
    if(!(jl.historical===false&&e.historical===true&&e.edits[0].fields.indexOf('date')>=0))throw new Error(J([jl.historical,e.historical,e.edits[0].fields]));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(jl)),e));
  });
  await check('V3: …and a note edit cannot mark a day before goLive live again (historical true → false)',async()=>{
    const hist=Object.assign({},jl,{date:'2026-10-06',historical:true});   // 6 Oct, as the builder labels it under a 10 Oct goLive
    await seed(pathOf(jl),hist);
    const e=RL('maApplyEdit('+J(hist)+',maBuildDoc("journal",'+J(Object.assign({},MO,{date:'2026-10-06',note:'x'}))+','+J({by:hist.by,byName:hist.byName,ts:hist.ts})+',IDX,S),'+J(nowRow({by:'afnan',byName:'Afnan',reason:'note'}))+')');
    if(!(e.historical===true&&J(e.edits[0].fields)===J(['note'])))throw new Error(J([e.historical,e.edits[0].fields]));
    e.historical=false;
    await assertFails(setDoc(doc(as('afnan'),pathOf(jl)),e));
  });
  await env.withSecurityRulesDisabled(async c=>{ await deleteDoc(doc(c.firestore(),'ma_settings/main')); });

  console.log('default-deny for anything not named');
  await check('an unlisted ma_ collection (ma_postings) is refused to an owner, read and write',async()=>{
    await seed('ma_postings/p1',{a:1});
    await assertFails(getDoc(doc(as('afnan'),'ma_postings/p1')));
    await assertFails(setDoc(doc(as('afnan'),'ma_postings/p2'),{a:1}));
    await assertFails(setDoc(doc(as('afnan'),'ma_sv_journal/j1'),{a:1}));
  });

  await env.cleanup();
  console.log('\n'+passed+' passed, '+failed+' failed');
  process.exit(failed?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });

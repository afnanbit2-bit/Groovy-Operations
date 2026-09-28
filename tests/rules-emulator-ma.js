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

   Every document is BUILT BY THE APP (maBuildDoc, maApplyEdit, maApplyVoid,
   maConfirmPatch, maAuditRow from js/ma-core.js, through tests/harness.js),
   with the number minted the way the writer will (no = maDocNo(...), and the
   document id IS the number). A rule and the code that has to satisfy it are
   tested together. A demo- project id keeps it offline: nothing here can
   reach groovy-gatepass. What the Console has PUBLISHED is a separate
   question only the human can answer.
   ───────────────────────────────────────────────────────────────────────── */
const fs=require('fs');
const path=require('path');
const REPO=path.join(__dirname,'..');
const dep=p=>require(require.resolve(p,{paths:[process.env.EMU_DEPS,process.cwd()].filter(Boolean)}));
const {initializeTestEnvironment,assertSucceeds,assertFails}=dep('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,deleteDoc,getDocs,collection}=dep('firebase/firestore');
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
const edit=(before,input,meta)=>R('maApplyEdit('+J(before)+',maBuildDoc('+J(before.dt)+','+J(input)+','+J({by:before.by,byName:before.byName,ts:before.ts})+',IDX,S),'+J(meta)+')');
const voided=(d,meta)=>R('maApplyVoid('+J(d)+','+J(meta)+')');
const confirm=(d,who,meta)=>R('maConfirmPatch('+J(d)+','+J(who)+','+J(meta)+')');
const audit=(action,target,meta)=>R('maAuditRow('+J(action)+','+J(target)+','+J(meta)+')');
const COL={journal:'ma_journal',transfer:'ma_transfer',count:'ma_counts'};
const pathOf=d=>COL[d.dt]+'/'+d.no;

const U={afnan:'u-afnan',ammar:'u-ammar',mustafa:'u-must',raees:'u-raees'};
const T=Date.UTC(2026,9,5,6,0);

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
  await check('a transfer edit (amount) passes; Mustafa cannot edit one',async()=>{
    const e=edit(trB,{date:'2026-10-06',from:'1011',to:'1012',amount:7500},{by:'afnan',at:T+1,reason:'x'});
    await assertFails(setDoc(doc(as('mustafa'),pathOf(trB)),e));
    await assertSucceeds(setDoc(doc(as('afnan'),pathOf(trB)),e));
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
    let cur=null;await env.withSecurityRulesDisabled(async c=>{cur=(await getDoc(doc(c.firestore(),pathOf(trB)))).data();});
    const e=edit(Object.assign({},cur),{date:'2026-09-20',from:'1011',to:'1012',amount:7500},{by:'afnan',at:T+2,reason:'wrong month'});
    if(e.quarter!=='2027-Q1')throw new Error(e.quarter);
    await assertFails(setDoc(doc(as('afnan'),pathOf(trB)),e));
  });
  await check('a void of a document in the locked quarter is refused',()=>
    assertFails(setDoc(doc(as('afnan'),pathOf(q1)),voided(q1,{by:'afnan',at:T+3,reason:'x'}))));
  await check('a close cannot be deleted, re-locked in place, or reopened without a reason / in another\'s name',async()=>{
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

  console.log('the audit trail — append-only');
  const row=audit('post',j1,{by:'afnan',byName:'Afnan',at:T,detail:'posted'});
  await check('an owner appends an audit row the builder made',()=>assertSucceeds(setDoc(doc(as('afnan'),'ma_audit/a1'),row)));
  await check('a row in someone else\'s name, or with no time, is refused',async()=>{
    await assertFails(setDoc(doc(as('ammar'),'ma_audit/a2'),row));
    await assertFails(setDoc(doc(as('afnan'),'ma_audit/a3'),Object.assign({},row,{at:'now'})));
  });
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

  console.log('share links');
  const share={createdBy:'afnan',createdAt:T,expiresAt:T+7*86400000,revoked:false,opens:0,target:{dt:'journal',no:j1.no}};
  await check('an owner makes a share link',()=>assertSucceeds(setDoc(doc(as('afnan'),'ma_shares/tok1'),share)));
  await check('a link made in someone else\'s name, born revoked, or with opens already counted is refused',async()=>{
    await assertFails(setDoc(doc(as('ammar'),'ma_shares/tok2'),share));
    await assertFails(setDoc(doc(as('afnan'),'ma_shares/tok3'),Object.assign({},share,{revoked:true})));
    await assertFails(setDoc(doc(as('afnan'),'ma_shares/tok4'),Object.assign({},share,{opens:1})));
  });
  await check('a revoke that also moves the expiry, or in someone else\'s name, is refused',async()=>{
    await assertFails(updateDoc(doc(as('ammar'),'ma_shares/tok1'),{revoked:true,revokedAt:T+1,revokedBy:'ammar',expiresAt:T+999999999}));
    await assertFails(updateDoc(doc(as('ammar'),'ma_shares/tok1'),{revoked:true,revokedAt:T+1,revokedBy:'afnan'}));
  });
  await check('Ammar revokes the link',()=>assertSucceeds(updateDoc(doc(as('ammar'),'ma_shares/tok1'),{revoked:true,revokedAt:T+1,revokedBy:'ammar'})));
  await check('un-revoking is refused; a link is never deleted',async()=>{
    await assertFails(updateDoc(doc(as('afnan'),'ma_shares/tok1'),{revoked:false}));
    await assertFails(deleteDoc(doc(as('afnan'),'ma_shares/tok1')));
  });
  await check('Mustafa cannot read a share link',()=>assertFails(getDoc(doc(as('mustafa'),'ma_shares/tok1'))));

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

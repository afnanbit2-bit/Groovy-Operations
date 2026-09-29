/* ─────────────────────────────────────────────────────────────────────────
   tests/rules-emulator-qa.js — the QA account's fence, over EVERY path in
   firestore.rules, run in the real Firestore emulator (29 Sept 2026).

   Not a *.test.js (CI installs nothing). Run by hand:
     cd <repo> && EMU_DEPS=/tmp/emu/node_modules \
       /tmp/emu/node_modules/.bin/firebase emulators:exec --only firestore \
       --project demo-qa "node tests/rules-emulator-qa.js"
   OLD_RULES_FILE=<path> picks the ruleset the regression differential
   compares against; without it, `git show origin/main:firestore.rules`.

   The decision it holds (Afnan, 29 Sept 2026): claude@groovy.op READS every
   collection and path any rule lets any role read, role-gated and
   owner-only included; a path with no match block stays denied to everyone;
   its WRITES are fenced to a short, declared list.

   THE ONE EXCEPTION is the owner's books. Master Accounts (ma_*) is afnan +
   ammar only ("just for me and Ammar") and the account used for automated QA
   must not be able to read it, so there the QA account is REFUSED (part 1b,
   with the two owners as the control). Parts 1 and 4 skip those paths — part
   4 because its baseline (main before the QA work) predates Master Accounts,
   so afnan and ammar's access to ma_* would read as a difference that is not
   the QA work; every persona's access to ma_* is tests/rules-emulator-ma.js.
   The family is defined once: OWNER_ONLY_BOOKS in tools/qa-snapshot-lib.js.

   The path list is PARSED FROM THE RULES FILE, not typed here, so a
   collection added later is in the matrix the day it is added. Four parts:
     1 READ    every path with a read rule (except ma_*, see 1b): get and list
               succeed for QA
     1b BOOKS  every ma_* path: get and list are REFUSED for QA, and succeed
               for afnan and ammar (the control)
     2 NONE    a path with no match block (the credential collections, and an
               invented one) is denied to QA, and to a real owner too
     3 WRITE   junk create / update / delete is refused on every path; a
               fence-satisfying "kitchen sink" create succeeds on exactly the
               declared set
     4 DIFF    every non-QA persona gets the same answer from origin/main's
               ruleset and this one, for get / list / create / update / delete
               on every path
   ───────────────────────────────────────────────────────────────────────── */
const fs=require('fs');
const path=require('path');
const {execSync}=require('child_process');
const REPO=path.join(__dirname,'..');
const QAL=require(path.join(REPO,'tools','qa-snapshot-lib.js'));   // OWNER_ONLY_BOOKS: the one definition of ma_*
const dep=p=>require(require.resolve(p,{paths:[process.env.EMU_DEPS,process.cwd()].filter(Boolean)}));
const {initializeTestEnvironment,assertSucceeds,assertFails}=dep('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,deleteDoc,getDocs,collection}=dep('firebase/firestore');

const NEW_RULES=fs.readFileSync(path.join(REPO,'firestore.rules'),'utf8');
const OLD_RULES=process.env.OLD_RULES_FILE
  ? fs.readFileSync(process.env.OLD_RULES_FILE,'utf8')
  : execSync('git show '+(process.env.BASE_REF||'5996999')+':firestore.rules',{cwd:REPO,encoding:'utf8',maxBuffer:1<<26}); // 5996999 = main before the QA-read work (origin/main moved when it was pushed)

/* ── the path list, parsed from the rules ─────────────────────────────── */
function parsePaths(rules){
  const src=rules.replace(/\/\/[^\n]*/g,'');                 // comments
  const out=[];const stack=[];let depth=0;
  const re=/match\s+(\/(?:[^\s{}]|\{[^}]*\})+)\s*\{|\{|\}|allow\s+([a-z, ]+?)\s*:/g;
  let m;
  while((m=re.exec(src))){
    if(m[1]){ depth++; stack.push({p:m[1],depth,allow:[]}); }
    else if(m[2]){ if(stack.length) m[2].split(',').forEach(k=>stack[stack.length-1].allow.push(k.trim())); }
    else if(m[0]==='{'){ depth++; }
    else { if(stack.length&&stack[stack.length-1].depth===depth){ const b=stack.pop(); out.push({segs:stack.map(s=>s.p).concat(b.p),allow:b.allow}); } depth--; }
  }
  return out.map(o=>{
    const full=o.segs.join('').replace('/databases/{database}/documents','');
    return {full,allow:o.allow};
  }).filter(o=>o.full&&o.allow.length);
}
const leaves=parsePaths(NEW_RULES);
// QA_PATHS=<regex> narrows the loops to matching paths (used to prove the matrix
// has teeth without a 10-minute run); the full run never sets it.
const SCOPE=process.env.QA_PATHS?new RegExp(process.env.QA_PATHS):null;
const inScope=l=>!SCOPE||SCOPE.test(l.full);
const hasRead=l=>l.allow.some(k=>k==='read'||k==='get'||k==='list');

// '/board_items/{id}/comments/{c}' → ['board_items','comments'] (collection names)
const colls=l=>l.full.split('/').filter(Boolean).filter(s=>!/^\{/.test(s));
const isRecursive=l=>/=\*\*/.test(l.full);
// The owner's books (Master Accounts, ma_*): the one family QA must NOT read.
const isBooks=l=>QAL.isOwnerOnlyBooks(colls(l)[0]);
const U={};
const authJs=fs.readFileSync(path.join(REPO,'js/auth.js'),'utf8');
const userDefs=[...authJs.matchAll(/\{u:'([a-z0-9_]+)',\s*email:'([^']+)'/g)].map(m=>({u:m[1],email:m[2]}));
const personas=[];
userDefs.forEach(d=>{ if(!personas.find(p=>p.u===d.u)) personas.push(d); });
personas.forEach(p=>{U[p.u]='u-'+p.u;});
const QA='claude';

// Build a concrete doc path: parents get PARENT[coll] ids, the leaf gets `leafId`.
const PARENT={board_items:'qaitem',mood_boards:'qaboard'};
function docPath(l,leafId,parentMode){
  const segs=l.full.split('/').filter(Boolean);
  const out=[];let coll=null;
  for(let i=0;i<segs.length;i++){
    const s=segs[i];
    if(/^\{/.test(s)){
      const last=i===segs.length-1;
      out.push(last?(leafId||'d1'):((parentMode&&PARENT[coll])||'d1'));
    } else { out.push(s); coll=s; }
  }
  return out.join('/');
}
const collPath=l=>docPath(l,'x').split('/').slice(0,-1).join('/');

/* ── the declared WRITE set (deliberately allowed for QA) ──────────────── */
const EXPECTED_QA_WRITE=[
  'board_items','board_items/comments','board_items/activity',
  'board_lists','hrm_notifications','mood_boards','mood_boards/comments',
  'mood_boards/presence','mood_boards/activity','mood_boards/trash','user_profiles'
].sort();

let passed=0,failed=0;
async function check(name,fn){
  try{ await fn(); passed++; console.log('  ok   '+name); }
  catch(e){ failed++; console.log('  FAIL '+name+'\n       '+String(e&&e.message||e).split('\n').slice(0,3).join(' | ')); }
}

// Rich seed: enough fields that a rule with row conditions has something to read.
const rich=(uid,uname)=>({uid,ownerUid:uid,adminUid:uid,authorUid:uid,byUid:uid,byU:uname,createdBy:uid,
  memberUids:[uid],assigneeUids:[uid],sharedWith:[],visibility:'shared',kind:'shared',status:'open',
  forUser:uname,forRole:'owner',title:'t',name:'n',qa:false,date:'2026-10-01',type:'organic'});

(async()=>{
  const mk=async(id,rules)=>initializeTestEnvironment({projectId:id,firestore:{rules}});
  const envN=await mk('demo-qa-new',NEW_RULES); envN._id='N';
  const envO=await mk('demo-qa-old',OLD_RULES); envO._id='O';
  // ONE Firestore client per (env, persona): a new client per operation leaks
  // a gRPC channel each and ran the first version out of heap.
  const cache=new Map();
  const ctx=(env,u)=>{
    const k=env._id+'|'+u; if(cache.has(k)) return cache.get(k);
    const db=u==='__anon'?env.unauthenticatedContext().firestore()
      :u==='__stranger'?env.authenticatedContext('u-stranger',{email:'nobody@example.com'}).firestore()
      :env.authenticatedContext(U[u],{email:u+'@groovy.op'}).firestore();
    cache.set(k,db); return db;
  };
  const raw=(env,fn)=>env.withSecurityRulesDisabled(async c=>fn(c.firestore()));
  const uidOf=u=>U[u];

  console.log('the path list, parsed from firestore.rules');
  const readable=leaves.filter(hasRead);
  const books=readable.filter(isBooks);                                  // Master Accounts: QA is REFUSED (part 1b)
  const readableS=readable.filter(l=>!isBooks(l)).filter(inScope);       // everything QA must read (part 1)
  await check('parser found the paths ('+leaves.length+' with rules, '+readable.length+' readable)',async()=>{
    if(leaves.length<85||readable.length<85) throw new Error('parsed too few: '+leaves.length+'/'+readable.length);
    for(const must of ['/pos/{doc}','/employees/{doc}','/payslips/{doc}','/acct_entries/{doc}']){
      if(!leaves.find(l=>l.full===must)&&!leaves.find(l=>l.full.startsWith(must.replace('{doc}','')))) throw new Error('missing '+must);
    }
  });

  // ── seed the QA-valid parents once, in the NEW env ──
  const seedQa=async env=>raw(env,async db=>{
    await setDoc(doc(db,'board_lists/qalist'),{adminUid:uidOf(QA),memberUids:[uidOf(QA)],kind:'shared',qa:true});
    await setDoc(doc(db,'board_items/qaitem'),{ownerUid:uidOf(QA),assigneeUids:[uidOf(QA)],listId:'qalist',qa:true,visibility:'shared'});
    await setDoc(doc(db,'mood_boards/qaboard'),{ownerUid:uidOf(QA),visibility:'personal',sharedWith:[],title:'qa'});
  });
  await seedQa(envN);

  // ═══ 1 · READ ═══
  console.log('1 · READ — QA reads every path a rule lets any role read');
  const seedAll=async env=>raw(env,async db=>{
    for(const l of leaves){
      // parents first (docPath builds the whole chain; seed each prefix)
      const segs=docPath(l,'d1').split('/');
      for(let i=2;i<=segs.length;i+=2){
        const p=segs.slice(0,i).join('/'); const owner=uidOf('afnan');
        try{ await setDoc(doc(db,p),Object.assign(rich(owner,'afnan'),{__seed:1})); }catch(e){}
      }
    }
  });
  await seedAll(envN); await seedAll(envO);
  await seedQa(envN);
  for(const l of readableS){
    const dp=docPath(l,'d1'), cp=collPath(l);
    await check('QA get  '+l.full,()=>assertSucceeds(getDoc(doc(ctx(envN,QA),dp))));
    await check('QA list '+l.full,()=>assertSucceeds(getDocs(collection(ctx(envN,QA),cp))));
  }

  // ═══ 1b · THE OWNER'S BOOKS ═══
  // Master Accounts (ma_*) is afnan + ammar only — "just for me and Ammar" — and
  // the account used for automated QA must not be able to read the owner's
  // books. So this is the OPPOSITE of part 1: QA is REFUSED. The control (an
  // owner reads the very same seeded document and collection) proves the
  // refusal is the rule, and not a broken path or an empty seed.
  console.log('1b · THE OWNER\'S BOOKS — Master Accounts (ma_*): QA is REFUSED, the two owners are not');
  await check('the parser found the Master Accounts paths ('+books.length+')',async()=>{
    if(books.length<15) throw new Error('parsed too few: '+books.length);
    for(const c of ['ma_accounts','ma_journal','ma_transfer','ma_counts','ma_closes','ma_audit','ma_backups','ma_shares'])
      if(!books.find(l=>colls(l)[0]===c)) throw new Error('missing '+c);
  });
  for(const l of books.filter(inScope)){
    const dp=docPath(l,'d1'), cp=collPath(l);
    await check('QA get  '+l.full+' is REFUSED',()=>assertFails(getDoc(doc(ctx(envN,QA),dp))));
    await check('QA list '+l.full+' is REFUSED',()=>assertFails(getDocs(collection(ctx(envN,QA),cp))));
    for(const o of ['afnan','ammar'])
      await check('control: '+o+' gets and lists '+l.full,async()=>{
        await assertSucceeds(getDoc(doc(ctx(envN,o),dp)));
        await assertSucceeds(getDocs(collection(ctx(envN,o),cp)));
      });
  }

  // ═══ 2 · NO MATCH BLOCK ═══
  console.log('2 · NO MATCH BLOCK — denied to everyone, QA included');
  for(const c of ['integration_secrets','passkeys','passkey_challenges','zz_no_such_collection']){
    const inRules=new RegExp('match\\s+/'+c+'/').test(NEW_RULES.replace(/\/\/[^\n]*/g,''));
    await check(c+' has no match block',async()=>{ if(inRules) throw new Error('a match block exists'); });
    await check('QA cannot get '+c,()=>assertFails(getDoc(doc(ctx(envN,QA),c+'/x'))));
    await check('QA cannot list '+c,()=>assertFails(getDocs(collection(ctx(envN,QA),c))));
    await check('an owner cannot get '+c+' either',()=>assertFails(getDoc(doc(ctx(envN,'afnan'),c+'/x'))));
  }

  // ═══ 3 · WRITE ═══
  console.log('3 · WRITE — refused everywhere except the declared set');
  const writable=leaves.filter(l=>l.allow.some(k=>['write','create','update','delete'].includes(k)));
  const writableS=writable.filter(inScope);
  for(const l of writableS){
    const dp=docPath(l,'d1'), np=docPath(l,'new1');
    await check('QA junk create '+l.full,()=>assertFails(setDoc(doc(ctx(envN,QA),np),{a:1})));
    await check('QA junk update '+l.full,()=>assertFails(updateDoc(doc(ctx(envN,QA),dp),{zzz:1})));
    await check('QA junk delete '+l.full,()=>assertFails(deleteDoc(doc(ctx(envN,QA),dp))));
  }
  // The kitchen sink: every field any QA fence looks at, all satisfied.
  const q=uidOf(QA);
  const kitchen=()=>({ownerUid:q,uid:q,adminUid:q,authorUid:q,byUid:q,byU:QA,createdBy:q,
    memberUids:[q],assigneeUids:[q],sharedWith:[],visibility:'personal',kind:'shared',
    forUser:QA,qa:true,listId:'qalist',title:'k',date:'2026-10-01',status:'open',
    // a real person's fields, so "real user reachable" shows up if a rule lets it through
    __kitchen:1});
  const got=[];
  for(const l of writable){ // (always full: cheap)
    const leafSeg=l.full.split('/').filter(Boolean).slice(-1)[0];
    const leafId=/^\{/.test(leafSeg)&&(colls(l).slice(-1)[0]==='user_profiles'||colls(l).slice(-1)[0]==='presence')?q:'k1';
    const p=docPath(l,leafId,true);
    let ok=true;
    try{ await assertSucceeds(setDoc(doc(ctx(envN,QA),p),kitchen())); }catch(e){ ok=false; }
    if(ok){ got.push(colls(l).join('/')); await raw(envN,db=>deleteDoc(doc(db,p))); }
  }
  const gotSorted=[...new Set(got)].sort();
  await check('a fence-satisfying create succeeds on exactly the declared set: '+EXPECTED_QA_WRITE.join(', '),async()=>{
    if(JSON.stringify(gotSorted)!==JSON.stringify(EXPECTED_QA_WRITE))
      throw new Error('got ['+gotSorted.join(', ')+']');
  });
  await check('the rules text names isQa() on the write side of exactly that set',async()=>{
    const src=NEW_RULES.replace(/\/\/[^\n]*/g,'');
    const set=new Set();
    for(const l of writable){
      // find this leaf's block text: cheap approach — search for the collection's own match line
      const last=colls(l).slice(-1)[0];
      const re=new RegExp('match\\s+/'+last+'/\\{[^}]*\\}\\s*\\{');
      const idx=src.search(re); if(idx<0) continue;
      let depth=0,i=src.indexOf('{',idx+5+last.length);
      i=src.indexOf('{',src.indexOf('}',idx)+1);
      const start=i; depth=0; let end=start;
      for(let k=start;k<src.length;k++){ if(src[k]==='{')depth++; else if(src[k]==='}'){depth--; if(!depth){end=k;break;}} }
      const body=src.slice(start,end);
      // only this block's own allow lines (drop nested match blocks)
      const own=body.replace(/match[\s\S]*$/,'');
      if(/allow\s+(write|create|update|delete)[^;]*isQa\(\)/.test(own)) set.add(colls(l).join('/'));
    }
    const arr=[...set].sort();
    // presence/trash/comments use helper functions (qaOwnsParent) rather than isQa() inline
    const missing=arr.filter(x=>!EXPECTED_QA_WRITE.includes(x));
    if(missing.length) throw new Error('isQa() on a write outside the declared set: '+missing.join(', '));
  });
  // the unaddressed-people fences, one by one
  await check('QA cannot put a real person on an item it creates',()=>assertFails(setDoc(doc(ctx(envN,QA),'board_items/k2'),Object.assign(kitchen(),{assigneeUids:[q,uidOf('afnan')]}))));
  await check('QA cannot put a real person in a list it creates',()=>assertFails(setDoc(doc(ctx(envN,QA),'board_lists/k2'),Object.assign(kitchen(),{memberUids:[q,uidOf('afnan')]}))));
  await check('QA cannot add a real person to its item afterwards',()=>assertFails(updateDoc(doc(ctx(envN,QA),'board_items/qaitem'),{assigneeUids:[q,uidOf('afnan')]})));
  await check('QA cannot add a real person to its list afterwards',()=>assertFails(updateDoc(doc(ctx(envN,QA),'board_lists/qalist'),{memberUids:[q,uidOf('afnan')]})));
  await check('QA cannot write a notification for a real user',()=>assertFails(setDoc(doc(ctx(envN,QA),'hrm_notifications/k3'),{forUser:'afnan',title:'x'})));
  await check('QA cannot write a role-addressed notification (lands in every owner\'s bell)',()=>assertFails(setDoc(doc(ctx(envN,QA),'hrm_notifications/k4'),{forRole:'owner',title:'x'})));
  await check('QA cannot write forUser:claude plus forRole:owner',()=>assertFails(setDoc(doc(ctx(envN,QA),'hrm_notifications/k5'),{forUser:'claude',forRole:'owner',title:'x'})));
  await check('…nor forRole:all',()=>assertFails(setDoc(doc(ctx(envN,QA),'hrm_notifications/k6'),{forUser:'claude',forRole:'all',title:'x'})));
  await check('QA cannot add forRole to a row of its own afterwards',async()=>{
    await raw(envN,db=>setDoc(doc(db,'hrm_notifications/own1'),{forUser:'claude',title:'x'}));
    await assertFails(updateDoc(doc(ctx(envN,QA),'hrm_notifications/own1'),{forRole:'owner'}));
  });
  await check('QA can still write a row for itself alone',()=>assertSucceeds(setDoc(doc(ctx(envN,QA),'hrm_notifications/k7'),{forUser:'claude',title:'x'})));

  // The e2e harness's containment gate (tests/e2e/board.e2e.js) can no longer
  // use a read (QA reads everything). It updates a document that does NOT
  // exist: judged by the rules first, so it tells a fenced QA account from an
  // unfenced one and creates nothing either way. Proved against the ruleset
  // that is PUBLISHED today (no isQa()) and against this one.
  console.log('the containment gate (update of a nonexistent doc)');
  {
    const PUBLISHED=execSync('git show '+(process.env.PUBLISHED_REF||'430fc28')+':firestore.rules',{cwd:REPO,encoding:'utf8',maxBuffer:1<<26});
    const envP=await mk('demo-qa-pub',PUBLISHED); envP._id='P';
    const code=async(env,col)=>{ try{ await updateDoc(doc(ctx(env,QA),col+'/qa-gate-probe'),{a:1}); return 'ok'; }catch(e){ return e&&e.code||String(e); } };
    for(const c of ['pos','bug_reports']){
      await check('fenced (this ruleset): update of nonexistent '+c+' is permission-denied',async()=>{ const r=await code(envN,c); if(r!=='permission-denied') throw new Error(r); });
      await check('unfenced (published today): the same update is NOT permission-denied → gate would fire',async()=>{ const r=await code(envP,c); if(r==='permission-denied'||r==='ok') throw new Error(r); });
    }
    await check('and nothing was created by the gate',async()=>{ await raw(envP,async db=>{ const s=await getDoc(doc(db,'pos/qa-gate-probe')); if(s.exists()) throw new Error('created'); }); });
    await envP.cleanup();
  }

  // ═══ 4 · DIFFERENTIAL ═══
  console.log('4 · DIFFERENTIAL — origin/main vs this ruleset, every non-QA persona, every path (except ma_*)');
  // ma_* is left out, and only because of the baseline: OLD_RULES is main before
  // the QA work, which predates Master Accounts, so it denies ma_* to everyone
  // while this ruleset admits afnan and ammar — a difference that is the Master
  // Accounts block, not the QA work. Those paths are held elsewhere: QA is
  // refused in part 1b, and every persona's access is tests/rules-emulator-ma.js.
  const who=personas.filter(p=>p.u!==QA).map(p=>p.u).concat(['__anon','__stranger']);
  const payload=u=>{ const id=u.startsWith('__')?'u-stranger':uidOf(u); return rich(id,u.replace('__','')); };
  const outcome=async fn=>{ try{ await fn(); return 'ok'; }catch(e){ return 'no'; } };
  const cellsDiff=[];let cells=0;
  const reseed=async(env,l)=>raw(env,async db=>{
    const segs=docPath(l,'d1').split('/');
    for(let i=2;i<=segs.length;i+=2) await setDoc(doc(db,segs.slice(0,i).join('/')),Object.assign(rich(uidOf('afnan'),'afnan'),{__seed:1}));
  });
  for(const l of leaves.filter(inScope).filter(l=>!isBooks(l))){
    const dp=docPath(l,'d1'),np=docPath(l,'new1'),cp=collPath(l);
    for(const u of who){
      const res={};
      for(const [tag,env] of [['old',envO],['new',envN]]){
        const db=()=>ctx(env,u);
        const r=[];
        r.push(await outcome(()=>getDoc(doc(db(),dp))));
        r.push(await outcome(()=>getDocs(collection(db(),cp))));
        r.push(await outcome(()=>setDoc(doc(db(),np),payload(u))));
        await raw(env,d=>deleteDoc(doc(d,np)));
        r.push(await outcome(()=>updateDoc(doc(db(),dp),{zzz:1})));
        r.push(await outcome(()=>deleteDoc(doc(db(),dp))));
        await reseed(env,l);
        res[tag]=r.join(',');
      }
      cells+=5;
      if(res.old!==res.new) cellsDiff.push(l.full+' as '+u+': old['+res.old+'] new['+res.new+']');
    }
  }
  await check('zero differences across '+cells+' (persona × path × operation) cells for '+who.length+' non-QA personas',async()=>{
    if(cellsDiff.length) throw new Error(cellsDiff.length+' differ: '+cellsDiff.slice(0,5).join(' ;; '));
  });

  // ── the UID pin: QA is confined by uid even when the token has NO email claim ──
  console.log('\nthe uid pin (a sign-in whose token lacks the email claim)');
  {
    const PIN=(/request\.auth\.uid == '([A-Za-z0-9]{20,40})'/.exec(NEW_RULES)||[])[1];
    await check('firestore.rules pins a uid in isQa()',async()=>{ if(!PIN) throw new Error('no uid pinned'); });
    const noEmail=envN.authenticatedContext(PIN||'x',{}).firestore();
    const other=envN.authenticatedContext('someone-else-uid',{}).firestore();
    await raw(envN,async d=>{ await setDoc(doc(d,'pos/pinned1'),{a:1}); await setDoc(doc(d,'employees/pinned1'),{a:1}); });
    await check('pinned uid, no email: READS pos (it is QA)',()=>assertSucceeds(getDoc(doc(noEmail,'pos/pinned1'))));
    await check('pinned uid, no email: READS employees (read-everything applies)',()=>assertSucceeds(getDoc(doc(noEmail,'employees/pinned1'))));
    await check('pinned uid, no email: CANNOT write pos (signedIn() excludes it)',()=>assertFails(setDoc(doc(noEmail,'pos/pinned2'),{a:1})));
    await check('pinned uid, no email: CANNOT write employees',()=>assertFails(setDoc(doc(noEmail,'employees/pinned2'),{a:1})));
    await check('pinned uid, no email: CANNOT notify a role',()=>assertFails(setDoc(doc(noEmail,'hrm_notifications/pinned3'),{forUser:'claude',forRole:'owner'})));
    await check('an ordinary uid with no email claim is NOT caught by the pin: it still writes pos like any signed-in user',()=>assertSucceeds(setDoc(doc(other,'pos/pinned4'),{a:1})));
    await check('… and it still reads employees, as any signed-in user does (unchanged)',()=>assertSucceeds(getDoc(doc(other,'employees/pinned1'))));
  }

  await envN.cleanup(); await envO.cleanup();
  console.log('\n'+passed+' passed, '+failed+' failed');
  process.exit(failed?1:0);
})().catch(e=>{ console.error('crashed:',e&&e.stack||e); process.exit(2); });

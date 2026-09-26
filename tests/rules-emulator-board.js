/* ─────────────────────────────────────────────────────────────────────────
   tests/rules-emulator-board.js — The Board's firestore.rules, run in the
   REAL Firestore emulator (26 Sept 2026, session 2).

   The companion of tests/rules-emulator.js (which covers wh_sales and
   acct_entries). Not a *.test.js for the same reason: it needs
   firebase-tools, the emulator and Java, and CI installs nothing. Run it by
   hand whenever the board_* rules or the Board's writers change:
     mkdir -p /tmp/emu && cd /tmp/emu && npm init -y >/dev/null
     npm install firebase-tools@13 @firebase/rules-unit-testing firebase
     cd <repo> && EMU_DEPS=/tmp/emu/node_modules \
       /tmp/emu/node_modules/.bin/firebase emulators:exec --only firestore \
       --project demo-board "node tests/rules-emulator-board.js"

   Every item is BUILT BY THE APP (tbNewItem, tbItemPatch, through
   tests/harness.js) and every patch is what the Board's own buttons write,
   so a rule and the client that has to satisfy it are tested together. A
   demo- project id keeps it offline: nothing here can reach
   groovy-gatepass. What the Console has PUBLISHED is a separate question.
   ───────────────────────────────────────────────────────────────────────── */
const fs=require('fs');
const path=require('path');
const REPO=path.join(__dirname,'..');
const dep=p=>require(require.resolve(p,{paths:[process.env.EMU_DEPS,process.cwd()].filter(Boolean)}));
const {initializeTestEnvironment,assertSucceeds,assertFails}=dep('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,deleteDoc,getDocs,collection,query,where,writeBatch}=dep('firebase/firestore');
const harness=require('./harness.js');

const LS={getItem:()=>null,setItem(){},removeItem(){}};
const app=harness.loadApp({files:['js/shared.js','js/auth.js','js/theboard.js'],globals:{localStorage:LS}});
const J=v=>JSON.stringify(v);
const NOW=Date.UTC(2026,8,26,6,0);
const U={ammar:'u-ammar',afnan:'u-afnan',saim:'u-saim',daniyal:'u-dani',mustafa:'u-must',umair:'u-umair'};
// What the app writes, built by the app.
// Round-tripped through JSON: an object built inside the harness belongs to
// another realm, and the Firestore SDK refuses it as "a custom Object".
const newItem=(o,uid)=>JSON.parse(app.run('JSON.stringify(tbNewItem('+J(o)+','+J(uid)+','+NOW+',[]))'));
const patch=(it,p,uid)=>JSON.parse(app.run('JSON.stringify(tbItemPatch('+J(it)+','+J(p)+','+J(uid)+','+(NOW+1000)+'))'));

let passed=0,failed=0;
async function check(name,fn){
  try{ await fn(); passed++; console.log('  ok   '+name); }
  catch(e){ failed++; console.log('  FAIL '+name+'\n       '+String(e&&e.message||e).split('\n')[0]); }
}

(async()=>{
  const env=await initializeTestEnvironment({
    projectId:'demo-board',
    firestore:{rules:fs.readFileSync(path.join(REPO,'firestore.rules'),'utf8')}
  });
  const as=u=>env.authenticatedContext(U[u],{email:u+'@groovy.op'}).firestore();
  const seed=async(p,d)=>env.withSecurityRulesDisabled(async c=>{ await setDoc(doc(c.firestore(),p),d); });
  const read=async p=>{ let v=null; await env.withSecurityRulesDisabled(async c=>{ const s=await getDoc(doc(c.firestore(),p)); v=s.exists()?s.data():null; }); return v; };

  // A shared item Saim and Mustafa are on (owned by Ammar), a private item
  // of Ammar's, and a GATE Saim made (born locked, by him).
  const shared=newItem({title:'Shoot 1',date:'2026-10-08',assigneeUids:[U.saim,U.mustafa]},U.ammar);
  const priv=newItem({title:'Mine',date:'2026-10-02'},U.ammar);
  const gate=newItem({title:'Shade list locked',kind:'gate',date:'2026-10-05'},U.saim);

  console.log('what the builder produced');
  await check('the shared item is shared, the private one private, the gate locked by its maker',async()=>{
    if(shared.visibility!=='shared'||priv.visibility==='shared'||gate.locked!==true||gate.lockedBy!==U.saim)
      throw new Error(J({s:shared.visibility,p:priv.visibility,g:[gate.locked,gate.lockedBy]}));
  });

  console.log('create');
  await check('Ammar creates a shared item he is on',()=>assertSucceeds(setDoc(doc(as('ammar'),'board_items/shared'),shared)));
  await check('Ammar creates a private item',()=>assertSucceeds(setDoc(doc(as('ammar'),'board_items/priv'),priv)));
  await check('Saim creates a gate (born locked, by him)',()=>assertSucceeds(setDoc(doc(as('saim'),'board_items/gate'),gate)));
  await check('Umair (not on the Board) cannot create an item',()=>assertFails(setDoc(doc(as('umair'),'board_items/x'),newItem({title:'x'},U.umair))));
  await check('nobody creates an item owned by someone else',()=>assertFails(setDoc(doc(as('saim'),'board_items/y'),newItem({title:'y'},U.ammar))));

  console.log('read');
  await check('Daniyal (a Board user, not on it) reads a shared item',()=>assertSucceeds(getDoc(doc(as('daniyal'),'board_items/shared'))));
  await check('Umair (not a Board user) cannot read a shared item',()=>assertFails(getDoc(doc(as('umair'),'board_items/shared'))));
  await check('Daniyal cannot read Ammar\'s private item',()=>assertFails(getDoc(doc(as('daniyal'),'board_items/priv'))));
  await check('the app\'s two item queries are provable (shared, and my own)',async()=>{
    await assertSucceeds(getDocs(query(collection(as('daniyal'),'board_items'),where('visibility','==','shared'))));
    await assertSucceeds(getDocs(query(collection(as('daniyal'),'board_items'),where('ownerUid','==',U.daniyal))));
  });
  await check('a broad query with no filter is refused (rules are not a filter)',()=>assertFails(getDocs(collection(as('daniyal'),'board_items'))));

  console.log('edit: who is on it');
  await check('Saim (assigned) renames the shared item',async()=>{
    const it=await read('board_items/shared');
    await assertSucceeds(updateDoc(doc(as('saim'),'board_items/shared'),patch(it,{title:'Shoot 1 (studio)'},U.saim).data));
  });
  await check('Daniyal (a reader, not on it) cannot rename it',async()=>{
    const it=await read('board_items/shared');
    await assertFails(updateDoc(doc(as('daniyal'),'board_items/shared'),patch(it,{title:'nope'},U.daniyal).data));
  });
  await check('Afnan (a Board owner, not on it) can',async()=>{
    const it=await read('board_items/shared');
    await assertSucceeds(updateDoc(doc(as('afnan'),'board_items/shared'),patch(it,{title:'Shoot 1'},U.afnan).data));
  });

  console.log('the lock');
  // Every case starts from the same state -- Saim's gate, locked by Saim,
  // Saim and Mustafa on it -- so one case's write can never be the reason
  // the next one passes or fails.
  const relock=async(o)=>env.withSecurityRulesDisabled(async c=>{
    await setDoc(doc(c.firestore(),'board_items/gate'),Object.assign({},gate,{assigneeUids:[U.saim,U.mustafa]},o||{}));
  });
  const tryAs=async(u,p,expectOk)=>{
    const it=await read('board_items/gate');
    const w=updateDoc(doc(as(u),'board_items/gate'),patch(it,p,U[u]).data);
    return expectOk?assertSucceeds(w):assertFails(w);
  };
  await check('Mustafa (on it, not the locker) changes the gate\'s notes',async()=>{ await relock(); await tryAs('mustafa',{notes:'Pantone TCX'},true); });
  await check('Mustafa cannot MOVE the locked gate',async()=>{ await relock(); await tryAs('mustafa',{date:'2026-10-09'},false); });
  await check('Mustafa cannot take the lock over (lockedBy -> himself)',async()=>{ await relock(); await tryAs('mustafa',{lockedBy:U.mustafa},false); });
  await check('Mustafa cannot UNLOCK it and leave the name (locked -> false)',async()=>{ await relock(); await tryAs('mustafa',{locked:false},false); });
  await check('Mustafa cannot unlock it as tbToggleLock writes it',async()=>{ await relock(); await tryAs('mustafa',{locked:false,lockedBy:null},false); });
  await check('Saim (the locker) moves it',async()=>{ await relock(); await tryAs('saim',{date:'2026-10-06'},true); });
  await check('Saim (the locker, not a Board owner) unlocks it, as tbToggleLock writes it',async()=>{ await relock(); await tryAs('saim',{locked:false,lockedBy:null},true); });
  await check('Ammar (a Board owner) moves a locked item',async()=>{ await relock(); await tryAs('ammar',{date:'2026-10-07'},true); });
  await check('Ammar (a Board owner) unlocks someone else\'s lock',async()=>{ await relock(); await tryAs('ammar',{locked:false,lockedBy:null},true); });
  await check('on an UNLOCKED item, Mustafa locks it in his own name',async()=>{ await relock({locked:false,lockedBy:null}); await tryAs('mustafa',{locked:true,lockedBy:U.mustafa},true); });
  await check('on an unlocked item, Mustafa cannot lock it in SAIM\'s name',async()=>{ await relock({locked:false,lockedBy:null}); await tryAs('mustafa',{locked:true,lockedBy:U.saim},false); });
  await check('on an unlocked item, Mustafa moves the date',async()=>{ await relock({locked:false,lockedBy:null}); await tryAs('mustafa',{date:'2026-10-10'},true); });
  await check('on a LOCKED item, Mustafa (not the locker) still marks it done, as tbDonePlan writes it',async()=>{
    await relock(); const it=await read('board_items/gate');
    const plan=JSON.parse(app.run('JSON.stringify(tbDonePlan('+J(Object.assign({id:'gate'},it))+','+J(U.mustafa)+','+NOW+',null))'));
    await assertSucceeds(updateDoc(doc(as('mustafa'),'board_items/gate'),plan.data||plan));
  });
  await check('on a locked item, Mustafa hands it over, as tbHandoverPlan writes it',async()=>{
    await relock(); const it=await read('board_items/gate');
    const plan=JSON.parse(app.run('JSON.stringify(tbHandoverPlan('+J(Object.assign({id:'gate'},it))+','+J(U.mustafa)+','+J(U.daniyal)+',"over to you",false,'+NOW+',"daniyal"))'));
    await assertSucceeds(updateDoc(doc(as('mustafa'),'board_items/gate'),plan.data));
  });
  await check('Daniyal (not on it) cannot lock it at all',async()=>{ await relock({locked:false,lockedBy:null}); await tryAs('daniyal',{locked:true,lockedBy:U.daniyal},false); });

  console.log('delete');
  await check('Mustafa (on it, not its owner) cannot delete the shared item',()=>assertFails(deleteDoc(doc(as('mustafa'),'board_items/shared'))));
  await check('Ammar (its owner) can',()=>assertSucceeds(deleteDoc(doc(as('ammar'),'board_items/shared'))));

  console.log('comments and activity');
  await check('Daniyal cannot read comments on Ammar\'s private item',()=>assertFails(getDocs(collection(as('daniyal'),'board_items/priv/comments'))));
  await check('Ammar reads his own item\'s comments',()=>assertSucceeds(getDocs(collection(as('ammar'),'board_items/priv/comments'))));
  await check('a comment must be written as yourself',()=>assertFails(setDoc(doc(as('saim'),'board_items/gate/comments/c1'),{authorUid:U.ammar,body:'x',createdAt:NOW})));
  await check('an activity row cannot be edited',async()=>{
    await seed('board_items/gate/activity/a1',{byUid:U.saim,type:'moved',at:NOW,payload:{}});
    await assertFails(updateDoc(doc(as('saim'),'board_items/gate/activity/a1'),{type:'x'}));
  });

  console.log('config and lists');
  await check('a Board user reads board_config/markers',async()=>{
    await seed('board_config/markers',{markers:[]});
    await assertSucceeds(getDoc(doc(as('saim'),'board_config/markers')));
  });
  await check('only a Board owner writes it',async()=>{
    await assertFails(setDoc(doc(as('saim'),'board_config/markers'),{markers:[{name:'x',date:'2026-10-01'}]}));
    await assertSucceeds(setDoc(doc(as('afnan'),'board_config/markers'),{markers:[{name:'x',date:'2026-10-01'}]},{merge:true}));
  });
  await check('the shared-lists query is provable (kind + memberUids)',async()=>{
    await seed('board_lists/L',{kind:'shared',adminUid:U.ammar,memberUids:[U.ammar,U.saim],name:'Winter'});
    await assertSucceeds(getDocs(query(collection(as('saim'),'board_lists'),where('kind','==','shared'),where('memberUids','array-contains',U.saim))));
  });
  await check('the admin of a list edits an item in it they are not on',async()=>{
    const it=newItem({title:'In L',listId:'L',assigneeUids:[U.saim]},U.saim);
    await seed('board_items/inL',it);
    await seed('board_lists/L2',{kind:'shared',adminUid:U.daniyal,memberUids:[U.daniyal],name:'D'});
    await env.withSecurityRulesDisabled(async c=>{ await updateDoc(doc(c.firestore(),'board_items/inL'),{listId:'L2'}); });
    const cur=await read('board_items/inL');
    await assertSucceeds(updateDoc(doc(as('daniyal'),'board_items/inL'),patch(cur,{notes:'from the admin'},U.daniyal).data));
  });

  await env.cleanup();
  console.log('\n'+passed+' passed, '+failed+' failed');
  process.exit(failed?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });

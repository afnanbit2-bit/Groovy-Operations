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
const U={ammar:'u-ammar',afnan:'u-afnan',saim:'u-saim',daniyal:'u-dani',mustafa:'u-must',umair:'u-umair',claude:'u-claude'};
// What the app writes, built by the app.
// Round-tripped through JSON: an object built inside the harness belongs to
// another realm, and the Firestore SDK refuses it as "a custom Object".
const newItem=(o,uid,lists)=>JSON.parse(app.run('JSON.stringify(tbNewItem('+J(o)+','+J(uid)+','+NOW+','+J(lists||[])+'))'));
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

  // ── THE QA HARNESS (claude@groovy.op) ──────────────────────────────
  // A Board member whose every write is fenced. Each fence has a case that
  // must be REFUSED, and each path the harness needs has one that must
  // SUCCEED -- a fence that also blocks the harness is a harness that
  // cannot test anything.
  console.log('the QA harness: signedIn() no longer includes it');
  await seed('pos/p1',{poNumber:'GR-1'});
  await seed('bug_reports/b1',{title:'x'});
  await seed('notes_pages/n1',{visibility:'shared',ownerUid:U.ammar,title:'SOP'});
  await check('a real signed-in user still reads pos (the control)',()=>assertSucceeds(getDoc(doc(as('saim'),'pos/p1'))));
  await check('QA cannot read pos',()=>assertFails(getDoc(doc(as('claude'),'pos/p1'))));
  await check('QA cannot write a gate pass',()=>assertFails(setDoc(doc(as('claude'),'gatepasses/g1'),{x:1})));
  await check('QA cannot read bug_reports',()=>assertFails(getDoc(doc(as('claude'),'bug_reports/b1'))));
  await check('QA cannot read a TEAM note',()=>assertFails(getDoc(doc(as('claude'),'notes_pages/n1'))));

  console.log('the QA harness: lists');
  const qaList={title:'QA Sandbox',kind:'shared',adminUid:U.claude,memberUids:[U.claude],color:'slate',emoji:null,
    sort:0,archived:false,createdAt:NOW,updatedAt:NOW,qa:true};
  await check('QA creates its own QA list',()=>assertSucceeds(setDoc(doc(as('claude'),'board_lists/QA'),qaList)));
  await check('QA cannot create a list without qa: true',()=>assertFails(setDoc(doc(as('claude'),'board_lists/QA2'),Object.assign({},qaList,{qa:false}))));
  await check('QA cannot create a QA list with a real member on it',()=>assertFails(setDoc(doc(as('claude'),'board_lists/QA3'),Object.assign({},qaList,{memberUids:[U.claude,U.saim]}))));
  await check('a real user cannot create a list flagged qa: true',()=>assertFails(setDoc(doc(as('saim'),'board_lists/S1'),Object.assign({},qaList,{adminUid:U.saim,memberUids:[U.saim]}))));
  await check('QA cannot add a real person to its list',()=>assertFails(updateDoc(doc(as('claude'),'board_lists/QA'),{memberUids:[U.claude,U.saim]})));
  await check('QA cannot clear its list\'s qa flag',()=>assertFails(updateDoc(doc(as('claude'),'board_lists/QA'),{qa:false})));
  await check('…and neither can a Board owner (it is immutable)',()=>assertFails(updateDoc(doc(as('ammar'),'board_lists/QA'),{qa:false})));
  await check('QA renames its own list',()=>assertSucceeds(updateDoc(doc(as('claude'),'board_lists/QA'),{title:'QA Sandbox 2',updatedAt:NOW+1})));

  console.log('the QA harness: items');
  await seed('board_lists/Lreal',{kind:'shared',adminUid:U.ammar,memberUids:[U.ammar,U.saim],title:'Winter',qa:false});
  const qaListRow=Object.assign({id:'QA'},qaList);
  const qaItem=newItem({title:'QA item',listId:'QA',date:'2026-10-01'},U.claude,[qaListRow]);
  await check('the app\'s own builder flags an item in a QA list qa: true',async()=>{ if(qaItem.qa!==true)throw new Error(J(qaItem)); });
  await check('…and leaves a real item without the field',async()=>{ if('qa' in newItem({title:'real'},U.saim))throw new Error('qa on a real item'); });
  await check('QA creates an item in its QA list, as the app builds it',()=>assertSucceeds(setDoc(doc(as('claude'),'board_items/qa1'),qaItem)));
  await check('QA cannot create an item with no list',()=>assertFails(setDoc(doc(as('claude'),'board_items/qa2'),Object.assign({},qaItem,{listId:null}))));
  await check('QA cannot create an item in a list it does not admin',()=>assertFails(setDoc(doc(as('claude'),'board_items/qa3'),Object.assign({},qaItem,{listId:'Lreal'}))));
  await check('QA cannot assign a real person',()=>assertFails(setDoc(doc(as('claude'),'board_items/qa4'),Object.assign({},qaItem,{assigneeUids:[U.claude,U.saim]}))));
  await check('QA cannot create an item without the qa flag',()=>assertFails(setDoc(doc(as('claude'),'board_items/qa5'),Object.assign({},qaItem,{qa:false}))));
  await check('a real user cannot create an item flagged qa: true',()=>assertFails(setDoc(doc(as('saim'),'board_items/s5'),Object.assign(newItem({title:'x'},U.saim),{qa:true}))));
  await check('QA renames its own item',async()=>{ const it=await read('board_items/qa1'); await assertSucceeds(updateDoc(doc(as('claude'),'board_items/qa1'),patch(it,{title:'QA item 2'},U.claude).data)); });
  await check('QA locks its own item',async()=>{ const it=await read('board_items/qa1'); await assertSucceeds(updateDoc(doc(as('claude'),'board_items/qa1'),patch(it,{locked:true,lockedBy:U.claude},U.claude).data)); });
  await check('QA cannot put a real person on its item',async()=>{ const it=await read('board_items/qa1'); await assertFails(updateDoc(doc(as('claude'),'board_items/qa1'),patch(it,{assigneeUids:[U.claude,U.saim]},U.claude).data)); });
  await check('QA cannot move its item into a real list',async()=>{ const it=await read('board_items/qa1'); await assertFails(updateDoc(doc(as('claude'),'board_items/qa1'),patch(it,{listId:'Lreal'},U.claude).data)); });
  await check('a real user cannot flag a real item qa: true',async()=>{
    const it=newItem({title:'Real',listId:'Lreal'},U.ammar); await seed('board_items/real1',it);
    await assertFails(updateDoc(doc(as('ammar'),'board_items/real1'),{qa:true}));
  });
  await check('QA reads a real shared item (it reads what a member reads)',async()=>{
    await seed('board_items/realShared',newItem({title:'Shoot',assigneeUids:[U.saim]},U.ammar));
    await assertSucceeds(getDoc(doc(as('claude'),'board_items/realShared')));
  });
  await check('QA cannot read a real private item',()=>assertFails(getDoc(doc(as('claude'),'board_items/priv'))));
  await check('QA cannot edit a real item even when (somehow) assigned to it',async()=>{
    await seed('board_items/realOnQa',newItem({title:'Odd',assigneeUids:[U.ammar,U.claude]},U.ammar));
    const it=await read('board_items/realOnQa');
    await assertFails(updateDoc(doc(as('claude'),'board_items/realOnQa'),patch(it,{title:'x'},U.claude).data));
  });
  await check('QA cannot move a real, locked gate',async()=>{ await relock(); await tryAs('claude',{date:'2026-10-09'},false); });
  await check('QA\'s item queries are provable (shared, and its own)',async()=>{
    await assertSucceeds(getDocs(query(collection(as('claude'),'board_items'),where('visibility','==','shared'))));
    await assertSucceeds(getDocs(query(collection(as('claude'),'board_items'),where('ownerUid','==',U.claude))));
    await assertSucceeds(getDocs(query(collection(as('claude'),'board_lists'),where('adminUid','==',U.claude))));
  });

  console.log('the QA harness: comments, activity, config');
  await check('QA comments on its own item',()=>assertSucceeds(setDoc(doc(as('claude'),'board_items/qa1/comments/c1'),{authorUid:U.claude,body:'x',createdAt:NOW})));
  await check('QA cannot comment on a real item',()=>assertFails(setDoc(doc(as('claude'),'board_items/realShared/comments/c1'),{authorUid:U.claude,body:'x',createdAt:NOW})));
  await check('QA writes activity on its own item',()=>assertSucceeds(setDoc(doc(as('claude'),'board_items/qa1/activity/a1'),{byUid:U.claude,type:'created',at:NOW,payload:{}})));
  await check('QA cannot write activity on a real item',()=>assertFails(setDoc(doc(as('claude'),'board_items/realShared/activity/a1'),{byUid:U.claude,type:'moved',at:NOW,payload:{}})));
  await check('QA reads the launch markers',()=>assertSucceeds(getDoc(doc(as('claude'),'board_config/markers'))));
  await check('QA cannot write board_config',()=>assertFails(setDoc(doc(as('claude'),'board_config/markers'),{markers:[]})));

  console.log('the QA harness: notifications');
  await seed('hrm_notifications/real1',{forUser:'ammar',title:'x',createdAt:NOW});
  await check('QA writes a notification for itself',()=>assertSucceeds(setDoc(doc(as('claude'),'hrm_notifications/q1'),{forUser:'claude',title:'x',createdAt:NOW})));
  await check('QA cannot write a notification for anyone else',()=>assertFails(setDoc(doc(as('claude'),'hrm_notifications/q2'),{forUser:'ammar',title:'x',createdAt:NOW})));
  await check('QA reads its own inbox, as the Board queries it',()=>assertSucceeds(getDocs(query(collection(as('claude'),'hrm_notifications'),where('forUser','==','claude')))));
  await check('QA marks its own row read',()=>assertSucceeds(updateDoc(doc(as('claude'),'hrm_notifications/q1'),{readBy:['claude']})));
  await check('QA cannot read a real person\'s notification',()=>assertFails(getDoc(doc(as('claude'),'hrm_notifications/real1'))));
  await check('QA cannot mark a real person\'s row read',()=>assertFails(updateDoc(doc(as('claude'),'hrm_notifications/real1'),{readBy:['claude']})));
  await check('the bell\'s unfiltered read is refused it',()=>assertFails(getDocs(collection(as('claude'),'hrm_notifications'))));

  console.log('the QA harness: profiles');
  await seed('user_profiles/'+U.saim,{uid:U.saim,username:'saim'});
  await check('QA reads the directory',()=>assertSucceeds(getDoc(doc(as('claude'),'user_profiles/'+U.saim))));
  await check('QA writes its own row',()=>assertSucceeds(setDoc(doc(as('claude'),'user_profiles/'+U.claude),{uid:U.claude,username:'claude'})));
  await check('QA cannot write someone else\'s',()=>assertFails(setDoc(doc(as('claude'),'user_profiles/'+U.saim),{uid:U.saim,username:'saim',displayName:'x'},{merge:true})));

  console.log('the QA harness: Mood Boards');
  await seed('mood_boards/team1',{visibility:'shared',ownerUid:U.ammar,title:'Winter refs',cards:[]});
  const qaBoard={visibility:'personal',ownerUid:U.claude,title:'QA board',cards:[]};
  await check('QA reads a real TEAM board',()=>assertSucceeds(getDoc(doc(as('claude'),'mood_boards/team1'))));
  await check('QA cannot edit a real TEAM board',()=>assertFails(updateDoc(doc(as('claude'),'mood_boards/team1'),{title:'x'})));
  await check('QA creates its own PRIVATE board',()=>assertSucceeds(setDoc(doc(as('claude'),'mood_boards/qab'),qaBoard)));
  await check('QA cannot create a TEAM board',()=>assertFails(setDoc(doc(as('claude'),'mood_boards/qab2'),Object.assign({},qaBoard,{visibility:'shared'}))));
  await check('QA cannot share its board with a real person',()=>assertFails(updateDoc(doc(as('claude'),'mood_boards/qab'),{sharedWith:['ammar@groovy.op']})));
  await check('QA edits its own board',()=>assertSucceeds(updateDoc(doc(as('claude'),'mood_boards/qab'),{title:'QA board 2'})));
  await check('QA cannot show as present on a real board',()=>assertFails(setDoc(doc(as('claude'),'mood_boards/team1/presence/'+U.claude),{at:NOW})));
  await check('QA is present on its own board',()=>assertSucceeds(setDoc(doc(as('claude'),'mood_boards/qab/presence/'+U.claude),{at:NOW})));
  await check('QA comments on its own board',()=>assertSucceeds(setDoc(doc(as('claude'),'mood_boards/qab/comments/c1'),{byUid:U.claude,body:'x',at:NOW})));
  await check('QA cannot comment on a real board',()=>assertFails(setDoc(doc(as('claude'),'mood_boards/team1/comments/c1'),{byUid:U.claude,body:'x',at:NOW})));
  await check('a real user still edits a TEAM board (Stage 6, unchanged)',()=>assertSucceeds(updateDoc(doc(as('saim'),'mood_boards/team1'),{title:'Winter refs 2'})));

  console.log('the QA harness: clean-up');
  await check('QA deletes its own item',()=>assertSucceeds(deleteDoc(doc(as('claude'),'board_items/qa1'))));
  await check('QA deletes its own list',()=>assertSucceeds(deleteDoc(doc(as('claude'),'board_lists/QA'))));
  await check('QA deletes its own board',()=>assertSucceeds(deleteDoc(doc(as('claude'),'mood_boards/qab'))));

  await env.cleanup();
  console.log('\n'+passed+' passed, '+failed+' failed');
  process.exit(failed?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });

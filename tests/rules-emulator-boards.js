/* ─────────────────────────────────────────────────────────────────────────
   tests/rules-emulator-boards.js — Mood Boards sharing ROLES in the REAL
   Firestore emulator (28 Sept 2026).

   Not a *.test.js: it needs firebase-tools, the emulator and Java, and CI
   installs nothing. Run it by hand whenever the mood_boards rules change:
     mkdir -p /tmp/emu && cd /tmp/emu && npm init -y >/dev/null
     npm install firebase-tools@13 @firebase/rules-unit-testing firebase
     cd <repo> && EMU_DEPS=/tmp/emu/node_modules \
       /tmp/emu/node_modules/.bin/firebase emulators:exec --only firestore \
       --project demo-boards "node tests/rules-emulator-boards.js"

   The share payload is BUILT BY THE APP (_boardsSharePatch through
   tests/harness.js), so the rule and the client that has to satisfy it are
   tested together. A demo- project id keeps it offline.
   ───────────────────────────────────────────────────────────────────────── */
const fs=require('fs');
const path=require('path');
const REPO=path.join(__dirname,'..');
const dep=p=>require(require.resolve(p,{paths:[process.env.EMU_DEPS,process.cwd()].filter(Boolean)}));
const {initializeTestEnvironment,assertSucceeds,assertFails}=dep('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,addDoc,collection}=dep('firebase/firestore');
const harness=require('./harness.js');

const app=harness.loadApp({files:['js/boards.js']});
const sharePatch=picks=>JSON.parse(app.run('JSON.stringify(_boardsSharePatch('+JSON.stringify(picks)+'))'));
const E=u=>u+'@groovy.op';

let passed=0,failed=0;
async function check(name,fn){
  try{await fn();passed++;console.log('  ok   '+name);}
  catch(e){failed++;console.log('  FAIL '+name+'\n       '+String(e&&e.message||e).split('\n')[0]);}
}

(async()=>{
  const env=await initializeTestEnvironment({
    projectId:'demo-boards',
    firestore:{rules:fs.readFileSync(path.join(REPO,'firestore.rules'),'utf8')}
  });
  const as=u=>env.authenticatedContext('u-'+u,{email:E(u)}).firestore();
  const seed=async(p,d)=>env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),p),d);});

  // Mustafa owns a PRIVATE board (he is not an app owner, so isOwner()
  // cannot mask anything). Daniyal can edit, Saim can comment, Umair can
  // only view. Abbas is not on it at all.
  const roles=sharePatch({[E('daniyal')]:'edit',[E('saim')]:'comment',[E('umair')]:'view'});
  const base={title:'Winter',visibility:'personal',ownerUid:'u-mustafa',cards:[],connectors:[]};
  await seed('mood_boards/B',Object.assign({},base,roles));
  // Shared before roles existed: sharedWith only.
  await seed('mood_boards/OLD',Object.assign({},base,{sharedWith:[E('daniyal')]}));
  await seed('mood_boards/TEAM',Object.assign({},base,{visibility:'shared',sharedWith:[]}));

  console.log('\nthe app\'s share payload');
  await check('_boardsSharePatch lists everyone on sharedWith and the restricted on their list',async()=>{
    if(roles.sharedWith.length!==3||roles.sharedView[0]!==E('umair')||roles.sharedComment[0]!==E('saim'))throw new Error(JSON.stringify(roles));
  });

  console.log('\nreading');
  for(const u of ['daniyal','saim','umair'])await check(u+' can open it',()=>assertSucceeds(getDoc(doc(as(u),'mood_boards/B'))));
  await check('abbas cannot',()=>assertFails(getDoc(doc(as('abbas'),'mood_boards/B'))));

  console.log('\nediting the board');
  await check('the editor can edit',()=>assertSucceeds(updateDoc(doc(as('daniyal'),'mood_boards/B'),{title:'W2'})));
  await check('the commenter cannot',()=>assertFails(updateDoc(doc(as('saim'),'mood_boards/B'),{title:'W3'})));
  await check('the viewer cannot',()=>assertFails(updateDoc(doc(as('umair'),'mood_boards/B'),{title:'W4'})));
  await check('a board shared before roles: still editable by that person',()=>assertSucceeds(updateDoc(doc(as('daniyal'),'mood_boards/OLD'),{title:'O2'})));

  console.log('\nchanging who it is shared with');
  await check('the viewer cannot take himself off the view list',()=>assertFails(updateDoc(doc(as('umair'),'mood_boards/B'),{sharedView:[]})));
  await check('an EDITOR cannot change sharing either (the old hole)',()=>assertFails(updateDoc(doc(as('daniyal'),'mood_boards/B'),{sharedWith:roles.sharedWith.concat(E('abbas'))})));
  await check('…nor on a board shared before roles',()=>assertFails(updateDoc(doc(as('daniyal'),'mood_boards/OLD'),{sharedWith:[E('daniyal'),E('abbas')]})));
  await check('an editor cannot take ownership',()=>assertFails(updateDoc(doc(as('daniyal'),'mood_boards/B'),{ownerUid:'u-daniyal'})));
  await check('on a TEAM board, a non-owner cannot change sharing',()=>assertFails(updateDoc(doc(as('abbas'),'mood_boards/TEAM'),{sharedWith:[E('abbas')]})));
  await check('…but can still edit it',()=>assertSucceeds(updateDoc(doc(as('abbas'),'mood_boards/TEAM'),{title:'T2'})));
  await check('the board\'s owner can change roles',()=>assertSucceeds(updateDoc(doc(as('mustafa'),'mood_boards/B'),
    Object.assign(sharePatch({[E('daniyal')]:'edit',[E('saim')]:'comment',[E('umair')]:'comment'}),{updatedAt:1}))));
  await check('an app owner can change roles',()=>assertSucceeds(updateDoc(doc(as('afnan'),'mood_boards/B'),Object.assign({},roles,{updatedAt:2}))));

  console.log('\ncomments and the activity feed');
  const cmt=u=>({cardId:null,text:'hi',byUid:'u-'+u,byName:u,ts:1,resolved:false,replyTo:null});
  await check('the commenter can comment',()=>assertSucceeds(addDoc(collection(as('saim'),'mood_boards/B/comments'),cmt('saim'))));
  await check('the editor can comment',()=>assertSucceeds(addDoc(collection(as('daniyal'),'mood_boards/B/comments'),cmt('daniyal'))));
  await check('the viewer cannot',()=>assertFails(addDoc(collection(as('umair'),'mood_boards/B/comments'),cmt('umair'))));
  await check('abbas cannot',()=>assertFails(addDoc(collection(as('abbas'),'mood_boards/B/comments'),cmt('abbas'))));
  await seed('mood_boards/B/comments/C1',cmt('daniyal'));
  await check('the commenter cannot resolve (editors do)',()=>assertFails(updateDoc(doc(as('saim'),'mood_boards/B/comments/C1'),{resolved:true})));
  await check('the editor can resolve',()=>assertSucceeds(updateDoc(doc(as('daniyal'),'mood_boards/B/comments/C1'),{resolved:true})));
  const act=u=>({ts:1,byName:u,byUid:'u-'+u,action:'commented on the board'});
  await check('the commenter\'s activity line is written',()=>assertSucceeds(addDoc(collection(as('saim'),'mood_boards/B/activity'),act('saim'))));
  await check('the viewer\'s is not',()=>assertFails(addDoc(collection(as('umair'),'mood_boards/B/activity'),act('umair'))));
  await check('the commenter cannot trash a card',()=>assertFails(addDoc(collection(as('saim'),'mood_boards/B/trash'),{byUid:'u-saim',card:{}})));

  await env.cleanup();
  console.log('\n'+passed+' passed, '+failed+' failed');
  process.exit(failed?1:0);
})().catch(e=>{console.error(e);process.exit(1);});

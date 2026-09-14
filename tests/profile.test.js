/* ─────────────────────────────────────────────────────────────────────────
   Profile — js/profile.js

   The things worth guarding here are the photo-URL allow-list (that string
   goes into an <img src>), the textContent boundary (a display name is
   written by one person and read by every other one), and the Sept 2026
   admin grant — owners and Mustafa may edit other people's profiles, and
   Mustafa specifically may NOT touch an owner's. That last one is a
   permission matrix, which is exactly the kind of thing that reads correct
   and is wrong.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

const FILES=['js/profile.js'];
// The colour helpers come from js/boards.js — classic scripts share one
// lexical scope and boards.js loads immediately before profile.js in
// index.html. Loading it here is the real arrangement, not a convenience.
const FILES_COL=['js/boards.js','js/profile.js'];

function asUser(u,name,role,extra){
  return Object.assign({uid:'uid-'+u,u,name,role:role||'worker',
    title:'T',email:u+'@groovy.op'},extra||{});
}

module.exports=async function(){
  const s=suite('profile');

  // ── photo URLs ────────────────────────────────────────────────────────
  {
    const {run}=loadApp({files:FILES,currentPage:'profile'});
    s.section('a stored photo URL is never trusted');
    s.ok('a cloudinary url passes',run(`_profPhotoUrl('https://res.cloudinary.com/deww4lpym/image/upload/v1/a.jpg')`)!=='');
    s.eq('javascript: is refused',run(`_profPhotoUrl('javascript:alert(1)')`),'');
    s.eq('a data: url is refused',run(`_profPhotoUrl('data:text/html,<script>alert(1)</script>')`),'');
    s.eq('another host is refused',run(`_profPhotoUrl('https://evil.test/a.jpg')`),'');
    s.eq('a LOOKALIKE host is refused',run(`_profPhotoUrl('https://res.cloudinary.com.evil.test/a.jpg')`),'');
    s.eq('an attribute-break attempt is refused',run(`_profPhotoUrl('https://res.cloudinary.com/a.jpg" onerror="alert(1)')`),'');
    s.eq('plain http is refused',run(`_profPhotoUrl('http://res.cloudinary.com/a.jpg')`),'');

    s.section('avatars ask for a sized derivative');
    s.ok('64px asks for w_128',/w_128,h_128/.test(run(`_profAvatarUrl('https://res.cloudinary.com/x/image/upload/v1/a.jpg',64)`)));
    s.ok('160px asks for w_320',/w_320,h_320/.test(run(`_profAvatarUrl('https://res.cloudinary.com/x/image/upload/v1/a.jpg',160)`)));
    s.ok('an already-transformed url is left alone',
      run(`_profAvatarUrl('https://res.cloudinary.com/x/image/upload/w_400/v1/a.jpg',64)`).indexOf('w_400')>0);
    s.eq('a refused url stays empty',run(`_profAvatarUrl('javascript:alert(1)',64)`),'');
  }

  // ── the textContent boundary ──────────────────────────────────────────
  {
    const hostile={uid:'u1',username:'afnan',
      displayName:'<img src=x onerror=alert(1)>',
      jobTitle:'</div><script>alert(2)</script>',
      department:'Ops',about:'"><script>alert(3)</script>',photoUrl:''};
    const app=loadApp({files:FILES,currentPage:'profile',globals:{
      getDocs:async()=>({docs:[{id:'u1',data:()=>hostile}]})
    }});
    const {run}=app;
    await run(`loadProfiles(true)`);
    const html=run(`renderProfilePage()`);
    s.section('user text never reaches the HTML string');
    s.ok('no raw <script> in the markup',!/<script/.test(html));
    s.ok('no raw onerror in the markup',!/onerror=alert/.test(html));
    s.ok('the display name is not interpolated',!/<img src=x/.test(html));
    s.ok('but its slot exists',/id="prof-name"/.test(html));
    run(`_profileHydrate()`);
    s.eq('hydration writes it as text',app.el('prof-name').textContent,'<img src=x onerror=alert(1)>');

    s.section('the directory lists every account, not just the keen');
    s.ok('an account with no profile still appears',/prof-dir-n-1/.test(run(`renderProfilePage()`)));
    run(`_profileHydrate()`);
    const names=[0,1,2,3].map(i=>app.el('prof-dir-n-'+i).textContent);
    s.ok('and falls back to its USER_DEFS name',names.indexOf('Uzaib')>=0,JSON.stringify(names));
  }

  // ── saving ────────────────────────────────────────────────────────────
  {
    const app=loadApp({files:FILES,currentPage:'profile'});
    const {run,state}=app;
    await run(`loadProfiles(true)`);
    run(`window.profileStartEdit()`);
    run(`window.profileField('displayName','   Afnan   Bit   ')`);
    run(`window.profileField('about','x'.repeat(400))`);
    run(`window.profileField('photoUrl','javascript:alert(1)')`);
    run(`_profileEdit._uploading=true`);
    await run(`window.profileSave()`);
    const w=state.writes.filter(x=>x.op==='set').pop().data;
    s.section('what actually gets written');
    s.eq('the name is trimmed and collapsed',w.displayName,'Afnan Bit');
    s.eq('about is capped at 240',w.about.length,240);
    s.eq('a bad photo url is dropped on write',w.photoUrl,'');
    s.ok('the transient _uploading flag never persists',!('_uploading' in w),JSON.stringify(Object.keys(w)));
    s.ok('uid and username come from the session, not the form',w.uid==='u1'&&w.username==='afnan');
    s.eq('session.name picks up the chosen name',run(`session.name`),'Afnan Bit');
  }

  // ── the loader must not reject ────────────────────────────────────────
  // renderPage dispatches it with no .catch — see "Loading must never hang"
  // in CLAUDE.md. A rejection leaves the page on its skeleton forever.
  {
    const app=loadApp({files:FILES,currentPage:'profile',globals:{
      getDocs:async()=>{throw new Error('Missing or insufficient permissions');}
    }});
    const {run}=app;
    s.section('a denied read is shown, not thrown');
    let threw=false;
    try{await run(`loadProfiles(true)`);}catch(e){threw=true;}
    s.ok('loadProfiles resolves instead of rejecting',!threw);
    const html=run(`renderProfilePage()`);
    s.ok('the page says so',/Could not load profiles/.test(html));
    s.ok('with a Retry',/profileRetry/.test(html));
    s.ok('and names firestore.rules',/firestore\.rules/.test(html));
  }

  // ── who may edit whom (Sept 2026 admin grant) ─────────────────────────
  // Afnan asked for himself, Ammar and Mustafa to edit other people's
  // profiles, with Mustafa NOT able to touch his or Ammar's. Scoped by
  // USERNAME: Arfat holds the same `manager` role as Mustafa and must
  // inherit none of it.
  {
    const cases=[
      // signed in as        target      may edit?  may set their password?
      ['afnan',   'owner',   'uzaib',    true,  true ],
      ['afnan',   'owner',   'ammar',    true,  true ],
      ['afnan',   'owner',   'afnan',    true,  false],  // own → Change password
      ['ammar',   'owner',   'afnan',    true,  true ],
      ['mustafa', 'manager', 'uzaib',    true,  true ],
      ['mustafa', 'manager', 'mustafa',  true,  false],
      ['mustafa', 'manager', 'afnan',    false, false],
      ['mustafa', 'manager', 'ammar',    false, false],
      ['arfat',   'manager', 'uzaib',    false, false],  // same role, no grant
      ['arfat',   'manager', 'arfat',    true,  false],
      ['uzaib',   'worker',  'afnan',    false, false],
      ['uzaib',   'worker',  'uzaib',    true,  false]
    ];
    s.section('who may edit whose profile');
    for(const [who,role,target,canEdit,canPw] of cases){
      const {run}=loadApp({files:FILES,currentPage:'profile',
        session:asUser(who,who,role)});
      s.eq(`${who} → ${target}: edit`,run(`_profCanEditUser('${target}')`),canEdit);
      s.eq(`${who} → ${target}: password`,run(`_profCanResetPassword('${target}')`),canPw);
    }
  }

  // The UI must not offer what the rules would refuse, and profileSave
  // re-checks at the moment of writing rather than trusting the form that
  // was opened a minute ago.
  {
    const app=loadApp({files:FILES,currentPage:'profile',
      session:asUser('mustafa','Mustafa','manager'),
      globals:{getDocs:async()=>({docs:[
        {id:'uid-afnan',data:()=>({uid:'uid-afnan',username:'afnan',displayName:'Afnan'})},
        {id:'uid-uzaib',data:()=>({uid:'uid-uzaib',username:'uzaib',displayName:'Uzaib'})}
      ]})}});
    const {run,state}=app;
    await run(`loadProfiles(true)`);
    const html=run(`renderProfilePage()`);
    s.section('the directory offers only what is allowed');
    s.ok('Mustafa is offered an Edit for Uzaib',/profileEditUser\('uzaib'\)/.test(html));
    s.ok('but not for Afnan',!/profileEditUser\('afnan'\)/.test(html));
    s.ok('nor a password reset for Afnan',!/openOwnerResetModal\('afnan'\)/.test(html));
    s.ok('though he gets one for Uzaib',/openOwnerResetModal\('uzaib'\)/.test(html));

    // Forcing it anyway: open a draft for Afnan by hand and try to save.
    run(`_profileEdit={uid:'uid-afnan',username:'afnan',displayName:'Hacked'}`);
    const before=state.writes.length;
    await run(`window.profileSave()`);
    s.eq('a forced save for an owner writes nothing',state.writes.length,before);

    // ...and the legitimate one does write, keeping the target's uid.
    run(`window.profileEditUser('uzaib')`);
    run(`window.profileField('jobTitle','Cutting Lead')`);
    await run(`window.profileSave()`);
    const w=state.writes.filter(x=>x.op==='set').pop().data;
    s.eq('an allowed admin save targets THEIR uid',w.uid,'uid-uzaib');
    s.eq('and keeps their username',w.username,'uzaib');
    s.eq('recording who changed it',w.updatedBy,'mustafa');
    s.eq('and the signed-in name is untouched',run(`session.name`),'Mustafa');
  }

  // An account with no profile row has no uid here, so there is nothing to
  // write to. The directory must say so rather than offer a dead button.
  {
    const app=loadApp({files:FILES,currentPage:'profile',
      session:asUser('afnan','Afnan','owner'),
      globals:{getDocs:async()=>({docs:[]})}});
    const {run,state}=app;
    await run(`loadProfiles(true)`);
    s.section('an account that has never signed in');
    s.ok('no Edit button is offered',!/profileEditUser/.test(run(`renderProfilePage()`)));
    s.ok('it says so instead',/No profile yet/.test(run(`renderProfilePage()`)));
    run(`window.profileEditUser('uzaib')`);
    s.eq('and forcing it opens no draft',run(`_profileEdit`),null);
    s.eq('writing nothing',state.writes.length,0);

    // The bug this replaced: identity and buttons shared one flex row in a
    // 220px tile, the buttons don't shrink and the name does, so every row
    // rendered with a zero-width name and you could not tell whose profile
    // was whose. The name must be readable from the markup alone.
    s.section('you can always tell whose row it is');
    const html=run(`renderProfilePage()`);
    s.ok('every row carries its @username in the HTML itself',
      (html.match(/profile-dir-user/g)||[]).length===4);
    ['afnan','ammar','mustafa','uzaib'].forEach(u=>{
      s.ok('@'+u+' is named on the page',html.indexOf('@'+u)>-1);
    });
    s.ok('the name sits in its own block, not beside the buttons',
      /profile-dir-id[\s\S]{0,200}?profile-dir-name[\s\S]*?<\/div>\s*<\/div>\s*<div class="profile-dir-sub"/.test(html));
    run(`_profileHydrate()`);
    const names=[0,1,2,3].map(i=>app.el('prof-dir-n-'+i).textContent);
    s.ok('and every name hydrates, profile or not',
      names.every(n=>n&&n.length),JSON.stringify(names));
    s.ok('your own row is marked',/tag-me/.test(html));
  }

  // The seed write is the ONLY thing that puts a username→uid pair where an
  // admin can find it. It must happen on a real "no such document", and
  // must NOT happen when the read failed or never settled — that would put
  // a bare {uid,username} row on top of a real profile.
  {
    const app=loadApp({files:FILES,currentPage:'profile',globals:{
      getDoc:async()=>({exists:()=>false,data:()=>({})})}});
    await app.run(`profileBootstrap()`);
    s.section('a missing profile row is seeded at sign-in');
    const w=app.state.writes.filter(x=>x.op==='set');
    s.eq('one row written',w.length,1);
    s.eq('carrying the uid',w[0].data.uid,'u1');
    s.eq('and the username',w[0].data.username,'afnan');
    s.ok('and nothing else',!('displayName' in w[0].data),JSON.stringify(Object.keys(w[0].data)));

    const app2=loadApp({files:FILES,currentPage:'profile',globals:{
      getDoc:async()=>({exists:()=>true,data:()=>({uid:'u1',username:'afnan',displayName:'Afnan'})})}});
    await app2.run(`profileBootstrap()`);
    s.eq('an existing profile is never overwritten',app2.state.writes.length,0);

    const app3=loadApp({files:FILES,currentPage:'profile',globals:{
      getDoc:async()=>{throw new Error('Missing or insufficient permissions');}}});
    let threw=false;
    try{await app3.run(`profileBootstrap()`);}catch(e){threw=true;}
    s.ok('a denied read does not reject',!threw);
    s.eq('and seeds nothing',app3.state.writes.length,0);
  }

  // ── name colours ──────────────────────────────────────────────────────
  // The colour is written into a style attribute, so an unvalidated string
  // is an attribute-injection hole. It reuses _boardsValidHex rather than
  // carrying a second copy of the same rule.
  {
    const app=loadApp({files:FILES_COL,currentPage:'profile',globals:{
      getDocs:async()=>({docs:[{id:'u1',data:()=>({uid:'u1',username:'afnan',
        displayName:'Afnan',nameColor:'#7b1f2a'})}]})}});
    const {run}=app;
    await run(`loadProfiles(true)`);
    s.section('a name colour is validated before it reaches a style attribute');
    s.eq('a good hex is kept, normalised',run(`_profHex('#7b1f2a')`),'#7B1F2A');
    s.eq('a 3-digit hex is refused',run(`_profHex('#abc')`),'');
    s.eq('a named colour is refused',run(`_profHex('red')`),'');
    s.eq('an attribute break is refused',run(`_profHex('#fff\" onload=\"alert(1)')`),'');
    s.eq('a url is refused',run(`_profHex('url(javascript:alert(1))')`),'');
    s.eq('empty stays empty',run(`_profHex('')`),'');
    s.ok('the stored colour reaches the page',/#7B1F2A/.test(run(`renderProfilePage()`)));
    s.eq('and is exposed for other modules',run(`window.profileNameColor('afnan')`),'#7B1F2A');
    s.eq('an unknown person has none',run(`window.profileNameColor('nobody')`),'');

    // Typing into the hex box must not wipe the current choice halfway
    // through "#7B1F2A".
    run(`window.profileStartEdit()`);
    run(`window.profileSetNameColor('#14532D')`);
    run(`window.profileSetNameColor('#145',true)`);
    s.eq('a half-typed hex is ignored',run(`_profileEdit.nameColor`),'#14532D');
    run(`window.profileSetNameColor('',true)`);
    s.eq('but clearing the box clears it',run(`_profileEdit.nameColor`),'');
  }

  // Without js/boards.js the validator is gone, and a colour must then be
  // DROPPED rather than passed through unchecked.
  {
    const {run}=loadApp({files:FILES,currentPage:'profile'});
    s.section('colour validation fails closed');
    s.eq('no validator means no colour',run(`_profHex('#7B1F2A')`),'');
  }

  // ── theme ─────────────────────────────────────────────────────────────
  {
    let store={};
    const ls={getItem:k=>(k in store?store[k]:null),
              setItem:(k,v)=>{store[k]=String(v);},
              removeItem:k=>{delete store[k];}};
    const app=loadApp({files:FILES,currentPage:'profile',globals:{localStorage:ls}});
    const {run}=app;
    s.section('theme preference');
    s.eq('defaults to system',run(`profileThemePref()`),'system');
    run(`window.profileSetTheme('dark')`);
    s.eq('dark sticks',run(`profileThemePref()`),'dark');
    s.eq('and is stamped on <html>',run(`document.documentElement.getAttribute('data-theme')`),'dark');
    run(`window.profileSetTheme('light')`);
    s.eq('light sticks',run(`profileThemePref()`),'light');
    s.eq('and is stamped too',run(`document.documentElement.getAttribute('data-theme')`),'light');
    run(`window.profileSetTheme('system')`);
    s.eq('system clears the stored value',run(`profileThemePref()`),'system');
    s.ok('and is not left in localStorage',!('groovy-theme' in store),JSON.stringify(store));
    store['groovy-theme']='purple';
    s.eq('a junk stored value falls back to system',run(`profileThemePref()`),'system');
    s.ok('the page shows the three choices',/profileSetTheme\('dark'\)/.test(run(`renderProfilePage()`)));
  }

  // ── Sync accounts ─────────────────────────────────────────────────────
  // The way out of the chicken-and-egg: a profile row is keyed by Firebase
  // uid, so an admin cannot edit anyone who has never signed in. The server
  // resolves email→uid with the Admin SDK and seeds the rows.
  {
    const admins=[['afnan','owner',true],['ammar','owner',true],
                  ['mustafa','manager',true],['arfat','manager',false],
                  ['uzaib','worker',false]];
    s.section('only the profile admins are offered Sync accounts');
    for(const [who,role,shown] of admins){
      const app=loadApp({files:FILES,currentPage:'profile',session:asUser(who,who,role)});
      await app.run(`loadProfiles(true)`);
      s.eq(who,/profileSyncAccounts/.test(app.run(`renderProfilePage()`)),shown);
    }

    // And the client refuses too, not just hides the button — the server
    // check is the real boundary, but a UI that fires a request it knows
    // will be refused is only a worse error message.
    const app=loadApp({files:FILES,currentPage:'profile',
      session:asUser('uzaib','Uzaib','worker'),
      globals:{fetch:async()=>{throw new Error('should never be called');}}});
    await app.run(`loadProfiles(true)`);
    await app.run(`window.profileSyncAccounts()`);
    s.section('a non-admin cannot call it anyway');
    s.ok('it refuses locally',app.state.toasts.join(' ').indexOf('Only owners')>=0,
      JSON.stringify(app.state.toasts));
  }

  // ── the page can never fail silently ──────────────────────────────────
  // A throw inside renderProfilePage used to leave the page exactly as it
  // was, so a button appeared to do nothing at all: no error, no clue,
  // nothing to report. That is the hardest kind of bug to get a report for.
  {
    const app=loadApp({files:FILES,currentPage:'profile'});
    const {run}=app;
    await run(`loadProfiles(true)`);
    run(`renderProfilePage=function(){throw new Error('boom from the renderer');}`);
    let threw=false;
    try{run(`_profileRerender()`);}catch(e){threw=true;}
    s.section('a render error is shown, not swallowed');
    s.ok('the rerender itself does not throw',!threw);
    const main=app.el('main-content');
    const text=n=>[(n.textContent||'')].concat((n.children||[]).map(text)).join(' ');
    const shown=text(main);
    s.ok('the page says it hit an error',/hit an error/.test(shown),shown.slice(0,140));
    s.ok('and names the cause',/boom from the renderer/.test(shown));
    s.ok('offering a way out',/Reload the page/.test(shown));
    // The message is built with createElement + textContent, never an HTML
    // string — an error can contain anything, including someone's markup.
    s.eq('nothing was interpolated into innerHTML',main.innerHTML,'');
  }

  // ── the photo is the way in ───────────────────────────────────────────
  // Reported as "nothing happens when I click the profile picture to edit",
  // and nothing did: in view mode it was a plain <img> with no handler at
  // all, so the most obvious control on the page was inert.
  {
    const app=loadApp({files:FILES,currentPage:'profile'});
    const {run}=app;
    await run(`loadProfiles(true)`);
    const view=run(`renderProfilePage()`);
    s.section('the profile picture is a button, not decoration');
    s.ok('it carries a click handler',/profile-photo-btn[^>]*onclick="window\.profileChangePhoto\(\)"/.test(view));
    s.ok('and says what it does',/Change photo/.test(view));

    // Clicking it must open the editor AND reach the file input in the same
    // gesture — a browser refuses a file dialog outside one.
    let clicked=0;
    run(`document.querySelector=function(sel){
      return /profile-photo-pick/.test(sel)?{click:function(){globalThis.__picked=(globalThis.__picked||0)+1;}}:null;
    }`);
    run(`window.profileChangePhoto()`);
    s.ok('the editor opened',!!run(`_profileEdit`));
    s.eq('and the file chooser was asked for, synchronously',run(`__picked||0`),1);

    s.section('a failing entry point reports itself');
    run(`_profileOpenEdit=function(){throw new Error('kaboom');}`);
    let threw=false;
    try{run(`window.profileStartEdit()`)}catch(e){threw=true;}
    s.ok('the button does not throw into the void',!threw);
    s.ok('the user is told',app.state.toasts.join(' ').indexOf('kaboom')>=0,
      JSON.stringify(app.state.toasts.slice(-1)));
  }

  return s;
};

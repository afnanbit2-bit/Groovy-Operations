/* ─────────────────────────────────────────────────────────────────────────
   Profile — js/profile.js

   The two things worth guarding here are the photo-URL allow-list (that
   string goes into an <img src>) and the textContent boundary (a display
   name is written by one person and read by every other one).
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

const FILES=['js/profile.js'];

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

  return s;
};

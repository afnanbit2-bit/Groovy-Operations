/* Groovy Operations — auth.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */

// Account directory: identity, role and permissions only.
// NEVER put a password in this file. It is a public static asset served to
// every visitor before login — anything here is readable by anyone on the
// internet. Passwords live in Firebase Auth and nowhere else. New accounts
// are created in the Firebase Console, then given an entry here.
const USER_DEFS=[
  {u:'afnan',  email:'afnan@groovy.op',  name:'Afnan',  role:'owner',  title:'Co-founder',        canPO:true, canFabric:true,  stages:null},
  {u:'ammar',  email:'ammar@groovy.op',  name:'Ammar',  role:'owner',  title:'Co-founder',        canPO:true, canFabric:true,  stages:null, canApprovePaidPR:true, canEditScoring:true},
  {u:'mustafa',email:'mustafa@groovy.op',name:'Mustafa',role:'manager',title:'Operations Manager',canPO:true, canFabric:true,  stages:null},
  {u:'arfat',  email:'arfat@groovy.op',  name:'Arfat',  role:'manager',title:'Advisory',          canPO:true, canFabric:true,  stages:null},
  {u:'raees',  email:'raees@groovy.op',  name:'Raees',  role:'store',  title:'Store Manager',     canPO:false,canFabric:false, stages:[]},
  {u:'haris',  email:'haris@groovy.op',  name:'Haris',  role:'worker', title:'QC Manager',        canPO:false,canFabric:false, stages:['qc']},
  {u:'abbas',  email:'abbas@groovy.op',  name:'Abbas',  role:'worker', title:'Washing Assistant', canPO:false,canFabric:false, stages:['washing']},
  {u:'waqas',  email:'waqas@groovy.op',  name:'Waqas',  role:'worker', title:'Stitching Incharge',canPO:false,canFabric:false, stages:['stitching']},
  {u:'asghar', email:'asghar@groovy.op', name:'Asghar', role:'worker', title:'Printing Manager',  canPO:false,canFabric:false, stages:['printing']},
  {u:'zohaib', email:'zohaib@groovy.op', name:'Zohaib', role:'worker', title:'Bundling Incharge',  canPO:false,canFabric:false, stages:['bundling']},
  {u:'uzaib',  email:'uzaib@groovy.op',  name:'Uzaib',  role:'viewer', title:'Cutting & Fabric',   canPO:false,canFabric:true,  stages:['cutting']},
  {u:'faizan', email:'faizan@groovy.op', name:'Faizan', role:'packing',title:'Packing & Dispatch', canPO:false,canFabric:false, stages:[]},
  {u:'umair',  email:'umair@groovy.op',  name:'Umair',  role:'fulfillment', title:'Fulfilment',    canPO:false,canFabric:false, stages:[]},
  // Marketing module (Sept 2026). Keep isContentOpsLead() in
  // firestore.rules in step with this email.
  {u:'daniyal',email:'daniyal@groovy.op',name:'Daniyal Tufail',role:'creator_content_ops_lead',title:'Creator & Content Operations Lead',canPO:false,canFabric:false,stages:[]},
  // Customer support (Sept 2026). A scoped, VIEW-ONLY role — see
  // CSR_LEAD_PAGES below and "CSR Team Lead" in CLAUDE.md.
  {u:'sami',   email:'sami@groovy.op',   name:'Sami',   role:'csr_lead', title:'CSR Team Lead',     canPO:false,canFabric:true,  stages:[]},
  // The Board (Sept 2026). Saim is a graphic designer: he needs the board
  // and nothing else, so he gets a role of his own rather than `manager`
  // (POs, gate passes, HRM, store) or `viewer` (a fixed 3-button phone nav
  // with no More sheet, and My Work, which means nothing to him). Scoped in
  // showPage to tb-* + the chrome pages; see DESIGNER_PAGES below.
  // NOTE the handle: `saim`, one letter from the existing `sami`. They are
  // two different people. Sami is not a Board user and is therefore never a
  // mention candidate inside The Board, so the two never appear in one list.
  {u:'saim',   email:'saim@groovy.op',   name:'Saim',   role:'designer', title:'Graphic Designer',  canPO:false,canFabric:false, stages:[]},
];

// ── CSR Team Lead (Sept 2026) ──
// Customer support needs to SEE production, QC outcomes, B-stock, fabric and
// stock levels to answer customers — not to change them. The role is scoped
// to exactly these pages in showPage (js/shared.js), and QC Disposition and
// Fabric Inventory hide their write actions for it (B-Stock already limits
// boxing and transfers to packing/owners/managers). Creative Hub children
// (notes, boards) are part of the hub. Firestore rules are unchanged: every
// collection these pages touch is already `signedIn()`, so this — like the
// other role scopes in this app — is an app-layer limit, not a rules one.
const CSR_LEAD_ROLE='csr_lead';
const CSR_LEAD_PAGES=['dashboard','qc-disposition','bstock','fabric-inventory','shopify-intel',
  'creative-hub','notes','note-detail','boards','boards-all','board-canvas'];
function isCsrLead(){ return !!(session && session.role===CSR_LEAD_ROLE); }

// == Designer (Sept 2026) ==
// One page list, one role, added for The Board. Everything tb-* plus the
// chrome pages (profile, bug tracker) that every role reaches. showPage
// (js/shared.js) rewrites anything else to the board's home, the same shape
// the fulfilment and CSR scopes use. Deliberately NOT given Creative Hub:
// widening that audience is one name in _CREATIVE_HUB_USERS (js/shared.js)
// plus its invariants assertion, and it has not been asked for.
const DESIGNER_ROLE='designer';
function isDesigner(){ return !!(session && session.role===DESIGNER_ROLE); }

// == The Board (Sept 2026) ==
// Audience by USERNAME here, mirrored BY EMAIL in firestore.rules
// (isBoardUser / isBoardOwner). A test in tests/theboard.test.js fails if
// the two ever disagree -- the guard isPaidPRApprover() and isScoringAdmin()
// already carry, and the only thing that keeps a nav grant and a rules
// grant from drifting apart.
//
// BOARD_OWNERS is not the app's `owner` role: it is who can override a
// lock, manage access and run the seed. It happens to be the same two
// people today, and is a separate list so that stays a decision rather
// than a coincidence.
//
// To widen: add the username here AND the email in firestore.rules.
const BOARD_OWNERS=['ammar','afnan'];
const BOARD_USERS=['ammar','afnan','daniyal','mustafa','saim'];
function isBoardUser(){  return !!(typeof session!=='undefined' && session && BOARD_USERS.indexOf(session.u)>-1); }
function isBoardOwner(){ return !!(typeof session!=='undefined' && session && BOARD_OWNERS.indexOf(session.u)>-1); }

// ── The Sales Team ▸ Marketing (Sept 2026) ──
// Access keys off ROLE, never a name: whoever holds creator_content_ops_lead
// gets the module. Paid PR approval is a per-account FLAG
// (canApprovePaidPR on the USER_DEFS entry) rather than a role, because the
// approver and the other owner share the `owner` role — moving the flag
// moves the approval right without touching any record. Mirrored in
// firestore.rules (isMarketing / isContentOpsLead / isPaidPRApprover — the
// last lists the EMAIL of every account carrying canApprovePaidPR; moving
// the flag means moving that email too, and a test fails until you do).
const MKT_LEAD_ROLE='creator_content_ops_lead';
function isContentOpsLead(){ return !!(session && session.role===MKT_LEAD_ROLE); }
function canAccessMarketing(){ return !!(session && (session.role==='owner' || session.role===MKT_LEAD_ROLE)); }
function canApprovePaidPR(){ return !!(session && session.canApprovePaidPR===true); }
// Scoring settings (the bands and tier thresholds every creator is scored
// by) are another per-account FLAG — Ammar only, not the other owner and
// not the lead. Mirrored in firestore.rules isScoringAdmin(), by email.
function canEditScoring(){ return !!(session && session.canEditScoring===true); }
// Packing/dispatch role (Faizan) — receives finished pieces, runs QC handoff
// reconciliation, and books stock transfers. Username/role gated.
function isPacking(){ return !!(session && session.role==='packing'); }
window.doLogin=async function(){
  const uEl=document.getElementById('l-user');
  const pEl=document.getElementById('l-pass');
  const u=uEl.value.trim().toLowerCase();
  const p=pEl.value;
  // Empty field validation with inline highlighting
  let valid=true;
  if(!u){uEl.classList.add('l-error');valid=false;}else{uEl.classList.remove('l-error');}
  if(!p){pEl.classList.add('l-error');valid=false;}else{pEl.classList.remove('l-error');}
  if(!valid){_loginShake();showToast('Please fill in both fields.',true);return;}
  const def=USER_DEFS.find(x=>x.u===u);
  if(!def){uEl.classList.add('l-error');_loginShake();showToast('Username not found.',true);return;}
  const btn=document.getElementById('login-btn');
  const _rm=document.getElementById('l-remember');
  const keep=!!(_rm&&_rm.checked);
  _loginBusy(btn,true);
  uEl.disabled=true;pEl.disabled=true;
  loginInProgress=true;
  try{
    // Remember me = STAY SIGNED IN. Local persistence survives closing the
    // app; session persistence ends with the tab. Set BEFORE signing in so
    // the new session is written to the right store. A build whose
    // index.html predates the bridge simply keeps Firebase's default.
    if(typeof setPersistence==='function'&&typeof browserLocalPersistence!=='undefined'){
      try{await setPersistence(auth,keep?browserLocalPersistence:browserSessionPersistence);}catch(_){}
    }
    const cred=await signInWithEmailAndPassword(auth,def.email,p);
    session={...def,uid:cred.user.uid};
    window._loginFailCount=0;
    _authStore('groovy-keep-signed-in',keep?'1':'0');
    if(keep)_authStore('groovy_remembered_user',u);
    else _authStore('groovy_remembered_user',null);
    // Offer the PHONE'S password manager the password (Chrome/Android shows
    // "Save password?"). Never awaited, never stored by us, and only when
    // the person asked to be remembered — an unticked box on a shared PC
    // must not leave a saved password behind.
    if(keep)_loginOfferSave(u,p,def.name);
    loginInProgress=false;
    startApp();
    logActivity('Login',`${def.name} signed in`);
    if(keep)setTimeout(()=>{try{_lockMaybeOffer();}catch(_){}},1500);
  }catch(e){
    loginInProgress=false;
    uEl.disabled=false;pEl.disabled=false;
    _loginBusy(btn,false);
    pEl.classList.add('l-error');
    window._loginFailCount=(window._loginFailCount||0)+1;
    _loginShake();
    let msg=e.code==='auth/wrong-password'||e.code==='auth/invalid-credential'
      ?'Wrong password. Try again.'
      :e.code==='auth/too-many-requests'
        ?'Too many attempts. Wait a few minutes, or ask Afnan or Ammar to reset it.'
        :(e.message||'').toLowerCase().includes('fetch')||e.code==='auth/network-request-failed'
          ?'No internet connection. Check your network.'
          :'Error: '+e.message;
    if(window._loginFailCount>=3&&e.code!=='auth/too-many-requests')msg+=' ('+window._loginFailCount+' attempts — check Caps Lock)';
    showToast(msg,true);
  }
};
function _loginBusy(btn,on){
  if(!btn)return;
  btn.disabled=on;
  const lab=document.getElementById('login-btn-label');
  if(lab)lab.textContent=on?'Signing in…':'Sign in';
  else btn.textContent=on?'Signing in…':'Sign in';
  btn.classList.toggle('busy',!!on);
}
function _loginOfferSave(u,p,name){
  try{
    if(typeof window.PasswordCredential!=='function'||!navigator.credentials||!navigator.credentials.store)return;
    navigator.credentials.store(new window.PasswordCredential({id:u,password:p,name:name||u})).catch(()=>{});
  }catch(_){}
}
window.doLogout=async function(){
  await signOut(auth);session=null;sessionStorage.clear();location.reload();
};


// The old in-app "first time setup" flow was removed: it shipped every
// account's password to the browser in order to create them via the Auth
// REST API. Create new accounts in the Firebase Console (Authentication →
// Add user), then add an entry to USER_DEFS above.

// ── App start & nav ──
async function startApp(){
  document.getElementById('scr-login').style.display='none';
  document.documentElement.classList.remove('gv-login');
  document.getElementById('scr-app').style.display='flex';
  document.getElementById('user-name').textContent=session.name;
  document.getElementById('user-title').textContent=session.title;
  sessionStorage.setItem('u',session.u);
  // Whatever name and photo this person chose on their Profile.
  //
  // NEVER AWAIT THIS. It was awaited when Profiles shipped, so that
  // session.name was settled before the first render — and it took the
  // whole app down: a Firestore getDoc that never SETTLES (not one that
  // rejects — a rejection was handled) left startApp parked forever, so
  // buildNav() and showPage() never ran. The topbar painted and everything
  // below it stayed white. Reported from a phone, reproduced in
  // tests/smoke-startapp.js, which now fails if anything is awaited here
  // again.
  //
  // The cost of not awaiting is that a chosen display name lands a moment
  // after the first paint. That is a flicker. The alternative was a blank
  // app. Nothing on the critical path may wait on the network.
  if(typeof profileBootstrap==='function'){try{profileBootstrap();}catch(_){}}
  // Marketing reminders + the lead's bell. Same rule: never awaited.
  if(typeof mktBootstrap==='function'){try{mktBootstrap();}catch(_){}}
  // Inject the notification bell for everyone (HRM notifs are routed by user/role).
  if(typeof _ensureNotifBell==='function')_ensureNotifBell();
  // Show the bug-report FAB for every signed-in user
  const bugFab=document.getElementById('bug-report-fab');
  if(bugFab)bugFab.style.display='flex';
  // Background-load bug reports so the dashboard widget can populate
  if(typeof loadBugReports==='function'&&!bugsLoaded)loadBugReports().catch(()=>{});
  if(session.role==='owner'){loadStoreNotifications();}
  buildNav();
  if(auth.currentUser){try{await auth.currentUser.getIdToken();}catch(_){}}
  // THE BOARD IS HOME for its five users (session 2, Ammar's decision 4):
  // the drop runs on it, so it is the first thing they see. Each role's
  // own data still loads exactly as before -- only the page they land on
  // changes, and every other account lands where it always did.
  // ONLY WHEN THE BOARD LOADED: if js/theboard.js failed to parse, four of
  // these five have a normal home, and landing them on "The Board did not
  // load" would strand them there (review of b43a3db). Saim has no other
  // page, and showPage's designer scope still sends him to the Board.
  const boardHome=(typeof isBoardUser==='function'&&isBoardUser()&&typeof tbRenderPage==='function')
    ?((typeof TB_HOME!=='undefined'&&TB_HOME)||'tb-dash'):null;
  if(session.role==='store'){
    loadStoreData();
    showPage('store-dashboard');
  }else if(session.role==='fulfillment'){
    // Fulfilment account (Umair) — scoped to Daily Performance only.
    showPage('fulfillment');
  }else if(session.role===MKT_LEAD_ROLE){
    // Creator & Content Operations Lead — The Sales Team ▸ Marketing and a
    // view-only Inventory Intel. No PO data is needed, so none is loaded.
    showPage(boardHome||'mkt-creators');
  }else if(session.role==='packing'){
    // Packing account (Faizan) — receives finished pieces against POs.
    loadData();
    showPage('packing');
  }else{
    loadData();
    showPage(boardHome||(session.role==='worker'?'my-work':'dashboard'));
  }
}

function renderUsers(){
  if(session.role!=='owner')return'<div class="empty">Owners only.</div>';
  return`<div class="page-head"><div class="page-title">Users</div><div class="page-sub">${USER_DEFS.length} accounts · Role-based access</div></div>
  <div class="card"><div class="card-title">User accounts</div>
    ${USER_DEFS.map(u=>`<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)">
      <div style="width:36px;height:36px;border-radius:50%;background:${u.role==='owner'?'var(--dark)':u.role==='manager'?'var(--red)':'var(--green)'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--on-dark);flex-shrink:0">${u.name[0]}</div>
      <div style="flex:1"><div style="font-weight:600;font-size:14px">${u.name} <span style="font-size:12px;font-weight:400;color:var(--muted)">@${u.u}</span></div><div style="font-size:12px;color:var(--muted)">${u.title}</div></div>
      <div style="text-align:right;flex-shrink:0"><div style="font-size:12px;font-weight:600;color:${u.role==='owner'?'var(--dark)':u.role==='manager'?'var(--red)':'var(--green)'};text-transform:capitalize">${u.role}</div><div style="font-size:11px;color:var(--muted);margin-top:1px">${u.canPO?'Can create PO':'View only'}</div></div>
      <button class="btn-outline" style="flex-shrink:0;padding:5px 10px;font-size:12px" onclick="window.openOwnerResetModal('${u.u}')">Reset password</button>
    </div>`).join('')}
  </div>
  <div class="card"><div class="card-title">Stage assignments</div>
    ${STAGES.map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);font-size:14px"><span style="font-weight:500">${s.label}</span><span style="font-weight:600;color:${s.color}">${s.owner}</span></div>`).join('')}
  </div>
  <div style="height:80px"></div>`;
}

// ── Change password (any signed-in user, self-service) ──
// Firebase Console's per-user "Reset password" only sends an email link,
// and the @groovy.op addresses are not real inboxes — so this is the only
// working way for anyone to change their password. Requires re-entering
// the CURRENT password (Firebase's own rule for a sensitive change), then
// sets the new one via the client SDK. No admin/server step needed.
window.openChangePasswordModal=function(){
  document.getElementById('cp-modal-back')?.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';back.id='cp-modal-back';
  back.onclick=ev=>{ if(ev.target===back)window.closeChangePasswordModal(); };
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:400px">
    <h3>Change password</h3>
    <div class="sub">Signed in as ${session.name} (@${session.u})</div>
    <div class="field" style="margin-bottom:12px"><label>Current password</label><input id="cp-current" type="password" autocomplete="current-password"></div>
    <div class="field" style="margin-bottom:12px"><label>New password</label><input id="cp-new" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
    <div class="field" style="margin-bottom:14px"><label>Confirm new password</label><input id="cp-confirm" type="password" autocomplete="new-password"></div>
    <div id="cp-error" style="display:none;color:var(--accent-urgent);font-size:13px;margin-bottom:12px;line-height:1.5"></div>
    <div style="display:flex;gap:10px">
      <button class="btn-outline" style="flex:1" onclick="window.closeChangePasswordModal()">Cancel</button>
      <button class="btn-primary" id="cp-submit-btn" style="flex:1;margin-top:0" onclick="window.submitChangePassword()">Change password</button>
    </div>
  </div>`;
  document.body.appendChild(back);
  document.getElementById('cp-current')?.focus();
};
window.closeChangePasswordModal=function(){
  document.getElementById('cp-modal-back')?.remove();
};
window.submitChangePassword=async function(){
  const cur=document.getElementById('cp-current').value;
  const next=document.getElementById('cp-new').value;
  const confirm=document.getElementById('cp-confirm').value;
  const errEl=document.getElementById('cp-error');
  const showErr=msg=>{errEl.textContent=msg;errEl.style.display='block';};
  errEl.style.display='none';
  if(!cur||!next||!confirm){showErr('Fill in all three fields.');return;}
  if(next.length<8){showErr('New password must be at least 8 characters.');return;}
  if(next!==confirm){showErr('New password and confirmation do not match.');return;}
  if(next===cur){showErr('New password must be different from your current one.');return;}
  const btn=document.getElementById('cp-submit-btn');
  btn.disabled=true;btn.textContent='Changing…';
  try{
    const cred=EmailAuthProvider.credential(session.email,cur);
    await reauthenticateWithCredential(auth.currentUser,cred);
    await updatePassword(auth.currentUser,next);
    window.closeChangePasswordModal();
    showToast('Password changed. Use your new password next time you sign in.');
    logActivity('Password changed',`${session.name} changed their password`).catch(()=>{});
  }catch(e){
    btn.disabled=false;btn.textContent='Change password';
    if(e.code==='auth/wrong-password'||e.code==='auth/invalid-credential')showErr('Current password is incorrect.');
    else if(e.code==='auth/weak-password')showErr('Firebase rejected that password as too weak — try a longer one.');
    else if(e.code==='auth/requires-recent-login')showErr('For security, please sign out, sign back in, then try again.');
    else showErr('Error: '+e.message);
  }
};

// ── Owner password reset (locked-out teammate) ──
// Change password (above) needs the CURRENT password, so it can't help
// someone locked out. This calls a server-side Netlify Function
// (netlify/functions/admin-reset-password.js) that verifies the caller is
// really an owner via their own Firebase ID token — never trust a
// client-asserted role for something this sensitive — then uses the Admin
// SDK to set the target's password directly. Owners page is already
// gated to session.role==='owner' in renderUsers(); this adds no new
// client-side gate because the function re-checks server-side regardless.
function _genPassword(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const bytes=new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>chars[b%chars.length]).join('');
}
window.openOwnerResetModal=function(username){
  const target=USER_DEFS.find(x=>x.u===username);
  if(!target)return;
  document.getElementById('or-modal-back')?.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';back.id='or-modal-back';
  back.dataset.targetEmail=target.email;
  back.onclick=ev=>{ if(ev.target===back)window.closeOwnerResetModal(); };
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:400px">
    <h3>Reset password</h3>
    <div class="sub">For ${target.name} (@${target.u}) — this sets it immediately, no email involved.</div>
    <div class="field" style="margin-bottom:8px"><label>New password</label>
      <div style="display:flex;gap:8px">
        <input id="or-new" type="text" autocomplete="off" placeholder="At least 8 characters" style="flex:1">
        <button type="button" class="btn-outline" style="flex-shrink:0;padding:0 12px" onclick="document.getElementById('or-new').value=window._genPassword_()">Generate</button>
      </div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.5">Copy this and share it with ${target.name} privately — direct message, not a group chat. It will not be shown again.</div>
    <div id="or-error" style="display:none;color:var(--accent-urgent);font-size:13px;margin-bottom:12px;line-height:1.5"></div>
    <div style="display:flex;gap:10px">
      <button class="btn-outline" style="flex:1" onclick="window.closeOwnerResetModal()">Cancel</button>
      <button class="btn-primary" id="or-submit-btn" style="flex:1;margin-top:0" onclick="window.submitOwnerReset('${target.u}')">Set password</button>
    </div>
  </div>`;
  document.body.appendChild(back);
  document.getElementById('or-new')?.focus();
};
window._genPassword_=_genPassword;
window.closeOwnerResetModal=function(){
  document.getElementById('or-modal-back')?.remove();
};
window.submitOwnerReset=async function(username){
  const target=USER_DEFS.find(x=>x.u===username);
  const newPassword=document.getElementById('or-new').value;
  const errEl=document.getElementById('or-error');
  const showErr=msg=>{errEl.textContent=msg;errEl.style.display='block';};
  errEl.style.display='none';
  if(!target){showErr('Unknown account.');return;}
  if(!newPassword||newPassword.length<8){showErr('Password must be at least 8 characters.');return;}
  const btn=document.getElementById('or-submit-btn');
  btn.disabled=true;btn.textContent='Setting…';
  try{
    const idToken=await auth.currentUser.getIdToken();
    const res=await fetch('/.netlify/functions/admin-reset-password',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({idToken,targetEmail:target.email,newPassword})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok){showErr(data.error||`Failed (${res.status}).`);btn.disabled=false;btn.textContent='Set password';return;}
    window.closeOwnerResetModal();
    showToast(`Password set for ${target.name}. Share it with them now — it won't be shown again.`);
    logActivity('Password reset by owner',`${session.name} reset the password for ${target.name}`).catch(()=>{});
  }catch(e){
    btn.disabled=false;btn.textContent='Set password';
    showErr('Network error: '+e.message);
  }
};

// Note: Firestore rules must allow authenticated reads/writes.
// Recommended: Firebase Console → Firestore → Rules:
// allow read, write: if request.auth != null;

// ── Login UX helpers ──
function _loginShake(){
  const box=document.querySelector('.login-box');
  if(!box)return;
  box.classList.remove('login-shake');
  void box.offsetWidth;
  box.classList.add('login-shake');
  box.addEventListener('animationend',()=>box.classList.remove('login-shake'),{once:true});
}
window._togglePass=function(){
  const inp=document.getElementById('l-pass');
  const btn=document.getElementById('pass-eye-btn');
  if(!inp)return;
  const showing=inp.type==='text';
  inp.type=showing?'password':'text';
  btn.innerHTML=showing
    ?'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
    :'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
};
window._checkCapsLock=function(e){
  const warn=document.getElementById('caps-warn');
  if(!warn)return;
  if(e.getModifierState&&e.getModifierState('CapsLock'))warn.classList.add('visible');
  else warn.classList.remove('visible');
};
// ══════════════════════════════════════════
// Login, persistence and the app lock (Sept 2026)
// ══════════════════════════════════════════
// Three rules this section holds:
//
// 1. THE APP NEVER STORES A PASSWORD. "Save password" is the phone's own
//    password manager (Google Password Manager, iCloud Keychain, Samsung
//    Pass) — the login is a real <form> with autocomplete attributes, and
//    on success the password is OFFERED to it through the Credential
//    Management API. The manager can ask for a fingerprint before it
//    fills, which is the phone's feature, not ours.
// 2. "Remember me" means STAY SIGNED IN. It used to remember only the
//    username: the session was restored only when sessionStorage (one tab)
//    still named the user, so closing the installed app signed everyone
//    out. The restore now resolves the account from the signed-in EMAIL
//    and respects the person's choice (_authRestoreDecision).
// 3. The fingerprint lock is an APP LOCK over a kept session, not a login.
//    WebAuthn with a platform authenticator (fingerprint / face / PIN) and
//    userVerification:'required'. Nothing is sent to a server and nothing
//    about the fingerprint ever reaches the app — the phone answers yes or
//    no. It guards an unattended phone; it does not replace the password
//    on a new device.
function _authStore(k,v){try{if(v==null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch(_){}}
function _authRead(k){try{return localStorage.getItem(k);}catch(_){return null;}}
function _authSessRead(k){try{return sessionStorage.getItem(k);}catch(_){return null;}}

// Which account a restored Firebase user is, and whether to let them in.
// PURE — every input is an argument, so the whole rule is testable.
//   user      {email}           the Firebase user being restored
//   tabU      sessionStorage 'u' (same tab: a reload, always allowed)
//   keepFlag  '1' | '0' | null  the Remember-me choice at last sign-in
//   rememberedU               the username saved by an older build
// → {def, allow, cold}. cold = a fresh app open (not a reload), which is
// when the app lock applies.
function _authRestoreDecision(user,tabU,keepFlag,rememberedU,defs){
  const list=defs||USER_DEFS;
  const email=String(user&&user.email||'').toLowerCase();
  const def=(email&&list.find(x=>String(x.email||'').toLowerCase()===email))
    ||(tabU&&list.find(x=>x.u===tabU))||null;
  if(!def)return{def:null,allow:false,cold:false};
  if(tabU&&tabU===def.u)return{def,allow:true,cold:false};
  // A session from before this shipped carries no flag: it was kept only
  // if the old build had remembered this username.
  const keep=keepFlag==='1'||(keepFlag==null&&rememberedU===def.u);
  return{def,allow:keep,cold:true};
}

// Remembered username, pre-fill, and the Remember-me box.
(function(){
  // Nothing behind the login may scroll (css: html.gv-login). Removed in
  // startApp; a sign-out reloads the page, which puts it back.
  try{document.documentElement.classList.add('gv-login');}catch(_){}
  const saved=_authRead('groovy_remembered_user');
  const r=document.getElementById('l-remember');
  if(r)r.checked=_authRead('groovy-keep-signed-in')!=='0';
  if(saved){
    const u=document.getElementById('l-user');
    if(u)u.value=saved;
    setTimeout(()=>{const p=document.getElementById('l-pass');if(p)p.focus();},60);
  }else{
    setTimeout(()=>{const u=document.getElementById('l-user');if(u)u.focus();},60);
  }
  _loginPaintTheme();
})();

window.loginForgot=function(){
  const h=document.getElementById('login-help');
  if(h)h.hidden=!h.hidden;
};

// The theme toggle on the login screen: Light → Dark → System. Writes the
// same key Profile → Appearance does, so the two can never disagree.
const _LOGIN_THEME_ORDER=['light','dark','system'];
function _loginThemePref(){
  if(typeof profileThemePref==='function')return profileThemePref();
  const v=_authRead('groovy-theme');return v==='dark'||v==='light'?v:'system';
}
function _loginPaintTheme(){
  const b=document.getElementById('login-theme-btn');
  if(!b)return;
  const pref=_loginThemePref();
  const icon={
    light:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>',
    system:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor"/></svg>'
  }[pref];
  b.innerHTML=icon+'<span>'+({light:'Light',dark:'Dark',system:'Auto'}[pref])+'</span>';
  b.setAttribute('aria-label','Theme: '+pref+'. Tap to change.');
}
window.loginCycleTheme=function(){
  const cur=_loginThemePref();
  const next=_LOGIN_THEME_ORDER[(_LOGIN_THEME_ORDER.indexOf(cur)+1)%_LOGIN_THEME_ORDER.length];
  _authStore('groovy-theme',next==='system'?null:next);
  if(typeof profileApplyTheme==='function')profileApplyTheme();
  _loginPaintTheme();
};

// ── The app lock ──
const _LOCK_KEY='groovy-applock';         // {uid:{id,u,at}} — THIS device only
const _LOCK_AFTER_MS=5*60*1000;           // background this long → lock again
const _LOCK_OFFERED_KEY='groovy-applock-offered';
function _lockAll(){try{return JSON.parse(_authRead(_LOCK_KEY)||'{}')||{};}catch(_){return{};}}
function _lockFor(uid){const a=_lockAll();return uid&&a[uid]&&a[uid].id?a[uid]:null;}
function lockEnabledFor(uid){return!!_lockFor(uid);}
function _lockSupported(){
  try{return!!(window.PublicKeyCredential&&navigator.credentials&&navigator.credentials.create&&window.isSecureContext!==false);}
  catch(_){return false;}
}
async function lockAvailable(){
  if(!_lockSupported())return false;
  try{return!!(await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());}
  catch(_){return false;}
}
function _b64u(buf){
  const b=new Uint8Array(buf);let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function _b64uDec(str){
  const s=String(str).replace(/-/g,'+').replace(/_/g,'/');
  const bin=atob(s+'==='.slice((s.length+3)%4));
  const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}
function _lockRandom(n){const a=new Uint8Array(n);crypto.getRandomValues(a);return a;}
// The authenticator data's flags byte (offset 32): bit 0 = user PRESENT,
// bit 2 = user VERIFIED. A tap on a security key is presence; only
// verification means a fingerprint, face or PIN was checked. Required.
function _lockUserVerified(authData){
  try{const b=new Uint8Array(authData);return b.length>32&&(b[32]&0x04)===0x04;}catch(_){return false;}
}

window.lockEnable=async function(){
  if(!session){showToast('Sign in first.',true);return false;}
  if(!(await lockAvailable())){showToast('This phone or browser cannot do a fingerprint lock.',true);return false;}
  try{
    const cred=await navigator.credentials.create({publicKey:{
      rp:{name:'Groovy Operations'},
      user:{id:_lockRandom(16),name:session.u,displayName:session.name||session.u},
      challenge:_lockRandom(32),
      pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
      authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'discouraged'},
      timeout:60000,attestation:'none'
    }});
    if(!cred||!cred.rawId)throw new Error('no credential');
    const all=_lockAll();
    all[session.uid]={id:_b64u(cred.rawId),u:session.u,at:Date.now()};
    _authStore(_LOCK_KEY,JSON.stringify(all));
    showToast('Fingerprint lock is on for this phone.');
    return true;
  }catch(e){
    showToast(e&&e.name==='NotAllowedError'?'Fingerprint lock was not turned on.':'Could not turn on the fingerprint lock: '+(e&&e.message||e),true);
    return false;
  }
};
window.lockDisable=function(){
  if(!session)return;
  const all=_lockAll();delete all[session.uid];
  _authStore(_LOCK_KEY,JSON.stringify(all));
  showToast('Fingerprint lock is off for this phone.');
};

let _lockPending=null;   // what to run once unlocked (the cold-start startApp)
let _lockShowing=false;
let _lockHiddenAt=0;
function _lockShow(def,onUnlock){
  _lockPending=onUnlock||null;
  _lockShowing=true;
  const scr=document.getElementById('scr-lock');
  if(!scr){_lockDone();return;}   // an old cached index.html: never strand anyone
  const n=document.getElementById('lock-name');
  if(n)n.textContent=((def&&def.name)||'').split(' ')[0]+'.';
  const m=document.getElementById('lock-msg');if(m)m.textContent='';
  scr.hidden=false;
  document.documentElement.classList.add('app-locked');
  // Try once without a tap; Safari needs a user gesture and will refuse,
  // which is fine — the button is right there.
  setTimeout(()=>{if(_lockShowing)window.lockUnlock(true);},250);
}
function _lockDone(){
  _lockShowing=false;
  const scr=document.getElementById('scr-lock');
  if(scr)scr.hidden=true;
  document.documentElement.classList.remove('app-locked');
  const f=_lockPending;_lockPending=null;
  if(f)f();
}
let _lockBusy=false;
window.lockUnlock=async function(auto){
  if(!_lockShowing||_lockBusy)return;
  const uid=(session&&session.uid)||(auth&&auth.currentUser&&auth.currentUser.uid);
  const rec=_lockFor(uid);
  const m=document.getElementById('lock-msg');
  if(!rec||!_lockSupported()){_lockDone();return;}   // lock record gone: nothing to guard
  _lockBusy=true;
  try{
    const res=await navigator.credentials.get({publicKey:{
      challenge:_lockRandom(32),
      allowCredentials:[{type:'public-key',id:_b64uDec(rec.id),transports:['internal']}],
      userVerification:'required',timeout:60000
    }});
    if(res&&res.response&&_lockUserVerified(res.response.authenticatorData)){_lockDone();return;}
    if(m)m.textContent='Your fingerprint was not checked. Try again.';
  }catch(e){
    if(m&&!auto)m.textContent=e&&e.name==='NotAllowedError'
      ?'Not unlocked. Tap the fingerprint to try again.'
      :'This phone could not check your fingerprint. Use your password instead.';
  }finally{_lockBusy=false;}
};
window.lockUsePassword=async function(){
  _lockPending=null;_lockShowing=false;
  const scr=document.getElementById('scr-lock');if(scr)scr.hidden=true;
  document.documentElement.classList.remove('app-locked');
  const u=(session&&session.u)||'';
  try{await signOut(auth);}catch(_){}
  session=null;
  try{sessionStorage.clear();}catch(_){}
  if(u)_authStore('groovy_remembered_user',u);
  location.reload();
};
// Coming back after a while in the background locks again — the banking
// app rule. A reload in the same tab does not (sessionStorage says so).
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){_lockHiddenAt=Date.now();return;}
  if(!session||_lockShowing||!lockEnabledFor(session.uid))return;
  if(_lockHiddenAt&&Date.now()-_lockHiddenAt>=_LOCK_AFTER_MS)_lockShow(session,null);
});
// After a password sign-in with Remember me on a phone that can do it,
// offer the lock ONCE per person per device.
async function _lockMaybeOffer(){
  if(!session||lockEnabledFor(session.uid))return;
  let offered={};try{offered=JSON.parse(_authRead(_LOCK_OFFERED_KEY)||'{}')||{};}catch(_){}
  if(offered[session.uid])return;
  if(!(await lockAvailable()))return;
  offered[session.uid]=Date.now();_authStore(_LOCK_OFFERED_KEY,JSON.stringify(offered));
  if(document.getElementById('lock-offer'))return;
  const d=document.createElement('div');
  d.id='lock-offer';d.className='lock-offer';
  d.innerHTML='<div class="lock-offer-t">Unlock with your fingerprint?</div>'
    +'<div class="lock-offer-s">You stay signed in on this phone. The app asks for your fingerprint, face or phone PIN when you open it. Change it any time in Profile.</div>'
    +'<div class="lock-offer-b"><button type="button" class="lock-offer-ghost" id="lock-offer-no">Not now</button><button type="button" class="btn-sm" id="lock-offer-yes">Turn on</button></div>';
  document.body.appendChild(d);
  d.querySelector('#lock-offer-no').onclick=()=>d.remove();
  d.querySelector('#lock-offer-yes').onclick=async()=>{d.remove();await window.lockEnable();};
}

// ══════════════════════════════════════════
// STORE — RENDER FUNCTIONS
// ══════════════════════════════════════════

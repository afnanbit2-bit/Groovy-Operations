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
  {u:'ammar',  email:'ammar@groovy.op',  name:'Ammar',  role:'owner',  title:'Co-founder',        canPO:true, canFabric:true,  stages:null},
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
];
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
  btn.disabled=true;btn.textContent='Signing in…';
  uEl.disabled=true;pEl.disabled=true;
  loginInProgress=true;
  try{
    const cred=await signInWithEmailAndPassword(auth,def.email,p);
    session={...def,uid:cred.user.uid};
    window._loginFailCount=0;
    const _rm=document.getElementById('l-remember');
    if(_rm&&_rm.checked)localStorage.setItem('groovy_remembered_user',u);
    else localStorage.removeItem('groovy_remembered_user');
    loginInProgress=false;
    startApp();
    logActivity('Login',`${def.name} signed in`);
  }catch(e){
    loginInProgress=false;
    uEl.disabled=false;pEl.disabled=false;
    btn.disabled=false;btn.textContent='Sign in';
    pEl.classList.add('l-error');
    window._loginFailCount=(window._loginFailCount||0)+1;
    _loginShake();
    let msg=e.code==='auth/wrong-password'||e.code==='auth/invalid-credential'
      ?'Wrong password. Try again.'
      :(e.message||'').toLowerCase().includes('fetch')
        ?'No internet connection. Check your network.'
        :'Error: '+e.message;
    if(window._loginFailCount>=3)msg+=' ('+window._loginFailCount+' attempts — check Caps Lock)';
    showToast(msg,true);
  }
};
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
  document.getElementById('scr-app').style.display='flex';
  document.getElementById('user-name').textContent=session.name;
  document.getElementById('user-title').textContent=session.title;
  sessionStorage.setItem('u',session.u);
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
  if(session.role==='store'){
    loadStoreData();
    showPage('store-dashboard');
  }else if(session.role==='fulfillment'){
    // Fulfilment account (Umair) — scoped to Daily Performance only.
    showPage('fulfillment');
  }else if(session.role==='packing'){
    // Packing account (Faizan) — receives finished pieces against POs.
    loadData();
    showPage('packing');
  }else{
    loadData();
    showPage(session.role==='worker'?'my-work':'dashboard');
  }
}

function renderUsers(){
  if(session.role!=='owner')return'<div class="empty">Owners only.</div>';
  return`<div class="page-head"><div class="page-title">Users</div><div class="page-sub">${USER_DEFS.length} accounts · Role-based access</div></div>
  <div class="card"><div class="card-title">User accounts</div>
    ${USER_DEFS.map(u=>`<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid #f5f5f5">
      <div style="width:36px;height:36px;border-radius:50%;background:${u.role==='owner'?'var(--dark)':u.role==='manager'?'var(--red)':'var(--green)'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0">${u.name[0]}</div>
      <div style="flex:1"><div style="font-weight:600;font-size:13px">${u.name} <span style="font-size:11px;font-weight:400;color:var(--muted)">@${u.u}</span></div><div style="font-size:11px;color:var(--muted)">${u.title}</div></div>
      <div style="text-align:right;flex-shrink:0"><div style="font-size:11px;font-weight:600;color:${u.role==='owner'?'var(--dark)':u.role==='manager'?'var(--red)':'var(--green)'};text-transform:capitalize">${u.role}</div><div style="font-size:10px;color:#aaa;margin-top:1px">${u.canPO?'Can create PO':'View only'}</div></div>
    </div>`).join('')}
  </div>
  <div class="card"><div class="card-title">Stage assignments</div>
    ${STAGES.map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #f5f5f5;font-size:13px"><span style="font-weight:500">${s.label}</span><span style="font-weight:600;color:${s.color}">${s.owner}</span></div>`).join('')}
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
    <div id="cp-error" style="display:none;color:#dc2626;font-size:12px;margin-bottom:12px;line-height:1.5"></div>
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
(function(){
  const saved=localStorage.getItem('groovy_remembered_user');
  if(saved){
    const u=document.getElementById('l-user');
    if(u){u.value=saved;const r=document.getElementById('l-remember');if(r)r.checked=true;}
    setTimeout(()=>{const p=document.getElementById('l-pass');if(p)p.focus();},60);
  }else{
    setTimeout(()=>{const u=document.getElementById('l-user');if(u)u.focus();},60);
  }
})();

// ══════════════════════════════════════════
// STORE — RENDER FUNCTIONS
// ══════════════════════════════════════════

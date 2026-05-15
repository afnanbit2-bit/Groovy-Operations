/* Groovy Operations — auth.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */

const USER_DEFS=[
  {u:'afnan',  email:'afnan@groovy.op',  name:'Afnan',  role:'owner',  title:'Co-founder',        canPO:true, stages:null,                 pass:'Afnan@Ops24'},
  {u:'ammar',  email:'ammar@groovy.op',  name:'Ammar',  role:'owner',  title:'Co-founder',        canPO:true, stages:null,                 pass:'WA$p6AMMR'},
  {u:'mustafa',email:'mustafa@groovy.op',name:'Mustafa',role:'manager',title:'Operations Manager',canPO:true, stages:null,                 pass:'Mustafa@Ops24'},
  {u:'arfat',  email:'arfat@groovy.op',  name:'Arfat',  role:'manager',title:'Advisory',          canPO:true, stages:null,                 pass:'Arfat@Ops24'},
  {u:'raees',  email:'raees@groovy.op',  name:'Raees',  role:'store',  title:'Store Manager',     canPO:false,stages:[],                   pass:'Raees@Ops24'},
  {u:'haris',  email:'haris@groovy.op',  name:'Haris',  role:'worker', title:'QC Manager',        canPO:false,stages:['qc'],               pass:'Haris@Ops24'},
  {u:'abbas',  email:'abbas@groovy.op',  name:'Abbas',  role:'worker', title:'Washing Assistant', canPO:false,stages:['washing'],          pass:'Abbas@Ops24'},
  {u:'waqas',  email:'waqas@groovy.op',  name:'Waqas',  role:'worker', title:'Stitching Incharge',canPO:false,stages:['stitching'],        pass:'Waqas@Ops24'},
  {u:'asghar', email:'asghar@groovy.op', name:'Asghar', role:'worker', title:'Printing Manager',  canPO:false,stages:['printing'],         pass:'Asghar@Ops24'},
  {u:'zohaib', email:'zohaib@groovy.op', name:'Zohaib', role:'worker', title:'Cutting & Bundling',canPO:false,stages:['cutting','bundling'],pass:'Zohaib@Ops24'},
];
window.doLogin=async function(){
  const u=document.getElementById('l-user').value.trim().toLowerCase();
  const p=document.getElementById('l-pass').value;
  const def=USER_DEFS.find(x=>x.u===u);
  if(!def){showToast('Username not found.',true);return;}
  const btn=document.getElementById('login-btn');
  btn.disabled=true;btn.textContent='Signing in…';
  loginInProgress=true;
  try{
    const cred=await signInWithEmailAndPassword(auth,def.email,p);
    session={...def,uid:cred.user.uid};
    loginInProgress=false;
    startApp();
    logActivity('Login',`${def.name} signed in`);
  }catch(e){
    loginInProgress=false;
    showToast(e.code==='auth/wrong-password'||e.code==='auth/invalid-credential'?'Wrong password. Try again.':'Error: '+e.message,true);
    btn.disabled=false;btn.textContent='Sign in';
  }
};
window.doLogout=async function(){
  await signOut(auth);session=null;sessionStorage.clear();location.reload();
};


// ── Setup ──
window.showSetup=function(){document.getElementById('scr-login').style.display='none';document.getElementById('scr-setup').style.display='flex';};
window.showLogin=function(){document.getElementById('scr-setup').style.display='none';document.getElementById('scr-login').style.display='flex';};

window.runSetup=async function(){
  const AUTH_URL='https://identitytoolkit.googleapis.com/v1/accounts';
  const code=document.getElementById('setup-code').value.trim();
  if(code!==SETUP_CODE){showToast('Wrong setup code.',true);return;}
  const btn=document.getElementById('setup-btn');
  const log=document.getElementById('setup-log');
  btn.disabled=true;btn.textContent='Creating accounts…';log.innerHTML='';
  let created=0,existed=0;
  for(const user of USER_DEFS){
    try{
      const r=await fetch(`${AUTH_URL}:signUp?key=${CFG.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.pass,returnSecureToken:false})});
      const d=await r.json();
      if(d.error&&d.error.message==='EMAIL_EXISTS'){log.innerHTML+=`<div style="color:#6b7280">• ${user.name} — already exists ✓</div>`;existed++;}
      else if(d.error&&d.error.message==='CONFIGURATION_NOT_FOUND'){
        log.innerHTML=`<div style="color:#dc2626;font-weight:600;padding:10px;background:#fef2f2;border-radius:8px;line-height:1.7">⚠️ <strong>Email/Password auth not enabled.</strong><br>Firebase Console → Authentication → Sign-in method → Enable Email/Password</div>`;
        btn.disabled=false;btn.textContent='Try again';return;
      }else if(d.error){log.innerHTML+=`<div style="color:#dc2626">• ${user.name} — ${d.error.message}</div>`;}
      else{log.innerHTML+=`<div style="color:#1D9E75">• ${user.name} — created ✓</div>`;created++;}
    }catch(e){log.innerHTML+=`<div style="color:#dc2626">• ${user.name} — ${e.message}</div>`;}
  }
  if(created+existed===USER_DEFS.length){log.innerHTML+=`<div style="margin-top:8px;font-weight:700;color:#1D9E75">Done! Go back and sign in.</div>`;btn.textContent='Complete';}
  else if(created+existed>0){log.innerHTML+=`<div style="margin-top:8px;font-weight:600;color:var(--amber)">Partial success — check errors above.</div>`;btn.textContent='Complete';}
  else{log.innerHTML+=`<div style="margin-top:8px;font-weight:700;color:#dc2626">Setup failed. Fix errors above and try again.</div>`;btn.disabled=false;btn.textContent='Try again';}
};

// ── App start & nav ──
async function startApp(){
  document.getElementById('scr-login').style.display='none';
  document.getElementById('scr-setup').style.display='none';
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
  <div class="card"><div class="card-title">Default passwords</div>
    <div style="font-size:12px;line-height:2;color:var(--muted)">${USER_DEFS.map(u=>`<div><strong style="color:var(--text)">${u.u}</strong> → ${u.pass}</div>`).join('')}</div>
  </div><div style="height:80px"></div>`;
}

// Note: Firestore rules must allow authenticated reads/writes.
// Recommended: Firebase Console → Firestore → Rules:
// allow read, write: if request.auth != null;

// ══════════════════════════════════════════
// STORE — RENDER FUNCTIONS
// ══════════════════════════════════════════

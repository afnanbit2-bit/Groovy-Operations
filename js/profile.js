/* ─────────────────────────────────────────────────────────────────────────
   Profile — one page per signed-in person (Sept 2026)

   Afnan asked for "a general Profile for each login where people can add
   their picture, change name, document info such as CNIC number, emergency
   number, full address". That second half was raised as a problem and
   dropped by agreement: `user_profiles` is readable by EVERY signed-in
   user, so a CNIC, a home address or a next-of-kin number put here would
   be readable by every worker with an account. Identity documents belong
   in the HRM `employees` records, behind the owner/manager gates that
   already exist — not in a directory.

   So this file holds only what a colleague may see: a photo, the name you
   want to be called, a job title, a department and a short line about what
   you do. The page says so out loud, because a field that LOOKS free-form
   is exactly where someone will type their CNIC if nothing tells them not
   to.

   Storage: user_profiles/{uid}, one doc per Firebase uid, keyed by uid and
   never by username — usernames are a display-layer thing in USER_DEFS and
   a person's Firebase identity is the only stable one. `firestore.rules`
   lets anyone signed in READ, only the owner of the uid WRITE, and app
   owners DELETE (moderation, matching the fabricin/loans pattern).
   ───────────────────────────────────────────────────────────────────────── */

let userProfiles=[];          // the whole directory, loaded once per visit
let profilesLoaded=false;
let _profileLoadErr=null;
let _profileEdit=null;        // the draft being edited, or null when viewing
let _profileSaving=false;

const _PROFILE_DEPARTMENTS=['','Operations','Production','Cutting','Stitching',
  'Printing & Embellishments','Quality Control','Store & Inventory','Fabric',
  'Dispatch & Fulfilment','HR & Admin','Accounts','Design','E-commerce'];

function _profEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function _profTrim(v,max){return String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);}

// A Cloudinary delivery URL and nothing else. A photo URL is written into
// an <img src> and into a CSS background, so an arbitrary stored string is
// not something to hand over untested — the same reasoning as
// _boardsValidHex in js/boards.js.
function _profPhotoUrl(u){
  const s=String(u||'').trim();
  return /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_\-./%,:]+$/.test(s)?s:'';
}
// Sized derivative, same trick js/boards.js uses — a 400px avatar has no
// business shipping a 3000px original.
function _profAvatarUrl(u,px){
  const s=_profPhotoUrl(u);
  if(!s||s.indexOf('/upload/')===-1)return s;
  if(/\/upload\/(f_|q_|w_|c_|dpr_)/.test(s))return s;
  const w=px<=64?128:px<=160?320:640;
  return s.replace('/upload/','/upload/f_auto,q_auto,c_fill,g_face,w_'+w+',h_'+w+'/');
}

// The profile for a uid, or null. Used by the page and by startApp.
function profileFor(uid){
  return userProfiles.find(p=>p.uid===uid)||null;
}
// The name to show for someone: what they chose, else what USER_DEFS says.
function profileDisplayName(uid,fallback){
  const p=profileFor(uid);
  return(p&&p.displayName)||fallback||'';
}

// Loader. Called from renderPage, so per the rule in CLAUDE.md ("a loader
// called from renderPage must handle its own failure") this CANNOT reject —
// the dispatch line has no .catch and the page would sit on its skeleton
// forever.
async function loadProfiles(force){
  if(profilesLoaded&&!force)return;
  _profileLoadErr=null;
  try{
    const snap=await getDocs(collection(db,'user_profiles'));
    userProfiles=snap.docs.map(d=>Object.assign({uid:d.id},d.data()));
    profilesLoaded=true;
  }catch(e){
    _profileLoadErr=e&&e.message?e.message:String(e);
    userProfiles=[];
  }
}

// ── The page ──
function renderProfilePage(){
  if(!session)return'';
  const me=profileFor(session.uid)||{};
  const editing=!!_profileEdit;
  return`<div class="page-head"><h2>Profile</h2></div>
    ${_profileLoadErr?`<div class="card" style="border-color:var(--accent-urgent)">
      <div style="font-weight:700;margin-bottom:6px">Could not load profiles</div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">${_profEsc(_profileLoadErr)}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">If this says permissions, republish <code>firestore.rules</code> from the repo — <code>user_profiles</code> is new.</div>
      <button class="btn-sm" onclick="window.profileRetry()">Retry</button>
    </div>`:''}
    ${editing?_profileEditCardHTML():_profileViewCardHTML(me)}
    ${_profileDirectoryHTML()}`;
}

function _profileViewCardHTML(p){
  const photo=_profAvatarUrl(p.photoUrl,160);
  return`<div class="card profile-card">
    <div class="profile-head">
      ${photo?`<img class="profile-photo" src="${_profEsc(photo)}" alt="" referrerpolicy="no-referrer">`
             :`<div class="profile-photo profile-photo-empty">${_profEsc((session.name||'?').charAt(0).toUpperCase())}</div>`}
      <div class="profile-id">
        <div class="profile-name" id="prof-name"></div>
        <div class="profile-sub" id="prof-sub"></div>
        <div class="profile-sub" style="margin-top:4px">@${_profEsc(session.u||'')} · ${_profEsc(session.title||'')}</div>
      </div>
    </div>
    <div class="profile-about" id="prof-about"></div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-sm" onclick="window.profileStartEdit()">Edit profile</button>
      <button class="btn-sm" onclick="window.openChangePasswordModal()">Change password</button>
    </div>
  </div>`;
}

function _profileEditCardHTML(){
  const d=_profileEdit;
  const photo=_profAvatarUrl(d.photoUrl,160);
  return`<div class="card profile-card">
    <div class="profile-head">
      <label class="profile-photo-pick" title="Choose a photo">
        ${photo?`<img class="profile-photo" src="${_profEsc(photo)}" alt="" referrerpolicy="no-referrer">`
               :`<div class="profile-photo profile-photo-empty">${d._uploading?'…':'+'}</div>`}
        <input type="file" accept="image/*" style="display:none" onchange="window.profilePickPhoto(this)">
        <span class="profile-photo-hint">${d._uploading?'Uploading…':'Change'}</span>
      </label>
      <div class="profile-id" style="flex:1;min-width:0">
        <label class="profile-label">Name people see</label>
        <input type="text" class="profile-input" id="prof-in-name" maxlength="60" value="${_profEsc(d.displayName||'')}" placeholder="${_profEsc(session.name||'')}" oninput="window.profileField('displayName',this.value)">
        <div class="profile-hint">Leave blank to keep “${_profEsc(session.name||'')}”.</div>
      </div>
    </div>
    <div class="profile-grid">
      <div>
        <label class="profile-label">Job title</label>
        <input type="text" class="profile-input" maxlength="60" value="${_profEsc(d.jobTitle||'')}" placeholder="e.g. Production Supervisor" oninput="window.profileField('jobTitle',this.value)">
      </div>
      <div>
        <label class="profile-label">Department</label>
        <select class="profile-input" onchange="window.profileField('department',this.value)">
          ${_PROFILE_DEPARTMENTS.map(x=>`<option value="${_profEsc(x)}"${(d.department||'')===x?' selected':''}>${x?_profEsc(x):'—'}</option>`).join('')}
        </select>
      </div>
    </div>
    <label class="profile-label" style="margin-top:12px">About</label>
    <textarea class="profile-input" rows="3" maxlength="240" placeholder="What you work on. One or two lines." oninput="window.profileField('about',this.value)">${_profEsc(d.about||'')}</textarea>
    <div class="profile-warn">
      <strong>Everyone signed in can see this page.</strong> Don’t put a CNIC,
      home address, bank details or a personal emergency number here — those
      belong in your HRM employee record, which only the owners and HR can open.
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-sm" onclick="window.profileSave()"${_profileSaving?' disabled':''}>${_profileSaving?'Saving…':'Save'}</button>
      <button class="btn-sm" onclick="window.profileCancelEdit()">Cancel</button>
    </div>
  </div>`;
}

function _profileDirectoryHTML(){
  // Everyone with a profile, plus everyone in USER_DEFS who hasn't made one
  // yet — a directory that only lists the keen is not a directory.
  const defs=(typeof USER_DEFS!=='undefined'?USER_DEFS:[]);
  const rows=defs.map(u=>{
    const p=userProfiles.find(x=>x.username===u.u)||{};
    return{username:u.u,fallbackName:u.name,title:u.title,p};
  }).sort((a,b)=>(a.p.displayName||a.fallbackName||'').localeCompare(b.p.displayName||b.fallbackName||''));
  if(!rows.length)return'';
  return`<div class="card">
    <div style="font-weight:700;margin-bottom:4px">Team</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">${rows.length} accounts. Only the person themselves can edit their profile.</div>
    <div class="profile-dir">
      ${rows.map((r,i)=>{
        const photo=_profAvatarUrl(r.p.photoUrl,64);
        const sub=[r.p.jobTitle,r.p.department].filter(Boolean).join(' · ')||r.title||'';
        return`<div class="profile-dir-row">
          ${photo?`<img class="profile-dir-photo" src="${_profEsc(photo)}" alt="" referrerpolicy="no-referrer">`
                 :`<div class="profile-dir-photo profile-photo-empty"></div>`}
          <div style="min-width:0">
            <div class="profile-dir-name" id="prof-dir-n-${i}"></div>
            <div class="profile-dir-sub" id="prof-dir-s-${i}"></div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// User-authored strings are written in AFTER the structure renders, via
// textContent — the same stored-XSS boundary Notes' blocks, board cards and
// board comments hold. A display name and an "about" line are written by one
// user and read by every other one.
function _profileHydrate(){
  if(!session)return;
  const me=profileFor(session.uid)||{};
  const n=document.getElementById('prof-name');
  if(n)n.textContent=me.displayName||session.name||'';
  const s=document.getElementById('prof-sub');
  if(s)s.textContent=[me.jobTitle,me.department].filter(Boolean).join(' · ')||'No job title set yet';
  const a=document.getElementById('prof-about');
  if(a)a.textContent=me.about||'';
  const defs=(typeof USER_DEFS!=='undefined'?USER_DEFS:[]);
  const rows=defs.map(u=>{
    const p=userProfiles.find(x=>x.username===u.u)||{};
    return{fallbackName:u.name,title:u.title,p};
  }).sort((a2,b2)=>(a2.p.displayName||a2.fallbackName||'').localeCompare(b2.p.displayName||b2.fallbackName||''));
  rows.forEach((r,i)=>{
    const ne=document.getElementById('prof-dir-n-'+i);
    if(ne)ne.textContent=r.p.displayName||r.fallbackName||'';
    const se=document.getElementById('prof-dir-s-'+i);
    if(se)se.textContent=[r.p.jobTitle,r.p.department].filter(Boolean).join(' · ')||r.title||'';
  });
}

function _profileRerender(){
  const m=document.getElementById('main-content');
  if(!m)return;
  m.innerHTML=renderProfilePage();
  _profileHydrate();
}

// ── Actions ──
window.profileRetry=async function(){
  await loadProfiles(true);
  _profileRerender();
};
window.profileStartEdit=function(){
  const me=profileFor(session.uid)||{};
  _profileEdit={
    displayName:me.displayName||'',jobTitle:me.jobTitle||'',
    department:me.department||'',about:me.about||'',photoUrl:me.photoUrl||''
  };
  _profileRerender();
};
window.profileCancelEdit=function(){_profileEdit=null;_profileRerender();};
// Typing mutates the draft in place with no rerender — the same
// cursor-stability reason Notes' block editor and the board's text cards
// don't rerender per keystroke.
window.profileField=function(k,v){if(_profileEdit)_profileEdit[k]=v;};

window.profilePickPhoto=async function(input){
  const f=input.files&&input.files[0];
  if(!f||!_profileEdit)return;
  input.value='';
  _profileEdit._uploading=true;_profileRerender();
  try{
    const url=await uploadToCloudinary(f);
    _profileEdit.photoUrl=url;
  }catch(e){showToast('Photo upload failed: '+(e.message||e),true);}
  // _-prefixed transient field, stripped before the write — same convention
  // as _uploading on board cards, and for the same reason: a saved
  // _uploading:true would show "Uploading…" forever.
  delete _profileEdit._uploading;
  _profileRerender();
};

window.profileSave=async function(){
  if(!_profileEdit||_profileSaving||!session)return;
  _profileSaving=true;_profileRerender();
  const d=_profileEdit;
  const payload={
    uid:session.uid,username:session.u,
    displayName:_profTrim(d.displayName,60),
    jobTitle:_profTrim(d.jobTitle,60),
    department:_profTrim(d.department,60),
    about:_profTrim(d.about,240),
    photoUrl:_profPhotoUrl(d.photoUrl),
    updatedAt:Date.now()
  };
  try{
    await setDoc(doc(db,'user_profiles',session.uid),payload);
    const i=userProfiles.findIndex(p=>p.uid===session.uid);
    if(i>=0)userProfiles[i]=payload;else userProfiles.push(payload);
    _profileEdit=null;
    profileApplyToSession();
    logActivity('Profile updated',`${session.name} updated their profile`);
    showToast('Profile saved');
  }catch(e){
    showToast('Could not save profile: '+(e.message||e),true);
  }
  _profileSaving=false;
  _profileRerender();
};

// ── The topbar ──
// Applies whatever the person chose to the running session and repaints the
// topbar. Called from startApp (after the profile load) and after a save.
// session.name is what logActivity, presence and board comments write, so a
// chosen name follows the person everywhere without any of those learning
// about profiles.
function profileApplyToSession(){
  if(!session)return;
  const p=profileFor(session.uid);
  if(p&&p.displayName)session.name=p.displayName;
  if(p&&p.jobTitle)session.jobTitle=p.jobTitle;
  session.photoUrl=p?_profPhotoUrl(p.photoUrl):'';
  const n=document.getElementById('user-name');
  if(n)n.textContent=session.name||'';
  _profilePaintAvatar();
}
function _profilePaintAvatar(){
  const btn=document.getElementById('topbar-avatar');
  if(!btn||!session)return;
  const url=_profAvatarUrl(session.photoUrl,64);
  btn.innerHTML=url
    ?`<img src="${_profEsc(url)}" alt="" referrerpolicy="no-referrer">`
    :_profEsc((session.name||'?').charAt(0).toUpperCase());
  btn.title='Your profile';
}
// Loads this person's profile at sign-in. Deliberately a single-document
// read, not the whole directory: the directory is only needed once the
// Profile page is actually opened.
//
// Called WITHOUT await from startApp (js/auth.js) — see the note there.
// It races a timeout as well, so a read that never settles cannot hold a
// reference to this session forever; a late arrival still repaints, since
// profileApplyToSession only touches the topbar.
const _PROFILE_BOOT_TIMEOUT=8000;
async function profileBootstrap(){
  if(!session||!session.uid)return;
  try{
    const snap=await Promise.race([
      getDoc(doc(db,'user_profiles',session.uid)),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('profile read timed out')),_PROFILE_BOOT_TIMEOUT))
    ]);
    if(snap&&snap.exists()){
      const p=Object.assign({uid:session.uid},snap.data());
      const i=userProfiles.findIndex(x=>x.uid===p.uid);
      if(i>=0)userProfiles[i]=p;else userProfiles.push(p);
    }
  }catch(e){/* a missing profile, or rules not yet republished — neither is fatal */}
  profileApplyToSession();
}

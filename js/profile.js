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
   want to be called, a job title, a department, a short line about what
   you do, and a name colour.

   Storage: user_profiles/{uid}, one doc per Firebase uid, keyed by uid and
   never by username — usernames are a display-layer thing in USER_DEFS and
   a person's Firebase identity is the only stable one.

   ── Admin editing (Sept 2026) ──────────────────────────────────────────
   Afnan asked for himself, Ammar and Mustafa to be able to edit other
   people's profiles and reset their passwords, with Mustafa explicitly
   NOT able to touch his or Ammar's. That is `_PROFILE_ADMINS` /
   `_PROFILE_PROTECTED` below, scoped BY USERNAME exactly like the other
   Sept 2026 grants (`isMustafa()`, `_canManageLoans`, `_fabCanDelete`) —
   never by role, because Arfat holds the same `manager` role and must not
   inherit any of it.

   Three layers have to agree and all three are enforced independently:
     1. this file          — what the UI offers
     2. `firestore.rules`  — the profile write itself (the real boundary)
     3. `netlify/functions/admin-reset-password.js` — the password reset,
        which verifies the caller's own ID token server-side
   Change one, change all three.

   ── The uid problem, and how it is solved ──────────────────────────────
   Editing someone else's profile means writing `user_profiles/{theirUid}`,
   and nothing client-side maps a username to a Firebase uid — there is no
   directory and the Admin SDK is the only thing that could build one.
   So every account SEEDS ITS OWN ROW at sign-in (`profileBootstrap`): a
   one-off `{uid, username}` write the first time someone signs in with no
   profile doc, made by that person under the existing self-write rule.
   From then on the uid is in `user_profiles` and an admin can edit them.
   Someone who has never signed in since this shipped has no row yet and
   the directory says so rather than offering a button that cannot work.
   Their PASSWORD can still be reset — that path goes by email, not uid.
   ───────────────────────────────────────────────────────────────────────── */

let userProfiles=[];          // the whole directory, loaded once per visit
let profilesLoaded=false;
let _profileLoadErr=null;
let _profileEdit=null;        // the draft being edited, or null when viewing
let _profileSaving=false;

const _PROFILE_DEPARTMENTS=['','Operations','Production','Cutting','Stitching',
  'Printing & Embellishments','Quality Control','Store & Inventory','Fabric',
  'Dispatch & Fulfilment','HR & Admin','Accounts','Design','E-commerce'];

// Who may edit someone else's profile, and who they may not touch.
// By username, deliberately — see the header note.
const _PROFILE_ADMINS=['afnan','ammar','mustafa'];
const _PROFILE_PROTECTED=['afnan','ammar'];   // only an owner edits an owner

// Preset name colours. Drawn from the palette already in css/main.css
// (the semantic accents and the Creative Hub category accents) so a name
// colour looks like it belongs to this app rather than a random swatch.
const _PROFILE_NAME_COLORS=['#111111','#7B1F2A','#B47512','#14532D','#35507A',
  '#7A4B7C','#3E6B6B','#6B5738','#8A3324','#2F4858','#4A4A4A','#8C2F62'];

function _profEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function _profTrim(v,max){return String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);}

// Colour validation reuses _boardsValidHex / _boardsInkOn from js/boards.js,
// which loads immediately before this file — classic scripts share one
// lexical scope, so they are reachable by bare name. Guarded so that if
// boards.js ever fails to parse, a stored colour simply does not render:
// it must NEVER fall through unvalidated into a style attribute. Fail
// closed, and no second copy of a validator to keep in step.
function _profHex(v){return typeof _boardsValidHex==='function'?_boardsValidHex(v):'';}
function _profInk(hex){return typeof _boardsInkOn==='function'?_boardsInkOn(hex):'var(--text)';}

// A Cloudinary delivery URL and nothing else. A photo URL is written into
// an <img src> and into a CSS background, so an arbitrary stored string is
// not something to hand over untested — same reasoning as _boardsValidHex.
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
function profileForUsername(username){
  return userProfiles.find(p=>p.username===username)||null;
}
// The name to show for someone: what they chose, else what USER_DEFS says.
function profileDisplayName(uid,fallback){
  const p=profileFor(uid);
  return(p&&p.displayName)||fallback||'';
}
// The colour assigned to a person's name, or '' if they have none.
// Exposed for future use — the activity log, board presence and comments
// all carry a person's name and can tint it from here without learning
// anything about profiles.
window.profileNameColor=function(username){
  const p=profileForUsername(username);
  return p?_profHex(p.nameColor):'';
};

// ── Permissions ──
function _profIsAdmin(){
  return !!(session&&_PROFILE_ADMINS.indexOf(session.u)>=0);
}
// May the signed-in person edit this account's profile?
function _profCanEditUser(username){
  if(!session||!username)return false;
  if(username===session.u)return true;                 // always your own
  if(!_profIsAdmin())return false;
  // Mustafa may edit every other employee, but not the two owners.
  if(_PROFILE_PROTECTED.indexOf(session.u)<0&&_PROFILE_PROTECTED.indexOf(username)>=0)return false;
  return true;
}
// May the signed-in person set this account's password directly?
// Your own goes through Change password (which requires the current one),
// so this is only about OTHER people.
function _profCanResetPassword(username){
  return !!session&&username!==session.u&&_profCanEditUser(username);
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
  return`<div class="page-head"><h2>Profile</h2></div>
    ${_profileLoadErr?`<div class="card" style="border-color:var(--accent-urgent)">
      <div style="font-weight:700;margin-bottom:6px">Could not load profiles</div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">${_profEsc(_profileLoadErr)}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">If this says permissions, republish <code>firestore.rules</code> from the repo — <code>user_profiles</code> is new.</div>
      <button class="btn-sm" onclick="window.profileRetry()">Retry</button>
    </div>`:''}
    ${_profileEdit?_profileEditCardHTML():_profileViewCardHTML(me)}
    ${_profileAppearanceHTML()}
    ${_profileDirectoryHTML()}`;
}

function _profileViewCardHTML(p){
  const photo=_profAvatarUrl(p.photoUrl,160);
  const col=_profHex(p.nameColor);
  // The picture is a BUTTON, not decoration. Afnan reported "nothing happens
  // when I click on the profile picture to edit" — and nothing did: in view
  // mode it was a plain <img> with no handler, so the most obvious thing in
  // the world to click was inert. It now opens the editor and goes straight
  // to the file chooser, which is what clicking your own photo means.
  return`<div class="card profile-card">
    <div class="profile-head">
      <button type="button" class="profile-photo-btn" onclick="window.profileChangePhoto()" title="Change your photo">
        ${photo?`<img class="profile-photo" src="${_profEsc(photo)}" alt="" referrerpolicy="no-referrer" draggable="false">`
               :`<div class="profile-photo profile-photo-empty">${_profEsc((session.name||'?').charAt(0).toUpperCase())}</div>`}
        <span class="profile-photo-over">Change photo</span>
      </button>
      <div class="profile-id">
        <div class="profile-name" id="prof-name"${col?` style="color:${col}"`:''}></div>
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
  const self=d.username===session.u;
  const def=(typeof USER_DEFS!=='undefined'?USER_DEFS:[]).find(x=>x.u===d.username)||{};
  const col=_profHex(d.nameColor);
  return`<div class="card profile-card${self?'':' profile-card-admin'}">
    ${self?'':`<div class="profile-admin-banner">
      Editing <strong>${_profEsc(def.name||d.username)}</strong>'s profile as ${_profEsc(session.name||session.u)}.
      They will see these changes everywhere their name appears.
    </div>`}
    <div class="profile-head">
      <label class="profile-photo-pick" title="Choose a photo">
        ${photo?`<img class="profile-photo" src="${_profEsc(photo)}" alt="" referrerpolicy="no-referrer">`
               :`<div class="profile-photo profile-photo-empty">${d._uploading?'…':'+'}</div>`}
        <input type="file" accept="image/*" style="display:none" onchange="window.profilePickPhoto(this)">
        <span class="profile-photo-hint">${d._uploading?'Uploading…':'Change'}</span>
      </label>
      <div class="profile-id" style="flex:1;min-width:0">
        <label class="profile-label">Name people see</label>
        <input type="text" class="profile-input" id="prof-in-name" maxlength="60" value="${_profEsc(d.displayName||'')}" placeholder="${_profEsc(def.name||'')}" oninput="window.profileField('displayName',this.value)">
        <div class="profile-hint">Leave blank to keep “${_profEsc(def.name||'')}”.</div>
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

    <label class="profile-label" style="margin-top:12px">Name colour</label>
    <div class="profile-hint" style="margin-bottom:8px">Used wherever this person's name appears. Optional.</div>
    <div class="profile-swatches">
      ${_PROFILE_NAME_COLORS.map(c=>`<button type="button" class="profile-swatch${col===c?' on':''}" style="background:${c}" title="${c}" onclick="window.profileSetNameColor('${c}')"></button>`).join('')}
      <button type="button" class="profile-swatch profile-swatch-none${col?'':' on'}" title="No colour" onclick="window.profileSetNameColor('')">✕</button>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
      <input type="text" class="profile-input" style="max-width:140px" maxlength="7" placeholder="#RRGGBB" value="${_profEsc(col)}" oninput="window.profileSetNameColor(this.value,true)">
      <span class="profile-name-preview" id="prof-col-prev" style="${col?`color:${col}`:''}"></span>
    </div>

    <label class="profile-label" style="margin-top:12px">About</label>
    <textarea class="profile-input" rows="3" maxlength="240" placeholder="What you work on. One or two lines." oninput="window.profileField('about',this.value)">${_profEsc(d.about||'')}</textarea>

    <div class="profile-readonly">
      <div><span class="profile-label">Login ID</span><div class="profile-ro-val">@${_profEsc(d.username)}</div></div>
      <div><span class="profile-label">Sign-in email</span><div class="profile-ro-val">${_profEsc(def.email||'')}</div></div>
      <div><span class="profile-label">Role</span><div class="profile-ro-val">${_profEsc(def.role||'')}</div></div>
      <div class="profile-hint" style="grid-column:1/-1;margin-top:6px">
        The login ID and sign-in email cannot be changed from here. They are a
        Firebase Auth account plus an entry in <code>USER_DEFS</code>, so
        changing one is a code change and a Console change — ask for it and
        it gets done properly rather than half-done.
      </div>
    </div>

    <div class="profile-warn">
      <strong>Everyone signed in can see this page.</strong> Don’t put a CNIC,
      home address, bank details or a personal emergency number here — those
      belong in the HRM employee record, which only the owners and HR can open.
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-sm" onclick="window.profileSave()"${_profileSaving?' disabled':''}>${_profileSaving?'Saving…':'Save'}</button>
      <button class="btn-sm" onclick="window.profileCancelEdit()">Cancel</button>
      ${_profCanResetPassword(d.username)?`<button class="btn-sm" onclick="window.openOwnerResetModal('${_profEsc(d.username)}')">Set their password</button>`:''}
    </div>
  </div>`;
}

// ── Appearance (dark / light / system) ──
// Asked for on this page specifically. The preference is per-device
// (localStorage), never on the profile document — a theme is about the
// screen you are looking at, not about who you are, and storing it on the
// doc would carry your choice onto someone else's phone.
function _profileAppearanceHTML(){
  const pref=profileThemePref();
  const opt=(v,label,sub)=>`<button type="button" class="profile-theme-opt${pref===v?' on':''}" onclick="window.profileSetTheme('${v}')">
    <span class="profile-theme-label">${label}</span><span class="profile-theme-sub">${sub}</span></button>`;
  return`<div class="card">
    <div style="font-weight:700;margin-bottom:4px">Appearance</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Applies to the whole app on this device only.</div>
    <div class="profile-theme-row">
      ${opt('light','Light','Always light')}
      ${opt('dark','Dark','Always dark')}
      ${opt('system','System','Follows your device')}
    </div>
  </div>`;
}

function _profileDirectoryHTML(){
  // Everyone with a profile, plus everyone in USER_DEFS who hasn't made one
  // yet — a directory that only lists the keen is not a directory.
  //
  // LAYOUT NOTE, because this shipped wrong once: the name goes on its OWN
  // line, above the buttons, never beside them. The first cut put identity
  // and actions in one flex row inside a 220px tile; the actions are
  // flex-shrink:0 and ate ~180px of it, so the name — flex:1, min-width:0 —
  // collapsed to zero width and every row read "Not signed in yet" with no
  // clue whose it was. Afnan's own row looked fine only because it has no
  // buttons. Anything added to a row from here goes BELOW the identity
  // block, not next to it.
  const rows=_profileDirRows();
  if(!rows.length)return'';
  const admin=_profIsAdmin();
  return`<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:4px">
      <div style="font-weight:700">Team</div>
      ${admin?`<button class="btn-sm btn-outline" id="prof-sync-btn" onclick="window.profileSyncAccounts()">Sync accounts</button>`:''}
    </div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">${rows.length} accounts.${admin?' You can edit anyone showing an Edit button. <strong>Sync accounts</strong> creates the missing profile rows so you don’t have to wait for people to sign in.':' Only the person themselves can edit their profile.'}</div>
    <div class="profile-dir">
      ${rows.map((r,i)=>{
        const photo=_profAvatarUrl(r.p.photoUrl,64);
        const col=_profHex(r.p.nameColor);
        const me=r.username===session.u;
        const canEdit=_profCanEditUser(r.username)&&!me;
        const canPw=_profCanResetPassword(r.username);
        const known=!!r.p.uid;
        // An admin can click the avatar as well as the button — clicking a
        // person's picture to change it is the first thing anyone tries.
        const openable=(canEdit&&known)||me;
        const onOpen=me?'window.profileChangePhoto()'
                      :(canEdit&&known)?`window.profileEditUser('${_profEsc(r.username)}')`:'';
        return`<div class="profile-dir-row${me?' is-me':''}">
          <div class="profile-dir-top${openable?' openable':''}"${openable?` onclick="${onOpen}" title="Edit this profile"`:''}>
            ${photo?`<img class="profile-dir-photo" src="${_profEsc(photo)}" alt="" referrerpolicy="no-referrer" draggable="false">`
                   :`<div class="profile-dir-photo profile-photo-empty"${col?` style="background:${col};color:${_profInk(col)}"`:''}>${_profEsc((r.p.displayName||r.fallbackName||'?').charAt(0).toUpperCase())}</div>`}
            <div class="profile-dir-id">
              <div class="profile-dir-name" id="prof-dir-n-${i}"${col?` style="color:${col}"`:''}></div>
              <div class="profile-dir-user">@${_profEsc(r.username)}${me?' <span class="profile-tag tag-me">You</span>':''}</div>
            </div>
          </div>
          <div class="profile-dir-sub" id="prof-dir-s-${i}"></div>
          <div class="profile-dir-actions">
            ${known?'':`<span class="profile-tag tag-soon" title="Their Firebase account exists, but no profile row does yet — one is created the first time they sign in.">No profile yet</span>`}
            ${me?`<button class="btn-sm" onclick="window.profileStartEdit()">Edit</button>`:''}
            ${canEdit&&known?`<button class="btn-sm" onclick="window.profileEditUser('${_profEsc(r.username)}')">Edit</button>`:''}
            ${canPw?`<button class="btn-sm btn-outline" onclick="window.openOwnerResetModal('${_profEsc(r.username)}')">Password</button>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// One definition of the directory's rows and their order, so the HTML and
// the textContent hydration below can never disagree about which row is
// which index.
function _profileDirRows(){
  const defs=(typeof USER_DEFS!=='undefined'?USER_DEFS:[]);
  return defs.map(u=>({
    username:u.u,fallbackName:u.name,title:u.title,
    p:userProfiles.find(x=>x.username===u.u)||{}
  })).sort((a,b)=>(a.p.displayName||a.fallbackName||'').localeCompare(b.p.displayName||b.fallbackName||''));
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
  const prev=document.getElementById('prof-col-prev');
  if(prev&&_profileEdit)prev.textContent=_profileEdit.displayName||_profileEdit._fallbackName||'';
  _profileDirRows().forEach((r,i)=>{
    const ne=document.getElementById('prof-dir-n-'+i);
    if(ne)ne.textContent=r.p.displayName||r.fallbackName||'';
    const se=document.getElementById('prof-dir-s-'+i);
    if(se)se.textContent=[r.p.jobTitle,r.p.department].filter(Boolean).join(' · ')||r.title||'';
  });
}

// Every path that repaints this page goes through here, and it CANNOT be
// allowed to fail silently. A throw inside renderProfilePage used to leave
// the page exactly as it was, so a button appeared to do nothing at all —
// no error, no clue, nothing to report. Same principle as the diagnostics
// panel: a person looking at something broken must be told what broke.
function _profileRerender(){
  const m=document.getElementById('main-content');
  if(!m)return;
  try{
    m.innerHTML=renderProfilePage();
    _profileHydrate();
  }catch(e){
    const msg=(e&&(e.stack||e.message))||String(e);
    try{console.error('[profile] render failed',e);}catch(_){}
    const box=document.createElement('div');
    box.className='card';
    box.style.borderColor='var(--accent-urgent)';
    const h=document.createElement('div');
    h.style.cssText='font-weight:700;margin-bottom:6px';
    h.textContent='The Profile page hit an error';
    const p=document.createElement('pre');
    p.style.cssText='font-size:11.5px;color:var(--muted);white-space:pre-wrap;word-break:break-word;margin:0 0 10px';
    p.textContent=msg;      // an error message can contain anything
    const b=document.createElement('button');
    b.className='btn-sm';
    b.textContent='Reload the page';
    b.onclick=()=>location.reload();
    box.appendChild(h);box.appendChild(p);box.appendChild(b);
    m.innerHTML='';
    m.appendChild(box);
  }
}

// ── Actions ──
window.profileRetry=async function(){
  await loadProfiles(true);
  _profileRerender();
};

// Builds the draft for one account. `username` defaults to the signed-in
// person; anything else goes through _profCanEditUser first.
function _profileOpenEdit(username,opts){
  const defs=(typeof USER_DEFS!=='undefined'?USER_DEFS:[]);
  const def=defs.find(x=>x.u===username);
  if(!def){showToast('Unknown account.',true);return;}
  if(!_profCanEditUser(username)){showToast('You can’t edit that profile.',true);return;}
  const p=profileForUsername(username)||{};
  const uid=username===session.u?session.uid:p.uid;
  if(!uid){
    showToast(`${def.name} has not signed in since profiles shipped, so there is no profile to edit yet.`,true);
    return;
  }
  _profileEdit={
    uid,username,_fallbackName:def.name,
    displayName:p.displayName||'',jobTitle:p.jobTitle||'',
    department:p.department||'',about:p.about||'',
    photoUrl:p.photoUrl||'',nameColor:_profHex(p.nameColor)
  };
  _profileRerender();
  // Straight on to the file chooser when the photo itself was clicked. The
  // rerender above is synchronous, so this .click() is still inside the
  // original user gesture — a browser will not open a file dialog outside
  // one, which is why it cannot be deferred to a timeout.
  if(opts&&opts.pickPhoto){
    const input=document.querySelector('.profile-photo-pick input[type=file]');
    if(input)input.click();
  }
}
// These are called from inline onclick attributes, where a throw goes to
// window.onerror and the button just looks dead. Route both through the
// same reporting the render path uses, so a failure is visible on screen
// instead of being something only a console would have shown.
function _profileGuard(fn){
  try{fn();}
  catch(e){
    try{console.error('[profile]',e);}catch(_){}
    showToast('Could not open the profile editor: '+((e&&e.message)||e),true);
  }
}
window.profileStartEdit=function(){_profileGuard(()=>_profileOpenEdit(session.u));};
window.profileEditUser=function(username){_profileGuard(()=>_profileOpenEdit(username));};
window.profileChangePhoto=function(){_profileGuard(()=>_profileOpenEdit(session.u,{pickPhoto:true}));};
window.profileCancelEdit=function(){_profileEdit=null;_profileRerender();};
// Typing mutates the draft in place with no rerender — the same
// cursor-stability reason Notes' block editor and the board's text cards
// don't rerender per keystroke.
window.profileField=function(k,v){if(_profileEdit)_profileEdit[k]=v;};
// The hex box calls this on every keystroke (typed=true), so a half-typed
// "#7B1" must not wipe what's already chosen — it is only committed once it
// validates. The swatches call it with a known-good value and rerender.
window.profileSetNameColor=function(v,typed){
  if(!_profileEdit)return;
  const hex=_profHex(v);
  if(typed&&!hex&&String(v||'').trim()!=='')return;
  _profileEdit.nameColor=hex;
  if(typed){
    const prev=document.getElementById('prof-col-prev');
    if(prev)prev.style.color=hex||'';
  }else _profileRerender();
};

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
  const d=_profileEdit;
  // Re-check at the moment of writing, not only when the form opened —
  // `firestore.rules` is the real boundary, but a UI that offers a write it
  // knows will be refused is just a worse error message.
  if(!_profCanEditUser(d.username)){showToast('You can’t edit that profile.',true);return;}
  _profileSaving=true;_profileRerender();
  const self=d.username===session.u;
  const payload={
    uid:d.uid,username:d.username,
    displayName:_profTrim(d.displayName,60),
    jobTitle:_profTrim(d.jobTitle,60),
    department:_profTrim(d.department,60),
    about:_profTrim(d.about,240),
    photoUrl:_profPhotoUrl(d.photoUrl),
    nameColor:_profHex(d.nameColor),
    updatedAt:Date.now()
  };
  if(!self){payload.updatedBy=session.u;}
  try{
    // setDoc, not updateDoc: a seeded row holds only {uid,username} and a
    // full replace is what the form represents. The rules require
    // request.resource.data.uid == the doc id either way.
    await setDoc(doc(db,'user_profiles',d.uid),payload);
    const i=userProfiles.findIndex(p=>p.uid===d.uid);
    if(i>=0)userProfiles[i]=payload;else userProfiles.push(payload);
    _profileEdit=null;
    if(self)profileApplyToSession();
    logActivity('Profile updated',self
      ?`${session.name} updated their profile`
      :`${session.name} updated ${d._fallbackName||d.username}'s profile`);
    showToast('Profile saved');
  }catch(e){
    showToast('Could not save profile: '+(e.message||e),true);
  }
  _profileSaving=false;
  _profileRerender();
};

// ── Sync accounts ────────────────────────────────────────────────────────
// A profile row is normally written by each person the first time they sign
// in, because the document id is a Firebase uid and nothing client-side can
// turn a username into one. That leaves an admin unable to edit anyone who
// has not logged in since profiles shipped. This asks the server to do it:
// netlify/functions/admin-seed-profiles.js resolves each email to a uid with
// the Admin SDK and writes {uid, username} with merge, so an existing
// profile is never overwritten. It seeds; it does not reset.
window.profileSyncAccounts=async function(){
  if(!_profIsAdmin()){showToast('Only owners and the Operations Manager can do that.',true);return;}
  const defs=(typeof USER_DEFS!=='undefined'?USER_DEFS:[]);
  const accounts=defs.map(u=>({username:u.u,email:u.email})).filter(a=>a.username&&a.email);
  if(!accounts.length){showToast('No accounts to sync.',true);return;}
  const btn=document.getElementById('prof-sync-btn');
  if(btn){btn.disabled=true;btn.textContent='Syncing…';}
  try{
    const idToken=await auth.currentUser.getIdToken();
    const res=await fetch('/.netlify/functions/admin-seed-profiles',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({idToken,accounts})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok){showToast(data.error||`Sync failed (${res.status}).`,true);return;}
    // Say what actually happened, per account, rather than "done" — a
    // missing Firebase Auth account is worth knowing about: that person is
    // in USER_DEFS but cannot sign in at all.
    const bits=[];
    if(data.created&&data.created.length)bits.push(data.created.length+' created');
    if(data.existing&&data.existing.length)bits.push(data.existing.length+' already had one');
    if(data.missing&&data.missing.length)bits.push(data.missing.length+' have no Firebase account ('+data.missing.join(', ')+')');
    if(data.failed&&data.failed.length)bits.push(data.failed.length+' failed');
    showToast(bits.length?bits.join(' · '):'Nothing to do.',!!(data.failed&&data.failed.length));
    if(data.missing&&data.missing.length){
      console.warn('[profiles] no Firebase Auth account for:',data.missing);
    }
    if(data.failed&&data.failed.length)console.warn('[profiles] sync failures:',data.failed);
    await loadProfiles(true);
    logActivity('Profiles synced',`${session.name} created ${(data.created||[]).length} profile row(s)`);
  }catch(e){
    showToast('Network error: '+(e.message||e),true);
  }finally{
    if(document.getElementById('prof-sync-btn')){
      const b=document.getElementById('prof-sync-btn');
      b.disabled=false;b.textContent='Sync accounts';
    }
    _profileRerender();
  }
};

// ── Theme ──
// The <head> of index.html sets data-theme before the stylesheet paints, so
// there is no flash of the wrong theme on load. This is the part that runs
// once the app is up: reading the preference, changing it, and following
// the OS while the preference is "system".
const _PROFILE_THEME_KEY='groovy-theme';
function profileThemePref(){
  try{
    const v=localStorage.getItem(_PROFILE_THEME_KEY);
    return v==='dark'||v==='light'?v:'system';
  }catch(e){return'system';}
}
function _profileSystemDark(){
  try{return!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);}
  catch(e){return false;}
}
function profileApplyTheme(){
  const pref=profileThemePref();
  const dark=pref==='dark'||(pref==='system'&&_profileSystemDark());
  const root=document.documentElement;
  root.setAttribute('data-theme',dark?'dark':'light');
  root.setAttribute('data-theme-pref',pref);
  // The PWA's own chrome (Android's status bar, the installed title bar)
  // reads this, so it has to move with the theme or the app frame stays
  // black around a white page.
  const m=document.querySelector('meta[name="theme-color"]');
  if(m)m.setAttribute('content',dark?'#0E0E10':'#000000');
}
window.profileSetTheme=function(pref){
  try{
    if(pref==='system')localStorage.removeItem(_PROFILE_THEME_KEY);
    else localStorage.setItem(_PROFILE_THEME_KEY,pref);
  }catch(e){}
  profileApplyTheme();
  _profileRerender();
};
// Follow the OS live while the preference is "system". Registered once at
// load, like the board's paste/keydown handlers — a listener added during a
// render would pile up, since this page is rerendered by innerHTML.
(function _profileWatchSystemTheme(){
  try{
    const mq=window.matchMedia('(prefers-color-scheme: dark)');
    const onChange=()=>{if(profileThemePref()==='system')profileApplyTheme();};
    if(mq.addEventListener)mq.addEventListener('change',onChange);
    else if(mq.addListener)mq.addListener(onChange);
  }catch(e){}
})();

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
  session.nameColor=p?_profHex(p.nameColor):'';
  const n=document.getElementById('user-name');
  if(n){n.textContent=session.name||'';n.style.color=session.nameColor||'';}
  _profilePaintAvatar();
}
function _profilePaintAvatar(){
  const btn=document.getElementById('topbar-avatar');
  if(!btn||!session)return;
  const url=_profAvatarUrl(session.photoUrl,64);
  btn.innerHTML=url
    ?`<img src="${_profEsc(url)}" alt="" referrerpolicy="no-referrer">`
    :_profEsc((session.name||'?').charAt(0).toUpperCase());
  if(!url&&session.nameColor){
    btn.style.background=session.nameColor;
    btn.style.color=_profInk(session.nameColor);
  }else{btn.style.background='';btn.style.color='';}
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
    }else if(snap){
      // Seed the row. This is the ONLY thing that puts a username→uid pair
      // where an admin can find it (see the header note) — without it,
      // "edit someone's profile" has no document to write to. Only ever on
      // a snapshot that really came back and really doesn't exist: a read
      // that timed out gives no snapshot and must not trigger a write that
      // could land on top of a real profile.
      await _profileSeedRow();
    }
  }catch(e){/* a denied read, or rules not yet republished — neither is fatal */}
  profileApplyToSession();
}
async function _profileSeedRow(){
  const row={uid:session.uid,username:session.u,updatedAt:Date.now()};
  try{
    await setDoc(doc(db,'user_profiles',session.uid),row);
    const i=userProfiles.findIndex(x=>x.uid===row.uid);
    if(i>=0)userProfiles[i]=row;else userProfiles.push(row);
  }catch(e){/* rules not republished yet, or offline — the page still works */}
}

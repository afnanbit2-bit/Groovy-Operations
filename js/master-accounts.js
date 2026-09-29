/* ─────────────────────────────────────────────────────────────────────────
   js/master-accounts.js — Master Accounts: the pages (M1.3, 28 Sept 2026)

   The owners' books. Every DECISION lives in js/ma-core.js (pure) — what a
   document is, how it posts, what is refused and what is flagged, balances,
   the calendar, "needs attention". This file only reads Firestore, paints
   pages and writes what the core built. See MASTER_ACCOUNTS_PLAN.md §16
   (the page map and the visual rules) and §29 (security, the re-lock).

   Pages (one entry, maRenderPage): ma-overview (Today) · ma-money (the
   holders, and ma-holder: one holder's statement) · ma-out (Money out: the
   cost register only in M1) · ma-parties (and ma-party) · ma-ledger (the
   postings, every document, the Unlabelled and review queues) · ma-close
   (periods, backups, the audit trail, settings, the chart, items).

   THE WRITER. A new document is ONE transaction: read ma_counters/{dt},
   mint the number for the document's fiscal year, write the counter, the
   document (id == no == maDocNo) and an ma_audit row — so a write that does
   not land never spends a number (the Pattern Hub lesson). A transaction
   needs a connection; offline says so and writes nothing. Edits, voids,
   confirms and reviews write exactly the shapes firestore.rules accepts
   (maEditOk / maVoidOk / maConfirmOk / maReviewOk) plus an audit row.

   THE LOADER NEVER REJECTS (renderPage dispatches with no .catch). Every
   collection settles on its own; a refused read is an error card naming
   the collection, never an empty list or a zero (the Store lesson).
   M1 volume is small, so every document is read whole; once a quarter is
   locked the plan is to read from the last close onward and page the rest.

   Every global is ma/_ma/MA_-prefixed (one lexical scope with every other
   classic script). No window.X= here names a top-level function — the
   calendar freeze of 26 Sept (tests/invariants.test.js holds it).
   ───────────────────────────────────────────────────────────────────────── */
'use strict';

/* ── Audience (§29) — by USERNAME; firestore.rules isMasterAccounts() by
   email. tests/master-accounts.test.js holds the two lists equal. ────── */
const _MA_USERS=['afnan','ammar'];
function maCanSee(){return !!(typeof session!=='undefined'&&session&&_MA_USERS.indexOf(session.u)>-1);}

const MA_PAGES=[
  {id:'ma-overview',label:'Today'},
  {id:'ma-money',label:'Money'},
  {id:'ma-out',label:'Money out'},
  {id:'ma-parties',label:'Parties'},
  {id:'ma-ledger',label:'Ledger'},
  {id:'ma-close',label:'Close & audit'}
];
// A detail page lights its parent in the nav.
const _MA_PARENT={'ma-holder':'ma-money','ma-party':'ma-parties'};
function maNavItems(){return maCanSee()?MA_PAGES.map(p=>({id:p.id,label:p.label,iconName:'money'})):[];}

/* ── Firestore references — literal collection names, so the invariants
   test sees every collection this file touches. ──────────────────────── */
const _MA_REF={
  ma_parties:id=>doc(db,'ma_parties',id),
  ma_items:id=>doc(db,'ma_items',id),
  ma_commitments:id=>doc(db,'ma_commitments',id),
  ma_accounts:id=>doc(db,'ma_accounts',id),
  ma_settings:id=>doc(db,'ma_settings',id),
  ma_counters:id=>doc(db,'ma_counters',id),
  ma_journal:id=>doc(db,'ma_journal',id),
  ma_transfer:id=>doc(db,'ma_transfer',id),
  ma_counts:id=>doc(db,'ma_counts',id),
  ma_audit:id=>doc(db,'ma_audit',id)
};
const _MA_LOADS=[
  {key:'parties',col:'ma_parties',core:true,q:()=>collection(db,'ma_parties')},
  {key:'commitments',col:'ma_commitments',core:true,q:()=>collection(db,'ma_commitments')},
  {key:'accounts',col:'ma_accounts',core:true,q:()=>collection(db,'ma_accounts')},
  {key:'settings',col:'ma_settings',core:true,q:()=>collection(db,'ma_settings')},
  {key:'journal',col:'ma_journal',core:true,dt:'journal',q:()=>collection(db,'ma_journal')},
  {key:'transfer',col:'ma_transfer',core:true,dt:'transfer',q:()=>collection(db,'ma_transfer')},
  {key:'counts',col:'ma_counts',core:true,dt:'count',q:()=>collection(db,'ma_counts')},
  {key:'closes',col:'ma_closes',core:true,q:()=>collection(db,'ma_closes')},
  {key:'items',col:'ma_items',core:false,q:()=>collection(db,'ma_items')},
  {key:'audit',col:'ma_audit',core:false,q:()=>query(collection(db,'ma_audit'),orderBy('at','desc'),limit(300))},
  {key:'backups',col:'ma_backups',core:false,q:()=>collection(db,'ma_backups')}
];
const _MA_DOC_KEY={journal:'journal',transfer:'transfer',count:'counts'};

/* ── State ─────────────────────────────────────────────────────────────── */
let maData={parties:[],commitments:[],accounts:[],settings:[],journal:[],transfer:[],counts:[],closes:[],items:[],audit:[],backups:[]};
let maLoaded=false;
let _maLoading=null;
let _maLoadErrs=[];           // [{key,col,core,message,code}]
let _maMirror={ok:false,cash:null,why:'not read yet'};
let _maC=null;                // the derived context, rebuilt after any change
let _maPage='ma-overview';
let _maBusy=false;

/* ── Loading (never rejects) ───────────────────────────────────────────── */
async function maLoad(force){
  if(_maLoading)return _maLoading;
  _maLoading=(async()=>{
    try{
      const res=await Promise.allSettled(_MA_LOADS.map(j=>Promise.resolve().then(()=>getDocs(j.q()))));
      const errs=[];
      res.forEach((r,i)=>{
        const j=_MA_LOADS[i];
        if(r.status==='fulfilled'){
          maData[j.key]=((r.value&&r.value.docs)||[]).map(d=>{
            const x=Object.assign({},typeof d.data==='function'?d.data():{});
            if(!x.id)x.id=d.id;
            if(j.dt&&!x.dt)x.dt=j.dt;
            return x;
          });
        }else{
          maData[j.key]=[];
          const e=r.reason||{};
          errs.push({key:j.key,col:j.col,core:j.core,message:String(e.message||e||'failed'),code:String(e.code||'')});
        }
      });
      _maLoadErrs=errs;
      await _maLoadMirror();
      maLoaded=true;
    }catch(e){
      _maLoadErrs=[{key:'all',col:'ma_*',core:true,message:String(e&&e.message||e),code:''}];
      maLoaded=true;
    }finally{_maC=null;_maLoading=null;}
  })();
  return _maLoading;
}
function _maCoreErrs(){return _maLoadErrs.filter(e=>e.core);}
function _maErr(key){return _maLoadErrs.find(e=>e.key===key)||null;}

/* The drawer (1010) is Raees's book in Store Accounts until M8: its balance
   is read from there. A read that failed is NEVER a zero — mirrorOk:false,
   and cash in hand says it is incomplete (maCashInHand).
   M1.6b (money M1, S2): the read is ALWAYS a fresh one — Store Accounts
   keeps its own copy for the session, and a figure from whenever that page
   was first opened must not be shown as now — and it has 12 seconds: one
   that has not answered by then is "not read", so a Store Accounts read
   that never settles can no longer hold Master Accounts on its skeleton.
   `at` is when this answer was had; the pages say "as of" it. */
const _MA_MIRROR_WAIT=12000;
const _MA_MIRROR_FRESH=5*60000;   // older than this, a page opening reads it again
function _maWithin(p,ms){
  return new Promise((res,rej)=>{
    const t=setTimeout(()=>res(false),ms);
    Promise.resolve(p).then(()=>{clearTimeout(t);res(true);},e=>{clearTimeout(t);rej(e);});
  });
}
async function _maLoadMirror(){
  // One assignment at the end: a paint while a re-read is in flight keeps
  // showing the last answer (with its "as of"), never a passing "not read".
  const fail=why=>({ok:false,cash:null,why,at:Date.now()});
  let next;
  if(typeof loadAccountsData!=='function'||typeof _acctBalances!=='function')next=fail('Store Accounts is not loaded in this build');
  else try{
    if(!await _maWithin(loadAccountsData(true),_MA_MIRROR_WAIT))next=fail('Store Accounts did not answer within '+Math.round(_MA_MIRROR_WAIT/1000)+' seconds');
    else{
      const err=typeof _acctLoadErr!=='undefined'?_acctLoadErr:null;
      const b=err&&Array.isArray(err.cols)&&err.cols.some(c=>c==='acct_entries'||c==='acct_closes')?null:_acctBalances();
      if(err&&!b)next=fail('Store Accounts could not read '+err.cols.join(', '));
      else if(!b||!Number.isFinite(b.cash))next=fail('Store Accounts gave no drawer balance');
      else next={ok:true,cash:Math.round(b.cash),why:'',at:Date.now()};
    }
  }catch(e){next=fail('Store Accounts failed: '+String(e&&e.message||e));}
  _maMirror=next;
}
/* "as of 14:05" — when the drawer's figure was read; '' when it was not. */
function _maMirrorAsOf(){
  if(!_maMirror.ok||!Number.isFinite(_maMirror.at))return '';
  const d=new Date(_maMirror.at);
  return 'as of '+maPad(d.getHours())+':'+maPad(d.getMinutes());
}
/* A drawer figure read more than five minutes ago is read again when a
   page opens (Store Accounts is Raees's live book). The page paints at once
   with the older figure — it says "as of" — and again when the read lands,
   unless someone is typing: a repaint would take the caret away. */
let _maMirrorBusy=null;
function _maMirrorFreshen(id){
  if(_maMirrorBusy)return _maMirrorBusy;
  if(!maLoaded||(Number.isFinite(_maMirror.at)&&Date.now()-_maMirror.at<_MA_MIRROR_FRESH))return null;
  _maMirrorBusy=_maLoadMirror().then(()=>{
    _maInvalidate();
    if(id&&(typeof currentPage==='undefined'||currentPage===id)){
      const a=document.activeElement;
      if(!(a&&/^(INPUT|SELECT|TEXTAREA)$/.test(String(a.tagName||''))))_maPaint();
    }
  }).finally(()=>{_maMirrorBusy=null;});
  return _maMirrorBusy;
}

/* ── The derived context — everything a page reads, computed by the core ─ */
function _maCtx(){
  if(_maC)return _maC;
  const stored=maData.settings.find(x=>x.id==='main')||null;
  const s=maSettings(stored);
  const idx=maChartIndex(maChart('groovy',maData.accounts));
  const docs=maData.journal.concat(maData.transfer,maData.counts);
  const lines=maPostAll(docs,idx,s);
  const mirrorBalances={};
  Object.keys(s.mirrors||{}).forEach(code=>{if(s.mirrors[code]==='store'&&_maMirror.ok)mirrorBalances[code]=_maMirror.cash;});
  const holders=maHolderRows(idx,lines,docs,{settings:s,mirrorBalances});
  _maC={s,stored,idx,docs,lines,holders,today:maDay()};
  return _maC;
}
function _maInvalidate(){_maC=null;}

/* ── Small helpers ─────────────────────────────────────────────────────── */
const _maE=v=>maEsc(v);
const _maQ=v=>String(v===undefined||v===null?'':v).replace(/[^A-Za-z0-9_\-.]/g,'');
function _maClean(o){return JSON.parse(JSON.stringify(o===undefined?null:o));}
function _maToast(m){if(typeof showToast==='function')showToast(m);}
function _maWho(u){
  if(!u)return '—';
  // The nightly backup writes its own audit rows (netlify/functions/
  // ma-backup.js, by:'ma-backup'): name the job, never its id. No client can
  // write that `by` — the ma_audit create rule binds it to the caller's own
  // login (maUser()), and only Afnan and Ammar pass isMasterAccounts().
  if(u==='ma-backup')return 'Nightly backup';
  const d=(typeof USER_DEFS!=='undefined'?USER_DEFS:[]).find(x=>x.u===u);
  return d?d.name:u;
}
function _maWhen(ms){
  if(!Number.isFinite(ms)||!ms)return '—';
  const d=new Date(ms);
  return maDayLabel(maDay(d),true)+' '+maPad(d.getHours())+':'+maPad(d.getMinutes());
}
function _maParty(id){return maData.parties.find(p=>p.id===id)||null;}
function _maPartyName(id){const p=_maParty(id);return p?p.name:(id?'Unknown party':'');}
function _maCommit(id){return maData.commitments.find(x=>x.id===id)||null;}
function _maDoc(dt,id){const k=_MA_DOC_KEY[dt];return k?maData[k].find(d=>d.id===id)||null:null;}
function _maAccName(c,code){const a=maAcc(c.idx,code);return a?a.name:String(code||'');}
function _maShortHolder(c,code){return _maAccName(c,code).replace(/^Cash — /,'');}
function _maRsCell(n){const v=Math.round(Number(n)||0);return `<span class="${v<0?'ma-neg':''}">${maRs(v)}</span>`;}
function _maNum(v){const n=maParseRupees(v);return Number.isFinite(n)?n:NaN;}
function _maId(prefix){return prefix+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function _maMeta(){return {by:session.u,byName:session.name||session.u,at:Date.now()};}
function _maStatusWord(d){
  if(d.status==='void')return '<span class="ma-pill">void</span>';
  if(d.status==='pending')return '<span class="ma-word warn">waiting</span>';
  if(d.historical)return '<span class="ma-word mute">history</span>';
  return '<span class="ma-word fine">posted</span>';
}
function _maDocDesc(d,c){
  if(!d)return '';
  if(d.dt==='journal'){
    const k=MA_JOURNAL_KINDS[d.kind]||{};
    if(k.lines)return (d.lines||[]).map(l=>_maAccName(c,l.account)).slice(0,3).join(', ')+((d.lines||[]).length>3?'…':'');
    if(k.owner)return _maWho(d.owner)+' · '+_maShortHolder(c,d.holder);
    const who=d.party?_maPartyName(d.party):(d.payee||'');
    return [who,_maAccName(c,d.account)].filter(Boolean).join(' · ');
  }
  if(d.dt==='transfer')return _maShortHolder(c,d.from)+' → '+_maShortHolder(c,d.to);
  if(d.dt==='count')return _maShortHolder(c,d.holder)+' counted '+maRs(d.counted);
  return '';
}

/* ── Writing ───────────────────────────────────────────────────────────── */
function _maOnline(){return !(typeof navigator!=='undefined'&&navigator&&navigator.onLine===false);}
function _maAuditId(){return Date.now()+'-'+_maQ(session&&session.u)+'-'+Math.random().toString(36).slice(2,8);}
function _maWriteError(e){
  const m=String(e&&e.message||e||'');
  // Every write carries an audit row, and the rules refuse a row stamped
  // more than five minutes off the server's clock (M1.6a) — so a phone whose
  // clock is wrong is refused too, and says so.
  if(/permission|insufficient/i.test(m+' '+(e&&e.code||'')))return 'Refused by the Firestore rules — check the published firestore.rules carries the Master Accounts block, and that this device’s clock is right (an audit row more than five minutes off the server’s time is refused).';
  return m||'The write failed.';
}
/* A save that fails is said where the owner is looking (money F13). The
   form while it is still open; once it has been closed — × and Escape stay
   live while a save is in flight — or replaced by another form, a toast
   that names WHAT was not saved. A failure written into a box nobody can
   see is a save that failed silently, and the owner believes it landed. */
function _maFormFail(f,what,e){
  const msg=_maWriteError(e);
  if(_maF&&_maF===f){_maShowIssues({refuses:[{message:msg+' Nothing was saved.'}],flags:[],ok:false});return;}
  _maToast('Not saved: '+what+' — '+msg);
}
function _maDocWhat(f,d){
  if(f.edit)return 'the edit to '+f.edit.no;
  const k=f.kind;
  const label=MA_JOURNAL_KINDS[k]?MA_JOURNAL_KINDS[k].label:(MA_DOC_TYPES[f.dt]||{}).label||k;
  return [label,d&&Number.isInteger(d.amount)&&d.amount?maRs(d.amount):'',d&&maIsDay(d.date)?maDayLabel(d.date):''].filter(Boolean).join(' · ');
}
/* A new document: counter + document + audit, one transaction. Returns the
   stored document (with its number) or throws. */
async function _maPostNew(built){
  const dt=built.dt,t=MA_DOC_TYPES[dt];
  if(!t)throw new Error('Unknown document type.');
  const fy=built.fy;
  let stored=null;
  await runTransaction(db,async tx=>{
    const cref=_MA_REF.ma_counters(dt);
    const cs=await tx.get(cref);
    const cur=cs&&typeof cs.exists==='function'&&cs.exists()?(cs.data()||{}):{};
    let seq=(Number.isInteger(cur[fy])?cur[fy]:0)+1;
    let no=maDocNo(dt,fy,seq);
    // A counter left behind a hand edit must never re-mint a number a
    // document already holds.
    for(let i=0;i<8;i++){
      const ex=await tx.get(_MA_REF[t.col](no));
      if(!(ex&&typeof ex.exists==='function'&&ex.exists()))break;
      seq++;no=maDocNo(dt,fy,seq);
    }
    const d=_maClean(Object.assign({},built,{no,id:no}));
    const next=Object.assign({},_maClean(cur));next[fy]=seq;next.updatedAt=Date.now();
    tx.set(cref,next);
    tx.set(_MA_REF[t.col](no),d);
    const m=_maMeta();
    tx.set(_MA_REF.ma_audit(_maAuditId()),_maClean(maAuditRow('post',d,Object.assign({},m,{detail:maDocTitle(d)+' '+maRs(d.amount||0)+(d.flags&&d.flags.length?' · '+d.flags.length+' flag'+(d.flags.length>1?'s':''):'')}))));
    stored=d;
  });
  return stored;
}
/* An edit keeps every key the rules do not let it touch exactly as stored:
   what the edit may change is MA_EDIT_FIELDS plus MA_EDIT_DERIVED, the two
   lists maEditOk mirrors. */
function _maEditShape(before,edited){
  const out=_maClean(edited);
  Object.keys(before).forEach(k=>{if(!(k in out)&&before[k]!==undefined)out[k]=_maClean(before[k]);});
  const allowed=new Set((MA_EDIT_FIELDS[before.dt]||[]).concat(MA_EDIT_DERIVED));
  Object.keys(out).forEach(k=>{if(!(k in before)&&!allowed.has(k))delete out[k];});
  return out;
}
async function _maWriteEdit(before,edited,reason,action){
  const col=MA_DOC_TYPES[before.dt].col;
  await runTransaction(db,async tx=>{
    const ref=_MA_REF[col](before.id);
    const snap=await tx.get(ref);
    if(!(snap&&snap.exists()))throw new Error('This document is no longer there.');
    const cur=snap.data()||{};
    if((cur.rev||1)!==(before.rev||1)||cur.status!==before.status)throw new Error('Someone changed this document since it was opened — refresh and try again.');
    tx.set(ref,edited);
    const row=edited.edits[edited.edits.length-1];
    tx.set(_MA_REF.ma_audit(_maAuditId()),_maClean(maAuditRow(action||'edit',edited,Object.assign(_maMeta(),{detail:'rev '+maRevOf(edited)+' · '+row.fields.join(', ')+' — '+reason}))));
  });
}
/* A patch (void, confirm, review): the stored doc is re-read, `check`
   decides whether the patch still applies. */
async function _maWritePatch(d,patch,action,detail,check){
  const col=MA_DOC_TYPES[d.dt].col;
  await runTransaction(db,async tx=>{
    const ref=_MA_REF[col](d.id);
    const snap=await tx.get(ref);
    if(!(snap&&snap.exists()))throw new Error('This document is no longer there.');
    const cur=snap.data()||{};
    if(check){const why=check(cur);if(why)throw new Error(why);}
    tx.update(ref,patch);
    tx.set(_MA_REF.ma_audit(_maAuditId()),_maClean(maAuditRow(action,d,Object.assign(_maMeta(),{detail}))));
  });
}
/* A master (party, commitment, item, settings, an account): one batch with
   its audit row. Refused offline — a batch would sit unacknowledged. */
async function _maWriteMasters(writes,action,target,detail){
  const b=writeBatch(db);
  writes.forEach(w=>b.set(_MA_REF[w.col](w.id),_maClean(w.data)));
  b.set(_MA_REF.ma_audit(_maAuditId()),_maClean(maAuditRow(action,target,Object.assign(_maMeta(),{detail}))));
  await b.commit();
}
function _maAuditQuiet(action,target,detail){
  try{
    const p=setDoc(_MA_REF.ma_audit(_maAuditId()),_maClean(maAuditRow(action,target,Object.assign(_maMeta(),{detail}))));
    if(p&&p.catch)p.catch(()=>{});
  }catch(_){}
}
function _maNeedsNet(){
  if(_maOnline())return false;
  _maToast('Master Accounts needs a connection to record — nothing was saved.');
  return true;
}

/* ── The re-lock (§29) ─────────────────────────────────────────────────── */
/* Entering a Master Accounts page after `relockMinutes` idle asks again:
   the fingerprint where this device has the app lock, else the password.
   Activity is kept per uid in localStorage (a convenience; never trusted
   for anything but "was this person here a minute ago"). */
const _MA_ACTIVE_KEY='groovy-ma-active';
let _maUnlockedAt=0;
let _maLastTouch=0;
let _maEnterLogged=false;
function _maActiveRead(){try{return JSON.parse(localStorage.getItem(_MA_ACTIVE_KEY)||'{}')||{};}catch(_){return {};}}
function _maTouch(){
  const now=Date.now();_maLastTouch=now;
  try{const a=_maActiveRead();a[session.uid]=now;localStorage.setItem(_MA_ACTIVE_KEY,JSON.stringify(a));}catch(_){}
}
function _maRelockMs(){
  let m=15;
  try{const st=maData.settings.find(x=>x.id==='main');m=maSettings(st).relockMinutes;}catch(_){}
  return m*60000;
}
function _maNeedsRelock(){
  const win=_maRelockMs(),now=Date.now();
  if(_maLastTouch&&now-_maLastTouch<win)return false;
  const last=_maActiveRead()[session&&session.uid];
  if(Number.isFinite(last)&&now-last<win&&now>=last)return false;
  try{
    const u=typeof auth!=='undefined'&&auth&&auth.currentUser;
    const t=u&&u.metadata&&Date.parse(u.metadata.lastSignInTime);
    if(Number.isFinite(t)&&now-t<win&&now>=t)return false;
  }catch(_){}
  return true;
}
function _maUnlocked(how){
  _maUnlockedAt=Date.now();_maTouch();
  _maAuditQuiet('enter',null,'Unlocked with '+how);_maEnterLogged=true;
  maRenderPage(_maPage);
}
/* THE LOCK IS ASKED EVERYWHERE, never only on navigation (M1.6b, security
   F5). It used to be read in maRenderPage alone, and the activity bump
   below touched the clock on ANY tap — so a page left open for two hours
   showed the books until someone touched it, and that one touch (on the
   sidebar's Ledger, say) reset the clock and opened the next page without a
   password. Now:
   - a tap or a key on an ma-* page while the lock is due SHOWS the lock and
     never touches the clock — on the lock itself, typing the password does
     not count as activity either;
   - every repaint (_maPaint, the partial ones, a modal opening) asks first;
   - coming back to the tab, and a check every 30 seconds, swap an open page
     for the lock;
   - the Dashboard card reads nothing while it is due.
   `_maLockShown` = the lock is what #main-content shows now. */
let _maLockShown=false;
function _maShowLock(){
  // An open form or share panel holds the books' figures — it goes too.
  if(_maF||_maShare)window.maCloseModal();
  _maLockShown=true;
  const m=document.getElementById('main-content');
  if(m)m.innerHTML=_maLockHTML();
}
/* May a Master Accounts page be painted now? false = the lock is (or has
   just been put) on screen instead. */
function _maMayPaint(){
  if(_maLockShown)return false;
  if(_maNeedsRelock()){_maShowLock();return false;}
  return true;
}
/* An open ma-* page, checked from outside a paint (the tab coming back, the
   timer, a tap). true = the lock is on screen. */
function _maRelockCheck(){
  if(typeof currentPage==='undefined'||!String(currentPage).startsWith('ma-')||!maCanSee())return false;
  return !_maMayPaint();
}
if(typeof document!=='undefined'&&document.addEventListener){
  // Keep "active" fresh while someone is working on an ma-* page — but a tap
  // or a key while the lock is due (or showing) shows the lock instead.
  const bump=()=>{
    if(typeof currentPage==='undefined'||!String(currentPage).startsWith('ma-')||!maCanSee())return;
    if(_maRelockCheck())return;
    if(Date.now()-_maLastTouch>15000)_maTouch();
  };
  document.addEventListener('pointerdown',bump,true);
  document.addEventListener('keyup',bump,true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)_maRelockCheck();});
}
if(typeof setInterval==='function')setInterval(_maRelockCheck,30000);

/* ── The books leave the device with the owner (§29, security F6) ────────
   The app keeps Firestore's offline copy in IndexedDB (index.html), so every
   ma_* document an owner has read stays on the device after sign-out — and
   on a shared computer the next person, or anyone with DevTools, reads it
   from there whatever the owner-only rules say. So an OWNER's sign-out (the
   module's own list) takes it off: writes still queued get up to five
   seconds to reach the server, then Firestore is terminated and its
   IndexedDB copy deleted. Two outcomes are said out loud, never assumed:
   - writes still queued (offline): the copy is KEPT — deleting it would
     lose them — and the owner is told it stays until they sign out online;
   - the copy is held by another tab (Firestore's failed-precondition, or a
     delete that does not finish): nothing is signed out, the tab reloads (a
     terminated Firestore cannot be used again), and the owner is told to
     close the other Groovy Ops tabs and sign out again.
   Called by doLogout and lockUsePassword (js/auth.js) behind typeof; a
   cached index.html without the three bridged functions signs out exactly
   as before. → {skipped} | {cleared} | {kept} | {stay} | {failed}, with
   the message said. */
let _maOffWait=5000;
function _maSayOff(m){if(typeof alert==='function'){try{alert(m);return;}catch(_){}}_maToast(m);}
async function _maBooksOffDevice(){
  const who=typeof session!=='undefined'&&session&&session.u||'';
  const email=String(typeof auth!=='undefined'&&auth&&auth.currentUser&&auth.currentUser.email||'').toLowerCase();
  if(!(_MA_USERS.indexOf(who)>-1||_MA_USERS.some(u=>email===u+'@groovy.op')))return {skipped:'not an owner'};
  if(typeof db==='undefined'||!db||typeof terminate!=='function'||typeof clearIndexedDbPersistence!=='function')return {skipped:'no bridge'};
  let flushed=true;
  if(typeof waitForPendingWrites==='function'){
    try{flushed=await _maWithin(waitForPendingWrites(db),_maOffWait);}catch(_){flushed=false;}
  }
  if(!flushed){
    const m='You are signed out — but this device keeps its offline copy of the books. Some changes have not reached the server yet, and removing the copy would lose them. Sign in again when you are online, let them send, then sign out: that removes it.';
    _maSayOff(m);return {kept:true,message:m};
  }
  try{await terminate(db);}catch(_){}
  let done=false,err=null;
  try{done=await _maWithin(Promise.resolve().then(()=>clearIndexedDbPersistence(db)),_maOffWait);}catch(e){err=e;}
  if(done)return {cleared:true};
  if(!err||err.code==='failed-precondition'){
    const m='The books could not be taken off this device: another Groovy Ops tab still has them open. Close the other Groovy Ops tabs and sign out again — you are still signed in.';
    _maSayOff(m);return {stay:true,message:m};
  }
  const m='You are signed out — but the books could not be taken off this device ('+String(err&&err.message||err).slice(0,160)+'). Clear this site’s data in the browser’s settings before someone else uses it.';
  _maSayOff(m);return {failed:true,message:m};
}
window.maBooksOffDevice=function(){return _maBooksOffDevice();};
function _maLockHTML(){
  const mins=Math.round(_maRelockMs()/60000);
  const finger=typeof lockEnabledFor==='function'&&typeof _lockShow==='function'&&lockEnabledFor(session.uid);
  return `<div class="ma-page"><div class="ma-lock">
    <h1 class="ma-title">Master Accounts is locked</h1>
    <div class="ma-meta">Idle for more than ${mins} minutes — confirm it is you.</div>
    ${finger?`<button class="ma-btn primary ma-lock-btn" onclick="window.maUnlockFinger()">Unlock with fingerprint</button>`:''}
    <label class="ma-lbl" for="ma-lock-pw">Password</label>
    <input class="ma-in" id="ma-lock-pw" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')window.maUnlockPassword()">
    <div class="ma-err" id="ma-lock-err"></div>
    <button class="ma-btn${finger?'':' primary'} ma-lock-btn" onclick="window.maUnlockPassword()">Unlock</button>
  </div></div>`;
}
window.maUnlockFinger=function(){
  try{_lockShow(session,()=>_maUnlocked('fingerprint'));}catch(e){const el=document.getElementById('ma-lock-err');if(el)el.textContent='The fingerprint could not be asked for — use the password.';}
};
window.maUnlockPassword=async function(){
  const inp=document.getElementById('ma-lock-pw');const err=document.getElementById('ma-lock-err');
  const pw=inp?inp.value:'';
  if(!pw){if(err)err.textContent='Type your password.';return;}
  try{
    const u=auth.currentUser;
    await reauthenticateWithCredential(u,EmailAuthProvider.credential(u.email||session.email,pw));
    if(inp)inp.value='';
    _maUnlocked('password');
  }catch(e){if(err)err.textContent=/wrong-password|invalid-credential|invalid-login/i.test(String(e&&(e.code||e.message)))?'That password is not right.':'Could not check the password — '+String(e&&e.message||e);}
};

/* ── The dashboard card (owners) ───────────────────────────────────────── */
function renderMasterAccountsDashboardWidget(){
  if(!maCanSee())return '';
  return `<div class="card ma-dash" id="ma-dash-widget" onclick="window.showPage('ma-overview')">
    <div class="ma-dash-head"><span class="ma-dash-title">Master Accounts</span><span class="ma-dash-open">Today ›</span></div>
    <div class="ma-dash-body" id="ma-dash-body">Loading…</div></div>`;
}
async function _maPopulateDashboard(){
  const el=document.getElementById('ma-dash-body');
  if(!el||!maCanSee())return;
  // The lock covers the card too (security F5): the Dashboard is where the
  // owner lands, so a device left signed in would otherwise show the books
  // on its first screen. While it is due the card says so and reads nothing.
  if(_maNeedsRelock()){el.textContent='Master Accounts is locked — open it to unlock.';return;}
  const paint=()=>{
    const body=document.getElementById('ma-dash-body');if(!body)return;
    const errs=_maCoreErrs();
    if(errs.length){body.textContent='Could not read '+errs.map(e=>e.col).join(', ')+' — open Today to retry.';return;}
    const c=_maCtx();
    const cih=maCashInHand(c.holders);
    const na=_maAttention(c);
    body.innerHTML=`<span class="ma-dash-num">${maRs(cih.total)}</span> cash in hand${cih.complete?'':' <span class="ma-word warn">incomplete — the drawer was not read</span>'} · `
      +(na.length?`<b>${na.length}</b> need${na.length===1?'s':''} attention`:'nothing to worry about')
      +(_maErr('backups')?' · <span class="ma-word urgent">the backups could not be read</span>':'');
  };
  try{
    if(!maLoaded)await maLoad();
    paint();
    // A drawer figure older than five minutes is read again, then painted.
    const f=_maMirrorFreshen(null);
    if(f){await f;paint();}
  }catch(e){const b=document.getElementById('ma-dash-body');if(b)b.textContent='Master Accounts could not load.';}
}

/* ═══════════════════════════ THE PAGES ═══════════════════════════════════ */

/* ── Periods (the header segment) ──────────────────────────────────────── */
const _MA_PERIODS=[['month','This month'],['last','Last month'],['quarter','Quarter'],['year','Year'],['all','All']];
let _maPeriod='month';
function _maRange(c){
  const t=c.today,s=c.s;
  if(_maPeriod==='last'){const m=maMonthAdd(maMonthOf(t),-1);return {from:m+'-01',to:m+'-'+maPad(maDaysInMonth(m)),label:maMonthLabel(m,true)};}
  if(_maPeriod==='quarter'){const q=maQuarterOf(t,s.fiscalYearStart);const r=maQuarterRange(q,s.fiscalYearStart);return {from:r.from,to:t,label:maQuarterLabel(q,s.fiscalYearStart)};}
  if(_maPeriod==='year'){const fs=s.fiscalYearStart;const y=maFyEndYear(t,fs)-(fs===1?0:1);return {from:y+'-'+maPad(fs)+'-01',to:t,label:maFyOf(t,fs)};}
  if(_maPeriod==='all')return {from:s.historyFrom,to:t,label:'Since '+maDayLabel(s.historyFrom,true)};
  return {from:maMonthOf(t)+'-01',to:t,label:maMonthLabel(maMonthOf(t),true)};
}
function _maPeriodSeg(){
  return `<div class="ma-period" role="group" aria-label="Period">${_MA_PERIODS.map(([k,l])=>`<button class="${_maPeriod===k?'on':''}" onclick="window.maSetPeriod('${k}')">${l}</button>`).join('')}</div>`;
}
window.maSetPeriod=function(k){_maPeriod=_MA_PERIODS.some(p=>p[0]===k)?k:'month';_maLedgerShown=50;_maPaint();};

/* ── Chrome: the header, sections, tabs, tables ─────────────────────────── */
function _maHead(title,meta,o){
  o=o||{};
  return `<div class="ma-head">
    <div class="ma-head-t">${o.back?`<button class="ma-back" onclick="window.showPage('${_maQ(o.back[0])}')">← ${_maE(o.back[1])}</button>`:''}<h1 class="ma-title">${_maE(title)}</h1>${meta?`<div class="ma-meta">${meta}</div>`:''}</div>
    ${o.period?_maPeriodSeg():''}
    <span class="ma-grow"></span>
    <button class="ma-btn primary" onclick="window.maRecord()">Record</button>
    <div class="ma-more"><button class="ma-btn ma-icon" aria-label="More actions" onclick="window.maToggleMenu(event)">⋯</button>
      <div class="ma-menu" id="ma-menu">${o.excel?`<button onclick="window.maExcel('${_maQ(o.excel)}')">Download Excel</button>`:''}${o.pdf?`<button onclick="window.maPdf('${_maQ(o.pdf)}')">Download PDF</button><button onclick="window.maShare('${_maQ(o.pdf)}')">Share PDF</button>`:''}<button onclick="window.maRefresh()">Refresh</button></div></div>
  </div>`;
}
window.maToggleMenu=function(e){
  if(e&&e.stopPropagation)e.stopPropagation();
  const m=document.getElementById('ma-menu');if(m)m.classList.toggle('open');
};
if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('click',()=>{const m=document.getElementById('ma-menu');if(m&&m.classList&&m.classList.contains('open'))m.classList.remove('open');});
function _maSec(title,meta,right,body,id){
  return `<section class="ma-sec"${id?` id="${id}"`:''}><div class="ma-sec-head"><h2 class="ma-sec-title">${_maE(title)}</h2>${meta?`<span class="ma-sec-meta">${meta}</span>`:''}<span class="ma-grow"></span>${right||''}</div>${body}</section>`;
}
function _maTabs(cur,list,handler){
  return `<div class="ma-tabs" role="tablist">${list.map(([k,l])=>`<button role="tab" class="${cur===k?'on':''}" onclick="window.${handler}('${k}')">${l}</button>`).join('')}</div>`;
}
function _maEmpty(text,link){return `<div class="ma-empty">${text}${link?' · '+link:''}</div>`;}
function _maLink(label,js){return `<button class="ma-link" onclick="${js}">${_maE(label)}</button>`;}
/* A table: cols [{h, cls, l (phone label)}], rows as arrays of cell HTML. */
function _maTable(cols,rows,o){
  o=o||{};
  const head=`<thead><tr>${cols.map(c=>`<th class="${c.cls||''}">${_maE(c.h)}</th>`).join('')}</tr></thead>`;
  const body=rows.map(r=>{
    const cells=r.cells||r;
    return `<tr class="${r.cls||''}${r.click?' ma-rowlink':''}"${r.click?` onclick="${r.click}"`:''}>${cells.map((v,i)=>`<td class="${cols[i]&&cols[i].cls||''}" data-l="${_maE(cols[i]&&cols[i].l||'')}">${v===undefined||v===null?'':v}</td>`).join('')}</tr>`;
  }).join('');
  const foot=o.total?`<tr class="ma-total">${o.total.map((v,i)=>`<td class="${cols[i]&&cols[i].cls||''}">${v||''}</td>`).join('')}</tr>`:'';
  return `<div class="ma-tbl"><table class="ma-table ma-cards">${head}<tbody>${body}${foot}</tbody></table></div>`;
}
function _maErrorCard(errs){
  const cols=errs.map(e=>e.col);
  const perm=errs.some(e=>/permission|insufficient/i.test(e.code+' '+e.message));
  return `<div class="ma-errcard" role="alert"><b>Could not read ${_maE(cols.join(', '))}.</b> ${perm?'The Firestore rules refused the read — republish firestore.rules with the Master Accounts block.':_maE(errs[0].message)} Nothing below is shown as empty or zero — nothing could be read.
    <div class="ma-errcard-acts"><button class="ma-btn" onclick="window.maRetry()">Retry</button></div></div>`;
}
function _maSkeleton(){
  return `<div class="ma-page"><div class="ma-head"><div class="ma-head-t"><div class="gv-skel" style="height:22px;width:180px"></div></div></div>
    <div class="ma-stats">${'<div class="ma-stat"><div class="gv-skel" style="height:12px;width:60%"></div><div class="gv-skel" style="height:24px;width:80%;margin-top:8px"></div></div>'.repeat(4)}</div>
    ${'<div class="gv-skel" style="height:40px;margin-bottom:8px"></div>'.repeat(5)}</div>`;
}

/* ── Rendering ─────────────────────────────────────────────────────────── */
function maRenderPage(id){
  const m=document.getElementById('main-content');
  if(!m)return;
  if(!maCanSee()){m.innerHTML='<div class="ma-page"><div class="ma-errcard">Master Accounts is for Afnan and Ammar.</div></div>';return;}
  if(_maPage!==id){_maRail=null;_maLedgerShown=50;}
  _maPage=id;
  if(_maNeedsRelock()){_maShowLock();return;}
  _maLockShown=false;
  _maTouch();
  if(!_maEnterLogged){_maEnterLogged=true;_maAuditQuiet('enter',null,'Opened Master Accounts');}
  if(!maLoaded){
    m.innerHTML=_maSkeleton();
    maLoad().then(()=>{if(typeof currentPage==='undefined'||currentPage===id)_maPaint();});
    return;
  }
  _maPaint();
  _maMirrorFreshen(id);
}
function _maPaint(){
  const m=document.getElementById('main-content');
  if(!m)return;
  // Every repaint asks first (security F5): a period switch, a tab, a filter
  // or a save landing on a page left open past the re-lock shows the lock.
  if(!_maMayPaint())return;
  m.innerHTML=_maPageHTML(_maPage);
  const parent=_MA_PARENT[_maPage];
  if(parent){const n=document.getElementById('nav-'+parent);if(n&&n.classList)n.classList.add('on');}
}
function _maPageHTML(id){
  const errs=_maCoreErrs();
  if(errs.length){
    const t=(MA_PAGES.find(p=>p.id===id)||{label:'Master Accounts'}).label;
    return `<div class="ma-page">${_maHead(t,'')}${_maErrorCard(errs)}</div>`;
  }
  let main;
  if(id==='ma-money')main=_maMoneyHTML();
  else if(id==='ma-holder')main=_maHolderHTML();
  else if(id==='ma-out')main=_maOutHTML();
  else if(id==='ma-parties')main=_maPartiesHTML();
  else if(id==='ma-party')main=_maPartyHTML();
  else if(id==='ma-ledger')main=_maLedgerHTML();
  else if(id==='ma-close')main=_maCloseHTML();
  else main=_maTodayHTML();
  const rail=_maRailHTML();
  return `<div class="ma-shell${rail?' rail-open':''}"><div class="ma-page">${main}</div>${rail}</div>`;
}
window.maRetry=function(){maLoad(true).then(_maPaint);};
window.maRefresh=function(){_maToast('Refreshing…');maLoad(true).then(_maPaint);};

/* ═══ Today ═══════════════════════════════════════════════════════════════ */
let _maAllConcerns=false;
let _maLastConcerns=[];
function _maLatestBackup(){
  if(_maErr('backups'))return undefined;
  const r=maData.backups.slice().sort((a,b)=>(b.at||0)-(a.at||0));
  return r[0]||null;
}
/* The 30 days fund from cash and bank with every waiting handover NOT
   moved, and say when the drawer could not be read (maSpendable, M1.6b). */
function _maCalendarOf(c){
  const sp=maSpendable(c.holders);
  return maCalendar({settings:c.s,today:c.today,commitments:maData.commitments,docs:c.docs,start:sp.total,complete:sp.complete,waiting:sp.waiting});
}
function _maAttention(c){
  if(c._na)return c._na;
  const cal=_maCalendarOf(c);
  c._cal=cal;
  c._na=maNeedsAttention({settings:c.s,today:c.today,holders:c.holders,calendar:cal,commitments:maData.commitments,docs:c.docs,
    unlabelled:maUnlabelled(c.docs,c.idx,c.s),review:maReviewQueue(c.docs),recon:maBalanceOf(c.lines,c.idx,'9030'),
    backup:_maLatestBackup(),backupUnread:!!_maErr('backups'),nowMs:Date.now()});
  return c._na;
}
function _maSentence(s){return _maE(s).replace(/(−?₨[\d,]+)/g,'<b>$1</b>');}
function _maConcernsHTML(na){
  _maLastConcerns=na;
  if(!na.length)return `<div class="ma-fine"><span class="ma-dot fine"></span>Nothing to worry about today.</div>`;
  const shown=_maAllConcerns?na:na.slice(0,3);
  return `<ul class="ma-concerns">${shown.map((x,i)=>`<li><span class="ma-dot ${x.state==='concern'?'urgent':'warn'}"></span><span class="ma-line" title="${_maE(x.basis)}">${_maSentence(x.sentence)}</span>${x.action?`<button class="ma-act" onclick="window.maConcern(${i})">${_maE(x.action.label)}</button>`:''}</li>`).join('')}</ul>
    ${na.length>3?`<button class="ma-link" onclick="window.maToggleConcerns()">${_maAllConcerns?'Show fewer':'and '+(na.length-3)+' more'}</button>`:''}`;
}
window.maToggleConcerns=function(){_maAllConcerns=!_maAllConcerns;_maPaint();};
window.maConcern=function(i){
  const x=_maLastConcerns[i];if(!x||!x.action)return;
  const a=x.action;
  if(a.go==='holder'){_maHolderCode=a.ref;window.showPage('ma-holder');}
  else if(a.go==='reload')window.maRetry();
  else if(a.go==='calendar'){const el=document.getElementById('ma-cal');if(el&&el.scrollIntoView)el.scrollIntoView({behavior:'smooth'});}
  else if(a.go==='pay_commitment')window.maPayCommitment(a.ref,a.period);
  else if(a.go==='doc')window.maOpenDoc(a.dt||'transfer',a.ref);
  else if(a.go==='count')window.maRecordKind('count',{holder:a.ref});
  else if(a.go==='unlabelled'){_maLedgerTab='unlabelled';window.showPage('ma-ledger');}
  else if(a.go==='review'){_maLedgerTab='review';window.showPage('ma-ledger');}
  else if(a.go==='account'){_maLedgerTab='postings';_maLF=Object.assign(_maLFBlank(),{account:a.ref});_maPeriod='all';window.showPage('ma-ledger');}
  else if(a.go==='backups'){_maCloseTab='overview';window.showPage('ma-close');}
};
/* Money that came in and went out this month. Per document, the net of
   what moved on the holders: money moved from one holder to another — a
   transfer, or a journal whose lines only move it between holders — nets
   to nothing, and an opening balance is where the books start, not money
   that came in (money N3). A count is a difference, not a movement. */
function _maMonthFlows(c){
  const month=maMonthOf(c.today);let inM=0,outM=0;
  const net={};
  c.lines.forEach(l=>{
    if(l.month!==month||!l.holder||l.account!==l.holder||!l.doc)return;
    if(l.doc.dt!=='journal'||l.doc.kind==='opening')return;
    const k=l.doc.dt+'/'+l.doc.id;net[k]=(net[k]||0)+(l.dr||0)-(l.cr||0);
  });
  Object.keys(net).forEach(k=>{if(net[k]>0)inM+=net[k];else outM-=net[k];});
  return {inM,outM};
}
function _maOwed(c){
  const tb=maTrialBalance(c.lines,c.idx,{book:'groovy'});
  let owedTo=0,weOwe=0;
  tb.rows.forEach(r=>{const a=maAcc(c.idx,r.code);if(!a||!a.control)return;const b=maBal(a,{dr:r.dr,cr:r.cr});if(a.type==='asset')owedTo+=b;else if(a.type==='liability')weOwe+=b;});
  return {owedTo,weOwe};
}
function _maStat(label,value,sub,hero){
  return `<div class="ma-stat${hero?' hero':''}"><div class="ma-stat-l">${_maE(label)}</div><div class="ma-stat-v">${value}</div>${sub?`<div class="ma-stat-s">${sub}</div>`:''}</div>`;
}
function _maHolderRowsHTML(c,rows,o){
  o=o||{};
  const cols=[{h:'Holder'},{h:'Balance',cls:'ma-num',l:'Balance'},{h:'Waiting',cls:'ma-num',l:'Waiting'},{h:'Last count',cls:'ma-nw',l:'Last count'}];
  if(o.full)cols.splice(3,0,{h:'Can pay',cls:'ma-num',l:'Can pay'});
  let total=0,complete=true;
  const trs=rows.map(h=>{
    if(h.balance===null)complete=false;else if(h.active&&h.holderKind!=='wallet')total+=h.balance;
    const bal=h.balance===null?'<span class="ma-word warn">not read</span>':_maRsCell(h.balance);
    const wait=(h.pendingIn?'+'+maRs(h.pendingIn):'')+(h.pendingIn&&h.pendingOut?' · ':'')+(h.pendingOut?'−'+maRs(h.pendingOut):'');
    const lc=h.mirror?'<span class="ma-muted">in Store Accounts'+(h.balance!==null&&_maMirrorAsOf()?' · '+_maMirrorAsOf():'')+'</span>':(h.lastCount?maDayLabel(h.lastCount.date)+(h.lastCount.difference?` <span class="ma-word warn">${maRsSigned(h.lastCount.difference)}</span>`:''):'<span class="ma-muted">never</span>');
    const name=`${_maE(h.name)}${h.active?'':' <span class="ma-muted">off</span>'}`;
    const cells=[name,bal,wait?`<span class="ma-muted">${wait}</span>`:'',lc];
    if(o.full)cells.splice(3,0,h.available===null?'':_maRsCell(h.available));
    return {cells,click:`window.maOpenHolder('${_maQ(h.code)}')`};
  });
  const tot=['Cash in hand',`${maRs(total)}${complete?'':' <span class="ma-word warn">incomplete</span>'}`,'',''];
  if(o.full)tot.splice(3,0,'');
  return _maTable(cols,trs,{total:tot});
}
function _maCalHTML(cal){
  const lead=(maWeekday(cal.days[0].day)+6)%7;
  const cells=[];
  for(let i=0;i<lead;i++)cells.push('<div class="ma-cd blank" aria-hidden="true"></div>');
  cal.days.forEach((d,i)=>{
    const dn=+d.day.slice(8,10);
    const lab=(i===0?'Today':MA_WEEKDAYS[d.weekday]+' '+dn)+(dn===1&&i?' '+MA_MONTHS[+d.day.slice(5,7)-1]:'');
    const ev=d.events.slice(0,2).map(e=>`<span class="ma-ev ${e.dir==='in'?'in':''}${e.late?' late':''}">${_maE(e.label)} ${maRsShort(e.amount)}</span>`).join('')
      +(d.events.length>2?`<span class="ma-ev mute">+${d.events.length-2} more</span>`:'');
    const marks=[d.payDay?'pay day':'',d.cprDay?'CPR day':''].filter(Boolean).join(' · ');
    const has=d.events.length||d.payDay||d.cprDay;
    // A day is "short" only when every holder was read: without the drawer
    // a short day is the missing balance talking (money F3).
    const short=cal.complete!==false&&d.projected<0;
    cells.push(`<div class="ma-cd${i===0?' today':''}${has?' has':''}${short?' short':''}"><b>${_maE(lab)}</b>${ev}${marks?`<span class="ma-ev mute">${marks}</span>`:''}${d.events.length?`<span class="ma-ev ${short?'short':'mute'}">leaves ${maRsShort(d.projected)}</span>`:''}</div>`);
  });
  return `<div class="ma-cal-head" aria-hidden="true">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<span>${x}</span>`).join('')}</div><div class="ma-cal">${cells.join('')}</div>`;
}
function _maTodayHTML(){
  const c=_maCtx();
  const cih=maCashInHand(c.holders);
  const f=_maMonthFlows(c);
  const ow=_maOwed(c);
  const na=_maAttention(c);
  const cal=c._cal||_maCalendarOf(c);
  const net=ow.owedTo-ow.weOwe;
  const stats=`<div class="ma-stats">
    ${_maStat('Cash in hand',maRs(cih.total),cih.complete?cih.holders+' holders':'drawer not read — incomplete',true)}
    ${_maStat('In this month',maRs(f.inM),'into the holders')}
    ${_maStat('Out this month',maRs(f.outM),'from the holders')}
    ${_maStat('Owed to us less we owe',_maRsCell(net),ow.owedTo||ow.weOwe?maRs(ow.owedTo)+' to us · '+maRs(ow.weOwe)+' we owe':'nothing on credit yet')}
  </div>`;
  const attention=_maSec('Needs attention',na.length?String(na.length):'','',_maConcernsHTML(na));
  const active=c.holders.filter(h=>h.active||h.balance);
  const holders=_maSec('Cash by holder','',_maLink('Money','window.showPage(\'ma-money\')'),_maHolderRowsHTML(c,active));
  const first=cal.unfunded[0];
  // The drawer not read: every figure here is short by what it holds, said
  // beside each one, and a short day cannot be judged (money F3).
  const inc=cal.complete===false;
  const incW=inc?' <span class="ma-word warn">incomplete</span>':'';
  const next=_maSec('The next 30 days','',_maLink('Money out','window.showPage(\'ma-out\')'),
    `<dl class="ma-dl">
      <dt>Cash and bank today</dt><dd>${maRs(cal.start)}${incW}</dd>
      ${cal.waiting?`<dt>Handovers waiting</dt><dd>${maRs(cal.waiting)} <span class="ma-muted">into the drawer — counted where they came from until confirmed</span></dd>`:''}
      <dt>Due out</dt><dd>${maRs(cal.out)}</dd>
      <dt>Expected in</dt><dd>${cal.in?maRs(cal.in):'<span class="ma-muted">none yet — CPRs arrive with M2</span>'}</dd>
      <dt>Leaves</dt><dd>${_maRsCell(cal.end)}${incW}</dd>
      <dt>First short day</dt><dd>${inc?(first?'<span class="ma-word warn">can’t judge — the drawer’s balance could not be read</span>':'<span class="ma-muted">none, even without the drawer</span>'):first?`<span class="ma-word urgent">${maDayLabel(first)}</span>`:'<span class="ma-muted">none</span>'}</dd>
    </dl>`);
  const strip=_maSec('Day by day',inc?'the drawer’s balance could not be read — these leave it out':'the cost register’s dues against cash and bank','',_maCalHTML(cal),'ma-cal');
  const meta=_maE(maDayLabel(c.today,true))+' · '+_maE(maQuarterLabel(maQuarterOf(c.today,c.s.fiscalYearStart),c.s.fiscalYearStart));
  return _maHead('Today',meta,{excel:'today'})+stats+attention+`<div class="ma-cols2">${holders}${next}</div>`+strip;
}

/* ═══ Money — the holders ════════════════════════════════════════════════ */
let _maHolderCode=null;
window.maOpenHolder=function(code){_maHolderCode=String(code);window.showPage('ma-holder');};
function _maPendingHTML(c,list){
  if(!list.length)return _maEmpty('Nothing waiting to be confirmed.');
  const cols=[{h:'Date',cls:'ma-date'},{h:'Transfer'},{h:'Amount',cls:'ma-num',l:'Amount'},{h:'Confirms',l:'Confirms'},{h:'',cls:'ma-nw'}];
  const rows=list.map(d=>{
    // A closed quarter is said as such, not as "theirs" (money F7).
    const locked=maQuarterLocked(d,{closes:maData.closes,settings:c.s});
    const can=!locked&&!maConfirmPatch(d,session.u,{at:0}).error;
    return {cells:[maDayLabel(d.date),`<button class="ma-doclink" onclick="event.stopPropagation();window.maOpenDoc('transfer','${_maQ(d.id)}')">${_maE(d.no)}</button> ${_maE(_maDocDesc(d,c))}`,maRs(d.amount),
      _maE(_maWho(d.confirmBy))+(d.confirmPaper?' <span class="ma-muted">on paper</span>':''),
      can?`<button class="ma-btn sm" onclick="event.stopPropagation();window.maConfirmDoc('${_maQ(d.id)}')">Confirm</button>`:`<span class="ma-muted">${locked?'quarter closed':'theirs'}</span>`]};
  });
  return _maTable(cols,rows);
}
function _maMoneyHTML(){
  const c=_maCtx();
  const pend=c.docs.filter(d=>d.dt==='transfer'&&d.status==='pending').sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const counts=c.docs.filter(d=>d.dt==='count'&&d.status!=='void').sort((a,b)=>String(b.date).localeCompare(String(a.date))||(b.ts||0)-(a.ts||0)).slice(0,10);
  const mirrorLine=c.holders.some(h=>h.mirror)?(_maMirror.ok?['drawer read from Store Accounts',_maMirrorAsOf()].filter(Boolean).join(' '):'drawer not read — '+_maE(_maMirror.why)):'';
  const countRows=counts.map(d=>({cells:[maDayLabel(d.date),`<button class="ma-doclink" onclick="event.stopPropagation();window.maOpenDoc('count','${_maQ(d.id)}')">${_maE(d.no)}</button>`,_maE(_maAccName(c,d.holder)),maRs(d.counted),d.difference?`<span class="ma-word warn">${maRsSigned(d.difference)}</span>`:'<span class="ma-word fine">agrees</span>'],click:`window.maOpenDoc('count','${_maQ(d.id)}')`}));
  return _maHead('Money',c.holders.length+' holders'+(mirrorLine?' · '+mirrorLine:''),{excel:'holders'})
    +_maSec('Holders','',`${_maLink('Transfer','window.maRecordKind(\'transfer\')')} ${_maLink('Count','window.maRecordKind(\'count\')')}`,_maHolderRowsHTML(c,c.holders,{full:true}))
    +_maSec('Waiting to be confirmed',pend.length?String(pend.length):'','',_maPendingHTML(c,pend))
    +_maSec('Recent counts','','',counts.length?_maTable([{h:'Date',cls:'ma-date'},{h:'Count'},{h:'Holder',l:'Holder'},{h:'Counted',cls:'ma-num',l:'Counted'},{h:'Against the book',l:'Book'}],countRows):_maEmpty('No holder has been counted yet.',_maLink('Count one','window.maRecordKind(\'count\')')));
}
function _maHolderStatement(c,code){
  const r=_maRange(c);
  return {r,led:maLedger(c.lines,{holder:code,from:r.from,to:r.to},c.idx,c.s)};
}
function _maHolderHTML(){
  const c=_maCtx();
  const h=c.holders.find(x=>x.code===_maHolderCode);
  if(!h)return _maHead('Holder','',{back:['ma-money','Money']})+_maEmpty('That holder is not in the chart.',_maLink('Back to Money','window.showPage(\'ma-money\')'));
  const {r,led}=_maHolderStatement(c,h.code);
  const meta=(h.balance===null?'balance not read':'balance '+maRs(h.balance))+(h.person?' · with '+_maE(_maWho(h.person)):'')+(h.lastCount?' · counted '+maDayLabel(h.lastCount.date):'');
  const banner=h.mirror?`<div class="ma-note">Raees’s drawer is his book in Store Accounts until M8 — the balance is read from there${_maMirror.ok?' ('+[maRs(_maMirror.cash),_maMirrorAsOf()].filter(Boolean).join(', ')+')':', and the read failed ('+_maE(_maMirror.why)+')'}. Only handovers to and from it are recorded here.</div>`:'';
  const cols=[{h:'Date',cls:'ma-date'},{h:'Document'},{h:'What'},{h:'In',cls:'ma-num',l:'In'},{h:'Out',cls:'ma-num',l:'Out'}];
  if(!h.mirror)cols.push({h:'Balance',cls:'ma-num',l:'Balance'});
  const docOf=l=>c.docs.find(d=>d.id===(l.doc&&l.doc.id))||null;
  const rows=led.rows.map(l=>{
    const d=docOf(l);
    const cells=[maDayLabel(l.date),`<button class="ma-doclink" onclick="event.stopPropagation();window.maOpenDoc('${_maQ(l.doc.dt)}','${_maQ(l.doc.id)}')">${_maE(l.doc.no||'')}</button>`,_maE(d?maDocTitle(d,c.idx)+(d.dt==='journal'?' · '+_maDocDesc(d,c):''):''),l.dr?maRs(l.dr):'',l.cr?maRs(l.cr):''];
    if(!h.mirror)cells.push(_maRsCell(l.balance));
    return {cells,click:`window.maOpenDoc('${_maQ(l.doc.dt)}','${_maQ(l.doc.id)}')`};
  });
  const total=['Closing','','',maRs(led.dr),maRs(led.cr)];if(!h.mirror)total.push(_maRsCell(led.closing));
  const open=h.mirror?'':`<div class="ma-sub">Opening ${_maE(maDayLabel(r.from,true))} <b>${maRs(led.opening)}</b></div>`;
  const pend=c.docs.filter(d=>d.dt==='transfer'&&d.status==='pending'&&(d.from===h.code||d.to===h.code));
  return _maHead(h.name,meta,{back:['ma-money','Money'],period:true,excel:'holder',pdf:'holder'})+banner
    +_maSec('Statement',_maE(r.label)+' · '+led.count+' movement'+(led.count===1?'':'s'),`${_maLink('Transfer','window.maRecordKind(\'transfer\',{from:\''+_maQ(h.code)+'\'})')}${h.mirror?'':' '+_maLink('Count','window.maRecordKind(\'count\',{holder:\''+_maQ(h.code)+'\'})')}`,
      open+(rows.length?_maTable(cols,rows,{total}):_maEmpty('Nothing moved in '+_maE(r.label)+'.')))
    +(pend.length?_maSec('Waiting to be confirmed','','',_maPendingHTML(c,pend)):'');
}
/* Confirm (§3 #3). Refused in a closed quarter, naming it (money F7). A
   handover that touches the drawer asks first: it is confirmed only once
   Raees has recorded it in Store Accounts (money F9). The stored copy is
   re-read and must be the revision this screen showed (money F11) — an
   edit since is a different revision, and the audit row names what was
   confirmed. */
window.maConfirmDoc=async function(id){
  const d=_maDoc('transfer',id);if(!d||_maBusy)return;
  const r=maConfirmPatch(d,session.u,{at:Date.now()},{closes:maData.closes,settings:_maCtx().s});
  if(r.error){_maToast(r.error);return;}
  const warn=maConfirmWarning(d);
  if(warn&&!confirm(warn+'\n\nHas Raees recorded it?'))return;
  if(_maNeedsNet())return;
  _maBusy=true;
  try{
    await _maWritePatch(d,r.patch,'confirm',maRs(d.amount)+' '+(r.patch.confirmVia==='paper'?'on paper for '+_maWho(d.confirmBy):'received'),
      cur=>cur.status!=='pending'?'It is no longer waiting — refresh.':(cur.rev||1)!==(d.rev||1)?'It changed since it was opened — refresh and check it before confirming.':null);
    Object.assign(d,r.patch);_maInvalidate();_maToast(d.no+' confirmed — it counts now.');_maPaint();
  }catch(e){_maToast(_maWriteError(e));}finally{_maBusy=false;}
};

/* ═══ Money out — the cost register (§26) ═══════════════════════════════ */
const _MA_STATE_WORD={paid:['fine','paid'],part:['warn','part paid'],due:['warn','due'],overdue:['urgent','overdue'],upcoming:['mute','upcoming'],none:['mute','no calendar day']};
function _maCommitRows(c,list){
  return list.map(x=>{
    const st=maCommitmentStatus(x,c.docs,c.today,c.s);
    const w=_MA_STATE_WORD[st.state]||_MA_STATE_WORD.none;
    const when=st.due?(st.state==='upcoming'?maDayLabel(st.due):maDayLabel(st.due)):'';
    const who=x.party?_maPartyName(x.party):'';
    return {cells:[
      `${_maE(x.name)}${who?`<span class="ma-l2">${_maE(who)}</span>`:''}`,
      _maE((MA_SPEND_GROUPS[x.kind]||{label:String(x.kind||'').replace('_','-')}).label||x.kind),
      _maE(maCommitmentText(x)),
      x.amountExpected?maRs(x.amountExpected):'<span class="ma-muted">varies</span>',
      `<span class="ma-word ${w[0]}">${w[1]}</span>${when?` <span class="ma-muted">${when}</span>`:''}`,
      _maE(_maAccName(c,x.account)),
      x.active===false?'<span class="ma-muted">off</span>':`<button class="ma-btn sm" onclick="event.stopPropagation();window.maPayCommitment('${_maQ(x.id)}','')">Record payment</button>`
    ],click:`window.maOpenCommitment('${_maQ(x.id)}')`};
  });
}
function _maOutHTML(){
  const c=_maCtx();
  const list=maData.commitments.slice().sort((a,b)=>(a.active===false)-(b.active===false)||String(a.name).localeCompare(String(b.name)));
  const monthly=list.filter(x=>x.active!==false&&x.cadence==='monthly').reduce((t,x)=>t+(x.amountExpected||0),0);
  const cols=[{h:'Commitment'},{h:'Kind',l:'Kind'},{h:'Schedule',l:'Schedule'},{h:'Expected',cls:'ma-num',l:'Expected'},{h:'This period',l:'State'},{h:'Booked to',l:'Account'},{h:'',cls:'ma-nw'}];
  const body=list.length?_maTable(cols,_maCommitRows(c,list)):_maEmpty('No commitments yet — rent, utilities, subscriptions, insurance.',_maLink('Add one','window.maRecordKind(\'commitment\')'));
  return _maHead('Money out',list.filter(x=>x.active!==false).length+' commitments · '+maRs(monthly)+' a month on monthly lines',{excel:'commitments'})
    +_maSec('Commitments','',_maLink('New commitment','window.maRecordKind(\'commitment\')'),body);
}
window.maPayCommitment=function(id,period){
  const x=_maCommit(id);if(!x)return;
  const c=_maCtx();
  // What is left of the period this payment will name — the named one, or
  // the oldest still open today, which the form will offer.
  const per=period||maCommitmentOpenPeriod(x,c.docs,c.today,c.s);
  const paid=c.docs.filter(d=>d.status!=='void'&&d.commitmentId===x.id&&d.commitmentPeriod===per).reduce((t,d)=>t+(d.amount||0),0);
  const left=Math.max(0,(x.amountExpected||0)-paid);
  const hold=x.holder&&!(c.s.mirrors&&c.s.mirrors[x.holder])?x.holder:'';
  // The period is the one named (a concern says which); else the form
  // offers the oldest still open on the day (maCommitmentOpenPeriod).
  window.maRecordKind('money_out',{commitmentId:x.id,commitmentPeriod:period||'',account:x.account,holder:hold,party:x.party||'',
    amount:left||'',costCentre:x.costCentre||'',labelKind:MA_LABEL_KINDS.indexOf(x.kind)>=0?x.kind:''});
};
window.maOpenCommitment=function(id){_maRail={kind:'commitment',id:String(id)};_maPaint();};

/* ═══ Parties ════════════════════════════════════════════════════════════ */
let _maPartyKind='all';
let _maPartyQ='';
let _maPartyId=null;
let _maPartyQT=null;
function _maPartyFlows(c){
  const fy=maFyOf(c.today,c.s.fiscalYearStart);
  const out={};
  c.lines.forEach(l=>{
    if(!l.party)return;
    const o=out[l.party]||(out[l.party]={paid:0,got:0,last:''});
    if(l.date>o.last)o.last=l.date;
    if(l.fy!==fy||!l.holder||l.account!==l.holder)return;
    o.paid+=l.cr;o.got+=l.dr;
  });
  c.docs.forEach(d=>{if(d.party&&d.status!=='void'){const o=out[d.party]||(out[d.party]={paid:0,got:0,last:''});if(d.date>o.last)o.last=d.date;}});
  return out;
}
function _maPartyListRows(c){
  const flows=_maPartyFlows(c);
  const q=maNorm(_maPartyQ);
  return maData.parties.filter(p=>(_maPartyKind==='all'||p.kind===_maPartyKind)&&(!q||maNorm([p.name,p.code,p.kind,p.notes].join(' ')).indexOf(q)>=0))
    .sort((a,b)=>(a.active===false)-(b.active===false)||String(a.name).localeCompare(String(b.name)))
    .map(p=>{const f=flows[p.id]||{paid:0,got:0,last:''};return {p,f};});
}
function _maPartyTableHTML(c){
  const rows=_maPartyListRows(c);
  if(!maData.parties.length)return _maEmpty('No parties yet.',_maLink('Add the first','window.maPartyForm()'));
  if(!rows.length)return _maEmpty('No party matches.');
  const cols=[{h:'Party'},{h:'Kind',l:'Kind'},{h:'Terms',l:'Terms'},{h:'Paid out this year',cls:'ma-num',l:'Paid out'},{h:'Received this year',cls:'ma-num',l:'Received'},{h:'Last activity',cls:'ma-nw',l:'Last'}];
  return _maTable(cols,rows.map(({p,f})=>({cells:[
    `${_maE(p.name)}<span class="ma-l2">${_maE(p.code||'')}${p.active===false?' · inactive':''}</span>`,
    _maE(MA_PARTY_KIND_LABELS[p.kind]||p.kind),
    p.vendor&&p.vendor.terms?_maE(maTermsText(p.vendor.terms)):'<span class="ma-muted">—</span>',
    f.paid?maRs(f.paid):'',f.got?maRs(f.got):'',
    f.last?maDayLabel(f.last):'<span class="ma-muted">none</span>'],click:`window.maOpenParty('${_maQ(p.id)}')`})));
}
function _maPartiesHTML(){
  const c=_maCtx();
  const kinds=MA_PARTY_KINDS.filter(k=>maData.parties.some(p=>p.kind===k));
  const seg=kinds.length>1?`<div class="ma-period" role="group" aria-label="Kind"><button class="${_maPartyKind==='all'?'on':''}" onclick="window.maPartyKindSet('all')">All</button>${kinds.map(k=>`<button class="${_maPartyKind===k?'on':''}" onclick="window.maPartyKindSet('${k}')">${MA_PARTY_KIND_LABELS[k]}s</button>`).join('')}</div>`:'';
  const filters=`<div class="ma-filters">${seg}<input class="ma-in ma-search" id="ma-party-q" type="search" placeholder="Search parties" value="${_maE(_maPartyQ)}" oninput="window.maPartyQSet(this.value)"></div>`;
  return _maHead('Parties',maData.parties.length+' parties',{excel:'parties'})
    +_maSec('Everyone we deal with','',_maLink('New party','window.maPartyForm()'),filters+`<div id="ma-party-list">${_maPartyTableHTML(c)}</div>`);
}
window.maPartyKindSet=function(k){_maPartyKind=MA_PARTY_KINDS.indexOf(k)>=0?k:'all';_maPaint();};
window.maPartyQSet=function(v){
  _maPartyQ=String(v||'');clearTimeout(_maPartyQT);
  _maPartyQT=setTimeout(()=>{if(!_maMayPaint())return;const el=document.getElementById('ma-party-list');if(el)el.innerHTML=_maPartyTableHTML(_maCtx());},180);
};
window.maOpenParty=function(id){_maPartyId=String(id);window.showPage('ma-party');};
function _maPartyHTML(){
  const c=_maCtx();
  const p=_maParty(_maPartyId);
  if(!p)return _maHead('Party','',{back:['ma-parties','Parties']})+_maEmpty('That party is not in the master.',_maLink('Back to Parties','window.showPage(\'ma-parties\')'));
  const r=_maRange(c);
  const f=_maPartyFlows(c)[p.id]||{paid:0,got:0,last:''};
  const docs=c.docs.filter(d=>d.party===p.id).sort((a,b)=>String(b.date).localeCompare(String(a.date))||(b.ts||0)-(a.ts||0));
  const v=p.vendor||null;
  const meta=_maE(MA_PARTY_KIND_LABELS[p.kind]||p.kind)+' · '+_maE(p.code||'')+(p.active===false?' · inactive':'')+(v&&v.terms?' · '+_maE(maTermsText(v.terms)):'');
  const stats=`<div class="ma-stats">${_maStat('Paid out this year',maRs(f.paid),'from our holders')}${_maStat('Received this year',maRs(f.got),'into our holders')}${_maStat('Documents',String(docs.filter(d=>d.status!=='void').length),docs.some(d=>d.status==='void')?docs.filter(d=>d.status==='void').length+' void':'')}${_maStat('Last activity',f.last?_maE(maDayLabel(f.last)):'—','')}</div>`;
  const det=[['Kind',MA_PARTY_KIND_LABELS[p.kind]||p.kind],['Code',p.code],['Cost centre',p.costCentre||c.s.defaultCostCentre],
    ['Contact',[p.contact&&p.contact.person,p.contact&&p.contact.phone].filter(Boolean).join(' · ')],
    ['Provides',v&&v.roles&&v.roles.length?v.roles.map(x=>x.replace(/_/g,' ')).join(', '):''],
    ['Tax',v&&v.tax&&v.tax.regime?(MA_TAX_LABELS[v.tax.regime]||v.tax.regime)+(v.tax.withholdingPct?' · withholding '+v.tax.withholdingPct+'%':''):'No tax'],
    ['Notes',p.notes]].filter(x=>x[1]);
  const details=_maSec('Details','',_maLink('Edit','window.maPartyForm(\''+_maQ(p.id)+'\')'),`<dl class="ma-dl">${det.map(([k,x])=>`<dt>${_maE(k)}</dt><dd>${_maE(x)}</dd>`).join('')}</dl>`);
  let terms='',rates='';
  if(p.kind==='vendor'){
    const hist=(v&&v.termsHistory||[]).slice().reverse();
    terms=_maSec('Terms',v&&v.terms?_maE(maTermsText(v.terms))+(v.terms.from?' since '+maDayLabel(v.terms.from,true):''):'none set',_maLink('Change terms','window.maTermsForm(\''+_maQ(p.id)+'\')'),
      hist.length?_maTable([{h:'Terms'},{h:'From',cls:'ma-date',l:'From'},{h:'To',cls:'ma-date',l:'To'},{h:'Changed by',l:'By'},{h:'Why',l:'Why'}],hist.map(h=>[_maE(maTermsText(h)),h.from?maDayLabel(h.from,true):'—',h.to?maDayLabel(h.to,true):'—',_maE(_maWho(h.by)),_maE(h.reason||'')])):_maEmpty('No earlier terms.'));
    const card=(v&&v.rateCard||[]).slice().sort((a,b)=>String(a.item).localeCompare(String(b.item))||String(b.validFrom||'').localeCompare(String(a.validFrom||'')));
    rates=_maSec('Rate card',card.filter(x=>!x.validTo).length+' current','',
      (card.length?_maTable([{h:'Item'},{h:'Unit',l:'Unit'},{h:'Rate',cls:'ma-num',l:'Rate'},{h:'From',cls:'ma-date',l:'From'},{h:'To',cls:'ma-date',l:'To'},{h:'By',l:'By'}],
        card.map(x=>({cls:x.validTo?'ma-old':'',cells:[_maE(x.item)+(x.note?`<span class="ma-l2">${_maE(x.note)}</span>`:''),_maE(x.unit),'₨'+_maE(Number(x.rate).toLocaleString('en-US',{maximumFractionDigits:2})),x.validFrom?maDayLabel(x.validFrom,true):'—',x.validTo?maDayLabel(x.validTo,true):'<span class="ma-word fine">current</span>',_maE(_maWho(x.by))]}))):_maEmpty('No rates yet.'))
      +`<div class="ma-sec-foot">${_maLink('Add a rate','window.maRateForm(\''+_maQ(p.id)+'\')')}</div>`);
  }
  const commits=maData.commitments.filter(x=>x.party===p.id);
  const cm=commits.length?_maSec('Commitments','','',_maTable([{h:'Commitment'},{h:'Kind',l:'Kind'},{h:'Schedule',l:'Schedule'},{h:'Expected',cls:'ma-num',l:'Expected'},{h:'This period',l:'State'},{h:'Booked to',l:'Account'},{h:'',cls:'ma-nw'}],_maCommitRows(c,commits))):'';
  const inR=docs.filter(d=>d.date>=r.from&&d.date<=r.to);
  const acts=_maSec('Activity',_maE(r.label)+' · '+inR.length+' document'+(inR.length===1?'':'s'),'',
    inR.length?_maDocsTable(c,inR):_maEmpty('Nothing with '+_maE(p.name)+' in '+_maE(r.label)+'.'));
  const led=maLedger(c.lines,{party:p.id,from:r.from,to:r.to},c.idx);
  const ledger=_maSec('Ledger',led.count+' posting'+(led.count===1?'':'s'),'',led.count?_maPostingsTable(c,led,false):_maEmpty('No postings in '+_maE(r.label)+'.'));
  return _maHead(p.name,meta,{back:['ma-parties','Parties'],period:true,excel:'party',pdf:'party'})+stats+details+terms+rates+cm+acts+ledger;
}

/* ═══ Ledger ═════════════════════════════════════════════════════════════ */
let _maLedgerTab='postings';
let _maLedgerShown=50;
function _maLFBlank(){return {holder:'',account:'',party:'',dt:'',q:''};}
let _maLF=_maLFBlank();
let _maLQT=null;
/* The Ledger page's maLedger filter — ONE definition, read by the page, its
   Excel and its PDF, so the three cannot disagree. */
function _maLedgerQuery(c){
  const r=_maRange(c);
  const f=_maLF;
  return {from:r.from,to:r.to,holder:f.holder||undefined,account:(!f.holder&&f.account)||undefined,party:f.party||undefined,dt:f.dt||undefined,q:f.q||undefined};
}
function _maLedgerFiltered(c){
  const r=_maRange(c);
  const q=_maLedgerQuery(c);
  // A running balance only when it IS the account's (maLedgerBalanceHidden,
  // M1.6b): not under a party, document-type or search filter, and not for
  // the drawer, whose balance is Store Accounts'.
  const led=maLedger(c.lines,q,c.idx,c.s);
  return {r,led,single:led.balanceHidden?null:(q.holder||q.account)};
}
/* Why a ledger shows no running balance, for the page and the Excel: under
   a narrowing filter, in words; for the drawer, Store Accounts' own figure
   with its "as of", or that it could not be read. '' when there is one. */
function _maLedgerHiddenText(led){
  const h=led&&led.balanceHidden;
  if(!h)return '';
  if(!h.mirror)return maLedgerHiddenWhy(h);
  return 'no running balance here — the drawer’s balance is Store Accounts’: '+(_maMirror.ok?[maRs(_maMirror.cash),_maMirrorAsOf()].filter(Boolean).join(' '):'it could not be read ('+_maMirror.why+')');
}
function _maPostingsTable(c,led,single,limitN){
  const cols=[{h:'Date',cls:'ma-date'},{h:'Document'},{h:'Account',l:'Account'},{h:'Description'},{h:'Labels',cls:'ma-src',l:''},{h:'Debit',cls:'ma-num',l:'Debit'},{h:'Credit',cls:'ma-num',l:'Credit'}];
  if(single)cols.push({h:'Balance',cls:'ma-num',l:'Balance'});
  const rows=(limitN?led.rows.slice(0,limitN):led.rows).map(l=>{
    const desc=[l.party?_maPartyName(l.party):l.payee,l.memo].filter(Boolean).join(' · ');
    const labels=[l.costCentre,l.kind,l.channel,l.status==='historical'?'history':''].filter(Boolean).join(' · ');
    const cells=[maDayLabel(l.date),`<button class="ma-doclink" onclick="event.stopPropagation();window.maOpenDoc('${_maQ(l.doc&&l.doc.dt)}','${_maQ(l.doc&&l.doc.id)}')">${_maE(l.doc&&l.doc.no||'')}</button>`,
      _maE(maAccLabel(c.idx,l.account)),_maE(desc),_maE(labels),l.dr?maRs(l.dr):'',l.cr?maRs(l.cr):''];
    if(single)cells.push(_maRsCell(l.balance));
    return {cells,click:`window.maOpenDoc('${_maQ(l.doc&&l.doc.dt)}','${_maQ(l.doc&&l.doc.id)}')`};
  });
  const tot=['Total','','','','',maRs(led.dr),maRs(led.cr)];if(single)tot.push(_maRsCell(led.closing));
  return _maTable(cols,rows,{total:tot});
}
function _maDocsTable(c,docs,limitN){
  const cols=[{h:'Date',cls:'ma-date'},{h:'Document'},{h:'What'},{h:'Holder',l:'Holder'},{h:'Amount',cls:'ma-num',l:'Amount'},{h:'State',l:'State'}];
  return _maTable(cols,(limitN?docs.slice(0,limitN):docs).map(d=>({cls:d.status==='void'?'ma-void':'',cells:[
    maDayLabel(d.date),`<button class="ma-doclink" onclick="event.stopPropagation();window.maOpenDoc('${_maQ(d.dt)}','${_maQ(d.id)}')">${_maE(d.no)}</button>`,
    `${_maE(maDocTitle(d))}<span class="ma-l2">${_maE(_maDocDesc(d,c))}</span>`,
    _maE(d.holder?_maShortHolder(c,d.holder):d.from?_maShortHolder(c,d.from):''),
    maRs(d.amount||0),_maStatusWord(d)+(maLiveFlags(d).length&&!d.reviewedAt&&d.status!=='void'?' <span class="ma-word warn">flagged</span>':'')],
    click:`window.maOpenDoc('${_maQ(d.dt)}','${_maQ(d.id)}')`})));
}
function _maLedgerBodyHTML(){
  const c=_maCtx();
  if(_maLedgerTab==='documents'){
    const r=_maRange(c);const q=maNorm(_maLF.q);
    const docs=c.docs.filter(d=>d.date>=r.from&&d.date<=r.to&&(!_maLF.dt||d.dt===_maLF.dt)&&(!_maLF.party||d.party===_maLF.party)&&(!q||maDocText(d,c.idx,_maPartyName(d.party)).indexOf(q)>=0))
      .sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.no).localeCompare(String(a.no)));
    return `<div class="ma-scope">${docs.length} document${docs.length===1?'':'s'} · ${_maE(r.label)}</div>`
      +(docs.length?_maDocsTable(c,docs,_maLedgerShown)+(docs.length>_maLedgerShown?`<div class="ma-sec-foot">${_maLink('Show 50 more','window.maLedgerMore()')}</div>`:''):_maEmpty('No documents in '+_maE(r.label)+'.'));
  }
  if(_maLedgerTab==='unlabelled'){
    const u=maUnlabelled(c.docs,c.idx,c.s);
    if(!u.length)return _maEmpty('Nothing waits to be named — the queue is empty.');
    return _maTable([{h:'Date',cls:'ma-date'},{h:'Document'},{h:'Why'},{h:'Amount',cls:'ma-num',l:'Amount'},{h:'',cls:'ma-nw'}],
      u.map(x=>({cells:[maDayLabel(x.doc.date),_maE(x.doc.no),_maE(x.why)+(x.doc.note?`<span class="ma-l2">${_maE(x.doc.note)}</span>`:''),maRs(x.amount),`<button class="ma-btn sm" onclick="event.stopPropagation();window.maEditDoc('${_maQ(x.doc.dt)}','${_maQ(x.doc.id)}')">Name it</button>`],click:`window.maOpenDoc('${_maQ(x.doc.dt)}','${_maQ(x.doc.id)}')`})));
  }
  if(_maLedgerTab==='review'){
    const q=maReviewQueue(c.docs);
    if(!q.length)return _maEmpty('Nothing waits for review.');
    return _maTable([{h:'Date',cls:'ma-date'},{h:'Document'},{h:'Flagged because'},{h:'Amount',cls:'ma-num',l:'Amount'},{h:'',cls:'ma-nw'}],
      q.map(d=>({cells:[maDayLabel(d.date),`${_maE(d.no)}<span class="ma-l2">${_maE(maDocTitle(d))}</span>`,maLiveFlags(d).map(x=>_maE(x.message)).join('<br>'),maRs(d.amount||0),
        maQuarterLocked(d,{closes:maData.closes,settings:c.s})?'<span class="ma-muted">quarter closed</span>':`<button class="ma-btn sm" onclick="event.stopPropagation();window.maReviewDoc('${_maQ(d.dt)}','${_maQ(d.id)}')">Mark reviewed</button>`],click:`window.maOpenDoc('${_maQ(d.dt)}','${_maQ(d.id)}')`})));
  }
  const {r,led,single}=_maLedgerFiltered(c);
  const hid=_maLedgerHiddenText(led);
  const head=`<div class="ma-scope">${led.count} posting${led.count===1?'':'s'} · ${led.sources} source${led.sources===1?'':'s'} · ${_maE(r.label)}${single&&led.opening!==null?' · opening '+maRs(led.opening):''}${hid?' · '+_maE(hid):''}</div>`;
  if(!led.count)return head+_maEmpty('No postings match.');
  return head+_maPostingsTable(c,led,single,_maLedgerShown)+(led.count>_maLedgerShown?`<div class="ma-sec-foot">${_maLink('Show 50 more','window.maLedgerMore()')}</div>`:'');
}
function _maSelect(id,opts,cur,onchange,label){
  return `<select class="ma-in ma-sel" id="${id}" aria-label="${_maE(label||'')}" onchange="${onchange}">${opts.map(o=>`<option value="${_maE(o[0])}"${String(o[0])===String(cur)?' selected':''}>${_maE(o[1])}</option>`).join('')}</select>`;
}
function _maLedgerHTML(){
  const c=_maCtx();
  const u=maUnlabelled(c.docs,c.idx,c.s).length,rv=maReviewQueue(c.docs).length;
  const tabs=_maTabs(_maLedgerTab,[['postings','Postings'],['documents','Documents'],['unlabelled','Unlabelled'+(u?' '+u:'')],['review','Review'+(rv?' '+rv:'')]],'maLedgerTabSet');
  let filters='';
  if(_maLedgerTab==='postings'||_maLedgerTab==='documents'){
    const hs=[['','Every holder']].concat(maMoneyAccounts(c.idx,{all:true}).map(a=>[a.code,a.name]));
    const as=[['','Every account']].concat(c.idx.list.filter(a=>!a.money).map(a=>[a.code,a.code+' · '+a.name]));
    const ps=[['','Every party']].concat(maData.parties.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(p=>[p.id,p.name]));
    const ds=[['','Every document'],['journal','Journals'],['transfer','Transfers'],['count','Counts']];
    filters=`<div class="ma-filters">${_maLedgerTab==='postings'?_maSelect('ma-lf-holder',hs,_maLF.holder,"window.maLedgerFilter('holder',this.value)",'Holder')+_maSelect('ma-lf-account',as,_maLF.account,"window.maLedgerFilter('account',this.value)",'Account'):''}${_maSelect('ma-lf-party',ps,_maLF.party,"window.maLedgerFilter('party',this.value)",'Party')}${_maSelect('ma-lf-dt',ds,_maLF.dt,"window.maLedgerFilter('dt',this.value)",'Document type')}<input class="ma-in ma-search" id="ma-lf-q" type="search" placeholder="Search" value="${_maE(_maLF.q)}" oninput="window.maLedgerSearch(this.value)">${Object.keys(_maLF).some(k=>_maLF[k])?_maLink('Clear','window.maLedgerClear()'):''}</div>`;
  }
  return _maHead('Ledger',c.lines.length+' postings · '+c.docs.length+' documents',{period:_maLedgerTab==='postings'||_maLedgerTab==='documents',excel:_maLedgerTab==='documents'?'documents':'ledger',pdf:_maLedgerTab==='postings'?'ledger':''})
    +tabs+filters+`<div id="ma-ledger-body">${_maLedgerBodyHTML()}</div>`;
}
window.maLedgerTabSet=function(k){_maLedgerTab=['postings','documents','unlabelled','review'].indexOf(k)>=0?k:'postings';_maLedgerShown=50;_maPaint();};
window.maLedgerFilter=function(k,v){if(!(k in _maLF))return;_maLF[k]=String(v||'');if(k==='holder'&&v)_maLF.account='';if(k==='account'&&v)_maLF.holder='';_maLedgerShown=50;_maPaint();};
window.maLedgerSearch=function(v){
  _maLF.q=String(v||'');clearTimeout(_maLQT);
  _maLQT=setTimeout(()=>{if(!_maMayPaint())return;const el=document.getElementById('ma-ledger-body');if(el)el.innerHTML=_maLedgerBodyHTML();},180);
};
window.maLedgerClear=function(){_maLF=_maLFBlank();_maPaint();};
window.maLedgerMore=function(){_maLedgerShown+=50;if(!_maMayPaint())return;const el=document.getElementById('ma-ledger-body');if(el)el.innerHTML=_maLedgerBodyHTML();};

/* ═══ The rail — a document or a commitment, beside whatever page ═══════ */
let _maRail=null;
window.maOpenDoc=function(dt,id){_maRail={kind:'doc',dt:String(dt),id:String(id)};_maPaint();};
window.maCloseRail=function(){_maRail=null;_maPaint();};
function _maRailHTML(){
  if(!_maRail)return '';
  const c=_maCtx();
  let body='';
  if(_maRail.kind==='doc'){const d=_maDoc(_maRail.dt,_maRail.id);if(!d){_maRail=null;return '';}body=_maDocRailHTML(c,d);}
  else if(_maRail.kind==='commitment'){const x=_maCommit(_maRail.id);if(!x){_maRail=null;return '';}body=_maCommitRailHTML(c,x);}
  return `<aside class="ma-rail" aria-label="Detail"><button class="ma-rail-x" aria-label="Close" onclick="window.maCloseRail()">×</button>${body}</aside>`;
}
function _maFieldVal(c,d,f){
  const v=d[f];
  if(v===undefined||v===null||v==='')return '';
  if(f==='holder'||f==='from'||f==='to'||f==='account')return maAccLabel(c.idx,v);
  if(f==='amount'||f==='counted'||f==='bookBalance'||f==='difference')return maRs(v);
  if(f==='party')return _maPartyName(v);
  if(f==='tax')return v.kind==='none'?'No tax':(MA_TAX_LABELS[v.kind]||v.kind)+' '+v.rate+'% · '+maRs(v.amount);
  if(f==='commitmentId')return (_maCommit(v)||{name:v}).name;
  if(f==='lines')return (v||[]).length+' lines';
  if(f==='owner')return _maWho(v);
  if(Array.isArray(v))return v.join(', ');
  if(typeof v==='object')return JSON.stringify(v);
  return String(v);
}
function _maDocRailHTML(c,d){
  const F=[['date','Date'],['holder','Holder'],['from','From'],['to','To'],['account','For'],['party','Party'],['payee','Paid to / by'],['owner','Owner'],['amount','Amount'],['counted','Counted'],['bookBalance','Book said'],['difference','Difference'],['tax','Tax'],['costCentre','Cost centre'],['labelKind','Kind'],['channel','Channel'],['commitmentId','Commitment'],['commitmentPeriod','Period'],['po','PO'],['article','Article'],['note','Note']];
  const dl=F.map(([f,l])=>{const v=_maFieldVal(c,d,f);return v?`<dt>${_maE(l)}</dt><dd>${_maE(v)}</dd>`:'';}).join('');
  const posts=maPost(Object.assign({},d,{status:d.status==='void'||d.status==='pending'?'posted':d.status}),c.idx,c.s);
  const postT=posts.length?`<table class="ma-table ma-mini"><thead><tr><th>Account</th><th class="ma-num">Debit</th><th class="ma-num">Credit</th></tr></thead><tbody>${posts.map(l=>`<tr><td>${_maE(maAccLabel(c.idx,l.account))}</td><td class="ma-num">${l.dr?maRs(l.dr):''}</td><td class="ma-num">${l.cr?maRs(l.cr):''}</td></tr>`).join('')}</tbody></table>`:_maEmpty('Posts nothing.');
  // A flag the document now answers itself (the bill is attached since) is
  // shown as answered, not as a flag — it has left the review queue.
  const live=maLiveFlags(d),answered=maAnsweredFlags(d);
  const flags=live.length||answered.length?`<h4>Flags</h4><ul class="ma-flaglist">${live.map(x=>`<li><span class="ma-dot warn"></span>${_maE(x.message)}</li>`).join('')}${answered.map(x=>`<li class="ma-answered"><span class="ma-dot fine"></span><span>${_maE(x.message)} <span class="ma-muted">— answered: the document has it now</span></span></li>`).join('')}</ul>${d.reviewedAt?`<div class="ma-muted">Reviewed by ${_maE(_maWho(d.reviewedBy))} · ${_maWhen(d.reviewedAt)}</div>`:''}`:'';
  const hist=(d.edits||[]).slice().reverse().map(e=>`<li><b>${_maE(_maWho(e.by))}</b> · ${_maWhen(e.at)}<div>${_maE(e.reason||'')}</div>${(e.fields||[]).map(f=>`<div class="ma-muted">${_maE(f)}: ${_maE(_maFieldVal(c,e.before||{},f)||'—')} → ${_maE(_maFieldVal(c,e.after||{},f)||'—')}</div>`).join('')}</li>`).join('');
  const voided=d.status==='void'?`<div class="ma-note">Void — ${_maE(d.voidReason||'')} · ${_maE(_maWho(d.voidedBy))} · ${_maWhen(d.voidedAt)}</div>`:'';
  const locked=maQuarterLocked(d,{closes:maData.closes,settings:c.s});
  const pending=d.status==='pending'?`<div class="ma-note">Waiting for ${_maE(_maWho(d.confirmBy))} to confirm${d.confirmPaper?' — an owner confirms on paper with the signed receipt':''}. It counts in neither holder until then.${maConfirmWarning(d)?' Confirm it only once Raees has recorded it in Store Accounts.':''}${locked?' '+_maE(locked)+' is closed, so it cannot be confirmed until the quarter is reopened.':''}</div>`:'';
  const acts=[];
  if(d.status!=='void'){
    acts.push(`<button class="ma-btn" onclick="window.maEditDoc('${_maQ(d.dt)}','${_maQ(d.id)}')">Edit</button>`);
    if(d.status==='pending'&&!maConfirmPatch(d,session.u,{at:0},{closes:maData.closes,settings:c.s}).error)acts.push(`<button class="ma-btn primary" onclick="window.maConfirmDoc('${_maQ(d.id)}')">Confirm</button>`);
    if(live.length&&!d.reviewedAt&&!locked)acts.push(`<button class="ma-btn" onclick="window.maReviewDoc('${_maQ(d.dt)}','${_maQ(d.id)}')">Mark reviewed</button>`);
    acts.push(`<button class="ma-btn danger" onclick="window.maVoidDoc('${_maQ(d.dt)}','${_maQ(d.id)}')">Void</button>`);
  }
  return `<div class="ma-kicker">${_maE(MA_DOC_TYPES[d.dt].label)} · ${_maE(d.no)} · rev ${maRevOf(d)}</div>
    <h3 class="ma-rail-title">${_maE(maDocTitle(d,c.idx))}</h3>${_maStatusWord(d)}
    ${voided}${pending}
    <dl class="ma-dl">${dl}<dt>Recorded</dt><dd>${_maE(_maWho(d.by))} · ${_maWhen(d.ts)}</dd>${d.confirmedBy?`<dt>Confirmed</dt><dd>${_maE(_maWho(d.confirmedBy))} · ${_maWhen(d.confirmedAt)}${d.confirmVia==='paper'?' · on paper':''}</dd>`:''}</dl>
    ${flags}<h4>Bill or receipt</h4><div id="ma-rail-att">${_maRailAttInner(d)}</div><h4>Postings</h4>${postT}
    ${d.dt==='journal'&&(d.lines||[]).length?`<h4>Lines</h4><table class="ma-table ma-mini"><tbody>${d.lines.map(l=>`<tr><td>${_maE(maAccLabel(c.idx,l.account))}${l.memo?`<span class="ma-l2">${_maE(l.memo)}</span>`:''}</td><td class="ma-num">${d.kind==='opening'?(l.side==='cr'?'Cr ':'Dr ')+maRs(l.amount):(l.dr?'Dr '+maRs(l.dr):'Cr '+maRs(l.cr))}</td></tr>`).join('')}</tbody></table>`:''}
    <h4>History</h4>${hist?`<ul class="ma-hist">${hist}</ul>`:_maEmpty('Never edited.')}
    <div class="ma-rail-acts">${acts.join('')}${_maDocPdfButton(d)}</div>`;
}
function _maCommitRailHTML(c,x){
  const st=maCommitmentStatus(x,c.docs,c.today,c.s);
  const w=_MA_STATE_WORD[st.state]||_MA_STATE_WORD.none;
  const paid=c.docs.filter(d=>d.commitmentId===x.id&&d.status!=='void').sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const hist=(x.history||[]).slice().reverse().slice(0,10);
  return `<div class="ma-kicker">Commitment</div><h3 class="ma-rail-title">${_maE(x.name)}</h3><span class="ma-word ${w[0]}">${w[1]}</span>
    <dl class="ma-dl"><dt>Kind</dt><dd>${_maE(x.kind)}</dd><dt>Schedule</dt><dd>${_maE(maCommitmentText(x))}</dd><dt>Expected</dt><dd>${x.amountExpected?maRs(x.amountExpected):'varies'}</dd>
      <dt>Booked to</dt><dd>${_maE(maAccLabel(c.idx,x.account))}</dd>${x.holder?`<dt>Paid from</dt><dd>${_maE(maAccLabel(c.idx,x.holder))}</dd>`:''}${x.party?`<dt>Party</dt><dd>${_maE(_maPartyName(x.party))}</dd>`:''}
      <dt>Cost centre</dt><dd>${_maE(x.costCentre||c.s.defaultCostCentre)}</dd>${st.due?`<dt>This period</dt><dd>${_maE(st.period)} · due ${maDayLabel(st.due)} · paid ${maRs(st.amountPaid||0)}</dd>`:''}${st.next?`<dt>Next</dt><dd>${maDayLabel(st.next,true)}</dd>`:''}
      ${x.from?`<dt>From</dt><dd>${maDayLabel(x.from,true)}</dd>`:''}${x.to?`<dt>Until</dt><dd>${maDayLabel(x.to,true)}</dd>`:''}${x.note?`<dt>Note</dt><dd>${_maE(x.note)}</dd>`:''}</dl>
    <h4>Paid by</h4>${paid.length?`<ul class="ma-hist">${paid.slice(0,12).map(d=>`<li><button class="ma-doclink" onclick="window.maOpenDoc('${_maQ(d.dt)}','${_maQ(d.id)}')">${_maE(d.no)}</button> · ${maDayLabel(d.date)} · ${maRs(d.amount)} · ${_maE(d.commitmentPeriod||'')}</li>`).join('')}</ul>`:_maEmpty('Nothing recorded against it yet.')}
    ${hist.length?`<h4>Changes</h4><ul class="ma-hist">${hist.map(h=>`<li>${_maE(_maWho(h.by))} · ${_maWhen(h.at)}<div class="ma-muted">${_maE((h.fields||[]).join(', '))}</div></li>`).join('')}</ul>`:''}
    <div class="ma-rail-acts">${x.active!==false?`<button class="ma-btn primary" onclick="window.maPayCommitment('${_maQ(x.id)}','')">Record payment</button>`:''}<button class="ma-btn" onclick="window.maRecordKind('commitment',{id:'${_maQ(x.id)}'})">Edit</button><button class="ma-btn" onclick="window.maCommitToggle('${_maQ(x.id)}')">${x.active===false?'Switch on':'Switch off'}</button></div>`;
}

/* ═══ Close & audit ══════════════════════════════════════════════════════ */
let _maCloseTab='overview';
window.maCloseTabSet=function(k){_maCloseTab=['overview','audit','settings','chart','items'].indexOf(k)>=0?k:'overview';_maPaint();};
function _maQuarters(c){
  const fs=c.s.fiscalYearStart;const out=[];
  let q=maQuarterOf(c.s.historyFrom,fs);const last=maQuarterOf(c.today,fs);
  for(let i=0;i<40;i++){out.push(q);if(q===last)break;const r=maQuarterRange(q,fs);q=maQuarterOf(maDayAdd(r.to,1),fs);}
  return out.reverse();
}
function _maCloseOverviewHTML(c){
  const qs=_maQuarters(c).map(q=>{
    const cl=maData.closes.find(x=>x.quarter===q);
    const docs=c.docs.filter(d=>d.quarter===q&&d.status!=='void');
    const lastTs=docs.reduce((m,d)=>Math.max(m,d.ts||0),0);
    const st=cl&&cl.locked&&!cl.reopenedAt?'<span class="ma-word fine">locked</span>':cl&&cl.reopenedAt?'<span class="ma-word warn">reopened</span>':'<span class="ma-word mute">open</span>';
    const hist=docs.filter(d=>d.historical).length;
    return [_maE(maQuarterLabel(q,c.s.fiscalYearStart)),st,String(docs.length),hist?hist+' backfilled':'',lastTs?_maWhen(lastTs):'—'];
  });
  const b=_maErr('backups');
  const runs=maData.backups.slice().sort((x,y)=>(y.at||0)-(x.at||0));
  const backups=b?_maErrorCard([b]):runs.length?_maTable([{h:'When'},{h:'Result',l:'Result'},{h:'Detail',l:'Detail'}],runs.slice(0,10).map(r=>{
    const w=_MA_BACKUP_WORD[maBackupState(r)]||_MA_BACKUP_WORD.unknown;
    return [_maWhen(r.at),`<span class="ma-word ${w[0]}">${w[1]}</span>`,_maE(_maBackupDetail(r))];
  })):_maEmpty('No nightly backup has been recorded yet. The nightly run writes its own row here after 03:30 UTC (08:30 PKT); it needs MA_BACKUP_BUCKET set in Netlify and that bucket in Cloud Storage (M1 checklist).');
  return _maSec('Quarters','the quarter lock arrives with M11','',_maTable([{h:'Quarter'},{h:'State',l:'State'},{h:'Documents',cls:'ma-num',l:'Documents'},{h:'History',l:'History'},{h:'Last entered',l:'Last'}],qs))
    +_maSec('Backups',runs.length?'last '+_maWhen(runs[0].at):'','',backups)
    +_maSec('Your own copy','','',`<p class="ma-hint ma-block">Everything Master Accounts holds, to this computer: a JSON file of every collection — the copy a restore reads — and an Excel workbook with the postings, the trial balance and every collection as a sheet. A collection that cannot be read is named in both files, never left out quietly. The download is recorded in the audit trail.</p>
      <button class="ma-btn" id="ma-books-btn" onclick="window.maDownloadBooks()">Download the books</button><div class="ma-att-st" id="ma-books-st" role="status"></div>`);
}
/* A backup row, read by its state (maBackupState): a run still going is
   never "done", and a run that was not set up says what is missing. */
const _MA_BACKUP_WORD={done:['fine','done'],failed:['urgent','failed'],not_configured:['warn','not set up'],starting:['mute','starting'],running:['mute','running'],unknown:['mute','no result']};
function _maBackupDetail(r){
  const st=maBackupState(r);
  if(st==='done')return [(r.collections?r.collections+' collections':''),(r.size?r.size:''),(Number.isFinite(r.documents)?maGroup(r.documents)+' documents':'')].filter(Boolean).join(' · ');
  if(st==='failed')return String(r.error||'no reason given');
  if(st==='not_configured'){const m=(Array.isArray(r.missing)?r.missing:[]).filter(x=>typeof x==='string'&&x);return maBackupMissing(r)+(m.length?' · missing: '+m.join(', '):'');}
  if(st==='starting'||st==='running')return 'started '+_maWhen(r.at)+(r.operationState?' · '+r.operationState:'')+(r.lastCheckError?' · '+r.lastCheckError:'');
  return 'no result recorded';
}
function _maAuditHTML(){
  const e=_maErr('audit');
  if(e)return _maErrorCard([e]);
  const rows=maData.audit.slice().sort((a,b)=>(b.at||0)-(a.at||0));
  if(!rows.length)return _maEmpty('Nothing recorded yet.');
  // WHO is derived from `by` — the one field the rules bind to the signed-in
  // person — never the stored byName, which any owner could write as anyone.
  return `<div class="ma-scope">${rows.length} most recent</div>`+_maTable([{h:'When',cls:'ma-nw'},{h:'Who',l:'Who'},{h:'Action',l:'Action'},{h:'Document',l:'Document'},{h:'Detail'}],
    rows.map(r=>[_maWhen(r.at),_maE(_maWho(r.by)),_maE(r.action),_maE(r.target&&(r.target.no||r.target.id)||''),_maE(r.detail||'')]));
}
function _maNumIn(id,v,label,o){o=o||{};return `<label class="ma-field${o.small?' sm':''}"><span class="ma-lbl">${_maE(label)}</span><input class="ma-in" id="${id}" inputmode="numeric" value="${_maE(v===null||v===undefined?'':v)}">${o.hint?`<span class="ma-hint">${_maE(o.hint)}</span>`:''}</label>`;}
function _maDaysPick(prefix,cur){
  return `<div class="ma-days">${MA_WEEKDAYS.map((w,i)=>`<label class="ma-chk"><input type="checkbox" id="${prefix}${i}"${(cur||[]).indexOf(i)>=0?' checked':''}> ${w}</label>`).join('')}</div>`;
}
function _maSettingsHTML(c){
  const s=c.s;
  const hs=maMoneyAccounts(c.idx,{all:true});
  const holders=_maTable([{h:'Holder'},{h:'On',l:'On'},{h:'Floor',cls:'ma-num',l:'Floor'},{h:'Note',l:''}],hs.map(a=>[
    `<input class="ma-in" id="ma-s-name-${a.code}" value="${_maE(a.name)}" aria-label="Name of ${_maE(a.code)}"><span class="ma-l2">${_maE(a.code)}</span>`,
    `<label class="ma-chk"><input type="checkbox" id="ma-s-on-${a.code}"${a.active?' checked':''}> on</label>`,
    `<input class="ma-in ma-in-num" id="ma-s-floor-${a.code}" inputmode="numeric" value="${_maE(s.holderFloor[a.code]||'')}" aria-label="Floor of ${_maE(a.code)}">`,
    s.mirrors&&s.mirrors[a.code]?'<span class="ma-muted">Store Accounts until M8</span>':a.arrives?'<span class="ma-muted">feed arrives with '+_maE(a.arrives)+'</span>':'']));
  return `<div class="ma-form-card">
    ${_maSec('Holders','a holder cannot go below its floor','',holders)}
    ${_maSec('Days','','',`<div class="ma-lbl">Pay days</div>${_maDaysPick('ma-s-pay-',s.payDays)}<div class="ma-lbl">CPR days</div>${_maDaysPick('ma-s-cpr-',s.cprDays)}`)}
    ${_maSec('Cost centres','','',`<label class="ma-field"><span class="ma-lbl">Cost centres, comma between</span><input class="ma-in" id="ma-s-cc" value="${_maE(s.costCentres.join(', '))}"></label>
      <label class="ma-field"><span class="ma-lbl">Default</span>${_maSelect('ma-s-ccdef',s.costCentres.map(x=>[x,x]),s.defaultCostCentre,'','Default cost centre')}</label>`)}
    ${_maSec('Evidence and checks','','',`<div class="ma-grid2">
      ${_maNumIn('ma-s-flagabove',s.evidence.flagAbove,'Flag no bill at or above ₨')}
      ${_maNumIn('ma-s-refuseabove',s.evidence.refuseAbove||'','Refuse no bill at or above ₨',{hint:'empty = never refuse'})}
      ${_maNumIn('ma-s-relock',s.relockMinutes,'Re-lock after idle, minutes')}
      ${_maNumIn('ma-s-dup',s.duplicateDays,'Duplicate window, days')}
      ${_maNumIn('ma-s-countevery',s.countEveryDays,'Count cash every, days')}
      ${_maNumIn('ma-s-grace',s.commitmentGraceDays,'Commitment grace, days')}
      ${_maNumIn('ma-s-pendwatch',s.pendingWatchDays,'Waiting confirmation watch, days')}</div>`)}
    ${_maSec('Attachments and share links','','',`<div id="ma-att-mode">${_maAttachModeHTML()}</div>
      <div class="ma-grid2">${_maNumIn('ma-s-sharedays',s.share.defaultDays,'A share link works for, days',{hint:'1 to 90; each link can say otherwise'})}</div>`)}
    <div class="ma-err" id="ma-s-err"></div>
    <div class="ma-form-acts"><button class="ma-btn primary" onclick="window.maSaveSettings()">Save settings</button></div></div>`;
}
function _maChartHTML(c){
  const rows=c.idx.list.map(a=>[
    `<span class="ma-nw">${_maE(a.code)}</span>`,
    `<input class="ma-in" id="ma-a-name-${a.code}" value="${_maE(a.name)}" aria-label="Name of ${_maE(a.code)}">`,
    _maE(a.type)+(a.spend?`<span class="ma-l2">${_maE(MA_SPEND_GROUPS[a.spend].label)}</span>`:''),
    `<label class="ma-chk"><input type="checkbox" id="ma-a-on-${a.code}"${a.active?' checked':''}> on</label>`,
    `<button class="ma-btn sm" onclick="window.maSaveAccount('${_maQ(a.code)}')">Save</button>`]);
  const types=MA_ACCOUNT_TYPES.filter(t=>t!=='suspense').map(t=>[t,t]);
  const spends=[['','—']].concat(Object.keys(MA_SPEND_GROUPS).map(k=>[k,MA_SPEND_GROUPS[k].label]));
  return _maSec('Groovy’s chart','codes are never reused; an account is switched off, never deleted','',_maTable([{h:'Code'},{h:'Name'},{h:'Type',l:'Type'},{h:'On',l:'On'},{h:'',cls:'ma-nw'}],rows))
    +_maSec('New account','','',`<div class="ma-form-card"><div class="ma-grid2">
      <label class="ma-field"><span class="ma-lbl">Code</span><input class="ma-in" id="ma-na-code" inputmode="numeric" placeholder="6160"></label>
      <label class="ma-field"><span class="ma-lbl">Name</span><input class="ma-in" id="ma-na-name"></label>
      <label class="ma-field"><span class="ma-lbl">Type</span>${_maSelect('ma-na-type',types,'expense','','Type')}</label>
      <label class="ma-field"><span class="ma-lbl">Spend group</span>${_maSelect('ma-na-spend',spends,'running','','Spend group')}</label></div>
      <div class="ma-err" id="ma-na-err"></div><div class="ma-form-acts"><button class="ma-btn primary" onclick="window.maNewAccount()">Add account</button></div></div>`);
}
function _maItemsHTML(c){
  const e=_maErr('items');
  if(e)return _maErrorCard([e]);
  const rows=maData.items.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(it=>[_maE(it.name),_maE(String(it.kind||'').replace(/_/g,' ')),_maE(it.unit||''),_maE(it.account?maAccLabel(c.idx,it.account):'')]);
  const accs=[['','—']].concat(c.idx.list.filter(a=>!a.money&&a.active).map(a=>[a.code,a.code+' · '+a.name]));
  return _maSec('Items and services',maData.items.length+'','',rows.length?_maTable([{h:'Item'},{h:'Kind',l:'Kind'},{h:'Unit',l:'Unit'},{h:'Booked to',l:'Account'}],rows):_maEmpty('No items yet.'))
    +_maSec('New item','','',`<div class="ma-form-card"><div class="ma-grid2">
      <label class="ma-field"><span class="ma-lbl">Name</span><input class="ma-in" id="ma-ni-name"></label>
      <label class="ma-field"><span class="ma-lbl">Kind</span>${_maSelect('ma-ni-kind',MA_ITEM_KINDS.map(k=>[k,k.replace(/_/g,' ')]),'other','','Kind')}</label>
      <label class="ma-field"><span class="ma-lbl">Unit</span><input class="ma-in" id="ma-ni-unit" placeholder="piece, kg, metre, month"></label>
      <label class="ma-field"><span class="ma-lbl">Booked to</span>${_maSelect('ma-ni-account',accs,'','','Account')}</label></div>
      <div class="ma-err" id="ma-ni-err"></div><div class="ma-form-acts"><button class="ma-btn primary" onclick="window.maNewItem()">Add item</button></div></div>`);
}
function _maCloseHTML(){
  const c=_maCtx();
  const tabs=_maTabs(_maCloseTab,[['overview','Periods & backups'],['audit','Audit trail'],['settings','Settings'],['chart','Chart of accounts'],['items','Items']],'maCloseTabSet');
  let body;
  if(_maCloseTab==='audit')body=_maAuditHTML();
  else if(_maCloseTab==='settings'){
    body=_maSettingsHTML(c);
    // Which attachment mode is in force is the server's answer, asked once a
    // session — after the paint, so the page is never held on the network.
    if(!_maAttachSt&&!_maAttachStP)setTimeout(()=>{_maAttachStatusLoad();},0);
  }
  else if(_maCloseTab==='chart')body=_maChartHTML(c);
  else if(_maCloseTab==='items')body=_maItemsHTML(c);
  else body=_maCloseOverviewHTML(c);
  return _maHead('Close & audit','Fiscal year from '+MA_MONTHS_LONG[c.s.fiscalYearStart-1]+' · live from '+maDayLabel(c.s.goLive,true),{excel:_maCloseTab==='audit'?'audit':''})+tabs+body;
}
function _maChecked(id,def){const e=document.getElementById(id);return e&&typeof e.checked==='boolean'?e.checked:def;}
function _maVal(id){const e=document.getElementById(id);return e&&e.value!==undefined&&e.value!==null?String(e.value):'';}
window.maSaveSettings=async function(){
  if(_maBusy||_maNeedsNet())return;
  const c=_maCtx();const s=c.s;
  const err=document.getElementById('ma-s-err');const say=m=>{if(err)err.textContent=m;};
  const dot=(raw,label)=>{const h=maRupeesDotted(String(raw).trim());if(h)throw new Error(label+' “'+String(raw).trim()+'” — did you mean '+h+'? Rupees take a comma, or none.');};
  const int=(id,min,max,label,allowEmpty)=>{dot(_maVal(id),label);const v=_maVal(id).replace(/[₨,\s]/g,'');if(v===''&&allowEmpty)return 0;const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw new Error(label+' is a whole number from '+min+' to '+max+'.');return n;};
  let next,accWrites=[];
  try{
    const floors={};
    const hs=maMoneyAccounts(c.idx,{all:true});
    hs.forEach(a=>{
      dot(_maVal('ma-s-floor-'+a.code),'The floor of '+a.name);
      const v=_maVal('ma-s-floor-'+a.code).replace(/[₨,\s]/g,'');
      if(v!==''){const n=Number(v);if(!Number.isInteger(n))throw new Error('A floor is whole rupees ('+a.name+').');if(n)floors[a.code]=n;}
      const on=_maChecked('ma-s-on-'+a.code,a.active);const name=_maVal('ma-s-name-'+a.code).trim()||a.name;
      if(on!==a.active||name!==a.name)accWrites.push({col:'ma_accounts',id:a.code,data:Object.assign({},(maData.accounts.find(x=>String(x.code)===a.code)||{}),{code:a.code,name,active:on,updatedAt:Date.now(),updatedBy:session.u})});
    });
    const days=p=>MA_WEEKDAYS.map((w,i)=>_maChecked(p+i,false)?i:-1).filter(i=>i>=0);
    const pay=days('ma-s-pay-'),cpr=days('ma-s-cpr-');
    const cc=_maVal('ma-s-cc').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
    if(cc.some(x=>!/^[a-z][a-z0-9_]{1,23}$/.test(x)))throw new Error('A cost centre is lower-case letters, digits or _ (2 to 24).');
    next=Object.assign({},_maClean(c.stored||{}),{
      payDays:pay.length?pay:s.payDays,cprDays:cpr.length?cpr:s.cprDays,holderFloor:floors,
      costCentres:cc.length?cc:s.costCentres,defaultCostCentre:_maVal('ma-s-ccdef')||s.defaultCostCentre,
      evidence:{flagAbove:int('ma-s-flagabove',0,1e9,'Flag above'),refuseAbove:int('ma-s-refuseabove',0,1e9,'Refuse above',true)},
      relockMinutes:int('ma-s-relock',1,240,'Re-lock'),duplicateDays:int('ma-s-dup',0,60,'Duplicate window'),
      countEveryDays:int('ma-s-countevery',1,366,'Count every'),commitmentGraceDays:int('ma-s-grace',0,60,'Grace'),
      pendingWatchDays:int('ma-s-pendwatch',0,60,'Waiting watch'),
      share:{defaultDays:int('ma-s-sharedays',1,90,'Share link days')},
      updatedAt:Date.now(),updatedBy:session.u});
    delete next.id;
    if(next.costCentres.indexOf(next.defaultCostCentre)<0)next.defaultCostCentre=next.costCentres[0];
  }catch(e){say(e.message);return;}
  _maBusy=true;
  try{
    await _maWriteMasters([{col:'ma_settings',id:'main',data:next}].concat(accWrites),'settings',{dt:'settings',id:'main',no:'settings'},'Settings saved'+(accWrites.length?' · '+accWrites.length+' holder'+(accWrites.length>1?'s':''):''));
    const i=maData.settings.findIndex(x=>x.id==='main');const sd=Object.assign({id:'main'},next);if(i>=0)maData.settings[i]=sd;else maData.settings.push(sd);
    accWrites.forEach(w=>{const j=maData.accounts.findIndex(x=>String(x.code)===w.id);const d=Object.assign({id:w.id},w.data);if(j>=0)maData.accounts[j]=d;else maData.accounts.push(d);});
    // Anything recorded with no cost centre of its own posts to the default
    // (maPost), so a default that moves — chosen, or because it was taken
    // off the list — moves those postings, and is said (money F1).
    const cc=next.defaultCostCentre!==s.defaultCostCentre;
    _maInvalidate();_maToast('Settings saved.'+(cc?' The default cost centre is now '+next.defaultCostCentre+(next.costCentres.indexOf(s.defaultCostCentre)<0?' ('+s.defaultCostCentre+' is no longer on the list)':'')+' — anything recorded without a cost centre of its own now posts there.':''));_maPaint();
  }catch(e){
    // Left the page while it saved: the line under the form is gone.
    if(_maPage==='ma-close'&&_maCloseTab==='settings')say(_maWriteError(e));else _maToast('Not saved: Settings — '+_maWriteError(e));
  }finally{_maBusy=false;}
};
window.maSaveAccount=async function(code){
  if(_maBusy||_maNeedsNet())return;
  const c=_maCtx();const a=maAcc(c.idx,code);if(!a)return;
  const name=_maVal('ma-a-name-'+code).trim();const on=_maChecked('ma-a-on-'+code,a.active);
  if(name.length<2){_maToast('Give the account a name.');return;}
  if(a.money&&!on&&c.holders.some(h=>h.code===code&&h.balance))if(!confirm(a.name+' still holds money. Switch it off anyway?'))return;
  const data=Object.assign({},maData.accounts.find(x=>String(x.code)===code)||{},{code,name,active:on,updatedAt:Date.now(),updatedBy:session.u});delete data.id;
  _maBusy=true;
  try{
    await _maWriteMasters([{col:'ma_accounts',id:code,data}],'chart',{dt:'account',id:code,no:code},code+' · '+name+(on?'':' · off'));
    const j=maData.accounts.findIndex(x=>String(x.code)===code);const d=Object.assign({id:code},data);if(j>=0)maData.accounts[j]=d;else maData.accounts.push(d);
    _maInvalidate();_maToast(code+' saved.');_maPaint();
  }catch(e){_maToast(_maWriteError(e));}finally{_maBusy=false;}
};
window.maNewAccount=async function(){
  if(_maBusy||_maNeedsNet())return;
  const c=_maCtx();const err=document.getElementById('ma-na-err');
  const code=_maVal('ma-na-code').trim(),name=_maVal('ma-na-name').trim(),type=_maVal('ma-na-type')||'expense',spend=_maVal('ma-na-spend');
  const say=m=>{if(err)err.textContent=m;};
  if(!maCodeOk(code,'groovy'))return say('A code is four digits, not starting with 0.');
  if(maAcc(c.idx,code))return say(code+' is taken — codes are never reused.');
  if(name.length<2)return say('Give it a name.');
  if(MA_ACCOUNT_TYPES.indexOf(type)<0)return say('Pick a type.');
  const data={code,name,type,active:true,createdAt:Date.now(),createdBy:session.u};
  if((type==='expense'||type==='cogs')&&MA_SPEND_GROUPS[spend])data.spend=spend;
  _maBusy=true;
  try{
    await _maWriteMasters([{col:'ma_accounts',id:code,data}],'chart',{dt:'account',id:code,no:code},'New account '+code+' · '+name);
    maData.accounts.push(Object.assign({id:code},data));_maInvalidate();_maToast(code+' added.');_maPaint();
  }catch(e){say(_maWriteError(e));}finally{_maBusy=false;}
};
window.maNewItem=async function(){
  if(_maBusy||_maNeedsNet())return;
  const c=_maCtx();const err=document.getElementById('ma-ni-err');
  const it={id:_maId('i_'),name:_maVal('ma-ni-name').trim(),kind:_maVal('ma-ni-kind')||'other',unit:_maVal('ma-ni-unit').trim(),account:_maVal('ma-ni-account')||null,active:true};
  const iss=maItemIssues(it,{idx:c.idx,items:maData.items}).filter(x=>x.level==='refuse');
  if(iss.length){if(err)err.textContent=iss[0].message;return;}
  it.createdAt=Date.now();it.createdBy=session.u;
  _maBusy=true;
  try{
    await _maWriteMasters([{col:'ma_items',id:it.id,data:it}],'item',{dt:'item',id:it.id,no:it.name},'New item '+it.name);
    maData.items.push(it);_maToast(it.name+' added.');_maPaint();
  }catch(e){if(err)err.textContent=_maWriteError(e);}finally{_maBusy=false;}
};

/* ═══ The modal, the Record picker and the forms (§16.1) ════════════════ */
function _maModal(title,body,foot,wide){
  // A form or a panel shows the books' figures: none opens while the lock
  // is due (security F5) — the lock is shown instead.
  if(!_maMayPaint()){_maF=null;_maShare=null;return;}
  const old=document.getElementById('ma-modal-back');
  if(old&&old.remove)old.remove();
  const back=document.createElement('div');
  back.id='ma-modal-back';back.className='ma-modal-back';
  back.innerHTML=`<div class="ma-modal${wide?' wide':''}" role="dialog" aria-modal="true" aria-labelledby="ma-modal-title">
    <div class="ma-modal-head"><h2 id="ma-modal-title">${_maE(title)}</h2><button class="ma-x" aria-label="Close" onclick="window.maCloseModal()">×</button></div>
    <div class="ma-modal-body" id="ma-modal-body" oninput="window.maFormDirty()">${body}</div>
    ${foot?`<div class="ma-modal-foot">${foot}</div>`:''}</div>`;
  back.onclick=e=>{if(e&&e.target===back)window.maCloseModal();};
  document.body.appendChild(back);
}
window.maCloseModal=function(){const b=document.getElementById('ma-modal-back');if(b&&b.remove)b.remove();_maF=null;_maShare=null;};
if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('keydown',e=>{if(e&&e.key==='Escape'){const b=document.getElementById('ma-modal-back');if(b&&b.parentNode)window.maCloseModal();}});

const _MA_TILES=[
  {k:'money_out',t:'Money out',s:'Paid from a holder'},
  {k:'money_in',t:'Money in',s:'Arrived in a holder'},
  {k:'transfer',t:'Transfer',s:'Between two holders'},
  {k:'count',t:'Count',s:'Cash counted in a holder'},
  {k:'capital',t:'Owner put money in',s:'Capital'},
  {k:'drawing',t:'Owner took money out',s:'Drawings'},
  {k:'opening',t:'Opening balance',s:'Where the books start'},
  {k:'general',t:'Journal',s:'Two-sided, balanced'},
  {k:'commitment',t:'Commitment',s:'Rent, a utility, a subscription'},
  {k:'collection',t:'Collection',coming:'M2'},
  {k:'bill',t:'Bill',coming:'M3'},
  {k:'payment',t:'Payment',coming:'M3'},
  {k:'po',t:'Purchase order',coming:'M3'},
  {k:'receipt',t:'Receipt',coming:'M3'},
  {k:'payout',t:'Payout',coming:'M4'},
  {k:'loan',t:'Loan',coming:'M4'},
  {k:'savings',t:'Savings entry',coming:'M4'}
];
const _MA_KIND_DT={money_out:'journal',money_in:'journal',capital:'journal',drawing:'journal',opening:'journal',general:'journal',transfer:'transfer',count:'count'};
let _maF=null;
let _maPre={};
function _maPagePrefill(){
  const c=_maCtx();
  if(_maPage==='ma-party'&&_maPartyId)return {party:_maPartyId};
  if(_maPage==='ma-holder'&&_maHolderCode)return c.s.mirrors&&c.s.mirrors[_maHolderCode]?{from:_maHolderCode}:{holder:_maHolderCode,from:_maHolderCode};
  return {};
}
function _maPickerHTML(){
  const live=_MA_TILES.filter(t=>!t.coming),soon=_MA_TILES.filter(t=>t.coming);
  return `<div class="ma-tiles">${live.map(t=>`<button class="ma-tile" onclick="window.maRecordKind('${t.k}')"><b>${_maE(t.t)}</b><span>${_maE(t.s)}</span></button>`).join('')}</div>
    <div class="ma-lbl ma-tiles-h">Coming</div>
    <div class="ma-tiles">${soon.map(t=>`<div class="ma-tile off" aria-disabled="true"><b>${_maE(t.t)}</b><span>arrives with ${_maE(t.coming)}</span></div>`).join('')}</div>`;
}
window.maRecord=function(pre){
  if(!maCanSee()||!maLoaded||_maCoreErrs().length){_maToast('Master Accounts has not loaded — nothing can be recorded yet.');return;}
  _maPre=Object.assign({},_maPagePrefill(),pre||{});
  _maF=null;
  _maModal('Record',_maPickerHTML(),'',true);
};
window.maRecordKind=function(kind,pre){
  if(!maCanSee()||!maLoaded||_maCoreErrs().length){_maToast('Master Accounts has not loaded — nothing can be recorded yet.');return;}
  const p=Object.assign({},_maPagePrefill(),_maPre||{},pre||{});_maPre={};
  if(kind==='commitment')return _maCommitForm(p.id?_maCommit(p.id):null,p);
  if(!_MA_KIND_DT[kind]){_maToast('That arrives with a later milestone.');return;}
  _maOpenDocForm(kind,p,null);
};

/* ── Form pieces ─────────────────────────────────────────────────────── */
function _maFld(name,label,control,hint){
  return `<label class="ma-field" id="ma-w-${name}"><span class="ma-lbl">${_maE(label)}</span>${control}${hint?`<span class="ma-hint">${hint}</span>`:''}<span class="ma-ferr" id="ma-e-${name}"></span></label>`;
}
function _maIn(name,val,o){o=o||{};return `<input class="ma-in${o.num?' ma-in-num':''}" id="ma-f-${name}"${o.type?` type="${o.type}"`:''}${o.num?' inputmode="numeric"':''}${o.ph?` placeholder="${_maE(o.ph)}"`:''}${o.min?` min="${o.min}"`:''}${o.max?` max="${o.max}"`:''}${o.dis?' disabled':''}${o.on?` oninput="${o.on}"`:''} value="${_maE(val===undefined||val===null?'':val)}">`;}
function _maSel(name,opts,cur,o){o=o||{};return `<select class="ma-in" id="ma-f-${name}"${o.dis?' disabled':''}${o.on?` onchange="${o.on}"`:''}>${opts}</select>`;}
function _maOpt(v,l,cur){return `<option value="${_maE(v)}"${String(v)===String(cur===undefined||cur===null?'':cur)?' selected':''}>${_maE(l)}</option>`;}
/* A select never hands back a value the owner did not choose (money F1).
   `cur` is the stored value: it is the one preselected, and when it is no
   longer on the list it is still offered — under a name that says so — so
   an untouched select saves exactly what was stored. Without that the
   browser selects the FIRST option, and a note edit rewrites the field. */
function _maOptsKeep(list,cur,o){
  o=o||{};
  const vals=list.map(x=>Array.isArray(x)?x:[x,x]);
  const has=cur!==undefined&&cur!==null&&String(cur)!=='';
  return (o.blank!==undefined?_maOpt('',o.blank,has?cur:''):'')+vals.map(x=>_maOpt(x[0],x[1],cur)).join('')
    +(has&&!vals.some(x=>String(x[0])===String(cur))?_maOpt(cur,o.gone?o.gone(cur):cur+' — no longer in Settings',cur):'');
}
/* The cost-centre options. A blank cost centre posts to Settings' default,
   whatever it is on the day (maPost), so the blank option says so. */
function _maCcOpts(s,cur){return _maOptsKeep(s.costCentres,cur,{blank:'Settings’ default (now '+s.defaultCostCentre+')'});}
function _maHolderOpts(c,cur,o){
  o=o||{};
  const hs=maMoneyAccounts(c.idx).filter(a=>o.mirror||!(c.s.mirrors&&c.s.mirrors[a.code]));
  const a=cur&&!hs.some(h=>h.code===cur)?maAcc(c.idx,cur):null;
  return (o.blank?_maOpt('',o.blank,cur):_maOpt('','Choose…',cur))+hs.map(h=>_maOpt(h.code,h.name,cur)).join('')
    +(cur&&!hs.some(h=>h.code===cur)?_maOpt(cur,a?a.name+(a.active?'':' — switched off'):cur+' — not in the chart',cur):'');
}
const _MA_GROUP_ORDER={money_out:['expense','cogs','asset','liability','equity','revenue','suspense'],money_in:['revenue','liability','asset','equity','expense','cogs','suspense'],any:['asset','liability','equity','revenue','cogs','expense','suspense']};
const _MA_TYPE_LABEL={asset:'Assets',liability:'Liabilities',equity:'Equity',revenue:'Income',cogs:'Cost of goods',expense:'Expenses',suspense:'Not sure yet'};
function _maAccountOpts(c,kind,cur,o){
  o=o||{};
  const order=_MA_GROUP_ORDER[kind]||_MA_GROUP_ORDER.any;
  const list=c.idx.list.filter(a=>(o.money||!a.money)&&(a.active||a.code===cur));
  const gone=cur&&!list.some(a=>a.code===cur)?maAcc(c.idx,cur):null;
  return _maOpt('','Choose…',cur)+order.map(t=>{
    const g=list.filter(a=>a.type===t);
    return g.length?`<optgroup label="${_MA_TYPE_LABEL[t]}">${g.map(a=>_maOpt(a.code,a.code+' · '+a.name,cur)).join('')}</optgroup>`:'';
  }).join('')+(cur&&!list.some(a=>a.code===cur)?_maOpt(cur,gone?gone.code+' · '+gone.name:cur+' — not in the chart',cur):'');
}
function _maPartyOpts(cur,o){
  o=o||{};
  const ps=maData.parties.filter(p=>p.active!==false||p.id===cur).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const gone=cur&&cur!=='__new'&&!ps.some(p=>p.id===cur);
  return _maOpt('',o.blank||'— none, name them below —',cur)+ps.map(p=>_maOpt(p.id,p.name+' · '+(MA_PARTY_KIND_LABELS[p.kind]||p.kind),cur)).join('')
    +(gone?_maOpt(cur,'A party that is not loaded ('+cur+')',cur):'')+(o.noNew?'':_maOpt('__new','+ New party…',cur));
}
/* The tax a party usually carries (§12): the form starts on it, and says
   where it came from until the owner picks a treatment themselves. A sales
   or services tax comes without a rate — the party master holds none — so
   the owner confirms it by giving one. null for a party with no tax on
   record (a customer, a one-off): the form then starts on No tax, and says
   that was not chosen. */
function _maPartyTax(id){
  const p=id&&id!=='__new'?_maParty(id):null;
  const t=p&&p.vendor&&p.vendor.tax;
  if(!t)return null;
  if(t.regime==='sales'||t.regime==='services')return {tax:{kind:t.regime,rate:'',inclusive:true,claimable:false},from:p.name+'’s usual tax is '+MA_TAX_LABELS[t.regime].toLowerCase()+' — confirm it by giving the rate, or change it.'};
  if(Number.isFinite(t.withholdingPct)&&t.withholdingPct>0)return {tax:{kind:'withholding',rate:t.withholdingPct,inclusive:true,claimable:false},from:p.name+'’s usual withholding is '+t.withholdingPct+'% — confirm it, or change it.'};
  return {tax:{kind:'none',rate:0,inclusive:true,claimable:false},from:p.name+' is usually not taxed — confirm it, or change it.'};
}
const _MA_TAX_PRESET='No tax is pre-set, not chosen — pick the treatment if this one is taxed.';
function _maTaxHTML(t,from){
  t=t||maTaxBlank();
  return `<div class="ma-field" id="ma-w-tax"><span class="ma-lbl">Tax</span>
    <input type="hidden" id="ma-f-taxkind" value="${_maE(t.kind||'none')}">
    <div class="ma-chips" role="radiogroup" aria-label="Tax">${MA_TAX_KINDS.map(k=>`<button type="button" role="radio" aria-checked="${(t.kind||'none')===k}" class="ma-chip${(t.kind||'none')===k?' on':''}" id="ma-tax-${k}" onclick="window.maTaxKind('${k}')">${_maE(MA_TAX_LABELS[k])}</button>`).join('')}</div>
    <div class="ma-taxmore" id="ma-f-taxmore"${(t.kind||'none')==='none'?' hidden':''}>
      <label class="ma-field sm"><span class="ma-lbl">Rate %</span><input class="ma-in ma-in-num" id="ma-f-taxrate" inputmode="decimal" value="${_maE(t.rate||'')}" oninput="window.maTaxCalc()"></label>
      <label class="ma-chk"><input type="checkbox" id="ma-f-taxincl"${t.inclusive!==false?' checked':''} onchange="window.maTaxCalc()"> included in the amount</label>
      <label class="ma-chk"><input type="checkbox" id="ma-f-taxclaim"${t.claimable?' checked':''} onchange="window.maTaxCalc()"> claimable</label>
    </div>
    <span class="ma-hint" id="ma-f-taxcalc">${(t.kind||'none')==='none'?'No tax on this.':''}</span><span class="ma-hint" id="ma-f-taxfrom">${_maE(from||'')}</span><span class="ma-ferr" id="ma-e-tax"></span></div>`;
}
/* `auto`: the form set it (a party's usual, or the No tax preset), not the
   owner — a party picked later may still move it. */
function _maTaxSet(k,rate,from,auto){
  const h=document.getElementById('ma-f-taxkind');if(h)h.value=k;
  MA_TAX_KINDS.forEach(x=>{const b=document.getElementById('ma-tax-'+x);if(b&&b.classList){b.classList.toggle('on',x===k);if(b.setAttribute)b.setAttribute('aria-checked',String(x===k));}});
  const more=document.getElementById('ma-f-taxmore');if(more)more.hidden=k==='none';
  if(rate!==undefined){const r=document.getElementById('ma-f-taxrate');if(r)r.value=rate;}
  const fr=document.getElementById('ma-f-taxfrom');if(fr)fr.textContent=from||'';
  if(_maF)_maF.taxAuto=!!auto;
  window.maTaxCalc();
}
window.maTaxKind=function(k){
  if(_maF)_maF.taxAuto=false;
  const fr=document.getElementById('ma-f-taxfrom');if(fr)fr.textContent='';
  const h=document.getElementById('ma-f-taxkind');if(h)h.value=k;
  MA_TAX_KINDS.forEach(x=>{const b=document.getElementById('ma-tax-'+x);if(b&&b.classList){b.classList.toggle('on',x===k);if(b.setAttribute)b.setAttribute('aria-checked',String(x===k));}});
  const more=document.getElementById('ma-f-taxmore');if(more)more.hidden=k==='none';
  window.maTaxCalc();window.maFormDirty();
};
window.maTaxCalc=function(){
  const out=document.getElementById('ma-f-taxcalc');if(!out)return;
  const k=_maVal('ma-f-taxkind')||'none';
  if(k==='none'){out.textContent='No tax on this.';return;}
  const a=_maNum(_maVal('ma-f-amount'));const rate=Number(_maVal('ma-f-taxrate'))||0;
  if(!Number.isFinite(a)||!rate){out.textContent='Give the amount and the rate.';return;}
  const t=maTaxCompute(Math.round(a),{kind:k,rate,inclusive:_maChecked('ma-f-taxincl',true),claimable:_maChecked('ma-f-taxclaim',false)});
  out.textContent='Tax '+maRs(t.amount)+' · '+maRs(t.cash)+' moves through the holder';
};
const _MA_MIRROR_LINE='The store drawer is left out: it is Raees’s book in Store Accounts until M8. A handover to or from it is a Transfer.';
function _maLinesHTML(c){
  const k=_maF.kind;
  return _maF.lines.map((l,i)=>`<div class="ma-line-row">
    <select class="ma-in" id="ma-l-acc-${i}" aria-label="Line ${i+1} account" onchange="window.maLineSet(${i},'account',this.value)">${_maAccountOpts(c,'any',l.account,{money:true})}</select>
    ${k==='opening'?`<select class="ma-in ma-in-side" aria-label="Line ${i+1} side" onchange="window.maLineSet(${i},'side',this.value)">${_maOpt('dr','Debit',l.side)}${_maOpt('cr','Credit',l.side)}</select><input class="ma-in ma-in-num" aria-label="Line ${i+1} amount" inputmode="numeric" placeholder="Amount" value="${_maE(l.amount||'')}" oninput="window.maLineSet(${i},'amount',this.value)">`
      :`<input class="ma-in ma-in-num" aria-label="Line ${i+1} debit" inputmode="numeric" placeholder="Debit" value="${_maE(l.dr||'')}" oninput="window.maLineSet(${i},'dr',this.value)"><input class="ma-in ma-in-num" aria-label="Line ${i+1} credit" inputmode="numeric" placeholder="Credit" value="${_maE(l.cr||'')}" oninput="window.maLineSet(${i},'cr',this.value)">`}
    <select class="ma-in" aria-label="Line ${i+1} party" onchange="window.maLineSet(${i},'party',this.value)">${_maPartyOpts(l.party,{blank:'No party',noNew:true})}</select>
    <input class="ma-in" aria-label="Line ${i+1} memo" placeholder="Memo" value="${_maE(l.memo||'')}" oninput="window.maLineSet(${i},'memo',this.value)">
    <button type="button" class="ma-x sm" aria-label="Remove line ${i+1}" onclick="window.maLineDrop(${i})">×</button></div>`).join('');
}
function _maLineTotals(){
  let dr=0,cr=0;
  (_maF.lines||[]).forEach(l=>{if(_maF.kind==='opening'){const a=_maNum(l.amount)||0;if(l.side==='cr')cr+=a;else dr+=a;}else{dr+=_maNum(l.dr)||0;cr+=_maNum(l.cr)||0;}});
  return {dr,cr};
}
function _maPaintLineTotals(){
  const el=document.getElementById('ma-f-linetot');if(!el||!_maF)return;
  const t=_maLineTotals();
  el.innerHTML=_maF.kind==='opening'?`Debits ${maRs(t.dr)} · credits ${maRs(t.cr)}${t.dr!==t.cr?' · 3090 takes '+maRs(Math.abs(t.dr-t.cr)):''}`
    :`Debits ${maRs(t.dr)} · credits ${maRs(t.cr)} ${t.dr===t.cr?'<span class="ma-word fine">balanced</span>':'<span class="ma-word urgent">off by '+maRs(Math.abs(t.dr-t.cr))+'</span>'}`;
}
window.maLineSet=function(i,k,v){if(!_maF||!_maF.lines[i])return;_maF.lines[i][k]=v;_maPaintLineTotals();window.maFormDirty();};
window.maLineAdd=function(){if(!_maF)return;_maF.lines.push({account:'',side:'dr',amount:'',dr:'',cr:'',party:'',memo:''});const el=document.getElementById('ma-f-lines');if(el)el.innerHTML=_maLinesHTML(_maCtx());_maPaintLineTotals();};
window.maLineDrop=function(i){if(!_maF)return;_maF.lines.splice(i,1);const el=document.getElementById('ma-f-lines');if(el)el.innerHTML=_maLinesHTML(_maCtx());_maPaintLineTotals();};
window.maFormDirty=function(){
  if(!_maF||!_maF.ack)return;
  _maF.ack=false;
  const b=document.getElementById('ma-f-save');if(b)b.textContent=_maF.edit?'Save the edit':'Record';
};
window.maPartyPicked=function(v){
  const np=document.getElementById('ma-f-np');if(np)np.hidden=v!=='__new';
  const pw=document.getElementById('ma-w-payee');if(pw)pw.hidden=!!v&&v!=='__new';
  // Until the owner picks a tax treatment, it follows the party (§12).
  if(_maF&&_maF.taxAuto&&!_maF.edit&&(_maF.kind==='money_out'||_maF.kind==='money_in')){
    const pt=_maPartyTax(v);
    if(pt)_maTaxSet(pt.tax.kind,pt.tax.rate,pt.from,true);else _maTaxSet('none',0,_MA_TAX_PRESET,true);
  }
};
window.maCountBook=function(){
  const out=document.getElementById('ma-f-book');if(!out||!_maF)return;
  const c=_maCtx();const code=_maF.edit&&_maF.edit.holder?_maF.edit.holder:_maVal('ma-f-holder');const date=_maVal('ma-f-date');
  if(!code){out.textContent='';return;}
  const lines=_maF.edit?maPostAll(c.docs.filter(d=>!(d.dt===_maF.edit.dt&&d.id===_maF.edit.id)),c.idx,c.s):c.lines;
  // The book the save will use: an edit's own, until its day or count moves.
  const book=maCountBookOf(_maF.edit,{date,counted:_maVal('ma-f-counted')},maBalanceOf(lines,c.idx,code,maIsDay(date)?date:undefined));
  const n=_maNum(_maVal('ma-f-counted'));
  out.innerHTML='The book says '+maRs(book)+(Number.isFinite(n)?(Math.round(n)===book?' · <span class="ma-word fine">agrees</span>':' · <span class="ma-word warn">'+maRsSigned(Math.round(n)-book)+'</span>'):'');
};
const _MA_PERIOD_HINT='The oldest period not paid in full on that day — change it if this pays another.';
/* Keep "For the period" in step with the date and the commitment while it
   is still the form's own suggestion; once the owner types in it, it is
   theirs and is left alone (money F10). */
window.maCommitPeriodSync=function(){
  const f=_maF;if(!f||f.kind!=='money_out')return;
  const el=document.getElementById('ma-f-commitmentPeriod');if(!el)return;
  if(!f.periodAuto&&String(el.value||'').trim())return;
  const c=_maCtx();
  const cm=_maCommit(_maVal('ma-f-commitmentId'));
  const docs=f.edit?c.docs.filter(d=>!(d.dt===f.edit.dt&&d.id===f.edit.id)):c.docs;
  el.value=cm?maCommitmentOpenPeriod(cm,docs,_maVal('ma-f-date'),c.s):'';
  f.periodAuto=true;
  const h=document.getElementById('ma-f-cphint');if(h)h.textContent=cm&&el.value?_MA_PERIOD_HINT:'';
};
window.maCommitPeriodTyped=function(){
  if(_maF)_maF.periodAuto=false;
  const h=document.getElementById('ma-f-cphint');if(h)h.textContent='';
};
window.maOwnerPick=function(u){
  const h=document.getElementById('ma-f-owner');if(h)h.value=u;
  MA_OWNERS.forEach(x=>{const b=document.getElementById('ma-own-'+x);if(b&&b.classList)b.classList.toggle('on',x===u);});
  window.maFormDirty();
};

/* ── A document form (new or edit) ────────────────────────────────────── */
function _maOpenDocForm(kind,pre,edit){
  const c=_maCtx();const s=c.s;
  const dt=_MA_KIND_DT[kind];
  // atts: the files on the form — uploaded as soon as they are picked, so
  // the form holds only references (maAttachList); attBusy: uploads in
  // flight (Record waits for them).
  _maF={kind,dt,pre:pre||{},edit:edit||null,ack:false,lines:[],atts:maAttachList((pre||{}).attachments),attBusy:0,attErr:'',attNote:''};
  const p=Object.assign({date:c.today},pre||{});
  if(kind==='opening'||kind==='general'){
    // A line's own cost centre has no field on the form; it is carried, so
    // an edit never drops it (money F1).
    _maF.lines=(p.lines||[]).map(l=>({account:l.account||'',side:l.side||'dr',amount:l.amount||'',dr:l.dr||'',cr:l.cr||'',party:l.party||'',memo:l.memo||'',costCentre:l.costCentre||''}));
    while(_maF.lines.length<2)_maF.lines.push({account:'',side:'dr',amount:'',dr:'',cr:'',party:'',memo:''});
    if(kind==='opening'&&!edit&&!pre.date)p.date=s.historyFrom<=c.today?s.historyFrom:c.today;
  }
  // A transfer that waits for — or was confirmed by — someone keeps what was
  // (or is to be) confirmed: its route, amount and day (money F6). The rules
  // refuse the same (maTrEditOk); the form does not offer them.
  const trLock=dt==='transfer'&&!!edit&&maTransferNeedsConfirm(edit);
  const trWhy=trLock?(edit.status==='pending'?'It waits for '+_maWho(edit.confirmBy)+' to confirm':edit.confirmedBy?_maWho(edit.confirmedBy)+' confirmed it as it stands':'It needed a confirmation')+' — its from, to, amount and date cannot change: void it and record it again.':'';
  const date=_maFld('date','Date',_maIn('date',p.date,{type:'date',min:s.historyFrom,max:c.today,on:'window.maCountBook();window.maCommitPeriodSync()',dis:trLock}));
  const amount=_maFld('amount','Amount, ₨',_maIn('amount',p.amount,{num:true,ph:'0',on:'window.maTaxCalc()',dis:trLock}));
  const note=_maFld('note','Note',`<textarea class="ma-in" id="ma-f-note" rows="2">${_maE(p.note||'')}</textarea>`);
  let body='';
  // The period a commitment payment settles (money F10): the stored or
  // named one as it is; otherwise the oldest still open on the date, shown
  // in the field and kept in step with the date and the commitment until
  // the owner types their own (maCommitPeriodSync).
  const period={value:p.commitmentPeriod||'',auto:!edit&&!p.commitmentPeriod};
  if(kind==='money_out'&&period.auto&&p.commitmentId){const cm=_maCommit(p.commitmentId);if(cm)period.value=maCommitmentOpenPeriod(cm,c.docs,p.date,s);}
  _maF.periodAuto=period.auto;
  if(kind==='money_out'||kind==='money_in'){
    const partyLocked=!!edit;
    // The tax a new document starts on: what it was handed, else the party's
    // usual, else No tax — said to be a preset, not a choice (§12, money N1).
    const pt=!edit&&!p.tax?_maPartyTax(p.party):null;
    const tax={value:p.tax||(pt&&pt.tax)||null,from:edit||p.tax?'':pt?pt.from:_MA_TAX_PRESET};
    _maF.taxAuto=!edit&&!p.tax;
    const commits=maData.commitments.filter(x=>x.active!==false||x.id===p.commitmentId);
    body=`<div class="ma-grid2">${date}${amount}</div>
      <div class="ma-grid2">${_maFld('holder',kind==='money_out'?'Paid from':'Arrived in',_maSel('holder',_maHolderOpts(c,p.holder),p.holder),_maE(_MA_MIRROR_LINE))}
      ${_maFld('account',kind==='money_out'?'What it was for':'What it was',_maSel('account',_maAccountOpts(c,kind,p.account),p.account))}</div>
      <div class="ma-grid2">${_maFld('party',kind==='money_out'?'Paid to':'Paid by',_maSel('party',_maPartyOpts(p.party),p.party,{dis:partyLocked,on:'window.maPartyPicked(this.value)'}),partyLocked?'A document cannot change its party — void it and record it again.':'')}
      <label class="ma-field" id="ma-w-payee"${p.party?' hidden':''}><span class="ma-lbl">Or a name, for a one-off</span>${_maIn('payee',p.payee,{ph:'Who was paid',dis:partyLocked})}<span class="ma-ferr" id="ma-e-payee"></span></label></div>
      <div class="ma-np" id="ma-f-np" hidden><div class="ma-grid2">${_maFld('npname','New party’s name',_maIn('npname',''))}${_maFld('npkind','Kind',_maSel('npkind',MA_PARTY_KINDS.map(k=>_maOpt(k,MA_PARTY_KIND_LABELS[k],'vendor')).join(''),'vendor'))}</div><button type="button" class="ma-btn sm" onclick="window.maInlineParty()">Create party</button></div>
      ${_maTaxHTML(tax.value,tax.from)}
      <div class="ma-grid3">${_maFld('costCentre','Cost centre',_maSel('costCentre',_maCcOpts(s,edit?(p.costCentre||''):(p.costCentre||s.defaultCostCentre)),''))}
      ${_maFld('labelKind','Kind',_maSel('labelKind',_maOptsKeep(MA_LABEL_KINDS.filter(x=>x!=='transfer').map(x=>[x,x.replace('_','-')]),p.labelKind,{blank:'From the account',gone:v=>String(v).replace('_','-')}),''))}
      ${kind==='money_in'?_maFld('channel','Channel',_maSel('channel',_maOptsKeep(MA_CHANNELS.map(x=>[x,x.replace('_',' ')]),p.channel,{blank:'—',gone:v=>String(v).replace('_',' ')}),'')):_maFld('commitmentId','Settles a commitment',_maSel('commitmentId',_maOptsKeep(commits.map(x=>[x.id,x.name]),p.commitmentId,{blank:'No',gone:v=>'A commitment that is not loaded ('+v+')'}),'',{on:'window.maCommitPeriodSync()'}))}</div>
      <div class="ma-grid3">${kind==='money_out'?_maFld('commitmentPeriod','For the period',_maIn('commitmentPeriod',period.value,{ph:'2026-10',on:'window.maCommitPeriodTyped()'}),'<span id="ma-f-cphint">'+(period.auto&&period.value?_MA_PERIOD_HINT:'')+'</span>'):''}${_maFld('po','Production PO',_maIn('po',p.po,{ph:'optional'}))}${_maFld('article','Article',_maIn('article',p.article,{ph:'optional'}))}</div>
      ${note}${_maFld('tags','Tags',_maIn('tags',(p.tags||[]).join(', '),{ph:'comma between'}))}`;
  }else if(kind==='transfer'){
    body=`${trLock?`<div class="ma-note">${_maE(trWhy)}</div>`:''}<div class="ma-grid2">${date}${amount}</div>
      <div class="ma-grid2">${_maFld('from','From',_maSel('from',_maHolderOpts(c,p.from,{mirror:true}),p.from,{dis:trLock}))}${_maFld('to','To',_maSel('to',_maHolderOpts(c,p.to,{mirror:true}),p.to,{dis:!!edit}),edit?'Who received it cannot change — void and record again.':'Into another person’s hands — or into or out of the drawer — it waits to be confirmed.')}</div>
      <div class="ma-hint ma-block">The store drawer (1010) is Raees’s book in Store Accounts until M8 — a handover to or from it is recorded here and waits until an owner confirms it, once Raees has recorded it there; spending from it is recorded there.</div>${note}`;
  }else if(kind==='count'){
    // Which holder was counted is what a count IS: an edit does not offer it.
    body=`<div class="ma-grid2">${date}${_maFld('holder','Holder',_maSel('holder',_maHolderOpts(c,p.holder),p.holder,{on:'window.maCountBook()',dis:!!edit}),edit?'Which holder was counted cannot change — void it and count again.':_maE(_MA_MIRROR_LINE.replace(' A handover to or from it is a Transfer.',' Raees counts it there.')))}</div>
      ${_maFld('counted','Counted, ₨',_maIn('counted',p.counted,{num:true,ph:'0',on:'window.maCountBook()'}),'<span id="ma-f-book"></span>')}${note}`;
  }else if(kind==='capital'||kind==='drawing'){
    const own=edit||MA_OWNERS.indexOf(p.owner)>=0?p.owner:session.u;
    body=`<div class="ma-grid2">${date}${amount}</div>
      <div class="ma-field" id="ma-w-owner"><span class="ma-lbl">Owner</span><input type="hidden" id="ma-f-owner" value="${_maE(own)}"><div class="ma-chips">${MA_OWNERS.map(u=>`<button type="button" class="ma-chip${own===u?' on':''}" id="ma-own-${u}" onclick="window.maOwnerPick('${u}')">${_maE(_maWho(u))}</button>`).join('')}</div><span class="ma-ferr" id="ma-e-owner"></span></div>
      ${_maFld('holder',kind==='capital'?'Put into':'Taken from',_maSel('holder',_maHolderOpts(c,p.holder),p.holder),_maE(_MA_MIRROR_LINE))}${note}`;
  }else{
    body=`<div class="ma-grid2">${date}<div></div></div>
      <div class="ma-field" id="ma-w-lines"><span class="ma-lbl">Lines</span><div class="ma-lines" id="ma-f-lines">${_maLinesHTML(c)}</div><button type="button" class="ma-link" onclick="window.maLineAdd()">Add a line</button><div class="ma-hint" id="ma-f-linetot"></div><span class="ma-ferr" id="ma-e-lines"></span></div>${note}`;
  }
  body+=_maAttFieldHTML();
  if(edit)body+=_maFld('reason','Why is this changing?',`<textarea class="ma-in" id="ma-f-reason" rows="2"></textarea>`);
  body=`<div class="ma-issues" id="ma-f-issues"></div>`+body;
  const title=edit?'Edit '+edit.no:(MA_JOURNAL_KINDS[kind]?MA_JOURNAL_KINDS[kind].label:kind==='transfer'?'Transfer':'Count');
  _maModal(title,body,`<button class="ma-btn" onclick="window.maCloseModal()">Cancel</button><button class="ma-btn primary" id="ma-f-save" onclick="window.maSaveForm()">${edit?'Save the edit':'Record'}</button>`,kind==='opening'||kind==='general');
  _maPaintLineTotals();window.maTaxCalc();window.maCountBook();
}
/* "5.000" is refused before anything is built, and says what it probably
   meant (money N2): the parser reads it as neither 5 nor 5,000. */
function _maDottedIssue(raw,field,label){
  const v=String(raw===undefined||raw===null?'':raw).trim();
  const hint=maRupeesDotted(v);
  return hint?{rule:'amount.dotted',level:'refuse',field,message:(label||'The amount')+' “'+v+'” — did you mean '+hint+'? Rupees take a comma, or none.'}:null;
}
function _maFormRead(){
  const f=_maF,k=f.kind;
  const input={kind:k,date:_maVal('ma-f-date').trim(),note:_maVal('ma-f-note'),attachments:(f.atts||[]).slice()};
  if(k==='money_out'||k==='money_in'){
    Object.assign(input,{holder:_maVal('ma-f-holder'),account:_maVal('ma-f-account'),amount:_maVal('ma-f-amount'),
      party:_maVal('ma-f-party'),payee:_maVal('ma-f-payee'),
      tax:{kind:_maVal('ma-f-taxkind')||'none',rate:Number(_maVal('ma-f-taxrate'))||0,inclusive:_maChecked('ma-f-taxincl',true),claimable:_maChecked('ma-f-taxclaim',false)},
      costCentre:_maVal('ma-f-costCentre'),labelKind:_maVal('ma-f-labelKind'),
      po:_maVal('ma-f-po'),article:_maVal('ma-f-article'),
      tags:_maVal('ma-f-tags').split(',').map(x=>x.trim()).filter(Boolean)});
    // What this kind's form does not show is carried from the stored
    // document, never cleared by an edit (money F1): Money out has no
    // channel field, Money in no commitment fields.
    const was=f.edit||{};
    if(k==='money_in')Object.assign(input,{channel:_maVal('ma-f-channel'),commitmentId:was.commitmentId||'',commitmentPeriod:was.commitmentPeriod||''});
    else Object.assign(input,{channel:was.channel||'',commitmentId:_maVal('ma-f-commitmentId'),commitmentPeriod:_maVal('ma-f-commitmentPeriod').trim()});
    if(input.party==='__new')input.party='';
    if(input.party){const p=_maParty(input.party);input.partyKind=p?p.kind:null;input.payee='';}
    // The tax block's reference has no field either; a "No tax" kept as it
    // was stored.
    const wt=was.tax;
    if(input.tax.kind==='none')input.tax=wt&&wt.kind==='none'?{kind:'none',rate:0,inclusive:wt.inclusive!==false,claimable:!!wt.claimable}:{kind:'none',rate:0,inclusive:true,claimable:false};
    else if(wt&&wt.ref)input.tax.ref=wt.ref;
    if(f.edit){input.party=f.edit.party||'';input.partyKind=f.edit.partyKind||null;if(f.edit.party)input.payee='';}
  }else if(k==='transfer'){
    // What the form does not offer on an edit is read from the document.
    const lock=!!f.edit&&maTransferNeedsConfirm(f.edit);
    Object.assign(input,{from:lock?f.edit.from:_maVal('ma-f-from'),to:f.edit?f.edit.to:_maVal('ma-f-to'),amount:lock?f.edit.amount:_maVal('ma-f-amount')});
    if(lock)input.date=f.edit.date;
  }else if(k==='count'){
    Object.assign(input,{holder:f.edit?f.edit.holder:_maVal('ma-f-holder'),counted:_maVal('ma-f-counted')});
  }else if(k==='capital'||k==='drawing'){
    Object.assign(input,{owner:_maVal('ma-f-owner'),holder:_maVal('ma-f-holder'),amount:_maVal('ma-f-amount')});
  }else{
    input.lines=f.lines.filter(l=>l.account||l.amount||l.dr||l.cr).map(l=>{
      const o=k==='opening'?{account:l.account,side:l.side,amount:l.amount,party:l.party,memo:l.memo}:{account:l.account,dr:l.dr||0,cr:l.cr||0,party:l.party,memo:l.memo};
      if(l.costCentre)o.costCentre=l.costCentre;
      return o;
    });
  }
  // Only Money out and Money in show tags; every other kind carries them.
  if(k!=='money_out'&&k!=='money_in')input.tags=f.edit&&Array.isArray(f.edit.tags)?f.edit.tags.slice():[];
  return input;
}
const _MA_FIELDS=['date','amount','holder','account','party','payee','tax','costCentre','labelKind','channel','commitmentId','commitmentPeriod','owner','from','to','counted','note','lines','reason',
  'name','ckind','cadence','amountExpected','dueDay','dueWeekday','dueMonth','code','npname','item','unit','rate','validFrom','attachments'];
function _maShowIssues(res){
  _MA_FIELDS.forEach(f=>{const e=document.getElementById('ma-e-'+f);if(e)e.textContent='';});
  const top=[];
  res.refuses.forEach(x=>{
    const e=x.field&&document.getElementById('ma-e-'+x.field);
    if(e&&_MA_FIELDS.indexOf(x.field)>=0)e.textContent=(e.textContent?e.textContent+' ':'')+x.message;
    else top.push(`<li class="refuse"><span class="ma-dot urgent"></span>${_maE(x.message)}</li>`);
  });
  res.flags.forEach(x=>top.push(`<li><span class="ma-dot warn"></span>${_maE(x.message)}</li>`));
  const box=document.getElementById('ma-f-issues');
  if(box)box.innerHTML=top.length?`<ul class="ma-flaglist">${top.join('')}</ul>${res.ok&&res.flags.length?'<div class="ma-hint">These go to the review queue with the document.</div>':''}`:'';
}
window.maSaveForm=async function(){
  const f=_maF;if(!f||_maBusy)return;
  if(f.kind==='commitment')return _maSaveCommitment();
  if(f.kind==='party')return _maSaveParty();
  if(f.kind==='terms')return _maSaveTerms();
  if(f.kind==='rate')return _maSaveRate();
  if(f.attBusy){_maShowIssues({refuses:[{message:'Wait for the upload to finish — the file is not on the document yet.',field:'attachments'}],flags:[],ok:false});return;}
  const c=_maCtx();const s=c.s;
  const input=_maFormRead();
  const dotted=[_maDottedIssue(input.amount,'amount','The amount'),_maDottedIssue(input.counted,'counted','The count')]
    .concat(...(input.lines||[]).map((l,i)=>[['amount',''],['dr',' debit'],['cr',' credit']].map(([k,w])=>_maDottedIssue(l[k],'lines','Line '+(i+1)+w)))).filter(Boolean);
  if(dotted.length){_maShowIssues({refuses:dotted,flags:[],ok:false});return;}
  const meta=f.edit?{by:f.edit.by,byName:f.edit.byName,ts:f.edit.ts,source:f.edit.source}:{by:session.u,byName:session.name||session.u,ts:Date.now(),source:'manual'};
  const others=f.edit?maPostAll(c.docs.filter(d=>!(d.dt===f.edit.dt&&d.id===f.edit.id)),c.idx,s):c.lines;
  // An edit keeps the stored book unless the day or the count moved (money F2).
  if(f.dt==='count')meta.bookBalance=maCountBookOf(f.edit,input,maBalanceOf(others,c.idx,input.holder,maIsDay(input.date)?input.date:undefined));
  const built=maBuildDoc(f.dt,input,meta,c.idx,s);
  if(f.edit){built.id=f.edit.id;built.no=f.edit.no;}
  const reason=f.edit?_maVal('ma-f-reason').trim():'';
  const res=maValidate(built,{idx:c.idx,settings:s,parties:maData.parties,docs:c.docs,lines:others,closes:maData.closes,today:c.today,commitments:maData.commitments,before:f.edit||undefined,reason});
  _maShowIssues(res);
  if(!res.ok)return;
  if(res.flags.length&&!f.ack){
    f.ack=true;
    const b=document.getElementById('ma-f-save');if(b)b.textContent=(f.edit?'Save anyway':'Record anyway')+' — '+res.flags.length+' flag'+(res.flags.length>1?'s':'');
    return;
  }
  if(_maNeedsNet())return;
  _maBusy=true;
  const btn=document.getElementById('ma-f-save');if(btn)btn.disabled=true;
  try{
    if(f.edit){
      // The edit stores the flags it raised — the ones just shown and
      // acknowledged — and a figure that moved clears the review (money F8).
      let edited=maApplyEdit(f.edit,built,{at:Date.now(),by:session.u,byName:session.name||session.u,reason,flags:res.flags});
      if(!edited){_maToast('Nothing changed.');return;}
      edited=_maEditShape(f.edit,edited);
      await _maWriteEdit(f.edit,edited,reason);
      const key=_MA_DOC_KEY[f.dt];const i=maData[key].findIndex(d=>d.id===f.edit.id);if(i>=0)maData[key][i]=edited;
      _maInvalidate();window.maCloseModal();_maToast(edited.no+' saved — revision '+maRevOf(edited)+'.'+(maReviewQueue([edited]).length?' It waits for review.':''));
      _maRail={kind:'doc',dt:edited.dt,id:edited.id};_maPaint();
    }else{
      if(res.flags.length)built.flags=maFlagRows(res.flags);
      const stored=await _maPostNew(built);
      maData[_MA_DOC_KEY[f.dt]].push(stored);
      _maInvalidate();window.maCloseModal();
      _maToast(stored.no+(stored.status==='pending'?' recorded — waiting for '+_maWho(stored.confirmBy)+' to confirm.':' recorded.')+(stored.flags&&stored.flags.length?' It waits for review.':''));
      _maPaint();
    }
  }catch(e){
    const box=_maF===f?document.getElementById('ma-f-issues'):null;
    if(box)box.innerHTML=`<ul class="ma-flaglist"><li class="refuse"><span class="ma-dot urgent"></span>${_maE(_maWriteError(e))} Nothing was saved.</li></ul>`;
    else _maToast('Not saved: '+_maDocWhat(f,built)+' — '+_maWriteError(e)+(f.edit?'':' Record it again.'));
  }finally{_maBusy=false;const b=_maF===f&&document.getElementById('ma-f-save');if(b)b.disabled=false;}
};
window.maEditDoc=function(dt,id){
  const d=_maDoc(dt,id);if(!d)return;
  if(d.status==='void'){_maToast('A void document cannot be edited.');return;}
  const kind=dt==='journal'?d.kind:dt;
  const pre=Object.assign({},_maClean(d));
  _maOpenDocForm(kind,pre,d);
};
window.maVoidDoc=async function(dt,id){
  const d=_maDoc(dt,id);if(!d||_maBusy)return;
  const c=_maCtx();
  const reason=prompt('Why is '+d.no+' being voided? It stays on the record, struck through.','');
  if(reason===null)return;
  const iss=maVoidIssues(d,reason,{settings:c.s,closes:maData.closes,docs:c.docs});
  const ref=iss.filter(x=>x.level==='refuse');
  if(ref.length){_maToast(ref[0].message);return;}
  const fl=iss.filter(x=>x.level==='flag');
  if(fl.length&&!confirm(fl.map(x=>x.message).join(' ')+' Void anyway?'))return;
  if(_maNeedsNet())return;
  const m=_maMeta();
  const v=maApplyVoid(d,{at:m.at,by:m.by,byName:m.byName,reason});
  const patch={status:'void',voidedAt:v.voidedAt,voidedBy:v.voidedBy,voidedByName:v.voidedByName,voidReason:v.voidReason};
  _maBusy=true;
  try{
    await _maWritePatch(d,patch,'void',reason.trim(),cur=>cur.status==='void'?'It is already void.':null);
    Object.assign(d,patch);_maInvalidate();
    const links=await _maWithdrawLinks(d);
    _maToast(d.no+' voided — it stays on the record, struck through.'+links);_maPaint();
  }catch(e){_maToast(_maWriteError(e));}finally{_maBusy=false;}
};
/* A voided document's live share links are withdrawn with it (money M3):
   the PDF they serve says nothing of the void. Through ma-share, one link
   at a time, so each is an audited withdrawal; what could not be withdrawn
   — or read — is said, never assumed gone. → the sentence for the toast. */
async function _maWithdrawLinks(d){
  let rows;
  try{
    const snap=await getDocs(query(collection(db,'ma_shares'),where('docId','==',d.id)));
    rows=((snap&&snap.docs)||[]).map(x=>Object.assign({},typeof x.data==='function'?x.data():{},{token:x.id})).filter(x=>x.docKind===d.dt);
  }catch(e){return ' Its share links could not be read — open Share on it and withdraw any that are live.';}
  const live=rows.filter(x=>maShareState(x,Date.now())==='live');
  if(!live.length)return '';
  let gone=0;
  for(const x of live){try{await _maFn('ma-share',{action:'revoke',token:x.token});gone++;}catch(_){}}
  if(gone===live.length)return ' Its '+(gone===1?'live link was':gone+' live links were')+' withdrawn.';
  return ' '+(live.length-gone)+' of its '+live.length+' live link'+(live.length>1?'s':'')+' could not be withdrawn — open Share on it and withdraw '+(live.length-gone>1?'them':'it')+'.';
}
/* Review — the one way the review fields are SET (an edit may only clear
   them). Refused in a closed quarter, naming it: the rules refuse it too
   (maReviewOk), in no words a person can act on. */
window.maReviewDoc=async function(dt,id){
  const d=_maDoc(dt,id);if(!d||_maBusy)return;
  const locked=maQuarterLocked(d,{closes:maData.closes,settings:_maCtx().s});
  if(locked){_maToast(locked+' is closed — a document dated in it cannot be reviewed until an owner reopens the quarter.');return;}
  if(_maNeedsNet())return;
  const patch={reviewedAt:Date.now(),reviewedBy:session.u};
  _maBusy=true;
  try{
    await _maWritePatch(d,patch,'review',(d.flags||[]).map(x=>x.rule).join(', '),null);
    Object.assign(d,patch);_maInvalidate();_maToast(d.no+' reviewed.');_maPaint();
  }catch(e){_maToast(_maWriteError(e));}finally{_maBusy=false;}
};

/* ── The commitment form (§26) ────────────────────────────────────────── */
function _maCommitForm(x,pre){
  const c=_maCtx();const s=c.s;
  const v=Object.assign({kind:'fixed',cadence:'monthly',dueDay:1,amountExpected:'',costCentre:s.defaultCostCentre,active:true},x||{},pre&&!x?pre:{});
  _maF={kind:'commitment',edit:x||null,ack:false};
  const body=`<div class="ma-issues" id="ma-f-issues"></div>
    ${_maFld('name','Name',_maIn('name',v.name,{ph:'Rent — factory'}))}
    <div class="ma-grid3">${_maFld('ckind','Kind',_maSel('ckind',MA_COMMIT_KINDS.map(k=>_maOpt(k,k.replace('_','-'),v.kind)).join(''),v.kind))}
    ${_maFld('cadence','How often',_maSel('cadence',MA_CADENCES.map(k=>_maOpt(k,MA_CADENCE_LABELS[k],v.cadence)).join(''),v.cadence))}
    ${_maFld('amountExpected','Expected, ₨',_maIn('amountExpected',v.amountExpected,{num:true,ph:'0 if it varies'}))}</div>
    <div class="ma-grid3">${_maFld('dueDay','Day of the month',_maIn('dueDay',v.dueDay,{num:true}))}
    ${_maFld('dueWeekday','Weekday',_maSel('dueWeekday',_maOpt('','—',v.dueWeekday)+MA_WEEKDAYS_LONG.map((w,i)=>_maOpt(i,w,v.dueWeekday)).join(''),v.dueWeekday))}
    ${_maFld('dueMonth','Month',_maIn('dueMonth',v.dueMonth,{num:true,ph:'yearly: 1–12 · quarterly: 1–3'}))}</div>
    <div class="ma-grid2">${_maFld('account','Booked to',_maSel('account',_maAccountOpts(c,'money_out',v.account),v.account))}
    ${_maFld('holder','Usually paid from',_maSel('holder',_maHolderOpts(c,v.holder,{blank:'Not fixed'}),v.holder),_maE(_MA_MIRROR_LINE.replace(' A handover to or from it is a Transfer.',' What Raees pays is recorded there.')))}</div>
    <div class="ma-grid2">${_maFld('party','Party',_maSel('party',_maPartyOpts(v.party,{blank:'None',noNew:true}),v.party))}
    ${_maFld('costCentre','Cost centre',_maSel('costCentre',_maCcOpts(s,x?(x.costCentre||''):v.costCentre),''))}</div>
    <div class="ma-grid2">${_maFld('from','From',_maIn('from',v.from,{type:'date'}))}${_maFld('to','Until',_maIn('to',v.to,{type:'date'}))}</div>
    ${_maFld('note','Note',`<textarea class="ma-in" id="ma-f-note" rows="2">${_maE(v.note||'')}</textarea>`)}`;
  _maModal(x?'Edit '+x.name:'New commitment',body,`<button class="ma-btn" onclick="window.maCloseModal()">Cancel</button><button class="ma-btn primary" id="ma-f-save" onclick="window.maSaveForm()">${x?'Save':'Add commitment'}</button>`);
}
function _maIntOrNull(v){if(maRupeesDotted(String(v||'').trim()))return NaN;v=String(v||'').replace(/[₨,\s]/g,'');if(v==='')return null;const n=Number(v);return Number.isFinite(n)?n:NaN;}
async function _maSaveCommitment(){
  const c=_maCtx();const f=_maF;const before=f.edit;
  const dq=_maDottedIssue(_maVal('ma-f-amountExpected'),'amountExpected','The expected amount');
  if(dq){_maShowIssues({refuses:[dq],flags:[],ok:false});return;}
  const x=Object.assign({},before?_maClean(before):{},{
    name:_maVal('ma-f-name').trim(),kind:_maVal('ma-f-ckind'),cadence:_maVal('ma-f-cadence'),
    amountExpected:_maIntOrNull(_maVal('ma-f-amountExpected')),dueDay:_maIntOrNull(_maVal('ma-f-dueDay')),
    dueWeekday:_maIntOrNull(_maVal('ma-f-dueWeekday')),dueMonth:_maIntOrNull(_maVal('ma-f-dueMonth')),
    account:_maVal('ma-f-account'),holder:_maVal('ma-f-holder')||null,party:_maVal('ma-f-party')||null,
    costCentre:_maVal('ma-f-costCentre'),from:_maVal('ma-f-from')||null,to:_maVal('ma-f-to')||null,note:_maVal('ma-f-note').trim()});
  if(x.amountExpected===null)x.amountExpected=0;
  ['dueDay','dueWeekday','dueMonth'].forEach(k=>{if(x[k]===null)delete x[k];});
  if(x.cadence!=='weekly')delete x.dueWeekday;
  if(x.cadence!=='yearly'&&x.cadence!=='quarterly')delete x.dueMonth;
  if(['monthly','quarterly','yearly'].indexOf(x.cadence)<0)delete x.dueDay;
  if(!before){x.id=_maId('c_');x.active=true;x.createdAt=Date.now();x.createdBy=session.u;x.history=[];}
  const iss=maCommitmentIssues(x,{idx:c.idx,settings:c.s,parties:maData.parties});
  const bad=iss.filter(i=>i.level==='refuse').map(i=>Object.assign({},i,{field:i.field==='kind'?'ckind':i.field}));
  _maShowIssues({refuses:bad,flags:iss.filter(i=>i.level==='flag'),ok:!bad.length});
  if(bad.length)return;
  if(_maNeedsNet())return;
  const fields=before?Object.keys(x).filter(k=>['history','updatedAt','updatedBy'].indexOf(k)<0&&JSON.stringify(x[k])!==JSON.stringify(before[k])):['created'];
  if(before&&!fields.length){_maToast('Nothing changed.');return;}
  x.history=(Array.isArray(x.history)?x.history:[]).concat([{at:Date.now(),by:session.u,fields}]).slice(-50);
  x.updatedAt=Date.now();x.updatedBy=session.u;
  _maBusy=true;
  try{
    await _maWriteMasters([{col:'ma_commitments',id:x.id,data:x}],'commitment',{dt:'commitment',id:x.id,no:x.name},(before?'Edited: '+fields.join(', '):'New commitment')+' · '+x.name);
    const i=maData.commitments.findIndex(y=>y.id===x.id);if(i>=0)maData.commitments[i]=x;else maData.commitments.push(x);
    _maInvalidate();window.maCloseModal();_maToast(x.name+(before?' saved.':' added to the register.'));_maPaint();
  }catch(e){_maFormFail(f,(before?'the edit to ':'the new commitment ')+(x.name||'—'),e);}finally{_maBusy=false;}
}
window.maCommitToggle=async function(id){
  const x=_maCommit(id);if(!x||_maBusy||_maNeedsNet())return;
  const on=x.active===false;
  if(!on&&!confirm('Switch off '+x.name+'? It leaves the calendar; its history stays.'))return;
  const next=Object.assign({},_maClean(x),{active:on,updatedAt:Date.now(),updatedBy:session.u});
  next.history=(next.history||[]).concat([{at:Date.now(),by:session.u,fields:['active']}]).slice(-50);
  _maBusy=true;
  try{
    await _maWriteMasters([{col:'ma_commitments',id:x.id,data:next}],'commitment',{dt:'commitment',id:x.id,no:x.name},(on?'Switched on':'Switched off')+' · '+x.name);
    Object.assign(x,next);_maInvalidate();_maPaint();
  }catch(e){_maToast(_maWriteError(e));}finally{_maBusy=false;}
};

/* ── Parties: the form, inline creation, terms and rates (§4.2) ───────── */
function _maPartyCodes(){return maData.parties.map(p=>p.code).filter(Boolean);}
window.maPartyForm=function(id){
  const c=_maCtx();const p=id?_maParty(id):null;
  const v=p?_maClean(p):{kind:'vendor',active:true,costCentre:c.s.defaultCostCentre,vendor:{roles:[],tax:{regime:'none'}}};
  const vd=v.vendor||{roles:[],tax:{regime:'none'}};
  _maF={kind:'party',edit:p,ack:false};
  const t=(vd.terms)||{mode:'cash'};
  const body=`<div class="ma-issues" id="ma-f-issues"></div>
    <div class="ma-grid2">${_maFld('pkind','Kind',_maSel('pkind',MA_PARTY_KINDS.map(k=>_maOpt(k,MA_PARTY_KIND_LABELS[k],v.kind)).join(''),v.kind,{on:'window.maPartyKindPicked(this.value)'}))}
    ${_maFld('name','Name',_maIn('name',v.name,{on:p?'':'window.maPartyAutoCode()'}))}</div>
    <div class="ma-grid3">${_maFld('code','Code',_maIn('code',v.code,{ph:'auto'}),'2 to 12 capitals or digits')}
    ${_maFld('costCentre','Cost centre',_maSel('costCentre',_maCcOpts(c.s,p?(p.costCentre||''):v.costCentre),''))}
    ${p?`<label class="ma-field"><span class="ma-lbl">Active</span><label class="ma-chk"><input type="checkbox" id="ma-f-active"${v.active!==false?' checked':''}> in use</label></label>`:'<div></div>'}</div>
    <div class="ma-grid2">${_maFld('person','Contact person',_maIn('person',v.contact&&v.contact.person))}${_maFld('phone','Phone',_maIn('phone',v.contact&&v.contact.phone,{type:'tel'}))}</div>
    <div id="ma-f-vendor"${v.kind==='vendor'?'':' hidden'}>
      <div class="ma-field"><span class="ma-lbl">Provides</span><div class="ma-days">${MA_VENDOR_ROLES.map(r=>`<label class="ma-chk"><input type="checkbox" id="ma-f-role-${r}"${(vd.roles||[]).indexOf(r)>=0?' checked':''}> ${_maE(r.replace(/_/g,' '))}</label>`).join('')}</div></div>
      <div class="ma-grid2">${_maFld('regime','Usual tax',_maSel('regime',['none','sales','services'].map(k=>_maOpt(k,MA_TAX_LABELS[k],vd.tax&&vd.tax.regime||'none')).join(''),''))}
      ${_maFld('wht','Withholding %',_maIn('wht',vd.tax&&vd.tax.withholdingPct,{num:true,ph:'none'}))}</div>
      ${p?'':_maTermsFields(t)}
    </div>
    ${_maFld('pnotes','Notes',`<textarea class="ma-in" id="ma-f-pnotes" rows="2">${_maE(v.notes||'')}</textarea>`)}`;
  _maModal(p?'Edit '+p.name:'New party',body,`<button class="ma-btn" onclick="window.maCloseModal()">Cancel</button><button class="ma-btn primary" id="ma-f-save" onclick="window.maSaveForm()">${p?'Save':'Add party'}</button>`);
};
window.maPartyKindPicked=function(k){const el=document.getElementById('ma-f-vendor');if(el)el.hidden=k!=='vendor';};
window.maPartyAutoCode=function(){
  const code=document.getElementById('ma-f-code');if(!code||code.dataset&&code.dataset.touched)return;
  code.value=maPartyCode(_maVal('ma-f-name'),_maPartyCodes())||'';
};
function _maTermsFields(t){
  t=t||{mode:'cash'};
  return `<div class="ma-grid3">${_maFld('tmode','Terms',_maSel('tmode',MA_TERMS_MODES.map(k=>_maOpt(k,k.charAt(0).toUpperCase()+k.slice(1),t.mode)).join(''),t.mode))}
    ${_maFld('tdays','Credit days',_maIn('tdays',t.creditDays,{num:true,ph:'credit'}))}
    ${_maFld('tlimit','Credit limit, ₨',_maIn('tlimit',t.creditLimit,{num:true,ph:'none'}))}</div>
    <div class="ma-grid2">${_maFld('tbill','Bill day (monthly)',_maIn('tbill',t.billDay,{num:true,ph:'1–31'}))}
    <div class="ma-field"><span class="ma-lbl">Bill weekdays (weekly)</span>${_maDaysPick('ma-f-tw-',t.billWeekdays||[])}</div></div>`;
}
function _maTermsRead(){
  const mode=_maVal('ma-f-tmode')||'cash';
  const t={mode};
  const n=id=>_maIntOrNull(_maVal(id));
  if(mode==='credit'){t.creditDays=n('ma-f-tdays');}
  if(mode==='credit'||mode==='monthly'){const l=n('ma-f-tlimit');if(l!==null)t.creditLimit=l;}
  if(mode==='monthly'){t.billDay=n('ma-f-tbill');const d=n('ma-f-tdays');if(d)t.creditDays=d;}
  if(mode==='weekly')t.billWeekdays=MA_WEEKDAYS.map((w,i)=>_maChecked('ma-f-tw-'+i,false)?i:-1).filter(i=>i>=0);
  return t;
}
async function _maSaveParty(){
  const c=_maCtx();const f=_maF;const before=f.edit;
  const kind=_maVal('ma-f-pkind')||'vendor';
  const p=Object.assign({},before?_maClean(before):{id:_maId('p_'),createdAt:Date.now(),createdBy:session.u,history:[]},{
    kind,name:_maVal('ma-f-name').trim(),code:(_maVal('ma-f-code').trim().toUpperCase())||maPartyCode(_maVal('ma-f-name'),_maPartyCodes()),
    costCentre:_maVal('ma-f-costCentre'),active:before?_maChecked('ma-f-active',before.active!==false):true,
    contact:{person:_maVal('ma-f-person').trim(),phone:_maVal('ma-f-phone').trim()},notes:_maVal('ma-f-pnotes').trim()});
  if(kind==='vendor'){
    const vd=Object.assign({},(before&&before.vendor)||{});
    vd.roles=MA_VENDOR_ROLES.filter(r=>_maChecked('ma-f-role-'+r,(vd.roles||[]).indexOf(r)>=0));
    const w=_maIntOrNull(_maVal('ma-f-wht'));
    vd.tax={regime:_maVal('ma-f-regime')||'none'};if(w!==null)vd.tax.withholdingPct=w;
    if(!before){vd.terms=Object.assign(_maTermsRead(),{from:c.today});vd.termsHistory=[];vd.rateCard=[];}
    p.vendor=vd;
  }
  const iss=maPartyIssues(p,{parties:maData.parties,settings:c.s});
  const res={refuses:iss.filter(i=>i.level==='refuse').map(i=>Object.assign({},i,{field:i.field==='name'||i.field==='code'||i.field==='costCentre'?i.field:null})),flags:iss.filter(i=>i.level==='flag')};
  res.ok=!res.refuses.length;
  _maShowIssues(res);
  if(!res.ok)return;
  if(res.flags.length&&!f.ack){f.ack=true;const b=document.getElementById('ma-f-save');if(b)b.textContent='Save anyway';return;}
  if(_maNeedsNet())return;
  const fields=before?Object.keys(p).filter(k=>['history','updatedAt','updatedBy'].indexOf(k)<0&&JSON.stringify(p[k])!==JSON.stringify(before[k])):['created'];
  if(before&&!fields.length){_maToast('Nothing changed.');return;}
  p.history=(p.history||[]).concat([{at:Date.now(),by:session.u,fields}]).slice(-50);
  p.updatedAt=Date.now();p.updatedBy=session.u;
  _maBusy=true;
  try{
    await _maWriteMasters([{col:'ma_parties',id:p.id,data:p}],'party',{dt:'party',id:p.id,no:p.code},(before?'Edited: '+fields.join(', '):'New '+p.kind)+' · '+p.name);
    const i=maData.parties.findIndex(x=>x.id===p.id);if(i>=0)maData.parties[i]=p;else maData.parties.push(p);
    _maInvalidate();window.maCloseModal();_maToast(p.name+(before?' saved.':' added.'));
    if(!before){_maPartyId=p.id;if(typeof window.showPage==='function'&&_maPage==='ma-parties'){window.showPage('ma-party');return;}}
    _maPaint();
  }catch(e){_maFormFail(f,(before?'the edit to ':'the new party ')+(p.name||'—'),e);}finally{_maBusy=false;}
}
/* "+ New party" from any party field: name and kind, the rest later (§14). */
window.maInlineParty=async function(){
  if(_maBusy||_maNeedsNet())return;
  const c=_maCtx();const f=_maF;
  const name=_maVal('ma-f-npname').trim(),kind=_maVal('ma-f-npkind')||'vendor';
  const p={id:_maId('p_'),kind,name,code:maPartyCode(name,_maPartyCodes()),active:true,costCentre:c.s.defaultCostCentre,contact:{person:'',phone:''},notes:'',
    createdAt:Date.now(),createdBy:session.u,history:[{at:Date.now(),by:session.u,fields:['created']}]};
  if(kind==='vendor')p.vendor={roles:[],tax:{regime:'none'},terms:{mode:'cash',from:c.today},termsHistory:[],rateCard:[]};
  const bad=maPartyIssues(p,{parties:maData.parties,settings:c.s}).filter(i=>i.level==='refuse');
  const e=document.getElementById('ma-e-npname');
  if(bad.length){if(e)e.textContent=bad[0].message;return;}
  _maBusy=true;
  try{
    await _maWriteMasters([{col:'ma_parties',id:p.id,data:p}],'party',{dt:'party',id:p.id,no:p.code},'New '+kind+' · '+name+' (from a form)');
    maData.parties.push(p);_maInvalidate();
    const sel=document.getElementById('ma-f-party');if(sel){sel.innerHTML=_maPartyOpts(p.id);sel.value=p.id;}
    window.maPartyPicked(p.id);_maToast(name+' added — the rest of their details can wait.');
  }catch(err){if(e&&_maF===f)e.textContent=_maWriteError(err);else _maToast('Not saved: the new party '+name+' — '+_maWriteError(err));}finally{_maBusy=false;}
};
window.maTermsForm=function(pid){
  const p=_maParty(pid);if(!p)return;const c=_maCtx();
  _maF={kind:'terms',edit:p,ack:false};
  const t=p.vendor&&p.vendor.terms||{mode:'cash'};
  _maModal('Terms · '+p.name,`<div class="ma-issues" id="ma-f-issues"></div>${_maTermsFields(t)}
    <div class="ma-grid2">${_maFld('tfrom','From',_maIn('tfrom',c.today,{type:'date'}),'Bills already made keep the terms they were made under.')}<div></div></div>
    ${_maFld('reason','Why',`<textarea class="ma-in" id="ma-f-reason" rows="2"></textarea>`)}`,
    `<button class="ma-btn" onclick="window.maCloseModal()">Cancel</button><button class="ma-btn primary" id="ma-f-save" onclick="window.maSaveForm()">Change terms</button>`);
};
async function _maSaveTerms(){
  const c=_maCtx();const f=_maF;const p=f.edit;
  const t=_maTermsRead();const from=_maVal('ma-f-tfrom')||c.today;const reason=_maVal('ma-f-reason').trim();
  const iss=maTermsIssues(Object.assign({},t,{from})).map(i=>Object.assign({},i,{field:null}));
  if(!reason)iss.push({rule:'terms.reason',level:'refuse',field:'reason',message:'Say why the terms change.'});
  if(!maIsDay(from))iss.push({rule:'terms.from',level:'refuse',field:null,message:'Terms start on a real day.'});
  _maShowIssues({refuses:iss,flags:[],ok:!iss.length});
  if(iss.length||_maNeedsNet())return;
  const next=maTermsChange(p,t,{from,today:c.today,by:session.u,at:Date.now(),reason});
  next.updatedAt=Date.now();next.updatedBy=session.u;
  _maBusy=true;
  try{
    await _maWriteMasters([{col:'ma_parties',id:p.id,data:next}],'terms',{dt:'party',id:p.id,no:p.code},maTermsText(t)+' from '+from+' — '+reason);
    const i=maData.parties.findIndex(x=>x.id===p.id);if(i>=0)maData.parties[i]=next;
    _maInvalidate();window.maCloseModal();_maToast('Terms changed — the old ones are kept.');_maPaint();
  }catch(e){_maFormFail(f,'the new terms for '+p.name,e);}finally{_maBusy=false;}
}
window.maRateForm=function(pid){
  const p=_maParty(pid);if(!p)return;const c=_maCtx();
  _maF={kind:'rate',edit:p,ack:false};
  const items=maData.items.map(i=>`<option value="${_maE(i.name)}">`).join('');
  _maModal('Rate · '+p.name,`<div class="ma-issues" id="ma-f-issues"></div>
    <div class="ma-grid2">${_maFld('item','Item or service',`<input class="ma-in" id="ma-f-item" list="ma-f-items"><datalist id="ma-f-items">${items}</datalist>`)}${_maFld('unit','Unit',_maIn('unit','',{ph:'piece, kg, metre'}))}</div>
    <div class="ma-grid2">${_maFld('rate','Rate, ₨',_maIn('rate','',{ph:'0.00'}))}${_maFld('validFrom','From',_maIn('validFrom',c.today,{type:'date'}),'The open rate for this item closes the day before.')}</div>
    ${_maFld('rnote','Note',_maIn('rnote',''))}`,
    `<button class="ma-btn" onclick="window.maCloseModal()">Cancel</button><button class="ma-btn primary" id="ma-f-save" onclick="window.maSaveForm()">Add rate</button>`);
};
async function _maSaveRate(){
  const c=_maCtx();const f=_maF;const p=f.edit;
  const entry={item:_maVal('ma-f-item').trim(),unit:_maVal('ma-f-unit').trim(),rate:Number(_maVal('ma-f-rate').replace(/[₨,\s]/g,'')),validFrom:_maVal('ma-f-validFrom'),note:_maVal('ma-f-rnote').trim()};
  const iss=maRateIssues(entry);
  _maShowIssues({refuses:iss,flags:[],ok:!iss.length});
  if(iss.length||_maNeedsNet())return;
  const next=maRateChange(p,entry,{today:c.today,by:session.u,at:Date.now(),id:_maId('r')});
  next.updatedAt=Date.now();next.updatedBy=session.u;
  _maBusy=true;
  try{
    await _maWriteMasters([{col:'ma_parties',id:p.id,data:next}],'rate',{dt:'party',id:p.id,no:p.code},entry.item+' ₨'+entry.rate+'/'+entry.unit+' from '+entry.validFrom);
    const i=maData.parties.findIndex(x=>x.id===p.id);if(i>=0)maData.parties[i]=next;
    _maInvalidate();window.maCloseModal();_maToast('Rate added — the earlier one is kept.');_maPaint();
  }catch(e){_maFormFail(f,'the rate for '+(entry.item||'—')+' ('+p.name+')',e);}finally{_maBusy=false;}
}

/* ═══ PDF — through js/print-engine.js only (§31, M1.4) ═══════════════════
   What a PDF says is built by the core (maPdf*Data, js/ma-core.js) from the
   same postings the page paints; this only picks the variant and the file
   name and hands them over. A transfer prints its handover receipt, a Money
   out journal its payment voucher — nothing else has a document PDF of its
   own, so nothing else is offered one. Every refusal is said out loud. */
function _maPdfCtx(c){
  const people={};
  (typeof USER_DEFS!=='undefined'?USER_DEFS:[]).forEach(u=>{if(u&&u.u)people[u.u]=u.name||u.u;});
  return {idx:c.idx,settings:c.s,lines:c.lines,docs:c.docs,parties:maData.parties,commitments:maData.commitments,
    holders:c.holders,people,printedOn:c.today,printedBy:typeof session!=='undefined'&&session?(session.name||session.u||''):''};
}
function _maPdfFile(s){return String(s).replace(/[^A-Za-z0-9_.\-]+/g,'-')+'.pdf';}
function _maPdfPrint(type,build,filename,target){
  if(typeof printDocument!=='function'){_maToast('The PDF engine is not loaded — reload the app and try again.');return false;}
  let data=null;
  try{data=build();}catch(e){_maToast('Could not put the PDF together: '+String(e&&e.message||e));return false;}
  if(!data){_maToast('There is nothing to put in that PDF.');return false;}
  _maAuditQuiet('export',target||null,'PDF · '+filename);
  let p=null;
  try{p=printDocument({type,data,filename});}catch(e){_maToast('The PDF failed: '+String(e&&e.message||e));return false;}
  if(p&&typeof p.then==='function')p.then(null,e=>_maToast('The PDF failed: '+String(e&&e.message||e)));
  return true;
}
function _maDocPdfButton(d){
  if(d.dt==='transfer')return `<button class="ma-btn" onclick="window.maDocPdf('transfer','${_maQ(d.id)}')">Receipt (PDF)</button><button class="ma-btn" onclick="window.maDocShare('transfer','${_maQ(d.id)}')">Share receipt</button>`;
  if(d.dt==='journal'&&d.kind==='money_out')return `<button class="ma-btn" onclick="window.maDocPdf('journal','${_maQ(d.id)}')">Voucher (PDF)</button><button class="ma-btn" onclick="window.maDocShare('journal','${_maQ(d.id)}')">Share voucher</button>`;
  return '';
}
window.maPdf=function(key){
  if(!maCanSee()){_maToast('Master Accounts is for Afnan and Ammar.');return false;}
  const c=_maCtx();
  const r=_maRange(c);
  const span=r.from+'_'+r.to;
  if(key==='ledger'){
    const q=_maLedgerQuery(c);
    const code=q.holder||q.account;
    if(!code){_maToast('Pick one holder or one account first — a ledger PDF is one account’s statement.');return false;}
    return _maPdfPrint('ma-ledger',()=>maPdfLedgerData(_maPdfCtx(c),Object.assign({label:r.label},q)),_maPdfFile('Ledger-'+code+'-'+span));
  }
  if(key==='holder'){
    const code=_maHolderCode;
    if(!code||!maIsMoney(c.idx,code)){_maToast('That holder is not in the chart.');return false;}
    return _maPdfPrint('ma-statement-holder',()=>maPdfHolderStatementData(_maPdfCtx(c),code,r),_maPdfFile('Holder-'+code+'-'+span));
  }
  if(key==='party'){
    const p=_maParty(_maPartyId);
    if(!p){_maToast('That party is not in the master.');return false;}
    return _maPdfPrint('ma-statement-party',()=>maPdfPartyStatementData(_maPdfCtx(c),p.id,r),_maPdfFile('Statement-'+(p.code||p.id)+'-'+span));
  }
  _maToast('This page has no PDF.');return false;
};
window.maDocPdf=function(dt,id){
  if(!maCanSee()){_maToast('Master Accounts is for Afnan and Ammar.');return false;}
  const d=_maDoc(dt,id);
  if(!d){_maToast('That document is not loaded — refresh and try again.');return false;}
  const c=_maCtx();
  const target={dt:d.dt,id:d.id,no:d.no};
  const tail=(d.no||d.id)+(d.status==='void'?'-VOID':'');
  if(d.dt==='transfer')return _maPdfPrint('ma-receipt',()=>maPdfReceiptData(_maPdfCtx(c),d),_maPdfFile('Receipt-'+tail),target);
  if(d.dt==='journal'&&d.kind==='money_out')return _maPdfPrint('ma-voucher',()=>maPdfVoucherData(_maPdfCtx(c),d),_maPdfFile('Voucher-'+tail),target);
  _maToast('Only a transfer (its receipt) or a Money out (its voucher) has a PDF of its own — print the ledger instead.');return false;
};

/* ═══ Excel — every table, the filters in the filename ═══════════════════ */
function _maXlsx(name,sheets){
  if(typeof XLSX==='undefined'||!XLSX.utils){_maToast('Excel is not available in this build.');return false;}
  const wb=XLSX.utils.book_new();
  sheets.forEach(sh=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(sh.rows),String(sh.name).slice(0,31)));
  XLSX.writeFile(wb,name.replace(/[^A-Za-z0-9_.\-]+/g,'-')+'.xlsx');
  _maAuditQuiet('export',null,name);
  return true;
}
window.maExcel=function(key){
  const c=_maCtx();const r=_maRange(c);const rng=r.from+'_to_'+r.to;
  const docRow=d=>[d.date,d.no,maDocTitle(d,c.idx),_maDocDesc(d,c),d.amount||0,d.status,maLiveFlags(d).map(x=>x.message).join('; '),d.note||'',maAttachList(d.attachments).length];
  const docHead=['Date','Number','Document','What','Amount','State','Flags','Note','Files'];
  // A Balance column only where the ledger carries one (M1.6b): not under a
  // narrowing filter, not for the drawer — and the sheet says why instead.
  const postRows=led=>{
    const bal=led.opening!==null&&led.opening!==undefined;
    const why=_maLedgerHiddenText(led);
    const head=['Date','Document','Account','Description','Cost centre','Kind','Debit','Credit'].concat(bal?['Balance']:[]);
    return [head].concat(led.rows.map(l=>[l.date,l.doc&&l.doc.no,maAccLabel(c.idx,l.account),[l.party?_maPartyName(l.party):l.payee,l.memo].filter(Boolean).join(' · '),l.costCentre||'',l.kind||'',l.dr,l.cr].concat(bal?[l.balance===undefined?'':l.balance]:[])))
      .concat(why?[[],[why.charAt(0).toUpperCase()+why.slice(1)+'.']]:[]);
  };
  if(key==='ledger'){const {led}=_maLedgerFiltered(c);const f=Object.keys(_maLF).filter(k=>_maLF[k]).map(k=>k+'-'+_maLF[k]).join('_');return _maXlsx('master-accounts_ledger_'+rng+(f?'_'+f:''),[{name:'Postings',rows:postRows(led)}]);}
  if(key==='documents'){const docs=c.docs.filter(d=>d.date>=r.from&&d.date<=r.to).sort((a,b)=>String(a.date).localeCompare(String(b.date)));return _maXlsx('master-accounts_documents_'+rng,[{name:'Documents',rows:[docHead].concat(docs.map(docRow))}]);}
  if(key==='holders'||key==='today'){
    const rows=[['Code','Holder','Balance','Waiting in','Waiting out','Can pay','Last count','Mirrored']].concat(c.holders.map(h=>[h.code,h.name,h.balance===null?'not read':h.balance,h.pendingIn,h.pendingOut,h.available===null?'':h.available,h.lastCount?h.lastCount.date:'',h.mirror||'']));
    const sheets=[{name:'Holders',rows}];
    if(key==='today')sheets.push({name:'Needs attention',rows:[['State','Sentence','Basis']].concat(_maAttention(c).map(x=>[x.state,x.sentence,x.basis]))});
    return _maXlsx('master-accounts_'+key+'_'+c.today,sheets);
  }
  if(key==='holder'){const {led}=_maHolderStatement(c,_maHolderCode);return _maXlsx('master-accounts_holder-'+_maHolderCode+'_'+rng,[{name:'Statement',rows:postRows(led)}]);}
  if(key==='parties'){const rows=[['Code','Party','Kind','Terms','Paid out this year','Received this year','Last activity']].concat(_maPartyListRows(c).map(({p,f})=>[p.code,p.name,p.kind,p.vendor&&p.vendor.terms?maTermsText(p.vendor.terms):'',f.paid,f.got,f.last]));return _maXlsx('master-accounts_parties'+(_maPartyKind!=='all'?'_'+_maPartyKind:'')+(_maPartyQ?'_q-'+_maPartyQ:''),[{name:'Parties',rows}]);}
  if(key==='party'){const p=_maParty(_maPartyId);if(!p)return;const docs=c.docs.filter(d=>d.party===p.id&&d.date>=r.from&&d.date<=r.to);const led=maLedger(c.lines,{party:p.id,from:r.from,to:r.to},c.idx);
    const card=(p.vendor&&p.vendor.rateCard||[]).map(x=>[x.item,x.unit,x.rate,x.validFrom||'',x.validTo||'']);
    return _maXlsx('master-accounts_party-'+p.code+'_'+rng,[{name:'Documents',rows:[docHead].concat(docs.map(docRow))},{name:'Ledger',rows:postRows(led)},{name:'Rate card',rows:[['Item','Unit','Rate','From','To']].concat(card)}]);}
  if(key==='commitments'){const rows=[['Commitment','Kind','Schedule','Expected','State','Due','Account','Party','Active']].concat(maData.commitments.map(x=>{const st=maCommitmentStatus(x,c.docs,c.today,c.s);return [x.name,x.kind,maCommitmentText(x),x.amountExpected||0,st.state,st.due||'',maAccLabel(c.idx,x.account),_maPartyName(x.party),x.active===false?'no':'yes'];}));return _maXlsx('master-accounts_commitments_'+c.today,[{name:'Commitments',rows}]);}
  if(key==='audit'){const rows=[['When','Who','Action','Document','Detail']].concat(maData.audit.slice().sort((a,b)=>(b.at||0)-(a.at||0)).map(x=>[new Date(x.at||0).toISOString(),_maWho(x.by),x.action,x.target&&(x.target.no||x.target.id)||'',x.detail||'']));return _maXlsx('master-accounts_audit_'+c.today,[{name:'Audit trail',rows}]);}
};

/* ═══ Files, links and the owners' copy (M1.5b, 28 Sept 2026) ════════════
   The client half of M1.5a's three functions (netlify/functions/ma-attach,
   ma-share, ma-backup; netlify/lib/ma-server.js). MASTER_ACCOUNTS_PLAN.md
   §29 (attachments), §30 (Download the books), §31 (send by link).

   THE SERVER DECIDES, the client asks. Every call carries the signed-in
   person's Firebase ID token, which the function verifies itself; nothing
   this file says about who is asking is trusted. A refusal comes back as
   {error, code} and is shown AS IT CAME — the function's own sentence,
   "sign in again" on a 401, "not set up" on a 503 not_configured — and
   Cloudinary's own refusal (its plan's size cap, say) is shown in its own
   words. No Cloudinary secret is anywhere near this file.

   A FILE IS A REFERENCE, NEVER A URL (maAttachFromUpload, js/ma-core.js).
   The upload goes STRAIGHT to Cloudinary with exactly the fields the
   function signed, and the app's shared image uploader (js/shared.js) is
   never used here: it is an unsigned upload to a public path, which is the
   thing §29 exists to stop. To look at a file, the function is asked for a link EVERY time
   and the link is opened, never kept — a private file's link dies in five
   minutes. */
const _MA_FN='/.netlify/functions/';
const _MA_SHARE_PATH='/.netlify/functions/ma-share?t=';
const _MA_UPLOAD_URL=/^https:\/\/api\.cloudinary\.com\/v1_1\/[A-Za-z0-9_-]{1,64}\/image\/upload$/;
let _maAttachSt=null;        // ma-attach `status`: {mode, missing, …} or {error} — asked once a session
let _maAttachStP=null;       // …the question in flight
let _maModeSeen=null;        // 'authenticated' | 'unsigned', from any answer that said
let _maRailAtt=null;         // the rail's uploads: {key, busy, err, note}
let _maShare=null;           // the open share panel
let _maBooksBusy=false;

function _maFnErr(status,code,message){const e=new Error(message);e.status=status;e.code=code||'';return e;}
async function _maFn(name,body){
  const u=typeof auth!=='undefined'&&auth?auth.currentUser:null;
  if(!u||typeof u.getIdToken!=='function')throw _maFnErr(401,'auth','Sign in again — you are signed out.');
  let token='';
  try{token=await u.getIdToken();}catch(e){throw _maFnErr(401,'auth','Sign in again — your sign-in could not be renewed.');}
  let r;
  try{r=await fetch(_MA_FN+name,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body||{})});}
  catch(e){throw _maFnErr(0,'network','Could not reach the server — check the connection and try again.');}
  let d=null;try{d=await r.json();}catch(_){d=null;}
  if(r.ok&&d&&typeof d==='object'&&!d.error)return d;
  const code=d&&typeof d.code==='string'?d.code:'';
  let msg=d&&typeof d.error==='string'&&d.error.trim()?d.error.trim():'';
  if(r.status===401)msg=msg&&/sign in/i.test(msg)?msg:'Sign in again — the server could not check who you are.';
  else if(code==='not_configured')msg=msg||'The server is not set up for this yet.';
  else if(!msg)msg=r.status===404?'The '+name+' function is not deployed here (HTTP 404).':'The server answered HTTP '+r.status+' and said nothing more.';
  // The refusal's own body rides on the error (M1.6c): ma-attach's `status`
  // answers 503 with the whole status in it — `state` included — and only
  // that tells "attachments are switched off" from "the server is not set up
  // at all", which carries the same code.
  throw Object.assign(_maFnErr(r.status,code||(r.status===401?'auth':''),msg),{body:d&&typeof d==='object'?d:null});
}
function _maNoteMode(m){if(m==='authenticated'||m==='unsigned')_maModeSeen=m;}
function _maMode(){return (_maAttachSt&&_maAttachSt.mode)||_maModeSeen;}

/* The file goes to Cloudinary with every field the function signed and
   nothing else — Cloudinary refuses a signed upload whose parameters were
   changed — plus the file itself. */
async function _maCloudUpload(signed,file,name){
  if(typeof FormData==='undefined')throw new Error('This browser cannot upload files.');
  if(!signed||!_MA_UPLOAD_URL.test(String(signed.uploadUrl||''))||!signed.fields||typeof signed.fields!=='object')
    throw new Error('The server did not give a Cloudinary upload address — nothing was sent.');
  const fd=new FormData();
  Object.keys(signed.fields).forEach(k=>fd.append(k,String(signed.fields[k])));
  fd.append('file',file,name||signed.name||'file');
  let r;
  try{r=await fetch(signed.uploadUrl,{method:'POST',body:fd});}
  catch(e){throw new Error('Could not reach Cloudinary — check the connection and try again.');}
  let d=null;try{d=await r.json();}catch(_){d=null;}
  if(!r.ok||!d||d.error)throw new Error('Cloudinary refused the file: '+(d&&d.error&&d.error.message?String(d.error.message):'it answered HTTP '+r.status));
  return d;
}
/* sign → upload → the stored reference. */
async function _maUploadFile(file,nameOverride){
  const name=String(nameOverride||(file&&file.name)||'file');
  const signed=await _maFn('ma-attach',{action:'sign',file:{name,type:String(file&&file.type||''),size:file&&file.size}});
  _maNoteMode(signed.mode);
  const res=await _maCloudUpload(signed,file,signed.name||name);
  const out=maAttachFromUpload(signed,res,{by:session.u,at:Date.now()});
  if(out.error)throw new Error(out.error);
  return out.att;
}
function _maBytes(n){return !Number.isFinite(n)?'':n<1024?n+' B':n<1048576?Math.round(n/1024)+' KB':(n/1048576).toFixed(1)+' MB';}
function _maAttMeta(a){
  return [a.format==='pdf'?'PDF':String(a.format||'').toUpperCase(),_maBytes(a.bytes),a.by?_maWho(a.by):'',a.at?_maWhen(a.at):''].filter(Boolean).join(' · ');
}
const _MA_PUBLIC_NOTE='This file is public in this setup: anyone who has its address can open it. The address is long and random — see Close & audit → Settings.';
function _maAttListHTML(list,where,removable){
  if(!list.length)return '';
  return `<ul class="ma-att-list">${list.map((a,i)=>`<li class="ma-att-item"><span class="ma-att-name">${_maE(a.name)}</span><span class="ma-att-meta">${_maE(_maAttMeta(a))}</span>
    <span class="ma-att-acts"><button type="button" class="ma-link" onclick="window.maAttachView('${where}',${i})">View</button>${removable
      ?`<button type="button" class="ma-link" onclick="window.maAttachDrop(${i})">Remove</button>`
      :`<button type="button" class="ma-link" onclick="window.maAttachView('${where}',${i},true)">Download</button>`}</span></li>`).join('')}</ul>`;
}
// Two pickers: a camera (capture) input cannot pick a PDF, so the second
// takes a photo or a PDF from the device (the warehouse-sales pattern).
function _maAttPickHTML(where,st){
  st=st||{};
  return `<div class="ma-att-pick">
      <label class="ma-btn sm" for="ma-att-cam-${where}">Take a photo</label><input id="ma-att-cam-${where}" type="file" accept="image/*" capture="environment" hidden onchange="window.maAttachPicked(this,'${where}')">
      <label class="ma-btn sm" for="ma-att-file-${where}">Choose a photo or PDF</label><input id="ma-att-file-${where}" type="file" accept="image/*,application/pdf,.pdf" multiple hidden onchange="window.maAttachPicked(this,'${where}')">
    </div>${st.busy?`<div class="ma-att-st" role="status">Uploading ${st.busy} file${st.busy>1?'s':''}…</div>`:''}${st.err?`<div class="ma-err" role="alert">${_maE(st.err)}</div>`:''}${st.note?`<div class="ma-hint ma-block">${_maE(st.note)}</div>`:''}`;
}

/* ── On the form: files ride in with the document ─────────────────────── */
function _maAttFieldHTML(){
  return `<div class="ma-field" id="ma-w-attachments"><span class="ma-lbl">Bill or receipt</span><div id="ma-f-att">${_maAttFormInner()}</div><span class="ma-ferr" id="ma-e-attachments"></span></div>`;
}
function _maAttFormInner(){
  const f=_maF;if(!f)return '';
  return _maAttListHTML(f.atts||[],'form',true)+_maAttPickHTML('form',{busy:f.attBusy,err:f.attErr,note:f.attNote});
}
function _maPaintFormAtt(){const el=document.getElementById('ma-f-att');if(el)el.innerHTML=_maAttFormInner();}
window.maAttachPicked=async function(inp,where){
  const files=inp&&inp.files?Array.prototype.slice.call(inp.files):[];
  try{inp.value='';}catch(_){}
  if(!files.length||!maCanSee())return false;
  if(where==='rail')return _maRailAttach(files);
  const f=_maF;
  if(!f||!_MA_KIND_DT[f.kind])return false;
  if((f.atts||[]).length+f.attBusy+files.length>MA_ATTACH_MAX){f.attErr='A document carries at most '+MA_ATTACH_MAX+' files.';_maPaintFormAtt();return false;}
  if(!_maOnline()){f.attErr='Uploading needs a connection — nothing was sent.';_maPaintFormAtt();return false;}
  f.attErr='';f.attBusy+=files.length;_maPaintFormAtt();
  const errs=[];
  for(const file of files){
    try{const a=await _maUploadFile(file);f.atts.push(a);}
    catch(e){errs.push((file&&file.name?file.name+' did not upload: ':'')+String(e&&e.message||e));}
    f.attBusy--;
    if(_maF===f)_maPaintFormAtt();
  }
  f.attErr=errs.join(' · ');
  f.attNote=_maMode()==='unsigned'&&f.atts.length?_MA_PUBLIC_NOTE:'';
  if(_maF===f){_maPaintFormAtt();window.maFormDirty();}
  return !errs.length;
};
// Taking a file off the form before it is saved (or, in an edit, off the
// document — the edit then names `attachments` and carries its reason).
// The file itself stays in Cloudinary; the edit history keeps the reference.
window.maAttachDrop=function(i){
  const f=_maF;if(!f||!f.atts||!f.atts[i])return;
  f.atts.splice(i,1);f.attNote='';_maPaintFormAtt();window.maFormDirty();
};

/* ── On the rail: a file added after the document was recorded ──────────
   An EDIT, like every other change to a posted document (§31, the rules'
   maEditOk): rev + 1 and one edits[] row by the caller naming exactly
   `attachments`. The reason is what happened ("Attached bill.jpg") — a
   file changes no figure, so neither the stored flags nor the review move
   (a form edit stores its own flags; this is not one); "no bill attached"
   leaves the review queue because maLiveFlags sees the file, not because
   anything was rewritten. */
function _maDocKey(d){return d.dt+'/'+d.id;}
function _maRailAttInner(d){
  const st=_maRailAtt&&_maRailAtt.key===_maDocKey(d)?_maRailAtt:{busy:0,err:'',note:''};
  const list=maAttachList(d.attachments);
  const blocked=maAttachIssues(d,{settings:_maCtx().s,closes:maData.closes,adding:0}).filter(x=>x.rule==='attach.void'||x.rule==='attach.closed');
  return (list.length?_maAttListHTML(list,'rail',false):'<div class="ma-empty">No file attached.</div>')
    +(blocked.length?`<div class="ma-hint ma-block">${_maE(blocked[0].message)}</div>`:_maAttPickHTML('rail',st));
}
function _maPaintRailAtt(){
  const r=_maRail;const d=r&&r.kind==='doc'?_maDoc(r.dt,r.id):null;
  const el=document.getElementById('ma-rail-att');if(el&&d)el.innerHTML=_maRailAttInner(d);
}
async function _maRailAttach(files){
  const r=_maRail;const d=r&&r.kind==='doc'?_maDoc(r.dt,r.id):null;
  if(!d)return false;
  const key=_maDocKey(d);
  const st=_maRailAtt=_maRailAtt&&_maRailAtt.key===key?_maRailAtt:{key,busy:0,err:'',note:''};
  const c=_maCtx();
  const iss=maAttachIssues(d,{settings:c.s,closes:maData.closes,adding:files.length}).filter(x=>x.level==='refuse');
  if(iss.length){st.err=iss[0].message;_maPaintRailAtt();return false;}
  if(!_maOnline()){st.err='Attaching needs a connection — nothing was sent.';_maPaintRailAtt();return false;}
  if(_maBusy||st.busy){st.err='Another save is still running — try again in a moment.';_maPaintRailAtt();return false;}
  st.err='';st.note='';st.busy=files.length;_maPaintRailAtt();
  const added=[],errs=[];
  for(const file of files){
    try{added.push(await _maUploadFile(file));}
    catch(e){errs.push((file&&file.name?file.name+': ':'')+String(e&&e.message||e));}
    st.busy--;_maPaintRailAtt();
  }
  if(!added.length){st.err=errs.join(' · ');_maPaintRailAtt();return false;}
  const cur=_maDoc(d.dt,d.id)||d;
  const reason='Attached '+added.map(a=>a.name).join(', ');
  const after=Object.assign({},_maClean(cur),{attachments:maAttachList(cur.attachments).concat(added)});
  let edited=maApplyEdit(cur,after,Object.assign(_maMeta(),{reason}));
  if(!edited){st.err='Nothing changed.';_maPaintRailAtt();return false;}
  edited=_maEditShape(cur,edited);
  _maBusy=true;
  try{
    await _maWriteEdit(cur,edited,reason,'attach');
    const k=_MA_DOC_KEY[cur.dt];const i=maData[k].findIndex(x=>x.id===cur.id);if(i>=0)maData[k][i]=edited;
    st.err=errs.length?'Not attached: '+errs.join(' · '):'';
    st.note=_maMode()==='unsigned'?_MA_PUBLIC_NOTE:'';
    _maInvalidate();
    _maToast(cur.no+': '+added.length+' file'+(added.length>1?'s':'')+' attached — revision '+maRevOf(edited)+'.');
    _maPaint();
    return !errs.length;
  }catch(e){
    st.err=(added.length>1?'The files are':'The file is')+' uploaded but not on '+cur.no+': '+_maWriteError(e);
    _maPaintRailAtt();return false;
  }finally{_maBusy=false;}
}

/* ── Looking at a file: a fresh link every time ─────────────────────────
   The tab is opened INSIDE the click (a browser blocks one opened after an
   await) and pointed at the link when it arrives. The link is never kept:
   a private one is dead in five minutes, and asking again is how you look
   again. */
window.maAttachView=function(where,i,download){
  let a=null;
  if(where==='form')a=_maF&&_maF.atts?_maF.atts[i]:null;
  else if(where==='rail'){const r=_maRail;const d=r&&r.kind==='doc'?_maDoc(r.dt,r.id):null;a=d?maAttachList(d.attachments)[i]:null;}
  if(!a||!maAttachOk(a)){_maToast('That file is not on this document any more.');return Promise.resolve(false);}
  return _maAttachOpen(a,!!download);
};
async function _maAttachOpen(a,download){
  let w=null;
  try{w=window.open('','_blank');}catch(_){w=null;}
  if(w){try{w.opener=null;}catch(_){}try{w.document.title='Opening…';w.document.body.textContent='Opening the file…';}catch(_){}}
  try{
    const r=await _maFn('ma-attach',{action:'url',file:maAttachRef(a),download:!!download});
    const url=r&&typeof r.url==='string'?r.url:'';
    if(!/^https:\/\/(api|res)\.cloudinary\.com\//.test(url))throw new Error('The server did not give back a link to the file.');
    if(w&&!w.closed){w.location.href=url;return true;}
    _maToast('Your browser blocked the new tab — allow pop-ups for this site, then press '+(download?'Download':'View')+' again.');
    return false;
  }catch(e){
    if(w){try{w.close();}catch(_){}}
    _maToast('Could not open '+(a.name||'the file')+': '+String(e&&e.message||e));
    return false;
  }
}

/* ── Which mode is in force (§29) ───────────────────────────────────────
   Private (the server holds the Cloudinary key) or the public fallback.
   Asked of the server, never assumed, once a session; Settings says it. */
async function _maAttachStatusLoad(force){
  if(_maAttachStP)return _maAttachStP;
  if(_maAttachSt&&!force)return _maAttachSt;
  _maAttachStP=(async()=>{
    try{
      const d=await _maFn('ma-attach',{action:'status'});
      if(d.mode!=='authenticated'&&d.mode!=='unsigned')throw new Error('The server gave an answer this page does not understand.');
      _maAttachSt=d;_maNoteMode(d.mode);
    }catch(e){_maAttachSt={error:String(e&&e.message||e),code:e&&e.code||'',
      state:e&&e.body&&typeof e.body.state==='string'?e.body.state:null};}
    _maAttachStP=null;
    const el=document.getElementById('ma-att-mode');if(el)el.innerHTML=_maAttachModeHTML();
    const sn=document.getElementById('ma-sh-mode');if(sn)sn.innerHTML=_maShareModeHTML();
    return _maAttachSt;
  })();
  return _maAttachStP;
}
window.maAttachStatusCheck=function(){_maAttachSt=null;const el=document.getElementById('ma-att-mode');if(el)el.innerHTML=_maAttachModeHTML();return _maAttachStatusLoad(true);};
function _maAttachModeHTML(){
  const st=_maAttachSt;
  if(!st)return '<div class="ma-muted">Asking the server which mode is in force…</div>';
  // Switched off (M1.6c): no Cloudinary key and no public opt-in. Keyed on
  // the status body's `state`, NEVER on `code` — the generic 503 a server
  // sends before it knows who is asking carries code 'not_configured' too,
  // and that one is a server that cannot start, not attachments turned off.
  if(st.error&&st.state==='not_configured')return `<div class="ma-errcard" role="alert"><b>Attachments are off — not set up.</b> ${_maE(st.error)}<div class="ma-errcard-acts"><button class="ma-btn sm" onclick="window.maAttachStatusCheck()">Check again</button></div></div>`;
  if(st.error)return `<div class="ma-errcard" role="alert"><b>Could not ask the attachment server.</b> ${_maE(st.error)}<div class="ma-errcard-acts"><button class="ma-btn sm" onclick="window.maAttachStatusCheck()">Check again</button></div></div>`;
  const mins=Number.isFinite(st.urlSeconds)?Math.round(st.urlSeconds/60):5;
  const mb=Number.isFinite(st.maxBytes)?Math.round(st.maxBytes/1048576):25;
  const size=`<dt>Largest file</dt><dd>${mb} MB here — the Cloudinary account’s own plan may allow less, and when it refuses a file its words are shown as they come.</dd>`;
  if(st.mode==='authenticated')return `<dl class="ma-dl"><dt>Mode</dt><dd><span class="ma-word fine">private</span></dd>
    <dt>Files</dt><dd>Bills, receipts and shared PDFs are private Cloudinary files. Every look opens a link that stops working after ${mins} minutes.</dd>
    <dt>Share links</dt><dd>A link stops at its expiry, or at once when it is withdrawn. A PDF somebody already downloaded stays with them — nothing can recall a copy.</dd>${size}</dl>
    <div class="ma-sec-foot"><button class="ma-link" onclick="window.maAttachStatusCheck()">Check again</button></div>`;
  const names=k=>(Array.isArray(st[k])?st[k]:[]).filter(x=>typeof x==='string'&&x);
  const miss=names('missing'),inv=names('invalid');
  // Public only on purpose since M1.6c: the server takes the fallback only
  // when MA_ALLOW_PUBLIC_ATTACH is exactly 1 (its `note` says the same).
  const why=(miss.length?', and '+_maE(miss.join(' and '))+(miss.length>1?' are':' is')+' not set there':'')
    +(inv.length?', and '+_maE(inv.join(' and '))+(inv.length>1?' hold':' holds')+' a space or a line break, so '+(inv.length>1?'they are not keys':'it is not a key'):'');
  return `<div class="ma-note"><b>Public — on purpose.</b> MA_ALLOW_PUBLIC_ATTACH is set to 1 in Netlify${why}, so files go up through the app’s unsigned preset and are PUBLIC: each sits at a permanent address that is long and random, so nobody can guess it — but anyone who has it can open the file, for good. Withdrawing or expiring a share link only stops OUR link; it cannot recall the file’s own address, or a copy someone already has. Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Netlify to make new files private (files already uploaded stay public).</div>
    <dl class="ma-dl"><dt>Mode</dt><dd><span class="ma-word warn">public</span></dd>${size}</dl>
    <div class="ma-sec-foot"><button class="ma-link" onclick="window.maAttachStatusCheck()">Check again</button></div>`;
}

/* ── Send by link (§31) ─────────────────────────────────────────────────
   Share makes the PDF in the browser (printDocument deliver:'blob' — no
   tab, no download), uploads it through ma-attach like any file, and asks
   ma-share for a link: a 32-byte token the function mints, served only
   while it is live. The link is this site's own origin + the path the
   function hands back — no host is written here. Withdraw goes THROUGH the
   function too, so its audit row is written in the same batch. */
function _maShareSpec(kind,id){
  const c=_maCtx();const r=_maRange(c);const span=r.from+'_'+r.to;
  const x=()=>_maPdfCtx(c);
  if(kind==='transfer'||kind==='journal'){
    const d=_maDoc(kind,id);
    if(!d)return {error:'That document is not loaded — refresh and try again.'};
    const tail=(d.no||d.id)+(d.status==='void'?'-VOID':'');
    // The revision the PDF was made at rides in the link's document number
    // (the ma-share function keeps `no`, 60 characters): the list can then
    // say when the document changed after the link was made (money M3).
    // `rev` is sent as well, for a server that keeps it (M1.6c).
    const rev=maRevOf(d),no=d.no+' · rev '+rev;
    if(kind==='transfer')return {type:'ma-receipt',what:'Receipt '+d.no,filename:_maPdfFile('Receipt-'+tail),build:()=>maPdfReceiptData(x(),d),
      subject:{type:'transfer',id:d.id,no,rev},to:null,listOf:'this document'};
    if(d.kind!=='money_out')return {error:'Only a transfer (its receipt) or a Money out (its voucher) has a PDF of its own — share the ledger instead.'};
    const p=d.party?_maParty(d.party):null;
    return {type:'ma-voucher',what:'Voucher '+d.no,filename:_maPdfFile('Voucher-'+tail),build:()=>maPdfVoucherData(x(),d),
      subject:{type:'journal',id:d.id,no,rev},to:{party:p?p.name:(d.payee||''),phone:p&&p.contact?p.contact.phone||'':''},listOf:'this document'};
  }
  if(kind==='ledger'){
    const q=_maLedgerQuery(c);const code=q.holder||q.account;
    if(!code)return {error:'Pick one holder or one account first — a ledger PDF is one account’s statement.'};
    return {type:'ma-ledger',what:'Ledger '+code+' · '+r.label,filename:_maPdfFile('Ledger-'+code+'-'+span),build:()=>maPdfLedgerData(x(),Object.assign({label:r.label},q)),
      subject:{type:'ledger',id:String(code),no:'Ledger '+code+' · '+r.label},to:null,listOf:'this account’s ledgers'};
  }
  if(kind==='holder'){
    const code=_maHolderCode;
    if(!code||!maIsMoney(c.idx,code))return {error:'That holder is not in the chart.'};
    return {type:'ma-statement-holder',what:_maAccName(c,code)+' · '+r.label,filename:_maPdfFile('Holder-'+code+'-'+span),build:()=>maPdfHolderStatementData(x(),code,r),
      subject:{type:'holder',id:String(code),no:'Holder '+code+' · '+r.label},to:null,listOf:'this holder’s statements'};
  }
  if(kind==='party'){
    const p=_maParty(_maPartyId);
    if(!p)return {error:'That party is not in the master.'};
    return {type:'ma-statement-party',what:'Statement · '+p.name+' · '+r.label,filename:_maPdfFile('Statement-'+(p.code||p.id)+'-'+span),build:()=>maPdfPartyStatementData(x(),p.id,r),
      subject:{type:'party',id:String(p.id),no:'Statement '+(p.code||'')+' · '+r.label},to:{party:p.name,phone:p.contact&&p.contact.phone||''},listOf:'this party’s statements'};
  }
  return {error:'This page has nothing to share.'};
}
function _maShareLink(token){return location.origin+_MA_SHARE_PATH+String(token);}
function _maShareText(title,link,expiresAt){
  return 'GROOVY — '+String(title||'a document')+'\n'+link+(Number.isFinite(expiresAt)?'\nThe link works until '+_maWhen(expiresAt)+'.':'');
}
function _maShareOpen(kind,id){
  if(!maCanSee()){_maToast('Master Accounts is for Afnan and Ammar.');return false;}
  const sp=_maShareSpec(kind,id);
  if(!sp||sp.error){_maToast(sp&&sp.error||'There is nothing to share here.');return false;}
  _maF=null;
  _maShare={spec:sp,busy:false,step:'',err:'',made:null,list:{state:'loading',rows:[],err:''}};
  _maModal('Share · '+sp.what,_maShareBodyHTML(),`<button class="ma-btn" onclick="window.maCloseModal()">Close</button><button class="ma-btn primary" id="ma-sh-go" onclick="window.maShareMake()">Make a link</button>`);
  _maShareListLoad();
  if(!_maAttachSt&&!_maAttachStP)_maAttachStatusLoad();
  return true;
}
window.maShare=function(key){return _maShareOpen(key,null);};
window.maDocShare=function(dt,id){return _maShareOpen(dt,id);};
function _maShareModeHTML(){
  const m=_maMode();
  if(m==='unsigned')return '<div class="ma-note"><b>Files are public in this setup.</b> The PDF itself sits at a permanent address that is long and random. Withdrawing or expiring the link stops our link only — it cannot recall that address, or a copy someone already has.</div>';
  if(m==='authenticated')return '<div class="ma-hint ma-block">The PDF is stored privately. Withdrawing the link stops it at once; a copy somebody already downloaded stays with them.</div>';
  return '';
}
function _maShareBodyHTML(){
  const sh=_maShare;if(!sh)return '';
  const sp=sh.spec,s=_maCtx().s,to=sp.to||{};
  return `<div class="ma-share">
    <p class="ma-hint ma-block">A link to this PDF that opens without signing in — for the days below, or until it is withdrawn.</p>
    <div id="ma-sh-mode">${_maShareModeHTML()}</div>
    <div class="ma-grid3">${_maFld('shfor','For',_maIn('shfor',to.party||'',{ph:'optional'}))}
      ${_maFld('shphone','WhatsApp number',_maIn('shphone',to.phone||'',{type:'tel',ph:'0300 1234567'}))}
      ${_maFld('shdays','Days it works',_maIn('shdays',s.share.defaultDays,{num:true}))}</div>
    <div class="ma-err" id="ma-sh-err" role="alert">${_maE(sh.err)}</div>
    <div id="ma-sh-made">${_maShareMadeHTML()}</div>
    <h3 class="ma-sec-title ma-sh-h">Links to ${_maE(sp.listOf)}</h3>
    <div id="ma-sh-list">${_maShareListHTML()}</div>
  </div>`;
}
function _maShareActsHTML(key,title,link,phone,expiresAt,withdraw){
  const text=_maShareText(title,link,expiresAt);
  const mail='mailto:?subject='+encodeURIComponent('GROOVY — '+String(title||'a document'))+'&body='+encodeURIComponent(text);
  return `<div class="ma-sh-acts"><button type="button" class="ma-btn sm" onclick="window.maShareCopy('${_maQ(key)}')">Copy link</button><a class="ma-btn sm" href="${_maE(maWaLink(phone,text))}" target="_blank" rel="noopener noreferrer">WhatsApp</a><a class="ma-btn sm" href="${_maE(mail)}">Email</a>${withdraw?`<button type="button" class="ma-btn sm danger" onclick="window.maShareRevoke('${_maQ(key)}')">Withdraw</button>`:''}</div>`;
}
function _maShareMadeHTML(){
  const sh=_maShare;if(!sh)return '';
  if(sh.busy)return `<div class="ma-att-st" role="status">${_maE(sh.step||'Working…')}</div>`;
  const m=sh.made;if(!m)return '';
  const row=sh.list.rows.find(x=>x.token===m.token);
  if(row&&maShareState(row,Date.now())==='revoked')return '<div class="ma-hint ma-block">The link just made has been withdrawn.</div>';
  return `<div class="ma-sh-made"><span class="ma-lbl">The link — it works until ${_maE(_maWhen(m.expiresAt))}</span>
    <input class="ma-in ma-sh-url" id="ma-sh-url" readonly value="${_maE(m.link)}" aria-label="The link" onfocus="this.select()">
    ${_maShareActsHTML('new',sh.spec.what,m.link,m.to&&m.to.phone,m.expiresAt,false)}</div>`;
}
async function _maShareListLoad(){
  const sh=_maShare;if(!sh)return;
  sh.list={state:'loading',rows:sh.list.rows||[],err:''};_maSharePaint('list');
  try{
    // One field, one clause: the rules let an owner read every ma_shares
    // document, so this is provable; the kind is filtered here.
    const snap=await getDocs(query(collection(db,'ma_shares'),where('docId','==',sh.spec.subject.id)));
    if(_maShare!==sh)return;
    const got=((snap&&snap.docs)||[]).map(d=>Object.assign({},typeof d.data==='function'?d.data():{},{token:d.id}))
      .filter(x=>x.docKind===sh.spec.subject.type);
    const mine=sh.list.rows.filter(r=>!got.some(g=>g.token===r.token));   // one made while the read ran
    sh.list.rows=mine.concat(got).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    sh.list.state='ok';
  }catch(e){
    if(_maShare!==sh)return;
    sh.list.state='error';sh.list.err=String(e&&e.message||e);
  }
  _maSharePaint('list');
}
window.maShareListRetry=function(){return _maShareListLoad();};
function _maShareListHTML(){
  const sh=_maShare;if(!sh)return '';
  const L=sh.list;
  if(L.state==='loading')return '<div class="ma-muted">Reading the links…</div>';
  if(L.state==='error')return `<div class="ma-errcard" role="alert"><b>Could not read ma_shares.</b> ${_maE(L.err)} The links made before are not listed — that does not mean there are none.<div class="ma-errcard-acts"><button class="ma-btn sm" onclick="window.maShareListRetry()">Retry</button></div></div>`;
  if(!L.rows.length)return _maEmpty('No links yet.');
  const now=Date.now();
  return `<ul class="ma-sh-list">${L.rows.map(x=>_maShareItemHTML(x,now)).join('')}</ul>`;
}
const _MA_SHARE_WORD={live:['fine','live'],expired:['mute','expired'],revoked:['urgent','withdrawn'],unknown:['warn','not valid']};
/* The revision a link's PDF was made at: the server's own field when it
   keeps one, else the " · rev N" its document number carries, else — a link
   made before either — the edits dated before it. */
function _maShareRevAt(x,d){
  if(Number.isInteger(x.docRev)&&x.docRev>0)return x.docRev;
  const m=/ · rev (\d+)$/.exec(String(x.docNo||''));
  if(m)return Number(m[1]);
  return 1+((d&&d.edits)||[]).filter(e=>e&&Number.isFinite(e.at)&&Number.isFinite(x.createdAt)&&e.at<=x.createdAt).length;
}
/* A live link whose document moved on since: its PDF is the old one. */
function _maShareStaleHTML(x,st){
  const sub=_maShare&&_maShare.spec&&_maShare.spec.subject;
  if(st!=='live'||!sub||(sub.type!=='journal'&&sub.type!=='transfer'))return '';
  const d=_maDoc(sub.type,sub.id);if(!d)return '';
  const at=_maShareRevAt(x,d),cur=maRevOf(d);
  if(d.status==='void')return `<div class="ma-sh-meta"><span class="ma-dot urgent"></span> Made at rev ${at} — the document has been voided since. Withdraw the link.</div>`;
  if(cur>at)return `<div class="ma-sh-meta"><span class="ma-dot warn"></span> Made at rev ${at} — the document has changed since (it is at rev ${cur} now). The link still serves the old PDF.</div>`;
  return '';
}
function _maShareItemHTML(x,now){
  const st=maShareState(x,now);
  const w=_MA_SHARE_WORD[st];
  const to=x.to&&typeof x.to==='object'?[x.to.party,x.to.phone].filter(v=>typeof v==='string'&&v).join(' · '):'';
  const opens=Number.isFinite(x.opens)?x.opens:0,prev=Number.isFinite(x.previews)?x.previews:0;
  const lines=['Made by '+_maWho(x.createdBy)+' · '+_maWhen(x.createdAt)+(to?' · for '+to:''),
    st==='revoked'?'Withdrawn by '+_maWho(x.revokedBy)+' · '+_maWhen(x.revokedAt)
      :st==='expired'?'Expired '+_maWhen(x.expiresAt)
      :st==='unknown'?'This record is not one the share server made — the link does not open.'
      :'Works until '+_maWhen(x.expiresAt),
    'Opened '+opens+' time'+(opens===1?'':'s')+(x.lastOpenedAt?' · last '+_maWhen(x.lastOpenedAt):'')+(prev?' · '+prev+' link preview'+(prev===1?'':'s')+(x.lastPreviewAt?', last '+_maWhen(x.lastPreviewAt):''):'')];
  return `<li class="ma-sh-item"><div class="ma-sh-top"><span class="ma-sh-file">${_maE(x.filename||x.docNo||'PDF')}</span><span class="ma-word ${w[0]}">${w[1]}</span></div>
    ${lines.map(l=>`<div class="ma-sh-meta">${_maE(l)}</div>`).join('')}${_maShareStaleHTML(x,st)}
    ${st==='live'?_maShareActsHTML(x.token,x.docNo||x.filename,_maShareLink(x.token),x.to&&x.to.phone,x.expiresAt,true):''}</li>`;
}
function _maSharePaint(part){
  const sh=_maShare;if(!sh)return;
  const set=(id,h)=>{const el=document.getElementById(id);if(el)el.innerHTML=h;};
  if(!part||part==='made')set('ma-sh-made',_maShareMadeHTML());
  if(!part||part==='list')set('ma-sh-list',_maShareListHTML());
  if(!part){const e=document.getElementById('ma-sh-err');if(e)e.textContent=sh.err||'';}
}
window.maShareMake=async function(){
  const sh=_maShare;if(!sh||sh.busy)return false;
  const sp=sh.spec;
  const fail=m=>{sh.err=m;_maSharePaint();return false;};
  const days=Number(_maVal('ma-f-shdays').trim());
  if(!Number.isInteger(days)||days<1||days>90)return fail('A link works for a whole number of days, 1 to 90.');
  const forName=_maVal('ma-f-shfor').trim().slice(0,80),rawPhone=_maVal('ma-f-shphone').trim();
  const wa=maWaPhone(rawPhone);
  if(rawPhone&&!wa)return fail('That WhatsApp number could not be read — write it like 0300 1234567 or +92 300 1234567, or leave it empty.');
  if(typeof printDocument!=='function')return fail('The PDF engine is not loaded — reload the app and try again.');
  if(!_maOnline())return fail('Making a link needs a connection — nothing was sent.');
  const to=forName||wa?{party:forName||null,phone:wa?'+'+wa:null}:null;
  sh.busy=true;sh.err='';sh.made=null;
  const btn=document.getElementById('ma-sh-go');if(btn)btn.disabled=true;
  const step=t=>{sh.step=t;if(_maShare===sh)_maSharePaint();};
  try{
    step('Making the PDF…');
    let data;
    try{data=sp.build();}catch(e){throw new Error('The PDF could not be put together: '+String(e&&e.message||e));}
    if(!data)throw new Error('There is nothing to put in that PDF.');
    let pdf;
    try{pdf=await printDocument({type:sp.type,data,filename:sp.filename,deliver:'blob'});}
    catch(e){throw new Error('The PDF could not be made: '+String(e&&e.message||e));}
    if(!pdf||!pdf.blob||!(pdf.blob.size>0))throw new Error('The PDF came back empty.');
    const filename=pdf.filename||sp.filename;
    step('Uploading the PDF…');
    const signed=await _maFn('ma-attach',{action:'sign',file:{name:filename,type:'application/pdf',size:pdf.blob.size}});
    _maNoteMode(signed.mode);
    const res=await _maCloudUpload(signed,pdf.blob,signed.name||filename);
    const up=maAttachFromUpload(signed,res,{by:session.u,at:Date.now()});
    if(up.error)throw new Error(up.error);
    step('Saving the link…');
    const made=await _maFn('ma-share',{action:'create',subject:sp.subject,file:maAttachRef(up.att),filename,days,to});
    if(typeof made.path!=='string'||made.path.indexOf(_MA_SHARE_PATH)!==0)throw new Error('The server did not give back a link.');
    sh.made={token:made.token,link:location.origin+made.path,expiresAt:made.expiresAt,to};
    sh.list.rows=[Object.assign({},made.share||{},{token:made.token})].concat(sh.list.rows.filter(x=>x.token!==made.token));
    if(sh.list.state==='loading')sh.list.state='ok';
  }catch(e){sh.err=String(e&&e.message||e);}
  finally{sh.busy=false;sh.step='';if(btn)btn.disabled=false;}
  if(_maShare===sh)_maSharePaint();
  return !!sh.made;
};
window.maShareCopy=async function(key){
  const sh=_maShare;
  const link=key==='new'?(sh&&sh.made?sh.made.link:''):_maShareLink(key);
  if(!link)return false;
  try{await navigator.clipboard.writeText(link);_maToast('Link copied.');return true;}
  catch(_){
    try{const inp=key==='new'?document.getElementById('ma-sh-url'):null;if(inp&&inp.select){inp.select();if(document.execCommand&&document.execCommand('copy')){_maToast('Link copied.');return true;}}}catch(_e){}
    _maToast('Copy did not work here — select the link and copy it.');return false;
  }
};
window.maShareRevoke=async function(token){
  const sh=_maShare;if(!sh)return false;
  const x=sh.list.rows.find(r=>r.token===token);if(!x)return false;
  if(!confirm('Withdraw the link to '+(x.filename||'this PDF')+'?\n\nAnyone who opens it from now on is told it was withdrawn. A copy somebody already downloaded stays with them.'))return false;
  if(!_maOnline()){_maToast('Withdrawing a link needs a connection.');return false;}
  try{
    const r=await _maFn('ma-share',{action:'revoke',token});
    Object.assign(x,{revoked:true,revokedAt:r.revokedAt||Date.now(),revokedBy:r.revokedBy||session.u});
    _maToast(r.already?'That link was already withdrawn.':'Link withdrawn.');
  }catch(e){_maToast('The link was not withdrawn: '+String(e&&e.message||e));return false;}
  if(_maShare===sh)_maSharePaint();
  return true;
};

/* ── Download the books (§30, layer 3) ──────────────────────────────────
   Every ma_* collection, read fresh and whole (the page's own copy stops at
   300 audit rows). Each collection settles on its own: one refused read is
   named in both files and the rest still download — never an empty list
   for a collection nobody could read (maBooksJson / maBooksSheets decide
   what the files say). Recorded as an `export` in the audit trail. */
function _maSaveFile(name,text,type){
  try{
    const blob=new Blob([text],{type});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;
    document.body.appendChild(a);a.click();if(a.remove)a.remove();
    setTimeout(()=>{try{URL.revokeObjectURL(url);}catch(_){}},60000);
    return true;
  }catch(e){return false;}
}
window.maDownloadBooks=async function(){
  if(!maCanSee()){_maToast('Master Accounts is for Afnan and Ammar.');return false;}
  if(_maBooksBusy)return false;
  _maBooksBusy=true;
  const say=m=>{const el=document.getElementById('ma-books-st');if(el)el.textContent=m;};
  const btn=document.getElementById('ma-books-btn');if(btn)btn.disabled=true;
  say('Reading every collection…');
  try{
    const res=await Promise.allSettled(MA_BOOK_COLS.map(c=>Promise.resolve().then(()=>getDocs(collection(db,c)))));
    const cols={},failed=[];
    res.forEach((r,i)=>{
      const c=MA_BOOK_COLS[i];
      if(r.status==='fulfilled')cols[c]=((r.value&&r.value.docs)||[]).map(d=>({id:d.id,data:_maClean(typeof d.data==='function'?d.data():{})}));
      else{const e=r.reason||{};failed.push({col:c,message:String(e.message||e||'failed')+(e.code?' ('+e.code+')':'')});}
    });
    const at=Date.now(),t=new Date(at);
    const name='groovy-books_'+maDay(t)+'_'+maPad(t.getHours())+maPad(t.getMinutes());
    const okJson=_maSaveFile(name+'.json',JSON.stringify(maBooksJson({cols,failed,at,by:session.u}),null,1),'application/json');
    let okXlsx=false;
    if(typeof XLSX!=='undefined'&&XLSX&&XLSX.utils){
      try{
        const wb=XLSX.utils.book_new();
        maBooksSheets({cols,failed,at,by:session.u,byName:session.name||session.u,when:_maWhen}).forEach(sh=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(sh.rows),String(sh.name).slice(0,31)));
        XLSX.writeFile(wb,name+'.xlsx');okXlsx=true;
      }catch(e){okXlsx=false;}
    }
    const n=Object.keys(cols).reduce((s,c)=>s+cols[c].length,0);
    const read=Object.keys(cols).length;
    const miss=failed.length?' Could not read: '+failed.map(f=>f.col+' ('+f.message+')').join('; ')+' — named in both files.':'';
    const what=[okJson?'JSON':'',okXlsx?'Excel':''].filter(Boolean).join(' and ');
    _maAuditQuiet('export',{dt:'books',id:name,no:name},'Download the books · '+(what||'nothing saved')+' · '+n+' documents in '+read+' collections'+(failed.length?' · could not read '+failed.map(f=>f.col).join(', '):''));
    const msg=(what?'The books downloaded ('+what+') — '+maGroup(n)+' documents in '+read+' of '+MA_BOOK_COLS.length+' collections.':'Nothing could be saved to this device.')
      +(okXlsx||!okJson?'':' Excel is not available in this build.')+miss;
    say(msg);_maToast(msg);
    return okJson&&!failed.length;
  }catch(e){
    say('The download failed: '+String(e&&e.message||e));return false;
  }finally{_maBooksBusy=false;const b=document.getElementById('ma-books-btn');if(b)b.disabled=false;}
};

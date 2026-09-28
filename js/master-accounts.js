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
      await _maLoadMirror(!!force);
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
   and cash in hand says it is incomplete (maCashInHand). */
async function _maLoadMirror(force){
  _maMirror={ok:false,cash:null,why:'Store Accounts is not loaded in this build'};
  if(typeof loadAccountsData!=='function'||typeof _acctBalances!=='function')return;
  try{
    await loadAccountsData(force);
    const err=typeof _acctLoadErr!=='undefined'?_acctLoadErr:null;
    if(err&&Array.isArray(err.cols)&&err.cols.some(c=>c==='acct_entries'||c==='acct_closes')){
      _maMirror.why='Store Accounts could not read '+err.cols.join(', ');return;
    }
    const b=_acctBalances();
    if(!b||!Number.isFinite(b.cash)){_maMirror.why='Store Accounts gave no drawer balance';return;}
    _maMirror={ok:true,cash:Math.round(b.cash),why:''};
  }catch(e){_maMirror={ok:false,cash:null,why:'Store Accounts failed: '+String(e&&e.message||e)};}
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
  if(/permission|insufficient/i.test(m+' '+(e&&e.code||'')))return 'Refused by the Firestore rules — check the published firestore.rules carries the Master Accounts block.';
  return m||'The write failed.';
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
/* An edit keeps every key the rules do not let it touch exactly as stored. */
function _maEditShape(before,edited){
  const out=_maClean(edited);
  Object.keys(before).forEach(k=>{if(!(k in out)&&before[k]!==undefined)out[k]=_maClean(before[k]);});
  const allowed=new Set((MA_EDIT_FIELDS[before.dt]||[]).concat(['rev','edits','month','quarter','fy','historical','amount','tax','difference','bookBalance','status']));
  Object.keys(out).forEach(k=>{if(!(k in before)&&!allowed.has(k))delete out[k];});
  return out;
}
async function _maWriteEdit(before,edited,reason){
  const col=MA_DOC_TYPES[before.dt].col;
  await runTransaction(db,async tx=>{
    const ref=_MA_REF[col](before.id);
    const snap=await tx.get(ref);
    if(!(snap&&snap.exists()))throw new Error('This document is no longer there.');
    const cur=snap.data()||{};
    if((cur.rev||1)!==(before.rev||1)||cur.status!==before.status)throw new Error('Someone changed this document since it was opened — refresh and try again.');
    tx.set(ref,edited);
    const row=edited.edits[edited.edits.length-1];
    tx.set(_MA_REF.ma_audit(_maAuditId()),_maClean(maAuditRow('edit',edited,Object.assign(_maMeta(),{detail:'rev '+edited.rev+' · '+row.fields.join(', ')+' — '+reason}))));
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
// Keep "active" fresh while someone is working on an ma-* page.
if(typeof document!=='undefined'&&document.addEventListener){
  const bump=()=>{
    if(typeof currentPage==='undefined'||!String(currentPage).startsWith('ma-')||!maCanSee())return;
    if(Date.now()-_maLastTouch>15000)_maTouch();
  };
  document.addEventListener('pointerdown',bump,true);
  document.addEventListener('keyup',bump,true);
}
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
  try{
    if(!maLoaded)await maLoad();
    const body=document.getElementById('ma-dash-body');if(!body)return;
    const errs=_maCoreErrs();
    if(errs.length){body.textContent='Could not read '+errs.map(e=>e.col).join(', ')+' — open Today to retry.';return;}
    const c=_maCtx();
    const cih=maCashInHand(c.holders);
    const na=_maAttention(c);
    body.innerHTML=`<span class="ma-dash-num">${maRs(cih.total)}</span> cash in hand${cih.complete?'':' (drawer not read)'} · `
      +(na.length?`<b>${na.length}</b> need${na.length===1?'s':''} attention`:'nothing to worry about');
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
      <div class="ma-menu" id="ma-menu">${o.excel?`<button onclick="window.maExcel('${_maQ(o.excel)}')">Download Excel</button>`:''}${o.pdf?`<button onclick="window.maPdf('${_maQ(o.pdf)}')">Download PDF</button>`:''}<button onclick="window.maRefresh()">Refresh</button></div></div>
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
  if(_maNeedsRelock()){m.innerHTML=_maLockHTML();return;}
  _maTouch();
  if(!_maEnterLogged){_maEnterLogged=true;_maAuditQuiet('enter',null,'Opened Master Accounts');}
  if(!maLoaded){
    m.innerHTML=_maSkeleton();
    maLoad().then(()=>{if(typeof currentPage==='undefined'||currentPage===id)_maPaint();});
    return;
  }
  _maPaint();
}
function _maPaint(){
  const m=document.getElementById('main-content');
  if(!m)return;
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
function _maCalendarOf(c){
  return maCalendar({settings:c.s,today:c.today,commitments:maData.commitments,docs:c.docs,start:maSpendable(c.holders).total});
}
function _maAttention(c){
  if(c._na)return c._na;
  const cal=_maCalendarOf(c);
  c._cal=cal;
  c._na=maNeedsAttention({settings:c.s,today:c.today,holders:c.holders,calendar:cal,commitments:maData.commitments,docs:c.docs,
    unlabelled:maUnlabelled(c.docs,c.idx,c.s),review:maReviewQueue(c.docs),recon:maBalanceOf(c.lines,c.idx,'9030'),
    backup:_maLatestBackup(),nowMs:Date.now()});
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
function _maMonthFlows(c){
  const month=maMonthOf(c.today);let inM=0,outM=0;
  c.lines.forEach(l=>{
    if(l.month!==month||!l.holder||l.account!==l.holder)return;
    if(l.doc&&(l.doc.dt==='transfer'||l.doc.dt==='count'))return;
    inM+=l.dr;outM+=l.cr;
  });
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
    const lc=h.mirror?'<span class="ma-muted">in Store Accounts</span>':(h.lastCount?maDayLabel(h.lastCount.date)+(h.lastCount.difference?` <span class="ma-word warn">${maRsSigned(h.lastCount.difference)}</span>`:''):'<span class="ma-muted">never</span>');
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
    const short=d.projected<0;
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
  const next=_maSec('The next 30 days','',_maLink('Money out','window.showPage(\'ma-out\')'),
    `<dl class="ma-dl">
      <dt>Cash and bank today</dt><dd>${maRs(cal.start)}</dd>
      <dt>Due out</dt><dd>${maRs(cal.out)}</dd>
      <dt>Expected in</dt><dd>${cal.in?maRs(cal.in):'<span class="ma-muted">none yet — CPRs arrive with M2</span>'}</dd>
      <dt>Leaves</dt><dd>${_maRsCell(cal.end)}</dd>
      <dt>First short day</dt><dd>${first?`<span class="ma-word urgent">${maDayLabel(first)}</span>`:'<span class="ma-muted">none</span>'}</dd>
    </dl>`);
  const strip=_maSec('Day by day','the cost register’s dues against cash and bank','',_maCalHTML(cal),'ma-cal');
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
    const can=!maConfirmPatch(d,session.u,{at:0}).error;
    return {cells:[maDayLabel(d.date),`<button class="ma-doclink" onclick="event.stopPropagation();window.maOpenDoc('transfer','${_maQ(d.id)}')">${_maE(d.no)}</button> ${_maE(_maDocDesc(d,c))}`,maRs(d.amount),
      _maE(_maWho(d.confirmBy))+(d.confirmPaper?' <span class="ma-muted">on paper</span>':''),
      can?`<button class="ma-btn sm" onclick="event.stopPropagation();window.maConfirmDoc('${_maQ(d.id)}')">Confirm</button>`:'<span class="ma-muted">theirs</span>']};
  });
  return _maTable(cols,rows);
}
function _maMoneyHTML(){
  const c=_maCtx();
  const pend=c.docs.filter(d=>d.dt==='transfer'&&d.status==='pending').sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const counts=c.docs.filter(d=>d.dt==='count'&&d.status!=='void').sort((a,b)=>String(b.date).localeCompare(String(a.date))||(b.ts||0)-(a.ts||0)).slice(0,10);
  const mirrorLine=c.holders.some(h=>h.mirror)?(_maMirror.ok?'drawer read from Store Accounts':'drawer not read — '+_maE(_maMirror.why)):'';
  const countRows=counts.map(d=>({cells:[maDayLabel(d.date),`<button class="ma-doclink" onclick="event.stopPropagation();window.maOpenDoc('count','${_maQ(d.id)}')">${_maE(d.no)}</button>`,_maE(_maAccName(c,d.holder)),maRs(d.counted),d.difference?`<span class="ma-word warn">${maRsSigned(d.difference)}</span>`:'<span class="ma-word fine">agrees</span>'],click:`window.maOpenDoc('count','${_maQ(d.id)}')`}));
  return _maHead('Money',c.holders.length+' holders'+(mirrorLine?' · '+mirrorLine:''),{excel:'holders'})
    +_maSec('Holders','',`${_maLink('Transfer','window.maRecordKind(\'transfer\')')} ${_maLink('Count','window.maRecordKind(\'count\')')}`,_maHolderRowsHTML(c,c.holders,{full:true}))
    +_maSec('Waiting to be confirmed',pend.length?String(pend.length):'','',_maPendingHTML(c,pend))
    +_maSec('Recent counts','','',counts.length?_maTable([{h:'Date',cls:'ma-date'},{h:'Count'},{h:'Holder',l:'Holder'},{h:'Counted',cls:'ma-num',l:'Counted'},{h:'Against the book',l:'Book'}],countRows):_maEmpty('No holder has been counted yet.',_maLink('Count one','window.maRecordKind(\'count\')')));
}
function _maHolderStatement(c,code){
  const r=_maRange(c);
  return {r,led:maLedger(c.lines,{holder:code,from:r.from,to:r.to},c.idx)};
}
function _maHolderHTML(){
  const c=_maCtx();
  const h=c.holders.find(x=>x.code===_maHolderCode);
  if(!h)return _maHead('Holder','',{back:['ma-money','Money']})+_maEmpty('That holder is not in the chart.',_maLink('Back to Money','window.showPage(\'ma-money\')'));
  const {r,led}=_maHolderStatement(c,h.code);
  const meta=(h.balance===null?'balance not read':'balance '+maRs(h.balance))+(h.person?' · with '+_maE(_maWho(h.person)):'')+(h.lastCount?' · counted '+maDayLabel(h.lastCount.date):'');
  const banner=h.mirror?`<div class="ma-note">Raees’s drawer is his book in Store Accounts until M8 — the balance is read from there${_maMirror.ok?' ('+maRs(_maMirror.cash)+')':', and the read failed'}. Only handovers to and from it are recorded here.</div>`:'';
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
window.maConfirmDoc=async function(id){
  const d=_maDoc('transfer',id);if(!d||_maBusy)return;
  const r=maConfirmPatch(d,session.u,{at:Date.now()});
  if(r.error){_maToast(r.error);return;}
  if(_maNeedsNet())return;
  _maBusy=true;
  try{
    await _maWritePatch(d,r.patch,'confirm',maRs(d.amount)+' '+(r.patch.confirmVia==='paper'?'on paper for '+_maWho(d.confirmBy):'received'),cur=>cur.status!=='pending'?'It is no longer waiting — refresh.':null);
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
      x.active===false?'<span class="ma-muted">off</span>':`<button class="ma-btn sm" onclick="event.stopPropagation();window.maPayCommitment('${_maQ(x.id)}','${_maQ(st.period||'')}')">Record payment</button>`
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
  const st=maCommitmentStatus(x,c.docs,c.today,c.s);
  const left=Math.max(0,(x.amountExpected||0)-(st.amountPaid||0));
  const hold=x.holder&&!(c.s.mirrors&&c.s.mirrors[x.holder])?x.holder:'';
  window.maRecordKind('money_out',{commitmentId:x.id,commitmentPeriod:period||st.period||'',account:x.account,holder:hold,party:x.party||'',
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
  _maPartyQT=setTimeout(()=>{const el=document.getElementById('ma-party-list');if(el)el.innerHTML=_maPartyTableHTML(_maCtx());},180);
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
  return {r,led:maLedger(c.lines,q,c.idx),single:q.holder||q.account};
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
    maRs(d.amount||0),_maStatusWord(d)+(d.flags&&d.flags.length&&!d.reviewedAt&&d.status!=='void'?' <span class="ma-word warn">flagged</span>':'')],
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
      q.map(d=>({cells:[maDayLabel(d.date),`${_maE(d.no)}<span class="ma-l2">${_maE(maDocTitle(d))}</span>`,d.flags.map(x=>_maE(x.message)).join('<br>'),maRs(d.amount||0),`<button class="ma-btn sm" onclick="event.stopPropagation();window.maReviewDoc('${_maQ(d.dt)}','${_maQ(d.id)}')">Mark reviewed</button>`],click:`window.maOpenDoc('${_maQ(d.dt)}','${_maQ(d.id)}')`})));
  }
  const {r,led,single}=_maLedgerFiltered(c);
  const head=`<div class="ma-scope">${led.count} posting${led.count===1?'':'s'} · ${led.sources} source${led.sources===1?'':'s'} · ${_maE(r.label)}${single&&led.opening!==null?' · opening '+maRs(led.opening):''}</div>`;
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
  _maLQT=setTimeout(()=>{const el=document.getElementById('ma-ledger-body');if(el)el.innerHTML=_maLedgerBodyHTML();},180);
};
window.maLedgerClear=function(){_maLF=_maLFBlank();_maPaint();};
window.maLedgerMore=function(){_maLedgerShown+=50;const el=document.getElementById('ma-ledger-body');if(el)el.innerHTML=_maLedgerBodyHTML();};

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
  const flags=(d.flags||[]).length?`<h4>Flags</h4><ul class="ma-flaglist">${d.flags.map(x=>`<li><span class="ma-dot warn"></span>${_maE(x.message)}</li>`).join('')}</ul>${d.reviewedAt?`<div class="ma-muted">Reviewed by ${_maE(_maWho(d.reviewedBy))} · ${_maWhen(d.reviewedAt)}</div>`:''}`:'';
  const hist=(d.edits||[]).slice().reverse().map(e=>`<li><b>${_maE(_maWho(e.by))}</b> · ${_maWhen(e.at)}<div>${_maE(e.reason||'')}</div>${(e.fields||[]).map(f=>`<div class="ma-muted">${_maE(f)}: ${_maE(_maFieldVal(c,e.before||{},f)||'—')} → ${_maE(_maFieldVal(c,e.after||{},f)||'—')}</div>`).join('')}</li>`).join('');
  const voided=d.status==='void'?`<div class="ma-note">Void — ${_maE(d.voidReason||'')} · ${_maE(_maWho(d.voidedBy))} · ${_maWhen(d.voidedAt)}</div>`:'';
  const pending=d.status==='pending'?`<div class="ma-note">Waiting for ${_maE(_maWho(d.confirmBy))} to confirm${d.confirmPaper?' — an owner confirms on paper with the signed receipt':''}. It counts in neither holder until then.</div>`:'';
  const acts=[];
  if(d.status!=='void'){
    acts.push(`<button class="ma-btn" onclick="window.maEditDoc('${_maQ(d.dt)}','${_maQ(d.id)}')">Edit</button>`);
    if(d.status==='pending'&&!maConfirmPatch(d,session.u,{at:0}).error)acts.push(`<button class="ma-btn primary" onclick="window.maConfirmDoc('${_maQ(d.id)}')">Confirm</button>`);
    if((d.flags||[]).length&&!d.reviewedAt)acts.push(`<button class="ma-btn" onclick="window.maReviewDoc('${_maQ(d.dt)}','${_maQ(d.id)}')">Mark reviewed</button>`);
    acts.push(`<button class="ma-btn danger" onclick="window.maVoidDoc('${_maQ(d.dt)}','${_maQ(d.id)}')">Void</button>`);
  }
  return `<div class="ma-kicker">${_maE(MA_DOC_TYPES[d.dt].label)} · ${_maE(d.no)} · rev ${d.rev||1}</div>
    <h3 class="ma-rail-title">${_maE(maDocTitle(d,c.idx))}</h3>${_maStatusWord(d)}
    ${voided}${pending}
    <dl class="ma-dl">${dl}<dt>Recorded</dt><dd>${_maE(_maWho(d.by))} · ${_maWhen(d.ts)}</dd>${d.confirmedBy?`<dt>Confirmed</dt><dd>${_maE(_maWho(d.confirmedBy))} · ${_maWhen(d.confirmedAt)}${d.confirmVia==='paper'?' · on paper':''}</dd>`:''}</dl>
    ${flags}<h4>Postings</h4>${postT}
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
    <div class="ma-rail-acts">${x.active!==false?`<button class="ma-btn primary" onclick="window.maPayCommitment('${_maQ(x.id)}','${_maQ(st.period||'')}')">Record payment</button>`:''}<button class="ma-btn" onclick="window.maRecordKind('commitment',{id:'${_maQ(x.id)}'})">Edit</button><button class="ma-btn" onclick="window.maCommitToggle('${_maQ(x.id)}')">${x.active===false?'Switch on':'Switch off'}</button></div>`;
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
  const backups=b?_maErrorCard([b]):runs.length?_maTable([{h:'When'},{h:'Result',l:'Result'},{h:'Detail',l:'Detail'}],runs.slice(0,10).map(r=>[_maWhen(r.at),r.ok===false?'<span class="ma-word urgent">failed</span>':'<span class="ma-word fine">done</span>',_maE(r.ok===false?(r.error||''):[(r.collections?r.collections+' collections':''),(r.size?r.size:'')].filter(Boolean).join(' · '))])):_maEmpty('No nightly backup has run yet — the bucket and point-in-time recovery are switched on in the Console (M1 checklist); the backup function is the next milestone.');
  return _maSec('Quarters','the quarter lock arrives with M11','',_maTable([{h:'Quarter'},{h:'State',l:'State'},{h:'Documents',cls:'ma-num',l:'Documents'},{h:'History',l:'History'},{h:'Last entered',l:'Last'}],qs))
    +_maSec('Backups',runs.length?'last '+_maWhen(runs[0].at):'','',backups);
}
function _maAuditHTML(){
  const e=_maErr('audit');
  if(e)return _maErrorCard([e]);
  const rows=maData.audit.slice().sort((a,b)=>(b.at||0)-(a.at||0));
  if(!rows.length)return _maEmpty('Nothing recorded yet.');
  return `<div class="ma-scope">${rows.length} most recent</div>`+_maTable([{h:'When',cls:'ma-nw'},{h:'Who',l:'Who'},{h:'Action',l:'Action'},{h:'Document',l:'Document'},{h:'Detail'}],
    rows.map(r=>[_maWhen(r.at),_maE(r.byName||_maWho(r.by)),_maE(r.action),_maE(r.target&&(r.target.no||r.target.id)||''),_maE(r.detail||'')]));
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
  else if(_maCloseTab==='settings')body=_maSettingsHTML(c);
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
  const int=(id,min,max,label,allowEmpty)=>{const v=_maVal(id).replace(/[₨,\s]/g,'');if(v===''&&allowEmpty)return 0;const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw new Error(label+' is a whole number from '+min+' to '+max+'.');return n;};
  let next,accWrites=[];
  try{
    const floors={};
    const hs=maMoneyAccounts(c.idx,{all:true});
    hs.forEach(a=>{
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
      updatedAt:Date.now(),updatedBy:session.u});
    delete next.id;
    if(next.costCentres.indexOf(next.defaultCostCentre)<0)next.defaultCostCentre=next.costCentres[0];
  }catch(e){say(e.message);return;}
  _maBusy=true;
  try{
    await _maWriteMasters([{col:'ma_settings',id:'main',data:next}].concat(accWrites),'settings',{dt:'settings',id:'main',no:'settings'},'Settings saved'+(accWrites.length?' · '+accWrites.length+' holder'+(accWrites.length>1?'s':''):''));
    const i=maData.settings.findIndex(x=>x.id==='main');const sd=Object.assign({id:'main'},next);if(i>=0)maData.settings[i]=sd;else maData.settings.push(sd);
    accWrites.forEach(w=>{const j=maData.accounts.findIndex(x=>String(x.code)===w.id);const d=Object.assign({id:w.id},w.data);if(j>=0)maData.accounts[j]=d;else maData.accounts.push(d);});
    _maInvalidate();_maToast('Settings saved.');_maPaint();
  }catch(e){say(_maWriteError(e));}finally{_maBusy=false;}
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
window.maCloseModal=function(){const b=document.getElementById('ma-modal-back');if(b&&b.remove)b.remove();_maF=null;};
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
function _maHolderOpts(c,cur,o){
  o=o||{};
  const hs=maMoneyAccounts(c.idx).filter(a=>o.mirror||!(c.s.mirrors&&c.s.mirrors[a.code]));
  return (o.blank?_maOpt('',o.blank,cur):_maOpt('','Choose…',cur))+hs.map(a=>_maOpt(a.code,a.name,cur)).join('');
}
const _MA_GROUP_ORDER={money_out:['expense','cogs','asset','liability','equity','revenue','suspense'],money_in:['revenue','liability','asset','equity','expense','cogs','suspense'],any:['asset','liability','equity','revenue','cogs','expense','suspense']};
const _MA_TYPE_LABEL={asset:'Assets',liability:'Liabilities',equity:'Equity',revenue:'Income',cogs:'Cost of goods',expense:'Expenses',suspense:'Not sure yet'};
function _maAccountOpts(c,kind,cur,o){
  o=o||{};
  const order=_MA_GROUP_ORDER[kind]||_MA_GROUP_ORDER.any;
  const list=c.idx.list.filter(a=>(o.money||!a.money)&&(a.active||a.code===cur));
  return _maOpt('','Choose…',cur)+order.map(t=>{
    const g=list.filter(a=>a.type===t);
    return g.length?`<optgroup label="${_MA_TYPE_LABEL[t]}">${g.map(a=>_maOpt(a.code,a.code+' · '+a.name,cur)).join('')}</optgroup>`:'';
  }).join('');
}
function _maPartyOpts(cur,o){
  o=o||{};
  const ps=maData.parties.filter(p=>p.active!==false||p.id===cur).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  return _maOpt('',o.blank||'— none, name them below —',cur)+ps.map(p=>_maOpt(p.id,p.name+' · '+(MA_PARTY_KIND_LABELS[p.kind]||p.kind),cur)).join('')+(o.noNew?'':_maOpt('__new','+ New party…',cur));
}
function _maTaxHTML(t){
  t=t||maTaxBlank();
  return `<div class="ma-field" id="ma-w-tax"><span class="ma-lbl">Tax</span>
    <input type="hidden" id="ma-f-taxkind" value="${_maE(t.kind||'none')}">
    <div class="ma-chips" role="radiogroup" aria-label="Tax">${MA_TAX_KINDS.map(k=>`<button type="button" role="radio" aria-checked="${(t.kind||'none')===k}" class="ma-chip${(t.kind||'none')===k?' on':''}" id="ma-tax-${k}" onclick="window.maTaxKind('${k}')">${_maE(MA_TAX_LABELS[k])}</button>`).join('')}</div>
    <div class="ma-taxmore" id="ma-f-taxmore"${(t.kind||'none')==='none'?' hidden':''}>
      <label class="ma-field sm"><span class="ma-lbl">Rate %</span><input class="ma-in ma-in-num" id="ma-f-taxrate" inputmode="decimal" value="${_maE(t.rate||'')}" oninput="window.maTaxCalc()"></label>
      <label class="ma-chk"><input type="checkbox" id="ma-f-taxincl"${t.inclusive!==false?' checked':''} onchange="window.maTaxCalc()"> included in the amount</label>
      <label class="ma-chk"><input type="checkbox" id="ma-f-taxclaim"${t.claimable?' checked':''} onchange="window.maTaxCalc()"> claimable</label>
    </div>
    <span class="ma-hint" id="ma-f-taxcalc">${(t.kind||'none')==='none'?'No tax on this — chosen, not assumed.':''}</span><span class="ma-ferr" id="ma-e-tax"></span></div>`;
}
window.maTaxKind=function(k){
  const h=document.getElementById('ma-f-taxkind');if(h)h.value=k;
  MA_TAX_KINDS.forEach(x=>{const b=document.getElementById('ma-tax-'+x);if(b&&b.classList){b.classList.toggle('on',x===k);if(b.setAttribute)b.setAttribute('aria-checked',String(x===k));}});
  const more=document.getElementById('ma-f-taxmore');if(more)more.hidden=k==='none';
  window.maTaxCalc();window.maFormDirty();
};
window.maTaxCalc=function(){
  const out=document.getElementById('ma-f-taxcalc');if(!out)return;
  const k=_maVal('ma-f-taxkind')||'none';
  if(k==='none'){out.textContent='No tax on this — chosen, not assumed.';return;}
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
};
window.maCountBook=function(){
  const out=document.getElementById('ma-f-book');if(!out||!_maF)return;
  const c=_maCtx();const code=_maVal('ma-f-holder');const date=_maVal('ma-f-date');
  if(!code){out.textContent='';return;}
  const lines=_maF.edit?maPostAll(c.docs.filter(d=>!(d.dt===_maF.edit.dt&&d.id===_maF.edit.id)),c.idx,c.s):c.lines;
  const book=maBalanceOf(lines,c.idx,code,maIsDay(date)?date:undefined);
  const n=_maNum(_maVal('ma-f-counted'));
  out.innerHTML='The book says '+maRs(book)+(Number.isFinite(n)?(Math.round(n)===book?' · <span class="ma-word fine">agrees</span>':' · <span class="ma-word warn">'+maRsSigned(Math.round(n)-book)+'</span>'):'');
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
  _maF={kind,dt,pre:pre||{},edit:edit||null,ack:false,lines:[]};
  const p=Object.assign({date:c.today},pre||{});
  if(kind==='opening'||kind==='general'){
    _maF.lines=(p.lines||[]).map(l=>({account:l.account||'',side:l.side||'dr',amount:l.amount||'',dr:l.dr||'',cr:l.cr||'',party:l.party||'',memo:l.memo||''}));
    while(_maF.lines.length<2)_maF.lines.push({account:'',side:'dr',amount:'',dr:'',cr:'',party:'',memo:''});
    if(kind==='opening'&&!edit&&!pre.date)p.date=s.historyFrom<=c.today?s.historyFrom:c.today;
  }
  const date=_maFld('date','Date',_maIn('date',p.date,{type:'date',min:s.historyFrom,max:c.today,on:'window.maCountBook()'}));
  const amount=_maFld('amount','Amount, ₨',_maIn('amount',p.amount,{num:true,ph:'0',on:'window.maTaxCalc()'}));
  const note=_maFld('note','Note',`<textarea class="ma-in" id="ma-f-note" rows="2">${_maE(p.note||'')}</textarea>`);
  let body='';
  if(kind==='money_out'||kind==='money_in'){
    const partyLocked=!!edit;
    const commits=maData.commitments.filter(x=>x.active!==false||x.id===p.commitmentId);
    body=`<div class="ma-grid2">${date}${amount}</div>
      <div class="ma-grid2">${_maFld('holder',kind==='money_out'?'Paid from':'Arrived in',_maSel('holder',_maHolderOpts(c,p.holder),p.holder),_maE(_MA_MIRROR_LINE))}
      ${_maFld('account',kind==='money_out'?'What it was for':'What it was',_maSel('account',_maAccountOpts(c,kind,p.account),p.account))}</div>
      <div class="ma-grid2">${_maFld('party',kind==='money_out'?'Paid to':'Paid by',_maSel('party',_maPartyOpts(p.party),p.party,{dis:partyLocked,on:'window.maPartyPicked(this.value)'}),partyLocked?'A document cannot change its party — void it and record it again.':'')}
      <label class="ma-field" id="ma-w-payee"${p.party?' hidden':''}><span class="ma-lbl">Or a name, for a one-off</span>${_maIn('payee',p.payee,{ph:'Who was paid',dis:partyLocked})}<span class="ma-ferr" id="ma-e-payee"></span></label></div>
      <div class="ma-np" id="ma-f-np" hidden><div class="ma-grid2">${_maFld('npname','New party’s name',_maIn('npname',''))}${_maFld('npkind','Kind',_maSel('npkind',MA_PARTY_KINDS.map(k=>_maOpt(k,MA_PARTY_KIND_LABELS[k],'vendor')).join(''),'vendor'))}</div><button type="button" class="ma-btn sm" onclick="window.maInlineParty()">Create party</button></div>
      ${_maTaxHTML(p.tax)}
      <div class="ma-grid3">${_maFld('costCentre','Cost centre',_maSel('costCentre',s.costCentres.map(x=>_maOpt(x,x,p.costCentre||s.defaultCostCentre)).join(''),''))}
      ${_maFld('labelKind','Kind',_maSel('labelKind',_maOpt('','From the account',p.labelKind)+MA_LABEL_KINDS.filter(x=>x!=='transfer').map(x=>_maOpt(x,x.replace('_','-'),p.labelKind)).join(''),''))}
      ${kind==='money_in'?_maFld('channel','Channel',_maSel('channel',_maOpt('','—',p.channel)+MA_CHANNELS.map(x=>_maOpt(x,x.replace('_',' '),p.channel)).join(''),'')):_maFld('commitmentId','Settles a commitment',_maSel('commitmentId',_maOpt('','No',p.commitmentId)+commits.map(x=>_maOpt(x.id,x.name,p.commitmentId)).join(''),''))}</div>
      <div class="ma-grid3">${kind==='money_out'?_maFld('commitmentPeriod','For the period',_maIn('commitmentPeriod',p.commitmentPeriod,{ph:'2026-10'})):''}${_maFld('po','Production PO',_maIn('po',p.po,{ph:'optional'}))}${_maFld('article','Article',_maIn('article',p.article,{ph:'optional'}))}</div>
      ${note}${_maFld('tags','Tags',_maIn('tags',(p.tags||[]).join(', '),{ph:'comma between'}))}`;
  }else if(kind==='transfer'){
    body=`<div class="ma-grid2">${date}${amount}</div>
      <div class="ma-grid2">${_maFld('from','From',_maSel('from',_maHolderOpts(c,p.from,{mirror:true}),p.from))}${_maFld('to','To',_maSel('to',_maHolderOpts(c,p.to,{mirror:true}),p.to,{dis:!!edit}),edit?'Who received it cannot change — void and record again.':'Into another person’s hands, it waits for them to confirm.')}</div>
      <div class="ma-hint ma-block">The store drawer (1010) is Raees’s book in Store Accounts until M8 — a handover to or from it is recorded here; spending from it is recorded there.</div>${note}`;
  }else if(kind==='count'){
    body=`<div class="ma-grid2">${date}${_maFld('holder','Holder',_maSel('holder',_maHolderOpts(c,p.holder),p.holder,{on:'window.maCountBook()'}),_maE(_MA_MIRROR_LINE.replace(' A handover to or from it is a Transfer.',' Raees counts it there.')))}</div>
      ${_maFld('counted','Counted, ₨',_maIn('counted',p.counted,{num:true,ph:'0',on:'window.maCountBook()'}),'<span id="ma-f-book"></span>')}${note}`;
  }else if(kind==='capital'||kind==='drawing'){
    const own=MA_OWNERS.indexOf(p.owner)>=0?p.owner:session.u;
    body=`<div class="ma-grid2">${date}${amount}</div>
      <div class="ma-field" id="ma-w-owner"><span class="ma-lbl">Owner</span><input type="hidden" id="ma-f-owner" value="${_maE(own)}"><div class="ma-chips">${MA_OWNERS.map(u=>`<button type="button" class="ma-chip${own===u?' on':''}" id="ma-own-${u}" onclick="window.maOwnerPick('${u}')">${_maE(_maWho(u))}</button>`).join('')}</div><span class="ma-ferr" id="ma-e-owner"></span></div>
      ${_maFld('holder',kind==='capital'?'Put into':'Taken from',_maSel('holder',_maHolderOpts(c,p.holder),p.holder),_maE(_MA_MIRROR_LINE))}${note}`;
  }else{
    body=`<div class="ma-grid2">${date}<div></div></div>
      <div class="ma-field" id="ma-w-lines"><span class="ma-lbl">Lines</span><div class="ma-lines" id="ma-f-lines">${_maLinesHTML(c)}</div><button type="button" class="ma-link" onclick="window.maLineAdd()">Add a line</button><div class="ma-hint" id="ma-f-linetot"></div><span class="ma-ferr" id="ma-e-lines"></span></div>${note}`;
  }
  if(edit)body+=_maFld('reason','Why is this changing?',`<textarea class="ma-in" id="ma-f-reason" rows="2"></textarea>`);
  body=`<div class="ma-issues" id="ma-f-issues"></div>`+body;
  const title=edit?'Edit '+edit.no:(MA_JOURNAL_KINDS[kind]?MA_JOURNAL_KINDS[kind].label:kind==='transfer'?'Transfer':'Count');
  _maModal(title,body,`<button class="ma-btn" onclick="window.maCloseModal()">Cancel</button><button class="ma-btn primary" id="ma-f-save" onclick="window.maSaveForm()">${edit?'Save the edit':'Record'}</button>`,kind==='opening'||kind==='general');
  _maPaintLineTotals();window.maTaxCalc();window.maCountBook();
}
function _maFormRead(){
  const f=_maF,k=f.kind;
  const input={kind:k,date:_maVal('ma-f-date').trim(),note:_maVal('ma-f-note')};
  if(k==='money_out'||k==='money_in'){
    Object.assign(input,{holder:_maVal('ma-f-holder'),account:_maVal('ma-f-account'),amount:_maVal('ma-f-amount'),
      party:_maVal('ma-f-party'),payee:_maVal('ma-f-payee'),
      tax:{kind:_maVal('ma-f-taxkind')||'none',rate:Number(_maVal('ma-f-taxrate'))||0,inclusive:_maChecked('ma-f-taxincl',true),claimable:_maChecked('ma-f-taxclaim',false)},
      costCentre:_maVal('ma-f-costCentre'),labelKind:_maVal('ma-f-labelKind'),channel:_maVal('ma-f-channel'),
      po:_maVal('ma-f-po'),article:_maVal('ma-f-article'),commitmentId:_maVal('ma-f-commitmentId'),commitmentPeriod:_maVal('ma-f-commitmentPeriod').trim(),
      tags:_maVal('ma-f-tags').split(',').map(x=>x.trim()).filter(Boolean)});
    if(input.party==='__new')input.party='';
    if(input.party){const p=_maParty(input.party);input.partyKind=p?p.kind:null;input.payee='';}
    if(input.tax.kind==='none')input.tax={kind:'none',rate:0,inclusive:true,claimable:false};
    if(input.commitmentId&&!input.commitmentPeriod&&maIsDay(input.date)){const cm=_maCommit(input.commitmentId);if(cm)input.commitmentPeriod=maCommitmentPeriodKey(cm,input.date,_maCtx().s.fiscalYearStart);}
    if(f.edit){input.party=f.edit.party||'';input.partyKind=f.edit.partyKind||null;if(f.edit.party)input.payee='';}
  }else if(k==='transfer'){
    Object.assign(input,{from:_maVal('ma-f-from'),to:f.edit?f.edit.to:_maVal('ma-f-to'),amount:_maVal('ma-f-amount')});
  }else if(k==='count'){
    Object.assign(input,{holder:_maVal('ma-f-holder'),counted:_maVal('ma-f-counted')});
  }else if(k==='capital'||k==='drawing'){
    Object.assign(input,{owner:_maVal('ma-f-owner'),holder:_maVal('ma-f-holder'),amount:_maVal('ma-f-amount')});
  }else{
    input.lines=f.lines.filter(l=>l.account||l.amount||l.dr||l.cr).map(l=>k==='opening'?{account:l.account,side:l.side,amount:l.amount,party:l.party,memo:l.memo}:{account:l.account,dr:l.dr||0,cr:l.cr||0,party:l.party,memo:l.memo});
  }
  return input;
}
const _MA_FIELDS=['date','amount','holder','account','party','payee','tax','costCentre','labelKind','channel','commitmentId','commitmentPeriod','owner','from','to','counted','note','lines','reason',
  'name','ckind','cadence','amountExpected','dueDay','dueWeekday','dueMonth','code','npname','item','unit','rate','validFrom'];
function _maShowIssues(res){
  _MA_FIELDS.forEach(f=>{const e=document.getElementById('ma-e-'+f);if(e)e.textContent='';});
  const top=[];
  res.refuses.forEach(x=>{
    const e=x.field&&document.getElementById('ma-e-'+x.field);
    if(e&&x.field!=='attachments'&&_MA_FIELDS.indexOf(x.field)>=0)e.textContent=(e.textContent?e.textContent+' ':'')+x.message;
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
  const c=_maCtx();const s=c.s;
  const input=_maFormRead();
  const meta=f.edit?{by:f.edit.by,byName:f.edit.byName,ts:f.edit.ts,source:f.edit.source}:{by:session.u,byName:session.name||session.u,ts:Date.now(),source:'manual'};
  const others=f.edit?maPostAll(c.docs.filter(d=>!(d.dt===f.edit.dt&&d.id===f.edit.id)),c.idx,s):c.lines;
  if(f.dt==='count')meta.bookBalance=maBalanceOf(others,c.idx,input.holder,maIsDay(input.date)?input.date:undefined);
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
      let edited=maApplyEdit(f.edit,built,{at:Date.now(),by:session.u,byName:session.name||session.u,reason});
      if(!edited){_maToast('Nothing changed.');return;}
      edited=_maEditShape(f.edit,edited);
      await _maWriteEdit(f.edit,edited,reason);
      const key=_MA_DOC_KEY[f.dt];const i=maData[key].findIndex(d=>d.id===f.edit.id);if(i>=0)maData[key][i]=edited;
      _maInvalidate();window.maCloseModal();_maToast(edited.no+' saved — revision '+edited.rev+'.');
      _maRail={kind:'doc',dt:edited.dt,id:edited.id};_maPaint();
    }else{
      if(res.flags.length)built.flags=res.flags.map(x=>({rule:x.rule,message:x.message,field:x.field||null}));
      const stored=await _maPostNew(built);
      maData[_MA_DOC_KEY[f.dt]].push(stored);
      _maInvalidate();window.maCloseModal();
      _maToast(stored.no+(stored.status==='pending'?' recorded — waiting for '+_maWho(stored.confirmBy)+' to confirm.':' recorded.')+(stored.flags&&stored.flags.length?' It waits for review.':''));
      _maPaint();
    }
  }catch(e){
    const box=document.getElementById('ma-f-issues');
    if(box)box.innerHTML=`<ul class="ma-flaglist"><li class="refuse"><span class="ma-dot urgent"></span>${_maE(_maWriteError(e))} Nothing was saved.</li></ul>`;
  }finally{_maBusy=false;const b=document.getElementById('ma-f-save');if(b)b.disabled=false;}
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
    Object.assign(d,patch);_maInvalidate();_maToast(d.no+' voided — it stays on the record, struck through.');_maPaint();
  }catch(e){_maToast(_maWriteError(e));}finally{_maBusy=false;}
};
window.maReviewDoc=async function(dt,id){
  const d=_maDoc(dt,id);if(!d||_maBusy)return;
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
    ${_maFld('costCentre','Cost centre',_maSel('costCentre',s.costCentres.map(k=>_maOpt(k,k,v.costCentre)).join(''),v.costCentre))}</div>
    <div class="ma-grid2">${_maFld('from','From',_maIn('from',v.from,{type:'date'}))}${_maFld('to','Until',_maIn('to',v.to,{type:'date'}))}</div>
    ${_maFld('note','Note',`<textarea class="ma-in" id="ma-f-note" rows="2">${_maE(v.note||'')}</textarea>`)}`;
  _maModal(x?'Edit '+x.name:'New commitment',body,`<button class="ma-btn" onclick="window.maCloseModal()">Cancel</button><button class="ma-btn primary" id="ma-f-save" onclick="window.maSaveForm()">${x?'Save':'Add commitment'}</button>`);
}
function _maIntOrNull(v){v=String(v||'').replace(/[₨,\s]/g,'');if(v==='')return null;const n=Number(v);return Number.isFinite(n)?n:NaN;}
async function _maSaveCommitment(){
  const c=_maCtx();const f=_maF;const before=f.edit;
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
  }catch(e){_maShowIssues({refuses:[{message:_maWriteError(e)}],flags:[],ok:false});}finally{_maBusy=false;}
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
    ${_maFld('costCentre','Cost centre',_maSel('costCentre',c.s.costCentres.map(k=>_maOpt(k,k,v.costCentre||c.s.defaultCostCentre)).join(''),''))}
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
    costCentre:_maVal('ma-f-costCentre')||c.s.defaultCostCentre,active:before?_maChecked('ma-f-active',before.active!==false):true,
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
  }catch(e){_maShowIssues({refuses:[{message:_maWriteError(e)}],flags:[],ok:false});}finally{_maBusy=false;}
}
/* "+ New party" from any party field: name and kind, the rest later (§14). */
window.maInlineParty=async function(){
  if(_maBusy||_maNeedsNet())return;
  const c=_maCtx();
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
  }catch(err){if(e)e.textContent=_maWriteError(err);}finally{_maBusy=false;}
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
  const c=_maCtx();const p=_maF.edit;
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
  }catch(e){_maShowIssues({refuses:[{message:_maWriteError(e)}],flags:[],ok:false});}finally{_maBusy=false;}
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
  const c=_maCtx();const p=_maF.edit;
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
  }catch(e){_maShowIssues({refuses:[{message:_maWriteError(e)}],flags:[],ok:false});}finally{_maBusy=false;}
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
  if(d.dt==='transfer')return `<button class="ma-btn" onclick="window.maDocPdf('transfer','${_maQ(d.id)}')">Receipt (PDF)</button>`;
  if(d.dt==='journal'&&d.kind==='money_out')return `<button class="ma-btn" onclick="window.maDocPdf('journal','${_maQ(d.id)}')">Voucher (PDF)</button>`;
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
  const docRow=d=>[d.date,d.no,maDocTitle(d,c.idx),_maDocDesc(d,c),d.amount||0,d.status,(d.flags||[]).map(x=>x.message).join('; '),d.note||''];
  const docHead=['Date','Number','Document','What','Amount','State','Flags','Note'];
  const postRows=led=>[['Date','Document','Account','Description','Cost centre','Kind','Debit','Credit','Balance']].concat(led.rows.map(l=>[l.date,l.doc&&l.doc.no,maAccLabel(c.idx,l.account),[l.party?_maPartyName(l.party):l.payee,l.memo].filter(Boolean).join(' · '),l.costCentre||'',l.kind||'',l.dr,l.cr,l.balance===undefined?'':l.balance]));
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
  if(key==='audit'){const rows=[['When','Who','Action','Document','Detail']].concat(maData.audit.slice().sort((a,b)=>(b.at||0)-(a.at||0)).map(x=>[new Date(x.at||0).toISOString(),x.byName||x.by,x.action,x.target&&(x.target.no||x.target.id)||'',x.detail||'']));return _maXlsx('master-accounts_audit_'+c.today,[{name:'Audit trail',rows}]);}
};

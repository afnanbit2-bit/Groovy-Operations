/* ─────────────────────────────────────────────────────────────────────────
   js/ph-data.js — Production Ops (`ph`), the DATA LAYER, reads (12 Oct 2026)

   NO UI. Nothing in the app calls anything here yet; it is the audience, the
   collection list and the loaders the screens will use. It reads only the
   NEW collections below and never writes (js/ph-write.js writes).

   The new collections (all need the firestore.rules block added with this
   change; until it is republished every read here is DENIED and says so):
     po_drafts        PC-entry drafts of a PO, before a PO number exists
     po_cut_jobs      the planned cut job of one PO (id = the PO id)
     cutting_masters  the registry of cutting masters
     ph_standards     the gross standard of one article (id = article code)
     ph_settings      main (capacity, skip days, the PC-only switch) and counters
     pos/{id}/history append-only rows under an EXISTING pos document -- a new
                      sub-collection; the pos document itself is never touched

   Rules every loader here keeps (CLAUDE.md "Loading must never hang"):
     - NEVER REJECTS. A failed read is recorded by collection name; it is never
       an empty list. A stage that failed (or was never read) reports
       `rows:null`, so "0 drafts" can only mean the collection was read and is
       empty. phGet(stage) is the honest accessor; _phData[stage] is raw.
     - Bounded: every list is read with limit(); a list that hit its limit says
       `truncated` rather than pretending to be the whole collection. The pos
       history is read only when asked (phHistoryOf), never in phLoadAll.
     - A permission error is retried ONCE behind a forced token refresh (a stale
       ID token is the one cause that can fix), like loadData() in js/pos.js.
     - A read that never settles is cut off (PH_READ_TIMEOUT_MS) and reported.
     - Reads never write (N2); days are PKT strings (js/ph-core.js phDay).

   Everything global is prefixed ph / _ph / PH_ -- classic scripts, ONE lexical
   scope. js/ph-core.js is loaded before this file and is reused, not copied.
   ───────────────────────────────────────────────────────────────────────── */

/* ── Audience ─────────────────────────────────────────────────────────────
   By USERNAME, never by role (the Sept 2026 grants shape). Mirror:
   firestore.rules isProdOps() / isProdOpsManager() by EMAIL (<u>@groovy.op);
   tests/ph-data.test.js fails if the lists differ.

     MANAGE  afnan, ammar, mustafa   see everything and MANAGE: masters, standards,
                                     settings, send a draft back, plan a cut job
     FLOOR   uzaib                   (Kashif, the cutting incharge) SEES everything
                                     and may RECORD cutting-floor actions: save and
                                     ready a draft, open/update a cut job's checklist,
                                     append a PO history row. He cannot add or rename
                                     a master, save a standard or change a setting.
     USERS = MANAGE + FLOOR (the audience of the whole module).
   Raees, Umair and every other account read the new collections (rules:
   signedIn()) but are in none of these lists. */
const _PH_MANAGE_USERS=Object.freeze(['afnan','ammar','mustafa']);
const _PH_FLOOR_USERS=Object.freeze(['uzaib']);
const _PH_USERS=Object.freeze(_PH_MANAGE_USERS.concat(_PH_FLOOR_USERS));
function _phSessionU(){return(typeof session!=='undefined'&&session&&typeof session.u==='string')?session.u:'';}
function _phWho(u){return u===undefined?_phSessionU():(typeof u==='string'?u:'');}
function phCanSee(u){return _PH_USERS.indexOf(_phWho(u))>-1;}
function phCanManage(u){return _PH_MANAGE_USERS.indexOf(_phWho(u))>-1;}
// May record a cutting-floor action: the whole audience (managers included).
function phCanRecordFloor(u){return phCanSee(u);}
// The two owners (rules: isOwner()). Only an owner flips the hard PC-only switch or marks a
// cut job 'overridden'.
function phIsOwner(u){const w=_phWho(u);return w==='afnan'||w==='ammar';}
function phCanSetPcOnly(u){return phIsOwner(u);}

/* ── The collections and their bounds ─────────────────────────────────── */
const PH_COLLECTIONS=Object.freeze({
  drafts:   Object.freeze({col:'po_drafts',      label:'PO drafts',              order:'updatedAt',limit:300}),
  jobs:     Object.freeze({col:'po_cut_jobs',    label:'Cutting jobs',           order:'createdAt',limit:500}),
  masters:  Object.freeze({col:'cutting_masters',label:'Cutting masters',        order:null,       limit:500}),
  standards:Object.freeze({col:'ph_standards',   label:'Consumption standards',  order:null,       limit:1500}),
  settings: Object.freeze({col:'ph_settings',    label:'Production Ops settings',doc:'main'}),
  instructions:Object.freeze({col:'ph_article_instructions',label:'Product instructions',order:null,limit:1500})
});
const PH_STAGE_IDS=Object.freeze(['drafts','jobs','masters','standards','settings','instructions']);
// Every collection path this layer is allowed to touch (both files). A test scans the
// source and the recorded writes against this list.
const PH_WRITE_ROOTS=Object.freeze(['po_drafts','po_cut_jobs','cutting_masters','ph_standards','ph_settings','ph_article_instructions']);
const PH_READ_TIMEOUT_MS=20000;
const PH_HISTORY_LIMIT=50;
const PH_HISTORY_MAX=200;

/* ── State ─────────────────────────────────────────────────────────────── */
let _phData={drafts:null,jobs:null,masters:null,standards:null,settings:null,instructions:null};
let _phLoad={};                 // stage -> {state:'idle'|'ok'|'error',at,n,truncated,err}
let _phInflight={};             // stage -> Promise (concurrent calls coalesce)
let _phHistCache={};            // poId -> {at,rows,truncated}
function _phStageFresh(){return{state:'idle',at:null,n:null,truncated:false,err:null};}
PH_STAGE_IDS.forEach(function(s){_phLoad[s]=_phStageFresh();});

function phErrInfo(e){
  const code=e&&e.code?String(e.code):'';
  const message=e&&e.message?String(e.message):(e==null?'unknown error':String(e));
  const permission=code==='permission-denied'||message.indexOf('permissions')>-1;
  const quota=code==='resource-exhausted'||/429|quota/i.test(message);
  return{code:code,message:message,permission:permission,quota:quota};
}
// Why a stage failed, in words the screen can print and the next person can act on.
function phErrText(stageId,err){
  const st=PH_COLLECTIONS[stageId];const name=st?st.col:String(stageId);
  const i=err&&err.message!==undefined&&err.permission!==undefined?err:phErrInfo(err);
  if(i.permission)return name+': could not be read - republish firestore.rules from the repo file (the Production Ops block), then retry.';
  if(i.quota)return name+': the Firestore read quota is used up - retry later.';
  if(i.code==='from-cache')return name+': only this device\'s offline copy was available, so it was not read - get a connection and retry.';
  if(i.code==='timeout')return name+': the read did not finish in '+Math.round(PH_READ_TIMEOUT_MS/1000)+'s - check the connection and retry.';
  return name+': read failed ('+(i.message||i.code||'unknown')+').';
}

function _phWithTimeout(p,ms){
  let t;
  const timeout=new Promise(function(_,rej){t=setTimeout(function(){const e=new Error('read timed out');e.code='timeout';rej(e);},ms);});
  return Promise.race([p,timeout]).then(function(v){clearTimeout(t);return v;},function(e){clearTimeout(t);throw e;});
}

function _phQueryFor(stageId){
  const st=PH_COLLECTIONS[stageId];
  if(st.doc)return getDoc(doc(db,st.col,st.doc));
  const c=collection(db,st.col);
  return getDocs(st.order?query(c,orderBy(st.order,'desc'),limit(st.limit)):query(c,limit(st.limit)));
}
// A read answered from this device's offline copy is NOT a read of the collection: with no signal it can be
// empty or old and would look exactly like "nothing there" (js/prod-backup.js treats it the same way).
function _phFromCache(snap){return!!snap&&!!snap.metadata&&snap.metadata.fromCache===true;}
function _phCacheError(){const e=new Error('the read was answered from this device\'s offline copy, not from the server');e.code='from-cache';return e;}
function _phApply(stageId,snap){
  const st=PH_COLLECTIONS[stageId];
  if(_phFromCache(snap))throw _phCacheError();
  if(st.doc){
    const has=!!snap&&typeof snap.exists==='function'&&snap.exists();
    _phData[stageId]=has?Object.assign({},snap.data()):{};     // a missing settings doc is "all defaults", read successfully
    return{n:has?1:0,truncated:false};
  }
  const docs=(snap&&snap.docs)||[];
  _phData[stageId]=docs.map(function(d){return Object.assign({},d.data(),{fbKey:d.id});});
  return{n:docs.length,truncated:docs.length>=st.limit};
}
async function _phRunOnce(stageId){
  return _phApply(stageId,await _phWithTimeout(_phQueryFor(stageId),PH_READ_TIMEOUT_MS));
}
async function _phLoadStage(stageId,force){
  const st=PH_COLLECTIONS[stageId];
  if(!st)return{ok:false,stage:stageId,err:phErrInfo(new Error('unknown stage '+stageId))};
  if(!force&&_phLoad[stageId].state==='ok')return{ok:true,stage:stageId,n:_phLoad[stageId].n,cached:true};
  let r,err=null;
  try{r=await _phRunOnce(stageId);}
  catch(e){
    err=phErrInfo(e);
    // One retry behind a forced token refresh, for a permission failure only (js/pos.js loadData).
    if(err.permission&&typeof auth!=='undefined'&&auth&&auth.currentUser&&typeof auth.currentUser.getIdToken==='function'){
      try{await auth.currentUser.getIdToken(true);r=await _phRunOnce(stageId);err=null;}
      catch(e2){err=phErrInfo(e2);}
    }
  }
  if(err){
    _phLoad[stageId]={state:'error',at:Date.now(),n:null,truncated:false,err:err};
    if(typeof console!=='undefined')console.warn('[ph-data] '+st.col+' failed:',err.code||err.message);
    return{ok:false,stage:stageId,err:err};
  }
  _phLoad[stageId]={state:'ok',at:Date.now(),n:r.n,truncated:r.truncated,err:null};
  return{ok:true,stage:stageId,n:r.n,truncated:r.truncated};
}
// Load one stage. NEVER rejects. Concurrent calls for one stage share one read.
function phLoadStage(stageId,opts){
  const force=!!(opts&&opts.force);
  const key=String(stageId);
  if(_phInflight[key])return _phInflight[key];
  const p=_phLoadStage(key,force).catch(function(e){return{ok:false,stage:key,err:phErrInfo(e)};}).then(function(r){delete _phInflight[key];return r;});
  _phInflight[key]=p;
  return p;
}
// Load every stage (or `only`), each settling on its own so one refused read cannot
// take the others down (Promise.allSettled shape). Resolves {ok, failed, loaded}.
async function phLoadAll(opts){
  const o=opts||{};
  const ids=Array.isArray(o.only)&&o.only.length?o.only.filter(function(s){return PH_STAGE_IDS.indexOf(s)>-1;}):PH_STAGE_IDS.slice();
  let results;
  try{results=await Promise.all(ids.map(function(s){return phLoadStage(s,{force:!!o.force});}));}
  catch(e){results=[{ok:false,stage:'all',err:phErrInfo(e)}];}
  const failed=results.filter(function(r){return!r.ok;}).map(function(r){
    const st=PH_COLLECTIONS[r.stage];
    return{stage:r.stage,name:st?st.col:r.stage,label:st?st.label:r.stage,err:r.err,text:phErrText(r.stage,r.err)};
  });
  return{ok:failed.length===0,failed:failed,loaded:results.filter(function(r){return r.ok;}).map(function(r){return r.stage;})};
}
function phLoadFailed(stageId){return!!_phLoad[stageId]&&_phLoad[stageId].state==='error';}
function phLoadErrors(){
  const out=[];
  PH_STAGE_IDS.forEach(function(s){if(_phLoad[s].state==='error')out.push({stage:s,name:PH_COLLECTIONS[s].col,text:phErrText(s,_phLoad[s].err),err:_phLoad[s].err});});
  return out;
}
function phLoadState(stageId){
  const s=_phLoad[stageId];
  return s?Object.assign({},s):null;
}
// The honest accessor. rows is null unless the stage was read successfully; an empty
// array therefore always means "read, and there is nothing".
function phGet(stageId){
  const s=_phLoad[stageId];
  if(!s)return{ok:false,state:'unknown',rows:null,err:null};
  if(s.state==='ok'){
    const d=_phData[stageId];
    return{ok:true,state:'ok',rows:Array.isArray(d)?d.slice():d,n:s.n,truncated:s.truncated,at:s.at,err:null};
  }
  return{ok:false,state:s.state,rows:null,err:s.err,text:s.err?phErrText(stageId,s.err):null};
}
function phResetData(){
  _phData={drafts:null,jobs:null,masters:null,standards:null,settings:null,instructions:null};
  _phLoad={};PH_STAGE_IDS.forEach(function(s){_phLoad[s]=_phStageFresh();});
  _phInflight={};_phHistCache={};
}

/* ── Settings, resolved through the pure core ─────────────────────────── */
// The resolved settings (defaults filled and clamped by js/ph-core.js phSettings). A settings
// doc that was not read gives the defaults AND known:false, so a caller can tell "defaults
// because nothing is saved" from "defaults because the read failed".
function phSettingsInfo(){
  const g=phGet('settings');
  const raw=g.ok?(g.rows||{}):null;
  return{
    known:g.ok,
    failed:phLoadFailed('settings'),
    raw:raw,
    settings:phSettings(raw||{}),
    pcOnlyHard:!!(raw&&raw.pcOnlyHard===true)
  };
}
function phSettingsNow(){return phSettingsInfo().settings;}
// One bounded read of ph_settings/main for callers outside Production Ops (the classic cutting screen's gate). Never rejects.
function phSettingsEnsure(){return phLoadStage('settings');}

/* ── Lookups over what was loaded (null when the stage did not load) ──── */
function phMasterList(){
  const g=phGet('masters');
  return g.ok?g.rows.slice().sort(function(a,b){return a.fbKey<b.fbKey?-1:a.fbKey>b.fbKey?1:0;}):null;
}
function phStandardFor(code){
  const g=phGet('standards');
  if(!g.ok)return null;
  const k=String(code==null?'':code).trim().toUpperCase();
  for(let i=0;i<g.rows.length;i++)if(g.rows[i].fbKey===k)return g.rows[i];
  return null;
}
function phInstructionsFor(code){
  const g=phGet('instructions');
  if(!g.ok)return null;
  const k=String(code==null?'':code).trim().toUpperCase();
  for(let i=0;i<g.rows.length;i++)if(g.rows[i].fbKey===k)return g.rows[i];
  return null;
}
function phJobFor(poId){
  const g=phGet('jobs');
  if(!g.ok)return null;
  for(let i=0;i<g.rows.length;i++)if(g.rows[i].fbKey===poId)return g.rows[i];
  return null;
}

/* ── pos/{id}/history, read only when asked, one bounded read per PO ─── */
async function phHistoryOf(poId,opts){
  const o=opts||{};
  const id=typeof poId==='string'?poId.trim():'';
  if(!/^PO-[0-9]{3,}$/.test(id))return{ok:false,rows:null,err:phErrInfo(new Error('not a PO id: '+poId))};
  if(!o.force&&_phHistCache[id])return{ok:true,rows:_phHistCache[id].rows.slice(),truncated:_phHistCache[id].truncated,cached:true};
  let lim=typeof o.limit==='number'&&isFinite(o.limit)?Math.floor(o.limit):PH_HISTORY_LIMIT;
  lim=Math.max(1,Math.min(PH_HISTORY_MAX,lim));
  try{
    const snap=await _phWithTimeout(getDocs(query(collection(db,'pos',id,'history'),orderBy('at','desc'),limit(lim))),PH_READ_TIMEOUT_MS);
    if(_phFromCache(snap))throw _phCacheError();
    const rows=((snap&&snap.docs)||[]).map(function(d){return Object.assign({},d.data(),{fbKey:d.id});});
    const truncated=rows.length>=lim;
    _phHistCache[id]={at:Date.now(),rows:rows,truncated:truncated};
    return{ok:true,rows:rows.slice(),truncated:truncated};
  }catch(e){
    const err=phErrInfo(e);
    return{ok:false,rows:null,err:err,text:err.permission?'pos history: could not be read - republish firestore.rules from the repo file, then retry.':'pos history: read failed ('+err.message+').'};
  }
}
function phHistoryForget(poId){if(poId===undefined)_phHistCache={};else delete _phHistCache[poId];}

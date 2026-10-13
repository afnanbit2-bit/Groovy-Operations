/* ─────────────────────────────────────────────────────────────────────────
   js/ph-write.js — Production Ops (`ph`), the DATA LAYER, writes (12 Oct 2026)

   NO UI. Nothing calls these yet. Every writer here writes ONLY the new
   collections of js/ph-data.js (PH_WRITE_ROOTS) and the append-only
   pos/{id}/history sub-collection. NO WRITER TOUCHES THE pos DOCUMENT ITSELF,
   `counters`, `gatepasses`, `bundles` or `fabric_*` -- the owner's rule is that
   no existing production data may be lost or rewritten. (Reading a pos document
   inside a transaction, to refuse a cut job for a PO that does not exist, is a
   read; the tests record every write path and fail on any other root.)

   How a writer behaves (shared by all of them):
     - async, NEVER throws: {ok:true,...} or {ok:false, code, error}. Codes:
       forbidden | offline | permission | stale | exists | missing | refused |
       invalid | unread | failed.
     - the document is BUILT by a pure builder (phBuild*), and the builder's
       key lists (PH_*_FIELDS) are held equal to firestore.rules by a test, so a
       writer and the rule it has to satisfy are tested together.
     - a state change and its pos history row land in ONE transaction (N4); a
       transaction cannot use the offline cache, so an offline press is refused
       out loud ('offline') instead of queued.
     - the client check (phCanSee / phCanManage ...) is a convenience; the rules
       are the boundary.
     - Frequent saves (a draft, a cut job) opt out of the blocking "Saving..."
       overlay with _gvSilentSaveStart/Stop (CLAUDE.md autosave note); one-off
       deliberate actions (a master, a standard, settings) keep the overlay.

   Loaded after js/ph-data.js (which it uses) and js/ph-core.js (the decisions).
   Everything global is prefixed ph / _ph / PH_.
   ───────────────────────────────────────────────────────────────────────── */

/* ── Field lists. firestore.rules mirrors each; tests/ph-data.test.js holds them equal. ─ */
const PH_DRAFT_STATUSES=Object.freeze(['draft','ready','abandoned','issued']);   // 'issued' is terminal and is written ONLY by js/ph-issue.js (phIssueDraft: managers, from ready, in the transaction that creates the pos document)
const PH_DRAFT_CREATE_FIELDS=Object.freeze(['id','status','rev','entryDevice','createdBy','createdByName','createdAt','updatedAt','updatedBy','po']);
const PH_DRAFT_EDIT_FIELDS=Object.freeze(['po','rev','updatedAt','updatedBy']);
const PH_DRAFT_READY_FIELDS=Object.freeze(['status','po','rev','readyAt','readyBy','updatedAt','updatedBy']);
const PH_DRAFT_BACK_FIELDS=Object.freeze(['status','rev','sentBackAt','sentBackBy','sentBackReason','updatedAt','updatedBy']);
const PH_DRAFT_ABANDON_FIELDS=Object.freeze(['status','rev','abandonedAt','abandonedBy','abandonedReason','updatedAt','updatedBy']);

const PH_JOB_STATUSES=Object.freeze(['open','complete','overridden','done']);
const PH_JOB_CREATE_FIELDS=Object.freeze(['poId','status','rev','plannedCutDate','masterId','masterName','plannedFabric','rollsChecklist','note','createdAt','createdBy','createdByName','updatedAt','updatedBy']);
const PH_JOB_MUTABLE_FIELDS=Object.freeze(['status','rev','plannedCutDate','masterId','masterName','plannedFabric','rollsChecklist','note','completedAt','completedBy','doneAt','updatedAt','updatedBy']);

// The cut job transition table: [from, to, who]. who = floor (the audience), manager, owner.
// firestore.rules prints the same table in the comment above phJobStep and enforces it in
// phJobWho; tests/ph-data.test.js compares the two, tests/rules-emulator-ph.js runs every row
// as every kind of caller. 'done' is terminal: nothing leaves it.
const PH_JOB_TRANSITIONS=Object.freeze([
  Object.freeze(['open','open','floor']),Object.freeze(['open','complete','floor']),Object.freeze(['open','overridden','owner']),Object.freeze(['open','done','manager']),
  Object.freeze(['complete','open','manager']),Object.freeze(['complete','complete','manager']),Object.freeze(['complete','overridden','owner']),Object.freeze(['complete','done','manager']),
  Object.freeze(['overridden','open','owner']),Object.freeze(['overridden','complete','owner']),Object.freeze(['overridden','overridden','owner']),Object.freeze(['overridden','done','owner'])
]);
const PH_DAYS_MAX=3650;                           // rules: delayTargetDays / stuckDays are 0..3650
const PH_HISTORY_NAME_MAX=60,PH_HISTORY_FT_MAX=80,PH_HISTORY_KEYS_MAX=40;   // rules: byName, from/to, data keys
const PH_MASTER_KINDS=Object.freeze(['inhouse','outsource','unset']);
const PH_MASTER_CREATE_FIELDS=Object.freeze(['id','name','nameKey','kind','active','aliases','notes','createdAt','createdBy','createdByName','updatedAt','updatedBy','retiredAt','retiredBy','retiredReason']);
const PH_MASTER_MUTABLE_FIELDS=Object.freeze(['name','nameKey','kind','active','aliases','notes','retiredAt','retiredBy','retiredReason','updatedAt','updatedBy']);

const PH_STANDARD_CREATE_FIELDS=Object.freeze(['code','unit','grossPerPiece','tolerancePct','sizes','sizeModel','reason','rev','createdAt','createdBy','createdByName','updatedAt','updatedBy']);
const PH_STANDARD_MUTABLE_FIELDS=Object.freeze(['unit','grossPerPiece','tolerancePct','sizes','sizeModel','reason','rev','updatedAt','updatedBy']);

const PH_SETTINGS_VALUE_FIELDS=Object.freeze(['dailyCapacity','skipDays','offWeekdays','delayTargetDays','stuckDays','grossOverTolPct','grossUnderTolPct','cutGate','pcOnlyHard']);
const PH_SETTINGS_FIELDS=Object.freeze(PH_SETTINGS_VALUE_FIELDS.concat(['rev','updatedAt','updatedBy']));
const PH_COUNTER_FIELDS=Object.freeze(['cutting_masters','updatedAt','updatedBy']);

const PH_HISTORY_FIELDS=Object.freeze(['at','by','byName','type','from','to','reason','data']);
const PH_HIST_TYPE_RE=/^[a-z][a-z_]{1,39}$/;     // rules: the same pattern
const PH_CODE_RE=/^[A-Z0-9][A-Z0-9._-]{1,39}$/;  // an article code (rules: ph_standards id)
const PH_DRAFT_ID_RE=/^DRAFT-[0-9A-Z]+-[0-9A-Z]{4}$/;
const PH_PO_ID_RE=/^PO-[0-9]{3,}$/;
const PH_MASTER_ID_RE=/^CM-[0-9]{3,}$/;
const PH_HISTORY_ROW_RE=/^[0-9]{13}-[A-Za-z0-9]{4}$/;
const PH_PO_MAX_BYTES=300000;                     // a draft's po map; the Firestore document limit is 1 MiB
const PH_HISTORY_DATA_MAX_BYTES=8000;

/* ── Small helpers ──────────────────────────────────────────────────────── */
function _phFail(code,error,extra){return Object.assign({ok:false,code:code,error:error},extra||{});}
function _phNowOf(o){return o&&typeof o.now==='number'&&isFinite(o.now)?Math.floor(o.now):Date.now();}
function _phActor(o){
  const a=o&&o.actor;
  if(a&&typeof a.u==='string'&&a.u)return{u:a.u,name:typeof a.name==='string'&&a.name?a.name:a.u};
  const u=typeof session!=='undefined'&&session&&typeof session.u==='string'?session.u:'';
  const name=typeof session!=='undefined'&&session&&typeof session.name==='string'&&session.name?session.name:u;
  return{u:u,name:name};
}
function _phOffline(){return typeof navigator!=='undefined'&&!!navigator&&navigator.onLine===false;}
function _phRand(n,alphabet){let s='';for(let i=0;i<n;i++)s+=alphabet.charAt(Math.floor(Math.random()*alphabet.length));return s;}
function _phIsObj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function _phHasNestedArray(x,inArr){
  if(Array.isArray(x)){if(inArr)return true;return x.some(function(v){return _phHasNestedArray(v,true);});}
  if(_phIsObj(x))return Object.keys(x).some(function(k){return _phHasNestedArray(x[k],false);});
  return false;
}
// A plain JSON-safe copy of a map, or {error}. Firestore refuses undefined, functions, and arrays
// of arrays outright ("Nested arrays are not supported"), so each is refused here, by name.
function _phPlainMap(x,maxBytes,what){
  if(!_phIsObj(x))return{error:what+' must be an object'};
  let copy;
  try{copy=JSON.parse(JSON.stringify(x));}catch(e){return{error:what+' cannot be stored ('+((e&&e.message)||e)+')'};}
  if(_phHasNestedArray(copy,false))return{error:what+' holds an array inside an array, which Firestore refuses'};
  if(JSON.stringify(copy).length>maxBytes)return{error:what+' is too large to store'};
  return{value:copy};
}
function _phStr(x,max){return typeof x==='string'?x.trim().slice(0,max):'';}
// Map a thrown error to a refusal a screen can print.
function _phFromError(e){
  const i=typeof phErrInfo==='function'?phErrInfo(e):{code:e&&e.code||'',message:String(e&&e.message||e),permission:false};
  if(e&&e.phRefusal)return _phFail(e.phRefusal.code,e.phRefusal.error,e.phRefusal.extra);
  if(i.permission)return _phFail('permission','Refused by the database rules. Republish firestore.rules from the repo file (the Production Ops block) and retry. If it was published, check that this device\'s clock is right (a history row is refused when the clock is more than two days off).',{detail:i.message});
  if(i.code==='unavailable'||/offline/i.test(i.message))return _phFail('offline','No connection. This needs to be online (a transaction cannot be queued) - try again when the connection is back.',{detail:i.message});
  return _phFail('failed','Could not save ('+i.message+').',{detail:i.message});
}
function _phRefuse(code,error,extra){const e=new Error(error);e.phRefusal={code:code,error:error,extra:extra};return e;}
function _phSilent(on,fn){
  if(on&&typeof window!=='undefined'&&window&&typeof window._gvSilentSaveStart==='function')window._gvSilentSaveStart();
  return Promise.resolve().then(fn).then(function(r){if(on&&typeof window!=='undefined'&&window&&typeof window._gvSilentSaveStop==='function')window._gvSilentSaveStop();return r;},
    function(e){if(on&&typeof window!=='undefined'&&window&&typeof window._gvSilentSaveStop==='function')window._gvSilentSaveStop();throw e;});
}
function _phLog(action,detail){try{if(typeof logActivity==='function')logActivity(action,detail||'');}catch(e){}}
// Keep the loaded copy (if that stage was read) in step with what was just written.
function _phPatchLocal(stage,key,docData){
  if(typeof _phLoad==='undefined'||!_phLoad[stage]||_phLoad[stage].state!=='ok')return;
  const row=Object.assign({},docData,{fbKey:key});
  if(stage==='settings'){_phData.settings=Object.assign({},docData);return;}
  const list=Array.isArray(_phData[stage])?_phData[stage]:[];
  const i=list.findIndex(function(r){return r.fbKey===key;});
  if(i>-1)list[i]=row;else list.unshift(row);
  _phData[stage]=list;
  _phLoad[stage].n=list.length;
}

/* ── Ids ───────────────────────────────────────────────────────────────── */
function phDraftId(now,rand){
  const t=typeof now==='number'&&isFinite(now)?Math.floor(now):Date.now();
  const r=typeof rand==='string'&&/^[0-9A-Z]{4}$/.test(rand)?rand:_phRand(4,'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  return'DRAFT-'+t.toString(36).toUpperCase()+'-'+r;
}
// 13-digit ms + '-' + 4 chars: sorts oldest-first as text. null when the clock is not 13 digits.
function phHistoryRowId(now,rand){
  const t=typeof now==='number'&&isFinite(now)?Math.floor(now):Date.now();
  const s=String(t);
  if(s.length!==13)return null;
  const r=typeof rand==='string'&&/^[A-Za-z0-9]{4}$/.test(rand)?rand:_phRand(4,'abcdefghijklmnopqrstuvwxyz0123456789');
  return s+'-'+r;
}
function phMasterIdFor(n){return'CM-'+_phPad(n,3);}   // _phPad is js/ph-core.js's

/* ── Pure builders (no Firestore). Writers and the emulator test both use them. ─ */
// A history row: {at,by,byName,type,from,to,reason,data}. Returns {id,data} or {error}.
function phBuildHistoryRow(spec,ctx){
  const s=_phIsObj(spec)?spec:{},c=_phIsObj(ctx)?ctx:{};
  const type=typeof s.type==='string'?s.type:'';
  if(!PH_HIST_TYPE_RE.test(type))return{error:'a history type is lowercase letters and underscores (2 to 40 characters)'};
  const now=_phNowOf(c);
  const id=phHistoryRowId(now,c.rand);
  if(!id)return{error:'the clock does not give a 13-digit time, so a history row id cannot be made'};
  let data={};
  if(s.data!==undefined&&s.data!==null){
    const p=_phPlainMap(s.data,PH_HISTORY_DATA_MAX_BYTES,'history data');
    if(p.error)return{error:p.error};
    if(Object.keys(p.value).length>PH_HISTORY_KEYS_MAX)return{error:'history data has more than '+PH_HISTORY_KEYS_MAX+' keys'};
    data=p.value;
  }
  return{id:id,data:{at:now,by:c.u,byName:_phStr(c.name||c.u,PH_HISTORY_NAME_MAX),type:type,from:_phStr(s.from,PH_HISTORY_FT_MAX),to:_phStr(s.to,PH_HISTORY_FT_MAX),reason:_phStr(s.reason,500),data:data}};
}
function phBuildDraft(po,ctx){
  const c=ctx||{};
  const p=_phPlainMap(po,PH_PO_MAX_BYTES,'the PO draft');
  if(p.error)return{error:p.error};
  const now=_phNowOf(c);
  const id=typeof c.id==='string'&&c.id?c.id:phDraftId(now,c.rand);
  if(!PH_DRAFT_ID_RE.test(id))return{error:'bad draft id '+id};
  return{id:id,data:{id:id,status:'draft',rev:1,entryDevice:'pc',createdBy:c.u,createdByName:c.name||c.u,createdAt:now,updatedAt:now,updatedBy:c.u,po:p.value}};
}
function phDraftEditPatch(prev,po,ctx){
  const p=_phPlainMap(po,PH_PO_MAX_BYTES,'the PO draft');
  if(p.error)return{error:p.error};
  const now=_phNowOf(ctx);
  return{patch:{po:p.value,rev:prev.rev+1,updatedAt:now,updatedBy:ctx.u}};
}
function phDraftReadyPatch(prev,ctx){
  const now=_phNowOf(ctx);
  return{patch:{status:'ready',rev:prev.rev+1,readyAt:now,readyBy:ctx.u,updatedAt:now,updatedBy:ctx.u}};
}
function phDraftBackPatch(prev,reason,ctx){
  const now=_phNowOf(ctx);
  return{patch:{status:'draft',rev:prev.rev+1,sentBackAt:now,sentBackBy:ctx.u,sentBackReason:_phStr(reason,500),updatedAt:now,updatedBy:ctx.u}};
}
function phDraftAbandonPatch(prev,reason,ctx){
  const now=_phNowOf(ctx);
  return{patch:{status:'abandoned',rev:prev.rev+1,abandonedAt:now,abandonedBy:ctx.u,abandonedReason:_phStr(reason,500),updatedAt:now,updatedBy:ctx.u}};
}

// A planned-fabric block: {qty, unit, note}. kg and m are never mixed; a quantity with no
// unit is not a figure (phUnit is the core's).
function _phCleanFabric(x){
  if(x===null||x===undefined)return{value:null};
  if(!_phIsObj(x))return{error:'planned fabric must be an object'};
  const qty=phNum(x.qty),unit=phUnit(x.unit);
  if(qty===null||qty<=0)return{error:'planned fabric needs a quantity above zero'};
  if(unit===null)return{error:'planned fabric needs a unit, kg or m'};
  return{value:{qty:qty,unit:unit,note:_phStr(x.note,200)}};
}
function _phCleanChecklist(x){
  if(x===null||x===undefined)return{value:null};
  if(!_phIsObj(x))return{error:'the rolls checklist must be an object'};
  const out={};
  for(const k of['total','verified','short','missing','extra']){
    const v=phWhole(x[k]);
    if(v===null||v<0)return{error:'the rolls checklist '+k+' must be a whole number, zero or more'};
    out[k]=v;
  }
  // The WHICH-rolls detail (14 Oct 2026): optional lists of roll codes, kept inside the same map. firestore.rules checks
  // rollsChecklist only as a map (phJobShapeOk), so no rule list moves. A bad list is refused by name, never trimmed
  // quietly; the screen (js/ph-mod-cutting.js) clips to these limits first and says how many it left out.
  for(const k of['missingCodes','extraCodes']){
    if(x[k]===undefined||x[k]===null)continue;
    const l=_phCleanCodeList(x[k],k);
    if(l.error)return{error:l.error};
    out[k]=l.value;
  }
  return{value:out};
}
const PH_CODES_MAX=200,PH_CODE_LEN_MAX=40;
function _phCleanCodeList(x,what){
  if(!Array.isArray(x))return{error:'the rolls checklist '+what+' must be a list of roll codes'};
  const out=[],seen={};
  for(let i=0;i<x.length;i++){
    if(typeof x[i]!=='string')return{error:'the rolls checklist '+what+' holds something that is not text'};
    const t=x[i].trim();
    if(!t)continue;
    if(t.length>PH_CODE_LEN_MAX)return{error:'a roll code in '+what+' is longer than '+PH_CODE_LEN_MAX+' characters'};
    if(seen[t])continue;
    seen[t]=true;out.push(t);
  }
  if(out.length>PH_CODES_MAX)return{error:'the rolls checklist '+what+' has more than '+PH_CODES_MAX+' codes'};
  return{value:out};
}
// Builds a job's CREATE document (input is already cleaned) -- see phSaveCutJob.
function phBuildCutJob(poId,input,ctx){
  const now=_phNowOf(ctx);
  return{id:poId,data:{poId:poId,status:input.status||'open',rev:1,plannedCutDate:input.plannedCutDate===undefined?null:input.plannedCutDate,
    masterId:input.masterId===undefined?null:input.masterId,masterName:input.masterName===undefined?'':input.masterName,
    plannedFabric:input.plannedFabric===undefined?null:input.plannedFabric,rollsChecklist:input.rollsChecklist===undefined?null:input.rollsChecklist,
    note:input.note===undefined?'':input.note,createdAt:now,createdBy:ctx.u,createdByName:ctx.name||ctx.u,updatedAt:now,updatedBy:ctx.u}};
}
function phBuildMaster(name,id,ctx,opts){
  const now=_phNowOf(ctx),o=opts||{};
  const kind=PH_MASTER_KINDS.indexOf(o.kind)>-1?o.kind:'unset';
  return{id:id,data:{id:id,name:phNorm(name),nameKey:phMasterKey(name),kind:kind,active:true,aliases:[],notes:_phStr(o.notes,300),
    createdAt:now,createdBy:ctx.u,createdByName:ctx.name||ctx.u,updatedAt:now,updatedBy:ctx.u,retiredAt:null,retiredBy:null,retiredReason:''}};
}
function phBuildStandard(code,std,sizeModel,reason,ctx){
  const now=_phNowOf(ctx);
  return{id:code,data:{code:code,unit:std.unit,grossPerPiece:std.grossPerPiece,tolerancePct:std.tolerancePct,sizes:std.sizes,sizeModel:sizeModel,reason:_phStr(reason,300),
    rev:1,createdAt:now,createdBy:ctx.u,createdByName:ctx.name||ctx.u,updatedAt:now,updatedBy:ctx.u}};
}

/* ── Drafts ────────────────────────────────────────────────────────────── */
function _phNeedFloor(u){return phCanRecordFloor(u)?null:_phFail('forbidden','Production Ops drafts are for the Production Ops team.');}
function _phNeedManage(u){return phCanManage(u)?null:_phFail('forbidden','This is for the Production Ops managers (Afnan, Ammar, Mustafa).');}

// Create (id null) or edit a draft. Only a 'draft' can be edited (a ready one is sent back first).
// opts: {expectedRev, now, actor}. Edit refuses 'stale' when the stored rev differs.
async function phSaveDraft(id,po,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedFloor(a.u);if(no)return no;
  if(_phOffline())return _phFail('offline','No connection. A draft is saved with a transaction, which cannot be queued - try again when the connection is back.');
  try{
    return await _phSilent(true,async function(){
      const ctx={u:a.u,name:a.name,now:_phNowOf(o),rand:o.rand};
      if(id==null){
        const b=phBuildDraft(po,ctx);
        if(b.error)return _phFail('invalid',b.error);
        const ref=doc(db,'po_drafts',b.id);
        await runTransaction(db,async function(tx){
          const s=await tx.get(ref);
          if(s&&s.exists())throw _phRefuse('exists','Draft '+b.id+' already exists.');
          tx.set(ref,b.data);
        });
        _phPatchLocal('drafts',b.id,b.data);
        return{ok:true,id:b.id,created:true,rev:1,draft:b.data};
      }
      if(!PH_DRAFT_ID_RE.test(String(id)))return _phFail('invalid','Not a draft id: '+id);
      const ref=doc(db,'po_drafts',id);
      let saved=null;
      await runTransaction(db,async function(tx){
        const s=await tx.get(ref);
        if(!s||!s.exists())throw _phRefuse('missing','Draft '+id+' does not exist.');
        const prev=s.data();
        if(prev.status!=='draft')throw _phRefuse('refused','Draft '+id+' is '+prev.status+' and cannot be edited'+(prev.status==='ready'?' - send it back first.':'.'));
        if(o.expectedRev!=null&&prev.rev!==o.expectedRev)throw _phRefuse('stale','Draft '+id+' was changed by someone else (revision '+prev.rev+', yours was '+o.expectedRev+'). Reload it.',{rev:prev.rev});
        const b=phDraftEditPatch(prev,po,ctx);
        if(b.error)throw _phRefuse('invalid',b.error);
        tx.update(ref,b.patch);
        saved=Object.assign({},prev,b.patch);
      });
      _phPatchLocal('drafts',id,saved);
      return{ok:true,id:id,created:false,rev:saved.rev,draft:saved};
    });
  }catch(e){return _phFromError(e);}
}
// The generic status step shared by ready / send back / abandon.
async function _phDraftStep(id,o,build){
  const a=_phActor(o);
  if(!PH_DRAFT_ID_RE.test(String(id)))return _phFail('invalid','Not a draft id: '+id);
  if(_phOffline())return _phFail('offline','No connection. This needs to be online - try again when the connection is back.');
  try{
    return await _phSilent(true,async function(){
      const ctx={u:a.u,name:a.name,now:_phNowOf(o)};
      const ref=doc(db,'po_drafts',id);
      let saved=null;
      await runTransaction(db,async function(tx){
        const s=await tx.get(ref);
        if(!s||!s.exists())throw _phRefuse('missing','Draft '+id+' does not exist.');
        const prev=s.data();
        if(o.expectedRev!=null&&prev.rev!==o.expectedRev)throw _phRefuse('stale','Draft '+id+' was changed by someone else (revision '+prev.rev+'). Reload it.',{rev:prev.rev});
        const b=build(prev,ctx);
        if(b.refuse)throw _phRefuse(b.refuse.code,b.refuse.error,b.refuse.extra);
        tx.update(ref,b.patch);
        saved=Object.assign({},prev,b.patch);
      });
      _phPatchLocal('drafts',id,saved);
      return{ok:true,id:id,status:saved.status,rev:saved.rev,draft:saved};
    });
  }catch(e){return _phFromError(e);}
}
// Mark a draft ready: only when the completeness gate (js/ph-core.js phPoComplete) passes against the
// master registry that was loaded. A registry that did not load refuses -- it cannot be checked.
function phMarkDraftReady(id,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedFloor(a.u);if(no)return Promise.resolve(no);
  return _phDraftStep(id,o,function(prev,ctx){
    if(prev.status!=='draft')return{refuse:{code:'refused',error:'Draft '+id+' is '+prev.status+', not a draft.'}};
    const reg=phMasterList();
    const today=phDay(ctx.now);
    const gate=phPoComplete(Object.assign({},prev.po),{masters:reg,today:today});
    if(!gate.ok)return{refuse:{code:'refused',error:'The draft is not complete: '+gate.missing.map(function(m){return m.why;}).join('; ')+'.',extra:{missing:gate.missing,warnings:gate.warnings}}};
    return phDraftReadyPatch(prev,ctx);
  });
}
// Send a ready draft back to draft (managers).
function phSendBackDraft(id,reason,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedManage(a.u);if(no)return Promise.resolve(no);
  if(!_phStr(reason,500))return Promise.resolve(_phFail('invalid','A reason is needed to send a draft back.'));
  return _phDraftStep(id,o,function(prev,ctx){
    if(prev.status!=='ready')return{refuse:{code:'refused',error:'Draft '+id+' is '+prev.status+', not ready.'}};
    return phDraftBackPatch(prev,reason,ctx);
  });
}
function phAbandonDraft(id,reason,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedFloor(a.u);if(no)return Promise.resolve(no);
  if(!_phStr(reason,500))return Promise.resolve(_phFail('invalid','A reason is needed to abandon a draft.'));
  return _phDraftStep(id,o,function(prev,ctx){
    if(prev.status!=='draft'&&prev.status!=='ready')return{refuse:{code:'refused',error:'Draft '+id+' is '+prev.status+' already.'}};
    if(prev.status==='ready'&&!phCanManage(a.u))return{refuse:{code:'forbidden',error:'Only a manager can abandon a draft that is ready. Ask Afnan, Ammar or Mustafa.'}};   // the rules say the same
    return phDraftAbandonPatch(prev,reason,ctx);
  }).then(function(r){if(r.ok)_phLog('PO draft withdrawn',id+' - '+_phStr(reason,120));return r;});
}

/* ── Cut job transitions ─────────────────────────────────────────────────── */
// Who a step needs: 'floor' | 'manager' | 'owner', or null when the step does not exist
// (nothing leaves 'done'; an unknown status has no steps).
function phJobMoveWho(from,to){
  for(let i=0;i<PH_JOB_TRANSITIONS.length;i++){const t=PH_JOB_TRANSITIONS[i];if(t[0]===from&&t[1]===to)return t[2];}
  return null;
}
// null when `u` may make the step, else a refusal sentence (shared by the writer; the rules say the same).
function phJobMoveProblem(from,to,u){
  const who=phJobMoveWho(from,to);
  if(from==='done')return'The cut job is done and is not changed again.';
  if(!who)return'A cut job cannot go from '+from+' to '+to+'.';
  if(who==='owner'&&!phIsOwner(u))return from==='overridden'?'Only an owner can change a cut job that was overridden.':'Only an owner can mark a cut job overridden.';
  if(who==='manager'&&!phCanManage(u))return to==='done'?'Only a manager can close a cut job (mark it done).':from==='complete'&&to==='open'?'Only a manager can reopen a completed cut job.':'Only a manager can change a cut job after it is complete.';
  if(who==='floor'&&!phCanRecordFloor(u))return'Production Ops drafts are for the Production Ops team.';
  return null;
}

// The STRUCTURED detail of a plan or a move, for phSaveCutJob's opts.data (14 Oct 2026): what changed, from -> to, so a report
// need not parse the free-text reason. Only the two things the planning screens change (the planned day and the master).
// One change = {field,from,to}; more = {field:'plannedCutDate+master',changes:[{field,from,to},...]} (an array of maps is legal
// in Firestore; an array in an array is not). null = nothing moved, send no data. Strings are cut at the history from/to limit.
function phCutJobChangeData(prev,input){
  const p=_phIsObj(prev)?prev:{},i=_phIsObj(input)?input:{};
  const ch=[];
  if('plannedCutDate' in i){
    const f=_phStr(p.plannedCutDate||'',PH_HISTORY_FT_MAX),t=_phStr(i.plannedCutDate||'',PH_HISTORY_FT_MAX);
    if(f!==t)ch.push({field:'plannedCutDate',from:f,to:t});
  }
  if('masterId' in i||'masterName' in i){
    const lab=function(id,name){return _phStr([id||'',name||''].join(' ').trim(),PH_HISTORY_FT_MAX);};
    const f=lab(p.masterId,p.masterName);
    const t=lab('masterId' in i?i.masterId:p.masterId,'masterName' in i?i.masterName:p.masterName);
    if(f!==t)ch.push({field:'master',from:f,to:t});
  }
  if(!ch.length)return null;
  if(ch.length===1)return{field:ch[0].field,from:ch[0].from,to:ch[0].to};
  return{field:ch.map(function(c){return c.field;}).join('+'),changes:ch};
}

/* ── Cut jobs (the planned cut of one PO), with the history row in the SAME transaction ─ */
// input (all optional, only given keys change): {plannedCutDate:'YYYY-MM-DD'|null, masterId, masterName,
// plannedFabric:{qty,unit,note}|null, rollsChecklist:{total,verified,short,missing,extra[,missingCodes,extraCodes]}|null, note, status}.
// opts: {reason, expectedRev, data (optional map for the history row), actor...}.
// 'overridden' is an owner's decision. A job that is 'done' is never changed again.
// Reads pos/{poId} (a read) and refuses a PO that does not exist; writes po_cut_jobs/{poId} and
// pos/{poId}/history/{row} in one transaction.
async function phSaveCutJob(poId,input,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedFloor(a.u);if(no)return no;
  if(!PH_PO_ID_RE.test(String(poId)))return _phFail('invalid','Not a PO id: '+poId);
  const inp=_phIsObj(input)?input:{};
  const clean={};
  if('plannedCutDate' in inp){
    if(inp.plannedCutDate!==null&&!phIsDay(inp.plannedCutDate))return _phFail('invalid','The planned cut date must be a day, YYYY-MM-DD.');
    clean.plannedCutDate=inp.plannedCutDate;
  }
  if('masterId' in inp){
    if(inp.masterId!==null&&!PH_MASTER_ID_RE.test(String(inp.masterId)))return _phFail('invalid','Not a cutting master id: '+inp.masterId);
    clean.masterId=inp.masterId;
  }
  if('masterName' in inp)clean.masterName=phNorm(inp.masterName);
  if('plannedFabric' in inp){const f=_phCleanFabric(inp.plannedFabric);if(f.error)return _phFail('invalid',f.error);clean.plannedFabric=f.value;}
  if('rollsChecklist' in inp){const f=_phCleanChecklist(inp.rollsChecklist);if(f.error)return _phFail('invalid',f.error);clean.rollsChecklist=f.value;}
  if('note' in inp)clean.note=_phStr(inp.note,500);
  if('status' in inp){
    if(PH_JOB_STATUSES.indexOf(inp.status)<0)return _phFail('invalid','Not a cut job status: '+inp.status);
    if(inp.status==='overridden'&&!phIsOwner(a.u))return _phFail('forbidden','Only an owner can mark a cut job overridden.');
    clean.status=inp.status;
  }
  // Optional structured detail for the history row (e.g. {field:'plannedCutDate',from,to}), checked BEFORE any round trip
  // against the same limits as every history row (a plain map, at most PH_HISTORY_KEYS_MAX keys INCLUDING the writer's own
  // jobRev, which always wins). Not given = the row carries jobRev only, as before.
  let extraData={};
  if(o.data!==undefined&&o.data!==null){
    if(!_phIsObj(o.data))return _phFail('invalid','The history data must be an object.');
    const t=phBuildHistoryRow({type:'cut_job_updated',data:Object.assign({},o.data,{jobRev:0})},{u:a.u,name:a.name,now:_phNowOf(o),rand:o.rand});
    if(t.error)return _phFail('invalid',t.error);
    extraData=o.data;
  }
  if(_phOffline())return _phFail('offline','No connection. A cut job is saved with a transaction, which cannot be queued - try again when the connection is back.');
  try{
    return await _phSilent(true,async function(){
      const now=_phNowOf(o);
      const ctx={u:a.u,name:a.name,now:now,rand:o.rand};
      const jref=doc(db,'po_cut_jobs',poId),pref=doc(db,'pos',poId);
      let created=false,saved=null,histId=null;
      await runTransaction(db,async function(tx){
        const ps=await tx.get(pref);                       // a READ of the existing PO: refuse a job for a PO that is not there
        if(!ps||!ps.exists())throw _phRefuse('missing','PO '+poId+' does not exist, so it cannot have a cut job.');
        const js=await tx.get(jref);
        let type,from='',to='';
        if(!js||!js.exists()){
          if(clean.status&&clean.status!=='open')throw _phRefuse('refused','A new cut job starts open.');
          created=true;type='cut_job_opened';
          const b=phBuildCutJob(poId,clean,ctx);
          saved=b.data;
          tx.set(jref,saved);
          to=saved.status;
        }else{
          const prev=js.data();
          if(prev.status==='done')throw _phRefuse('refused','The cut job of '+poId+' is done and is not changed again.');
          if(o.expectedRev!=null&&prev.rev!==o.expectedRev)throw _phRefuse('stale','The cut job of '+poId+' was changed by someone else (revision '+prev.rev+'). Reload it.',{rev:prev.rev});
          const problem=phJobMoveProblem(prev.status,clean.status||prev.status,a.u);   // the rules' transition table, said before the round trip
          if(problem)throw _phRefuse('forbidden',problem);
          const patch=Object.assign({},clean,{rev:prev.rev+1,updatedAt:now,updatedBy:a.u});
          if(patch.status==='complete'&&prev.status!=='complete'){patch.completedAt=now;patch.completedBy=a.u;}
          if(patch.status==='done'){patch.doneAt=now;}
          created=false;type='cut_job_updated';
          tx.update(jref,patch);
          saved=Object.assign({},prev,patch);
          from=prev.status||'';to=saved.status||'';
        }
        const h=phBuildHistoryRow({type:type,from:from,to:to,reason:_phStr(o.reason,500),data:Object.assign({},extraData,{jobRev:saved.rev})},ctx);
        if(h.error)throw _phRefuse('invalid',h.error);
        histId=h.id;
        tx.set(doc(db,'pos',poId,'history',h.id),h.data);   // the history row, in the SAME transaction
      });
      _phPatchLocal('jobs',poId,saved);
      if(typeof phHistoryForget==='function')phHistoryForget(poId);
      return{ok:true,id:poId,created:created,rev:saved.rev,job:saved,historyId:histId};
    });
  }catch(e){return _phFromError(e);}
}

/* ── pos history, on its own (a row with no parent write) ───────────────── */
// spec: {type, from, to, reason, data}. One create under pos/{poId}/history; the PO must exist (rules).
async function phAppendHistory(poId,spec,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedFloor(a.u);if(no)return no;
  if(!PH_PO_ID_RE.test(String(poId)))return _phFail('invalid','Not a PO id: '+poId);
  const h=phBuildHistoryRow(spec,{u:a.u,name:a.name,now:_phNowOf(o),rand:o.rand});
  if(h.error)return _phFail('invalid',h.error);
  if(_phOffline())return _phFail('offline','No connection. Try again when the connection is back.');
  try{
    await _phSilent(true,function(){return setDoc(doc(db,'pos',poId,'history',h.id),h.data);});
    if(typeof phHistoryForget==='function')phHistoryForget(poId);
    return{ok:true,id:h.id,row:h.data};
  }catch(e){return _phFromError(e);}
}

/* ── Cutting masters (managers) ─────────────────────────────────────────── */
function _phMasterNameCheck(name,exceptId){
  const n=phNorm(name);
  if(!n)return{error:'A master needs a name.'};
  const list=phMasterList();
  if(list===null)return{error:'The master list has not been read, so a duplicate cannot be ruled out. Load it first.',code:'unread'};
  const key=phMasterKey(n);
  for(let i=0;i<list.length;i++){
    const m=list[i];
    if(m.fbKey===exceptId)continue;
    if((m.nameKey||phMasterKey(m.name))===key||(Array.isArray(m.aliases)&&m.aliases.indexOf(key)>-1))
      return{error:'"'+n+'" is already in the registry as '+m.name+' ('+m.fbKey+')'+(m.active===false?' (retired).':'.'),code:'exists'};
  }
  return{name:n};
}
// Add a master. The id comes from ph_settings/counters (a NEW document -- never the app's counters/main),
// minted in the same transaction as the master, floored against ids that already exist.
async function phMasterAdd(name,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedManage(a.u);if(no)return no;
  const chk=_phMasterNameCheck(name,null);
  if(chk.error)return _phFail(chk.code||'invalid',chk.error);
  if(_phOffline())return _phFail('offline','No connection. Adding a master is a transaction and cannot be queued.');
  try{
    return await _phSilent(false,async function(){
      const now=_phNowOf(o),ctx={u:a.u,name:a.name,now:now};
      const cref=doc(db,'ph_settings','counters');
      let master=null;
      await runTransaction(db,async function(tx){
        const cs=await tx.get(cref);
        const had=!!cs&&cs.exists();
        let n=((had&&phWhole(cs.data().cutting_masters))||0)+1;
        let id=phMasterIdFor(n);
        for(let i=0;i<50;i++){
          const ms=await tx.get(doc(db,'cutting_masters',id));
          if(!ms||!ms.exists())break;
          n++;id=phMasterIdFor(n);
        }
        const b=phBuildMaster(chk.name,id,ctx,o);
        tx.set(cref,{cutting_masters:n,updatedAt:now,updatedBy:a.u});
        tx.set(doc(db,'cutting_masters',id),b.data);
        master=b;
      });
      _phPatchLocal('masters',master.id,master.data);
      _phLog('Cutting master added',master.data.name+' ('+master.id+')');
      return{ok:true,id:master.id,master:master.data};
    });
  }catch(e){return _phFromError(e);}
}
async function _phMasterUpdate(id,o,build,logText){
  const a=_phActor(o);
  const no=_phNeedManage(a.u);if(no)return no;
  if(!PH_MASTER_ID_RE.test(String(id)))return _phFail('invalid','Not a cutting master id: '+id);
  if(_phOffline())return _phFail('offline','No connection. This is a transaction and cannot be queued.');
  try{
    return await _phSilent(false,async function(){
      const ctx={u:a.u,name:a.name,now:_phNowOf(o)};
      const ref=doc(db,'cutting_masters',id);
      let saved=null;
      await runTransaction(db,async function(tx){
        const s=await tx.get(ref);
        if(!s||!s.exists())throw _phRefuse('missing','Cutting master '+id+' does not exist.');
        const prev=s.data();
        const b=build(prev,ctx);
        if(b.refuse)throw _phRefuse(b.refuse.code,b.refuse.error);
        tx.update(ref,b.patch);
        saved=Object.assign({},prev,b.patch);
      });
      _phPatchLocal('masters',id,saved);
      _phLog(logText(saved),saved.name+' ('+id+')');
      return{ok:true,id:id,master:saved};
    });
  }catch(e){return _phFromError(e);}
}
// Rename a master. The old name's key is kept in `aliases`, so a gate pass that still carries the old
// name keeps resolving to this master.
function phMasterRename(id,name,opts){
  const o=opts||{};
  const chk=_phMasterNameCheck(name,id);
  if(chk.error)return Promise.resolve(_phFail(chk.code||'invalid',chk.error));
  return _phMasterUpdate(id,o,function(prev,ctx){
    const oldKey=prev.nameKey||phMasterKey(prev.name);
    const newKey=phMasterKey(chk.name);
    if(oldKey===newKey&&prev.name===chk.name)return{refuse:{code:'refused',error:'That is already its name.'}};
    let aliases=(Array.isArray(prev.aliases)?prev.aliases.slice():[]).filter(function(k){return k!==newKey;});
    if(oldKey!==newKey&&aliases.indexOf(oldKey)<0)aliases.push(oldKey);
    aliases=aliases.slice(-20);
    return{patch:{name:chk.name,nameKey:newKey,aliases:aliases,updatedAt:ctx.now,updatedBy:ctx.u}};
  },function(){return'Cutting master renamed';});
}
// Retire (active:false, with a reason) or reactivate a master. A master is never deleted.
function phMasterSetActive(id,active,reason,opts){
  const o=opts||{};
  if(active!==true&&active!==false)return Promise.resolve(_phFail('invalid','active must be true or false.'));
  if(active===false&&!_phStr(reason,300))return Promise.resolve(_phFail('invalid','A reason is needed to retire a master.'));
  return _phMasterUpdate(id,o,function(prev,ctx){
    if((prev.active!==false)===active)return{refuse:{code:'refused',error:'Cutting master '+id+' is already '+(active?'active':'retired')+'.'}};
    return active
      ?{patch:{active:true,retiredAt:null,retiredBy:null,retiredReason:'',updatedAt:ctx.now,updatedBy:ctx.u}}
      :{patch:{active:false,retiredAt:ctx.now,retiredBy:ctx.u,retiredReason:_phStr(reason,300),updatedAt:ctx.now,updatedBy:ctx.u}};
  },function(m){return m.active?'Cutting master reactivated':'Cutting master retired';});
}

// Change a master's kind (inhouse | outsource | unset). Managers; the rules' update key list includes `kind`.
function phMasterSetKind(id,kind,opts){
  const o=opts||{};
  if(PH_MASTER_KINDS.indexOf(kind)<0)return Promise.resolve(_phFail('invalid','The kind must be inhouse, outsource or unset.'));
  return _phMasterUpdate(id,o,function(prev,ctx){
    if((prev.kind||'unset')===kind)return{refuse:{code:'refused',error:'Cutting master '+id+' is already '+kind+'.'}};
    return{patch:{kind:kind,updatedAt:ctx.now,updatedBy:ctx.u}};
  },function(){return'Cutting master kind changed';});
}

/* ── Consumption standards (managers) ───────────────────────────────────── */
// input: {unit:'kg'|'m', grossPerPiece:number>0, tolerancePct?:0..100, sizes?:{size:gross}, sizeModel?:'alpha'|'waist'|'free', reason?}.
// Cleaned by the core's phStandard (the one definition of a valid standard). One document per article
// (id = code); a re-save bumps rev. NOTE: this keeps the CURRENT standard only -- no version history yet.
async function phStandardSave(code,input,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedManage(a.u);if(no)return no;
  const cd=typeof code==='string'?code.trim().toUpperCase():'';
  if(!PH_CODE_RE.test(cd))return _phFail('invalid','Not an article code: '+code);
  const inp=_phIsObj(input)?input:{};
  const std=phStandard(inp);
  if(std===null)return _phFail('invalid','A standard needs a unit (kg or m) and a gross per piece above zero.');
  let model=null;
  if(inp.sizeModel!==undefined&&inp.sizeModel!==null){
    if(typeof inp.sizeModel!=='string'||!Object.prototype.hasOwnProperty.call(PH_SIZE_MODELS,inp.sizeModel))return _phFail('invalid','The size model must be alpha, waist or free.');
    model=inp.sizeModel;
  }
  if(_phOffline())return _phFail('offline','No connection. Saving a standard is a transaction and cannot be queued.');
  try{
    return await _phSilent(false,async function(){
      const now=_phNowOf(o),ctx={u:a.u,name:a.name,now:now};
      const ref=doc(db,'ph_standards',cd);
      let saved=null,created=false;
      await runTransaction(db,async function(tx){
        const s=await tx.get(ref);
        if(!s||!s.exists()){created=true;saved=phBuildStandard(cd,std,model,inp.reason,ctx).data;tx.set(ref,saved);return;}
        const prev=s.data();
        if(o.expectedRev!=null&&prev.rev!==o.expectedRev)throw _phRefuse('stale','The standard of '+cd+' was changed by someone else (revision '+prev.rev+'). Reload it.',{rev:prev.rev});
        const patch={unit:std.unit,grossPerPiece:std.grossPerPiece,tolerancePct:std.tolerancePct,sizes:std.sizes,sizeModel:model,reason:_phStr(inp.reason,300),rev:prev.rev+1,updatedAt:now,updatedBy:a.u};
        tx.update(ref,patch);
        created=false;saved=Object.assign({},prev,patch);
      });
      _phPatchLocal('standards',cd,saved);
      _phLog('Production standard updated',cd+' '+saved.grossPerPiece+' '+saved.unit+'/piece');
      return{ok:true,id:cd,created:created,rev:saved.rev,standard:saved};
    });
  }catch(e){return _phFromError(e);}
}

/* ── Settings (managers; the PC-only switch is an owner's) ──────────────── */
// patch: any of PH_SETTINGS_VALUE_FIELDS. Validated through the core (_phSettingsFb): a value the core would
// REPLACE with a default is refused instead, naming the field -- a settings save never quietly stores
// something other than what was typed. Only keys that are set are stored; the rest stay defaults.
async function phSettingsSave(patch,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedManage(a.u);if(no)return no;
  if(!_phIsObj(patch)||!Object.keys(patch).length)return _phFail('invalid','Nothing to save.');
  const bad=Object.keys(patch).filter(function(k){return PH_SETTINGS_VALUE_FIELDS.indexOf(k)<0;});
  if(bad.length)return _phFail('invalid','Not a Production Ops setting: '+bad.join(', ')+'.');
  if('pcOnlyHard' in patch){
    if(patch.pcOnlyHard!==null&&typeof patch.pcOnlyHard!=='boolean')return _phFail('invalid','pcOnlyHard must be true or false (or null to go back to the default).');
    if(!phIsOwner(a.u))return _phFail('forbidden','Only an owner can switch the hard PC-only rule.');
  }
  // null = CLEAR the saved value, back to the default (14 Oct 2026). The save writes the WHOLE document, so a cleared key is
  // simply left out; phSettingsOk in firestore.rules is `!('x' in d) || ...` for every value, so an omitted key is legal.
  // The delay target and the stuck limit are judged as a pair by the core, so they are cleared together or not at all.
  const clearing=Object.keys(patch).filter(function(k){return patch[k]===null;});
  if((patch.delayTargetDays===null)!==(patch.stuckDays===null))
    return _phFail('invalid','The delay target and the stuck limit go back to their defaults together: clear both or neither.');
  if(typeof _phSettingsFb!=='function')return _phFail('failed','js/ph-core.js is not loaded, so settings cannot be checked.');
  if(_phOffline())return _phFail('offline','No connection. Saving settings is a transaction and cannot be queued.');
  try{
    return await _phSilent(false,async function(){
      const now=_phNowOf(o);
      const ref=doc(db,'ph_settings','main');
      let saved=null,created=false;
      await runTransaction(db,async function(tx){
        const s=await tx.get(ref);
        const prev=s&&s.exists()?s.data():null;
        if(prev&&o.expectedRev!=null&&prev.rev!==o.expectedRev)throw _phRefuse('stale','Settings were changed by someone else (revision '+prev.rev+'). Reload them.',{rev:prev.rev});
        const merged={};
        PH_SETTINGS_VALUE_FIELDS.forEach(function(k){
          if(prev&&k in prev)merged[k]=prev[k];
          if(k in patch){if(patch[k]===null)delete merged[k];else merged[k]=patch[k];}
        });
        if(clearing.length){
          if(!prev)throw _phRefuse('refused','Nothing has been saved yet, so there is nothing to put back to its default.');
          if(clearing.every(function(k){return!(k in prev);}))throw _phRefuse('refused','Nothing to clear: '+clearing.join(', ')+(clearing.length===1?' has':' have')+' no saved value (already the default).');
        }
        const fb=_phSettingsFb(merged);
        const given=fb.fallback.filter(function(f){return Object.keys(patch).some(function(k){return f.field.indexOf(k)>-1;});});
        if(given.length)throw _phRefuse('invalid',given.map(function(f){return f.field+': '+f.why;}).join('; ')+'.');
        const doc_={};
        PH_SETTINGS_VALUE_FIELDS.forEach(function(k){
          if(!(k in merged))return;
          if(k==='pcOnlyHard')doc_[k]=merged[k]===true;
          else if(k in fb.S)doc_[k]=fb.S[k];
        });
        ['delayTargetDays','stuckDays'].forEach(function(k){   // the rules bound both at 0..3650 days
          if(k in doc_&&(doc_[k]<0||doc_[k]>PH_DAYS_MAX))throw _phRefuse('invalid',k+': a number of days from 0 to '+PH_DAYS_MAX+'.');
        });
        doc_.rev=prev?prev.rev+1:1;doc_.updatedAt=now;doc_.updatedBy=a.u;
        created=!prev;
        tx.set(ref,doc_);                                   // the whole document: prev's keys are all in `merged`, none is lost
        saved=doc_;
      });
      _phPatchLocal('settings','main',saved);
      _phLog('Production Ops settings updated',Object.keys(patch).map(function(k){return patch[k]===null?k+' (default)':k;}).join(', '));
      return{ok:true,created:created,rev:saved.rev,settings:saved};
    });
  }catch(e){return _phFromError(e);}
}

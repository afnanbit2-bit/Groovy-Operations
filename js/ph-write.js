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
// Standing product instructions (WP3a). ph_article_instructions/{CODE} + revisions/{rev}; firestore.rules mirrors all three lists.
const PH_INSTR_CREATE_FIELDS=Object.freeze(['code','rev','placements','pantones','embroidery','notes','reason','createdAt','createdBy','createdByName','updatedAt','updatedBy']);
const PH_INSTR_MUTABLE_FIELDS=Object.freeze(['placements','pantones','embroidery','notes','reason','rev','updatedAt','updatedBy']);
const PH_INSTR_REVISION_FIELDS=Object.freeze(['code','rev','placements','pantones','embroidery','notes','reason','at','by','byName']);
// Manager marks (WP2). po_marks/{PO-nnn} + notes/{row}; firestore.rules mirrors all three lists.
const PH_MARKS_CREATE_FIELDS=Object.freeze(['poId','rev','marks','noteCount','lastNote','lastNoteBy','lastNoteAt','createdAt','createdBy','updatedAt','updatedBy','updatedByName']);
const PH_MARKS_MUTABLE_FIELDS=Object.freeze(['marks','rev','noteCount','lastNote','lastNoteBy','lastNoteAt','updatedAt','updatedBy','updatedByName']);
const PH_MARKS_NOTE_FIELDS=Object.freeze(['poId','seq','at','by','byName','text']);
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

/* ── Standing product instructions (managers) ───────────────────────────── */
// input: {placements,pantones,embroidery,notes,reason} (cleaned by the core's phInstructionsClean -- the one definition).
// Save = create (rev 1) or update (rev + 1, a reason is REQUIRED from rev 2), plus revisions/{rev}: a full snapshot,
// in the SAME transaction. Nothing is deleted; revisions are append-only. Writes no pos document.
function phBuildInstructions(code,clean,reason,ctx){
  const now=_phNowOf(ctx);
  return{id:code,data:{code:code,rev:1,placements:clean.placements,pantones:clean.pantones,embroidery:clean.embroidery,notes:clean.notes,reason:_phStr(reason,300),
    createdAt:now,createdBy:ctx.u,createdByName:ctx.name||ctx.u,updatedAt:now,updatedBy:ctx.u}};
}
function phBuildInstructionsRevision(doc_,ctx){
  return{id:String(doc_.rev),data:{code:doc_.code,rev:doc_.rev,placements:doc_.placements,pantones:doc_.pantones,embroidery:doc_.embroidery,notes:doc_.notes,reason:doc_.reason||'',
    at:_phNowOf(ctx),by:ctx.u,byName:ctx.name||ctx.u}};
}
async function phInstructionsSave(code,input,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedManage(a.u);if(no)return no;
  const cd=typeof code==='string'?code.trim().toUpperCase():'';
  if(!PH_CODE_RE.test(cd))return _phFail('invalid','Not an article code: '+code);
  if(typeof phInstructionsClean!=='function')return _phFail('failed','js/ph-core.js is not loaded, so instructions cannot be checked.');
  const inp=_phIsObj(input)?input:{};
  const cl=phInstructionsClean(inp);
  if(cl.problems.some(function(p){return/^At most/.test(p);}))return _phFail('invalid',cl.problems.filter(function(p){return/^At most/.test(p);}).join(' '));
  if(phInstructionsEmpty(cl.value))return _phFail('invalid','Nothing to save: add a placement, a Pantone colour, an embroidery row or a note.');
  if(_phOffline())return _phFail('offline','No connection. Saving instructions is a transaction and cannot be queued.');
  try{
    return await _phSilent(false,async function(){
      const now=_phNowOf(o),ctx={u:a.u,name:a.name,now:now};
      const ref=doc(db,'ph_article_instructions',cd);
      let saved=null,created=false,unchanged=false;
      await runTransaction(db,async function(tx){
        const s=await tx.get(ref);
        if(!s||!s.exists()){
          created=true;
          saved=phBuildInstructions(cd,cl.value,inp.reason,ctx).data;
          tx.set(ref,saved);
          const rv=phBuildInstructionsRevision(saved,ctx);
          tx.set(doc(db,'ph_article_instructions',cd,'revisions',rv.id),rv.data);
          return;
        }
        const prev=s.data();
        if(o.expectedRev!=null&&prev.rev!==o.expectedRev)throw _phRefuse('stale','The instructions of '+cd+' were changed by someone else (revision '+prev.rev+'). Reload them.',{rev:prev.rev});
        const reason=_phStr(inp.reason,300);
        if(!reason)throw _phRefuse('invalid','A reason is required for a new revision (what changed and why).');
        if(!phInstructionsDiff(prev,cl.value).length)throw _phRefuse('refused','Nothing has changed since revision '+prev.rev+'.');
        const patch={placements:cl.value.placements,pantones:cl.value.pantones,embroidery:cl.value.embroidery,notes:cl.value.notes,reason:reason,rev:prev.rev+1,updatedAt:now,updatedBy:a.u};
        tx.update(ref,patch);
        created=false;saved=Object.assign({},prev,patch);
        const rv=phBuildInstructionsRevision(saved,ctx);
        tx.set(doc(db,'ph_article_instructions',cd,'revisions',rv.id),rv.data);
      });
      _phPatchLocal('instructions',cd,saved);
      _phLog('Product instructions updated',cd+' revision '+saved.rev);
      return{ok:true,id:cd,created:created,rev:saved.rev,instructions:saved,problems:cl.problems};
    });
  }catch(e){return _phFromError(e);}
}
// The revisions of one article, newest first (bounded; a failed read is an error, never an empty list).
async function phInstructionsHistory(code,opts){
  const cd=typeof code==='string'?code.trim().toUpperCase():'';
  if(!PH_CODE_RE.test(cd))return{ok:false,rows:null,text:'Not an article code.'};
  try{
    const snap=await _phWithTimeout(getDocs(query(collection(db,'ph_article_instructions',cd,'revisions'),orderBy('rev','desc'),limit(50))),PH_READ_TIMEOUT_MS);
    if(_phFromCache(snap))throw _phCacheError();
    return{ok:true,rows:((snap&&snap.docs)||[]).map(function(d){return Object.assign({},d.data(),{fbKey:d.id});})};
  }catch(e){const err=phErrInfo(e);return{ok:false,rows:null,err:err,text:err.permission?'ph_article_instructions revisions: could not be read - republish firestore.rules from the repo file.':'revisions: read failed ('+err.message+').'};}
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

/* ── Manager marks on a PO (WP2) ─────────────────────────────────────────── */
// Managers only (afnan, ammar, mustafa). Writes po_marks/{PO-nnn} (and its notes) and NOTHING else: no pos document, no pos history row.
// input: {priority:'urgent'|'high'|'normal', hold:{reason}|null, highlight:colour|null, label:text}; cleaned by the core's phMarksClean,
// which is the one definition of a valid mark. The save REPLACES the marks map (a cleared mark is simply absent).
function phBuildMarks(poId,marks,ctx){
  const now=_phNowOf(ctx);
  return{id:poId,data:{poId:poId,rev:1,marks:marks,noteCount:0,lastNote:'',lastNoteBy:'',lastNoteAt:0,createdAt:now,createdBy:ctx.u,updatedAt:now,updatedBy:ctx.u,updatedByName:_phStr(ctx.name||ctx.u,60)}};
}
async function phMarksSave(poId,input,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedManage(a.u);if(no)return no;
  if(typeof poId!=='string'||!PH_PO_ID_RE.test(poId))return _phFail('invalid','Not a PO number: '+poId);
  if(typeof phMarksClean!=='function')return _phFail('failed','js/ph-core.js is not loaded, so marks cannot be checked.');
  const cl=phMarksClean(input);
  if(cl.problems.length)return _phFail('invalid',cl.problems.join(' '));
  if(_phOffline())return _phFail('offline','No connection. Saving a mark is a transaction and cannot be queued.');
  try{
    return await _phSilent(false,async function(){
      const now=_phNowOf(o),ctx={u:a.u,name:a.name,now:now};
      const ref=doc(db,'po_marks',poId);
      let saved=null,created=false,changed=[];
      await runTransaction(db,async function(tx){
        const s=await tx.get(ref);
        if(!s||!s.exists()){
          if(phMarksEmpty(cl.value))throw _phRefuse('refused','Nothing to save: no mark is set.');
          const p=await tx.get(doc(db,'pos',poId));
          if(!p||!p.exists())throw _phRefuse('missing','There is no PO '+poId+'.');
          created=true;changed=phMarksDiff({},cl.value);
          saved=phBuildMarks(poId,cl.value,ctx).data;
          tx.set(ref,saved);
          return;
        }
        const prev=s.data();
        if(o.expectedRev!=null&&prev.rev!==o.expectedRev)throw _phRefuse('stale','The marks of '+poId+' were changed by someone else (revision '+prev.rev+'). Reload them.',{rev:prev.rev});
        changed=phMarksDiff(prev.marks,cl.value);
        if(!changed.length)throw _phRefuse('refused','Nothing has changed since revision '+prev.rev+'.');
        const patch={marks:cl.value,rev:prev.rev+1,updatedAt:now,updatedBy:a.u,updatedByName:_phStr(a.name||a.u,60)};
        tx.update(ref,patch);
        created=false;saved=Object.assign({},prev,patch);
      });
      _phPatchLocal('marks',poId,saved);
      _phLog('PO marks updated',poId+': '+changed.join(', '));
      return{ok:true,id:poId,created:created,rev:saved.rev,changed:changed,marks:saved};
    });
  }catch(e){return _phFromError(e);}
}
// Add a comment to a PO's thread (append-only). The parent po_marks document is created on the first comment and
// its counter and last-comment preview move in the SAME transaction as the note row.
async function phMarkComment(poId,text,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phNeedManage(a.u);if(no)return no;
  if(typeof poId!=='string'||!PH_PO_ID_RE.test(poId))return _phFail('invalid','Not a PO number: '+poId);
  if(typeof phMarkNoteClean!=='function')return _phFail('failed','js/ph-core.js is not loaded, so a comment cannot be checked.');
  const nc=phMarkNoteClean(text);
  if(!nc.ok)return _phFail('invalid',nc.problem);
  if(_phOffline())return _phFail('offline','No connection. Saving a comment is a transaction and cannot be queued.');
  const now=_phNowOf(o);
  const rid=phHistoryRowId(now,o.rand);
  if(!rid)return _phFail('invalid','The clock does not give a 13-digit time, so a comment id cannot be made.');
  try{
    return await _phSilent(false,async function(){
      const ref=doc(db,'po_marks',poId);
      const name=_phStr(a.name||a.u,60);
      let saved=null,seq=0;
      await runTransaction(db,async function(tx){
        const s=await tx.get(ref);
        const preview={lastNote:nc.text.slice(0,PH_MARK_LAST_MAX),lastNoteBy:name,lastNoteAt:now};
        if(!s||!s.exists()){
          const p=await tx.get(doc(db,'pos',poId));
          if(!p||!p.exists())throw _phRefuse('missing','There is no PO '+poId+'.');
          seq=1;
          saved=phBuildMarks(poId,{},{u:a.u,name:a.name,now:now}).data;
          Object.assign(saved,preview,{noteCount:1});
          tx.set(ref,saved);
        }else{
          const prev=s.data();
          seq=(typeof prev.noteCount==='number'?prev.noteCount:0)+1;
          const patch=Object.assign({noteCount:seq,rev:prev.rev+1,updatedAt:now,updatedBy:a.u,updatedByName:name},preview);
          tx.update(ref,patch);
          saved=Object.assign({},prev,patch);
        }
        tx.set(doc(db,'po_marks',poId,'notes',rid),{poId:poId,seq:seq,at:now,by:a.u,byName:name,text:nc.text});
      });
      _phPatchLocal('marks',poId,saved);
      _phLog('PO comment added',poId);
      return{ok:true,id:poId,noteId:rid,seq:seq,marks:saved};
    });
  }catch(e){return _phFromError(e);}
}
// A PO's comment thread, newest first (bounded; a failed or offline-copy read is an error, never an empty list).
async function phMarkNotesOf(poId,opts){
  if(typeof poId!=='string'||!PH_PO_ID_RE.test(poId))return{ok:false,rows:null,text:'Not a PO number.'};
  try{
    const snap=await _phWithTimeout(getDocs(query(collection(db,'po_marks',poId,'notes'),orderBy('at','desc'),limit(100))),PH_READ_TIMEOUT_MS);
    if(_phFromCache(snap))throw _phCacheError();
    return{ok:true,rows:((snap&&snap.docs)||[]).map(function(d){return Object.assign({},d.data(),{fbKey:d.id});})};
  }catch(e){const err=phErrInfo(e);return{ok:false,rows:null,err:err,text:err.permission?'po_marks comments: could not be read - republish firestore.rules from the repo file.':'comments: read failed ('+err.message+').'};}
}

/* ── QC reconciliation (QC4, 15 Oct 2026): the lists, the transition table, the builders, and the two writers that
   touch NO pos document ──────────────────────────────────────────────────────────────────────────────────────────────
   po_qc_recon/{PO-nnn}  one per PO: the LOCKED cut snapshot (cutLock, a copy of pos.cutQty -- the rules hold the copy
                         equal to the PO's recorded cut), the status, a revision, the lot counters, the overrides log and
                         the close record. No received figure is stored: it is derived from the lots (js/ph-core.js phQc*).
   po_qc_lots/{PO-nnn}-{ms13}-{rand4}  append-only lot rows (one hand-over each: a {size: units} map); never edited, voided
                         by a status change. The id carries the PO id so the rules bind a row to its parent.
   This file keeps its rule (no writer here touches the pos document): phQcLockCut and phQcAdoptLegacy write only the two
   collections above and pos/{id}/history. The writers that DO touch pos -- a lot (mirrored into pos.packingReceipts so the
   classic QC Disposition / Ready to Barcode / B-stock readers keep working), a void (a counter entry there), the close (the
   classic Final QC fields), the relock and the reopen -- are js/ph-qc-write.js (the js/ph-issue.js precedent).
   firestore.rules mirrors every list and the transition table; tests/ph-data.test.js holds them equal. */
const PHQC_RECON_STATUSES=Object.freeze(['locked','closed','reopened']);
const PHQC_RECON_FIELDS=Object.freeze(['poId','status','rev','cutLock','lotCount','voidCount','lastLotAt','overrides','legacyIds','closedAt','closedBy','closedByName','closeVerdict','createdAt','createdBy','updatedAt','updatedBy','updatedByName']);
const PHQC_LOCK_FIELDS=Object.freeze(['sizes','total','cutAt','cutBy','lockedAt','lockedBy','source']);
const PHQC_LOCK_SOURCES=Object.freeze(['first_lot','manual','relock']);
const PHQC_OVERRIDE_FIELDS=Object.freeze(['kind','at','by','byName','reason','cause','before','after']);
const PHQC_OVERRIDE_KINDS=Object.freeze(['relock','close_short','reopen']);
const PHQC_CLOSE_CAUSES=Object.freeze(['cutting_miscount','lost_in_line','damaged_before_qc','other']);
const PHQC_LOT_FIELDS=Object.freeze(['poId','seq','sizes','total','day','note','at','by','byName','status','src']);
const PHQC_LOT_SOURCES=Object.freeze(['qc','legacy']);
const PHQC_LOT_VOID_FIELDS=Object.freeze(['status','voidedAt','voidedBy','voidReason']);
// The history row types the QC floor (Faizan) may write; managers already write any type (isProdOps()).
const PHQC_FLOOR_HIST_TYPES=Object.freeze(['qc_lot_added','qc_lot_voided','qc_cut_locked','qc_closed']);
const PHQC_OVERRIDES_MAX=20,PHQC_LEGACY_IDS_MAX=2000,PHQC_NOTE_MAX=200,PHQC_REASON_MIN=5,PHQC_VOID_REASON_MIN=3;
const PHQC_VOID_WINDOW_MS=86400000;              // Faizan voids his OWN lot within 24 h; a manager any time
const PHQC_LOT_ID_RE=/^PO-[0-9]{3,}-[0-9]{13}-[A-Za-z0-9]{4}$/;
const PHQC_LOTS_READ_MAX=500;                    // one PO's lots, read before a transaction (rules: none; a bound)
// The transition table: [from, to, action, who]. from '' = no document yet. who: ops (isQcOps: Faizan + the managers),
// manager (isProdOpsManager), owner (isOwner). 'closed' leaves only to 'reopened', by an owner.
// CHANGE FROM THE PLAN (owner decision, 15 Oct 2026): 'close_short' is a manager's close in ANY phase that is not 'ready'
// (still receiving, short, or over beyond the allowance), with a reason and an overrides row; a plain 'close' is the floor's
// or a manager's when the verdict is within tolerance. The rules print the same table above isQcFloor().
const PHQC_TRANSITIONS=Object.freeze([
  Object.freeze(['','locked','lock','ops']),Object.freeze(['','locked','adopt','manager']),
  Object.freeze(['locked','locked','lot','ops']),Object.freeze(['locked','locked','adopt','manager']),Object.freeze(['locked','locked','void','ops']),
  Object.freeze(['locked','locked','relock','owner']),Object.freeze(['locked','closed','close','ops']),Object.freeze(['locked','closed','close_short','manager']),
  Object.freeze(['closed','reopened','reopen','owner']),
  Object.freeze(['reopened','reopened','lot','ops']),Object.freeze(['reopened','reopened','adopt','manager']),Object.freeze(['reopened','reopened','void','ops']),
  Object.freeze(['reopened','reopened','relock','owner']),Object.freeze(['reopened','closed','close','ops']),Object.freeze(['reopened','closed','close_short','manager'])
]);
// Who a step needs ('ops' | 'manager' | 'owner'), or null when the step does not exist.
function phQcMoveWho(from,to,action){
  for(let i=0;i<PHQC_TRANSITIONS.length;i++){const t=PHQC_TRANSITIONS[i];if(t[0]===(from||'')&&t[1]===to&&t[2]===action)return t[3];}
  return null;
}
// null when `u` may make the step, else a sentence (the rules say the same).
function phQcMoveProblem(from,to,action,u){
  const who=phQcMoveWho(from,to,action);
  if(!who)return(from==='closed'?'This reconciliation is closed. Only an owner can reopen it.':'A QC reconciliation cannot go from '+(from||'nothing')+' to '+to+' ('+action+').');
  if(who==='owner'&&!phIsOwner(u))return'Only an owner (Afnan or Ammar) can do this.';
  if(who==='manager'&&!phCanManage(u))return'Only a manager (Afnan, Ammar or Mustafa) can do this.';
  if(who==='ops'&&!phCanQcOps(u))return'QC receiving is for QC Ops (Faizan) and the managers.';
  return null;
}
function _phQcwNeedOps(u){return phCanQcOps(u)?null:_phFail('forbidden','QC receiving is for QC Ops (Faizan) and the managers (Afnan, Ammar, Mustafa).');}
// expectedRev: a whole number >= 0 (0 = "this PO has no reconciliation yet"); null when it is missing or not that.
function _phQcwRev(x){return typeof x==='number'&&isFinite(x)&&Math.floor(x)===x&&x>=0?x:null;}
function _phQcwModel(po){
  if(typeof phSizeModel!=='function'||typeof _phPoArt!=='function')return null;
  const a=phSizeModel(_phPoArt(po||{}));return a.source==='default'?null:a.model;
}
// The cut lock built from the PO's RECORDED cut: a verbatim copy of pos.cutQty (the rules compare the two maps), refused unless
// cutting is recorded (stages.cutting.done), the map has 1..12 sizes, every value is a whole number >= 0 and they sum above 0.
// The ORDERED sizes are never a stand-in (the js/pos.js poCutBySize fallback is the trap this avoids). -> {lock} | {error}
function phQcBuildLock(po,ctx,source){
  const p=_phIsObj(po)?po:{};
  const done=_phIsObj(p.stages)&&_phIsObj(p.stages.cutting)&&p.stages.cutting.done===true;
  if(!done)return{error:'Cutting is not recorded on this PO yet, so its cut cannot be made final.'};
  const c=p.cutQty;
  if(!_phIsObj(c))return{error:'This PO carries no cut quantities, so its cut cannot be made final.'};
  const keys=Object.keys(c);
  if(keys.length<1||keys.length>PHQC_MAX_LOT_SIZES)return{error:'The cut of this PO names '+keys.length+' sizes; a cut holds 1 to '+PHQC_MAX_LOT_SIZES+'.'};
  let total=0;
  for(let i=0;i<keys.length;i++){
    const v=c[keys[i]];
    if(typeof v!=='number'||!isFinite(v)||Math.floor(v)!==v||v<0)return{error:'The cut of '+keys[i]+' is not stored as a whole number ('+JSON.stringify(v)+'), so it cannot be made final. Correct the cut first.'};
    total+=v;
  }
  if(total<=0)return{error:'The cut of this PO adds up to 0, so there is nothing to receive.'};
  if(typeof phQcExpected==='function'){const e=phQcExpected(Object.assign({},p),null,{model:_phQcwModel(p)});if(!e.ok||e.source!=='live')return{error:'The cut of this PO could not be read: '+(e.why||'unknown')+'.'};}
  if(PHQC_LOCK_SOURCES.indexOf(source)<0)return{error:'not a cut lock source: '+source};
  const sizes={};keys.forEach(function(k){sizes[k]=c[k];});
  return{lock:{sizes:sizes,total:total,cutAt:_phStr(typeof p.cutAt==='string'?p.cutAt:'',40),cutBy:_phStr(typeof p.cutBy==='string'?p.cutBy:'',60),
    lockedAt:_phNowOf(ctx),lockedBy:ctx.u,source:source}};
}
// A NEW reconciliation document (status locked). extra: {lotCount, lastLotAt, legacyIds}.
function phQcBuildRecon(poId,lock,ctx,extra){
  const now=_phNowOf(ctx),x=extra||{};
  return{poId:poId,status:'locked',rev:1,cutLock:lock,lotCount:x.lotCount||0,voidCount:0,lastLotAt:x.lastLotAt||0,overrides:[],
    legacyIds:Array.isArray(x.legacyIds)?x.legacyIds.slice():[],closedAt:0,closedBy:'',closedByName:'',closeVerdict:null,
    createdAt:now,createdBy:ctx.u,updatedAt:now,updatedBy:ctx.u,updatedByName:_phStr(ctx.name||ctx.u,60)};
}
// A lot id: the PO id, 13-digit ms and 4 characters. null when the clock is not 13 digits.
function phQcLotId(poId,now,rand){const h=phHistoryRowId(now,rand);return h&&PH_PO_ID_RE.test(String(poId))?poId+'-'+h:null;}
// The units of a lot, cleaned through the core: canonical keys, whole numbers, only the sizes above 0 stored.
// -> {sizes,total} | {error}. A lot holding nothing is refused here too (phQcLotProblem says it first).
function phQcLotSizes(input,model){
  if(!_phIsObj(input))return{error:'Enter the units received for each size.'};
  if(Object.keys(input).length>PHQC_MAX_LOT_SIZES)return{error:'A lot names at most '+PHQC_MAX_LOT_SIZES+' sizes.'};
  const m=_phQcMap(input,{model:model,blankIsZero:true});
  if(!m.ok)return{error:m.issues[0]+'.'};
  const sizes={};let total=0;
  m.order.forEach(function(k){if(m.sizes[k]>0){sizes[k]=m.sizes[k];total+=m.sizes[k];}});
  if(total<=0)return{error:'Nothing was entered - enter the units received for at least one size.'};
  return{sizes:sizes,total:total};
}
function phQcBuildLot(poId,seq,sizes,total,ctx,o){
  const x=o||{};
  const id=phQcLotId(poId,_phNowOf(ctx),ctx.rand);
  if(!id)return{error:'The clock does not give a 13-digit time, so a lot id cannot be made.'};
  return{id:id,data:{poId:poId,seq:seq,sizes:sizes,total:total,day:x.day,note:_phStr(x.note,PHQC_NOTE_MAX),at:_phNowOf(ctx),by:ctx.u,
    byName:_phStr(ctx.name||ctx.u,60),status:'live',src:PHQC_LOT_SOURCES.indexOf(x.src)>-1?x.src:'qc'}};
}
// An overrides row (relock / close_short / reopen). before/after are size maps (relock only); cause: close_short only.
function phQcBuildOverride(kind,reason,ctx,extra){
  const x=extra||{};
  const o={kind:kind,at:_phNowOf(ctx),by:ctx.u,byName:_phStr(ctx.name||ctx.u,60),reason:_phStr(reason,500)};
  if(kind==='close_short')o.cause=x.cause;
  if(x.before)o.before=x.before;
  if(x.after)o.after=x.after;
  return o;
}
// One PO's lots, read FRESH before a transaction (a single-field query: Firestore's automatic index serves it). Never throws.
// A failed, timed-out or offline-copy read is a failure ({ok:false}), never "no lots". -> {ok, rows, truncated} | {ok:false, error}
async function _phQcwLotsFresh(poId){
  try{
    const snap=await _phWithTimeout(getDocs(query(collection(db,'po_qc_lots'),where('poId','==',poId),limit(PHQC_LOTS_READ_MAX))),PH_READ_TIMEOUT_MS);
    if(_phFromCache(snap))throw _phCacheError();
    const rows=((snap&&snap.docs)||[]).map(function(d){return Object.assign({},d.data(),{fbKey:d.id,id:d.id});})
      .filter(function(r){return r&&r.poId===poId;});
    if(rows.length>=PHQC_LOTS_READ_MAX)return{ok:false,error:'PO '+poId+' has '+PHQC_LOTS_READ_MAX+' or more QC lots, more than one read covers; nothing was saved.'};
    return{ok:true,rows:rows};
  }catch(e){
    const i=phErrInfo(e);
    return{ok:false,error:'The QC lots of '+poId+' (po_qc_lots) could not be read'+(i.permission?' - republish firestore.rules from the repo file':'')+' ('+(i.message||i.code)+'). Nothing was saved. Retry.'};
  }
}
// The lots read before the transaction must be exactly what the reconciliation counts, or someone saved one in between.
function _phQcwLotsCheck(rows,recon){
  const want=recon?(typeof recon.lotCount==='number'?recon.lotCount:0):0;
  return rows.length===want?null:'The QC lots of this PO changed while you were saving (the reconciliation counts '+want+', '+rows.length+' were read). Reload and retry - nothing was saved.';
}
function _phQcwRecon(snap){return snap&&snap.exists()?snap.data():null;}
function _phQcwOpenStatus(r){return!!r&&(r.status==='locked'||r.status==='reopened');}
function _phQcwPatchLots(rows){
  if(typeof _phLoad==='undefined'||!_phLoad.lots||_phLoad.lots.state!=='ok')return;
  rows.forEach(function(x){_phPatchLocal('lots',x.id,x.data);});
}

/* Lock the cut of a PO as FINAL now (before any lot): QC is held to these numbers. QC Ops (Faizan) and the managers.
   opts: {expectedRev (0 = no reconciliation yet; required), reason, now, actor, rand}. One transaction: reads pos/{id} and the
   reconciliation; creates po_qc_recon/{id} (status locked, source manual) and a pos history row qc_cut_locked. */
async function phQcLockCut(poId,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phQcwNeedOps(a.u);if(no)return no;
  if(!PH_PO_ID_RE.test(String(poId)))return _phFail('invalid','Not a PO id: '+poId);
  const er=_phQcwRev(o.expectedRev);
  if(er===null)return _phFail('invalid','The reconciliation revision you are looking at is needed (0 when the PO has none yet). Reload and retry.');
  if(_phOffline())return _phFail('offline','No connection. Locking the cut is a transaction, which cannot be queued - nothing was saved.');
  try{
    return await _phSilent(false,async function(){
      const now=_phNowOf(o),ctx={u:a.u,name:a.name,now:now,rand:o.rand};
      const h=phBuildHistoryRow({type:'qc_cut_locked',from:'',to:'locked',reason:_phStr(o.reason,500)},ctx);
      if(h.error)return _phFail('invalid',h.error);
      const pref=doc(db,'pos',poId),rref=doc(db,'po_qc_recon',poId);
      let saved=null;
      await runTransaction(db,async function(tx){
        saved=null;
        const ps=await tx.get(pref);
        if(!ps||!ps.exists())throw _phRefuse('missing','PO '+poId+' does not exist.');
        const po=ps.data()||{};
        const r=_phQcwRecon(await tx.get(rref));
        if(r){
          if(r.rev!==er)throw _phRefuse('stale','The QC reconciliation of '+poId+' was changed by someone else (revision '+r.rev+'). Reload it.',{rev:r.rev});
          throw _phRefuse('refused','The cut of '+poId+' is already final (locked '+(r.cutLock&&r.cutLock.source==='manual'?'by hand':'when the first lot was received')+').');
        }
        if(er!==0)throw _phRefuse('stale','The QC reconciliation of '+poId+' is not what this screen shows. Reload it.');
        const st=phStageOf(po);
        if(st==='cancelled'||st==='reserved')throw _phRefuse('refused','PO '+poId+' is '+st+', so its cut is not locked for QC.');
        const lk=phQcBuildLock(po,ctx,'manual');
        if(lk.error)throw _phRefuse('refused',lk.error);
        const m=phQcMoveProblem('','locked','lock',a.u);if(m)throw _phRefuse('forbidden',m);
        saved=phQcBuildRecon(poId,lk.lock,ctx,{lotCount:0});
        tx.set(rref,saved);
        tx.set(doc(db,'pos',poId,'history',h.id),Object.assign({},h.data,{data:{total:lk.lock.total,sizes:lk.lock.sizes}}));
      });
      _phPatchLocal('recon',poId,saved);
      if(typeof phHistoryForget==='function')phHistoryForget(poId);
      _phLog('QC cut locked',poId+' - '+saved.cutLock.total+' pcs');
      return{ok:true,id:poId,rev:saved.rev,recon:saved,historyId:h.id};
    });
  }catch(e){return _phFromError(e);}
}

/* Adopt the receipts recorded through the OLD Packing page (pos.packingReceipts entries without src:'qc') as ONE lot.
   Managers only, with a reason; never automatic. Entries already adopted (their ids are in the reconciliation's legacyIds)
   are never taken twice. The lot is src 'legacy' and is NOT mirrored back into packingReceipts (those units are already
   there). Writes the lot, the reconciliation (created, locking the cut, when there is none) and a history row
   qc_legacy_adopted -- no pos document. opts: {expectedRev (required), reason (>= 5 characters), now, actor, rand}. */
async function phQcAdoptLegacy(poId,opts){
  const o=opts||{},a=_phActor(o);
  if(!phCanManage(a.u))return _phFail('forbidden','Only a manager (Afnan, Ammar, Mustafa) can adopt the old Packing receipts.');
  if(!PH_PO_ID_RE.test(String(poId)))return _phFail('invalid','Not a PO id: '+poId);
  const er=_phQcwRev(o.expectedRev);
  if(er===null)return _phFail('invalid','The reconciliation revision you are looking at is needed (0 when the PO has none yet). Reload and retry.');
  const reason=_phStr(o.reason,500);
  if(reason.length<PHQC_REASON_MIN)return _phFail('invalid','A reason of at least '+PHQC_REASON_MIN+' characters is needed to adopt the old receipts.');
  if(_phOffline())return _phFail('offline','No connection. Adopting the old receipts is a transaction, which cannot be queued - nothing was saved.');
  try{
    return await _phSilent(false,async function(){
      const now=_phNowOf(o),ctx={u:a.u,name:a.name,now:now,rand:o.rand};
      const lr=await _phQcwLotsFresh(poId);
      if(!lr.ok)return _phFail('unread',lr.error);
      const pref=doc(db,'pos',poId),rref=doc(db,'po_qc_recon',poId);
      let out=null;
      await runTransaction(db,async function(tx){
        out=null;
        const ps=await tx.get(pref);
        if(!ps||!ps.exists())throw _phRefuse('missing','PO '+poId+' does not exist.');
        const po=ps.data()||{};
        const r=_phQcwRecon(await tx.get(rref));
        if(r){
          if(r.rev!==er)throw _phRefuse('stale','The QC reconciliation of '+poId+' was changed by someone else (revision '+r.rev+'). Reload it.',{rev:r.rev});
          if(!_phQcwOpenStatus(r))throw _phRefuse('refused','The QC reconciliation of '+poId+' is '+r.status+'. '+(r.status==='closed'?'An owner can reopen it first.':''));
        }else if(er!==0)throw _phRefuse('stale','The QC reconciliation of '+poId+' is not what this screen shows. Reload it.');
        const lc=_phQcwLotsCheck(lr.rows,r);if(lc)throw _phRefuse('stale',lc);
        const mv=phQcMoveProblem(r?r.status:'',r?r.status:'locked','adopt',a.u);if(mv)throw _phRefuse('forbidden',mv);
        const done=r&&Array.isArray(r.legacyIds)?r.legacyIds:[];
        const sums={},ids=[];
        (Array.isArray(po.packingReceipts)?po.packingReceipts:[]).forEach(function(e){
          if(!_phIsObj(e)||e.src==='qc'||typeof e.size!=='string'||!e.size)return;
          const id=typeof e.id==='string'&&e.id?e.id:(String(e.receiptId||'')+'-'+e.size);
          if(done.indexOf(id)>-1||ids.indexOf(id)>-1)return;
          const q=phWhole(e.qty);if(q===null||q<=0)return;
          ids.push(id);sums[e.size]=(_phHas(sums,e.size)?sums[e.size]:0)+q;
        });
        if(!ids.length)throw _phRefuse('refused','PO '+poId+' has no receipts from the old Packing page that are not adopted already.');
        if(done.length+ids.length>PHQC_LEGACY_IDS_MAX)throw _phRefuse('refused','Too many old receipts to keep track of on one PO ('+(done.length+ids.length)+').');
        const model=_phQcwModel(po);
        let lock;
        if(r)lock=r.cutLock;else{const lk=phQcBuildLock(po,ctx,'first_lot');if(lk.error)throw _phRefuse('refused',lk.error);lock=lk.lock;}
        const recv=phQcReceived(lr.rows,{model:model});
        if(!recv||!recv.ok)throw _phRefuse('refused','The QC lots already on '+poId+' cannot be read: '+((recv&&recv.issues[0])||'unknown')+'.');
        const pr=phQcLotProblem(lock.sizes,recv.sizes,sums,{model:model});
        if(pr)throw _phRefuse('refused','The old receipts cannot be adopted: '+pr);
        const ls=phQcLotSizes(sums,model);if(ls.error)throw _phRefuse('refused',ls.error);
        const seq=(r?r.lotCount:0)+1;
        const lot=phQcBuildLot(poId,seq,ls.sizes,ls.total,ctx,{day:phDay(now),note:'Adopted from the old Packing page: '+reason,src:'legacy'});
        if(lot.error)throw _phRefuse('invalid',lot.error);
        const h=phBuildHistoryRow({type:'qc_legacy_adopted',from:r?r.status:'',to:'locked',reason:reason,data:{lotId:lot.id,seq:seq,total:ls.total,sizes:ls.sizes,receipts:ids.length}},ctx);
        if(h.error)throw _phRefuse('invalid',h.error);
        let rec;
        if(r){
          const patch={lotCount:seq,lastLotAt:now,legacyIds:done.concat(ids),rev:r.rev+1,updatedAt:now,updatedBy:a.u,updatedByName:_phStr(a.name||a.u,60)};
          tx.update(rref,patch);rec=Object.assign({},r,patch);
        }else{
          rec=phQcBuildRecon(poId,lock,ctx,{lotCount:1,lastLotAt:now,legacyIds:ids});
          tx.set(rref,rec);
        }
        tx.set(doc(db,'po_qc_lots',lot.id),lot.data);
        tx.set(doc(db,'pos',poId,'history',h.id),h.data);
        out={recon:rec,lot:lot,ids:ids,historyId:h.id};
      });
      _phPatchLocal('recon',poId,out.recon);
      _phQcwPatchLots([out.lot]);
      if(typeof phHistoryForget==='function')phHistoryForget(poId);
      _phLog('QC legacy receipts adopted',poId+' - lot #'+out.lot.data.seq+', '+out.lot.data.total+' pcs');
      return{ok:true,id:poId,lotId:out.lot.id,seq:out.lot.data.seq,rev:out.recon.rev,recon:out.recon,lot:out.lot.data,adopted:out.ids.length,historyId:out.historyId};
    });
  }catch(e){return _phFromError(e);}
}

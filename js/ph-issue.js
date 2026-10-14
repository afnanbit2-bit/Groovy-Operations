/* ─────────────────────────────────────────────────────────────────────────
   js/ph-issue.js — Production Ops (`ph`), ISSUE A READY DRAFT AS A REAL PO (14 Oct 2026)

   The ONE place Production Ops creates a document in the existing `pos` collection,
   and it only ever creates a NEW one. Kashif (uzaib) enters a draft on a PC; when it is
   READY, a manager (Mustafa, Afnan, Ammar -- NOT uzaib) issues it here.

   phIssueDraft(draftId,{expectedRev}) is ONE runTransaction that
     (a) re-reads the draft: it must be 'ready' and its rev must be expectedRev;
     (b) runs ph-core's phPoComplete again on the STORED po map and refuses if incomplete;
     (c) mints the next PO number the way the classic New PO form does: submitPO's
         `createWithNextId` is `mintNextIdInTx` (js/shared.js) inside a transaction, floored
         at `_poFloorNow()` (js/pos.js) -- this calls the same two, with the same `idFor`
         (`_poIdFor`) and the same counters/main field ('pos');
     (d) creates pos/{PO-nnn}: the SAME document the classic form builds (see
         phBuildIssuedPo, the field list is PH_ISSUE_PO_KEYS), plus fromDraftId, enteredBy,
         issuedBy and the draft's season. mintNextIdInTx reads the target id and THROWS if it
         exists, so an existing PO is never overwritten;
     (e) sets the draft to 'issued' with poId / issuedAt / issuedBy;
     (f) appends pos/{id}/history/{row} of type 'issued';
   all in the one transaction. If anything fails or is refused, nothing was written and
   counters/main is byte-for-byte what it was (the counter write is buffered by
   mintNextIdInTx and only lands with the commit). Concurrent issues of one draft: Firestore
   retries the loser's callback, which re-reads the draft, sees 'issued' and refuses.

   Released vs reserved: the classic form creates every PO `reserved` (PO_STATUS.RESERVED,
   currentStage null) and a person releases it later. This does the same. It invents no release.

   What the classic form does that this CANNOT, and what happens instead:
     - product photos (the draft has none): imgFront / imgBack are '' ("No image" everywhere
       the app draws a PO, which already handles an empty photo);
     - fabric roll RESERVATION (fabPoReserveCommit): the draft names no rolls, so `fabrics`
       is [] and nothing is reserved. fabPoReserveCommit is deliberately NOT called -- it
       reads the classic form's module-level pick list, which belongs to a form that may be
       open elsewhere;
     - the embellishment recipe lookup runs BEFORE the transaction (phIssueEmbellishment,
       the same three outcomes as the classic `_checkEmbRecipe`); if a recipe is required
       and the recipe data cannot be read, the issue is refused (unread), never guessed;
     - best-effort AFTER the commit (phIssueFollowUps, never throws, never undoes the PO):
       the activity-log rows the classic form writes and the trim issue request. A failure is
       reported in the result's `followUps`, not hidden.

   Writes: pos/{new}, counters/main (pos field), po_drafts/{id}, pos/{new}/history/{row}.
   Never an existing pos document. Never a delete. Loaded after js/ph-write.js. Globals are
   ph / _phi / PH_ISSUE_ prefixed (one lexical scope with every other classic script).
   ───────────────────────────────────────────────────────────────────────── */

// The keys of the document submitPO (js/pos.js) builds, in its order, and the keys this adds.
const PH_ISSUE_CLASSIC_KEYS=Object.freeze(['ts','name','code','pattern','qty','sizes','ratio','fabric','fabricCode','store','totalRoll','fabrics','imgFront','imgBack','poStatus','currentStage','stages','bundlingParts','embellishment','jobCopies','notes','createdBy','createdAt']);
const PH_ISSUE_PTN_KEYS=Object.freeze(['patternId','patternCode','patternHook']);   // js/patterns.js ptnPoFieldsFor, when the Pattern Hub integration is on
const PH_ISSUE_EXTRA_KEYS=Object.freeze(['id','season','fromDraftId','enteredBy','issuedBy']);
const PH_ISSUE_PO_KEYS=Object.freeze(PH_ISSUE_CLASSIC_KEYS.concat(PH_ISSUE_EXTRA_KEYS));
// WP3b: the snapshot of the product's standing instructions, appended AFTER the keys above and only when the article has any.
const PH_ISSUE_INSTR_KEYS=Object.freeze(['instructions','instructionsRev','instructionsAt']);
const PH_ISSUE_SIX=Object.freeze(['XS','S','M','L','XL','2XL']);                    // the six sizes the classic form always writes (js/pos.js PO_FLOW_SIZES)
const PH_ISSUE_COPIES=Object.freeze(['embroidery','printing','washing']);
// The draft status change (rules: phDraftStep, the issue clause, holds the same list).
const PH_DRAFT_ISSUE_FIELDS=Object.freeze(['status','rev','poId','issuedAt','issuedBy','updatedAt','updatedBy']);

function _phiStr(x,max){return typeof x==='string'?x.trim().slice(0,max):'';}

// The embellishment block the classic form stores (js/pos.js _checkEmbRecipe / _toggleEmbRequired):
// {required:false} when the draft says none; else the recipe outcome -- missing / draft / locked.
// recipes: the loaded article recipes; rateOf(code): the rate-master lookup or null.
function phIssueEmbellishment(dpo,recipes,rateOf){
  const req=!!(dpo&&dpo.embellishment&&dpo.embellishment.required===true);
  if(!req)return{required:false};
  const code=String(dpo.code==null?'':dpo.code),name=String(dpo.name==null?'':dpo.name);
  const list=Array.isArray(recipes)?recipes:[];
  let r=list.find(function(x){return String(x.articleCode||'').toLowerCase()===code.toLowerCase();});
  if(!r&&name)r=list.find(function(x){return String(x.articleName||'').toLowerCase()===name.toLowerCase();});
  if(!r){
    const rm=typeof rateOf==='function'?rateOf(code):null;
    return{required:true,recipeId:null,articleCode:code,articleName:name,recipeStatus:'missing',recipeRequiredBefore:'pp_approval',
      rateMasterPreview:rm?{complexityTier:rm.complexityTier,ratePerPiece:rm.ratePerPiece}:null};
  }
  const pr=r.printing||{};
  if(r.status!=='locked')return{required:true,recipeId:r._id,articleCode:code,articleName:r.articleName||name,recipeStatus:'draft',recipeRequiredBefore:'pp_approval'};
  return{required:true,recipeId:r._id,articleCode:code,articleName:r.articleName||name,processType:(pr.processTypes||[])[0]||'',complexityTier:pr.complexityTier||1,ratePerPiece:pr.ratePerPiece||0,recipeStatus:'locked',recipeRequiredBefore:'pp_approval'};
}

// The classic form's size map: ALWAYS the six XS..2XL keys (a number each, 0 when blank), plus any other
// size the draft carries (XXXS, XXS, a waist size). The ratio is the form's own formula over the six; a draft
// with other sizes keeps the draft's ratio (the form's six-size formula would drop those sizes).
function _phiSizes(dsizes){
  const src=dsizes&&typeof dsizes==='object'&&!Array.isArray(dsizes)?dsizes:{};
  const sizes={};
  PH_ISSUE_SIX.forEach(function(k){const n=phWhole(src[k]);sizes[k]=n!==null&&n>0?n:0;});
  let extra=false;
  Object.keys(src).forEach(function(k){
    if(PH_ISSUE_SIX.indexOf(k)>-1)return;
    const n=phWhole(src[k]);
    if(n!==null&&n>0){sizes[k]=n;extra=true;}
  });
  return{sizes:sizes,extra:extra};
}
function _phiRatio(sizes){   // js/pos.js updateRatio
  const vals=PH_ISSUE_SIX.map(function(k){return sizes[k]||0;});
  const nz=vals.filter(function(v){return v>0;});
  if(!nz.length)return'—';
  const min=Math.min.apply(null,nz);
  return vals.map(function(v){return v?Math.round(v/min):0;}).join(':');
}

// PURE. The pos document for an issued draft -- the classic payload, in the classic key order, then
// `id`, `season`, `fromDraftId`, `enteredBy`, `issuedBy`. No Firestore, no DOM, no clock but ctx.now.
// ctx: {id, now, draftId, enteredBy, issuedBy, issuedByName, stageKeys, poStatus, pktDay, embellishment, ptn}
function phBuildIssuedPo(dpo,ctx){
  const d=dpo&&typeof dpo==='object'&&!Array.isArray(dpo)?dpo:{};
  const c=ctx||{};
  const sz=_phiSizes(d.sizes);
  const stages={};
  (Array.isArray(c.stageKeys)?c.stageKeys:[]).forEach(function(k){stages[k]={done:false,doneAt:null,doneBy:null,dueDate:'',notes:''};});
  const jc={};
  PH_ISSUE_COPIES.forEach(function(k){jc[k]=!!(d.jobCopies&&d.jobCopies[k]===true);});
  const qty=phWhole(d.qty);
  const rec={
    ts:c.now,
    name:_phiStr(d.name,200),
    code:_phiStr(d.code,40),
    pattern:_phiStr(d.pattern,80),
    qty:qty===null?0:qty,
    sizes:sz.sizes,
    ratio:sz.extra&&typeof d.ratio==='string'&&d.ratio?d.ratio:_phiRatio(sz.sizes),
    fabric:_phiStr(d.fabric,120),
    fabricCode:_phiStr(d.fabricCode,60),
    store:_phiStr(d.store,80),
    totalRoll:_phiStr(d.totalRoll,40),
    fabrics:[],
    imgFront:'',
    imgBack:'',
    poStatus:c.poStatus,
    currentStage:null,
    stages:stages,
    bundlingParts:[{name:'Full Garment',notes:'',dest:'Warehouse'}],
    embellishment:c.embellishment||{required:false},
    jobCopies:jc,
    notes:_phiStr(d.notes,500),
    createdBy:c.issuedByName,
    createdAt:c.pktDay
  };
  const ptn=c.ptn&&typeof c.ptn==='object'?c.ptn:{};
  PH_ISSUE_PTN_KEYS.forEach(function(k){if(k in ptn)rec[k]=ptn[k];});
  rec.id=c.id;
  rec.season=typeof d.season==='string'?d.season:'';
  rec.fromDraftId=c.draftId;
  rec.enteredBy=c.enteredBy;
  rec.issuedBy=c.issuedBy;
  // WP3b snapshot: ctx.instr = {rev, doc} (the stored instructions); cleaned by the core's phInstructionsClean, so a later
  // edit of ph_article_instructions never changes this PO. Absent (no keys at all) when the article has none.
  const snap=phInstrSnapshot(c.instr,c.now);
  if(snap)PH_ISSUE_INSTR_KEYS.forEach(function(k){rec[k]=snap[k];});
  return rec;
}
// PURE. {instructions, instructionsRev, instructionsAt} from a stored instruction doc, or null when there is nothing to copy.
function phInstrSnapshot(instr,now){
  if(!instr||typeof instr!=='object'||typeof phInstructionsClean!=='function')return null;
  const d=instr.doc&&typeof instr.doc==='object'?instr.doc:null;
  if(!d)return null;
  const v=phInstructionsClean(d).value;
  if(phInstructionsEmpty(v))return null;
  const rev=typeof instr.rev==='number'&&isFinite(instr.rev)?instr.rev:(typeof d.rev==='number'?d.rev:0);
  return{instructions:v,instructionsRev:rev,instructionsAt:now};
}
// PURE. The status change written to the draft.
function phDraftIssuePatch(prev,poId,ctx){
  const now=_phNowOf(ctx);
  return{patch:{status:'issued',rev:prev.rev+1,poId:poId,issuedAt:now,issuedBy:ctx.u,updatedAt:now,updatedBy:ctx.u}};
}

// The recipe data for an embellishment PO: injected (tests), else the Embellishments module's loaded data,
// loading it first when it has not been. Throws a refusal when it cannot be had.
async function _phiRecipeInputs(o){
  if(Array.isArray(o.recipes))return{recipes:o.recipes,rateOf:typeof o.rateOf==='function'?o.rateOf:null};
  try{
    if(typeof printingDataLoaded!=='undefined'&&!printingDataLoaded&&typeof loadPrintingData==='function')await loadPrintingData();
  }catch(e){throw _phRefuse('unread','This PO needs an embellishment recipe check, and the recipes could not be loaded ('+((e&&e.message)||e)+'). Nothing was created. Retry.');}
  if(typeof allRecipes==='undefined'||!Array.isArray(allRecipes))throw _phRefuse('unread','This PO needs an embellishment recipe check, but the recipes are not loaded. Nothing was created. Reload the page and retry.');
  return{recipes:allRecipes,rateOf:typeof _lookupRate==='function'?_lookupRate:null};
}

function _phiPktDay(ms){return typeof _poPktDay==='function'?_poPktDay(ms):phDay(ms);}

// Issue a READY draft as a PO. managers only. opts: {expectedRev (required), actor, now, rand, recipes, rateOf, ptn, followUps}.
// Resolves {ok:true,poId,n,rev,po,draft,followUps} or {ok:false,code,error,...}; never throws.
async function phIssueDraft(draftId,opts){
  const o=opts||{},a=_phActor(o);
  if(!phCanManage(a.u))return _phFail('forbidden','Only a manager (Afnan, Ammar, Mustafa) can issue a draft as a PO.');
  if(!PH_DRAFT_ID_RE.test(String(draftId)))return _phFail('invalid','Not a draft id: '+draftId);
  if(!(typeof o.expectedRev==='number'&&isFinite(o.expectedRev)&&Math.floor(o.expectedRev)===o.expectedRev&&o.expectedRev>=1))return _phFail('invalid','The draft revision you are looking at is needed to issue it. Reload the draft and retry.');
  if(typeof runTransaction!=='function'||typeof mintNextIdInTx!=='function'||typeof _poFloorNow!=='function'||typeof _poIdFor!=='function'||typeof STAGE_KEYS==='undefined'||typeof PO_STATUS==='undefined')
    return _phFail('failed','The PO code (js/shared.js, js/pos.js) is not loaded, so a PO cannot be created. Reload the page.');
  if(_phOffline())return _phFail('offline','No connection. Issuing a PO is one transaction and cannot be queued - nothing was created. Try again when the connection is back.');
  try{
    // ── reads that happen BEFORE the transaction (none of them writes) ──────────────────────────────
    // the cutting masters are re-read NOW (a master retired since this page loaded must be caught); a failed read leaves the list null and refuses
    try{if(typeof phLoadStage==='function')await phLoadStage('masters',{force:true});}catch(e){}
    const masters=phMasterList();
    if(masters===null)return _phFail('unread','The cutting-master list was not read, so the draft cannot be checked. Nothing was created. Reload Production Ops and retry.');
    let floor;
    try{floor=await _poFloorNow();}
    catch(e){return _phFail('unread',String((e&&e.message)||'The PO list did not load, so the next PO number cannot be checked.')+' Nothing was created.');}
    let ptn={};
    if(o.ptn&&typeof o.ptn==='object')ptn=o.ptn;
    const now=_phNowOf(o);
    const ctx={u:a.u,name:a.name,now:now,rand:o.rand};
    const dref=doc(db,'po_drafts',draftId);
    let made=null,savedDraft=null,rec=null;
    const result=await _phSilent(false,async function(){
      // the draft's code is needed for the pattern lookup and the recipe lookup: one plain read, outside the transaction
      const pre=await getDoc(dref);
      if(!pre||!pre.exists())throw _phRefuse('missing','Draft '+draftId+' does not exist.');
      const pd=pre.data()||{};
      const pcode=pd.po&&typeof pd.po==='object'?pd.po.code:'';
      if(!(o.ptn&&typeof o.ptn==='object')&&typeof window!=='undefined'&&window&&typeof window.ptnPoFieldsFor==='function'){
        ptn=await Promise.resolve().then(function(){return window.ptnPoFieldsFor(pcode);}).catch(function(){return{};});
      }
      let emb={required:false};
      if(pd.po&&pd.po.embellishment&&pd.po.embellishment.required===true){
        const ri=await _phiRecipeInputs(o);
        emb=phIssueEmbellishment(pd.po,ri.recipes,ri.rateOf);
      }
      const hist=phBuildHistoryRow({type:'issued',from:'ready',to:'issued',data:{draftId:draftId,code:_phiStr(pcode,40)}},ctx);
      if(hist.error)throw _phRefuse('invalid',hist.error);
      const pktDay=_phiPktDay(now);
      await runTransaction(db,async function(tx){
        made=null;savedDraft=null;rec=null;
        // ALL READS FIRST (a transaction requires it): the draft, then counters/main and the target pos id.
        const s=await tx.get(dref);
        if(!s||!s.exists())throw _phRefuse('missing','Draft '+draftId+' does not exist.');
        const prev=s.data();
        if(prev.status==='issued')throw _phRefuse('refused','Draft '+draftId+' was already issued'+(prev.poId?' as '+prev.poId:'')+'. Nothing was created.',{poId:prev.poId||null});
        if(prev.status!=='ready')throw _phRefuse('refused','Draft '+draftId+' is '+prev.status+', not ready, so it cannot be issued.');
        if(prev.rev!==o.expectedRev)throw _phRefuse('stale','Draft '+draftId+' was changed by someone else (revision '+prev.rev+', yours was '+o.expectedRev+'). Reload it.',{rev:prev.rev});
        const gate=phPoComplete(Object.assign({},prev.po),{masters:masters,today:phDay(now)});
        if(!gate.ok)throw _phRefuse('refused','The draft is not complete, so it was not issued: '+gate.missing.map(function(m){return m.why;}).join('; ')+'.',{missing:gate.missing,warnings:gate.warnings});
        // what the recipe / pattern lookups above were made for must still be what is stored
        const sameBasis=prev.po&&pd.po&&prev.po.code===pd.po.code&&prev.po.name===pd.po.name
          &&!!(prev.po.embellishment&&prev.po.embellishment.required)===!!(pd.po.embellishment&&pd.po.embellishment.required);
        if(!sameBasis)throw _phRefuse('stale','Draft '+draftId+' changed while it was being issued. Reload it and retry. Nothing was created.');
        // WP3b: the article's standing instructions, read inside the transaction (a consistent snapshot). No document = no snapshot.
        // A read that FAILS cannot tell "none" from "some", so it refuses (named) rather than issue a PO without them.
        let instr=null;
        const icode=_phiStr(prev.po&&prev.po.code,40).toUpperCase();
        if(icode){
          let isn;
          try{isn=await tx.get(doc(db,'ph_article_instructions',icode));}
          catch(e){throw _phRefuse('unread','The product instructions of '+icode+' (ph_article_instructions) could not be read ('+((e&&e.message)||e)+'), so the PO was not issued. Nothing was created. Retry.');}
          if(isn&&isn.metadata&&isn.metadata.fromCache&&!isn.exists())throw _phRefuse('unread','The product instructions of '+icode+' were answered from this device\'s offline copy, which cannot show whether they exist. Nothing was created. Retry when online.');
          if(isn&&isn.exists())instr={rev:(isn.data()||{}).rev,doc:isn.data()};
        }
        const m=await mintNextIdInTx(tx,{field:'pos',collection:'pos',floor:floor,idFor:_poIdFor});   // THROWS (nothing written) if the target id exists
        rec=phBuildIssuedPo(prev.po,{id:m.id,now:now,draftId:draftId,enteredBy:prev.createdBy,issuedBy:a.u,issuedByName:a.name,
          stageKeys:STAGE_KEYS,poStatus:PO_STATUS.RESERVED,pktDay:pktDay,embellishment:emb,ptn:ptn,instr:instr});
        const d=phDraftIssuePatch(prev,m.id,ctx);
        // ALL WRITES: the counter and the new pos document (mintNextIdInTx buffers both), the draft, the history row.
        m.write(rec);
        tx.update(dref,d.patch);
        tx.set(doc(db,'pos',m.id,'history',hist.id),Object.assign({},hist.data,{data:Object.assign({},hist.data.data,{poId:m.id,qty:rec.qty},rec.instructionsRev!=null?{instructionsRev:rec.instructionsRev}:{})}));
        made=m;savedDraft=Object.assign({},prev,d.patch);
      });
      return true;
    });
    if(result!==true||!made)return _phFail('failed','The PO was not confirmed as created.');
    _phPatchLocal('drafts',draftId,savedDraft);
    // the PO list on this device: add the new PO so "Open" works before the next reload
    try{if(typeof allPOs!=='undefined'&&Array.isArray(allPOs)&&!allPOs.some(function(p){return p&&(p.fbKey===made.id||p.id===made.id);}))allPOs.unshift(Object.assign({},rec,{fbKey:made.id}));}catch(e){}
    const fu=o.followUps===false?null:await phIssueFollowUps(rec,{embellishment:rec.embellishment});
    return{ok:true,poId:made.id,n:made.n,rev:savedDraft.rev,po:rec,draft:savedDraft,followUps:fu};
  }catch(e){return _phFromError(e);}
}

// Best-effort steps the classic form runs after the PO exists. NEVER throws and never undoes the PO; reports each.
//   activity: logActivity rows; trim: the store's trim issue request when a template exists for the article code.
async function phIssueFollowUps(po,opts){
  const out={activity:'skipped',recipe:'skipped',trim:'skipped'};
  try{
    if(typeof logActivity==='function'){
      await logActivity('PO created',po.id+' — '+po.name+' ('+po.qty+' pcs) — issued from draft '+po.fromDraftId);
      out.activity='logged';
    }
  }catch(e){out.activity='failed: '+((e&&e.message)||e);}
  try{
    const emb=po.embellishment||{};
    if(emb.required&&typeof logActivity==='function'){
      if(emb.recipeStatus==='missing'){await logActivity('Recipe Missing',po.id+' — '+(emb.articleCode||po.code)+': Recipe required before PP approval. Ammar notified.');out.recipe='missing logged';}
      else if(emb.recipeStatus==='draft'){await logActivity('Recipe Needs Lock',po.id+' — '+(emb.articleCode||po.code)+': Recipe exists but not locked by Ammar.');out.recipe='needs lock logged';}
      else out.recipe='locked';
    }
  }catch(e){out.recipe='failed: '+((e&&e.message)||e);}
  try{
    if(typeof getDocs==='function'&&typeof query==='function'&&typeof collection==='function'&&typeof where==='function'&&typeof _createPoIssueRequest==='function'){
      const snap=await getDocs(query(collection(db,'trim_templates'),where('productCode','==',po.code)));
      if(snap&&!snap.empty){
        const tpl=Object.assign({},snap.docs[0].data(),{_id:snap.docs[0].id});
        await _createPoIssueRequest({id:po.id,name:po.name,code:po.code,qty:po.qty},tpl);
        out.trim='created';
      }else out.trim='no template';
    }
  }catch(e){out.trim='failed: '+((e&&e.message)||e);}
  return out;
}

/* ── WP3b: deliberately refresh a PO's instruction snapshot (managers) ─────────────────────────────
   phPoInstructionsRefresh(poId,{expectedRev}) copies the article's CURRENT product instructions onto an existing PO.
   expectedRev = the instructionsRev the caller sees on the PO (0 when it has no snapshot); a different stored value is refused (stale).
   One transaction: reads pos/{id} and ph_article_instructions/{CODE}; tx.update(pos) with EXACTLY instructions, instructionsRev,
   instructionsAt (PH_ISSUE_INSTR_KEYS); one append-only pos/{id}/history row of type instructions_refreshed.
   RULES: no firestore.rules change. The pos rule is `allow write: if signedIn()` with no field list, so the manager gate here
   (phCanManage) is the ONLY guard on this field, exactly as for every other pos field; the history row is covered by the existing
   isProdOps() history rule. Never touches any other field of the PO. */
async function phPoInstructionsRefresh(poId,opts){
  const o=opts||{},a=_phActor(o);
  if(!phCanManage(a.u))return _phFail('forbidden','Only a manager (Afnan, Ammar, Mustafa) can refresh a PO\'s instructions.');
  if(!PH_PO_ID_RE.test(String(poId)))return _phFail('invalid','Not a PO id: '+poId);
  if(!(typeof o.expectedRev==='number'&&isFinite(o.expectedRev)&&Math.floor(o.expectedRev)===o.expectedRev&&o.expectedRev>=0))return _phFail('invalid','The instruction revision you are looking at is needed (0 when the PO has none). Reload the PO and retry.');
  if(typeof runTransaction!=='function')return _phFail('failed','The transaction API is not loaded. Reload the page.');
  if(_phOffline())return _phFail('offline','No connection. Refreshing the instructions is one transaction and cannot be queued - nothing was changed.');
  try{
    const now=_phNowOf(o);
    const hist=phBuildHistoryRow({type:'instructions_refreshed',from:'',to:'',data:{}},{u:a.u,name:a.name,now:now,rand:o.rand});
    if(hist.error)return _phFail('invalid',hist.error);
    let snapOut=null,fromRev=0;
    const res=await _phSilent(false,async function(){
      const pref=doc(db,'pos',poId);
      await runTransaction(db,async function(tx){
        snapOut=null;
        const ps=await tx.get(pref);
        if(!ps||!ps.exists())throw _phRefuse('missing','PO '+poId+' does not exist.');
        const po=ps.data()||{};
        const have=typeof po.instructionsRev==='number'?po.instructionsRev:0;
        if(have!==o.expectedRev)throw _phRefuse('stale','PO '+poId+' instructions were changed by someone else (revision '+have+', yours was '+o.expectedRev+'). Reload it.',{rev:have});
        const code=_phiStr(po.code,40).toUpperCase();
        if(!code)throw _phRefuse('refused','PO '+poId+' has no article code, so there are no instructions to copy.');
        let isn;
        try{isn=await tx.get(doc(db,'ph_article_instructions',code));}
        catch(e){throw _phRefuse('unread','The product instructions of '+code+' could not be read ('+((e&&e.message)||e)+'). Nothing was changed.');}
        if(!isn||!isn.exists())throw _phRefuse('refused','Article '+code+' has no saved product instructions, so there is nothing to copy.');
        const snap=phInstrSnapshot({rev:(isn.data()||{}).rev,doc:isn.data()},now);
        if(!snap)throw _phRefuse('refused','The saved instructions of '+code+' are empty, so there is nothing to copy.');
        if(snap.instructionsRev===have&&po.instructions)throw _phRefuse('refused','PO '+poId+' already holds revision '+have+' of the instructions. Nothing changed.');
        fromRev=have;
        tx.update(pref,snap);
        tx.set(doc(db,'pos',poId,'history',hist.id),Object.assign({},hist.data,{from:'rev '+have,to:'rev '+snap.instructionsRev,data:{code:code,fromRev:have,toRev:snap.instructionsRev}}));
        snapOut=snap;
      });
      return true;
    });
    if(res!==true||!snapOut)return _phFail('failed','The refresh was not confirmed.');
    try{if(typeof allPOs!=='undefined'&&Array.isArray(allPOs)){const p=allPOs.find(function(x){return x&&(x.fbKey===poId||x.id===poId);});if(p)Object.assign(p,snapOut);}}catch(e){}
    if(typeof phHistoryForget==='function')phHistoryForget(poId);
    return{ok:true,poId:poId,fromRev:fromRev,rev:snapOut.instructionsRev,snapshot:snapOut};
  }catch(e){return _phFromError(e);}
}

/* ── WP3b follow-up (integration 5): the manager-only "Refresh instructions" control on the PO detail page ─────────────
   js/pos.js renderDetailPage calls window.phPoInstructionsSlot(po) behind a typeof guard. It returns '' for anyone who is not
   a manager (the button is not drawn; phPoInstructionsRefresh refuses a non-manager again). Two steps: the button shows the
   revision the PO holds now (0 = none); "Yes, refresh" calls phPoInstructionsRefresh(poId,{expectedRev}). All text is set with
   textContent after the markup (a PO id is validated against PH_PO_ID_RE first, so it is safe in an attribute). */
function _phiSlotId(po){const k=po&&(po.fbKey||po.id);return typeof k==='string'&&PH_PO_ID_RE.test(k)?k:null;}
function _phiSlotRev(po){return po&&typeof po.instructionsRev==='number'&&isFinite(po.instructionsRev)&&po.instructionsRev>=0?Math.floor(po.instructionsRev):0;}
window.phPoInstructionsSlot=function(po){
  if(typeof phCanManage!=='function'||phCanManage()!==true)return'';
  const id=_phiSlotId(po);if(!id)return'';
  return'<div class="card" id="ph-instr-slot" data-po="'+id+'" style="margin-bottom:12px"><div class="card-title">Product instructions on this PO</div>'
    +'<div id="ph-instr-slot-body"><div class="info-row"><span class="info-label">Snapshot</span><span id="ph-instr-slot-rev">'+(_phiSlotRev(po)?'revision '+_phiSlotRev(po):'none')+'</span></div>'
    +'<button class="btn-outline" style="font-size:13px" id="ph-instr-slot-btn" onclick="window.phPoInstructionsAsk(\''+id+'\')">Refresh instructions…</button></div></div>';
};
window.phPoInstructionsAsk=function(id){
  const body=document.getElementById('ph-instr-slot-body');if(!body||!PH_PO_ID_RE.test(String(id)))return false;
  const po=(typeof allPOs!=='undefined'&&Array.isArray(allPOs))?allPOs.find(function(x){return x&&(x.fbKey===id||x.id===id);}):null;
  const rev=_phiSlotRev(po);
  body.innerHTML='<p id="ph-instr-slot-q" style="margin:0 0 8px"></p><button class="btn-outline" style="font-size:13px" id="ph-instr-slot-yes">Yes, refresh</button> <button class="btn-outline" style="font-size:13px" id="ph-instr-slot-no">No</button><p id="ph-instr-slot-msg" role="status" style="margin:8px 0 0"></p>';
  document.getElementById('ph-instr-slot-q').textContent='Copy the article\'s CURRENT product instructions onto '+id+'? This PO holds '+(rev?'revision '+rev:'no snapshot')+' now. The old snapshot is replaced; the change is recorded in the PO history.';
  document.getElementById('ph-instr-slot-no').onclick=function(){if(typeof renderDetailPage==='function')renderDetailPage();};
  document.getElementById('ph-instr-slot-yes').onclick=function(){window.phPoInstructionsDo(id,rev);};
  return true;
};
window.phPoInstructionsDo=async function(id,expectedRev){
  const msg=document.getElementById('ph-instr-slot-msg'),yes=document.getElementById('ph-instr-slot-yes');
  if(yes)yes.disabled=true;
  const r=await phPoInstructionsRefresh(id,{expectedRev:expectedRev});
  if(r&&r.ok){if(typeof showToast==='function')showToast('Instructions refreshed to revision '+r.rev);if(typeof renderDetailPage==='function')renderDetailPage();return r;}
  if(msg)msg.textContent='Not refreshed: '+((r&&r.error)||'unknown error');
  if(yes)yes.disabled=false;
  return r;
};

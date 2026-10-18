/* ─────────────────────────────────────────────────────────────────────────
   js/ph-qc-write.js — Production Ops (`ph`), QC RECONCILIATION writers that touch the pos document (QC4, 15 Oct 2026)

   The owner's rule (Afnan): once the cut per size is recorded it is FINAL; QC must receive the same units per size from
   stitching, within 2 % (the decision is js/ph-core.js phQc*). Faizan (QC Ops) records each hand-over as a LOT; a PO closes
   when what QC received matches its locked cut.

   Why a second writer file (the js/ph-issue.js precedent): js/ph-write.js keeps its rule that no writer there touches the
   pos document. Every writer HERE writes, in ONE transaction with the reconciliation and a pos/{id}/history row:
     phQcAddLot     a lot -> po_qc_lots + po_qc_recon (created and the cut LOCKED on the first lot) + the SAME units appended to
                    pos.packingReceipts (one entry per size, src:'qc'), so Haris's QC Disposition, Ready to Barcode, B-stock and
                    poFullyReceived keep working unchanged
     phQcVoidLot    a lot -> void (never deleted) + a counter entry per size appended to pos.packingReceipts (qty negative,
                    src:'qc', voidOf), so the classic readers' sums stay true; an adopted (legacy) lot appends nothing
     phQcClose      the reconciliation -> closed + qcReconClosedAt/By on the pos document; the fields the classic completeQC
                    writes (currentStage 'completed', stages.qc.done/doneAt/doneBy/notes) ONLY when the PO is at stage qc and
                    every bundle is dispositioned (R1, 16 Oct 2026 - see phQcClassicDecision; the result's `classic` says which
                    and why); a PO the classic flow had already completed gets only the two additive keys
     phQcRelock     an OWNER replaces the cut snapshot from the PO's (hand-corrected) cut - only when the two differ
     phQcReopen     an OWNER reopens a closed reconciliation (the pos document is not touched)
   CHANGE FROM THE PLAN (owner decision, 15 Oct 2026): a MANAGER (afnan, ammar, mustafa) may close a PO in ANY phase that is not
   'ready' - still receiving, short, or over beyond the allowance - with a reason of at least 5 characters and a cause, an
   overrides row (kind close_short), a history row qc_closed_short and bell rows to the other managers. The floor (Faizan) closes
   only a 'ready' PO (exact, within 2 %, or over inside the allowance). Nobody closes a PO that has received nothing.

   How every writer behaves (js/ph-write.js's conventions, reused): async, NEVER throws - {ok:true,...} or {ok:false,code,error};
   offline is refused out loud (a transaction cannot be queued); `expectedRev` is compared with the stored revision ('stale');
   the PO's lots are read FRESH before the transaction and must be exactly what the reconciliation counts (else 'stale'); every
   stored "who" is the signed-in person; the client checks are a convenience and firestore.rules is the boundary.

   Writes: pos/{id} (packingReceipts, and the close fields only), po_qc_recon, po_qc_lots, pos/{id}/history, hrm_notifications.
   Reads, never writes: bundles (the close's classic check, PHQC_READ_ROOTS). Never a delete. After each commit one activity row
   (logActivity through _phLog, ids and numbers only, no typed reason). Loaded after js/ph-issue.js. Globals are phQc / _phQcw prefixed (one lexical scope with every classic script).
   ───────────────────────────────────────────────────────────────────────── */

// Every collection this file may write (tests/ph-qc-write.test.js and tests/ph-integration.test.js hold the source to it).
const PHQC_WRITE_ROOTS=Object.freeze(['pos','po_qc_recon','po_qc_lots','hrm_notifications']);
// The pos fields the close writes (the classic completeQC fields, then the two additive ones).
const PHQC_CLOSE_POS_FIELDS=Object.freeze(['currentStage','stages.qc.done','stages.qc.doneAt','stages.qc.doneBy','stages.qc.notes','qcReconClosedAt','qcReconClosedBy']);
const PHQC_BELL_MANAGERS=Object.freeze(['afnan','ammar','mustafa']);

function _phQcwEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
// The bell rows that go with a manager's decision, to every OTHER manager (the owners among them), in the hand-built shape of
// js/pos.js poCutOverride (escaped once, after the length cut, because the bell prints title/message raw). -> [{id,data}]
function phQcBellRows(kind,poId,title,message,ctx){
  const now=_phNowOf(ctx);
  return PHQC_BELL_MANAGERS.filter(function(u){return u!==ctx.u;}).map(function(u){
    const id='po_qc'+kind+'_'+poId+'_'+now+'_'+u;
    return{id:id,data:{id:id,type:'po_qc_'+kind,source:'production_ops',title:_phQcwEsc(String(title).slice(0,80)),message:_phQcwEsc(String(message).slice(0,300)),
      forUser:u,forRole:'',relatedTo:poId,createdAt:now,readBy:[],priority:'high',actionRequired:false,actionUrl:'prod-ops'}};
  });
}
// The verdict as stored on the close (a map of maps, never an array of arrays).
function phQcVerdictSnap(rc){
  const v=rc&&rc.verdict;
  const sizes={};
  if(v&&Array.isArray(v.order))v.order.forEach(function(k){const s=v.sizes[k];sizes[k]={cut:s.cut,recv:s.recv,diff:s.diff,allow:s.allow,state:s.state};});
  const t=v&&v.total?{cut:v.total.cut,recv:v.total.recv,diff:v.total.diff,allow:v.total.allow,state:v.total.state}:null;
  return{state:v?v.state:null,phase:rc?rc.phase:null,total:t,sizes:sizes};
}
// R1 (16 Oct 2026, owner decision): the reconciliation ALWAYS closes when the close is allowed, but the classic Final QC fields are
// written ONLY when the PO is AT stage qc and EVERY bundle has been dispositioned at Final QC (Haris) - exactly the classic rule:
// js/pos.js renderQCWork `pending=bundles.filter(b=>!b.qcStatus).length; canComplete=pending===0&&bundles.length>0` (the enabled
// state of the Complete QC button) and window.completeQC `if(po.currentStage!=='qc')` (refused). The bundles are the ones the
// classic screen reads: `bundles where poId == po.id` (js/pos.js loadBundles). Otherwise the pos document gets only the two additive
// keys and the result says why (classic.written false + classic.why), so the screen can tell Faizan; Haris's own button, which
// refuses only while a reconciliation is OPEN, then finishes the PO the classic way.
const PHQC_READ_ROOTS=Object.freeze(['bundles']);     // read, never written, by this file (the close's classic check)
const PHQC_BUNDLES_READ_MAX=401;                      // one read; at the cap the set is not known whole -> classic not written
const PHQC_BUNDLES_RECHECK_MAX=400;                   // bundles re-read inside the close's transaction
// The classic Final QC tally of a PO's bundles (pure; held equal to js/pos.js renderQCWork's two lines by tests/ph-qc-write.test.js).
function phQcBundleTally(bundles){
  const b=Array.isArray(bundles)?bundles:[];
  const pending=b.filter(function(x){return!(x&&x.qcStatus);}).length;
  return{count:b.length,pending:pending,passed:b.filter(function(x){return!!x&&x.qcStatus==='pass';}).length,
    failed:b.filter(function(x){return!!x&&x.qcStatus==='fail';}).length,done:pending===0&&b.length>0};
}
// May the close write the classic Final QC fields? -> {write, why, failed}. `br` is the bundles read made before the transaction.
function phQcClassicDecision(po,br){
  const st=phStageOf(po);
  if(st==='completed')return{write:false,why:'PO had already completed Final QC in the classic flow',failed:0};
  if(st!=='qc')return{write:false,why:'PO is still at '+st,failed:0};
  if(!br||!br.ok)return{write:false,why:'bundles could not be read',failed:0};
  const t=phQcBundleTally(br.rows);
  if(t.count===0)return{write:false,why:'no bundles on record for this PO',failed:0};
  if(t.pending>0)return{write:false,why:t.pending+' bundle'+(t.pending===1?'':'s')+' not yet dispositioned by QC',failed:t.failed};
  return{write:true,why:'PO was at Final QC and every bundle was dispositioned',failed:t.failed};
}
async function _phQcwBundlesFresh(poId){
  try{
    const snap=await _phWithTimeout(getDocs(query(collection(db,'bundles'),where('poId','==',poId),limit(PHQC_BUNDLES_READ_MAX))),PH_READ_TIMEOUT_MS);
    if(_phFromCache(snap))throw _phCacheError();
    const rows=((snap&&snap.docs)||[]).map(function(d){return Object.assign({},d.data(),{_id:d.id});}).filter(function(r){return r&&r.poId===poId;});
    if(rows.length>PHQC_BUNDLES_RECHECK_MAX)return{ok:false,error:'more than '+PHQC_BUNDLES_RECHECK_MAX+' bundles'};
    return{ok:true,rows:rows};
  }catch(e){const i=typeof phErrInfo==='function'?phErrInfo(e):{};return{ok:false,error:(i&&(i.message||i.code))||'read failed'};}
}
// The pos patch of a close: the classic completeQC fields (only when `cls.write`) + the two additive keys.
function phQcClosePosPatch(po,rc,ctx,cls){
  const now=_phNowOf(ctx);
  const add={qcReconClosedAt:now,qcReconClosedBy:ctx.u};
  if(phStageOf(po)==='completed'||!cls||cls.write!==true)return add;
  const t=rc.verdict.total;
  const note='QC received '+t.recv+' of '+t.cut+' ('+(rc.phase==='ready'?(rc.verdict.state==='exact'?'exact':rc.verdict.state==='over'?'over inside the allowance':'within '+PHQC_TOL_PCT+' %'):'closed by a manager: '+rc.phase)+')'
    +(cls.failed>0?'; '+cls.failed+' bundle'+(cls.failed===1?'':'s')+' failed QC':'');
  const p={currentStage:'completed'};
  p['stages.qc.done']=true;p['stages.qc.doneAt']=new Date(now).toISOString();p['stages.qc.doneBy']=ctx.name||ctx.u;p['stages.qc.notes']=note;
  return Object.assign(p,add);
}
function _phQcwMirror(lotId,sizes,sign,ctx,extra){
  const ts=new Date(_phNowOf(ctx)).toISOString(),pre=sign<0?'QV-':'QL-';
  return Object.keys(sizes).filter(function(k){return sizes[k]>0;}).map(function(k){
    const e={id:pre+lotId+'-'+k,receiptId:sign<0?'QV-'+lotId:lotId,size:k,qty:sign*sizes[k],ts:ts,by:_phStr(ctx.name||ctx.u,60),src:'qc'};
    if(sign<0)e.voidOf=lotId;
    return Object.assign(e,extra||{});
  });
}
function _phQcwPatchPo(poId,patch){
  try{if(typeof allPOs!=='undefined'&&Array.isArray(allPOs)){const p=allPOs.find(function(x){return x&&(x.fbKey===poId||x.id===poId);});if(p)Object.assign(p,patch);}}catch(e){}
}
function _phQcwMemPo(poId){
  try{if(typeof allPOs!=='undefined'&&Array.isArray(allPOs))return allPOs.find(function(x){return x&&(x.fbKey===poId||x.id===poId);})||null;}catch(e){}
  return null;
}
function _phQcwStageOk(po){
  const st=phStageOf(po);
  return st==='completed'||PH_REAL_STAGE_ORDER.indexOf(st)>=PH_REAL_STAGE_ORDER.indexOf('stitching');
}

/* Receive a lot. input {sizes:{S:10,...}, day:'YYYY-MM-DD' (PKT, default today; never in the future, never before the cut day),
   note}. opts {expectedRev (0 = no reconciliation yet; required), now, actor, rand}. The lot is checked against the locked cut
   (js/ph-core.js phQcLotProblem: a size not cut, a fraction, nothing entered, or beyond cut + allowance per size and in total are
   refused) BEFORE any read when this device holds the PO, its reconciliation and its lots, and again inside the transaction. */
async function phQcAddLot(poId,input,opts){
  const o=opts||{},a=_phActor(o),inp=_phIsObj(input)?input:{};
  const no=_phQcwNeedOps(a.u);if(no)return no;
  if(!PH_PO_ID_RE.test(String(poId)))return _phFail('invalid','Not a PO id: '+poId);
  const er=_phQcwRev(o.expectedRev);
  if(er===null)return _phFail('invalid','The reconciliation revision you are looking at is needed (0 when the PO has none yet). Reload and retry.');
  if(!_phIsObj(inp.sizes))return _phFail('invalid','Enter the units received for each size.');
  if(Object.keys(inp.sizes).length>PHQC_MAX_LOT_SIZES)return _phFail('invalid','A lot names at most '+PHQC_MAX_LOT_SIZES+' sizes.');
  if(inp.note!==undefined&&inp.note!==null&&typeof inp.note!=='string')return _phFail('invalid','The note must be text.');
  const now=_phNowOf(o),today=phDay(now);
  const day=inp.day===undefined||inp.day===null||inp.day===''?today:inp.day;
  if(!phIsDay(day))return _phFail('invalid','The day the lot was counted must be a day, YYYY-MM-DD.');
  if(day>today)return _phFail('invalid','The day the lot was counted cannot be in the future ('+day+').');
  // the same check as the transaction, BEFORE any round trip, when this device holds what it needs
  const mPo=_phQcwMemPo(poId),st=typeof phQcState==='function'?phQcState():null;
  if(mPo&&st&&st.ok){
    const mR=phQcReconOf(poId),mL=phQcLotsOf(poId),model=_phQcwModel(mPo);
    let cut=null;
    if(mR&&mR.cutLock&&_phIsObj(mR.cutLock.sizes))cut=mR.cutLock.sizes;
    else if(!mR){const lk=phQcBuildLock(mPo,{u:a.u,now:now},'first_lot');if(lk.error)return _phFail('refused',lk.error);cut=lk.lock.sizes;}
    if(cut&&Array.isArray(mL)){
      const rv=phQcReceived(mL,{model:model});
      if(rv&&rv.ok){const pr=phQcLotProblem(cut,rv.sizes,inp.sizes,{model:model});if(pr)return _phFail('refused',pr);}
    }
  }
  if(_phOffline())return _phFail('offline','No connection. A QC lot is saved with a transaction, which cannot be queued - nothing was saved.');
  try{
    return await _phSilent(true,async function(){
      const ctx={u:a.u,name:a.name,now:now,rand:o.rand};
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
          if(r.status==='closed')throw _phRefuse('refused','The QC reconciliation of '+poId+' is closed. An owner can reopen it.');
          if(!_phQcwOpenStatus(r))throw _phRefuse('refused','The QC reconciliation of '+poId+' is '+r.status+'.');
          if(r.rev!==er)throw _phRefuse('stale','The QC reconciliation of '+poId+' was changed by someone else (revision '+r.rev+'). Reload it.',{rev:r.rev});
        }else if(er!==0)throw _phRefuse('stale','The QC reconciliation of '+poId+' is not what this screen shows. Reload it.');
        const mv=phQcMoveProblem(r?r.status:'',r?r.status:'locked',r?'lot':'lock',a.u);if(mv)throw _phRefuse('forbidden',mv);
        const lc=_phQcwLotsCheck(lr.rows,r);if(lc)throw _phRefuse('stale',lc);
        const stg=phStageOf(po);
        if(stg==='cancelled'||stg==='reserved'||stg==='unknown')throw _phRefuse('refused','PO '+poId+' is '+stg+', so QC cannot receive it.');
        let lock;
        if(r)lock=r.cutLock;else{const lk=phQcBuildLock(po,ctx,'first_lot');if(lk.error)throw _phRefuse('refused',lk.error);lock=lk.lock;}
        if(typeof po.cutDate==='string'&&phIsDay(po.cutDate)&&day<po.cutDate)throw _phRefuse('refused','The lot is dated '+day+', before the PO was cut ('+po.cutDate+').');
        const model=_phQcwModel(po);
        const recv=phQcReceived(lr.rows,{model:model});
        if(!recv||!recv.ok)throw _phRefuse('refused','The QC lots already on '+poId+' cannot be read: '+((recv&&recv.issues[0])||'unknown')+'.');
        const pr=phQcLotProblem(lock.sizes,recv.sizes,inp.sizes,{model:model});
        if(pr)throw _phRefuse('refused',pr);
        const ls=phQcLotSizes(inp.sizes,model);if(ls.error)throw _phRefuse('refused',ls.error);
        const seq=(r?r.lotCount:0)+1;
        const lot=phQcBuildLot(poId,seq,ls.sizes,ls.total,ctx,{day:day,note:inp.note,src:'qc'});
        if(lot.error)throw _phRefuse('invalid',lot.error);
        const h=phBuildHistoryRow({type:'qc_lot_added',from:r?r.status:'',to:'locked',reason:_phStr(inp.note,500),data:{lotId:lot.id,seq:seq,total:ls.total,sizes:ls.sizes,lockedNow:!r}},ctx);
        if(h.error)throw _phRefuse('invalid',h.error);
        let rec;
        if(r){
          const patch={lotCount:seq,lastLotAt:now,rev:r.rev+1,updatedAt:now,updatedBy:a.u,updatedByName:_phStr(a.name||a.u,60)};
          tx.update(rref,patch);rec=Object.assign({},r,patch);
        }else{
          rec=phQcBuildRecon(poId,lock,ctx,{lotCount:1,lastLotAt:now});
          tx.set(rref,rec);
        }
        const mirror=_phQcwMirror(lot.id,ls.sizes,1,ctx);
        const receipts=(Array.isArray(po.packingReceipts)?po.packingReceipts:[]).concat(mirror);
        tx.set(doc(db,'po_qc_lots',lot.id),lot.data);
        tx.update(pref,{packingReceipts:receipts});
        tx.set(doc(db,'pos',poId,'history',h.id),h.data);
        out={recon:rec,lot:lot,receipts:receipts,historyId:h.id,locked:!r};
      });
      _phPatchLocal('recon',poId,out.recon);
      _phQcwPatchLots([out.lot]);
      _phQcwPatchPo(poId,{packingReceipts:out.receipts});
      if(typeof phHistoryForget==='function')phHistoryForget(poId);
      _phLog('QC lot received',poId+' - lot #'+out.lot.data.seq+', '+out.lot.data.total+' pcs');
      return{ok:true,id:poId,lotId:out.lot.id,seq:out.lot.data.seq,total:out.lot.data.total,rev:out.recon.rev,locked:out.locked,recon:out.recon,lot:out.lot.data,historyId:out.historyId};
    });
  }catch(e){return _phFromError(e);}
}

/* Void a lot (it stays listed, struck through, with the reason). A manager any time; Faizan his OWN lot within 24 hours.
   reason: at least 3 characters. opts {expectedRev (optional: the reconciliation revision), now, actor}. Refused on a closed
   reconciliation (an owner reopens it first). */
async function phQcVoidLot(lotId,reason,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phQcwNeedOps(a.u);if(no)return no;
  if(!PHQC_LOT_ID_RE.test(String(lotId)))return _phFail('invalid','Not a QC lot id: '+lotId);
  const why=_phStr(reason,500);
  if(why.length<PHQC_VOID_REASON_MIN)return _phFail('invalid','A reason of at least '+PHQC_VOID_REASON_MIN+' characters is needed to void a lot.');
  const poId=String(lotId).replace(/-[0-9]{13}-[A-Za-z0-9]{4}$/,'');
  if(_phOffline())return _phFail('offline','No connection. Voiding a lot is a transaction, which cannot be queued - nothing was changed.');
  try{
    return await _phSilent(false,async function(){
      const now=_phNowOf(o),ctx={u:a.u,name:a.name,now:now,rand:o.rand};
      const lref=doc(db,'po_qc_lots',lotId),rref=doc(db,'po_qc_recon',poId),pref=doc(db,'pos',poId);
      let out=null;
      await runTransaction(db,async function(tx){
        out=null;
        const ls=await tx.get(lref);
        if(!ls||!ls.exists())throw _phRefuse('missing','QC lot '+lotId+' does not exist.');
        const L=ls.data()||{};
        if(L.poId!==poId)throw _phRefuse('refused','QC lot '+lotId+' does not belong to '+poId+'.');
        if(L.status!=='live')throw _phRefuse('refused','QC lot '+lotId+' is already void.');
        const r=_phQcwRecon(await tx.get(rref));
        if(!r)throw _phRefuse('missing','PO '+poId+' has no QC reconciliation.');
        if(!_phQcwOpenStatus(r))throw _phRefuse('refused','The QC reconciliation of '+poId+' is '+r.status+'. '+(r.status==='closed'?'An owner can reopen it first.':''));
        if(o.expectedRev!=null&&r.rev!==o.expectedRev)throw _phRefuse('stale','The QC reconciliation of '+poId+' was changed by someone else (revision '+r.rev+'). Reload it.',{rev:r.rev});
        const mv=phQcMoveProblem(r.status,r.status,'void',a.u);if(mv)throw _phRefuse('forbidden',mv);
        if(!phCanManage(a.u)){
          if(L.by!==a.u)throw _phRefuse('forbidden','Only a manager can void a lot someone else received.');
          if(now-(typeof L.at==='number'?L.at:0)>PHQC_VOID_WINDOW_MS)throw _phRefuse('forbidden','Your lot is more than 24 hours old; only a manager can void it now.');
        }
        const ps=await tx.get(pref);
        if(!ps||!ps.exists())throw _phRefuse('missing','PO '+poId+' does not exist.');
        const po=ps.data()||{};
        const h=phBuildHistoryRow({type:'qc_lot_voided',from:r.status,to:r.status,reason:why,data:{lotId:lotId,seq:L.seq,total:L.total,sizes:_phIsObj(L.sizes)?L.sizes:{}}},ctx);
        if(h.error)throw _phRefuse('invalid',h.error);
        const lpatch={status:'void',voidedAt:now,voidedBy:a.u,voidReason:why};
        const rpatch={voidCount:(typeof r.voidCount==='number'?r.voidCount:0)+1,rev:r.rev+1,updatedAt:now,updatedBy:a.u,updatedByName:_phStr(a.name||a.u,60)};
        tx.update(lref,lpatch);
        tx.update(rref,rpatch);
        let receipts=null;
        if(L.src!=='legacy'&&_phIsObj(L.sizes)){
          receipts=(Array.isArray(po.packingReceipts)?po.packingReceipts:[]).concat(_phQcwMirror(lotId,L.sizes,-1,ctx));
          tx.update(pref,{packingReceipts:receipts});
        }
        tx.set(doc(db,'pos',poId,'history',h.id),h.data);
        out={lot:Object.assign({},L,lpatch),recon:Object.assign({},r,rpatch),receipts:receipts,historyId:h.id};
      });
      _phPatchLocal('recon',poId,out.recon);
      _phQcwPatchLots([{id:lotId,data:out.lot}]);
      if(out.receipts)_phQcwPatchPo(poId,{packingReceipts:out.receipts});
      if(typeof phHistoryForget==='function')phHistoryForget(poId);
      _phLog('QC lot voided',poId+' - lot #'+out.lot.seq+' ('+lotId+'), '+out.lot.total+' pcs');
      return{ok:true,id:poId,lotId:lotId,rev:out.recon.rev,lot:out.lot,recon:out.recon,historyId:out.historyId};
    });
  }catch(e){return _phFromError(e);}
}

/* Close a PO's reconciliation. opts {expectedRev (required), reason, cause, now, actor, rand}.
   phase 'ready' (exact / within 2 % / over inside the allowance): QC Ops or a manager; the reason is optional.
   phase 'receiving' or 'short' (CHANGE FROM THE PLAN, owner decision 15 Oct 2026): a MANAGER only, with a reason of at least 5
   characters and a cause (PHQC_CLOSE_CAUSES); an overrides row, a qc_closed_short history row and bell rows to the other managers.
   'awaiting_qc' (nothing received yet) is refused for everyone. The PO must be at stitching or later (or completed). */
async function phQcClose(poId,opts){
  const o=opts||{},a=_phActor(o);
  const no=_phQcwNeedOps(a.u);if(no)return no;
  if(!PH_PO_ID_RE.test(String(poId)))return _phFail('invalid','Not a PO id: '+poId);
  const er=_phQcwRev(o.expectedRev);
  if(er===null||er<1)return _phFail('invalid','The reconciliation revision you are looking at is needed to close it. Reload and retry.');
  if(_phOffline())return _phFail('offline','No connection. Closing a PO is a transaction, which cannot be queued - nothing was changed.');
  try{
    return await _phSilent(false,async function(){
      const now=_phNowOf(o),ctx={u:a.u,name:a.name,now:now,rand:o.rand};
      const lr=await _phQcwLotsFresh(poId);
      if(!lr.ok)return _phFail('unread',lr.error);
      // R1: the PO's bundles, read BEFORE the transaction (a transaction cannot query). A failed read does NOT stop the close; it
      // only means the classic Final QC fields are not written.
      const br=await _phQcwBundlesFresh(poId);
      const pref=doc(db,'pos',poId),rref=doc(db,'po_qc_recon',poId);
      let out=null;
      await runTransaction(db,async function(tx){
        out=null;
        const ps=await tx.get(pref);
        if(!ps||!ps.exists())throw _phRefuse('missing','PO '+poId+' does not exist.');
        const po=Object.assign({},ps.data()||{},{id:poId});
        const r=_phQcwRecon(await tx.get(rref));
        if(!r)throw _phRefuse('missing','PO '+poId+' has no QC reconciliation: nothing has been received or locked.');
        if(r.status==='closed')throw _phRefuse('refused','The QC reconciliation of '+poId+' is already closed.');
        if(!_phQcwOpenStatus(r))throw _phRefuse('refused','The QC reconciliation of '+poId+' is '+r.status+'.');
        if(r.rev!==er)throw _phRefuse('stale','The QC reconciliation of '+poId+' was changed by someone else (revision '+r.rev+'). Reload it.',{rev:r.rev});
        const lc=_phQcwLotsCheck(lr.rows,r);if(lc)throw _phRefuse('stale',lc);
        if(!_phQcwStageOk(po))throw _phRefuse('refused','PO '+poId+' is at '+phStageOf(po)+'; a PO is closed at QC from stitching on.');
        const rc=phQcReconcile(po,r,lr.rows);
        if(!rc.ok)throw _phRefuse('refused','The reconciliation of '+poId+' cannot be judged: '+rc.why+'.');
        let action;
        if(rc.phase==='ready'){action='close';}
        else if(rc.phase==='receiving'||rc.phase==='short'){
          action='close_short';
          if(!phCanManage(a.u))throw _phRefuse('forbidden',rc.phase==='short'?'PO '+poId+' is outside the 2 % tolerance. Only a manager (Afnan, Ammar or Mustafa) can close it, with a reason.':'PO '+poId+' has not received its cut yet. Only a manager (Afnan, Ammar or Mustafa) can close it now, with a reason.');
        }else if(rc.phase==='awaiting_qc')throw _phRefuse('refused','Nothing has been received at QC on '+poId+' yet, so it cannot be closed.');
        else throw _phRefuse('refused','PO '+poId+' cannot be closed now ('+rc.phase+').');
        const reason=_phStr(o.reason,500);
        if(action==='close_short'){
          if(reason.length<PHQC_REASON_MIN)throw _phRefuse('invalid','A reason of at least '+PHQC_REASON_MIN+' characters is needed to close a PO outside the tolerance.');
          if(PHQC_CLOSE_CAUSES.indexOf(o.cause)<0)throw _phRefuse('invalid','Choose a cause: '+PHQC_CLOSE_CAUSES.join(', ')+'.');
          if((Array.isArray(r.overrides)?r.overrides.length:0)>=PHQC_OVERRIDES_MAX)throw _phRefuse('refused','This reconciliation has '+PHQC_OVERRIDES_MAX+' overrides already; no more can be recorded.');
        }
        const mv=phQcMoveProblem(r.status,'closed',action,a.u);if(mv)throw _phRefuse('forbidden',mv);
        // R1: may the classic Final QC fields be written? Judged on the PO as read in THIS transaction; when the answer is yes, every
        // bundle is read again here (reads before writes) and judged again, so a bundle changed since the read is seen.
        let cls=phQcClassicDecision(po,br);
        if(cls.write){
          const fresh=[];let gone=false;
          for(const row of br.rows){const bs=await tx.get(doc(db,'bundles',row._id));if(!bs||!bs.exists()){gone=true;break;}const bd=bs.data()||{};if(bd.poId!==poId){gone=true;break;}fresh.push(bd);}
          cls=gone?{write:false,why:'bundles changed while saving',failed:0}:phQcClassicDecision(po,{ok:true,rows:fresh});
        }
        const snap=phQcVerdictSnap(rc);
        const patch={status:'closed',closedAt:now,closedBy:a.u,closedByName:_phStr(a.name||a.u,60),closeVerdict:snap,rev:r.rev+1,updatedAt:now,updatedBy:a.u,updatedByName:_phStr(a.name||a.u,60)};
        if(action==='close_short')patch.overrides=(Array.isArray(r.overrides)?r.overrides:[]).concat([phQcBuildOverride('close_short',reason,ctx,{cause:o.cause})]);
        const pp=phQcClosePosPatch(po,rc,ctx,cls);
        const classic={written:cls.write===true&&'currentStage' in pp,why:cls.why};
        const h=phBuildHistoryRow({type:action==='close'?'qc_closed':'qc_closed_short',from:r.status,to:'closed',reason:reason,
          data:{state:snap.state,phase:snap.phase,cut:snap.total.cut,recv:snap.total.recv,diff:snap.total.diff,override:action==='close_short',cause:action==='close_short'?o.cause:'',
            classicWritten:classic.written,classicWhy:_phStr(classic.why,120)}},ctx);
        if(h.error)throw _phRefuse('invalid',h.error);
        const bells=action==='close_short'?phQcBellRows('close',poId,'Closed outside 2 %: '+poId,(a.name||a.u)+' closed '+poId+' at QC with '+snap.total.recv+' of '+snap.total.cut+' received ('+rc.phase+', '+o.cause+'). Reason: '+reason,ctx):[];
        tx.update(rref,patch);
        tx.update(pref,pp);
        tx.set(doc(db,'pos',poId,'history',h.id),h.data);
        bells.forEach(function(b){tx.set(doc(db,'hrm_notifications',b.id),b.data);});
        out={recon:Object.assign({},r,patch),posPatch:pp,historyId:h.id,action:action,bells:bells.map(function(b){return b.data.forUser;}),phase:rc.phase,verdict:snap,classic:classic};
      });
      _phPatchLocal('recon',poId,out.recon);
      _phQcwPatchPo(poId,out.posPatch);
      if(typeof phHistoryForget==='function')phHistoryForget(poId);
      _phLog(out.action==='close'?'QC PO closed':'QC PO closed with shortfall',poId+' - '+out.verdict.total.recv+' of '+out.verdict.total.cut+' received; Final QC '+(out.classic.written?'marked complete':'not marked complete'));
      return{ok:true,id:poId,rev:out.recon.rev,action:out.action,phase:out.phase,verdict:out.verdict,recon:out.recon,posPatch:out.posPatch,classic:out.classic,told:out.bells,historyId:out.historyId};
    });
  }catch(e){return _phFromError(e);}
}

/* An OWNER replaces the cut snapshot from the PO's recorded cut (a hand correction happened after the lock). Allowed ONLY when the
   PO's cut differs from the lock; nobody types a new cut here. reason >= 5 characters. opts {expectedRev (required), reason, now,
   actor}. One transaction: the reconciliation (cutLock + an overrides row with before/after), a history row qc_cut_relocked and bell
   rows to the other managers. */
async function phQcRelock(poId,opts){
  const o=opts||{},a=_phActor(o);
  if(!phIsOwner(a.u))return _phFail('forbidden','Only an owner (Afnan or Ammar) can replace the cut snapshot.');
  if(!PH_PO_ID_RE.test(String(poId)))return _phFail('invalid','Not a PO id: '+poId);
  const er=_phQcwRev(o.expectedRev);
  if(er===null||er<1)return _phFail('invalid','The reconciliation revision you are looking at is needed. Reload and retry.');
  const reason=_phStr(o.reason,500);
  if(reason.length<PHQC_REASON_MIN)return _phFail('invalid','A reason of at least '+PHQC_REASON_MIN+' characters is needed to replace the cut snapshot.');
  if(_phOffline())return _phFail('offline','No connection. Replacing the cut snapshot is a transaction, which cannot be queued - nothing was changed.');
  try{
    return await _phSilent(false,async function(){
      const now=_phNowOf(o),ctx={u:a.u,name:a.name,now:now,rand:o.rand};
      const pref=doc(db,'pos',poId),rref=doc(db,'po_qc_recon',poId);
      let out=null;
      await runTransaction(db,async function(tx){
        out=null;
        const ps=await tx.get(pref);
        if(!ps||!ps.exists())throw _phRefuse('missing','PO '+poId+' does not exist.');
        const po=ps.data()||{};
        const r=_phQcwRecon(await tx.get(rref));
        if(!r)throw _phRefuse('missing','PO '+poId+' has no QC reconciliation, so there is no cut snapshot to replace.');
        if(!_phQcwOpenStatus(r))throw _phRefuse('refused','The QC reconciliation of '+poId+' is '+r.status+'. '+(r.status==='closed'?'Reopen it first.':''));
        if(r.rev!==er)throw _phRefuse('stale','The QC reconciliation of '+poId+' was changed by someone else (revision '+r.rev+'). Reload it.',{rev:r.rev});
        const mv=phQcMoveProblem(r.status,r.status,'relock',a.u);if(mv)throw _phRefuse('forbidden',mv);
        const exp=phQcExpected(po,r,{model:_phQcwModel(po)});
        if(!exp.ok)throw _phRefuse('refused','The cut snapshot of '+poId+' cannot be read: '+exp.why+'.');
        if(!exp.drift)throw _phRefuse('refused','The PO\'s cut is the same as the locked snapshot; there is nothing to replace.');
        const lk=phQcBuildLock(po,ctx,'relock');
        if(lk.error)throw _phRefuse('refused',lk.error);
        if((Array.isArray(r.overrides)?r.overrides.length:0)>=PHQC_OVERRIDES_MAX)throw _phRefuse('refused','This reconciliation has '+PHQC_OVERRIDES_MAX+' overrides already; no more can be recorded.');
        const before=r.cutLock&&_phIsObj(r.cutLock.sizes)?r.cutLock.sizes:{};
        const patch={cutLock:lk.lock,overrides:(Array.isArray(r.overrides)?r.overrides:[]).concat([phQcBuildOverride('relock',reason,ctx,{before:before,after:lk.lock.sizes})]),
          rev:r.rev+1,updatedAt:now,updatedBy:a.u,updatedByName:_phStr(a.name||a.u,60)};
        const h=phBuildHistoryRow({type:'qc_cut_relocked',from:r.status,to:r.status,reason:reason,data:{before:before,after:lk.lock.sizes}},ctx);
        if(h.error)throw _phRefuse('invalid',h.error);
        const changed=exp.drift.sizes.map(function(d){return d.size+' '+d.lock+' -> '+d.live;}).join(', ');
        const bells=phQcBellRows('relock',poId,'Cut snapshot replaced: '+poId,(a.name||a.u)+' replaced the locked cut of '+poId+' ('+changed+'). Reason: '+reason,ctx);
        tx.update(rref,patch);
        tx.set(doc(db,'pos',poId,'history',h.id),h.data);
        bells.forEach(function(b){tx.set(doc(db,'hrm_notifications',b.id),b.data);});
        out={recon:Object.assign({},r,patch),historyId:h.id,bells:bells.map(function(b){return b.data.forUser;}),drift:exp.drift};
      });
      _phPatchLocal('recon',poId,out.recon);
      if(typeof phHistoryForget==='function')phHistoryForget(poId);
      _phLog('QC cut relocked',poId+' - '+out.drift.sizes.length+' size'+(out.drift.sizes.length===1?'':'s')+' changed');
      return{ok:true,id:poId,rev:out.recon.rev,recon:out.recon,drift:out.drift,told:out.bells,historyId:out.historyId};
    });
  }catch(e){return _phFromError(e);}
}

/* An OWNER reopens a closed reconciliation (status reopened). The pos document is NOT touched: a PO the close marked completed
   stays completed until it is closed again. reason >= 5 characters. opts {expectedRev (required), reason, now, actor}. */
async function phQcReopen(poId,opts){
  const o=opts||{},a=_phActor(o);
  if(!phIsOwner(a.u))return _phFail('forbidden','Only an owner (Afnan or Ammar) can reopen a closed QC reconciliation.');
  if(!PH_PO_ID_RE.test(String(poId)))return _phFail('invalid','Not a PO id: '+poId);
  const er=_phQcwRev(o.expectedRev);
  if(er===null||er<1)return _phFail('invalid','The reconciliation revision you are looking at is needed. Reload and retry.');
  const reason=_phStr(o.reason,500);
  if(reason.length<PHQC_REASON_MIN)return _phFail('invalid','A reason of at least '+PHQC_REASON_MIN+' characters is needed to reopen a reconciliation.');
  if(_phOffline())return _phFail('offline','No connection. Reopening is a transaction, which cannot be queued - nothing was changed.');
  try{
    return await _phSilent(false,async function(){
      const now=_phNowOf(o),ctx={u:a.u,name:a.name,now:now,rand:o.rand};
      const pref=doc(db,'pos',poId),rref=doc(db,'po_qc_recon',poId);
      let out=null;
      await runTransaction(db,async function(tx){
        out=null;
        const ps=await tx.get(pref);
        if(!ps||!ps.exists())throw _phRefuse('missing','PO '+poId+' does not exist.');
        const r=_phQcwRecon(await tx.get(rref));
        if(!r)throw _phRefuse('missing','PO '+poId+' has no QC reconciliation.');
        if(r.status!=='closed')throw _phRefuse('refused','The QC reconciliation of '+poId+' is '+r.status+', not closed.');
        if(r.rev!==er)throw _phRefuse('stale','The QC reconciliation of '+poId+' was changed by someone else (revision '+r.rev+'). Reload it.',{rev:r.rev});
        const mv=phQcMoveProblem('closed','reopened','reopen',a.u);if(mv)throw _phRefuse('forbidden',mv);
        if((Array.isArray(r.overrides)?r.overrides.length:0)>=PHQC_OVERRIDES_MAX)throw _phRefuse('refused','This reconciliation has '+PHQC_OVERRIDES_MAX+' overrides already; no more can be recorded.');
        const patch={status:'reopened',overrides:(Array.isArray(r.overrides)?r.overrides:[]).concat([phQcBuildOverride('reopen',reason,ctx)]),
          rev:r.rev+1,updatedAt:now,updatedBy:a.u,updatedByName:_phStr(a.name||a.u,60)};
        const h=phBuildHistoryRow({type:'qc_reopened',from:'closed',to:'reopened',reason:reason},ctx);
        if(h.error)throw _phRefuse('invalid',h.error);
        tx.update(rref,patch);
        tx.set(doc(db,'pos',poId,'history',h.id),h.data);
        out={recon:Object.assign({},r,patch),historyId:h.id};
      });
      _phPatchLocal('recon',poId,out.recon);
      if(typeof phHistoryForget==='function')phHistoryForget(poId);
      _phLog('QC PO reopened',poId+' - reconciliation revision '+out.recon.rev);
      return{ok:true,id:poId,rev:out.recon.rev,recon:out.recon,historyId:out.historyId};
    });
  }catch(e){return _phFromError(e);}
}

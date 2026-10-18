/* ─────────────────────────────────────────────────────────────────────────
   js/ph-mod-health.js — Production Ops ▸ DATA HEALTH (14 Oct 2026)

   Three things in one small file, all READ-ONLY (it writes nothing and calls no ph-write function):

   1. THE SOURCES. One shared, cached, never-rejecting read of `pos` and `gatepasses` (the classic app's own
      lists, allPOs / allPasses, when they hold anything; else one bounded read of our own). Monitor (the
      stuck basis), Today's Cutting (find the fabric issue) and Masters (the master log) ask it, so a
      refused read is NAMED ("unavailable - gatepasses") and is never an empty list.

   2. THE PO KEY. 71 of the 208 real fabric gate passes store poId as bare digits ('125'), not 'PO-125'.
      Every match of a pass to a PO in Production Ops goes through ph-core's phPoKey().

   3. THE DATA-HEALTH MODEL AND SCREEN: seven checks over what the books hold today, each with a count and a
      drill list (phhBuildModel is pure; the screen is a section of the Monitor tab and a card on Overview).
        1 cutting_no_pass .... POs at cutting with no fabric gate pass
        2 digits_only ........ POs matched to their passes only by the bare-digits spelling
        3 orphan_passes ...... fabric passes pointing at no real PO ('Sample', '538' when no PO-538 exists, blank)
        4 reserved_issued .... reserved POs that already have fabric issued
        5 qty_mismatch ....... POs whose quantity is not the sum of their sizes
        6 pass_no_master ..... fabric passes with no cutting master
        7 jobs_no_fabric ..... open cut jobs with no fabric link (no pass, none picked this session)
        8 released_unreadable  (PO Registry RG2) POs whose releasedAt is stored but cannot be read as a moment; the note says how
                               many are stored as text (the legacy ISO string) and how many as a number (born released, WP13)
        9 bundles_no_cut ..... (PO Registry RG2, managers only) bundles whose PO carries no recorded cut, or whose PO does not
                               exist (live survey 15 Oct 2026: 58 bundles while no pos document had a cut). Needs a bounded read
                               of `bundles` (no order, so a bundle with no ts is not left out), started only for a manager.
      A check whose inputs did not load says "unavailable - <collection>"; it never prints 0.

   QC OPS (16 Oct 2026): three more checks, for managers, over the QC reconciliation (po_qc_recon) and its lots (po_qc_lots).
   Both are LAZY stages of js/ph-data.js: phhEnsure(force,{qc:true}) reads them (the health screen asks only for a manager;
   Kashif's Overview card never pays for them). A refused, offline-copy or CUT-AT-ITS-LIMIT read makes the checks that need
   it "unavailable - <collection>", never 0.
        8 qc_cut_drift ............. a reconciliation whose locked cut differs from what the PO now says it cut
        9 qc_two_ledgers ........... the old Packing records and the QC lots both hold units for a PO, or the pos.packingReceipts
                                     mirror of the QC lots does not equal the live lots
       10 qc_completed_unreconciled  completed in the classic flow with no reconciliation (or one left unclosed) AFTER go-live;
                                     POs finished before go-live are counted apart as "before QC Ops", never as failures
       11 qc_closed_short .......... (wave 2) reconciliations a manager closed with a shortfall (close verdict short / receiving):
                                     received vs cut and the recorded cause; a place to look for a pattern, not an error
   GO-LIVE DAY (phhQcLiveDay): the PKT day of the OLDEST po_qc_recon.createdAt; only when no reconciliation exists is the
   named constant PHH_QC_LIVE_DAY_FALLBACK used. A data fact beats a date written before the deploy.

   FIND-THE-ISSUE: phhCandidates() ranks the orphan fabric passes for one PO (date near its release, then the
   fabric name). The pick is kept IN MEMORY for the session (phhPick). It is NOT written to po_cut_jobs: the
   published rules for that collection allow no `fabricPassIds` field (phJobShapeOk / the create and update
   field lists), and a rules change is out of this file's scope. gatepasses is never written.

   Globals are phh / _phh / PHH_ prefixed (classic scripts share one lexical scope).
   ───────────────────────────────────────────────────────────────────────── */

const PHH_READ_TIMEOUT_MS=20000;
const PHH_LIMITS=Object.freeze({pos:2000,gatepasses:4000,bundles:4000});
const PHH_LIST_SHOW=25;
const PHH_CAND_MAX=8;
const PHH_QC_LIVE_DAY_FALLBACK='2026-10-16';   // used ONLY while no po_qc_recon exists (phhQcLiveDay)
const PHH_CHECKS=Object.freeze([
  {id:'cutting_no_pass',label:'POs at cutting with no fabric issue',need:['pos','gatepasses'],hint:'The cutting screen cannot show or check rolls for these.'},
  {id:'digits_only',label:'POs matched to their fabric issue only by the digit spelling',need:['pos','gatepasses'],hint:'The pass stores the PO as 125 instead of PO-125. It is matched, but the spelling should be fixed at the source.'},
  {id:'orphan_passes',label:'Fabric issues pointing at no real PO',need:['pos','gatepasses'],hint:'The PO on the pass is blank, free text (Sample) or a number with no PO.'},
  {id:'reserved_issued',label:'Reserved POs that already have fabric issued',need:['pos','gatepasses'],hint:'Fabric left the store for a PO that was never released.'},
  {id:'qty_mismatch',label:'POs where the quantity is not the sum of the sizes',need:['pos'],hint:'qty and sizes disagree.'},
  {id:'pass_no_master',label:'Fabric issues with no cutting master',need:['gatepasses'],hint:'Reports and the master log cannot credit these cuts.'},
  {id:'jobs_no_fabric',label:'Open cut jobs with no fabric link',need:['po_cut_jobs','gatepasses'],hint:'The roll check has nothing to check against.'},
  {id:'released_unreadable',label:'POs whose release date cannot be read',need:['pos'],hint:'releasedAt is stored but is not a date or a time. The PO cannot be dated from its release.'},
  {id:'bundles_no_cut',mgr:true,label:'Bundles whose PO carries no recorded cut',need:['pos','bundles'],hint:'Bundles exist for a PO that has no cut recorded on it, or for a PO that does not exist. The PO may have been overwritten or deleted after it was cut.'},
  {id:'qc_cut_drift',qc:true,label:'QC: the locked cut no longer matches the PO',need:['pos','po_qc_recon'],hint:'The cut QC locked differs from the cut now recorded on the PO. QC keeps holding the locked figure; an owner decides whether to replace it.'},
  {id:'qc_two_ledgers',qc:true,label:'QC: the old Packing records and the QC lots disagree',need:['pos','po_qc_lots','po_qc_recon'],hint:'Units were received through the old Packing page and in QC lots, or the packing counter does not equal the live lots. (Needs the reconciliations too: they record which old receipts were adopted.)'},
  {id:'qc_completed_unreconciled',qc:true,label:'QC: completed without a closed reconciliation',need:['pos','po_qc_recon'],hint:'Finished in the classic flow after QC Ops went live, with no reconciliation or one still open. POs finished before go-live are not counted.'},
  {id:'qc_closed_short',qc:true,label:'QC: closed with a shortfall',need:['pos','po_qc_recon'],hint:'A manager closed these with fewer units than were cut (the override is recorded with a cause and a reason). Not an error: a place to look for a pattern - a master, a line, a size.'}
]);

/* ═══ PURE ═══════════════════════════════════════════════════════════════ */
function _phhObj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function _phhIsFabric(g){return _phhObj(g)&&phStr(g.gpType)==='fabric';}
function _phhPoId(po){const i=phStr(po&&po.id).trim();return i||phStr(po&&po.fbKey).trim();}
function _phhPassId(g){const i=phStr(g&&g.id).trim();return i||phStr(g&&g.fbKey).trim();}
function _phhPassMs(g){
  const d=phMs(g&&g.date);
  return d!==null?d:phMs(g&&g.ts);
}
function _phhPassPoRaw(g){return g.poId!=null?g.poId:(g.poRef!=null?g.poRef:g.poNumber);}
function _phhSizeSum(sizes){
  if(!_phhObj(sizes))return null;
  let t=0,any=false;
  Object.keys(sizes).forEach(function(k){const n=phWhole(sizes[k]);if(n!==null){t+=n;any=true;}});
  return any?t:null;
}
// Fabric passes of a list -> Map(poKey -> [{gp, ms, spelling}]) (oldest first) and the passes with no PO key.
function phhPassIndex(passes){
  const idx=new Map(),unkeyed=[];
  (Array.isArray(passes)?passes:[]).forEach(function(g){
    if(!_phhIsFabric(g))return;
    const raw=_phhPassPoRaw(g),k=phPoKey(raw);
    if(k===null){unkeyed.push(g);return;}
    if(!idx.has(k))idx.set(k,[]);
    idx.get(k).push({gp:g,ms:_phhPassMs(g),spelling:phPoSpelling(raw)});
  });
  idx.forEach(function(l){l.sort(function(a,b){return(a.ms===null?Infinity:a.ms)-(b.ms===null?Infinity:b.ms);});});
  return{byPo:idx,unkeyed:unkeyed};
}
// poKey -> ms of the FIRST fabric issue (the oldest pass date). Used as the start of a PO's time at cutting.
function phhFirstIssueMap(passes){
  const idx=phhPassIndex(passes),out={};
  idx.byPo.forEach(function(l,k){const f=l.filter(function(x){return x.ms!==null;});if(f.length)out[k]=f[0].ms;});
  return out;
}
// QC: go-live day = the PKT day of the OLDEST po_qc_recon.createdAt; the named fallback only when no reconciliation has one.
// -> {day, source:'recon'|'fallback'}
function phhQcLiveDay(recon){
  let min=null;
  (Array.isArray(recon)?recon:[]).forEach(function(rc){
    const ms=_phhObj(rc)?phMs(rc.createdAt):null;
    if(ms!==null&&(min===null||ms<min))min=ms;
  });
  const d=min!==null?phDay(min):null;
  return d?{day:d,source:'recon'}:{day:PHH_QC_LIVE_DAY_FALLBACK,source:'fallback'};
}
// When a classic-completed PO finished: stages.qc.doneAt, else (plan 7.3) its cut date. -> {day, basis} (day null = undated)
function _phhQcFinish(po){
  const q=_phhObj(po.stages)&&_phhObj(po.stages.qc)?phDay(po.stages.qc.doneAt):null;
  if(q)return{day:q,basis:'QC done'};
  const c=phDay(po.cutAt);
  return c?{day:c,basis:'cut date'}:{day:null,basis:''};
}
function _phhSz(k){const s=phStr(k).trim().toUpperCase();return s==='XXL'?'2XL':s;}
function _phhSizeText(m){return Object.keys(m).sort().map(function(k){return k+' '+m[k];}).join(', ');}
// One PO's two ledgers. lots = its po_qc_lots rows, rc = its reconciliation (or null).
// -> {legacyUnits (old Packing units not adopted), mirror {size:net of src:'qc' packing entries}, live {size:units of live QC lots}, lotRows}
function _phhLedgers(po,lots,rc){
  const adopted=new Set(_phhObj(rc)&&Array.isArray(rc.legacyIds)?rc.legacyIds.map(String):[]);
  let legacyUnits=0;const mirror={},live={};
  (Array.isArray(po.packingReceipts)?po.packingReceipts:[]).forEach(function(e){
    if(!_phhObj(e))return;
    if(e.src==='qc'){const q=phNum(e.qty);if(q!==null){const k=_phhSz(e.size);mirror[k]=(mirror[k]||0)+q;}return;}
    if(typeof e.size!=='string'||!e.size)return;
    const id=typeof e.id==='string'&&e.id?e.id:(String(e.receiptId||'')+'-'+e.size);
    const q=phWhole(e.qty);
    if(q!==null&&q>0&&!adopted.has(id))legacyUnits+=q;
  });
  lots.forEach(function(l){
    if(!_phhObj(l)||l.status!=='live'||l.src==='legacy'||!_phhObj(l.sizes))return;
    Object.keys(l.sizes).forEach(function(k){const n=phWhole(l.sizes[k]);if(n){const z=_phhSz(k);live[z]=(live[z]||0)+n;}});
  });
  return{legacyUnits:legacyUnits,mirror:mirror,live:live,lotRows:lots.length};
}
// The model. inp: {pos, passes, jobs, picks:{poKey:[passId]}} (each null/absent = not loaded).
// QC inputs: recon / lots (lists, or null = not read), reconTruncated / lotsTruncated (a list cut at its limit is NOT complete),
// qc:false leaves the three QC checks out altogether (a non-manager never reads them).
function phhBuildModel(inp){
  const I=_phhObj(inp)?inp:{};
  const posOk=Array.isArray(I.pos),passOk=Array.isArray(I.passes),jobsOk=Array.isArray(I.jobs);
  const qcOn=I.qc!==false;
  const reconOk=Array.isArray(I.recon)&&I.reconTruncated!==true,lotsOk=Array.isArray(I.lots)&&I.lotsTruncated!==true;
  const bunOk=Array.isArray(I.bundles)&&I.bundlesTruncated!==true;
  const avail={pos:posOk,gatepasses:passOk,po_cut_jobs:jobsOk,po_qc_recon:reconOk,po_qc_lots:lotsOk,bundles:bunOk};
  const availName=function(n){
    if(n==='po_qc_recon'&&Array.isArray(I.recon)&&I.reconTruncated===true)return'po_qc_recon (list cut at its limit, not complete)';
    if(n==='po_qc_lots'&&Array.isArray(I.lots)&&I.lotsTruncated===true)return'po_qc_lots (list cut at its limit, not complete)';
    if(n==='bundles'&&Array.isArray(I.bundles)&&I.bundlesTruncated===true)return'bundles (list cut at its limit, not complete)';
    return n;
  };
  const picks=_phhObj(I.picks)?I.picks:{};
  const M={avail:avail,checks:[],total:0,anyUnavailable:false,counts:{pos:posOk?I.pos.length:null,fabricPasses:passOk?I.passes.filter(_phhIsFabric).length:null},qc:null};
  if(qcOn){const lv=phhQcLiveDay(reconOk?I.recon:null);M.qc={liveDay:lv.day,liveSource:lv.source,beforeQcOps:0,undated:0};}
  const pidx=passOk?phhPassIndex(I.passes):null;
  const allKeys=new Set(),live=[],cutKeys=new Set();
  if(posOk)I.pos.forEach(function(po){
    if(!_phhObj(po))return;
    const k=phPoKey(_phhPoId(po));
    if(k!==null&&(phMs(po.cutAt)!==null||(_phhObj(po.stages)&&_phhObj(po.stages.cutting)&&po.stages.cutting.done===true)))cutKeys.add(k);
    if(k!==null)allKeys.add(k);
    const st=phStageOf(po);
    if(st===null||st==='cancelled')return;
    live.push({po:po,id:_phhPoId(po),key:k,stage:st});
  });
  const passRow=function(g,why){return{kind:'pass',id:_phhPassId(g),text:[phStr(g.date)||'no date',phStr(g.fabricType||g.article).trim()||'fabric not named',(phNum(g.fabricQty!=null?g.fabricQty:g.totalWeight)!==null?phNum(g.fabricQty!=null?g.fabricQty:g.totalWeight)+' '+(phUnit(g.fabricUnit)||'kg'):''),'PO field: '+(phStr(_phhPassPoRaw(g)).trim()||'blank'),why||''].filter(Boolean).join(' · ')};};
  const poRow=function(e,why){return{kind:'po',id:e.id,fbKey:phStr(e.po.fbKey)||e.id,text:[phStr(e.po.name).trim()||phStr(e.po.code).trim()||'unnamed',e.stage,why||''].filter(Boolean).join(' · ')};};
  const res={};
  const mk=function(c){
    const miss=c.need.filter(function(n){return!avail[n];});
    const r={id:c.id,label:c.label,hint:c.hint,state:miss.length?'unavailable':'ok',unavailable:miss.map(availName),count:null,items:[],note:''};
    res[c.id]=r;M.checks.push(r);
    if(miss.length)M.anyUnavailable=true;
    return r;
  };
  PHH_CHECKS.forEach(function(c){
    if((c.qc||c.mgr)&&!qcOn)return;
    const r=mk(c);
    if(r.state!=='ok')return;
    if(c.id==='cutting_no_pass'){
      live.forEach(function(e){if(e.stage==='cutting'&&!(e.key&&pidx.byPo.has(e.key)))r.items.push(poRow(e,'no fabric issue'));});
    }else if(c.id==='digits_only'){
      live.forEach(function(e){
        const l=e.key?pidx.byPo.get(e.key):null;
        if(l&&l.length&&l.every(function(x){return x.spelling==='digits';}))r.items.push(poRow(e,l.length+(l.length===1?' pass':' passes')+' ('+l.map(function(x){return _phhPassId(x.gp);}).join(', ')+')'));
      });
    }else if(c.id==='orphan_passes'){
      (I.passes||[]).forEach(function(g){
        if(!_phhIsFabric(g))return;
        const k=phPoKey(_phhPassPoRaw(g));
        if(k===null)r.items.push(passRow(g,'not a PO number'));
        else if(!allKeys.has(k))r.items.push(passRow(g,k+' does not exist'));
      });
    }else if(c.id==='reserved_issued'){
      live.forEach(function(e){if(e.stage==='reserved'&&e.key&&pidx.byPo.has(e.key)){const l=pidx.byPo.get(e.key);r.items.push(poRow(e,l.length+(l.length===1?' issue':' issues')+' on file'));}});
    }else if(c.id==='qty_mismatch'){
      live.forEach(function(e){
        const q=phWhole(e.po.qty),s=_phhSizeSum(e.po.sizes);
        if(q!==null&&s!==null&&q!==s)r.items.push(poRow(e,'qty '+q+' but sizes add to '+s));
      });
    }else if(c.id==='pass_no_master'){
      I.passes.forEach(function(g){if(_phhIsFabric(g)&&!phStr(g.cutMaster).trim())r.items.push(passRow(g,''));});
    }else if(c.id==='jobs_no_fabric'){
      I.jobs.forEach(function(j){
        if(!_phhObj(j)||phStr(j.status)!=='open')return;
        const id=phStr(j.fbKey!=null?j.fbKey:j.poId).trim(),k=phPoKey(id);
        if(k===null)return;
        if(pidx.byPo.has(k))return;
        if(Array.isArray(picks[k])&&picks[k].length)return;
        r.items.push({kind:'po',id:id,fbKey:id,text:'open cut job'+(phStr(j.plannedCutDate)?' planned '+j.plannedCutDate:'')+' · no fabric issue'});
      });
    }else if(c.id==='released_unreadable'){
      let text=0,num=0;
      I.pos.forEach(function(po){
        if(!_phhObj(po)||po.releasedAt==null||po.releasedAt==='')return;
        if(typeof po.releasedAt==='number')num++;else if(typeof po.releasedAt==='string')text++;
        if(phMs(po.releasedAt)===null){const e={po:po,id:_phhPoId(po),stage:phStageOf(po)||'unknown'};r.items.push(poRow(e,'releasedAt is '+(typeof po.releasedAt)+' '+JSON.stringify(po.releasedAt).slice(0,40)));}
      });
      if(text||num)r.note=text+(text===1?' PO stores':' POs store')+' the release as text (the legacy date string), '+num+' as a number (born released); both are read.';
    }else if(c.id==='bundles_no_cut'){
      const by=new Map(),junk=[];
      I.bundles.forEach(function(b){
        if(!_phhObj(b))return;
        const k=phPoKey(b.poId);
        if(k===null){junk.push(b);return;}
        if(cutKeys.has(k))return;
        if(!by.has(k))by.set(k,[]);
        by.get(k).push(b);
      });
      const liveBy=new Map();I.pos.forEach(function(po){if(_phhObj(po)){const k=phPoKey(_phhPoId(po));if(k!==null)liveBy.set(k,po);}});
      Array.from(by.keys()).sort().forEach(function(k){
        const l=by.get(k),ids=l.map(function(b){return phStr(b.bundleId).trim()||phStr(b.fbKey).trim();}).filter(Boolean),units=l.reduce(function(a,b){const n=phWhole(b.units);return a+(n===null?0:n);},0);
        const why=l.length+(l.length===1?' bundle':' bundles')+' ('+units+' pcs'+(ids.length?': '+ids.slice(0,4).join(', ')+(ids.length>4?' …':''):'')+')';
        const po=liveBy.get(k);
        if(po)r.items.push(poRow({po:po,id:_phhPoId(po),stage:phStageOf(po)||'unknown'},why+' but no cut recorded on the PO'));
        else r.items.push({kind:'note',id:k,text:why+' · '+k+' does not exist'});
      });
      if(junk.length)r.note=junk.length+(junk.length===1?' bundle has':' bundles have')+' no PO number at all.';
    }else if(c.id==='qc_cut_drift'){
      const byKey=new Map();live.forEach(function(e){if(e.key)byKey.set(e.key,e);});
      I.recon.forEach(function(rc){
        if(!_phhObj(rc))return;
        const e=byKey.get(phPoKey(phStr(rc.fbKey).trim()||phStr(rc.poId).trim()));
        if(!e)return;
        const x=phQcExpected(e.po,rc);
        if(!x.ok)r.items.push(poRow(e,'the locked cut could not be read ('+x.why+')'));
        else if(x.drift)r.items.push(poRow(e,'locked cut '+x.drift.lockTotal+', the PO now says '+x.drift.liveTotal+' ('+x.drift.sizes.map(function(d){return d.size+' '+d.lock+'→'+d.live;}).join(', ')+')'));
      });
    }else if(c.id==='qc_two_ledgers'){
      const lotsBy=new Map(),rcBy=new Map();
      I.lots.forEach(function(l){if(!_phhObj(l))return;const k=phPoKey(l.poId);if(k===null)return;if(!lotsBy.has(k))lotsBy.set(k,[]);lotsBy.get(k).push(l);});
      I.recon.forEach(function(rc){if(_phhObj(rc)){const k=phPoKey(phStr(rc.fbKey).trim()||phStr(rc.poId).trim());if(k!==null)rcBy.set(k,rc);}});   // the reconciliation lists which old receipts were adopted
      live.forEach(function(e){
        if(!e.key)return;
        const L=_phhLedgers(e.po,lotsBy.get(e.key)||[],rcBy.get(e.key)||null);
        const why=[];
        if(L.legacyUnits>0&&L.lotRows>0)why.push(L.legacyUnits+' units from the old Packing page are not adopted into the QC lots');
        if(L.lotRows>0||Object.keys(L.mirror).length){
          const ks=Object.keys(L.mirror).concat(Object.keys(L.live)).filter(function(k,i,a){return a.indexOf(k)===i;});
          const bad=ks.filter(function(k){return(L.mirror[k]||0)!==(L.live[k]||0);});
          if(bad.length)why.push('the packing counter ('+(_phhSizeText(L.mirror)||'nothing')+') does not equal the live QC lots ('+(_phhSizeText(L.live)||'nothing')+')');
        }
        if(why.length)r.items.push(poRow(e,why.join('; ')));
      });
    }else if(c.id==='qc_closed_short'){
      // a CLOSED reconciliation whose close verdict was not ready (short, or still receiving) = a manager's close with a shortfall
      const byKey=new Map();live.forEach(function(e){if(e.key)byKey.set(e.key,e);});
      I.recon.forEach(function(rc){
        if(!_phhObj(rc)||phStr(rc.status)!=='closed')return;
        const v=_phhObj(rc.closeVerdict)?rc.closeVerdict:null;
        if(!v||(phStr(v.phase)!=='short'&&phStr(v.phase)!=='receiving'))return;
        const e=byKey.get(phPoKey(phStr(rc.fbKey).trim()||phStr(rc.poId).trim()));
        if(!e)return;
        const t=_phhObj(v.total)?v.total:{};
        const ov=(Array.isArray(rc.overrides)?rc.overrides:[]).filter(function(o){return _phhObj(o)&&o.kind==='close_short';}).pop()||null;
        const n=function(x){return typeof x==='number'&&isFinite(x)?x:'?';};
        r.items.push(poRow(e,'closed with a shortfall: '+n(t.recv)+' of '+n(t.cut)+' received ('+(typeof t.diff==='number'?(t.diff>0?'+':'')+t.diff:'?')+')'+(ov&&phStr(ov.cause).trim()?', cause: '+phStr(ov.cause).trim():'')));
      });
    }else if(c.id==='qc_completed_unreconciled'){
      const rcBy=new Map();
      I.recon.forEach(function(rc){if(_phhObj(rc)){const k=phPoKey(phStr(rc.fbKey).trim()||phStr(rc.poId).trim());if(k!==null)rcBy.set(k,rc);}});
      live.forEach(function(e){
        if(e.stage!=='completed'||!e.key)return;
        const rc=rcBy.get(e.key);
        if(rc){if(phStr(rc.status)!=='closed')r.items.push(poRow(e,'completed, but its QC reconciliation is '+(phStr(rc.status)||'in an unknown state')+', not closed'));return;}
        const f=_phhQcFinish(e.po);
        if(f.day===null){M.qc.undated++;return;}
        if(f.day<M.qc.liveDay){M.qc.beforeQcOps++;return;}
        r.items.push(poRow(e,'completed in the classic flow on '+f.day+' ('+f.basis+'), never reconciled'));
      });
      const parts=[];
      if(M.qc.beforeQcOps)parts.push(M.qc.beforeQcOps+(M.qc.beforeQcOps===1?' PO':' POs')+' finished before QC Ops ('+(M.qc.liveSource==='recon'?'first reconciliation ':'assumed go-live ')+M.qc.liveDay+') not counted');
      if(M.qc.undated)parts.push(M.qc.undated+(M.qc.undated===1?' completed PO':' completed POs')+' with no completion or cut date not counted');
      r.note=parts.join('; ');
    }
    r.count=r.items.length;
    M.total+=r.count;
  });
  M.byId=res;
  return M;
}
// Candidate passes for one PO: fabric passes that point at no real PO, best first.
// po: the PO document; allPos/passes: the loaded lists. -> [{id, gp, score, why[], ms}] (max PHH_CAND_MAX)
function phhCandidates(po,allPos,passes,opts){
  const o=_phhObj(opts)?opts:{},max=o.max||PHH_CAND_MAX;
  if(!_phhObj(po)||!Array.isArray(passes)||!Array.isArray(allPos))return[];
  const keys=new Set();
  allPos.forEach(function(p){const k=phPoKey(_phhPoId(p));if(k!==null)keys.add(k);});
  const rel=phMs(po.releasedAt)!==null?phMs(po.releasedAt):(phMs(po.ts));
  const names=[po.fabric,po.fabricCode].concat(Array.isArray(po.fabrics)?po.fabrics.map(function(f){return _phhObj(f)?f.fabType:'';}):[]).concat(Array.isArray(po.fabrics)?po.fabrics.map(function(f){return _phhObj(f)?f.color:'';}):[])
    .map(function(x){return phStr(x).toLowerCase();}).join(' ');
  const words=names.split(/[^a-z0-9]+/).filter(function(w){return w.length>=3;});
  const out=[];
  passes.forEach(function(g){
    if(!_phhIsFabric(g))return;
    const k=phPoKey(_phhPassPoRaw(g));
    if(k!==null&&keys.has(k))return;                       // it belongs to a real PO
    const ms=_phhPassMs(g);
    let score=0;const why=[];
    if(rel!==null&&ms!==null){
      const days=Math.abs(ms-rel)/86400000;
      if(days<=3){score+=3;why.push('issued within 3 days of the PO');}
      else if(days<=10){score+=2;why.push('issued within 10 days of the PO');}
      else if(days<=30){score+=1;why.push('issued within 30 days of the PO');}
    }
    const hay=(phStr(g.fabricType)+' '+phStr(g.article)+' '+phStr(g.fabricColor)+' '+phStr(g.spec)).toLowerCase();
    const hit=words.filter(function(w){return hay.indexOf(w)>-1;});
    if(hit.length){score+=Math.min(3,hit.length);why.push('fabric matches: '+hit.slice(0,3).join(', '));}
    const ac=phStr(po.code).trim().toUpperCase();
    if(ac&&phStr(g.articleCode).trim().toUpperCase()===ac){score+=3;why.push('same article code '+ac);}
    out.push({id:_phhPassId(g),gp:g,score:score,why:why,ms:ms,date:phStr(g.date),sort:ms===null?0:ms});
  });
  out.sort(function(a,b){return(b.score-a.score)||(b.sort-a.sort);});
  return out.slice(0,max);
}

/* ═══ THE SOURCES (read-only, cached, never rejects) ════════════════════ */
function _phhFresh(){return{state:'idle',rows:null,text:'',truncated:false,from:null,at:null};}
let _phhSrc={pos:_phhFresh(),gatepasses:_phhFresh()};
let _phhP=null;
let _phhPicks={};          // poKey -> [passId]  (this session only; see the header)
let _phhVer=0;
function _phhApp(col){
  try{
    if(col==='pos'&&typeof allPOs!=='undefined'&&Array.isArray(allPOs)&&allPOs.length)return allPOs;
    if(col==='gatepasses'&&typeof allPasses!=='undefined'&&Array.isArray(allPasses)&&allPasses.length)return allPasses;
  }catch(e){}
  return null;
}
function _phhTimeout(p,ms){
  let t;
  const to=new Promise(function(_,rej){t=setTimeout(function(){const e=new Error('read timed out');e.code='timeout';rej(e);},ms);});
  return Promise.race([p,to]).then(function(v){clearTimeout(t);return v;},function(e){clearTimeout(t);throw e;});
}
function _phhErrText(col,e){
  const i=typeof phErrInfo==='function'?phErrInfo(e):{code:'',message:String(e&&e.message||e),permission:false,quota:false};
  if(i.permission)return col+': could not be read (permission denied) - check the published firestore.rules, then retry.';
  if(i.quota)return col+': the Firestore read quota is used up - retry later.';
  if(i.code==='from-cache')return col+': only this device\'s offline copy was available, so it was not read - get a connection and retry.';
  if(i.code==='timeout')return col+': the read did not finish in '+Math.round(PHH_READ_TIMEOUT_MS/1000)+'s - retry.';
  return col+': read failed ('+(i.message||i.code||'unknown')+').';
}
async function _phhReadOwn(col){
  try{
    if(typeof getDocs!=='function'||typeof query!=='function'||typeof collection!=='function'||typeof db==='undefined')throw new Error('Firestore is not available');
    const lim=PHH_LIMITS[col];
    const snap=await _phhTimeout(getDocs(query(collection(db,col),orderBy('ts','desc'),limit(lim))),PHH_READ_TIMEOUT_MS);
    if(snap&&snap.metadata&&snap.metadata.fromCache===true){const e=new Error('answered from the offline copy');e.code='from-cache';throw e;}
    const rows=((snap&&snap.docs)||[]).map(function(d){return Object.assign({},d.data(),{fbKey:d.id});});
    return{state:'ok',rows:rows,text:'',truncated:rows.length>=lim,from:'own',at:Date.now()};
  }catch(e){return{state:'error',rows:null,text:_phhErrText(col,e),truncated:false,from:'own',at:Date.now()};}
}
// QC stages (po_qc_recon, po_qc_lots): LAZY and opt-in -- only phhEnsure(force,{qc:true}) reads them (ph-data's own bounded,
// never-rejecting stage loader, which counts an offline-copy answer as a failure). An errored stage is read again only on force.
const PHH_QC_STAGES=Object.freeze(['recon','lots']);
let _phhQcWanted=false;      // a manager's screen asked for the QC stages
let _phhQcTried=false;       // the read was started once (the repaint -> kick -> repaint loop must not spin if it never settles)
let _phhQcState='idle';      // idle | loading | done
function _phhQcPending(){return _phhQcWanted&&(_phhQcState!=='done'||!!(_phhBun&&_phhBun.state==='loading'));}
function _phhEnsureQc(force){
  if(typeof phLoadStage!=='function'){_phhQcState='done';return null;}
  const todo=PHH_QC_STAGES.filter(function(s){const st=typeof phLoadState==='function'?phLoadState(s):null;return force||!st||st.state==='idle';});
  if(!todo.length){_phhQcState='done';return null;}
  _phhQcState='loading';
  const fin=function(){_phhQcState='done';_phhVer++;return true;};
  return Promise.all(todo.map(function(s){return phLoadStage(s,{force:!!force});})).then(fin,fin);
}
// Fill pos and gatepasses once (force: read both again from the server). Resolves when settled; NEVER rejects.
// opts.qc:true also reads the two QC stages (managers' Data health only).
function phhEnsure(force,opts){
  const wantQc=!!(opts&&opts.qc);
  if(wantQc){_phhQcWanted=true;_phhQcTried=true;}
  const base=_phhEnsureBase(force);
  const qc=wantQc?_phhEnsureQc(force):null;
  const bun=wantQc?_phhEnsureBundles(force):null;
  const more=[qc,bun].filter(Boolean);
  return more.length?Promise.all([base].concat(more)).then(function(){return true;}):base;
}
// bundles (RG2, managers only): one bounded read with NO orderBy (an orderBy would leave out a bundle with no ts). Never rejects.
let _phhBun=null,_phhBunP=null;
function _phhEnsureBundles(force){
  if(_phhBunP&&!force)return _phhBunP;
  if(_phhBun&&!force)return null;
  _phhBun={state:'loading',rows:null,text:'',truncated:false,from:'own',at:null};
  const p=(async function(){
    try{
      if(typeof getDocs!=='function'||typeof query!=='function'||typeof collection!=='function'||typeof db==='undefined')throw new Error('Firestore is not available');
      const lim=PHH_LIMITS.bundles;
      const snap=await _phhTimeout(getDocs(query(collection(db,'bundles'),limit(lim))),PHH_READ_TIMEOUT_MS);
      if(snap&&snap.metadata&&snap.metadata.fromCache===true){const e=new Error('answered from the offline copy');e.code='from-cache';throw e;}
      const rows=((snap&&snap.docs)||[]).map(function(d){return Object.assign({},d.data(),{fbKey:d.id});});
      _phhBun={state:'ok',rows:rows,text:'',truncated:rows.length>=lim,from:'own',at:Date.now()};
    }catch(e){_phhBun={state:'error',rows:null,text:_phhErrText('bundles',e),truncated:false,from:'own',at:Date.now()};}
    _phhBunP=null;_phhVer++;return true;
  })();
  _phhBunP=p;
  return p;
}
function _phhEnsureBase(force){
  if(_phhP&&!force)return _phhP;
  const todo=['pos','gatepasses'].filter(function(n){return force||_phhSrc[n].state==='idle';});
  if(!todo.length)return Promise.resolve(true);
  const own=[];
  todo.forEach(function(n){
    const app=force?null:_phhApp(n);
    if(app){_phhSrc[n]={state:'ok',rows:app.slice(),text:'',truncated:false,from:'app',at:Date.now()};_phhVer++;}
    else{_phhSrc[n]=Object.assign(_phhFresh(),{state:'loading'});own.push(n);}
  });
  if(!own.length)return Promise.resolve(true);
  const p=Promise.all(own.map(async function(n){_phhSrc[n]=await _phhReadOwn(n);})).catch(function(e){
    own.forEach(function(n){if(_phhSrc[n].state==='loading')_phhSrc[n]={state:'error',rows:null,text:_phhErrText(n,e),truncated:false,from:'own',at:Date.now()};});
  }).then(function(){_phhP=null;_phhVer++;return true;});
  _phhP=p;
  return p;
}
function phhSources(){return _phhSrc;}
function phhReset(){_phhSrc={pos:_phhFresh(),gatepasses:_phhFresh()};_phhP=null;_phhQcWanted=false;_phhQcTried=false;_phhQcState='idle';_phhBun=null;_phhBunP=null;_phhVer++;}
function phhRows(col){const s=_phhSrc[col];return s&&s.state==='ok'?s.rows:null;}
// The fabric passes of one PO from what is loaded (every spelling of the number), or null when gatepasses did not load.
function phhPassesOf(poId){
  const rows=phhRows('gatepasses'),k=phPoKey(poId);
  if(!rows||k===null)return rows?[]:null;
  return rows.filter(function(g){return _phhIsFabric(g)&&phPoKey(_phhPassPoRaw(g))===k;});
}
// session picks (find-the-issue)
function phhPick(poId,passId){
  const k=phPoKey(poId);
  if(k===null||!passId)return false;
  const l=_phhPicks[k]||(_phhPicks[k]=[]);
  if(l.indexOf(String(passId))<0)l.push(String(passId));
  _phhVer++;
  return true;
}
function phhUnpick(poId,passId){
  const k=phPoKey(poId);
  if(k===null||!_phhPicks[k])return false;
  _phhPicks[k]=_phhPicks[k].filter(function(x){return x!==String(passId);});
  if(!_phhPicks[k].length)delete _phhPicks[k];
  _phhVer++;
  return true;
}
function phhPicked(poId){const k=phPoKey(poId);return k!==null&&_phhPicks[k]?_phhPicks[k].slice():[];}
function phhPicksAll(){return _phhPicks;}
// Candidates for a PO from what is loaded; {state:'loading'|'error'|'ok', rows, text}
function phhCandidatesFor(po){
  const S=_phhSrc;
  if(S.pos.state==='idle'||S.gatepasses.state==='idle'||S.pos.state==='loading'||S.gatepasses.state==='loading')return{state:'loading',rows:null,text:''};
  const bad=['pos','gatepasses'].filter(function(n){return S[n].state!=='ok';});
  if(bad.length)return{state:'error',rows:null,text:bad.map(function(n){return S[n].text||(n+': not loaded');}).join(' ')};
  return{state:'ok',rows:phhCandidates(po,S.pos.rows,S.gatepasses.rows),text:''};
}
// poKey -> ms of each PO's first fabric issue from the loaded gate passes, or null when they did not load.
function phhFirstIssueNow(){const r=phhRows('gatepasses');return r?phhFirstIssueMap(r):null;}
function phhModel(ctx){
  const gj=ctx&&ctx.get?ctx.get('jobs'):null;
  const qc=!(ctx&&ctx.canManage===false)&&typeof phGet==='function';      // only a manager is shown the QC checks
  const rc=qc?phGet('recon'):null,lo=qc?phGet('lots'):null;
  return phhBuildModel({pos:phhRows('pos'),passes:phhRows('gatepasses'),jobs:gj&&gj.ok?gj.rows:null,picks:_phhPicks,
    bundles:qc&&_phhBun&&_phhBun.state==='ok'?_phhBun.rows:null,bundlesTruncated:!!(qc&&_phhBun&&_phhBun.truncated),
    qc:qc,recon:rc&&rc.ok?rc.rows:null,lots:lo&&lo.ok?lo.rows:null,reconTruncated:!!(rc&&rc.ok&&rc.truncated),lotsTruncated:!!(lo&&lo.ok&&lo.truncated)});
}

/* ═══ DOM ═══════════════════════════════════════════════════════════════ */
let _phhOpen={};            // check id -> expanded
let _phhAll={};             // check id -> show all rows
function _phhBtn(cls,text,fn,attrs){
  const b=phEl('button',cls,text);b.setAttribute('type','button');
  if(attrs)Object.keys(attrs).forEach(function(k){b.setAttribute(k,attrs[k]);});
  if(fn)b.addEventListener('click',fn);
  return b;
}
function phhOpenPass(id){
  if(typeof window==='undefined')return false;
  try{if(typeof _phTkLeave==='function')_phTkLeave();}catch(e){}
  try{if(typeof window.showPage==='function')window.showPage('gatepass');}catch(e){return false;}
  try{if(typeof window.switchGPTab==='function')window.switchGPTab('registry');}catch(e){}
  try{if(typeof showToast==='function')showToast('Gate pass '+id+': find it in the registry.');}catch(e){}
  return true;
}
function _phhOpenPo(fbKey){
  if(typeof phqOpenPO==='function')return phqOpenPO(fbKey);
  if(typeof window!=='undefined'&&typeof window.openPODetail==='function'){try{if(typeof _phTkLeave==='function')_phTkLeave();}catch(e){}window.openPODetail(fbKey);return true;}
  return false;
}
function _phhItemEl(it){
  const li=phEl('li','phh-item');
  li.appendChild(phEl('span','phh-item-id',it.id));
  li.appendChild(phEl('span','phh-item-txt',it.text));
  if(it.kind==='po'&&typeof window!=='undefined'&&typeof window.openPODetail==='function'){
    li.appendChild(_phhBtn('ph-btn phh-open','Open PO',function(){_phhOpenPo(it.fbKey||it.id);},{'aria-label':'Open '+it.id}));
  }else if(it.kind==='pass'&&typeof window!=='undefined'&&typeof window.showPage==='function'){
    li.appendChild(_phhBtn('ph-btn phh-open','Open registry',function(){phhOpenPass(it.id);},{'aria-label':'Open the gate pass registry for '+it.id}));
  }
  return li;
}
function _phhCheckEl(c,ctx){
  const li=phEl('li','phh-check phh-'+(c.state==='unavailable'?'na':c.count>0?'warn':'ok'));
  li.setAttribute('data-check',c.id);
  const open=!!_phhOpen[c.id]&&c.state==='ok'&&c.count>0;
  const head=_phhBtn('phh-head',null,function(){if(c.state!=='ok'||!c.count)return;_phhOpen[c.id]=!_phhOpen[c.id];ctx.repaint();},{'aria-expanded':open?'true':'false'});
  if(c.state!=='ok'||!c.count)head.setAttribute('aria-disabled','true');
  head.appendChild(phEl('span','phh-count',c.state==='ok'?String(c.count):'—'));
  head.appendChild(phEl('span','phh-label',c.label));
  head.appendChild(phEl('span','phh-state',c.state==='unavailable'?'unavailable - '+c.unavailable.join(', '):(c.count?(open?'Hide ▾':'Show ▸'):'none ✓')));
  li.appendChild(head);
  li.appendChild(phEl('p','phh-hint',c.hint));
  if(c.note&&c.state==='ok')li.appendChild(phEl('p','phh-note',c.note));
  if(open){
    const ul=phEl('ul','phh-list');
    const shown=_phhAll[c.id]?c.items:c.items.slice(0,PHH_LIST_SHOW);
    shown.forEach(function(it){ul.appendChild(_phhItemEl(it));});
    li.appendChild(ul);
    if(c.items.length>shown.length)li.appendChild(_phhBtn('ph-btn phh-more','Show all '+c.items.length,function(){_phhAll[c.id]=true;ctx.repaint();}));
  }
  return li;
}
function _phhSourceNotes(){
  const kids=[];
  ['pos','gatepasses'].forEach(function(n){
    const s=_phhSrc[n];
    if(s.state==='error'){const p=phEl('p','phh-err',s.text);p.setAttribute('role','alert');kids.push(p);}
    else if(s.truncated)kids.push(phEl('p','phh-note',n+': the list was cut at '+PHH_LIMITS[n]+' newest records - older ones are not checked.'));
  });
  return kids;
}
// QC stage notes (managers only): a failed read is named; a list cut at its limit is said (the checks that need it are unavailable).
function _phhQcNotes(ctx){
  const kids=[];
  if(!_phhIsManager(ctx)||typeof phGet!=='function')return kids;
  PHH_QC_STAGES.forEach(function(s){
    const g=phGet(s);
    if(!g.ok&&g.state==='error'){const p=phEl('p','phh-err',g.text||(s+': not loaded'));p.setAttribute('role','alert');kids.push(p);}
    else if(g.ok&&g.truncated)kids.push(phEl('p','phh-note',(s==='recon'?'po_qc_recon':'po_qc_lots')+': the list was cut at its limit, so the QC checks that need it cannot run.'));
  });
  if(_phhBun&&_phhBun.state==='error'){const p=phEl('p','phh-err',_phhBun.text);p.setAttribute('role','alert');kids.push(p);}
  else if(_phhBun&&_phhBun.truncated)kids.push(phEl('p','phh-note','bundles: the list was cut at '+PHH_LIMITS.bundles+' records, so the bundle check cannot run.'));
  return kids;
}
function _phhIsManager(ctx){return!!(ctx&&ctx.canManage===true);}
function _phhLoading(){return _phhSrc.pos.state==='idle'||_phhSrc.pos.state==='loading'||_phhSrc.gatepasses.state==='idle'||_phhSrc.gatepasses.state==='loading'||_phhQcPending();}
function _phhKick(ctx){
  const qc=_phhIsManager(ctx);
  const qcIdle=qc&&!_phhQcTried;
  if(_phhSrc.pos.state==='idle'||_phhSrc.gatepasses.state==='idle'||qcIdle){
    phhEnsure(false,{qc:qc}).then(function(){try{if(ctx&&ctx.repaint&&(typeof _phUiTab==='undefined'||!ctx.tab||_phUiTab===ctx.tab.id))ctx.repaint();}catch(e){}});
  }
}
// The Monitor tab's section.
function phhSection(ctx){
  const E=phEl,sec=E('section','ph-card phh-sec');
  sec.setAttribute('data-health','1');
  sec.appendChild(E('h3','ph-card-title','Data health'));
  sec.appendChild(E('p','ph-note','Checks over the purchase orders, fabric issues, cut jobs and bundles, and over QC receiving. Each count opens the list behind it. Nothing here is changed or written.'));
  _phhKick(ctx);
  if(_phhLoading()){sec.appendChild(E('p','phh-note','Reading purchase orders and fabric issues…'));return sec;}
  _phhSourceNotes().forEach(function(n){sec.appendChild(n);});
  _phhQcNotes(ctx).forEach(function(n){sec.appendChild(n);});
  const M=phhModel(ctx);
  const ul=E('ul','phh-checks');
  M.checks.forEach(function(c){ul.appendChild(_phhCheckEl(c,ctx));});
  sec.appendChild(ul);
  const foot=E('div','phh-foot');
  foot.appendChild(_phhBtn('ph-btn phh-reload','Read again',function(){phhEnsure(true,{qc:_phhIsManager(ctx)}).then(function(){try{ctx.repaint();}catch(e){}});ctx.repaint();}));
  sec.appendChild(foot);
  return sec;
}
// The Overview tile: one number and a way in.
function phhOverviewCard(ctx){
  const E=phEl,card=E('section','ph-card phh-tile');
  card.setAttribute('data-tile','health');
  card.appendChild(E('h3','ph-card-title','Data health'));
  _phhKick(ctx);
  if(_phhLoading()){card.appendChild(E('p','phh-note','Reading purchase orders and fabric issues…'));return card;}
  const bad=['pos','gatepasses'].filter(function(n){return _phhSrc[n].state!=='ok';});
  if(bad.length){
    const p=E('p','phh-err','unavailable - '+bad.join(', '));p.setAttribute('role','alert');card.appendChild(p);
    return card;
  }
  const M=phhModel(ctx);
  const withCount=M.checks.filter(function(c){return c.state==='ok'&&c.count>0;});
  card.appendChild(E('div','phh-big',String(M.total)));
  card.appendChild(E('p','phh-note',M.total?M.total+' records need a look across '+withCount.length+(withCount.length===1?' check':' checks')+(M.anyUnavailable?' (some checks could not run)':'')+'.':'No problems found by the checks that could run'+(M.anyUnavailable?' (some could not run)':'')+'.'));
  const ul=E('ul','phh-mini');
  withCount.slice(0,4).forEach(function(c){ul.appendChild(E('li','phh-mini-i',c.count+' · '+c.label));});
  card.appendChild(ul);
  if(ctx.canManage&&typeof phGoTab==='function')card.appendChild(_phhBtn('ph-btn phh-go','Open the checks',function(){phGoTab('monitor');}));
  return card;
}

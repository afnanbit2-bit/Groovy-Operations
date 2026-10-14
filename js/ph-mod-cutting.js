/* ─────────────────────────────────────────────────────────────────────────
   js/ph-mod-cutting.js — Production Ops ▸ TODAY'S CUTTING (12 Oct 2026)

   Kashif's phone-first working view (login `uzaib`, role viewer). Registered into the
   shell's tab registry with phRegisterTab('cutting', ...); it replaces ONLY that tab's
   render and touches nothing else of js/ph-ui.js.

   What it shows: the cut jobs (po_cut_jobs, read by the shell's phLoadAll) planned for
   TODAY (a PKT day, never UTC), and the still-open ones from earlier days in a separate
   OVERDUE list. Each job is a large card: PO number, article, quantity and sizes, the
   assigned master, the planned fabric, and the fabric that was actually ISSUED to the PO.

   THE ROLL CHECKLIST. The issue is read from `gatepasses` (gpType 'fabric', poId == the job;
   the fabric issue IS a gate pass: rollCodes[], fabrics[] each with its own rollCodes, weight
   and unit, plus rib rolls). Two ways to verify:
     · SCAN: a text field a barcode scanner types into (code + Enter). A code that is on the
       issue is ticked present; one that is not is noted as EXTRA; the same code twice is
       noted, not counted twice. A roll can also be ticked/unticked by tap. No camera API.
     · COUNT: the number of rolls counted (and optionally their weight).
   An optional weighed total is compared with the issued weight, tolerance PHK_WEIGHT_TOL_PCT
   percent of the issued weight or PHK_WEIGHT_TOL_ABS units, whichever is larger (a DEFAULT --
   the owner has not set one; change the two constants, nothing else).
   The result is {total, verified, short, missing, extra} (ph-write.js's checklist shape; all whole
   numbers; `short` is 1 when the weight is outside the tolerance, else 0). A MISMATCH IS FLAGGED
   AND SAVED, NEVER BLOCKED. The which-codes detail is stored TWICE since 14 Oct 2026: as `missingCodes` and
   `extraCodes` (lists of roll codes, each at most 40 characters, at most 200 of each) inside the
   job's rollsChecklist map (the full list, shown on the card), and as the history row's `reason`
   (truncated at 480). Both are written in the same transaction (ph-write.js phSaveCutJob writes the
   job and its pos/{id}/history row together). If a list is longer than 200 the counts still say
   how many, and the screen says how many codes are not listed.

   MARK COMPLETE (a floor action): status 'complete' through phSaveCutJob. It does NOT do the
   real cutting-done (js/pos.js markCuttingDone: bundles, actual cut by size, the 70-130% gate).
   RECORD THE CUT is for managers only and opens the EXISTING cutting screen
   (window.openStageWork(poId,'cutting')); this file never writes pos.

   WRITES: only phSaveCutJob (-> po_cut_jobs/{PO} + pos/{PO}/history/{row}, one transaction).
   READS beyond the shell's: pos/{PO} (getDoc) and gatepasses where poId == PO (getDocs, limited),
   per job shown, lazily; a failed or offline-copy read is said by name and never drawn as
   "no rolls". Stored text only ever reaches textContent. Globals are phk / _phk / PHK_ prefixed.
   ───────────────────────────────────────────────────────────────────────── */

/* ── Constants (one block; a rule that changes changes here) ───────────── */
const PHK_WEIGHT_TOL_PCT=2;        // DEFAULT: a weighed total may differ from the issued weight by this % ...
const PHK_WEIGHT_TOL_ABS=0.5;      // ... or by this many units (kg or m), whichever is larger. Unconfirmed by the owner.
const PHK_OVERDUE_SHOW=10;         // overdue rows listed before "show all"
const PHK_PASS_LIMIT=50;           // fabric passes read per PO
const PHK_CODES_MAX=200,PHK_CODE_LEN=40;   // ph-write.js refuses a longer list / code; the screen clips first and says so
const PHK_CODES_SHOWN=40;          // saved codes printed on a card before "+N more"
const PHK_REASON_MAX=480;          // history `reason` is cut at 500 by ph-write.js
const PHK_SIZE_ORDER=Object.freeze(['XXXS','XXS','XS','S','M','L','XL','2XL','FREE']);

/* ── State (module level; survives a repaint of the tab) ──────────────── */
let _phkPO={};            // poId -> {po:{state,data,text}, issue:{state,passes,text}}   state: loading | ok | missing | error
let _phkInflight={};      // poId -> Promise
let _phkWork={};          // poId -> the checklist work in progress (never saved until Save / Mark complete)
let _phkOpen={};          // overdue poId -> expanded
let _phkOverdueAll=false;
let _phkCtx=null;         // the ctx of the last render
let _phkCards={};         // poId -> {host}

/* ═══ PURE: days, jobs, sizes ═══════════════════════════════════════════ */
function phkNormCode(c){return String(c==null?'':c).trim().toUpperCase();}
function phkToday(now){return phDay(typeof now==='number'?now:Date.now());}
// rows: the cut-job documents. Today's = planned for today (any status, so a finished job stays visible);
// overdue = still OPEN and planned before today. An open job with no planned day is counted, never hidden.
function phkSplitJobs(rows,today){
  const out={today:[],overdue:[],undated:0};
  (Array.isArray(rows)?rows:[]).forEach(function(r){
    if(!r||typeof r!=='object')return;
    const pd=phIsDay(r.plannedCutDate)?r.plannedCutDate:null;
    if(pd===null){if(r.status==='open')out.undated++;return;}
    if(pd===today)out.today.push(r);
    else if(pd<today&&r.status==='open')out.overdue.push(r);
  });
  const k=function(a,b){return a.fbKey<b.fbKey?-1:a.fbKey>b.fbKey?1:0;};
  out.today.sort(k);
  out.overdue.sort(function(a,b){return a.plannedCutDate<b.plannedCutDate?-1:a.plannedCutDate>b.plannedCutDate?1:k(a,b);});
  return out;
}
function phkSizesOf(po){
  const s=po&&po.sizes&&typeof po.sizes==='object'&&!Array.isArray(po.sizes)?po.sizes:{};
  const keys=Object.keys(s).filter(function(z){const n=phWhole(s[z]);return n!==null&&n>0;});
  keys.sort(function(a,b){
    const x=PHK_SIZE_ORDER.indexOf(String(a).toUpperCase()),y=PHK_SIZE_ORDER.indexOf(String(b).toUpperCase());
    if(x>-1&&y>-1)return x-y;
    if(x>-1)return-1;if(y>-1)return 1;
    const na=phNum(a),nb=phNum(b);
    if(na!==null&&nb!==null)return na-nb;
    return a<b?-1:a>b?1:0;
  });
  return keys.map(function(z){return{size:z,qty:phWhole(s[z])};});
}

/* ═══ PURE: the fabric that was issued ═════════════════════════════════ */
// A fabric ISSUE is a gate pass: gpType 'fabric', no outward reason (an outward / process pass carries gpReason and no `fabrics`).
function phkIsFabricIssue(p){
  if(!p||typeof p!=='object'||p.gpType!=='fabric')return false;
  return(Array.isArray(p.fabrics)&&p.fabrics.length>0)||!p.gpReason;
}
function _phkLabel(type,gsm,color){
  const g=phNum(gsm);
  return[String(type||'').trim(),g!==null&&g>0?g+' gsm':'',String(color||'').trim()].filter(Boolean).join(' ')||'Fabric';
}
// passes -> {rolls:[{code,group}], groups:[{label,unit,weight,rolls,rib}], weight, unit, mixedUnits, passIds}
// weight is the sum of the groups' issued weights, or null when ANY group's weight is unknown; unit is the one unit, or null when
// the groups mix kg and m (kg and m are never added together).
function phkIssueFromPasses(passes){
  const out={rolls:[],groups:[],weight:null,unit:null,mixedUnits:false,passIds:[]};
  const seen={};
  const addGroup=function(g){
    const codes=(Array.isArray(g.codes)?g.codes:[]).map(phkNormCode).filter(Boolean);
    const fresh=codes.filter(function(c){return!seen[c];});
    fresh.forEach(function(c){seen[c]=true;out.rolls.push({code:c,group:out.groups.length});});
    if(!fresh.length)return;
    out.groups.push({label:g.label,unit:g.unit,weight:g.weight,rolls:fresh.length,rib:!!g.rib});
  };
  (Array.isArray(passes)?passes:[]).filter(phkIsFabricIssue).forEach(function(p){
    if(p.id!=null)out.passIds.push(String(p.id));
    const pu=phUnit(p.fabricUnit)||'kg';
    if(Array.isArray(p.fabrics)&&p.fabrics.length){
      p.fabrics.forEach(function(f){
        if(!f||typeof f!=='object')return;
        const w=phNum(f.weight);
        addGroup({codes:f.rollCodes,label:_phkLabel(f.fabType,f.gsm,f.color),unit:phUnit(f.unit)||pu,weight:w!==null&&w>=0?w:null});
      });
    }else{
      const w=phNum(p.fabricQty);
      addGroup({codes:p.rollCodes,label:_phkLabel(p.fabricType,p.fabricGsm,p.fabricColor),unit:pu,weight:w!==null&&w>=0?w:null});
    }
    if(Array.isArray(p.ribRollCodes)&&p.ribRollCodes.length){
      const rw=phNum(p.ribWeight);
      addGroup({codes:p.ribRollCodes,label:(/^\s*rib\b/i.test(String(p.ribType||''))?'':'Rib ')+_phkLabel(p.ribType,p.ribGsm,p.ribColor),unit:'kg',weight:rw!==null&&rw>=0?rw:null,rib:true});
    }
  });
  if(out.groups.length){
    const units=[];out.groups.forEach(function(g){if(units.indexOf(g.unit)<0)units.push(g.unit);});
    out.mixedUnits=units.length>1;
    out.unit=out.mixedUnits?null:units[0];
    if(!out.mixedUnits&&out.groups.every(function(g){return g.weight!==null;})){
      out.weight=phRound(out.groups.reduce(function(s,g){return s+g.weight;},0),2);
    }
  }
  out.byCode={};out.rolls.forEach(function(r){out.byCode[r.code]=r;});
  return out;
}

/* ═══ PURE: the checklist verdict ══════════════════════════════════════ */
// A weighed total against the issued one. {comparable,entered,issued,unit,diff,tol,flag,why}
function phkWeightCheck(entered,issuedWeight,unit,mixed){
  const e=phNum(entered);
  const out={comparable:false,entered:e,issued:issuedWeight,unit:unit,diff:null,tol:null,flag:false,why:''};
  if(e===null)return out;
  if(mixed){out.why=phI18nD('cut.err_units_mixed');return out;}
  if(issuedWeight===null||issuedWeight===undefined||!(issuedWeight>0)){out.why=phI18nD('cut.err_issued_weight');return out;}
  out.comparable=true;
  out.diff=phRound(e-issuedWeight,2);
  out.tol=phRound(Math.max(issuedWeight*PHK_WEIGHT_TOL_PCT/100,PHK_WEIGHT_TOL_ABS),2);
  out.flag=Math.abs(out.diff)>out.tol;
  return out;
}
// w: {mode:'scan'|'tally', present:{code:true}, extras:[codes], tallyRolls, tallyWeight, weighed, dups}
// -> {ok, problems[], counts:{total,verified,short,missing,extra}, mismatch, flags[], missingCodes, extraCodes, dupCodes, weight, active, summary}
// ok=false means "not savable yet" (something to fix first); a mismatch is still ok=true (flagged, never blocked).
function phkEvalChecklist(issue,w){
  const out={ok:false,problems:[],counts:null,mismatch:false,flags:[],flagsD:[],missingCodes:[],extraCodes:[],dupCodes:[],weight:null,active:false,summary:''};
  if(!issue||!Array.isArray(issue.rolls)||!issue.rolls.length){out.problems.push(phI18nD('cut.err_no_rolls'));return out;}
  const W=w&&typeof w==='object'?w:{};
  const mode=W.mode==='tally'?'tally':'scan';
  const total=issue.rolls.length;
  let verified,missing,extra,wEnt;
  if(mode==='tally'){
    const raw=W.tallyRolls==null?'':String(W.tallyRolls).trim();
    out.active=raw!=='';
    const n=raw===''?null:phWhole(raw);
    if(n===null||n<0){out.problems.push(phI18nD('cut.err_enter_count'));return out;}
    verified=Math.min(n,total);missing=Math.max(0,total-n);extra=Math.max(0,n-total);
    wEnt=W.tallyWeight;
  }else{
    const present=W.present||{};
    issue.rolls.forEach(function(r){if(present[r.code]===true)verified=(verified||0)+1;else out.missingCodes.push(r.code);});
    verified=verified||0;missing=out.missingCodes.length;
    out.extraCodes=(Array.isArray(W.extras)?W.extras:[]).slice();extra=out.extraCodes.length;
    out.dupCodes=(Array.isArray(W.dups)?W.dups:[]).slice();
    out.active=verified>0||extra>0;
    wEnt=W.weighed;
  }
  const ws=wEnt==null?'':String(wEnt).trim();
  if(ws!==''){
    const n=phNum(ws);
    if(n===null||n<=0){out.problems.push(phI18nD('cut.err_weight_number'));return out;}
    out.weight=phkWeightCheck(n,issue.weight,issue.unit,issue.mixedUnits);
  }
  const short=out.weight&&out.weight.flag?1:0;
  out.counts={total:total,verified:verified,short:short,missing:missing,extra:extra};
  if(missing>0){out.flags.push(missing+(missing===1?' roll missing':' rolls missing'));out.flagsD.push(phI18nD('cut.n_w',{n:missing,w:phI18nD(missing===1?'cut.roll_missing_one':'cut.roll_missing_many')}));}
  if(extra>0){out.flags.push(extra+(extra===1?' roll not on the issue':' rolls not on the issue'));out.flagsD.push(phI18nD('cut.n_w',{n:extra,w:phI18nD(extra===1?'cut.roll_noton_one':'cut.roll_noton_many')}));}
  if(short){out.flags.push('weight '+Math.abs(out.weight.diff)+' '+out.weight.unit+(out.weight.diff>0?' over':' under')+' the issued '+out.weight.issued+' '+out.weight.unit+' (limit '+out.weight.tol+')');out.flagsD.push(phI18nD(out.weight.diff>0?'cut.flag_weight_over':'cut.flag_weight_under',{d:Math.abs(out.weight.diff),u:out.weight.unit,i:out.weight.issued,t:out.weight.tol}));}
  out.mismatch=out.flags.length>0;
  out.ok=true;
  out.summary=phkSummaryText(out,mode);
  return out;
}
// The rollsChecklist to SAVE: the five counts plus the two code lists, clipped to what the writer accepts
// (code <= PHK_CODE_LEN characters, list <= PHK_CODES_MAX, no empty or repeated code). The counts always carry the truth;
// `left` says how many codes the lists could not hold. Both lists are sent even when empty, so a re-save clears an old one.
function phkChecklistForSave(res){
  const clip=function(l){
    const out=[],seen={};let left=0;
    (Array.isArray(l)?l:[]).forEach(function(c){
      const t=String(c==null?'':c).trim().slice(0,PHK_CODE_LEN);
      if(!t||seen[t])return;
      seen[t]=true;
      if(out.length<PHK_CODES_MAX)out.push(t);else left++;
    });
    return{list:out,left:left};
  };
  const m=clip(res&&res.missingCodes),x=clip(res&&res.extraCodes);
  return{checklist:Object.assign({},res&&res.counts,{missingCodes:m.list,extraCodes:x.list}),left:{missing:m.left,extra:x.left}};
}
// The sentence kept in the history row (and shown to the person): which codes, how much.
function phkSummaryText(res,mode){
  if(!res||!res.counts)return'';
  const c=res.counts;
  let s='Roll check ('+(mode==='tally'?'count':'scan')+'): '+c.verified+' of '+c.total+' verified';
  const bits=[];
  if(res.missingCodes.length)bits.push('MISSING '+res.missingCodes.join(', '));
  else if(c.missing)bits.push('MISSING '+c.missing+(c.missing===1?' roll':' rolls'));
  if(res.extraCodes.length)bits.push('NOT ON THE ISSUE '+res.extraCodes.join(', '));
  else if(c.extra)bits.push('EXTRA '+c.extra+(c.extra===1?' roll':' rolls'));
  if(c.short&&res.weight)bits.push('WEIGHT '+Math.abs(res.weight.diff)+' '+res.weight.unit+(res.weight.diff>0?' over ':' under ')+res.weight.issued+' '+res.weight.unit+' (limit '+res.weight.tol+')');
  else if(res.weight&&!res.weight.comparable)bits.push('weight '+res.weight.entered+' not compared ('+res.weight.why+')');
  if(res.dupCodes.length)bits.push('scanned twice '+res.dupCodes.join(', '));
  if(bits.length)s+='; '+bits.join('; ');
  else s+=' - no mismatch';
  return s.length>PHK_REASON_MAX?s.slice(0,PHK_REASON_MAX-1)+'…':s;
}

/* ═══ PURE: the cut-quantity gate preview (information only) ═══════════ */
// cut: {size: text}. Returns {ordered, total, entered, bad[], verdict, min, max, gate, override, perSize[]}.
// verdict: 'ok' | 'needs_override' | 'invalid' (ph-core phCutCheck) | 'override' when an owner/Mustafa already approved this PO.
function phkCutPreview(po,cut){
  const P=po&&typeof po==='object'?po:{};
  const ordered=phWhole(P.qty);
  const sizes=phkSizesOf(P);
  const C=cut&&typeof cut==='object'?cut:{};
  let total=0,entered=false;const bad=[],perSize=[];
  const keys=sizes.length?sizes.map(function(s){return s.size;}):['TOTAL'];
  keys.forEach(function(z){
    const raw=C[z]==null?'':String(C[z]).trim();
    let n=0;
    if(raw!==''){
      entered=true;
      const v=phWhole(raw);
      if(v===null||v<0)bad.push(z);else n=v;
    }
    total+=n;
    const o=sizes.filter(function(s){return s.size===z;})[0];
    perSize.push({size:z,ordered:o?o.qty:null,cut:raw===''?null:n,diff:o&&raw!==''?n-o.qty:null});
  });
  // The Settings gate (ph_settings/main.cutGate) when it was read from the server, via js/pos.js's
  // poCutGateNow(); otherwise the fixed 70-130 (PO_CUT_GATE). Never throws.
  let gate;
  try{gate=typeof poCutGateNow==='function'?poCutGateNow():undefined;}catch(e){gate=undefined;}
  if(!gate||typeof gate!=='object')gate=typeof PO_CUT_GATE!=='undefined'&&PO_CUT_GATE&&typeof PO_CUT_GATE==='object'?PO_CUT_GATE:undefined;
  const check=phCutCheck(ordered,total,{gate:gate});
  const override=!!(P.cutOverride&&P.cutOverride.by);
  let verdict=check.verdict;
  if(!entered||bad.length||total<=0)verdict='invalid';
  else if(override)verdict='override';
  return{ordered:ordered,total:total,entered:entered,bad:bad,verdict:verdict,min:check.min,max:check.max,gate:check.gate,override:override,perSize:perSize};
}

/* ═══ the PO and its fabric issue: read-only, per job, never rejects ═══ */
function _phkTimed(p){
  const ms=typeof PH_READ_TIMEOUT_MS==='number'?PH_READ_TIMEOUT_MS:20000;
  return typeof _phWithTimeout==='function'?_phWithTimeout(p,ms):p;
}
function _phkErrText(what,e){
  const i=typeof phErrInfo==='function'?phErrInfo(e):{code:e&&e.code||'',message:String(e&&e.message||e),permission:false,quota:false};
  if(i.permission)return what+': could not be read - you may not have access to it, or the rules need republishing.';
  if(i.quota)return what+': the Firestore read quota is used up - retry later.';
  if(i.code==='from-cache')return what+': only this device\'s offline copy was available, so it was not read - get a connection and retry.';
  if(i.code==='timeout')return what+': the read did not finish in time - check the connection and retry.';
  return what+': read failed ('+(i.message||i.code||'unknown')+').';
}
function _phkCacheErr(){const e=new Error(phI18nD('cut.offline_answer'));e.code='from-cache';return e;}
function _phkFromCache(snap){return typeof _phFromCache==='function'?_phFromCache(snap):!!(snap&&snap.metadata&&snap.metadata.fromCache===true);}
async function _phkReadPo(poId){
  try{
    const snap=await _phkTimed(getDoc(doc(db,'pos',poId)));
    if(_phkFromCache(snap))throw _phkCacheErr();
    if(!snap||typeof snap.exists!=='function'||!snap.exists())return{state:'missing',data:null,text:'PO '+poId+' was not found in the PO list.'};
    return{state:'ok',data:Object.assign({},snap.data()),text:''};
  }catch(e){return{state:'error',data:null,text:_phkErrText('pos/'+poId,e)};}
}
async function _phkReadIssue(poId){
  try{
    // 71 of 208 real passes store the PO as bare digits ('125'), so ask for every spelling (an `in` takes up to 10)
    const spell=typeof phPoSpellings==='function'?phPoSpellings(poId):[];
    const q=spell.length>1?where('poId','in',spell):where('poId','==',poId);
    const snap=await _phkTimed(getDocs(query(collection(db,'gatepasses'),q,limit(PHK_PASS_LIMIT))));
    if(_phkFromCache(snap))throw _phkCacheErr();
    let passes=((snap&&snap.docs)||[]).map(function(d){return Object.assign({},d.data(),{id:d.data().id!=null?d.data().id:d.id});});
    if(spell.length>1&&typeof phPoKey==='function'){const k=phPoKey(poId);passes=passes.filter(function(g){return phPoKey(g.poId)===k;});}
    // passes the person picked in "Find the fabric issue" (kept in memory for the session; see js/ph-mod-health.js)
    let picked=0;
    if(typeof phhPicked==='function'&&typeof phhRows==='function'){
      const want=phhPicked(poId),rows=phhRows('gatepasses')||[];
      want.forEach(function(pid){
        if(passes.some(function(g){return String(g.id)===pid;}))return;
        const hit=rows.filter(function(g){return String(g.id!=null?g.id:g.fbKey)===pid;})[0];
        if(hit){passes.push(Object.assign({},hit,{id:hit.id!=null?hit.id:hit.fbKey,_picked:true}));picked++;}
      });
    }
    return{state:'ok',passes:passes,issue:phkIssueFromPasses(passes),text:'',picked:picked};
  }catch(e){return{state:'error',passes:null,issue:null,text:_phkErrText('gatepasses for '+poId,e)};}
}
// Loads (or re-loads) one PO's details. Resolves when settled; NEVER rejects; repaints that card.
function phkLoadPO(poId,force){
  const id=String(poId);
  if(_phkInflight[id])return _phkInflight[id];
  if(!force&&_phkPO[id]&&_phkPO[id].po.state!=='loading')return Promise.resolve(_phkPO[id]);
  _phkPO[id]={po:{state:'loading'},issue:{state:'loading'}};
  const p=Promise.all([_phkReadPo(id),_phkReadIssue(id)]).catch(function(e){
    return[{state:'error',data:null,text:String(e&&e.message||e)},{state:'error',passes:null,issue:null,text:String(e&&e.message||e)}];
  }).then(function(r){
    delete _phkInflight[id];
    _phkPO[id]={po:r[0],issue:r[1]};
    try{_phkRepaintCard(id);}catch(e){}
    return _phkPO[id];
  });
  _phkInflight[id]=p;
  return p;
}
function _phkIssueOf(poId){
  const e=_phkPO[poId];
  return e&&e.issue&&e.issue.state==='ok'?e.issue.issue:null;
}

/* ═══ the checklist work in progress ═══════════════════════════════════ */
function _phkW(poId){
  if(!_phkWork[poId])_phkWork[poId]={mode:'scan',present:{},extras:[],dups:[],draft:'',tallyRolls:'',tallyWeight:'',weighed:'',dirty:false,msg:null,confirming:false,busy:false,previewOpen:false,cut:{}};
  return _phkWork[poId];
}
function phkWork(poId){return _phkW(String(poId));}
function _phkSay(w,kind,text,extra){w.msg=Object.assign({kind:kind,text:text},extra||{});}
function phkSetMode(poId,mode){
  const w=_phkW(poId);
  if(mode!=='scan'&&mode!=='tally')return false;
  if(w.busy)return false;
  w.mode=mode;w.msg=null;w.confirming=false;
  _phkRepaintCard(poId);
  return true;
}
// A scanned or typed code. Returns {kind: present | dup | extra | extra_dup | empty | unavailable, code}.
function phkScan(poId,raw){
  const id=String(poId),w=_phkW(id),issue=_phkIssueOf(id);
  const code=phkNormCode(raw);
  if(!code)return{kind:'empty'};
  if(!issue){_phkSay(w,'err',phI18nD('cut.err_issue_not_loaded'));return{kind:'unavailable',code:code};}
  if(w.busy)return{kind:'busy',code:code};
  w.confirming=false;
  let r;
  if(issue.byCode[code]){
    if(w.present[code]===true){
      if(w.dups.indexOf(code)<0)w.dups.push(code);
      _phkSay(w,'warn',phI18nD('cut.roll_already',{code:code}));r={kind:'dup',code:code};
    }else{
      w.present[code]=true;w.dirty=true;
      _phkSay(w,'ok',phI18nD('cut.roll_on_issue',{code:code}));r={kind:'present',code:code};
    }
  }else if(w.extras.indexOf(code)>-1){
    _phkSay(w,'warn',phI18nD('cut.roll_already_extra',{code:code}));r={kind:'extra_dup',code:code};
  }else{
    w.extras.push(code);w.dirty=true;
    _phkSay(w,'warn',phI18nD('cut.roll_extra_noted',{code:code}));r={kind:'extra',code:code};
  }
  _phkPaintDyn(id);
  return r;
}
function phkToggleRoll(poId,code){
  const id=String(poId),w=_phkW(id),c=phkNormCode(code);
  if(w.busy)return false;
  const issue=_phkIssueOf(id);
  if(!issue||!issue.byCode[c])return false;
  if(w.present[c]===true)delete w.present[c];else w.present[c]=true;
  w.dirty=true;w.msg=null;w.confirming=false;
  _phkPaintDyn(id);
  return true;
}
function phkRemoveExtra(poId,code){
  const id=String(poId),w=_phkW(id);
  if(w.busy)return false;
  const i=w.extras.indexOf(phkNormCode(code));
  if(i<0)return false;
  w.extras.splice(i,1);w.dirty=true;w.msg=null;
  _phkPaintDyn(id);
  return true;
}
function phkSetTally(poId,field,value){
  const id=String(poId),w=_phkW(id);
  if(field!=='tallyRolls'&&field!=='tallyWeight'&&field!=='weighed')return false;
  w[field]=value==null?'':String(value);w.dirty=true;w.msg=null;w.confirming=false;
  _phkPaintDyn(id);
  return true;
}
function phkEval(poId){return phkEvalChecklist(_phkIssueOf(String(poId)),_phkW(String(poId)));}

/* ═══ the two writes (through ph-write.js phSaveCutJob only) ═══════════ */
function _phkJob(poId){
  const g=typeof phGet==='function'?phGet('jobs'):{ok:false,rows:null};
  if(!g.ok||!Array.isArray(g.rows))return null;
  for(let i=0;i<g.rows.length;i++)if(g.rows[i].fbKey===poId)return g.rows[i];
  return null;
}
async function _phkWrite(poId,input,reason,okText){
  const w=_phkW(poId),job=_phkJob(poId);
  if(w.busy)return{ok:false,code:'busy',error:phI18nD('cut.save_running')};
  if(!job)return{ok:false,code:'missing',error:phI18nD('cut.job_not_loaded')};
  if(typeof phSaveCutJob!=='function')return{ok:false,code:'failed',error:phI18nD('cut.writer_missing')};
  w.busy=true;_phkPaintDyn(poId);
  let r;
  try{
    r=await phSaveCutJob(poId,input,{reason:reason,expectedRev:typeof job.rev==='number'?job.rev:undefined});
  }catch(e){r={ok:false,code:'failed',error:phI18nD('cut.could_not_save_why2',{why:String(e&&e.message||e)})};}
  w.busy=false;w.confirming=false;
  if(r&&r.ok){
    w.dirty=false;
    _phkSay(w,'ok',okText);
  }else{
    _phkSay(w,'err',(r&&r.error)||phI18nD('cut.could_not_save'),{reload:!!(r&&(r.code==='stale')),code:r&&r.code});
  }
  try{_phkRepaintCard(poId);}catch(e){}
  return r;
}
// Save the roll check on the job (and one history row, one transaction). A mismatch is saved, flagged.
function phkSaveChecklist(poId){
  const id=String(poId);
  if(typeof phCanRecordFloor==='function'&&!phCanRecordFloor())return Promise.resolve({ok:false,code:'forbidden',error:phI18nD('cut.no_permission_check')});
  const job=_phkJob(id);
  if(!job||job.status!=='open')return Promise.resolve({ok:false,code:'refused',error:phI18nD('cut.err_only_open_check')});
  const res=phkEval(id);
  if(!res.ok)return Promise.resolve({ok:false,code:'invalid',error:phI18nD('cut.err_check_not_ready',{why:_phkJoinD(res.problems,'cut.join_semi')+'.'})});
  if(!res.active)return Promise.resolve({ok:false,code:'invalid',error:phI18nD('cut.err_scan_first')});
  return _phkWrite(id,{rollsChecklist:phkChecklistForSave(res).checklist},res.summary,res.mismatch?phI18nD('cut.saved_flagged',{what:_phkJoinD(res.flagsD,'cut.join_semi')+'.'}):phI18nD('cut.saved_ok'));
}
// Mark the job complete (a floor action). Saves an unsaved roll check in the SAME call, so it is one transaction.
function phkMarkComplete(poId){
  const id=String(poId),w=_phkW(id);
  if(typeof phCanRecordFloor==='function'&&!phCanRecordFloor())return Promise.resolve({ok:false,code:'forbidden',error:phI18nD('cut.err_no_complete')});
  const job=_phkJob(id);
  if(!job||job.status!=='open')return Promise.resolve({ok:false,code:'refused',error:phI18nD('cut.err_only_open_complete')});
  const input={status:'complete'};
  let reason='Marked complete';
  const res=phkEval(id);
  if(res.ok&&res.active&&w.dirty){
    input.rollsChecklist=phkChecklistForSave(res).checklist;
    reason='Marked complete - '+res.summary;
    if(reason.length>PHK_REASON_MAX)reason=reason.slice(0,PHK_REASON_MAX-1)+'…';
  }else if(!res.ok&&res.problems.length&&w.dirty&&res.active){
    return Promise.resolve({ok:false,code:'invalid',error:phI18nD('cut.err_fix_check',{why:_phkJoinD(res.problems,'cut.join_semi')+'.'})});
  }
  return _phkWrite(id,input,reason,input.rollsChecklist?(res.mismatch?phI18nD('cut.marked_flagged',{what:_phkJoinD(res.flagsD,'cut.join_semi')+'.'}):phI18nD('cut.marked_matched')):phI18nD('cut.marked_plain'));
}
// Managers only: open the EXISTING cutting-done screen (js/pos.js). Nothing is written here.
function phkRecordCut(poId){
  const id=String(poId);
  const say=function(m){try{if(typeof showToast==='function')showToast(m,true);}catch(e){}};
  if(typeof phCanManage!=='function'||!phCanManage()){return{ok:false,code:'forbidden',error:phI18nD('cut.record_managers')};}
  const known=typeof allPOs!=='undefined'&&Array.isArray(allPOs)&&allPOs.some(function(p){return p&&p.fbKey===id;});
  if(typeof window==='undefined'||typeof window.openStageWork!=='function'||!known){
    const m=phI18nD('cut.po_not_loaded_open',{po:id});
    say(m);return{ok:false,code:'unavailable',error:m};
  }
  try{
    window.openStageWork(id,'cutting');
    if(typeof _phTkOnPage==='function')_phTkOnPage();   // currentPage is no longer prod-ops: the shell lets go of the takeover
  }catch(e){
    const m=phI18nD('cut.could_not_open',{why:String(e&&e.message||e)});
    say(m);return{ok:false,code:'failed',error:m};
  }
  return{ok:true};
}

/* ═══ DOM ═══════════════════════════════════════════════════════════════ */
function _phkE(tag,cls,text,kids){return(_phkCtx&&_phkCtx.el?_phkCtx.el:phEl)(tag,cls,text,kids);}
function _phkBtn(cls,text,fn,attrs){
  const b=_phkE('button',cls,text);b.setAttribute('type','button');
  if(attrs)Object.keys(attrs).forEach(function(k){b.setAttribute(k,attrs[k]);});
  if(fn)b.addEventListener('click',fn);
  return b;
}
function _phkClear(n){if(_phkCtx&&_phkCtx.clear)_phkCtx.clear(n);else phClear(n);return n;}
function _phkChip(text,kind){return _phkE('span','ph-chip phk-chip'+(kind?' phk-chip-'+kind:''),text);}
function _phkFact(k,v){return _phkE('div','phk-fact',null,[_phkE('span','phk-k',k),_phkE('span','phk-v',v)]);}
function _phkStatusChip(st){
  if(st==='complete')return _phkChip(phI18nD('cut.chip_complete'),'ok');
  if(st==='done')return _phkChip(phI18nD('cut.chip_recorded'),'ok');
  if(st==='overridden')return _phkChip(phI18nD('cut.chip_override'),'warn');
  return _phkChip(phI18nD('cut.chip_open'),'open');
}
function _phkPlural(n,one,many){return phI18nIsD(one)?phI18nD('cut.n_w',{n:n,w:n===1?one:many}):n+' '+(n===1?one:many);}
// A list of descriptors / strings joined with a separator key, nested so each language joins its own pieces.
function _phkJoinD(list,key){return list.reduce(function(a,b){return a===null?b:phI18nD(key,{a:a,b:b});},null);}
// A read-error / state sentence from a lower layer: its Urdu pair when it is a known shape, else as written.
function _phkTxt(x){return typeof x==='string'?phI18nErr(x):x;}

function _phkCanEdit(job){return!!job&&job.status==='open'&&typeof phCanRecordFloor==='function'&&phCanRecordFloor();}

// "No fabric issue found" is a dead end on its own: list the fabric passes that point at no real PO, best guesses first.
function _phkFindBlock(job,entry){
  const kids=[_phkE('p','phk-muted',phI18nD('cut.no_issue_yet'))];
  const po=entry&&entry.po&&entry.po.state==='ok'?entry.po.data:null;
  if(typeof phhCandidatesFor!=='function'||!po)return _phkE('div','phk-find',null,kids);
  const poId=String(job.fbKey||job.poId||po.id||'');
  const c=phhCandidatesFor(po);
  const box=_phkE('div','phk-find');
  box.appendChild(_phkE('h4','phk-find-h',phI18nD('cut.find_h')));
  if(c.state==='loading'){
    box.appendChild(_phkE('p','phk-muted',phI18nD('cut.reading_issues')));
    if(typeof phhEnsure==='function')phhEnsure(false).then(function(){try{_phkRepaintCard(poId);}catch(e){}});
    return _phkE('div','phk-find-wrap',null,[kids[0],box]);
  }
  if(c.state==='error'){
    box.appendChild(_phkE('p','phk-err',_phkTxt(c.text)));
    box.appendChild(_phkBtn('ph-btn phk-btn',phI18nD('cut.try_again'),function(){phhEnsure(true).then(function(){try{_phkRepaintCard(poId);}catch(e){}});_phkRepaintCard(poId);}));
    return _phkE('div','phk-find-wrap',null,[kids[0],box]);
  }
  if(!c.rows.length){
    box.appendChild(_phkE('p','phk-muted',phI18nD('cut.find_none')));
    return _phkE('div','phk-find-wrap',null,[kids[0],box]);
  }
  box.appendChild(_phkE('p','phk-muted',phI18nD('cut.find_pick')));
  const ul=_phkE('ul','phk-cands');
  c.rows.forEach(function(r){
    const g=r.gp,w=phNum(g.fabricQty!=null?g.fabricQty:g.totalWeight),rolls=Array.isArray(g.rollCodes)?g.rollCodes.length:(phNum(g.rollsCount)!==null?phNum(g.rollsCount):null);
    const line=_phkJoinD([r.date||phI18nD('cut.cand_nodate'),(phStr(g.fabricType||g.article).trim()||phI18nD('cut.cand_nofabric'))+(phStr(g.fabricColor).trim()?' '+g.fabricColor:''),w!==null?w+' '+(phUnit(g.fabricUnit)||'kg'):phI18nD('cut.cand_noweight'),rolls!==null?_phkPlural(rolls,phI18nD('cut.w_roll_one'),phI18nD('cut.w_roll_many')):phI18nD('cut.cand_noroll'),phI18nD('cut.cand_poField',{v:phStr(g.poId).trim()||phI18nD('cut.cand_blank')})],'cut.join_dot');
    const b=_phkBtn('ph-btn phk-btn phk-cand-b',null,function(){if(typeof phhPick==='function'){phhPick(poId,r.id);phkLoadPO(poId,true);}},{'aria-label':phI18nAttr(phI18nD('cut.cand_aria',{id:r.id,po:poId}))});
    b.appendChild(_phkE('span','phk-cand-id',r.id));
    b.appendChild(_phkE('span','phk-cand-t',line));
    if(r.why.length)b.appendChild(_phkE('span','phk-cand-why',r.why.join('; ')));
    ul.appendChild(_phkE('li','phk-cand',null,[b]));
  });
  box.appendChild(ul);
  return _phkE('div','phk-find-wrap',null,[kids[0],box]);
}
function _phkFabricBlock(job,entry){
  const kids=[];
  const pf=job&&job.plannedFabric&&typeof job.plannedFabric==='object'?job.plannedFabric:null;
  if(pf&&phNum(pf.qty)!==null)kids.push(_phkFact(phI18nD('cut.f_planned_fabric'),phNum(pf.qty)+' '+(phUnit(pf.unit)||'')+(pf.note?' · '+pf.note:'')));
  else kids.push(_phkFact(phI18nD('cut.f_planned_fabric'),phI18nD('cut.not_recorded_on_job')));
  if(!entry||entry.issue.state==='loading')kids.push(_phkE('p','phk-muted',phI18nD('cut.reading_issue')));
  else if(entry.issue.state==='error')kids.push(_phkE('p','phk-err',_phkTxt(entry.issue.text)));
  else{
    const is=entry.issue.issue;
    if(!is.groups.length)kids.push(_phkFindBlock(job,entry));
    else{
      const ul=_phkE('ul','phk-groups');
      is.groups.forEach(function(g){
        ul.appendChild(_phkE('li','phk-group',null,[_phkE('span','phk-group-n',g.label),_phkE('span','phk-group-d',g.weight!==null?phI18nD('cut.group_line_wt',{rolls:_phkPlural(g.rolls,phI18nD('cut.w_roll_one'),phI18nD('cut.w_roll_many')),w:g.weight,u:g.unit}):phI18nD('cut.group_line',{rolls:_phkPlural(g.rolls,phI18nD('cut.w_roll_one'),phI18nD('cut.w_roll_many')),wt:phI18nD('cut.weight_not_recorded')}))]));
      });
      // the reference table is collapsed: the person came to scan and mark complete, not to read it
      const det=_phkE('details','phk-ref');
      det.appendChild(_phkE('summary','phk-ref-sum',phI18nD('cut.issued_summary',{rolls:_phkPlural(is.rolls.length,phI18nD('cut.w_roll_one'),phI18nD('cut.w_roll_many')),wt:is.weight!==null?' · '+is.weight+' '+is.unit:'',mixed:is.mixedUnits?phI18nD('cut.units_differ'):''})));
      det.appendChild(ul);
      kids.push(det);
      if(entry.issue.picked)kids.push(_phkE('p','phk-muted',phI18nD('cut.includes_picked',{n:_phkPlural(entry.issue.picked,phI18nD('cut.w_fi_one'),phI18nD('cut.w_fi_many'))})));
    }
  }
  return _phkE('div','phk-block',null,kids);
}

/* ── WP3c: the read-only instruction card (the product instructions the PO was issued with) ───────────────────
   Read from the PO's own snapshot (po.instructions: pos documents are readable by every signed-in user), never from
   the product-instructions collection. No edit control exists here for anybody; managers change instructions in their own tab.
   Three honest states: a snapshot (shown), none saved (said so), the PO could not be read (said, by name). */
function _phkSwatchHex(p){
  let hex='';
  try{if(typeof phPantoneHex==='function'){const libs=typeof _phiLibs==='function'?_phiLibs():undefined;hex=phPantoneHex(p.code,p.system,libs)||'';}}catch(e){}
  if(!hex&&typeof phHexOk==='function'&&phHexOk(String(p.hex||'')))hex=String(p.hex).trim();
  return hex&&typeof phHexOk==='function'&&phHexOk(hex)?hex:'';
}
function _phkInstrRow(parts,ur,lead){
  const li=_phkE('li','phk-ins-row');
  if(lead)li.appendChild(lead);
  const t=parts.filter(Boolean).join(' · ');
  if(t)li.appendChild(_phkE('span','phk-ins-t',t));
  if(ur){const u=_phkE('span','phk-ins-ur',ur);u.setAttribute('lang','ur');u.setAttribute('dir','rtl');li.appendChild(u);}
  return li;
}
function _phkInstrSection(titleKey,rows){
  if(!rows.length)return null;
  const ul=_phkE('ul','phk-ins-list',null,rows);
  return _phkE('div','phk-ins-sec',null,[_phkE('h4','phk-ins-h',phI18nD(titleKey)),ul]);
}
// entry = the loaded PO entry ({state:'ok'|'error'|'missing'|'loading', data, text}); returns a node, or null while loading.
function phkInstructionsCard(entry,opts){
  const card=_phkE('section','phk-ins');
  card.setAttribute('data-phk-instructions','1');
  card.appendChild(_phkE('h3','phk-ins-title',phI18nD('cut.instr_title')));
  if(!entry||entry.state==='loading')return null;
  if(entry.state!=='ok'||!entry.data){
    card.classList.add('phk-ins-bad');
    card.appendChild(_phkE('p','phk-ins-msg',phI18nD('cut.instr_unread',{why:String(entry.text||'')})));
    return card;
  }
  const raw=entry.data.instructions;
  // Only the PO detail page asks for this (opts.strict): a snapshot that is present but not a map is said to be malformed, by name.
  // Today's Cutting calls with no opts and keeps its original wording for every input.
  if(opts&&opts.strict&&raw!==undefined&&raw!==null&&(typeof raw!=='object'||Array.isArray(raw))){
    card.classList.add('phk-ins-bad');
    card.appendChild(_phkE('p','phk-ins-msg',phI18nD('cut.instr_malformed')));
    return card;
  }
  const v=raw&&typeof raw==='object'&&!Array.isArray(raw)&&typeof phInstructionsClean==='function'?phInstructionsClean(raw).value:null;
  if(!v||(typeof phInstructionsEmpty==='function'&&phInstructionsEmpty(v))){
    card.appendChild(_phkE('p','phk-ins-msg',phI18nD('cut.instr_none')));
    return card;
  }
  const kids=[];
  const pl=_phkInstrSection('cut.instr_placement',v.placements.map(function(r){return _phkInstrRow([r.side,r.en],r.ur);}));
  if(pl)kids.push(pl);
  const pa=_phkInstrSection('cut.instr_pantone',v.pantones.map(function(r){
    const hex=_phkSwatchHex(r);
    let sw=null;
    if(hex){sw=_phkE('i','phk-ins-sw');sw.style.background=hex;sw.setAttribute('aria-hidden','true');}
    return _phkInstrRow([r.code+' '+r.system,r.name,r.use],'',sw);}));
  if(pa)kids.push(pa);
  const em=_phkInstrSection('cut.instr_embroidery',v.embroidery.map(function(r){
    return _phkInstrRow([r.code,r.candle&&('candle '+r.candle),r.shade&&('shade '+r.shade),r.position,r.note]);}));
  if(em)kids.push(em);
  if(v.notes.en||v.notes.ur)kids.push(_phkInstrSection('cut.instr_notes',[_phkInstrRow([v.notes.en],v.notes.ur)]));
  kids.forEach(function(k){card.appendChild(k);});
  const rev=typeof entry.data.instructionsRev==='number'?entry.data.instructionsRev:null;
  if(rev!==null)card.appendChild(_phkE('p','phk-ins-rev',phI18nD('cut.instr_rev',{n:rev})));
  return card;
}
function _phkInfoCol(poId,job,entry){
  const kids=[];
  const po=entry&&entry.po.state==='ok'?entry.po.data:null;
  if(!entry||entry.po.state==='loading')kids.push(_phkE('p','phk-muted',phI18nD('cut.reading_po')));
  else if(entry.po.state!=='ok'){
    kids.push(_phkE('p','phk-err',_phkTxt(entry.po.text)));
    kids.push(_phkBtn('ph-btn phk-btn',phI18nD('cut.try_again'),function(){phkLoadPO(poId,true);}));
  }
  if(po){
    kids.push(_phkE('p','phk-art',[po.name,po.code].filter(Boolean).join(' · ')||phI18nD('cut.article_not_named')));
    const q=phWhole(po.qty);
    kids.push(_phkFact(phI18nD('cut.f_ordered'),q!==null?phI18nD('queue.pcs',{n:q}):phI18nD('cut.qty_not_recorded')));
    const sz=phkSizesOf(po);
    if(sz.length)kids.push(_phkFact(phI18nD('cut.f_sizes'),sz.map(function(s){return s.size+' '+s.qty;}).join(' · ')));
  }
  kids.push(_phkFact(phI18nD('cut.f_master'),job.masterName||phI18nD('cut.no_master_assigned')));
  kids.push(_phkFact(phI18nD('cut.planned_cut'),job.plannedCutDate||phI18nD('cut.no_day_set')));
  if(job.note)kids.push(_phkFact(phI18nD('cut.f_note'),job.note));
  kids.push(_phkFabricBlock(job,entry));
  const ins=phkInstructionsCard(entry?entry.po:null);
  if(ins)kids.push(ins);
  return _phkE('div','phk-col phk-info',null,kids);
}

function _phkSavedResult(job){
  const c=job&&job.rollsChecklist&&typeof job.rollsChecklist==='object'?job.rollsChecklist:null;
  if(!c)return _phkE('p','phk-muted',phI18nD('cut.no_check_saved'));
  const bits=[];
  if(c.missing>0)bits.push(_phkPlural(c.missing,phI18nD('cut.roll_missing_one'),phI18nD('cut.roll_missing_many')));
  if(c.extra>0)bits.push(_phkPlural(c.extra,phI18nD('cut.roll_extra_one'),phI18nD('cut.roll_extra_many')));
  if(c.short>0)bits.push(phI18nD('cut.weight_outside'));
  const flagged=bits.length>0;
  const kids=[
    _phkE('span','phk-saved-t',bits.length?phI18nD('cut.saved_check_of_bits',{v:c.verified,t:c.total,bits:_phkJoinD(bits,'cut.join_dot')}):phI18nD('cut.saved_check_of',{v:c.verified,t:c.total})),
    _phkChip(flagged?phI18nD('cut.saved_mismatch'):phI18nD('cut.saved_match'),flagged?'bad':'ok')
  ];
  // the which-rolls detail saved with the check (older checks have only the counts)
  const codes=function(label,list,count){
    if(!Array.isArray(list)||!list.length)return null;
    const shown=list.slice(0,PHK_CODES_SHOWN),left=Math.max(count>>>0,list.length)-shown.length;
    return _phkE('p','phk-saved-codes',left>0?phI18nD('cut.codes_line_more',{label:label,codes:shown.join(', '),n:left}):phI18nD('cut.codes_line',{label:label,codes:shown.join(', ')}));
  };
  const mc=codes(phI18nD('cut.lbl_missing'),c.missingCodes,c.missing),ec=codes(phI18nD('cut.lbl_not_on_issue'),c.extraCodes,c.extra);
  if(mc||ec){
    const box=_phkE('div','phk-saved-detail');
    if(mc)box.appendChild(mc);
    if(ec)box.appendChild(ec);
    return _phkE('div','phk-saved-wrap',null,[_phkE('div','phk-saved',null,kids),box]);
  }
  return _phkE('div','phk-saved',null,kids);
}

function _phkCheckCol(poId,job,entry){
  const w=_phkW(poId);
  const canEdit=_phkCanEdit(job);
  const kids=[_phkE('h4','phk-h',phI18nD('cut.roll_check'))];
  kids.push(_phkSavedResult(job));
  if(!entry||entry.issue.state==='loading'){kids.push(_phkE('p','phk-muted',phI18nD('cut.reading_issue')));return _phkE('div','phk-col phk-check',null,kids);}
  // Without a readable fabric issue there is no roll list, but Mark complete does not depend on one.
  const actionsOnly=function(){if(canEdit){const dyn=_phkE('div','phk-dyn');w.dyn=dyn;kids.push(dyn);}};
  if(entry.issue.state==='error'){
    kids.push(_phkE('p','phk-err',_phkTxt(entry.issue.text)));
    kids.push(_phkBtn('ph-btn phk-btn',phI18nD('cut.try_again'),function(){phkLoadPO(poId,true);}));
    actionsOnly();
    return _phkE('div','phk-col phk-check',null,kids);
  }
  const issue=entry.issue.issue;
  if(!issue.rolls.length){
    kids.push(_phkE('p','phk-note',phI18nD('cut.no_issue_no_rolls')));
    actionsOnly();
  }else if(!canEdit){
    kids.push(_phkE('p','phk-muted',job.status==='open'?phI18nD('cut.no_permission_check'):phI18nD('cut.job_closed2',{status:job.status})));
  }else{
    // mode switch
    const seg=_phkE('div','phk-seg');seg.setAttribute('role','group');seg.setAttribute('aria-label',phI18nAttr(phI18nD('cut.how_check')));
    [['scan',phI18nD('cut.mode_scan')],['tally',phI18nD('cut.mode_count')]].forEach(function(m){
      seg.appendChild(_phkBtn('ph-btn phk-btn phk-seg-b'+(w.mode===m[0]?' on':''),m[1],function(){phkSetMode(poId,m[0]);},{'aria-pressed':w.mode===m[0]?'true':'false'}));
    });
    kids.push(seg);
    // inputs for the chosen mode (kept across scans; only a mode change rebuilds them)
    if(w.mode==='scan'){
      const id='phk-scan-'+poId;
      const lab=_phkE('label','phk-lab',phI18nD('cut.scan_placeholder'));lab.setAttribute('for',id);
      const inp=_phkE('input','phk-in');inp.id=id;
      [['type','text'],['autocomplete','off'],['autocapitalize','characters'],['autocorrect','off'],['spellcheck','false'],['enterkeyhint','done'],['inputmode','text'],['placeholder',phI18nAttr(phI18nD('cut.scan_label'))]].forEach(function(a){inp.setAttribute(a[0],a[1]);});
      inp.value=w.draft||'';
      const submit=function(){
        const v=inp.value;inp.value='';w.draft='';
        const r=phkScan(poId,v);
        try{inp.focus();}catch(e){}
        return r;
      };
      inp.addEventListener('input',function(){w.draft=inp.value;});
      inp.addEventListener('keydown',function(e){
        const k=e&&e.key;
        if(k==='Enter'||(k==='Tab'&&String(inp.value||'').trim()!=='')){if(e.preventDefault)e.preventDefault();submit();}
      });
      kids.push(lab);
      kids.push(_phkE('div','phk-row',null,[inp,_phkBtn('ph-btn ph-btn-primary phk-btn phk-add',phI18nD('cut.btn_add'),submit)]));
      const lw=_phkE('label','phk-lab',phI18nD('cut.weighed_total2',{unit:issue.unit||'kg'}));lw.setAttribute('for','phk-wt-'+poId);
      const wi=_phkE('input','phk-in');wi.id='phk-wt-'+poId;wi.setAttribute('type','number');wi.setAttribute('inputmode','decimal');wi.setAttribute('step','0.1');wi.setAttribute('min','0');wi.value=w.weighed||'';
      wi.addEventListener('input',function(){phkSetTally(poId,'weighed',wi.value);});
      kids.push(lw);kids.push(wi);
    }else{
      const l1=_phkE('label','phk-lab',phI18nD('cut.rolls_counted'));l1.setAttribute('for','phk-cnt-'+poId);
      const i1=_phkE('input','phk-in');i1.id='phk-cnt-'+poId;i1.setAttribute('type','number');i1.setAttribute('inputmode','numeric');i1.setAttribute('step','1');i1.setAttribute('min','0');i1.value=w.tallyRolls||'';
      i1.addEventListener('input',function(){phkSetTally(poId,'tallyRolls',i1.value);});
      const l2=_phkE('label','phk-lab',phI18nD('cut.weight_counted2',{unit:issue.unit||'kg'}));l2.setAttribute('for','phk-cw-'+poId);
      const i2=_phkE('input','phk-in');i2.id='phk-cw-'+poId;i2.setAttribute('type','number');i2.setAttribute('inputmode','decimal');i2.setAttribute('step','0.1');i2.setAttribute('min','0');i2.value=w.tallyWeight||'';
      i2.addEventListener('input',function(){phkSetTally(poId,'tallyWeight',i2.value);});
      kids.push(l1);kids.push(i1);kids.push(l2);kids.push(i2);
    }
    const dyn=_phkE('div','phk-dyn');w.dyn=dyn;
    kids.push(dyn);
  }
  return _phkE('div','phk-col phk-check',null,kids);
}

// The part of the checklist that changes on every scan: feedback, roll list, summary, actions.
function _phkPaintDyn(poId){
  const w=_phkWork[poId];
  if(!w||!w.dyn||!_phkCtx)return;
  const job=_phkJob(poId),issue=_phkIssueOf(poId);
  _phkClear(w.dyn);
  if(!job)return;
  const has=!!issue&&issue.rolls.length>0;
  if(w.msg){
    const m=_phkE('p','phk-msg phk-msg-'+w.msg.kind,w.msg.text);
    m.setAttribute('role',w.msg.kind==='err'?'alert':'status');
    w.dyn.appendChild(m);
    if(w.msg.reload)w.dyn.appendChild(_phkBtn('ph-btn phk-btn',phI18nD('cut.reload_latest'),function(){_phkReloadAll();}));
  }
  if(has&&w.mode==='scan'){
    const ul=_phkE('ul','phk-rolls');
    issue.rolls.forEach(function(r){
      const on=w.present[r.code]===true;
      const li=_phkE('li','phk-roll'+(on?' on':''));
      const btn=_phkBtn('phk-roll-b',null,function(){phkToggleRoll(poId,r.code);},{'aria-pressed':on?'true':'false','aria-label':phI18nAttr(phI18nD(on?'cut.present_tap_undo':'cut.not_seen_tap',{code:r.code}))});
      btn.appendChild(_phkE('span','phk-roll-code',r.code));
      btn.appendChild(_phkE('span','phk-roll-grp',issue.groups[r.group]?issue.groups[r.group].label:''));
      btn.appendChild(_phkE('span','phk-roll-st',on?phI18nD('cut.present'):phI18nD('cut.not_seen')));
      li.appendChild(btn);ul.appendChild(li);
    });
    w.dyn.appendChild(ul);
    if(w.extras.length){
      const ex=_phkE('ul','phk-extras');
      w.extras.forEach(function(c){
        ex.appendChild(_phkE('li','phk-extra',null,[_phkE('span','phk-roll-code',c),_phkE('span','phk-roll-st',phI18nD('cut.not_on_issue')),
          _phkBtn('phk-x',phI18nD('cut.btn_remove'),function(){phkRemoveExtra(poId,c);},{'aria-label':phI18nAttr(phI18nD('cut.remove',{code:c}))})]));
      });
      w.dyn.appendChild(ex);
    }
  }
  const res=phkEvalChecklist(issue,w);
  const sum=_phkE('div','phk-sum');sum.setAttribute('role','status');sum.setAttribute('aria-live','polite');
  if(!has){
    // nothing to verify: no summary box at all
  }else if(!res.ok){
    sum.appendChild(_phkE('p','phk-sum-p',res.problems.length?phI18nD('cut.to_do',{what:_phkJoinD(res.problems,'cut.join_semi')}):''));
  }else{
    const c=res.counts;
    sum.appendChild(_phkE('p','phk-sum-big',phI18nD('cut.rolls_verified_of',{v:c.verified,t:c.total})));
    if(!res.active){
      // nothing scanned or counted yet: "N rolls missing" would be true of every job and means nothing
      sum.appendChild(_phkE('p','phk-sum-p',phI18nD('cut.not_checked_yet2')));
    }else if(res.mismatch){
      sum.appendChild(_phkE('p','phk-sum-bad',phI18nD('cut.mismatch_saved',{what:_phkJoinD(res.flagsD,'cut.join_dot')})));
      if(res.missingCodes.length)sum.appendChild(_phkE('p','phk-sum-p',phI18nD('cut.missing_codes',{what:res.missingCodes.join(', ')})));
    }else sum.appendChild(_phkE('p','phk-sum-ok',phI18nD('cut.match_line')));
    if(res.weight&&!res.weight.comparable)sum.appendChild(_phkE('p','phk-sum-p',phI18nD('cut.weight_not_compared_dot',{why:res.weight.why})));
    else if(res.weight&&res.weight.comparable&&!res.weight.flag)sum.appendChild(_phkE('p','phk-sum-p',phI18nD('cut.weight_within2',{a:res.weight.entered,u:res.weight.unit,tol:res.weight.tol,b:res.weight.issued})));
  }
  if(has)w.dyn.appendChild(sum);
  if(has&&w.dirty)w.dyn.appendChild(_phkE('p','phk-muted',phI18nD('cut.not_saved_yet')));
  // actions
  const act=_phkE('div','phk-actions');
  const dis=w.busy;
  const canSave=res.ok&&res.active&&!dis;
  if(has){
    const save=_phkBtn('ph-btn ph-btn-primary phk-btn phk-act',phI18nD('cut.save_check'),function(){if(!dis&&canSave)phkSaveChecklist(poId);},{'aria-disabled':canSave?'false':'true'});
    act.appendChild(save);
  }
  if(w.confirming){
    const will=res.ok&&res.active&&w.dirty?(res.mismatch?phI18nD('cut.also_saves_flagged'):phI18nD('cut.also_saves')):'';
    act.appendChild(_phkE('p','phk-confirm',will?phI18nD('cut.confirm_complete_will',{will:will}):phI18nD('cut.confirm_complete')));
    act.appendChild(_phkBtn('ph-btn ph-btn-primary phk-btn phk-act',phI18nD('cut.yes_complete'),function(){if(!dis)phkMarkComplete(poId);},{'aria-disabled':dis?'true':'false'}));
    act.appendChild(_phkBtn('ph-btn phk-btn phk-act',phI18nD('cut.btn_cancel'),function(){w.confirming=false;_phkPaintDyn(poId);}));
  }else{
    act.appendChild(_phkBtn('ph-btn phk-btn phk-act',phI18nD('cut.mark_complete'),function(){if(dis)return;w.confirming=true;_phkPaintDyn(poId);},{'aria-disabled':dis?'true':'false'}));
  }
  if(dis)act.appendChild(_phkE('p','phk-muted',phI18nD('shell.saving')));
  w.dyn.appendChild(act);
}

function _phkPreviewCol(poId,job,entry){
  const po=entry&&entry.po.state==='ok'?entry.po.data:null;
  const w=_phkW(poId);
  const wrap=_phkE('div','phk-preview');
  if(!po)return wrap;
  const tog=_phkBtn('ph-btn phk-btn phk-tog',w.previewOpen?phI18nD('cut.check_qty_hide'):phI18nD('cut.check_qty_show'),function(){w.previewOpen=!w.previewOpen;_phkRepaintCard(poId);},{'aria-expanded':w.previewOpen?'true':'false'});
  wrap.appendChild(tog);
  if(!w.previewOpen)return wrap;
  wrap.appendChild(_phkE('p','phk-muted',phI18nD('cut.check_qty_note')));
  const sizes=phkSizesOf(po);
  const keys=sizes.length?sizes.map(function(s){return s.size;}):['TOTAL'];
  const grid=_phkE('div','phk-cutgrid');
  const out=_phkE('div','phk-cutout');out.setAttribute('role','status');out.setAttribute('aria-live','polite');
  const paint=function(){
    _phkClear(out);
    const pv=phkCutPreview(po,w.cut);
    out.appendChild(_phkE('p','phk-sum-p',pv.ordered!==null?phI18nD('cut.cut_so_far_of',{n:pv.total,ord:pv.ordered}):phI18nD('cut.cut_so_far_n',{n:pv.total})));
    if(pv.bad.length)out.appendChild(_phkE('p','phk-sum-bad',phI18nD('cut.whole_only_x',{v:pv.bad.join(', ')})));
    if(pv.verdict==='override')out.appendChild(_phkE('p','phk-sum-ok',phI18nD('cut.gate_approved')));
    else if(pv.verdict==='ok')out.appendChild(_phkE('p','phk-sum-ok',phI18nD('cut.gate_inside2',{min:pv.min,max:pv.max,lo:pv.gate[0],hi:pv.gate[1],ord:pv.ordered})));
    else if(pv.verdict==='needs_override')out.appendChild(_phkE('p','phk-sum-bad',phI18nD('cut.gate_outside2',{min:pv.min,max:pv.max,lo:pv.gate[0],hi:pv.gate[1]})));
    else out.appendChild(_phkE('p','phk-sum-p',pv.ordered===null?phI18nD('cut.gate_no_order'):(pv.min!==null?phI18nD('cut.gate_enter_allowed',{min:pv.min,max:pv.max}):phI18nD('cut.gate_enter_dot'))));
  };
  keys.forEach(function(z){
    const id='phk-cut-'+poId+'-'+z;
    const l=_phkE('label','phk-lab',z==='TOTAL'?phI18nD('cut.total_cut'):(sizes.length?phI18nD('cut.size_ordered_x',{s:z,n:sizes.filter(function(s){return s.size===z;})[0].qty}):phI18nD('cut.size_only',{s:z})));l.setAttribute('for',id);
    const i=_phkE('input','phk-in');i.id=id;i.setAttribute('type','number');i.setAttribute('inputmode','numeric');i.setAttribute('step','1');i.setAttribute('min','0');i.value=w.cut[z]||'';
    i.addEventListener('input',function(){w.cut[z]=i.value;paint();});
    grid.appendChild(_phkE('div','phk-cutf',null,[l,i]));
  });
  wrap.appendChild(grid);
  paint();
  wrap.appendChild(out);
  return wrap;
}

function _phkBuildCard(poId,host,kind){
  const job=_phkJob(poId);
  _phkClear(host);
  if(!job){host.appendChild(_phkE('p','phk-err',phI18nD('cut.job_gone',{po:poId})));return;}
  const entry=_phkPO[poId]||null;
  const w=_phkW(poId);w.dyn=null;
  const today=phkToday();
  const late=kind==='overdue'?phDaysBetween(job.plannedCutDate,today):null;
  const head=_phkE('header','phk-card-head',null,[_phkE('h3','phk-po',poId),_phkStatusChip(job.status)]);
  if(late!==null&&late>0)head.appendChild(_phkChip(phI18nD(late===1?'cut.day_late':'cut.days_late',{n:late}),'bad'));
  const body=_phkE('div','phk-card-body',null,[_phkInfoCol(poId,job,entry)]);
  const right=_phkCheckCol(poId,job,entry);
  body.appendChild(right);
  host.appendChild(head);
  if(typeof phmkSummaryNode==='function'){const ms=phmkSummaryNode(poId);if(ms){host.appendChild(ms);host.classList.add('phmk-card');if(ms.querySelector('.phmk-k-hold'))host.classList.add('phmk-held');}}
  if(typeof phmkThreadNode==='function'){const th=phmkThreadNode(poId,_phkCtx);if(th)host.appendChild(th);}   // the full thread, read-only (Kashif cannot write)
  host.appendChild(body);
  // managers only: the existing cutting screen
  if(_phkCtx&&_phkCtx.canManage&&entry&&entry.po.state==='ok'){
    const po=entry.po.data;
    const cs=po&&po.currentStage;
    if(po&&po.poStatus!=='cancelled'&&cs==='cutting'&&job.status!=='done'){
      right.appendChild(_phkBtn('ph-btn phk-btn phk-rec',phI18nD('cut.record_cut'),function(){phkRecordCut(poId);}));
      right.appendChild(_phkE('p','phk-muted',phI18nD('cut.record_cut_tip')));
    }else if(po&&cs&&cs!=='cutting')right.appendChild(_phkE('p','phk-muted',phI18nD('cut.record_already_x',{stage:cs})));
  }
  const pv=_phkPreviewCol(poId,job,entry);
  if(pv.firstChild)right.appendChild(pv);
  _phkPaintDyn(poId);
}
function _phkRepaintCard(poId){
  const c=_phkCards[poId];
  if(!c||!c.host||!_phkCtx)return;
  _phkBuildCard(poId,c.host,c.kind);
}
function _phkReloadAll(){
  _phkPO={};_phkInflight={};
  if(_phkCtx&&typeof _phkCtx.reload==='function')return _phkCtx.reload();
  return Promise.resolve();
}

function _phkCardShell(poId,kind){
  const host=_phkE('section','phk-card'+(kind==='overdue'?' phk-late':''));
  host.setAttribute('data-po',poId);
  host.setAttribute('aria-label',phI18nAttr(phI18nD('cut.job_card',{po:poId})));
  _phkCards[poId]={host:host,kind:kind};
  _phkBuildCard(poId,host,kind);
  return host;
}
function _phkOverdueRow(r){
  const poId=r.fbKey;
  const today=phkToday();
  const late=phDaysBetween(r.plannedCutDate,today);
  if(_phkOpen[poId]){
    const wrap=_phkE('div','phk-ovwrap');
    wrap.appendChild(_phkCardShell(poId,'overdue'));
    wrap.appendChild(_phkBtn('ph-btn phk-btn phk-close',phI18nD('cut.closed_all'),function(){_phkOpen[poId]=false;_phkCtx.repaint();}));
    return wrap;
  }
  const row=_phkE('div','phk-ovrow');
  row.appendChild(_phkE('div','phk-ovtxt',null,[_phkE('span','phk-ovpo',poId),_phkE('span','phk-ovd',_phkJoinD([r.plannedCutDate,late!==null?phI18nD(late===1?'cut.day_late':'cut.days_late',{n:late}):'',r.masterName||phI18nD('queue.no_master')].filter(Boolean),'cut.join_dot'))]));
  row.appendChild(_phkBtn('ph-btn phk-btn',phI18nD('cut.btn_open'),function(){_phkOpen[poId]=true;_phkCtx.repaint();},{'aria-label':phI18nAttr(phI18nD('cut.open_overdue',{po:poId}))}));
  return row;
}

// The tab. Registered below. host is an empty element this function owns.
function phkRenderTab(host,ctx){
  _phkCtx=ctx;_phkCards={};
  const E=ctx.el;
  const today=phkToday();
  const head=E('header','ph-head phk-head');
  const row=E('div','ph-head-row',null,[E('h2','ph-title',phI18nD('shell.tab_cutting'))]);
  if(ctx.readOnly)row.appendChild(E('span','ph-chip ph-chip-view',phI18nD('cut.blurb_floor')));
  head.appendChild(row);
  head.appendChild(E('p','ph-blurb',today?phI18nD('cut.planned_for_line',{day:today}):phI18nD('cut.date_unreadable')));
  host.appendChild(head);
  const jobs=ctx.get('jobs');
  if(!jobs||!jobs.ok){
    const card=E('section','ph-card ph-card-err');card.setAttribute('role','alert');
    card.appendChild(E('h3','ph-card-title',phI18nD('cut.jobs_failed')));
    card.appendChild(E('p','ph-note',(jobs&&jobs.text)?_phkTxt(jobs.text):phI18nD('cut.jobs_not_loaded')));
    card.appendChild(E('p','ph-note',phI18nD('cut.no_list_until_ok')));
    const b=E('button','ph-btn ph-btn-primary phk-btn',phI18nD('shell.retry'));b.setAttribute('type','button');
    b.addEventListener('click',function(){_phkReloadAll();});
    card.appendChild(b);
    host.appendChild(card);
    return;
  }
  const sp=phkSplitJobs(jobs.rows,today);
  const bar=E('div','phk-bar');
  bar.appendChild(E('span','phk-bar-t',sp.undated?phI18nD('cut.bar_text_undated',{today:_phkPlural(sp.today.length,phI18nD('cut.w_job_one'),phI18nD('cut.w_job_many')),overdue:sp.overdue.length,undated:_phkPlural(sp.undated,phI18nD('cut.w_openjob_one'),phI18nD('cut.w_openjob_many'))}):phI18nD('cut.bar_text',{today:_phkPlural(sp.today.length,phI18nD('cut.w_job_one'),phI18nD('cut.w_job_many')),overdue:sp.overdue.length})));
  bar.appendChild(_phkBtn('ph-btn phk-btn',phI18nD('shell.refresh'),function(){_phkReloadAll();}));
  host.appendChild(bar);
  if(jobs.truncated)host.appendChild(E('p','phk-err',phI18nD('cut.list_cut_limit')));
  // today
  const t=E('section','phk-sec');
  t.appendChild(E('h3','phk-sec-h',phI18nD('cut.todays_jobs')));
  if(!sp.today.length)t.appendChild(E('p','phk-empty',phI18nD('cut.none_today')));
  else{
    const g=E('div','phk-grid');
    sp.today.forEach(function(r){g.appendChild(_phkCardShell(r.fbKey,'today'));});
    t.appendChild(g);
  }
  host.appendChild(t);
  // overdue
  const o=E('section','phk-sec');
  o.appendChild(E('h3','phk-sec-h',phI18nD('cut.overdue_open')));
  if(!sp.overdue.length)o.appendChild(E('p','phk-empty',phI18nD('cut.none_overdue')));
  else{
    const shown=_phkOverdueAll?sp.overdue:sp.overdue.slice(0,PHK_OVERDUE_SHOW);
    shown.forEach(function(r){o.appendChild(_phkOverdueRow(r));});
    if(sp.overdue.length>shown.length)o.appendChild(_phkBtn('ph-btn phk-btn',phI18nD('cut.show_all_overdue',{n:sp.overdue.length}),function(){_phkOverdueAll=true;ctx.repaint();}));
  }
  host.appendChild(o);
  // load the PO and its issue for every card on screen, lazily
  Object.keys(_phkCards).forEach(function(id){if(!_phkPO[id])phkLoadPO(id,false);});
}

if(typeof phRegisterTab==='function')phRegisterTab('cutting',{render:phkRenderTab});

/* ── WP7: the same read-only card on the PO DETAIL page, for everybody who can open it ─────────────────────────────
   js/pos.js renderDetailPage puts window.phPoDetailCardSlot(po) (an empty placeholder) in the page and calls window.phPoDetailCardFill(po)
   after the page is in the DOM. Source is the PO document the page already holds (po.instructions): no read, no write, no rules change. */
window.phPoDetailCardSlot=function(po){
  return'<div id="ph-detail-instr" data-ph-detail-instr="1" style="margin-bottom:12px"></div>';
};
window.phPoDetailCardFill=function(po){
  try{
    const host=document.getElementById('ph-detail-instr');if(!host)return false;
    while(host.firstChild)host.removeChild(host.firstChild);
    const card=phkInstructionsCard({state:'ok',data:po&&typeof po==='object'?po:{}},{strict:true});
    if(card)host.appendChild(card);
    return !!card;
  }catch(e){return false;}
};

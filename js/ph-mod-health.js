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
      A check whose inputs did not load says "unavailable - <collection>"; it never prints 0.

   FIND-THE-ISSUE: phhCandidates() ranks the orphan fabric passes for one PO (date near its release, then the
   fabric name). The pick is kept IN MEMORY for the session (phhPick). It is NOT written to po_cut_jobs: the
   published rules for that collection allow no `fabricPassIds` field (phJobShapeOk / the create and update
   field lists), and a rules change is out of this file's scope. gatepasses is never written.

   Globals are phh / _phh / PHH_ prefixed (classic scripts share one lexical scope).
   ───────────────────────────────────────────────────────────────────────── */

const PHH_READ_TIMEOUT_MS=20000;
const PHH_LIMITS=Object.freeze({pos:2000,gatepasses:4000});
const PHH_LIST_SHOW=25;
const PHH_CAND_MAX=8;
const PHH_CHECKS=Object.freeze([
  {id:'cutting_no_pass',label:'POs at cutting with no fabric issue',need:['pos','gatepasses'],hint:'The cutting screen cannot show or check rolls for these.'},
  {id:'digits_only',label:'POs matched to their fabric issue only by the digit spelling',need:['pos','gatepasses'],hint:'The pass stores the PO as 125 instead of PO-125. It is matched, but the spelling should be fixed at the source.'},
  {id:'orphan_passes',label:'Fabric issues pointing at no real PO',need:['pos','gatepasses'],hint:'The PO on the pass is blank, free text (Sample) or a number with no PO.'},
  {id:'reserved_issued',label:'Reserved POs that already have fabric issued',need:['pos','gatepasses'],hint:'Fabric left the store for a PO that was never released.'},
  {id:'qty_mismatch',label:'POs where the quantity is not the sum of the sizes',need:['pos'],hint:'qty and sizes disagree.'},
  {id:'pass_no_master',label:'Fabric issues with no cutting master',need:['gatepasses'],hint:'Reports and the master log cannot credit these cuts.'},
  {id:'jobs_no_fabric',label:'Open cut jobs with no fabric link',need:['po_cut_jobs','gatepasses'],hint:'The roll check has nothing to check against.'}
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
// The model. inp: {pos, passes, jobs, picks:{poKey:[passId]}} (each null/absent = not loaded).
function phhBuildModel(inp){
  const I=_phhObj(inp)?inp:{};
  const posOk=Array.isArray(I.pos),passOk=Array.isArray(I.passes),jobsOk=Array.isArray(I.jobs);
  const avail={pos:posOk,gatepasses:passOk,po_cut_jobs:jobsOk};
  const picks=_phhObj(I.picks)?I.picks:{};
  const M={avail:avail,checks:[],total:0,anyUnavailable:false,counts:{pos:posOk?I.pos.length:null,fabricPasses:passOk?I.passes.filter(_phhIsFabric).length:null}};
  const pidx=passOk?phhPassIndex(I.passes):null;
  const allKeys=new Set(),live=[];
  if(posOk)I.pos.forEach(function(po){
    if(!_phhObj(po))return;
    const k=phPoKey(_phhPoId(po));
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
    const r={id:c.id,label:c.label,hint:c.hint,state:miss.length?'unavailable':'ok',unavailable:miss,count:null,items:[]};
    res[c.id]=r;M.checks.push(r);
    if(miss.length)M.anyUnavailable=true;
    return r;
  };
  PHH_CHECKS.forEach(function(c){
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
// Fill pos and gatepasses once (force: read both again from the server). Resolves when settled; NEVER rejects.
function phhEnsure(force){
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
function phhReset(){_phhSrc={pos:_phhFresh(),gatepasses:_phhFresh()};_phhP=null;_phhVer++;}
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
  return phhBuildModel({pos:phhRows('pos'),passes:phhRows('gatepasses'),jobs:gj&&gj.ok?gj.rows:null,picks:_phhPicks});
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
function _phhLoading(){return _phhSrc.pos.state==='idle'||_phhSrc.pos.state==='loading'||_phhSrc.gatepasses.state==='idle'||_phhSrc.gatepasses.state==='loading';}
function _phhKick(ctx){
  if(_phhSrc.pos.state==='idle'||_phhSrc.gatepasses.state==='idle'){
    phhEnsure(false).then(function(){try{if(ctx&&ctx.repaint&&(typeof _phUiTab==='undefined'||!ctx.tab||_phUiTab===ctx.tab.id))ctx.repaint();}catch(e){}});
  }
}
// The Monitor tab's section.
function phhSection(ctx){
  const E=phEl,sec=E('section','ph-card phh-sec');
  sec.setAttribute('data-health','1');
  sec.appendChild(E('h3','ph-card-title','Data health'));
  sec.appendChild(E('p','ph-note','Seven checks over the purchase orders, fabric issues and cut jobs. Each count opens the list behind it. Nothing here is changed or written.'));
  _phhKick(ctx);
  if(_phhLoading()){sec.appendChild(E('p','phh-note','Reading purchase orders and fabric issues…'));return sec;}
  _phhSourceNotes().forEach(function(n){sec.appendChild(n);});
  const M=phhModel(ctx);
  const ul=E('ul','phh-checks');
  M.checks.forEach(function(c){ul.appendChild(_phhCheckEl(c,ctx));});
  sec.appendChild(ul);
  const foot=E('div','phh-foot');
  foot.appendChild(_phhBtn('ph-btn phh-reload','Read again',function(){phhEnsure(true).then(function(){try{ctx.repaint();}catch(e){}});ctx.repaint();}));
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

/* ─────────────────────────────────────────────────────────────────────────
   js/po-registry.js — the PO Registry page (classic page `po-registry`), rebuilt (RG3, Oct 2026).

   js/pos.js renderRegistry() keeps its header and its Orders | Cutting tabs and hands the Orders body to
   porRegistryHTML() behind `typeof` (try/catch): if this file is missing or throws, today's list is drawn instead.
   Every decision comes from the pure core, js/por-core.js. This file only arranges it.

   What it draws: saved VIEWS (Active · Needs attention · Cutting floor · Finishing · Done · Cancelled · All), a search,
   group-by and sort, "needs" chips with counts, rows 40 at a time ("Show 40 more"). Defaults (the owner, Oct 2026):
   Active, sorted oldest at this stage, no grouping. View / sort / group are remembered per device (localStorage, guarded).

   Honest states: the pos read FAILED (js/pos.js names it in _posLoadFailed) -> an error card naming pos, no rows, no counts.
   Marks and cut plans not read -> the rows say nothing about them and the count line says why; never "no hold".
   It writes NOTHING and never deletes (the old body's _cleanupAutoFabricPOs is not called from here).

   XSS: the body is an HTML string (Kashif's Production Ops tab mounts the same string, js/ph-mod-classic.js). Every stored
   value goes through _porEsc; a PO key in an attribute is read back with getAttribute, never spliced into script.

   Globals are por / _por / POR_ prefixed (classic scripts share one lexical scope).
   ───────────────────────────────────────────────────────────────────────── */

const POR_PAGE=40;
const POR_STORE_KEY='groovy-por-view';
let _porState={view:'active',q:'',sort:'age',group:'none',need:'',shown:POR_PAGE,open:{}};
let _porLoaded=false;          // the per-device choices were read once
let _porSide={state:'idle'};   // marks + cut jobs (Production Ops audience only)
let _porQTimer=null;

function _porEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function _porNum(n){return typeof n==='number'&&isFinite(n)?String(n):'—';}
function _porRestore(){
  if(_porLoaded)return;_porLoaded=true;
  try{
    const raw=typeof localStorage!=='undefined'&&localStorage?localStorage.getItem(POR_STORE_KEY):null;
    const o=raw?JSON.parse(raw):null;
    if(o&&typeof o==='object'){
      if(POR_VIEWS.some(function(v){return v.id===o.view;}))_porState.view=o.view;
      if(POR_SORTS.some(function(v){return v.id===o.sort;}))_porState.sort=o.sort;
      if(POR_GROUPS.some(function(v){return v.id===o.group;}))_porState.group=o.group;
    }
  }catch(e){}
}
function _porSave(){
  try{if(typeof localStorage!=='undefined'&&localStorage)localStorage.setItem(POR_STORE_KEY,JSON.stringify({view:_porState.view,sort:_porState.sort,group:_porState.group}));}catch(e){}
}
function _porUser(){return typeof session!=='undefined'&&session&&typeof session.u==='string'?session.u:'';}
function _porRole(){return typeof session!=='undefined'&&session?session.role:'';}
// Faizan (packing, QC Ops) reaches QC through Afloat POs, not this registry (owner, Oct 2026: yes to the default).
function porRestricted(){return _porRole()==='packing';}
function _porCanSide(){try{return typeof phCanSee==='function'&&phCanSee()===true;}catch(e){return false;}}

/* ── data ─────────────────────────────────────────────────────────────── */
function _porPosState(){
  const failed=typeof _posLoadFailed!=='undefined'&&Array.isArray(_posLoadFailed)?_posLoadFailed:null;
  if(failed&&failed.indexOf('pos')>=0)return'error';
  const list=typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:[];
  if(!list.length&&(typeof _posLoadAt==='undefined'||_posLoadAt===null))return'loading';
  return'ok';
}
function _porSideRows(stage){
  if(!_porCanSide()||typeof phGet!=='function')return null;
  const g=phGet(stage);
  return g&&g.ok&&Array.isArray(g.rows)?g.rows:null;
}
function _porSideEnsure(){
  if(!_porCanSide()||typeof phLoadStage!=='function'){_porSide={state:'skipped'};return;}
  if(_porSide.state!=='idle')return;
  _porSide={state:'loading'};
  Promise.all(['marks','jobs'].map(function(s){return phLoadStage(s);})).then(function(){_porSide={state:'done'};_porRepaint();},function(){_porSide={state:'done'};_porRepaint();});
}
function _porSettings(){
  let stuck=POR_DEFAULTS.stuckDays;
  try{if(typeof phSettingsNow==='function'){const st=phSettingsNow();if(st&&typeof st.stuckDays==='number')stuck=st.stuckDays;}}catch(e){}
  return{stuckDays:stuck,noFabricDays:POR_DEFAULTS.noFabricDays};
}
// The model for the current data (pure core). now: ms (default the clock).
function porBuild(now){
  const S=_porSettings();
  const passes=typeof allPasses!=='undefined'&&Array.isArray(allPasses)?allPasses:null;
  const failed=typeof _posLoadFailed!=='undefined'&&Array.isArray(_posLoadFailed)?_posLoadFailed:[];
  const idx=porIndexCached({passes:failed.indexOf('gatepasses')>=0?null:passes,marks:_porSideRows('marks'),jobs:_porSideRows('jobs')});
  const pos=typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:[];
  return porModel(pos,idx,{now:typeof now==='number'?now:Date.now(),stuckDays:S.stuckDays,noFabricDays:S.noFabricDays});
}

/* ── the picture (the Afloat module's chain, never a copy) ───────────── */
function _porImgSafe(u){const s=String(u==null?'':u).trim();return/^https:\/\/[^\s"'<>]+$/.test(s)?s:'';}
function porImageHTML(po,size){
  const P=po||{};
  let chain=[];
  if(typeof phqcImage==='function'){try{chain=(phqcImage(P).chain||[]).map(function(c){return c.src;});}catch(e){chain=[];}}
  else chain=[_porImgSafe(P.imgFront),_porImgSafe(P.imgBack)].filter(Boolean);
  chain=chain.map(_porImgSafe).filter(Boolean);
  const code=String(P.code||'').trim(),name=String(P.name||'').trim(),id=String(P.id||P.fbKey||'');
  const alt=code&&name?code+' — '+name:(code||name||id);
  const cls='por-img por-img-'+(size==='head'?'head':'tile');
  const tile='<span class="por-tile"><b class="por-tile-code">'+_porEsc(code||id)+'</b><span class="por-tile-none">No photo</span></span>';
  if(!chain.length)return'<span class="'+cls+'" data-img-from="none">'+tile+'</span>';
  return'<span class="'+cls+'"><img class="por-pic" src="'+_porEsc(chain[0])+'" alt="'+_porEsc(alt)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-at="0" data-chain="'+_porEsc(JSON.stringify(chain))+'" data-code="'+_porEsc(code||id)+'" onerror="window.porImgNext&&window.porImgNext(this)"></span>';
}
// The next picture of the chain when one fails, then the code tile (built with textContent).
function porImgNext(img){
  try{
    const chain=JSON.parse(img.getAttribute('data-chain')||'[]');
    const at=(parseInt(img.getAttribute('data-at'),10)||0)+1;
    if(at<chain.length&&_porImgSafe(chain[at])){img.setAttribute('data-at',String(at));img.src=chain[at];return;}
    const box=img.parentNode;if(!box)return;
    const t=document.createElement('span');t.className='por-tile';
    const b=document.createElement('b');b.className='por-tile-code';b.textContent=img.getAttribute('data-code')||'';
    const n=document.createElement('span');n.className='por-tile-none';n.textContent='No photo';
    t.appendChild(b);t.appendChild(n);
    box.removeChild(img);box.appendChild(t);box.setAttribute('data-img-from','none');
  }catch(e){}
}

/* ── the row: ONE component ───────────────────────────────────────────── */
function _porStageChipClass(st){
  if(st==='cancelled')return'por-st-cancel';
  if(st==='reserved')return'por-st-reserved';
  if(st==='completed')return'por-st-done';
  if(st==='unknown')return'por-st-warn';
  return'por-st-live';
}
function _porDayShort(day){
  if(!day||!/^\d{4}-\d{2}-\d{2}$/.test(day))return'';
  const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return(+day.slice(8,10))+' '+M[+day.slice(5,7)-1];
}
function _porStageFacts(f){
  if(f.stage==='cutting'){
    if(f.fabric.state==='unread')return{text:'fabric: not read',cls:'por-muted'};
    if(f.fabric.state==='none')return{text:'fabric not issued',cls:'por-warn'};
    return{text:'fabric issued '+_porDayShort(f.fabric.day)+(f.fabric.master?' ('+f.fabric.master+')':'')+(f.cut===null?' · cut not recorded':''),cls:''};
  }
  if(f.stage==='reserved')return{text:'not released',cls:'por-warn'};
  if(f.stage==='cancelled')return{text:f.cancelled&&f.cancelled.reason?'reason: '+f.cancelled.reason:'',cls:''};
  if(f.stage==='completed')return{text:f.age.words,cls:''};
  if(f.cut!==null&&f.ordered!==null){const d=f.cut-f.ordered;return{text:'cut '+f.cut+' of '+f.ordered+(d?' ('+(d>0?'+':'')+d+')':''),cls:''};}
  return{text:'',cls:''};
}
function _porBadges(f){
  const out=[];
  if(f.mark&&f.mark.hold)out.push('<span class="por-badge por-b-hold" title="'+_porEsc(f.mark.hold.reason||'on hold')+'">⏸ On hold</span>');
  if(f.mark&&f.mark.priority==='urgent')out.push('<span class="por-badge por-b-urgent">‼ Urgent</span>');
  else if(f.mark&&f.mark.priority==='high')out.push('<span class="por-badge por-b-high">▲ High</span>');
  if(f.qtyMismatch)out.push('<span class="por-badge por-b-warn">qty ≠ sizes ('+_porNum(f.ordered)+' / '+_porNum(f.sizesSum)+')</span>');
  if(f.damageFlagged)out.push('<span class="por-badge por-b-urgent">⚠ Loss</span>');
  return out.join('');
}
function porRowHTML(f){
  const st=_porStageFacts(f);
  const words=[f.id,f.name||f.code||'',f.stageLabel].concat(f.mark&&f.mark.hold?['on hold']:[]).filter(Boolean).join(', ');
  const prog=f.progress||porProgress(f);
  const bar='<span class="por-bar" aria-hidden="true">'+prog.steps.map(function(s){return'<i class="'+(s.done?'on':'')+'"></i>';}).join('')+'</span>';
  const meta=[f.age&&f.age.words,f.delay&&f.delay.words,f.season&&f.season.key?(f.season.guess?'~':'')+f.season.label:'',f.creator,f.createdDay?'created '+_porDayShort(f.createdDay):''].filter(Boolean);
  return'<button type="button" class="por-row" data-por="'+_porEsc(f.fb)+'" aria-label="'+_porEsc(words)+'" onclick="window.porOpen(this.getAttribute(\'data-por\'))">'
    +porImageHTML(f.po,'tile')
    +'<span class="por-main">'
      +'<span class="por-l1"><span class="por-num">'+_porEsc(f.id)+'</span>'+(f.code?'<span class="por-code">'+_porEsc(f.code)+'</span>':'')+'<span class="por-name">'+_porEsc(f.name||'—')+'</span>'+_porBadges(f)+'</span>'
      +'<span class="por-l2"><span class="por-st '+_porStageChipClass(f.stage)+'">'+_porEsc(f.stageLabel)+'</span>'+(st.text?'<span class="por-sf '+st.cls+'">'+_porEsc(st.text)+'</span>':'')+'</span>'
      +'<span class="por-l3"><span class="por-qty">'+_porNum(f.ordered)+' ordered · '+_porNum(f.cut)+' cut · '+_porNum(f.received)+' received</span>'+bar+'<span class="por-steps">'+prog.done+' of '+prog.of+'</span></span>'
      +'<span class="por-l4">'+_porEsc(meta.join(' · '))+'</span>'
    +'</span><span class="por-arrow" aria-hidden="true">›</span></button>';
}

/* ── the page ─────────────────────────────────────────────────────────── */
function _porRows(model){
  let rows=porSelect(model,_porState);
  if(_porState.need)rows=rows.filter(function(f){return f.needs.indexOf(_porState.need)>=0;});
  return rows;
}
function _porChipsHTML(model){
  const base=porSelect(model,{view:_porState.view,q:_porState.q,sort:_porState.sort});
  const counts={};
  base.forEach(function(f){f.needs.forEach(function(n){counts[n]=(counts[n]||0)+1;});});
  const ids=POR_NEEDS.map(function(n){return n.id;}).filter(function(id){return counts[id];});
  if(!ids.length)return'';
  return'<div class="por-chips" role="group" aria-label="Filter by what needs attention">'+ids.map(function(id){
    const on=_porState.need===id;
    return'<button type="button" class="por-chip'+(on?' on':'')+'" aria-pressed="'+(on?'true':'false')+'" data-need="'+_porEsc(id)+'" onclick="window.porNeed(this.getAttribute(\'data-need\'))">'+_porEsc(porNeedLabel(id))+' <b>'+counts[id]+'</b></button>';
  }).join('')+'</div>';
}
function _porCountLine(model,rows){
  const v=POR_VIEWS.filter(function(x){return x.id===_porState.view;})[0];
  const s=POR_SORTS.filter(function(x){return x.id===_porState.sort;})[0];
  const parts=[rows.length+' of '+model.total+' · '+(v?v.label:'')+' · sorted by '+(s?s.label.toLowerCase():'')];
  if(!_porCanSide())parts.push('marks and cut plans are read only for the Production Ops team');
  else if(_porSide.state==='loading')parts.push('reading marks and cut plans…');
  else{
    const bad=['marks','jobs'].filter(function(st){return typeof phGet==='function'&&!phGet(st).ok;});
    if(bad.length)parts.push((bad.indexOf('marks')>=0?'po_marks':'')+(bad.length===2?' and ':'')+(bad.indexOf('jobs')>=0?'po_cut_jobs':'')+' could not be read — holds and plans are not shown');
  }
  const failed=typeof _posLoadFailed!=='undefined'&&Array.isArray(_posLoadFailed)?_posLoadFailed:[];
  if(failed.indexOf('gatepasses')>=0)parts.push('gatepasses could not be read — fabric issue is not shown');
  if(typeof _posLoadAt==='number'){const m=Math.round((Date.now()-_posLoadAt)/60000);if(m>=10)parts.push('list read '+m+' min ago');}
  return parts.join(' · ');
}
function _porListHTML(model){
  const rows=_porRows(model);
  if(!rows.length){
    return model.total?'<div class="por-empty">No POs match. <button type="button" class="btn-sm" onclick="window.porClear()">Clear filters</button></div>'
      :'<div class="por-empty">No POs yet.'+(typeof session!=='undefined'&&session&&session.canPO?' <button type="button" class="btn-sm" onclick="window.showPage(\'po-create\')">New PO</button>':'')+'</div>';
  }
  const groups=porGroup(rows,_porState.group);
  let left=_porState.shown,html='';
  groups.forEach(function(g){
    const open=_porState.open[g.key]!==undefined?_porState.open[g.key]:!g.collapsed;
    if(g.key||g.label){
      html+='<button type="button" class="por-ghead" aria-expanded="'+(open?'true':'false')+'" data-g="'+_porEsc(g.key)+'" onclick="window.porGroupToggle(this.getAttribute(\'data-g\'))"><span class="por-gl">'+_porEsc(g.label)+'</span><span class="por-gn">'+g.rows.length+(g.rows.length===1?' PO':' POs')+' · '+g.ordered+' pcs ordered</span><span aria-hidden="true">'+(open?'▾':'▸')+'</span></button>';
    }
    if(!open)return;
    g.rows.forEach(function(f){if(left>0){html+=porRowHTML(f);left--;}});
  });
  const more=rows.length-_porState.shown;
  if(more>0)html+='<div class="por-more"><button type="button" class="btn-outline" onclick="window.porMore()">Show '+Math.min(POR_PAGE,more)+' more</button><span class="por-muted"> '+more+' not shown</span></div>';
  return html;
}
function _porToolsHTML(){
  const sel=function(id,list,val,fn,label){
    return'<label class="por-field"><span class="por-flabel">'+label+'</span><select id="'+id+'" onchange="window.'+fn+'(this.value)">'+list.map(function(o){return'<option value="'+o.id+'"'+(o.id===val?' selected':'')+'>'+_porEsc(o.label)+'</option>';}).join('')+'</select></label>';
  };
  return'<div class="por-tools">'
    +'<label class="por-field por-search"><span class="por-flabel">Search</span><input id="por-q" type="search" placeholder="Number, code, name, fabric, creator" value="'+_porEsc(_porState.q)+'" oninput="window.porSearch(this.value)" autocomplete="off"></label>'
    +sel('por-group',POR_GROUPS,_porState.group,'porSetGroup','Group')
    +sel('por-sort',POR_SORTS,_porState.sort,'porSetSort','Sort')
    +'</div>';
}
function _porViewsHTML(model){
  return'<div class="por-views" role="tablist" aria-label="Saved views">'+POR_VIEWS.map(function(v){
    const on=_porState.view===v.id;
    return'<button type="button" role="tab" class="por-view'+(on?' on':'')+'" aria-selected="'+(on?'true':'false')+'" data-view="'+v.id+'" onclick="window.porSetView(this.getAttribute(\'data-view\'))">'+_porEsc(v.label)+' <b>'+model.counts[v.id]+'</b></button>';
  }).join('')+'</div>';
}
function _porErrorHTML(){
  return'<div class="por-error" role="alert"><div class="por-error-t">PO list could not be read</div><div>pos: the read failed — check the firestore.rules block for pos and that the published rules match the repo.</div>'
    +'<button type="button" class="btn-sm" onclick="window.porRetry()">Retry</button></div>';
}
function _porBodyInner(){
  const st=_porPosState();
  if(st==='error')return _porErrorHTML();
  if(st==='loading')return'<div class="por-count">loading…</div>'+(typeof gvSkeleton==='function'?gvSkeleton():'');
  const model=porBuild();
  const rows=_porRows(model);
  return _porViewsHTML(model)+_porToolsHTML()+_porChipsHTML(model)
    +'<div class="por-count" id="por-count">'+_porEsc(_porCountLine(model,rows))+'</div>'
    +'<div class="por-list" id="por-list">'+_porListHTML(model)+'</div>'
    +(typeof porExportBarHTML==='function'?porExportBarHTML(rows):'');
}
// The Orders body (js/pos.js renderRegistry hands it over). Never deletes, never writes.
function porRegistryHTML(){
  if(porRestricted())return'<div class="por-empty" data-por-restricted="1">The PO Registry is not on your account. Your POs are in <b>Production Ops ▸ Afloat POs</b>.</div>';
  _porRestore();
  if(_porPosState()==='ok')setTimeout(_porSideEnsure,0);
  return'<div class="por-wrap" id="por-body">'+_porBodyInner()+'</div>';
}
// Repaint the body in place (wherever it is mounted: the classic page or Kashif's hosted tab).
function _porRepaint(){
  if(typeof document==='undefined')return;
  const b=document.getElementById('por-body');if(!b)return;
  b.innerHTML=_porBodyInner();
}
// Repaint only the list, count and chips (a keystroke must not rebuild the search box the caret is in).
function _porRepaintList(){
  if(typeof document==='undefined')return;
  const l=document.getElementById('por-list');if(!l){_porRepaint();return;}
  const model=porBuild(),rows=_porRows(model);
  l.innerHTML=_porListHTML(model);
  const c=document.getElementById('por-count');if(c)c.textContent=_porCountLine(model,rows);
}

/* ── handlers ─────────────────────────────────────────────────────────── */
function _porKeyOk(fb){return typeof fb==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(fb);}
if(typeof window!=='undefined'){
  // porRegistryHTML, porRowHTML and porImgNext are top-level functions, so the browser already has them on window; they are
  // deliberately NOT reassigned here (a window.X= handler named after a top-level function replaced it once: The Board's freeze).
  window.porOpen=function(fb){if(!_porKeyOk(fb))return;if(typeof window.openPODetail==='function')window.openPODetail(fb);};
  window.porSetView=function(v){if(!POR_VIEWS.some(function(x){return x.id===v;}))return;_porState.view=v;_porState.need='';_porState.shown=POR_PAGE;_porSave();_porRepaint();};
  window.porSetSort=function(v){if(!POR_SORTS.some(function(x){return x.id===v;}))return;_porState.sort=v;_porState.shown=POR_PAGE;_porSave();_porRepaintList();};
  window.porSetGroup=function(v){if(!POR_GROUPS.some(function(x){return x.id===v;}))return;_porState.group=v;_porState.shown=POR_PAGE;_porState.open={};_porSave();_porRepaintList();};
  window.porNeed=function(id){_porState.need=_porState.need===id?'':(POR_NEEDS.some(function(n){return n.id===id;})?id:'');_porState.shown=POR_PAGE;_porRepaint();};
  window.porSearch=function(q){
    _porState.q=String(q==null?'':q).slice(0,80);_porState.shown=POR_PAGE;
    if(_porQTimer)clearTimeout(_porQTimer);
    _porQTimer=setTimeout(function(){_porQTimer=null;_porRepaintList();},180);
  };
  window.porMore=function(){_porState.shown+=POR_PAGE;_porRepaintList();};
  window.porGroupToggle=function(k){
    const model=porBuild(),g=porGroup(_porRows(model),_porState.group).filter(function(x){return x.key===k;})[0];
    const cur=_porState.open[k]!==undefined?_porState.open[k]:!(g&&g.collapsed);
    _porState.open[k]=!cur;_porRepaintList();
  };
  window.porClear=function(){_porState.q='';_porState.need='';_porState.shown=POR_PAGE;_porRepaint();};
  window.porRetry=function(){if(typeof loadData==='function')loadData();};
}

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

// RG5: the same row for ONE PO document, for the lists outside the registry (Dashboard "Recent production orders", All Active
// Orders). js/pos.js poRowHTML() hands over to it behind `typeof` (try/catch), so those lists change with no edit of their own.
function _porIdxNow(){
  const failed=typeof _posLoadFailed!=='undefined'&&Array.isArray(_posLoadFailed)?_posLoadFailed:[];
  const passes=typeof allPasses!=='undefined'&&Array.isArray(allPasses)&&failed.indexOf('gatepasses')<0?allPasses:null;
  return porIndexCached({passes:passes,marks:_porSideRows('marks'),jobs:_porSideRows('jobs')});
}
function porRowForPO(po){
  const S=_porSettings(),now=Date.now();
  const f=porFacts(po,_porIdxNow(),{now:now});
  f.progress=porProgress(f);f.age=porAge(f,now);f.delay=porDelay(f,{now:now});f.needs=porNeeds(f,{now:now,stuckDays:S.stuckDays,noFabricDays:S.noFabricDays});
  return'<div class="por-list por-solo">'+porRowHTML(f)+'</div>';
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

/* ══ RG4: the PO detail BODY — a timeline built from fields and collections that already exist ═════════════════════════
   js/pos.js renderDetailPage() keeps its header, actions, banners and every slot other modules hang on it, and hands the BODY
   below them to porDetailBodyHTML(po) behind `typeof` (try/catch: the old body is drawn if this throws). After the page is in
   the document it calls porDetailAfter(po), which reads the PO's bundles once (one where('poId','==',id) query, bounded) and
   repaints the body. Nothing new is stored. The stage list is the REAL flow (cutting → bundling → stitching → printing →
   washing → qc), never the display order. Photos are collapsed under the timeline (owner, Oct 2026). */
const POR_BUNDLES_LIMIT=500;
const POR_READ_MS=20000;
let _porDet={id:null,bundles:{state:'idle',rows:null,text:''},hist:{state:'idle',rows:null,text:''}};

function _porDayOf(x){const d=porDay(x);return d?_porDayShort(d)+' '+d.slice(0,4):'';}
function _porTlItem(state,label,lines,actions){
  return'<li class="por-tl-i por-tl-'+state+'"><span class="por-tl-dot" aria-hidden="true"></span><span class="por-tl-b"><span class="por-tl-h"><b>'+_porEsc(label)+'</b>'
    +'<span class="por-sr">'+(state==='done'?' (done)':state==='cur'?' (now)':state==='bad'?' (needs a look)':' (not yet)')+'</span></span>'
    +(lines||[]).filter(Boolean).map(function(l){return'<span class="por-tl-l">'+_porEsc(l)+'</span>';}).join('')
    +(actions?'<span class="por-tl-a">'+actions+'</span>':'')+'</span></li>';
}
function _porStageActions(po,key){
  if(po.currentStage!==key)return'';
  const fb=String(po.fbKey||'').replace(/[^A-Za-z0-9_-]/g,'');
  const st=typeof session!=='undefined'&&session&&Array.isArray(session.stages)?session.stages:[];
  const canUpdate=st.indexOf(key)>=0;
  const mgr=['owner','manager'].indexOf(_porRole())>=0;
  let a='';
  if(canUpdate)a+='<button type="button" class="mark-done-btn por-act" onclick="window.openStageWork(\''+fb+'\',\''+key+'\')">Go to stage</button>';
  if(mgr&&!canUpdate)a+='<button type="button" class="btn-sm por-act" onclick="window.ownerAdvance(\''+fb+'\',\''+key+'\')">Force advance</button>';
  if(key==='cutting'&&typeof _poCutCanOverride==='function'&&_poCutCanOverride()&&!(po.stages&&po.stages.cutting&&po.stages.cutting.done))
    a+='<button type="button" class="btn-sm por-act" onclick="window.poCutOverride(\''+fb+'\')">'+(po.cutOverride&&po.cutOverride.by?'Cut variance approved ✓':'Approve cut variance')+'</button>';
  return a;
}
function _porStageDone(po,key){return!!(po.stages&&po.stages[key]&&po.stages[key].done);}
function _porStageBy(po,key){const s=po.stages&&po.stages[key];return s?[s.doneAt?_porDayOf(s.doneAt):'',s.doneBy?'by '+s.doneBy:''].filter(Boolean).join(' '):'';}
function _porTimelineHTML(po,f){
  const items=[];
  const order=POR_REAL_STAGES;
  const si=order.indexOf(f.stage),done=f.stage==='completed';
  const past=function(k){const i=order.indexOf(k);return done||(si>i&&i>=0);};
  const stateOf=function(k){return past(k)||_porStageDone(po,k)?'done':f.stage===k?'cur':'todo';};
  items.push(_porTlItem('done','Created',[[f.createdDay?_porDayOf(f.createdDay):'',f.creator?'by '+f.creator:''].filter(Boolean).join(' ')]));
  if(f.stage==='reserved')items.push(_porTlItem('cur','Released',['not released — a legacy reserve order']));
  else items.push(_porTlItem(f.releaseMs!==null||si>=0||done?'done':'todo','Released',[f.releaseMs!==null?_porDayOf(f.releaseMs)+(po.releasedBy?' by '+po.releasedBy:''):(si>=0||done?'date not recorded':'')]));
  if(f.fabric.state==='unread')items.push(_porTlItem('todo','Fabric issued',['gatepasses: not read']));
  else if(f.fabric.state==='none')items.push(_porTlItem(f.stage==='cutting'||past('cutting')?'bad':'todo','Fabric issued',[past('cutting')?'no fabric issue matched to this PO':'not issued yet']));
  else items.push(_porTlItem('done','Fabric issued',f.fabric.passes.map(function(g){
    const w=Number(g.totalWeight!=null?g.totalWeight:g.fabricQty);
    return[String(g.id||''),g.date?_porDayShort(String(g.date)):'',String(g.cutMaster||'').trim(),isFinite(w)&&w>0?w+' '+(g.fabricUnit||'kg'):''].filter(Boolean).join(' · ');
  })));
  const cutLines=[];
  if(f.cut!==null){
    cutLines.push(_porDayOf(f.cutMs)+(po.cutBy?' by '+po.cutBy:'')+' · '+f.cut+' pcs'+(Array.isArray(po.bundleIds)?' · '+po.bundleIds.length+' bundles':''));
    if(f.cutOverride)cutLines.push('outside the gate, approved'+(po.cutOverride.by?' by '+po.cutOverride.by:''));
    else if(f.ordered){const r=f.cut/f.ordered;cutLines.push(r<POR_DEFAULTS.gateMin||r>POR_DEFAULTS.gateMax?'outside the gate ('+Math.round(r*100)+'% of ordered)':'inside the gate');}
  }else cutLines.push(f.stage==='cutting'?'cut not recorded yet':past('cutting')?'no cut recorded on the PO':'');
  items.push(_porTlItem(f.cut!==null||past('cutting')?'done':stateOf('cutting'),'Cut',cutLines,_porStageActions(po,'cutting')));
  // Embellishment job: only when the PO needs one AND a printing job exists for it.
  if(f.embRequired&&typeof allPrintingJobs!=='undefined'&&Array.isArray(allPrintingJobs)){
    const jobs=allPrintingJobs.filter(function(j){return j&&(j.poNumber===po.id||j.poId===po.id);});
    if(jobs.length)items.push(_porTlItem('done','Embellishment job',jobs.map(function(j){return'stage: '+String(j.currentStage||'unknown').replace(/_/g,' ');})));
  }
  const dmg=po.damageSummary&&typeof po.damageSummary==='object'?po.damageSummary:null;
  items.push(_porTlItem(stateOf('bundling'),'Bundling',[_porStageBy(po,'bundling'),dmg?dmg.total+' damaged'+(dmg.bySize?' ('+Object.keys(dmg.bySize).filter(function(k){return dmg.bySize[k]>0;}).map(function(k){return k+' '+dmg.bySize[k];}).join(', ')+')':'')+(typeof po.damagePercent==='number'?' · '+po.damagePercent.toFixed(1)+'%':''):''],_porStageActions(po,'bundling')));
  const B=_porDet.id===po.id?_porDet.bundles:{state:'idle'};
  const bl=B.state==='ok'?B.rows.length+' bundles, '+B.rows.filter(function(b){return b&&b.stitchingDone===true;}).length+' stitched':B.state==='error'?'bundles: could not be read':B.state==='loading'?'reading bundles…':'';
  items.push(_porTlItem(stateOf('stitching'),'Stitching',[_porStageBy(po,'stitching'),f.stage==='stitching'||past('stitching')?bl:''],_porStageActions(po,'stitching')));
  items.push(_porTlItem(stateOf('printing'),'Printing',[_porStageBy(po,'printing')],_porStageActions(po,'printing')));
  items.push(_porTlItem(stateOf('washing'),'Washing',[_porStageBy(po,'washing')],_porStageActions(po,'washing')));
  items.push(_porTlItem(stateOf('qc'),'Final QC',[_porStageBy(po,'qc'),f.received!==null?'received '+f.received+(f.cut!==null?' of '+f.cut:''):''],_porStageActions(po,'qc')));
  if(f.stage==='cancelled')items.push(_porTlItem('bad','Cancelled',[f.age.words,f.cancelled&&f.cancelled.by?'by '+f.cancelled.by:'',f.cancelled&&f.cancelled.reason?'reason: '+f.cancelled.reason:'']));
  else items.push(_porTlItem(done?'done':'todo','Completed',[done?f.age.words:'']));
  return'<ol class="por-tl" aria-label="Production timeline, in the real order">'+items.join('')+'</ol>';
}
function _porSizesHTML(po){
  const B=_porDet.id===po.id?_porDet.bundles:{state:'idle'};
  const t=porSizeTable(po,B.state==='ok'?B.rows:null);
  const row=function(label,r){
    if(!r)return'';
    return'<tr><th scope="row">'+_porEsc(label)+'</th>'+t.sizes.map(function(sz){return'<td>'+_porNum(r[sz])+'</td>';}).join('')+'<td class="por-tot">'+_porNum(r.total)+'</td></tr>';
  };
  const note=B.state==='loading'?'reading bundles…':B.state==='error'?B.text:'';
  return'<div class="por-sizes-wrap"><table class="por-sizes"><thead><tr><th scope="col">Sizes</th>'+t.sizes.map(function(sz){return'<th scope="col">'+_porEsc(sz)+'</th>';}).join('')+'<th scope="col">Total</th></tr></thead><tbody>'
    +row('Ordered',t.ordered)+row('Cut',t.cut)+row('Bundles',t.bundles)+row('Stitched',t.stitched)+row('Received',t.received)+'</tbody></table></div>'
    +(t.ordered.total!==null&&typeof po.qty==='number'&&po.qty!==t.ordered.total?'<div class="por-note por-warn">The PO quantity is '+_porEsc(po.qty)+' but the sizes add to '+t.ordered.total+'.</div>':'')
    +(note?'<div class="por-note">'+_porEsc(note)+'</div>':'');
}
function _porMoreHTML(po,f){
  const parts=[];
  const pl=Array.isArray(po.printLog)?po.printLog:[];
  if(pl.length){const l=pl[pl.length-1];parts.push('<li><b>Prints</b> '+pl.length+' · last '+_porEsc(l&&l.stage||'')+' by '+_porEsc(l&&(l.byName||l.by)||'—')+(l&&l.at?' on '+_porEsc(_porDayOf(l.at)):'')+'</li>');}
  if(f.mark.state==='unread')parts.push('<li><b>Marks</b> '+(_porCanSide()?'po_marks: not read':'read only for the Production Ops team')+'</li>');
  else if(f.mark.state==='marked'){const m=[];if(f.mark.hold)m.push('on hold'+(f.mark.hold.reason?': '+f.mark.hold.reason:''));if(f.mark.priority)m.push(f.mark.priority+' priority');parts.push('<li><b>Marks</b> '+_porEsc(m.join(' · ')||'marked')+'</li>');}
  const jobs=typeof allPrintingJobs!=='undefined'&&Array.isArray(allPrintingJobs)?allPrintingJobs.filter(function(j){return j&&(j.poNumber===po.id||j.poId===po.id);}).length:null;
  const linked=[jobs===null?'':jobs+(jobs===1?' embellishment job':' embellishment jobs'),(Array.isArray(po.stockTransfers)?po.stockTransfers.length:0)+' stock transfers',(Array.isArray(po.packingReceipts)?po.packingReceipts.length:0)+' receipts'].filter(Boolean);
  parts.push('<li><b>Linked</b> '+_porEsc(linked.join(' · '))+'</li>');
  if(po.notes)parts.push('<li class="por-notes"><b>Notes</b> <span>'+_porEsc(po.notes)+'</span></li>');
  let hist='';
  if(_porCanSide()&&/^PO-\d{3,}$/.test(String(po.id||''))){
    const H=_porDet.id===po.id?_porDet.hist:{state:'idle'};
    hist='<div class="por-hist"><button type="button" class="btn-outline por-act" onclick="window.porHistory()">'+(H.state==='ok'?'History ('+H.rows.length+(H.truncated?'+':'')+')':'History ▸')+'</button>'
      +(H.state==='loading'?'<span class="por-note">reading…</span>':H.state==='error'?'<span class="por-note por-warn">'+_porEsc(H.text)+'</span>':'')
      +(H.state==='ok'?(H.rows.length?'<ul class="por-hist-l">'+H.rows.map(function(r){return'<li>'+_porEsc([r.at?_porDayOf(r.at):'',r.type||'',r.byName||r.by||'',r.reason||''].filter(Boolean).join(' · '))+'</li>';}).join('')+'</ul>':'<span class="por-note">no history rows</span>'):'')+'</div>';
  }
  return'<ul class="por-more-l">'+parts.join('')+'</ul>'+hist;
}
function _porPhotosHTML(po){
  const imgs=[['Front',po.imgFront],['Back',po.imgBack]].filter(function(x){return _porImgSafe(x[1]);});
  if(!imgs.length)return'<div class="por-note">No photos on this PO.</div>';
  const alt=[po.code,po.name].filter(Boolean).join(' — ')||po.id;
  return'<details class="por-photos"><summary>Photos ('+imgs.length+')</summary><div class="por-photo-g">'+imgs.map(function(x){
    return'<figure class="por-fig"><figcaption>'+x[0]+'</figcaption><img class="por-photo" src="'+_porEsc(_porImgSafe(x[1]))+'" alt="'+_porEsc(alt+' ('+x[0].toLowerCase()+')')+'" loading="lazy" referrerpolicy="no-referrer"></figure>';
  }).join('')+'</div></details>';
}
function _porDetailInner(po){
  const idx=_porIdxNow();
  const S=_porSettings();
  const f=porFacts(po,idx,{now:Date.now()});
  f.age=porAge(f,Date.now());f.progress=porProgress(f);f.needs=porNeeds(f,{now:Date.now(),stuckDays:S.stuckDays,noFabricDays:S.noFabricDays});f.delay=porDelay(f,{now:Date.now()});
  const fab=[po.fabric,po.fabricCode,po.totalRoll?po.totalRoll+(String(po.totalRoll)==='1'?' roll':' rolls'):'',f.fabric.weight!==null?f.fabric.weight+' kg issued':''].filter(Boolean).join(' · ');
  const head='<div class="por-sum">'+porImageHTML(po,'head')+'<div class="por-sum-b">'
    +'<div class="por-sum-l1"><span class="por-st '+_porStageChipClass(f.stage)+'">'+_porEsc(f.stageLabel)+'</span>'+(f.code?'<span class="por-code">'+_porEsc(f.code)+'</span>':'')+_porBadges(f)+'</div>'
    +'<div class="por-sum-name">'+_porEsc(f.name||'—')+'</div>'
    +'<div class="por-qty">'+_porNum(f.ordered)+' ordered · '+_porNum(f.cut)+' cut · '+_porNum(f.received)+' received</div>'
    +(fab?'<div class="por-l4">'+_porEsc(fab)+'</div>':'')
    +'<div class="por-l4">'+_porEsc([f.age.words,f.delay.words,f.season.key?(f.season.guess?'~':'')+f.season.label:'',f.embRequired?'embellishment required':'',po.pattern?'pattern '+po.pattern:''].filter(Boolean).join(' · '))+'</div>'
    +(f.needs.length?'<div class="por-sum-needs">'+f.needs.map(function(n){return'<span class="por-badge por-b-warn">'+_porEsc(porNeedLabel(n))+'</span>';}).join('')+'</div>':'')
    +'</div></div>';
  return'<div class="card por-card">'+head+'</div>'
    +'<div class="card por-card"><div class="card-title">Sizes</div>'+_porSizesHTML(po)+'</div>'
    +'<div class="card por-card"><div class="card-title">Timeline</div>'+_porTimelineHTML(po,f)+'</div>'
    +'<div class="card por-card"><div class="card-title">More</div>'+_porMoreHTML(po,f)+_porPhotosHTML(po)+'</div>';
}
function porDetailBodyHTML(po){
  if(!po||typeof po!=='object')return null;
  if(_porDet.id!==po.id)_porDet={id:po.id,bundles:{state:'idle',rows:null,text:''},hist:{state:'idle',rows:null,text:''}};
  return'<div class="por-det" id="por-detail">'+_porDetailInner(po)+'</div>';
}
function _porDetailRepaint(){
  if(typeof document==='undefined')return;
  const el=document.getElementById('por-detail');if(!el)return;
  const po=(typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:[]).filter(function(p){return p&&p.id===_porDet.id;})[0];
  if(po)el.innerHTML=_porDetailInner(po);
}
async function _porReadBundles(id){
  if(typeof getDocs!=='function'||typeof query!=='function'||typeof collection!=='function'||typeof db==='undefined')throw new Error('Firestore is not available');
  let t;
  const to=new Promise(function(_,rej){t=setTimeout(function(){const e=new Error('read timed out');e.code='timeout';rej(e);},POR_READ_MS);});
  try{
    const snap=await Promise.race([getDocs(query(collection(db,'bundles'),where('poId','==',id),limit(POR_BUNDLES_LIMIT))),to]);
    if(snap&&snap.metadata&&snap.metadata.fromCache===true){const e=new Error('answered from this device\'s offline copy');e.code='from-cache';throw e;}
    return((snap&&snap.docs)||[]).map(function(d){return d.data();});
  }finally{clearTimeout(t);}
}
// After the detail is in the document: read this PO's bundles once (never rejects) and repaint the body.
function porDetailAfter(po){
  if(!po||_porDet.id!==po.id||_porDet.bundles.state!=='idle')return Promise.resolve(false);
  _porDet.bundles={state:'loading',rows:null,text:''};
  _porDetailRepaint();
  const id=po.id;
  return _porReadBundles(id).then(function(rows){
    if(_porDet.id!==id)return false;
    _porDet.bundles={state:'ok',rows:rows,text:''};_porDetailRepaint();return true;
  },function(e){
    if(_porDet.id!==id)return false;
    const perm=e&&(e.code==='permission-denied'||/permission/i.test(String(e.message)));
    _porDet.bundles={state:'error',rows:null,text:'bundles: could not be read'+(perm?' (permission denied)':e&&e.code==='from-cache'?' (only the offline copy answered)':e&&e.code==='timeout'?' (timed out)':'')};
    _porDetailRepaint();return false;
  });
}
if(typeof window!=='undefined'){
  window.porHistory=function(){
    if(!_porCanSide()||typeof phHistoryOf!=='function'||!_porDet.id)return;
    if(_porDet.hist.state==='loading')return;
    const id=_porDet.id;
    _porDet.hist={state:'loading',rows:null,text:''};_porDetailRepaint();
    phHistoryOf(id).then(function(r){
      if(_porDet.id!==id)return;
      _porDet.hist=r&&r.ok?{state:'ok',rows:r.rows||[],truncated:!!r.truncated,text:''}:{state:'error',rows:null,text:(r&&r.text)||'pos history: could not be read'};
      _porDetailRepaint();
    });
  };
}

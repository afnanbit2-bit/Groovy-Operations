/* ─────────────────────────────────────────────────────────────────────────
   js/ph-mod-drafts.js — Production Ops, module "PO Drafts" (PC-only entry), 12 Oct 2026.

   One global entry point: phDraftsPanel(host, ctx). The PO Queue tab calls it behind a typeof
   guard; this file registers NOTHING (no tab, no listener, no Escape guard, no route).
     host  an empty element the shell gave the tab.
     ctx   the shell's tab context: {user, canManage, readOnly, status, get(stage), el, clear,
           repaint(), reload()}. This module reads data through its own accessors (phGet etc.)
           and does not depend on any other ctx member.

   What it is: a list of PO drafts (po_drafts) and a PC-width form that captures the fields the
   classic New PO form captures, saved only through js/ph-write.js (phSaveDraft, phMarkDraftReady,
   phSendBackDraft, phAbandonDraft). Owner rule: PO entry is PC-only and COMPLETE before print.
     - COMPLETENESS GATE: "Mark ready" runs js/ph-core.js phPoComplete on the form first and is
       REFUSED with the missing fields named, before anything is written. ph-write.js runs the same
       gate again on the saved document (the writer is the boundary, this is the courtesy).
     - PC-ONLY: js/ph-core.js phIsPcOnly(userAgent, width) is a HEURISTIC. It reads what the browser
       says about itself, so it can be spoofed, an iPad presenting a desktop user agent in a wide
       window passes, and a narrow laptop window fails; the server cannot know the device. It is a
       guard against mistakes, not a security boundary, and the screen says so. Off a PC the form
       is READ-ONLY with an explanation. settings.pcOnlyHard (ph_settings/main) decides how firm:
         pcOnlyHard true   no override: nothing is written from this screen (writers are not called);
         pcOnlyHard false  a visible warning and an explicit "Edit anyway on this screen" button;
         setting unread    treated as true (fail closed) and said so.
     - ISSUING (14 Oct 2026): a READY draft is issued as a real PO by a MANAGER only (Afnan, Ammar,
       Mustafa), through js/ph-issue.js phIssueDraft (one transaction; this file writes nothing itself).
       The button is a two-step confirm; Kashif (uzaib) sees "Ready - waiting for Mustafa" and no button
       that works. An issued draft is read-only and says "Issued as PO-nnn". Issuing is not PC-only (it is
       a decision, not data entry). No PDF is made: the summary is a read-only panel.

   Rules held: writes only through ph-write.js, to po_drafts; nothing is read or shown as zero when its
   read failed (a failed or unread collection is named, never an empty list); PKT days; every stored
   string goes into the page through textContent / a value property (nothing here parses a string as
   HTML); tokens only (css/main.css `.phd-` block); 44px targets; globals are ph / _phd / PH_DRAFTS_
   prefixed (classic scripts share ONE lexical scope with ph-core / ph-data / ph-write / ph-ui).
   The form state survives a tab switch (it lives here, not in the DOM) but not a page reload.
   ───────────────────────────────────────────────────────────────────────── */

const PH_DRAFTS_TEXT_MAX=Object.freeze({code:40,name:200,pattern:80,fabric:120,fabricCode:60,store:80,totalRoll:40,notes:500});
const PH_DRAFTS_COPIES=Object.freeze([['embroidery','Embroidery'],['printing','Printing'],['washing','Washing']]);   // = js/pos.js _PO_JOBCOPY_KEYS / labels
const PH_DRAFTS_SEASONS=Object.freeze([['winter','Winter'],['summer','Summer'],['all','All-season']]);
const PH_DRAFTS_FILTERS=Object.freeze([['open','Open'],['draft','Draft'],['ready','Ready'],['issued','Issued'],['abandoned','Abandoned'],['all','All']]);
const PH_DRAFTS_MODELS=Object.freeze([['','Automatic (from the article code)'],['alpha','Alpha (XXXS to 2XL)'],['waist','Waist (26 to 40)'],['free','Free size']]);
const PH_DRAFTS_FIELD_LABELS=Object.freeze({code:'Article code',name:'Article name',sizes:'Sizes',qty:'Quantity',fabric:'Fabric',plannedFabricQty:'Planned fabric quantity',
  plannedFabricUnit:'Planned fabric unit',season:'Season',plannedCutDate:'Planned cut date',requestedDate:'Requested date',cutMaster:'Cutting master',draft:'Draft'});
const PH_DRAFTS_MONTHS=Object.freeze(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']);

/* ── state (module level: survives a tab switch, which re-renders the host) ─── */
let _phdHost=null,_phdView='list',_phdFilter='open',_phdForm=null,_phdNote=null,_phdBusy=false,_phdOverride=false,_phdLoading=false,_phdAsk=null,_phdRefs={},_phdLive={};

/* ── small helpers ───────────────────────────────────────────────────────── */
function _phdEl(tag,cls,text,kids){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!==undefined&&text!==null&&text!=='')n.textContent=String(text);
  if(kids)for(let i=0;i<kids.length;i++)if(kids[i])n.appendChild(kids[i]);
  return n;
}
function _phdClear(n){while(n&&n.firstChild)n.removeChild(n.firstChild);return n;}
function _phdBtn(cls,text,onclick,attrs){
  const b=_phdEl('button','ph-btn phd-btn '+(cls||''),text);b.setAttribute('type','button');
  if(attrs)Object.keys(attrs).forEach(function(k){b.setAttribute(k,attrs[k]);});
  if(onclick)b.addEventListener('click',onclick);
  return b;
}
function _phdOff(n){n.disabled=true;n.setAttribute('disabled','disabled');return n;}
function _phdSetVal(n,v){const s=v==null?'':String(v);n.value=s;if(String(n.tagName).toUpperCase()==='TEXTAREA')n.textContent=s;else n.setAttribute('value',s);}
function _phdUser(){return(typeof session!=='undefined'&&session&&typeof session.u==='string')?session.u:'';}
function _phdCanSee(){return typeof phCanSee==='function'&&phCanSee(_phdUser())===true;}
function _phdCanRecord(){return typeof phCanRecordFloor==='function'&&phCanRecordFloor(_phdUser())===true;}
function _phdCanManage(){return typeof phCanManage==='function'&&phCanManage(_phdUser())===true;}
function _phdToday(){return typeof phDay==='function'?phDay(Date.now()):null;}
function _phdDayLabel(day){
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return'';
  return+day.slice(8,10)+' '+PH_DRAFTS_MONTHS[+day.slice(5,7)-1]+' '+day.slice(0,4);
}
function _phdFmtList(items){return items.join(', ');}
function _phdLabel(field){return Object.prototype.hasOwnProperty.call(PH_DRAFTS_FIELD_LABELS,field)?PH_DRAFTS_FIELD_LABELS[field]:String(field);}

/* ── data access: honest, never an empty list for a failed read ─────────── */
function _phdGet(stage){return typeof phGet==='function'?phGet(stage):{ok:false,state:'unknown',rows:null,err:null,text:'js/ph-data.js did not load - refresh the page.'};}
function _phdMasters(){return typeof phMasterList==='function'?phMasterList():null;}   // null unless the registry was read
function _phdCatalog(){
  try{
    if(typeof getProductCatalog==='function')return getProductCatalog();   // js/pos.js: static catalog + custom products, as the classic form searches
    if(typeof PRODUCT_CATALOG!=='undefined'&&Array.isArray(PRODUCT_CATALOG))return PRODUCT_CATALOG;
  }catch(e){}
  return[];
}

/* ── PC-only (a heuristic, see the header) ───────────────────────────────── */
function _phdScreen(){
  let ua='',w=null;
  try{if(typeof navigator!=='undefined'&&navigator&&typeof navigator.userAgent==='string')ua=navigator.userAgent;}catch(e){}
  try{if(typeof window!=='undefined'&&window&&typeof window.innerWidth==='number')w=window.innerWidth;}catch(e){}
  return{ua:ua,width:w};
}
function _phdPcState(){
  const sc=_phdScreen();
  const isPc=typeof phIsPcOnly==='function'&&phIsPcOnly(sc.ua,sc.width)===true;
  let info=null;try{info=typeof phSettingsInfo==='function'?phSettingsInfo():null;}catch(e){info=null;}
  const known=!!(info&&info.known===true);
  const hardSet=!!(info&&info.pcOnlyHard===true);
  return{isPc:isPc,width:sc.width,known:known,hardSet:hardSet,hard:hardSet||!known};   // an unread setting is treated as hard: fail closed
}
// May this person write a draft from this screen right now? Checked again inside every action, so a read-only
// form is not merely cosmetic: with the hard rule on, no writer is ever called off a PC.
function _phdWriteCheck(){
  if(!_phdCanRecord())return{ok:false,kind:'role',why:'Your account is not on the Production Ops team, so it cannot write PO drafts.'};
  const pc=_phdPcState();
  if(pc.isPc)return{ok:true,kind:'pc'};
  if(pc.hard)return{ok:false,kind:'hard',why:pc.known
    ?'PO entry is PC-only and an owner has switched the hard rule on: nothing can be written from this screen.'
    :'PO entry is PC-only. The PC-only setting could not be read, so the hard rule is assumed: nothing can be written from this screen.'};
  if(_phdOverride)return{ok:true,kind:'override'};
  return{ok:false,kind:'soft',why:'PO entry is meant for a PC. This screen does not look like one, so the form is read-only.'};
}

/* ── the form model ──────────────────────────────────────────────────────── */
function _phdBlank(){
  return{code:'',name:'',pattern:'',qty:'',sizeModel:'',sizes:{},strays:{},fabric:'',fabricCode:'',store:'',totalRoll:'',plannedFabricQty:'',plannedFabricUnit:'',
    season:'',plannedCutDate:'',requestedDate:'',cutMasterId:'',cutMaster:'',embRequired:false,jobCopies:{embroidery:false,printing:false,washing:false},notes:''};
}
function _phdModel(f){return phSizeModel({sizeModel:f.sizeModel||undefined,code:String(f.code||'').trim().toUpperCase()});}
function _phdStr(x){return x==null?'':String(x);}
function _phdFromPo(po){
  const p=po&&typeof po==='object'&&!Array.isArray(po)?po:{};
  const f=_phdBlank();
  const fn=p.fabricNeed&&typeof p.fabricNeed==='object'?p.fabricNeed:{};
  f.code=_phdStr(p.code);f.name=_phdStr(p.name);f.pattern=_phdStr(p.pattern);
  f.qty=p.qty==null?'':String(p.qty);
  f.sizeModel=typeof p.sizeModel==='string'&&['alpha','waist','free'].indexOf(p.sizeModel)>-1?p.sizeModel:'';
  f.fabric=_phdStr(p.fabric);f.fabricCode=_phdStr(p.fabricCode);f.store=_phdStr(p.store);f.totalRoll=_phdStr(p.totalRoll);
  const pq=p.plannedFabricQty!=null?p.plannedFabricQty:fn.qty,pu=p.plannedFabricUnit!=null?p.plannedFabricUnit:fn.unit;
  f.plannedFabricQty=pq==null?'':String(pq);
  f.plannedFabricUnit=(typeof phUnit==='function'&&phUnit(pu))||'';
  f.season=PH_DRAFTS_SEASONS.some(function(s){return s[0]===p.season;})?p.season:'';
  f.plannedCutDate=typeof p.plannedCutDate==='string'?p.plannedCutDate:'';
  f.requestedDate=typeof p.requestedDate==='string'?p.requestedDate:'';
  f.cutMasterId=_phdStr(p.cutMasterId);f.cutMaster=_phdStr(p.cutMaster!=null?p.cutMaster:p.cutMasterName);
  f.embRequired=!!(p.embellishment&&p.embellishment.required===true);
  PH_DRAFTS_COPIES.forEach(function(c){f.jobCopies[c[0]]=!!(p.jobCopies&&p.jobCopies[c[0]]===true);});
  f.notes=_phdStr(p.notes);
  // stored sizes: a key that is a size of the article's axis (XXL reads as 2XL) goes into the grid; any other is a stray, kept visible
  const m=_phdModel(f);
  if(p.sizes&&typeof p.sizes==='object'&&!Array.isArray(p.sizes)){
    Object.keys(p.sizes).forEach(function(k){
      const key=phSizeKey(m.model,k);
      if(key!==null)f.sizes[key]=String(p.sizes[k]);else f.strays[k]=String(p.sizes[k]);
    });
  }
  return f;
}
// form -> the po map to store, plus anything typed that could not be understood (named; never quietly stored as something else)
function _phdToPo(f){
  const problems=[];
  const m=_phdModel(f);
  const sizes={};
  m.keys.forEach(function(k){
    const raw=f.sizes[k];
    if(raw===undefined||raw===null||String(raw).trim()==='')return;
    const q=phWhole(raw);
    if(q===null||q<0){problems.push({field:'sizes',why:k+': "'+String(raw).trim().slice(0,12)+'" is not a whole number of pieces'});return;}
    if(q>0)sizes[k]=q;
  });
  let qty=null;
  if(String(f.qty).trim()!==''){
    qty=phWhole(f.qty);
    if(qty===null||qty<0){problems.push({field:'qty',why:'the quantity "'+String(f.qty).trim().slice(0,12)+'" is not a whole number of pieces'});qty=null;}
  }
  let pfq=null;
  if(String(f.plannedFabricQty).trim()!==''){
    pfq=phNum(f.plannedFabricQty);
    if(pfq===null){problems.push({field:'plannedFabricQty',why:'the planned fabric quantity "'+String(f.plannedFabricQty).trim().slice(0,12)+'" is not a number'});}
  }
  const day=function(field,raw){
    const s=String(raw||'').trim();
    if(!s)return null;
    if(!phIsDay(s)){problems.push({field:field,why:_phdLabel(field).toLowerCase()+' "'+s.slice(0,12)+'" is not a date (YYYY-MM-DD)'});return null;}
    return s;
  };
  const pcd=day('plannedCutDate',f.plannedCutDate),rqd=day('requestedDate',f.requestedDate);
  const ratioKeys=m.keys.filter(function(k){return sizes[k]>0;});
  const minQ=ratioKeys.length?Math.min.apply(null,ratioKeys.map(function(k){return sizes[k];})):0;
  const T=PH_DRAFTS_TEXT_MAX;
  const cut=function(s,n){return String(s==null?'':s).replace(/\s+/g,' ').trim().slice(0,n);};
  const po={
    code:cut(f.code,T.code).toUpperCase(),name:cut(f.name,T.name),pattern:cut(f.pattern,T.pattern),
    qty:qty,sizes:sizes,ratio:minQ?ratioKeys.map(function(k){return Math.round(sizes[k]/minQ);}).join(':'):'',
    fabric:cut(f.fabric,T.fabric),fabricCode:cut(f.fabricCode,T.fabricCode),store:cut(f.store,T.store),totalRoll:cut(f.totalRoll,T.totalRoll),
    plannedFabricQty:pfq,plannedFabricUnit:(typeof phUnit==='function'?phUnit(f.plannedFabricUnit):null),
    season:PH_DRAFTS_SEASONS.some(function(s){return s[0]===f.season;})?f.season:'',
    plannedCutDate:pcd,requestedDate:rqd,
    cutMasterId:cut(f.cutMasterId,20),cutMaster:cut(f.cutMaster,40),
    embellishment:{required:!!f.embRequired},
    jobCopies:{embroidery:!!f.jobCopies.embroidery,printing:!!f.jobCopies.printing,washing:!!f.jobCopies.washing},
    notes:String(f.notes==null?'':f.notes).trim().slice(0,T.notes)
  };
  if(f.sizeModel)po.sizeModel=f.sizeModel;
  const dropped=Object.keys(f.strays||{}).length+Object.keys(f.sizes).filter(function(k){return m.keys.indexOf(k)<0&&String(f.sizes[k]).trim()!==''&&phWhole(f.sizes[k])>0;}).length;
  return{po:po,problems:problems,model:m,dropped:dropped};
}
// The completeness gate (js/ph-core.js phPoComplete) over the loaded master registry. The registry null (not read) is passed through:
// the core then reports that the master cannot be checked, which is a refusal, never a pass.
function _phdGate(po){return phPoComplete(po,{masters:_phdMasters(),today:_phdToday()});}

/* ── paint ────────────────────────────────────────────────────────────────── */
function phDraftsPanel(host,ctx){
  if(!host||typeof document==='undefined')return;
  _phdHost=host;
  if(_phdForm&&_phdForm.owner!==_phdUser()){_phdForm=null;_phdView='list';_phdNote=null;_phdAsk=null;_phdOverride=false;}   // another person on this page load: nothing carries over
  _phdPaint();
}
function _phdErrCard(title,msg){
  const c=_phdEl('section','ph-card ph-card-err phd-card');c.setAttribute('role','alert');
  c.appendChild(_phdEl('h3','ph-card-title',title));
  c.appendChild(_phdEl('p','ph-note',msg));
  return c;
}
function _phdPaint(){
  const host=_phdHost;if(!host)return;
  _phdClear(host);_phdRefs={};_phdLive={};
  const wrap=_phdEl('div','phd-root');
  host.appendChild(wrap);
  try{
    if(!_phdCanSee()){wrap.appendChild(_phdErrCard('No access','PO drafts are for the Production Ops team (Afnan, Ammar, Mustafa and Uzaib).'));return;}
    if(typeof phGet!=='function'||typeof phPoComplete!=='function'||typeof phSaveDraft!=='function'){
      wrap.appendChild(_phdErrCard('Production Ops code did not load','js/ph-core.js, js/ph-data.js or js/ph-write.js is missing - refresh the page.'));return;
    }
    if(_phdView==='form'&&_phdForm)_phdPaintForm(wrap);else{_phdView='list';_phdPaintList(wrap);}
  }catch(e){
    _phdClear(wrap);
    wrap.appendChild(_phdErrCard('PO drafts could not be drawn',String(e&&e.message||e)));
    if(typeof console!=='undefined')console.warn('[ph-mod-drafts] paint failed:',e);
  }
}
function _phdSetNote(kind,text,extra){_phdNote=text?{kind:kind,text:text,extra:extra||null}:null;}
function _phdNoteNode(){
  if(!_phdNote)return null;
  const n=_phdNote;
  const c=_phdEl('section','ph-card phd-card phd-note phd-note-'+n.kind);
  c.setAttribute('role',n.kind==='err'?'alert':'status');
  c.appendChild(_phdEl('p','ph-note',n.text));
  if(n.extra&&n.extra.code==='stale')c.appendChild(_phdBtn('',('Reload the latest copy'),function(){_phdReloadLatest();}));
  return c;
}
// the PC-only banner for the current screen (null on a PC)
function _phdPcBanner(){
  const pc=_phdPcState();
  if(pc.isPc)return null;
  const wc=_phdWriteCheck();
  const w=pc.width==null?'unknown':String(pc.width)+' px';
  const c=_phdEl('section','ph-card phd-card phd-pc '+(pc.hard?'phd-pc-hard':'phd-pc-soft'));
  c.setAttribute('role',pc.hard?'alert':'status');
  c.appendChild(_phdEl('h3','ph-card-title',pc.hard?'PO entry is PC-only - this screen is read-only':'This does not look like a PC screen'));
  if(pc.hard){
    c.appendChild(_phdEl('p','ph-note',pc.known
      ?'An owner has switched on the hard PC-only rule. This screen (width '+w+') does not look like a PC, so you can read drafts here but nothing can be written. Open Production Ops on a PC.'
      :'The PC-only setting could not be read, so the strict rule is assumed. This screen (width '+w+') does not look like a PC: read-only. Open Production Ops on a PC, or retry the settings read.'));
  }else if(wc.kind==='override'){
    c.appendChild(_phdEl('p','ph-note','Warning: you are editing on a screen that does not look like a PC (width '+w+'). PO entry is meant for a PC. Everything you save is recorded as entered on a PC, so check it carefully.'));
  }else{
    c.appendChild(_phdEl('p','ph-note','PO entry is meant for a PC (a screen at least 1024 px wide). This screen (width '+w+') is read-only. If your window is just narrow, widen it - or edit anyway on this screen.'));
    if(_phdCanRecord())c.appendChild(_phdBtn('',"Edit anyway on this screen",function(){_phdOverride=true;_phdSetNote(null);_phdPaint();}));
  }
  c.appendChild(_phdEl('p','phd-fine','This check reads the browser\'s user agent and window width. It is a guard against mistakes, not a security boundary: it can be wrong and it can be faked, and the server cannot tell what device wrote a draft.'));
  return c;
}
function _phdHeader(title,sub,chips,btns){
  const h=_phdEl('header','ph-head phd-head');
  const row=_phdEl('div','ph-head-row',null,[_phdEl('h2','ph-title',title)]);
  (chips||[]).forEach(function(c){row.appendChild(c);});
  h.appendChild(row);
  if(sub)h.appendChild(_phdEl('p','ph-blurb',sub));
  if(btns&&btns.length){const b=_phdEl('div','phd-head-btns');btns.forEach(function(x){b.appendChild(x);});h.appendChild(b);}
  return h;
}
function _phdChip(text,kind){return _phdEl('span','ph-chip'+(kind?' ph-chip-'+kind:''),text);}

/* ═══ the list ═══════════════════════════════════════════════════════════ */
function _phdSortRows(rows){
  return rows.slice().sort(function(a,b){const x=Number(a.updatedAt)||0,y=Number(b.updatedAt)||0;return y-x||(a.fbKey<b.fbKey?-1:a.fbKey>b.fbKey?1:0);});
}
function _phdRowStatus(r){return typeof r.status==='string'&&r.status?r.status:'unknown';}
function _phdStatusChip(s){return _phdChip(s,s==='ready'||s==='issued'?'ok':s==='abandoned'?'bad':'view');}
function _phdPaintList(wrap){
  const g=_phdGet('drafts');
  const wc=_phdWriteCheck();
  const newBtn=_phdBtn('ph-btn-primary','New draft',function(){_phdNew();},{'data-act':'new'});
  if(!wc.ok){_phdOff(newBtn);newBtn.setAttribute('title',wc.why);}
  wrap.appendChild(_phdHeader('PO Drafts','PC-only entry. A draft is complete before it is marked ready; a ready draft is issued as a PO by a manager (Mustafa, Afnan or Ammar).',[_phdChip('PC-only entry','view')],[newBtn]));
  const banner=_phdPcBanner();if(banner)wrap.appendChild(banner);
  const nn=_phdNoteNode();if(nn)wrap.appendChild(nn);
  if(_phdLoading){const s=_phdEl('section','ph-card phd-card');s.setAttribute('role','status');s.appendChild(_phdEl('p','ph-note','Reading po_drafts…'));wrap.appendChild(s);return;}
  if(!g.ok){
    const c=_phdErrCard('PO drafts could not be read',(g.text||'po_drafts: not loaded.')+' Nothing below is shown as "no drafts": the list was not read.');
    c.appendChild(_phdBtn('ph-btn-primary','Retry',function(){_phdRetryDrafts();}));
    wrap.appendChild(c);
    return;
  }
  const rows=_phdSortRows(g.rows||[]);
  const count=function(s){return rows.filter(function(r){return s==='all'?true:s==='open'?(_phdRowStatus(r)==='draft'||_phdRowStatus(r)==='ready'):_phdRowStatus(r)===s;}).length;};
  const bar=_phdEl('div','phd-filters');bar.setAttribute('role','group');bar.setAttribute('aria-label','Filter drafts by status');
  PH_DRAFTS_FILTERS.forEach(function(fl){
    const b=_phdBtn('phd-filter'+(_phdFilter===fl[0]?' on':''),fl[1]+' '+count(fl[0]),function(){_phdFilter=fl[0];_phdPaint();},{'aria-pressed':_phdFilter===fl[0]?'true':'false','data-filter':fl[0]});
    bar.appendChild(b);
  });
  wrap.appendChild(bar);
  if(g.truncated)wrap.appendChild(_phdEl('p','phd-fine','The list was cut at its read limit ('+rows.length+' drafts): older drafts are not shown.'));
  const shown=rows.filter(function(r){const s=_phdRowStatus(r);return _phdFilter==='all'?true:_phdFilter==='open'?(s==='draft'||s==='ready'):s===_phdFilter;});
  if(!rows.length){wrap.appendChild(_phdEl('p','ph-placeholder','po_drafts was read and holds no drafts yet.'));return;}
  if(!shown.length){wrap.appendChild(_phdEl('p','ph-placeholder','No draft is '+(_phdFilter==='open'?'open':_phdFilter)+'.'));return;}
  const masters=_phdMasters();
  const list=_phdEl('ul','ph-lines phd-list');
  shown.forEach(function(r){list.appendChild(_phdRowNode(r,masters));});
  wrap.appendChild(_phdEl('section','ph-card phd-card',null,[list]));
  if(masters===null)wrap.appendChild(_phdEl('p','phd-fine','The cutting masters were not read, so completeness is shown as "not checked".'));
}
function _phdRowNode(r,masters){
  const po=r.po&&typeof r.po==='object'?r.po:{};
  const li=_phdEl('li','ph-line phd-row');
  const code=_phdStr(po.code),name=_phdStr(po.name);
  const main=_phdEl('div','phd-row-main');
  main.appendChild(_phdEl('div','phd-row-title',code||name?(code+(code&&name?' - ':'')+name):'(no article chosen yet)'));
  const upd=typeof phDay==='function'?phDay(r.updatedAt):null;
  const qty=phWhole(po.qty);
  main.appendChild(_phdEl('div','phd-row-sub',[r.fbKey,qty?qty+' pcs':'quantity not set','revision '+(r.rev==null?'?':r.rev),upd?'updated '+_phdDayLabel(upd)+(r.updatedBy?' by '+r.updatedBy:''):''].filter(Boolean).join(' · ')));
  li.appendChild(main);
  const chips=_phdEl('div','phd-row-chips');
  const st=_phdRowStatus(r);
  chips.appendChild(_phdStatusChip(st));
  if(st==='issued'&&r.poId)chips.appendChild(_phdChip('Issued as '+r.poId,'ok'));
  if(st==='ready'&&!_phdCanManage())chips.appendChild(_phdChip('Ready - waiting for Mustafa','wait'));
  if(st==='draft'||st==='ready'){
    if(masters===null)chips.appendChild(_phdChip('not checked','wait'));
    else{const gate=phPoComplete(po,{masters:masters,today:_phdToday()});chips.appendChild(gate.ok?_phdChip('Complete','ok'):_phdChip(gate.missing.length+' missing','bad'));}
  }
  li.appendChild(chips);
  li.appendChild(_phdBtn('',st==='draft'&&_phdWriteCheck().ok?'Open':'View',function(){_phdOpen(r.fbKey);},{'data-open':r.fbKey,'aria-label':'Open draft '+r.fbKey}));
  return li;
}
function _phdRetryDrafts(){
  _phdLoading=true;_phdPaint();
  const done=function(){_phdLoading=false;_phdPaint();};
  try{
    Promise.resolve(typeof phLoadStage==='function'?phLoadStage('drafts',{force:true}):null).then(done,done);   // phLoadStage never rejects; the second handler is belt and braces
  }catch(e){done();}
}
function _phdReloadLatest(){
  const f=_phdForm;if(!f||!f.id)return;
  const id=f.id;_phdLoading=true;
  const done=function(){_phdLoading=false;_phdOpen(id);};
  try{Promise.resolve(typeof phLoadStage==='function'?phLoadStage('drafts',{force:true}):null).then(done,done);}catch(e){done();}
}

/* ═══ opening, creating, leaving ═════════════════════════════════════════ */
function _phdNew(){
  const wc=_phdWriteCheck();
  if(!wc.ok){_phdSetNote('err',wc.why);_phdPaint();return false;}
  _phdForm={id:null,rev:0,status:'draft',owner:_phdUser(),f:_phdBlank(),dirty:false,seq:0,meta:null};
  _phdView='form';_phdNote=null;_phdAsk=null;_phdPaint();return true;
}
function _phdOpen(id){
  const g=_phdGet('drafts');
  const row=g.ok&&Array.isArray(g.rows)?g.rows.filter(function(r){return r.fbKey===id;})[0]:null;
  if(!row){_phdSetNote('err','Draft '+id+' is not in the list that was read. Retry the read.');_phdView='list';_phdPaint();return false;}
  _phdForm={id:row.fbKey,rev:row.rev,status:_phdRowStatus(row),owner:_phdUser(),f:_phdFromPo(row.po),dirty:false,seq:0,
    meta:{createdByName:row.createdByName||row.createdBy||'',createdAt:row.createdAt,updatedBy:row.updatedBy||'',updatedAt:row.updatedAt,
      sentBackReason:row.sentBackReason||'',abandonedReason:row.abandonedReason||'',poId:row.poId||'',issuedBy:row.issuedBy||'',issuedAt:row.issuedAt||null}};
  _phdView='form';_phdNote=null;_phdAsk=null;_phdPaint();return true;
}
function _phdBack(force){
  if(_phdForm&&_phdForm.dirty&&!force){_phdAsk={kind:'leave'};_phdPaint();return;}
  _phdForm=null;_phdView='list';_phdAsk=null;_phdPaint();
}

/* ═══ the form ═══════════════════════════════════════════════════════════ */
function _phdEditable(){return!!_phdForm&&_phdForm.status==='draft'&&_phdWriteCheck().ok;}
function _phdWhyReadOnly(){
  const f=_phdForm;if(!f)return'';
  if(f.status==='ready')return'This draft is READY: it is locked, waiting for a manager to issue it as a PO. A manager can send it back to draft to edit it.';
  if(f.status==='issued')return'This draft was issued as '+(f.meta&&f.meta.poId?f.meta.poId:'a PO')+'. It is final and cannot be edited.';
  if(f.status==='abandoned')return'This draft was abandoned'+(f.meta&&f.meta.abandonedReason?' ('+f.meta.abandonedReason+')':'')+'. It is kept for the record and cannot be edited.';
  if(f.status!=='draft')return'This draft is '+f.status+' and cannot be edited here.';
  const wc=_phdWriteCheck();
  return wc.ok?'':wc.why;
}
function _phdTouch(){const f=_phdForm;if(!f)return;f.dirty=true;f.seq++;_phdUpdateLive();}
function _phdFieldWrap(key,label,input,hint,cls){
  const w=_phdEl('div','phd-field'+(cls?' '+cls:''));
  const l=_phdEl('label','phd-label',label);l.setAttribute('for','phd-f-'+key);
  w.appendChild(l);w.appendChild(input);
  if(hint)w.appendChild(_phdEl('div','phd-hint',hint));
  return w;
}
function _phdInput(key,opts){
  const o=opts||{};
  const i=_phdEl('input','phd-in');i.id='phd-f-'+key;i.setAttribute('type',o.type||'text');
  if(o.inputmode)i.setAttribute('inputmode',o.inputmode);
  if(o.maxlength)i.setAttribute('maxlength',String(o.maxlength));
  if(o.placeholder)i.setAttribute('placeholder',o.placeholder);
  i.setAttribute('autocomplete','off');
  _phdSetVal(i,_phdForm.f[key]);
  if(!_phdEditable())_phdOff(i);
  i.addEventListener('input',function(){_phdForm.f[key]=i.value;_phdTouch();if(key==='code')_phdOnCode();});
  _phdRefs[key]=i;
  return i;
}
function _phdSelect(key,options,value,onchange){
  const s=_phdEl('select','phd-in phd-sel');s.id='phd-f-'+key;
  options.forEach(function(o){
    const op=_phdEl('option','',o[1]);op.setAttribute('value',o[0]);
    if(o[0]===value){op.setAttribute('selected','selected');op.selected=true;}
    s.appendChild(op);
  });
  s.value=value;
  if(!_phdEditable())_phdOff(s);
  s.addEventListener('change',function(){onchange(s.value);_phdTouch();});
  _phdRefs[key]=s;
  return s;
}
function _phdCheck(id,label,checked,onchange){
  const w=_phdEl('label','phd-check');w.setAttribute('for',id);
  const c=_phdEl('input','phd-cb');c.id=id;c.setAttribute('type','checkbox');c.checked=!!checked;if(checked)c.setAttribute('checked','checked');
  if(!_phdEditable())_phdOff(c);
  c.addEventListener('change',function(){onchange(c.checked);_phdTouch();});
  w.appendChild(c);w.appendChild(_phdEl('span','phd-check-t',label));
  return w;
}
function _phdCard(title,kids){
  const c=_phdEl('section','ph-card phd-card');
  c.appendChild(_phdEl('h3','ph-card-title',title));
  (kids||[]).forEach(function(k){if(k)c.appendChild(k);});
  return c;
}

function _phdPaintForm(wrap){
  const f=_phdForm,st=f.status;
  const back=_phdBtn('',"← Back to the list",function(){_phdBack(false);},{'data-act':'back'});
  const dirtyChip=_phdChip('','wait');_phdRefs.dirty=dirtyChip;
  const chips=[_phdStatusChip(st),dirtyChip];
  wrap.appendChild(_phdHeader(f.id?'Draft '+f.id:'New draft',f.id?('Revision '+f.rev+(f.meta&&f.meta.createdByName?' · started by '+f.meta.createdByName:'')):'Not saved yet. Nothing is written until you press Save draft.',chips,[back]));
  const banner=_phdPcBanner();if(banner)wrap.appendChild(banner);
  const nn=_phdNoteNode();if(nn)wrap.appendChild(nn);
  // why the form is read-only: the PC-only banner above explains a screen; this line explains the status or the person
  const wcz=_phdWriteCheck();
  if(st!=='draft')wrap.appendChild(_phdEl('p','ph-placeholder phd-ro',_phdWhyReadOnly()));
  else if(!wcz.ok&&wcz.kind==='role')wrap.appendChild(_phdEl('p','ph-placeholder phd-ro',wcz.why));
  if(f.meta&&f.meta.sentBackReason&&st==='draft')wrap.appendChild(_phdEl('p','ph-placeholder phd-ro','Sent back: '+f.meta.sentBackReason));
  // standards / masters read problems that change what the form can promise
  const gm=_phdGet('masters');
  if(!gm.ok)wrap.appendChild(_phdErrCard('The cutting masters could not be read',(gm.text||'cutting_masters: not loaded.')+' A draft cannot be marked ready until the masters are read, because the planned master cannot be checked.'));
  const layout=_phdEl('div','phd-layout');
  const main=_phdEl('div','phd-main'),aside=_phdEl('div','phd-aside');
  _phdAddArticle(main);_phdAddQuantity(main);_phdAddFabric(main);_phdAddPlan(main);_phdAddEmbellishment(main);_phdAddNotes(main);
  _phdAddActions(aside);
  const live=_phdEl('div','phd-live');aside.appendChild(live);_phdRefs.live=live;
  layout.appendChild(main);layout.appendChild(aside);wrap.appendChild(layout);
  _phdUpdateLive();
}

/* article */
function _phdAddArticle(main){
  const f=_phdForm.f;
  const search=_phdEl('input','phd-in');search.id='phd-f-search';search.setAttribute('type','search');search.setAttribute('placeholder','Search the catalog by name or code, e.g. GH001 or Black Hoodie');search.setAttribute('autocomplete','off');
  if(!_phdEditable())_phdOff(search);
  const results=_phdEl('div','phd-results');results.id='phd-results';
  search.addEventListener('input',function(){_phdSearch(search.value,results);});
  _phdRefs.search=search;_phdRefs.results=results;
  const grid=_phdEl('div','phd-grid');
  grid.appendChild(_phdFieldWrap('code','Article code *',_phdInput('code',{maxlength:PH_DRAFTS_TEXT_MAX.code})));
  grid.appendChild(_phdFieldWrap('name','Article name *',_phdInput('name',{maxlength:PH_DRAFTS_TEXT_MAX.name}),null,'phd-wide'));
  grid.appendChild(_phdFieldWrap('pattern','Pattern',_phdInput('pattern',{maxlength:PH_DRAFTS_TEXT_MAX.pattern,placeholder:'Pattern number'})));
  const catHint=_phdEl('div','phd-hint phd-cathint');catHint.id='phd-cathint';_phdRefs.cathint=catHint;
  main.appendChild(_phdCard('Article',[_phdFieldWrap('search','Find an article',search),results,grid,catHint]));
  _phdUpdateCatHint();
}
function _phdSearch(q,box){
  _phdClear(box);
  const term=String(q||'').trim().toLowerCase();
  if(!term||!_phdEditable())return;
  const hits=_phdCatalog().filter(function(p){return p&&(String(p.code||'').toLowerCase().indexOf(term)>-1||String(p.name||'').toLowerCase().indexOf(term)>-1);}).slice(0,8);
  if(!hits.length){box.appendChild(_phdEl('div','phd-hint','No article in the catalog matches "'+term.slice(0,30)+'". You can still type the code and name below.'));return;}
  hits.forEach(function(p){
    const b=_phdBtn('phd-hit',null,function(){_phdPickArticle(p);},{'data-code':String(p.code||'')});
    b.appendChild(_phdEl('span','phd-hit-code',p.code));b.appendChild(_phdEl('span','phd-hit-name',p.name));
    box.appendChild(b);
  });
}
function _phdPickArticle(p){
  const f=_phdForm;if(!f||!_phdEditable())return;
  f.f.code=String(p.code||'');f.f.name=String(p.name||'');
  if(_phdRefs.code)_phdSetVal(_phdRefs.code,f.f.code);
  if(_phdRefs.name)_phdSetVal(_phdRefs.name,f.f.name);
  if(_phdRefs.results)_phdClear(_phdRefs.results);
  if(_phdRefs.search)_phdSetVal(_phdRefs.search,'');
  _phdTouch();_phdOnCode();
}
function _phdUpdateCatHint(){
  const h=_phdRefs.cathint;if(!h||!_phdForm)return;
  _phdClear(h);
  const code=String(_phdForm.f.code||'').trim().toUpperCase();
  if(!code)return;
  const cat=_phdCatalog();
  if(!cat.length){h.textContent='The article catalog is not available here, so the code cannot be checked against it.';return;}
  const hit=cat.filter(function(p){return String(p.code||'').toUpperCase()===code;})[0];
  h.textContent=hit?'In the catalog: '+hit.name:'Not in the article catalog - check the code. (It is not blocked: a new article may not be listed yet.)';
}
function _phdOnCode(){
  _phdUpdateCatHint();
  _phdRebuildSizes();
}

/* quantity and sizes */
function _phdAddQuantity(main){
  const f=_phdForm.f;
  const grid=_phdEl('div','phd-grid');
  grid.appendChild(_phdFieldWrap('qty','Total quantity (pcs) *',_phdInput('qty',{inputmode:'numeric',placeholder:'0'})));
  const sumHint=_phdEl('div','phd-hint');sumHint.id='phd-sumhint';_phdRefs.sumhint=sumHint;
  const useBtn=_phdBtn('phd-small','Use the sizes total',function(){
    const t=_phdToPo(_phdForm.f);const sum=phSizesTotal(t.po.sizes);
    if(!sum||!_phdEditable())return;
    _phdForm.f.qty=String(sum);_phdSetVal(_phdRefs.qty,String(sum));_phdTouch();
  });
  if(!_phdEditable())_phdOff(useBtn);
  _phdRefs.useTotal=useBtn;
  const axis=_phdSelect('sizeModel',PH_DRAFTS_MODELS,f.sizeModel,function(v){_phdForm.f.sizeModel=v;_phdRebuildSizes();});
  const axisHint=_phdEl('div','phd-hint');axisHint.id='phd-axishint';_phdRefs.axishint=axisHint;
  grid.appendChild(_phdFieldWrap('sizeModel','Size axis',axis,null));
  const sizes=_phdEl('div','phd-sizes');sizes.id='phd-sizes';_phdRefs.sizesBox=sizes;
  const ratio=_phdEl('div','phd-hint');ratio.id='phd-ratio';_phdRefs.ratio=ratio;
  const strays=_phdEl('div','phd-hint');strays.id='phd-strays';_phdRefs.strays=strays;
  main.appendChild(_phdCard('Quantity and sizes',[grid,_phdEl('div','phd-inline',null,[sumHint,useBtn]),axisHint,sizes,strays,ratio]));
  _phdRebuildSizes();
}
function _phdRebuildSizes(){
  const box=_phdRefs.sizesBox;if(!box||!_phdForm)return;
  const f=_phdForm.f,m=_phdModel(f);
  const sig=m.keys.join('|');
  if(box.__sig!==sig){
    box.__sig=sig;
    _phdClear(box);_phdRefs.sizeIn={};
    m.keys.forEach(function(k,idx){
      const id='phd-sz-'+k;
      const w=_phdEl('div','phd-field phd-szf');
      const l=_phdEl('label','phd-label',k);l.setAttribute('for',id);
      const i=_phdEl('input','phd-in phd-sz');i.id=id;i.setAttribute('type','text');i.setAttribute('inputmode','numeric');i.setAttribute('autocomplete','off');
      i.setAttribute('placeholder','0');
      _phdSetVal(i,f.sizes[k]==null?'':f.sizes[k]);
      if(!_phdEditable())_phdOff(i);
      i.addEventListener('input',function(){_phdForm.f.sizes[k]=i.value;_phdTouch();});
      w.appendChild(l);w.appendChild(i);box.appendChild(w);
      _phdRefs.sizeIn[k]=i;
      if(idx===0)_phdRefs.sizes=i;
    });
  }
  _phdUpdateLive();
}

/* fabric */
function _phdAddFabric(main){
  const f=_phdForm.f;
  const grid=_phdEl('div','phd-grid');
  grid.appendChild(_phdFieldWrap('fabric','Fabric type *',_phdInput('fabric',{maxlength:PH_DRAFTS_TEXT_MAX.fabric,placeholder:'e.g. Terry, Fleece'})));
  grid.appendChild(_phdFieldWrap('fabricCode','Fabric code',_phdInput('fabricCode',{maxlength:PH_DRAFTS_TEXT_MAX.fabricCode,placeholder:'e.g. BLKTRY220'})));
  grid.appendChild(_phdFieldWrap('store','Supply store',_phdInput('store',{maxlength:PH_DRAFTS_TEXT_MAX.store,placeholder:'Store/supplier'})));
  grid.appendChild(_phdFieldWrap('totalRoll','Total rolls',_phdInput('totalRoll',{maxlength:PH_DRAFTS_TEXT_MAX.totalRoll,placeholder:'e.g. 12'})));
  grid.appendChild(_phdFieldWrap('plannedFabricQty','Planned fabric quantity *',_phdInput('plannedFabricQty',{inputmode:'decimal',placeholder:'e.g. 120'})));
  const unit=_phdSelect('plannedFabricUnit',[['','- choose -'],['kg','kg'],['m','m (meters)']],f.plannedFabricUnit,function(v){_phdForm.f.plannedFabricUnit=v;});
  grid.appendChild(_phdFieldWrap('plannedFabricUnit','Planned fabric unit *',unit,'kg and m are never mixed.'));
  const std=_phdEl('div','phd-std');std.id='phd-std';_phdRefs.std=std;
  main.appendChild(_phdCard('Fabric and supply',[grid,std]));
  _phdUpdateStd();
}
// A SUGGESTION from the consumption standard (ph_standards), shown beside the field and never written on its own.
function _phdUpdateStd(){
  const box=_phdRefs.std;if(!box||!_phdForm)return;
  _phdClear(box);
  const f=_phdForm.f;
  const code=String(f.code||'').trim().toUpperCase();
  if(!code)return;
  const gs=_phdGet('standards');
  if(!gs.ok){box.appendChild(_phdEl('div','phd-hint','The consumption standards could not be read, so no fabric suggestion is shown.'));return;}
  const std=typeof phStandardFor==='function'?phStandardFor(code):null;
  if(!std){box.appendChild(_phdEl('div','phd-hint','No consumption standard is saved for '+code+'.'));return;}
  const t=_phdToPo(f);
  const sum=phSizesTotal(t.po.sizes);
  const pieces=sum||t.po.qty||0;
  const per=pieces?phExpectedGross(std,sum?t.po.sizes:pieces):null;
  const line=_phdEl('div','phd-hint','Standard for '+code+': '+std.grossPerPiece+' '+std.unit+' per piece'+(per!==null&&pieces?' → about '+phRound(per*pieces,2)+' '+std.unit+' for '+pieces+' pieces.':'.'));
  box.appendChild(line);
  if(per!==null&&pieces){
    const b=_phdBtn('phd-small','Use the standard ('+phRound(per*pieces,2)+' '+std.unit+')',function(){
      if(!_phdEditable())return;
      const v=String(phRound(per*pieces,2));
      _phdForm.f.plannedFabricQty=v;_phdSetVal(_phdRefs.plannedFabricQty,v);
      _phdForm.f.plannedFabricUnit=std.unit;_phdRefs.plannedFabricUnit.value=std.unit;
      Array.prototype.forEach.call(_phdRefs.plannedFabricUnit.children||[],function(o){if(o.getAttribute('value')===std.unit)o.setAttribute('selected','selected');else o.removeAttribute&&o.removeAttribute('selected');});
      _phdTouch();
    });
    if(!_phdEditable())_phdOff(b);
    box.appendChild(b);
  }
}

/* plan: season, dates, master */
function _phdAddPlan(main){
  const f=_phdForm.f;
  const grid=_phdEl('div','phd-grid');
  const season=_phdSelect('season',[['','- choose -']].concat(PH_DRAFTS_SEASONS),f.season,function(v){_phdForm.f.season=v;});
  grid.appendChild(_phdFieldWrap('season','Season *',season,'Stated, not guessed from a date.'));
  const pcd=_phdInput('plannedCutDate',{type:'date'});
  grid.appendChild(_phdFieldWrap('plannedCutDate','Planned cut date *',pcd));
  const rqd=_phdInput('requestedDate',{type:'date'});
  grid.appendChild(_phdFieldWrap('requestedDate','Requested date *',rqd,'The date the PO asks for.'));
  // cutting master: only registered, active masters can be chosen; one already on the draft that is not on the list stays visible (and is flagged)
  const gm=_phdGet('masters');
  const reg=gm.ok?_phdMasters():null;
  let opts=[['','- choose -']];
  if(reg){
    reg.filter(function(m){return m.active!==false;}).forEach(function(m){opts.push([m.fbKey,m.name+' ('+m.fbKey+')']);});
    if(f.cutMasterId&&!opts.some(function(o){return o[0]===f.cutMasterId;}))opts.push([f.cutMasterId,(f.cutMaster||f.cutMasterId)+' (retired or not in the registry)']);
  }else opts=[['','Masters not loaded']];
  const prevId=f.cutMasterId,prevName=f.cutMaster;
  const master=_phdSelect('cutMasterId',opts,reg?f.cutMasterId:'',function(v){
    const m=(_phdMasters()||[]).filter(function(x){return x.fbKey===v;})[0];
    _phdForm.f.cutMasterId=v;
    _phdForm.f.cutMaster=m?m.name:(v&&v===prevId?prevName:'');
  });
  if(!reg)_phdOff(master);
  const noActive=!!reg&&!reg.some(function(m){return m.active!==false;});
  grid.appendChild(_phdFieldWrap('cutMasterId','Planned cutting master *',master,reg?(noActive?'The registry has no active master yet - a manager adds one in the Masters tab.':null):'The master registry was not read.'));
  _phdRefs.cutMaster=master;
  main.appendChild(_phdCard('Plan',[grid]));
}

/* embellishment and job copies */
function _phdAddEmbellishment(main){
  const f=_phdForm.f;
  const row=_phdEl('div','phd-checks');
  row.appendChild(_phdCheck('phd-emb',"This PO needs embellishment (printing / embroidery)",f.embRequired,function(v){_phdForm.f.embRequired=v;}));
  const copies=_phdEl('div','phd-checks');
  PH_DRAFTS_COPIES.forEach(function(c){copies.appendChild(_phdCheck('phd-jc-'+c[0],c[1],f.jobCopies[c[0]],function(v){_phdForm.f.jobCopies[c[0]]=v;}));});
  main.appendChild(_phdCard('Embellishment and job copies',[row,_phdEl('div','phd-hint','Job copies to print. They print separately from the PO. Leave all unticked for none.'),copies,
    _phdEl('div','phd-hint','The embellishment recipe is looked up when the PO is issued; product photos and fabric rolls are not part of a draft (the PO is created without photos and reserves no rolls). A draft only records the choice.')]));
}
function _phdAddNotes(main){
  const f=_phdForm.f;
  const ta=_phdEl('textarea','phd-in phd-ta');ta.id='phd-f-notes';ta.setAttribute('rows','3');ta.setAttribute('maxlength',String(PH_DRAFTS_TEXT_MAX.notes));
  ta.setAttribute('placeholder','e.g. special instructions, buyer remarks');
  _phdSetVal(ta,f.notes);
  if(!_phdEditable())_phdOff(ta);
  ta.addEventListener('input',function(){_phdForm.f.notes=ta.value;_phdTouch();});
  _phdRefs.notes=ta;
  main.appendChild(_phdCard('Notes',[_phdFieldWrap('notes','Notes for this PO (optional)',ta)]));
}

/* ═══ the aside: actions, completeness, the summary ══════════════════════ */
function _phdAddActions(aside){
  const f=_phdForm,st=f.status;
  const card=_phdEl('section','ph-card phd-card phd-actions');
  card.appendChild(_phdEl('h3','ph-card-title','Actions'));
  const row=_phdEl('div','phd-btnrow');
  const editable=_phdEditable(),busy=_phdBusy;
  const save=_phdBtn('ph-btn-primary','Save draft',function(){_phdRun(_phdSave);},{'data-act':'save'});
  const ready=_phdBtn('','Mark ready',function(){_phdRun(_phdReady);},{'data-act':'ready'});
  if(!editable||busy){_phdOff(save);_phdOff(ready);}
  row.appendChild(save);row.appendChild(ready);
  _phdRefs.actionBtns=[save,ready];
  const wc=_phdWriteCheck();
  if(st==='draft'||st==='ready'){
    const abandon=_phdBtn('phd-danger',f.id?'Abandon draft':'Discard draft',function(){_phdAsk={kind:f.id?'abandon':'discard'};_phdPaint();},{'data-act':'abandon'});
    if(!wc.ok||busy||(st==='ready'&&!_phdCanManage())){_phdOff(abandon);if(st==='ready'&&!_phdCanManage())abandon.setAttribute('title','Only a manager (Afnan, Ammar, Mustafa) can abandon a ready draft.');}
    row.appendChild(abandon);_phdRefs.actionBtns.push(abandon);
  }
  if(st==='ready'){
    const back=_phdBtn('','Send back to draft',function(){_phdAsk={kind:'sendback'};_phdPaint();},{'data-act':'sendback'});
    if(!_phdCanManage()||!wc.ok||busy){_phdOff(back);back.setAttribute('title',_phdCanManage()?'Not available from this screen.':'Only a manager (Afnan, Ammar, Mustafa) can send a ready draft back.');}
    row.appendChild(back);_phdRefs.actionBtns.push(back);
  }
  card.appendChild(row);
  if(busy)card.appendChild(_phdEl('p','phd-fine','Working…'));
  // ISSUE AS PO: managers only, ready drafts only, a two-step confirm. Kashif sees why it is not his.
  const mgr=_phdCanManage();
  if(st==='issued'){
    const po=f.meta&&f.meta.poId?f.meta.poId:'';
    card.appendChild(_phdEl('p','phd-issued','Issued as '+(po||'a PO')+'.'));
    if(po&&typeof phqOpenPO==='function'&&typeof window!=='undefined'&&window&&typeof window.openPODetail==='function')
      card.appendChild(_phdBtn('ph-btn-primary phd-openpo','Open '+po,function(){phqOpenPO(po);},{'data-act':'openpo'}));
    card.appendChild(_phdEl('p','phd-fine','This draft is final. The PO was created reserved, like one from the New PO form, without photos and with no fabric rolls reserved.'));
  }else if(st==='ready'||(st==='draft'&&f.id)||!f.id){
    const label=st==='ready'?(mgr?'Issue as PO':'Ready - waiting for Mustafa'):'Issue as PO';
    const issue=_phdBtn('phd-issue'+(st==='ready'&&mgr?' ph-btn-primary':''),label,function(){_phdAsk={kind:'issue'};_phdPaint();},{'data-act':'issue'});
    if(st!=='ready'||!mgr||busy||!f.id){
      _phdOff(issue);issue.setAttribute('aria-disabled','true');
      issue.setAttribute('title',st!=='ready'?'Only a READY draft can be issued. Mark it ready first.':!mgr?'Ready. A manager (Mustafa, Afnan or Ammar) issues it as a PO.':'Working...');
    }
    card.appendChild(issue);_phdRefs.actionBtns.push(issue);
    if(st==='ready'&&!mgr)card.appendChild(_phdEl('p','phd-fine phd-wait','Ready - waiting for Mustafa. He issues it as a PO; you will see "Issued as PO-nnn" here.'));
    if(st==='ready'&&mgr)card.appendChild(_phdEl('p','phd-fine','Issuing creates the PO number and the PO in one step. It asks you to confirm first.'));
  }
  if(_phdAsk)card.appendChild(_phdAskNode());
  aside.appendChild(card);
}
function _phdAskNode(){
  const a=_phdAsk;
  const box=_phdEl('div','phd-ask');box.setAttribute('role','group');
  const texts={abandon:'Abandon this draft? It stays in the list as abandoned and cannot be edited. A reason is required.',
    sendback:'Send this ready draft back to draft so it can be edited. A reason is required.',
    discard:'Discard this new draft? Nothing was saved, so nothing is written.',
    leave:'Leave this draft? Your unsaved changes will be lost.',
    issue:'Issue this draft as a real PO? This cannot be undone: the draft becomes final and a PO is created.'};
  box.appendChild(_phdEl('p','ph-note',texts[a.kind]||''));
  if(a.kind==='issue'&&_phdForm){
    const po=_phdToPo(_phdForm.f).po;
    const dl=_phdEl('dl','phd-dl phd-issue-sum');
    const kv=function(k,v){dl.appendChild(_phdEl('dt','phd-dt',k));dl.appendChild(_phdEl('dd','phd-dd',v||'-'));};
    kv('Article',(po.code||'')+(po.code&&po.name?' - ':'')+(po.name||''));
    kv('Quantity',po.qty!=null?po.qty+' pcs':'');
    kv('PO number','Not known yet - it is given the moment the PO is created');
    kv('Created as','Reserved (like the New PO form), no photos, no fabric rolls reserved');
    box.appendChild(dl);
  }
  let ta=null;
  if(a.kind==='abandon'||a.kind==='sendback'){
    ta=_phdEl('textarea','phd-in phd-ta');ta.id='phd-f-ask-reason';ta.setAttribute('rows','2');ta.setAttribute('maxlength','500');ta.setAttribute('placeholder','Reason');
    _phdSetVal(ta,a.reason||'');
    ta.addEventListener('input',function(){a.reason=ta.value;});
    box.appendChild(_phdFieldWrap('ask-reason','Reason',ta));_phdRefs.reason=ta;
  }
  const ok=_phdBtn(a.kind==='leave'||a.kind==='discard'||a.kind==='issue'?'ph-btn-primary':'phd-danger',a.kind==='leave'?'Discard changes and leave':a.kind==='discard'?'Discard':a.kind==='issue'?'Yes, issue it as a PO':a.kind==='abandon'?'Abandon':'Send back',function(){
    const reason=ta?ta.value:'';
    if(a.kind==='issue'){_phdRun(_phdIssue);return;}
    if(a.kind==='leave'){_phdBack(true);return;}
    if(a.kind==='discard'){_phdForm=null;_phdView='list';_phdAsk=null;_phdSetNote('ok','Discarded. Nothing had been saved.');_phdPaint();return;}
    _phdRun(function(){return a.kind==='abandon'?_phdAbandon(reason):_phdSendBack(reason);});
  },{'data-act':'ask-ok'});
  const no=_phdBtn('','Cancel',function(){_phdAsk=null;_phdPaint();},{'data-act':'ask-cancel'});
  box.appendChild(_phdEl('div','phd-btnrow',null,[ok,no]));
  return box;
}

/* the live part: completeness + summary, repainted on every edit without touching the inputs */
function _phdPaintDirty(){
  const c=_phdRefs.dirty,f=_phdForm;if(!c||!f)return;
  c.textContent=f.dirty?'unsaved changes':'';
  c.className='ph-chip ph-chip-wait'+(f.dirty?'':' ph-hidden');
}
function _phdUpdateLive(){
  const f=_phdForm;if(!f)return;
  _phdPaintDirty();
  const t=_phdToPo(f.f);
  // sum / ratio / axis hints
  if(_phdRefs.sumhint){
    const sum=phSizesTotal(t.po.sizes);
    const qty=t.po.qty;
    _phdRefs.sumhint.textContent='Sizes add up to '+sum+' pcs'+(qty!==null?(qty===sum?' - matches the quantity.':' - the quantity says '+qty+'.'):'.');
    _phdRefs.sumhint.className='phd-hint'+(qty!==null&&sum&&qty!==sum?' phd-bad':'');
  }
  if(_phdRefs.axishint)_phdRefs.axishint.textContent='Sizes shown: '+t.model.keys.join(', ')+' ('+(f.f.sizeModel?'chosen by you':t.model.source==='prefix'?'from the article code':'the default axis')+').';
  if(_phdRefs.ratio)_phdRefs.ratio.textContent='Ratio: '+(t.po.ratio||'-');
  if(_phdRefs.strays){
    const n=t.dropped;
    _phdRefs.strays.textContent=n?n+' size entr'+(n===1?'y does':'ies do')+' not belong to this size axis and will not be saved.':'';
    _phdRefs.strays.className='phd-hint'+(n?' phd-bad':'');
  }
  _phdUpdateStd();
  const live=_phdRefs.live;if(!live)return;
  _phdClear(live);
  const gate=_phdGate(t.po);
  live.appendChild(_phdCompleteness(t,gate));
  live.appendChild(_phdSummary(t.po,gate,t));
}
function _phdCompleteness(t,gate){
  const card=_phdEl('section','ph-card phd-card phd-complete');
  const ok=gate.ok&&!t.problems.length;
  card.appendChild(_phdEl('h3','ph-card-title',ok?'Complete':'Not complete yet'));
  if(ok)card.appendChild(_phdEl('p','ph-note','Every required field is filled. This draft can be marked ready.'));
  else{
    card.appendChild(_phdEl('p','ph-note',(gate.missing.length+t.problems.length)+' to fix before this can be marked ready:'));
    const ul=_phdEl('ul','ph-lines phd-miss');
    t.problems.forEach(function(p){ul.appendChild(_phdMissRow(p.field,'Not understood',p.why));});
    gate.missing.forEach(function(m){ul.appendChild(_phdMissRow(m.field,_phdLabel(m.field),m.why));});
    card.appendChild(ul);
  }
  if(gate.warnings&&gate.warnings.length){
    card.appendChild(_phdEl('p','phd-fine','Worth a look (does not block):'));
    const ul=_phdEl('ul','ph-lines phd-warn');
    gate.warnings.forEach(function(w){ul.appendChild(_phdEl('li','ph-line',null,[_phdEl('span','ph-line-name',_phdLabel(w.field)),_phdEl('span','ph-line-txt',w.why)]));});
    card.appendChild(ul);
  }
  return card;
}
function _phdMissRow(field,label,why){
  const li=_phdEl('li','ph-line phd-miss-row');
  li.appendChild(_phdEl('span','ph-line-name',label));
  li.appendChild(_phdEl('span','ph-line-txt',why));
  const refKey={cutMaster:'cutMaster'}[field]||field;
  if(_phdEditable()){
    li.appendChild(_phdBtn('phd-small','Fix',function(){const r=_phdRefs[refKey];if(r&&typeof r.focus==='function')r.focus();},{'data-fix':field,'aria-label':'Go to '+label}));
  }
  return li;
}
// The print-ready summary: read-only, never a PDF. Titled complete only when the gate passes.
function _phdSummary(po,gate,t){
  const complete=gate.ok&&(!t||!t.problems.length);
  const card=_phdEl('section','ph-card phd-card phd-summary');
  card.appendChild(_phdEl('h3','ph-card-title',complete?'Print-ready summary':'Summary (not print-ready: incomplete)'));
  const dl=_phdEl('dl','phd-dl');
  const row=function(k,v,missing){
    dl.appendChild(_phdEl('dt','phd-dt',k));
    dl.appendChild(_phdEl('dd','phd-dd'+(missing?' phd-none':''),v||'-'));
  };
  row('Article',po.code||po.name?(po.code+(po.code&&po.name?' - ':'')+po.name):'',!po.code&&!po.name);
  if(po.pattern)row('Pattern',po.pattern);
  row('Quantity',po.qty!=null?po.qty+' pcs':'',po.qty==null);
  const m=t?t.model:phSizeModel({sizeModel:po.sizeModel,code:po.code});
  const sizeTxt=m.keys.filter(function(k){return po.sizes&&po.sizes[k]>0;}).map(function(k){return k+' '+po.sizes[k];}).join(' · ');
  row('Sizes ('+m.model+')',sizeTxt+(po.ratio?'  (ratio '+po.ratio+')':''),!sizeTxt);
  row('Fabric',[po.fabric,po.fabricCode,po.store,po.totalRoll?po.totalRoll+' rolls':''].filter(Boolean).join(' · '),!po.fabric);
  row('Planned fabric',po.plannedFabricQty!=null&&po.plannedFabricUnit?po.plannedFabricQty+' '+po.plannedFabricUnit:'',po.plannedFabricQty==null||!po.plannedFabricUnit);
  const sl=PH_DRAFTS_SEASONS.filter(function(s){return s[0]===po.season;})[0];
  row('Season',sl?sl[1]:'',!sl);
  row('Planned cut date',_phdDayLabel(po.plannedCutDate),!po.plannedCutDate);
  row('Requested date',_phdDayLabel(po.requestedDate),!po.requestedDate);
  row('Cutting master',po.cutMaster||po.cutMasterId,!po.cutMaster&&!po.cutMasterId);
  row('Embellishment',po.embellishment&&po.embellishment.required?'Required':'Not required');
  const jc=PH_DRAFTS_COPIES.filter(function(c){return po.jobCopies&&po.jobCopies[c[0]];}).map(function(c){return c[1];});
  row('Job copies',jc.length?jc.join(', '):'None');
  if(po.notes)row('Notes',po.notes);
  card.appendChild(dl);
  card.appendChild(_phdEl('p','phd-fine','Read-only. Nothing is printed from here: the PO is printed from its own page after it is issued.'));
  return card;
}

/* ═══ actions (every one re-checks the screen and the person, then calls ph-write.js) ═══ */
function _phdRun(fn){
  if(_phdBusy)return Promise.resolve();
  _phdBusy=true;
  _phdPaintBusy();
  let p;
  try{p=Promise.resolve(fn());}catch(e){p=Promise.reject(e);}
  return p.catch(function(e){_phdSetNote('err','Unexpected error: '+String(e&&e.message||e));}).then(function(){_phdBusy=false;_phdPaint();});
}
function _phdPaintBusy(){   // keep the form in place and just disable the action buttons while a write is out
  (_phdRefs.actionBtns||[]).forEach(function(b){_phdOff(b);});
}
function _phdWriteGuard(){
  const wc=_phdWriteCheck();
  if(!wc.ok){_phdSetNote('err',wc.why);return false;}
  if(!_phdForm||_phdForm.status!=='draft'){_phdSetNote('err',_phdWhyReadOnly()||'This draft cannot be changed.');return false;}
  return true;
}
async function _phdSave(){
  const f=_phdForm;
  if(!_phdWriteGuard())return{ok:false,code:'forbidden'};
  const t=_phdToPo(f.f);
  if(t.problems.length){_phdSetNote('err','Not saved. Fix these first: '+_phdFmtList(t.problems.map(function(p){return p.why;}))+'.');return{ok:false,code:'invalid'};}
  const seq=f.seq;
  const r=await phSaveDraft(f.id||null,t.po,f.id?{expectedRev:f.rev}:{});
  if(r&&r.ok){
    f.id=r.id;f.rev=r.rev;f.status=r.draft&&r.draft.status||'draft';
    f.meta=f.meta||{};f.meta.createdByName=f.meta.createdByName||(r.draft&&r.draft.createdByName)||'';
    if(f.seq===seq)f.dirty=false;
    _phdSetNote('ok',(r.created?'Draft '+r.id+' created':'Draft saved')+' (revision '+r.rev+').'+(t.dropped?' '+t.dropped+' size entr'+(t.dropped===1?'y':'ies')+' outside this size axis were not saved.':''));
  }else{
    _phdSetNote('err',(r&&r.error)||'The draft could not be saved.',r&&r.code==='stale'?{code:'stale'}:null);
  }
  return r||{ok:false};
}
async function _phdReady(){
  const f=_phdForm;
  if(!_phdWriteGuard())return;
  const t=_phdToPo(f.f);
  if(t.problems.length){_phdSetNote('err','Not marked ready. Fix these first: '+_phdFmtList(t.problems.map(function(p){return p.why;}))+'.');return;}
  // THE GATE, before anything is written: refused with the missing fields named.
  const gate=_phdGate(t.po);
  if(!gate.ok){
    _phdSetNote('err','Not marked ready - the draft is incomplete. Missing: '+_phdFmtList(gate.missing.map(function(m){return _phdLabel(m.field)+' ('+m.why+')';}))+'. Your changes are still in the form; press Save draft to keep them.',{missing:gate.missing});
    return;
  }
  if(f.dirty||!f.id){const s=await _phdSave();if(!s||!s.ok)return;}
  const r=await phMarkDraftReady(f.id,{expectedRev:f.rev});
  if(r&&r.ok){
    f.status='ready';f.rev=r.rev;f.dirty=false;
    _phdSetNote('ok','Draft '+f.id+' is marked ready (revision '+r.rev+'). It is locked; a manager can send it back.');
  }else{
    const miss=r&&Array.isArray(r.missing)?' Missing: '+_phdFmtList(r.missing.map(function(m){return _phdLabel(m.field)+' ('+m.why+')';}))+'.':'';
    _phdSetNote('err',((r&&r.error)||'The draft could not be marked ready.')+(r&&r.error&&miss?'':miss),r&&r.code==='stale'?{code:'stale'}:null);
  }
}
async function _phdIssue(){
  const f=_phdForm;
  if(!_phdCanManage()){_phdAsk=null;_phdSetNote('err','Only a manager (Afnan, Ammar, Mustafa) can issue a draft as a PO.');return;}
  if(!f||!f.id||f.status!=='ready'){_phdAsk=null;_phdSetNote('err','Only a saved, READY draft can be issued.');return;}
  if(typeof phIssueDraft!=='function'){_phdAsk=null;_phdSetNote('err','js/ph-issue.js did not load - refresh the page.');return;}
  if(typeof navigator!=='undefined'&&navigator&&navigator.onLine===false){_phdAsk=null;_phdSetNote('err','No connection. Issuing a PO needs one (it is a single transaction and cannot be queued). Nothing was created.');return;}
  const r=await phIssueDraft(f.id,{expectedRev:f.rev});
  _phdAsk=null;
  if(r&&r.ok){
    f.status='issued';f.rev=r.rev;f.dirty=false;f.meta=f.meta||{};f.meta.poId=r.poId;f.meta.issuedBy=_phdUser();f.meta.issuedAt=r.draft&&r.draft.issuedAt||null;
    const fu=r.followUps||{};
    const bad=['activity','recipe','trim'].filter(function(k){return /^failed/.test(String(fu[k]||''));});
    _phdSetNote('ok','Issued as '+r.poId+'. The PO is reserved, like one from the New PO form.'+(fu.trim==='created'?' A trim issue request was created.':'')+(bad.length?' Follow-up step failed ('+bad.join(', ')+'); the PO itself is fine.':''));
  }else{
    _phdSetNote('err',(r&&r.error)||'The draft could not be issued. Nothing was created.',r&&r.code==='stale'?{code:'stale'}:null);
  }
}
async function _phdAbandon(reason){
  const f=_phdForm;
  if(!_phdWriteCheck().ok){_phdSetNote('err',_phdWriteCheck().why);return;}
  if(!f||!f.id){_phdSetNote('err','This draft was never saved, so there is nothing to abandon.');return;}
  if(f.status==='ready'&&!_phdCanManage()){_phdSetNote('err','Only a manager (Afnan, Ammar, Mustafa) can abandon a ready draft.');return;}
  if(!String(reason||'').trim()){_phdSetNote('err','A reason is needed to abandon a draft.');return;}
  const r=await phAbandonDraft(f.id,reason,{expectedRev:f.rev});
  if(r&&r.ok){f.status='abandoned';f.rev=r.rev;f.dirty=false;_phdAsk=null;f.meta=f.meta||{};f.meta.abandonedReason=String(reason).trim().slice(0,500);_phdSetNote('ok','Draft '+f.id+' abandoned.');}
  else _phdSetNote('err',(r&&r.error)||'The draft could not be abandoned.',r&&r.code==='stale'?{code:'stale'}:null);
}
async function _phdSendBack(reason){
  const f=_phdForm;
  if(!_phdCanManage()){_phdSetNote('err','Only a manager (Afnan, Ammar, Mustafa) can send a ready draft back.');return;}
  if(!_phdWriteCheck().ok){_phdSetNote('err',_phdWriteCheck().why);return;}
  if(!f||!f.id||f.status!=='ready'){_phdSetNote('err','Only a ready draft can be sent back.');return;}
  if(!String(reason||'').trim()){_phdSetNote('err','A reason is needed to send a draft back.');return;}
  const r=await phSendBackDraft(f.id,reason,{expectedRev:f.rev});
  if(r&&r.ok){f.status='draft';f.rev=r.rev;f.dirty=false;_phdAsk=null;f.meta=f.meta||{};f.meta.sentBackReason=String(reason).trim().slice(0,500);_phdSetNote('ok','Draft '+f.id+' sent back to draft (revision '+r.rev+').');}
  else _phdSetNote('err',(r&&r.error)||'The draft could not be sent back.',r&&r.code==='stale'?{code:'stale'}:null);
}

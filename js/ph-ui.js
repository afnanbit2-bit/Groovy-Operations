/* ─────────────────────────────────────────────────────────────────────────
   Production Ops — the UI SHELL (12 Oct 2026).  Page id `prod-ops`.

   What this file is: the full-window takeover (top bar, left tab rail, bottom
   dock on a phone), the TAB REGISTRY, the one data load on open, and the
   honest states (skeleton / error card with Retry). It writes NOTHING to
   Firestore: the only reads are js/ph-data.js's phLoadAll().

   What it is not: the modules. Every tab in PH_TABS renders a clearly labelled
   placeholder today; later steps REPLACE a tab's `render` and touch nothing else.

   HOW TO ADD OR REPLACE A TAB (the whole extension point):
     1. from your own file (loaded after this one):
          phRegisterTab('queue',{render:function(host,ctx){ ...build into host... }});
        An unknown id appends a new tab; a known id patches that entry (render, label,
        short, roles). Or edit the entry in PH_TABS below.
     2. `render(host,ctx)` receives an EMPTY element it owns, and a ctx:
          ctx.user         username          ctx.canManage / ctx.readOnly
          ctx.status       {loading, failed:[{name,label,text}], allOk, stages:[...]}
          ctx.get(stage)   = phGet(stage): rows is null unless the read SUCCEEDED
          ctx.el(tag,cls,text,kids) / ctx.clear(node)   safe DOM builders
          ctx.repaint()    redraw this tab        ctx.reload()  re-read everything
        Build with ctx.el / textContent only. NEVER put stored text into innerHTML.
     3. `roles` is a function(username) -> boolean (default: the whole audience).
        The tab list, the rail, the hash and the render path ALL ask it.
     4. A render that throws draws an error card, never a blank panel.
     5. An overlay of yours (drawer, dialog) that should win Escape registers
        phAddEscapeGuard(function(){ return handledIt; }).

   Rules held here (CLAUDE.md "Production Ops UI shell"): the page decides (a showPage
   wrap enters and leaves the takeover; nothing else sets the classes); z-index 120/121
   under the bug FAB (500); 100vh then 100dvh; the bar and rail are children of <body>
   (renderPage replaces #main-content on every load); deep links #prodops and
   #prodops/<tab> by replaceState only; fail closed (no session / not on the audience
   = nothing opens). Globals are ph/_ph/PH_ prefixed: classic scripts share ONE lexical
   scope with ph-core / ph-data / ph-write, so this file adds no name they use.
   ───────────────────────────────────────────────────────────────────────── */

const PH_PAGE_ID='prod-ops';
const PH_HASH=/^#prodops(?:\/([A-Za-z0-9_-]*))?$/;
const PH_RAIL_KEY='groovy-ph-rail';

/* ── who ──────────────────────────────────────────────────────────────── */
function _phUiUser(u){
  if(u!==undefined)return typeof u==='string'?u:'';
  return(typeof session!=='undefined'&&session&&typeof session.u==='string')?session.u:'';
}
// js/ph-data.js loads before this file; every use still goes through typeof so a data layer that
// failed to parse FAILS CLOSED (nobody is on the audience) instead of throwing.
function _phUiCanSee(u){return typeof phCanSee==='function'&&phCanSee(_phUiUser(u))===true;}
function _phUiCanManage(u){return typeof phCanManage==='function'&&phCanManage(_phUiUser(u))===true;}
// The top-bar chip. Managers see none (hidden). The cutting floor (Kashif) is NOT view-only: he enters PO
// drafts and records cuts, so the chip says what his account does; it still cannot plan or change settings.
const PH_CHIP_FLOOR='Data entry & cutting';   // chip text; its Urdu pair is shell.chip_floor
const PH_CHIP_FLOOR_TITLE='This account enters PO drafts and checks fabric on Today\'s Cutting. The cut itself is recorded on the PO page (the classic cutting screen). Planning, Calendar and settings are for the managers.';
function phChipFor(u){
  const w=_phUiUser(u);
  if(_phUiCanManage(w))return{show:false,text:'',title:''};
  if(typeof phCanRecordFloor==='function'&&phCanRecordFloor(w)===true)return{show:true,text:PH_CHIP_FLOOR,title:PH_CHIP_FLOOR_TITLE,key:'shell.chip_floor',tkey:'shell.chip_floor_tip'};
  return{show:true,text:'View only',title:'This account can only look.',key:'shell.view_only',tkey:'shell.chip_view_tip'};
}
const PH_ROLE_ALL=function(u){return _phUiCanSee(u);};       // the whole audience (managers + the cutting floor)
const PH_ROLE_MANAGE=function(u){return _phUiCanManage(u);}; // afnan, ammar, mustafa

/* ── the tab registry: ONE constant ────────────────────────────────────── */
// {id, label, short (rail monogram), render(host,ctx), roles(username)}. The floor user (Uzaib / Kashif) sees
// ONLY Overview, PO Queue (his PO data entry: drafts) and Today's Cutting; the other six are managers'. Order is the rail's order.
const PH_TABS=[
  {id:'overview',label:'Overview',lkey:'shell.tab_overview',     short:'Ov',roles:PH_ROLE_ALL,   render:_phRenderOverview},
  {id:'queue',   label:'PO Queue',lkey:'shell.tab_queue',     short:'PQ',roles:PH_ROLE_ALL,   render:_phPlaceholder({title:phI18nD('shell.tab_queue'),      blurb:phI18nD('shell.ph_queue_blurb'),stages:['drafts'],list:_phUiNames('drafts','fbKey')})},
  {id:'calendar',label:'Calendar',     short:'Ca',roles:PH_ROLE_MANAGE,render:_phPlaceholder({title:'Calendar',      blurb:'Planned cutting by day against capacity and skip days.',stages:['jobs','settings']})},
  {id:'cutting', label:"Today's Cutting",lkey:'shell.tab_cutting',short:'TC',roles:PH_ROLE_ALL, render:_phPlaceholder({title:phI18nD('shell.tab_cutting'),blurb:phI18nD('shell.ph_cutting_blurb'),stages:['jobs','masters'],list:_phUiNames('masters','name')})},
  {id:'monitor', label:'Monitor',      short:'Mo',roles:PH_ROLE_MANAGE,render:_phPlaceholder({title:'Monitor',       blurb:'Pipeline, units afloat, delays and alerts.',stages:['jobs','drafts']})},
  {id:'reports', label:'Reports',      short:'Re',roles:PH_ROLE_MANAGE,render:_phPlaceholder({title:'Reports',       blurb:'Cutting by day, week and master; consumption and gross variance; export.',stages:['jobs','standards']})},
  {id:'masters', label:'Masters',      short:'Ma',roles:PH_ROLE_MANAGE,render:_phPlaceholder({title:'Masters',       blurb:'The cutting masters register (add, rename, retire).',stages:['masters'],list:_phUiNames('masters','name')})},
  {id:'standards',label:'Standards',   short:'St',roles:PH_ROLE_MANAGE,render:_phPlaceholder({title:'Standards',     blurb:'The current consumption standard per article code.',stages:['standards'],list:_phUiNames('standards','fbKey')})},
  {id:'settings',label:'Settings',     short:'Se',roles:PH_ROLE_MANAGE,render:_phPlaceholder({title:'Settings',      blurb:'Capacity, skip days, tolerances and the PC-only switch.',stages:['settings']})}
];
// Replace or add a tab from another file. Patches only the keys given; the audience gate is never skipped.
function phRegisterTab(id,patch){
  if(typeof id!=='string'||!id||!patch||typeof patch!=='object')return false;
  const t=PH_TABS.filter(function(x){return x.id===id;})[0];
  if(t){['label','short','render','roles'].forEach(function(k){if(patch[k]!==undefined)t[k]=patch[k];});return true;}
  if(typeof patch.render!=='function'||!/^[A-Za-z0-9_-]+$/.test(id))return false;
  PH_TABS.push({id:id,label:String(patch.label||id),short:String(patch.short||id.slice(0,2)),render:patch.render,roles:typeof patch.roles==='function'?patch.roles:PH_ROLE_MANAGE});
  return true;
}
// A tab is visible to a person when they are on the audience AND the tab's own predicate says so.
// A tab with no/broken predicate answers false for everyone but the managers: fail closed.
function _phUiTabAllowed(t,u){
  if(!t||!_phUiCanSee(u))return false;
  try{return typeof t.roles==='function'?t.roles(_phUiUser(u))===true:_phUiCanManage(u);}catch(e){return false;}
}
function phTabsFor(u){return PH_TABS.filter(function(t){return _phUiTabAllowed(t,u);});}
// WP10: the cutting floor (Kashif, login uzaib) lands on Today's Cutting - that is his job - and his Overview is a short "today" view.
// Managers keep Overview (the first tab) as the default. Anyone else on the audience gets the first tab they may open.
function phDefaultTab(u){
  const l=phTabsFor(u);
  if(!l.length)return null;
  if(!_phUiCanManage(u)){
    for(let i=0;i<l.length;i++)if(l[i].id==='cutting')return l[i];
  }
  return l[0];
}
// The tab to show for an id: that tab when this person may have it, else their default. null = no tabs at all.
function phResolveTab(id,u){
  const l=phTabsFor(u);
  for(let i=0;i<l.length;i++)if(l[i].id===id)return l[i];
  return phDefaultTab(u);
}
// WP10: the per-page "View only" chip is for someone who can only look. The cutting floor is NOT that (the top-bar chip says what his account
// does), so the pages draw no chip for him. ctx = the tab context ({readOnly,user}).
function phViewChipOn(ctx){
  if(!ctx||!ctx.readOnly)return false;
  return!(typeof phCanRecordFloor==='function'&&phCanRecordFloor(ctx.user)===true);
}

/* ── safe DOM builders (nothing here ever parses a string as HTML) ─────── */
function phEl(tag,cls,text,kids){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!==undefined&&text!==null&&text!==''){if(typeof phI18nSet==='function')phI18nSet(n,text);else n.textContent=String(text);}
  if(kids)for(let i=0;i<kids.length;i++)if(kids[i])n.appendChild(kids[i]);
  return n;
}
function phClear(n){while(n&&n.firstChild)n.removeChild(n.firstChild);return n;}
function _phUiBtn(cls,text,onclick,attrs){
  const b=phEl('button',cls,text);b.setAttribute('type','button');
  if(attrs)Object.keys(attrs).forEach(function(k){b.setAttribute(k,attrs[k]);});
  if(onclick)b.addEventListener('click',onclick);
  return b;
}

/* ── the one data load ─────────────────────────────────────────────────── */
let _phUiState='idle';        // idle | loading | done
let _phUiLoadP=null;
// Never rejects. Reads every stage through phLoadAll (cached stages are not re-read; a stage that failed IS
// re-read, which is what Retry and re-opening the page mean). Repaints the banner and panel when it settles.
function phUiLoad(opts){
  if(_phUiLoadP)return _phUiLoadP;
  const o=opts||{};
  _phUiState='loading';
  _phUiPaintData();
  let first;
  try{
    first=typeof phLoadAll==='function'?phLoadAll({force:!!o.force,only:o.only}):Promise.resolve({ok:false});
  }catch(e){first=Promise.resolve({ok:false});}
  const p=Promise.resolve(first).catch(function(){return{ok:false};}).then(function(r){
    _phUiLoadP=null;_phUiState='done';
    try{_phUiPaintData();}catch(e){}
    return r;
  });
  _phUiLoadP=p;
  return p;
}
// The truth about the load, computed from the data layer's own per-stage state at paint time.
function phUiStatus(){
  const out={loading:_phUiState!=='done',failed:[],allOk:false,stages:[]};
  if(typeof phLoadState!=='function'||typeof PH_STAGE_IDS==='undefined'||typeof PH_COLLECTIONS==='undefined'){
    out.failed.push({name:'js/ph-data.js',label:'Production Ops data layer',text:'js/ph-data.js did not load - refresh the page.',key:'shell.data_layer_missing'});
    out.loading=false;return out;
  }
  PH_STAGE_IDS.forEach(function(s){
    const st=phLoadState(s)||{state:'idle'};const c=PH_COLLECTIONS[s];
    const row={stage:s,name:c.col,label:c.label,state:st.state,n:st.n,truncated:!!st.truncated,doc:!!c.doc,text:null};
    if(st.state==='error'){
      row.text=typeof phErrText==='function'?phErrText(s,st.err):c.col+': read failed.';
      out.failed.push({stage:s,name:c.col,label:c.label,text:row.text});
    }
    out.stages.push(row);
  });
  out.allOk=!out.loading&&out.failed.length===0;
  return out;
}
// Retry re-reads only the stages that failed (the Store 429 lesson: never re-pull what already arrived).
function phRetry(){
  const only=phUiStatus().failed.map(function(f){return f.stage;}).filter(Boolean);
  return phUiLoad(only.length?{only:only}:{force:true});
}

/* ── tab panels ────────────────────────────────────────────────────────── */
function _phUiCtx(tab){
  const u=_phUiUser();
  return{
    tab:tab,user:u,canManage:_phUiCanManage(u),readOnly:!_phUiCanManage(u),
    status:phUiStatus(),
    get:function(s){return typeof phGet==='function'?phGet(s):{ok:false,state:'unknown',rows:null};},
    el:phEl,clear:phClear,
    repaint:_phUiPaintPanel,
    reload:function(){return phUiLoad({force:true});}
  };
}
function _phUiCard(title,kids){
  const c=phEl('section','ph-card');
  if(title)c.appendChild(phEl('h3','ph-card-title',title));
  (kids||[]).forEach(function(k){if(k)c.appendChild(k);});
  return c;
}
function _phUiHead(title,blurb,ctx){
  const h=phEl('header','ph-head');
  const row=phEl('div','ph-head-row',null,[phEl('h2','ph-title',title)]);
  if(phViewChipOn(ctx))row.appendChild(phEl('span','ph-chip ph-chip-view',phI18nD('shell.view_only')));
  h.appendChild(row);
  if(blurb)h.appendChild(phEl('p','ph-blurb',blurb));
  return h;
}
function _phUiSkeleton(){
  const w=phEl('div','ph-skelwrap');w.setAttribute('aria-busy','true');w.setAttribute('role','status');w.setAttribute('aria-label',phI18nAttr(phI18nD('shell.loading')));
  ['ph-skel-t','ph-skel-a','ph-skel-b','ph-skel-b'].forEach(function(c){w.appendChild(phEl('div','gv-skel ph-skel '+c));});
  return w;
}
function _phUiError(title,msg){
  const c=phEl('section','ph-card ph-card-err');c.setAttribute('role','alert');
  c.appendChild(phEl('h3','ph-card-title',title));
  c.appendChild(phEl('p','ph-note',msg));
  return c;
}
// One line about one stage, from the data layer. A failed or unread stage says so and NEVER prints a number.
function _phUiStageLine(row){
  const li=phEl('li','ph-line');
  li.appendChild(phEl('span','ph-line-name',row.label));
  li.appendChild(phEl('code','ph-code',row.name));
  let chip,txt;
  if(row.state==='ok'){
    chip=phEl('span','ph-chip ph-chip-ok',phI18nD('shell.chip_loaded'));
    txt=row.doc?(row.n?phI18nD('shell.saved'):phI18nD('shell.none_saved_defaults')):phI18nD(row.n===1?'shell.record_one':'shell.record_many',{n:row.n});
  }else if(row.state==='error'){
    chip=phEl('span','ph-chip ph-chip-bad',phI18nD('shell.chip_failed'));txt=row.text?_phUiErrText(row):phI18nD('shell.read_failed');
  }else{
    chip=phEl('span','ph-chip ph-chip-wait',phI18nD('shell.chip_loading'));txt=phI18nD('shell.not_loaded_yet');
  }
  li.appendChild(chip);
  li.appendChild(phEl('span','ph-line-txt',txt));
  return li;
}
function _phRenderOverview(host,ctx){
  host.appendChild(_phUiHead(phI18nD('shell.tab_overview'),phI18nD('shell.overview_blurb'),ctx));
  const ul=phEl('ul','ph-lines');
  ctx.status.stages.forEach(function(r){ul.appendChild(_phUiStageLine(r));});
  if(!ctx.status.stages.length)ctx.status.failed.forEach(function(f){ul.appendChild(_phUiStageLine({label:f.label,name:f.name,state:'error',text:f.text}));});
  host.appendChild(_phUiCard(phI18nD('shell.data_read_open'),[ul]));
  const tabs=phTabsFor(ctx.user);
  const tl=phEl('ul','ph-lines');
  tabs.forEach(function(t){tl.appendChild(phEl('li','ph-line',null,[phEl('span','ph-line-name',t.lkey?phI18nD(t.lkey):t.label),phEl('span','ph-line-txt',t.id===ctx.tab.id?phI18nD('shell.you_are_here'):phI18nD('shell.placeholder_until_built'))]));});
  host.appendChild(_phUiCard(phI18nD('shell.tabs_you_can_open'),[tl]));
  if(ctx.readOnly)host.appendChild(phEl('p','ph-note',phI18nD('shell.readonly_note')));
}
// A placeholder tab: says what it will be, then prints the real state of the collections it will read.
function _phPlaceholder(spec){
  return function(host,ctx){
    host.appendChild(_phUiHead(spec.title,spec.blurb,ctx));
    host.appendChild(phEl('p','ph-placeholder','Placeholder - this tab has not been built yet.'));
    const ul=phEl('ul','ph-lines');
    (spec.stages||[]).forEach(function(s){
      const row=ctx.status.stages.filter(function(r){return r.stage===s;})[0];
      if(row)ul.appendChild(_phUiStageLine(row));
    });
    if(ul.firstChild)host.appendChild(_phUiCard('What it will read',[ul]));
    // a few of the real records, when cheap: every value goes in through textContent (stored text is somebody else's)
    let names=[];
    if(typeof spec.list==='function'){try{names=spec.list(ctx)||[];}catch(e){names=[];}}
    if(names.length){
      const nl=phEl('ul','ph-lines');
      names.slice(0,12).forEach(function(n){nl.appendChild(phEl('li','ph-line',null,[phEl('span','ph-line-name',n)]));});
      if(names.length>12)nl.appendChild(phEl('li','ph-line',null,[phEl('span','ph-line-txt','and '+(names.length-12)+' more')]));
      host.appendChild(_phUiCard('First records read',[nl]));
    }
  };
}
// The text of a field of every row of a stage, [] unless the stage was read successfully (rows is null otherwise).
function _phUiNames(stage,field){
  return function(ctx){
    const g=ctx.get(stage);
    return g&&g.ok&&Array.isArray(g.rows)?g.rows.map(function(r){return String(r[field]||r.fbKey||'');}).filter(Boolean):[];
  };
}

/* ── painting ──────────────────────────────────────────────────────────── */
let _phUiTab='';
// A failed read's sentence: the data layer writes English; the known shapes get their Urdu pair, anything else stays as written.
function _phUiErrText(f){return f&&f.key?phI18nD(f.key):(typeof phI18nErr==='function'?phI18nErr(f&&f.text):(f&&f.text));}
function _phUiPaintBanner(){
  const host=document.getElementById('ph-banner');if(!host)return;
  phClear(host);
  if(typeof phI18nUrduOn==='function'&&phI18nUrduOn()){const rn=phI18nReviewNotice(document);if(rn)host.appendChild(rn);}
  if(_phUiState!=='done')return;
  const st=phUiStatus();
  if(!st.failed.length)return;
  const card=phEl('section','ph-card ph-card-err');card.setAttribute('role','alert');
  card.appendChild(phEl('h3','ph-card-title',phI18nD(st.failed.length===1?'shell.could_not_read_one':'shell.could_not_read_many',{n:st.failed.length})));
  const ul=phEl('ul','ph-lines');
  st.failed.forEach(function(f){ul.appendChild(phEl('li','ph-line',null,[phEl('code','ph-code',f.name),phEl('span','ph-line-txt',_phUiErrText(f))]));});
  card.appendChild(ul);
  card.appendChild(phEl('p','ph-note',phI18nD('shell.not_shown_as_zero')));
  card.appendChild(_phUiBtn('ph-btn ph-btn-primary',phI18nD('shell.retry'),function(){phRetry();}));
  host.appendChild(card);
}
function _phUiPaintPanel(){
  const host=document.getElementById('ph-panel');if(!host)return;
  phClear(host);
  const u=_phUiUser();
  if(!_phUiCanSee(u)){host.appendChild(_phUiError(phI18nD('shell.no_access'),phI18nD('shell.no_access_msg')));return;}
  const tab=phResolveTab(_phUiTab,u);
  if(!tab){host.appendChild(_phUiError(phI18nD('shell.no_tabs'),phI18nD('shell.no_tabs_msg')));return;}
  _phUiTab=tab.id;
  if(_phUiState!=='done'){host.appendChild(_phUiSkeleton());return;}
  try{
    if(typeof tab.render!=='function')throw new Error('this tab has no render function');
    tab.render(host,_phUiCtx(tab));
  }catch(e){
    phClear(host);
    host.appendChild(_phUiError(phI18nD('shell.tab_failed'),String(e&&e.message||e)));
    if(typeof console!=='undefined')console.warn('[prod-ops] tab "'+tab.id+'" failed:',e);
  }
  if(!host.firstChild)host.appendChild(_phUiError(tab.lkey?phI18nD(tab.lkey):tab.label,phI18nD('shell.tab_empty')));
}
function _phUiPaintData(){
  if(typeof document==='undefined')return;
  _phUiPaintBanner();
  _phUiPaintPanel();
}

/* ── the page ──────────────────────────────────────────────────────────── */
// renderPage's one line: id==='prod-ops' -> phRenderPage. Draws the canvas (banner + panel), then starts the load.
function phRenderPage(id){
  const m=document.getElementById('main-content');if(!m)return;
  phClear(m);
  if(!_phUiCanSee()){
    m.appendChild(phEl('div','empty',phI18nD('shell.restricted')));
    return;
  }
  const canvas=phEl('div','ph-canvas');
  const banner=phEl('div','ph-banner');banner.id='ph-banner';
  const panel=phEl('div','ph-panel');panel.id='ph-panel';panel.setAttribute('role','region');panel.setAttribute('aria-label','Production Ops tab');
  canvas.appendChild(banner);canvas.appendChild(panel);m.appendChild(canvas);
  const t=phResolveTab(_phUiTab,_phUiUser());
  if(t)_phUiTab=t.id;
  _phUiPaintData();      // the shell paints first (skeleton); nothing waits on the network
  // Loads once on open. A visit after a clean load re-reads nothing; one after a failure re-reads only what failed.
  if(!(_phUiState==='done'&&phUiStatus().allOk))phUiLoad();
}

/* ── the takeover (copied from Inventory Intel's _siTk*, own names and classes) ── */
let _phUiOn=false,_phUiMin=false,_phUiKeyWired=false,_phUiRailKey='';
const PH_ESCAPE_GUARDS=[];
function phAddEscapeGuard(fn){if(typeof fn==='function'&&PH_ESCAPE_GUARDS.indexOf(fn)<0)PH_ESCAPE_GUARDS.push(fn);}

function _phTkMount(){
  if(typeof document==='undefined'||!document.body)return;
  if(document.getElementById('ph-tk-bar')&&document.getElementById('ph-tk-rail'))return;
  const bar=phEl('div','ph-tk-bar');bar.id='ph-tk-bar';
  const exit=_phUiBtn('ph-tk-exit',phI18nD('shell.exit'),function(){phExit();});exit.id='ph-tk-exit';
  const title=phEl('div','ph-tk-title',phI18nD('shell.title'));title.id='ph-tk-title';
  const chip=phEl('span','ph-chip ph-chip-view ph-tk-chip',PH_CHIP_FLOOR);chip.id='ph-tk-chip';
  const lang=phEl('div','phi-bar ph-tk-lang');lang.id='ph-tk-lang';
  const tog=_phUiBtn('ph-tk-toggle',phI18nD('shell.menu_hide'),function(){phToggleRail();},{'aria-expanded':'true','aria-controls':'ph-tk-rail'});tog.id='ph-tk-toggle';
  bar.appendChild(exit);bar.appendChild(title);bar.appendChild(chip);bar.appendChild(lang);bar.appendChild(tog);
  const rail=phEl('nav','ph-tk-rail');rail.id='ph-tk-rail';rail.setAttribute('aria-label',phI18nAttr(phI18nD('shell.rail_label')));
  // two direct children of <body>, so each is a fixed element of the root stacking context
  document.body.appendChild(bar);document.body.appendChild(rail);
  _phTkPaintLang();
}
// The Urdu / English switch (everyone has it; it is stored per device, and safe when storage is blocked: phI18nSetLang keeps the choice in memory).
// A change repaints the bar, the rail and the open tab (phI18nOnChange below, wired once at load).
function _phTkPaintLang(){
  if(typeof document==='undefined')return;
  const box=document.getElementById('ph-tk-lang');
  try{document.body.classList.toggle('ph-ur',typeof phI18nUrduOn==='function'&&phI18nUrduOn());}catch(e){}
  if(!box)return;
  phClear(box);
  if(typeof phI18nToggleNode==='function')box.appendChild(phI18nToggleNode(document,_phUiUser()));
}
function _phTkPaintBar(){
  const exit=document.getElementById('ph-tk-exit');if(exit)phI18nSet(exit,phI18nD('shell.exit'));
  const t=phResolveTab(_phUiTab,_phUiUser());
  const sub=document.getElementById('ph-tk-title');
  if(sub)phI18nSet(sub,t?phI18nD('shell.title_tab',{tab:t.lkey?phI18nD(t.lkey):t.label}):phI18nD('shell.title'));
  const tog=document.getElementById('ph-tk-toggle');
  if(tog)phI18nSet(tog,phI18nD(_phUiMin?'shell.menu_show':'shell.menu_hide'));
  const rail=document.getElementById('ph-tk-rail');
  if(rail)rail.setAttribute('aria-label',phI18nAttr(phI18nD('shell.rail_label')));
  _phTkPaintLang();
}
function _phTkRailKey(){
  const u=_phUiUser();
  return phTabsFor(u).map(function(t){return t.id+':'+t.label+':'+t.short;}).join('|')+'#'+_phUiTab+'#'+(_phUiCanManage(u)?'m':'v')+'#'+(phI18nUrduOn()?'ur':'en');
}
function _phTkPaintRail(){
  const rail=document.getElementById('ph-tk-rail');if(!rail)return;
  const key=_phTkRailKey();
  if(key!==_phUiRailKey||!rail.firstChild){
    _phUiRailKey=key;
    phClear(rail);
    phTabsFor(_phUiUser()).forEach(function(t){
      const on=t.id===_phUiTab;
      const b=phEl('button','ph-tk-item'+(on?' on':''));
      b.setAttribute('type','button');b.setAttribute('data-tab',t.id);b.setAttribute('title',phI18nAttr(t.lkey?phI18nD(t.lkey):t.label));
      if(on)b.setAttribute('aria-current','page');
      const mono=phEl('span','ph-tk-mono',String(t.short||t.label).slice(0,2));
      mono.setAttribute('aria-hidden','true');
      b.appendChild(mono);
      b.appendChild(phEl('span','ph-tk-label',t.lkey?phI18nD(t.lkey):t.label));
      b.addEventListener('click',function(){phGoTab(t.id);});
      rail.appendChild(b);
    });
  }
  const chip=document.getElementById('ph-tk-chip');
  if(chip){
    const c=phChipFor();
    chip.className='ph-chip ph-chip-view ph-tk-chip'+(c.show?'':' ph-hidden');
    phI18nSet(chip,c.key?phI18nD(c.key):(c.text||PH_CHIP_FLOOR));chip.setAttribute('title',c.tkey?phI18nAttr(phI18nD(c.tkey)):c.title);
  }
  _phTkRevealActive(rail);
}
// On a phone the rail is a sideways dock: the active tab must be on screen on EVERY route into it (a tab press, a hash, the first open).
function _phTkRevealActive(rail){
  try{
    const a=rail&&rail.querySelector?rail.querySelector('.ph-tk-item.on'):null;
    if(!a)return;
    if(typeof a.scrollIntoView==='function')a.scrollIntoView({block:'nearest',inline:'center'});
    else if(typeof a.offsetLeft==='number'&&typeof rail.clientWidth==='number')rail.scrollLeft=Math.max(0,a.offsetLeft-(rail.clientWidth-(a.offsetWidth||0))/2);
  }catch(e){}
}
// While the takeover is up, the app's OWN top bar, sidebar and phone nav sit behind it: they must not take Tab or Enter
// (Sign out is on that bar). We set inert and aria-hidden, remember that WE did, and put them back exactly on leave.
const PH_INERT_SELECTORS=Object.freeze(['.topbar','#sidebar','#mob-nav']);
function _phTkInert(on){
  try{
    PH_INERT_SELECTORS.forEach(function(sel){
      const list=document.querySelectorAll?document.querySelectorAll(sel):[];
      for(let i=0;i<list.length;i++){
        const n=list[i];
        if(on){
          if(n.getAttribute('data-ph-inert')===null){
            n.setAttribute('data-ph-inert',n.hasAttribute('aria-hidden')?'h'+n.getAttribute('aria-hidden'):'');
            if(!n.hasAttribute('inert'))n.setAttribute('inert','');else n.setAttribute('data-ph-inert',n.getAttribute('data-ph-inert')+'|had');
            n.setAttribute('aria-hidden','true');
          }
        }else if(n.getAttribute('data-ph-inert')!==null){
          const mark=n.getAttribute('data-ph-inert');
          if(mark.indexOf('|had')<0)n.removeAttribute('inert');
          if(mark.charAt(0)==='h')n.setAttribute('aria-hidden',mark.slice(1).split('|')[0]);else n.removeAttribute('aria-hidden');
          n.removeAttribute('data-ph-inert');
        }
      }
    });
  }catch(e){}
}
function _phTkSetHash(tab){
  try{
    const base=location.pathname+(location.search||''),want=tab?'#prodops/'+tab:'';
    if(tab){if(String(location.hash||'')!==want)history.replaceState(null,'',base+want);}
    else if(PH_HASH.test(String(location.hash||'')))history.replaceState(null,'',base);
  }catch(e){}
}
function _phTkApplyClasses(on){
  try{
    const b=document.body,h=document.documentElement,m=document.getElementById('main-content');
    b.classList.toggle('ph-fullscreen',!!on);h.classList.toggle('ph-fullscreen',!!on);
    b.classList.toggle('ph-rail-min',!!on&&_phUiMin);
    if(m)m.classList.toggle('ph-takeover',!!on);
  }catch(e){}
  _phTkInert(!!on);
}
function _phTkSync(){   // repaint the rail from the one list; keep the address bar naming the tab
  if(!_phUiOn||typeof document==='undefined')return;
  const t=phResolveTab(_phUiTab,_phUiUser());
  if(t)_phUiTab=t.id;
  _phTkPaintRail();
  const sub=document.getElementById('ph-tk-title');
  _phTkPaintBar();
  _phTkSetHash(t?t.id:'');
}
function _phTkEnter(){
  if(_phUiOn)return;
  try{
    if(!_phUiKeyWired&&typeof document!=='undefined'&&document.addEventListener){document.addEventListener('keydown',_phTkKey);_phUiKeyWired=true;}   // once, on first open: not at load
    try{_phUiMin=localStorage.getItem(PH_RAIL_KEY)==='min';}catch(e){_phUiMin=false;}
    _phTkMount();_phUiOn=true;_phUiRailKey='';_phTkApplyClasses(true);_phTkSync();
    const tog=document.getElementById('ph-tk-toggle');
    if(tog){phI18nSet(tog,phI18nD(_phUiMin?'shell.menu_show':'shell.menu_hide'));tog.setAttribute('aria-expanded',_phUiMin?'false':'true');}
  }catch(e){_phUiOn=true;_phTkLeave();console.warn('[prod-ops] takeover failed, left:',e);}
}
function _phTkLeave(){
  const was=_phUiOn;_phUiOn=false;
  _phTkApplyClasses(false);
  if(was)_phTkSetHash('');
}
// Called after every showPage: the PAGE decides, never a flag set elsewhere. Not on the audience = no takeover.
function _phTkOnPage(){
  const want=typeof currentPage!=='undefined'&&currentPage===PH_PAGE_ID&&_phUiCanSee();
  if(want&&!_phUiOn)_phTkEnter();else if(!want&&_phUiOn)_phTkLeave();else if(want)_phTkSync();
}
// Switch tab. A tab this person may not have is REFUSED (false), not silently shown.
function phGoTab(id){
  const u=_phUiUser();
  const l=phTabsFor(u).filter(function(t){return t.id===id;});
  if(!l.length)return false;
  _phUiTab=l[0].id;
  _phTkSync();
  try{const m=document.getElementById('main-content');if(m)m.scrollTop=0;}catch(e){}
  _phUiPaintPanel();
  return true;
}
function phToggleRail(){
  _phUiMin=!_phUiMin;
  try{localStorage.setItem(PH_RAIL_KEY,_phUiMin?'min':'full');}catch(e){}
  _phTkApplyClasses(_phUiOn);
  const t=document.getElementById('ph-tk-toggle');
  if(t){phI18nSet(t,phI18nD(_phUiMin?'shell.menu_show':'shell.menu_hide'));t.setAttribute('aria-expanded',_phUiMin?'false':'true');}
}
function phExit(){   // never strands: the takeover comes down FIRST, then the navigation is attempted
  _phTkLeave();
  try{if(typeof window.showPage==='function')window.showPage('dashboard');}catch(e){console.warn('[prod-ops] exit navigation failed:',e);}
}
function _phTkParseHash(){
  const m=PH_HASH.exec(String(typeof location!=='undefined'?location.hash||'':''));
  return m?{tab:m[1]||''}:null;
}
function _phTkConsumeHash(){
  const link=_phTkParseHash();
  if(!link||typeof session==='undefined'||!session||!_phUiCanSee())return false;   // fail closed: no session / not on the audience, nothing opens
  const t=phResolveTab(link.tab,_phUiUser());                                       // unknown or not-yours -> your default tab, never a blank page
  if(!t)return false;
  _phUiTab=t.id;
  if(currentPage===PH_PAGE_ID){phGoTab(t.id);_phTkOnPage();return true;}
  if(typeof window.showPage==='function')window.showPage(PH_PAGE_ID);
  return true;
}
function _phTkKey(e){
  if(!_phUiOn||!e)return;
  const k=e.key;
  if(k==='Escape'){
    const t=e.target,tag=t&&t.tagName?String(t.tagName).toUpperCase():'';
    if(e.defaultPrevented||tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(t&&t.isContentEditable===true))return;
    for(let i=0;i<PH_ESCAPE_GUARDS.length;i++){try{if(PH_ESCAPE_GUARDS[i]()===true)return;}catch(x){}}   // an open drawer/dialog closes itself first
    phExit();return;
  }
  const rail=document.getElementById('ph-tk-rail');
  if(rail&&e.target&&e.target.closest&&e.target.closest('#ph-tk-rail')&&(k==='ArrowDown'||k==='ArrowUp'||k==='ArrowLeft'||k==='ArrowRight'||k==='Home'||k==='End')){
    const items=Array.prototype.slice.call(rail.children);
    const cur=e.target.closest('.ph-tk-item');const i=items.indexOf(cur);if(i<0)return;
    const next=k==='Home'?0:k==='End'?items.length-1:(k==='ArrowDown'||k==='ArrowRight')?(i+1)%items.length:(i-1+items.length)%items.length;
    items[next].focus();if(e.preventDefault)e.preventDefault();
  }
}
(function(){   // wired once at load, like boards.js and shopify.js: every route out of the page passes through showPage
  if(typeof window==='undefined')return;
  // The language switch changed: repaint the bar, the rail and the open tab. Nothing is re-read (the data layer's state is untouched).
  if(typeof phI18nOnChange==='function')phI18nOnChange(function(){
    try{
      if(_phUiOn){_phUiRailKey='';_phTkSync();}
      if(typeof document!=='undefined'&&document.getElementById('ph-panel')){_phUiPaintBanner();_phUiPaintPanel();}
    }catch(e){}
  });
  if(typeof window.showPage==='function'&&!window.showPage.__phTk){
    const o=window.showPage;
    const w=function(){const r=o.apply(this,arguments);try{_phTkOnPage();}catch(e){}
      try{Promise.resolve(r).then(function(){try{_phTkOnPage();}catch(e){}},function(){try{_phTkOnPage();}catch(e){}});}catch(e){}
      return r;};
    w.__phTk=true;window.showPage=w;
  }
  if(window.addEventListener)window.addEventListener('hashchange',function(){try{_phTkConsumeHash();}catch(e){}});
})();
// startApp is wrapped (the boards.js / shopify.js pattern, not an edit to js/auth.js): the original runs, then a cold #prodops link is consumed.
const _phTkOrigStartApp=window.startApp;
if(typeof _phTkOrigStartApp==='function'){
  window.startApp=async function(){
    const out=await _phTkOrigStartApp.apply(this,arguments);
    try{_phTkConsumeHash();}catch(e){console.warn('[prod-ops] deep link failed:',e);}
    return out;
  };
}

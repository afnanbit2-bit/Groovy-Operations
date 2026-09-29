/* Groovy Operations — notes.js
   Plain global JS (NO modules), loaded via <script src> after auth.js.
   Firebase globals (db, getDoc, getDocs, setDoc, updateDoc, addDoc,
   deleteDoc, query, where, collection, doc) are bridged onto window by the
   bootstrap module in index.html — see "File architecture" in CLAUDE.md.

   Phase 1 of the Notion+Milanote module (see CLAUDE.md "Creative Hub /
   Notes module"): Notion-lite block pages, reached through the "Creative
   Hub" card-grid landing page (renderCreativeHub, _HUB_CATEGORIES) also
   defined in this file — Mood Boards (js/boards.js) is the second live
   category; SOPs & Guidelines, Storage and Chat are 'soon' placeholder
   tiles, not yet built. Every signed-in user can create Notes pages, either
   'shared' (TEAM — team wiki, readable by everyone signed in) or 'personal'
   (PRIVATE — readable only by the owner).

   Firestore: one doc per page in `notes_pages`, blocks stored as a plain
   array field on the doc (no subcollection) — simplest thing that works at
   this app's scale, and keeps the whole page in one read/write. See
   firestore.rules for the ownerUid-based read/write split. */

// ── State ──
let notesLoaded=false;
let _notesLoadError=null;     // set when every notes query failed (see loadNotesData)
let notesPages=[];            // merged list: every 'shared' page + the signed-in user's own pages
let _notesSearch='';
let _notesViewingId=null;     // id of the page open in the detail view
let _notesEditPage=null;      // {id,title,icon,visibility,ownerUid,ownerName,ownerUsername,createdAt,updatedAt}
let _notesEditBlocks=[];      // working copy of the open page's blocks
let _notesSaveTimer=null;
let _notesSearchTimer=null;
let _notesBlockSeq=0;

const _NOTES_BLOCK_TYPES=[
  {type:'paragraph',label:'Text',hint:'Plain paragraph',keys:['paragraph','plain','text','p']},
  {type:'h1',label:'Heading 1',hint:'# ',keys:['heading','title','h1','large']},
  {type:'h2',label:'Heading 2',hint:'## ',keys:['heading','subtitle','h2','medium']},
  {type:'bullet',label:'Bulleted list',hint:'- ',keys:['bullet','list','ul','unordered']},
  {type:'numbered',label:'Numbered list',hint:'1. ',keys:['number','list','ol','ordered']},
  {type:'checklist',label:'Checklist',hint:'[] ',keys:['todo','to-do','task','check','checkbox']},
  {type:'quote',label:'Quote',hint:'> ',keys:['quote','callout','blockquote']},
  {type:'divider',label:'Divider',hint:'---',keys:['divider','line','rule','separator','hr']},
  {type:'image',label:'Image',hint:'Upload',keys:['image','photo','picture','upload']}
];

// ── Slash menu + block menu state ──
// _notesSlash: null, or {idx,query,sel,mode,items}. mode 'slash' = typed "/"
// at the start of a block (the typed text is cleared on choose); 'insert' =
// the + button, on a fresh empty block; 'turn' = the block menu's "Turn
// into", which keeps the block's text.
let _notesSlash=null;
let _notesPopState=null;      // {rows,sel} of whatever the popover shows

function _notesEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function _notesRelTime(ts){
  if(!ts)return'';
  const diff=Date.now()-ts,m=Math.floor(diff/60000);
  if(m<1)return'just now';
  if(m<60)return m+'m ago';
  const h=Math.floor(m/60);
  if(h<24)return h+'h ago';
  const d=Math.floor(h/24);
  if(d<30)return d+'d ago';
  return new Date(ts).toLocaleDateString('en-GB');
}

function _notesNewBlock(type){
  return{id:'b'+(++_notesBlockSeq)+'_'+Date.now(),type:type||'paragraph',text:'',checked:false,imageUrl:''};
}

function _notesCanEdit(p){
  return!!(p&&session&&(p.ownerUid===session.uid||session.role==='owner'));
}

// ── Load (list) ──
// Two single-field queries (visibility=='shared', ownerUid==me) merged
// client-side, same "fetch once, filter in memory" approach as Monitor —
// each query maps 1:1 onto a clause of the firestore.rules read condition,
// so it never needs a composite index and never risks the classic Firestore
// gotcha where a broader query gets rejected because a rule can't prove
// every possible result is readable.
// Never rejects — js/shared.js dispatches this as `loadNotesData().then(render)`
// with no catch, so a rejected query (rules older than the app, say) would
// otherwise leave the page on its loading skeleton forever with no message.
// Same independent-settle treatment as loadBoardsData: one denied query does
// not hide the pages the other one did return.
async function loadNotesData(){
  const jobs=[
    {name:'team pages',p:()=>getDocs(query(collection(db,'notes_pages'),where('visibility','==','shared')))},
    {name:'your pages',p:()=>getDocs(query(collection(db,'notes_pages'),where('ownerUid','==',session.uid)))}
  ];
  const settled=await Promise.allSettled(jobs.map(j=>j.p()));
  const map={};
  let ok=0,firstErr='';
  settled.forEach((r,i)=>{
    if(r.status==='fulfilled'){ok++;r.value.forEach(d=>{map[d.id]={id:d.id,...d.data()};});}
    else{
      const msg=(r.reason&&(r.reason.message||r.reason.code))||String(r.reason);
      if(!firstErr)firstErr=msg;
      console.warn('[notes] query failed ('+jobs[i].name+'):',msg);
    }
  });
  _notesLoadError=ok?null:(firstErr||'Could not read notes');
  notesPages=Object.values(map).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  notesLoaded=true;
}
window.notesRetryLoad=async function(){
  notesLoaded=false;_notesLoadError=null;
  const m=document.getElementById('main-content');
  if(m&&typeof gvSkeleton==='function')m.innerHTML=gvSkeleton(6);
  await loadNotesData();
  if(typeof currentPage!=='undefined'&&currentPage==='notes'){
    const el=document.getElementById('main-content');
    if(el)el.innerHTML=renderNotesPage();
  }
};

// ── Creative Hub (landing page) ──
// A category directory. Notes (this file) is the first category; Phase 2's
// Milanote-style boards land here as additional entries later — keep this
// array-driven so adding one is a one-line change, not a page rewrite.
// Card-grid hub, one tile per category. 'soon' tiles are greyed and
// non-navigating (see onHubTileClick) — they preview the full roadmap
// (SOPs & Guidelines, Storage, Chat) rather than only showing what's built,
// per Afnan's explicit call. accent is a CSS var name (see css/main.css
// :root — --cat-notes etc.), not a literal color, so both are edited in one
// place if the palette ever changes.
const _HUB_CATEGORIES=[
  {id:'notes',pageId:'notes',label:'Notes',desc:'Team Wiki, private notes',accent:'--cat-notes',status:'live'},
  {id:'boards',pageId:'boards',label:'Mood Boards',desc:'Visual reference boards you drag, resize and connect',accent:'--cat-boards',status:'live'},
  {id:'sops',label:'SOPs & Guidelines',desc:'Formal procedures with versioning',accent:'--cat-sops',status:'soon'},
  {id:'storage',label:'Storage',desc:'Shared files and documents',accent:'--cat-storage',status:'soon'},
  {id:'chat',label:'Chat',desc:'Team messaging',accent:'--cat-chat',status:'soon'}
];
function renderCreativeHub(){
  return`
  <div class="page-head" style="margin-bottom:16px">
    <h2 style="margin:0;font-size:31px;letter-spacing:-.01em">Milanote</h2>
    <div style="color:var(--muted);font-size:14.5px;margin-top:6px">A shared space for docs and boards</div>
  </div>
  <div class="hub-grid">${_HUB_CATEGORIES.map(c=>`
    <button class="hub-tile${c.status==='soon'?' soon':''}" style="--tile-accent:var(${c.accent})" onclick="window.onHubTileClick('${c.id}')">
      ${c.status==='soon'?'<span class="soon-pill">Coming soon</span>':''}
      <div class="tile-title">${_notesEsc(c.label)}</div>
      <div class="tile-desc">${_notesEsc(c.desc)}</div>
    </button>`).join('')}
  </div>`;
}
window.onHubTileClick=function(id){
  const cat=_HUB_CATEGORIES.find(c=>c.id===id);
  if(cat&&cat.status==='live'){window.showPage(cat.pageId);return;}
  showToast((cat?cat.label:'This')+' — coming soon');
};

// ── Notes category: two segregated sections, TEAM and PRIVATE ──
// Deliberately not a tab switcher — both sections are always visible at
// once, since "segregated" was the explicit ask, not "filtered".
function renderNotesPage(){
  return`
  <button class="back-btn" onclick="window.showPage('creative-hub')">← Back to Milanote</button>
  <div class="page-head" style="margin-bottom:10px">
    <div><h2 style="margin:0">Notes</h2><div style="color:var(--muted);font-size:13px;margin-top:2px">Team Wiki, private notes</div></div>
  </div>
  <input type="text" id="notes-search" placeholder="Search notes…" value="${_notesEsc(_notesSearch)}" oninput="window.notesSearchInput(this.value)" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:9px;font-size:14px;font-family:inherit;margin-bottom:16px;box-sizing:border-box">
  ${_notesLoadError?`<div class="board-load-error">
    <div style="font-weight:700;font-size:14.5px;margin-bottom:4px">Could not load notes</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.5">${_notesEsc(_notesLoadError)}</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.5;margin-top:6px">If that says <em>missing or insufficient permissions</em>, the Firestore rules in the Firebase Console are older than this app — republish <code>firestore.rules</code>.</div>
    <button class="btn-sm" style="margin-top:10px" onclick="window.notesRetryLoad()">Retry</button>
  </div>`:`<div id="notes-sections">${_notesRenderSections()}</div>`}`;
}

function _notesMatches(p,q){
  return!q||(p.title||'').toLowerCase().includes(q)||(p.blocks||[]).some(b=>(b.text||'').toLowerCase().includes(q));
}
function _notesRenderSections(){
  const q=_notesSearch.trim().toLowerCase();
  const team=notesPages.filter(p=>p.visibility==='shared'&&_notesMatches(p,q));
  const priv=notesPages.filter(p=>p.visibility!=='shared'&&_notesMatches(p,q));
  return`
  <div class="notes-section">
    <div class="notes-section-head"><h3>TEAM</h3><button class="btn-sm" onclick="window.notesCreatePage('shared')">+ New</button></div>
    ${team.length?team.map(_notesCardHTML).join(''):'<div class="empty">No team notes yet.</div>'}
  </div>
  <div class="notes-section">
    <div class="notes-section-head"><h3>PRIVATE</h3><button class="btn-sm outline" onclick="window.notesCreatePage('personal')">+ New</button></div>
    ${priv.length?priv.map(_notesCardHTML).join(''):'<div class="empty">No private notes yet.</div>'}
  </div>`;
}
function _notesCardHTML(p){
  const vis=p.visibility==='shared'?'TEAM':'PRIVATE';
  return`<div class="card" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px" onclick="window.notesOpenPage('${p.id}')">
    <div style="min-width:0">
      <div style="font-weight:600;font-size:15px">${_notesEsc(p.title||'Untitled')}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${vis}${p.ownerName?(' · '+_notesEsc(p.ownerName)):''}${p.updatedAt?(' · updated '+_notesRelTime(p.updatedAt)):''}</div>
    </div>
    <div style="color:var(--muted);font-size:17px;flex-shrink:0">›</div>
  </div>`;
}

window.notesSearchInput=function(val){
  _notesSearch=val;
  clearTimeout(_notesSearchTimer);
  _notesSearchTimer=setTimeout(()=>{const s=document.getElementById('notes-sections');if(s)s.innerHTML=_notesRenderSections();},180);
};

window.notesCreatePage=async function(visibility){
  try{
    const ref=await addDoc(collection(db,'notes_pages'),{
      title:'Untitled',icon:'📄',
      visibility:visibility==='shared'?'shared':'personal',
      ownerUid:session.uid,ownerName:session.name,ownerUsername:session.u,
      blocks:[_notesNewBlock('paragraph')],
      createdAt:Date.now(),updatedAt:Date.now(),updatedByName:session.name
    });
    notesLoaded=false;
    logActivity('Note page created',`${session.name} created "${visibility==='shared'?'a shared':'a personal'}" note page`);
    _notesViewingId=ref.id;
    window.showPage('note-detail');
  }catch(e){showToast('Could not create page: '+(e.message||e),true);}
};

window.notesOpenPage=function(id){_notesViewingId=id;window.showPage('note-detail');};

window.notesBack=function(){_notesPopClose();_notesSaveNow();window.showPage('notes');};

// ── Detail view ──
async function _notesOpenDetail(){
  const m=document.getElementById('main-content');
  let p=notesPages.find(x=>x.id===_notesViewingId);
  if(!p){
    m.innerHTML=gvSkeleton(4);
    try{
      const snap=await getDoc(doc(db,'notes_pages',_notesViewingId));
      if(!snap.exists()){m.innerHTML='<div class="empty">Page not found.</div>';return;}
      p={id:snap.id,...snap.data()};
    }catch(e){m.innerHTML='<div class="empty">Could not load page: '+(e.message||e)+'</div>';return;}
  }
  _notesEditPage={id:p.id,title:p.title||'Untitled',icon:p.icon||'📄',visibility:p.visibility||'personal',ownerUid:p.ownerUid,ownerName:p.ownerName,ownerUsername:p.ownerUsername,createdAt:p.createdAt,updatedAt:p.updatedAt};
  _notesEditBlocks=(p.blocks&&p.blocks.length?p.blocks:[_notesNewBlock('paragraph')]).map(b=>({...b}));
  _notesRenderDetailAndHydrate();
}

function _notesRenderDetailAndHydrate(){
  const m=document.getElementById('main-content');
  if(!m)return;
  _notesPopClose();
  m.innerHTML=renderNoteDetailPage();
  _notesHydrateBlocks();
}

function renderNoteDetailPage(){
  const p=_notesEditPage;
  if(!p)return'<div class="empty">No page loaded.</div>';
  const canEdit=_notesCanEdit(p);
  const visLabel=p.visibility==='shared'?'TEAM':'PRIVATE';
  const updated=p.updatedAt?_notesRelTime(p.updatedAt):'';
  return`
  <button class="back-btn" onclick="window.notesBack()">← Back to Notes</button>
  <div class="card" style="padding:20px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:6px">
      <input type="text" id="notes-title-input" value="${_notesEsc(p.title)}" ${canEdit?'':'readonly'} oninput="window.notesTitleInput(this.value)" placeholder="Untitled" aria-label="Page title" class="notes-title">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${canEdit?`<button class="btn-sm" onclick="window.notesToggleVisibility()">${visLabel} — change</button>`:`<span style="font-size:12px;color:var(--muted)">${visLabel}</span>`}
        ${canEdit?`<button class="btn-sm" style="background:var(--accent-urgent)" onclick="window.notesDeletePage()">Delete</button>`:''}
      </div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:16px">${p.ownerName?('by '+_notesEsc(p.ownerName)+' · '):''}${updated?('updated '+updated):''}${!canEdit?' · read-only':''}${canEdit?' · <span class="note-save-status" id="note-save-status">Saved</span>':''}</div>
    <div class="notes-doc">
      <div id="notes-blocks">${_notesRenderBlocksHTML(_notesEditBlocks,canEdit)}</div>
      ${canEdit?`<button type="button" class="notes-add" onclick="window.notesAddBlock()">+ Add a block</button>`:''}
    </div>
  </div>`;
}

function _notesPlaceholder(type){
  return{paragraph:"Type '/' for commands",
    h1:'Heading 1',h2:'Heading 2',bullet:'List item',numbered:'List item',
    checklist:'To-do',quote:'Quote'}[type]||'';
}

// Renders block STRUCTURE only (empty contenteditable bodies) — text is
// filled in afterwards by _notesHydrateBlocks() via textContent, never by
// interpolating stored text into the HTML string. Blocks are user-authored
// and a 'shared' page's blocks are rendered into every other signed-in
// user's browser, so this is a real stored-XSS boundary, not a hypothetical
// one — keep it this way rather than "simplifying" back to one template string.
function _notesRenderBlocksHTML(blocks,canEdit){
  let numCounter=0;
  return blocks.map((b,i)=>{
    numCounter=b.type==='numbered'?numCounter+1:0;
    return _notesBlockWrapperHTML(b,i,canEdit,numCounter,blocks.length===1);
  }).join('');
}

function _notesBlockWrapperHTML(b,i,canEdit,numCounter,only){
  // A gutter beside the block replaces the old always-present type select +
  // arrows: "+" adds a block below (and opens the / menu), the dots open a
  // small menu (Turn into, Move, Duplicate, Delete). Nothing is drawn for a
  // read-only viewer.
  const gutter=canEdit?`<div class="note-gutter"><button type="button" class="note-gbtn" aria-label="Add a block below" title="Add a block below" onclick="window.notesAddBelow(${i},this)">+</button><button type="button" class="note-gbtn" aria-label="Block options" title="Block options" onclick="window.notesOpenBlockMenu(${i},this)">&#8942;</button></div>`:'';
  const solo=only&&!b.text?' note-only':'';
  const tb=_NOTES_BLOCK_TYPES.find(t=>t.type===b.type);
  const aria=`role="textbox" aria-multiline="true" aria-label="${_notesEsc(tb?tb.label:'Text')}"`;

  let bodyHTML;
  if(b.type==='divider'){
    bodyHTML='<hr class="note-divider">';
  }else if(b.type==='image'){
    bodyHTML=`<div class="note-image-block">
      ${b.imageUrl?`<img src="${_notesEsc(b.imageUrl)}" alt="" class="note-image">`:''}
      ${canEdit?`<input type="file" accept="image/*" aria-label="Upload image" onchange="window.notesUploadBlockImage(${i},this)" class="note-image-input">`:''}
      <div id="nb-${i}" contenteditable="${!!canEdit}" ${aria} data-placeholder="Caption (optional)" class="note-block-body note-caption${solo}" oninput="window.notesBlockInput(${i},this)" onkeydown="window.notesBlockKeydown(event,${i})"></div>
    </div>`;
  }else{
    const align=b.type==='checklist'?'flex-start':'baseline';
    const prefix=b.type==='bullet'?'<span class="note-bullet">•</span>'
      :b.type==='numbered'?`<span class="note-bullet">${numCounter}.</span>`
      :b.type==='checklist'?`<input type="checkbox" aria-label="Done" ${b.checked?'checked':''} ${canEdit?'':'disabled'} onchange="window.notesToggleCheck(${i},this.checked)" class="note-check">`
      :'';
    const strike=b.type==='checklist'&&b.checked?' note-done':'';
    bodyHTML=`<div class="note-row" style="align-items:${align}">${prefix}<div id="nb-${i}" contenteditable="${!!canEdit}" ${aria} data-placeholder="${_notesEsc(_notesPlaceholder(b.type))}" class="note-block-body note-type-${b.type}${strike}${solo}" oninput="window.notesBlockInput(${i},this)" onkeydown="window.notesBlockKeydown(event,${i})"></div></div>`;
  }
  return`<div class="note-block" data-idx="${i}">${gutter}${bodyHTML}</div>`;
}

function _notesHydrateBlocks(){
  _notesEditBlocks.forEach((b,i)=>{
    const el=document.getElementById('nb-'+i);
    if(el)el.textContent=b.text||'';
  });
}

function _notesRerenderBlocks(){
  const c=document.getElementById('notes-blocks');
  if(!c)return;
  _notesPopClose();
  c.innerHTML=_notesRenderBlocksHTML(_notesEditBlocks,_notesCanEdit(_notesEditPage));
  _notesHydrateBlocks();
}

function _notesFocusBlock(idx,atEnd){
  const el=document.getElementById('nb-'+idx);
  if(!el)return;
  el.focus();
  try{
    const range=document.createRange(),sel=window.getSelection();
    range.selectNodeContents(el);
    range.collapse(!atEnd);
    sel.removeAllRanges();
    sel.addRange(range);
  }catch(e){}
}

function _notesCaretAtStart(){
  const sel=window.getSelection();
  if(!sel||!sel.rangeCount)return true;
  const range=sel.getRangeAt(0);
  return range.collapsed&&range.startOffset===0;
}

window.notesTitleInput=function(val){
  if(!_notesEditPage)return;
  _notesEditPage.title=val;
  _notesSaveDebounced();
};

window.notesBlockInput=function(i,el){
  if(!_notesEditBlocks[i])return;
  _notesEditBlocks[i].text=el.textContent;
  _notesCheckMarkdownShortcut(i,el);
  _notesSlashFromInput(i,el);
  _notesSaveDebounced();
};

// Notion-style typing shortcuts: "# " / "## " / "- " / "1. " / "[] " / "> "
// convert the current (empty-of-content) block's type and clear the typed
// prefix; "---" converts to a divider and opens a fresh paragraph after it.
function _notesCheckMarkdownShortcut(i,el){
  const b=_notesEditBlocks[i];
  if(!b||b.type==='image'||b.type==='divider')return;
  const t=el.textContent;
  const map=[[/^#\s$/,'h1'],[/^##\s$/,'h2'],[/^[-*]\s$/,'bullet'],[/^1\.\s$/,'numbered'],[/^\[\]\s$/,'checklist'],[/^>\s$/,'quote']];
  for(const[re,type]of map){
    if(re.test(t)){
      b.type=type;b.text='';
      _notesRerenderBlocks();
      _notesFocusBlock(i,false);
      _notesSaveDebounced();
      return;
    }
  }
  if(/^---$/.test(t)){
    b.type='divider';b.text='';
    _notesEditBlocks.splice(i+1,0,_notesNewBlock('paragraph'));
    _notesRerenderBlocks();
    _notesFocusBlock(i+1,false);
    _notesSaveDebounced();
  }
}

window.notesBlockKeydown=function(ev,i){
  if(_notesSlashKey(ev,i))return;
  if(ev.key==='Enter'&&!ev.shiftKey){
    ev.preventDefault();
    const b=_notesEditBlocks[i];
    if(!b||b.type==='divider')return;
    const nextType=(b.type==='h1'||b.type==='h2'||b.type==='quote')?'paragraph':b.type;
    _notesEditBlocks.splice(i+1,0,_notesNewBlock(nextType));
    _notesRerenderBlocks();
    _notesFocusBlock(i+1,false);
    _notesSaveDebounced();
  }else if(ev.key==='Backspace'){
    if(_notesCaretAtStart()&&(ev.target.textContent||'')===''&&_notesEditBlocks.length>1){
      ev.preventDefault();
      _notesEditBlocks.splice(i,1);
      _notesRerenderBlocks();
      _notesFocusBlock(Math.max(0,i-1),true);
      _notesSaveDebounced();
    }
  }
};

// ── The "/" menu ──────────────────────────────────────────────────────
// Typing "/" at the start of a block lists the block types; more typing
// narrows the list (matched on the label and a few aliases: "todo" finds
// Checklist). Arrow keys move, Enter or Tab picks, Escape closes and leaves
// what was typed. It replaces the per-block type <select>.

// The query when a block's whole text is "/" plus non-space characters, else
// null. Only the START of a block opens it: a slash in the middle of a
// sentence ("and/or") is a slash.
function _notesSlashMatch(text){
  const m=/^\/(\S*)$/.exec(String(text==null?'':text));
  return m?m[1].toLowerCase():null;
}

// Types matching a query: label prefix first, then any label/alias containing
// it. `hasText` (Turn into on a block that already has words) hides Divider,
// which would silently throw those words away.
function _notesSlashItems(query,opts){
  const q=String(query||'').toLowerCase().trim();
  const hasText=!!(opts&&opts.hasText);
  const pool=_NOTES_BLOCK_TYPES.filter(t=>!(hasText&&t.type==='divider'));
  if(!q)return pool.slice();
  const score=t=>{
    const label=t.label.toLowerCase();
    if(label.startsWith(q))return 0;
    if(t.keys.some(k=>k.startsWith(q)))return 1;
    if(label.includes(q)||t.keys.some(k=>k.includes(q)))return 2;
    return -1;
  };
  return pool.map(t=>({t,s:score(t)})).filter(x=>x.s>=0).sort((a,b)=>a.s-b.s).map(x=>x.t);
}

function _notesSlashFromInput(i,el){
  const b=_notesEditBlocks[i];
  if(!b||b.type==='image'||b.type==='divider'||!_notesCanEdit(_notesEditPage))return;
  const q=_notesSlashMatch(el.textContent);
  if(q===null){if(_notesSlash&&_notesSlash.mode==='slash')_notesPopClose();return;}
  _notesSlashOpen(i,q,'slash');
}

function _notesSlashOpen(idx,query,mode,anchorEl){
  const b=_notesEditBlocks[idx];
  const items=_notesSlashItems(query,{hasText:mode==='turn'&&!!(b&&b.text)});
  if(!items.length){_notesPopClose();return;}
  const keep=_notesSlash&&_notesSlash.idx===idx&&_notesSlash.query===query?_notesSlash.sel:0;
  _notesSlash={idx,query,sel:Math.min(keep,items.length-1),mode,items,anchor:anchorEl||null};
  _notesSlashPaint();
}

function _notesSlashPaint(){
  const s=_notesSlash;if(!s)return;
  const anchor=s.anchor||document.getElementById('nb-'+s.idx);
  _notesPopShow(anchor,s.items.map(t=>({label:t.label,hint:t.hint,run:()=>_notesSlashChoose(t.type)})),s.sel);
}

// Returns true when the key belonged to the menu.
function _notesSlashKey(ev,i){
  const s=_notesSlash;
  if(!s||s.idx!==i||!s.items.length)return false;
  const n=s.items.length;
  if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){
    ev.preventDefault();
    s.sel=(s.sel+(ev.key==='ArrowDown'?1:n-1))%n;
    _notesSlashPaint();
    return true;
  }
  if(ev.key==='Enter'||ev.key==='Tab'){
    ev.preventDefault();
    _notesSlashChoose(s.items[s.sel].type);
    return true;
  }
  if(ev.key==='Escape'){
    ev.preventDefault();
    _notesPopClose();
    return true;
  }
  return false;
}

function _notesSlashChoose(type){
  const s=_notesSlash;
  _notesPopClose();
  if(!s)return;
  const b=_notesEditBlocks[s.idx];
  if(!b)return;
  if(s.mode==='slash')b.text='';        // the typed "/query" is not content
  b.type=type;
  if(type==='checklist'&&typeof b.checked!=='boolean')b.checked=false;
  if(type==='divider'){
    b.text='';
    _notesEditBlocks.splice(s.idx+1,0,_notesNewBlock('paragraph'));
    _notesRerenderBlocks();
    _notesFocusBlock(s.idx+1,false);
  }else{
    _notesRerenderBlocks();
    _notesFocusBlock(s.idx,true);
  }
  _notesSaveDebounced();
}

// ── One popover, shared by the / menu and the block menu ──
// Built with createElement + textContent (labels are constants today, but a
// menu that interpolated strings is one edit from being an XSS hole).
function _notesPop(){
  let p=document.getElementById('notes-pop');
  if(!p){
    p=document.createElement('div');
    p.id='notes-pop';
    p.className='notes-pop';
    document.body.appendChild(p);
  }
  return p;
}

function _notesPopShow(anchor,rows,sel){
  _notesPopState={rows,sel:sel||0};
  const p=_notesPop();
  p.innerHTML='';
  p.setAttribute('role','listbox');
  rows.forEach((r,k)=>{
    const d=document.createElement('div');
    d.className='notes-pop-row'+(k===_notesPopState.sel?' sel':'')+(r.danger?' danger':'');
    d.setAttribute('role','option');
    d.setAttribute('aria-selected',k===_notesPopState.sel?'true':'false');
    const l=document.createElement('span');l.className='notes-pop-label';l.textContent=r.label;d.appendChild(l);
    if(r.hint){const h=document.createElement('span');h.className='notes-pop-hint';h.textContent=r.hint;d.appendChild(h);}
    // mousedown must not steal focus from the block being typed in.
    d.addEventListener('mousedown',e=>e.preventDefault());
    d.addEventListener('click',()=>r.run());
    p.appendChild(d);
  });
  p.classList.add('open');
  try{
    const a=anchor&&anchor.getBoundingClientRect?anchor.getBoundingClientRect():null;
    if(a){
      const w=p.offsetWidth||240,h=p.offsetHeight||0;
      let top=a.bottom+4;
      if(h&&top+h>innerHeight-8&&a.top-h-4>8)top=a.top-h-4;
      p.style.top=Math.max(8,top)+'px';
      p.style.left=Math.max(8,Math.min(a.left,innerWidth-w-8))+'px';
    }
    const cur=p.querySelector&&p.querySelector('.sel');
    if(cur&&cur.scrollIntoView)cur.scrollIntoView({block:'nearest'});
  }catch(e){}
}

function _notesPopClose(){
  _notesSlash=null;
  _notesPopState=null;
  const p=document.getElementById('notes-pop');
  if(p)p.classList.remove('open');
}

// Registered once at load — a listener added per render would pile up.
if(!window.__notesPopWired&&typeof document.addEventListener==='function'){
  window.__notesPopWired=true;
  document.addEventListener('mousedown',e=>{
    if(!_notesPopState)return;
    const t=e.target;
    if(t&&t.closest&&(t.closest('#notes-pop')||t.closest('.note-gbtn')))return;
    _notesPopClose();
  },true);
  document.addEventListener('keydown',e=>{
    // Escape from a block is handled by _notesSlashKey; this is for the
    // block menu, whose focus is on a button.
    if(e.key==='Escape'&&_notesPopState)_notesPopClose();
  },true);
}

window.notesAddBelow=function(i,btn){
  if(!_notesCanEdit(_notesEditPage))return;
  const cur=_notesEditBlocks[i];
  let at=i;
  if(!(cur&&cur.type==='paragraph'&&!cur.text)){
    _notesEditBlocks.splice(i+1,0,_notesNewBlock('paragraph'));
    at=i+1;
  }
  _notesRerenderBlocks();
  _notesFocusBlock(at,false);
  _notesSlashOpen(at,'','insert');
  _notesSaveDebounced();
};

window.notesOpenBlockMenu=function(i,btn){
  if(!_notesCanEdit(_notesEditPage)||!_notesEditBlocks[i])return;
  const last=_notesEditBlocks.length-1;
  const rows=[{label:'Turn into…',run:()=>_notesSlashOpen(i,'','turn',btn)}];
  if(i>0)rows.push({label:'Move up',run:()=>{_notesPopClose();window.notesMoveBlock(i,-1);}});
  if(i<last)rows.push({label:'Move down',run:()=>{_notesPopClose();window.notesMoveBlock(i,1);}});
  rows.push({label:'Duplicate',run:()=>{_notesPopClose();window.notesDuplicateBlock(i);}});
  if(last>0)rows.push({label:'Delete',danger:true,run:()=>{_notesPopClose();window.notesDeleteBlock(i);}});
  _notesSlash=null;
  _notesPopShow(btn,rows,0);
};

window.notesDuplicateBlock=function(i){
  const b=_notesEditBlocks[i];
  if(!b||!_notesCanEdit(_notesEditPage))return;
  const c=JSON.parse(JSON.stringify(b));
  c.id='b'+(++_notesBlockSeq)+'_'+Date.now();
  _notesEditBlocks.splice(i+1,0,c);
  _notesRerenderBlocks();
  _notesFocusBlock(i+1,true);
  _notesSaveDebounced();
};

window.notesChangeBlockType=function(i,type){
  const b=_notesEditBlocks[i];
  if(!b)return;
  b.type=type;
  if(type==='checklist'&&typeof b.checked!=='boolean')b.checked=false;
  _notesRerenderBlocks();
  _notesFocusBlock(i,true);
  _notesSaveDebounced();
};

window.notesMoveBlock=function(i,dir){
  const j=i+dir;
  if(j<0||j>=_notesEditBlocks.length)return;
  const tmp=_notesEditBlocks[i];_notesEditBlocks[i]=_notesEditBlocks[j];_notesEditBlocks[j]=tmp;
  _notesRerenderBlocks();
  _notesFocusBlock(j,true);
  _notesSaveDebounced();
};

window.notesDeleteBlock=function(i){
  if(_notesEditBlocks.length<=1)return;
  _notesEditBlocks.splice(i,1);
  _notesRerenderBlocks();
  _notesFocusBlock(Math.max(0,i-1),true);
  _notesSaveDebounced();
};

window.notesAddBlock=function(){
  _notesEditBlocks.push(_notesNewBlock('paragraph'));
  _notesRerenderBlocks();
  _notesFocusBlock(_notesEditBlocks.length-1,true);
  _notesSaveDebounced();
};

window.notesToggleCheck=function(i,checked){
  const b=_notesEditBlocks[i];
  if(!b)return;
  b.checked=checked;
  _notesRerenderBlocks();
  _notesSaveNow();
};

window.notesUploadBlockImage=async function(i,inputEl){
  const file=inputEl.files&&inputEl.files[0];
  if(!file)return;
  try{
    const url=await uploadToCloudinary(file);
    if(!_notesEditBlocks[i])return;
    _notesEditBlocks[i].imageUrl=url;
    _notesRerenderBlocks();
    _notesSaveNow();
  }catch(e){showToast('Image upload failed: '+(e.message||e),true);}
};

window.notesToggleVisibility=async function(){
  if(!_notesCanEdit(_notesEditPage))return;
  const next=_notesEditPage.visibility==='shared'?'personal':'shared';
  try{
    await updateDoc(doc(db,'notes_pages',_notesEditPage.id),{visibility:next,updatedAt:Date.now()});
    _notesEditPage.visibility=next;
    notesLoaded=false;
    showToast('Visibility updated');
    _notesRenderDetailAndHydrate();
  }catch(e){showToast('Could not update visibility: '+(e.message||e),true);}
};

window.notesDeletePage=async function(){
  if(!_notesEditPage||!_notesCanEdit(_notesEditPage))return;
  // Milanote's own dialog (js/boards.js). Without it, nothing is deleted.
  if(typeof _boardsConfirm!=='function'){showToast('Could not ask to confirm — reload and try again',true);return;}
  if(!await _boardsConfirm('Delete "'+(_notesEditPage.title||'Untitled')+'"? This cannot be undone.',{ok:'Delete',danger:true}))return;
  try{
    await deleteDoc(doc(db,'notes_pages',_notesEditPage.id));
    notesPages=notesPages.filter(p=>p.id!==_notesEditPage.id);
    logActivity('Note page deleted',`${session.name} deleted "${_notesEditPage.title||'Untitled'}"`);
    showToast('Page deleted');
    _notesEditPage=null;_notesEditBlocks=[];
    window.showPage('notes');
  }catch(e){showToast('Could not delete: '+(e.message||e),true);}
};

function _notesSetSaveStatus(text){
  const el=document.getElementById('note-save-status');
  if(el)el.textContent=text;
}
function _notesSaveDebounced(){
  _notesSetSaveStatus('Unsaved changes…');
  clearTimeout(_notesSaveTimer);
  _notesSaveTimer=setTimeout(_notesSaveNow,900);
}

// Autosave fires on nearly every keystroke — opts out of the shared
// blocking "Saving…" overlay (js/shared.js) the same way js/boards.js does
// (see its _boardsSaveNow comment), so typing doesn't get interrupted by a
// full-screen block; #note-save-status carries the ambient feedback instead.
async function _notesSaveNow(){
  clearTimeout(_notesSaveTimer);
  if(!_notesEditPage||!_notesEditPage.id||!_notesCanEdit(_notesEditPage))return;
  _notesSetSaveStatus('Saving…');
  if(typeof window._gvSilentSaveStart==='function')window._gvSilentSaveStart();
  try{
    await updateDoc(doc(db,'notes_pages',_notesEditPage.id),{
      title:_notesEditPage.title,
      blocks:_notesEditBlocks,
      updatedAt:Date.now(),
      updatedByName:session.name
    });
    const idx=notesPages.findIndex(p=>p.id===_notesEditPage.id);
    if(idx>-1){notesPages[idx].title=_notesEditPage.title;notesPages[idx].blocks=_notesEditBlocks;notesPages[idx].updatedAt=Date.now();}
    _notesSetSaveStatus('Saved');
  }catch(e){
    _notesSetSaveStatus('Save failed');
    showToast('Could not save note: '+(e.message||e),true);
  }finally{
    if(typeof window._gvSilentSaveStop==='function')window._gvSilentSaveStop();
  }
}

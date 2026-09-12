/* Groovy Operations — boards.js
   Plain global JS (NO modules), loaded via <script src> after notes.js.
   Firebase globals (db, getDoc, getDocs, setDoc, updateDoc, addDoc,
   deleteDoc, query, where, collection, doc) are bridged onto window by the
   bootstrap module in index.html — see "File architecture" in CLAUDE.md.

   Mood Boards — Phase 2 of the Notion+Milanote module (the Milanote half),
   reached only through the Creative Hub grid (js/notes.js renderCreativeHub),
   not a separate top-level nav entry. Same TEAM/PRIVATE visibility model and
   firestore.rules pattern as Notes (Phase 1): 'shared' boards readable by
   any signed-in user, 'personal' boards readable only by their owner.

   A board is a freeform canvas of cards (image / text / link) connected by
   lines, with independent pan/zoom. One doc per board in `mood_boards`;
   cards + connectors + pan/zoom state are plain fields on the doc (no
   subcollection), same reasoning as notes_pages: simplest thing that works
   at this app's scale, one read/write per board.

   Link cards are manual entry (URL + title + description typed by the
   user) — deliberately NOT an auto-fetched preview. Fetching another site's
   og:title/og:image needs a server-side call (a browser can't read another
   origin's HTML — CORS), which means a new Netlify Function taking a
   user-submitted URL: real SSRF surface (timeouts, blocking internal/
   private addresses, size caps) for a v1 nice-to-have. If auto-preview is
   wanted later, that function is the missing piece — don't build it
   speculatively here. */

// ── State ──
let boardsLoaded=false;
let moodBoards=[];            // live boards: every 'shared' board + the signed-in user's own
let _boardsTrash=[];          // same query, but the soft-deleted ones (deletedAt set)
let _boardsViewingId=null;    // id of the board open in the canvas view
let _editBoard=null;          // {id,title,visibility,ownerUid,ownerName,ownerUsername,zoom,panX,panY}
let _editCards=[];
let _editConnectors=[];
let _boardsSaveTimer=null;
let _boardsCardSeq=0;
let _boardsSelection=new Set(); // card ids currently selected (Stage 2: many, not one)
let _boardsClipboard=[];        // in-session card clipboard, survives moving between boards
let _boardsAddCascade=0;      // so repeated "+ Card" clicks don't stack perfectly
let _boardsDragDepth=0;       // dragenter/dragleave fire per child; count to know when we really left

// Stage 4 — gallery view state. Per-viewer, never board data: a sort order
// or a search term should not travel to someone else's screen.
let _boardsGalleryQuery='';
let _boardsGallerySort='updated';   // updated | opened | title | cards
let _boardsGalleryTimer=null;
// Stage 4 — find-within-a-board state.
let _boardsFindOpen=false,_boardsFindQuery='',_boardsFindHits=[],_boardsFindIdx=0,_boardsFindTimer=null;
let _boardsMenuOpen=false;          // the board "⋯" dropdown in the canvas topbar
const _BOARDS_RECENT_KEY='groovy-boards-recent';
const _BOARDS_RECENT_MAX=8;
// Minimap default-on; like the snap preference it lives in localStorage
// because it is a per-viewer convenience, not part of the board.
let _boardsMinimapOn=(function(){try{return localStorage.getItem('groovy-boards-minimap')!=='0';}catch(e){return true;}})();

const _BOARDS_GRID=20;          // snap-to-grid step, world px
const _BOARDS_SNAP_PX=6;        // alignment-guide catch distance, SCREEN px (so it feels the same at any zoom)
const _BOARDS_CLIP_PREFIX='groovy-board-cards:';
// Snap preference is a per-viewer convenience, not board data — localStorage
// is the right home for it (it should not travel with the board to someone
// else's screen).
let _boardsSnapGrid=(function(){try{return localStorage.getItem('groovy-boards-snap')==='1';}catch(e){return false;}})();
let _boardsLineMode=false;      // while on, dragging empty canvas draws an arrow instead of panning

const _BOARDS_ZOOM_MIN=0.1;   // Afnan works at ~19% in Milanote — 40% couldn't fit a real board
const _BOARDS_ZOOM_MAX=3;

function _boardsEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function _boardsRelTime(ts){
  if(!ts)return'';
  const m=Math.floor((Date.now()-ts)/60000);
  if(m<1)return'just now';
  if(m<60)return m+'m ago';
  const h=Math.floor(m/60);
  if(h<24)return h+'h ago';
  const d=Math.floor(h/24);
  if(d<30)return d+'d ago';
  return new Date(ts).toLocaleDateString('en-GB');
}
// Stage 6 widened this deliberately: a TEAM board is now editable by any
// signed-in user, not just whoever created it. Before, "TEAM" meant
// everyone could LOOK — which makes live sync, presence and comments
// pointless, since there could never be a second editor. PRIVATE is
// unchanged (owner only), plus anyone the board was explicitly shared
// with. firestore.rules mirrors this exactly.
function _boardsCanEdit(b){
  if(!b||!session)return false;
  if(b.ownerUid===session.uid)return true;
  if(session.role==='owner')return true;
  if(b.visibility==='shared')return true;
  const me=_boardsMyEmail();
  return!!(me&&Array.isArray(b.sharedWith)&&b.sharedWith.indexOf(me)>-1);
}
function _boardsNewCard(type){
  const id='c'+(++_boardsCardSeq)+'_'+Date.now()+'_'+Math.floor(Math.random()*1e4);
  const w=type==='frame'?440:type==='text'?220:type==='todo'?240:type==='file'?200:type==='board'?200:170;
  const h=type==='frame'?320:type==='image'?120:type==='link'?120:type==='file'?110:type==='todo'?170:type==='board'?104:100;
  const base={id,type,x:80,y:80,w,h};
  if(type==='image')base.imageUrl='';
  if(type==='text')base.text='';
  if(type==='link'){base.linkUrl='';base.linkTitle='';base.linkDesc='';}
  if(type==='file'){base.fileUrl='';base.fileName='';base.fileSize=0;}
  if(type==='frame')base.title='';
  if(type==='todo')base.items=[{text:'',done:false}];
  if(type==='board'){base.boardId='';base.boardTitle='';}
  return base;
}

// ── Frames ─────────────────────────────────────────────────────────────
// A frame is a titled region that groups cards — the thing Afnan's real
// Milanote board leans on ("Classic Straight Leg", "RELAXED WIDE LEG").
//
// Membership is GEOMETRIC, not stored: a frame holds whatever currently
// sits inside it, recomputed when you grab it. The alternative — a
// frameId on every card — means maintaining membership on every drag,
// resize, delete, undo and paste, with orphan states to reconcile when
// any of that goes wrong. Geometric containment has none of that
// bookkeeping, needs no migration, and matches what the user sees: if a
// card looks like it's in the box, it's in the box.
//
// A frame is a CARD TYPE rather than a separate array, so it inherits
// selection, drag, resize, undo, lock, copy and delete for free. The only
// special-casing is render order (frames paint first, so they sit behind
// their contents) and drag (a frame takes its contents with it).
function _boardsCardsInFrame(frame){
  return _editCards.filter(c=>{
    if(c.id===frame.id)return false;
    const cx=c.x+c.w/2,cy=c.y+c.h/2;   // centre-in-bounds: a card poking over the edge still counts
    return cx>=frame.x&&cx<=frame.x+frame.w&&cy>=frame.y&&cy<=frame.y+frame.h;
  });
}
// Frames paint first so they never cover their own contents. This also
// quietly constrains "bring to front" on a frame — which is correct: a
// frame that could be raised above its cards would hide them.
function _boardsRenderOrder(){
  return _editCards.filter(c=>c.type==='frame').concat(_editCards.filter(c=>c.type!=='frame'));
}
function _boardsFormatBytes(n){
  if(!n||n<0)return'';
  if(n<1024)return n+' B';
  if(n<1024*1024)return Math.round(n/1024)+' KB';
  return (n/1048576).toFixed(1)+' MB';
}
function _boardsFileExt(name){
  const m=/\.([A-Za-z0-9]{1,6})$/.exec(name||'');
  return m?m[1].toUpperCase():'FILE';
}

// ── Nesting (Stage 4) ──────────────────────────────────────────────────
// A board can sit inside another board. Two things express that, and BOTH
// have to agree before a board is treated as nested:
//   1. the child doc carries `parentId`
//   2. the parent board still holds a `board` card pointing at the child
//
// Requiring both is what makes this safe to live with. Delete the link
// card, or trash the parent, and the child immediately surfaces back in
// the gallery at root level instead of becoming an unreachable document.
// Nothing is written to reconcile that — it is derived on read, every
// time, from boards already loaded. The alternative (fixing up parentId
// whenever a link card is deleted) means a Firestore write inside an
// undoable action, and an orphan the moment any of it fails.
function _boardsLiveById(){
  const m={};
  moodBoards.forEach(b=>{m[b.id]=b;});
  return m;
}
function _boardsNestedIds(){
  const live=_boardsLiveById();
  const nested=new Set();
  moodBoards.forEach(b=>{
    if(!b.parentId)return;
    const p=live[b.parentId];
    if(!p)return;   // parent trashed, deleted, or not readable by this viewer
    if((p.cards||[]).some(c=>c.type==='board'&&c.boardId===b.id))nested.add(b.id);
  });
  return nested;
}
// The chain from the gallery down to this board: [root, …, parent].
// Walks `parentId` with a visited-set guard — a cycle is only possible if
// someone hand-edits Firestore, but an infinite loop in the topbar render
// would take the whole page down, so it is cheap insurance.
function _boardsAncestors(id){
  const live=_boardsLiveById();
  const nested=_boardsNestedIds();
  const chain=[],seen=new Set([id]);
  let cur=live[id];
  while(cur&&cur.parentId&&nested.has(cur.id)&&!seen.has(cur.parentId)){
    const p=live[cur.parentId];
    if(!p)break;
    chain.unshift(p);
    seen.add(p.id);
    cur=p;
  }
  return chain;
}
function _boardsParentOf(id){
  const chain=_boardsAncestors(id);
  return chain.length?chain[chain.length-1]:null;
}

// ── Recently opened (Stage 4) ──────────────────────────────────────────
// localStorage, not board data: "recently opened" is about this person on
// this device, and writing it to the doc would mean a Firestore write on
// every board open plus everyone's history overwriting everyone else's.
function _boardsRecentRead(){
  try{
    const raw=JSON.parse(localStorage.getItem(_BOARDS_RECENT_KEY)||'[]');
    return Array.isArray(raw)?raw.filter(r=>r&&r.id):[];
  }catch(e){return[];}
}
function _boardsRecentTouch(id){
  try{
    const next=[{id,ts:Date.now()}].concat(_boardsRecentRead().filter(r=>r.id!==id)).slice(0,_BOARDS_RECENT_MAX);
    localStorage.setItem(_BOARDS_RECENT_KEY,JSON.stringify(next));
  }catch(e){/* private browsing — recents are a convenience, never required */}
}
function _boardsRecentAt(id){
  const r=_boardsRecentRead().find(x=>x.id===id);
  return r?r.ts:0;
}

// ── Search text (Stage 4) ──────────────────────────────────────────────
// One definition of "what text is in this card", used by BOTH the
// find-within-a-board bar and the gallery's across-all-boards search, so
// the two can never drift apart on which fields count.
function _boardsCardText(c){
  if(!c)return'';
  const parts=[];
  if(c.text)parts.push(c.text);
  if(c.title)parts.push(c.title);
  if(c.linkTitle)parts.push(c.linkTitle);
  if(c.linkDesc)parts.push(c.linkDesc);
  if(c.linkUrl)parts.push(c.linkUrl);
  if(c.fileName)parts.push(c.fileName);
  if(c.boardTitle)parts.push(c.boardTitle);
  if(Array.isArray(c.items))c.items.forEach(i=>{if(i&&i.text)parts.push(i.text);});
  return parts.join(' ').toLowerCase();
}
function _boardsMatchCount(b,q){
  if(!q)return 0;
  return (b.cards||[]).filter(c=>_boardsCardText(c).indexOf(q)>-1).length;
}

// ── Undo / redo ────────────────────────────────────────────────────────
// Snapshot-based rather than a command/inverse-op pattern: a board is tens
// of cards, so a JSON clone is cheap, and it means EVERY mutation is
// undoable without each one having to define and maintain its own inverse.
// Snapshots cover cards + connectors (the spatial work); pan/zoom and text
// typing are deliberately excluded — typing is covered by the browser's own
// contenteditable undo inside the focused card, and undoing a pan you did
// on purpose is more surprising than helpful.
//
// A drag/resize gesture pushes ONE entry, lazily on its first pointermove
// (not on pointerdown) — otherwise a plain click on a card header would
// leave a no-op entry and Ctrl+Z would appear to do nothing.
let _boardsUndo=[],_boardsRedo=[];
const _BOARDS_UNDO_MAX=50;
function _boardsStateSnapshot(){
  return JSON.stringify({cards:_editCards,connectors:_editConnectors});
}
function _boardsPushUndo(){
  _boardsUndo.push(_boardsStateSnapshot());
  if(_boardsUndo.length>_BOARDS_UNDO_MAX)_boardsUndo.shift();
  _boardsRedo=[];
  _boardsSyncHistoryButtons();
}
function _boardsApplySnapshot(json){
  const s=JSON.parse(json);
  _editCards=s.cards||[];
  _editConnectors=s.connectors||[];
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  _boardsSyncHistoryButtons();
}
function _boardsSyncHistoryButtons(){
  const u=document.getElementById('board-undo-btn'),r=document.getElementById('board-redo-btn');
  if(u)u.disabled=!_boardsUndo.length;
  if(r)r.disabled=!_boardsRedo.length;
}
window.boardsUndoAction=function(){
  if(!_boardsUndo.length||!_boardsCanEdit(_editBoard))return;
  _boardsRedo.push(_boardsStateSnapshot());
  _boardsApplySnapshot(_boardsUndo.pop());
};
window.boardsRedoAction=function(){
  if(!_boardsRedo.length||!_boardsCanEdit(_editBoard))return;
  _boardsUndo.push(_boardsStateSnapshot());
  _boardsApplySnapshot(_boardsRedo.pop());
};
function _boardsIsEditableFocus(){
  const a=document.activeElement;
  if(!a)return false;
  const tag=(a.tagName||'').toLowerCase();
  return tag==='input'||tag==='textarea'||a.isContentEditable===true;
}
// Registered once at load, gated on the current page — same reasoning as
// the paste handler below (never stacks duplicate listeners per render).
function _boardsOnKeydown(e){
  if(currentPage!=='board-canvas'||!_editBoard)return;
  // Inside a text card or a link field every one of these belongs to the
  // browser — Ctrl+Z is text undo, Backspace deletes a character, Ctrl+A
  // selects the paragraph. Intercepting any of them there would be worse
  // than not having the shortcut at all.
  if(_boardsIsEditableFocus())return;
  const k=(e.key||'').toLowerCase();
  if(e.ctrlKey||e.metaKey){
    // Ctrl+F belongs to the board, not the browser: every card is in the
    // DOM at once, so the native find would happily "scroll" to a card
    // sitting off in world space where nobody can see it.
    if(k==='f'){
      e.preventDefault();
      if(!_boardsFindOpen)window.boardsToggleFind();
      else{const i=document.getElementById('board-find-input');if(i)i.focus();}
      return;
    }
    if(k==='z'){e.preventDefault();if(e.shiftKey)window.boardsRedoAction();else window.boardsUndoAction();return;}
    if(k==='y'){e.preventDefault();window.boardsRedoAction();return;}
    if(k==='d'){e.preventDefault();window.boardsDuplicateSelection();return;}
    if(k==='a'){e.preventDefault();window.boardsSelectAll();return;}
    return;   // let copy/cut/paste reach their own clipboard events
  }
  if(k==='escape'&&_boardsSelection.size){e.preventDefault();window.boardsClearSelection();return;}
  if((k==='delete'||k==='backspace')&&_boardsSelection.size){e.preventDefault();window.boardsDeleteSelection();}
}
document.addEventListener('keydown',_boardsOnKeydown);
window.boardsToggleSnap=function(){
  _boardsSnapGrid=!_boardsSnapGrid;
  try{localStorage.setItem('groovy-boards-snap',_boardsSnapGrid?'1':'0');}catch(e){}
  const btn=document.getElementById('board-snap-btn');
  if(btn)btn.classList.toggle('on',_boardsSnapGrid);
  showToast(_boardsSnapGrid?'Snap to grid on':'Snap to grid off — cards align to each other instead');
};

// ── Load (gallery) ──
// Same two-single-field-query, merge-client-side approach as loadNotesData —
// each query maps 1:1 onto a clause of the firestore.rules read condition
// below, so it's always provably safe and never needs a composite index.
async function loadBoardsData(){
  const me=_boardsMyEmail();
  // Three single-field queries, one per clause of the firestore.rules read
  // condition — the third (Stage 6) covers boards shared with me by name.
  // Still no composite index and still provably safe, same discipline as
  // the original two.
  const jobs=[
    getDocs(query(collection(db,'mood_boards'),where('visibility','==','shared'))),
    getDocs(query(collection(db,'mood_boards'),where('ownerUid','==',session.uid)))
  ];
  if(me)jobs.push(getDocs(query(collection(db,'mood_boards'),where('sharedWith','array-contains',me))));
  const snaps=await Promise.all(jobs);
  const map={};
  snaps.forEach(sn=>sn.forEach(d=>{map[d.id]={id:d.id,...d.data()};}));
  const all=Object.values(map).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  // Soft delete: a trashed board keeps its document (so it can come back)
  // and is simply filtered out of the live list. Deliberately NOT a
  // where('deletedAt','==',null) query — that would need every existing
  // board to carry the field, and a board written before this shipped
  // doesn't have it at all.
  moodBoards=all.filter(b=>!b.deletedAt);
  _boardsTrash=all.filter(b=>!!b.deletedAt).sort((a,b)=>(b.deletedAt||0)-(a.deletedAt||0));
  boardsLoaded=true;
}

// ── Gallery ──
// Stage 4: the gallery is no longer a flat dump of every board. Only
// root-level boards are listed (nested ones are reached through their
// parent), templates get their own section, and a search/sort bar sits on
// top — eight boards fit on a screen, forty do not.
function _boardsSortList(list){
  const l=list.slice();
  if(_boardsGallerySort==='title')return l.sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''),undefined,{sensitivity:'base'}));
  if(_boardsGallerySort==='cards')return l.sort((a,b)=>((b.cards||[]).length)-((a.cards||[]).length));
  if(_boardsGallerySort==='opened')return l.sort((a,b)=>_boardsRecentAt(b.id)-_boardsRecentAt(a.id)||(b.updatedAt||0)-(a.updatedAt||0));
  return l.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
}
function _boardsGalleryBarHTML(){
  const opts=[['updated','Recently updated'],['opened','Recently opened'],['title','Name A–Z'],['cards','Most cards']];
  return`<div class="board-gallery-bar">
    <input type="search" id="board-gallery-search" class="board-gallery-search" placeholder="Search boards and their cards…" value="${_boardsEsc(_boardsGalleryQuery)}" oninput="window.boardsGallerySearch(this)">
    <select class="board-gallery-sort" onchange="window.boardsGallerySetSort(this.value)">
      ${opts.map(o=>`<option value="${o[0]}"${_boardsGallerySort===o[0]?' selected':''}>${o[1]}</option>`).join('')}
    </select>
  </div>`;
}
function _boardsRecentStripHTML(){
  const live=_boardsLiveById();
  const recent=_boardsRecentRead().map(r=>live[r.id]).filter(Boolean).slice(0,6);
  if(recent.length<2)return'';   // a strip of one is noise, not a shortcut
  return`<div class="notes-section">
    <div class="notes-section-head"><h3>Recently opened</h3></div>
    <div class="board-recent-strip">${recent.map(b=>`<button class="board-recent-chip" onclick="window.boardsOpen('${b.id}')">${_boardsEsc(b.title||'Untitled board')}</button>`).join('')}</div>
  </div>`;
}
// Searching deliberately looks at EVERY live board, nested ones included,
// and at the text inside their cards — the whole point is "find that one
// reference somewhere in a season's worth of boards". Card text is already
// in memory (loadBoardsData reads whole documents), so this costs nothing
// extra.
function _boardsSearchResultsHTML(q){
  const hits=moodBoards.map(b=>({b,n:_boardsMatchCount(b,q)}))
    .filter(h=>h.n>0||String(h.b.title||'').toLowerCase().indexOf(q)>-1||String(h.b.ownerName||'').toLowerCase().indexOf(q)>-1);
  const sorted=_boardsSortList(hits.map(h=>h.b));
  const byId={};hits.forEach(h=>{byId[h.b.id]=h.n;});
  return`<div class="notes-section">
    <div class="notes-section-head"><h3>${sorted.length} result${sorted.length===1?'':'s'}</h3><button class="btn-sm outline" onclick="window.boardsGalleryClearSearch()">Clear</button></div>
    ${sorted.length?`<div class="board-gallery-grid">${sorted.map(b=>_boardGalleryCardHTML(b,{matches:byId[b.id]||0})).join('')}</div>`:'<div class="empty">Nothing matched that.</div>'}
  </div>`;
}
function renderBoardsGallery(){
  const q=_boardsGalleryQuery.trim().toLowerCase();
  const head=`
  <button class="back-btn" onclick="window.showPage('creative-hub')">← Back to Creative Hub</button>
  <div class="page-head" style="margin-bottom:10px">
    <div><h2 style="margin:0">Mood Boards</h2><div style="color:var(--muted);font-size:12px;margin-top:2px">Drag, resize and connect reference images, notes and links</div></div>
  </div>
  ${_boardsGalleryBarHTML()}`;
  if(q)return head+_boardsSearchResultsHTML(q)+_boardsTrashSectionHTML();

  const nested=_boardsNestedIds();
  const root=moodBoards.filter(b=>!nested.has(b.id));
  const templates=_boardsSortList(root.filter(b=>b.isTemplate));
  const rest=root.filter(b=>!b.isTemplate);
  const team=_boardsSortList(rest.filter(b=>b.visibility==='shared'));
  const priv=_boardsSortList(rest.filter(b=>b.visibility!=='shared'));
  return head+`
  ${_boardsRecentStripHTML()}
  <div class="notes-section">
    <div class="notes-section-head"><h3>TEAM</h3><button class="btn-sm" onclick="window.boardsCreate('shared')">+ New board</button></div>
    ${team.length?`<div class="board-gallery-grid">${team.map(b=>_boardGalleryCardHTML(b)).join('')}</div>`:'<div class="empty">No team boards yet.</div>'}
  </div>
  <div class="notes-section">
    <div class="notes-section-head"><h3>PRIVATE</h3><button class="btn-sm outline" onclick="window.boardsCreate('personal')">+ New board</button></div>
    ${priv.length?`<div class="board-gallery-grid">${priv.map(b=>_boardGalleryCardHTML(b)).join('')}</div>`:'<div class="empty">No private boards yet.</div>'}
  </div>
  ${templates.length?`<div class="notes-section">
    <div class="notes-section-head"><h3>Templates</h3><span style="font-size:11px;color:var(--muted)">Start a new board from a skeleton you already built</span></div>
    <div class="board-gallery-grid">${templates.map(b=>_boardGalleryCardHTML(b,{template:true})).join('')}</div>
  </div>`:''}
  ${_boardsTrashSectionHTML()}`;
}
// Same debounced-input + refocus-after-rerender pattern as fabInvSetSearch
// in js/fabric.js and the Monitor page — the app already has one way of
// doing a search box that survives a full innerHTML rerender; this is it.
window.boardsGallerySearch=function(el){
  _boardsGalleryQuery=el.value;
  clearTimeout(_boardsGalleryTimer);
  _boardsGalleryTimer=setTimeout(()=>{
    _boardsRerenderGallery();
    const i=document.getElementById('board-gallery-search');
    if(i){i.focus();try{i.setSelectionRange(i.value.length,i.value.length);}catch(e){}}
  },180);
};
window.boardsGalleryClearSearch=function(){_boardsGalleryQuery='';_boardsRerenderGallery();};
window.boardsGallerySetSort=function(v){_boardsGallerySort=v;_boardsRerenderGallery();};
function _boardsRerenderGallery(){
  if(currentPage!=='boards')return;
  const m=document.getElementById('main-content');
  if(m)m.innerHTML=renderBoardsGallery();
}
function _boardsTrashSectionHTML(){
  if(!_boardsTrash.length)return'';
  return`<div class="notes-section">
    <div class="notes-section-head"><h3>Trash</h3><span style="font-size:11px;color:var(--muted)">Deleted boards are kept here until you remove them for good</span></div>
    <div class="board-trash-list">${_boardsTrash.map(b=>`
      <div class="board-trash-row">
        <div style="min-width:0">
          <div style="font-weight:600;font-size:13px">${_boardsEsc(b.title||'Untitled board')}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${(b.cards||[]).length} card${(b.cards||[]).length===1?'':'s'} · deleted ${_boardsRelTime(b.deletedAt)}${b.deletedByName?' by '+_boardsEsc(b.deletedByName):''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn-sm outline" onclick="window.boardsRestore('${b.id}')">Restore</button>
          <button class="btn-sm" style="background:var(--accent-urgent)" onclick="window.boardsDeleteForever('${b.id}')">Delete forever</button>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}
window.boardsRestore=async function(id){
  try{
    await updateDoc(doc(db,'mood_boards',id),{deletedAt:null,deletedByName:null,updatedAt:Date.now()});
    logActivity('Mood board restored',`${session.name} restored a mood board from trash`);
    showToast('Board restored');
    boardsLoaded=false;
    await loadBoardsData();
    if(currentPage==='boards')document.getElementById('main-content').innerHTML=renderBoardsGallery();
  }catch(e){showToast('Could not restore: '+(e.message||e),true);}
};
window.boardsDeleteForever=async function(id){
  const b=_boardsTrash.find(x=>x.id===id);
  if(!confirm('Permanently delete "'+((b&&b.title)||'Untitled board')+'"? This cannot be undone.'))return;
  try{
    await deleteDoc(doc(db,'mood_boards',id));
    logActivity('Mood board permanently deleted',`${session.name} permanently deleted "${(b&&b.title)||'Untitled board'}"`);
    showToast('Board deleted for good');
    boardsLoaded=false;
    await loadBoardsData();
    if(currentPage==='boards')document.getElementById('main-content').innerHTML=renderBoardsGallery();
  }catch(e){showToast('Could not delete: '+(e.message||e),true);}
};
function _boardGalleryCardHTML(b,opts){
  opts=opts||{};
  const cards=b.cards||[];
  const xs=cards.map(c=>c.x+c.w),ys=cards.map(c=>c.y+c.h);
  const maxX=xs.length?Math.max(...xs)+20:200,maxY=ys.length?Math.max(...ys)+20:120;
  const scale=Math.min(220/maxX,110/maxY,0.6);
  const vis=b.visibility==='shared'?'TEAM':'PRIVATE';
  const subs=cards.filter(c=>c.type==='board'&&c.boardId).length;
  const crumbs=_boardsAncestors(b.id).map(a=>_boardsEsc(a.title||'Untitled board')).join(' › ');
  return`<div class="board-gallery-card" onclick="window.boardsOpen('${b.id}')">
    <div class="board-gallery-thumb">
      <div style="position:absolute;transform:scale(${scale});transform-origin:top left">
        ${cards.filter(c=>c.type==='frame').concat(cards.filter(c=>c.type!=='frame')).map(_boardMiniCardHTML).join('')}
      </div>
      ${b.isTemplate?'<span class="board-template-pill">Template</span>':(b.sharedWith&&b.sharedWith.length?'<span class="board-template-pill">Shared</span>':'')}
    </div>
    <div class="board-gallery-meta">
      ${crumbs?`<div class="board-gallery-path">${crumbs} ›</div>`:''}
      <div style="font-weight:600;font-size:13.5px">${_boardsEsc(b.title||'Untitled board')}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${vis} · ${cards.length} card${cards.length===1?'':'s'}${subs?' · '+subs+' sub-board'+(subs===1?'':'s'):''} · ${_boardsEsc(b.ownerName||'')} · ${_boardsRelTime(b.updatedAt)}</div>
      ${opts.matches?`<div class="board-gallery-hit">${opts.matches} matching card${opts.matches===1?'':'s'}</div>`:''}
      ${opts.template?`<div style="margin-top:8px"><button class="btn-sm" onclick="event.stopPropagation();window.boardsUseTemplate('${b.id}')">Use template</button></div>`:''}
    </div>
  </div>`;
}
function _boardMiniCardHTML(c){
  const base=`position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;border-radius:6px;overflow:hidden;border:1px solid var(--border)`;
  if(c.type==='frame')return`<div style="${base};background:rgba(0,0,0,.03)"></div>`;
  if(c.type==='image')return c.imageUrl?`<div style="${base}"><img src="${_boardsEsc(c.imageUrl)}" style="width:100%;height:100%;object-fit:cover"></div>`:`<div style="${base};background:var(--soft)"></div>`;
  if(c.type==='link'||c.type==='file')return`<div style="${base};background:var(--soft)"></div>`;
  if(c.type==='board')return`<div style="${base};background:var(--soft);border-style:dashed"></div>`;
  return`<div style="${base};background:#fff"></div>`;
}
// One place that knows the shape of a board document — used by the plain
// "+ New board" buttons, by sub-board creation and by duplicate/template.
function _boardsBlankDoc(){
  return{
    title:'Untitled board',visibility:'personal',
    ownerUid:session.uid,ownerName:session.name,ownerUsername:session.u,
    cards:[],connectors:[],zoom:1,panX:40,panY:30,
    createdAt:Date.now(),updatedAt:Date.now(),updatedByName:session.name
  };
}
async function _boardsCreateDoc(fields){
  const data={..._boardsBlankDoc(),...(fields||{})};
  const ref=await addDoc(collection(db,'mood_boards'),data);
  // Keep the in-memory list in step immediately: breadcrumbs and the
  // nesting rules both read moodBoards, and the canvas opens before any
  // refetch would have finished.
  moodBoards.unshift({id:ref.id,...data});
  return ref.id;
}
window.boardsCreate=async function(visibility){
  try{
    const id=await _boardsCreateDoc({visibility:visibility==='shared'?'shared':'personal'});
    boardsLoaded=false;
    logActivity('Mood board created',`${session.name} created ${visibility==='shared'?'a team':'a private'} mood board`);
    window.boardsOpen(id);
  }catch(e){showToast('Could not create board: '+(e.message||e),true);}
};
// A sub-board is two writes that must both land: the child document, and
// the link card on this board that makes it reachable. The save is flushed
// straight away rather than left to the 900ms debounce for exactly that
// reason — a reload in between would leave the child orphaned (it would
// surface back at root level, by design, but it would look like it moved).
window.boardsAddChildBoard=async function(){
  if(!_editBoard||!_boardsCanEdit(_editBoard))return;
  _boardsMenuOpen=false;_boardsSyncMenu();
  const p=_boardsPlacementPoint();
  try{
    const id=await _boardsCreateDoc({visibility:_editBoard.visibility,parentId:_editBoard.id});
    _boardsPushUndo();
    const nc=_boardsNewCard('board');
    nc.x=p.x;nc.y=p.y;nc.boardId=id;nc.boardTitle='Untitled board';
    _editCards.push(nc);
    _boardsRenderCanvasAndWire();
    await _boardsSaveNow();
    boardsLoaded=false;
    _boardsLogBoardActivity('added a sub-board');
    showToast('Sub-board added — open it from the card');
  }catch(e){showToast('Could not create sub-board: '+(e.message||e),true);}
};

// ── Duplicate / templates ──────────────────────────────────────────────
// Connectors point at card ids, so a straight copy of both arrays would
// leave the duplicate's lines pointing at the ORIGINAL board's cards.
// _boardsCloneCards mints fresh ids but doesn't report them, so the map is
// built here and card-bound connectors are remapped through it; freeform
// lines carry world coordinates and need no remapping.
//
// Board-link cards are deliberately NOT copied: duplicating a board that
// contains sub-boards would either point the copy at the original's
// children (edits in one showing up in the other) or need a recursive
// multi-document copy with its own half-failed states. Dropping them and
// saying so is the honest version.
function _boardsDuplicatePayload(cards,connectors){
  const src=(cards||[]).filter(c=>c.type!=='board');
  const skipped=(cards||[]).length-src.length;
  const clones=_boardsCloneCards(src,0,0);
  const map={};
  src.forEach((c,i)=>{map[c.id]=clones[i].id;});
  const conns=(connectors||[]).filter(cn=>cn.free?true:(map[cn.from]&&map[cn.to]))
    .map(cn=>cn.free?{...cn}:{...cn,from:map[cn.from],to:map[cn.to]});
  return{cards:clones,connectors:conns,skipped};
}
async function _boardsDuplicateBoard(src,fields,openIt){
  const payload=_boardsDuplicatePayload(src.cards,src.connectors);
  const id=await _boardsCreateDoc({
    title:(src.title||'Untitled board')+' (copy)',
    visibility:src.visibility||'personal',
    cards:payload.cards,connectors:payload.connectors,
    zoom:src.zoom||1,panX:src.panX||40,panY:src.panY||30,
    ...(fields||{})
  });
  boardsLoaded=false;
  if(payload.skipped)showToast(payload.skipped+' sub-board card'+(payload.skipped===1?'':'s')+' not copied — sub-boards are not duplicated');
  if(openIt)window.boardsOpen(id);
  return id;
}
window.boardsDuplicateBoard=async function(){
  if(!_editBoard)return;
  _boardsMenuOpen=false;_boardsSyncMenu();
  try{
    await _boardsSaveNow();
    const src={..._editBoard,cards:_boardsCardsForSave(),connectors:_editConnectors};
    logActivity('Mood board duplicated',`${session.name} duplicated "${_editBoard.title||'Untitled board'}"`);
    await _boardsDuplicateBoard(src,{isTemplate:false},true);
    showToast('Board duplicated');
  }catch(e){showToast('Could not duplicate: '+(e.message||e),true);}
};
// A template is an ordinary board with a flag — it stays fully editable
// and openable, it just lists in its own gallery section and offers "Use
// template", which is the duplicate above under a clearer name.
window.boardsToggleTemplate=async function(){
  if(!_editBoard||!_boardsCanEdit(_editBoard))return;
  const next=!_editBoard.isTemplate;
  try{
    await updateDoc(doc(db,'mood_boards',_editBoard.id),{isTemplate:next,updatedAt:Date.now()});
    _editBoard.isTemplate=next;
    const idx=moodBoards.findIndex(b=>b.id===_editBoard.id);
    if(idx>-1)moodBoards[idx].isTemplate=next;
    boardsLoaded=false;
    _boardsMenuOpen=false;
    _boardsRenderCanvasAndWire();
    _boardsLogBoardActivity(next?'saved the board as a template':'removed the board from templates');
    showToast(next?'Saved as a template':'No longer a template');
  }catch(e){showToast('Could not update: '+(e.message||e),true);}
};
window.boardsUseTemplate=async function(id){
  const src=moodBoards.find(b=>b.id===id);
  if(!src)return;
  try{
    await _boardsDuplicateBoard(src,{isTemplate:false,title:(src.title||'Untitled board')+' (copy)'},true);
    logActivity('Mood board created from template',`${session.name} started a board from "${src.title||'Untitled board'}"`);
  }catch(e){showToast('Could not use template: '+(e.message||e),true);}
};

window.boardsOpen=function(id){_boardsRecentTouch(id);_boardsViewingId=id;window.showPage('board-canvas');};
// One level up, not straight to the gallery: from a sub-board that means
// its parent board. Matches how Notes' back buttons behave (see CLAUDE.md).
window.boardsBack=function(){
  _boardsSaveNow();
  const parent=_editBoard?_boardsParentOf(_editBoard.id):null;
  if(parent)window.boardsOpen(parent.id);
  else window.showPage('boards');
};
window.boardsGoto=function(id){_boardsSaveNow();window.boardsOpen(id);};
window.boardsGotoGallery=function(){_boardsSaveNow();window.showPage('boards');};

// ── Canvas ──
async function _boardsOpenCanvas(){
  // Stepping from a board into its sub-board never leaves the page, so the
  // showPage teardown hook doesn't fire — do it here as well.
  if(_editBoard){try{_boardsTeardown();}catch(e){}}
  const m=document.getElementById('main-content');
  let b=moodBoards.find(x=>x.id===_boardsViewingId);
  if(!b){
    m.innerHTML=gvSkeleton(4);
    try{
      const snap=await getDoc(doc(db,'mood_boards',_boardsViewingId));
      if(!snap.exists()){m.innerHTML='<div class="empty">Board not found.</div>';return;}
      b={id:snap.id,...snap.data()};
    }catch(e){m.innerHTML='<div class="empty">Could not load board: '+(e.message||e)+'</div>';return;}
  }
  _editBoard={id:b.id,title:b.title||'Untitled board',visibility:b.visibility||'personal',ownerUid:b.ownerUid,ownerName:b.ownerName,ownerUsername:b.ownerUsername,zoom:b.zoom||1,panX:b.panX||40,panY:b.panY||30,parentId:b.parentId||null,isTemplate:!!b.isTemplate,sharedWith:Array.isArray(b.sharedWith)?b.sharedWith.slice():[]};
  _editCards=(b.cards||[]).map(c=>{const cc={...c};delete cc._uploading;return cc;});
  _editConnectors=(b.connectors||[]).map(cn=>({...cn}));
  _boardsSelection=new Set();
  // Find state is per board-opening too — carrying a search term from one
  // board into the next would highlight nothing and look broken.
  _boardsFindOpen=false;_boardsFindQuery='';_boardsFindHits=[];_boardsFindIdx=0;
  _boardsMenuOpen=false;
  // History is per board-opening — undoing your way into a different
  // board's state would be nonsense.
  _boardsUndo=[];_boardsRedo=[];
  // The sync baseline: what the server has, as far as we know. Every
  // later "did we change this card?" question is answered by diffing
  // against it (see _boardsLocalChanges).
  _boardsSetBase(_boardsCardsForSave());
  _boardsConnBase=JSON.stringify(_editConnectors);
  _boardsPeers=[];_boardsComments=[];_boardsBoardActivity=[];
  _boardsPendingRemote=null;_boardsGestureActive=false;
  _boardsRenderCanvasAndWire();
  _boardsSubscribe(b.id);
  _boardsPresenceStart(b.id);
  _boardsCommentsStart(b.id);
  _boardsActivityStart(b.id);
  // Opened cold from a deep link, moodBoards is empty — so breadcrumbs and
  // sub-board titles would be blank. Load the list in the background and
  // re-render once it lands, unless the user is already typing in a card.
  if(!boardsLoaded){
    loadBoardsData().then(()=>{
      if(currentPage==='board-canvas'&&_editBoard&&_editBoard.id===b.id&&!_boardsIsEditableFocus())_boardsRenderCanvasAndWire();
    }).catch(()=>{});
  }
  if(_boardsPendingFocusCard){
    const target=_boardsPendingFocusCard;
    _boardsPendingFocusCard=null;
    _boardsFocusCard(target);
  }
}
function _boardsRenderCanvasAndWire(){
  const m=document.getElementById('main-content');
  if(!m)return;
  m.innerHTML=_renderBoardCanvasHTML();
  _boardsApplyTransform();
  _boardsHydrateTextCards();
  _boardsDrawConnectors();
  _boardsWireStagePan();
  _boardsSyncHistoryButtons();
  _boardsRenderSelectionBar();
  _boardsRenderMinimap();
  _boardsApplyFindHighlight();
  _boardsSyncMenu();
  _boardsRenderPresence();
  _boardsPaintCommentBadges();
  _boardsRenderDrawer();
}
function _renderBoardCanvasHTML(){
  const b=_editBoard;
  if(!b)return'<div class="empty">No board loaded.</div>';
  const canEdit=_boardsCanEdit(b);
  const visLabel=b.visibility==='shared'?'TEAM':'PRIVATE';
  // Breadcrumbs only appear on a nested board — on a root board the trail
  // would just read "Boards ›" next to a back button that says the same.
  const chain=_boardsAncestors(b.id);
  const parent=chain.length?chain[chain.length-1]:null;
  const crumbs=chain.length?`<div class="board-crumbs">
      <button class="board-crumb" onclick="window.boardsGotoGallery()">Boards</button>
      ${chain.map(a=>`<span class="board-crumb-sep">›</span><button class="board-crumb" onclick="window.boardsGoto('${a.id}')">${_boardsEsc(a.title||'Untitled board')}</button>`).join('')}
      <span class="board-crumb-sep">›</span>
    </div>`:'';
  return`<div class="board-canvas-wrap">
    <div class="board-topbar">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap">
        <button class="back-btn" style="margin:0" onclick="window.boardsBack()">← ${_boardsEsc(parent?(parent.title||'Untitled board'):'Boards')}</button>
        ${crumbs}
        <input type="text" id="board-title-input" value="${_boardsEsc(b.title)}" ${canEdit?'':'readonly'} oninput="window.boardsTitleInput(this.value)" placeholder="Untitled board" style="font-size:14.5px;font-weight:700;border:none;outline:none;font-family:inherit;background:transparent;max-width:240px">
        <span class="pill">${visLabel}</span>
        ${b.isTemplate?'<span class="pill">TEMPLATE</span>':''}
        ${canEdit?`<span class="board-save-status" id="board-save-status">Saved</span>`:''}
        <span class="board-peers" id="board-peers" style="display:none"></span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${canEdit?`<button class="tool-btn" id="board-undo-btn" onclick="window.boardsUndoAction()" title="Undo (Ctrl+Z)" disabled>Undo</button>
        <button class="tool-btn" id="board-redo-btn" onclick="window.boardsRedoAction()" title="Redo (Ctrl+Shift+Z)" disabled>Redo</button>
        <div class="tool-sep"></div>`:''}
        <button class="tool-btn${_boardsFindOpen?' on':''}" onclick="window.boardsToggleFind()" title="Find cards on this board">Find</button>
        <button class="tool-btn${_boardsDrawerOpen?' on':''}" id="board-cmt-btn" onclick="window.boardsToggleDrawer()" title="Comments and activity on this board">Comments</button>
        <button class="tool-btn" onclick="window.boardsZoomBy(0.8)">−</button>
        <span class="zoom-readout" id="board-zoom-readout">${Math.round(b.zoom*100)}%</span>
        <button class="tool-btn" onclick="window.boardsZoomBy(1.25)">+</button>
        <button class="tool-btn" onclick="window.boardsFitView()">Fit</button>
        <button class="tool-btn" onclick="window.boardsResetView()">100%</button>
        <button class="tool-btn${_boardsMinimapOn?' on':''}" onclick="window.boardsToggleMinimap()" title="Show the minimap">Map</button>
        ${canEdit?`<button class="tool-btn${_boardsSnapGrid?' on':''}" id="board-snap-btn" onclick="window.boardsToggleSnap()" title="Snap cards to a grid while dragging">Snap</button>`:''}
        <div class="board-menu-wrap">
          <button class="tool-btn" onclick="window.boardsToggleMenu(event)" title="Board actions">⋯</button>
          <div class="board-menu" id="board-menu" style="display:none">
            <button onclick="window.boardsCopyBoardLink()">Copy link to board</button>
            <button onclick="window.boardsExportPNG()">Export as image (PNG)</button>
            <button onclick="window.boardsExportPDF()">Export as PDF</button>
            <button onclick="window.boardsDuplicateBoard()">Duplicate board</button>
            ${canEdit?`<button onclick="window.boardsToggleTemplate()">${b.isTemplate?'Remove from templates':'Save as template'}</button>`:''}
            ${canEdit?`<button onclick="window.boardsAddChildBoard()">Add sub-board</button>`:''}
            ${canEdit?`<button onclick="window.boardsOpenShare()">Share with people…</button>`:''}
            ${canEdit?`<button onclick="window.boardsToggleVisibility()">Make ${b.visibility==='shared'?'Private':'Team'}</button>`:''}
            ${canEdit?`<button class="danger" onclick="window.boardsDelete()">Delete board</button>`:''}
          </div>
        </div>
      </div>
    </div>
    <div class="board-stage" id="board-stage">
      <div class="board-world" id="board-world">
        <svg class="board-conn-layer" id="board-conn-layer" width="4000" height="3000"></svg>
        <div class="board-guide board-guide-v" id="board-guide-v"></div>
        <div class="board-guide board-guide-h" id="board-guide-h"></div>
        ${_boardsRenderOrder().map(c=>_boardCardHTML(c,canEdit)).join('')}
      </div>
      <div class="board-marquee" id="board-marquee"></div>
      ${_boardsFindOpen?`<div class="board-find" id="board-find">
        <input type="search" id="board-find-input" placeholder="Find on this board…" value="${_boardsEsc(_boardsFindQuery)}" oninput="window.boardsFindInput(this)" onkeydown="window.boardsFindKey(event)">
        <span class="board-find-count" id="board-find-count"></span>
        <button class="tool-btn" onclick="window.boardsFindStep(-1)" title="Previous match">↑</button>
        <button class="tool-btn" onclick="window.boardsFindStep(1)" title="Next match">↓</button>
        <button class="tool-btn" onclick="window.boardsToggleFind()" title="Close">✕</button>
      </div>`:''}
      ${_boardsMinimapOn?`<div class="board-minimap" id="board-minimap"><div class="board-minimap-inner" id="board-minimap-inner"></div><div class="board-minimap-view" id="board-minimap-view"></div></div>`:''}
      ${canEdit?'<div class="board-selection-bar" id="board-selection-bar" style="display:none"></div>':''}
      ${canEdit?'<div class="board-dropzone" id="board-dropzone"><div>Drop files to add them to this board</div></div>':''}
      ${canEdit?`<div class="board-add-menu">
        <button onclick="window.boardsAddCard('image')">+ Image</button>
        <button onclick="window.boardsAddCard('text')">+ Text</button>
        <button onclick="window.boardsAddCard('todo')">+ To-do</button>
        <button onclick="window.boardsAddCard('link')">+ Link</button>
        <button onclick="window.boardsPickFiles()">+ File</button>
        <button onclick="window.boardsAddCard('frame')">+ Frame</button>
        <button onclick="window.boardsAddChildBoard()">+ Board</button>
        <button id="board-line-btn" class="${_boardsLineMode?'on':''}" onclick="window.boardsToggleLineMode()">↗ Line</button>
      </div>`:''}
      ${canEdit&&!_editCards.length?'<div class="board-empty-hint">Double-click anywhere to add a note · drop files in · paste an image with Ctrl+V</div>':''}
    </div>
    <div class="board-drawer" id="board-drawer" style="display:none"></div>
    <div class="board-share-modal" id="board-share-modal" style="display:none"></div>
    <input type="file" id="board-file-picker" multiple style="display:none" onchange="window.boardsFilesPicked(this)">
  </div>`;
}
function _boardCardHTML(c,canEdit){
  // Frames get their own element entirely: a header strip you can grab,
  // and an outlined region whose body is pointer-events:none so panning,
  // marquee-select and the cards inside it all still work through it.
  if(c.type==='frame'){
    const sel=_boardsSelection.has(c.id)?' selected':'';
    return`<div class="board-frame${sel}${c.locked?' locked':''}${c.color?' tint-'+c.color:''}" id="board-card-${c.id}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px">
      <div class="board-frame-head" ${canEdit&&!c.locked?`onpointerdown="window.boardsCardDragStart(event,'${c.id}')"`:''} onclick="window.boardsSelectCard('${c.id}',event)">
        <input type="text" class="board-frame-title" value="${_boardsEsc(c.title||'')}" placeholder="Section name" ${canEdit&&!c.locked?'':'readonly'} oninput="window.boardsFrameTitle('${c.id}',this.value)" onpointerdown="event.stopPropagation()">
        ${canEdit&&!c.locked?`<button class="board-card-del" onclick="window.boardsDeleteCard('${c.id}')" title="Delete frame (cards inside are kept)">✕</button>`:''}
      </div>
      ${canEdit&&!c.locked?`<div class="board-resize-handle" onpointerdown="window.boardsResizeStart(event,'${c.id}')"><svg viewBox="0 0 16 16"><path d="M14 2L2 14M14 8L8 14" stroke="currentColor" stroke-width="1.5" fill="none"/></svg></div>`:''}
    </div>`;
  }
  let body;
  if(c.type==='todo'){
    const items=c.items||[];
    const doneN=items.filter(i=>i.done).length;
    body=`<div class="board-card-body board-todo-body">
      ${items.map((it,i)=>`<div class="board-todo-row">
        <input type="checkbox" ${it.done?'checked':''} ${canEdit?'':'disabled'} onchange="window.boardsTodoToggle('${c.id}',${i},this.checked)">
        <div class="board-todo-text${it.done?' done':''}" id="board-todo-${c.id}-${i}" contenteditable="${!!canEdit}" data-placeholder="To-do" oninput="window.boardsTodoText('${c.id}',${i},this)" onkeydown="window.boardsTodoKey(event,'${c.id}',${i})"></div>
        ${canEdit?`<button class="board-todo-del" onclick="window.boardsTodoRemove('${c.id}',${i})" title="Remove">✕</button>`:''}
      </div>`).join('')}
      ${canEdit?`<button class="board-todo-add" onclick="window.boardsTodoAdd('${c.id}')">+ Add item</button>`:''}
    </div>`;
    c._todoProgress=items.length?doneN+'/'+items.length:'';
  }else if(c.type==='image'){
    body=c._uploading
      ?'<div class="board-card-empty">Uploading…</div>'
      :c.imageUrl
      ?`<img src="${_boardsEsc(c.imageUrl)}" style="width:100%;height:100%;object-fit:cover;display:block">`
      :canEdit?`<label class="board-card-empty" for="board-file-${c.id}">Click, or paste an image (Ctrl+V)<input type="file" id="board-file-${c.id}" accept="image/*" onchange="window.boardsUploadToCard('${c.id}',this)" style="display:none"></label>`
              :`<div class="board-card-empty">No image</div>`;
    body=`<div class="board-card-body" style="padding:0">${body}</div>`;
  }else if(c.type==='link'){
    body=canEdit
      ?`<div class="board-card-body board-link-edit">
          <input type="text" value="${_boardsEsc(c.linkUrl)}" placeholder="https://…" oninput="window.boardsLinkInput('${c.id}','linkUrl',this.value)">
          <input type="text" value="${_boardsEsc(c.linkTitle)}" placeholder="Title" oninput="window.boardsLinkInput('${c.id}','linkTitle',this.value)">
          <textarea placeholder="Short description (optional)" oninput="window.boardsLinkInput('${c.id}','linkDesc',this.value)">${_boardsEsc(c.linkDesc)}</textarea>
        </div>`
      :`<div class="board-card-body">
          <div class="link-title">${_boardsEsc(c.linkTitle||'Untitled link')}</div>
          <div class="link-desc">${_boardsEsc(c.linkDesc||'')}</div>
          <div class="link-url">${_boardsEsc(c.linkUrl||'')}</div>
        </div>`;
  }else if(c.type==='file'){
    if(c._uploading){
      body='<div class="board-card-body"><div class="board-card-empty">Uploading…</div></div>';
    }else if(c.fileUrl){
      // Best-effort PDF thumbnail: Cloudinary can rasterise page 1 of a PDF
      // through a delivery transform. If the account/preset won't do it the
      // <img> simply fails and onerror falls back to the plain file card —
      // never a broken image.
      const thumb=_boardsPdfThumbUrl(c.fileUrl);
      body=`<a class="board-card-body board-file-body" href="${_boardsEsc(c.fileUrl)}" target="_blank" rel="noopener noreferrer">
        ${thumb?`<img class="board-file-thumb" src="${_boardsEsc(thumb)}" alt="" onerror="this.style.display='none'">`:''}
        <div class="board-file-meta">
          <span class="board-file-ext">${_boardsEsc(_boardsFileExt(c.fileName))}</span>
          <span class="board-file-name">${_boardsEsc(c.fileName||'File')}</span>
          <span class="board-file-size">${_boardsEsc(_boardsFormatBytes(c.fileSize))}</span>
        </div>
      </a>`;
    }else{
      body=canEdit
        ?`<label class="board-card-empty" for="board-fileinput-${c.id}">Click to choose a file<input type="file" id="board-fileinput-${c.id}" onchange="window.boardsUploadToCard('${c.id}',this)" style="display:none"></label>`
        :'<div class="board-card-empty">No file</div>';
      body=`<div class="board-card-body" style="padding:0">${body}</div>`;
    }
  }else if(c.type==='board'){
    // A link to a nested board. The title is read LIVE from moodBoards so
    // renaming the child updates every card pointing at it; the stored
    // boardTitle is only a fallback for a board this viewer can't read.
    const child=_boardsLiveById()[c.boardId];
    const title=(child&&child.title)||c.boardTitle||'Untitled board';
    const n=child?(child.cards||[]).length:0;
    body=`<div class="board-card-body board-subboard-body">
      <div class="board-subboard-title">${_boardsEsc(title)}</div>
      <div class="board-subboard-meta">${child?n+' card'+(n===1?'':'s'):'Board'}</div>
      ${c.boardId?`<button class="board-subboard-open" onclick="event.stopPropagation();window.boardsGoto('${c.boardId}')">Open →</button>`:'<div class="board-subboard-meta">Missing board</div>'}
    </div>`;
  }else{
    body=`<div class="board-card-body board-text-body" contenteditable="${!!canEdit}" id="board-txt-${c.id}" data-placeholder="Type a note…" oninput="window.boardsTextInput('${c.id}',this)"></div>`;
  }
  const kind=c.type==='image'?'Image':c.type==='link'?'Link':c.type==='file'?'File':c.type==='board'?'Board':c.type==='todo'?('To-do'+(c._todoProgress?' · '+c._todoProgress:'')):'Note';
  const sel=_boardsSelection.has(c.id)?' selected':'';
  const lock=c.locked?' locked':'';
  const tint=c.color?' tint-'+c.color:'';
  return`<div class="board-card-el${sel}${lock}${tint}" id="board-card-${c.id}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px" onclick="window.boardsSelectCard('${c.id}',event)">
    <div class="board-card-head" ${canEdit?`onpointerdown="window.boardsCardDragStart(event,'${c.id}')"`:''}>
      <span class="board-card-kind">${kind}${c.locked?' · Locked':''}</span>
      <span style="display:flex;align-items:center;gap:4px">
        <button class="board-cmt-badge" id="board-cmt-${c.id}" style="display:none" title="Comments on this card" onclick="event.stopPropagation();window.boardsOpenComments('${c.id}')" onpointerdown="event.stopPropagation()"></button>
        ${canEdit&&!c.locked?`<button class="board-card-del" onclick="window.boardsDeleteCard('${c.id}')" title="Delete">✕</button>`:''}
      </span>
    </div>
    ${body}
    ${canEdit&&!c.locked?`<div class="board-link-handle" onpointerdown="window.boardsLinkStart(event,'${c.id}')" title="Drag to connect"></div>
    <div class="board-resize-handle" onpointerdown="window.boardsResizeStart(event,'${c.id}')"><svg viewBox="0 0 16 16"><path d="M14 2L2 14M14 8L8 14" stroke="currentColor" stroke-width="1.5" fill="none"/></svg></div>`:''}
  </div>`;
}
// User-authored text is written in via textContent after the structure is
// rendered, never interpolated into the HTML string — same stored-XSS
// boundary as Notes' block editor. To-do item text goes the same way.
function _boardsHydrateTextCards(){
  _editCards.forEach(c=>{
    if(c.type==='text'){
      const el=document.getElementById('board-txt-'+c.id);
      if(el)el.textContent=c.text||'';
    }else if(c.type==='todo'){
      (c.items||[]).forEach((it,i)=>{
        const el=document.getElementById('board-todo-'+c.id+'-'+i);
        if(el)el.textContent=it.text||'';
      });
    }
  });
}

// -- pan/zoom --
function _boardsApplyTransform(){
  const b=_editBoard;if(!b)return;
  const w=document.getElementById('board-world');
  if(w)w.style.transform=`translate(${b.panX}px,${b.panY}px) scale(${b.zoom})`;
  const zr=document.getElementById('board-zoom-readout');
  if(zr)zr.textContent=Math.round(b.zoom*100)+'%';
  _boardsUpdateMinimapView();
}
// Zoom about the centre of the viewport, not the world origin — zooming out
// from a corner throws the content off-screen and you lose your place.
window.boardsZoomBy=function(f){
  const b=_editBoard;if(!b)return;
  const stage=document.getElementById('board-stage');
  const next=Math.max(_BOARDS_ZOOM_MIN,Math.min(_BOARDS_ZOOM_MAX,b.zoom*f));
  if(stage){
    const rect=stage.getBoundingClientRect();
    const cx=rect.width/2,cy=rect.height/2;
    b.panX=cx-(cx-b.panX)*(next/b.zoom);
    b.panY=cy-(cy-b.panY)*(next/b.zoom);
  }
  b.zoom=next;
  _boardsApplyTransform();_boardsSaveDebounced();
};
window.boardsResetView=function(){const b=_editBoard;if(!b)return;b.zoom=1;b.panX=40;b.panY=30;_boardsApplyTransform();_boardsSaveDebounced();};
// Fit every card on screen at once — the thing you actually want on a board
// with 40+ cards, where hunting for content by panning is hopeless.
window.boardsFitView=function(){
  const b=_editBoard;if(!b)return;
  const stage=document.getElementById('board-stage');if(!stage)return;
  if(!_editCards.length){window.boardsResetView();return;}
  const minX=Math.min(..._editCards.map(c=>c.x));
  const minY=Math.min(..._editCards.map(c=>c.y));
  const maxX=Math.max(..._editCards.map(c=>c.x+c.w));
  const maxY=Math.max(..._editCards.map(c=>c.y+c.h));
  const rect=stage.getBoundingClientRect();
  const pad=64;
  const w=Math.max(1,maxX-minX),h=Math.max(1,maxY-minY);
  const z=Math.max(_BOARDS_ZOOM_MIN,Math.min(_BOARDS_ZOOM_MAX,Math.min((rect.width-pad*2)/w,(rect.height-pad*2)/h)));
  b.zoom=z;
  b.panX=(rect.width-w*z)/2-minX*z;
  b.panY=(rect.height-h*z)/2-minY*z;
  _boardsApplyTransform();_boardsSaveDebounced();
};
function _boardsScreenToWorld(clientX,clientY){
  const b=_editBoard;const stage=document.getElementById('board-stage');
  const rect=stage.getBoundingClientRect();
  return{x:(clientX-rect.left-b.panX)/b.zoom,y:(clientY-rect.top-b.panY)/b.zoom};
}
// Where a new card should land when it isn't being placed by a click:
// the middle of what you're currently looking at, nudged a little each
// time so repeat clicks fan out instead of stacking into one pile.
function _boardsPlacementPoint(){
  const b=_editBoard;
  const stage=document.getElementById('board-stage');
  if(!stage)return{x:80,y:80};
  const rect=stage.getBoundingClientRect();
  const n=(_boardsAddCascade++)%6;
  return{
    x:(rect.width/2-b.panX)/b.zoom-90+n*26,
    y:(rect.height/2-b.panY)/b.zoom-60+n*26
  };
}
// All stage-level wiring. Called on every canvas render — safe to re-add
// listeners because the whole stage element is replaced each time, so the
// old ones go with the old DOM (unlike the document-level paste/keydown
// handlers, which are registered once at load).
function _boardsWireStagePan(){
  const stage=document.getElementById('board-stage');
  if(!stage)return;
  const canEdit=_boardsCanEdit(_editBoard);

  stage.addEventListener('pointerdown',e=>{
    if(e.target!==stage&&e.target.id!=='board-world')return;
    const b=_editBoard;

    // Line mode: drag anywhere empty to draw a freeform arrow. A mode
    // rather than a modifier because it's a deliberate "now I'm annotating"
    // action, and it leaves Shift free for marquee.
    if(_boardsLineMode&&canEdit){
      const svg=document.getElementById('board-conn-layer');
      const start=_boardsScreenToWorld(e.clientX,e.clientY);
      const temp=document.createElementNS('http://www.w3.org/2000/svg','line');
      temp.setAttribute('class','temp');
      temp.setAttribute('x1',start.x);temp.setAttribute('y1',start.y);
      temp.setAttribute('x2',start.x);temp.setAttribute('y2',start.y);
      if(svg)svg.appendChild(temp);
      stage.setPointerCapture(e.pointerId);
      function lmove(ev){
        const p=_boardsScreenToWorld(ev.clientX,ev.clientY);
        temp.setAttribute('x2',p.x);temp.setAttribute('y2',p.y);
      }
      function lup(ev){
        stage.removeEventListener('pointermove',lmove);stage.removeEventListener('pointerup',lup);
        temp.remove();
        const end=_boardsScreenToWorld(ev.clientX,ev.clientY);
        if(Math.abs(end.x-start.x)>6||Math.abs(end.y-start.y)>6){
          _boardsPushUndo();
          _editConnectors.push({free:true,arrow:true,x1:start.x,y1:start.y,x2:end.x,y2:end.y});
          _boardsDrawConnectors();
          _boardsSaveDebounced();
        }
      }
      stage.addEventListener('pointermove',lmove);
      stage.addEventListener('pointerup',lup);
      return;
    }

    // Shift+drag on empty canvas = marquee select; plain drag still pans.
    // Deliberately this way round rather than Milanote's (drag = marquee,
    // space = pan): dragging IS how you pan here and has been since Stage
    // 1, and there's no scrollbar to fall back on, so making plain drag
    // select would strand anyone who didn't discover the modifier.
    if(e.shiftKey&&canEdit){
      const box=document.getElementById('board-marquee');
      const rect=stage.getBoundingClientRect();
      const sx=e.clientX,sy=e.clientY;
      stage.setPointerCapture(e.pointerId);
      if(box)box.style.display='block';
      function mmove(ev){
        if(!box)return;
        const x1=Math.min(sx,ev.clientX)-rect.left,y1=Math.min(sy,ev.clientY)-rect.top;
        box.style.left=x1+'px';box.style.top=y1+'px';
        box.style.width=Math.abs(ev.clientX-sx)+'px';
        box.style.height=Math.abs(ev.clientY-sy)+'px';
      }
      function mup(ev){
        stage.removeEventListener('pointermove',mmove);stage.removeEventListener('pointerup',mup);
        if(box)box.style.display='none';
        const a=_boardsScreenToWorld(sx,sy),bb=_boardsScreenToWorld(ev.clientX,ev.clientY);
        const x1=Math.min(a.x,bb.x),x2=Math.max(a.x,bb.x);
        const y1=Math.min(a.y,bb.y),y2=Math.max(a.y,bb.y);
        // A click with no drag clears instead of selecting everything.
        if(x2-x1<3&&y2-y1<3){_boardsSetSelection([]);return;}
        const hit=_editCards.filter(c=>c.x<x2&&c.x+c.w>x1&&c.y<y2&&c.y+c.h>y1).map(c=>c.id);
        _boardsSetSelection(hit);
      }
      stage.addEventListener('pointermove',mmove);
      stage.addEventListener('pointerup',mup);
      return;
    }

    // Clicking empty canvas clears the selection (unless it turns into a pan).
    let moved=false;
    const startX=e.clientX,startY=e.clientY,origX=b.panX,origY=b.panY;
    stage.classList.add('panning');
    stage.setPointerCapture(e.pointerId);
    function move(ev){
      if(Math.abs(ev.clientX-startX)>3||Math.abs(ev.clientY-startY)>3)moved=true;
      b.panX=origX+(ev.clientX-startX);b.panY=origY+(ev.clientY-startY);_boardsApplyTransform();
    }
    function up(){
      stage.classList.remove('panning');
      stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerup',up);
      if(moved)_boardsSaveDebounced();
      else if(_boardsSelection.size)_boardsSetSelection([]);
    }
    stage.addEventListener('pointermove',move);
    stage.addEventListener('pointerup',up);
  });

  if(!canEdit)return;

  // Double-click empty canvas → a note exactly where you clicked. Before
  // this, every new card landed at one computed spot, so adding several in
  // a row buried them in a single stack.
  stage.addEventListener('dblclick',e=>{
    if(e.target!==stage&&e.target.id!=='board-world')return;
    const p=_boardsScreenToWorld(e.clientX,e.clientY);
    _boardsPushUndo();
    const c=_boardsNewCard('text');
    c.x=p.x-c.w/2;c.y=p.y-c.h/2;
    _editCards.push(c);
    _boardsRenderCanvasAndWire();
    _boardsSaveDebounced();
    const el=document.getElementById('board-txt-'+c.id);
    if(el)el.focus();
  });

  // Drag files in from the desktop. dragenter/dragleave fire for every
  // child element the pointer crosses, so count depth rather than toggling
  // on each one — otherwise the overlay flickers off mid-drag.
  stage.addEventListener('dragenter',e=>{
    if(!_boardsDragHasFiles(e))return;
    e.preventDefault();
    _boardsDragDepth++;
    stage.classList.add('dropping');
  });
  stage.addEventListener('dragover',e=>{
    if(!_boardsDragHasFiles(e))return;
    e.preventDefault();
    e.dataTransfer.dropEffect='copy';
  });
  stage.addEventListener('dragleave',e=>{
    if(!_boardsDragHasFiles(e))return;
    _boardsDragDepth=Math.max(0,_boardsDragDepth-1);
    if(!_boardsDragDepth)stage.classList.remove('dropping');
  });
  stage.addEventListener('drop',e=>{
    if(!_boardsDragHasFiles(e))return;
    e.preventDefault();
    _boardsDragDepth=0;
    stage.classList.remove('dropping');
    const files=Array.from((e.dataTransfer&&e.dataTransfer.files)||[]);
    if(!files.length)return;
    _boardsAddFiles(files,_boardsScreenToWorld(e.clientX,e.clientY));
  });
}
function _boardsDragHasFiles(e){
  const dt=e.dataTransfer;
  if(!dt)return false;
  if(dt.types&&Array.prototype.indexOf.call(dt.types,'Files')>-1)return true;
  return!!(dt.files&&dt.files.length);
}

// -- card drag / resize --
// Alignment guides: while dragging, look for another card whose left /
// centre / right (or top / middle / bottom) is within a few SCREEN pixels
// of the dragged card's, snap to it, and draw the line you snapped to.
// Screen-space threshold, not world-space, so the catch feels identical
// whether you're at 19% or 200%.
function _boardsAlignDelta(moving,others,zoom){
  const tol=_BOARDS_SNAP_PX/zoom;
  let best={dx:0,dy:0,vx:null,hy:null,bdx:tol+1,bdy:tol+1};
  const mx=[moving.x,moving.x+moving.w/2,moving.x+moving.w];
  const my=[moving.y,moving.y+moving.h/2,moving.y+moving.h];
  others.forEach(o=>{
    const ox=[o.x,o.x+o.w/2,o.x+o.w];
    const oy=[o.y,o.y+o.h/2,o.y+o.h];
    mx.forEach(m=>ox.forEach(t=>{
      const d=t-m;
      if(Math.abs(d)<Math.abs(best.bdx)){best.bdx=d;best.dx=d;best.vx=t;}
    }));
    my.forEach(m=>oy.forEach(t=>{
      const d=t-m;
      if(Math.abs(d)<Math.abs(best.bdy)){best.bdy=d;best.dy=d;best.hy=t;}
    }));
  });
  if(Math.abs(best.bdx)>tol){best.dx=0;best.vx=null;}
  if(Math.abs(best.bdy)>tol){best.dy=0;best.hy=null;}
  return best;
}
function _boardsShowGuides(vx,hy){
  const v=document.getElementById('board-guide-v'),h=document.getElementById('board-guide-h');
  if(v){if(vx==null)v.style.display='none';else{v.style.display='block';v.style.left=vx+'px';}}
  if(h){if(hy==null)h.style.display='none';else{h.style.display='block';h.style.top=hy+'px';}}
}
function _boardsHideGuides(){_boardsShowGuides(null,null);}

window.boardsCardDragStart=function(e,cardId){
  e.stopPropagation();
  const b=_editBoard;const c=_editCards.find(x=>x.id===cardId);if(!c)return;
  if(c.locked){showToast('Card is locked — unlock it to move it');return;}
  _boardsSelectCard(cardId,e.shiftKey||e.ctrlKey||e.metaKey);
  // Drag the whole selection when the grabbed card is part of one; locked
  // cards in that selection stay put rather than blocking the rest.
  let group=(_boardsSelection.has(cardId)?_boardsSelectedCards():[c]).filter(x=>!x.locked);
  // A frame takes whatever is sitting inside it along for the ride —
  // membership computed here, at grab time, not stored (see _boardsCardsInFrame).
  const withFrames=new Set(group.map(g=>g.id));
  group.filter(g=>g.type==='frame').forEach(f=>{
    _boardsCardsInFrame(f).forEach(x=>{if(!x.locked)withFrames.add(x.id);});
  });
  group=_editCards.filter(x=>withFrames.has(x.id));
  if(!group.length)return;
  const origins=group.map(x=>({card:x,ox:x.x,oy:x.y}));
  const others=_editCards.filter(x=>!group.some(g=>g.id===x.id));
  const head=e.currentTarget;
  const startX=e.clientX,startY=e.clientY;
  let pushed=false;
  head.setPointerCapture(e.pointerId);
  function move(ev){
    // One undo entry per gesture, pushed on the first actual movement —
    // a plain click on the header shouldn't leave a no-op in the stack.
    if(!pushed){_boardsPushUndo();pushed=true;}
    let dx=(ev.clientX-startX)/b.zoom;
    let dy=(ev.clientY-startY)/b.zoom;
    if(_boardsSnapGrid){
      // Grid and alignment guides would fight each other, so grid wins
      // outright when it's switched on.
      dx=Math.round((origins[0].ox+dx)/_BOARDS_GRID)*_BOARDS_GRID-origins[0].ox;
      dy=Math.round((origins[0].oy+dy)/_BOARDS_GRID)*_BOARDS_GRID-origins[0].oy;
      _boardsHideGuides();
    }else if(!ev.altKey){
      // Alt suspends snapping for fine placement.
      const lead=origins[0];
      const probe={x:lead.ox+dx,y:lead.oy+dy,w:lead.card.w,h:lead.card.h};
      const a=_boardsAlignDelta(probe,others,b.zoom);
      dx+=a.dx;dy+=a.dy;
      _boardsShowGuides(a.vx,a.hy);
    }else{
      _boardsHideGuides();
    }
    origins.forEach(o=>{
      o.card.x=o.ox+dx;o.card.y=o.oy+dy;
      const el=document.getElementById('board-card-'+o.card.id);
      if(el){el.style.left=o.card.x+'px';el.style.top=o.card.y+'px';}
      _boardsUpdateConnectorsFor(o.card.id);
    });
  }
  function up(){
    head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',up);
    _boardsHideGuides();
    if(pushed)_boardsSaveDebounced();
  }
  head.addEventListener('pointermove',move);
  head.addEventListener('pointerup',up);
};
window.boardsResizeStart=function(e,cardId){
  e.stopPropagation();
  const b=_editBoard;const c=_editCards.find(x=>x.id===cardId);if(!c)return;
  if(c.locked){showToast('Card is locked — unlock it to resize it');return;}
  const startX=e.clientX,startY=e.clientY,origW=c.w,origH=c.h;
  let pushed=false;
  const handle=e.currentTarget;handle.setPointerCapture(e.pointerId);
  function move(ev){
    if(!pushed){_boardsPushUndo();pushed=true;}
    c.w=Math.max(90,origW+(ev.clientX-startX)/b.zoom);
    c.h=Math.max(60,origH+(ev.clientY-startY)/b.zoom);
    const el=document.getElementById('board-card-'+cardId);
    if(el){el.style.width=c.w+'px';el.style.height=c.h+'px';}
    _boardsUpdateConnectorsFor(cardId);
  }
  function up(){handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);_boardsSaveDebounced();}
  handle.addEventListener('pointermove',move);
  handle.addEventListener('pointerup',up);
};
// ── Selection ──────────────────────────────────────────────────────────
// A Set of ids rather than a single one. Nearly everything in Stage 2
// (bulk move/delete/duplicate, z-order, lock, copy) is the same code
// whether one card or twelve are selected — which is exactly why this had
// to land before the rest of the stage rather than after it.
function _boardsSelectedCards(){return _editCards.filter(c=>_boardsSelection.has(c.id));}
function _boardsPaintSelection(){
  document.querySelectorAll('.board-card-el').forEach(el=>el.classList.toggle('selected',_boardsSelection.has(el.dataset.id)));
  _boardsRenderSelectionBar();
}
function _boardsSetSelection(ids){
  _boardsSelection=new Set(ids);
  _boardsPaintSelection();
}
function _boardsSelectCard(id,additive){
  if(additive){
    if(_boardsSelection.has(id))_boardsSelection.delete(id);
    else _boardsSelection.add(id);
  }else{
    // Clicking an already-multi-selected card keeps the group, so you can
    // grab a selection of twelve by its edge and drag the lot.
    if(_boardsSelection.has(id)&&_boardsSelection.size>1)return _boardsPaintSelection();
    _boardsSelection=new Set([id]);
  }
  _boardsPaintSelection();
}
window.boardsSelectCard=function(id,ev){
  // A click on the header arrives AFTER that header's pointerdown has
  // already run boardsCardDragStart, which selects. Without this guard a
  // shift-click on a header would toggle twice and cancel itself out.
  if(ev&&ev.target&&ev.target.closest&&ev.target.closest('.board-card-head'))return;
  const additive=!!(ev&&(ev.shiftKey||ev.ctrlKey||ev.metaKey));
  _boardsSelectCard(id,additive);
};
window.boardsClearSelection=function(){_boardsSetSelection([]);};
window.boardsSelectAll=function(){_boardsSetSelection(_editCards.map(c=>c.id));};

// Contextual bar — only present while something is selected, so the canvas
// stays clean when it isn't.
function _boardsRenderSelectionBar(){
  const host=document.getElementById('board-selection-bar');
  if(!host)return;
  const sel=_boardsSelectedCards();
  if(!sel.length||!_boardsCanEdit(_editBoard)){host.innerHTML='';host.style.display='none';return;}
  const anyLocked=sel.some(c=>c.locked);
  host.style.display='flex';
  const multi=sel.length>1;
  host.innerHTML=`
    <span class="board-sel-count">${sel.length} selected</span>
    <span class="board-swatches">${_BOARDS_COLORS.map(col=>`<button class="board-swatch sw-${col}" onclick="window.boardsSetColor('${col}')" title="${col==='none'?'No colour':col}"></button>`).join('')}</span>
    ${multi?`<button class="tool-btn" onclick="window.boardsFrameSelection()" title="Wrap these in a labelled frame">Frame</button>
    <button class="tool-btn" onclick="window.boardsStackSelection()" title="Stack vertically">Stack</button>
    <button class="tool-btn" onclick="window.boardsGridSelection()" title="Arrange in a grid">Grid</button>`:''}
    ${multi?'':`<button class="tool-btn" onclick="window.boardsOpenComments('${sel[0].id}')" title="Comment on this card">Comment</button>
    <button class="tool-btn" onclick="window.boardsCopyCardLink()" title="Copy a link that opens the board on this card">Link</button>`}
    <button class="tool-btn" onclick="window.boardsDuplicateSelection()" title="Duplicate (Ctrl+D)">Duplicate</button>
    <button class="tool-btn" onclick="window.boardsBringToFront()" title="Bring to front">Front</button>
    <button class="tool-btn" onclick="window.boardsSendToBack()" title="Send to back">Back</button>
    <button class="tool-btn" onclick="window.boardsToggleLock()">${anyLocked?'Unlock':'Lock'}</button>
    <button class="tool-btn" style="color:var(--accent-urgent)" onclick="window.boardsDeleteSelection()" title="Delete">Delete</button>
    <button class="tool-btn" onclick="window.boardsClearSelection()" title="Clear selection (Esc)">✕</button>`;
}

// -- connectors --
function _boardCardCenter(c){return{x:c.x+c.w/2,y:c.y+c.h/2};}
// Two kinds of connector share this layer: card-bound ({from,to}, endpoints
// follow the cards) and freeform ({free:true,x1,y1,x2,y2}, fixed in world
// space). Both can carry `arrow:true`. Deleting is by INDEX rather than by
// from/to, since freeform lines have no card ids to identify them.
function _boardsDrawConnectors(){
  const svg=document.getElementById('board-conn-layer');if(!svg)return;
  const defs='<defs><marker id="board-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>';
  svg.innerHTML=defs+_editConnectors.map((cn,i)=>{
    const arrow=cn.arrow?' marker-end="url(#board-arrow)"':'';
    if(cn.free){
      return`<line class="free" x1="${cn.x1}" y1="${cn.y1}" x2="${cn.x2}" y2="${cn.y2}"${arrow} onclick="window.boardsDeleteConnectorAt(${i})"/>`;
    }
    const from=_editCards.find(c=>c.id===cn.from),to=_editCards.find(c=>c.id===cn.to);
    if(!from||!to)return'';
    const p1=_boardCardCenter(from),p2=_boardCardCenter(to);
    return`<line data-from="${cn.from}" data-to="${cn.to}" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"${arrow} onclick="window.boardsDeleteConnectorAt(${i})"/>`;
  }).join('');
}
window.boardsDeleteConnectorAt=function(i){
  if(!_boardsCanEdit(_editBoard))return;
  _boardsPushUndo();
  _editConnectors.splice(i,1);
  _boardsDrawConnectors();
  _boardsSaveDebounced();
};
window.boardsToggleLineMode=function(){
  _boardsLineMode=!_boardsLineMode;
  const btn=document.getElementById('board-line-btn');
  if(btn)btn.classList.toggle('on',_boardsLineMode);
  const stage=document.getElementById('board-stage');
  if(stage)stage.classList.toggle('line-mode',_boardsLineMode);
  showToast(_boardsLineMode?'Line mode on — drag on the canvas to draw an arrow':'Line mode off');
};
function _boardsUpdateConnectorsFor(cardId){
  const svg=document.getElementById('board-conn-layer');if(!svg)return;
  const c=_editCards.find(x=>x.id===cardId);if(!c)return;
  const p=_boardCardCenter(c);
  svg.querySelectorAll('line').forEach(line=>{
    if(line.dataset.from===cardId){line.setAttribute('x1',p.x);line.setAttribute('y1',p.y);}
    if(line.dataset.to===cardId){line.setAttribute('x2',p.x);line.setAttribute('y2',p.y);}
  });
}
window.boardsLinkStart=function(e,cardId){
  e.stopPropagation();
  const from=_editCards.find(x=>x.id===cardId);if(!from)return;
  const svg=document.getElementById('board-conn-layer');
  const temp=document.createElementNS('http://www.w3.org/2000/svg','line');
  temp.setAttribute('class','temp');
  const p1=_boardCardCenter(from);
  temp.setAttribute('x1',p1.x);temp.setAttribute('y1',p1.y);temp.setAttribute('x2',p1.x);temp.setAttribute('y2',p1.y);
  svg.appendChild(temp);
  function move(ev){const wp=_boardsScreenToWorld(ev.clientX,ev.clientY);temp.setAttribute('x2',wp.x);temp.setAttribute('y2',wp.y);}
  function up(ev){
    document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);
    temp.remove();
    const el=document.elementFromPoint(ev.clientX,ev.clientY);
    const targetEl=el&&el.closest?el.closest('.board-card-el'):null;
    if(targetEl&&targetEl.dataset.id&&targetEl.dataset.id!==cardId){
      const toId=targetEl.dataset.id;
      const exists=_editConnectors.some(cn=>(cn.from===cardId&&cn.to===toId)||(cn.from===toId&&cn.to===cardId));
      if(!exists){_boardsPushUndo();_editConnectors.push({from:cardId,to:toId});_boardsDrawConnectors();_boardsSaveDebounced();}
    }
  }
  document.addEventListener('pointermove',move);
  document.addEventListener('pointerup',up);
};

// -- card content --
window.boardsTitleInput=function(val){if(!_editBoard)return;_editBoard.title=val;_boardsSaveDebounced();};
window.boardsTextInput=function(id,el){const c=_editCards.find(x=>x.id===id);if(!c)return;c.text=el.textContent;_boardsSaveDebounced();};
window.boardsLinkInput=function(id,field,val){const c=_editCards.find(x=>x.id===id);if(!c)return;c[field]=val;_boardsSaveDebounced();};
window.boardsFrameTitle=function(id,val){const c=_editCards.find(x=>x.id===id);if(!c)return;c.title=val;_boardsSaveDebounced();};

// ── To-do cards ────────────────────────────────────────────────────────
// Text edits mutate in place with no rerender (same cursor-stability
// reason as Notes' block editor); only structural changes — adding,
// removing or ticking an item — rebuild, since those change the layout.
function _boardsTodoCard(id){const c=_editCards.find(x=>x.id===id);return(c&&c.type==='todo')?c:null;}
window.boardsTodoText=function(id,i,el){
  const c=_boardsTodoCard(id);if(!c||!c.items[i])return;
  c.items[i].text=el.textContent;
  _boardsSaveDebounced();
};
window.boardsTodoToggle=function(id,i,done){
  const c=_boardsTodoCard(id);if(!c||!c.items[i])return;
  _boardsPushUndo();
  c.items[i].done=!!done;
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
window.boardsTodoAdd=function(id,at){
  const c=_boardsTodoCard(id);if(!c)return;
  _boardsPushUndo();
  const idx=(typeof at==='number')?at+1:c.items.length;
  c.items.splice(idx,0,{text:'',done:false});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  const el=document.getElementById('board-todo-'+id+'-'+idx);
  if(el)el.focus();
};
window.boardsTodoRemove=function(id,i){
  const c=_boardsTodoCard(id);if(!c)return;
  _boardsPushUndo();
  c.items.splice(i,1);
  if(!c.items.length)c.items.push({text:'',done:false});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
window.boardsTodoKey=function(ev,id,i){
  // Enter adds the next item and jumps to it; Backspace on an empty row
  // removes it — the two things that make a checklist quick to type.
  if(ev.key==='Enter'){ev.preventDefault();window.boardsTodoAdd(id,i);return;}
  if(ev.key==='Backspace'&&!(ev.target.textContent||'').length){
    const c=_boardsTodoCard(id);
    if(c&&c.items.length>1){
      ev.preventDefault();
      window.boardsTodoRemove(id,i);
      const prev=document.getElementById('board-todo-'+id+'-'+Math.max(0,i-1));
      if(prev)prev.focus();
    }
  }
};

// ── Colour tagging ─────────────────────────────────────────────────────
// Status coding at a glance on a 46-card board. Muted set, matching the
// app's palette rather than bright primaries.
const _BOARDS_COLORS=['none','red','amber','green','blue','purple'];
window.boardsSetColor=function(color){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards();
  if(!sel.length)return;
  _boardsPushUndo();
  sel.forEach(c=>{if(color==='none')delete c.color;else c.color=color;});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};

// ── Tidy actions ───────────────────────────────────────────────────────
// The roadmap listed "Columns (auto-stacking vertical lists)". A real
// column container needs stored membership and would have to reposition
// its children — which fights the deliberately membership-free frame
// model above. These arrange-once actions deliver the actual value (tidy
// alignment without hand-placing every card) with no new data model, and
// compose with frames: stack, then draw a labelled frame around the
// result. If a true container is wanted later it's a separate build.
window.boardsStackSelection=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards().filter(c=>!c.locked&&c.type!=='frame');
  if(sel.length<2)return showToast('Select at least two cards');
  _boardsPushUndo();
  const ordered=sel.slice().sort((a,b)=>a.y-b.y);
  const x=Math.min(...ordered.map(c=>c.x));
  let y=Math.min(...ordered.map(c=>c.y));
  ordered.forEach(c=>{c.x=x;c.y=y;y+=c.h+12;});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
window.boardsGridSelection=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards().filter(c=>!c.locked&&c.type!=='frame');
  if(sel.length<2)return showToast('Select at least two cards');
  _boardsPushUndo();
  const ordered=sel.slice().sort((a,b)=>(a.y-b.y)||(a.x-b.x));
  const x0=Math.min(...ordered.map(c=>c.x)),y0=Math.min(...ordered.map(c=>c.y));
  const colW=Math.max(...ordered.map(c=>c.w))+16;
  const rowH=Math.max(...ordered.map(c=>c.h))+16;
  const per=Math.ceil(Math.sqrt(ordered.length));
  ordered.forEach((c,i)=>{c.x=x0+(i%per)*colW;c.y=y0+Math.floor(i/per)*rowH;});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
// Wrap the selection in a labelled frame — the fastest path to the
// clustered layout Afnan's real boards use.
window.boardsFrameSelection=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards().filter(c=>c.type!=='frame');
  if(!sel.length)return showToast('Select some cards first');
  _boardsPushUndo();
  const pad=28,head=34;
  const minX=Math.min(...sel.map(c=>c.x)),minY=Math.min(...sel.map(c=>c.y));
  const maxX=Math.max(...sel.map(c=>c.x+c.w)),maxY=Math.max(...sel.map(c=>c.y+c.h));
  const f=_boardsNewCard('frame');
  f.x=minX-pad;f.y=minY-pad-head;
  f.w=(maxX-minX)+pad*2;f.h=(maxY-minY)+pad*2+head;
  _editCards.push(f);
  _boardsSetSelection([f.id]);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  const el=document.querySelector('#board-card-'+f.id+' .board-frame-title');
  if(el)el.focus();
};
// Boards needs to accept ANY file (tech packs, spec sheets), not just
// images. shared.js's uploadToCloudinary() posts to the /image/upload
// endpoint, which rejects non-image types — so boards has its own call to
// /auto/upload with the same unsigned preset. Deliberately local rather
// than widening the shared helper: js/shared.js is a cross-track file both
// contributors edit (see CLAUDE.md "Shared touchpoints"), and this is six
// lines that only boards needs.
async function _boardsUploadAny(file){
  const fd=new FormData();
  fd.append('file',file);
  fd.append('upload_preset','groovy-ops');
  const r=await fetch('https://api.cloudinary.com/v1_1/deww4lpym/auto/upload',{method:'POST',body:fd});
  const d=await r.json();
  if(!d.secure_url)throw new Error((d.error&&d.error.message)||'Upload failed');
  return d;
}
// PDF page-1 thumbnail via a Cloudinary delivery transform. Best effort by
// design: the caller renders it in an <img> with an onerror fallback, so an
// account that can't rasterise PDFs just shows the plain file card.
function _boardsPdfThumbUrl(url){
  if(!url||!/\.pdf($|\?)/i.test(url))return'';
  if(url.indexOf('/upload/')===-1)return'';
  return url.replace('/upload/','/upload/pg_1,w_600,c_fit/').replace(/\.pdf($|\?)/i,'.jpg$1');
}
function _boardsIsImageFile(file){
  return!!(file&&file.type&&file.type.indexOf('image/')===0);
}

window.boardsUploadToCard=async function(id,inputEl){
  const file=inputEl.files&&inputEl.files[0];
  if(!file)return;
  _boardsPushUndo();
  await _boardsUploadFileToCard(id,file);
};
// Dropping 20 files starts 20 parallel uploads that each finish at their
// own moment. Re-rendering per completion would rebuild the whole canvas
// 20 times and fire 20 Firestore writes, so both are coalesced: renders
// collapse into the next frame, and the 900ms autosave debounce naturally
// folds the whole burst into one write.
let _boardsRenderQueued=false;
function _boardsRenderSoon(){
  if(_boardsRenderQueued)return;
  _boardsRenderQueued=true;
  requestAnimationFrame(()=>{
    _boardsRenderQueued=false;
    if(currentPage==='board-canvas'&&_editBoard)_boardsRenderCanvasAndWire();
  });
}
async function _boardsUploadFileToCard(cardId,file){
  const c=_editCards.find(x=>x.id===cardId);
  if(!c)return;
  c._uploading=true;
  _boardsRenderSoon();
  try{
    const res=await _boardsUploadAny(file);
    const card=_editCards.find(x=>x.id===cardId);
    if(!card)return;   // card was deleted or undone while the upload ran
    if(card.type==='image'){
      card.imageUrl=res.secure_url;
    }else{
      card.type='file';
      card.fileUrl=res.secure_url;
      card.fileName=file.name||(res.original_filename||'file');
      card.fileSize=res.bytes||file.size||0;
    }
    delete card._uploading;
    _boardsRenderSoon();
    _boardsSaveDebounced();
  }catch(e){
    const card=_editCards.find(x=>x.id===cardId);
    if(card)delete card._uploading;
    _boardsRenderSoon();
    showToast('Upload failed: '+(e.message||e),true);
  }
}

// Drop (or pick) any number of files at once: one card each, laid out in a
// grid from the drop point rather than all landing on the same spot, then
// uploaded in parallel with each card showing its own "Uploading…" state.
function _boardsAddFiles(files,at){
  if(!_boardsCanEdit(_editBoard)||!files.length)return;
  _boardsPushUndo();
  const perRow=Math.min(4,Math.ceil(Math.sqrt(files.length)));
  const made=files.map((f,i)=>{
    const isImg=_boardsIsImageFile(f);
    const c=_boardsNewCard(isImg?'image':'file');
    c.x=at.x+(i%perRow)*(c.w+16);
    c.y=at.y+Math.floor(i/perRow)*(c.h+16);
    c._uploading=true;
    _editCards.push(c);
    return{card:c,file:f};
  });
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  made.forEach(({card,file})=>{_boardsUploadFileToCard(card.id,file);});
}
window.boardsPickFiles=function(){
  const el=document.getElementById('board-file-picker');
  if(el)el.click();
};
window.boardsFilesPicked=function(inputEl){
  const files=Array.from(inputEl.files||[]);
  inputEl.value='';
  if(files.length)_boardsAddFiles(files,_boardsPlacementPoint());
};

// Paste-to-add: Ctrl+V while a board is open turns whatever's on the
// clipboard into the obvious card — an image, a URL, or plain text.
// Registered once at load (not per-render) and self-gates on
// currentPage/_editBoard, so it never stacks duplicate listeners across
// board visits.
//
// An image always wins, even with a text card focused, because pasting an
// image INTO contenteditable does nothing useful anyway. Text with a card
// focused is left entirely alone — that's an ordinary paste into the text
// you're editing, and hijacking it would be infuriating.
function _boardsOnPaste(e){
  if(currentPage!=='board-canvas'||!_editBoard||!_boardsCanEdit(_editBoard))return;
  const items=(e.clipboardData&&e.clipboardData.items)||[];
  let imageFile=null;
  for(const item of items){
    if(item.type&&item.type.indexOf('image')===0){imageFile=item.getAsFile();break;}
  }
  if(imageFile){
    e.preventDefault();
    // Fill a single selected empty image card, if that's what's selected;
    // otherwise make a new one.
    const selected=_boardsSelectedCards();
    let card=(selected.length===1&&selected[0].type==='image'&&!selected[0].imageUrl)?selected[0]:null;
    if(!card){
      _boardsPushUndo();
      card=_boardsNewCard('image');
      const p=_boardsPlacementPoint();
      card.x=p.x;card.y=p.y;
      _editCards.push(card);
      _boardsRenderCanvasAndWire();
    }else{
      _boardsPushUndo();
    }
    _boardsUploadFileToCard(card.id,imageFile);
    return;
  }
  if(_boardsIsEditableFocus())return;
  const text=((e.clipboardData&&e.clipboardData.getData('text/plain'))||'').trim();
  // Cards copied from a board (possibly a different one, or another tab)
  // come back as tagged JSON — handled before the URL/text cases.
  if(text.indexOf(_BOARDS_CLIP_PREFIX)===0){
    e.preventDefault();
    let payload=null;
    try{payload=JSON.parse(text.slice(_BOARDS_CLIP_PREFIX.length));}catch(err){payload=null;}
    if(Array.isArray(payload)&&payload.length){_boardsPasteCards(payload);return;}
  }
  if(!text){
    // Nothing usable on the system clipboard, but this session copied cards
    // earlier (the setData call can be refused in some browsers) — fall back.
    if(_boardsClipboard.length){e.preventDefault();_boardsPasteCards(_boardsClipboard);}
    return;
  }
  e.preventDefault();
  _boardsPushUndo();
  const p=_boardsPlacementPoint();
  const isUrl=/^https?:\/\/\S+$/i.test(text);
  const c=_boardsNewCard(isUrl?'link':'text');
  c.x=p.x;c.y=p.y;
  if(isUrl){
    c.linkUrl=text;
    let host='';
    try{host=new URL(text).hostname.replace(/^www\./,'');}catch(err){host='';}
    c.linkTitle=host;
  }else{
    c.text=text;
    // Give a long pasted block room rather than a cramped default box.
    if(text.length>180)c.h=Math.min(320,100+Math.floor(text.length/40)*16);
  }
  _editCards.push(c);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  showToast(isUrl?'Link added':'Note added');
}
document.addEventListener('paste',_boardsOnPaste);
window.boardsAddCard=function(type){
  const b=_editBoard;if(!b)return;
  _boardsPushUndo();
  const nc=_boardsNewCard(type);
  const p=_boardsPlacementPoint();
  nc.x=p.x;nc.y=p.y;
  _editCards.push(nc);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  _boardsLogBoardActivity('added a '+(type==='todo'?'to-do':type)+' card');
};
// Keeps the in-memory gallery copy of THIS board in step without waiting
// for the debounced write. Only matters for card changes the gallery
// itself reasons about — deleting a sub-board link, which is what decides
// whether the child board shows at root level (see _boardsNestedIds).
function _boardsSyncLocalCards(){
  if(!_editBoard)return;
  const idx=moodBoards.findIndex(b=>b.id===_editBoard.id);
  if(idx>-1)moodBoards[idx]={...moodBoards[idx],cards:_boardsCardsForSave()};
}
window.boardsDeleteCard=function(id){
  const c=_editCards.find(x=>x.id===id);
  if(c&&c.locked){showToast('That card is locked');return;}
  _boardsPushUndo();
  _editCards=_editCards.filter(x=>x.id!==id);
  _editConnectors=_editConnectors.filter(cn=>cn.from!==id&&cn.to!==id);
  _boardsSelection.delete(id);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  if(c&&c.type==='board'){
    _boardsSyncLocalCards();
    showToast('Link removed — the sub-board itself is back in the boards list');
  }
  _boardsLogBoardActivity('deleted a card');
};

// ── Bulk actions on the selection ──────────────────────────────────────
window.boardsDeleteSelection=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards();
  const removable=sel.filter(c=>!c.locked);
  if(!removable.length){showToast(sel.length?'Those cards are locked':'Nothing selected');return;}
  _boardsPushUndo();
  const ids=new Set(removable.map(c=>c.id));
  _editCards=_editCards.filter(c=>!ids.has(c.id));
  _editConnectors=_editConnectors.filter(cn=>!ids.has(cn.from)&&!ids.has(cn.to));
  ids.forEach(id=>_boardsSelection.delete(id));
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  if(removable.some(c=>c.type==='board')){
    _boardsSyncLocalCards();
    showToast('Sub-board links removed — those boards are back in the boards list');
  }
  if(removable.length<sel.length)showToast('Kept '+(sel.length-removable.length)+' locked card'+(sel.length-removable.length===1?'':'s'));
  _boardsLogBoardActivity('deleted '+removable.length+' card'+(removable.length===1?'':'s'));
};
// Clones land offset from the originals and become the new selection, so a
// duplicate can be dragged straight into place without re-selecting it.
// Deep clone, not a key-by-key copy: to-do cards carry an `items` array,
// and a shallow copy would leave the duplicate sharing that array with the
// original — ticking a box on one would tick it on both.
function _boardsCloneCards(cards,dx,dy){
  return cards.map(c=>{
    const stripped={};
    Object.keys(c).forEach(k=>{if(k.charAt(0)!=='_')stripped[k]=c[k];});
    const copy=JSON.parse(JSON.stringify(stripped));
    copy.id=_boardsNewCard(c.type).id;
    copy.x=(c.x||0)+dx;copy.y=(c.y||0)+dy;
    delete copy.locked;
    return copy;
  });
}
window.boardsDuplicateSelection=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards();
  if(!sel.length)return;
  _boardsPushUndo();
  const clones=_boardsCloneCards(sel,24,24);
  _editCards=_editCards.concat(clones);
  _boardsSelection=new Set(clones.map(c=>c.id));
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
// Z-order IS array order — later in _editCards paints on top, since the
// cards are absolutely-positioned siblings. So "bring to front" is just a
// reorder, and nothing new has to be persisted or migrated.
window.boardsBringToFront=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards();
  if(!sel.length)return;
  _boardsPushUndo();
  const ids=new Set(sel.map(c=>c.id));
  _editCards=_editCards.filter(c=>!ids.has(c.id)).concat(sel);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
window.boardsSendToBack=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards();
  if(!sel.length)return;
  _boardsPushUndo();
  const ids=new Set(sel.map(c=>c.id));
  _editCards=sel.concat(_editCards.filter(c=>!ids.has(c.id)));
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
// Lock stops a finished background image or header label being nudged by
// accident. Locked cards stay selectable — that's how you unlock them.
window.boardsToggleLock=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards();
  if(!sel.length)return;
  _boardsPushUndo();
  const unlocking=sel.some(c=>c.locked);
  sel.forEach(c=>{if(unlocking)delete c.locked;else c.locked=true;});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};

// ── Copy / cut / paste of cards ────────────────────────────────────────
// Cards go onto the SYSTEM clipboard as tagged JSON rather than living only
// in a module variable. That removes the "which clipboard wins?" question
// from the paste handler entirely — the OS clipboard is the single source
// of truth — and it means a copy survives across tabs, not just across
// boards in one session.
function _boardsOnCopy(e,cut){
  if(currentPage!=='board-canvas'||!_editBoard||!_boardsCanEdit(_editBoard))return;
  if(_boardsIsEditableFocus())return;
  const sel=_boardsSelectedCards();
  if(!sel.length)return;
  const payload=_boardsCloneCards(sel,0,0);
  _boardsClipboard=payload;
  try{
    e.clipboardData.setData('text/plain',_BOARDS_CLIP_PREFIX+JSON.stringify(payload));
    e.preventDefault();
  }catch(err){/* keep the in-memory copy; paste still works this session */}
  if(cut)window.boardsDeleteSelection();
  else showToast(sel.length+' card'+(sel.length===1?'':'s')+' copied');
}
document.addEventListener('copy',e=>_boardsOnCopy(e,false));
document.addEventListener('cut',e=>_boardsOnCopy(e,true));
function _boardsPasteCards(cards){
  if(!cards||!cards.length)return false;
  _boardsPushUndo();
  const p=_boardsPlacementPoint();
  const minX=Math.min(...cards.map(c=>c.x||0));
  const minY=Math.min(...cards.map(c=>c.y||0));
  // Keep the copied group's internal layout, just move the whole cluster
  // to where the new cards are being placed.
  const clones=_boardsCloneCards(cards,p.x-minX,p.y-minY);
  _editCards=_editCards.concat(clones);
  _boardsSelection=new Set(clones.map(c=>c.id));
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  showToast(clones.length+' card'+(clones.length===1?'':'s')+' pasted');
  return true;
}
window.boardsToggleVisibility=async function(){
  if(!_boardsCanEdit(_editBoard))return;
  _boardsMenuOpen=false;_boardsSyncMenu();
  const next=_editBoard.visibility==='shared'?'personal':'shared';
  try{
    await updateDoc(doc(db,'mood_boards',_editBoard.id),{visibility:next,updatedAt:Date.now()});
    _editBoard.visibility=next;
    boardsLoaded=false;
    _boardsLogBoardActivity('made the board '+(next==='shared'?'TEAM':'PRIVATE'));
    showToast('Visibility updated');
    _boardsRenderCanvasAndWire();
  }catch(e){showToast('Could not update visibility: '+(e.message||e),true);}
};
// Soft delete — the document stays, flagged, and the board moves to the
// Trash section of the gallery where it can be restored or removed for
// good. Deleting a whole board is the one genuinely unrecoverable action
// here; deleting a single CARD deliberately has no trash of its own,
// because Ctrl+Z already covers it.
window.boardsDelete=async function(){
  if(!_editBoard||!_boardsCanEdit(_editBoard))return;
  _boardsMenuOpen=false;_boardsSyncMenu();
  if(!confirm('Move "'+(_editBoard.title||'Untitled board')+'" to Trash? You can restore it from the boards list.'))return;
  try{
    await updateDoc(doc(db,'mood_boards',_editBoard.id),{deletedAt:Date.now(),deletedByName:session.name,updatedAt:Date.now()});
    moodBoards=moodBoards.filter(b=>b.id!==_editBoard.id);
    boardsLoaded=false;
    logActivity('Mood board deleted',`${session.name} moved "${_editBoard.title||'Untitled board'}" to trash`);
    showToast('Board moved to Trash');
    _editBoard=null;_editCards=[];_editConnectors=[];
    window.showPage('boards');
  }catch(e){showToast('Could not delete: '+(e.message||e),true);}
};

// ── Board menu (Stage 4) ───────────────────────────────────────────────
// The dropdown is always in the DOM and only its display is toggled — a
// full _boardsRenderCanvasAndWire() to open a menu would rebuild every
// card and redraw every connector on a 46-card board just to show five
// buttons.
function _boardsSyncMenu(){
  const el=document.getElementById('board-menu');
  if(el)el.style.display=_boardsMenuOpen?'flex':'none';
}
window.boardsToggleMenu=function(ev){
  if(ev)ev.stopPropagation();
  _boardsMenuOpen=!_boardsMenuOpen;
  _boardsSyncMenu();
};
// Registered once at load, like the paste/keydown handlers — the canvas
// DOM is replaced on every render, so a listener added there would pile up.
document.addEventListener('click',e=>{
  if(!_boardsMenuOpen)return;
  if(e.target&&e.target.closest&&e.target.closest('.board-menu-wrap'))return;
  _boardsMenuOpen=false;
  _boardsSyncMenu();
});

// ── Find within a board (Stage 4) ──────────────────────────────────────
// Highlighting is a class toggle on existing elements, never a rerender:
// retyping in the find box must not rebuild the canvas under the cursor.
window.boardsToggleFind=function(){
  _boardsFindOpen=!_boardsFindOpen;
  if(!_boardsFindOpen){_boardsFindQuery='';_boardsFindHits=[];_boardsFindIdx=0;}
  _boardsRenderCanvasAndWire();
  if(_boardsFindOpen){const i=document.getElementById('board-find-input');if(i)i.focus();}
};
window.boardsFindInput=function(el){
  _boardsFindQuery=el.value;
  clearTimeout(_boardsFindTimer);
  _boardsFindTimer=setTimeout(_boardsRunFind,180);
};
function _boardsRunFind(){
  const q=_boardsFindQuery.trim().toLowerCase();
  _boardsFindHits=q?_editCards.filter(c=>_boardsCardText(c).indexOf(q)>-1).map(c=>c.id):[];
  _boardsFindIdx=0;
  _boardsApplyFindHighlight();
  if(_boardsFindHits.length)_boardsFindFocusCurrent();
}
function _boardsApplyFindHighlight(){
  const stage=document.getElementById('board-stage');
  if(!stage)return;
  stage.querySelectorAll('.found,.found-current').forEach(el=>el.classList.remove('found','found-current'));
  _boardsFindHits.forEach((id,i)=>{
    const el=document.getElementById('board-card-'+id);
    if(!el)return;
    el.classList.add('found');
    if(i===_boardsFindIdx)el.classList.add('found-current');
  });
  const cnt=document.getElementById('board-find-count');
  if(cnt)cnt.textContent=!_boardsFindQuery.trim()?'':(_boardsFindHits.length?(_boardsFindIdx+1)+' / '+_boardsFindHits.length:'no matches');
}
window.boardsFindStep=function(d){
  if(!_boardsFindHits.length)return;
  _boardsFindIdx=(_boardsFindIdx+d+_boardsFindHits.length)%_boardsFindHits.length;
  _boardsApplyFindHighlight();
  _boardsFindFocusCurrent();
};
window.boardsFindKey=function(ev){
  if(ev.key==='Enter'){ev.preventDefault();window.boardsFindStep(ev.shiftKey?-1:1);}
  else if(ev.key==='Escape'){ev.preventDefault();window.boardsToggleFind();}
};
// Pans to the match, deliberately WITHOUT changing zoom: someone searching
// at 19% is looking at the whole board on purpose, and yanking them to
// 100% would lose that view.
function _boardsFindFocusCurrent(){
  const c=_editCards.find(x=>x.id===_boardsFindHits[_boardsFindIdx]);
  const b=_editBoard,stage=document.getElementById('board-stage');
  if(!c||!b||!stage)return;
  const r=stage.getBoundingClientRect();
  b.panX=r.width/2-(c.x+c.w/2)*b.zoom;
  b.panY=r.height/2-(c.y+c.h/2)*b.zoom;
  _boardsApplyTransform();
  _boardsSaveDebounced();
}

// ── Minimap (Stage 4) ──────────────────────────────────────────────────
// At 19% zoom on a 46-card board, "where am I" is a real question. The map
// is built from the same cards array, so it can never go stale, and the
// viewport rectangle is updated by _boardsApplyTransform — i.e. on every
// pan and zoom, for the cost of setting four style properties.
window.boardsToggleMinimap=function(){
  _boardsMinimapOn=!_boardsMinimapOn;
  try{localStorage.setItem('groovy-boards-minimap',_boardsMinimapOn?'1':'0');}catch(e){}
  _boardsRenderCanvasAndWire();
};
function _boardsContentBounds(){
  if(!_editCards.length)return null;
  return{
    minX:Math.min(..._editCards.map(c=>c.x)),
    minY:Math.min(..._editCards.map(c=>c.y)),
    maxX:Math.max(..._editCards.map(c=>c.x+c.w)),
    maxY:Math.max(..._editCards.map(c=>c.y+c.h))
  };
}
function _boardsRenderMinimap(){
  const wrap=document.getElementById('board-minimap');
  const inner=document.getElementById('board-minimap-inner');
  if(!wrap||!inner)return;
  const bounds=_boardsContentBounds();
  if(!bounds){inner.innerHTML='';wrap.__mm=null;return;}
  const pad=80;
  const w=(bounds.maxX-bounds.minX)+pad*2,h=(bounds.maxY-bounds.minY)+pad*2;
  const box=wrap.getBoundingClientRect();
  const scale=Math.min((box.width||180)/w,(box.height||120)/h);
  const ox=bounds.minX-pad,oy=bounds.minY-pad;
  wrap.__mm={scale,ox,oy};
  inner.innerHTML=_boardsRenderOrder().map(c=>{
    const x=(c.x-ox)*scale,y=(c.y-oy)*scale;
    const cw=Math.max(2,c.w*scale),ch=Math.max(2,c.h*scale);
    const cls='mm-card'+(c.type==='frame'?' mm-frame':'')+(c.type==='image'?' mm-image':'');
    return`<i class="${cls}" style="left:${x}px;top:${y}px;width:${cw}px;height:${ch}px"></i>`;
  }).join('');
  _boardsUpdateMinimapView();
  _boardsWireMinimap();
}
function _boardsUpdateMinimapView(){
  const wrap=document.getElementById('board-minimap');
  const view=document.getElementById('board-minimap-view');
  const stage=document.getElementById('board-stage');
  const b=_editBoard;
  if(!wrap||!view||!stage||!b||!wrap.__mm){if(view)view.style.display='none';return;}
  const mm=wrap.__mm,r=stage.getBoundingClientRect();
  view.style.display='block';
  view.style.left=((-b.panX/b.zoom)-mm.ox)*mm.scale+'px';
  view.style.top=((-b.panY/b.zoom)-mm.oy)*mm.scale+'px';
  view.style.width=(r.width/b.zoom)*mm.scale+'px';
  view.style.height=(r.height/b.zoom)*mm.scale+'px';
}
function _boardsWireMinimap(){
  const wrap=document.getElementById('board-minimap');
  if(!wrap||wrap.__wired)return;
  wrap.__wired=true;
  wrap.addEventListener('pointerdown',e=>{
    e.stopPropagation();   // the stage's own pan handler must not also fire
    const mm=wrap.__mm,b=_editBoard,stage=document.getElementById('board-stage');
    if(!mm||!b||!stage)return;
    const box=wrap.getBoundingClientRect();
    function go(ev){
      const sr=stage.getBoundingClientRect();
      const wx=(ev.clientX-box.left)/mm.scale+mm.ox;
      const wy=(ev.clientY-box.top)/mm.scale+mm.oy;
      b.panX=sr.width/2-wx*b.zoom;
      b.panY=sr.height/2-wy*b.zoom;
      _boardsApplyTransform();
    }
    go(e);
    try{wrap.setPointerCapture(e.pointerId);}catch(err){}
    function up(){
      wrap.removeEventListener('pointermove',go);
      wrap.removeEventListener('pointerup',up);
      _boardsSaveDebounced();
    }
    wrap.addEventListener('pointermove',go);
    wrap.addEventListener('pointerup',up);
  });
}

// -- save --
// Transient per-render flags are prefixed with "_" and must never reach
// Firestore — a save that fires while files are still uploading would
// otherwise persist `_uploading:true` and the card would come back stuck
// on "Uploading…" forever.
function _boardsCardsForSave(){
  return _editCards.map(c=>{
    const out={};
    Object.keys(c).forEach(k=>{if(k.charAt(0)!=='_')out[k]=c[k];});
    return out;
  });
}
function _boardsSetSaveStatus(text){
  const el=document.getElementById('board-save-status');
  if(el)el.textContent=text;
}
function _boardsSaveDebounced(){
  _boardsSetSaveStatus('Unsaved changes…');
  clearTimeout(_boardsSaveTimer);
  _boardsSaveTimer=setTimeout(_boardsSaveNow,900);
}
// Autosave fires on nearly every interaction (drag, resize, pan, zoom,
// typing) — the app's shared "Saving…" overlay (js/shared.js) is a
// full-screen block meant for occasional, deliberate writes (submitting a
// PO, processing payroll), not something that should flash on every card
// nudge. _gvSilentSaveStart/Stop is the same opt-out `_fabBusy` already
// uses to keep that overlay from stacking with Fabric's own — boards uses
// it here so this file can own its own lightweight status text instead
// (#board-save-status) without touching the shared overlay's behavior for
// anyone else. Only wraps THIS function, not boardsCreate/boardsDelete/
// boardsToggleVisibility — those are one-off, deliberate actions where the
// normal blocking feedback is still the right call.
async function _boardsSaveNow(){
  clearTimeout(_boardsSaveTimer);
  if(!_editBoard||!_editBoard.id||!_boardsCanEdit(_editBoard))return;
  _boardsSetSaveStatus('Saving…');
  if(typeof window._gvSilentSaveStart==='function')window._gvSilentSaveStart();
  try{
  const{cur,changed}=_boardsLocalChanges();
  const conns=_editConnectors.map(c=>({...c}));
  const connDirty=_boardsConnDirty();
  // The board this save belongs to. Leaving a board flushes its save and
  // then immediately opens another one, so by the time the write resolves
  // _editBoard can already be a DIFFERENT board — adopting this save's
  // result as that board's sync baseline would make us think every one of
  // its cards was locally edited, and the next save would write our copy
  // over a colleague's concurrent change. Everything after the await is
  // guarded on this id.
  const savingId=_editBoard.id;
  const ref=doc(db,'mood_boards',savingId);
  const head={
    title:_editBoard.title,
    zoom:_editBoard.zoom,panX:_editBoard.panX,panY:_editBoard.panY,
    updatedAt:Date.now(),updatedByName:session.name
  };
  let wrote=null;
  try{
    if(typeof runTransaction!=='function')throw new Error('no transaction support');
    // Merge against the SERVER's array inside the transaction, not against
    // whatever this tab happens to hold: a card we did not touch keeps the
    // server's version, so a colleague's move survives our save even if
    // their update never reached us.
    wrote=await runTransaction(db,async tx=>{
      const snap=await tx.get(ref);
      const server=snap.exists()?(snap.data()||{}):{};
      const serverCards=Array.isArray(server.cards)?server.cards:[];
      const mineById=_boardsCardsById(cur);
      const serverById=_boardsCardsById(serverCards);
      const merged=[];
      serverCards.forEach(sc=>{
        if(changed.has(sc.id)){
          if(mineById[sc.id])merged.push(mineById[sc.id]);   // our edit wins
          // no local copy → we deleted it, so it stays deleted
        }else merged.push(sc);                                // untouched by us
      });
      cur.forEach(mc=>{if(!serverById[mc.id]&&changed.has(mc.id))merged.push(mc);});   // created here
      const payload={...head,cards:merged,
        connectors:connDirty?conns:(Array.isArray(server.connectors)?server.connectors:conns)};
      tx.update(ref,payload);
      return payload;
    });
  }catch(e){
    // Offline — this is an installed PWA and phones lose signal — or a
    // transaction that ran out of retries. Fall back to the pre-Stage-6
    // queued write (last-writer-wins) rather than refusing to save.
    try{
      const payload={...head,cards:cur,connectors:conns};
      await updateDoc(ref,payload);
      wrote=payload;
      console.warn('[boards] transactional save unavailable, wrote directly:',(e&&e.message)||e);
    }catch(e2){
      if(_editBoard&&_editBoard.id===savingId)_boardsSetSaveStatus('Save failed');
      showToast('Could not save board: '+(e2.message||e2),true);
      return;
    }
  }
  // The new baseline is what WE hold, not the merged array: a card the
  // server has and we have never seen is not ours to reason about — the
  // transaction above preserves it either way, and the snapshot listener
  // brings it in properly when it is safe to rerender.
  const idx=moodBoards.findIndex(b=>b.id===savingId);
  if(idx>-1)moodBoards[idx]={...moodBoards[idx],title:head.title,cards:(wrote&&wrote.cards)||cur,connectors:(wrote&&wrote.connectors)||conns,updatedAt:Date.now()};
  if(!_editBoard||_editBoard.id!==savingId)return;   // we have moved on; leave the new board's state alone
  _boardsSetBase(cur);
  _boardsConnBase=JSON.stringify(conns);
  _boardsSetSaveStatus('Saved');
  }finally{
    // Always released, on every path — a leaked counter would suppress the
    // app's shared "Saving…" overlay for everything else, everywhere.
    if(typeof window._gvSilentSaveStop==='function')window._gvSilentSaveStop();
  }
}

/* ── Stage 5 — getting a board out of the app ───────────────────────────
   PNG and PDF export, and deep links to a single card.

   Both exports share ONE renderer (_boardsRenderExportCanvas): the PDF is
   the same picture placed on an A4 page by js/print-engine.js, plus a text
   index of the cards. Two separate renderers would drift apart the first
   time a card type changed.

   The board is drawn by hand onto a 2D canvas rather than by rasterising
   the live DOM — html2canvas and friends are a dependency, and this repo
   has a zero-new-deps policy that Mood Boards has followed since Stage 1.
   Drawing it by hand also means the export is not tied to the viewport:
   it always covers the whole board at a sane resolution, whatever the
   screen was showing.

   CORS, honestly: an <img> drawn onto a canvas TAINTS it unless the host
   allows cross-origin reads, and a tainted canvas refuses toBlob /
   toDataURL outright. Every image here is a Cloudinary delivery URL and
   is loaded with crossOrigin='anonymous', which is what makes the export
   legal — if a picture fails that load it is drawn as a labelled
   placeholder instead, so one un-CORS-able image degrades that one card
   rather than killing the whole export. The count of those is reported to
   the user. (Cloudinary's CORS headers could not be verified from the
   build sandbox — it cannot reach res.cloudinary.com at all.) */

const _BOARDS_EXPORT_MAX_PX=2600;   // longest edge of the exported bitmap
let _boardsPendingFocusCard=null;   // card to centre on once the canvas renders

function _boardsCssVar(name,fallback){
  try{
    const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v||fallback;
  }catch(e){return fallback;}
}
// Reads the real palette off the page so an export matches what the CSS
// says today, instead of a second copy of the colours drifting in here.
function _boardsExportPalette(){
  let family='system-ui,-apple-system,Segoe UI,sans-serif';
  try{family=getComputedStyle(document.body).fontFamily||family;}catch(e){}
  return{
    font:family,
    border:_boardsCssVar('--border','#e2e2e2'),
    muted:_boardsCssVar('--muted','#8a8a8a'),
    text:_boardsCssVar('--text','#111111'),
    soft:_boardsCssVar('--soft','#f5f5f5'),
    dark:_boardsCssVar('--dark','#111111'),
    tint:{
      red:_boardsCssVar('--accent-urgent','#c0392b'),
      amber:_boardsCssVar('--accent-warning','#c98a10'),
      green:_boardsCssVar('--accent-success','#2e8b57'),
      blue:_boardsCssVar('--cat-notes','#4a67c8'),
      purple:_boardsCssVar('--cat-boards','#8455c9')
    }
  };
}
function _boardsLoadImageEl(url){
  return new Promise(resolve=>{
    const im=new Image();
    im.crossOrigin='anonymous';   // without this the canvas is tainted and cannot be exported
    im.onload=()=>resolve(im);
    im.onerror=()=>resolve(null);
    im.src=url;
  });
}
async function _boardsPreloadImages(cards){
  const out={};
  await Promise.all(cards.filter(c=>c.type==='image'&&c.imageUrl)
    .map(c=>_boardsLoadImageEl(c.imageUrl).then(im=>{out[c.id]=im;})));
  return out;
}
function _boardsWrapLines(ctx,text,maxW,maxLines){
  const words=String(text==null?'':text).split(/\s+/).filter(Boolean);
  const lines=[];
  let cur='';
  words.forEach(w=>{
    const t=cur?cur+' '+w:w;
    if(ctx.measureText(t).width<=maxW){cur=t;return;}
    if(cur){lines.push(cur);cur='';}
    // A single word wider than the card (a long URL) has to be hard-broken.
    let rest=w;
    while(ctx.measureText(rest).width>maxW&&rest.length>1){
      let i=rest.length;
      while(i>1&&ctx.measureText(rest.slice(0,i)).width>maxW)i--;
      lines.push(rest.slice(0,i));
      rest=rest.slice(i);
    }
    cur=rest;
  });
  if(cur)lines.push(cur);
  if(maxLines&&lines.length>maxLines){
    const cut=lines.slice(0,maxLines);
    cut[maxLines-1]=cut[maxLines-1].replace(/\S{0,1}$/,'…');
    return cut;
  }
  return lines;
}
function _boardsRoundRect(ctx,x,y,w,h,r){
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.lineTo(x+w-rr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+rr);
  ctx.lineTo(x+w,y+h-rr);ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
  ctx.lineTo(x+rr,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-rr);
  ctx.lineTo(x,y+rr);ctx.quadraticCurveTo(x,y,x+rr,y);
  ctx.closePath();
}
function _boardsExportKind(c){
  return c.type==='image'?'Image':c.type==='link'?'Link':c.type==='file'?'File'
    :c.type==='board'?'Sub-board':c.type==='todo'?'To-do':c.type==='frame'?'Section':'Note';
}
function _boardsDrawCard(ctx,c,img,P){
  const stroke=c.color&&P.tint[c.color]?P.tint[c.color]:P.border;
  if(c.type==='frame'){
    ctx.strokeStyle=stroke;ctx.lineWidth=1.5;
    _boardsRoundRect(ctx,c.x,c.y,c.w,c.h,12);ctx.stroke();
    ctx.fillStyle=P.soft;
    ctx.fillRect(c.x,c.y,c.w,26);
    ctx.strokeStyle=stroke;ctx.lineWidth=1;
    ctx.strokeRect(c.x+0.5,c.y+0.5,c.w-1,26);
    ctx.fillStyle=P.muted;
    ctx.font='700 11px '+P.font;
    ctx.fillText(String(c.title||'').toUpperCase()||'SECTION',c.x+10,c.y+18);
    return;
  }
  const headH=20,bx=c.x,by=c.y+headH,bw=c.w,bh=Math.max(0,c.h-headH);
  ctx.save();
  _boardsRoundRect(ctx,c.x,c.y,c.w,c.h,10);
  ctx.clip();
  ctx.fillStyle='#ffffff';ctx.fillRect(c.x,c.y,c.w,c.h);
  ctx.fillStyle=P.soft;ctx.fillRect(c.x,c.y,c.w,headH);
  ctx.fillStyle=P.muted;ctx.font='700 8.5px '+P.font;
  ctx.fillText(_boardsExportKind(c).toUpperCase()+(c.locked?' · LOCKED':''),c.x+8,c.y+13.5);

  if(c.type==='image'){
    if(img){
      // cover-fit, same as the on-screen object-fit:cover
      const ar=img.width/img.height,br=bw/(bh||1);
      let sw,sh,sx,sy;
      if(ar>br){sh=img.height;sw=sh*br;sx=(img.width-sw)/2;sy=0;}
      else{sw=img.width;sh=sw/br;sx=0;sy=(img.height-sh)/2;}
      try{ctx.drawImage(img,sx,sy,sw,sh,bx,by,bw,bh);}catch(e){/* drawn as empty */}
    }else{
      ctx.fillStyle=P.soft;ctx.fillRect(bx,by,bw,bh);
      ctx.fillStyle=P.muted;ctx.font='10px '+P.font;
      ctx.fillText('image unavailable',bx+8,by+bh/2);
    }
  }else if(c.type==='todo'){
    ctx.font='11px '+P.font;
    let y=by+14;
    (c.items||[]).forEach(it=>{
      if(y>by+bh-4)return;
      ctx.strokeStyle=P.muted;ctx.lineWidth=1;
      ctx.strokeRect(bx+8.5,y-8.5,9,9);
      if(it.done){
        ctx.beginPath();ctx.moveTo(bx+10,y-4);ctx.lineTo(bx+12.5,y-1.5);ctx.lineTo(bx+16.5,y-7);
        ctx.strokeStyle=P.text;ctx.lineWidth=1.4;ctx.stroke();
      }
      ctx.fillStyle=it.done?P.muted:P.text;
      const line=_boardsWrapLines(ctx,it.text||'',bw-30,1)[0]||'';
      ctx.fillText(line,bx+24,y);
      if(it.done&&line){
        const w=ctx.measureText(line).width;
        ctx.strokeStyle=P.muted;ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(bx+24,y-3.5);ctx.lineTo(bx+24+w,y-3.5);ctx.stroke();
      }
      y+=16;
    });
  }else if(c.type==='link'){
    ctx.fillStyle=P.text;ctx.font='700 12px '+P.font;
    ctx.fillText((_boardsWrapLines(ctx,c.linkTitle||'Untitled link',bw-18,1)[0])||'',bx+9,by+18);
    ctx.fillStyle=P.muted;ctx.font='10px '+P.font;
    _boardsWrapLines(ctx,c.linkDesc||'',bw-18,2).forEach((l,i)=>ctx.fillText(l,bx+9,by+34+i*13));
    ctx.fillStyle=P.tint.blue;
    ctx.fillText((_boardsWrapLines(ctx,c.linkUrl||'',bw-18,1)[0])||'',bx+9,by+bh-8);
  }else if(c.type==='file'){
    ctx.fillStyle=P.dark;
    _boardsRoundRect(ctx,bx+9,by+10,30,13,3);ctx.fill();
    ctx.fillStyle='#ffffff';ctx.font='700 8px '+P.font;
    ctx.fillText(_boardsFileExt(c.fileName),bx+13,by+19.5);
    ctx.fillStyle=P.text;ctx.font='700 11px '+P.font;
    _boardsWrapLines(ctx,c.fileName||'File',bw-18,2).forEach((l,i)=>ctx.fillText(l,bx+9,by+38+i*14));
    ctx.fillStyle=P.muted;ctx.font='10px '+P.font;
    ctx.fillText(_boardsFormatBytes(c.fileSize),bx+9,by+bh-8);
  }else if(c.type==='board'){
    const child=_boardsLiveById()[c.boardId];
    ctx.fillStyle=P.tint.purple;ctx.fillRect(bx,by,3,bh);
    ctx.fillStyle=P.text;ctx.font='700 12px '+P.font;
    ctx.fillText((_boardsWrapLines(ctx,(child&&child.title)||c.boardTitle||'Untitled board',bw-20,1)[0])||'',bx+11,by+20);
    ctx.fillStyle=P.muted;ctx.font='10px '+P.font;
    ctx.fillText(child?((child.cards||[]).length+' cards'):'Board',bx+11,by+36);
  }else{
    ctx.fillStyle=P.text;ctx.font='12px '+P.font;
    const maxLines=Math.max(1,Math.floor((bh-10)/16));
    _boardsWrapLines(ctx,c.text||'',bw-18,maxLines).forEach((l,i)=>ctx.fillText(l,bx+9,by+16+i*16));
  }
  ctx.restore();
  ctx.strokeStyle=stroke;ctx.lineWidth=1;
  _boardsRoundRect(ctx,c.x+0.5,c.y+0.5,c.w-1,c.h-1,10);
  ctx.stroke();
}
function _boardsDrawConnector(ctx,cn,P){
  let x1,y1,x2,y2;
  if(cn.free){x1=cn.x1;y1=cn.y1;x2=cn.x2;y2=cn.y2;}
  else{
    const a=_editCards.find(c=>c.id===cn.from),b=_editCards.find(c=>c.id===cn.to);
    if(!a||!b)return;
    x1=a.x+a.w/2;y1=a.y+a.h/2;x2=b.x+b.w/2;y2=b.y+b.h/2;
  }
  ctx.strokeStyle=cn.free?P.text:P.muted;
  ctx.lineWidth=1.6;
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  if(cn.arrow){
    const ang=Math.atan2(y2-y1,x2-x1),len=9;
    ctx.beginPath();
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2-len*Math.cos(ang-0.4),y2-len*Math.sin(ang-0.4));
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2-len*Math.cos(ang+0.4),y2-len*Math.sin(ang+0.4));
    ctx.stroke();
  }
}
// Draws the WHOLE board (not the viewport) at a capped resolution.
// Returns null — after a toast — when there is nothing to export.
async function _boardsRenderExportCanvas(){
  const bounds=_boardsContentBounds();
  if(!bounds){showToast('Nothing to export yet — this board is empty');return null;}
  const pad=48;
  const W=(bounds.maxX-bounds.minX)+pad*2,H=(bounds.maxY-bounds.minY)+pad*2;
  const scale=Math.min(2,_BOARDS_EXPORT_MAX_PX/Math.max(W,H));
  const cv=document.createElement('canvas');
  cv.width=Math.max(1,Math.round(W*scale));
  cv.height=Math.max(1,Math.round(H*scale));
  const ctx=cv.getContext('2d');
  if(!ctx){showToast('This browser could not create the export canvas',true);return null;}
  ctx.scale(scale,scale);
  ctx.translate(-(bounds.minX-pad),-(bounds.minY-pad));
  ctx.textBaseline='alphabetic';
  ctx.fillStyle='#ffffff';
  ctx.fillRect(bounds.minX-pad,bounds.minY-pad,W,H);
  const P=_boardsExportPalette();
  const imgs=await _boardsPreloadImages(_editCards);
  // Connectors paint under the cards, exactly as on screen (the SVG layer
  // is the first child of .board-world).
  _editConnectors.forEach(cn=>_boardsDrawConnector(ctx,cn,P));
  _boardsRenderOrder().forEach(c=>_boardsDrawCard(ctx,c,imgs[c.id],P));
  const missing=Object.keys(imgs).filter(k=>!imgs[k]).length;
  return{canvas:cv,missing};
}
function _boardsExportName(ext){
  const t=String((_editBoard&&_editBoard.title)||'board').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'board';
  return t+'-'+new Date().toISOString().slice(0,10)+'.'+ext;
}
function _boardsDownloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
window.boardsExportPNG=async function(){
  _boardsMenuOpen=false;_boardsSyncMenu();
  showToast('Building image…');
  const out=await _boardsRenderExportCanvas();
  if(!out)return;
  try{
    out.canvas.toBlob(blob=>{
      if(!blob){showToast('Could not build the image',true);return;}
      _boardsDownloadBlob(blob,_boardsExportName('png'));
      showToast(out.missing?('Image saved — '+out.missing+' picture'+(out.missing===1?'':'s')+' could not be included'):'Image saved ✓');
    },'image/png');
  }catch(e){
    // SecurityError here means a cross-origin image tainted the canvas.
    showToast('Could not save the image: '+(e.message||e),true);
  }
};
// PDF goes through js/print-engine.js like every other print output in
// this app — see CLAUDE.md: no new feature calls jsPDF directly.
window.boardsExportPDF=async function(){
  _boardsMenuOpen=false;_boardsSyncMenu();
  if(typeof window.printDocument!=='function'){showToast('Print engine not loaded yet, retry in a moment.',true);return;}
  const out=await _boardsRenderExportCanvas();
  if(!out)return;
  let dataUrl=null;
  try{
    // JPEG, not PNG: a photo-heavy board is far smaller this way and the
    // background is already painted white, so there is no transparency to lose.
    dataUrl=out.canvas.toDataURL('image/jpeg',0.92);
  }catch(e){
    showToast('Could not render the board image: '+(e.message||e),true);
    return;
  }
  const index=_editCards.filter(c=>c.type!=='image').map(c=>({
    kind:_boardsExportKind(c),
    text:(c.type==='todo'?(c.items||[]).map(i=>(i.done?'[x] ':'[ ] ')+(i.text||'')).join('  ·  ')
      :c.type==='link'?((c.linkTitle||'')+(c.linkUrl?'  —  '+c.linkUrl:''))
      :c.type==='file'?(c.fileName||'')
      :c.type==='board'?(c.boardTitle||'')
      :c.type==='frame'?(c.title||'')
      :(c.text||'')).replace(/\s+/g,' ').trim()
  })).filter(r=>r.text);
  await window.printDocument({
    type:'mood-board',
    filename:_boardsExportName('pdf'),
    data:{
      documentNumber:_editBoard.title||'Untitled board',
      boardTitle:_editBoard.title||'Untitled board',
      visibility:_editBoard.visibility==='shared'?'TEAM':'PRIVATE',
      ownerName:_editBoard.ownerName||'',
      cardCount:_editCards.length,
      imageDataUrl:dataUrl,
      imageW:out.canvas.width,
      imageH:out.canvas.height,
      index:index.slice(0,200),
      indexTruncated:index.length>200
    }
  });
  if(out.missing)showToast(out.missing+' picture'+(out.missing===1?'':'s')+' could not be included');
};

/* ── Deep links (Stage 5) ───────────────────────────────────────────────
   #board=<boardId>[&card=<cardId>] on the app URL. The hash is the only
   routing this SPA has ever used, and it stays entirely inside boards.js:
   the app's own navigation (buildNav/showPage in js/shared.js) is
   untouched, so nothing else has to learn about URLs.

   Consumed in two places — after startApp (a link opened cold, once auth
   has resolved and session exists) and on hashchange (a link pasted while
   the app is already open). */
function _boardsLinkFor(boardId,cardId){
  const base=location.origin+location.pathname;
  return base+'#board='+encodeURIComponent(boardId)+(cardId?'&card='+encodeURIComponent(cardId):'');
}
async function _boardsCopyText(text){
  try{await navigator.clipboard.writeText(text);return true;}
  catch(e){
    // clipboard API needs a secure context and a user gesture; the old
    // execCommand path still works where it doesn't.
    try{
      const ta=document.createElement('textarea');
      ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
      document.body.appendChild(ta);ta.select();
      const ok=document.execCommand('copy');
      ta.remove();
      return ok;
    }catch(e2){return false;}
  }
}
window.boardsCopyBoardLink=async function(){
  if(!_editBoard)return;
  _boardsMenuOpen=false;_boardsSyncMenu();
  const link=_boardsLinkFor(_editBoard.id,null);
  const ok=await _boardsCopyText(link);
  showToast(ok?'Board link copied':'Could not copy — the link is '+link,!ok);
};
window.boardsCopyCardLink=async function(){
  const sel=_boardsSelectedCards();
  if(!_editBoard||sel.length!==1){showToast('Select exactly one card to link to');return;}
  const link=_boardsLinkFor(_editBoard.id,sel[0].id);
  const ok=await _boardsCopyText(link);
  showToast(ok?'Card link copied — it opens this board on that card':'Could not copy — the link is '+link,!ok);
};
function _boardsParseHash(){
  const raw=String(location.hash||'').replace(/^#/,'');
  if(!raw)return null;
  const p={};
  raw.split('&').forEach(kv=>{
    const i=kv.indexOf('=');
    if(i>0){try{p[decodeURIComponent(kv.slice(0,i))]=decodeURIComponent(kv.slice(i+1));}catch(e){}}
  });
  return p.board?{board:p.board,card:p.card||null}:null;
}
function _boardsConsumeDeepLink(){
  const link=_boardsParseHash();
  if(!link||!session)return false;
  // staged rollout: Creative Hub is still Afnan-only, and a deep link is
  // navigation — it must not be a side door into the module. Remove this
  // with the other session.u==='afnan' checks at rollout (see CLAUDE.md).
  if(session.u!=='afnan')return false;
  if(currentPage==='board-canvas'&&_boardsViewingId===link.board&&!link.card)return false;
  _boardsPendingFocusCard=link.card||null;
  window.boardsOpen(link.board);
  return true;
}
window.addEventListener('hashchange',()=>{_boardsConsumeDeepLink();});
// Wrap startApp rather than editing js/auth.js or js/shared.js — both are
// cross-track files, and this is the same wrap-the-global pattern
// __bootApp already uses for showPage.
const _boardsOrigStartApp=window.startApp;
if(typeof _boardsOrigStartApp==='function'){
  window.startApp=async function(){
    const out=await _boardsOrigStartApp.apply(this,arguments);
    try{_boardsConsumeDeepLink();}catch(e){console.warn('[boards] deep link failed:',e);}
    return out;
  };
}
// Centres the viewport on one card and flags it briefly. Zoomed further
// out than 50% we zoom IN first — a link to a single card that lands at
// 19% shows a speck.
function _boardsFocusCard(id){
  const c=_editCards.find(x=>x.id===id);
  if(!c){showToast('That card is no longer on this board');return;}
  const b=_editBoard,stage=document.getElementById('board-stage');
  if(!b||!stage)return;
  const r=stage.getBoundingClientRect();
  if(b.zoom<0.5)b.zoom=0.8;
  b.panX=r.width/2-(c.x+c.w/2)*b.zoom;
  b.panY=r.height/2-(c.y+c.h/2)*b.zoom;
  _boardsApplyTransform();
  _boardsSetSelection([id]);
  const el=document.getElementById('board-card-'+id);
  if(el){
    el.classList.add('linked');
    setTimeout(()=>{try{el.classList.remove('linked');}catch(e){}},2600);
  }
  _boardsSaveDebounced();
}

/* ── Stage 6 — collaboration ────────────────────────────────────────────
   Live sync, presence, comments, per-board sharing and a per-board
   activity feed. This is the stage the roadmap flagged as an architecture
   change, so the shape of it matters more than the feature list.

   WHAT CHANGED, and what deliberately did not:

   The board document keeps its plain `cards` array (no per-card
   subcollection). That call was made in Phase 2 and still holds at this
   app's scale — moving to a subcollection now would mean rewriting load,
   save, undo, export and the gallery previews, plus a migration, for a
   problem two people editing one board do not actually have.

   What it does need is a save that cannot silently eat someone else's
   work. `_boardsSaveNow` now writes inside a runTransaction that reads
   the server's card array and merges ONLY the cards this session actually
   changed; every card we did not touch keeps whatever the server has, so
   a colleague's move survives our save even if we never received their
   update. Which cards we changed is DERIVED, not tracked at each mutation
   site: `_boardsBase` holds a JSON snapshot of the cards as the server
   last had them, and `_boardsLocalChanges()` diffs against it. That means
   no mutation anywhere in this file has to remember to mark itself dirty
   — the one thing that would certainly rot.

   Transactions need connectivity. Offline (this is an installed PWA, and
   people use it on phones) the transaction is skipped and the old
   queued updateDoc is used instead — last-writer-wins, which is exactly
   what it was before Stage 6, rather than refusing to save at all.

   Incoming changes arrive on an onSnapshot listener and are merged the
   same way (ours wins for cards we have unsaved edits on, theirs for
   everything else). A merge NEVER lands while a drag/resize is in flight
   or while focus is inside a card — it is parked and applied the moment
   that stops, otherwise a remote update would yank the card out from
   under the pointer or reset the caret mid-word. Pan and zoom are never
   taken from a remote update at all: they live on the document so a board
   opens where it was left, but applying someone else's pan to your open
   canvas is motion sickness, not collaboration. */

let _boardsUnsub=null,_boardsPresenceUnsub=null,_boardsCommentsUnsub=null,_boardsActivityUnsub=null;
let _boardsPresenceTimer=null,_boardsFlushTimer=null;
let _boardsBase={};             // cardId → JSON as the server last had it
let _boardsConnBase='[]';       // same, for the connectors array
let _boardsGestureActive=false; // a drag/resize is in flight — hold merges
let _boardsPendingRemote=null;  // remote data waiting for a safe moment
let _boardsPeers=[];            // other people on this board right now
let _boardsComments=[];
let _boardsBoardActivity=[];
let _boardsDrawerOpen=false,_boardsDrawerTab='comments',_boardsDrawerCard=null;
const _BOARDS_PRESENCE_BEAT=25000;   // heartbeat
const _BOARDS_PRESENCE_STALE=70000;  // ~3 missed beats → treat as gone

function _boardsLive(){return typeof onSnapshot==='function';}
function _boardsMyEmail(){
  try{if(typeof auth!=='undefined'&&auth&&auth.currentUser&&auth.currentUser.email)return String(auth.currentUser.email).toLowerCase();}catch(e){}
  return session&&session.email?String(session.email).toLowerCase():'';
}

// ── Local-change detection ──
function _boardsCardsById(list){
  const m={};
  (list||[]).forEach(c=>{m[c.id]=c;});
  return m;
}
function _boardsLocalChanges(){
  const cur=_boardsCardsForSave();
  const changed=new Set();
  const seen={};
  cur.forEach(c=>{
    const j=JSON.stringify(c);
    seen[c.id]=j;
    if(_boardsBase[c.id]!==j)changed.add(c.id);
  });
  Object.keys(_boardsBase).forEach(id=>{if(!seen[id])changed.add(id);});   // deleted locally
  return{cur,changed};
}
function _boardsSetBase(cards){
  _boardsBase={};
  (cards||[]).forEach(c=>{_boardsBase[c.id]=JSON.stringify(c);});
}
function _boardsConnDirty(){return JSON.stringify(_editConnectors)!==_boardsConnBase;}

// ── Merging a remote update into the open canvas ──
function _boardsApplyRemote(data){
  if(!data||!_editBoard)return;
  const{changed}=_boardsLocalChanges();
  const remoteCards=(data.cards||[]);
  const remoteById=_boardsCardsById(remoteCards);
  const localById=_boardsCardsById(_editCards);
  const out=[];
  // Server order is the base order (z-order is array order, so respecting
  // it is what keeps everyone's stacking the same).
  remoteCards.forEach(rc=>{
    if(changed.has(rc.id)){
      const lc=localById[rc.id];
      if(lc)out.push(lc);            // we have unsaved edits on this one — ours stands
      // no local copy: we deleted it, so it stays deleted
    }else{
      out.push(rc);
      _boardsBase[rc.id]=JSON.stringify(rc);
    }
  });
  // Cards we created that the server hasn't seen yet.
  _editCards.forEach(lc=>{if(!remoteById[lc.id]&&changed.has(lc.id))out.push(lc);});
  // Drop base entries for cards the server no longer has and we didn't touch.
  Object.keys(_boardsBase).forEach(id=>{if(!remoteById[id]&&!changed.has(id))delete _boardsBase[id];});
  _editCards=out;
  if(!_boardsConnDirty()){
    _editConnectors=(data.connectors||[]).map(c=>({...c}));
    _boardsConnBase=JSON.stringify(_editConnectors);
  }
  // Title: leave it alone while it is being typed into.
  const titleEl=document.getElementById('board-title-input');
  if(data.title!=null&&document.activeElement!==titleEl)_editBoard.title=data.title;
  if(data.visibility)_editBoard.visibility=data.visibility;
  _editBoard.sharedWith=Array.isArray(data.sharedWith)?data.sharedWith.slice():[];
  _editBoard.isTemplate=!!data.isTemplate;
  // pan/zoom deliberately NOT taken from the remote document.
  _boardsSelection=new Set(Array.from(_boardsSelection).filter(id=>_editCards.some(c=>c.id===id)));
  _boardsRenderCanvasAndWire();
}
function _boardsRemoteSafeNow(){
  return!_boardsGestureActive&&!_boardsIsEditableFocus();
}
function _boardsFlushRemote(){
  if(!_boardsPendingRemote||!_boardsRemoteSafeNow())return;
  const data=_boardsPendingRemote;
  _boardsPendingRemote=null;
  _boardsApplyRemote(data);
}

// ── Listeners ──
function _boardsSubscribe(boardId){
  if(!_boardsLive())return;
  try{
    _boardsUnsub=onSnapshot(doc(db,'mood_boards',boardId),snap=>{
      if(!snap.exists())return;
      // Our own write echoing back — merging it would be a no-op at best
      // and a rerender mid-gesture at worst.
      if(snap.metadata&&snap.metadata.hasPendingWrites)return;
      const data=snap.data();
      if(!_editBoard||_editBoard.id!==boardId)return;
      if(!_boardsRemoteSafeNow()){_boardsPendingRemote=data;return;}
      _boardsApplyRemote(data);
    },err=>{console.warn('[boards] live sync unavailable:',err&&err.message||err);});
  }catch(e){console.warn('[boards] live sync could not start:',e);}
  // Safety net for a parked update whose gesture ended without another
  // event to wake us (pointer released outside the window, say).
  clearInterval(_boardsFlushTimer);
  _boardsFlushTimer=setInterval(_boardsFlushRemote,2000);
}
function _boardsPresenceStart(boardId){
  if(!_boardsLive()||!session||!session.uid)return;
  const ref=doc(db,'mood_boards',boardId,'presence',session.uid);
  const beat=()=>{setDoc(ref,{name:session.name||'',u:session.u||'',ts:Date.now()}).catch(()=>{});};
  beat();
  clearInterval(_boardsPresenceTimer);
  _boardsPresenceTimer=setInterval(beat,_BOARDS_PRESENCE_BEAT);
  try{
    _boardsPresenceUnsub=onSnapshot(collection(db,'mood_boards',boardId,'presence'),snap=>{
      const now=Date.now();
      const peers=[];
      snap.forEach(d=>{
        const v=d.data()||{};
        // A crashed tab never deletes its row, so staleness is what
        // actually decides presence — not the row existing.
        if(d.id!==session.uid&&(now-(v.ts||0))<_BOARDS_PRESENCE_STALE)peers.push({uid:d.id,name:v.name||'Someone'});
      });
      _boardsPeers=peers;
      _boardsRenderPresence();
    },()=>{});
  }catch(e){/* presence is a nicety; never block the board on it */}
}
function _boardsCommentsStart(boardId){
  if(!_boardsLive())return;
  try{
    _boardsCommentsUnsub=onSnapshot(query(collection(db,'mood_boards',boardId,'comments'),orderBy('ts','asc')),snap=>{
      _boardsComments=[];
      snap.forEach(d=>_boardsComments.push({id:d.id,...d.data()}));
      _boardsPaintCommentBadges();
      _boardsRenderDrawer();
    },()=>{});
  }catch(e){/* noop */}
}
function _boardsActivityStart(boardId){
  if(!_boardsLive())return;
  try{
    _boardsActivityUnsub=onSnapshot(query(collection(db,'mood_boards',boardId,'activity'),orderBy('ts','desc'),limit(50)),snap=>{
      _boardsBoardActivity=[];
      snap.forEach(d=>_boardsBoardActivity.push({id:d.id,...d.data()}));
      if(_boardsDrawerOpen&&_boardsDrawerTab==='activity')_boardsRenderDrawer();
    },()=>{});
  }catch(e){/* noop */}
}
function _boardsTeardown(){
  if(_editBoard)_boardsSaveNow();
  [_boardsUnsub,_boardsPresenceUnsub,_boardsCommentsUnsub,_boardsActivityUnsub].forEach(f=>{try{if(typeof f==='function')f();}catch(e){}});
  _boardsUnsub=_boardsPresenceUnsub=_boardsCommentsUnsub=_boardsActivityUnsub=null;
  clearInterval(_boardsPresenceTimer);_boardsPresenceTimer=null;
  clearInterval(_boardsFlushTimer);_boardsFlushTimer=null;
  _boardsPendingRemote=null;
  _boardsPeers=[];_boardsComments=[];_boardsBoardActivity=[];
  _boardsDrawerOpen=false;_boardsDrawerCard=null;
  // The board we were ON — not _boardsViewingId, which has already been
  // moved on by boardsOpen when you step into a sub-board.
  const id=_editBoard&&_editBoard.id;
  if(id&&session&&session.uid){
    try{deleteDoc(doc(db,'mood_boards',id,'presence',session.uid)).catch(()=>{});}catch(e){}
  }
}
// Leaving the canvas by ANY route (sidebar, back button, a deep link to
// another page) has to tear the listeners down, and only showPage knows
// about all of them. Same wrap-the-global pattern as the startApp hook
// above — js/shared.js stays untouched.
const _boardsOrigShowPage=window.showPage;
if(typeof _boardsOrigShowPage==='function'){
  window.showPage=async function(id){
    if(currentPage==='board-canvas'&&id!=='board-canvas'){try{_boardsTeardown();}catch(e){console.warn('[boards] teardown failed:',e);}}
    return _boardsOrigShowPage.apply(this,arguments);
  };
}
window.addEventListener('pagehide',()=>{if(currentPage==='board-canvas'){try{_boardsTeardown();}catch(e){}}});

// A pointer gesture anywhere on the stage holds remote merges off. Doing
// this once at the document level beats setting a flag inside each of the
// six drag/resize/pan/marquee/line/minimap handlers — one of them would
// eventually be added without it.
document.addEventListener('pointerdown',e=>{
  if(currentPage!=='board-canvas')return;
  if(e.target&&e.target.closest&&e.target.closest('.board-stage'))_boardsGestureActive=true;
});
document.addEventListener('pointerup',()=>{
  if(!_boardsGestureActive)return;
  _boardsGestureActive=false;
  setTimeout(_boardsFlushRemote,0);
});
document.addEventListener('pointercancel',()=>{_boardsGestureActive=false;});

// ── Presence strip ──
function _boardsInitials(name){
  const p=String(name||'').trim().split(/\s+/);
  return((p[0]||'?')[0]+(p.length>1?p[p.length-1][0]:'')).toUpperCase();
}
function _boardsRenderPresence(){
  const host=document.getElementById('board-peers');
  if(!host)return;
  if(!_boardsPeers.length){host.innerHTML='';host.style.display='none';return;}
  host.style.display='flex';
  host.innerHTML=_boardsPeers.slice(0,5).map(p=>`<span class="board-peer" title="${_boardsEsc(p.name)} is on this board">${_boardsEsc(_boardsInitials(p.name))}</span>`).join('')
    +(_boardsPeers.length>5?`<span class="board-peer more">+${_boardsPeers.length-5}</span>`:'');
}

// ── Per-board activity feed ──
function _boardsLogBoardActivity(action){
  if(!_editBoard||!session)return;
  try{
    addDoc(collection(db,'mood_boards',_editBoard.id,'activity'),{
      ts:Date.now(),byName:session.name||'',byUid:session.uid||'',action:String(action).slice(0,200)
    }).catch(()=>{});
  }catch(e){/* the feed is a record, never a blocker */}
}

// ── Comments ──
function _boardsCardComments(cardId){
  return _boardsComments.filter(c=>(c.cardId||null)===(cardId||null));
}
function _boardsPaintCommentBadges(){
  const counts={};
  _boardsComments.forEach(c=>{if(c.cardId&&!c.resolved)counts[c.cardId]=(counts[c.cardId]||0)+1;});
  _editCards.forEach(c=>{
    const el=document.getElementById('board-cmt-'+c.id);
    if(!el)return;
    const n=counts[c.id]||0;
    el.textContent=n?String(n):'';
    el.style.display=n?'inline-flex':'none';
  });
  const btn=document.getElementById('board-cmt-btn');
  if(btn){
    const open=_boardsComments.filter(c=>!c.resolved).length;
    btn.textContent=open?('Comments '+open):'Comments';
  }
}
window.boardsOpenComments=function(cardId){
  _boardsDrawerCard=cardId||null;
  _boardsDrawerTab='comments';
  _boardsDrawerOpen=true;
  _boardsRenderDrawer();
  const i=document.getElementById('board-cmt-input');
  if(i)i.focus();
};
window.boardsToggleDrawer=function(){
  _boardsDrawerOpen=!_boardsDrawerOpen;
  if(!_boardsDrawerOpen)_boardsDrawerCard=null;
  _boardsMenuOpen=false;_boardsSyncMenu();
  _boardsRenderDrawer();
};
window.boardsDrawerTab=function(tab){_boardsDrawerTab=tab;_boardsRenderDrawer();};
window.boardsDrawerAll=function(){_boardsDrawerCard=null;_boardsRenderDrawer();};
function _boardsRenderDrawer(){
  const host=document.getElementById('board-drawer');
  if(!host)return;
  host.style.display=_boardsDrawerOpen?'flex':'none';
  if(!_boardsDrawerOpen)return;
  const scoped=_boardsDrawerCard?_boardsCardComments(_boardsDrawerCard):_boardsComments;
  const rows=_boardsDrawerTab==='comments'?scoped:[];
  const canEdit=_boardsCanEdit(_editBoard);
  const scopeLabel=_boardsDrawerCard?'On one card':'Whole board';
  host.innerHTML=`
    <div class="board-drawer-head">
      <div class="board-drawer-tabs">
        <button class="${_boardsDrawerTab==='comments'?'on':''}" onclick="window.boardsDrawerTab('comments')">Comments</button>
        <button class="${_boardsDrawerTab==='activity'?'on':''}" onclick="window.boardsDrawerTab('activity')">Activity</button>
      </div>
      <button class="tool-btn" onclick="window.boardsToggleDrawer()" title="Close">✕</button>
    </div>
    ${_boardsDrawerTab==='comments'?`
      <div class="board-drawer-scope">
        <span>${scopeLabel}</span>
        ${_boardsDrawerCard?'<button class="tool-btn" onclick="window.boardsDrawerAll()">Show all</button>':''}
      </div>
      <div class="board-drawer-list" id="board-drawer-list">
        ${rows.length?rows.map(c=>`
          <div class="board-cmt${c.resolved?' resolved':''}">
            <div class="board-cmt-meta">
              <strong>${_boardsEsc(c.byName||'Someone')}</strong>
              <span>${_boardsRelTime(c.ts)}</span>
              ${c.cardId&&!_boardsDrawerCard?`<button class="board-cmt-jump" onclick="window.boardsCommentJump('${c.cardId}')">on a card →</button>`:''}
            </div>
            <div class="board-cmt-text" id="board-cmt-text-${c.id}"></div>
            <div class="board-cmt-actions">
              <button onclick="window.boardsResolveComment('${c.id}',${c.resolved?'false':'true'})">${c.resolved?'Reopen':'Resolve'}</button>
              ${(session&&(c.byUid===session.uid||session.role==='owner'))?`<button onclick="window.boardsDeleteComment('${c.id}')">Delete</button>`:''}
            </div>
          </div>`).join(''):'<div class="empty">No comments yet.</div>'}
      </div>
      ${canEdit?`<div class="board-drawer-compose">
        <textarea id="board-cmt-input" placeholder="${_boardsDrawerCard?'Comment on this card…':'Comment on this board…'}" onkeydown="window.boardsCommentKey(event)"></textarea>
        <button class="btn-sm" onclick="window.boardsAddComment()">Post</button>
      </div>`:''}
    `:`
      <div class="board-drawer-list">
        ${_boardsBoardActivity.length?_boardsBoardActivity.map(a=>`
          <div class="board-act-row">
            <div class="board-act-line"><strong>${_boardsEsc(a.byName||'Someone')}</strong> ${_boardsEsc(a.action||'')}</div>
            <div class="board-act-time">${_boardsRelTime(a.ts)}</div>
          </div>`).join(''):'<div class="empty">Nothing recorded on this board yet.</div>'}
      </div>`}`;
  // Comment bodies are other people's text — written in with textContent
  // after the structure exists, never interpolated into the HTML string.
  // Same stored-XSS boundary as text cards and Notes' blocks.
  if(_boardsDrawerTab==='comments'){
    rows.forEach(c=>{
      const el=document.getElementById('board-cmt-text-'+c.id);
      if(el)el.textContent=c.text||'';
    });
  }
}
window.boardsCommentJump=function(cardId){
  _boardsDrawerCard=cardId;
  _boardsRenderDrawer();
  _boardsFocusCard(cardId);
};
window.boardsCommentKey=function(ev){
  if(ev.key==='Enter'&&(ev.ctrlKey||ev.metaKey)){ev.preventDefault();window.boardsAddComment();}
};
window.boardsAddComment=async function(){
  const input=document.getElementById('board-cmt-input');
  const text=String((input&&input.value)||'').trim();
  if(!text||!_editBoard||!session)return;
  try{
    await addDoc(collection(db,'mood_boards',_editBoard.id,'comments'),{
      cardId:_boardsDrawerCard||null,
      text:text.slice(0,2000),
      byUid:session.uid,byName:session.name||'',
      ts:Date.now(),resolved:false
    });
    if(input)input.value='';
    _boardsLogBoardActivity(_boardsDrawerCard?'commented on a card':'commented on the board');
  }catch(e){showToast('Could not post comment: '+(e.message||e),true);}
};
window.boardsResolveComment=async function(id,resolved){
  if(!_editBoard)return;
  try{await updateDoc(doc(db,'mood_boards',_editBoard.id,'comments',id),{resolved:!!resolved});}
  catch(e){showToast('Could not update comment: '+(e.message||e),true);}
};
window.boardsDeleteComment=async function(id){
  if(!_editBoard)return;
  if(!confirm('Delete this comment?'))return;
  try{await deleteDoc(doc(db,'mood_boards',_editBoard.id,'comments',id));}
  catch(e){showToast('Could not delete comment: '+(e.message||e),true);}
};

// ── Per-board sharing (t32) ────────────────────────────────────────────
// Shared BY EMAIL, not uid: firestore.rules can check
// request.auth.token.email directly, and nothing in this app maps a
// username to a Firebase uid without a directory it does not have. The
// client query is where('sharedWith','array-contains',myEmail) — one more
// single-field query mapping exactly onto one clause of the read rule,
// the same discipline loadNotesData/loadBoardsData already follow.
window.boardsOpenShare=function(){
  if(!_editBoard||!_boardsCanEdit(_editBoard))return;
  _boardsMenuOpen=false;_boardsSyncMenu();
  const host=document.getElementById('board-share-modal');
  if(!host)return;
  const mine=_boardsMyEmail();
  const list=(typeof USER_DEFS!=='undefined'?USER_DEFS:[]).filter(u=>String(u.email||'').toLowerCase()!==mine);
  const current=(_editBoard.sharedWith||[]).map(e=>String(e).toLowerCase());
  host.style.display='flex';
  host.innerHTML=`<div class="board-share-box">
    <div class="board-share-head">
      <div><div style="font-weight:700;font-size:14px">Share this board</div>
      <div style="font-size:11.5px;color:var(--muted);margin-top:2px">People you pick can open and edit it, even while it stays PRIVATE.</div></div>
      <button class="tool-btn" onclick="window.boardsCloseShare()">✕</button>
    </div>
    <div class="board-share-list">
      ${list.map(u=>`<label class="board-share-row">
        <input type="checkbox" value="${_boardsEsc(String(u.email||'').toLowerCase())}" ${current.indexOf(String(u.email||'').toLowerCase())>-1?'checked':''}>
        <span><strong>${_boardsEsc(u.name||u.u)}</strong> <span style="color:var(--muted)">@${_boardsEsc(u.u)}</span></span>
      </label>`).join('')}
    </div>
    <div class="board-share-foot">
      <button class="btn-sm outline" onclick="window.boardsCloseShare()">Cancel</button>
      <button class="btn-sm" onclick="window.boardsSaveShare()">Save</button>
    </div>
  </div>`;
};
window.boardsCloseShare=function(){
  const host=document.getElementById('board-share-modal');
  if(host){host.style.display='none';host.innerHTML='';}
};
window.boardsSaveShare=async function(){
  const host=document.getElementById('board-share-modal');
  if(!host||!_editBoard)return;
  const picked=Array.from(host.querySelectorAll('input[type=checkbox]')).filter(i=>i.checked).map(i=>i.value);
  try{
    await updateDoc(doc(db,'mood_boards',_editBoard.id),{sharedWith:picked,updatedAt:Date.now()});
    _editBoard.sharedWith=picked;
    const idx=moodBoards.findIndex(b=>b.id===_editBoard.id);
    if(idx>-1)moodBoards[idx].sharedWith=picked;
    boardsLoaded=false;
    window.boardsCloseShare();
    _boardsRenderCanvasAndWire();
    _boardsLogBoardActivity(picked.length?('shared the board with '+picked.length+' '+(picked.length===1?'person':'people')):'stopped sharing the board');
    showToast(picked.length?('Shared with '+picked.length+' '+(picked.length===1?'person':'people')):'Sharing removed');
  }catch(e){showToast('Could not update sharing: '+(e.message||e),true);}
};

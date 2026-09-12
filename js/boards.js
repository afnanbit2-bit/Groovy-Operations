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
function _boardsCanEdit(b){
  return!!(b&&session&&(b.ownerUid===session.uid||session.role==='owner'));
}
function _boardsNewCard(type){
  const id='c'+(++_boardsCardSeq)+'_'+Date.now()+'_'+Math.floor(Math.random()*1e4);
  const w=type==='frame'?440:type==='text'?220:type==='todo'?240:type==='file'?200:170;
  const h=type==='frame'?320:type==='image'?120:type==='link'?120:type==='file'?110:type==='todo'?170:100;
  const base={id,type,x:80,y:80,w,h};
  if(type==='image')base.imageUrl='';
  if(type==='text')base.text='';
  if(type==='link'){base.linkUrl='';base.linkTitle='';base.linkDesc='';}
  if(type==='file'){base.fileUrl='';base.fileName='';base.fileSize=0;}
  if(type==='frame')base.title='';
  if(type==='todo')base.items=[{text:'',done:false}];
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
  const[sharedSnap,mineSnap]=await Promise.all([
    getDocs(query(collection(db,'mood_boards'),where('visibility','==','shared'))),
    getDocs(query(collection(db,'mood_boards'),where('ownerUid','==',session.uid)))
  ]);
  const map={};
  sharedSnap.forEach(d=>{map[d.id]={id:d.id,...d.data()};});
  mineSnap.forEach(d=>{map[d.id]={id:d.id,...d.data()};});
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
function renderBoardsGallery(){
  const team=moodBoards.filter(b=>b.visibility==='shared');
  const priv=moodBoards.filter(b=>b.visibility!=='shared');
  return`
  <button class="back-btn" onclick="window.showPage('creative-hub')">← Back to Creative Hub</button>
  <div class="page-head" style="margin-bottom:10px">
    <div><h2 style="margin:0">Mood Boards</h2><div style="color:var(--muted);font-size:12px;margin-top:2px">Drag, resize and connect reference images, notes and links</div></div>
  </div>
  <div class="notes-section">
    <div class="notes-section-head"><h3>TEAM</h3><button class="btn-sm" onclick="window.boardsCreate('shared')">+ New board</button></div>
    ${team.length?`<div class="board-gallery-grid">${team.map(_boardGalleryCardHTML).join('')}</div>`:'<div class="empty">No team boards yet.</div>'}
  </div>
  <div class="notes-section">
    <div class="notes-section-head"><h3>PRIVATE</h3><button class="btn-sm outline" onclick="window.boardsCreate('personal')">+ New board</button></div>
    ${priv.length?`<div class="board-gallery-grid">${priv.map(_boardGalleryCardHTML).join('')}</div>`:'<div class="empty">No private boards yet.</div>'}
  </div>
  ${_boardsTrashSectionHTML()}`;
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
function _boardGalleryCardHTML(b){
  const cards=b.cards||[];
  const xs=cards.map(c=>c.x+c.w),ys=cards.map(c=>c.y+c.h);
  const maxX=xs.length?Math.max(...xs)+20:200,maxY=ys.length?Math.max(...ys)+20:120;
  const scale=Math.min(220/maxX,110/maxY,0.6);
  const vis=b.visibility==='shared'?'TEAM':'PRIVATE';
  return`<div class="board-gallery-card" onclick="window.boardsOpen('${b.id}')">
    <div class="board-gallery-thumb">
      <div style="position:absolute;transform:scale(${scale});transform-origin:top left">
        ${cards.filter(c=>c.type==='frame').concat(cards.filter(c=>c.type!=='frame')).map(_boardMiniCardHTML).join('')}
      </div>
    </div>
    <div class="board-gallery-meta">
      <div style="font-weight:600;font-size:13.5px">${_boardsEsc(b.title||'Untitled board')}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${vis} · ${cards.length} card${cards.length===1?'':'s'} · ${_boardsEsc(b.ownerName||'')} · ${_boardsRelTime(b.updatedAt)}</div>
    </div>
  </div>`;
}
function _boardMiniCardHTML(c){
  const base=`position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;border-radius:6px;overflow:hidden;border:1px solid var(--border)`;
  if(c.type==='frame')return`<div style="${base};background:rgba(0,0,0,.03)"></div>`;
  if(c.type==='image')return c.imageUrl?`<div style="${base}"><img src="${_boardsEsc(c.imageUrl)}" style="width:100%;height:100%;object-fit:cover"></div>`:`<div style="${base};background:var(--soft)"></div>`;
  if(c.type==='link'||c.type==='file')return`<div style="${base};background:var(--soft)"></div>`;
  return`<div style="${base};background:#fff"></div>`;
}
window.boardsCreate=async function(visibility){
  try{
    const ref=await addDoc(collection(db,'mood_boards'),{
      title:'Untitled board',
      visibility:visibility==='shared'?'shared':'personal',
      ownerUid:session.uid,ownerName:session.name,ownerUsername:session.u,
      cards:[],connectors:[],zoom:1,panX:40,panY:30,
      createdAt:Date.now(),updatedAt:Date.now(),updatedByName:session.name
    });
    boardsLoaded=false;
    logActivity('Mood board created',`${session.name} created "${visibility==='shared'?'a team':'a private'}" mood board`);
    _boardsViewingId=ref.id;
    window.showPage('board-canvas');
  }catch(e){showToast('Could not create board: '+(e.message||e),true);}
};
window.boardsOpen=function(id){_boardsViewingId=id;window.showPage('board-canvas');};
window.boardsBack=function(){_boardsSaveNow();window.showPage('boards');};

// ── Canvas ──
async function _boardsOpenCanvas(){
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
  _editBoard={id:b.id,title:b.title||'Untitled board',visibility:b.visibility||'personal',ownerUid:b.ownerUid,ownerName:b.ownerName,ownerUsername:b.ownerUsername,zoom:b.zoom||1,panX:b.panX||40,panY:b.panY||30};
  _editCards=(b.cards||[]).map(c=>{const cc={...c};delete cc._uploading;return cc;});
  _editConnectors=(b.connectors||[]).map(cn=>({...cn}));
  _boardsSelection=new Set();
  // History is per board-opening — undoing your way into a different
  // board's state would be nonsense.
  _boardsUndo=[];_boardsRedo=[];
  _boardsRenderCanvasAndWire();
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
}
function _renderBoardCanvasHTML(){
  const b=_editBoard;
  if(!b)return'<div class="empty">No board loaded.</div>';
  const canEdit=_boardsCanEdit(b);
  const visLabel=b.visibility==='shared'?'TEAM':'PRIVATE';
  return`<div class="board-canvas-wrap">
    <div class="board-topbar">
      <div style="display:flex;align-items:center;gap:10px;min-width:0">
        <button class="back-btn" style="margin:0" onclick="window.boardsBack()">← Boards</button>
        <input type="text" id="board-title-input" value="${_boardsEsc(b.title)}" ${canEdit?'':'readonly'} oninput="window.boardsTitleInput(this.value)" placeholder="Untitled board" style="font-size:14.5px;font-weight:700;border:none;outline:none;font-family:inherit;background:transparent;max-width:240px">
        <span class="pill">${visLabel}</span>
        ${canEdit?`<span class="board-save-status" id="board-save-status">Saved</span>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${canEdit?`<button class="tool-btn" id="board-undo-btn" onclick="window.boardsUndoAction()" title="Undo (Ctrl+Z)" disabled>Undo</button>
        <button class="tool-btn" id="board-redo-btn" onclick="window.boardsRedoAction()" title="Redo (Ctrl+Shift+Z)" disabled>Redo</button>
        <div class="tool-sep"></div>`:''}
        ${canEdit?`<button class="tool-btn" onclick="window.boardsToggleVisibility()">Make ${b.visibility==='shared'?'Private':'Team'}</button>`:''}
        <button class="tool-btn" onclick="window.boardsZoomBy(0.8)">−</button>
        <span class="zoom-readout" id="board-zoom-readout">${Math.round(b.zoom*100)}%</span>
        <button class="tool-btn" onclick="window.boardsZoomBy(1.25)">+</button>
        <button class="tool-btn" onclick="window.boardsFitView()">Fit</button>
        <button class="tool-btn" onclick="window.boardsResetView()">100%</button>
        ${canEdit?`<button class="tool-btn${_boardsSnapGrid?' on':''}" id="board-snap-btn" onclick="window.boardsToggleSnap()" title="Snap cards to a grid while dragging">Snap</button>`:''}
        ${canEdit?`<button class="tool-btn" onclick="window.boardsDelete()" style="color:var(--accent-urgent)">Delete</button>`:''}
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
      ${canEdit?'<div class="board-selection-bar" id="board-selection-bar" style="display:none"></div>':''}
      ${canEdit?'<div class="board-dropzone" id="board-dropzone"><div>Drop files to add them to this board</div></div>':''}
      ${canEdit?`<div class="board-add-menu">
        <button onclick="window.boardsAddCard('image')">+ Image</button>
        <button onclick="window.boardsAddCard('text')">+ Text</button>
        <button onclick="window.boardsAddCard('todo')">+ To-do</button>
        <button onclick="window.boardsAddCard('link')">+ Link</button>
        <button onclick="window.boardsPickFiles()">+ File</button>
        <button onclick="window.boardsAddCard('frame')">+ Frame</button>
        <button id="board-line-btn" class="${_boardsLineMode?'on':''}" onclick="window.boardsToggleLineMode()">↗ Line</button>
      </div>`:''}
      ${canEdit&&!_editCards.length?'<div class="board-empty-hint">Double-click anywhere to add a note · drop files in · paste an image with Ctrl+V</div>':''}
    </div>
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
  }else{
    body=`<div class="board-card-body board-text-body" contenteditable="${!!canEdit}" id="board-txt-${c.id}" data-placeholder="Type a note…" oninput="window.boardsTextInput('${c.id}',this)"></div>`;
  }
  const kind=c.type==='image'?'Image':c.type==='link'?'Link':c.type==='file'?'File':c.type==='todo'?('To-do'+(c._todoProgress?' · '+c._todoProgress:'')):'Note';
  const sel=_boardsSelection.has(c.id)?' selected':'';
  const lock=c.locked?' locked':'';
  const tint=c.color?' tint-'+c.color:'';
  return`<div class="board-card-el${sel}${lock}${tint}" id="board-card-${c.id}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px" onclick="window.boardsSelectCard('${c.id}',event)">
    <div class="board-card-head" ${canEdit?`onpointerdown="window.boardsCardDragStart(event,'${c.id}')"`:''}>
      <span class="board-card-kind">${kind}${c.locked?' · Locked':''}</span>
      ${canEdit&&!c.locked?`<button class="board-card-del" onclick="window.boardsDeleteCard('${c.id}')" title="Delete">✕</button>`:''}
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
};
window.boardsDeleteCard=function(id){
  const c=_editCards.find(x=>x.id===id);
  if(c&&c.locked){showToast('That card is locked');return;}
  _boardsPushUndo();
  _editCards=_editCards.filter(x=>x.id!==id);
  _editConnectors=_editConnectors.filter(cn=>cn.from!==id&&cn.to!==id);
  _boardsSelection.delete(id);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
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
  if(removable.length<sel.length)showToast('Kept '+(sel.length-removable.length)+' locked card'+(sel.length-removable.length===1?'':'s'));
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
  const next=_editBoard.visibility==='shared'?'personal':'shared';
  try{
    await updateDoc(doc(db,'mood_boards',_editBoard.id),{visibility:next,updatedAt:Date.now()});
    _editBoard.visibility=next;
    boardsLoaded=false;
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
    const cards=_boardsCardsForSave();
    await updateDoc(doc(db,'mood_boards',_editBoard.id),{
      title:_editBoard.title,
      zoom:_editBoard.zoom,panX:_editBoard.panX,panY:_editBoard.panY,
      cards,connectors:_editConnectors,
      updatedAt:Date.now(),updatedByName:session.name
    });
    const idx=moodBoards.findIndex(b=>b.id===_editBoard.id);
    if(idx>-1)moodBoards[idx]={...moodBoards[idx],title:_editBoard.title,cards,connectors:_editConnectors,updatedAt:Date.now()};
    _boardsSetSaveStatus('Saved');
  }catch(e){
    _boardsSetSaveStatus('Save failed');
    showToast('Could not save board: '+(e.message||e),true);
  }finally{
    if(typeof window._gvSilentSaveStop==='function')window._gvSilentSaveStop();
  }
}

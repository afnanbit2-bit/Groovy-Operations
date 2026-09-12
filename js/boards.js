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
let _boardsSelectedCardId=null;
let _boardsAddCascade=0;      // so repeated "+ Card" clicks don't stack perfectly
let _boardsDragDepth=0;       // dragenter/dragleave fire per child; count to know when we really left

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
  const w=type==='text'?220:type==='file'?200:170;
  const h=type==='image'?120:type==='link'?120:type==='file'?110:100;
  const base={id,type,x:80,y:80,w,h};
  if(type==='image')base.imageUrl='';
  if(type==='text')base.text='';
  if(type==='link'){base.linkUrl='';base.linkTitle='';base.linkDesc='';}
  if(type==='file'){base.fileUrl='';base.fileName='';base.fileSize=0;}
  return base;
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
  if(!(e.ctrlKey||e.metaKey))return;
  const k=(e.key||'').toLowerCase();
  if(k!=='z'&&k!=='y')return;
  // Inside a text card or a link field, Ctrl+Z belongs to the browser's own
  // text undo — intercepting it there would be worse than not having ours.
  if(_boardsIsEditableFocus())return;
  e.preventDefault();
  if(k==='y'||e.shiftKey)window.boardsRedoAction();
  else window.boardsUndoAction();
}
document.addEventListener('keydown',_boardsOnKeydown);

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
        ${cards.map(_boardMiniCardHTML).join('')}
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
  _boardsSelectedCardId=null;
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
        ${canEdit?`<button class="tool-btn" onclick="window.boardsDelete()" style="color:var(--accent-urgent)">Delete</button>`:''}
      </div>
    </div>
    <div class="board-stage" id="board-stage">
      <div class="board-world" id="board-world">
        <svg class="board-conn-layer" id="board-conn-layer" width="4000" height="3000"></svg>
        ${_editCards.map(c=>_boardCardHTML(c,canEdit)).join('')}
      </div>
      ${canEdit?'<div class="board-dropzone" id="board-dropzone"><div>Drop files to add them to this board</div></div>':''}
      ${canEdit?`<div class="board-add-menu">
        <button onclick="window.boardsAddCard('image')">+ Image</button>
        <button onclick="window.boardsAddCard('text')">+ Text</button>
        <button onclick="window.boardsAddCard('link')">+ Link</button>
        <button onclick="window.boardsPickFiles()">+ File</button>
      </div>`:''}
      ${canEdit&&!_editCards.length?'<div class="board-empty-hint">Double-click anywhere to add a note · drop files in · paste an image with Ctrl+V</div>':''}
    </div>
    <input type="file" id="board-file-picker" multiple style="display:none" onchange="window.boardsFilesPicked(this)">
  </div>`;
}
function _boardCardHTML(c,canEdit){
  let body;
  if(c.type==='image'){
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
  const kind=c.type==='image'?'Image':c.type==='link'?'Link':c.type==='file'?'File':'Note';
  const sel=c.id===_boardsSelectedCardId?' selected':'';
  return`<div class="board-card-el${sel}" id="board-card-${c.id}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px" onclick="window.boardsSelectCard('${c.id}')">
    <div class="board-card-head" ${canEdit?`onpointerdown="window.boardsCardDragStart(event,'${c.id}')"`:''}>
      <span class="board-card-kind">${kind}</span>
      ${canEdit?`<button class="board-card-del" onclick="window.boardsDeleteCard('${c.id}')" title="Delete">✕</button>`:''}
    </div>
    ${body}
    ${canEdit?`<div class="board-link-handle" onpointerdown="window.boardsLinkStart(event,'${c.id}')" title="Drag to connect"></div>
    <div class="board-resize-handle" onpointerdown="window.boardsResizeStart(event,'${c.id}')"><svg viewBox="0 0 16 16"><path d="M14 2L2 14M14 8L8 14" stroke="currentColor" stroke-width="1.5" fill="none"/></svg></div>`:''}
  </div>`;
}
function _boardsHydrateTextCards(){
  _editCards.forEach(c=>{if(c.type==='text'){const el=document.getElementById('board-txt-'+c.id);if(el)el.textContent=c.text||'';}});
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
    const startX=e.clientX,startY=e.clientY,origX=b.panX,origY=b.panY;
    stage.classList.add('panning');
    stage.setPointerCapture(e.pointerId);
    function move(ev){b.panX=origX+(ev.clientX-startX);b.panY=origY+(ev.clientY-startY);_boardsApplyTransform();}
    function up(){stage.classList.remove('panning');stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerup',up);_boardsSaveDebounced();}
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
window.boardsCardDragStart=function(e,cardId){
  e.stopPropagation();
  const b=_editBoard;const c=_editCards.find(x=>x.id===cardId);if(!c)return;
  _boardsSelectCard(cardId);
  const head=e.currentTarget;
  const startX=e.clientX,startY=e.clientY,origX=c.x,origY=c.y;
  let pushed=false;
  head.setPointerCapture(e.pointerId);
  function move(ev){
    // One undo entry per gesture, pushed on the first actual movement —
    // a plain click on the header shouldn't leave a no-op in the stack.
    if(!pushed){_boardsPushUndo();pushed=true;}
    c.x=origX+(ev.clientX-startX)/b.zoom;
    c.y=origY+(ev.clientY-startY)/b.zoom;
    const el=document.getElementById('board-card-'+cardId);
    if(el){el.style.left=c.x+'px';el.style.top=c.y+'px';}
    _boardsUpdateConnectorsFor(cardId);
  }
  function up(){head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',up);_boardsSaveDebounced();}
  head.addEventListener('pointermove',move);
  head.addEventListener('pointerup',up);
};
window.boardsResizeStart=function(e,cardId){
  e.stopPropagation();
  const b=_editBoard;const c=_editCards.find(x=>x.id===cardId);if(!c)return;
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
function _boardsSelectCard(id){
  _boardsSelectedCardId=id;
  document.querySelectorAll('.board-card-el').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));
}
window.boardsSelectCard=function(id){_boardsSelectCard(id);};

// -- connectors --
function _boardCardCenter(c){return{x:c.x+c.w/2,y:c.y+c.h/2};}
function _boardsDrawConnectors(){
  const svg=document.getElementById('board-conn-layer');if(!svg)return;
  svg.innerHTML=_editConnectors.map(cn=>{
    const from=_editCards.find(c=>c.id===cn.from),to=_editCards.find(c=>c.id===cn.to);
    if(!from||!to)return'';
    const p1=_boardCardCenter(from),p2=_boardCardCenter(to);
    return`<line data-from="${cn.from}" data-to="${cn.to}" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" onclick="window.boardsDeleteConnector('${cn.from}','${cn.to}')"/>`;
  }).join('');
}
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
window.boardsDeleteConnector=function(from,to){
  _boardsPushUndo();
  _editConnectors=_editConnectors.filter(cn=>!(cn.from===from&&cn.to===to));
  _boardsDrawConnectors();
  _boardsSaveDebounced();
};

// -- card content --
window.boardsTitleInput=function(val){if(!_editBoard)return;_editBoard.title=val;_boardsSaveDebounced();};
window.boardsTextInput=function(id,el){const c=_editCards.find(x=>x.id===id);if(!c)return;c.text=el.textContent;_boardsSaveDebounced();};
window.boardsLinkInput=function(id,field,val){const c=_editCards.find(x=>x.id===id);if(!c)return;c[field]=val;_boardsSaveDebounced();};
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
    let card=_editCards.find(c=>c.id===_boardsSelectedCardId&&c.type==='image'&&!c.imageUrl);
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
  if(!text)return;
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
  _boardsPushUndo();
  _editCards=_editCards.filter(c=>c.id!==id);
  _editConnectors=_editConnectors.filter(cn=>cn.from!==id&&cn.to!==id);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
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

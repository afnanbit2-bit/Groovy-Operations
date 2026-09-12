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
let _boardsLoadError=null;      // set when EVERY board query failed
let _boardsLoadPartial=null;    // set when some queries failed but others worked
// Stage 4 — find-within-a-board state.
let _boardsFindOpen=false,_boardsFindQuery='',_boardsFindHits=[],_boardsFindIdx=0,_boardsFindTimer=null;
let _boardsMenuOpen=false;          // the board "⋯" dropdown in the canvas topbar
const _BOARDS_RECENT_KEY='groovy-boards-recent';
const _BOARDS_RECENT_MAX=8;
// Minimap default-on; like the snap preference it lives in localStorage
// because it is a per-viewer convenience, not part of the board.
let _boardsMinimapOn=(function(){try{return localStorage.getItem('groovy-boards-minimap')!=='0';}catch(e){return true;}})();
// The minimap is a DESKTOP affordance. On a phone it was a 104x72 smudge
// parked where a thumb rests, between the docked rail and the bug FAB —
// Afnan's word for it was that it "looks off", and Milanote's phone view
// has no equivalent at all. It isn't rendered below this width and the Map
// toggle is hidden with it, rather than left as a button that does nothing.
function _boardsIsPhone(){
  try{return!!(window.matchMedia&&window.matchMedia('(max-width:560px)').matches);}catch(e){return false;}
}

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
const _BOARDS_ZOOM_DETENT=1;      // 100% — a pinch from below stops here, with a buzz
const _BOARDS_ZOOM_TOUCH_MAX=2;   // 200% — as far as a pinch goes, second buzz
const _BOARDS_MICRO_GAIN=0.34;    // above 100%, finger travel buys a third of the zoom

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
  const w=type==='frame'?440:type==='heading'?440:type==='text'?220:type==='todo'?240:type==='file'?200:type==='board'?200:170;
  const h=type==='frame'?320:type==='heading'?58:type==='image'?120:type==='link'?120:type==='file'?110:type==='todo'?170:type==='board'?104:100;
  const base={id,type,x:80,y:80,w,h};
  if(type==='image')base.imageUrl='';
  if(type==='text')base.text='';
  if(type==='link'){base.linkUrl='';base.linkTitle='';base.linkDesc='';}
  if(type==='file'){base.fileUrl='';base.fileName='';base.fileSize=0;}
  if(type==='frame')base.title='';
  if(type==='heading')base.text='';
  if(type==='todo')base.items=[{text:'',done:false}];
  if(type==='board'){base.boardId='';base.boardTitle='';}
  // Provenance, shown in the right-click menu. Cards created before this
  // shipped simply don't carry it and the menu omits the line.
  if(typeof session!=='undefined'&&session){base.by=session.name||'';base.at=Date.now();}
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
  if(c.name)parts.push(c.name);
  if(c.fileName)parts.push(c.fileName);
  if(c.caption)parts.push(c.caption);
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
  if(k==='f2'&&_boardsSelection.size===1){e.preventDefault();_boardsCtxRun('rename');return;}
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

// Every write this module makes is ambient: an autosave, a presence
// heartbeat every 25s, an activity row, a rename. None of them are worth a
// full-screen "Saving…" block, and Afnan asked for the module to be silent
// (Sept 2026). These wrappers hold the shared write-buffer's opt-out for
// the duration of each call — the counter is re-entrant, so nesting inside
// _boardsSaveNow's own opt-out is harmless.
async function _boardsQuietWrite(fn){
  if(typeof window._gvSilentSaveStart==='function')window._gvSilentSaveStart();
  try{return await fn();}
  finally{if(typeof window._gvSilentSaveStop==='function')window._gvSilentSaveStop();}
}
const _qUpdate=(...a)=>_boardsQuietWrite(()=>updateDoc.apply(null,a));
const _qSet=(...a)=>_boardsQuietWrite(()=>setDoc.apply(null,a));
const _qAdd=(...a)=>_boardsQuietWrite(()=>addDoc.apply(null,a));
const _qDel=(...a)=>_boardsQuietWrite(()=>deleteDoc.apply(null,a));

// ── Load (gallery) ──
// Same two-single-field-query, merge-client-side approach as loadNotesData —
// each query maps 1:1 onto a clause of the firestore.rules read condition
// below, so it's always provably safe and never needs a composite index.
// A rejected query here used to leave the gallery on its loading skeleton
// forever: js/shared.js dispatches `loadBoardsData().then(render)` with no
// catch, so a rejection rendered nothing and said nothing. This function
// therefore NEVER rejects — it records what failed and lets the gallery
// show an honest error with a Retry button.
//
// The queries are also settled INDEPENDENTLY. That matters because
// Firestore rejects a query it cannot prove safe against the live rules,
// and the third query (Stage 6's `sharedWith`) is unprovable under any
// ruleset published before Stage 6. Sharing that fate with the other two
// would mean an un-republished Console takes the whole module down; this
// way the boards you own and your team's boards still load, and you get
// told what is missing.
async function loadBoardsData(){
  const me=_boardsMyEmail();
  const jobs=[
    {name:'team boards',p:()=>getDocs(query(collection(db,'mood_boards'),where('visibility','==','shared')))},
    {name:'your boards',p:()=>getDocs(query(collection(db,'mood_boards'),where('ownerUid','==',session.uid)))}
  ];
  if(me)jobs.push({name:'boards shared with you',p:()=>getDocs(query(collection(db,'mood_boards'),where('sharedWith','array-contains',me)))});
  const settled=await Promise.allSettled(jobs.map(j=>j.p()));
  const map={};
  let ok=0;
  const failed=[];
  let firstErr='';
  settled.forEach((r,i)=>{
    if(r.status==='fulfilled'){ok++;r.value.forEach(d=>{map[d.id]={id:d.id,...d.data()};});}
    else{
      failed.push(jobs[i].name);
      const msg=(r.reason&&(r.reason.message||r.reason.code))||String(r.reason);
      if(!firstErr)firstErr=msg;
      console.warn('[boards] query failed ('+jobs[i].name+'):',msg);
    }
  });
  _boardsLoadError=ok?null:(firstErr||'Could not read boards');
  _boardsLoadPartial=(ok&&failed.length)?failed.slice():null;
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
window.boardsRetryLoad=async function(){
  boardsLoaded=false;_boardsLoadError=null;_boardsLoadPartial=null;
  const m=document.getElementById('main-content');
  if(m&&typeof gvSkeleton==='function')m.innerHTML=gvSkeleton(6);
  await loadBoardsData();
  _boardsRerenderGallery();
};
function _boardsLoadNoticeHTML(){
  if(_boardsLoadError){
    return`<div class="board-load-error">
      <div style="font-weight:700;font-size:13.5px;margin-bottom:4px">Could not load your boards</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.5">${_boardsEsc(_boardsLoadError)}</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:6px">If that says <em>missing or insufficient permissions</em>, the Firestore rules in the Firebase Console are older than this app — republish <code>firestore.rules</code>.</div>
      <button class="btn-sm" style="margin-top:10px" onclick="window.boardsRetryLoad()">Retry</button>
    </div>`;
  }
  if(_boardsLoadPartial){
    return`<div class="board-load-warn">
      Could not load: ${_boardsEsc(_boardsLoadPartial.join(', '))}. Everything else is shown. This usually means the Firestore rules in the Console are older than this app.
      <button class="btn-sm outline" style="margin-left:8px" onclick="window.boardsRetryLoad()">Retry</button>
    </div>`;
  }
  return'';
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
  ${_boardsLoadNoticeHTML()}
  ${_boardsGalleryBarHTML()}`;
  if(_boardsLoadError)return head;
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
      <div class="board-trash-row" data-trash="${b.id}">
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
    await _qUpdate(doc(db,'mood_boards',id),{deletedAt:null,deletedByName:null,updatedAt:Date.now()});
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
    await _qDel(doc(db,'mood_boards',id));
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
  return`<div class="board-gallery-card" data-board="${b.id}" onclick="window.boardsOpen('${b.id}')">
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
  if(c.type==='heading')return`<div style="${base};background:var(--dark)"></div>`;
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
  const ref=await _qAdd(collection(db,'mood_boards'),data);
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
    await _qUpdate(doc(db,'mood_boards',_editBoard.id),{isTemplate:next,updatedAt:Date.now()});
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
  // Seed the pill's last-seen value from the markup we just wrote, so
  // opening a board doesn't flash a percentage nobody asked for.
  _boardsPillZoom=_editBoard?Math.round(_editBoard.zoom*100):null;
  _boardsApplyTransform();
  _boardsHydrateTextCards();
  _boardsDrawConnectors();
  _boardsWireStagePan();
  _boardsWireFmtBar();
  _boardsHideFmtBar();
  _boardsSeedViewRect();
  _boardsSyncHistoryButtons();
  _boardsRenderRail();
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
        <input type="text" id="board-title-input" value="${_boardsEsc(b.title)}" ${canEdit?'':'readonly'} oninput="window.boardsTitleInput(this.value)" placeholder="Untitled board" title="Click to rename this board" style="font-size:14.5px;font-weight:700;outline:none;font-family:inherit;background:transparent;max-width:240px">
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
        ${_boardsIsPhone()?'':`<button class="tool-btn${_boardsMinimapOn?' on':''}" onclick="window.boardsToggleMinimap()" title="Show the minimap">Map</button>`}
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
      ${_boardsMinimapOn&&!_boardsIsPhone()?`<div class="board-minimap" id="board-minimap"><div class="board-minimap-inner" id="board-minimap-inner"></div><div class="board-minimap-view" id="board-minimap-view"></div></div>`:''}
      <div class="board-zoom-pill" id="board-zoom-pill">${Math.round(b.zoom*100)}%</div>
      ${canEdit?'<div class="board-dropzone" id="board-dropzone"><div>Drop files to add them to this board</div></div>':''}
      <div class="board-rail" id="board-rail"></div>
      ${canEdit&&!_editCards.length?'<div class="board-empty-hint">Double-click anywhere to add a note · drop files in · paste an image with Ctrl+V</div>':''}
    </div>
    <div class="board-fmt" id="board-fmt" style="display:none">
      <div class="board-fmt-swatches" id="board-fmt-swatches" style="display:none">
        ${_BOARDS_TEXT_COLORS.map(c=>`<button class="board-fmt-sw" style="background:${c.hex}" title="${c.label}" data-fmt="color:${c.hex}"></button>`).join('')}
      </div>
      <div class="board-fmt-row">
        <button class="board-fmt-btn" data-fmt="swatches" title="Text colour"><span class="fmt-T">T</span><i class="fmt-dot"></i></button>
        <button class="board-fmt-btn" data-fmt="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button class="board-fmt-btn" data-fmt="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button class="board-fmt-btn" data-fmt="strikeThrough" title="Strikethrough"><s>S</s></button>
        <button class="board-fmt-btn" data-fmt="underline" title="Underline (Ctrl+U)"><u>U</u></button>
        <button class="board-fmt-btn" data-fmt="insertUnorderedList" title="Bulleted list">☰</button>
        <button class="board-fmt-btn board-fmt-done" data-fmt="done">Done</button>
      </div>
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
      ?`<img src="${_boardsEsc(_boardsDisplayUrl(c.imageUrl,c.w))}" crossorigin="anonymous" onerror="window.boardsImgFallback(this)" data-full="${_boardsEsc(c.imageUrl)}" style="width:100%;height:100%;object-fit:cover;display:block">`
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
          <span class="board-file-name">${_boardsEsc(c.name||c.fileName||'File')}</span>
          <span class="board-file-size">${_boardsEsc(_boardsFormatBytes(c.fileSize))}</span>
        </div>
      </a>`;
    }else{
      body=canEdit
        ?`<label class="board-card-empty" for="board-fileinput-${c.id}">Click to choose a file<input type="file" id="board-fileinput-${c.id}" onchange="window.boardsUploadToCard('${c.id}',this)" style="display:none"></label>`
        :'<div class="board-card-empty">No file</div>';
      body=`<div class="board-card-body" style="padding:0">${body}</div>`;
    }
  }else if(c.type==='heading'){
    // A section banner — the thing Afnan's real Milanote board uses to
    // title every cluster. Its drag strip fades out until hover so it
    // reads as a banner rather than as another card.
    body=`<div class="board-card-body board-heading-body" contenteditable="${!!canEdit}" id="board-txt-${c.id}" data-placeholder="Section title" oninput="window.boardsTextInput('${c.id}',this)"></div>`;
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
  if((c.type==='image'||c.type==='file')&&c.caption!=null){
    body+=`<div class="board-caption" id="board-cap-${c.id}" contenteditable="${!!canEdit}" data-placeholder="Add a caption…" oninput="window.boardsCaptionInput('${c.id}',this)"></div>`;
  }
  const kind=c.type==='image'?'Image':c.type==='link'?'Link':c.type==='file'?'File':c.type==='board'?'Board':c.type==='heading'?'Heading':c.type==='todo'?('To-do'+(c._todoProgress?' · '+c._todoProgress:'')):'Note';
  const sel=_boardsSelection.has(c.id)?' selected':'';
  const lock=c.locked?' locked':'';
  const tint=c.color?' tint-'+c.color:'';
  return`<div class="board-card-el type-${c.type}${sel}${lock}${tint}" id="board-card-${c.id}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px" onclick="window.boardsSelectCard('${c.id}',event)">
    <div class="board-card-head" ${canEdit?`onpointerdown="window.boardsCardDragStart(event,'${c.id}')"`:''}>
      <span class="board-card-kind">
        <span class="board-card-name" id="board-name-${c.id}" contenteditable="${!!canEdit}" data-placeholder="${_boardsEsc(kind)}" oninput="window.boardsCardName('${c.id}',this)" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()" title="Click to rename this card"></span>${c.locked?' · Locked':''}</span>
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
// Card images carry crossorigin="anonymous" so the browser stores a
// CORS-enabled cache entry — the SAME entry the PNG/PDF exporter needs.
// Without it the exporter re-fetches and can be handed the non-CORS cached
// copy, which is the classic "shows fine on the page, taints the canvas"
// trap. If the host turns out NOT to send the header, the image would fail
// to load entirely, so this falls back once to a plain load: the picture
// still shows, and only the export degrades (as it already did).
window.boardsImgFallback=function(img){
  if(img.__fellBack)return;
  img.__fellBack=true;
  const full=img.getAttribute('data-full')||img.src;
  img.removeAttribute('crossorigin');
  img.src=full;
};

// ── Rich text in note cards ─────────────────────────────────────────────
// Notes can be bold/italic/underlined/struck, bulleted and coloured, so a
// card's body is no longer plain text — and that walks straight into the
// stored-XSS boundary every other user string in this file respects, since
// formatting means storing markup and putting it back into the DOM.
//
// The rule that keeps it safe: STORED MARKUP IS NEVER HANDED TO THE LIVE
// DOCUMENT. It is parsed by DOMParser into an inert document (no scripts
// run, no resources load there), rebuilt node by node against a fixed
// allow-list, and only that rebuilt output is serialised back. Sanitising
// happens on BOTH the write and the read — a card written by an older
// build, another client, or by hand in the Firestore console is cleaned
// before it is ever shown.
//
// c.text stays the plain-text mirror of the card: search, the PDF index and
// the PNG export all read it, and a card with no c.rich hydrates from it
// with textContent exactly as it did before any of this existed.
const _BOARDS_RICH_TAGS={B:'b',STRONG:'b',I:'i',EM:'i',U:'u',S:'s',STRIKE:'s',DEL:'s',
  BR:'br',DIV:'div',P:'div',UL:'ul',OL:'ol',LI:'li',SPAN:'span',FONT:'span'};
function _boardsRichColor(node){
  // The only styling that survives is a literal colour. Anything else in a
  // style attribute (position, background images, url(), expressions) is
  // dropped rather than filtered — an allow-list of one is easy to audit.
  let c='';
  try{c=node.style&&node.style.color?node.style.color:'';}catch(e){}
  if(!c&&node.getAttribute)c=node.getAttribute('color')||'';
  c=String(c||'').trim();
  if(/^#[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(c))return c;
  if(/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/.test(c))return c;
  return'';
}
function _boardsSanitizeRich(html){
  const src=String(html||'');
  if(!src)return'';
  let doc;
  try{doc=new DOMParser().parseFromString('<body>'+src+'</body>','text/html');}catch(e){return'';}
  if(!doc||!doc.body)return'';
  const out=doc.createElement('div');
  (function walk(from,to,depth){
    if(depth>12)return;   // hand-crafted deep nesting shouldn't blow the stack
    Array.prototype.forEach.call(from.childNodes,n=>{
      if(n.nodeType===3){to.appendChild(doc.createTextNode(n.nodeValue));return;}
      if(n.nodeType!==1)return;
      const tag=_BOARDS_RICH_TAGS[n.tagName];
      if(!tag){walk(n,to,depth+1);return;}   // unknown element: keep its text, drop it
      const el=doc.createElement(tag);
      const col=_boardsRichColor(n);
      if(col&&tag==='span')el.setAttribute('style','color:'+col);
      to.appendChild(el);
      if(tag!=='br')walk(n,el,depth+1);
    });
  })(doc.body,out,0);
  return out.innerHTML;
}
// Does this markup carry any actual formatting, or is it just the text?
function _boardsRichIsPlain(rich,text){
  return _boardsStripRich(rich)===String(text||'')&&!/<(?!br\b)[a-z]/i.test(rich||'');
}
function _boardsStripRich(rich){
  try{
    const d=new DOMParser().parseFromString('<body>'+String(rich||'')+'</body>','text/html');
    return d&&d.body?d.body.textContent:'';
  }catch(e){return'';}
}
function _boardsSetRichInto(el,c){
  if(!el)return;
  if(c.rich)el.innerHTML=_boardsSanitizeRich(c.rich);
  else el.textContent=c.text||'';
}

// User-authored text is written in via textContent after the structure is
// rendered, never interpolated into the HTML string — same stored-XSS
// boundary as Notes' block editor. To-do item text goes the same way;
// formatted note bodies go through the sanitiser above, which enforces the
// same boundary by a different route.
function _boardsHydrateTextCards(){
  _editCards.forEach(c=>{
    const nm=document.getElementById('board-name-'+c.id);
    if(nm)nm.textContent=c.name||'';
    if(c.caption!=null){
      const cap=document.getElementById('board-cap-'+c.id);
      if(cap)cap.textContent=c.caption||'';
    }
    if(c.type==='text'||c.type==='heading'){
      _boardsSetRichInto(document.getElementById('board-txt-'+c.id),c);
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
  _boardsShowZoomPill(b.zoom);
  _boardsUpdateMinimapView();
}
// The zoom readout in the topbar is unreadable mid-pinch on a phone — your
// hand is over the board and the number is in the corner. Milanote answers
// this with a percentage that appears over the canvas while you zoom and
// fades out after; this is that. It rides _boardsApplyTransform, which also
// runs on every pan, so it only surfaces when the zoom ACTUALLY changed.
let _boardsPillZoom=null,_boardsPillTimer=null;
function _boardsShowZoomPill(zoom){
  const pill=document.getElementById('board-zoom-pill');
  if(!pill)return;
  const pct=Math.round(zoom*100);
  if(_boardsPillZoom===pct)return;
  _boardsPillZoom=pct;
  pill.textContent=pct+'%';
  pill.classList.add('show');
  if(_boardsPillTimer)clearTimeout(_boardsPillTimer);
  _boardsPillTimer=setTimeout(()=>{pill.classList.remove('show');},1100);
}
// Android fires this; iOS Safari has no Vibration API at all and silently
// does nothing, which is the correct degradation — the zoom still detents,
// you just don't feel it.
function _boardsBuzz(ms){try{if(navigator.vibrate)navigator.vibrate(ms);}catch(e){}}
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

// Double-click (mouse) and double-tap (touch) both land here: a note
// exactly where you pointed, focused and ready to type, with the formatting
// bar already up.
function _boardsAddNoteAt(clientX,clientY){
  if(!_boardsCanEdit(_editBoard))return;
  const p=_boardsScreenToWorld(clientX,clientY);
  _boardsPushUndo();
  const c=_boardsNewCard('text');
  c.x=p.x-c.w/2;c.y=p.y-c.h/2;
  _editCards.push(c);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  const el=document.getElementById('board-txt-'+c.id);
  if(el)el.focus();
}

// ── Rotation and viewport changes ───────────────────────────────────────
// Turning a phone sideways changes the stage's size underneath a transform
// expressed in screen pixels, so whatever you were looking at slides off to
// one side. Holding the CENTRE of the viewport still is the one rule that
// makes a rotation feel like the board stayed put. Crossing the phone
// breakpoint also adds or removes the minimap and re-lays the rail, which
// needs a full render rather than a transform nudge.
let _boardsViewRect=null,_boardsWasPhone=null,_boardsViewTimer=null;
function _boardsSeedViewRect(){
  const stage=document.getElementById('board-stage');
  if(!stage){_boardsViewRect=null;return;}
  const r=stage.getBoundingClientRect();
  _boardsViewRect={w:r.width,h:r.height};
  _boardsWasPhone=_boardsIsPhone();
}
function _boardsOnViewportChange(){
  if(currentPage!=='board-canvas')return;
  const b=_editBoard;if(!b)return;
  if(_boardsWasPhone!==null&&_boardsWasPhone!==_boardsIsPhone()){
    _boardsRenderCanvasAndWire();
    return;
  }
  const stage=document.getElementById('board-stage');if(!stage)return;
  const r=stage.getBoundingClientRect();
  const prev=_boardsViewRect;
  _boardsViewRect={w:r.width,h:r.height};
  if(!prev||!prev.w||!prev.h)return;
  b.panX+=(r.width-prev.w)/2;
  b.panY+=(r.height-prev.h)/2;
  _boardsApplyTransform();
}
window.addEventListener('resize',()=>{
  if(_boardsViewTimer)clearTimeout(_boardsViewTimer);
  _boardsViewTimer=setTimeout(_boardsOnViewportChange,120);
});
window.addEventListener('orientationchange',()=>{
  // The new dimensions aren't readable at the instant this fires.
  setTimeout(_boardsOnViewportChange,180);
});

// ── The formatting bar ──────────────────────────────────────────────────
// Milanote's phone view puts a text toolbar directly above the keyboard the
// moment a note has focus — colour, bold, italic, strikethrough, underline,
// bullets, Done. This is that bar, and it is not phone-only: the same
// affordance is the fastest way to format on a desktop too, and one bar is
// one thing to maintain.
//
// Formatting runs through document.execCommand. It is marked deprecated and
// is still the only API every browser implements for this; the alternative
// is hand-rolling Range surgery for six commands, which is a great deal more
// code and a great deal more ways to corrupt a selection. What the markup it
// produces is allowed to be is enforced on the way to storage by
// _boardsSanitizeRich, not by trusting the command.
const _BOARDS_TEXT_COLORS=[
  {hex:'#111111',label:'Default'},
  {hex:'#6B6B6B',label:'Grey'},
  {hex:'#7B1F2A',label:'Red'},
  {hex:'#B47512',label:'Amber'},
  {hex:'#14532D',label:'Green'},
  {hex:'#35507A',label:'Blue'},
  {hex:'#7A4B7C',label:'Purple'}
];
let _boardsFmtTarget=null;
function _boardsIsRichField(el){
  return!!(el&&el.isContentEditable&&el.id&&el.id.indexOf('board-txt-')===0);
}
function _boardsShowFmtBar(el){
  const bar=document.getElementById('board-fmt');if(!bar)return;
  _boardsFmtTarget=el;
  bar.style.display='block';
}
function _boardsHideFmtBar(){
  const bar=document.getElementById('board-fmt');
  _boardsFmtTarget=null;
  if(bar){bar.style.display='none';const sw=document.getElementById('board-fmt-swatches');if(sw)sw.style.display='none';}
}
document.addEventListener('focusin',e=>{
  if(currentPage!=='board-canvas')return;
  if(_boardsIsRichField(e.target))_boardsShowFmtBar(e.target);
});
document.addEventListener('focusout',e=>{
  if(currentPage!=='board-canvas')return;
  if(!_boardsIsRichField(e.target))return;
  // Pressing a bar button blurs nothing (its pointerdown is prevented), but
  // tapping another card does — settle on the next tick and only hide if
  // focus really has left every note body.
  setTimeout(()=>{
    if(!_boardsIsRichField(document.activeElement))_boardsHideFmtBar();
  },0);
});
function _boardsWireFmtBar(){
  const bar=document.getElementById('board-fmt');
  if(!bar||bar.__wired)return;
  bar.__wired=true;
  // Every press must keep the caret where it is — a button that takes focus
  // destroys the selection it is supposed to act on, and the command then
  // silently does nothing.
  bar.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();});
  bar.addEventListener('mousedown',e=>e.preventDefault());
  bar.addEventListener('click',e=>{
    const btn=e.target.closest&&e.target.closest('[data-fmt]');
    if(!btn)return;
    e.preventDefault();e.stopPropagation();
    const act=btn.getAttribute('data-fmt');
    const target=_boardsFmtTarget;
    if(act==='done'){if(target&&target.blur)target.blur();_boardsHideFmtBar();return;}
    if(act==='swatches'){
      const sw=document.getElementById('board-fmt-swatches');
      if(sw)sw.style.display=sw.style.display==='none'?'flex':'none';
      return;
    }
    if(!target)return;
    if(target.focus)target.focus();
    try{
      // styleWithCSS matters per command: ON, a colour comes back as
      // <span style="color:…"> which the sanitiser keeps; OFF, bold comes
      // back as <b>, which it also keeps. The other way round, bold would
      // become <span style="font-weight:bold"> and the sanitiser — which
      // allow-lists colour and nothing else — would quietly strip it.
      const wantCss=act.indexOf('color:')===0;
      try{document.execCommand('styleWithCSS',false,wantCss);}catch(e2){}
      if(wantCss)document.execCommand('foreColor',false,act.slice(6));
      else document.execCommand(act,false,null);
    }catch(err){}
    // execCommand fires `input` in modern browsers, but not uniformly for
    // every command — dispatching it ourselves is what actually guarantees
    // the card is saved.
    try{target.dispatchEvent(new Event('input',{bubbles:true}));}catch(err){}
  });
}

// ── Touch: pinch-zoom and two-finger pan ────────────────────────────────
// The canvas runs entirely on pointer events, and on a phone the browser
// claims a touch for its own scroll/zoom before those events ever form a
// usable stream — which is why the board did not move at all on a phone.
// `touch-action:none` on .board-stage (css/main.css) hands every touch to
// us instead, and that is also what removes the browser's own pinch, so the
// pinch has to be implemented here.
//
// Tracking is DOCUMENT-level and capture-phase on purpose: once a gesture
// calls setPointerCapture (the stage does for a pan, a card header does for
// a drag), that pointer's events are retargeted to the capturing element —
// but they still propagate through document, so this sees every finger no
// matter which handler owns the first one.
const _boardsTouches=new Map();
let _boardsPinch=null;
function _boardsPinchGeom(){
  const pts=Array.from(_boardsTouches.values());
  const dx=pts[1].x-pts[0].x,dy=pts[1].y-pts[0].y;
  return{dist:Math.hypot(dx,dy)||1,cx:(pts[0].x+pts[1].x)/2,cy:(pts[0].y+pts[1].y)/2};
}
function _boardsPinchStart(){
  const b=_editBoard;if(!b)return;
  const g=_boardsPinchGeom();
  _boardsPinch={
    dist:g.dist,cx:g.cx,cy:g.cy,zoom:b.zoom,panX:b.panX,panY:b.panY,
    // Which side of the 100% detent this gesture began on decides how it
    // behaves for its whole life — see _boardsPinchZoom below.
    micro:b.zoom>=_BOARDS_ZOOM_DETENT-0.0001,
    buzzed100:false,buzzedMax:false
  };
  _boardsHideGuides();
}
// The zoom a pinch is allowed to reach, given where the gesture started.
//
// Below 100%, a pinch behaves normally but STOPS DEAD at 100% with a short
// buzz — 100% is where a board is meant to be read, and it should be
// possible to land on it exactly without hunting. Lift and pinch again and
// the gesture starts in "micro" mode: the same finger travel now buys about
// a third of the zoom, so the 100-200% range is placeable rather than
// something you shoot straight past, and 200% is the ceiling with a second
// buzz. Pinching back IN is never geared down — getting out of a zoom must
// stay as quick as it ever was.
function _boardsPinchZoom(p,ratio){
  if(!p.micro){
    const raw=p.zoom*ratio;
    if(raw>=_BOARDS_ZOOM_DETENT){
      if(!p.buzzed100){p.buzzed100=true;_boardsBuzz(14);}
      return _BOARDS_ZOOM_DETENT;
    }
    return Math.max(_BOARDS_ZOOM_MIN,raw);
  }
  const next=ratio>=1?p.zoom*(1+(ratio-1)*_BOARDS_MICRO_GAIN):p.zoom*ratio;
  if(next>=_BOARDS_ZOOM_TOUCH_MAX){
    if(!p.buzzedMax){p.buzzedMax=true;_boardsBuzz([10,40,10]);}
    return _BOARDS_ZOOM_TOUCH_MAX;
  }
  return Math.max(_BOARDS_ZOOM_MIN,next);
}
function _boardsPinchMove(){
  const b=_editBoard,p=_boardsPinch;if(!b||!p)return;
  const stage=document.getElementById('board-stage');if(!stage)return;
  const rect=stage.getBoundingClientRect();
  const g=_boardsPinchGeom();
  const next=_boardsPinchZoom(p,g.dist/p.dist);
  // Keep the world point that was under the starting midpoint under the
  // CURRENT midpoint — so one gesture zooms and pans together, the way it
  // does in every map app, instead of zooming about a fixed anchor and
  // leaving you to chase the content afterwards.
  const wx=(p.cx-rect.left-p.panX)/p.zoom,wy=(p.cy-rect.top-p.panY)/p.zoom;
  b.panX=(g.cx-rect.left)-wx*next;
  b.panY=(g.cy-rect.top)-wy*next;
  b.zoom=next;
  _boardsApplyTransform();
}
function _boardsWireTouch(){
  function onDown(e){
    if(e.pointerType!=='touch'||currentPage!=='board-canvas')return;
    if(!(e.target&&e.target.closest&&e.target.closest('.board-stage')))return;
    _boardsTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(_boardsTouches.size===2)_boardsPinchStart();
  }
  function onMove(e){
    if(e.pointerType!=='touch')return;
    if(!_boardsTouches.has(e.pointerId))return;
    _boardsTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(_boardsPinch&&_boardsTouches.size>=2)_boardsPinchMove();
  }
  function onUp(e){
    if(e.pointerType!=='touch')return;
    if(!_boardsTouches.delete(e.pointerId))return;
    if(_boardsPinch&&_boardsTouches.size<2){
      _boardsPinch=null;
      _boardsSaveDebounced();   // pan/zoom are board fields, worth persisting
    }
  }
  document.addEventListener('pointerdown',onDown,true);
  document.addEventListener('pointermove',onMove,true);
  document.addEventListener('pointerup',onUp,true);
  document.addEventListener('pointercancel',onUp,true);
}
_boardsWireTouch();
// Where a new card should land when it isn't being placed by a click:
// the middle of what you're currently looking at, nudged a little each
// time so repeat clicks fan out instead of stacking into one pile.
// Set by the right-click menu so the NEXT card lands where you clicked
// rather than in the middle of the viewport. One-shot, consumed here, so
// every existing add path (menu, file picker, paste) inherits it without a
// signature change.
let _boardsNextPlacement=null;
function _boardsPlacementPoint(){
  const b=_editBoard;
  if(_boardsNextPlacement){
    const p=_boardsNextPlacement;
    _boardsNextPlacement=null;
    return{x:p.x-90,y:p.y-40};
  }
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

  _boardsWireContextMenu(stage);

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
      // A second finger turns this into a pinch, which owns pan and zoom
      // together — the one-finger handler must stop fighting it.
      if(_boardsPinch)return;
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
    _boardsAddNoteAt(e.clientX,e.clientY);
  });

  // Touch has no dblclick worth relying on once touch-action:none has taken
  // the browser's own double-tap gesture away, so the tap pairing is done
  // here: two taps, within 300ms and 28px of each other, on empty canvas.
  let lastTap=0,lastX=0,lastY=0;
  stage.addEventListener('pointerup',e=>{
    if(e.pointerType!=='touch')return;
    if(e.target!==stage&&e.target.id!=='board-world')return;
    if(_boardsTouches.size)return;            // still mid-pinch
    const now=Date.now();
    if(now-lastTap<300&&Math.abs(e.clientX-lastX)<28&&Math.abs(e.clientY-lastY)<28){
      lastTap=0;
      _boardsAddNoteAt(e.clientX,e.clientY);
      return;
    }
    lastTap=now;lastX=e.clientX;lastY=e.clientY;
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
    if(_boardsPinch)return;   // two fingers down: zooming, not dragging a card
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
    if(_boardsPinch)return;
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
  // .board-frame too — frames are cards, and marquee-selecting one left it
  // unpainted until the next full render.
  document.querySelectorAll('.board-card-el,.board-frame').forEach(el=>el.classList.toggle('selected',_boardsSelection.has(el.dataset.id)));
  _boardsRenderRail();
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
/* ── The rail (Sept 2026) ───────────────────────────────────────────────
   One docked surface with two modes, replacing the floating selection bar
   AND the bottom "+ card" strip. Modelled on Milanote's left rail, which
   Afnan sent screenshots of: it holds the add-tools when nothing is
   selected and turns into per-type actions the moment something is —
   Color / Comment / Rename / Caption / Preview change with the element.

   Two surfaces for the same actions had started to duplicate each other,
   so both the rail and the right-click menu dispatch through the SAME
   action router (_boardsCtxRun). Adding an action in one place gives it to
   both, and they can never drift apart.

   Icons are local to this file rather than added to _icon() in
   js/shared.js — that file is cross-track (see CLAUDE.md), and none of
   these are wanted anywhere else. */
const _BOARDS_ICONS={
  note:'<path d="M3 2h10v12H3z"/><path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" fill="none"/>',
  image:'<path d="M2 3h12v10H2z" fill="none" stroke="currentColor"/><circle cx="6" cy="6.5" r="1.2"/><path d="M3 12l3.5-4 2.5 2.5L11 8l2 4z"/>',
  todo:'<path d="M2 3h5v5H2z" fill="none" stroke="currentColor"/><path d="M3 5.5l1.4 1.4L6.4 4" fill="none" stroke="currentColor"/><path d="M9 4h5M9 7h5M2 11h12" stroke="currentColor" fill="none"/>',
  link:'<path d="M6.5 9.5a3 3 0 010-4l1.5-1.5a3 3 0 014 4L10.8 9.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9.5 6.5a3 3 0 010 4L8 12a3 3 0 01-4-4l1.2-1.2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  file:'<path d="M4 1.5h5l3 3v10H4z" fill="none" stroke="currentColor"/><path d="M9 1.5v3h3" fill="none" stroke="currentColor"/>',
  heading:'<rect x="2" y="4" width="12" height="8" rx="1"/><path d="M4.5 8h7" stroke="#fff" stroke-width="1.4"/>',
  frame:'<rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor"/><path d="M2 6h12" stroke="currentColor"/>',
  board:'<rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor"/><rect x="4" y="5.5" width="3.5" height="5" /><rect x="8.5" y="5.5" width="3.5" height="2.5"/>',
  line:'<path d="M3 13L13 3M13 3H9M13 3v4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  comment:'<path d="M2.5 3h11v8h-6l-3 2.5V11h-2z" fill="none" stroke="currentColor"/>',
  rename:'<path d="M2 12.5l8.5-8.5 2 2L4 14.5H2z"/><path d="M10.5 4l2 2" stroke="currentColor"/>',
  caption:'<rect x="2" y="2.5" width="12" height="7" rx="1" fill="none" stroke="currentColor"/><path d="M2 12h9M2 14h6" stroke="currentColor"/>',
  replace:'<path d="M3 7a5 5 0 018-3.5M13 9a5 5 0 01-8 3.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11 2v2.5H8.5M5 14v-2.5h2.5" fill="none" stroke="currentColor"/>',
  download:'<path d="M8 2v8M5 7.5L8 10.5l3-3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 12.5h11" stroke="currentColor" stroke-width="1.4"/>',
  open:'<path d="M7 3H3v10h10V9" fill="none" stroke="currentColor"/><path d="M9.5 2.5H14V7M14 2.5L8 8.5" fill="none" stroke="currentColor"/>',
  lock:'<rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  unlock:'<rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 014.9-.7" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  dup:'<rect x="2" y="2" width="9" height="9" rx="1" fill="none" stroke="currentColor"/><rect x="5" y="5" width="9" height="9" rx="1" fill="none" stroke="currentColor"/>',
  front:'<rect x="2" y="2" width="8" height="8" rx="1" fill="none" stroke="currentColor"/><rect x="6" y="6" width="8" height="8" rx="1"/>',
  back:'<rect x="6" y="6" width="8" height="8" rx="1" fill="none" stroke="currentColor"/><rect x="2" y="2" width="8" height="8" rx="1"/>',
  stack:'<rect x="4" y="2" width="8" height="3" rx="1"/><rect x="4" y="6.5" width="8" height="3" rx="1"/><rect x="4" y="11" width="8" height="3" rx="1"/>',
  grid:'<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
  trash:'<path d="M3.5 4.5h9l-1 9.5h-7z" fill="none" stroke="currentColor"/><path d="M6 4.5V3h4v1.5M2.5 4.5h11" fill="none" stroke="currentColor"/>',
  fit:'<path d="M2 5.5V2h3.5M14 5.5V2h-3.5M2 10.5V14h3.5M14 10.5V14h-3.5" fill="none" stroke="currentColor" stroke-width="1.3"/>'
};
function _boardsIcon(name){
  return`<svg viewBox="0 0 16 16" aria-hidden="true">${_BOARDS_ICONS[name]||_BOARDS_ICONS.note}</svg>`;
}
function _boardsRailItems(){
  const canEdit=_boardsCanEdit(_editBoard);
  const sel=_boardsSelectedCards();
  if(!sel.length){
    if(!canEdit)return[{act:'fit',label:'Fit',icon:'fit'}];
    return[
      {act:'add:text',label:'Note',icon:'note'},
      {act:'add:image',label:'Image',icon:'image'},
      {act:'add:todo',label:'To-do',icon:'todo'},
      {act:'add:link',label:'Link',icon:'link'},
      {act:'file',label:'File',icon:'file'},
      {act:'add:heading',label:'Heading',icon:'heading'},
      {act:'add:frame',label:'Frame',icon:'frame'},
      {act:'add:board',label:'Board',icon:'board'},
      {act:'line',label:'Line',icon:'line',on:_boardsLineMode},
      {sep:true},
      {act:'comment-board',label:'Comment',icon:'comment'},
      {act:'fit',label:'Fit',icon:'fit'}
    ];
  }
  const one=sel.length===1?sel[0]:null;
  const items=[];
  if(canEdit)items.push({swatches:true});
  items.push({act:'card-comment',label:'Comment',icon:'comment'});
  if(one){
    if(one.type==='image'||one.type==='file'){
      if(canEdit)items.push({act:'caption',label:'Caption',icon:'caption'});
      if(canEdit)items.push({act:'replace',label:'Replace',icon:'replace'});
      items.push({act:'download',label:'Download',icon:'download'});
    }
    if(one.type==='link'&&one.linkUrl)items.push({act:'openasset',label:'Open',icon:'open'});
    if(one.type==='board'&&one.boardId)items.push({act:'open-board',label:'Open',icon:'open'});
    if(canEdit)items.push({act:one.type==='heading'?'renameheading':'rename',label:'Rename',icon:'rename'});
  }
  if(!canEdit)return items;
  if(sel.length>1){
    items.push({sep:true});
    items.push({act:'stack',label:'Stack',icon:'stack'});
    items.push({act:'grid',label:'Grid',icon:'grid'});
    items.push({act:'wrapframe',label:'Frame',icon:'frame'});
  }
  items.push({sep:true});
  items.push({act:'dup',label:'Duplicate',icon:'dup'});
  items.push({act:'front',label:'Front',icon:'front'});
  items.push({act:'back',label:'Back',icon:'back'});
  const locked=sel.some(c=>c.locked);
  items.push({act:'lock',label:locked?'Unlock':'Lock',icon:locked?'unlock':'lock'});
  items.push({sep:true});
  items.push({act:'delete',label:'Delete',icon:'trash',danger:true});
  return items;
}
function _boardsRenderRail(){
  const host=document.getElementById('board-rail');
  if(!host||!_editBoard)return;
  const sel=_boardsSelectedCards();
  host.classList.toggle('selecting',!!sel.length);
  const items=_boardsRailItems();
  host.innerHTML=(sel.length>1?`<div class="rail-count">${sel.length}</div>`:'')+items.map(it=>{
    if(it.sep)return'<div class="rail-sep"></div>';
    if(it.swatches)return`<div class="rail-swatches">${_BOARDS_COLORS.map(c=>`<button class="board-swatch sw-${c}" data-act="color:${c}" title="${c==='none'?'No colour':c}"></button>`).join('')}</div>`;
    return`<button class="rail-btn${it.on?' on':''}${it.danger?' danger':''}" data-act="${it.act}" title="${_boardsEsc(it.label)}">${_boardsIcon(it.icon)}<span>${_boardsEsc(it.label)}</span></button>`;
  }).join('');
  if(host.__wired)return;
  host.__wired=true;
  // One delegated listener on a host that survives innerHTML swaps — and
  // pointerdown must not reach the stage, or clicking the rail would start
  // a pan and clear the very selection you are acting on.
  host.addEventListener('pointerdown',e=>e.stopPropagation());
  host.addEventListener('click',e=>{
    const btn=e.target.closest&&e.target.closest('[data-act]');
    if(!btn)return;
    e.stopPropagation();
    _boardsCtxWorld=null;
    _boardsCtxRun(btn.getAttribute('data-act'));
  });
}
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
      return`<line class="free" data-conn="${i}" x1="${cn.x1}" y1="${cn.y1}" x2="${cn.x2}" y2="${cn.y2}"${arrow}/>`;
    }
    const from=_editCards.find(c=>c.id===cn.from),to=_editCards.find(c=>c.id===cn.to);
    if(!from||!to)return'';
    const p1=_boardCardCenter(from),p2=_boardCardCenter(to);
    return`<line data-conn="${i}" data-from="${cn.from}" data-to="${cn.to}" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"${arrow}/>`;
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
  _boardsRenderRail();   // the rail owns the Line toggle's on-state now
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
window.boardsTextInput=function(id,el){
  const c=_editCards.find(x=>x.id===id);if(!c)return;
  c.text=el.textContent;
  // Only carry markup when there IS markup — an unformatted note stays a
  // plain string on the document, exactly as every card did before.
  const rich=_boardsSanitizeRich(el.innerHTML);
  if(rich&&!_boardsRichIsPlain(rich,c.text))c.rich=rich;else delete c.rich;
  _boardsSaveDebounced();
};
window.boardsLinkInput=function(id,field,val){const c=_editCards.find(x=>x.id===id);if(!c)return;c[field]=val;_boardsSaveDebounced();};
// The card's own name, shown in its header in place of the type label.
// Empty means "fall back to the type label", which the CSS placeholder
// renders — so clearing a name restores IMAGE / FILE / NOTE rather than
// leaving a blank strip.
window.boardsCardName=function(id,el){
  const c=_editCards.find(x=>x.id===id);
  if(!c)return;
  const v=String(el.textContent||'').replace(/\s+/g,' ').trim();
  if(v)c.name=v.slice(0,80);
  else delete c.name;
  _boardsSaveDebounced();
};
window.boardsCaptionInput=function(id,el){
  const c=_editCards.find(x=>x.id===id);
  if(!c)return;
  c.caption=el.textContent;
  _boardsSaveDebounced();
};
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
// Cards were rendering the ORIGINAL upload: measured in a live session at
// 1024×1536 natural for a 279×458 box — 3.7x per axis, ~13x the pixels, on
// every image, every load. Cloudinary resizes at the edge, so ask it for a
// derivative instead. Bucketed widths (not the exact card width) so the
// same few URLs are reused and actually hit a cache; the STORED url is
// never rewritten — this is derived at render time, so existing cards get
// it for free and nothing has to migrate.
function _boardsDisplayUrl(url,cardW){
  const u=String(url||'');
  if(!/res\.cloudinary\.com/.test(u)||u.indexOf('/upload/')===-1)return u;
  if(/\/upload\/(f_|q_|w_|c_|dpr_)/.test(u))return u;      // already transformed
  const w=cardW<=250?400:cardW<=600?800:1200;
  return u.replace('/upload/','/upload/f_auto,q_auto,w_'+w+'/');
}
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
    if(typeof session!=='undefined'&&session){copy.by=session.name||'';copy.at=Date.now();}
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
    await _qUpdate(doc(db,'mood_boards',_editBoard.id),{visibility:next,updatedAt:Date.now()});
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
    await _qUpdate(doc(db,'mood_boards',_editBoard.id),{deletedAt:Date.now(),deletedByName:session.name,updatedAt:Date.now()});
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
// The board shows NOTHING while saving. A progress indicator on an
// autosave is a promise that the user has something to wait for, and they
// don't: Firestore's local cache takes the write immediately and syncs
// behind them. Only genuine exceptions get pixels — offline, or a failure.
function _boardsSetSaveStatus(state){
  const el=document.getElementById('board-save-status');
  if(!el)return;
  let text='';
  if(state==='failed')text='Save failed — will retry';
  else if(state==='offline'||(state==='' &&typeof navigator!=='undefined'&&navigator.onLine===false))text='Offline — saved on this device';
  el.textContent=text;
  el.classList.toggle('warn',!!text);
}
// Offline is a state, not an event in the save path, so it is reflected the
// moment the browser notices rather than on the next write.
window.addEventListener('online',()=>{if(currentPage==='board-canvas')_boardsSetSaveStatus('');});
window.addEventListener('offline',()=>{if(currentPage==='board-canvas')_boardsSetSaveStatus('offline');});
function _boardsSaveDebounced(){
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
    // A transaction CANNOT use the local cache — it needs a live round trip,
    // and fails outright offline. That is the right price when someone else
    // is on the board, and pure cost when nobody is. Presence already tells
    // us which it is, so alone we take the plain local-first write: applied
    // to IndexedDB instantly, synced behind you, works with no signal.
    if(!_boardsPeers.length)throw new Error('solo — local-first write');
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
    // Either nobody else is here (the common case — see above), or we are
    // offline, or the transaction ran out of retries. All three take the
    // plain queued write: local-first, last-writer-wins.
    try{
      const payload={...head,cards:cur,connectors:conns};
      await _qUpdate(ref,payload);
      wrote=payload;
    }catch(e2){
      if(_editBoard&&_editBoard.id===savingId)_boardsSetSaveStatus('failed');
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
  _boardsSetSaveStatus('');
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
    :c.type==='board'?'Sub-board':c.type==='todo'?'To-do':c.type==='frame'?'Section'
    :c.type==='heading'?'Heading':'Note';
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
  ctx.fillText(String(c.name||_boardsExportKind(c)).toUpperCase()+(c.locked?' · LOCKED':''),c.x+8,c.y+13.5);

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
  }else if(c.type==='heading'){
    ctx.fillStyle=c.color&&P.tint[c.color]?P.tint[c.color]:P.dark;
    ctx.fillRect(bx,by,bw,bh);
    ctx.fillStyle='#ffffff';
    ctx.font='700 15px '+P.font;
    const line=_boardsWrapLines(ctx,c.text||'',bw-24,1)[0]||'';
    const tw=ctx.measureText(line).width;
    ctx.fillText(line,bx+Math.max(10,(bw-tw)/2),by+bh/2+5);
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
  if(c.caption){
    ctx.fillStyle=P.muted;ctx.font='10px '+P.font;
    ctx.fillText((_boardsWrapLines(ctx,c.caption,bw-16,1)[0])||'',bx+8,c.y+c.h-7);
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
      :c.type==='file'?(c.name||c.fileName||'')
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
  const beat=()=>{_qSet(ref,{name:session.name||'',u:session.u||'',ts:Date.now()}).catch(()=>{});};
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
    try{_qDel(doc(db,'mood_boards',id,'presence',session.uid)).catch(()=>{});}catch(e){}
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
    _qAdd(collection(db,'mood_boards',_editBoard.id,'activity'),{
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
    await _qAdd(collection(db,'mood_boards',_editBoard.id,'comments'),{
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
  try{await _qUpdate(doc(db,'mood_boards',_editBoard.id,'comments',id),{resolved:!!resolved});}
  catch(e){showToast('Could not update comment: '+(e.message||e),true);}
};
window.boardsDeleteComment=async function(id){
  if(!_editBoard)return;
  if(!confirm('Delete this comment?'))return;
  try{await _qDel(doc(db,'mood_boards',_editBoard.id,'comments',id));}
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
    await _qUpdate(doc(db,'mood_boards',_editBoard.id),{sharedWith:picked,updatedAt:Date.now()});
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

/* ── Right-click menu (Sept 2026) ───────────────────────────────────────
   Modelled on Milanote's, which Afnan sent a screenshot of: right-click
   empty canvas for New Note / Link / To-do / Line / Board / Comment and
   Select All, right-click a card for its own actions.

   Three rules it holds to:
   - **Inside a text card, to-do item or any input, the browser's own menu
     wins.** Spellcheck suggestions, copy and paste belong to the browser
     while you are editing text; hijacking them there is infuriating —
     same reasoning as _boardsOnKeydown leaving Ctrl+Z alone in a field.
   - **New cards land where you right-clicked**, via the one-shot
     _boardsNextPlacement above, not in the middle of the screen.
   - **Right-clicking a card that is already part of a multi-selection
     keeps the group** (so "Duplicate" means all twelve); right-clicking
     an unselected card selects just it first. Same rule as dragging.

   It also gives connector lines a home: they used to be DELETED by a
   plain left click, with no confirmation and no other interaction — the
   line is now inert on click and deleted from this menu instead. */
const _BOARDS_CTX_ID='board-ctx';
let _boardsCtxWorld=null;   // world point the menu was opened at

function _boardsCloseCtx(){
  const el=document.getElementById(_BOARDS_CTX_ID);
  if(el)el.remove();
}
function _boardsCtxHTML(items){
  return items.map(it=>{
    if(it.sep)return'<div class="board-ctx-sep"></div>';
    if(it.title)return`<div class="board-ctx-title">${_boardsEsc(it.title)}</div>`;
    if(it.swatches)return`<div class="board-ctx-swatches">${_BOARDS_COLORS.map(c=>`<button class="board-swatch sw-${c}" data-act="color:${c}" title="${c==='none'?'No colour':c}"></button>`).join('')}</div>`;
    return`<button class="board-ctx-item${it.danger?' danger':''}" data-act="${it.act}">${_boardsEsc(it.label)}${it.hint?`<span class="board-ctx-hint">${_boardsEsc(it.hint)}</span>`:''}</button>`;
  }).join('');
}
function _boardsOpenCtx(clientX,clientY,items,galleryId){
  _boardsCloseCtx();
  const el=document.createElement('div');
  el.id=_BOARDS_CTX_ID;
  el.className='board-ctx';
  el.innerHTML=_boardsCtxHTML(items);
  document.body.appendChild(el);
  // Clamp inside the viewport — a menu opened near the right or bottom
  // edge would otherwise run off-screen with no way to reach it.
  const r=el.getBoundingClientRect();
  el.style.left=Math.max(6,Math.min(clientX,window.innerWidth-r.width-8))+'px';
  el.style.top=Math.max(6,Math.min(clientY,window.innerHeight-r.height-8))+'px';
  el.addEventListener('click',ev=>{
    const btn=ev.target.closest&&ev.target.closest('[data-act]');
    if(!btn)return;
    const act=btn.getAttribute('data-act');
    _boardsCloseCtx();
    // Gallery actions work on a board BY ID; canvas actions work on the
    // open board. One menu renderer, two routers.
    if(act.indexOf('g:')===0)_boardsGalleryCtxRun(act,galleryId);
    else _boardsCtxRun(act);
  });
}
function _boardsCtxRun(act){
  if(!_editBoard)return;
  const at=_boardsCtxWorld;
  const place=()=>{if(at)_boardsNextPlacement={x:at.x,y:at.y};};
  if(act.indexOf('add:')===0){place();window.boardsAddCard(act.slice(4));return;}
  if(act.indexOf('color:')===0){window.boardsSetColor(act.slice(6));return;}
  if(act.indexOf('conn:')===0){window.boardsDeleteConnectorAt(parseInt(act.slice(5),10));return;}
  switch(act){
    case'file':place();window.boardsPickFiles();break;
    case'line':window.boardsToggleLineMode();break;
    case'paste':place();_boardsCtxPaste();break;
    case'selectall':window.boardsSelectAll();break;
    case'fit':window.boardsFitView();break;
    case'reset':window.boardsResetView();break;
    case'comment-board':window.boardsOpenComments(null);break;
    case'card-comment':{const s=_boardsSelectedCards();if(s.length===1)window.boardsOpenComments(s[0].id);break;}
    case'card-link':window.boardsCopyCardLink();break;
    case'dup':window.boardsDuplicateSelection();break;
    case'front':window.boardsBringToFront();break;
    case'back':window.boardsSendToBack();break;
    case'lock':window.boardsToggleLock();break;
    case'delete':window.boardsDeleteSelection();break;
    case'open-board':{const s=_boardsSelectedCards();if(s.length===1&&s[0].boardId)window.boardsGoto(s[0].boardId);break;}
    case'cut':case'copy':{
      // Our copy/cut live on the real clipboard events (see _boardsOnCopy),
      // so the menu fires those rather than keeping a second code path.
      let ok=false;
      try{ok=document.execCommand(act);}catch(e){ok=false;}
      if(!ok)showToast('Press Ctrl+'+(act==='cut'?'X':'C')+' to '+act+' these cards');
      break;
    }
    case'replace':{const s=_boardsSelectedCards();if(s.length===1)_boardsReplaceAsset(s[0].id);break;}
    case'download':{const u=_boardsAssetUrl();if(u)window.open(_boardsDownloadUrl(u),'_blank','noopener');break;}
    case'openasset':{const u=_boardsAssetUrl();if(u)window.open(u,'_blank','noopener');break;}
    case'copyasset':{
      const s=_boardsSelectedCards();
      const c=s.length===1?s[0]:null;
      const u=c&&c.type==='board'&&c.boardId?_boardsLinkFor(c.boardId,null):_boardsAssetUrl();
      if(!u)break;
      _boardsCopyText(u).then(ok=>showToast(ok?'Link copied':u,!ok));
      break;
    }
    case'copytext':{
      const s=_boardsSelectedCards();
      if(s.length===1)_boardsCopyText(s[0].text||'').then(ok=>showToast(ok?'Text copied':'Could not copy',!ok));
      break;
    }
    case'rename':{
      const s=_boardsSelectedCards();
      if(s.length!==1)break;
      const c=s[0];
      if(c.type==='frame'){
        const el=document.querySelector('#board-card-'+c.id+' .board-frame-title');
        if(el){el.focus();try{el.select();}catch(e){}}
        break;
      }
      if(c.type==='heading'){
        const el=document.getElementById('board-txt-'+c.id);
        if(el)el.focus();
        break;
      }
      // Every other card renames through the editable label in its header.
      const el=document.getElementById('board-name-'+c.id);
      if(!el)break;
      el.focus();
      try{
        const r=document.createRange();
        r.selectNodeContents(el);
        const sel2=window.getSelection();
        sel2.removeAllRanges();
        sel2.addRange(r);
      }catch(e){/* focus alone is enough */}
      break;
    }
    case'selectinside':{
      const s=_boardsSelectedCards();
      if(s.length!==1||s[0].type!=='frame')break;
      const inside=_boardsCardsInFrame(s[0]).map(c=>c.id);
      if(!inside.length){showToast('Nothing inside that frame');break;}
      _boardsSetSelection(inside);
      break;
    }
    case'tickall':case'untickall':{
      const s=_boardsSelectedCards();
      if(s.length!==1||s[0].type!=='todo')break;
      _boardsPushUndo();
      (s[0].items||[]).forEach(i=>{i.done=(act==='tickall');});
      _boardsRenderCanvasAndWire();
      _boardsSaveDebounced();
      break;
    }
    case'caption':{
      const s=_boardsSelectedCards();
      if(s.length!==1)break;
      const c=s[0];
      if(c.type!=='image'&&c.type!=='file'){showToast('Captions are for images and files');break;}
      if(c.caption==null){
        _boardsPushUndo();
        c.caption='';
        _boardsRenderCanvasAndWire();
        _boardsSaveDebounced();
      }
      const el=document.getElementById('board-cap-'+c.id);
      if(el)el.focus();
      break;
    }
    case'renameheading':{
      const s=_boardsSelectedCards();
      if(s.length!==1)break;
      const el=document.getElementById('board-txt-'+s[0].id);
      if(el)el.focus();
      break;
    }
    case'stack':window.boardsStackSelection();break;
    case'grid':window.boardsGridSelection();break;
    case'wrapframe':window.boardsFrameSelection();break;
    default:break;
  }
}
// Menu-driven paste can only reach the clipboard's TEXT (reading an image
// needs navigator.clipboard.read() plus a permission prompt), so anything
// it can't handle is answered honestly with "press Ctrl+V" rather than
// failing silently.
async function _boardsCtxPaste(){
  if(!_boardsCanEdit(_editBoard))return;
  let text='';
  try{
    if(navigator.clipboard&&navigator.clipboard.readText)text=await navigator.clipboard.readText();
  }catch(e){text='';}
  if(!text){showToast('Press Ctrl+V here to paste an image or text');return;}
  if(text.indexOf(_BOARDS_CLIP_PREFIX)===0){
    try{
      const cards=JSON.parse(text.slice(_BOARDS_CLIP_PREFIX.length));
      if(_boardsPasteCards(cards))return;
    }catch(e){/* fall through to plain text */}
  }
  const trimmed=text.trim();
  const isUrl=/^https?:\/\/\S+$/i.test(trimmed);
  _boardsPushUndo();
  const c=_boardsNewCard(isUrl?'link':'text');
  const p=_boardsPlacementPoint();
  c.x=p.x;c.y=p.y;
  if(isUrl){
    c.linkUrl=trimmed;
    try{c.linkTitle=new URL(trimmed).hostname.replace(/^www\./,'');}catch(e){c.linkTitle='';}
  }else{
    c.text=text;
    if(text.length>180)c.h=Math.min(320,100+Math.floor(text.length/40)*16);
  }
  _editCards.push(c);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  showToast(isUrl?'Link added':'Note added');
}
// The URL behind the one selected card, whatever kind it is.
function _boardsAssetUrl(){
  const sel=_boardsSelectedCards();
  if(sel.length!==1)return'';
  const c=sel[0];
  return c.type==='image'?(c.imageUrl||''):c.type==='file'?(c.fileUrl||''):c.type==='link'?(c.linkUrl||''):'';
}
// Cloudinary serves an asset inline by default; fl_attachment is its
// documented flag for "send this as a download". Best-effort — a non
// Cloudinary URL is opened as-is, and this could not be verified from the
// build sandbox, which cannot reach res.cloudinary.com.
function _boardsDownloadUrl(url){
  const u=String(url||'');
  if(/res\.cloudinary\.com/.test(u)&&u.indexOf('/upload/')>-1&&u.indexOf('fl_attachment')===-1){
    return u.replace('/upload/','/upload/fl_attachment/');
  }
  return u;
}
// Swap the asset on an existing image/file card. The card's own <input>
// only exists while the card is EMPTY, so replacing needs a throwaway one.
function _boardsReplaceAsset(cardId){
  if(!_boardsCanEdit(_editBoard))return;
  const c=_editCards.find(x=>x.id===cardId);
  if(!c)return;
  const inp=document.createElement('input');
  inp.type='file';
  if(c.type==='image')inp.accept='image/*';
  inp.style.display='none';
  document.body.appendChild(inp);
  inp.addEventListener('change',()=>{
    const f=inp.files&&inp.files[0];
    if(f)_boardsUploadFileToCard(cardId,f);
    inp.remove();
  });
  inp.click();
}
function _boardsCanvasCtxItems(canEdit){
  if(!canEdit){
    return[
      {act:'selectall',label:'Select all',hint:'Ctrl+A'},
      {sep:true},
      {act:'fit',label:'Fit view'},
      {act:'reset',label:'Reset zoom'}
    ];
  }
  return[
    {act:'add:text',label:'New note',hint:'Double-click'},
    {act:'add:image',label:'New image'},
    {act:'add:todo',label:'New to-do'},
    {act:'add:link',label:'New link'},
    {act:'file',label:'New file…'},
    {act:'add:heading',label:'New heading'},
    {act:'add:frame',label:'New frame'},
    {act:'add:board',label:'New board'},
    {act:'line',label:_boardsLineMode?'Line mode off':'Draw a line'},
    {sep:true},
    {act:'comment-board',label:'New comment'},
    {sep:true},
    {act:'paste',label:'Paste',hint:'Ctrl+V'},
    {act:'selectall',label:'Select all',hint:'Ctrl+A'},
    {sep:true},
    {act:'fit',label:'Fit view'},
    {act:'reset',label:'Reset zoom'}
  ];
}
// Per-card-type menus, modelled on Milanote's: the common block first
// (cut/copy/duplicate/delete with their real shortcuts), then whatever only
// makes sense for THIS kind of card, then the shared arrange/z-order
// actions, then who added it. An image gets Replace/Download, a file gets
// Download and Copy link to file, a frame gets Select contents, a to-do
// gets Tick all — the generic menu had none of that.
function _boardsCardCtxItems(canEdit){
  const sel=_boardsSelectedCards();
  const one=sel.length===1?sel[0]:null;
  const items=[];
  if(sel.length>1)items.push({title:sel.length+' cards selected'});

  if(canEdit){
    items.push({act:'cut',label:'Cut',hint:'Ctrl X'});
    items.push({act:'copy',label:'Copy',hint:'Ctrl C'});
    items.push({act:'dup',label:'Duplicate',hint:'Ctrl D'});
    items.push({act:'delete',label:'Delete',hint:'Del',danger:true});
  }

  // ── type-specific ──
  const typed=[];
  if(one&&canEdit&&one.type!=='frame'&&one.type!=='heading'){
    typed.push({act:'rename',label:one.name?'Rename card':'Name this card',hint:'F2'});
  }
  if(one){
    if(one.type==='image'&&one.imageUrl){
      if(canEdit)typed.push({act:'caption',label:one.caption==null?'Add a caption':'Edit caption'});
      if(canEdit)typed.push({act:'replace',label:'Replace image'});
      typed.push({act:'download',label:'Download image'});
      typed.push({act:'openasset',label:'Open original'});
    }else if(one.type==='image'&&canEdit){
      typed.push({act:'replace',label:'Add an image…'});
    }else if(one.type==='file'&&one.fileUrl){
      if(canEdit)typed.push({act:'caption',label:one.caption==null?'Add a caption':'Edit caption'});
      if(canEdit)typed.push({act:'replace',label:'Replace file'});
      typed.push({act:'download',label:'Download'});
      typed.push({act:'openasset',label:'Open file'});
      typed.push({act:'copyasset',label:'Copy link to file'});
    }else if(one.type==='file'&&canEdit){
      typed.push({act:'replace',label:'Choose a file…'});
    }else if(one.type==='link'&&one.linkUrl){
      typed.push({act:'openasset',label:'Open link'});
      typed.push({act:'copyasset',label:'Copy URL'});
    }else if(one.type==='board'&&one.boardId){
      typed.push({act:'open-board',label:'Open this board'});
      typed.push({act:'copyasset',label:'Copy link to board'});
    }else if(one.type==='frame'){
      if(canEdit)typed.push({act:'rename',label:'Rename frame',hint:'Return'});
      typed.push({act:'selectinside',label:'Select contents'});
    }else if(one.type==='todo'&&canEdit){
      typed.push({act:'tickall',label:'Tick all'});
      typed.push({act:'untickall',label:'Untick all'});
    }else if(one.type==='text'&&one.text){
      typed.push({act:'copytext',label:'Copy text'});
    }
  }
  if(typed.length){items.push({sep:true});typed.forEach(t=>items.push(t));}

  items.push({sep:true});
  items.push({act:'card-comment',label:'Comment'});
  if(one)items.push({act:'card-link',label:'Copy link to card'});

  if(canEdit){
    items.push({sep:true});
    if(sel.length>1){
      items.push({act:'stack',label:'Stack into a column'});
      items.push({act:'grid',label:'Arrange in a grid'});
      items.push({act:'wrapframe',label:'Wrap in a frame'});
      items.push({sep:true});
    }
    items.push({act:'lock',label:sel.some(c=>c.locked)?'Unlock position':'Lock position'});
    items.push({act:'front',label:'Bring to front'});
    items.push({act:'back',label:'Send to back'});
    items.push({swatches:true});
  }
  // Provenance, when the card carries it (added Sept 2026 — older cards
  // don't, and the line is simply omitted rather than faked).
  if(one&&one.by){
    items.push({sep:true});
    items.push({title:'Added by '+one.by+(one.at?' · '+_boardsRelTime(one.at):'')});
  }
  return items;
}
function _boardsWireContextMenu(stage){
  stage.addEventListener('contextmenu',e=>{
    // Editing text? The browser's menu is the right one.
    if(_boardsIsEditableFocus())return;
    const t=e.target;
    if(t&&t.closest&&t.closest('input,textarea,[contenteditable="true"]'))return;
    const canEdit=_boardsCanEdit(_editBoard);
    e.preventDefault();
    _boardsCtxWorld=_boardsScreenToWorld(e.clientX,e.clientY);

    const line=t&&t.closest&&t.closest('line[data-conn]');
    if(line&&canEdit){
      _boardsOpenCtx(e.clientX,e.clientY,[{act:'conn:'+line.getAttribute('data-conn'),label:'Delete line',danger:true}]);
      return;
    }
    const cardEl=t&&t.closest&&t.closest('.board-card-el,.board-frame');
    if(cardEl){
      const id=cardEl.getAttribute('data-id');
      // Keep an existing multi-selection; otherwise select just this card.
      if(id&&!_boardsSelection.has(id))_boardsSetSelection([id]);
      _boardsOpenCtx(e.clientX,e.clientY,_boardsCardCtxItems(canEdit));
      return;
    }
    _boardsOpenCtx(e.clientX,e.clientY,_boardsCanvasCtxItems(canEdit));
  });
}
// Registered once at load — the stage DOM is replaced on every render, but
// these live on document, so they must not be re-added per render.
document.addEventListener('pointerdown',e=>{
  const el=document.getElementById(_BOARDS_CTX_ID);
  if(el&&!(e.target&&e.target.closest&&e.target.closest('#'+_BOARDS_CTX_ID)))_boardsCloseCtx();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')_boardsCloseCtx();});
window.addEventListener('blur',_boardsCloseCtx);

/* ── Right-click on the GALLERY (Sept 2026) ─────────────────────────────
   The canvas had a context menu but the boards list didn't, so the one
   place you actually manage boards still gave you Chrome's menu. Rename
   lives here in particular: it was previously only reachable by opening a
   board and clicking its title, which is why a gallery full of "Untitled
   board" was so easy to end up with.

   Separate router from _boardsCtxRun because these act on a board BY ID,
   not on the open canvas — but the same menu renderer, so the two look
   and behave identically. */
function _boardsGalleryCtxItems(b){
  const canEdit=_boardsCanEdit(b);
  const owner=!!(session&&(b.ownerUid===session.uid||session.role==='owner'));
  const items=[{act:'g:open',label:'Open'}];
  if(canEdit)items.push({act:'g:rename',label:'Rename…',hint:'F2'});
  items.push({sep:true});
  items.push({act:'g:link',label:'Copy link to board'});
  items.push({act:'g:dup',label:'Duplicate'});
  if(canEdit){
    items.push({act:'g:template',label:b.isTemplate?'Remove from templates':'Save as template'});
    items.push({act:'g:vis',label:'Make '+(b.visibility==='shared'?'Private':'Team')});
  }
  if(owner){
    items.push({sep:true});
    items.push({act:'g:trash',label:'Move to Trash',danger:true});
  }
  items.push({sep:true});
  const n=(b.cards||[]).length;
  items.push({title:(b.visibility==='shared'?'TEAM':'PRIVATE')+' · '+n+' card'+(n===1?'':'s')+(b.ownerName?' · '+b.ownerName:'')});
  return items;
}
async function _boardsGalleryCtxRun(act,id){
  const b=moodBoards.find(x=>x.id===id)||_boardsTrash.find(x=>x.id===id);
  switch(act){
    case'g:new:shared':window.boardsCreate('shared');return;
    case'g:new:personal':window.boardsCreate('personal');return;
    case'g:refresh':window.boardsRetryLoad();return;
    case'g:restore':window.boardsRestore(id);return;
    case'g:purge':window.boardsDeleteForever(id);return;
  }
  if(!b)return;
  switch(act){
    case'g:open':window.boardsOpen(id);break;
    case'g:link':{
      const link=_boardsLinkFor(id,null);
      const ok=await _boardsCopyText(link);
      showToast(ok?'Board link copied':link,!ok);
      break;
    }
    case'g:rename':{
      if(!_boardsCanEdit(b))return;
      const next=prompt('Rename board',b.title||'Untitled board');
      if(next==null)return;
      const title=String(next).trim()||'Untitled board';
      if(title===b.title)return;
      try{
        await _qUpdate(doc(db,'mood_boards',id),{title,updatedAt:Date.now(),updatedByName:session.name});
        b.title=title;
        _boardsRerenderGallery();
        showToast('Renamed');
      }catch(e){showToast('Could not rename: '+(e.message||e),true);}
      break;
    }
    case'g:dup':{
      try{
        await _boardsDuplicateBoard(b,{isTemplate:false},false);
        await window.boardsRetryLoad();
        showToast('Board duplicated');
      }catch(e){showToast('Could not duplicate: '+(e.message||e),true);}
      break;
    }
    case'g:template':{
      if(!_boardsCanEdit(b))return;
      const next=!b.isTemplate;
      try{
        await _qUpdate(doc(db,'mood_boards',id),{isTemplate:next,updatedAt:Date.now()});
        b.isTemplate=next;
        _boardsRerenderGallery();
        showToast(next?'Saved as a template':'No longer a template');
      }catch(e){showToast('Could not update: '+(e.message||e),true);}
      break;
    }
    case'g:vis':{
      if(!_boardsCanEdit(b))return;
      const next=b.visibility==='shared'?'personal':'shared';
      try{
        await _qUpdate(doc(db,'mood_boards',id),{visibility:next,updatedAt:Date.now()});
        b.visibility=next;
        _boardsRerenderGallery();
        showToast('Now '+(next==='shared'?'TEAM':'PRIVATE'));
      }catch(e){showToast('Could not update: '+(e.message||e),true);}
      break;
    }
    case'g:trash':{
      if(!confirm('Move "'+(b.title||'Untitled board')+'" to Trash? You can restore it from this list.'))return;
      try{
        await _qUpdate(doc(db,'mood_boards',id),{deletedAt:Date.now(),deletedByName:session.name,updatedAt:Date.now()});
        logActivity('Mood board deleted',`${session.name} moved "${b.title||'Untitled board'}" to trash`);
        await window.boardsRetryLoad();
        showToast('Board moved to Trash');
      }catch(e){showToast('Could not delete: '+(e.message||e),true);}
      break;
    }
    default:break;
  }
}
// Ask the browser to stop evicting our IndexedDB. Firestore's offline queue
// and its whole local cache live there, so eviction means unsynced writes
// disappear. Nothing in the app asked for this before; it is one call and
// it is refused silently where unsupported.
if(typeof navigator!=='undefined'&&navigator.storage&&navigator.storage.persist){
  navigator.storage.persisted().then(ok=>{if(!ok)return navigator.storage.persist();}).catch(()=>{});
}

// Registered once at load, like the canvas menu's dismiss handlers.
document.addEventListener('contextmenu',e=>{
  if(currentPage!=='boards')return;
  const t=e.target;
  if(!t||!t.closest)return;
  if(t.closest('input,textarea,select,[contenteditable="true"]'))return;   // the browser's menu belongs to fields
  const main=t.closest('#main-content');
  if(!main)return;
  const trashRow=t.closest('[data-trash]');
  if(trashRow){
    e.preventDefault();
    const id=trashRow.getAttribute('data-trash');
    _boardsOpenCtx(e.clientX,e.clientY,[
      {act:'g:restore',label:'Restore'},
      {act:'g:purge',label:'Delete forever',danger:true}
    ],id);
    return;
  }
  const card=t.closest('[data-board]');
  if(card){
    const id=card.getAttribute('data-board');
    const b=moodBoards.find(x=>x.id===id);
    if(!b)return;
    e.preventDefault();
    _boardsOpenCtx(e.clientX,e.clientY,_boardsGalleryCtxItems(b),id);
    return;
  }
  e.preventDefault();
  _boardsOpenCtx(e.clientX,e.clientY,[
    {act:'g:new:shared',label:'New team board'},
    {act:'g:new:personal',label:'New private board'},
    {sep:true},
    {act:'g:refresh',label:'Refresh list'}
  ],null);
});

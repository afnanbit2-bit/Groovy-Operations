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
// The Unsorted tray (Sept 2026). Milanote's holding pen: things you have
// collected but not placed yet. Per BOARD, stored as a plain array field on
// the board document exactly like `cards` — same reasoning as everywhere
// else in this file, no subcollection at this app's scale.
let _editUnsorted=[];
const _BOARDS_TRAY_KEY='groovy-boards-tray';   // open/closed is per VIEWER, not board data
// On HOME the same panel grows a second tab: every board you can see,
// searchable, filterable by Team/Private, and draggable onto the canvas.
let _boardsSaveTimer=null;
let _boardsCardSeq=0;
let _boardsSelection=new Set(); // card ids currently selected (Stage 2: many, not one)
let _boardsClipboard=[];        // in-session card clipboard, survives moving between boards
let _boardsAddCascade=0;      // so repeated "+ Card" clicks don't stack perfectly
let _boardsDragDepth=0;       // dragenter/dragleave fire per child; count to know when we really left
let _boardsInternalDrag=false;// a native drag that started inside the board, not a file arriving from the desktop

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
let _boardsViewOpen=false;          // the "View" dropdown beside it
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
// A SEPARATE tag rather than a shape change to the card payload — an older
// build in another tab still reads the card one, and a line pasted into it
// is ignored instead of arriving as a malformed card.
const _BOARDS_CLIP_LINE_PREFIX='groovy-board-lines:';
// Snap preference is a per-viewer convenience, not board data — localStorage
// is the right home for it (it should not travel with the board to someone
// else's screen).
let _boardsSnapGrid=(function(){try{return localStorage.getItem('groovy-boards-snap')==='1';}catch(e){return false;}})();
let _boardsLineMode=false;      // while on, dragging empty canvas draws an arrow instead of panning

/* The zoom floor is 25%, and that REVERSES the Milanote-parity round which
   took it 10% → 5% to match their own. Afnan, with a screenshot at 26%:
   "zoom problem not fix yet, lock zoom out at 25%". Below that a card is a
   smudge — the level-of-detail rules already strip every piece of chrome
   under 35% precisely because none of it is legible there, and past a point
   the picture goes too. A floor you cannot read past is not a feature.
   Milanote can afford 5% on a 398-card board; ours are tens of cards, where
   Fit already brings the whole board on screen well above this. */
const _BOARDS_ZOOM_MIN=0.25;
/* HOME HAS ITS OWN, HIGHER FLOOR (Sept 2026 — Afnan: "on home max zoom out
   is 40%"). Home holds board cards and nothing else, and a board card is
   something you READ — its picture, its name, its count. An ordinary board
   holds tech packs and photographs you legitimately want to see all of at
   once, which is what 25% is for; zooming a list of boards out past
   legibility answers no question at all. It also puts Home entirely inside
   the `mid` level-of-detail band (35–70%), so a board card on Home is never
   drawn in the `far` bucket that strips its chrome. */
const _BOARDS_HOME_ZOOM_MIN=0.40;
const _BOARDS_ZOOM_MAX=3;
function _boardsZoomFloor(){
  return _boardsIsHome(_editBoard)?_BOARDS_HOME_ZOOM_MIN:_BOARDS_ZOOM_MIN;
}
/**
 * THE one place the range is enforced. Every zoom entry point runs through
 * it, including the board OPEN path — a board saved at 19% before this
 * shipped would otherwise come back below the floor and stay there, with
 * nothing on screen to say why zooming out did nothing. That open path is
 * what carries a Home saved at 25% up to 40% too, with no migration.
 */
function _boardsClampZoom(z){
  const n=Number(z);
  if(!isFinite(n)||n<=0)return 1;
  return Math.max(_boardsZoomFloor(),Math.min(_BOARDS_ZOOM_MAX,n));
}
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
// A file card with no thumbnail is a name row and two buttons, so it stays
// compact. A PDF is not: see _boardsFitPdfCard.
const _BOARDS_FILE_W=200,_BOARDS_FILE_H=110;
// The size an image card is born at, before its picture has landed.
const _BOARDS_IMG_W=170,_BOARDS_IMG_H=120;
// The size a BOARD card is born at, wherever it is minted — the rail, the
// sub-board action, Home's auto-place, the Boards panel. It used to be two
// different numbers (200x104 from _boardsNewCard, 260x172 on Home), so the
// same card was a different shape depending on how you made it. Afnan drew
// the shape he wanted on a screenshot: a wide rectangle. MEASURED rather
// than guessed at (headless Chromium, the real markup and the real
// stylesheet): the tallest a spine card's content ever gets at this width
// is 133px - a two-line name, the meta line and a thumbnail strip - so 136
// fits the worst case with nothing clipped. See _BOARDS_MIN_BODY_H.board.
const _BOARDS_BOARD_W=340,_BOARDS_BOARD_H=136;
// A note's birth size, named so the rail's drag ghost (drawn as the card
// it will become, at the board's zoom) cannot drift from what lands. The
// height is _boardsNewCard's default for a type it does not size itself.
const _BOARDS_NOTE_W=220,_BOARDS_NOTE_H=100;
function _boardsNewCard(type){
  const id='c'+(++_boardsCardSeq)+'_'+Date.now()+'_'+Math.floor(Math.random()*1e4);
  const w=type==='frame'?440:type==='column'?280:type==='table'?360:type==='heading'?440:type==='text'?_BOARDS_NOTE_W:type==='todo'?240:type==='file'?_BOARDS_FILE_W:type==='board'?_BOARDS_BOARD_W:type==='image'?_BOARDS_IMG_W:type==='link'?_BOARDS_LINK_W:170;
  const h=type==='frame'?320:type==='column'?160:type==='table'?200:type==='heading'?58:type==='image'?_BOARDS_IMG_H:type==='link'?_BOARDS_LINK_H:type==='file'?_BOARDS_FILE_H:type==='todo'?170:type==='board'?_BOARDS_BOARD_H:100;
  const base={id,type,x:80,y:80,w,h};
  if(type==='image')base.imageUrl='';
  if(type==='text')base.text='';
  if(type==='link'){base.linkUrl='';base.linkTitle='';base.linkDesc='';}
  if(type==='file'){base.fileUrl='';base.fileName='';base.fileSize=0;}
  if(type==='frame')base.title='';
  if(type==='column')base.title='';
  // A table starts with a header row and one body row — an empty grid with
  // no header reads as a broken card, and adding the header afterwards is
  // the one thing nobody thinks to look for.
  if(type==='table'){
    base.rows=[['','',''],['','',''],['','',''],['','','']];
    base.head=false;
  }
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
// Frames paint first (behind their contents), then COLUMNS — a column has
// to sit behind the cards it holds for the same reason, and behind nothing
// else. Everything after that keeps its array order, which is the z-order
// "bring to front" reorders (Stage 2).
function _boardsRenderOrder(){
  const rank=c=>c.type==='frame'?0:c.type==='column'?1:2;
  return _editCards.filter(c=>rank(c)===0)
    .concat(_editCards.filter(c=>rank(c)===1))
    .concat(_editCards.filter(c=>rank(c)===2));
}

/* ── Columns: the one REAL container ────────────────────────────────────
   This reverses the Stage 3 decision recorded in CLAUDE.md, deliberately.
   Frames are membership-free because geometry is enough to answer "what is
   inside this box". A column has to do something geometry cannot: it OWNS
   an order and positions its children from it. So membership is stored.

   WHERE it is stored is the part that matters. The obvious choice — an
   `items:[cardId,…]` array on the column — loses cards under the Stage 6
   merge: that merge is per CARD, so two people each adding to the same
   column both rewrite the column's array and the later write wins,
   silently dropping the other's insert. Instead each CHILD carries
   `columnId`, so every insert is a change to a different card and the
   merge keeps both.

   ORDER is then derived from the child's own `y`, which the layout writes
   — no second field to keep in step, and no fractional-index scheme. Ties
   break on card id so two cards that land on the same y after a merge
   still order deterministically on every screen.

   A `columnId` pointing at a column that no longer exists is INERT: the
   card renders as an ordinary free card. Nothing has to be reconciled on
   read, and no failed write can strand a card inside an invisible box. */
const _BOARDS_COL_PAD=12,_BOARDS_COL_HEAD=30,_BOARDS_COL_GAP=10,_BOARDS_COL_MIN_H=120;
function _boardsIsColumn(c){return!!(c&&c.type==='column');}
// The column a card belongs to, or null — including when columnId is stale.
function _boardsColumnOf(c){
  if(!c||!c.columnId)return null;
  const col=_editCards.find(x=>x.id===c.columnId&&x.type==='column');
  return col||null;
}
function _boardsColumnChildren(col){
  if(!col)return[];
  return _editCards.filter(c=>c.columnId===col.id&&c.id!==col.id)
    .sort((a,b)=>(a.y-b.y)||(a.id<b.id?-1:a.id>b.id?1:0));
}
// Lays a column out and reports whether anything actually moved. Idempotent
// BY DESIGN: opening a board must not mark every card as locally changed
// (see _boardsLocalChanges) and trigger a write for a layout that is
// already correct.
function _boardsLayoutColumn(col){
  if(!_boardsIsColumn(col))return false;
  const kids=_boardsColumnChildren(col);
  const innerW=Math.max(60,col.w-_BOARDS_COL_PAD*2);
  let y=col.y+_BOARDS_COL_HEAD+_BOARDS_COL_PAD;
  let changed=false;
  kids.forEach(k=>{
    const nx=col.x+_BOARDS_COL_PAD;
    if(k.x!==nx){k.x=nx;changed=true;}
    if(k.y!==y){k.y=y;changed=true;}
    if(k.w!==innerW){k.w=innerW;changed=true;}
    y+=k.h+_BOARDS_COL_GAP;
  });
  const h=Math.max(_BOARDS_COL_MIN_H,
    (kids.length?y-_BOARDS_COL_GAP:col.y+_BOARDS_COL_HEAD+_BOARDS_COL_PAD)-col.y+_BOARDS_COL_PAD);
  if(col.h!==h){col.h=h;changed=true;}
  return changed;
}
function _boardsLayoutColumns(){
  let changed=false;
  _editCards.filter(_boardsIsColumn).forEach(col=>{if(_boardsLayoutColumn(col))changed=true;});
  return changed;
}
// The column under a world point, topmost first (later in the array paints
// on top). `skip` holds ids that must not match — a column being dragged
// cannot be its own drop target.
function _boardsColumnAt(wx,wy,skip){
  const cols=_editCards.filter(_boardsIsColumn);
  for(let i=cols.length-1;i>=0;i--){
    const col=cols[i];
    if(skip&&skip.has(col.id))continue;
    if(col.locked)continue;
    if(wx>=col.x&&wx<=col.x+col.w&&wy>=col.y&&wy<=col.y+col.h)return col;
  }
  return null;
}
// Where a card dropped at world-y `wy` would land, and the y that puts it
// there. Returning a y (rather than an index) is what lets the drop reuse
// the ordinary "sort children by y" rule with no special-casing.
function _boardsColumnSlot(col,wy,movingId){
  const kids=_boardsColumnChildren(col).filter(k=>k.id!==movingId);
  let i=0;
  for(;i<kids.length;i++){
    if(wy<kids[i].y+kids[i].h/2)break;
  }
  const before=kids[i-1],after=kids[i];
  const y=after?(before?(before.y+before.h+after.y)/2:after.y-1)
               :(before?before.y+before.h+1:col.y+_BOARDS_COL_HEAD+_BOARDS_COL_PAD);
  return{index:i,y,top:after?after.y-_BOARDS_COL_GAP/2:(before?before.y+before.h+_BOARDS_COL_GAP/2:col.y+_BOARDS_COL_HEAD+_BOARDS_COL_PAD)};
}
// What each dragged card would join if the gesture ended now. Columns and
// frames are never themselves children — a container inside a container is
// a second layout model, and one is enough.
function _boardsDropTargets(group,movingCols){
  return group.filter(c=>{
    if(c.type==='column'||c.type==='frame')return false;
    // A child travelling WITH its own column (the column was grabbed, or a
    // frame around it was) has not been dragged anywhere relative to it.
    // Without this it would look like a drop onto empty canvas — its
    // column is in movingCols and therefore not a valid target — and every
    // card would fall out of the column the moment the column was moved.
    if(c.columnId&&movingCols&&movingCols.has(c.columnId))return false;
    return true;
  }).map(card=>{
    const col=_boardsColumnAt(card.x+card.w/2,card.y+card.h/2,movingCols);
    return{card,col,slot:col?_boardsColumnSlot(col,card.y+card.h/2,card.id):null};
  });
}
// One line showing where the card will land. Lives inside .board-world, so
// it is positioned in world coordinates and needs no pan/zoom maths — the
// same trick the connector layer and the alignment guides use.
function _boardsShowColumnDrop(drops){
  const el=document.getElementById('board-col-drop');
  if(!el)return;
  const hit=drops.find(d=>d.col);
  document.querySelectorAll('.board-column.drop-into').forEach(n=>n.classList.remove('drop-into'));
  if(!hit){el.style.display='none';return;}
  const host=document.getElementById('board-card-'+hit.col.id);
  if(host)host.classList.add('drop-into');
  el.style.display='block';
  el.style.left=(hit.col.x+_BOARDS_COL_PAD)+'px';
  el.style.top=hit.slot.top+'px';
  el.style.width=Math.max(20,hit.col.w-_BOARDS_COL_PAD*2)+'px';
}
// Push a column's computed geometry (and its children's) straight into the
// DOM. Same reasoning as the drag path: structural changes rebuild, pure
// movement writes styles.
function _boardsPaintColumnGeometry(col){
  if(!col)return;
  const paint=c=>{
    const el=document.getElementById('board-card-'+c.id);
    if(!el)return;
    el.style.left=c.x+'px';el.style.top=c.y+'px';
    el.style.width=c.w+'px';el.style.height=c.h+'px';
    _boardsUpdateConnectorsFor(c.id);
  };
  paint(col);
  _boardsColumnChildren(col).forEach(paint);
}
function _boardsHideColumnDrop(){
  const el=document.getElementById('board-col-drop');
  if(el)el.style.display='none';
  document.querySelectorAll('.board-column.drop-into').forEach(n=>n.classList.remove('drop-into'));
}
// Detaching is a plain field delete, never a write to the column.
function _boardsLeaveColumn(c){if(c&&c.columnId!=null)delete c.columnId;}
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
// ── Home is a board ────────────────────────────────────────────────────
// Milanote has no separate "list of your boards" page: home IS a board,
// and your boards are cards on it that you arrange like anything else.
// This is that, with one deliberate difference — the flat gallery stays,
// moved to its own page (`boards-all`) and reachable from Home's ⋯ menu.
//
// That is not timidity, it is the safety net Stage 4 already insisted on:
// "there is no way to lose a board by deleting a card". A board is
// discoverable by QUERY (loadBoardsData reads every board you can see),
// never only by a link, so no failed write, no deleted card and no broken
// Home can strand one. Milanote can rely on the tree because its tree is
// the only truth; ours has a query behind it, and throwing that away to
// copy the interface would be copying the wrong half.
//
// One Home per person: an ordinary mood_boards document carrying
// isHome:true, private, owned by them. No rules change — it is already
// covered by the ownerUid clause every personal board uses.
function _boardsIsHome(b){return!!(b&&b.isHome);}
function _boardsMyHome(){
  if(typeof session==='undefined'||!session||!session.uid)return null;
  // Two tabs opening Home for the first time at the same moment could each
  // create one. Pick deterministically rather than leaving it to whichever
  // sorted first, so both tabs agree and the loser is simply an empty board.
  const mine=moodBoards.filter(b=>b.isHome&&b.ownerUid===session.uid);
  if(!mine.length)return null;
  return mine.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0))[0];
}
async function _boardsHomeId(){
  const mine=_boardsMyHome();
  if(mine)return mine.id;
  return await _boardsCreateDoc({title:'Home',visibility:'personal',isHome:true});
}
// Every board you can see that isn't already somewhere gets a card on Home.
// Runs on open, and again when a cold deep-link load finally lands.
//
// Placement is SAVED rather than derived each time, so it is a one-time
// migration per board and Home is an ordinary board afterwards — move a
// card and it stays moved. A board nested under a real parent is skipped;
// a board sitting on someone's Home is NOT "nested" (see _boardsNestedIds,
// which only ever follows a real parentId), so it still lists at root in
// All boards and still reaches every other person's Home.
/* A board card is a SPINE CARD (Sept 2026 — Afnan picked option D from the
   specimen, after living with option A's cover tile for a day: "i like D
   spine its perfect").

   It was 200x124 of grey chrome: a type label, a truncated title, a count
   and a button, identical for every board. A took the other extreme — the
   picture full bleed with the name on a scrim over it — and the thing it
   could not do is say what is INSIDE. D is the most a card can say at
   once: the board's colour (or its picture) as a spine down the left, the
   WHOLE name on two lines, the state and the counts, and a strip of the
   board's own thumbnails.

   The SIZE moved again in Sept 2026, at Afnan's request and with the shape
   drawn on a screenshot: a board card is born a wide rectangle now, and
   it is the same rectangle wherever it is minted - see _BOARDS_BOARD_W. */
const _BOARDS_HOME_COLS=4,_BOARDS_HOME_W=_BOARDS_BOARD_W,_BOARDS_HOME_H=_BOARDS_BOARD_H;
// Afnan's own line, kept. It is chrome, so no emoji (the module's rule)
// and it is a literal rather than a card's data, so it is safe in the
// template; every string that comes off a BOARD still goes through
// _boardsEsc or textContent.
const _BOARDS_OPEN_PHRASE='Double-click to open your mind';
// Two devices opening Home for the first time at the same moment each place
// the same board, and the Stage 6 merge keeps both — they are different
// cards with different ids, so nothing can tell it is one board twice.
// Cheaper to heal it on open than to coordinate: keep the first card for
// each board and drop the rest. Only ever collapses exact duplicates.
function _boardsHomeDedupe(){
  if(!_boardsIsHome(_editBoard))return 0;
  const seen=new Set();const drop=[];
  _editCards.forEach(c=>{
    if(c.type!=='board'||!c.boardId)return;
    if(seen.has(c.boardId))drop.push(c.id);else seen.add(c.boardId);
  });
  if(!drop.length)return 0;
  const gone=new Set(drop);
  _editCards=_editCards.filter(c=>!gone.has(c.id));
  _editConnectors=_editConnectors.filter(cn=>!gone.has(cn.from)&&!gone.has(cn.to));
  return drop.length;
}
// A board moved to Trash shouldn't leave a dead card sitting on Home.
// Prunes ONLY boards positively known to be trashed — never a board that is
// merely absent from moodBoards, because a partial load (one of the three
// queries failing, see loadBoardsData) would otherwise wipe Home.
function _boardsHomePruneTrashed(){
  if(!_boardsIsHome(_editBoard)||!boardsLoaded)return 0;
  const trashed=new Set(_boardsTrash.map(b=>b.id));
  if(!trashed.size)return 0;
  const drop=_editCards.filter(c=>c.type==='board'&&c.boardId&&trashed.has(c.boardId)).map(c=>c.id);
  if(!drop.length)return 0;
  const gone=new Set(drop);
  _editCards=_editCards.filter(c=>!gone.has(c.id));
  _editConnectors=_editConnectors.filter(cn=>!gone.has(cn.from)&&!gone.has(cn.to));
  return drop.length;
}
// Places every board that isn't on Home yet, in one go.
//
// This used to run automatically on every open, and it no longer does —
// see _boardsHomeSync below for why. It is an explicit action now ("Place
// all" in the Boards panel), which also settles the awkwardness the old
// comment here recorded: an automatic arrangement could not be undoable
// (Ctrl+Z would clear cards that reappeared on the next visit), whereas a
// button you pressed is ordinary editing. The caller pushes the undo entry.
function _boardsHomeAutoPlace(){
  if(!_boardsIsHome(_editBoard)||!boardsLoaded)return 0;
  const have=new Set(_editCards.filter(c=>c.type==='board'&&c.boardId).map(c=>c.boardId));
  const nested=_boardsNestedIds();
  const missing=moodBoards.filter(b=>
    !b.isHome&&b.id!==_editBoard.id&&!nested.has(b.id)&&!have.has(b.id));
  if(!missing.length)return 0;
  // Below whatever is already here, so a Home somebody has arranged is
  // never rearranged by a board arriving later.
  let y0=60;
  _editCards.forEach(c=>{y0=Math.max(y0,c.y+c.h+40);});
  missing.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  missing.forEach((b,i)=>{
    const nc=_boardsNewCard('board');
    nc.boardId=b.id;nc.boardTitle=b.title||'Untitled board';
    nc.w=_BOARDS_HOME_W;nc.h=_BOARDS_HOME_H;
    nc.x=60+(i%_BOARDS_HOME_COLS)*(_BOARDS_HOME_W+28);
    nc.y=y0+Math.floor(i/_BOARDS_HOME_COLS)*(_BOARDS_HOME_H+28);
    _editCards.push(nc);
  });
  return missing.length;
}
// Everything Home reconciles on open, in the order that matters: collapse
// duplicates first (so a duplicate isn't counted as "already placed"), then
// drop cards for trashed boards.
//
// AUTO-PLACE IS DELIBERATELY NOT PART OF THIS ANY MORE (Sept 2026). It used
// to be, and it had to stop the moment Home grew a Boards panel, because
// the two answer the same question and would have fought:
//
//   - Afnan asked for removing a board's card from Home to put that board
//     back in the list. With auto-place on open, it came straight back on
//     the next visit — which is exactly why boardsDeleteCard used to trash
//     the whole BOARD on Home rather than offer something that undid itself.
//   - Nothing is lost by not placing. The panel is derived from the same
//     query the gallery reads (_boardsHomeList), so a board that is on
//     nobody's Home is still one search away, and All boards still lists it.
//     That is the Stage 4 safety net, untouched: a board is discoverable by
//     QUERY, never only by a link.
//
// So Home is arranged by hand, "Place all" is one button in the panel, and
// a board you take off Home stays off it.
function _boardsHomeSync(){
  return _boardsHomeDedupe()+_boardsHomePruneTrashed();
}
// A brand-new Home is an empty canvas, and now that boards are not placed
// for you there is nothing on it saying where they went. Un-collapse the
// panel — but ONLY when Home is completely empty, so it never overrides the
// preference of anyone who has arranged theirs, and deliberately WITHOUT
// persisting (the field, not _boardsSetHomePanel): it is a first-run nudge,
// not a setting.
function _boardsHomeFirstRun(){
  if(!_boardsIsHome(_editBoard)||!boardsLoaded)return false;
  if(_editCards.length||!_boardsHomeList().length)return false;
  _boardsHomePanelCollapsed=false;
  return true;
}
// The `boards` page is Home now. Renders the gallery instead — unchanged,
// under the same page id it always had — if Home cannot be reached, so a
// denied read or a failed create never leaves anyone without navigation.
window.boardsOpenHome=async function(){
  const m=document.getElementById('main-content');
  if(!boardsLoaded){
    if(m)m.innerHTML=gvSkeleton(4);
    try{await loadBoardsData();}catch(e){}
  }
  if(currentPage!=='boards')return;
  if(_boardsLoadError){if(m)m.innerHTML=renderBoardsGallery();return;}
  try{
    // Creating Home the first time is a network write; without this the
    // previous page stays on screen for its duration and the app looks
    // stuck on whatever you just left.
    if(!_boardsMyHome()&&m)m.innerHTML=gvSkeleton(4);
    const id=await _boardsHomeId();
    if(currentPage!=='boards')return;
    _boardsCameFromAll=false;
    window.boardsOpen(id);
  }catch(e){
    console.warn('[boards] could not open Home:',e&&(e.message||e));
    if(currentPage==='boards'&&m){
      m.innerHTML='<div class="notes-warn">Could not open Home ('+_boardsEsc(String(e&&(e.message||e)))+') — showing all boards instead.</div>'+renderBoardsGallery();
    }
  }
};
// Which way "back" goes from a root board: Home normally, All boards if
// that is where you came from. Without it, opening a board from the list
// and pressing back would drop you somewhere you have never been.
let _boardsCameFromAll=false;
window.boardsOpenFromAll=function(id){_boardsCameFromAll=true;window.boardsOpen(id);};
window.boardsShowAll=function(){
  _boardsMenuOpen=false;_boardsSyncMenu();
  if(_editBoard)_boardsSaveNow();
  window.showPage('boards-all');
};
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
  if(Array.isArray(c.rows))c.rows.forEach(r=>{if(Array.isArray(r))r.forEach(v=>{
    const raw=_boardsCellVal(v);if(raw)parts.push(raw);
    const shown=_boardsCellDisplay(v,c);if(shown&&shown!==raw)parts.push(shown);
  });});
  if(Array.isArray(c.labels))c.labels.forEach(l=>{if(l&&l.t)parts.push(l.t);});
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
// ── Click selects, double-click edits (Sept 2026) ────────────────────────
// Card bodies used to be contenteditable the whole time, so a single click
// dropped a caret in and the card could only be moved by its header strip.
// Afnan asked for Milanote's model: one click selects and drags, a double
// click opens the text. So `contenteditable` is now "false" in the markup
// and is turned on for exactly one element at a time, here.
//
// Only ONE element is ever editable, which is what makes the rest simple:
// _boardsIsEditableFocus (and therefore every keyboard shortcut) keeps
// working unchanged, and boardsCardDragStart has one thing to check.
let _boardsEditingEl=null;
// The FOCUSED table cell, which is deliberately independent of
// _boardsEditingEl: the rail's cell toolbar has to stay up while you use
// it, and every rail action re-renders the canvas (destroying the DOM the
// caret lived in). Focus is data, so it survives that; edit mode does not
// have to. Cleared when the selection changes, on Escape, and whenever the
// coordinates stop pointing at a real cell.
let _boardsCellFocus=null;   // {id,r,i}
window.boardsBeginEdit=function(ev,elId){
  if(!_editBoard||!_boardsCanEdit(_editBoard))return;
  const el=document.getElementById(elId);
  if(!el)return;
  const host=el.closest?el.closest('.board-card-el,.board-frame'):null;
  const id=host&&host.dataset?host.dataset.id:null;
  const c=id?_editCards.find(x=>x.id===id):null;
  if(c&&c.locked){showToast('Card is locked — unlock it to edit it');return;}
  if(ev){ev.stopPropagation();ev.preventDefault();}
  if(_boardsEditingEl&&_boardsEditingEl!==el)_boardsEndEdit();
  el.setAttribute('contenteditable','true');
  _boardsEditingEl=el;
  el.focus();
  // The rail's mode depends on this — a note in edit mode gets the text
  // rail (desktop). focusin shows the bar on a phone.
  if(_boardsIsRichField(el)&&!_boardsIsPhone()){_boardsFmtTarget=el;_boardsRenderRail();}
  // Put the caret where the double-click actually landed rather than at the
  // start of the text — anything else feels broken on a long note.
  try{
    if(ev&&document.caretRangeFromPoint){
      const r=document.caretRangeFromPoint(ev.clientX,ev.clientY);
      if(r){const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);}
    }else if(!ev){
      // Opened programmatically (a brand-new note or to-do item): caret at
      // the end, which for an empty element is the only sensible place.
      const sel=window.getSelection(),r=document.createRange();
      r.selectNodeContents(el);r.collapse(false);
      sel.removeAllRanges();sel.addRange(r);
    }
  }catch(e){}
};
function _boardsEndEdit(){
  const el=_boardsEditingEl;
  _boardsEditingEl=null;
  if(!el)return;
  try{
    el.setAttribute('contenteditable','false');
    if(document.activeElement===el)el.blur();
  }catch(e){}
  // Leaving a table cell swaps the raw text back for the formatted one.
  // Repainting the ONE cell rather than the whole canvas: this fires on
  // every click away from a cell, and rebuilding every card and connector
  // on a 46-card board to reformat one number would be absurd.
  _boardsRepaintCell(el);
  // A formula reads other cells, so editing one of them changes an answer
  // somewhere else in the same table. Nothing rerenders on a keystroke (the
  // caret has to stay put), so the recompute happens the moment you leave.
  _boardsRepaintFormulas(el);
  _boardsSaveDebounced();
  // Leaving a note hands the rail back to whatever mode the selection asks for.
  if(_boardsIsRichField(el)){_boardsFmtTarget=null;_boardsRenderRail();}
}
function _boardsRepaintFormulas(el){
  if(!el||!el.id||el.id.indexOf('board-td-')!==0)return;
  const m=/^board-td-(.+)-(\d+)-(\d+)$/.exec(el.id);
  if(!m)return;
  const c=_editCards.find(x=>x.id===m[1]);
  if(!c||!Array.isArray(c.rows))return;
  c.rows.forEach((row,r)=>row.forEach((cell,i)=>{
    if(!_boardsIsFormula(cell))return;
    const td=document.getElementById('board-td-'+c.id+'-'+r+'-'+i);
    if(td&&td!==_boardsEditingEl)_boardsRepaintCell(td);
  }));
}
function _boardsRepaintCell(el){
  if(!el||!el.id||el.id.indexOf('board-td-')!==0)return;
  const m=/^board-td-(.+)-(\d+)-(\d+)$/.exec(el.id);
  if(!m)return;
  const c=_editCards.find(x=>x.id===m[1]);
  if(!c)return;
  const cell=_boardsCellAt(c,parseInt(m[2],10),parseInt(m[3],10));
  if(cell===undefined)return;
  try{
    el.textContent=_boardsCellDisplay(cell,c);
    el.className='board-td'+_boardsCellClass(cell,c);
    const st=_boardsCellStyle(cell,c);
    if(st)el.setAttribute('style',st);else el.removeAttribute('style');
  }catch(e){}
}
window.boardsEndEdit=_boardsEndEdit;
// Leaving edit mode by clicking elsewhere. Registered once at load, like the
// paste and keydown handlers — a listener added during a render would pile
// up, since the canvas DOM is replaced each time. Capture phase, so it runs
// before the click is acted on. The formatting bar is excluded: it already
// preventDefaults its own mousedown to keep the selection alive, and ending
// the edit here would undo that.
// Space = pan, while held. Registered once at load like the other
// document-level handlers. It must NOT fire while you are typing — space is
// a space — and it must clear on blur, or alt-tabbing away mid-hold leaves
// the board stuck in pan mode with no way to tell.
function _boardsSetSpace(down){
  if(_boardsSpaceDown===down)return;
  _boardsSpaceDown=down;
  const stage=document.getElementById('board-stage');
  if(stage)stage.classList.toggle('pan-ready',down||_boardsPanMode);
}
document.addEventListener('keydown',e=>{
  if(currentPage!=='board-canvas'||!_editBoard)return;
  if(e.code!=='Space'&&e.key!==' ')return;
  if(_boardsIsEditableFocus())return;
  e.preventDefault();
  _boardsSetSpace(true);
});
document.addEventListener('keyup',e=>{
  if(e.code==='Space'||e.key===' ')_boardsSetSpace(false);
});
window.addEventListener('blur',()=>_boardsSetSpace(false));

// The Hand toggle, for anyone without a keyboard or who would rather not
// hold one down.
// ── Selection actions from Milanote's own menu and rail (Sept 2026) ──────
// "Connect with Lines", "Alignment" and "Distribute" are what Afnan's
// screenshots show on a multi-selection. They all take the CURRENT
// selection and are routed through _boardsCtxRun like every other action,
// so the rail and the right-click menu get them together and cannot drift.

// Connect the selection in sequence. Selection order is insertion order
// (it is a Set), which is the order you clicked them in — meaningful, and
// the only order available that isn't arbitrary.
window.boardsConnectSelection=function(){
  const sel=_boardsSelectedCards();
  if(sel.length<2){showToast('Select two or more cards first',true);return;}
  _boardsPushUndo();
  let made=0;
  for(let i=0;i<sel.length-1;i++){
    const from=sel[i].id,to=sel[i+1].id;
    // Never stack a second line on a pair that already has one, in either
    // direction — connecting the same group twice would silently double up.
    const dup=_editConnectors.some(c=>!c.free&&((c.from===from&&c.to===to)||(c.from===to&&c.to===from)));
    if(dup)continue;
    _editConnectors.push({id:'k'+(++_boardsCardSeq)+'_'+Date.now()+'_'+i,from,to,arrow:true});
    made++;
  }
  _boardsDrawConnectors();
  _boardsSaveDebounced();
  showToast(made?('Connected '+(made+1)+' cards'):'Those cards are already connected');
};

// Align every selected card to one edge of the selection's bounding box.
const _BOARDS_ALIGN={
  left:  (c,bb)=>({x:bb.x1}),
  hcenter:(c,bb)=>({x:(bb.x1+bb.x2)/2-c.w/2}),
  right: (c,bb)=>({x:bb.x2-c.w}),
  top:   (c,bb)=>({y:bb.y1}),
  vcenter:(c,bb)=>({y:(bb.y1+bb.y2)/2-c.h/2}),
  bottom:(c,bb)=>({y:bb.y2-c.h})
};
function _boardsSelBounds(sel){
  return{
    x1:Math.min(...sel.map(c=>c.x)),  y1:Math.min(...sel.map(c=>c.y)),
    x2:Math.max(...sel.map(c=>c.x+c.w)), y2:Math.max(...sel.map(c=>c.y+c.h))
  };
}
window.boardsAlignSelection=function(how){
  const fn=_BOARDS_ALIGN[how];
  const sel=_boardsSelectedCards().filter(c=>!c.locked);
  if(!fn||sel.length<2){showToast('Select two or more cards first',true);return;}
  _boardsPushUndo();
  const bb=_boardsSelBounds(sel);
  sel.forEach(c=>{const d=fn(c,bb);if(d.x!=null)c.x=d.x;if(d.y!=null)c.y=d.y;});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};

// Even the GAPS, not the positions — spacing cards evenly by their left
// edges looks wrong the moment two cards are different widths, which on
// this board is always.
window.boardsDistributeSelection=function(axis){
  const sel=_boardsSelectedCards().filter(c=>!c.locked);
  if(sel.length<3){showToast('Select three or more cards first',true);return;}
  _boardsPushUndo();
  const horiz=axis!=='v';
  const size=c=>horiz?c.w:c.h;
  const pos=c=>horiz?c.x:c.y;
  const ordered=sel.slice().sort((a,b)=>pos(a)-pos(b));
  const first=ordered[0],last=ordered[ordered.length-1];
  const span=(pos(last)+size(last))-pos(first);
  const used=ordered.reduce((n,c)=>n+size(c),0);
  const gap=(span-used)/(ordered.length-1);
  let run=pos(first);
  ordered.forEach(c=>{
    if(horiz)c.x=run;else c.y=run;
    run+=size(c)+gap;
  });
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};

window.boardsTogglePan=function(){
  _boardsPanMode=!_boardsPanMode;
  _boardsRenderCanvasAndWire();
};

document.addEventListener('pointerdown',e=>{
  if(!_boardsEditingEl)return;
  const t=e.target;
  if(t&&t.closest&&(t.closest('.board-fmt')||t.closest('.board-sheet')))return;
  // The rail's formatting tools and the Text style menu act ON the caret:
  // a press there must not end the edit it is formatting.
  if(t&&t.closest&&_boardsIsRichField(_boardsEditingEl)&&(t.closest('[data-act^="fmt:"]')||t.closest('.rail-fmt-row')||t.closest('.board-ctx')))return;
  if(_boardsEditingEl.contains&&_boardsEditingEl.contains(t))return;
  _boardsEndEdit();
},true);

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
  // Escape is the way OUT of edit mode, so it has to be read before the
  // editable-focus bail below — otherwise it is handed to the browser and
  // does nothing at all.
  if((_boardsEditingEl||_boardsCellFocus)&&(e.key==='Escape'||e.key==='Esc')){
    e.preventDefault();
    const hadCell=!!_boardsCellFocus;
    _boardsCellFocus=null;
    _boardsEndEdit();
    if(hadCell)_boardsRenderCanvasAndWire();
    return;
  }
  // Alt+Arrow inserts a row or column around the FOCUSED cell, and like
  // Escape it has to be read before the editable bail — a focused cell is
  // contenteditable, so the bail would swallow it every time. It is gated
  // on a focused cell existing, so the one thing it costs (Alt+←/→ as
  // word-jump on a Mac) is only unavailable inside a table cell, which is
  // exactly where the spec asks for it.
  if(e.altKey&&!e.ctrlKey&&!e.metaKey&&_boardsCellFocus&&/^Arrow/.test(e.key||'')){
    const map={ArrowUp:'row-above',ArrowDown:'row-below',
               ArrowLeft:'col-left',ArrowRight:'col-right'};
    const w=map[e.key];
    if(w){e.preventDefault();window.boardsCellRowCol(w);return;}
  }
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
    if(k==='d'){e.preventDefault();
      if(_boardsConnSel!==null&&!_boardsSelection.size)window.boardsDuplicateConnector(_boardsConnSel);
      else window.boardsDuplicateSelection();
      return;}
    if(k==='a'){e.preventDefault();window.boardsSelectAll();return;}
    return;   // let copy/cut/paste reach their own clipboard events
  }
  if(k==='f2'&&_boardsSelection.size===1){e.preventDefault();_boardsCtxRun('rename');return;}
  if(k==='escape'&&_boardsConnSel!==null){e.preventDefault();_boardsClearConnSel();return;}
  if(k==='escape'&&_boardsSelection.size){e.preventDefault();window.boardsClearSelection();return;}
  if((k==='delete'||k==='backspace')&&_boardsConnSel!==null&&!_boardsSelection.size){
    e.preventDefault();window.boardsDeleteConnector(_boardsConnSel);return;
  }
  if((k==='delete'||k==='backspace')&&_boardsSelection.size){e.preventDefault();window.boardsDeleteSelection();}
}
document.addEventListener('keydown',_boardsOnKeydown);
window.boardsToggleSnap=function(){
  _boardsSnapGrid=!_boardsSnapGrid;
  try{localStorage.setItem('groovy-boards-snap',_boardsSnapGrid?'1':'0');}catch(e){}
  const btn=document.getElementById('board-snap-btn');
  if(btn)btn.textContent='Snap to grid: '+(_boardsSnapGrid?'on':'off');
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

/* ── Reading order, the document export and Presentation ────────────────
   A board is a plane; a document and a slideshow are both a LINE. One
   function turns one into the other, and both features consume it — two
   orderings would disagree the first time anybody added a frame.

   The rule: frames first (a frame is how these boards mark a section), each
   followed by whatever sits inside it, then everything loose. Within any
   group, cards are banded by y and sorted left-to-right inside the band —
   plain y-sorting reads a row of four cards as four separate rows, and
   plain x-sorting reads columns. The band is generous (120 world px)
   because nobody aligns cards to the pixel. */
const _BOARDS_READ_BAND=120;
function _boardsReadSort(list){
  return list.slice().sort((a,b)=>
    (Math.round(a.y/_BOARDS_READ_BAND)-Math.round(b.y/_BOARDS_READ_BAND))||(a.x-b.x)||(a.y-b.y));
}
function _boardsReadingOrder(){
  const out=[];
  const used=new Set();
  // A column already carries its own order, so it is emitted whole rather
  // than having its children re-sorted into the surrounding flow.
  const emit=c=>{
    if(used.has(c.id))return;
    used.add(c.id);
    out.push(c);
    if(c.type==='column')_boardsColumnChildren(c).forEach(k=>{if(!used.has(k.id)){used.add(k.id);out.push(k);}});
  };
  _boardsReadSort(_editCards.filter(c=>c.type==='frame')).forEach(f=>{
    emit(f);
    _boardsReadSort(_boardsCardsInFrame(f).filter(c=>c.type!=='frame')).forEach(emit);
  });
  _boardsReadSort(_editCards.filter(c=>!used.has(c.id))).forEach(emit);
  return out;
}
// One card as document lines. Returns {md, html} so the two writers cannot
// drift — they are the same walk, formatted twice.
function _boardsCardDoc(c){
  const esc=_boardsEsc;
  const t=(c.text||'').trim();
  switch(c.type){
    case'heading':return{md:'## '+(t||'Untitled section'),html:'<h2>'+esc(t||'Untitled section')+'</h2>'};
    case'frame':return{md:'## '+((c.title||'').trim()||'Section'),html:'<h2>'+esc((c.title||'').trim()||'Section')+'</h2>'};
    case'column':return{md:'### '+((c.title||'').trim()||'Column'),html:'<h3>'+esc((c.title||'').trim()||'Column')+'</h3>'};
    case'todo':{
      const items=(c.items||[]).filter(i=>i&&(i.text||'').trim());
      if(!items.length)return null;
      return{md:items.map(i=>'- ['+(i.done?'x':' ')+'] '+i.text).join('\n'),
        html:'<ul>'+items.map(i=>'<li>'+(i.done?'☑ ':'☐ ')+esc(i.text)+'</li>').join('')+'</ul>'};
    }
    case'table':{
      const rows=Array.isArray(c.rows)?c.rows:[];
      if(!rows.length)return null;
      const head=c.head!==false;
      const md=rows.map((r,i)=>'| '+r.map(v=>_boardsCellDisplay(v,c).replace(/\|/g,'\\|')).join(' | ')+' |'
        +((head&&i===0)?'\n|'+r.map(()=>' --- ').join('|')+'|':'')).join('\n');
      const html='<table border="1" cellpadding="5" cellspacing="0">'+rows.map((r,i)=>
        '<tr>'+r.map(v=>(head&&i===0)?'<th>'+esc(_boardsCellDisplay(v,c))+'</th>':'<td>'+esc(_boardsCellDisplay(v,c))+'</td>').join('')+'</tr>').join('')+'</table>';
      return{md,html};
    }
    case'image':
      if(!c.imageUrl)return null;
      return{md:'!['+((c.caption||c.name||'').trim())+']('+c.imageUrl+')',
        html:'<p><img src="'+esc(c.imageUrl)+'" style="max-width:520px"><br><i>'+esc((c.caption||c.name||'').trim())+'</i></p>'};
    case'file':
      if(!c.fileUrl)return null;
      return{md:'['+((c.name||c.fileName||'File').trim())+']('+c.fileUrl+')',
        html:'<p><a href="'+esc(c.fileUrl)+'">'+esc((c.name||c.fileName||'File').trim())+'</a></p>'};
    case'link':
      if(!c.linkUrl)return null;
      return{md:'['+((c.linkTitle||c.linkUrl).trim())+']('+c.linkUrl+')'+(c.linkDesc?'  \n'+c.linkDesc:''),
        html:'<p><a href="'+esc(c.linkUrl)+'">'+esc((c.linkTitle||c.linkUrl).trim())+'</a>'+(c.linkDesc?'<br>'+esc(c.linkDesc):'')+'</p>'};
    case'board':return null;   // handled by the recursion, or skipped
    default:{
      if(!t)return null;
      const name=(c.name||'').trim();
      return{md:(name?'**'+name+'**  \n':'')+t,
        html:'<p>'+(name?'<b>'+esc(name)+'</b><br>':'')+esc(t).replace(/\n/g,'<br>')+'</p>'};
    }
  }
}
// Walks this board and, optionally, the boards nested under it. `seen`
// guards a cycle — only reachable by hand-editing Firestore, but an
// infinite recursion here would take the page down with it.
function _boardsDocWalk(cards,depth,subs,seen,acc){
  const deeper=n=>depth>0?'#'.repeat(Math.min(depth,3))+n:n;
  cards.forEach(c=>{
    if(c.type==='board'&&c.boardId){
      const child=_boardsLiveById()[c.boardId];
      const title=(child&&child.title)||c.boardTitle||'Untitled board';
      acc.md.push(deeper('## ')+title);
      acc.html.push('<h'+Math.min(2+depth,6)+'>'+_boardsEsc(title)+'</h'+Math.min(2+depth,6)+'>');
      if(!subs||!child||seen.has(child.id)){
        if(!subs){
          acc.md.push('*(sub-board — not included)*');
          acc.html.push('<p><i>(sub-board — not included)</i></p>');
        }
        return;
      }
      seen.add(child.id);
      // The child's cards are read by the same function, which needs them
      // to BE the current board's cards — frame membership and column
      // children are both computed from _editCards. Swapped and restored
      // in a finally, so a throw anywhere below cannot leave the canvas
      // pointing at another board's array.
      const save=_editCards;
      try{
        _editCards=_boardsDecodeCards((child.cards||[]).slice());
        const order=_boardsReadingOrder();
        _boardsDocWalk(order,depth+1,subs,seen,acc);
      }finally{_editCards=save;}
      return;
    }
    const d=_boardsCardDoc(c);
    if(!d)return;
    acc.md.push(depth>0&&/^#/.test(d.md)?'#'+d.md:d.md);
    acc.html.push(d.html);
  });
}
function _boardsBuildDoc(includeSubs){
  const title=(_editBoard&&_editBoard.title)||'Untitled board';
  const acc={md:['# '+title,''],html:['<h1>'+_boardsEsc(title)+'</h1>']};
  _boardsDocWalk(_boardsReadingOrder(),0,includeSubs,new Set([_editBoard.id]),acc);
  const md=acc.md.join('\n\n')+'\n';
  // Word opens an HTML file with a .doc extension and keeps the headings,
  // lists, tables and images — which is the whole document, with no
  // dependency. A real .docx means a ZIP writer and an OOXML template,
  // which is a library; this repo has held the zero-new-deps line since
  // Stage 1. Said out loud in the download toast rather than implied.
  const html='<html xmlns:o="urn:schemas-microsoft-com:office:office" '+
    'xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'+
    '<head><meta charset="utf-8"><title>'+_boardsEsc(title)+'</title>'+
    '<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45}'+
    'h1{font-size:20pt}h2{font-size:15pt}h3{font-size:12pt}'+
    'table{border-collapse:collapse}th,td{border:1px solid #999;padding:5px}</style></head>'+
    '<body>'+acc.html.join('\n')+'</body></html>';
  return{title,md,html};
}
function _boardsSaveText(text,filename,mime){
  const blob=new Blob([text],{type:mime});
  const href=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=href;a.download=filename;a.style.display='none';
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{try{URL.revokeObjectURL(href);}catch(e){}a.remove();},10000);
}
window.boardsExportDoc=function(kind){
  if(!_editBoard)return;
  _boardsMenuOpen=false;_boardsSyncMenu();
  const subs=_editCards.some(c=>c.type==='board'&&c.boardId)
    ? confirm('Include the boards nested inside this one?') : false;
  const doc=_boardsBuildDoc(subs);
  const base=_boardsExportName(kind==='md'?'md':'doc');
  if(kind==='md'){
    _boardsSaveText(doc.md,base,'text/markdown;charset=utf-8');
    showToast('Markdown downloaded');
  }else if(kind==='txt'){
    // Plain text is the Markdown with the syntax taken back out.
    const txt=doc.md.replace(/^#{1,6} /gm,'').replace(/\*\*/g,'').replace(/!?\[([^\]]*)\]\(([^)]*)\)/g,'$1 ($2)');
    _boardsSaveText(txt,_boardsExportName('txt'),'text/plain;charset=utf-8');
    showToast('Text file downloaded');
  }else{
    _boardsSaveText(doc.html,base,'application/msword');
    showToast('Word document downloaded — it is HTML inside a .doc, which Word opens normally');
  }
  _boardsLogBoardActivity('exported the board as a document');
};

/* ── Presentation ───────────────────────────────────────────────────────
   Walks the SAME reading order the document export uses, so a board
   presents in the order it reads. Frames and headings become section
   slides; everything with content becomes a slide of its own; an empty
   note or an unfilled image card is skipped rather than shown as a blank.

   Built as its own fixed overlay rather than a mode on the canvas: the
   canvas is a pan/zoom surface with a rail, a minimap and a tray, and
   hiding all of that is more work — and more ways to leave it hidden —
   than drawing a clean screen. Escape is the only way in or out, and it is
   registered on the way in and removed on the way out, so nothing lingers. */
let _boardsPresentIdx=0,_boardsPresentList=null;
function _boardsPresentable(){
  return _boardsReadingOrder().filter(c=>{
    if(c.type==='frame'||c.type==='heading')return true;
    if(c.type==='column')return !!(c.title||'').trim();
    if(c.type==='image')return !!c.imageUrl;
    if(c.type==='file')return !!c.fileUrl;
    if(c.type==='link')return !!c.linkUrl;
    if(c.type==='board')return !!c.boardId;
    if(c.type==='todo')return (c.items||[]).some(i=>i&&(i.text||'').trim());
    if(c.type==='table')return Array.isArray(c.rows)&&c.rows.length;
    return !!(c.text||'').trim();
  });
}
window.boardsPresent=function(){
  if(!_editBoard)return;
  _boardsMenuOpen=false;_boardsSyncMenu();
  _boardsPresentList=_boardsPresentable();
  if(!_boardsPresentList.length)return showToast('Nothing on this board to present yet');
  _boardsPresentIdx=0;
  const el=document.createElement('div');
  el.id='board-present';
  el.className='board-present';
  el.innerHTML=
    '<div class="board-present-stage" id="board-present-stage"></div>'+
    '<div class="board-present-bar">'+
      '<button class="tool-btn" id="bp-prev" title="Previous (←)">←</button>'+
      '<span class="board-present-count" id="bp-count"></span>'+
      '<button class="tool-btn" id="bp-next" title="Next (→)">→</button>'+
      '<span class="board-present-title" id="bp-title"></span>'+
      '<button class="tool-btn" id="bp-exit" title="Exit (Esc)">✕</button>'+
    '</div>';
  document.body.appendChild(el);
  el.querySelector('#bp-title').textContent=_editBoard.title||'Untitled board';
  el.querySelector('#bp-prev').onclick=()=>window.boardsPresentStep(-1);
  el.querySelector('#bp-next').onclick=()=>window.boardsPresentStep(1);
  el.querySelector('#bp-exit').onclick=window.boardsPresentExit;
  // Clicking the slide advances, the way every slideshow does; the bar is
  // excluded so its buttons still mean what they say.
  el.addEventListener('click',e=>{
    if(e.target.closest&&e.target.closest('.board-present-bar'))return;
    window.boardsPresentStep(1);
  });
  document.addEventListener('keydown',_boardsPresentKey,true);
  _boardsPresentPaint();
  _boardsLogBoardActivity('presented the board');
};
window.boardsPresentExit=function(){
  const el=document.getElementById('board-present');
  if(el)el.remove();
  _boardsPresentList=null;
  document.removeEventListener('keydown',_boardsPresentKey,true);
};
function _boardsPresentKey(e){
  if(!document.getElementById('board-present'))return;
  const k=e.key;
  if(k==='Escape'){e.preventDefault();e.stopPropagation();window.boardsPresentExit();return;}
  if(k==='ArrowRight'||k===' '||k==='PageDown'){e.preventDefault();e.stopPropagation();window.boardsPresentStep(1);return;}
  if(k==='ArrowLeft'||k==='PageUp'){e.preventDefault();e.stopPropagation();window.boardsPresentStep(-1);return;}
  if(k==='Home'){e.preventDefault();_boardsPresentIdx=0;_boardsPresentPaint();return;}
  if(k==='End'){e.preventDefault();_boardsPresentIdx=_boardsPresentList.length-1;_boardsPresentPaint();}
}
window.boardsPresentStep=function(d){
  if(!_boardsPresentList)return;
  const next=_boardsPresentIdx+d;
  if(next<0)return;
  if(next>=_boardsPresentList.length){window.boardsPresentExit();return;}
  _boardsPresentIdx=next;
  _boardsPresentPaint();
};
function _boardsPresentPaint(){
  const stage=document.getElementById('board-present-stage');
  if(!stage||!_boardsPresentList)return;
  const c=_boardsPresentList[_boardsPresentIdx];
  const count=document.getElementById('bp-count');
  if(count)count.textContent=(_boardsPresentIdx+1)+' / '+_boardsPresentList.length;
  stage.className='board-present-stage kind-'+c.type;
  stage.innerHTML='';
  // Structure first, user text with textContent — the same boundary as the
  // canvas. A slide is the one place a stored string is drawn at 60px, so
  // getting it wrong here would be the most visible XSS in the app.
  const add=(tag,cls,text)=>{
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!=null)n.textContent=text;
    stage.appendChild(n);
    return n;
  };
  if(c.type==='frame'||c.type==='heading'||c.type==='column'){
    add('div','bp-kicker','Section');
    add('h1','bp-title',(c.type==='heading'?(c.text||''):(c.title||'')).trim()||'Untitled section');
  }else if(c.type==='image'){
    const im=document.createElement('img');
    im.className='bp-img';im.src=_boardsDisplayUrl(c.imageUrl,1600);
    im.crossOrigin='anonymous';im.alt='';
    stage.appendChild(im);
    if((c.caption||c.name||'').trim())add('div','bp-cap',(c.caption||c.name).trim());
  }else if(c.type==='table'){
    const t=document.createElement('table');
    t.className='bp-table';
    (c.rows||[]).forEach((row,r)=>{
      const tr=document.createElement('tr');
      row.forEach(v=>{
        const cell=document.createElement((c.head!==false&&r===0)?'th':'td');
        cell.textContent=_boardsCellDisplay(v,c);
        tr.appendChild(cell);
      });
      t.appendChild(tr);
    });
    stage.appendChild(t);
  }else if(c.type==='todo'){
    if((c.name||'').trim())add('h2','bp-sub',c.name.trim());
    const ul=document.createElement('ul');
    ul.className='bp-list';
    (c.items||[]).filter(i=>i&&(i.text||'').trim()).forEach(i=>{
      const li=document.createElement('li');
      li.textContent=(i.done?'☑  ':'☐  ')+i.text;
      if(i.done)li.className='done';
      ul.appendChild(li);
    });
    stage.appendChild(ul);
  }else if(c.type==='file'||c.type==='link'||c.type==='board'){
    add('div','bp-kicker',c.type==='board'?'Sub-board':c.type==='file'?'Attachment':'Link');
    const label=c.type==='board'
      ?(((_boardsLiveById()[c.boardId]||{}).title)||c.boardTitle||'Untitled board')
      :c.type==='file'?(c.name||c.fileName||'File'):(c.linkTitle||c.linkUrl||'Link');
    add('h2','bp-sub',label);
    if(c.type==='link'&&c.linkDesc)add('div','bp-cap',c.linkDesc);
  }else{
    if((c.name||'').trim())add('div','bp-kicker',c.name.trim());
    add('div','bp-body',(c.text||'').trim());
  }
}

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
  // Gallery previews, the card count and the cross-board search all read
  // b.cards straight off the document, so they need the in-memory shape too.
  all.forEach(b=>{if(Array.isArray(b.cards))b.cards=_boardsDecodeCards(b.cards);});
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
      <div style="font-weight:700;font-size:14.5px;margin-bottom:4px">Could not load your boards</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.5">${_boardsEsc(_boardsLoadError)}</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.5;margin-top:6px">If that says <em>missing or insufficient permissions</em>, the Firestore rules in the Firebase Console are older than this app — republish <code>firestore.rules</code>.</div>
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
  const recent=_boardsRecentRead().map(r=>live[r.id]).filter(b=>b&&!b.isHome).slice(0,6);
  if(recent.length<2)return'';   // a strip of one is noise, not a shortcut
  return`<div class="notes-section">
    <div class="notes-section-head"><h3>Recently opened</h3></div>
    <div class="board-recent-strip">${recent.map(b=>`<button class="board-recent-chip" onclick="window.boardsOpenFromAll('${b.id}')">${_boardsEsc(b.title||'Untitled board')}</button>`).join('')}</div>
  </div>`;
}
// Searching deliberately looks at EVERY live board, nested ones included,
// and at the text inside their cards — the whole point is "find that one
// reference somewhere in a season's worth of boards". Card text is already
// in memory (loadBoardsData reads whole documents), so this costs nothing
// extra.
function _boardsSearchResultsHTML(q){
  const hits=moodBoards.filter(b=>!b.isHome).map(b=>({b,n:_boardsMatchCount(b,q)}))
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
  <button class="back-btn" onclick="window.showPage('boards')">← Home</button>
  <div class="page-head" style="margin-bottom:10px">
    <div><h2 style="margin:0">All boards</h2><div style="color:var(--muted);font-size:13px;margin-top:2px">Every board you can see, including ones not on your Home. Templates and Trash live here.</div></div>
  </div>
  ${_boardsLoadNoticeHTML()}
  ${_boardsGalleryBarHTML()}`;
  if(_boardsLoadError)return head;
  if(q)return head+_boardsSearchResultsHTML(q)+_boardsTrashSectionHTML();

  const nested=_boardsNestedIds();
  const root=moodBoards.filter(b=>!nested.has(b.id)&&!b.isHome);
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
    <div class="notes-section-head"><h3>Templates</h3><span style="font-size:12px;color:var(--muted)">Start a new board from a skeleton you already built</span></div>
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
/**
 * "Show the board list again, wherever it is being shown." The gallery is
 * one place it lives; **Home's panel is the other**, and every identity
 * change (a picture, a colour, an icon, a rename) is now reachable from
 * there through the gallery's own menu. Without this branch the menu
 * appeared to do nothing on Home — the write landed and the row kept its
 * old tile until the next render. The dead-button shape, again.
 */
function _boardsRerenderGallery(){
  if(currentPage==='board-canvas'&&_boardsIsHome(_editBoard)){_boardsRenderCanvasAndWire();return;}
  if(currentPage!=='boards')return;
  const m=document.getElementById('main-content');
  if(m)m.innerHTML=renderBoardsGallery();
}
function _boardsTrashSectionHTML(){
  if(!_boardsTrash.length)return'';
  return`<div class="notes-section">
    <div class="notes-section-head"><h3>Trash</h3><span style="font-size:12px;color:var(--muted)">Deleted boards are kept here until you remove them for good</span></div>
    <div class="board-trash-list">${_boardsTrash.map(b=>`
      <div class="board-trash-row" data-trash="${b.id}">
        <div style="min-width:0">
          <div style="font-weight:600;font-size:14px">${_boardsEsc(b.title||'Untitled board')}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${(b.cards||[]).length} card${(b.cards||[]).length===1?'':'s'} · deleted ${_boardsRelTime(b.deletedAt)}${b.deletedByName?' by '+_boardsEsc(b.deletedByName):''}</div>
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
  // Milanote's own tile reads "398 cards · 14 files" — an attachment count
  // is what tells you a board is a reference dump rather than a sketch.
  // Images count: on a mood board a photo IS an attachment.
  const files=_boardsCountFiles(cards);
  const crumbs=_boardsAncestors(b.id).map(a=>_boardsEsc(a.title||'Untitled board')).join(' › ');
  const tint=_boardsValidHex(b.color);
  return`<div class="board-gallery-card" data-board="${b.id}" onclick="window.boardsOpenFromAll('${b.id}')"${tint?` style="border-top:3px solid ${tint}"`:''}>
    <div class="board-gallery-thumb">
      <div style="position:absolute;transform:scale(${scale});transform-origin:top left">
        ${cards.filter(c=>c.type==='frame'||c.type==='column').concat(cards.filter(c=>c.type!=='frame'&&c.type!=='column')).map(_boardMiniCardHTML).join('')}
      </div>
      ${b.isTemplate?'<span class="board-template-pill">Template</span>':(b.sharedWith&&b.sharedWith.length?'<span class="board-template-pill">Shared</span>':'')}
    </div>
    <div class="board-gallery-meta">
      ${crumbs?`<div class="board-gallery-path">${crumbs} ›</div>`:''}
      <div class="board-gallery-title">${_boardsTileHTML(b,34)}<span>${_boardsEsc(b.title||'Untitled board')}</span></div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${vis} · ${cards.length} card${cards.length===1?'':'s'}${files?' · '+files+' file'+(files===1?'':'s'):''}${subs?' · '+subs+' sub-board'+(subs===1?'':'s'):''} · ${_boardsEsc(b.ownerName||'')} · ${_boardsRelTime(b.updatedAt)}</div>
      ${opts.matches?`<div class="board-gallery-hit">${opts.matches} matching card${opts.matches===1?'':'s'}</div>`:''}
      ${opts.template?`<div style="margin-top:8px"><button class="btn-sm" onclick="event.stopPropagation();window.boardsUseTemplate('${b.id}')">Use template</button></div>`:''}
    </div>
  </div>`;
}
function _boardMiniCardHTML(c){
  const base=`position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;border-radius:6px;overflow:hidden;border:1px solid var(--border)`;
  if(c.type==='frame'||c.type==='column')return`<div style="${base};background:rgba(0,0,0,.03)"></div>`;
  if(c.type==='image')return c.imageUrl?`<div style="${base}"><img src="${_boardsEsc(c.imageUrl)}" draggable="false" style="width:100%;height:100%;object-fit:cover"></div>`:`<div style="${base};background:var(--soft)"></div>`;
  if(c.type==='link'||c.type==='file')return`<div style="${base};background:var(--soft)"></div>`;
  if(c.type==='board')return`<div style="${base};background:var(--soft);border-style:dashed"></div>`;
  if(c.type==='heading')return`<div style="${base};background:var(--dark)"></div>`;
  return`<div style="${base};background:var(--surface)"></div>`;
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
    // Name/colour/icon first, then Open — otherwise every board is called
    // "Untitled board" and the gallery is unreadable. If the reload that
    // makes the new board addressable fails for any reason, fall back to
    // the old behaviour rather than leaving the user with nothing.
    try{
      await window.boardsRetryLoad();
      if(moodBoards.some(x=>x.id===id)){window.boardsOpenSetup(id);return;}
    }catch(e){}
    window.boardsOpen(id);
  }catch(e){showToast('Could not create board: '+(e.message||e),true);}
};
// A sub-board is two writes that must both land: the child document, and
// the link card on this board that makes it reachable. The save is flushed
// straight away rather than left to the 900ms debounce for exactly that
// reason — a reload in between would leave the child orphaned (it would
// surface back at root level, by design, but it would look like it moved).
// Adopts an EXISTING board card that never got a boardId (the rail bug
// fixed in c15cd05 minted these; the cards it already made are still on
// real boards and cannot heal themselves). Same two writes as
// boardsAddChildBoard — the child doc, then the link — so the save is
// flushed rather than left to the debounce.
window.boardsRepairBoardCard=async function(cardId){
  if(!_editBoard||!_boardsCanEdit(_editBoard))return;
  const c=_editCards.find(x=>x.id===cardId);
  if(!c||c.type!=='board')return;
  if(c.boardId){showToast('That card already points at a board');return;}
  try{
    const id=await _boardsCreateDoc(_boardsIsHome(_editBoard)
      ?{visibility:'personal'}
      :{visibility:_editBoard.visibility,parentId:_editBoard.id});
    _boardsPushUndo();
    c.boardId=id;c.boardTitle='Untitled board';
    _boardsRenderCanvasAndWire();
    await _boardsSaveNow();
    boardsLoaded=false;
    _boardsLogBoardActivity('added a sub-board');
    showToast('Board created and linked — open it from the card');
  }catch(e){showToast('Could not create the board: '+(e.message||e),true);}
};
// Trashing a board from its card on Home. Deletion is owner-only here just
// as it is in firestore.rules and in the gallery menu — the UI must not
// offer what the rules will refuse.
window.boardsTrashLinkedBoard=async function(boardId,cardId){
  const b=_boardsLiveById()[boardId];
  const title=(b&&b.title)||'Untitled board';
  const owner=!!(session&&b&&(b.ownerUid===session.uid||session.role==='owner'));
  if(!owner){showToast('Only the board’s owner can move it to Trash');return;}
  if(!confirm('Move "'+title+'" to Trash? You can restore it from All boards.'))return;
  try{
    await _qUpdate(doc(db,'mood_boards',boardId),{deletedAt:Date.now(),deletedByName:session.name,updatedAt:Date.now()});
    moodBoards=moodBoards.filter(x=>x.id!==boardId);
    _boardsPushUndo();
    _editCards=_editCards.filter(x=>x.id!==cardId);
    _editConnectors=_editConnectors.filter(cn=>cn.from!==cardId&&cn.to!==cardId);
    _boardsSelection.delete(cardId);
    _boardsRenderCanvasAndWire();
    await _boardsSaveNow();
    logActivity('Mood board deleted',`${session.name} moved "${title}" to trash`);
    showToast('Board moved to Trash');
  }catch(e){showToast('Could not delete: '+(e.message||e),true);}
};
window.boardsAddChildBoard=async function(){
  if(!_editBoard||!_boardsCanEdit(_editBoard))return;
  _boardsMenuOpen=false;_boardsSyncMenu();
  const p=_boardsPlacementPoint();
  const home=_boardsIsHome(_editBoard);
  try{
    // On Home this is "new board", not "sub-board": setting parentId would
    // nest it under a board only its owner can read, and it would drop out
    // of All boards' root listing for them and nobody else.
    const id=await _boardsCreateDoc(home
      ?{visibility:'personal'}
      :{visibility:_editBoard.visibility,parentId:_editBoard.id});
    _boardsPushUndo();
    const nc=_boardsNewCard('board');
    nc.x=p.x;nc.y=p.y;nc.boardId=id;nc.boardTitle='Untitled board';
    _editCards.push(nc);
    _boardsRenderCanvasAndWire();
    await _boardsSaveNow();
    boardsLoaded=false;
    _boardsLogBoardActivity(home?'added a board':'added a sub-board');
    showToast(home?'Board added — open it from the card':'Sub-board added — open it from the card');
  }catch(e){showToast('Could not create '+(home?'board':'sub-board')+': '+(e.message||e),true);}
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
  let src=(cards||[]).filter(c=>c.type!=='board');
  const skipped=(cards||[]).length-src.length;
  // Copying a column copies what is IN it. A container duplicated empty is
  // never what anyone meant, and the alternative — a copy whose children
  // still carry the original's columnId — would put one card in two
  // columns at once.
  const have=new Set(src.map(c=>c.id));
  src.filter(c=>c.type==='column').forEach(col=>{
    _boardsColumnChildren(col).forEach(k=>{if(!have.has(k.id)){have.add(k.id);src.push(k);}});
  });
  const clones=_boardsCloneCards(src,0,0);
  const map={};
  src.forEach((c,i)=>{map[c.id]=clones[i].id;});
  // Remap membership through the same id map the connectors use. A child
  // whose column was NOT part of the copy is freed rather than left
  // pointing at the original.
  clones.forEach(c=>{
    if(c.columnId==null)return;
    if(map[c.columnId])c.columnId=map[c.columnId];
    else delete c.columnId;
  });
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
  // Home is the top of the tree, so from Home the only way up is out of the
  // module entirely.
  if(_boardsIsHome(_editBoard)){window.showPage('creative-hub');return;}
  const parent=_editBoard?_boardsParentOf(_editBoard.id):null;
  if(parent){window.boardsOpen(parent.id);return;}
  if(_boardsCameFromAll){_boardsCameFromAll=false;window.showPage('boards-all');return;}
  window.showPage('boards');
};
window.boardsGoto=function(id){
  if(!_boardsLiveById()[id]){showToast('That board is not available — it may have been deleted, or it is private to someone else');return;}
  _boardsSaveNow();window.boardsOpen(id);
};
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
  _editBoard={id:b.id,title:b.title||'Untitled board',visibility:b.visibility||'personal',ownerUid:b.ownerUid,ownerName:b.ownerName,ownerUsername:b.ownerUsername,zoom:b.zoom||1,panX:b.panX||40,panY:b.panY||30,parentId:b.parentId||null,isTemplate:!!b.isTemplate,isHome:!!b.isHome,sharedWith:Array.isArray(b.sharedWith)?b.sharedWith.slice():[]};
  // Clamped AFTER the assignment, not inside the literal. The floor is
  // Home-aware now (_boardsZoomFloor reads _editBoard), and inside the
  // literal _editBoard is still the PREVIOUS board — so a Home saved below
  // 40% came back at the ordinary 25% floor. Found by the test, not by
  // reading.
  _editBoard.zoom=_boardsClampZoom(_editBoard.zoom);
  _editCards=_boardsDecodeCards((b.cards||[]).map(c=>{const cc={...c};delete cc._uploading;return cc;}));
  _editConnectors=(b.connectors||[]).map(cn=>({...cn}));
  _editUnsorted=(b.unsorted||[]).map(u=>{const uu={...u};delete uu._uploading;return uu;});
  _boardsSelection=new Set();
  // Find state is per board-opening too — carrying a search term from one
  // board into the next would highlight nothing and look broken.
  _boardsFindOpen=false;_boardsFindQuery='';_boardsFindHits=[];_boardsFindIdx=0;
  _boardsMenuOpen=false;
  // Line mode is a MODE, and a mode that survives leaving the board is a
  // trap: you open the next board and your first drag draws an arrow
  // instead of doing what you meant. Reset it with the rest of the
  // per-opening state. (Reported as "Line tool defaults to ON".)
  _boardsLineMode=false;
  _boardsCellFocus=null;
  // History is per board-opening — undoing your way into a different
  // board's state would be nonsense.
  _boardsUndo=[];_boardsRedo=[];
  // The sync baseline: what the server has, as far as we know. Every
  // later "did we change this card?" question is answered by diffing
  // against it (see _boardsLocalChanges).
  _boardsSetBase(_boardsCardsForSave());
  // Older connectors predate ids. Minting them here — before the baseline
  // below — means the migration never marks the board dirty on open; the
  // ids persist with the next write that happens for a real reason.
  _boardsConnEnsureIds();
  _boardsConnSel=null;
  _boardsConnBase=JSON.stringify(_editConnectors);
  _boardsPeers=[];_boardsComments=[];_boardsBoardActivity=[];
  _boardsCardTrash=[];_boardsCardTrashOpen=false;_boardsCardTrashTab='mine';
  _boardsPendingRemote=null;_boardsGestureActive=false;
  if(_boardsHomeSync())_boardsSaveDebounced();
  _boardsHomeFirstRun();
  _boardsRenderCanvasAndWire();
  _boardsSubscribe(b.id);
  _boardsPresenceStart(b.id);
  _boardsCommentsStart(b.id);
  // _boardsTrashStart, NOT _boardsCardTrashStart. The Trash round renamed
  // the STATE (_boardsTrash was already the gallery's trashed boards, so
  // the card trash became _boardsCardTrash) and this call site followed the
  // state instead of the function. It has thrown a ReferenceError here on
  // EVERY board open since, and because the canvas renders on the line
  // above and _boardsOpenCanvas is dispatched from renderPage with no
  // catch, nothing looked wrong — it silently skipped the three things
  // below it: the per-board activity feed, the cold-load refresh a deep
  // link needs for its breadcrumbs, and the focus a #board=…&card=… link
  // asks for. The Trash panel never loaded its entries either.
  _boardsTrashStart(b.id);
  _boardsActivityStart(b.id);
  // Opened cold from a deep link, moodBoards is empty — so breadcrumbs and
  // sub-board titles would be blank. Load the list in the background and
  // re-render once it lands, unless the user is already typing in a card.
  if(!boardsLoaded){
    loadBoardsData().then(()=>{
      if(currentPage!=='board-canvas'||!_editBoard||_editBoard.id!==b.id)return;
      // Home opened cold (a deep link, or a reload straight onto it) had no
      // board list to place from. Now it does.
      if(_boardsHomeSync())_boardsSaveDebounced();
      _boardsHomeFirstRun();
      if(!_boardsIsEditableFocus())_boardsRenderCanvasAndWire();
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
  _boardsFullscreen(true);
  _boardsTrayHydrate();
  _boardsPanelHydrate();
  {const st=document.getElementById('board-stage');
   if(st)st.classList.toggle('pan-ready',_boardsPanMode||_boardsSpaceDown);}
  // Seed the pill's last-seen value from the markup we just wrote, so
  // opening a board doesn't flash a percentage nobody asked for.
  _boardsPillZoom=_editBoard?Math.round(_editBoard.zoom*100):null;
  _boardsApplyTransform();
  _boardsHydrateTextCards();
  _boardsDrawConnectors();
  _boardsWireConnLayer(document.getElementById('board-conn-layer'));
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
  const home=_boardsIsHome(b);
  // ONE row on a phone. Measured: the desktop row wrapped to 142px of a
  // 667px screen. Undo, Redo, Find and Comments live in the ⋯ sheet there
  // (same ids, so _boardsSyncHistoryButtons needs no change); the visibility
  // pill is dropped — the sheet's "Make Team/Private" says the state. The
  // save status stays: it renders nothing unless a save FAILED or the phone
  // is offline, and those are exactly the moments it must be seen.
  const phone=_boardsIsPhone();
  const chain=home?[]:_boardsAncestors(b.id);
  const parent=chain.length?chain[chain.length-1]:null;
  const backLabel=home?'Creative Hub':(parent?(parent.title||'Untitled board'):(_boardsCameFromAll?'All boards':'Home'));
  // THE TRAIL, Milanote's shape (Sept 2026): a round chip carrying the
  // GROOVY mark, "Home", a slash, then each ancestor and finally the board's
  // own tile and name. On a phone the one-row bar keeps its capped back
  // button; on Home the chip and the word are the identity and the back
  // button still leaves the module.
  const crumbs=!phone?`<div class="board-crumbs">
      <button class="board-home-chip" onclick="window.boardsGotoGallery()" title="Home"><img src="/assets/icons/icon-192.png" alt=""></button>
      ${home?'<span class="board-crumb board-crumb-home">Home</span>'
        :`<button class="board-crumb board-crumb-home" onclick="window.boardsGotoGallery()">Home</button>
      ${_boardsCameFromAll&&!chain.length?`<span class="board-crumb-slash">/</span><button class="board-crumb" onclick="window.boardsShowAll()">All boards</button>`:''}
      ${chain.map(a=>`<span class="board-crumb-slash">/</span><button class="board-crumb" onclick="window.boardsGoto('${a.id}')">${_boardsEsc(a.title||'Untitled board')}</button>`).join('')}
      <span class="board-crumb-slash">/</span>${_boardsTileHTML(b,22)}`}
    </div>`:'';
  return`<div class="board-canvas-wrap">
    <div class="board-topbar">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap">
        ${phone||home?`<button class="back-btn" style="margin:0" onclick="window.boardsBack()">← ${_boardsEsc(backLabel)}</button>`:''}
        ${crumbs}
        ${home
          ?(phone?`<span style="font-size:15.5px;font-weight:700">Home</span>`:'')
          :`<input type="text" id="board-title-input" value="${_boardsEsc(b.title)}" ${canEdit?'':'readonly'} oninput="window.boardsTitleInput(this.value)" placeholder="Untitled board" title="Click to rename this board" style="font-size:15.5px;font-weight:700;outline:none;font-family:inherit;background:transparent;max-width:240px">
        ${phone?'':`<span class="pill">${visLabel}</span>`}
        ${b.isTemplate?'<span class="pill">TEMPLATE</span>':''}`}
        ${canEdit?`<span class="board-save-status" id="board-save-status"></span>`:''}
        <span class="board-peers" id="board-peers" style="display:none"></span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${phone?'':`${canEdit?`<button class="tool-btn" id="board-undo-btn" onclick="window.boardsUndoAction()" title="Undo (Ctrl+Z)" disabled>Undo</button>
        <button class="tool-btn" id="board-redo-btn" onclick="window.boardsRedoAction()" title="Redo (Ctrl+Shift+Z)" disabled>Redo</button>
        <div class="tool-sep"></div>`:''}
        <button class="tool-btn${_boardsFindOpen?' on':''}" onclick="window.boardsToggleFind()" title="Find cards on this board">Find</button>
        <button class="tool-btn${_boardsDrawerOpen?' on':''}" id="board-cmt-btn" onclick="window.boardsToggleDrawer()" title="Comments and activity on this board">Comments</button>`}
        ${home
          ?`<button class="tool-btn${_boardsHomePanelOpen()?' on':''}" onclick="window.boardsTogglePanel()" title="Show or hide the boards panel">Boards <span class="board-tray-tabn">${_boardsHomeList().length}</span></button>`
          :`<button class="tool-btn${_boardsTrayOpen?' on':''}" onclick="window.boardsToggleTray()" title="Unsorted — things collected but not placed yet">Unsorted${_editUnsorted.length?' '+_editUnsorted.length:''}</button>`}
        <div class="tool-sep"></div>
        <!-- View: everything about how the board is LOOKED AT, in one place,
             the way Milanote groups it. The row used to carry all seven of
             these at the same visual weight as Comments, which made nothing
             read as primary. The zoom % rides on the button itself, so the
             reading stays visible without a control of its own — and
             #board-zoom-readout keeps its id, so _boardsApplyTransform
             needs no change at all. -->
        <div class="board-menu-wrap">
          <button class="tool-btn${_boardsViewOpen?' on':''}" id="board-view-btn" onclick="window.boardsToggleViewMenu(event)" title="How this board is displayed — zoom, fit, snap, minimap">${phone?'':'View '}<span class="zoom-readout" id="board-zoom-readout">${Math.round(b.zoom*100)}%</span></button>
          <div class="board-menu" id="board-view-menu" style="display:none">
            <button id="board-fit-btn" onclick="window.boardsToggleFit()">Fit</button>
            <button onclick="window.boardsResetView()">Zoom to 100%</button>
            <button onclick="window.boardsZoomBy(1.25)">Zoom in</button>
            <button onclick="window.boardsZoomBy(0.8)">Zoom out</button>
            <div class="board-menu-sep"></div>
            <button onclick="window.boardsTogglePan()">Hand (drag to pan): ${_boardsPanMode?'on':'off'}</button>
            ${canEdit?`<button id="board-snap-btn" onclick="window.boardsToggleSnap()">Snap to grid: ${_boardsSnapGrid?'on':'off'}</button>`:''}
            ${_boardsIsPhone()?'':`<button onclick="window.boardsToggleMinimap()">Minimap: ${_boardsMinimapOn?'on':'off'}</button>`}
          </div>
        </div>
        <div class="board-menu-wrap">
          <button class="tool-btn" onclick="window.boardsToggleMenu(event)" title="Board actions">⋯</button>
          <div class="board-menu" id="board-menu" style="display:none">
            ${phone?`${canEdit?`<button id="board-undo-btn" onclick="window.boardsUndoAction()" disabled>Undo</button>
            <button id="board-redo-btn" onclick="window.boardsRedoAction()" disabled>Redo</button>`:''}
            <button onclick="window.boardsToggleFind()">${_boardsFindOpen?'Close find':'Find on this board'}</button>
            <button id="board-cmt-btn" onclick="window.boardsToggleDrawer()">${_boardsDrawerOpen?'Close comments':'Comments and activity'}</button>
            <div class="board-menu-sep"></div>`:''}
            ${_boardsIsPhone()&&!home?`<button onclick="window.boardsOpenColorPicker('board','${b.id}')">Board colour…</button>
            <button onclick="window.boardsOpenIconPicker('${b.id}')">Board icon…</button>
            <div class="board-menu-sep"></div>`:''}
            <button onclick="window.boardsShowAll()">All boards${home?'':' (list, templates, trash)'}</button>
            <div class="board-menu-sep"></div>
            ${home?'':`<button onclick="window.boardsCopyBoardLink()">Copy link to board</button>`}
            <button onclick="window.boardsPresent()">Present this board</button>
            <button onclick="window.boardsExportPNG()">Export as image (PNG)</button>
            <button onclick="window.boardsExportPDF()">Export as PDF</button>
            <button onclick="window.boardsExportDoc('doc')">Export as a Word document</button>
            <button onclick="window.boardsExportDoc('md')">Export as Markdown</button>
            <button onclick="window.boardsExportDoc('txt')">Export as plain text</button>
            ${home?'':`<button onclick="window.boardsDuplicateBoard()">Duplicate board</button>`}
            ${canEdit&&!home?`<button onclick="window.boardsToggleTemplate()">${b.isTemplate?'Remove from templates':'Save as template'}</button>`:''}
            ${canEdit?`<button onclick="window.boardsAddChildBoard()">${home?'New board':'Add sub-board'}</button>`:''}
            ${canEdit&&!home?`<button onclick="window.boardsOpenShare()">Share with people…</button>`:''}
            ${canEdit&&!home?`<button onclick="window.boardsToggleVisibility()">Make ${b.visibility==='shared'?'Private':'Team'}</button>`:''}
            ${canEdit&&!home?`<button class="danger" onclick="window.boardsDelete()">Delete board</button>`:''}
            ${phone&&typeof window.openBugReportModal==='function'?`<div class="board-menu-sep"></div>
            <button onclick="window.openBugReportModal()">Report a bug</button>`:''}
          </div>
        </div>
      </div>
    </div>
    <!-- Everything below the top bar. The Unsorted tray, the comments
         drawer, the card trash and the share modal are all
         position:absolute with top:0, and their containing block used to be
         .board-canvas-wrap — which starts at the VIEWPORT top, so each of
         them painted straight over the top bar. Reported from a screenshot
         where the word "Comments" was cut off mid-word by the open tray.
         Anchoring them to this element instead makes top:0 mean "under the
         bar" with no magic number, and survives the bar wrapping onto two
         rows at a narrow width. They stay SIBLINGS of the stage rather than
         moving inside it: the stage carries touch-action:none and the
         pan/marquee pointer handlers, and a panel inheriting either would
         be a different bug. -->
    <div class="board-below${home?(_boardsHomePanelCollapsed?' with-panel-collapsed':' with-panel'):''}">
    <div class="board-stage" id="board-stage">
      <div class="board-world" id="board-world">
        <svg class="board-conn-layer" id="board-conn-layer" width="4000" height="3000"></svg>
        <div class="board-guide board-guide-v" id="board-guide-v"></div>
        <div class="board-guide board-guide-h" id="board-guide-h"></div>
        <div class="board-col-drop" id="board-col-drop"></div>
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
      ${canEdit&&!_editCards.length?(_boardsIsPhone()
        ?'<div class="board-empty-hint">Double-tap anywhere to add a note · tap a tool below to add one<br>Drag to pan · pinch to zoom · hold a card for its menu</div>'
        :'<div class="board-empty-hint">Double-click anywhere to add a note · drop files in · paste an image with Ctrl+V<br>Drag to select · scroll or hold Space to pan</div>'):''}
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
    <div class="board-ctrash-panel" id="board-ctrash-panel" style="display:none"></div>
    <div class="board-share-modal" id="board-share-modal" style="display:none"></div>
    <input type="file" id="board-file-picker" multiple style="display:none" onchange="window.boardsFilesPicked(this)">
    ${_boardsTrayHTML(canEdit)}
    </div>
  </div>`;
}
function _boardCardHTML(c,canEdit){
  // Frames get their own element entirely: a header strip you can grab,
  // and an outlined region whose body is pointer-events:none so panning,
  // marquee-select and the cards inside it all still work through it.
  // A column renders like a frame — a grab-able header over a region whose
  // body is pointer-events:none — but its children are ordinary sibling
  // cards painted above it, so the body must not swallow their clicks.
  if(c.type==='column'){
    const sel=_boardsSelection.has(c.id)?' selected':'';
    const n=_boardsColumnChildren(c).length;
    return`<div class="board-column${sel}${c.locked?' locked':''}${c.color?' tint-'+c.color:''}" id="board-card-${c.id}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px">
      <div class="board-column-head" ${canEdit&&!c.locked?`onpointerdown="window.boardsCardDragStart(event,'${c.id}')"`:''} onclick="window.boardsSelectCard('${c.id}',event)">
        <input type="text" class="board-column-title" value="${_boardsEsc(c.title||'')}" placeholder="Column" ${canEdit&&!c.locked?'':'readonly'} oninput="window.boardsFrameTitle('${c.id}',this.value)" onpointerdown="event.stopPropagation()">
        <span class="board-column-count">${n}</span>
        ${canEdit&&!c.locked?`<button class="board-card-del" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();window.boardsDeleteCard('${c.id}')" title="Delete column (cards inside are released onto the board)">✕</button>`:''}
      </div>
      ${n?'':'<div class="board-column-empty">Drag cards in</div>'}
      ${canEdit&&!c.locked?`<div class="board-resize-handle" onpointerdown="window.boardsResizeStart(event,'${c.id}')" title="Drag to set the column width"><svg viewBox="0 0 16 16"><path d="M14 2L2 14M14 8L8 14" stroke="currentColor" stroke-width="1.5" fill="none"/></svg></div>`:''}
    </div>`;
  }
  if(c.type==='frame'){
    const sel=_boardsSelection.has(c.id)?' selected':'';
    return`<div class="board-frame${sel}${c.locked?' locked':''}${c.color?' tint-'+c.color:''}" id="board-card-${c.id}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px">
      <div class="board-frame-head" ${canEdit&&!c.locked?`onpointerdown="window.boardsCardDragStart(event,'${c.id}')"`:''} onclick="window.boardsSelectCard('${c.id}',event)">
        <input type="text" class="board-frame-title" value="${_boardsEsc(c.title||'')}" placeholder="Section name" ${canEdit&&!c.locked?'':'readonly'} oninput="window.boardsFrameTitle('${c.id}',this.value)" onpointerdown="event.stopPropagation()">
        ${canEdit&&!c.locked?`<button class="board-card-del" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();window.boardsDeleteCard('${c.id}')" title="Delete frame (cards inside are kept)">✕</button>`:''}
      </div>
      ${canEdit&&!c.locked?`<div class="board-resize-handle" onpointerdown="window.boardsResizeStart(event,'${c.id}')"><svg viewBox="0 0 16 16"><path d="M14 2L2 14M14 8L8 14" stroke="currentColor" stroke-width="1.5" fill="none"/></svg></div>`:''}
    </div>`;
  }
  // Image, file and sub-board cards hold nothing editable, so dragging one
  // by its picture has no click-vs-drag ambiguity — the header-only rule
  // (see CLAUDE.md) exists for text and to-do cards, where a body drag
  // would fight the caret. Reported by Afnan as "when i try to move
  // anything it's not moving": grabbing the picture is the obvious thing
  // to try, and it did nothing.
  // Every card body drags now, not just the three that hold nothing
  // editable: a note is only contenteditable while it is BEING edited
  // (double-click), so a press on one is unambiguously a grab. Link cards
  // are the exception — they are three form fields, and a drag starting in
  // a text input would fight selecting the URL. boardsCardDragStart bails
  // if the press lands inside whatever is currently being edited.
  const bodyDrag=(canEdit&&!c.locked&&c.type!=='link')
    ?` onpointerdown="window.boardsCardDragStart(event,'${c.id}')"`:'';
  let body;
  if(c.type==='todo'){
    const items=c.items||[];
    const doneN=items.filter(i=>i.done).length;
    // Every item carries the onpointerdown guard, for the same reason the
    // checkbox and the remove button beside it already did: this body is a
    // drag surface, boardsCardDragStart calls setPointerCapture, and a
    // captured pointer RETARGETS the following click and dblclick to the
    // capturing element — so the item's own ondblclick never ran and a
    // to-do could not be edited by double-clicking it. Exactly the table
    // cell's bug: a card whose ondblclick sits on the very element holding
    // the drag handler (a note, a heading) survives it; one whose handler
    // sits on a DESCENDANT does not. The cost is the documented one — a
    // to-do card now drags by its header strip and the padding around its
    // rows, not by the item text, just as a table drags by its chrome.
    body=`<div class="board-card-body board-todo-body"${bodyDrag}>
      ${items.map((it,i)=>`<div class="board-todo-row">
        <input type="checkbox" ${it.done?'checked':''} ${canEdit?'':'disabled'} onpointerdown="event.stopPropagation()" onchange="window.boardsTodoToggle('${c.id}',${i},this.checked)">
        <div class="board-todo-text${it.done?' done':''}" id="board-todo-${c.id}-${i}" contenteditable="false" data-placeholder="To-do" onpointerdown="event.stopPropagation()" ${canEdit?`ondblclick="window.boardsBeginEdit(event,'board-todo-${c.id}-${i}')"`:''} oninput="window.boardsTodoText('${c.id}',${i},this)" onkeydown="window.boardsTodoKey(event,'${c.id}',${i})"></div>
        ${canEdit?`<button class="board-todo-del" onpointerdown="event.stopPropagation()" onclick="window.boardsTodoRemove('${c.id}',${i})" title="Remove">✕</button>`:''}
      </div>`).join('')}
      ${canEdit?`<button class="board-todo-add" onpointerdown="event.stopPropagation()" onclick="window.boardsTodoAdd('${c.id}')">+ Add item</button>`:''}
    </div>`;
    c._todoProgress=items.length?doneN+'/'+items.length:'';
  }else if(c.type==='image'){
    body=c._uploading
      ?'<div class="board-card-empty">Uploading…</div>'
      :c.imageUrl
      ?`<img src="${_boardsEsc(_boardsDisplayUrl(c.imageUrl,c.w))}" crossorigin="anonymous" draggable="false" onerror="window.boardsImgFallback(this)" data-full="${_boardsEsc(c.imageUrl)}" style="width:100%;height:100%;object-fit:cover;display:block">`
      :canEdit?`<label class="board-card-empty" for="board-file-${c.id}">Click, or paste an image (Ctrl+V)<input type="file" id="board-file-${c.id}" accept="image/*" onchange="window.boardsUploadToCard('${c.id}',this)" style="display:none"></label>`
              :`<div class="board-card-empty">No image</div>`;
    body=`<div class="board-card-body" style="padding:0"${bodyDrag}${c.imageUrl?` ondblclick="window.boardsFilePreview('${c.id}')"`:''}>${body}</div>`;
  }else if(c.type==='link'){
    // The form is for a card with no URL yet (the rail's Link tool) or for
    // someone who asked to edit one. Everything else shows the PREVIEW —
    // before this, a link card was permanently three raw inputs, which is
    // exactly what Afnan put beside Milanote's picture-and-title card.
    const editing=canEdit&&(c._linkEdit||!c.linkUrl);
    if(editing){
      body=`<div class="board-card-body board-link-edit">
          <input type="text" value="${_boardsEsc(c.linkUrl)}" placeholder="https://…" oninput="window.boardsLinkInput('${c.id}','linkUrl',this.value)">
          <input type="text" value="${_boardsEsc(c.linkTitle)}" placeholder="Title" oninput="window.boardsLinkInput('${c.id}','linkTitle',this.value)">
          <textarea placeholder="Short description (optional)" oninput="window.boardsLinkInput('${c.id}','linkDesc',this.value)">${_boardsEsc(c.linkDesc)}</textarea>
          ${c.linkUrl?`<button class="board-link-done" onpointerdown="event.stopPropagation()" onclick="window.boardsLinkDone('${c.id}')">Done</button>`:''}
        </div>`;
    }else{
      // A preview card holds nothing editable, so it drags from its body like
      // an image or file card does. That NARROWS the header-only rule rather
      // than overturning it: the rule exists for bodies holding a caret, and
      // the form branch above still keeps its own.
      const drag=(canEdit&&!c.locked)?` onpointerdown="window.boardsCardDragStart(event,'${c.id}')"`:'';
      // Milanote's order exactly, which is what Afnan asked for: the URL on
      // top, then the TITLE AS THE LINK in accent colour so it is obviously
      // clickable, then the description.
      //
      // The title is an <a target="_blank" rel="noopener noreferrer"> — the
      // rel is not decoration: without it the opened page can reach back
      // through window.opener. Its href goes through _boardsSafeHref, and
      // when that refuses, the <a> is emitted with NO href and is just text.
      // It stops pointerdown reaching the drag handler, or the card would
      // start moving instead of the link opening — the retargeting that has
      // already cost the delete ✕, the file card and a table cell.
      //
      // Title, URL and description were written by a stranger's web page.
      // They are hydrated with textContent by _boardsHydrateLinkCards, never
      // interpolated — the same boundary card text, comments and to-do items
      // hold, and the most obviously third-party strings in the whole file.
      const href=_boardsSafeHref(c.linkUrl);
      const showImg=c.linkImage&&!c.linkPreviewOff;
      body=`<div class="board-card-body board-link-preview"${drag}>
          ${showImg?`<img class="board-link-img" src="${_boardsEsc(_boardsDisplayUrl(c.linkImage,c.w))}" crossorigin="anonymous" draggable="false" onerror="window.boardsImgFallback(this)" alt="">`:''}
          <div class="board-link-meta">
            <div class="board-link-urlrow">
              <svg class="board-link-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-.7.7M9.5 6.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l.7-.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              <span class="link-url" id="board-linku-${c.id}"></span>
              ${c.linkImage&&canEdit?`<button class="board-link-eye${c.linkPreviewOff?' off':''}" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();window.boardsLinkTogglePreview('${c.id}')" title="${c.linkPreviewOff?'Show the preview picture':'Hide the preview picture'}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="3.3" width="12.4" height="9.4" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.8 10.5l3.4-3 3 2.6 2.2-2 3.8 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path class="eye-slash" d="M2 14L14 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>`:''}
            </div>
            <a class="link-title" id="board-linkt-${c.id}"${href?` href="${_boardsEsc(href)}" target="_blank" rel="noopener noreferrer"`:''} onpointerdown="event.stopPropagation()" title="Open this link in a new tab"></a>
            <div class="link-desc" id="board-linkd-${c.id}"></div>
          </div>
          ${c._fetching?'<div class="board-link-loading">Loading preview…</div>':''}
        </div>`;
    }
  }else if(c.type==='file'){
    if(c._uploading){
      body='<div class="board-card-body"><div class="board-card-empty">Uploading…</div></div>';
    }else if(c.fileUrl){
      // Best-effort PDF thumbnail: Cloudinary can rasterise page 1 of a PDF
      // through a delivery transform. If the account/preset won't do it the
      // <img> simply fails and onerror falls back to the plain file card —
      // never a broken image.
      const thumb=_boardsPdfThumbUrl(c.fileUrl);
      // Open and Download are explicit buttons, not only right-click items.
      // Milanote puts both on the card itself, and a tech pack you cannot
      // obviously save is a tech pack nobody finds. The <a> still covers the
      // thumbnail so the old click-anywhere-to-open habit keeps working, but
      // it can no longer WRAP the buttons — a <button> inside an <a> is
      // invalid and the anchor would win the click anyway.
      // Both carry the onpointerdown guard: this body starts a card drag
      // (see bodyDrag), and a control inside a drag handle whose pointerdown
      // reaches the handle gets its click retargeted away — the exact bug
      // that made the delete ✕ inert on every card for weeks.
      body=`<div class="board-card-body board-file-body"${bodyDrag} ondblclick="window.boardsFilePreview('${c.id}')">
        <a class="board-file-open" href="${_boardsEsc(c.fileUrl)}" target="_blank" rel="noopener noreferrer" draggable="false" onclick="if(event.ctrlKey||event.metaKey)return;event.preventDefault();" title="Double-click to preview">
          ${thumb?`<img class="board-file-thumb" src="${_boardsEsc(thumb)}" alt="" draggable="false" onerror="this.style.display='none'">`:''}
          <div class="board-file-meta">
            <span class="board-file-ext">${_boardsEsc(_boardsFileExt(c.fileName))}</span>
            <span class="board-file-name">${_boardsEsc(c.name||c.fileName||'File')}</span>
            <span class="board-file-size">${_boardsEsc(_boardsFormatBytes(c.fileSize))}</span>
          </div>
        </a>
        <div class="board-file-actions">
          <button onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();window.boardsFileOpen('${c.id}')">Open</button>
          <button onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();window.boardsFileDownload('${c.id}')">Download</button>
        </div>
      </div>`;
    }else{
      body=canEdit
        ?`<label class="board-card-empty" for="board-fileinput-${c.id}">Click to choose a file<input type="file" id="board-fileinput-${c.id}" onchange="window.boardsUploadToCard('${c.id}',this)" style="display:none"></label>`
        :'<div class="board-card-empty">No file</div>';
      body=`<div class="board-card-body" style="padding:0"${bodyDrag}>${body}</div>`;
    }
  }else if(c.type==='table'){
    // Cells follow the same click/double-click rule as every other card
    // body: contenteditable="false" until boardsBeginEdit switches exactly
    // one on, so a single click still selects and drags the card. Text is
    // hydrated with textContent after render — never interpolated.
    const rows=Array.isArray(c.rows)&&c.rows.length?c.rows:[['','']];
    const ncols=(rows[0]||[]).length;
    // The A/B/C band and the 1/2/3/4 gutter. Milanote raises them only
    // while the table is selected; ours are always present and simply
    // DIMMED when it is not. Two reasons: they are the reference grammar
    // for formulas, so hiding them hides the feature, and showing them
    // only on selection would either reflow the table under the pointer or
    // need an overlay escaping a card that clips its own content.
    body=`<div class="board-card-body board-table-body"${bodyDrag}>
      <div class="board-table-scroll">
      <table class="board-table${c.head===false?'':' with-head'}">
        <tr class="board-tr-coords"><td class="board-coord board-coord-corner"></td>${
          Array.from({length:ncols},(_,i)=>`<td class="board-coord">${_boardsColName(i)}</td>`).join('')
        }</tr>
        ${rows.map((row,r)=>`<tr><td class="board-coord">${r+1}</td>${row.map((cell,i)=>{
          const tag=(c.head!==false&&r===0)?'th':'td';
          const st=_boardsCellStyle(cell,c);
          const foc=_boardsCellFocus&&_boardsCellFocus.id===c.id&&_boardsCellFocus.r===r&&_boardsCellFocus.i===i;
          const cls=`board-td${foc?' focused':''}${_boardsCellClass(cell,c)}`;
          // THE CELL MUST STOP POINTERDOWN, or it can never be edited.
          // boardsCardDragStart calls setPointerCapture on the card body,
          // and a captured pointer RETARGETS the following click and
          // dblclick to the capturing element. A note survives that because
          // its ondblclick sits on the very element carrying the drag
          // handler; a cell's sits on a descendant, so the cell's handler
          // never ran and the dblclick bubbled to the stage — which is why
          // double-clicking a table spawned a stray note instead of
          // putting a caret in the cell. Same guard the delete X, the card
          // name and the comment badge already carry.
          // The cost: a table no longer drags by its cells. It drags by its
          // header strip and by the A/B/C band and row gutter, which are
          // chrome and deliberately keep the drag.
          const stopDown=canEdit?' onpointerdown="event.stopPropagation()"':'';
          // A checkbox toggles on a SINGLE click, so it needs the guard
          // every control inside a drag surface needs: without stopping
          // pointerdown the header captures the pointer and the click is
          // retargeted away — the delete-X bug, in a new place.
          if(_boardsCellType(cell)==='check'){
            return`<${tag} id="board-td-${c.id}-${r}-${i}" class="${cls}"${st?` style="${st}"`:''} title="${_boardsCellRef(r,i)}"${stopDown}${canEdit?` onclick="event.stopPropagation();window.boardsCellToggle('${c.id}',${r},${i})"`:''}></${tag}>`;
          }
          return`<${tag} id="board-td-${c.id}-${r}-${i}" class="${cls}" contenteditable="false"${st?` style="${st}"`:''}${stopDown} ${canEdit?`ondblclick="window.boardsFocusCell(event,'${c.id}',${r},${i})"`:''} oninput="window.boardsTableInput('${c.id}',${r},${i},this)"></${tag}>`;
        }).join('')}</tr>`).join('')}
      </table>
      </div>
      ${canEdit?`<div class="board-table-add">
        <button onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();window.boardsTableAdd('${c.id}','row')" title="Add a row">+ Row</button>
        <button onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();window.boardsTableAdd('${c.id}','col')" title="Add a column">+ Col</button>
      </div>`:''}
    </div>`;
  }else if(c.type==='heading'){
    // A section banner — the thing Afnan's real Milanote board uses to
    // title every cluster. Its drag strip fades out until hover so it
    // reads as a banner rather than as another card.
    body=`<div class="board-card-body board-heading-body"${bodyDrag} contenteditable="false" id="board-txt-${c.id}" data-placeholder="Section title" ${canEdit?`ondblclick="window.boardsBeginEdit(event,'board-txt-${c.id}')"`:''} oninput="window.boardsTextInput('${c.id}',this)"></div>`;
  }else if(c.type==='board'){
    // A link to a nested board. The title is read LIVE from moodBoards so
    // renaming the child updates every card pointing at it; the stored
    // boardTitle is only a fallback for a board this viewer can't read.
    const child=_boardsLiveById()[c.boardId];
    const title=(child&&child.title)||c.boardTitle||'Untitled board';
    const n=child?(child.cards||[]).length:0;
    // Three states, and the broken one has to be FIXABLE. Cards minted by
    // the old rail bug carry boardId:'' — they rendered a dead "Missing
    // board" line with no way forward, so the card could only be deleted.
    // A card that links to something must either link to it or offer to
    // create it.
    /* THE CARD IS A SPINE, A NAME AND WHAT IS INSIDE (option D). The
       board's face runs down the left edge, the whole name gets two lines
       beside it, and a strip of the board's own thumbnails says what it
       holds. The face still comes from _boardsFaceOf, the one place that
       decides what a board looks like, so the card, the gallery tile and
       the panel row can never disagree.

       The spine paints the COVER when there is one. The picture is the
       identity a person chose for that board, and it must not be demoted to
       a 30px chip in the strip below — the strip is for contents. With no
       cover it is the board's colour carrying its icon or first letter,
       which is what the specimen showed. */
    const face=_boardsFaceOf(child);
    const files=child?_boardsCountFiles(child.cards):0;
    const th=child?_boardsBoardThumbs(child):{urls:[],rest:0};
    /* The state word is from the specimen and costs nothing — visibility is
       already on the board document and the panel row already prints it. */
    const state=child?(child.visibility==='shared'?'TEAM':'PRIVATE'):'';
    const meta=child
      ?[state,n+' card'+(n===1?'':'s')].concat(files?[files+' file'+(files===1?'':'s')]:[]).join(' · ')
      :(c.boardId?'Not available — deleted, or private to someone else':'No board linked yet');
    /* NO "Open" PILL ON A POINTER DEVICE (Sept 2026 — Afnan: "open text is
       not required"). Double-click opens it, the idle corner glow says the
       card is openable and the hover line says how. On a PHONE none of
       that is reachable — there is no hover, and `dblclick` is not
       dependable once .board-stage has taken touch-action (the reason
       double-tap-to-place is paired by hand), so the pill stays there
       rather than leaving a board with no way in but a long-press. The
       repair button is NOT the same thing and always shows: an orphan card
       is unusable until it is adopted. */
    const open=c.boardId
      ?(child&&_boardsIsPhone()?`<button class="board-subboard-open" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();window.boardsGoto('${c.boardId}')">Open</button>`:'')
      :(canEdit?`<button class="board-subboard-open" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();window.boardsRepairBoardCard('${c.id}')">Create</button>`:'');
    // Every picture here is drawn with the same three guards every board
    // image carries: a sized derivative, CORS (so the PNG/PDF export can
    // read it back) and no native HTML5 drag.
    const spine=face.cover
      ?`<div class="board-subboard-spine has-cover" style="background:${face.color||'var(--soft)'}"><img src="${_boardsEsc(_boardsDisplayUrl(face.cover,400))}" crossorigin="anonymous" draggable="false" onerror="window.boardsImgFallback(this)" alt=""></div>`
      :`<div class="board-subboard-spine" style="background:${face.color||'var(--soft)'};color:${face.color?_boardsInkOn(face.color):'var(--muted)'}"><span class="board-subboard-glyph">${_boardsEsc(face.glyph)}</span></div>`;
    const thumbs=th.urls.length
      ?`<div class="board-subboard-thumbs">${th.urls.map(u=>`<span class="board-subboard-thumb"><img src="${_boardsEsc(_boardsDisplayUrl(u,400))}" crossorigin="anonymous" draggable="false" onerror="window.boardsImgFallback(this)" alt=""></span>`).join('')}${th.rest?`<span class="board-subboard-thumb board-subboard-more">+${th.rest}</span>`:''}</div>`
      :'';
    // Double-click opens it. The handler sits on the very element carrying
    // the drag handler, so the pointer capture cannot retarget it away —
    // the rule the to-do item and the table cell both learned the hard way.
    /* `openable` is what the idle glow and the hover line hang off, so a
       board that is gone or not linked yet gets neither — nothing should
       invite a double-click that cannot do anything. */
    body=`<div class="board-card-body board-subboard-body${child?' openable':''}"${bodyDrag}${child?` ondblclick="window.boardsGoto('${c.boardId}')"`:''}>
      ${spine}
      <div class="board-subboard-info">
        <div class="board-subboard-title">${_boardsEsc(title)}</div>
        <div class="board-subboard-meta">${_boardsEsc(meta)}</div>
        ${thumbs}
      </div>
      ${child?`<div class="board-subboard-cta"><span>${_BOARDS_OPEN_PHRASE}</span></div>`:''}
      ${open}
    </div>`;
  }else{
    body=`<div class="board-card-body board-text-body"${bodyDrag} contenteditable="false" id="board-txt-${c.id}" data-placeholder="Double-click to type…" ${canEdit?`ondblclick="window.boardsBeginEdit(event,'board-txt-${c.id}')"`:''} oninput="window.boardsTextInput('${c.id}',this)"></div>`;
  }
  if((c.type==='image'||c.type==='file'||c.type==='table')&&c.caption!=null){
    // Reported twice in QA as "the caption doesn't save". It always saved —
    // you could never TYPE. Card bodies are contenteditable="false" until
    // boardsBeginEdit switches exactly one on, and a caption inherited the
    // double-click rule from cards whose bodies are also drag surfaces. A
    // caption is not: it sits OUTSIDE the body div, has no drag handler, and
    // its placeholder reads "Add a caption…", which promises a field. So a
    // single click opens it. Keep the ondblclick too — a double-click on a
    // field must not be a dead gesture.
    body+=`<div class="board-caption" id="board-cap-${c.id}" contenteditable="false" data-placeholder="Add a caption…" ${canEdit?`onclick="window.boardsBeginEdit(event,'board-cap-${c.id}')" ondblclick="window.boardsBeginEdit(event,'board-cap-${c.id}')"`:''} oninput="window.boardsCaptionInput('${c.id}',this)"></div>`;
  }
  const kind=c.type==='image'?'Image':c.type==='link'?'Link':c.type==='file'?'File':c.type==='board'?'Board':c.type==='heading'?'Heading':c.type==='todo'?('To-do'+(c._todoProgress?' · '+c._todoProgress:''))
    :c.type==='table'?'Table':c.type==='column'?'Column':c.type==='frame'?'Frame':'Note';
  const sel=_boardsSelection.has(c.id)?' selected':'';
  const lock=c.locked?' locked':'';
  const tint=(c.color?' tint-'+c.color:'')+(c.bg?' bg-'+c.bg:'');
  const drawH=Math.max(c.h,_boardsMinCardH(c));
  return`<div class="board-card-el type-${c.type}${sel}${lock}${tint}" id="board-card-${c.id}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${drawH}px" onclick="window.boardsSelectCard('${c.id}',event)">
    <div class="board-card-head" ${canEdit?`onpointerdown="window.boardsCardDragStart(event,'${c.id}')" ondblclick="window.boardsHeadDblClick(event,'${c.id}')"`:''}>
      <span class="board-card-kind">
        <span class="board-card-name" id="board-name-${c.id}" contenteditable="false" data-placeholder="${_boardsEsc(kind)}" ${canEdit?`ondblclick="window.boardsBeginEdit(event,'board-name-${c.id}')"`:''} oninput="window.boardsCardName('${c.id}',this)" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()" title="Double-click to rename this card"></span>${c.locked?' · Locked':''}</span>
      <span style="display:flex;align-items:center;gap:4px">
        <button class="board-cmt-badge" id="board-cmt-${c.id}" style="display:none" title="Comments on this card" onclick="event.stopPropagation();window.boardsOpenComments('${c.id}')" onpointerdown="event.stopPropagation()"></button>
        ${canEdit&&!c.locked?`<button class="board-card-del" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();window.boardsDeleteCard('${c.id}')" title="Delete">✕</button>`:''}
      </span>
    </div>
    ${_boardsLabelsHTML(c)}
    ${body}
    ${_boardsReactionsHTML(c)}
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

// ── Labels and reactions ────────────────────────────────────────────────
// Both were on the "deliberately missing vs Milanote" list until Afnan sent
// the phone screenshots showing them as first-class actions on a selected
// card, alongside Color and Comment.
//
// LABELS live on the card (c.labels = [{t,c}]), and the board's label
// "library" is DERIVED from whatever labels the cards already carry rather
// than stored anywhere — the same discipline as frame membership and
// nesting. A stored library means a second thing to keep in step on every
// rename, delete, undo and paste, and orphan states when any of that fails.
// Deriving it costs one pass over cards that are already in memory.
//
// REACTIONS are c.reactions = {'👍':[uid,…]} — uids, not counts, so the
// same person cannot stack a reaction and so "did I react?" is answerable
// without a second field. Toggling is one uid in or out of one array.
const _BOARDS_LABEL_COLORS=['grey','red','amber','green','blue','purple'];
// A curated set rather than a full emoji picker: a searchable index of
// every emoji needs a name dataset this repo has no business shipping, and
// these are the ones that actually get used on a working board.
const _BOARDS_REACTIONS=[
  {e:'👍',k:'thumbs up yes ok approve good'},
  {e:'👎',k:'thumbs down no reject bad'},
  {e:'❤️',k:'heart love'},
  {e:'🔥',k:'fire hot great'},
  {e:'🎉',k:'party celebrate done tada'},
  {e:'✅',k:'check tick done approved'},
  {e:'❌',k:'cross no wrong reject'},
  {e:'⚠️',k:'warning careful risk'},
  {e:'👀',k:'eyes look review watching'},
  {e:'🤔',k:'thinking hmm question'},
  {e:'😍',k:'love heart eyes'},
  {e:'😂',k:'laugh funny joy'},
  {e:'😀',k:'smile happy'},
  {e:'😊',k:'blush happy smile'},
  {e:'☹️',k:'sad frown unhappy'},
  {e:'🙌',k:'hands celebrate praise'},
  {e:'👏',k:'clap applause well done'},
  {e:'🙏',k:'thanks please pray'},
  {e:'💯',k:'hundred perfect'},
  {e:'🚀',k:'rocket ship launch fast'},
  {e:'⭐',k:'star favourite'},
  {e:'💡',k:'idea light bulb'},
  {e:'📌',k:'pin important'},
  {e:'⏰',k:'time clock deadline urgent'},
  {e:'💰',k:'money cost price'},
  {e:'✂️',k:'cut scissors cutting'},
  {e:'🧵',k:'thread stitch sewing'},
  {e:'🧥',k:'jacket garment coat'},
  {e:'👖',k:'jeans denim pants trouser'},
  {e:'👕',k:'shirt tee tshirt'},
  {e:'🎨',k:'colour color paint design'},
  {e:'📏',k:'measure size ruler spec'}
];
// Labels and reactions are flex rows in the same column as the card body,
// so on a small card they take their height straight OUT of it. On the
// default 104px sub-board card, one label plus one reaction left the body
// ~50px with justify-content:center — the title was clipped away and all
// you could read was "Board · 👍1". Reported in QA twice.
//
// The fix is to grow the CARD, not to overlay the rows: an overlay puts
// them on top of the content instead of beside it, which is the same bug
// with extra steps. Two halves, and both are needed:
//   - the render and the resize clamp both use this minimum, so a card that
//     was written small before this shipped displays correctly with no
//     migration and no write;
//   - adding a label or a reaction also raises c.h, so the stored value
//     catches up the moment anyone touches the card.
// Raised with the Sept 2026 card-text bump. These are the heights the
// chrome rows ACTUALLY occupy, so they move whenever the text inside them
// does — leave them behind and the body keeps its old share, which is how a
// reactions row ends up painted over a sub-board card's "Open →" button
// (caught by smoke-layout, not by reading the diff).
const _BOARDS_CHROME_H={head:28,labels:25,reactions:28,caption:27};
// board:108 is MEASURED, not chosen. The spine card's tallest honest
// content at the width a board card is born at (_BOARDS_BOARD_W) is a
// two-line name + the meta line + a thumbnail strip = 107px of body; 108
// clears it. It came down from 124 when the card became a wide rectangle,
// and it only stayed honest because the meta line is now a single
// ellipsized line (css/main.css, .board-subboard-meta) - while it wrapped,
// this number had to cover the NARROWEST card anyone might drag to, which
// is a different thing from the shortest a card should be allowed to be.
const _BOARDS_MIN_BODY_H={board:108,image:92,file:100,link:104,todo:80,heading:36,text:52};
function _boardsMinCardH(c){
  if(!c||c.type==='frame')return 60;
  if(c.type==='column')return c.h||_BOARDS_COL_MIN_H;   // derived by _boardsLayoutColumn
  if(c.type==='table')return Math.max(_boardsTableMinH(c),90);
  // A heading's head strip is absolutely positioned over the banner, so it
  // costs the column nothing.
  let h=c.type==='heading'?0:_BOARDS_CHROME_H.head;
  if(Array.isArray(c.labels)&&c.labels.length)h+=_BOARDS_CHROME_H.labels;
  if(c.reactions&&Object.keys(c.reactions).length)h+=_BOARDS_CHROME_H.reactions;
  if((c.type==='image'||c.type==='file'||c.type==='table')&&c.caption!=null)h+=_BOARDS_CHROME_H.caption;
  return h+(_BOARDS_MIN_BODY_H[c.type]||48);
}
function _boardsGrowForChrome(c){
  const min=_boardsMinCardH(c);
  if(c&&c.h<min)c.h=min;
}
function _boardsLabelsHTML(c){
  const ls=Array.isArray(c.labels)?c.labels:[];
  if(!ls.length)return'';
  // Text via data-label + a textContent pass, never interpolated — same
  // boundary as every other user string on a card.
  return`<div class="board-labels" id="board-labels-${c.id}">${
    ls.map((l,i)=>`<span class="board-label lc-${_BOARDS_LABEL_COLORS.indexOf(l&&l.c)>=0?l.c:'grey'}" id="board-label-${c.id}-${i}"></span>`).join('')}</div>`;
}
function _boardsReactionsHTML(c){
  const r=c.reactions&&typeof c.reactions==='object'?c.reactions:null;
  if(!r)return'';
  const keys=Object.keys(r).filter(k=>Array.isArray(r[k])&&r[k].length);
  if(!keys.length)return'';
  const me=(typeof session!=='undefined'&&session&&session.uid)||'';
  return`<div class="board-reactions">${keys.map(k=>
    `<button class="board-reaction${r[k].indexOf(me)>=0?' mine':''}" onclick="event.stopPropagation();window.boardsToggleReaction('${c.id}',this.getAttribute('data-e'))" onpointerdown="event.stopPropagation()" data-e="${_boardsEsc(k)}">${_boardsEsc(k)} ${r[k].length}</button>`
  ).join('')}</div>`;
}
// Every label the board already uses, deduplicated, most-used first — the
// picker's suggestions, derived on read.
function _boardsLabelLibrary(){
  const seen=new Map();
  _editCards.forEach(c=>(Array.isArray(c.labels)?c.labels:[]).forEach(l=>{
    if(!l||!l.t)return;
    const k=String(l.t).toLowerCase();
    const hit=seen.get(k);
    if(hit)hit.n++;else seen.set(k,{t:String(l.t),c:l.c||'grey',n:1});
  }));
  return Array.from(seen.values()).sort((a,b)=>b.n-a.n);
}
window.boardsToggleReaction=function(cardId,emoji){
  const c=_editCards.find(x=>x.id===cardId);
  if(!c||!_boardsCanEdit(_editBoard))return;
  const me=(typeof session!=='undefined'&&session&&session.uid)||'';
  if(!me)return;
  _boardsPushUndo();
  if(!c.reactions||typeof c.reactions!=='object')c.reactions={};
  const who=Array.isArray(c.reactions[emoji])?c.reactions[emoji]:[];
  const i=who.indexOf(me);
  if(i>=0)who.splice(i,1);else who.push(me);
  if(who.length)c.reactions[emoji]=who;else delete c.reactions[emoji];
  if(!Object.keys(c.reactions).length)delete c.reactions;
  _boardsGrowForChrome(c);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
window.boardsAddLabel=function(cardId,text,color){
  const c=_editCards.find(x=>x.id===cardId);
  if(!c||!_boardsCanEdit(_editBoard))return;
  const t=String(text||'').replace(/\s+/g,' ').trim().slice(0,28);
  if(!t)return;
  const ls=Array.isArray(c.labels)?c.labels:[];
  if(ls.some(l=>l&&String(l.t).toLowerCase()===t.toLowerCase()))return;
  _boardsPushUndo();
  ls.push({t,c:_BOARDS_LABEL_COLORS.indexOf(color)>=0?color:'grey'});
  c.labels=ls;
  _boardsGrowForChrome(c);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
window.boardsRemoveLabel=function(cardId,text){
  const c=_editCards.find(x=>x.id===cardId);
  if(!c||!_boardsCanEdit(_editBoard))return;
  const ls=Array.isArray(c.labels)?c.labels:[];
  const i=ls.findIndex(l=>l&&String(l.t).toLowerCase()===String(text).toLowerCase());
  if(i<0)return;
  _boardsPushUndo();
  ls.splice(i,1);
  if(ls.length)c.labels=ls;else delete c.labels;
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};

// ── Board identity: colour and icon ─────────────────────────────────────
// Afnan's Milanote gallery is read by shape and colour, not by reading
// titles — every board is a coloured tile with an icon on it, and a new
// board asks you for those straight away. Two plain fields on the board
// document do it: b.color (a validated hex) and b.icon (one emoji).
//
// Neither is required and neither has a migration: a board without them
// falls back to a neutral tile carrying the first letter of its title,
// which is what every board written before this shows.
const _BOARDS_TILE_COLORS=[
  '#CFD3D8','#5B6472','#3FCFAF','#66C94D','#CC7A47','#F5C230','#F08A28',
  '#F2564B','#F556B8','#A970F5','#39A9F5','#4B6BF5',
  '#7B1F2A','#35507A','#14532D','#B47512','#7A4B7C','#3E6B6B','#111111'
];
function _boardsValidHex(v){
  const h=String(v||'').trim();
  return /^#[0-9a-fA-F]{6}$/.test(h)?h.toUpperCase():'';
}
// A readable foreground for an arbitrary background, so a custom colour
// can't produce white-on-yellow. Rec. 601 luma, the usual cheap test.
function _boardsInkOn(hex){
  const h=_boardsValidHex(hex);
  if(!h)return'var(--text)';
  const r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16);
  return(r*299+g*587+b*114)/1000>150?'#111111':'#FFFFFF';
}
/**
 * A board's own picture. Only an https://res.cloudinary.com/… URL is
 * accepted, ANCHORED — the string goes straight into an <img src>, and a
 * lookalike host like res.cloudinary.com.evil.test must not pass. Same rule
 * and same reasoning as _profPhotoUrl in js/profile.js; it is duplicated
 * rather than shared because profile.js loads AFTER this file.
 */
function _boardsCoverUrl(u){
  const s=String(u||'');
  return /^https:\/\/res\.cloudinary\.com\//.test(s)?s:'';
}
/**
 * The tile a board is recognised by. Three things can fill it, in order:
 * an uploaded PICTURE, an emoji ICON, or the first letter of its name —
 * so a board always has one and nothing has to migrate. The colour is the
 * background behind the last two and a thin frame behind the first.
 */
/* "How many files are in this board" had two identical copies — the gallery
   card and the panel row — and the board CARD now needs a third. One. */
function _boardsCountFiles(cards){
  return (cards||[]).filter(c=>(c.type==='file'&&c.fileUrl)||(c.type==='image'&&c.imageUrl)).length;
}
/* WHAT A BOARD LOOKS LIKE, decided in ONE place (Sept 2026).
   A board carries a cover picture, a colour and an icon/letter, and three
   surfaces draw them now: the gallery tile, the Boards panel row and the
   board CARD on a canvas. The order is the whole decision — uploaded
   picture, then the icon or first letter on the board's colour — and three
   copies of it would disagree the first time one learned something. The
   glyph is never empty: a board with no icon and no title still shows '?'
   rather than a blank square. */
function _boardsFaceOf(b){
  const icon=String((b&&b.icon)||'').slice(0,4);
  const letter=String((b&&b.title)||'?').trim().charAt(0).toUpperCase()||'?';
  return{
    cover:_boardsCoverUrl(b&&b.coverUrl),
    color:_boardsValidHex(b&&b.color)||'',
    glyph:icon||letter
  };
}
/* The strip of real thumbnails at the foot of a board card — the half of
   option D that says what is INSIDE a board rather than only what it is
   called. DERIVED from the child board's own cards on every render, exactly
   like the gallery tile's live preview, so it cannot go stale against the
   board it describes; nothing new is stored and nothing migrates.

   Image cards only. A file card's page-1 thumbnail is best-effort by design
   (see _boardsPdfThumbUrl — the <img> carries an onerror that hides it), and
   a strip with holes punched in it says less than a shorter strip with
   none. `rest` counts the cards the strip could not show, so the +N chip
   answers "and what else", not "and how many pictures". */
const _BOARDS_THUMB_MAX=3;
function _boardsBoardThumbs(child){
  const cards=(child&&child.cards)||[];
  const urls=[];
  for(let i=0;i<cards.length&&urls.length<_BOARDS_THUMB_MAX;i++){
    const c=cards[i];
    if(c&&c.type==='image'&&c.imageUrl)urls.push(c.imageUrl);
  }
  return{urls:urls,rest:Math.max(0,cards.length-urls.length)};
}
function _boardsTileHTML(b,size){
  const px=size||36;
  const f=_boardsFaceOf(b);
  if(f.cover){
    return`<span class="board-tile board-tile-img" style="width:${px}px;height:${px}px;background:${f.color||'var(--soft)'}"><img src="${_boardsEsc(_boardsDisplayUrl(f.cover,px*2))}" crossorigin="anonymous" draggable="false" onerror="window.boardsImgFallback(this)" alt=""></span>`;
  }
  return`<span class="board-tile" style="width:${px}px;height:${px}px;background:${f.color||'var(--soft)'};color:${f.color?_boardsInkOn(f.color):'var(--muted)'};font-size:${Math.round(px*0.52)}px">${_boardsEsc(f.glyph)}</span>`;
}
async function _boardsSaveIdentity(id,patch){
  const b=moodBoards.find(x=>x.id===id);
  if(!b||!_boardsCanEdit(b))return;
  try{
    await _qUpdate(doc(db,'mood_boards',id),Object.assign({updatedAt:Date.now(),updatedByName:session.name},patch));
    Object.keys(patch).forEach(k=>{if(patch[k]===null)delete b[k];else b[k]=patch[k];});
    if(_editBoard&&_editBoard.id===id)Object.keys(patch).forEach(k=>{if(patch[k]===null)delete _editBoard[k];else _editBoard[k]=patch[k];});
    if(currentPage==='boards')_boardsRerenderGallery();
  }catch(e){showToast('Could not save: '+(e.message||e),true);}
}

// ── Colour picker: presets, then a real custom picker ──
// HSV sliders rather than <input type="color">, which on Android opens the
// OS dialog and on desktop is a different dialog again — three ranges look
// and behave the same everywhere, and their gradients are plain CSS.
function _boardsHsvToHex(h,sv,v){
  const S=sv/100,V=v/100;
  const c=V*S,x=c*(1-Math.abs(((h/60)%2)-1)),m=V-c;
  let r=0,g=0,bl=0;
  if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}
  else if(h<180){g=c;bl=x;}else if(h<240){g=x;bl=c;}
  else if(h<300){r=x;bl=c;}else{r=c;bl=x;}
  const to=n=>('0'+Math.round((n+m)*255).toString(16)).slice(-2).toUpperCase();
  return'#'+to(r)+to(g)+to(bl);
}
let _boardsColorTarget=null;   // {kind:'board', id} — who the picker is for
window.boardsOpenColorPicker=function(kind,id){
  _boardsColorTarget={kind,id};
  _boardsRenderColorSheet();
};
// The picker serves two kinds of target now: a BOARD's identity colour and
// a LINE's stroke. Routing here keeps every call site below ignorant of the
// difference — the alternative was four of them each growing a branch.
function _boardsColorCurrent(){
  const t=_boardsColorTarget;if(!t)return'';
  if(t.kind==='conn'){const cn=_boardsConnById(t.id);return _boardsValidHex(cn&&cn.color);}
  const b=moodBoards.find(x=>x.id===t.id);
  return _boardsValidHex(b&&b.color);
}
function _boardsColorApply(hex){
  const t=_boardsColorTarget;if(!t)return;
  if(t.kind==='conn'){window.boardsSetConn(t.id,{color:hex||null});return;}
  _boardsSaveIdentity(t.id,{color:hex||null});
}
function _boardsRenderColorSheet(){
  const t=_boardsColorTarget;if(!t)return;
  const cur=_boardsColorCurrent();
  _boardsOpenSheet('Colour',`
    <div class="board-tile-swatches">
      <button class="board-tile-sw none${cur?'':' on'}" title="No colour" onclick="window.boardsPickTileColor('')"></button>
      ${_BOARDS_TILE_COLORS.map(c=>`<button class="board-tile-sw${cur===c?' on':''}" style="background:${c}" title="${c}" onclick="window.boardsPickTileColor('${c}')"></button>`).join('')}
    </div>
    <button class="board-custom-btn" onclick="window.boardsOpenCustomColor()"><span class="board-custom-wheel"></span>Custom colour…</button>`);
}
window.boardsPickTileColor=function(hex){
  if(!_boardsColorTarget)return;
  window.boardsCloseSheet();
  _boardsColorApply(_boardsValidHex(hex));
};
window.boardsOpenCustomColor=function(){
  const t=_boardsColorTarget;if(!t)return;
  const start=_boardsColorCurrent()||'#3FCFAF';
  _boardsOpenSheet('Select colour',`
    <div class="board-hsv">
      <label>Hue</label>
      <input type="range" id="bhsv-h" min="0" max="359" value="170" oninput="window.boardsHsvInput()">
      <label>Saturation</label>
      <input type="range" id="bhsv-s" min="0" max="100" value="70" oninput="window.boardsHsvInput()">
      <label>Value</label>
      <input type="range" id="bhsv-v" min="0" max="100" value="85" oninput="window.boardsHsvInput()">
      <div class="board-hsv-foot">
        <button class="board-hsv-back" onclick="window.boardsOpenColorPicker('${t.kind}','${t.id}')">‹ Presets</button>
        <span class="board-hsv-chosen">Chosen <i id="bhsv-prev" style="background:${start}"></i></span>
        <button class="btn-sm" onclick="window.boardsHsvSet()">Set</button>
      </div>
    </div>`);
  window.boardsHsvInput();
};
window.boardsHsvInput=function(){
  const h=+(document.getElementById('bhsv-h')||{}).value||0;
  const sv=+(document.getElementById('bhsv-s')||{}).value||0;
  const v=+(document.getElementById('bhsv-v')||{}).value||0;
  const hex=_boardsHsvToHex(h,sv,v);
  const prev=document.getElementById('bhsv-prev');
  if(prev)prev.style.background=hex;
  // Each slider previews what it would do at the OTHER two's current
  // settings — the saturation bar greys out as value drops, exactly as in
  // the OS picker Afnan screenshotted. Pure CSS gradients, no canvas.
  const sEl=document.getElementById('bhsv-s'),vEl=document.getElementById('bhsv-v'),hEl=document.getElementById('bhsv-h');
  if(sEl)sEl.style.background=`linear-gradient(90deg,${_boardsHsvToHex(h,0,v)},${_boardsHsvToHex(h,100,v)})`;
  if(vEl)vEl.style.background=`linear-gradient(90deg,#000,${_boardsHsvToHex(h,sv,100)})`;
  if(hEl)hEl.style.background=`linear-gradient(90deg,${[0,60,120,180,240,300,359].map(x=>_boardsHsvToHex(x,sv,v)).join(',')})`;
};
window.boardsHsvSet=function(){
  if(!_boardsColorTarget)return;
  const h=+(document.getElementById('bhsv-h')||{}).value||0;
  const sv=+(document.getElementById('bhsv-s')||{}).value||0;
  const v=+(document.getElementById('bhsv-v')||{}).value||0;
  window.boardsCloseSheet();
  _boardsColorApply(_boardsHsvToHex(h,sv,v));
};

// ── Icon picker ──
const _BOARDS_TILE_ICONS=['👖','👕','🧥','🧵','✂️','🎨','📐','📏','🏷️','📦','🚚','🏭','🧶','👟','🕶️','💎',
  '📸','🎬','🖼️','📁','📄','📊','📌','⭐','🔥','❄️','☀️','🌧️','🌊','🌿','🏠','🏬',
  '💡','⚡','🎯','🏆','💰','🧾','🔒','🔔','✅','⏳','🗓️','🧪','🔍','❤️','🖤','🌙'];
let _boardsIconTarget=null;
window.boardsOpenIconPicker=function(id){
  _boardsIconTarget=id;
  const b=moodBoards.find(x=>x.id===id);
  const cur=String((b&&b.icon)||'');
  _boardsOpenSheet('Icon',`
    <div class="board-emoji-grid">
      <button class="board-emoji${cur?'':' on'}" title="No icon" onclick="window.boardsPickIcon('')">—</button>
      ${_BOARDS_TILE_ICONS.map(e=>`<button class="board-emoji${cur===e?' on':''}" onclick="window.boardsPickIcon('${e}')">${e}</button>`).join('')}
    </div>`);
};
// Uploading a board's picture. One hidden <input type=file> lives in the
// document for the whole module rather than one per row — a picker per
// board in a list of forty is forty elements to keep in step, and the
// browser only ever has one dialog open anyway.
let _boardsCoverTarget=null;
window.boardsPickCover=function(id){
  const b=moodBoards.find(x=>x.id===id);
  if(!b||!_boardsCanEdit(b))return;
  _boardsCoverTarget=id;
  let el=document.getElementById('board-cover-picker');
  if(!el){
    el=document.createElement('input');
    el.type='file';el.id='board-cover-picker';el.accept='image/*';el.style.display='none';
    el.onchange=function(){window.boardsCoverPicked(this);};
    document.body.appendChild(el);
  }
  el.click();
};
window.boardsCoverPicked=async function(inputEl){
  const file=(inputEl.files||[])[0];
  inputEl.value='';
  const id=_boardsCoverTarget;
  if(!file||!id)return;
  const b=moodBoards.find(x=>x.id===id);
  if(!b||!_boardsCanEdit(b))return;
  showToast('Uploading picture…');
  try{
    const res=await _boardsUploadAny(file);
    const url=_boardsCoverUrl(res.secure_url);
    // Cloudinary answering with something that is not a Cloudinary URL is
    // not a thing that should ever happen, and is exactly the moment not to
    // write it into a field every viewer renders as an <img src>.
    if(!url)throw new Error('the upload came back with an address we do not accept');
    await _boardsSaveIdentity(id,{coverUrl:url});
    showToast('Picture set');
  }catch(e){showToast('Could not set the picture: '+((e&&e.message)||e),true);}
};
window.boardsPickIcon=function(e){
  const id=_boardsIconTarget;if(!id)return;
  window.boardsCloseSheet();
  _boardsSaveIdentity(id,{icon:e||null});
};

/* ── How a board LOOKS, in one place (Sept 2026) ────────────────────────
   Afnan: double-tapping a board's picture should let you "select color,
   upload image, assign text, assign number etc to board image however
   someone wants it".

   Four ways to fill one tile, so they belong on ONE sheet rather than
   behind four menu entries you have to know the names of — a person
   choosing how a board looks is comparing them, not picking a command.
   Milanote's own panel does the same (Recommended · Letters & numbers ·
   Upload an image).

   THEY ALL WRITE THE SAME TWO FIELDS. A letter, a number and an emoji are
   all `b.icon` — a short string the tile renders — so "assign text" and
   "assign number" needed no new field and no migration, and the picture is
   `b.coverUrl`, which wins over both. The colour is `b.color` underneath.
   The existing pickers are REUSED rather than reimplemented: Custom colour
   still hands off to the HSV sliders, and everything lands through
   `_boardsSaveIdentity`, the one writer. */
const _BOARDS_TILE_DIGITS=['0','1','2','3','4','5','6','7','8','9'];
let _boardsLookTarget=null;
window.boardsOpenBoardLook=function(id){
  const b=moodBoards.find(x=>x.id===id);
  if(!b){showToast('That board is not available');return;}
  if(!_boardsCanEdit(b)){showToast('You cannot change this board');return;}
  _boardsLookTarget=id;
  _boardsIconTarget=id;
  _boardsColorTarget={kind:'board',id};
  const cur=_boardsValidHex(b.color);
  const icon=String(b.icon||'');
  const cover=_boardsCoverUrl(b.coverUrl);
  _boardsOpenSheet('Board picture',`
    <div class="board-look">
      <div class="board-look-preview">${_boardsTileHTML(b,64)}<span class="board-look-hint">This is how the board is recognised — in the panel, on Home and in the boards list.</span></div>

      <div class="board-look-label">Colour</div>
      <div class="board-tile-swatches">
        <button class="board-tile-sw none${cur?'':' on'}" title="No colour" onclick="window.boardsLookColor('')"></button>
        ${_BOARDS_TILE_COLORS.map(c=>`<button class="board-tile-sw${cur===c?' on':''}" style="background:${c}" title="${c}" onclick="window.boardsLookColor('${c}')"></button>`).join('')}
      </div>
      <button class="board-custom-btn" onclick="window.boardsOpenCustomColor()"><span class="board-custom-wheel"></span>Custom colour…</button>

      <div class="board-look-label">Letter or number</div>
      <div class="board-look-row">
        <input type="text" id="board-look-text" class="board-look-input" maxlength="2"
          value="${_boardsEsc(icon.length<=2?icon:'')}" placeholder="e.g. W or 27"
          onkeydown="if(event.key==='Enter'){event.preventDefault();window.boardsLookText();}">
        <button class="btn-sm" onclick="window.boardsLookText()">Set</button>
      </div>
      <div class="board-look-digits">
        ${_BOARDS_TILE_DIGITS.map(d=>`<button class="board-look-digit${icon===d?' on':''}" onclick="window.boardsLookIcon('${d}')">${d}</button>`).join('')}
      </div>

      <div class="board-look-label">Icon</div>
      <div class="board-emoji-grid">
        <button class="board-emoji${icon?'':' on'}" title="No icon" onclick="window.boardsLookIcon('')">—</button>
        ${_BOARDS_TILE_ICONS.map(e=>`<button class="board-emoji${icon===e?' on':''}" onclick="window.boardsLookIcon('${e}')">${e}</button>`).join('')}
      </div>

      <div class="board-look-label">Picture</div>
      <div class="board-look-row">
        <button class="btn-sm" onclick="window.boardsLookUpload()">${cover?'Change picture…':'Upload a picture…'}</button>
        ${cover?`<button class="btn-sm" onclick="window.boardsLookIcon(null,true)">Remove picture</button>`:''}
      </div>
      <div class="board-look-note">A picture covers the letter and the icon. Remove it to go back to them.</div>
    </div>`);
};
// Each of these applies and REOPENS the sheet, so you can see what you just
// chose and keep going — a sheet that closed on every tap would make trying
// three colours three round trips.
function _boardsLookAfter(id){
  if(currentPage==='board-canvas'||currentPage==='boards')window.boardsOpenBoardLook(id);
}
window.boardsLookColor=async function(hex){
  const id=_boardsLookTarget;if(!id)return;
  await _boardsSaveIdentity(id,{color:_boardsValidHex(hex)||null});
  _boardsLookAfter(id);
};
window.boardsLookIcon=async function(e,removeCover){
  const id=_boardsLookTarget;if(!id)return;
  await _boardsSaveIdentity(id,removeCover?{coverUrl:null}:{icon:e||null});
  _boardsLookAfter(id);
};
// A letter or a number is the same field an emoji uses — two characters is
// as much as fits a tile legibly, and the input is capped at that rather
// than truncating something longer behind the person's back.
window.boardsLookText=async function(){
  const id=_boardsLookTarget;if(!id)return;
  const el=document.getElementById('board-look-text');
  const v=String((el&&el.value)||'').trim().slice(0,2);
  await _boardsSaveIdentity(id,{icon:v||null});
  _boardsLookAfter(id);
};
window.boardsLookUpload=function(){
  const id=_boardsLookTarget;if(!id)return;
  window.boardsCloseSheet();
  window.boardsPickCover(id);
};

// ── New-board setup ──
// A board created straight into the canvas is an "Untitled board" forever
// — that is how a gallery of them happens. Creation now offers the name,
// colour and icon first, the way Milanote's does, and Open is one tap
// away. It is a sheet, not a required step: dismissing it leaves a
// perfectly good board behind.
window.boardsOpenSetup=function(id){
  const b=moodBoards.find(x=>x.id===id);
  if(!b)return;
  _boardsOpenSheet('New board',`
    <div class="board-setup">
      <div class="board-setup-head">${_boardsTileHTML(b,46)}
        <input type="text" id="board-setup-name" value="${_boardsEsc(b.title||'')}" placeholder="Board name" maxlength="80">
      </div>
      <div class="board-setup-acts">
        <button class="rail-btn" onclick="window.boardsSetupSave('${id}',true);window.boardsOpenColorPicker('board','${id}')">${_boardsIcon('color')}<span>Colour</span></button>
        <button class="rail-btn" onclick="window.boardsSetupSave('${id}',true);window.boardsOpenIconPicker('${id}')">${_boardsIcon('reactions')}<span>Icon</span></button>
        <button class="rail-btn" onclick="window.boardsSetupSave('${id}');window.boardsOpen('${id}')">${_boardsIcon('open')}<span>Open</span></button>
      </div>
    </div>`);
  const inp=document.getElementById('board-setup-name');
  if(inp){inp.focus();try{inp.select();}catch(e){}}
};
window.boardsSetupSave=function(id,keepOpen){
  const inp=document.getElementById('board-setup-name');
  const b=moodBoards.find(x=>x.id===id);
  if(inp&&b){
    const title=String(inp.value||'').trim()||'Untitled board';
    if(title!==b.title)_boardsSaveIdentity(id,{title});
  }
  if(!keepOpen)window.boardsCloseSheet();
};

// ── The bottom sheet ────────────────────────────────────────────────────
// Milanote's phone UI answers everything with a sheet that slides up from
// the bottom, and it is the right shape here for the same reason: a
// touch target list you can reach with a thumb, not a menu anchored to a
// pointer that touch doesn't have. Labels, Reactions and More all render
// into this one host; only their contents differ.
window.boardsCloseSheet=function(){
  const el=document.getElementById('board-sheet');
  const bk=document.getElementById('board-sheet-back');
  if(el)el.remove();
  if(bk)bk.remove();
};
function _boardsOpenSheet(title,html){
  window.boardsCloseSheet();
  const bk=document.createElement('div');
  bk.id='board-sheet-back';bk.className='board-sheet-back';
  bk.addEventListener('click',()=>window.boardsCloseSheet());
  document.body.appendChild(bk);
  const el=document.createElement('div');
  el.id='board-sheet';el.className='board-sheet';
  el.innerHTML=`<div class="board-sheet-head"><span>${_boardsEsc(title)}</span><button class="board-sheet-done" onclick="window.boardsCloseSheet()">Done</button></div><div class="board-sheet-body">${html}</div>`;
  document.body.appendChild(el);
  return el;
}
function _boardsSelOne(){
  const s=_boardsSelectedCards();
  return s.length===1?s[0]:null;
}

// ── Labels ──
window.boardsOpenLabels=function(){
  const c=_boardsSelOne();
  if(!c){showToast('Select one card to label it');return;}
  _boardsRenderLabelSheet(c.id);
};
function _boardsRenderLabelSheet(cardId){
  const c=_editCards.find(x=>x.id===cardId);if(!c)return;
  const mine=Array.isArray(c.labels)?c.labels:[];
  const lib=_boardsLabelLibrary().filter(l=>!mine.some(m=>String(m.t).toLowerCase()===l.t.toLowerCase()));
  const el=_boardsOpenSheet('Labels',`
    <div class="board-sheet-row" id="board-label-mine"></div>
    ${lib.length?`<div class="board-sheet-label">Already on this board</div><div class="board-sheet-row" id="board-label-lib"></div>`:''}
    <div class="board-sheet-label">New label</div>
    <div class="board-label-new">
      <input type="text" id="board-label-input" placeholder="Label name" maxlength="28" onkeydown="if(event.key==='Enter')window.boardsLabelCommit('${cardId}')">
      <div class="board-label-swatches" id="board-label-swatches">${
        _BOARDS_LABEL_COLORS.map((k,i)=>`<button class="board-label-sw lc-${k}${i===0?' on':''}" data-c="${k}" onclick="window.boardsLabelPickColor(this)" title="${k}"></button>`).join('')}</div>
      <button class="btn-sm" onclick="window.boardsLabelCommit('${cardId}')">Add</button>
    </div>`);
  if(!el)return;
  // Label text is written in, never interpolated.
  const host=document.getElementById('board-label-mine');
  if(host){
    host.innerHTML=mine.length?mine.map((l,i)=>`<button class="board-label lc-${_BOARDS_LABEL_COLORS.indexOf(l&&l.c)>=0?l.c:'grey'} removable" id="board-lsheet-${i}" data-t=""></button>`).join(''):'<span class="board-sheet-empty">No labels on this card yet.</span>';
    mine.forEach((l,i)=>{
      const b=document.getElementById('board-lsheet-'+i);
      if(!b)return;
      b.textContent=(l.t||'')+'  ✕';
      b.onclick=()=>{window.boardsRemoveLabel(cardId,l.t);_boardsRenderLabelSheet(cardId);};
    });
  }
  const libHost=document.getElementById('board-label-lib');
  if(libHost){
    libHost.innerHTML=lib.map((l,i)=>`<button class="board-label lc-${l.c}" id="board-llib-${i}"></button>`).join('');
    lib.forEach((l,i)=>{
      const b=document.getElementById('board-llib-'+i);
      if(!b)return;
      b.textContent=l.t;
      b.onclick=()=>{window.boardsAddLabel(cardId,l.t,l.c);_boardsRenderLabelSheet(cardId);};
    });
  }
  const inp=document.getElementById('board-label-input');
  if(inp)inp.focus();
}
window.boardsLabelPickColor=function(btn){
  const host=document.getElementById('board-label-swatches');
  if(host)Array.prototype.forEach.call(host.children,b=>b.classList.remove('on'));
  btn.classList.add('on');
};
window.boardsLabelCommit=function(cardId){
  const inp=document.getElementById('board-label-input');
  const host=document.getElementById('board-label-swatches');
  const on=host?host.querySelector('.on'):null;
  const t=inp?inp.value:'';
  if(!String(t).trim())return;
  window.boardsAddLabel(cardId,t,on?on.getAttribute('data-c'):'grey');
  _boardsRenderLabelSheet(cardId);
};

// ── Reactions ──
window.boardsOpenReactions=function(){
  const c=_boardsSelOne();
  if(!c){showToast('Select one card to react to it');return;}
  _boardsRenderReactionSheet(c.id,'');
};
function _boardsRenderReactionSheet(cardId,q){
  const c=_editCards.find(x=>x.id===cardId);if(!c)return;
  const term=String(q||'').toLowerCase().trim();
  const list=term?_BOARDS_REACTIONS.filter(r=>r.k.indexOf(term)>=0||r.e===term):_BOARDS_REACTIONS;
  const mine=c.reactions&&typeof c.reactions==='object'?Object.keys(c.reactions):[];
  _boardsOpenSheet('Reactions',`
    <input type="search" class="board-sheet-search" id="board-react-q" placeholder="Search reactions…" value="${_boardsEsc(q||'')}" oninput="window.boardsReactionSearch('${cardId}',this)">
    ${mine.length?`<div class="board-sheet-label">On this card</div>
    <div class="board-emoji-grid">${mine.map(e=>`<button class="board-emoji on" onclick="window.boardsToggleReaction('${cardId}','${_boardsEsc(e)}');window.boardsCloseSheet()">${_boardsEsc(e)}</button>`).join('')}</div>`:''}
    <div class="board-sheet-label">${term?'Matching':'Frequently used'}</div>
    <div class="board-emoji-grid">${list.length?list.map(r=>`<button class="board-emoji" onclick="window.boardsToggleReaction('${cardId}','${r.e}');window.boardsCloseSheet()">${r.e}</button>`).join(''):'<span class="board-sheet-empty">Nothing matches that.</span>'}</div>`);
  const inp=document.getElementById('board-react-q');
  // Same refocus-after-rerender pattern as every other search box here.
  if(inp&&term){inp.focus();try{inp.setSelectionRange(inp.value.length,inp.value.length);}catch(e){}}
}
let _boardsReactTimer=null;
window.boardsReactionSearch=function(cardId,el){
  const v=el.value;
  if(_boardsReactTimer)clearTimeout(_boardsReactTimer);
  _boardsReactTimer=setTimeout(()=>_boardsRenderReactionSheet(cardId,v),160);
};

// ── More ──
// The same items the right-click menu builds, in the same router — one
// definition, so the phone sheet and the desktop menu cannot drift apart.
window.boardsOpenMore=function(){
  const items=_boardsCardCtxItems(_boardsCanEdit(_editBoard));
  _boardsOpenSheet('More',`<div class="board-sheet-list">${items.map(it=>{
    if(it.sep)return'<div class="board-sheet-sep"></div>';
    if(it.title)return`<div class="board-sheet-label">${_boardsEsc(it.title)}</div>`;
    if(it.swatches||it.cellSwatches||it.connSwatches)return'';
    return`<button class="board-sheet-item${it.danger?' danger':''}" onclick="window.boardsSheetRun('${it.act}')">${_boardsEsc(it.label)}</button>`;
  }).join('')}</div>`);
};
window.boardsSheetRun=function(act){
  window.boardsCloseSheet();
  _boardsCtxRun(act);
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
  BR:'br',DIV:'div',P:'div',UL:'ul',OL:'ol',LI:'li',SPAN:'span',FONT:'span',
  // The Text style menu (Sept 2026): large / normal heading, small text,
  // code and quote blocks. Every heading level folds onto the three we
  // draw, so pasted markup cannot smuggle in a size the menu never offers.
  H1:'h2',H2:'h2',H3:'h3',H4:'h3',H5:'h6',H6:'h6',PRE:'pre',BLOCKQUOTE:'blockquote'};
// Highlight colours are an ALLOW-LIST of names → hex, not a validated hex:
// the sanitiser keeps a background only when it is one of these, so a
// pasted <span style="background:url(…)"> or any colour the menu never
// offered is dropped. Light tints, so the card's own ink reads on them in
// either theme (they are literal by design — a highlight is content, like
// the text colours beside it).
const _BOARDS_HILITE_COLORS=[
  {hex:'#FDE68A',label:'Yellow'},
  {hex:'#BBF7D0',label:'Green'},
  {hex:'#BFDBFE',label:'Blue'},
  {hex:'#FBCFE8',label:'Pink'},
  {hex:'#FED7AA',label:'Orange'}
];
function _boardsRichBg(node){
  let c='';
  try{c=node.style&&node.style.backgroundColor?node.style.backgroundColor:'';}catch(e){}
  c=String(c||'').trim().toLowerCase();
  if(!c)return'';
  const m=/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(c);
  if(m)c='#'+[m[1],m[2],m[3]].map(n=>('0'+Number(n).toString(16)).slice(-2)).join('');
  const hit=_BOARDS_HILITE_COLORS.find(h=>h.hex.toLowerCase()===c);
  return hit?hit.hex:'';
}
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
      const bg=tag==='span'?_boardsRichBg(n):'';
      if(tag==='span'&&(col||bg))el.setAttribute('style',[col?'color:'+col:'',bg?'background-color:'+bg:''].filter(Boolean).join(';'));
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
    (Array.isArray(c.labels)?c.labels:[]).forEach((l,i)=>{
      const el=document.getElementById('board-label-'+c.id+'-'+i);
      if(el)el.textContent=(l&&l.t)||'';
    });
    if(c.type==='table'&&Array.isArray(c.rows)){
      c.rows.forEach((row,r)=>row.forEach((cell,i)=>{
        const td=document.getElementById('board-td-'+c.id+'-'+r+'-'+i);
        // The DISPLAY form, not the stored one — except in the cell being
        // edited right now, which must show the raw text you are editing.
        if(td)td.textContent=(td===_boardsEditingEl)?_boardsCellVal(cell):_boardsCellDisplay(cell,c);
      }));
    }
    if(c.type==='link'){
      const t=document.getElementById('board-linkt-'+c.id);
      if(t)t.textContent=c.linkTitle||_boardsLinkHost(c.linkUrl)||'Untitled link';
      // The full URL, truncated by CSS — Milanote shows the address, not the
      // site name, and "where does this go" is the question a link card is
      // asked. `linkSite` is still stored: search and the export read it.
      const u=document.getElementById('board-linku-'+c.id);
      if(u)u.textContent=c.linkUrl||'';
      const d=document.getElementById('board-linkd-'+c.id);
      if(d)d.textContent=c._linkNoPreview&&!c.linkDesc?'No preview available':(c.linkDesc||'');
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
/* ── Level of detail (Sept 2026) ───────────────────────────────────────
   Afnan put our board at 22% beside Milanote's at 27% and said theirs is
   readable and ours is not. The difference is NOT font size, which was the
   first guess: it is that Milanote stops drawing card CHROME as you zoom
   out, and we drew all of it at every zoom. Verified before changing
   anything — there was no zoom-dependent rendering in this file at all.

   A card carries a header strip (~26 world px, with a type label, the
   name, a comment badge and the delete X), a border, a shadow, a resize
   grip, and possibly label/reaction/caption rows. At 22% that header is
   about 5 physical pixels of grey banding across the top of a card barely
   40px wide, and every piece of text in it is under 3px — illegible, but
   still painted, so it reads as mush rather than as nothing. Milanote's
   cards at 27% are just the pictures.

   So: three buckets, stamped as `data-lod` on `.board-world`, and CSS does
   the rest. No re-render and no per-card JS — this rides
   _boardsApplyTransform, which already runs on every pan and zoom, and the
   attribute is only written when the bucket actually CHANGES so a pinch
   does not thrash the style engine.

   The header stays in the DOM as a thin grab strip rather than being
   removed: it is the drag handle for link cards, which are the one type
   whose body does not drag (see "the wheel and the native drag"). */
const _BOARDS_LOD_FAR=0.35,_BOARDS_LOD_MID=0.7;
function _boardsLodFor(z){
  const n=Number(z)||0;
  return n<_BOARDS_LOD_FAR?'far':(n<_BOARDS_LOD_MID?'mid':'near');
}
function _boardsApplyTransform(){
  const b=_editBoard;if(!b)return;
  const w=document.getElementById('board-world');
  if(w)w.style.transform=`translate(${b.panX}px,${b.panY}px) scale(${b.zoom})`;
  if(w){
    const lod=_boardsLodFor(b.zoom);
    if(w.getAttribute('data-lod')!==lod)w.setAttribute('data-lod',lod);
  }
  const zr=document.getElementById('board-zoom-readout');
  if(zr)zr.textContent=Math.round(b.zoom*100)+'%';
  // Any transform change that ISN'T the fit itself means the view is no
  // longer the fitted one — so the single Fit/100% button flips back to
  // offering Fit. Deriving it here rather than clearing the flag in each of
  // the zoom/pan entry points is the whole reason it can't go stale: every
  // one of them ends up in this function, and a new one added later
  // inherits it without knowing about the button.
  if(!_boardsFitApply)_boardsFitted=false;
  _boardsSyncFitBtn();
  _boardsShowZoomPill(b.zoom);
  _boardsUpdateMinimapView();
}
// Milanote shows one button here, not two: it reads "Fit" until the board
// IS fitted and then reads "100%", so the pair of controls that do opposite
// things never both sit there competing for the same corner.
let _boardsFitted=false,_boardsFitApply=false;
function _boardsSyncFitBtn(){
  const btn=document.getElementById('board-fit-btn');
  if(!btn)return;
  const label=_boardsFitted?'100%':'Fit';
  if(btn.textContent!==label)btn.textContent=label;
  btn.title=_boardsFitted?'Back to actual size (100%)':'Fit every card on screen';
}
window.boardsToggleFit=function(){
  if(_boardsFitted)window.boardsResetView();
  else window.boardsFitView();
};
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
  const next=_boardsClampZoom(b.zoom*f);
  if(stage){
    const rect=stage.getBoundingClientRect();
    const cx=rect.width/2,cy=rect.height/2;
    b.panX=cx-(cx-b.panX)*(next/b.zoom);
    b.panY=cy-(cy-b.panY)*(next/b.zoom);
  }
  b.zoom=next;
  _boardsApplyTransform();_boardsSaveDebounced();
};
// Zoom about a POINT rather than the viewport centre — what the wheel and
// a trackpad pinch need, so the thing under the cursor stays under it.
// clientX/clientY are viewport coordinates; the stage rect makes them
// stage-relative, which is the space panX/panY live in.
function _boardsZoomAtPoint(next,clientX,clientY){
  const b=_editBoard;if(!b)return;
  const stage=document.getElementById('board-stage');if(!stage)return;
  const z=_boardsClampZoom(next);
  if(z===b.zoom)return;
  const rect=stage.getBoundingClientRect();
  const px=clientX-rect.left,py=clientY-rect.top;
  b.panX=px-(px-b.panX)*(z/b.zoom);
  b.panY=py-(py-b.panY)*(z/b.zoom);
  b.zoom=z;
  _boardsApplyTransform();_boardsSaveDebounced();
}
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
  // Fit cannot go below the floor either: on a board too wide to fit at
  // 25% you get 25% and a pan, not an unreadable whole-board view.
  const z=_boardsClampZoom(Math.min((rect.width-pad*2)/w,(rect.height-pad*2)/h));
  b.zoom=z;
  b.panX=(rect.width-w*z)/2-minX*z;
  b.panY=(rect.height-h*z)/2-minY*z;
  _boardsFitApply=true;
  try{_boardsApplyTransform();}finally{_boardsFitApply=false;}
  _boardsFitted=true;_boardsSyncFitBtn();
  _boardsSaveDebounced();
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
  // Straight into edit mode: you just asked for a note, you mean to type.
  window.boardsBeginEdit(null,'board-txt-'+c.id);
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
  // The on-screen keyboard is a resize too (index.html asks for
  // interactive-widget=resizes-content), and before this it panned the
  // board by half the keyboard's height under the caret — up when it
  // opened, back down when it closed. While anything is being edited the
  // view rect is left alone as well, so the closing resize sees no delta.
  if(_boardsEditingEl||_boardsIsEditableFocus())return;
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
// Is a note body being edited, on a screen where the RAIL carries the
// formatting tools? (Milanote swaps the rail for a text rail the moment a
// note is in edit mode; a phone keeps the floating bar docked above the
// keyboard, where a rail at the bottom of the screen would be under it.)
function _boardsFmtActive(){
  return!!(_boardsEditingEl&&_boardsIsRichField(_boardsEditingEl)&&!_boardsIsPhone()&&_editBoard&&_boardsCanEdit(_editBoard));
}
function _boardsShowFmtBar(el){
  _boardsFmtTarget=el;
  // Desktop: the rail is the formatting surface; the floating bar stays
  // hidden. Phone: the bar, docked above the keyboard.
  if(!_boardsIsPhone()){_boardsRenderRail();return;}
  const bar=document.getElementById('board-fmt');if(!bar)return;
  bar.style.display='block';
}
// ONE implementation of every formatting action, whichever surface asked.
// `done`, `swatches` and `style` are surface actions; everything else is an
// execCommand on the note body that currently holds the caret.
const _BOARDS_FMT_BLOCKS=[
  {tag:'h2',label:'Large heading'},
  {tag:'h3',label:'Normal heading'},
  {tag:'div',label:'Normal text'},
  {tag:'h6',label:'Small text'},
  {tag:'pre',label:'Code block'},
  {tag:'blockquote',label:'Quote block'}
];
function _boardsFmtAct(act){
  const target=_boardsFmtTarget||(_boardsIsRichField(_boardsEditingEl)?_boardsEditingEl:null);
  if(act==='done'){
    if(target&&target.blur)target.blur();
    _boardsHideFmtBar();
    if(_boardsEditingEl)_boardsEndEdit();
    return;
  }
  if(act==='swatches'){
    const sw=document.getElementById('board-fmt-swatches');
    if(sw)sw.style.display=sw.style.display==='none'?'flex':'none';
    return;
  }
  if(act==='style'){
    // Milanote's Text style menu, anchored beside the rail button.
    const btn=document.querySelector('.board-rail [data-act="fmt:style"]');
    const r=btn&&btn.getBoundingClientRect?btn.getBoundingClientRect():{right:100,top:100};
    _boardsOpenCtx(r.right+8,r.top,_BOARDS_FMT_BLOCKS.map(b=>({act:'fmt:block:'+b.tag,label:b.label})));
    return;
  }
  if(!target)return;
  if(target.focus)target.focus();
  try{
    // styleWithCSS matters per command: ON, a colour comes back as
    // <span style="color:…"> which the sanitiser keeps; OFF, bold comes
    // back as <b>, which it also keeps. The other way round, bold would
    // become <span style="font-weight:bold"> and the sanitiser — which
    // allow-lists colour and a highlight and nothing else — would quietly
    // strip it.
    const isColor=act.indexOf('color:')===0,isHilite=act.indexOf('hilite:')===0,isBlock=act.indexOf('block:')===0;
    try{document.execCommand('styleWithCSS',false,isColor||isHilite);}catch(e2){}
    if(isColor)document.execCommand('foreColor',false,act.slice(6));
    else if(isHilite)document.execCommand('hiliteColor',false,act.slice(7));
    else if(isBlock)document.execCommand('formatBlock',false,'<'+act.slice(6)+'>');
    else document.execCommand(act,false,null);
  }catch(err){}
  // execCommand fires `input` in modern browsers, but not uniformly for
  // every command — dispatching it ourselves is what actually guarantees
  // the card is saved.
  try{target.dispatchEvent(new Event('input',{bubbles:true}));}catch(err){}
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
    _boardsFmtAct(btn.getAttribute('data-fmt'));
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
    return _boardsClampZoom(raw);
  }
  const next=ratio>=1?p.zoom*(1+(ratio-1)*_BOARDS_MICRO_GAIN):p.zoom*ratio;
  if(next>=_BOARDS_ZOOM_TOUCH_MAX){
    if(!p.buzzedMax){p.buzzedMax=true;_boardsBuzz([10,40,10]);}
    return _BOARDS_ZOOM_TOUCH_MAX;
  }
  return _boardsClampZoom(next);
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
// Touch has neither a double-click nor a right-click of its own, and this
// file leaned on both. The stage already pairs taps by hand for
// double-tap-to-add (the module's own finding: dblclick is not dependable
// once touch-action:none has taken the browser's gesture), but every card
// body, to-do item, table cell and header still hung its edit on
// `ondblclick` — so a note could only be typed into if the browser happened
// to synthesize one. And the context menu hung on `contextmenu`, which
// Android fires on a long-press and iOS Safari does not. Both are paired
// here, once, for every element that carries the attribute — and each
// GUARDS against the browser also doing it natively, so a phone that does
// fire dblclick or contextmenu gets exactly one of each, not two.
const _BOARDS_TAP_MS=300,_BOARDS_TAP_PX=28,_BOARDS_HOLD_MS=500,_BOARDS_HOLD_PX=10;
let _boardsSynthDblAt=0,_boardsSynthCtxAt=0,_boardsHoldTimer=null,_boardsLastTap=null;
function _boardsSynth(type,el,x,y){
  const ev=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,view:window});
  if(type==='dblclick')_boardsSynthDblAt=Date.now();else _boardsSynthCtxAt=Date.now();
  el.dispatchEvent(ev);
}
function _boardsHoldCancel(){if(_boardsHoldTimer){clearTimeout(_boardsHoldTimer);_boardsHoldTimer=null;}}
function _boardsWireTouch(){
  let press=null;
  function onDown(e){
    if(e.pointerType!=='touch'||currentPage!=='board-canvas')return;
    if(!(e.target&&e.target.closest&&e.target.closest('.board-stage')))return;
    _boardsTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(_boardsTouches.size===2){_boardsPinchStart();_boardsHoldCancel();press=null;return;}
    press={id:e.pointerId,x:e.clientX,y:e.clientY,t:Date.now(),target:e.target,moved:false};
    _boardsHoldCancel();
    // No long-press inside a field: the browser's own text callout belongs
    // there, and the stage's contextmenu handler bails on it anyway.
    if(e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
    _boardsHoldTimer=setTimeout(()=>{
      _boardsHoldTimer=null;
      if(!press||press.moved||_boardsTouches.size!==1)return;
      try{if(navigator.vibrate)navigator.vibrate(12);}catch(err){}
      _boardsSynth('contextmenu',press.target,press.x,press.y);
      press=null;   // the release after a hold is not a tap
    },_BOARDS_HOLD_MS);
  }
  function onMove(e){
    if(e.pointerType!=='touch')return;
    if(press&&press.id===e.pointerId&&!press.moved&&
       (Math.abs(e.clientX-press.x)>_BOARDS_HOLD_PX||Math.abs(e.clientY-press.y)>_BOARDS_HOLD_PX)){
      press.moved=true;_boardsHoldCancel();
    }
    if(!_boardsTouches.has(e.pointerId))return;
    _boardsTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(_boardsPinch&&_boardsTouches.size>=2)_boardsPinchMove();
  }
  function onUp(e){
    if(e.pointerType!=='touch')return;
    _boardsHoldCancel();
    const p=press;press=null;
    if(!_boardsTouches.delete(e.pointerId))return;
    if(_boardsPinch&&_boardsTouches.size<2){
      _boardsPinch=null;
      _boardsSaveDebounced();   // pan/zoom are board fields, worth persisting
      return;
    }
    if(e.type!=='pointerup'||!p||p.moved||p.id!==e.pointerId)return;
    // A tap. Pair it with the last one on the same [ondblclick] element.
    const el=e.target&&e.target.closest&&e.target.closest('[ondblclick]');
    if(!el){_boardsLastTap=null;return;}
    const now=Date.now();
    if(_boardsLastTap&&_boardsLastTap.el===el&&now-_boardsLastTap.t<_BOARDS_TAP_MS&&
       Math.abs(e.clientX-_boardsLastTap.x)<_BOARDS_TAP_PX&&Math.abs(e.clientY-_boardsLastTap.y)<_BOARDS_TAP_PX){
      _boardsLastTap=null;
      _boardsSynth('dblclick',el,e.clientX,e.clientY);
      return;
    }
    _boardsLastTap={el,t:now,x:e.clientX,y:e.clientY};
  }
  document.addEventListener('pointerdown',onDown,true);
  document.addEventListener('pointermove',onMove,true);
  document.addEventListener('pointerup',onUp,true);
  document.addEventListener('pointercancel',onUp,true);
  // The guards. A browser that DOES synthesize its own dblclick from two
  // taps fires it right after the second click — after ours — so a trusted
  // one within the window is the duplicate and is dropped at the capture
  // phase, before any inline handler sees it. Same for contextmenu; and a
  // trusted contextmenu that arrives FIRST (Android's own long-press beat
  // the timer) cancels the timer so ours never fires.
  document.addEventListener('dblclick',e=>{
    if(e.isTrusted&&Date.now()-_boardsSynthDblAt<600){e.stopPropagation();e.preventDefault();}
  },true);
  document.addEventListener('contextmenu',e=>{
    if(!e.isTrusted)return;
    _boardsHoldCancel();
    if(Date.now()-_boardsSynthCtxAt<700){e.stopPropagation();e.preventDefault();}
  },true);
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
  let x=(rect.width/2-b.panX)/b.zoom-90+n*26;
  let y=(rect.height/2-b.panY)/b.zoom-60+n*26;
  // The cascade repeats every 6, so the 7th card landed exactly on the
  // 1st — reported in QA as new cards spawning stacked. Step off anything
  // already sitting at this spot. Bounded, because a board can be dense
  // enough that there is no free spot and burying one card is still better
  // than looping.
  for(let i=0;i<40;i++){
    const clash=_editCards.some(c=>Math.abs(c.x-x)<18&&Math.abs(c.y-y)<18);
    if(!clash)break;
    x+=26;y+=26;
  }
  return{x,y};
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
          _editConnectors.push({id:'k'+(++_boardsCardSeq)+'_'+Date.now(),free:true,arrow:true,x1:start.x,y1:start.y,x2:end.x,y2:end.y});
          _boardsDrawConnectors();
          _boardsSaveDebounced();
        }
      }
      stage.addEventListener('pointermove',lmove);
      stage.addEventListener('pointerup',lup);
      return;
    }

    // DRAG ON EMPTY CANVAS SELECTS (Sept 2026, at Afnan's request — this
    // REVERSES the Stage 2 decision recorded in CLAUDE.md, which had plain
    // drag panning and Shift+drag marqueeing).
    //
    // The Stage 2 worry was real and had to be answered rather than
    // ignored: this canvas has no scrollbars, so if dragging no longer
    // pans, someone who never finds the alternative is stranded on one
    // corner of the board. There are now FOUR ways to pan, and the first
    // two need nothing to be discovered at all:
    //   1. the wheel / two-finger trackpad scroll (added with the wheel
    //      handler; shift swaps the axis)
    //   2. dragging on a TOUCH screen — a phone keeps drag-to-pan, because
    //      there is no Shift key and rubber-banding with a finger is
    //      miserable. Milanote's phone view does the same.
    //   3. space + drag, the convention in every design tool
    //   4. the Hand toggle in the toolbar, and middle-button drag
    // Shift+drag still marquees too, so nobody's muscle memory breaks.
    const wantPan=(e.pointerType==='touch')||e.button===1||_boardsSpaceDown||_boardsPanMode;
    if(e.button===1)e.preventDefault();   // stop Chrome's middle-click autoscroll
    if(canEdit&&!wantPan){
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

    // The pan branch: touch, space, the Hand toggle, or the middle button.
    // Clicking empty canvas still clears the selection when it doesn't turn
    // into a pan, so a stray click behaves the same either way.
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

  // The wheel. Until now js/boards.js had NO wheel handler at all, so
  // Ctrl+wheel fell straight through to the BROWSER's page zoom: the top
  // bar, the rail, the minimap and the Report Bug button all scaled with
  // the canvas while the board's own zoom readout sat unchanged. Reported
  // by Afnan with a screenshot showing exactly that.
  //
  // Must be non-passive, or preventDefault() is ignored and the browser
  // zooms anyway. Chrome reports a trackpad pinch as a wheel event with
  // ctrlKey set, so the same branch covers both.
  stage.addEventListener('wheel',e=>{
    const b=_editBoard;if(!b)return;
    if(_boardsPinch)return;        // two fingers own zoom and pan together
    e.preventDefault();
    if(e.ctrlKey||e.metaKey){
      // Exponential so the step feels the same at 19% as at 200%, and
      // clamped per event so a coarse mouse wheel (deltaY ±100) doesn't
      // jump three steps at once.
      const d=Math.max(-60,Math.min(60,e.deltaY));
      _boardsZoomAtPoint(b.zoom*Math.exp(-d*0.0032),e.clientX,e.clientY);
      return;
    }
    // Plain wheel pans, as a canvas with no scrollbars should. Shift swaps
    // the axis, which is the convention everywhere else; a trackpad sends
    // deltaX of its own and needs neither.
    const dx=e.shiftKey?-(e.deltaY||0):-(e.deltaX||0);
    const dy=e.shiftKey?0:-(e.deltaY||0);
    if(!dx&&!dy)return;
    b.panX+=dx;b.panY+=dy;
    _boardsApplyTransform();_boardsSaveDebounced();
  },{passive:false});

  // The canvas is a full-viewport takeover, so Ctrl+wheel over the top bar,
  // the rail or the minimap would still page-zoom the whole app. Catch it
  // across the whole wrapper; the stage's own handler above has already run
  // for anything inside it, so skip those or the zoom would apply twice.
  const wrap=stage.closest?stage.closest('.board-canvas-wrap'):null;
  if(wrap)wrap.addEventListener('wheel',e=>{
    if(!_editBoard||stage.contains(e.target))return;
    if(!(e.ctrlKey||e.metaKey))return;
    e.preventDefault();
    const d=Math.max(-60,Math.min(60,e.deltaY));
    _boardsZoomAtPoint(_editBoard.zoom*Math.exp(-d*0.0032),e.clientX,e.clientY);
  },{passive:false});

  // Files dropped ON THE TRAY are collected rather than placed. Its own
  // handlers, because the stage's would turn them into cards at the drop
  // point — which is the whole distinction the tray exists to make.
  const tray=document.getElementById('board-tray');
  if(tray&&canEdit){
    tray.addEventListener('dragover',e=>{
      if(!_boardsDragHasFiles(e))return;
      e.preventDefault();e.stopPropagation();
      e.dataTransfer.dropEffect='copy';
      tray.classList.add('dropping');
    });
    tray.addEventListener('dragleave',()=>tray.classList.remove('dropping'));
    tray.addEventListener('drop',e=>{
      tray.classList.remove('dropping');
      if(!_boardsDragHasFiles(e))return;
      e.preventDefault();e.stopPropagation();
      _boardsTrayAddFiles(Array.from((e.dataTransfer&&e.dataTransfer.files)||[]));
    });
  }

  // A native drag that begins inside the board (an image, a link, a text
  // selection) is not a file arriving from the desktop. Flag it so the
  // drop overlay stays down, and clear it however the drag ends.
  stage.addEventListener('dragstart',()=>{_boardsInternalDrag=true;});
  stage.addEventListener('dragend',()=>{
    _boardsInternalDrag=false;_boardsDragDepth=0;stage.classList.remove('dropping');
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
    const internal=_boardsInternalDrag;
    _boardsInternalDrag=false;
    if(internal||!_boardsDragHasFiles(e)){
      _boardsDragDepth=0;stage.classList.remove('dropping');return;
    }
    e.preventDefault();
    _boardsDragDepth=0;
    stage.classList.remove('dropping');
    const files=Array.from((e.dataTransfer&&e.dataTransfer.files)||[]);
    if(!files.length)return;
    _boardsAddFiles(files,_boardsScreenToWorld(e.clientX,e.clientY));
  });
}
// Only a drag that came from OUTSIDE the page counts as "files being
// dropped on this board". Chrome reports a natively-dragged <img> or <a>
// to the drop target as carrying Files, so without the internal-drag flag
// dragging a card's own picture raises the drop overlay — Afnan's "it's
// mixing 2 logics". Every card image now carries draggable="false" so the
// native drag should never start at all; this is the second line of
// defence, and it also covers a dragged text selection.
function _boardsDragHasFiles(e){
  if(_boardsInternalDrag)return false;
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

// A card drag ends with a `click` on whatever was under the pointer. On a
// FILE card that is an <a href>, so dragging one to reposition it opened
// the raw Cloudinary PDF in a new tab — reported in QA. Selection already
// happened on pointerdown, so the click after a real drag has nothing left
// to do and is swallowed. Capture phase, so it lands before the anchor's
// own default and before boardsSelectCard.
let _boardsSuppressClick=false;
document.addEventListener('click',e=>{
  if(!_boardsSuppressClick)return;
  _boardsSuppressClick=false;
  e.preventDefault();
  e.stopPropagation();
},true);

// Double-clicking a card's header opens whatever that card's primary
// editable is. Reported in QA: the first double-click on a HEADING did
// nothing and the text typed after it was lost — the heading's drag strip
// sits over the top of the banner, so the first attempt lands on the strip
// rather than the text. One rule for every type beats a special case.
window.boardsHeadDblClick=function(ev,id){
  const c=_editCards.find(x=>x.id===id);
  if(!c||!_boardsCanEdit(_editBoard)||c.locked)return;
  if(ev)ev.stopPropagation();
  if(c.type==='heading'){window.boardsBeginEdit(ev,'board-txt-'+id);return;}
  if(c.type==='text'){window.boardsBeginEdit(ev,'board-txt-'+id);return;}
  window.boardsBeginEdit(ev,'board-name-'+id);
};

/* ── Dragging a board card back INTO the panel (Sept 2026) ─────────────
   Afnan drew the arrow the other way: the panel drops a board onto Home,
   and Home should drop one back. Placing already had a drag; taking off
   only had the ✕ and the card menu, which is not the gesture anyone tries.

   It is the SAME ACTION as the ✕ — window.boardsDeleteCard, which on Home
   already means "take it off Home and leave the board alone" — rather than
   a second unlink path beside it. Two implementations of that is how the
   trash entry, the toast and the sub-board wording would eventually
   disagree.

   Only a lone board card on Home qualifies. A multi-selection dropped on
   the panel would have to decide what to do with the cards in it that are
   not boards, and "some of that did something" is worse than not offering
   the gesture. */
function _boardsUnplaceDrag(group){
  return _boardsIsHome(_editBoard)&&group.length===1&&group[0].type==='board'&&!!group[0].boardId;
}
function _boardsOverPanel(ev){
  const el=document.getElementById('board-tray');
  if(!el||el.classList.contains('collapsed'))return false;
  const r=el.getBoundingClientRect();
  return ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom;
}
function _boardsPanelDropTarget(on){
  const el=document.getElementById('board-tray');
  if(el)el.classList.toggle('panel-drop',!!on);
}
window.boardsCardDragStart=function(e,cardId){
  e.stopPropagation();
  // A press inside whatever is currently open for editing is the user
  // selecting text, not grabbing the card. stopPropagation still applies,
  // or the stage would start panning under the selection.
  if(_boardsEditingEl&&_boardsEditingEl.contains&&_boardsEditingEl.contains(e.target))return;
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
  // A column carries its children too — but by STORED membership, not by
  // geometry. A frame inside the group can also pull in a column and its
  // children; the Set means anything caught twice still moves once.
  _editCards.filter(x=>withFrames.has(x.id)&&x.type==='column').forEach(col=>{
    _boardsColumnChildren(col).forEach(k=>{if(!k.locked)withFrames.add(k.id);});
  });
  group=_editCards.filter(x=>withFrames.has(x.id));
  if(!group.length)return;
  const origins=group.map(x=>({card:x,ox:x.x,oy:x.y}));
  const others=_editCards.filter(x=>!group.some(g=>g.id===x.id));
  // A column cannot be dropped into itself, or into a column travelling
  // with it.
  const movingCols=new Set(group.filter(x=>x.type==='column').map(x=>x.id));
  const head=e.currentTarget;
  const unplaceable=_boardsUnplaceDrag(group);
  const startX=e.clientX,startY=e.clientY;
  let pushed=false;
  head.setPointerCapture(e.pointerId);
  function move(ev){
    if(_boardsPinch)return;   // two fingers down: zooming, not dragging a card
    // One undo entry per gesture, pushed on the first REAL movement —
    // a plain click (or a finger that rolls a pixel) shouldn't leave a
    // no-op in the stack or move the card.
    if(!pushed){
      if(Math.abs(ev.clientX-startX)<_BOARDS_DRAG_PX&&Math.abs(ev.clientY-startY)<_BOARDS_DRAG_PX)return;
      _boardsPushUndo();pushed=true;
    }
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
    // A lone board card held over the panel is a "take it off Home", so the
    // panel says so before the pointer comes up rather than after.
    if(unplaceable)_boardsPanelDropTarget(_boardsOverPanel(ev));
    _boardsShowColumnDrop(_boardsDropTargets(group,movingCols));
  }
  function up(ev){
    head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',up);
    _boardsHideGuides();
    _boardsHideColumnDrop();
    _boardsPanelDropTarget(false);
    // `pushed` is set on the first real pointermove, so it is exactly
    // "this was a drag, not a click".
    if(pushed)_boardsSuppressClick=true;
    // Dropped on the panel: the board comes off Home. Put the cards back
    // where the gesture started and DISCARD the drag's own undo entry
    // first — boardsDeleteCard pushes its own, and without this Ctrl+Z
    // would restore the card at the spot it was dragged to and need a
    // second press to put it back. _boardsUndo is a plain stack of
    // snapshots, so popping the one this gesture pushed is exact.
    if(pushed&&unplaceable&&ev&&_boardsOverPanel(ev)){
      origins.forEach(o=>{o.card.x=o.ox;o.card.y=o.oy;});
      _boardsUndo.pop();
      _boardsSyncHistoryButtons();
      _boardsPanelFlash=group[0].boardId;
      window.boardsDeleteCard(group[0].id);
      return;
    }
    if(pushed){
      // Where a card ENDS decides which column it belongs to. Joining
      // writes only the dragged card's columnId and its y — the column
      // document is never touched, which is what keeps two people adding
      // to the same column from overwriting each other.
      const drops=_boardsDropTargets(group,movingCols);
      let structural=false;
      drops.forEach(d=>{
        if(d.col){
          if(d.card.columnId!==d.col.id){d.card.columnId=d.col.id;structural=true;}
          d.card.y=d.slot.y;
        }else if(d.card.columnId!=null){
          _boardsLeaveColumn(d.card);structural=true;
        }
      });
      const moved=_boardsLayoutColumns();
      if(structural||moved)_boardsRenderCanvasAndWire();
      _boardsSaveDebounced();
    }
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
  // A COLUMN's height is derived from its contents and a CHILD's width is
  // set by its column, so neither is draggable — offering a handle that
  // silently snaps back is worse than not offering that axis at all.
  const col=_boardsIsColumn(c),inCol=!col&&!!_boardsColumnOf(c);
  function move(ev){
    if(_boardsPinch)return;
    if(!pushed){_boardsPushUndo();pushed=true;}
    if(!inCol)c.w=Math.max(col?140:90,origW+(ev.clientX-startX)/b.zoom);
    if(!col)c.h=Math.max(_boardsMinCardH(c),origH+(ev.clientY-startY)/b.zoom);
    if(col||inCol){
      // Reflow by writing styles, not by rebuilding the canvas — a full
      // render per pointermove would redraw every card and connector on a
      // 46-card board for what is a handful of style writes.
      _boardsLayoutColumns();
      _boardsPaintColumnGeometry(col?c:_boardsColumnOf(c));
      return;
    }
    const el=document.getElementById('board-card-'+cardId);
    if(el){el.style.width=c.w+'px';el.style.height=c.h+'px';}
    _boardsUpdateConnectorsFor(cardId);
  }
  function up(){
    handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);
    if(pushed){
      _boardsLayoutColumns();
      // One rebuild at the END, so the empty-state label and the child
      // count in the header catch up with whatever the reflow did.
      _boardsRenderCanvasAndWire();
    }
    _boardsSaveDebounced();
  }
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
  // Card selection and line selection are mutually exclusive — see
  // _boardsSelectConn. Two kinds of "the selection" at once would make
  // Delete and the rail ambiguous.
  if(ids&&ids.length&&_boardsConnSel!==null){_boardsConnSel=null;_boardsDrawConnectors();}
  else if(_boardsConnSel!==null&&(!ids||!ids.length)){_boardsConnSel=null;_boardsDrawConnectors();}
  _boardsSelection=new Set(ids);
  // A focused cell belongs to a selected table. Clicking empty canvas
  // clears the selection through here, and leaving the focus behind left
  // the ring and the cell rail up with no way out but the Done button.
  if(_boardsCellFocus&&!_boardsSelection.has(_boardsCellFocus.id)){
    _boardsCellFocus=null;
    _boardsEndEdit();
  }
  _boardsPaintSelection();
}
function _boardsSelectCard(id,additive){
  if(_boardsConnSel!==null){_boardsConnSel=null;_boardsDrawConnectors();}
  // A cell's focus belongs to its own table. Selecting anything else — or
  // the same table again as a fresh single selection — drops it, or the
  // rail would keep offering cell actions for a cell nobody is looking at.
  if(_boardsCellFocus&&_boardsCellFocus.id!==id)_boardsCellFocus=null;
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
  // The text rail (Sept 2026): Text style, bullets, numbers.
  textstyle:'<path d="M2 3h9v2.5H8.8V13H6.2V5.5H2z"/><circle cx="12.5" cy="11.5" r="2.5"/>',
  ul:'<circle cx="3" cy="4" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="3" cy="12" r="1.3"/><path d="M6 3.2h8v1.6H6zM6 7.2h8v1.6H6zM6 11.2h8v1.6H6z"/>',
  ol:'<path d="M2 2.5h1.6v3H2.4v-.9h.5V3.4H2zM2 7.3c0-.9.6-1.4 1.5-1.4s1.4.5 1.4 1.2c0 .5-.3.9-.9 1.3l-.7.6h1.7v.9H2v-.8l1.4-1.2c.4-.3.5-.5.5-.7 0-.3-.2-.4-.5-.4s-.5.2-.5.6zM2 11.6h1.5c.8 0 1.3.4 1.3 1s-.3.8-.7.9c.5.1.8.4.8.9 0 .7-.5 1.1-1.4 1.1H2v-.8h1.4c.4 0 .6-.2.6-.5s-.2-.4-.6-.4H2.8v-.7h.6c.3 0 .5-.2.5-.4s-.2-.4-.5-.4H2z"/><path d="M6 3.2h8v1.6H6zM6 7.2h8v1.6H6zM6 11.2h8v1.6H6z"/>',
  // Line-rail icons. Local to boards.js like the rest (js/shared.js is a
  // cross-track file and none of these are wanted elsewhere).
  linestart:'<path d="M2 8h11" stroke="currentColor" fill="none"/><path d="M6 4L2 8l4 4z"/>',
  lineend:'<path d="M3 8h11" stroke="currentColor" fill="none"/><path d="M10 4l4 4-4 4z"/>',
  dashed:'<path d="M2 8h3M6.5 8h3M11 8h3" stroke="currentColor" fill="none"/>',
  table:'<path d="M2 3h12v10H2z" fill="none" stroke="currentColor"/><path d="M2 6.5h12M6 3v10M10 3v10" stroke="currentColor" fill="none"/>',
  weight:'<path d="M2 4h12" stroke="currentColor" fill="none" stroke-width="1"/><path d="M2 8h12" stroke="currentColor" fill="none" stroke-width="2"/><path d="M2 12.5h12" stroke="currentColor" fill="none" stroke-width="3"/>',
  trash:'<path d="M3 4h10M6 4V2.5h4V4M5 4l.7 9h4.6L11 4z" fill="none" stroke="currentColor"/>',
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
  color:'<path d="M8 1.5C5 4.5 3 6.8 3 9a5 5 0 0010 0c0-2.2-2-4.5-5-7.5z" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  align:'<path d="M2.5 3.5h11M2.5 7h7M2.5 10.5h11M2.5 14h7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  formula:'<path d="M10.5 3H7.2a1.7 1.7 0 00-1.7 1.7V13M4 8h4.5M10 8l3.5 5M13.5 8L10 13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  labels:'<path d="M8.5 2H14v5.5L7.5 14 2 8.5z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="5" r="1"/>',
  reactions:'<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6.6" r=".9"/><circle cx="10" cy="6.6" r=".9"/><path d="M5.4 9.6a3.2 3.2 0 005.2 0" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  more:'<circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/>',
  done:'<path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  fit:'<path d="M2 5.5V2h3.5M14 5.5V2h-3.5M2 10.5V14h3.5M14 10.5V14h-3.5" fill="none" stroke="currentColor" stroke-width="1.3"/>'
};
function _boardsIcon(name){
  return`<svg viewBox="0 0 16 16" aria-hidden="true">${_BOARDS_ICONS[name]||_BOARDS_ICONS.note}</svg>`;
}
/* The add-tools, split three ways.

   _MAIN is what stays on the rail, _OVERFLOW is what the "…" reveals, and
   _MEDIA is the group below the divider. The split follows Milanote's own:
   the things you reach for constantly stay out, the structural ones fold
   away. `drag:true` is what makes an entry a drag source; anything without
   it stays click-only, and the three that lack it are the three that do not
   PLACE anything: `line` is a mode, and `imagepanel`/`file` open a picker.
   Board carries it as of Sept 2026 (Afnan, with the tool circled and an
   arrow drawn onto the canvas) — it places a card like any other tool, it
   just mints the board behind it first. */
const _BOARDS_RAIL_MAIN=[
  {act:'add:text',label:'Note',icon:'note',drag:true},
  {act:'add:link',label:'Link',icon:'link',drag:true},
  {act:'add:todo',label:'To-do',icon:'todo',drag:true},
  {act:'add:board',label:'Board',icon:'board',drag:true},
  {act:'add:column',label:'Column',icon:'stack',drag:true},
  {act:'line',label:'Line',icon:'line'}
];
const _BOARDS_RAIL_OVERFLOW=[
  {act:'add:heading',label:'Heading',icon:'heading',drag:true},
  {act:'add:table',label:'Table',icon:'table',drag:true},
  {act:'add:frame',label:'Frame',icon:'frame',drag:true}
];
const _BOARDS_RAIL_MEDIA=[
  {act:'imagepanel',label:'Image',icon:'image'},
  {act:'file',label:'File',icon:'file'}
];
// The four tools a phone keeps on its bar (see _boardsRailItems). Note and
// Board drag; Image and File open a picker, so they carry no drag flag —
// the same rule the desktop lists follow.
const _BOARDS_RAIL_PHONE=[
  {act:'add:text',label:'Note',icon:'note',drag:true},
  {act:'imagepanel',label:'Image',icon:'image'},
  {act:'file',label:'File',icon:'file'},
  {act:'add:board',label:'Board',icon:'board',drag:true}
];
// What the phone's More sheet lists: every add-tool the bar does not carry,
// then the board-level actions the desktop rail keeps beside them.
function _boardsRailPhoneOverflow(){
  const onBar=new Set(_BOARDS_RAIL_PHONE.map(it=>it.act));
  return _BOARDS_RAIL_MAIN.filter(it=>!onBar.has(it.act))
    .concat(_BOARDS_RAIL_OVERFLOW)
    .concat(_BOARDS_RAIL_MEDIA.filter(it=>!onBar.has(it.act)))
    .concat([{act:'comment-board',label:'Comment'},{act:'fit',label:'Fit view'}])
    .map(it=>({act:it.act,label:it.act==='line'?(_boardsLineMode?'Line tool: on':'Line tool'):it.label}));
}
function _boardsRailItems(){
  const canEdit=_boardsCanEdit(_editBoard);
  const sel=_boardsSelectedCards();
  // A NOTE IN EDIT MODE is the rail's fifth mode (Sept 2026), read off
  // Milanote's own: back, Text style, B, I, S, U, bullets, numbers — then
  // the text colours and highlights the floating bar used to hold. It
  // outranks every other mode: while the caret is in a note, that note is
  // also the selection, and its card actions are one Back away.
  if(_boardsFmtActive()){
    return[
      {act:'fmt:done',label:'Back',icon:'back',rewind:true},
      {act:'fmt:style',label:'Text style',icon:'textstyle'},
      {act:'fmt:bold',label:'Bold',glyph:'<b>B</b>'},
      {act:'fmt:italic',label:'Italic',glyph:'<i>I</i>'},
      {act:'fmt:strikeThrough',label:'Strike',glyph:'<s>S</s>'},
      {act:'fmt:underline',label:'Underline',glyph:'<u>U</u>'},
      {act:'fmt:insertUnorderedList',label:'Bullets',icon:'ul'},
      {act:'fmt:insertOrderedList',label:'Numbers',icon:'ol'},
      {sep:true},
      {fmtSwatches:true},
      {fmtHilite:true}
    ];
  }
  // A selected LINE is the rail's third mode. Milanote's own line rail is
  // Color / Start / End / Label / Dashed / Weight; these are the same
  // actions the right-click menu builds, through the same router, so the
  // two cannot drift apart.
  if(_boardsConnSel!==null&&!sel.length){
    const cn=_boardsConnById(_boardsConnSel);
    if(cn){
      const out=[];
      if(canEdit){
        out.push({connSwatches:cn.id});
        out.push({act:'ln:arrowStart',label:'Start',icon:'linestart',on:!!cn.arrowStart});
        out.push({act:'ln:arrow',label:'End',icon:'lineend',on:!!cn.arrow});
        out.push({act:'ln:label',label:'Label',icon:'rename'});
        out.push({act:'ln:dash',label:'Dashed',icon:'dashed',on:!!cn.dash});
        out.push({act:'ln:weight',label:'Weight',icon:'weight'});
        if(cn.bx||cn.by)out.push({act:'ln:straight',label:'Straight',icon:'line'});
        out.push({sep:true});
        out.push({act:'ln:lock',label:cn.locked?'Unlock':'Lock',icon:cn.locked?'unlock':'lock'});
        out.push({act:'ln:delete',label:'Delete',icon:'trash',danger:true});
      }
      out.push({act:'ln:deselect',label:'Done',icon:'done',done:true});
      return out;
    }
  }
  // A focused table cell is the rail's FOURTH mode (nothing selected /
  // card / line / cell). It outranks the card mode: while a cell is
  // focused the table itself is still selected, and the card actions are
  // one 'Done' away.
  const fc=_boardsFocusedCell();
  if(fc&&canEdit){
    const cell=fc.cell;
    return[
      {act:'cell:bold',label:'Bold',icon:'rename',on:!!_boardsCellAttr(cell,'b')},
      {act:'cell:italic',label:'Italic',icon:'rename',on:!!_boardsCellAttr(cell,'i')},
      {act:'cell:size',label:'Size',icon:'heading',on:!!_boardsCellAttr(cell,'sz')},
      {act:'cell:align',label:'Align',icon:'align',on:!!_boardsCellAttr(cell,'al')},
      {act:'cell:type',label:'Type',icon:'table',on:_boardsCellType(cell)!=='auto'},
      {act:'cell:formula',label:'Formula',icon:'formula',on:_boardsIsFormula(cell)},
      {cellSwatches:true},
      {sep:true},
      {act:'cell:row-below',label:'Add row',icon:'table'},
      {act:'cell:col-right',label:'Add column',icon:'table'},
      {act:'cell:clear',label:'Clear',icon:'trash'},
      {act:'cell:done',label:'Done',icon:'done',done:true}
    ];
  }
  if(!sel.length){
    if(!canEdit)return[{act:'fit',label:'Fit',icon:'fit'}];
    // Grouped the way Milanote groups it: content tools, a divider, the
    // overflow, then media. Eleven add-tools in one flat column was a wall;
    // the point of the overflow is that the resting rail stays short.
    //
    // THE TRASH AT THE FOOT IS A DESTINATION, NOT A DELETE BUTTON — which
    // is what M6's note here was worried about when it said there would
    // never be one. Deleted cards really do go somewhere now, so the rail
    // needs a way in; it opens the panel and never deletes anything.
    // A PHONE gets the same shape the selection rail already has: six
    // targets and More. Measured before this: twelve tools = 698px in a
    // 368px scroller, so Image, File, Comment, Fit, More and TRASH all sat
    // off-screen with no fade, no hint and no visible scrollbar — the
    // trash badge and its shake never appeared on a phone at all. The
    // tools kept visible are the ones a board is made of (Note, Image,
    // File, Board); everything else is one tap away behind More, which
    // opens the same sheet the overflow already used.
    if(_boardsIsPhone()){
      return _BOARDS_RAIL_PHONE.concat([
        {act:'more-tools',label:'More',icon:'more',on:false},
        {act:'trash',label:'Trash',icon:'trash',badge:true,on:_boardsCardTrashOpen}
      ]);
    }
    const main=_BOARDS_RAIL_MAIN.map(it=>
      it.act==='line'?Object.assign({},it,{on:_boardsLineMode}):it);
    return main.concat([
      {sep:true},
      {act:'more-tools',label:'More',icon:'more',on:false},
      {sep:true}
    ]).concat(_BOARDS_RAIL_MEDIA).concat([
      {sep:true},
      {act:'comment-board',label:'Comment',icon:'comment'},
      {act:'fit',label:'Fit',icon:'fit'},
      // Pinned to the floor of the column, where Milanote keeps it — far
      // from the add-tools, so a Trash button is never next to a tool you
      // reach for constantly.
      {grow:true},
      {act:'trash',label:'Trash',icon:'trash',badge:true,on:_boardsCardTrashOpen}
    ]);
  }
  const one=sel.length===1?sel[0]:null;
  // On a phone the rail is a bottom bar the width of the screen: six
  // targets fit, twenty do not. Milanote's own phone bar is exactly this
  // shape — Color, Labels, Reactions, Comment, More, Done — and everything
  // it leaves out lives one tap away behind More, which renders the SAME
  // item list the right-click menu builds.
  if(_boardsIsPhone()){
    const ph=[];
    if(canEdit)ph.push({act:'color',label:'Color',icon:'color'});
    if(canEdit)ph.push({act:'labels',label:'Labels',icon:'labels'});
    if(canEdit)ph.push({act:'reactions',label:'Reactions',icon:'reactions'});
    if(one)ph.push({act:'card-comment',label:'Comment',icon:'comment'});
    ph.push({act:'more',label:'More',icon:'more'});
    ph.push({act:'deselect',label:'Done',icon:'done',done:true});
    return ph;
  }
  const items=[];
  // A way back to the add-tools without losing the selection — the
  // back-arrow the browser study saw fading in on the real rail's context
  // swap. Ours had no route back at all except clearing the selection.
  items.push({act:'deselect',label:'Back',icon:'back',rewind:true});
  if(canEdit)items.push({act:'color-panel',label:'Color',colorTile:true});
  items.push({act:'card-comment',label:'Comment',icon:'comment'});
  if(canEdit)items.push({act:'labels',label:'Labels',icon:'labels'});
  if(canEdit)items.push({act:'reactions',label:'React',icon:'reactions'});
  if(one){
    if(one.type==='table'&&canEdit)items.push({act:'caption',label:'Caption',icon:'caption'});
    if(one.type==='image'||one.type==='file'){
      if(canEdit)items.push({act:'caption',label:'Caption',icon:'caption'});
      if(canEdit)items.push({act:'replace',label:'Replace',icon:'replace'});
      items.push({act:'download',label:'Download',icon:'download'});
    }
    if(one.type==='link'&&one.linkUrl)items.push({act:'openasset',label:'Open',icon:'open'});
    if(one.type==='board'&&one.boardId){
      items.push({act:'open-board',label:'Open',icon:'open'});
      // Afnan asked for the picture options to be on the left rail as well
      // as behind the double-click. Same sheet, same router — the rail and
      // the menus cannot offer different things.
      if(canEdit){
        items.push({act:'board-look',label:'Picture',icon:'color'});
        items.push({act:'board-rename',label:'Board name',icon:'rename'});
      }
    }
    if(canEdit)items.push({act:one.type==='heading'?'renameheading':'rename',label:'Rename',icon:'rename'});
  }
  if(!canEdit)return items;
  if(sel.length>1){
    items.push({sep:true});
    items.push({act:'stack',label:'Column',icon:'stack'});
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
  host.classList.toggle('selecting',!!sel.length||_boardsConnSel!==null);
  const items=_boardsRailItems();
  // THE SWAP IS A MOTION, like Milanote's: when the rail changes MODE (add
  // tools → a selection → a note's text tools) the new column slides in.
  // Keyed on the mode, not on every repaint — a trash-count paint or a
  // selection of a second card must not replay it.
  const mode=_boardsFmtActive()?'text':(_boardsConnSel!==null&&!sel.length)?'line':_boardsFocusedCell()?'cell':sel.length?'sel':'add';
  const prev=host.dataset?host.dataset.mode:'';
  if(host.dataset)host.dataset.mode=mode;
  host.classList.remove('rail-swap');
  if(prev&&prev!==mode){void host.offsetWidth;host.classList.add('rail-swap');}
  host.innerHTML=(sel.length>1?`<div class="rail-count">${sel.length}</div>`:'')+items.map(it=>{
    if(it.sep)return'<div class="rail-sep"></div>';
    if(it.colorTile){
      const cls=_boardsColorTileClass(sel);
      return`<button class="rail-btn" data-act="${it.act}" title="Colour — background and top strip"><span class="rail-color-tile ${cls}"></span><span>${_boardsEsc(it.label)}</span></button>`;
    }
    if(it.fmtSwatches)return`<div class="rail-fmt-row" title="Text colour">${_BOARDS_TEXT_COLORS.map(c=>`<button class="board-fmt-sw" style="background:${c.hex}" title="${c.label}" data-act="fmt:color:${c.hex}"></button>`).join('')}</div>`;
    if(it.fmtHilite)return`<div class="rail-fmt-row" title="Highlight">${_BOARDS_HILITE_COLORS.map(c=>`<button class="board-fmt-sw" style="background:${c.hex}" title="Highlight ${c.label}" data-act="fmt:hilite:${c.hex}"></button>`).join('')}</div>`;
    if(it.grow)return'<div class="rail-grow"></div>';
    if(it.swatches)return`<div class="rail-swatches">${_BOARDS_COLORS.map(c=>`<button class="board-swatch sw-${c}" data-act="color:${c}" title="${c==='none'?'No colour':c}"></button>`).join('')}</div>`;
    if(it.cellSwatches)return`<div class="rail-swatches">${_BOARDS_COLORS.map(c=>`<button class="board-swatch sw-${c}" data-act="cellbg:${c}" title="${c==='none'?'No colour':c}"></button>`).join('')}</div>`;
    if(it.connSwatches)return`<div class="rail-swatches">${_BOARDS_COLORS.map(c=>`<button class="board-swatch sw-${c}" data-act="ln:c:${c}" title="${c==='none'?'Default':c}"></button>`).join('')}</div>`;
    // `glyph` is static markup from the item lists above (a bold B, an
    // italic I) — never user text, which is why it is not escaped.
    return`<button class="rail-btn${it.on?' on':''}${it.danger?' danger':''}${it.done?' rail-done':''}${it.drag?' rail-draggable':''}" data-act="${it.act}"${it.drag?' data-drag="1"':''} title="${_boardsEsc(it.label)}${it.drag?' — click to place, or drag onto the board':''}">${it.glyph?`<span class="rail-glyph">${it.glyph}</span>`:_boardsIcon(it.icon)}<span>${_boardsEsc(it.label)}</span>${it.badge?'<span class="board-rail-badge" style="display:none"></span>':''}</button>`;
  }).join('');
  // The count is painted after the markup exists, and again whenever the
  // trash changes underneath — it is derived from what is actually
  // restorable, not from how many documents the collection holds.
  _boardsPaintTrashCount();
  if(host.__wired)return;
  host.__wired=true;
  // One delegated listener on a host that survives innerHTML swaps — and
  // pointerdown must not reach the stage, or clicking the rail would start
  // a pan and clear the very selection you are acting on.
  host.addEventListener('pointerdown',e=>{
    e.stopPropagation();
    _boardsRailTipHide();
    // A formatting tool acts on the caret: taking focus would destroy the
    // selection it is about to format, and the command would then silently
    // do nothing. Same rule the floating bar holds.
    const t=e.target;
    if(t&&t.closest&&(t.closest('[data-act^="fmt:"]')||t.closest('.rail-fmt-row'))){e.preventDefault();return;}
    _boardsRailDragStart(e);
  });
  // "Drag me" — Milanote's hover cue, read off the video frame by frame:
  // the icon does not move; about half a second into the hover a dark
  // bubble fades in to the right of the tile and goes on leave. Offered
  // ONLY by a drag source (data-drag): a cue promising a drag the tool does
  // not accept is worse than no cue. Mouse only — a finger has no hover.
  host.addEventListener('pointerover',e=>{
    if(e.pointerType&&e.pointerType!=='mouse')return;
    const btn=e.target.closest&&e.target.closest('[data-act][data-drag="1"]');
    if(btn)_boardsRailTipArm(btn);else _boardsRailTipHide();
  });
  host.addEventListener('pointerout',e=>{
    const to=e.relatedTarget;
    const btn=e.target.closest&&e.target.closest('[data-act][data-drag="1"]');
    if(btn&&!(to&&btn.contains&&btn.contains(to)))_boardsRailTipHide();
  });
  host.addEventListener('click',e=>{
    const btn=e.target.closest&&e.target.closest('[data-act]');
    if(!btn)return;
    e.stopPropagation();
    _boardsCtxWorld=null;
    _boardsCtxRun(btn.getAttribute('data-act'));
  });
}
/* Drag a tool from the rail onto the canvas.

   Click-to-place is UNCHANGED and stays the primary route: a click still
   drops a card at the cascade point immediately. Milanote's spec claims a
   single-click-then-click-to-place mode as well; a browser session could
   not reproduce it or find any armed affordance for it in the real
   product, so it is deliberately NOT built here — our click already does
   something useful, and replacing that with a two-step arm would trade a
   working gesture for an unverified one.

   The drag is pointer-based like everything else on this canvas, NOT HTML5
   drag-and-drop: the stage already reads a native dragstart as "files from
   the desktop" (_boardsInternalDrag), so a native tool drag would raise
   the file-drop overlay — the same collision that made card images
   undraggable until Sept 2026.

   Nothing is created until the pointer comes up over the stage. Released
   anywhere else — back on the rail, over the top bar, outside the window —
   the drag is simply abandoned. */
let _boardsRailDrag=null;
const _BOARDS_RAIL_DRAG_PX=5;
// A CARD drag too. It had no dead zone at all: `pushed` went true on the
// very first pointermove, so on a touch screen a slightly rolling tap pushed
// an undo snapshot, swallowed the click and nudged the card 1-3px (or onto
// the grid). The rail, the panel rows and the tray all had one; the card
// drag was the odd one out. Found by reading, in the Sept 2026 phone audit.
const _BOARDS_DRAG_PX=4;
function _boardsRailDragStart(e){
  if(!_editBoard||!_boardsCanEdit(_editBoard))return;
  if(e.button!==undefined&&e.button!==0)return;
  const btn=e.target.closest&&e.target.closest('[data-act][data-drag="1"]');
  if(!btn)return;
  _boardsRailDrag={act:btn.getAttribute('data-act'),
    label:(btn.getAttribute('title')||'').split(' — ')[0],
    x0:e.clientX,y0:e.clientY,moved:false};
  document.addEventListener('pointermove',_boardsRailDragMove,true);
  document.addEventListener('pointerup',_boardsRailDragEnd,true);
  document.addEventListener('pointercancel',_boardsRailDragCancel,true);
}
function _boardsRailDragMove(e){
  const d=_boardsRailDrag;
  if(!d)return;
  if(!d.moved){
    if(Math.abs(e.clientX-d.x0)<_BOARDS_RAIL_DRAG_PX&&
       Math.abs(e.clientY-d.y0)<_BOARDS_RAIL_DRAG_PX)return;
    d.moved=true;
    _boardsRailGhostShow(d);
  }
  _boardsRailGhostMove(e.clientX,e.clientY);
}
function _boardsRailDragEnd(e){
  const d=_boardsRailDrag;
  _boardsRailDragCancel();
  if(!d||!d.moved)return;                       // a plain click: let it through
  // A drag ends with a click on whatever is under the pointer, and that
  // click would run the rail action a second time. Same guard a card drag
  // arms (_boardsSuppressClick).
  _boardsSuppressClick=true;
  const stage=document.getElementById('board-stage');
  if(!stage)return;
  const r=stage.getBoundingClientRect();
  const inside=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
  if(!inside)return;                            // dropped off the canvas: abandon
  /* THE DROP POINT ONLY SURVIVES IF THE LAST RIGHT-CLICK IS FORGOTTEN, and
     that is a real bug this fixed rather than a precaution. _boardsCtxWorld
     is set when the context menu OPENS and is never cleared when it closes,
     and _boardsCtxRun's own place() overwrites _boardsNextPlacement from it
     — so after one right-click anywhere, every rail drag landed its card at
     that point instead of under the pointer. The rail's CLICK path already
     cleared it (see _boardsWireRail); the drag path was simply missed.
     Measured before the fix: a drop at (300,300) landed at (-1089,-1039),
     the stale point. */
  _boardsCtxWorld=null;
  _boardsNextPlacement=_boardsScreenToWorld(e.clientX,e.clientY);
  _boardsCtxRun(d.act);
}
function _boardsRailDragCancel(){
  _boardsRailDrag=null;
  _boardsRailGhostHide();
  document.removeEventListener('pointermove',_boardsRailDragMove,true);
  document.removeEventListener('pointerup',_boardsRailDragEnd,true);
  document.removeEventListener('pointercancel',_boardsRailDragCancel,true);
}
// The ghost is a chip at the cursor plus a dashed outline showing where the
// card lands. The outline is the useful half — a chip alone tells you what
// you are carrying but not where it will go. Deliberately ONE generic size
// rather than the per-type dimensions: those live in _boardsNewCard, which
// is not pure (it mints an id), and a second copy of that table would be a
// second thing to keep in step.
const _BOARDS_TIP_ID='board-rail-tip',_BOARDS_TIP_DELAY=450;
let _boardsRailTipTimer=null,_boardsRailTipEl=null;
function _boardsRailTipArm(btn){
  _boardsRailTipHide();
  _boardsRailTipTimer=setTimeout(()=>{_boardsRailTipTimer=null;_boardsRailTipShow(btn);},_BOARDS_TIP_DELAY);
}
function _boardsRailTipShow(btn){
  if(!btn||!btn.getAttribute||btn.getAttribute('data-drag')!=='1')return false;
  if(_boardsRailDrag)return false;               // mid-drag: the ghost is the cue
  let el=_boardsRailTipEl;
  if(!el){
    el=document.createElement('div');
    el.id=_BOARDS_TIP_ID;
    el.className='board-rail-tip';
    el.textContent='Drag me';
    document.body.appendChild(el);
    _boardsRailTipEl=el;
  }
  const r=btn.getBoundingClientRect?btn.getBoundingClientRect():{right:0,top:0};
  const ico=btn.querySelector&&btn.querySelector('svg,.rail-glyph');
  const ir=ico&&ico.getBoundingClientRect?ico.getBoundingClientRect():r;
  el.style.left=(r.right+8)+'px';
  el.style.top=((ir.top+ir.bottom)/2)+'px';
  el.classList.add('show');
  return true;
}
function _boardsRailTipHide(){
  if(_boardsRailTipTimer){clearTimeout(_boardsRailTipTimer);_boardsRailTipTimer=null;}
  const el=_boardsRailTipEl;
  _boardsRailTipEl=null;
  if(el&&el.parentNode)el.parentNode.removeChild(el);
}
const _BOARDS_GHOST_ID='board-rail-ghost';
function _boardsRailGhostShow(d){
  _boardsRailGhostHide();
  _boardsRailTipHide();
  const el=document.createElement('div');
  el.id=_BOARDS_GHOST_ID;
  el.className='board-rail-ghost';
  if(d.act==='add:text'){
    // Milanote carries a Note as the CARD it will become — "Start typing…"
    // at the board's zoom, its top-left under the pointer, which is exactly
    // where the drop lands it (placement is by top-left). Other tools keep
    // the chip: their cards' sizes live in _boardsNewCard, which is not
    // pure, and this one is the note the round was about.
    const z=(_editBoard&&_editBoard.zoom)||1;
    el.className='board-rail-ghost note';
    el.style.width=Math.round(_BOARDS_NOTE_W*z)+'px';
    el.style.height=Math.round(_BOARDS_NOTE_H*z)+'px';
    el.style.fontSize=Math.max(6,Math.round(15*z))+'px';
    const ph=document.createElement('span');
    ph.className='ghost-ph';
    ph.textContent='Start typing…';
    el.appendChild(ph);
  }else{
    el.textContent=d.label||'';                 // textContent: it is a label, not markup
  }
  document.body.appendChild(el);
}
function _boardsRailGhostMove(x,y){
  const el=document.getElementById(_BOARDS_GHOST_ID);
  if(!el)return;
  el.style.left=x+'px';el.style.top=y+'px';
  const stage=document.getElementById('board-stage');
  if(!stage)return;
  const r=stage.getBoundingClientRect();
  const over=x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;
  el.classList.toggle('over',over);
  // Off the canvas (over the rail, the top bar) the pointer says so, the
  // way Milanote's does: releasing there abandons the drag.
  try{document.body.style.cursor=over?'':'not-allowed';}catch(e){}
}
function _boardsRailGhostHide(){
  const el=document.getElementById(_BOARDS_GHOST_ID);
  if(el&&el.parentNode)el.parentNode.removeChild(el);
  try{document.body.style.cursor='';}catch(e){}
}
// Escape abandons a drag in flight, like it abandons everything else here.
function _boardsRailDragEscape(e){
  if(_boardsRailDrag&&(e.key==='Escape'||e.key==='Esc'))_boardsRailDragCancel();
}
document.addEventListener('keydown',_boardsRailDragEscape,true);
function _boardCardCenter(c){return{x:c.x+c.w/2,y:c.y+c.h/2};}

/* ── Connectors ─────────────────────────────────────────────────────────
   Two kinds share this layer: card-bound ({from,to}, endpoints follow the
   cards) and freeform ({free:true,x1,y1,x2,y2}, fixed in world space).

   Rewritten Sept 2026 after Afnan reported that lines "are not getting
   selected" and carried none of the actions Milanote gives them.

   THE REASON THEY COULD NOT BE CLICKED is geometry, not a missing handler:
   the stroke was 1.6 world px with `pointer-events:stroke`, so at his 68%
   zoom the clickable target was about one physical pixel of a diagonal
   line. Every line now carries an invisible ~16px companion stroke that
   takes the pointer events, which is the standard fix and the only one
   that scales with zoom.

   CURVES are a quadratic Bezier. The bend is stored as `bx`/`by` — the
   offset of the curve's APEX from the straight-line midpoint, NOT the
   control point. Two reasons: the apex is where the drag handle actually
   sits, so dragging is exact rather than doubled; and storing an OFFSET
   means a card-bound curve keeps its bend when the cards move, where a
   stored control point would leave the curve behind. The control point is
   derived (c = mid + 2·offset), because for a quadratic the apex is at
   0.25·p1 + 0.5·c + 0.25·p2.

   Connectors carry an `id` now. They are merged wholesale rather than per
   item (see _boardsConnDirty), so this costs nothing at sync time, and it
   is what lets a selection survive a delete that shifts every index. Older
   connectors are given one IN MEMORY before _boardsConnBase is taken, so
   the migration never dirties a board on open. */
const _BOARDS_CONN_W={thin:1.4,normal:2.2,thick:4};
let _boardsConnSel=null;          // id of the selected connector, or null
function _boardsConnEnsureIds(){
  let n=0;
  _editConnectors.forEach(cn=>{if(!cn.id){cn.id='k'+(++_boardsCardSeq)+'_'+Date.now()+'_'+(n++);}});
}
function _boardsConnById(id){return _editConnectors.find(cn=>cn.id===id)||null;}
function _boardsConnEnds(cn){
  if(cn.free)return{p1:{x:cn.x1,y:cn.y1},p2:{x:cn.x2,y:cn.y2}};
  const from=_editCards.find(c=>c.id===cn.from),to=_editCards.find(c=>c.id===cn.to);
  if(!from||!to)return null;
  return{p1:_boardCardCenter(from),p2:_boardCardCenter(to)};
}
// Endpoints, the apex (where the bend handle sits and the label is drawn)
// and the derived control point, in one place so the path, the handles and
// the label can never disagree about where the curve is.
function _boardsConnGeom(cn){
  const e=_boardsConnEnds(cn);
  if(!e)return null;
  const mid={x:(e.p1.x+e.p2.x)/2,y:(e.p1.y+e.p2.y)/2};
  const bx=cn.bx||0,by=cn.by||0;
  const apex={x:mid.x+bx,y:mid.y+by};
  const ctrl={x:mid.x+bx*2,y:mid.y+by*2};
  const bent=!!(bx||by);
  return{...e,mid,apex,ctrl,bent,
    d:bent?`M ${e.p1.x} ${e.p1.y} Q ${ctrl.x} ${ctrl.y} ${e.p2.x} ${e.p2.y}`
          :`M ${e.p1.x} ${e.p1.y} L ${e.p2.x} ${e.p2.y}`};
}
function _boardsConnStroke(cn){
  const map={red:'--accent-urgent',amber:'--accent-warning',green:'--accent-success',
    blue:'--cat-notes',purple:'--cat-boards'};
  if(cn.color&&map[cn.color])return`var(${map[cn.color]})`;
  // A custom colour is stored as a literal #RRGGBB, so it goes through the
  // same validator every other stored colour in this file does before it
  // can reach a style attribute. Fail closed: an unrecognised value falls
  // back to the default rather than being passed through.
  const hex=cn.color?_boardsValidHex(cn.color):'';
  if(hex)return hex;
  return cn.free?'var(--text)':'var(--muted)';
}
function _boardsDrawConnectors(){
  const svg=document.getElementById('board-conn-layer');if(!svg)return;
  // orient="auto-start-reverse" is what lets ONE marker serve both ends —
  // the browser flips it for marker-start. `currentColor` makes the head
  // follow the line's own colour, which is set on the path as `color`.
  const defs='<defs><marker id="board-arrow" viewBox="0 0 10 10" refX="9" refY="5" '+
    'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'+
    '<path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>';
  const labels=[];
  const body=_editConnectors.map(cn=>{
    const g=_boardsConnGeom(cn);
    if(!g)return'';
    const sel=_boardsConnSel===cn.id;
    const w=_BOARDS_CONN_W[cn.weight]||_BOARDS_CONN_W.thin;
    const bind=cn.free?'':` data-from="${cn.from}" data-to="${cn.to}"`;
    const marks=(cn.arrow?' marker-end="url(#board-arrow)"':'')+
                (cn.arrowStart?' marker-start="url(#board-arrow)"':'');
    const dash=cn.dash?' stroke-dasharray="7 6"':'';
    let out=
      // The hit path is FIRST and invisible: it takes the pointer events
      // the visible stroke is too thin to catch.
      `<path class="conn-hit" data-conn="${cn.id}"${bind} d="${g.d}"/>`+
      `<path class="conn${cn.free?' free':''}${sel?' selected':''}" data-conn="${cn.id}"${bind} d="${g.d}"`+
      ` style="color:${_boardsConnStroke(cn)}" stroke-width="${w}"${dash}${marks}/>`;
    if(cn.label){
      // Structure only — the text goes in with textContent below, like
      // every other user string in this file.
      out+=`<text class="conn-label" data-conn="${cn.id}" x="${g.apex.x}" y="${g.apex.y-8}" text-anchor="middle"></text>`;
      labels.push({id:cn.id,text:cn.label});
    }
    // A locked line keeps its selection outline (that is how you unlock it)
    // but loses every handle — the same rule locked cards follow.
    if(sel&&!cn.locked){
      out+=`<circle class="conn-h" data-h="a" data-conn="${cn.id}" cx="${g.p1.x}" cy="${g.p1.y}" r="5"/>`+
           `<circle class="conn-h" data-h="b" data-conn="${cn.id}" cx="${g.p2.x}" cy="${g.p2.y}" r="5"/>`+
           `<circle class="conn-h bend" data-h="m" data-conn="${cn.id}" cx="${g.apex.x}" cy="${g.apex.y}" r="5"/>`;
    }
    return out;
  }).join('');
  svg.innerHTML=defs+body;
  labels.forEach(l=>{
    const t=svg.querySelector('text.conn-label[data-conn="'+l.id+'"]');
    if(t)t.textContent=l.text;
  });
}
// Recompute only the paths touching this card. Every element that draws a
// connector carries data-conn, so one pass over the layer keeps the
// visible path, the hit path, the label and the handles in step.
function _boardsUpdateConnectorsFor(cardId){
  const svg=document.getElementById('board-conn-layer');if(!svg)return;
  _editConnectors.forEach(cn=>{
    if(cn.free||(cn.from!==cardId&&cn.to!==cardId))return;
    const g=_boardsConnGeom(cn);if(!g)return;
    svg.querySelectorAll('path[data-conn="'+cn.id+'"]').forEach(pth=>pth.setAttribute('d',g.d));
    const t=svg.querySelector('text.conn-label[data-conn="'+cn.id+'"]');
    if(t){t.setAttribute('x',g.apex.x);t.setAttribute('y',g.apex.y-8);}
    svg.querySelectorAll('circle.conn-h[data-conn="'+cn.id+'"]').forEach(h=>{
      const k=h.getAttribute('data-h');
      const p=k==='a'?g.p1:k==='b'?g.p2:g.apex;
      h.setAttribute('cx',p.x);h.setAttribute('cy',p.y);
    });
  });
}
// Selecting a line and selecting cards are mutually exclusive — the rail
// and every keyboard shortcut act on "the selection", and two kinds of it
// at once would make Delete ambiguous.
function _boardsSelectConn(id){
  if(_boardsSelection.size){_boardsSelection=new Set();_boardsPaintSelection();}
  _boardsConnSel=id;
  _boardsDrawConnectors();
  _boardsRenderRail();
}
function _boardsClearConnSel(){
  if(_boardsConnSel===null)return;
  _boardsConnSel=null;
  _boardsDrawConnectors();
  _boardsRenderRail();
}
window.boardsDeleteConnector=function(id){
  if(!_boardsCanEdit(_editBoard))return;
  const i=_editConnectors.findIndex(cn=>cn.id===id);
  if(i<0)return;
  if(_editConnectors[i].locked){showToast('That line is locked');return;}
  _boardsPushUndo();
  _editConnectors.splice(i,1);
  if(_boardsConnSel===id)_boardsConnSel=null;
  _boardsDrawConnectors();
  _boardsRenderRail();
  _boardsSaveDebounced();
  _boardsUndoableToast('Line deleted');
};
// One setter for every line property, so the rail and the right-click menu
// cannot drift apart on what a change actually does.
window.boardsSetConn=function(id,patch){
  if(!_boardsCanEdit(_editBoard))return;
  const cn=_boardsConnById(id);if(!cn)return;
  _boardsPushUndo();
  Object.keys(patch).forEach(k=>{
    if(patch[k]===null)delete cn[k];else cn[k]=patch[k];
  });
  _boardsDrawConnectors();
  _boardsRenderRail();
  _boardsSaveDebounced();
};
window.boardsConnLabel=function(id){
  const cn=_boardsConnById(id);if(!cn)return;
  const v=prompt('Label for this line',cn.label||'');
  if(v===null)return;
  window.boardsSetConn(id,{label:v.trim()?v.trim().slice(0,60):null});
};
window.boardsDuplicateConnector=function(id){
  if(!_boardsCanEdit(_editBoard))return;
  const cn=_boardsConnById(id);if(!cn)return;
  _boardsPushUndo();
  const copy=JSON.parse(JSON.stringify(cn));
  copy.id='k'+(++_boardsCardSeq)+'_'+Date.now();
  // A card-bound copy would sit exactly on top of the original and look
  // like nothing happened, so it is offset as a freeform line instead.
  const g=_boardsConnGeom(cn);
  if(g){delete copy.from;delete copy.to;copy.free=true;
    copy.x1=g.p1.x+24;copy.y1=g.p1.y+24;copy.x2=g.p2.x+24;copy.y2=g.p2.y+24;}
  _editConnectors.push(copy);
  _boardsConnSel=copy.id;
  _boardsDrawConnectors();
  _boardsRenderRail();
  _boardsSaveDebounced();
};
// Click, right-click and the three drag handles, delegated on the layer —
// the SVG is replaced on every redraw, so per-element listeners would be
// rebound constantly and per-render document listeners would stack.
function _boardsWireConnLayer(svg){
  if(!svg||svg.__wired)return;
  svg.__wired=true;
  svg.addEventListener('pointerdown',e=>{
    const h=e.target.closest&&e.target.closest('circle.conn-h');
    if(h){_boardsConnHandleDrag(e,h);return;}
    const p=e.target.closest&&e.target.closest('path[data-conn]');
    if(!p)return;
    // Stop the stage seeing this as the start of a pan or a marquee.
    e.stopPropagation();
    const id=p.getAttribute('data-conn');
    _boardsSelectConn(id);
    _boardsConnDrag(e,_boardsConnById(id));
  });
}
// Milanote repositions a line by dragging its body. Only a FREEFORM line
// can move: a card-bound one's endpoints ARE the two cards, so dragging it
// would either do nothing or silently break the connection. Its midpoint
// handle still curves it, which is the only free parameter it has.
//
// The bend is stored as an offset from the midpoint (see _boardsConnGeom),
// so moving both endpoints carries the curve along with no extra work.
function _boardsConnDrag(e,cn){
  if(!cn||!cn.free||cn.locked||!_boardsCanEdit(_editBoard))return;
  const svg=document.getElementById('board-conn-layer');
  const b=_editBoard;
  if(!svg||!b)return;
  const o={x1:cn.x1,y1:cn.y1,x2:cn.x2,y2:cn.y2};
  const startX=e.clientX,startY=e.clientY;
  let pushed=false;
  try{svg.setPointerCapture(e.pointerId);}catch(err){}
  function move(ev){
    if(_boardsPinch)return;
    // One undo entry per gesture, on the first real movement — a plain
    // click to select must not leave a no-op in the stack.
    if(!pushed){_boardsPushUndo();pushed=true;}
    const dx=(ev.clientX-startX)/b.zoom,dy=(ev.clientY-startY)/b.zoom;
    cn.x1=o.x1+dx;cn.y1=o.y1+dy;cn.x2=o.x2+dx;cn.y2=o.y2+dy;
    _boardsDrawConnectors();
  }
  function up(){
    svg.removeEventListener('pointermove',move);
    svg.removeEventListener('pointerup',up);
    if(!pushed)return;
    // A drag ends with a click on whatever is under the pointer; swallow it,
    // the same guard card drags use.
    _boardsSuppressClick=true;
    _boardsSaveDebounced();
  }
  svg.addEventListener('pointermove',move);
  svg.addEventListener('pointerup',up);
}
function _boardsConnHandleDrag(e,handle){
  e.stopPropagation();e.preventDefault();
  if(!_boardsCanEdit(_editBoard))return;
  const cn=_boardsConnById(handle.getAttribute('data-conn'));if(!cn)return;
  if(cn.locked)return;
  const kind=handle.getAttribute('data-h');
  let pushed=false;
  // Kept in the closure, NOT on the connector. Connectors are saved as
  // plain JSON with no _-prefix stripping of their own (that rule is for
  // cards, see _boardsCardsForSave), so a scratch field parked on one
  // would be written to the document and outlive the gesture.
  let bindA=cn.free?null:cn.from,bindB=cn.free?null:cn.to;
  handle.setPointerCapture(e.pointerId);
  function move(ev){
    if(!pushed){_boardsPushUndo();pushed=true;}
    const w=_boardsScreenToWorld(ev.clientX,ev.clientY);
    if(kind==='m'){
      const g=_boardsConnGeom(cn);
      if(g){cn.bx=w.x-g.mid.x;cn.by=w.y-g.mid.y;}
    }else{
      // Dragging an endpoint of a CARD-BOUND line detaches it into a
      // freeform one; the drop decides whether it re-attaches. Anything
      // else would mean an endpoint you cannot move off a card.
      if(!cn.free){
        const g=_boardsConnGeom(cn);
        if(g){cn.free=true;cn.x1=g.p1.x;cn.y1=g.p1.y;cn.x2=g.p2.x;cn.y2=g.p2.y;
          delete cn.from;delete cn.to;}
      }
      if(kind==='a'){cn.x1=w.x;cn.y1=w.y;}else{cn.x2=w.x;cn.y2=w.y;}
    }
    _boardsDrawConnectors();
  }
  function up(ev){
    handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);
    if(!pushed)return;
    if(kind!=='m'){
      // Dropped on a card? Re-bind that end to it. Both ends on cards
      // turns the line back into a card-bound one, so it follows them.
      const el=document.elementFromPoint(ev.clientX,ev.clientY);
      const card=el&&el.closest?el.closest('.board-card-el,.board-frame'):null;
      const id=card&&card.dataset?card.dataset.id:null;
      if(id){if(kind==='a')bindA=id;else bindB=id;}
      if(bindA&&bindB&&bindA!==bindB){
        cn.from=bindA;cn.to=bindB;delete cn.free;
        delete cn.x1;delete cn.y1;delete cn.x2;delete cn.y2;
      }
    }
    _boardsDrawConnectors();
    _boardsSaveDebounced();
  }
  handle.addEventListener('pointermove',move);
  handle.addEventListener('pointerup',up);
}
// One router for every line action, reached from the rail and from the
// right-click menu alike — the rule the card actions already follow.
function _boardsConnAction(rest){
  const id=_boardsConnSel;
  if(!id)return;
  const cn=_boardsConnById(id);if(!cn)return;
  if(rest.indexOf('w:')===0){window.boardsSetConn(id,{weight:rest.slice(2)});return;}
  if(rest.indexOf('c:')===0){
    const v=rest.slice(2);
    window.boardsSetConn(id,{color:v==='none'?null:v});return;
  }
  switch(rest){
    case'arrow':window.boardsSetConn(id,{arrow:cn.arrow?null:true});break;
    case'arrowStart':window.boardsSetConn(id,{arrowStart:cn.arrowStart?null:true});break;
    case'dash':window.boardsSetConn(id,{dash:cn.dash?null:true});break;
    case'straight':window.boardsSetConn(id,{bx:null,by:null});break;
    case'weight':{
      const order=['thin','normal','thick'];
      const next=order[(order.indexOf(cn.weight||'thin')+1)%order.length];
      window.boardsSetConn(id,{weight:next==='thin'?null:next});
      showToast('Line weight: '+next);
      break;
    }
    case'deselect':_boardsClearConnSel();break;
    case'lock':window.boardsSetConn(id,{locked:cn.locked?null:true});
      showToast(cn.locked?'Line unlocked':'Line locked');break;
    // Connectors paint in array order, exactly like cards (Stage 2) — so
    // z-order is a reorder of that array and needs no stored field.
    case'front':case'back':{
      const i=_editConnectors.findIndex(x=>x.id===id);
      if(i<0)break;
      _boardsPushUndo();
      const[moved]=_editConnectors.splice(i,1);
      if(rest==='front')_editConnectors.push(moved);else _editConnectors.unshift(moved);
      _boardsDrawConnectors();
      _boardsSaveDebounced();
      break;
    }
    case'custom':window.boardsOpenColorPicker('conn',id);break;
    case'copy':case'cut':{
      // Fire the real clipboard event rather than duplicating the logic, so
      // the system clipboard stays the single source of truth (Stage 2).
      let ok=false;
      try{ok=document.execCommand(rest);}catch(e){ok=false;}
      if(!ok)showToast('Use Ctrl+'+(rest==='cut'?'X':'C'));
      break;
    }
    case'label':window.boardsConnLabel(id);break;
    case'dup':window.boardsDuplicateConnector(id);break;
    case'delete':window.boardsDeleteConnector(id);break;
    default:break;
  }
}
// What the rail and the right-click menu both offer for a selected line.
function _boardsConnItems(cn,canEdit){
  const items=[{title:(cn.free?'Line':'Connector')+(cn.locked?' · Locked':'')}];
  if(!canEdit)return items;
  // The same shared block a card's menu opens with, so the shortcuts are
  // taught in both places and mean the same thing.
  items.push({act:'ln:cut',label:'Cut',hint:'Ctrl X'});
  items.push({act:'ln:copy',label:'Copy',hint:'Ctrl C'});
  items.push({act:'ln:dup',label:'Duplicate',hint:'Ctrl D'});
  items.push({act:'ln:delete',label:'Delete',hint:'Del',danger:true});
  items.push({sep:true});
  items.push({act:'ln:lock',label:cn.locked?'Unlock position':'Lock position'});
  items.push({act:'ln:front',label:'Bring to front'});
  items.push({act:'ln:back',label:'Send to back'});
  if(cn.locked)return items;
  items.push({sep:true});
  items.push({act:'ln:arrowStart',label:(cn.arrowStart?'✓ ':'')+'Arrow at the start'});
  items.push({act:'ln:arrow',label:(cn.arrow?'✓ ':'')+'Arrow at the end'});
  items.push({act:'ln:dash',label:(cn.dash?'✓ ':'')+'Dashed'});
  items.push({sep:true});
  items.push({act:'ln:w:thin',label:(!cn.weight||cn.weight==='thin'?'✓ ':'')+'Thin'});
  items.push({act:'ln:w:normal',label:(cn.weight==='normal'?'✓ ':'')+'Medium'});
  items.push({act:'ln:w:thick',label:(cn.weight==='thick'?'✓ ':'')+'Thick'});
  items.push({sep:true});
  items.push({act:'ln:label',label:cn.label?'Edit label…':'Add a label…'});
  if(cn.bx||cn.by)items.push({act:'ln:straight',label:'Straighten'});
  items.push({connSwatches:cn.id});
  items.push({act:'ln:custom',label:'Custom colour…'});
  return items;
}
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
      if(!exists){_boardsPushUndo();_editConnectors.push({id:'k'+(++_boardsCardSeq)+'_'+Date.now(),from:cardId,to:toId,arrow:true});_boardsDrawConnectors();_boardsSaveDebounced();}
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
// Leaving the edit form fetches a preview for whatever URL is in it now.
// Typing is NOT what triggers a fetch — that would fire a server request per
// keystroke against a half-typed address.
window.boardsLinkDone=function(id){
  const c=_editCards.find(x=>x.id===id);
  if(!c||!_boardsCanEdit(_editBoard))return;
  delete c._linkEdit;
  const url=String(c.linkUrl||'').trim();
  if(url&&url!==c._linkFetched){c._linkFetched=url;_boardsLinkHydrate(id);}
  else _boardsRenderCanvasAndWire();
};
// Show or hide the preview picture. Stored ON THE CARD, not per viewer: a
// board is looked at by several people and a card that is a picture for one
// of them and three lines of text for another is two different cards.
window.boardsLinkTogglePreview=function(id){
  const c=_editCards.find(x=>x.id===id);
  if(!c||!c.linkImage||!_boardsCanEdit(_editBoard))return;
  _boardsPushUndo();
  if(c.linkPreviewOff)delete c.linkPreviewOff;else c.linkPreviewOff=true;
  // Only a card still at one of OUR two sizes follows — one somebody sized
  // by hand keeps it, the same guard the image and PDF fits use.
  if(c.w===_BOARDS_LINK_PREVIEW_W){
    if(c.linkPreviewOff&&c.h===_BOARDS_LINK_PREVIEW_H)c.h=_BOARDS_LINK_TEXT_H;
    else if(!c.linkPreviewOff&&c.h===_BOARDS_LINK_TEXT_H)c.h=_BOARDS_LINK_PREVIEW_H;
  }
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
window.boardsLinkEdit=function(id){
  const c=_editCards.find(x=>x.id===id);
  if(!c||!_boardsCanEdit(_editBoard))return;
  c._linkEdit=true;
  _boardsRenderCanvasAndWire();
};
// "Fetch the preview again" — for a page that has changed, or one that was
// unreachable the first time.
window.boardsLinkRefresh=function(id){
  const c=_editCards.find(x=>x.id===id);
  if(!c||!c.linkUrl||!_boardsCanEdit(_editBoard))return;
  delete c.linkSite;
  c._linkFetched=c.linkUrl;
  _boardsLinkHydrate(id);
};
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
/* ── Tables ─────────────────────────────────────────────────────────────
   A plain rows[][] of strings on the card — no per-cell records and no
   column schema. The engineering spec written from the teardown proposed
   typed columns; that is a second data model to migrate and to validate,
   to hold what these boards actually use a table for, which is a small
   grid of text beside a tech pack. A typed table can be built on top of
   this later; the reverse is not true. */
/* ── Table cells ───────────────────────────────────────────────────
   A cell is stored as a BARE STRING until it carries an attribute, and
   becomes an object {v,…} only then. Two reasons, and they are the whole
   reason this needs no migration: 'Auto' — the default cell type — is
   exactly what a bare string already means, so every table written before
   this reads correctly with no rewrite; and a table of plain text costs
   the bytes it always did on a document that is rewritten on every
   autosave.

   _boardsCellWrite DOWNGRADES back to a bare string the moment the last
   attribute is cleared, so a cell that was bolded and un-bolded does not
   leave an object behind. Nothing outside these helpers may read or write
   c.rows[r][i] directly — seven call sites used to, and each would have
   rendered "[object Object]" the first time a cell grew an attribute. */
const _BOARDS_CELL_ATTRS=['b','i','sz','bg','al','t','fmt'];
/* ── Cell types ───────────────────────────────────────────────────
   THE VALUE IS ALWAYS THE RAW STRING THE PERSON TYPED. A number cell
   stores '1200' and DISPLAYS '1,200.00'; the formatting is derived at
   render and never written back. That is what makes a type change
   lossless in both directions — switch to Text and you get your '007'
   back, not '7' — and it keeps _boardsCellVal the single reader that
   every export, the search index and M5's parser can rely on.

   'auto' is the absence of a type, which is why a bare string needs no
   migration to have one. Auto does NOT reformat what you typed: it
   renders verbatim and only right-aligns when the value is numeric,
   because a type you did not choose silently rewriting '007' to '7'
   would be the most surprising thing in the feature. */
const _BOARDS_CELL_TYPES=['auto','number','currency','percent','text','date','check'];
const _BOARDS_CURRENCIES=[['Rs','Rs '],['usd','$'],['eur','€'],['gbp','£']];
function _boardsCellType(cell){
  const t=_boardsCellAttr(cell,'t');
  return _BOARDS_CELL_TYPES.indexOf(t)>0?t:'auto';
}
function _boardsCellFmt(cell){
  const f=_boardsCellAttr(cell,'fmt');
  return (f&&typeof f==='object')?f:{};
}
// The numeric reading of a cell, or null. Tolerant of what people actually
// type — thousands separators, a currency symbol, a trailing % — because
// the stored value is raw text and a typed cell should not stop computing
// just because someone pasted '1,200'. M5's SUM reads through this.

/* ── Formulas ──────────────────────────────────────────────────────
   A FORMULA IS THE CELL'S VALUE, not a separate field: `v` holds the
   literal text '=SUM(B2:B4)'. The spec's build note proposed a `formula`
   field; storing it in the value is better here, and all three reasons
   fall out of M4's model:

     - The raw string is what you EDIT, so double-clicking a formula cell
       already puts '=SUM(B2:B4)' under the caret with nothing new wired.
     - It round-trips through every export, the clipboard and the search
       index untouched, because those already read the raw value.
     - It needs no entry in _BOARDS_CELL_ATTRS, so the downgrade-to-a-
       bare-string can never throw it away — the exact bug that nearly ate
       cell types in M4.

   Typing '=SUM(B2:B4)' by hand also just works, which is the first thing
   anyone who has used a spreadsheet will try.

   THE RESULT IS NEVER STORED. It is computed at render from the grid as it
   stands, so there is no cache to invalidate and no way for a stale total
   to outlive a dependency change. Recomputing ~50 formulas over ~20 cells
   each is a few thousand lookups on a structural render; the renders that
   matter for feel (drag, resize) do not rebuild cells at all.

   Written by hand rather than with a parser library — this module has held
   the zero-new-deps line since Stage 1, and the grammar is small enough to
   read in one sitting. */
const _BOARDS_FX_ERR={ref:'#REF!',cycle:'#CYCLE!',err:'#ERR!',div:'#DIV/0!',name:'#NAME?'};
const _BOARDS_FX_FNS=['SUM','AVERAGE','MIN','MAX','COUNT','IF'];
function _boardsIsFormula(cell){ return /^\s*=/.test(_boardsCellVal(cell)); }

function _boardsFxTokens(src){
  const out=[];let i=0;
  while(i<src.length){
    const c=src[i];
    if(/\s/.test(c)){i++;continue;}
    if(/[0-9]/.test(c)||(c==='.'&&/[0-9]/.test(src[i+1]||''))){
      let j=i;while(j<src.length&&/[0-9.]/.test(src[j]))j++;
      const n=parseFloat(src.slice(i,j));
      if(!isFinite(n))return null;
      out.push({t:'num',v:n});i=j;continue;
    }
    if(c==='"'){
      let j=i+1,str='';
      while(j<src.length&&src[j]!=='"'){str+=src[j];j++;}
      if(j>=src.length)return null;                 // unterminated string
      out.push({t:'str',v:str});i=j+1;continue;
    }
    if(/[A-Za-z_]/.test(c)){
      let j=i;while(j<src.length&&/[A-Za-z0-9_]/.test(src[j]))j++;
      out.push({t:'name',v:src.slice(i,j)});i=j;continue;
    }
    const two=src.substr(i,2);
    if(two==='>='||two==='<='||two==='<>'){out.push({t:'op',v:two});i+=2;continue;}
    if('+-*/(),:=<>'.indexOf(c)>-1){out.push({t:'op',v:c});i++;continue;}
    return null;                                    // character we do not know
  }
  return out;
}
// A range is only ever a function argument; it is carried as a marker so
// that reaching arithmetic with one is an error rather than a silent NaN.
function _boardsFxRange(cells){ return{__range:cells}; }
function _boardsFxThrow(e){ throw{fx:e}; }

/* Recursive descent. Precedence, loosest first:
     compare   ->  add ( (>|>=|<|<=|=|<>) add )?
     add       ->  mul ( (+|-) mul )*
     mul       ->  unary ( (*|/) unary )*
     unary     ->  '-'? primary
     primary   ->  number | string | '(' compare ')'
                 | NAME '(' args ')'            a function call
                 | REF ':' REF                  a range
                 | REF                          one cell               */
function _boardsFxParser(tokens,card,seen){
  let p=0;
  const peek=()=>tokens[p];
  const eat=v=>{const t=tokens[p];if(t&&t.t==='op'&&t.v===v){p++;return true;}return false;};
  function primary(){
    const t=tokens[p];
    if(!t)_boardsFxThrow(_BOARDS_FX_ERR.err);
    if(t.t==='num'){p++;return t.v;}
    if(t.t==='str'){p++;return t.v;}
    if(t.t==='op'&&t.v==='('){p++;const v=compare();if(!eat(')'))_boardsFxThrow(_BOARDS_FX_ERR.err);return v;}
    if(t.t==='name'){
      p++;
      if(peek()&&peek().t==='op'&&peek().v==='('){
        p++;
        const args=[];
        if(!(peek()&&peek().t==='op'&&peek().v===')')){
          args.push(compare());
          while(eat(','))args.push(compare());
        }
        if(!eat(')'))_boardsFxThrow(_BOARDS_FX_ERR.err);
        return _boardsFxCall(t.v,args);
      }
      // A range, or a single reference.
      if(peek()&&peek().t==='op'&&peek().v===':'){
        const nxt=tokens[p+1];
        if(!nxt||nxt.t!=='name')_boardsFxThrow(_BOARDS_FX_ERR.ref);
        p+=2;
        return _boardsFxRange(_boardsFxRangeCells(card,t.v,nxt.v,seen));
      }
      return _boardsFxCell(card,t.v,seen);
    }
    _boardsFxThrow(_BOARDS_FX_ERR.err);
  }
  function num(v){
    if(v&&v.__range)_boardsFxThrow(_BOARDS_FX_ERR.err);   // a range is not a number
    if(typeof v==='number')return v;
    if(v==='' ||v==null)return 0;
    const n=parseFloat(String(v).replace(/[,\s]/g,''));
    return isFinite(n)?n:_boardsFxThrow(_BOARDS_FX_ERR.err);
  }
  function unary(){ if(eat('-'))return -num(unary()); if(eat('+'))return num(unary()); return primary(); }
  function mul(){
    let v=unary();
    for(;;){
      if(eat('*'))v=num(v)*num(unary());
      else if(eat('/')){const d=num(unary());if(d===0)_boardsFxThrow(_BOARDS_FX_ERR.div);v=num(v)/d;}
      else return v;
    }
  }
  function add(){
    let v=mul();
    for(;;){
      if(eat('+'))v=num(v)+num(mul());
      else if(eat('-'))v=num(v)-num(mul());
      else return v;
    }
  }
  function compare(){
    const a=add();
    const t=peek();
    if(t&&t.t==='op'&&['>','>=','<','<=','=','<>'].indexOf(t.v)>-1){
      p++;const b=add();
      // Numbers compare numerically, anything else as text — the least
      // surprising rule, and the only one that works for IF(A1="ok",…).
      const both=(typeof a==='number'&&typeof b==='number');
      const x=both?a:String(a),y=both?b:String(b);
      switch(t.v){
        case'>':return x>y; case'>=':return x>=y;
        case'<':return x<y; case'<=':return x<=y;
        case'=':return x===y; default:return x!==y;
      }
    }
    return a;
  }
  const value=compare();
  if(p!==tokens.length)_boardsFxThrow(_BOARDS_FX_ERR.err);   // trailing junk
  return value;
}
function _boardsFxCell(card,ref,seen){
  const rc=_boardsRefToRC(ref);
  if(!rc)_boardsFxThrow(_BOARDS_FX_ERR.name);
  const cell=_boardsCellAt(card,rc.r,rc.i);
  if(cell===undefined)_boardsFxThrow(_BOARDS_FX_ERR.ref);
  const key=rc.r+','+rc.i;
  if(seen.has(key))_boardsFxThrow(_BOARDS_FX_ERR.cycle);
  if(_boardsIsFormula(cell)){
    const next=new Set(seen);next.add(key);
    const out=_boardsFxRun(card,_boardsCellVal(cell),next);
    if(out.err)_boardsFxThrow(out.err);
    return out.value;
  }
  const n=_boardsCellNum(cell);
  return n===null?_boardsCellVal(cell):n;
}
function _boardsFxRangeCells(card,a,b,seen){
  const ra=_boardsRefToRC(a),rb=_boardsRefToRC(b);
  if(!ra||!rb)_boardsFxThrow(_BOARDS_FX_ERR.name);
  const out=[];
  const r0=Math.min(ra.r,rb.r),r1=Math.max(ra.r,rb.r);
  const i0=Math.min(ra.i,rb.i),i1=Math.max(ra.i,rb.i);
  // A range over a shape that no longer exists is #REF!, not a silent zero.
  const rows=Array.isArray(card&&card.rows)?card.rows:[];
  if(r1>=rows.length||i1>=((rows[0]||[]).length))_boardsFxThrow(_BOARDS_FX_ERR.ref);
  for(let r=r0;r<=r1;r++)for(let i=i0;i<=i1;i++)
    out.push(_boardsFxCell(card,_boardsCellRef(r,i),seen));
  return out;
}
function _boardsFxFlat(args){
  const out=[];
  args.forEach(a=>{ if(a&&a.__range)a.__range.forEach(v=>out.push(v)); else out.push(a); });
  return out;
}
function _boardsFxNums(args){
  // Non-numeric cells are SKIPPED, not zero and not an error — a column of
  // figures with a text header must still add up.
  return _boardsFxFlat(args).filter(v=>typeof v==='number'&&isFinite(v));
}
function _boardsFxCall(name,args){
  const fn=String(name||'').toUpperCase();
  if(_BOARDS_FX_FNS.indexOf(fn)<0)_boardsFxThrow(_BOARDS_FX_ERR.name);
  if(fn==='IF'){
    if(args.length<2||args.length>3)_boardsFxThrow(_BOARDS_FX_ERR.err);
    const c=args[0];
    const truth=(typeof c==='boolean')?c:(typeof c==='number'?c!==0:String(c||'')!=='');
    const pick=truth?args[1]:(args.length>2?args[2]:'');
    return (pick&&pick.__range)?_boardsFxThrow(_BOARDS_FX_ERR.err):pick;
  }
  const ns=_boardsFxNums(args);
  if(fn==='COUNT')return ns.length;
  if(fn==='SUM')return ns.reduce((a,b)=>a+b,0);
  if(fn==='AVERAGE'){ if(!ns.length)_boardsFxThrow(_BOARDS_FX_ERR.div); return ns.reduce((a,b)=>a+b,0)/ns.length; }
  if(!ns.length)return 0;                       // MIN/MAX of nothing, as Excel
  return fn==='MIN'?Math.min.apply(null,ns):Math.max.apply(null,ns);
}
// The only entry point. Always returns {value} or {err} — it never throws,
// so no caller has to guard, and a broken formula shows an error IN the
// cell rather than taking the render down with it.
function _boardsFxRun(card,src,seen){
  const text=String(src==null?'':src).replace(/^\s*=/,'');
  if(!text.trim())return{err:_BOARDS_FX_ERR.err};
  const toks=_boardsFxTokens(text);
  if(!toks||!toks.length)return{err:_BOARDS_FX_ERR.err};
  try{ return{value:_boardsFxParser(toks,card,seen||new Set())}; }
  catch(e){ return{err:(e&&e.fx)||_BOARDS_FX_ERR.err}; }
}
function _boardsFxResult(cell,card){
  if(!card||!_boardsIsFormula(cell))return null;
  return _boardsFxRun(card,_boardsCellVal(cell),new Set());
}
function _boardsCellNum(cell,card){
  if(card&&_boardsIsFormula(cell)){
    const out=_boardsFxRun(card,_boardsCellVal(cell),new Set());
    return (!out.err&&typeof out.value==='number'&&isFinite(out.value))?out.value:null;
  }
  const raw=_boardsCellVal(cell).trim();
  if(!raw)return null;
  const cleaned=raw.replace(/[,\s]/g,'').replace(/^[^0-9.+-]+/,'').replace(/%$/,'');
  if(!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned))return null;
  const n=parseFloat(cleaned);
  return isFinite(n)?n:null;
}
function _boardsFmtNum(n,d,sep){
  const fixed=Math.abs(n).toFixed(Math.max(0,Math.min(6,d|0)));
  const bits=fixed.split('.');
  let int=bits[0];
  if(sep!==false)int=int.replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return (n<0?'-':'')+int+(bits[1]?'.'+bits[1]:'');
}
const _BOARDS_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function _boardsFmtDate(raw,how){
  const d=new Date(raw);
  if(!raw||isNaN(d.getTime()))return null;       // not a date: show it raw
  const p=n=>(n<10?'0':'')+n;
  const dd=d.getDate(),mm=d.getMonth(),yy=d.getFullYear();
  if(how==='s')return p(dd)+'/'+p(mm+1)+'/'+yy;
  if(how==='i')return yy+'-'+p(mm+1)+'-'+p(dd);
  if(how==='t')return dd+' '+_BOARDS_MONTHS[mm]+' '+yy+', '+p(d.getHours())+':'+p(d.getMinutes());
  return dd+' '+_BOARDS_MONTHS[mm]+' '+yy;
}
// What the cell SHOWS. Never what it stores.
function _boardsCellDisplay(cell,card){
  const raw=_boardsCellVal(cell);
  const t=_boardsCellType(cell);
  if(_boardsIsFormula(cell)){
    // Without the card there is no grid to read, so the formula shows as
    // written rather than as a wrong answer. That is the honest fallback
    // for any caller that genuinely has no card in hand.
    if(!card)return raw;
    const out=_boardsFxRun(card,raw,new Set());
    if(out.err)return out.err;
    if(typeof out.value==='boolean')return out.value?'TRUE':'FALSE';
    if(typeof out.value!=='number')return String(out.value==null?'':out.value);
    // A formula result is formatted by the cell's own type, so
    // =SUM(B2:B4) in a currency cell reads 'Rs 45,000' like any other.
    return _boardsCellDisplay({v:String(out.value),t:_boardsCellAttr(cell,'t'),
                               fmt:_boardsCellAttr(cell,'fmt')});
  }
  if(t==='auto'||t==='text')return raw;
  if(t==='check')return raw?'✓':'';
  const f=_boardsCellFmt(cell);
  if(t==='date'){ const out=_boardsFmtDate(raw,f.f); return out==null?raw:out; }
  const n=_boardsCellNum(cell);
  if(n===null)return raw;                         // invalid: show what they typed
  if(t==='number')return _boardsFmtNum(n,f.d==null?0:f.d,true);
  // Percentage does NOT multiply by 100. Type 12, see 12% — a deliberate
  // divergence from the spreadsheet convention, because in a garment ops
  // tool people type 12 meaning a 12% rejection rate and silently turning
  // that into 1200% would be the most confusing thing in the feature.
  if(t==='percent')return _boardsFmtNum(n,f.d==null?0:f.d,true)+'%';
  if(t==='currency'){
    const sym=(_BOARDS_CURRENCIES.find(c=>c[0]===f.c)||_BOARDS_CURRENCIES[0])[1];
    return sym+_boardsFmtNum(n,f.d==null?0:f.d,true);
  }
  return raw;
}
// A typed numeric cell holding text it cannot read. Flagged, never
// rejected: refusing a keystroke inside a contenteditable is miserable,
// and the person can see what they typed and fix it.
function _boardsCellInvalid(cell,card){
  if(_boardsIsFormula(cell)){
    const out=_boardsFxResult(cell,card);
    return !!(out&&out.err);
  }
  const t=_boardsCellType(cell);
  if(t!=='number'&&t!=='currency'&&t!=='percent')return false;
  return _boardsCellVal(cell).trim()!==''&&_boardsCellNum(cell)===null;
}
// Numbers sit right unless the cell says otherwise — the spreadsheet
// default, and the one piece of formatting 'auto' does apply.
function _boardsCellAlign(cell,card){
  const a=_boardsCellAttr(cell,'al');
  if(a)return a;
  const t=_boardsCellType(cell);
  if(t==='check')return 'c';
  if(t==='number'||t==='currency'||t==='percent')return 'r';
  // A formula returning a number sits right like any other number.
  if(t==='auto'&&_boardsCellNum(cell,card)!==null)return 'r';
  return '';
}
/* Spreadsheet coordinates. These are DISPLAY-ONLY and are never stored:
   the letter is derived from the column index and the number is the row
   index + 1, so they cost nothing, cannot go stale, and need no migration.
   They map 1:1 onto the stored array — B1 is rows[0][1] whether or not
   `head` is set, because `head` is pure styling (it renders row 0 as <th>)
   and nothing else. A spreadsheet whose row 1 holds labels and whose sum
   reads SUM(B2:B4) is the behaviour everyone already knows, and the
   grammar M5 parses then needs no special case anywhere. */
function _boardsColName(i){
  let n=Math.max(0,i|0),out='';
  do{ out=String.fromCharCode(65+(n%26))+out; n=Math.floor(n/26)-1; }while(n>=0);
  return out;
}
function _boardsCellRef(r,i){ return _boardsColName(i)+(r+1); }
// The inverse, for M5's parser. Null for anything that is not a reference.
function _boardsRefToRC(ref){
  const m=/^([A-Za-z]+)([0-9]+)$/.exec(String(ref||'').trim());
  if(!m)return null;
  let col=0;
  for(const ch of m[1].toUpperCase())col=col*26+(ch.charCodeAt(0)-64);
  const r=parseInt(m[2],10)-1;
  if(r<0)return null;
  return{r:r,i:col-1};
}
function _boardsCellVal(cell){
  if(cell&&typeof cell==='object')return String(cell.v==null?'':cell.v);
  return String(cell==null?'':cell);
}
function _boardsCellAttr(cell,k){
  return (cell&&typeof cell==='object')?cell[k]:undefined;
}
function _boardsCellAt(c,r,i){
  const rows=(c&&Array.isArray(c.rows))?c.rows:null;
  if(!rows||!Array.isArray(rows[r]))return undefined;
  return rows[r][i];
}
function _boardsCellWrite(c,r,i,patch){
  if(!c||!Array.isArray(c.rows)||!Array.isArray(c.rows[r]))return false;
  if(i<0||i>=c.rows[r].length)return false;
  const cur=c.rows[r][i];
  const next=(cur&&typeof cur==='object')?Object.assign({},cur):{v:_boardsCellVal(cur)};
  Object.keys(patch).forEach(k=>{
    const v=patch[k];
    // '' / false / null / undefined all mean "back to the default", which
    // is an ABSENT key — that is what lets the downgrade below happen.
    if(v===undefined||v===null||v===''||v===false)delete next[k];
    else next[k]=v;
  });
  const dressed=_BOARDS_CELL_ATTRS.some(k=>next[k]!==undefined);
  c.rows[r][i]=dressed?next:_boardsCellVal(next);
  return true;
}
// Text attributes reach a style attribute; the BACKGROUND does not. A cell
// colour is a palette NAME painted by a class, because the swatch palette
// maps to CSS variables that INVERT with the theme — a stored literal hex
// would be light-on-light in dark mode, which is exactly the bug the
// embellishments sweep just spent a round removing. It is also a stricter
// allow-list than validating a hex: six names, nothing else renders.
function _boardsCellStyle(cell,card){
  const al=_boardsCellAlign(cell,card);
  const out=[];
  if(al==='c')out.push('text-align:center');
  else if(al==='r')out.push('text-align:right');
  if(!cell||typeof cell!=='object')return out.join(';');
  if(cell.b)out.push('font-weight:700');
  if(cell.i)out.push('font-style:italic');
  // Card-internal, so these are multiplied by the board zoom like every
  // other card size — "small" at 12px was 10px at the 84% Afnan works at.
  // 13 is the floor the rest of a card now holds to; the default cell is
  // .board-card-body at 15.
  if(cell.sz==='s')out.push('font-size:13px');
  else if(cell.sz==='l')out.push('font-size:18px');
  return out.join(';');
}
function _boardsCellClass(cell,card){
  const bg=_boardsCellAttr(cell,'bg');
  let out=(bg&&bg!=='none'&&_BOARDS_COLORS.indexOf(bg)>-1)?' cell-bg-'+bg:'';
  const t=_boardsCellType(cell);
  if(t!=='auto')out+=' cell-t-'+t;
  if(_boardsIsFormula(cell))out+=' cell-fx';
  if(_boardsCellInvalid(cell,card))out+=' cell-bad';
  return out;
}
// The focused cell, or null. Re-derived rather than trusted: a row or
// column can be removed, the card can be deleted, or a remote merge can
// shrink the table under us, and a stale {id,r,i} must not paint a ring on
// whatever moved into those coordinates.
function _boardsFocusedCell(){
  const f=_boardsCellFocus;
  if(!f)return null;
  const c=_editCards.find(x=>x.id===f.id);
  if(!c||c.type!=='table'||!Array.isArray(c.rows))return null;
  if(!Array.isArray(c.rows[f.r])||f.i<0||f.i>=c.rows[f.r].length)return null;
  return{card:c,r:f.r,i:f.i,cell:c.rows[f.r][f.i]};
}
window.boardsFocusCell=function(ev,id,r,i){
  const c=_editCards.find(x=>x.id===id);
  if(!c)return;
  _boardsCellFocus={id:id,r:r,i:i};
  // You edit the RAW value, never the formatted one: a currency cell
  // showing "Rs 1,200" must put "1200" under the caret, or the first
  // keystroke would be appended to a string the model never held.
  const el=document.getElementById('board-td-'+id+'-'+r+'-'+i);
  if(el&&_boardsCanEdit(_editBoard)&&!c.locked){
    const raw=_boardsCellVal(_boardsCellAt(c,r,i));
    if(el.textContent!==raw)el.textContent=raw;
  }
  window.boardsBeginEdit(ev,'board-td-'+id+'-'+r+'-'+i);
  _boardsRenderRail();
  _boardsPaintCellFocus();
};
function _boardsPaintCellFocus(){
  const stage=document.getElementById('board-stage');
  if(!stage)return;
  stage.querySelectorAll('.board-td.focused').forEach(el=>el.classList.remove('focused'));
  const f=_boardsFocusedCell();
  if(!f)return;
  const td=document.getElementById('board-td-'+f.card.id+'-'+f.r+'-'+f.i);
  if(td)td.classList.add('focused');
}
window.boardsTableInput=function(id,r,i,el){
  const c=_editCards.find(x=>x.id===id);
  if(!c||!Array.isArray(c.rows)||!c.rows[r])return;
  _boardsCellWrite(c,r,i,{v:el.textContent});
  _boardsSaveDebounced();
};
// The cell toolbar's actions. Every one is a patch through
// _boardsCellWrite, so the lazy upgrade/downgrade is in exactly one place.
window.boardsCellAction=function(what){
  const f=_boardsFocusedCell();
  if(!f||!_boardsCanEdit(_editBoard))return;
  if(f.card.locked)return showToast('Card is locked — unlock it to edit it');
  const cur=f.cell;
  _boardsPushUndo();
  if(what==='bold')       _boardsCellWrite(f.card,f.r,f.i,{b:!_boardsCellAttr(cur,'b')});
  else if(what==='italic')_boardsCellWrite(f.card,f.r,f.i,{i:!_boardsCellAttr(cur,'i')});
  else if(what==='size'){
    const order=['','l','s'],at=order.indexOf(_boardsCellAttr(cur,'sz')||'');
    _boardsCellWrite(f.card,f.r,f.i,{sz:order[(at+1)%order.length]});
  }
  else if(what==='align'){
    const order=['','c','r'],at=order.indexOf(_boardsCellAttr(cur,'al')||'');
    _boardsCellWrite(f.card,f.r,f.i,{al:order[(at+1)%order.length]});
  }
  // Clear resets PRESENTATION only. The type is what the cell IS, not how
  // it looks, and losing it to a "clear formatting" button would silently
  // reformat every number in the column.
  else if(what==='clear') _boardsCellWrite(f.card,f.r,f.i,
    {b:'',i:'',sz:'',al:'',bg:''});
  else return;
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
window.boardsCellColor=function(name){
  const f=_boardsFocusedCell();
  if(!f||!_boardsCanEdit(_editBoard))return;
  if(f.card.locked)return showToast('Card is locked — unlock it to edit it');
  // Anything not in the palette falls back to no colour rather than being
  // passed through — the same rule the connector colours follow.
  const ok=(name&&name!=='none'&&_BOARDS_COLORS.indexOf(name)>-1)?name:'';
  _boardsPushUndo();
  _boardsCellWrite(f.card,f.r,f.i,{bg:ok});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
/* The cell's own right-click menu. A table cell is the one place this file
   takes the menu back from the browser while text is editable: everywhere
   else — a note body, a to-do item, any input — the browser's menu wins,
   because spellcheck and copy/paste belong to it while you are writing
   prose. A spreadsheet cell is not prose; row and column operations are
   what a right-click there is FOR, and the spec asks for them by name. */
function _boardsCellCtxItems(c,r,i){
  const items=[];
  items.push({act:'cell:copy',label:'Copy',hint:'Ctrl C'});
  items.push({act:'cell:cut',label:'Cut',hint:'Ctrl X'});
  items.push({act:'cell:paste',label:'Paste',hint:'Ctrl V'});
  items.push({sep:true});
  items.push({act:'cell:row-above',label:'Add row above',hint:'Alt ↑'});
  items.push({act:'cell:row-below',label:'Add row below',hint:'Alt ↓'});
  items.push({act:'cell:col-left',label:'Add column left',hint:'Alt ←'});
  items.push({act:'cell:col-right',label:'Add column right',hint:'Alt →'});
  items.push({sep:true});
  items.push({act:'cell:del-row',label:'Delete row '+(r+1),danger:true});
  items.push({act:'cell:del-col',label:'Delete column '+_boardsColName(i),danger:true});
  items.push({sep:true});
  items.push({act:'cell:align',label:'Change alignment'});
  items.push({act:'cell:type',label:'Cell type   ›'});
  items.push({act:'cell:formula',label:'Formula   ›'});
  items.push({sep:true});
  items.push({title:_boardsCellRef(r,i)+' · '+(c.name||'Table')});
  return items;
}
// Cut and Copy raise the REAL clipboard events by selecting the cell and
// firing execCommand, so the system clipboard stays the single source of
// truth — the rule the card menu already follows. Paste cannot: browsers
// refuse execCommand('paste') from script, so it goes through the async
// clipboard and says so plainly when that is refused.
function _boardsCellSelectAll(){
  const f=_boardsFocusedCell();
  if(!f)return null;
  const el=document.getElementById('board-td-'+f.card.id+'-'+f.r+'-'+f.i);
  if(!el)return null;
  window.boardsBeginEdit(null,el.id);
  try{
    const sel=window.getSelection(),rg=document.createRange();
    rg.selectNodeContents(el);sel.removeAllRanges();sel.addRange(rg);
  }catch(e){return null;}
  return el;
}
window.boardsCellClip=function(what){
  const f=_boardsFocusedCell();
  if(!f)return;
  if(what==='paste'){
    if(!(navigator.clipboard&&navigator.clipboard.readText))
      return showToast('Press Ctrl+V to paste into this cell');
    navigator.clipboard.readText().then(txt=>{
      const g=_boardsFocusedCell();
      if(!g||txt==null)return;
      _boardsPushUndo();
      _boardsCellWrite(g.card,g.r,g.i,{v:String(txt).replace(/[\r\n\t]+/g,' ')});
      _boardsRenderCanvasAndWire();
      _boardsSaveDebounced();
    }).catch(()=>showToast('Press Ctrl+V to paste into this cell'));
    return;
  }
  if(!_boardsCellSelectAll())return;
  let ok=false;
  try{ ok=document.execCommand(what==='cut'?'cut':'copy'); }catch(e){}
  if(!ok)return showToast(what==='cut'?'Press Ctrl+X to cut':'Press Ctrl+C to copy');
  if(what==='cut'){
    // execCommand('cut') empties the element; mirror that into the model,
    // which the oninput handler would otherwise be the only one to see.
    _boardsPushUndo();
    _boardsCellWrite(f.card,f.r,f.i,{v:''});
    _boardsSaveDebounced();
  }
};
/* The Cell type menu. Milanote shows four of the seven types with a "›"
   into a submenu; rather than teach the context menu to nest, picking one
   of those SETS the type and immediately opens its format menu. Two
   sequential menus, no nesting, and the second one is reachable again by
   re-opening Type — which is what the "›" promises anyway. */
const _BOARDS_TYPE_LABELS={auto:'Auto',number:'Number',currency:'Currency',
  percent:'Percentage',text:'Text',date:'Date & Time',check:'Checkbox'};
function _boardsCellTypeItems(cell){
  const cur=_boardsCellType(cell);
  return _BOARDS_CELL_TYPES.map(t=>({
    act:'celltype:'+t,
    label:(cur===t?'✓  ':'     ')+_BOARDS_TYPE_LABELS[t]
      +(['number','currency','percent','date'].indexOf(t)>-1?'   ›':'')
  }));
}
function _boardsCellFmtItems(t,cell){
  const f=_boardsCellFmt(cell);
  const dec=lbl=>[0,1,2].map(d=>({act:'cellfmt:d:'+d,
    label:(( f.d==null?0:f.d)===d?'✓  ':'     ')+lbl(d)}));
  if(t==='number')  return dec(d=>d===0?'1,234':d===1?'1,234.5':'1,234.57');
  if(t==='percent') return dec(d=>d===0?'12%':d===1?'12.5%':'12.50%');
  if(t==='currency')return _BOARDS_CURRENCIES.map(c=>({act:'cellfmt:c:'+c[0],
      label:((f.c||'Rs')===c[0]?'✓  ':'     ')+c[1]+'1,234'}))
      .concat([{sep:true}]).concat(dec(d=>d===0?'no decimals':d+' decimal'+(d>1?'s':'')));
  if(t==='date')    return [['d','15 Sep 2026'],['s','15/09/2026'],
      ['i','2026-09-15'],['t','15 Sep 2026, 14:30']].map(o=>({act:'cellfmt:f:'+o[0],
      label:((f.f||'d')===o[0]?'✓  ':'     ')+o[1]}));
  return [];
}
function _boardsCellMenuAt(items){
  // Anchored to the rail button when there is one, else to the focused
  // cell — a menu that opens in the corner of the screen reads as broken.
  const f=_boardsFocusedCell();
  let x=window.innerWidth/2,y=window.innerHeight/2;
  const btn=document.querySelector('#board-rail [data-act="cell:type"]');
  const td=f&&document.getElementById('board-td-'+f.card.id+'-'+f.r+'-'+f.i);
  const src=btn||td;
  if(src&&src.getBoundingClientRect){
    const r=src.getBoundingClientRect();
    x=r.right+6;y=r.top;
  }
  if(_boardsIsPhone()&&typeof _boardsOpenSheet==='function'){
    _boardsOpenSheet('Cell type',`<div class="board-sheet-list">${items.map(it=>
      it.sep?'<div class="board-sheet-sep"></div>'
        :`<button class="board-sheet-item" onclick="window.boardsSheetRun('${it.act}')">${_boardsEsc(it.label)}</button>`
    ).join('')}</div>`);
    return;
  }
  _boardsOpenCtx(x,y,items);
}
window.boardsCellTypeMenu=function(){
  const f=_boardsFocusedCell();
  if(!f||!_boardsCanEdit(_editBoard))return;
  _boardsCellMenuAt(_boardsCellTypeItems(f.cell));
};
window.boardsCellSetType=function(t){
  const f=_boardsFocusedCell();
  if(!f||!_boardsCanEdit(_editBoard))return;
  if(f.card.locked)return showToast('Card is locked — unlock it to edit it');
  if(_BOARDS_CELL_TYPES.indexOf(t)<0)return;
  _boardsPushUndo();
  // 'auto' is the ABSENCE of a type, so it clears rather than stores —
  // which is also what lets the cell downgrade back to a bare string.
  _boardsCellWrite(f.card,f.r,f.i,t==='auto'?{t:'',fmt:''}:{t:t});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  if(['number','currency','percent','date'].indexOf(t)>-1){
    const g=_boardsFocusedCell();
    if(g)_boardsCellMenuAt(_boardsCellFmtItems(t,g.cell));
  }
};
window.boardsCellSetFmt=function(key,val){
  const f=_boardsFocusedCell();
  if(!f||!_boardsCanEdit(_editBoard))return;
  if(f.card.locked)return;
  const fmt=Object.assign({},_boardsCellFmt(f.cell));
  if(key==='d')fmt.d=Math.max(0,Math.min(6,parseInt(val,10)||0));
  else if(key==='c'){ if(!_BOARDS_CURRENCIES.some(c=>c[0]===val))return; fmt.c=val; }
  else if(key==='f'){ if('dsit'.indexOf(val)<0||val.length!==1)return; fmt.f=val; }
  else return;
  _boardsPushUndo();
  _boardsCellWrite(f.card,f.r,f.i,{fmt:fmt});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
// A checkbox is the one cell type you operate with a single click, so it
// gets its own handler rather than going through focus-then-edit.
window.boardsCellToggle=function(id,r,i){
  const c=_boardsTableEditable(id);
  if(!c)return;
  const cell=_boardsCellAt(c,r,i);
  if(_boardsCellType(cell)!=='check')return;
  _boardsPushUndo();
  _boardsCellWrite(c,r,i,{v:_boardsCellVal(cell)?'':'1'});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
const _BOARDS_FX_HINTS={
  SUM:'Adds a range — SUM(B2:B4)',
  AVERAGE:'Mean of a range — AVERAGE(B2:B4)',
  MIN:'Smallest in a range — MIN(B2:B4)',
  MAX:'Largest in a range — MAX(B2:B4)',
  COUNT:'How many numbers — COUNT(B2:B4)',
  IF:'One condition — IF(B2>100,"over","ok")'
};
function _boardsCellFxItems(){
  return _BOARDS_FX_FNS.map(fn=>({act:'cellfx:'+fn,label:fn+'   '+_BOARDS_FX_HINTS[fn]}))
    .concat([{sep:true},{act:'cellfx:__help',label:'View formula help   ›'}]);
}
/* The "…" overflow. It reuses _boardsOpenCtx rather than growing a second
   popover: one renderer means the two cannot drift apart in look or in
   dismiss behaviour, which is the rule the rail and the old selection bar
   broke before they were merged. Anchored beside the button, which is what
   the browser study observed the real one doing. */
/* ── The add-image panel (spec §3) ─────────────────────────────────
   A POPOVER anchored to the button, not a rail swap. The spec says the
   media tools "swap the rail for a full context panel" with a back-arrow at
   the rail top; a browser study of the real product found the rail stays
   intact and the panel opens beside it, toggled by the same button. The
   back-arrow belongs to the SELECTION rail — the spec conflated the two.

   Two halves, per the spec's own build note: a search provider and local
   upload. They are NOT equally trustworthy here and the panel says so.

   Search goes through netlify/functions/image-search.js so the provider key
   stays in process.env — js/*.js is a public static asset, and a key pasted
   here would be a published key. With no key set the function answers
   {configured:false} and this panel shows upload only, because a red error
   for a feature nobody has switched on reads as a bug.

   UPLOAD LANDS ON THE CANVAS, never in an Unsorted holding area — the one
   thing the spec's build note explicitly asked us to do differently from
   Milanote. */
let _boardsImgPanelQ='';
let _boardsImgPanelState=null;   // null | 'loading' | {configured,photos,error}
// The keyword chips the spec describes as "auto-derived from the board".
// Derived, never stored: the board's own words, longest first, so a board
// about fleece suggests fleece. No network, no history, nothing to keep in
// step — the same discipline as the label library and frame membership.
const _BOARDS_IMG_STOPWORDS=('the a an and or of to in on for with is are was'+
  ' be by at from this that it as new untitled board note card').split(' ');
function _boardsImgKeywords(){
  const seen={};
  (_editCards||[]).forEach(c=>{
    _boardsCardText(c).split(/[^a-z0-9]+/).forEach(w=>{
      if(w.length<4||w.length>18)return;
      if(_BOARDS_IMG_STOPWORDS.indexOf(w)>-1)return;
      if(/^\d+$/.test(w))return;
      seen[w]=(seen[w]||0)+1;
    });
  });
  const title=String((_editBoard&&_editBoard.title)||'').toLowerCase()
    .split(/[^a-z0-9]+/).filter(w=>w.length>3&&_BOARDS_IMG_STOPWORDS.indexOf(w)<0);
  const words=Object.keys(seen).sort((a,b)=>seen[b]-seen[a]||b.length-a.length);
  const out=[];
  title.concat(words).forEach(w=>{if(out.length<6&&out.indexOf(w)<0)out.push(w);});
  return out;
}
window.boardsOpenImagePanel=function(){
  if(!_boardsCanEdit(_editBoard))return;
  _boardsImgPanelQ='';_boardsImgPanelState=null;
  _boardsOpenSheet('Add image',_boardsImgPanelHTML());
  _boardsImgPanelSearch('');
};
function _boardsImgPanelHTML(){
  const st=_boardsImgPanelState;
  const kw=_boardsImgKeywords();
  let grid='';
  if(st==='loading')grid='<div class="board-img-note">Searching…</div>';
  else if(st&&st.configured===false)
    grid='<div class="board-img-note">Image search is not switched on for this site yet.'
        +' Upload still works.<br><span class="board-img-dim">'+_boardsEsc(st.hint||'')+'</span></div>';
  else if(st&&st.error)
    grid='<div class="board-img-note">'+_boardsEsc(st.error)+' — try again, or upload instead.</div>';
  else if(st&&st.photos&&st.photos.length)
    grid='<div class="board-img-grid">'+st.photos.map((ph,i)=>
      `<button class="board-img-hit" onclick="window.boardsPickStockImage(${i})" title="${_boardsEsc(ph.alt||'')}">`
      +`<img src="${_boardsEsc(ph.thumb)}" alt="" loading="lazy" draggable="false">`
      +`<span class="board-img-credit">${_boardsEsc(ph.credit||'')}</span></button>`).join('')+'</div>';
  else if(st)grid='<div class="board-img-note">No pictures for that. Try another word.</div>';
  return`<div class="board-img-panel">
    <button class="btn-primary board-img-upload" onclick="window.boardsCloseSheet();window.boardsAddCard('image')">Upload your own</button>
    ${kw.length?`<div class="board-img-kw">${kw.map(w=>
      `<button class="board-img-chip" onclick="window.boardsImgSearchFor('${_boardsEsc(w)}')">${_boardsEsc(w)}</button>`
    ).join('')}</div>`:''}
    <input type="text" class="board-img-q" id="board-img-q" placeholder="Search images…"
      value="${_boardsEsc(_boardsImgPanelQ)}"
      oninput="window.boardsImgQInput(this.value)">
    ${grid}
  </div>`;
}
function _boardsImgPanelRepaint(){
  // .board-sheet-body is a CLASS, not an id — getElementById here fails
  // silently and the panel never repaints, which is exactly the kind of
  // dead-button bug this module keeps producing.
  const host=document.querySelector&&document.querySelector('.board-sheet-body');
  if(!host)return;
  host.innerHTML=_boardsImgPanelHTML();
  // Same refocus-after-rerender pattern every search box in this app uses.
  const q=document.getElementById('board-img-q');
  if(q&&q.focus){try{q.focus();if(q.setSelectionRange)q.setSelectionRange(9999,9999);}catch(e){}}
}
let _boardsImgQTimer=null;
window.boardsImgQInput=function(v){
  _boardsImgPanelQ=v;
  clearTimeout(_boardsImgQTimer);
  _boardsImgQTimer=setTimeout(()=>_boardsImgPanelSearch(v),300);
};
window.boardsImgSearchFor=function(w){
  _boardsImgPanelQ=w;
  _boardsImgPanelSearch(w);
};
async function _boardsImgPanelSearch(q){
  _boardsImgPanelState=String(q||'').trim()?'loading':null;
  _boardsImgPanelRepaint();
  if(!String(q||'').trim()){
    // An empty box still asks once, so "not configured" is said up front
    // rather than only after someone types and waits.
    try{
      const r=await fetch('/.netlify/functions/image-search?q=');
      const d=await r.json();
      if(d&&d.configured===false){_boardsImgPanelState=d;_boardsImgPanelRepaint();}
    }catch(e){}
    return;
  }
  try{
    const r=await fetch('/.netlify/functions/image-search?q='+encodeURIComponent(q));
    _boardsImgPanelState=await r.json();
  }catch(e){
    _boardsImgPanelState={configured:true,error:'Could not reach the search',photos:[]};
  }
  _boardsImgPanelRepaint();
}
/* Picking a stock photo UPLOADS IT, rather than storing the remote URL.

   A remote URL would make the card depend on a third party forever, and it
   would break the PNG/PDF export the first time that host does not send
   CORS headers — the exporter draws every image with crossOrigin and a
   tainted canvas refuses toBlob outright. Re-uploading makes a picked photo
   indistinguishable from one you chose off your own disk: same Cloudinary
   URL, same sized derivatives, same export behaviour.

   Cloudinary takes a remote URL as `file` on an unsigned upload, so this is
   one request and does not depend on the photo host allowing a cross-origin
   fetch. If it fails the card is NOT created and the failure is said out
   loud — a silently fragile card is worse than no card. */
window.boardsPickStockImage=async function(i){
  const st=_boardsImgPanelState;
  const ph=st&&st.photos&&st.photos[i];
  if(!ph||!_boardsCanEdit(_editBoard))return;
  window.boardsCloseSheet();
  showToast('Adding picture…');
  try{
    const fd=new FormData();
    fd.append('file',ph.full);
    fd.append('upload_preset','groovy-ops');
    const r=await fetch('https://api.cloudinary.com/v1_1/deww4lpym/auto/upload',{method:'POST',body:fd});
    const d=await r.json();
    if(!d.secure_url)throw new Error((d.error&&d.error.message)||'Upload failed');
    _boardsPushUndo();
    const card=_boardsNewCard('image');
    card.imageUrl=d.secure_url;
    _boardsFitImageCard(card,d);
    if(ph.credit)card.caption='Photo: '+ph.credit;
    _editCards.push(card);
    _boardsRenderCanvasAndWire();
    _boardsSaveNow();
  }catch(e){
    showToast('Could not add that picture: '+((e&&e.message)||'upload failed'),true);
  }
};
window.boardsMoreTools=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const btn=document.querySelector('#board-rail [data-act="more-tools"]');
  if(_boardsIsPhone()){
    // Everything the phone bar left off, not just the desktop overflow.
    const items=_boardsRailPhoneOverflow();
    _boardsOpenSheet('More tools',`<div class="board-sheet-list">${items.map(it=>
      `<button class="board-sheet-item" onclick="window.boardsSheetRun('${it.act}')">${_boardsEsc(it.label)}</button>`
    ).join('')}</div>`);
    return;
  }
  const items=_BOARDS_RAIL_OVERFLOW.map(it=>({act:it.act,label:it.label}));
  const r=btn&&btn.getBoundingClientRect?btn.getBoundingClientRect():null;
  _boardsOpenCtx(r?r.right+6:120,r?r.top:120,items);
};
window.boardsCellFormulaMenu=function(){
  const f=_boardsFocusedCell();
  if(!f||!_boardsCanEdit(_editBoard))return;
  _boardsCellMenuAt(_boardsCellFxItems());
};
window.boardsCellFormulaHelp=function(){
  _boardsOpenSheet('Formula help',`<div class="board-fx-help">
    <p>A formula is just the cell's value, starting with <code>=</code>. Type
       one by hand or pick a function from the rail.</p>
    <p><strong>References</strong> use the letters along the top and the
       numbers down the side: <code>B2</code> is one cell,
       <code>B2:B4</code> a range. They count every row, including a header
       row — so a column of figures under a label usually starts at row 2.</p>
    <p><strong>Functions</strong><br>
      ${_BOARDS_FX_FNS.map(fn=>'<code>'+fn+'</code> — '+_boardsEsc(_BOARDS_FX_HINTS[fn])).join('<br>')}</p>
    <p><strong>Arithmetic</strong> works too — <code>=B2*1.15</code>,
       <code>=(B2+B3)/2</code>. Text in a range is skipped rather than
       counted as zero, so a heading never spoils a total.</p>
    <p><strong>Errors</strong><br>
      <code>#REF!</code> a cell or range that is not there ·
      <code>#CYCLE!</code> a formula that depends on itself ·
      <code>#NAME?</code> an unknown function ·
      <code>#DIV/0!</code> dividing by nothing ·
      <code>#ERR!</code> the formula could not be read</p>
  </div>`);
};
window.boardsCellInsertFormula=function(fn){
  const f=_boardsFocusedCell();
  if(!f||!_boardsCanEdit(_editBoard))return;
  if(f.card.locked)return showToast('Card is locked — unlock it to edit it');
  _boardsPushUndo();
  _boardsCellWrite(f.card,f.r,f.i,{v:'='+fn+'()'});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  // Open the cell with the caret INSIDE the brackets — the range is the
  // one thing the picker cannot know, so that is where you should be.
  const id='board-td-'+f.card.id+'-'+f.r+'-'+f.i;
  window.boardsBeginEdit(null,id);
  try{
    const el=document.getElementById(id),sel=window.getSelection();
    if(el&&sel&&sel.rangeCount){
      const rg=sel.getRangeAt(0);
      const node=el.firstChild;
      if(node&&node.nodeType===3){
        const at=Math.max(0,node.textContent.length-1);
        rg.setStart(node,at);rg.setEnd(node,at);
        sel.removeAllRanges();sel.addRange(rg);
      }
    }
  }catch(e){}
};
window.boardsCellRowCol=function(what){
  const f=_boardsFocusedCell();
  if(!f)return;
  const id=f.card.id;
  if(what==='row-above')      window.boardsTableInsertRow(id,f.r);
  else if(what==='row-below') window.boardsTableInsertRow(id,f.r+1);
  else if(what==='col-left')  window.boardsTableInsertCol(id,f.i);
  else if(what==='col-right') window.boardsTableInsertCol(id,f.i+1);
  else if(what==='del-row')   window.boardsTableDeleteRow(id,f.r);
  else if(what==='del-col')   window.boardsTableDeleteCol(id,f.i);
};
window.boardsCellDone=function(){
  _boardsCellFocus=null;
  _boardsEndEdit();
  _boardsRenderCanvasAndWire();
};
function _boardsTableMinH(c){
  const rows=Array.isArray(c.rows)?c.rows:[];
  // Measured per ROW, not as a flat count: a cell set to the large text
  // size makes its whole row taller, and a flat 28 left the +Row/+Col
  // strip hanging outside the card. Found by smoke-layout the same day the
  // size attribute shipped — no logic suite could see it.
  // Every number here moved with the Sept 2026 card-text bump: a normal
  // cell is .board-card-body at 15px, a large one 18px, and the A/B/C band
  // is 13px. An estimate left behind puts the +Row/+Col strip back outside
  // the card, which is what it did the last two times.
  let body=0;
  if(!rows.length)body=32;
  else rows.forEach(row=>{
    const big=Array.isArray(row)&&row.some(cell=>_boardsCellAttr(cell,'sz')==='l');
    body+=big?42:32;
  });
  // card header + the A/B/C band + rows + the +Row/+Col strip
  return 28+22+body+28;
}
/* Row and column operations, positional.

   These are the ONE implementation: appending a row is inserting at the
   end and dropping one is deleting the last, so boardsTableAdd/Drop are
   thin wrappers rather than a second copy of the bounds checks.

   The focused cell MOVES with the edit. Insert a row above it and its row
   index shifts down by one; leave the index alone and the focus ring lands
   on the blank row that was just pushed under it, which reads as the caret
   jumping. _boardsFocusedCell re-derives and so can drop a stale focus,
   but it cannot know that a cell MOVED — only the operation knows that. */
function _boardsTableEditable(id){
  const c=_editCards.find(x=>x.id===id);
  if(!c||c.type!=='table'||!_boardsCanEdit(_editBoard))return null;
  if(c.locked){showToast('Card is locked — unlock it to edit it');return null;}
  if(!Array.isArray(c.rows)||!c.rows.length)c.rows=[['','']];
  return c;
}
function _boardsTableGrow(c,what){
  if(what==='row')c.h=Math.max(c.h,_boardsTableMinH(c));
  else c.w=Math.max(c.w,84+c.rows[0].length*100);  // + the row-number gutter
  if(_boardsColumnOf(c))_boardsLayoutColumns();
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
}
window.boardsTableInsertRow=function(id,at){
  const c=_boardsTableEditable(id);
  if(!c)return;
  const n=Math.max(0,Math.min(c.rows.length,at|0));
  _boardsPushUndo();
  c.rows.splice(n,0,c.rows[0].map(()=>''));
  if(_boardsCellFocus&&_boardsCellFocus.id===id&&_boardsCellFocus.r>=n)_boardsCellFocus.r++;
  _boardsTableGrow(c,'row');
};
window.boardsTableInsertCol=function(id,at){
  const c=_boardsTableEditable(id);
  if(!c)return;
  const n=Math.max(0,Math.min(c.rows[0].length,at|0));
  _boardsPushUndo();
  c.rows.forEach(row=>row.splice(n,0,''));
  if(_boardsCellFocus&&_boardsCellFocus.id===id&&_boardsCellFocus.i>=n)_boardsCellFocus.i++;
  _boardsTableGrow(c,'col');
};
window.boardsTableDeleteRow=function(id,at){
  const c=_boardsTableEditable(id);
  if(!c)return;
  const n=at|0;
  if(n<0||n>=c.rows.length)return;
  // A header table keeps its header plus one body row; a plain one keeps
  // one row. Same floor the old end-drop enforced.
  const minRows=c.head===false?1:2;
  if(c.rows.length<=minRows)return showToast('A table needs at least one row');
  _boardsPushUndo();
  c.rows.splice(n,1);
  if(_boardsCellFocus&&_boardsCellFocus.id===id){
    if(_boardsCellFocus.r>n)_boardsCellFocus.r--;
    else if(_boardsCellFocus.r===n)_boardsCellFocus=null;   // it is gone
  }
  _boardsTableGrow(c,'row');
};
window.boardsTableDeleteCol=function(id,at){
  const c=_boardsTableEditable(id);
  if(!c)return;
  const n=at|0;
  if(n<0||n>=c.rows[0].length)return;
  if(c.rows[0].length<=1)return showToast('A table needs at least one column');
  _boardsPushUndo();
  c.rows.forEach(row=>row.splice(n,1));
  if(_boardsCellFocus&&_boardsCellFocus.id===id){
    if(_boardsCellFocus.i>n)_boardsCellFocus.i--;
    else if(_boardsCellFocus.i===n)_boardsCellFocus=null;
  }
  _boardsTableGrow(c,'col');
};
window.boardsTableAdd=function(id,what){
  const c=_editCards.find(x=>x.id===id);
  if(!c||!Array.isArray(c.rows))return window.boardsTableInsertRow(id,0);
  if(what==='row')window.boardsTableInsertRow(id,c.rows.length);
  else window.boardsTableInsertCol(id,(c.rows[0]||[]).length);
};
window.boardsTableDrop=function(id,what){
  const c=_editCards.find(x=>x.id===id);
  if(!c||!Array.isArray(c.rows)||!c.rows.length)return;
  if(what==='row')window.boardsTableDeleteRow(id,c.rows.length-1);
  else window.boardsTableDeleteCol(id,(c.rows[0]||[]).length-1);
};
window.boardsTableHeader=function(id){
  const c=_editCards.find(x=>x.id===id);
  if(!c||!_boardsCanEdit(_editBoard))return;
  _boardsPushUndo();
  c.head=c.head===false?true:false;
  _boardsRenderCanvasAndWire();
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
  window.boardsBeginEdit(null,'board-todo-'+id+'-'+idx);
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
/* ── Background and Top strip (Sept 2026) ────────────────────────────────
   Milanote's colour panel has two tabs. `c.color` is what this card always
   had — the TOP STRIP: the header band and the border. `c.bg` is new — the
   BACKGROUND, the card body itself. Both are palette NAMES painted by a
   class (bg-red / tint-red), never a stored hex, for the reason the table's
   cell colours are: a name maps to a token that inverts with the theme,
   where a literal would be light-on-light in dark mode. That is also why
   there is no "Custom colour…" here, unlike a board's tile. */
/* ── Convert to Document (Sept 2026) ─────────────────────────────────────
   Milanote's ⋯ menu turns a note into a full document. Our document is a
   Creative Hub NOTES PAGE (js/notes.js — block pages, TEAM or PRIVATE), so
   converting writes one there from the note's text and turns the card into
   a LINK to it, in place, same size. The page's visibility follows the
   board's. Rich formatting is not carried (the page has its own blocks and
   this module's markup would need mapping block by block) — the toast says
   the text moved. Ctrl+Z restores the CARD; the page stays, and the toast
   says that too, because a document that silently vanished with an undo
   would be worse than one left behind. */
function _boardsDocFromNote(c){
  const text=String(c.text||'').replace(/\r/g,'');
  const lines=text.split('\n');
  const first=lines.find(l=>l.trim())||'';
  const title=(first.trim()||'Untitled').slice(0,80);
  const rest=lines.slice(lines.indexOf(first)+1).join('\n').split(/\n{2,}/).map(t=>t.trim()).filter(Boolean);
  const mk=t=>{
    const b=typeof _notesNewBlock==='function'?_notesNewBlock('paragraph'):{id:'b'+Date.now()+'_'+Math.floor(Math.random()*1e4),type:'paragraph',text:'',checked:false,imageUrl:''};
    b.text=t;return b;
  };
  const blocks=rest.length?rest.map(mk):[mk('')];
  return{title,blocks};
}
window.boardsConvertToDocument=async function(){
  if(!_editBoard||!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards();
  const c=sel.length===1&&sel[0].type==='text'?sel[0]:null;
  if(!c){showToast('Select one note to convert');return;}
  if(c.locked){showToast('Card is locked — unlock it to convert it');return;}
  const vis=_editBoard.visibility==='shared'?'shared':'personal';
  if(!confirm(`Turn this note into a Document page in Creative Hub (${vis==='shared'?'TEAM':'PRIVATE'})?\nThe note becomes a link to it. Ctrl+Z brings the note back; the page stays.`))return;
  const d=_boardsDocFromNote(c);
  let ref;
  try{
    ref=await _qAdd(collection(db,'notes_pages'),{
      title:d.title,icon:'📄',visibility:vis,
      ownerUid:session.uid,ownerName:session.name,ownerUsername:session.u,
      blocks:d.blocks,createdAt:Date.now(),updatedAt:Date.now(),updatedByName:session.name,
      fromBoardId:_editBoard.id
    });
  }catch(e){showToast('Could not create the document: '+(e.message||e),true);return;}
  if(typeof notesLoaded!=='undefined')notesLoaded=false;
  _boardsPushUndo();
  const live=_editCards.find(x=>x.id===c.id);
  if(!live){showToast('Document created — the note has gone meanwhile');return;}
  live.type='link';
  live.linkUrl=location.origin+location.pathname+'#note='+encodeURIComponent(ref.id);
  live.linkTitle=d.title;
  live.linkDesc='Document · Creative Hub';
  live.linkPreviewOff=true;
  delete live.text;delete live.rich;
  _boardsRenderCanvasAndWire();
  _boardsSaveNow();
  try{logActivity('Note converted to document',`${session.name} converted a note on "${_editBoard.title||'Untitled board'}" into the document "${d.title}"`);}catch(e){}
  showToast('Document created in Creative Hub — the note is a link to it now. Ctrl+Z restores the note; the page stays.');
};
window.boardsSetBg=function(color){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards();
  if(!sel.length)return;
  _boardsPushUndo();
  sel.forEach(c=>{if(color==='none')delete c.bg;else c.bg=color;});
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
// The Color tile in the rail shows the CARD'S CURRENT colour — Milanote's
// does — so the button is a readout, not a generic icon. The background
// wins over the strip when both are set (it is the bigger surface); a card
// with neither shows an empty outlined tile.
let _boardsColorTab='bg';
function _boardsColorTileClass(cards){
  const c=cards&&cards[0];
  if(!c)return'none';
  if(c.bg&&_BOARDS_COLORS.indexOf(c.bg)>0)return'bg-'+c.bg;
  if(c.color&&_BOARDS_COLORS.indexOf(c.color)>0)return'sw-'+c.color;
  return'none';
}
function _boardsColorPanelItems(){
  const sel=_boardsSelectedCards(),one=sel[0]||{};
  const tab=_boardsColorTab;
  return[
    {tabs:[{act:'colortab:bg',label:'Background',on:tab==='bg'},{act:'colortab:strip',label:'Top strip',on:tab==='strip'}]},
    tab==='bg'?{bgSwatches:true,current:one.bg||'none'}:{swatches:true,current:one.color||'none'},
    {note:'Palette colours follow light and dark mode.'}
  ];
}
// Anchored beside the rail's Color tile and LIVE: picking a colour or a tab
// repaints the panel in place rather than closing it, so trying three
// colours is not three round trips (the same reason the board's look sheet
// reopens after each choice).
window.boardsOpenColorPanel=function(){
  if(!_boardsCanEdit(_editBoard)||!_boardsSelectedCards().length)return;
  const btn=document.querySelector('.board-rail [data-act="color-panel"]');
  const r=btn&&btn.getBoundingClientRect?btn.getBoundingClientRect():{right:100,top:120};
  _boardsOpenCtx(r.right+8,r.top,_boardsColorPanelItems,null,{keep:true});
};

// ── Tidy actions ───────────────────────────────────────────────────────
// The roadmap listed "Columns (auto-stacking vertical lists)". A real
// column container needs stored membership and would have to reposition
// its children — which fights the deliberately membership-free frame
// model above. These arrange-once actions deliver the actual value (tidy
// alignment without hand-placing every card) with no new data model, and
// compose with frames: stack, then draw a labelled frame around the
// result. If a true container is wanted later it's a separate build.
// Milanote's "Group into Column". Until Sept 2026 this was an arrange-once
// action that only lined the cards up; it builds a real container now, so
// the group keeps its order, moves as one and accepts drops.
window.boardsStackSelection=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards().filter(c=>!c.locked&&c.type!=='frame'&&c.type!=='column');
  if(sel.length<2)return showToast('Select at least two cards');
  _boardsPushUndo();
  const ordered=sel.slice().sort((a,b)=>a.y-b.y);
  const col=_boardsNewCard('column');
  col.x=Math.min(...ordered.map(c=>c.x))-_BOARDS_COL_PAD;
  col.y=Math.min(...ordered.map(c=>c.y))-_BOARDS_COL_HEAD-_BOARDS_COL_PAD;
  col.w=Math.max(...ordered.map(c=>c.w))+_BOARDS_COL_PAD*2;
  // Ordered by y already, and layout re-derives order from y — so simply
  // stamping increasing y values here is the whole "insert in this order".
  ordered.forEach((c,i)=>{c.columnId=col.id;c.y=col.y+_BOARDS_COL_HEAD+i;});
  _editCards.push(col);
  _boardsLayoutColumn(col);
  _boardsSetSelection([col.id]);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  _boardsLogBoardActivity('grouped '+ordered.length+' cards into a column');
  const el=document.querySelector('#board-card-'+col.id+' .board-column-title');
  if(el)el.focus();
};
// Ungroup: the column goes, the cards stay exactly where they are.
window.boardsReleaseColumn=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const col=_boardsSelOne();
  if(!col||col.type!=='column')return;
  window.boardsDeleteCard(col.id);
};
// The destructive one, and the only place it is offered — separate from ✕
// and from Delete, both of which keep the cards.
window.boardsDeleteColumnAndCards=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const col=_boardsSelOne();
  if(!col||col.type!=='column')return;
  const kids=_boardsColumnChildren(col).filter(k=>!k.locked);
  const locked=_boardsColumnChildren(col).length-kids.length;
  if(!confirm('Delete this column AND '+kids.length+' card'+(kids.length===1?'':'s')+' inside it? Ctrl+Z undoes it.'))return;
  _boardsPushUndo();
  const ids=new Set(kids.map(k=>k.id));ids.add(col.id);
  _boardsColumnChildren(col).forEach(k=>{if(!ids.has(k.id))_boardsLeaveColumn(k);});
  _boardsTrashPut(_editCards.filter(c=>ids.has(c.id)),_boardsConnsTouching(ids));
  _editCards=_editCards.filter(c=>!ids.has(c.id));
  _editConnectors=_editConnectors.filter(cn=>!ids.has(cn.from)&&!ids.has(cn.to));
  ids.forEach(id=>_boardsSelection.delete(id));
  _boardsLayoutColumns();
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  if(locked)showToast('Kept '+locked+' locked card'+(locked===1?'':'s'));
  _boardsLogBoardActivity('deleted a column and '+kids.length+' cards');
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
/* ── Link previews (Sept 2026) ──────────────────────────────────────────
   Afnan, side by side with Milanote: a URL pasted there lands as a picture
   with a title and a description; ours landed as three empty form fields.

   THIS IS THE FOLLOW-UP CLAUDE.md HAS FLAGGED SINCE PHASE 2, and the note
   there is the reason it took a server function rather than an afternoon:
   the browser cannot read another origin's HTML for og:image/og:title —
   that is precisely what CORS forbids — so the fetch has to happen
   server-side, and a server that fetches a URL someone typed is an SSRF
   hole until every hop is validated. All of that lives in
   netlify/functions/link-preview.js; read its header before touching it.

   THE PICTURE IS RE-UPLOADED TO CLOUDINARY, never linked hot. Same call
   the stock-photo picker makes, for the same three reasons: a remote URL
   makes the card depend on a stranger's host forever, it breaks the
   PNG/PDF export the first time that host sends no CORS header (the
   exporter draws with crossOrigin and a tainted canvas refuses toBlob
   outright), and it would miss the sized derivatives every other image
   card gets. A preview whose picture fails to mirror still lands — the
   title and description are most of the value — but it lands without one
   rather than with a fragile one.

   NOTHING HERE IS ON THE CRITICAL PATH. The card is created and rendered
   immediately with the bare URL; the preview arrives later and re-renders.
   A site that refuses, times out or has no og: tags leaves exactly the card
   we had before this shipped. */
const _BOARDS_LINK_W=170,_BOARDS_LINK_H=120;              // the birth size
const _BOARDS_LINK_PREVIEW_W=250,_BOARDS_LINK_PREVIEW_H=280,_BOARDS_LINK_TEXT_H=150;
// Only a card still at its birth size is resized, so a link somebody has
// already sized by hand is left alone — the guard the image and PDF fits use.
function _boardsLinkCardUnsized(c){
  return !!c&&c.type==='link'&&c.w===_BOARDS_LINK_W&&c.h===_BOARDS_LINK_H;
}
/**
 * The URL as an href, or '' — and an `<a>` is emitted WITHOUT an href when
 * this returns empty, which renders as plain text rather than a live link.
 * `_boardsEsc` escapes quotes but would happily pass `javascript:alert(1)`
 * straight into the attribute, and this string came off a clipboard.
 */
function _boardsSafeHref(u){
  const raw=String(u||'').trim();
  if(!/^https?:\/\//i.test(raw))return'';
  return raw;
}
function _boardsLinkHost(u){
  try{return new URL(String(u||'')).hostname.replace(/^www\./,'');}catch(e){return'';}
}
/**
 * What a fetched preview changes on a card. PURE, and separate from the
 * fetch on purpose: the two decisions worth getting right — never clobber a
 * title somebody typed, only resize a card still at its birth size — are
 * then assertable without a network.
 */
function _boardsApplyLinkMeta(c,meta,imageUrl){
  if(!c||c.type!=='link'||!meta)return false;
  const host=_boardsLinkHost(c.linkUrl);
  const typed=String(c.linkTitle||'').trim();
  // The paste path seeds the title with the HOST as a placeholder, so a
  // title still equal to that is ours to replace. Anything else is someone's
  // own words and outranks whatever the page calls itself.
  if(meta.title&&(!typed||typed===host||typed===meta.host))c.linkTitle=meta.title;
  if(meta.description&&!String(c.linkDesc||'').trim())c.linkDesc=meta.description;
  if(meta.siteName)c.linkSite=meta.siteName;
  if(imageUrl)c.linkImage=imageUrl;
  if(_boardsLinkCardUnsized(c)){
    c.w=_BOARDS_LINK_PREVIEW_W;
    c.h=imageUrl?_BOARDS_LINK_PREVIEW_H:_BOARDS_LINK_TEXT_H;
  }
  return true;
}
async function _boardsLinkMeta(url){
  if(typeof auth==='undefined'||!auth||!auth.currentUser)return null;
  const idToken=await auth.currentUser.getIdToken();
  const r=await fetch('/.netlify/functions/link-preview',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({idToken,url})});
  const d=await r.json();
  return d&&d.ok?d:null;
}
// Mirrors a preview picture into Cloudinary and hands back our own URL, or
// '' — never throws, because a card without a picture beats no card.
async function _boardsMirrorPreviewImage(src){
  if(!src)return'';
  try{const up=await _boardsUploadAny(src);return up.secure_url||'';}
  catch(e){console.warn('[boards] preview image could not be mirrored:',e&&(e.message||e));return'';}
}
/**
 * Fills in a link card in the background. `_fetching` and `_linkNoPreview`
 * are `_`-prefixed, so _boardsCardsForSave strips them: a save that fires
 * mid-fetch cannot persist "Loading preview…" the way `_uploading` once
 * persisted "Uploading…".
 */
function _boardsLinkHydrate(cardId){
  const start=_editCards.find(x=>x.id===cardId);
  if(!start||start.type!=='link'||!start.linkUrl)return;
  const boardId=_editBoard&&_editBoard.id,url=start.linkUrl;
  start._fetching=true;
  delete start._linkNoPreview;
  _boardsRenderSoon();
  (async()=>{
    let meta=null;
    try{meta=await _boardsLinkMeta(url);}catch(e){meta=null;}
    const img=meta?await _boardsMirrorPreviewImage(meta.image):'';
    // The board may have been left, or the card deleted or re-pointed at a
    // different URL, while that was in flight — the same guard _boardsSaveNow
    // keeps on savingId, and for the same reason.
    if(!_editBoard||_editBoard.id!==boardId)return;
    const c=_editCards.find(x=>x.id===cardId);
    if(!c)return;
    delete c._fetching;
    if(c.linkUrl!==url){_boardsRenderSoon();return;}
    if(meta)_boardsApplyLinkMeta(c,meta,img);
    else c._linkNoPreview=true;
    _boardsRenderCanvasAndWire();
    if(meta)_boardsSaveDebounced();
  })();
}
// The tray's version of the same thing. It is a separate few lines rather
// than a shared one because a tray item is a different shape — the
// description lives in `text`, there is no card to resize — and folding the
// two together would mean a parameter that says which kind you meant.
function _boardsTrayLinkHydrate(itemId){
  const start=_editUnsorted.find(u=>u.id===itemId);
  if(!start||start.kind!=='link'||!start.linkUrl)return;
  const boardId=_editBoard&&_editBoard.id,url=start.linkUrl;
  start._fetching=true;
  _boardsRenderSoon();
  (async()=>{
    let meta=null;
    try{meta=await _boardsLinkMeta(url);}catch(e){meta=null;}
    const img=meta?await _boardsMirrorPreviewImage(meta.image):'';
    if(!_editBoard||_editBoard.id!==boardId)return;
    const u=_editUnsorted.find(x=>x.id===itemId);
    if(!u)return;
    delete u._fetching;
    if(meta){
      if(meta.title)u.linkTitle=meta.title;
      if(meta.description&&!String(u.text||'').trim())u.text=meta.description;
      if(meta.siteName)u.linkSite=meta.siteName;
      if(img)u.linkImage=img;
    }
    _boardsRenderCanvasAndWire();
    if(meta)_boardsSaveDebounced();
  })();
}
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
// A PDF card is sized to its first page. At the 200×110 file default the
// name row and the Open/Download buttons took ~90px, leaving the page
// thumbnail a ~20px strip — every attached brief had to be dragged open by
// hand before anyone could see what it was.
const _BOARDS_PDF_CARD_W=240;
const _BOARDS_FILE_CHROME_H=92;   // header, name row and buttons, plus the 2px border — measured in Chrome
function _boardsIsPdfFile(file){
  return!!file&&(file.type==='application/pdf'||/\.pdf$/i.test(file.name||''));
}
// ratio = page height / width. With none (or nonsense) assume A4 portrait,
// which is what these briefs and tech packs almost always are.
function _boardsPdfCardH(ratio){
  const r=ratio>0&&isFinite(ratio)?Math.min(Math.max(ratio,0.25),4):Math.SQRT2;
  return Math.round((_BOARDS_PDF_CARD_W-2)*r)+_BOARDS_FILE_CHROME_H;
}
// Only a card nobody has sized is refitted: the plain file default, or the
// page-shaped placeholder _boardsAddFiles gives a PDF while it uploads. A
// card someone resized keeps the size they chose, even across a Replace.
function _boardsFileCardUnsized(c){
  return(c.w===_BOARDS_FILE_W&&c.h===_BOARDS_FILE_H)
    ||(c.w===_BOARDS_PDF_CARD_W&&c.h===_boardsPdfCardH());
}
function _boardsFitPdfCard(c,res){
  if(!_boardsFileCardUnsized(c))return;
  // Cloudinary only rasterises a PDF stored as an IMAGE resource. One stored
  // raw has no thumbnail, and a page-sized card around nothing is worse than
  // the compact card, so it goes back to that.
  if(_boardsPdfThumbUrl(c.fileUrl)&&c.fileUrl.indexOf('/image/upload/')>-1){
    const pw=res&&+res.width,ph=res&&+res.height;
    c.w=_BOARDS_PDF_CARD_W;
    c.h=_boardsPdfCardH(pw>0&&ph>0?ph/pw:0);
  }else{
    c.w=_BOARDS_FILE_W;
    c.h=_BOARDS_FILE_H;
  }
}

/* An image card is sized to its PICTURE, exactly as a file card is sized to
   its page. Afnan pasted one photo into Milanote and into this board: theirs
   kept the garment whole, ours cut the top and bottom off.

   The cause was not image size or Cloudinary. Card images are drawn with
   `object-fit:cover`, which CROPS to fill the box — and an image card was
   born 170x120 and never resized, while the file/PDF branch three lines
   away always called _boardsFitPdfCard. So a portrait photo showed only the
   middle 170x120 slice of itself. Verified from the code, not guessed: the
   `image` branch of _boardsUploadFileToCard simply had no fit call.

   `cover` is kept rather than swapped for `contain`: once the card matches
   the picture's ratio, cover crops nothing, and contain would letterbox
   every card that anyone later resizes by hand.

   A very tall picture is bounded by _BOARDS_IMG_MAX_H, and the WIDTH comes
   down with it so the ratio still holds — clamping height alone would crop
   the thing this function exists to stop cropping. */
// The floor is deliberately LOW. It exists to stop a degenerate card, not
// to shape one: set it high and it fights the ratio it is standing next to
// — a 10:1 sliver would be widened back out and cropped again, which is the
// bug this whole function exists to remove. At 40 the ratio survives
// anything up to a 13:1 picture.
const _BOARDS_IMG_CARD_W=240,_BOARDS_IMG_MAX_H=520,_BOARDS_IMG_MIN=40;
function _boardsImageCardUnsized(c){
  return !!c&&c.type==='image'&&c.w===_BOARDS_IMG_W&&c.h===_BOARDS_IMG_H;
}
function _boardsFitImageCard(c,res){
  if(!_boardsImageCardUnsized(c))return;
  const iw=res&&+res.width,ih=res&&+res.height;
  if(!(iw>0&&ih>0))return;          // no dimensions back — leave the default
  let w=_BOARDS_IMG_CARD_W,h=Math.round(w*ih/iw);
  if(h>_BOARDS_IMG_MAX_H){h=_BOARDS_IMG_MAX_H;w=Math.round(h*iw/ih);}
  c.w=Math.max(_BOARDS_IMG_MIN,w);
  c.h=Math.max(_BOARDS_IMG_MIN,h);
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
  // The size as the upload started. If it differs when the upload lands,
  // someone resized the card meanwhile and the fit leaves it alone.
  const w0=c.w,h0=c.h;
  _boardsRenderSoon();
  try{
    const res=await _boardsUploadAny(file);
    const card=_editCards.find(x=>x.id===cardId);
    if(!card)return;   // card was deleted or undone while the upload ran
    if(card.type==='image'){
      card.imageUrl=res.secure_url;
      // Same guard the file branch uses: if the card changed size while the
      // upload was in flight, somebody sized it by hand and it is left alone.
      if(card.w===w0&&card.h===h0)_boardsFitImageCard(card,res);
    }else{
      card.type='file';
      card.fileUrl=res.secure_url;
      card.fileName=file.name||(res.original_filename||'file');
      card.fileSize=res.bytes||file.size||0;
      if(card.w===w0&&card.h===h0)_boardsFitPdfCard(card,res);
    }
    delete card._uploading;
    _boardsRenderSoon();
    _boardsSaveDebounced();
  }catch(e){
    const card=_editCards.find(x=>x.id===cardId);
    if(card)delete card._uploading;
    // A PDF placeholder that never got its file shrinks back to the empty
    // file card rather than a page-sized "Click to choose a file".
    if(card&&card.type==='file'&&!card.fileUrl&&card.w===w0&&card.h===h0&&_boardsFileCardUnsized(card)){
      card.w=_BOARDS_FILE_W;card.h=_BOARDS_FILE_H;
    }
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
  const made=files.map(f=>{
    const c=_boardsNewCard(_boardsIsImageFile(f)?'image':'file');
    // A PDF starts at A4 page size, so the grid below leaves room for it and
    // the card doesn't jump when the upload lands; _boardsFitPdfCard then
    // corrects the height to the real page.
    if(c.type==='file'&&_boardsIsPdfFile(f)){c.w=_BOARDS_PDF_CARD_W;c.h=_boardsPdfCardH();}
    c._uploading=true;
    return{card:c,file:f};
  });
  // One cell size for the whole drop, or a PDF beside a small card overlaps
  // the next row.
  const cellW=Math.max(...made.map(m=>m.card.w)),cellH=Math.max(...made.map(m=>m.card.h));
  made.forEach(({card},i)=>{
    card.x=at.x+(i%perRow)*(cellW+16);
    card.y=at.y+Math.floor(i/perRow)*(cellH+16);
    _editCards.push(card);
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
/* ── Paste always collects (Sept 2026) — REVERSES the Stage-1 rule ──────
   Afnan: "make paste always collect into unsorted". Ctrl+V now goes to the
   Unsorted panel whether or not it is open, the way Milanote's does.

   THE RULE THIS REVERSES EXISTED FOR A REASON AND THE REASON IS ANSWERED,
   NOT DROPPED. Paste used to collect only while the tray was OPEN, because
   an open tray is a visible statement that you are collecting — with it
   shut, a paste that vanished into a panel nobody could see would be
   indistinguishable from a paste that did nothing. So collecting now OPENS
   the panel (_boardsCollectInto), on its Unsorted tab, and the item is on
   screen the moment it lands. Placing directly is still one gesture away:
   right-click where you want it → Paste, which is the one paste that
   carries a location.

   THE REORDERING IS THE LOAD-BEARING PART. The tray branch used to run
   FIRST, above the copied-cards and copied-lines cases — so with the tray
   open, Ctrl+V of cards copied from a board made a NOTE holding the raw
   tagged JSON. That quietly broke the Stage 2 rule ("the paste handler
   checks the prefix before its URL/plain-text cases") the day the tray
   shipped, and making every paste collect would have made it happen to
   everyone, every time. Cards and lines are card operations; they are read
   before anything is collected, and they never become text.

   Two things still outrank the tray, both because they name a target:
   an IMAGE with a single empty image card selected fills that card, and an
   image beats an editing caret outright (pasting one into a contenteditable
   does nothing useful) — the Stage 1 rule, unchanged. */
function _boardsClipImage(e){
  const items=(e.clipboardData&&e.clipboardData.items)||[];
  for(const item of items){
    if(item.type&&item.type.indexOf('image')===0){
      const f=item.getAsFile();
      if(f)return f;
    }
  }
  return null;
}
// Cards and lines copied from a board — possibly a different one, or
// another tab. Returns true when the clipboard was OURS, including when the
// payload turned out to be unreadable: falling through would collect our own
// tagged JSON as somebody's note.
function _boardsPasteClipCards(e,text){
  if(text.indexOf(_BOARDS_CLIP_LINE_PREFIX)===0){
    e.preventDefault();
    let lines=null;
    try{lines=JSON.parse(text.slice(_BOARDS_CLIP_LINE_PREFIX.length));}catch(err){lines=null;}
    if(Array.isArray(lines)&&lines.length)_boardsPasteLines(lines);
    return true;
  }
  if(text.indexOf(_BOARDS_CLIP_PREFIX)===0){
    e.preventDefault();
    let payload=null;
    try{payload=JSON.parse(text.slice(_BOARDS_CLIP_PREFIX.length));}catch(err){payload=null;}
    if(Array.isArray(payload)&&payload.length)_boardsPasteCards(payload);
    return true;
  }
  // Nothing usable on the system clipboard, but this session copied cards
  // earlier (the setData call can be refused in some browsers) — fall back.
  if(!text){
    if(_boardsClipboard.length){e.preventDefault();_boardsPasteCards(_boardsClipboard);return true;}
    if(_boardsLineClipboard.length){e.preventDefault();_boardsPasteLines(_boardsLineClipboard);return true;}
  }
  return false;
}
function _boardsOnPaste(e){
  if(currentPage!=='board-canvas'||!_editBoard||!_boardsCanEdit(_editBoard))return;
  const editing=_boardsIsEditableFocus();
  const imageFile=_boardsClipImage(e);
  const text=((e.clipboardData&&e.clipboardData.getData('text/plain'))||'').trim();

  if(imageFile){
    e.preventDefault();
    const sel=_boardsSelectedCards();
    const target=(sel.length===1&&sel[0].type==='image'&&!sel[0].imageUrl)?sel[0]:null;
    if(target){_boardsPushUndo();_boardsUploadFileToCard(target.id,imageFile);return;}
    // Home has no Unsorted to collect into, so it places — what a paste did
    // before the tray existed. Everywhere else, unchanged.
    if(_boardsIsHome(_editBoard)){_boardsAddFiles([imageFile],_boardsPlacementPoint());return;}
    _boardsCollectInto();
    _boardsTrayAddFiles([imageFile]);
    showToast('Added to Unsorted');
    return;
  }
  // Everything below is text, and text pasted into a card being edited
  // belongs to that card.
  if(editing)return;
  if(_boardsPasteClipCards(e,text))return;
  if(!text)return;
  e.preventDefault();
  if(_boardsIsHome(_editBoard)){_boardsPlaceText(text);return;}
  _boardsCollectInto();
  _boardsTrayAddText(text);
}
document.addEventListener('paste',_boardsOnPaste);
window.boardsAddCard=function(type){
  const b=_editBoard;if(!b)return;
  // A 'board' card is a LINK to a child board, so it is meaningless without
  // one. Adding it from the rail minted a card with no boardId, which
  // renders "Missing board" and can never be opened — an orphan by
  // construction. The real creator already existed on the ⋯ menu; the rail
  // just wasn't calling it.
  if(type==='board'){window.boardsAddChildBoard();return;}
  _boardsPushUndo();
  const nc=_boardsNewCard(type);
  const p=_boardsPlacementPoint();
  nc.x=p.x;nc.y=p.y;
  _editCards.push(nc);
  if(type==='column')_boardsLayoutColumn(nc);
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
  if(idx>-1)moodBoards[idx]={...moodBoards[idx],cards:_boardsDecodeCards(_boardsCardsForSave())};
}
window.boardsDeleteCard=function(id){
  const c=_editCards.find(x=>x.id===id);
  if(c&&c.locked){showToast('That card is locked');return;}
  // On Home, deleting a board card TAKES IT OFF HOME and leaves the board
  // alone — Afnan's third answer, and the whole point of the Boards panel:
  // the row is still there, it just stops saying On Home.
  //
  // This reverses the earlier behaviour, where Home asked to trash the
  // whole BOARD. That was right at the time and is wrong now: it was only
  // ever there because auto-place put the card straight back on the next
  // visit, so "remove from Home" was an action that undid itself. Trashing
  // the board is still one click away — "Move board to Trash" on the
  // card's right-click menu — it just isn't what ✕ means any more.
  // Deleting a container must never destroy content. The cards are
  // RELEASED where they currently sit; "Delete column and its cards" is a
  // separate, confirmed action for when you really mean both.
  let released=0;
  if(c&&c.type==='column'){
    released=_boardsColumnChildren(c).length;
    _boardsColumnChildren(c).forEach(_boardsLeaveColumn);
  }
  _boardsPushUndo();
  // Captured before the filter below — afterwards there is nothing left to
  // record, and a restore without its lines returns a different card from
  // the one that went.
  _boardsTrashPut([c],_boardsConnsTouching([id]));
  _editCards=_editCards.filter(x=>x.id!==id);
  _editConnectors=_editConnectors.filter(cn=>cn.from!==id&&cn.to!==id);
  _boardsSelection.delete(id);
  _boardsLayoutColumns();
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  if(released)showToast('Column removed — '+released+' card'+(released===1?'':'s')+' kept on the board');
  else if(c&&c.type==='board'){
    _boardsSyncLocalCards();
    showToast(_boardsIsHome(_editBoard)
      ?'Taken off Home — it is still in the Boards panel'
      :'Link removed — the sub-board itself is back in the boards list');
  }
  else _boardsUndoableToast(_boardsCardNoun(c)+' deleted');
  _boardsLogBoardActivity('deleted a card');
};

/* ── Delete says where the card went ────────────────────────────────
   M8 shipped this toast INSTEAD of a trash, on the reading that Ctrl+Z was
   enough and only needed to be discoverable. Afnan then sent Milanote's
   own trash panel and asked for both, which is the right call: undo and a
   trash answer different questions. Ctrl+Z is "that was a mistake, just
   now"; the trash is "where did that card go last Tuesday", and one
   keystroke of history cannot answer the second. See the Trash section for
   how the two are kept from disagreeing.

   So the toast now names both routes back. Still deliberately a toast and
   not a confirm: a confirm on every delete is the thing that makes people
   stop reading confirms, and then the one that matters is clicked through
   too. */
function _boardsCardNoun(c){
  if(!c)return'Card';
  const t=c.type;
  return t==='text'?'Note':t==='todo'?'To-do':t==='board'?'Board link'
    :t==='frame'?'Frame':t==='column'?'Column':t==='table'?'Table'
    :t==='heading'?'Heading':t==='image'?'Image':t==='file'?'File'
    :t==='link'?'Link':'Card';
}
function _boardsUndoableToast(what){
  showToast(what+' — Ctrl+Z to undo, or find it in Trash');
}
// ── Bulk actions on the selection ──────────────────────────────────────
window.boardsDeleteSelection=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const sel=_boardsSelectedCards();
  const removable=sel.filter(c=>!c.locked);
  if(!removable.length){showToast(sel.length?'Those cards are locked':'Nothing selected');return;}
  _boardsPushUndo();
  const ids=new Set(removable.map(c=>c.id));
  // Same rule as the single delete: a column goes, its cards stay. A child
  // being deleted alongside its column is already in `ids`, so releasing
  // first costs nothing.
  let released=0;
  removable.filter(c=>c.type==='column').forEach(col=>{
    _boardsColumnChildren(col).forEach(k=>{if(!ids.has(k.id)){_boardsLeaveColumn(k);released++;}});
  });
  _boardsTrashPut(removable,_boardsConnsTouching(ids));
  _editCards=_editCards.filter(c=>!ids.has(c.id));
  _editConnectors=_editConnectors.filter(cn=>!ids.has(cn.from)&&!ids.has(cn.to));
  ids.forEach(id=>_boardsSelection.delete(id));
  _boardsLayoutColumns();
  _boardsRenderCanvasAndWire();
  if(released)showToast(released+' card'+(released===1?'':'s')+' kept on the board');
  _boardsSaveDebounced();
  if(removable.some(c=>c.type==='board')){
    _boardsSyncLocalCards();
    showToast(_boardsIsHome(_editBoard)
      ?'Taken off Home — they are still in the Boards panel'
      :'Sub-board links removed — those boards are back in the boards list');
  }
  else if(!released)_boardsUndoableToast(removable.length+' card'+(removable.length===1?'':'s')+' deleted');
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
  // A selected LINE copies instead. The two selections are mutually
  // exclusive (see _boardsSelectConn), so there is never a question of which.
  if(!sel.length&&_boardsConnSel!==null){
    const cn=_boardsConnById(_boardsConnSel);
    if(!cn)return;
    const one=JSON.parse(JSON.stringify(cn));
    delete one.id;
    _boardsLineClipboard=[one];
    try{
      e.clipboardData.setData('text/plain',_BOARDS_CLIP_LINE_PREFIX+JSON.stringify([one]));
      e.preventDefault();
    }catch(err){/* the in-memory copy still works this session */}
    if(cut)window.boardsDeleteConnector(cn.id);
    else showToast('Line copied');
    return;
  }
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
let _boardsLineClipboard=[];
// Pasted lines land as FREEFORM, offset from where they were. A card-bound
// one cannot be pasted as-is — the cards it names may not exist on this
// board, or in this account — so it is flattened to the shape it was drawn
// in, keeping its curve, weight, dash, arrowheads and label.
function _boardsPasteLines(lines){
  if(!_boardsCanEdit(_editBoard)||!lines||!lines.length)return false;
  _boardsPushUndo();
  let last=null;
  lines.forEach(src=>{
    const cn=JSON.parse(JSON.stringify(src));
    cn.id='k'+(++_boardsCardSeq)+'_'+Date.now()+'_'+Math.floor(Math.random()*1e4);
    delete cn.locked;
    if(!cn.free){
      const g=_boardsConnGeom(src);
      const p1=g?g.p1:{x:80,y:80},p2=g?g.p2:{x:260,y:200};
      cn.free=true;delete cn.from;delete cn.to;
      cn.x1=p1.x;cn.y1=p1.y;cn.x2=p2.x;cn.y2=p2.y;
    }
    cn.x1+=24;cn.y1+=24;cn.x2+=24;cn.y2+=24;
    _editConnectors.push(cn);
    last=cn.id;
  });
  if(last)_boardsConnSel=last;
  _boardsDrawConnectors();
  _boardsRenderRail();
  _boardsSaveDebounced();
  showToast(lines.length===1?'Line pasted':lines.length+' lines pasted');
  return true;
}
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
  if(_boardsIsHome(_editBoard)){showToast('Home cannot be deleted');return;}
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
// Syncs BOTH topbar dropdowns. There are eight `_boardsMenuOpen=false;
// _boardsSyncMenu()` call sites that close the menu after an action; making
// this one function drive both means every one of them closes View as well,
// with no new call site to remember.
function _boardsSyncMenu(){
  const el=document.getElementById('board-menu');
  if(el)el.style.display=_boardsMenuOpen?'flex':'none';
  const vw=document.getElementById('board-view-menu');
  if(vw)vw.style.display=_boardsViewOpen?'flex':'none';
  const vb=document.getElementById('board-view-btn');
  if(vb)vb.classList.toggle('on',_boardsViewOpen);
}
// Opening one closes the other — two dropdowns open at once in the same
// corner is the kind of mess this bar was regrouped to remove.
window.boardsToggleMenu=function(ev){
  if(ev)ev.stopPropagation();
  _boardsMenuOpen=!_boardsMenuOpen;
  if(_boardsMenuOpen)_boardsViewOpen=false;
  _boardsSyncMenu();
};
window.boardsToggleViewMenu=function(ev){
  if(ev)ev.stopPropagation();
  _boardsViewOpen=!_boardsViewOpen;
  if(_boardsViewOpen)_boardsMenuOpen=false;
  _boardsSyncMenu();
};
// Registered once at load, like the paste/keydown handlers — the canvas
// DOM is replaced on every render, so a listener added there would pile up.
document.addEventListener('click',e=>{
  const el=document.getElementById('board-menu');
  const vw=document.getElementById('board-view-menu');
  if(!el&&!vw)return;
  // Each menu lives in its OWN .board-menu-wrap, so a click inside one wrap
  // must still close the other — `closest('.board-menu-wrap')` alone would
  // leave View open while you used the ⋯ menu.
  const wrap=e.target&&e.target.closest&&e.target.closest('.board-menu-wrap');
  if(wrap){
    if(!wrap.contains(el)&&_boardsMenuOpen){_boardsMenuOpen=false;_boardsSyncMenu();}
    if(vw&&!wrap.contains(vw)&&_boardsViewOpen){_boardsViewOpen=false;_boardsSyncMenu();}
    return;
  }
  if(vw&&(_boardsViewOpen||vw.style.display!=='none')){_boardsViewOpen=false;_boardsSyncMenu();}
  if(!el)return;
  // Read the DOM, not just the flag. Reported as the menu "re-opening
  // unexpectedly": any action that clears `_boardsMenuOpen` without also
  // calling _boardsSyncMenu() (or re-rendering) leaves the menu visible
  // while the flag says closed — and this closer's old `if(!flag)return`
  // then refused to close it, so it sat there until the next render. I
  // could not pin down which action did it, so the closer no longer
  // depends on the two staying in step.
  if(!_boardsMenuOpen&&el.style.display==='none')return;
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
    const cls='mm-card'+(c.type==='frame'||c.type==='column'?' mm-frame':'')+(c.type==='image'?' mm-image':'');
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
/* FIRESTORE DOES NOT SUPPORT NESTED ARRAYS, and a table's rows are one.
   `{rows:[['a','b'],['c','d']]}` is refused outright with "Nested arrays
   are not supported", so every board carrying a table failed to save from
   the day the table card shipped — reported as a repeating
   "Save failed — will retry". Nothing about it was specific to cell types;
   it has been there the whole time and only surfaced when tables started
   being used in anger.

   The wire form wraps each row in an object: [{c:['a','b']},{c:['c','d']}].
   An array of OBJECTS each holding an array is legal. In memory rows stay
   the plain nested array every helper in this file reads, so the encoding
   lives at exactly two boundaries — here on the way out, and
   _boardsDecodeCards wherever a document's cards come back in.

   Both directions are IDEMPOTENT and total, so a card that has been
   through either twice is unchanged, and a board written by an older
   build (plain nested rows, never actually persisted) still reads. An
   older build reading the new form sees `rows` as an array of objects,
   fails `Array.isArray(row)` and renders an empty table — degraded, never
   corrupted. */
function _boardsEncodeRows(c){
  if(!c||c.type!=='table'||!Array.isArray(c.rows))return c;
  if(!c.rows.some(Array.isArray))return c;                 // already encoded
  return{...c,rows:c.rows.map(r=>Array.isArray(r)?{c:r}:r)};
}
function _boardsDecodeCard(c){
  if(!c||c.type!=='table'||!Array.isArray(c.rows))return c;
  if(!c.rows.some(r=>r&&!Array.isArray(r)&&typeof r==='object'))return c;
  return{...c,rows:c.rows.map(r=>Array.isArray(r)?r:((r&&Array.isArray(r.c))?r.c:[]))};
}
function _boardsDecodeCards(arr){
  return (Array.isArray(arr)?arr:[]).map(_boardsDecodeCard);
}
function _boardsCardsForSave(){
  return _editCards.map(c=>{
    const out={};
    Object.keys(c).forEach(k=>{if(k.charAt(0)!=='_')out[k]=c[k];});
    return _boardsEncodeRows(out);
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
    // The tray rides along with the board-level fields rather than through
    // the card merge: a tray item is never edited in place, only added and
    // removed, so last-writer-wins on the whole array is honest here.
    unsorted:_boardsUnsortedForSave(),
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
    surface:_boardsCssVar('--surface','#ffffff'),
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
// A link card's preview picture is mirrored into Cloudinary like any other
// image on a board, so it loads with CORS and draws into the export exactly
// as an image card does — which is most of why it is mirrored at all.
function _boardsExportImageUrl(c){
  return c.type==='image'?(c.imageUrl||''):c.type==='link'?(c.linkImage||''):'';
}
async function _boardsPreloadImages(cards){
  const out={};
  await Promise.all(cards.filter(c=>_boardsExportImageUrl(c))
    .map(c=>_boardsLoadImageEl(_boardsExportImageUrl(c)).then(im=>{out[c.id]=im;})));
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
    :c.type==='column'?'Column':c.type==='table'?'Table'
    :c.type==='heading'?'Heading':'Note';
}
function _boardsDrawCard(ctx,c,img,P){
  const stroke=c.color&&P.tint[c.color]?P.tint[c.color]:P.border;
  if(c.type==='column'){
    ctx.fillStyle=P.soft;
    _boardsRoundRect(ctx,c.x,c.y,c.w,c.h,12);ctx.fill();
    ctx.strokeStyle=stroke;ctx.lineWidth=1.5;
    _boardsRoundRect(ctx,c.x,c.y,c.w,c.h,12);ctx.stroke();
    ctx.fillStyle=P.muted;
    ctx.font='700 12px '+P.font;
    ctx.fillText(String(c.title||'').toUpperCase()||'COLUMN',c.x+10,c.y+19);
    return;
  }
  if(c.type==='frame'){
    ctx.strokeStyle=stroke;ctx.lineWidth=1.5;
    _boardsRoundRect(ctx,c.x,c.y,c.w,c.h,12);ctx.stroke();
    ctx.fillStyle=P.soft;
    ctx.fillRect(c.x,c.y,c.w,26);
    ctx.strokeStyle=stroke;ctx.lineWidth=1;
    ctx.strokeRect(c.x+0.5,c.y+0.5,c.w-1,26);
    ctx.fillStyle=P.muted;
    ctx.font='700 12px '+P.font;
    ctx.fillText(String(c.title||'').toUpperCase()||'SECTION',c.x+10,c.y+18);
    return;
  }
  if(c.type==='table'&&Array.isArray(c.rows)&&c.rows.length){
    const hh=20,rows=c.rows.length,cols=c.rows[0].length||1;
    const rh=Math.max(14,(c.h-hh)/rows),cw=c.w/cols;
    ctx.save();
    ctx.fillStyle=P.surface;ctx.strokeStyle=P.border;ctx.lineWidth=1;
    _boardsRoundRect(ctx,c.x,c.y,c.w,c.h,10);ctx.fill();ctx.stroke();
    ctx.beginPath();
    for(let r=1;r<rows;r++){ctx.moveTo(c.x,c.y+hh+r*rh);ctx.lineTo(c.x+c.w,c.y+hh+r*rh);}
    for(let i=1;i<cols;i++){ctx.moveTo(c.x+i*cw,c.y+hh);ctx.lineTo(c.x+i*cw,c.y+c.h);}
    ctx.stroke();
    ctx.textAlign='left';
    c.rows.forEach((row,r)=>row.forEach((cell,i)=>{
      ctx.fillStyle=(c.head!==false&&r===0)?P.text:P.muted;
      ctx.font=((c.head!==false&&r===0)?'700 ':'')+'12px '+P.font;
      ctx.save();
      ctx.beginPath();ctx.rect(c.x+i*cw,c.y+hh+r*rh,cw,rh);ctx.clip();
      ctx.fillText(_boardsCellDisplay(cell,c),c.x+i*cw+6,c.y+hh+r*rh+rh/2+4);
      ctx.restore();
    }));
    ctx.restore();
    return;
  }
  const headH=20,bx=c.x,by=c.y+headH,bw=c.w,bh=Math.max(0,c.h-headH);
  ctx.save();
  _boardsRoundRect(ctx,c.x,c.y,c.w,c.h,10);
  ctx.clip();
  ctx.fillStyle='#ffffff';ctx.fillRect(c.x,c.y,c.w,c.h);
  ctx.fillStyle=P.soft;ctx.fillRect(c.x,c.y,c.w,headH);
  ctx.fillStyle=P.muted;ctx.font='700 11px '+P.font;
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
      ctx.fillStyle=P.muted;ctx.font='11px '+P.font;
      ctx.fillText('image unavailable',bx+8,by+bh/2);
    }
  }else if(c.type==='todo'){
    ctx.font='12px '+P.font;
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
    // The picture takes the top of the card, the same proportion the DOM
    // gives it, so an exported board reads like the one on screen.
    let ty=by+18;
    if(c.linkImage&&img){
      const ih=Math.min(bh*0.62,bh-46);
      if(ih>10){
        const ar=img.width/img.height,br=bw/ih;
        let sw,sh,sx,sy;
        if(ar>br){sh=img.height;sw=sh*br;sx=(img.width-sw)/2;sy=0;}
        else{sw=img.width;sh=sw/br;sx=0;sy=(img.height-sh)/2;}
        try{ctx.drawImage(img,sx,sy,sw,sh,bx,by,bw,ih);}catch(e){/* drawn as empty */}
        ty=by+ih+16;
      }
    }
    ctx.fillStyle=P.text;ctx.font='700 13px '+P.font;
    ctx.fillText((_boardsWrapLines(ctx,c.linkTitle||'Untitled link',bw-18,1)[0])||'',bx+9,ty);
    ctx.fillStyle=P.muted;ctx.font='12px '+P.font;
    _boardsWrapLines(ctx,c.linkDesc||'',bw-18,2).forEach((l,i)=>ctx.fillText(l,bx+9,ty+16+i*13));
    ctx.fillStyle=P.tint.blue;
    ctx.fillText((_boardsWrapLines(ctx,c.linkSite||_boardsLinkHost(c.linkUrl)||c.linkUrl||'',bw-18,1)[0])||'',bx+9,by+bh-8);
  }else if(c.type==='file'){
    ctx.fillStyle=P.dark;
    _boardsRoundRect(ctx,bx+9,by+10,30,13,3);ctx.fill();
    ctx.fillStyle='#ffffff';ctx.font='700 11px '+P.font;
    ctx.fillText(_boardsFileExt(c.fileName),bx+13,by+19.5);
    ctx.fillStyle=P.text;ctx.font='700 12px '+P.font;
    _boardsWrapLines(ctx,c.fileName||'File',bw-18,2).forEach((l,i)=>ctx.fillText(l,bx+9,by+38+i*14));
    ctx.fillStyle=P.muted;ctx.font='11px '+P.font;
    ctx.fillText(_boardsFormatBytes(c.fileSize),bx+9,by+bh-8);
  }else if(c.type==='heading'){
    ctx.fillStyle=c.color&&P.tint[c.color]?P.tint[c.color]:P.dark;
    ctx.fillRect(bx,by,bw,bh);
    ctx.fillStyle='#ffffff';
    ctx.font='700 16px '+P.font;
    const line=_boardsWrapLines(ctx,c.text||'',bw-24,1)[0]||'';
    const tw=ctx.measureText(line).width;
    ctx.fillText(line,bx+Math.max(10,(bw-tw)/2),by+bh/2+5);
  }else if(c.type==='board'){
    const child=_boardsLiveById()[c.boardId];
    ctx.fillStyle=P.tint.purple;ctx.fillRect(bx,by,3,bh);
    ctx.fillStyle=P.text;ctx.font='700 13px '+P.font;
    ctx.fillText((_boardsWrapLines(ctx,(child&&child.title)||c.boardTitle||'Untitled board',bw-20,1)[0])||'',bx+11,by+20);
    ctx.fillStyle=P.muted;ctx.font='11px '+P.font;
    ctx.fillText(child?((child.cards||[]).length+' cards'):'Board',bx+11,by+36);
  }else{
    ctx.fillStyle=P.text;ctx.font='13px '+P.font;
    const maxLines=Math.max(1,Math.floor((bh-10)/16));
    _boardsWrapLines(ctx,c.text||'',bw-18,maxLines).forEach((l,i)=>ctx.fillText(l,bx+9,by+16+i*16));
  }
  if(c.caption){
    ctx.fillStyle=P.muted;ctx.font='11px '+P.font;
    ctx.fillText((_boardsWrapLines(ctx,c.caption,bw-16,1)[0])||'',bx+8,c.y+c.h-7);
  }
  ctx.restore();
  ctx.strokeStyle=stroke;ctx.lineWidth=1;
  _boardsRoundRect(ctx,c.x+0.5,c.y+0.5,c.w-1,c.h-1,10);
  ctx.stroke();
}
// The export reads the SAME geometry the canvas does (_boardsConnGeom), so
// a curve, a weight or a second arrowhead can never render one way on
// screen and another in the PNG/PDF.
function _boardsDrawConnector(ctx,cn,P){
  const g=_boardsConnGeom(cn);
  if(!g)return;
  const tint=cn.color&&P.tint[cn.color]?P.tint[cn.color]:(cn.free?P.text:P.muted);
  ctx.save();
  ctx.strokeStyle=tint;
  ctx.lineWidth=_BOARDS_CONN_W[cn.weight]||_BOARDS_CONN_W.thin;
  ctx.setLineDash(cn.dash?[7,6]:[]);
  ctx.beginPath();
  ctx.moveTo(g.p1.x,g.p1.y);
  if(g.bent)ctx.quadraticCurveTo(g.ctrl.x,g.ctrl.y,g.p2.x,g.p2.y);
  else ctx.lineTo(g.p2.x,g.p2.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // An arrowhead points along the TANGENT at its end, which on a curve is
  // the line from the control point — not the chord between the endpoints.
  const head=(at,towards)=>{
    const ang=Math.atan2(at.y-towards.y,at.x-towards.x),len=9;
    ctx.beginPath();
    ctx.moveTo(at.x,at.y);
    ctx.lineTo(at.x-len*Math.cos(ang-0.4),at.y-len*Math.sin(ang-0.4));
    ctx.moveTo(at.x,at.y);
    ctx.lineTo(at.x-len*Math.cos(ang+0.4),at.y-len*Math.sin(ang+0.4));
    ctx.stroke();
  };
  if(cn.arrow)head(g.p2,g.bent?g.ctrl:g.p1);
  if(cn.arrowStart)head(g.p1,g.bent?g.ctrl:g.p2);
  if(cn.label){
    ctx.fillStyle=P.text;
    ctx.font='600 13px '+P.font;
    ctx.textAlign='center';
    ctx.fillText(String(cn.label),g.apex.x,g.apex.y-8);
  }
  ctx.restore();
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
      :c.type==='table'?(Array.isArray(c.rows)?c.rows.map(r=>r.map(v=>_boardsCellDisplay(v,c)).join(' | ')).join('  ·  '):'')
      :(c.type==='frame'||c.type==='column')?(c.title||'')
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
  if(p.note)return{note:p.note};
  return p.board?{board:p.board,card:p.card||null}:null;
}
function _boardsConsumeDeepLink(){
  const link=_boardsParseHash();
  if(!link||!session)return false;
  // staged rollout: Creative Hub is still Afnan-only, and a deep link is
  // navigation — it must not be a side door into the module. Remove this
  // with every other Creative Hub route (see _canSeeCreativeHub in
  // js/shared.js). Guarded with typeof so a shared.js that failed to parse
  // leaves the side door SHUT rather than open — fail closed.
  if(typeof _canSeeCreativeHub!=='function'||!_canSeeCreativeHub())return false;
  // A document link (Convert to Document writes these): the Notes page.
  if(link.note){
    if(typeof window.notesOpenPage!=='function')return false;
    if(currentPage==='note-detail'&&typeof _notesViewingId!=='undefined'&&_notesViewingId===link.note)return false;
    window.notesOpenPage(link.note);
    return true;
  }
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

/* ── Unsorted tray (Sept 2026) ─────────────────────────────────────────────
   Afnan asked for Milanote's Unsorted: a per-board holding pen you collect
   into and drag out of when you actually want something placed, and which
   keeps what you never used.

   Design notes worth keeping:

   - It is a plain `unsorted` array on the board document, like `cards`.
     No subcollection, no migration, and a board written before this
     shipped simply has an empty tray.
   - OPEN/CLOSED is per viewer (localStorage), never board data — the same
     rule as the minimap and the snap toggle. Your colleague's tray being
     open is not a fact about the board.
   - Dragging out is POINTER-based, not HTML5 drag-and-drop. The stage
     already treats a native drag as "files arriving from the desktop"
     (see _boardsInternalDrag), and the canvas runs on pointer events
     throughout; adding a second drag system next to it is how the two
     would eventually disagree.
   - A tray item is never edited in place — only added, removed, or turned
     into a card. That is what lets the array be saved whole rather than
     merged card-by-card.
   - PASTE goes to the tray only while the tray is OPEN. Pasting onto the
     canvas has worked since Stage 1 and people rely on it; the tray being
     open is an explicit, visible statement that you are collecting rather
     than placing.
──────────────────────────────────────────────────────────────────────────── */
// Read at load, exactly like the minimap and snap preferences above.
let _boardsTrayOpen=(function(){try{return localStorage.getItem('groovy-boards-tray')==='1';}catch(e){return false;}})();
let _boardsTrayDrag=null;      // an item being dragged out onto the canvas
// Drag-to-select (Sept 2026). Dragging empty canvas now draws a marquee,
// the way Milanote does, so panning needs its own routes — see the note on
// the stage pointerdown handler. `_boardsSpaceDown` is the held space bar;
// `_boardsPanMode` is the Hand toggle in the toolbar, for anyone without a
// keyboard or who would rather not hold anything.
let _boardsSpaceDown=false;
let _boardsPanMode=false;

function _boardsUnsortedForSave(){
  return _editUnsorted.map(u=>{
    const o={};
    Object.keys(u).forEach(k=>{if(k.charAt(0)!=='_')o[k]=u[k];});
    return o;
  });
}
function _boardsTrayItemId(){
  return 'u'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
}
// What a tray item is called in the list and in the card it becomes.
function _boardsTrayLabel(u){
  return u.name||u.fileName||u.linkTitle||(u.text?String(u.text).split('\n')[0].slice(0,60):'')||
    (u.kind==='image'?'Image':u.kind==='file'?'File':u.kind==='link'?'Link':'Note');
}
window.boardsToggleTray=function(){
  _boardsTrayOpen=!_boardsTrayOpen;
  try{localStorage.setItem(_BOARDS_TRAY_KEY,_boardsTrayOpen?'1':'0');}catch(e){}
  _boardsRenderCanvasAndWire();
};
window.boardsCloseTray=function(){
  // On Home this is the SOFT close: the panel collapses to its rail instead
  // of disappearing, because there it is the thing that manages the boards
  // and a person who shuts it by accident should be able to see the way back.
  if(_boardsIsHome(_editBoard)){_boardsSetHomePanel(true);_boardsRenderCanvasAndWire();return;}
  if(!_boardsTrayOpen)return;
  _boardsTrayOpen=false;
  try{localStorage.setItem(_BOARDS_TRAY_KEY,'0');}catch(e){}
  _boardsRenderCanvasAndWire();
};

function _boardsTrayHTML(canEdit){
  const home=_boardsIsHome(_editBoard);
  // On Home the panel is always in the DOM — expanded, or collapsed to the
  // rail that brings it back.
  if(home&&_boardsHomePanelCollapsed){
    const n=_boardsHomeList().length;
    return`<aside class="board-tray collapsed" id="board-tray">
      <button class="board-tray-reopen" onclick="window.boardsTogglePanel()" title="Show the boards panel">
        <span class="board-tray-reopen-arrow">‹</span>
        <span class="board-tray-reopen-label">BOARDS</span>
        <span class="board-tray-reopen-n">${n}</span>
      </button>
    </aside>`;
  }
  if(!home&&!_boardsTrayOpen)return'';
  /* ON HOME THERE IS NO UNSORTED (Sept 2026) — Afnan: "there is no need for
     unsorted function in home". Home is the board OF boards: the panel
     there manages boards, and a scratch shelf for pasted images beside it
     was a second unrelated thing wearing the same chrome. The tab strip
     went with it — a header with one tab in it says nothing — so the panel
     is the Boards panel, full stop, and _boardsTrayTab is gone rather than
     left behind as a flag nothing reads.

     The consequence that had to be answered rather than shrugged off:
     paste COLLECTS (see _boardsOnPaste), and on Home there is nowhere to
     collect into. So on Home a paste places on the canvas, which is what
     it did before the tray existed. Off Home nothing changes. */
  const n=_editUnsorted.length;
  const head=home
    ?`<span class="board-tray-title">Boards <span class="board-tray-tabn">${_boardsHomeList().length}</span></span>`
    :`<span class="board-tray-title">Unsorted${n?' · '+n:''}</span>`;
  return`<aside class="board-tray${home?' wide':''}" id="board-tray">
    <div class="board-tray-head">
      ${head}
      <button class="tool-btn" onclick="window.boardsCloseTray()" title="${home?'Collapse the panel — the rail brings it back':'Close the panel'}">${home?'Hide ›':'Close'}</button>
    </div>
    ${home?_boardsPanelHTML(canEdit):_boardsTrayUnsortedHTML(canEdit,n)}
  </aside>`;
}
function _boardsTrayUnsortedHTML(canEdit,n){
  return`${canEdit?`<div class="board-tray-add">
      <button class="tool-btn" onclick="window.boardsTrayPick()">+ Add files</button>
      <span class="board-tray-hint">or paste, or drop files here</span>
    </div>`:''}
    <div class="board-tray-list" id="board-tray-list">
      ${n?_editUnsorted.map((u,i)=>_boardsTrayItemHTML(u,i,canEdit)).join('')
         :`<div class="board-tray-empty">
             Nothing here yet.<br><br>
             Anything you paste or drop while this is open is kept here
             until you drag it onto the board. It stays saved if you never do.
           </div>`}
    </div>
    <input type="file" id="board-tray-picker" multiple style="display:none" onchange="window.boardsTrayFilesPicked(this)">`;
}

/* ── Home's Boards panel (Sept 2026) ────────────────────────────────────
   Milanote's home keeps every board in a scrollable side panel you drag
   onto the canvas. Afnan asked for the same, holding BOTH Team and Private
   boards with a way to pick between them, plus search and "take me to it".

   THE LIST IS DERIVED FROM THE QUERY, NOT A STORED HOLDING PEN. That is
   the one decision everything else falls out of:

   - Nothing to keep in step. A board created on another device, by someone
     else, or restored from Trash is in the list the moment loadBoardsData
     sees it — no write, no reconciliation, no orphan state when a write
     fails. Same discipline as frame membership, nesting and the label
     library.
   - "Remove a card from Home and the board goes back to the list" (Afnan's
     third answer) needs no bookkeeping at all: the row is there either way,
     it just stops saying On Home. That is also why auto-place had to go —
     see _boardsHomeSync.
   - A board can never be stranded. The panel, All boards and the gallery
     search all read the same `moodBoards`, so there is no view in which a
     board exists only as a card somebody deleted.

   Placed / not placed is derived too (_boardsHomeCarded): a card on THIS
   board pointing at that board id. Unsorted is the opposite kind of thing —
   items that exist nowhere else and must be stored — which is why the two
   tabs share a panel and nothing else. */
let _boardsPanelQuery='';
let _boardsPanelFilter='all';   // all | shared | personal
/* A board whose row just changed state — placed onto Home, or taken back
   off it. ONE-SHOT: the next render of the list consumes it, the way
   _boardsNextPlacement is consumed by the next card. It is a board id, not
   a row element, because the list is rebuilt from scratch each render and
   an element reference would point at something already thrown away. */
let _boardsPanelFlash=null;
let _boardsPanelTimer=null;
/* ── Home's panel is a fixture, not a popup (Sept 2026) ─────────────────
   Afnan: "on home page the tab you created to manage board it should be
   wider and always open and a funtion to soft close."

   So on HOME the panel is always rendered. Closing it COLLAPSES it to a
   narrow rail carrying the board count and a handle back — that is what
   makes the close soft: the thing does not vanish, and getting it back is
   one click on something you can see. Off Home the Unsorted tray is
   unchanged, because there it really is a scratch shelf you open when you
   want it.

   The collapse is per VIEWER (localStorage), like the minimap, the snap
   preference and the tray tab — it is about this screen, not about the
   board, and it must not travel to somebody else with it. It defaults to
   EXPANDED: "always open" is the instruction, and a panel that remembered
   itself shut would quietly undo it. */
const _BOARDS_HOME_PANEL_KEY='groovy-boards-home-panel';
let _boardsHomePanelCollapsed=(function(){try{return localStorage.getItem('groovy-boards-home-panel')==='closed';}catch(e){return false;}})();
function _boardsHomePanelOpen(){return _boardsIsHome(_editBoard)&&!_boardsHomePanelCollapsed;}
function _boardsSetHomePanel(collapsed){
  _boardsHomePanelCollapsed=!!collapsed;
  try{localStorage.setItem(_BOARDS_HOME_PANEL_KEY,collapsed?'closed':'open');}catch(e){}
}
window.boardsTogglePanel=function(){
  _boardsSetHomePanel(!_boardsHomePanelCollapsed);
  _boardsRenderCanvasAndWire();
};
// Every board this person can see that could sit on Home: not a Home, not
// this board, and not already nested under a real parent (a sub-board
// belongs with its parent — putting it on Home too would be the same board
// in two places with two different meanings).
function _boardsHomeList(){
  if(!Array.isArray(moodBoards))return[];
  const nested=_boardsNestedIds();
  return moodBoards.filter(b=>b&&!b.isHome&&(!_editBoard||b.id!==_editBoard.id)&&!nested.has(b.id));
}
// boardId → the id of the card on this board that points at it.
function _boardsHomeCarded(){
  const m=Object.create(null);
  _editCards.forEach(c=>{if(c.type==='board'&&c.boardId&&!m[c.boardId])m[c.boardId]=c.id;});
  return m;
}
/**
 * A board matches on its own words — title, owner, visibility — OR on what
 * is written on its cards. `loadBoardsData` already reads whole documents,
 * so the card text is in memory and searching it costs nothing extra; it is
 * the same reach the gallery's search has, through the same
 * `_boardsMatchCount`, so the two cannot disagree about what "matched" means.
 */
function _boardsPanelMatch(b,q){
  if(!q)return true;
  const hay=[(b.title||''),(b.ownerName||''),(b.visibility==='shared'?'team':'private')].join(' ').toLowerCase();
  if(hay.indexOf(q)>-1)return true;
  return _boardsMatchCount(b,q)>0;
}
function _boardsPanelBoards(){
  const q=_boardsPanelQuery.trim().toLowerCase();
  const f=_boardsPanelFilter;
  return _boardsHomeList()
    .filter(b=>f==='all'||(f==='shared'?b.visibility==='shared':b.visibility!=='shared'))
    .filter(b=>_boardsPanelMatch(b,q))
    .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
}
function _boardsPanelUnplaced(){
  const on=_boardsHomeCarded();
  return _boardsHomeList().filter(b=>!on[b.id]);
}
function _boardsPanelHTML(canEdit){
  const f=_boardsPanelFilter;
  const left=_boardsPanelUnplaced().length;
  /* Home stopped having an Unsorted tray, and anything already collected
     into one would otherwise be stranded: still saved on the document,
     reachable from nowhere. Nothing is rewritten on open to tidy that up —
     a write on a read path is the discipline this module holds against —
     so the panel just SAYS SO, once, with a button that places them. It
     disappears for good the moment it is used, and a Home that never had
     a tray never shows it. */
  const stray=_editUnsorted.length;
  const strayHTML=(stray&&canEdit)
    ?`<div class="board-panel-stray">
        <div>${stray} item${stray===1?'':'s'} ${stray===1?'was':'were'} collected here before Home dropped its Unsorted tray.</div>
        <button class="tool-btn" onclick="window.boardsHomeFlushUnsorted()">Place ${stray===1?'it':'them'} on Home</button>
      </div>`:'';
  return strayHTML+`<div class="board-tray-add board-panel-tools">
      <input type="search" class="board-panel-search" id="board-panel-search" placeholder="Search boards…"
        value="${_boardsEsc(_boardsPanelQuery)}" oninput="window.boardsPanelSearch(this)">
      <div class="board-panel-seg" id="board-panel-seg">${_boardsPanelSegHTML(f)}</div>
      ${canEdit?`<div class="board-panel-new">
        <button class="tool-btn" onclick="window.boardsCreate('shared')">+ Team board</button>
        <button class="tool-btn" onclick="window.boardsCreate('personal')">+ Private board</button>
        <button class="tool-btn" id="board-panel-place" onclick="window.boardsHomePlaceAll()" ${left?'':'style="display:none"'} title="Put every board that isn’t on Home onto Home">Place all${left?' ('+left+')':''}</button>
      </div>`:''}
    </div>
    <div class="board-panel-list" id="board-panel-list">${_boardsPanelRowsHTML(canEdit)}</div>`;
}
function _boardsPanelSegHTML(f){
  return['all','shared','personal'].map(k=>
    `<button class="${f===k?'on':''}" onclick="window.boardsPanelSetFilter('${k}')">${k==='all'?'All':k==='shared'?'Team':'Private'}</button>`).join('');
}
function _boardsPanelRowsHTML(canEdit){
  const rows=_boardsPanelBoards();
  const q=_boardsPanelQuery.trim();
  const note=(q||_boardsPanelFilter!=='all')&&rows.length
    ?`<div class="board-panel-count">${rows.length} board${rows.length===1?'':'s'}${q?' matched':''}</div>`:'';
  if(!rows.length){
    return`<div class="board-tray-empty">${_boardsPanelQuery.trim()||_boardsPanelFilter!=='all'
      ?'No board matched that.'
      :'No boards yet. Make one with the buttons above — it lands here, and you drag it onto Home wherever you want it.'}</div>`;
  }
  const on=_boardsHomeCarded();
  const flash=_boardsPanelFlash;_boardsPanelFlash=null;
  return note+rows.map(b=>_boardsPanelRowHTML(b,!!on[b.id],canEdit,b.id===flash)).join('');
}
/* A row is Milanote's: a big picture on the left, the WHOLE name beside it,
   a meta line under that, and the actions on a line of their OWN.
   The name never shares a row with a button — that is the Profile-directory
   rule, and the 280px panel broke it the obvious way: at 30px of tile plus
   a state word plus an Open button there was nothing left and the name
   rendered as "WINTER D…". A wider panel alone would not have fixed it,
   only postponed it. */
function _boardsPanelRowHTML(b,placed,canEdit,flash){
  const cards=b.cards||[];
  const files=_boardsCountFiles(cards);
  const subs=cards.filter(c=>c.type==='board'&&c.boardId).length;
  // Whose board it is, but only when it isn't yours — your own name read
  // back at you is the noise the profile provenance line already avoids.
  const mine=!!(typeof session!=='undefined'&&session&&b.ownerUid===session.uid);
  const meta=(b.visibility==='shared'?'TEAM':'PRIVATE')+' · '+cards.length+' card'+(cards.length===1?'':'s')+
    (files?' · '+files+' file'+(files===1?'':'s'):'')+
    (subs?' · '+subs+' board'+(subs===1?'':'s'):'')+
    (!mine&&b.ownerName?' · '+b.ownerName:'');
  const id=_boardsEsc(b.id);
  // When a search matched the CARDS rather than the name, say so — a row
  // appearing for a word that is nowhere on it reads as a broken filter.
  const q=_boardsPanelQuery.trim().toLowerCase();
  const hits=(q&&(b.title||'').toLowerCase().indexOf(q)===-1)?_boardsMatchCount(b,q):0;
  // The title is written in by _boardsPanelHydrate with textContent —
  // someone else named this board and it is drawn into this person's page.
  return`<div class="board-panel-row${placed?' placed':''}${flash?' flash':''}" data-board="${id}"
      title="${placed?'On Home — click to go to it':(canEdit?'Drag onto Home to place it, or click':'Click to open')}"
      ${canEdit?`onpointerdown="window.boardsPanelDragStart(event,'${id}')"`:''}
      onclick="window.boardsPanelRowClick('${id}')"
      oncontextmenu="window.boardsPanelMenu(event,'${id}')">
    <span class="board-panel-tile"${canEdit?` onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()" ondblclick="event.stopPropagation();window.boardsOpenBoardLook('${id}')" title="Double-click to change the picture, colour, letter or icon"`:''}>${_boardsTileHTML(b,58)}</span>
    <div class="board-panel-info">
      <div class="board-panel-name" id="board-panel-n-${id}"
        ${canEdit?`onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()" ondblclick="event.stopPropagation();window.boardsPanelRename('${id}')" title="Double-click to rename"`:''}></div>
      <div class="board-panel-meta">${_boardsEsc(meta)}</div>
      ${hits?`<div class="board-panel-hit">${hits} matching card${hits===1?'':'s'}</div>`:''}
      <div class="board-panel-actions">
        <span class="board-panel-state">${placed?'On Home':(canEdit?'Not placed':'')}</span>
        <button class="board-panel-open" onpointerdown="event.stopPropagation()"
          onclick="event.stopPropagation();window.boardsPanelOpen('${id}')" title="Open this board">Open</button>
        ${canEdit?`<button class="board-panel-more" onpointerdown="event.stopPropagation()"
          onclick="event.stopPropagation();window.boardsPanelMenu(event,'${id}')" title="Picture, colour, icon, rename…">⋯</button>`:''}
      </div>
    </div>
  </div>`;
}
// The row's ⋯ and its right-click both open the GALLERY's menu, through the
// gallery's own router — picture, colour, icon, rename, duplicate, template,
// Team/Private, Trash all already live there, acting on a board BY ID, which
// is exactly what a panel row is. A second menu would be the rail-and-
// selection-bar mistake again.
/* Renaming IN PLACE, from a double-click on the name.
   The gallery's rename is a prompt(), which is right there — a card that is
   also a click-to-open target would fight an inline editor. A panel row is
   not that: the name already stops its own clicks, so nothing underneath is
   competing for the gesture.
   Enter or blur saves, Escape restores. The old name is captured BEFORE the
   field is opened rather than read back from the element, so a cancel
   cannot put a half-typed name back. Written in with textContent for the
   usual reason: somebody else named this board. */
let _boardsPanelRenaming=null;
window.boardsPanelRename=function(id){
  const b=moodBoards.find(x=>x.id===id);
  if(!b||!_boardsCanEdit(b))return;
  const el=document.getElementById('board-panel-n-'+id);
  if(!el)return;
  _boardsPanelRenaming={id,was:b.title||''};
  el.setAttribute('contenteditable','true');
  el.classList.add('editing');
  el.textContent=b.title||'';
  el.onkeydown=function(ev){
    if(ev.key==='Enter'){ev.preventDefault();el.blur();return;}
    if(ev.key==='Escape'){ev.preventDefault();_boardsPanelRenaming={id,was:b.title||'',cancel:true};el.blur();}
  };
  el.onblur=function(){window.boardsPanelRenameDone(id,el);};
  try{
    el.focus();
    const r=document.createRange();r.selectNodeContents(el);
    const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);
  }catch(e){/* focus/selection is a nicety, not the feature */}
};
window.boardsPanelRenameDone=async function(id,el){
  const st=_boardsPanelRenaming;
  _boardsPanelRenaming=null;
  if(!el)return;
  el.removeAttribute('contenteditable');
  el.classList.remove('editing');
  el.onkeydown=null;el.onblur=null;
  const was=(st&&st.was)||'';
  if(st&&st.cancel){el.textContent=was;return;}
  const next=String(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,120);
  if(!next||next===was){el.textContent=was||'Untitled board';return;}
  await _boardsSaveIdentity(id,{title:next});
  // _boardsSaveIdentity repaints the panel on Home, which rebuilds this
  // element — so nothing is written back into the old one.
  showToast('Renamed');
};
window.boardsPanelMenu=function(e,id){
  const b=moodBoards.find(x=>x.id===id);
  if(!b)return;
  e.preventDefault();e.stopPropagation();
  _boardsOpenCtx(e.clientX,e.clientY,_boardsGalleryCtxItems(b),id);
};
function _boardsPanelHydrate(){
  // Called from every canvas render, so it has to be free when the panel
  // isn't on screen — which is every board that isn't Home.
  if(!document.getElementById('board-panel-list'))return;
  _boardsHomeList().forEach(b=>{
    const el=document.getElementById('board-panel-n-'+b.id);
    if(el)el.textContent=b.title||'Untitled board';
  });
}
// Repaints the list ALONE. A keystroke must not rebuild the canvas: on a
// 46-card board that redraws every card and every connector, and it would
// also destroy the input the caret is in — the reason the Find bar does
// not rerender either.
function _boardsPanelRepaint(){
  const list=document.getElementById('board-panel-list');
  if(!list)return;
  list.innerHTML=_boardsPanelRowsHTML(_boardsCanEdit(_editBoard));
  _boardsPanelHydrate();
  const seg=document.getElementById('board-panel-seg');
  if(seg)seg.innerHTML=_boardsPanelSegHTML(_boardsPanelFilter);
  const place=document.getElementById('board-panel-place');
  if(place){
    const left=_boardsPanelUnplaced().length;
    place.style.display=left?'':'none';
    place.textContent='Place all'+(left?' ('+left+')':'');
  }
}
window.boardsPanelSearch=function(el){
  _boardsPanelQuery=el.value||'';
  clearTimeout(_boardsPanelTimer);
  _boardsPanelTimer=setTimeout(_boardsPanelRepaint,180);
};
window.boardsPanelSetFilter=function(f){
  _boardsPanelFilter=(f==='shared'||f==='personal')?f:'all';
  _boardsPanelRepaint();
};
window.boardsPanelOpen=function(id){
  if(!_boardsLiveById()[id]){showToast('That board is not available — it may have been deleted, or it is private to someone else');return;}
  window.boardsOpen(id);
};
// Mints the card. `at` is a world point (the drop) or null for "wherever
// new cards go". Shared by the drag-out, the click and Place all, so the
// three cannot produce different cards.
function _boardsHomePlaceOne(b,at){
  const nc=_boardsNewCard('board');
  nc.boardId=b.id;nc.boardTitle=b.title||'Untitled board';
  nc.w=_BOARDS_HOME_W;nc.h=_BOARDS_HOME_H;
  const p=at||_boardsPlacementPoint();
  nc.x=Math.round(at?p.x-nc.w/2:p.x);
  nc.y=Math.round(at?p.y-nc.h/2:p.y);
  _editCards.push(nc);
  return nc;
}
// Click a row: go to the card if the board is already on Home, otherwise
// place it and go to it. Either way you end up looking at it, which is the
// "search and scroll to view" half of what was asked for.
window.boardsPanelRowClick=function(id){
  const b=_boardsLiveById()[id];
  if(!b){showToast('That board is not available — it may have been deleted, or it is private to someone else');return;}
  const on=_boardsHomeCarded();
  if(on[id]){_boardsFocusCard(on[id]);return;}
  if(!_boardsCanEdit(_editBoard)){window.boardsPanelOpen(id);return;}
  _boardsPushUndo();
  const nc=_boardsHomePlaceOne(b,null);
  _boardsPanelFlash=id;
  _boardsRenderCanvasAndWire();
  _boardsFocusCard(nc.id);
  _boardsSaveDebounced();
  showToast('“'+(b.title||'Untitled board')+'” placed on Home');
};
/* Places every item left in Home's retired Unsorted tray, through the same
   _boardsCardFromTrayItem the drag-out uses, so a flushed item and a dragged
   one are the same card. One undo entry for the lot. */
window.boardsHomeFlushUnsorted=function(){
  if(!_boardsCanEdit(_editBoard)||!_editUnsorted.length)return;
  _boardsPushUndo();
  const n=_editUnsorted.length;
  _editUnsorted.forEach(u=>{
    const p=_boardsPlacementPoint();
    _editCards.push(_boardsCardFromTrayItem(u,{x:p.x+_BOARDS_HOME_W/2,y:p.y+_BOARDS_HOME_H/2}));
  });
  _editUnsorted=[];
  _boardsRenderCanvasAndWire();
  _boardsSaveNow();
  showToast(n+' item'+(n===1?'':'s')+' placed on Home — Ctrl+Z to undo');
};
window.boardsHomePlaceAll=function(){
  if(!_boardsCanEdit(_editBoard))return;
  const left=_boardsPanelUnplaced().length;
  if(!left){showToast('Every board is already on Home');return;}
  _boardsPushUndo();
  const n=_boardsHomeAutoPlace();
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  showToast(n+' board'+(n===1?'':'s')+' placed on Home — Ctrl+Z to undo');
};
// Dragging a row onto the canvas, pointer-based like the Unsorted tray's
// drag-out and for the same reason: the stage reads a native HTML5 drag as
// "files from the desktop" (_boardsInternalDrag), so a second drag system
// beside this one is how the two would eventually disagree.
window.boardsPanelDragStart=function(e,id){
  if(!_boardsCanEdit(_editBoard))return;
  const b=_boardsLiveById()[id];
  if(!b)return;
  if(_boardsHomeCarded()[id])return;   // already on Home — the click scrolls to it
  e.stopPropagation();
  const startX=e.clientX,startY=e.clientY;
  const host=e.currentTarget;
  let ghost=null;
  host.setPointerCapture(e.pointerId);
  function move(ev){
    if(!ghost){
      if(Math.abs(ev.clientX-startX)<4&&Math.abs(ev.clientY-startY)<4)return;
      ghost=document.createElement('div');
      ghost.className='board-tray-ghost';
      ghost.textContent=b.title||'Untitled board';
      document.body.appendChild(ghost);
      const stage=document.getElementById('board-stage');
      if(stage)stage.classList.add('tray-target');
    }
    ghost.style.left=ev.clientX+'px';
    ghost.style.top=ev.clientY+'px';
  }
  function up(ev){
    host.removeEventListener('pointermove',move);
    host.removeEventListener('pointerup',up);
    host.removeEventListener('pointercancel',up);
    const stage=document.getElementById('board-stage');
    if(stage)stage.classList.remove('tray-target');
    if(!ghost)return;                    // a plain click, not a drag
    ghost.remove();ghost=null;
    // The pointer was captured by this row, so the click that follows is
    // retargeted here and would run boardsPanelRowClick — placing the board
    // a second time. Same retargeting that broke the delete ✕.
    _boardsSuppressClick=true;
    const r=stage?stage.getBoundingClientRect():null;
    const over=r&&ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom;
    if(!over)return;
    _boardsPushUndo();
    const nc=_boardsHomePlaceOne(b,_boardsScreenToWorld(ev.clientX,ev.clientY));
    _boardsPanelFlash=b.id;
    _boardsSetSelection([nc.id]);
    _boardsRenderCanvasAndWire();
    _boardsSaveDebounced();
  }
  host.addEventListener('pointermove',move);
  host.addEventListener('pointerup',up);
  host.addEventListener('pointercancel',up);
};

function _boardsTrayItemHTML(u,i,canEdit){
  let thumb;
  if(u._uploading){
    thumb='<div class="board-tray-thumb board-tray-thumb-empty">Uploading…</div>';
  }else if(u.kind==='image'&&u.imageUrl){
    thumb=`<img class="board-tray-thumb" src="${_boardsEsc(_boardsDisplayUrl(u.imageUrl,400))}" crossorigin="anonymous" draggable="false" onerror="window.boardsImgFallback(this)" alt="">`;
  }else if(u.kind==='file'){
    const pdf=u.fileUrl?_boardsPdfThumbUrl(u.fileUrl):'';
    thumb=pdf
      ?`<img class="board-tray-thumb" src="${_boardsEsc(pdf)}" draggable="false" onerror="this.className='board-tray-thumb board-tray-thumb-empty';this.replaceWith(Object.assign(document.createElement('div'),{className:'board-tray-thumb board-tray-thumb-empty',textContent:'${_boardsEsc(_boardsFileExt(u.fileName))}'}))" alt="">`
      :`<div class="board-tray-thumb board-tray-thumb-empty">${_boardsEsc(_boardsFileExt(u.fileName))}</div>`;
  }else if(u.kind==='link'){
    // Milanote's tray shows the page's own picture, which is the whole
    // reason a collected link is recognisable at a glance.
    thumb=u.linkImage
      ?`<img class="board-tray-thumb" src="${_boardsEsc(_boardsDisplayUrl(u.linkImage,400))}" crossorigin="anonymous" draggable="false" onerror="window.boardsImgFallback(this)" alt="">`
      :`<div class="board-tray-thumb board-tray-thumb-empty">${u._fetching?'…':'LINK'}</div>`;
  }else{
    thumb='<div class="board-tray-thumb board-tray-thumb-empty">NOTE</div>';
  }
  // The label is written in with textContent by _boardsTrayHydrate — it can
  // be a filename or a line of someone's note, and this file never
  // interpolates user text into an HTML string.
  return`<div class="board-tray-item" data-idx="${i}" title="Drag onto the board to place it"
      ${canEdit?`onpointerdown="window.boardsTrayDragStart(event,${i})"`:''}>
    ${thumb}
    <div class="board-tray-label" id="board-tray-l-${i}"></div>
    ${canEdit?`<button class="board-tray-del" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();window.boardsTrayRemove(${i})" title="Remove from Unsorted">✕</button>`:''}
  </div>`;
}
function _boardsTrayHydrate(){
  _editUnsorted.forEach((u,i)=>{
    const el=document.getElementById('board-tray-l-'+i);
    if(el)el.textContent=_boardsTrayLabel(u);
  });
}

// ── putting things IN ──
function _boardsTrayAdd(item){
  _editUnsorted.push(item);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  return item;
}
window.boardsTrayPick=function(){
  const el=document.getElementById('board-tray-picker');
  if(el)el.click();
};
window.boardsTrayFilesPicked=function(inputEl){
  const files=Array.from(inputEl.files||[]);
  inputEl.value='';
  _boardsTrayAddFiles(files);
};
function _boardsTrayAddFiles(files){
  if(!_boardsCanEdit(_editBoard)||!files.length)return;
  files.forEach(f=>{
    const item={id:_boardsTrayItemId(),kind:_boardsIsImageFile(f)?'image':'file',
      fileName:f.name,fileSize:f.size,at:Date.now(),
      by:(typeof session!=='undefined'&&session&&session.name)||'',_uploading:true};
    _editUnsorted.push(item);
    _boardsUploadAny(f).then(res=>{
      const live=_editUnsorted.find(x=>x.id===item.id);
      if(!live)return;                     // removed while it was uploading
      delete live._uploading;
      if(live.kind==='image'){
        live.imageUrl=res.secure_url;
        // Cloudinary hands back the dimensions for free, and a tray item
        // that keeps them comes out of the tray already the right shape.
        // (A PDF's page size is NOT kept — see _boardsCardFromTrayItem.)
        if(+res.width>0&&+res.height>0){live.imgW=+res.width;live.imgH=+res.height;}
      }else live.fileUrl=res.secure_url;
      _boardsRenderSoon();_boardsSaveDebounced();
    }).catch(e=>{
      _editUnsorted=_editUnsorted.filter(x=>x.id!==item.id);
      showToast('Upload failed: '+(e.message||e),true);
      _boardsRenderSoon();
    });
  });
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
}
// A card the user no longer wants placed. The reverse of dragging one out.
window.boardsTrayStash=function(cardId){
  const c=_editCards.find(x=>x.id===cardId);
  if(!c||!_boardsCanEdit(_editBoard))return;
  _boardsPushUndo();
  const item={id:_boardsTrayItemId(),at:Date.now(),
    by:(typeof session!=='undefined'&&session&&session.name)||'',name:c.name||''};
  if(c.type==='image'){item.kind='image';item.imageUrl=c.imageUrl;}
  else if(c.type==='file'){item.kind='file';item.fileUrl=c.fileUrl;item.fileName=c.fileName;item.fileSize=c.fileSize;}
  else if(c.type==='link'){item.kind='link';item.linkUrl=c.linkUrl;item.linkTitle=c.linkTitle;item.text=c.linkDesc||'';
    if(c.linkImage)item.linkImage=c.linkImage;
    if(c.linkSite)item.linkSite=c.linkSite;}
  else{item.kind='text';item.text=c.text||'';item.rich=c.rich||'';}
  _editUnsorted.push(item);
  _editCards=_editCards.filter(x=>x.id!==cardId);
  _editConnectors=_editConnectors.filter(cn=>cn.from!==cardId&&cn.to!==cardId);
  _boardsSelection.delete(cardId);
  if(!_boardsTrayOpen)window.boardsToggleTray();else _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
  showToast('Moved to Unsorted');
};
window.boardsTrayRemove=function(i){
  const u=_editUnsorted[i];
  if(!u||!_boardsCanEdit(_editBoard))return;
  if(!confirm('Remove “'+_boardsTrayLabel(u)+'” from Unsorted? This cannot be undone.'))return;
  _editUnsorted.splice(i,1);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};

// ── taking things OUT ──
// One tray item becomes one card at a world point.
function _boardsCardFromTrayItem(u,at){
  const type=u.kind==='image'?'image':u.kind==='file'?'file':u.kind==='link'?'link':'text';
  const c=_boardsNewCard(type);
  if(u.name)c.name=u.name;
  if(type==='image'){
    c.imageUrl=u.imageUrl||'';
    if(c.imageUrl)_boardsFitImageCard(c,{width:u.imgW,height:u.imgH});
  }
  else if(type==='file'){
    c.fileUrl=u.fileUrl||'';c.fileName=u.fileName||'';c.fileSize=u.fileSize||0;
    // A tray item keeps no page size, so a PDF comes out A4-shaped.
    if(c.fileUrl)_boardsFitPdfCard(c);
  }
  else if(type==='link'){
    c.linkUrl=u.linkUrl||'';c.linkTitle=u.linkTitle||'';c.linkDesc=u.text||'';
    if(u.linkSite)c.linkSite=u.linkSite;
    // Already fetched and mirrored while it sat in the tray — dragging it
    // out must not throw that away and fetch it a second time.
    if(u.linkImage){c.linkImage=u.linkImage;c.w=_BOARDS_LINK_PREVIEW_W;c.h=_BOARDS_LINK_PREVIEW_H;}
    else if(u.linkTitle&&u.linkTitle!==_boardsLinkHost(u.linkUrl)){c.w=_BOARDS_LINK_PREVIEW_W;c.h=_BOARDS_LINK_TEXT_H;}
  }
  else{c.text=u.text||'';if(u.rich)c.rich=u.rich;}
  c.x=at.x-c.w/2;c.y=at.y-c.h/2;   // after sizing, so it centres on the drop
  return c;
}
// Returns true when it consumed the paste. Mirrors _boardsOnPaste's own
// order of preference — an image always wins, then a URL, then plain text.
/**
 * Makes the Unsorted panel the thing you are looking at, because a paste
 * that collects must never be invisible. It is persisted: you were
 * collecting, and the next paste should land somewhere you are already
 * looking. Home never reaches here — it has no Unsorted and its paste
 * places instead (_boardsOnPaste).
 */
function _boardsCollectInto(){
  let changed=false;
  if(!_boardsTrayOpen){
    _boardsTrayOpen=true;changed=true;
    try{localStorage.setItem(_BOARDS_TRAY_KEY,'1');}catch(e){}
  }
  return changed;
}
/** A pasted string becomes a link item or a note. Callers collect first. */
function _boardsTrayAddText(text){
  const url=String(text||'').trim();
  const by=(typeof session!=='undefined'&&session&&session.name)||'';
  if(/^https?:\/\/\S+$/i.test(url)){
    let host=url;
    try{host=new URL(url).hostname.replace(/^www\./,'');}catch(err){}
    const item=_boardsTrayAdd({id:_boardsTrayItemId(),kind:'link',linkUrl:url,linkTitle:host,at:Date.now(),by});
    _boardsTrayLinkHydrate(item.id);
    showToast('Link added to Unsorted');
    return item;
  }
  const item=_boardsTrayAdd({id:_boardsTrayItemId(),kind:'text',text:String(text).slice(0,4000),at:Date.now(),by});
  showToast('Added to Unsorted');
  return item;
}
window.boardsTrayDragStart=function(e,i){
  if(!_boardsCanEdit(_editBoard))return;
  const u=_editUnsorted[i];
  if(!u||u._uploading)return;
  e.stopPropagation();
  const startX=e.clientX,startY=e.clientY;
  const host=e.currentTarget;
  let ghost=null;
  host.setPointerCapture(e.pointerId);
  function move(ev){
    if(!ghost){
      if(Math.abs(ev.clientX-startX)<4&&Math.abs(ev.clientY-startY)<4)return;
      ghost=document.createElement('div');
      ghost.className='board-tray-ghost';
      ghost.textContent=_boardsTrayLabel(u);
      document.body.appendChild(ghost);
      _boardsTrayDrag={item:u,index:i};
      const stage=document.getElementById('board-stage');
      if(stage)stage.classList.add('tray-target');
    }
    ghost.style.left=ev.clientX+'px';
    ghost.style.top=ev.clientY+'px';
  }
  function up(ev){
    host.removeEventListener('pointermove',move);
    host.removeEventListener('pointerup',up);
    host.removeEventListener('pointercancel',up);
    const stage=document.getElementById('board-stage');
    if(stage)stage.classList.remove('tray-target');
    if(ghost){ghost.remove();ghost=null;}
    if(!_boardsTrayDrag)return;            // a plain click, not a drag
    _boardsTrayDrag=null;
    // Dropped back on the tray (or anywhere that isn't the canvas) → keep it.
    const r=stage?stage.getBoundingClientRect():null;
    const over=r&&ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom;
    if(!over)return;
    _boardsPushUndo();
    const c=_boardsCardFromTrayItem(u,_boardsScreenToWorld(ev.clientX,ev.clientY));
    _editCards.push(c);
    _editUnsorted=_editUnsorted.filter(x=>x.id!==u.id);
    _boardsSetSelection([c.id]);
    _boardsRenderCanvasAndWire();
    _boardsSaveDebounced();
  }
  host.addEventListener('pointermove',move);
  host.addEventListener('pointerup',up);
  host.addEventListener('pointercancel',up);
};
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
  // The merge keeps _boardsBase in the WIRE form (it is compared against
  // _boardsCardsForSave output), so only what lands in memory is decoded.
  _editCards=_boardsDecodeCards(out);
  if(!_boardsConnDirty()){
    _editConnectors=(data.connectors||[]).map(c=>({...c}));
    _boardsConnEnsureIds();
    _boardsConnBase=JSON.stringify(_editConnectors);
  }
  // Title: leave it alone while it is being typed into.
  const titleEl=document.getElementById('board-title-input');
  if(data.title!=null&&document.activeElement!==titleEl)_editBoard.title=data.title;
  if(data.visibility)_editBoard.visibility=data.visibility;
  // The tray, unless something here is still uploading into it — adopting
  // the server's copy mid-upload would drop the row the upload resolves to.
  if(!_editUnsorted.some(u=>u._uploading))_editUnsorted=(data.unsorted||[]).map(u=>({...u}));
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
/* ── Trash (Sept 2026) ─────────────────────────────────────────────────
   REVERSES M8. Cards had no trash from Stage 1 onward — Ctrl+Z covered
   them and a second recovery system looked like complexity for its own
   sake. Afnan sent Milanote's own trash (a rail button, Deleted by me /
   Deleted by others, day groups, Empty trash) and asked for BOTH: undo
   AND a trash. He is right that they answer different questions — Ctrl+Z
   is "that was a mistake, just now", the trash is "where did that card go
   last Tuesday". One keystroke of history cannot answer the second.

   Four decisions hold this together:

   1. A SUBCOLLECTION, not an array on the board document. `unsorted` is a
      plain array because one person fills their own tray; a trash has a
      "Deleted by others" tab by definition, and the Stage 6 merge is
      per CARD — two people deleting at once would each rewrite a whole
      array and the later write would silently drop the other's entry.
      One document per deleted card makes concurrent deletes independent.
      It also keeps a growing pile of deleted cards out of the document
      that gets rewritten on every autosave.
   2. AN ENTRY IS HIDDEN WHEN ITS CARD IS BACK ON THE BOARD, and nothing
      is written to make that true (`_boardsTrashLive`). That is what lets
      Ctrl+Z and the trash coexist: undo restores the card under its own
      id, the entry stops matching, and the row disappears with no write,
      no coupling to the undo stack and no way for the two to disagree.
      Same discipline as nesting, frame membership and a stale columnId.
   3. CARDS ARE ENCODED ON THE WAY IN. A table's `rows` is a nested array
      and Firestore refuses those outright — the bug that meant table
      content never persisted at all. A trashed table is the same shape,
      so it goes through the same `_boardsEncodeRows`/`_boardsDecodeCard`
      boundary.
   4. THE LINES COME BACK TOO. Deleting a card drops the connectors
      touching it; if restore did not carry them, "restore" would quietly
      return a different card from the one that went. They are stored on
      the entry and re-added only where BOTH endpoints are on the board
      and the line is not already there — so restoring two ends of the
      same line, in either order, restores it exactly once. */
const _BOARDS_TRASH_LIMIT=200;
let _boardsCardTrash=[],_boardsCardTrashUnsub=null,_boardsCardTrashOpen=false,_boardsCardTrashTab='mine';
function _boardsTrashStart(boardId){
  if(!_boardsLive())return;
  try{
    _boardsCardTrashUnsub=onSnapshot(query(collection(db,'mood_boards',boardId,'trash'),orderBy('at','desc'),limit(_BOARDS_TRASH_LIMIT)),snap=>{
      _boardsCardTrash=[];
      snap.forEach(d=>_boardsCardTrash.push({id:d.id,...d.data()}));
      _boardsPaintTrashCount();
      if(_boardsCardTrashOpen)_boardsRenderTrash();
    },()=>{});
  }catch(e){/* the board must open with or without a trash */}
}
// Entries whose card is back on the board are not shown — see decision 2.
// An entry with no readable card at all is dropped rather than rendered as
// a blank row; there is nothing a person could do with it.
function _boardsTrashLive(){
  const here=new Set(_editCards.map(c=>c.id));
  return _boardsCardTrash.filter(e=>e&&e.card&&e.card.id&&!here.has(e.card.id));
}
function _boardsTrashMine(e){return !!(session&&e.byUid===session.uid);}
function _boardsTrashTabRows(tab){
  return _boardsTrashLive().filter(e=>tab==='mine'?_boardsTrashMine(e):!_boardsTrashMine(e));
}
// Day headers, matching the panel Afnan sent: Today / Yesterday / a date.
function _boardsTrashDay(at){
  const d=new Date(at||0),now=new Date();
  const day=x=>new Date(x.getFullYear(),x.getMonth(),x.getDate()).getTime();
  const diff=Math.round((day(now)-day(d))/86400000);
  if(diff<=0)return'Today';
  if(diff===1)return'Yesterday';
  return d.toLocaleDateString(undefined,{day:'numeric',month:'short'})+(d.getFullYear()===now.getFullYear()?'':' '+d.getFullYear());
}
/* Send cards to the trash. Called from the delete paths with the cards AND
   the connectors that were attached to them, captured BEFORE _editConnectors
   is filtered — afterwards there is nothing left to record.

   Deliberately fire-and-forget: a failed trash write must not fail the
   delete, because Ctrl+Z is still there and the card is already gone from
   the board. One batch, so a twelve-card delete is one round trip. */
function _boardsTrashPut(cards,conns){
  if(!_editBoard||!session||!Array.isArray(cards)||!cards.length)return;
  const at=Date.now(),byUid=session.uid||'',byName=session.name||'Someone';
  const all=Array.isArray(conns)?conns:[];
  try{
    const col=collection(db,'mood_boards',_editBoard.id,'trash');
    const rows=cards.map(c=>{
      const plain={};
      Object.keys(c).forEach(k=>{if(k.charAt(0)!=='_')plain[k]=c[k];});
      return{
        card:_boardsEncodeRows(plain),
        conns:all.filter(cn=>cn&&(cn.from===c.id||cn.to===c.id)),
        byUid,byName,at
      };
    });
    if(typeof writeBatch==='function'&&rows.length>1){
      const b=writeBatch(db);
      rows.forEach(r=>b.set(doc(col),r));
      _boardsQuietWrite(()=>b.commit()).catch(e=>console.warn('[boards] trash write failed',e));
    }else{
      rows.forEach(r=>_qAdd(col,r).catch(e=>console.warn('[boards] trash write failed',e)));
    }
  }catch(e){console.warn('[boards] trash write failed',e);}
}
// The connectors a set of card ids owns, for _boardsTrashPut. A line
// between two cards that are BOTH going is recorded on both entries; the
// restore guard is what stops it coming back twice.
function _boardsConnsTouching(ids){
  const set=ids instanceof Set?ids:new Set(ids);
  return _editConnectors.filter(cn=>cn&&(set.has(cn.from)||set.has(cn.to)));
}
/* ── The trash badge fills up, and then it asks (Sept 2026) ────────────
   Afnan: the number gets darker as the count rises — white through a
   gradient of phases to red — and at 30 the bin animates to say empty me,
   with a way to ignore that for 24 hours.

   PHASES, NOT A CONTINUOUS GRADIENT. Four discrete steps are auditable and
   MEASURABLE: each one is a class the layout probe can render and check for
   contrast in both themes, where a per-count interpolated colour could only
   ever be spot-checked. _boardsTrashPhase is the single definition, so the
   badge, the panel and the tests cannot disagree about what "nearly full"
   means. */
const _BOARDS_TRASH_FULL=30;          // where the bin starts asking
const _BOARDS_TRASH_PHASES=[
  {at:0, cls:''},                     // the badge exactly as it was
  {at:10,cls:'fill-1'},
  {at:20,cls:'fill-2'},
  {at:_BOARDS_TRASH_FULL,cls:'fill-3'}
];
function _boardsTrashPhase(n){
  let cls='';
  for(const p of _BOARDS_TRASH_PHASES)if(n>=p.at)cls=p.cls;
  return cls;
}
/* THE SNOOZE IS PER VIEWER AND PER BOARD, in localStorage — the same rule
   the minimap, snap and the tray's open state follow. It is about this
   person being nagged on this board, not about the board, so it must never
   travel to someone else's screen; and a board's trash is its own, so one
   global snooze would silence a board you have not looked at.
   Expired entries are pruned on write, so the key cannot grow forever. */
const _BOARDS_TRASH_SNOOZE_KEY='groovy-boards-trash-snooze';
const _BOARDS_TRASH_SNOOZE_MS=24*60*60*1000;
function _boardsTrashSnoozeMap(){
  try{const m=JSON.parse(localStorage.getItem(_BOARDS_TRASH_SNOOZE_KEY)||'{}');
    return (m&&typeof m==='object'&&!Array.isArray(m))?m:{};}catch(e){return {};}
}
function _boardsTrashSnoozedUntil(id){
  const t=_boardsTrashSnoozeMap()[id];
  return (typeof t==='number'&&t>Date.now())?t:0;
}
function _boardsTrashSnoozed(){
  return !!(_editBoard&&_boardsTrashSnoozedUntil(_editBoard.id));
}
/* WHETHER THE BIN SHOULD ASK, extracted from the painting so it can be
   asserted at all: the node harness's querySelector returns null, so
   _boardsPaintTrashCount bails there and no logic suite can reach the
   decision through it. Same reason _boardsPreviewBackdrop was pulled out of
   its overlay. */
function _boardsTrashAlarm(n){
  return n>=_BOARDS_TRASH_FULL&&!_boardsTrashSnoozed();
}
window.boardsTrashSnooze=function(){
  if(!_editBoard)return;
  const now=Date.now(),m=_boardsTrashSnoozeMap(),next={};
  Object.keys(m).forEach(k=>{if(typeof m[k]==='number'&&m[k]>now)next[k]=m[k];});
  next[_editBoard.id]=now+_BOARDS_TRASH_SNOOZE_MS;
  try{localStorage.setItem(_BOARDS_TRASH_SNOOZE_KEY,JSON.stringify(next));}catch(e){}
  _boardsPaintTrashCount();
  _boardsRenderTrash();
  showToast('The bin will stop asking for 24 hours');
};
function _boardsPaintTrashCount(){
  const el=document.querySelector('#board-rail [data-act="trash"] .board-rail-badge');
  if(!el)return;
  const n=_boardsTrashLive().length;
  el.textContent=n?String(n):'';
  el.style.display=n?'':'none';
  el.className='board-rail-badge'+(n?' '+_boardsTrashPhase(n):'').trimEnd();
  /* THE SHAKE IS ON THE BUTTON, NOT THE BADGE — it is the BIN that should
     catch your eye, and a 15px chip twitching on its own reads as a
     rendering fault rather than as a prompt. Driven by a class the paint
     sets, so nothing animates on a timer that could be left running. */
  const btn=el.closest&&el.closest('.rail-btn');
  if(btn)btn.classList.toggle('trash-full',_boardsTrashAlarm(n));
}
window.boardsToggleTrash=function(){
  _boardsCardTrashOpen=!_boardsCardTrashOpen;
  _boardsRenderTrash();
};
window.boardsCloseTrash=function(){
  if(!_boardsCardTrashOpen)return;
  _boardsCardTrashOpen=false;
  _boardsRenderTrash();
};
window.boardsTrashTab=function(tab){_boardsCardTrashTab=tab==='others'?'others':'mine';_boardsRenderTrash();};
function _boardsRenderTrash(){
  const host=document.getElementById('board-ctrash-panel');
  if(!host)return;
  host.style.display=_boardsCardTrashOpen?'flex':'none';
  if(!_boardsCardTrashOpen)return;
  const rows=_boardsTrashTabRows(_boardsCardTrashTab);
  const canEdit=_boardsCanEdit(_editBoard);
  const purgeable=rows.filter(_boardsTrashCanPurge).length;
  // Day headers are emitted as the list is walked, so a day appears once
  // and only where it actually starts — the same rule the cutting
  // registry's day grouping follows.
  let lastDay='';
  const body=rows.map(e=>{
    const day=_boardsTrashDay(e.at);
    const head=day===lastDay?'':`<div class="board-ctrash-day">${_boardsEsc(day)}</div>`;
    lastDay=day;
    return head+`
      <div class="board-ctrash-row">
        <div class="board-ctrash-prev">
          <span class="board-ctrash-kind">${_boardsEsc(_boardsCardNoun(e.card))}</span>
          <span class="board-ctrash-text" id="board-ctrash-t-${_boardsEsc(e.id)}"></span>
        </div>
        <div class="board-ctrash-meta">
          <span id="board-ctrash-by-${_boardsEsc(e.id)}"></span>
          <span>${_boardsEsc(_boardsRelTime(e.at))}</span>
        </div>
        <div class="board-ctrash-actions">
          ${canEdit?`<button class="btn-sm" onclick="window.boardsTrashRestore('${_boardsEsc(e.id)}')">Restore</button>`:''}
          ${_boardsTrashCanPurge(e)?`<button class="btn-sm" onclick="window.boardsTrashPurge('${_boardsEsc(e.id)}')">Delete forever</button>`:''}
        </div>
      </div>`;
  }).join('');
  host.innerHTML=`
    <div class="board-ctrash-tabs">
      <button class="${_boardsCardTrashTab==='mine'?'on':''}" onclick="window.boardsTrashTab('mine')">Deleted by me</button>
      <button class="${_boardsCardTrashTab==='others'?'on':''}" onclick="window.boardsTrashTab('others')">Deleted by others</button>
      <button class="board-ctrash-x" onclick="window.boardsCloseTrash()" title="Close">✕</button>
    </div>
    <div class="board-ctrash-list">
      ${rows.length?body:`<div class="empty">${_boardsCardTrashTab==='mine'?'You haven’t deleted anything on this board.':'Nobody else has deleted anything here.'}</div>`}
    </div>
    ${_boardsTrashNagHTML(rows.length)}
    ${purgeable?`<button class="board-ctrash-empty" onclick="window.boardsTrashEmpty()">Empty trash</button>`:''}`;
  // Card text and the person's name are other people's strings — written
  // in with textContent after the structure exists, never interpolated.
  rows.forEach(e=>{
    const t=document.getElementById('board-ctrash-t-'+e.id);
    if(t)t.textContent=_boardsTrashPreview(e.card);
    const b=document.getElementById('board-ctrash-by-'+e.id);
    if(b)b.textContent=_boardsTrashMine(e)?'You':(e.byName||'Someone');
  });
}
/* The ask, INSIDE the bin, where the person who opened it is already
   looking — and the way to silence it. It says the count rather than
   "the trash is full", because 30 is a nudge and not a limit: nothing
   stops working, and a message implying otherwise would be a lie.
   While snoozed the strip still SHOWS, saying until when; the alarm is
   what is silenced, not the fact. Hiding it outright would leave the
   button with no way back. */
function _boardsTrashNagHTML(n){
  if(n<_BOARDS_TRASH_FULL)return '';
  const until=_editBoard?_boardsTrashSnoozedUntil(_editBoard.id):0;
  if(until){
    return `<div class="board-ctrash-nag snoozed">Not asking again until `+
      `${_boardsEsc(_boardsTrashSnoozeLabel(until))}.</div>`;
  }
  return `<div class="board-ctrash-nag">
      <span>${n} deleted cards are being kept here.</span>
      <button class="btn-sm" onclick="window.boardsTrashSnooze()">Ignore for 24 hours</button>
    </div>`;
}
function _boardsTrashSnoozeLabel(ts){
  try{
    const d=new Date(ts);
    return d.toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'});
  }catch(e){return 'tomorrow';}
}
// What a row shows of the card it is holding. Falls back to the card's own
// name, then to nothing — a row is identified by its type chip and its day
// either way, so an empty note still reads as a row rather than a gap.
function _boardsTrashPreview(card){
  try{
    const txt=String(_boardsCardText(_boardsDecodeCard(card))||'').replace(/\s+/g,' ').trim();
    if(txt)return txt.length>120?txt.slice(0,120)+'…':txt;
  }catch(e){}
  return String((card&&(card.name||card.fileName))||'').trim();
}
// Rules mirror: your own entry, or the board's owner clearing up. An app
// owner can too (the moderation power they already have on a board).
function _boardsTrashCanPurge(e){
  if(!session)return false;
  if(e.byUid===session.uid)return true;
  if(_editBoard&&_editBoard.ownerUid===session.uid)return true;
  return session.role==='owner';
}
window.boardsTrashRestore=async function(id){
  if(!_boardsCanEdit(_editBoard))return;
  const e=_boardsCardTrash.find(x=>x.id===id);
  if(!e||!e.card){showToast('That card is no longer in the trash');return;}
  const card=_boardsDecodeCard({...e.card});
  if(_editCards.some(c=>c.id===card.id)){showToast('That card is already back on the board');return;}
  _boardsPushUndo();
  _editCards.push(card);
  // A line comes back only when both of its cards are here and it is not
  // already drawn — so restoring both ends of one line, in either order,
  // restores it exactly once.
  const here=new Set(_editCards.map(c=>c.id));
  const have=new Set(_editConnectors.map(cn=>cn.id));
  (Array.isArray(e.conns)?e.conns:[]).forEach(cn=>{
    if(!cn||have.has(cn.id))return;
    if(!here.has(cn.from)||!here.has(cn.to))return;
    _editConnectors.push(cn);have.add(cn.id);
  });
  _boardsLayoutColumns();
  _boardsRenderCanvasAndWire();
  _boardsSaveNow();
  _boardsLogBoardActivity('restored a card from the trash');
  showToast(_boardsCardNoun(card)+' restored');
  // The row vanishes on its own the moment the card is back (decision 2),
  // so the document is tidied up behind the render, not in front of it.
  try{await _qDel(doc(db,'mood_boards',_editBoard.id,'trash',id));}catch(err){}
  _boardsRenderTrash();
};
window.boardsTrashPurge=async function(id){
  const e=_boardsCardTrash.find(x=>x.id===id);
  if(!e||!_boardsTrashCanPurge(e))return;
  if(!confirm('Delete this '+_boardsCardNoun(e.card).toLowerCase()+' forever? This cannot be undone.'))return;
  try{await _qDel(doc(db,'mood_boards',_editBoard.id,'trash',id));showToast('Deleted forever');}
  catch(err){showToast('Could not empty that — try again');}
  _boardsRenderTrash();
};
window.boardsTrashEmpty=async function(){
  const rows=_boardsTrashTabRows(_boardsCardTrashTab);
  const mine=rows.filter(_boardsTrashCanPurge);
  if(!mine.length)return;
  const kept=rows.length-mine.length;
  if(!confirm('Delete '+mine.length+' item'+(mine.length===1?'':'s')+' forever? This cannot be undone.'))return;
  try{
    if(typeof writeBatch==='function'){
      const b=writeBatch(db);
      mine.forEach(e=>b.delete(doc(db,'mood_boards',_editBoard.id,'trash',e.id)));
      await _boardsQuietWrite(()=>b.commit());
    }else{
      await Promise.all(mine.map(e=>_qDel(doc(db,'mood_boards',_editBoard.id,'trash',e.id))));
    }
    showToast(kept?'Trash emptied — kept '+kept+' deleted by someone else':'Trash emptied');
  }catch(err){showToast('Could not empty the trash — try again');}
  _boardsRenderTrash();
};
// The canvas is a full-viewport takeover, so the page behind it must not
// scroll — otherwise Android scrolls the whole document and the board's own
// top bar slides off the screen (reported from a real phone, Sept 2026).
function _boardsFullscreen(on){
  try{
    document.body.classList.toggle('board-fullscreen',!!on);
    document.documentElement.classList.toggle('board-fullscreen',!!on);
  }catch(e){}
}
function _boardsTeardown(){
  _boardsFullscreen(false);
  window.boardsCloseSheet();
  if(_editBoard)_boardsSaveNow();
  [_boardsUnsub,_boardsPresenceUnsub,_boardsCommentsUnsub,_boardsActivityUnsub,_boardsCardTrashUnsub].forEach(f=>{try{if(typeof f==='function')f();}catch(e){}});
  _boardsUnsub=_boardsPresenceUnsub=_boardsCommentsUnsub=_boardsActivityUnsub=_boardsCardTrashUnsub=null;
  clearInterval(_boardsPresenceTimer);_boardsPresenceTimer=null;
  clearInterval(_boardsFlushTimer);_boardsFlushTimer=null;
  _boardsPendingRemote=null;
  _boardsPeers=[];_boardsComments=[];_boardsBoardActivity=[];
  _boardsCardTrash=[];_boardsCardTrashOpen=false;
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
      <div><div style="font-weight:700;font-size:15px">Share this board</div>
      <div style="font-size:12.5px;color:var(--muted);margin-top:2px">People you pick can open and edit it, even while it stays PRIVATE.</div></div>
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
    if(it.tabs)return`<div class="board-ctx-tabs">${it.tabs.map(t=>`<button class="board-ctx-tab${t.on?' on':''}" data-act="${t.act}">${_boardsEsc(t.label)}</button>`).join('')}</div>`;
    if(it.note)return`<div class="board-ctx-note">${_boardsEsc(it.note)}</div>`;
    if(it.swatches)return`<div class="board-ctx-swatches">${_BOARDS_COLORS.map(c=>`<button class="board-swatch sw-${c}${it.current===c?' on':''}" data-act="color:${c}" title="${c==='none'?'No colour':c}"></button>`).join('')}</div>`;
    if(it.bgSwatches)return`<div class="board-ctx-swatches">${_BOARDS_COLORS.map(c=>`<button class="board-swatch bg-${c}${it.current===c?' on':''}" data-act="bg:${c}" title="${c==='none'?'No background':c}"></button>`).join('')}</div>`;
    if(it.connSwatches)return`<div class="board-ctx-swatches">${_BOARDS_COLORS.map(c=>`<button class="board-swatch sw-${c}" data-act="ln:c:${c}" title="${c==='none'?'Default':c}"></button>`).join('')}</div>`;
    return`<button class="board-ctx-item${it.danger?' danger':''}" data-act="${it.act}">${_boardsEsc(it.label)}${it.hint?`<span class="board-ctx-hint">${_boardsEsc(it.hint)}</span>`:''}</button>`;
  }).join('');
}
function _boardsOpenCtx(clientX,clientY,items,galleryId,opts){
  _boardsCloseCtx();
  // `items` may be a FUNCTION and opts.keep true: the menu then rebuilds
  // itself after each action instead of closing — the colour panel, where
  // a pick must not throw the panel away.
  const build=()=>typeof items==='function'?items():items;
  const keep=!!(opts&&opts.keep);
  const el=document.createElement('div');
  el.id=_BOARDS_CTX_ID;
  el.className='board-ctx';
  el.innerHTML=_boardsCtxHTML(build());
  // While a note is being formatted the menu must not take focus, or the
  // selection it is about to format is gone before the command runs.
  el.addEventListener('mousedown',ev=>{if(_boardsFmtActive())ev.preventDefault();});
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
    if(keep){
      _boardsCtxRun(act);
      if(el.parentNode)el.innerHTML=_boardsCtxHTML(build());
      return;
    }
    _boardsCloseCtx();
    // Gallery actions work on a board BY ID; canvas actions work on the
    // open board. One menu renderer, two routers.
    if(act.indexOf('g:')===0)_boardsGalleryCtxRun(act,galleryId);
    else _boardsCtxRun(act);
  });
}
function _boardsCtxRun(act){
  if(!_editBoard)return;
  if(act.indexOf('fmt:')===0){_boardsFmtAct(act.slice(4));return;}
  const at=_boardsCtxWorld;
  const place=()=>{if(at)_boardsNextPlacement={x:at.x,y:at.y};};
  if(act.indexOf('add:')===0){place();window.boardsAddCard(act.slice(4));return;}
  if(act.indexOf('color:')===0){window.boardsSetColor(act.slice(6));return;}
  if(act.indexOf('bg:')===0){window.boardsSetBg(act.slice(3));return;}
  if(act.indexOf('colortab:')===0){_boardsColorTab=act.slice(9)==='strip'?'strip':'bg';return;}
  if(act==='color-panel'){window.boardsOpenColorPanel();return;}
  if(act==='todoc'){window.boardsConvertToDocument();return;}
  if(act.indexOf('ln:')===0){_boardsConnAction(act.slice(3));return;}
  if(act.indexOf('cellbg:')===0){window.boardsCellColor(act.slice(7));return;}
  if(act==='more-tools'){window.boardsMoreTools();return;}
  if(act==='imagepanel'){window.boardsOpenImagePanel();return;}
  if(act==='trash'){window.boardsToggleTrash();return;}
  if(act.indexOf('cellfx:')===0){
    const w=act.slice(7);
    if(w==='__help')window.boardsCellFormulaHelp();
    else window.boardsCellInsertFormula(w);
    return;
  }
  if(act.indexOf('celltype:')===0){window.boardsCellSetType(act.slice(9));return;}
  if(act.indexOf('cellfmt:')===0){
    const bits=act.slice(8).split(':');
    window.boardsCellSetFmt(bits[0],bits.slice(1).join(':'));
    return;
  }
  if(act.indexOf('cell:')===0){
    const w=act.slice(5);
    if(w==='done')return window.boardsCellDone();
    if(w==='type')return window.boardsCellTypeMenu();
    if(w==='formula')return window.boardsCellFormulaMenu();
    if(w==='copy'||w==='cut'||w==='paste')return window.boardsCellClip(w);
    if(/^(row-|col-|del-)/.test(w))return window.boardsCellRowCol(w);
    window.boardsCellAction(w);
    return;
  }
  if(act.indexOf('tbl:')===0){
    const one=_boardsSelOne();
    if(!one||one.type!=='table')return;
    const w=act.slice(4);
    if(w==='row')window.boardsTableAdd(one.id,'row');
    else if(w==='col')window.boardsTableAdd(one.id,'col');
    else if(w==='-row')window.boardsTableDrop(one.id,'row');
    else if(w==='-col')window.boardsTableDrop(one.id,'col');
    else if(w==='head')window.boardsTableHeader(one.id);
    return;
  }
  if(act==='connectsel'){window.boardsConnectSelection();return;}
  if(act.indexOf('align:')===0){window.boardsAlignSelection(act.slice(6));return;}
  if(act.indexOf('dist:')===0){window.boardsDistributeSelection(act.slice(5));return;}
  if(act==='stash'){
    const one=_boardsSelectedCards();
    if(one.length===1)window.boardsTrayStash(one[0].id);
    return;
  }
  switch(act){
    case'file':place();window.boardsPickFiles();break;
    case'line':window.boardsToggleLineMode();break;
    case'paste':place();_boardsCtxPaste();break;
    case'selectall':window.boardsSelectAll();break;
    case'fit':window.boardsFitView();break;
    case'reset':window.boardsResetView();break;
    case'comment-board':window.boardsOpenComments(null);break;
    case'card-comment':{const s=_boardsSelectedCards();if(s.length===1)window.boardsOpenComments(s[0].id);break;}
    case'color':{
      _boardsOpenSheet('Colour',`<div class="board-sheet-label">Background</div><div class="board-sheet-swatches">${
        _BOARDS_COLORS.map(c=>`<button class="board-swatch sw-${c}" title="${c==='none'?'No colour':c}" onclick="window.boardsSetBg('${c}');window.boardsCloseSheet()"></button>`).join('')}</div>
        <div class="board-sheet-label">Top strip</div><div class="board-sheet-swatches">${
        _BOARDS_COLORS.map(c=>`<button class="board-swatch sw-${c}" title="${c==='none'?'No colour':c}" onclick="window.boardsSetColor('${c}');window.boardsCloseSheet()"></button>`).join('')}</div>`);
      break;
    }
    case'labels':window.boardsOpenLabels();break;
    case'reactions':window.boardsOpenReactions();break;
    case'more':window.boardsOpenMore();break;
    case'deselect':_boardsSetSelection([]);break;
    case'card-link':window.boardsCopyCardLink();break;
    case'dup':window.boardsDuplicateSelection();break;
    case'front':window.boardsBringToFront();break;
    case'back':window.boardsSendToBack();break;
    case'lock':window.boardsToggleLock();break;
    case'delete':window.boardsDeleteSelection();break;
    case'open-board':{const s=_boardsSelectedCards();if(s.length===1&&s[0].boardId)window.boardsGoto(s[0].boardId);break;}
    case'link-edit':{const s=_boardsSelectedCards();if(s.length===1)window.boardsLinkEdit(s[0].id);break;}
    case'link-preview':{const s=_boardsSelectedCards();if(s.length===1)window.boardsLinkTogglePreview(s[0].id);break;}
    case'link-refresh':{const s=_boardsSelectedCards();if(s.length===1)window.boardsLinkRefresh(s[0].id);break;}
    case'home-trash':{const s=_boardsSelectedCards();if(s.length===1&&s[0].boardId)window.boardsTrashLinkedBoard(s[0].boardId,s[0].id);break;}
    // Both act on the BOARD a card points at, not the card — so they go
    // through the gallery's router, which is the one that speaks board ids.
    case'board-look':{const s=_boardsSelectedCards();if(s.length===1&&s[0].boardId)window.boardsOpenBoardLook(s[0].boardId);break;}
    case'board-rename':{const s=_boardsSelectedCards();if(s.length===1&&s[0].boardId)_boardsGalleryCtxRun('g:rename',s[0].boardId);break;}
    case'cut':case'copy':{
      // Our copy/cut live on the real clipboard events (see _boardsOnCopy),
      // so the menu fires those rather than keeping a second code path.
      let ok=false;
      try{ok=document.execCommand(act);}catch(e){ok=false;}
      if(!ok)showToast('Press Ctrl+'+(act==='cut'?'X':'C')+' to '+act+' these cards');
      break;
    }
    case'replace':{const s=_boardsSelectedCards();if(s.length===1)_boardsReplaceAsset(s[0].id);break;}
    // Through the same two functions the card's own buttons use, so the
    // menu and the card can never behave differently.
    case'download':{const c=_boardsSelOne();if(c&&_boardsAssetUrl())_boardsDownloadAsset(_boardsPreviewCard(c));break;}
    case'openasset':{const c=_boardsSelOne();if(c&&_boardsAssetUrl())_boardsOpenPreview(_boardsPreviewCard(c));break;}
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
      if(c.type==='frame'||c.type==='column'){
        const cls=c.type==='column'?'.board-column-title':'.board-frame-title';
        const el=document.querySelector('#board-card-'+c.id+' '+cls);
        if(el){el.focus();try{el.select();}catch(e){}}
        break;
      }
      if(c.type==='heading'){
        window.boardsBeginEdit(null,'board-txt-'+c.id);
        break;
      }
      // Every other card renames through the editable label in its header.
      // boardsBeginEdit turns the element editable AND focuses it; a bare
      // focus() does nothing on a contenteditable="false" node, which is
      // what made Rename and Caption look like they simply did not save.
      window.boardsBeginEdit(null,'board-name-'+c.id);
      try{
        const el=document.getElementById('board-name-'+c.id);
        if(el){
          const r=document.createRange();
          r.selectNodeContents(el);
          const sel2=window.getSelection();
          sel2.removeAllRanges();
          sel2.addRange(r);
        }
      }catch(e){/* opening edit mode is the part that matters */}
      break;
    }
    case'selectinside':{
      const s=_boardsSelectedCards();
      if(s.length!==1)break;
      // A frame answers this geometrically, a column from its stored
      // membership — the one place the two containers genuinely differ.
      const inside=(s[0].type==='column'?_boardsColumnChildren(s[0])
        :s[0].type==='frame'?_boardsCardsInFrame(s[0]):[]).map(c=>c.id);
      if(!inside.length){showToast('Nothing inside that '+(s[0].type==='column'?'column':'frame'));break;}
      _boardsSetSelection(inside);
      break;
    }
    case'col-release':window.boardsReleaseColumn();break;
    case'col-delete-all':window.boardsDeleteColumnAndCards();break;
    case'col-out':{
      const s=_boardsSelectedCards().filter(c=>_boardsColumnOf(c));
      if(!s.length)break;
      _boardsPushUndo();
      // Set down to the right of the column it came from, so it does not
      // land underneath and read as having vanished.
      s.forEach(c=>{
        const col=_boardsColumnOf(c);
        if(col)c.x=col.x+col.w+_BOARDS_COL_GAP*2;
        _boardsLeaveColumn(c);
      });
      _boardsLayoutColumns();
      _boardsRenderCanvasAndWire();
      _boardsSaveDebounced();
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
      if(c.type!=='image'&&c.type!=='file'&&c.type!=='table'){
        showToast('Captions are for images, files and tables');break;}
      if(c.caption==null){
        _boardsPushUndo();
        c.caption='';
        _boardsGrowForChrome(c);
        _boardsRenderCanvasAndWire();
        _boardsSaveDebounced();
      }
      window.boardsBeginEdit(null,'board-cap-'+c.id);
      break;
    }
    case'renameheading':{
      const s=_boardsSelectedCards();
      if(s.length!==1)break;
      window.boardsBeginEdit(null,'board-txt-'+s[0].id);
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
  // Ctrl+V no longer places — it collects — so this can't promise "here".
  if(!text){showToast('Press Ctrl+V to collect an image or text in Unsorted');return;}
  if(text.indexOf(_BOARDS_CLIP_LINE_PREFIX)===0){
    try{
      const ls=JSON.parse(text.slice(_BOARDS_CLIP_LINE_PREFIX.length));
      if(_boardsPasteLines(ls))return;
    }catch(e){/* fall through to plain text */}
  }
  if(text.indexOf(_BOARDS_CLIP_PREFIX)===0){
    try{
      const cards=JSON.parse(text.slice(_BOARDS_CLIP_PREFIX.length));
      if(_boardsPasteCards(cards))return;
    }catch(e){/* fall through to plain text */}
  }
  _boardsPlaceText(text);
}
/* Text pasted straight onto the canvas as a link or a note card.
   Pulled out of _boardsCtxPaste so HOME can reuse it: Home has no Unsorted
   to collect into, so a paste there places. Two copies of "turn this string
   into a card" would disagree the first time one of them learned something
   — the rule the rail and the right-click menu already share a router for. */
function _boardsPlaceText(text){
  const trimmed=String(text||'').trim();
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
  if(isUrl)_boardsLinkHydrate(c.id);
  showToast(isUrl?'Link added':'Note added');
  return c;
}
// The URL behind the one selected card, whatever kind it is.
// The preview/download helpers read `fileUrl`; an image card keeps its URL
// in `imageUrl` and a link card in `linkUrl`. One adapter rather than three
// branches inside each helper.
function _boardsPreviewCard(c){
  const url=c.type==='image'?(c.imageUrl||''):c.type==='file'?(c.fileUrl||''):c.type==='link'?(c.linkUrl||''):'';
  return{...c,fileUrl:url,fileName:c.fileName||(c.type==='image'?_boardsUrlTail(url):'')};
}
function _boardsUrlTail(u){
  const s=String(u||'').split('?')[0];
  return s.slice(s.lastIndexOf('/')+1);
}
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
/* ── Opening and downloading an attachment ──────────────────────────────
   Both used to be window.open() on a Cloudinary URL, and both were wrong in
   the same way: NAVIGATING to an asset hands the whole outcome to the
   browser. Afnan saw Chrome's own error pages — "Failed to load PDF
   document" on Open, ERR_INVALID_RESPONSE on Download — with nothing to act
   on and no clue whose fault it was.

   Milanote's preview is not a custom PDF renderer: it is the browser's own
   viewer in an iframe, which is where its page thumbnails, page counter,
   zoom, rotate, print and download all come from. So this fetches the bytes
   once and hands the browser a blob: URL. That buys three things at once:
     - the same native viewer, with no new dependency (pdf.js is one);
     - a Download that opens the real Save-as dialog under the CARD's name,
       which is what Milanote saves as — an <a download> to a cross-origin
       URL is ignored by Chrome, a blob: one is honoured;
     - a readable error. A failed fetch has a STATUS, so "Cloudinary refused
       this (401)" can be said out loud instead of leaving a Chrome error
       page to be interpreted.

   Not verified from here: this sandbox cannot reach res.cloudinary.com at
   all (see CLAUDE.md). The behaviour above is reasoned from the delivery
   URL and the screenshots, not observed. */
const _BOARDS_IMG_EXT=['jpg','jpeg','png','gif','webp','svg','bmp','avif'];
function _boardsAssetExt(c){
  const s=String((c&&c.fileName)||(c&&c.fileUrl)||'');
  const m=s.split('?')[0].match(/\.([A-Za-z0-9]{1,8})$/);
  return m?m[1].toLowerCase():'';
}
// Milanote saves under the card's title, not the opaque upload id. So do we,
// falling back to the original filename. Strips the characters Windows
// refuses in a filename, or the Save-as dialog rejects the name outright.
function _boardsSaveNameFor(c){
  const ext=_boardsAssetExt(c);
  const raw=String((c&&c.fileName)||'').replace(/\.[^.]+$/,'');
  let base=String((c&&c.name)||raw||'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();
  if(!base)base='file';
  return ext?base+'.'+ext:base;
}
async function _boardsFetchAsset(url,onProgress){
  try{
    const res=await fetch(url,{mode:'cors',credentials:'omit'});
    if(!res.ok)return{ok:false,status:res.status};
    /* Read through the STREAM when somebody is listening, so the wait can
       be reported instead of just endured. A response with no readable
       body, or no Content-Length to measure against, falls straight back to
       blob(): a progress number that cannot move is worse than none, and
       the caller's indeterminate shimmer already says "working". */
    const total=Number(res.headers.get('content-length')||0);
    if(!onProgress||!res.body||!res.body.getReader||!total)return{ok:true,blob:await res.blob()};
    const reader=res.body.getReader();
    const parts=[];let got=0;
    for(;;){
      const step=await reader.read();
      if(step.done)break;
      parts.push(step.value);
      got+=step.value.length;
      onProgress(Math.min(1,got/total));
    }
    return{ok:true,blob:new Blob(parts,{type:res.headers.get('content-type')||''})};
  }catch(e){return{ok:false,err:(e&&(e.message||e))||'network error'};}
}
// What a failure most likely means, said plainly. A 401 or 403 on a PDF
// whose page-1 thumbnail renders perfectly well is Cloudinary's "deliver PDF
// and ZIP files" account setting, not a broken file and not a broken URL —
// the thumbnail proves Cloudinary can read the document and is choosing not
// to serve it.
function _boardsAssetErrorText(r,isPdf){
  if(r.status===401||r.status===403){
    return'Cloudinary refused this file ('+r.status+').'+
      (isPdf?' Delivery of PDF and ZIP files is switched off on the account — turn it on in the Cloudinary console under Settings → Security, "Allow delivery of PDF and ZIP files". The page-1 preview on the card still works because that is served as an image.':'');
  }
  if(r.status)return'The file could not be fetched (HTTP '+r.status+').';
  return'The file could not be fetched: '+r.err+'. If you are offline, it has not been cached yet.';
}
let _boardsPreviewUrl=null;
function _boardsClosePreview(){
  const el=document.getElementById('board-preview');
  if(el)el.remove();
  if(_boardsPreviewUrl){try{URL.revokeObjectURL(_boardsPreviewUrl);}catch(e){}_boardsPreviewUrl=null;}
  document.removeEventListener('keydown',_boardsPreviewKey,true);
}
function _boardsPreviewKey(e){if(e.key==='Escape'){e.stopPropagation();_boardsClosePreview();}}
/* What counts as a click on the BACKDROP of the preview.

   This used to be `e.target===wrap`, which is essentially never true: the
   wrap is a flex column completely covered by its own bar plus
   .board-preview-body, which is `flex:1`. So the dark space around the
   picture IS the body, the wrap has no exposed pixels of its own, and the
   backdrop close had been dead since it shipped — reported as "when i click
   on the grid to close it does not close, it closes by just clicking on
   cross on the top right".

   Named and extracted rather than inlined so it can be asserted: the
   overlay is built with createElement and querySelector, which the node
   harness stubs out, so the predicate is the only part that CAN be tested
   without a browser. The picture, the PDF iframe and the top bar are all
   deliberately NOT backdrop — clicking the thing you came to look at must
   never dismiss it. */
function _boardsPreviewBackdrop(t,wrap){
  if(!t)return false;
  if(t===wrap)return true;
  return !!(t.classList&&t.classList.contains('board-preview-body'));
}
window.boardsClosePreview=_boardsClosePreview;
async function _boardsOpenPreview(c){
  _boardsClosePreview();
  const name=_boardsSaveNameFor(c);
  const ext=_boardsAssetExt(c);
  const isPdf=ext==='pdf';
  const isImg=_BOARDS_IMG_EXT.indexOf(ext)>=0;
  const wrap=document.createElement('div');
  wrap.id='board-preview';
  wrap.className='board-preview';
  wrap.innerHTML=
    '<div class="board-preview-bar">'+
      '<span class="board-preview-name" id="board-preview-name"></span>'+
      '<span class="board-preview-acts">'+
        '<button class="tool-btn" id="board-preview-dl">Download</button>'+
        '<button class="tool-btn" id="board-preview-tab">Open in new tab</button>'+
        '<button class="tool-btn" id="board-preview-x" title="Close (Esc)">✕</button>'+
      '</span>'+
    '</div>'+
    '<div class="board-preview-body" id="board-preview-body"><div class="board-preview-msg">Loading…</div></div>';
  // The filename is a user string like every other one in this file.
  document.body.appendChild(wrap);
  wrap.querySelector('#board-preview-name').textContent=name;
  wrap.querySelector('#board-preview-x').onclick=_boardsClosePreview;
  wrap.querySelector('#board-preview-tab').onclick=()=>window.open(c.fileUrl,'_blank','noopener');
  wrap.querySelector('#board-preview-dl').onclick=()=>_boardsDownloadAsset(c);
  wrap.addEventListener('pointerdown',e=>{if(_boardsPreviewBackdrop(e.target,wrap))_boardsClosePreview();});
  document.addEventListener('keydown',_boardsPreviewKey,true);

  const body=wrap.querySelector('#board-preview-body');
  const r=await _boardsFetchAsset(c.fileUrl);
  if(!document.getElementById('board-preview'))return;   // closed while loading
  if(!r.ok){
    const msg=document.createElement('div');
    msg.className='board-preview-msg';
    msg.textContent=_boardsAssetErrorText(r,isPdf);
    body.innerHTML='';body.appendChild(msg);
    return;
  }
  _boardsPreviewUrl=URL.createObjectURL(r.blob);
  body.innerHTML='';
  if(isImg){
    const img=document.createElement('img');
    img.className='board-preview-img';img.src=_boardsPreviewUrl;img.alt='';
    body.appendChild(img);
  }else if(isPdf){
    // The browser's built-in viewer, which brings page thumbnails, the page
    // counter, zoom, rotate, print and its own download with it.
    const f=document.createElement('iframe');
    f.className='board-preview-frame';f.src=_boardsPreviewUrl;f.title=name;
    body.appendChild(f);
  }else{
    const msg=document.createElement('div');
    msg.className='board-preview-msg';
    msg.textContent='No preview for this file type — use Download.';
    body.appendChild(msg);
  }
}
/* ── "Preparing to download…" (Sept 2026) ─────────────────────────────
   Afnan: the Save-as dialog took a while, so he pressed Download again and
   got the file twice.

   WHY IT WAITS, and it is structural rather than a bug: an <a download>
   pointing at a CROSS-ORIGIN url is ignored by Chrome — it navigates
   instead — so the only way to hand the browser a filename WE choose is to
   fetch the bytes ourselves and make a same-origin blob: url out of them.
   The dialog therefore cannot appear until the whole file has arrived, and
   the card shows a sized derivative while the download takes the ORIGINAL,
   so nothing is warm in the cache either. Holding the bytes is what buys
   the name; the wait is the price of it.

   So the wait is made VISIBLE and the second press is refused. One
   download per card at a time — the id is the key, so the same file
   reached from the card button, the rail and the right-click menu is still
   one download. */
const _boardsDownloading=new Set();
/* The overlay and its text node are held by card id rather than looked up
   again on every progress tick — a querySelector per chunk of a 12 MB photo
   is a lot of DOM work for one number. Known limit: a STRUCTURAL render
   (someone adds a card) rebuilds the canvas and the held node goes with it,
   so the overlay disappears while the download carries on. The download
   still completes and the guard still holds; only the cover is lost. */
const _boardsBusy=new Map();
function _boardsBusyStart(id,label){
  if(!id)return;
  const el=document.getElementById('board-card-'+id);
  if(!el)return;
  const o=document.createElement('div');
  o.className='board-card-busy';
  const t=document.createElement('div');
  t.className='board-card-busy-text';
  // textContent, never interpolated — same boundary as every other string
  // this file puts on a card.
  t.textContent=label;
  o.appendChild(t);
  el.appendChild(o);
  _boardsBusy.set(id,{o,t});
}
function _boardsBusyProgress(id,frac,label){
  const b=_boardsBusy.get(id);
  if(b)b.t.textContent=label+' '+Math.round(frac*100)+'%';
}
function _boardsBusyStop(id){
  const b=_boardsBusy.get(id);
  if(!b)return;
  _boardsBusy.delete(id);
  try{b.o.remove();}catch(e){}
}
async function _boardsDownloadAsset(c){
  const id=(c&&c.id)||'';
  if(id&&_boardsDownloading.has(id)){
    showToast('Already preparing that download — it will start on its own');
    return false;
  }
  const label='Preparing to download…';
  if(id){_boardsDownloading.add(id);_boardsBusyStart(id,label);}
  try{
    const name=_boardsSaveNameFor(c);
    const r=await _boardsFetchAsset(c.fileUrl,id?(f=>_boardsBusyProgress(id,f,label)):null);
    if(!r.ok){
      showToast(_boardsAssetErrorText(r,_boardsAssetExt(c)==='pdf'),true);
      // Last resort: ask the host for an attachment and let the browser try.
      window.open(_boardsDownloadUrl(c.fileUrl),'_blank','noopener');
      return false;
    }
    const href=URL.createObjectURL(r.blob);
    const a=document.createElement('a');
    a.href=href;a.download=name;a.style.display='none';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{try{URL.revokeObjectURL(href);}catch(e){}a.remove();},10000);
    return true;
  }finally{
    // Always, on every path — a card left wearing the overlay would be
    // unusable with nothing on screen to say why.
    if(id)_boardsDownloading.delete(id);
    _boardsBusyStop(id);
  }
}
// Card-addressed versions of the right-click menu's Open/Download, for the
// buttons on the file card itself. They take an id rather than reading the
// selection, because clicking a button on a card that isn't selected must
// still act on THAT card.
window.boardsFileOpen=function(id){
  const c=(_editCards||[]).find(x=>x.id===id);
  if(c&&c.fileUrl)_boardsOpenPreview(c);
};
// Any card type, via the adapter — what a double-clicked image card uses.
window.boardsFilePreview=function(id){
  const c=(_editCards||[]).find(x=>x.id===id);
  if(!c)return;
  const pc=_boardsPreviewCard(c);
  if(pc.fileUrl)_boardsOpenPreview(pc);
};
window.boardsFileDownload=function(id){
  const c=(_editCards||[]).find(x=>x.id===id);
  if(c&&c.fileUrl)_boardsDownloadAsset(c);
};
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
    {act:'add:column',label:'New column'},
    {act:'add:table',label:'New table'},
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
  if(canEdit&&one){
    items.push({sep:true});
    items.push({act:'labels',label:(Array.isArray(one.labels)&&one.labels.length)?'Labels…':'Add a label…'});
    items.push({act:'reactions',label:'React…'});
    // The reverse of dragging one out of the tray: take it off the board
    // but keep it. Frames and sub-boards are not stashable — a frame has
    // no content of its own, and a board link belongs with its parent.
    if(one.type!=='frame'&&one.type!=='board'&&one.type!=='column'){
      items.push({act:'stash',label:'Move to Unsorted'});
    }
  }

  // ── type-specific ──
  const typed=[];
  if(one&&canEdit&&_boardsColumnOf(one)){
    typed.push({act:'col-out',label:'Take out of column'});
  }
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
      if(canEdit){
        if(one.linkImage)typed.push({act:'link-preview',label:one.linkPreviewOff?'Show the preview picture':'Hide the preview picture'});
        typed.push({act:'link-edit',label:'Edit link details'});
        typed.push({act:'link-refresh',label:'Refresh preview'});
      }
    }else if(one.type==='board'&&one.boardId){
      typed.push({act:'open-board',label:'Open this board'});
      if(canEdit){
        typed.push({act:'board-look',label:'Board picture…'});
        typed.push({act:'board-rename',label:'Rename the board…'});
      }
      typed.push({act:'copyasset',label:'Copy link to board'});
      // ✕ takes a board off Home now, so trashing the board itself needs a
      // route of its own — named so the two cannot be confused.
      if(canEdit&&_boardsIsHome(_editBoard))typed.push({act:'home-trash',label:'Move board to Trash…',danger:true});
    }else if(one.type==='column'){
      if(canEdit)typed.push({act:'rename',label:'Rename column',hint:'Return'});
      typed.push({act:'selectinside',label:'Select contents'});
      if(canEdit){
        typed.push({act:'col-release',label:'Ungroup (keep the cards)'});
        typed.push({act:'col-delete-all',label:'Delete column and its cards',danger:true});
      }
    }else if(one.type==='frame'){
      if(canEdit)typed.push({act:'rename',label:'Rename frame',hint:'Return'});
      typed.push({act:'selectinside',label:'Select contents'});
    }else if(one.type==='table'&&canEdit){
      typed.push({act:'tbl:row',label:'Add a row'});
      typed.push({act:'tbl:col',label:'Add a column'});
      typed.push({act:'tbl:-row',label:'Remove last row'});
      typed.push({act:'tbl:-col',label:'Remove last column'});
      typed.push({act:'tbl:head',label:one.head===false?'Use a header row':'No header row'});
    }else if(one.type==='todo'&&canEdit){
      typed.push({act:'tickall',label:'Tick all'});
      typed.push({act:'untickall',label:'Untick all'});
    }else if(one.type==='text'&&one.text){
      typed.push({act:'copytext',label:'Copy text'});
      if(canEdit)typed.push({act:'todoc',label:'Convert to Document'});
    }
  }
  if(typed.length){items.push({sep:true});typed.forEach(t=>items.push(t));}

  items.push({sep:true});
  items.push({act:'card-comment',label:'Comment'});
  if(one)items.push({act:'card-link',label:'Copy link to card'});

  if(canEdit){
    items.push({sep:true});
    if(sel.length>1){
      // Milanote's wording for this, so anyone coming from it finds the
      // action. It builds a REAL container — see "Column is a real
      // container"; this used to be the arrange-once `stack` and the
      // comment here still said so long after that changed.
      items.push({act:'connectsel',label:'Connect with Lines'});
      items.push({act:'stack',label:'Group into Column'});
      items.push({act:'grid',label:'Arrange in a grid'});
      items.push({act:'wrapframe',label:'Wrap in a frame'});
      items.push({sep:true});
      // Milanote puts Alignment and Distribute in the selection rail; the
      // rail and this menu render the same list, so they land in both.
      items.push({act:'align:left',label:'Align left'});
      items.push({act:'align:hcenter',label:'Align centre'});
      items.push({act:'align:right',label:'Align right'});
      items.push({act:'align:top',label:'Align top'});
      items.push({act:'align:vcenter',label:'Align middle'});
      items.push({act:'align:bottom',label:'Align bottom'});
      if(sel.length>2){
        items.push({act:'dist:h',label:'Distribute horizontally'});
        items.push({act:'dist:v',label:'Distribute vertically'});
      }
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
    // "you", not your own name, when it is yours — the spec's wording, and
    // the one that reads like a person wrote it.
    const mine=(typeof session!=='undefined'&&session&&session.name)===one.by;
    items.push({title:'Added by '+(mine?'you':one.by)+(one.at?' · '+_boardsRelTime(one.at):'')});
  }
  return items;
}
function _boardsWireContextMenu(stage){
  stage.addEventListener('contextmenu',e=>{
    const t0=e.target;
    // A TABLE CELL is read before the editable bail below, and it is the
    // only place in this file that takes the menu back from the browser
    // while text is editable. Everywhere else — a note body, a to-do item,
    // an input — the browser's menu wins, because spellcheck and text
    // copy/paste belong to it while you are writing prose. A spreadsheet
    // cell is not prose: row and column operations are what a right-click
    // there is for. Right-clicking a cell FOCUSES it first, the same rule
    // a right-click on an unselected card or line already follows.
    const tdEl=t0&&t0.closest&&t0.closest('td.board-td,th.board-td');
    if(tdEl&&_boardsCanEdit(_editBoard)){
      const m=/^board-td-(.+)-(\d+)-(\d+)$/.exec(tdEl.id||'');
      const host=tdEl.closest('.board-card-el');
      const hostId=host&&host.getAttribute('data-id');
      if(m&&hostId&&m[1]===hostId){
        const r=parseInt(m[2],10),i=parseInt(m[3],10);
        e.preventDefault();
        _boardsCtxWorld=_boardsScreenToWorld(e.clientX,e.clientY);
        if(!_boardsSelection.has(hostId))_boardsSetSelection([hostId]);
        _boardsCellFocus={id:hostId,r:r,i:i};
        _boardsRenderRail();
        _boardsPaintCellFocus();
        const card=_editCards.find(x=>x.id===hostId);
        _boardsOpenCtx(e.clientX,e.clientY,_boardsCellCtxItems(card||{},r,i));
        return;
      }
    }
    // Editing text? The browser's menu is the right one.
    if(_boardsIsEditableFocus())return;
    const t=e.target;
    if(t&&t.closest&&t.closest('input,textarea,[contenteditable="true"]'))return;
    const canEdit=_boardsCanEdit(_editBoard);
    e.preventDefault();
    _boardsCtxWorld=_boardsScreenToWorld(e.clientX,e.clientY);

    // A line gets the same treatment a card does: right-clicking one that
    // is not selected selects it first, so the menu always acts on what
    // you pointed at.
    const line=t&&t.closest&&t.closest('path[data-conn],text[data-conn],circle[data-conn]');
    if(line){
      const id=line.getAttribute('data-conn');
      if(_boardsConnSel!==id)_boardsSelectConn(id);
      const cn=_boardsConnById(id);
      if(cn){_boardsOpenCtx(e.clientX,e.clientY,_boardsConnItems(cn,canEdit));return;}
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
  // One entry, not four: colour, letter/number, icon and picture all fill
  // the same tile and are chosen by comparing them. See boardsOpenBoardLook.
  if(canEdit)items.push({act:'g:look',label:'Board picture…'});
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
    case'g:open':window.boardsOpenFromAll(id);break;
    case'g:color':window.boardsOpenColorPicker('board',id);break;
    case'g:icon':window.boardsOpenIconPicker(id);break;
    case'g:look':window.boardsOpenBoardLook(id);break;
    case'g:cover':window.boardsPickCover(id);break;
    case'g:uncover':_boardsSaveIdentity(id,{coverUrl:null});break;
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

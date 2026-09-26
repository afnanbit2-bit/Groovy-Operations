/* Groovy Operations — theboard.js  ("the board")

   The Board: one shared calendar and one set of task lists, over ONE object
   — an item. An item with a date is on the calendar; an item in a list is a
   to-do; an item can be both. There is deliberately no second model.

   ── WHY EVERYTHING HERE IS PREFIXED `tb` ──────────────────────────────
   js/boards.js (Mood Boards, ~10,400 lines) already owns the word "board"
   in this codebase: page ids `boards` / `boards-all` / `board-canvas`, 259
   `.board-*` CSS classes and ~400 `boards*`/`_boards*` globals. These are
   classic scripts sharing ONE lexical scope, so a top-level `const` or a
   `.board-item` class declared here would not merely be confusing — a
   duplicate top-level `const` across two classic scripts is a parse error
   that takes the whole app down, and `tests/smoke-browser.js` is what
   catches it. So: `tb` for every JS name, `.tb-` for every CSS class,
   `tb-` for every page id. Firestore names do not share JS scope, so the
   collections keep the spec's `board_` prefix and read naturally.

   The two modules are different levels and are not being merged: Mood
   Boards lives inside Creative Hub; The Board is a top-level tab.

   Plain global classic script — NO import/export. Loaded LAST, after
   js/patterns.js. Firebase globals (db, collection, query, ...) are bridged
   onto window by the bootstrap in index.html before __bootApp() runs.

   PHASE 1 lands: the audience gate, routing, the empty screens, the
   day-string helper, and the notification contract. Items, lists, the
   Dashboard cards and the calendar are Phase 2/3. See BOARD.md.
*/

// The one label. If the product is ever renamed, this is the only string
// to change — the nav, the page titles and the empty states all read it.
// "The Board", Title Case, wherever it names the tab or the product
// (session 2 brief s1/s4.5 -- this reverses the spec's lowercase voice).
const TB_NAME='The Board';

// ── Audience ──────────────────────────────────────────────────────────
// BOARD_USERS / BOARD_OWNERS live in js/auth.js beside USER_DEFS, because
// that file is where every other per-person grant in this app is written
// and because firestore.rules mirrors them BY EMAIL (isBoardUser /
// isBoardOwner). A test fails if the two lists ever disagree — the same
// guard isPaidPRApprover() and isScoringAdmin() carry.
//
// js/shared.js loads FIRST and cannot see those names at parse time, so
// every caller there guards with `typeof` and FAILS CLOSED: an auth.js
// that failed to parse hides the tab rather than opening a side door.

// ── Pages ─────────────────────────────────────────────────────────────
// Every page is `tb-*` so ONE line in renderPage routes the whole module
// (the rule js/marketing.js and js/patterns.js already follow) and
// js/shared.js never needs another edit for a page added later.
const TB_PAGES=['tb-dash','tb-calendar','tb-lists','tb-inbox'];
const TB_HOME='tb-dash';
const _TB_RAIL=[
  {id:'tb-dash',     label:'Dashboard', icon:'layout-dashboard'},
  {id:'tb-calendar', label:'Calendar',  icon:'calendar'},
  {id:'tb-lists',    label:'Lists',     icon:'list-todo'},
  {id:'tb-inbox',    label:'Inbox',     icon:'inbox'}
];

// ── Icons (session 2, P1.1) ───────────────────────────────────────────
// Lucide (ISC), 47 glyphs built into ONE vendored sprite by
// scripts/build-lucide-sprite.js -- see assets/vendor/README.md. Used by
// reference, same-origin and precached, so nothing is fetched at runtime
// beyond the app's own files. The icon NAME comes from this file, never
// from user text, and an unknown name draws nothing rather than a broken
// reference. tests/invariants.test.js checks every name used here exists
// in the sprite.
const TB_SPRITE='/assets/vendor/lucide-sprite-1.48.0.svg';
const TB_ICONS=['layout-dashboard','calendar','calendar-days','calendar-plus','calendar-x','inbox','list',
  'list-checks','list-todo','plus','users','user','user-plus','settings','search','circle-help','circle',
  'circle-check','check','star','lock','lock-open','message-circle','paperclip','sun','flag','tag','palette',
  'file-text','sticky-note','trash-2','x','chevron-left','chevron-right','chevron-down','chevron-up',
  'ellipsis','clock','circle-alert','bell','arrow-right-left','send','grip-vertical','eye','eye-off',
  'filter','hand'];
/** `<svg>` for one sprite icon. `size` is '' | 'sm' | 'lg'. Pure. */
function _tbIcon(name,size){
  if(TB_ICONS.indexOf(name)<0)return'';
  return'<svg class="tb-ic'+(size?' tb-ic-'+size:'')+'" aria-hidden="true" focusable="false">'
    +'<use href="'+TB_SPRITE+'#lucide-'+name+'"></use></svg>';
}

// ── Day strings ───────────────────────────────────────────────────────
// A day on The Board is a 'YYYY-MM-DD' string in Asia/Karachi, so every
// calendar query is a string range query with no timezone arithmetic.
//
// NEVER use toISOString().slice(0,10) for this. It is UTC, and in PKT
// (UTC+5) it names the PREVIOUS day for the whole window between midnight
// and 5am — so "today" on a phone opened at 2am is yesterday. There are
// three live call sites in this repo with exactly that bug (listed in
// BOARD.md as a follow-up; they are not this module's to fix).
function _tbDay(d){
  const t=(d instanceof Date)?d:(d?new Date(d):new Date());
  if(isNaN(t.getTime()))return'';
  const p=n=>String(n).padStart(2,'0');
  return t.getFullYear()+'-'+p(t.getMonth()+1)+'-'+p(t.getDate());
}
function _tbToday(){ return _tbDay(new Date()); }
/** n days from a 'YYYY-MM-DD' string, back as one. Pure. */
function _tbDayAdd(day,n){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day||'')))return'';
  const p=String(day).split('-');
  // Noon, not midnight: a DST or offset shift at midnight would roll the
  // date. Pakistan has no DST today, but this helper is cheap insurance.
  const d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]),12,0,0);
  d.setDate(d.getDate()+Number(n||0));
  return _tbDay(d);
}

// ── Escaping ──────────────────────────────────────────────────────────
// Every string on The Board is typed by one person and rendered into
// someone else's browser. The standing rule in this codebase: user text is
// hydrated with textContent, never interpolated into an HTML string. Where
// a template literal genuinely is the clearest thing (an attribute, a
// title), it goes through this first.
function _tbEsc(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
/** A value spliced into a quoted argument of an INLINE HANDLER,
 *  onclick="f('…')". _tbEsc alone is not enough there: the browser decodes
 *  &#39; back to ' before the handler runs, so an id carrying a quote
 *  closes the string and runs whatever follows (review of 2ab0a8f). A
 *  document id is whatever its writer chose, and hrm_notifications -- the
 *  inbox's itemId -- is writable by anyone signed in. So: escape for the
 *  JS string first, then for the attribute. Every such site uses this;
 *  tests/theboard.test.js fails on one that does not. */
function _tbJs(s){
  return _tbEsc(String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'")
    .replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029'));
}

// ── Notifications ─────────────────────────────────────────────────────
// The Board does NOT get a collection of its own. This app already has a
// bell (hrm_notifications, addressed by `forUser`, deterministic ids), and
// js/marketing.js already writes into it without touching js/hrm.js — so
// reusing it buys the top bar and the unread badge for nothing, with one
// store instead of two. The Dashboard's inbox card reads the same
// collection filtered on source:'tb'.
//
// THE PRICE, AND WHY THIS HELPER IS THE ONLY WAY IN: _hrmNotifCardHTML
// (js/hrm.js) prints `title` and `message` into HTML **raw**. Every Board
// notification therefore has to be escaped before it is written, and one
// helper that cannot be bypassed is the only version of that rule which
// survives contact with a second caller.
const TB_NOTIF_SOURCE='tb';
const _TB_NOTIF_BUCKET_MS=10*60*1000;   // spec §5: dedupe window

/** Deterministic id: the same actor, type and item inside one 10-minute
 *  bucket is ONE row, so several devices (or a double click) cannot stack
 *  duplicates, and a dismissed notification is never raised again. Pure. */
function _tbNotifId(type,itemId,fromUid,atMs){
  const bucket=Math.floor(Number(atMs||0)/_TB_NOTIF_BUCKET_MS);
  const clean=s=>String(s==null?'':s).replace(/[^A-Za-z0-9_-]/g,'');
  return'tb_'+clean(type)+'_'+clean(itemId)+'_'+clean(fromUid)+'_'+bucket;
}

/** The row this module writes into hrm_notifications. Pure — the caller
 *  does the write, so this is assertable without a database. */
function tbNotifPayload(o){
  const n=o||{};
  return{
    source:TB_NOTIF_SOURCE,          // what the Dashboard inbox filters on
    type:String(n.type||''),         // 'mention' | 'assigned' | 'handover' | …
    forUser:String(n.forUser||''),   // recipient USERNAME — the bell's key
    fromUid:String(n.fromUid||''),
    itemId:String(n.itemId||''),
    listId:n.listId?String(n.listId):null,
    // Escaped HERE, because the bell renders both of these raw.
    title:_tbEsc(String(n.title||'').slice(0,80)),
    message:_tbEsc(String(n.message||'').slice(0,120)),
    actionUrl:TB_HOME,
    priority:Number(n.priority||1),
    readBy:[],
    createdAt:n.at||null
  };
}

// ══ PHASE 2 ═══════════════════════════════════════════════════════════
// Items, lists, the Dashboard and the drawer. The rule this section holds
// to: every DECISION is a pure function, and the writers are thin wrappers
// that call one. A rule about what an item becomes is then assertable
// without a database, and there is exactly one copy of it.

// ── In-memory state ───────────────────────────────────────────────────
let tbItems=[];
let tbLists=[];
let tbConfig=null;
let tbLoaded=false;
let _tbLoadErrors=[];          // collection names that FAILED, so an empty
let _tbLoading=null;           // screen and a refused read never look alike
let _tbOpenItemId=null;        // the drawer
let _tbListId=null;            // the open list
let _tbDraft={};               // unsaved drawer edits, keyed by field

/** Did this collection fail to load? A refused read and an empty
 *  collection must never render the same screen — the Store lesson. */
function _tbLoadFailed(col){ return _tbLoadErrors.indexOf(col)>-1; }

// ── Loading ───────────────────────────────────────────────────────────
// CANNOT REJECT. renderPage dispatches loaders with no .catch, so one that
// throws leaves the page on a skeleton forever with nothing on screen to
// say why.
//
// TWO QUERIES PER COLLECTION, NOT ONE, and that is not a style choice:
// Firestore rules are NOT a query filter. Each read rule here is a
// two-clause condition, so a single broad query whose safety depends on a
// field outside its where() is REJECTED OUTRIGHT rather than silently
// returning less. Each clause gets a query that proves it on its own.
async function loadTbData(force){
  if(tbLoaded&&!force)return;
  if(_tbLoading)return _tbLoading;
  const uid=(typeof session!=='undefined'&&session&&session.uid)||'';
  _tbLoading=(async()=>{
    const r=await Promise.allSettled([
      getDocs(query(collection(db,'board_items'),where('visibility','==','shared'))),
      getDocs(query(collection(db,'board_items'),where('ownerUid','==',uid))),
      getDocs(query(collection(db,'board_lists'),where('kind','==','shared'),where('memberUids','array-contains',uid))),
      getDocs(query(collection(db,'board_lists'),where('adminUid','==',uid))),
      getDoc(doc(db,'board_config','markers')),
      // THE PROFILE DIRECTORY. js/profile.js owns it and loads it only when
      // the Profile page opens; the Board needs every Board person's uid,
      // so it asks for it here. loadProfiles cannot reject (it records its
      // own error), so it is read back below.
      (typeof loadProfiles==='function'&&!(typeof profilesLoaded!=='undefined'&&profilesLoaded))
        ?loadProfiles():Promise.resolve()
    ]);
    const fail=[];
    const rows=(a,b,name)=>{
      const out={},bad=[];
      [a,b].forEach(x=>{
        if(x.status==='fulfilled')x.value.docs.forEach(d=>{out[d.id]=Object.assign({id:d.id},d.data());});
        else bad.push(x.reason);
      });
      // Both halves refused → we know nothing. One refused → we have part
      // of the picture, which is worth showing, but say so.
      if(bad.length){fail.push(name);console.warn('[the board] '+name+' read failed',bad[0]);}
      return Object.keys(out).map(k=>out[k]);
    };
    tbItems=rows(r[0],r[1],'board_items').map(tbDecodeItem);
    tbLists=rows(r[2],r[3],'board_lists');
    // Seed the live maps from THIS read, so a listener that has not
    // delivered yet never drops what the first paint showed (P0.3).
    const byId=x=>{const o={};if(x&&x.status==='fulfilled')x.value.docs.forEach(d=>{o[d.id]=Object.assign({id:d.id},d.data());});return o;};
    const seedMaps={items_shared:byId(r[0]),items_own:byId(r[1]),lists_shared:byId(r[2]),lists_admin:byId(r[3])};
    const seedBad={};
    ['items_shared','items_own','lists_shared','lists_admin'].forEach((k,i)=>{ if(r[i].status!=='fulfilled')seedBad[k]=true; });
    if(r[4].status==='fulfilled'){
      const snap=r[4].value;
      const ex=snap&&typeof snap.exists==='function'?snap.exists():false;
      tbConfig=ex?snap.data():{markers:[]};
    }else{fail.push('board_config');console.warn('[the board] config read failed',r[4].reason);}
    // A refused directory read leaves the Board usable (you still resolve
    // from the session) but says so in the warning strip.
    if(typeof _profileLoadErr!=='undefined'&&_profileLoadErr)fail.push('user_profiles');
    _tbLoadErrors=fail;
    _tbCalLoadPrefs();
    tbLoaded=true;
    _tbLoading=null;
    _tbLiveStart(seedMaps,seedBad);
  })();
  return _tbLoading;
}

/** Firestore refuses a nested array, and `dateHistory` is an array of
 *  objects (fine) while `steps` is too — but a future field that nests one
 *  array inside another would be refused at write time with no warning
 *  here. Decoding is total and idempotent so an older document still
 *  reads: the same boundary js/boards.js draws for a table's rows. */
function tbDecodeItem(raw){
  const it=Object.assign({},raw||{});
  it.assigneeUids=Array.isArray(it.assigneeUids)?it.assigneeUids:[];
  it.steps=Array.isArray(it.steps)?it.steps:[];
  it.dateHistory=Array.isArray(it.dateHistory)?it.dateHistory:[];
  it.attachments=Array.isArray(it.attachments)?it.attachments:[];
  it.myDay=(it.myDay&&typeof it.myDay==='object')?it.myDay:{};
  it.status=it.status==='done'?'done':'open';
  it.kind=['task','gate','event'].indexOf(it.kind)>-1?it.kind:'task';
  it.priority=[0,1,2].indexOf(Number(it.priority))>-1?Number(it.priority):0;
  it.date=it.date||null;
  it.listId=it.listId||null;
  return it;
}

// ══ SESSION 2 — P0.3: LIVE ITEMS ═════════════════════════════════════
// The board used to be read ONCE per session (and again only after a
// refused write or a Retry), so a date Ammar moved never reached Afnan's
// open screen until he reloaded -- on a board whose whole job is five
// people agreeing on dates. Now the same four queries loadTbData reads are
// LISTENED to, and any change lands on every open Board within a second.
//
// Three rules keep it from being worse than a static page:
//   · The FIRST PAINT stays on getDocs. The listeners start after it, with
//     their maps seeded from that read, so one that has not delivered yet
//     never drops an item the screen already showed. (The harness's
//     onSnapshot never fires, and every logic suite relies on getDocs.)
//   · Each query owns ONE map and a snapshot replaces only that map. The
//     screen is the UNION, exactly as loadTbData merges -- two queries,
//     never one, because the rules are not a query filter (BOARD.md).
//   · A REMOTE UPDATE NEVER LANDS MID-GESTURE. The data is taken at once,
//     but the repaint waits while a field has focus or a pill is being
//     dragged -- a repaint rebuilds #main-content wholesale, which would
//     eat the caret, the composer and the drag. The Mood Boards Stage 6
//     rule, for the same reason.
let _tbLive=null;              // {uid, maps, unsubs}
let _tbLivePending=false;
let _tbLiveTimer=null;
const _TB_LIVE_RETRY_MS=700;

/** The union the screen shows. PURE: maps in, {items, lists} out. */
function tbLiveMerge(maps){
  const m=maps||{};
  const items={},lists={};
  ['items_shared','items_own'].forEach(k=>{ Object.keys(m[k]||{}).forEach(id=>{ items[id]=m[k][id]; }); });
  ['lists_shared','lists_admin'].forEach(k=>{ Object.keys(m[k]||{}).forEach(id=>{ lists[id]=m[k][id]; }); });
  return{items:Object.keys(items).map(id=>items[id]),lists:Object.keys(lists).map(id=>lists[id])};
}
/** Is someone in the middle of something a repaint would destroy? */
function _tbLiveBusy(){
  if(typeof _tbDragId!=='undefined'&&_tbDragId!=null)return true;
  // A PRESS IN PROGRESS. A repaint between pointerdown and click detaches
  // the pressed button, so the click lands on a new node and is lost.
  // Bounded, so a release the page never hears (outside the window) can
  // hold live updates for a few seconds at most, never for good.
  if(_tbPtrDown&&Date.now()-_tbPtrDownAt<_TB_PRESS_MAX_MS)return true;
  // An open date picker is a gesture in progress: a repaint would tear
  // the calendar out from under the pointer.
  if(_tbFpOpen())return true;
  return _tbEditableFocus();
}
// (The quick-add composer keeps its text and chips in _tbQa, so a live
// repaint redraws it intact; its focus is restored by _tbRepaint.)
function _tbOnBoardPage(){
  return String((typeof currentPage!=='undefined'&&currentPage)||'').indexOf('tb-')===0;
}
function _tbLiveStart(seedMaps,seedBad){
  if(typeof onSnapshot!=='function')return;           // an old cached shell: stay static
  const uid=_tbMe();
  if(!uid)return;
  if(_tbLive&&_tbLive.uid===uid){
    // A re-read (Retry, or a refused write) refreshes the maps; the
    // listeners carry on.
    Object.assign(_tbLive.maps,seedMaps||{});
    _tbLive.bad=Object.assign({},seedBad||{});
    return;
  }
  _tbLiveStop();
  // `bad` is WHICH QUERY is failing, per query. A read failure used to be
  // cleared by a snapshot from ANY listener, so a refused board_items read
  // turned into an empty board the moment the lists listener delivered
  // (review of 14ad9f3). A failure now clears only when the query behind
  // it delivers, and a listener that starts failing puts it back.
  _tbLive={uid:uid,maps:Object.assign({items_shared:{},items_own:{},lists_shared:{},lists_admin:{}},seedMaps||{}),
           bad:Object.assign({},seedBad||{}),unsubs:[]};
  const defs=[
    {key:'items_shared',q:()=>query(collection(db,'board_items'),where('visibility','==','shared'))},
    {key:'items_own',   q:()=>query(collection(db,'board_items'),where('ownerUid','==',uid))},
    {key:'lists_shared',q:()=>query(collection(db,'board_lists'),where('kind','==','shared'),where('memberUids','array-contains',uid))},
    {key:'lists_admin', q:()=>query(collection(db,'board_lists'),where('adminUid','==',uid))}
  ];
  defs.forEach(function(d){
    try{
      _tbLive.unsubs.push(onSnapshot(d.q(),function(snap){
        if(!_tbLive||_tbLive.uid!==uid)return;
        const map={};
        ((snap&&snap.docs)||[]).forEach(x=>{ map[x.id]=Object.assign({id:x.id},x.data()); });
        _tbLive.maps[d.key]=map;
        delete _tbLive.bad[d.key];
        _tbLiveApply();
      },function(e){
        console.warn('[the board] live '+d.key+' failed',e);
        if(!_tbLive||_tbLive.uid!==uid)return;
        _tbLive.bad[d.key]=true;
        _tbLiveApply();
      }));
    }catch(e){ console.warn('[the board] live '+d.key+' could not start',e); }
  });
  try{
    _tbLive.unsubs.push(onSnapshot(doc(db,'board_config','markers'),function(snap){
      if(!_tbLive||_tbLive.uid!==uid)return;
      const ex=snap&&typeof snap.exists==='function'?snap.exists():false;
      tbConfig=ex?snap.data():{markers:[]};
      _tbLiveRepaint();
    },function(e){ console.warn('[the board] live config failed',e); }));
  }catch(e){}
}
function _tbLiveStop(){
  if(_tbLive)(_tbLive.unsubs||[]).forEach(u=>{ try{ if(typeof u==='function')u(); }catch(e){} });
  _tbLive=null;
}
function _tbLiveApply(){
  const merged=tbLiveMerge(_tbLive.maps);
  tbItems=merged.items.map(tbDecodeItem);
  tbLists=merged.lists;
  // A collection is failing while EITHER of its two queries is: the same
  // rule loadTbData's first read applies (one half refused is still said).
  const bad=_tbLive.bad||{};
  _tbLoadErrors=_tbLoadErrors.filter(c=>c!=='board_items'&&c!=='board_lists');
  if(bad.items_shared||bad.items_own)_tbLoadErrors.push('board_items');
  if(bad.lists_shared||bad.lists_admin)_tbLoadErrors.push('board_lists');
  _tbLiveRepaint();
}
/** A doc THIS tab just created. Real Firestore hands a local write to the
 *  listener before commit() resolves (latency compensation), so by the
 *  time the create path runs its own "add it to the list" the listener
 *  may already have done so: pushing again showed every new item twice
 *  (review of 14ad9f3). Upsert by id, and record it in the live map the
 *  listener owns so a rebuild from the maps cannot drop it either. */
function _tbUpsert(arr,obj){
  // No id, nothing to match on: a ref always carries one in the browser.
  const i=obj&&obj.id!=null?arr.findIndex(x=>x&&x.id===obj.id):-1;
  if(i>-1)arr[i]=obj;else arr.push(obj);
  return arr;
}
function _tbLiveRemember(key,id,data){
  if(_tbLive&&_tbLive.maps&&_tbLive.maps[key])_tbLive.maps[key][id]=Object.assign({id:id},data);
}
/** Repaint now, or as soon as nobody is mid-gesture. */
function _tbLiveRepaint(){
  if(!_tbOnBoardPage()){ _tbLivePending=false; return; }
  if(_tbLiveBusy()){
    _tbLivePending=true;
    if(!_tbLiveTimer)_tbLiveTimer=setTimeout(_tbLiveFlush,_TB_LIVE_RETRY_MS);
    return;
  }
  _tbLivePending=false;
  _tbRepaint();
}
function _tbLiveFlush(){
  _tbLiveTimer=null;
  if(!_tbLivePending)return;
  _tbLiveRepaint();
}
// Registered ONCE at load: leaving a field or finishing a press is when a
// deferred update lands, rather than waiting for the retry timer.
// NOT ON POINTERUP, AND NOT ON A FOCUSOUT A PRESS CAUSED (review of
// 14ad9f3). A mouse press moves focus during mousedown; flushing then
// repainted before mouseup, the pressed button was replaced, and its click
// was lost -- leaving a field by clicking Mark done did nothing. The flush
// now waits for the CLICK (this listener bubbles last, after the button's
// own handler) and a keyboard focusout, which no press is behind.
let _tbPtrDown=false,_tbPtrDownAt=0;
const _TB_PRESS_MAX_MS=5000;
(function(){
  if(typeof document==='undefined'||!document.addEventListener)return;
  const later=()=>{ if(_tbLivePending)setTimeout(_tbLiveFlush,0); };
  document.addEventListener('pointerdown',()=>{ _tbPtrDown=true;_tbPtrDownAt=Date.now(); },true);
  const up=()=>{ _tbPtrDown=false; };
  document.addEventListener('pointerup',up,true);
  document.addEventListener('pointercancel',up,true);
  if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('blur',up);
  document.addEventListener('focusout',()=>{ if(!_tbPtrDown)later(); });
  document.addEventListener('click',later);
})();

// ── The item ──────────────────────────────────────────────────────────
const TB_KINDS=['task','gate','event'];
const TB_LANES=['denim','knit','leather','factory','walika','design','shoot','edits','shopify','nov-ops'];
// Spec s8.6. Hex only where the app's tokens have no equivalent; these are
// deliberately muted, matching this app's monochrome-with-restraint brand.
const TB_COLORS={moss:'#23412e',ink:'#16160f',clay:'#b45309',amber:'#a1580e',
                 slate:'#4a5568',sand:'#b9a77a',wine:'#6b2137',teal:'#1f5f5b'};

/** VISIBILITY, and it is one rule in one place (spec s4): private while it
 *  is only yours and unlisted; shared the moment it gains another assignee
 *  or joins a shared list. The client sets it; the rules enforce the read.
 *  Pure. */
function tbVisibilityFor(o,lists){
  const a=(o&&o.assigneeUids)||[];
  const owner=(o&&o.ownerUid)||'';
  const others=a.filter(u=>u&&u!==owner).length>0;
  const list=(lists||[]).filter(l=>l.id===(o&&o.listId))[0];
  return (others||(list&&list.kind==='shared'))?'shared':'private';
}

/** A new item. `gate` is LOCKED BY DEFAULT — that is what a gate is: a
 *  date nobody moves but whoever set it. Pure apart from the id, which is
 *  why the id is an argument. */
function tbNewItem(o,uid,now,lists){
  const n=o||{};
  const assignees=Array.isArray(n.assigneeUids)&&n.assigneeUids.length?n.assigneeUids.slice():[uid];
  if(assignees.indexOf(uid)<0&&!n.handover)assignees.unshift(uid);
  const kind=TB_KINDS.indexOf(n.kind)>-1?n.kind:'task';
  const base={
    title:String(n.title||'').slice(0,140),
    notes:String(n.notes||''),
    listId:n.listId||null,
    ownerUid:uid,
    assigneeUids:assignees,
    kind:kind,
    date:n.date||null,
    datePlanned:n.date||null,   // the first date ever set; never changes
    dateHistory:[],
    dueAt:n.dueAt||null,
    timeLabel:n.timeLabel||null,
    color:n.color||null,
    lane:n.lane||null,
    priority:[0,1,2].indexOf(Number(n.priority))>-1?Number(n.priority):0,
    locked:n.locked!=null?!!n.locked:(kind==='gate'),
    lockedBy:null,
    status:'open',
    completedAt:null,
    completedByUid:null,
    steps:[],
    attachments:[],
    myDay:{},
    commentCount:0,
    lastActivityAt:now,
    createdAt:now,
    updatedAt:now
  };
  base.lockedBy=base.locked?uid:null;
  base.visibility=tbVisibilityFor(base,lists);
  return base;
}

/** What an EDIT becomes: the patch to write, the history entry a date
 *  change earns, and the activity row. Pure, so "a locked item keeps its
 *  date" and "a date change is recorded" are assertable with no database.
 *
 *  It does NOT decide whether the caller is allowed to do this — that is
 *  firestore.rules, and tbCanMoveDate() is only the UI's echo of it. */
function tbItemPatch(item,patch,uid,now,reason){
  const it=item||{},p=patch||{};
  const out={updatedAt:now,lastActivityAt:now};
  const acts=[];
  Object.keys(p).forEach(k=>{
    if(k==='date'||k==='dueAt')return;             // handled below
    if(JSON.stringify(p[k])!==JSON.stringify(it[k]))out[k]=p[k];
  });
  if('date' in p && (p.date||null)!==(it.date||null)){
    const from=it.date||null,to=p.date||null;
    out.date=to;
    // datePlanned is the FIRST date ever set and never changes after — it
    // is what "was Oct 25" is drawn from.
    if(it.datePlanned==null&&to!=null)out.datePlanned=to;
    out.dateHistory=(it.dateHistory||[]).concat([{from:from,to:to,byUid:uid,at:now,reason:reason||null}]);
    acts.push({type:from==null?'date_set':'moved',payload:{from:from,to:to,reason:reason||null}});
  }
  if('dueAt' in p && (p.dueAt||null)!==(it.dueAt||null))out.dueAt=p.dueAt||null;
  if(out.assigneeUids)acts.push({type:'assigned',payload:{to:out.assigneeUids}});
  if('locked' in out)acts.push({type:out.locked?'locked':'unlocked',payload:{}});
  // Visibility follows the assignees and the list, always.
  const merged=Object.assign({},it,out);
  const vis=tbVisibilityFor(merged,tbLists);
  if(vis!==it.visibility)out.visibility=vis;
  return {data:out,activity:acts.map(a=>({type:a.type,byUid:uid,at:now,payload:a.payload}))};
}

/** May this person change this item AT ALL? The first clause of the
 *  board_items update rule, echoed: someone on it (an assignee or its
 *  owner), the admin of its list, or a Board owner. A shared item is
 *  READABLE by every Board user but not writable by them, and the UI used
 *  to offer the star, the tick, the drag and every pane field to everyone
 *  who could read it -- each refused by the rules with a message blaming a
 *  lock or an undeployed ruleset (review of 2ab0a8f). Comments are open
 *  to every reader and stay so. Pure. */
function tbCanEdit(item,uid,isOwnerRole,lists){
  if(!item||!uid)return false;
  if(isOwnerRole)return true;
  if(item.ownerUid===uid||(item.assigneeUids||[]).indexOf(uid)>-1)return true;
  const l=(lists||[]).filter(x=>x&&x.id===item.listId)[0];
  return !!(l&&l.adminUid===uid);
}
const _TB_NOT_ON='Only the people on this item can change it';
function _tbCanEditIt(it){ return tbCanEdit(it,_tbMe(),_tbIsBoardOwner(),tbLists); }
/** Say it plainly, once, and write nothing. True when refused. */
function _tbNotOnIt(it){
  if(!it||_tbCanEditIt(it))return false;
  _tbToast('Only the people on this item can change it — leave a comment to ask them.');
  return true;
}

/** May this person move this item's date? The UI's echo of the rules
 *  clause — it hides a drag handle, it does not enforce anything. Pure.
 *  The LOCK only: whether they may change the item at all is tbCanEdit. */
function tbCanMoveDate(item,uid,isOwnerRole){
  if(!item)return false;
  if(!item.locked)return true;
  return item.lockedBy===uid||!!isOwnerRole;
}

// ── Quick add (spec s8.1) ─────────────────────────────────────────────
// ONE parser, used by the input and by its live preview, so the preview
// can never promise something the create does not do.
const _TB_MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const _TB_DOW=['sun','mon','tue','wed','thu','fri','sat'];

/** `mon`…`sun` → the next occurrence INCLUDING today. Typing "mon" on a
 *  Monday meaning "a week away" is the less useful reading for a task app. */
function _tbNextDow(from,dow){
  const p=String(from).split('-');
  const d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]),12,0,0);
  const delta=(dow-d.getDay()+7)%7;
  return _tbDayAdd(from,delta);
}
/** A day/month with no year: this year, unless that puts it well in the
 *  past, in which case next year. Typing "jan 5" in December means the
 *  January coming. */
function _tbDayMonth(from,day,mon){
  const y=Number(String(from).slice(0,4));
  const p=n=>String(n).padStart(2,'0');
  const same=y+'-'+p(mon+1)+'-'+p(day);
  if(!_tbValidDay(same))return'';
  // 180 days is the midpoint: closer than that behind us reads as "just
  // gone", further reads as "next year".
  return _tbDaysBetween(same,from)>180?((y+1)+'-'+p(mon+1)+'-'+p(day)):same;
}
function _tbValidDay(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||'')))return false;
  const p=String(s).split('-').map(Number);
  const d=new Date(p[0],p[1]-1,p[2],12,0,0);
  return d.getFullYear()===p[0]&&d.getMonth()===p[1]-1&&d.getDate()===p[2];
}
/** Whole days from `a` to `b`, positive when b is later. Pure. */
function _tbDaysBetween(a,b){
  if(!_tbValidDay(a)||!_tbValidDay(b))return 0;
  const mk=s=>{const p=String(s).split('-').map(Number);return new Date(p[0],p[1]-1,p[2],12,0,0).getTime();};
  return Math.round((mk(b)-mk(a))/86400000);
}

/**
 * The grammar. Tokens are REMOVED from the title, so what you typed minus
 * the instructions is what the item is called.
 *
 *   @handle   assignee, several allowed. An UNKNOWN handle stays literal —
 *             silently dropping "@baber" from a title would be worse than
 *             leaving it in, and it is often a real name.
 *   #lane     workstream tag.
 *   ! / !!    high / critical. Only as a STANDALONE token, or "fix this!"
 *             would quietly become a priority.
 *   dates     today · tomorrow · mon…sun · oct 5 · 5 oct · 5/10.
 *             FIRST match wins, anywhere in the string. `5/10` is D/M —
 *             this is a Pakistani team and 5/10 is the fifth of October.
 *
 * Pure: `ctx` supplies today and the handle→uid map, so no clock and no
 * session are read here.
 */
function tbParseQuickAdd(text,ctx){
  const c=ctx||{},today=c.today||'',handles=c.handles||{};
  let s=' '+String(text||'')+' ';
  const out={title:'',assigneeUids:[],assigneeHandles:[],lane:null,date:null,priority:0,unknownHandles:[],pendingHandles:[]};

  // priority first: it is a standalone token and cannot be confused
  s=s.replace(/(\s)(!{1,2})(?=\s)/g,(m,sp,bangs)=>{
    out.priority=Math.max(out.priority,bangs.length===2?2:1);return sp;
  });
  // @handle
  const board=c.boardHandles||[];
  s=s.replace(/(\s)@([a-z0-9._-]+)/gi,(m,sp,h)=>{
    const key=String(h).toLowerCase();
    if(handles[key]){
      if(out.assigneeUids.indexOf(handles[key])<0){out.assigneeUids.push(handles[key]);out.assigneeHandles.push(key);}
      return sp;
    }
    // A BOARD person the session cannot resolve yet (no profile row) is
    // still never title text -- "@afnan" in a title is the bug the brief
    // names. It is taken out and reported, so the preview can say why
    // they were not assigned.
    if(board.indexOf(key)>-1){
      if(out.pendingHandles.indexOf(key)<0)out.pendingHandles.push(key);
      return sp;
    }
    out.unknownHandles.push(key);
    return m;                       // not on the board → left in the title, verbatim
  });
  // #lane
  s=s.replace(/(\s)#([a-z0-9-]+)/gi,(m,sp,l)=>{out.lane=String(l).toLowerCase();return sp;});

  // dates — first match wins, so the order of these tests is the grammar
  const tryDate=(re,fn)=>{
    if(out.date)return;
    s=s.replace(re,function(){
      if(out.date)return arguments[0];
      const got=fn.apply(null,arguments);
      if(!got)return arguments[0];
      out.date=got;
      return arguments[1];          // the leading whitespace
    });
  };
  if(today){
    tryDate(/(\s)today(?=\s)/i,()=>today);
    tryDate(/(\s)tomorrow(?=\s)/i,()=>_tbDayAdd(today,1));
    tryDate(/(\s)(mon|tue|wed|thu|fri|sat|sun)[a-z]*(?=\s)/i,(m,sp,d)=>_tbNextDow(today,_TB_DOW.indexOf(String(d).toLowerCase())));
    tryDate(/(\s)(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?=\s)/i,
      (m,sp,mon,day)=>_tbDayMonth(today,Number(day),_TB_MONTHS.indexOf(String(mon).toLowerCase().slice(0,3))));
    tryDate(/(\s)(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?=\s)/i,
      (m,sp,day,mon)=>_tbDayMonth(today,Number(day),_TB_MONTHS.indexOf(String(mon).toLowerCase().slice(0,3))));
    tryDate(/(\s)(\d{1,2})\/(\d{1,2})(?=\s)/,(m,sp,d,mo)=>_tbDayMonth(today,Number(d),Number(mo)-1));
  }
  out.title=s.replace(/\s+/g,' ').trim().slice(0,140);
  return out;
}

/** The preview line under the input. Reads from the SAME parse, so it can
 *  never describe something the create would not do. Pure. */
function tbQuickAddPreview(parsed,ctx){
  const p=parsed||{},c=ctx||{},names=c.names||{};
  const bits=[];
  if(p.date)bits.push(tbDayLabel(p.date,c.today));
  if(p.assigneeHandles&&p.assigneeHandles.length)bits.push(p.assigneeHandles.map(h=>names[h]||h).join(', '));
  if(p.lane)bits.push(p.lane);
  if(p.priority===2)bits.push('critical');
  else if(p.priority===1)bits.push('high');
  return bits.length?('→ '+bits.join(' · ')):'';
}

// ── Reading a date ────────────────────────────────────────────────────
function tbDayLabel(day,today){
  if(!day)return'no date';
  if(today){
    const d=_tbDaysBetween(today,day);
    if(d===0)return'today';
    if(d===1)return'tomorrow';
    if(d===-1)return'yesterday';
  }
  const p=String(day).split('-');
  return _TB_MONTHS[Number(p[1])-1]+' '+Number(p[2]);
}

// ── The Dashboard's questions (spec s7.1, cards 1-8) ──────────────────
// Each is a PURE selector over the loaded set. Every card answers one
// question, and a card with nothing to show is hidden rather than shown
// empty — so each of these returning [] is the whole condition.
const _tbOpen=i=>i.status!=='done';
const _tbMine=(i,uid)=>(i.assigneeUids||[]).indexOf(uid)>-1;
/** Gates first, then events, then tasks — on a day, the thing that cannot
 *  move is read before the thing that can. */
const _TB_KIND_ORDER={gate:0,event:1,task:2};
// NOTE the `!= null` rather than `||`: gate's order is 0, and `0 || 9`
// is 9 — which sorted gates LAST, the exact opposite of the rule.
function _tbKindRank(k){const r=_TB_KIND_ORDER[k];return r!=null?r:9;}
function _tbByKind(a,b){return _tbKindRank(a.kind)-_tbKindRank(b.kind);}
function _tbByDate(a,b){
  // Undated last, always: a card sorted by date that leads with the
  // undated ones is answering a different question.
  if(!a.date&&!b.date)return 0;
  if(!a.date)return 1;
  if(!b.date)return -1;
  return a.date<b.date?-1:a.date>b.date?1:_tbByKind(a,b);
}

function tbOverdue(items,uid,today){
  return (items||[]).filter(i=>_tbOpen(i)&&_tbMine(i,uid)&&i.date&&i.date<today)
    .sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);   // oldest first
}
function tbDueToday(items,uid,today){
  return (items||[]).filter(i=>_tbOpen(i)&&_tbMine(i,uid)&&i.date===today).sort(_tbByKind);
}
function tbMyDay(items,uid,today){
  const above=new Set(tbOverdue(items,uid,today).concat(tbDueToday(items,uid,today)).map(i=>i.id));
  return (items||[]).filter(i=>_tbOpen(i)&&(i.myDay||{})[uid]===today&&!above.has(i.id)).sort(_tbByDate);
}
/** "What are other people expecting from me" — mine to do, someone else's
 *  to have asked. Deliberately excludes what I set myself. */
function tbAssignedToMe(items,uid,today){
  const above=new Set(tbOverdue(items,uid,today).concat(tbDueToday(items,uid,today))
    .concat(tbMyDay(items,uid,today)).map(i=>i.id));
  // Undated ones live in Needs a date now (decision 5); a card that
  // repeats another's rows makes both harder to read.
  return (items||[]).filter(i=>_tbOpen(i)&&_tbMine(i,uid)&&i.ownerUid!==uid&&!!i.date&&!above.has(i.id)).sort(_tbByDate);
}
/** The set-a-date chore: undated items I OWN OR AM ASSIGNED TO.
 *  Session 2 (Ammar's decision 5): the spec's owner-only rule was wrong --
 *  the seed makes a milestone's first assignee its owner, so both undated
 *  bulk-landing gates were Mustafa's alone, while the people who have to
 *  schedule them (Afnan and Mustafa, both on them) never saw one. */
function tbNeedsDate(items,uid){
  return (items||[]).filter(i=>_tbOpen(i)&&!i.date&&(i.ownerUid===uid||_tbMine(i,uid)))
    .sort((a,b)=>String(a.title||'').localeCompare(String(b.title||'')));
}
function tbNext7(items,uid,today){
  const end=_tbDayAdd(today,7);
  return (items||[]).filter(i=>_tbOpen(i)&&_tbMine(i,uid)&&i.date&&i.date>today&&i.date<=end).sort(_tbByDate);
}
/** "Am I waiting on someone" — mine to have asked, someone else's to do. */
function tbAssignedByMe(items,uid){
  return (items||[]).filter(i=>_tbOpen(i)&&i.ownerUid===uid
    &&(i.assigneeUids||[]).filter(u=>u!==uid).length>0).sort(_tbByDate);
}
/** THE DROP'S CRITICAL PATH ON ONE CARD: every gate in the next 14 days
 *  across all shared items, whoever they belong to, plus anything an owner
 *  has pinned. Not filtered by assignee on purpose. */
function tbDeadlines(items,today,days){
  const end=_tbDayAdd(today,days||14);
  return (items||[]).filter(i=>_tbOpen(i)&&i.visibility==='shared'&&i.date
      &&((i.kind==='gate'&&i.date>=today&&i.date<=end)||i.pinned===true))
    .sort(_tbByDate);
}

/** Steps: "2/5", and the hint when they are all done. Completing the last
 *  step deliberately does NOT complete the item — people want to review
 *  (spec s8.3). Pure. */
function tbStepProgress(item){
  const st=(item&&item.steps)||[];
  const done=st.filter(x=>x&&x.done).length;
  return {done:done,total:st.length,label:st.length?(done+'/'+st.length):'',
          allDone:st.length>0&&done===st.length};
}

/** Colour resolution (spec s8.6): explicit → list → first assignee.
 *  Returns a palette KEY, never a hex, so nothing reaches a style
 *  attribute unvalidated. Pure. */
function tbItemColorKey(item,lists,userColors){
  const i=item||{};
  if(i.color&&TB_COLORS[i.color])return i.color;
  const l=(lists||[]).filter(x=>x.id===i.listId)[0];
  if(l&&l.color&&TB_COLORS[l.color])return l.color;
  const first=(i.assigneeUids||[])[0];
  const uc=(userColors||{})[first];
  if(uc&&TB_COLORS[uc])return uc;
  return 'slate';
}

/** HAND OVER (spec s8.4). One batch: the recipient joins, the sender
 *  leaves unless they keep themselves on it, and a note is REQUIRED —
 *  a handover with no reason is how work goes quiet. Allowed on a locked
 *  item, because it changes people, not dates. Pure. */
/*  `toHandle` arrived in phase 4 and fixed a live bug: this comment body
 *  interpolated the raw UID, so the thread — which nothing could read
 *  until phase 4 — would have said "handed over to @u-dani". It is the
 *  stored `@[handle]` mention token now, so the recipient is a real
 *  mention chip. Still pure; the caller resolves the handle. */
function tbHandoverPlan(item,fromUid,toUid,note,keepMe,now,toHandle){
  const it=item||{};
  if(!toUid)return {error:'Pick someone to hand this to.'};
  if(toUid===fromUid)return {error:'That is already you.'};
  if(!String(note||'').trim())return {error:'Add a one-line note — what does the next person need to know?'};
  let a=(it.assigneeUids||[]).slice();
  if(a.indexOf(toUid)<0)a.push(toUid);
  if(!keepMe)a=a.filter(u=>u!==fromUid);
  if(!a.length)a=[toUid];
  return {
    data:{assigneeUids:a,updatedAt:now,lastActivityAt:now},
    activity:{type:'handover',byUid:fromUid,at:now,payload:{toUid:toUid,note:String(note).trim()}},
    comment:{authorUid:fromUid,
             body:'handed over to '+(toHandle?'@['+toHandle+']':'you')+' — '+String(note).trim(),
             mentionUids:[toUid],attachments:[],createdAt:now,editedAt:null},
    notifyUid:toUid,
    note:String(note).trim()
  };
}

/** DONE (spec s8.5). Any assignee may. The owner and the list admin hear
 *  about it, unless they are the one who did it. Pure. */
function tbDonePlan(item,uid,now,listAdminUid){
  const it=item||{};
  if(it.status==='done'){
    return {data:{status:'open',completedAt:null,completedByUid:null,updatedAt:now,lastActivityAt:now},
            activity:{type:'reopened',byUid:uid,at:now,payload:{}},notify:[]};
  }
  const notify=[];
  if(it.ownerUid&&it.ownerUid!==uid)notify.push(it.ownerUid);
  if(listAdminUid&&listAdminUid!==uid&&notify.indexOf(listAdminUid)<0)notify.push(listAdminUid);
  return {data:{status:'done',completedAt:now,completedByUid:uid,updatedAt:now,lastActivityAt:now},
          activity:{type:'done',byUid:uid,at:now,payload:{}},notify:notify};
}

// ── People ────────────────────────────────────────────────────────────
// uid -> person. `userProfiles` is a global in js/profile.js, which loads
// BEFORE this file, so it is reachable by bare name; guarded anyway, since
// a profile row only exists once someone has signed in since Profiles
// shipped (see BOARD.md, "Adding the user").
function _tbProfiles(){ return (typeof userProfiles!=='undefined'&&userProfiles)||[]; }
function _tbDefs(){ return (typeof USER_DEFS!=='undefined'&&USER_DEFS)||[]; }
function _tbBoardUsernames(){ return (typeof BOARD_USERS!=='undefined'&&BOARD_USERS)||[]; }

/** THE FIVE BOARD PEOPLE, resolved as far as this session can. A uid
 *  comes from the person's profile row -- the ONLY username<->uid link the
 *  client has -- or, for yourself, from the session. Someone with neither
 *  (never signed in, never synced) is still LISTED, as not set up yet:
 *  Team today names all five from day one, and a person you cannot assign
 *  says why rather than vanishing.
 *
 *  Session 2 fix: until now nothing on the Board loaded the profile
 *  DIRECTORY -- only your own row from profileBootstrap -- so every other
 *  person rendered as "someone", Team today listed one person, and the
 *  assign chips, @mentions, handover, the person filter and bell
 *  addressing all knew nobody but you. Never throws. */
function tbPeople(){
  const profiles=_tbProfiles();
  const me=(typeof session!=='undefined'&&session)||null;
  const unread=_tbLoadFailed('user_profiles');
  return _tbBoardUsernames().map(function(h){
    const rows=profiles.filter(x=>x&&x.username===h&&x.uid);
    const uids=rows.map(x=>x.uid).filter((u,i,a)=>a.indexOf(u)===i);
    const def=_tbDefs().filter(u=>u&&u.u===h)[0]||null;
    let uid='',reason='';
    // YOU are always your session (review of a96cddb): `username` on a
    // profile row is self-writable, so a row claiming your handle must not
    // outrank the account you are signed in as.
    if(me&&me.u===h&&me.uid)uid=me.uid;
    // TWO ROWS CLAIMING ONE HANDLE are not guessed between: the first one
    // returned used to win, so a row anyone can write for themselves could
    // take a teammate's assignments. Not assignable, and said -- an owner
    // removes the stale row on the Profile page.
    else if(uids.length>1)reason='ambiguous';
    else if(uids.length===1)uid=uids[0];
    else reason=unread?'unread':'missing';
    const p=rows.filter(x=>x.uid===uid)[0]||(uids.length===1?rows[0]:null);
    const name=(p&&p.displayName)||(def&&def.name)||h;
    return{handle:h,uid:uid,name:name,reason:reason,
      initial:String(name).trim().charAt(0).toUpperCase()||'?',setUp:!!uid};
  });
}
/** Why someone cannot be assigned, in words. A failed directory read used
 *  to say every teammate was "not set up yet" and send an owner to Sync
 *  accounts for four people who all had accounts (review of a96cddb). */
function tbPersonOffText(p){
  const n=(p&&p.name)||'They';
  if(p&&p.reason==='unread')return n+' could not be matched — the team directory did not load. Reload The Board.';
  if(p&&p.reason==='ambiguous')return 'Two profiles claim @'+p.handle+' — an owner should remove the stale one on the Profile page.';
  return n+' is not set up yet — an owner can press Sync accounts on the Profile page.';
}
/** The toast for handles a create could not assign. */
function _tbPendingToast(handles){
  if(!handles||!handles.length)return '';
  const at='@'+handles.join(', @');
  if(_tbLoadFailed('user_profiles'))return 'Added — '+at+' could not be assigned: the team directory did not load. Reload The Board and assign from the item.';
  return 'Added — '+at+' is not set up yet, so not assigned. An owner can press Sync accounts on the Profile page.';
}

/** Everything the UI needs about a person, from a uid. Never throws, and
 *  never renders a bare uid at someone: an unresolvable one reads as
 *  "someone", which is honest. */
function tbUser(uid){
  if(!uid)return{uid:'',name:'—',handle:'',initial:'?',colorKey:null};
  const p=_tbProfiles().filter(x=>x&&x.uid===uid)[0];
  if(!p){
    // No profile row -- but it may be a Board person the session knows
    // (yourself, before your row exists).
    const bp=tbPeople().filter(x=>x.uid===uid)[0];
    if(bp)return{uid:uid,name:bp.name,handle:bp.handle,initial:bp.initial,colorKey:null};
  }
  const def=p?_tbDefs().filter(u=>u.u===p.username)[0]:null;
  const name=(p&&p.displayName)||(def&&def.name)||(p&&p.username)||'someone';
  return{
    uid:uid,
    name:name,
    handle:(p&&p.username)||'',
    initial:String(name).trim().charAt(0).toUpperCase()||'?',
    colorKey:(p&&p.boardColor&&TB_COLORS[p.boardColor])?p.boardColor:null
  };
}
/** handle -> uid, for the quick-add grammar and @mentions. ONLY Board
 *  users are candidates (spec s9), so Sami — one letter from Saim — can
 *  never be offered here. Only people with a resolvable uid appear. */
function tbHandleMap(){
  const out={};
  tbPeople().forEach(p=>{ if(p.uid)out[p.handle]=p.uid; });
  return out;
}
function tbUserColors(){
  const out={};
  _tbProfiles().forEach(p=>{ if(p&&p.uid&&p.boardColor)out[p.uid]=p.boardColor; });
  return out;
}
function _tbMe(){ return (typeof session!=='undefined'&&session&&session.uid)||''; }
function _tbIsBoardOwner(){ return !!(typeof isBoardOwner==='function'&&isBoardOwner()); }

// ── Rendering ─────────────────────────────────────────────────────────
// USER TEXT IS NEVER INTERPOLATED. Structure is built as a string with
// empty slots carrying ids; _tbHydrate fills them with textContent
// afterwards. Same boundary as Notes' blocks and board card text — and the
// reason is the same: every title here is typed by one person and drawn
// into everyone else's browser.
let _tbHydrateQueue=[];
function _tbSlot(text,cls,tag){
  const id='tbh'+(_tbHydrateQueue.length);
  _tbHydrateQueue.push({id:id,text:String(text==null?'':text)});
  const t=tag||'span';
  return'<'+t+' id="'+id+'"'+(cls?' class="'+cls+'"':'')+'></'+t+'>';
}
function _tbHydrate(){
  _tbHydrateQueue.forEach(q=>{
    const el=document.getElementById(q.id);
    if(el)el.textContent=q.text;
  });
  _tbHydrateQueue=[];
}

/** The row, everywhere (spec s7.1; session 2, P1.3 -- the To Do pattern):
 *  a ROUND checkbox · the title (up to two lines) with a META LINE under it
 *  -- colour dot, kind, date, steps, comments, lock, the list (off a list's
 *  own screen), the OTHER assignees -- and a STAR on the right that puts
 *  the item in My Day. One tap on the title opens the item; the checkbox
 *  and the star act without opening it.
 *  `o.inList`: on a list's own screen, where naming the list is noise. */
function _tbRow(item,today,o){
  o=o||{};
  const me=_tbMe();
  const ck=tbItemColorKey(item,tbLists,tbUserColors());
  const others=(item.assigneeUids||[]).filter(u=>u!==me);
  const pr=tbStepProgress(item);
  const done=item.status==='done';
  const overdue=item.date&&item.date<today&&!done;
  const starred=!done&&(item.myDay||{})[me]===today;
  const list=(!o.inList&&item.listId)?tbLists.filter(l=>l&&l.id===item.listId)[0]:null;
  const id=_tbEsc(item.id);
  const jid=_tbJs(item.id);
  // Someone the rules will not let change it sees no star and a tick that
  // says why it will not move (review of 2ab0a8f).
  const canEdit=_tbCanEditIt(item);
  const avatars=others.slice(0,3).map(u=>{
    const p=tbUser(u);
    return'<span class="tb-av" title="'+_tbEsc(p.name)+'">'+_tbEsc(p.initial)+'</span>';
  }).join('')+(others.length>3?'<span class="tb-av tb-av-more">+'+(others.length-3)+'</span>':'');
  const lockedBy=item.locked?tbUser(item.lockedBy):null;
  const meta=[
    item.kind!=='task'?'<span class="tb-kind tb-kind-'+_tbEsc(item.kind)+'">'+_tbEsc(_tbCap(item.kind))+'</span>':'',
    // No date is said by saying nothing: the Needs a Date card already
    // says it, and "no date" on every undated row is noise.
    item.date?'<span class="tb-date'+(overdue?' over':'')+'">'+_tbIcon('calendar','sm')+_tbEsc(_tbCap(tbDayLabel(item.date,today)))+'</span>':'',
    pr.label?'<span class="tb-steps" title="steps done">'+_tbIcon('list-checks','sm')+_tbEsc(pr.label)+'</span>':'',
    item.commentCount>0?'<span class="tb-cc" title="comments">'+_tbIcon('message-circle','sm')+_tbEsc(item.commentCount)+'</span>':'',
    item.locked?'<span class="tb-lock" title="locked by '+_tbEsc(lockedBy.name)+'">'+_tbIcon('lock','sm')+'</span>':'',
    list?'<span class="tb-rowlist">'+_tbIcon(list.kind==='shared'?'users':'list','sm')+_tbSlot(list.title||'untitled','tb-rowlistname')+'</span>':'',
    avatars?'<span class="tb-avs">'+avatars+'</span>':''
  ].join('');
  // A row with nothing to say has no meta line at all -- a lone colour dot
  // on a line of its own (seen on the P1.3 screenshots) is a wasted line.
  // The dot leads the line when there is one; on a list's own screen every
  // row shares the list's colour, so there it is only drawn with other meta.
  // The item open in the pane is marked in the list, so the eye can find
  // what the pane is describing (the To Do pattern).
  return'<div class="tb-row'+(done?' done':'')+(item.priority===2?' crit':'')+(item.id===_tbOpenItemId?' tb-sel':'')+'" data-id="'+id+'">'
    +'<button class="tb-check'+(done?' on':'')+'" title="'+(canEdit?(done?'Mark not done':'Mark done'):_TB_NOT_ON)+'"'
      +' aria-label="'+(done?'Mark not done':'Mark done')+'" aria-pressed="'+(done?'true':'false')+'"'
      +(canEdit?'':' disabled')
      +' onclick="event.stopPropagation();window.tbToggleDone(\''+jid+'\')">'+_tbIcon('check','sm')+'</button>'
    +'<button class="tb-rowmain" onclick="window.tbOpenItem(\''+jid+'\')">'
      +_tbSlot(item.title||'untitled','tb-rowtitle')
      +(meta?'<span class="tb-rowmeta"><span class="tb-dot tb-c-'+_tbEsc(ck)+'"></span>'+meta+'</span>':'')
    +'</button>'
    // A done item has no day left to be in, so it has no star.
    +(done||!canEdit?'':'<button class="tb-star'+(starred?' on':'')+'"'
      +' title="'+(starred?'Remove from My Day':'Add to My Day')+'"'
      +' aria-label="'+(starred?'Remove from My Day':'Add to My Day')+'" aria-pressed="'+(starred?'true':'false')+'"'
      +' onclick="event.stopPropagation();window.tbAddToMyDay(\''+jid+'\')">'+_tbIcon('star')+'</button>')
  +'</div>';
}
/** First letter up: "today" -> "Today", "gate" -> "Gate". Pure. */
function _tbCap(s){ s=String(s==null?'':s); return s.charAt(0).toUpperCase()+s.slice(1); }

// ── The Dashboard's groups (session 2, P1.5) ──────────────────────────
// Folded per viewer, in localStorage -- a preference about this screen,
// not the board. It is CLEANED ON LOAD like the calendar prefs (Ammar's
// decision 6): only the six known group keys survive, and anything
// unreadable or over 4 KB is removed rather than trusted.
const TB_DASH_GROUPS=['overdue','today','myday','assigned','needsdate','next7'];
const _TB_DASH_FOLD_KEY='tb-dash-fold';
let _tbDashFold=null;
/** What a stored fold may hold. [] for nothing stored; null means "remove
 *  what is there". Pure. */
function tbCleanDashFold(raw){
  if(raw==null)return[];
  if(typeof raw!=='string'||raw.length>_TB_CAL_PREFS_MAX)return null;
  let v;
  try{ v=JSON.parse(raw); }catch(e){ return null; }
  if(!Array.isArray(v))return null;
  return TB_DASH_GROUPS.filter(k=>v.indexOf(k)>-1);
}
function _tbDashFoldGet(){
  if(_tbDashFold)return _tbDashFold;
  let raw=null;
  try{ raw=localStorage.getItem(_TB_DASH_FOLD_KEY); }catch(e){}
  const clean=tbCleanDashFold(raw);
  if(clean===null){ try{ localStorage.removeItem(_TB_DASH_FOLD_KEY); }catch(e){} }
  _tbDashFold=new Set(clean||[]);
  return _tbDashFold;
}
window.tbToggleGroup=function(k){
  if(TB_DASH_GROUPS.indexOf(k)<0)return;
  const f=_tbDashFoldGet();
  if(f.has(k))f.delete(k); else f.add(k);
  try{ localStorage.setItem(_TB_DASH_FOLD_KEY,JSON.stringify(TB_DASH_GROUPS.filter(x=>f.has(x)))); }catch(e){}
  _tbRepaint();
};
/** One group: a header that folds it, and its rows. '' when empty. */
function _tbGroup(key,title,items,today,o){
  if(!items.length)return'';
  const shut=_tbDashFoldGet().has(key);
  return'<section class="tb-group'+(shut?' tb-shut':'')+'" data-group="'+_tbEsc(key)+'">'
    +'<button class="tb-grouph" aria-expanded="'+(shut?'false':'true')+'"'
      +' onclick="window.tbToggleGroup(\''+_tbJs(key)+'\')">'
      +_tbIcon(shut?'chevron-right':'chevron-down','sm')
      +'<span class="tb-groupname">'+_tbEsc(title)+'</span>'
      +'<span class="tb-count'+(o&&o.red?' red':'')+'">'+items.length+'</span>'
    +'</button>'
    +(shut?'':'<div class="tb-groupbody">'+items.map(i=>_tbRow(i,today)).join('')+'</div>')
  +'</section>';
}

/** A card. Returns '' when there is nothing to show — spec s7.1: cards
 *  with nothing in them are HIDDEN, not rendered empty. That rule is what
 *  keeps the Dashboard short on a quiet day. */
function _tbCard(title,rows,opts){
  const o=opts||{};
  if(!rows.length&&!o.keepEmpty)return'';
  return'<div class="tb-card'+(o.cls?' '+o.cls:'')+'">'
    +'<div class="tb-cardh">'+_tbEsc(title)
      +(rows.length?'<span class="tb-count'+(o.red?' red':'')+'">'+rows.length+'</span>':'')
      +(o.action||'')
    +'</div>'
    +(rows.length?rows.join(''):'<div class="tb-cardempty">'+_tbEsc(o.empty||'nothing here')+'</div>')
  +'</div>';
}

function _tbHeaderStrip(today){
  const me=_tbMe();
  const markers=((tbConfig&&tbConfig.markers)||[]).slice()
    .filter(m=>m&&m.date&&_tbDaysBetween(today,m.date)>=0)
    .sort((a,b)=>a.date<b.date?-1:1);
  const countdown=markers.slice(0,2).map(m=>{
    const d=_tbDaysBetween(today,m.date);
    return d+' day'+(d===1?'':'s')+' to '+m.label;
  }).join(' · ');
  const due=tbDueToday(tbItems,me,today).length;
  const over=tbOverdue(tbItems,me,today).length;
  const waiting=tbAssignedByMe(tbItems,me).length;
  const counts=[due+' due today']
    .concat(over?[over+' overdue']:[])
    .concat(waiting?[waiting+' waiting on others']:[]).join(' · ');
  return'<div class="tb-strip">'
    +'<div class="tb-stripday">'+_tbEsc(tbDayLabel(today,today)==='today'?_tbLongDay(today):today)+'</div>'
    +(countdown?'<div class="tb-stripmark">'+_tbEsc(countdown)+'</div>':'')
    +'<div class="tb-stripcount">'+_tbEsc(counts)+'</div>'
  +'</div>'
  +_tbComposer('add something — try: denim samples @afnan #denim oct 5 !');
}
function _tbLongDay(day){
  const p=String(day).split('-');
  const d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]),12,0,0);
  // Title Case, like every heading on The Board (session 2): 'Saturday 26
  // September'. It used to be forced to lowercase with the spec's voice.
  return d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
}

/** The Dashboard — cards 1-8. Order matters and is not to be changed for
 *  looks: it runs from what is late, through what is today, to what other
 *  people are waiting on. */
function _tbDashboard(){
  const me=_tbMe(),today=_tbToday();
  if(_tbLoadFailed('board_items')){
    return _tbHeaderStrip(today)+'<div class="tb-err">Could not read The Board. '
      +'<button class="btn-outline" onclick="window.tbRetry()">Retry</button>'
      +'<div class="tb-errsub">If this keeps happening, firestore.rules may not be deployed — see BOARD.md.</div></div>';
  }
  const R=list=>list.map(i=>_tbRow(i,today));
  // Session 2, P1.5: the left column is ONE surface of COLLAPSIBLE GROUPS
  // (the To Do pattern) -- what is yours to do, in the order you would do
  // it. An empty group is not drawn, the rule the cards already followed.
  const groups=[
    _tbGroup('overdue','Overdue',tbOverdue(tbItems,me,today),today,{red:true}),
    _tbGroup('today','Due Today',tbDueToday(tbItems,me,today),today),
    _tbGroup('myday','My Day',tbMyDay(tbItems,me,today),today),
    _tbGroup('assigned','Assigned to Me',tbAssignedToMe(tbItems,me,today),today),
    _tbGroup('needsdate','Needs a Date',tbNeedsDate(tbItems,me),today),
    _tbGroup('next7','Next 7 Days',tbNext7(tbItems,me,today),today)
  ].join('');
  const left=groups?'<div class="tb-card tb-groups">'+groups+'</div>':'';
  // The right column is what OTHER people are doing. "My Lists" (card 12)
  // is gone from here: the rail lists every list with its count now.
  const rightMost=[
    _tbCard('Assigned by Me',R(tbAssignedByMe(tbItems,me))),
    _tbCard('Deadlines',R(tbDeadlines(tbItems,today,14)),{cls:'tb-deadlines'}),
    _tbInboxCard()        // card 9: the five newest, unread first
  ].join('');
  const team=_tbTeamCard();        // card 10
  const activity=_tbActivityCard(); // card 11
  const right=rightMost+team+activity;
  // The one-sentence empty state: nothing on YOUR board and nothing in the
  // right column either -- except Team Today, which always lists all five
  // (brief s4) and would otherwise hide the sentence forever. Keying it off
  // the left column alone said "nothing on The Board" over a Deadlines card
  // full of gates (review of a96cddb).
  const empty=!left&&!rightMost&&!activity
    ?'<div class="tb-empty"><div class="tb-empty-h">Nothing on The Board today</div>'
     +'<div class="tb-empty-p">add something above, or open the calendar.</div>'
     +'<button class="btn-outline" onclick="window.showPage(\'tb-calendar\')">Open the calendar</button>'
     +'</div>':'';
  const warn=_tbLoadErrors.length&&!_tbLoadFailed('board_items')
    ?'<div class="tb-warn">'+_tbEsc(_tbLoadErrors.join(', '))+' could not be read — some of this may be incomplete.</div>':'';
  return _tbHeaderStrip(today)+warn+empty
    +'<div class="tb-cols"><div class="tb-col">'+left+'</div><div class="tb-col">'+right+'</div></div>';
}

/** Lists — shared and private, always both, never a tab switcher. Same
 *  two-section shape Notes uses, for the same reason: a tab hides half of
 *  what you own behind a click. */
function _tbListsScreen(){
  const me=_tbMe();
  if(_tbListId){
    const l=tbLists.filter(x=>x.id===_tbListId)[0];
    if(l)return _tbListDetail(l);
    _tbListId=null;
  }
  const mine=tbLists.filter(l=>!l.archived);
  const shared=mine.filter(l=>l.kind==='shared');
  const priv=mine.filter(l=>l.kind!=='shared');
  const card=l=>{
    const open=tbItems.filter(i=>i.listId===l.id&&i.status!=='done').length;
    return'<button class="tb-listcard" onclick="window.tbOpenList(\''+_tbJs(l.id)+'\')">'
      +'<span class="tb-dot tb-c-'+_tbEsc(TB_COLORS[l.color]?l.color:'slate')+'"></span>'
      +_tbSlot(l.title||'untitled','tb-listname')
      +'<span class="tb-listn">'+open+'</span></button>';
  };
  const sec=(t,ls,kind)=>'<div class="tb-sec"><div class="tb-sech">'+_tbEsc(t)
    +'<button class="tb-newlist" onclick="window.tbNewList(\''+_tbJs(kind)+'\')">+ New</button></div>'
    +(ls.length?ls.map(card).join(''):'<div class="tb-cardempty">no '+_tbEsc(String(t).toLowerCase())+' lists yet</div>')+'</div>';
  return sec('Team',shared,'shared')+sec('Private',priv,'private');
}

function _tbListDetail(l){
  const today=_tbToday();
  const all=tbItems.filter(i=>i.listId===l.id);
  const open=all.filter(i=>i.status!=='done').sort(_tbByDate);
  const done=all.filter(i=>i.status==='done');
  const isAdmin=l.adminUid===_tbMe()||_tbIsBoardOwner();
  return'<div class="tb-listhead">'
    +'<button class="tb-back" onclick="window.tbCloseList()">&lsaquo; Lists</button>'
    +_tbSlot(l.title||'untitled','tb-listtitle','h2')
    +'<span class="tb-badge">'+_tbEsc(l.kind==='shared'?'Team':'Private')+'</span>'
    +(isAdmin?'<span class="tb-badge">Admin</span>':'')
  +'</div>'
  +_tbComposer('add to this list')
  +_tbCard('Open',open.map(i=>_tbRow(i,today,{inList:true})),{keepEmpty:true,empty:'nothing open in this list'})
  +_tbCompleted(l.id,done,today);
}

// ── Completed, per list (session 2, P1.3) ─────────────────────────────
// The To Do pattern: done items sit in their own group at the foot of the
// list, OPEN by default (nothing is hidden until you ask), and the fold is
// remembered per list for this session. In memory, not localStorage: a
// stored preference is one more key for the cleaner to police, for
// something that costs one click to redo.
let _tbDoneOpen={};
function _tbCompleted(listId,done,today){
  if(!done.length)return'';
  const open=_tbDoneOpen[listId]!==false;
  // Most recently completed first -- the thing you just ticked is the thing
  // you are most likely to want back.
  const rows=done.slice().sort((a,b)=>Number(b.completedAt||0)-Number(a.completedAt||0));
  return'<div class="tb-card tb-donegroup'+(open?' open':'')+'">'
    +'<button class="tb-cardh tb-donetoggle" aria-expanded="'+(open?'true':'false')+'"'
      +' onclick="window.tbToggleCompleted(\''+_tbJs(listId)+'\')">'
      +_tbIcon(open?'chevron-down':'chevron-right','sm')+'Completed'
      +'<span class="tb-count">'+done.length+'</span></button>'
    +(open?rows.map(i=>_tbRow(i,today,{inList:true})).join(''):'')
  +'</div>';
}
window.tbToggleCompleted=function(listId){
  _tbDoneOpen[listId]=!(_tbDoneOpen[listId]!==false);
  _tbRepaint();
};

/** The item's DETAIL PANE (session 2, P1.4 -- the To Do pattern; it was a
 *  drawer laid over the page). Desktop: the third column, beside the list,
 *  so the list stays visible and clickable while an item is open. Below
 *  1024px it is still a panel over the page, and a full sheet on a phone.
 *  Top to bottom: kind, lock, close · the TITLE CARD (round check, title,
 *  star, the steps and "Add step") · PROPERTY ROWS (My Day, date, people,
 *  list, lane, priority, kind) · note · files · comments · activity · a
 *  footer (hand over, done, who created it, delete). Every id and handler
 *  the drawer had is kept, so nothing that drives it moved.
 *  Still named _tbDrawer, with class tb-drawer: the tests, the shortcut
 *  table ("close-drawer") and smoke-board all find it by that name. */
function _tbDrawer(){
  if(!_tbOpenItemId)return'';
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it)return'';
  const me=_tbMe(),today=_tbToday();
  const id=_tbEsc(it.id),jid=_tbJs(it.id);
  // READ-ONLY for someone the rules will not let change it: they can read
  // it and comment, and every other control says so instead of offering a
  // write that would be refused.
  const ro=!_tbCanEditIt(it);
  const dis=ro?' disabled title="'+_TB_NOT_ON+'"':'';
  const canMove=!ro&&tbCanMoveDate(it,me,_tbIsBoardOwner());
  const pr=tbStepProgress(it);
  const lockedBy=it.locked?tbUser(it.lockedBy):null;
  const moved=it.datePlanned&&it.date&&it.datePlanned!==it.date;
  const done=it.status==='done';
  const starred=!done&&(it.myDay||{})[me]===today;
  const opt=(v,cur,label)=>'<option value="'+_tbEsc(v)+'"'+(v===cur?' selected':'')+'>'+_tbEsc(label||v)+'</option>';
  // One property row: icon, label, control. A <label> so a tap on the
  // label reaches the control.
  const prop=(icon,label,control,extra)=>'<label class="tb-prop">'+_tbIcon(icon)
    +'<span class="tb-proplabel">'+_tbEsc(label)+'</span>'
    +'<span class="tb-propval">'+control+(extra||'')+'</span></label>';
  const owner=it.ownerUid?tbUser(it.ownerUid):null;
  const made=it.createdAt?_tbDay(new Date(Number(it.createdAt))):'';
  return'<aside class="tb-drawer tb-pane" id="tb-drawer" aria-label="Item details">'
    +'<div class="tb-pbar">'
      +'<span class="tb-kind tb-kind-'+_tbEsc(it.kind)+'">'+_tbEsc(_tbCap(it.kind))+'</span>'
      +'<button class="tb-lockbtn'+(it.locked?' on':'')+'" onclick="window.tbToggleLock(\''+jid+'\')"'
        +(ro?dis:(it.locked&&!canMove?' disabled title="only '+_tbEsc(lockedBy.name)+' or a board owner can unlock this"':''))
        +'>'+_tbIcon(it.locked?'lock':'lock-open','sm')+(it.locked?'Locked':'Lock')+'</button>'
      +'<button class="tb-pclose" title="Close (Esc)" aria-label="Close" onclick="window.tbCloseItem()">'+_tbIcon('x')+'</button>'
    +'</div>'
    +(it.locked&&!canMove?'<div class="tb-lockwho">Locked by '+_tbEsc(lockedBy.name)+'</div>':'')
    +(ro?'<div class="tb-lockwho tb-rowho">You are not on this item, so you can read it and comment, but not change it.</div>':'')
    // A locked item you cannot move is not a dead end (spec s7.4): the
    // ask goes into the thread, where the answer belongs.
    +(it.locked&&!canMove?_tbMoveReqSection(it):'')

    // ── the title card ──
    +'<div class="tb-pcard tb-phead">'
      +'<div class="tb-ptitle">'
        +'<button class="tb-check'+(done?' on':'')+'" title="'+(ro?_TB_NOT_ON:(done?'Mark not done':'Mark done'))+'"'
          +' aria-label="'+(done?'Mark not done':'Mark done')+'" aria-pressed="'+(done?'true':'false')+'"'
          +(ro?' disabled':'')+' onclick="window.tbToggleDone(\''+jid+'\')">'+_tbIcon('check','sm')+'</button>'
        // A TEXTAREA sized to its content, not an input: the real titles
        // run to two lines, and an input showed "Hyderabad supplier in
        // Karachi:" and nothing more (seen on the P1.4 screenshots). Enter
        // still commits -- a title is one line -- and blurring saves.
        +'<textarea class="tb-dtitle'+(done?' done':'')+'" id="tb-d-title" rows="1" maxlength="140"'
          +' aria-label="Title"'+(ro?' readonly':'')+' onkeydown="window.tbTitleKey(event)"'
          +' onchange="window.tbFieldChange(\'title\',this.value)">'+_tbEsc(it.title||'')+'</textarea>'
        +(done||ro?'':'<button class="tb-star'+(starred?' on':'')+'" title="'+(starred?'Remove from My Day':'Add to My Day')+'"'
          +' aria-label="'+(starred?'Remove from My Day':'Add to My Day')+'" aria-pressed="'+(starred?'true':'false')+'"'
          +' onclick="window.tbAddToMyDay(\''+jid+'\')">'+_tbIcon('star')+'</button>')
      +'</div>'
      +(pr.allDone?'<div class="tb-hint">All steps done — mark the item done when you have reviewed it.</div>':'')
      +'<div class="tb-stepl">'+(it.steps||[]).map((st,i)=>
        '<div class="tb-step"><button class="tb-check tb-check-sm'+(st.done?' on':'')+'"'
          +' aria-label="'+(st.done?'Mark step not done':'Mark step done')+'"'+dis+' onclick="window.tbToggleStep('+i+')">'+_tbIcon('check','sm')+'</button>'
        +_tbSlot(st.title||'','tb-steptitle'+(st.done?' done':''))
        +(ro?'':'<button class="tb-x" onclick="window.tbRemoveStep('+i+')" title="Remove step" aria-label="Remove step">'+_tbIcon('x','sm')+'</button>')+'</div>').join('')
      +'</div>'
      +(ro?(pr.label?'<div class="tb-steps">'+_tbEsc(pr.label)+'</div>':''):'<label class="tb-stepaddrow">'+_tbIcon('plus')
        +'<input class="tb-stepadd" id="tb-step-new" placeholder="'+((it.steps||[]).length?'Next step':'Add step')+'"'
        +' aria-label="Add step" onkeydown="window.tbStepKey(event)">'
        +(pr.label?'<span class="tb-steps">'+_tbEsc(pr.label)+'</span>':'')
      +'</label>')
    +'</div>'

    // ── property rows ──
    +'<div class="tb-pcard tb-props">'
      +(done||ro?'':'<button class="tb-prop tb-propbtn'+(starred?' on':'')+'" onclick="window.tbAddToMyDay(\''+jid+'\')">'
        +_tbIcon('sun')+'<span class="tb-proplabel tb-propwide">'+(starred?'Added to My Day':'Add to My Day')+'</span></button>')
      +prop('calendar','Date','<input type="date" data-tb-fp id="tb-d-date" value="'+_tbEsc(it.date||'')+'"'+(canMove?'':' disabled')
        +' onchange="window.tbFieldChange(\'date\',this.value)">',
        moved?'<span class="tb-was">was '+_tbEsc(_tbCap(tbDayLabel(it.datePlanned,today)))+'</span>':'')
      +'<div class="tb-prop tb-propstack">'+_tbIcon('users')+'<span class="tb-proplabel">People</span>'
        +'<div class="tb-people">'
        +tbPeople().map(p=>{
          // Listed even when they cannot be assigned yet, and saying why --
          // a person who silently is not there reads as a missing feature.
          if(!p.uid)return'<button class="tb-person tb-person-off" disabled title="'+_tbEsc(tbPersonOffText(p))+'">'
            +_tbEsc(p.name)+' · '+(p.reason==='unread'?'not loaded':p.reason==='ambiguous'?'check profile':'not set up')+'</button>';
          const on=(it.assigneeUids||[]).indexOf(p.uid)>-1;
          return'<button class="tb-person'+(on?' on':'')+'" aria-pressed="'+(on?'true':'false')+'"'+dis
            +' onclick="window.tbToggleAssignee(\''+_tbJs(p.uid)+'\')">'+_tbEsc(tbUser(p.uid).name)+'</button>';
        }).join('')
      +'</div></div>'
      +prop('list','List','<select id="tb-d-list"'+dis+' onchange="window.tbFieldChange(\'listId\',this.value)">'
        +opt('',it.listId||'','None')
        +tbLists.filter(l=>!l.archived).map(l=>opt(l.id,it.listId||'',l.title||'untitled')).join('')
      +'</select>')
      +prop('tag','Lane','<select id="tb-d-lane"'+dis+' onchange="window.tbFieldChange(\'lane\',this.value)">'
        +opt('',it.lane||'','None')+TB_LANES.map(l=>opt(l,it.lane||'',_tbCap(l))).join('')
      +'</select>')
      +prop('flag','Priority','<select id="tb-d-pri"'+dis+' onchange="window.tbFieldChange(\'priority\',this.value)">'
        +opt('0',String(it.priority),'Normal')+opt('1',String(it.priority),'High')+opt('2',String(it.priority),'Critical')
      +'</select>')
      +prop('circle','Kind','<select id="tb-d-kind"'+dis+' onchange="window.tbFieldChange(\'kind\',this.value)">'
        +TB_KINDS.map(k=>opt(k,it.kind,_tbCap(k))).join('')
      +'</select>')
    +'</div>'

    // ── the note ──
    +'<div class="tb-pcard tb-pnote">'
      +'<textarea class="tb-notes" id="tb-d-notes" rows="4" placeholder="'+(ro?'':'Add a note')+'" aria-label="Note"'+(ro?' readonly':'')
        +' oninput="window.tbNotesInput(this.value)">'+_tbEsc(it.notes||'')+'</textarea>'
      +'<div class="tb-savestate" id="tb-d-save"></div>'
    +'</div>'
    +_tbFilesSection(it,ro)
    +_tbThreadSection(it)
    +_tbActivitySection(it)

    // ── the footer ──
    +'<div class="tb-dfoot">'
      +(ro?'':'<button class="btn-outline" onclick="window.tbOpenHandover()">'+_tbIcon('arrow-right-left','sm')+'Hand over</button>'
      +'<button class="btn-primary" onclick="window.tbToggleDone(\''+jid+'\')">'+(done?'Reopen':'Mark done')+'</button>')
      +(it.ownerUid===me||_tbIsBoardOwner()
        ?'<button class="tb-x tb-del" onclick="window.tbDeleteItem(\''+jid+'\')" title="Delete" aria-label="Delete">'+_tbIcon('trash-2')+'</button>':'')
    +'</div>'
    +(owner?'<div class="tb-pmade">Created by '+_tbEsc(owner.uid===me?'you':owner.name)
      +(made?' · '+_tbEsc(_tbCap(tbDayLabel(made,today))):'')+'</div>':'')
    +'<div id="tb-handover"></div>'
    // ONE picker for both destinations — _tbPickFor says which — so there
    // is no second hidden input to keep in step with the first.
    +'<input type="file" id="tb-filepick" multiple style="display:none"'
      +' onchange="window.tbFilesPicked(this)">'
  +'</aside>';
}

// ── Writing ───────────────────────────────────────────────────────────
// Every mutation: decide with a pure function, write the item and its
// activity row in ONE batch, update memory, repaint. An activity row
// written separately is one that goes missing when the item write fails.

function _tbNow(){ return Date.now(); }
/** The batch that carries an item change and its log together. */
async function _tbCommit(itemId,data,activity){
  const b=writeBatch(db);
  b.update(doc(db,'board_items',itemId),data);
  (Array.isArray(activity)?activity:(activity?[activity]:[])).forEach(a=>{
    b.set(doc(collection(db,'board_items',itemId,'activity')),a);
  });
  await b.commit();
}
/** Apply to the in-memory copy so the repaint is instant; the write is
 *  already queued and Firestore's offline cache will carry it. */
function _tbApplyLocal(id,data){
  const i=tbItems.filter(x=>x.id===id)[0];
  if(i)Object.assign(i,data);
  return i;
}
function _tbToast(m){ if(typeof showToast==='function')showToast(m); }
/** A write that failed must SAY so and put the row back — a silently
 *  refused write reads exactly like a bug in the UI. */
async function _tbTry(fn,what){
  try{ await fn(); return true; }
  catch(e){
    console.warn('[the board] '+what+' failed',e);
    const msg=String((e&&e.message)||e);
    _tbToast(/permission/i.test(msg)
      ?'Refused — this item may be locked, or firestore.rules is not deployed yet.'
      :('Could not '+what+'.'));
    await loadTbData(true);           // re-read rather than guess
    _tbRepaint();
    return false;
  }
}

window.tbRetry=function(){ tbLoaded=false; _tbRepaint(true); };

// ── Create ────────────────────────────────────────────────────────────
// ══ SESSION 2 — P0.5: THE QUICK-ADD COMPOSER ═════════════════════════
// One input that opens, on focus, into a row of chips: Date (Today /
// Tomorrow / Next Mon / a date field), Assign (the five), List and Lane.
// Enter creates.
//
// NO DATE MEANS UNDATED. It used to default to today on the Dashboard, so
// "title, Enter" made a task due today that nobody had asked for (the
// brief's own example). An undated item lands in Needs a date, which is
// what an item with no date IS.
//
// A date typed in the title ("oct 5") FILLS the Date chip, live, and a
// date picked on the chip outranks it -- the chip is the more deliberate
// of the two, the rule tbCreateOn already applies to a calendar day's "+".
//
// The composer's state lives HERE, not in the DOM: a repaint (a live
// update, a chip click) rebuilds the markup, and text that lived only in
// an input would be lost. Chip clicks repaint the chip row alone and keep
// the caret in the input (pointerdown preventDefault), so typing is never
// interrupted.
let _tbQa={open:false,text:'',date:'',dateSet:false,assign:[],unassign:[],listId:undefined,lane:'',laneSet:false};
function _tbQaReset(keepOpen){
  _tbQa={open:!!keepOpen,text:'',date:'',dateSet:false,assign:[],unassign:[],listId:undefined,lane:'',laneSet:false};
}
/** Does the composer hold anything a keystroke or a stray click would
 *  throw away? ONE definition, so Escape and the outside click agree
 *  (review of 05431c2: Escape ignored a picked lane or list, closed the
 *  composer with it still set, and the next item landed in that lane). */
function _tbQaHasContent(){
  const q=_tbQa;
  return !!(q.text||q.dateSet||(q.assign||[]).length||(q.unassign||[]).length
    ||q.laneSet||q.lane||q.listId!==undefined);
}
/** A day typed into the native field is only taken once it is a real,
 *  plausible day: typing 10052026 passes through 0002-, 0020- and
 *  0202-10-05 on the way, and 0202 is a valid date (review of 05431c2). */
function _tbSaneDay(d){
  if(!_tbValidDay(d))return false;
  const y=Number(String(d).slice(0,4));
  return y>=2000&&y<=2099;
}
/** The list on SCREEN: the one open on the Lists page, else none.
 *  `_tbListId` outlives the page (it is what the Lists page reopens), so it
 *  is never the default for a new item anywhere else -- it used to be, and
 *  after opening any list, or making one from the rail, a Dashboard or
 *  calendar add went silently into that list and took its visibility
 *  (review of f256c83). */
function _tbViewList(){
  return(_tbOnPage('tb-lists')&&_tbListId&&tbLists.some(l=>l.id===_tbListId))?_tbListId:null;
}
function _tbOnPage(id){ return String((typeof currentPage!=='undefined'&&currentPage)||'')===id; }
/** The list a new item lands in: the chip's choice, else the list you are
 *  looking at, else none. */
function _tbQaList(){ return _tbQa.listId!==undefined?(_tbQa.listId||null):_tbViewList(); }
function _tbQaParse(){
  return tbParseQuickAdd(_tbQa.text,{today:_tbToday(),handles:tbHandleMap(),boardHandles:_tbBoardUsernames()});
}
/** What the new item WILL be, from the text and the chips together. Pure
 *  over its inputs, so the preview and the create cannot disagree. */
function tbComposerPlan(parsed,qa,me,listFallback){
  const p=parsed||{},q=qa||{};
  // A chip can switch OFF a person the title named (q.unassign); nothing
  // switches off yourself.
  const off=q.unassign||[];
  const assignees=[me].concat(p.assigneeUids||[]).concat(q.assign||[])
    .filter((u,i,a)=>u&&a.indexOf(u)===i&&(u===me||off.indexOf(u)<0));
  return{
    title:p.title||'',
    date:q.dateSet?(q.date||null):(p.date||null),
    dateFromText:!q.dateSet&&!!p.date,
    assigneeUids:assignees,
    // "none" on the lane chip means none, even when the title says #denim
    // (laneSet is the lane's dateSet).
    lane:q.laneSet?(q.lane||null):(q.lane||p.lane||null),
    listId:q.listId!==undefined?(q.listId||null):(listFallback||null),
    priority:p.priority||0,
    pendingHandles:p.pendingHandles||[],unknownHandles:p.unknownHandles||[]
  };
}
function _tbComposer(placeholder){
  return'<div class="tb-quick'+(_tbQa.open?' open':'')+'" id="tb-quick">'
    +'<input id="tb-qa" class="tb-qainput" placeholder="'+_tbEsc(placeholder)+'"'
      +' value="'+_tbEsc(_tbQa.text)+'"'
      +' onfocus="window.tbQaFocus()" oninput="window.tbQuickPreview()" onkeydown="window.tbQuickKey(event)" autocomplete="off">'
    +'<div id="tb-qa-chips" class="tb-qachips">'+(_tbQa.open?_tbQaChipsHTML():'')+'</div>'
    +'<div id="tb-qa-prev" class="tb-qaprev"></div>'
  +'</div>';
}
function _tbQaChipsHTML(){
  const today=_tbToday(),me=_tbMe();
  const plan=tbComposerPlan(_tbQaParse(),_tbQa,me,_tbViewList());
  const keep=' onpointerdown="event.preventDefault()"';   // the caret stays in the title
  const dateBtn=(d,l)=>'<button type="button" class="tb-qachip'+(plan.date===d?' on':'')+'"'+keep
    +' onclick="window.tbQaDate(\''+_tbJs(d)+'\')">'+_tbEsc(l)+'</button>';
  const nextMon=_tbNextDow(_tbDayAdd(today,1),1);
  const dateLabel=plan.date?tbDayLabel(plan.date,today)+(plan.dateFromText?' (from the title)':''):'no date';
  const people=tbPeople().map(function(p){
    if(!p.uid)return'<button type="button" class="tb-qachip tb-qachip-off" disabled title="'+_tbEsc(tbPersonOffText(p))+'">'+_tbEsc(p.name)+'</button>';
    if(p.uid===me)return'<button type="button" class="tb-qachip on tb-qachip-me" disabled title="You are always on what you add">You</button>';
    const on=plan.assigneeUids.indexOf(p.uid)>-1;
    return'<button type="button" class="tb-qachip'+(on?' on':'')+'"'+keep
      +' onclick="window.tbQaAssign(\''+_tbJs(p.uid)+'\')">'+_tbEsc(p.name)+'</button>';
  }).join('');
  const opt=(v,cur,l)=>'<option value="'+_tbEsc(v)+'"'+(v===cur?' selected':'')+'>'+_tbEsc(l)+'</option>';
  return'<div class="tb-qarow"><span class="tb-qalabel">date</span>'
      +dateBtn(today,'Today')+dateBtn(_tbDayAdd(today,1),'Tomorrow')+dateBtn(nextMon,'Next Mon')
      +'<input type="date" data-tb-fp class="tb-qadate" id="tb-qa-date" value="'+_tbEsc(plan.date||'')+'"'
        +' onchange="window.tbQaDate(this.value,true)" onblur="window.tbQaDateBlur()">'
      +'<span class="tb-qadatenow'+(plan.date?'':' none')+'" id="tb-qa-datenow">'+_tbEsc(dateLabel)+'</span>'
      +(plan.date?'<button type="button" class="tb-qachip tb-qaclear"'+keep+' onclick="window.tbQaDate(\'\')" title="no date">&times;</button>':'')
    +'</div>'
    +'<div class="tb-qarow"><span class="tb-qalabel">assign</span>'+people+'</div>'
    +'<div class="tb-qarow"><span class="tb-qalabel">list</span>'
      +'<select class="tb-qasel" id="tb-qa-list" onchange="window.tbQaSet(\'listId\',this.value)">'
        +opt('',plan.listId||'','none')
        +tbLists.filter(l=>!l.archived).map(l=>opt(l.id,plan.listId||'',l.title||'untitled')).join('')
      +'</select>'
      +'<span class="tb-qalabel">lane</span>'
      +'<select class="tb-qasel" id="tb-qa-lane" onchange="window.tbQaSet(\'lane\',this.value)">'
        +opt('',plan.lane||'','none')+TB_LANES.map(l=>opt(l,plan.lane||'',l)).join('')
      +'</select>'
    +'</div>';
}
/** Repaint the chip row and the preview line only -- never the input. */
function _tbQaPaint(){
  const chips=document.getElementById('tb-qa-chips');
  // NEVER rebuild the date field someone is typing into: the rebuild took
  // the caret out after the first digit (review of 05431c2). Only the
  // label moves until they leave it (tbQaDateBlur).
  const ae=(typeof document!=='undefined'&&document.activeElement)||null;
  const typing=!!(ae&&ae.id==='tb-qa-date');
  if(chips&&typing){
    const now=document.getElementById('tb-qa-datenow');
    if(now){
      const plan=tbComposerPlan(_tbQaParse(),_tbQa,_tbMe(),_tbViewList());
      now.textContent=plan.date?tbDayLabel(plan.date,_tbToday()):'no date';
    }
  }else if(chips){ chips.innerHTML=_tbQa.open?_tbQaChipsHTML():''; _tbFpPrune(false); _tbPickers(chips); }
  const wrap=document.getElementById('tb-quick');
  if(wrap&&wrap.classList)wrap.classList[_tbQa.open?'add':'remove']('open');
  const out=document.getElementById('tb-qa-prev');
  if(!out)return;
  const parsed=_tbQaParse();
  const plan=tbComposerPlan(parsed,_tbQa,_tbMe(),_tbViewList());
  const names={};
  Object.keys(tbHandleMap()).forEach(h=>{names[h]=tbUser(tbHandleMap()[h]).name;});
  const others=plan.assigneeUids.filter(u=>u!==_tbMe()).map(u=>tbUser(u).name);
  const bits=[];
  if(plan.title)bits.push('“'+plan.title+'”');
  bits.push(plan.date?tbDayLabel(plan.date,_tbToday()):'no date');
  if(others.length)bits.push(others.join(', '));
  if(plan.lane)bits.push(plan.lane);
  if(plan.priority===2)bits.push('critical');else if(plan.priority===1)bits.push('high');
  out.textContent=(_tbQa.text||plan.date||others.length||plan.lane?'→ '+bits.join(' · '):'')
    +(plan.unknownHandles.length
      ?'   (@'+plan.unknownHandles.join(', @')+' is not on The Board — left in the title)':'')
    +(plan.pendingHandles.length
      ?(_tbLoadFailed('user_profiles')
        ?'   (@'+plan.pendingHandles.join(', @')+' cannot be matched — the team directory did not load)'
        :'   (@'+plan.pendingHandles.join(', @')+' is not set up yet — not assigned; an owner can press Sync accounts on the Profile page)'):'');
}
window.tbQaFocus=function(){
  if(_tbQa.open)return;
  _tbQa.open=true;
  _tbQaPaint();
};
window.tbQaDate=function(d,fromField){
  // From the field: a half-typed value is not a choice yet. Ignore it,
  // rather than recording "no date" (which wiped a date chosen earlier).
  if(fromField&&d&&!_tbSaneDay(d))return;
  _tbQa.dateSet=true;
  _tbQa.date=(d&&_tbSaneDay(d))?d:'';
  _tbQaPaint();
};
window.tbQaDateBlur=function(){ if(_tbQa.open)setTimeout(_tbQaPaint,0); };
window.tbQaAssign=function(uid){
  const q=_tbQa;
  q.unassign=q.unassign||[];
  const on=tbComposerPlan(_tbQaParse(),q,_tbMe(),_tbViewList()).assigneeUids.indexOf(uid)>-1;
  const rm=(a,u)=>{ const i=a.indexOf(u); if(i>-1)a.splice(i,1); };
  if(on){
    rm(q.assign,uid);
    // Still on means the TITLE named them: switch that off too.
    if(tbComposerPlan(_tbQaParse(),q,_tbMe(),_tbViewList()).assigneeUids.indexOf(uid)>-1)q.unassign.push(uid);
  }else{
    rm(q.unassign,uid);
    if(tbComposerPlan(_tbQaParse(),q,_tbMe(),_tbViewList()).assigneeUids.indexOf(uid)<0)q.assign.push(uid);
  }
  _tbQaPaint();
};
window.tbQaSet=function(k,v){
  if(k==='listId')_tbQa.listId=v||'';
  else if(k==='lane'){ _tbQa.lane=(TB_LANES.indexOf(v)>-1)?v:''; _tbQa.laneSet=true; }
  _tbQaPaint();
};
window.tbQuickPreview=function(){
  const el=document.getElementById('tb-qa');
  if(el)_tbQa.text=String(el.value||'');
  _tbQaPaint();
};
window.tbQuickKey=function(e){
  if(e.key==='Escape'){
    // Empty: close it. Not empty: clear it first -- losing a half-typed
    // title to one keystroke would be worse than a second press.
    if(_tbQaHasContent()){ _tbQaReset(true); const el=document.getElementById('tb-qa'); if(el)el.value=''; }
    else{ _tbQa.open=false; const el=document.getElementById('tb-qa'); if(el&&el.blur)el.blur(); }
    _tbQaPaint();
    return;
  }
  if(e.key!=='Enter')return;
  e.preventDefault();
  const el=document.getElementById('tb-qa');
  if(el)_tbQa.text=String(el.value||'');
  if(!String(_tbQa.text).trim())return;
  // Shift+Enter opens the drawer on the new item for detail (spec s8.1).
  window.tbCreateFromQuick(_tbQa.text,e.shiftKey,true);
};
// Registered ONCE: a click outside an EMPTY composer closes it. One with
// anything in it stays open -- a stray click must not throw away a date.
// ON CLICK, NOT POINTERDOWN (review of 05431c2): closing on pointerdown
// collapsed the ~120px chip rows before pointerup, everything below
// jumped, pointerdown and pointerup landed on different rows, and the
// click that closed it never reached anything. The click's target is
// fixed by the time a capture listener sees it.
(function(){
  if(typeof document==='undefined'||!document.addEventListener)return;
  document.addEventListener('click',function(e){
    if(!_tbQa.open)return;
    const t=e&&e.target;
    if(t&&t.closest&&(t.closest('#tb-quick')||t.closest('.flatpickr-calendar')))return;
    if(_tbQaHasContent())return;
    _tbQa.open=false;
    _tbQaPaint();
  },true);
})();

window.tbCreateFromQuick=async function(text,openAfter,fromComposer){
  const me=_tbMe();
  const parsed=tbParseQuickAdd(text,{today:_tbToday(),handles:tbHandleMap(),boardHandles:_tbBoardUsernames()});
  if(!parsed.title){ _tbToast('Give it a title.'); return; }
  // The chips count only when the text came FROM the composer; a caller
  // passing plain text (a test, a future shortcut) gets the grammar alone.
  const plan=tbComposerPlan(parsed,fromComposer?_tbQa:{},me,_tbViewList());
  // CLEARED BEFORE THE WRITE, not after it (review of 05431c2). The text
  // used to stay in the box until commit() resolved -- a network round
  // trip, and never, offline -- so a second Enter (a double press, key
  // repeat) created the same item again. It comes back if the write is
  // refused, unless something new has been typed since.
  let saved=null;
  if(fromComposer){
    saved=Object.assign({},_tbQa,{assign:(_tbQa.assign||[]).slice(),unassign:(_tbQa.unassign||[]).slice()});
    _tbQaReset(true); _tbQaRefocus=true;
    const el=typeof document!=='undefined'&&document.getElementById('tb-qa');
    if(el)el.value='';
    _tbQaPaint();
  }
  const data=tbNewItem({
    title:plan.title,
    assigneeUids:plan.assigneeUids,
    lane:plan.lane,
    priority:plan.priority,
    listId:plan.listId,
    date:plan.date                    // NEVER today by default (session 2)
  },me,_tbNow(),tbLists);
  const ok=await _tbTry(async()=>{
    const ref=doc(collection(db,'board_items'));
    const b=writeBatch(db);
    b.set(ref,data);
    b.set(doc(collection(db,'board_items',ref.id,'activity')),
      {type:'created',byUid:me,at:data.createdAt,payload:{}});
    await b.commit();
    _tbLiveRemember('items_own',ref.id,data);
    _tbUpsert(tbItems,tbDecodeItem(Object.assign({id:ref.id},data)));
    if(openAfter){ _tbFlushNotes(); _tbOpenItemId=ref.id; }
    // Ready for the next one: still open, caret back in it.
    if(fromComposer)_tbQaRefocus=true;
    _tbRepaint();
    if(parsed.pendingHandles.length)_tbToast(_tbPendingToast(parsed.pendingHandles));
    else if(!data.date)_tbToast('Added with no date — it is in Needs a date.');
  },'add that');
  if(!ok&&saved&&!_tbQaHasContent()){
    _tbQa=Object.assign(saved,{open:true});
    _tbQaRefocus=true;
    _tbRepaint();
  }
};
let _tbQaRefocus=false;

// ── Edit ──────────────────────────────────────────────────────────────
window.tbFieldChange=async function(field,value){
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it||_tbNotOnIt(it))return;
  let v=value;
  if(field==='priority')v=Number(value);
  if(field==='listId'||field==='lane')v=value||null;
  if(field==='date')v=value||null;
  if(field==='kind'&&TB_KINDS.indexOf(v)<0)return;
  // The title is a textarea now (P1.4): a pasted line break is not part of
  // a title.
  if(field==='title')v=String(value==null?'':value).replace(/\s*[\r\n]+\s*/g,' ').trim();
  const plan=tbItemPatch(it,_tbObj(field,v),_tbMe(),_tbNow());
  if(!Object.keys(plan.data).filter(k=>k!=='updatedAt'&&k!=='lastActivityAt').length)return;
  await _tbTry(async()=>{
    await _tbCommit(it.id,plan.data,plan.activity);
    _tbApplyLocal(it.id,plan.data);
    _tbRepaint();
  },'save that');
};
function _tbObj(k,v){ const o={}; o[k]=v; return o; }
/** Enter commits the title (blur fires the change); Escape puts it back. */
window.tbTitleKey=function(e){
  if(!e)return;
  if(e.key==='Enter'){ if(e.preventDefault)e.preventDefault(); if(e.target&&e.target.blur)e.target.blur(); }
};

window.tbToggleAssignee=async function(uid){
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it||_tbNotOnIt(it))return;
  const cur=(it.assigneeUids||[]).slice();
  const i=cur.indexOf(uid);
  if(i>-1)cur.splice(i,1); else cur.push(uid);
  if(!cur.length){ _tbToast('Someone has to be on it.'); return; }
  const plan=tbItemPatch(it,{assigneeUids:cur},_tbMe(),_tbNow());
  await _tbTry(async()=>{
    await _tbCommit(it.id,plan.data,plan.activity);
    _tbApplyLocal(it.id,plan.data);
    _tbRepaint();
  },'change who is on this');
};

window.tbToggleLock=async function(id){
  const it=tbItems.filter(i=>i.id===id)[0];
  if(!it||_tbNotOnIt(it))return;
  const me=_tbMe();
  if(it.locked&&!tbCanMoveDate(it,me,_tbIsBoardOwner())){
    _tbToast('Locked by '+tbUser(it.lockedBy).name+'.');
    return;
  }
  const next=!it.locked;
  const plan=tbItemPatch(it,{locked:next,lockedBy:next?me:null},me,_tbNow());
  await _tbTry(async()=>{
    await _tbCommit(it.id,plan.data,plan.activity);
    _tbApplyLocal(it.id,plan.data);
    _tbRepaint();
  },'change the lock');
};

// Notes autosave, 800ms after the last keystroke (spec s8.3). Last write
// wins; there is no merge in v1 and the drawer says nothing about one.
//
// THE PENDING TEXT CARRIES THE ITEM IT WAS TYPED IN (review of d38b96c).
// The timer used to save to whichever item was open WHEN IT FIRED, so
// typing in one item's notes and opening another within 800ms wrote the
// first item's text over the second's. Opening or closing an item now
// flushes what is pending to its own item first.
let _tbNotesTimer=null,_tbNotesPend=null;
window.tbNotesInput=function(v){
  const st=document.getElementById('tb-d-save');
  if(st)st.textContent='unsaved…';
  _tbNotesPend={id:_tbOpenItemId,v:String(v||'')};
  if(_tbNotesTimer)clearTimeout(_tbNotesTimer);
  _tbNotesTimer=setTimeout(_tbFlushNotes,800);
};
function _tbFlushNotes(){
  if(_tbNotesTimer){ clearTimeout(_tbNotesTimer); _tbNotesTimer=null; }
  const p=_tbNotesPend;_tbNotesPend=null;
  return(p&&p.id)?window.tbSaveNotes(p.v,p.id):Promise.resolve();
}
window.tbSaveNotes=async function(v,id){
  const it=tbItems.filter(i=>i.id===(id||_tbOpenItemId))[0];
  const val=String(v||'');
  if(!it||String(it.notes||'')===val||!_tbCanEditIt(it))return;
  const prev=it.notes;
  const status=t=>{ if(_tbOpenItemId!==it.id)return; const e=document.getElementById('tb-d-save'); if(e)e.textContent=t; };
  status('saving…');
  // In memory first, like every other field, so reopening the item before
  // the write resolves shows what was typed (offline it never resolves).
  it.notes=val;
  const ok=await _tbTry(async()=>{
    await _tbCommit(it.id,{notes:val,updatedAt:_tbNow(),lastActivityAt:_tbNow()},null);
  },'save the notes');
  if(!ok&&it.notes===val)it.notes=prev;
  status(ok?'saved':'save failed');
};

// ── Steps ─────────────────────────────────────────────────────────────
window.tbStepKey=function(e){
  if(e.key!=='Enter')return;
  e.preventDefault();
  const el=document.getElementById('tb-step-new');
  if(!el||!String(el.value).trim())return;
  const t=el.value.trim();
  el.value='';
  window.tbAddStep(t);
};
window.tbAddStep=async function(title){
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it||_tbNotOnIt(it))return;
  if((it.steps||[]).length>=30){ _tbToast('Thirty steps is the limit — this wants to be its own list.'); return; }
  const steps=(it.steps||[]).concat([{id:'s'+_tbNow()+Math.floor(Math.random()*1000),title:String(title).slice(0,140),done:false,doneByUid:null,doneAt:null}]);
  await _tbStepsWrite(it,steps,null);
};
window.tbToggleStep=async function(i){
  const it=tbItems.filter(x=>x.id===_tbOpenItemId)[0];
  if(!it||!it.steps[i]||_tbNotOnIt(it))return;
  const steps=it.steps.map((s,n)=>n!==i?s:Object.assign({},s,
    {done:!s.done,doneByUid:!s.done?_tbMe():null,doneAt:!s.done?_tbNow():null}));
  // Completing the LAST step does not complete the item — people want to
  // review first (spec s8.3). The drawer shows a hint instead.
  await _tbStepsWrite(it,steps,steps[i].done?{type:'step_done',byUid:_tbMe(),at:_tbNow(),payload:{title:steps[i].title}}:null);
};
window.tbRemoveStep=async function(i){
  const it=tbItems.filter(x=>x.id===_tbOpenItemId)[0];
  if(!it||!it.steps[i]||_tbNotOnIt(it))return;
  await _tbStepsWrite(it,it.steps.filter((s,n)=>n!==i),null);
};
async function _tbStepsWrite(it,steps,activity){
  await _tbTry(async()=>{
    await _tbCommit(it.id,{steps:steps,updatedAt:_tbNow(),lastActivityAt:_tbNow()},activity);
    it.steps=steps;
    _tbRepaint();
  },'update the steps');
}

// ── Done, my day, handover, delete ────────────────────────────────────
window.tbToggleDone=async function(id){
  const it=tbItems.filter(i=>i.id===id)[0];
  if(!it||_tbNotOnIt(it))return;
  const list=tbLists.filter(l=>l.id===it.listId)[0];
  const plan=tbDonePlan(it,_tbMe(),_tbNow(),list&&list.adminUid);
  await _tbTry(async()=>{
    await _tbCommit(it.id,plan.data,plan.activity);
    _tbApplyLocal(it.id,plan.data);
    (plan.notify||[]).forEach(uid=>_tbNotify({
      type:'done',forUid:uid,fromUid:_tbMe(),itemId:it.id,listId:it.listId,
      title:TB_NAME,message:tbUser(_tbMe()).name+' completed “'+(it.title||'')+'”'}));
    _tbRepaint();
  },'mark that done');
};
window.tbAddToMyDay=async function(id){
  const it=tbItems.filter(i=>i.id===id)[0];
  if(!it||_tbNotOnIt(it))return;
  const me=_tbMe(),today=_tbToday();
  const myDay=Object.assign({},it.myDay||{});
  if(myDay[me]===today)delete myDay[me]; else myDay[me]=today;
  await _tbTry(async()=>{
    await _tbCommit(it.id,{myDay:myDay,updatedAt:_tbNow()},null);
    _tbApplyLocal(it.id,{myDay:myDay});
    _tbToast(myDay[me]?'Added to My Day':'Removed from My Day');
    _tbRepaint();
  },'update my day');
};
window.tbOpenHandover=function(){
  const host=document.getElementById('tb-handover');
  if(!host)return;
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it)return;
  const me=_tbMe();
  host.innerHTML='<div class="tb-ho"><div class="tb-dsech">Hand Over</div>'
    +'<select id="tb-ho-who">'+tbPeople().map(p=>{
      const uid=p.uid;
      return (uid&&uid!==me)?'<option value="'+_tbEsc(uid)+'">'+_tbEsc(tbUser(uid).name)+'</option>':'';
    }).join('')+'</select>'
    +'<input id="tb-ho-note" placeholder="one line — what do they need to know?" maxlength="200">'
    +'<label class="tb-hokeep"><input type="checkbox" id="tb-ho-keep"> keep me on it</label>'
    +'<button class="btn-primary" onclick="window.tbHandOver()">Hand over</button></div>';
};
window.tbHandOver=async function(){
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it||_tbNotOnIt(it))return;
  const who=document.getElementById('tb-ho-who');
  const note=document.getElementById('tb-ho-note');
  const keep=document.getElementById('tb-ho-keep');
  const plan=tbHandoverPlan(it,_tbMe(),who&&who.value,note&&note.value,!!(keep&&keep.checked),_tbNow(),
    tbUser(who&&who.value).handle);
  if(plan.error){ _tbToast(plan.error); return; }
  await _tbTry(async()=>{
    const b=writeBatch(db);
    b.update(doc(db,'board_items',it.id),plan.data);
    b.set(doc(collection(db,'board_items',it.id,'activity')),plan.activity);
    b.set(doc(collection(db,'board_items',it.id,'comments')),plan.comment);
    await b.commit();
    _tbApplyLocal(it.id,plan.data);
    it.commentCount=(it.commentCount||0)+1;
    // The thread is already on screen in phase 4, so put the note in it
    // rather than waiting for the next read.
    const th=_tbThreads[it.id];
    if(th)th.comments=th.comments.concat([Object.assign({_id:'local'+_tbNow()},plan.comment)]);
    _tbNotify({type:'handover',forUid:plan.notifyUid,fromUid:_tbMe(),itemId:it.id,listId:it.listId,
      title:TB_NAME,message:tbUser(_tbMe()).name+' handed you “'+(it.title||'')+'” — '+plan.note});
    _tbToast('handed to '+tbUser(plan.notifyUid).name);
    _tbRepaint();
  },'hand that over');
};
window.tbDeleteItem=async function(id){
  const it=tbItems.filter(i=>i.id===id)[0];
  if(!it)return;
  if(typeof confirm==='function'&&!confirm('Delete “'+(it.title||'')+'”? This cannot be undone.'))return;
  await _tbTry(async()=>{
    await deleteDoc(doc(db,'board_items',id));
    tbItems=tbItems.filter(x=>x.id!==id);
    _tbOpenItemId=null;
    _tbToast('deleted');
    _tbRepaint();
  },'delete that');
};

// ── Lists ─────────────────────────────────────────────────────────────
window.tbNewList=async function(kind){
  const title=typeof prompt==='function'?prompt('Name the list'):'';
  if(!title||!String(title).trim())return;
  const me=_tbMe(),now=_tbNow();
  const data={
    title:String(title).trim().slice(0,80),
    kind:kind==='shared'?'shared':'private',
    adminUid:me,
    // The admin is ALWAYS a member, or their own shared list becomes
    // unreadable to them the moment the rules are enforced.
    memberUids:kind==='shared'?[me]:[me],
    color:'slate',emoji:null,sort:tbLists.length,archived:false,
    createdAt:now,updatedAt:now
  };
  await _tbTry(async()=>{
    const ref=doc(collection(db,'board_lists'));
    await setDoc(ref,data);
    _tbLiveRemember('lists_admin',ref.id,data);
    _tbUpsert(tbLists,Object.assign({id:ref.id},data));
    // Open it where it can be seen -- on the Lists page -- rather than
    // leaving it selected behind whatever page the rail was pressed on.
    _tbListId=ref.id;
    if(_tbOnPage('tb-lists'))_tbRepaint();
    else if(typeof showPage==='function')showPage('tb-lists'); else window.showPage('tb-lists');
  },'create the list');
};
window.tbOpenList=function(id){ _tbListId=id; _tbRepaint(); };
window.tbCloseList=function(){ _tbListId=null; _tbRepaint(); };
window.tbOpenItem=function(id){
  _tbFlushNotes();
  _tbOpenItemId=id;
  _tbMoveReqOpen=false;_tbShowActivity=false;_tbCloseMentions();
  _tbRepaint();
  // The thread is a subcollection, so it is read when a drawer OPENS —
  // 42 seeded items' threads is not something to pull on every page load.
  // loadTbThread cannot reject, so this needs no .catch.
  // Through the live repaint, which waits while someone is typing: the
  // thread arriving used to rebuild the pane under a title or a comment
  // being written (review of d38b96c).
  if(id)loadTbThread(id).then(function(){ if(_tbOpenItemId===id)_tbLiveRepaint(); });
};
window.tbCloseItem=function(){ _tbFlushNotes(); _tbOpenItemId=null; _tbCloseMentions(); _tbRepaint(); };

// ── Notifications ─────────────────────────────────────────────────────
// Everything goes through here, and here alone — see tbNotifPayload for
// why (the bell renders title and message RAW).
async function _tbNotify(o){
  const to=tbUser(o.forUid);
  if(!to.handle)return;                       // no username, no bell row
  const at=_tbNow();
  const id=_tbNotifId(o.type,o.itemId,o.fromUid,at);
  const row=tbNotifPayload(Object.assign({},o,{forUser:to.handle,at:at}));
  try{ await setDoc(doc(db,'hrm_notifications',id),row); }
  catch(e){ console.warn('[the board] notify failed',e); }   // never blocks the action
}

// ══ PHASE 3 — THE CALENDAR ════════════════════════════════════════════
// Month and week over the same items the Dashboard reads. Same rule as
// phase 2: every decision is a pure function and the drag is a thin
// wrapper around one, so "may this person move this" and "what does a
// move record" are assertable with no database and no pointer.
//
// Rows-by-person and the unscheduled tray are phase 5.

// The week starts MONDAY. Pakistan's weekend is Saturday and Sunday, so a
// Sunday-first grid splits the working week across two rows.
const TB_WEEK_START=1;
const TB_DOW_LABELS=['mon','tue','wed','thu','fri','sat','sun'];

// ── The grid ──────────────────────────────────────────────────────────
/** Which weekday a 'YYYY-MM-DD' falls on, 0=Sunday. Pure. */
function _tbDow(day){
  if(!_tbValidDay(day))return -1;
  const p=String(day).split('-').map(Number);
  return new Date(p[0],p[1]-1,p[2],12,0,0).getDay();
}
/** The Monday on or before `day`. Pure. */
function tbWeekStart(day){
  const d=_tbDow(day);
  if(d<0)return'';
  return _tbDayAdd(day,-(((d-TB_WEEK_START)+7)%7));
}
/** The seven days of the week holding `day`. Pure. */
function tbWeekDays(day){
  const s=tbWeekStart(day);
  if(!s)return[];
  const out=[];
  for(let i=0;i<7;i++)out.push(_tbDayAdd(s,i));
  return out;
}
/** `YYYY-MM` → the 5 or 6 rows of 7 the month needs, each day flagged
 *  with whether it belongs to the month or is spill from a neighbour.
 *  Pure — no clock is read, so a test can sit on any month. */
function tbMonthGrid(month){
  if(!/^\d{4}-\d{2}$/.test(String(month||'')))return[];
  const first=month+'-01';
  if(!_tbValidDay(first))return[];
  const last=_tbMonthLast(month);
  const start=tbWeekStart(first);
  const rows=[];
  let cur=start;
  // Run whole weeks until one starts after the month's last day. That is
  // what gives 5 rows for a short month and 6 for a long one, rather than
  // a fixed 6 with a blank trailing week.
  while(cur<=last){
    const week=[];
    for(let i=0;i<7;i++){
      const d=_tbDayAdd(cur,i);
      week.push({day:d,inMonth:d.slice(0,7)===month});
    }
    rows.push(week);
    cur=_tbDayAdd(cur,7);
  }
  return rows;
}
function _tbMonthLast(month){
  const p=String(month).split('-').map(Number);
  const d=new Date(p[0],p[1],0,12,0,0);   // day 0 of next month = last of this
  return _tbDay(d);
}
function _tbMonthAdd(month,n){
  const p=String(month).split('-').map(Number);
  const d=new Date(p[0],p[1]-1+Number(n||0),1,12,0,0);
  return _tbDay(d).slice(0,7);
}
const _TB_MONTH_NAMES=['january','february','march','april','may','june',
                       'july','august','september','october','november','december'];
function tbMonthLabel(month){
  const p=String(month||'').split('-');
  const i=Number(p[1])-1;
  return(_TB_MONTH_NAMES[i]||'')+' '+(p[0]||'');
}
/** "29 sep – 5 oct" — the week's own name. Pure. */
function tbWeekLabel(day){
  const d=tbWeekDays(day);
  if(!d.length)return'';
  const s=d[0].split('-'),e=d[6].split('-');
  const m=x=>_TB_MONTHS[Number(x)-1];
  return Number(s[2])+' '+m(s[1])+' – '+Number(e[2])+' '+m(e[1]);
}

// ── What the calendar shows ───────────────────────────────────────────
// The filters are ONE predicate, used by the month, the week and the
// counts — so a chip can never say 4 while the grid draws 3.
/** Pure. `scope` is 'me' or 'all'; an empty filter field means no filter. */
/** Everything the calendar's chips say, EXCEPT the date test. Extracted
 *  in phase 5 so the grid and the unscheduled tray read one predicate: a
 *  second copy is how a chip comes to say 4 while the tray draws 3. */
function _tbCalPass(i,f,uid){
  if(!i)return false;
  if(f.hideDone&&i.status==='done')return false;
  // 'me' is what I am ON, not what I own — the calendar answers "what is
  // my week", and something I set for someone else is not my week.
  if(f.scope!=='all'&&(i.assigneeUids||[]).indexOf(uid)<0)return false;
  if(f.scope==='all'&&i.visibility!=='shared'&&i.ownerUid!==uid)return false;
  if(f.person&&(i.assigneeUids||[]).indexOf(f.person)<0)return false;
  if(f.list&&i.listId!==f.list)return false;
  if(f.lane&&(i.lane||'')!==f.lane)return false;
  if(f.color&&tbItemColorKey(i,tbLists,tbUserColors())!==f.color)return false;
  return true;
}
function tbCalFilter(items,o){
  const f=o||{},uid=f.uid||'';
  return(items||[]).filter(i=>!!(i&&i.date)&&_tbCalPass(i,f,uid));
}
/** day → items, each day sorted gates-first then events then tasks. Pure. */
function tbItemsByDay(items){
  const map={};
  (items||[]).forEach(i=>{
    if(!i||!i.date)return;
    (map[i.date]=map[i.date]||[]).push(i);
  });
  Object.keys(map).forEach(d=>map[d].sort(_tbByKind));
  return map;
}
/** The markers the calendar draws as a rule down a day. Pure. */
function tbMarkersByDay(config){
  const out={};
  (((config||{}).markers)||[]).forEach(m=>{
    if(m&&m.date)(out[m.date]=out[m.date]||[]).push(String(m.label||''));
  });
  return out;
}

// ── Moving an item ────────────────────────────────────────────────────
/**
 * THE WHOLE POINT OF THE LOCK LIVES HERE. A drop is one pure decision:
 * refused with a reason, or a patch plus the history entry and the people
 * who need telling. The drag handler does no thinking of its own, and
 * `firestore.rules` enforces the same clause on the server — this is the
 * UI's echo, not the boundary.
 *
 * Pure.
 */
function tbMovePlan(item,toDay,uid,isOwner,now,lists){
  const it=item||{};
  if(!_tbValidDay(toDay))return{refused:true,reason:'That is not a date.'};
  if((it.date||null)===toDay)return{refused:true,reason:'',noop:true};
  if(!tbCanEdit(it,uid,isOwner,lists===undefined?tbLists:lists))
    return{refused:true,notOn:true,reason:'only the people on it can move it'};
  if(!tbCanMoveDate(it,uid,isOwner)){
    return{refused:true,locked:true,lockedBy:it.lockedBy||'',
           reason:'locked by '+tbUser(it.lockedBy).name};
  }
  const plan=tbItemPatch(it,{date:toDay},uid,now);
  // An OVERRIDE is logged as one. A board owner moving somebody else's
  // locked gate is exactly the thing a log exists to record.
  const override=!!(it.locked&&it.lockedBy&&it.lockedBy!==uid&&isOwner);
  if(override)plan.activity.forEach(a=>{a.payload=Object.assign({},a.payload,{override:true});});
  // Everyone else ON the item hears about it — a date somebody else moved
  // is the definition of something you need to know.
  const notify=(it.assigneeUids||[]).filter(u=>u&&u!==uid);
  return{data:plan.data,activity:plan.activity,notify:notify,override:override,
         from:it.date||null,to:toDay};
}

/** Keyboard nudge (spec s8.2): `[` / `]` a day, Shift+arrows a week.
 *  Pure — returns the day to move to, or '' when there is nothing to do. */
function tbNudgeTarget(item,delta){
  const from=(item||{}).date;
  if(!from||!_tbValidDay(from))return'';
  return _tbDayAdd(from,Number(delta||0));
}

// ── Calendar state ────────────────────────────────────────────────────
// Per VIEWER, in localStorage — a view preference is about the screen you
// are looking at, not about the board. Same rule the Mood Boards minimap
// and snap toggles follow.
let _tbCalView='month';
let _tbCalAnchor='';
let _tbCalFilters={scope:'me',person:'',list:'',lane:'',color:'',hideDone:false};
const _TB_CAL_KEY='groovy-tb-cal';

/** Spec s11: on a phone the calendar opens on the WEEK — a month grid
 *  is seven ~50px columns there, which fits a day number and nothing
 *  else. Only a DEFAULT: a saved preference is the person's own
 *  choice and outranks it. */
function _tbIsPhone(){
  // Spec s11's phone band is < 640. It was 600 through phases 3 and 4,
  // which left a 620px screen on the month grid it cannot render.
  try{ return !!(window.matchMedia&&window.matchMedia('(max-width:639px)').matches); }
  catch(e){ return false; }
}
// The calendar's filters, and the ONLY keys a stored filter may carry. The
// Sep 2026 freeze wrote a junk key ("[object Object],[object Object],...")
// holding a nested copy of the filters on every recursion, and the entry
// grew to 1.36 MB. A loader that Object.assign()ed whatever was stored
// would carry that forward and rewrite it on every save -- so the stored
// value is REBUILT from this list, never merged.
const _TB_CAL_FILTER_KEYS=['scope','person','list','lane','color','hideDone'];
const _TB_CAL_PREFS_MAX=4096;   // bytes; a real entry is ~150
/** Rebuild a stored filter from the known keys only. Pure. */
function tbCleanCalFilters(raw){
  const o=(raw&&typeof raw==='object')?raw:{};
  const str=v=>(typeof v==='string'&&v.length<=200)?v:'';
  return{scope:o.scope==='all'?'all':'me',person:str(o.person),list:str(o.list),
         lane:str(o.lane),color:str(o.color),hideDone:o.hideDone===true};
}
/** The whole stored entry, cleaned. Returns null when it should be thrown
 *  away (missing, oversized or unreadable). Pure. */
function tbCleanCalPrefs(raw){
  if(typeof raw!=='string'||!raw||raw.length>_TB_CAL_PREFS_MAX)return null;
  let o;
  try{ o=JSON.parse(raw); }catch(e){ return null; }
  if(!o||typeof o!=='object')return null;
  const out={filters:tbCleanCalFilters(o.filters)};
  if(o.view==='week'||o.view==='month')out.view=o.view;
  if(typeof o.tray==='boolean')out.tray=o.tray;
  if(typeof o.rows==='boolean')out.rows=o.rows;
  return out;
}
function _tbCalLoadPrefs(){
  if(_tbIsPhone())_tbCalView='week';
  let raw=null;
  try{ raw=localStorage.getItem(_TB_CAL_KEY); }catch(e){ return; }   // blocked store: defaults
  if(raw==null)return;
  const o=tbCleanCalPrefs(raw);
  if(!o){
    // Oversized or corrupt -- the freeze's leftovers. Drop it rather than
    // parse 1 MB on every open.
    try{ localStorage.removeItem(_TB_CAL_KEY); }catch(e){}
    return;
  }
  if(o.view)_tbCalView=o.view;
  _tbCalFilters=o.filters;
  if(typeof o.tray==='boolean')_tbTrayOpen=o.tray;
  if(typeof o.rows==='boolean')_tbCalRows=o.rows;
  // Rewrite it in its clean shape, so a junk key is gone for good rather
  // than merely ignored.
  if(JSON.stringify(o)!==raw)_tbCalSavePrefs();
}
function _tbCalSavePrefs(){
  try{ localStorage.setItem(_TB_CAL_KEY,JSON.stringify(
    {view:_tbCalView,filters:_tbCalFilters,tray:_tbTrayOpen,rows:_tbCalRows})); }catch(e){}
}

// ── Rendering ─────────────────────────────────────────────────────────
/** A pill. Gates are solid, a lock shows, a done item fades rather than
 *  celebrating (spec s10: no gamification). */
function _tbPill(item,today){
  const me=_tbMe();
  const ck=tbItemColorKey(item,tbLists,tbUserColors());
  const canMove=_tbCanEditIt(item)&&tbCanMoveDate(item,me,_tbIsBoardOwner());
  const cls=['tb-pill','tb-c-'+ck]
    .concat(item.kind==='gate'?['gate']:[])
    .concat(item.kind==='event'?['event']:[])
    .concat(item.status==='done'?['done']:[])
    .concat(item.locked?['locked']:[])
    .concat(canMove?['draggable']:[]);
  return'<div class="'+cls.join(' ')+'" data-id="'+_tbEsc(item.id)+'"'
    +' data-day="'+_tbEsc(item.date||'')+'"'
    +(canMove?' onpointerdown="window.tbPillDown(event,\''+_tbJs(item.id)+'\')"':'')
    +' onclick="window.tbPillClick(event,\''+_tbJs(item.id)+'\')"'
    +' tabindex="0" onkeydown="window.tbPillKey(event,\''+_tbJs(item.id)+'\')">'
    +'<span class="tb-pillbar"></span>'
    +(item.locked?'<span class="tb-pilllock" title="locked">'+_tbIcon('lock','sm')+'</span>':'')
    +_tbSlot(item.title||'untitled','tb-pilltitle')
  +'</div>';
}

/** Every word up: "october 2026" -> "October 2026", "26 oct – 1 nov" ->
 *  "26 Oct – 1 Nov". The pure label builders stay lowercase (their tests
 *  pin them); the SCREEN is Title Case (session 2). Pure. */
function _tbTitleCase(s){ return String(s==null?'':s).replace(/(^|[\s(–-])([a-z])/g,(m,a,b)=>a+b.toUpperCase()); }

/** The calendar's toolbar (session 2, P1.6): back · Today · forward and the
 *  range; Month | Week (and By Person on a week); Me | Everyone; a row of
 *  AVATARS -- one tap shows that person's calendar -- then the list and
 *  lane filters, Hide done and Clear. */
function _tbCalHead(){
  const label=_tbCalView==='week'?tbWeekLabel(_tbCalAnchor):tbMonthLabel(_tbCalAnchor.slice(0,7));
  const seg=(v,l)=>'<button class="tb-seg'+(_tbCalView===v?' on':'')+'" aria-pressed="'+(_tbCalView===v?'true':'false')+'"'
    +' onclick="window.tbCalView(\''+_tbJs(v)+'\')">'+_tbEsc(l)+'</button>';
  const scope=(v,l)=>'<button class="tb-seg'+(_tbCalFilters.scope===v?' on':'')+'" aria-pressed="'+(_tbCalFilters.scope===v?'true':'false')+'"'
    +' onclick="window.tbCalScope(\''+_tbJs(v)+'\')">'+_tbEsc(l)+'</button>';
  const opt=(v,cur,l)=>'<option value="'+_tbEsc(v)+'"'+(v===cur?' selected':'')+'>'+_tbEsc(l)+'</option>';
  // Only people with an account can be filtered to -- a person with no
  // uid owns nothing on the calendar yet.
  const avatars=tbPeople().filter(p=>p.uid).map(function(p){
    const u=tbUser(p.uid),on=_tbCalFilters.person===p.uid;
    return'<button class="tb-calav'+(on?' on':'')+'" aria-pressed="'+(on?'true':'false')+'"'
      +' title="'+_tbEsc(on?'Showing '+u.name+' — tap to show everyone':'Show only '+u.name)+'"'
      +' aria-label="'+_tbEsc('Show only '+u.name)+'"'
      +' onclick="window.tbCalPerson(\''+_tbJs(p.uid)+'\')">'+_tbEsc(u.initial)+'</button>';
  }).join('');
  return'<div class="tb-calbar">'
    +'<div class="tb-calnav">'
      +'<button class="tb-calbtn tb-calicon" onclick="window.tbCalStep(-1)" title="Back" aria-label="Back">'+_tbIcon('chevron-left')+'</button>'
      +'<button class="tb-calbtn" onclick="window.tbCalToday()">Today</button>'
      +'<button class="tb-calbtn tb-calicon" onclick="window.tbCalStep(1)" title="Forward" aria-label="Forward">'+_tbIcon('chevron-right')+'</button>'
      +'<span class="tb-callabel">'+_tbEsc(_tbTitleCase(label))+'</span>'
    +'</div>'
    +'<div class="tb-calseg">'+seg('month','Month')+seg('week','Week')
      // Rows-by-person is a way of reading the WEEK, so it lives beside
      // the view segment and only appears when a week is on screen.
      +(_tbCalView==='week'&&!_tbIsPhone()
        ?'<button class="tb-seg'+(_tbCalRows?' on':'')+'"'
          +' onclick="window.tbCalRows('+(_tbCalRows?'false':'true')+')">By Person</button>'
        :'')
    +'</div>'
    +'<div class="tb-calseg">'+scope('me','Me')+scope('all','Everyone')+'</div>'
    +(avatars?'<div class="tb-calpeople" role="group" aria-label="Show one person">'+avatars+'</div>':'')
    +'<div class="tb-calfilters">'
      +'<select aria-label="List" onchange="window.tbCalSetFilter(\'list\',this.value)">'
        +opt('',_tbCalFilters.list,'Any list')
        +tbLists.filter(l=>!l.archived).map(l=>opt(l.id,_tbCalFilters.list,l.title||'untitled')).join('')
      +'</select>'
      +'<select aria-label="Lane" onchange="window.tbCalSetFilter(\'lane\',this.value)">'
        +opt('',_tbCalFilters.lane,'Any lane')
        +TB_LANES.map(l=>opt(l,_tbCalFilters.lane,_tbCap(l))).join('')
      +'</select>'
      +'<label class="tb-calchk"><input type="checkbox"'+(_tbCalFilters.hideDone?' checked':'')
        +' onchange="window.tbCalSetFilter(\'hideDone\',this.checked)"> Hide done</label>'
      +(_tbCalActive()?'<button class="tb-calbtn" onclick="window.tbCalClear()">Clear</button>':'')
    +'</div>'
  +'</div>';
}
/** An avatar is "whose calendar": it shows that person across the TEAM
 *  (scope Everyone), because Me plus a person would show only the items you
 *  share -- not what anyone means by tapping a face. Tapping the same face
 *  again shows everyone. */
window.tbCalPerson=function(uid){
  uid=(typeof uid==='string')?uid:'';
  if(!uid||_tbCalFilters.person===uid){ _tbCalFilters.person=''; }
  else{ _tbCalFilters.person=uid; _tbCalFilters.scope='all'; }
  _tbCalSavePrefs();_tbRepaint();
};
function _tbCalActive(){
  const f=_tbCalFilters;
  return!!(f.person||f.list||f.lane||f.color||f.hideDone||f.scope==='all');
}

/** A day cell — the drop target. `data-day` is what the drag reads.
 *  Session 2, P1.6: markers are flag chips; a MONTH day shows three pills
 *  at most, or two and "+N more" (the week shows them all); the "+" is an
 *  icon that says which day it adds to. */
const TB_CAL_MONTH_CAP=3;
let _tbCalMore=null;            // the one month day opened past its cap
window.tbCalMore=function(day){
  _tbCalMore=(_tbCalMore===day)?null:(/^\d{4}-\d{2}-\d{2}$/.test(String(day||''))?day:null);
  _tbRepaint();
};
function _tbDayCell(day,items,today,opts){
  const o=opts||{};
  const marks=(_tbCalMarks[day]||[]);
  const cls=['tb-day']
    .concat(day===today?['today']:[])
    .concat(o.inMonth===false?['out']:[])
    .concat(marks.length?['marked']:[])
    .concat(_tbDow(day)===0||_tbDow(day)===6?['weekend']:[]);
  const month=o.inMonth!=null;
  const open=_tbCalMore===day;
  const over=month&&items.length>TB_CAL_MONTH_CAP&&!open;
  const shown=over?items.slice(0,TB_CAL_MONTH_CAP-1):items;
  const dl=_tbTitleCase(tbDayLabel(day,today));
  return'<div class="'+cls.join(' ')+'" data-day="'+_tbEsc(day)+'">'
    +'<div class="tb-dayhead">'
      +'<span class="tb-daynum">'+Number(String(day).slice(8))+'</span>'
      +'<button class="tb-dayadd" title="Add on '+_tbEsc(dl)+'" aria-label="Add on '+_tbEsc(dl)+'"'
        +' onclick="window.tbCalAdd(\''+_tbJs(day)+'\')">'+_tbIcon('plus','sm')+'</button>'
    +'</div>'
    +(marks.length?'<div class="tb-daymarks">'+marks.map(m=>'<span class="tb-daymark">'+_tbIcon('flag','sm')+_tbEsc(m)+'</span>').join('')+'</div>':'')
    +'<div class="tb-daylist">'+shown.map(i=>_tbPill(i,today)).join('')+'</div>'
    +(over?'<button class="tb-daymore" onclick="window.tbCalMore(\''+_tbJs(day)+'\')">+'+(items.length-shown.length)+' more</button>'
      :(open&&month&&items.length>TB_CAL_MONTH_CAP?'<button class="tb-daymore" onclick="window.tbCalMore(\''+_tbJs(day)+'\')">Show less</button>':''))
  +'</div>';
}

let _tbCalMarks={};
function _tbCalendar(){
  const me=_tbMe(),today=_tbToday();
  if(!_tbCalAnchor)_tbCalAnchor=today;
  if(_tbLoadFailed('board_items')){
    return _tbCalHead()+'<div class="tb-err">Could not read The Board. '
      +'<button class="btn-outline" onclick="window.tbRetry()">Retry</button>'
      +'<div class="tb-errsub">If this keeps happening, firestore.rules may not be deployed — see BOARD.md.</div></div>';
  }
  const shown=tbCalFilter(tbItems,Object.assign({uid:me},_tbCalFilters));
  const byDay=tbItemsByDay(shown);
  _tbCalMarks=tbMarkersByDay(tbConfig);
  const dow='<div class="tb-dowrow">'+TB_DOW_LABELS.map(d=>'<div class="tb-dow">'+_tbEsc(_tbCap(d))+'</div>').join('')+'</div>';
  let grid='';
  if(_tbCalView==='week'&&_tbCalRows&&!_tbIsPhone()){
    grid=_tbPersonWeek(tbWeekDays(_tbCalAnchor),today);
  }else if(_tbCalView==='week'){
    const days=tbWeekDays(_tbCalAnchor);
    grid='<div class="tb-weekgrid">'
      +days.map(d=>_tbDayCell(d,byDay[d]||[],today,{})).join('')+'</div>';
  }else{
    const rows=tbMonthGrid(_tbCalAnchor.slice(0,7));
    grid='<div class="tb-monthgrid">'+rows.map(w=>
      w.map(c=>_tbDayCell(c.day,byDay[c.day]||[],today,{inMonth:c.inMonth})).join('')
    ).join('')+'</div>';
  }
  const count=shown.length;
  const note='<div class="tb-calnote">'+count+' item'+(count===1?'':'s')+' shown'
    +(_tbCalActive()?' · filtered':'')
    +(_tbIsPhone()?' · hold a pill to give it a date':' · drag a pill to move it')
    +'</div>';
  // The dow header belongs to the seven-column grids only; rows-by-person
  // draws its own, and the phone's week is a vertical agenda.
  const heads=(_tbCalView==='month'||(_tbCalView==='week'&&!_tbCalRows&&!_tbIsPhone()))?dow:'';
  return _tbCalHead()
    +'<div class="tb-calbody">'
      +'<div class="tb-calgrid">'+heads+grid+note+'</div>'
      +_tbTray()
    +'</div>';
}

// ── View controls ─────────────────────────────────────────────────────
window.tbCalView=function(v){
  _tbCalMore=null;
  _tbCalView=(v==='week')?'week':'month';
  _tbCalSavePrefs();_tbRepaint();
};
window.tbCalScope=function(v){
  _tbCalFilters.scope=(v==='all')?'all':'me';
  _tbCalSavePrefs();_tbRepaint();
};
// NAMED tbCalSetFilter, NOT tbCalFilter, AND THAT IS THE WHOLE FIX FOR THE
// SEP 2026 FREEZE. A top-level `function tbCalFilter` in a classic script
// IS `window.tbCalFilter` in a browser, so assigning this handler to that
// name replaced the pure filter above: _tbCalendar then called the handler,
// which repainted, which called it again -- a recursion that locked the tab
// for ~17s before the stack overflowed, and saved a 1.36 MB junk filter on
// every attempt. The node harness gives each script its own `window`, so no
// logic suite could see it; tests/invariants.test.js now forbids the shape
// repo-wide and tests/smoke-board.js drives every calendar control in real
// Chromium.
window.tbCalSetFilter=function(k,v){
  if(_TB_CAL_FILTER_KEYS.indexOf(k)<0)return;   // a key nobody asked for is not a filter
  if(k==='hideDone')_tbCalFilters.hideDone=!!v;
  else _tbCalFilters[k]=(typeof v==='string')?v:'';
  _tbCalSavePrefs();_tbRepaint();
};
window.tbCalClear=function(){
  _tbCalFilters={scope:'me',person:'',list:'',lane:'',color:'',hideDone:false};
  _tbCalSavePrefs();_tbRepaint();
};
window.tbCalStep=function(n){
  _tbCalMore=null;
  _tbCalAnchor=_tbCalView==='week'
    ?_tbDayAdd(_tbCalAnchor,7*Number(n||0))
    :(_tbMonthAdd(_tbCalAnchor.slice(0,7),Number(n||0))+'-01');
  _tbRepaint();
};
window.tbCalToday=function(){ _tbCalAnchor=_tbToday(); _tbRepaint(); };
window.tbCalAdd=function(day){
  // Spec s7.2: the day's "+" creates an item on that day. It goes through
  // the same builder the quick-add uses, so nothing about what a new item
  // IS lives in two places.
  const title=typeof prompt==='function'?prompt('What is happening on '+tbDayLabel(day,_tbToday())+'?'):'';
  if(!title||!String(title).trim())return;
  window.tbCreateOn(String(title),day);
};
window.tbCreateOn=async function(text,day){
  const me=_tbMe();
  const parsed=tbParseQuickAdd(text,{today:_tbToday(),handles:tbHandleMap(),boardHandles:_tbBoardUsernames()});
  // The quick-add's rule: no title, no item. The old fallback to the raw
  // text saved "@saim" as the title of an item assigned to nobody else
  // (review of a96cddb).
  if(!parsed.title){ _tbToast('Give it a title.'); return; }
  const assignees=parsed.assigneeUids.slice();
  if(assignees.indexOf(me)<0)assignees.unshift(me);
  const data=tbNewItem({
    title:parsed.title,
    assigneeUids:assignees,lane:parsed.lane,priority:parsed.priority,
    // The DAY WINS over a date typed into the text — you pressed + on a
    // specific square, and that is the more deliberate of the two.
    date:day
  },me,_tbNow(),tbLists);
  await _tbTry(async()=>{
    const ref=doc(collection(db,'board_items'));
    const b=writeBatch(db);
    b.set(ref,data);
    b.set(doc(collection(db,'board_items',ref.id,'activity')),
      {type:'created',byUid:me,at:data.createdAt,payload:{}});
    await b.commit();
    _tbLiveRemember('items_own',ref.id,data);
    _tbUpsert(tbItems,tbDecodeItem(Object.assign({id:ref.id},data)));
    _tbRepaint();
    // Said, as the quick-add says it: a handle taken out of the title and
    // assigned to nobody used to vanish without a word (review of a96cddb).
    if(parsed.pendingHandles.length)_tbToast(_tbPendingToast(parsed.pendingHandles));
  },'add that');
};

// ── Pills: click, keyboard, drag ──────────────────────────────────────
window.tbPillClick=function(e,id){
  // A drag ends with a click on whatever is under the pointer. Swallow it,
  // or every move would also open the drawer — the file-card bug, in a new
  // place.
  if(_tbDragMoved){_tbDragMoved=false;if(e&&e.preventDefault)e.preventDefault();return;}
  window.tbOpenItem(id);
};
window.tbPillKey=function(e,id){
  if(!e)return;
  const k=e.key;
  let delta=0;
  if(k==='[')delta=-1;
  else if(k===']')delta=1;
  else if(e.shiftKey&&k==='ArrowLeft')delta=-7;
  else if(e.shiftKey&&k==='ArrowRight')delta=7;
  else if(k==='Enter'||k===' '){ if(e.preventDefault)e.preventDefault(); window.tbOpenItem(id); return; }
  if(!delta)return;
  if(e.preventDefault)e.preventDefault();
  const it=tbItems.filter(x=>x.id===id)[0];
  if(!it)return;
  window.tbMoveItem(id,tbNudgeTarget(it,delta));
};

// THE DRAG. Pointer events only — never HTML5 drag, the rule this repo
// learned from the board canvas reading a native dragstart as "files from
// the desktop". The pointer is captured LAZILY, past the threshold, so a
// press that never becomes a drag leaves the click alone: an eager
// setPointerCapture RETARGETS the following click to the capturing
// element, which is the bug js/boards.js found five times under five
// names.
const _TB_DRAG_PX=4;
let _tbDragId=null,_tbDragMoved=false,_tbDragGhost=null,_tbDragOverDay='';
window.tbPillDown=function(e,id){
  if(!e||e.button===2)return;
  const it=tbItems.filter(x=>x.id===id)[0];
  if(!it||_tbNotOnIt(it))return;
  if(!tbCanMoveDate(it,_tbMe(),_tbIsBoardOwner())){
    _tbToast('locked by '+tbUser(it.lockedBy).name);
    return;
  }
  // SPEC s11: on a phone the drag is replaced by a move-to date picker on
  // long press. A 4px threshold aimed at a ~50px day square is not a
  // gesture a thumb can land, and the tray exists to be moved FROM.
  if(_tbIsPhone()){
    const hold=setTimeout(function(){
      if(typeof navigator!=='undefined'&&navigator.vibrate)try{navigator.vibrate(8);}catch(err){}
      _tbDragMoved=true;                    // so the release does not open the drawer
      window.tbOpenMove(id);
    },500);
    const stop=function(){
      clearTimeout(hold);
      document.removeEventListener('pointerup',stop,true);
      document.removeEventListener('pointercancel',stop,true);
      document.removeEventListener('pointermove',moved,true);
    };
    const moved=function(ev){
      if(Math.abs(ev.clientX-e.clientX)>8||Math.abs(ev.clientY-e.clientY)>8)stop();
    };
    document.addEventListener('pointerup',stop,true);
    document.addEventListener('pointercancel',stop,true);
    document.addEventListener('pointermove',moved,true);
    return;
  }
  const startX=e.clientX,startY=e.clientY,pid=e.pointerId;
  const el=e.currentTarget;
  let captured=false;
  _tbDragId=id;_tbDragMoved=false;_tbDragOverDay='';

  const move=ev=>{
    if(ev.pointerId!==undefined&&ev.pointerId!==pid)return;   // a 2nd finger is not this drag
    const dx=ev.clientX-startX,dy=ev.clientY-startY;
    if(!captured){
      if(Math.abs(dx)<_TB_DRAG_PX&&Math.abs(dy)<_TB_DRAG_PX)return;
      captured=true;_tbDragMoved=true;
      try{ if(el&&el.setPointerCapture)el.setPointerCapture(pid); }catch(err){}
      if(el&&el.classList)el.classList.add('dragging');
      _tbDragGhostShow(it,ev.clientX,ev.clientY);
    }
    _tbDragGhostMove(ev.clientX,ev.clientY);
    _tbDragHover(ev.clientX,ev.clientY);
  };
  const up=ev=>{
    if(ev&&ev.pointerId!==undefined&&ev.pointerId!==pid)return;
    document.removeEventListener('pointermove',move,true);
    document.removeEventListener('pointerup',up,true);
    document.removeEventListener('pointercancel',up,true);
    _tbDragGhostHide();
    if(el&&el.classList)el.classList.remove('dragging');
    _tbDayHighlight('');
    const to=_tbDragOverDay;
    _tbDragId=null;_tbDragOverDay='';
    if(captured&&to)window.tbMoveItem(id,to);
  };
  document.addEventListener('pointermove',move,true);
  document.addEventListener('pointerup',up,true);
  document.addEventListener('pointercancel',up,true);
};
/** Which day square is under the pointer. Extracted because it is the
 *  ONE part of the drag that needs a laid-out page — so a test can
 *  replace it and drive everything else for real, rather than asserting
 *  a helper and proving only the helper. */
function _tbDayFromPoint(x,y){
  const el=document.elementFromPoint?document.elementFromPoint(x,y):null;
  const cell=el&&el.closest?el.closest('.tb-day'):null;
  return(cell&&cell.getAttribute)?(cell.getAttribute('data-day')||''):'';
}
function _tbDragHover(x,y){
  const day=_tbDayFromPoint(x,y);
  if(day!==_tbDragOverDay){_tbDragOverDay=day||'';_tbDayHighlight(_tbDragOverDay);}
}
function _tbDayHighlight(day){
  if(!document.querySelectorAll)return;
  document.querySelectorAll('.tb-day.drop').forEach(n=>n.classList.remove('drop'));
  if(!day)return;
  const cell=document.querySelector('.tb-day[data-day="'+day+'"]');
  if(cell&&cell.classList)cell.classList.add('drop');
}
function _tbDragGhostShow(item,x,y){
  if(!document.createElement)return;
  const g=document.createElement('div');
  g.className='tb-dragghost tb-c-'+tbItemColorKey(item,tbLists,tbUserColors());
  g.textContent=item.title||'untitled';        // NEVER interpolated
  if(document.body&&document.body.appendChild)document.body.appendChild(g);
  _tbDragGhost=g;_tbDragGhostMove(x,y);
}
function _tbDragGhostMove(x,y){
  if(!_tbDragGhost||!_tbDragGhost.style)return;
  _tbDragGhost.style.left=(x+12)+'px';
  _tbDragGhost.style.top=(y+12)+'px';
}
function _tbDragGhostHide(){
  if(_tbDragGhost&&_tbDragGhost.remove)_tbDragGhost.remove();
  _tbDragGhost=null;
}

/** The one move path — the drag, the keyboard and anything later all come
 *  through here, so a refusal reads the same however it was attempted. */
window.tbMoveItem=async function(id,toDay){
  const it=tbItems.filter(x=>x.id===id)[0];
  if(!it||!toDay)return;
  const plan=tbMovePlan(it,toDay,_tbMe(),_tbIsBoardOwner(),_tbNow());
  if(plan.refused){ if(plan.reason)_tbToast(plan.reason); return; }
  // Optimistic: the pill moves at once and the write follows. _tbTry
  // re-reads and repaints if the server refuses, so a rules rejection
  // snaps it back rather than leaving a lie on screen.
  const before=it.date;
  _tbApplyLocal(id,{date:toDay});
  _tbRepaint();
  const ok=await _tbTry(async()=>{
    await _tbCommit(id,plan.data,plan.activity);
    _tbApplyLocal(id,plan.data);
    (plan.notify||[]).forEach(uid=>_tbNotify({
      type:'moved',forUid:uid,fromUid:_tbMe(),itemId:id,listId:it.listId,
      title:TB_NAME,
      message:tbUser(_tbMe()).name+' moved “'+(it.title||'')+'” to '+tbDayLabel(toDay,_tbToday())}));
    if(plan.override)_tbToast('moved — you overrode '+tbUser(plan.data.lockedBy||it.lockedBy).name+"'s lock, and it is logged");
    _tbRepaint();
  },'move that');
  if(!ok)_tbApplyLocal(id,{date:before});
};

// ══ PHASE 4 — COMMENTS, MENTIONS, FILES, INBOX ════════════════════════
// The Slack-thread half of the product. Same rule as phases 2 and 3:
// every DECISION is a pure function and the writers are thin wrappers, so
// "who hears about this comment" and "does Enter pick a mention" are
// assertable with no database and no caret.

// ── Markdown-lite ─────────────────────────────────────────────────────
// THE WHOLE XSS BOUNDARY IS "ESCAPE FIRST, FORMAT SECOND", and it is a
// DIFFERENT boundary from the one js/boards.js draws. Mood Boards stores
// real HTML (a contenteditable's innerHTML), so it has to parse that into
// an inert document and rebuild it against a tag allow-list. The Board
// stores PLAIN TEXT. Once _tbEsc has run, the string holds no `<`, `>`,
// `&` or quote the author typed — so every tag in the output is one this
// function wrote, and there is nothing left to sanitise. A DOMParser pass
// here would be theatre; it would also be untestable, since the node
// harness's DOMParser is a tag-soup stub and asserting on it proves only
// the harness.
const _TB_BODY_MAX=4000;
// A sentinel that cannot survive _tbEsc's input: control characters are
// stripped first, so nothing the author typed can impersonate one.
const _TB_MD_MARK='\u0000';

/** Comment/notes body → safe HTML. `**bold**`, `*italic*`, `` `code` ``,
 *  `@[handle]` mentions, http(s) autolinks, newlines. Pure. */
function tbRenderBody(text){
  const raw=String(text==null?'':text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')
    .slice(0,_TB_BODY_MAX);
  let s=_tbEsc(raw);
  // Code spans are lifted out first: their contents must not then be read
  // as bold, as a mention or as a link.
  const code=[];
  s=s.replace(/`([^`\n]+)`/g,function(m,c){code.push(c);return _TB_MD_MARK+(code.length-1)+_TB_MD_MARK;});
  s=s.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
  s=s.replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
  s=s.replace(/@\[([A-Za-z0-9._-]{1,30})\]/g,function(m,h){
    const uid=tbHandleMap()[String(h).toLowerCase()];
    const name=uid?tbUser(uid).name:h;
    return'<span class="tb-mention" title="@'+_tbEsc(h)+'">@'+_tbEsc(name)+'</span>';
  });
  // THE SCHEME CHECK IS THE REGEX. Only `http://` and `https://` can
  // match at all, so `javascript:` never reaches an href — the same
  // decision _boardsSafeHref makes, made by construction rather than by a
  // second function that could be forgotten at one call site.
  s=s.replace(/https?:\/\/[^\s<]+/g,function(m){
    const clean=m.replace(/[.,;:!?)\]]+$/,'');
    return'<a class="tb-link" href="'+clean+'" target="_blank" rel="noopener noreferrer">'
      +clean+'</a>'+m.slice(clean.length);
  });
  s=s.replace(new RegExp(_TB_MD_MARK+'(\\d+)'+_TB_MD_MARK,'g'),function(m,i){
    return'<code class="tb-code">'+code[Number(i)]+'</code>';
  });
  return s.replace(/\r?\n/g,'<br>');
}

// ── Mentions (spec §9) ────────────────────────────────────────────────
const _TB_MENTION_ROWS=6;     // spec: the popover shows at most 6
const _TB_MENTION_IDLE=5;     // spec: typing nothing shows the top 5

/** Is the caret inside an `@…` token, and what has been typed after it?
 *  Extracted because it is the one part of the popover that needs a
 *  caret — so a test drives the rule and the handler stays a wrapper. */
function tbMentionQuery(text,caret){
  const s=String(text==null?'':text);
  const c=Math.max(0,Math.min(Number(caret||0),s.length));
  const m=/(^|[\s(\[])@([A-Za-z0-9._-]*)$/.exec(s.slice(0,c));
  if(!m)return null;
  return{at:c-m[2].length-1,prefix:m[2]};
}

/** Replace the `@…` under the caret with a `@[handle] ` token. Pure. */
function tbMentionInsert(text,caret,handle){
  const s=String(text==null?'':text);
  const c=Math.max(0,Math.min(Number(caret||0),s.length));
  const q=tbMentionQuery(s,c);
  if(!q)return{text:s,caret:c};
  const tok='@['+String(handle||'')+'] ';
  return{text:s.slice(0,q.at)+tok+s.slice(c),caret:q.at+tok.length};
}

const _tbFirstName=u=>String((u&&u.name)||'').trim().split(/\s+/)[0].toLowerCase();

/** Who to offer, in what order (spec §9). Pure — the ranking is read off
 *  the CALLER's own mentionStats, so it is personal to whoever is typing.
 *
 *  score = count × recencyWeight, + 2 if they are on this item, + 1 if
 *  they have already spoken in this thread. Ties break alphabetically. */
function tbMentionCandidates(prefix,ctx){
  const c=ctx||{};
  const me=c.me||'';
  const p=String(prefix==null?'':prefix).toLowerCase();
  const stats=c.stats||{};
  const now=Number(c.now||Date.now());
  const rows=(c.users||[]).filter(function(u){
    if(!u||!u.uid||!u.handle)return false;
    // Self is excluded BY DEFAULT and allowed when the handle is typed in
    // full (spec §9) — writing a note to yourself is a real thing to do,
    // it just should not be the first name the popover suggests.
    if(u.uid===me&&p!==String(u.handle).toLowerCase())return false;
    if(!p)return true;
    return _tbFirstName(u).indexOf(p)===0||String(u.handle).toLowerCase().indexOf(p)===0;
  }).map(function(u){
    const st=stats[u.uid]||{};
    const days=st.lastAt?Math.max(0,(now-Number(st.lastAt))/86400000):0;
    let score=Number(st.count||0)*(1/(1+days/14));
    if((c.assigneeUids||[]).indexOf(u.uid)>-1)score+=2;
    if((c.threadUids||[]).indexOf(u.uid)>-1)score+=1;
    return Object.assign({},u,{score:score});
  });
  rows.sort(function(a,b){
    return (b.score-a.score)||_tbFirstName(a).localeCompare(_tbFirstName(b));
  });
  return rows.slice(0,p?_TB_MENTION_ROWS:_TB_MENTION_IDLE);
}

/** AMMAR'S RULE, added at phase 0 and not in the spec: ENTER SELECTS ONLY
 *  when exactly one candidate matches, or a row has been arrowed to.
 *  Otherwise Enter belongs to the textarea and types a newline — because
 *  a popover that swallows Enter on an ambiguous list picks somebody at
 *  random on the author's behalf, and the author does not find out until
 *  the wrong person answers. Returns the index Enter would pick, or -1
 *  for "leave Enter alone". Pure, and the entire rule lives here. */
function tbMentionAccepts(list,idx){
  const n=((list||[]).length)|0;
  const i=Number(idx);
  if(i>=0&&i<n)return i;
  return n===1?0:-1;
}

/** Bare `@handle` → the stored `@[handle]` token, plus the uids it names.
 *  AN UNKNOWN HANDLE STAYS LITERAL — @baber is a real person, just not on
 *  the board — which is the same call tbParseQuickAdd already makes. */
function tbResolveMentions(text,handleMap){
  const map=handleMap||{};
  const uids=[];
  const body=String(text==null?'':text).replace(
    /@\[([A-Za-z0-9._-]{1,30})\]|@([A-Za-z0-9._-]{1,30})/g,
    function(m,tok,bare){
      const h=String(tok||bare||'').toLowerCase();
      const uid=map[h];
      if(!uid)return m;
      if(uids.indexOf(uid)<0)uids.push(uid);
      return'@['+h+']';
    });
  return{body:body,mentionUids:uids};
}

/** mentionStats lives on the AUTHOR's own profile
 *  (`user_profiles/{uid}.tbMentionStats`) because it is how THEIR popover
 *  ranks — nobody else reads it — and user_profiles already carries a
 *  self-update rule, so this needs no change to firestore.rules. Pure. */
function tbMentionBump(stats,uids,now){
  const out=Object.assign({},stats||{});
  const at=Number(now||Date.now());
  (uids||[]).forEach(function(u){
    if(!u)return;
    const cur=out[u]||{};
    out[u]={count:Number(cur.count||0)+1,lastAt:at};
  });
  return out;
}

// ── Files (spec §8.3, with Ammar's phase-0 amendment) ─────────────────
// The spec asked for Firebase Storage and a client-side 320px thumbnail
// stored alongside the original. This ships CLOUDINARY with the thumbnail
// as a DELIVERY TRANSFORM instead: Cloudinary is what every other upload
// in this app already uses, and a derived thumbnail means no second
// artefact to keep in step with the first, nothing to migrate for a file
// uploaded before this, and the original is never rewritten.
const TB_MAX_UPLOAD_MB=25;
const _TB_MAX_UPLOAD=TB_MAX_UPLOAD_MB*1024*1024;

function tbTooBig(file){ return !!(file&&Number(file.size)>_TB_MAX_UPLOAD); }
function tbFileSize(n){
  const b=Number(n||0);
  if(b<1024)return b+' B';
  if(b<1024*1024)return Math.round(b/1024)+' KB';
  return (Math.round(b/1024/1024*10)/10)+' MB';
}
/** A Cloudinary response → the attachment record we store. Pure. */
function tbAttachment(res,file,uid,now){
  const d=res||{},f=file||{};
  const at=Number(now||Date.now());
  return{
    id:String(d.public_id||('tbf'+at)),
    name:String(f.name||d.original_filename||'file').slice(0,120),
    url:String(d.secure_url||''),
    mime:String(f.type||''),
    size:Number(f.size||d.bytes||0),
    width:Number(d.width||0)||null,
    height:Number(d.height||0)||null,
    uploadedByUid:String(uid||''),
    at:at
  };
}
/** The thumbnail, DERIVED at render. '' means "no preview" — the file
 *  renders as a chip with its size, which is honest for a .zip. Pure. */
function tbThumbUrl(att,w){
  const a=att||{},u=String(a.url||'');
  const width=Number(w||320);
  if(!/^https:\/\/res\.cloudinary\.com\//.test(u)||u.indexOf('/upload/')===-1)return'';
  if(/^image\//.test(String(a.mime||''))||/\.(png|jpe?g|gif|webp|avif|bmp)($|\?)/i.test(u))
    return u.replace('/upload/','/upload/f_auto,q_auto,c_fit,w_'+width+'/');
  // Cloudinary rasterises page 1 of a PDF. BEST EFFORT BY DESIGN: the
  // <img> carries an onerror that falls back to the chip, so an account
  // without PDF delivery turned on degrades rather than showing a broken
  // picture. (js/boards.js records that this setting is off by default.)
  if(/\.pdf($|\?)/i.test(u)||String(a.mime||'')==='application/pdf')
    return u.replace('/upload/','/upload/pg_1,c_fit,w_'+width+'/').replace(/\.pdf($|\?)/i,'.jpg$1');
  return'';
}
/** Only an anchored Cloudinary https URL ever reaches an href or an src —
 *  `res.cloudinary.com.evil.test` must not pass. The rule _profPhotoUrl
 *  and _boardsCoverUrl already hold, written here rather than shared
 *  because js/profile.js loads before this file. */
function tbFileHref(att){
  const u=String((att&&att.url)||'');
  return /^https:\/\/res\.cloudinary\.com\//.test(u)?u:'';
}

async function _tbUpload(file){
  if(tbTooBig(file))
    throw new Error(String((file&&file.name)||'That file')+' is '+tbFileSize(file&&file.size)
      +' — The Board caps uploads at '+TB_MAX_UPLOAD_MB+' MB.');
  const fd=new FormData();
  fd.append('file',file);
  fd.append('upload_preset','groovy-ops');
  const r=await fetch('https://api.cloudinary.com/v1_1/deww4lpym/auto/upload',{method:'POST',body:fd});
  const d=await r.json();
  if(!d||!d.secure_url){
    let m=(d&&d.error&&d.error.message)||'Upload failed';
    // Cloudinary's own words first, then where THAT number lives — the
    // account's plan, which nothing in this app can raise.
    if(/file size|too large|maximum is/i.test(m))
      m+=" (that is Cloudinary's own cap for this account's plan, not the "
        +TB_MAX_UPLOAD_MB+' MB one The Board sets)';
    throw new Error(m);
  }
  return d;
}

// ── A comment (spec §7.4, §9) ─────────────────────────────────────────
/** What posting a comment becomes: the document, the patch to the item,
 *  and who hears about it. Pure. */
function tbCommentPlan(item,o){
  const it=item||{},n=o||{};
  const uid=String(n.uid||'');
  const files=Array.isArray(n.attachments)?n.attachments:[];
  const r=tbResolveMentions(n.body,n.handleMap);
  const body=String(r.body||'').trim().slice(0,_TB_BODY_MAX);
  if(!body&&!files.length)return{error:'Write something first.'};
  const now=Number(n.now||Date.now());
  const notify=[],seen={};
  seen[uid]=1;                                  // never notify yourself
  r.mentionUids.forEach(function(u){
    if(u&&!seen[u]){seen[u]=1;notify.push({type:'mention',uid:u});}
  });
  // Everyone already in this conversation hears about a new comment —
  // ONCE. Someone who was MENTIONED has already been told, and two bell
  // rows for one comment is what makes a bell worth ignoring.
  const parties=(it.assigneeUids||[])
    .concat(it.ownerUid?[it.ownerUid]:[])
    .concat(n.threadUids||[]);
  parties.forEach(function(u){
    if(u&&!seen[u]){seen[u]=1;notify.push({type:'comment',uid:u});}
  });
  return{
    comment:{authorUid:uid,body:body,mentionUids:r.mentionUids,
             attachments:files,createdAt:now,editedAt:null},
    data:{commentCount:Number(it.commentCount||0)+1,lastActivityAt:now,updatedAt:now},
    notify:notify,
    mentionUids:r.mentionUids
  };
}

/** REQUEST MOVE (spec §7.4). A locked item the caller cannot move is not
 *  a dead end: it posts a templated comment mentioning the locker, so the
 *  ask lands in the thread where the answer belongs rather than in a
 *  WhatsApp message nobody can find later. Pure. */
function tbMoveRequestPlan(item,o){
  const it=item||{},n=o||{};
  const uid=String(n.uid||'');
  if(!it.locked||!it.lockedBy)return{error:'This is not locked — you can move it yourself.'};
  if(it.lockedBy===uid)return{error:'You hold the lock — move it yourself.'};
  const to=String(n.toDay||'');
  if(!_tbValidDay(to))return{error:'Pick the date you want it moved to.'};
  const reason=String(n.reason||'').trim().slice(0,200);
  if(!reason)return{error:'Say why — a request with no reason is one more thing to chase.'};
  const h=String(n.lockerHandle||'');
  const now=Number(n.now||Date.now());
  const body=(h?'@['+h+'] ':'')+'requesting move to '+to+' — reason: '+reason;
  return{
    comment:{authorUid:uid,body:body,mentionUids:[it.lockedBy],
             attachments:[],createdAt:now,editedAt:null},
    data:{commentCount:Number(it.commentCount||0)+1,lastActivityAt:now,updatedAt:now},
    notify:[{type:'move_request',uid:it.lockedBy}],
    toDay:to,reason:reason
  };
}

/** One activity row → one sentence. Pure, so the log reads the same
 *  wherever it is drawn. An unknown type says so rather than rendering a
 *  blank line — a log with holes in it is worse than a log that admits
 *  it does not know a verb. */
function tbActivityLine(a,dayLabel){
  const r=a||{},p=r.payload||{};
  const who=tbUser(r.byUid).name;
  const D=d=>(typeof dayLabel==='function'?dayLabel(d):(d||'no date'));
  switch(r.type){
    case'created':   return who+' created this';
    case'moved':     return who+' moved it '+D(p.from)+' → '+D(p.to)
                            +(p.override?' (overrode the lock)':'')
                            +(p.reason?' — '+p.reason:'');
    case'date_set':  return who+' set the date to '+D(p.to);
    case'assigned':  return who+' set who is on it: '
                            +((p.to||[]).map(u=>tbUser(u).name).join(', ')||'nobody');
    case'handover':  return who+' handed it to '+tbUser(p.toUid).name
                            +(p.note?' — '+p.note:'');
    case'done':      return who+' marked it done';
    case'reopened':  return who+' reopened it';
    case'locked':    return who+' locked the date';
    case'unlocked':  return who+' unlocked the date';
    case'step_done': return who+' ticked “'+(p.title||'a step')+'”';
    case'file_added':return who+' added '+(p.name||'a file');
    case'comment':   return who+' commented';
    default:         return who+' changed something';
  }
}

// ── The thread ────────────────────────────────────────────────────────
// Comments and activity are subcollections, so they are read when a
// drawer OPENS rather than with the board — 42 seeded items' threads is
// not something to pull on every page load.
let _tbThreads={};            // itemId -> {comments:[], activity:[], err:false}
let _tbThreadLoading={};

/** CANNOT REJECT, for the same reason loadTbData cannot: a drawer stuck
 *  on "loading…" with nothing on screen to say why is the failure this
 *  codebase keeps recording. */
async function loadTbThread(itemId,force){
  const id=String(itemId||'');
  if(!id)return;
  if(_tbThreads[id]&&!force)return;
  if(_tbThreadLoading[id])return _tbThreadLoading[id];
  _tbThreadLoading[id]=(async function(){
    const r=await Promise.allSettled([
      getDocs(query(collection(db,'board_items',id,'comments'),orderBy('createdAt','asc'))),
      getDocs(query(collection(db,'board_items',id,'activity'),orderBy('at','asc')))
    ]);
    const take=x=>x.status==='fulfilled'?x.value.docs.map(d=>Object.assign({_id:d.id},d.data())):null;
    const cs=take(r[0]),as=take(r[1]);
    if(cs===null)console.warn('[the board] comments read failed',r[0].reason);
    if(as===null)console.warn('[the board] activity read failed',r[1].reason);
    _tbThreads[id]={comments:cs||[],activity:as||[],err:cs===null};
    _tbThreadLoading[id]=null;
  })();
  return _tbThreadLoading[id];
}
function _tbThread(id){ return _tbThreads[String(id||'')]||null; }
/** Who has already spoken here — the +1 in the mention ranking, and the
 *  people a plain 'comment' notification goes to. */
function tbThreadUids(thread){
  const out=[];
  ((thread&&thread.comments)||[]).forEach(function(c){
    if(c&&c.authorUid&&out.indexOf(c.authorUid)<0)out.push(c.authorUid);
  });
  return out;
}

function _tbAgo(ts){
  const d=Date.now()-Number(ts||0);
  if(d<60000)return'just now';
  if(d<3600000)return Math.floor(d/60000)+'m ago';
  if(d<86400000)return Math.floor(d/3600000)+'h ago';
  return Math.floor(d/86400000)+'d ago';
}

// ── Composer state ────────────────────────────────────────────────────
// Typing must NOT repaint the page. The board's one repaint rebuilds
// main-content wholesale, which would destroy the textarea the caret is
// in — the same reason Notes' block editor mutates in place. So the draft
// lives here, the popover repaints ONE element, and _tbRepaint restores
// what was typed.
let _tbCompDraft={};          // itemId -> the text being written
let _tbCompFiles={};          // itemId -> attachments staged for it
let _tbCompFocus=false;
let _tbMentionList=[];
let _tbMentionIdx=-1;
let _tbShowActivity=false;
let _tbMoveReqOpen=false;

function _tbMyStats(){
  const me=_tbMe();
  const p=_tbProfiles().filter(x=>x&&x.uid===me)[0];
  return (p&&p.tbMentionStats)||{};
}
/** The candidate pool: Board users with a resolvable profile. Sami — one
 *  letter from Saim — can never appear, because tbHandleMap only ever
 *  returns Board usernames. */
function _tbMentionPool(){
  const map=tbHandleMap();
  return Object.keys(map).map(function(h){
    const u=tbUser(map[h]);
    return{uid:map[h],handle:h,name:u.name,initial:u.initial};
  });
}

function _tbMentionHTML(){
  if(!_tbMentionList.length)return'';
  return _tbMentionList.map(function(u,i){
    return'<button class="tb-mrow'+(i===_tbMentionIdx?' on':'')+'" type="button"'
      +' onmousedown="event.preventDefault()" onclick="window.tbMentionPick('+i+')">'
      +'<span class="tb-av">'+_tbEsc(u.initial)+'</span>'
      +'<span class="tb-mname">'+_tbEsc(u.name)+'</span>'
      +'<span class="tb-mhandle">@'+_tbEsc(u.handle)+'</span></button>';
  }).join('');
}
function _tbPaintMentions(){
  const host=document.getElementById('tb-mentions');
  if(!host)return;
  host.innerHTML=_tbMentionHTML();
  if(host.classList)host.classList[_tbMentionList.length?'add':'remove']('on');
}
function _tbCloseMentions(){
  _tbMentionList=[];_tbMentionIdx=-1;_tbPaintMentions();
}

window.tbCompInput=function(el){
  if(!el)return;
  const id=_tbOpenItemId;
  if(!id)return;
  _tbCompDraft[id]=el.value;
  const q=tbMentionQuery(el.value,el.selectionStart!=null?el.selectionStart:el.value.length);
  if(!q){ _tbCloseMentions(); return; }
  const it=tbItems.filter(x=>x.id===id)[0]||{};
  _tbMentionList=tbMentionCandidates(q.prefix,{
    me:_tbMe(),users:_tbMentionPool(),stats:_tbMyStats(),
    assigneeUids:it.assigneeUids||[],threadUids:tbThreadUids(_tbThread(id)),now:_tbNow()
  });
  _tbMentionIdx=-1;              // nothing is arrowed to yet — see tbMentionAccepts
  _tbPaintMentions();
};

window.tbMentionPick=function(i){
  const el=document.getElementById('tb-comp');
  const u=_tbMentionList[i];
  if(!el||!u)return;
  const r=tbMentionInsert(el.value,el.selectionStart!=null?el.selectionStart:el.value.length,u.handle);
  el.value=r.text;
  if(_tbOpenItemId)_tbCompDraft[_tbOpenItemId]=r.text;
  if(el.setSelectionRange)try{el.setSelectionRange(r.caret,r.caret);}catch(e){}
  if(el.focus)el.focus();
  _tbCloseMentions();
};

window.tbCompKey=function(e,el){
  if(!e)return;
  if(_tbMentionList.length){
    if(e.key==='ArrowDown'){
      _tbMentionIdx=(_tbMentionIdx+1)%_tbMentionList.length;
      _tbPaintMentions();e.preventDefault();return;
    }
    if(e.key==='ArrowUp'){
      _tbMentionIdx=(_tbMentionIdx<=0?_tbMentionList.length:_tbMentionIdx)-1;
      _tbPaintMentions();e.preventDefault();return;
    }
    if(e.key==='Escape'){ _tbCloseMentions(); e.preventDefault(); return; }
    if(e.key==='Enter'||e.key==='Tab'){
      const pick=tbMentionAccepts(_tbMentionList,_tbMentionIdx);
      if(pick>=0){ e.preventDefault(); window.tbMentionPick(pick); return; }
      // -1 means the list is ambiguous and nothing has been arrowed to,
      // so Enter is the textarea's. Tab is still the browser's.
    }
  }
  if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){ e.preventDefault(); window.tbPostComment(); }
};

window.tbCompPaste=function(e){
  const items=(e&&e.clipboardData&&e.clipboardData.items)||null;
  if(!items)return;
  const files=[];
  for(let i=0;i<items.length;i++){
    const it=items[i];
    if(it&&it.kind==='file'&&it.getAsFile){ const f=it.getAsFile(); if(f)files.push(f); }
  }
  if(!files.length)return;      // ordinary text paste belongs to the field
  if(e.preventDefault)e.preventDefault();
  _tbStageFiles(files);
};

// ── Files in the drawer ───────────────────────────────────────────────
function _tbFileChip(att,opts){
  const o=opts||{};
  const href=tbFileHref(att);
  const thumb=tbThumbUrl(att,320);
  const label=_tbSlot(att.name||'file','tb-fname');
  const meta='<span class="tb-fsize">'+_tbEsc(tbFileSize(att.size))+'</span>';
  const body=thumb
    ? '<img class="tb-fthumb" src="'+_tbEsc(thumb)+'" alt="" loading="lazy"'
      +' onerror="this.style.display=\'none\'">'
    : '';
  const inner=body+'<span class="tb-fmeta">'+label+meta+'</span>';
  const cell=href
    ? '<a class="tb-file" href="'+_tbEsc(href)+'" target="_blank" rel="noopener noreferrer">'+inner+'</a>'
    : '<span class="tb-file">'+inner+'</span>';
  return'<span class="tb-filewrap">'+cell
    +(o.onRemove?'<button class="tb-x tb-frm" title="remove" onclick="'+o.onRemove+'">&times;</button>':'')
    +'</span>';
}

/** One picker element, two destinations. `_tbPickFor` says which, so the
 *  same input serves the item's Files section and the comment composer
 *  without a second hidden input to keep in step. */
let _tbPickFor='item';
window.tbPickFiles=function(kind){
  if(kind!=='comment'&&_tbNotOnIt(tbItems.filter(i=>i.id===_tbOpenItemId)[0]))return;
  _tbPickFor=kind==='comment'?'comment':'item';
  const el=document.getElementById('tb-filepick');
  if(el&&el.click)el.click();
};
window.tbFilesPicked=async function(input){
  const files=(input&&input.files)?Array.prototype.slice.call(input.files):[];
  if(input)input.value='';
  if(!files.length)return;
  if(_tbPickFor==='comment')return _tbStageFiles(files);
  return _tbAttachToItem(files);
};

/** Staged on the comment, not written yet — a file attached to a comment
 *  nobody posted should not appear on the item. */
async function _tbStageFiles(files){
  const id=_tbOpenItemId;
  if(!id)return;
  const ups=await _tbUploadAll(files);
  if(!ups.length)return;
  _tbCompFiles[id]=(_tbCompFiles[id]||[]).concat(ups);
  _tbRepaint();
}
async function _tbUploadAll(files){
  const out=[];
  for(let i=0;i<files.length;i++){
    const f=files[i];
    if(tbTooBig(f)){
      // Name the one that was left out rather than refusing the whole
      // drop or swallowing it — the rule js/boards.js settled on.
      _tbToast(String(f.name||'a file')+' is '+tbFileSize(f.size)
        +' — over the '+TB_MAX_UPLOAD_MB+' MB cap, so it was left out.');
      continue;
    }
    try{
      _tbToast('uploading '+String(f.name||'file')+'…');
      const res=await _tbUpload(f);
      out.push(tbAttachment(res,f,_tbMe(),_tbNow()));
    }catch(e){
      console.warn('[the board] upload failed',e);
      _tbToast(String((e&&e.message)||'Upload failed'));
    }
  }
  return out;
}
async function _tbAttachToItem(files){
  const id=_tbOpenItemId;
  const it=tbItems.filter(x=>x.id===id)[0];
  if(!it)return;
  const ups=await _tbUploadAll(files);
  if(!ups.length)return;
  const list=(it.attachments||[]).concat(ups);
  const now=_tbNow();
  await _tbTry(async function(){
    await _tbCommit(id,{attachments:list,updatedAt:now,lastActivityAt:now},
      ups.map(a=>({type:'file_added',byUid:_tbMe(),at:now,payload:{name:a.name}})));
    _tbApplyLocal(id,{attachments:list});
    _tbThreads[id]=null;            // the log grew — read it again
    await loadTbThread(id,true);
    _tbRepaint();
  },'attach that');
}
window.tbRemoveFile=async function(idx){
  const id=_tbOpenItemId;
  const it=tbItems.filter(x=>x.id===id)[0];
  if(!it||_tbNotOnIt(it))return;
  const list=(it.attachments||[]).slice();
  if(idx<0||idx>=list.length)return;
  list.splice(idx,1);
  await _tbTry(async function(){
    await _tbCommit(id,{attachments:list,updatedAt:_tbNow()},null);
    _tbApplyLocal(id,{attachments:list});
    _tbRepaint();
  },'remove that file');
};
window.tbUnstageFile=function(idx){
  const id=_tbOpenItemId;
  if(!id)return;
  const list=(_tbCompFiles[id]||[]).slice();
  list.splice(idx,1);
  _tbCompFiles[id]=list;
  _tbRepaint();
};

// ── Posting ───────────────────────────────────────────────────────────
window.tbPostComment=async function(){
  const id=_tbOpenItemId;
  const it=tbItems.filter(x=>x.id===id)[0];
  if(!it)return;
  const el=document.getElementById('tb-comp');
  const text=el?el.value:(_tbCompDraft[id]||'');
  const plan=tbCommentPlan(it,{
    body:text,attachments:_tbCompFiles[id]||[],uid:_tbMe(),now:_tbNow(),
    handleMap:tbHandleMap(),threadUids:tbThreadUids(_tbThread(id))
  });
  if(plan.error){ _tbToast(plan.error); return; }
  await _tbTry(async function(){
    const b=writeBatch(db);
    b.set(doc(collection(db,'board_items',id,'comments')),plan.comment);
    b.update(doc(db,'board_items',id),plan.data);
    // The author's own ranking data rides along. SET-WITH-MERGE, not
    // update: a profile row that does not exist yet would fail an
    // updateDoc and take the comment down with it, and carrying `uid`
    // satisfies both the create and the update clause of the
    // user_profiles rule.
    const me=_tbMe();
    // Not after a failed directory read: _tbMyStats() is empty then, and
    // the merge would reset the count of everyone mentioned to 1.
    if(me&&plan.mentionUids.length&&!_tbLoadFailed('user_profiles'))
      b.set(doc(db,'user_profiles',me),
        {uid:me,tbMentionStats:tbMentionBump(_tbMyStats(),plan.mentionUids,_tbNow())},{merge:true});
    await b.commit();
    _tbApplyLocal(id,plan.data);
    const th=_tbThreads[id]||{comments:[],activity:[],err:false};
    th.comments=th.comments.concat([Object.assign({_id:'local'+_tbNow()},plan.comment)]);
    _tbThreads[id]=th;
    _tbCompDraft[id]='';_tbCompFiles[id]=[];
    _tbCloseMentions();
    (plan.notify||[]).forEach(function(n){
      _tbNotify({type:n.type,forUid:n.uid,fromUid:_tbMe(),itemId:id,listId:it.listId,
        title:TB_NAME,
        message:tbUser(_tbMe()).name+(n.type==='mention'?' mentioned you on ':' commented on ')
          +'“'+(it.title||'')+'” — '+_tbPlain(plan.comment.body)});
    });
    _tbCompFocus=true;
    _tbRepaint();
  },'post that comment');
};

/** A notification snippet is TEXT, not markup — it is capped at 120
 *  characters by tbNotifPayload and escaped there, so the `@[handle]`
 *  tokens have to be unwrapped first or the bell reads "@[afnan]". */
function _tbPlain(body){
  return String(body||'')
    .replace(/@\[([A-Za-z0-9._-]{1,30})\]/g,function(m,h){
      const uid=tbHandleMap()[String(h).toLowerCase()];
      return'@'+(uid?tbUser(uid).name:h);
    })
    .replace(/[`*]/g,'').replace(/\s+/g,' ').trim();
}

// ── Request move ──────────────────────────────────────────────────────
window.tbOpenMoveReq=function(){ _tbMoveReqOpen=!_tbMoveReqOpen; _tbRepaint(); };
window.tbRequestMove=async function(){
  const id=_tbOpenItemId;
  const it=tbItems.filter(x=>x.id===id)[0];
  if(!it)return;
  const d=document.getElementById('tb-mr-date');
  const r=document.getElementById('tb-mr-why');
  const plan=tbMoveRequestPlan(it,{
    uid:_tbMe(),toDay:d&&d.value,reason:r&&r.value,
    lockerHandle:tbUser(it.lockedBy).handle,now:_tbNow()
  });
  if(plan.error){ _tbToast(plan.error); return; }
  await _tbTry(async function(){
    const b=writeBatch(db);
    b.set(doc(collection(db,'board_items',id,'comments')),plan.comment);
    b.update(doc(db,'board_items',id),plan.data);
    await b.commit();
    _tbApplyLocal(id,plan.data);
    const th=_tbThreads[id]||{comments:[],activity:[],err:false};
    th.comments=th.comments.concat([Object.assign({_id:'local'+_tbNow()},plan.comment)]);
    _tbThreads[id]=th;
    (plan.notify||[]).forEach(function(n){
      _tbNotify({type:n.type,forUid:n.uid,fromUid:_tbMe(),itemId:id,listId:it.listId,
        title:TB_NAME,
        message:tbUser(_tbMe()).name+' asks to move “'+(it.title||'')+'” to '+plan.toDay
          +' — '+plan.reason});
    });
    _tbMoveReqOpen=false;
    _tbToast('asked '+tbUser(it.lockedBy).name);
    _tbRepaint();
  },'send that request');
};
window.tbToggleActivity=function(){ _tbShowActivity=!_tbShowActivity; _tbRepaint(); };

// ── The drawer's phase-4 half ─────────────────────────────────────────
function _tbFilesSection(it,ro){
  const files=it.attachments||[];
  return'<div class="tb-dsec"><div class="tb-dsech">Files'
    +(files.length?' <span class="tb-steps">'+files.length+'</span>':'')
    +(ro?'':'<button class="tb-addfile" onclick="window.tbPickFiles(\'item\')">+ add</button>')+'</div>'
    +(files.length
      ?'<div class="tb-files">'+files.map(function(a,i){
          return _tbFileChip(a,ro?{}:{onRemove:'window.tbRemoveFile('+i+')'});
        }).join('')+'</div>'
      :'<div class="tb-hint">'+(ro?'nothing attached':'nothing attached — up to '+TB_MAX_UPLOAD_MB+' MB a file')+'</div>')
  +'</div>';
}

function _tbThreadSection(it){
  const th=_tbThread(it.id);
  const me=_tbMe();
  if(!th)return'<div class="tb-dsec"><div class="tb-dsech">Comments</div>'
    +'<div class="tb-hint">loading the thread…</div></div>';
  if(th.err)return'<div class="tb-dsec"><div class="tb-dsech">Comments</div>'
    +'<div class="tb-err">Could not read the thread. '
    +'<button class="btn-outline" onclick="window.tbReloadThread()">Retry</button></div></div>';
  const rows=th.comments.slice().sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0))
    .map(function(c){
      const u=tbUser(c.authorUid);
      return'<div class="tb-cmt"><span class="tb-av">'+_tbEsc(u.initial)+'</span>'
        +'<div class="tb-cmtbody">'
          +'<div class="tb-cmthead">'+_tbSlot(u.name,'tb-cmtwho')
            +'<span class="tb-cmtwhen">'+_tbEsc(_tbAgo(c.createdAt))+'</span></div>'
          // tbRenderBody escapes its input BEFORE formatting it, so every
          // tag in here is one that function wrote. See its header.
          +'<div class="tb-cmttext">'+tbRenderBody(c.body)+'</div>'
          +((c.attachments||[]).length
            ?'<div class="tb-files">'+c.attachments.map(a=>_tbFileChip(a,{})).join('')+'</div>':'')
        +'</div></div>';
    }).join('');
  const staged=(_tbCompFiles[it.id]||[]);
  return'<div class="tb-dsec tb-thread"><div class="tb-dsech">Comments'
      +(th.comments.length?' <span class="tb-steps">'+th.comments.length+'</span>':'')+'</div>'
    +(rows||'<div class="tb-hint">no comments yet</div>')
    +'<div class="tb-comp">'
      +'<textarea id="tb-comp" class="tb-compin" rows="2" maxlength="'+_TB_BODY_MAX+'"'
        +' placeholder="write a comment — @ to mention, ctrl+enter to post"'
        +' oninput="window.tbCompInput(this)" onkeydown="window.tbCompKey(event,this)"'
        +' onpaste="window.tbCompPaste(event)">'+_tbEsc(_tbCompDraft[it.id]||'')+'</textarea>'
      +'<div class="tb-mentions" id="tb-mentions"></div>'
      +(staged.length?'<div class="tb-files">'+staged.map(function(a,i){
          return _tbFileChip(a,{onRemove:'window.tbUnstageFile('+i+')'});
        }).join('')+'</div>':'')
      +'<div class="tb-comprow">'
        +'<button class="tb-addfile" onclick="window.tbPickFiles(\'comment\')">Attach</button>'
        +'<button class="btn-primary" onclick="window.tbPostComment()">Post</button>'
      +'</div>'
    +'</div></div>';
}

function _tbActivitySection(it){
  const th=_tbThread(it.id);
  const rows=(th&&th.activity)||[];
  const today=_tbToday();
  return'<div class="tb-dsec"><div class="tb-dsech">Activity'
      +'<button class="tb-addfile" onclick="window.tbToggleActivity()">'
      +(_tbShowActivity?'hide':'show'+(rows.length?' ('+rows.length+')':''))+'</button></div>'
    +(_tbShowActivity
      ?(rows.length
        ?'<div class="tb-actl">'+rows.slice().sort((a,b)=>Number(b.at||0)-Number(a.at||0))
            .map(function(a){
              return'<div class="tb-act">'+_tbSlot(tbActivityLine(a,d=>tbDayLabel(d,today)),'tb-acttext')
                +'<span class="tb-cmtwhen">'+_tbEsc(_tbAgo(a.at))+'</span></div>';
            }).join('')+'</div>'
        :'<div class="tb-hint">nothing logged yet</div>')
      :'')
  +'</div>';
}

function _tbMoveReqSection(it){
  const locker=tbUser(it.lockedBy);
  return'<div class="tb-mr">'
    +'<button class="btn-outline" onclick="window.tbOpenMoveReq()">'
    +(_tbMoveReqOpen?'cancel':'request move')+'</button>'
    +(_tbMoveReqOpen
      ?'<div class="tb-mrform"><div class="tb-hint">'+_tbEsc(locker.name)
        +' holds the lock. This posts the ask in the thread and pings them.</div>'
        +'<input type="date" data-tb-fp id="tb-mr-date" value="'+_tbEsc(it.date||'')+'">'
        +'<input id="tb-mr-why" maxlength="200" placeholder="why does it need to move?">'
        +'<button class="btn-primary" onclick="window.tbRequestMove()">Send</button></div>'
      :'')
  +'</div>';
}

window.tbReloadThread=async function(){
  const id=_tbOpenItemId;
  if(!id)return;
  _tbThreads[id]=null;
  await loadTbThread(id,true);
  _tbRepaint();
};

// ── The inbox (spec §7.5) ─────────────────────────────────────────────
// Rows come from hrm_notifications — the same store the bell reads — so
// `readBy` is shared: dismissing in the bell marks it read here, and
// marking it read here clears it from the bell. One unread count, two
// surfaces, and no way for them to disagree.
let tbNotifs=[];
let _tbNotifUnsub=null;
let _tbNotifSeeded=false;
let _tbNotifSeen={};
let _tbNotifErr=false;
let _tbNotifOnce=false;

function _tbHandle(){ return (typeof session!=='undefined'&&session&&session.u)||''; }
function _tbNotifRead(n,handle){ return ((n&&n.readBy)||[]).indexOf(handle)>-1; }

/** This person's Board notifications, newest first. Pure. */
function tbInboxRows(notifs,handle){
  return (notifs||[])
    .filter(n=>n&&n.source===TB_NOTIF_SOURCE&&n.forUser===handle)
    .slice().sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
}
function tbUnreadCount(notifs,handle){
  return tbInboxRows(notifs,handle).filter(n=>!_tbNotifRead(n,handle)).length;
}
/** Consecutive rows about the same item read as one block (spec §7.5) —
 *  five pings about one thread is one conversation, not five. Pure. */
function tbGroupByItem(rows){
  const out=[];
  (rows||[]).forEach(function(r){
    const last=out[out.length-1];
    const key=String((r&&r.itemId)||'');
    if(last&&last.itemId===key)last.rows.push(r);
    else out.push({itemId:key,rows:[r]});
  });
  return out;
}

/** THE THIRD SURFACE. The sidebar span already exists — phase 1 shipped
 *  `<span class="tb-navbadge" id="tb-nav-badge">` inside the nav item —
 *  so the count is painted from here and js/shared.js, a cross-track
 *  file, needs no further edit. */
function _tbPaintBadges(){
  const n=tbUnreadCount(tbNotifs,_tbHandle());
  const nav=document.getElementById('tb-nav-badge');
  if(nav)nav.textContent=n?String(n):'';
  const rail=document.getElementById('tb-rail-n');
  if(rail)rail.textContent=n?String(n):'';
}

/** Live, because the phase's definition of done is a badge that moves in
 *  ANOTHER browser within a second. Started from a startApp wrap so the
 *  count is live on every page, not only while the Board is open. */
function tbWatchNotifs(){
  if(_tbNotifUnsub)return;
  const h=_tbHandle();
  if(!h)return;
  if(!(typeof isBoardUser==='function'&&isBoardUser()))return;
  // NO LISTENER IS A FALLBACK, NOT A HANG. onSnapshot is bridged onto
  // window in index.html; an old cached shell may not carry it, and an
  // inbox waiting forever for a snapshot that will never come is the
  // stuck-skeleton failure this codebase keeps recording.
  if(typeof onSnapshot!=='function'){ loadTbNotifsOnce(); return; }
  try{
    _tbNotifUnsub=onSnapshot(
      query(collection(db,'hrm_notifications'),where('forUser','==',h)),
      function(snap){
        tbNotifs=(snap&&snap.docs||[]).map(d=>Object.assign({_id:d.id},d.data()));
        const rows=tbInboxRows(tbNotifs,h);
        // The FIRST snapshot is history, not news. Seed it silently, or
        // signing in would fire a toast for every unread row at once.
        if(_tbNotifSeeded){
          rows.forEach(function(r){
            if(_tbNotifSeen[r._id]||_tbNotifRead(r,h))return;
            _tbNotifSeen[r._id]=1;
            // Spec §5: a toast only while the Board is open.
            if(String((typeof currentPage!=='undefined'&&currentPage)||'').indexOf('tb-')===0)
              _tbToast(String(r.message||'').slice(0,120));
          });
        }else{
          rows.forEach(r=>{_tbNotifSeen[r._id]=1;});
          _tbNotifSeeded=true;
        }
        _tbPaintBadges();
        // Repainting while a comment is being written would destroy the
        // textarea the caret is in, so the inbox only redraws itself when
        // it is the open page and no drawer is over it.
        if(_tbPage==='tb-inbox'&&!_tbOpenItemId
          &&String((typeof currentPage!=='undefined'&&currentPage)||'').indexOf('tb-')===0)_tbRepaint();
      },
      function(e){
        console.warn('[the board] inbox listener failed',e);
        // A refused read and an empty inbox must never render the same
        // screen -- the Store lesson.
        _tbNotifErr=true;_tbNotifSeeded=true;
        if(_tbPage==='tb-inbox'&&!_tbOpenItemId)_tbRepaint();
      }
    );
  }catch(e){ console.warn('[the board] inbox listener failed',e); loadTbNotifsOnce(); }
}

/** The one-off read, for a session with no onSnapshot. CANNOT REJECT. */
async function loadTbNotifsOnce(){
  const h=_tbHandle();
  if(!h||_tbNotifOnce)return;
  _tbNotifOnce=true;
  try{
    const snap=await getDocs(query(collection(db,'hrm_notifications'),where('forUser','==',h)));
    tbNotifs=(snap&&snap.docs||[]).map(d=>Object.assign({_id:d.id},d.data()));
  }catch(e){
    console.warn('[the board] inbox read failed',e);
    _tbNotifErr=true;
  }
  tbInboxRows(tbNotifs,h).forEach(r=>{_tbNotifSeen[r._id]=1;});
  _tbNotifSeeded=true;
  _tbPaintBadges();
  if(_tbPage==='tb-inbox'&&!_tbOpenItemId)_tbRepaint();
}

window.tbRetryInbox=function(){
  _tbNotifErr=false;_tbNotifOnce=false;_tbNotifSeeded=false;
  _tbRepaint();
  if(_tbNotifUnsub){_tbNotifSeeded=true;_tbRepaint();return;}
  loadTbNotifsOnce();
};
window.tbOpenNotif=function(id,itemId){
  const h=_tbHandle();
  const n=tbNotifs.filter(x=>x._id===id)[0];
  if(n&&!_tbNotifRead(n,h))window.tbMarkRead(id);
  if(itemId&&tbItems.filter(x=>x.id===itemId)[0]){ window.tbOpenItem(itemId); return; }
  if(itemId)_tbToast('That item is not on your board any more.');
};
window.tbMarkRead=async function(id){
  const h=_tbHandle();
  const n=tbNotifs.filter(x=>x._id===id)[0];
  if(!n||_tbNotifRead(n,h))return;
  const readBy=((n.readBy)||[]).concat([h]);
  n.readBy=readBy;                       // optimistic; the listener confirms
  _tbPaintBadges();_tbRepaint();
  try{ await updateDoc(doc(db,'hrm_notifications',id),{readBy:readBy}); }
  catch(e){ console.warn('[the board] mark read failed',e); }
};
window.tbMarkAllRead=async function(){
  const h=_tbHandle();
  const rows=tbInboxRows(tbNotifs,h).filter(n=>!_tbNotifRead(n,h));
  if(!rows.length)return;
  rows.forEach(n=>{n.readBy=((n.readBy)||[]).concat([h]);});
  _tbPaintBadges();_tbRepaint();
  try{
    const b=writeBatch(db);
    rows.forEach(n=>{b.update(doc(db,'hrm_notifications',n._id),{readBy:n.readBy});});
    await b.commit();
  }catch(e){ console.warn('[the board] mark all read failed',e); _tbToast('Could not mark those read.'); }
};

const _TB_NOTIF_WORDS={mention:'mentioned you',comment:'commented',handover:'handed you something',
  assigned:'put you on something',moved:'moved a date',done:'marked something done',
  move_request:'asked you to move a date',due_today:'due today',overdue:'overdue'};

function _tbInboxScreen(){
  const h=_tbHandle();
  const rows=tbInboxRows(tbNotifs,h);
  const unread=rows.filter(n=>!_tbNotifRead(n,h)).length;
  if(_tbNotifErr&&!rows.length)
    return'<div class="tb-err">Could not read your inbox. '
      +'<button class="btn-outline" onclick="window.tbRetryInbox()">Retry</button>'
      +'<div class="tb-errsub">Board notifications live in hrm_notifications, '
      +'the same bell the rest of the app uses.</div></div>';
  if(!_tbNotifSeeded)
    return'<div class="tb-empty"><div class="tb-empty-h">inbox</div>'
      +'<div class="tb-empty-p">loading…</div></div>';
  if(!rows.length)
    return'<div class="tb-empty"><div class="tb-empty-h">nothing in your inbox</div>'
      +'<div class="tb-empty-p">mentions, handovers and comments land here.</div></div>';
  const groups=tbGroupByItem(rows).map(function(g){
    const it=tbItems.filter(x=>x.id===g.itemId)[0];
    return'<div class="tb-nfgroup">'
      +(it?_tbSlot(it.title||'untitled','tb-nfitem'):'')
      +g.rows.map(function(n){
        const read=_tbNotifRead(n,h);
        return'<button class="tb-nf'+(read?'':' unread')+'"'
          +' onclick="window.tbOpenNotif(\''+_tbJs(n._id)+'\',\''+_tbJs(n.itemId||'')+'\')">'
          +'<span class="tb-av">'+_tbEsc(tbUser(n.fromUid).initial)+'</span>'
          +'<span class="tb-nfmain">'
            +'<span class="tb-nftype">'+_tbEsc(_TB_NOTIF_WORDS[n.type]||String(n.type||''))+'</span>'
            // message/title were escaped on the way IN by tbNotifPayload,
            // because the bell renders them raw — so this one is already
            // safe and is slotted anyway rather than trusting that twice.
            +_tbSlot(_tbUnesc(n.message||''),'tb-nfmsg')
          +'</span>'
          +'<span class="tb-cmtwhen">'+_tbEsc(_tbAgo(n.createdAt))+'</span></button>';
      }).join('')
    +'</div>';
  }).join('');
  return'<div class="tb-nfhead"><span class="tb-dsech">Inbox</span>'
      +(unread?'<span class="tb-count red">'+unread+'</span>':'')
      +(unread?'<button class="btn-outline" onclick="window.tbMarkAllRead()">Mark all read</button>':'')
    +'</div>'+groups;
}

/** tbNotifPayload ESCAPES on the way in, because js/hrm.js prints those
 *  fields raw. This screen hydrates with textContent instead, so it has
 *  to undo that first or a name with an apostrophe reads `&#39;`. */
function _tbUnesc(s){
  return String(s==null?'':s)
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&amp;/g,'&');
}

/** Card 9 (spec §7.1): the five most recent, unread first. Cards 10–12
 *  are phase 5; this one is here because §13's definition of done for
 *  this phase names it as one of the three delivery surfaces. */
function _tbInboxCard(){
  const h=_tbHandle();
  const rows=tbInboxRows(tbNotifs,h);
  if(!rows.length)return'';
  const unread=rows.filter(n=>!_tbNotifRead(n,h));
  const pick=unread.concat(rows.filter(n=>_tbNotifRead(n,h))).slice(0,5);
  return _tbCard('Inbox',pick.map(function(n){
    return'<button class="tb-nf'+(_tbNotifRead(n,h)?'':' unread')+'"'
      +' onclick="window.tbOpenNotif(\''+_tbJs(n._id)+'\',\''+_tbJs(n.itemId||'')+'\')">'
      +'<span class="tb-av">'+_tbEsc(tbUser(n.fromUid).initial)+'</span>'
      +'<span class="tb-nfmain">'+_tbSlot(_tbUnesc(n.message||''),'tb-nfmsg')+'</span>'
      +'<span class="tb-cmtwhen">'+_tbEsc(_tbAgo(n.createdAt))+'</span></button>';
  }),{action:'<button class="tb-addfile" onclick="window.showPage(\'tb-inbox\')">View all</button>'});
}

// ── Starting the listener ─────────────────────────────────────────────
// Wrapping startApp rather than editing js/auth.js is the pattern
// js/boards.js already uses for its deep link, and for the same reason:
// js/auth.js is a cross-track file and this module should not need a line
// in it. theboard.js loads LAST, so window.startApp is already defined
// (and already wrapped once by js/boards.js — wrapping chains fine).
(function(){
  if(typeof window==='undefined')return;
  const prev=window.startApp;
  if(typeof prev!=='function')return;
  window.startApp=async function(){
    const r=await prev.apply(this,arguments);
    try{ tbWatchNotifs(); }catch(e){ console.warn('[the board] watch failed',e); }
    return r;
  };
})();

// ══ PHASE 5 — RESPONSIVE, SHORTCUTS, SEARCH, THE LAST CARDS ═══════════
// What is left of the spec: the phone, the keyboard, search, Dashboard
// cards 10–12, and the two things phase 3 deferred (the unscheduled tray
// and the week read as rows by person). Same rule as every phase before
// it: the decisions are pure functions and the handlers are wrappers.

// ── Search (spec §10) ─────────────────────────────────────────────────
// ONE BOX, over the LOADED SET. There is no server search in v1 and there
// does not need to be: the whole shared board is already in memory (a few
// hundred items at most), which is also why this can search notes and
// steps rather than only titles.
let _tbQuery='';
let _tbSearchTimer=null;

/** Does this item match, and WHERE? The `where` is what lets a result row
 *  say "matched in notes" — a row that appears for a word nowhere on it
 *  reads as a broken filter, the lesson the Boards panel search records.
 *  Pure; the thread is passed in rather than read, so it is assertable. */
function tbSearchMatch(item,q,thread){
  const it=item||{};
  const needle=String(q||'').trim().toLowerCase();
  if(!needle)return null;
  const where=[];
  const has=v=>String(v==null?'':v).toLowerCase().indexOf(needle)>-1;
  if(has(it.title))where.push('title');
  if(has(it.notes))where.push('notes');
  if((it.steps||[]).some(st=>has(st&&st.title)))where.push('steps');
  if(has(it.lane))where.push('lane');
  // COMMENTS ARE ONLY SEARCHED WHERE THE THREAD HAS BEEN READ, and that is
  // the honest limit of "over the loaded set": a thread is a subcollection
  // read when a drawer opens, so a comment in an item nobody has opened
  // this session is not in memory to search. The result row says so.
  if(((thread&&thread.comments)||[]).some(c=>has(c&&c.body)))where.push('comments');
  return where.length?{item:it,where:where}:null;
}
/** Every match, best first: a title hit outranks a hit buried in notes. */
function tbSearchItems(items,q,threads){
  const th=threads||{};
  const out=[];
  (items||[]).forEach(function(i){
    const m=tbSearchMatch(i,q,th[i&&i.id]);
    if(m)out.push(m);
  });
  out.sort(function(a,b){
    const rank=m=>m.where.indexOf('title')>-1?0:1;
    return (rank(a)-rank(b))||_tbByDate(a.item,b.item);
  });
  return out;
}

window.tbSearchInput=function(v){
  _tbQuery=String(v==null?'':v);
  if(_tbSearchTimer)clearTimeout(_tbSearchTimer);
  // Debounced, then the caret is put back — the pattern fabInvSetSearch
  // and the Boards panel already use. A repaint per keystroke would
  // rebuild main-content and destroy the field being typed into.
  _tbSearchTimer=setTimeout(function(){
    _tbSearchTimer=null;
    _tbSearchFocus=true;
    _tbRepaint();
  },180);
};
window.tbSearchClear=function(){
  _tbQuery='';_tbSearchFocus=true;_tbRepaint();
};
window.tbFocusSearch=function(){
  const el=document.getElementById('tb-search');
  if(el&&el.focus)el.focus();
  if(el&&el.select)el.select();
};
let _tbSearchFocus=false;

function _tbSearchBox(){
  return'<div class="tb-searchwrap">'+_tbIcon('search','sm')
    +'<input id="tb-search" class="tb-search" type="search" autocomplete="off" aria-label="Search The Board"'
      +' placeholder="search titles, notes and steps"'
      +' value="'+_tbEsc(_tbQuery)+'"'
      +' oninput="window.tbSearchInput(this.value)">'
    +(_tbQuery?'<button class="tb-searchx" title="clear" onclick="window.tbSearchClear()">&times;</button>':'')
  +'</div>';
}

function _tbSearchScreen(){
  const today=_tbToday();
  const hits=tbSearchItems(tbItems,_tbQuery,_tbThreads);
  if(!hits.length){
    return'<div class="tb-empty"><div class="tb-empty-h">nothing matches “'+_tbEsc(_tbQuery)+'”</div>'
      +'<div class="tb-empty-p">search covers titles, notes, steps and lanes. '
      +'Comments are searched only in threads you have opened this session.</div>'
      +'<button class="btn-outline" onclick="window.tbSearchClear()">Clear search</button></div>';
  }
  return'<div class="tb-sechead">'+hits.length+' result'+(hits.length===1?'':'s')
      +' for “'+_tbEsc(_tbQuery)+'”'
      +'<button class="tb-calbtn" onclick="window.tbSearchClear()">Clear</button></div>'
    +hits.map(function(h){
      return'<div class="tb-hit">'+_tbRow(h.item,today)
        +'<div class="tb-hitwhere">matched in '+_tbEsc(h.where.join(', '))+'</div></div>';
    }).join('');
}

// ── Keyboard (spec §10) ───────────────────────────────────────────────
// Registered ONCE at load, never per render — a listener added during a
// repaint piles up, which is the mistake js/boards.js records for its
// outside-click closers.
const TB_SHORTCUTS=[
  {k:'n',  what:'new item'},
  {k:'/',  what:'search'},
  {k:'d',  what:'dashboard'},
  {k:'c',  what:'calendar'},
  {k:'l',  what:'lists'},
  {k:'i',  what:'inbox'},
  {k:'?',  what:'this list'},
  {k:'esc',what:'close the drawer, this list, or the search'}
];
let _tbHelpOpen=false;

/** Is the caret somewhere the keys belong to the browser? */
function _tbEditableFocus(){
  const el=(typeof document!=='undefined'&&document.activeElement)||null;
  if(!el)return false;
  const tag=String(el.tagName||'').toUpperCase();
  return tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||!!el.isContentEditable;
}
/** What a keystroke means. PURE, so every branch is assertable without a
 *  keyboard: it returns the action's name, never performs it. */
function tbShortcutFor(e,ctx){
  const c=ctx||{};
  if(!e)return'';
  if(e.metaKey||e.ctrlKey||e.altKey)return'';       // those belong to the OS
  // ESCAPE IS READ BEFORE THE EDITABLE BAIL, or it is handed to the
  // browser and does nothing — the rule js/boards.js had to learn twice.
  if(e.key==='Escape'){
    if(c.helpOpen)return'help-close';
    if(c.drawerOpen)return'close-drawer';
    if(c.query)return'clear-search';
    return'';
  }
  if(c.editable)return'';
  if(e.key==='?'||(e.key==='/'&&e.shiftKey))return'help';
  if(e.key==='/')return'search';
  if(e.key==='n')return'new';
  if(e.key==='d')return'go:tb-dash';
  if(e.key==='c')return'go:tb-calendar';
  if(e.key==='l')return'go:tb-lists';
  if(e.key==='i')return'go:tb-inbox';
  return'';
}

function _tbOnKeydown(e){
  // Only while the Board is on screen: `d` must not navigate away from
  // somebody typing a PO number on another page.
  if(String((typeof currentPage!=='undefined'&&currentPage)||'').indexOf('tb-')!==0)return;
  // Board settings sits over everything, so Escape closes it before
  // anything underneath -- read before the editable bail, like the rest.
  if(e&&e.key==='Escape'&&_tbSettingsOpen){ if(e.preventDefault)e.preventDefault(); window.tbToggleSettings(); return; }
  // An open date picker takes Escape for itself (it closes the calendar);
  // closing the pane under it as well would lose the date being picked.
  if(e&&e.key==='Escape'&&_tbFpOpen())return;
  const act=tbShortcutFor(e,{
    editable:_tbEditableFocus(),
    drawerOpen:!!_tbOpenItemId,
    helpOpen:_tbHelpOpen,
    query:_tbQuery
  });
  if(!act)return;
  if(e.preventDefault)e.preventDefault();
  if(act==='help-close'){ _tbHelpOpen=false; _tbRepaint(); return; }
  if(act==='help'){ _tbHelpOpen=!_tbHelpOpen; _tbRepaint(); return; }
  if(act==='close-drawer'){ window.tbCloseItem(); return; }
  if(act==='clear-search'){ window.tbSearchClear(); return; }
  if(act==='search'){ window.tbFocusSearch(); return; }
  if(act==='new'){
    const qa=document.getElementById('tb-qa');
    if(qa&&qa.focus){ qa.focus(); return; }
    // Off the Dashboard and the list detail there is no quick-add field,
    // so `n` goes where one is rather than doing nothing.
    if(typeof showPage==='function')showPage(TB_HOME);
    else window.showPage(TB_HOME);
    return;
  }
  if(act.indexOf('go:')===0){
    const id=act.slice(3);
    if(typeof showPage==='function')showPage(id); else window.showPage(id);
  }
}
window.tbToggleHelp=function(){ _tbHelpOpen=!_tbHelpOpen; _tbRepaint(); };

function _tbHelpOverlay(){
  if(!_tbHelpOpen)return'';
  return'<div class="tb-help" onclick="window.tbToggleHelp()">'
    +'<div class="tb-helpcard" onclick="event.stopPropagation()">'
      +'<div class="tb-dsech">Keyboard</div>'
      +TB_SHORTCUTS.map(function(s){
        return'<div class="tb-helprow"><kbd class="tb-kbd">'+_tbEsc(s.k)+'</kbd>'
          +'<span class="tb-helpwhat">'+_tbEsc(s.what)+'</span></div>';
      }).join('')
      +'<button class="btn-outline" onclick="window.tbToggleHelp()">Close</button>'
    +'</div></div>';
}

// ══ SESSION 2 — P0.4: BOARD SETTINGS AND "RUN SEED" ══════════════════
// Board owners only. The seed writes items owned by OTHER people (a
// milestone's owner is its first assignee), which the rules rightly forbid
// a client, so it runs in netlify/functions/board-seed.js with the Admin
// SDK, behind a gate that checks the caller's VERIFIED ID token there --
// this button is a convenience, never the boundary.
let _tbSettingsOpen=false;
let _tbSeedState={busy:false,result:'',error:'',dry:false};

window.tbToggleSettings=function(){
  if(!_tbIsBoardOwner()){ _tbSettingsOpen=false; return; }
  _tbSettingsOpen=!_tbSettingsOpen;
  _tbRepaint();
};

/** What a seed run did, in plain words. PURE, so the wording is assertable
 *  and every number the function returns is said out loud. */
function tbSeedSummary(r,dry){
  const x=r||{};
  const lines=[];
  const n=(k,w)=>k+' '+w+(k===1?'':'s');
  lines.push(dry?'Preview — nothing was written.':'Done.');
  lines.push((dry?'Would create ':'Created ')+n(x.created||0,'milestone')
    +'; '+(x.alreadySeeded||0)+' already on the board (not touched).');
  if(x.adopted&&x.alreadySeeded)lines.push('No seed record was found, so the board was taken as it stands: nothing on it '
    +(dry?'would change':'changed')+', and nobody '+(dry?'would be':'was')+' added to the list or to a milestone. From now on the seed keeps a record.');
  if(x.listCreated)lines.push((dry?'Would create':'Created')+' the Winter Drop 2027 list.');
  if((x.listMembersAdded||[]).length)lines.push((dry?'Would add ':'Added ')+x.listMembersAdded.join(', ')+' to the list.');
  if(x.markersWritten)lines.push((dry?'Would add':'Added')+' the launch markers.');
  if((x.profilesCreated||[]).length)lines.push((dry?'Would add':'Added')+' a profile row for '+x.profilesCreated.join(', ')+'.');
  (x.peopleAdded||[]).forEach(p=>lines.push((dry?'Would add ':'Added ')+(p.who||[]).join(', ')+' to “'+p.title+'” (no login last time).'));
  if((x.deletedSince||[]).length)lines.push('Not brought back — deleted since the seed made '+((x.deletedSince.length===1)?'it':'them')
    +': '+x.deletedSince.join('; ')+'.');
  if((x.skippedUsers||[]).length)lines.push('No login yet for '+x.skippedUsers.join(', ')
    +' — left off. Once they can sign in, run it again: it adds them to the milestones they were left off, and nothing else changes.');
  if((x.skippedItems||[]).length)lines.push('Skipped '+n(x.skippedItems.length,'milestone')
    +' whose only person has no login: '+x.skippedItems.join('; ')+'.');
  return lines.join('\n');
}

window.tbRunSeed=async function(dry){
  if(!_tbIsBoardOwner()||_tbSeedState.busy)return;
  if(!dry&&typeof confirm==='function'&&!confirm('Run the Winter Drop 2027 seed now?\n\n'
    +'It is safe to run again: a milestone already on the board is not touched, '
    +'and one that was deleted is not brought back.'))return;
  _tbSeedState={busy:true,result:'',error:'',dry:!!dry};
  _tbRepaint();
  try{
    const u=(typeof auth!=='undefined'&&auth&&auth.currentUser)||null;
    if(!u||typeof u.getIdToken!=='function')throw new Error('You are not signed in — sign in again and retry.');
    const idToken=await u.getIdToken();
    const r=await fetch('/.netlify/functions/board-seed',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:idToken,dryRun:!!dry})});
    let body={};
    try{ body=await r.json(); }catch(e){}
    if(!r.ok){
      if(r.status===404)throw new Error('The seed function is not on this site yet — it ships with this build; if you are on a preview, deploy first.');
      throw new Error((body&&body.error)||('The seed answered HTTP '+r.status+'.'));
    }
    _tbSeedState={busy:false,result:tbSeedSummary(body.report,!!dry),error:'',dry:!!dry};
    if(!dry){
      // The live listeners carry the items in on their own; the profile
      // rows the seed wrote are a directory read, so ask for it again.
      if(typeof loadProfiles==='function')await loadProfiles(true);
      await loadTbData(true);
    }
  }catch(e){
    _tbSeedState={busy:false,result:'',error:String((e&&e.message)||e),dry:!!dry};
  }
  // The run can take a while and the owner may have closed Settings and
  // gone to another page meanwhile; repainting then would put the Board
  // over that page (review of 9e3b521). The result is kept either way and
  // shows next time Settings opens.
  if(_tbOnBoardPage())_tbRepaint();
};

function _tbSettingsOverlay(){
  if(!_tbSettingsOpen||!_tbIsBoardOwner())return'';
  const st=_tbSeedState;
  return'<div class="tb-help" onclick="window.tbToggleSettings()">'
    +'<div class="tb-helpcard tb-setcard" onclick="event.stopPropagation()">'
      +'<div class="tb-dsech">Board Settings</div>'
      +'<div class="tb-setsec">'
        +'<div class="tb-setsech">Winter Drop 2027</div>'
        +'<div class="tb-hint">Writes the drop list, its 42 milestones, the launch markers, and a profile row '
          +'for each Board person. Safe to run again: a milestone already on the board is not touched, '
          +'one that was deleted is not brought back, and the list and markers keep any changes.</div>'
        +'<div class="tb-setbtns">'
          +'<button class="btn-outline" id="tb-seed-preview"'+(st.busy?' disabled':'')
            +' onclick="window.tbRunSeed(true)">Preview</button>'
          +'<button class="btn-primary" id="tb-seed-run"'+(st.busy?' disabled':'')
            +' onclick="window.tbRunSeed(false)">'+(st.busy?'Working…':'Run seed')+'</button>'
        +'</div>'
        +(st.result?_tbSlot(st.result,'tb-setresult','div'):'')
        +(st.error?_tbSlot(st.error,'tb-setresult tb-seterr','div'):'')
      +'</div>'
      +'<button class="btn-outline" onclick="window.tbToggleSettings()">Close</button>'
    +'</div></div>';
}

// ── boardLastSeenAt (spec §5) ─────────────────────────────────────────
/** Throttled to once every ten minutes, so opening the Dashboard five
 *  times in a row is one write. Pure. */
const _TB_SEEN_MS=10*60*1000;
function tbSeenDue(lastAt,now){
  return Number(now||0)-Number(lastAt||0)>=_TB_SEEN_MS;
}
let _tbSeenAt=0;
async function _tbTouchSeen(){
  const me=_tbMe();
  if(!me)return;
  const now=_tbNow();
  if(!tbSeenDue(_tbSeenAt,now))return;
  _tbSeenAt=now;
  // set-with-merge and carrying `uid`, for the reason the mention stats
  // do: a profile row that does not exist yet must not throw here.
  //
  // SILENT (review of b43a3db). setDoc is the app's wrapped one, and a write
  // slower than 260ms raises the blocking "Saving…" overlay -- on every
  // launch, for all five Board users, who land here; offline, until its 25s
  // failsafe. This is ambient bookkeeping nobody asked to wait for, so it
  // takes the documented opt-out. The opt-out is released after 2s even if
  // the write never answers (offline it does not), or it would silence
  // every other module's overlay for the rest of the session.
  const hush=typeof _gvSilentSaveStart==='function'&&typeof _gvSilentSaveStop==='function';
  let held=false;
  const release=()=>{ if(held){ held=false; _gvSilentSaveStop(); } };
  if(hush){ _gvSilentSaveStart(); held=true; }
  const cap=hush?setTimeout(release,2000):null;
  try{ await setDoc(doc(db,'user_profiles',me),{uid:me,boardLastSeenAt:now},{merge:true}); }
  catch(e){ console.warn('[the board] last-seen write failed',e); }
  finally{ if(cap)clearTimeout(cap); release(); }
  const p=_tbProfiles().filter(x=>x&&x.uid===me)[0];
  if(p)p.boardLastSeenAt=now;
}

// ── Dashboard cards 10–12 ─────────────────────────────────────────────
/** Card 10. One row per Board user: what is on them, and whether they
 *  have opened the board today. The team is five people and the drop is
 *  why we are here, so this is visible to everyone (spec §7.1). Pure. */
function tbTeamToday(items,uids,today,profiles){
  const byUid={};
  (profiles||[]).forEach(function(p){ if(p&&p.uid)byUid[p.uid]=p; });
  return (uids||[]).map(function(uid){
    const mine=(items||[]).filter(i=>i&&(i.assigneeUids||[]).indexOf(uid)>-1&&i.status!=='done');
    const seen=Number((byUid[uid]||{}).boardLastSeenAt||0);
    return{
      uid:uid,
      open:mine.length,
      due:mine.filter(i=>i.date===today).length,
      overdue:mine.filter(i=>i.date&&i.date<today).length,
      // NO ROW IS AN ACCUSATION. A person with no profile row has never
      // signed in since Profiles shipped, which is not the same as "has
      // not opened the board today" — so it reads as unknown, not absent.
      seenToday:seen?_tbDay(new Date(seen))===today:null
    };
  });
}

/** Card 11. DERIVED FROM THE ITEMS ALREADY IN MEMORY — created, moved and
 *  done — rather than from a collection-group query over every item's
 *  activity subcollection.
 *
 *  Both of the spec's own examples ("mustafa completed 'earmark KG'",
 *  "afnan moved 'pricing tiers' oct 17 → oct 18") fall straight out of
 *  fields the item already carries, so this needs no new read, no new
 *  index, no firestore.rules change and nothing that can go stale.
 *
 *  WHAT IT THEREFORE DOES NOT COVER, stated rather than implied: step
 *  ticks, file adds, lock changes and handovers. Those are in the item
 *  drawer's own activity section, which reads the real log. Putting them
 *  on this card would mean a `{path=**}/activity` collection-group rule
 *  and a republish for a card that is a glance. Pure. */
function tbRecentActivity(items,limit){
  const rows=[];
  (items||[]).forEach(function(i){
    if(!i||i.visibility!=='shared')return;
    if(i.createdAt)rows.push({at:Number(i.createdAt),item:i,
      row:{type:'created',byUid:i.ownerUid,payload:{}}});
    (i.dateHistory||[]).forEach(function(h){
      if(!h||!h.at)return;
      rows.push({at:Number(h.at),item:i,
        row:{type:h.from==null?'date_set':'moved',byUid:h.byUid,
             payload:{from:h.from,to:h.to,reason:h.reason,override:!!h.override}}});
    });
    if(i.status==='done'&&i.completedAt)rows.push({at:Number(i.completedAt),item:i,
      row:{type:'done',byUid:i.completedByUid,payload:{}}});
  });
  rows.sort((a,b)=>b.at-a.at);
  return rows.slice(0,Number(limit||15));
}

/** Card 12. Lists with what is open on them, for the person looking. */
function tbMyLists(items,lists,uid){
  return (lists||[]).filter(l=>l&&!l.archived).map(function(l){
    return{
      id:l.id,title:l.title||'untitled',color:l.color||'slate',kind:l.kind,
      open:(items||[]).filter(i=>i&&i.listId===l.id&&i.status!=='done').length,
      mine:(items||[]).filter(i=>i&&i.listId===l.id&&i.status!=='done'
        &&(i.assigneeUids||[]).indexOf(uid)>-1).length
    };
  }).sort((a,b)=>b.open-a.open||String(a.title).localeCompare(String(b.title)));
}

function _tbTeamCard(){
  const today=_tbToday();
  const people=tbPeople();
  if(!people.length)return'';
  const stats={};
  tbTeamToday(tbItems,people.filter(p=>p.uid).map(p=>p.uid),today,_tbProfiles())
    .forEach(r=>{stats[r.uid]=r;});
  // ALL FIVE, FROM DAY ONE, even with nothing open (brief s4): the card
  // answers "who is on the board", and a person missing from it reads as
  // a person missing from the drop.
  return _tbCard('Team Today',people.map(function(p){
    if(!p.uid){
      return'<div class="tb-teamrow tb-teamrow-off">'
        +'<span class="tb-av">'+_tbEsc(p.initial)+'</span>'
        +_tbSlot(p.name,'tb-teamname')
        +'<span class="tb-teamn" title="'+_tbEsc(tbPersonOffText(p))+'">'
          +(p.reason==='unread'?'not loaded':p.reason==='ambiguous'?'check profile':'not set up yet')+'</span>'
      +'</div>';
    }
    const r=stats[p.uid]||{open:0,due:0,overdue:0,seenToday:null};
    const u=tbUser(p.uid);
    // Only the OVERDUE count is red (spec s10: the one red in the product
    // is the overdue count) -- the whole line used to turn red with it,
    // which made "3 open" look like an alarm (seen on the P1.5 screenshots).
    const bits=[_tbEsc(r.open+' open')]
      .concat(r.due?[_tbEsc(r.due+' due today')]:[])
      .concat(r.overdue?['<span class="tb-teamover">'+_tbEsc(r.overdue+' overdue')+'</span>']:[]);
    return'<div class="tb-teamrow">'
      +'<span class="tb-av">'+_tbEsc(u.initial)+'</span>'
      +_tbSlot(u.name,'tb-teamname')
      +'<span class="tb-teamn">'+bits.join(' · ')+'</span>'
      +(r.seenToday===false?'<span class="tb-teamdot" title="has not opened the board today"></span>':'')
    +'</div>';
  }));
}

function _tbActivityCard(){
  const today=_tbToday();
  const rows=tbRecentActivity(tbItems,15);
  if(!rows.length)return'';
  return _tbCard('Activity',rows.map(function(r){
    // tbActivityLine is the ONE definition of how a log entry reads, so
    // the card and the drawer can never word the same event differently.
    return'<div class="tb-act">'
      +_tbSlot(tbActivityLine(r.row,d=>tbDayLabel(d,today))+' — '+(r.item.title||'untitled'),'tb-acttext')
      +'<span class="tb-cmtwhen">'+_tbEsc(_tbAgo(r.at))+'</span></div>';
  }),{cls:'tb-actcard'});
}

window.tbGoList=function(id){
  _tbListId=id;
  if(typeof showPage==='function')showPage('tb-lists'); else window.showPage('tb-lists');
};

// ── The unscheduled tray (spec §7.2) ──────────────────────────────────
// ONE PREDICATE serves the grid and the tray, so a chip can never say 4
// while the tray draws 3 — the rule phase 3 already holds for the grid.
let _tbTrayOpen=true;

/** Everything the calendar's filters allow that has no date yet. Pure. */
function tbUnscheduled(items,o){
  const f=o||{},uid=f.uid||'';
  return (items||[]).filter(i=>i&&!i.date&&_tbCalPass(i,f,uid)).sort(_tbByKind);
}

function _tbTray(){
  const me=_tbMe();
  const rows=tbUnscheduled(tbItems,Object.assign({uid:me},_tbCalFilters));
  return'<div class="tb-tray'+(_tbTrayOpen?' open':'')+'">'
    +'<button class="tb-trayhead" onclick="window.tbTrayToggle()">'
      +'Unscheduled<span class="tb-count">'+rows.length+'</span>'
      +'<span class="tb-traychev">'+(_tbTrayOpen?'&rsaquo;':'&lsaquo;')+'</span></button>'
    +(_tbTrayOpen
      ?'<div class="tb-traybody">'
        +(rows.length
          ?rows.map(i=>_tbPill(i,_tbToday())).join('')
          :'<div class="tb-hint">Nothing without a date</div>')
        +'<div class="tb-hint tb-trayhint">'
        +(_tbIsPhone()?'Hold a pill to give it a date.':'Drag one onto a day.')+'</div>'
      +'</div>'
      :'')
  +'</div>';
}
window.tbTrayToggle=function(){ _tbTrayOpen=!_tbTrayOpen; _tbCalSavePrefs(); _tbRepaint(); };

// ── The week as rows by person (spec §7.2) ────────────────────────────
// "The everyone's week the founders read on Monday mornings." Desktop
// only: seven columns times five people does not fit a phone, and the
// phone already has the vertical agenda.
let _tbCalRows=false;
window.tbCalRows=function(v){ _tbCalRows=!!v; _tbCalSavePrefs(); _tbRepaint(); };

function _tbPersonWeek(days,today){
  const uids=tbPeople().map(p=>p.uid).filter(Boolean);
  const me=_tbMe();
  const head='<div class="tb-prow tb-prowhead"><div class="tb-pname"></div>'
    +days.map(function(d){
      return'<div class="tb-pday'+(d===today?' today':'')+'">'
        +_tbEsc(_tbCap(TB_DOW_LABELS[(_tbDow(d)+6)%7]))+' '+Number(String(d).slice(8))+'</div>';
    }).join('')+'</div>';
  return'<div class="tb-personweek">'+head+uids.map(function(uid){
    // Each person's row reads the SAME filter the grid does, with the
    // person pinned — so "everyone's week" cannot disagree with the week
    // you were just looking at.
    const mine=tbCalFilter(tbItems,Object.assign({},_tbCalFilters,{uid:me,scope:'all',person:uid}));
    const byDay=tbItemsByDay(mine);
    const u=tbUser(uid);
    return'<div class="tb-prow">'
      +'<div class="tb-pname"><span class="tb-av">'+_tbEsc(u.initial)+'</span>'
        +_tbSlot(u.name,'tb-pnametext')+'</div>'
      +days.map(function(d){
        return'<div class="tb-pday tb-day'+(d===today?' today':'')+'" data-day="'+_tbEsc(d)+'">'
          +(byDay[d]||[]).map(i=>_tbPill(i,today)).join('')+'</div>';
      }).join('')
    +'</div>';
  }).join('')+'</div>';
}

// ── Phone: a long press gives a date (spec §11) ───────────────────────
// "Drag & drop replaced by a move-to date picker on long-press." A 250ms
// pointer drag is not a gesture a thumb can aim on a ~50px day square,
// and the tray exists precisely to be moved FROM — so on a phone the
// pill is held rather than dragged, and the same tbMoveItem runs at the
// end of it.
let _tbMoveId=null;
window.tbOpenMove=function(id){
  const it=tbItems.filter(x=>x.id===id)[0];
  if(!it||_tbNotOnIt(it))return;
  if(!tbCanMoveDate(it,_tbMe(),_tbIsBoardOwner())){
    _tbToast('locked by '+tbUser(it.lockedBy).name);
    return;
  }
  _tbMoveId=id;_tbRepaint();
};
window.tbCloseMove=function(){ _tbMoveId=null; _tbRepaint(); };
window.tbMoveTo=function(){
  const el=document.getElementById('tb-move-date');
  const id=_tbMoveId;
  const day=el&&el.value;
  _tbMoveId=null;
  if(!id||!day){ _tbRepaint(); return; }
  window.tbMoveItem(id,day);
};
function _tbMoveSheet(){
  if(!_tbMoveId)return'';
  const it=tbItems.filter(x=>x.id===_tbMoveId)[0];
  if(!it)return'';
  const today=_tbToday();
  const quick=(d,l)=>'<button class="tb-calbtn" onclick="window.tbMoveItem(\''+_tbJs(it.id)
    +'\',\''+_tbJs(d)+'\');window.tbCloseMove()">'+_tbEsc(l)+'</button>';
  return'<div class="tb-sheet" onclick="window.tbCloseMove()">'
    +'<div class="tb-sheetcard" onclick="event.stopPropagation()">'
      +'<div class="tb-dsech">Move To</div>'
      +_tbSlot(it.title||'untitled','tb-sheettitle')
      +'<div class="tb-sheetquick">'+quick(today,'today')
        +quick(_tbDayAdd(today,1),'tomorrow')
        +quick(_tbDayAdd(today,7),'next week')+'</div>'
      +'<input type="date" data-tb-fp id="tb-move-date" value="'+_tbEsc(it.date||today)+'">'
      +'<div class="tb-sheetfoot">'
        +'<button class="btn-outline" onclick="window.tbCloseMove()">Cancel</button>'
        +'<button class="btn-primary" onclick="window.tbMoveTo()">Move</button>'
      +'</div>'
    +'</div></div>';
}

// Registered ONCE at load. A document listener added during a repaint
// piles up -- the mistake js/boards.js records for its outside-click
// closers -- and the board repaints on every action.
(function(){
  if(typeof document==='undefined'||!document.addEventListener)return;
  document.addEventListener('keydown',_tbOnKeydown);
})();

// ── Date pickers (session 2, P1.7) ────────────────────────────────────
// Every date the Board asks for is a native <input type="date"> in the
// markup -- its id, value and onchange are what everything reads -- and
// after each paint it is ENHANCED with the vendored flatpickr: a calendar
// that starts on Monday and SHOWS THE DROP'S MARKERS (launch, founders
// out) on their days, restyled to the tokens (P1.1). flatpickr fires a real
// `change` on the original input, so no handler had to learn about it.
// On a phone flatpickr hands over to the native picker, which is the right
// control there. Without flatpickr (an old cached shell, the node harness)
// the native input simply stays -- nothing depends on the enhancement.
let _tbFp=[];
/** Is any Board date picker open right now? */
function _tbFpOpen(){ return _tbFp.some(f=>f&&f.isOpen); }
/** Destroy pickers whose input left the page (or all of them). A repaint
 *  replaces the DOM, and a picker whose calendar still hangs off <body> is
 *  a leak -- one per repaint, for as long as the tab is open. */
function _tbFpPrune(all){
  _tbFp=_tbFp.filter(function(f){
    const gone=all||!f||!f.input||!(typeof document!=='undefined'&&document.contains&&document.contains(f.input));
    if(gone&&f&&f.destroy){ try{ f.destroy(); }catch(e){} }
    return!gone;
  });
}
/** The marker labels for one day in a picker, or null. Pure. */
function tbFpDayMarks(day,marks){
  const m=(marks||{})[day];
  return(Array.isArray(m)&&m.length)?m.slice():null;
}
/** The options every Board picker uses. Pure but for the callback it
 *  closes over. */
function tbFpOptions(marks,cls){
  return{
    dateFormat:'Y-m-d',altInput:true,altFormat:'D j M Y',
    altInputClass:String(cls||'').trim()+' tb-fpalt',
    locale:{firstDayOfWeek:1},
    onDayCreate:function(sel,str,fp,dayEl){
      const d=(dayEl&&dayEl.dateObj)?_tbDay(dayEl.dateObj):'';
      const m=tbFpDayMarks(d,marks);
      if(m&&dayEl){
        if(dayEl.classList)dayEl.classList.add('tb-fp-marker');
        dayEl.title=m.join(' · ');
      }
    }
  };
}
/** Enhance these inputs. A DISABLED one (a lock you cannot move) stays
 *  native and disabled -- a picker would offer a date it cannot take. */
function _tbPickersOn(els,marks){
  if(typeof flatpickr!=='function')return 0;
  let n=0;
  Array.prototype.forEach.call(els||[],function(el){
    if(!el||el.disabled||el._flatpickr)return;
    try{ _tbFp.push(flatpickr(el,tbFpOptions(marks,el.className))); n++; }catch(e){}
  });
  return n;
}
function _tbPickers(root){
  if(typeof flatpickr!=='function'||typeof document==='undefined')return;
  const host=root||document;
  if(!host.querySelectorAll)return;
  _tbPickersOn(host.querySelectorAll('input[type="date"][data-tb-fp]'),tbMarkersByDay(tbConfig));
}

// ── Routing ───────────────────────────────────────────────────────────
// ONE entry point for every tb-* page, so js/shared.js holds a single line
// for this whole module no matter how many screens it grows.
function tbRenderPage(id){
  const m=document.getElementById('main-content');
  if(!m)return;
  // The gate is re-checked here and not only in the nav: showPage can be
  // reached from a deep link, a stale button or the console. It fails
  // closed if js/auth.js did not parse.
  if(!(typeof isBoardUser==='function'&&isBoardUser())){
    m.innerHTML='<div class="empty">You do not have access to '+_tbEsc(TB_NAME)+'.</div>';
    return;
  }
  const prev=_tbPage;
  _tbPage=TB_PAGES.indexOf(id)>-1?id:TB_HOME;
  // The SAME page re-rendered from outside -- loadData's closing
  // renderPage(currentPage), which lands seconds after a Board user arrives
  // here -- used to rebuild everything at once, under a title being typed
  // or between a press and its click (review of b43a3db). It now waits
  // like a live update does. Navigating here from another page is never
  // deferred: the old page must not stay on screen.
  const again=tbLoaded&&prev===_tbPage&&!!(m.querySelector&&m.querySelector('.tb-wrap'));
  // Spec s5: written on Dashboard OPEN, throttled to once every ten
  // minutes -- it is what card 10's "has not opened the board today" dot
  // reads. Deliberately here and not in _tbDashboard: a render function
  // that writes turns every repaint into a round trip, which is what the
  // create test caught when it went from two documents to three.
  if(_tbPage===TB_HOME)_tbTouchSeen();
  // Idempotent — the startApp wrap normally gets there first. This is the
  // route for a session that reached a tb-* page some other way (a deep
  // link, a reload) without the wrap having fired.
  tbWatchNotifs();
  if(!tbLoaded){
    m.innerHTML=_tbShell(_tbPage,'<div class="tb-empty"><div class="tb-empty-h">loading…</div></div>');
    // The loader CANNOT reject (see loadTbData), so this needs no .catch
    // to avoid the stuck-skeleton failure -- but the repaint is guarded
    // anyway, since the person may have navigated away meanwhile.
    loadTbData().then(()=>{ if(currentPage===_tbPage||String(currentPage||'').indexOf('tb-')===0)_tbRepaint(); });
    return;
  }
  if(again){ _tbLiveRepaint(); return; }
  _tbRepaint();
}

let _tbPage=TB_HOME;
/** The single repaint. Everything that mutates state calls this rather
 *  than touching the DOM, so there is one place that knows how a Board
 *  screen is assembled. */
function _tbRepaint(reload){
  const m=document.getElementById('main-content');
  if(!m)return;
  if(reload&&!tbLoaded){ tbRenderPage(_tbPage); return; }
  const ae=(typeof document!=='undefined'&&document.activeElement)||null;
  if(ae&&ae.id==='tb-qa'&&_tbQa.open)_tbQaRefocus=true;
  _tbHydrateQueue=[];
  _tbFpPrune(true);
  const body=_tbScreen(_tbPage);
  // The detail pane is the frame's THIRD column (P1.4), not an overlay
  // appended after it -- so the list beside it stays on screen.
  m.innerHTML=_tbShell(_tbPage,body,_tbDrawer())+_tbMoveSheet()+_tbHelpOverlay()+_tbSettingsOverlay();
  _tbHydrate();
  _tbPickers(m);
  _tbPaintBadges();
  _tbPaintMentions();
  // The repaint rebuilds main-content wholesale, so a composer that had
  // focus loses it — and posting a comment repaints. Put the caret back
  // at the end of what is there, the way the search inputs in this app
  // already do after their own rerender.
  if(_tbSearchFocus){
    _tbSearchFocus=false;
    const q=document.getElementById('tb-search');
    if(q&&q.focus){
      q.focus();
      const n=String(q.value||'').length;
      if(q.setSelectionRange)try{q.setSelectionRange(n,n);}catch(e){}
    }
  }
  if(_tbQaRefocus){
    _tbQaRefocus=false;
    const q=document.getElementById('tb-qa');
    if(q&&q.focus){
      q.focus();
      // A rebuilt input puts the caret at 0, and the next keystrokes went
      // in FRONT of what was there (review of 05431c2).
      const n=String(q.value||'').length;
      if(q.setSelectionRange)try{q.setSelectionRange(n,n);}catch(e){}
    }
  }
  if(_tbCompFocus){
    _tbCompFocus=false;
    const c=document.getElementById('tb-comp');
    if(c&&c.focus){
      c.focus();
      const n=String(c.value||'').length;
      if(c.setSelectionRange)try{c.setSelectionRange(n,n);}catch(e){}
    }
  }
}

/** The rail's count pills (session 2, P1.2). Pure.
 *  Dashboard = what needs you TODAY: overdue + due today, for you.
 *  Calendar  = your open dated items in this Mon-Sun week.
 *  The inbox count is NOT here: it is painted live by _tbPaintBadges from
 *  the notification listener, so it moves without a repaint. */
function tbRailCounts(items,uid,today){
  const over=tbOverdue(items,uid,today).length;
  const due=tbDueToday(items,uid,today).length;
  const ws=tbWeekStart(today),we=ws?_tbDayAdd(ws,6):'';
  const week=ws?(items||[]).filter(i=>i&&_tbOpen(i)&&_tbMine(i,uid)&&i.date&&i.date>=ws&&i.date<=we).length:0;
  return{dash:over+due,over:over,due:due,week:week};
}

/** One rail entry. The label is ALWAYS in the markup (a tablet hides it
 *  with CSS and keeps it as the title), so the rail reads the same to a
 *  screen reader at every width. */
function _tbRailBtn(o){
  return'<button class="tb-railbtn'+(o.cls?' '+o.cls:'')+(o.on?' on':'')+'"'
    +(o.id?' id="'+_tbEsc(o.id)+'"':'')
    +(o.title?' title="'+_tbEsc(o.title)+'"':'')
    +(o.on?' aria-current="page"':'')
    +' onclick="'+o.onclick+'">'
    +_tbIcon(o.icon)
    +(o.labelHtml!=null?o.labelHtml:'<span class="tb-raillabel">'+_tbEsc(o.label)+'</span>')
    +(o.pill||'')
    +'</button>';
}
/** A count pill. Empty renders nothing visible (`:empty` hides it), so a
 *  zero is said by saying nothing -- the Mood Boards rail rule. */
function _tbRailPill(n,cls,title,id){
  return'<span class="tb-railpill'+(cls?' '+cls:'')+'"'
    +(id?' id="'+id+'"':'')
    +(title&&n?' title="'+_tbEsc(title)+'"':'')+'>'+(n?_tbEsc(n>99?'99+':String(n)):'')+'</span>';
}
window.tbRailLists=function(){
  // The Lists header always means the OVERVIEW; a list left open is the
  // entry under it, not what the header should reopen.
  _tbListId=null;
  if(typeof showPage==='function')showPage('tb-lists'); else window.showPage('tb-lists');
};

/** The rail + content frame every Board screen sits in (session 2, P1.2).
 *  Desktop (>=1024): a 240px rail -- icons, labels, count pills, a Lists
 *  group with every list and its open count, "+ New list" and Settings at
 *  the foot -- beside the content, which stops at 960px (the calendar
 *  keeps the full width: it is a grid). Tablet (640-1023): the same rail,
 *  56px and icon-only, the lists behind the Lists entry. Phone (<640): a
 *  strip across the top, icon over label. The search box and the ? moved
 *  out of the rail into a header row on every screen, so the rail is only
 *  navigation. The third pane (the item detail) arrives with P1.4. */
function _tbShell(page,body,pane){
  const me=_tbMe(),today=_tbToday();
  const c=tbLoaded?tbRailCounts(tbItems,me,today):{dash:0,over:0,due:0,week:0};
  const listOpen=page==='tb-lists'&&!!_tbListId;
  const go=id=>'window.showPage(\''+_tbJs(id)+'\')';
  const byId={};_TB_RAIL.forEach(t=>{byId[t.id]=t;});
  const nav=t=>{
    let pill='';
    if(t.id==='tb-dash')pill=_tbRailPill(c.dash,c.over?'tb-pill-over':'',
      [c.over?c.over+' overdue':'',c.due?c.due+' due today':''].filter(Boolean).join(' · '));
    else if(t.id==='tb-calendar')pill=_tbRailPill(c.week,'',c.week+' on you this week');
    // The live unread count: filled by _tbPaintBadges, the id is what the
    // listener paints into. Keeps its old id and class so nothing that
    // reads it moves.
    else if(t.id==='tb-inbox')pill='<span class="tb-railpill tb-pill-unread tb-railn" id="tb-rail-n"></span>';
    return _tbRailBtn({id:'tb-rail-'+t.id,on:t.id===page&&!listOpen,icon:t.icon,label:t.label,
      title:t.label,pill:pill,onclick:t.id==='tb-lists'?'window.tbRailLists()':go(t.id)});
  };
  // Lists are drawn only once the board has loaded: a list title is user
  // text and goes through the hydrate queue, which the loading paint
  // never runs.
  const lists=tbLoaded?tbMyLists(tbItems,tbLists,me):[];
  const listRows=lists.map(l=>_tbRailBtn({cls:'tb-raillist',on:listOpen&&_tbListId===l.id,
    icon:l.kind==='shared'?'users':'list',labelHtml:_tbSlot(l.title,'tb-raillabel'),
    pill:_tbRailPill(l.open,'',l.open+' open'),
    onclick:'window.tbGoList(\''+_tbJs(l.id)+'\')'})).join('');
  const rail='<nav class="tb-rail" aria-label="'+_tbEsc(TB_NAME)+'">'
    +'<div class="tb-railnav">'+['tb-dash','tb-calendar','tb-inbox'].map(id=>nav(byId[id])).join('')+'</div>'
    +'<div class="tb-railgroup">'+nav(byId['tb-lists'])
      +(listRows?'<div class="tb-raillists">'+listRows+'</div>':'')
    +'</div>'
    +'<div class="tb-railfoot">'
      // Private by default: a list made from the rail is yours until you
      // share it. Team lists are made from the Lists screen's Team "+ New",
      // so nothing becomes visible to four other people by accident.
      +_tbRailBtn({id:'tb-rail-newlist',cls:'tb-railnew',icon:'plus',label:'New list',
        title:'New private list',onclick:'window.tbNewList(\'private\')'})
      // Board owners only: the seed and, later, the markers.
      +(_tbIsBoardOwner()?_tbRailBtn({id:'tb-settings-btn',cls:'tb-setbtn',icon:'settings',
        label:'Settings',title:'Board Settings',onclick:'window.tbToggleSettings()'}):'')
    +'</div>'
  +'</nav>';
  const title=String(_tbQuery||'').trim()?'Search':((byId[page]||byId[TB_HOME]).label);
  // Spec s10: ONE search box, on every screen; `/` focuses it from anywhere.
  const head='<div class="tb-head">'
    +'<h1 class="tb-h1">'+_tbEsc(title)+'</h1>'
    +_tbSearchBox()
    +'<button class="tb-helpbtn" title="Keyboard shortcuts" aria-label="Keyboard shortcuts"'
      +' onclick="window.tbToggleHelp()">'+_tbIcon('circle-help')+'</button>'
  +'</div>';
  return'<div class="tb-wrap tb-page-'+_tbEsc(String(page||'').replace(/^tb-/,''))+(pane?' has-pane':'')+'">'
    +rail
    +'<div class="tb-main">'+head+body+'</div>'
    +(pane||'')
    +'</div>';
}

function _tbScreen(page){
  // A search is a MODE, not a fifth page: it answers "where is that item"
  // from wherever you were, and clearing it puts you back.
  if(String(_tbQuery||'').trim())return _tbSearchScreen();
  if(page==='tb-lists')return _tbListsScreen();
  if(page==='tb-calendar')return _tbCalendar();
  if(page==='tb-inbox')return _tbInboxScreen();
  return _tbDashboard();
}

// Reached by bare name from js/shared.js (classic scripts, one scope), and
// on window for the inline onclick handlers above.
window.tbRenderPage=tbRenderPage;

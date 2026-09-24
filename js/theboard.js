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
const TB_NAME='the board';

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
  {id:'tb-dash',     label:'dashboard'},
  {id:'tb-calendar', label:'calendar'},
  {id:'tb-lists',    label:'lists'},
  {id:'tb-inbox',    label:'inbox'}
];

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
  const page=TB_PAGES.indexOf(id)>-1?id:TB_HOME;
  m.innerHTML=_tbShell(page,_tbScreen(page));
}

/** The rail + content frame every Board screen sits in. */
function _tbShell(page,body){
  const tabs=_TB_RAIL.map(t=>
    '<button class="tb-railbtn'+(t.id===page?' on':'')+'" id="tb-rail-'+_tbEsc(t.id)+'"'
    +' onclick="window.showPage(\''+_tbEsc(t.id)+'\')">'+_tbEsc(t.label)+'</button>'
  ).join('');
  return'<div class="tb-wrap">'
    +'<div class="tb-rail">'+tabs+'</div>'
    +'<div class="tb-main">'+body+'</div>'
    +'</div>';
}

// Phase 1 ships the frame and honest placeholders. A placeholder that
// claims to be loading when nothing is loading is the "dead button" shape
// this codebase keeps producing — these say what they are.
function _tbScreen(page){
  const soon=(what,line)=>'<div class="tb-empty"><div class="tb-empty-h">'+_tbEsc(what)+'</div>'
    +'<div class="tb-empty-p">'+_tbEsc(line)+'</div></div>';
  if(page==='tb-calendar')return soon('calendar','Month and week land in phase 3.');
  if(page==='tb-lists')   return soon('lists','Lists land in phase 2.');
  if(page==='tb-inbox')   return soon('inbox','The inbox lands in phase 4.');
  return soon('dashboard','Your day lands in phase 2. The board is switched on and you can reach it — that is what phase 1 is.');
}

// Reached by bare name from js/shared.js (classic scripts, one scope), and
// on window for the inline onclick handlers above.
window.tbRenderPage=tbRenderPage;

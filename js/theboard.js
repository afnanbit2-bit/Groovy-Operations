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
      getDoc(doc(db,'board_config','markers'))
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
    if(r[4].status==='fulfilled'){
      const snap=r[4].value;
      const ex=snap&&typeof snap.exists==='function'?snap.exists():false;
      tbConfig=ex?snap.data():{markers:[]};
    }else{fail.push('board_config');console.warn('[the board] config read failed',r[4].reason);}
    _tbLoadErrors=fail;
    _tbCalLoadPrefs();
    tbLoaded=true;
    _tbLoading=null;
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

/** May this person move this item's date? The UI's echo of the rules
 *  clause — it hides a drag handle, it does not enforce anything. Pure. */
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
  const out={title:'',assigneeUids:[],assigneeHandles:[],lane:null,date:null,priority:0,unknownHandles:[]};

  // priority first: it is a standalone token and cannot be confused
  s=s.replace(/(\s)(!{1,2})(?=\s)/g,(m,sp,bangs)=>{
    out.priority=Math.max(out.priority,bangs.length===2?2:1);return sp;
  });
  // @handle
  s=s.replace(/(\s)@([a-z0-9._-]+)/gi,(m,sp,h)=>{
    const key=String(h).toLowerCase();
    if(handles[key]){
      if(out.assigneeUids.indexOf(handles[key])<0){out.assigneeUids.push(handles[key]);out.assigneeHandles.push(key);}
      return sp;
    }
    out.unknownHandles.push(key);
    return m;                       // unknown → left in the title, verbatim
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
  return (items||[]).filter(i=>_tbOpen(i)&&_tbMine(i,uid)&&i.ownerUid!==uid&&!above.has(i.id)).sort(_tbByDate);
}
/** The set-a-date chore. Mine to answer, because I own them. */
function tbNeedsDate(items,uid){
  return (items||[]).filter(i=>_tbOpen(i)&&i.ownerUid===uid&&!i.date)
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
function tbHandoverPlan(item,fromUid,toUid,note,keepMe,now){
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
    comment:{authorUid:fromUid,body:'handed over to @'+(toUid)+' — '+String(note).trim(),mentionUids:[toUid],createdAt:now},
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

/** Everything the UI needs about a person, from a uid. Never throws, and
 *  never renders a bare uid at someone: an unresolvable one reads as
 *  "someone", which is honest. */
function tbUser(uid){
  if(!uid)return{uid:'',name:'—',handle:'',initial:'?',colorKey:null};
  const p=_tbProfiles().filter(x=>x&&x.uid===uid)[0];
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
 *  never be offered here. */
function tbHandleMap(){
  const out={},allow=_tbBoardUsernames();
  _tbProfiles().forEach(p=>{ if(p&&p.username&&allow.indexOf(p.username)>-1)out[p.username]=p.uid; });
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

/** The row, everywhere (spec s7.1): checkbox · colour dot · title ·
 *  assignee avatars (OTHERS only — your own face on your own list is
 *  noise) · lock · step progress · comment count · date. One tap opens the
 *  drawer; the checkbox completes without opening. */
function _tbRow(item,today){
  const me=_tbMe();
  const ck=tbItemColorKey(item,tbLists,tbUserColors());
  const others=(item.assigneeUids||[]).filter(u=>u!==me);
  const pr=tbStepProgress(item);
  const overdue=item.date&&item.date<today&&item.status!=='done';
  const avatars=others.slice(0,3).map(u=>{
    const p=tbUser(u);
    return'<span class="tb-av" title="'+_tbEsc(p.name)+'">'+_tbEsc(p.initial)+'</span>';
  }).join('')+(others.length>3?'<span class="tb-av tb-av-more">+'+(others.length-3)+'</span>':'');
  return'<div class="tb-row'+(item.status==='done'?' done':'')+(item.priority===2?' crit':'')+'" data-id="'+_tbEsc(item.id)+'">'
    +'<button class="tb-check'+(item.status==='done'?' on':'')+'" title="mark done"'
      +' onclick="event.stopPropagation();window.tbToggleDone(\''+_tbEsc(item.id)+'\')"></button>'
    +'<span class="tb-dot tb-c-'+_tbEsc(ck)+'"></span>'
    +'<button class="tb-rowmain" onclick="window.tbOpenItem(\''+_tbEsc(item.id)+'\')">'
      +_tbSlot(item.title||'untitled','tb-rowtitle')
      +'<span class="tb-rowmeta">'
        +(item.kind!=='task'?'<span class="tb-kind tb-kind-'+_tbEsc(item.kind)+'">'+_tbEsc(item.kind)+'</span>':'')
        +avatars
        +(item.locked?'<span class="tb-lock" title="locked">&#128274;</span>':'')
        +(pr.label?'<span class="tb-steps">'+_tbEsc(pr.label)+'</span>':'')
        +(item.commentCount>0?'<span class="tb-cc">'+_tbEsc(item.commentCount)+'</span>':'')
        +'<span class="tb-date'+(overdue?' over':'')+'">'+_tbEsc(tbDayLabel(item.date,today))+'</span>'
      +'</span>'
    +'</button>'
  +'</div>';
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
  +'<div class="tb-quick">'
    +'<input id="tb-qa" class="tb-qainput" placeholder="add something — try: denim samples @afnan #denim oct 5 !"'
      +' oninput="window.tbQuickPreview()" onkeydown="window.tbQuickKey(event)" autocomplete="off">'
    +'<div id="tb-qa-prev" class="tb-qaprev"></div>'
  +'</div>';
}
function _tbLongDay(day){
  const p=String(day).split('-');
  const d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]),12,0,0);
  return d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}).toLowerCase();
}

/** The Dashboard — cards 1-8. Order matters and is not to be changed for
 *  looks: it runs from what is late, through what is today, to what other
 *  people are waiting on. */
function _tbDashboard(){
  const me=_tbMe(),today=_tbToday();
  if(_tbLoadFailed('board_items')){
    return _tbHeaderStrip(today)+'<div class="tb-err">Could not read the board. '
      +'<button class="btn-outline" onclick="window.tbRetry()">Retry</button>'
      +'<div class="tb-errsub">If this keeps happening, firestore.rules may not be deployed — see BOARD.md.</div></div>';
  }
  const R=list=>list.map(i=>_tbRow(i,today));
  const left=[
    _tbCard('overdue',R(tbOverdue(tbItems,me,today)),{red:true,cls:'tb-over'}),
    _tbCard('due today',R(tbDueToday(tbItems,me,today))),
    _tbCard('my day',R(tbMyDay(tbItems,me,today))),
    _tbCard('assigned to me',R(tbAssignedToMe(tbItems,me,today))),
    _tbCard('needs a date',R(tbNeedsDate(tbItems,me))),
    _tbCard('next 7 days',R(tbNext7(tbItems,me,today)))
  ].join('');
  const right=[
    _tbCard('assigned by me',R(tbAssignedByMe(tbItems,me))),
    _tbCard('deadlines',R(tbDeadlines(tbItems,today,14)),{cls:'tb-deadlines'})
  ].join('');
  const empty=(!left&&!right)
    ?'<div class="tb-empty"><div class="tb-empty-h">nothing on the board today</div>'
     +'<div class="tb-empty-p">add something above, or open the calendar.</div></div>':'';
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
    return'<button class="tb-listcard" onclick="window.tbOpenList(\''+_tbEsc(l.id)+'\')">'
      +'<span class="tb-dot tb-c-'+_tbEsc(TB_COLORS[l.color]?l.color:'slate')+'"></span>'
      +_tbSlot(l.title||'untitled','tb-listname')
      +'<span class="tb-listn">'+open+'</span></button>';
  };
  const sec=(t,ls,kind)=>'<div class="tb-sec"><div class="tb-sech">'+_tbEsc(t)
    +'<button class="tb-newlist" onclick="window.tbNewList(\''+kind+'\')">+ new</button></div>'
    +(ls.length?ls.map(card).join(''):'<div class="tb-cardempty">no '+_tbEsc(t)+' lists yet</div>')+'</div>';
  return sec('team',shared,'shared')+sec('private',priv,'private');
}

function _tbListDetail(l){
  const today=_tbToday();
  const all=tbItems.filter(i=>i.listId===l.id);
  const open=all.filter(i=>i.status!=='done').sort(_tbByDate);
  const done=all.filter(i=>i.status==='done');
  const isAdmin=l.adminUid===_tbMe()||_tbIsBoardOwner();
  return'<div class="tb-listhead">'
    +'<button class="tb-back" onclick="window.tbCloseList()">&lsaquo; lists</button>'
    +_tbSlot(l.title||'untitled','tb-listtitle','h2')
    +'<span class="tb-badge">'+_tbEsc(l.kind==='shared'?'team':'private')+'</span>'
    +(isAdmin?'<span class="tb-badge">admin</span>':'')
  +'</div>'
  +'<div class="tb-quick">'
    +'<input id="tb-qa" class="tb-qainput" placeholder="add to this list"'
      +' oninput="window.tbQuickPreview()" onkeydown="window.tbQuickKey(event)" autocomplete="off">'
    +'<div id="tb-qa-prev" class="tb-qaprev"></div>'
  +'</div>'
  +_tbCard('open',open.map(i=>_tbRow(i,today)),{keepEmpty:true,empty:'nothing open in this list'})
  +(done.length?_tbCard('done',done.map(i=>_tbRow(i,today))):'');
}

/** The drawer. Phase 2: title, kind, lock, the meta row, steps, notes and
 *  the footer actions. Comments, files and @mentions are phase 4. */
function _tbDrawer(){
  if(!_tbOpenItemId)return'';
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it)return'';
  const me=_tbMe(),today=_tbToday();
  const canMove=tbCanMoveDate(it,me,_tbIsBoardOwner());
  const pr=tbStepProgress(it);
  const lockedBy=it.locked?tbUser(it.lockedBy):null;
  const moved=it.datePlanned&&it.date&&it.datePlanned!==it.date;
  const opt=(v,cur,label)=>'<option value="'+_tbEsc(v)+'"'+(v===cur?' selected':'')+'>'+_tbEsc(label||v)+'</option>';
  return'<div class="tb-drawer" id="tb-drawer">'
    +'<div class="tb-dhead">'
      +'<button class="tb-back" onclick="window.tbCloseItem()">close</button>'
      +'<span class="tb-kind tb-kind-'+_tbEsc(it.kind)+'">'+_tbEsc(it.kind)+'</span>'
      +'<button class="tb-lockbtn'+(it.locked?' on':'')+'" onclick="window.tbToggleLock(\''+_tbEsc(it.id)+'\')"'
        +(it.locked&&!canMove?' disabled title="only '+_tbEsc(lockedBy.name)+' or a board owner can unlock this"':'')
        +'>'+(it.locked?'&#128274; locked':'&#128275; lock')+'</button>'
      +(it.locked&&!canMove?'<span class="tb-lockwho">locked by '+_tbEsc(lockedBy.name)+'</span>':'')
    +'</div>'
    +'<input class="tb-dtitle" id="tb-d-title" value="'+_tbEsc(it.title||'')+'" maxlength="140"'
      +' onchange="window.tbFieldChange(\'title\',this.value)">'
    +'<div class="tb-dmeta">'
      +'<label>date'
        +'<input type="date" id="tb-d-date" value="'+_tbEsc(it.date||'')+'"'+(canMove?'':' disabled')
        +' onchange="window.tbFieldChange(\'date\',this.value)"></label>'
      +(moved?'<span class="tb-was">was '+_tbEsc(tbDayLabel(it.datePlanned,today))+'</span>':'')
      +'<label>list<select id="tb-d-list" onchange="window.tbFieldChange(\'listId\',this.value)">'
        +opt('',it.listId||'','none')
        +tbLists.filter(l=>!l.archived).map(l=>opt(l.id,it.listId||'',l.title||'untitled')).join('')
      +'</select></label>'
      +'<label>lane<select id="tb-d-lane" onchange="window.tbFieldChange(\'lane\',this.value)">'
        +opt('',it.lane||'','none')+TB_LANES.map(l=>opt(l,it.lane||'')).join('')
      +'</select></label>'
      +'<label>priority<select id="tb-d-pri" onchange="window.tbFieldChange(\'priority\',this.value)">'
        +opt('0',String(it.priority),'normal')+opt('1',String(it.priority),'high')+opt('2',String(it.priority),'critical')
      +'</select></label>'
      +'<label>kind<select id="tb-d-kind" onchange="window.tbFieldChange(\'kind\',this.value)">'
        +TB_KINDS.map(k=>opt(k,it.kind)).join('')
      +'</select></label>'
    +'</div>'
    +'<div class="tb-dsec"><div class="tb-dsech">people</div><div class="tb-people">'
      +_tbBoardUsernames().map(h=>{
        const uid=tbHandleMap()[h];
        if(!uid)return'';
        const on=(it.assigneeUids||[]).indexOf(uid)>-1;
        return'<button class="tb-person'+(on?' on':'')+'" onclick="window.tbToggleAssignee(\''+_tbEsc(uid)+'\')">'
          +_tbEsc(tbUser(uid).name)+'</button>';
      }).join('')
    +'</div></div>'
    +'<div class="tb-dsec"><div class="tb-dsech">steps'+(pr.label?' <span class="tb-steps">'+_tbEsc(pr.label)+'</span>':'')+'</div>'
      +(pr.allDone?'<div class="tb-hint">all steps done — mark the item done when you have reviewed it</div>':'')
      +'<div class="tb-stepl">'+(it.steps||[]).map((st,i)=>
        '<div class="tb-step"><button class="tb-check'+(st.done?' on':'')+'" onclick="window.tbToggleStep('+i+')"></button>'
        +_tbSlot(st.title||'','tb-steptitle')
        +'<button class="tb-x" onclick="window.tbRemoveStep('+i+')" title="remove">&times;</button></div>').join('')
      +'</div>'
      +'<input class="tb-stepadd" id="tb-step-new" placeholder="add a step" onkeydown="window.tbStepKey(event)">'
    +'</div>'
    +'<div class="tb-dsec"><div class="tb-dsech">notes</div>'
      +'<textarea class="tb-notes" id="tb-d-notes" rows="4" placeholder="markdown-lite"'
        +' oninput="window.tbNotesInput(this.value)">'+_tbEsc(it.notes||'')+'</textarea>'
      +'<div class="tb-savestate" id="tb-d-save"></div>'
    +'</div>'
    +'<div class="tb-dfoot">'
      +'<button class="btn-outline" onclick="window.tbAddToMyDay(\''+_tbEsc(it.id)+'\')">add to my day</button>'
      +'<button class="btn-outline" onclick="window.tbOpenHandover()">hand over</button>'
      +'<button class="btn-primary" onclick="window.tbToggleDone(\''+_tbEsc(it.id)+'\')">'
        +(it.status==='done'?'reopen':'done')+'</button>'
      +(it.ownerUid===me||_tbIsBoardOwner()
        ?'<button class="tb-x tb-del" onclick="window.tbDeleteItem(\''+_tbEsc(it.id)+'\')">delete</button>':'')
    +'</div>'
    +'<div id="tb-handover"></div>'
  +'</div>';
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
window.tbQuickPreview=function(){
  const el=document.getElementById('tb-qa');
  const out=document.getElementById('tb-qa-prev');
  if(!el||!out)return;
  const parsed=tbParseQuickAdd(el.value,{today:_tbToday(),handles:tbHandleMap()});
  const names={};
  Object.keys(tbHandleMap()).forEach(h=>{names[h]=tbUser(tbHandleMap()[h]).name;});
  const line=tbQuickAddPreview(parsed,{today:_tbToday(),names:names});
  out.textContent=line+(parsed.unknownHandles.length
    ?(line?'   ':'')+'(@'+parsed.unknownHandles.join(', @')+' is not on the board — left in the title)':'');
};
window.tbQuickKey=function(e){
  if(e.key!=='Enter')return;
  e.preventDefault();
  const el=document.getElementById('tb-qa');
  if(!el||!String(el.value).trim())return;
  const text=el.value;
  el.value='';
  window.tbQuickPreview();
  // Shift+Enter opens the drawer on the new item for detail (spec s8.1).
  window.tbCreateFromQuick(text,e.shiftKey);
};
window.tbCreateFromQuick=async function(text,openAfter){
  const me=_tbMe();
  const parsed=tbParseQuickAdd(text,{today:_tbToday(),handles:tbHandleMap()});
  if(!parsed.title){ _tbToast('Give it a title.'); return; }
  // On the Dashboard an undated item defaults to today and me; inside a
  // list it stays undated, because a list is a backlog (spec s8.1).
  const inList=!!_tbListId;
  const assignees=parsed.assigneeUids.slice();
  if(assignees.indexOf(me)<0)assignees.unshift(me);
  const data=tbNewItem({
    title:parsed.title,
    assigneeUids:assignees,
    lane:parsed.lane,
    priority:parsed.priority,
    listId:_tbListId||null,
    date:parsed.date||(inList?null:_tbToday())
  },me,_tbNow(),tbLists);
  await _tbTry(async()=>{
    const ref=doc(collection(db,'board_items'));
    const b=writeBatch(db);
    b.set(ref,data);
    b.set(doc(collection(db,'board_items',ref.id,'activity')),
      {type:'created',byUid:me,at:data.createdAt,payload:{}});
    await b.commit();
    tbItems.push(tbDecodeItem(Object.assign({id:ref.id},data)));
    if(openAfter)_tbOpenItemId=ref.id;
    _tbRepaint();
  },'add that');
};

// ── Edit ──────────────────────────────────────────────────────────────
window.tbFieldChange=async function(field,value){
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it)return;
  let v=value;
  if(field==='priority')v=Number(value);
  if(field==='listId'||field==='lane')v=value||null;
  if(field==='date')v=value||null;
  if(field==='kind'&&TB_KINDS.indexOf(v)<0)return;
  const plan=tbItemPatch(it,_tbObj(field,v),_tbMe(),_tbNow());
  if(!Object.keys(plan.data).filter(k=>k!=='updatedAt'&&k!=='lastActivityAt').length)return;
  await _tbTry(async()=>{
    await _tbCommit(it.id,plan.data,plan.activity);
    _tbApplyLocal(it.id,plan.data);
    _tbRepaint();
  },'save that');
};
function _tbObj(k,v){ const o={}; o[k]=v; return o; }

window.tbToggleAssignee=async function(uid){
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it)return;
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
  if(!it)return;
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
let _tbNotesTimer=null;
window.tbNotesInput=function(v){
  const st=document.getElementById('tb-d-save');
  if(st)st.textContent='unsaved…';
  if(_tbNotesTimer)clearTimeout(_tbNotesTimer);
  _tbNotesTimer=setTimeout(()=>window.tbSaveNotes(v),800);
};
window.tbSaveNotes=async function(v){
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it||String(it.notes||'')===String(v||''))return;
  const st=document.getElementById('tb-d-save');
  if(st)st.textContent='saving…';
  const ok=await _tbTry(async()=>{
    await _tbCommit(it.id,{notes:String(v||''),updatedAt:_tbNow(),lastActivityAt:_tbNow()},null);
    it.notes=String(v||'');
  },'save the notes');
  const st2=document.getElementById('tb-d-save');
  if(st2)st2.textContent=ok?'saved':'save failed';
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
  if(!it)return;
  if((it.steps||[]).length>=30){ _tbToast('Thirty steps is the limit — this wants to be its own list.'); return; }
  const steps=(it.steps||[]).concat([{id:'s'+_tbNow()+Math.floor(Math.random()*1000),title:String(title).slice(0,140),done:false,doneByUid:null,doneAt:null}]);
  await _tbStepsWrite(it,steps,null);
};
window.tbToggleStep=async function(i){
  const it=tbItems.filter(x=>x.id===_tbOpenItemId)[0];
  if(!it||!it.steps[i])return;
  const steps=it.steps.map((s,n)=>n!==i?s:Object.assign({},s,
    {done:!s.done,doneByUid:!s.done?_tbMe():null,doneAt:!s.done?_tbNow():null}));
  // Completing the LAST step does not complete the item — people want to
  // review first (spec s8.3). The drawer shows a hint instead.
  await _tbStepsWrite(it,steps,steps[i].done?{type:'step_done',byUid:_tbMe(),at:_tbNow(),payload:{title:steps[i].title}}:null);
};
window.tbRemoveStep=async function(i){
  const it=tbItems.filter(x=>x.id===_tbOpenItemId)[0];
  if(!it||!it.steps[i])return;
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
  if(!it)return;
  const list=tbLists.filter(l=>l.id===it.listId)[0];
  const plan=tbDonePlan(it,_tbMe(),_tbNow(),list&&list.adminUid);
  await _tbTry(async()=>{
    await _tbCommit(it.id,plan.data,plan.activity);
    _tbApplyLocal(it.id,plan.data);
    (plan.notify||[]).forEach(uid=>_tbNotify({
      type:'done',forUid:uid,fromUid:_tbMe(),itemId:it.id,listId:it.listId,
      title:'the board',message:tbUser(_tbMe()).name+' completed “'+(it.title||'')+'”'}));
    _tbRepaint();
  },'mark that done');
};
window.tbAddToMyDay=async function(id){
  const it=tbItems.filter(i=>i.id===id)[0];
  if(!it)return;
  const me=_tbMe(),today=_tbToday();
  const myDay=Object.assign({},it.myDay||{});
  if(myDay[me]===today)delete myDay[me]; else myDay[me]=today;
  await _tbTry(async()=>{
    await _tbCommit(it.id,{myDay:myDay,updatedAt:_tbNow()},null);
    _tbApplyLocal(it.id,{myDay:myDay});
    _tbToast(myDay[me]?'added to your day':'removed from your day');
    _tbRepaint();
  },'update my day');
};
window.tbOpenHandover=function(){
  const host=document.getElementById('tb-handover');
  if(!host)return;
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it)return;
  const me=_tbMe();
  host.innerHTML='<div class="tb-ho"><div class="tb-dsech">hand over</div>'
    +'<select id="tb-ho-who">'+_tbBoardUsernames().map(h=>{
      const uid=tbHandleMap()[h];
      return (uid&&uid!==me)?'<option value="'+_tbEsc(uid)+'">'+_tbEsc(tbUser(uid).name)+'</option>':'';
    }).join('')+'</select>'
    +'<input id="tb-ho-note" placeholder="one line — what do they need to know?" maxlength="200">'
    +'<label class="tb-hokeep"><input type="checkbox" id="tb-ho-keep"> keep me on it</label>'
    +'<button class="btn-primary" onclick="window.tbHandOver()">hand over</button></div>';
};
window.tbHandOver=async function(){
  const it=tbItems.filter(i=>i.id===_tbOpenItemId)[0];
  if(!it)return;
  const who=document.getElementById('tb-ho-who');
  const note=document.getElementById('tb-ho-note');
  const keep=document.getElementById('tb-ho-keep');
  const plan=tbHandoverPlan(it,_tbMe(),who&&who.value,note&&note.value,!!(keep&&keep.checked),_tbNow());
  if(plan.error){ _tbToast(plan.error); return; }
  await _tbTry(async()=>{
    const b=writeBatch(db);
    b.update(doc(db,'board_items',it.id),plan.data);
    b.set(doc(collection(db,'board_items',it.id,'activity')),plan.activity);
    b.set(doc(collection(db,'board_items',it.id,'comments')),plan.comment);
    await b.commit();
    _tbApplyLocal(it.id,plan.data);
    it.commentCount=(it.commentCount||0)+1;
    _tbNotify({type:'handover',forUid:plan.notifyUid,fromUid:_tbMe(),itemId:it.id,listId:it.listId,
      title:'the board',message:tbUser(_tbMe()).name+' handed you “'+(it.title||'')+'” — '+plan.note});
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
    tbLists.push(Object.assign({id:ref.id},data));
    _tbListId=ref.id;
    _tbRepaint();
  },'create the list');
};
window.tbOpenList=function(id){ _tbListId=id; _tbRepaint(); };
window.tbCloseList=function(){ _tbListId=null; _tbRepaint(); };
window.tbOpenItem=function(id){ _tbOpenItemId=id; _tbRepaint(); };
window.tbCloseItem=function(){ _tbOpenItemId=null; _tbRepaint(); };

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
function tbCalFilter(items,o){
  const f=o||{},uid=f.uid||'';
  const lanes=f.lane?[f.lane]:null;
  return(items||[]).filter(i=>{
    if(!i||!i.date)return false;                       // undated is phase 5's tray
    if(f.hideDone&&i.status==='done')return false;
    // 'me' is what I am ON, not what I own — the calendar answers "what is
    // my week", and something I set for someone else is not my week.
    if(f.scope!=='all'&&(i.assigneeUids||[]).indexOf(uid)<0)return false;
    if(f.scope==='all'&&i.visibility!=='shared'&&i.ownerUid!==uid)return false;
    if(f.person&&(i.assigneeUids||[]).indexOf(f.person)<0)return false;
    if(f.list&&i.listId!==f.list)return false;
    if(lanes&&lanes.indexOf(i.lane||'')<0)return false;
    if(f.color&&tbItemColorKey(i,tbLists,tbUserColors())!==f.color)return false;
    return true;
  });
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
function tbMovePlan(item,toDay,uid,isOwner,now){
  const it=item||{};
  if(!_tbValidDay(toDay))return{refused:true,reason:'That is not a date.'};
  if((it.date||null)===toDay)return{refused:true,reason:'',noop:true};
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
  try{ return !!(window.matchMedia&&window.matchMedia('(max-width:600px)').matches); }
  catch(e){ return false; }
}
function _tbCalLoadPrefs(){
  if(_tbIsPhone())_tbCalView='week';
  try{
    const raw=localStorage.getItem(_TB_CAL_KEY);
    if(!raw)return;
    const o=JSON.parse(raw)||{};
    if(o.view==='week'||o.view==='month')_tbCalView=o.view;
    if(o.filters&&typeof o.filters==='object')
      _tbCalFilters=Object.assign({scope:'me',person:'',list:'',lane:'',color:'',hideDone:false},o.filters);
  }catch(e){}                      // a corrupt or blocked store is not an error
}
function _tbCalSavePrefs(){
  try{ localStorage.setItem(_TB_CAL_KEY,JSON.stringify({view:_tbCalView,filters:_tbCalFilters})); }catch(e){}
}

// ── Rendering ─────────────────────────────────────────────────────────
/** A pill. Gates are solid, a lock shows, a done item fades rather than
 *  celebrating (spec s10: no gamification). */
function _tbPill(item,today){
  const me=_tbMe();
  const ck=tbItemColorKey(item,tbLists,tbUserColors());
  const canMove=tbCanMoveDate(item,me,_tbIsBoardOwner());
  const cls=['tb-pill','tb-c-'+ck]
    .concat(item.kind==='gate'?['gate']:[])
    .concat(item.kind==='event'?['event']:[])
    .concat(item.status==='done'?['done']:[])
    .concat(item.locked?['locked']:[])
    .concat(canMove?['draggable']:[]);
  return'<div class="'+cls.join(' ')+'" data-id="'+_tbEsc(item.id)+'"'
    +' data-day="'+_tbEsc(item.date||'')+'"'
    +(canMove?' onpointerdown="window.tbPillDown(event,\''+_tbEsc(item.id)+'\')"':'')
    +' onclick="window.tbPillClick(event,\''+_tbEsc(item.id)+'\')"'
    +' tabindex="0" onkeydown="window.tbPillKey(event,\''+_tbEsc(item.id)+'\')">'
    +'<span class="tb-pillbar"></span>'
    +(item.locked?'<span class="tb-pilllock" title="locked">&#128274;</span>':'')
    +_tbSlot(item.title||'untitled','tb-pilltitle')
  +'</div>';
}

function _tbCalHead(){
  const today=_tbToday();
  const label=_tbCalView==='week'?tbWeekLabel(_tbCalAnchor):tbMonthLabel(_tbCalAnchor.slice(0,7));
  const seg=(v,l)=>'<button class="tb-seg'+(_tbCalView===v?' on':'')+'"'
    +' onclick="window.tbCalView(\''+v+'\')">'+_tbEsc(l)+'</button>';
  const scope=(v,l)=>'<button class="tb-seg'+(_tbCalFilters.scope===v?' on':'')+'"'
    +' onclick="window.tbCalScope(\''+v+'\')">'+_tbEsc(l)+'</button>';
  const opt=(v,cur,l)=>'<option value="'+_tbEsc(v)+'"'+(v===cur?' selected':'')+'>'+_tbEsc(l)+'</option>';
  const people=_tbBoardUsernames().map(h=>{
    const uid=tbHandleMap()[h];
    return uid?opt(uid,_tbCalFilters.person,tbUser(uid).name):'';
  }).join('');
  return'<div class="tb-calbar">'
    +'<div class="tb-calnav">'
      +'<button class="tb-calbtn" onclick="window.tbCalStep(-1)" title="back">&lsaquo;</button>'
      +'<button class="tb-calbtn" onclick="window.tbCalToday()">today</button>'
      +'<button class="tb-calbtn" onclick="window.tbCalStep(1)" title="forward">&rsaquo;</button>'
      +'<span class="tb-callabel">'+_tbEsc(label)+'</span>'
    +'</div>'
    +'<div class="tb-calseg">'+seg('month','month')+seg('week','week')+'</div>'
    +'<div class="tb-calseg">'+scope('me','me')+scope('all','everyone')+'</div>'
    +'<div class="tb-calfilters">'
      +'<select onchange="window.tbCalFilter(\'person\',this.value)">'
        +opt('',_tbCalFilters.person,'anyone')+people+'</select>'
      +'<select onchange="window.tbCalFilter(\'list\',this.value)">'
        +opt('',_tbCalFilters.list,'any list')
        +tbLists.filter(l=>!l.archived).map(l=>opt(l.id,_tbCalFilters.list,l.title||'untitled')).join('')
      +'</select>'
      +'<select onchange="window.tbCalFilter(\'lane\',this.value)">'
        +opt('',_tbCalFilters.lane,'any lane')
        +TB_LANES.map(l=>opt(l,_tbCalFilters.lane,l)).join('')
      +'</select>'
      +'<label class="tb-calchk"><input type="checkbox"'+(_tbCalFilters.hideDone?' checked':'')
        +' onchange="window.tbCalFilter(\'hideDone\',this.checked)"> hide done</label>'
      +(_tbCalActive()?'<button class="tb-calbtn" onclick="window.tbCalClear()">clear</button>':'')
    +'</div>'
  +'</div>';
}
function _tbCalActive(){
  const f=_tbCalFilters;
  return!!(f.person||f.list||f.lane||f.color||f.hideDone||f.scope==='all');
}

/** A day cell — the drop target. `data-day` is what the drag reads. */
function _tbDayCell(day,items,today,opts){
  const o=opts||{};
  const marks=(_tbCalMarks[day]||[]);
  const cls=['tb-day']
    .concat(day===today?['today']:[])
    .concat(o.inMonth===false?['out']:[])
    .concat(marks.length?['marked']:[])
    .concat(_tbDow(day)===0||_tbDow(day)===6?['weekend']:[]);
  return'<div class="'+cls.join(' ')+'" data-day="'+_tbEsc(day)+'">'
    +'<div class="tb-dayhead">'
      +'<span class="tb-daynum">'+Number(String(day).slice(8))+'</span>'
      +(marks.length?'<span class="tb-daymark">'+_tbEsc(marks.join(' · '))+'</span>':'')
      +'<button class="tb-dayadd" title="add on this day"'
        +' onclick="window.tbCalAdd(\''+_tbEsc(day)+'\')">+</button>'
    +'</div>'
    +'<div class="tb-daylist">'+items.map(i=>_tbPill(i,today)).join('')+'</div>'
  +'</div>';
}

let _tbCalMarks={};
function _tbCalendar(){
  const me=_tbMe(),today=_tbToday();
  if(!_tbCalAnchor)_tbCalAnchor=today;
  if(_tbLoadFailed('board_items')){
    return _tbCalHead()+'<div class="tb-err">Could not read the board. '
      +'<button class="btn-outline" onclick="window.tbRetry()">Retry</button>'
      +'<div class="tb-errsub">If this keeps happening, firestore.rules may not be deployed — see BOARD.md.</div></div>';
  }
  const shown=tbCalFilter(tbItems,Object.assign({uid:me},_tbCalFilters));
  const byDay=tbItemsByDay(shown);
  _tbCalMarks=tbMarkersByDay(tbConfig);
  const dow='<div class="tb-dowrow">'+TB_DOW_LABELS.map(d=>'<div class="tb-dow">'+_tbEsc(d)+'</div>').join('')+'</div>';
  let grid='';
  if(_tbCalView==='week'){
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
    +' · drag a pill to move it'
    +'</div>';
  return _tbCalHead()+dow+grid+note;
}

// ── View controls ─────────────────────────────────────────────────────
window.tbCalView=function(v){
  _tbCalView=(v==='week')?'week':'month';
  _tbCalSavePrefs();_tbRepaint();
};
window.tbCalScope=function(v){
  _tbCalFilters.scope=(v==='all')?'all':'me';
  _tbCalSavePrefs();_tbRepaint();
};
window.tbCalFilter=function(k,v){
  if(k==='hideDone')_tbCalFilters.hideDone=!!v;
  else _tbCalFilters[k]=v||'';
  _tbCalSavePrefs();_tbRepaint();
};
window.tbCalClear=function(){
  _tbCalFilters={scope:'me',person:'',list:'',lane:'',color:'',hideDone:false};
  _tbCalSavePrefs();_tbRepaint();
};
window.tbCalStep=function(n){
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
  const parsed=tbParseQuickAdd(text,{today:_tbToday(),handles:tbHandleMap()});
  const assignees=parsed.assigneeUids.slice();
  if(assignees.indexOf(me)<0)assignees.unshift(me);
  const data=tbNewItem({
    title:parsed.title||String(text).slice(0,140),
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
    tbItems.push(tbDecodeItem(Object.assign({id:ref.id},data)));
    _tbRepaint();
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
  if(!it)return;
  if(!tbCanMoveDate(it,_tbMe(),_tbIsBoardOwner())){
    _tbToast('locked by '+tbUser(it.lockedBy).name);
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
      title:'the board',
      message:tbUser(_tbMe()).name+' moved “'+(it.title||'')+'” to '+tbDayLabel(toDay,_tbToday())}));
    if(plan.override)_tbToast('moved — you overrode '+tbUser(plan.data.lockedBy||it.lockedBy).name+"'s lock, and it is logged");
    _tbRepaint();
  },'move that');
  if(!ok)_tbApplyLocal(id,{date:before});
};

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
  _tbPage=TB_PAGES.indexOf(id)>-1?id:TB_HOME;
  if(!tbLoaded){
    m.innerHTML=_tbShell(_tbPage,'<div class="tb-empty"><div class="tb-empty-h">loading…</div></div>');
    // The loader CANNOT reject (see loadTbData), so this needs no .catch
    // to avoid the stuck-skeleton failure -- but the repaint is guarded
    // anyway, since the person may have navigated away meanwhile.
    loadTbData().then(()=>{ if(currentPage===_tbPage||String(currentPage||'').indexOf('tb-')===0)_tbRepaint(); });
    return;
  }
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
  _tbHydrateQueue=[];
  const body=_tbScreen(_tbPage);
  m.innerHTML=_tbShell(_tbPage,body)+_tbDrawer();
  _tbHydrate();
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

function _tbScreen(page){
  if(page==='tb-lists')return _tbListsScreen();
  if(page==='tb-calendar')return _tbCalendar();
  if(page==='tb-inbox')return'<div class="tb-empty"><div class="tb-empty-h">inbox</div>'
    +'<div class="tb-empty-p">The inbox lands in phase 4. Board notifications already reach the bell.</div></div>';
  return _tbDashboard();
}

// Reached by bare name from js/shared.js (classic scripts, one scope), and
// on window for the inline onclick handlers above.
window.tbRenderPage=tbRenderPage;

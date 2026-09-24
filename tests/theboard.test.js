/* ─────────────────────────────────────────────────────────────────────────
   The Board — phase 1: the audience, the routing and the boundaries.

   What this holds:
     · Saim's account and the `designer` role exist and expose nothing else.
     · BOARD_USERS / BOARD_OWNERS (js/auth.js) and isBoardUser() /
       isBoardOwner() (firestore.rules) name the SAME people. This is the
       assertion that matters most — a nav grant and a rules grant drifting
       apart is how a feature silently half-ships.
     · The tab appears first for a Board user and not at all for anyone
       else, on every one of the five routes that render it.
     · showPage lets each role reach tb-* and nothing it should not.
     · The lock clause, the append-only activity log and the absence of a
       board_notifications collection are really in the rules.
     · `tb` has not leaked into the `boards` namespace js/boards.js owns.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite}=harness;
const LS={getItem:()=>null,setItem(){},removeItem(){}};
const loadApp=o=>harness.loadApp(Object.assign({},o,{globals:Object.assign({localStorage:LS},(o&&o.globals)||{})}));
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

const FILES=['js/shared.js','js/auth.js','js/theboard.js'];
// The full owner sidebar reaches helpers in the HRM and store-cash modules,
// so the nav section loads those too. Scoped roles return early and do not.
const NAV_FILES=['js/shared.js','js/auth.js','js/embellishments.js','js/hrm.js','js/store.js','js/store-accounts.js','js/marketing.js','js/patterns.js','js/theboard.js'];
const AMMAR  ={uid:'u-ammar', u:'ammar',  name:'Ammar',  role:'owner',   email:'ammar@groovy.op',  canPO:true,canFabric:true};
const DANIYAL={uid:'u-dani',  u:'daniyal',name:'Daniyal',role:'creator_content_ops_lead',email:'daniyal@groovy.op'};
const SAIM   ={uid:'u-saim',  u:'saim',   name:'Saim',   role:'designer',email:'saim@groovy.op'};
const HARIS  ={uid:'u-haris', u:'haris',  name:'Haris',  role:'worker',  email:'haris@groovy.op',stages:['qc']};

module.exports=async function(){
  const s=suite('theboard');

  s.section('the accounts');
  {
    const a=loadApp({files:FILES});
    const d=a.run("USER_DEFS.find(x=>x.u==='saim')");
    s.ok('saim is in USER_DEFS',!!d);
    s.eq('with the designer role',d&&d.role,'designer');
    s.eq('on the groovy.op domain every other account uses',d&&d.email,'saim@groovy.op');
    s.ok('and no password field',d&&!('pass' in d));
    // saim and sami are one letter apart and are two different people.
    const sami=a.run("USER_DEFS.find(x=>x.u==='sami')");
    s.eq('sami is still the CSR lead, untouched',sami&&sami.role,'csr_lead');
    s.ok('sami is NOT a Board user, so the two never share a mention list',
      a.run("BOARD_USERS.indexOf('sami')")===-1);
    s.eq('every username in BOARD_USERS is a real account',
      a.run("BOARD_USERS.filter(u=>!USER_DEFS.some(d=>d.u===u)).join(',')"),'');
    s.eq('and so is every owner',
      a.run("BOARD_OWNERS.filter(u=>BOARD_USERS.indexOf(u)<0).join(',')"),'');
    s.eq('the five at launch',a.run('BOARD_USERS.join(",")'),'ammar,afnan,daniyal,mustafa,saim');
    s.eq('two of them own it',a.run('BOARD_OWNERS.join(",")'),'ammar,afnan');
  }

  s.section('js/auth.js and firestore.rules name the same people');
  {
    // The guard isPaidPRApprover() and isScoringAdmin() already carry. It is
    // the only thing stopping a nav grant and a rules grant from drifting.
    const a=loadApp({files:FILES});
    const rules=read('firestore.rules');
    const emails=fn=>{
      const m=new RegExp('function '+fn+'\\(\\)\\s*\\{[\\s\\S]*?\\[([^\\]]*)\\]').exec(rules);
      return ((m&&m[1]||'').match(/'([^']+)'/g)||[]).map(x=>x.replace(/'/g,'')).sort();
    };
    const fromDefs=list=>a.run('('+J(list)+').map(u=>USER_DEFS.find(d=>d.u===u).email)').sort();
    s.eq('isBoardUser() lists exactly BOARD_USERS',
      J(emails('isBoardUser')),J(fromDefs(a.run('BOARD_USERS'))));
    s.eq('isBoardOwner() lists exactly BOARD_OWNERS',
      J(emails('isBoardOwner')),J(fromDefs(a.run('BOARD_OWNERS'))));
  }

  s.section('who the client thinks is on the board');
  {
    const a=loadApp({files:FILES});
    const asUser=(u,fn)=>{a.run('session='+J(u));return a.run(fn);};
    s.eq('ammar is a board owner',asUser(AMMAR,'isBoardOwner()'),true);
    s.eq('daniyal is a member, not an owner',asUser(DANIYAL,'isBoardOwner()'),false);
    s.eq('…and is a board user',asUser(DANIYAL,'isBoardUser()'),true);
    s.eq('saim is a board user',asUser(SAIM,'isBoardUser()'),true);
    s.eq('haris is not',asUser(HARIS,'isBoardUser()'),false);
    // Fails CLOSED — the whole point of the typeof guard in js/shared.js.
    const bare=loadApp({files:['js/shared.js']});
    bare.run('session='+J(AMMAR));
    s.eq('with auth.js absent the tab is hidden, not shown',bare.run('_canSeeTheBoard()'),false);
  }

  s.section('where each role can go');
  {
    const go=(a,id)=>{a.run('globalThis.__got=null');a.run('window.showPage('+J(id)+')');return a.run('__got');};
    const app=u=>{
      const a=loadApp({files:FILES,currentPage:'dashboard'});
      a.run('session='+J(u));
      a.run('renderPage=function(id){globalThis.__got=id;}');
      return a;
    };
    const saim=app(SAIM);
    ['tb-dash','tb-calendar','tb-lists','tb-inbox','profile','bug-tracker']
      .forEach(id=>s.eq('saim reaches '+id,go(saim,id),id));
    ['dashboard','po-registry','gatepass','mkt-creators','boards','users','store-dashboard','pattern-hub','fabric-inventory']
      .forEach(id=>s.eq('saim is sent to the board from '+id,go(saim,id),'tb-dash'));

    const dani=app(DANIYAL);
    ['tb-dash','tb-calendar','tb-lists','tb-inbox']
      .forEach(id=>s.eq('daniyal reaches '+id,go(dani,id),id));
    ['mkt-creators','mkt-dispatches','shopify-intel','profile']
      .forEach(id=>s.eq('daniyal keeps '+id,go(dani,id),id));
    ['dashboard','po-registry','users','boards']
      .forEach(id=>s.eq('daniyal is still sent home from '+id,go(dani,id),'mkt-creators'));

    const ammar=app(AMMAR);
    s.eq('an owner reaches the board',go(ammar,'tb-dash'),'tb-dash');
    s.eq('and everything else he had',go(ammar,'po-registry'),'po-registry');
  }

  s.section('the tab, on every route that renders it');
  {
    const nav=u=>{
      const a=loadApp({files:NAV_FILES,currentPage:'dashboard'});
      a.run('session='+J(u));
      a.run('buildNav()');
      return a;
    };
    const owner=nav(AMMAR);
    const sb=owner.el('sidebar').innerHTML;
    const ids=(sb.match(/showPage\('([a-z-]+)'\)/g)||[]).map(x=>x.slice(10,-2));
    s.eq('the board is FIRST in the sidebar, above Dashboard',ids[0],'tb-dash');
    s.eq('…and Dashboard is still right behind it',ids[1],'dashboard');
    s.ok('it carries the unread badge span',/id="tb-nav-badge"/.test(sb));
    s.ok('labelled from the one constant',sb.indexOf(owner.run('TB_NAME'))>-1);

    const dani=nav(DANIYAL);
    const dsb=dani.el('sidebar').innerHTML;
    s.eq('first for the marketing lead too',
      ((dsb.match(/showPage\('([a-z-]+)'\)/g)||[]).map(x=>x.slice(10,-2)))[0],'tb-dash');
    s.ok('his own pages survive',/mkt-creators/.test(dsb)&&/shopify-intel/.test(dsb));
    // #mob-nav is a fixed 5-column grid, so Intel moved behind More rather
    // than becoming a squeezed sixth button. It must still be reachable.
    const dmob=dani.el('mob-nav').innerHTML;
    s.ok('his phone nav gained More',/More/.test(dmob));
    s.ok('and Intel is no longer a direct button',!/Intel/.test(dmob));
    dani.run('window.openMktMoreSheet()');
    const sheet=dani.el('mob-sheet-items').innerHTML;
    s.ok('because it lives in that sheet, with the board above it',
      /shopify-intel/.test(sheet)&&sheet.indexOf('tb-dash')<sheet.indexOf('shopify-intel'));

    const saim=nav(SAIM);
    const ssb=saim.el('sidebar').innerHTML;
    s.eq('the designer sees exactly one page',
      J((ssb.match(/showPage\('([a-z-]+)'\)/g)||[]).map(x=>x.slice(10,-2))),J(['tb-dash']));
    const smob=saim.el('mob-nav').innerHTML;
    s.ok('and gets the four-tab bar the spec asks for on a phone',
      /tb-dash[\s\S]*tb-calendar[\s\S]*tb-lists[\s\S]*tb-inbox/.test(smob));
    s.eq('in four columns',saim.el('mob-nav').className,'cols-4');

    const haris=nav(HARIS);
    s.ok('a non-board user sees no tab at all',haris.el('sidebar').innerHTML.indexOf('tb-dash')===-1);
    haris.run('window.openMoreSheet()');
    s.ok('and no entry in the More sheet either',
      haris.el('mob-sheet-items').innerHTML.indexOf('tb-dash')===-1);
    const om=nav(AMMAR);
    om.run('window.openMoreSheet()');
    s.ok('an owner does get one, first',
      om.el('mob-sheet-items').innerHTML.indexOf('tb-dash')>-1);
  }

  s.section('routing, and the gate behind it');
  {
    const a=loadApp({files:FILES,currentPage:'tb-dash'});
    a.run('session='+J(AMMAR));
    a.run("tbRenderPage('tb-dash')");
    const html=a.el('main-content').innerHTML;
    s.ok('the rail renders',/class="tb-rail"/.test(html));
    s.ok('with all four screens',/tb-calendar[\s\S]*tb-lists[\s\S]*tb-inbox/.test(html));
    s.ok('the current one marked',/tb-railbtn on/.test(html));
    // A deep link is not a way in: the module re-checks rather than
    // trusting that the nav hid the tab.
    a.run('session='+J(HARIS));
    a.run("tbRenderPage('tb-dash')");
    s.ok('a non-board user is refused by the module itself',
      /do not have access/.test(a.el('main-content').innerHTML));
    // An unknown tb-* id lands on the home screen instead of a blank page.
    a.run('session='+J(AMMAR));
    a.run("tbRenderPage('tb-nonsense')");
    s.ok('an unknown board page falls back to the dashboard',
      /class="tb-rail"/.test(a.el('main-content').innerHTML));
    s.ok('every page id is tb-*',a.run('TB_PAGES.every(p=>p.indexOf("tb-")===0)'));
    s.ok('and the one routing line in shared.js covers them all',
      /id\.startsWith\('tb-'\)/.test(read('js/shared.js')));
  }

  s.section('a day is a local day, never a UTC one');
  {
    const a=loadApp({files:FILES});
    // toISOString() is UTC, and in PKT (UTC+5) it names the PREVIOUS day
    // between midnight and 5am — so "today" on a phone opened at 2am would
    // be yesterday. The helper must echo back the LOCAL components it was
    // given, whatever zone this runner is in.
    s.eq('2am on the 25th is the 25th',a.run('_tbDay(new Date(2026,8,25,2,0,0))'),'2026-09-25');
    s.eq('11pm on the 25th is still the 25th',a.run('_tbDay(new Date(2026,8,25,23,59,0))'),'2026-09-25');
    s.eq('and months are padded',a.run('_tbDay(new Date(2026,0,5,12,0,0))'),'2026-01-05');
    // Line-based, because this module's own comment NAMES the trap it is
    // avoiding. A regex that strips block comments is what corrupts a scan
    // (a `/*` inside a string eats the rest of the file), so drop only
    // whole comment LINES and look at the code that is left.
    const codeLines=read('js/theboard.js').split(String.fromCharCode(10))      .filter(l=>!/^\s*(\/\/|\*|\/\*)/.test(l));
    s.ok('the module never CALLS toISOString, only warns about it',
      !codeLines.some(l=>/toISOString/.test(l)));
    s.eq('a day later',a.run("_tbDayAdd('2026-10-30',1)"),'2026-10-31');
    s.eq('across a month end',a.run("_tbDayAdd('2026-10-31',1)"),'2026-11-01');
    s.eq('backwards too',a.run("_tbDayAdd('2026-11-01',-1)"),'2026-10-31');
    s.eq('a week to launch',a.run("_tbDayAdd('2026-10-23',7)"),'2026-10-30');
    s.eq('junk in, empty out',a.run("_tbDayAdd('not a date',1)"),'');
  }

  s.section('notifications go through one escaping helper');
  {
    const a=loadApp({files:FILES});
    // _hrmNotifCardHTML (js/hrm.js) prints title and message into HTML RAW.
    // That is why this helper exists and why nothing may bypass it.
    const n=a.run("tbNotifPayload({type:'mention',forUser:'mustafa',fromUid:'u-dani',itemId:'i1',title:"
      +J('<img src=x onerror=alert(1)>')+",message:"+J("it's <b>due</b>")+"})");
    s.ok('a tag in the title cannot reach the bell',!/<img/.test(n.title)&&/&lt;img/.test(n.title));
    s.ok('nor in the message',!/<b>/.test(n.message)&&/&lt;b&gt;/.test(n.message));
    s.ok("and a quote is escaped too",/&#39;/.test(n.message));
    s.eq('it is tagged as ours so the inbox card can filter',n.source,'tb');
    s.eq('addressed by username, which is what the bell keys on',n.forUser,'mustafa');
    s.eq('and points back at the board',n.actionUrl,'tb-dash');
    // Deterministic id: one row per actor/type/item per 10-minute bucket,
    // so several devices or a double click cannot stack duplicates.
    const t0=Date.parse('2026-09-25T10:00:00Z');
    const id=(at)=>a.run('_tbNotifId("mention","i1","u-dani",'+at+')');
    s.eq('the same minute is the same id',id(t0),id(t0+60*1000));
    s.eq('nine minutes later, still the same',id(t0),id(t0+9*60*1000));
    s.ok('eleven minutes later, a new one',id(t0)!==id(t0+11*60*1000));
    s.ok('a different item is a different id',id(t0)!==a.run('_tbNotifId("mention","i2","u-dani",'+t0+')'));
    s.ok('a different type too',id(t0)!==a.run('_tbNotifId("assigned","i1","u-dani",'+t0+')'));
    s.ok('the id is safe as a document path',/^[A-Za-z0-9_-]+$/.test(a.run('_tbNotifId("men/tion","i..1","u d",'+t0+')')));
  }

  s.section('the rules really say what the product promises');
  {
    const rules=read('firestore.rules');
    const items=(/match \/board_items\/\{id\} \{[\s\S]*?\n    \}/.exec(rules)||[''])[0];
    s.ok('board_items has its own block',items.length>0);
    // The lock IS the product. A member may comment on a locked item and
    // may not move it; that has to hold on the server, not in the UI.
    s.ok('an update on a locked item must leave date and dueAt alone…',
      /resource\.data\.get\('locked', false\) != true[\s\S]*?date[\s\S]*?dueAt/.test(items));
    s.ok('…unless you are the locker or a board owner',
      /request\.auth\.uid == resource\.data\.get\('lockedBy', ''\)[\s\S]*?isBoardOwner\(\)/.test(items));
    s.ok('and lockedBy cannot be re-pointed to walk around it',
      /request\.resource\.data\.get\('lockedBy', null\) == resource\.data\.get\('lockedBy', null\)/.test(items));
    s.ok('a private item is unreadable by anyone but its owner',
      /resource\.data\.visibility == 'shared' \|\| request\.auth\.uid == resource\.data\.ownerUid/.test(items));
    s.ok('the creator owns what they create and is on it',
      /request\.resource\.data\.ownerUid == request\.auth\.uid[\s\S]*?in request\.resource\.data\.assigneeUids/.test(items));
    s.ok('activity is append-only',/match \/activity\/\{a\} \{[\s\S]*?allow update, delete: if false;/.test(items));
    s.ok('a comment is no more readable than its item',/allow read:\s+if isBoardUser\(\) && tbCanReadItem\(id\)/.test(items));
    s.ok('board_lists is gated on membership',
      /match \/board_lists\/\{id\} \{[\s\S]*?in resource\.data\.memberUids/.test(rules));
    s.ok('board_config is owner-written',
      /match \/board_config\/\{doc\} \{[\s\S]*?allow write: if isBoardOwner\(\);/.test(rules));
    // The decision was to reuse the existing bell, so this collection must
    // NOT exist — a stray match block would be a second, silent store.
    s.ok('there is no board_notifications collection',!/board_notifications/.test(rules.replace(/\/\/[^\n]*/g,'')));
    s.ok('and the deploy config points the CLI at this file',
      /"rules":\s*"firestore\.rules"/.test(read('firebase.json'))
      &&/"indexes":\s*"firestore\.indexes\.json"/.test(read('firebase.json')));
    s.ok('with no hosting key, so a deploy cannot touch Netlify',!/hosting/.test(read('firebase.json')));
  }

  s.section('tb has not leaked into the boards namespace');
  {
    const src=read('js/theboard.js');
    // js/boards.js owns 259 .board-* rules and ~400 boards*/_boards* globals,
    // in ONE shared lexical scope. A collision here is a parse error that
    // takes the whole app down, not a styling nuisance.
    s.ok('no global here starts with boards',!/\b(function|const|let|var)\s+_?boards[A-Za-z0-9_]/.test(src));
    s.ok('no board-* class can reach the DOM from here',
      !/class="[^"]*board-/.test(src) && !/classList\.[a-z]+\('board-/.test(src));
    s.ok('every class it emits is tb-*',
      (src.match(/class="([^"]+)"/g)||[]).every(c=>/tb-/.test(c)||!/-/.test(c)));
    s.ok('every page id is namespaced',(src.match(/'tb-[a-z]+'/g)||[]).length>0);
    const css=read('css/main.css');
    s.ok('the stylesheet gained a .tb- block',/\.tb-wrap\{/.test(css));
    s.ok('and a four-column phone nav to hold the designer tab bar',/#mob-nav\.cols-4/.test(css));
    s.ok('spec s10 wanted a monospace token; the app had none',/--font-mono:/.test(css));
  }

  return s;
};

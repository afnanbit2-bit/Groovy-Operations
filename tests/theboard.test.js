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
// js/shared.js defines its own showToast, which SHADOWS the harness stub —
// so harness `state.toasts` is always empty in any suite that loads it.
// Capture them explicitly after load instead.
const catchToasts=a=>{a.run('globalThis.__toasts=[];showToast=function(m){__toasts.push(String(m));};');return a;};
const toastsOf=a=>a.run('__toasts')||[];

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
    ['dashboard','po-registry','users','pattern-hub']
      .forEach(id=>s.eq('daniyal is still sent home from '+id,go(dani,id),'mkt-creators'));
    // 'boards' (Mood Boards) used to sit in that list. Daniyal was given
    // Creative Hub in Sept 2026, so it now opens for him through the hub
    // list -- tests/marketing.test.js holds that the same ROLE off the list
    // is still sent home, which is what keeps tb- and board- apart.
    s.eq('daniyal reaches Mood Boards through Creative Hub',go(dani,'boards'),'boards');

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
    // Every class token is either tb-*, or one of the app's OWN component
    // classes reused on purpose (spec rule 2: match conventions, do not
    // invent a second UI vocabulary). Anything else is a namespace nobody
    // agreed to -- and a `board-` token is the collision this prefix exists
    // to prevent.
    // `red` is an app-WIDE modifier, not a class of ours: .item-bal.red,
    // .kpi-card.red and .month-stat.red all carry it, and .tb-count.red
    // follows that convention rather than inventing a second word for it.
    // Phase 2 used it too — at js/theboard.js's `(o.red?' red':'')`, which
    // this scan could not see because the token is built by concatenation.
    const REUSED=['btn-outline','btn-primary','empty','card','section-title','red'];
    const tokens=new Set();
    (src.match(/class="([^"]*)"/g)||[]).forEach(c=>{
      c.slice(7,-1).split(/[ ]+/).forEach(t=>{ if(t&&/^[a-z][a-z0-9-]*$/.test(t))tokens.add(t); });
    });
    const stray=[...tokens].filter(t=>t.indexOf('tb-')!==0&&REUSED.indexOf(t)<0);
    s.eq('every class is tb-* or a deliberately reused app class',stray.join(','),'');
    s.ok('and something was actually checked',tokens.size>=20,tokens.size+' class tokens');
    s.ok('every page id is namespaced',(src.match(/'tb-[a-z]+'/g)||[]).length>0);
    const css=read('css/main.css');
    s.ok('the stylesheet gained a .tb- block',/\.tb-wrap\{/.test(css));
    s.ok('and a four-column phone nav to hold the designer tab bar',/#mob-nav\.cols-4/.test(css));
    s.ok('spec s10 wanted a monospace token; the app had none',/--font-mono:/.test(css));
  }

  // ══ PHASE 2 ═════════════════════════════════════════════════════════

  s.section('quick add — the grammar');
  {
    const a=loadApp({files:FILES});
    const CTX={today:'2026-09-24',handles:{ammar:'u-ammar',afnan:'u-afnan',daniyal:'u-dani',mustafa:'u-must',saim:'u-saim'}};
    const p=t=>a.run('tbParseQuickAdd('+J(t)+','+J(CTX)+')');

    // The spec's own example.
    const ex=p('denim samples @afnan #denim oct 5 !');
    s.eq('the title is what is left',ex.title,'denim samples');
    s.eq('the assignee is resolved to a uid',J(ex.assigneeUids),J(['u-afnan']));
    s.eq('the lane is tagged',ex.lane,'denim');
    s.eq('the date is read',ex.date,'2026-10-05');
    s.eq('and one bang is high',ex.priority,1);

    s.eq('two bangs is critical',p('ship it !!').priority,2);
    // "fix this!" must NOT become a priority — the token is standalone.
    s.eq('a bang inside a word is just punctuation',p('fix this!').priority,0);
    s.eq('and stays in the title',p('fix this!').title,'fix this!');

    s.eq('several assignees',J(p('review @ammar @afnan').assigneeUids),J(['u-ammar','u-afnan']));
    s.eq('the same one twice is once',J(p('@ammar @ammar x').assigneeUids),J(['u-ammar']));
    // An unknown handle is often a real name (@baber). Dropping it from the
    // title silently would be worse than leaving it.
    const unk=p('call @baber about denim');
    s.eq('an unknown handle stays literal',unk.title,'call @baber about denim');
    s.eq('and nobody is assigned',J(unk.assigneeUids),J([]));
    s.eq('but it is reported, so the UI can say so',J(unk.unknownHandles),J(['baber']));

    s.eq('today',p('x today').date,'2026-09-24');
    s.eq('tomorrow',p('x tomorrow').date,'2026-09-25');
    // 24 Sep 2026 is a Thursday.
    s.eq('a weekday ahead',p('x friday').date,'2026-09-25');
    s.eq('a weekday that IS today means today',p('x thursday').date,'2026-09-24');
    s.eq('a weekday behind wraps to next week',p('x monday').date,'2026-09-28');
    s.eq('month then day',p('x oct 5').date,'2026-10-05');
    s.eq('day then month',p('x 5 oct').date,'2026-10-05');
    s.eq('long month names too',p('x october 5').date,'2026-10-05');
    // D/M, not M/D. This is a Pakistani team; 5/10 is the fifth of October.
    s.eq('5/10 is the fifth of October, not the tenth of May',p('x 5/10').date,'2026-10-05');
    // A month already gone reads as next year.
    s.eq('jan 5 in September means the January coming',p('x jan 5').date,'2027-01-05');
    s.eq('an impossible date is not a date',p('x 31 feb').date,null);
    s.eq('first match wins',p('x today tomorrow').date,'2026-09-24');
    s.eq('no date token, no date',p('just a title').date,null);
    s.eq('the date token leaves the title',p('ship denim oct 5').title,'ship denim');

    // The preview reads the SAME parse, so it cannot promise otherwise.
    const names={afnan:'Afnan'};
    s.eq('the preview line',
      a.run('tbQuickAddPreview('+J(ex)+','+J({today:CTX.today,names:names})+')'),
      '→ oct 5 · Afnan · denim · high');   // the bang is echoed back, so you can see it landed
    s.eq('nothing parsed, nothing promised',
      a.run('tbQuickAddPreview('+J(p('plain title'))+','+J({today:CTX.today})+')'),'');
  }

  s.section('an item, and what an edit makes of it');
  {
    const a=loadApp({files:FILES});
    const NOW=1790000000000;
    const mk=(o,lists)=>a.run('tbNewItem('+J(o||{})+',"u-ammar",'+NOW+','+J(lists||[])+')');

    const t=mk({title:'x'});
    s.eq('the creator owns it',t.ownerUid,'u-ammar');
    s.eq('and is on it',J(t.assigneeUids),J(['u-ammar']));
    s.eq('mine alone and unlisted is private',t.visibility,'private');
    s.eq('a task is not locked',t.locked,false);
    // A GATE IS LOCKED BY DEFAULT. That is what a gate is.
    const g=mk({title:'all assets in',kind:'gate'});
    s.eq('a gate is locked on creation',g.locked,true);
    s.eq('by whoever set it',g.lockedBy,'u-ammar');
    s.eq('a second assignee makes it shared',
      mk({title:'x',assigneeUids:['u-ammar','u-afnan']}).visibility,'shared');
    s.eq('so does joining a shared list',
      mk({title:'x',listId:'l1'},[{id:'l1',kind:'shared'}]).visibility,'shared');
    s.eq('a private list does not',
      mk({title:'x',listId:'l2'},[{id:'l2',kind:'private'}]).visibility,'private');
    s.eq('the first date is also the planned one',mk({title:'x',date:'2026-10-25'}).datePlanned,'2026-10-25');
    s.eq('a title is capped at 140',mk({title:'z'.repeat(200)}).title.length,140);

    const item=Object.assign({id:'i1'},mk({title:'x',date:'2026-10-25'}));
    const moved=a.run('tbItemPatch('+J(item)+',{date:"2026-10-28"},"u-afnan",'+(NOW+1)+',"factory slipped")');
    s.eq('a move writes the new date',moved.data.date,'2026-10-28');
    s.eq('datePlanned NEVER changes — it is what "was Oct 25" is drawn from',
      moved.data.datePlanned,undefined);
    s.eq('the move is in the history',moved.data.dateHistory.length,1);
    s.eq('with who and why',
      J([moved.data.dateHistory[0].from,moved.data.dateHistory[0].to,moved.data.dateHistory[0].byUid,moved.data.dateHistory[0].reason]),
      J(['2026-10-25','2026-10-28','u-afnan','factory slipped']));
    s.eq('and an activity row',moved.activity[0].type,'moved');
    // The FIRST date an undated item gets is a date_set, not a move.
    const undated=Object.assign({id:'i2'},mk({title:'y'}));
    const setIt=a.run('tbItemPatch('+J(undated)+',{date:"2026-11-09"},"u-ammar",'+NOW+')');
    s.eq('setting a first date records the planned date',setIt.data.datePlanned,'2026-11-09');
    s.eq('and reads as date_set, not moved',setIt.activity[0].type,'date_set');
    const noop=a.run('tbItemPatch('+J(item)+',{date:"2026-10-25",title:"x"},"u-ammar",'+NOW+')');
    s.eq('an edit that changes nothing writes no history',J(noop.data.dateHistory),J(undefined));
    s.eq('and logs nothing',noop.activity.length,0);

    // The UI's echo of the rules clause. It hides a handle; it enforces
    // nothing — firestore.rules does that.
    const locked=Object.assign({},item,{locked:true,lockedBy:'u-ammar'});
    s.eq('the locker may move it',a.run('tbCanMoveDate('+J(locked)+',"u-ammar",false)'),true);
    s.eq('nobody else may',a.run('tbCanMoveDate('+J(locked)+',"u-afnan",false)'),false);
    s.eq('a board owner may, and it is logged',a.run('tbCanMoveDate('+J(locked)+',"u-afnan",true)'),true);
    s.eq('an unlocked item is anyone’s',a.run('tbCanMoveDate('+J(item)+',"u-dani",false)'),true);
  }

  s.section('the dashboard answers one question per card');
  {
    const a=loadApp({files:FILES});
    const T='2026-09-24';
    const it=(o)=>Object.assign({id:o.id,title:o.id,status:'open',kind:'task',visibility:'shared',
      assigneeUids:o.as||['u-ammar'],ownerUid:o.own||'u-ammar',date:o.date===undefined?null:o.date,
      myDay:o.myDay||{},steps:[],dateHistory:[],attachments:[]},o.extra||{});
    const ITEMS=[
      it({id:'late1',date:'2026-09-20'}),
      it({id:'late2',date:'2026-09-22'}),
      it({id:'today1',date:T,extra:{kind:'task'}}),
      it({id:'todayGate',date:T,extra:{kind:'gate'}}),
      it({id:'todayEvent',date:T,extra:{kind:'event'}}),
      it({id:'myday',date:'2026-10-10',myDay:{'u-ammar':T}}),
      it({id:'fromAfnan',date:'2026-10-02',own:'u-afnan',as:['u-ammar']}),
      it({id:'nodate',date:null}),
      it({id:'soon',date:'2026-09-28'}),
      it({id:'far',date:'2026-11-20'}),
      it({id:'iAsked',own:'u-ammar',as:['u-ammar','u-must'],date:'2026-10-05'}),
      it({id:'gateSoon',date:'2026-10-03',extra:{kind:'gate'},as:['u-must'],own:'u-must'}),
      it({id:'gateFar',date:'2026-12-01',extra:{kind:'gate'},as:['u-must'],own:'u-must'}),
      it({id:'donesToo',date:T,extra:{status:'done'}})
    ];
    const call=(fn,args)=>a.run(fn+'('+J(ITEMS)+','+(args||'')+')');
    const ids=x=>x.map(i=>i.id);

    s.eq('1 overdue, oldest first',J(ids(call('tbOverdue','"u-ammar",'+J(T)))),J(['late1','late2']));
    // Gates first, then events, then tasks: on a day, what cannot move is
    // read before what can.
    s.eq('2 due today, gates first',J(ids(call('tbDueToday','"u-ammar",'+J(T)))),J(['todayGate','todayEvent','today1']));
    s.eq('a done item is on no card',ids(call('tbDueToday','"u-ammar",'+J(T))).indexOf('donesToo'),-1);
    s.eq('3 my day',J(ids(call('tbMyDay','"u-ammar",'+J(T)))),J(['myday']));
    // Cards 1-4 must not double-count: "assigned to me" is what is left.
    const assigned=ids(call('tbAssignedToMe','"u-ammar",'+J(T)));
    s.eq('4 assigned to me is what others expect of me',J(assigned),J(['fromAfnan']));
    s.ok('and nothing shown above appears again',
      ['late1','late2','today1','todayGate','myday'].every(x=>assigned.indexOf(x)<0));
    s.eq('5 needs a date, mine to answer',J(ids(call('tbNeedsDate','"u-ammar"'))),J(['nodate']));
    s.eq('6 next 7 days excludes today and anything further out',
      J(ids(call('tbNext7','"u-ammar",'+J(T)))),J(['soon']));
    s.eq('7 assigned by me — am I waiting on someone',
      J(ids(call('tbAssignedByMe','"u-ammar"'))),J(['iAsked']));
    // Card 8 is the drop's critical path and is NOT filtered by assignee.
    const dl=ids(call('tbDeadlines',J(T)+',14'));
    s.eq('8 deadlines: every gate in 14 days, whoever owns it',J(dl),J(['todayGate','gateSoon']));
    s.ok('a gate beyond the window is not on it',dl.indexOf('gateFar')<0);
    const pinned=ITEMS.concat([it({id:'pin',date:'2026-12-20',own:'u-must',as:['u-must'],extra:{pinned:true}})]);
    s.ok('an owner can pin anything onto it',
      a.run('tbDeadlines('+J(pinned)+','+J(T)+',14)').map(i=>i.id).indexOf('pin')>-1);
    // A private item belongs to nobody else's critical path.
    const priv=[it({id:'p',date:'2026-10-01',extra:{kind:'gate',visibility:'private'}})];
    s.eq('a private gate is on no shared deadline card',a.run('tbDeadlines('+J(priv)+','+J(T)+',14)').length,0);
  }

  s.section('steps, colour, handover and done');
  {
    const a=loadApp({files:FILES});
    const NOW=1790000000000;
    const steps=[{id:'s1',done:true},{id:'s2',done:true},{id:'s3',done:false}];
    const pr=a.run('tbStepProgress({steps:'+J(steps)+'})');
    s.eq('progress reads 2/3',pr.label,'2/3');
    s.eq('and is not finished',pr.allDone,false);
    const all=a.run('tbStepProgress({steps:'+J(steps.map(x=>({id:x.id,done:true})))+'})');
    s.eq('all done is a HINT, not a completion',all.allDone,true);
    s.eq('no steps, no progress label',a.run('tbStepProgress({steps:[]})').label,'');

    // explicit -> list -> first assignee, and never a raw hex.
    const lists=[{id:'l1',color:'moss'}];
    const uc={'u-must':'wine'};
    const ck=(i)=>a.run('tbItemColorKey('+J(i)+','+J(lists)+','+J(uc)+')');
    s.eq('an explicit colour wins',ck({color:'clay',listId:'l1',assigneeUids:['u-must']}),'clay');
    s.eq('then the list',ck({listId:'l1',assigneeUids:['u-must']}),'moss');
    s.eq('then the first assignee',ck({assigneeUids:['u-must']}),'wine');
    s.eq('and there is always an answer',ck({}),'slate');
    s.eq('an invented colour falls back rather than reaching a style attribute',
      ck({color:'#ff0000'}),'slate');

    const item={id:'i1',assigneeUids:['u-afnan'],ownerUid:'u-afnan',locked:true,lockedBy:'u-ammar'};
    const ho=(to,note,keep)=>a.run('tbHandoverPlan('+J(item)+',"u-afnan",'+J(to)+','+J(note)+','+(keep?'true':'false')+','+NOW+')');
    s.ok('a handover with no note is refused',!!ho('u-must','').error);
    s.ok('and says why',/one-line note/.test(ho('u-must','  ').error));
    s.ok('handing to yourself is refused',!!ho('u-afnan','x').error);
    const good=ho('u-must','fabric is with you now');
    s.eq('the recipient joins',good.data.assigneeUids.indexOf('u-must')>-1,true);
    s.eq('and the sender leaves',good.data.assigneeUids.indexOf('u-afnan'),-1);
    s.eq('unless they keep themselves on it',
      ho('u-must','x',true).data.assigneeUids.indexOf('u-afnan')>-1,true);
    s.eq('the note is the notification',good.note,'fabric is with you now');
    s.eq('and a comment records it in the thread',/handed over/.test(good.comment.body),true);
    // A handover changes PEOPLE, not dates, so a lock does not block it.
    s.eq('a locked item can still be handed over',good.data.assigneeUids.length>0,true);

    const open={id:'i2',status:'open',ownerUid:'u-ammar',assigneeUids:['u-must']};
    const d=a.run('tbDonePlan('+J(open)+',"u-must",'+NOW+',"u-afnan")');
    s.eq('done is recorded against whoever did it',d.data.completedByUid,'u-must');
    s.eq('the owner and the list admin hear',J(d.notify),J(['u-ammar','u-afnan']));
    const self=a.run('tbDonePlan('+J(open)+',"u-ammar",'+NOW+',"u-ammar")');
    s.eq('nobody is told about their own',J(self.notify),J([]));
    const reopen=a.run('tbDonePlan({id:"i3",status:"done",ownerUid:"u-ammar"},"u-ammar",'+NOW+')');
    s.eq('reopening clears the record',reopen.data.completedByUid,null);
    s.eq('and is logged as such',reopen.activity.type,'reopened');
  }

  s.section('rendering, and the boundary every title crosses');
  {
    const a=loadApp({files:FILES,currentPage:'tb-dash'});
    a.run('session='+J(AMMAR));
    a.run('tbLists=[{id:"l1",title:"Winter Drop 2027",kind:"shared",adminUid:"u-ammar",memberUids:["u-ammar"],color:"moss"}]');
    a.run('tbConfig={markers:[{label:"launch",date:"2026-10-30"}]}');
    a.run('tbLoaded=true');

    // THE STORED-XSS BOUNDARY. A title is typed by one person and drawn
    // into everyone else's browser; it must never be interpolated.
    const nasty='<img src=x onerror=alert(1)>';
    a.run('tbItems=[tbDecodeItem({id:"i1",title:'+J(nasty)+',status:"open",kind:"task",'
      +'visibility:"shared",ownerUid:"u-ammar",assigneeUids:["u-ammar"],date:"2026-09-24"})]');
    const row=a.run('_tbRow(tbItems[0],"2026-09-24")');
    s.ok('a title never reaches the markup',row.indexOf(nasty)===-1&&row.indexOf('<img')===-1);
    s.ok('it goes to the hydrate queue as TEXT instead',
      a.run('_tbHydrateQueue.some(q=>q.text==='+J(nasty)+')'));
    s.ok('and the slot it lands in is empty',/id="tbh\d+" class="tb-rowtitle"><\/span>/.test(row));

    // The row anatomy (spec s7.1).
    a.run('_tbHydrateQueue=[]');
    a.run('tbItems=[tbDecodeItem({id:"g1",title:"all assets in",status:"open",kind:"gate",'
      +'locked:true,lockedBy:"u-ammar",visibility:"shared",ownerUid:"u-ammar",'
      +'assigneeUids:["u-ammar","u-afnan"],date:"2026-10-25",commentCount:3,'
      +'steps:[{id:"a",done:true},{id:"b",done:false}]})]');
    const g=a.run('_tbRow(tbItems[0],"2026-09-24")');
    s.ok('there is a checkbox that completes without opening',/tb-check[\s\S]*tbToggleDone/.test(g));
    s.ok('and it stops the click reaching the row',/event\.stopPropagation\(\);window\.tbToggleDone/.test(g));
    s.ok('a colour dot',/tb-dot tb-c-[a-z]+/.test(g));
    s.ok('a lock glyph when locked',/tb-lock/.test(g));
    s.ok('step progress',/tb-steps">1\/2</.test(g));
    s.ok('a comment count',/tb-cc">3</.test(g));
    s.ok('the date',/tb-date">oct 25</.test(g));
    s.ok('a gate says so',/tb-kind-gate/.test(g));
    // Your own face on your own list is noise; only OTHERS get an avatar.
    s.eq('one avatar, not two',(g.match(/class="tb-av"/g)||[]).length,1);

    // Cards with nothing to show are HIDDEN, not rendered empty.
    a.run('tbItems=[]');
    const bare=a.run('_tbDashboard()');
    s.ok('an empty board says so in one sentence',/nothing on the board today/.test(bare));
    // Session 2 (brief s4): Team today lists all five from day one, so the
    // ONLY card an empty board carries is that one -- none of mine.
    s.eq('and shows no empty cards of mine — only Team today',
      (bare.match(/class="tb-cardh">([^<]*)/g)||[]).map(x=>x.replace(/.*>/,'')).join('|'),'team today');
    s.ok('the quick-add is still there',/id="tb-qa"/.test(bare));
    s.ok('and the countdown',/day[s]? to launch/.test(bare));

    // A REFUSED READ AND AN EMPTY BOARD MUST NEVER LOOK THE SAME.
    a.run('_tbLoadErrors=["board_items"]');
    const err=a.run('_tbDashboard()');
    s.ok('a failed read renders an error, not an empty board',/Could not read the board/.test(err));
    s.ok('with a retry',/tbRetry/.test(err));
    s.ok('and names the likely cause',/firestore\.rules/.test(err));
    s.ok('it does NOT claim the board is empty',!/nothing on the board today/.test(err));
    a.run('_tbLoadErrors=["board_config"]');
    s.ok('a partial failure warns but still renders',/tb-warn/.test(a.run('_tbDashboard()')));
    a.run('_tbLoadErrors=[]');
  }

  s.section('the drawer');
  {
    const a=loadApp({files:FILES,currentPage:'tb-dash'});
    // Daniyal, NOT Ammar: Ammar is a board owner and can override any
    // lock, so he is the wrong person to prove a lock holds.
    a.run('session='+J(DANIYAL));
    a.run('tbLists=[];tbConfig=null;tbLoaded=true');
    a.run('tbItems=[tbDecodeItem({id:"i1",title:"pricing tiers",status:"open",kind:"gate",'
      +'locked:true,lockedBy:"u-afnan",visibility:"shared",ownerUid:"u-afnan",'
      +'assigneeUids:["u-dani"],date:"2026-10-18",datePlanned:"2026-10-17",notes:"n"})]');
    a.run('_tbOpenItemId="i1"');
    const d=a.run('_tbDrawer()');
    s.ok('the date input is DISABLED for someone who cannot move it',/id="tb-d-date"[^>]*disabled/.test(d));
    s.ok('and it says who holds the lock',/locked by/.test(d));
    s.ok('the lock button is disabled too',/tb-lockbtn[^>]*disabled/.test(d));
    // "was Oct 17" — the whole point of datePlanned never changing.
    s.ok('a moved date shows what it was',/tb-was">was oct 17</.test(d));
    s.ok('steps, notes and the footer are all there',
      /tb-step-new/.test(d)&&/tb-d-notes/.test(d)&&/add to my day/.test(d)&&/hand over/.test(d));
    s.ok('delete is offered to the owner only',!/tbDeleteItem/.test(d));
    s.eq('and a board owner is not fooled by any of that',
      a.run('tbCanMoveDate(tbItems[0],"u-ammar",true)'),true);

    // Now as the locker, who is also the owner.
    a.run('session='+J(Object.assign({},AMMAR,{uid:'u-afnan',u:'afnan'})));
    const d2=a.run('_tbDrawer()');
    s.ok('the locker can move the date',!/id="tb-d-date"[^>]*disabled/.test(d2));
    s.ok('and delete it, being the owner',/tbDeleteItem/.test(d2));

    // All steps done is a HINT, never an auto-complete.
    a.run('tbItems[0].steps=[{id:"a",title:"x",done:true}]');
    s.ok('all steps done offers a hint, not a completion',
      /all steps done/.test(a.run('_tbDrawer()')));
    s.eq('and the item is still open',a.run('tbItems[0].status'),'open');
  }

  s.section('writing — the item and its log land together');
  {
    const mkApp=()=>{
      const a=loadApp({files:FILES,currentPage:'tb-dash'});
      a.run('session='+J(AMMAR));
      a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"},'
        +'{uid:"u-afnan",username:"afnan",displayName:"Afnan"},'
        +'{uid:"u-must",username:"mustafa",displayName:"Mustafa"}]');
      a.run('tbLists=[];tbConfig=null;tbLoaded=true;tbItems=[]');
      return a;
    };
    const a=mkApp();
    await a.run('window.tbCreateFromQuick("denim samples @afnan #denim oct 5 !",false)');
    const w=a.state.writes;
    s.eq('a create writes exactly two documents',w.length,2);
    // Counting the WRITES proves nothing here — splitting the log out
    // into its own setDoc still totals two. What matters is that both
    // land in the SAME batch, so a log row cannot outlive a failed item
    // write. Verified by splitting them: this is the assertion that fails.
    s.eq('exactly one batch',a.state.batches.length,1);
    s.eq('and BOTH documents are in it',a.state.batches[0].length,2);
    const item=w.filter(x=>x.data&&x.data.title)[0];
    s.eq('the item carries the parsed title',item.data.title,'denim samples');
    s.eq('the lane',item.data.lane,'denim');
    s.eq('the date',item.data.date,'2026-10-05');
    s.eq('the priority',item.data.priority,1);
    s.ok('the creator is on it alongside the person named',
      item.data.assigneeUids.indexOf('u-ammar')>-1&&item.data.assigneeUids.indexOf('u-afnan')>-1);
    s.eq('a second assignee makes it shared',item.data.visibility,'shared');
    s.ok('and the other document is the created log row',
      w.some(x=>x.data&&x.data.type==='created'));
    s.eq('the board holds it immediately, so the repaint is instant',a.run('tbItems.length'),1);

    // Done: the notify goes to the owner, not to whoever pressed it.
    const b=mkApp();
    b.run('tbItems=[tbDecodeItem({id:"i1",title:"x",status:"open",ownerUid:"u-afnan",assigneeUids:["u-ammar"]})]');
    await b.run('window.tbToggleDone("i1")');
    s.eq('done is recorded',b.run('tbItems[0].status'),'done');
    s.ok('the owner is told',b.state.writes.some(x=>x.data&&x.data.forUser==='afnan'));
    s.ok('and the notification is tagged for the board inbox',
      b.state.writes.some(x=>x.data&&x.data.source==='tb'));
    const notif=b.state.writes.filter(x=>x.data&&x.data.source==='tb')[0];
    s.ok('its message is escaped, because the bell renders it raw',
      notif&&notif.data.message.indexOf('<')===-1);

    // A lock someone else holds is refused OUT LOUD, not silently.
    const c=catchToasts(mkApp());
    c.run('session='+J(DANIYAL));            // a member, not a board owner
    c.run('tbItems=[tbDecodeItem({id:"i1",title:"x",status:"open",locked:true,lockedBy:"u-afnan",'
      +'ownerUid:"u-afnan",assigneeUids:["u-dani"]})]');
    await c.run('window.tbToggleLock("i1")');
    s.eq('no write is attempted',c.state.writes.length,0);
    s.ok('and the person is told who holds it',toastsOf(c).some(t=>/Afnan/.test(t)));
    // A board owner CAN, and the rules log it as an override.
    const c2=mkApp();
    c2.run('tbItems=[tbDecodeItem({id:"i1",title:"x",status:"open",locked:true,lockedBy:"u-afnan",'
      +'ownerUid:"u-afnan",assigneeUids:["u-ammar"]})]');
    await c2.run('window.tbToggleLock("i1")');
    s.ok('a board owner can override it',c2.state.writes.length>0);

    // My day is a toggle, and it is PER PERSON.
    const e=mkApp();
    e.run('tbItems=[tbDecodeItem({id:"i1",title:"x",status:"open",ownerUid:"u-ammar",assigneeUids:["u-ammar"]})]');
    await e.run('window.tbAddToMyDay("i1")');
    s.eq('it lands under my uid only',J(Object.keys(e.run('tbItems[0].myDay'))),J(['u-ammar']));
    await e.run('window.tbAddToMyDay("i1")');
    s.eq('and pressing again takes it off',J(Object.keys(e.run('tbItems[0].myDay'))),J([]));

    // A refused write SAYS so and re-reads rather than guessing.
    const f=catchToasts(loadApp({files:FILES,currentPage:'tb-dash',
      globals:{writeBatch:()=>({update(){},set(){},commit(){return Promise.reject(new Error('Missing or insufficient permissions'));}})}}));
    f.run('session='+J(AMMAR));
    f.run('userProfiles=[];tbLists=[];tbLoaded=true');
    f.run('tbItems=[tbDecodeItem({id:"i1",title:"x",status:"open",ownerUid:"u-ammar",assigneeUids:["u-ammar"]})]');
    await f.run('window.tbToggleDone("i1")');
    s.ok('a refused write names the likely cause',
      toastsOf(f).some(t=>/firestore\.rules/.test(t)));
    s.ok('and does NOT leave the row looking done',f.run('tbItems.length===0||tbItems[0].status')!=='done');
  }

  s.section('lists');
  {
    const a=loadApp({files:FILES,currentPage:'tb-lists'});
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"}]');
    a.run('tbLoaded=true;tbConfig=null');
    a.run('tbLists=[{id:"l1",title:"Winter Drop 2027",kind:"shared",adminUid:"u-ammar",memberUids:["u-ammar"],color:"moss"},'
      +'{id:"l2",title:"my errands",kind:"private",adminUid:"u-ammar",memberUids:["u-ammar"],color:"slate"}]');
    a.run('tbItems=[tbDecodeItem({id:"i1",title:"x",listId:"l1",status:"open",ownerUid:"u-ammar",assigneeUids:["u-ammar"]}),'
      +'tbDecodeItem({id:"i2",title:"y",listId:"l1",status:"done",ownerUid:"u-ammar",assigneeUids:["u-ammar"]})]');
    const scr=a.run('_tbListsScreen()');
    // Two always-visible sections, never a tab switcher — a tab hides half
    // of what you own behind a click (the rule Notes already follows).
    s.ok('team and private are both on screen at once',/team/.test(scr)&&/private/.test(scr));
    s.ok('each with its own new button',(scr.match(/tbNewList/g)||[]).length===2);
    s.ok('and an open count that excludes done',/tb-listn">1</.test(scr));

    a.run('_tbListId="l1"');
    const det=a.run('_tbListsScreen()');
    s.ok('the detail splits open from done',/open/.test(det)&&/done/.test(det));
    s.ok('back goes one level, to lists',/tbCloseList/.test(det));
    s.ok('it says whether the list is team or private',/tb-badge">team</.test(det));
    s.ok('and that I administer it',/tb-badge">admin</.test(det));
    // An empty list must still say so rather than rendering nothing.
    a.run('tbItems=[]');
    s.ok('an empty list is explained, not blank',/nothing open in this list/.test(a.run('_tbListsScreen()')));
  }

  s.section('the seed is safe to re-run');
  {
    const seed=require('../scripts/seed-board.js');
    s.eq('every milestone in the spec is here',seed.ITEMS.length,42);
    s.eq('five people at launch',seed.MEMBERS.length,5);
    s.eq('and the two markers the calendar draws',J(seed.MARKERS.map(m=>m.label)),J(['launch','founders out']));

    // IDEMPOTENCY IS BY DETERMINISTIC ID, not by "does a row with this
    // title exist" — so a re-run addresses the same documents and a
    // merge updates them in place instead of duplicating them.
    const ids=seed.ITEMS.map(r=>seed.seedId(r[1],r[2]));
    s.eq('no two milestones collide on an id',new Set(ids).size,ids.length);
    s.ok('every id is safe as a document path',ids.every(i=>/^[A-Za-z0-9_-]+$/.test(i)));
    s.ok('and stable across runs',seed.seedId('edits','ALL ASSETS IN — including website UI assets')
      ===seed.seedId('edits','ALL ASSETS IN — including website UI assets'));
    s.eq('derived from lane and title',seed.seedId('walika','Shade list locked'),'tb_walika_shade-list-locked');

    // A RE-RUN MUST NOT UNDO REAL WORK. Anything someone has changed since
    // the first run is written once, on create, and never touched again.
    ['date','status','steps','notes','myDay','assigneeUids','locked','dateHistory']
      .forEach(f=>s.ok('a re-run leaves '+f+' alone',seed.KEEP_FIELDS.indexOf(f)>-1));

    // The two undated gates are deliberate: they land in Ammar's and
    // Afnan's "needs a date" card on day one.
    const undated=seed.ITEMS.filter(r=>r[0]===null);
    s.eq('two milestones start with no date, on purpose',undated.length,2);
    s.ok('and both are gates someone has to schedule',undated.every(r=>r[4]==='gate'));
    // Every locked row is a gate or an event — a plain task nobody can
    // reschedule would just be an obstacle.
    s.ok('nothing locked is a mere task',seed.ITEMS.filter(r=>r[5]).every(r=>r[4]!=='task'));
    s.ok('every assignee is a board member',
      seed.ITEMS.every(r=>r[3].every(h=>seed.MEMBERS.indexOf(h)>-1)));
    s.ok('every lane is one the app offers',(()=>{
      const a=loadApp({files:FILES});
      const lanes=a.run('TB_LANES');
      return seed.ITEMS.every(r=>lanes.indexOf(r[1])>-1);
    })());
    s.ok('it never runs on require, only when executed',
      /require\.main!==module/.test(read('scripts/seed-board.js')));
    // Firestore caps a batch at 500 writes; 42 items plus a list and the
    // config fit in one, but the loop has to hold if the list grows.
    // Session 2: the body moved to scripts/board-seed-plan.js, shared
    // with the Run seed button's Netlify function.
    const src=read('scripts/board-seed-plan.js');
    const chunk=Number((/i\+=(\d+)\)\s*\{[\s\S]{0,40}?db\.batch/.exec(src)||[])[1]||0);
    s.ok('it writes in batches within the Firestore limit',chunk>0&&chunk<=500,chunk);
    // REVERSED in session 2 (Ammar's decision 2): the script WRITES by
    // default and --dry-run previews. A dry-run default is one of the ways
    // the board went live with nothing on it.
    const cli=read('scripts/seed-board.js');
    s.ok('the script writes by default; --dry-run previews',
      /'--dry-run'/.test(cli)&&!/'--write'/.test(cli));
  }

  // ══ PHASE 3 — THE CALENDAR ══════════════════════════════════════════

  s.section('the grid');
  {
    const a=loadApp({files:FILES});
    // The week starts MONDAY: Pakistan's weekend is Sat/Sun, so a
    // Sunday-first grid splits the working week across two rows.
    s.eq('the week starts on Monday',a.run('TB_WEEK_START'),1);
    s.eq('and the day labels say so',a.run('TB_DOW_LABELS[0]'),'mon');
    // 2026-10-30 (launch) is a Friday.
    s.eq('a Friday resolves to its Monday',a.run("tbWeekStart('2026-10-30')"),'2026-10-26');
    s.eq('a Monday is its own week start',a.run("tbWeekStart('2026-10-26')"),'2026-10-26');
    s.eq('a Sunday belongs to the week BEFORE it',a.run("tbWeekStart('2026-11-01')"),'2026-10-26');
    const wk=a.run("tbWeekDays('2026-10-30')");
    s.eq('a week is seven days',wk.length,7);
    s.eq('Monday first',wk[0],'2026-10-26');
    s.eq('Sunday last',wk[6],'2026-11-01');
    s.eq('and it reads as a range',a.run("tbWeekLabel('2026-10-30')"),'26 oct – 1 nov');

    const oct=a.run("tbMonthGrid('2026-10')");
    s.eq('October 2026 needs five rows',oct.length,5);
    s.eq('each of seven days',oct[0].length,7);
    s.eq('it opens on the Monday before the 1st',oct[0][0].day,'2026-09-28');
    s.ok('which is marked as spill, not October',oct[0][0].inMonth===false);
    s.ok('the 1st is in the month',oct[0].some(c=>c.day==='2026-10-01'&&c.inMonth));
    s.eq('and it closes past the 31st',oct[4][6].day,'2026-11-01');
    s.ok('every day in the run is consecutive',(()=>{
      const flat=oct.reduce((x,w)=>x.concat(w.map(c=>c.day)),[]);
      return flat.every((d,i)=>i===0||d===a.run('_tbDayAdd('+J(flat[i-1])+',1)'));
    })());
    // A month that needs six rows must get six, rather than a fixed grid
    // clipping its last days.
    s.eq('a month that spills needs six',a.run("tbMonthGrid('2026-08').length"),6);
    s.eq('February 2027 starts on a Monday and fits four',a.run("tbMonthGrid('2027-02').length"),4);
    s.eq('junk in, nothing out',J(a.run("tbMonthGrid('nonsense')")),J([]));
    s.eq('the month reads as a name',a.run("tbMonthLabel('2026-10')"),'october 2026');
  }

  s.section('what the calendar shows');
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(AMMAR));
    a.run('tbLists=[{id:"l1",title:"Winter Drop 2027",kind:"shared",adminUid:"u-ammar",memberUids:["u-ammar"],color:"moss"}]');
    a.run('userProfiles=[]');
    const it=o=>Object.assign({id:o.id,title:o.id,status:'open',kind:o.kind||'task',
      visibility:o.vis||'shared',ownerUid:o.own||'u-ammar',assigneeUids:o.as||['u-ammar'],
      date:o.date,listId:o.list||null,lane:o.lane||null,steps:[],myDay:{},dateHistory:[]},{});
    const ITEMS=[
      it({id:'mine',date:'2026-10-05',lane:'denim',list:'l1'}),
      it({id:'theirs',date:'2026-10-05',as:['u-must'],own:'u-must'}),
      it({id:'gate',date:'2026-10-05',kind:'gate'}),
      it({id:'event',date:'2026-10-05',kind:'event'}),
      it({id:'donesToo',date:'2026-10-05',as:['u-ammar']}),
      it({id:'priv',date:'2026-10-06',vis:'private',as:['u-must'],own:'u-must'}),
      it({id:'undated',date:null})
    ];
    ITEMS[4].status='done';
    a.run('tbItems='+J(ITEMS));
    const f=o=>a.run('tbCalFilter(tbItems,'+J(Object.assign({uid:'u-ammar'},o))+')').map(i=>i.id);

    s.eq('an undated item is not on the calendar',f({scope:'me'}).indexOf('undated'),-1);
    // "me" is what I am ON, not what I own — something I set for someone
    // else is not my week.
    s.eq('me: only what I am on',J(f({scope:'me'})),J(['mine','gate','event','donesToo']));
    s.ok('everyone: the shared ones too',f({scope:'all'}).indexOf('theirs')>-1);
    // Everyone's calendar must still not show a private item that is not
    // mine — the rules would refuse it anyway, but the UI must agree.
    s.eq('but never someone else’s PRIVATE item',f({scope:'all'}).indexOf('priv'),-1);
    s.eq('hide done takes the done one out',f({scope:'me',hideDone:true}).indexOf('donesToo'),-1);
    s.eq('by person',J(f({scope:'all',person:'u-must'})),J(['theirs']));
    s.eq('by list',J(f({scope:'me',list:'l1'})),J(['mine']));
    s.eq('by lane',J(f({scope:'me',lane:'denim'})),J(['mine']));
    s.eq('filters combine',J(f({scope:'me',lane:'denim',list:'l1'})),J(['mine']));
    s.eq('a filter matching nothing shows nothing',f({scope:'me',lane:'leather'}).length,0);

    const byDay=a.run('tbItemsByDay(tbCalFilter(tbItems,'+J({uid:'u-ammar',scope:'me'})+'))');
    s.eq('one bucket per day',Object.keys(byDay).length,1);
    // Gates first, then events, then tasks — the Dashboard's rule, and the
    // same comparator, so the two can never disagree.
    s.eq('gates lead the day',J(byDay['2026-10-05'].map(i=>i.id)),J(['gate','event','mine','donesToo']));

    const marks=a.run('tbMarkersByDay({markers:[{label:"launch",date:"2026-10-30"},{label:"founders out",date:"2026-11-01"}]})');
    s.eq('the launch marker lands on its day',J(marks['2026-10-30']),J(['launch']));
    s.eq('two markers on one day both show',
      J(a.run('tbMarkersByDay({markers:[{label:"a",date:"2026-10-30"},{label:"b",date:"2026-10-30"}]})')['2026-10-30']),J(['a','b']));
    s.eq('no config, no markers',J(Object.keys(a.run('tbMarkersByDay(null)'))),J([]));
  }

  s.section('a move — the lock is the whole product');
  {
    const a=loadApp({files:FILES});
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"},'
      +'{uid:"u-afnan",username:"afnan",displayName:"Afnan"},'
      +'{uid:"u-dani",username:"daniyal",displayName:"Daniyal"}]');
    a.run('tbLists=[]');
    const NOW=1790000000000;
    const GATE=J({id:'g1',title:'ALL ASSETS IN',date:'2026-10-25',datePlanned:'2026-10-25',
      kind:'gate',locked:true,lockedBy:'u-ammar',ownerUid:'u-ammar',
      assigneeUids:['u-ammar','u-dani'],status:'open',visibility:'shared',dateHistory:[],steps:[]});
    const plan=(uid,owner,to)=>a.run('tbMovePlan('+GATE+','+J(to)+','+J(uid)+','+(owner?'true':'false')+','+NOW+')');

    // Afnan is a board OWNER in this app, so Daniyal is the right person
    // to prove a lock actually holds.
    const refused=plan('u-dani',false,'2026-10-28');
    s.ok('a member cannot move a locked gate',refused.refused===true);
    s.ok('and is told who holds it',/locked by Ammar/.test(refused.reason));
    s.eq('no patch is produced at all',refused.data,undefined);

    const byLocker=plan('u-ammar',false,'2026-10-28');
    s.ok('the locker can',!byLocker.refused);
    s.eq('the new date is written',byLocker.data.date,'2026-10-28');
    s.eq('datePlanned never moves — it is what "was Oct 25" is drawn from',byLocker.data.datePlanned,undefined);
    s.eq('the move is in the history',byLocker.data.dateHistory.length,1);
    s.eq('with where it came from',byLocker.data.dateHistory[0].from,'2026-10-25');
    s.eq('and who moved it',byLocker.data.dateHistory[0].byUid,'u-ammar');
    s.eq('logged as a move',byLocker.activity[0].type,'moved');
    s.ok('the locker’s own move is NOT an override',!byLocker.override);
    // Everyone else on the item hears — a date somebody else moved is the
    // definition of something you need to know.
    s.eq('the other assignee is told',J(byLocker.notify),J(['u-dani']));
    s.ok('and the mover is not told about their own',byLocker.notify.indexOf('u-ammar')<0);

    const override=plan('u-afnan',true,'2026-10-28');
    s.ok('a board owner can move anyone’s locked gate',!override.refused);
    s.ok('and it is recorded as an override',override.override===true);
    s.ok('in the activity payload, not only in a toast',override.activity[0].payload.override===true);
    s.eq('both assignees are told',J(override.notify.sort()),J(['u-ammar','u-dani']));

    s.ok('dropping an item on its own day does nothing',plan('u-ammar',false,'2026-10-25').noop===true);
    s.ok('and says nothing about it',plan('u-ammar',false,'2026-10-25').reason==='');
    s.ok('a date that is not a date is refused',plan('u-ammar',true,'not-a-day').refused===true);

    // An UNLOCKED item is anyone's to move, which is the normal case.
    const open=J({id:'i2',title:'x',date:'2026-10-05',datePlanned:'2026-10-05',
      ownerUid:'u-ammar',assigneeUids:['u-ammar'],status:'open',visibility:'shared',dateHistory:[],steps:[]});
    s.ok('an unlocked item moves for a member',
      !a.run('tbMovePlan('+open+',"2026-10-06","u-dani",false,'+NOW+')').refused);

    s.eq('the keyboard nudges a day',a.run('tbNudgeTarget({date:"2026-10-25"},1)'),'2026-10-26');
    s.eq('and a week',a.run('tbNudgeTarget({date:"2026-10-25"},7)'),'2026-11-01');
    s.eq('backwards too',a.run('tbNudgeTarget({date:"2026-10-25"},-1)'),'2026-10-24');
    s.eq('an undated item has nowhere to nudge to',a.run('tbNudgeTarget({date:null},1)'),'');
  }

  s.section('the pill');
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(DANIYAL));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"}]');
    a.run('tbLists=[];_tbHydrateQueue=[]');
    const mk=o=>a.run('_tbPill('+J(o)+',"2026-09-25")');
    const nasty='<img src=x onerror=alert(1)>';
    const p=mk({id:'i1',title:nasty,kind:'task',status:'open',assigneeUids:['u-dani'],ownerUid:'u-dani'});
    s.ok('a title never reaches the markup',p.indexOf(nasty)===-1&&p.indexOf('<img')===-1);
    s.ok('it is hydrated as text',a.run('_tbHydrateQueue.some(q=>q.text==='+J(nasty)+')'));

    const g=mk({id:'g1',title:'gate',kind:'gate',status:'open',locked:true,lockedBy:'u-ammar',
      assigneeUids:['u-dani'],ownerUid:'u-ammar'});
    s.ok('a gate is solid',/tb-pill[^"]*\bgate\b/.test(g));
    s.ok('a locked pill shows its padlock',/tb-pilllock/.test(g));
    // A pill somebody cannot move offers no drag affordance AT ALL — the
    // refusal is visible before the pointer goes down, not after.
    s.ok('and carries no drag handler for someone who cannot move it',!/onpointerdown/.test(g));
    s.ok('nor the draggable class',!/\bdraggable\b/.test(g));
    s.ok('but it is still clickable, so the drawer is reachable',/tbPillClick/.test(g));

    const mine=mk({id:'i2',title:'x',kind:'task',status:'open',assigneeUids:['u-dani'],ownerUid:'u-dani'});
    s.ok('an item I can move does carry the drag handler',/onpointerdown="window.tbPillDown/.test(mine));
    s.ok('and says so in its class',/\bdraggable\b/.test(mine));
    s.ok('it is keyboard reachable',/tabindex="0"/.test(mine)&&/tbPillKey/.test(mine));
    const done=mk({id:'i3',title:'x',kind:'task',status:'done',assigneeUids:['u-dani'],ownerUid:'u-dani'});
    s.ok('a done pill just fades',/\bdone\b/.test(done));
  }

  s.section('the drag, driven');
  {
    // DRIVEN, not grepped: the whole gesture lives in that handler's
    // closure, so asserting the helpers would prove only the helpers.
    // _tbDayFromPoint is the ONE part that needs a laid-out page; it is
    // replaced and everything else — the threshold, the lazy capture, the
    // document tracking, the drop, the write — runs for real.
    const mkApp=()=>{
      const a=catchToasts(loadApp({files:FILES,currentPage:'tb-calendar'}));
      a.run('session='+J(AMMAR));
      a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"},'
        +'{uid:"u-dani",username:"daniyal",displayName:"Daniyal"}]');
      a.run('tbLists=[];tbConfig=null;tbLoaded=true;_tbLoadErrors=[]');
      a.run('tbItems=[tbDecodeItem({id:"i1",title:"pricing tiers",date:"2026-10-17",'
        +'datePlanned:"2026-10-17",status:"open",ownerUid:"u-ammar",'
        +'assigneeUids:["u-ammar","u-dani"],visibility:"shared"})]');
      a.run('globalThis.__drop="2026-10-19";_tbDayFromPoint=function(){return __drop;};'
        +'globalThis.__captured=0;'
        +'globalThis.__el={classList:{add(){},remove(){}},setPointerCapture(){__captured++;}};');
      return a;
    };
    // The harness records document listeners as bare functions, so they
    // can be called straight from here.
    const fireDoc=(a,type,ev)=>{
      const e=Object.assign({type:type,pointerId:1,clientX:0,clientY:0,
        preventDefault(){},stopPropagation(){}},ev||{});
      ((a.state.listeners&&a.state.listeners[type])||[]).slice().forEach(fn=>fn(e));
      return e;
    };
    const press=(a,x,y)=>a.run('window.tbPillDown({button:0,pointerId:1,clientX:'+x+',clientY:'+y
      +',currentTarget:__el,preventDefault(){},stopPropagation(){}},"i1")');
    const settle=()=>new Promise(r=>setTimeout(r,0));

    // ── a press that never moves is a CLICK, not a drag ──
    const tap=mkApp();
    press(tap,10,10);
    fireDoc(tap,'pointermove',{clientX:11,clientY:11});    // inside the 4px threshold
    fireDoc(tap,'pointerup',{clientX:11,clientY:11});
    s.eq('a press that barely moves captures nothing',tap.run('__captured'),0);
    s.eq('and writes nothing',tap.state.writes.length,0);
    s.eq('the date is untouched',tap.run('tbItems[0].date'),'2026-10-17');
    // AN EAGER setPointerCapture RETARGETS THE FOLLOWING CLICK to the
    // capturing element — the bug js/boards.js found five times under five
    // names. Deferring it past the threshold is what leaves the click alone.
    tap.run('window.tbPillClick({preventDefault(){}},"i1")');
    s.eq('so the click still opens the drawer',tap.run('_tbOpenItemId'),'i1');

    // ── a real drag ──
    const drag=mkApp();
    press(drag,10,10);
    fireDoc(drag,'pointermove',{clientX:60,clientY:40});   // past the threshold
    s.eq('the pointer is captured only once the gesture is a drag',drag.run('__captured'),1);
    fireDoc(drag,'pointermove',{clientX:120,clientY:80});
    s.eq('and not captured again on every move',drag.run('__captured'),1);
    fireDoc(drag,'pointerup',{clientX:120,clientY:80});
    await settle();
    s.eq('the item lands on the day it was dropped on',drag.run('tbItems[0].date'),'2026-10-19');
    s.eq('one batch carries the item and its log',drag.state.batches.length,1);
    s.eq('with both documents in it',drag.state.batches[0].length,2);
    const moved=drag.state.writes.filter(w=>w.data&&w.data.dateHistory)[0];
    s.ok('the move is recorded in the history',!!moved);
    s.eq('from where it was',moved&&moved.data.dateHistory[0].from,'2026-10-17');
    s.ok('and logged as a move',drag.state.writes.some(w=>w.data&&w.data.type==='moved'));
    // The other assignee is told; the mover is not told about their own.
    s.ok('the other assignee is notified',drag.state.writes.some(w=>w.data&&w.data.forUser==='daniyal'));
    s.ok('and the mover is not',!drag.state.writes.some(w=>w.data&&w.data.forUser==='ammar'));
    // A drag ends with a click on whatever is under the pointer. Swallow
    // it, or every move would also open the drawer.
    drag.run('window.tbPillClick({preventDefault(){}},"i1")');
    s.eq('the click that ends a drag does NOT open the drawer',drag.run('_tbOpenItemId'),null);

    // ── dropped on nothing ──
    const miss=mkApp();
    miss.run('__drop=""');
    press(miss,10,10);
    fireDoc(miss,'pointermove',{clientX:60,clientY:40});
    fireDoc(miss,'pointerup',{clientX:60,clientY:40});
    await settle();
    s.eq('a drop outside any day changes nothing',miss.run('tbItems[0].date'),'2026-10-17');
    s.eq('and writes nothing',miss.state.writes.length,0);

    // ── a locked item, by someone who is not the locker ──
    const lock=catchToasts(loadApp({files:FILES,currentPage:'tb-calendar'}));
    lock.run('session='+J(DANIYAL));
    lock.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"}];tbLists=[];tbLoaded=true');
    lock.run('tbItems=[tbDecodeItem({id:"g1",title:"ALL ASSETS IN",date:"2026-10-25",kind:"gate",'
      +'locked:true,lockedBy:"u-ammar",ownerUid:"u-ammar",assigneeUids:["u-dani"],visibility:"shared"})]');
    lock.run('globalThis.__captured=0;'
      +'globalThis.__el={classList:{add(){},remove(){}},setPointerCapture(){__captured++;}};'
      +'_tbDayFromPoint=function(){return "2026-10-28";};');
    lock.run('window.tbPillDown({button:0,pointerId:1,clientX:10,clientY:10,currentTarget:__el,'
      +'preventDefault(){},stopPropagation(){}},"g1")');
    fireDoc(lock,'pointermove',{clientX:90,clientY:60});
    fireDoc(lock,'pointerup',{clientX:90,clientY:60});
    await settle();
    s.eq('the drag never starts',lock.run('__captured'),0);
    s.eq('the date is untouched',lock.run('tbItems[0].date'),'2026-10-25');
    s.eq('nothing is written',lock.state.writes.length,0);
    s.ok('and the refusal names who holds the lock',toastsOf(lock).some(t=>/locked by Ammar/.test(t)));

    // ── the keyboard route reaches the same decision ──
    const kb=mkApp();
    kb.run('window.tbPillKey({key:"]",preventDefault(){}},"i1")');
    await settle();
    s.eq('] moves it a day',kb.run('tbItems[0].date'),'2026-10-18');
    kb.run('window.tbPillKey({key:"ArrowRight",shiftKey:true,preventDefault(){}},"i1")');
    await settle();
    s.eq('shift+right moves it a week',kb.run('tbItems[0].date'),'2026-10-25');

    const kbLock=catchToasts(loadApp({files:FILES,currentPage:'tb-calendar'}));
    kbLock.run('session='+J(DANIYAL));
    kbLock.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"}];tbLists=[];tbLoaded=true');
    kbLock.run('tbItems=[tbDecodeItem({id:"g1",title:"g",date:"2026-10-25",locked:true,'
      +'lockedBy:"u-ammar",ownerUid:"u-ammar",assigneeUids:["u-dani"],visibility:"shared"})]');
    kbLock.run('window.tbPillKey({key:"]",preventDefault(){}},"g1")');
    await settle();
    s.eq('and the keyboard cannot walk around a lock either',kbLock.run('tbItems[0].date'),'2026-10-25');
    s.ok('saying the same thing',toastsOf(kbLock).some(t=>/locked by Ammar/.test(t)));
  }

  s.section('the calendar screen');
  {
    const a=loadApp({files:FILES,currentPage:'tb-calendar'});
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"}]');
    a.run('tbLists=[];tbLoaded=true;_tbLoadErrors=[]');
    a.run('tbConfig={markers:[{label:"launch",date:"2026-10-30"}]}');
    a.run('tbItems=[tbDecodeItem({id:"i1",title:"x",date:"2026-10-30",status:"open",'
      +'ownerUid:"u-ammar",assigneeUids:["u-ammar"],visibility:"shared"})]');
    a.run('_tbCalAnchor="2026-10-15";_tbCalView="month"');
    const m=a.run('_tbCalendar()');
    s.ok('the month grid renders',/tb-monthgrid/.test(m));
    s.ok('with a weekday header starting Monday',/tb-dow">mon</.test(m));
    s.ok('every day is a drop target',/data-day="2026-10-30"/.test(m));
    s.ok('the marker is drawn on its day',/tb-daymark">launch</.test(m));
    s.ok('and its day is flagged',/class="tb-day[^"]*marked/.test(m));
    s.ok('a day offers a way to add on it',/tbCalAdd\('2026-10-30'\)/.test(m));
    s.ok('the view says what it is showing',/1 item shown/.test(m));
    a.run('_tbCalView="week"');
    const w=a.run('_tbCalendar()');
    s.ok('the week grid renders',/tb-weekgrid/.test(w));
    // NOT /class="tb-day/ — tb-dayhead, tb-daynum, tb-daymark, tb-dayadd
    // and tb-daylist all start with it, which counted 35 for 7 cells.
    s.eq('and only seven days',(w.match(/class="tb-day[ "]/g)||[]).length,7);
    // A refused read and an empty calendar must never look the same.
    a.run('_tbLoadErrors=["board_items"]');
    const err=a.run('_tbCalendar()');
    s.ok('a failed read renders an error',/Could not read the board/.test(err));
    s.ok('not an empty month',!/tb-monthgrid/.test(err));
    a.run('_tbLoadErrors=[]');
    // The view preference is per VIEWER, never on the board.
    a.run('_tbCalView="week";_tbCalFilters.lane="denim";_tbCalSavePrefs()');
    s.eq('preferences never reach Firestore',a.state.writes.length,0);
    // Stepping is by the unit you are looking at.
    a.run('_tbCalView="month";_tbCalAnchor="2026-10-15";window.tbCalStep(1)');
    s.eq('month view steps a month',a.run('_tbCalAnchor').slice(0,7),'2026-11');
    a.run('_tbCalView="week";_tbCalAnchor="2026-10-15";window.tbCalStep(1)');
    s.eq('week view steps a week',a.run('_tbCalAnchor'),'2026-10-22');
  }

  // ══ SESSION 2 — P0.1: THE FREEZE ════════════════════════════════════
  s.section('the calendar freeze: the filter and its handler are two names');
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(AMMAR));
    // The pure filter still filters — it is what _tbCalendar calls.
    a.run('tbItems=[{id:"i1",title:"a",date:"2026-10-01",assigneeUids:["u-ammar"],visibility:"shared",status:"open",kind:"task"}]');
    s.eq('tbCalFilter is still the pure filter',
      a.run('tbCalFilter(tbItems,{uid:"u-ammar",scope:"me"}).length'),1);
    s.eq('the handler is tbCalSetFilter',a.run('typeof window.tbCalSetFilter'),'function');
    // A key nobody asked for is not a filter. The freeze wrote the whole
    // item array's toString() as a key.
    a.run('window.tbCalSetFilter("[object Object]",{x:1})');
    s.eq('an unknown key is refused',a.run('Object.keys(_tbCalFilters).sort().join()'),
      'color,hideDone,lane,list,person,scope');
    a.run('window.tbCalSetFilter("lane",{not:"a string"})');
    s.eq('a non-string value becomes no filter',a.run('_tbCalFilters.lane'),'');
    a.run('window.tbCalSetFilter("lane","denim")');
    s.eq('a real one sets',a.run('_tbCalFilters.lane'),'denim');
  }

  // ══ SESSION 2 — P0.2: PEOPLE ═════════════════════════════════════════
  s.section('people: all five Board users resolve, from the profile directory');
  {
    const a=loadApp({files:FILES,currentPage:'tb-dash'});
    a.run('session='+J(AMMAR));
    // Only your own row -- what profileBootstrap leaves when nothing loads
    // the directory. This is the state that rendered everyone as "someone".
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar"}]');
    s.eq('with only your own row, one person resolves',a.run('Object.keys(tbHandleMap()).join()'),'ammar');
    s.eq('but all five are LISTED',a.run('tbPeople().map(p=>p.handle).join()'),'ammar,afnan,daniyal,mustafa,saim');
    s.eq('four of them not set up',a.run('tbPeople().filter(p=>!p.setUp).length'),4);
    // Yourself with no row at all still resolves, from the session.
    a.run('userProfiles=[]');
    s.eq('you resolve from the session with no row',a.run('tbHandleMap().ammar'),'u-ammar');
    s.eq('and by name',a.run('tbUser("u-ammar").name'),'Ammar');
    // The directory loaded: everyone resolves by name, not "someone".
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar"},{uid:"u-afnan",username:"afnan"},'
      +'{uid:"u-dani",username:"daniyal"},{uid:"u-must",username:"mustafa"},{uid:"u-saim",username:"saim"},'
      +'{uid:"u-sami",username:"sami"}]');
    s.eq('all five resolve',a.run('Object.keys(tbHandleMap()).sort().join()'),'afnan,ammar,daniyal,mustafa,saim');
    s.eq('Sami is never a Board person',a.run('tbHandleMap().sami'),undefined);
    s.eq('a name comes from USER_DEFS when the row has none',a.run('tbUser("u-dani").name'),'Daniyal Tufail');
    // Team today: five rows even with nothing on the board.
    a.run('tbItems=[];tbLoaded=true;_tbLoadErrors=[];tbConfig=null;tbLists=[]');
    const team=a.run('_tbTeamCard()');
    s.eq('Team today lists all five with nothing open',(team.match(/class="tb-teamrow/g)||[]).length,5);
    a.run('userProfiles=userProfiles.filter(p=>p.username!=="saim")');
    const team2=a.run('_tbTeamCard()');
    s.eq('still five when one has no profile',(team2.match(/class="tb-teamrow/g)||[]).length,5);
    s.ok('and that one says not set up yet',/tb-teamrow-off[\s\S]*not set up yet/.test(team2));
    // The drawer lists all five; Saim is there but cannot be assigned.
    a.run('tbItems=[tbDecodeItem({id:"i1",title:"x",ownerUid:"u-ammar",assigneeUids:["u-ammar"],visibility:"private"})];_tbOpenItemId="i1"');
    const dr=a.run('_tbDrawer()');
    s.eq('the drawer offers four assignable people',(dr.match(/class="tb-person( on)?"/g)||[]).length,4);
    s.ok('and shows the fifth as not set up',/tb-person tb-person-off" disabled[^>]*>Saim · not set up/.test(dr));
    // The person filter carries everyone who resolves.
    a.run('_tbOpenItemId=null;_tbCalAnchor="2026-10-01"');
    const head=a.run('_tbCalHead()');
    s.eq('the person filter offers four people and "anyone"',
      ((/tbCalSetFilter\('person'[\s\S]*?<\/select>/.exec(head)||[''])[0].match(/<option/g)||[]).length,5);
  }

  s.section('people: quick add turns @handle into an assignee, never title text');
  {
    const a=loadApp({files:FILES});
    const P=(t,h)=>a.run('tbParseQuickAdd('+J(t)+','+J({today:'2026-09-26',handles:h,
      boardHandles:['ammar','afnan','daniyal','mustafa','saim']})+')');
    const full={ammar:'u-ammar',afnan:'u-afnan',daniyal:'u-dani',mustafa:'u-must',saim:'u-saim'};
    const r=P('follow up baber @afnan',full);
    s.eq('@afnan is an assignee',J(r.assigneeUids),J(['u-afnan']));
    s.eq('and gone from the title',r.title,'follow up baber');
    // A Board person the session cannot resolve yet is still not title text.
    const r2=P('follow up baber @afnan',{ammar:'u-ammar'});
    s.eq('an unresolved Board person is not assigned',J(r2.assigneeUids),J([]));
    s.eq('is not title text either',r2.title,'follow up baber');
    s.eq('and is reported',J(r2.pendingHandles),J(['afnan']));
    // Someone who is not on the Board at all stays literal (Baber is real).
    const r3=P('ping @baber about samples',full);
    s.eq('a non-Board handle stays in the title',r3.title,'ping @baber about samples');
    s.eq('and is reported as unknown',J(r3.unknownHandles),J(['baber']));
  }

  s.section('people: the Board loads the profile directory with its data');
  {
    let called=0;
    const a=loadApp({files:FILES,globals:{loadProfiles:async()=>{called++;}}});
    a.run('session='+J(AMMAR));
    await a.run('loadTbData(true)');
    s.eq('loadTbData asks for the directory',called,1);
    // A refused directory read leaves the Board usable but says so.
    const b=loadApp({files:FILES,globals:{loadProfiles:async()=>{},_profileLoadErr:'Missing or insufficient permissions.'}});
    b.run('session='+J(AMMAR));
    await b.run('loadTbData(true)');
    s.ok('a refused directory is named in the warning strip',b.run('_tbLoadErrors').indexOf('user_profiles')>-1);
    s.eq('and does not take the board down',b.run('_tbLoadFailed("board_items")'),false);
  }

  // ══ SESSION 2 — P0.3: LIVE ITEMS ═════════════════════════════════════
  s.section('live items: a change reaches every open Board');
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(AMMAR));a.run('currentPage="tb-dash"');
    // Name every query, so each listener can be told apart.
    a.run('collection=function(db,p){return{p:p};};where=function(f,op,v){return f+op+v;};'
      +'query=function(c){return{p:c.p,w:[].slice.call(arguments,1).join("&")};};'
      +'doc=function(db,c,id){return{p:c+"/"+id};};'
      +'globalThis.__subs=[];globalThis.__dead=0;'
      +'onSnapshot=function(q,next,err){__subs.push({q:q,next:next});return function(){__dead++;};};'
      +'globalThis.__rp=0;_tbRepaint=function(){__rp++;};');
    const snap=docs=>'({docs:'+J(docs)+'.map(d=>({id:d.id,data:()=>d}))})';
    const fire=(re,docs)=>a.run('__subs.filter(x=>'+re+'.test(x.q.w||x.q.p))[0].next('+snap(docs)+')');
    const own={id:'o1',title:'mine',visibility:'private',ownerUid:'u-ammar',assigneeUids:['u-ammar'],status:'open'};
    a.run('tbItems=[];tbLists=[];tbLoaded=true;_tbLoadErrors=[];_tbLiveStart({items_own:{o1:'+J(own)+'}})');
    s.eq('four queries and the markers are listened to',a.run('__subs.length'),5);
    s.eq('the two item queries are the two loadTbData reads',
      a.run('__subs.filter(x=>x.q.p==="board_items").map(x=>x.q.w).join("|")'),'visibility==shared|ownerUid==u-ammar');
    // A colleague adds a shared item.
    fire('/visibility/',[{id:'r1',title:'remote',visibility:'shared',ownerUid:'u-afnan',assigneeUids:['u-ammar'],date:'2026-09-28',status:'open'}]);
    s.eq('it is on the board',a.run('tbItems.map(i=>i.id).sort().join()'),'o1,r1');
    s.eq('and the screen repaints',a.run('__rp'),1);
    s.ok('a shared snapshot never drops my own private item',a.run('tbItems.some(i=>i.id==="o1")'));
    // Deleted remotely: gone.
    fire('/visibility/',[]);
    s.eq('a remote delete takes it off',a.run('tbItems.map(i=>i.id).join()'),'o1');
    // Mid-typing: the data is taken, the repaint waits.
    a.run('__rp=0;_tbEditableFocus=function(){return true;}');
    fire('/visibility/',[{id:'r2',title:'while typing',visibility:'shared',ownerUid:'u-afnan',assigneeUids:['u-ammar'],status:'open'}]);
    s.ok('the data is taken at once',a.run('tbItems.some(i=>i.id==="r2")'));
    s.eq('but nothing repaints under the caret',a.run('__rp'),0);
    s.eq('it is pending',a.run('_tbLivePending'),true);
    a.run('_tbEditableFocus=function(){return false;};_tbLiveFlush()');
    s.eq('and lands the moment typing stops',a.run('__rp'),1);
    s.eq('once',a.run('_tbLivePending'),false);
    // Mid-drag: same.
    a.run('__rp=0;_tbDragId="r2"');
    fire('/visibility/',[]);
    s.eq('a drag in flight is not repainted under',a.run('__rp'),0);
    a.run('_tbDragId=null;_tbLiveFlush()');
    s.eq('and the drop lets it land',a.run('__rp'),1);
    // Off the Board, memory updates and nothing paints.
    a.run('__rp=0;currentPage="dashboard"');
    fire('/ownerUid/',[own,{id:'o2',title:'new',ownerUid:'u-ammar',assigneeUids:['u-ammar'],status:'open'}]);
    s.ok('memory updates off the Board',a.run('tbItems.some(i=>i.id==="o2")'));
    s.eq('with no repaint',a.run('__rp'),0);
    // A second start for the same person adds no listeners.
    a.run('_tbLiveStart({})');
    s.eq('restarting for the same person adds none',a.run('__subs.length'),5);
    // Lists and the markers are live too.
    a.run('currentPage="tb-lists"');
    fire('/memberUids/',[{id:'l1',title:'Winter Drop 2027',kind:'shared',memberUids:['u-ammar']}]);
    s.eq('a list shared with me appears',a.run('tbLists.map(l=>l.id).join()'),'l1');
    a.run('__subs.filter(x=>x.q.p==="board_config/markers")[0].next({exists:()=>true,data:()=>({markers:[{label:"launch",date:"2026-10-31"}]})})');
    s.eq('a moved launch date lands',a.run('tbConfig.markers[0].date'),'2026-10-31');
    // A refused read that has since succeeded is no longer a failure.
    a.run('_tbLoadErrors=["board_items"]');
    fire('/visibility/',[]);
    s.eq('a live snapshot clears a stale read failure',a.run('_tbLoadErrors.length'),0);
  }
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(AMMAR)+';onSnapshot=undefined');
    s.eq('an old shell with no onSnapshot stays static, and does not throw',
      a.run('(function(){_tbLiveStart({});return _tbLive;})()'),null);
  }

  // ══ SESSION 2 — P0.4: BOARD SETTINGS AND RUN SEED ═══════════════════
  s.section('board settings: Run seed, for Board owners only');
  {
    const mk=(sess,fetchImpl)=>{
      const a=loadApp({files:FILES,currentPage:'tb-dash',globals:Object.assign(
        {auth:{currentUser:{getIdToken:async()=>'tok-'+sess.u}}},fetchImpl?{fetch:fetchImpl}:{})});
      a.run('session='+J(sess));a.run('currentPage="tb-dash"');
      a.run('tbItems=[];tbLists=[];tbLoaded=true;_tbLoadErrors=[];tbConfig=null;userProfiles=[]');
      return a;
    };
    const d=mk(DANIYAL);
    s.ok('a member has no settings button',!/tb-settings-btn/.test(d.run('_tbShell("tb-dash","")')));
    d.run('window.tbToggleSettings()');
    s.eq('and cannot open it',d.run('_tbSettingsOverlay()'),'');
    let sent=null;
    const a=mk(AMMAR,async(url,init)=>{sent={url:String(url),init:init};
      return{ok:true,status:200,json:async()=>({ok:true,report:{created:42,alreadySeeded:0,listCreated:true,
        profilesCreated:['saim'],skippedUsers:[],skippedItems:[],keptAssignees:0}})};});
    s.ok('a Board owner has one',/tb-settings-btn/.test(a.run('_tbShell("tb-dash","")')));
    a.run('window.tbToggleSettings()');
    s.ok('it opens the settings with the seed',/run seed/.test(a.run('_tbSettingsOverlay()')));
    await a.run('window.tbRunSeed(true)');
    s.eq('it calls the function',sent&&sent.url,'/.netlify/functions/board-seed');
    s.eq('with POST',sent&&sent.init.method,'POST');
    s.eq('carrying the ID token and the preview flag',sent&&sent.init.body,J({idToken:'tok-ammar',dryRun:true}));
    s.ok('and says what it would do',/Would create 42 milestones/.test(a.run('_tbSeedState.result')));
    s.ok('naming the profile rows',/profile row for saim/.test(a.run('_tbSeedState.result')));
    // The answer is hydrated as TEXT, never markup.
    const ov=a.run('_tbSettingsOverlay()');
    s.ok('the result is a hydrate slot, not interpolated',/<div id="tbh\d+" class="tb-setresult"><\/div>/.test(ov));
    // A refusal is said out loud.
    const b=mk(AMMAR,async()=>({ok:false,status:403,json:async()=>({error:'Only a Board owner can run the seed.'})}));
    b.run('window.tbToggleSettings()');
    await b.run('window.tbRunSeed(true)');
    s.eq('a refusal is shown, not swallowed',b.run('_tbSeedState.error'),'Only a Board owner can run the seed.');
    const c=mk(AMMAR,async()=>({ok:false,status:404,json:async()=>{throw new Error('html');}}));
    c.run('window.tbToggleSettings()');
    await c.run('window.tbRunSeed(true)');
    s.ok('a missing function says it is not deployed',/not on this site yet/.test(c.run('_tbSeedState.error')));
    // A member calling it directly does nothing at all.
    let called=0;
    const m=mk(DANIYAL,async()=>{called++;return{ok:true,status:200,json:async()=>({})};});
    await m.run('window.tbRunSeed(false)');
    s.eq('a member cannot call it',called,0);
    // The summary, pure.
    const S=(r,dry)=>a.run('tbSeedSummary('+J(r)+','+J(dry)+')');
    s.ok('a real run says Done',/^Done\./.test(S({created:0,alreadySeeded:42},false)));
    s.ok('a re-run says nothing was duplicated',/Created 0 milestones; 42 already on the board/.test(S({created:0,alreadySeeded:42},false)));
    s.ok('a missing login is named',/No login yet for saim/.test(S({skippedUsers:['saim']},false)));
  }

  s.section('the calendar prefs are cleaned on load');
  {
    const a=loadApp({files:FILES});
    const C=v=>a.run('tbCleanCalPrefs('+J(v)+')');
    s.eq('nothing stored is nothing',C(null),null);
    s.eq('unreadable is thrown away',C('{not json'),null);
    s.eq('over 4 KB is thrown away',C(JSON.stringify({view:'week',pad:'x'.repeat(5000)})),null);
    const junk=JSON.stringify({view:'week',tray:false,rows:true,
      filters:{scope:'all',lane:'denim','[object Object],[object Object]':{nested:{deep:1}},hideDone:true}});
    const got=C(junk);
    s.eq('only known filter keys survive',J(Object.keys(got.filters).sort()),
      J(['color','hideDone','lane','list','person','scope']));
    s.eq('their values survive',J([got.filters.scope,got.filters.lane,got.filters.hideDone]),J(['all','denim',true]));
    s.eq('and the view, tray and rows',J([got.view,got.tray,got.rows]),J(['week',false,true]));
    s.eq('a bad scope reads as me',C(JSON.stringify({filters:{scope:'everyone'}})).filters.scope,'me');
    s.eq('hideDone must be a real boolean',C(JSON.stringify({filters:{hideDone:'yes'}})).filters.hideDone,false);

    // Driven through the loader: the junk entry is REWRITTEN clean, so it is
    // gone for good rather than merely ignored.
    const store={};
    const b=harness.loadApp({files:FILES,globals:{localStorage:{
      getItem:k=>store[k]==null?null:store[k],setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}}}});
    store['groovy-tb-cal']=junk;
    b.run('_tbCalLoadPrefs()');
    s.ok('the loader rewrites the entry without the junk key',
      store['groovy-tb-cal']&&store['groovy-tb-cal'].indexOf('[object Object]')<0);
    s.eq('and keeps the real lane',b.run('_tbCalFilters.lane'),'denim');
    // A fresh session opening onto the freeze's leftover.
    const store2={'groovy-tb-cal':'{"view":"month","filters":{"x":"'+'y'.repeat(1400000)+'"}}'};
    const c=harness.loadApp({files:FILES,globals:{localStorage:{
      getItem:k=>store2[k]==null?null:store2[k],setItem:(k,v)=>{store2[k]=String(v);},removeItem:k=>{delete store2[k];}}}});
    c.run('_tbCalLoadPrefs()');
    s.eq('a 1.4 MB entry is removed outright',store2['groovy-tb-cal'],undefined);
    s.eq('and the filters are the defaults',c.run('_tbCalFilters.scope+"|"+_tbCalFilters.lane'),'me|');
  }


  // ══ PHASE 4 ═══════════════════════════════════════════════════════════

  s.section('markdown-lite: escape first, format second');
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-afnan",username:"afnan",displayName:"Afnan"}]');
    const R=t=>a.run('tbRenderBody('+J(t)+')');
    // THE WHOLE BOUNDARY. _tbEsc runs on the raw text BEFORE any marker is
    // read, so a tag the author typed is already inert by the time this
    // function starts writing tags of its own.
    const evil=R('<img src=x onerror="alert(1)"> and <script>bad()</script>');
    s.ok('a tag in a comment body cannot reach the DOM',!/<img|<script/i.test(evil));
    s.ok('it is shown as the text it is',/&lt;img/.test(evil));
    s.ok('quotes are escaped too',/&quot;|&#39;/.test(R('he said "no" and it\'s fine')));
    s.ok('**bold** becomes strong',/<strong>yes<\/strong>/.test(R('**yes**')));
    s.ok('*italic* becomes em',/<em>maybe<\/em>/.test(R('*maybe*')));
    s.ok('`code` becomes code',/<code class="tb-code">a\*\*b<\/code>/.test(R('`a**b`')));
    // The code span is lifted out FIRST, so markdown inside it is text.
    s.ok('and markdown inside a code span is left alone',!/<strong>/.test(R('`a**b**c`')));
    s.ok('a newline becomes a break',/<br>/.test(R('one\ntwo')));
    // THE SCHEME CHECK IS THE REGEX: only http(s) can match at all.
    s.ok('an http url is linked',/<a class="tb-link" href="https:\/\/x\.test"/.test(R('see https://x.test')));
    s.ok('a javascript: url is NOT',!/<a /.test(R('javascript:alert(1)')));
    s.ok('and never loses rel=noopener',/rel="noopener noreferrer"/.test(R('https://x.test')));
    s.ok('trailing punctuation stays out of the href',
      /href="https:\/\/x\.test"[^>]*>https:\/\/x\.test<\/a>\./.test(R('https://x.test.')));
    // A mention renders as the PERSON, with the handle kept in the title so
    // two people who share a first name are still tellable apart.
    const men=R('hi @[afnan] ok');
    s.ok('a known mention renders the name',/<span class="tb-mention" title="@afnan">@Afnan<\/span>/.test(men));
    s.ok('an unknown handle renders as typed',/@\[baber\]|@baber/.test(R('@[baber]')));
    s.eq('an empty body renders nothing',R(''),'');
  }

  s.section('mentions: the query, the insert and the ranking');
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(AMMAR));
    const Q=(t,c)=>a.run('tbMentionQuery('+J(t)+','+c+')');
    s.eq('no @ before the caret is no popover',Q('hello',5),null);
    s.eq('a bare @ opens it with an empty prefix',J(Q('hi @',4)),J({at:3,prefix:''}));
    s.eq('and the typed prefix comes back',J(Q('hi @afn',7)),J({at:3,prefix:'afn'}));
    s.eq('an @ inside a word is not a mention',Q('mail@groovy',11),null);
    s.eq('a space inside the token closes it',Q('@af nan',7),null);
    s.eq('the caret BEFORE the @ sees nothing',Q('hi @afn',3),null);
    const I=(t,c,h)=>a.run('tbMentionInsert('+J(t)+','+c+','+J(h)+')');
    s.eq('picking writes the stored token form',I('hi @afn',7,'afnan').text,'hi @[afnan] ');
    s.eq('and puts the caret after it',I('hi @afn',7,'afnan').caret,12);
    s.eq('text after the caret survives',I('hi @afn there',7,'afnan').text,'hi @[afnan]  there');
    s.eq('nothing to replace changes nothing',I('hello',5,'afnan').text,'hello');

    const USERS=[{uid:'u-ammar',handle:'ammar',name:'Ammar'},
                 {uid:'u-afnan',handle:'afnan',name:'Afnan'},
                 {uid:'u-must',handle:'mustafa',name:'Mustafa'},
                 {uid:'u-dani',handle:'daniyal',name:'Daniyal'}];
    const NOW=1790000000000;
    const C=(p,ctx)=>a.run('tbMentionCandidates('+J(p)+','+J(Object.assign({users:USERS,now:NOW},ctx))+')');
    s.eq('an empty prefix shows the top five',C('',{me:'u-ammar'}).length,3);
    s.ok('and never yourself',!C('',{me:'u-ammar'}).some(u=>u.uid==='u-ammar'));
    // Spec s9: self is allowed when the handle is typed IN FULL.
    s.ok('typing your own handle in full offers you',
      C('ammar',{me:'u-ammar'}).some(u=>u.uid==='u-ammar'));
    s.ok('a partial match of your own handle does not',
      !C('amm',{me:'u-ammar'}).some(u=>u.uid==='u-ammar'));
    s.eq('a prefix filters on the first name',J(C('must',{me:'u-ammar'}).map(u=>u.handle)),J(['mustafa']));
    s.eq('and on the handle',J(C('dan',{me:'u-ammar'}).map(u=>u.handle)),J(['daniyal']));
    s.eq('a prefix nobody matches shows nobody',C('zzz',{me:'u-ammar'}).length,0);
    // score = count x recencyWeight, + 2 on this item, + 1 already in the
    // thread. So history beats nothing, and presence beats history.
    const stats={'u-dani':{count:20,lastAt:NOW}};
    s.eq('somebody you mention often comes first',
      C('',{me:'u-ammar',stats:stats})[0].handle,'daniyal');
    s.eq('but a person ON the item outranks a stale habit',
      C('',{me:'u-ammar',stats:{'u-dani':{count:1,lastAt:NOW-90*86400000}},
          assigneeUids:['u-must']})[0].handle,'mustafa');
    s.eq('and a thread voice outranks a silent one',
      C('',{me:'u-ammar',threadUids:['u-afnan']})[0].handle,'afnan');
    s.eq('ties break alphabetically by first name',
      J(C('',{me:'u-ammar'}).map(u=>u.handle)),J(['afnan','daniyal','mustafa']));
    // Recency decays: the same count, 6 months ago, loses to a fresh one.
    const old={'u-must':{count:20,lastAt:NOW-180*86400000},'u-afnan':{count:3,lastAt:NOW}};
    s.eq('a recent mention beats an old one with a bigger count',
      C('',{me:'u-ammar',stats:old})[0].handle,'afnan');
  }

  s.section("Enter selects only when there is one answer");
  {
    // AMMAR'S RULE, added at phase 0 and not in the spec. A popover that
    // swallows Enter on an ambiguous list picks somebody at random on the
    // author's behalf, and the author finds out when the wrong person
    // answers.
    const a=loadApp({files:FILES});
    const A=(n,i)=>a.run('tbMentionAccepts(new Array('+n+').fill({}),'+i+')');
    s.eq('three candidates, nothing arrowed to → Enter is the textarea’s',A(3,-1),-1);
    s.eq('exactly one candidate → Enter picks it',A(1,-1),0);
    s.eq('three candidates, one arrowed to → Enter picks that one',A(3,1),1);
    s.eq('an empty list never picks',A(0,-1),-1);
    s.eq('an empty list with an index never picks',A(0,0),-1);
    s.eq('an index past the end falls back to the same rule',A(3,9),-1);
    s.eq('…and to the single candidate when there is one',A(1,9),0);
  }

  s.section('resolving what was typed');
  {
    const a=loadApp({files:FILES});
    const MAP={afnan:'u-afnan',ammar:'u-ammar'};
    const R=t=>a.run('tbResolveMentions('+J(t)+','+J(MAP)+')');
    s.eq('a bare handle becomes the stored token',R('hi @afnan').body,'hi @[afnan]');
    s.eq('and resolves to a uid',J(R('hi @afnan').mentionUids),J(['u-afnan']));
    s.eq('an already-tokenised one is left alone',R('hi @[afnan]').body,'hi @[afnan]');
    // The quick-add rule, again: @baber is a real person, just not here.
    s.eq('an unknown handle stays literal',R('ask @baber').body,'ask @baber');
    s.eq('and names nobody',R('ask @baber').mentionUids.length,0);
    s.eq('the same person twice is one uid',R('@afnan @afnan').mentionUids.length,1);
    s.eq('an email address is not a mention',R('mail me at a@b.test').mentionUids.length,0);
    const B=(st,u,n)=>a.run('tbMentionBump('+J(st)+','+J(u)+','+n+')');
    s.eq('a first mention counts one',B({},['u-afnan'],5)['u-afnan'].count,1);
    s.eq('a second counts two',B({'u-afnan':{count:1,lastAt:1}},['u-afnan'],9)['u-afnan'].count,2);
    s.eq('and records when',B({'u-afnan':{count:1,lastAt:1}},['u-afnan'],9)['u-afnan'].lastAt,9);
    s.eq('bumping does not mutate what it was given',
      J(a.run('(function(){var s={};tbMentionBump(s,["u-afnan"],5);return s;})()')),'{}');
  }

  s.section('what posting a comment becomes');
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(AMMAR));
    const ITEM={id:'i1',title:'pricing tiers',ownerUid:'u-afnan',
      assigneeUids:['u-ammar','u-must'],commentCount:2,listId:'l1'};
    const MAP={afnan:'u-afnan',ammar:'u-ammar',mustafa:'u-must',daniyal:'u-dani'};
    const P=o=>a.run('tbCommentPlan('+J(ITEM)+','+J(Object.assign(
      {uid:'u-ammar',now:5,handleMap:MAP},o))+')');
    s.ok('an empty comment is refused',!!P({body:'   '}).error);
    s.ok('but a file on its own is a comment',
      !P({body:'',attachments:[{id:'f',name:'x.pdf'}]}).error);
    const plain=P({body:'looks right'});
    s.eq('the count goes up by one',plain.data.commentCount,3);
    s.ok('and the item’s last activity moves',plain.data.lastActivityAt===5);
    // Everyone already in this conversation hears about it — ONCE.
    s.eq('the owner and the other assignee are told',
      J(plain.notify.map(n=>n.uid).sort()),J(['u-afnan','u-must']));
    s.ok('as a plain comment',plain.notify.every(n=>n.type==='comment'));
    s.ok('and the author is never told about their own',
      !plain.notify.some(n=>n.uid==='u-ammar'));
    const men=P({body:'@afnan can you look'});
    s.eq('a mentioned person gets a mention, not a comment',
      J(men.notify.filter(n=>n.uid==='u-afnan')),J([{type:'mention',uid:'u-afnan'}]));
    s.eq('and only ONE row, though they are also the owner',
      men.notify.filter(n=>n.uid==='u-afnan').length,1);
    s.eq('the body is stored in token form',men.comment.body,'@[afnan] can you look');
    s.eq('with the uid resolved',J(men.comment.mentionUids),J(['u-afnan']));
    // Someone not on the item and not in the thread hears nothing.
    s.ok('a bystander is not notified',!plain.notify.some(n=>n.uid==='u-dani'));
    s.ok('…until they have spoken here',
      P({body:'ok',threadUids:['u-dani']}).notify.some(n=>n.uid==='u-dani'));
    s.eq('a mention of yourself notifies nobody',
      P({body:'@ammar note to self'}).notify.filter(n=>n.uid==='u-ammar').length,0);
  }

  s.section('posting it, driven');
  {
    const mk=()=>{
      const a=catchToasts(loadApp({files:FILES,currentPage:'tb-dash'}));
      a.run('session='+J(AMMAR));
      a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar",tbMentionStats:{}},'
        +'{uid:"u-afnan",username:"afnan",displayName:"Afnan"}]');
      a.run('tbLists=[];tbConfig=null;tbLoaded=true;_tbLoadErrors=[]');
      a.run('tbItems=[tbDecodeItem({id:"i1",title:"pricing tiers",ownerUid:"u-afnan",'
        +'assigneeUids:["u-ammar"],visibility:"shared",commentCount:0})]');
      a.run('_tbThreads={i1:{comments:[],activity:[],err:false}};_tbOpenItemId="i1"');
      return a;
    };
    const settle=()=>new Promise(r=>setTimeout(r,0));
    const a=mk();
    a.el('tb-comp').value='@afnan look at this';
    a.run('window.tbPostComment()');
    await settle();
    // ONE BATCH. Counting the writes does not prove it — the assertion has
    // to read the batch's CONTENTS, which is what caught phase 2's first
    // version passing with the log split into its own setDoc.
    s.eq('the comment, the item and the ranking go in one batch',a.state.batches.length,1);
    s.eq('all three documents are in it',a.state.batches[0].length,3);
    const cmt=a.state.writes.filter(w=>w.data&&w.data.authorUid)[0];
    s.ok('the comment is written',!!cmt);
    s.eq('in stored token form',cmt&&cmt.data.body,'@[afnan] look at this');
    const stats=a.state.writes.filter(w=>w.data&&w.data.tbMentionStats)[0];
    s.ok('the author’s own ranking data rides along',!!stats);
    s.eq('carrying the uid, so the profile rule passes on create as well as update',
      stats&&stats.data.uid,'u-ammar');
    s.eq('and counts the person mentioned',stats&&stats.data.tbMentionStats['u-afnan'].count,1);
    // A SET, not an update: a profile row that does not exist yet would
    // fail an updateDoc and take the whole comment down with it. The
    // `{merge:true}` third argument itself is invisible to the harness's
    // batch stub, so what is held here is the op — the half that decides
    // whether the write can fail at all.
    const pw=a.state.batches[0].filter(o=>o.data&&o.data.tbMentionStats)[0];
    s.eq('written as a set, so a missing profile cannot fail the comment',pw&&pw.op,'set');
    const notif=a.state.writes.filter(w=>w.data&&w.data.source==='tb')[0];
    s.ok('the mentioned person is pinged',!!notif);
    s.eq('by username, which is the bell’s key',notif&&notif.data.forUser,'afnan');
    s.eq('as a mention',notif&&notif.data.type,'mention');
    s.ok('and the snippet reads the NAME, not the raw token',
      /mentioned you/.test((notif&&notif.data.message)||'')
      &&!/@\[afnan\]/.test((notif&&notif.data.message)||''));
    s.eq('the draft is cleared',a.run('_tbCompDraft.i1'),'');
    s.eq('and the comment is in the thread without a re-read',a.run('_tbThreads.i1.comments.length'),1);

    // A COMMENT BODY IS A NOTIFICATION SNIPPET, and js/hrm.js prints that
    // RAW. tbNotifPayload is the one thing standing between the two.
    const x=mk();
    x.el('tb-comp').value='<img src=x onerror="alert(1)"> @afnan';
    x.run('window.tbPostComment()');
    await settle();
    const bad=x.state.writes.filter(w=>w.data&&w.data.source==='tb')[0];
    s.ok('a tag in a comment cannot reach the bell',
      !!bad&&!/<img/i.test(bad.data.message)&&/&lt;img/.test(bad.data.message));

    // An empty comment must not write anything at all.
    const e=mk();
    e.el('tb-comp').value='   ';
    e.run('window.tbPostComment()');
    await settle();
    s.eq('an empty comment writes nothing',e.state.writes.length,0);
    s.ok('and says why',toastsOf(e).some(t=>/Write something/.test(t)));
  }

  s.section('typing must not repaint the page');
  {
    // The board has ONE repaint and it rebuilds main-content wholesale, so
    // a repaint on every keystroke would destroy the textarea the caret is
    // in — and take the mention popover's anchor with it. The popover
    // repaints ONE element instead.
    const a=loadApp({files:FILES,currentPage:'tb-dash'});
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"},'
      +'{uid:"u-afnan",username:"afnan",displayName:"Afnan"}]');
    a.run('tbLists=[];tbLoaded=true;_tbLoadErrors=[]');
    a.run('tbItems=[tbDecodeItem({id:"i1",title:"x",ownerUid:"u-ammar",assigneeUids:["u-ammar"]})]');
    a.run('_tbThreads={i1:{comments:[],activity:[],err:false}};_tbOpenItemId="i1"');
    a.run('globalThis.__paints=0;var __op=_tbRepaint;_tbRepaint=function(){__paints++;return __op.apply(null,arguments);};');
    a.run('window.tbCompInput({value:"hi @af",selectionStart:6})');
    s.eq('typing repaints nothing',a.run('__paints'),0);
    s.eq('but the popover has candidates',a.run('_tbMentionList.length'),1);
    s.eq('with nothing arrowed to yet',a.run('_tbMentionIdx'),-1);
    s.ok('and the popover element was filled',/tb-mrow/.test(a.el('tb-mentions').innerHTML));
    s.ok('and marked open',a.el('tb-mentions').classList.contains('on'));
    a.run('window.tbCompInput({value:"hi there",selectionStart:8})');
    s.eq('leaving the token closes it',a.run('_tbMentionList.length'),0);
    s.ok('and unmarks it',!a.el('tb-mentions').classList.contains('on'));
    // Arrow keys move the highlight; Enter then picks (see tbMentionAccepts).
    a.run('window.tbCompInput({value:"@",selectionStart:1})');
    const n=a.run('_tbMentionList.length');
    a.run('window.tbCompKey({key:"ArrowDown",preventDefault(){}},null)');
    s.eq('arrow down highlights the first row',a.run('_tbMentionIdx'),0);
    a.run('window.tbCompKey({key:"ArrowUp",preventDefault(){}},null)');
    s.eq('arrow up wraps to the last',a.run('_tbMentionIdx'),n-1);
    a.run('window.tbCompKey({key:"Escape",preventDefault(){}},null)');
    s.eq('escape dismisses it',a.run('_tbMentionList.length'),0);
  }

  s.section('files');
  {
    const a=loadApp({files:FILES});
    const CL='https://res.cloudinary.com/deww4lpym/image/upload/v1/a.jpg';
    s.eq('the cap is 25 MB',a.run('TB_MAX_UPLOAD_MB'),25);
    s.eq('a file at the cap is allowed',a.run('tbTooBig({size:25*1024*1024})'),false);
    s.eq('one byte over is not',a.run('tbTooBig({size:25*1024*1024+1})'),true);
    s.eq('no file is not too big',a.run('tbTooBig(null)'),false);
    // THE THUMBNAIL IS A DELIVERY TRANSFORM, not a second upload: nothing
    // to keep in step, nothing to migrate, the original untouched.
    s.ok('an image gets a Cloudinary transform',
      /\/upload\/f_auto,q_auto,c_fit,w_320\//.test(a.run('tbThumbUrl({url:'+J(CL)+',mime:"image/jpeg"})')));
    const pdf='https://res.cloudinary.com/deww4lpym/raw/upload/v1/b.pdf';
    const pt=a.run('tbThumbUrl({url:'+J(pdf)+',mime:"application/pdf"})');
    s.ok('a pdf asks Cloudinary for page 1',/pg_1/.test(pt));
    s.ok('and as a jpg',/\.jpg$/.test(pt));
    s.eq('a zip has no preview and says so by returning nothing',
      a.run('tbThumbUrl({url:"https://res.cloudinary.com/x/upload/v1/c.zip",mime:"application/zip"})'),'');
    s.eq('a url that is not Cloudinary is never transformed',
      a.run('tbThumbUrl({url:"https://evil.test/a.jpg",mime:"image/jpeg"})'),'');
    // The anchored-host rule _profPhotoUrl and _boardsCoverUrl already hold.
    s.eq('a lookalike host is refused',
      a.run('tbFileHref({url:"https://res.cloudinary.com.evil.test/a.jpg"})'),'');
    s.eq('http is refused too',a.run('tbFileHref({url:"http://res.cloudinary.com/a.jpg"})'),'');
    s.eq('the real thing passes',a.run('tbFileHref({url:'+J(CL)+'})'),CL);
    const att=a.run('tbAttachment({secure_url:'+J(CL)+',public_id:"p1",width:800,height:600},'
      +'{name:"shot.jpg",type:"image/jpeg",size:1234},"u-ammar",7)');
    s.eq('an attachment keeps the file’s own name',att.name,'shot.jpg');
    s.eq('its size',att.size,1234);
    s.eq('who put it there',att.uploadedByUid,'u-ammar');
    s.eq('and when',att.at,7);
    s.eq('sizes read in human units',a.run('tbFileSize(2621440)'),'2.5 MB');
    s.eq('and small ones in KB',a.run('tbFileSize(4096)'),'4 KB');
  }

  s.section('request move');
  {
    const a=loadApp({files:FILES});
    const LOCKED={id:'g1',title:'ALL ASSETS IN',locked:true,lockedBy:'u-ammar',date:'2026-10-25'};
    const P=(it,o)=>a.run('tbMoveRequestPlan('+J(it)+','+J(Object.assign(
      {uid:'u-dani',toDay:'2026-10-28',reason:'shoot slipped',lockerHandle:'ammar',now:5},o))+')');
    s.ok('an unlocked item does not need a request',
      !!P({id:'i',locked:false}).error);
    s.ok('nor does one you hold the lock on',!!P(LOCKED,{uid:'u-ammar'}).error);
    s.ok('a request with no reason is refused',!!P(LOCKED,{reason:'  '}).error);
    s.ok('and one with no date',!!P(LOCKED,{toDay:''}).error);
    const ok=P(LOCKED,{});
    s.ok('the ask mentions the locker in stored token form',
      /^@\[ammar\] requesting move to 2026-10-28 — reason: shoot slipped$/.test(ok.comment.body));
    s.eq('and names them as the mention',J(ok.comment.mentionUids),J(['u-ammar']));
    s.eq('the locker is the one pinged',J(ok.notify),J([{type:'move_request',uid:'u-ammar'}]));
    s.eq('the thread count goes up',ok.data.commentCount,1);
    // A locker with no profile row yet still gets the ping; the body just
    // carries no chip. Never a raw uid — that was the phase-2 bug below.
    s.ok('an unresolvable handle drops the chip rather than printing a uid',
      !/u-ammar/.test(P(LOCKED,{lockerHandle:''}).comment.body));
  }

  s.section('the handover comment, fixed');
  {
    // A LIVE BUG PHASE 4 EXPOSED. tbHandoverPlan interpolated the raw UID,
    // so the thread — which nothing could read until this phase — would
    // have said "handed over to @u-dani".
    const a=loadApp({files:FILES});
    const item={id:'i1',assigneeUids:['u-afnan'],ownerUid:'u-afnan'};
    const p=a.run('tbHandoverPlan('+J(item)+',"u-afnan","u-dani","check the rates",false,5,"daniyal")');
    s.eq('it is the stored mention token now',p.comment.body,'handed over to @[daniyal] — check the rates');
    s.ok('no raw uid reaches the thread',!/u-dani/.test(p.comment.body));
    s.eq('and it renders as a chip',
      /<span class="tb-mention"/.test(a.run('tbRenderBody('+J(p.comment.body)+')')),true);
  }

  s.section('the inbox');
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(AMMAR));
    const N=[
      {_id:'n1',source:'tb',forUser:'ammar',type:'mention',itemId:'i1',createdAt:30,readBy:[]},
      {_id:'n2',source:'tb',forUser:'ammar',type:'comment',itemId:'i1',createdAt:20,readBy:['ammar']},
      {_id:'n3',source:'tb',forUser:'ammar',type:'done',itemId:'i2',createdAt:10,readBy:[]},
      {_id:'n4',source:'tb',forUser:'afnan',type:'mention',itemId:'i1',createdAt:40,readBy:[]},
      {_id:'n5',type:'advance',forUser:'ammar',createdAt:50,readBy:[]}
    ];
    const rows=a.run('tbInboxRows('+J(N)+',"ammar")');
    s.eq('only this person’s rows',rows.length,3);
    s.ok('somebody else’s are never shown',!rows.some(r=>r._id==='n4'));
    // The bell is SHARED with HRM, so the filter has to be on source as
    // well as recipient or an advance request would land on the board.
    s.ok('and an HRM notification is not a board one',!rows.some(r=>r._id==='n5'));
    s.eq('newest first',J(rows.map(r=>r._id)),J(['n1','n2','n3']));
    s.eq('unread is what readBy does not name',a.run('tbUnreadCount('+J(N)+',"ammar")'),2);
    s.eq('somebody with nothing has nothing',a.run('tbUnreadCount('+J(N)+',"saim")'),0);
    // Spec s7.5: CONSECUTIVE rows about one item read as one block. Five
    // pings about one thread is one conversation, not five.
    const g=a.run('tbGroupByItem('+J(rows)+')');
    s.eq('consecutive rows about one item group',g.length,2);
    s.eq('the first group holds both',g[0].rows.length,2);
    const split=a.run('tbGroupByItem('+J([N[0],N[2],N[1]])+')');
    s.eq('but a row in between splits them — it is consecutive, not sorted',split.length,3);
  }

  s.section('the inbox is live, and that is the phase’s definition of done');
  {
    const a=catchToasts(loadApp({files:FILES,currentPage:'tb-dash'}));
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-afnan",username:"afnan",displayName:"Afnan"}]');
    a.run('tbLists=[];tbItems=[];tbLoaded=true;_tbLoadErrors=[]');
    // js/shared.js declares `currentPage` at TOP LEVEL, so it clobbers the
    // harness's currentPage option exactly the way it clobbers `session`
    // (the phase-1 lesson). Set it with app.run after load, or the toast
    // branch never runs and "the first snapshot toasts nothing" passes
    // vacuously -- verified by breaking the seeding and watching it pass.
    a.run('currentPage="tb-dash"');
    a.run('globalThis.__q=null;onSnapshot=function(q,next,err){__q=next;return function(){};};');
    a.run('where=function(f,op,v){return{f:f,v:v};}');
    a.run('tbWatchNotifs()');
    s.ok('a listener was started',a.run('!!__q'));
    const snap=rows=>'__q({docs:'+J(rows)+'.map(function(r){return{id:r._id,data:function(){return r;}};})})';
    a.run(snap([{_id:'n1',source:'tb',forUser:'ammar',type:'mention',itemId:'i1',
      createdAt:10,readBy:[],message:'Afnan mentioned you'}]));
    // THE THIRD SURFACE. Phase 1 already shipped the span in js/shared.js,
    // so this is painted from here and that cross-track file needs no
    // further edit.
    s.eq('the sidebar badge shows the unread count',a.el('tb-nav-badge').textContent,'1');
    // The FIRST snapshot is history, not news — signing in must not fire a
    // toast for every unread row at once.
    s.eq('and the first snapshot toasts nothing',toastsOf(a).length,0);
    a.run(snap([
      {_id:'n1',source:'tb',forUser:'ammar',type:'mention',itemId:'i1',createdAt:10,readBy:[],message:'a'},
      {_id:'n2',source:'tb',forUser:'ammar',type:'comment',itemId:'i1',createdAt:20,readBy:[],message:'Afnan commented'}
    ]));
    s.eq('a new row moves the badge',a.el('tb-nav-badge').textContent,'2');
    s.eq('and a genuinely new one toasts',toastsOf(a).length,1);
    s.ok('saying what happened',/commented/.test(toastsOf(a)[0]));
    // Spec s5: a toast only while the Board is OPEN.
    a.run('currentPage="dashboard"');
    a.run(snap([
      {_id:'n1',source:'tb',forUser:'ammar',type:'mention',itemId:'i1',createdAt:10,readBy:[],message:'a'},
      {_id:'n2',source:'tb',forUser:'ammar',type:'comment',itemId:'i1',createdAt:20,readBy:[],message:'b'},
      {_id:'nx',source:'tb',forUser:'ammar',type:'mention',itemId:'i1',createdAt:25,readBy:[],message:'off board'}
    ]));
    s.eq('off the board it does not toast',toastsOf(a).length,1);
    s.eq('though the badge still moves',a.el('tb-nav-badge').textContent,'3');
    a.run('currentPage="tb-dash"');
    a.run(snap([
      {_id:'n1',source:'tb',forUser:'ammar',type:'mention',itemId:'i1',createdAt:10,readBy:[],message:'a'},
      {_id:'n2',source:'tb',forUser:'ammar',type:'comment',itemId:'i1',createdAt:20,readBy:[],message:'b'},
      {_id:'n3',source:'tb',forUser:'ammar',type:'mention',itemId:'i1',createdAt:30,readBy:[],message:'Afnan mentioned you again'}
    ]));
    s.eq('back on it, a new row toasts again',toastsOf(a).length,2);
    s.ok('saying what happened',/mentioned you again/.test(toastsOf(a)[1]));
    s.eq('the badge follows',a.el('tb-nav-badge').textContent,'3');
    // Reading them clears it, and the write is ONE batch.
    a.state.batches.length=0;
    a.run('window.tbMarkAllRead()');
    s.eq('marking all read is one round trip',a.state.batches.length,1);
    s.eq('carrying every unread row',a.state.batches[0].length,3);
    s.eq('and the badge empties at once',a.el('tb-nav-badge').textContent,'');
    // readBy is the SAME field the bell uses, so the two surfaces can never
    // disagree about what has been read.
    s.ok('by writing the bell’s own readBy field',
      a.state.writes.every(w=>!w.data||!w.data.readBy||w.data.readBy.indexOf('ammar')>-1));
  }

  s.section('no listener is a fallback, not a hang');
  {
    // onSnapshot is bridged onto window in index.html; an old cached shell
    // may not carry it. An inbox waiting forever for a snapshot that will
    // never come is the stuck-skeleton failure this codebase keeps
    // recording, so it falls back to a one-off read.
    const rows=[{_id:'n1',source:'tb',forUser:'ammar',type:'mention',itemId:'i1',
      createdAt:10,readBy:[],message:'Afnan mentioned you'}];
    const a=loadApp({files:FILES,currentPage:'tb-inbox',globals:{
      getDocs:async()=>({docs:rows.map(r=>({id:r._id,data:()=>r}))})
    }});
    a.run('session='+J(AMMAR));
    a.run('tbLists=[];tbItems=[];tbLoaded=true;_tbLoadErrors=[];onSnapshot=undefined');
    a.run('tbWatchNotifs()');
    await new Promise(r=>setTimeout(r,0));
    s.eq('the rows are read once instead',a.run('tbNotifs.length'),1);
    s.eq('the badge still paints',a.el('tb-nav-badge').textContent,'1');
    s.ok('and the screen is not stuck on loading',
      !/loading/.test(a.run('_tbInboxScreen()')));
    s.ok('a one-off read never toasts its own history',toastsOf(catchToasts(a)).length===0);

    // A REFUSED read and an EMPTY inbox must never render the same screen.
    const b=loadApp({files:FILES,currentPage:'tb-inbox',globals:{
      getDocs:async()=>{throw new Error('Missing or insufficient permissions');}
    }});
    b.run('session='+J(AMMAR));
    b.run('tbLists=[];tbItems=[];tbLoaded=true;_tbLoadErrors=[];onSnapshot=undefined');
    b.run('tbWatchNotifs()');
    await new Promise(r=>setTimeout(r,0));
    const scr=b.run('_tbInboxScreen()');
    s.ok('a refused read says so',/Could not read your inbox/.test(scr));
    s.ok('not "nothing in your inbox"',!/nothing in your inbox/.test(scr));
    s.ok('and offers a retry',/tbRetryInbox/.test(scr));
  }

  s.section('a listener is not started for someone without access');
  {
    const a=loadApp({files:FILES,currentPage:'dashboard'});
    a.run('session='+J(HARIS));
    a.run('globalThis.__q=null;onSnapshot=function(q,next){__q=next;return function(){};};');
    a.run('tbWatchNotifs()');
    s.eq('a non-board user gets no inbox listener',a.run('__q'),null);
    // And the wrap exists at all — without it the badge is only live while
    // the Board is open, which is not what the phase asks for.
    s.ok('startApp is wrapped so the count is live on every page',
      /window\.startApp=async function/.test(read('js/theboard.js')));
  }

  s.section('the phase 4 screens');
  {
    const a=loadApp({files:FILES,currentPage:'tb-inbox'});
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"},'
      +'{uid:"u-afnan",username:"afnan",displayName:"Afnan"}]');
    a.run('tbLists=[];tbConfig=null;tbLoaded=true;_tbLoadErrors=[]');
    a.run('tbItems=[tbDecodeItem({id:"i1",title:"pricing tiers",ownerUid:"u-ammar",'
      +'assigneeUids:["u-ammar"],visibility:"shared",attachments:[{id:"f1",name:"brief.pdf",'
      +'url:"https://res.cloudinary.com/x/raw/upload/v1/brief.pdf",mime:"application/pdf",size:2048}]})]');
    a.run('_tbNotifSeeded=true;tbNotifs=[{_id:"n1",source:"tb",forUser:"ammar",type:"mention",'
      +'itemId:"i1",fromUid:"u-afnan",createdAt:'+Date.now()+',readBy:[],message:"Afnan mentioned you"}]');
    const inbox=a.run('_tbInboxScreen()');
    s.ok('the inbox renders a row',/tb-nf /.test(inbox)||/class="tb-nf unread"/.test(inbox));
    s.ok('unread is marked',/tb-nf unread/.test(inbox));
    s.ok('and offers mark all read',/tbMarkAllRead/.test(inbox));
    s.ok('the row opens the item it is about',/tbOpenNotif\('n1','i1'\)/.test(inbox));
    a.run('tbNotifs=[]');
    s.ok('an empty inbox says so rather than rendering nothing',
      /nothing in your inbox/.test(a.run('_tbInboxScreen()')));
    // The drawer's phase-4 half.
    a.run('_tbOpenItemId="i1";_tbThreads={i1:{comments:[{_id:"c1",authorUid:"u-afnan",'
      +'body:"looks right to me",createdAt:'+Date.now()+',attachments:[]}],activity:[],err:false}}');
    const d=a.run('_tbDrawer()');
    s.ok('the drawer carries the thread',/tb-cmt/.test(d));
    s.ok('the comment body is rendered, not slotted',/looks right to me/.test(d));
    s.ok('there is a composer',/id="tb-comp"/.test(d));
    s.ok('with a mention popover anchored to it',/id="tb-mentions"/.test(d));
    s.ok('a files section',/tb-files|nothing attached/.test(d));
    s.ok('showing the attachment',/brief\.pdf/.test(d)||/tb-file/.test(d));
    s.ok('one picker for both destinations',(d.match(/id="tb-filepick"/g)||[]).length===1);
    s.ok('and an activity section, collapsed',/tbToggleActivity/.test(d)&&!/tb-actl/.test(d));
    // A thread that could not be read must never look like an empty one.
    a.run('_tbThreads={i1:{comments:[],activity:[],err:true}}');
    s.ok('a refused thread read says so',/Could not read the thread/.test(a.run('_tbDrawer()')));
    // Request move only appears to somebody who cannot move it.
    a.run('_tbThreads={i1:{comments:[],activity:[],err:false}}');
    a.run('tbItems[0].locked=true;tbItems[0].lockedBy="u-afnan"');
    // AMMAR IS A BOARD OWNER and can override any lock, so he is never
    // shown this — the premise phase 3's lock tests had to be corrected on
    // too. Daniyal is the person the button exists for.
    a.run('session='+J(DANIYAL));
    s.ok('a locked item offers a way to ask',/tbOpenMoveReq/.test(a.run('_tbDrawer()')));
    a.run('tbItems[0].lockedBy="u-dani"');
    s.ok('the lock holder is not offered it',!/tbOpenMoveReq/.test(a.run('_tbDrawer()')));
    a.run('tbItems[0].lockedBy="u-afnan"');
    a.run('session='+J(AMMAR));
    s.ok('and neither is a board owner, who can just move it',
      !/tbOpenMoveReq/.test(a.run('_tbDrawer()')));
    // Card 9 and the rail count.
    a.run('tbItems[0].locked=false;_tbOpenItemId=null');
    a.run('tbNotifs=[{_id:"n1",source:"tb",forUser:"ammar",type:"mention",itemId:"i1",'
      +'fromUid:"u-afnan",createdAt:'+Date.now()+',readBy:[],message:"Afnan mentioned you"}]');
    s.ok('the dashboard carries an inbox card',/inbox/.test(a.run('_tbDashboard()')));
    s.ok('the rail carries the unread slot',/id="tb-rail-n"/.test(a.run('_tbShell("tb-inbox","")')));
    a.run('tbNotifs=[]');
    s.ok('and the card is hidden when there is nothing in it',
      !/view all/.test(a.run('_tbDashboard()')));
  }

  s.section('the activity log reads as sentences');
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"},'
      +'{uid:"u-dani",username:"daniyal",displayName:"Daniyal"}]');
    const L=o=>a.run('tbActivityLine('+J(o)+')');
    s.ok('a move says where from and to',
      /Ammar moved it 2026-10-25 → 2026-10-28/.test(
        L({type:'moved',byUid:'u-ammar',payload:{from:'2026-10-25',to:'2026-10-28'}})));
    // The override is in the PAYLOAD, not only in a toast — phase 3's
    // promise, and this is where it is finally read back.
    s.ok('an overridden lock is on the record',
      /overrode the lock/.test(L({type:'moved',byUid:'u-ammar',
        payload:{from:'a',to:'b',override:true}})));
    s.ok('a handover names who',
      /Ammar handed it to Daniyal/.test(L({type:'handover',byUid:'u-ammar',payload:{toUid:'u-dani'}})));
    s.ok('a file is named',/added brief\.pdf/.test(
      L({type:'file_added',byUid:'u-ammar',payload:{name:'brief.pdf'}})));
    s.ok('an unknown verb admits it rather than rendering a blank line',
      /changed something/.test(L({type:'whatever',byUid:'u-ammar'})));
    s.ok('and an unresolvable person is “someone”, never a uid',
      !/u-nobody/.test(L({type:'done',byUid:'u-nobody'})));
  }


  // ══ PHASE 5 ═══════════════════════════════════════════════════════════

  s.section('search, over the loaded set');
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(AMMAR));
    const IT={id:'i1',title:'pricing tiers',notes:'wholesale MARGIN is the open question',
      lane:'denim',steps:[{title:'ask the mill',done:false}],status:'open'};
    const M=(q,th)=>a.run('tbSearchMatch('+J(IT)+','+J(q)+','+J(th||null)+')');
    s.eq('an empty query matches nothing',M(''),null);
    s.eq('a title hit says where',J(M('pricing').where),J(['title']));
    s.ok('notes are searched, case-folded',M('margin').where.indexOf('notes')>-1);
    s.ok('so are steps',M('mill').where.indexOf('steps')>-1);
    s.ok('and the lane',M('denim').where.indexOf('lane')>-1);
    s.eq('a word nowhere on it does not match',M('leather'),null);
    s.eq('one word can match in two places',J(M('tiers').where),J(['title']));
    // THE HONEST LIMIT of "over the loaded set": a thread is read when a
    // drawer opens, so a comment in an item nobody has opened is not in
    // memory to search. The result row says which fields matched.
    s.eq('a comment is not searched when the thread was never read',M('cyc'),null);
    s.ok('and is when it was',
      M('cyc',{comments:[{body:'the CYC has to be wired'}]}).where.indexOf('comments')>-1);

    const ITEMS=[IT,{id:'i2',title:'denim bulk',notes:'',status:'open',date:'2026-10-05'},
      {id:'i3',title:'knit samples',notes:'pricing sheet attached',status:'open',date:'2026-10-02'}];
    const hits=a.run('tbSearchItems('+J(ITEMS)+',"pricing",{})');
    s.eq('both are found',hits.length,2);
    // A title hit outranks one buried in notes -- somebody searching a
    // word is far more often looking for the thing named after it.
    s.eq('the title hit comes first',hits[0].item.id,'i1');
    s.eq('a query nobody matches returns nothing',a.run('tbSearchItems('+J(ITEMS)+',"zzz",{})').length,0);
  }

  s.section('the search box replaces the screen and puts itself back');
  {
    const a=loadApp({files:FILES,currentPage:'tb-dash'});
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"}]');
    a.run('tbLists=[];tbConfig=null;tbLoaded=true;_tbLoadErrors=[]');
    a.run('tbItems=[tbDecodeItem({id:"i1",title:"pricing tiers",ownerUid:"u-ammar",'
      +'assigneeUids:["u-ammar"],visibility:"shared",date:"2026-10-17"})]');
    s.ok('the box is in the rail, so it is on every screen',
      /id="tb-search"/.test(a.run('_tbShell("tb-dash","")')));
    s.ok('the dashboard renders normally with no query',
      !/results for/.test(a.run('_tbScreen("tb-dash")')));
    // A search is a MODE, not a fifth page: it answers "where is that
    // item" from wherever you were, and clearing puts you back.
    a.run('_tbQuery="pricing"');
    const scr=a.run('_tbScreen("tb-dash")');
    s.ok('a query takes over the screen',/1 result for/.test(scr));
    s.ok('and says where it matched',/matched in title/.test(scr));
    a.run('_tbQuery="zzz"');
    const none=a.run('_tbScreen("tb-dash")');
    s.ok('nothing matching says so in one sentence',/nothing matches/.test(none));
    s.ok('and names the limit rather than implying comments are covered',
      /threads you have opened/.test(none));
    s.ok('with a way out',/tbSearchClear/.test(none));
    a.run('window.tbSearchClear()');
    s.eq('clearing empties the query',a.run('_tbQuery'),'');
    s.eq('and asks for the caret back',a.run('_tbSearchFocus'),false,'consumed by the repaint');
  }

  s.section('the keyboard');
  {
    const a=loadApp({files:FILES});
    const K=(e,ctx)=>a.run('tbShortcutFor('+J(e)+','+J(ctx||{})+')');
    s.eq('n is a new item',K({key:'n'}),'new');
    s.eq('slash is search',K({key:'/'}),'search');
    s.eq('d is the dashboard',K({key:'d'}),'go:tb-dash');
    s.eq('c is the calendar',K({key:'c'}),'go:tb-calendar');
    s.eq('l is lists',K({key:'l'}),'go:tb-lists');
    s.eq('i is the inbox',K({key:'i'}),'go:tb-inbox');
    s.eq('? is the shortcut list',K({key:'?'}),'help');
    s.eq('and so is shift+slash, which is how it is typed',K({key:'/',shiftKey:true}),'help');
    // Those belong to the OS and the browser, not to us.
    s.eq('ctrl+d is not ours',K({key:'d',ctrlKey:true}),'');
    s.eq('cmd+i is not ours',K({key:'i',metaKey:true}),'');
    // THE EDITABLE BAIL: a letter typed into a field is a letter.
    s.eq('d while typing is just a d',K({key:'d'},{editable:true}),'');
    s.eq('and so is n',K({key:'n'},{editable:true}),'');
    // ESCAPE IS READ BEFORE THE BAIL, or it is handed to the browser and
    // does nothing -- the rule js/boards.js had to learn twice.
    s.eq('escape closes the drawer even from a field',
      K({key:'Escape'},{editable:true,drawerOpen:true}),'close-drawer');
    s.eq('the shortcut list outranks the drawer',
      K({key:'Escape'},{helpOpen:true,drawerOpen:true}),'help-close');
    s.eq('then the drawer outranks the search',
      K({key:'Escape'},{drawerOpen:true,query:'x'}),'close-drawer');
    s.eq('and with neither open it clears the search',
      K({key:'Escape'},{query:'x'}),'clear-search');
    s.eq('escape with nothing to close does nothing',K({key:'Escape'},{}),'');
    s.eq('an unmapped key does nothing',K({key:'q'}),'');
    // Every key the overlay advertises is a key that does something.
    const listed=a.run('TB_SHORTCUTS.map(x=>x.k)');
    s.eq('the ? overlay lists eight',listed.length,8);
    const live=listed.filter(k=>k==='esc'
      ? a.run('tbShortcutFor({key:"Escape"},{drawerOpen:true})')!==''
      : a.run('tbShortcutFor('+J({key:k})+',{})')!=='');
    s.eq('and every one of them is wired',live.length,listed.length,live.join(','));
    s.ok('the overlay is closed until asked for',!a.run('_tbHelpOpen'));
    a.run('window.tbToggleHelp()');
    s.ok('and renders the keys when it is',/tb-kbd/.test(a.run('_tbHelpOverlay()')));
  }

  s.section('the keyboard is scoped to the board');
  {
    // `d` must not navigate away from somebody typing a PO number on
    // another page, so the document listener bails on the page first.
    const a=loadApp({files:FILES,currentPage:'tb-dash'});
    a.run('session='+J(AMMAR));
    a.run('tbLists=[];tbItems=[];tbLoaded=true;_tbLoadErrors=[];currentPage="po-registry"');
    a.run('globalThis.__went=[];showPage=function(p){__went.push(p);};window.showPage=showPage');
    const fire=e=>a.run('(document.__k||[]).forEach(function(f){f('+J(e)+');})');
    // The listener is registered ONCE at load, on the document.
    a.run('document.__k=(globalThis.__docListeners||[])');
    s.ok('a keydown listener was registered at load',
      (a.state.listeners['keydown']||[]).length===1);
    const call=e=>(a.state.listeners['keydown']||[]).forEach(f=>f(Object.assign({preventDefault(){}},e)));
    call({key:'c'});
    s.eq('off the board, c does nothing',a.run('__went').length,0);
    a.run('currentPage="tb-dash"');
    call({key:'c'});
    s.eq('on the board it navigates',J(a.run('__went')),J(['tb-calendar']));
  }

  s.section('boardLastSeenAt');
  {
    const a=loadApp({files:FILES,currentPage:'tb-dash'});
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"}]');
    a.run('tbLists=[];tbItems=[];tbLoaded=true;_tbLoadErrors=[];tbConfig=null');
    s.eq('the first look is always due',a.run('tbSeenDue(0,Date.now())'),true);
    s.eq('a minute later it is not',a.run('tbSeenDue(1000,61000)'),false);
    s.eq('ten minutes later it is',a.run('tbSeenDue(0,600000)'),true);
    // A RENDER FUNCTION MUST NOT WRITE. Caught by the create test going
    // from two documents to three when this lived in _tbDashboard.
    a.run('_tbRepaint()');
    await new Promise(r=>setTimeout(r,0));
    s.eq('painting the dashboard writes nothing',a.state.writes.length,0);
    a.run('tbRenderPage("tb-dash")');
    await new Promise(r=>setTimeout(r,0));
    s.eq('opening it writes once',a.state.writes.length,1);
    const w=a.state.writes[0];
    s.ok('the last-seen stamp',!!(w&&w.data&&w.data.boardLastSeenAt));
    s.eq('carrying uid, so the profile rule passes on create as well as update',
      w&&w.data.uid,'u-ammar');
    a.run('tbRenderPage("tb-dash")');
    await new Promise(r=>setTimeout(r,0));
    s.eq('opening it again inside ten minutes writes nothing more',a.state.writes.length,1);
  }

  s.section('Dashboard cards 10-12');
  {
    const a=loadApp({files:FILES});
    a.run('session='+J(AMMAR));
    const TODAY='2026-10-17';
    const ITEMS=[
      {id:'i1',title:'a',assigneeUids:['u-ammar'],status:'open',date:'2026-10-17',visibility:'shared',
       ownerUid:'u-ammar',createdAt:100,dateHistory:[]},
      {id:'i2',title:'b',assigneeUids:['u-ammar'],status:'open',date:'2026-10-10',visibility:'shared',
       ownerUid:'u-ammar',createdAt:200,dateHistory:[{from:'2026-10-05',to:'2026-10-10',byUid:'u-dani',at:500}]},
      {id:'i3',title:'c',assigneeUids:['u-dani'],status:'done',visibility:'shared',
       ownerUid:'u-dani',createdAt:300,completedAt:900,completedByUid:'u-dani',dateHistory:[]},
      {id:'i4',title:'p',assigneeUids:['u-ammar'],status:'open',visibility:'private',
       ownerUid:'u-ammar',createdAt:400,dateHistory:[]}
    ];
    // A timestamp ON that day, not Date.now() -- the counts above are
    // pinned to 2026-10-17 and "seen today" has to be read against the
    // same day or the assertion is about when the suite happens to run.
    const SEEN=new Date(2026,9,17,12,0,0).getTime();
    const PROF=[{uid:'u-ammar',username:'ammar',displayName:'Ammar',boardLastSeenAt:SEEN},
                {uid:'u-dani',username:'daniyal',displayName:'Daniyal',boardLastSeenAt:1}];
    const team=a.run('tbTeamToday('+J(ITEMS)+',["u-ammar","u-dani","u-saim"],'+J(TODAY)+','+J(PROF)+')');
    s.eq('one row per board user',team.length,3);
    s.eq('open counts what is not done',team[0].open,3);
    s.eq('due today',team[0].due,1);
    s.eq('overdue',team[0].overdue,1);
    s.eq('a done item is on nobody’s count',team[1].open,0);
    s.eq('somebody who opened it today',team[0].seenToday,true);
    s.eq('somebody who has not',team[1].seenToday,false);
    // NO ROW IS AN ACCUSATION: never signed in is not "has not looked".
    s.eq('and somebody with no profile row at all is unknown, not absent',team[2].seenToday,null);

    const act=a.run('tbRecentActivity('+J(ITEMS)+',15)');
    // DERIVED from the items already in memory -- no collection-group
    // query, no new index, no rules change, and nothing that can go stale.
    s.ok('a private item never reaches a shared feed',!act.some(r=>r.item.id==='i4'));
    s.eq('newest first',act[0].at,900);
    s.eq('and it is the completion',act[0].row.type,'done');
    s.ok('a move is in it',act.some(r=>r.row.type==='moved'&&r.row.payload.to==='2026-10-10'));
    s.ok('and a creation',act.some(r=>r.row.type==='created'));
    s.eq('the limit is honoured',a.run('tbRecentActivity('+J(ITEMS)+',2)').length,2);
    // ONE definition of how a log entry reads, shared with the drawer.
    a.run('userProfiles='+J(PROF));
    s.ok('it words events through tbActivityLine',
      /Daniyal marked it done/.test(a.run('tbActivityLine('+J(act[0].row)+')')));

    const LISTS=[{id:'l1',title:'Winter Drop 2027',kind:'shared',color:'moss'},
                 {id:'l2',title:'empty one',kind:'private',color:'slate'},
                 {id:'l3',title:'archived',archived:true}];
    const withList=ITEMS.map(i=>Object.assign({},i,{listId:i.id==='i3'?'l2':'l1'}));
    const ml=a.run('tbMyLists('+J(withList)+','+J(LISTS)+',"u-ammar")');
    s.eq('an archived list is not a list',ml.length,2);
    s.eq('busiest first',ml[0].id,'l1');
    s.eq('counting what is open',ml[0].open,3);
    s.eq('and how much of it is mine',ml[0].mine,3);
    s.eq('a list whose only item is done reads zero',ml[1].open,0);
  }

  s.section('the context cards stay out of the way of an empty board');
  {
    // Spec s7.1: a card with nothing to SAY is hidden, not rendered empty.
    // Five rows of "0 open" answers no question -- and it would suppress
    // the empty state, which is spec s10's one sentence plus one action.
    const a=loadApp({files:FILES,currentPage:'tb-dash'});
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"}]');
    a.run('tbLists=[{id:"l1",title:"Winter Drop 2027",kind:"shared",adminUid:"u-ammar"}]');
    a.run('tbItems=[];tbLoaded=true;_tbLoadErrors=[];tbConfig=null');
    const bare=a.run('_tbDashboard()');
    s.ok('an empty board still says so',/nothing on the board today/.test(bare));
    s.ok('with one action, not none',/tb-calendar/.test(bare));
    // REVERSED in session 2 (brief s4): Team today lists all five from day
    // one, even with zero items -- "who is on the board" is a question an
    // empty board still has to answer.
    s.ok('the team card is there from day one',/team today/.test(bare));
    s.ok('no list chips',!/my lists/.test(bare));
    a.run('tbItems=[tbDecodeItem({id:"i1",title:"a",ownerUid:"u-ammar",'
      +'assigneeUids:["u-ammar"],visibility:"shared",listId:"l1",date:"'+a.run('_tbToday()')+'"})]');
    const full=a.run('_tbDashboard()');
    s.ok('with work on it the team card appears',/team today/.test(full));
    s.ok('and the list chips',/my lists/.test(full));
    // _tbCard's count chip reads rows.length, so the chips have to be one
    // row each -- joined into a single string the card says "1" however
    // many lists there are.
    a.run('tbLists.push({id:"l2",title:"second",kind:"private",adminUid:"u-ammar"})');
    a.run('tbItems.push(tbDecodeItem({id:"i2",title:"b",ownerUid:"u-ammar",'
      +'assigneeUids:["u-ammar"],visibility:"shared",listId:"l2"}))');
    const two=a.run('_tbDashboard()');
    s.ok('the card counts the lists, not the string it built',
      /my lists<span class="tb-count">2</.test(two));
  }

  s.section('the unscheduled tray');
  {
    const a=loadApp({files:FILES,currentPage:'tb-calendar'});
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"},'
      +'{uid:"u-dani",username:"daniyal",displayName:"Daniyal"}]');
    a.run('tbLists=[];tbLoaded=true;_tbLoadErrors=[];tbConfig=null');
    a.run('tbItems=['
      +'tbDecodeItem({id:"d1",title:"dated",ownerUid:"u-ammar",assigneeUids:["u-ammar"],'
        +'visibility:"shared",date:"2026-10-17",lane:"denim"}),'
      +'tbDecodeItem({id:"u1",title:"denim bulk lands",ownerUid:"u-ammar",'
        +'assigneeUids:["u-ammar"],visibility:"shared",lane:"denim"}),'
      +'tbDecodeItem({id:"u2",title:"knit bulk lands",ownerUid:"u-ammar",'
        +'assigneeUids:["u-ammar"],visibility:"shared",lane:"knit"}),'
      +'tbDecodeItem({id:"u3",title:"someone else\'s",ownerUid:"u-dani",'
        +'assigneeUids:["u-dani"],visibility:"shared"})]');
    const un=f=>a.run('tbUnscheduled(tbItems,'+J(Object.assign({uid:'u-ammar',scope:'me'},f))+').map(i=>i.id)');
    s.eq('only what has no date',J(un({})),J(['u1','u2']));
    s.ok('a dated item is never in the tray',un({}).indexOf('d1')<0);
    s.ok('and neither is somebody else’s',un({}).indexOf('u3')<0);
    // ONE PREDICATE serves the grid and the tray, so a chip can never say
    // 4 while the tray draws 3.
    s.eq('the calendar’s own filters apply to it',J(un({lane:'denim'})),J(['u1']));
    s.eq('and the everyone scope',un({scope:'all'}).length,3);
    a.run('_tbCalAnchor="2026-10-15";_tbCalView="week";_tbHydrateQueue=[]');
    const cal=a.run('_tbCalendar()');
    s.ok('the tray renders beside the grid',/tb-tray/.test(cal));
    s.ok('saying how many are in it',/unscheduled<span class="tb-count">2</.test(cal));
    s.ok('and how to get one onto a day',/drag one onto a day/.test(cal));
    a.run('window.tbTrayToggle()');
    s.ok('it collapses',!/tb-traybody/.test(a.run('_tbCalendar()')));
    s.eq('and the preference never reaches Firestore',a.state.writes.length,0);
  }

  s.section('the week, read as rows by person');
  {
    const a=loadApp({files:FILES,currentPage:'tb-calendar'});
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"},'
      +'{uid:"u-afnan",username:"afnan",displayName:"Afnan"},'
      +'{uid:"u-dani",username:"daniyal",displayName:"Daniyal"},'
      +'{uid:"u-must",username:"mustafa",displayName:"Mustafa"},'
      +'{uid:"u-saim",username:"saim",displayName:"Saim"}]');
    a.run('tbLists=[];tbLoaded=true;_tbLoadErrors=[];tbConfig=null');
    a.run('tbItems=[tbDecodeItem({id:"i1",title:"shoot 2",ownerUid:"u-ammar",'
      +'assigneeUids:["u-dani"],visibility:"shared",date:"2026-10-15"})]');
    a.run('_tbCalAnchor="2026-10-15";_tbCalView="week";_tbCalRows=true;_tbHydrateQueue=[]');
    const rows=a.run('_tbCalendar()');
    s.ok('it renders the person grid',/tb-personweek/.test(rows));
    s.eq('one row per board user, plus the day header',
      (rows.match(/class="tb-prow/g)||[]).length,6);
    s.ok('the item sits in its person’s row',/data-day="2026-10-15"/.test(rows));
    s.ok('and the toggle says it is on',/tb-seg on" onclick="window.tbCalRows\(false\)/.test(rows));
    // It is a way of reading the WEEK, so it is not offered on a month.
    a.run('_tbCalView="month"');
    s.ok('a month offers no by-person toggle',!/tbCalRows/.test(a.run('_tbCalendar()')));
    s.ok('and does not render one',!/tb-personweek/.test(a.run('_tbCalendar()')));
    // Seven columns times five people is not a phone.
    const p=loadApp({files:FILES,currentPage:'tb-calendar',phone:true});
    p.run('session='+J(AMMAR));
    p.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"}]');
    p.run('tbLists=[];tbItems=[];tbLoaded=true;_tbLoadErrors=[];tbConfig=null');
    p.run('_tbCalAnchor="2026-10-15";_tbCalView="week";_tbCalRows=true;_tbHydrateQueue=[]');
    s.ok('a phone never draws it',!/tb-personweek/.test(p.run('_tbCalendar()')));
  }

  s.section('on a phone a pill is HELD, not dragged');
  {
    // Spec s11: drag & drop replaced by a move-to date picker on
    // long-press. A 4px threshold aimed at a ~50px day square is not a
    // gesture a thumb can land.
    const a=catchToasts(loadApp({files:FILES,currentPage:'tb-calendar',phone:true}));
    a.run('session='+J(AMMAR));
    a.run('userProfiles=[{uid:"u-ammar",username:"ammar",displayName:"Ammar"}]');
    a.run('tbLists=[];tbLoaded=true;_tbLoadErrors=[];tbConfig=null');
    a.run('tbItems=[tbDecodeItem({id:"i1",title:"pricing tiers",ownerUid:"u-ammar",'
      +'assigneeUids:["u-ammar"],visibility:"shared",date:"2026-10-17"})]');
    a.run('globalThis.__captured=0;globalThis.__el={classList:{add(){},remove(){}},'
      +'setPointerCapture(){__captured++;}}');
    const down=()=>a.run('window.tbPillDown({button:0,pointerId:1,clientX:10,clientY:10,'
      +'currentTarget:__el,preventDefault(){},stopPropagation(){}},"i1")');
    const fire=(t,e)=>((a.state.listeners[t]||[]).slice()
      .forEach(f=>f(Object.assign({type:t,pointerId:1,clientX:10,clientY:10,
        preventDefault(){},stopPropagation(){}},e||{}))));
    // A tap that ends before the hold is just a tap.
    down();
    fire('pointerup');
    await new Promise(r=>setTimeout(r,560));
    s.eq('a tap opens no sheet',a.run('_tbMoveId'),null);
    s.eq('and never captures the pointer',a.run('__captured'),0);
    a.run('window.tbPillClick({preventDefault(){}},"i1")');
    s.eq('so the tap still opens the drawer',a.run('_tbOpenItemId'),'i1');
    a.run('window.tbCloseItem()');
    // A hold opens the date picker.
    down();
    await new Promise(r=>setTimeout(r,560));
    s.eq('a hold opens the move sheet',a.run('_tbMoveId'),'i1');
    s.eq('with no drag anywhere in it',a.run('__captured'),0);
    s.ok('and a buzz to say it landed',(a.state.vibrations||[]).length>0);
    const sheet=a.run('_tbMoveSheet()');
    s.ok('the sheet offers a date',/id="tb-move-date"/.test(sheet));
    s.ok('and the three answers people actually want',
      /today/.test(sheet)&&/tomorrow/.test(sheet)&&/next week/.test(sheet));
    a.run('window.tbCloseMove()');
    fire('pointerup');
    // A finger that travels is a scroll, not a hold.
    down();
    fire('pointermove',{clientX:60,clientY:60});
    await new Promise(r=>setTimeout(r,560));
    s.eq('a finger that moves cancels the hold',a.run('_tbMoveId'),null);
    fire('pointerup');
    // The lock is checked before the sheet, not after. AMMAR IS A BOARD
    // OWNER and overrides any lock -- the premise phases 3 and 4 both had
    // to correct. Daniyal is who the refusal is for.
    a.run('tbItems[0].locked=true;tbItems[0].lockedBy="u-afnan"');
    a.run('userProfiles.push({uid:"u-afnan",username:"afnan",displayName:"Afnan"})');
    a.run('session='+J(DANIYAL));
    a.run('window.tbOpenMove("i1")');
    s.eq('a locked pill opens no sheet',a.run('_tbMoveId'),null);
    s.ok('and says who holds it',toastsOf(a).some(t=>/locked by Afnan/.test(t)));
  }

  return s;
};

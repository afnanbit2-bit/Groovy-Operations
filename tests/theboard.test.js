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
    // Every class token is either tb-*, or one of the app's OWN component
    // classes reused on purpose (spec rule 2: match conventions, do not
    // invent a second UI vocabulary). Anything else is a namespace nobody
    // agreed to -- and a `board-` token is the collision this prefix exists
    // to prevent.
    const REUSED=['btn-outline','btn-primary','empty','card','section-title'];
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
    s.ok('and shows no empty cards',!/tb-cardh/.test(bare));
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
    const src=read('scripts/seed-board.js');
    const chunk=Number((/i\+=(\d+)\)\s*\{[\s\S]{0,40}?db\.batch/.exec(src)||[])[1]||0);
    s.ok('it writes in batches within the Firestore limit',chunk>0&&chunk<=500,chunk);
    s.ok('a dry run is the default; writing needs --write',
      /--write/.test(src)&&/Dry run\. Nothing was written/.test(src));
  }

  return s;
};

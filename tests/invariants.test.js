/* ─────────────────────────────────────────────────────────────────────────
   Project invariants.

   These encode the "three places or it breaks" footguns CLAUDE.md warns
   about, plus the credential rules. They need no DOM and no Firebase —
   they read the repo. Cheap, fast, and they catch the class of mistake
   that has actually cost this project time.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {suite,ROOT}=require('./harness');

const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const exists=f=>fs.existsSync(path.join(ROOT,f));

module.exports=function(){
  const s=suite('invariants');

  const indexHtml=read('index.html');
  const sw=read('sw.js');
  const css=read('css/main.css');
  const jsFiles=fs.readdirSync(path.join(ROOT,'js')).filter(f=>f.endsWith('.js')).sort();

  // ── Adding a /js/*.js file: script tag + PRECACHE_URLS + CACHE_VERSION ──
  // CLAUDE.md, "Adding a new /js/*.js file": three places, or it breaks
  // offline. Two of the three are checkable here.
  s.section('every js module is wired into the shell and the service worker');
  jsFiles.forEach(f=>{
    s.ok(f+' has a <script> tag in index.html',
      indexHtml.indexOf('/js/'+f)!==-1);
    s.ok(f+' is in sw.js PRECACHE_URLS',
      new RegExp("'/js/"+f.replace('.','\\.')+"'").test(sw));
  });

  s.section('nothing is precached that does not exist');
  const precache=(/const PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/.exec(sw)||[,''])[1];
  precache.split('\n').map(l=>(/'([^']+)'/.exec(l)||[])[1]).filter(Boolean).forEach(u=>{
    if(u==='/')return;                       // the app shell, served by index.html
    s.ok('precached '+u+' exists on disk',exists(u.replace(/^\//,'')));
  });

  // ── Credentials — never in client code (CLAUDE.md) ─────────────────────
  s.section('no credentials in client code');
  const auth=read('js/auth.js');
  s.ok('USER_DEFS carries no pass: field',!/\bpass\s*:/.test(auth),
    /\bpass\s*:/.test(auth)?'found a pass: in js/auth.js':undefined);
  jsFiles.concat(['index.html']).forEach(f=>{
    const src=f.endsWith('.html')?indexHtml:read('js/'+f);
    // A service-account private key or a Shopify secret must never appear
    // in a file that is served to anyone who visits.
    s.ok(f+' has no private key block',src.indexOf('BEGIN PRIVATE KEY')===-1);
    s.ok(f+' has no Shopify secret literal',!/shpss_|shpat_/.test(src));
  });

  // ── Everything parses ──────────────────────────────────────────────────
  s.section('every shipped file parses');
  jsFiles.forEach(f=>{
    let okParse=true,err='';
    try{new Function(read('js/'+f));}catch(e){okParse=false;err=e.message;}
    s.ok('js/'+f+' parses',okParse,okParse?undefined:err);
  });
  s.ok('css/main.css braces balance',
    (css.match(/{/g)||[]).length===(css.match(/}/g)||[]).length,
    (css.match(/{/g)||[]).length+' open vs '+(css.match(/}/g)||[]).length+' close');
  s.ok('firestore.rules braces balance',(()=>{
    const r=read('firestore.rules');
    return (r.match(/{/g)||[]).length===(r.match(/}/g)||[]).length;
  })());
  let manifestOk=true;
  try{JSON.parse(read('manifest.json'));}catch(e){manifestOk=false;}
  s.ok('manifest.json is valid JSON',manifestOk);
  let dbRulesOk=true;
  try{JSON.parse(read('database.rules.json'));}catch(e){dbRulesOk=false;}
  s.ok('database.rules.json is valid JSON',dbRulesOk);

  // ── Runtime libraries are served from this origin, not a CDN ───────────
  // A cross-origin <script> is network-first in sw.js, so it silently does
  // not arrive with no signal — which is why PDF and Excel export used to
  // fail offline. Vendored files live in assets/vendor (see its README) and
  // are precached like everything else. A CDN URL is allowed ONLY inside an
  // onerror fallback attribute, never as a src.
  s.section('no runtime library loads from a CDN');
  const CDN=/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com)/;
  fs.readdirSync(ROOT).filter(f=>f.endsWith('.html')).forEach(f=>{
    const src=read(f);
    const srcAttrs=(src.match(/<script[^>]*\ssrc\s*=\s*"([^"]+)"/g)||[])
      .map(t=>(/src\s*=\s*"([^"]+)"/.exec(t)||[])[1]);
    const offenders=srcAttrs.filter(u=>CDN.test(u));
    s.ok(f+' loads no script src from a CDN',!offenders.length,
      offenders.length?offenders.join(', '):undefined);
  });
  fs.readdirSync(path.join(ROOT,'assets','vendor'))
    .filter(f=>f.endsWith('.js')).forEach(f=>{
      s.ok('vendored '+f+' is referenced by index.html',
        indexHtml.indexOf('/assets/vendor/'+f)!==-1);
      s.ok('vendored '+f+' carries its version in the filename',
        /-\d+\.\d+\.\d+[.-]/.test(f));
      const lic='assets/vendor/'+f.replace(/(\.(umd|full|all))?(\.min)?\.js$/,'.LICENSE');
      s.ok('vendored '+f+' ships its licence',exists(lic),exists(lic)?undefined:'missing '+lic);
    });

  // ── Realtime Database stays read-only from the browser (CLAUDE.md) ──────
  // Every RTDB write comes from netlify/functions/iclock.js via the Admin
  // SDK. If a client write function ever gets imported, ".write": false
  // stops being merely correct and starts breaking a feature silently.
  s.section('the browser never writes to RTDB');
  const rtdbImport=(/from'https:\/\/www\.gstatic\.com\/firebasejs\/[^']*firebase-database\.js'/.test(indexHtml))
    ? (/import\{([^}]*)\}from'https:\/\/www\.gstatic\.com\/firebasejs\/[^']*firebase-database\.js'/.exec(indexHtml)||[,''])[1]
    : '';
  s.ok('no set/update/push imported from firebase-database',
    !/\b(set|update|push)\b\s*(as|,|})/.test(rtdbImport.replace(/\bas\s+\w+/g,m=>m)),
    rtdbImport.trim());
  const dbRules=read('database.rules.json');
  s.ok('database.rules.json still denies client writes',/"\.write"\s*:\s*false/.test(dbRules));

  // ── Firestore rules cover every collection the client reads ────────────
  // A collection queried in js/*.js but absent from firestore.rules is
  // denied outright at runtime — the Stage 6 failure mode that left the
  // Mood Boards gallery stuck on a skeleton.
  s.section('every collection the client uses has a rule');
  const rules=read('firestore.rules');
  const used=new Set();
  jsFiles.forEach(f=>{
    const src=read('js/'+f);
    let m;const re=/collection\(\s*db\s*,\s*'([A-Za-z0-9_]+)'/g;
    while((m=re.exec(src)))used.add(m[1]);
    const re2=/doc\(\s*db\s*,\s*'([A-Za-z0-9_]+)'/g;
    while((m=re2.exec(src)))used.add(m[1]);
  });
  Array.from(used).sort().forEach(c=>{
    s.ok("collection '"+c+"' has a match block",
      new RegExp('match /'+c+'/').test(rules));
  });

  // ── The Comfortable type scale reaches the canvas too ──────────────────
  // The Sept 2026 sweep moved the whole app to Comfortable with f(x) =
  // x<11 ? 11 : x+1, applied by script to every literal `font-size:<n>px`.
  // The PNG/PDF exporter in js/boards.js does NOT declare CSS — it draws
  // with `ctx.font`, which that pattern structurally cannot match, so all
  // seventeen of its sizes were missed and seven sat BELOW the 11px floor
  // (down to 8px). The exporter translates into WORLD coordinates, the same
  // unit a card's CSS font-size uses, so the two are directly comparable
  // and had silently drifted: 13.5px on screen against 12px in the export.
  // The next mechanical sweep will miss these again; this is what notices.
  s.section('the type scale reaches the export canvas');
  {
    const src=read('js/boards.js');
    const sizes=(src.match(/ctx\.font=[^;]*/g)||[])
      .join(' ').match(/([0-9.]+)px/g)||[];
    s.ok('the exporter still draws text at all',sizes.length>0,sizes.length+' sizes');
    const under=sizes.filter(x=>parseFloat(x)<11);
    s.eq('none below the 11px floor Afnan approved',under.join(',')||'none','none');
  }

  // ── Card text has its own, higher floor ────────────────────────────────
  // The app-wide Comfortable floor is 11px, and that is right for CHROME.
  // Card internals are the one place it is not: everything inside
  // .board-world is multiplied by the board ZOOM, so an 11px label is 11px
  // only at exactly 100%. Afnan reads boards at 84%, where it renders at
  // 9.2px — reported as "the text starting this board has 8 cards are too
  // small cant read them". Card-internal text therefore floors at 13px,
  // which is ~11px at 84% and still ~10px at 75%.
  //
  // A future mechanical sweep will see these as ordinary sizes and may
  // treat 11 as acceptable again; this is what notices.
  s.section('card-internal text holds a 13px floor');
  {
    // `.link-title`/`.link-desc`/`.link-url` are card-internal too and do NOT
    // start with .board- — they slipped this check until the link-preview
    // round found .link-url still sitting at 11px.
    const CARD_SEL=/^\.(board-(card|subboard|label|caption|todo|text|link|frame|heading|coord)|link-(title|desc|url))[a-z-]*/;
    const offenders=[];
    css.split('}').forEach(block=>{
      const sel=(block.split('{')[0]||'').trim().split(',')[0].trim();
      if(!CARD_SEL.test(sel))return;
      const m=/font-size:([0-9.]+)px/.exec(block);
      if(m&&parseFloat(m[1])<13)offenders.push(sel+' '+m[1]+'px');
    });
    s.eq('no card rule under 13px',offenders.join(', ')||'none','none');
    // The table cell size attribute is set inline in js/boards.js, so the
    // CSS scan above cannot see it.
    const cellSizes=(/if\(cell\.sz==='s'\)out\.push\('font-size:([0-9.]+)px'\)/
      .exec(read('js/boards.js'))||[])[1];
    s.ok('the small table cell is at the floor too',
      cellSizes&&parseFloat(cellSizes)>=13,cellSizes+'px');
  }

  // ── A helper that is CALLED but never DEFINED ──────────────────────────
  // js/boards.js calls _boardsCardTrashStart(b.id) on every board open and
  // that function has never existed — the real one is _boardsTrashStart.
  // The Trash round renamed the STATE (_boardsTrash was already the
  // gallery's trashed boards) and this call site followed the state instead
  // of the function. It threw a ReferenceError on every open, and because
  // the canvas renders on the line ABOVE it and _boardsOpenCanvas is
  // dispatched from renderPage with no catch, nothing looked wrong: it
  // silently skipped the per-board activity feed, the cold-load refresh a
  // deep link needs, and the card focus a #board=…&card=… link asks for.
  //
  // node --check cannot see this — the file parses perfectly. The browser
  // smoke test cannot either, because it never opens a board. This can.
  //
  // Deliberately NOT comment-stripped first: doing that corrupts the scan
  // (a /* inside a string or a regex literal eats the rest of the file, and
  // it silently hid ten real definitions when this was written). Reading
  // comments too only risks a name mentioned in prose and defined nowhere,
  // which is a rename to make in the comment, not a reason to strip.
  s.section('every _boards* helper that is called is also defined');
  {
    const src=read('js/boards.js');
    const defined=new Set();
    (src.match(/function\s+(_boards[A-Za-z0-9_]*)/g)||[]).forEach(m=>defined.add(m.split(/\s+/)[1]));
    (src.match(/(?:const|let|var)\s+(_boards[A-Za-z0-9_]*)/g)||[]).forEach(m=>defined.add(m.split(/\s+/)[1]));
    const called=new Set();
    (src.match(/_boards[A-Za-z0-9_]*\s*\(/g)||[]).forEach(m=>called.add(m.replace(/\s*\($/,'')));
    const missing=[...called].filter(n=>!defined.has(n)).sort();
    s.eq('none missing',missing.join(', ')||'none','none');
    s.ok('and the scan actually found the file',defined.size>200&&called.size>200,
      defined.size+' defined, '+called.size+' called');
  }

  // ── The staged rollout gate (CLAUDE.md) ────────────────────────────────
  // SIX routes reach the Creative Hub module: four nav pushes in
  // js/shared.js, the "Me" page button in js/hrm.js, and the deep-link
  // guard in js/boards.js. They all call ONE helper now, so the audience is
  // a single list — but that only helps if every route actually calls it.
  // A route left behind is the same failure as before: one way in open and
  // another shut, with nothing on screen to say which.
  s.section('staged rollout gate');
  const stripComments=src=>src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n]*/g,'$1');
  const GATE_FILES=['js/shared.js','js/hrm.js','js/boards.js'];
  // The lookbehind drops the DECLARATION, whose `function _canSeeCreativeHub()`
  // otherwise counts as a seventh call and quietly absorbs a route that
  // went missing.
  const calls=GATE_FILES
    .map(f=>(stripComments(read(f)).match(/(?<!function\s)_canSeeCreativeHub\(\)/g)||[]).length)
    .reduce((a,b)=>a+b,0);
  // 6 in shared.js (the four nav pushes, plus the CSR Team Lead's sidebar and
  // phone More sheet) + 1 in hrm.js + 1 in boards.js.
  s.eq('every Creative Hub route goes through the one helper',calls,8);
  const sharedSrc=stripComments(read('js/shared.js'));
  s.ok('and the helper is defined in js/shared.js, which loads first',
    /function\s+_canSeeCreativeHub\s*\(/.test(sharedSrc));
  // The audience itself. Deliberately asserted by name: widening it is a
  // decision, and this is what makes it show up in a diff review.
  const hubList=(sharedSrc.match(/_CREATIVE_HUB_USERS\s*=\s*\[([^\]]*)\]/)||[])[1]||'';
  const hubNames=(hubList.match(/'([^']+)'/g)||[]).map(x=>x.replace(/'/g,''));
  s.eq('the Creative Hub audience is afnan, ammar, sami',hubNames.join(','),'afnan,ammar,sami');
  // Nothing may still gate the hub on a bare username — that is the shape
  // the helper replaced, and a leftover would silently outrank it.
  const strays=GATE_FILES
    .map(f=>(stripComments(read(f)).match(/session\.u\s*[!=]==\s*'afnan'/g)||[]).length)
    .reduce((a,b)=>a+b,0);
  s.eq('no route still hardcodes a username',strays,0);
  // Fail CLOSED: the two files that reach across for the helper must guard
  // with typeof, so a shared.js that failed to parse hides the hub rather
  // than opening the side door.
  ['js/hrm.js','js/boards.js'].forEach(f=>{
    s.ok(f+' guards the cross-file call with typeof',
      /typeof\s+_canSeeCreativeHub\s*[!=]==\s*'function'/.test(stripComments(read(f))));
  });

  // ── The profile admin grant lives in three places (CLAUDE.md) ──────────
  // js/profile.js decides what the UI offers, firestore.rules decides
  // whether the write lands, and admin-reset-password.js decides whether
  // the password changes. Two of the three are real boundaries and the
  // third is only a button — so they must name the same people, and the
  // one that is easiest to forget is the server function nobody looks at.
  s.section('the profile admin grant agrees across all three layers');
  {
    const prof=read('js/profile.js');
    const fn=read('netlify/functions/admin-reset-password.js');
    const admins=(prof.match(/const _PROFILE_ADMINS=\[([^\]]*)\]/)||[])[1]||'';
    const prot=(prof.match(/const _PROFILE_PROTECTED=\[([^\]]*)\]/)||[])[1]||'';
    const names=t=>(t.match(/'([a-z]+)'/g)||[]).map(x=>x.replace(/'/g,'')).sort();
    const adminNames=names(admins), protNames=names(prot);
    s.eq('the client grants exactly afnan, ammar, mustafa',
      adminNames.join(','),'afnan,ammar,mustafa');
    s.eq('and protects exactly the two owners',
      protNames.join(','),'afnan,ammar');
    // The rules must carry the same three, by name, and must not have been
    // widened to isManager() — Arfat holds that role and gets none of this.
    const block=(rules.match(/match \/user_profiles\/\{uid\}[\s\S]*?\n    \}/)||[''])[0];
    s.ok('the rules let owners and Mustafa update someone else',
      /isOwner\(\)\s*\|\|\s*isMustafa\(\)/.test(block));
    s.ok('the rules stop Mustafa at an owner',
      /isMustafa\(\)[\s\S]*?in \['afnan','ammar'\]/.test(block));
    s.ok('the rules never widen it to isManager()',!/isManager\(\)/.test(block));
    s.ok('an admin update cannot relabel a profile as someone else',
      /request\.resource\.data\.username\s*==\s*resource\.data\.get\('username'/.test(block));
    s.ok('create is still self-only',
      /allow create:[\s\S]*?uid\s*==\s*request\.auth\.uid/.test(block));
    // The server function is the real boundary for the password half.
    s.ok('the function grants Mustafa a reset',/RESET_ADMIN_EMAILS\s*=\s*\[\s*"mustafa@groovy\.op"/.test(fn));
    // The seeding function is the second server-side door into profiles and
    // has to be gated the same way — it writes user_profiles with the Admin
    // SDK, which bypasses firestore.rules entirely.
    const seed=read('netlify/functions/admin-seed-profiles.js');
    s.ok('the seeder verifies the caller server-side',/verifyIdToken/.test(seed));
    s.ok('and gates on the same two lists',
      /OWNER_EMAILS\s*=\s*\["afnan@groovy\.op",\s*"ammar@groovy\.op"\]/.test(seed)
      &&/SEED_ADMIN_EMAILS\s*=\s*\[\s*"mustafa@groovy\.op"\s*\]/.test(seed));
    s.ok('it never trusts a role sent by the client',!/body\.role|body\.isOwner/.test(seed));
    // Line-based, not one clever regex: a payload containing Date.now()
    // has a ")" in it, which a lazy character class stops at — the first
    // attempt at this passed nothing and would have "failed" correct code.
    const setLines=seed.split('\n').filter(l=>l.indexOf('.set(')>-1);
    s.ok('the seeder writes at all',setLines.length>0);
    s.ok('and every write MERGES, so a real profile is never reset',
      setLines.every(l=>/merge:\s*true/.test(l)),setLines.join(' | '));
    s.ok('and refuses him an owner',/PROTECTED_EMAILS\.includes\(target\)/.test(fn));
    s.ok('while still verifying the caller server-side',/verifyIdToken/.test(fn));
    s.ok('and it never trusts a role sent by the client',!/body\.role|body\.isOwner/.test(fn));
  }

  // ── Dark mode is tokens, never a filter ────────────────────────────────
  // A non-none `filter` on <html>/<body> makes it the containing block for
  // every position:fixed descendant, which would break the board canvas
  // takeover, the bug FAB and every modal. The theme must therefore only
  // redefine custom properties.
  s.section('dark mode');
  {
    const css=read('css/main.css');
    s.ok('there is a dark token block',/html\[data-theme="dark"\]\{/.test(css));
    s.ok('the theme is stamped before the stylesheet loads',
      read('index.html').indexOf("setAttribute('data-theme'")<read('index.html').indexOf('css/main.css'));
    s.ok('no filter on html or body',
      !/(^|\})\s*(html|body)[^{}]*\{[^{}]*filter:/.test(css.replace(/\n/g,'')));
    s.ok('diagnostics.js still uses literal colours, not tokens',
      !/var\(--(surface|text|border|bg)\)/.test(read('js/diagnostics.js')));
    s.ok('so does print-engine.js (PDF output has no CSS)',
      !/style="[^"]*var\(--/.test(read('js/print-engine.js')));
  }

  // ── Role scoping must never swallow a chrome page ─────────────────────
  // The fulfilment account is scoped to one page by REWRITING every id in
  // showPage. That swallowed the topbar avatar: showPage('profile') became
  // showPage('fulfillment'), so the page did not change, nothing was
  // logged, no request was made, and there was no way to tell "blocked"
  // from "broken". Reported by Afnan from a real account; reproduced and
  // fixed by exempting the pages reached from the app chrome.
  s.section('role scoping vs the pages reached from the app chrome');
  {
    const {loadApp}=require('./harness');
    function nav(role,ids){
      // shared.js declares its OWN top-level `let session`, which shadows a
      // context global — so it has to be assigned inside the vm after load.
      const app=loadApp({files:['js/shared.js'],currentPage:'fulfillment'});
      app.run('session='+JSON.stringify({uid:'u',u:'x',name:'X',role,title:'T',email:'x@groovy.op'}));
      app.run('renderPage=function(id){globalThis.__got=id;}');
      const out={};
      ids.forEach(id=>{
        app.run('globalThis.__got=null');
        app.run('window.showPage('+JSON.stringify(id)+')');
        out[id]=app.run('__got');
      });
      return out;
    }
    const f=nav('fulfillment',['profile','bug-tracker','dashboard','users','fulfillment']);
    s.eq('the avatar reaches Profile',f['profile'],'profile');
    s.eq('and the notification panel reaches the bug tracker',f['bug-tracker'],'bug-tracker');
    // The scoping itself must survive — this is a fix, not a removal.
    s.eq('but the dashboard is still scoped away',f['dashboard'],'fulfillment');
    s.eq('and so is any other page',f['users'],'fulfillment');
    s.eq('its own page still works',f['fulfillment'],'fulfillment');

    const o=nav('owner',['profile','bug-tracker','dashboard','users']);
    s.ok('an owner is redirected nowhere',
      Object.keys(o).every(k=>o[k]===k),JSON.stringify(o));

    // Every page named in _CHROME_PAGES must actually be dispatchable, or
    // the exemption just swaps one silent no-op for another.
    const src=read('js/shared.js');
    const list=(src.match(/const _CHROME_PAGES=\[([^\]]*)\]/)||[])[1]||'';
    const pages=(list.match(/'([a-z-]+)'/g)||[]).map(x=>x.replace(/'/g,''));
    s.ok('_CHROME_PAGES is not empty',pages.length>0,JSON.stringify(pages));
    pages.forEach(pg=>{
      s.ok("renderPage can actually render '"+pg+"'",
        new RegExp("id==='"+pg+"'").test(src));
    });
  }

  // ── A dblclick on a DESCENDANT of a drag surface needs the guard ───────
  // boardsCardDragStart calls setPointerCapture, and a captured pointer
  // RETARGETS the following click and dblclick to the capturing element.
  // A card whose ondblclick sits on the very element carrying the drag
  // handler survives that (a note, a heading, an image body); one whose
  // handler sits on a DESCENDANT does not — its handler simply never runs.
  // That has now cost the delete X, the file card, a table cell, the link
  // title and, Sept 2026, every to-do item: double-clicking one did
  // nothing, and the dblclick bubbled to the stage instead. So: any tag
  // that carries an ondblclick must either BE the drag element (it holds
  // the bodyDrag interpolation) or stop pointerdown itself.
  s.section('ondblclick inside a drag surface');
  {
    const src=read('js/boards.js');
    // Deliberate exceptions: elements that are not inside a drag surface at
    // all, so there is no capture to escape. The caption sits OUTSIDE the
    // card body, has no drag handler, and opens on a single click.
    const EXEMPT=['board-caption'];
    const tags=src.match(/<[a-zA-Z][^<>]*ondblclick[^<>]*>/g)||[];
    s.ok('js/boards.js still wires double-clicks',tags.length>0,tags.length+' sites');
    tags.forEach(t=>{
      const cls=(t.match(/class="([a-z-]+)/)||[])[1]||t.slice(0,40);
      if(EXEMPT.indexOf(cls)>=0)return;
      s.ok('.'+cls+' is the drag element or stops pointerdown',
        t.indexOf('onpointerdown')>=0||t.indexOf('bodyDrag')>=0,
        t.slice(0,110));
    });
  }

  return s;
};

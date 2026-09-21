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

  // ── Chart text is never inside a scaled SVG ────────────────────────────
  // The Reports charts first drew their labels into one
  // <svg viewBox="0 0 720 H"> sized width:100%. Text inside a scaled SVG
  // is in VIEWBOX units, not CSS pixels, so the browser multiplies it by
  // whatever the scale happens to be. MEASURED in headless Chromium: at a
  // 1900px window the SVG rendered 1818px against the 720 viewBox — 2.53×,
  // so a 13px label painted at ~33px, which is what Ammar reported. At
  // 420px the same label painted at ~8px, the same bug erring small.
  // Bars are geometry and may be proportional; TEXT must be real HTML.
  s.section('chart text is HTML, never inside a scaled SVG');
  {
    const src=read('js/marketing.js');
    const charts=(src.match(/function mktChart(Bars|HBars)\([\s\S]*?\n\}/g)||[]);
    s.eq('both chart builders were found',charts.length,2);
    charts.forEach(fn=>{
      const name=(/function (mktChart\w+)/.exec(fn)||[])[1];
      s.ok(name+' emits no <svg>',!/<svg/.test(fn));
      s.ok(name+' emits no viewBox',!/viewBox/.test(fn));
      s.ok(name+' emits no <text> element',!/<text[ >]/.test(fn));
    });
    // A chart is chrome, so every colour is a token — a literal hex is the
    // dark-mode bug this codebase keeps shipping.
    const palette=(/const _MKT_SERIES=\[([\s\S]*?)\];/.exec(src)||['',''])[1];
    s.ok('the series palette is all CSS variables',
      /var\(--/.test(palette)&&!/#[0-9a-f]{3,6}/i.test(palette),palette.replace(/\s+/g,' ').trim());
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
  /* No card has a header strip (Sept 2026, from the second Milanote
     video). The head is an overlay floating over the card's own first row,
     so three rules are load-bearing and each was verified by breaking it. */
  s.section('the head strip is an inert overlay');
  {
    const css=fs.readFileSync(path.join(ROOT,'css/main.css'),'utf8');
    const head=(css.match(/\n\.board-card-head\{[^}]*\}/)||[''])[0];
    s.ok('it is absolutely positioned over the card',/position:absolute/.test(head),head.slice(0,80));
    // THE ONE THAT MATTERS: anything the bar captures is a click somebody
    // aimed at the content underneath. smoke-layout caught it eating a link
    // card's URL field; only the delete button may take events.
    s.ok('and it takes no pointer events itself',/pointer-events:none/.test(head),head.slice(0,120));
    s.ok('exactly one control in it is re-enabled',
      /\.board-card-head \.board-card-del\{pointer-events:auto\}/.test(css));
    // It becomes one only while an explicit rename has switched it on.
    s.ok('the card name is a label until a rename switches it on',
      /\.board-card-name\[contenteditable="true"\]\{pointer-events:auto\}/.test(css)&&
      !/\.board-card-name\{[^}]*pointer-events:auto/.test(css));
    const js=fs.readFileSync(path.join(ROOT,'js/boards.js'),'utf8');
    s.ok('and it carries no click handler in the markup',
      !/board-card-name[^>]{0,400}?on(click|dblclick)=/.test(js));
    // The head's own ✕ lands on a to-do's first-row ✕, and the two mean
    // very different things. The centres happen not to overlap, so the
    // layout probe does NOT hold this one — this is what does.
    s.ok('a to-do first row yields its ✕ while the strip shows',
      /\.board-card-el\.selected \.board-todo-body>\.board-todo-row:first-child \.board-todo-del\{display:none\}/.test(css));
    // The coloured top strip is its own bar, so a card can carry both.
    s.ok('the colour strip is not the head background',
      /\.board-card-el::before\{content:''/.test(css)&&!/\.board-card-el\.tint-[a-z]+ \.board-card-head\{/.test(css));
    // The dot grid is a placement cue, not the canvas background.
    s.ok('the dot grid is scoped to .grid-on',
      /\.board-stage\.grid-on\{background-image:radial-gradient/.test(css));
    const stage=(css.match(/\n\.board-stage\{[^}]*\}/)||[''])[0];
    s.ok('and the stage carries none at rest',!/background-image/.test(stage),stage.slice(0,120));
  }

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

  /* ── "Drag me" is offered only by drag sources ───────────────────────
     The rail's hover cue is a tooltip now (read off Afnan's video of
     Milanote: the icon does not move, a bubble fades in beside it). It
     advertises a gesture, so a tool that places nothing (Line, Add image,
     Upload) must never show it. The layout probe cannot hover, so the
     scope is held here: the only thing that shows the tip is gated on
     data-drag="1", both where it is armed and where it is drawn, and the
     old ::after cue is gone rather than left beside it. */
  s.section('the rail "Drag me" tip stays on draggable tools only');
  {
    const js=read('js/boards.js'),css=read('css/main.css');
    s.ok('the tip exists in the stylesheet',/\.board-rail-tip\{/.test(css));
    s.ok('arming it requires a data-drag button',
      /closest\('\[data-act\]\[data-drag="1"\]'\);\s*if\(btn\)_boardsRailTipArm\(btn\)/.test(js));
    s.ok('and drawing it re-checks data-drag',
      /function _boardsRailTipShow\(btn\)\{\s*if\(!btn\|\|!btn\.getAttribute\|\|btn\.getAttribute\('data-drag'\)!=='1'\)return false;/.test(js));
    const after=(css.match(/^[^{}\n]*::after\s*\{/gm)||[]).filter(r=>/\.rail-btn/.test(r));
    s.eq('the old slide-out ::after cue is gone',after.join(' | ')||'none','none');
    // The class only reaches the DOM for entries carrying drag:true.
    s.ok('which js/boards.js only emits for a drag source',
      /it\.drag\?' data-drag="1"':''/.test(js));
  }

  /* ── The image card's three tools (Sept 2026) ──────────────────────────
     Draw on · Edit · Background. Three things that can only be checked
     against the source, and each is a shape this file has been bitten by.
     The overlay's z-index has to stay under the head strip's (4) so the
     delete ✕ is still reachable, and over the card body — the "the whole
     top bar was invisible behind a wrong z-index" class of bug. A stroke's
     points must never be written as pairs: Firestore refuses a nested
     array outright, which is how table content silently never persisted. */
  s.section('draw on, edit and background');
  {
    const js=read('js/boards.js'),css=read('css/main.css');
    // The strokes go into the cards array, which goes into a Firestore
    // document. Nothing here may build a [[x,y],…].
    s.ok('a stroke pushes NUMBERS, never a point array',
      /stroke\.p\.push\(q\[0\],q\[1\]\)/.test(js)&&!/stroke\.p\.push\(q\)/.test(js));
    s.ok('and it is seeded flat too',/p:\[first\[0\],first\[1\]\]/.test(js));
    // An <svg> is a replaced element: given top and bottom with no height
    // it takes the viewBox's intrinsic ratio instead of stretching, which
    // was MEASURED at 240 tall inside a 360 card. The div is what stretches.
    s.ok('the overlay is a div wrapping the svg, not a bare svg',
      /<div class="board-draw\$\{live\?' drawing':''\}"/.test(js));
    s.ok('and the svg fills it',/\.board-draw>svg\{display:block;width:100%;height:100%/.test(css));
    const z=/\.board-draw\{[^}]*z-index:(\d+)/.exec(css);
    s.ok('the overlay sits under the head strip, so the delete ✕ is still reachable',
      !!z&&+z[1]<4,z?z[1]:'no z-index');
    s.ok('and it is inert unless the pen is on this card',
      /\.board-draw\{[^}]*pointer-events:none\}/.test(css)&&/\.board-draw\.drawing\{pointer-events:auto/.test(css));
    // A board background goes straight into a CSS url(), so it is validated
    // on the way IN — the _profPhotoUrl rule, and an anchored host test.
    s.ok('a board background is validated before it is stored',
      /_editBoard\.bgImage=u;/.test(js)&&/const u=_boardsCoverUrl\(c\.imageUrl\);/.test(js));
    s.ok('and it is validated again on the way out of the save',
      /bgImage:_boardsCoverUrl\(_editBoard\.bgImage\)\|\|null/.test(js));
    // The board background must not fight the dot-grid cue or the pan/zoom
    // transform: its own element, inside the stage and outside the world.
    s.ok('it paints on its own element, not on .board-stage',
      /\.board-bg\{position:absolute;inset:0/.test(css)&&/id="board-bg"/.test(js));
    s.ok('and that element is inert',/\.board-bg\{[^}]*pointer-events:none/.test(css));
    // Background removal is a Cloudinary add-on nobody can check from here,
    // so the failure has to clear the flag rather than leave a broken card.
    s.ok('a refused background removal clears the flag',
      /window\.boardsNoBgFailed=function/.test(js)&&/delete c\.nobg;/.test(js));
  }

  /* ── The rail's hover tiles name real actions, and never invert ─────────
     Each tool's icon fills a coloured tile on hover, keyed by its data-act.
     A renamed act would silently lose its colour — the dead-hover shape
     nothing on screen reports — so every selector must name an act that
     js/boards.js emits. The tile carries a LITERAL white glyph, so its
     --tool-* token must not be redefined for dark mode (the --count-accent
     rule). And the large tier is by viewport HEIGHT and desktop WIDTH: the
     phone dock's height is what the bottom stack is built off. */
  s.section('the rail hover tiles');
  {
    const css=read('css/main.css'),js=read('js/boards.js');
    const acts=new Set((js.match(/act:'([^']+)'/g)||[]).map(m=>m.slice(5,-1)));
    const hovered=[...css.matchAll(/\.rail-btn\[data-act="([^"]+)"\]:hover svg/g)].map(m=>m[1]);
    s.ok('hover colours exist',hovered.length>=10,hovered.length+' selectors');
    s.eq('and every one names an act the rail emits',
      hovered.filter(a=>!acts.has(a)).join(',')||'none','none');
    const tokens=[...css.matchAll(/--tool-[a-z]+:/g)].map(m=>m[0]);
    s.ok('the tile tokens are declared',tokens.length>=13,tokens.length+' declarations');
    const dark=css.slice(css.indexOf('html[data-theme="dark"]{'),css.indexOf('color-scheme:dark}'));
    s.eq('and none is redefined for dark mode (literal white sits on them)',
      (dark.match(/--tool-[a-z]+:/g)||[]).join(',')||'none','none');
    const tier=/@media \(min-width:561px\) and \(min-height:(\d+)px\)\{\s*\.board-rail\{width:92px/.exec(css);
    s.ok('the large rail is scoped to desktop width AND a viewport height',!!tier,tier?tier[1]+'px':'no tier');
    s.ok('and the tile changes no layout (padding cancelled by margin)',
      /\.rail-btn svg,\.rail-btn \.rail-glyph\{box-sizing:content-box;padding:5px;margin:-5px/.test(css));
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
  s.eq('the Creative Hub audience is afnan, ammar, sami, mustafa',
    hubNames.join(','),'afnan,ammar,sami,mustafa');
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

  /* ── The column's head height lives in TWO files and must agree ───────
     _BOARDS_COL_HEAD (js/boards.js) is what the first child is laid out
     below; .board-column-body's `top` (css/main.css) is where the drop
     zone starts. They describe the same edge of the same box, so a header
     redesign that moves one and not the other either paints the panel over
     the first card or leaves a band of dead space above it — and neither
     shows up in a logic suite. The number itself is MEASURED against the
     real stylesheet by scratchpad/measure-column.js. */
  s.section('the column head height agrees across js and css');
  {
    const js=read('js/boards.js'),css=read('css/main.css');
    const head=/_BOARDS_COL_HEAD=(\d+)/.exec(js);
    // [;{]top: on purpose — a greedy [^}]*top: matches the `top` in
    // `border-top:1px` further along the same rule and reads 1.
    const top=/\.board-column-body,\.board-frame-body\{[^}]*?[;{]top:(\d+)px/.exec(css);
    s.ok('_BOARDS_COL_HEAD is declared',!!head,head&&head[1]);
    s.ok('the body panel declares a top',!!top,top&&top[1]);
    s.eq('and they are the same number',head&&head[1],top&&top[1]);
    // A FRAME wears the same title block, so its header must come from the
    // same rules — two copies would drift the first time one was edited,
    // and the frame's head would then sit at a different height from the
    // constant that lays its contents out.
    s.ok('the frame shares the column head rule',
      /\.board-column-head,\.board-frame-head\{/.test(css));
    s.ok('and the title rule',/\.board-column-title,\.board-frame-title\{/.test(css));
    s.ok('and the count rule',/\.board-column-count,\.board-frame-count\{/.test(css));
    // An empty column IS the drop target, so it has to be bigger than its
    // own header by enough to aim a card at.
    const min=/_BOARDS_COL_MIN_H=(\d+)/.exec(js);
    s.ok('an empty column leaves at least 80px of drop zone',
      min&&head&&(+min[1]-+head[1])>=80,min&&head&&(+min[1]-+head[1])+'px');
  }

  /* ── A CARD IS GRABBABLE, AND ITS CONTROLS ARE STILL CLICKABLE ────────
     These two used to be in tension and the tension is what shipped bugs.

     boardsCardDragStart USED TO call setPointerCapture on the pointerdown,
     and a captured pointer RETARGETS the click and dblclick that follow to
     the capturing element — so a press that never became a drag stole the
     click from whatever was actually pressed. That cost the delete X, the
     file card's Open, a table cell, the link title and every to-do item,
     five times under five names, and each was patched by hanging an
     onpointerdown stopPropagation guard on the descendant.

     Then the guards became the bug. The head strip is an absolute overlay
     across the card's first row and is pointer-events:none, so a press on
     it falls through to that row — and on a to-do card the row is the task
     text, which carried one of those guards. Measured with the real
     stylesheet: 42% of the strip started a drag, and none of its middle.
     Afnan: "to do not moving properly".

     So the capture is LAZY now, and that is what is guarded here: a press
     that stays put never captures, so a descendant's dblclick is never
     retargeted and text needs no guard. Real CONTROLS keep theirs, for a
     different reason that still holds — a drag must not begin on something
     you are in the middle of pressing, and dragging to select the text in
     a field must not move the card. */
  s.section('the card drag captures lazily, and controls still guard');
  {
    const src=read('js/boards.js');
    const fn=src.slice(src.indexOf('window.boardsCardDragStart=function'),
                       src.indexOf('window.boardsResizeStart=function'));
    s.ok('boardsCardDragStart is found',fn.length>500,fn.length+' chars');
    // The CALL, not the prose: the comment above it names the function
    // while explaining why it no longer runs at pointerdown.
    const cap=fn.indexOf('setPointerCapture('),thresh=fn.indexOf('_BOARDS_DRAG_PX');
    s.ok('it takes the pointer only after the drag threshold',
      cap>-1&&thresh>-1&&cap>thresh,'threshold at '+thresh+', capture at '+cap);
    s.ok('and tracks on the document, since nothing is captured up front',
      /document\.addEventListener\('pointermove'/.test(fn));

    // The head strip cannot run a handler, so it must not carry one — a
    // dead grip reads in review exactly like a working one.
    const css=read('css/main.css');
    s.ok('.board-card-head is pointer-events:none',
      /\.board-card-head\{[^}]*pointer-events:none/.test(css));
    s.ok('and js/boards.js hangs no handler on it',
      !/class="board-card-head"[^>]*on[a-z]+=/.test(src),
      (src.match(/class="board-card-head"[^>]*>/)||[''])[0].slice(0,90));
    s.ok('only the delete ✕ takes pointer events back',
      /\.board-card-head \.board-card-del\{pointer-events:auto\}/.test(css));

    // Every text field a card renders. A drag beginning inside one would
    // fight selecting its contents, which is why the link card was once
    // excluded from body dragging altogether — and that exclusion left it
    // with no way to be moved at all. The guard belongs on the field.
    const cardFn=src.slice(src.indexOf('function _boardCardHTML'),
                           src.indexOf('function _boardsCardFootHTML'));
    s.ok('_boardCardHTML is found',cardFn.length>2000,cardFn.length+' chars');
    // Text fields only: a hidden <input type="file"> is a picker the card
    // never shows, and the checkbox is asserted on its own below.
    const fields=(cardFn.match(/<(?:input|textarea)\b[^<>]*>/g)||[])
      .filter(t=>/<textarea/.test(t)||!/type="/.test(t)||/type="text"/.test(t));
    s.ok('a card renders text fields',fields.length>0,fields.length+' sites');
    fields.forEach(t=>{
      const id=(t.match(/class="([a-z-]+)/)||[])[1]||t.slice(0,34);
      s.ok(id+' stops pointerdown',/onpointerdown="event\.stopPropagation\(\)"/.test(t),
        t.slice(0,110));
    });
    s.ok("and so does a to-do's checkbox",
      /<input type="checkbox"[^<>]*onpointerdown="event\.stopPropagation\(\)"/.test(cardFn));
    // Which card bodies actually carry the drag is asserted against
    // RENDERED markup in tests/boards.test.js — stronger than reading the
    // interpolation out of the source, and it caught the link card that
    // could not be moved from anywhere.
  }

  return s;
};

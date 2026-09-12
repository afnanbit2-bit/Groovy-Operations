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

  // ── The staged rollout gate (CLAUDE.md) ────────────────────────────────
  // SIX checks gate the Creative Hub module: four nav pushes in
  // js/shared.js, the "Me" page button in js/hrm.js, and the deep-link
  // guard in js/boards.js — which is written INVERTED (session.u!=='afnan')
  // and would be missed by a naive grep for the === form. They are meant to
  // be removed together at rollout, so this counts them and fails on a
  // partial removal, which would otherwise leave one route open or one
  // route shut with nothing on screen to say so.
  s.section('staged rollout gate');
  const stripComments=src=>src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n]*/g,'$1');
  const GATE_FILES=['js/shared.js','js/hrm.js','js/boards.js'];
  const gateCount=GATE_FILES
    .map(f=>(stripComments(read(f)).match(/session\.u\s*[!=]==\s*'afnan'/g)||[]).length)
    .reduce((a,b)=>a+b,0);
  s.ok('the Afnan-only gate is all-or-nothing ('+gateCount+' checks)',
    gateCount===0||gateCount===6,
    gateCount===0?'rolled out to everyone'
      :gateCount===6?'still gated to Afnan'
      :'PARTIAL — some routes open, some shut, and nothing on screen says which');

  return s;
};

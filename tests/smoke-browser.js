#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Browser smoke test.  `node tests/smoke-browser.js`

   Loads every classic script from index.html, in the real load order, in a
   real headless browser, and checks that they all execute and define what
   the rest of the app expects. Then exercises each vendored library for
   real: jsPDF writes a PDF, SheetJS writes a workbook, JsBarcode draws.

   THIS WAS IMPOSSIBLE BEFORE THE LIBRARIES WERE VENDORED. jsPDF, SheetJS
   and JsBarcode loaded from cdnjs/jsdelivr, which the build sandbox cannot
   reach, so the page never got past its static HTML. Served from this
   origin, it runs.

   What it catches that `node --check` cannot: a load-order break, a
   top-level `const` declared twice across two classic scripts (they share
   one lexical scope), a global that quietly stopped being defined, and a
   vendored library that is present but broken.

   What it still does NOT do: sign in or render a page. The Firebase modular
   SDK loads from gstatic, which this sandbox cannot reach, so
   `__bootApp()` never runs. That part still needs a human or Claude in
   Chrome.

   Skips cleanly (exit 0) when no browser is available.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const http=require('http');
const {execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');

function findBrowser(){
  if(process.env.CHROME_BIN&&fs.existsSync(process.env.CHROME_BIN))return process.env.CHROME_BIN;
  const candidates=[
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
    '/usr/bin/chromium','/usr/bin/chromium-browser'
  ];
  for(const c of candidates)if(fs.existsSync(c))return c;
  // any playwright chromium build, whatever its version suffix
  try{
    const base='/opt/pw-browsers';
    for(const d of fs.readdirSync(base)){
      const p=path.join(base,d,'chrome-linux','chrome');
      if(fs.existsSync(p))return p;
    }
  }catch(e){}
  return null;
}

const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml'};

function buildProbe(){
  const idx=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const srcs=[...idx.matchAll(/<script src="(\/(?:assets\/vendor|js)\/[^"]+)"/g)].map(m=>m[1]);
  const want=['showPage','renderPage','buildNav','showToast','_icon','logActivity',
    'uploadToCloudinary','printDocument','startApp','doLogin','renderProfilePage',
    'loadProfiles','renderBoardsGallery','boardsCreate','renderNotesPage',
    'renderPatternHub','ptnRenderPage','qrcode',
    // js/permissions.js — every module asks it can(...), so a build where
    // it failed to load would leave the whole app answering "no" (or, for
    // the two inverted rules, "yes"). Worth a global check of its own.
    'can','permsFor','permHolders','permRuleUsers','permProtected'];
  return{srcs,html:`<!doctype html><meta charset="utf-8"><body><pre id="out">running</pre>
<script>window.__errs=[];window.onerror=function(m,u,l){window.__errs.push(m+' @'+String(u||'').split('/').pop()+':'+l);};</script>
${srcs.map(s=>`<script src="${s}"></script>`).join('\n')}
<script>
var want=${JSON.stringify(want)};
var missing=want.filter(function(n){return typeof window[n]!=='function';});
var r=[];
function t(name,fn){try{r.push('OK   '+name+': '+fn());}catch(e){r.push('FAIL '+name+': '+e.message);}}
r.push((window.__errs.length?'FAIL':'OK   ')+'no uncaught errors: '+(window.__errs.join(' | ')||'none'));
r.push((missing.length?'FAIL':'OK   ')+'expected globals: '+(missing.length?'MISSING '+missing.join(', '):'all '+want.length+' present'));
r.push((typeof USER_DEFS!=='undefined'&&USER_DEFS.length?'OK   ':'FAIL ')+'USER_DEFS loaded: '+(typeof USER_DEFS!=='undefined'?USER_DEFS.length+' accounts':'UNDEFINED'));
t('permissions answer in the real load order',function(){
  // The rule table is only useful if it can see the session, which is a
  // top-level let in js/shared.js - a different lexical scope from
  // js/permissions.js. This is the check that the bare-name reach across
  // two classic scripts actually works in a browser.
  // (No backticks in here: this whole block lives inside a template
  //  literal, and one would close it. CLAUDE.md records this trap twice.)
  session={uid:'x',u:'afnan',name:'Afnan',role:'owner'};
  if(can('pay.run')!==true)throw new Error('afnan should hold pay.run');
  session={uid:'y',u:'haris',name:'Haris',role:'worker'};
  if(can('pay.run')!==false)throw new Error('haris should not hold pay.run');
  if(can('qc.work')!==true)throw new Error('haris should hold qc.work');
  if(can('nope.nope')!==false)throw new Error('an unknown capability must be false');
  var n=permHolders('prof.admin').length;
  session=null;
  return n+' profile admins, and can() reads session across files';
});
t('jsPDF writes a real PDF',function(){
  var d=new window.jspdf.jsPDF();d.text('GROOVY',20,20);
  var s=d.output('datauristring');
  if(s.indexOf('data:application/pdf')!==0)throw new Error('not a pdf data uri');
  return 'v'+window.jspdf.jsPDF.version+', '+s.length+' chars';
});
t('SheetJS writes a workbook',function(){
  var ws=XLSX.utils.aoa_to_sheet([['a','b'],[1,2]]);
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'S');
  var out=XLSX.write(wb,{type:'base64',bookType:'xlsx'});
  if(!out||out.length<100)throw new Error('empty workbook');
  return 'v'+XLSX.version+', '+out.length+' chars';
});
t('qrcode-generator encodes a pattern deep link',function(){
  var q=qrcode(0,'M');q.addData('https://groovyoperations.netlify.app/#pattern=ptn_0042');q.make();
  var n=q.getModuleCount();if(!(n>=21&&q.isDark(0,0)&&q.isDark(0,6)&&!q.isDark(0,7)))throw new Error('bad symbol '+n);return n+'x'+n+' modules';
});
t('JsBarcode draws a CODE128',function(){
  var c=document.createElement('canvas');JsBarcode(c,'GRV-123',{format:'CODE128'});
  if(!c.width)throw new Error('nothing drawn');
  return c.width+'x'+c.height;
});
document.getElementById('out').textContent=r.join('\\n');
</script></body>`};
}

const browser=findBrowser();
if(!browser){
  console.log('smoke-browser: no Chrome/Chromium found — skipping');
  console.log('  (set CHROME_BIN to run it)');
  process.exit(0);
}

const {srcs,html}=buildProbe();
const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split('?')[0]);
  if(url==='/__probe'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(html);}
  const file=path.join(ROOT,url.replace(/^\/+/,''));
  // never serve outside the repo
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){
    res.writeHead(404);return res.end('not found');
  }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});

const os=require('os');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'groovy-smoke-'));

// The browser MUST be launched asynchronously: this process is also the web
// server, and a synchronous spawn blocks the very event loop that has to
// answer the browser's requests — the page then never loads and the run
// times out looking exactly like a browser problem.
server.listen(0,'127.0.0.1',()=>{
  const port=server.address().port;
  console.log('smoke-browser: '+path.basename(browser)+', '+srcs.length+' scripts\n');
  run(port);
});

function run(port){
  try{
    // Without the background-networking flags Chrome blocks on its component
    // updater and safebrowsing lookups, which in a locked-down sandbox never
    // resolve — the run then times out having proved nothing.
    execFile(browser,['--headless=new','--no-sandbox','--disable-gpu',
      '--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
      '--disable-background-networking','--disable-component-update','--disable-sync',
      '--disable-default-apps','--disable-extensions','--metrics-recording-only',
      '--safebrowsing-disable-auto-update','--mute-audio',
      // The probe only ever talks to 127.0.0.1, so give Chrome no proxy at
      // all. Without this it tunnels its own telemetry through the sandbox
      // egress proxy, where those connections hang rather than fail fast and
      // the whole run times out having proved nothing.
      '--no-proxy-server',
      '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider',
      '--user-data-dir='+profile,
      '--virtual-time-budget=15000','--dump-dom',
      'http://127.0.0.1:'+port+'/__probe'],
      {encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000},
      (err,stdout)=>{finish(err,stdout||'');});
  }catch(e){
    console.error('smoke-browser: could not launch the browser — '+(e.message||e));
    try{fs.rmSync(profile,{recursive:true,force:true});}catch(e2){}
    server.close();process.exit(1);
  }
}

function finish(err,dom){
  server.close();
  try{fs.rmSync(profile,{recursive:true,force:true});}catch(e){}
  if(err&&!dom){
    console.error('smoke-browser: the browser failed to run — '+(err.message||err));
    process.exit(1);
  }
  const m=/<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
  if(!m||m[1].trim()==='running'){
    console.error('smoke-browser: FAILED — the probe never finished (a script threw before it could report)');
    process.exit(1);
  }
  const lines=m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').split('\n');
  lines.forEach(l=>console.log('  '+l));
  const failed=lines.filter(l=>l.startsWith('FAIL'));
  console.log('');
  if(failed.length){console.error('\x1b[31m'+failed.length+' failed\x1b[0m\n');process.exit(1);}
  console.log('\x1b[32mall '+lines.length+' browser checks passed\x1b[0m\n');
}

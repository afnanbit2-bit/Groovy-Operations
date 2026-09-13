#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   startApp smoke test.  `node tests/smoke-startapp.js`

   WHY THIS EXISTS. Profiles shipped with `await profileBootstrap()` on the
   critical path in startApp, before buildNav() and showPage(). A Firestore
   getDoc that never SETTLES — not one that rejects, a rejection was already
   handled — parked startApp forever. The topbar painted and everything
   below it stayed white. It reached production and blocked the business.
   node --check could not see it; neither could the logic suites, because
   they never run startApp.

   So this runs the real startApp in a real browser against a stubbed
   Firebase bridge, under three conditions, and requires the app to render
   in ALL of them:

     ok      — reads resolve normally
     reject  — reads reject (rules denied, e.g. a collection not published)
     hang    — reads NEVER settle (the bug above: a stuck IndexedDB lock, a
               dead connection the SDK has not given up on yet)

   THE RULE IT ENFORCES: nothing on the path to the first render may wait on
   the network. If you add an `await` to startApp before buildNav(), the
   `hang` case fails here.

   Skips cleanly (exit 0) when no browser is available.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const http=require('http');
const os=require('os');
const {execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');

function findBrowser(){
  if(process.env.CHROME_BIN&&fs.existsSync(process.env.CHROME_BIN))return process.env.CHROME_BIN;
  const c=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
  for(const p of c)if(fs.existsSync(p))return p;
  try{
    for(const d of fs.readdirSync('/opt/pw-browsers')){
      const p=path.join('/opt/pw-browsers',d,'chrome-linux','chrome');
      if(fs.existsSync(p))return p;
    }
  }catch(e){}
  return null;
}

const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml','.jpg':'image/jpeg'};

const idx=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const srcs=[...idx.matchAll(/<script src="(\/(?:assets\/vendor|js)\/[^"]+)"/g)].map(m=>m[1]);

const page=`<!doctype html><meta charset="utf-8"><body>
<div id="scr-login"></div>
<div id="scr-app" style="display:none"><div class="topbar">
  <button class="topbar-avatar" id="topbar-avatar"></button>
  <div class="topbar-name" id="user-name"></div><div id="user-title"></div></div>
  <div id="sidebar"></div><div id="main-content"></div></div>
<div id="bug-report-fab" style="display:none"></div><div id="toast"></div>
<pre id="out">running</pre>
<script>
window.__log=[];
function L(m){window.__log.push(String(m));try{document.getElementById('out').textContent=window.__log.join('\\n');}catch(e){}}
window.onerror=function(m,u,l){L('ONERROR '+m+' @'+String(u||'').split('/').pop()+':'+l);};
</script>
${srcs.map(s=>`<script src="${s}"></script>`).join('\n')}
<script>
var MODE=new URLSearchParams(location.search).get('mode')||'ok';
// A stub of exactly the surface index.html bridges onto window. getDoc
// is the one that varies - it is the call the real bug went through.
function reads(){
  if(MODE==='hang')return new Promise(function(){});
  if(MODE==='reject')return Promise.reject(new Error('Missing or insufficient permissions.'));
  return Promise.resolve({exists:function(){return false;},data:function(){return{};}});
}
try{
Object.assign(window,{
  db:{}, rtdb:{}, auth:{currentUser:{getIdToken:function(){return Promise.resolve('t');}}},
  collection:function(){return{};},doc:function(){return{};},
  getDoc:reads,
  getDocs:function(){return MODE==='hang'?new Promise(function(){}):Promise.resolve({docs:[],forEach:function(){},size:0,empty:true});},
  setDoc:function(){return Promise.resolve();},updateDoc:function(){return Promise.resolve();},
  addDoc:function(){return Promise.resolve({id:'x'});},deleteDoc:function(){return Promise.resolve();},
  query:function(){return{};},orderBy:function(){return{};},where:function(){return{};},limit:function(){return{};},
  runTransaction:function(){return Promise.resolve();},
  writeBatch:function(){return{set:function(){},update:function(){},commit:function(){return Promise.resolve();}};},
  onSnapshot:function(){return function(){};},
  signInWithEmailAndPassword:function(){return Promise.resolve({user:{uid:'u1'}});},
  signOut:function(){return Promise.resolve();},onAuthStateChanged:function(){return function(){};},
  updatePassword:function(){return Promise.resolve();},reauthenticateWithCredential:function(){return Promise.resolve();},
  EmailAuthProvider:{credential:function(){return{};}},
  rtdbRef:function(){return{};},rtdbGet:function(){return Promise.resolve({val:function(){return null;}});},
  rtdbChild:function(){return{};},rtdbOnValue:function(){},rtdbOff:function(){}
});
if(typeof window.__bootApp==='function')window.__bootApp();
session={uid:'u1',name:'Afnan',u:'afnan',title:'Co-Founder',role:'owner',email:'afnan@groovy.op'};
window.startApp();
}catch(e){L('SYNC THROW: '+e.message);}
// Give it a generous window, then judge on what is actually on screen.
setTimeout(function(){
  var nav=document.getElementById('sidebar').innerHTML.length>0;
  var body=document.getElementById('main-content').innerHTML.length>0;
  L((nav?'OK   ':'FAIL ')+'nav rendered');
  L((body?'OK   ':'FAIL ')+'main content rendered');
},4000);
</script></body>`;

const browser=findBrowser();
if(!browser){
  console.log('smoke-startapp: no Chrome/Chromium found — skipping');
  process.exit(0);
}
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'groovy-startapp-'));
const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split('?')[0]);
  if(url==='/__startapp'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(page);}
  const file=path.join(ROOT,url.replace(/^\/+/,''));
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});

const MODES=['ok','reject','hang'];
let failed=0,done=0;

server.listen(0,'127.0.0.1',()=>{
  const port=server.address().port;
  console.log('smoke-startapp: '+path.basename(browser)+'\n');
  MODES.forEach(mode=>runMode(port,mode));
});

function runMode(port,mode){
  // Async on purpose: this process is also the web server (see
  // tests/smoke-browser.js — a synchronous spawn deadlocks it).
  execFile(browser,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-first-run','--no-default-browser-check','--disable-background-networking',
    '--disable-component-update','--disable-sync','--disable-default-apps','--disable-extensions',
    '--metrics-recording-only','--safebrowsing-disable-auto-update','--mute-audio','--no-proxy-server',
    '--user-data-dir='+profile+'-'+mode,'--virtual-time-budget=20000','--dump-dom',
    'http://127.0.0.1:'+port+'/__startapp?mode='+mode],
    {encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000},
    (err,stdout)=>report(mode,err,stdout||''));
}

function report(mode,err,dom){
  const m=/<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
  const raw=m?m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"'):'';
  const lines=raw.split('\n').filter(l=>l.trim()&&l.trim()!=='running');
  const label={ok:'reads resolve',reject:'reads are DENIED by rules',hang:'reads NEVER settle'}[mode];
  console.log('  '+mode+' — '+label);
  if(err&&!dom){console.log('    FAIL browser failed: '+(err.message||err));failed++;}
  else if(!lines.length){console.log('    FAIL the app never reported — startApp is stuck');failed++;}
  else lines.forEach(l=>{console.log('    '+l);if(l.indexOf('FAIL')===0||l.indexOf('SYNC THROW')===0||l.indexOf('ONERROR')===0)failed++;});
  console.log('');
  if(++done===MODES.length)finish();
}

function finish(){
  server.close();
  MODES.forEach(m=>{try{fs.rmSync(profile+'-'+m,{recursive:true,force:true});}catch(e){}});
  try{fs.rmSync(profile,{recursive:true,force:true});}catch(e){}
  if(failed){
    console.error('\x1b[31m'+failed+' failed\x1b[0m');
    console.error('The app must render even when a Firestore read never settles.');
    console.error('Check for an `await` on the path to the first render in startApp.\n');
    process.exit(1);
  }
  console.log('\x1b[32mthe app renders under all '+MODES.length+' read conditions\x1b[0m\n');
}

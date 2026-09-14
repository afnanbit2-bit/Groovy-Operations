#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Layout smoke test.  `node tests/smoke-layout.js`

   Renders real markup from the real modules, puts it in a real browser with
   the real stylesheet, and MEASURES it. Everything else in tests/ proves
   logic; this is the first thing here that can see a layout.

   It exists because of a bug that shipped: the Team directory on the
   Profile page put the person's name and the action buttons in one flex row
   inside a 220px grid tile. The buttons are flex-shrink:0 and the name is
   flex:1;min-width:0, so the name was squeezed to EXACTLY ZERO WIDTH and
   every row rendered anonymously — you could not tell whose profile was
   whose. Measured after the fix: 0px → 177px at the same window width. The
   assertion suites were all green through the whole thing, because the name
   was in the DOM the entire time; it just had nowhere to go.

   The same class of failure has bitten this app repeatedly — the board's
   entire top bar invisible for weeks behind a wrong z-index, the delete X
   whose click was retargeted by a pointer capture, the profile photo that
   was a plain <img> with no handler. So the checks are written generally:
   render a fragment, then fail on any element that carries text but
   occupies no width, any container that overflows itself, and any
   CLICKABLE element that is zero-sized, pointer-events:none, or covered by
   something else when the browser hit-tests its centre. Add fragments to
   FRAGMENTS as pages grow.

   Checks each fragment at desktop, laptop and phone widths — a tile that
   fits at 1900px can still collapse at 1280px, which is the width most
   people actually use.

   Skips cleanly (exit 0) when no browser is available.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const http=require('http');
const os=require('os');
const {execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');
const {loadApp}=require('./harness');

function findBrowser(){
  if(process.env.CHROME_BIN&&fs.existsSync(process.env.CHROME_BIN))return process.env.CHROME_BIN;
  const candidates=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
    '/usr/bin/chromium','/usr/bin/chromium-browser'];
  for(const c of candidates)if(fs.existsSync(c))return c;
  try{
    const base='/opt/pw-browsers';
    for(const d of fs.readdirSync(base)){
      const p=path.join(base,d,'chrome-linux','chrome');
      if(fs.existsSync(p))return p;
    }
  }catch(e){}
  return null;
}

// ── the fragments under test ─────────────────────────────────────────────
// Each returns real HTML from the real module. Names are filled in here
// because the modules hydrate them with textContent at runtime, which the
// node harness's stub DOM records but does not put into the markup — the
// hydration itself is covered by tests/profile.test.js.
const FRAGMENTS={
  'profile page (owner, mixed profiles)':()=>{
    const app=loadApp({
      files:['js/boards.js','js/profile.js'],currentPage:'profile',
      session:{uid:'uid-afnan',u:'afnan',name:'Afnan',role:'owner',
               title:'Co-founder',email:'afnan@groovy.op'},
      globals:{getDocs:async()=>({docs:[{id:'uid-afnan',data:()=>({
        uid:'uid-afnan',username:'afnan',displayName:'Afnan',
        jobTitle:'Co-founder',department:'Operations',nameColor:'#7B1F2A'})}]})}
    });
    return app.run('loadProfiles(true)').then(()=>{
      let html=app.run('renderProfilePage()');
      // Longest real names in USER_DEFS, so the measurement is the worst case.
      ['Afnan','Ammar','Mustafa','Uzaib'].forEach((n,i)=>{
        html=html.replace(new RegExp('(id="prof-dir-n-'+i+'"[^>]*>)'),'$1'+n);
        html=html.replace(new RegExp('(id="prof-dir-s-'+i+'"[^>]*>)'),
          '$1Printing &amp; Embellishments');
      });
      return html;
    });
  },
  // A 280px column with a 2-up grid of thumbnails and wrapping labels —
  // precisely the shape that crushed the Profile directory. Rendered inside
  // a stand-in for the canvas wrap, since the real one is position:fixed.
  'boards — Unsorted tray':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'}`);
    app.run(`_boardsTrayOpen=true`);
    app.run(`_editUnsorted=[
      {id:'u1',kind:'text',text:'A note with a fairly long first line that has to wrap somewhere'},
      {id:'u2',kind:'file',fileName:'winter-sequence-2026-techpack-final-v3.pdf',fileSize:2400000},
      {id:'u3',kind:'link',linkUrl:'https://example.test/a',linkTitle:'example.test'},
      {id:'u4',kind:'file',fileName:'a.pdf'}
    ]`);
    let html=app.run('_boardsTrayHTML(true)');
    app.run('_boardsTrayHydrate()');
    // Same reason as above: hydration goes into the harness's stub nodes, so
    // the labels are written in here for the measurement.
    ['A note with a fairly long first line that has to wrap somewhere',
     'winter-sequence-2026-techpack-final-v3.pdf','example.test','a.pdf'].forEach((t,i)=>{
      html=html.replace(new RegExp('(id="board-tray-l-'+i+'"[^>]*>)'),'$1'+t);
    });
    // The tray is position:absolute against the canvas wrap; give it one.
    return Promise.resolve(
      '<div style="position:relative;height:600px;width:100%">'+html+'</div>');
  }
};

const WIDTHS=[1900,1280,420];

const browser=findBrowser();
if(!browser){
  console.log('smoke-layout: no browser found — skipping.');
  console.log('  (set CHROME_BIN to run it)');
  process.exit(0);
}

// The measuring script. Anything with its own text that ends up zero-wide
// or zero-high is invisible to a human no matter what the DOM says.
const PROBE=`
const bad=[];
function textOfOwn(el){
  let t='';
  el.childNodes.forEach(n=>{if(n.nodeType===3)t+=n.textContent;});
  return t.trim();
}
document.querySelectorAll('#main-content *').forEach(el=>{
  const cs=getComputedStyle(el);
  if(cs.display==='none'||cs.visibility==='hidden'||cs.position==='fixed')return;
  const own=textOfOwn(el);
  if(!own)return;
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1){
    bad.push({why:'invisible text',text:own.slice(0,40),
      cls:el.className&&el.className.toString().slice(0,60),
      w:Math.round(r.width),h:Math.round(r.height)});
  }
});
document.querySelectorAll('#main-content .card, #main-content [class*="-row"], #main-content [class*="-tile"]').forEach(el=>{
  if(el.scrollWidth>el.clientWidth+2){
    bad.push({why:'overflows its own box',
      cls:el.className&&el.className.toString().slice(0,60),
      scroll:el.scrollWidth,client:el.clientWidth});
  }
});
if(document.documentElement.scrollWidth>innerWidth+2){
  bad.push({why:'the page scrolls sideways',
    scroll:document.documentElement.scrollWidth,viewport:innerWidth});
}
// A control that exists but cannot be clicked. This is the shape of nearly
// every UI bug this app has had: the board's whole top bar behind a wrong
// z-index, the delete X retargeted by a pointer capture, the profile photo
// with no handler at all. Hit-test the centre of everything clickable and
// make sure the browser would actually reach it.
document.querySelectorAll('#main-content button, #main-content [onclick], #main-content a[href]').forEach(el=>{
  const cs=getComputedStyle(el);
  if(cs.display==='none'||cs.visibility==='hidden')return;
  if(el.disabled)return;
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1){
    bad.push({why:'clickable but has no size',
      text:(el.textContent||'').trim().slice(0,30),
      cls:(el.className||'').toString().slice(0,50)});
    return;
  }
  if(cs.pointerEvents==='none'){
    bad.push({why:'clickable but pointer-events:none',
      text:(el.textContent||'').trim().slice(0,30)});
    return;
  }
  // Off-screen at this width is a layout question, already covered above.
  if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)return;
  const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  // The click reaches the control if the hit IS the control, or a
  // descendant of it (it still bubbles). Anything else means something is
  // painted on top — INCLUDING an ancestor, which is how an ::after
  // overlay or a mispositioned z-index swallows its own children. An
  // earlier version of this check exempted ancestors and therefore caught
  // nothing; it was verified by deliberately covering a button.
  if(hit&&hit!==el&&!el.contains(hit)){
    bad.push({why:'something else is covering this control',
      text:(el.textContent||'').trim().slice(0,30),
      coveredBy:(hit.tagName+'.'+(hit.className||'')).slice(0,50)});
  }
});
document.getElementById('__out').textContent=JSON.stringify(bad);
`;

(async function main(){
  const cases=[];
  for(const [name,build] of Object.entries(FRAGMENTS)){
    cases.push({name,html:await build()});
  }

  const server=http.createServer((req,res)=>{
    const url=decodeURIComponent(req.url.split('?')[0]);
    const m=/^\/__frag\/(\d+)$/.exec(url);
    if(m){
      const c=cases[Number(m[1])];
      res.writeHead(200,{'Content-Type':'text/html'});
      return res.end(`<!doctype html><html><head>
<script>document.documentElement.setAttribute('data-theme',new URL(location).searchParams.get('t')||'light');<\/script>
<link rel="stylesheet" href="/css/main.css"></head><body>
<div id="main-content" style="padding:18px 16px">${c.html}</div>
<pre id="__out">running</pre>
<script>${PROBE}<\/script></body></html>`);
    }
    const file=path.join(ROOT,url.replace(/^\/+/,''));
    if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){
      res.writeHead(404);return res.end('not found');
    }
    res.writeHead(200,{'Content-Type':url.endsWith('.css')?'text/css':'application/octet-stream'});
    fs.createReadStream(file).pipe(res);
  });

  const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'groovy-layout-'));
  let failures=0,checks=0,pending=0;

  // Launched asynchronously on purpose: this process is also the web server,
  // and a synchronous spawn deadlocks the loop that has to answer the
  // browser's requests — see the same note in tests/smoke-browser.js.
  server.listen(0,'127.0.0.1',()=>{
    const port=server.address().port;
    console.log('smoke-layout: '+path.basename(browser)+', '+cases.length+
      ' fragment(s) × '+WIDTHS.length+' widths × 2 themes\n');
    const jobs=[];
    cases.forEach((c,i)=>WIDTHS.forEach(w=>['light','dark'].forEach(t=>jobs.push({c,i,w,t}))));
    pending=jobs.length;
    jobs.forEach(j=>{
      execFile(browser,['--headless=new','--no-sandbox','--disable-gpu',
        '--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
        '--disable-background-networking','--disable-component-update','--disable-sync',
        '--disable-default-apps','--disable-extensions','--metrics-recording-only',
        '--mute-audio','--no-proxy-server',
        '--window-size='+j.w+',1000',
        '--user-data-dir='+profileDir+'-'+j.i+'-'+j.w+'-'+j.t,
        '--virtual-time-budget=8000','--dump-dom',
        'http://127.0.0.1:'+port+'/__frag/'+j.i+'?t='+j.t],
        {encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000},
        (err,stdout)=>{
          const label=j.c.name+' @ '+j.w+'px '+j.t;
          checks++;
          const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(stdout||'');
          if(!m||m[1].trim()==='running'){
            failures++;
            console.log('  FAIL '+label+' — the probe never ran'+(err?' ('+err.message+')':''));
          }else{
            let bad=[];
            try{bad=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&')
                                   .replace(/&lt;/g,'<').replace(/&gt;/g,'>'));}catch(e){}
            if(bad.length){
              failures++;
              console.log('  FAIL '+label);
              bad.slice(0,6).forEach(b=>console.log('       '+JSON.stringify(b)));
            }else{
              console.log('  OK   '+label);
            }
          }
          if(--pending===0)finish();
        });
    });
  });

  function finish(){
    server.close();
    try{WIDTHS.forEach(w=>cases.forEach((c,i)=>['light','dark'].forEach(t=>
      fs.rmSync(profileDir+'-'+i+'-'+w+'-'+t,{recursive:true,force:true}))));}catch(e){}
    console.log('');
    if(failures){
      console.log('\x1b[31m'+failures+' of '+checks+' layout checks failed\x1b[0m');
      process.exit(1);
    }
    console.log('\x1b[32mall '+checks+' layout checks passed\x1b[0m');
  }
})().catch(e=>{console.error('smoke-layout: '+(e&&e.stack||e));process.exit(1);});

#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Phone smoke test.  `node tests/smoke-phone.js`

   smoke-layout.js measures FRAGMENTS inside a padded #main-content at
   420px. That never saw the board canvas as a phone sees it: a
   position:fixed takeover with a top bar, a docked rail, a panel, a FAB and
   two dropdown menus all competing for the same 390x844. The Sept 2026
   phone audit composed exactly that and measured it, and found six things
   the fragment probe could not: both top-bar menus rendering 80px off the
   LEFT edge of the screen, half the rail off-screen with no way to know,
   the bug FAB parked on the rail, Home's collapsed panel bar over the rail,
   the Open pill over the resize grip, and a 142px top bar. This is that
   probe, kept.

   TWO THINGS THAT MADE THE FIRST RUN WORTHLESS, so nobody repeats them:
     - headless Chromium clamps --window-size to 500px wide, so a "390px"
       run silently measures a tablet. The page is rendered inside an
       <iframe> of the real width instead — media queries, position:fixed
       and 100dvh all resolve against the iframe's own viewport — and the
       probe inside it writes its result to the PARENT document, which is
       what --dump-dom returns.
     - a control under an OPEN sheet or panel is legitimately covered, so
       the hit-test is applied to the chrome (bar, rail, tray head), not to
       cards, and a variant that opens a modal skips the rail.

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
  for(const c of ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'])if(fs.existsSync(c))return c;
  try{for(const d of fs.readdirSync('/opt/pw-browsers')){const p=path.join('/opt/pw-browsers',d,'chrome-linux','chrome');if(fs.existsSync(p))return p;}}catch(e){}
  return null;
}
const browser=findBrowser();
if(!browser){console.log('smoke-phone: no browser found — skipping');process.exit(0);}

const COVER='https://res.cloudinary.com/deww4lpym/image/upload/v1/c.jpg';
const WHITE="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'%3E%3Crect width='4' height='3' fill='%23ffffff'/%3E%3C/svg%3E";
const FAB='<button id="bug-report-fab" type="button" title="Report a bug"><span class="bug-fab-icon">🐛</span><span class="bug-fab-text">Report Bug</span></button>';

// Each variant is the real canvas render (phone branches on) with the real
// rail markup substituted in. Cards are kept ABOVE y=500 so none of them
// sits under the docked rail — a card under the rail is a fixture accident,
// not a finding.
function build(v){
  const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},phone:true,currentPage:'board-canvas'});
  const home=v.startsWith('home');
  app.run(`
    window.openBugReportModal=function(){};
    moodBoards=[{id:'B1',title:'WINTER DUMP 2K27',ownerUid:'u1',visibility:'personal',coverUrl:'${COVER}',color:'#C2410C',cards:[{id:'a',type:'image',imageUrl:'${COVER}'}]},
               {id:'B2',title:'Another board',ownerUid:'u1',visibility:'shared',color:'#35507A',cards:[]}];
    _editBoard=${home
      ?`{id:'H',isHome:true,title:'Home',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0,cards:[]}`
      :`{id:'X',title:'Sample board',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0,cards:[]}`};
    _editConnectors=[];_boardsSelection=new Set();_editUnsorted=${v==='tray-open'?`[{id:'u1',kind:'text',text:'a pasted line'}]`:'[]'};
    _boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
    _boardsTrayOpen=${v==='tray-open'};
    _boardsHomePanelCollapsed=${v==='home-collapsed'};
    _boardsFindOpen=${v==='find'};
    _editCards=${home?`[{id:'k1',type:'board',boardId:'B1',x:20,y:20,w:340,h:136}]`:v==='empty'?'[]':`[
      {id:'t1',type:'text',text:'A note on the board',x:20,y:20,w:220,h:100},
      {id:'i1',type:'image',imageUrl:'${COVER}',x:20,y:140,w:170,h:120},
      {id:'k1',type:'board',boardId:'B1',x:20,y:280,w:340,h:136}
    ]`};
    ${v==='board-sel'?`_boardsSelection=new Set(['t1']);`:''}
  `);
  let html=app.run(`_renderBoardCanvasHTML()`);
  app.run(`_boardsRenderRail()`);
  const rail=app.run(`document.getElementById('board-rail').innerHTML`);
  html=html.replace('<div class="board-rail" id="board-rail"></div>','<div class="board-rail" id="board-rail">'+rail+'</div>');
  html=html.replace(/src="[^"]*cloudinary[^"]*"/g,'src="'+WHITE+'"');
  let extra='';
  if(v==='menu-view')extra='<style>#board-view-menu{display:flex!important}</style>';
  if(v==='menu-more')extra='<style>#board-menu{display:flex!important}</style>';
  return html+extra+FAB;
}
const VARIANTS=['board','board-sel','empty','home-collapsed','home-open','tray-open','menu-view','menu-more','find'];
const MODAL={'home-open':1,'tray-open':1,'menu-view':1,'menu-more':1};
const VIEWS=[[390,844],[390,667],[360,780]];

// Runs inside the iframe. NB: a template literal — no backticks in comments.
const PROBE=`
try{
function R(el){if(!el)return null;const r=el.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),b:Math.round(r.bottom),r:Math.round(r.right)};}
function ov(a,b){return a&&b&&a.w&&b.w&&a.x<b.r&&b.x<a.r&&a.y<b.b&&b.y<a.b;}
const q=s=>document.querySelector(s);
const out={vw:innerWidth,vh:innerHeight,bad:[]};
const topbar=R(q('.board-topbar')),rail=R(q('.board-rail')),fab=R(q('#bug-report-fab')),tray=R(q('.board-tray')),pill=R(q('.board-zoom-pill'));
out.topbarH=topbar?topbar.h:0;
// 1. the top bar is one row: the back button and the last control share a line
const bar=q('.board-topbar');
if(bar){const btns=[...bar.querySelectorAll('button')].filter(b=>getComputedStyle(b).display!=='none'&&!b.closest('.board-menu')).map(R).filter(r=>r&&r.h);
  // Rows, not exact y: a 25px back button and a 32px tool button on one
  // line report different tops.
  const rows=[];btns.forEach(r=>{if(!rows.some(y=>Math.abs(y-r.y)<20))rows.push(r.y);});
  if(rows.length>1)out.bad.push('top bar wraps onto '+rows.length+' rows (buttons at y '+rows.join(',')+')');}
// 2. every rail tool is on screen without scrolling
const railEl=q('.board-rail');
if(railEl){const rr=R(railEl);[...railEl.querySelectorAll('.rail-btn')].forEach(b=>{const r=R(b);if(r.x<rr.x-1||r.r>rr.r+1)out.bad.push('rail tool off-screen: '+b.dataset.act);});}
// 3. nothing of the bottom chrome overlaps
const named={rail,fab,tray,pill};
const keys=Object.keys(named).filter(k=>named[k]&&named[k].w);
for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++){const a=keys[i],b=keys[j];
  if(MODAL_TRAY&&(a==='tray'||b==='tray'))continue;   // an open panel covers the stage by design
  if(ov(named[a],named[b]))out.bad.push('overlap: '+a+' x '+b);}
if(fab&&fab.w)out.bad.push('the bug FAB is visible over the canvas');
// 4. a forced-open menu fits the viewport
[['#board-view-menu','View'],['#board-menu','more']].forEach(([sel,name])=>{const m=q(sel);if(!m||getComputedStyle(m).display==='none')return;const r=R(m);
  if(r.x<0||r.r>innerWidth||r.b>innerHeight||r.y<0)out.bad.push(name+' menu does not fit: '+JSON.stringify(r));});
// 5. the sub-board Open pill does not sit on the resize grip
document.querySelectorAll('.board-card-el.type-board').forEach(card=>{const p=card.querySelector('.board-subboard-open'),g=card.querySelector('.board-resize-handle');
  if(p&&g&&ov(R(p),R(g)))out.bad.push('Open pill overlaps the resize grip');});
// 6. every chrome control is at least 32px tall and reachable
const chrome='.board-topbar button, .board-rail .rail-btn, .board-tray-head button, .board-tray-add button, .board-tray-add label, .board-panel-new, .board-panel-open, .board-panel-more, .board-panel-seg button, .board-tray-del, .board-find button, .board-menu button, .board-subboard-open, .board-card-del';
document.querySelectorAll(chrome).forEach(el=>{const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden')return;
  const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return;
  const label=(el.textContent||el.title||el.className||'').toString().trim().slice(0,24);
  if(r.height<32)out.bad.push('target under 32px: "'+label+'" '+Math.round(r.width)+'x'+Math.round(r.height));
  if(r.right<=0||r.left>=innerWidth||r.bottom<=0||r.top>=innerHeight)return;
  if(el.closest('.board-card-el'))return;   // a card's own controls sit under floating chrome by design; sized above, not hit-tested
  if(MODAL_TRAY&&el.closest('.board-stage'))return;   // under the open panel by design
  if(el.closest('.board-menu')&&getComputedStyle(el.closest('.board-menu')).display==='none')return;
  const h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  if(h&&h!==el&&!el.contains(h))out.bad.push('covered: "'+label+'" by '+h.tagName+'.'+(h.className&&h.className.baseVal!==undefined?h.className.baseVal:h.className||''));});
// 7. the empty hint speaks phone
const hint=q('.board-empty-hint');
if(hint&&/Ctrl\\+V|Double-click|hold Space/.test(hint.textContent))out.bad.push('empty hint still says '+hint.textContent.slice(0,60));
(window.parent!==window?window.parent.document:document).getElementById('__out').textContent=JSON.stringify(out);
}catch(e){(window.parent!==window?window.parent.document:document).getElementById('__out').textContent=JSON.stringify({error:String(e&&e.stack||e)});}
`;

const pages={};VARIANTS.forEach(v=>{pages[v]=build(v);});
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/p'){
    const v=u.searchParams.get('v');
    res.writeHead(200,{'Content-Type':'text/html'});
    return res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"><link rel="stylesheet" href="/css/main.css"></head><body class="board-fullscreen"><div id="main-content">${pages[v]}</div><script>const MODAL_TRAY=${MODAL[v]?'true':'false'};${PROBE}<\/script></body></html>`);
  }
  if(u.pathname==='/f'){
    const v=u.searchParams.get('v'),w=u.searchParams.get('w'),h=u.searchParams.get('h');
    res.writeHead(200,{'Content-Type':'text/html'});
    return res.end(`<!doctype html><html><body style="margin:0"><iframe src="/p?v=${v}" style="border:0;display:block;width:${w}px;height:${h}px"></iframe><pre id="__out">running</pre></body></html>`);
  }
  const f=path.join(ROOT,u.pathname.replace(/^\/+/,''));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('not found');}
  res.writeHead(200,{'Content-Type':u.pathname.endsWith('.css')?'text/css':'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'groovy-phone-'));
let failures=0,checks=0;
server.listen(0,'127.0.0.1',()=>{
  const port=server.address().port;
  const jobs=[];VARIANTS.forEach(v=>VIEWS.forEach(vw=>jobs.push({v,vw})));
  console.log('smoke-phone: '+path.basename(browser)+', '+VARIANTS.length+' variants × '+VIEWS.length+' viewports\n');
  const LIMIT=Math.max(1,Number(process.env.SMOKE_LAYOUT_CONCURRENCY)||Math.min(6,Math.max(2,os.cpus().length)));
  let i=0,active=0,done=0;
  const finish=()=>{server.close();console.log('\n'+(failures?failures+' of '+checks+' phone checks failed':'all '+checks+' phone checks passed'));process.exit(failures?1:0);};
  const next=()=>{
    while(active<LIMIT&&i<jobs.length){
      const j=jobs[i++];active++;
      execFile(browser,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
        '--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync',
        '--disable-default-apps','--disable-extensions','--metrics-recording-only','--mute-audio','--no-proxy-server',
        '--window-size=600,'+(j.vw[1]+40),'--user-data-dir='+dir+'-'+j.v+'-'+j.vw[0]+'x'+j.vw[1],
        '--virtual-time-budget=8000','--dump-dom','http://127.0.0.1:'+port+'/f?v='+j.v+'&w='+j.vw[0]+'&h='+j.vw[1]],
        {encoding:'utf8',maxBuffer:64*1024*1024,timeout:120000},(err,stdout)=>{
          const label=j.v+' @ '+j.vw[0]+'×'+j.vw[1];checks++;
          const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(stdout||'');
          if(!m||m[1].trim()==='running'){failures++;console.log('  FAIL '+label+' — the probe never ran'+(err?' ('+err.message+')':''));}
          else{
            let r=null;try{r=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));}catch(e){}
            if(!r){failures++;console.log('  FAIL '+label+' — unreadable result');}
            else if(r.error){failures++;console.log('  FAIL '+label+' — the probe threw: '+r.error.split('\n')[0]);}
            else if(r.vw!==j.vw[0]){failures++;console.log('  FAIL '+label+' — measured at '+r.vw+'px, not a phone');}
            else if(r.bad.length){failures++;console.log('  FAIL '+label+' (top bar '+r.topbarH+'px)');r.bad.forEach(b=>console.log('       '+b));}
            else console.log('  OK   '+label+' (top bar '+r.topbarH+'px)');
          }
          active--;done++;
          if(done===jobs.length)finish();else next();
        });
    }
  };
  next();
});

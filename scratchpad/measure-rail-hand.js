/* Measures the tool rail's NATURAL content height in each tier, against the
   real stylesheet in real headless Chromium. The tier threshold
   (@media min-height) and the smoke-layout rail check are both sized off
   this number, and CLAUDE.md records that the first version of that claim
   was arithmetic and wrong — so it is measured, never counted up.

   Usage: node scratchpad/measure-rail-hand.js
*/
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),cp=require('child_process');
const {loadApp}=require('../tests/harness');
const ROOT=path.join(__dirname,'..');
const CHROME=(function(){
  for(const d of fs.readdirSync('/opt/pw-browsers')){
    const p='/opt/pw-browsers/'+d+'/chrome-linux/chrome';
    if(fs.existsSync(p))return p;
  }
  return null;
})();
if(!CHROME){console.log('no chromium — skipped');process.exit(0);}

const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
  _editCards=[];_editConnectors=[];_boardsSelection=new Set();
  _boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
  _boardsRenderRail();`);
const inner=app.run(`document.getElementById('board-rail').innerHTML`);
const tools=app.run(`_boardsRailItems().filter(i=>i.act).length`);

// The rail is measured with NO height cap, so scrollHeight is its natural
// content height — the number the tier threshold has to clear.
const PAGE=`<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/css/main.css"></head><body style="margin:0">
<div style="position:relative;height:100vh;width:100%">
<div class="board-rail" id="board-rail" style="bottom:auto;height:auto">${inner}</div></div>
<pre id="__out">running</pre><script>
const r=document.getElementById('board-rail');
const btn=r.querySelector('.rail-btn'),svg=btn&&btn.querySelector('svg');
const b2=r.querySelectorAll('.rail-btn');
const pitch=b2.length>1?Math.round(b2[1].getBoundingClientRect().top-b2[0].getBoundingClientRect().top):0;
document.getElementById('__out').textContent=JSON.stringify({
  vh:innerHeight,
  natural:Math.round(r.getBoundingClientRect().height),
  railW:Math.round(r.getBoundingClientRect().width),
  btnH:btn?Math.round(btn.getBoundingClientRect().height):0,
  iconH:svg?Math.round(svg.getBoundingClientRect().height):0,
  pitch
});
<\/script></body></html>`;

const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split('?')[0]);
  if(url==='/p'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(PAGE);}
  const f=path.join(ROOT,url.replace(/^\/+/,''));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end('x');}
  res.writeHead(200,{'Content-Type':url.endsWith('.css')?'text/css':'text/plain'});
  res.end(fs.readFileSync(f));
});
server.listen(0,async()=>{
  const port=server.address().port;
  console.log('tools on the rail (acts, excluding separators):',tools);
  for(const h of [1400,1000,960,940,920,900,880,860,820,768,700]){
    const out=await new Promise(res=>{
      cp.execFile(CHROME,['--headless=new','--disable-gpu','--no-sandbox',
        '--window-size=1400,'+h,'--virtual-time-budget=2500','--dump-dom',
        'http://127.0.0.1:'+port+'/p'],{maxBuffer:1<<26},(e,so)=>res(so||''));
    });
    const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(out);
    let r={};try{r=JSON.parse(m[1]);}catch(e){console.log(h,'unreadable');continue;}
    const stage=r.vh-50;   // the board canvas is a fixed takeover: only its own 50px top bar is above it
    console.log(
      'window '+String(h).padStart(4)+'  vh '+String(r.vh).padStart(4)+
      '  tier '+(r.railW>=90?'LARGE ':'compact')+
      '  rail '+String(r.natural).padStart(4)+
      '  stage '+String(stage).padStart(4)+
      '  '+(r.natural<=stage?'fits':'OVERFLOWS by '+(r.natural-stage))+
      '   (btn '+r.btnH+', icon '+r.iconH+', pitch '+r.pitch+')');
  }
  server.close();
});

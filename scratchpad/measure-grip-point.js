#!/usr/bin/env node
/* The exact gesture from Afnan's recording: press the middle of a to-do
   card's head strip — the bar showing the card's name, its ✕ and a grab
   cursor — and ask what the browser hands that press to. */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),os=require('os');
const {execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');
const {loadApp}=require(path.join(ROOT,'tests/harness'));
const app=loadApp({files:['js/boards.js'],
  session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},currentPage:'board-canvas'});
app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
  _editConnectors=[];_boardsSelection=new Set();_boardsCellFocus=null;_boardsConnSel=null;
  _editCards=[{id:'t1',type:'todo',x:20,y:20,w:240,h:150,items:[{text:'To-do'}]}];`);
const card=app.run(`_boardCardHTML(_editCards[0],true)`)
  .replace('class="board-card-el','class="board-card-el selected');
const PROBE=`(function(){
  const el=document.getElementById('board-card-t1');
  const r=el.getBoundingClientRect();
  const hr=el.querySelector('.board-card-head').getBoundingClientRect();
  const x=r.left+r.width*0.45, y=hr.top+hr.height/2;   // mid-strip, left of the X
  const n=document.elementFromPoint(x,y);
  let cur=getComputedStyle(n).cursor, verdict='nothing happens', k=n;
  while(k&&k!==document.body){
    const h=k.getAttribute&&k.getAttribute('onpointerdown');
    if(h&&/stopPropagation/.test(h)){verdict='BLOCKED by .'+k.className;break;}
    if(h&&/DragStart/.test(h)){verdict='the card drags';break;}
    if(k.classList&&k.classList.contains('board-card-el')){verdict='nothing happens';break;}
    k=k.parentElement;
  }
  document.getElementById('__out').textContent=JSON.stringify(
    {pressedAt:'middle of the head strip',lands_on:'.'+(n.className||n.tagName),
     cursor_shown:cur, result:verdict},null,1);
})();`;
const server=http.createServer((req,res)=>{
  const u=req.url.split('?')[0];
  if(u==='/frag'){res.writeHead(200,{'Content-Type':'text/html'});
    return res.end(`<!doctype html><html><head><link rel="stylesheet" href="/css/main.css"></head>
<body style="margin:0"><div class="board-stage"><div class="board-world" style="position:relative;height:300px">
${card}</div></div><pre id="__out">running</pre><script>${PROBE}<\/script></body></html>`);}
  const f=path.join(ROOT,u.replace(/^\/+/,''));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end('x');}
  res.writeHead(200,{'Content-Type':'text/css'});fs.createReadStream(f).pipe(res);
});
function br(){try{for(const d of fs.readdirSync('/opt/pw-browsers')){
  const p='/opt/pw-browsers/'+d+'/chrome-linux/chrome';if(fs.existsSync(p))return p;}}catch(e){}
  return '/usr/bin/chromium';}
server.listen(0,'127.0.0.1',()=>{
  execFile(br(),['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--window-size=900,600','--virtual-time-budget=5000',
    '--user-data-dir='+fs.mkdtempSync(path.join(os.tmpdir(),'gp-')),'--dump-dom',
    'http://127.0.0.1:'+server.address().port+'/frag'],
    {encoding:'utf8',maxBuffer:32e6,timeout:60000},(e,out)=>{
      const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(out||'');
      console.log(m?m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'):'no output');
      server.close();});
});

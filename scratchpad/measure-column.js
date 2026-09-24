#!/usr/bin/env node
/* _BOARDS_COL_HEAD is what _boardsLayoutColumn puts the first child below,
   and .board-column-body's `top` is where the drop zone starts. Both have
   to equal the head block's REAL rendered height, so both are measured
   against the real stylesheet rather than counted up from paddings. */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),os=require('os');
const {execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');
const {loadApp}=require(path.join(ROOT,'tests/harness'));
const app=loadApp({files:['js/boards.js'],
  session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},currentPage:'board-canvas'});
app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
  _editConnectors=[];_boardsSelection=new Set(['c1']);_boardsCellFocus=null;_boardsConnSel=null;
  _editCards=[{id:'c1',type:'column',title:'',x:20,y:20,w:280,h:130},
              {id:'c2',type:'column',title:'Winter drop',x:340,y:20,w:280,h:130},
              {id:'c3',type:'column',title:'Folded',x:660,y:20,w:280,h:130,collapsed:true},
              {id:'k',type:'text',text:'x',x:0,y:0,w:10,h:10,columnId:'c3'}];
  _boardsLayoutColumns();`);
const cards=app.run(`_editCards.map(c=>_boardCardHTML(c,true)).join('')`);
const PROBE=`(function(){
  const out={};
  const h=document.querySelector('#board-card-c1 .board-column-head');
  const b=document.querySelector('#board-card-c1 .board-column-body');
  const t=document.querySelector('#board-card-c1 .board-column-title');
  const n=document.querySelector('#board-card-c1 .board-column-count');
  const f=document.querySelector('#board-card-c1 .board-column-fold');
  const col=document.getElementById('board-card-c1');
  const R=e=>e?{x:Math.round(e.getBoundingClientRect().left),y:Math.round(e.getBoundingClientRect().top),
                w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height)}:null;
  out.headHeight=h?Math.round(h.getBoundingClientRect().height):null;
  out.bodyTopWithinColumn=(b&&col)?Math.round(b.getBoundingClientRect().top-col.getBoundingClientRect().top):null;
  out.title=R(t); out.count=R(n); out.fold=R(f); out.column=R(col);
  out.titleCentred=(t&&col)?Math.round((t.getBoundingClientRect().left+t.getBoundingClientRect().right)/2
                                      -(col.getBoundingClientRect().left+col.getBoundingClientRect().right)/2):null;
  out.titleFont=t?getComputedStyle(t).fontSize+' / '+getComputedStyle(t).fontWeight+' / '+getComputedStyle(t).textAlign:null;
  out.countText=n?n.textContent.trim():null;
  out.foldGlyph=f?f.textContent.trim():null;
  const c3=document.getElementById('board-card-c3');
  out.collapsedHasBody=!!document.querySelector('#board-card-c3 .board-column-body');
  out.collapsedHeight=c3?Math.round(c3.getBoundingClientRect().height):null;
  const ch=document.querySelector('#board-card-c3 .board-column-head');
  const cn=document.querySelector('#board-card-c3 .board-column-count');
  out.collapsedHeadHeight=ch?Math.round(ch.getBoundingClientRect().height):null;
  out.collapsedCountBottom=(cn&&c3)?Math.round(cn.getBoundingClientRect().bottom-c3.getBoundingClientRect().bottom):null;
  out.note='collapsedCountBottom > 0 means the count hangs BELOW the column box';
  document.getElementById('__out').textContent=JSON.stringify(out,null,1);
})();`;
const server=http.createServer((req,res)=>{
  const u=req.url.split('?')[0];
  if(u==='/frag'){res.writeHead(200,{'Content-Type':'text/html'});
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/main.css">
<script>document.documentElement.setAttribute('data-theme','dark')<\/script></head>
<body style="margin:0"><div class="board-stage"><div class="board-world" data-lod="near"
style="position:relative;height:320px">${cards}</div></div>
<pre id="__out">running</pre><script>${PROBE}<\/script></body></html>`);}
  const f=path.join(ROOT,u.replace(/^\/+/,''));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end('x');}
  res.writeHead(200,{'Content-Type':'text/css'});fs.createReadStream(f).pipe(res);
});
function br(){try{for(const d of fs.readdirSync('/opt/pw-browsers')){
  const p='/opt/pw-browsers/'+d+'/chrome-linux/chrome';if(fs.existsSync(p))return p;}}catch(e){}
  return '/usr/bin/chromium';}
server.listen(0,'127.0.0.1',()=>{
  execFile(br(),['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--window-size=1100,600','--virtual-time-budget=5000',
    '--user-data-dir='+fs.mkdtempSync(path.join(os.tmpdir(),'mc-')),'--dump-dom',
    'http://127.0.0.1:'+server.address().port+'/frag'],
    {encoding:'utf8',maxBuffer:32e6,timeout:60000},(e,out)=>{
      const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(out||'');
      console.log(m?m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'):'no output '+(e&&e.message));
      server.close();});
});

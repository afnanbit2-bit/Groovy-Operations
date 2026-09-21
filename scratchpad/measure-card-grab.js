#!/usr/bin/env node
/* Where can each card type actually be GRABBED?

   Renders the real card markup with the real stylesheet in headless
   Chromium, paints the head strip (the .selected state, which is what hover
   paints too), and hit-tests every point of the strip's own footprint,
   asking: would this press reach something that starts a card drag?

   The walk is the browser's: document.elementFromPoint, then up the
   ancestor chain to the first inline onpointerdown. stopPropagation kills
   the drag; boardsCardDragStart starts it. */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),os=require('os');
const {execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');
const {loadApp}=require(path.join(ROOT,'tests/harness'));

const app=loadApp({files:['js/boards.js'],
  session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},currentPage:'board-canvas'});
app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
  _editConnectors=[];_boardsSelection=new Set();_boardsCellFocus=null;_boardsConnSel=null;
  _editCards=[
    {id:'todo',type:'todo',x:0,y:0,w:240,h:150,items:[{t:'Trace the pattern'},{t:'Cut the denim'}]},
    {id:'note',type:'text',x:260,y:0,w:220,h:110,text:'a note'},
    {id:'linknew',type:'link',x:500,y:0,w:220,h:100},
    {id:'linkedit',type:'link',x:740,y:0,w:220,h:150,linkUrl:'https://x.test',linkTitle:'T',_linkEdit:true},
    {id:'linkprev',type:'link',x:0,y:220,w:220,h:150,linkUrl:'https://x.test',linkTitle:'T',_linkFetched:true},
    {id:'table',type:'table',x:260,y:220,w:240,h:150,rows:[['a','b'],['c','d']]},
    {id:'heading',type:'heading',x:520,y:220,w:240,h:80,text:'SECTION'},
    {id:'sub',type:'board',x:780,y:220,w:240,h:150,boardId:'zz'}
  ];`);
const cards=app.run(`_editCards.map(c=>_boardCardHTML(c,true)).join('')`)
  .replace(/class="board-card-el /g,'class="board-card-el selected ');

const PROBE=`
(function(){
  function verdict(x,y){
    let n=document.elementFromPoint(x,y);
    if(!n)return 'none';
    while(n&&n!==document.body){
      const h=n.getAttribute&&n.getAttribute('onpointerdown');
      if(h){
        if(/stopPropagation/.test(h))return 'blocked:'+(n.className||n.tagName);
        if(/DragStart/.test(h))return 'drag';
      }
      if(n.classList&&n.classList.contains('board-card-el'))return 'nohandler';
      n=n.parentElement;
    }
    return 'missed';
  }
  const out=[];
  document.querySelectorAll('.board-card-el').forEach(el=>{
    const r=el.getBoundingClientRect();
    const head=el.querySelector('.board-card-head');
    const hh=head?head.getBoundingClientRect().height:0;
    let tot=0,ok=0;const why={};
    // The strip's own footprint, inset 2px so the border is not sampled.
    for(let dy=2;dy<Math.max(hh,4)-1;dy+=2)for(let dx=2;dx<r.width-2;dx+=3){
      tot++;const v=verdict(r.left+dx,r.top+dy);
      if(v==='drag')ok++;else why[v]=(why[v]||0)+1;
    }
    // And the whole card, for "is there anywhere at all to grab this".
    let ctot=0,cok=0;
    for(let dy=2;dy<r.height-2;dy+=3)for(let dx=2;dx<r.width-2;dx+=3){
      ctot++;if(verdict(r.left+dx,r.top+dy)==='drag')cok++;
    }
    out.push({card:el.dataset.id,headH:Math.round(hh),
      stripDraggablePct:Math.round(ok/tot*100),
      cardDraggablePct:Math.round(cok/ctot*100),
      blockedBy:Object.keys(why).sort((a,b)=>why[b]-why[a]).slice(0,2)});
  });
  document.getElementById('__out').textContent=JSON.stringify(out,null,1);
})();`;

const server=http.createServer((req,res)=>{
  const url=req.url.split('?')[0];
  if(url==='/frag'){
    res.writeHead(200,{'Content-Type':'text/html'});
    return res.end(`<!doctype html><html><head><link rel="stylesheet" href="/css/main.css">
</head><body style="margin:0"><div class="board-stage"><div class="board-world"
style="position:relative;height:420px">${cards}</div></div>
<pre id="__out">running</pre><script>${PROBE}<\/script></body></html>`);
  }
  const f=path.join(ROOT,url.replace(/^\/+/,''));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end('x');}
  res.writeHead(200,{'Content-Type':'text/css'});fs.createReadStream(f).pipe(res);
});
function findBrowser(){
  try{for(const d of fs.readdirSync('/opt/pw-browsers')){
    const p='/opt/pw-browsers/'+d+'/chrome-linux/chrome';if(fs.existsSync(p))return p;}}catch(e){}
  return '/usr/bin/chromium';
}
server.listen(0,'127.0.0.1',()=>{
  const port=server.address().port;
  execFile(findBrowser(),['--headless=new','--no-sandbox','--disable-gpu',
    '--disable-dev-shm-usage','--window-size=1100,800','--virtual-time-budget=6000',
    '--user-data-dir='+fs.mkdtempSync(path.join(os.tmpdir(),'cg-')),'--dump-dom',
    'http://127.0.0.1:'+port+'/frag'],{encoding:'utf8',maxBuffer:32e6,timeout:60000},
    (e,out)=>{
      const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(out||'');
      console.log(m?m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&')
                     .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
                 :'no output '+(e&&e.message));
      server.close();
    });
});

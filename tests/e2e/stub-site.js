/* ─────────────────────────────────────────────────────────────────────────
   tests/e2e/stub-site.js — the site board.e2e.js drives with --stub.

   The REAL index.html shell and the real scripts, served locally, with the
   Firebase module swapped for tests/smoke-board.js's in-memory Firestore,
   seeded with the Winter Drop 2027 milestones, the five Board people, the
   QA account `claude` and one private Milanote board of its own. The QA
   rules are imitated (smoke-board's STUB, __QA_UID): pos, bug_reports and
   activity are refused; writes are allowed only where firestore.rules'
   isQa() fence allows them. So the harness's containment gate and its
   refused-write probes mean something here too.

   Used when GROOVY_QA_URL / _EMAIL / _PASSWORD are not set yet, or to
   rehearse a change before it is on a deploy preview. It proves the pages
   render, the assertions hold and the harness itself works; it proves
   nothing about the live data, the live rules or the network.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const http=require('http');
const ROOT=path.join(__dirname,'..','..');
const sb=require(path.join(ROOT,'tests','smoke-board.js'));

const QA={uid:'u-claude',u:'claude',name:'Claude (QA)',role:'qa',email:'claude@groovy.op'};

function seed(){
  const cols=sb.seedCols();
  const now=Date.now();
  cols.user_profiles[QA.uid]={uid:QA.uid,username:'claude',updatedAt:now};
  // One private board of its own, with a named card and a sub-board card,
  // so the in-place renames have something to rename.
  cols.mood_boards={
    'qa-board':{title:'QA board',ownerUid:QA.uid,ownerName:QA.name,visibility:'personal',sharedWith:[],
      zoom:1,panX:0,panY:0,createdAt:now,updatedAt:now,connectors:[],unsorted:[],
      cards:[{id:'qa-note',type:'text',text:'Rib spec for the denim programme',name:'Rib spec',x:120,y:120,w:220,h:120},
             {id:'qa-sub',type:'board',boardId:'qa-child',boardTitle:'Knitwear',x:420,y:120,w:200,h:104}]},
    'qa-child':{title:'Knitwear',ownerUid:QA.uid,ownerName:QA.name,visibility:'personal',sharedWith:[],parentId:'qa-board',
      zoom:1,panX:0,panY:0,createdAt:now,updatedAt:now,connectors:[],unsorted:[],cards:[]}
  };
  return cols;
}

function page(){
  const idx=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const noModule=idx.replace(/<script type="module">[\s\S]*?<\/script>/,'');
  const pre='<script>window.__SEED='+JSON.stringify(seed())+';window.__UID='+JSON.stringify(QA.uid)
    +';window.__EMAIL='+JSON.stringify(QA.email)+';window.__QA_UID='+JSON.stringify(QA.uid)
    +';window.__PROMPT="QA Sandbox";'
    +'</script><script>('+sb.CLOCK.toString()+')();('+sb.STUB.toString()+')();</script>';
  return noModule.replace('<head>','<head>'+pre);
}

// Resolves {url, close}. The page is served at / so the harness's
// fetch("/sw.js") reads the CACHE_VERSION under test.
function start(){
  return new Promise(res=>{
    const server=http.createServer((req,res2)=>{
      const url=decodeURIComponent(req.url.split('?')[0]);
      if(url==='/'||url==='/index.html'){res2.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res2.end(page());}
      const file=path.join(ROOT,url.replace(/^\/+/,''));
      if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res2.writeHead(404);return res2.end();}
      res2.writeHead(200,{'Content-Type':sb.TYPES[path.extname(file)]||'application/octet-stream'});
      fs.createReadStream(file).pipe(res2);
    });
    server.listen(0,'127.0.0.1',()=>res({url:'http://127.0.0.1:'+server.address().port+'/',
      email:QA.email,password:'stub',close:()=>server.close()}));
  });
}

module.exports={start,QA};

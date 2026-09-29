#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   axe-core over the whole app.  `node tests/smoke-axe.js`

   Runs Deque's axe-core 4.13.0 (vendored at tests/vendor, MPL-2.0, dev-only —
   never referenced by index.html or sw.js) against every page for a few roles
   on a 390px phone frame, using the same signed-in harness as
   smoke-app-phone.js. axe covers what our own probes do not: form labels,
   button/link names, ARIA misuse, duplicate ids, landmarks, image alt.

   REPORT-ONLY by default (exit 0) — the first run found real findings and a
   gate that fails on day one gets ignored. Set AXE_STRICT=1 to fail on any
   violation, or AXE_BASELINE (a JSON file of "rule:page" keys) to fail only
   on NEW ones. color-contrast is OFF: smoke-layout/smoke-app-phone already
   own it and axe cannot read gradients either.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const http=require('http');
const os=require('os');
const {execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');
// Master Accounts' pure core — the small book below is built by it, so every
// document has the shape the pages read.
const MA=require('../js/ma-core.js');

function findBrowser(){
  if(process.env.CHROME_BIN&&fs.existsSync(process.env.CHROME_BIN))return process.env.CHROME_BIN;
  for(const c of ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'])if(fs.existsSync(c))return c;
  try{for(const d of fs.readdirSync('/opt/pw-browsers')){const p=path.join('/opt/pw-browsers',d,'chrome-linux','chrome');if(fs.existsSync(p))return p;}}catch(e){}
  return null;
}
const browser=findBrowser();
if(!browser){console.log('smoke-axe: no browser found — skipping');process.exit(0);}

// The in-memory Firestore and the pinned clock, read out of smoke-board.js.
const boardSrc=fs.readFileSync(path.join(__dirname,'smoke-board.js'),'utf8');
function grab(name){const i=boardSrc.indexOf('function '+name+'(){');const j=boardSrc.indexOf('\n}\n',i);
  if(i<0||j<0)throw new Error('smoke-axe: could not find '+name+' in smoke-board.js');return boardSrc.slice(i,j+2);}
const STUB=grab('STUB'),CLOCK=grab('CLOCK');

// USER_DEFS straight from js/auth.js, so a new account is covered by default.
const authSrc=fs.readFileSync(path.join(ROOT,'js','auth.js'),'utf8');
const USERS=Function('return '+/const USER_DEFS\s*=\s*(\[[\s\S]*?\n\]);/.exec(authSrc)[1])();

function seed(){
  const now=Date.UTC(2026,8,26,4);
  const cols={user_profiles:{},pos:{},gatepasses:{},activity:{},bug_reports:{},notes_pages:{}};
  USERS.forEach(u=>{cols.user_profiles['u-'+u.u]={uid:'u-'+u.u,username:u.u,updatedAt:now};});
  const stages=['cutting','printing','bundling','stitching','washing','qc','completed'];
  const names=['Effortless Tee | Deep Blue — Winter Drop 2027 Oversized Heavyweight','Live In Pants | Charcoal',
    'Combat Hoodie | Black','Baby Tee | Cream','Cargo Trouser | Olive','Jorts | Washed Indigo'];
  names.forEach((n,i)=>{cols.pos['k'+i]={id:'PO-10'+(40+i),name:n,code:'GST0'+(70+i),fabric:'Single Jersey 180 GSM',
    qty:120+i*40,sizes:{XS:10,S:20,M:40,L:30,XL:15,'2XL':5},currentStage:stages[i],status:'active',ts:now-i*86400000,
    date:'2026-09-2'+i,createdBy:'Afnan',embellishment:{required:i%2===0}};});
  for(let i=0;i<4;i++)cols.gatepasses['g'+i]={id:'GP-031'+i,name:'Uzaib',date:'2026-09-25',type:'units',reason:'process',
    article:names[i],spec:'Black / 180 GSM',dest:'Rahim Gul Enterprise',qty:100,total:100,ts:now-i*3600000,status:'out'};
  for(let i=0;i<8;i++)cols.activity['a'+i]={user:'Mustafa',u:'mustafa',action:'Fabric roll deleted',
    detail:'Roll BLK-220 (42.5 kg) removed from Single Jersey Black — duplicate entry',ts:now-i*1800000};
  cols.bug_reports.b0={title:'Save does nothing on the gate pass form when the phone is offline',severity:'high',
    status:'open',page:'gatepass',ts:now,createdAt:now};
  cols.notes_pages.n1={title:'Cutting room SOP',visibility:'shared',ownerUid:'u-afnan',ownerName:'Afnan',
    blocks:[{type:'paragraph',text:'Relax the fabric 24 hours before cutting.'}],updatedAt:now,createdAt:now};
  // Master Accounts: a party, money in, money out and a transfer waiting for
  // its receiver, so the ma-* pages draw their tables with rows, not empty.
  const S=MA.maSettings(null),IDX=MA.maChartIndex(MA.maChart('groovy',[]));
  const mk=(dt,input,no)=>{const d=MA.maBuildDoc(dt,input,{by:'afnan',byName:'Afnan',ts:now},IDX,S);d.no=no;d.id=no;return d;};
  cols.ma_parties={p1:{id:'p1',kind:'vendor',name:'Asghar Printers',code:'ASG',active:true,contact:{person:'Asghar',phone:'0300-1234567'},
    vendor:{roles:['printing'],tax:{regime:'none'},terms:{mode:'cash',from:'2026-07-01'},termsHistory:[],rateCard:[]}}};
  cols.ma_journal={
    'JV-27-0001':mk('journal',{kind:'capital',date:'2026-09-02',holder:'1011',owner:'afnan',amount:300000},'JV-27-0001'),
    'JV-27-0002':mk('journal',{kind:'money_out',date:'2026-09-05',holder:'1011',account:'5030',party:'p1',partyKind:'vendor',amount:20000,tax:{kind:'none'},costCentre:'factory',note:'Printing'},'JV-27-0002')};
  cols.ma_transfer={'TR-27-0001':mk('transfer',{date:'2026-09-07',from:'1011',to:'1012',amount:50000,note:'Float'},'TR-27-0001')};
  // M2: a CPR to collect, one already collected (a collection with a
  // difference), and the rollup's last run — so Money in draws real rows.
  (()=>{
    const px=o=>Object.assign({trackingNumber:'PXA',status:'Delivered',statusCategory:'delivered',dispatched:true,transactionDate:'2026-09-01T10:00:00',
      orderPickupDate:'2026-09-02T09:00:00',orderDeliveryDate:'2026-09-03T16:00:00',cod:3000,transactionFee:180,transactionTax:28.8,reversalFee:0,reversalTax:0,
      upfrontPayment:0,reservePayment:0,balancePayment:0,syncedAt:1790000000000,cprCheckedAt:1790100000000},o);
    const der=MA.maCprDerive([px({cprNumber_1:'CPR-1',cpr1Date:'2026-09-08',upfrontPayment:2400}),px({trackingNumber:'PXB',cprNumber_1:'CPR-2',cpr1Date:'2026-09-15',upfrontPayment:2400})],{from:'2026-07-01',today:'2026-09-25'});
    const docs=MA.maCourierDocs(der,S);
    cols.ma_cpr={};docs.forEach(d=>{cols.ma_cpr[d.id]=d;});
    const c=MA.maBuildDoc('collection',{courier:'postex',holder:'1011',amount:2700,date:'2026-09-09',cprNos:['postex-CPR-1'],collectedBy:'Noman',note:'Kept 50'},{by:'afnan',byName:'Afnan',ts:now,cprs:docs},IDX,S);
    c.no='CL-27-0001';c.id=c.no;cols.ma_collection={[c.no]:c};
    cols.ma_runs={rollup:{id:'rollup',state:'done',ok:true,at:now,day:'2026-09-26',parcels:2,created:4,updated:0,voided:0,transit:der.transit,issueCount:0,issues:[],checks:{}}};
  })();
  return cols;
}

const OWNER_PAGES=['dashboard','po-create','po-registry','gatepass','fabric-inventory','qc-disposition','bstock',
  'fulfillment','activity','monitor','users','bug-tracker','profile','creative-hub','notes','boards-all',
  'store-dashboard','store-inventory','store-receive','store-issue','store-templates','store-log',
  'store-analytics','acct-ledger','po-issue-list','recipe-directory','printing-jobs','observer-tower',
  'color-library','shopify-intel','hrm-employees','attendance','hrm-payroll','hrm-advances','hrm-loans',
  'mkt-creators','mkt-dispatches','mkt-paid-pr','mkt-reports','pattern-hub','pattern-blocks',
  'tb-dash','tb-calendar','tb-lists','tb-inbox','me',
  'ma-overview','ma-money','ma-in','ma-out','ma-parties','ma-ledger','ma-close'];
const JOBS=[
  {id:'owner-light',user:'afnan',theme:'light',pages:OWNER_PAGES},
  {id:'owner-dark',user:'afnan',theme:'dark',pages:['','dashboard','po-registry','notes','boards-all']},
  {id:'worker',user:'abbas',theme:'light',pages:['','gatepass','me']},
  {id:'store',user:'raees',theme:'light',pages:['','store-inventory','acct-ledger','store-receive']}
];


function DRIVE(){
  var PAGES=window.__PAGES,res=[];
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  async function go(){
    try{
      if(typeof window.__bootApp==='function')window.__bootApp();
      session=window.__SESSION;window.startApp();
      await wait(700);
      for(var i=0;i<PAGES.length;i++){
        var id=PAGES[i];
        if(id)try{window.showPage(id);}catch(e){}
        await wait(500);
        var out=await axe.run(document.getElementById('scr-app'),{resultTypes:['violations'],
          rules:{'color-contrast':{enabled:false}}});
        res.push({page:id||'(landing)',v:out.violations.map(function(x){
          return{id:x.id,impact:x.impact,help:x.help,n:x.nodes.length,
            eg:x.nodes[0].target.join(' ').slice(0,90),html:x.nodes[0].html.slice(0,110)};})});
      }
    }catch(e){res.push({page:'(driver)',v:[{id:'driver-threw',impact:'serious',help:e.message,n:1,eg:'',html:''}]});}
    window.parent.document.getElementById('__out').textContent=JSON.stringify(res);
  }
  go();
}
function appPage(job){
  const idx=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<script type="module">[\s\S]*?<\/script>/,'');
  const def=USERS.find(x=>x.u===job.user);
  const sess=Object.assign({},def,{uid:'u-'+def.u});
  const pre='<script>window.__SEED='+JSON.stringify(seed())+';window.__UID='+JSON.stringify(sess.uid)
    +';window.__EMAIL='+JSON.stringify(def.email)+';window.__SESSION='+JSON.stringify(sess)
    +';window.__PAGES='+JSON.stringify(job.pages)+';try{localStorage.setItem("groovy-theme","'+job.theme+'")}catch(e){}'
    +'</script><script>('+CLOCK+')();('+STUB+')();'
    // Master Accounts re-locks after idle; the owner was "here a moment ago"
    // so its pages are scanned, not the lock screen (as smoke-app-phone does).
    +'try{var __a={};__a[window.__UID]=Date.now();localStorage.setItem("groovy-ma-active",JSON.stringify(__a))}catch(e){}'
    // js/store.js is the one REST module: answer it with an empty collection.
    +'window.fetch=function(u){var s=String(u),b=s.indexOf("firestore.googleapis")>-1?(s.indexOf(":runQuery")>-1?[]:{documents:[]}):{};'
    +'return Promise.resolve({ok:true,status:200,headers:{get:function(){return null}},json:function(){return Promise.resolve(b)},text:function(){return Promise.resolve(JSON.stringify(b))}});};'
    +'</script>';
  return idx.replace('<head>','<head>'+pre).replace('</body>','<script src="/tests/vendor/axe-core-4.13.0.min.js"></script><script>('+DRIVE+')();</script></body>');
}
function framePage(job){
  return '<!doctype html><html><body style="margin:0"><iframe src="/__app/'+job.id+'" style="width:390px;height:844px;border:0"></iframe>'
    +'<pre id="__out">running</pre></body></html>';
}

const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml','.jpg':'image/jpeg','.woff2':'font/woff2'};
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'groovy-appphone-'));
const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split('?')[0]);
  let m=/^\/__(frame|app)\/([\w-]+)$/.exec(url);
  if(m){const job=JOBS.find(j=>j.id===m[2]);if(!job){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':'text/html'});return res.end(m[1]==='frame'?framePage(job):appPage(job));}
  const file=path.join(ROOT,url.replace(/^\/+/,''));
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});


const results={};let done=0;
server.listen(0,'127.0.0.1',()=>{
  const port=server.address().port;
  console.log('smoke-axe: '+path.basename(browser)+'\n');
  JOBS.forEach(job=>{
    execFile(browser,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
      '--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync',
      '--disable-extensions','--mute-audio','--no-proxy-server','--window-size=500,1000',
      '--user-data-dir='+profile+'-'+job.id,'--virtual-time-budget=180000','--dump-dom',
      'http://127.0.0.1:'+port+'/__frame/'+job.id],
      {encoding:'utf8',maxBuffer:64*1024*1024,timeout:300000},
      (err,dom)=>{results[job.id]={err,dom:dom||''};if(++done===JOBS.length)finish();});
  });
});
function finish(){
  const keys={},byRule={};let broken=0;
  JOBS.forEach(job=>{
    const {err,dom}=results[job.id];
    const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(dom);
    const raw=m?m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&'):'';
    let rows=null;try{rows=JSON.parse(raw);}catch(e){}
    if(!rows){console.log('  '+job.id+': the frame never reported'+(err?' ('+err.message+')':''));broken++;return;}
    rows.forEach(r=>r.v.forEach(x=>{
      keys[x.id+':'+r.page]=1;
      const b=byRule[x.id]||(byRule[x.id]={impact:x.impact,help:x.help,pages:{},nodes:0,eg:x.eg,html:x.html});
      b.pages[r.page]=1;b.nodes+=x.n;}));
  });
  const rules=Object.keys(byRule).sort((a,b)=>Object.keys(byRule[b].pages).length-Object.keys(byRule[a].pages).length);
  rules.forEach(id=>{const b=byRule[id];
    console.log('  ['+b.impact+'] '+id+' — '+b.help+'\n      '+b.nodes+' nodes on '+Object.keys(b.pages).length+' pages, e.g. '+b.eg+'\n      '+b.html);});
  console.log('\n'+rules.length+' distinct axe rules violated, '+Object.keys(keys).length+' rule/page pairs');
  server.close();
  JOBS.forEach(j=>{try{fs.rmSync(profile+'-'+j.id,{recursive:true,force:true});}catch(e){}});
  try{fs.rmSync(profile,{recursive:true,force:true});}catch(e){}
  if(process.env.AXE_OUT)fs.writeFileSync(process.env.AXE_OUT,JSON.stringify(Object.keys(keys).sort(),null,1));
  let fail=broken>0;
  if(process.env.AXE_BASELINE){const base=new Set(JSON.parse(fs.readFileSync(process.env.AXE_BASELINE,'utf8')));
    const fresh=Object.keys(keys).filter(k=>!base.has(k));
    if(fresh.length){console.error('NEW violations: '+fresh.join(', '));fail=true;}}
  else if(process.env.AXE_STRICT&&rules.length)fail=true;
  process.exit(fail?1:0);
}

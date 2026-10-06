#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   The whole app on a phone.  `node tests/smoke-app-phone.js`

   smoke-layout.js measures FRAGMENTS and smoke-phone.js measures the Mood
   Boards canvas. Neither had ever seen an ordinary page the way a phone
   does: the real index.html shell, signed in, with the bottom nav, the bug
   FAB and the toast all fixed to one 390x844 screen. The phone sweep of 27
   Sept 2026 did exactly that for every page and every role, and found what
   no logic suite could: the Dashboard's stage tiles breaking their labels
   mid-word ("Cuttin g"), the Users page printing "Creator_content_ops_lead"
   and pushing its button off the screen, the toast painted over the bottom
   nav, 24px buttons, and — in dark mode — the Dashboard's KPI tiles left
   cream-white under near-white numbers (1.09:1). This is that sweep, kept.

   How: the real shell and scripts are served; only the Firebase module is
   swapped for the in-memory Firestore tests/smoke-board.js already uses
   (its STUB and CLOCK are read out of that file, not copied, so the two
   cannot drift). The page is rendered inside an <iframe> of the real phone
   width — headless Chromium clamps --window-size to 500px wide, the trap
   recorded in smoke-phone.js — and the driver inside it signs in, opens
   every page for that role, and measures:
     - the page never scrolls sideways;
     - nothing is laid out past the right edge of the screen (unless it sits
       in a strip that scrolls sideways on purpose, like a tab bar);
     - no text is below 2.2:1 against its background, in either theme
       (the smoke-layout threshold: "a human cannot read this at all");
       text over a gradient is skipped, as the probe cannot read one;
     - the small buttons and chips are at least 34px tall on a phone;
     - the toast sits above the bottom nav;
     - nothing threw.

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
  for(const c of ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'])if(fs.existsSync(c))return c;
  try{for(const d of fs.readdirSync('/opt/pw-browsers')){const p=path.join('/opt/pw-browsers',d,'chrome-linux','chrome');if(fs.existsSync(p))return p;}}catch(e){}
  return null;
}
const browser=findBrowser();
if(!browser){console.log('smoke-app-phone: no browser found — skipping');process.exit(0);}

// The in-memory Firestore and the pinned clock, read out of smoke-board.js.
const boardSrc=fs.readFileSync(path.join(__dirname,'smoke-board.js'),'utf8');
function grab(name){const i=boardSrc.indexOf('function '+name+'(){');const j=boardSrc.indexOf('\n}\n',i);
  if(i<0||j<0)throw new Error('smoke-app-phone: could not find '+name+' in smoke-board.js');return boardSrc.slice(i,j+2);}
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
  {id:'owner-dark',user:'afnan',theme:'dark',pages:OWNER_PAGES},
  {id:'worker',user:'abbas',theme:'light',pages:['','gatepass','me','creative-hub']},
  {id:'viewer',user:'uzaib',theme:'dark',pages:['','fabric-inventory','me']},
  {id:'store',user:'raees',theme:'light',pages:['','store-inventory','acct-ledger','store-receive','profile']},
  {id:'fulfilment',user:'umair',theme:'light',pages:['']},
  {id:'marketing',user:'daniyal',theme:'dark',pages:['','mkt-dispatches','mkt-creators']},
  {id:'csr',user:'sami',theme:'light',pages:['','qc-disposition','bstock']}
];

// ── In the phone frame: sign in, open every page, measure ───────────────
function DRIVE(){
  var PAGES=window.__PAGES,res=[];
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(el){var p=el;while(p&&p!==document.body){var c=getComputedStyle(p);if(c.display==='none'||c.visibility==='hidden')return false;p=p.parentElement;}
    return el.getClientRects().length>0&&+getComputedStyle(el).opacity>0;}
  function nm(el){var c=typeof el.className==='string'?el.className:'';var t=(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,28);
    return el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(c?'.'+c.trim().split(/\s+/).slice(0,2).join('.'):'')+(t?' "'+t+'"':'');}
  function sideScroller(el){var p=el.parentElement;while(p&&p!==document.body){var c=getComputedStyle(p);
    if(/(auto|scroll|hidden)/.test(c.overflowX)&&p.scrollWidth>p.clientWidth+1)return true;if(c.position==='fixed')return true;p=p.parentElement;}return false;}
  function rgb(s){var m=String(s).match(/[\d.]+/g);return m?m.map(Number):[0,0,0,0];}
  function lum(c){var a=c.slice(0,3).map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];}
  // The first opaque background under the text, or null when a gradient or
  // picture is in the way (the probe cannot read one).
  function bgOf(el){while(el){var c=getComputedStyle(el);if(c.backgroundImage&&c.backgroundImage!=='none')return null;
    var b=rgb(c.backgroundColor);if(b.length<4||b[3]>0.5)return b;el=el.parentElement;}return[255,255,255,1];}
  function probe(){
    var out=[],vw=innerWidth,se=document.scrollingElement;
    if(se.scrollWidth>vw+1)out.push('the page scrolls sideways by '+(se.scrollWidth-vw)+'px');
    var all=[].slice.call(document.querySelectorAll('#scr-app *')).filter(vis);
    all.forEach(function(el){
      var r=el.getBoundingClientRect();if(!r.width&&!r.height)return;
      if(r.right>vw+1&&r.left<vw&&getComputedStyle(el).position!=='fixed'&&!sideScroller(el))out.push('past the right edge ('+Math.round(r.right)+'px): '+nm(el));
      var own=[].some.call(el.childNodes,function(n){return n.nodeType===3&&n.textContent.trim();});
      if(!own)return;
      var cs=getComputedStyle(el),f=rgb(cs.color);if(f.length>3&&f[3]<0.4)return;
      var b=bgOf(el);if(!b)return;
      var l1=lum(f),l2=lum(b),cr=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
      if(cr<2.2)out.push('unreadable text ('+cr.toFixed(2)+':1): '+nm(el));
    });
    [].slice.call(document.querySelectorAll('#scr-app .btn-sm,#scr-app .btn-outline,#scr-app .filter-chip,#scr-app .dest-chip')).filter(vis).forEach(function(el){
      var h=el.getBoundingClientRect().height;if(h<33.5)out.push('a '+Math.round(h)+'px tap target: '+nm(el));});
    var seen={};return out.filter(function(x){if(seen[x])return false;seen[x]=1;return true;}).slice(0,12);
  }
  async function go(){
    try{
      if(typeof window.__bootApp==='function')window.__bootApp();
      session=window.__SESSION;window.startApp();
      await wait(700);
      for(var i=0;i<PAGES.length;i++){
        var id=PAGES[i];
        var e0=window.__errs.length;
        if(id)try{window.showPage(id);}catch(e){window.__errs.push('showPage('+id+') threw: '+e.message);}
        await wait(500);
        document.scrollingElement.scrollTop=0;
        var errs=window.__errs.slice(e0).filter(function(e){return!/ERR_|Failed to load resource/.test(e);});
        res.push({page:id||'(landing: '+currentPage+')',issues:probe().concat(errs.map(function(e){return'threw: '+e;}))});
      }
      // Inventory Intel's full-view takeover, in the real shell on a phone: the bar and the dock are on screen and clear of the content and the
      // bug FAB, Escape and the deep link both work, and leaving removes every trace.
      if(PAGES.indexOf('shopify-intel')>=0){
        var tk=[];
        try{
          window.showPage('shopify-intel');await wait(600);
          var tb=document.getElementById('si-tk-bar'),tr=document.getElementById('si-tk-rail'),tm=document.getElementById('main-content');
          if(!document.body.classList.contains('si-fullscreen')||!tb||!tr)tk.push('the takeover did not open');
          else{
            var br=tb.getBoundingClientRect(),rr=tr.getBoundingClientRect(),mr=tm.getBoundingClientRect(),fab=document.getElementById('bug-report-fab');
            if(br.top!==0||br.height<40)tk.push('the bar is not at the top ('+Math.round(br.top)+','+Math.round(br.height)+')');
            if(Math.round(rr.bottom)!==innerHeight||rr.height<56)tk.push('the dock is not at the bottom ('+Math.round(rr.bottom)+' of '+innerHeight+', '+Math.round(rr.height)+'px tall)');
            if(Math.round(mr.top)!==Math.round(br.bottom)||Math.round(mr.bottom)>Math.round(rr.top))tk.push('the content overlaps the bar or the dock');
            if(fab&&fab.getClientRects().length&&fab.getBoundingClientRect().bottom>rr.top+0.5)tk.push('the bug button sits on the dock');
            var tz=+getComputedStyle(tm).zIndex,fz=fab?+getComputedStyle(fab).zIndex:500;
            if(!(tz>100&&tz<fz))tk.push('the takeover z-index '+tz+' is not between the topbar (100) and the bug button ('+fz+')');
            [].slice.call(tr.querySelectorAll('.si-tk-item')).forEach(function(it){var r=it.getBoundingClientRect();if(r.height<34||r.width<34)tk.push('a rail item is '+Math.round(r.width)+'x'+Math.round(r.height));if(r.right>innerWidth+1&&it.parentElement.scrollWidth<=it.parentElement.clientWidth)tk.push('a rail item is past the edge');});
          }
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(500);
          if(document.body.classList.contains('si-fullscreen')||document.getElementById('main-content').classList.contains('si-takeover'))tk.push('Escape did not leave the takeover');
          if(currentPage==='shopify-intel')tk.push('Escape did not leave the page');
          if(/^#inventory/.test(location.hash))tk.push('the hash was left behind');
          location.hash='#inventory/explorer';await wait(700);
          if(currentPage!=='shopify-intel'||!document.body.classList.contains('si-fullscreen'))tk.push('the #inventory/explorer link did not open the page');
          if(location.hash!=='#inventory/explorer')tk.push('the hash is '+location.hash);
          window.showPage('hrm-employees');await wait(500);
          if(document.body.classList.contains('si-fullscreen')||document.documentElement.classList.contains('si-fullscreen')||document.getElementById('main-content').classList.contains('si-takeover'))tk.push('leaving by showPage left the class behind');
          if(/^#inventory/.test(location.hash))tk.push('leaving by showPage left the hash behind');
        }catch(e){tk.push('the takeover check threw: '+e.message);}
        res.push({page:'(inventory takeover)',issues:tk});
      }
      // The toast must clear the bottom nav.
      var nav=document.getElementById('mob-nav');
      if(typeof showToast==='function')showToast('A toast on a phone');
      await wait(300);
      // Where the toast COMES TO REST: its bottom offset, not its rect --
      // under --virtual-time-budget the slide-up transition may not have run.
      var t=document.querySelector('.toast.show'),nr=nav&&nav.getBoundingClientRect();
      var rest=t?innerHeight-parseFloat(getComputedStyle(t).bottom):0;
      res.push({page:'(toast)',issues:(t&&nr&&nr.height&&rest>nr.top+1)?['the toast (rests at '+Math.round(rest)+'px) sits on the bottom nav ('+Math.round(nr.top)+'px)']:[]});
    }catch(e){res.push({page:'(driver)',issues:['the driver threw: '+e.message]});}
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
    // so its pages are measured, not the lock screen (js/master-accounts.js).
    +'try{var __a={};__a[window.__UID]=Date.now();localStorage.setItem("groovy-ma-active",JSON.stringify(__a))}catch(e){}'
    // js/store.js is the one REST module: answer it with an empty collection.
    +'window.fetch=function(u){var s=String(u),b=s.indexOf("firestore.googleapis")>-1?(s.indexOf(":runQuery")>-1?[]:{documents:[]}):{};'
    +'return Promise.resolve({ok:true,status:200,headers:{get:function(){return null}},json:function(){return Promise.resolve(b)},text:function(){return Promise.resolve(JSON.stringify(b))}});};'
    +'</script>';
  return idx.replace('<head>','<head>'+pre).replace('</body>','<script>('+DRIVE+')();</script></body>');
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

let failed=0,done=0,checks=0;
const results={};
server.listen(0,'127.0.0.1',()=>{
  const port=server.address().port;
  console.log('smoke-app-phone: '+path.basename(browser)+'\n');
  JOBS.forEach(job=>{
    // Async on purpose: this process is also the web server.
    execFile(browser,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
      '--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync',
      '--disable-extensions','--mute-audio','--no-proxy-server','--window-size=500,1000',
      '--user-data-dir='+profile+'-'+job.id,'--virtual-time-budget=120000','--dump-dom',
      'http://127.0.0.1:'+port+'/__frame/'+job.id],
      {encoding:'utf8',maxBuffer:64*1024*1024,timeout:240000},
      (err,dom)=>{results[job.id]={err,dom:dom||''};if(++done===JOBS.length)finish();});
  });
});

function finish(){
  JOBS.forEach(job=>{
    const {err,dom}=results[job.id];
    const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(dom);
    const raw=m?m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&'):'';
    console.log('  '+job.user+' ('+job.id+', '+job.theme+')');
    let rows=null;try{rows=JSON.parse(raw);}catch(e){}
    if(!rows){console.log('    FAIL the phone frame never reported'+(err?' ('+(err.killed?'timed out':err.message)+')':''));failed++;console.log('');return;}
    let bad=0;
    rows.forEach(r=>{checks++;if(r.issues.length){bad++;failed++;console.log('    FAIL '+r.page);r.issues.forEach(i=>console.log('         '+i));}});
    console.log('    '+(rows.length-bad)+' of '+rows.length+' screens clean\n');
  });
  server.close();
  JOBS.forEach(j=>{try{fs.rmSync(profile+'-'+j.id,{recursive:true,force:true});}catch(e){}});
  try{fs.rmSync(profile,{recursive:true,force:true});}catch(e){}
  if(failed){console.error('\x1b[31m'+failed+' of '+checks+' screens failed\x1b[0m\n');process.exit(1);}
  console.log('\x1b[32mevery page is clean on a 390px phone, for every role, in both themes\x1b[0m\n');
}

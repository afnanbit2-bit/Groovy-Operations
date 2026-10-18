/* Production Ops ▸ Afloat POs (QC5, 15 Oct 2026): js/ph-mod-afloat.js, the READ-ONLY QC reconciliation tab, and its shell wiring.

   What this drives (the REAL js/ph-core.js phQc*, ph-data.js stages, ph-write.js, ph-i18n.js, ph-ui.js and the module over tests/ph-dom.js's
   small real DOM and an in-memory Firestore that RECORDS EVERY READ AND WRITE):
     · the audiences: Faizan (QC floor) gets EXACTLY one tab, Afloat POs, with the "QC receiving" chip and it as his default; the managers
       get it beside their other tabs; Kashif (uzaib) does not get it and keeps his tabs; Raees / Arfat / signed-out get nothing
     · the model: groups Cutting -> In the line -> Finishing -> Ready to close (+ Closed in the last 7 days), cancelled / reserved / old closed
       not listed and counted, a classic-completed PO with no reconciliation not listed; the 120-piece 20/40/40/20 example at every state:
       awaiting cut, awaiting QC, receiving (partially received), within, exact, over, short, closed, reopened, a locked cut, a drifted cut
     · honesty: a failed pos read prints NO tile; a failed po_qc_lots read prints "received: not read" and "unavailable — po_qc_lots" in the
       phase groups, never 0; a failed po_qc_recon read is named; a persistent failure is not re-read in a loop; empty and truncated states
     · the product picture chain: po.imgFront -> po.imgBack -> shopify_articles image_url -> the code tile; a lookalike host, a missing
       validator and a broken URL all end on the tile; a Cloudinary URL asks for its sized derivative
     · the detail: per-size table, lots (a void one struck through), legacy receipts note, drift band, closed band, the QC6 actions (LIVE since QC6; tests/ph-mod-afloat-write.test.js drives them)
       with the reason written, the lightbox and the Escape order
     · XSS: hostile names, codes and notes reach the page as text only; no Firestore write API in the module's source
   What it does NOT prove: geometry (tests/smoke-layout.js "production ops — afloat" fragments do that in real Chromium), real Firestore,
   a real phone, the Urdu. Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-mod-afloat.js');
const UI=read('js/ph-ui.js');
const CSS=read('css/main.css');
const J=JSON.stringify;
const NOW=Date.UTC(2026,9,15,7,0,0);          // 15 Oct 2026, 12:00 PKT
const DAY=86400000;
class FixedDate extends Date{
  constructor(...a){if(a.length===0)super(NOW);else super(...a);}
  static now(){return NOW;}
}
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},
  ammar:{uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer',email:'uzaib@groovy.op'},
  faizan:{uid:'u-faizan',u:'faizan',name:'Faizan',role:'packing',email:'faizan@groovy.op'},
  arfat:{uid:'u-arfat',u:'arfat',name:'Arfat',role:'manager',email:'arfat@groovy.op'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store',email:'raees@groovy.op'}
};
const HOSTILE='<img src=x onerror=alert(1)>';
const STAGES=['cutting','bundling','stitching','printing','washing','qc'];
const CUT={S:20,M:40,L:40,XL:20};          // the owner's example: 120 pieces
const CLD='https://res.cloudinary.com/groovy/image/upload/v1/po/';
function po(id,o){
  const stages={};STAGES.forEach(k=>{stages[k]={done:false,doneAt:null,doneBy:null};});
  return Object.assign({id:id,name:'Athletic Tee · Black',code:'GAT012',qty:120,sizes:{S:20,M:40,L:40,XL:20},poStatus:'in_production',currentStage:'cutting',
    stages:stages,ts:NOW-30*DAY,createdAt:'2026-09-15'},o||{});
}
function cutPo(id,stage,o){
  const p=po(id,Object.assign({currentStage:stage,cutQty:Object.assign({},CUT),cutAt:new Date(NOW-6*DAY).toISOString(),cutBy:'Uzaib'},o||{}));
  p.stages.cutting={done:true,doneAt:new Date(NOW-6*DAY).toISOString(),doneBy:'Uzaib'};
  return p;
}
const lock=(src,by,o)=>Object.assign({sizes:Object.assign({},CUT),total:120,cutAt:new Date(NOW-6*DAY).toISOString(),cutBy:'Uzaib',lockedAt:NOW-3*DAY,lockedBy:by||'faizan',source:src||'first_lot'},o||{});
const recon=(id,o)=>Object.assign({poId:id,status:'locked',rev:2,cutLock:lock(),lotCount:1,voidCount:0,lastLotAt:NOW-DAY,overrides:[],createdAt:NOW-3*DAY,createdBy:'faizan',updatedAt:NOW-DAY,updatedBy:'faizan'},o||{});
let seqN=0;
function lot(id,seq,sizes,o){
  const t=Object.keys(sizes).reduce((a,k)=>a+sizes[k],0);
  seqN++;
  return Object.assign({poId:id,seq:seq,sizes:sizes,total:t,day:'2026-10-14',note:'',at:NOW-DAY-seqN*60000,by:'faizan',byName:'Faizan',status:'live',src:'qc'},o||{});
}
function fixture(){
  seqN=0;
  return{
    // Cutting: no cut yet (awaiting cut), a Cloudinary front photo
    'pos/PO-101':po('PO-101',{imgFront:CLD+'front101.jpg',ts:NOW-2*DAY}),
    // In the line: cut recorded, no reconciliation yet (awaiting QC, lock not taken) -- only a BACK photo
    'pos/PO-102':cutPo('PO-102','stitching',{imgBack:CLD+'back102.jpg'}),
    // Finishing: QC, partially received 20/40/40/0 (receiving) -- no photo on the PO, a Shopify one for its code
    'pos/PO-103':cutPo('PO-103','qc',{code:'GHZ004',name:'Hoodie · Grey'}),
    'po_qc_recon/PO-103':recon('PO-103',{lotCount:2}),
    'po_qc_lots/PO-103-1792000000001-aaaa':lot('PO-103',1,{S:20,M:20,L:20}),
    'po_qc_lots/PO-103-1792000000002-bbbb':lot('PO-103',2,{M:20,L:20}),
    // Ready: within (20/39/40/20)
    'pos/PO-104':cutPo('PO-104','qc'),
    'po_qc_recon/PO-104':recon('PO-104'),
    'po_qc_lots/PO-104-1792000000003-cccc':lot('PO-104',1,{S:20,M:39,L:40,XL:20}),
    // Ready: exact
    'pos/PO-105':cutPo('PO-105','qc'),
    'po_qc_recon/PO-105':recon('PO-105'),
    'po_qc_lots/PO-105-1792000000004-dddd':lot('PO-105',1,{S:20,M:40,L:40,XL:20}),
    // Ready: over (+1 in M, inside the allowance)
    'pos/PO-106':cutPo('PO-106','qc'),
    'po_qc_recon/PO-106':recon('PO-106'),
    'po_qc_lots/PO-106-1792000000005-eeee':lot('PO-106',1,{S:20,M:41,L:40,XL:20}),
    // Ready group, SHORT (M 38/40, allowance 1)
    'pos/PO-107':cutPo('PO-107','qc'),
    'po_qc_recon/PO-107':recon('PO-107'),
    'po_qc_lots/PO-107-1792000000006-ffff':lot('PO-107',1,{S:20,M:38,L:40,XL:20}),
    // Closed yesterday (listed in Closed), and closed long ago (not listed, counted)
    'pos/PO-108':cutPo('PO-108','completed'),
    'po_qc_recon/PO-108':recon('PO-108',{status:'closed',closedAt:NOW-DAY,closedBy:'faizan',closedByName:'Faizan'}),
    'po_qc_lots/PO-108-1792000000007-gggg':lot('PO-108',1,{S:20,M:40,L:40,XL:20}),
    'pos/PO-109':cutPo('PO-109','completed'),
    'po_qc_recon/PO-109':recon('PO-109',{status:'closed',closedAt:NOW-20*DAY,closedBy:'faizan',closedByName:'Faizan'}),
    'po_qc_lots/PO-109-1792000000008-hhhh':lot('PO-109',1,{S:20,M:40,L:40,XL:20}),
    // A classic-completed PO with NO reconciliation: history, not afloat
    'pos/PO-110':cutPo('PO-110','completed'),
    // cancelled and reserved: not listed, counted
    'pos/PO-111':po('PO-111',{poStatus:'cancelled',currentStage:null}),
    'pos/PO-112':po('PO-112',{poStatus:'reserved',currentStage:null}),
    // hostile strings and a LOOKALIKE host (must draw the tile, not a picture)
    'pos/PO-113':po('PO-113',{code:'GX<b>1',name:HOSTILE,currentStage:'bundling',imgFront:'https://res.cloudinary.com.evil.test/x.jpg'}),
    // drift: the lock says M 40, the PO now says 42
    'pos/PO-114':cutPo('PO-114','qc',{cutQty:{S:20,M:42,L:40,XL:20}}),
    'po_qc_recon/PO-114':recon('PO-114'),
    'po_qc_lots/PO-114-1792000000009-iiii':lot('PO-114',1,{S:20,M:40,L:40,XL:20}),
    // a void lot and a note, legacy receipts on the PO
    'pos/PO-115':cutPo('PO-115','qc',{packingReceipts:[{id:'RCV-1-S',size:'S',qty:5,by:'Faizan'}]}),
    'po_qc_recon/PO-115':recon('PO-115',{lotCount:2,voidCount:1}),
    'po_qc_lots/PO-115-1792000000010-jjjj':lot('PO-115',1,{S:20,M:40},{note:HOSTILE}),
    'po_qc_lots/PO-115-1792000000011-kkkk':lot('PO-115',2,{L:40},{status:'void',voidReason:'typed the wrong size',voidedAt:NOW-DAY,voidedBy:'faizan'}),
    // locked by a manager before any lot: awaiting QC, cut final
    'pos/PO-116':cutPo('PO-116','washing'),
    'po_qc_recon/PO-116':recon('PO-116',{cutLock:lock('manual','mustafa'),lotCount:0,lastLotAt:0}),
    // reopened by an owner
    'pos/PO-117':cutPo('PO-117','completed'),
    'po_qc_recon/PO-117':recon('PO-117',{status:'reopened',overrides:[{kind:'reopen',at:NOW-DAY,by:'afnan',byName:'Afnan',reason:'one carton found'}]}),
    'po_qc_lots/PO-117-1792000000012-llll':lot('PO-117',1,{S:20,M:40,L:40,XL:19}),
    'shopify_articles/GHZ004':{image_url:'https://cdn.shopify.com/s/files/1/hoodie.jpg'},
    'shopify_articles/GAT012':{image_url:'https://cdn.shopify.com.evil.test/a.jpg'},
    'po_cut_jobs/PO-101':{poId:'PO-101',status:'open',rev:1,plannedCutDate:'2026-10-16',masterName:'Alam'},
    'bundles/B-1':{poId:'PO-104',size:'S',units:20,stitchingDone:true},
    'bundles/B-2':{poId:'PO-104',size:'M',units:40,stitchingDone:true},
    'bundles/B-3':{poId:'PO-104',size:'L',units:40,stitchingDone:false}
  };
}

/* ── an in-memory Firestore recording every read and write ── */
function makeStore(seed,o){
  o=o||{};
  const docs=new Map(),clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
  Object.keys(seed).forEach(p=>{if(seed[p]!==undefined)docs.set(p,clone(seed[p]));});
  const log={reads:{},writes:[]};
  const snap=p=>({id:p.split('/').pop(),exists:()=>docs.has(p),data:()=>clone(docs.get(p)),metadata:{fromCache:false}});
  const colOf=p=>p.split('/').slice(0,-1).join('/');
  const api={
    db:{},
    doc:(db,...s)=>({path:s.join('/'),id:s[s.length-1]}),
    collection:(db,...s)=>({path:s.join('/')}),
    query:(c,...parts)=>({path:c.path,where:parts.filter(x=>x&&x.__w)}),orderBy:()=>({}),limit:()=>({}),where:(f,op,v)=>({__w:1,f,op,v}),
    getDoc:async r=>{log.reads[r.path]=(log.reads[r.path]||0)+1;return snap(r.path);},
    getDocs:async q=>{
      log.reads[q.path]=(log.reads[q.path]||0)+1;
      if(log.reads[q.path]>40)return new Promise(()=>{});
      if(o.gate&&o.gate[q.path])await o.gate[q.path].p;
      if(o.fail&&o.fail[q.path]){const f=o.fail[q.path];if(f.times===undefined||f.times>0){if(f.times!==undefined)f.times--;throw f.err();}}
      if(o.cache&&o.cache[q.path])return{docs:[],metadata:{fromCache:true}};
      let rows=[...docs.keys()].filter(p=>colOf(p)===q.path).sort();
      (q.where||[]).forEach(w=>{rows=rows.filter(p=>{const d=docs.get(p);return w.op==='=='?d&&d[w.f]===w.v:true;});});
      return{docs:rows.map(snap),metadata:{fromCache:false}};
    },
    setDoc:async(r,d)=>{log.writes.push({op:'set',path:r.path});},
    updateDoc:async(r,d)=>{log.writes.push({op:'update',path:r.path});},
    addDoc:async(c,d)=>{log.writes.push({op:'add',path:c.path});return{id:'x'};},
    deleteDoc:async r=>{log.writes.push({op:'delete',path:r.path});},
    writeBatch:()=>({set(r){log.writes.push({op:'set',path:r.path});return this;},update(r){log.writes.push({op:'update',path:r.path});return this;},delete(r){log.writes.push({op:'delete',path:r.path});return this;},async commit(){}}),
    runTransaction:async()=>{log.writes.push({op:'tx'});}
  };
  return{docs,log,api};
}
const settle=(ms)=>new Promise(r=>setTimeout(r,ms||25));
const PERM=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
// The three validators / sizers the picture chain reuses, taken VERBATIM from their own files (loaded before ph-* in index.html).
function grab(file,re){const m=re.exec(read(file));if(!m)throw new Error('could not find the helper in '+file);return m[0];}
const HELPERS=[
  grab('js/profile.js',/function _profPhotoUrl\(u\)\{[\s\S]*?\n\}/),
  grab('js/shopify.js',/const _SI_AX_IMG_RE=[^\n]*\n/),
  grab('js/shopify.js',/function _siAxImgOk\(u\)\{[^\n]*\}/),
  grab('js/boards.js',/function _boardsDisplayUrl\(url,cardW,card\)\{[\s\S]*?\n\}/)
].join('\n');

function load(opts){
  opts=opts||{};
  const st=makeStore(opts.seed||fixture(),{fail:opts.fail,gate:opts.gate,cache:opts.cache});
  const globals=Object.assign({},st.api,{
    Date:FixedDate,currentPage:'dashboard',allPOs:[],allPasses:[],
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    history:{replaceState(){},pushState(){}},
    auth:{currentUser:{getIdToken:async()=>{}}},
    USER_DEFS:[{u:'mustafa',name:'Mustafa'},{u:'faizan',name:'Faizan'},{u:'afnan',name:'Afnan'}],
    qcDoneBySize:function(){return{S:10,M:5};}
  },opts.globals||{});
  const files=['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js'];
  const a=harness.loadApp({files:files,session:opts.session===undefined?USERS.afnan:opts.session,globals:globals});
  const ctx=a.ctx;
  if(typeof ctx.phI18nSetLang==='function')ctx.phI18nSetLang('en');
  const dom=domkit.install(ctx);
  ctx.window.showPage=function(id){ctx.currentPage=id;if(id==='prod-ops')ctx.phRenderPage(id);return Promise.resolve();};
  ctx.window.startApp=async function(){};
  ctx.console={warn(){},log(){},error(){}};
  if(opts.helpers!==false)vm.runInContext(HELPERS,ctx,{filename:'helpers.js'});
  vm.runInContext(opts.ui||UI,ctx,{filename:'ph-ui.js'});
  vm.runInContext(opts.src||SRC,ctx,{filename:'ph-mod-afloat.js'});
  if(opts.session!==undefined)a.run('session='+J(opts.session));
  const T={a,ctx,dom,st,log:st.log,
    R:c=>a.run(c),
    text:n=>n?n.textContent:'',
    html:n=>n?domkit.toHtml(n):'',
    all:pred=>dom.all(dom.body,pred),
    cls:(c,root)=>dom.byClass(root||dom.body,c),
    card:id=>dom.all(dom.body,n=>n.tagName==='BUTTON'&&hasC(n,'phaf-card')&&n.getAttribute('data-po')===id)[0]||null,
    cards:()=>dom.all(dom.body,n=>n.tagName==='BUTTON'&&hasC(n,'phaf-card')),
    group:id=>dom.all(dom.body,n=>hasC(n,'phaf-group')&&n.getAttribute('data-group')===id)[0]||null,
    panel:()=>dom.find('ph-panel'),
    show:async()=>{
      ctx.currentPage='dashboard';
      a.run('_phUiTab="afloat"');
      await ctx.window.showPage('prod-ops');
      await settle(40);
      a.run('_phUiTab="afloat";_phUiPaintPanel()');
      await settle(60);
    },
    repaint:async()=>{a.run('_phUiPaintPanel()');await settle(40);}
  };
  return T;
}
function hasC(n,c){return String(n.className||'').split(/\s+/).indexOf(c)>-1;}
async function open(user,opts){const T=load(Object.assign({session:USERS[user]},opts||{}));await T.show();return T;}

module.exports=async function(){
  const s=suite('ph-mod-afloat');

  /* ── 1. the audiences ───────────────────────────────────────────── */
  s.section('audiences: Faizan one tab, the managers the tab beside theirs, Kashif none');
  const tabsOf=async(u,o)=>{const T=load(Object.assign({session:USERS[u]},o||{}));return T.R('JSON.stringify(phTabsFor().map(t=>t.id))');};
  {
    const f=await tabsOf('faizan');
    s.eq('faizan (QC floor) sees EXACTLY one tab: Afloat POs',f,J(['afloat']));
    const T=load({session:USERS.faizan});
    s.eq('… and it is his default tab',T.R('phDefaultTab().id'),'afloat');
    s.eq('… his top-bar chip says "QC receiving" (not "View only", not the cutting floor\'s)',T.R('phChipFor().text'),'QC receiving');
    s.ok('… a deep link to a tab that is not his lands on Afloat POs',T.R('phResolveTab("cutting").id')==='afloat'&&T.R('phResolveTab("overview").id')==='afloat');
    s.ok('… phGoTab refuses Overview, PO Queue and Today\'s Cutting',['overview','queue','cutting','calendar','monitor'].every(t=>T.R('phGoTab('+J(t)+')')===false));
    s.ok('… phCanSee (the Production Ops list) is unchanged: false for him',T.R('phCanSee()')===false&&T.R('phCanQc()')===true);
  }
  for(const u of ['afnan','ammar','mustafa']){
    const t=JSON.parse(await tabsOf(u));
    s.ok(u+': Afloat POs is on the rail, right after PO Queue',t.indexOf('afloat')===t.indexOf('queue')+1&&t.indexOf('overview')===0);
  }
  {
    const k=JSON.parse(await tabsOf('uzaib'));
    s.ok('uzaib (Kashif) does NOT get Afloat POs',k.indexOf('afloat')<0);
    s.eq('… his shell tabs are unchanged (Overview, PO Queue, Today\'s Cutting)',J(k),J(['overview','queue','cutting']));
    s.eq('… and his chip is still the cutting floor\'s',load({session:USERS.uzaib}).R('phChipFor().text'),'Data entry & cutting');
  }
  for(const u of ['raees','arfat'])s.eq(u+' (off both lists) gets no tab',await tabsOf(u),J([]));
  {const T=load({session:null});s.eq('signed out: no tabs',T.R('JSON.stringify(phTabsFor().map(t=>t.id))'),J([]));}
  {
    const T=await open('faizan');
    s.ok('the takeover renders for Faizan (not the "restricted" note)',!!T.panel()&&T.cards().length>0);
    s.ok('… and the module never draws a manager-only control for him (no enabled button besides Retry / filters / tiles)',T.all(n=>n.tagName==='BUTTON'&&n.getAttribute('disabled')===null&&!/phaf-card|phaf-ftog|phaf-gtog|phaf-more|ph-tk|phi-|ph-btn-primary/.test(n.className)).length===0);
  }

  /* ── 2. the model, the 120-piece example at every state ─────────── */
  s.section('model: groups, counts, the 20/40/40/20 example');
  const T=await open('afnan');
  const ids=g=>J(T.R('JSON.stringify(_phqcModelNow().groups['+J(g)+'].map(t=>t.id))')).replace(/\\"/g,'"').slice(1,-1);
  const grp=g=>JSON.parse(T.R('JSON.stringify(_phqcModelNow().groups['+J(g)+'].map(t=>t.id))'));
  s.eq('Cutting: the PO with no cut',J(grp('cutting')),J(['PO-101']));
  s.eq('In the line: stitching / bundling / washing (awaiting QC, the hostile one, the manually locked one)',J(grp('line').slice().sort()),J(['PO-102','PO-113','PO-116']));
  s.eq('Finishing: final QC still receiving, the drifted PO and the void-lot PO',J(grp('finishing').slice().sort()),J(['PO-103','PO-115']));
  s.eq('Ready to close: within, exact, over, short, the drifted-but-complete one and the reopened one',J(grp('ready').slice().sort()),J(['PO-104','PO-105','PO-106','PO-107','PO-114','PO-117']));
  s.eq('Closed: only the one closed in the last 7 days',J(grp('closed')),J(['PO-108']));
  const M=JSON.parse(T.R('JSON.stringify((m=>({c:m.cancelled,r:m.reserved,o:m.closedOlder,counts:m.counts,all:m.tiles.map(t=>t.id)}))(_phqcModelNow()))'));
  s.ok('a classic-completed PO with no reconciliation is not listed',M.all.indexOf('PO-110')<0);
  s.eq('cancelled / reserved / closed-long-ago counted, not listed',J([M.c,M.r,M.o]),J([1,1,1]));
  s.eq('counts: 12 afloat (13 tiles less the closed one), 2 finishing, 6 ready, 2 short (PO-117 is 1 short in XL, allowance 0: SHORT too)',J([M.counts.afloat,M.counts.finishing,M.counts.ready,M.counts.short,M.all.length]),J([12,2,6,2,13]));
  const ph=id=>T.R('(_phqcModelNow().tiles.filter(t=>t.id==='+J(id)+')[0]||{}).verdict.key');
  s.eq('PO-101 (no cut): awaiting cut',ph('PO-101'),'afloat.v_awaiting_cut');
  s.eq('PO-102 (cut, no lot): awaiting QC',ph('PO-102'),'afloat.v_awaiting_qc');
  s.eq('PO-116 (locked by a manager, no lot): awaiting QC',ph('PO-116'),'afloat.v_awaiting_qc');
  s.eq('PO-103 (20/40/40/0 so far): receiving',ph('PO-103'),'afloat.v_receiving');
  s.eq('PO-104 (20/39/40/20): within 2 %',ph('PO-104'),'afloat.v_within');
  s.eq('PO-105 (20/40/40/20): exact',ph('PO-105'),'afloat.v_exact');
  s.eq('PO-106 (20/41/40/20): over',ph('PO-106'),'afloat.v_over');
  s.eq('PO-107 (20/38/40/20): SHORT',ph('PO-107'),'afloat.v_short');
  s.eq('PO-108: closed',ph('PO-108'),'afloat.v_closed');
  s.eq('PO-117 (reopened, 20/40/40/19): short (XL allowance 0)',ph('PO-117'),'afloat.v_short');
  const card=id=>T.text(T.card(id));
  s.ok('PO-103 tile: received 100 of 120 (2 lots, last 14 Oct), "20 XL still expected", 83 %',/received 100 of 120 \(2 lots, last 14 Oct\)/.test(card('PO-103'))&&/20 XL still expected/.test(card('PO-103'))&&/83 %/.test(card('PO-103')));
  s.ok('PO-103 tile: per-size line S 20/20 ✓ M 40/40 ✓ L 40/40 ✓ XL 0/20 −20 (no ✗ while still expected)',/S 20\/20✓/.test(card('PO-103'))&&/XL 0\/20 −20/.test(card('PO-103'))&&!/✗/.test(card('PO-103')));
  s.ok('PO-104 tile: M 39/40 −1 ✓ and "within 2 %"',/M 39\/40 −1✓/.test(card('PO-104'))&&/within 2 %/.test(card('PO-104')));
  s.ok('PO-106 tile: "over (+1)" with the ▲ glyph',/▲over \(\+1\)/.test(card('PO-106')));
  s.ok('PO-107 tile: SHORT, "M is 2 short, allowance 1", M marked ✗',/✗SHORT/.test(card('PO-107'))&&/M is 2 short, allowance 1/.test(card('PO-107'))&&/M 38\/40 −2✗/.test(card('PO-107')));
  s.ok('PO-101 tile: "Cut: not recorded yet", planned and its master from the cut job',/Cut: not recorded yet/.test(card('PO-101'))&&/planned 16 Oct · Alam/.test(card('PO-101')));
  s.ok('PO-102 tile: the cut is recorded but not locked yet ("locks when QC receives the first lot")',/Cut 120 · locks when QC receives the first lot/.test(card('PO-102')));
  s.ok('PO-104 tile: "Cut 120 · final 🔒"',/Cut 120 · final 🔒/.test(card('PO-104')));
  s.ok('PO-114 tile: the lock wins and the drift is said',/the PO's cut changed since/.test(card('PO-114')));
  s.ok('every verdict chip carries a glyph AND a word',T.cls('phaf-v').every(c=>T.cls('phaf-v-g',c).length===1&&T.text(T.cls('phaf-v-g',c)[0]).trim()!==''&&T.cls('phaf-v-w',c).length===1&&T.text(T.cls('phaf-v-w',c)[0]).trim().length>1));
  s.ok('the progress bar is role=img with a spoken label',T.cls('phaf-bar').every(b=>b.getAttribute('role')==='img'&&/received|no cut/.test(b.getAttribute('aria-label')||'')));
  s.ok('a per-size cell spells itself out (aria-label)',T.cls('phaf-sz').some(c=>/^M: 39 received of 40 cut, 1 short, allowance 1, within$/.test(c.getAttribute('aria-label')||'')));
  s.ok('the summary line: 12 POs afloat · 2 in Finishing · 6 ready to close · 2 short',/12 POs afloat/.test(T.text(T.cls('phaf-summary')[0]))&&/6 ready to close/.test(T.text(T.cls('phaf-summary')[0]))&&/2 short/.test(T.text(T.cls('phaf-summary')[0])));
  s.ok('Ready to close sorts the closest to done first (100 % before 98 %)',(()=>{const g=grp('ready');return g.indexOf('PO-105')<g.indexOf('PO-107');})());
  s.ok('the Closed group starts collapsed (its tiles are not drawn)',!T.card('PO-108')&&!!T.group('closed'));
  s.ok('the data line names every collection and its state',/pos/.test(T.text(T.cls('phaf-data')[0]))&&/po_qc_recon/.test(T.text(T.cls('phaf-data')[0]))&&/po_qc_lots/.test(T.text(T.cls('phaf-data')[0]))&&/shopify_articles/.test(T.text(T.cls('phaf-data')[0])));
  s.ok('the "not listed" line counts cancelled / not released / old closed',/1 cancelled, 1 not yet released, 1 closed more than 7 days ago/.test(T.text(T.panel())));
  s.eq('nothing was written by opening the tab',T.log.writes.length,0);
  s.ok('the reads: pos once, po_qc_recon once, po_qc_lots once, shopify_articles once',T.log.reads.pos===1&&T.log.reads.po_qc_recon===1&&T.log.reads.po_qc_lots===1&&T.log.reads.shopify_articles===1);

  /* ── 3. filters ─────────────────────────────────────────────────── */
  s.section('filters: search, short only, needs attention');
  {
    const q=T.dom.find('phaf-q');q.value='po-104';T.dom.dispatch(q,'input');
    s.eq('search "po-104" leaves one tile',J(T.cards().map(c=>c.getAttribute('data-po'))),J(['PO-104']));
    s.ok('… says how many match',/1 of 13 POs match/.test(T.text(T.cls('phaf-count')[0])));
    s.ok('… the search box is the SAME node (the caret is not lost)',T.dom.find('phaf-q')===q);
    q.value='alam';T.dom.dispatch(q,'input');
    s.eq('search by the cutting master finds the planned PO',J(T.cards().map(c=>c.getAttribute('data-po'))),J(['PO-101']));
    q.value='zzz-nothing';T.dom.dispatch(q,'input');
    s.ok('no match says so',/No PO matches/.test(T.text(T.panel())));
    q.value='';T.dom.dispatch(q,'input');
    const sh=T.dom.find('phaf-f-short');sh.checked=true;T.dom.dispatch(sh,'change');
    s.eq('Short only: the two short POs',J(T.cards().map(c=>c.getAttribute('data-po')).sort()),J(['PO-107','PO-117']));
    sh.checked=false;T.dom.dispatch(sh,'change');
    const at=T.dom.find('phaf-f-att');at.checked=true;T.dom.dispatch(at,'change');
    s.ok('Needs attention: short + drifted cut + old Packing receipts',(()=>{const l=T.cards().map(c=>c.getAttribute('data-po')).sort();return J(l)===J(['PO-107','PO-114','PO-115','PO-117']);})());
    at.checked=false;T.dom.dispatch(at,'change');
    const stg=T.dom.find('phaf-f-stage');stg.value='stitching';T.dom.dispatch(stg,'change');
    s.eq('Stage = Stitching',J(T.cards().map(c=>c.getAttribute('data-po'))),J(['PO-102']));
    stg.value='';T.dom.dispatch(stg,'change');
  }

  /* ── 4. honest states ───────────────────────────────────────────── */
  s.section('honest states: loading, failed pos / lots / recon, empty, truncated, offline copy');
  {
    let rel;const gate={pos:{p:new Promise(r=>{rel=r;})}};
    const L=load({session:USERS.faizan,gate:gate});
    L.ctx.currentPage='dashboard';L.R('_phUiTab="afloat"');await L.ctx.window.showPage('prod-ops');await settle(40);L.R('_phUiPaintPanel()');await settle(30);
    s.ok('loading: a skeleton with "Loading the POs, the reconciliations and the lots", no tile',L.cls('phaf-skel').length===1&&/Loading the POs, the reconciliations and the lots/.test(L.text(L.panel()))&&L.cards().length===0);
    rel();await settle(60);
    s.ok('… and the tiles once the read lands',L.cards().length>0);
  }
  {
    const F=await open('faizan',{fail:{pos:{err:PERM}}});
    s.ok('pos refused: an alert names pos',F.cls('phaf-alert').length===1&&/pos: could not be read/.test(F.text(F.cls('phaf-alert')[0]))&&F.cls('phaf-alert')[0].getAttribute('role')==='alert');
    s.eq('… and NO tile is drawn',F.cards().length,0);
    s.ok('… no number is printed for the POs (no summary line)',F.cls('phaf-summary').length===0);
    const before=F.log.reads.pos;await F.repaint();await F.repaint();
    s.ok('… a persistent failure is not re-read on every repaint (one try + one token-refresh retry, then nothing)',before<=2&&F.log.reads.pos===before);
    const r=F.all(n=>n.tagName==='BUTTON'&&/Retry/.test(n.textContent))[0];
    F.dom.click(r);await settle(60);
    s.ok('… Retry re-reads pos',F.log.reads.pos>before);
  }
  {
    const F=await open('afnan',{fail:{po_qc_lots:{err:PERM}}});
    s.ok('po_qc_lots refused: the alert names po_qc_lots',/po_qc_lots: could not be read/.test(F.text(F.cls('phaf-alert')[0]||F.panel())));
    s.ok('… tiles say "received: not read", never a number received',F.cards().length>0&&F.cards().every(c=>!/received \d/.test(F.text(c)))&&F.cards().some(c=>/received: not read \(po_qc_lots\)/.test(F.text(c))));
    s.ok('… the Ready to close header reads "unavailable — po_qc_lots", not a count',/unavailable — po_qc_lots/.test(F.text(F.group('ready'))));
    s.ok('… the summary says ready to close is unavailable (no "0 ready")',/ready to close: unavailable — po_qc_lots/.test(F.text(F.cls('phaf-summary')[0]))&&!/0 ready/.test(F.text(F.cls('phaf-summary')[0])));
    s.ok('… no tile shows a per-size line or a percentage',F.cls('phaf-sizes').length===0&&F.cls('phaf-pct').every(p=>F.text(p)==='—'));
    s.ok('… the verdict says "not read — po_qc_lots" (a glyph and a word)',F.cls('phaf-v').some(c=>/not read — po_qc_lots/.test(F.text(c))));
  }
  {
    const F=await open('afnan',{fail:{po_qc_recon:{err:PERM}}});
    s.ok('po_qc_recon refused: the alert names po_qc_recon',/po_qc_recon: could not be read/.test(F.text(F.cls('phaf-alert')[0]||F.panel())));
    s.ok('… a tile says the lock was not read, never "final"',F.cards().some(c=>/lock: not read/.test(F.text(c)))&&!F.cards().some(c=>/final 🔒/.test(F.text(c))));
    s.ok('… and a classic-completed PO is not listed (its reconciliation is unknown)',!F.card('PO-117')&&!F.card('PO-108'));
  }
  {
    const F=await open('afnan',{cache:{pos:true}});
    s.ok('an offline-copy answer for pos is a FAILURE, not "no PO"',/offline copy/.test(F.text(F.panel()))&&F.cards().length===0&&!/No PO is afloat/.test(F.text(F.panel())));
  }
  {
    const E=await open('faizan',{seed:{'pos/PO-111':po('PO-111',{poStatus:'cancelled',currentStage:null})}});
    s.ok('empty: "No PO is afloat…"',/No PO is afloat\. A PO appears here once it is released to production\./.test(E.text(E.panel()))&&E.cards().length===0);
  }
  {
    const seed=fixture();for(let i=0;i<5;i++)seed['pos/PO-9'+i+'0']=po('PO-9'+i+'0');
    const src=SRC.replace('const PHAF_POS_LIMIT=1000;','const PHAF_POS_LIMIT=5;');
    const Tr=await open('afnan',{seed:seed,src:src});
    s.ok('truncated: "The newest 5 POs are shown — the list is cut at its limit."',/The newest 5 POs are shown/.test(Tr.text(Tr.panel())));
  }
  {
    const F=await open('afnan',{fail:{shopify_articles:{err:PERM}}});
    s.ok('shopify_articles refused: said once, and the tiles still draw',/Product pictures from Shopify could not be read/.test(F.text(F.panel()))&&F.cards().length>0);
  }

  /* ── 5. the picture chain ───────────────────────────────────────── */
  s.section('product pictures: the fallback chain and the validators');
  {
    const img=id=>{const c=T.card(id);return c?T.all(n=>n.tagName==='IMG'&&T.card(id)&&isIn(n,c))[0]||null:null;};
    const isIn=(n,root)=>{for(let p=n;p;p=p.parentNode)if(p===root)return true;return false;};
    const from=id=>{const c=T.card(id);return c?T.cls('phaf-img',c)[0].getAttribute('data-img-from'):null;};
    s.eq('PO-101 (imgFront): from the PO',from('PO-101'),'po');
    s.eq('… and the src is the Cloudinary sized derivative (w_400), set as a property',img('PO-101')&&img('PO-101').src,CLD.replace('/upload/','/upload/f_auto,q_auto,w_400/')+'front101.jpg');
    s.eq('… alt text is "<code> — <name>"',img('PO-101').getAttribute('alt'),'GAT012 — Athletic Tee · Black');
    s.ok('… lazy, async, no referrer',img('PO-101').getAttribute('loading')==='lazy'&&img('PO-101').getAttribute('decoding')==='async'&&img('PO-101').getAttribute('referrerpolicy')==='no-referrer');
    s.eq('PO-102 (only imgBack): from the back photo',from('PO-102'),'po_back');
    s.eq('PO-103 (no photo, a Shopify one for its code): from the catalog',from('PO-103'),'catalog');
    s.eq('… a Shopify CDN URL is used as stored',img('PO-103').src,'https://cdn.shopify.com/s/files/1/hoodie.jpg');
    s.eq('PO-104 (no photo; its code\'s Shopify URL is a LOOKALIKE host): the code tile',from('PO-104'),'none');
    s.eq('PO-113 (a lookalike Cloudinary host): the code tile, no <img>',from('PO-113'),'none');
    s.ok('… the list tile shows the code and "No photo" (the name is beside it; 18 characters do not fit 56px)',/No photo/.test(T.text(T.cls('phaf-tile',T.card('PO-113'))[0]))&&T.text(T.cls('phaf-tile-code',T.card('PO-113'))[0])==='GX<b>1'&&T.cls('phaf-tile-name',T.card('PO-113')).length===0);
    T.R('globalThis.__h=phqcImageNode('+J(po('PO-202',{code:'GZ9',name:'Abcdefghijklmnopqrstuvwxyz'}))+',"head",{shopUrl:null})');
    s.eq('… the detail\'s large tile carries the name\'s first 18 characters',T.dom.byClass(T.R('__h'),'phaf-tile-name')[0].textContent,'Abcdefghijklmnopq…');
    // a broken picture falls to the next one, then to the tile
    const both=po('PO-201',{imgFront:CLD+'f.jpg',imgBack:CLD+'b.jpg'});
    T.R('globalThis.__n=phqcImageNode('+J(both)+',"tile",{shopUrl:null})');
    const box=T.R('__n');const im=T.dom.all(box,n=>n.tagName==='IMG')[0];
    s.eq('front + back: starts on the front',im.getAttribute('data-from'),'po');
    T.dom.dispatch(im,'error');
    s.ok('a failed front falls to the back photo',im.getAttribute('data-from')==='po_back'&&/b\.jpg$/.test(im.src));
    T.dom.dispatch(im,'error');
    s.ok('a failed back (nothing left) swaps to the code tile',!im.parentNode&&T.dom.byClass(box,'phaf-tile').length===1&&box.getAttribute('data-img-from')==='none');
    const noHelp=load({session:USERS.afnan,helpers:false});
    s.eq('no validator loaded: no picture at all (fails closed)',noHelp.R('phqcImage('+J(po('PO-1',{imgFront:CLD+'x.jpg'}))+',null).from'),'none');
    s.eq('a javascript: URL is refused',T.R('phqcImgSafe("javascript:alert(1)")'),'');
    s.eq('an http (not https) Cloudinary URL is refused',T.R('phqcImgSafe("http://res.cloudinary.com/a/b.jpg")'),'');
  }

  /* ── 6. the detail ─────────────────────────────────────────────── */
  s.section('detail: the per-size table, lots, bands, disabled actions, lightbox, Escape');
  {
    const D=await open('afnan');
    D.dom.click(D.card('PO-104'));await settle(60);
    const det=D.cls('phaf-detail')[0];
    s.ok('opening a tile shows its detail (the list is gone)',!!det&&D.cards().length===0);
    s.ok('… the back button is "← Afloat POs"',/← Afloat POs/.test(D.text(D.dom.find('phaf-back'))));
    const rows=D.all(n=>n.tagName==='TR').map(r=>r.children.map(c=>D.text(c)).join('|'));
    s.ok('… the table: M | 40 | 40 | 39 | −1 | 1 | ✓ within (stitched from the bundles)',rows.some(r=>r==='M|40|40|39|−1|1|✓ within'));
    s.ok('… L stitched 0 (its bundle is not marked stitched)',rows.some(r=>r==='L|40|0|40|0|1|✓ exact'));
    s.ok('… the Total row: 120 | 60 | 119 | −1 | 2 | ✓ within',rows.some(r=>r==='Total|120|60|119|−1|2|✓ within'));
    s.ok('… the lock line (QC6: a 12-hour PKT stamp and who): "Cut is final — locked Mon 12 Oct 2026, 12:00 PM by Faizan when the first lot was received", with 🔒',/Cut is final — locked Mon 12 Oct 2026, 12:00 PM by Faizan when the first lot was received/.test(D.text(det))&&/🔒/.test(D.text(det)));
    s.ok('… the stitched note counts the bundles (2 of 3)',/2 of 3 bundles/.test(D.text(det)));
    s.ok('… the QC disposition hint is read-only text (15 pcs)',/QC disposition so far .*: 15 pcs \(read-only\)/.test(D.text(det)));
    const off=D.all(n=>n.tagName==='BUTTON'&&hasC(n,'phaf-off'));
    // QC6, a deliberate change: the actions are LIVE now (QC5 drew them disabled). Receive units and Close PO for a manager on a within PO.
    s.ok('… Receive units and Close PO are LIVE for a manager on a within PO (QC6), not the disabled QC5 placeholders',!!D.dom.find('phaf-recv-btn')&&D.dom.find('phaf-recv-btn').disabled!==true&&(D.dom.find('phaf-recv-btn')._ls.click||[]).length===1&&!!D.dom.find('phaf-close-btn')&&(D.dom.find('phaf-close-btn')._ls.click||[]).length===1&&off.length===0);
    s.ok('… and the lots list says saved entries cannot be edited (QC6)',/Saved entries cannot be edited\. To correct one, void it and enter it again\./.test(D.text(det)));
    s.eq('… nothing written',D.log.writes.length,0);
    // Escape: the detail closes before the takeover
    D.R('globalThis.__esc=PH_ESCAPE_GUARDS.map(g=>g)');
    const handled=D.R('PH_ESCAPE_GUARDS.some(g=>g()===true)');
    await settle(30);
    s.ok('Escape (a guard) closes the detail and returns to the list',handled===true&&D.cls('phaf-detail').length===0&&D.cards().length>0);
    // lightbox on a PO with front and back photos
    D.dom.click(D.card('PO-101'));await settle(40);
    const pb=D.cls('phaf-picbtn')[0];
    s.ok('the detail picture is a button "Show the product photo larger"',!!pb&&pb.tagName==='BUTTON'&&/larger/.test(pb.getAttribute('aria-label')||''));
    D.dom.click(pb);await settle(10);
    const lb=D.dom.find('phaf-lightbox');
    s.ok('… opens a dialog over everything (role=dialog, aria-modal, focus on Close)',!!lb&&lb.getAttribute('role')==='dialog'&&lb.getAttribute('aria-modal')==='true'&&D.ctx.document.activeElement===D.dom.find('phaf-lb-close'));
    s.ok('… asks for the large derivative (w_1200)',/w_1200/.test(D.all(n=>n.tagName==='IMG'&&hasC(n,'phaf-lb-img'))[0].src));
    D.R('PH_ESCAPE_GUARDS.some(g=>g()===true)');
    s.ok('Escape closes the lightbox FIRST (the detail stays) and focus returns to the picture',!D.dom.find('phaf-lightbox')&&D.cls('phaf-detail').length===1&&D.ctx.document.activeElement===pb);
    // awaiting cut: ordered sizes, greyed, said to be the order
    const tb=D.text(D.cls('phaf-detail')[0]);
    s.ok('PO-101 (no cut): the ORDERED sizes, "not the cut", and "Nothing can be received"',/Ordered \(not the cut\)/.test(tb)&&/20 ordered/.test(tb)&&/Nothing can be received until it is/.test(tb));
    s.ok('… and no action button at all (nothing to receive)',D.all(n=>hasC(n,'phaf-off')).length===0);
    D.R('phqcBack()');await settle(20);
    // void lot, note, legacy receipts
    D.dom.click(D.card('PO-115'));await settle(60);
    const d115=D.cls('phaf-detail')[0];
    const voidLi=D.cls('phaf-lot-void',d115)[0];
    s.ok('PO-115: the void lot is listed, struck through, with its stamp, who and reason (QC6: 12-hour PKT)',!!voidLi&&/void · Wed 14 Oct 2026, 12:00 PM by Faizan · typed the wrong size/.test(D.text(voidLi)));
    s.ok('… the live lot\'s hostile note is TEXT',D.cls('phaf-lot-note',d115).some(n=>n.textContent==='“'+HOSTILE+'”')&&/&lt;img src=x/.test(D.html(d115))&&!D.all(n=>n.tagName==='IMG'&&/onerror/.test(J(n._attrs))).length);
    s.ok('… the old Packing receipts are said and not counted (5 units)',/5 units were received through the old Packing page/.test(D.text(d115)));
    D.R('phqcBack()');await settle(20);
    D.dom.click(D.card('PO-114'));await settle(40);
    s.ok('PO-114: the drift band ("M 40 → 42 … still uses the locked cut")',/changed after it was locked \(M 40 → 42\)/.test(D.text(D.cls('phaf-detail')[0])));
    D.R('phqcBack()');await settle(20);
    D.dom.click(D.card('PO-116'));await settle(40);
    s.ok('PO-116: "Cut is final — locked … by Mustafa" (a manager\'s Lock cut)',/locked .* by Mustafa/.test(D.text(D.cls('phaf-detail')[0])));
    D.R('phqcBack()');await settle(20);
    D.dom.click(D.card('PO-117'));await settle(40);
    s.ok('PO-117: the reopened band names the owner and the reason',/Reopened by Afnan: one carton found/.test(D.text(D.cls('phaf-detail')[0])));
    // QC7, a deliberate change: the manager override is LIVE now (QC6 drew it disabled with "arrives with the next update")
    s.ok('… a manager sees "Close with a shortfall…" LIVE (QC7; it was disabled in QC6)',D.all(n=>n.tagName==='BUTTON'&&/Close with a shortfall/.test(n.textContent)&&!hasC(n,'phaf-off')&&n.disabled!==true&&(n._ls.click||[]).length===1).length===1&&D.all(n=>hasC(n,'phaf-off')&&/Close with a shortfall/.test(n.textContent)).length===0);
    D.R('phqcBack()');await settle(20);
    // closed group expanded, then its detail
    const tog=D.cls('phaf-gtog')[0];D.dom.click(tog);await settle(20);
    s.ok('the Closed group expands on its header',!!D.card('PO-108')&&tog.getAttribute('aria-expanded')==='false');
    D.dom.click(D.card('PO-108'));await settle(40);
    const d108=D.cls('phaf-detail')[0];
    s.ok('PO-108: the closed band "✓ Closed Wed 14 Oct 2026, 12:00 PM by Faizan" (QC6 stamp) and no action button',/✓ Closed Wed 14 Oct 2026, 12:00 PM by Faizan/.test(D.text(d108))&&D.all(n=>n.tagName==='BUTTON'&&(hasC(n,'phaf-off')||/phaf-(recv|close|lock)-btn/.test(n.className))).length===0);
  }
  {
    const F=await open('faizan');
    F.dom.click(F.card('PO-107'));await settle(40);
    s.ok('Faizan on a SHORT PO: no Close button of any kind (only a manager closes a short PO)',F.all(n=>hasC(n,'phaf-off')&&/Close/.test(n.textContent)).length===0);
    F.R('phqcBack()');await settle(20);
    F.dom.click(F.card('PO-104'));await settle(40);
    s.ok('Faizan on a within PO: Close PO is a LIVE button (QC6; QC5 drew it disabled)',!!F.dom.find('phaf-close-btn')&&/^Close PO$/.test(F.dom.find('phaf-close-btn').textContent)&&!hasC(F.dom.find('phaf-close-btn'),'phaf-off')&&(F.dom.find('phaf-close-btn')._ls.click||[]).length===1);
    s.ok('… and no "Lock cut now" for him',F.all(n=>/Lock cut now/.test(n.textContent)).length===0);
  }
  {
    const B=await open('afnan',{fail:{bundles:{err:PERM}}});
    B.dom.click(B.card('PO-104'));await settle(60);
    const rows=B.all(n=>n.tagName==='TR').map(r=>r.children.map(c=>B.text(c)).join('|'));
    s.ok('bundles refused: the Stitched column reads "not read", never 0',rows.some(r=>r==='M|40|not read|39|−1|1|✓ within')&&/stitched: bundles: could not be read/.test(B.text(B.cls('phaf-detail')[0])));
  }

  /* ── 7. XSS and the source rules ───────────────────────────────── */
  s.section('XSS, no writes, strings, stylesheet, wiring');
  {
    const c=T.card('PO-113');
    s.ok('a hostile name and code reach the tile as TEXT (escaped in the serialisation, no element made from them)',T.text(c).indexOf(HOSTILE)>-1&&/&lt;img src=x onerror=alert\(1\)&gt;/.test(T.html(c))&&T.all(n=>n.tagName==='IMG'&&n.getAttribute('src')==='x').length===0&&T.all(n=>n.tagName==='B'&&n.parentNode&&hasC(n.parentNode,'phaf-ctop')).length===0);
    s.ok('no node anywhere has a hostile innerHTML',T.all(n=>typeof n.innerHTML==='string'&&n.innerHTML.indexOf('onerror')>-1).length===0);
  }
  const strip=t=>t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  const code=strip(SRC);
  const WRITE=/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(|\btx\.(set|update|delete)\s*\(|\bbatch\.(set|update|delete|commit)\s*\(/;
  s.ok('the module calls NO Firestore write API',!WRITE.test(code));
  // QC6, a deliberate change: the module now calls the QC4 writers for receive / lock / void / close -- and NOTHING else that writes.
  // QC7, a deliberate change: and the three override writers phQcRelock / phQcReopen / phQcAdoptLegacy (the manager / owner dialogs).
  s.ok('… it calls ONLY the QC4 writers phQcAddLot / phQcLockCut / phQcVoidLot / phQcClose / phQcRelock / phQcReopen / phQcAdoptLegacy and no other ph-write save',/\bphQcAddLot\(/.test(code)&&/\bphQcLockCut\(/.test(code)&&/\bphQcVoidLot\(/.test(code)&&/\bphQcClose\(/.test(code)&&/\bphQcRelock\(/.test(code)&&/\bphQcReopen\(/.test(code)&&/\bphQcAdoptLegacy\(/.test(code)&&[...code.matchAll(/\bphQc[A-Z]\w*(?=\s*\()/g)].map(m=>m[0]).filter(n=>/^phQc(Add|Lock|Void|Close|Relock|Reopen|Adopt|Edit|Update|Set|Delete|Save)/.test(n)).every(n=>['phQcAddLot','phQcLockCut','phQcVoidLot','phQcClose','phQcRelock','phQcReopen','phQcAdoptLegacy'].indexOf(n)>-1)&&!/\bph(SaveDraft|SaveCutJob|MarksSave|MarkComment|SettingsSave|StandardSave)\s*\(/.test(code));
  s.ok('no innerHTML / outerHTML / insertAdjacentHTML / DOMParser / document.write',!/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|document\.write/.test(code));
  s.ok('images are set through the src PROPERTY only (never setAttribute("src"))',!/setAttribute\('src'/.test(code)&&/img\.src=im\.src/.test(code));
  const I=read('js/ph-i18n.js');
  const keys=[...new Set([...SRC.matchAll(/phI18n[DT]\('(afloat\.[a-z_]*[a-z])'/g)].map(m=>m[1]).concat([...SRC.matchAll(/key:'(afloat\.[a-z_]+)'/g)].map(m=>m[1])).concat(Object.values({a:'afloat.cell_exact',b:'afloat.cell_within',c:'afloat.cell_over',d:'afloat.cell_short',e:'afloat.cell_over_refused',f:'afloat.cell_unexpected',g:'afloat.cell_expected',h:'afloat.h_override_relock',i:'afloat.h_override_reopen',j:'afloat.h_override_close_short',k:'afloat.h_override_other'})))];
  s.ok('every afloat.* key the module uses has an English + Urdu row marked review:true ('+keys.length+' keys)',keys.length>=120&&keys.every(k=>T.R('phI18nHas('+J(k)+')')===true&&T.R('PH_I18N_STR['+J(k)+'].review')===true&&T.R('PH_I18N_STR['+J(k)+'].ur.length>0')));
  s.ok('… so are the chip strings shell.chip_qc / shell.chip_qc_tip',T.R('PH_I18N_STR["shell.chip_qc"].review===true&&PH_I18N_STR["shell.chip_qc_tip"].review===true'));
  s.ok('Faizan is NOT Urdu-first (English-first, the switch is in the bar for everyone)',T.R('PH_I18N_URDU_FIRST_USERS.indexOf("faizan")')===-1);
  const blk=(()=>{const a=CSS.indexOf('/* ph-mod-afloat START */'),b=CSS.indexOf('/* ph-mod-afloat END */');return a>0&&b>a?CSS.slice(a,b):'';})();
  s.ok('one delimited stylesheet block, and it is the last ph-mod block',!!blk&&CSS.lastIndexOf('/* ph-mod-afloat END */')>CSS.lastIndexOf('/* ph-mod-jobcopy END */'));
  s.ok('… tokens only: no literal colour',!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(blk.replace(/\/\*[\s\S]*?\*\//g,'')));
  s.ok('… every selector is .phaf- (or an @media)',blk.replace(/\/\*[\s\S]*?\*\//g,'').split('}').map(x=>x.split('{')[0].trim()).filter(Boolean).every(sel=>/^@media/.test(sel)||sel.split(',').every(p=>/\.phaf-/.test(p))));
  s.ok('… 44px targets on the phone and a reduced-motion rule',/\.phaf-search\{[^}]*min-height:44px/.test(blk)&&/\.phaf-card\{/.test(blk)&&/prefers-reduced-motion/.test(blk));
  s.ok('… nothing smaller than 12px (Comfortable scale; 13px is the text floor, 12px only inside the 56px no-photo tile)',[...blk.matchAll(/font-size:(\d+)px/g)].every(m=>+m[1]>=12)&&blk.replace(/\/\*[\s\S]*?\*\//g,'').split('}').filter(r=>/font-size:12px/.test(r)).every(r=>/^\s*\.phaf-tile-/.test(r.split('{')[0].split('\n').pop())));
  const html=read('index.html'),sw=read('sw.js'),shared=read('js/shared.js');
  s.ok('index.html: ONE script tag, after ph-mod-classic.js, before the Firebase module',(html.match(/\/js\/ph-mod-afloat\.js/g)||[]).length===1&&html.indexOf('/js/ph-mod-afloat.js')>html.indexOf('/js/ph-mod-classic.js')&&html.indexOf('<script type="module">')>html.indexOf('/js/ph-mod-afloat.js'));
  s.ok('sw.js: in PRECACHE_URLS once, after ph-mod-classic.js',(sw.match(/'\/js\/ph-mod-afloat\.js'/g)||[]).length===1&&sw.indexOf("'/js/ph-mod-afloat.js'")>sw.indexOf("'/js/ph-mod-classic.js'"));
  s.ok('sw.js CACHE_VERSION is v340 or later (past the merge\'s v339)',+(/CACHE_VERSION = 'v(\d+)'/.exec(sw)||[0,0])[1]>=340);
  s.ok('shared.js: the packing sidebar and phone nav gain "QC Ops" behind a typeof phCanQc guard',/qcOps=typeof phCanQc==='function'&&phCanQc\(\)===true[\s\S]{0,400}id="nav-prod-ops"[^>]*>QC Ops</.test(shared)&&/_mobNavBtn\('prod-ops','list','QC Ops'/.test(shared));

  /* ── 8. the reverts ─────────────────────────────────────────────── */
  s.section('breaks: each guard reverted once must fail its named check');
  const mut=(t,a,b)=>{if(t.indexOf(a)<0)throw new Error('break target missing: '+a.slice(0,50));return t.split(a).join(b);};
  const brk=async(label,expect,fn)=>{let r;try{r=await fn();}catch(e){r='threw: '+e.message;}s.ok('break "'+label+'" fails "'+expect+'"',r===false);};
  await brk('PH_ROLE_ALL left as the widened audience','faizan (QC floor) sees EXACTLY one tab: Afloat POs',async()=>J(JSON.parse(await tabsOf('faizan',{ui:mut(UI,'const PH_ROLE_ALL=function(u){return _phUiCanSeeProd(u);};','const PH_ROLE_ALL=function(u){return _phUiCanSee(u);};')})))===J(['afloat']));
  await brk('the audience line not widened','faizan (QC floor) sees EXACTLY one tab: Afloat POs',async()=>J(JSON.parse(await tabsOf('faizan',{ui:mut(UI,'function _phUiCanSee(u){return _phUiCanSeeProd(u)||_phUiCanQc(u);}','function _phUiCanSee(u){return _phUiCanSeeProd(u);}')})))===J(['afloat']));
  await brk('Kashif given the tab','uzaib (Kashif) does NOT get Afloat POs',async()=>JSON.parse(await tabsOf('uzaib',{src:mut(SRC,'const PHAF_ROLE=function(u){return phqcCanSee(u);};','const PHAF_ROLE=function(u){return phqcCanSee(u)||phCanSee(u);};')})).indexOf('afloat')<0);
  await brk('the QC chip dropped',"… his top-bar chip says \"QC receiving\"",async()=>load({session:USERS.faizan,ui:mut(UI,"  if(_phUiCanQc(w))return{show:true,text:PH_CHIP_QC,","  if(false)return{show:true,text:PH_CHIP_QC,")}).R('phChipFor().text')==='QC receiving');
  await brk('a failed po_qc_lots read drawn as 0',"… tiles say \"received: not read\", never a number received",async()=>{const F=await open('afnan',{fail:{po_qc_lots:{err:PERM}},src:mut(SRC,"if(!t.lotsOk)return phI18nD('afloat.recv_unread');","if(!t.lotsOk)return phI18nD('afloat.recv_none',{total:t.exp&&t.exp.total||0});")});return F.cards().every(c=>!/received \d/.test(F.text(c)))&&F.cards().some(c=>/received: not read \(po_qc_lots\)/.test(F.text(c)));});
  await brk('the phase-group header counted while lots failed',"… the Ready to close header reads \"unavailable — po_qc_lots\"",async()=>{const F=await open('afnan',{fail:{po_qc_lots:{err:PERM}},src:mut(SRC,"const unreadable=PHAF_PHASE_GROUPS.indexOf(g.id)>-1&&(m.counts.ready===null);","const unreadable=false;")});return /unavailable — po_qc_lots/.test(F.text(F.group('ready')));});
  await brk('tiles drawn when pos failed','… and NO tile is drawn',async()=>{const F=await open('faizan',{fail:{pos:{err:PERM,times:1}},src:mut(SRC,"if(_phqcPos.state==='error'&&!_phqcPosP)return;           // the alert above says why; NO tile is drawn without the POs","if(_phqcPos.state==='error'&&!_phqcPosP){_phqcPos.rows=[{fbKey:'PO-999',poStatus:'in_production',currentStage:'cutting'}];}")});await F.repaint();return F.cards().length===0;});
  await brk('a failed read retried on every repaint','… a persistent failure is not re-read on every repaint',async()=>{const F=await open('faizan',{fail:{pos:{err:PERM}},src:mut(SRC,"const due=_phqcPos.state==='idle'||","const due=_phqcPos.state==='error'||_phqcPos.state==='idle'||")});const b=F.log.reads.pos;await F.repaint();await F.repaint();return b<=2&&F.log.reads.pos===b;});
  await brk('the verdict word removed (colour only)','every verdict chip carries a glyph AND a word',async()=>{const F=await open('afnan',{src:mut(SRC,"  c.appendChild(phEl('span','phaf-v-w',phI18nD(v.key,v.params||undefined)));\n","")});return F.cls('phaf-v').every(c=>F.cls('phaf-v-w',c).length===1);});
  await brk('the safe-URL helper bypassed','PO-113 (a lookalike Cloudinary host): the code tile, no <img>',async()=>{const F=await open('afnan',{src:mut(SRC,"  if(typeof u!=='string'||!u||u.length>2000)return'';","  if(typeof u==='string'&&u)return u;")});return F.cls('phaf-img',F.card('PO-113'))[0].getAttribute('data-img-from')==='none';});
  await brk('the sized derivative skipped','… and the src is the Cloudinary sized derivative (w_400)',async()=>{const F=await open('afnan',{src:mut(SRC,"    try{const d=_boardsDisplayUrl(s,250);if(phqcImgSafe(d))return d;}catch(e){}","")});return /w_400/.test(F.all(n=>n.tagName==='IMG')[0].src||'');});
  await brk('the broken-image fallback removed','a failed back (nothing left) swaps to the code tile',async()=>{const F=load({session:USERS.afnan,src:mut(SRC,"img.addEventListener('error',function(){","img.addEventListener('nothing',function(){")});F.R('globalThis.__n=phqcImageNode('+J(po('PO-201',{imgFront:CLD+'f.jpg'}))+',"tile",{shopUrl:null})');const box=F.R('__n');const im=F.dom.all(box,n=>n.tagName==='IMG')[0];F.dom.dispatch(im,'error');return F.dom.byClass(box,'phaf-tile').length===1;});
  await brk('the catalog step dropped from the chain','PO-103 (no photo, a Shopify one for its code): from the catalog',async()=>{const F=await open('afnan',{src:mut(SRC,"  if(cat&&chain.every(function(c){return c.src!==cat;}))chain.push({src:cat,from:'catalog'});","")});return F.cls('phaf-img',F.card('PO-103'))[0].getAttribute('data-img-from')==='catalog';});
  await brk('old closed reconciliations listed','Closed: only the one closed in the last 7 days',async()=>{const F=await open('afnan',{src:mut(SRC,"if(at===null||now-at>PHAF_CLOSED_DAYS*86400000){out.closedOlder++;return;}","")});return J(JSON.parse(F.R('JSON.stringify(_phqcModelNow().groups.closed.map(t=>t.id))')))===J(['PO-108']);});
  await brk('a classic-completed PO with no reconciliation listed','a classic-completed PO with no reconciliation is not listed',async()=>{const F=await open('afnan',{src:mut(SRC,"if(st==='completed'&&(!reconOk||!rc))return;","")});return F.R('_phqcModelNow().tiles.map(t=>t.id).indexOf("PO-110")')<0;});
  await brk('the QC6 Receive button drawn disabled again','… Receive units and Close PO are LIVE for a manager on a within PO (QC6), not the disabled QC5 placeholders',async()=>{const F=await open('afnan',{src:mut(SRC,"      const b=_phqcBtn('ph-btn ph-btn-primary phaf-recv-btn',phI18nD('afloat.a_receive'),function(){phqcSheetOpen(t.id);});b.id='phaf-recv-btn';row.appendChild(b);","      row.appendChild(off('afloat.a_receive','afloat.why_recv_unread',null,'phaf-recv-btn'));")});F.dom.click(F.card('PO-104'));await settle(40);const b=F.dom.find('phaf-recv-btn');return !!b&&b.disabled!==true&&(b._ls.click||[]).length===1;});
  await brk('the floor shown Close on a short PO','Faizan on a SHORT PO: no Close button of any kind',async()=>{const F=await open('faizan',{src:mut(SRC,"      else if(qc)note=phI18nD('afloat.why_close_short');","      else if(qc)row.appendChild(off('afloat.a_close_short','afloat.why_close_short',null,'phaf-close-btn'));")});F.dom.click(F.card('PO-107'));await settle(40);return F.all(n=>hasC(n,'phaf-off')&&/Close/.test(n.textContent)).length===0;});
  await brk('the article name written as HTML','no node anywhere has a hostile innerHTML',async()=>{const F=await open('afnan',{src:mut(SRC,"const nm=phEl('span','phaf-name');nm.textContent=t.name;","const nm=phEl('span','phaf-name');nm.innerHTML=t.name;")});return F.all(n=>typeof n.innerHTML==='string'&&n.innerHTML.indexOf('onerror')>-1).length===0;});
  await brk('the search ignored','search "po-104" leaves one tile',async()=>{const F=await open('afnan',{src:mut(SRC,"  if(q&&(t.id+' '+t.code+' '+t.name+' '+t.master).toLowerCase().indexOf(q)<0)return false;","")});const q=F.dom.find('phaf-q');q.value='po-104';F.dom.dispatch(q,'input');return J(F.cards().map(c=>c.getAttribute('data-po')))===J(['PO-104']);});
  await brk('an offline copy accepted as a read','an offline-copy answer for pos is a FAILURE, not "no PO"',async()=>{const F=await open('afnan',{cache:{pos:true},src:mut(SRC,"  if(snap&&snap.metadata&&snap.metadata.fromCache===true){const e=new Error('the read was answered from this device\\'s offline copy');e.code='from-cache';throw e;}\n","")});return /offline copy/.test(F.text(F.panel()))&&F.cards().length===0&&!/No PO is afloat/.test(F.text(F.panel()));});
  await brk('Escape guard order: the detail before the lightbox','Escape closes the lightbox FIRST (the detail stays)',async()=>{const F=await open('afnan',{src:mut(SRC,"  phAddEscapeGuard(function(){if(_phqcLightbox){phqcLightboxClose();return true;}return false;});\n  phAddEscapeGuard(function(){if(_phqcDlg&&_phqcIsHere()){phqcDlgClose();return true;}return false;});\n  phAddEscapeGuard(function(){if(_phqcSheet&&_phqcIsHere()&&!_phqcSheet.saving){phqcSheetClose();return true;}return false;});\n  phAddEscapeGuard(function(){if(_phqcOpen&&_phqcIsHere()){phqcBack();return true;}return false;});","  phAddEscapeGuard(function(){if(_phqcOpen&&_phqcIsHere()){phqcBack();return true;}return false;});\n  phAddEscapeGuard(function(){if(_phqcLightbox){phqcLightboxClose();return true;}return false;});\n  phAddEscapeGuard(function(){if(_phqcDlg&&_phqcIsHere()){phqcDlgClose();return true;}return false;});\n  phAddEscapeGuard(function(){if(_phqcSheet&&_phqcIsHere()&&!_phqcSheet.saving){phqcSheetClose();return true;}return false;});")});F.dom.click(F.card('PO-101'));await settle(40);F.dom.click(F.cls('phaf-picbtn')[0]);F.R('PH_ESCAPE_GUARDS.some(g=>g()===true)');return !F.dom.find('phaf-lightbox')&&F.cls('phaf-detail').length===1;});
  await brk('a failed bundles read printed as 0','bundles refused: the Stitched column reads "not read", never 0',async()=>{const F=await open('afnan',{fail:{bundles:{err:PERM}},src:mut(SRC,"if(stitched.state==='error')return phI18nD('afloat.t_not_read');","if(stitched.state==='error')return '0';")});F.dom.click(F.card('PO-104'));await settle(60);return F.all(n=>n.tagName==='TR').map(r=>r.children.map(c=>F.text(c)).join('|')).some(r=>r==='M|40|not read|39|−1|1|✓ within');});
  return s;
};
// The layout fragments (tests/smoke-layout.js "production ops — afloat …") reuse this file's scenario and loader.
module.exports.kit={load,fixture,po,cutPo,recon,lot,lock,settle,USERS,CLD,HOSTILE,NOW,DAY};

/* Inventory Intel ▸ "Start a PO draft" (WP3, 14 Oct 2026) and the Production Ops ▸ Overview restock card.

   What this drives: the REAL js/shopify.js (over the Needs Attention fixture of tests/shopify-needs-attention.test.js: today 2026-08-31, R10 is the top
   suggestion at 888 pcs, guide 528..888), the REAL js/shared.js, js/pos.js, js/ph-core.js, js/ph-data.js, js/ph-write.js, js/ph-i18n.js, js/ph-ui.js and
   js/ph-mod-drafts.js, over the in-memory Firestore of tests/ph-issue.test.js (optimistic transactions, every write logged), and for the card the REAL
   js/ph-mod-monitor.js over tests/ph-dom.js.
   HAND-COMPUTED EXPECTATIONS:
   - R10 -> a draft with qty 888 (the HIGH end of 528..888), sizes S 300 / M 388 / L 200 (the stubbed split, which sums to 888), ratio 300:388:200 divided by the
     smallest = 1:1:1 after rounding (300/300=1, 388/300=1.29->1, 200/300=0.67->1), source {kind:'restock',day,lo:528,hi:888,onOrder:null... } .
   - a partial PO of 100 on O1 -> qty 144 (guide 48..144) and source.onOrder 100; a PO of 240 covers O1 -> not a suggestion -> nothing written.
   - the draft equals a drafts-form save of the same fields: same po map (key order and values) except `source` and `notes`.
   Each "break" mutates a source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=JSON.stringify,clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x)),tick=()=>new Promise(r=>setImmediate(r));
const T0=1790000000000;
const SHOP=read('js/shopify.js'),DRAFTS=read('js/ph-mod-drafts.js'),MON=read('js/ph-mod-monitor.js'),UI=read('js/ph-ui.js');
const NA=read('tests/shopify-needs-attention.test.js');
const FX=eval('('+NA.slice(NA.indexOf('function fixture(a){'),NA.indexOf('async function checks')).replace(/^function fixture/,'function')+')');
const ISS=read('tests/ph-issue.test.js');
const makeDb=eval('('+ISS.slice(ISS.indexOf('function makeDb('),ISS.indexOf('const MASTER=')).replace(/\s*$/,'')+')');
const SPLIT='_siAxSizeSplit=()=>({ok:true,rows:[{size:"S",units:300},{size:"M",units:388},{size:"L",units:200},{size:"XXL",units:0}]})';

function mkApp(src,o){
  o=o||{};
  const db=makeDb(o.seed||{});
  const reads=[];
  const api=Object.assign({},db.api);
  const g0=api.getDocs;api.getDocs=async q=>{reads.push(q.path);return g0(q);};
  const store={};
  const a=harness.loadApp({files:o.noPh?[]:['js/shared.js','js/pos.js','js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js','js/ph-ui.js'],currentPage:'dashboard',
    session:{uid:'u1',u:o.user||'mustafa',name:'Mustafa',role:o.user==='afnan'?'owner':'manager'},
    globals:Object.assign({},api,{auth:{currentUser:{getIdToken:async()=>{}}},navigator:{onLine:o.offline?false:true,userAgent:o.ua||'Mozilla/5.0 (iPhone)',maxTouchPoints:5},
      localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},_poEmbellishment:null},o.globals||{})});
  a.ctx.console={log(){},warn(){},error(){}};
  if(!o.noPh){domkit.install(a.ctx);vm.runInContext(src.drafts,a.ctx,{filename:'ph-mod-drafts.js'});}
  vm.runInContext(src.shop,a.ctx,{filename:'shopify.js'});
  a.run('globalThis.__toasts=[];showToast=function(m,b){__toasts.push(String(m));};');
  a.run('allPOs=[];allPasses=[];');
  FX(a);
  a.run(SPLIT);
  a.run('session='+J({uid:'u1',u:o.user||'mustafa',name:'Mustafa',role:o.user==='afnan'?'owner':'manager'}));
  a.db=db;a.reads=reads;a.store=store;
  a.toasts=()=>a.run('__toasts.slice()');
  a.setPos=(list,state)=>{const m={};list.forEach(p=>{(m[p[0]]=m[p[0]]||[]).push({id:p[1],code:p[0],qty:p[2],day:p[3]});});a.run('_siPoByCode=new Map(Object.entries('+J(m)+'));_siPoState='+J(state||'ok')+';_siPoVer++;_siPoMemo=null');};
  a.setPos([]);
  return a;
}
const draftsOf=a=>[...a.db.docs.keys()].filter(k=>/^po_drafts\/[^/]+$/.test(k));

async function checks(src){
  const o={};
  // ── happy path as a manager, from a phone ──
  const a=mkApp(src);
  const r=await a.run('window._siRestockDraft("R10")');
  const ids=draftsOf(a);
  const d=ids.length===1?a.db.get(ids[0]):null;
  o['mustafa on a phone starts R10: one po_drafts document, status draft, rev 1, entryDevice pc, created by mustafa']=r.ok===true&&!!d&&d.status==='draft'&&d.rev===1&&d.entryDevice==='pc'&&d.createdBy==='mustafa';
  o['qty is the HIGH end of the guide (888, not 528)']=!!d&&d.po.qty===888;
  o['sizes are the split keyed through phSizeKey: S 300, M 388, L 200 (a 0 size and nothing else)']=!!d&&J(d.po.sizes)==='{"S":300,"M":388,"L":200}';
  o['source carries kind restock, the day, the guide 528..888 and the band']=!!d&&d.po.source&&d.po.source.kind==='restock'&&d.po.source.lo===528&&d.po.source.hi===888&&d.po.source.band==='critical'&&/^\d{4}-\d{2}-\d{2}$/.test(d.po.source.day);
  o['notes say the guide, the lead time and what is left to fill']=!!d&&/guide 528-888 pcs/.test(d.po.notes)&&/lead 21 d/.test(d.po.notes)&&/Fill fabric, cut master and dates/.test(d.po.notes);
  o['code is the article code, name is the Shopify title']=!!d&&d.po.code==='R10'&&typeof d.po.name==='string'&&d.po.name.length>0;
  // equal to a drafts-form save of the same fields
  const b=mkApp(src);
  const form=b.run('(()=>{const f=_phdBlank();f.code="R10";f.name='+J(d?d.po.name:'')+';f.qty="888";f.sizes={S:"300",M:"388",L:"200"};f.season='+J(d?d.po.season:'')+';return _phdToPo(f).po;})()');
  await b.run('phSaveDraft(null,'+J(form)+')');
  const fd=b.db.get(draftsOf(b)[0]);
  const strip=p=>{const x=clone(p);delete x.source;delete x.notes;return J(x);};
  o['the po map equals a drafts-form save of the same fields: same keys in the same order, same values (except source and notes)']=!!d&&!!fd&&strip(d.po)===strip(fd.po);
  o['the draft document has exactly the keys a form-made draft has']=!!d&&!!fd&&J(Object.keys(d))===J(Object.keys(fd));
  o['a form-made draft carries no source key']=!!fd&&!('source' in fd.po);
  // season: saved wins, else a guess labelled in the notes
  const sg=await (async()=>{const x=mkApp(src);x.run('_siMeta.set("R10",{season:"summer",type:null})');await x.run('window._siRestockDraft("R10")');return x.db.get(draftsOf(x)[0]);})();
  o['season: the saved season is used and not called a guess']=sg.po.season==='summer'&&!/is a guess/.test(sg.po.notes);
  const guess=a.run('phSeasonOfDay(_siPktDate(0)).season');
  o['season: with none saved, the guess from today\'s date is used and labelled a guess in the notes']=!!d&&d.po.season===(guess||'')&&(!guess||/is a guess/.test(d.po.notes));
  // dedupe against drafts
  const r2=await a.run('window._siRestockDraft("R10")');
  o['a second start for R10 is refused: exists, names the existing draft, no second document']=r2.ok===false&&r2.code==='exists'&&draftsOf(a).length===1&&a.toasts().some(t=>/already exists/.test(t));
  const c=mkApp(src,{seed:{'po_drafts/DRAFT-X-1':{id:'DRAFT-X-1',status:'ready',rev:2,po:{code:'R9'},createdBy:'uzaib'},'po_drafts/DRAFT-X-2':{id:'DRAFT-X-2',status:'abandoned',rev:2,po:{code:'R8'}},'po_drafts/DRAFT-X-3':{id:'DRAFT-X-3',status:'issued',rev:2,po:{code:'R7'}}}});
  const rr=await c.run('window._siRestockDraft("R9")');
  o['a READY draft for the code blocks a new one']=rr.ok===false&&rr.code==='exists'&&draftsOf(c).length===3;
  const r8=await c.run('window._siRestockDraft("R8")'),r7=await c.run('window._siRestockDraft("R7")');
  o['an abandoned or an issued draft does not block']=r8.ok===true&&r7.ok===true&&draftsOf(c).length===5;
  // drafts unreadable
  const e=mkApp(src);e.db.fail.getDocs=p=>p==='po_drafts'?Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'}):null;
  const re=await e.run('window._siRestockDraft("R10")');
  o['the drafts could not be read: refused (unread), nothing written, never a guess']=re.ok===false&&re.code==='unread'&&draftsOf(e).length===0;
  // open POs
  const f=mkApp(src);f.setPos([['O1','PO-1',240,'2026-08-25']]);
  const rf=await f.run('window._siRestockDraft("O1")');
  o['an open PO of 240 covers O1: refused, nothing written']=rf.ok===false&&rf.code==='refused'&&draftsOf(f).length===0;
  const g=mkApp(src);g.setPos([['O1','PO-1',100,'2026-08-25']]);
  await g.run('window._siRestockDraft("O1")');
  const gd=g.db.get(draftsOf(g)[0]);
  o['a partial PO of 100 on O1: the draft is the deducted guide (qty 144), source.onOrder 100, the notes say so']=!!gd&&gd.po.qty===144&&gd.po.source.onOrder===100&&/100 already on order and deducted/.test(gd.po.notes);
  const h=mkApp(src);h.run('_siPoState="loading"');
  const rh=await h.run('window._siRestockDraft("R10")');
  o['open POs still loading: refused, nothing written']=rh.ok===false&&rh.code==='loading'&&draftsOf(h).length===0;
  const hh=mkApp(src);hh.setPos([],'error');
  await hh.run('window._siRestockDraft("R10")');
  o['open POs unreadable: the draft is made and the notes say on order is unknown']=draftsOf(hh).length===1&&/on order unknown/.test(hh.db.get(draftsOf(hh)[0]).po.notes);
  const nr=mkApp(src);
  const rn=await nr.run('window._siRestockDraft("D1")');
  o['an article that is not a suggestion (dead stock D1): refused, nothing written']=rn.ok===false&&rn.code==='refused'&&draftsOf(nr).length===0;
  // an axis size that does not exist for the article is named, not renamed
  const od=mkApp(src);od.run('_siAxSizeSplit=()=>({ok:true,rows:[{size:"S",units:400},{size:"One size",units:488}]})');
  await od.run('window._siRestockDraft("R10")');
  const odd=od.db.get(draftsOf(od)[0]);
  o['a size the axis does not know is left out of the sizes and named in the notes']=J(odd.po.sizes)==='{"S":400}'&&/One size 488/.test(odd.po.notes)&&odd.po.qty===888;
  const ns=mkApp(src);ns.run('_siAxSizeSplit=()=>({ok:false,why:"x"})');
  await ns.run('window._siRestockDraft("R10")');
  const nsd=ns.db.get(draftsOf(ns)[0]);
  o['no size split: qty is set, sizes empty, the notes say to enter them by hand']=J(nsd.po.sizes)==='{}'&&nsd.po.qty===888&&/enter the sizes by hand/.test(nsd.po.notes);
  // audience
  let allowed=0,refusedOk=0;
  for(const u of ['afnan','ammar','mustafa']){const x=mkApp(src,{user:u});const rx=await x.run('window._siRestockDraft("R10")');if(rx.ok===true&&draftsOf(x).length===1)allowed++;}
  for(const u of ['uzaib','raees','arfat','claude','nobody']){const x=mkApp(src,{user:u});const rx=await x.run('window._siRestockDraft("R10")');if(rx.ok===false&&rx.code==='forbidden'&&draftsOf(x).length===0&&x.db.log.commits===0)refusedOk++;}
  o['managers only: afnan, ammar and mustafa start a draft']=allowed===3;
  o['managers only: uzaib, raees, arfat, the QA account and a stranger are refused with nothing written']=refusedOk===5;
  const cardM=mkApp(src,{user:'mustafa'}).run('_siRestockCardHtml()'),cardNo=mkApp(src,{noPh:true}).run('_siRestockCardHtml()');
  o['the card row carries a Start a PO draft button for a manager']=/class="si-ax-btn si-rs-draft" data-code="R10"/.test(cardM);
  o['no button when Production Ops is not loaded (nobody can start what cannot be saved)']=cardNo.indexOf('si-rs-draft')<0&&cardNo.indexOf('si-rs-row')>=0;
  // offline, double press, reads
  const off=mkApp(src,{offline:true});
  const ro=await off.run('window._siRestockDraft("R10")');
  o['offline: refused out loud, nothing written']=ro.ok===false&&ro.code==='offline'&&draftsOf(off).length===0;
  const dp=mkApp(src);
  const [p1,p2]=await Promise.all([dp.run('window._siRestockDraft("R10")'),dp.run('window._siRestockDraft("R10")')]);
  o['a double press makes one draft']=draftsOf(dp).length===1&&[p1,p2].filter(x=>x.ok).length===1;
  o['no read beyond the drafts list: every getDocs is po_drafts (once per session)']=a.reads.length>=1&&a.reads.every(p=>p==='po_drafts')&&a.reads.length===1;
  // source survives a form save
  await a.run('phLoadStage("drafts",{force:true})');
  const did=ids[0].split('/')[1];
  const kept=a.run('(()=>{const row=phGet("drafts").rows.find(r=>r.fbKey==='+J(did)+');const f=_phdFromPo(row.po);f.notes+=" edited";return _phdToPo(f).po;})()');
  o['_phdFromPo/_phdToPo round trip keeps the source']=J(kept.source)===J(d.po.source);
  const rs=await a.run('phSaveDraft('+J(did)+','+J(kept)+',{expectedRev:1})');
  o['a form save of that draft keeps source in Firestore (rev 2)']=rs.ok===true&&J(a.db.get(ids[0]).po.source)===J(d.po.source)&&a.db.get(ids[0]).rev===2;
  const hostile=a.run('_phdFromPo({source:{kind:"other",hi:5}}).source')===null&&a.run('JSON.stringify(_phdFromPo({source:{kind:"restock",day:"2026-10-14",hi:5,evil:"<img onerror=1>",lo:"x"}}).source)')==='{"kind":"restock","day":"2026-10-14","lo":null,"hi":5,"onOrder":null,"band":""}';
  o['an unknown source kind is dropped and unknown source fields never carried']=hostile;
  const uz=mkApp(src,{user:'uzaib'});
  const u0=uz.db;u0.docs.set(ids[0],{v:1,data:clone(a.db.get(ids[0]))});
  const ru=await uz.run('phSaveDraft('+J(did)+','+J(kept)+',{expectedRev:2})');
  o['Kashif (uzaib) can edit the restock draft and the source survives his save']=ru.ok===true&&J(uz.db.get(ids[0]).po.source)===J(d.po.source);
  const node=a.run('_phdRowNode(phGet("drafts").rows.find(r=>r.fbKey==='+J(did)+'),null)');
  const txt=domkit.toHtml(node);
  o['the draft list shows "From restock" on that draft']=/From restock/.test(txt);
  const plainRow=a.run('_phdRowNode({fbKey:"DRAFT-P-1",rev:1,status:"draft",po:{code:"Z1"}},null)');
  o['a form-made draft shows no "From restock" chip']=!/From restock/.test(domkit.toHtml(plainRow));
  return o;
}

/* ── the Production Ops Overview card ── */
function cardApp(mon,val,o){
  o=o||{};
  const app=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-i18n.js'],currentPage:'prod-ops',session:{uid:'u',u:'afnan',name:'A',role:'owner'},
    globals:{localStorage:{getItem:k=>{if(o.throws)throw new Error('blocked');return k==='groovy-si-restock-last'?val:null;},setItem(){},removeItem(){}}}});
  domkit.install(app.ctx);app.ctx.console={log(){},warn(){},error(){}};
  vm.runInContext(UI,app.ctx,{filename:'ph-ui.js'});vm.runInContext(mon,app.ctx,{filename:'ph-mod-monitor.js'});
  return app;
}
const cardHtml=(mon,val,o)=>{const a=cardApp(mon,val,o);return domkit.toHtml(a.run('phmRestockCard()'));};
async function cardChecks(mon){
  const o={};
  const snap=(extra)=>J(Object.assign({day:'2026-10-14',n:7,critical:2,rows:[{code:'G1',label:'Tee — Blue',lo:12,hi:24,band:'critical'},{code:'G2',label:'Hoodie',lo:24,hi:60,band:'act'}]},extra||{}));
  let h=cardHtml(mon,snap());
  o['card ok: lists the rows as "CODE name — hi pcs"']=/G1 Tee — Blue — 24 pcs/.test(h)&&/G2 Hoodie — 60 pcs/.test(h);
  o['card ok: says "As of 2026-10-14, from this device\'s Inventory Intel. Not live."']=/As of 2026-10-14, from this device&#39;s Inventory Intel\. Not live\.|As of 2026-10-14, from this device's Inventory Intel\. Not live\./.test(h);
  o['card ok: 7 in all with 2 shown says so']=/7 articles in all; the top 2 are listed/.test(h);
  o['card ok: a snapshot older than today is marked older']=/This is older than today/.test(h);
  o['card never claims to be fresh or live']=!/\bfresh\b|updated just now|live data/i.test(h.replace(/Not live/g,''));
  h=cardHtml(mon,null);
  o['card none: no snapshot says "No restock list has been computed on this device" and offers Inventory Intel, never an empty list']=/No restock list has been computed on this device/.test(h)&&!/phm-rs-list/.test(h)&&/Open Inventory Intel/.test(h);
  h=cardHtml(mon,'{not json');
  o['card unreadable: broken JSON is said to be unreadable (alert), never "nothing needs a restock"']=/could not be read on this device/.test(h)&&/role="alert"/.test(h)&&!/nothing needed a restock/.test(h);
  h=cardHtml(mon,J({day:'x',n:3,rows:[]}));
  o['card unreadable: a snapshot of the wrong shape is unreadable too']=/could not be read on this device/.test(h);
  h=cardHtml(mon,J({day:'2026-10-14',n:3,rows:[]}));
  o['card unreadable: a count with no rows is unreadable, not empty']=/could not be read on this device/.test(h);
  h=cardHtml(mon,null,{throws:true});
  o['card unreadable: storage that throws is unreadable']=/could not be read on this device/.test(h);
  h=cardHtml(mon,J({day:'2026-10-14',n:0,critical:0,rows:[]}));
  o['card empty: computed with nothing due says so, with the as-of day']=/nothing needed a restock/.test(h)&&/As of 2026-10-14/.test(h);
  h=cardHtml(mon,snap({rows:[{code:'<img src=x onerror=alert(1)>',label:'<b>x</b>',lo:1,hi:5,band:'act'}],n:1}));
  o['hostile code and name are text, never markup']=h.indexOf('<img')<0&&h.indexOf('<b>x')<0;
  h=cardHtml(mon,snap({rows:[1,2,3,4,5,6,7].map(i=>({code:'C'+i,label:'n',lo:1,hi:i,band:'act'})),n:9}));
  o['at most five rows are listed']=(h.match(/phm-rs-row/g)||[]).length===5;
  const a=cardApp(mon,snap());
  const fl=a.run('(()=>{const host=document.createElement("div");try{_phmRenderOverview(host,{canManage:false,readOnly:true,user:"uzaib",status:{},get:()=>({}),el:phEl,clear(){},repaint(){},reload(){return Promise.resolve();}});}catch(e){return "threw "+e.message;}return String(host.children?host.children.length:0);})()');
  o['the card is a manager\'s: the floor Overview (uzaib) does not render it']=!/restock/.test(domkit.toHtml(a.run('(()=>{const host=document.createElement("div");try{_phmRenderOverview(host,{canManage:false,readOnly:true,user:"uzaib",status:{},get:()=>({}),el:phEl,clear(){},repaint(){},reload(){return Promise.resolve();}});}catch(e){}return host;})()')));
  return o;
}
module.exports=async function(){
  const s=suite('shopify-restock-draft');
  const S0={shop:SHOP,drafts:DRAFTS};
  const base=await checks(S0),cbase=await cardChecks(MON);
  s.section('Start a PO draft: shape equals a form save, dedupe, managers only, source survives, list chip (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('Production Ops Overview restock card: honest states, text only');
  Object.keys(cbase).forEach(k=>s.ok(k,cbase[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const K=Object.keys(base),k=t=>K.find(x=>x.indexOf(t)===0),CK=Object.keys(cbase),ck=t=>CK.find(x=>x.indexOf(t)===0);
  const brk=async(label,which,from,to,failing,isCard)=>{
    const text={shop:SHOP,drafts:DRAFTS,mon:MON}[which];
    if(text.split(from).length-1<1){s.ok('break target exists: '+label,false);return;}
    const m=text.split(from).join(to);
    let r;try{r=isCard?await cardChecks(m):await checks({shop:which==='shop'?m:SHOP,drafts:which==='drafts'?m:DRAFTS});}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  await brk('manager gate dropped','shop',"if(!_siRestockCanDraft()){_siRestockToast('Starting a PO draft is for","if(false){_siRestockToast('Starting a PO draft is for",[k('managers only: uzaib')]);
  await brk('button shown to everyone','shop',"${_siRestockCanDraft()?`<button","${true?`<button",[k('no button when Production Ops')]);
  await brk('twin check dropped','shop',"if(twin){const id=","if(false){const id=",[k('a second start'),k('a READY draft')]);
  await brk('issued/abandoned block too','shop',"(r.status==='draft'||r.status==='ready')","(true)",[k('an abandoned or an issued')]);
  await brk('unread drafts guessed as none','shop',"if(!g||!g.ok||!Array.isArray(g.rows)){","if(false){",[k('the drafts could not be read')]);
  await brk('pick not used (any issue)','shop',".issues.filter(_siRestockPick).find(i=>String(i.code).toUpperCase()===c)",".issues.find(i=>String(i.code).toUpperCase()===c)",[k('an article that is not a suggestion'),k('an open PO of 240')]);
  await brk('po loading ignored','shop',"if(_siPoState==='loading'||_siPoState==='idle'){","if(false){",[k('open POs still loading')]);
  await brk('low end used','shop',"const q=issue.n.qty,hi=q.hi,","const q=issue.n.qty,hi=q.lo,",[k('qty is the HIGH end')]);
  await brk('on order dropped from source','shop',"f.source={kind:'restock',day,lo:q.lo,hi:q.hi,onOrder,band:issue.band};","f.source={kind:'restock',day,lo:q.lo,hi:q.hi,onOrder:null,band:issue.band};",[k('a partial PO of 100')]);
  await brk('odd sizes not named','shop',"+(odd.length?' Sizes not on","+(false?' Sizes not on",[k('a size the axis does not know')]);
  await brk('saved season ignored','shop',"if(saved){f.season=saved;}","if(false){f.season=saved;}",[k('season: the saved season')]);
  await brk('busy guard dropped','shop',"if(_siRestockBusy.has(code))return{ok:false,code:'busy'};","",[k('a double press')]);
  await brk('form not used for the po (ratio lost)','shop',"const t=_phdToPo(f);","const t=_phdToPo(f);t.po.ratio='';",[k('the po map equals a drafts-form save')]);
  await brk('source dropped on form save','drafts',"  if(f.source)po.source=_phdCleanSource(f.source);","",[k('_phdFromPo/_phdToPo round trip'),k('a form save of that draft keeps source')]);
  await brk('source not read from the stored po','drafts',"  f.source=_phdCleanSource(p.source);\n","",[k('_phdFromPo/_phdToPo round trip'),k('Kashif (uzaib)')]);
  await brk('source cleaning off','drafts',"if(!x||typeof x!=='object'||Array.isArray(x)||x.kind!=='restock')return null;","if(!x||typeof x!=='object')return null;",[k('an unknown source kind')]);
  await brk('chip dropped','drafts',"if(_phdCleanSource(po.source))chips.appendChild(","if(false)chips.appendChild(",[k('the draft list shows')]);
  await brk('chip on every draft','drafts',"if(_phdCleanSource(po.source))chips.appendChild(","if(true)chips.appendChild(",[k('a form-made draft shows no')]);
  await brk('card unreadable shown as none','mon',"if(raw==null||raw==='')return{state:'none'};\n  let r=null;\n  try{r=JSON.parse(raw);}catch(e){return{state:'unreadable'};}","if(raw==null||raw==='')return{state:'none'};\n  let r=null;\n  try{r=JSON.parse(raw);}catch(e){return{state:'none'};}",[ck('card unreadable: broken JSON')],true);
  await brk('card storage throw shown as none','mon',"try{raw=localStorage.getItem(PHM_RESTOCK_KEY);}catch(e){return{state:'unreadable'};}","try{raw=localStorage.getItem(PHM_RESTOCK_KEY);}catch(e){return{state:'none'};}",[ck('card unreadable: storage that throws')],true);
  await brk('count with no rows read as empty','mon',"if(r.n>0&&!rows.length)return{state:'unreadable'};","",[ck('card unreadable: a count with no rows')],true);
  await brk('as-of line dropped','mon',"card.appendChild(E('p','phm-rs-asof',phI18nD('ov.restock_asof',{day:R.day})));","",[ck('card ok: says "As of')],true);
  await brk('older note dropped','mon',"if(today&&R.day<today)","if(false)",[ck('card ok: a snapshot older')],true);
  await brk('row cap off','mon',".slice(0,5);\n  if(r.n>0&&!rows.length)",".slice(0,50);\n  if(r.n>0&&!rows.length)",[ck('at most five rows')],true);
  await brk('empty hides the day','mon',"if(R.state==='empty')card.appendChild(E('p','ph-note',phI18nD('ov.restock_empty')));","if(R.state==='empty'){}",[ck('card empty')],true);
  s.ok('breaks run: '+broken,broken>=28);
  return s;
};
module.exports._checks=checks;

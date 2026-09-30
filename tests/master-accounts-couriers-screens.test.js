/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts M2 — the courier screens (29 Sept 2026)

   Money in ▸ Couriers, a CPR on the rail, the Collection form, "Run now",
   and what Today does with a collection. Every test runs the REAL page code
   (js/ma-core.js + js/master-accounts.js) against a stubbed Firestore that
   records what is read and written; each guard was undone once and a named
   assertion failed (the list is in the commit message).

   - a refused ma_cpr / ma_collection / ma_runs read is NEVER fatal: the
     other pages keep working, and what depends on it says "incomplete —
     <collection> could not be read";
   - the page paints from fixtures: no tiles, a tick per uncollected CPR,
     recent collections, PostEx's transit and the rollup's "as of";
   - ticked rows preselect the Collection form, with their net as the amount;
   - a CPR that already has a live collection is refused — against memory AND
     against a FRESH read of ma_collection just before the write;
   - the drawer (1010) holder produces a pending collection Raees's paper
     confirms; the receipt is required once attachments are on and only
     flagged while they are off;
   - the Courier statement form (TCS and Bykea, typed line by line): the
     totals as typed, the statement required once attachments are on, a
     statement a collection covers keeps its day and lines, edit and void;
   - the collection receipt (PDF) and Share receipt on a collection's rail;
   - "Run now": owners only, posts the ID token, polls ma_runs for a newer
     `at`, times out out loud;
   - the rail reads a CPR's parcels on demand, and says when it could not;
   - every stored string is escaped.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;
const M=require('../js/ma-core.js');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const clone=v=>JSON.parse(JSON.stringify(v));
function memLS(){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];},_m:m};}

function mkApp(o){
  o=o||{};
  const db=o.seed?clone(o.seed):{};
  const S={tx:[],batches:[],sets:[],reads:[],fetches:[]};
  const col=c=>(db[c]=db[c]||{});
  const snap=(c,id)=>{const d=col(c)[id];return {exists:()=>d!==undefined,data:()=>clone(d===undefined?{}:d)};};
  const globals=Object.assign({
    localStorage:o.ls||memLS(),
    doc:(_db,c,id)=>({col:c,id}),
    collection:(_db,c)=>({col:c}),
    query:(c,...w)=>Object.assign({},c,{where:w.filter(x=>x&&x.field)}),orderBy:()=>({}),limit:()=>({}),
    where:(field,op,value)=>({field,op,value}),
    getDocs:async q=>{
      S.reads.push(q.col);
      if((o.fail||[]).indexOf(q.col)>=0)throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      let ids=Object.keys(col(q.col));
      (q.where||[]).forEach(w=>{ids=ids.filter(id=>col(q.col)[id][w.field]===w.value);});
      return {docs:ids.map(id=>({id,data:()=>clone(col(q.col)[id])}))};
    },
    runTransaction:async(_db,fn)=>{
      if(o.txFail)throw o.txFail;
      const ops=[];S.tx.push(ops);
      await fn({get:async ref=>snap(ref.col,ref.id),set:(ref,d)=>{ops.push({op:'set',col:ref.col,id:ref.id,data:clone(d)});},update:(ref,d)=>{ops.push({op:'update',col:ref.col,id:ref.id,data:clone(d)});}});
      ops.forEach(x=>{if(x.op==='set')col(x.col)[x.id]=clone(x.data);else col(x.col)[x.id]=Object.assign({},col(x.col)[x.id],clone(x.data));});
    },
    writeBatch:()=>{const ops=[];S.batches.push(ops);return{set(ref,d){ops.push({op:'set',col:ref.col,id:ref.id,data:clone(d)});},async commit(){ops.forEach(x=>{col(x.col)[x.id]=clone(x.data);});}};},
    setDoc:async(ref,d)=>{S.sets.push({col:ref.col,id:ref.id,data:clone(d)});},
    fetch:async(url,init)=>{S.fetches.push({url:String(url),init:init||{}});return o.fetch?o.fetch(url,init,db):{ok:true,status:202,json:async()=>({})};},
    loadAccountsData:async()=>{},_acctBalances:()=>({cash:0}),_acctLoadErr:null,
    auth:{currentUser:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{lastSignInTime:new Date().toUTCString()},getIdToken:async()=>'t_afnan'}}
  },o.globals||{});
  const app=harness.loadApp({files:['js/ma-core.js','js/master-accounts.js'],currentPage:o.page||'ma-in',
    session:o.session||{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},globals});
  return {app,S,db};
}
function unesc(v){return String(v).replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function attr(a,name){const m=new RegExp('(?:^|\\s)'+name+'="([^"]*)"').exec(a);return m?unesc(m[1]):null;}
function hold(app,html){
  const out={};let m;
  const reS=/<select\b([^>]*)>([\s\S]*?)<\/select>/g;
  while((m=reS.exec(html))){
    const id=attr(m[1],'id');if(!id)continue;
    const opts=[];const reO=/<option\b([^>]*)>([^<]*)/g;let o;
    while((o=reO.exec(m[2])))opts.push({v:attr(o[1],'value'),sel:/\sselected\b/.test(o[1]),t:unesc(o[2])});
    const pick=opts.find(x=>x.sel)||opts[0];
    out[id]={value:pick?pick.v:'',opts};
  }
  const reI=/<input\b([^>]*)>/g;
  while((m=reI.exec(html))){const id=attr(m[1],'id');if(!id)continue;
    if(attr(m[1],'type')==='checkbox')out[id]={checked:/\schecked\b/.test(m[1])};else out[id]={value:attr(m[1],'value')||''};}
  const reT=/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g;
  while((m=reT.exec(html))){const id=attr(m[1],'id');if(!id)continue;out[id]={value:unesc(m[2])};}
  Object.keys(out).forEach(id=>{const e=app.el(id);if('checked' in out[id])e.checked=out[id].checked;else e.value=out[id].value;});
  return out;
}
function untouched(app){
  Object.keys(app.nodes).forEach(k=>{if(/^ma-f-|^ma-l-/.test(k))delete app.nodes[k];});
  return hold(app,app.bodyHtml('ma-modal-back'));
}
const set=(app,id,v)=>{app.el(id).value=v;};
const txt=h=>String(h).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
/* What the form says is wrong: the issues box and every field's error line. */
const said=app=>txt(app.run("(document.getElementById('ma-f-issues')||{}).innerHTML+' '+_MA_FIELDS.map(f=>{const e=document.getElementById('ma-e-'+f);return e?e.textContent:''}).join(' ')"));

/* ── The fixtures: PostEx's derived documents from the core's own fixture ── */
const SET=M.maSettings(null);
const IDX=M.maChartIndex(M.maChart('groovy',[]));
let pseq=0;
const px=o=>{pseq++;return Object.assign({trackingNumber:'PX'+String(pseq).padStart(5,'0'),status:'Delivered',statusCategory:'delivered',dispatched:true,
  transactionDate:'2026-07-08T10:00:00',orderPickupDate:'2026-07-09T09:00:00',orderDeliveryDate:'2026-07-10T16:00:00',cod:3000,transactionFee:180,transactionTax:28.8,
  reversalFee:0,reversalTax:0,upfrontPayment:0,reservePayment:0,balancePayment:0,syncedAt:1790000000000,cprCheckedAt:1790100000000},o);};
const PARCELS=[
  px({trackingNumber:'PA',cod:3000,cprNumber_1:'JUL-1',cpr1Date:'2026-07-14',upfrontPayment:2400}),
  px({trackingNumber:'PB',cod:2000,cprNumber_1:'JUL-1',cpr1Date:'2026-07-14',upfrontPayment:1500,cprNumber_2:'JUL-2',cpr2Date:'2026-07-21',reservePayment:200}),
  px({trackingNumber:'PC',cod:1000,transactionFee:100,transactionTax:16,cprNumber_1:'JUL-3',cpr1Date:'2026-07-28',upfrontPayment:800}),
  px({trackingNumber:'PD',status:'En-Route',statusCategory:'in_transit',orderDeliveryDate:null,cod:1800})
];
const DER=M.maCprDerive(PARCELS,{from:'2026-07-01',today:'2026-08-05'});
const CPRS=M.maCourierDocs(DER,SET).filter(d=>['upfront','reserve','mixed'].indexOf(d.kind)>=0);
const CPR_DB={};M.maCourierDocs(DER,SET).forEach(d=>{CPR_DB[d.id]=d;});
const RUN=()=>({id:'rollup',state:'done',ok:true,at:Date.UTC(2026,8,29,3,45),day:'2026-09-29',parcels:4,created:6,updated:0,voided:0,transit:DER.transit,issueCount:0,issues:[],checks:{}});
const ATT={publicId:'ma/'+'a'.repeat(64),format:'jpg',type:'authenticated',resourceType:'image'};
function seedBase(extra){
  return Object.assign({ma_cpr:clone(CPR_DB),ma_runs:{rollup:RUN()},postex_orders:{
    PA:Object.assign({},PARCELS[0]),PB:Object.assign({},PARCELS[1]),PC:Object.assign({},PARCELS[2]),PD:Object.assign({},PARCELS[3])}},extra||{});
}
/* A collection the way the writer stores it — built by the core. */
function coll(input,meta,no){
  const d=M.maBuildDoc('collection',input,Object.assign({by:'afnan',byName:'Afnan',ts:1790000000000,cprs:CPRS},meta||{}),IDX,SET);
  d.no=no;d.id=no;return d;
}
const NET=id=>(CPRS.find(d=>d.id===id)||{}).net;

module.exports=async function(){
  const s=suite('master-accounts-couriers-screens');

  s.section('the fixture is what the tests think it is');
  {
    s.eq('three receipts derived from the parcels',CPRS.map(d=>d.id+':'+d.kind).join(' '),'postex-JUL-1:upfront postex-JUL-2:reserve postex-JUL-3:upfront');
    s.ok('each has a net worth collecting',CPRS.every(d=>d.net>0),J(CPRS.map(d=>d.net)));
  }

  s.section('a refused courier read is never fatal — and is never a zero');
  {
    const {app}=mkApp({seed:seedBase(),fail:['ma_cpr','ma_collection','ma_runs'],page:'ma-overview'});
    await app.run('maLoad()');
    s.eq('none of the three is a core read',J(app.run('_maCoreErrs().map(e=>e.col)')),J([]));
    s.eq('…and the loader names all three as missing',J(app.run('_maMissing()')),J(['ma_cpr','ma_collection','ma_runs']));
    const today=app.run("_maPageHTML('ma-overview')");
    s.ok('Today still paints — no error card',/Cash in hand/.test(today)&&!/ma-errcard/.test(today.replace(/ma-errcard-acts/g,'')),txt(today).slice(0,160));
    const hero=(/<div class="ma-stat hero">[\s\S]*?<\/div><\/div>/.exec(today)||[''])[0];
    s.ok('the hero — cash in hand — says it is incomplete, naming the collections',/incomplete — ma_cpr and ma_collection could not be read/.test(txt(hero)),txt(hero));
    s.ok('…and so does what is owed to us, and what is expected in',/incomplete/.test(txt((/Owed to us less we owe[\s\S]*?<\/div><\/div>/.exec(today)||[''])[0]))&&/Expected in[^A-Z]*none expected\s*incomplete — ma_cpr/.test(txt(today)),txt(today).slice(0,600));
    const na=JSON.parse(app.run('JSON.stringify(_maAttention(_maCtx()).map(x=>x.sentence))'));
    s.ok('Needs attention names each unreadable collection and the rollup, and no line claims a CPR is "not collected" (the collections are unreadable)',na.some(x=>/ma_cpr could not be read/.test(x))&&na.some(x=>/ma_collection could not be read/.test(x))&&na.some(x=>/rollup.*could not be read/.test(x))&&!na.some(x=>/not collected/.test(x)),J(na));
    for(const id of ['ma-money','ma-out','ma-parties','ma-ledger','ma-close']){
      let h='';try{h=app.run("_maPageHTML('"+id+"')");}catch(e){h='THREW '+e.message;}
      s.ok(id+' still paints',/maRecord\(\)/.test(h),h.slice(0,80));
    }
    const inn=app.run("_maPageHTML('ma-in')");
    s.ok('Money in says incomplete, naming what could not be read',/incomplete — ma_cpr and ma_collection could not be read/.test(txt(inn)),txt(inn).slice(0,300));
    s.ok('…and offers no tick and no Record collection it could not stand behind',!/type="checkbox"/.test(inn)&&!/maRecordCollection/.test(inn));
    s.ok('…and the ma_runs line says so too',/incomplete — ma_runs could not be read/.test(txt(inn)));
    const dash=app.run('renderMasterAccountsDashboardWidget()');
    app.el('ma-dash-body').innerHTML='';
    await app.run('_maPopulateDashboard()');
    s.ok('the Dashboard card does not turn into an error either',!/Could not read ma_/.test(app.el('ma-dash-body').textContent||app.el('ma-dash-body').innerHTML)&&/cash in hand/.test(app.el('ma-dash-body').innerHTML),app.el('ma-dash-body').innerHTML);
    app.run("window.maRecordKind('money_out')");
    s.ok('and a document can still be recorded',app.run('_maF!==null'));
  }
  {
    // Only the collections unreadable: every statement would read as uncollected.
    const {app}=mkApp({seed:seedBase(),fail:['ma_collection']});
    await app.run('maLoad()');
    const na=JSON.parse(app.run('JSON.stringify(_maAttention(_maCtx()).map(x=>x.sentence))'));
    s.ok('with ma_collection unreadable, no CPR is reported "not collected"',!na.some(x=>/not collected/.test(x))&&na.some(x=>/ma_collection could not be read/.test(x)),J(na));
    const cal=JSON.parse(app.run('JSON.stringify(_maCalendarOf(_maCtx()).days.reduce((n,d)=>n+d.events.filter(e=>e.cpr).length,0))'));
    s.eq('…nor does the calendar expect them in',cal,0);
  }

  s.section('the page paints from fixtures — no tiles, a tick per uncollected CPR');
  {
    const {app}=mkApp({seed:seedBase()});
    await app.run('maLoad()');
    const h=app.run("_maPageHTML('ma-in')");
    const t=txt(h);
    s.ok('the header names the page, with the Record button',/Money in/.test(t)&&/maRecord\(\)/.test(h));
    s.ok('it lists the four couriers',['PostEx','TCS','Bykea','Blue-Ex'].every(n=>t.indexOf(n)>=0));
    s.ok('no stat tiles (those are Today\'s and a party\'s)',!/ma-stats|ma-stat\b/.test(h));
    s.ok('every uncollected CPR has a checkbox',CPRS.every(d=>new RegExp('maCourierTick\\(\'postex\',\''+d.id+'\'').test(h)));
    s.ok('…and a row that opens it on the rail',CPRS.every(d=>h.indexOf("window.maOpenDoc('cpr','"+d.id+"')")>=0));
    s.ok('the summary line says what is owed and what is uncollected',/PostEx owes/.test(t)&&/3 CPRs not yet collected/.test(t),t.slice(0,400));
    s.ok('PostEx\'s transit: on the road, waiting for upfront, waiting for reserve',/On the road/.test(t)&&/Delivered, waiting for upfront/.test(t)&&/Waiting for reserve/.test(t));
    s.ok('the rollup\'s "as of" line, from ma_runs/rollup',/Rollup as of/.test(t)&&/4 parcels/.test(t),t);
    s.ok('an owner sees Run now',/onclick="window\.maRunNow\(\)"/.test(h));
    s.ok('Blue-Ex says it has no statements here',/Blue-Ex \(legacy\) owes/.test(t)&&/no statements here/.test(t));
    s.ok('the nav lists Money in, between Money and Money out',(()=>{const ids=JSON.parse(app.run('JSON.stringify(MA_PAGES.map(p=>p.id))'));return ids.indexOf('ma-in')===ids.indexOf('ma-money')+1&&ids.indexOf('ma-out')===ids.indexOf('ma-in')+1;})());
    // Recent collections
    const c1=coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-1'),date:'2026-08-01',cprNos:['postex-JUL-1'],attachments:[ATT]},{},'CL-27-0001');
    const c2=coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-2')-50,date:'2026-08-02',cprNos:['postex-JUL-2'],note:'short'},{},'CL-27-0002');
    const w=mkApp({seed:seedBase({ma_collection:{[c1.no]:c1,[c2.no]:c2}})});
    await w.app.run('maLoad()');
    const h2=w.app.run("_maPageHTML('ma-in')");
    s.ok('a collected CPR leaves the uncollected table',!/maCourierTick\('postex','postex-JUL-1'/.test(h2)&&/maCourierTick\('postex','postex-JUL-3'/.test(h2));
    s.ok('…and its collection is under Recent collections, with the difference and "no receipt"',/CL-27-0001/.test(h2)&&/CL-27-0002/.test(h2)&&/−₨50/.test(txt(h2))&&/no receipt/.test(txt(h2)),txt(h2).slice(0,900));
    // The core's own uncollected rule (money is money): tick list == maUncollected
    s.ok('the 30-day calendar expects the uncollected CPR in, late, on today (maCourierInflows)',(()=>{const cal=JSON.parse(w.app.run('JSON.stringify(_maCalendarOf(_maCtx()))'));return cal.days[0].events.some(e=>e.cpr==='postex-JUL-3'&&e.late===true&&e.dir==='in')&&cal.in>=800;})());
    s.eq('the ticks are exactly the core\'s uncollected receipts',J(JSON.parse(w.app.run("JSON.stringify(_maCollectable(_maCtx(),'postex').map(x=>x.doc.id))"))),J(['postex-JUL-3']));
  }

  s.section('the row filters from Needs attention: no receipt · differ · changed');
  {
    const c1=coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-1'),date:'2026-08-01',cprNos:['postex-JUL-1'],attachments:[ATT]},{},'CL-27-0001');
    const c2=coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-2'),date:'2026-08-02',cprNos:['postex-JUL-2']},{},'CL-27-0002');
    const {app}=mkApp({seed:seedBase({ma_collection:{[c1.no]:c1,[c2.no]:c2}})});
    await app.run('maLoad()');
    app.run("_maLastConcerns=[{action:{go:'couriers',courier:'postex',filter:'noreceipt'}}];window.maConcern(0)");
    s.eq('a courier concern sets the filter and the courier to scroll to',J(app.run('[_maCourierFilter,_maCourierFocus]')),J(['noreceipt','postex']));
    const h=app.run("_maPageHTML('ma-in')");
    s.ok('only the collection with no receipt is listed, under a line that says so',/CL-27-0002/.test(h)&&!/CL-27-0001/.test(h)&&/with no receipt/.test(txt(h)),txt(h).slice(0,500));
    s.ok('a courier with nothing that matches says so, rather than "none recorded yet"',/None of TCS’s collections match/.test(h)&&!/TCS[\s\S]{0,900}No collection recorded yet[\s\S]{0,20}Bykea/.test(txt(h)),txt(h).slice(0,200));
    app.run("window.maCourierFilter('')");
    s.ok('Show all clears it',/CL-27-0001/.test(app.run("_maPageHTML('ma-in')")));
  }

  s.section('Needs attention carries the rollup, and the courier holders are asked for only where wanted');
  {
    const sentences=app=>JSON.parse(app.run('JSON.stringify(_maAttention(_maCtx()).map(x=>x.sentence))'));
    const failed=mkApp({seed:seedBase({ma_runs:{rollup:Object.assign(RUN(),{state:'failed',error:'PostEx answered nothing'})}})});
    await failed.app.run('maLoad()');
    s.ok('a failed run is a concern on Today',sentences(failed.app).some(x=>/The courier rollup failed: PostEx answered nothing/.test(x)),J(sentences(failed.app)));
    const none=mkApp({seed:seedBase({ma_runs:{}})});
    await none.app.run('maLoad()');
    s.ok('a readable ma_runs with no run says the rollup has not run yet',sentences(none.app).some(x=>/has not run yet/.test(x)),J(sentences(none.app)));
    const ok=mkApp({seed:seedBase()});
    await ok.app.run('maLoad()');
    s.ok('a healthy run says nothing about the rollup',!sentences(ok.app).some(x=>/rollup/.test(x)),J(sentences(ok.app)));
    s.eq('the rollup read is null when ma_runs holds no run…',none.app.run('_maRun()===null'),true);
    const refused=mkApp({seed:seedBase(),fail:['ma_runs']});
    await refused.app.run('maLoad()');
    s.eq('…undefined (unknown) when it was refused — never taken for "has not run"',refused.app.run('_maRun()===undefined'),true);
    s.ok('…and the run itself when there is one',ok.app.run("_maRun().id")==='rollup');
    // The TCS account: on the courier page's rows, not on Today's unless money moved.
    s.ok('the courier page asks for the courier holders (the TCS account is among them)',ok.app.run("_maCourierHolders(_maCtx()).some(h=>h.code==='1060')")===true);
    s.ok('Today\'s and Money\'s holder rows do not carry it while nothing has moved',ok.app.run("_maCtx().holders.every(h=>h.code!=='1060')")===true);
    s.ok('the TCS section reads what the account holds from those rows',/The TCS account holds <b>₨0<\/b>/.test(ok.app.run("_maPageHTML('ma-in')")));
  }

  s.section('ticked CPRs preselect the Collection form');
  {
    const {app}=mkApp({seed:seedBase()});
    await app.run('maLoad()');
    app.run("window.maCourierTick('tcs','postex-JUL-1',true);window.maCourierTick('postex','no-such-receipt',true)");
    s.eq('a tick on another courier\'s receipt, or on one that does not exist, is not kept',app.run('J=0;JSON.stringify(_maCourierPick)'),'{}');
    app.run("window.maCourierTick('postex','postex-JUL-1',true);window.maCourierTick('postex','postex-JUL-2',true)");
    const want=NET('postex-JUL-1')+NET('postex-JUL-2');
    s.ok('the button counts them and their net',/2 ticked · ₨/.test(app.run("_maRecLabel('postex',_maCollectable(_maCtx(),'postex'))"))&&app.run("_maRecLabel('postex',_maCollectable(_maCtx(),'postex'))").indexOf(M.maRs(want))>=0);
    app.run("window.maRecordCollection('postex')");
    const html=app.bodyHtml('ma-modal-back');
    s.ok('the form opens on Record a collection',/Record a collection/.test(html));
    s.ok('both ticked receipts are ticked in the form, the third is not',/value="postex-JUL-1" checked/.test(html)&&/value="postex-JUL-2" checked/.test(html)&&!/value="postex-JUL-3" checked/.test(html));
    const f=untouched(app);
    app.run('window.maCollPreview()');
    s.eq('the courier is PostEx',f['ma-f-courier'].value,'postex');
    s.eq('the amount starts on their combined net',f['ma-f-amount'].value,String(want));
    s.ok('the preview says what is expected',app.el('ma-f-prev').innerHTML.indexOf('Expected <b>'+M.maRs(want)+'</b>')>=0,app.el('ma-f-prev').innerHTML);
    // Ticking one more in the form moves the amount too (untouched amount).
    app.run("_maF.picks.push('postex-JUL-3');_maCollRepaintCovers()");
    s.eq('an untouched amount follows the ticks',app.el('ma-f-amount').value,String(want+NET('postex-JUL-3')));
    app.run("window.maCollAmount()");
    app.el('ma-f-amount').value='5';
    app.run("_maF.picks.pop();_maCollRepaintCovers()");
    s.eq('…a typed one is left alone',app.el('ma-f-amount').value,'5');
    // One collection can cover several (July to September in a few entries)
    s.ok('the form lists this courier\'s uncollected receipts only',(app.bodyHtml('ma-modal-back').match(/type="checkbox" value="postex-/g)||[]).length===3);
  }

  s.section('recording: the preview, the difference and who confirms');
  {
    const {app,S,db}=mkApp({seed:seedBase()});
    await app.run('maLoad()');
    app.run("_maAttachSt={mode:'authenticated'}");
    const net=NET('postex-JUL-1');
    app.run("window.maRecordKind('collection',{courier:'postex',cprNos:['postex-JUL-1']})");
    let f=untouched(app);
    set(app,'ma-f-holder','1011');set(app,'ma-f-amount',String(net-100));
    app.run('window.maCollPreview()');
    let pv=txt(app.el('ma-f-prev').innerHTML);
    s.ok('a difference above tolerance says a reason is required',/above the 1% tolerance/.test(pv)&&/required/.test(pv),pv);
    s.ok('…your own hands: it counts at once',/counts at once/.test(pv),pv);
    set(app,'ma-f-holder','1010');app.run('window.maCollPreview()');
    pv=txt(app.el('ma-f-prev').innerHTML);
    s.ok('the drawer: Raees confirms, on paper',/raees confirms/i.test(pv)&&/on paper/.test(pv),pv);
    set(app,'ma-f-holder','1012');app.run('window.maCollPreview()');
    pv=txt(app.el('ma-f-prev').innerHTML);
    s.ok('Ammar\'s cash: Ammar confirms in the app',/ammar confirms/i.test(pv)&&/in the app/.test(pv),pv);
    // Without the reason: refused, and nothing written
    set(app,'ma-f-holder','1011');
    await app.run('window.maSaveForm()');
    s.ok('no reason for a difference: refused, said on the note',/Say why the cash differs/.test(said(app))&&S.tx.length===0,said(app));
    set(app,'ma-f-note','Rider kept 100 for fuel');set(app,'ma-f-collectedBy','Noman');
    // The receipt is required once attachments are on
    await app.run('window.maSaveForm()');
    s.ok('attachments on: no receipt is refused, by name',/Attach the receipt — attachments are on, so it is required/.test(said(app))&&S.tx.length===0,said(app));
    app.run("_maF.atts=[{publicId:'ma/'+'b'.repeat(64),format:'jpg',type:'authenticated',resourceType:'image'}]");
    await app.run('window.maSaveForm()');
    s.ok('the difference flags for review: the button says so and nothing is written yet',/Record anyway — \d+ flag/.test(app.el('ma-f-save').textContent)&&S.tx.length===0,app.el('ma-f-save').textContent);
    await app.run('window.maSaveForm()');
    s.eq('recorded: one transaction',S.tx.length,1);
    const ops=S.tx[0];
    s.eq('…counter, document, audit row and the claim of what it covers together (review S2)',J(ops.map(x=>x.col).sort()),J(['ma_audit','ma_claims','ma_collection','ma_counters']));
    const cl=ops.find(x=>x.col==='ma_claims')||{data:{}};
    s.ok('…the claim is the CPR\'s, naming the new collection, by Afnan, now',cl.id==='postex-JUL-1'&&cl.data.doc==='postex-JUL-1'&&cl.data.collection==='CL-27-0001'&&cl.data.by==='afnan'&&Number.isFinite(cl.data.at)&&!('releasedAt' in cl.data),J(cl));
    const stored=db.ma_collection[Object.keys(db.ma_collection)[0]];
    s.ok('the document holds the courier, the covers, the holder, who collected and the difference',stored.courier==='postex'&&J(stored.refs.cprNos)===J(['postex-JUL-1'])&&stored.holder==='1011'&&stored.collectedBy==='Noman'&&stored.difference===-100&&stored.expected===net,J(stored));
    s.ok('…posted (Afnan holds it himself), flagged for review',stored.status==='posted'&&(stored.flags||[]).some(x=>x.rule==='collection.difference'),J([stored.status,stored.flags]));
    s.ok('…numbered CL-27-0001, and the audit row is a post',stored.no==='CL-27-0001'&&ops.find(x=>x.col==='ma_audit').data.action==='post');
    s.eq('the page lists it now and the rail opened on it',J(app.run('[maData.collection.length,_maRail&&_maRail.dt,_maRail&&_maRail.id]')),J([1,'collection','CL-27-0001']));
    s.ok('a difference above tolerance reached 9030',M.maBalanceOf(JSON.parse(app.run('JSON.stringify(_maCtx().lines)')),IDX,'9030')===100);
  }

  s.section('the form guards: the holder each courier may credit, an upload in flight, "5.000"');
  {
    const {app,S}=mkApp({seed:seedBase()});
    await app.run('maLoad()');
    app.run("_maAttachSt={mode:'authenticated'}");
    const opts=k=>{app.run("window.maCloseModal();window.maRecordKind('collection',{courier:'"+k+"'})");return untouched(app)['ma-f-holder'].opts.map(o=>o.v).filter(Boolean);};
    s.eq('TCS credits the TCS account (1060) and nothing else',J(opts('tcs')),J(['1060']));
    s.ok('every other courier is paid into a holder that is not the TCS account',['postex','bykea','bluex'].every(k=>{const o=opts(k);return o.length>0&&o.indexOf('1060')<0;}));
    s.eq('the TCS form starts on the TCS account',app.run("window.maCloseModal();window.maRecordKind('collection',{courier:'tcs'});1")&&untouched(app)['ma-f-holder'].value,'1060');
    // An upload still going: Record waits
    app.run("window.maCloseModal();window.maRecordKind('collection',{courier:'postex',cprNos:['postex-JUL-3']})");
    untouched(app);set(app,'ma-f-holder','1011');set(app,'ma-f-amount',String(NET('postex-JUL-3')));
    app.run('_maF.attBusy=1');
    await app.run('window.maSaveForm()');
    s.ok('an upload in flight: Record waits, and says why',/Wait for the upload to finish/.test(said(app))&&S.tx.length===0,said(app));
    app.run('_maF.attBusy=0');
    set(app,'ma-f-amount','800.5');
    await app.run('window.maSaveForm()');
    s.ok('a fraction is refused before anything is built',S.tx.length===0&&/whole|amount/i.test(said(app)),said(app));
    set(app,'ma-f-amount','5.000');
    await app.run('window.maSaveForm()');
    s.ok('"5.000" is refused with what it probably meant (money N2)',/did you mean/.test(said(app))&&S.tx.length===0,said(app));
    // Blue-Ex: no statements — a collection against its opening balance
    app.run("window.maCloseModal();window.maRecordKind('collection',{courier:'bluex'})");
    const bx=app.bodyHtml('ma-modal-back');
    s.ok('Blue-Ex\'s form has no statements to tick and says why',/Blue-Ex has no statements here/.test(bx)&&!/type="checkbox" value="/.test(bx));
  }

  s.section('the Courier statement form — TCS and Bykea are typed, line by line');
  {
    const {app,S,db}=mkApp({seed:seedBase(),globals:{prompt:()=>'entered against the wrong month'}});
    await app.run('maLoad()');
    app.run("_maAttachSt={mode:'authenticated'}");
    app.run('window.maRecord()');
    s.ok('the picker offers Courier statement as a live kind',/window\.maRecordKind\('statement'\)"><b>Courier statement<\/b><span>TCS or Bykea, line by line/.test(app.bodyHtml('ma-modal-back')));
    app.run("window.maCloseModal();window.maRecordKind('statement',{courier:'tcs'})");
    const f0=untouched(app);
    s.eq('only the typed couriers are offered — PostEx is derived and Blue-Ex opens on the opening balance',J(f0['ma-f-courier'].opts.map(o=>o.v).filter(Boolean)),J(['tcs','bykea']));
    s.eq('…and the courier the page named is chosen',f0['ma-f-courier'].value,'tcs');
    // Lines: typed into state, the totals follow
    app.run("window.maStLineSet(0,'date','2026-09-10');window.maStLineSet(0,'parcels','12');window.maStLineSet(0,'cod','35,000');window.maStLineSet(0,'fee','1750');window.maStLineSet(0,'tax','280')");
    app.run("window.maStLineAdd();window.maStLineSet(1,'date','2026-09-12');window.maStLineSet(1,'parcels','2');window.maStLineSet(1,'returned',true);window.maStLineSet(1,'fee','200');window.maStLineSet(1,'tax','30')");
    app.run('_maStPaintTotals()');
    const tot=txt(app.el('ma-st-tot').innerHTML);
    s.ok('the totals follow the lines: parcels, COD, fees, tax and the net',/14 parcels/.test(tot)&&/COD ₨35,000/.test(tot)&&/fees ₨1,950/.test(tot)&&/tax ₨310/.test(tot)&&/net ₨32,740/.test(tot),tot);
    s.ok('…TCS says when its own account is credited: 90 days after its last parcel',/TCS credits its own account about Fri 11 Dec 2026 — 90 days after its last parcel/.test(tot),tot);
    s.eq('a returned line disables its COD (a return carries none)',app.el('ma-st-cod-1').disabled,true);
    // Refusals, by name
    set(app,'ma-f-date','2026-09-14');set(app,'ma-f-ref','TCS-SEP-1');
    app.run("_maF.stLines=[{date:'',parcels:'',returned:false,cod:'',fee:'',tax:'',memo:''}]");
    await app.run('window.maSaveForm()');
    s.ok('no lines: refused, and it says to add them',/Add the statement’s lines/.test(said(app))&&S.tx.length===0,said(app));
    app.run("_maF.stLines=[{date:'2026-09-10',parcels:'12',returned:false,cod:'35000',fee:'1750',tax:'280',memo:''},{date:'2026-09-12',parcels:'2',returned:true,cod:'',fee:'200',tax:'30',memo:'<img src=x onerror=alert(1)>'}]");
    await app.run('window.maSaveForm()');
    s.ok('attachments on: the statement itself is required, refused by name',/Attach the courier’s statement — attachments are on, so it is required/.test(said(app))&&S.tx.length===0,said(app));
    app.run("_maF.stLines[0].cod='5.000'");
    await app.run('window.maSaveForm()');
    s.ok('"5.000" is refused with what it probably meant, on the line',/Line 1 COD “5.000” — did you mean/.test(said(app))&&S.tx.length===0,said(app));
    app.run("_maF.stLines[0].cod='35000'");
    app.run("_maF.atts=[{publicId:'ma/'+'f'.repeat(64),format:'pdf',type:'authenticated',resourceType:'image'}]");
    await app.run('window.maSaveForm()');
    s.eq('recorded: one transaction',S.tx.length,1);
    s.eq('…counter, statement and audit row together',J(S.tx[0].map(x=>x.col).sort()),J(['ma_audit','ma_counters','ma_cpr']));
    const st=db.ma_cpr['CS-27-0001'];
    s.ok('numbered CS-27-0001 — a typed statement, TCS\'s, not derived',!!st&&st.dt==='cpr'&&st.kind==='statement'&&st.courier==='tcs'&&st.derived===false&&st.status==='posted'&&st.ref==='TCS-SEP-1',J(st&&[st.no,st.kind,st.courier,st.derived,st.status]));
    s.ok('the core made the figures: 14 parcels, COD 35,000, net 32,740',st&&st.parcels===14&&st.grossCod===35000&&st.net===32740&&st.fees===1950&&st.taxes===310,J(st&&[st.parcels,st.grossCod,st.net,st.fees,st.taxes]));
    s.eq('each line posts on its own day into TCS\'s receivable (1122)',M.maBalanceOf(JSON.parse(app.run('JSON.stringify(_maCtx().lines)')),IDX,'1122'),32740);
    // It is now uncollected, with its expected day
    const h=app.run("_maPageHTML('ma-in')");
    const tcsSec=(h.split('id="ma-cr-tcs"')[1]||'').split('id="ma-cr-bykea"')[0];
    s.ok('TCS lists it, ticked to collect, expected 90 days after its last line — not late',/maCourierTick\('tcs','CS-27-0001'/.test(tcsSec)&&/Fri 11 Dec/.test(txt(tcsSec))&&!/late/.test(txt(tcsSec)),txt(tcsSec).slice(0,400));
    s.ok('…and TCS and Bykea each offer Record statement',(h.match(/maRecordKind\('statement',\{courier:'(tcs|bykea)'\}\)/g)||[]).length===2&&!/maRecordKind\('statement',\{courier:'postex'/.test(h));
    // Its rail
    app.run("window.maOpenDoc('cpr','CS-27-0001')");
    const rail=app.run('_maRailHTML()');
    s.ok('the rail carries its lines, Edit, Void and the statement file — and no "derived" note',/TCS statement TCS-SEP-1/.test(rail)&&/maEditDoc\('cpr','CS-27-0001'\)/.test(rail)&&/maVoidDoc\('cpr','CS-27-0001'\)/.test(rail)&&/id="ma-rail-att"/.test(rail)&&!/Derived by the nightly rollup/.test(rail)&&/Fee and tax/.test(rail),txt(rail).slice(0,300));
    s.ok('…a line\'s memo is escaped',rail.indexOf('<img src=x')<0&&rail.indexOf('&lt;img src=x')>=0);
    // Edit: a note, with its reason
    app.run("window.maEditDoc('cpr','CS-27-0001')");
    const eh=app.bodyHtml('ma-modal-back');
    s.ok('Edit opens the form with the courier fixed and the lines filled in',/Edit CS-27-0001/.test(eh)&&/id="ma-f-courier"[^>]*disabled/.test(eh)&&(eh.match(/class="ma-st-row"/g)||[]).length===2&&/value="TCS-SEP-1"/.test(eh));
    untouched(app);
    set(app,'ma-f-note','September, first statement');set(app,'ma-f-reason','added a note');
    app.run("_maAttachSt={mode:'authenticated'}");
    await app.run('window.maSaveForm()');
    const ed=db.ma_cpr['CS-27-0001'];
    s.ok('the edit is revision 2, names only the note, and writes an edit audit row',ed.rev===2&&J(ed.edits[0].fields)===J(['note'])&&S.tx[S.tx.length-1].some(x=>x.col==='ma_audit'&&x.data.action==='edit'),J(ed.edits));
    // A collection covers it: then its figures are locked
    const cl=coll({courier:'tcs',holder:'1060',amount:32740,date:'2026-09-29',cprNos:['CS-27-0001'],attachments:[ATT]},{cprs:[ed]},'CL-27-0001');
    db.ma_collection={[cl.no]:cl};
    await app.run('maLoad()');
    app.run("window.maEditDoc('cpr','CS-27-0001')");
    const lh=app.bodyHtml('ma-modal-back');
    s.ok('collected, the form says why its day and lines are locked, and disables them',/CL-27-0001 collected it as it stands/.test(lh)&&/class="ma-in ma-st-d"[^>]*disabled/.test(lh)&&!/maStLineAdd/.test(lh),txt(lh).slice(0,300));
    const before=app.run('_maF.stLines.length');
    app.run('window.maStLineAdd()');
    s.eq('…and a line cannot be added',app.run('_maF.stLines.length'),before);
    await app.run('window.maCloseModal()');
    // Void: refused while a live collection covers it
    S.tx.length=0;
    await app.run("window.maVoidDoc('cpr','CS-27-0001')");
    s.ok('a covered statement is not voided — void the collection first',db.ma_cpr['CS-27-0001'].status==='posted'&&S.tx.length===0);
    // Void a free one: Bykea's
    app.run("window.maCloseModal();window.maRecordKind('statement',{courier:'bykea'})");
    untouched(app);set(app,'ma-f-date','2026-09-20');
    app.run("_maF.stLines=[{date:'2026-09-19',parcels:'3',returned:false,cod:'9000',fee:'450',tax:'72',memo:''}];_maF.atts=[{publicId:'ma/'+'9'.repeat(64),format:'pdf',type:'authenticated',resourceType:'image'}]");
    await app.run('window.maSaveForm()');
    const by=Object.keys(db.ma_cpr).filter(k=>db.ma_cpr[k].courier==='bykea')[0];
    s.ok('a Bykea statement is recorded the same way',!!by&&db.ma_cpr[by].net===8478,by);
    await app.run("window.maVoidDoc('cpr','"+by+"')");
    s.ok('an uncollected typed statement voids, with its reason, and an audit row',db.ma_cpr[by].status==='void'&&db.ma_cpr[by].voidReason==='entered against the wrong month'&&S.tx[S.tx.length-1].some(x=>x.col==='ma_audit'&&x.data.action==='void'),J(db.ma_cpr[by].status));
    // TCS collection against it: posts into 1060, earlier than 90 days is flagged
    const w=mkApp({seed:seedBase({ma_cpr:Object.assign(clone(CPR_DB),{'CS-27-0001':ed})})});
    await w.app.run('maLoad()');
    w.app.run("_maAttachSt={mode:'authenticated'}");
    w.app.run("window.maRecordKind('collection',{courier:'tcs',cprNos:['CS-27-0001']})");
    untouched(w.app);
    w.app.run("_maF.atts=[{publicId:'ma/'+'8'.repeat(64),format:'jpg',type:'authenticated',resourceType:'image'}]");
    set(w.app,'ma-f-amount','32740');
    await w.app.run('window.maSaveForm()');
    s.ok('credited before the 90 days TCS takes: flagged, and the button says so',/Record anyway — 1 flag/.test(w.app.el('ma-f-save').textContent)&&/Credited earlier than the 90 days TCS takes/.test(said(w.app)),said(w.app));
    await w.app.run('window.maSaveForm()');
    const tc=w.db.ma_collection['CL-27-0001'];
    s.ok('the collection lands in the TCS account (1060) and clears TCS\'s receivable',tc&&tc.holder==='1060'&&M.maBalanceOf(JSON.parse(w.app.run('JSON.stringify(_maCtx().lines)')),IDX,'1060')===32740&&M.maBalanceOf(JSON.parse(w.app.run('JSON.stringify(_maCtx().lines)')),IDX,'1122')===0,J(tc&&[tc.holder,tc.status]));
    s.ok('…and the TCS account row is on the courier page, holding it',/The TCS account holds <b>₨32,740<\/b>/.test(w.app.run("_maPageHTML('ma-in')")));
    // The Ledger's document filter offers both new kinds
    s.ok('the Ledger\'s document-type filter offers courier statements and collections',/<option value="cpr"[^>]*>Courier statements/.test(app.run("_maLedgerTab='documents';_maPageHTML('ma-ledger')"))&&/<option value="collection"[^>]*>Collections/.test(app.run("_maPageHTML('ma-ledger')")));
  }

  s.section('the drawer holder produces a pending collection');
  {
    const {app,db}=mkApp({seed:seedBase()});
    await app.run('maLoad()');
    app.run("_maAttachSt={error:'x',state:'not_configured'}");
    const net=NET('postex-JUL-3');
    app.run("window.maRecordKind('collection',{courier:'postex',cprNos:['postex-JUL-3']})");
    untouched(app);
    set(app,'ma-f-holder','1010');set(app,'ma-f-amount',String(net));set(app,'ma-f-collectedBy','Noman');
    await app.run('window.maSaveForm()');
    s.ok('with attachments off it is FLAGGED "no receipt", not refused',/Record anyway — 1 flag/.test(app.el('ma-f-save').textContent),app.el('ma-f-save').textContent+' '+txt(app.bodyHtml('ma-modal-back')).slice(0,300));
    await app.run('window.maSaveForm()');
    const d=db.ma_collection['CL-27-0001'];
    s.ok('it is pending, waiting for Raees, confirmed on paper by an owner',d&&d.status==='pending'&&d.confirmBy==='raees'&&d.confirmPaper===true,J(d&&[d.status,d.confirmBy,d.confirmPaper]));
    s.ok('…flagged with no receipt',d&&(d.flags||[]).some(x=>x.rule==='collection.receipt'),J(d&&d.flags));
    s.eq('a pending collection posts nothing: the drawer\'s book is unchanged',M.maBalanceOf(JSON.parse(app.run('JSON.stringify(_maCtx().lines)')),IDX,'1010'),0);
    const held=JSON.parse(app.run("JSON.stringify(_maCtx().holders.find(h=>h.code==='1010'))"));
    s.eq('…it shows as waiting into the drawer',held.pendingIn,net);
    // The Money page lists it among what waits to be confirmed, and Ammar/Afnan confirm on paper
    const money=app.run("_maPageHTML('ma-money')");
    s.ok('Money lists it under "Waiting to be confirmed", opening the collection',/CL-27-0001/.test(money)&&/maOpenDoc\('collection','CL-27-0001'\)/.test(money)&&/maConfirmDoc\('CL-27-0001','collection'\)/.test(money));
    await app.run("window.maConfirmDoc('CL-27-0001','collection')");
    s.ok('confirming refuses until Raees has recorded it (asks first) — the harness answers yes, and it posts',db.ma_collection['CL-27-0001'].status==='posted'&&db.ma_collection['CL-27-0001'].confirmVia==='paper'&&db.ma_collection['CL-27-0001'].confirmedFor==='raees',J(db.ma_collection['CL-27-0001']));
    s.eq('…and the cash reached the drawer\'s ledger',M.maBalanceOf(JSON.parse(app.run('JSON.stringify(_maCtx().lines)')),IDX,'1010'),net);
  }

  s.section('one live collection per CPR — against memory and against a fresh read');
  {
    const c1=coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-1'),date:'2026-08-01',cprNos:['postex-JUL-1'],attachments:[ATT]},{},'CL-27-0001');
    const {app,S}=mkApp({seed:seedBase({ma_collection:{[c1.no]:c1}})});
    await app.run('maLoad()');
    app.run("_maAttachSt={mode:'authenticated'}");
    app.run("window.maRecordKind('collection',{courier:'postex',cprNos:['postex-JUL-1']})");
    const html=app.bodyHtml('ma-modal-back');
    s.ok('a CPR already collected is shown, ticked, saying by whom',/value="postex-JUL-1" checked/.test(html)&&/already collected by CL-27-0001/.test(html),txt(html).slice(0,300));
    untouched(app);
    set(app,'ma-f-holder','1011');set(app,'ma-f-amount',String(NET('postex-JUL-1')));
    app.run("_maF.atts=[{publicId:'ma/'+'c'.repeat(64),format:'jpg',type:'authenticated',resourceType:'image'}]");
    await app.run('window.maSaveForm()');
    s.ok('refused by name, and nothing is written',/is already collected by CL-27-0001 — void that first/.test(said(app))&&S.tx.length===0,said(app));
  }
  {
    // The page's copy is old: the collection was recorded on another device.
    const {app,S,db}=mkApp({seed:seedBase()});
    await app.run('maLoad()');
    app.run("_maAttachSt={mode:'authenticated'}");
    app.run("window.maRecordKind('collection',{courier:'postex',cprNos:['postex-JUL-1']})");
    untouched(app);
    set(app,'ma-f-holder','1011');set(app,'ma-f-amount',String(NET('postex-JUL-1')));
    app.run("_maF.atts=[{publicId:'ma/'+'d'.repeat(64),format:'jpg',type:'authenticated',resourceType:'image'}]");
    const other=coll({courier:'postex',holder:'1012',amount:NET('postex-JUL-1'),date:'2026-08-01',cprNos:['postex-JUL-1'],attachments:[ATT]},{by:'ammar',byName:'Ammar'},'CL-27-0009');
    db.ma_collection={[other.no]:other};
    const before=S.reads.length;
    await app.run('window.maSaveForm()');
    s.ok('the save read ma_collection FRESH, just before the write',S.reads.slice(before).indexOf('ma_collection')>=0);
    s.ok('…so the other device\'s collection refuses this one — and nothing is written',/is already collected by CL-27-0009 — void that first/.test(said(app))&&S.tx.length===0,said(app));
    // A fresh read that fails is a refusal, never a guess
    const w=mkApp({seed:seedBase()});
    await w.app.run('maLoad()');
    w.app.run("_maAttachSt={mode:'authenticated'}");
    w.app.run("window.maRecordKind('collection',{courier:'postex',cprNos:['postex-JUL-1']})");
    untouched(w.app);
    set(w.app,'ma-f-holder','1011');set(w.app,'ma-f-amount',String(NET('postex-JUL-1')));
    w.app.run("_maF.atts=[{publicId:'ma/'+'e'.repeat(64),format:'jpg',type:'authenticated',resourceType:'image'}]");
    w.app.ctx.window.getDocs=async q=>{throw Object.assign(new Error('offline'),{code:'unavailable'});};
    w.app.run("getDocs=window.getDocs");
    await w.app.run('window.maSaveForm()');
    s.ok('the stored collections could not be read: refused, and it says why',/Could not check the stored collections/.test(said(w.app))&&w.S.tx.length===0,said(w.app));
  }

  s.section('edit, void and confirm go through the rail');
  {
    const c1=coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-1'),date:'2026-08-01',cprNos:['postex-JUL-1'],attachments:[ATT]},{},'CL-27-0001');
    const c2=coll({courier:'postex',holder:'1010',amount:NET('postex-JUL-2'),date:'2026-08-02',cprNos:['postex-JUL-2'],attachments:[ATT]},{},'CL-27-0002');
    const {app,S,db}=mkApp({seed:seedBase({ma_collection:{[c1.no]:c1,[c2.no]:c2}}),globals:{prompt:()=>'counted the wrong CPR'}});
    await app.run('maLoad()');
    app.run("window.maOpenDoc('collection','CL-27-0001')");
    const rail=app.run('_maRailHTML()');
    s.ok('the rail names it, what it covers, and offers Edit, Void and the receipt PDF and share',/Collection · CL-27-0001/.test(rail)&&/Covers/.test(rail)&&/maEditDoc\('collection','CL-27-0001'\)/.test(rail)&&/maVoidDoc\('collection','CL-27-0001'\)/.test(rail)&&/maDocPdf\('collection','CL-27-0001'\)/.test(rail)&&/maDocShare\('collection','CL-27-0001'\)/.test(rail),txt(rail).slice(0,400));
    s.ok('…a pending one offers Confirm (with its kind) to the right person',/maConfirmDoc\('CL-27-0002','collection'\)/.test((app.run("window.maOpenDoc('collection','CL-27-0002')"),app.run('_maRailHTML()'))));
    // Edit: the note changes; what it covers and its courier are read-only
    app.run("window.maEditDoc('collection','CL-27-0001')");
    const eh=app.bodyHtml('ma-modal-back');
    s.ok('Edit opens the form with the courier fixed and the covers read-only',/Edit CL-27-0001/.test(eh)&&/id="ma-f-courier"[^>]*disabled/.test(eh)&&!/type="checkbox" value="postex-/.test(eh)&&/cannot change/.test(eh));
    untouched(app);
    set(app,'ma-f-note','counted twice');set(app,'ma-f-reason','typo in the note');
    app.run("_maAttachSt={mode:'authenticated'}");
    await app.run('window.maSaveForm()');
    const saved=db.ma_collection['CL-27-0001'];
    s.ok('the edit is revision 2, names its fields, and writes an audit row',saved.rev===2&&J(saved.edits[0].fields)===J(['note'])&&S.tx[S.tx.length-1].some(x=>x.col==='ma_audit'&&x.data.action==='edit'),J(saved.edits));
    s.ok('…and keeps the snapshot of what it covered',J(saved.covers)===J(c1.covers));
    // A derived receipt is never edited
    app.run("window.maEditDoc('cpr','postex-JUL-3')");
    s.eq('a derived receipt is never edited (no form opens)',app.run("document.getElementById('ma-modal-back')===null||_maF===null"),true);
    // Void
    await app.run("window.maVoidDoc('collection','CL-27-0001')");
    const v=db.ma_collection['CL-27-0001'];
    s.ok('Void asks for a reason and writes exactly a void patch, with an audit row',v.status==='void'&&v.voidReason==='counted the wrong CPR'&&S.tx[S.tx.length-1].some(x=>x.op==='update'&&x.col==='ma_collection')&&S.tx[S.tx.length-1].some(x=>x.col==='ma_audit'&&x.data.action==='void'),J([v.status,v.voidReason]));
    s.ok('…and the CPR it covered is uncollected again',JSON.parse(app.run("JSON.stringify(_maCollectable(_maCtx(),'postex').map(x=>x.doc.id))")).indexOf('postex-JUL-1')>=0);
  }

  s.section('the collection receipt (PDF) and Share receipt — the same routes a transfer\'s receipt takes');
  {
    const c1=coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-1'),date:'2026-08-01',cprNos:['postex-JUL-1'],attachments:[ATT]},{},'CL-27-0001');
    const c2=Object.assign(coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-2'),date:'2026-08-02',cprNos:['postex-JUL-2'],attachments:[ATT]},{},'CL-27-0002'),{status:'void',voidedAt:1,voidedBy:'afnan',voidedByName:'Afnan',voidReason:'x'});
    const calls=[];
    const {app,S}=mkApp({seed:seedBase({ma_collection:{[c1.no]:c1,[c2.no]:c2}}),globals:{printDocument:o=>{calls.push(o);return Promise.resolve();}}});
    await app.run('maLoad()');
    app.run("window.maOpenDoc('collection','CL-27-0001')");
    const rail=app.run('_maRailHTML()');
    s.ok('the rail offers Receipt (PDF) and Share receipt',/maDocPdf\('collection','CL-27-0001'\)">Receipt \(PDF\)/.test(rail)&&/maDocShare\('collection','CL-27-0001'\)">Share receipt/.test(rail));
    await app.run("window.maDocPdf('collection','CL-27-0001')");
    s.eq('it prints through the engine\'s ma-collection variant, named by the collection',J(calls.map(x=>[x.type,x.filename])),J([['ma-collection','Collection-CL-27-0001.pdf']]));
    s.ok('…with the core\'s data — the courier, what it covers and the amount, never computed here',!!calls[0]&&calls[0].data.courier.name==='PostEx'&&calls[0].data.covers.length===1&&calls[0].data.covers[0].no==='JUL-1'&&calls[0].data.amount===NET('postex-JUL-1')&&calls[0].data.no==='CL-27-0001',J(calls[0]&&Object.keys(calls[0].data)));
    s.ok('…and the export is written to the audit trail, quietly',S.sets.some(x=>x.col==='ma_audit'&&x.data.action==='export'&&/Collection-CL-27-0001\.pdf/.test(x.data.detail)));
    await app.run("window.maDocPdf('collection','CL-27-0002')");
    s.eq('a void collection\'s receipt says so in its file name',calls[1]&&calls[1].filename,'Collection-CL-27-0002-VOID.pdf');
    // Share
    const spec=JSON.parse(app.run("JSON.stringify((()=>{const x=_maShareSpec('collection','CL-27-0001');return {type:x.type,what:x.what,filename:x.filename,subject:x.subject,error:x.error||null,hasBuild:typeof x.build==='function'};})())"));
    s.ok('the share spec is a ma-collection PDF whose subject is the collection, at its revision',spec.type==='ma-collection'&&spec.subject.type==='collection'&&spec.subject.id==='CL-27-0001'&&spec.subject.rev===1&&/CL-27-0001 · rev 1/.test(spec.subject.no)&&spec.hasBuild&&!spec.error,J(spec));
    s.ok('…and an unknown collection is an error, not a blank PDF',!!JSON.parse(app.run("JSON.stringify(_maShareSpec('collection','CL-nope'))")).error);
    // A link made before an edit says the document moved on
    app.run("_maShare={spec:{subject:{type:'collection',id:'CL-27-0001'}}}");
    const stale=app.run("(()=>{const d=_maDoc('collection','CL-27-0001');d.edits=[{at:5,by:'afnan',fields:['note'],before:{},after:{}}];return _maShareStaleHTML({docRev:1,createdAt:1},'live')})()");
    s.ok('a live link made at rev 1 of a collection now at rev 2 says the document has changed since',/Made at rev 1/.test(stale)&&/rev 2 now/.test(stale),stale);
  }

  s.section('a CPR on the rail: its facts, its parcels — read on demand');
  {
    const c1=coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-1'),date:'2026-08-01',cprNos:['postex-JUL-1'],attachments:[ATT]},{},'CL-27-0001');
    const {app,S}=mkApp({seed:seedBase({ma_collection:{[c1.no]:c1}})});
    await app.run('maLoad()');
    s.eq('loading the page read no parcel — only opening a CPR does',S.reads.indexOf('postex_orders'),-1);
    app.run("window.maOpenDoc('cpr','postex-JUL-1')");
    const rail=app.run('_maRailHTML()');
    s.ok('the rail names the CPR, its net, and who collected it',/PostEx · JUL-1/.test(rail)&&rail.indexOf(M.maRs(NET('postex-JUL-1')))>=0&&/maOpenDoc\('collection','CL-27-0001'\)/.test(rail),txt(rail).slice(0,300));
    s.ok('…and says it is derived, never typed or edited',/Derived by the nightly rollup/.test(rail)&&!/maEditDoc\('cpr'/.test(rail)&&!/maVoidDoc\('cpr'/.test(rail));
    S.reads.length=0;
    app.run('_maParcels={};_maPaint()');
    await new Promise(r=>setTimeout(r,20));
    s.ok('opening the rail read postex_orders',S.reads.indexOf('postex_orders')>=0,J(S.reads));
    const el=app.el('ma-rail-parcels').innerHTML;
    s.ok('…and shows the two parcels on that receipt, with their COD',/PA/.test(el)&&/PB/.test(el)&&!/>PC</.test(el)&&/₨3,000/.test(el),el.slice(0,300));
    // Not yet collected: it offers its collection
    app.run("window.maOpenDoc('cpr','postex-JUL-3')");
    s.ok('an uncollected CPR offers "Record its collection"',/Record its collection/.test(app.run('_maRailHTML()')));
    // A read that fails says so
    const w=mkApp({seed:seedBase(),fail:['postex_orders']});
    await w.app.run('maLoad()');
    w.app.run("window.maOpenDoc('cpr','postex-JUL-1')");
    await new Promise(r=>setTimeout(r,20));
    s.ok('a failed parcel read says so, with Try again — never an empty list',/Could not read its parcels/.test(w.app.el('ma-rail-parcels').innerHTML)&&/Try again/.test(w.app.el('ma-rail-parcels').innerHTML),w.app.el('ma-rail-parcels').innerHTML.slice(0,200));
  }

  s.section('Run now — owners only, posts the ID token, polls for a newer run');
  {
    const {app,S,db}=mkApp({seed:seedBase(),fetch:async(url,init,db)=>{
      db.ma_runs.rollup=Object.assign({},db.ma_runs.rollup,{at:db.ma_runs.rollup.at+60000,created:1});return {ok:true,status:202,json:async()=>({})};}});
    await app.run('maLoad()');
    app.run('_MA_RUN_POLL=1;_MA_RUN_WAIT=2000');
    const t0=app.run("_maRun().at");
    await app.run('window.maRunNow()');
    s.eq('it POSTs to the unscheduled wrapper',S.fetches.map(x=>x.url).join(),'/.netlify/functions/ma-rollup-now-background');
    s.ok('…with the caller\'s ID token, as a POST',S.fetches[0].init.method==='POST'&&S.fetches[0].init.headers.Authorization==='Bearer t_afnan');
    s.ok('it polled ma_runs and read the newer run',S.reads.filter(x=>x==='ma_runs').length>=2&&app.run("_maRun().at")>t0,J(S.reads));
    s.ok('…and says it is done',/^Done at/.test(app.run('_maRunMsg'))&&app.run('_maRunBusy')===false,app.run('_maRunMsg'));
    // Times out out loud
    const w=mkApp({seed:seedBase()});
    await w.app.run('maLoad()');
    w.app.run('_MA_RUN_POLL=2;_MA_RUN_WAIT=30');
    await w.app.run('window.maRunNow()');
    s.ok('a run that never answers: it says so, after its wait',/has not answered in 0 minutes|has not answered in \d+ seconds/.test(w.app.run('_maRunMsg'))&&/may still be running/.test(w.app.run('_maRunMsg'))&&w.app.run('_maRunBusy')===false,w.app.run('_maRunMsg'));
    // A refused start
    const r=mkApp({seed:seedBase(),fetch:async()=>({ok:false,status:403,json:async()=>({})})});
    await r.app.run('maLoad()');
    await r.app.run('window.maRunNow()');
    s.ok('a refusal is said with its status, and no polling follows',/HTTP 403/.test(r.app.run('_maRunMsg'))&&r.S.reads.filter(x=>x==='ma_runs').length===1);
    // A failed run
    const fl=mkApp({seed:seedBase(),fetch:async(u,i,db)=>{db.ma_runs.rollup=Object.assign({},db.ma_runs.rollup,{at:db.ma_runs.rollup.at+5,state:'failed',error:'PostEx returned nothing'});return {ok:true,status:202,json:async()=>({})};}});
    await fl.app.run('maLoad()');fl.app.run('_MA_RUN_POLL=1;_MA_RUN_WAIT=500');
    await fl.app.run('window.maRunNow()');
    s.ok('a run that failed says why',/The rollup failed: PostEx returned nothing/.test(fl.app.run('_maRunMsg')));
  }
  {
    // Hidden from anyone who is not an owner — the button, and the call itself.
    const {app,S}=mkApp({seed:seedBase(),session:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'}});
    await app.run('maLoad()');
    const h=app.run('_maInHTML()');
    s.ok('for a non-owner the page carries no Run now',!/maRunNow/.test(h)&&!/Run now/.test(h));
    await app.run('window.maRunNow()');
    s.eq('…and the call does nothing: no fetch',S.fetches.length,0);
    const own=mkApp({seed:seedBase()});
    await own.app.run('maLoad()');
    s.ok('(an owner has it — so the assertion above is not vacuous)',/Run now/.test(own.app.run('_maInHTML()')));
  }

  s.section('Today: a collection is money in; the courier holders stay off unless money moved');
  {
    const {app}=mkApp({seed:seedBase(),page:'ma-overview'});
    await app.run('maLoad()');
    const h0=app.run("_maPageHTML('ma-overview')");
    s.ok('Today lists no TCS-account row while nothing has moved through it',!/TCS account/.test(h0));
    const today=JSON.parse(app.run('JSON.stringify(maDay())'));
    const c=coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-1'),date:today,cprNos:['postex-JUL-1'],attachments:[ATT]},{},'CL-27-0001');
    const w=mkApp({seed:seedBase({ma_collection:{[c.no]:c}}),page:'ma-overview'});
    await w.app.run('maLoad()');
    const f=JSON.parse(w.app.run('JSON.stringify(_maMonthFlows(_maCtx()))'));
    s.eq('In this month counts the collection as money in',f.inM,NET('postex-JUL-1'));
    s.eq('…and it is not money out',f.outM,0);
    s.ok('the holder it reached shows it',w.app.run("_maCtx().holders.find(h=>h.code==='1011').balance")===NET('postex-JUL-1'));
    // The courier page asks for the courier holders
    s.ok('the couriers\' own holder rows are asked for only where they are wanted (Today passes no `couriers`)',!/couriers:true/.test(read('js/master-accounts.js').split('function _maCtx()')[1].split('function _maInvalidate')[0]));
    // TCS: a credit into the TCS account moves the holder row on
    const tcs=M.maBuildDoc('cpr',{courier:'tcs',date:'2026-07-31',ref:'TCS-JUL',attachments:[ATT],lines:[{date:'2026-07-10',parcels:2,cod:5000,fee:250,tax:40}]},{by:'afnan',byName:'Afnan',ts:1},IDX,SET);
    tcs.id='cs-t';tcs.no='CS-27-0001';
    const tc=coll({courier:'tcs',holder:'1060',amount:4710,date:'2026-10-15',cprNos:['cs-t'],attachments:[ATT]},{cprs:[tcs]},'CL-27-0002');
    const z=mkApp({seed:seedBase({ma_cpr:Object.assign(clone(CPR_DB),{'cs-t':tcs}),ma_collection:{[tc.no]:tc}}),page:'ma-overview'});
    await z.app.run('maLoad()');
    s.ok('money that moved through the TCS account shows its row on Today',/TCS account/.test(z.app.run("_maPageHTML('ma-overview')")));
  }

  s.section('every stored string is escaped');
  {
    const evil='<img src=x onerror=alert(1)>';
    const cprs=clone(CPR_DB);
    cprs['postex-JUL-3'].no=evil;cprs['postex-JUL-3'].ref=evil;
    const cl=coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-1'),date:'2026-08-01',cprNos:['postex-JUL-1'],collectedBy:evil,note:evil,attachments:[ATT]},{},'CL-27-0001');
    cl.covers[0].no=evil;
    const {app}=mkApp({seed:seedBase({ma_cpr:cprs,ma_collection:{[cl.no]:cl},ma_runs:{rollup:Object.assign(RUN(),{state:'failed',error:evil})}})});
    await app.run('maLoad()');
    const page=app.run("_maPageHTML('ma-in')");
    s.ok('the page draws none of it raw',page.indexOf('<img src=x')<0&&page.indexOf('&lt;img src=x')>=0,'');
    app.run("window.maOpenDoc('collection','CL-27-0001')");
    const rail=app.run('_maRailHTML()');
    s.ok('the collection rail escapes who collected it, its note and its covers',rail.indexOf('<img src=x')<0&&rail.indexOf('&lt;img')>=0);
    app.run("window.maOpenDoc('cpr','postex-JUL-3')");
    const r2=app.run('_maRailHTML()');
    s.ok('the CPR rail escapes its number',r2.indexOf('<img src=x')<0&&r2.indexOf('&lt;img')>=0);
    app.run("window.maRecordKind('collection',{courier:'postex',cprNos:['postex-JUL-3']})");
    const form=app.bodyHtml('ma-modal-back');
    s.ok('the form escapes a receipt number',form.indexOf('<img src=x')<0);
    const M2=mkApp({seed:seedBase()});
    await M2.app.run('maLoad()');
    M2.db.postex_orders.PA.trackingNumber=evil;
    M2.app.run("window.maOpenDoc('cpr','postex-JUL-1')");
    await new Promise(r=>setTimeout(r,20));
    s.ok('the parcels the rail reads are escaped too',M2.app.el('ma-rail-parcels').innerHTML.indexOf('<img src=x')<0&&M2.app.el('ma-rail-parcels').innerHTML.indexOf('&lt;img')>=0);
  }

  s.section('housekeeping — registration and the ground rules');
  {
    const shared=read('js/shared.js');
    s.ok('ma-in is on the phone "More" group map and has a bug-tracker name',/'ma-in':'more'/.test(shared)&&/'ma-in':'Master Accounts · Money in'/.test(shared));
    s.ok('the smoke lists carry it (phone and axe)',/'ma-in'/.test(read('tests/smoke-app-phone.js'))&&/'ma-in'/.test(read('tests/smoke-axe.js')));
    const src=read('js/master-accounts.js');
    s.ok('no global is named `collection` (decision 13) — the SDK function stays the SDK function',!/^(?:const|let|var|function)\s+collection\b/m.test(src));
    s.ok('the three new reads are NOT core',/key:'cpr',col:'ma_cpr',core:false/.test(src)&&/key:'collection',col:'ma_collection',core:false/.test(src)&&/key:'runs',col:'ma_runs',core:false/.test(src));
  }
  return s;
};

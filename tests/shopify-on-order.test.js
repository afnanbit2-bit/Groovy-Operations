/* Inventory Intel ▸ "Already on order" (Oct 2026): the open production orders (POs) are read once, an article's open pieces are
   worked out (arrival INFERRED from a stock jump, or a 45-day safety expiry), shown as a chip, and Needs Attention uses them: a reorder size
   that on-order pieces cover drops one band, one they cover in part is reduced, and a failed read downgrades and hides nothing.
   Built on the Needs Attention fixture (its FIXTURE comment holds the hand computation; today 2026-08-31): O1 is a CRITICAL stock-out with
   reorder guide 144..240 (3.8 x 0.75 x 49 = 139.65 -> 144, 3.8 x 1.25 x 49 = 232.75 -> 240, packs of 12); R1..R10 run out; A1 is an act-band
   run-out. HAND-COMPUTED EXPECTATIONS (pack = 12, every figure rounded UP to a pack, never below 0):
     PO 240 on O1            -> hi = up(240-240) = 0  -> covered: band critical -> act, guide gone, counts 10 critical / 6 act (was 11 / 5).
     PO 239 on O1            -> lo = up(144-239) = 0, hi = up(240-239 = 1) = 12 -> partial, band stays critical.
     PO 100 on O1            -> lo = up(44) = 48, hi = up(140) = 144 -> partial.
     POs 60 + 80 on O1       -> 140 on order -> lo = up(4) = 12, hi = up(100) = 108; chip "2 POs, latest 25 Aug".
     PO raised 07-17, today 08-31 -> age 45 days: expired (not open); raised 07-18 -> age 44: open, expires 09-01.
     Arrival: R2 stock jumps 28 -> 128 on 08-27 while it sells 5 a day: residual = 128-28+5 = 105. PO 200 (threshold max(5,100) = 100) raised
     08-20: arrived 08-27. PO 300 (threshold 150): still open. PO raised ON 08-27: still open (the jump must be AFTER the PO day). POs 60 and 40
     raised 08-20 / 08-21: jump 105 -> 60 arrives (rem 45), 40 arrives (45 >= max(5,20); rem 5); a PO of 60 raised 08-22 (threshold 30) stays open.
   Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=JSON.stringify;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const NA=fs.readFileSync(path.join(__dirname,'shopify-needs-attention.test.js'),'utf8');
const FX=eval('('+NA.slice(NA.indexOf('function fixture(a){'),NA.indexOf('async function checks')).replace(/^function fixture/,'function')+')');
function load(src,extra){
  const store={};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:Object.assign({localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})},extra||{})});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
async function checks(src){
  const o={},a=load(src),R=c=>a.run(c);
  FX(a);
  // POs for the tests: [code, id, qty, day]
  const setPos=(list,state)=>{
    const m={};list.forEach(p=>{(m[p[0]]=m[p[0]]||[]).push({id:p[1],code:p[0],qty:p[2],day:p[3]});});
    R('_siPoByCode=new Map(Object.entries('+J(m)+'));_siPoState='+J(state||'ok')+';_siPoVer++;_siPoMemo=null');
  };
  const iss=c=>JSON.parse(R('J=JSON.stringify((()=>{const i=_siNaState().issues.find(x=>x.code==="'+c+'");return i?{type:i.type,band:i.band,qty:i.n.qty,before:i.n.qtyBefore||null,covers:!!i.n.onOrderCovers,partial:!!i.n.onOrderPartial,bandBefore:i.n.bandBefore||null,oo:i.n.onOrder?{state:i.n.onOrder.state,qty:i.n.onOrder.qty,open:i.n.onOrder.open.length,expired:i.n.onOrder.expired.length}:null}:null})())'));
  const cnt=()=>JSON.parse(R('J=JSON.stringify(_siNaState().counts)'));
  const oo=(c,now)=>JSON.parse(R('J=JSON.stringify(_siPoOpenFor("'+c+'","'+(now||'2026-08-31')+'"))'));
  // ── baseline: no POs ──
  setPos([]);
  const b=iss('O1'),c0=cnt();
  o['baseline: O1 is a critical stock-out with guide 144..240 and nothing on order (read ok, qty 0)']=b&&b.type==='stockout'&&b.band==='critical'&&b.qty&&b.qty.lo===144&&b.qty.hi===240&&b.oo.state==='ok'&&b.oo.qty===0&&!b.covers&&!b.partial;
  o['baseline counts stay 11 critical / 5 act / 2 watch']=c0.critical===11&&c0.act===5&&c0.watch===2;
  // ── covered / partial / boundary ──
  setPos([['O1','PO-1',240,'2026-08-25']]);
  let x=iss('O1'),c1=cnt();
  o['a PO of 240 covers the guide (hi 240): band critical -> act, the guide is gone, the row is still listed']=!!x&&x.covers&&x.band==='act'&&x.bandBefore==='critical'&&x.qty===null&&x.before.hi===240;
  o['covering PO: the counts follow one source: 10 critical, 6 act, 2 watch, still 18 in total and 16 needing action']=c1.critical===10&&c1.act===6&&c1.watch===2&&c1.total===18&&c1.action===16;
  setPos([['O1','PO-1',239,'2026-08-25']]);
  x=iss('O1');
  o['boundary: 239 on order leaves 1 over the top of the guide: partial (lo 0, hi 12), band stays critical']=x.partial&&!x.covers&&x.band==='critical'&&x.qty.lo===0&&x.qty.hi===12;
  setPos([['O1','PO-1',100,'2026-08-25']]);
  x=iss('O1');
  o['a partial PO of 100 reduces the guide to 48..144 (rounded up to a pack) and keeps the band']=x.partial&&x.band==='critical'&&x.qty.lo===48&&x.qty.hi===144&&x.before.lo===144&&x.before.hi===240;
  setPos([['O1','PO-1',60,'2026-08-20'],['O1','PO-2',80,'2026-08-25']]);
  x=iss('O1');
  o['two POs are summed: 140 on order -> guide 12..108, two open POs']=x.oo.qty===140&&x.oo.open===2&&x.qty.lo===12&&x.qty.hi===108;
  o['the chip says the total and the latest PO: "On order: 140 pcs (2 POs, latest 25 Aug)"']=R('_siPoChipText(_siPoOpenFor("O1","2026-08-31"))')==='On order: 140 pcs (2 POs, latest 25 Aug)';
  setPos([['O1','PO-1',240,'2026-08-25']]);
  o['one PO chip names its date: "On order: 240 pcs (PO 25 Aug)"']=R('_siPoChipText(_siPoOpenFor("O1","2026-08-31"))')==='On order: 240 pcs (PO 25 Aug)';
  // ── expiry ──
  setPos([['O1','PO-1',240,'2026-07-17']]);
  x=iss('O1');
  o['expiry: a PO raised 45 days ago is expired, not open: nothing is downgraded or reduced']=x.band==='critical'&&x.qty.hi===240&&x.oo.qty===0&&x.oo.expired===1&&!x.covers;
  setPos([['O1','PO-1',240,'2026-07-18']]);
  x=iss('O1');
  o['expiry: a PO raised 44 days ago is still open (expires 2026-09-01)']=x.covers&&oo('O1').open[0].expires==='2026-09-01'&&oo('O1').until==='2026-09-01';
  // ── arrival inferred from a stock jump ──
  R('(()=>{const m=_siHist.byCode.get("R2");["2026-08-27","2026-08-28","2026-08-29","2026-08-30","2026-08-31"].forEach(d=>m.set(d,128));})()');
  setPos([['R2','PO-A',200,'2026-08-20']]);
  let r=oo('R2');
  o['arrival: a jump of 105 (128-28+5 sold) after the PO covers half of 200 -> arrived on 2026-08-27, nothing on order']=r.qty===0&&r.arrived.length===1&&r.arrived[0].arrivedOn==='2026-08-27'&&r.checked===true;
  setPos([['R2','PO-A',300,'2026-08-20']]);
  r=oo('R2');
  o['arrival: a PO of 300 needs 150, the jump is only 105: still open']=r.qty===300&&r.arrived.length===0;
  setPos([['R2','PO-A',200,'2026-08-27']]);
  r=oo('R2');
  o['arrival: a jump ON the PO day is not its arrival (must be after): still open']=r.qty===200&&r.arrived.length===0;
  setPos([['R2','PO-A',60,'2026-08-20'],['R2','PO-B',40,'2026-08-21'],['R2','PO-C',60,'2026-08-22']]);
  r=oo('R2');
  o['arrival: one jump of 105 explains POs of 60 and 40 (rem 45, then 5) and not a third of 60: 60 on order']=r.arrived.length===2&&r.open.length===1&&r.open[0].id==='PO-C'&&r.qty===60;
  // pure core: boundaries
  const calc=(pos,days,today)=>JSON.parse(R('J=JSON.stringify(_siPoCalc('+J(pos)+','+J(days)+',"'+today+'"))'));
  const d1=[{d:'2026-08-10',stock:100,prev:100,sold:0},{d:'2026-08-11',stock:105,prev:100,sold:0},{d:'2026-08-12',stock:109,prev:105,sold:0}];
  o['threshold: a PO of 10 needs max(5, 5) = 5: a rise of 5 arrives it, a rise of 4 does not']=calc([{id:'a',qty:10,day:'2026-08-09'}],d1,'2026-08-31').arrived.length===1&&calc([{id:'a',qty:10,day:'2026-08-11'}],d1,'2026-08-31').arrived.length===0;
  o['threshold: a PO of 8 still needs 5 (the floor), not 4']=calc([{id:'a',qty:8,day:'2026-08-11'}],[{d:'2026-08-12',stock:109,prev:105,sold:0}],'2026-08-31').arrived.length===0;
  o['a missing snapshot day (null stock) is never read as a jump']=calc([{id:'a',qty:10,day:'2026-08-09'}],[{d:'2026-08-10',stock:null,prev:0,sold:0},{d:'2026-08-11',stock:0,prev:null,sold:0}],'2026-08-31').open.length===1;
  o['no stock history: only the expiry applies, and the result says arrival was not checked']=(()=>{const c=calc([{id:'a',qty:10,day:'2026-08-20'}],null,'2026-08-31');return c.checked===false&&c.open.length===1&&c.qty===10;})();
  // ── unavailable / loading: nothing downgraded, nothing zeroed or hidden ──
  setPos([['O1','PO-1',240,'2026-08-25']],'error');
  x=iss('O1');const c2=cnt();
  o['unavailable: a failed read downgrades nothing (O1 stays critical, guide 144..240) and the state is "unavailable", not 0']=x.band==='critical'&&x.qty.lo===144&&x.qty.hi===240&&x.oo.state==='unavailable'&&x.oo.qty===null&&c2.critical===11&&c2.act===5;
  o['unavailable: the page says "On-order data unavailable" with a Retry']=/On-order data unavailable/.test(R('_siPoNote()'))&&/_siPoRetry/.test(R('_siPoNote()'));
  o['unavailable: the Needs Attention page carries the note']=/On-order data unavailable/.test(R('_siNaListHtml()'));
  o['unavailable: the situation names it in the confidence text']=/On-order data unavailable/.test(R('_siNaPlaybook(_siNaState().issues.find(i=>i.code==="O1")).confidence'));
  setPos([['O1','PO-1',240,'2026-08-25']],'loading');
  x=iss('O1');
  o['loading: no downgrade yet and no note']=x.band==='critical'&&x.oo.state==='loading'&&R('_siPoNote()')==='';
  // ── playbook text ──
  setPos([['O1','PO-1',240,'2026-08-25']]);
  let pb=JSON.parse(R('J=JSON.stringify(_siNaPlaybook(_siNaState().issues.find(i=>i.code==="O1")))'));
  o['covered situation says why: names the PO, "Moved down from Critical", the expiry date and that it comes back']=/Already on order: PO-1 240 pcs \(raised 25 Aug\)/.test(pb.situation)&&/Moved down from Critical/.test(pb.why)&&/until about 9 Oct/.test(pb.why)&&/it comes back/.test(pb.why);
  o['covered playbook: first action is "do not raise a new PO"']=/^Do not raise a new PO: 240 pieces are already on order/.test(pb.actions[0].text);
  setPos([['O1','PO-1',100,'2026-08-25']]);
  pb=JSON.parse(R('J=JSON.stringify(_siNaPlaybook(_siNaState().issues.find(i=>i.code==="O1")))'));
  o['partial playbook: "already 100 on order" and the guide before (144–240)']=pb.actions.some(a=>/already 100 on order/.test(a.text)&&/144–240/.test(a.text))&&/already on order|are already on order/.test(pb.why);
  // ── rows, facts, verdict, Overview ──
  setPos([['O1','PO-<i>',240,'2026-08-25']]);
  const row=R('_siNaRowHtml(_siNaState().issues.find(i=>i.code==="O1"),false)');
  o['Needs Attention row: shows the chip and "moved down: PO covers it"']=/si-po-chip/.test(row)&&/On order: 240 pcs \(PO 25 Aug\)/.test(row)&&/moved down: PO covers it/.test(row);
  o['escaping: a hostile PO id never reaches the chip markup raw']=!/PO-<i>/.test(row)&&/PO-&lt;i&gt;/.test(row);
  const facts=R('_siNaFactsHtml(_siNaState().issues.find(i=>i.code==="O1"))');
  o['key numbers: an On order row and the guide "covered by the PO (144–240 before)"']=/On order/.test(facts)&&/covered by the PO \(144–240 before\)/.test(facts);
  setPos([['O1','PO-1',240,'2026-08-25']]);
  R('_siAxOvTile="reorder";_siAxOvCat="";_siAxOvAll=true;_siSection="articles";_siSub="overview";_siAxOvSit=""');
  const ov=R('_siAxOverviewBody()');
  o['Overview reorder tile: O1 row carries the chip']=/si-ov-row[\s\S]*?O1[\s\S]*?On order: 240 pcs \(PO 25 Aug\)/.test(ov);
  R('_siAxSel="O1"');
  const vd=R('_siAxSearchBody()');
  o['Explorer verdict: the chip and "Check the open PO before ordering again"']=/si-vd-po[^>]*>[\s\S]*?On order: 240 pcs/.test(vd)&&/Check the open PO before ordering again/.test(vd);
  const view=JSON.parse(R('J=JSON.stringify((()=>{const v=_siNaViewFor(_siAxIndex().map.get("O1"),"reorder");return{band:v.band,covers:!!v.n.onOrderCovers}})())'));
  o['Overview situation view reads the same adjusted issue (act, covered)']=view.band==='act'&&view.covers===true;
  setPos([['O1','PO-1',240,'2026-08-25']],'error');
  o['Overview reorder tile shows the unavailable note when the read failed']=/On-order data unavailable/.test(R('_siAxOverviewBody()'));
  // ── code matching and the read ──
  const reads=[];
  const gd=q=>{reads.push(q);return Promise.resolve({forEach(f){[
    {id:'d1',data:()=>({id:'PO-9',code:' o1 ',qty:36.4,createdAt:'2026-08-20'})},
    {id:'d2',data:()=>({code:'GST001-M',qty:50,ts:Date.UTC(2026,7,21,10)})},
    {id:'d3',data:()=>({id:'PO-0',code:'GX',qty:0,createdAt:'2026-08-20'})},
    {id:'d4',data:()=>({id:'PO-5',code:'GY',qty:10,createdAt:'junk'})},
    {id:'d5',data:()=>({id:'PO-6',qty:10,createdAt:'2026-08-20'})}].forEach(f);}});};
  const L=load(src,{getDocs:gd,query:(...a)=>({q:a}),where:(f,op,v)=>({where:[f,op,v]}),limit:n=>({limit:n}),collection:(d,n)=>({col:n})});
  const t0=Date.now();
  let rej=false;try{await L.run('_siPoLoad()');}catch(_){rej=true;}
  const w=reads[0]&&reads[0].q.find(z=>z.where);
  o['read: one query on pos, a single-field range on ts (>=) about 120 days back, capped at 400 documents']=reads.length===1&&reads[0].q[0].col==='pos'&&!!w&&w.where[0]==='ts'&&w.where[1]==='>='&&Math.abs(w.where[2]-(t0-120*86400000))<60000&&!!reads[0].q.find(z=>z.limit===400);
  o['read: ok; codes cleaned (" o1 " -> O1, GST001-M -> GST001); a bad day, no code and zero qty are dropped; qty rounded; ts falls back to the PKT day']=L.run('_siPoState')==='ok'&&L.run('J=JSON.stringify(Array.from(_siPoByCode.entries()))')===J([['O1',[{id:'PO-9',code:'O1',qty:36,day:'2026-08-20'}]],['GST001',[{id:'d2',code:'GST001',qty:50,day:'2026-08-21'}]]]);
  o['read: asked once per page load (a second call reuses the promise)']=(await L.run('_siPoLoad()'),reads.length)===1;
  const F=load(src,{getDocs:()=>Promise.reject(new Error('denied')),query:(...a)=>({q:a}),where:()=>({}),limit:()=>({}),collection:()=>({})});
  let rej2=false;try{await F.run('_siPoLoad()');}catch(_){rej2=true;}
  o['read failure: never rejects; state "error"; every article answers "unavailable", never an empty list']=!rej&&!rej2&&F.run('_siPoState')==='error'&&F.run('_siPoOpenFor("O1","2026-08-31").state')==='unavailable'&&F.run('_siPoOpenFor("O1","2026-08-31").qty')===null;
  // ── the loader starts the read ──
  const G=load(src,{getDocs:()=>Promise.resolve({forEach(){}})});
  try{await G.run('loadShopifyData()');}catch(_){}
  o['the page load starts the PO read (idle -> ok), outside the progress stages']=G.run('_siPoState')==='ok'&&!/pos/.test(R('J=JSON.stringify(_SI_STAGES.map(s=>s.id))'));
  o['assumptions are named constants: expiry 45 days, jump max(5, half the PO), read 120 days']=R('J=JSON.stringify([_SI_PO.expiryDays,_SI_PO.jumpMin,_SI_PO.jumpShare,_SI_PO.readDays])')==='[45,5,0.5,120]';
  return o;
}
module.exports=async function(){
  const s=suite('shopify-on-order');
  const base=await checks(SRC);
  s.section('Already on order: the read, the open quantity, arrival inference, band and guide (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  const K=Object.keys(base);
  const k=t=>K.find(x=>x.indexOf(t)===0);
  await brk('expiry 90 days','expiryDays:45,','expiryDays:90,',[k('expiry: a PO raised 45 days ago')]);
  await brk('no band downgrade',"if(down){x.n.bandBefore=x.band;x.band=down;}",'',[k('a PO of 240 covers the guide')]);
  await brk('guide not reduced','hi=up(q.hi-oo.qty),lo=up(q.lo-oo.qty)','hi=up(q.hi),lo=up(q.lo)',[k('a partial PO of 100 reduces')]);
  await brk('covered when the low end is met','if(hi<=0){','if(lo<=0){',[k('boundary: 239 on order')]);
  await brk('same-day jump counts','e.d>p.day&&e.rem>=thr','e.d>=p.day&&e.rem>=thr',[k('arrival: a jump ON the PO day')]);
  await brk('half the PO is only 10%','jumpShare:0.5','jumpShare:0.1',[k('arrival: a PO of 300 needs 150')]);
  await brk('one jump used again and again','hit.rem-=Math.min(hit.rem,p.qty);','',[k('arrival: one jump of 105 explains')]);
  await brk('a failed read reads as an empty list',"if(_siPoState!=='ok')return{state:'unavailable'","if(false)return{state:'unavailable'",[k('unavailable: a failed read downgrades nothing'),k('read failure: never rejects')]);
  await brk('read failure rejects',"}catch(_){_siPoState='error';}","}catch(_){throw _;}",[k('read failure: never rejects')]);
  await brk('PO codes not cleaned','_siCleanCode(_siCleanSku(d.code))','d.code',[k('read: ok; codes cleaned')]);
  await brk('read without the date window',"where('ts','>=',since),limit(_SI_PO.readCap)","limit(_SI_PO.readCap)",[k('read: one query on pos')]);
  await brk('row chip dropped','${_siPoChipHtml(i.code)}${i.n&&i.n.onOrderCovers','${i.n&&i.n.onOrderCovers',[k('Needs Attention row: shows the chip')]);
  await brk('PO id not escaped in the chip title','title="${_siEsc(_siPoChipTitle(oo))}"','title="${_siPoChipTitle(oo)}"',[k('escaping: a hostile PO id')]);
  await brk('Needs Attention memo ignores the PO read',"+'|'+_siIgKey()+'|'+_siPoSig();","+'|'+_siIgKey();",[k('covering PO: the counts follow')]);
  await brk('Overview chip dropped','${_siEsc(r.act.text)}${_siPoChipHtml(r.a.code)}','${_siEsc(r.act.text)}',[k('Overview reorder tile: O1 row')]);
  await brk('verdict chip dropped','    ${_siPoVerdictHtml(a,va)}\n','',[k('Explorer verdict')]);
  await brk('loader does not start the read',"if(_siPoState==='idle')_siPoLoad();",'',[k('the page load starts the PO read')]);
  await brk('unavailable note dropped','${_siMetaNote()}${_siPoNote()}','${_siMetaNote()}',[k('unavailable: the Needs Attention page carries')]);
  await brk('detector skips the PO',"out.forEach(x=>_siNaOnOrder(x,ctx));","",[k('Overview situation view reads'),k('a PO of 240 covers the guide')]);
  s.ok('breaks run: '+broken,broken>=18);
  return s;
};
module.exports._checks=checks;

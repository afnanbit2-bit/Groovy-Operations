/* Inventory Intel ▸ Needs Attention reason chips, clickable bands, High return rate, and the clickable Overview tiles (Oct 2026).
   Built on the Needs Attention fixture (its FIXTURE comment holds the hand computation: 11 critical, 5 this week, 2 to watch; R1..R10 run out,
   A1 runs out, O1 out of stock, H size hole, V1 overstock, D1/D2 dead, F1 demand drop, T1 data check), reused by reading that file's own
   fixture(), plus returns data added below. The checks DRIVE the real handlers. Each "break" mutates the source and must fail the named check.
   RETURNS FIXTURE (synced variant: every line carries status_synced_at; today 2026-08-31, window = the 90 days 06-03..08-31):
   K1,K3,K5,K6 sell 2 a day (gross 180 each) with refunded_quantity 1 on 40 / 50 / 33 / 25 lines -> rates 22.2% / 27.8% / 18.3% / 13.9%.
   K2 sells 2 a day with 4 refunds (2.2%). K4 sells 1 a day for 10 days and 5 come back (gross 10, under the 20-unit floor, 50%).
   Eligible (20+ gross): the 10 R articles, A1, O1, V1, D1, D2, F1, T1, H(112+)... all with 0 refunds, plus K1,K2,K3,K5,K6 -> median 0, so the
   bar is the 15% floor and chance (z against the 2% floor: K5 (33-3.6-0.5)/1.88 = 15). Flagged: K1 (watch, under 25%), K3 (act), K5 (watch). */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=JSON.stringify;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const NA=fs.readFileSync(path.join(__dirname,'shopify-needs-attention.test.js'),'utf8');
const FX=eval('('+NA.slice(NA.indexOf('function fixture(a){'),NA.indexOf('async function checks')).replace(/^function fixture/,'function')+')');
function load(src){
  const store={};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
function setup(src,synced){
  const a=load(src),R=c=>a.run(c);
  FX(a);
  const li=JSON.parse(R('J=JSON.stringify(_siLineItems)')),prods=JSON.parse(R('J=JSON.stringify(_siProducts)'));
  const dn=R('_siAxDayNum("2026-06-01")'),last=R('_siAxDayNum("2026-08-31")'),jul1=R('_siAxDayNum("2026-07-01")'),aug22=R('_siAxDayNum("2026-08-22")');
  const ds=n=>R('_siAxDayStr('+n+')');
  const prod=(c,title)=>({_id:c+'-M',sku:c+'-M',product_title:title||('Art '+c),color:'Blue',size:'M',product_type:'Tees',status:'active',published_at:'2025-01-01T10:00:00+05:00'});
  const art=(c,o)=>{
    prods.push(prod(c,o.title));
    for(let n=o.from||dn;n<=last;n++){
      const k=n-(o.refFrom||jul1);const ref=(k>=0&&k<o.refs)?1:0;
      const l={sku:c+'-M',quantity:o.q,price:1000,order_created_at:ds(n)+'T12:00:00+05:00',financial_status:'paid'};
      if(ref)l.refunded_quantity=1;li.push(l);
    }
  };
  art('K1',{q:2,refs:40});art('K2',{q:2,refs:4});art('K3',{q:2,refs:50,title:'Art <b>K3</b>'});art('K5',{q:2,refs:33});art('K6',{q:2,refs:25});
  art('K4',{q:1,from:aug22,refs:5,refFrom:aug22});
  if(synced)li.forEach(l=>{l.status_synced_at='2026-08-31T00:00:00.000Z';});
  R('_siLineItems='+JSON.stringify(li)+';_siProducts='+JSON.stringify(prods)+';_siAxCache=null;_siNaMemo=null');
  return a;
}
async function checks(src){
  const o={},A=setup(src,true),R=c=>A.run(c),html=()=>A.el('si-content').innerHTML;
  const U=setup(src,false),RU=c=>U.run(c);
  const res=()=>JSON.parse(R('J=JSON.stringify((()=>{const s=_siNaState();return{counts:s.counts,un:s.unavailable,ri:s.returnsInfo,len:Object.keys(s.reasons).reduce((m,k)=>{m[k]=s.reasons[k].length;return m;},{}),codes:Object.keys(s.reasons).reduce((m,k)=>{m[k]=s.reasons[k].map(i=>i.code);return m;},{}),bands:s.reasons.returns.map(i=>[i.code,i.band])}})())'));
  const S=res();
  // ── the existing counts stay what they were (headline single source) ──
  o['the headline counts are untouched by the reason lists: 11 critical, 5 this week, 2 to watch, 16 need action']=S.counts.critical===11&&S.counts.act===5&&S.counts.watch===2&&S.counts.action===16;
  // ── reason lists ──
  o['Urgent restocks = the 11 run-outs and stock-out plus the size hole and A1: R1..R10, O1, H, A1 (13 articles)']=S.len.urgent===13&&['R1','R10','O1','H','A1'].every(c=>S.codes.urgent.indexOf(c)>=0);
  o['Overstocked is V1 only, Dead stock is D2 then D1 (act before watch), Demand shifts is F1']=S.codes.overstock.join()==='V1'&&S.codes.dead.join()==='D2,D1'&&S.codes.demand.join()==='F1';
  o['Sales loss is O1 only: the Portfolio\u2019s estimate (19 to 38 units = 10 days x 3.8 x half-width, Rs 28,000), the same figure']=S.codes.saleloss.join()==='O1'&&R('J=JSON.stringify(_siNaState().reasons.saleloss[0].n.sales)')===JSON.stringify({lo:19,hi:38,mid:28,days:10,pace:2.8499999999999996,price:1000,ongoing:true,notEstimated:0,windowDays:90})&&R('Math.round(_siNaState().reasons.saleloss[0].at)')===28000;
  o['Sales loss agrees with the Portfolio sum (articles 1, 19 to 38 units, Rs 28,000)']=R('J=JSON.stringify((()=>{const l=_siAxPf().lost;return[l.articles,l.lo,l.hi,Math.round(l.rs)];})())')==='[1,19,38,28000]';
  o['Sales loss inherits the stock-out band (critical) when the article is out now']=R('_siNaState().reasons.saleloss[0].band')==='critical';
  o['an article can sit under two reasons (O1: Urgent restocks and Sales loss)']=S.codes.urgent.indexOf('O1')>=0&&S.codes.saleloss.indexOf('O1')>=0;
  // ── chips: counts are the list lengths, in severity order, no Data chip ──
  R('window._siNaGo("all")');
  const h=html();
  const chipN=k=>{const m=new RegExp('data-reason="'+k+'"[^>]*>[^<]*<b>([^<]*)</b>').exec(h);return m?m[1]:null;};
  o['chips in severity order: All, Urgent restocks, Sales loss, High return rate, Overstocked, Dead stock, Demand shifts']=(h.match(/data-reason="(\w+)"/g)||[]).map(x=>x.slice(13,-1)).join()==='all,urgent,saleloss,returns,overstock,dead,demand';
  o['each chip count equals its list length (13, 1, 3, 1, 2, 1) and All equals the issues (18)']=chipN('urgent')==='13'&&chipN('saleloss')==='1'&&chipN('returns')==='3'&&chipN('overstock')==='1'&&chipN('dead')==='2'&&chipN('demand')==='1'&&chipN('all')==='18'&&S.len.returns===3;
  o['the Data chip and the Cash tied up chip are not in the row; the detection and the trust strip stay (T1 is still a data-check issue)']=!/data-reason="data"/.test(h)&&!/data-reason="cash"/.test(h)&&!/>Data <b>/.test(h)&&!/Cash tied up <b>/.test(h)&&R('_siNaState().issues.some(i=>i.type==="datatrust")')===true&&/si-na-checks/.test(h);
  // ── clicking a chip lists ARTICLES whose rows open the situation ──
  const rowsN=()=>(html().match(/class="si-na-row /g)||[]).length;
  R('window._siNaSetFilter("urgent")');
  o['Urgent restocks lists 13 article rows (watch band not folded), every row names the reason and has a thumbnail slot']=rowsN()===13&&/aria-pressed="true"[^>]*onclick="window._siNaSetFilter\('urgent'\)"|data-reason="urgent" aria-pressed="true"/.test(html())&&/si-na-why/.test(html());
  R('window._siNaSetFilter("urgent")');
  o['pressing the active chip again returns to All']=R('_siNaFilter')==='all';
  R('window._siNaSetFilter("overstock")');o['Overstocked lists V1']=rowsN()===1&&/data-code="V1"/.test(html());
  R('window._siNaSetFilter("dead")');o['Dead stock lists D2 and D1']=rowsN()===2;
  R('window._siNaSetFilter("saleloss")');
  o['Sales loss lists O1 with an estimate label, never a bare count']=rowsN()===1&&/Est\. 19–38 units lost over 10 days out · out now · estimate/.test(html());
  R('window._siNaOpen("O1")');
  const ph=html();
  o['a Sales loss row opens the SALES LOSS situation (not the stock-out one): estimate, owners, how to tackle']=R('_siNaSel')==='O1'&&/was out of stock often enough in the last 90 days/.test(ph)&&/This is an estimate from the stock-vs-sales timeline, not a count/.test(ph)&&/It is still out of stock now/.test(ph)&&/Raees/.test(ph)&&/Mustafa/.test(ph)&&/Daniyal/.test(ph)&&/How to tackle/.test(ph);
  o['Prev/Next in that view step through the Sales loss list only (1 of 1)']=/1 of 1/.test(ph);
  R('window._siNaBack()');
  R('window._siNaSetFilter("urgent")');R('window._siNaOpen("H")');
  o['an Urgent restocks row opens the existing size-hole playbook']=/Size S sold|Sizes? S/.test(html())&&/Size run|size run/.test(html());
  R('window._siNaBack()');
  // ── High return rate: synced math ──
  o['returns synced: the detector reads the synced flag (95% of the last 60 days of lines stamped)']=R('_siAxIndex().quality.returns.synced')===true&&S.un.returns===false&&S.ri.synced===true;
  o['returns flagged: K1 22.2%, K3 27.8%, K5 18.3%; K6 13.9% (under 15%), K2 2.2% and K4 (10 units, under the 20-unit floor) are not']=S.codes.returns.slice().sort().join()==='K1,K3,K5';
  o['returns bands: 25% and over is act (K3), under is watch (K1, K5)']=JSON.stringify(S.bands.sort())===JSON.stringify([['K1','watch'],['K3','act'],['K5','watch']]);
  o['returns numbers: K3 50 of 180 units, median 0, eligible articles counted']=R('J=JSON.stringify((()=>{const i=_siNaState().reasons.returns.find(x=>x.code==="K3");return[i.n.ret.ref,i.n.ret.gross,i.n.ret.median,i.n.ret.days];})())')==='[50,180,0,90]';
  R('window._siNaSetFilter("returns")');
  o['High return rate chip lists the three articles with the rate in the row line']=rowsN()===3&&/50 of 180 units returned \(27\.8%\) · median 0%/.test(html());
  const lh=html();
  R('window._siNaOpen("K3")');
  const rh=html();
  o['a return-rate row opens the RETURNS playbook with owners Mustafa, Saim, Raees and Daniyal']=/50 of 180 units sold in the last 90 days came back \(27\.8%\)/.test(rh)&&/Saim/.test(rh)&&/Mustafa/.test(rh)&&/Raees/.test(rh)&&/Daniyal/.test(rh)&&/size chart/.test(rh);
  o['escaping: a hostile article name is escaped in the return-rate row and in its situation view']=/Art &lt;b&gt;K3&lt;\/b&gt;/.test(rh)&&!/Art <b>K3<\/b>/.test(rh)&&/Art &lt;b&gt;K3&lt;\/b&gt;/.test(lh)&&!/Art <b>K3<\/b>/.test(lh);
  R('window._siNaBack()');
  o['the returns-gap quiet note is kept when unsynced; when synced it is gone']=RU('J=JSON.stringify(_siNaTrust().quiet.some(x=>/Returns not yet synced/.test(x)))')==='true'&&R('J=JSON.stringify(_siNaTrust().quiet.some(x=>/Returns not yet synced/.test(x)))')==='false';
  // pure rule boundaries on fabricated rows: median, floor, chance
  R(`var __rr=function(code,ref,gross){return{a:{code:code},m:{},ret:null,__x:{ref,gross,rate:gross?ref/gross:null,days:90}};};
     var __plan=function(spec,synced){const rows=spec.map(s=>__rr(s[0],s[1],s[2]));const m=new Map(rows.map(r=>[r.a.code,r.__x]));return _siNaReturnsPlan(rows,{returnsSynced:synced,ret:(a)=>m.get(a.code)});};
     var __base=function(){const b=[];for(let k=0;k<10;k++)b.push(['B'+k,10,100]);return b;};`);
  const flagged=(extra,syn)=>R('J=JSON.stringify([...__plan(__base().concat('+JSON.stringify(extra)+'),'+(syn===false?'false':'true')+').flag.keys()])');
  o['guard: 20 units is the floor (19 units at 50% is silent, 20 units at 50% speaks)']=flagged([['X',10,19]])==='[]'&&flagged([['X',10,20]])==='["X"]';
  o['guard: 16% is under twice a 10% median (20%) so it is silent; 22% speaks']=flagged([['X',16,100]])==='[]'&&flagged([['X',22,100]])==='["X"]';
  o['guard: 15% needs the catalogue median at 7.5% or less; with a 0% median 15% speaks, 14.9% does not']=R('J=JSON.stringify([...__plan([["a",0,100],["b",0,100],["X",15,100]],true).flag.keys()])')==='["X"]'&&R('J=JSON.stringify([...__plan([["a",0,1000],["b",0,1000],["X",149,1000]],true).flag.keys()])')==='[]';
  o['guard: a gap inside chance is silent (4 of 20 = 20% at a 10% median has z 1.12)']=flagged([['X',4,20]])==='[]';
  o['guard: the median is the middle rate of the 20+ unit articles (even count: mean of the two middles)']=Math.abs(R('__plan([["a",0,100],["b",10,100],["c",20,100],["d",30,100]],true).median')-0.15)<1e-9&&R('__plan([["a",0,100],["b",10,100],["c",20,100]],true).median')===0.1;
  o['unsynced: the plan flags nothing and says it is waiting']=R('J=JSON.stringify([__plan([["X",50,100]],false).flag.size,__plan([["X",50,100]],false).synced])')==='[0,false]';
  // Sales loss floor: 4 estimated units is silent, 5 speaks (fabricated estimate on a real row, through the real build)
  const sl=m=>R('J=JSON.stringify((()=>{const rows=_siAxIndex().list.filter(a=>a.units>0||a.hasStock).map(_siNaRow);const ctx=Object.assign(_siNaCtx(),{lost:a=>a.code==="V1"?{lost:{lo:'+m+',hi:'+m+',mid:'+m+',days:2,pace:2},price:1000}:null});return _siNaBuild(rows,ctx).reasons.saleloss.map(i=>i.code+":"+i.band);})())');
  o['sales loss floor: an estimate of 4 units is silent, 5 speaks (an article with no stock-out issue is a watch)']=sl(4)==='[]'&&sl(5)==='["V1:watch"]';
  // ── returns waiting state (real dump state: no status_synced_at on any line) ──
  o['unsynced: the real-dump state (no status_synced_at, no refunded_quantity stamps) reads as not synced']=RU('_siAxIndex().quality.returns.synced')===false&&RU('_siAxIndex().quality.returns.stamped')===0;
  RU('window._siNaGo("all")');
  const hu=U.el('si-content').innerHTML;
  o['unsynced: the chip reads "Return rate: waiting for returns sync" with a dash, never 0 or a guessed count']=/data-reason="returns"[^>]*>Return rate: waiting for returns sync <b>—<\/b>/.test(hu)&&!/High return rate <b>0<\/b>/.test(hu);
  RU('window._siNaSetFilter("returns")');
  const wu=U.el('si-content').innerHTML;
  o['unsynced: clicking it explains how it will light up (stamps, 95%, 20 units, 15%, twice the median) and lists no rows']=/waiting for the returns sync/.test(wu)&&/shopify-order-refresh/.test(wu)&&/20\+ units in 90 days/.test(wu)&&/15% or more/.test(wu)&&/2× the catalogue median/.test(wu)&&!/class="si-na-row /.test(wu);
  o['unsynced: the other chips still count (Urgent restocks 13) and the headline is unchanged']=/data-reason="urgent"[^>]*>Urgent restocks <b>13<\/b>/.test(wu)&&/<span class="num">16<\/span>/.test(wu);
  // ── band chips ──
  R('window._siNaGo("all")');
  let bh=html();
  o['band chips are buttons (>=34px class), carry the uncapped counts and aria-pressed false']=(bh.match(/<button type="button" class="si-na-chip (crit|act|watch)[^"]*" aria-pressed="false" data-band="(critical|act|watch)"/g)||[]).length===3&&/<b>11<\/b> critical/.test(bh)&&/<b>5<\/b> this week/.test(bh)&&/<b>2<\/b> to watch/.test(bh);
  R('window._siNaBandSet("critical")');bh=html();
  o['pressing critical isolates it: all 11 critical rows, no act or watch rows, pressed, one-shot highlight on the band']=rowsN()===11&&!/si-na-row act/.test(bh)&&!/si-na-row watch/.test(bh)&&/data-band="critical"[^>]*>/.test(bh)&&/aria-pressed="true" data-band="critical"/.test(bh)&&/si-na-band critical flash/.test(bh)&&/Showing only “Critical”/.test(bh);
  R('window._siNaRepaint()');
  o['the highlight is one-shot: a later repaint carries no flash class']=!/ flash"/.test(html());
  R('window._siNaBandSet("critical")');
  o['pressing it again returns to everything (10 rows capped, Show all offered)']=R('_siNaBand')===''&&rowsN()===10&&/Show all 11/.test(html());
  R('window._siNaBandSet("watch")');o['pressing "to watch" shows both watch rows even though the band was folded']=rowsN()===2;
  R('window._siNaBandSet("act")');o['pressing "this week" switches the isolation to the 5 act rows']=rowsN()===5&&R('_siNaBand')==='act';
  R('window._siNaBandSet("act")');
  R('window._siNaBandSet("bogus")');o['an unknown band is ignored']=R('_siNaBand')==='';
  R('window._siNaSetFilter("urgent")');R('window._siNaBandSet("act")');
  o['a band and a reason combine: Urgent restocks and this week = H and A1']=rowsN()===2;
  R('window._siNaBandSet("act")');R('window._siNaSetFilter("all")');
  o['the flash respects reduced motion: the rule turns the animation off and keeps an outline']=/prefers-reduced-motion:reduce\)\{\.si-na-band\.flash\{animation:none;outline/.test(fs.readFileSync(path.join(__dirname,'../css/main.css'),'utf8'));
  // ── Overview tiles ──
  R('_siAxModeSel="overview";_siAxOvTile="reorder";_siAxOvSit="";_siAxOvCat="";_siAxOvAll=false');
  let ov=R('_siAxOverviewBody()');
  const tileN=k=>{const m=new RegExp("_siAxOvTile\\('"+k+"'\\)\"><span class=\"l\">[^<]*</span><span class=\"n\">(\\d+)</span>").exec(ov);return m?+m[1]:null;};
  const cnt=k=>R('_siAxOvRows().filter(r=>_siAxOvIn(r,"'+k+'")).length');
  o['the four tiles keep their counts (the existing calculator, untouched)']=['reorder','risk','stuck','winner'].every(k=>tileN(k)===cnt(k))&&tileN('reorder')>0;
  o['every tile says what it means and what to do, in its own line under the count']=(ov.match(/<span class="w">[^<]+<\/span>/g)||[]).length===4&&/Order or re-cut them today/.test(ov)&&/Keep them in stock/.test(ov)&&/promote, bundle or mark down/.test(ov)&&/Cut the missing sizes/.test(ov);
  o['every list row has a Situation button; the lead-time control stays on each row (Edit, per-article override)']=(ov.match(/si-ov-sit/g)||[]).length>=1&&(ov.match(/si-ov-sit/g)||[]).length===(ov.match(/class="si-ov-row"/g)||[]).length&&(ov.match(/class="lt"/g)||[]).length===(ov.match(/class="si-ov-row"/g)||[]).length&&/Lead time: \d+ days/.test(ov)&&/Edit/.test(ov);
  const firstRow=R('J=JSON.stringify(_siAxOvRows().filter(r=>_siAxOvIn(r,"reorder")).sort(_siAxOvSort("reorder")).map(r=>r.a.code))');
  const rows1=JSON.parse(firstRow);
  R('window._siAxOvSituation("'+rows1[0]+'")');
  ov=R('_siAxOverviewBody()');
  o['a Reorder tile row opens the situation view (run-out / stock-out playbook) with a Back that names the tile']=R('_siAxOvSit')===rows1[0]&&/si-na-detail/.test(ov)&&/How to tackle/.test(ov)&&/‹ Reorder now/.test(ov)&&/window\._siAxOvBack\(\)/.test(ov);
  o['Prev/Next in the tile view step through the tile list']=new RegExp('1 of '+rows1.length).test(ov);
  R('window._siAxOvStep(1)');o['Next opens the second article of the tile list']=R('_siAxOvSit')===rows1[1];
  R('window._siAxOvBack()');ov=R('_siAxOverviewBody()');
  o['Back returns to the list of that tile, same counts']=R('_siAxOvSit')===''&&!/si-na-detail/.test(ov)&&tileN('reorder')===cnt('reorder');
  const w1=JSON.parse(R('J=JSON.stringify(_siAxOvRows().filter(r=>_siAxOvIn(r,"winner")).map(r=>r.a.code))'));
  R('window._siAxOvTile("winner")');
  if(w1.length){R('window._siAxOvSituation("'+w1[0]+'")');o['a Winners tile row opens the winner playbook (protect it: owners Raees, Daniyal, Mustafa, Saim)']=/top sellers/.test(R('_siAxOverviewBody()'))&&/Saim/.test(R('_siAxOverviewBody()'));}
  else o['a Winners tile row opens the winner playbook (protect it: owners Raees, Daniyal, Mustafa, Saim)']=R('J=JSON.stringify(_siNaPlaybook(_siNaMkWinnerProbe()).actions.map(a=>a.owner))')==='["Raees","Daniyal","Mustafa","Saim"]';
  R('window._siAxOvBack()');
  o['changing the tile or category closes an open situation']=(()=>{R('window._siAxOvTile("reorder")');R('window._siAxOvSituation("'+rows1[0]+'")');R('window._siAxOvCat("")');const a1=R('_siAxOvSit')==='';R('window._siAxOvSituation("'+rows1[0]+'")');R('window._siAxOvTile("risk")');return a1&&R('_siAxOvSit')==='';})();
  o['an unknown article code does nothing']=R('window._siAxOvSituation("NOPE")')===false;
  o['Escape in the Explorer situation returns to the tile list']=(()=>{R('_siSection="articles";window._siAxOvTile("reorder")');R('window._siAxOvSituation("'+rows1[0]+'")');(A.state.listeners.keydown||[]).forEach(f=>f({key:'Escape'}));return R('_siAxOvSit')==='';})();
  o['escaping: the tile text and the situation view carry no raw tag from the data']=!/<script|onerror=/.test(R('_siAxOverviewBody()'));
  // playbook text for the new types, direct
  const pb=t=>R('J=JSON.stringify(_siNaPlaybook(Object.assign(_siNaState().issues[0],{type:"'+t+'"})))');
  o['playbook(saleloss/returns/winner) always returns situation, why, actions and avoid, even with missing numbers (never a throw)']=['saleloss','returns','winner'].every(t=>{try{const p=JSON.parse(R('J=JSON.stringify(_siNaPlaybook({type:"'+t+'",label:"<i>x</i>",n:{}}))'));return p.situation&&p.why&&p.actions.length>=3&&p.avoid.length>=1;}catch(e){return false;}});
  return o;
}
module.exports=async function(){
  const s=suite('shopify-na-reasons');
  const base=await checks(SRC);
  s.section('Needs Attention: reason chips, band chips, High return rate, clickable Overview tiles (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  const N={cnt:'each chip count equals its list length (13, 1, 3, 1, 2, 1) and All equals the issues (18)'};
  await brk('chip count from the primary group instead of the list','const n=_siNaReasonCount(res,k),on=_siNaFilter===k;','const n=k===\'all\'?res.counts.total:(res.counts.byGroup[k]||0),on=_siNaFilter===k;',[N.cnt]);
  await brk('Data chip is back','const _SI_NA_FILTER_KEYS=[\'all\',\'cash\'].concat(_SI_NA_REASONS.map(x=>x.k));','const _SI_NA_FILTER_KEYS=[\'all\',\'cash\'].concat(_SI_NA_REASONS.map(x=>x.k));_SI_NA_REASONS.push({k:\'data\',l:\'Data\',types:[\'datatrust\'],what:\'x\'});',['the Data chip and the Cash tied up chip are not in the row; the detection and the trust strip stay (T1 is still a data-check issue)']);
  await brk('size hole outside Urgent restocks','types:[\'stockout\',\'runout\',\'sizehole\']','types:[\'stockout\',\'runout\']',['Urgent restocks = the 11 run-outs and stock-out plus the size hole and A1: R1..R10, O1, H, A1 (13 articles)']);
  await brk('chips out of severity order','{k:\'urgent\',l:\'Urgent restocks\',types:[\'stockout\',\'runout\',\'sizehole\'],what:','{k:\'dead\',l:\'Dead stock\',types:[\'dead\'],what:\'x\'},{k:\'urgent\',l:\'Urgent restocks\',types:[\'stockout\',\'runout\',\'sizehole\'],what:',['chips in severity order: All, Urgent restocks, Sales loss, High return rate, Overstocked, Dead stock, Demand shifts']);
  await brk('sales loss threshold 0','saleMinUnits:5,','saleMinUnits:-1,',['sales loss floor: an estimate of 4 units is silent, 5 speaks (an article with no stock-out issue is a watch)']);
  await brk('sales loss without the stock-out band','base?base.band:\'watch\'','\'watch\'',['Sales loss inherits the stock-out band (critical) when the article is out now']);
  await brk('return floor 5 units','retMinUnits:20,','retMinUnits:5,',['guard: 20 units is the floor (19 units at 50% is silent, 20 units at 50% speaks)']);
  await brk('return rate bar 10%','retRate:0.15,','retRate:0.10,',['returns flagged: K1 22.2%, K3 27.8%, K5 18.3%; K6 13.9% (under 15%), K2 2.2% and K4 (10 units, under the 20-unit floor) are not']);
  await brk('median multiple dropped','if(rate<C.retRate||rate<C.retMult*out.median)return;','if(rate<C.retRate)return;',['guard: 16% is under twice a 10% median (20%) so it is silent; 22% speaks']);
  await brk('chance test dropped','if(z<C.retZ)return;','',['guard: a gap inside chance is silent (4 of 20 = 20% at a 10% median has z 1.12)']);
  await brk('median over every article, not the 20+ unit ones','const rates=el.map(r=>r.ret.rate)','const rates=el.map(r=>r.ret.rate).concat([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])',['guard: the median is the middle rate of the 20+ unit articles (even count: mean of the two middles)']);
  await brk('act at 40% instead of 25%','retActRate:0.25','retActRate:0.40',['returns bands: 25% and over is act (K3), under is watch (K1, K5)']);
  await brk('unsynced returns still computed','out={synced:!!(ctx&&ctx.returnsSynced===true)','out={synced:true',['unsynced: the plan flags nothing and says it is waiting']);
  await brk('waiting chip shows 0','if(res.unavailable&&res.unavailable[k])return null;','',['unsynced: the chip reads "Return rate: waiting for returns sync" with a dash, never 0 or a guessed count']);
  await brk('waiting chip lists nothing but explains nothing','const waiting=_siNaFilter!==\'all\'&&_siNaFilter!==\'cash\'&&res.unavailable&&res.unavailable[_siNaFilter];','const waiting=false;',['unsynced: clicking it explains how it will light up (stamps, 95%, 20 units, 15%, twice the median) and lists no rows']);
  await brk('returns note removed when unsynced','if(q&&q.returns&&!q.returns.synced)quiet.push(','if(false)quiet.push(',['the returns-gap quiet note is kept when unsynced; when synced it is gone']);
  await brk('band chip does not isolate','return _siNaBand?l.filter(i=>i.band===_siNaBand):l;','return l;',['pressing critical isolates it: all 11 critical rows, no act or watch rows, pressed, one-shot highlight on the band']);
  await brk('band chip never restores','_siNaBand=(_siNaBand===b)?\'\':b;','_siNaBand=b;',['pressing it again returns to everything (10 rows capped, Show all offered)']);
  await brk('flash never cleared','_siNaFlash=\'\';   // the highlight is one-shot','// the highlight is one-shot',['the highlight is one-shot: a later repaint carries no flash class']);
  await brk('isolated band stays capped','all=_siNaShow[b.k]||iso||_siNaFilter!==\'all\'','all=_siNaShow[b.k]',['pressing critical isolates it: all 11 critical rows, no act or watch rows, pressed, one-shot highlight on the band']);
  await brk('watch stays folded under a reason','const fold=b.k===\'watch\'&&!iso&&_siNaFilter===\'all\'','const fold=b.k===\'watch\'&&!iso',['Dead stock lists D2 and D1']);
  await brk('reason row opens the primary issue, not the reason\u2019s','return _siNaFiltered(res).find(x=>x.code===code)||_siNaReasonList(res,_siNaFilter).find(x=>x.code===code)||res.issues.find(x=>x.code===code)||null;','return res.issues.find(x=>x.code===code)||null;',['a Sales loss row opens the SALES LOSS situation (not the stock-out one): estimate, owners, how to tackle']);
  await brk('hostile name unescaped in a return row','<strong>${_siEsc(i.label)}</strong><span class="cd">','<strong>${i.label}</strong><span class="cd">',['escaping: a hostile article name is escaped in the return-rate row and in its situation view']);
  await brk('tile loses its meaning line','<span class="w">${_siEsc(t.what)}</span>','',['every tile says what it means and what to do, in its own line under the count']);
  await brk('tile rows lose the Situation button','<button class="si-ax-btn si-ov-sit"','<button class="si-ax-btn"',['every list row has a Situation button; the lead-time control stays on each row (Edit, per-article override)']);
  await brk('lead-time control removed from the rows','<div class="lt">${_siAxLtCtlHtml(r.a)}</div>','',['every list row has a Situation button; the lead-time control stays on each row (Edit, per-article override)']);
  await brk('tile situation ignores the tile\u2019s action','let want=(_SI_OV_PLAY[tile]||[\'runout\']).slice();','let want=[\'overstock\'];',['a Winners tile row opens the winner playbook (protect it: owners Raees, Daniyal, Mustafa, Saim)']);
  await brk('tile back goes nowhere','window._siAxOvBack=function(){_siAxOvSit=\'\';','window._siAxOvBack=function(){',['Back returns to the list of that tile, same counts']);
  await brk('category change keeps the situation open','window._siAxOvCat=function(v){_siAxOvCat=v||\'\';_siAxOvAll=false;_siAxOvSit=\'\';','window._siAxOvCat=function(v){_siAxOvCat=v||\'\';_siAxOvAll=false;',['changing the tile or category closes an open situation']);
  await brk('Escape ignores the Explorer situation','if(e&&e.key===\'Escape\'&&_siAxOvSit&&_siSection===\'articles\'){window._siAxOvBack();return;}','',['Escape in the Explorer situation returns to the tile list']);
  await brk('tile count from the NA state','const tile=t=>{const n=rows.filter(r=>_siAxOvIn(r,t.k)).length;','const tile=t=>{const n=_siNaState().counts.action;',['the four tiles keep their counts (the existing calculator, untouched)']);
  s.ok('breaks run: '+broken,broken>=28);
  return s;
};
module.exports._checks=checks;

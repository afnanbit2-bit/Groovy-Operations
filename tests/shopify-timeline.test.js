/* Inventory Intel ▸ Article Explorer — the "Stock vs sales" timeline (one article).
   Every expectation is HAND-COMPUTED (comments below), clock pinned to 2026-09-15. Each "break" mutates the source
   and requires the named check to FAIL. The handlers are driven for real; no Firestore read is allowed. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const dn=s=>Math.floor(Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10))/86400000);
const ds=n=>new Date(n*86400000).toISOString().slice(0,10);
function load(src,store,counter){
  store=store||{};counter=counter||{n:0};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},
      getDocs:()=>{counter.n++;return Promise.resolve({forEach(){}});},getDoc:()=>{counter.n++;return Promise.resolve({exists:()=>false});}}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
// Fixture, series 2026-07-01 .. 2026-09-15 (77 days). Snapshots 07-10..09-15 except 08-20 (one missing day).
// GT (Tees): sold 2/day 07-01..08-11 | 08-12,13,15: 0, 08-14: 1 | 08-16..08-18: 10 | 08-19..09-10: 4 | 09-11..09-15: 0.
//   stock: 50 to 08-10 (08-05 also has a variant at -3) | 0 on 08-11..08-15 | 200 on 08-16, then minus the day's sales | 0 from 09-10.
// GL: 2/day 07-01..07-25, stock 30 then 0 from 07-26 (a 51-day stretch).  GS: 1 unit on 07-12,07-20,07-28,08-05, stock 10 then 0 from 08-11.
function build(withLoc){
  const sold={GT:{},GL:{},GS:{}};
  for(let k=dn('2026-07-01');k<=dn('2026-08-11');k++)sold.GT[ds(k)]=2;
  sold.GT['2026-08-12']=0;sold.GT['2026-08-13']=0;sold.GT['2026-08-14']=1;sold.GT['2026-08-15']=0;
  for(let k=dn('2026-08-16');k<=dn('2026-08-18');k++)sold.GT[ds(k)]=10;
  for(let k=dn('2026-08-19');k<=dn('2026-09-10');k++)sold.GT[ds(k)]=4;
  for(let k=dn('2026-07-01');k<=dn('2026-07-25');k++)sold.GL[ds(k)]=2;
  ['2026-07-12','2026-07-20','2026-07-28','2026-08-05'].forEach(d=>sold.GS[d]=1);
  const li=[];Object.keys(sold).forEach(c=>Object.keys(sold[c]).forEach(d=>{if(sold[c][d])li.push({sku:c+'-M',quantity:sold[c][d],price:1000,order_created_at:d+'T12:00:00+05:00',financial_status:'paid'});}));
  const gt={};
  for(let k=dn('2026-07-10');k<=dn('2026-09-15');k++){
    const d=ds(k);let v;
    if(d<='2026-08-10')v=50;else if(d<='2026-08-15')v=0;else if(d==='2026-08-16')v=200;else if(d<'2026-09-10')v=gt[ds(k-1)]-(sold.GT[d]||0);else v=0;
    gt[d]=v;
  }
  // 08-20 is computed above (172) but its snapshot is not written
  const snaps=[];
  for(let k=dn('2026-07-10');k<=dn('2026-09-15');k++){
    const d=ds(k);if(d==='2026-08-20')continue;
    const it={m:{sku:'GT-M',available:gt[d]},l:{sku:'GT-L',available:d==='2026-08-05'?-3:0},
      gl:{sku:'GL-M',available:d<='2026-07-25'?30:0},gs:{sku:'GS-M',available:d<='2026-08-10'?10:0}};
    const doc={date:d,items:it};if(withLoc&&d>='2026-08-01')doc.locations_seen=2;
    snaps.push(doc);
  }
  const prod=c=>({_id:c+'-M',sku:c+'-M',product_title:'Art '+c,color:'Blue',size:'M',product_type:'Tees',status:'active',published_at:'2025-01-01T10:00:00+05:00'});
  return{li,snaps,prods:['GT','GL','GS'].map(prod),gt};
}
function setup(src,store,counter,withLoc){
  const a=load(src,store,counter),R=c=>a.run(c),fx=build(withLoc);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-09-15")+(off||0));}');
  R('_siProducts='+J(fx.prods)+';_siLineItems='+J(fx.li)+';_siHist=_siAxBuildHistory('+J(fx.snaps)+');_siHistState="ok";_siSnapshot='+J(fx.snaps[fx.snaps.length-1])+';_siPrevSnapshot=null;_siAxCache=null;_siAxTlRes="day";_siAxTlRange="all"');
  return{a,R,fx};
}
const near=(x,y)=>Math.abs(x-y)<1e-6;
function checks(src){
  const store={'groovy-si-leadtimes-article':'{"GT":10}'},counter={n:0};
  const {R,fx}=setup(src,store,counter,true);
  const TL=c=>R('(()=>{const idx=_siAxIndex();const a=idx.map.get("'+c+'");return _siAxTimeline(a,_siHist,{from:idx.cov,to:"2026-09-15"});})()');
  const o={},gt=TL('GT'),gl=TL('GL'),gs=TL('GS');
  const day=(tl,d)=>tl.days.find(x=>x.d===d);
  // ── stock-out stretches ──
  // run 1: stock 0 at the close of 08-11 (previous close 50, so 08-11 is still an in-stock day); both closes zero on 08-12..08-15 -> 4 out days, 1 unit sold (08-14)
  // run 2: 0 at the close of 09-10 (previous > 0 -> in stock); both zero 09-11..09-15 -> 5 days, still out at the end of the data
  o['stretches: 08-12..08-15 (4 days, 1 sold at zero stock) and 09-11..09-15 (5 days, still out)']=gt.runs.length===2&&gt.runs[0].from==='2026-08-12'&&gt.runs[0].to==='2026-08-15'&&gt.runs[0].days===4&&gt.runs[0].sold===1&&gt.runs[0].open===false&&gt.runs[1].from==='2026-09-11'&&gt.runs[1].days===5&&gt.runs[1].open===true;
  o['the day stock first reads 0 (08-11) is an in-stock day, 08-12 is the first out day']=day(gt,'2026-08-11').state==='in'&&day(gt,'2026-08-12').state==='out';
  // ── lost-sales estimate (in-stock pace only) ──
  // run 1 before: 28 in-stock days 07-15..08-11 at 2/day = 2.0 | after (skip 08-16..08-18): in-stock days 08-19 and 08-22..09-10 = 21 days, 84 units = 4.0 -> range 2..4, 4 days: 8..16, mid 12
  o['run 1 baseline before 2/day, after 4/day (first 3 days after the restock skipped)']=!!gt.runs[0].est&&near(gt.runs[0].est.lo,2)&&near(gt.runs[0].est.hi,4)&&gt.runs[0].est.basis==='before and after';
  // run 2 before only: last 28 in-stock days = 20 (08-22..09-10, 4 each) + 08-19 (4) + 08-16..08-18 (10 each) + 08-08..08-11 (2 each) = 80+4+30+8 = 122 -> 4.357143; range [0.5b, b]
  o['run 2 has a baseline before only: 122/28, half-width range']=!!gt.runs[1].est&&near(gt.runs[1].est.hi,122/28)&&near(gt.runs[1].est.lo,61/28)&&gt.runs[1].est.basis==='before only';
  const sum=R('(()=>{const idx=_siAxIndex();const a=idx.map.get("GT");const tl=_siAxTimeline(a,_siHist,{from:idx.cov,to:"2026-09-15"});return _siAxTlSummary(tl,"all",_siAxLeadTime(a));})()');
  // lo = 4*2 + 5*61/28 = 18.893 -> 19 | hi = 4*4 + 5*122/28 = 37.786 -> 38 | mid = 12 + 5*91.5/28 = 28.339 -> 28 | pace = 28.339/9 = 3.149
  o['lost units over the whole view: 19 to 38 (mid 28), pace 3.1 a day']=!!sum.lost&&sum.lost.lo===19&&sum.lost.hi===38&&sum.lost.mid===28&&near(sum.lost.pace,(12+5*91.5/28)/9);
  o['out 9 of 65 measured days, 1 unit sold at zero stock']=sum.out===9&&sum.measured===65&&sum.soldAtZero===1;
  // a missing snapshot (08-20) leaves 2 no-data days inside the stretch: it continues across them (span 51 days, 49 of them measured out)
  o['a 51-day stretch is not estimated: probably discontinued']=gl.runs.length===1&&gl.runs[0].days===51&&gl.runs[0].outDays===49&&gl.runs[0].est===null&&/longer than 42 days/.test(gl.runs[0].why);
  o['a stretch with under 5 in-stock units before it has no baseline']=gs.runs.length===1&&gs.runs[0].days===35&&gs.runs[0].outDays===33&&gs.runs[0].est===null&&/not enough in-stock selling/.test(gs.runs[0].why);
  const w30=R('(()=>{const idx=_siAxIndex();const a=idx.map.get("GT");const tl=_siAxTimeline(a,_siHist,{from:idx.cov,to:"2026-09-15"});return _siAxTlSummary(tl,"30",_siAxLeadTime(a));})()');
  // last 30 days = 08-17..09-15: 08-20 and 08-21 have no reading -> 28 measured; 5 out days; run 2 only: 5*61/28=10.89 -> 11, 5*122/28=21.79 -> 22, mid 16.34 -> 16
  o['30-day window: 28 measured, 5 out, lost 11 to 22']=w30.measured===28&&w30.out===5&&!!w30.lost&&w30.lost.lo===11&&w30.lost.hi===22&&w30.lost.mid===16&&w30.runs.length===1;
  // ── gaps and the negative clamp ──
  o['a day with no snapshot is a gap (null, no data), never zero']=day(gt,'2026-08-20').stock===null&&day(gt,'2026-08-20').state==='nodata'&&day(gt,'2026-08-21').state==='nodata'&&gt.gapDays===1;
  o['days before the stock history have no stock data']=day(gt,'2026-07-01').stock===null&&day(gt,'2026-07-09').state==='nodata'&&day(gt,'2026-07-10').state==='nodata';
  o['sales are still counted on days with no stock data']=day(gt,'2026-07-01').sold===2&&day(gt,'2026-08-20').sold===4;
  o['negative stock is clamped to 0 (50 + 0, not 47) and counted as oversold']=day(gt,'2026-08-05').stock===50&&day(gt,'2026-08-05').neg===1&&gt.negDays===1;
  // ── restocks ──
  // 08-16: 200 - 0 + 10 sold = 210 >= 20 and >= 25% of 0 -> solid; the +2 residuals of the steady days are noise (< max(5, 10%))
  o['one restock inferred: +210 on 08-16, solid']=gt.events.length===1&&gt.events[0].d==='2026-08-16'&&gt.events[0].resid===210&&gt.events[0].strong===true;
  // ── readout, coverage, lead time ──
  const card=R('(()=>{_siAxTlRes="day";_siAxTlRange="all";return _siAxTlCardHtml(_siAxIndex().map.get("GT"));})()');
  const sumLt=sum.lt||{};
  o['lead time 10 days (article override): an order on 09-05 lands today; the stretch from 09-11 needed ordering by 09-01']=sumLt.days===10&&sumLt.placed==='2026-09-05'&&sumLt.lands==='2026-09-15'&&!!sumLt.latest&&sumLt.latest.orderBy==='2026-09-01';
  const lines=R('(()=>{const idx=_siAxIndex();const a=idx.map.get("GT");const tl=_siAxTimeline(a,_siHist,{from:idx.cov,to:"2026-09-15"});return _siAxTlReadout(_siAxTlSummary(tl,"all",_siAxLeadTime(a)),true);})()');
  const txt=lines.join('\n');
  o['readout: out of stock 9 of the 65 days (14%)']=lines[0]==='Out of stock 9 of the 65 days measured in this view (14%).';
  o['readout: lost units labelled an estimate, in-stock pace only, with rupees']=/Estimate, not a count: about 19–38 units of sales were likely lost/.test(txt)&&/in-stock pace \(about 3\.1 a day\)/.test(txt)&&/PKR 19,000–PKR 38,000/.test(txt);
  o['readout: still out of stock since 11 Sep (5 days) and the 1 unit sold at zero stock']=/Out of stock now: since 11 Sep 2026 \(5 days\)/.test(txt)&&/1 unit sold on days stock read zero/.test(txt);
  o['readout: one restock, about 210 units, inferred not received']=/1 restock inferred from stock jumps \(about 210 units in total\)/.test(txt);
  o['readout: lead time sentence with the order-by date']=/Lead time 10 days \(your lead time for this article\): an order placed on 5 Sep 2026 would land today\./.test(txt)&&/had to be placed by 1 Sep 2026/.test(txt);
  const cov=R('(()=>{const idx=_siAxIndex();const a=idx.map.get("GT");const tl=_siAxTimeline(a,_siHist,{from:idx.cov,to:"2026-09-15"});return _siAxTlCoverage(tl,_siHist,idx.cov,"all");})()').join('\n');
  o['coverage: stock history 10 Jul to 15 Sep, 67 snapshots, sales from 1 Jul']=/Stock history: 10 Jul 2026 to 15 Sep 2026 \(67 daily snapshots/.test(cov)&&/Sales are counted from 1 Jul 2026/.test(cov);
  o['coverage: days before the history are a gap, the missing day is blank, negative stock clamped (1 day)']=/Days before 10 Jul 2026 have no stock data/.test(cov)&&/1 day inside the stock history has no snapshot and is left blank/.test(cov)&&/Negative stock counts as 0 \(1 day in this view had an oversold variant\)/.test(cov);
  o['coverage: the multi-location boundary (snapshots from 1 Aug sum 2 locations, the 22 before did not)']=/Snapshots from 1 Aug 2026 sum all 2 locations; the 22 before that did not record their locations/.test(cov);
  const covNone=setup(src,{},{n:0},false).R('(()=>{const idx=_siAxIndex();const a=idx.map.get("GT");const tl=_siAxTimeline(a,_siHist,{from:idx.cov,to:"2026-09-15"});return _siAxTlCoverage(tl,_siHist,idx.cov,"all");})()').join('\n');
  o['coverage: snapshots that never recorded locations say so']=/do not record how many locations/.test(covNone);
  // ── chart: day view ──
  const dayHtml=R('(()=>{const idx=_siAxIndex();const a=idx.map.get("GT");const tl=_siAxTimeline(a,_siHist,{from:idx.cov,to:"2026-09-15"});return _siAxTlChartHtml(tl,"day","all",_siAxLeadTime(a));})()');
  o['day view: 77 columns, hover table has one entry per day']=R('_siAxTlHov.n')===77&&R('_siAxTlHov.cols.length')===77;
  // lead-time marker: 09-05 is day index 66 (07-01 = 0): (66+0.5)/77 = 86.36%
  o['lead-time marker sits on 5 Sep (86.36%)']=/class="si-tl-lt" style="left:86.36%"/.test(dayHtml);
  // stock line is broken at the missing snapshot: known stretches 07-10..08-19 and 08-21..09-15 -> exactly two sub-paths in the line
  const linePath=(/<path class="si-tl-line" d="([^"]*)"/.exec(dayHtml)||[])[1]||'';
  o['the stock line is broken at the missing day (two sub-paths, nothing joined across it)']=(linePath.match(/M/g)||[]).length===2;
  // bands: 2 out stretches + 2 no-data stretches (07-01..07-10, 08-20..08-21), each drawn in the stock and the sales panel
  o['out-of-stock stretches are shaded: 2 stretches in each of the 2 panels']=(dayHtml.match(/class="si-tl-band out"/g)||[]).length===4&&(dayHtml.match(/class="si-tl-band nodata"/g)||[]).length===4;
  o['the one solid restock has a marker and a +210 label']=(dayHtml.match(/class="si-tl-rs strong"/g)||[]).length===1&&/>\+210</.test(dayHtml);
  o['the unit sold at zero stock is a striped bar']=(dayHtml.match(/class="si-tl-bar zero"/g)||[]).length===1;
  o['chart text is HTML: no <text> and no <title> anywhere in the chart']=!/<text[ >]/.test(dayHtml)&&!/<title/.test(dayHtml)&&!/<svg[^>]*>[^]*?<text/.test(dayHtml);
  // ── week view ──
  // weeks start Monday 06-29 .. 09-14: 12 columns. Week of 08-10: 4 out days -> out. Week of 09-07: 3 out days (<4) -> in. Week of 09-14: 2 days, both out -> out.
  // Week of 08-17 ends with the 08-23 close: 08-16 200, 190, 180, 176 (08-19), [08-20], 168 (08-21: 176-4*2), 164, 160 -> 160
  const wk=R('(()=>{const idx=_siAxIndex();const a=idx.map.get("GT");const tl=_siAxTimeline(a,_siHist,{from:idx.cov,to:"2026-09-15"});return _siAxTlColumns(tl,"week","all").map(c=>[c.d,c.state,c.stock,c.sold,c.outDays]);})()');
  const wc=d=>wk.find(x=>x[0]===d)||[];
  o['week view: 12 Monday-start columns']=wk.length===12&&wk[0][0]==='2026-06-29'&&wk[11][0]==='2026-09-14';
  o['a week is out only with 4+ days out (08-10 out, 09-07 in, a 2-day last week with both out is out)']=wc('2026-08-10')[1]==='out'&&wc('2026-09-07')[1]==='in'&&wc('2026-09-14')[1]==='out';
  o['week stock is the last close of the week (160), sales are summed (4+4+... = 08-17..08-23: 10+10+4+4+4+4+4 = 40)']=wc('2026-08-17')[2]===160&&wc('2026-08-17')[3]===40;
  const weekHtml=R('(()=>{const idx=_siAxIndex();const a=idx.map.get("GT");const tl=_siAxTimeline(a,_siHist,{from:idx.cov,to:"2026-09-15"});return _siAxTlChartHtml(tl,"week","all",_siAxLeadTime(a));})()');
  // 09-05 falls in the week of 08-31 = column 9 of 12: 9.5/12 = 79.17%
  o['week view: lead-time marker in the week of 31 Aug (79.17%)']=/class="si-tl-lt" style="left:79.17%"/.test(weekHtml)&&R('_siAxTlHov.n')===12;
  // ── 30-day range labels the stretch ──
  const d30=R('(()=>{const idx=_siAxIndex();const a=idx.map.get("GT");const tl=_siAxTimeline(a,_siHist,{from:idx.cov,to:"2026-09-15"});return _siAxTlChartHtml(tl,"day","30",_siAxLeadTime(a));})()');
  o['30-day range: 30 columns and the stretch is labelled "Out 5 d" once']=R('_siAxTlHov.n')===30&&(d30.match(/<b>Out 5 d<\/b>/g)||[]).length===1;
  // ── toggle handlers ──
  R('window._siAxTlSet("res","week");window._siAxTlSet("range","30");');
  const st1=R('_siAxTlRes+","+_siAxTlRange');
  R('window._siAxTlSet("res","year");window._siAxTlSet("range","7");window._siAxTlSet("bogus","day");');
  o['toggle: day/week and 30/90/all are accepted, anything else is ignored']=st1==='week,30'&&R('_siAxTlRes+","+_siAxTlRange')==='week,30';
  R('_siAxTlRes="day";_siAxTlRange="all"');
  const cardW=R('(()=>{window._siAxTlSet("res","week");return _siAxTlCardHtml(_siAxIndex().map.get("GT"));})()');
  o['the card reflects the toggle (Week pressed, 12 week rows in the table)']=/aria-pressed="true" onclick="window._siAxTlSet\('res','week'\)"/.test(cardW)&&(cardW.split('<tbody>').pop().match(/<tr>/g)||[]).length>=12;
  R('_siAxTlRes="day"');
  // ── a readout and a table always accompany the chart ──
  o['the card carries the read-out list, the stretches table and the numbers table']=/class="si-tl-read"/.test(card)&&/Out from<\/th>/.test(card)&&/Table of the numbers in this chart/.test(card)&&/class="si-ax-note si-tl-cov"/.test(card);
  // ── hover: drive the real handler ──
  const hov=R('(()=>{const mk=()=>({style:{},innerHTML:""});const cur=[mk(),mk()],tip=mk();const root={querySelectorAll:()=>cur,querySelector:()=>tip};_siAxTlRes="day";_siAxTlCardHtml(_siAxIndex().map.get("GT"));'+
    'window._siAxTlHover({clientX:445},{getBoundingClientRect:()=>({left:0,width:770}),closest:()=>root});return{html:tip.innerHTML,disp:tip.style.display,left:cur[0].style.left};})()');
  // x 445 of 770 -> column floor(445/10) = 44 = 14 Aug
  o['hover on 14 Aug: title, stock 0, sold 1, out of stock, "sold while stock read 0"']=/<b>14 Aug 2026<\/b>/.test(hov.html)&&/Stock on hand<\/span><strong>0</.test(hov.html)&&/Sold<\/span><strong>1</.test(hov.html)&&/out of stock/.test(hov.html)&&/sold while stock read 0/.test(hov.html)&&hov.disp==='block';
  const hovGap=R('(()=>{const mk=()=>({style:{},innerHTML:""});const cur=[mk()],tip=mk();const root={querySelectorAll:()=>cur,querySelector:()=>tip};'+
    'window._siAxTlHover({clientX:505},{getBoundingClientRect:()=>({left:0,width:770}),closest:()=>root});return tip.innerHTML;})()');
  // column floor(505/10) = 50 = 20 Aug, the missing snapshot
  o['hover on the missing day says "no stock data", not 0']=/<b>20 Aug 2026<\/b>/.test(hovGap)&&/no stock data/.test(hovGap)&&/no data \(gap\)/.test(hovGap);
  // ── no new Firestore reads ──
  o['no getDocs/getDoc call for any of the above']=counter.n===0;
  return o;
}
module.exports=async function(){
  const s=suite('shopify-timeline');
  const base=checks(SRC);
  s.section('stock vs sales timeline (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  let nb=0;
  const brk=(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    nb++;
    let r;try{r=checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true));
  };
  brk('out needs only one zero close',"const state=(stock!=null&&prev!=null)?((stock>0||prev>0)?'in':'out'):'nodata'","const state=(stock!=null&&prev!=null)?((stock>0&&prev>0)?'in':'out'):'nodata'",['stretches: 08-12..08-15 (4 days, 1 sold at zero stock) and 09-11..09-15 (5 days, still out)']);
  brk('after-restock days not skipped','skipAfter:3','skipAfter:0',['run 1 baseline before 2/day, after 4/day (first 3 days after the restock skipped)']);
  brk('baseline from every non-gap day',"if(x.state==='in')inIdx.push(x.i)","if(x.state!=='nodata')inIdx.push(x.i)",['run 1 baseline before 2/day, after 4/day (first 3 days after the restock skipped)','run 2 has a baseline before only: 122/28, half-width range']);
  brk('one-sided range is the full pace','oneSide:0.5','oneSide:1',['run 2 has a baseline before only: 122/28, half-width range']);
  brk('a missing snapshot splits a stretch','bridgeDays:2','bridgeDays:0',['a 51-day stretch is not estimated: probably discontinued','a stretch with under 5 in-stock units before it has no baseline']);
  brk('long stretches estimated','maxRun:42','maxRun:1000',['a 51-day stretch is not estimated: probably discontinued']);
  brk('baseline floor of units dropped','minBaseUnits:5','minBaseUnits:1',['a stretch with under 5 in-stock units before it has no baseline']);
  brk('lost units not multiplied by days','lo+=nWin*run.est.lo;hi+=nWin*run.est.hi;mid+=nWin*run.est.mid','lo+=run.est.lo;hi+=run.est.hi;mid+=run.est.mid',['lost units over the whole view: 19 to 38 (mid 28), pace 3.1 a day','30-day window: 28 measured, 5 out, lost 11 to 22']);
  brk('missing snapshot read as zero','const stock=sv==null?null:sv,prev=pv==null?null:pv','const stock=sv==null?0:sv,prev=pv==null?0:pv',['a day with no snapshot is a gap (null, no data), never zero','the stock line is broken at the missing day (two sub-paths, nothing joined across it)']);
  brk('negative stock not clamped','sums.set(code,(sums.get(code)||0)+Math.max(0,it.available||0))','sums.set(code,(sums.get(code)||0)+(it.available||0))',['negative stock is clamped to 0 (50 + 0, not 47) and counted as oversold']);
  brk('lead time marker on the wrong side','placed:_siAxDayStr(tn-lt.days)','placed:_siAxDayStr(tn+lt.days)',['lead time 10 days (article override): an order on 09-05 lands today; the stretch from 09-11 needed ordering by 09-01','readout: lead time sentence with the order-by date']);
  brk('chart lead marker on the wrong day','const placed=_siAxDayStr(_siAxDayNum(tl.to)-lt.days);','const placed=_siAxDayStr(_siAxDayNum(tl.to)-lt.days-1);',['lead-time marker sits on 5 Sep (86.36%)']);
  brk('a week is out after one day','weekOutDays:4','weekOutDays:1',['a week is out only with 4+ days out (08-10 out, 09-07 in, a 2-day last week with both out is out)']);
  brk('week stock is the first close','if(x.stock!=null)stock=x.stock;','if(x.stock!=null&&stock==null)stock=x.stock;',['week stock is the last close of the week (160), sales are summed (4+4+... = 08-17..08-23: 10+10+4+4+4+4+4 = 40)']);
  brk('restock threshold raised','strongResid:20','strongResid:500',['one restock inferred: +210 on 08-16, solid']);
  brk('location boundary dropped',"if(lc.max!=null&&lc.max>1&&lc.missing>0)L.push(","if(false)L.push(",['coverage: the multi-location boundary (snapshots from 1 Aug sum 2 locations, the 22 before did not)']);
  brk('estimate not labelled','Estimate, not a count: about ','About ',['readout: lost units labelled an estimate, in-stock pace only, with rupees']);
  brk('hover shows 0 for a gap',"c.stock==null?'no stock data':String(c.stock)","String(c.stock||0)",['hover on the missing day says "no stock data", not 0']);
  console.log('\n  breaks run: '+nb);
  return s;
};

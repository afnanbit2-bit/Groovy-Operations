/* Inventory Intel ▸ Article Explorer — the measures (docs/UNITS_METRICS.md).
   Every expectation below is HAND-COMPUTED from the fixture in the comments, not read back
   from the code. The clock is pinned to Monday 2026-08-31 so nothing depends on the day it runs.
   Fixture (first synced order 2026-06-01, from filler article GF):
     GA  published 2025-08-01 (live long before the data)  Tees   sales 06-01:5  06-15:10  07-15:10  08-10:6  08-20:9
         + refunded 50 (06-10) and voided 7 (06-11), both excluded  -> 40 units
     GB  published 2026-07-06 (mid-window)                 Tees   sales 07-10:4  08-12:8  08-13:1        -> 13 units
     GC  no publish date, first sale 06-03                 Tees   sales 06-03:2  07-01:3                  -> 5 units, no stock rows
     GD  no publish date, first sale 07-22                 Caps   sales 07-22:3  08-25:4                  -> 7 units
     GE  no publish date, first sale 08-28                 Caps   sales 08-28:1                            -> 1 unit, 4 counted days
     GG  published 2026-07-01, no sales, 6 on hand         Caps
     GF  filler, published 2025-01-01                      Tees   06-01:10
   Stock (end of day, one snapshot per day 08-01..08-31): GA 20 to 08-09, 14 from 08-10, 5 from 08-20,
   35 from 08-25 (30 received). GB 10 to 08-11, 2 on 08-12, 1 on 08-13, 0 from 08-14. */
'use strict';
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const near=(a,b)=>typeof a==='number'&&Math.abs(a-b)<1e-9;

module.exports=async function(){
  const s=suite('shopify-metrics');
  const a=harness.loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  const R=c=>a.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));}');
  const li=(sku,q,day,extra)=>Object.assign({sku,quantity:q,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'},extra||{});
  const prod=(sku,title,color,size,type,pub)=>({_id:sku,sku,product_title:title,color,size,product_type:type,status:'active',published_at:pub?pub+'T10:00:00+05:00':''});
  R('_siProducts='+J([
    prod('GA-M','Alpha Tee','Blue','M','Tees','2025-08-01'),prod('GB-M','Beta Tee','Red','M','Tees','2026-07-06'),
    prod('GC-M','Gamma Tee','Green','M','Tees',''),prod('GD-M','Delta Cap','Black','M','Caps',''),
    prod('GE-M','Echo Cap','White','M','Caps',''),prod('GG-M','Golf Cap','Grey','M','Caps','2026-07-01'),prod('GF-M','Filler','Pink','M','Tees','2025-01-01')]));
  R('_siLineItems='+J([
    li('GF-M',10,'2026-06-01'),
    li('GA-M',5,'2026-06-01'),li('GA-M',10,'2026-06-15'),li('GA-M',10,'2026-07-15'),li('GA-M',6,'2026-08-10'),li('GA-M',9,'2026-08-20'),
    li('GA-M',50,'2026-06-10',{financial_status:'refunded'}),li('GA-M',7,'2026-06-11',{financial_status:'voided'}),
    li('GB-M',4,'2026-07-10'),li('GB-M',8,'2026-08-12'),li('GB-M',1,'2026-08-13'),
    li('GC-M',2,'2026-06-03'),li('GC-M',3,'2026-07-01'),
    li('GD-M',3,'2026-07-22'),li('GD-M',4,'2026-08-25'),li('GE-M',1,'2026-08-28')]));
  const dayStr=n=>R('_siAxDayStr('+n+')');
  const base=R('_siAxDayNum("2026-08-01")');
  const snaps=[];
  for(let k=0;k<31;k++){
    const d=dayStr(base+k),dom=k+1;
    const ga=dom>=25?35:dom>=20?5:dom>=10?14:20;
    const gb=dom<=11?10:dom===12?2:dom===13?1:0;
    snaps.push({date:d,items:{a:{sku:'GA-M',available:ga},b:{sku:'GB-M',available:gb},g:{sku:'GG-M',available:6},z:{sku:'',available:99}}});
  }
  R('_siHist=_siAxBuildHistory('+J(snaps)+');_siHistState="ok";_siAxCache=null');
  R('_siSnapshot='+J(snaps[30])+';_siPrevSnapshot='+J(snaps[23])+';_siAxCache=null');
  const M=c=>R('_siAxStats(_siAxIndex().map.get("'+c+'"))');
  const eq=(n,x,y)=>s.eq(n,J(x),J(y));
  const close=(n,x,y)=>s.ok(n+' (got '+x+', expected '+y+')',near(x,y)||(typeof x==='number'&&typeof y==='number'&&Math.abs(x-y)<1e-6));

  s.section('net units: refunded and voided orders are excluded');
  eq('GA = 5+10+10+6+9 (refunded 50 and voided 7 left out)',R('_siAxIndex().map.get("GA").units'),40);
  eq('GB',R('_siAxIndex().map.get("GB").units'),13);
  eq('first synced order is the data start',R('_siAxIndex().cov'),'2026-06-01');

  s.section('counted window (partial history)');
  let m=M('GA');
  eq('GA published long before the data: counted from the first synced order, Jun 1..Aug 31 = 92 days',[m.E,m.days,m.partial],['2026-06-01',92,true]);
  m=M('GB');eq('GB live mid-window: from its own publish date, Jul 6..Aug 31 = 57 days',[m.E,m.days,m.partial],['2026-07-06',57,false]);
  m=M('GC');eq('no publish date, sold within 7 days of the data start: treated as live at the start (92 days)',[m.E,m.days],['2026-06-01',92]);
  m=M('GD');eq('no publish date, first sold 07-22: counted from its first sale (41 days)',[m.E,m.days],['2026-07-22',41]);
  eq('the live cell says it is a first sale, never a live date',R('_siAxLiveText(_siAxIndex().map.get("GD"))'),R('_siAxFmtDay("2026-07-22")')+' (first sale)');
  eq('a publish date is shown as the live date',R('_siAxLiveText(_siAxIndex().map.get("GB"))'),R('_siAxFmtDay("2026-07-06")'));

  s.section('units per live week, pace, momentum');
  close('GA 40 / 92 x 7',M('GA').rateWeek,40/92*7);
  close('GB 13 / 57 x 7',M('GB').rateWeek,13/57*7);
  close('GC 5 / 92 x 7',M('GC').rateWeek,5*7/92);
  close('GD 7 / 41 x 7 (counted window, not the catalog age)',M('GD').rateWeek,7*7/41);
  eq('GE has 4 counted days: under 7, so no rate — never a tiny-window extrapolation',M('GE').rateWeek,null);
  eq('GG sold nothing: the rate is a real 0, not a dash',M('GG').rateWeek,0);
  close('GA last 28 days (Aug 4..31 = 15 units) per week',M('GA').pace28,15/28*7);
  close('GA momentum = 15 / 10 - 1 (Jul 7..Aug 3 had 10)',M('GA').momentum,0.5);
  eq('GB momentum = 9 / 4 - 1 (Jul 7..Aug 3 had 4; Aug 4..31 had 9)',M('GB').momentum,9/4-1);
  eq('GD has 41 counted days: momentum needs 56, so it is a dash',M('GD').momentum,null);

  s.section('stock history: in-stock, stock-outs, per in-stock day');
  m=M('GA');
  eq('GA: 30 measured days, all in stock',[m.measured,m.inDays,m.outDays,m.inRate],[30,30,0,1]);
  close('GA units per in-stock day = 15 / 30',m.perInDay,0.5);
  m=M('GB');
  eq('GB: 30 measured, stock-out when stock was 0 at both ends: Aug 15..31 = 17 days',[m.measured,m.outDays,m.inDays],[30,17,13]);
  close('GB in-stock rate 13 / 30',m.inRate,13/30);
  close('GB units per in-stock day = 9 / 13 (sales on out days are excluded)',m.perInDay,9/13);
  eq('GC has no snapshot rows at all: in-stock figures are dashes, not 100%',[M('GC').inRate,M('GC').outDays,M('GC').perInDay],[null,null,null]);

  s.section('sell-through of available units, received (noise floor)');
  m=M('GA');
  eq('GA span Aug 2..31, opening 20 (Aug 1), received 30 (Aug 25), sold 15',[m.st.from,m.st.to,m.st.opening,m.st.received,m.st.sold,m.st.src],['2026-08-02','2026-08-31',20,30,15,'history']);
  close('GA sell-through = 15 / (20 + 30)',m.st.value,0.3);
  eq('received is inferred and labelled',m.received,30);
  m=M('GB');
  close('GB sell-through = 9 / (10 + 0); the -1 stock drop is not a receipt',m.st.value,0.9);
  R('_siHistState="ok"');
  // noise floor: +2 on an opening of 50 is noise (floor is max(5, 10%))
  const noise=R('(()=>{const h=_siAxBuildHistory('+J([0,1,2,3,4,5,6,7,8].map(k=>({date:dayStr(base+k),items:{a:{sku:'GN-M',available:k===4?52:50}}})))+');_siHist=h;_siAxCache=null;_siProducts.push({_id:"n",sku:"GN-M",product_title:"Noise",product_type:"Tees",published_at:"2026-07-01T10:00:00+05:00"});_siLineItems.push({sku:"GN-M",quantity:1,price:1,order_created_at:"2026-07-02T12:00:00+05:00",financial_status:"paid"});_siAxCache=null;const st=_siAxStats(_siAxIndex().map.get("GN"));const r=st.st;_siProducts=_siProducts.filter(p=>p.sku!=="GN-M");_siLineItems=_siLineItems.filter(l=>l.sku!=="GN-M");_siHist=_siAxBuildHistory('+J(snaps)+');_siAxCache=null;return r;})()');
  eq('a +2 rise on 50 in stock is noise: nothing received, opening 50',[noise.received,noise.opening],[0,50]);

  s.section('weeks of cover');
  m=M('GA');close('GA 35 on hand / 3.75 a week (in-stock pace)',m.cover,35/3.75);eq('basis is named',m.coverBasis,'in-stock pace');
  eq('GB has nothing on hand: 0 weeks of cover, not a dash',M('GB').cover,0);
  eq('GG has stock but no pace: no cover figure (division by zero avoided)',M('GG').cover,null);
  eq('GC has no stock data: no cover',M('GC').cover,null);

  s.section('share of category, first 4 weeks, age-normalised curve');
  close('GA share of Tees = 40 / (40+13+5+10)',M('GA').catShare,40/68);
  eq('GD share of Caps = 7 / (7+1+0)',[M('GD').catShare>0.874&&M('GD').catShare<0.876],[true]);
  eq('GB first 4 weeks (Jul 6..Aug 2) = 4',M('GB').first4,4);
  eq('GA launched before the data: no first-4-weeks figure',M('GA').first4,null);
  eq('GD has no publish date: no launch claim',M('GD').first4,null);
  let sr=R('_siAxSeries([_siAxIndex().map.get("GB")],"units_week","launch")');
  eq('GB launch-aligned weekly units: week 0..3 = 4,0,0,0 (Jul 10 is week 0), week 5 = 9',[sr.series[0].values[0],sr.series[0].values[1],sr.series[0].values[5]],[4,0,9]);

  s.section('exposure-aware chart series');
  sr=R('_siAxSeries([_siAxIndex().map.get("GA")],"rate_day","calendar")');
  const wkIdx=k=>sr.xLabels.indexOf(R('_siAxFmtDay("'+k+'")'));
  close('GA week of Aug 10: 6 units / 7 live days',sr.series[0].values[wkIdx('2026-08-10')],6/7);
  close('GA first week (Jun 1..7): 5 / 7',sr.series[0].values[0],5/7);
  close('the current week is divided by the 1 live day counted in it: Aug 31 has 0 units',sr.series[0].values[sr.series[0].values.length-1],0);
  sr=R('_siAxSeries([_siAxIndex().map.get("GD")],"rate_day","calendar")');
  const firstNonNull=sr.series[0].values.find(v=>v!=null);
  close('GD first week starts Jul 22, so Jul 20..26 has only 5 counted days: 3 / 5, not 3 / 7',firstNonNull,0.6);
  sr=R('_siAxSeries([_siAxIndex().map.get("GA")],"roll4","calendar")');
  close('GA 4-week rolling rate at the end = 15 / 28 x 7',sr.series[0].values[sr.series[0].values.length-1],3.75);
  sr=R('_siAxSeries([_siAxIndex().map.get("GA")],"st_build","calendar")');
  close('GA sell-through build ends at 40 / (40 + 35)',sr.series[0].values[sr.series[0].values.length-1],40/75);
  close('GA sell-through build at Aug 16 = 31 / 75',sr.series[0].values[wkIdx('2026-08-10')],31/75);
  eq('no stock data (GC): the build is a gap, not a zero line',R('_siAxSeries([_siAxIndex().map.get("GC")],"st_build","calendar")').series[0].values.every(v=>v===null),true);

  s.section('history loader, negatives, duplicates, truncation');
  const h=R('(()=>{const H=_siAxBuildHistory('+J([
    {date:'2026-08-01',items:{a:{sku:'GX-M',available:-4},b:{sku:'GX-L',available:3},c:{sku:'',available:50},d:{sku:'GX-L',available:2}}},
    {date:'2026-08-02',items:{a:{sku:'GX-M',available:1},b:{sku:'GX-L',available:3},c:{sku:'',available:50},d:{sku:'GX-L',available:2}}},
    {date:'2026-08-03',items:{a:{sku:'GX-M',available:1}}}])+');return{dates:H.dates,dropped:H.dropped,d1:H.byCode.get("GX").get("2026-08-01"),d2:H.byCode.get("GX").get("2026-08-02"),code:H.byCode.has("")};})()');
  eq('a negative stock is clamped to 0 and duplicate SKUs are summed: 0 + 3 + 2',h.d1,5);
  eq('items with no SKU are skipped',h.code,false);
  eq('a snapshot with far fewer items than usual is dropped as incomplete, and named',[h.dates,h.dropped],[['2026-08-01','2026-08-02'],['2026-08-03']]);
  eq('junk input never throws',R('_siAxBuildHistory([null,{},{date:"x"}]).dates'),[]);
  eq('the snapshot limit is a constant bound',R('_SI_HIST_MAX'),150);

  s.section('classes: first match wins; thresholds are named defaults');
  const cl=c=>R('(()=>{const r=_siAxClassify(_siAxIndex().map.get("'+c+'"));return{c:r.cls,u:r.unverified,rule:r.rule};})()');
  eq('GA sell-through 30% is Healthy',cl('GA').c,'healthy');
  s.ok('its rule is computed text naming the value',/sell-through 30%/.test(cl('GA').rule)&&/weeks of cover/.test(cl('GA').rule));
  eq('GB is in stock on 43.3% of days (below 60%) at 0.69 a day: Stock-constrained',cl('GB').c,'constrained');
  eq('GC has no stock rows: Not rated, not a guess',cl('GC').c,'unrated');
  eq('GE has 4 counted days: Too early, no class',cl('GE').c,'early');
  eq('GG: 6 on hand and no sale in the last 28 days: Dead stock',cl('GG').c,'dead');
  s.ok('no class reads a dash as a pass: GC reports nothing matched',!/\b(winner|healthy)\b/i.test(cl('GC').rule));
  const T=R('_SI_AX_SCORE');
  eq('the documented default lines',[T.minDays,T.deadSellThrough,T.constrainedInStock,T.constrainedPerDay,T.winnerSellThrough,T.winnerInStock,T.healthySellThrough,T.overCoverWeeks],[28,0.05,0.6,0.55,0.6,0.8,0.2,26]);
  // a high-sell-through, always-in-stock article is a Winner
  R('_siProducts.push({_id:"w",sku:"GW-M",product_title:"Win",product_type:"Tees",published_at:"2026-06-01T10:00:00+05:00"});_siLineItems.push({sku:"GW-M",quantity:45,price:1,order_created_at:"2026-08-15T12:00:00+05:00",financial_status:"paid"});_siAxCache=null;'+
    '_siHist=_siAxBuildHistory('+J(snaps.map(x=>({date:x.date,items:Object.assign({},x.items,{w:{sku:'GW-M',available:x.date<'2026-08-15'?60:(x.date===dayStr(base+14)?15:15)}})})))+');_siAxCache=null');
  eq('sold 45 of 60 opening, never out of stock: Winner (sell-through 75%)',cl('GW').c,'winner');
  // skipped clause: the in-stock rate is unknown (history too short), sell-through alone
  R('_siHist=_siAxBuildHistory('+J(snaps.slice(24))+');_siAxCache=null');
  s.ok('with fewer than 7 measured days the in-stock clause is skipped and the row says so',(()=>{const r=cl('GW');return r.u===true||r.c==='unrated';})());
  R('_siHist=_siAxBuildHistory('+J(snaps)+');_siAxCache=null');

  s.section('the history read: one bounded query, never rejects');
  let q=0,lim=null;
  const b=harness.loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},limit:n=>{lim=n;return{}},getDocs:()=>{q++;return q===1?Promise.reject(new Error('Missing or insufficient permissions.')):Promise.resolve({forEach(cb){snaps.forEach(d=>cb({data:()=>d}));}});},getDoc:()=>Promise.resolve({exists:()=>false})}});
  b.run('_siAxEnsureHistory()');await b.run('_siHistPromise||Promise.resolve()');
  eq('a refused read is a named error state, not a rejection',[b.run('_siHistState'),b.run('_siHistError')],['error','Missing or insufficient permissions.']);
  s.ok('the banner names the error and offers Retry',/Missing or insufficient permissions/.test(b.run('_siAxHistBanner()'))&&/Retry/.test(b.run('_siAxHistBanner()')));
  b.run('_siAxEnsureHistory()');
  eq('an error is not re-read on every paint',q,1);
  b.run('window._siAxRetryHistory()');await b.run('_siHistPromise||Promise.resolve()');
  eq('Retry reads again and succeeds',[b.run('_siHistState'),q,b.run('_siHist.dates.length')],['ok',2,31]);
  eq('the read is capped by the bound',lim,150);
  b.run('_siAxEnsureHistory()');
  eq('once loaded it is cached for the session',q,2);

  s.section('honest empty states in the UI');
  R('_siAxModeSel="search";_siAxSel="GC";_siAxQuery=""');
  const page=R('_siAxSearchBody()');
  s.ok('no stock rows: in-stock tiles say why, never 0%',/needs 7\+ measured days of stock history/.test(page)&&!/In-stock rate<\/div><div class="v">0/.test(page));
  s.ok('each headline tile carries a "Use it for" line',(page.match(/Use it for:/g)||[]).length>=10);
  R('_siAxModeSel="compare";_siAxCmp=["GA","GB","GC","GE"];_siAxMetric="units_week";_siAxBasis="calendar"');
  const cmp=R('_siAxCompareBody()');
  s.ok('the scorecard lists thresholds as defaults, not facts',/defaults, not facts/.test(cmp)&&/not facts/.test(cmp));
  s.ok('the Read this list is built from computed values',/GA[^<]*is classed Healthy: sold 40 over a counted window of 92 days/.test(cmp)||/Alpha Tee[^<]*is classed Healthy: sold 40 over a counted window of 92 days/.test(cmp));
  s.ok('the too-early article is named and not plotted',/Not plotted:[^<]*Echo Cap[^<]*too early/.test(cmp));
  s.ok('no literal colour, no SVG text in the scorecard',!/#[0-9a-f]{3,8}\b/i.test(cmp.slice(cmp.indexOf('Performance scorecard'),cmp.indexOf('Comparison table')))&&!/<text/.test(cmp));
  const sentence=R('_siAxReadThis(_siAxCompareData().rows)');
  s.ok('a faster-than sentence carries both rates (computed, not free-form)',sentence.some(t=>/sells [\d.]+× faster per live week than/.test(t)&&/units a week, counted window/.test(t)));
  R('_siAxCmp=["GE"]');
  eq('one article with no rate: no comparison sentence at all',R('_siAxReadThis(_siAxCompareData().rows)').filter(t=>/faster/.test(t)),[]);
  return s;
};

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

  s.section('sell-through = sold / (sold + stock left); received is supporting only');
  m=M('GA');
  eq('GA span Aug 2..31, opening 20 (Aug 1), received 30 (Aug 25), sold 15, 35 left',[m.st.from,m.st.to,m.st.opening,m.st.received,m.st.sold,m.st.closing,m.st.src],['2026-08-02','2026-08-31',20,30,15,35,'history']);
  close('GA sell-through = 15 / (15 + 35) (same as 15 / (20 + 30): closing = opening + received - sold)',m.st.value,0.3);
  eq('received is inferred and labelled',m.received,30);
  m=M('GB');
  close('GB sell-through = 9 / (9 + 0): nothing left; the -1 stock drop with no sale counts as sold (documented limit)',m.st.value,1);
  R('_siHistState="ok"');
  // noise floor: +2 on an opening of 50 is noise (floor is max(5, 10%))
  const noise=R('(()=>{const h=_siAxBuildHistory('+J([0,1,2,3,4,5,6,7,8].map(k=>({date:dayStr(base+k),items:{a:{sku:'GN-M',available:k===4?52:50}}})))+');_siHist=h;_siAxCache=null;_siProducts.push({_id:"n",sku:"GN-M",product_title:"Noise",product_type:"Tees",published_at:"2026-07-01T10:00:00+05:00"});_siLineItems.push({sku:"GN-M",quantity:1,price:1,order_created_at:"2026-07-02T12:00:00+05:00",financial_status:"paid"});_siAxCache=null;const st=_siAxStats(_siAxIndex().map.get("GN"));const r=st.st;_siProducts=_siProducts.filter(p=>p.sku!=="GN-M");_siLineItems=_siLineItems.filter(l=>l.sku!=="GN-M");_siHist=_siAxBuildHistory('+J(snaps)+');_siAxCache=null;return r;})()');
  eq('a +2 rise on 50 in stock is noise: nothing received, opening 50',[noise.received,noise.opening],[0,50]);

  // REGRESSION (30 Sept 2026): sell-through above 100%. Stock 10 on Aug 1, then every day sells 3 and gets 2 back
  // (a restocked return): the +2 is under the noise floor max(5, 10% of 10) = 5, so the old formula saw opening 10,
  // received 0 and sold 27 = 270%. Hand-computed: Aug 2..10 = 9 measured days, sold 9 x 3 = 27, stock 10,9,...,1, so 1 is left
  // and sell-through = 27 / (27 + 1) = 0.9643, never above 1.
  const rg=(sku,days,stockAt,soldAt,pub)=>{
    R('_siProducts.push({_id:"'+sku+'",sku:"'+sku+'-M",product_title:"Reg '+sku+'",product_type:"Tees",published_at:"'+(pub||'2026-07-01')+'T10:00:00+05:00"})');
    for(let k=1;k<days;k++){const q=soldAt(k);if(q)R('_siLineItems.push({sku:"'+sku+'-M",quantity:'+q+',price:1000,order_created_at:"'+dayStr(base+k)+'T12:00:00+05:00",financial_status:"paid"})');}
    R('_siHist=_siAxBuildHistory('+J(Array.from({length:days},(_,k)=>({date:dayStr(base+k),items:{a:{sku:sku+'-M',available:stockAt(k)}}})))+');_siAxCache=null');
    const st=R('_siAxStats(_siAxIndex().map.get("'+sku+'")).st');
    R('_siProducts=_siProducts.filter(p=>p.sku!=="'+sku+'-M");_siLineItems=_siLineItems.filter(l=>l.sku!=="'+sku+'-M");_siHist=_siAxBuildHistory('+J(snaps)+');_siAxCache=null');
    return st;
  };
  const r1=rg('GR',10,k=>10-k,()=>3);
  eq('regression: 9 measured days, sold 27, 1 left, received 0 (+2 a day is under the floor)',[r1.days,r1.sold,r1.closing,r1.opening,r1.received],[9,27,1,10,0]);
  close('regression: sell-through = 27 / (27 + 1), not 27 / 10 = 270%',r1.value,27/28);
  // bound: random stock paths (stock never negative) never give a sell-through above 1 or below 0
  let seed=7;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
  let worst=0,low=1,n=0;
  for(let t=0;t<120;t++){
    const days=8+Math.floor(rnd()*20);let stock=Math.floor(rnd()*40);const stocks=[stock],sold=[0];
    for(let k=1;k<days;k++){const sell=Math.min(stock,Math.floor(rnd()*6));const add=rnd()<0.3?Math.floor(rnd()*30):(rnd()<0.5?Math.floor(rnd()*3):0);const loss=rnd()<0.1&&stock-sell>0?1:0;stock=stock-sell+add-loss;stocks.push(stock);sold.push(sell);}
    const st=rg('GZ',days,k=>stocks[k],k=>sold[k]);
    if(st){n++;worst=Math.max(worst,st.value);low=Math.min(low,st.value);}
  }
  s.ok('120 random stock paths: '+n+' sell-throughs, all within 0..1 (max '+worst.toFixed(3)+')',n>60&&worst<=1&&low>=0);

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
  const nmA=R('_siAxLabel(_siAxIndex().map.get("GA"))'),nmB=R('_siAxLabel(_siAxIndex().map.get("GB"))'),nmC=R('_siAxLabel(_siAxIndex().map.get("GC"))'),nmE=R('_siAxLabel(_siAxIndex().map.get("GE"))');
  s.ok('the too-early article is named and not plotted',/Not plotted:[^<]*Echo Cap[^<]*too early/.test(cmp));
  s.ok('no literal colour, no SVG text in the scorecard',!/#[0-9a-f]{3,8}\b/i.test(cmp.slice(cmp.indexOf('Performance scorecard'),cmp.indexOf('Comparison table')))&&!/<text/.test(cmp));

  s.section('Read this: one block, a card per article, then Across these articles');
  eq('exactly one Read this block (the old second panel is gone)',[(cmp.match(/>Read this</g)||[]).length,/Read this — pace, cover and momentum/.test(cmp)],[1,false]);
  eq('one card per selected article',(cmp.match(/class="si-rd-card"/g)||[]).length,4);
  const pos=n=>cmp.indexOf('class="si-rd-name">'+n.replace(/&/g,'&amp;'));
  s.ok('cards follow class order: Healthy (GA), Stock-constrained (GB), Too early (GE), Not rated (GC)',pos(nmA)>0&&pos(nmA)<pos(nmB)&&pos(nmB)<pos(nmE)&&pos(nmE)<pos(nmC));
  eq('an article name appears once in its card head (no repeated bullets)',(cmp.split('class="si-rd-name">'+nmA).length-1),1);
  const fa=R('_siAxReadFacts(_siAxIndex().map.get("GA"),_siAxStats(_siAxIndex().map.get("GA")),_siAxClassify(_siAxIndex().map.get("GA")))');
  eq('GA facts: 40 units / 92 days / 3 a week; 30% = 15 of 50; in stock every measured day at 3.5 a week; 9.3 weeks cover; up 50%',
    fa.map(f=>[f.k,f.v,f.sub]),[['Sold','40 units','92 counted days · 3 a week'],['Sell-through','30%','15 of 50'],['In stock','Every measured day','3.5 a week while in stock'],['Cover','9.3 weeks','in-stock pace'],['Momentum','Up 50%','last 4 weeks vs the 4 before']]);
  const fb=R('_siAxReadFacts(_siAxIndex().map.get("GB"),_siAxStats(_siAxIndex().map.get("GB")),_siAxClassify(_siAxIndex().map.get("GB")))');
  eq('GB in stock: out 17 of 30 days, not "about 43% of 30 days (17 out)"',fb.find(f=>f.k==='In stock').v,'Out 17 of 30 days');
  s.ok('GB sizes-out warning: size M, sold 9 in that size in 28 days',/Out of stock in size M; sold 9 in that size in the last 28 days/.test(cmp));
  s.ok('the early article says so instead of showing facts',new RegExp('class="si-rd-name">'+nmE+'[\\s\\S]*?Only 4 counted days; classes start at 28').test(cmp));
  const ac=R('_siAxReadAcross(_siAxCompareData().arts.map(a=>({a,m:_siAxStats(a),c:_siAxClassify(a)})))');
  eq('topics, not articles, group the comparison',ac.map(g=>g.topic),['Pace','Sell-through','Cover','Momentum']);
  eq('pace: GA is 8x GC (40 vs 5 units over the same 92 days: 3 vs 0.4 a week); windows differ is stated',ac[0].lines,[nmA+' sells 8× faster per live week than '+nmC+' (3 vs 0.4 units a week, counted window).','Counted windows differ ('+nmA+' 92 days, '+nmB+' 57 days, '+nmC+' 92 days); rates are per live week so they stay comparable.']);
  eq('sell-through: highest GB 100% (9 of 9), lowest GA 30%',ac[1].lines,['Highest sell-through: '+nmB+' (100%); lowest: '+nmA+' (30%).']);
  eq('cover: least GB 0 weeks, most GA 9.3 weeks',ac[2].lines,['Least cover: '+nmB+' (0 weeks); most: '+nmA+' (9.3 weeks).']);
  eq('momentum: GA +50%, GB +125% (9 / 4 - 1) are both rising',ac[3].lines,['Rising: '+nmA+' +50%, '+nmB+' +125% (last 4 weeks vs the 4 before).']);
  R('_siAxCmp=["GE"]');
  eq('one article: no Across section at all',R('_siAxReadAcross(_siAxCompareData().arts.map(a=>({a,m:_siAxStats(a),c:_siAxClassify(a)})))'),[]);
  eq('missing inputs: GE has no rate, so no pace sentence',R('_siAxReadBlock(_siAxCompareData().arts)').includes('faster'),false);
  R('_siAxCmp=["GA","GB","GC","GE"]');

  s.section('scorecard scatter: overlapping points are spread apart, bounded');
  const dist=(o,i,j,p)=>Math.hypot((p[j].px+o[j].dx)-(p[i].px+o[i].dx),(p[j].py+o[j].dy)-(p[i].py+o[i].dy));
  const P1=[{px:100,py:200},{px:100,py:200}];let o=R('_siAxSpread('+J(P1)+')');
  s.ok('two points on the same spot end at least 34 px apart (a 32 px button each)',dist(o,0,1,P1)>=33.5);
  s.ok('no point moves more than 22 px',o.every(q=>Math.hypot(q.dx,q.dy)<=22.01));
  const P2=[{px:40,py:50},{px:200,py:250}];
  eq('points that do not overlap do not move at all',R('_siAxSpread('+J(P2)+')'),[{dx:0,dy:0},{dx:0,dy:0}]);
  const P3=[{px:100,py:200},{px:104,py:203},{px:99,py:206}];o=R('_siAxSpread('+J(P3)+')');
  s.ok('three crowded points: every pair at least 30 px apart, all within 22 px of where they were',[[0,1],[0,2],[1,2]].every(([i,j])=>dist(o,i,j,P3)>=30)&&o.every(q=>Math.hypot(q.dx,q.dy)<=22.01));
  eq('deterministic: the same input gives the same offsets',R('_siAxSpread('+J(P3)+')'),o);
  const sc2=R('_siAxScorecardHtml([_siAxIndex().map.get("GA"),_siAxIndex().map.get("GB")])');
  s.ok('points are 32 px buttons with aria-labels that state the class and the values',/class="si-pc-pt cls-healthy"[^>]*aria-label="1\. [^"]*Healthy, [\d.]+ units per in-stock week, sell-through 30%"/.test(sc2));
  s.ok('the plot has headroom: a 100% point is not on the top edge (y axis runs to 112%)',/class="si-pc-gy top" style="bottom:(\d+\.\d+)%"/.test(sc2)&&parseFloat(/class="si-pc-gy top" style="bottom:(\d+\.\d+)%"/.exec(sc2)[1])<95);
  return s;
};

/* Inventory Intel ▸ Article Explorer. Drives the real functions in js/shopify.js:
   search, week/month bucketing (store-local day strings), refund exclusion,
   since-launch alignment, the 5-article cap, metric switching, empty states,
   the curve generator and the axis ticks. */
'use strict';
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);


module.exports=async function(){
  const s=suite('shopify-article-explorer');
  let reads=0;
  const a=harness.loadApp({files:['js/shopify.js'],
    session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>{reads++;return Promise.resolve({forEach(){}});},getDoc:()=>{reads++;return Promise.resolve({exists:()=>false});}}});
  const day=n=>a.run('_siPktDate('+(-n)+')');
  const at=n=>day(n)+'T12:00:00+05:00';
  const li=(sku,q,ago,extra)=>Object.assign({sku,quantity:q,price:1000,order_created_at:at(ago),financial_status:'paid'},extra||{});
  const prod=(id,sku,title,color,size,type,liveAgo)=>({_id:id,sku,product_title:title,color,size,product_type:type,status:'active',published_at:liveAgo==null?'':at(liveAgo)});
  a.run('_siProducts='+J([
    prod('1','GST073-S','Effortless Tee','Deep Blue','S','Tees',100),
    prod('2','GST073-M','Effortless Tee','Deep Blue','M','Tees',100),
    prod('3','GD007-28','Denim Jort','Indigo','28','Jorts',400),
    prod('4','GHW001','Trucker Cap','Black','OS','Caps',null),
    prod('5','X1-S','<img src=x onerror=alert(1)>','Red','S','Weird',700)
  ]));
  a.run('_siLineItems='+J([
    li('GST073-S',3,99),li('GST073-S',2,92),li('GST073-M',4,99),li('GST073-M',9,5,{financial_status:'refunded'}),
    li('GD007-28',6,399),li('GD007-28',1,391),li('X1-S',1,600,{price:0}),
    li('GHW001',2,3),li('X1-S',1,2),li('GST073-S',1,6),li('GST073-M',1,40),li('GST073-M',1,80)
  ]));
  a.run('_siSnapshot={items:{a:{sku:"GST073-S",available:10},b:{sku:"GST073-M",available:0}}}');
  a.run('_siWeeklyCloses=[{week_ending:"2026-09-26",week_starting:"2026-09-20",top_sku:{sku:"GST073-S",quantity:11}},{week_ending:"2026-09-19",top_sku:{sku:"GD007-28",quantity:3}}]');
  const R=c=>a.run(c);
  const eq=(n,x,y)=>s.eq(n,J(x),J(y));

  s.section('no new Firestore reads');
  R('_siArticleExplorerSection()');R('_siAxSearchBody()');
  eq('opening the tab starts exactly ONE read (the bounded stock history), nothing else',reads,1);
  R('_siArticleExplorerSection()');R('_siAxSearchBody()');
  eq('rendering again reads nothing more',reads,1);

  s.section('search matching');
  const n=(q)=>R('_siAxSearch('+J(q)+',50).hits.map(x=>x.code)');
  eq('by article code prefix (case-insensitive)',n('gst073'),['GST073']);
  eq('by title word',n('effortless'),['GST073']);
  eq('by colour',n('indigo'),['GD007']);
  eq('by category',n('jorts'),['GD007']);
  eq('by full SKU',n('GST073-M'),['GST073']);
  eq('all words must match (AND)',n('tee blue'),['GST073']);
  eq('words that do not co-occur match nothing',n('tee indigo'),[]);
  eq('empty query lists everything',R('_siAxSearch("",50).total'),4);
  eq('articles are grouped by code, not by SKU',R('_siAxIndex().list.length'),4);

  s.section('store-local day strings');
  eq('+05:00 early morning stays on its own date',R('_siAxDayOf("2026-09-29T02:00:00+05:00")'),'2026-09-29');
  eq('-05:00 late evening stays on its own date',R('_siAxDayOf("2026-09-28T23:59:00-05:00")'),'2026-09-28');
  eq('garbage is no day',R('_siAxDayOf("nope")'),'');
  eq('Wednesday -> that Monday',R('_siAxBucketStart("2026-09-30","week")'),'2026-09-28');
  eq('Sunday -> the Monday before',R('_siAxBucketStart("2026-10-04","week")'),'2026-09-28');
  eq('Monday -> itself',R('_siAxBucketStart("2026-10-05","week")'),'2026-10-05');
  eq('month start',R('_siAxBucketStart("2026-09-30","month")'),'2026-09-01');
  eq('next month across a year end',R('_siAxBucketNext("2026-12-01","month")'),'2027-01-01');
  eq('month end',R('_siAxBucketEnd("2026-02-01","month")'),'2026-02-28');
  eq('day math round-trips',R('_siAxDayStr(_siAxDayNum("2026-03-01")-1)'),'2026-02-28');

  s.section('refund exclusion and totals');
  const art=c=>R('(()=>{const a=_siAxIndex().map.get("'+c+'");return{u:a.units,r:a.rev,sizes:a.sizes,stock:a.stock,on:a.onHand,hp:a.hasPrice,live:a.liveDay};})()');
  eq('refunded 9 excluded: 3+2+4+1+1+1',art('GST073').u,12);
  eq('revenue = price x qty',art('GST073').r,12000);
  eq('size mix',art('GST073').sizes,{S:6,M:6});
  eq('on hand per size from the snapshot',art('GST073').stock,{S:10,M:0});
  eq('7d / 30d / 90d windows',R('(()=>{const a=_siAxIndex().map.get("GST073");return[_siAxUnitsSince(a,7).u,_siAxUnitsSince(a,30).u,_siAxUnitsSince(a,90).u];})()'),[1,1,3]);
  eq('an article with no live date has none (never invented)',art('GHW001').live,'');

  s.section('week / month series (calendar)');
  let sr=R('_siAxSeries([_siAxIndex().map.get("GST073")],"units_week","calendar")');
  eq('sum over the series equals counted units',sr.series[0].values.reduce((p,v)=>p+(v||0),0),12);
  eq('x labels and values line up',sr.xLabels.length,sr.series[0].values.length);
  s.ok('ticks never exceed 6',sr.xTicks.length<=6);
  s.ok('no NaN anywhere',sr.series[0].values.every(v=>v===null||isFinite(v)));
  sr=R('_siAxSeries([_siAxIndex().map.get("GST073")],"units_month","calendar")');
  eq('monthly sum equals counted units',sr.series[0].values.reduce((p,v)=>p+(v||0),0),12);
  sr=R('_siAxSeries([_siAxIndex().map.get("GST073")],"revenue_week","calendar")');
  eq('revenue series sums to 12000',sr.series[0].values.reduce((p,v)=>p+(v||0),0),12000);
  sr=R('_siAxSeries([_siAxIndex().map.get("GST073")],"cum_week","calendar")');
  const cv=sr.series[0].values.filter(v=>v!=null);
  eq('cumulative ends at the total',cv[cv.length-1],12);
  s.ok('cumulative never decreases',cv.every((v,i)=>i===0||v>=cv[i-1]));
  eq('unknown metric falls back, never throws',R('_siAxSeries([_siAxIndex().map.get("GST073")],"stock_over_time","calendar").metric'),'stock_over_time');
  s.ok('stock over time is NOT an offered metric',!R('Object.keys(_SI_AX_METRICS)').some(k=>/stock|on_hand/i.test(k)));
  eq('offered metrics',R('Object.keys(_SI_AX_METRICS)'),['units_week','units_month','revenue_week','revenue_month','cum_week','rate_day','roll4','st_build']);

  s.section('since-launch alignment');
  // GST073 live 100d ago, first sale 99d ago; GD007 live 400d ago, first sale 399d ago.
  sr=R('_siAxSeries(["GST073","GD007"].map(c=>_siAxIndex().map.get(c)),"units_week","launch")');
  eq('both lines are aligned at week 0 (first sale one day after launch)',[sr.series[0].values[0],sr.series[1].values[0]],[7,6]);
  eq('x axis counts weeks since launch',sr.xLabels[0]+'|'+sr.xLabels[1],'week 0|week 1');
  eq('the older article sets the length',sr.xLabels.length,Math.floor(400/7)+1);
  eq('the younger line ends (null) rather than padding zeros',sr.series[0].values[sr.xLabels.length-1],null);
  eq('a sale at launch+8 lands in week 1',sr.series[1].values[1],1);
  sr=R('_siAxSeries([_siAxIndex().map.get("GHW001")],"units_week","launch")');
  s.ok('no live date -> aligned to first sale, and said so',sr.notes.some(t=>/no live date/.test(t))&&sr.series[0].values[0]===2);
  sr=R('_siAxSeries([_siAxIndex().map.get("X1")],"units_week","launch")');
  s.ok('weeks before the first synced order are null, not zero',sr.series[0].values[0]===null&&sr.series[0].values.slice(-1)[0]!==null&&sr.notes.some(t=>/before the first synced order/.test(t)));

  s.section('coverage caption');
  const body=R('_siAxSearchBody()');
  s.ok('search view has no article -> still says coverage',/Data counted from/.test(body));
  R('_siAxSel="X1"');
  const d2x=R('_siAxSearchBody()');
  R('_siAxSel="GD007"');
  const d2=R('_siAxSearchBody()');
  s.ok('caption names the earliest synced order',d2.includes(R('_siAxFmtDay(_siAxIndex().cov)')));
  s.ok('warns when the article went live before coverage',/went live .* before that date/.test(d2x));
  s.ok('caption states refunds are excluded and revenue is pre-discount',/refunded orders excluded/.test(d2)&&/before discounts/.test(d2));
  s.ok('shows the weekly close only for that article',d2.includes('2026-09-19')&&!d2.includes('2026-09-26'));
  s.ok('says what weekly closes do not hold',/stores only its top SKU/.test(R('(_siAxSel="GHW001",_siAxSearchBody())')));

  s.section('the 5-article cap');
  R('_siAxCmp=[]');
  const adds=['GST073','GD007','GHW001','X1'].map(c=>R('_siAxTryAdd("'+c+'").ok'));
  eq('four articles accepted',adds,[true,true,true,true]);
  eq('a duplicate is refused with a reason',R('_siAxTryAdd("GST073")').msg,'That article is already in the comparison.');
  R('_siProducts=_siProducts.concat('+J([1,2,3].map(i=>prod('p'+i,'ZZ'+i+'-S','Z'+i,'C','S','T',10)))+');_siAxCache=null');
  eq('fifth accepted',R('_siAxTryAdd("ZZ1").ok'),true);
  const sixth=R('_siAxTryAdd("ZZ2")');
  s.ok('sixth is refused with a clear message',!sixth.ok&&/at most 5 articles/.test(sixth.msg));
  eq('still five',R('_siAxCmp.length'),5);
  R('window._siAxRemove("ZZ1")');
  eq('remove frees a slot',R('_siAxCmp.length'),4);
  eq('unknown code refused',R('_siAxTryAdd("NOPE").ok'),false);

  s.section('compare view and metric switching');
  R('_siAxMode="compare";_siAxModeSel="compare";_siAxMsg=""');
  let html=R('_siAxCompareBody()');
  s.ok('always shows the comparison table under the chart',html.indexOf('Comparison table')>html.indexOf('si-ax-wrap')&&html.indexOf('<table',html.indexOf('Comparison table'))>0);
  s.ok('one chip per article with a remove button',(html.match(/class="si-ax-chip"/g)||[]).length===4);
  s.ok('legend carries numbers (not colour alone)',(html.match(/class="si-ax-badge si-ax-b\d">\d</g)||[]).length>=4);
  s.ok('every series has its own dash',new Set([...html.matchAll(/stroke-dasharray:([^"]+)"/g)].map(m=>m[1])).size>=2);
  R('window._siAxSetMetric("revenue_week")');
  eq('metric switches',R('_siAxMetric'),'revenue_week');
  R('window._siAxSetMetric("bogus")');
  eq('an unsupported metric is ignored',R('_siAxMetric'),'revenue_week');
  html=R('_siAxCompareBody()');
  s.ok('revenue chart title and PKR in the table',/Revenue per week/.test(html)&&/PKR 12,000/.test(html));
  R('window._siAxSetBasis("launch")');
  html=R('_siAxCompareBody()');
  s.ok('since-launch explains the x axis',/weeks \(or months\) since each article/.test(html));
  R('window._siAxSetBasis("calendar");_siAxMetric="units_week"');

  s.section('empty states');
  R('_siAxCmp=[]');
  s.ok('nothing selected is an honest empty state',/Nothing to compare yet/.test(R('_siAxCompareBody()')));
  R('_siAxCmp=["ZZ3"]');
  s.ok('an article with no sales draws no fake flat line',/si-ax-empty/.test(R('_siAxCompareBody()'))&&!/class="si-ax-line/.test(R('_siAxCompareBody()')));
  s.ok('chart of all zeros is an empty state',/si-ax-empty/.test(R('_siAxChartHtml({series:[{values:[0,0,0]}],xLabels:["a","b","c"],xTicks:[]})')));
  s.ok('chart of no points is an empty state',/si-ax-empty/.test(R('_siAxChartHtml({series:[{values:[null,null]}],xLabels:["a","b"],xTicks:[]})')));
  R('_siLineItems=[];_siAxCache=null');
  s.ok('no line items at all does not throw',typeof R('_siArticleExplorerSection()')==='string');
  R('_siLineItems='+J([li('GST073-S',3,99),li('GST073-S',2,92),li('GST073-M',4,99),li('GST073-M',9,5,{financial_status:'refunded'}),li('GD007-28',6,399),li('GD007-28',1,391),li('GHW001',2,3),li('X1-S',1,2),li('GST073-S',1,6)]));

  s.section('curve generator');
  const cur=p=>R('_siAxCurve('+J(p)+')');
  eq('no points',cur([]),'');
  eq('one point draws no path',cur([{x:5,y:5}]),'');
  s.ok('two points is a straight segment',/^M0 0L10 10$/.test(cur([{x:0,y:0},{x:10,y:10}])));
  const flat=cur([{x:0,y:300},{x:500,y:300},{x:1000,y:300}]);
  s.ok('all-zero stays finite',!/NaN|Infinity/.test(flat)&&flat.length>0);
  const spike=cur([{x:0,y:300},{x:250,y:300},{x:500,y:20},{x:750,y:300},{x:1000,y:300}]);
  const ys=[...spike.matchAll(/[MC L]?(-?[\d.]+) (-?[\d.]+)/g)].map(m=>+m[2]);
  s.ok('monotone: a spike never overshoots the data range',ys.every(y=>y>=20-1e-6&&y<=300+1e-6));
  s.ok('non-finite input is dropped, not printed',!/NaN/.test(cur([{x:0,y:1},{x:NaN,y:2},{x:10,y:3},{x:20,y:Infinity},{x:30,y:5}])));
  s.ok('duplicate x does not divide by zero',!/NaN|Infinity/.test(cur([{x:0,y:1},{x:0,y:2},{x:10,y:3}])));

  // Sample every cubic segment: between two data points the curve must stay inside their y range.
  const inRange=(pts)=>{
    const d=R('_siAxCurve('+J(pts)+')');const nums=[...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(m=>+m[0]);
    let cx=nums[0],cy=nums[1],k=2,seg=0;
    while(k+5<nums.length+0&&seg<pts.length-1){
      const [x1,y1,x2,y2,x3,y3]=nums.slice(k,k+6);k+=6;
      const lo=Math.min(pts[seg].y,pts[seg+1].y)-0.05,hi=Math.max(pts[seg].y,pts[seg+1].y)+0.05;
      for(let t=0;t<=1;t+=0.05){const u=1-t;const y=u*u*u*cy+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3;if(y<lo||y>hi)return false;}
      cx=x3;cy=y3;seg++;
    }
    return true;
  };
  s.ok('monotone: every segment stays between its own endpoints (random data)',(()=>{let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};for(let r=0;r<60;r++){const n=3+Math.floor(rnd()*8);const pts=[];for(let i=0;i<n;i++)pts.push({x:i*100,y:Math.round(rnd()*300)});if(!inRange(pts))return false;}return true;})());

  s.section('axis ticks never repeat');
  s.ok('a formatter that rounds two ticks alike forces whole-number ticks',(()=>{const sc=R('_siAxScale([1.2],false,x=>String(Math.round(x)))');const l=[];for(let i=0;i<=sc.count;i++)l.push(Math.round(sc.step*i));return new Set(l).size===l.length;})());
  let bad=[];
  [0,1,2,3,4,5,7,9,11,13,37,99,101,250,999,1234,5000,48000,120000,999999,2500000].forEach(m=>[false,true].forEach(int=>{
    const sc=R('_siAxScale(['+m+'],'+int+')');
    const labels=[];for(let i=0;i<=sc.count;i++)labels.push(R('_siAxTick('+(sc.step*i)+')'));
    if(new Set(labels).size!==labels.length||!(sc.max>0)||sc.max<m)bad.push(m+'/'+int+':'+labels);
  }));
  eq('distinct, positive, covering ticks across 21 maxima x 2 modes',bad,[]);
  eq('a count chart topping out at 3 uses whole ticks',R('(()=>{const sc=_siAxScale([3],true);return[sc.step,sc.max];})()'),[1,3]);

  s.section('chart markup rules');
  const ch=R('_siAxChartHtml({series:[{name:"A",values:[1,3,2,5]},{name:"B",values:[null,1,4,2]}],xLabels:["a","b","c","d"],xTicks:[{i:0,label:"a"},{i:3,label:"d"}],integer:true})');
  s.ok('no <text> and no <title> inside the SVG',!/<text|<title/.test(ch));
  s.ok('no literal colour reaches the markup',!/#[0-9a-f]{3,8}\b/i.test(ch)&&!/rgb\(/.test(ch));
  s.ok('lines use the series tokens',/stroke="var\(--si-s0\)"/.test(ch)&&/si-ax-line s1/.test(ch));
  s.ok('y and x tick text is HTML spans',/class="si-ax-tick"/.test(ch)&&/class="si-ax-xtick/.test(ch));
  s.ok('hover handler does not throw without DOM',(()=>{try{R('window._siAxHover({clientX:10},{getBoundingClientRect:()=>({left:0,width:100}),querySelector:()=>null})');return true;}catch(e){return false;}})());
  const css=require('fs').readFileSync(require('path').join(harness.ROOT,'css/main.css'),'utf8');
  s.ok('five series tokens exist in light and dark',[0,1,2,3,4].every(i=>(css.match(new RegExp('--si-s'+i+':','g'))||[]).length===2));

  s.section('phone ergonomics (UI QA 30 Sept)');
  s.ok('a touch that lifts does not hide the tooltip (pointerleave fires on touch end)',(()=>{const el={style:{},querySelector:c=>c==='.si-ax-tip'?tipEl:curEl};const tipEl={style:{display:'block'}},curEl={style:{display:'block'}};
    R('window._siAxLeave')(el,{pointerType:'touch'});return tipEl.style.display==='block';})());
  s.ok('a mouse leaving still hides it',(()=>{const tipEl={style:{display:'block'}},curEl={style:{display:'block'}};const el={querySelector:c=>c==='.si-ax-tip'?tipEl:curEl};
    R('window._siAxLeave')(el,{pointerType:'mouse'});return tipEl.style.display==='none';})());
  s.ok('the chart wires the event into the leave handler',/_siAxLeave\(this,event\)/.test(R('_siAxChartHtml({series:[{values:[1,2],name:"a"}],xLabels:["a","b"],xTicks:[{i:0,label:"a"}],integer:true})')));
  s.ok('chip remove button is a 34px target',/\.si-ax-chip button\{min-width:34px;min-height:34px/.test(require('fs').readFileSync(require('path').join(harness.ROOT,'css/main.css'),'utf8')));
  s.ok('size-mix quantity column may grow (no clipped "154 sold · 24%")',/\.si-ax-mix \.q\{min-width:84px/.test(require('fs').readFileSync(require('path').join(harness.ROOT,'css/main.css'),'utf8')));

  s.section('escaping');
  R('_siAxSel="";_siAxQuery="";_siAxModeSel="search"');
  const res=R('_siAxSearch("onerror",5).hits.length');
  eq('the hostile title is findable',res,1);
  const rh=R('(_siAxQuery="onerror",_siAxResultsHtml())');
  s.ok('it is escaped in the result list',!/<img src=x/.test(rh)&&/&lt;img/.test(rh));
  R('_siAxSel="X1"');
  s.ok('and on the article page',!/<img src=x/.test(R('_siAxSearchBody()')));
  return s;
};

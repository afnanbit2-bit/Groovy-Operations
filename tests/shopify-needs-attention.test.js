/* Inventory Intel ▸ Needs Attention (Oct 2026): one flat ranked list of ARTICLES in three bands, a situation view per article,
   Selling Patterns gone, the two Overview fixes. Every expectation is HAND-COMPUTED (see the fixture comment), the clock is pinned
   to 2026-08-31, and the checks DRIVE the real handlers (tab switch, row click, back, Esc, Show all, filters), not only the helpers.
   Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
function load(src,store){
  store=store||{};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
/* FIXTURE (today 2026-08-31; first synced order 06-01 from filler GF; every article is a Tee, default lead time 21 days; price 1000;
   stock history Aug 1..31 so 30 measured days; classes use the fixed bands because fewer than 30 articles are classed):
   R1..R10 sell 3+k a day (d = 4..13) with 28 on hand, in stock every day -> cover = 28/d days (7 .. 2.15), all under half of 21 -> CRITICAL run-outs;
        units lost in the gap = d*(21-28/d) = 21d-28 (56 .. 245), so Rs at stake = that x 1000 and R10 ranks first.
   A1 sells 4 a day with 60 on hand -> cover 15 days: under 21 but not under 10.5 -> ACT THIS WEEK, lost 4*(21-15)=24.
   O1 sells 4 a day to Aug 20, stock 0 from Aug 21 -> out 10 of 30 measured days, 76 units over 20 in-stock days = 3.8 a day, class constrained -> CRITICAL stock-out,
        turned away so far round(3.8*10)=38, lost over one lead time 3.8*21=79.8, reorder guide 3.8*0.75*49=139.65 -> 144 .. 3.8*1.25*49=232.75 -> 240.
   V1 sells 1 every other day, 400 on hand -> 400,000 at selling price, cover far above 26 weeks -> OVERSTOCK, act (value over 500k? no, 400k, but cover over 52 weeks).
   D1 / D2 sold 10 units on 06-10 and nothing since, 40 / 200 on hand -> DEAD: 40,000 (watch, under 100k) and 200,000 (act).
   F1 sells 6 a day Jul 7..Aug 3 then 2 a day: 168 then 56 units, z=(112-1)/sqrt(224)=7.4 -> FADING, -66.7%, in stock every day -> act (under -40%).
   T1 sells 1 a day and has 12 voided units: 12/(92+12)=11.5% -> data check, watch.
   H sells S 2/day, M 1/day, L 1/day (4 a day); S has 0 on hand, M and L 100 each -> cover 50 days: S carries 56 of 112 units in 28 days (50%) -> SIZE HOLE, act, lost 56.
   N1 first sold 08-20 (3 units), 500 on hand, no publish date -> only 12 counted days: Too early, never dead or overstocked.
   Counts: critical 11 (R1-R10, O1), act 5 (A1, V1, D2, F1, H), watch 2 (D1, T1); stock 13, cash 3, demand 1, data 1. */
function fixture(a){
  const R=c=>a.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));}');
  const dn=R('_siAxDayNum("2026-06-01")'),last=R('_siAxDayNum("2026-08-31")'),ds=n=>R('_siAxDayStr('+n+')');
  const days=[],D={};for(let n=dn;n<=last;n++){days.push(n);D[n]=ds(n);}
  const items=[],prods=[],defs=[];
  const li=(sku,q,day,st)=>({sku,quantity:q,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:st||'paid'});
  const prod=(c,size,pub)=>({_id:c+'-'+size,sku:c+'-'+size,product_title:'Art '+c,color:'Blue',size,product_type:'Tees',status:'active',published_at:pub===''?'':'2025-01-01T10:00:00+05:00'});
  const art=(c,o)=>{
    const sizes=o.sizes||{M:1};
    Object.keys(sizes).forEach(sz=>{prods.push(prod(c,sz));
      days.forEach(n=>{const q=o.daily(n,sz);if(q>0)items.push(li(c+'-'+sz,q,D[n]));});
      defs.push([c,sz,o.stock]);});
  };
  prods.push(prod('GF','M'));items.push(li('GF-M',10,'2026-06-01'));
  for(let k=1;k<=10;k++)art('R'+k,{daily:()=>3+k,stock:()=>28});
  art('A1',{daily:()=>4,stock:()=>60});
  const aug20=R('_siAxDayNum("2026-08-20")'),aug21=R('_siAxDayNum("2026-08-21")');
  art('O1',{daily:n=>n<=aug20?4:0,stock:n=>n<aug21?50:0});
  art('V1',{daily:n=>n%2===0?1:0,stock:()=>400});
  const jun10=R('_siAxDayNum("2026-06-10")');
  art('D1',{daily:n=>n===jun10?10:0,stock:()=>40});
  art('D2',{daily:n=>n===jun10?10:0,stock:()=>200});
  const jul7=R('_siAxDayNum("2026-07-07")'),aug4=R('_siAxDayNum("2026-08-04")');
  art('F1',{daily:n=>n<jul7?0:(n<aug4?6:2),stock:()=>300});
  art('T1',{daily:()=>1,stock:()=>100});items.push(li('T1-M',12,'2026-07-01','voided'));
  art('H',{sizes:{S:1,M:1,L:1},daily:(n,sz)=>sz==='S'?2:1,stock:(n,sz)=>sz==='S'?0:100});
  prods.push(prod('N1','M',''));items.push(li('N1-M',3,'2026-08-20'));defs.push(['N1','M',()=>500]);
  const base=R('_siAxDayNum("2026-08-01")'),snaps=[];
  for(let k=0;k<31;k++){const n=base+k,it={};let i=0;defs.forEach(([c,sz,fn])=>{it['i'+(i++)]={sku:c+'-'+sz,available:fn(n,sz)};});snaps.push({date:ds(n),items:it});}
  R('_siProducts='+J(prods)+';_siLineItems='+J(items)+';_siOrders=[];_siWeeklyCloses=[];_siHist=_siAxBuildHistory('+J(snaps)+');_siHistState="ok";_siSnapshot='+J(snaps[30])+';_siPrevSnapshot='+J(snaps[23])+';_siAxCache=null;_siNaMemo=null;_siLoaded=true');
  return snaps;
}
async function checks(src){
  const store={},a=load(src,store),R=c=>a.run(c),o={};
  fixture(a);
  const ST=()=>R('_siNaState()');
  const iss=c=>R('(()=>{const i=_siNaState().issues.find(x=>x.code==="'+c+'");return i?{type:i.type,band:i.band,group:i.group,lost:i.lost,at:i.at,also:i.also,qty:i.n.qty,cls:i.cls,value:i.n.valueTied,missed:i.n.missed,out:i.n.outDays,holes:i.n.holes.map(h=>h.size+":"+h.kind)}:null;})()');
  const counts=R('J=JSON.stringify(_siNaState().counts)');
  const c=JSON.parse(counts);
  o['counts: critical 11, act 5, watch 2 (uncapped), action 16, total 18']=c.critical===11&&c.act===5&&c.watch===2&&c.action===16&&c.total===18;
  o['counts by kind: stock 13, cash 3, demand 1, data 1']=c.byGroup.stock===13&&c.byGroup.cash===3&&c.byGroup.demand===1&&c.byGroup.data===1;
  // detector rules, one per article
  const r10=iss('R10'),r1=iss('R1');
  o['run-out: cover 28/d under half the 21-day lead time is critical (R10 2.2 days, R1 7 days)']=r10.type==='runout'&&r10.band==='critical'&&r1.type==='runout'&&r1.band==='critical';
  o['run-out: units lost in the gap = 21d-28 (R10 245, R1 56) and Rs at stake = x 1000']=Math.round(r10.lost)===245&&Math.round(r10.at)===245000&&Math.round(r1.lost)===56&&Math.round(r1.at)===56000;
  const a1=iss('A1');
  o['run-out: 15 days of cover against 21 is act this week, not critical (needs under 10.5)']=a1.type==='runout'&&a1.band==='act'&&Math.round(a1.lost)===24;
  const o1=iss('O1');
  o['stock-out: out of a constrained seller that sold 68 in 28 days is critical']=o1.type==='stockout'&&o1.band==='critical'&&o1.cls==='constrained';
  o['stock-out: out 10 of 30 days, 3.8 a day in stock -> about 38 turned away; lost over one lead time 79.8']=o1.out===10&&o1.missed===38&&Math.abs(o1.lost-79.8)<1e-6;
  o['stock-out: reorder guide 3.8 x 0.75 x 49 = 139.65 -> 144 and 3.8 x 1.25 x 49 = 232.75 -> 240 (packs of 12)']=!!o1.qty&&o1.qty.lo===144&&o1.qty.hi===240;
  const v1=iss('V1'),d1=iss('D1'),d2=iss('D2');
  o['overstock: 400 on hand at 1000 = 400,000 at selling price, cover over 52 weeks -> act']=v1.type==='overstock'&&v1.band==='act'&&v1.value===400000&&v1.group==='cash';
  o['dead: 200,000 is act, 40,000 (under 100,000) is watch']=d2.type==='dead'&&d2.band==='act'&&d2.value===200000&&d1.type==='dead'&&d1.band==='watch'&&d1.value===40000;
  const f1=iss('F1');
  o['demand drop: 168 -> 56 units (-66.7%), in stock every day, bigger than chance -> act']=f1.type==='demanddrop'&&f1.band==='act'&&Math.round(f1.lost)===112;
  const t1=iss('T1');
  o['data check: 12 voided of 104 (11.5%) -> watch, never a stock verb']=t1.type==='datatrust'&&t1.band==='watch'&&t1.group==='data';
  const h=iss('H');
  o['size hole: S out and 50% of 28-day sales while the article has 50 days of cover -> act, not a run-out']=h.type==='sizehole'&&h.band==='act'&&h.holes.length===1&&h.holes[0]==='S:out'&&Math.round(h.lost)===56;
  o['a new article (12 counted days, 500 on hand) is never dead or overstocked: no issue']=iss('N1')===null&&R('_siAxClassify(_siAxIndex().map.get("N1")).cls')==='early';
  o['no issue for the filler with no stock data (unrated), and one row per article']=iss('GF')===null&&R('(()=>{const s=new Set(_siNaState().issues.map(i=>i.code));return s.size===_siNaState().issues.length;})()');
  o['articles, not variants: H has 3 sizes and exactly one issue']=R('_siNaState().issues.filter(i=>i.code==="H").length')===1;
  // ranking
  o['ranking: critical sorted by Rs at stake (R10, R9, ... R3, O1 79.8k, R2 77k, R1 56k)']=R('J=JSON.stringify(_siNaState().issues.filter(i=>i.band==="critical").map(i=>i.code))')==='["R10","R9","R8","R7","R6","R5","R4","R3","O1","R2","R1"]';
  o['ranking: act sorted V1 400k, D2 200k, F1 112k, H 56k, A1 24k; watch D1 40k then T1 (no value last)']=R('J=JSON.stringify(_siNaState().issues.filter(i=>i.band!=="critical").map(i=>i.code))')==='["V1","D2","F1","H","A1","D1","T1"]';
  // pure rules on fabricated rows (boundaries)
  R(`var __row=function(o){o=o||{};const a=Object.assign({code:"X",name:"X",color:"",category:"Tees",hasStock:true,onHand:20,skus:new Set()},o.a||{});
    const m=Object.assign({coverDays:30,cover:30/7,units28:20,perInDay:2,inRate:1,measured:30,outDays:0,momWord:null,momentum:null,momUnits:null,days:90,units:100,asp:1000,sizeRows:[],risk:[],voidRate:0,voided:0,pace28Days:28,coverRange:null,coverBasis:"x",paceHead:14,pace28:14},o.m||{});
    return{a,m,c:Object.assign({cls:"solid",label:"Solid"},o.c||{}),act:Object.assign({key:"ok",text:""},o.act||{}),lt:Object.assign({days:21,source:"default",text:"default lead time, unconfirmed"},o.lt||{}),conf:Object.assign({lvl:1,level:"medium",name:"Medium",why:["100 units over 90 counted days"],caps:[]},o.conf||{})};};
    var __ctx={today:"2026-10-01",returnsSynced:false};`);
  const det=(ov,ctx)=>R('J=JSON.stringify(_siNaDetect(__row('+J(ov||{})+'),'+(ctx||'__ctx')+').map(i=>({t:i.type,b:i.band,s:i.seasonal,r:i.rising})))');
  o['boundary: cover exactly equal to the lead time is not a run-out']=det({m:{coverDays:21}})==='[]';
  o['boundary: cover 20.9 against 21 is a run-out (act); under half (10.4) is critical']=det({m:{coverDays:20.9}}).indexOf('"runout","b":"act"')>0&&det({m:{coverDays:10.4}}).indexOf('"runout","b":"critical"')>0&&det({m:{coverDays:10.5}}).indexOf('"b":"act"')>0;
  o['evidence floor: 9 units in 28 days and 0.9 a day is silent; 10 units speaks; 1.0 a day speaks']=det({m:{coverDays:5,units28:9,perInDay:0.9}})==='[]'&&det({m:{coverDays:5,units28:10,perInDay:0.9}}).indexOf('runout')>0&&det({m:{coverDays:5,units28:9,perInDay:1}}).indexOf('runout')>0;
  o['Low confidence never speaks, even with the units']=det({m:{coverDays:5},conf:{lvl:0}})==='[]';
  o['a lead time override of 7 days removes the run-out (cover 15 days)']=det({m:{coverDays:15},lt:{days:7,source:"article"}})==='[]'&&det({m:{coverDays:15},lt:{days:21}}).indexOf('runout')>0;
  o['slow and dead articles at 0 stock are good news: no alarm']=det({a:{onHand:0},c:{cls:"slow",label:"Slow"}})==='[]'&&det({a:{onHand:0},c:{cls:"dead",label:"Dead stock"}})==='[]';
  o['out of stock with NO recent sales (units28 0) is not a stock-out (the Explorer says watch)']=det({a:{onHand:0},c:{cls:"solid"},m:{units28:0,perInDay:2}})==='[]'&&det({a:{onHand:0},c:{cls:"steady",label:"Steady"},m:{units28:30}})==='[]';
  o['early and not-rated articles are never flagged']=det({c:{cls:"early"},m:{coverDays:1}})==='[]'&&det({c:{cls:"unrated"},m:{coverDays:1}})==='[]';
  o['missing cover is never a run-out and never 0']=det({m:{coverDays:null,cover:null}})==='[]';
  o['a run-out with rising momentum carries the chip, not a second row']=det({m:{coverDays:5,momWord:'Rising'}}).indexOf('"r":true')>0&&(det({m:{coverDays:5,momWord:'Rising'}}).match(/"t":/g)||[]).length===1;
  // rising on thin stock: cover between lead and lead + 28 days, Rising, not a sale
  o['rising on thin stock: Rising with cover 30 days (lead 21) -> act']=det({m:{coverDays:30,momWord:'Rising',momentum:0.5,momUnits:60,units28:40}}).indexOf('"t":"rising","b":"act"')>0;
  o['rising: plenty of cover (60 days) is silent']=det({m:{coverDays:60,momWord:'Rising'}})==='[]';
  o['rising: a sale (80% of last week at a reduced price) is excluded, not called organic']=det({m:{coverDays:30,momWord:'Rising'}},'Object.assign({},__ctx,{disc:()=>({units7:20,disc:16,share:0.8,base:1000})})')==='[]';
  o['rising: a small discount share (30%) does not exclude it']=det({m:{coverDays:30,momWord:'Rising'}},'Object.assign({},__ctx,{disc:()=>({units7:20,disc:6,share:0.3,base:1000})})').indexOf('rising')>0;
  // fading
  o['fading winner in stock 69% of days is NOT a demand drop (a stock-out explains it); 70% is']=det({c:{cls:'winner',label:'Winner'},m:{momWord:'Fading',inRate:0.69,momentum:-0.6}})==='[]'&&det({c:{cls:'winner',label:'Winner'},m:{momWord:'Fading',inRate:0.7,momentum:-0.6}}).indexOf('demanddrop')>0;
  o['fading: -40% is act, -39% is watch; a Steady article is never a drop']=det({m:{momWord:'Fading',momentum:-0.4}}).indexOf('"b":"act"')>0&&det({m:{momWord:'Fading',momentum:-0.39}}).indexOf('"b":"watch"')>0&&det({c:{cls:'steady',label:'Steady'},m:{momWord:'Fading',momentum:-0.9}})==='[]';
  // size hole boundaries
  const sr=(size,stock,recent)=>({size,stock,recent,sold:recent,prev:null,sellThrough:null,risk:stock===0&&recent>0});
  const hole=(rows,over)=>det(Object.assign({a:{onHand:200},m:{coverDays:50,units28:100,sizeRows:rows}},over||{}));
  o['size hole: out with 3 units (30% of 10) is a hole; 2 units (20% of 10) is below the 3-unit floor']=hole([sr('S',0,3),sr('M',100,7)],{m:{coverDays:50,units28:10,sizeRows:[sr('S',0,3),sr('M',100,7)]}}).indexOf('sizehole')>0&&hole([sr('S',0,2),sr('M',100,8)],{m:{coverDays:50,units28:10,sizeRows:[sr('S',0,2),sr('M',100,8)]}})==='[]';
  o['size hole: share 14% is not a hole, 15% is']=hole([sr('S',0,14),sr('M',100,86)])==='[]'&&hole([sr('S',0,15),sr('M',100,85)]).indexOf('sizehole')>0;
  o['size hole: out with 20% of 100 units is act; 15 units (15%) is act by units; 6 of 40 (15%, under 10 units, under 20%) is watch']=hole([sr('S',0,20),sr('M',100,80)]).indexOf('"b":"act"')>0&&hole([sr('S',0,15),sr('M',100,85)]).indexOf('"b":"act"')>0&&hole([sr('S',0,6),sr('M',100,34)],{m:{coverDays:50,units28:40,sizeRows:[sr('S',0,6),sr('M',100,34)]}}).indexOf('"b":"watch"')>0;
  o['size hole: thin (stock 5, 28 sold = 5 days of cover) is a hole; 14 days is the line']=hole([sr('S',5,28),sr('M',100,72)]).indexOf('sizehole')>0&&hole([sr('S',28,28),sr('M',100,72)])==='[]';
  o['size hole: an Unknown size and a null stock are skipped, never 0']=hole([sr('Unknown',0,50),sr('M',100,50)])==='[]'&&hole([{size:'S',stock:null,recent:50,sold:50},sr('M',100,50)])==='[]';
  o['size hole: not raised when the whole article is a run-out (one row, strongest problem)']=det({a:{onHand:20},m:{coverDays:5,units28:100,sizeRows:[sr('S',0,50),sr('M',20,50)]}}).indexOf('sizehole')<0;
  o['size hole: an article with under 8 units in 28 days is ignored']=det({a:{onHand:200},m:{coverDays:50,units28:7,sizeRows:[sr('S',0,7)]}})==='[]';
  // cash
  o['dead: needs 5 on hand and 56 counted days (4 on hand and 55 days are silent)']=det({c:{cls:'dead',label:'Dead stock'},a:{onHand:5},m:{days:56}}).indexOf('"t":"dead"')>0&&det({c:{cls:'dead',label:'Dead stock'},a:{onHand:4},m:{days:90}})==='[]'&&det({c:{cls:'dead',label:'Dead stock'},a:{onHand:50},m:{days:55}})==='[]';
  o['overstock: cover 26 weeks and 100,000 qualifies; 25.9 weeks or 99,999 does not']=det({a:{onHand:100},m:{cover:26,asp:1000}}).indexOf('overstock')>0&&det({a:{onHand:100},m:{cover:25.9,asp:1000}})==='[]'&&det({a:{onHand:100},m:{cover:30,asp:999.99}})==='[]';
  o['overstock: watch under 52 weeks and 500,000, act at either']=det({a:{onHand:100},m:{cover:30,asp:1000}}).indexOf('"b":"watch"')>0&&det({a:{onHand:100},m:{cover:52,asp:1000}}).indexOf('"b":"act"')>0&&det({a:{onHand:500},m:{cover:30,asp:1000}}).indexOf('"b":"act"')>0;
  o['a missing price shows the value as "—" and never as 0 (dead: watch, no value)']=R('(()=>{const i=_siNaDetect(__row({c:{cls:"dead",label:"Dead stock"},a:{onHand:50},m:{asp:null,days:90}}),__ctx)[0];return i.n.valueTied===null&&i.band==="watch"&&_siNaAtText(i)==="—";})()');
  o['winter stock in Sep-Nov is a seasonal wait (watch), not a red clear-out']=det({c:{cls:'dead',label:'Dead stock'},a:{onHand:200},m:{days:90}},'Object.assign({},__ctx,{winter:()=>true})')==='[{"t":"dead","b":"watch","s":true,"r":false}]';
  o['season window: hoodies on 1 Oct yes, 31 Aug no, 1 Dec no, tees never']=R('_siNaWinter({category:"Hoodies"},"2026-10-01")&&!_siNaWinter({category:"Hoodies"},"2026-08-31")&&!_siNaWinter({category:"Hoodies"},"2026-12-01")&&!_siNaWinter({category:"Tees"},"2026-10-01")&&_siNaWinter({category:"Zipper"},"2026-09-15")&&!_siNaWinter({category:"Zipper"},"2026-09-14")');
  // ranking by Rs at stake, not by units: P loses more units (160) but at a price of 100 (16,000); Q loses fewer (64) at 1000 (64,000)
  R(`var __rowsPQ=function(){const mk=(code,pd,asp)=>__row({a:{code,name:code,onHand:20},m:{coverDays:5,perInDay:pd,asp,units28:60}});return[mk("P",10,100),mk("Q",4,1000)];};`);
  o['ranking: Rs at stake beats raw units (Q 64 units x 1000 ranks above P 160 units x 100)']=R('J=JSON.stringify(_siNaBuild(__rowsPQ(),__ctx).issues.map(i=>i.code+":"+Math.round(i.lost)+":"+Math.round(i.at)))')==='["Q:64:64000","P:160:16000"]';
  o['ranking: with equal Rs the larger loss in units first, then the class, then the code']=R('J=JSON.stringify(_siNaBuild([__row({a:{code:"B",name:"B",onHand:20},m:{coverDays:5,perInDay:4,asp:1000,units28:60}}),__row({a:{code:"A",name:"A",onHand:20},m:{coverDays:5,perInDay:4,asp:1000,units28:60}})],__ctx).issues.map(i=>i.code))')==='["A","B"]';
  o['one primary issue per article: a run-out that is also 20% voided keeps the data check as "also", not a second row']=R('(()=>{const b=_siNaBuild([__row({a:{onHand:20},m:{coverDays:5,voidRate:0.2,voided:9}})],__ctx);return b.issues.length===1&&b.issues[0].type==="runout"&&b.issues[0].also.join()==="datatrust"&&b.counts.critical===1&&b.counts.total===1;})()');
  // sudden drop and discount helpers on daily maps
  R(`var __days=function(from,n,fn){const m=new Map();const s=_siAxDayNum(from);for(let k=0;k<n;k++){const u=fn(k);if(u)m.set(_siAxDayStr(s+k),{u,r:u*1000});}return m;};`);
  o['discount: usual price 1000, last 7 days 10 of 14 units at 700 = 71% reduced; under 10 units is null']=R('(()=>{const a={hasPrice:true,daily:__days("2026-07-01",62,k=>1)};const d=__days("2026-08-25",7,k=>2);d.forEach((v,k)=>{a.daily.set(k,k<"2026-08-29"?{u:2,r:1400}:{u:2,r:4000});});const x=_siNaDiscount(a,"2026-08-31");return x&&x.units7===14&&x.disc===8&&Math.abs(x.share-8/14)<1e-9&&x.base===1000;})()')===true;
  o['discount: fewer than 10 units in the last 7 days says nothing']=R('_siNaDiscount({hasPrice:true,daily:__days("2026-07-01",62,k=>1)},"2026-08-31")')===null;
  // sudden drop (own instance: it replaces the stock history)
  {
    const b=load(src,{}),B=c=>b.run(c);
    B('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));}');
    const start=B('_siAxDayNum("2026-07-28")');
    const snaps=[];for(let k=0;k<39;k++){const n=B('_siAxDayNum("2026-07-24")')+k;snaps.push({date:B('_siAxDayStr('+n+')'),items:{i:{sku:'S-M',available:50}}});}
    B('_siHist=_siAxBuildHistory('+J(snaps)+');_siHistState="ok"');
    B(`var __d=function(last,stockOutFrom){const m=new Map();const s=_siAxDayNum("2026-07-28");for(let k=0;k<35;k++){const u=k<28?(k<16?10:0):Math.round(last/7);if(u)m.set(_siAxDayStr(s+k),{u,r:u*1000});}return{code:"S",daily:m};};`);
    // prior 28 days (07-28..08-24) = 16 x 10 = 160 -> 40 a week; last 7 = 14 -> z=(14-40)/sqrt(40)=-4.11
    o['sudden drop: 14 last week against 40 a week (z -4.11), in stock all 7 days -> reported']=B('(()=>{const x=_siNaSudden(__d(14),{days:90},"2026-08-31");return !!x&&x.last===14&&x.base===40&&x.z<-4.1&&x.z>-4.12;})()')===true;
    o['sudden drop: z -2.53 (last 24) is reported, z -2.37 (last 25) is not']=B('!!_siNaSudden(__d(21),{days:90},"2026-08-31")')===true&&B('_siNaSudden(__d(28),{days:90},"2026-08-31")')===null;
    o['sudden drop: base under 5 a week is silent; under 35 counted days is silent']=B('_siNaSudden(Object.assign(__d(14),{daily:(()=>{const m=new Map();m.set("2026-08-10",{u:16,r:16000});m.set("2026-08-25",{u:1,r:1000});return m;})()}),{days:90},"2026-08-31")')===null&&B('_siNaSudden(__d(14),{days:34},"2026-08-31")')===null;
    o['sudden drop: without 5 in-stock days in the last 7 nothing is said (a stock-out is not a demand drop)']=(()=>{
      const sn=[];for(let k=0;k<39;k++){const n=B('_siAxDayNum("2026-07-24")')+k,day=B('_siAxDayStr('+n+')');sn.push({date:day,items:{i:{sku:'S-M',available:day>='2026-08-27'?0:50}}});}
      B('_siHist=_siAxBuildHistory('+J(sn)+')');return B('_siNaSudden(__d(14),{days:90},"2026-08-31")')===null;})();
  }
  // playbook: strings from numbers (hand-computed). 28 on hand, 8 a day, lead 21 -> 3.5 days, gap 17.5 -> "about 4" and "about 18"
  const pb=(ov,ctx)=>R('J=JSON.stringify(_siNaPlaybook(_siNaDetect(__row('+J(ov)+'),'+(ctx||'__ctx')+')[0]))');
  const ru=JSON.parse(pb({a:{onHand:28},m:{coverDays:3.5,cover:0.5,perInDay:8,units28:224}}));
  o['playbook run-out: situation sentence from the numbers (28 left, 8 a day, empty in about 4 days, gap about 18, 140 units)']=ru.situation==='28 left, selling about 8 a day: empty in about 4 days. A batch takes 21 days (the default, unconfirmed), so there is a gap of about 18 days (roughly 140 units of sales).';
  o['playbook run-out: reorder guide 276–468 (8/day: 6 x 49 - 28 = 266 -> 276; 10 x 49 - 28 = 462 -> 468), owner Raees first']=ru.actions[0].owner==='Raees'&&/about 276–468 units/.test(ru.actions[0].text)&&ru.actions.length>=3;
  o['playbook: every action has an owner from Raees, Mustafa, Daniyal, Saim']=ru.actions.every(x=>['Raees','Mustafa','Daniyal','Saim'].indexOf(x.owner)>=0);
  o['playbook run-out: what NOT to do and a confidence line naming the default lead time and unsynced returns']=ru.avoid.length>=2&&/Medium confidence/.test(ru.confidence)&&/default/.test(ru.confidence)&&/not synced/.test(ru.confidence);
  const so=JSON.parse(pb({a:{onHand:0},c:{cls:'solid'},m:{coverDays:null,cover:null,perInDay:8,units28:56,outDays:9,measured:30}}));
  o['playbook stock-out: out 9 of 30 days, 8 a day -> about 72 turned away; guide 300–492 (8x0.75x49=294 -> 300; 490 -> 492)']=/has no stock left\. It has been out on 9 of 30 measured days and sold 8 a day while it was in stock, so about 72 units of demand were turned away\./.test(so.situation)&&/about 300–492 units/.test(so.actions[0].text);
  o['playbook stock-out: a winner uses 35 days of cover (8 x 0.75 x 56 = 336; 8 x 1.25 x 56 = 560 -> 564)']=/about 336–564 units/.test(JSON.parse(pb({a:{onHand:0},c:{cls:'winner',label:'Winner'},m:{coverDays:null,cover:null,perInDay:8,units28:56,outDays:9,measured:30}})).actions[0].text);
  o['playbook: no reorder size when nothing is needed (huge stock) and none for dead stock']=R('_siNaQty(8,21,2000,"solid")')===null&&R('_siNaQty(null,21,0,"solid")')===null&&R('_siNaQty(0,21,0,"solid")')===null;
  o['reorder size is rounded UP to a pack of 12: 0.1/day, 3 on hand -> 12–12; 0.5/day, 20 on hand -> 0–12 (low end never negative)']=R('J=JSON.stringify(_siNaQty(0.1,21,3,"solid"))')==='{"lo":12,"hi":12,"target":28}'&&R('J=JSON.stringify(_siNaQty(0.5,21,20,"solid"))')==='{"lo":0,"hi":12,"target":28}';
  const ov30=JSON.parse(pb({c:{cls:'slow',label:'Slow'},act:{key:'stuck'},a:{onHand:100},m:{cover:30,asp:1000,perInDay:0.5}}));
  const ov60=JSON.parse(pb({c:{cls:'slow',label:'Slow'},act:{key:'stuck'},a:{onHand:100},m:{cover:60,asp:1000,perInDay:0.5}}));
  o['playbook overstock: the ladder changes at 52 weeks (30: promote or bundle, 60: markdown steps)']=ov30.actions.some(x=>/Promote it or bundle/.test(x.text))&&!ov30.actions.some(x=>/Mark down in steps/.test(x.text))&&ov60.actions.some(x=>/Mark down in steps: 15%, then 30%/.test(x.text))&&!ov60.actions.some(x=>/Promote it or bundle/.test(x.text));
  o['playbook overstock: value is called "at selling price" and says cost is not recorded']=/100,000 at selling price, cost is not recorded|PKR 100,000 at selling price/.test(ov30.situation);
  const dw=JSON.parse(pb({c:{cls:'dead',label:'Dead stock'},a:{onHand:200},m:{days:90}},'Object.assign({},__ctx,{winter:()=>true})'));
  o['playbook seasonal dead: hold and look again on 15 November, no clear-out']=dw.actions.some(x=>/15 November/.test(x.text))&&!dw.actions.some(x=>/bundle or discount/.test(x.text));
  o['playbook rising: units, gap beyond chance, days left and the sale caveat']=(()=>{const p=JSON.parse(pb({m:{coverDays:30,momWord:'Rising',momentum:0.5,momUnits:100,units28:60}},'Object.assign({},__ctx,{disc:()=>({units7:20,disc:6,share:0.3,base:1000})})'));return/Selling faster: 60 units in the last 28 days against 40 before \(\+50%, a gap bigger than chance\)\./.test(p.situation)&&/30% of the last week’s 20 units were at a reduced price/.test(p.situation);})();
  o['playbook demand drop: -66.7%, in stock 83% of days, so a stock-out does not explain it']=(()=>{const p=JSON.parse(pb({c:{cls:'solid'},m:{momWord:'Fading',momentum:-0.667,momUnits:224,units28:56,inRate:0.83}}));return/Last 28 days: 56 units against 168 in the 28 before \(-66\.7%, a gap bigger than chance\)\. It was in stock on 83% of days/.test(p.situation)&&p.avoid.some(x=>/one week/.test(x));})();
  o['playbook size hole: names the sizes, the share of 28-day sales, and tells Raees to cut a size run, not the whole article']=(()=>{const h2=iss('H');const p=JSON.parse(R('J=JSON.stringify(_siNaPlaybook(_siNaState().issues.find(i=>i.code==="H")))'));return/^Size S \(out\) sold 56 of 112 units in the last 28 days \(50%\)/.test(p.situation)&&/size run/.test(p.actions[0].text)&&p.avoid.some(x=>/whole article/.test(x));})();
  o['playbook data check and every type returns situation, why, 1+ action, 1+ avoid, confidence']=(()=>{
    const types=[{},{a:{onHand:0},c:{cls:'solid'},m:{units28:56,perInDay:8,outDays:3,measured:30,coverDays:null,cover:null}},{m:{coverDays:5}},{a:{onHand:200},m:{coverDays:50,units28:100,sizeRows:[sr('S',0,30),sr('M',100,70)]}},{a:{onHand:200},m:{cover:60,asp:1000}},{c:{cls:'dead',label:'Dead stock'},a:{onHand:50},m:{days:90}},{m:{coverDays:30,momWord:'Rising'}},{m:{momWord:'Fading',momentum:-0.5,momUnits:60,units28:20}},{m:{voidRate:0.2,voided:9}}];
    return types.every(t=>{const i=R('_siNaDetect(__row('+J(t)+'),__ctx)[0]||null');if(!i)return t.m===undefined&&!t.a;const p=JSON.parse(R('J=JSON.stringify(_siNaPlaybook(_siNaDetect(__row('+J(t)+'),__ctx)[0]))'));return p.situation&&p.why&&p.actions.length>=1&&p.avoid.length>=1&&p.confidence;});})();
  // escaping: a hostile name and code render as text everywhere
  const evil='<img src=x onerror=alert(1)>';
  const evilIssue='(()=>{const i=_siNaDetect(__row({a:{code:"A\\"><b>",name:'+J(evil)+'},m:{coverDays:5}}),__ctx)[0];return i;})()';
  const rowH=R('_siNaRowHtml('+evilIssue+',true)'),detH=R('_siNaDetailHtml('+evilIssue+')');
  o['escaping: the row has no raw tag and the code in data-code is escaped']=!/<img/i.test(rowH)&&/&lt;img/.test(rowH)&&!/data-code="A"><b>/.test(rowH)&&/&quot;&gt;&lt;b&gt;/.test(rowH);
  o['escaping: the situation view has no raw tag from a hostile name or code']=!/<img/i.test(detH)&&/&lt;img/.test(detH)&&!/data-code="A"><b>/.test(detH)&&!/A"><b>/.test(detH);
  o['escaping: a hostile article name never reaches the playbook as markup (strings only)']=!/</.test(R('J=JSON.stringify(_siNaPlaybook('+evilIssue+').situation.replace(/<img src=x onerror=alert\\(1\\)>/g,""))'));
  // trust, pure
  const NOW=Date.parse('2026-08-31T12:00:00Z'),T=(x)=>R('J=JSON.stringify(_siNaTrustOf(Object.assign({now:'+NOW+',today:"2026-08-31",snapshot:{date:"2026-08-31",snapshot_at:"2026-08-31T06:00:00Z"},meta:{orderSync:{last_status:"success",last_success_at:"2026-08-31T09:00:00Z"},inventory:{last_status:"success"}},hist:null,histState:"ok",quality:{returns:{synced:true},snapshot:{},lineItems:{}}},'+J(x||{})+')))');
  const tr0=JSON.parse(T());
  o['trust: fresh snapshot, fresh order sync, returns synced -> nothing red or amber']=tr0.red.length===0&&tr0.amber.length===0;
  const tr1=JSON.parse(T({snapshot:{date:'2026-08-30',snapshot_at:'2026-08-30T06:00:00Z'}}));
  o['trust: a snapshot 30 hours old is red and says so ("30 hours old")']=tr1.red.length===1&&tr1.red[0].id==='snapshot_stale'&&/30 hours old/.test(tr1.red[0].title);
  o['trust: 26 hours is the line (26h fresh, 27h stale); 3 days says "3 days"']=JSON.parse(T({snapshot:{date:'x',snapshot_at:'2026-08-30T10:00:00Z'}})).red.length===0&&JSON.parse(T({snapshot:{date:'x',snapshot_at:'2026-08-30T09:00:00Z'}})).red.some(x=>x.id==='snapshot_stale')&&/3 days old/.test(JSON.parse(T({snapshot:{date:'x',snapshot_at:'2026-08-28T12:00:00Z'}})).red[0].title);
  o['trust: without snapshot_at the document date is used (2 days behind is stale, 1 is not)']=JSON.parse(T({snapshot:{date:'2026-08-29'}})).red.some(x=>x.id==='snapshot_stale')&&!JSON.parse(T({snapshot:{date:'2026-08-30'}})).red.length;
  o['trust: a failed snapshot run with a fresh snapshot is red and carries the escaped error']=(()=>{const t=JSON.parse(T({meta:{inventory:{last_status:'error',last_error:'boom <b>'},orderSync:{last_status:'success',last_success_at:'2026-08-31T09:00:00Z'}}}));const h=R('_siNaTrustHtml('+J(t)+')');return t.red.some(x=>x.id==='snapshot_failed')&&!/boom <b>/.test(h)&&/boom &lt;b&gt;/.test(h);})();
  o['trust: a truncated snapshot (complete:false, or dropped by the history) is red']=JSON.parse(T({snapshot:{date:'2026-08-31',snapshot_at:'2026-08-31T06:00:00Z',complete:false}})).red.some(x=>x.id==='snapshot_truncated')&&JSON.parse(T({hist:{dropped:['2026-08-31'],dates:[]}})).red.some(x=>x.id==='snapshot_truncated');
  o['trust: order sync failed is red; 9 hours old is red, 7 hours is not']=JSON.parse(T({meta:{orderSync:{last_status:'error',last_error:'e'},inventory:{}}})).red.some(x=>x.id==='orders_failed')&&JSON.parse(T({meta:{orderSync:{last_status:'success',last_success_at:'2026-08-31T02:00:00Z'},inventory:{}}})).red.some(x=>x.id==='orders_stale')&&JSON.parse(T({meta:{orderSync:{last_status:'success',last_success_at:'2026-08-31T05:00:00Z'},inventory:{}}})).red.length===0;
  o['trust: missing order-sync meta is "unknown" (a quiet note), never fine and never red']=(()=>{const t=JSON.parse(T({meta:{inventory:{}}}));return t.red.length===0&&t.unknown.length===1&&/not available/.test(t.unknown[0]);})();
  o['trust: other banners still render beside the quiet returns note (stale snapshot stays red)']=(()=>{const t=JSON.parse(T({snapshot:{date:'x',snapshot_at:'2026-08-30T09:00:00Z'},quality:{returns:{synced:false},snapshot:{},lineItems:{}}}));const h=R('_siNaTrustHtml('+J(t)+')');return t.red.some(x=>x.id==='snapshot_stale')&&/si-na-trust red/.test(h)&&/role="alert"/.test(h);})();
  o['trust: returns not synced is a quiet note only (no amber, no red, no pill count)']=(()=>{const t=JSON.parse(T({quality:{returns:{synced:false},snapshot:{},lineItems:{}}}));const h=R('_siNaTrustHtml('+J(t)+')');return t.red.length===0&&!t.amber.some(x=>x.id==='returns')&&t.quiet.some(x=>/Returns not yet synced/.test(x))&&!/Returns are not synced|si-na-trust amber/.test(h)&&/Returns not yet synced/.test(h);})();
  o['trust: 2 missing snapshot days in the last 14 is amber, a complete history is not']=(()=>{const dates=[];for(let k=1;k<=14;k++)if(k!==3&&k!==9)dates.push(R('_siAxDayStr(_siAxDayNum("2026-08-31")-'+k+')'));const t=JSON.parse(T({hist:{dates,dropped:[]}}));const t2=JSON.parse(T({hist:{dates:dates.concat([R('_siAxDayStr(_siAxDayNum("2026-08-31")-3)'),R('_siAxDayStr(_siAxDayNum("2026-08-31")-9)')]),dropped:[]}}));return t.amber.some(x=>x.id==='gap'&&/^2 days missing/.test(x.title))&&!t2.amber.some(x=>x.id==='gap');})();
  o['trust: a failed stock-history read is red with Retry']=(()=>{const t=JSON.parse(T({histState:'error',histError:'timed out'}));return t.red[0].id==='history'&&t.red[0].retry===true&&/timed out/.test(t.red[0].text);})();
  o['trust: quiet notes come from the cleaning counts (3 negative entries, 2 duplicate SKUs, 4 with no SKU)']=(()=>{const t=JSON.parse(T({quality:{returns:{synced:true},snapshot:{negativeClamped:3,duplicateSkus:2,noSku:1},lineItems:{noSku:3},nonMerch:{articles:1}}}));const q=t.quiet.join(' | ');return/3 negative stock entries counted as 0/.test(q)&&/2 SKUs appear more than once/.test(q)&&/4 rows with no SKU/.test(q)&&/1 non-merchandise code/.test(q);})();
  // the real page: tab bar, sections, handlers
  R('window.scrollY=420;window.__sc=[];window.scrollTo=function(x,y){window.__sc.push(y);};');
  const bar=R('_siTabBar()');
  o['tab bar: six tabs, no Selling Patterns, Needs Attention carries a red pill with the count 16']=(bar.match(/class="gp-tab[ "]/g)||[]).length===6&&!/Selling Patterns/.test(bar)&&/Needs Attention<span class="si-na-pill"[^>]*>16</.test(bar);
  o['tab bar: the pill is hidden while the stock history is still being read']=(()=>{R('_siHistState="loading"');const b=R('_siTabBar()');R('_siHistState="ok"');return!/si-na-pill/.test(b)&&/Needs Attention<\/button>/.test(b);})();
  o['tab bar: a count over 99 reads 99+']=R('(()=>{const g=_siNaBadge;_siNaBadge=()=>150;const b=_siTabBar();_siNaBadge=g;return /si-na-pill[^>]*>99\\+</.test(b);})()');
  o['Selling Patterns is gone from the source: tab, section, helpers and the old attention rule']=!/Selling Patterns/.test(src)&&!/_siPatternsSection|_siByNormDim|_siByCategoryLive|_siSizeCurve|_siNeedsAttention|_siAttentionSection/.test(src)&&!/id:'patterns'|=== ?'patterns'/.test(src);
  R('window._siSwitchTab("patterns")');
  o['a stale "patterns" section lands on Overview, not a blank page']=R('_siSection')==='overview'&&/Inventory Value/.test(a.el('si-content').innerHTML);
  R('_siSection="nonsense";window.__h=renderShopifyDashboard()');
  o['an unknown section id renders Overview in the page and in the tab switch']=R('_siSection')==='overview'&&/Inventory Value/.test(R('window.__h'))&&!/Selling Patterns/.test(R('window.__h'));
  R('_siSection="gone";window._siSwitchTab("gone")');
  o['switching to an unknown id is Overview']=R('_siSection')==='overview'&&a.el('si-content').innerHTML.length>200;
  const ovh=R('_siOverview(_siComputeMetrics())');
  o['Overview tiles read the Needs Attention counts: 16 need action (more than the old cap of 8) and 3 cash piles']=/si-na-tile hot"[^>]*>[\s\S]*?<div class="num">16</.test(ovh)&&/Overstocked \/ dead stock<\/div><div class="num">3</.test(ovh)&&/11 critical · 5 this week · 2 to watch/.test(ovh)&&16>8;
  o['Overview red border: the style is a class now, never a style attribute inside class="..."']=!/class="[^"]*style=/.test(ovh)&&/class="card si-na-tile hot"/.test(ovh)&&/class="card si-na-tile warm"/.test(ovh);
  o['Overview cash tile shows value at selling price (640,000 = 400,000 + 200,000 + 40,000)']=/PKR 640,000 at selling price/.test(ovh);
  o['Overview tiles say they are reading while the history loads, never a 0']=(()=>{R('_siHistState="loading"');const h=R('_siOverview(_siComputeMetrics())');R('_siHistState="ok"');return/<div class="num">…<\/div>/.test(h)&&!/<div class="num">0<\/div>/.test(h.split('si-na-tiles')[1]||'');})();
  o['Overview tile click goes to the tab (all) or the cash filter']=/_siNaGo\('all'\)/.test(ovh)&&/_siNaGo\('cash'\)/.test(ovh);
  R('window._siNaGo("cash")');
  o['Overview cash tile opens Needs Attention filtered to cash only']=R('_siSection')==='attention'&&R('_siNaFilter')==='cash'&&(a.el('si-content').innerHTML.match(/class="si-na-row /g)||[]).length===3;   // V1 + D1 + D2: a reason filter opens the watch band
  R('window._siNaGo("all")');
  const html=()=>a.el('si-content').innerHTML;
  const rows=()=>(html().match(/class="si-na-row /g)||[]).length;
  o['list: headline strip shows the UNCAPPED counts (16 need action; 11 critical, 5 this week, 2 to watch)']=/<span class="num">16<\/span> articles need action/.test(html())&&/<b>11<\/b> critical/.test(html())&&/<b>5<\/b> this week/.test(html())&&/<b>2<\/b> to watch/.test(html());
  o['list: caps are 5 critical and 8 act (all 5 act shown), watch is collapsed: 10 rows, "Show all 11" offered']=rows()===10&&/Show all 11/.test(html())&&!/Show all 5/.test(html())&&/aria-expanded="false"/.test(html());
  R('window._siNaShowAll("critical")');
  o['Show all expands the critical band to all 11 and offers to go back to 5']=(html().match(/class="si-na-row critical/g)||[]).length===11&&/Show the first 5/.test(html());
  R('window._siNaToggleWatch()');
  o['the watch band opens on its header: D1 and T1 appear']=(html().match(/class="si-na-row watch/g)||[]).length===2&&/aria-expanded="true"/.test(html());
  R('window._siNaToggleWatch()');
  o['every row is a button naming the article, its reason and its class (not colour alone)']=/<button type="button" class="si-na-row critical" data-code="R10"[\s\S]*?Runs out before restock[\s\S]*?Art R10/.test(html())&&/aria-label="Art R10[^"]*Runs out before restock/.test(html());
  o['rows are articles: no variant size appears as a row title (H once, not S/M/L)']=(html().match(/data-code="H"/g)||[]).length===1&&!/data-code="H-/.test(html());
  R('window._siNaSetFilter("dead")');
  o['filter: Dead stock shows D1 and D2 (the watch band opens under a reason, headline unchanged)']=R('_siNaFilter')==='dead'&&/<span class="num">16<\/span>/.test(html())&&/Dead stock <b>2<\/b>/.test(html())&&rows()===2;
  R('window._siNaSetFilter("bogus")');
  o['filter: an unknown filter is ignored']=R('_siNaFilter')==='dead';
  R('window._siNaSetFilter("all")');
  // click-through
  const keyBefore=(a.state.listeners.keydown||[]).length;
  const opened=R('window._siNaOpen("r10")');
  const d=html();
  o['click: opens the situation for R10 (case-insensitive code), in place of the list']=opened===true&&R('_siNaSel')==='R10'&&/class="si-na-detail critical"/.test(d)&&!/si-na-band/.test(d);
  o['situation view shows Situation, How to tackle with owners, Why it matters, What not to do, Key numbers and How sure are we']=['Situation','How to tackle','Why it matters','What not to do','Key numbers','How sure are we'].every(t=>d.indexOf(t)>=0)&&/<span class="si-na-own">Raees<\/span>/.test(d)&&/<span class="si-na-own">Daniyal<\/span>/.test(d);
  o['situation view: the sentence for R10 (13 a day, 28 left: about 2 days, gap about 19 days)']=/28 left, selling about 13 a day: empty in about 2 days\. A batch takes 21 days \(the default, unconfirmed\), so there is a gap of about 19 days/.test(d);
  o['situation view: buttons to open the article in the Explorer and add it to Compare']=/_siNaToExplorer\(this\.dataset\.code\)">Open in Article Explorer/.test(d)&&/_siNaCompare\(this\.dataset\.code\)">\+ Compare/.test(d);
  o['click: scroll goes to the top, and an entrance animation class is applied']=R('JSON.stringify(window.__sc)')==='[0]'&&a.el('si-content').classList.contains('si-ax-enter');
  o['click: an unknown code does nothing']=R('window._siNaOpen("NOPE")')===false&&R('_siNaSel')==='R10';
  o['click: Escape is wired on first open (one listener), not at load']=(a.state.listeners.keydown||[]).length===keyBefore+1&&keyBefore===0;
  o['prev / next step through the ranked list: R9 after R10, nothing before the first']=R('window._siNaStep(1)')===true&&R('_siNaSel')==='R9'&&R('window._siNaStep(-1)')===true&&R('window._siNaStep(-1)')===false&&R('_siNaSel')==='R10';
  R('window.__sc=[]');R('window._siNaBack()');
  o['back: returns to the list, keeps the expanded band (11 critical rows), restores the scroll position 420']=R('_siNaSel')===''&&(html().match(/class="si-na-row critical/g)||[]).length===11&&R('JSON.stringify(window.__sc)')==='[420]';
  R('window._siNaOpen("R10")');
  (a.state.listeners.keydown||[]).forEach(fn=>fn({key:'Escape'}));
  o['Escape closes the situation and returns to the list']=R('_siNaSel')===''&&/si-na-band/.test(html());
  (a.state.listeners.keydown||[]).forEach(fn=>fn({key:'Escape'}));
  o['Escape with no situation open does nothing']=R('_siNaSel')==='';
  R('window._siNaOpen("H")');
  o['a size-hole article shows the per-size table with S out']=/si-na-sizes/.test(html())&&/<tr class="bad"><td><strong>S<\/strong><\/td><td>0<\/td><td>56<\/td>/.test(html());
  R('window._siNaToExplorer("h")');
  o['Open in Article Explorer: goes to the Explorer on that article and closes the situation']=R('_siSection')==='explorer'&&R('_siAxSel')==='H'&&R('_siAxModeSel')==='search'&&R('_siNaSel')==='';
  R('window._siSwitchTab("attention")');
  R('window._siNaCompare("R10")');
  o['+ Compare adds the article to the Explorer comparison']=R('_siAxCmp.indexOf("R10")')>=0;
  R('_siNaSel="ZZ"');
  o['a selected article that is no longer an issue falls back to the list']=/si-na-band/.test(R('_siNaSectionHtml()'))&&R('_siNaSel')==='';
  o['switching tab closes an open situation but keeps the list state']=(()=>{R('window._siNaOpen("R10")');R('window._siSwitchTab("skutable")');const c=R('_siNaSel')==='';R('window._siSwitchTab("attention")');return c&&(a.el('si-content').innerHTML.match(/class="si-na-row critical/g)||[]).length===11;})();
  // failure path: never an all-clear
  R('_siHistState="error";_siHistError="boom <b>"');
  const eh=R('_siNaSectionHtml()');
  o['history read failed: a red banner with Retry and the escaped reason, lists still shown']=/Stock history could not be read/.test(eh)&&/_siNaRetry\(\)/.test(eh)&&!/boom <b>/.test(eh)&&/boom &lt;b&gt;/.test(eh)&&/si-na-row/.test(eh);
  R('_siHistState="ok";_siHistError=""');
  R('window._siNaRetry()');
  o['Retry re-reads the history and shows "Reading the stock history…" meanwhile']=R('_siHistState')==='loading'&&/Reading the stock history/.test(R('_siNaSectionHtml()'));
  // the hook that repaints the pill and the open section when the history lands
  R('_siHistState="ok";_siHist=_siHist;_siAxCache=null;_siSection="attention";window._siSwitchTab("attention")');
  a.el('si-tab-bar').outerHTML='';a.el('si-content').innerHTML='';
  R('_siNaOnHistory()');
  o['the history-landed hook repaints the section when Needs Attention is open']=/si-na-band/.test(a.el('si-content').innerHTML);
  // the empty state, in its own instance (no articles at all)
  {
    const b=load(src,{}),B=c=>b.run(c);
    B('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));}');
    B('_siProducts=[];_siLineItems=[];_siOrders=[];_siHist=_siAxBuildHistory([]);_siHistState="ok";_siSnapshot={date:"2026-08-31",snapshot_at:"2026-08-31T06:00:00Z",items:{}};_siAxCache=null;_siNaMemo=null;_siSyncMeta={orderSync:{last_status:"success",last_success_at:"2026-08-31T09:00:00Z"},inventory:{}};');
    B('_siNaNowMs='+NOW);
    const e1=B('_siNaListHtml()');
    o['empty state: believable, names the snapshot date and the article count, no red counts']=/Nothing needs attention\. Checked 0 articles against stock as of 2026-08-31/.test(e1)&&/<span class="num">0<\/span>/.test(e1);
    B('_siSnapshot={date:"2026-08-20",snapshot_at:"2026-08-20T06:00:00Z",items:{}};_siNaMemo=null');
    const e2=B('_siNaListHtml()');
    o['empty state with a stale snapshot is NOT an all-clear: it says so']=/not an all-clear/.test(e2)&&!/Nothing needs attention\./.test(e2)&&/si-na-trust red/.test(e2);
    const t0=B('_siOverview(_siComputeMetrics())');
    o['Overview with no issues: no red/amber tile class and a 0, not a hidden tile']=/<div class="num">0<\/div>/.test(t0)&&!/si-na-tile hot/.test(t0)&&!/si-na-tile warm/.test(t0);
  }
  // CSS: tokens only, one documented literal, reduced motion, phone, touch targets
  const css=fs.readFileSync(path.join(__dirname,'../css/main.css'),'utf8');
  const blk=css.slice(css.indexOf('Inventory Intel ▸ Needs Attention (Oct 2026)'));
  const lits=(blk.match(/#[0-9a-fA-F]{3,8}\b/g)||[]);
  o['CSS: the only literal colour in the Needs Attention block is #fff, and only beside --count-accent']=lits.length>0&&lits.every(x=>x.toLowerCase()==='#fff')&&blk.split('\n').filter(l=>/#fff\b/i.test(l)).every(l=>/var\(--count-accent\)/.test(l)||/\.si-na-pill|\.si-na-reason\.critical|\.si-na-chip\.crit|\.si-na-band\.critical/.test(l));
  o['CSS: the red uses the count accent and the urgent tokens, never --red or --dark fills']=/var\(--count-accent\)/.test(blk)&&/var\(--accent-urgent\)/.test(blk)&&/var\(--accent-urgent-soft\)/.test(blk)&&!/background:var\(--red\)/.test(blk);
  o['CSS: reduced motion is respected and a phone layout exists']=/prefers-reduced-motion:reduce\)\{\.si-na-row\{transition:none\}/.test(blk)&&/@media \(max-width:600px\)\{\s*\.si-na-row\{grid-template-columns/.test(blk);
  o['CSS: controls are at least 34px tall (filters, rows 56, band toggle, phone 40)']=/\.si-na-fchip\{min-height:34px/.test(blk)&&/\.si-na-row\{[^}]*min-height:56px/.test(blk)&&/\.si-na-bh\.toggle\{[^}]*min-height:40px/.test(blk)&&/\.si-na-btns \.si-ax-btn[^{]*\{min-height:40px/.test(blk);
  o['a Slow or Dead article with little cover is not a run-out (only sellers can run out)']=det({c:{cls:'slow',label:'Slow'},m:{coverDays:5}})==='[]'&&det({c:{cls:'dead',label:'Dead stock'},m:{coverDays:5},a:{onHand:3}})==='[]';
  // the page: starts the stock-history read when it is still idle, and repaints the pill when it lands
  {
    const b=load(src,{}),B=c=>b.run(c);
    fixture(b);
    B('_siHistState="idle";window.__g=0;getDocs=function(){window.__g++;return Promise.resolve({forEach(){}});};');
    B('renderShopifyDashboard()');
    o['the page starts the stock-history read when idle (one read), not on every render']=B('_siHistState')==='loading'&&B('window.__g')===1&&(B('renderShopifyDashboard()'),B('window.__g'))===1;
    await B('_siHistPromise');
    b.el('si-tab-bar').outerHTML='stale';
    B('_siHistState="idle";_siHistPromise=null;_siAxEnsureHistory()');
    await B('_siHistPromise');
    o['when the history lands the tab bar is repainted (the pill appears without a click)']=/Needs Attention/.test(String(b.el('si-tab-bar').outerHTML))&&b.el('si-tab-bar').outerHTML!=='stale';
  }
  // the loader reads the 4-hourly order sync's own status doc (the "orders" entry is the backfill's)
  {
    const b=load(src,{}),B=c=>b.run(c);
    B('doc=function(d,c,id){return{c,id};};getDoc=async function(r){return{exists:()=>true,data:()=>({__id:r.id,date:"2026-08-31",items:{}})};};_siCollectionsLoaded=true;_siLoaded=false;_siSnapshot=null;');
    await B('loadShopifyData()');
    o['loader: reads shopify_sync_meta/order_sync into _siSyncMeta.orderSync (and keeps the backfill doc as orders)']=B('_siSyncMeta.orderSync&&_siSyncMeta.orderSync.__id')==='order_sync'&&B('_siSyncMeta.orders.__id')==='order_backfill'&&B('_siLoaded')===true;
    B('getDoc=async function(r){if(r.id==="order_sync")throw new Error("denied");return{exists:()=>true,data:()=>({__id:r.id,date:"2026-08-31",items:{}})};};_siLoaded=false;_siSnapshot=null;_siSyncMeta={};');
    await B('loadShopifyData()');
    o['loader: a refused order_sync read is never fatal (the page still loads, the meta is just absent)']=B('_siLoaded')===true&&B('_siSyncMeta.orderSync')===undefined;
  }
  return o;
}
module.exports=async function(){
  const s=suite('shopify-needs-attention');
  const base=await checks(SRC);
  s.section('Needs Attention: detectors, bands, ranking, playbook, trust, page (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  const K={
    ev:'run-out: units lost in the gap = 21d-28 (R10 245, R1 56) and Rs at stake = x 1000',
    crit:'run-out: 15 days of cover against 21 is act this week, not critical (needs under 10.5)',
    so:'out of stock with NO recent sales (units28 0) is not a stock-out (the Explorer says watch)'
  };
  await brk('stock-out without the recent-sales guard','&&m.units28>0&&ev){','&&ev){',[K.so]);
  await brk('cover equal to lead counts','cd!=null&&cd<lead&&ev){','cd!=null&&cd<=lead&&ev){',['boundary: cover exactly equal to the lead time is not a run-out']);
  await brk('critical at the full lead time','cd<lead*C.critGapFrac?\'critical\':\'act\'','cd<lead?\'critical\':\'act\'',[K.crit]);
  await brk('evidence floor of 1 unit','minUnits28:10,','minUnits28:1,',['evidence floor: 9 units in 28 days and 0.9 a day is silent; 10 units speaks; 1.0 a day speaks']);
  await brk('Low confidence speaks','return r.conf.lvl>0&&(','return (',['Low confidence never speaks, even with the units']);
  await brk('slow articles can run out','&&sellers&&cd!=null&&cd<lead&&ev){','&&cd!=null&&cd<lead&&ev){',['a Slow or Dead article with little cover is not a run-out (only sellers can run out)']);
  await brk('ranking ignores Rs at stake','if(ax!==ay)return ay-ax;','',['ranking: Rs at stake beats raw units (Q 64 units x 1000 ranks above P 160 units x 100)']);
  await brk('critical cap 6','capCritical:5,','capCritical:6,',['list: caps are 5 critical and 8 act (all 5 act shown), watch is collapsed: 10 rows, "Show all 11" offered']);
  await brk('watch band open by default','_siNaWatchOpen=false,','_siNaWatchOpen=true,',['list: caps are 5 critical and 8 act (all 5 act shown), watch is collapsed: 10 rows, "Show all 11" offered']);
  await brk('size share 10%','sizeShare:0.15,','sizeShare:0.10,',['size hole: share 14% is not a hole, 15% is']);
  await brk('size out at 1 unit','sizeOutUnits:3,','sizeOutUnits:1,',['size hole: out with 3 units (30% of 10) is a hole; 2 units (20% of 10) is below the 3-unit floor']);
  await brk('size hole beside a run-out','&&(cd==null||cd>=lead)){\n    const holes=[];','){\n    const holes=[];',['size hole: not raised when the whole article is a run-out (one row, strongest problem)']);
  await brk('fading without the in-stock guard','&&(m.inRate==null||m.inRate>=0.7)){\n    const drop','){\n    const drop',['fading winner in stock 69% of days is NOT a demand drop (a stock-out explains it); 70% is']);
  await brk('rising ignores the sale','&&!(disc&&disc.share>C.discShare)){','){',['rising: a sale (80% of last week at a reduced price) is excluded, not called organic']);
  await brk('dead without the age floor','&&m.days>=C.deadMinAge){','){',['dead: needs 5 on hand and 56 counted days (4 on hand and 55 days are silent)']);
  await brk('overstock at 20 weeks','overCoverWeeks:26,overMinValue','overCoverWeeks:20,overMinValue',['overstock: cover 26 weeks and 100,000 qualifies; 25.9 weeks or 99,999 does not']);
  await brk('winter stock still red','if(winter){x.band=\'watch\';x.seasonal=true;}','',['winter stock in Sep-Nov is a seasonal wait (watch), not a red clear-out']);
  await brk('missing price counts as 0','const val=asp!=null?a.onHand*asp:null','const val=a.onHand*(asp||0)',['a missing price shows the value as "—" and never as 0 (dead: watch, no value)']);
  await brk('pack rounding to nearest','Math.ceil(v/C.pack)*C.pack','Math.round(v/C.pack)*C.pack',['stock-out: reorder guide 3.8 x 0.75 x 49 = 139.65 -> 144 and 3.8 x 1.25 x 49 = 232.75 -> 240 (packs of 12)']);
  await brk('quantity band 50%','qtyBand:0.25,','qtyBand:0.5,',['playbook run-out: reorder guide 276\u2013468 (8/day: 6 x 49 - 28 = 266 -> 276; 10 x 49 - 28 = 462 -> 468), owner Raees first']);
  await brk('overstock ladder never marks down','if(n.cover==null||n.cover<52)','if(true)',['playbook overstock: the ladder changes at 52 weeks (30: promote or bundle, 60: markdown steps)']);
  await brk('one row per article dropped','p.also=all.slice(1).map(x=>x.type);p.alts=all.slice(1);issues.push(p);','all.forEach(x=>issues.push(x));',['one primary issue per article: a run-out that is also 20% voided keeps the data check as "also", not a second row']);
  await brk('title not escaped in the situation view','<h2>${_siEsc(i.label)}</h2>','<h2>${i.label}</h2>',['escaping: the situation view has no raw tag from a hostile name or code']);
  await brk('code not escaped in the row','data-code="${_siEsc(i.code)}" onclick="window._siNaOpen','data-code="${i.code}" onclick="window._siNaOpen',['escaping: the row has no raw tag and the code in data-code is escaped']);
  await brk('stale snapshot line at 40 hours','staleSnapHours:26,','staleSnapHours:40,',['trust: a snapshot 30 hours old is red and says so ("30 hours old")']);
  await brk('returns gap is amber again','quiet.push(\'Returns not yet synced:','amber.push({id:\'returns\',title:\'Returns are not synced\',text:\'x\'});quiet.push(\'Returns not yet synced:',['trust: returns not synced is a quiet note only (no amber, no red, no pill count)']);
  await brk('error text not escaped in the banner','<strong>${_siEsc(x.title)}.</strong> ${_siEsc(x.text)}','<strong>${_siEsc(x.title)}.</strong> ${x.text}',['trust: a failed snapshot run with a fresh snapshot is red and carries the escaped error']);
  await brk('missing order meta treated as fine','if(!os||(!os.last_status&&!os.last_success_at))unknown.push(','if(!os||(!os.last_status&&!os.last_success_at))void(',['trust: missing order-sync meta is "unknown" (a quiet note), never fine and never red']);
  await brk('Overview shows the critical count only','<div class="num">${c.action}</div>','<div class="num">${c.critical}</div>',['Overview tiles read the Needs Attention counts: 16 need action (more than the old cap of 8) and 3 cash piles']);
  await brk('Overview style back inside class','class="card si-na-tile${c.action?\' hot\':\'\'}"','class="card si-na-tile${c.action?\' style=&quot;border-left:3px solid var(--accent-urgent)&quot;\':\'\'}"',['Overview red border: the style is a class now, never a style attribute inside class="..."']);
  await brk('section ids not normalised','function _siSecId(id){return _SI_SECTIONS.indexOf(id)>=0?id:\'overview\';}','function _siSecId(id){return id;}',['a stale "patterns" section lands on Overview, not a blank page','switching to an unknown id is Overview']);
  await brk('Selling Patterns tab back','{id:\'skutable\',label:\'SKU Table\'},','{id:\'skutable\',label:\'SKU Table\'},{id:\'patterns\',label:\'Selling Patterns\'},',['tab bar: six tabs, no Selling Patterns, Needs Attention carries a red pill with the count 16']);
  await brk('back forgets the scroll position','const y=_siNaReturnY;if(y>0','const y=0;if(y>0',['back: returns to the list, keeps the expanded band (11 critical rows), restores the scroll position 420']);
  await brk('back collapses the bands','_siNaSel=\'\';window._siNaRepaint();_siAxEnter();\n  const y','_siNaSel=\'\';_siNaShow={critical:false,act:false,watch:false};window._siNaRepaint();_siAxEnter();\n  const y',['back: returns to the list, keeps the expanded band (11 critical rows), restores the scroll position 420']);
  await brk('Escape does nothing','if(e&&e.key===\'Escape\'){window._siNaBack();}','if(false){window._siNaBack();}',['Escape closes the situation and returns to the list']);
  await brk('next skips one','n=order[pos+d];','n=order[pos+d+1];',['prev / next step through the ranked list: R9 after R10, nothing before the first']);
  await brk('pill shows while loading','${t.badge&&n?','${t.badge?',['tab bar: the pill is hidden while the stock history is still being read']);
  await brk('history hook dropped','if(typeof _siNaOnHistory===\'function\')_siNaOnHistory();','',['when the history lands the tab bar is repainted (the pill appears without a click)']);
  await brk('page never starts the history read',"if(_siHistState==='idle'&&typeof getDocs==='function')_siAxEnsureHistory();",'',['the page starts the stock-history read when idle (one read), not on every render']);
  await brk('order_sync not read',"'shopify_sync_meta','order_sync'","'shopify_sync_meta','order_backfill'",['loader: reads shopify_sync_meta/order_sync into _siSyncMeta.orderSync (and keeps the backfill doc as orders)']);
  await brk('order_sync failure leaves a value behind','s4.data():null;}catch(_){}','s4.data():null;}catch(e){_siSyncMeta.orderSync="broken";}',['loader: a refused order_sync read is never fatal (the page still loads, the meta is just absent)']);
  s.ok('breaks run: '+broken,broken>=40);
  return s;
};
module.exports._checks=checks;

/* Inventory Intel ▸ Article Explorer — plan-5 metric fixes (in-stock pace headline, cover range, momentum gate,
   28-day category share, snapshot re-key). Every expectation is HAND-COMPUTED (see comments), clock pinned to
   2026-08-31. Each "break" mutates the source and requires the named check to FAIL. */
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
// Fixture (first synced order 06-01 from filler GF). Tees: GM 07-20:10 08-15:30 | GS 07-20:12 08-15:8 | GN 07-20:3 08-15:1 |
// GD 07-20:30 08-15:5 | GI 08-10:6 08-20:9 (stock 20 all month) | GO 08-12:8 08-13:1 (stock 10 to 08-11, 2, 1, 0 from 08-14) | GF 06-01:10.
// Last 28 days = Aug 4..31, the 28 before = Jul 7..Aug 3.
function checks(src){
  const a=load(src),R=c=>a.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));}');
  const li=(sku,q,day)=>({sku,quantity:q,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'});
  const prod=c=>({_id:c+'-M',sku:c+'-M',product_title:'Art '+c,color:'Blue',size:'M',product_type:'Tees',status:'active',published_at:'2025-01-01T10:00:00+05:00'});
  R('_siProducts='+J(['GM','GS','GN','GD','GI','GO','GF'].map(prod)));
  R('_siLineItems='+J([li('GF-M',10,'2026-06-01'),li('GM-M',10,'2026-07-20'),li('GM-M',30,'2026-08-15'),li('GS-M',12,'2026-07-20'),li('GS-M',8,'2026-08-15'),
    li('GN-M',3,'2026-07-20'),li('GN-M',1,'2026-08-15'),li('GD-M',30,'2026-07-20'),li('GD-M',5,'2026-08-15'),li('GI-M',6,'2026-08-10'),li('GI-M',9,'2026-08-20'),li('GO-M',8,'2026-08-12'),li('GO-M',1,'2026-08-13')]));
  const base=R('_siAxDayNum("2026-08-01")'),ds=n=>R('_siAxDayStr('+n+')');
  const snaps=[];
  for(let k=0;k<31;k++){const dom=k+1,go=dom<=11?10:dom===12?2:dom===13?1:0;
    snaps.push({date:ds(base+k),items:{i:{sku:'GI-M',available:20},o:{sku:'GO-M',available:go}}});}
  R('_siHist=_siAxBuildHistory('+J(snaps)+');_siHistState="ok";_siSnapshot='+J(snaps[30])+';_siPrevSnapshot='+J(snaps[23])+';_siAxCache=null');
  const M=c=>R('_siAxStats(_siAxIndex().map.get("'+c+'"))');
  const o={};
  // momentum: gate is 20+ units in both periods together AND z=(|last-prev|-1)/sqrt(N) > 1.96
  //  GM 30 vs 10: N=40 z=19/6.3246=3.004 Rising | GD 5 vs 30: N=35 z=24/5.916=4.06 Fading
  //  GS 8 vs 12: N=20 z=3/4.472=0.671 Steady | GN 1 vs 3: N=4 < 20 too few | GF: only 06-01 sales, N=0
  const mm=['GM','GD','GS','GN'].map(c=>{const m=M(c);return[m.momWord,m.momNote,m.momUnits];});
  o['momentum Rising 30 vs 10']=mm[0][0]==='Rising'&&mm[0][2]===40;
  o['momentum Fading 5 vs 30']=mm[1][0]==='Fading'&&mm[1][2]===35;
  o['momentum Steady 8 vs 12 (within chance)']=mm[2][0]==='Steady';
  o['momentum: 4 units is too few to tell, no word']=mm[3][0]===null&&mm[3][1]==='too few sales to tell'&&R('_siAxMomText(_siAxStats(_siAxIndex().map.get("GN")))')==='too few sales to tell';
  o['momentum: the exact gate is 20 units']=R('_SI_AX_CFG.momentumMinUnits')===20;
  // category share over the last 28 days: Tees 28d = GM 30 + GS 8 + GN 1 + GD 5 + GI 15 (Aug 10 and Aug 20) + GO 9 + GF 0 = 68
  o['category 28-day units = 68']=M('GM').catUnits28===68;
  o['GM share of Tees, last 28 days = 30/68']=Math.abs(M('GM').catShare28-30/68)<1e-9;
  o['GF sold nothing in 28 days: share 0, not a dash']=M('GF').catShare28===0;
  // headline pace: GO out of stock 17 of 30 measured days (<90% in stock) -> 9/13*7 = 4.846 per in-stock week; GI in stock every day -> plain 15/92*7
  const go=M('GO'),gi=M('GI');
  o['GO headline is the in-stock pace 9/13*7']=go.paceHeadBasis==='in stock'&&Math.abs(go.paceHead-9/13*7)<1e-9;
  o['GI headline is the plain rate 15/92*7']=gi.paceHeadBasis==='counted days'&&Math.abs(gi.paceHead-15/92*7)<1e-9;
  o['GO tile explains that real demand is higher']=/sold out 17 of 30 days/.test(R('(()=>{_siAxModeSel="search";_siAxSel="GO";_siAxQuery="";return _siAxSearchBody();})()'));
  o['missing input shows a dash, never 0']=R('_siAxNum(null)')==='—'&&R('_siAxNum(undefined)')==='—';
  // cover range. GI: pace 3.389381 (7-day windows 9 units, 6 units, 15 units over 30 in-stock days... see shopify-metrics), 20 on hand
  //  point 5.90 weeks; Poisson(15) 8.389..24.74 -> lo 20/(3.389381*24.74/15)=3.58, hi 20/(3.389381*8.389/15)=10.55 -> "3–11 weeks"
  o['GI cover range in words']=R('_siAxCoverText(_siAxStats(_siAxIndex().map.get("GI")))')==='3–11 weeks';
  //  60 on hand: lo 10.73, hi 31.65 (> 26 cap) -> "10–26+ weeks"; 1000 on hand: even lo 178 > 26 -> "more than 26 weeks"
  const txt=n=>R('(()=>{const r=_siAxCoverRange('+n+',3.389381,15);return _siAxCoverText({cover:'+n+'/3.389381,coverRange:r,coverBasis:"x"});})()');
  o['cover top end above 26 shows 26+']=txt(60)==='10–26+ weeks';
  o['cover wholly above 26 is "more than 26 weeks"']=txt(1000)==='more than 26 weeks';
  o['nothing on hand is "none left", not 0 weeks']=R('_siAxCoverText({cover:0})')==='none left';
  o['no cover is a dash']=R('_siAxCoverText({cover:null})')==='—';
  // snapshot re-key: before 18:00 PKT is the previous day's close
  const key=(d,t)=>R('_siAxSnapKey({date:"'+d+'",snapshot_at:'+(t?'"'+t+'"':'null')+'})');
  o['10:00 PKT on Aug 5 is the close of Aug 4']=key('2026-08-05','2026-08-05T10:00:00+05:00')==='2026-08-04';
  o['18:00 PKT on Aug 5 is the close of Aug 5']=key('2026-08-05','2026-08-05T18:00:00+05:00')==='2026-08-05';
  o['22:00 PKT is the same day']=key('2026-08-05','2026-08-05T22:00:00+05:00')==='2026-08-05';
  o['02:00 PKT on Aug 6 (Aug 5 21:00 UTC) is the close of Aug 5']=key('2026-08-06','2026-08-05T21:00:00Z')==='2026-08-05';
  o['a Firestore-style {seconds} timestamp works']=key('2026-08-05',null)==='2026-08-05'&&R('_siAxSnapKey({date:"2026-08-05",snapshot_at:{seconds:'+Date.parse('2026-08-05T05:00:00Z')/1000+'}})')==='2026-08-04';
  o['no snapshot_at: the document date is used']=key('2026-08-05',null)==='2026-08-05';
  const H=R('_siAxBuildHistory('+J([{date:'2026-08-04',snapshot_at:'2026-08-04T22:00:00+05:00',items:{a:{sku:'GX-M',available:7}}},
    {date:'2026-08-05',snapshot_at:'2026-08-05T10:00:00+05:00',items:{a:{sku:'GX-M',available:9}}},
    {date:'2026-08-05',snapshot_at:'2026-08-05T22:00:00+05:00',items:{a:{sku:'GX-M',available:4}}}])+')');
  o['two documents for one closing day keep the earlier one (7, not 9)']=H.byCode.get('GX').get('2026-08-04')===7;
  o['the 22:00 document of Aug 5 is Aug 5']=H.byCode.get('GX').get('2026-08-05')===4&&J(H.dates)===J(['2026-08-04','2026-08-05']);
  return o;
}

// ── Classes v2 ──────────────────────────────────────────────────────────────
// 40 tees P1..P40 (published 2025, stock 20 every day of Aug), P_k sells k units on 08-15: D = k/30 per in-stock day (30 measured days).
// Q: stock 20 to 08-11 then 0, sells 30 on 08-05 -> 10 in-stock days, D = 3.0, in stock 10/30 = 33%.
// Dd: sold 5 on 06-10 only, 20 on hand -> no sale in 28 days, D = 0. GF filler has no stock rows (not in the pool). Pool n = 42, one band (92 days).
// Mid-rank p = (below + 0.5)/42; below(P_k) = k-1 others + Dd = k, so p = (k+0.5)/42.
//  Winner needs p >= .90 -> k >= 37.3 -> 38,39,40 | Solid p >= .50 -> k >= 20.5 -> 21..37 | Steady p >= .20 -> k >= 7.9 -> 8..20 | Slow 1..7.
function classChecks(src,store){
  const a=load(src,store),R=c=>a.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));}');
  const li=(sku,q,day)=>({sku,quantity:q,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'});
  const prod=(c,type)=>({_id:c+'-M',sku:c+'-M',product_title:'Art '+c,color:'Blue',size:'M',product_type:type||'Tees',status:'active',published_at:'2025-01-01T10:00:00+05:00'});
  const codes=[];for(let k=1;k<=40;k++)codes.push('P'+k);
  const prods=codes.map(c=>prod(c)).concat([prod('Q'),prod('DD'),prod('GF'),prod('HH','Hoodies'),prod('CP','Caps')]);
  const items=[li('GF-M',10,'2026-06-01'),li('Q-M',30,'2026-08-05'),li('DD-M',5,'2026-06-10')];
  codes.forEach((c,i)=>items.push(li(c+'-M',i+1,'2026-08-15')));
  R('_siProducts='+J(prods));R('_siLineItems='+J(items));
  const base=R('_siAxDayNum("2026-08-01")'),ds=n=>R('_siAxDayStr('+n+')');
  const snaps=[];
  for(let k=0;k<31;k++){const it={};codes.forEach(c=>{it[c]={sku:c+'-M',available:20};});
    it.Q={sku:'Q-M',available:k<=10?20:0};it.DD={sku:'DD-M',available:20};
    snaps.push({date:ds(base+k),items:it});}
  R('_siHist=_siAxBuildHistory('+J(snaps)+');_siHistState="ok";_siSnapshot='+J(snaps[30])+';_siPrevSnapshot='+J(snaps[23])+';_siAxCache=null');
  const C=c=>R('(()=>{const r=_siAxClassify(_siAxIndex().map.get("'+c+'"));return{c:r.cls,rule:r.rule,near:r.near,rank:r.rank,n:r.n,p:r.p,abs:r.abs,u:r.unverified};})()');
  const A=c=>R('(()=>{const r=_siAxActionOf(_siAxIndex().map.get("'+c+'"));return{k:r.key,label:r.label,text:r.text,lt:r.lead.days,custom:r.lead.custom};})()');
  const o={};
  const cnt={};codes.forEach(c=>{const k=C(c).c;cnt[k]=(cnt[k]||0)+1;});
  o['winners are exactly P38, P39, P40 (p >= 90%)']=['P37','P38','P39','P40'].map(c=>C(c).c).join()==='solid,winner,winner,winner';
  o['solid P21..P37 (17), steady P8..P20 (13), slow P1..P7 (7)']=cnt.winner===3&&cnt.solid===17&&cnt.steady===13&&cnt.slow===7;
  o['boundaries: P21 solid, P20 steady, P8 steady, P7 slow']=C('P21').c==='solid'&&C('P20').c==='steady'&&C('P8').c==='steady'&&C('P7').c==='slow';
  o['P40: rank 2 of 42 (only Q is above), p96, pool is percentile not fixed bands']=(x=>x.rank===2&&x.n===42&&x.p===96&&x.abs===false)(C('P40'));
  o['P40 rule names rank and the boundary: drops to Solid below p90 (1.2/day)']=/rank 2 of 42 \(p96\)/.test(C('P40').rule)&&C('P40').near==='Drops to Solid below p90 (1.2/day).';
  o['P37 is p89, just under the top decile: Solid, and the why says what Winner needs']=C('P37').p===89&&/Winner from p90 \(1\.2\/day\)/.test(C('P37').near);
  o['Q: in stock 33% (under 70%) and demand above the median: Stock-constrained']=C('Q').c==='constrained';
  o['Dd: no sale in 28 days with 20 on hand: Dead stock']=C('DD').c==='dead'&&/no sale in the last \d+ counted days with 20 on hand/.test(C('DD').rule);
  o['GF has no stock rows: Not rated']=C('GF').c==='unrated';
  // the floors: P20 (20 units) is top-decile-blocked only by percentile; give a low-unit top-demand article
  // actions. Tees lead time 21 days = 3 weeks (default, unconfirmed).
  //  P40: pace = 40*0.5^.5/23*7 = 8.61/wk (same windows as shopify-metrics), 20 on hand -> 2.3 weeks < 3 -> Reorder now
  //  P30: 6.46/wk -> 3.1 weeks: not < 3, but < 5 (3 + 2) -> Stock-out risk | P12: 2.58/wk -> 7.7 weeks -> No action
  o['P40 cover 2.3 weeks is under the 3-week default lead time: Reorder now']=(x=>x.k==='reorder'&&x.lt===21&&x.custom===false&&/default lead time, unconfirmed/.test(x.text))(A('P40'));
  o['P30 cover 3.1 weeks: within 2 weeks of the lead time: Stock-out risk']=A('P30').k==='risk';
  o['P12 cover 7.7 weeks: No action']=A('P12').k==='ok';
  o['Q is Reorder now (constrained)']=A('Q').k==='reorder';
  o['Dd: Stop / clear']=A('DD').k==='stuck'&&A('DD').label==='Stop / clear';
  o['P1: 1 unit is Low confidence, never Stop or Mark down: Review: little data']=A('P1').label==='Review: little data';
  // lead time groups and defaults
  const g=c=>R('_siAxLtGroup("'+c+'")');
  o['lead-time groups: tees/tops, hoodies/jackets/denim/bottoms, other']=g('Tees')==='tops'&&g('Tops')==='tops'&&g('Hoodies')==='heavy'&&g('Jackets')==='heavy'&&g('Denim')==='heavy'&&g('Jorts')==='heavy'&&g('Pants')==='heavy'&&g('Caps')==='other'&&g('')==='other';
  o['defaults are 21 / 35 / 28 days']=R('JSON.stringify(_SI_LT_DEFAULT)')==='{"tops":21,"heavy":35,"other":28}';
  o['lead time of a hoodie is 35 and a cap 28, labelled default']=R('(()=>{const t=_siAxLeadTime({category:"Hoodies"}),c=_siAxLeadTime({category:"Caps"});return[t.days,t.custom,c.days,c.custom].join();})()')==='35,false,28,false';
  o._p30=A('P30').k;o._p40=A('P40').k;
  return o;
}
module.exports=async function(){
  const s=suite('shopify-plan5');
  const base=checks(SRC);
  s.section('plan-5 metric fixes (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  const cbase=classChecks(SRC);
  s.section('classes v2 (hand-computed)');
  Object.keys(cbase).filter(k=>k[0]!=='_').forEach(k=>s.ok(k,cbase[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  const brk=(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true));
  };
  brk('momentum gate ignored','if(N<_SI_AX_CFG.momentumMinUnits)o.momNote','if(false)o.momNote',['momentum: 4 units is too few to tell, no word']);
  brk('momentum without significance','if(z>_SI_AX_CFG.momentumZ){','if(z>=0){',['momentum Steady 8 vs 12 (within chance)']);
  brk('category share all-time','o.catShare28=_siAxUnitsSince(a,27).u/c28;','o.catShare28=o.catShare;',['GM share of Tees, last 28 days = 30/68']);
  brk('in-stock headline off','if(o.inRate!=null&&o.inRate<0.90&&o.perInDay!=null){','if(false){',['GO headline is the in-stock pace 9/13*7']);
  brk('in-stock headline always','if(o.inRate!=null&&o.inRate<0.90&&o.perInDay!=null){','if(o.perInDay!=null){',['GI headline is the plain rate 15/92*7']);
  brk('cover not capped','if(r.over)return','if(false)return',['cover wholly above 26 is "more than 26 weeks"']);
  brk('cover top not marked','hi=r.hi>C.coverCapWeeks?C.coverCapWeeks+\'+\':String(Math.ceil(r.hi))','hi=String(Math.ceil(r.hi))',['cover top end above 26 shows 26+']);
  brk('cutoff hour removed','p.getUTCHours()<_SI_AX_CFG.snapshotDayCutoffHour?day-1:day','day',['10:00 PKT on Aug 5 is the close of Aug 4']);
  brk('cutoff at 10','snapshotDayCutoffHour:18','snapshotDayCutoffHour:10',['10:00 PKT on Aug 5 is the close of Aug 4']);
  brk('later snapshot wins','<(_siAxSnapMs(prev.snapshot_at)||0)','>(_siAxSnapMs(prev.snapshot_at)||0)',['two documents for one closing day keep the earlier one (7, not 9)']);
  brk('missing shown as 0','function _siAxNum(v,dec){if(v==null||!isFinite(v))return\'—\'','function _siAxNum(v,dec){if(v==null||!isFinite(v))return\'0\'',['missing input shows a dash, never 0']);
  const cbrk=(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=classChecks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true));
  };
  cbrk('winner percentile 0.5','winnerPct:0.90','winnerPct:0.50',['winners are exactly P38, P39, P40 (p >= 90%)']);
  cbrk('winner without unit floor is invisible here; floor raised to 39 units','winnerUnits:30','winnerUnits:39',['winners are exactly P38, P39, P40 (p >= 90%)']);
  cbrk('constrained ignores in-stock rate','m.inRate!=null&&m.inRate<T.constrainedInStock&&','m.inRate!=null&&',['winners are exactly P38, P39, P40 (p >= 90%)']);
  cbrk('dead needs a sale-free 56 days','m.pace28Days>=T.deadNoSaleDays&&m.units28===0','m.units28===0&&false',['Dd: no sale in 28 days with 20 on hand: Dead stock']);
  cbrk('solid cut at p60','solidPct:0.50','solidPct:0.60',['boundaries: P21 solid, P20 steady, P8 steady, P7 slow','solid P21..P37 (17), steady P8..P20 (13), slow P1..P7 (7)']);
  cbrk('mid-rank without the half','(below+0.5*eq)/n','(below+eq)/n',['P40: rank 2 of 42 (only Q is above), p96, pool is percentile not fixed bands']);
  cbrk('reorder compares cover to 1 week','cov<ltw&&conf.lvl>0','cov<1&&conf.lvl>0',['P40 cover 2.3 weeks is under the 3-week default lead time: Reorder now']);
  cbrk('lead time ignores the group','tops:21,heavy:35,other:28','tops:28,heavy:28,other:28',['defaults are 21 / 35 / 28 days','lead time of a hoodie is 35 and a cap 28, labelled default']);
  cbrk('risk band removed','riskWeeks:2','riskWeeks:0',['P30 cover 3.1 weeks: within 2 weeks of the lead time: Stock-out risk']);
  cbrk('low-confidence slow is marked down','if(conf.lvl===0)return R(\'watch\',\'Review: little data\'','if(false)return R(\'watch\',\'Review: little data\'',['P1: 1 unit is Low confidence, never Stop or Mark down: Review: little data']);
  // editable lead time: a stored setting is used and labelled as the person's own
  const store={};
  const a2=load(SRC,store);a2.run('window._siAxSetLt("tops",7)');
  s.section('editable lead times (per device)');
  s.ok('a stored 7 days is kept and the function reads it',store['groovy-si-leadtimes']==='{"tops":7}'&&a2.run('(()=>{const l=_siAxLeadTime({category:"Tees"});return l.days+","+l.custom;})()')==='7,true');
  a2.run('window._siAxSetLt("tops","")');
  s.ok('an empty value goes back to the default',a2.run('_siAxLeadTime({category:"Tees"}).days')===21);
  a2.run('window._siAxSetLt("tops",0);window._siAxSetLt("tops",999)');
  s.ok('values outside 1..365 are not stored',a2.run('_siAxLeadTime({category:"Tees"}).custom')===false);
  a2.run('window._siAxSetLt("tops",2)');
  s.ok('a custom lead time is used and labelled "your setting"',a2.run('_siAxLtAnyCustom()')===true&&/your setting/.test(a2.run('_siAxLtHtml()')));
  const cs=classChecks(SRC,{'groovy-si-leadtimes':'{"tops":7}'});
  s.ok('default 21 days: P30 is Stock-out risk, P40 Reorder now',cbase._p30==='risk'&&cbase._p40==='reorder');
  s.ok('7-day lead time (1 week): P30 (3.1 weeks of cover, above 1 + 2) needs no action; P40 (2.3 weeks) is only at risk',cs._p30==='ok'&&cs._p40==='risk');
  return s;
};

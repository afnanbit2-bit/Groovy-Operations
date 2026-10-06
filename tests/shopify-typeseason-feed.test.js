/* Inventory Intel ▸ the saved type and season now FEED the analysis (product-data sub-phase 3 of 3). Every expectation is HAND-COMPUTED on the fixture
   below (clock FAKE, today 2026-08-31), the checks DRIVE the real handlers (_siAxFSet, _siAxSearch, _siAxPortfolioBody, _siNaDetect, _siNaPlaybook) and
   each "break" mutates the source and requires the named check to FAIL.
   FIXTURE: eight Tees at Rs 1000, sales 1 Jun..31 Aug (92 days), stock constant all August (always in stock), saved meta:
     code | sold a day | stock | type   | season  | units (92 days)
     A1   | 3          | 30    | top    | winter  | 276
     A2   | 1          | 10    | top    | summer  |  92
     A3   | 2          | 20    | bottom | summer  | 184
     A4   | 1          | 5     | bottom | all     |  92
     A5   | 2          | 40    | other  | (none)  | 184
     A6   | 1          | 10    | (none) | winter  |  92
     A7   | 10 on 10 Jun only | 100 | (none) | (none) | 10  -> dead (nothing since 10 June)
     A8   | 4          | 8     | top    | all     | 368
   Season: winter A1,A6 (2) · summer A2,A3 (2) · all-season A4,A8 (2) · unclassified A5,A7 (2).  Type: top A1,A2,A8 (3) · bottom A3,A4 (2) · other A5 (1) · unclassified A6,A7 (2).
   Totals: 8 articles, 1,298 units (276+92+184+92+184+92+10+368). */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
function load(src){
  const store={};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
const ART=[['A1',3,30,'top','winter'],['A2',1,10,'top','summer'],['A3',2,20,'bottom','summer'],['A4',1,5,'bottom','all'],['A5',2,40,'other',null],['A6',1,10,null,'winter'],['A7',0,100,null,null],['A8',4,8,'top','all']];
function fixture(a){
  const R=c=>a.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));};_siNow=function(){return '+Date.parse('2026-08-31T12:00:00+05:00')+'};');
  const d0=R('_siAxDayNum("2026-06-01")'),last=R('_siAxDayNum("2026-08-31")'),ds=n=>R('_siAxDayStr('+n+')'),jun10=R('_siAxDayNum("2026-06-10")');
  const prods=[],items=[];
  ART.forEach(([c,q,st])=>{
    prods.push({_id:c+'-M',sku:c+'-M',product_title:'Tee '+c,color:'Blue',size:'M',product_type:'Tees',status:'active',published_at:''});
    for(let n=d0;n<=last;n++){const u=c==='A7'?(n===jun10?10:0):q;if(u>0)items.push({sku:c+'-M',quantity:u,price:1000,order_created_at:ds(n)+'T12:00:00+05:00',financial_status:'paid'});}
  });
  const base=R('_siAxDayNum("2026-08-01")'),snaps=[];
  for(let k=0;k<31;k++){const it={};ART.forEach(([c,q,st],i)=>{it['i'+i]={sku:c+'-M',available:st};});snaps.push({date:ds(base+k),items:it});}
  const meta=ART.map(([c,q,st,t,s])=>[c,{code:c,type:t,season:s,ignoreForever:false,ignoredUntil:null}]);
  R('_siProducts='+J(prods)+';_siLineItems='+J(items)+';_siOrders=[];_siWeeklyCloses=[];_siHist=_siAxBuildHistory('+J(snaps)+');_siHistState="ok";_siSnapshot='+J(snaps[30])+';_siPrevSnapshot='+J(snaps[23])+';_siAxCache=null;_siNaMemo=null;_siAxPfMemo=null;_siLoaded=true;_siMetaState="ok";_siMeta=new Map('+J(meta)+');_siIgVer++;_siAxModeSel="overview";_siAxFSeason="";_siAxFType="";');
}
async function checks(src){
  const a=load(src),R=c=>a.run(c),o={};
  fixture(a);
  const ALL='["A1","A2","A3","A4","A5","A6","A7","A8"]';
  const live=()=>R('J=JSON.stringify(_siAxFLive().map(x=>x.code).sort())');
  const set=(k,v)=>R('window._siAxFSet("'+k+'","'+v+'")');
  // ── the filter ──
  o['filter: nothing chosen = all eight live articles']=live()===ALL;
  set('season','winter');
  o['filter: season winter = A1 and A6']=live()==='["A1","A6"]';
  set('season','none');
  o['filter: season Unclassified is its own bucket = A5 and A7 (the ones with no saved season)']=live()==='["A5","A7"]';
  set('season','');set('type','top');
  o['filter: type top = A1, A2, A8']=live()==='["A1","A2","A8"]';
  set('type','none');
  o['filter: type Unclassified = A6 and A7']=live()==='["A6","A7"]';
  set('type','top');set('season','winter');
  o['filter: type top AND season winter = A1 only']=live()==='["A1"]';
  set('type','bogus');
  o['filter: an unknown value is ignored (type reset to Any), season winter stays']=live()==='["A1","A6"]'&&R('_siAxFType')==='';
  R('window._siAxFClear()');
  o['filter: Clear puts everything back']=live()===ALL&&R('_siAxFSeason')===''&&R('_siAxFType')==='';
  // counts under the OTHER filter
  const cnt=()=>JSON.parse(R('J=JSON.stringify(_siAxFCounts())'));
  let c=cnt();
  o['counts: season Any 8, winter 2, summer 2, all-season 2, Unclassified 2']=c.season['']===8&&c.season.winter===2&&c.season.summer===2&&c.season.all===2&&c.season.none===2;
  o['counts: type Any 8, top 3, bottom 2, other 1, Unclassified 2 — and the buckets add up to Any']=c.type['']===8&&c.type.top===3&&c.type.bottom===2&&c.type.other===1&&c.type.none===2&&(c.type.top+c.type.bottom+c.type.other+c.type.none)===8;
  set('season','winter');c=cnt();
  o['counts: with season winter the type chips count inside it (Any 2, top 1, Unclassified 1) and the season chips still show 2/2/2/2']=c.type['']===2&&c.type.top===1&&c.type.none===1&&c.type.bottom===0&&c.season.summer===2&&c.shown===2&&c.total===8;
  const bar=R('_siAxFilterBarHtml()');
  o['bar: names what is hidden ("Showing 2 of 8 … 6 hidden") and offers Clear filters']=/Showing 2 of 8 articles/.test(bar)&&/6 hidden by these filters/.test(bar)&&/Clear filters/.test(bar)&&/Unclassified \(/.test(bar);
  o['bar: pressed state is exposed (aria-pressed true on the chosen Season and the Any Type chip)']=(bar.match(/aria-pressed="true"/g)||[]).length===2;
  R('window._siAxFClear()');
  // Compare ignores the filter
  set('season','winter');R('_siAxModeSel="compare"');
  o['compare: the filter is not applied and the bar is not shown (articles are chosen by name)']=live()===ALL&&R('_siAxFilterBarHtml()')==='';
  R('_siAxModeSel="overview"');
  // Search
  const sr=q=>JSON.parse(R('J=JSON.stringify((()=>{const r=_siAxSearch("'+q+'",20);return{h:r.hits.map(x=>x.code).sort(),t:r.total,hid:r.hidden};})())'));
  let r=sr('tee');
  o['search: season winter narrows "tee" to A1, A6 and counts 6 more that are hidden']=r.h.join()==='A1,A6'&&r.t===2&&r.hid===6;
  R('_siAxModeSel="search";_siAxQuery="tee"');
  const rh=R('_siAxResultsHtml()');
  o['search: the results line says how many are hidden by the Type/Season filter']=/6 more match but are hidden by the Type\/Season filter/.test(rh);
  R('window._siAxFClear()');
  r=sr('tee');
  o['search: no filter = all 8, nothing hidden']=r.t===8&&r.hid===0;
  R('_siAxModeSel="overview";_siAxQuery=""');
  // Overview rows
  set('season','winter');
  o['overview: rows follow the filter (A1, A6 only)']=R('J=JSON.stringify(_siAxOvRows().map(x=>x.a.code).sort())')==='["A1","A6"]';
  // Portfolio inputs
  o['portfolio: inputs follow the filter (2 articles, 368 units)']=R('_siAxPf().tot.articles')===2&&R('_siAxPf().tot.units')===368;
  R('window._siAxFClear()');
  o['overview: no filter = 8 rows']=R('_siAxOvRows().length')===8;
  const pf=JSON.parse(R('J=JSON.stringify((()=>{const p=_siAxPf();return{n:p.tot.articles,units:p.tot.units,feed:p.feed,mix:p.mix.map(x=>[x.k,x.n]),cats:p.cats.map(x=>[x.k,x.n,x.units])};})())'));
  o['portfolio: unfiltered, 8 articles and 1,298 units']=pf.n===8&&pf.units===1298;
  const T=k=>pf.feed.types.find(x=>x.k===k),S=k=>pf.feed.seasons.find(x=>x.k===k);
  o['rollup by type: top = 3 articles, 736 units, Rs 736,000, stock Rs 48,000 (48 units)']=T('top').n===3&&T('top').units===736&&T('top').rev===736000&&T('top').stockUnits===48&&T('top').stockVal===48000;
  o['rollup by type: sell-through top = 736 / (736 + 48) = 0.93878; bottom = 276 / (276 + 25) = 0.91694']=Math.abs(T('top').sellThru-736/784)<1e-9&&Math.abs(T('bottom').sellThru-276/301)<1e-9;
  o['rollup by type: in-stock days average 1 (always in stock) for top']=Math.abs(T('top').inRate-1)<1e-9;
  o['rollup by type: Unclassified = A6 + A7: 2 articles, 102 units, 1 dead (A7), cash tied up Rs 100,000 (100 units at Rs 1000)']=T('none').n===2&&T('none').units===102&&T('none').dead===1&&T('none').tied===100000;
  o['rollup by saved season: winter = A1+A6 (368 units), summer = A2+A3 (276), all-season = A4+A8 (460), Unclassified = A5+A7 (194)']=S('winter').units===368&&S('summer').units===276&&S('all').units===460&&S('none').units===194;
  const sum=(arr,f)=>arr.reduce((t,x)=>t+x[f],0);
  o['rollups conserve: every article is in exactly one row of each table (articles 8, units 1,298, dead equals the class mix)']=sum(pf.feed.types,'n')===8&&sum(pf.feed.seasons,'n')===8&&sum(pf.feed.types,'units')===1298&&sum(pf.feed.seasons,'units')===1298&&sum(pf.feed.types,'dead')===pf.mix.find(x=>x[0]==='dead')[1]&&sum(pf.feed.seasons,'dead')===sum(pf.feed.types,'dead')&&sum(pf.feed.types,'slow')===pf.mix.find(x=>x[0]==='slow')[1];
  o['rollups use the Category grouping: the category table and the type table agree on totals (8 articles, 1,298 units)']=pf.cats.reduce((t,x)=>t+x[1],0)===8&&pf.cats.reduce((t,x)=>t+x[2],0)===1298;
  const body=R('_siAxPortfolioBody()');
  o['portfolio body: two cards — "By selling window (order month)" and "By saved type and saved season" — so the two cannot be confused']=/By selling window \(order month\)/.test(body)&&/By saved type and saved season/.test(body)&&/By saved type/.test(body)&&/By saved season/.test(body)&&/<th>Selling window<\/th>/.test(body)&&!/<div class="card-title">Season<\/div>/.test(body);
  o['portfolio body: the old table says whatever season was saved does not change it']=/whatever season staff saved/.test(body);
  o['portfolio body: no NaN, no undefined, no colour literal']=!/NaN|undefined/.test(body)&&!/#[0-9a-fA-F]{3,6}\b/.test(body.replace(/&#\d+;/g,''));
  // ── unavailable ──
  R('_siMetaState="error";_siIgVer++;_siAxFSeason="winter";_siAxFType="top";_siAxPfMemo=null;');
  o['unavailable: no filter is applied even if one was set — all 8 articles stay (nothing hidden, nothing zeroed)']=live()===ALL&&sr('tee').t===8&&R('_siAxOvRows().length')===8;
  const barU=R('_siAxFilterBarHtml()');
  o['unavailable: the bar says "Type/season unavailable", offers Retry and shows no chips']=/Type\/season unavailable/.test(barU)&&/_siMetaRetry/.test(barU)&&!/aria-pressed/.test(barU);
  const pfU=JSON.parse(R('J=JSON.stringify((()=>{const p=_siAxPf();return{n:p.tot.articles,feed:p.feed};})())'));
  const bodyU=R('_siAxPortfolioBody()');
  o['unavailable: the Portfolio keeps all 8 articles, has no rollup (feed null) and says "Type/season unavailable"']=pfU.n===8&&pfU.feed===null&&/Type\/season unavailable/.test(bodyU)&&!/<td>Unclassified<\/td>/.test(bodyU);
  R('_siMetaState="loading";_siAxPfMemo=null;');
  o['loading: the bar says it is reading, the filter is off']=/Reading the saved types and seasons/.test(R('_siAxFilterBarHtml()'))&&live()===ALL;
  R('_siMetaState="ok";_siAxFSeason="";_siAxFType="";_siIgVer++;_siAxPfMemo=null;');
  // ── Needs Attention: the saved season decides the wait ──
  const inf=(cat,code,day)=>JSON.parse(R('J=JSON.stringify(_siNaSeasonInfo({code:"'+code+'",category:"'+cat+'",skus:new Set()},"'+day+'"))'));
  const wait=(code,day)=>inf('Tees',code,day).wait;
  o['season window, winter (A1): waits 30 Sep, judged 1 Oct and 28 Feb, waits again 1 Mar']=wait('A1','2026-09-30')===true&&wait('A1','2026-10-01')===false&&wait('A1','2027-02-28')===false&&wait('A1','2027-03-01')===true;
  o['season window, summer (A2): judged 1 Mar and 31 Aug, waits 1 Sep and 28 Feb']=wait('A2','2026-03-01')===false&&wait('A2','2026-08-31')===false&&wait('A2','2026-09-01')===true&&wait('A2','2027-02-28')===true;
  o['season window, all-season (A4): never waits, on any date']=['2026-01-15','2026-04-15','2026-07-15','2026-10-15','2026-12-31'].every(d=>wait('A4',d)===false);
  o['saved season is reported as state "saved" with the season']=inf('Tees','A1','2026-10-01').state==='saved'&&inf('Tees','A1','2026-10-01').season==='winter';
  o['no saved season (A5): state "unknown", the LEGACY rule decides — a hoodie waits on 1 Oct, a tee does not, nobody waits on 1 Dec']=inf('Hoodies','A5','2026-10-01').state==='unknown'&&inf('Hoodies','A5','2026-10-01').wait===true&&inf('Tees','A5','2026-10-01').wait===false&&inf('Hoodies','A5','2026-12-01').wait===false;
  R('_siMetaState="error"');
  o['list unreadable: state "unavailable", the legacy rule decides (the saved season of A1 is not used)']=inf('Hoodies','A1','2026-10-01').state==='unavailable'&&inf('Hoodies','A1','2026-10-01').wait===true&&inf('Tees','A1','2026-09-30').wait===false;
  R('_siMetaState="ok"');
  // detection through the real detector, synthetic row
  R(`var __row=function(o){o=o||{};const a=Object.assign({code:"X",name:"X",color:"",category:"Tees",hasStock:true,onHand:200,skus:new Set()},o.a||{});
    const m={coverDays:30,cover:30/7,units28:0,perInDay:2,inRate:1,measured:30,outDays:0,momWord:null,momentum:null,momUnits:null,days:90,units:100,asp:1000,sizeRows:[],risk:[],voidRate:0,voided:0,pace28Days:28,coverRange:null,coverBasis:"x",paceHead:14,pace28:14};
    return{a,m,c:{cls:"dead",label:"Dead stock"},act:{key:"ok",text:""},lt:{days:21,source:"default",text:"default lead time, unconfirmed"},conf:{lvl:2,level:"high",name:"High",why:["100 units over 90 counted days"],caps:[]}};};`);
  const ctxS=day=>'{today:"'+day+'",returnsSynced:false,season:a=>_siNaSeasonInfo(a,"'+day+'"),winter:a=>_siNaWinter(a,"'+day+'")}';
  const det=(code,day,cat)=>JSON.parse(R('J=JSON.stringify((()=>{const i=_siNaDetect(__row({a:{code:"'+code+'",category:"'+(cat||'Tees')+'"}}),'+ctxS(day)+')[0];return i?{b:i.band,s:i.seasonal,conf:i.conf,st:i.n.seasonState,why:i.n.confWhy}:null;})())'));
  let d=det('A1','2026-10-01');
  o['detect: a saved winter article that is dead on 1 Oct is JUDGED (act, not a seasonal wait) — it is inside its window']=d.b==='act'&&d.s===false&&d.st==='saved'&&d.conf==='high';
  d=det('A1','2026-09-30');
  o['detect: the same article on 30 Sep is a seasonal wait (watch)']=d.b==='watch'&&d.s===true;
  d=det('A2','2026-10-01');
  o['detect: a saved summer article dead on 1 Oct waits (out of season: watch, seasonal)']=d.b==='watch'&&d.s===true;
  d=det('A4','2026-07-15');
  o['detect: an all-season article is always judged (act on 15 Jul)']=d.b==='act'&&d.s===false;
  d=det('A5','2026-10-01','Hoodies');
  o['detect: unknown season, a hoodie in the legacy window waits AND the confidence drops one step (high to medium) with "season unknown"']=d.b==='watch'&&d.s===true&&d.st==='unknown'&&d.conf==='medium'&&d.why.indexOf('season unknown')>=0;
  d=det('A5','2026-08-31','Hoodies');
  o['detect: unknown season outside the legacy window changes nothing about the answer (act) and keeps its confidence']=d.b==='act'&&d.conf==='high';
  R('_siMetaState="error"');d=det('A1','2026-10-01','Hoodies');R('_siMetaState="ok"');
  o['detect: list unreadable falls back to the legacy answer and says "unavailable"']=d.b==='watch'&&d.st==='unavailable'&&d.why.indexOf('season unavailable')>=0;
  // playbook text
  const pbk=(code,day,cat)=>JSON.parse(R('J=JSON.stringify((()=>{return _siNaPlaybook(_siNaDetect(__row({a:{code:"'+code+'",category:"'+(cat||'Tees')+'"}}),'+ctxS(day)+')[0]);})())'));
  let p=pbk('A1','2026-09-30');
  o['playbook: a saved winter article off season says "outside its season" and when it opens (October), not "15 November"']=/outside its season/.test(p.situation+p.actions.map(x=>x.text).join(' '))&&p.actions.some(x=>/season opens \(October\)/.test(x.text))&&!p.actions.some(x=>/15 November/.test(x.text))&&/Season: saved as winter/.test(p.confidence);
  p=pbk('A2','2026-10-01');
  o['playbook: a saved summer article says its season opens in March']=p.actions.some(x=>/season opens \(March\)/.test(x.text));
  p=pbk('A5','2026-10-01','Hoodies');
  o['playbook: unknown season keeps the 15 November text and says "Season unknown"']=p.actions.some(x=>/15 November/.test(x.text))&&/Season unknown/.test(p.confidence);
  R('_siMetaState="error"');p=pbk('A1','2026-10-01','Hoodies');R('_siMetaState="ok"');
  o['playbook: list unreadable says "Type and season unavailable"']=/Type and season unavailable/.test(p.confidence);
  // _siNaState stays the single source: not moved by the Explorer filter
  R('window._siAxFSet("season","winter")');
  R('_siNaMemo=null');const n1=R('J=JSON.stringify(_siNaState().counts)');R('window._siAxFClear()');R('_siNaMemo=null');const n2=R('J=JSON.stringify(_siNaState().counts)');
  o['Needs Attention counts do not move with the Explorer filter (one source, _siNaState)']=n1===n2;
  return o;
}
module.exports=async function(){
  const s=suite('shopify-typeseason-feed');
  const base=await checks(SRC);
  s.section('Type & season feed: the filter, the Portfolio rollups, the seasonal wait, the unreadable list (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const F=[].concat(from),Tt=[].concat(to);
    if(F.some(f=>SRC.split(f).length<2)){s.ok('break target exists: '+label,false);return;}
    let src2=SRC;F.forEach((f,i)=>{src2=src2.split(f).join(Tt[i]);});
    let r;try{r=await checks(src2);}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f.slice(0,60)+'"',r[f]!==true);});
  };
  const K=k=>Object.keys(base).filter(x=>x.indexOf(k)===0);
  await brk('filter ignores season',"if(!skipSeason&&_siAxFSeason&&_siFdBucket(a.code,'season')!==_siAxFSeason)return false;",'',K('filter: season').concat(K('filter: type top AND')));
  await brk('filter ignores type',"if(!skipType&&_siAxFType&&_siFdBucket(a.code,'type')!==_siAxFType)return false;",'',K('filter: type'));
  await brk('Unclassified dropped (no bucket)',"return _siMetaOf(code)[field]||'none';","return _siMetaOf(code)[field]||'zzz-dropped';",K('filter: season Unclassified').concat(K('filter: type Unclassified')));
  await brk('filter applied when the list is unreadable',['function _siAxFOn(){return _siFeedOk()&&',"function _siAxFPass(a,skipSeason,skipType){\n  if(!_siFeedOk())return true;"],['function _siAxFOn(){return true&&',"function _siAxFPass(a,skipSeason,skipType){\n  if(false)return true;"],K('unavailable: no filter'));
  await brk('filter applied in Compare',"_siAxModeSel!=='compare'&&!!(_siAxFSeason","!!(_siAxFSeason",K('compare:'));
  await brk('counts not faceted (type chips ignore the season filter)','if(_siAxFPass(a,false,true)){type','if(true){type',K('counts: with season winter'));
  await brk('hidden count not shown','const hid=r.hidden>0?','const hid=false?',K('search: the results line'));
  await brk('search ignores the filter','const on=_siAxFOn(),out=on?all.filter(a=>_siAxFPass(a)):all;','const on=false,out=all;',K('search: season winter'));
  await brk('overview ignores the filter','return _siAxFLive().filter(a=>(a.units>0||a.hasStock)&&(!_siAxOvCat','return _siAxLive().filter(a=>(a.units>0||a.hasStock)&&(!_siAxOvCat',K('overview: rows follow'));
  await brk('portfolio ignores the filter','const rows=_siAxFLive().filter(a=>a.units>0||a.hasStock).map(a=>({a,m:_siAxStats(a)','const rows=_siAxLive().filter(a=>a.units>0||a.hasStock).map(a=>({a,m:_siAxStats(a)',K('portfolio: inputs follow'));
  await brk('sell-through wrong (no stock in denominator)','x.sellThru=(x.stU+x.stockUnits)>0?x.stU/(x.stU+x.stockUnits):null;','x.sellThru=x.stU>0?1:null;',K('rollup by type: sell-through'));
  await brk('cash tied up counts every bucket',"if(b==='dead'||b==='slow'||b==='over'){","if(true){",K('rollup by type: Unclassified'));
  await brk('dead count dropped',"if(r.cls==='dead')x.dead++;",'',K('rollup by type: Unclassified').concat(K('rollups conserve')));
  await brk('rollups present when unreadable',["opts.metaOf?(opts.metaOf(a.code).type||'none'):null","metaOf:_siFeedOk()?_siMetaOf:null"],["(opts.metaOf||_siMetaOf)(a.code).type||'none'","metaOf:_siMetaOf"],K('unavailable: the Portfolio'));
  await brk('rollups lose the Unclassified row',"{k:'none',l:'Unclassified'}],'mtype')","{k:'zz',l:'Zz'}],'mtype')",K('rollup by type: Unclassified').concat(K('rollups conserve')));
  await brk('old table still called Season','By selling window (order month)','Season',K('portfolio body: two cards'));
  await brk('winter window starts in November','function _siAxIsWinterMonth(m){return _SI_AX_WINTER_MONTHS.indexOf(+m)>=0;}','function _siAxIsWinterMonth(m){return [11,12,1,2].indexOf(+m)>=0;}',K('season window, winter').concat(K('detect: a saved winter')));
  await brk('summer window to September','const _SI_NA_SUMMER_MONTHS=[3,4,5,6,7,8];','const _SI_NA_SUMMER_MONTHS=[3,4,5,6,7,8,9];',K('season window, summer'));
  await brk('all-season waits',"if(season==='all')return true;","if(season==='all')return false;",K('season window, all-season').concat(K('detect: an all-season')));
  await brk('saved season ignored (legacy always)','wait:!_siNaInWindow(s,today),legacy:false','wait:_siNaWinter(a,today),legacy:false',K('season window, winter').concat(K('detect: the same article on 30 Sep')));
  await brk('unreadable list still uses saved season',"if(_siMetaState!=='ok')return{state:'unavailable'","if(false)return{state:'unavailable'",K('list unreadable'));
  await brk('no confidence drop on unknown',"x.conf=lv[i];x.n.confName=names[i];","",K('detect: unknown season, a hoodie'));
  await brk('confidence note dropped',"(sinf.state==='unknown'?'unknown':'unavailable')","''",K('detect: unknown season, a hoodie').concat(K('detect: list unreadable')));
  await brk('dead playbook ignores the saved season',"sSaved?'It is '+sLabel+' stock and outside its season: check the listing is live and priced right, then look again when its season opens ('+sOpens+').':","false?'':",K('playbook: a saved winter'));
  await brk('season unknown note dropped',"n.seasonState==='unknown'?'Season unknown:","n.seasonState==='unknown'?'':",K('playbook: unknown season'));
  await brk('unavailable note dropped','Type and season unavailable: the saved list','The saved list',K('playbook: list unreadable'));
  await brk('Needs Attention reads the Explorer filter','const rows=_siAxLive().filter(a=>a.units>0||a.hasStock).map(_siNaRow);','const rows=_siAxFLive().filter(a=>a.units>0||a.hasStock).map(_siNaRow);',K('Needs Attention counts do not move'));
  s.ok('breaks run: '+broken,broken>=30);
  return s;
};
module.exports._checks=checks;

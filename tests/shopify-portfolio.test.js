/* Inventory Intel ▸ Article Explorer — the Portfolio sub-view. Every expectation is HAND-COMPUTED (comments below), clock pinned to
   2026-09-15. Part 1 drives the pure core _siAxPfCalc with built rows; part 2 drives the real handlers over a small real fixture.
   Each "break" mutates the source and requires the named check to FAIL. No Firestore read is allowed. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
function load(src,counter){
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
      getDocs:()=>{counter.n++;return Promise.resolve({forEach(){}});},getDoc:()=>{counter.n++;return Promise.resolve({exists:()=>false});}}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
const near=(x,y,e)=>Math.abs(x-y)<(e||0.0005);
// Six built articles (no classifier involved). daily = day -> {u units, r revenue}. W = winter month (Oct-Feb), S = other.
//  A Tees   winner     daily 10-05 40/40000 W, 02-28 20/20000 W, 03-01 40/40000 S   units 100 rev 100000  on hand 50 asp 1000 -> 50000, cover 5,  pace 10
//  B Tees   solid      daily 09-30 25/12500 S, 10-01 25/12500 W                       units 50  rev 25000   on hand 100 asp 500  -> 50000, cover 30, pace 5   (exactly half winter: NOT a winter seller)
//  C Hoodie slow       daily 01-31 30/60000 W                                         units 30  rev 60000   on hand 60  asp 2000 -> 120000, cover 40, pace 1.5
//  D Hoodie dead       daily 12-31 10/20000 W                                         units 10  rev 20000   on hand 20  asp 2000 -> 40000, no cover, no pace
//  E Caps   constr.    daily 08-31 10/5000 S                                          units 10  rev 5000    on hand 0   -> value 0 (a real zero), cover 0, pace 5, units28 5
//  F Caps   early      no sales                                                       on hand 8, NO price -> value missing (null), not 0
// Totals: units 200, revenue 210000, on hand 238, stock value 260000, 1 article without a price.
function rows(){
  const D=(o)=>{const m=new Map();Object.keys(o).forEach(k=>m.set(k,{u:o[k][0],r:o[k][1]}));return m;};
  const mk=(code,cat,units,rev,daily,hasStock,onHand,asp,cover,pace,cls,u28)=>({a:{code,name:code,category:cat,units,rev,hasPrice:rev>0,daily:D(daily),hasStock,onHand,skus:new Set([code])},
    m:{asp,cover,paceHead:pace,units28:u28==null?0:u28},c:{cls}});
  return[
    mk('A','Tees',100,100000,{'2026-10-05':[40,40000],'2026-02-28':[20,20000],'2026-03-01':[40,40000]},true,50,1000,5,10,'winner'),
    mk('B','Tees',50,25000,{'2026-09-30':[25,12500],'2026-10-01':[25,12500]},true,100,500,30,5,'solid'),
    mk('C','Hoodies',30,60000,{'2026-01-31':[30,60000]},true,60,2000,40,1.5,'slow'),
    mk('D','Hoodies',10,20000,{'2026-12-31':[10,20000]},true,20,2000,null,null,'dead'),
    mk('E','Caps',10,5000,{'2026-08-31':[10,5000]},true,0,500,0,5,'constrained',5),
    mk('F','Caps',0,0,{},true,8,null,null,null,'early')];
}
const lostStub=a=>a.code==='A'?{lost:{lo:10,hi:20,mid:15},notEstimated:1,price:1000,ongoing:null}:(a.code==='B'?{lost:null,notEstimated:2,ongoing:null,price:500}:null);
function checks(src){
  const counter={n:0},app=load(src,counter),R=c=>app.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-09-15")+(off||0));}');
  R('globalThis.__rows=null');
  const pf=R('(()=>{const rs=('+rows.toString()+')();const lost='+lostStub.toString()+';const dm=new Map();return _siAxPfCalc(rs,{today:"2026-09-15",lost,demand:dm});})()');
  const o={};
  const mix={};pf.mix.forEach(x=>mix[x.k]=x);
  o['totals: 6 articles, 200 units, revenue 210000, on hand 238, stock value 260000']=pf.tot.articles===6&&pf.tot.units===200&&pf.tot.rev===210000&&pf.tot.stockUnits===238&&pf.tot.stockVal===260000;
  o['an article with stock and no price is counted (1) and not valued, never read as 0']=pf.tot.noPrice===1&&pf.rows.find(r=>r.code==='F').val===null&&pf.rows.find(r=>r.code==='E').val===0;
  o['class mix counts: winner 1, solid 1, steady 0, constrained 1, slow 1, dead 1, early 1, unrated 0']=J(pf.mix.map(x=>x.n))===J([1,1,0,1,1,1,1,0]);
  o['% of units: winner 50%, solid 25%, slow 15%, dead 5%, constrained 5%, early 0%']=near(mix.winner.pU,.5)&&near(mix.solid.pU,.25)&&near(mix.slow.pU,.15)&&near(mix.dead.pU,.05)&&near(mix.constrained.pU,.05)&&mix.early.pU===0;
  o['% of revenue: winner 100/210 = 47.62%, slow 60/210 = 28.57%']=near(mix.winner.pR,100/210)&&near(mix.slow.pR,60/210);
  o['% of articles: each class with one article is 1/6']=near(mix.slow.pN,1/6)&&mix.steady.pN===0;
  o['the class mix shares of units sum to 100%']=near(pf.mix.reduce((s,x)=>s+x.pU,0),1,1e-9);
  const sea={};pf.seasons.forEach(x=>sea[x.k]=x);
  // winter units: A 40+20, B 25 (10-01), C 30, D 10 = 125; revenue 40000+20000+12500+60000+20000 = 152500. Summer: A 40, B 25, E 10 = 75; 40000+12500+5000 = 57500
  o['season of sale: winter 125 units / 152500 (Oct 1 and Feb 28 are winter)']=sea.winter.units===125&&sea.winter.rev===152500;
  o['season of sale: other months 75 units / 57500 (Sep 30 and Mar 1 are not winter)']=sea.summer.units===75&&sea.summer.rev===57500;
  o['winter + other months = every counted unit']=sea.winter.units+sea.summer.units===pf.tot.units;
  o['an article whose units are exactly half winter (B) is not a winter seller; A, C, D are']=J(pf.rows.filter(r=>r.season==='winter').map(r=>r.code))===J(['A','C','D'])&&pf.rows.find(r=>r.code==='B').season==='summer'&&pf.rows.find(r=>r.code==='F').season===null;
  // winter-selling articles A, C, D: stock 50000+120000+40000 = 210000; cover = (50+60)/(10+1.5) = 9.565 (D has no pace)
  o['stock follows the article: winter sellers hold 210000, cover 9.57 weeks (an article without a pace is left out of the cover)']=sea.winter.stockVal===210000&&near(sea.winter.cover,110/11.5,0.001)&&sea.winter.n===3;
  o['other-season sellers (B, E): stock 50000, cover (100+0)/(5+5) = 10 weeks']=sea.summer.stockVal===50000&&near(sea.summer.cover,10)&&sea.summer.n===2;
  o['no counted sales: units are "—" (null) and the article is counted (1)']=sea.none.units===null&&sea.none.rev===null&&sea.none.n===1;
  const cat={};pf.cats.forEach(x=>cat[x.k]=x);
  o['categories: Tees 2 articles / 150 units / 125000 / value 100000 / cover 150/15 = 10']=cat.Tees.n===2&&cat.Tees.units===150&&cat.Tees.rev===125000&&cat.Tees.stockVal===100000&&near(cat.Tees.cover,10);
  o['categories: Hoodies 40 units / 80000 / value 160000 / cover 60/1.5 = 40 / winter share 100%']=cat.Hoodies.units===40&&cat.Hoodies.rev===80000&&cat.Hoodies.stockVal===160000&&near(cat.Hoodies.cover,40)&&near(cat.Hoodies.wShare,1);
  o['categories: Caps value 0 with one unpriced article flagged, cover 0 (out of stock)']=cat.Caps.stockVal===0&&cat.Caps.valMissing===1&&cat.Caps.cover===0;
  o['Tees winter share is (60+25)/150 = 56.7%']=near(cat.Tees.wShare,85/150,0.0001);
  o['categories are ordered by units (Tees, Hoodies, Caps) and shares of units sum to 100%']=J(pf.cats.map(x=>x.k))===J(['Tees','Hoodies','Caps'])&&near(pf.cats.reduce((s,x)=>s+x.pU,0),1,1e-9);
  const c=pf.conc;
  // units 100, 50, 30, 10, 10 of 200 (ties by code: D before E): cumulative 100, 150, 180, 190, 200
  o['Pareto units: 1 article makes 50% (100 of 200 is exactly half), 3 make 80%']=c.reachU50===1&&c.reachU80===3;
  // revenue sorted A 100000, C 60000, B 25000, D 20000, E 5000 of 210000: 160000 reaches 50%, 185000 reaches 80%
  o['Pareto revenue: 2 articles make 50% (100000 is under 105000), 3 make 80%']=c.reachR50===2&&c.reachR80===3&&c.nRev===5;
  o['top 5 share of units is 100% (only five sell); the first rows are A, B, C, D, E with cumulative 50%, 75%, 90%']=near(c.topU[0].share,1)&&J(c.top.map(x=>x.r.code))===J(['A','B','C','D','E'])&&near(c.top[0].cum,.5)&&near(c.top[1].cum,.75)&&near(c.top[2].cum,.9);
  const cs={};pf.cash.forEach(x=>cs[x.k]=x);
  o['cash: winners 1 article / 50 units / 50000, over-stocked (B, solid, 30 weeks) 1 / 100 / 50000']=cs.winner.n===1&&cs.winner.stockUnits===50&&cs.winner.val===50000&&cs.over.n===1&&cs.over.stockUnits===100&&cs.over.val===50000;
  o['cash: slow 120000, dead 40000, everything else (E, F) 8 units and value 0 with 1 unpriced']=cs.slow.val===120000&&cs.dead.val===40000&&cs.other.n===2&&cs.other.stockUnits===8&&cs.other.val===0&&cs.other.valMissing===1;
  o['cash buckets add up to the whole stock value (260000) and shares sum to 100%']=cs.winner.val+cs.over.val+cs.slow.val+cs.dead.val+cs.other.val===pf.tot.stockVal&&near(pf.cash.reduce((s,x)=>s+x.pV,0),1,1e-9);
  o['stuck cash = dead + slow + over-stocked = 210000 (80.8%); winners hold 50000 (19.2%)']=pf.stuck.val===210000&&near(pf.stuck.share,210/260,1e-9)&&pf.stuck.winVal===50000&&near(pf.stuck.winShare,50/260,1e-9);
  o['stock-out exposure: only A has an estimate (10-20 units, mid 15, Rs 15000); B has none and counts 2 + 1 stretches unestimated']=pf.lost.articles===1&&pf.lost.lo===10&&pf.lost.hi===20&&pf.lost.mid===15&&pf.lost.rs===15000&&pf.lost.notEstimated===3&&pf.lost.withHistory===2;
  o['one selling article is out of stock now (E)']=pf.lost.outNow===1;
  o['sort by cover: 0 weeks (out of stock) sorts above a missing figure, which is last']=J(R('(()=>{const rs=('+rows.toString()+')();return _siAxPfSorted(_siAxPfCalc(rs,{today:"2026-09-15"}).rows,"cover").map(r=>r.code);})()'))===J(['C','B','A','E','D','F']);
  o['without stock history there is no exposure object (null), not zeros']=R('(()=>{const rs=('+rows.toString()+')();return _siAxPfCalc(rs,{today:"2026-09-15",demand:new Map()}).lost;})()')===null;
  o['the readout: counts, Pareto, stock value at selling price, share, winners, unpriced, lost sales']=pf.readout==='6 articles are in the range; 5 are classed, and of those 2 are Winner or Solid and 2 are Slow or Dead, with 1 held back by stock-outs. 1 article makes half of the units and 3 make 80% (of 5 selling). Stock is worth PKR 260,000 at selling price (not cost); PKR 210,000 (80.8%) is in dead, slow or over-stocked articles — a heavy share — against PKR 50,000 (19.2%) in winners. 1 article with stock has no sale price yet and is left out of that value. Stock-outs in the last 90 days cost an estimated 10 to 20 units across 1 article (an estimate from each article’s in-stock pace, not a count).';
  o['an empty range says so instead of dividing by zero']=/nothing to summarise/.test(R('_siAxPfCalc([],{today:"2026-09-15"}).readout'));
  o['empty range: no NaN or undefined anywhere in the result']=!/NaN|undefined/.test(R('JSON.stringify(_siAxPfCalc([],{today:"2026-09-15"}).mix)+JSON.stringify(_siAxPfCalc([],{today:"2026-09-15"}).cash)'));

  // ── part 2: the real handlers over a real small fixture ──
  const li=(sku,q,day,price)=>({sku,quantity:q,price:price||1000,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'});
  const prod=(code,title,cat)=>['S','M'].map(sz=>({_id:code+'-'+sz,sku:code+'-'+sz,product_title:title,color:'Blue',size:sz,product_type:cat,status:'active',published_at:'2025-01-01T10:00:00+05:00'}));
  const P=[].concat(prod('GA','Alpha Tee','Tees'),prod('GB','Beta Hood <img src=x onerror=alert(1)>','Hoodies'),prod('GC','Gamma Tee','Tees'));
  const L=[li('GA-S',20,'2026-07-01'),li('GA-M',20,'2026-09-01'),li('GB-S',10,'2026-01-15',2000),li('GB-M',10,'2026-02-10',2000)];
  const it=(a,b,c,d,e,f)=>({a:{sku:'GA-S',available:a},b:{sku:'GA-M',available:b},c:{sku:'GB-S',available:c},d:{sku:'GB-M',available:d},e:{sku:'GC-S',available:e},f:{sku:'GC-M',available:f}});
  const docs=[{date:'2026-09-14',items:it(10,10,5,5,3,3)},{date:'2026-09-15',items:it(10,10,5,5,3,3)}];
  R('_siProducts='+J(P)+';_siLineItems='+J(L)+';_siSnapshot='+J({date:'2026-09-15',items:it(10,10,5,5,3,3)})+';_siPrevSnapshot=null;_siHist=_siAxBuildHistory('+J(docs)+');_siHistState="ok";_siAxCache=null;_siAxPfMemo=null');
  R('_siAxClassify=function(a){return{cls:a.code==="GA"?"winner":(a.code==="GB"?"dead":"early"),label:"x",rule:"",near:""};}');
  const p2=R('(()=>{const p=_siAxPf();return{n:p.rows.length,codes:p.rows.map(r=>r.code).sort(),units:p.tot.units,seasons:p.rows.map(r=>r.code+":"+r.season).sort()};})()');
  o['real fixture: three articles, 60 units; GA sells in summer months, GB in winter months, GC has no sales']=p2.n===3&&p2.units===60&&J(p2.seasons)===J(['GA:summer','GB:winter','GC:null']);
  const cnt=(cls,cat,season)=>R('(()=>{_siAxPfCls='+J(cls)+';_siAxPfCat='+J(cat)+';_siAxPfSeason='+J(season)+';const n=_siAxPfFiltered(_siAxPf()).length;_siAxPfCls="";_siAxPfCat="";_siAxPfSeason="";return n;})()');
  o['filter by class: dead 1, winner 1, early 1']=cnt('dead','','')===1&&cnt('winner','','')===1&&cnt('early','','')===1&&cnt('slow','','')===0;
  o['filter by category: Tees 2, Hoodies 1']=cnt('','Tees','')===2&&cnt('','Hoodies','')===1;
  o['filter by season: winter 1, summer 1, no sales 1']=cnt('','','winter')===1&&cnt('','','summer')===1&&cnt('','','none')===1;
  o['filters combine (Tees and no sales = GC only)']=cnt('','Tees','none')===1&&cnt('winner','Hoodies','')===0;
  R('window._siAxPfSet("cls","dead")');
  o['the handler sets a class filter']=R('_siAxPfCls')==='dead';
  R('window._siAxPfSet("cls","<script>")');
  o['an unknown class value is refused (filter cleared)']=R('_siAxPfCls')==='';
  R('window._siAxPfSet("cat","Hoodies")');R('window._siAxPfSet("cat","Nope")');
  o['an unknown category is refused (filter cleared)']=R('_siAxPfCat')==='';
  R('window._siAxPfSet("season","winter")');
  o['the handler sets a season filter, an invalid one clears it']=R('_siAxPfSeason')==='winter'&&(R('window._siAxPfSet("season","zzz")'),R('_siAxPfSeason')==='');
  R('window._siAxPfSet("sort","bogus")');
  o['an unknown sort falls back to units per in-stock day']=R('_siAxPfSort')==='demand';
  const ord=k=>R('(()=>{return _siAxPfSorted(_siAxPf().rows,'+J(k)+').map(r=>r.code);})()');
  // units: GA 40, GB 20, GC 0.  value: GA 20 x 1000 = 20000, GB 10 x 2000 = 20000 (tie -> by code), GC 6 on hand, no price -> missing, last.
  o['sort by units sold: GA, GB, GC']=J(ord('units'))===J(['GA','GB','GC']);
  o['sort by value: a missing value is always last (GC)']=ord('value')[2]==='GC';
  o['sort by cover and demand: articles with no figure are last']=ord('cover')[2]==='GC'&&ord('demand')[2]==='GC';
  // tabs and sub-view state
  R('_siAxModeSel="overview"');R('window._siAxSetMode("portfolio")');
  o['tab switching: Portfolio selects the portfolio sub-view']=R('_siAxModeSel')==='portfolio';
  R('window._siAxSetMode("compare")');R('window._siAxSetMode("overview")');
  o['tab switching: Compare and Overview still work']=R('_siAxModeSel')==='overview';
  R('window._siAxSetMode("nonsense")');
  o['a stale or unknown sub-view falls back to Search']=R('_siAxModeSel')==='search';
  R('_siAxModeSel="stale-value"');
  const fb=R('_siAxBodyHtml()');
  o['a stale sub-view value renders without throwing and shows no Portfolio markup']=typeof fb==='string'&&!/si-pf/.test(fb);
  R('_siAxModeSel="portfolio"');
  const sec=R('_siArticleExplorerSection()');
  o['the section has the Portfolio tab, marked on, and carries the navigation search box']=/id="si-ax-tab-portfolio" class="si-ax-btn on"/.test(sec)&&/id="si-ax-input"/.test(sec);
  o['in Portfolio mode the section renders the portfolio body']=/id="si-pf-read"/.test(sec);
  o['the tabs run Overview, Portfolio, Search, Compare']=sec.indexOf('si-ax-tab-overview')<sec.indexOf('si-ax-tab-portfolio')&&sec.indexOf('si-ax-tab-portfolio')<sec.indexOf('si-ax-tab-search')&&sec.indexOf('si-ax-tab-search')<sec.indexOf('si-ax-tab-compare');
  R('_siAxPfCls="";_siAxPfCat="";_siAxPfSeason="";_siAxPfSort="demand";_siAxPfAll=false;_siAxPfConcAll=false');
  const html=R('_siAxPortfolioBody()');
  o['body: readout, six tiles, class mix, category, season, concentration, cash and the article list are all there']=['si-pf-read','Class mix','>Category<','By selling window','By saved type and saved season','Concentration','Cash tied up and stock-outs','si-pf-list'].every(s=>html.indexOf(s)>-1)&&(html.match(/class="si-pf-tile"/g)||[]).length===6;
  o['body: the caveat says returns, discounts and selling-price-not-cost']=/before returns/.test(html)&&/before discounts/.test(html)&&/not cost/.test(html);
  o['body: every table is a real <table> and the stock value is labelled "selling price"']=(html.match(/<table/g)||[]).length>=6&&/Stock at selling price/.test(html);
  o['body: charts are HTML boxes — no svg, viewBox or text element']=!/<svg|viewBox|<text/.test(html);
  o['body: no colour literal (tokens only)']=!/#[0-9a-fA-F]{3,6}\b/.test(html.replace(/&#\d+;/g,''));
  o['body: no NaN or undefined text']=!/NaN|undefined/.test(html);
  o['body: a hostile title is escaped everywhere']=!/<img src=x/i.test(html)&&/&lt;img src=x/i.test(html);
  o['body: Open buttons carry the article code and call the shared open handler']=/class="si-pf-link" data-code="GA" onclick="window\._siAxOpen\(this\.dataset\.code\)"/.test(html);
  o['body: scatter dots are present for articles with demand and cover and call the same open handler']=/class="si-pf-dot"[^>]*data-code="GA"[^>]*onclick="window\._siAxOpen/.test(html);
  R('window._siAxOpen("ga")');
  o['clicking an article opens its page (Search, code upper-cased)']=R('_siAxModeSel')==='search'&&R('_siAxSel')==='GA';
  R('_siAxModeSel="portfolio";_SI_PF.topCap=2');
  const h2=R('_siAxPortfolioBody()');
  o['long lists are capped with a Show all button (cap 2 of 2 selling shows no button, the list cap is separate)']=!/Show all 2/.test(h2);
  R('_SI_PF.topCap=1');
  const h3=R('_siAxPortfolioBody()');
  o['concentration list is capped at the cap and offers Show all with the full count']=/Show all 2/.test(h3)&&h3.indexOf('<td class="r">1</td><td><div class="si-pf-nm">')>-1&&h3.indexOf('<td class="r">2</td><td><div class="si-pf-nm">')===-1;
  R('_siAxPfConcAll=true');
  o['Show all lifts the cap (button then says Show the first 1)']=/Show the first 1/.test(R('_siAxPortfolioBody()'))&&R('_siAxPortfolioBody()').indexOf('<td class="r">2</td><td><div class="si-pf-nm">')>-1;
  R('_SI_PF.topCap=15;_siAxPfConcAll=false');
  R('_SI_PF.listCap=2');
  const h4=R('_siAxPortfolioBody()');
  o['the article list shows 2 of 3 with Show all 3 at a cap of 2']=/Show all 3/.test(h4)&&/3 of 3 articles \(showing 2\)/.test(h4);
  R('_SI_PF.listCap=25');
  R('_siHistState="loading"');
  o['while the stock history loads the body says so instead of drawing zeros']=/Reading the stock history/.test(R('_siAxPortfolioBody()'));
  R('_siHistState="ok"');
  const memo=R('(()=>{const a=_siAxPf(),b=_siAxPf();return a===b;})()');
  o['the portfolio is cached per data load (same object twice)']=memo===true;
  o['no getDocs/getDoc call for any of the above']=counter.n===0;
  return o;
}
module.exports=async function(){
  const s=suite('shopify-portfolio');
  const base=checks(SRC);
  s.section('portfolio (hand-computed)');
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
  const SEAW='season of sale: winter 125 units / 152500 (Oct 1 and Feb 28 are winter)';
  brk('October is not winter','const _SI_AX_WINTER_MONTHS=[10,11,12,1,2];','const _SI_AX_WINTER_MONTHS=[11,12,1,2];',[SEAW,'season of sale: other months 75 units / 57500 (Sep 30 and Mar 1 are not winter)']);
  brk('March is winter','const _SI_AX_WINTER_MONTHS=[10,11,12,1,2];','const _SI_AX_WINTER_MONTHS=[10,11,12,1,2,3];',['season of sale: other months 75 units / 57500 (Sep 30 and Mar 1 are not winter)']);
  brk('half-winter article counts as winter','su.wU*2>a.units','su.wU*2>=a.units',['an article whose units are exactly half winter (B) is not a winter seller; A, C, D are']);
  brk('Pareto needs strictly more than the share','if(c*100>=tot*pct)','if(c*100>tot*pct)',['Pareto units: 1 article makes 50% (100 of 200 is exactly half), 3 make 80%']);
  brk('missing price valued as 0',"(asp!=null?a.onHand*asp:null)","(asp!=null?a.onHand*asp:0)",['an article with stock and no price is counted (1) and not valued, never read as 0','cash: slow 120000, dead 40000, everything else (E, F) 8 units and value 0 with 1 unpriced']);
  brk('slow stock counted as dead',"r.cls==='slow'?'slow'","r.cls==='slow'?'dead'",['cash: slow 120000, dead 40000, everything else (E, F) 8 units and value 0 with 1 unpriced']);
  brk('over-stocked threshold lowered past B','overCoverWeeks:26,','overCoverWeeks:41,',['cash: winners 1 article / 50 units / 50000, over-stocked (B, solid, 30 weeks) 1 / 100 / 50000']);
  brk('share of units over articles, not units','x.pU=tot.units>0?x.units/tot.units:null;','x.pU=R.length?x.units/R.length:null;',['% of units: winner 50%, solid 25%, slow 15%, dead 5%, constrained 5%, early 0%','the class mix shares of units sum to 100%']);
  brk('Pareto by revenue uses units','rv=byRev.map(r=>r.rev)','rv=byRev.map(r=>r.units)',['Pareto revenue: 2 articles make 50% (100000 is under 105000), 3 make 80%']);
  brk('lost sales summed without an estimate guard','if(s.lost){lost.lo+=s.lost.lo;','if(true){lost.lo+=(s.lost||{lo:5}).lo;',['stock-out exposure: only A has an estimate (10-20 units, mid 15, Rs 15000); B has none and counts 2 + 1 stretches unestimated']);
  brk('exposure invented without history','if(opts.lost){','if(true){opts.lost=opts.lost||(()=>null);',['without stock history there is no exposure object (null), not zeros']);
  brk('missing sorts first',"if(a==null&&b!=null)return 1;if(b==null&&a!=null)return-1;","",['sort by cover: 0 weeks (out of stock) sorts above a missing figure, which is last']);
  brk('category filter ignored',"&&(!_siAxPfCat||r.cat===_siAxPfCat)","",['filter by category: Tees 2, Hoodies 1']);
  brk('season filter ignored',"&&(!_siAxPfSeason||(_siAxPfSeason==='none'?r.season==null:r.season===_siAxPfSeason))","",['filter by season: winter 1, summer 1, no sales 1']);
  brk('class filter unvalidated',"_siAxPfCls=_SI_PF_ORDER.indexOf(v)>=0?v:'';","_siAxPfCls=v;",['an unknown class value is refused (filter cleared)']);
  brk('unknown sub-view becomes Portfolio',"(m==='portfolio'?'portfolio':'search')","'portfolio'",['a stale or unknown sub-view falls back to Search']);
  brk('Portfolio tab missing',"${modeBtn('portfolio','Portfolio')}","",['the section has the Portfolio tab, marked on, and hides the search box','the tabs run Overview, Portfolio, Search, Compare']);
  brk('portfolio body not routed',"(_siAxModeSel==='portfolio'?_siAxPortfolioBody():_siAxSearchBody())","_siAxSearchBody()",['in Portfolio mode the section renders the portfolio body']);
  brk('article label not escaped','onclick="window._siAxOpen(this.dataset.code)">${_siEsc(_siAxLabel(r.a))}</button><span class="si-ax-note" style="margin:0;display:block">${_siEsc(r.code)} · ${_siEsc(r.cat)}','onclick="window._siAxOpen(this.dataset.code)">${_siAxLabel(r.a)}</button><span class="si-ax-note" style="margin:0;display:block">${_siEsc(r.code)} · ${_siEsc(r.cat)}',['body: a hostile title is escaped everywhere']);
  brk('list cap removed','show=_siAxPfAll?s:s.slice(0,T.listCap)','show=s',['the article list shows 2 of 3 with Show all 3 at a cap of 2']);
  brk('concentration cap removed','show=_siAxPfConcAll?c.top:c.top.slice(0,T.topCap)','show=c.top',['concentration list is capped at the cap and offers Show all with the full count']);
  brk('history loading drawn as zeros',"if(_siHistState!=='ok'&&_siHistState!=='error')return`<div class=\"si-ax-empty\">Reading the stock history…</div>`+_siAxHistBanner();\n  const pf=_siAxPf()","const pf=_siAxPf()",['while the stock history loads the body says so instead of drawing zeros']);
  brk('no caching','if(_siAxPfMemo&&_siAxPfMemo.idx===idx&&_siAxPfMemo.sig===sig)return _siAxPfMemo.res;','',['the portfolio is cached per data load (same object twice)']);
  brk('dot click not wired','onclick="window._siAxOpen(this.dataset.code)"></i>','></i>',['body: scatter dots are present for articles with demand and cover and call the same open handler']);
  console.log('\n  breaks run: '+nb);
  return s;
};

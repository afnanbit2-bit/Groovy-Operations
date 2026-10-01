/* Inventory Intel ▸ Article Explorer — the Sizes card (sales curve vs stock curve, cover per size, status chips, readout and the
   suggested split of the next batch). Every expectation is HAND-COMPUTED (comments below), clock pinned to 2026-09-15.
   Each "break" mutates the source and requires the named check to FAIL. No Firestore read is allowed. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
function load(src,counter){
  const store={'groovy-si-leadtimes-article':'{"GZ":14}'};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},
      getDocs:()=>{counter.n++;return Promise.resolve({forEach(){}});},getDoc:()=>{counter.n++;return Promise.resolve({exists:()=>false});}}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
const near=(x,y,e)=>Math.abs(x-y)<(e||0.00051);
// Article GZ (Tees), last 28 days = 2026-08-19 .. 09-15. Units (lifetime / last 28 d / stock now / stock 7 days ago):
//   S 30/6/3/4 · M 60/12/5/8 · L 30/2/40/40 · XL 10/0/30/30 · 2XL 20/8/0/6.   Lifetime 150, last 28 d 28, stock now 78.
// Sales curve = per size w*recent-share + (1-w)*lifetime-share, w = recent/(recent+6), then renormalised:
//   S .5*.214286+.5*.2=.207143 · M .666667*.428571+.333333*.4=.419048 · L .25*.071429+.75*.2=.167857 · XL 0+.066667 · 2XL .571429*.285714+.428571*.133333=.220408
//   sum 1.081123 -> S .1916 · M .3876 · L .1553 · XL .0617 · 2XL .2039.   Stock curve: 3/78 .0385, 5/78 .0641, 40/78 .5128, 30/78 .3846, 0.
// Cover (weeks) = stock / (recent / 4): S 3/1.5=2.0 · M 5/3=1.667 · L 40/.5=80 · XL none (no recent sales) · 2XL 0 (out, selling).
// Status: S cover 14.0 days is NOT under 14 -> Fine · M 11.67 days -> Thin · L 560 days -> Over-stocked · XL No sales · 2XL Out and selling.
function checks(src){
  const counter={n:0},a=load(src,counter),R=c=>a.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-09-15")+(off||0));}');
  const li=(sz,q,day)=>({sku:'GZ-'+sz,quantity:q,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'});
  const L=[li('S',24,'2026-07-01'),li('S',6,'2026-09-01'),li('M',48,'2026-07-01'),li('M',12,'2026-09-02'),li('L',28,'2026-07-01'),li('L',2,'2026-09-03'),
    li('XL',10,'2026-07-02'),li('XXL',12,'2026-07-03'),li('XXL',8,'2026-09-04'),
    li('M',2,'2026-07-01') /*other article below*/];
  L.pop();
  const prod=(sz)=>({_id:'GZ-'+sz,sku:'GZ-'+sz,product_title:'Art GZ',color:'Blue',size:sz,product_type:'Tees',status:'active',published_at:'2025-01-01T10:00:00+05:00'});
  const sizes=['S','M','L','XL','XXL'];
  const items=(st)=>{const o={};sizes.forEach((s,i)=>{o['i'+i]={sku:'GZ-'+s,available:st[s]};});return o;};
  R('_siProducts='+J(sizes.map(prod))+';_siLineItems='+J(L)+';_siSnapshot='+J({date:'2026-09-15',items:items({S:3,M:5,L:40,XL:30,XXL:0})})+';_siPrevSnapshot='+J({date:'2026-09-08',items:items({S:4,M:8,L:40,XL:30,XXL:6})})+';_siHist=null;_siHistState="idle";_siAxCache=null');
  const o={};
  const m=R('(()=>{const m=_siAxStats(_siAxIndex().map.get("GZ"));return{rows:m.sizeRows.map(r=>[r.size,r.sold,r.recent,r.stock,r.prev])};})()');
  o['fixture: the size rows carry sold / last 28 d / stock now / stock a week ago (2XL is stored as XXL)']=J(m.rows.map(r=>r.join('/')).sort())===J(['L/30/2/40/40','M/60/12/5/8','S/30/6/3/4','XL/10/0/30/30','XXL/20/8/0/6'].sort());
  const calc=R('(()=>{const a=_siAxIndex().map.get("GZ"),m=_siAxStats(a);return _siAxSizePanelCalc(m.sizeRows,_siNaSizeRows(m,14),14);})()');
  const by={};calc.rows.forEach(r=>by[r.size]=r);
  o['rows are in garment order: S, M, L, XL, XXL']=J(calc.rows.map(r=>r.size))===J(['S','M','L','XL','XXL']);
  o['sales curve (shrinkage K=6, renormalised): S .1916 M .3876 L .1553 XL .0617 2XL .2039']=near(by.S.salesShare,.1916)&&near(by.M.salesShare,.3876)&&near(by.L.salesShare,.1553)&&near(by.XL.salesShare,.0617)&&near(by.XXL.salesShare,.2039);
  o['the sales curve sums to 100%']=near(calc.rows.reduce((s,r)=>s+r.salesShare,0),1,1e-9);
  o['stock curve: 3/78, 5/78, 40/78, 30/78, 0']=near(by.S.stockShare,3/78)&&near(by.M.stockShare,5/78)&&near(by.L.stockShare,40/78)&&near(by.XL.stockShare,30/78)&&by.XXL.stockShare===0;
  o['cover per size (weeks): S 2.0, M 1.667, L 80, XL none, 2XL 0']=near(by.S.coverWeeks,2)&&near(by.M.coverWeeks,5/3)&&near(by.L.coverWeeks,80)&&by.XL.coverWeeks===null&&by.XXL.coverWeeks===0;
  o['S has exactly 14.0 days of cover: not thin (Fine)']=by.S.key==='fine'&&by.S.label==='Fine';
  o['M has 11.7 days of cover with 12 units in 28 d: Thin']=by.M.key==='thin';
  o['L has 560 days of cover: Over-stocked vs demand']=by.L.key==='over'&&by.L.label==='Over-stocked vs demand';
  o['XL has 30 on hand and nothing sold in 28 d: No sales']=by.XL.key==='none'&&by.XL.label==='No sales';
  o['2XL is out and sold 8 in 28 d: Out and selling']=by.XXL.key==='out'&&by.XXL.label==='Out and selling';
  o['the readout names the under-stocked and the over-stocked sizes with their shares']=calc.readout==='S, M and XXL carry 78% of sales but only 10% of stock; L and XL are 90% of stock and 22% of sales.';
  // ── the split: percent and units sum exactly ──
  const sp=R('_siAxSizeSplit(_siAxStats(_siAxIndex().map.get("GZ")).sizeRows,120)');
  o['split: sizes in garment order, largest-remainder percentages 19 / 39 / 16 / 6 / 20 (sum 100)']=sp.ok&&J(sp.rows.map(r=>r.pct))===J([19,39,16,6,20])&&sp.rows.reduce((s,r)=>s+r.pct,0)===100;
  // 120 x (.1916,.3876,.1553,.0617,.2039) = 22.99, 46.51, 18.63, 7.40, 24.46 -> floors 22,46,18,7,24 = 117, +1 to .63 (L), .51 (M), .99 (S) -> S23 M47 L19 XL7 2XL24
  o['split units sum exactly to the total (120 -> 23, 47, 19, 7, 24)']=J(sp.rows.map(r=>r.units))===J([23,47,19,7,24])&&sp.rows.reduce((s,r)=>s+r.units,0)===120;
  const sp0=R('_siAxSizeSplit(_siAxStats(_siAxIndex().map.get("GZ")).sizeRows,null)');
  o['no total given: percentages only, units are null (never invented)']=sp0.ok&&sp0.rows.every(r=>r.units===null)&&sp0.total===null;
  // ── the card on the article page ──
  R('_siAxClassify=function(){return{cls:"solid",label:"Solid",rule:"",near:""};}');
  const pd=R('_siNaPerDay(_siAxStats(_siAxIndex().map.get("GZ")))');
  const upr=v=>Math.max(0,Math.ceil(v/12)*12);
  const qlo=upr(pd*.75*(14+28)-78),qhi=upr(pd*1.25*(14+28)-78);
  const html=R('_siAxSizesCardHtml(_siAxIndex().map.get("GZ"))');
  o['card: title, readout, the table with all five sizes and status words']=/<div class="card-title">Sizes<\/div>/.test(html)&&/class="si-sz-read"[^>]*>S, M and XXL carry 78%/.test(html)&&['Out and selling','Thin','Fine','Over-stocked vs demand','No sales'].every(w=>html.indexOf('</i>'+w+'</span>')>-1)&&(html.match(/<tr><td class="si-sz-h"><b>/g)||[]).length===5;
  o['card: the reorder total is the Needs Attention guide (not a second calculator): '+qlo+'–'+qhi]=qhi>0&&html.indexOf('Reorder guide for the whole batch: '+qlo+'–'+qhi+' units')>-1;
  o['card: the units in the suggested split sum to the top of the reorder guide']=qhi>0&&(html.match(/ · (\d+) units<\/span>/g)||[]).map(x=>+/(\d+)/.exec(x)[1]).reduce((s,v)=>s+v,0)===qhi;
  o['card: the split is labelled a suggestion, not an order']=/suggestion, not an order/.test(html)&&/Suggested split for the next batch/.test(html);
  o['card: bars are HTML boxes and carry no svg, viewBox or text element']=!/<svg|viewBox|<text/.test(html);
  o['card: no colour literal in the markup']=!/#[0-9a-fA-F]{3,6}\b/.test(html.replace(/&#\d+;/g,''));
  o['card: colour is not split (an article is one colour) and says so']=/Colour is not split/.test(html);
  const page=R('(()=>{_siAxModeSel="search";_siAxSel="GZ";return _siAxSearchBody();})()');
  o['article page: the Sizes card sits after Stock vs sales and before Sales over time']=(()=>{const t=page.indexOf('Stock vs sales</div>'),z=page.indexOf('id="si-sz"'),s=page.indexOf('Sales over time');return t>-1&&z>t&&s>z;})();
  // ── pure cases ──
  const calcOf=rows=>R('(()=>{const rows='+J(rows)+';return _siAxSizePanelCalc(rows,_siNaSizeRows({sizeRows:rows},14),14);})()');
  const rr=(size,sold,recent,stock,prev)=>({size,sold,recent,stock,prev:prev==null?null:prev});
  const wc=calcOf([rr('34',5,0,1),rr('S',5,0,1),rr('28',5,0,1),rr('Unknown',5,0,1),rr('XL',5,0,1),rr('30',5,0,1),rr('XXL',5,0,1)]);
  o['ordering: garment sizes (XL before 2XL), then waist numerically (28, 30, 34), then Unknown last']=J(wc.rows.map(r=>r.size))===J(['S','XL','XXL','28','30','34','Unknown']);
  const sh=R('_siAxSizeCurve([{sold:20,recent:1},{sold:20,recent:0}])');
  // S1: l .5, rc 1.0, w 1/7 -> .142857*1+.857143*.5=.571429; S2: l .5, rc 0, w 0 -> .5; sum 1.071429 -> .5333, .4667
  o['shrinkage: one recent unit moves a size only 1/7 of the way from its lifetime share (.5333 / .4667, not 1 / 0)']=near(sh.shares[0],.5333)&&near(sh.shares[1],.4667);
  const sh2=R('_siAxSizeCurve([{sold:10,recent:0},{sold:30,recent:0}])');
  o['no recent sales anywhere: the curve is the lifetime curve (.25 / .75) and says so']=near(sh2.shares[0],.25)&&near(sh2.shares[1],.75)&&sh2.basis==='lifetime';
  const sh3=R('_siAxSizeCurve([{sold:0,recent:0},{sold:0,recent:0}])');
  o['no sales at all: no curve (null), not a row of zeros']=sh3===null;
  // floor: S 297, M 3, L 100 (total 400): M .0075 -> floored to 3%; the others share 97%: S .7425/.9925*.97=.7257..., L .25/.9925*.97=.2443
  const fl=R('_siAxSizeSplit([{size:"S",sold:297,recent:0},{size:"M",sold:3,recent:0},{size:"L",sold:100,recent:0}],null)');
  o['minimum guard: a size that sold 3 units gets at least 3%, the rest is rescaled, the total is still 100%']=fl.ok&&J(fl.rows.map(r=>r.size))===J(['S','M','L'])&&fl.rows[1].pct===3&&fl.rows.reduce((s,r)=>s+r.pct,0)===100&&near(fl.rows[1].share,.03,1e-9)&&near(fl.rows.reduce((s,r)=>s+r.share,0),1,1e-9);
  const fl2=R('_siAxSizeSplit([{size:"S",sold:299,recent:0},{size:"M",sold:2,recent:0},{size:"L",sold:99,recent:0}],null)');
  o['a size that sold only 2 units has no floor (2/400 stays .5%, rounds to 0%... never raised)']=fl2.ok&&fl2.rows[1].share<.03;
  o['a size that never sold gets no share of the split']=(()=>{const s=R('_siAxSizeSplit([{size:"S",sold:20,recent:3},{size:"M",sold:20,recent:3},{size:"L",sold:0,recent:0}],null)');return s.ok&&s.rows.length===2&&!s.rows.some(r=>r.size==='L');})();
  o['minimum total: 29 counted units refuses a split, 30 allows it']=R('_siAxSizeSplit([{size:"S",sold:15,recent:0},{size:"M",sold:14,recent:0}],null)').ok===false&&R('_siAxSizeSplit([{size:"S",sold:15,recent:0},{size:"M",sold:15,recent:0}],null)').ok===true;
  o['single-size article: no split, and the readout says there is no mix to compare']=R('_siAxSizeSplit([{size:"M",sold:80,recent:9}],null)').ok===false&&/Only one size/.test(calcOf([rr('M',80,9,5,5)]).readout);
  o['Unknown is never given a share of the split']=(()=>{const s=R('_siAxSizeSplit([{size:"Unknown",sold:100,recent:9},{size:"M",sold:20,recent:3},{size:"L",sold:20,recent:3}],null)');return s.ok&&!s.rows.some(r=>r.size==='Unknown');})();
  const ns=calcOf([rr('S',0,0,4),rr('M',0,0,6)]);
  o['article with stock but no sales: no curve, readout says so, no division by zero']=ns.rows.every(r=>r.salesShare===null)&&/No sales are counted/.test(ns.readout);
  const nd=calcOf([rr('S',10,2,null),rr('M',10,2,null)]);
  o['no stock data: stock is "—" (null), cover null, chip "No stock data", never 0']=nd.rows.every(r=>r.stock===null&&r.stockShare===null&&r.coverWeeks===null&&r.key==='nodata')&&/no stock data/.test(nd.readout);
  const z0=calcOf([rr('S',10,2,0),rr('M',10,0,0)]);
  o['stock 0 with no recent sales: No sales (not "Out and selling"); with recent sales: Out and selling']=z0.rows[1].key==='none'&&z0.rows[0].key==='out'&&/Nothing is in stock/.test(z0.readout);
  // over-stocked by mix: A sold 20/recent 12/stock 50 (cover 16.7 wk, not deep), B sold 100/recent 40/stock 10. A sales .2122, stock 50/60 = .8333 >= 2x, 50 >= 8 units, 16.7 > 12 wk
  const ov=calcOf([rr('A',20,12,50),rr('B',100,40,10)]);
  o['over-stocked by the mix rule: 2x its sales share in stock, 8+ units and over 12 weeks of cover']=ov.rows[0].key==='over'&&ov.rows[1].key==='thin';
  const ov2=calcOf([rr('A',20,12,50),rr('B',100,40,10)].map(r=>r.size==='A'?rr('A',20,12,30):r));
  o['the same size with 30 on hand (10 weeks of cover) is Fine']=ov2.rows[0].key==='fine';
  o['balanced article: the readout says the mix is close']=/stock mix is close to the sales mix/.test(calcOf([rr('S',50,6,10),rr('M',50,6,10)]).readout);
  // ── escaping: a hostile size label ──
  const esc=R('(()=>{const keep=[_siAxStats,_siAxClassify,_siAxActionOf];_siAxStats=()=>({sizeRows:[{size:"<IMG SRC=x onerror=alert(1)>",sold:5,stock:2,prev:2,recent:5},{size:"M",sold:40,stock:9,prev:9,recent:5}]});_siAxActionOf=()=>({key:"ok",label:"ok"});'+
    'const h=_siAxSizesCardHtml({hasStock:true,onHand:11,code:"X",category:"Tees"});[_siAxStats,_siAxClassify,_siAxActionOf]=keep;return h;})()');
  o['a size label is escaped everywhere (no raw tag reaches the page)']=!/<IMG/i.test(esc)&&/&lt;IMG/i.test(esc);
  o['every size status has a glyph and a word (colour is never the only cue)']=['out','thin','fine','over','none','nodata'].every(k=>R('_SI_SZ_CHIPS.'+k+'.g.length>0&&_SI_SZ_CHIPS.'+k+'.l.length>0'));
  o['no getDocs/getDoc call for any of the above']=counter.n===0;
  return o;
}
module.exports=async function(){
  const s=suite('shopify-sizes');
  const base=checks(SRC);
  s.section('sizes card (hand-computed)');
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
  const CURVE='sales curve (shrinkage K=6, renormalised): S .1916 M .3876 L .1553 XL .0617 2XL .2039';
  brk('no shrinkage','shrinkK:6','shrinkK:0',[CURVE,'shrinkage: one recent unit moves a size only 1/7 of the way from its lifetime share (.5333 / .4667, not 1 / 0)']);
  brk('recent share ignored','w=R>0?(r.recent||0)/((r.recent||0)+K):0;','w=0;',[CURVE]);
  brk('thin boundary moved','sizeThinDays:14','sizeThinDays:15',['S has exactly 14.0 days of cover: not thin (Fine)']);
  brk('deep size not over-stocked',"if(st==='deep')return'over';","if(st==='deep')return'fine';",['L has 560 days of cover: Over-stocked vs demand']);
  brk('out size not flagged',"if(st==='out')return'out';","if(st==='out')return'none';",['2XL is out and sold 8 in 28 d: Out and selling']);
  brk('no-sales chip dropped',"if(!(r.recent>0))return'none';","",['XL has 30 on hand and nothing sold in 28 d: No sales','stock 0 with no recent sales: No sales (not "Out and selling"); with recent sales: Out and selling']);
  brk('missing stock read as a size','if(r.stock==null)return\'nodata\';','',['no stock data: stock is "—" (null), cover null, chip "No stock data", never 0']);
  brk('mix over-stock rule off','stockShare>=_SI_SZ.overMix*salesShare&&','false&&',['over-stocked by the mix rule: 2x its sales share in stock, 8+ units and over 12 weeks of cover']);
  brk('floor removed','floor:0.03','floor:0',['minimum guard: a size that sold 3 units gets at least 3%, the rest is rescaled, the total is still 100%']);
  brk('minimum total removed','minTotal:30','minTotal:0',['minimum total: 29 counted units refuses a split, 30 allows it']);
  brk('plain rounding instead of largest remainder','left>0','left>99',['split: sizes in garment order, largest-remainder percentages 19 / 39 / 16 / 6 / 20 (sum 100)','split units sum exactly to the total (120 -> 23, 47, 19, 7, 24)']);
  brk('readout gap threshold raised','gapShare:0.10','gapShare:0.50',['the readout names the under-stocked and the over-stocked sizes with their shares']);
  brk('Unknown given a share',"!/^unknown$/i.test(s.size)&&(s.sold||0)>0","(s.sold||0)>0",['Unknown is never given a share of the split']);
  brk('rows not in size order',"sort((x,y)=>_siSortCmpSize(x.size,y.size));\n  const sc=","sort((x,y)=>String(x.size)<String(y.size)?-1:1);\n  const sc=",['ordering: garment sizes (XL before 2XL), then waist numerically (28, 30, 34), then Unknown last']);
  brk('size label not escaped','<td class="si-sz-h"><b>${_siEsc(r.size)}</b></td>','<td class="si-sz-h"><b>${r.size}</b></td>',['a size label is escaped everywhere (no raw tag reaches the page)']);
  brk('units split the low end','g.qty?g.qty.hi:null','g.qty?g.qty.lo:null',['card: the units in the suggested split sum to the top of the reorder guide']);
  brk('own reorder calculator','const pd=_siNaPerDay(m),qty=a.hasStock&&pd!=null?_siNaQty(pd,lt.days,a.onHand,c.cls):null;','const pd=_siNaPerDay(m),qty=a.hasStock&&pd!=null?{lo:12,hi:24,target:28}:null;',['card: the reorder total is the Needs Attention guide (not a second calculator)']);
  brk('card not on the page','  ${_siAxSizesCardHtml(a)}\n','',['article page: the Sizes card sits after Stock vs sales and before Sales over time']);
  console.log('\n  breaks run: '+nb);
  return s;
};

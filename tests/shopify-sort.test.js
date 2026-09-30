/* Inventory Intel ▸ Article Explorer — logical sorting (_siSort block in js/shopify.js).
   Orderings below are computed by hand. Each "break" section mutates the source,
   reloads it and requires the named check to FAIL — so every rule is proven to bite. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/shopify.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'css/main.css'),'utf8');

function load(src){
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
function seed(a){
  const day=n=>a.run('_siPktDate('+(-n)+')');
  const at=n=>day(n)+'T12:00:00+05:00';
  const li=(sku,q,ago,x)=>Object.assign({sku,quantity:q,price:1000,order_created_at:at(ago),financial_status:'paid'},x||{});
  const prod=(id,sku,t,c,sz,ty,live)=>({_id:id,sku,product_title:t,color:c,size:sz,product_type:ty,status:'active',published_at:live==null?'':at(live)});
  a.run('_siProducts='+J([prod('1','GST073-S','Tee','Blue','S','Tees',100),prod('2','GST073-M','Tee','Blue','M','Tees',100),
    prod('3','GD007-28','Jort','Indigo','28','Jorts',400),prod('4','GHW001','Cap','Black','OS','Caps',null)]));
  a.run('_siLineItems='+J([li('GST073-S',6,50),li('GST073-M',6,40),li('GD007-28',7,300),li('GHW001',2,3)]));
  a.run('_siSnapshot={items:{}}');a.run('_siWeeklyCloses=[]');
}

// Every rule as a named boolean, so a mutant can be required to flip exactly one.
function checks(a){
  const R=c=>a.run(c);
  const order=(rows,col,dir,ties)=>R('_siSortRows('+J(rows)+','+J([col])+','+J(col.key)+','+dir+','+(ties?'['+ties+']':'undefined')+').map(r=>r.c).join(",")');
  const sz=arr=>R(J(arr)+'.slice().sort(_siSortCmpSize).join(",")');
  const out={};
  out['code order is natural']=R(`${J(['GST100','GST9','GST073','GD007','GST10'])}.slice().sort(_siSortNat).join(",")`)==='GD007,GST9,GST10,GST073,GST100';
  const numRows=[{c:'A',v:5},{c:'B',v:null},{c:'C',v:1},{c:'D',v:'—'}];
  out['missing last ascending']=order(numRows,{key:'v',type:'num'},1)==='C,A,B,D';
  out['missing last descending']=order(numRows,{key:'v',type:'num'},-1)==='A,C,B,D';
  out['ties break on units then code']=order([{c:'GST100',u:5,v:3},{c:'GST9',u:5,v:3},{c:'GD1',u:9,v:3}],{key:'v',type:'num'},1,
    '{get:r=>r.u,type:"num",dir:-1},{get:r=>r.c,type:"code",dir:1}')==='GD1,GST9,GST100';
  out['no tie list keeps input order (stable)']=order([{c:'x',v:1},{c:'y',v:1},{c:'z',v:1}],{key:'v',type:'num'},1)==='x,y,z';
  out['sorting never mutates its input']=R(`(()=>{const r=[{c:'b',v:2},{c:'a',v:1}];_siSortRows(r,[{key:'v',type:'num'}],'v',1);return r[0].c})()`)==='b';
  out['categories: units desc then name']=R(`${J([['Tees',10],['Jorts',10],['Caps',30],['Denim',2]])}.sort(_siSortEntries).map(e=>e[0]).join(",")`)==='Caps,Jorts,Tees,Denim';
  out['classes in fixed order']=R(`${J(['Slow','Too early','Winner','Dead stock','Healthy','Stock-constrained'])}.sort((a,b)=>_siSortClassRank(a)-_siSortClassRank(b)).join(",")`)==='Winner,Healthy,Stock-constrained,Slow,Dead stock,Too early';
  out['sizes: garment, then waist, then rest']=sz(['L','30','S','XXXS','28','XL','Unknown','OS','3XL','XXL','2XL','XS','M','XXS','32'])==='XXXS,XXS,XS,S,M,L,XL,XXL,2XL,3XL,28,30,32,OS,Unknown';
  out['dates are chronological']=order([{c:'b',v:'2026-09-28'},{c:'a',v:'2026-10-05'},{c:'c',v:'2026-09-07'}],{key:'v',type:'date'},-1)==='a,b,c';
  out['articles: units desc, name, code']=R(`${J([{code:'B2',name:'Tee',units:5},{code:'B10',name:'Tee',units:5},{code:'A1',name:'Zed',units:9}])}.sort(_siSortArticles).map(x=>x.code).join(",")`)==='A1,B2,B10';
  // SKU table audit fixes
  const mk=(sku,title,o)=>Object.assign({sku,title,color:'Red',size:'S',productType:'T',onHand:0,s7:0,s30:0,totalSold:0,daysLeft:0,dailyRate:0,sellThrough:null,reorderPoint:0,suggestedQty:0},o);
  R('window.__rows='+J([mk('A-S','Alpha',{onHand:50,s7:1,sellThrough:.02,daysLeft:999}),mk('B-S','Beta',{onHand:5,s7:5,sellThrough:.5,suggestedQty:40,daysLeft:10,dailyRate:.5}),mk('C-S','Gamma',{onHand:20,s7:2,sellThrough:.09,suggestedQty:10,daysLeft:30,dailyRate:.7})]));
  const skuOrder=(k,d)=>{R(`_siSkuSort='${k}';_siSkuDir=${d}`);return(R('_siGroupedBodyHtml(_siSkuFiltered(window.__rows))').match(/>(Alpha|Beta|Gamma)</g)||[]).map(x=>x.replace(/[<>]/g,'')).join(',');};
  out['SKU grouped: Sell-Thru column sorts by sell-through']=skuOrder('sellThrough',-1)==='Beta,Gamma,Alpha';
  out['SKU grouped: Suggested column sorts by suggested']=skuOrder('suggestedQty',-1)==='Beta,Gamma,Alpha';
  out['SKU grouped: Days Left descending keeps no-rate group last']=skuOrder('daysLeft',-1)==='Gamma,Beta,Alpha';
  out['SKU grouped: Days Left ascending unchanged']=skuOrder('daysLeft',1)==='Beta,Gamma,Alpha';
  out['SKU variants: XXXS before XS before S']=R(`(()=>{const g=_siGroupRows([{title:'t',color:'c',size:'XS',sku:'1'},{title:'t',color:'c',size:'XXXS',sku:'2'},{title:'t',color:'c',size:'S',sku:'3'}]);return Object.values(g)[0].variants.map(x=>x.size).join(",")})()`)==='XXXS,XS,S';
  // Explorer UI
  seed(a);
  R('_siAxModeSel="compare";_siAxCmp=["GST073","GD007","GHW001"];_siSortState={}');
  const codes=()=>(R('_siAxCompareBody()').match(/margin:0">(GST073|GD007|GHW001)</g)||[]).map(x=>x.replace(/.*">|</g,'')).join(',');
  const body0=R('_siAxCompareBody()');
  out['compare default = order added, stated on screen']=codes()==='GST073,GD007,GHW001'&&/Sorted by <strong>#<\/strong>, ascending — the order you added them/.test(body0);
  out['headers carry aria-sort (one ascending, rest none)']=(body0.match(/aria-sort="ascending"/g)||[]).length===1&&(body0.match(/aria-sort="none"/g)||[]).length===7;
  R('window._siSortClick("ax-compare","rev")');
  const b1=R('_siAxCompareBody()');
  out['click sorts numbers descending first, with ▼ and aria-sort']=codes()==='GST073,GD007,GHW001'&&/aria-sort="descending"[^>]*><button[^>]*data-key="rev"[^>]*>[^<]*<span[^>]*>▼/.test(b1);
  R('window._siSortClick("ax-compare","rev")');
  out['second click flips to ascending (▲)']=codes()==='GHW001,GD007,GST073'&&/data-key="rev"[^>]*>[^<]*<span[^>]*>▲/.test(R('_siAxCompareBody()'));
  R('_siSortState={};window._siSortClick("ax-compare","live");window._siSortClick("ax-compare","live");');
  out['date column: no live date stays last when ascending']=codes()==='GD007,GST073,GHW001';
  R('window._siSortClick("ax-compare","live");');
  out['date column: no live date stays last when descending']=codes()==='GST073,GD007,GHW001';
  R('_siSortState={}');
  return out;
}

module.exports=async function(){
  const s=suite('shopify-sort');
  s.section('rules hold on the real code');
  const base=checks(load(SRC));
  const names=Object.keys(base);
  names.forEach(n=>s.ok(n,base[n]===true));
  s.section('layout contract (HTML text, tokens only, 11px floor, 34px target)');
  const blk=(CSS.match(/\.si-sort-th\{[\s\S]*?\.si-sort-btn:focus-visible\{[^}]*\}/)||[''])[0];
  s.ok('sort styles exist',blk.length>50);
  s.ok('tap target is at least 34px',/\.si-sort-btn\{[^}]*min-height:34px/.test(blk));
  s.ok('mark text is at least 11px',/\.si-sort-mark\{[^}]*font-size:11px/.test(blk));
  s.ok('no literal colours in the sort styles',!/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(blk));
  s.ok('the marker is real text, not an image or pseudo-element',/<span class="si-sort-mark" aria-hidden="true">/.test(SRC)&&!/si-sort[^{]*::/.test(CSS));
  s.section('no new Firestore reads');
  let reads=0;
  const ra=harness.loadApp({files:[],session:{uid:'u',u:'afnan',name:'A',role:'owner'},globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>{reads++;return Promise.resolve({forEach(){}});},getDoc:()=>{reads++;return Promise.resolve({exists:()=>false});}}});
  vm.runInContext(SRC,ra.ctx);seed(ra);ra.run('_siAxModeSel="compare";_siAxCmp=["GST073"]');ra.run('_siAxCompareBody()');ra.run('window._siSortClick("ax-compare","units")');
  s.eq('sorting reads nothing',reads,0);

  s.section('deliberate breaks — each must fail the named check');
  const brk=(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=checks(load(SRC.split(from).join(to)));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>s.ok('break "'+label+'" fails "'+f+'"',r[f]===false));
  };
  brk('nulls first','return ma&&mb?0:ma?1:-1;','return ma&&mb?0:ma?-1:1;',['missing last ascending','missing last descending']);
  brk('missing flips with direction','return ma&&mb?0:ma?1:-1;','return(ma&&mb?0:ma?1:-1)*(dir<0?-1:1);',['missing last descending']);
  brk('lexical code order','text:_siSortNat,\n  code:_siSortNat,','text:_siSortNat,\n  code:(a,b)=>String(a)<String(b)?-1:1,',['ties break on units then code']);
  brk('lexical natural compare','function _siSortNat(a,b){','function _siSortNat(a,b){return String(a).toLowerCase()<String(b).toLowerCase()?-1:String(a).toLowerCase()>String(b).toLowerCase()?1:0;',['code order is natural']);
  brk('unstable tie-break','return p.i-q.i;','return q.i-p.i;',['no tie list keeps input order (stable)']);
  brk('ties ignored','for(const t of tl){','for(const t of []){',['ties break on units then code']);
  brk('classes alphabetical','return i<0?_SI_SORT_CLASSES.length:i;','return String(c).charCodeAt(0);',['classes in fixed order']);
  brk('XXXS dropped from garment order',"['XXXS','XXS','XS'","['XXS','XS'",['sizes: garment, then waist, then rest','SKU variants: XXXS before XS before S']);
  brk('categories without name tie-break','||_siSortNat(a[0],b[0]);}\n// Articles','||0;}\n// Articles',['categories: units desc then name']);
  brk('no aria-sort on headers','aria-sort="${aria}" ','',['headers carry aria-sort (one ascending, rest none)']);
  brk('SKU grouped sell-through key removed','sellThrough:oh+s7>0?s7/(oh+s7):null,reorderPoint:tot(\'reorderPoint\'),suggestedQty:tot(\'suggestedQty\')}','reorderPoint:0}',['SKU grouped: Sell-Thru column sorts by sell-through','SKU grouped: Suggested column sorts by suggested']);
  brk('SKU grouped no-rate group first on desc','daysLeft:minDays<9999?minDays:null','daysLeft:minDays',['SKU grouped: Days Left descending keeps no-rate group last']);
  return s;
};

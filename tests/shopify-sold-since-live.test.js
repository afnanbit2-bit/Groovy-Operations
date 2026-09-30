/* Inventory Intel SKU table — the "Sold since live" column.
   Drives the real _siComputeSkuTable / _siSkuTableSection / sort handler. */
'use strict';
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const DAY=86400000;
const iso=n=>new Date(Date.now()-n*DAY).toISOString();

module.exports=async function(){
  const s=suite('shopify-sold-since-live');
  const a=harness.loadApp({files:['js/shopify.js'],
    session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
  const li=(sku,q,ago,st)=>({sku,quantity:q,order_created_at:iso(ago),financial_status:st||'paid'});
  a.run('_siProducts='+J([
    {_id:'1',sku:'A-S',product_title:'Alpha',color:'Red',size:'S',published_at:iso(142),created_at:iso(200),status:'active'},
    {_id:'2',sku:'A-M',product_title:'Alpha',color:'Red',size:'M',published_at:iso(142),created_at:iso(200),status:'active'},
    {_id:'3',sku:'B-S',product_title:'Beta',color:'Blue',size:'S',status:'active'},
    {_id:'4',sku:'C-S',product_title:'Gamma',color:'Green',size:'S',created_at:iso(10),status:'active'}
  ]));
  a.run('_siLineItems='+J([
    li('A-S',3,100),li('A-S',2,5),li('A-S',7,3,'refunded'),li('A-M',4,50),
    li('B-S',1,2),li('B-S',5,80),li('C-S',9,1)
  ]));
  const rows=a.run('_siComputeSkuTable()');
  const r=k=>rows.find(x=>x.sku===k);

  s.section('lifetime units');
  s.eq('A-S = 3+2, refunded 7 excluded',r('A-S').totalSold,5);
  s.eq('A-M',r('A-M').totalSold,4);
  s.eq('B-S = 1+5 (older than 30d still counts)',r('B-S').totalSold,6);
  s.eq('30d column unaffected',r('B-S').s30,1);
  s.eq('live date prefers published_at',r('A-S').liveAt,a.run('_siProducts[0].published_at'));
  s.eq('falls back to created_at',r('C-S').liveAt,a.run('_siProducts[3].created_at'));
  s.eq('missing date stays empty, not invented',r('B-S').liveAt,'');

  s.section('the table');
  a.run("_siSkuSort='totalSold';_siSkuDir=-1");
  const html=a.run('_siSkuTableSection(_siComputeSkuTable())');
  s.ok('header exists',/Sold since live/i.test(html));
  const head=a.run('_siSkuHeadCells()');
  const order=[...head.matchAll(/_siSortSku\('(\w+)'\)/g)].map(m=>m[1]);
  s.eq('sits right after Sold 30d, before Days Left',order.join(','),'title,color,productType,onHand,s7,s30,totalSold,daysLeft,sellThrough,reorderPoint,suggestedQty');
  s.ok('group total for Alpha is 9 with live 142d',/>9<\/span><div[^>]*>live 142d</.test(html));
  s.ok('Beta shows 6 and live — (no date)',/>6<\/span><div[^>]*>live —</.test(html));
  s.ok('Gamma shows live 10d',/>9<\/span><div[^>]*>live 10d</.test(html));
  const pos=t=>html.indexOf('>'+t);
  s.ok('sorted descending: Alpha(9) and Gamma(9) before Beta(6)',pos('Beta')>pos('Alpha')&&pos('Beta')>pos('Gamma'));
  s.ok('caption names the earliest order date',html.includes(iso(100).slice(0,10)));
  s.ok('caption says it understates',/understates/.test(html));
  s.ok('no row is colspan 12 any more',!/colspan="12"/.test(html));

  s.section('sorting');
  a.run("_siSkuSort='s7';_siSkuDir=-1");
  a.run("window._siSortSku('totalSold')");
  s.eq('click switches to the column, descending',a.run('_siSkuSort+","+_siSkuDir'),'totalSold,-1');
  a.run("window._siSortSku('totalSold')");
  s.eq('second click flips',a.run('_siSkuDir'),1);
  const asc=a.run('_siSkuTableSection(_siComputeSkuTable())');
  s.ok('ascending puts Beta first',asc.indexOf('>Beta')<asc.indexOf('>Alpha'));

  s.section('catalog sync stores the date');
  const src=require('fs').readFileSync(require('path').join(harness.ROOT,'netlify/functions/shopify-catalog-sync.js'),'utf8');
  s.ok('published_at is written',/published_at:\s*product\.published_at/.test(src));
  return s;
};

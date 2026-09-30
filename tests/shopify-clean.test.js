/* Inventory Intel ▸ Article Explorer data cleaning (_siClean block in js/shopify.js).
   Every expected number is hand-computed from the fixtures below. */
'use strict';
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);

module.exports=async function(){
  const s=suite('shopify-clean');
  let reads=0;
  const a=harness.loadApp({files:['js/shopify.js'],
    session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>{reads++;return Promise.resolve({forEach(){}});},getDoc:()=>{reads++;return Promise.resolve({exists:()=>false});}}});
  const R=c=>a.run(c);
  const eq=(n,x,y)=>s.eq(n,J(x),J(y));
  const D='2026-09-01T10:00:00+05:00';
  const li=(o)=>Object.assign({order_id:1,line_item_id:1,sku:'GST073-S',quantity:1,price:100,order_created_at:D,financial_status:'paid',product_type:'Tees'},o||{});

  // ── fixtures ──
  const products=[
    {_id:'p1',sku:'GST073-S',product_title:'Tee',color:'Blue',size:'S',product_type:'Tees'},
    {_id:'p2',sku:' gst073-m ',product_title:'Tee',color:'Blue',size:'M',product_type:'tees '},   // case+space SKU, category variant
    {_id:'p3',sku:'GST073-S',product_title:'Dup',color:'X',size:'S',product_type:'Tees'},          // duplicate SKU of p1
    {_id:'p4',sku:'',product_title:'No sku',product_type:''},                                     // empty SKU, blank category
    {_id:'p5',sku:'GD007-28',product_title:'Jort',color:'Indigo',size:'28',product_type:'  Jorts'}
  ];
  const lineItems=[
    li({order_id:1,line_item_id:1,quantity:3}),                                   // counted
    li({order_id:1,line_item_id:1,quantity:3}),                                   // same ids again -> duplicate
    li({order_id:2,line_item_id:1,financial_status:'refunded'}),                  // refunded
    li({order_id:3,line_item_id:1,financial_status:'voided'}),                    // voided
    li({order_id:4,line_item_id:1,financial_status:' VOIDED '}),                  // voided (case/space)
    li({order_id:5,line_item_id:1}),                                              // order 5 is cancelled
    li({order_id:6,line_item_id:1,sku:''}),                                       // no sku
    li({order_id:7,line_item_id:1,sku:'NO-SKU'}),                                 // no sku
    li({order_id:8,line_item_id:1,order_created_at:''}),                          // bad date
    li({order_id:9,line_item_id:1,sku:'gst073-m',quantity:2,price:50,product_type:'TEES'}), // counted, sku tidied
    li({order_id:10,line_item_id:1,sku:'GD007-28',quantity:4,product_type:'Jorts'}) // counted
  ];
  const orders=[{_id:'5',cancelled_at:'2026-09-02T00:00:00Z'},{_id:'1'}];
  const snapshot={items:{
    a:{sku:'GST073-S',available:10},
    b:{sku:'GST073-S',available:5},          // duplicate SKU -> summed 15
    c:{sku:'GST073-M',available:-4},         // negative -> 0
    d:{sku:'',available:7},                  // no sku
    e:{sku:'gst073-m',available:2},          // same SKU as c, tidied -> M = 0+2 = 2, duplicate
    f:{sku:'GD007-28',available:-1}          // negative -> 0
  }};
  R('var __c=_siClean({products:'+J(products)+',lineItems:'+J(lineItems)+',orders:'+J(orders)+',snapshot:'+J(snapshot)+'})');
  const Q=R('__c.quality');

  s.section('line items');
  eq('total',Q.lineItems.total,11);
  eq('refunded',Q.lineItems.refunded,1);
  eq('voided (case/space tolerant)',Q.lineItems.voided,2);
  eq('cancelled order',Q.lineItems.cancelledOrder,1);
  eq('duplicate by order_id+line_item_id',Q.lineItems.duplicateId,1);
  eq('no sku (empty and NO-SKU)',Q.lineItems.noSku,2);
  eq('bad date',Q.lineItems.badDate,1);
  eq('used = 3',Q.lineItems.used,3);
  eq('every row is either used or explained',Q.lineItems.total,Q.lineItems.used+Q.lineItems.refunded+Q.lineItems.voided+Q.lineItems.cancelledOrder+Q.lineItems.noSku+Q.lineItems.badDate+Q.lineItems.duplicateId);
  eq('units kept',R('__c.lineItems.map(r=>r.qty)'),[3,2,4]);
  eq('codes',R('__c.lineItems.map(r=>r.code)'),['GST073','GST073','GD007']);
  eq('voided still counted by the existing 7d/30d columns is flagged',Q.lineItems.voidedStillInExisting7d30d,2);

  s.section('products and SKUs');
  eq('empty SKU product skipped',Q.products.noSku,1);
  eq('duplicate SKU row ignored',Q.products.duplicateSkuRows,1);
  eq('first duplicate wins',R('__c.prodBySku.get("GST073-S").product_title'),'Tee');
  eq('used products',Q.products.used,3);
  eq('SKUs tidied (p2, li sku gst073-m, snapshot gst073-m)',Q.skuNormalised,3);
  eq('SKU normaliser',R('_siCleanSku("  gst073 -m ")'),'GST073-M');
  eq('NO-SKU is empty',R('_siCleanSku("no-sku")'),'');
  eq('article code',R('_siCleanCode("GCO001-T-M")'),'GCO001');

  s.section('stock');
  eq('entries',Q.snapshot.entries,6);
  eq('no-SKU entry skipped',Q.snapshot.noSku,1);
  eq('negative clamped',Q.snapshot.negativeClamped,2);
  eq('duplicate SKUs (GST073-S, GST073-M)',Q.snapshot.duplicateSkus,2);
  eq('extra entries',Q.snapshot.duplicateEntries,2);
  eq('S summed',R('__c.stock.find(x=>x.nsku==="GST073-S").available'),15);
  eq('M = clamp(-4)+2',R('__c.stock.find(x=>x.nsku==="GST073-M").available'),2);
  eq('jort clamped to 0',R('__c.stock.find(x=>x.nsku==="GD007-28").available'),0);

  s.section('categories');
  eq('3 raw spellings of tees + "Jorts" x2 -> 2 groups',Q.categories.groups,2);
  eq('spellings merged: Tees/tees/TEES -> 2 merged; Jorts 0 (whitespace collapses)',Q.categories.spellingsMerged,2);
  eq('most common spelling is the label (Tees x7)',R('_siCleanCategories(["Tees","Tees","tees ","TEES"]).label.get("tees")'),'Tees');
  eq('tie breaks A-Z',R('_siCleanCategories(["b","B"]).label.get("b")'),'B');
  eq('blank products counted',Q.categories.blankProducts,1);
  eq('blank -> Unknown on a cleaned row',R('_siClean({products:[],lineItems:[{sku:"A1-S",order_created_at:"2026-01-01",product_type:" "}]}).lineItems[0].cat'),'Unknown');

  s.section('integration with the index');
  R('_siProducts='+J(products)+';_siLineItems='+J(lineItems)+';_siOrders='+J(orders)+';_siSnapshot='+J(snapshot)+';_siAxCache=null');
  eq('articles',R('_siAxIndex().list.map(x=>x.code).sort()'),['GD007','GST073']);
  eq('units for the tee after cleaning',R('_siAxIndex().map.get("GST073").units'),5);
  eq('tee on hand = 15 + 2',R('_siAxIndex().map.get("GST073").onHand'),17);
  eq('tee category label',R('_siAxIndex().map.get("GST073").category'),'Tees');
  eq('size of a differently-cased SKU resolves',R('_siAxIndex().map.get("GST073").sizes.M'),2);
  eq('quality is on the index',R('_siAxIndex().quality.lineItems.used'),3);
  s.ok('expander is rendered and states the counts',/id="si-ax-quality"/.test(R('_siArticleExplorerSection()'))&&/3 of 11 line items counted, 8 left out/.test(R('_siCleanQualityHtml(_siAxIndex().quality)')));
  s.ok('voided discrepancy is stated',/still count the 2 voided/.test(R('_siCleanQualityHtml(_siAxIndex().quality)')));
  eq('existing 7d/30d helper is unchanged: still counts voided',R('_siLineItems.filter(l=>l.financial_status!=="refunded").length'),10);
  eq('input arrays are not mutated',R('_siProducts[1].sku'),' gst073-m ');
  eq('no new reads: only the builder\'s single stock-history read happens',reads,1);
  eq('empty input is safe',R('_siClean({}).quality.lineItems.total'),0);
  return s;
};

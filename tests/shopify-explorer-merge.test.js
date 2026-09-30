/* Article Explorer — voided / refunded units, non-merchandise left out, Enter-to-pick.
   Hand-computed fixture; the clock is pinned to 2026-08-31. Breaks are proven by tools in the session
   (each edit must fail a named check); see CLAUDE.md "Article Explorer". */
'use strict';
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
module.exports=async function(){
  const s=suite('shopify-explorer-merge');
  const a=harness.loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  const R=c=>a.run(c);
  const eq=(n,got,want)=>s.ok(n+' (got '+J(got)+', want '+J(want)+')',J(got)===J(want));
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));}');
  const li=(sku,q,day,extra)=>Object.assign({sku,quantity:q,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:'paid',product_title:'x'},extra||{});
  R('_siProducts='+J([
    {_id:'1',sku:'GA-M',product_title:'Alpha Tee',color:'Blue',size:'M',product_type:'Tees',price:1000,published_at:'2026-06-01T10:00:00+05:00'},
    {_id:'2',sku:'TIPQUIK-TG',product_title:'Tip/Gratuity',color:'',size:'',product_type:'',price:0.01,published_at:''},
    {_id:'3',sku:'GN-M',product_title:'No price tee',color:'Red',size:'M',product_type:'Tees',published_at:'2026-06-01T10:00:00+05:00'}]));
  R('_siLineItems='+J([
    li('GA-M',10,'2026-07-01'),li('GA-M',5,'2026-08-10'),
    li('GA-M',3,'2026-08-11',{financial_status:'voided'}),
    li('GA-M',2,'2026-08-12',{financial_status:'refunded'}),
    li('GA-M',4,'2026-05-01',{financial_status:'voided'}),            // before the counted window: not reported
    li('TIPQUIK-TG',11000,'2026-08-15',{price:0.01,product_title:'Tip/Gratuity'}),
    li('GN-M',6,'2026-08-05',{price:undefined})]));
  R('_siSnapshot={items:{}};_siAxCache=null');
  s.section('non-merchandise is identified by the data (every sale under Rs 1) and left out');
  eq('article list has no tip',R('_siAxIndex().list.map(x=>x.code).sort()'),['GA','GN']);
  eq('quality counts it',R('(q=>[q.lineItems.nonMerch,q.nonMerch.articles,q.nonMerch.examples])(_siAxIndex().quality)'),[1,1,['Tip/Gratuity']]);
  s.ok('expander names it',/non-merchandise[^<]*1 code, e\.g\. Tip\/Gratuity/.test(R('_siCleanQualityHtml(_siAxIndex().quality)')));
  eq('category share uses merchandise only (Tees = 15 + 6)',R('_siAxIndex().catUnits.get("Tees")'),21);
  eq('a line with no price is not evidence of non-merchandise',R('_siAxIndex().map.has("GN")'),true);
  s.section('voided and refunded units, same counted window, never inside net units');
  const st=R('(m=>[m.units,m.voided,m.refunded,Math.round(m.voidRate*1000)/1000,Math.round(m.refundRate*1000)/1000])(_siAxStats(_siAxIndex().map.get("GA")))');
  eq('net 15, voided 3 (the May one is before the window), refunded 2, void 3/20, refund 2/20',st,[15,3,2,0.15,0.1]);
  eq('no voids: rate is 0, not missing',R('_siAxStats(_siAxIndex().map.get("GN")).voidRate'),0);
  R('_siAxSel="GA";_siAxModeSel="search"');
  const body=R('_siAxSearchBody()');
  s.ok('Search shows Voided units and Refunded units tiles',/Voided units/.test(body)&&/void rate 15%/.test(body)&&/Refunded units/.test(body));
  R('_siAxModeSel="compare";_siAxCmp=["GA","GN"]');
  s.ok('Compare table carries the voided / void rate / refunded columns',/data-key="void"/.test(R('_siAxCompareBody()'))&&/data-key="vrate"/.test(R('_siAxCompareBody()'))&&/data-key="refund"/.test(R('_siAxCompareBody()')));
  s.ok('definitions explain the use and the limit',/payment, fraud or cancellation/.test(R('_siAxDefsHtml()'))&&/later refunds are not synced/i.test(R('_siAxDefsHtml()')));
  s.section('Enter in the search box');
  R('_siAxModeSel="search";_siAxSel="";_siAxQuery="alp";window.__f=[];var _e={value:"",innerHTML:"",focus(){window.__f.push("input");}};var _g=document.getElementById;document.getElementById=function(i){return i==="si-ax-input"?_e:null;};');
  const pd=R('(()=>{let p=0;window._siAxKey({key:"Enter",preventDefault(){p++;}});return p;})()');
  eq('Enter picks the top match',R('_siAxSel'),'GA');eq('and prevents the default',pd,1);
  eq('focus goes back to the search box',R('window.__f.length>0'),true);
  R('window._siAxKey({key:"a",preventDefault(){}});');eq('other keys do nothing',R('_siAxSel'),'GA');
  R('_siAxSel="";_siAxQuery="";window._siAxKey({key:"Enter",preventDefault(){}});');eq('Enter on an empty box does nothing',R('_siAxSel'),'');
  R('_siAxQuery="zzzz-nothing";window._siAxKey({key:"Enter",preventDefault(){}});');eq('no match: nothing picked',R('_siAxSel'),'');
  R('_siAxModeSel="compare";_siAxCmp=[];_siAxQuery="alp";window._siAxKey({key:"Enter",preventDefault(){}});');
  eq('Compare: Enter adds the top match',R('_siAxCmp'),['GA']);
  s.section('the same cleaning feeds yesterday-stock; scorecard sorts by class');
  R('_siAxModeSel="compare";_siAxCmp=["GA","GN"];_siSortState={};_siSnapshot={items:{x:{sku:"GA-M",available:5},y:{sku:"GA-M",available:-3},z:{sku:"ga-m ",available:2}}};_siPrevSnapshot={items:{x:{sku:"GA-M",available:4},y:{sku:"GA-M",available:-9},z:{sku:"ga-m ",available:1},n:{sku:"",available:50}}};_siAxCache=null');
  eq('today on hand = 5 + 0 (clamped) + 2',R('_siAxIndex().map.get("GA").onHand'),7);
  eq('a week ago = 4 + 0 (clamped) + 1, no-SKU skipped',R('_siAxIndex().map.get("GA").prevOnHand'),5);
  const sc=R('_siAxScorecardHtml([_siAxIndex().map.get("GA"),_siAxIndex().map.get("GN")])');
  s.ok('scorecard table defaults to class order and says so',/data-sort-note="ax-score"[^>]*>Sorted by <strong>Class<\/strong>, ascending — class order: Winner, Solid, Steady, Stock-constrained, Slow, Dead stock, Too early, Not rated/.test(sc));
  return s;
};

/* Inventory Intel: a read that returns ZERO documents must never show as a healthy full read (6 Oct 2026 regression).
   Live screen after main 4d695d5: "Last full refresh ... Line items: this is the full read", Products 0 variants, Orders 0, Line items 0,
   Inventory value PKR 0, Units sold 0, while the stock snapshot (a single-document read) was fine. Reproduced here by a Firestore that
   answers every collection query with an empty snapshot and no error (what the SDK does from its local cache when the client cannot
   reach the server). Before the fix the loader marked every stage done and rendered zeros; now each stage fails and the page says so.
   Hand-computed fixture: 1 product, 3 orders, 4 line items (T-1, T-2, T-40, T-80), 1 snapshot. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const flush=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));};

function fake(mode){
  const T=new Date(Date.now()+5*3600000).toISOString().slice(0,10);
  const D=k=>new Date(Date.now()-k*86400000).toISOString().slice(0,10)+'T10:00:00+05:00';
  const data={
    shopify_line_items:[1,2,40,80].map((k,i)=>({order_id:i+1,line_item_id:i+1,sku:'AA-S',quantity:1,price:100,order_created_at:D(k),financial_status:'paid'})),
    shopify_products:[{sku:'AA-S',product_title:'Alpha',color:'Red',size:'S',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v1'}],
    shopify_orders:[1,2,3].map(i=>({order_id:i,created_at:D(i),total_price:100}))};
  const snap={date:T,snapshot_at:new Date().toISOString(),items:{a:{sku:'AA-S',variant_id:'v1',available:5}}};
  const st={reads:{}};
  const g={
    collection:(db,n)=>({__c:n,cons:[]}),query:(c,...cons)=>({__c:c.__c,cons}),where:(f,op,v)=>({t:'where',f,op,v}),orderBy:()=>({}),limit:()=>({}),doc:(db,c,id)=>({c,id}),
    getDoc:async r=>{if(r.c==='shopify_inventory_snapshots'&&r.id===T)return{exists:()=>true,data:()=>snap};return{exists:()=>false};},
    getDocs:async q=>{
      const n=q.__c;st.reads[n]=(st.reads[n]||0)+1;
      let rows=data[n]||[];
      if(mode==='empty'&&n.indexOf('shopify_')===0&&n!=='shopify_weekly_closes')rows=[];
      q.cons.filter(c=>c.t==='where').forEach(c=>{if(c.op==='>=')rows=rows.filter(x=>String(x.order_created_at)>=c.v);if(c.op==='<')rows=rows.filter(x=>String(x.order_created_at)<c.v);});
      if(mode==='noorders'&&n==='shopify_orders')rows=[];
      const fromCache=mode==='cache';
      if(fromCache)rows=[];
      return{metadata:{fromCache},forEach:f=>rows.forEach((x,i)=>f({data:()=>Object.assign({},x),id:String(i)}))};
    }};
  return{g,st};
}
async function open(src,mode,extra){
  const fk=fake(mode);
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',
    globals:Object.assign({localStorage:{getItem:()=>null,setItem(){},removeItem(){}}},fk.g,extra||{})});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  a.run('_siLoadAutoPlan=function(){return null;}'); // no 2 s / 5 s retry waits: the stages end failed at once (the retry loop itself is held by shopify-progress)
  const p=a.run('loadShopifyData()');
  await p;await flush();
  return{fk,a,B:c=>a.run(c)};
}
async function checks(src){
  const o={};
  // 1. normal data: loads, counts are exactly the fixture's
  {
    const {B}=await open(src,'normal');
    o['normal: loaded, 1 product, 3 orders, 4 line items (90-day window holds all 4)']=B('_siLoaded')===true&&B('_siProducts.length')===1&&B('_siOrders.length')===3&&B('_siLineItems.length')===4;
    o['normal: the freshness card says this is the full read']=/Line items: this is the full read/.test(B('_siFrHtml()'));
  }
  // 2. every collection empty, no error: must NOT be a healthy load
  {
    const {B}=await open(src,'empty');
    o['empty: the load did NOT succeed (_siLoaded false)']=B('_siLoaded')===false;
    o['empty: the page error names the catalog and the line items']=/Catalog: Read 0 documents from shopify_products/.test(B('_siLoadError')||'')&&/Line items: Read 0 documents from shopify_line_items/.test(B('_siLoadError')||'');
    o['empty: neither stage is marked read (so the next visit and Retry re-read it)']=B('_siColl.products')===false&&B('_siColl.lines')===false&&B('_siCollectionsLoaded')===false;
    o['empty: never stamped as a full read']=B('_siLinesFullAt')===null&&B('_siLinesMode')==='';
    o['empty: the catalog and line-item stages are failed with a retry offered (view mode fail, retryable lines)']=B('(function(){const v=_siLoadView();return v.mode+"|"+v.retryable.join(",");})()')==='fail|products,lines';
    o['empty: weekly closes (may genuinely be empty) is not failed']=B('_siLoad.state.closes')==='done';
    o['empty: the render is the error card with Retry, not zeros']=/Retry/.test(B('renderShopifyDashboard()'))&&!/Products: <strong>0/.test(B('renderShopifyDashboard()'));
  }
  {
    const {B}=await open(src,'noorders');
    o['orders alone empty: the page still loads (orders only drop cancelled lines and are counted), 1 product, 4 lines']=B('_siLoaded')===true&&B('_siOrders.length')===0&&B('_siProducts.length')===1&&B('_siLineItems.length')===4;
  }
  // 3. served from the local cache: the message says so
  {
    const {B}=await open(src,'cache');
    o['cache: the message says it was answered from the local cache']=/local cache/.test(B('_siLoadError')||'')&&B('_siLoaded')===false;
  }
  // 4. data already held is never replaced by an empty refresh
  {
    const fk=fake('normal');
    const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',globals:Object.assign({localStorage:{getItem:()=>null,setItem(){},removeItem(){}}},fk.g)});
    vm.runInContext(src,a.ctx,{filename:'shopify.js'});
    await a.run('loadShopifyData()');await flush();
    const e=fake('empty');
    a.run('getDocs=undefined');
    a.ctx.getDocs=e.g.getDocs;
    let failed=false;try{await a.run('_siRunners.products(true)');}catch(x){failed=/Read 0 documents/.test(x.message);}
    o['refresh: an empty catalog read throws and the 1 product already held is kept']=failed&&a.run('_siProducts.length')===1;
    a.run('_siLinesForceFull=true');
    let f2=false;try{await a.run('_siRunners.lines(true)');}catch(x){f2=/Read 0 documents/.test(x.message);}
    o['refresh: an empty full line-item re-read throws and the 4 lines already held are kept']=f2&&a.run('_siLineItems.length')===4;
  }
  return o;
}
module.exports=async function(){
  const s=suite('shopify-nodata');
  s.section('a read of zero documents is an error, never a healthy full read');
  const base=await checks(SRC);
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks - each must fail the named checks');
  const names=Object.keys(base);
  const brk=async(label,from,to,failing)=>{
    if(SRC.indexOf(from)<0){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.replace(from,to));}catch(e){r=null;}
    const failed=names.filter(k=>!r||r[k]!==true);
    const hit=failing.filter(f=>failed.some(k=>k.indexOf(f)===0));
    s.ok('break "'+label+'" fails "'+failing.join('" and "')+'"',hit.length===failing.length,hit.length===failing.length?undefined:'failed: '+failed.slice(0,4).join(' | '));
  };
  await brk('catalog runner accepts empty',"if(!a.length&&(id==='products'))throw","if(false)throw",['empty: the page error names the catalog','refresh: an empty catalog read']);
  await brk('line-item window accepts empty',"if(!a.length)throw _siEmptyRead('shopify_line_items","if(false)throw _siEmptyRead('shopify_line_items",['empty: never stamped as a full read','refresh: an empty full line-item re-read']);
  await brk('weekly closes also required',"(id==='products'))throw","(true))throw",['empty: weekly closes']);
  await brk('cache cause not named',"(fromCache?' (answered from this device","(false?' (answered from this device",['cache: the message says']);
  return s;
};

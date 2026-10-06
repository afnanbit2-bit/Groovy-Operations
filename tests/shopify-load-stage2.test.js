/* Inventory Intel ▸ line items in two phases (load-time stage 2, Oct 2026).
   Phase 1 reads only the last 90 days of shopify_line_items (one single-field range on order_created_at); phase 2 reads ONLY THE REST
   (the disjoint '<' range) and only when a view that needs the whole history opens, or on the button. Every number is hand-computed;
   every "break" mutates the source and requires the named check to FAIL.
   Fixture (T = today, PKT; cut = T-90). Lines: AA-S 2 @T-1 (in), AA-S 3 @T-89 (in), AA-M 4 @T-90 (in: the cut day itself counts),
   CC-S 6 @T-5 (in, product went live T-10), AA-M 5 @T-91 (OLD), AA-S 4 @T-120 (OLD), BB-S 7 @T-200 (OLD, refunded).
   Window = 4 documents, older = 3, total 7. AA-S lifetime non-refunded = 2+3+4 = 9, in the window = 5. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const NCH=6; // js/shopify.js _SI_LINE_CHUNKS
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
const dayShift=(T,k)=>new Date(new Date(T+'T00:00:00Z').getTime()-k*86400000).toISOString().slice(0,10);

function fake(T,o){
  o=o||{};
  const st={reads:{},queries:[],failOlder:o.failOlder||0,failLinesWin:o.failLinesWin||0,log:[]};
  const D=k=>dayShift(T,k)+'T10:00:00+05:00';
  const lines=[
    {order_id:1,line_item_id:11,sku:'AA-S',quantity:2,price:100,order_created_at:D(1),financial_status:'paid'},
    {order_id:2,line_item_id:12,sku:'AA-S',quantity:3,price:100,order_created_at:D(89),financial_status:'paid'},
    {order_id:3,line_item_id:13,sku:'AA-M',quantity:4,price:100,order_created_at:D(90),financial_status:'paid'},
    {order_id:4,line_item_id:14,sku:'CC-S',quantity:6,price:50,order_created_at:D(5),financial_status:'paid'},
    {order_id:5,line_item_id:15,sku:'AA-M',quantity:5,price:100,order_created_at:D(91),financial_status:'paid'},
    {order_id:6,line_item_id:16,sku:'AA-S',quantity:4,price:100,order_created_at:D(120),financial_status:'paid'},
    {order_id:7,line_item_id:17,sku:'BB-S',quantity:7,price:100,order_created_at:D(200),financial_status:'refunded'}];
  const prods=[
    {sku:'AA-S',product_title:'Alpha',color:'Red',size:'S',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v1'},
    {sku:'AA-M',product_title:'Alpha',color:'Red',size:'M',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v2'},
    {sku:'CC-S',product_title:'Gamma',color:'Blue',size:'S',price:50,created_at:D(10),status:'active',tags:[],product_type:'Tee',variant_id:'v3'}];
  const snap={date:T,items:{a:{sku:'AA-S',variant_id:'v1',available:5},b:{sku:'AA-M',variant_id:'v2',available:3},c:{sku:'CC-S',variant_id:'v3',available:9}}};
  const g={
    collection:(db,name)=>({__c:name,cons:[]}),
    query:(c,...cons)=>({__c:c.__c,cons}),
    where:(f,op,v)=>({t:'where',f,op,v}),orderBy:(f,d)=>({t:'ob',f,d}),limit:n=>({t:'lim',n}),
    doc:(db,c,id)=>({c,id}),
    getDoc:async r=>(r.c==='shopify_inventory_snapshots'&&r.id===T)?{exists:()=>true,data:()=>snap}:{exists:()=>false},
    getDocs:async q=>{
      const name=q.__c;st.log.push(name);
      let rows=name==='shopify_line_items'?lines:name==='shopify_products'?prods.map(p=>Object.assign({},p)):[];
      if(name==='shopify_line_items'){
        st.queries.push(q.cons);
        const w=q.cons.filter(c=>c.t==='where');
        if(w.some(c=>c.op==='<')&&!w.some(c=>c.op==='>=')&&st.failOlder>0){st.failOlder--;throw new Error('older read refused');}
        if(w.some(c=>c.op==='>=')&&st.failLinesWin>0){st.failLinesWin--;const e=new Error('Missing or insufficient permissions');e.code='permission-denied';throw e;}
        w.forEach(c=>{if(c.f==='order_created_at'&&c.op==='>=')rows=rows.filter(x=>String(x.order_created_at)>=c.v);if(c.f==='order_created_at'&&c.op==='<')rows=rows.filter(x=>String(x.order_created_at)<c.v);});
      }
      st.reads[name]=(st.reads[name]||0)+rows.length;
      return{forEach:f=>rows.forEach((x,i)=>f({data:()=>Object.assign({},x),id:name==='shopify_line_items'?x.order_id+'_'+x.line_item_id:String(i)}))};
    }
  };
  if(o.noWhere)g.where=undefined;
  return{st,g};
}
function app(src,fk){
  const store={};
  const ls={getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',globals:Object.assign({localStorage:ls},fk.g)});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
async function checks(src){
  const o={};
  const T=app(src,fake('2000-01-01')).run('_siPktDate(0)'),cut=dayShift(T,90);
  const open=async(fo,page)=>{const fk=fake(T,fo),a=app(src,fk);if(page)a.run('currentPage="'+page+'"');await a.run('loadShopifyData()');return{fk,a,B:c=>a.run(c)};};
  const SEC='_siRenderSection(_siComputeMetrics(),_siComputeSkuTable())';

  // ── 1. phase 1 ──
  {
    const {fk,B}=await open();
    // Phase 1 is read as NCH disjoint date ranges of the SAME single field (6 Oct 2026: each range that lands moves the loading percentage).
    const P1=fk.st.queries.slice(0,NCH),ws=P1.map(q=>q.filter(c=>c.t==='where'));
    o['phase 1: the line-item read is single-field ranges only, order_created_at >= the cut day (no orderBy, no other field: no composite index)']=fk.st.queries.length===NCH&&P1.every((q,i)=>q.length===ws[i].length&&ws[i].every(c=>c.f==='order_created_at')&&ws[i][0].op==='>='&&(i<NCH-1?ws[i].length===2&&ws[i][1].op==='<':ws[i].length===1))&&ws[0][0].v===cut;
    o['phase 1: the ranges are contiguous and disjoint (each ends where the next starts; nothing read twice or missed)']=ws.slice(0,NCH-1).every((w,i)=>w[1].v===ws[i+1][0].v);
    o['phase 1: 4 documents read (not 7), the cut day itself is inside, scope window, loaded']=fk.st.reads.shopify_line_items===4&&B('_siLineItems.length')===4&&B('_siLinesScope')==='window'&&B('_siLinesCut')===cut&&B('_siLoaded')===true;
    o['phase 1: the products collection is read once, as before']=fk.st.reads.shopify_products===3;
    o['phase 1: the loader still has 7 stages weighted 4,10,50,1,14,3,18 (percentage untouched)']=B('_SI_STAGES.map(s=>s.w).join()')==='4,10,50,1,14,3,18';
  }
  // ── 2. partial figures are labelled, never shown as complete ──
  {
    const {B}=await open();
    const m={};JSON.parse(B('JSON.stringify(_siComputeSkuTable().map(r=>({s:r.sku,p:r.totalSoldPartial,t:r.totalSold})))')).forEach(r=>m[r.s]=r);
    o['SKU rows: a product live 300 days ago is partial (window count 5 is NOT shown as lifetime); one live 10 days ago is complete (6)']=m['AA-S'].p===true&&m['AA-S'].t===5&&m['CC-S'].p===false&&m['CC-S'].t===6;
    const cA=B('_siSoldSinceLiveCell(5,"x",true)'),cC=B('_siSoldSinceLiveCell(6,"'+dayShift(T,10)+'",false)');
    o['Sold since live: partial reads "needs full history" and no number; complete shows 6']=/needs full history/.test(cA)&&!/>5</.test(cA)&&/>6</.test(cC)&&!/needs full history/.test(cC);
    const grp=B('_siGroupedBodyHtml(_siComputeSkuTable())');
    o['SKU table body: Alpha says needs full history, Gamma shows 6']=/needs full history/.test(grp)&&/font-weight:600">6</.test(grp);
    const ov=B('_siOverview(_siComputeMetrics())');
    o['Overview: strip with the Load full history button and the window start; tiles read "needs full history", never a 0']=/Load full history/.test(ov)&&ov.indexOf(cut)>=0&&/si-na-tile/.test(ov)&&(ov.match(/needs full history/g)||[]).length>=2&&!/class="num">0</.test(ov);
    o['the tab pill is absent while partial (a class needs each article\'s whole history), even with the stock history loaded']=B('_siHistState="ok";_siNaBadge()')===null&&!/si-na-pill/.test(B('_siTabBar()'));
    o['Overview units 7d / 30d are real from the window: 2+6 = 8 in 7 days and in 30']=B('_siComputeMetrics().unitsSold7')===8&&B('_siComputeMetrics().unitsSold30')===8;
    const adv=B('(_siSection="today",_siSub="advanced",'+SEC+')');
    o['Advanced: Variant Aging, Returns Signal and Markdown Candidates say needs full history; Weeks of Supply and Reorder still render']=(adv.match(/si-full-need-card/g)||[]).length===3&&/Weeks of Supply by Category/.test(adv)&&/Reorder Points/.test(adv)&&/si-full-strip/.test(adv);
    o['Weekly Close does not use line items: no strip, no gate']=!/si-full/.test(B('(_siSection="today",_siSub="weekly",'+SEC+')'));
    o['the loader sub-line says the line items are the last 90 days']=/line items \(last 90 days\)/.test(B('_siLoadView().sub'));
  }
  // ── 3. phase 2: only when a view that needs it opens, once ──
  {
    const {fk,B}=await open();
    B('_siSection="today";_siSub=""');B(SEC);B('_siSection="skutable";_siSub=""');B(SEC);B('_siSection="today";_siSub="advanced"');B(SEC);B('_siSection="today";_siSub="weekly"');B(SEC);await flush();
    o['phase 2 is NOT started by Overview, SKU Table, Advanced or Weekly (no extra read)']=fk.st.reads.shopify_line_items===4&&B('_siFull.st')==='idle';
    B('_siSection="articles";_siSub=""');
    const gate=B(SEC);
    const gate2=B(SEC);
    o['opening the Explorer shows the gate (no percentage) and starts the read; a second open while loading starts nothing']=/id="si-full-gate"/.test(gate)&&/no percentage is shown/.test(gate)&&!/si-ld-num/.test(gate)&&B('_siFull.st')==='loading'&&/si-full-gate/.test(gate2)&&fk.st.queries.length===NCH+1;
    await flush();
    const q2=fk.st.queries[NCH]||[],w2=q2.filter(c=>c.t==='where');
    o['phase 2 reads ONLY the rest: one where order_created_at < the cut day']=w2.length===1&&w2[0].f==='order_created_at'&&w2[0].op==='<'&&w2[0].v===cut&&q2.length===1;
    o['phase 2: 3 older documents; total reads 7 = the old single read, nothing read twice']=fk.st.reads.shopify_line_items===7&&B('_siLineItems.length')===7&&B('_siFull.n')===3&&B('new Set(_siLineItems.map(l=>l._id)).size')===7;
    o['after phase 2: scope full, state done, gate gone, no "needs full history" on the SKU rows']=B('_siLinesScope')==='full'&&B('_siFull.st')==='done'&&!/si-full-gate/.test(B(SEC))&&!/needs full history/.test(B('_siGroupedBodyHtml(_siComputeSkuTable())'));
    o['after phase 2: AA-S lifetime is 2+3+4 = 9 (refunded BB-S not counted) and complete']=B('_siComputeSkuTable().find(r=>r.sku==="AA-S").totalSold')===9&&B('_siComputeSkuTable().find(r=>r.sku==="AA-S").totalSoldPartial')===false;
    B('_siSection="articles";_siSub=""');B(SEC);
    o['re-opening the Explorer after done reads nothing more']=fk.st.reads.shopify_line_items===7&&fk.st.queries.length===NCH+1;
    const adv=B('(_siSection="today",_siSub="advanced",'+SEC+')');
    o['after phase 2: Advanced renders Variant Aging and no strip']=/Variant Aging/.test(adv)&&!/si-full-need-card/.test(adv)&&!/si-full-strip/.test(adv);
  }
  // ── 4. the button ──
  {
    const {fk,B}=await open();
    B('window._siFullLoad()');await flush();
    o['the Load full history button reads the rest once and finishes']=B('_siLinesScope')==='full'&&fk.st.reads.shopify_line_items===7;
  }
  // ── 5. failure of phase 2: window kept, error shown, no loop, manual retry ──
  {
    const {fk,B}=await open({failOlder:1});
    B('_siSection="articles";_siSub=""');B(SEC);await flush();
    const g=B(SEC);await flush();
    o['phase 2 failed: the window data is kept, the page stays loaded, state failed with the reason']=B('_siLineItems.length')===4&&B('_siLoaded')===true&&B('_siFull.st')==='failed'&&/older read refused/.test(g);
    o['phase 2 failed: the gate says it could not read and offers Retry; rendering again does NOT restart the read (no loop)']=/Could not read the older line items/.test(g)&&/_siFullLoad/.test(g)&&fk.st.queries.length===NCH+1;
    B('window._siFullLoad()');await flush();
    o['phase 2 Retry: reads the rest, done, scope full']=B('_siFull.st')==='done'&&B('_siLinesScope')==='full'&&B('_siLineItems.length')===7&&fk.st.queries.length===NCH+2;
  }
  // ── 6. phase 1 per-collection retry still works ──
  {
    const {fk,B}=await open({failLinesWin:1});
    o['phase 1 refused (permission): only the line-item stage failed; nothing else was lost']=B('_siLoadFailedIds().join()')==='lines'&&B('_siColl.products')===true&&B('_siColl.orders')===true&&B('_siLinesScope')==='none';
    const before=fk.st.reads.shopify_products;
    B('window._siRetryStage("lines")');await flush();
    o['retrying the line-item stage re-reads the WINDOW only (products not read again)']=B('_siLinesScope')==='window'&&B('_siLineItems.length')===4&&fk.st.reads.shopify_products===before&&B('_siLoad.state.lines')==='done';
  }
  // ── 7. leaving the page, a missing bridge ──
  {
    const {B}=await open();
    B('_siSection="articles";_siSub=""');B(SEC);
    B('currentPage="dashboard"');await flush();
    o['the read that was in flight when the page was left still merges, and painting a page nobody is on does nothing']=B('_siLinesScope')==='full'&&B('_siLineItems.length')===7;
    const r=await open({noWhere:true},'dashboard');
    o['no where() bridge (an old cached index.html): phase 1 fails by name instead of reading everything silently']=r.B('_siLoadFailedIds().join()')==='lines'&&r.B('_siLinesScope')==='none';
  }
  // ── 8. data placed without the loader is never gated ──
  {
    const a=app(src,fake(T));
    o['no window read happened (scope none): nothing is gated, so injected data renders']=a.run('_siFullHist()')===true&&a.run('_siLinesPartial()')===false;
  }
  return o;
}
module.exports=async function(){
  const s=suite('shopify-load-stage2');
  s.section('two-phase line-item read');
  const base=await checks(SRC);
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  const names=Object.keys(base);
  const brk=async(label,from,to,failing)=>{
    if(SRC.indexOf(from)<0){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.replace(from,to));}catch(e){r=null;}
    const failed=names.filter(k=>!r||r[k]!==true);
    const hit=failing.filter(f=>failed.some(k=>k.indexOf(f)===0));
    s.ok('break "'+label+'" fails "'+failing.join('" and "')+'"',hit.length===failing.length,hit.length===failing.length?undefined:'failed: '+failed.slice(0,4).join(' | '));
  };
  await brk('phase 1 reads everything',":query(collection(db,'shopify_line_items'),where('order_created_at','>=',lo));",":collection(db,'shopify_line_items');",['phase 1: the line-item read is single-field','phase 1: 4 documents']);
  await brk('phase 2 reads everything again',"where('order_created_at','<',cut)","where('order_created_at','>=','0')",['phase 2 reads ONLY the rest','phase 2: 3 older documents']);
  await brk('older lines replace the window',"_siLineItems=siMergeLines(_siLineItems,a); // a new array (every","_siLineItems=a; // a new array (every",['phase 2: 3 older documents','after phase 2: AA-S lifetime']);
  await brk('the cut day is excluded',"where('order_created_at','>=',lo),where","where('order_created_at','>',lo+'Z'),where",['phase 1: 4 documents']);
  await brk('everything reads as full history',"function _siFullHist(){return _siLinesScope!=='window';}","function _siFullHist(){return true;}",['opening the Explorer shows the gate','the tab pill is absent while partial']);
  await brk('Overview starts the full read',"function _siOverview(m){\n  return _siFullStripHtml()+","function _siOverview(m){\n  _siFullStart(false);return _siFullStripHtml()+",['phase 2 is NOT started by Overview']);
  await brk('partial total shown as complete',"totalSoldPartial:_siLinesPartial()&&","totalSoldPartial:false&&",['SKU rows: a product live 300 days ago','SKU table body']);
  await brk('the pill counts from the window',"function _siNaBadge(){\n  if(!_siFullHist())return null;","function _siNaBadge(){\n  if(false)return null;",['the tab pill is absent while partial']);
  await brk('a second open restarts the read',"if(!_siLinesPartial()||F.st==='loading'||F.st==='done')return;","if(!_siLinesPartial()||F.st==='done')return;",['opening the Explorer shows the gate']);
  await brk('a failed read restarts by itself',"if(F.st==='failed'&&!manual)return;","",['phase 2 failed: the gate says it could not read']);
  await brk('the failure loses its reason',"F.st='failed';F.err=_siLoadErr(e);_siFullPaint();","F.st='failed';F.err=null;_siFullPaint();",['phase 2 failed: the window data is kept']);
  await brk('Advanced shows aging from the window',"${part?needCard('Variant Aging (first / last sold)'):","${false?needCard('Variant Aging (first / last sold)'):",['Advanced: Variant Aging, Returns Signal']);
  const css=fs.readFileSync(path.join(__dirname,'../css/main.css'),'utf8');
  s.section('source rules');
  s.ok('the load stages are unchanged and phase 2 is outside them',/id:'build'/.test(SRC)&&!/id:'older'|id:'linesfull'/.test(SRC));
  s.ok('CSS: the strip, gate and bar use tokens only',(()=>{const m=css.match(/\.si-full[^{]*\{[^}]*\}/g)||[];return m.length>=6&&m.every(x=>!/#[0-9a-fA-F]{3,8}\b/.test(x));})());
  s.ok('CSS: the indeterminate bar stops under reduced motion',/prefers-reduced-motion:reduce\)\{\.si-full-bar i\{animation:none/.test(css));
  return s;
};

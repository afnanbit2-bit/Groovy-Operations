/* ─────────────────────────────────────────────────────────────────────────
   js/warehouse-sales.js — Accounts, level 2: customer purchases at the
   warehouse (Sept 2026).

   Afnan: Umair records the walk-in customer purchases the ERP bills; the
   bill (photo or PDF) is required; customer name, phone, order # and — for
   pay later — a due date; discount at most 20%; articles searchable with a
   quantity. Owners review; the receivable into Raees's Store Accounts is
   the next step, not this one.

   These assertions DRIVE the real entry points (the form's save, the void,
   the review, the loader, the nav) and read back what was written — never
   the helpers alone, which would prove only the helpers. The rules file is
   read as text and held to the same lists and numbers as the JS, because a
   rule and a form that disagree is how a save gets refused in production
   with nothing wrong in either file.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const LS={getItem:()=>null,setItem(){},removeItem(){}};

const FILES=['js/store.js','js/store-accounts.js','js/fulfillment.js','js/warehouse-sales.js'];
const UMAIR={uid:'u-umair',u:'umair',name:'Umair',role:'fulfillment',email:'umair@groovy.op'};
const AFNAN={uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'};
const AMMAR={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'};
const MUSTAFA={uid:'u-mus',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'};
const RAEES={uid:'u-raees',u:'raees',name:'Raees',role:'store',email:'raees@groovy.op'};
const BILL={url:'https://res.cloudinary.com/deww4lpym/image/upload/v1/so0334.jpg',kind:'image',name:'so0334.jpg'};

// A tiny recording fake of the vendored SheetJS.
function fakeXlsx(rec){
  return{utils:{
    book_new:()=>({sheets:[]}),
    aoa_to_sheet:aoa=>({aoa}),
    book_append_sheet:(wb,ws,name)=>{wb.sheets.push({name,aoa:ws.aoa});}
  },writeFile:(wb,file)=>{rec.push({file,sheets:wb.sheets});}};
}

function app(o){
  o=o||{};
  const xlsx=[];
  const a=harness.loadApp({files:FILES,currentPage:'fulfillment',
    globals:Object.assign({localStorage:LS,XLSX:fakeXlsx(xlsx),auth:{currentUser:null}},o.globals||{})});
  a.xlsx=xlsx;
  a.run('session='+J(o.session||UMAIR));
  a.seed=(sales,catalog)=>a.run(`whSales=${J(sales||[])};_whsSort();whSalesLoaded=true;_whsSalesAt=Date.now();_whsLoadErr=null;_whsCatalog=${J(catalog||null)};1`);
  return a;
}
const CATALOG=[
  {id:'v1',sku:'GP092-M',title:'EFFORTLESS TEE | DEEP BLUE',variant:'Mint Green / M',price:3490,status:'active'},
  {id:'v2',sku:'GP092-L',title:'EFFORTLESS TEE | DEEP BLUE',variant:'Mint Green / L',price:3490,status:'active'},
  {id:'v3',sku:'GP090-M',title:'EFFORTLESS TEE | CLOUD',variant:'White / M',price:3290,status:'draft'},
  {id:'v4',sku:'GST001-M',title:'OLD TEE',variant:'Black / M',price:1990,status:'archived'},
  {id:'v5',sku:'GP0920-M',title:'SOMETHING ELSE',variant:'Red / M',price:999,status:'active'}
];
// A valid form, as whsBuildSale reads it; each test overrides one field.
function form(o){return Object.assign({
  orderNo:'SO0334',date:'2026-09-18',customerName:'Sheikh Bilal (Rare Project)',customerPhone:'03009225227',
  lines:[{variantId:'v1',sku:'GP092-M',code:'GP092',title:'EFFORTLESS TEE | DEEP BLUE',variant:'Mint Green / M',price:3490,catalogPrice:3490,qty:1}],
  discMode:'none',discVal:'',terms:'later',paidVia:'',dueDate:'2026-09-30',note:'Awaiting Payment',bill:BILL
},o||{});}
const CTX={today:'2026-09-25',uid:'u-umair',name:'Umair',u:'umair',now:1790000000000};
const sale=o=>Object.assign({_id:'SO1',orderNo:'SO1',date:'2026-09-20',customerName:'A',customerPhone:'03001112222',
  lines:[{title:'T',variant:'M',sku:'GP092-M',qty:2,price:1000,total:2000}],qtyTotal:2,subtotal:2000,discount:0,discountPct:0,total:2000,
  terms:'paid',paidVia:'cash',dueDate:null,status:'active',needsReview:false,reviewFlags:[],billUrl:BILL.url,billKind:'image',createdAt:1},o||{});

// The REST read of one sale that a confirmation makes first (_acctWhSaleNow):
// served from the app's own whSales unless a test says the server differs.
function saleGet(a,url,serverSales){
  const id=decodeURIComponent(String(url).split('/wh_sales/')[1].split('?')[0]);
  const sv=(serverSales&&serverSales[id])||a.run('whSales').find(x=>x._id===id);
  if(!sv)return{ok:false,status:404,json:async()=>({error:{status:'NOT_FOUND',message:'not found'}})};
  const clean=Object.assign({},sv);delete clean._id;
  return{ok:true,status:200,json:async()=>({name:'projects/p/databases/(default)/documents/wh_sales/'+id,fields:a.run('toFsFields')(clean)})};
}
module.exports=async function(){
  const s=suite('warehouse-sales');

  // ── who ────────────────────────────────────────────────────────────────
  s.section('the audience: Umair by username, the owners by role — nobody else');
  {
    const a=app();
    const can=u=>{a.run('session='+J(u));return a.run('whsCanView()');};
    s.eq('umair',can(UMAIR),true);
    s.eq('afnan',can(AFNAN),true);
    s.eq('ammar',can(AMMAR),true);
    s.eq('mustafa (a manager, who can see Courier Performance) cannot',can(MUSTAFA),false);
    s.eq('raees cannot — the receivable into his accounts is the next step',can(RAEES),false);
    s.eq('another fulfilment-role account cannot — it is a username, not the role',can({u:'zed',role:'fulfillment'}),false);
    a.run('session='+J(UMAIR));
    s.eq('umair holds no admin delete',a.run('_whsIsSuper()'),false);
    a.run('session='+J(AMMAR));
    s.eq('ammar does (the Store Accounts correction pair)',a.run('_whsIsSuper()'),true);
    const rules=read('firestore.rules');
    const auth=read('js/auth.js');
    const umairEmail=(/\{u:'umair',\s*email:'([^']+)'/.exec(auth)||[])[1];
    s.eq('USER_DEFS gives umair the email the rule names',umairEmail,'umair@groovy.op');
    s.ok('isWhSales() is the owners plus exactly that email',/function isWhSales\(\) \{ return isOwner\(\) \|\| \(signedIn\(\) && userEmail\(\) == 'umair@groovy\.op'\); \}/.test(rules));
    s.eq('the JS list is exactly umair',a.run('JSON.stringify(_WHS_USERS)'),'["umair"]');
  }

  // ── normalisers ────────────────────────────────────────────────────────
  s.section('order numbers, phones, bill URLs, article codes');
  {
    const a=app();
    const oid=v=>a.run('whsOrderId('+J(v)+')');
    s.eq('trimmed and upper-cased',oid(' so0334 '),'SO0334');
    s.eq('inner spaces dropped',oid('SO 0334'),'SO0334');
    s.eq('empty is no id',oid(''),'');
    s.eq('a slash can never be a document id',oid('SO/0334'),'');
    s.eq('a leading symbol is refused',oid('#0334'),'');
    const ph=v=>a.run('whsPhone('+J(v)+')');
    s.eq('11 digits',ph('03009225227'),'03009225227');
    s.eq('with a dash',ph('0300-9225227'),'03009225227');
    s.eq('+92 form',ph('+92 300 9225227'),'03009225227');
    s.eq('0092 form',ph('0092 300 9225227'),'03009225227');
    s.eq('without the leading 0',ph('3009225227'),'03009225227');
    s.eq('a Karachi landline',ph('021-34567890'),'02134567890');
    s.eq('too short is refused',ph('0300 12345'),'');
    s.eq('letters are refused',ph('call me'),'');
    s.eq('shown with a dash',a.run("whsFmtPhone('03009225227')"),'0300-9225227');
    const bu=v=>a.run('whsBillUrl('+J(v)+')');
    s.eq('a Cloudinary delivery url',bu(BILL.url),true);
    s.eq('a lookalike host is refused',bu('https://res.cloudinary.com.evil.test/x.jpg'),false);
    s.eq('http is refused',bu('http://res.cloudinary.com/x.jpg'),false);
    s.eq('a quote cannot ride in the url',bu('https://res.cloudinary.com/x"onerror="alert(1)'),false);
    s.eq('GP092-M is article GP092',a.run("whsArticleCode('GP092-M')"),'GP092');
    s.eq('a co-ord top keeps its -T',a.run("whsArticleCode('GCO001-T-M')"),'GCO001-T');
    s.eq('a code with no size',a.run("whsArticleCode('GHW001')"),'GHW001');
    s.eq('a foreign SKU has no code',a.run("whsArticleCode('TOPS-030')"),'');
    s.ok('the JS order-number rule and the firestore.rules one are the same pattern',
      read('firestore.rules').indexOf("orderNo.matches('^[A-Z0-9][A-Z0-9._-]{1,39}$')")>0&&read('js/warehouse-sales.js').indexOf('/^[A-Z0-9][A-Z0-9._-]{1,39}$/')>0);
  }

  // ── catalog ────────────────────────────────────────────────────────────
  s.section('the article search reads shopify_products and finds a barcode first');
  {
    const a=app();
    const v=JSON.parse(a.run(`JSON.stringify(whsCatalogFromDoc('123',{sku:'GP092-M',product_title:'EFFORTLESS TEE | DEEP BLUE',color:'Mint Green',size:'M',option3:'',price:3490.0,status:'active'}))`));
    s.eq('title',v.title,'EFFORTLESS TEE | DEEP BLUE');
    s.eq('variant is colour / size',v.variant,'Mint Green / M');
    s.eq('price in whole rupees',v.price,3490);
    s.eq('Default Title is not a variant',JSON.parse(a.run(`JSON.stringify(whsCatalogFromDoc('9',{product_title:'CAP',color:'Default Title',price:1}))`)).variant,'');
    const find=q=>JSON.parse(a.run(`JSON.stringify(whsSearchCatalog(${J(CATALOG)},${J(q)},8).map(v=>v.id))`));
    s.eq('an exact barcode ranks first, even with a longer SKU sharing its prefix',find('gp092-m')[0],'v1');
    s.eq('a SKU prefix finds every size of the article',J(find('GP092').slice(0,2).sort()),J(['v1','v2']));
    s.eq('every word must match the name',J(find('effortless cloud')),J(['v3']));
    s.ok('archived products are left out',find('old tee').length===0);
    const eff=find('effortless tee');
    s.ok('a draft ranks after both active matches',eff.length===3&&eff[2]==='v3'&&eff.slice(0,2).sort().join()==='v1,v2',J(eff));
    s.eq('nothing typed, nothing found',find('   ').length,0);
    s.eq('the limit holds',JSON.parse(a.run(`JSON.stringify(whsSearchCatalog(${J(CATALOG)},'m',2))`)).length,2);
  }
  // the loader: reuses Inventory Intel's copy, otherwise one read; never rejects
  {
    let reads=0;
    const a=app({globals:{getDocs:async()=>{reads++;return{docs:[{id:'v1',data:()=>({sku:'GP092-M',product_title:'T',price:10,status:'active'})}]};}}});
    await a.run('_whsLoadCatalog()');
    s.eq('one read of shopify_products when nothing is cached',reads,1);
    s.eq('mapped into the catalog',a.run('_whsCatalog.length'),1);
    await a.run('_whsLoadCatalog()');
    s.eq('and not read twice',reads,1);
    const b=app({globals:{getDocs:async()=>{throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});}}});
    let threw=false;try{await b.run('_whsLoadCatalog()');}catch(_){threw=true;}
    s.eq('a refused catalog read does not reject',threw,false);
    s.ok('it records why, for the form to say so',/permission/.test(b.run('_whsCatalogErr')));
  }

  // ── discount ───────────────────────────────────────────────────────────
  s.section('the discount: whole rupees, never past 20%');
  {
    const a=app();
    const d=(sub,m,v)=>JSON.parse(a.run(`JSON.stringify(whsDiscount(${sub},${J(m)},${J(v)}))`));
    s.eq('no discount is zero',d(3490,'none','').amount,0);
    s.eq('10% of 3490',d(3490,'pct','10').amount,349);
    s.eq('20% is allowed',d(3490,'pct','20').amount,698);
    s.eq('20% that would round a rupee past the cap is held at the cap',d(3493,'pct','20').amount,698);
    s.ok('20.5% is refused',/at most 20%/.test(d(3490,'pct','20.5').error||''));
    s.eq('Rs 698 on 3490 is allowed',d(3490,'rs','698').amount,698);
    const over=d(3490,'rs','699');
    s.ok('Rs 699 on 3490 is refused and names the cap',/Rs 698/.test(over.error||''));
    s.ok('a negative discount is refused',!!d(3490,'pct','-5').error);
    s.eq('a blank box is no discount',d(3490,'rs','').amount,0);
    s.eq('the percentage is recorded',d(3490,'rs','349').pct,10);
    // whatever the form produces, the rules' arithmetic accepts it
    let ok=true,bad='';
    for(let sub=1;sub<=5000;sub+=37){for(const p of [0,1,5,12.5,19.99,20]){const r=d(sub,'pct',String(p));if(r.error||r.amount*100>sub*20){ok=false;bad=sub+'@'+p;}}}
    s.ok('every percentage up to 20 on every subtotal passes discount*100 <= subtotal*20',ok,bad||undefined);
    s.eq('WHS_MAX_DISCOUNT_PCT is 20',a.run('WHS_MAX_DISCOUNT_PCT'),20);
    s.ok('firestore.rules holds the same 20',/d\.discount \* 100 <= d\.subtotal \* 20/.test((/function whSaleValid\(d, orderNo\) \{([\s\S]*?)\n    \}/.exec(read('firestore.rules'))||[])[1]||''));
  }

  // ── building the sale ──────────────────────────────────────────────────
  s.section('what a sale becomes — the happy path');
  {
    const a=app();
    const r=JSON.parse(a.run(`JSON.stringify(whsBuildSale(${J(form())},${J(CTX)}))`));
    s.eq('no error',r.error,undefined);
    s.eq('the document id is the order number',r.id,'SO0334');
    const d=r.data||{};
    s.eq('order number',d.orderNo,'SO0334');
    s.eq('date',d.date,'2026-09-18');
    s.eq('month for range reads',d.month,'2026-09');
    s.eq('customer',d.customerName,'Sheikh Bilal (Rare Project)');
    s.eq('phone as digits',d.customerPhone,'03009225227');
    s.eq('pay later',d.terms,'later');
    s.eq('due date',d.dueDate,'2026-09-30');
    s.eq('no paid-via on a pay-later sale',d.paidVia,null);
    s.eq('subtotal',d.subtotal,3490);
    s.eq('total',d.total,3490);
    s.eq('items',d.qtyTotal,1);
    s.eq('the bill is on the sale',d.billUrl,BILL.url);
    s.eq('status active',d.status,'active');
    s.eq('recorded by the uid the rules check',d.createdBy,'u-umair');
    s.eq('not flagged',d.needsReview,false);
    const l=(d.lines||[])[0]||{};
    s.ok('the line is a SNAPSHOT — title, variant, barcode, article code, prices',l.title==='EFFORTLESS TEE | DEEP BLUE'&&l.variant==='Mint Green / M'&&l.sku==='GP092-M'&&l.code==='GP092'&&l.price===3490&&l.catalogPrice===3490&&l.total===3490,J(l));
    s.ok('nothing written is an array of arrays (Firestore refuses those)',!/\[\s*\[/.test(J(d)));
  }
  s.section('what is refused, and what each refusal says');
  {
    const a=app();
    const err=o=>JSON.parse(a.run(`JSON.stringify(whsBuildSale(${J(form(o))},${J(CTX)}))`)).error||'';
    s.ok('no bill',/Attach the bill/.test(err({bill:{}})));
    s.ok('a bill that is not a Cloudinary url',/Attach the bill/.test(err({bill:{url:'https://example.com/x.jpg'}})));
    s.ok('no order number',/order number/.test(err({orderNo:''})));
    s.ok('a date in the future',/future/.test(err({date:'2026-09-26'})));
    s.ok('an impossible date',/date of the sale/.test(err({date:'2026-02-31'})));
    s.ok('no customer name',/customer's name/.test(err({customerName:'  '})));
    s.ok('a phone that is not a phone',/phone number/.test(err({customerPhone:'12345'})));
    s.ok('no articles',/at least one article/.test(err({lines:[]})));
    const L=o=>[Object.assign({},form().lines[0],o)];
    s.ok('quantity 0',/quantity/.test(err({lines:L({qty:0})})));
    s.ok('quantity 1.5',/quantity/.test(err({lines:L({qty:'1.5'})})));
    s.ok('a blank quantity',/quantity/.test(err({lines:L({qty:''})})));
    s.ok('a zero price',/price/.test(err({lines:L({price:0})})));
    s.ok('a line not linked to the catalog',/not linked/.test(err({lines:L({variantId:''})})));
    s.ok('an unlisted article with no name',/not in the list/.test(err({lines:[{manual:true,title:'',qty:1,price:500}]})));
    s.ok('a discount past 20%',/at most 20%/.test(err({discMode:'pct',discVal:'25'})));
    s.ok('no way of paying chosen',/paid now, or pay later/.test(err({terms:''})));
    s.ok('paid now without cash or bank',/cash or bank/.test(err({terms:'paid',paidVia:''})));
    s.ok('pay later without a due date',/due date/.test(err({terms:'later',dueDate:''})));
    s.ok('a due date before the sale',/before the date/.test(err({terms:'later',dueDate:'2026-09-17'})));
    s.eq('a due date ON the sale date is fine',err({terms:'later',dueDate:'2026-09-18'}),'');
    s.eq('paid in cash needs no due date',err({terms:'paid',paidVia:'cash',dueDate:''}),'');
  }
  s.section('money on a multi-line bill, and what gets flagged for review');
  {
    const a=app();
    const lines=[
      {variantId:'v1',sku:'GP092-M',title:'EFFORTLESS TEE',variant:'Mint Green / M',price:3490,catalogPrice:3490,qty:'2'},
      {variantId:'v2',sku:'GP092-L',title:'EFFORTLESS TEE',variant:'Mint Green / L',price:'3200',catalogPrice:3490,qty:1},
      {manual:true,title:'B-stock hoodie',price:'1500',qty:1}
    ];
    const r=JSON.parse(a.run(`JSON.stringify(whsBuildSale(${J(form({lines,discMode:'rs',discVal:'1000',terms:'paid',paidVia:'cash'}))},${J(CTX)}))`));
    const d=r.data||{};
    s.eq('subtotal = 2×3490 + 3200 + 1500',d.subtotal,11680);
    s.eq('discount in rupees',d.discount,1000);
    s.eq('the percentage is recorded beside it',d.discountPct,8.56);
    s.eq('total = subtotal − discount',d.total,10680);
    s.eq('items = the quantities summed',d.qtyTotal,4);
    s.eq('paid via cash',d.paidVia,'cash');
    s.eq('no due date on a paid sale',d.dueDate,null);
    s.eq('a changed price and an unlisted article flag it for review',d.needsReview,true);
    s.eq('both named',J(d.reviewFlags),J(['price changed on 1 article','1 article not in the catalog']));
    s.ok('the changed line keeps the catalog price beside the charged one',d.lines&&d.lines[1].priceEdited===true&&d.lines[1].catalogPrice===3490&&d.lines[1].price===3200);
    s.ok('the unlisted line is marked',d.lines&&d.lines[2].manual===true&&d.lines[2].catalogPrice===undefined);
    s.ok('every amount is a whole rupee',[d.subtotal,d.discount,d.total].concat((d.lines||[]).map(l=>l.total)).every(Number.isInteger));
  }

  // ── saving ─────────────────────────────────────────────────────────────
  s.section('Save sale: one transaction, the order number is the id, a duplicate is refused by name');
  {
    const sets=[],gets=[];
    let existing=null;
    const tx={get:async ref=>{gets.push(ref);return{exists:()=>!!existing,data:()=>existing};},set:(ref,data)=>{sets.push({ref,data});}};
    const mk=o=>app(Object.assign({globals:{
      doc:(db,col,id)=>({col,id}),
      runTransaction:async(db,fn)=>fn(tx)
    }},o||{}));
    const a=mk();
    a.seed([],CATALOG);
    a.run('window.whsNewSale()');
    s.ok('the form opens as a modal',/Record a customer purchase/.test(a.bodyHtml('whs-modal')));
    s.ok('it asks for the bill first, photo or PDF',/Take a photo/.test(a.bodyHtml('whs-modal'))&&/accept="image\/\*,application\/pdf,\.pdf"/.test(a.bodyHtml('whs-modal')));
    a.run("window.whsPick('v1')");
    a.run("window.whsPick('v1')");
    s.eq('picking the same size twice is one line of 2',a.run('JSON.stringify(_whsDraft.lines.map(l=>[l.sku,l.qty]))'),J([['GP092-M',2]]));
    a.run("window.whsChip('terms','paid')");a.run("window.whsChip('via','cash')");
    a.el('whs-order').value='so0334';a.el('whs-date').value='2026-09-18';
    a.el('whs-name').value='Sheikh Bilal';a.el('whs-phone').value='0300 9225227';
    // no bill yet
    await a.run('window.whsSaveSale()');
    s.ok('without the bill nothing is saved',sets.length===0&&a.state.toasts.some(t=>/Attach the bill/.test(t)));
    a.run(`_whsDraft.bill=${J(BILL)}`);
    await a.run('window.whsSaveSale()');
    s.eq('one write',sets.length,1);
    s.ok('to wh_sales/SO0334',sets[0]&&sets[0].ref.col==='wh_sales'&&sets[0].ref.id==='SO0334',J(sets[0]&&sets[0].ref));
    s.ok('read first, in the same transaction',gets.length===1&&gets[0].id==='SO0334');
    s.eq('the written total',sets[0]&&sets[0].data.total,6980);
    s.eq('it is in the list at once',a.run("whSales.map(x=>x._id).join(',')"),'SO0334');
    s.ok('logged',a.state.activity.some(x=>x.action==='Warehouse sale recorded'&&/SO0334/.test(x.detail)));
    s.ok('the form is closed and forgotten',a.run('_whsDraft')===null);
    // a second entry of the same bill, already in memory
    a.run('window.whsNewSale()');a.run("window.whsPick('v2')");a.run("window.whsChip('terms','paid')");a.run("window.whsChip('via','bank')");
    a.el('whs-order').value='SO0334';a.run(`_whsDraft.bill=${J(BILL)}`);
    const before=sets.length;
    await a.run('window.whsSaveSale()');
    s.eq('a bill already in the list is refused without a write',sets.length,before);
    s.ok('and the refusal names the order',a.state.toasts.some(t=>/SO0334 is already recorded/.test(t)));
    // a duplicate the server knows about but this device does not
    const b=mk();b.seed([],CATALOG);
    existing={orderNo:'SO0999',date:'2026-09-20',createdByName:'Afnan'};
    b.run('window.whsNewSale()');b.run("window.whsPick('v1')");b.run("window.whsChip('terms','paid')");b.run("window.whsChip('via','cash')");
    b.el('whs-order').value='SO0999';b.el('whs-date').value='2026-09-20';b.el('whs-name').value='X';b.el('whs-phone').value='03001234567';
    b.run(`_whsDraft.bill=${J(BILL)}`);
    const n=sets.length;
    await b.run('window.whsSaveSale()');
    s.eq('a duplicate on the server is refused inside the transaction',sets.length,n);
    s.ok('and says who recorded it',b.state.toasts.some(t=>/SO0999 is already recorded .*by Afnan/.test(t)));
    s.ok('the form stays open to correct it',b.run('_whsDraft!==null'));
    existing=null;
    // a refused write says what to do about it
    const c=app({globals:{doc:()=>({}),runTransaction:async()=>{throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});}}});
    c.seed([],CATALOG);c.run('window.whsNewSale()');c.run("window.whsPick('v1')");c.run("window.whsChip('terms','paid')");c.run("window.whsChip('via','cash')");
    c.el('whs-order').value='SO1000';c.el('whs-date').value='2026-09-20';c.el('whs-name').value='X';c.el('whs-phone').value='03001234567';
    c.run(`_whsDraft.bill=${J(BILL)}`);
    await c.run('window.whsSaveSale()');
    s.ok('a refused save names the rules republish',c.state.toasts.some(t=>/republish firestore\.rules/.test(t)));
    s.eq('and is not added to the list',c.run('whSales.length'),0);
    // still uploading
    const u=mk();u.seed([],CATALOG);u.run('window.whsNewSale()');u.run('_whsDraft.uploading=true');
    const m=sets.length;await u.run('window.whsSaveSale()');
    s.ok('a save while the bill is uploading waits',sets.length===m&&u.state.toasts.some(t=>/finish uploading/.test(t)));
    // someone outside the audience
    const x=mk({session:MUSTAFA});x.seed([],CATALOG);
    x.run('window.whsNewSale()');
    s.eq('a manager cannot open the form',x.bodyCount('whs-modal'),0);
    x.run(`_whsDraft={lines:[],discMode:'none',terms:'paid',paidVia:'cash',bill:${J(BILL)}}`);
    const k=sets.length;await x.run('window.whsSaveSale()');
    s.eq('nor save one by calling it directly',sets.length,k);
  }
  s.section('the form: search, Enter picks the first hit (a barcode scanner), lines, summary');
  {
    const a=app();a.seed([],CATALOG);
    a.run('window.whsNewSale()');
    a.el('whs-q').value='GP092-M';
    a.run('window.whsSearchInput()');
    s.ok('the barcode is the first hit',/GP092-M/.test(a.el('whs-results').innerHTML)&&a.run('_whsHits[0].id')==='v1');
    let prevented=false;
    a.run('window.whsSearchKey')({key:'Enter',preventDefault(){prevented=true;}});
    s.ok('Enter adds it',a.run('_whsDraft.lines.length')===1&&prevented);
    s.eq('and clears the box for the next scan',a.el('whs-q').value,'');
    a.run("window.whsLineSet(0,'qty','3')");
    s.eq('the quantity is typed in',a.run('_whsDraft.lines[0].qty'),'3');
    s.ok('the line total follows without rebuilding the line',/10,470/.test(a.el('whs-ltot-0').textContent));
    s.ok('and the summary',/10,470/.test(a.el('whs-sum').innerHTML));
    a.run("window.whsLineSet(0,'price','3000')");
    s.ok('a price other than the catalog one is flagged on the line',/Catalog price is Rs 3,490/.test(a.el('whs-lflag-0').innerHTML));
    a.run('window.whsAddManual()');
    s.eq('an article not in the list can be added',a.run('_whsDraft.lines[1].manual'),true);
    a.run('window.whsLineRemove(1)');
    s.eq('and removed',a.run('_whsDraft.lines.length'),1);
    a.run("window.whsChip('disc','pct')");a.el('whs-disc').value='25';a.run('window.whsPaintSummary()');
    s.ok('a discount past the cap is said in the summary',/at most 20%/.test(a.el('whs-sum').innerHTML));
    a.el('whs-disc').value='10';a.run('window.whsPaintSummary()');
    s.ok('10% of 9000 shows as −Rs 900 and a total of Rs 8,100',/−Rs 900/.test(a.el('whs-sum').innerHTML)&&/Rs 8,100/.test(a.el('whs-sum').innerHTML));
    // a known customer: the phone fills the name
    const b=app();b.seed([sale({customerName:'Sheikh Bilal',customerPhone:'03009225227'})],CATALOG);
    b.run('window.whsNewSale()');b.el('whs-name').value='';
    b.run("window.whsPhoneBlur('0300-9225227')");
    s.eq('a returning customer’s phone fills the name',b.el('whs-name').value,'Sheikh Bilal');
    b.el('whs-phone').value='';b.run("window.whsNameInput('sheikh bilal')");
    s.eq('and the name fills the phone',b.el('whs-phone').value,'0300-9225227');
  }
  s.section('the bill upload: /auto/upload (a PDF is accepted), and the URL is checked on the way back');
  {
    class FD{constructor(){this.p=[];}append(k,v){this.p.push([k,v]);}}
    const calls=[];
    const mk=url=>{const a=app({globals:{FormData:FD,fetch:async(u,init)=>{calls.push(String(u));return{ok:true,status:200,json:async()=>({secure_url:url,format:'pdf'})};}}});a.seed([],CATALOG);a.run('window.whsNewSale()');return a;};
    const a=mk('https://res.cloudinary.com/deww4lpym/image/upload/v1/bill.pdf');
    const inp={files:[{name:'SO0334.pdf',type:'application/pdf',size:120000}],value:'x'};
    await a.run('window.whsBillPicked')(inp);
    s.ok('it posts to /auto/upload',calls.some(u=>/\/auto\/upload$/.test(u)));
    s.eq('a PDF is attached as a PDF',a.run('_whsDraft.bill.kind'),'pdf');
    s.ok('the status says so',/PDF attached/.test(a.el('whs-bill-st').innerHTML));
    s.eq('the picker is cleared for a retake',inp.value,'');
    const b=mk('https://res.cloudinary.com.evil.test/x.jpg');
    await b.run('window.whsBillPicked')({files:[{name:'b.jpg',type:'image/jpeg',size:1000}],value:''});
    s.eq('a url that is not Cloudinary is not kept',b.run('_whsDraft.bill'),null);
    s.ok('and the failure is said',/did not upload/.test(b.el('whs-bill-st').innerHTML));
    const c=mk('https://res.cloudinary.com/x/y.jpg');
    const n=calls.length;
    await c.run('window.whsBillPicked')({files:[{name:'notes.docx',type:'application/msword',size:1000}],value:''});
    s.ok('a file that is neither a photo nor a PDF is refused before uploading',calls.length===n&&/neither a photo nor a PDF/.test(c.el('whs-bill-st').innerHTML));
    await c.run('window.whsBillPicked')({files:[{name:'huge.jpg',type:'image/jpeg',size:20*1048576}],value:''});
    s.ok('an oversized file is refused before uploading',calls.length===n&&/15 MB at most/.test(c.el('whs-bill-st').innerHTML));
  }

  // ── void / review / delete ─────────────────────────────────────────────
  s.section('void, review, delete — and the rules allow exactly those fields');
  {
    const rules=read('firestore.rules');
    const block=(/match \/wh_sales\/\{orderNo\} \{([\s\S]*?)\n    \}/.exec(rules)||[])[1]||'';
    s.ok('wh_sales has a rules block',block.length>0);
    const lists=[...block.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)].map(m=>m[1].replace(/'/g,'').split(',').map(x=>x.trim()));
    const a=app();
    s.eq('the void list in the rules is the JS one',J(lists[0]),a.run('JSON.stringify(_WHS_VOID_FIELDS)'));
    s.eq('the review list in the rules is the JS one',J(lists[1]),a.run('JSON.stringify(_WHS_REVIEW_FIELDS)'));
    s.ok('only isWhSales may void, and only from active to void',/isWhSales\(\)\s*&& resource\.data\.status == 'active' && request\.resource\.data\.status == 'void'/.test(block));
    s.ok('only an owner may clear a review flag',/\|\| \(isOwner\(\)\s*&& request\.resource\.data\.diff/.test(block));
    s.ok('delete is the correction pair',/allow delete: if isAcctSuper\(\);/.test(block));
    s.ok('read is the audience, plus Store Accounts (Raees confirms the handover)',/allow read: if isWhSales\(\) \|\| isStoreAccounts\(\);/.test(block));
    s.ok('… and Store Accounts never WRITES a sale',!/allow (create|update|delete)[^;]*isStoreAccounts/.test(block));
    // One definition of a valid sale, used by the create AND by recording a
    // bill again over a void — a re-record is held to every create check.
    const valid=(/function whSaleValid\(d, orderNo\) \{([\s\S]*?)\n    \}/.exec(rules)||[])[1]||'';
    s.ok('a valid sale requires the bill, the uid, a pay-later due date and the exact total',
      /billUrl\.matches\('\^https:\/\/res\[\.\]cloudinary\[\.\]com\/\.\+'\)/.test(valid)&&/d\.createdBy == request\.auth\.uid/.test(valid)&&/d\.terms == 'paid' \|\| d\.dueDate is string/.test(valid)&&/d\.total == d\.subtotal - d\.discount/.test(valid)&&/d\.status == 'active'/.test(valid)&&/d\.orderNo == orderNo/.test(valid));
    s.ok('and binds who recorded it to the signed-in email',/d\.createdByU \+ '@groovy\.op' == userEmail\(\)/.test(valid));
    s.ok('the create goes through it',/allow create: if isWhSales\(\)\s*&& orderNo\.matches\([^)]*\)\s*&& whSaleValid\(request\.resource\.data, orderNo\);/.test(block));
    s.ok('recording again is only over a VOID, through the same checks, and the history grows by one',
      /resource\.data\.status == 'void'\s*&& whSaleValid\(request\.resource\.data, orderNo\)\s*&& request\.resource\.data\.priorVoids is list\s*&& request\.resource\.data\.priorVoids\.size\(\) == resource\.data\.get\('priorVoids', \[\]\)\.size\(\) \+ 1/.test(block));
    s.ok('a void and a review are bound to the signed-in email too',
      /request\.resource\.data\.voidedBy \+ '@groovy\.op' == userEmail\(\)/.test(block)&&/request\.resource\.data\.reviewedBy \+ '@groovy\.op' == userEmail\(\)/.test(block));

    const writes=[];
    const mk=sess=>{const x=app({session:sess,globals:{doc:(db,col,id)=>({col,id}),updateDoc:async(ref,p)=>{writes.push({ref,p});},deleteDoc:async ref=>{writes.push({ref,del:true});}}});x.seed([sale({_id:'SO1',needsReview:true,reviewFlags:['price changed on 1 article']})],CATALOG);return x;};
    const u=mk(UMAIR);
    u.ctx.prompt=()=>'Customer returned it';
    await u.run("window.whsVoid('SO1')");
    s.eq('umair voids',writes.length,1);
    s.ok('writing only the void fields',writes[0]&&Object.keys(writes[0].p).every(k=>u.run('_WHS_VOID_FIELDS').includes(k))&&writes[0].p.status==='void'&&writes[0].p.voidReason==='Customer returned it',J(writes[0]&&writes[0].p));
    s.eq('the sale is struck through at once',u.run("whSales[0].status"),'void');
    const u2=mk(UMAIR);u2.ctx.prompt=()=>'';
    const w=writes.length;await u2.run("window.whsVoid('SO1')");
    s.ok('no reason, no void',writes.length===w&&u2.state.toasts.some(t=>/reason/.test(t)));
    await u2.run("window.whsMarkReviewed('SO1')");
    s.eq('umair cannot clear a review flag',writes.length,w);
    await u2.run("window.whsDelete('SO1')");
    s.eq('nor delete',writes.length,w);
    const o=mk(AFNAN);
    await o.run("window.whsMarkReviewed('SO1')");
    s.ok('an owner marks it reviewed, writing only the review fields',writes.length===w+1&&Object.keys(writes[w].p).every(k=>o.run('_WHS_REVIEW_FIELDS').includes(k))&&writes[w].p.needsReview===false);
    await o.run("window.whsDelete('SO1')");
    s.ok('afnan deletes, after a confirm that says there is no undo',writes.length===w+2&&writes[w+1].del&&o.state.confirms.some(c=>/no undo/.test(c)));
    s.eq('and it is gone from the list',o.run('whSales.length'),0);
    const m=mk(MUSTAFA);m.ctx.prompt=()=>'x';
    const v=writes.length;await m.run("window.whsVoid('SO1')");
    s.eq('a manager cannot void',writes.length,v);
  }

  // ── reading ────────────────────────────────────────────────────────────
  s.section('the ledger: tiles, filters, search — and a failed read is not an empty list');
  {
    const a=app();
    const today='2026-09-25';
    const list=[
      sale({_id:'A',orderNo:'A',date:today,total:1000,terms:'paid',paidVia:'cash'}),
      sale({_id:'B',orderNo:'B',date:'2026-09-10',total:2000,terms:'later',dueDate:'2026-09-20',customerPhone:'03005550000'}),
      sale({_id:'C',orderNo:'C',date:'2026-09-24',total:3000,terms:'later',dueDate:'2026-10-05',customerPhone:'03005550000'}),
      sale({_id:'D',orderNo:'D',date:today,total:9999,terms:'later',dueDate:'2026-09-01',status:'void'}),
      sale({_id:'E',orderNo:'E',date:'2026-08-30',total:500,needsReview:true})
    ];
    const sum=JSON.parse(a.run(`JSON.stringify(whsSummary(${J(list)},'${today}'))`));
    s.eq('today, void left out',sum.todayTotal,1000);
    s.eq('this month',sum.monthTotal,6000);
    s.eq('pay later to collect',sum.laterTotal,5000);
    s.eq('from one customer (same phone)',sum.laterCustomers,1);
    s.eq('overdue is the one past its due date',sum.overdueTotal,2000);
    s.eq('needs review',sum.reviewCount,1);
    const f=(flt,q)=>JSON.parse(a.run(`JSON.stringify(whsFilterSales(${J(list)},${J(flt)},${J(q||'')},'${today}').map(x=>x._id))`));
    s.eq('overdue filter',J(f('overdue')),J(['B']));
    s.eq('pay later leaves out the void',J(f('later')),J(['B','C']));
    s.eq('void filter',J(f('void')),J(['D']));
    s.eq('review filter',J(f('review')),J(['E']));
    s.eq('a phone number finds the customer',J(f('all','0300-555')),J(['B','C']));
    s.eq('an article barcode finds the sale',f('all','gp092-m').length,5);
    // the loader never rejects, and a failure is an error card
    const b=app({globals:{getDocs:async()=>{throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});}}});
    let threw=false;try{await b.run('loadWhSales()');}catch(_){threw=true;}
    s.eq('a refused read does not reject',threw,false);
    s.eq('and counts as loaded, so it is not retried in a loop',b.run('whSalesLoaded'),true);
    const html=b.run('whsSectionHTML()');
    s.ok('it renders as a failure, naming the collection and the republish',/could not be read/.test(html)&&/wh_sales/.test(html)&&/republish firestore\.rules/.test(html));
    s.ok('and NOT as "no sales recorded yet"',!/No sales recorded yet/.test(html));
    const c=app({globals:{getDocs:async()=>({docs:[{id:'SO9',data:()=>sale({orderNo:'SO9',date:'2026-09-01'})},{id:'SO8',data:()=>sale({orderNo:'SO8',date:'2026-09-21'})}]})}});
    await c.run('loadWhSales()');
    s.eq('read newest sale date first',c.run("whSales.map(x=>x._id).join(',')"),'SO8,SO9');
  }
  s.section('stored text is escaped wherever it is drawn');
  {
    const evil='<img src=x onerror=alert(1)>';
    const a=app({session:AFNAN});
    a.seed([sale({_id:'X1',orderNo:'X1',customerName:evil,note:evil,lines:[{title:evil,variant:evil,sku:evil,qty:1,price:10,total:10}]})],CATALOG);
    a.run("_fulfillSection='accounts'");
    const list=a.run('whsSectionHTML()');
    s.ok('the list never carries the raw tag',list.indexOf('<img src=x')<0&&list.indexOf('&lt;img src=x')>=0);
    a.run("window.whsOpen('X1')");
    const det=a.bodyHtml('whs-modal');
    s.ok('nor the sale detail',det.indexOf('<img src=x')<0&&det.indexOf('&lt;img src=x')>=0);
    const b=app();b.seed([sale({customerName:evil})],CATALOG);b.run('window.whsNewSale()');
    s.ok('nor the customer suggestions in the form',b.bodyHtml('whs-modal').indexOf('<img src=x')<0);
  }
  s.section('Excel: two sheets, what is on screen');
  {
    const a=app();
    a.seed([sale({_id:'A',orderNo:'A'}),sale({_id:'B',orderNo:'B',status:'void'})],CATALOG);
    a.run("_whsFilter='void'");
    a.run('window.whsExport()');
    const w=a.xlsx[0]||{sheets:[]};
    s.eq('Sales and Articles',w.sheets.map(x=>x.name).join(','),'Sales,Articles');
    s.eq('only the filtered sale',w.sheets[0]&&w.sheets[0].aoa.length,2);
    s.eq('the void one',w.sheets[0]&&w.sheets[0].aoa[1][1],'B');
  }

  // ── where it lives ─────────────────────────────────────────────────────
  s.section('Umair’s page: a third section, for Umair and the owners only');
  {
    const bar=sess=>{const a=app({session:sess});return a.run('_fulfillSectionBar()');};
    s.ok('umair sees Accounts',/switchFulfillSection\('accounts'\)/.test(bar(UMAIR)));
    s.ok('afnan sees Accounts',/switchFulfillSection\('accounts'\)/.test(bar(AFNAN)));
    s.ok('mustafa sees Courier Performance without it',!/'accounts'/.test(bar(MUSTAFA))&&/'postex'/.test(bar(MUSTAFA)));
    const a=app();a.seed([],CATALOG);
    a.run("window.showFulfillTab('accounts')");
    s.eq('showFulfillTab(accounts) opens the section',a.run('_fulfillSection'),'accounts');
    const page=a.run('renderFulfillmentPage()');
    s.ok('the page is titled Accounts and carries the ledger',/page-title">Accounts</.test(page)&&/id="whs-root"/.test(page));
    const m=app({session:MUSTAFA});
    m.run("window.showFulfillTab('accounts')");
    s.eq('a manager asking for it stays on Daily Reporting',m.run('_fulfillSection'),'reporting');
    m.run("_fulfillSection='accounts'");
    s.ok('and a forced section renders the reporting page, not the ledger',!/whs-root/.test(m.run('renderFulfillmentPage()')));
    s.eq('which also resets the section',m.run('_fulfillSection'),'reporting');
  }
  s.section('Umair’s nav: an Accounts item on the sidebar and a fourth phone button');
  {
    const NAV=['js/shared.js','js/auth.js','js/embellishments.js','js/hrm.js','js/store.js','js/store-accounts.js','js/fulfillment.js','js/warehouse-sales.js'];
    const nav=sess=>{
      const a=harness.loadApp({files:NAV,currentPage:'fulfillment',globals:{localStorage:LS}});
      a.run('session='+J(sess));a.run('buildNav()');
      return{side:a.el('sidebar').innerHTML||'',mob:a.el('mob-nav').innerHTML||'',cls:a.el('mob-nav').className};
    };
    const u=nav(UMAIR);
    s.ok('the sidebar has Accounts',/id="nav-fulfillment-accounts"/.test(u.side)&&/showFulfillTab\('accounts'\)/.test(u.side));
    s.ok('the phone bar has four buttons',(u.mob.match(/class="mob-nav-btn"/g)||[]).length===4&&/fulfillment-accounts/.test(u.mob));
    s.eq('in a four-column grid',u.cls,'cols-4');
    const other=nav({uid:'z',u:'zed',name:'Zed',role:'fulfillment',email:'zed@groovy.op'});
    s.ok('a fulfilment account that is not umair keeps three buttons and no Accounts',(other.mob.match(/class="mob-nav-btn"/g)||[]).length===3&&other.cls==='cols-3'&&!/accounts/.test(other.side));
    // the showPage scope is untouched: Umair still reaches one page
    const a=harness.loadApp({files:NAV,currentPage:'fulfillment',globals:{localStorage:LS}});
    a.run('session='+J(UMAIR));
    a.run('renderPage=function(id){globalThis.__got=id;}');
    await a.run("window.showPage('users')");
    s.eq('umair is still scoped to his one page',a.run('__got'),'fulfillment');
  }
  // ── the adversarial review (25 Sept 2026): each confirmed finding ─────
  s.section('review: a voided bill can be recorded again — the one correction Umair has');
  {
    // an in-memory wh_sales the transaction reads and writes, so a save, a
    // void and a second save are one story
    const store={};const sets=[];
    const tx={get:async ref=>({exists:()=>!!store[ref.id],data:()=>store[ref.id]}),set:(ref,data)=>{sets.push({ref,data});store[ref.id]=JSON.parse(J(data));}};
    const a=app({globals:{doc:(db,col,id)=>({col,id}),runTransaction:async(db,fn)=>fn(tx),
      updateDoc:async(ref,p)=>{Object.assign(store[ref.id],p);}}});
    a.seed([],CATALOG);
    const fill=(qty)=>{
      a.run('window.whsNewSale()');
      a.run("window.whsPick('v1')");a.run(`window.whsLineSet(0,'qty','${qty}')`);
      a.run("window.whsChip('terms','paid')");a.run("window.whsChip('via','cash')");
      a.el('whs-order').value='SO0334';a.el('whs-date').value='2026-09-18';
      a.el('whs-name').value='Sheikh Bilal';a.el('whs-phone').value='03009225227';
      a.run(`_whsDraft.bill=${J(BILL)}`);
    };
    fill(3);await a.run('window.whsSaveSale()');
    s.eq('the first entry is written',sets.length,1);
    a.ctx.prompt=()=>'wrong qty';
    await a.run("window.whsVoid('SO0334')");
    s.eq('and voided',store.SO0334&&store.SO0334.status,'void');
    a.run("window.whsOpen('SO0334')");
    const detail=a.bodyHtml('whs-modal');
    s.ok('the voided sale offers "Record this bill again"',/whsNewSale\('SO0334'\)/.test(detail)&&/Record this bill again/.test(detail));
    a.run("window.whsNewSale('SO0334')");
    s.eq('which opens the form holding the voided entry',a.el('whs-order').value,'SO0334');
    s.ok('its customer, articles, payment and bill',a.el('whs-name').value==='Sheikh Bilal'&&a.run('_whsDraft.lines.length')===1&&a.run('_whsDraft.terms')==='paid'&&a.run('_whsDraft.bill.url')===BILL.url);
    a.run("window.whsLineSet(0,'qty','1')");
    const conf=a.state.confirms.length;
    await a.run('window.whsSaveSale()');
    s.eq('the corrected entry is written over the void',sets.length,2);
    s.ok('as an active sale with the right quantity',store.SO0334.status==='active'&&store.SO0334.qtyTotal===1);
    const pv=(store.SO0334&&Array.isArray(store.SO0334.priorVoids))?store.SO0334.priorVoids:[];
    s.eq('carrying the voided entry in its history',pv.length,1);
    s.ok('which says what was voided and why',!!pv[0]&&pv[0].qtyTotal===3&&pv[0].voidReason==='wrong qty'&&pv[0].voidedBy==='umair',J(pv[0]));
    s.ok('no nested arrays in the history (Firestore refuses them)',pv.length>0&&!pv.some(x=>Object.values(x).some(Array.isArray)));
    s.eq('opened from the void, it does not ask again',a.state.confirms.length,conf);
    s.eq('the list holds ONE SO0334',a.run("whSales.filter(x=>x._id==='SO0334').length"),1);
    s.ok('logged as recorded again',a.state.activity.some(x=>x.action==='Warehouse sale recorded again'));
    a.run("window.whsOpen('SO0334')");
    s.ok('and the detail shows the history',/Recorded before and voided/.test(a.bodyHtml('whs-modal'))&&/wrong qty/.test(a.bodyHtml('whs-modal')));
    // an ACTIVE sale is still one bill, one sale
    fill(2);const n=sets.length;await a.run('window.whsSaveSale()');
    s.ok('recording over an ACTIVE sale is still refused by name',sets.length===n&&a.state.toasts.some(t=>/SO0334 is already recorded/.test(t)&&/void it, and record the bill again/.test(t)));
    // typed in from scratch over a void: asked first, and a no writes nothing
    a.ctx.prompt=()=>'typo';await a.run("window.whsVoid('SO0334')");
    const asked=[];a.ctx.confirm=q=>{asked.push(String(q));return false;};
    fill(1);const m=sets.length;await a.run('window.whsSaveSale()');
    s.eq('typed over a void, it asks first — and no means nothing is written',sets.length,m);
    s.ok('the question names the void and its reason',asked.length===1&&/SO0334 was recorded before and voided \(typo\)/.test(asked[0]),J(asked));
  }
  s.section('review: the order-number search no longer matches phone numbers');
  {
    const a=app();
    const sales=[sale({_id:'SO0334',orderNo:'SO0334',customerPhone:'03009225227'}),sale({_id:'SO0101',orderNo:'SO0101',customerPhone:'03341234567'}),sale({_id:'SO0102',orderNo:'SO0102',customerPhone:'03001112222'})];
    a.seed(sales,CATALOG);
    const f=q=>a.run(`whsFilterSales(whSales,'all',${J(q)},'2026-09-25').map(x=>x._id).sort().join(',')`);
    s.eq('SO0334 finds SO0334 only',f('SO0334'),'SO0334');
    s.eq('an order never recorded finds nothing',f('SO0300'),'');
    s.eq('a phone still finds its sale',f('0300 9225227'),'SO0334');
    s.eq('and in +92 form',f('+92 300 9225227'),'SO0334');
    s.eq('and 0092 form',f('0092-300-9225227'),'SO0334');
    s.eq('and a tail of digits',f('9225227'),'SO0334');
    s.eq('a phone-only fragment matches the phone',f('1234567'),'SO0101');
    s.eq('0334 finds the order that says 0334 and the phone that starts with it — both honest',f('0334'),'SO0101,SO0334');
  }
  s.section('review: the name autofill takes its phone back when the name moves on');
  {
    const a=app();a.seed([sale({customerName:'Ali',customerPhone:'03001112222'})],CATALOG);
    a.run('window.whsNewSale()');a.el('whs-phone').value='';
    for(const v of ['A','Al','Ali','Ali ','Ali R','Ali Raza']){a.el('whs-name').value=v;a.run(`window.whsNameInput(${J(v)})`);}
    s.eq('typing a new customer "Ali Raza" leaves the phone empty',a.el('whs-phone').value,'');
    a.el('whs-name').value='Ali';a.run("window.whsNameInput('Ali')");
    s.eq('the known customer "Ali" still fills it',a.el('whs-phone').value,'0300-1112222');
    a.el('whs-phone').value='0300-5555555';
    a.run("window.whsNameInput('Ali R')");
    s.eq('a phone Umair edited is his and stays',a.el('whs-phone').value,'0300-5555555');
  }
  s.section('review: two bill uploads in flight — the latest pick wins');
  {
    class FD{constructor(){this.p=[];}append(k,v){this.p.push([k,v]);}}
    const pending=[];
    const a=app({globals:{FormData:FD,fetch:(u,init)=>new Promise(res=>{pending.push(url=>res({ok:true,status:200,json:async()=>({secure_url:url,format:/pdf$/.test(url)?'pdf':'jpg'})}));})}});
    a.seed([],CATALOG);a.run('window.whsNewSale()');
    const pick=a.run('window.whsBillPicked');
    const first=pick({files:[{name:'wrong.jpg',type:'image/jpeg',size:1000}],value:''});
    const second=pick({files:[{name:'SO0334.pdf',type:'application/pdf',size:1000}],value:''});
    await new Promise(r=>setTimeout(r,0));
    pending[1]('https://res.cloudinary.com/x/image/upload/SO0334.pdf');await second;
    s.eq('the PDF (picked last) lands',a.run('_whsDraft.bill.name'),'SO0334.pdf');
    s.eq('and it is no longer uploading',a.run('_whsDraft.uploading'),false);
    pending[0]('https://res.cloudinary.com/x/image/upload/wrong.jpg');await first;
    s.eq('the earlier photo finishing late does not replace it',a.run('_whsDraft.bill.name'),'SO0334.pdf');
    // while the first of two is still running, it is still uploading
    const b=app({globals:{FormData:FD,fetch:(u,init)=>new Promise(res=>{pending.push(url=>res({ok:true,status:200,json:async()=>({secure_url:url,format:'jpg'})}));})}});
    b.seed([],CATALOG);b.run('window.whsNewSale()');
    const p0=pending.length;const pk=b.run('window.whsBillPicked');
    const x1=pk({files:[{name:'a.jpg',type:'image/jpeg',size:1000}],value:''});
    const x2=pk({files:[{name:'b.jpg',type:'image/jpeg',size:1000}],value:''});
    await new Promise(r=>setTimeout(r,0));
    pending[p0]('https://res.cloudinary.com/x/image/upload/a.jpg');await x1;
    s.eq('the earlier upload finishing does not end "uploading" — the latest is still running',b.run('_whsDraft.uploading'),true);
    b.run('window.whsBillClear()');
    pending[p0+1]('https://res.cloudinary.com/x/image/upload/b.jpg');await x2;
    s.eq('removed mid-upload, the bill does not come back when it lands',b.run('_whsDraft.bill'),null);
  }
  s.section('review: prices, quantities and phones say what the rule really is');
  {
    const a=app();
    const b=o=>a.run('JSON.stringify(whsBuildSale('+J(form(o))+','+J(CTX)+'))');
    const one=(price,qty)=>({lines:[{variantId:'v1',sku:'GP092-M',title:'T',variant:'M',price,catalogPrice:3490,qty:qty||1}]});
    s.ok('Rs 0.4 is refused — it would be stored as Rs 0',/at least Rs 1/.test(JSON.parse(b(one('0.4'))).error||''));
    s.ok('Rs 0.6 rounds to Rs 1 and is accepted',JSON.parse(b(one('0.6'))).data&&JSON.parse(b(one('0.6'))).data.subtotal===1);
    s.ok('a quantity of 10,000 names the cap',/from 1 to 9,999/.test(JSON.parse(b(one('10',10000))).error||''));
    s.eq('the summary does not total a quantity the save refuses',a.run(`JSON.stringify(whsLineTotals([{qty:10000,price:10}]))`),J({qty:0,subtotal:0}));
    const ph=v=>a.run('whsPhone('+J(v)+')');
    s.eq('a mobile with a digit missing is refused',ph('0300123456'),'');
    s.eq('a 10-digit landline is kept',ph('051-1234567'),'0511234567');
    s.eq('an 11-digit landline is kept',ph('021-34567890'),'02134567890');
    s.eq('a number starting 00 is refused',ph('0012345678'),'');
  }
  s.section('review: a stray Enter in a fresh form adds nothing');
  {
    const a=app();a.seed([],CATALOG);
    a.run('window.whsNewSale()');a.el('whs-q').value='GP092-M';a.run('window.whsSearchInput()');
    a.run('window.whsModalClose()');
    a.run('window.whsNewSale()');
    s.eq('a new form starts with no search results left over',a.run('_whsHits.length'),0);
    a.el('whs-q').value='';
    a.run('window.whsSearchKey')({key:'Enter',preventDefault(){}});
    s.eq('the previous form\'s hit is not added',a.run('_whsDraft.lines.length'),0);
    a.run(`_whsHits=${J([CATALOG[0]])}`);
    a.run('window.whsSearchKey')({key:'Enter',preventDefault(){}});
    s.eq('and Enter on an EMPTY box adds nothing, whatever hits are held',a.run('_whsDraft.lines.length'),0);
    a.el('whs-q').value='GP092-M';a.run('window.whsSearchInput()');
    a.run('window.whsSearchKey')({key:'Enter',preventDefault(){}});
    s.eq('a real scan still adds',a.run('_whsDraft.lines.length'),1);
  }
  s.section('review: the load cap is said, and who did it is read from the bound username');
  {
    const docs=Array.from({length:1000},(_,i)=>({id:'SO'+i,data:()=>sale({_id:undefined,orderNo:'SO'+i,createdAt:i})}));
    const a=app({globals:{getDocs:async()=>({docs}),query:()=>({}),collection:()=>({}),orderBy:()=>({}),limit:()=>({})}});
    await a.run('loadWhSales(true)');a.run("_fulfillSection='accounts'");
    s.ok('a read that hits the cap says older sales are left out',/Only the newest 1,000 sales are loaded/.test(a.run('whsSectionHTML()')));
    const b=app();b.seed([sale()],CATALOG);
    s.ok('an ordinary ledger says nothing about a cap',!/Only the newest/.test((b.run("_fulfillSection='accounts'"),b.run('whsSectionHTML()'))));
    const c=app();
    c.run(`globalThis.USER_DEFS=${J([{u:'umair',name:'Umair'},{u:'afnan',name:'Afnan'}])}`);
    c.seed([sale({_id:'SO9',orderNo:'SO9',createdByU:'umair',createdByName:'Afnan',status:'void',voidedBy:'umair',voidedByName:'Afnan',voidReason:'x'})],CATALOG);
    c.run("window.whsOpen('SO9')");
    const h=c.bodyHtml('whs-modal');
    s.ok('"Recorded by" names the username the rules bind, not the free-text name',/Recorded by<\/span><b>Umair/.test(h)&&!/Recorded by<\/span><b>Afnan/.test(h));
    s.ok('and so does the void line',/\(Umair/.test(h));
  }
  s.section('review: Umair\'s page — a render error is not swallowed, and the highlight follows the page');
  {
    const a=app();a.seed([],CATALOG);
    a.run('fulfillReportsLoaded=true');
    a.run("window.showPage=async function(id){renderPage(id);};renderPage=function(id){document.getElementById('main-content').innerHTML=renderFulfillmentPage();}");
    a.run("whsSectionHTML=function(){throw new Error('render boom');}");
    let rejected=null;
    try{await a.run("window.showFulfillTab('accounts')");}catch(e){rejected=e;}
    s.ok('the tap\'s promise rejects with the render error (so diagnostics records it)',rejected&&/render boom/.test(rejected.message));
    const src=read('js/fulfillment.js');
    s.ok('showFulfillTab no longer catches',!/showPage\('fulfillment'\)\)\.then\(/.test(src));
    const b=app();b.seed([],CATALOG);b.run("_fulfillSection='accounts'");
    const acc=b.el('nav-fulfillment-accounts'),cp=b.el('nav-fulfillment');
    cp.classList.add('on');acc.classList.remove('on');   // what showPage does, via the logo
    b.run('renderFulfillmentPage()');
    s.ok('rendering the Accounts section lights Accounts, however it was reached',acc.classList.contains('on')&&!cp.classList.contains('on'));
  }
  s.section('review: a toast wraps on a phone instead of running off both edges');
  {
    const css=read('css/main.css');
    const rule=(/\n\.toast\{([^}]*)\}/.exec(css)||[])[1]||'';
    s.ok('the toast no longer refuses to wrap',rule&&!/white-space:nowrap/.test(rule));
    s.ok('and is kept inside the screen',/max-width:calc\(100vw - 32px\)/.test(rule)&&/width:max-content/.test(rule));
    s.ok('a long toast stays up longer, and a new one cancels the old timer',/clearTimeout\(_toastTimer\)/.test(read('js/shared.js'))&&/length\*60/.test(read('js/shared.js')));
  }
  // ══ The handover to Raees (26 Sept 2026) ══════════════════════════════
  s.section('handover: what money a sale put in hand');
  {
    const a=app();
    const m=o=>a.run(`whsMoneyIn(${J(sale(o))})`);
    s.eq('paid in cash → the cash drawer',J(m({})&&[m({}).account,m({}).amount,m({}).kind]),J(['cash',2000,'paid']));
    s.eq('paid by bank transfer → MCB',m({paidVia:'bank'}).account,'mcb');
    s.eq('a pay-later bill not yet collected puts nothing in hand',m({terms:'later',paidVia:null,dueDate:'2026-09-30'}),null);
    const col=m({terms:'later',paidVia:null,dueDate:'2026-09-30',collectedAt:5,collectedBy:'umair',collectedVia:'bank',collectedDate:'2026-09-24'})||{};
    s.eq('… once collected by bank it goes to MCB, dated the day it was paid',J([col.account,col.date,col.kind]),J(['mcb','2026-09-24','collected']));
    s.eq('a void sale puts nothing in hand',m({status:'void'}),null);
    s.eq('the key carries the version: first recording',a.run(`whsHandKey(${J(sale())})`),'SO1#0');
    s.eq('… a bill recorded again after a void is a new sale',a.run(`whsHandKey(${J(sale({priorVoids:[{total:1}]}))})`),'SO1#1');
  }
  s.section('handover: the queue is derived from the sales and the confirmations');
  {
    const a=app();
    const sales=[sale({_id:'SO1',orderNo:'SO1'}),sale({_id:'SO2',orderNo:'SO2',paidVia:'bank',total:3000}),sale({_id:'SO3',orderNo:'SO3',terms:'later',paidVia:null,dueDate:'2026-10-01'}),
      sale({_id:'SO4',orderNo:'SO4',status:'void'}),sale({_id:'SO5',orderNo:'SO5',priorVoids:[{total:2000}]})];
    const C=(id,o)=>Object.assign({_id:'whs_'+id+'_0',whSale:id+'#0',whOrder:id,amount:2000,whSaleTotal:2000,account:'cash',status:'posted'},o||{});
    const confs=[C('SO2',{amount:3000,whSaleTotal:3000,account:'mcb'}),C('SO1',{status:'void'}),C('SO4'),C('SO5')];
    const r=a.run(`whsHandovers(${J(sales)},${J(confs)})`);
    s.eq('three sales put money in hand (paid ×2 + the re-recorded one)',r.items.map(i=>i.key).sort().join(','),'SO1#0,SO2#0,SO5#1');
    s.eq('waiting: only the one never confirmed (its confirmation was voided)',r.pending.map(i=>i.key).sort().join(','),'SO1#0');
    s.eq('received is summed from the live confirmations',r.items.find(i=>i.key==='SO2#0').received,3000);
    s.eq('orphans: money confirmed for a sale voided since',r.orphans.map(e=>e._id).sort().join(','),'whs_SO4_0');
    s.eq('an uncollected pay-later bill is not in the queue',r.items.some(i=>i.key==='SO3#0'),false);
    // THE review finding: the customer paid once. A bill voided and recorded
    // again after Raees received it must not ask him to receive it again.
    const re=r.items.find(i=>i.key==='SO5#1');
    s.ok('a bill voided and recorded again is covered by the money already received',!!re&&re.confs.length===1&&re.received===2000);
    s.ok('… it says the confirmation was for the earlier entry, and nothing changed',re&&re.earlier===true&&re.changed===false);
    s.eq('… so it is neither waiting nor changed',r.changed.length,0);
    // re-recorded with another total, and a collection moved from bank to cash
    const r2=a.run(`whsHandovers(${J([sale({_id:'SO6',orderNo:'SO6',total:2500,subtotal:2500,priorVoids:[{total:2000}]}),
      sale({_id:'SO8',orderNo:'SO8',terms:'later',paidVia:null,dueDate:'2026-10-01',collectedAt:5,collectedVia:'cash',collectedDate:'2026-09-24'})])},${J([C('SO6'),C('SO8',{account:'mcb'})])})`);
    s.eq('a bill confirmed and then changed is CHANGED, not waiting again',J([r2.pending.length,r2.changed.map(i=>i.key).sort()]),J([0,['SO6#1','SO8#0']]));
    // the read cap: a confirmation whose sale is not in the read at all
    const r3=a.run(`whsHandovers(${J([sale({_id:'SO4',orderNo:'SO4',status:'void'})])},${J([C('SO4'),C('SO99')])},{truncated:true})`);
    s.eq('capped read: a sale not read is OUTSIDE, never an orphan',J([r3.orphans.map(e=>e._id),r3.outside.map(e=>e._id)]),J([['whs_SO4_0'],['whs_SO99_0']]));
    const r4=a.run(`whsHandovers([],${J([C('SO99')])})`);
    s.eq('… uncapped, a confirmation with no sale at all is an orphan (the sale was deleted)',r4.orphans.length,1);
    s.eq('an old confirmation without whOrder is matched by the order in whSale',a.run(`whsConfOrder({whSale:'SO7#2'})`),'SO7');
  }
  s.section('review: a date that is not a day never reaches Raees\'s page');
  {
    const a=app();
    const bad='<img src=x onerror=alert(1)>';
    s.eq('a paid sale with a bad date puts money in hand with no date',a.run(`whsMoneyIn(${J(sale({date:bad}))}).date`),'');
    const b=app({session:RAEES});b.run('acctEntries=[];acctVendors=[];acctCloses=[];acctSettings=null;_acctLoaded=true;1');
    b.seed([sale({date:bad}),sale({_id:'SO2',orderNo:'SO2',date:bad})]);b.run('whsConfirmations=[];whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr=null;1');
    const h=b.run('_acctWhBodyHTML()');
    s.ok('the list carries no markup from the date, and no Confirm-all for a non-day',!/<img/.test(h)&&!/acctWhConfirmDay\(/.test(h)&&/No date/.test(h));
    s.eq('the entry would carry no date either',b.run(`_acctWhEntry({key:'SO1#0',sale:${J(sale({date:bad}))},money:whsMoneyIn(${J(sale({date:bad}))})},2000,'').whSaleDate`),'');
    const wsv=(/function whSaleValid[\s\S]*?\n    \}/.exec(read('firestore.rules'))||[''])[0];
    s.ok('the rules hold the sale date to a day (inside whSaleValid)',/d\.date is string && d\.date\.matches\('\^\[0-9\]\{4\}/.test(wsv));
  }
  s.section('collecting a pay-later bill');
  {
    const a=app();
    const later=sale({terms:'later',paidVia:null,dueDate:'2026-09-30',date:'2026-09-20'});
    const P=(sv,f)=>a.run(`whsCollectPatch(${J(sv)},${J(f)},${J({today:'2026-09-26',u:'umair',name:'Umair',now:9})})`);
    s.ok('a paid sale cannot be "collected"',!!P(sale(),{via:'cash',date:'2026-09-26'}).error);
    s.ok('a void one cannot',!!P(Object.assign({},later,{status:'void'}),{via:'cash',date:'2026-09-26'}).error);
    s.ok('an already collected one cannot',!!P(Object.assign({},later,{collectedAt:1,collectedVia:'cash',collectedDate:'2026-09-25'}),{via:'cash',date:'2026-09-26'}).error);
    s.ok('how it was paid is required',/cash or bank/.test(P(later,{via:'',date:'2026-09-26'}).error||''));
    s.ok('not in the future',/future/.test(P(later,{via:'cash',date:'2026-09-27'}).error||''));
    s.ok('not before the sale',/before the sale/.test(P(later,{via:'cash',date:'2026-09-19'}).error||''));
    const ok=P(later,{via:'bank',date:'2026-09-25'});
    s.eq('the patch writes exactly the collection keys',Object.keys(ok.patch||{}).sort().join(','),a.run('_WHS_COLLECT_FIELDS').slice().sort().join(','));
    s.eq('… as the signed-in person',ok.patch&&ok.patch.collectedBy,'umair');
    const cs=Object.assign({},later,ok.patch);
    s.eq('a collected bill is no longer overdue',a.run(`whsIsOverdue(${J(Object.assign({},cs,{dueDate:'2026-09-21'}))},'2026-09-26')`),false);
    const sum=a.run(`whsSummary(${J([later,Object.assign({},later,{_id:'SO9'},ok.patch)])},'2026-09-26')`);
    s.eq('… nor still "to collect"',sum.laterCount,1);
    // driven through the modal
    const b=app();b.seed([later]);
    b.run("window.whsCollect('SO1')");b.run("window.whsCollectVia('cash')");b.el('whs-cdate').value=b.run('whsToday()');
    await b.run("window.whsCollectSave('SO1')");
    const w=b.state.writes.filter(x=>x.op==='update').pop();
    s.ok('Mark collected writes the collection',!!w&&w.data.collectedVia==='cash'&&w.data.collectedBy==='umair');
    s.ok('… and the bill now puts cash in hand',b.run("(whsMoneyIn(_whsById('SO1'))||{}).account")==='cash');
  }
  s.section('undoing a collection: only while Raees has not confirmed it');
  {
    const col=sale({terms:'later',paidVia:null,dueDate:'2026-09-30',collectedAt:5,collectedBy:'umair',collectedVia:'cash',collectedDate:'2026-09-25'});
    const server=[{_id:'whs_SO1_0',whSale:'SO1#0',amount:2000,status:'posted',by:'raees',byName:'Raees',date:'2026-09-25'}];
    const a=app({globals:{getDocs:async()=>({docs:server.map(e=>({id:e._id,data:()=>e}))})}});a.seed([col]);
    await a.run("window.whsUncollect('SO1')");
    s.eq('received → refused, nothing written',a.state.writes.length,0);
    s.ok('… and says why',a.state.toasts.some(t=>/already confirmed/.test(t)));
    const b=app();b.seed([col]);
    await b.run("window.whsUncollect('SO1')");
    const w=b.state.writes.pop();
    s.ok('not yet received → the collection is cleared',!!w&&w.data.collectedAt===null&&w.data.collectedVia===null);
  }
  s.section('the warehouse list says where each payment stands');
  {
    const a=app();a.seed([sale({_id:'SO1',orderNo:'SO1'}),sale({_id:'SO2',orderNo:'SO2',total:500})]);
    a.run(`whsConfirmations=${J([{_id:'whs_SO2_0',whSale:'SO2#0',amount:500,whSaleTotal:500,account:'cash',status:'posted',by:'raees',byName:'Raees',date:'2026-09-26'}])};whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr=null;_fulfillSection='accounts';1`);
    const h=a.run('whsSectionHTML()');
    s.ok('a waiting payment is marked',/Not with Raees yet/.test(h));
    s.ok('a confirmed one is marked',/With Raees ✓/.test(h));
    s.ok('the tile totals what is still with the warehouse',/Not with Raees yet<\/div><div class="acct-tile-v">Rs 2,000/.test(h));
    a.run(`_whsConfErr={code:'permission-denied'};1`);
    const e=a.run('whsSectionHTML()');
    s.ok('a failed read says so and never claims "not with Raees"',/Could not read what Raees has confirmed/.test(e)&&!/acct-chip warn">Not with Raees yet/.test(e));
  }
  s.section('Raees confirms what the warehouse handed over');
  {
    const server=[];
    const mk=(sess,extra)=>{const h={};const a=app({session:sess,globals:Object.assign({
      auth:{currentUser:{getIdToken:async()=>'tok'}},
      getDocs:async()=>({docs:server.map(e=>({id:e._id,data:()=>e}))}),
      fetch:async(url,init)=>{h.a.state.fetches.push({url:String(url),init:init||{}});
        if(/\/wh_sales\//.test(url))return saleGet(h.a,url,h.serverSales);
        if(init&&init.method==='PATCH'&&/currentDocument\.exists=false/.test(url)){const id=decodeURIComponent(String(url).split('/acct_entries/')[1].split('?')[0]);
          if(server.some(e=>e._id===id))return{ok:false,status:409,json:async()=>({error:{status:'ALREADY_EXISTS',message:'exists'}})};
          const f=JSON.parse(init.body).fields;const o={_id:id};for(const k of Object.keys(f)){const v=f[k];o[k]=v.stringValue!=null?v.stringValue:v.integerValue!=null?Number(v.integerValue):v.booleanValue!=null?v.booleanValue:null;}server.push(o);}
        return{ok:true,status:200,json:async()=>({documents:[]})};}},extra||{})});h.a=a;
      a.run('acctEntries=[];acctVendors=[];acctCloses=[];acctSettings=null;_acctLoaded=true;1');
      a.h=h;return a;};
    const today=(new Date()).toISOString().slice(0,10);
    const a=mk(RAEES);
    a.seed([sale({_id:'SO1',orderNo:'SO1',date:'2026-09-20',customerName:'Ravi Kumar'}),sale({_id:'SO2',orderNo:'SO2',date:'2026-09-20',paidVia:'bank',total:3000}),sale({_id:'SO3',orderNo:'SO3',date:'2026-09-21',total:700})]);
    a.run('whsConfirmations=[];whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr=null;1');
    const alerts=a.run('_acctAlerts([])');
    s.ok('the ledger says what is waiting, split by account',/From the warehouse<\/b> — 3 payments, ₨5,700 \(cash ₨2,700 · MCB ₨3,000\)/.test(alerts));
    const body=a.run('_acctWhBodyHTML()');
    s.ok('the list groups by day, newest first',body.indexOf("acctWhConfirm('SO3#0')")>-1&&body.indexOf("acctWhConfirm('SO3#0')")<body.indexOf("acctWhConfirm('SO1#0')"));
    s.ok('… Confirm all only where a day has more than one',/acctWhConfirmDay\('2026-09-20'\)/.test(body)&&!/acctWhConfirmDay\('2026-09-21'\)/.test(body));
    await a.run("window.acctWhConfirm('SO1#0')");
    const w=a.state.fetches.filter(f=>f.init.method==='PATCH').pop();
    s.ok('confirming writes a create-only document named for the sale',!!w&&/\/acct_entries\/whs_SO1_0\?currentDocument\.exists=false$/.test(w.url));
    const f=w?JSON.parse(w.init.body).fields:{};
    s.eq('… a cash in',f.type&&f.type.stringValue,'cash_in');
    s.eq('… into the cash drawer',f.account&&f.account.stringValue,'cash');
    s.eq('… for the bill',f.amount&&f.amount.integerValue,'2000');
    s.eq('… dated the day it was received',f.date&&f.date.stringValue,a.run('_acctToday()'));
    s.eq('… tagged with the sale',J([f.src&&f.src.stringValue,f.whSale&&f.whSale.stringValue,f.ref&&f.ref.stringValue,f.person&&f.person.stringValue]),J(['wh','SO1#0','SO1','Ravi Kumar']));
    s.eq('… posted, not pending',f.status&&f.status.stringValue,'posted');
    s.eq('it counts in the books straight away',a.run('_acctBalances().cash'),2000);
    s.eq('SO1 leaves the list',a.run("_acctWh().pending.map(i=>i.key).sort().join(',')"),'SO2#0,SO3#0');
    // the same sale again, e.g. from a second device
    server.push({_id:'whs_SO2_0',whSale:'SO2#0',amount:3000,status:'posted',by:'afnan',byName:'Afnan'});
    const n0=a.state.fetches.filter(x=>x.init.method==='PATCH').length;
    await a.run("window.acctWhConfirm('SO2#0')");
    s.eq('a sale confirmed elsewhere is refused before writing',a.state.fetches.filter(x=>x.init.method==='PATCH').length,n0);
    s.ok('… and says who confirmed it',a.state.toasts.some(t=>/already confirmed by Afnan/.test(t)));
    // a different amount
    a.run("window.acctWhDifferent('SO3#0')");a.el('f-wh-amt').value='500';a.el('f-wh-why').value='Rs 200 short, tomorrow';
    await a.run("window.acctWhDifferentSave('SO3#0')");
    const d=server.find(e=>e._id==='whs_SO3_0');
    s.ok('a short handover records what was received',!!d&&d.amount===500);
    const dw=a.state.fetches.filter(x=>x.init.method==='PATCH').pop();const df=dw?JSON.parse(dw.init.body).fields:{};
    s.ok('… flagged for review with the reason',df.needsReview&&df.needsReview.booleanValue===true&&/short handover/.test(JSON.stringify(df.reviewFlags))&&/200 short/.test(df.note.stringValue));
    s.eq('… and the bill total is kept beside it',df.whSaleTotal&&df.whSaleTotal.integerValue,'700');
    // THE review finding: Raees's list is read once; Umair may have voided the
    // sale on his phone since. The sale is re-read before any money is booked.
    const b=mk(RAEES);
    b.seed([sale({_id:'SO11',orderNo:'SO11'})]);b.run('whsConfirmations=[];whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr=null;1');
    b.h.serverSales={SO11:sale({_id:'SO11',orderNo:'SO11',status:'void'})};
    const p0=b.state.fetches.filter(x=>x.init.method==='PATCH').length;
    await b.run("window.acctWhConfirm('SO11#0')");
    s.eq('a sale voided since the page loaded is re-read and refused — nothing written',b.state.fetches.filter(x=>x.init.method==='PATCH').length,p0);
    s.ok('… and says it changed',b.state.toasts.some(t=>/changed since this page loaded/.test(t)));
    s.eq('… the fresh copy replaces the stale one, so it leaves the list',b.run("_acctWh().pending.length"),0);
    // a confirmations re-read that fails must not confirm on the old copy
    const c=mk(RAEES,{getDocs:async()=>{throw Object.assign(new Error('offline'),{code:'unavailable'});}});
    c.seed([sale({_id:'SO12',orderNo:'SO12'})]);c.run('whsConfirmations=[];whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr=null;1');
    await c.run("window.acctWhConfirm('SO12#0')");
    s.eq('a failed re-read of the confirmations writes nothing',c.state.fetches.filter(x=>x.init.method==='PATCH').length,0);
    s.ok('… and says why',c.state.toasts.some(t=>/Could not check what has already been confirmed/.test(t)));
  }
  s.section('review: voiding a warehouse cash in brings the sale back at once');
  {
    const a=app({session:RAEES,globals:{auth:{currentUser:{getIdToken:async()=>'tok'}},fetch:async()=>({ok:true,status:200,json:async()=>({})}),prompt:()=>'wrong account'}});
    const conf={_id:'whs_SO1_0',type:'cash_in',src:'wh',whSale:'SO1#0',whOrder:'SO1',amount:2000,whSaleTotal:2000,account:'mcb',status:'posted',date:a.run('_acctToday()'),month:a.run('_acctThisMonth()'),by:'raees'};
    a.run(`acctEntries=[${J(conf)}];acctVendors=[];acctCloses=[];acctSettings=null;_acctLoaded=true;1`);
    a.seed([sale()]);a.run(`whsConfirmations=[${J(conf)}];whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr=null;1`);
    s.eq('before: with Raees',a.run('_acctWh().pending.length'),0);
    await a.run("window.acctVoid('whs_SO1_0')");
    s.eq('after the void the sale is waiting again, without a reload',a.run("(whsConfirmations[0]||{}).status+'/'+_acctWh().pending.length"),'void/1');
    a.run(`whsConfirmations=[${J(conf)}];acctEntries=[${J(conf)}];1`);
    a.run('_acctWhTouched(acctEntries[0],true)');
    s.eq('an admin delete takes it out of the warehouse copy too',a.run('whsConfirmations.length'),0);
  }
  s.section('review: a month cannot be closed while warehouse money dated in it is unconfirmed');
  {
    const byCol={wh_sales:[],acct_entries:[]};
    const g={auth:{currentUser:{getIdToken:async()=>'tok'}},collection:(db,name)=>({name}),query:c=>c,
      getDocs:async q=>({docs:(byCol[q&&q.name]||[]).map(e=>({id:e._id,data:()=>e}))}),fetch:async()=>({ok:true,status:200,json:async()=>({})})};
    const a=app({session:AFNAN,globals:g});
    const mo=a.run('_acctThisMonth()'),day=mo+'-01';
    byCol.wh_sales=[sale({date:day})];
    a.run('acctEntries=[];acctVendors=[];acctCloses=[];acctSettings=null;_acctLoaded=true;1');
    a.seed([]);a.run('whsConfirmations=[];whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr=null;1');
    a.el('acct-close-counted').value='2000';a.el('acct-close-note').value='counted';
    await a.run(`window.acctCloseMonth('${mo}')`);
    s.eq('an unconfirmed payment dated in the month blocks the close (nothing written)',a.state.writes.length+a.state.fetches.filter(f=>/acct_closes|acct_entries/.test(f.url)).length,0);
    s.ok('… and says why',a.state.toasts.some(t=>/not yet confirmed/.test(t)&&/both add/.test(t)));
    s.ok('… it re-read the sales rather than trust the page',a.run('whSales.length')===1);
    byCol.acct_entries=[{_id:'whs_SO1_0',whSale:'SO1#0',whOrder:'SO1',amount:2000,whSaleTotal:2000,account:'cash',status:'posted'}];
    s.eq('once it is confirmed, nothing blocks',await a.run(`_acctWhCloseBlock('${mo}-28')`),null);
    const b=app({session:AFNAN,globals:Object.assign({},g,{getDocs:async()=>{throw Object.assign(new Error('denied'),{code:'permission-denied'});}})});
    b.run('acctEntries=[];acctVendors=[];acctCloses=[];acctSettings=null;_acctLoaded=true;1');
    s.ok('a failed read refuses the close rather than guess',/could not be read/.test(await b.run(`_acctWhCloseBlock('${mo}-28')`)||''));
  }
  s.section('review: undoing a collection asks first, then checks with the server');
  {
    const col=sale({terms:'later',paidVia:null,dueDate:'2026-09-30',collectedAt:5,collectedBy:'umair',collectedVia:'cash',collectedDate:'2026-09-25'});
    let asked=false,readAfter=false;
    const a=app({globals:{confirm:()=>{asked=true;return true;},getDocs:async()=>{readAfter=asked;return{docs:[],metadata:{fromCache:false}};}}});a.seed([col]);
    await a.run("window.whsUncollect('SO1')");
    s.ok('the confirmations are read AFTER the question, so a confirmation made meanwhile still counts',readAfter);
    const b=app({globals:{getDocs:async()=>({docs:[],metadata:{fromCache:true}})}});b.seed([col]);
    await b.run("window.whsUncollect('SO1')");
    s.eq('an answer from the offline cache refuses the undo',b.state.writes.length,0);
    s.ok('… and says so',b.state.toasts.some(t=>/try again when online/.test(t)));
    const c=app();c.seed([col]);c.run(`whsConfirmations=[];whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr={code:'unavailable'};1`);
    c.run("window.whsOpen('SO1')");
    s.ok('with Raees\'s side unread, Undo collection is still offered (it re-checks)',/whsUncollect\(/.test(c.bodyHtml('whs-modal')||''));
  }
  s.section('review: both lists are read again when looked at after a minute');
  {
    let reads=0;
    const a=app({globals:{getDocs:async()=>{reads++;return{docs:[{id:'whs_SO1_0',data:()=>({whSale:'SO1#0',whOrder:'SO1',amount:2000,whSaleTotal:2000,account:'cash',status:'posted'})}]};}}});
    a.seed([sale()]);a.run('whsConfirmations=[];whsConfLoaded=true;_whsConfErr=null;_whsConfAt=Date.now();1');
    s.eq('fresh: nothing is re-read',a.run('whsRefreshIfStale()'),null);
    a.run('_whsConfAt=Date.now()-61000;1');
    await a.run('whsRefreshIfStale()');
    s.ok('a minute on, the confirmations are read again and the sale shows with Raees',reads===1&&a.run("whsHandStatus(_whsById('SO1')).state")==='received');
  }
  s.section('review: marking a bill collected never blocks saving a sale');
  {
    const later=sale({terms:'later',paidVia:null,dueDate:'2026-09-30',date:'2026-09-20'});
    const a=app({globals:{updateDoc:()=>new Promise(()=>{})}});a.seed([later]);
    a.run("window.whsCollect('SO1')");a.run("window.whsCollectVia('cash')");a.el('whs-cdate').value=a.run('whsToday()');
    a.run("window.whsCollectSave('SO1')");await new Promise(r=>setTimeout(r,5));
    s.eq('a collection write that never answers leaves the sale form free',a.run('_whsBusy'),false);
    const b=app();b.seed([later]);b.run('navigator.onLine=false');
    b.run("window.whsCollect('SO1')");b.run("window.whsCollectVia('cash')");b.el('whs-cdate').value=b.run('whsToday()');
    await b.run("window.whsCollectSave('SO1')");
    s.ok('offline, it is refused and says it needs a connection',b.state.writes.length===0&&b.state.toasts.some(t=>/needs a connection/.test(t)));
  }
  s.section('confirming a whole day, a voided confirmation, a closed month');
  {
    const server=[];
    const hh={};
    const a=app({session:RAEES,globals:{auth:{currentUser:{getIdToken:async()=>'tok'}},getDocs:async()=>({docs:server.map(e=>({id:e._id,data:()=>e}))}),
      fetch:async(url,init)=>{if(/\/wh_sales\//.test(url))return saleGet(hh.a,url);if(init&&init.method==='PATCH'){const id=decodeURIComponent(String(url).split('/acct_entries/')[1].split('?')[0]);server.push({_id:id,whSale:JSON.parse(init.body).fields.whSale.stringValue,amount:Number(JSON.parse(init.body).fields.amount.integerValue),status:'posted'});}return{ok:true,status:200,json:async()=>({documents:[]})};}}});
    hh.a=a;
    a.run('acctEntries=[];acctVendors=[];acctCloses=[];acctSettings=null;_acctLoaded=true;1');
    a.seed([sale({_id:'SO1',orderNo:'SO1'}),sale({_id:'SO2',orderNo:'SO2',paidVia:'bank'}),sale({_id:'SO7',orderNo:'SO7',date:'2026-09-19'})]);
    server.push({_id:'whs_SO7_0',whSale:'SO7#0',amount:2000,status:'void'});
    a.run('whsConfirmations=[];whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr=null;1');
    await a.run("window.acctWhConfirmDay('2026-09-20')");
    s.eq('confirm all writes one entry per sale of that day',server.filter(e=>/^whs_SO[12]_0$/.test(e._id)).length,2);
    s.eq('… each into its own account',a.run("acctEntries.map(e=>e.account).sort().join(',')"),'cash,mcb');
    await a.run("window.acctWhConfirm('SO7#0')");
    s.ok('a voided confirmation keeps its id; the new one takes the next',server.some(e=>e._id==='whs_SO7_0_2'));
    const b=app({session:RAEES,globals:{auth:{currentUser:{getIdToken:async()=>'tok'}},getDocs:async()=>({docs:[]})}});
    const mo=b.run('_acctThisMonth()');
    b.run(`acctEntries=[];acctVendors=[];acctCloses=${J([{month:mo,cashBook:0,mcbBook:0,payables:{}}])};acctSettings=null;_acctLoaded=true;1`);
    b.seed([sale()]);b.run('whsConfirmations=[];whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr=null;1');
    await b.run("window.acctWhConfirm('SO1#0')");
    s.ok('a closed month refuses, and nothing is written',b.state.fetches.filter(x=>x.init.method==='PATCH').length===0&&b.state.toasts.some(t=>/closed/.test(t)));
  }
  s.section('who sees and confirms the handover');
  {
    const a=app({session:MUSTAFA});
    a.run('acctEntries=[];acctVendors=[];acctCloses=[];acctSettings=null;_acctLoaded=true;1');
    a.seed([sale()]);a.run('whsConfirmations=[];whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr=null;1');
    s.ok('a manager cannot confirm',!/acctWhConfirm\(/.test(a.run('_acctWhBodyHTML()')));
    a.run(`_whsLoadErr={code:'permission-denied',message:'Missing or insufficient permissions.'};1`);
    s.ok('… and the rules do not let managers read the sales, so they carry no "could not be read" alert',a.run('_acctWh()')===null&&!/Warehouse sales could not be read/.test(a.run('_acctAlerts([])')));
    const b=app({session:AMMAR});b.run('acctEntries=[];acctVendors=[];acctCloses=[];acctSettings=null;_acctLoaded=true;1');
    b.seed([sale()]);b.run('whsConfirmations=[];whsConfLoaded=true;_whsConfAt=Date.now();_whsConfErr=null;1');
    s.ok('an owner can confirm',/acctWhConfirm\(/.test(b.run('_acctWhBodyHTML()')));
    b.run(`_whsLoadErr={code:'permission-denied',message:'Missing or insufficient permissions.'};1`);
    const e=b.run('_acctWhBodyHTML()');
    s.ok('a refused read of the sales says so, names the rules, and lists nothing',/Could not read wh_sales/.test(e)&&/republish/.test(e)&&!/acctWhConfirm\(/.test(e));
  }
  s.section('the collection rule matches the JS');
  {
    const rules=read('firestore.rules');
    const m=/affectedKeys\(\)\.hasOnly\(\['collectedAt'[^\]]*\]\)/.exec(rules);
    const keys=m?m[0].replace(/^[^[]*\[/,'').replace(/\].*$/,'').split(',').map(x=>x.trim().replace(/'/g,'')).sort().join(','):'';
    s.eq('the rule lists exactly _WHS_COLLECT_FIELDS',keys,app().run('_WHS_COLLECT_FIELDS').slice().sort().join(','));
    s.ok('… and binds who collected it to the signed-in email',/collectedBy \+ '@groovy\.op' == userEmail\(\)/.test(rules));
    s.ok('… only on a live pay-later bill',/resource\.data\.terms == 'later'/.test(rules));
    s.ok('a collection is set only on an uncollected bill (never rewritten in place)',/resource\.data\.get\('collectedAt', null\) == null\s*&& request\.resource\.data\.get\('collectedAt', null\) is number/.test(rules));
    s.ok('… and cleared only on a collected one',/resource\.data\.get\('collectedAt', null\) != null\s*&& request\.resource\.data\.get\('collectedAt', null\) == null/.test(rules));
    s.ok('a warehouse confirmation is held to its sale by the rules',/src', ''\) != 'wh' \|\| whConfValid\(doc\)/.test(rules)&&/d\.whSaleTotal == sale\.total/.test(rules)&&/d\.amount == d\.whSaleTotal \|\| d\.needsReview == true/.test(rules));
  }
  s.section('the shell: the file is wired into index.html and the service worker');
  {
    s.ok('a script tag after fulfillment.js',/fulfillment\.js\?v=[^"]+"><\/script>\s*<script src="\/js\/warehouse-sales\.js/.test(read('index.html')));
    s.ok('precached',/'\/js\/warehouse-sales\.js'/.test(read('sw.js')));
    s.ok('no literal colour in the module (tokens only, both themes)',!/#[0-9a-fA-F]{3,6}\b/.test(read('js/warehouse-sales.js').replace(/&#39;/g,'')));
  }
  return s;
};

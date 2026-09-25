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
  a.seed=(sales,catalog)=>a.run(`whSales=${J(sales||[])};_whsSort();whSalesLoaded=true;_whsLoadErr=null;_whsCatalog=${J(catalog||null)};1`);
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
    s.ok('firestore.rules holds the same 20',/request\.resource\.data\.discount \* 100 <= request\.resource\.data\.subtotal \* 20/.test(read('firestore.rules')));
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
    s.ok('read is the audience',/allow read: if isWhSales\(\);/.test(block));
    s.ok('create requires the bill, the uid, a pay-later due date and the exact total',
      /billUrl\.matches\('\^https:\/\/res\[\.\]cloudinary\[\.\]com\/\.\+'\)/.test(block)&&/createdBy == request\.auth\.uid/.test(block)&&/terms == 'paid' \|\| request\.resource\.data\.dueDate is string/.test(block)&&/total == request\.resource\.data\.subtotal - request\.resource\.data\.discount/.test(block));

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
  s.section('the shell: the file is wired into index.html and the service worker');
  {
    s.ok('a script tag after fulfillment.js',/fulfillment\.js\?v=[^"]+"><\/script>\s*<script src="\/js\/warehouse-sales\.js/.test(read('index.html')));
    s.ok('precached',/'\/js\/warehouse-sales\.js'/.test(read('sw.js')));
    s.ok('no literal colour in the module (tokens only, both themes)',!/#[0-9a-fA-F]{3,6}\b/.test(read('js/warehouse-sales.js').replace(/&#39;/g,'')));
  }
  return s;
};

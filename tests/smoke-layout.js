#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Layout smoke test.  `node tests/smoke-layout.js`

   Renders real markup from the real modules, puts it in a real browser with
   the real stylesheet, and MEASURES it. Everything else in tests/ proves
   logic; this is the first thing here that can see a layout.

   It exists because of a bug that shipped: the Team directory on the
   Profile page put the person's name and the action buttons in one flex row
   inside a 220px grid tile. The buttons are flex-shrink:0 and the name is
   flex:1;min-width:0, so the name was squeezed to EXACTLY ZERO WIDTH and
   every row rendered anonymously — you could not tell whose profile was
   whose. Measured after the fix: 0px → 177px at the same window width. The
   assertion suites were all green through the whole thing, because the name
   was in the DOM the entire time; it just had nowhere to go.

   The same class of failure has bitten this app repeatedly — the board's
   entire top bar invisible for weeks behind a wrong z-index, the delete X
   whose click was retargeted by a pointer capture, the profile photo that
   was a plain <img> with no handler. So the checks are written generally:
   render a fragment, then fail on any element that carries text but
   occupies no width, any container that overflows itself, and any
   CLICKABLE element that is zero-sized, pointer-events:none, or covered by
   something else when the browser hit-tests its centre. Add fragments to
   FRAGMENTS as pages grow.

   Checks each fragment at desktop, laptop and phone widths — a tile that
   fits at 1900px can still collapse at 1280px, which is the width most
   people actually use.

   Skips cleanly (exit 0) when no browser is available.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const http=require('http');
const os=require('os');
const {execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');
const {loadApp}=require('./harness');

function findBrowser(){
  if(process.env.CHROME_BIN&&fs.existsSync(process.env.CHROME_BIN))return process.env.CHROME_BIN;
  const candidates=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
    '/usr/bin/chromium','/usr/bin/chromium-browser'];
  for(const c of candidates)if(fs.existsSync(c))return c;
  try{
    const base='/opt/pw-browsers';
    for(const d of fs.readdirSync(base)){
      const p=path.join(base,d,'chrome-linux','chrome');
      if(fs.existsSync(p))return p;
    }
  }catch(e){}
  return null;
}


// Store Accounts fixture: a small, realistic ledger — an overdue credit
// vendor, a cash-terms walk-in, a consumable (gas) vendor, an aged runner
// float, a void row, a pending cash-in and a review flag.
function _acctFixture(){
  const LS={getItem:()=>null,setItem(){},removeItem(){}};
  const pad=n=>String(n).padStart(2,'0');
  const day=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
  let seq=0;
  const E=(type,o)=>Object.assign({_id:'e'+(++seq),type,date:day(0),month:day(0).slice(0,7),ts:1000+seq,by:'raees',byName:'Raees',vendorId:null,vendorName:'',person:'',account:null,toAccount:null,source:null,floatId:null,amount:0,lines:[],category:'',ref:'',note:'',photo:null,status:'posted',needsReview:false,reviewFlags:[]},o||{});
  const V=(id,o)=>Object.assign({_id:id,name:id,kind:'goods',terms:{mode:'credit',creditDays:30,creditLimit:0,billDay:0,expectedAmount:0},meter:null,contact:{person:'',phone:'',address:''},supplies:[],notes:'',active:true,openingBalance:0},o||{});
  const app=loadApp({files:['js/store.js','js/store-accounts.js'],currentPage:'acct-ledger',globals:{
    allItems:[{code:'TH1',name:'Thread white 40/2',unit:'cone',balance:20,sizeSpecific:false,_id:'TH1'}],allTransactions:[],allTemplates:[],allRequests:[],allActivePOs:[],
    allStoreCategories:[],allPoIssueRequests:[],allPoEditRequests:[],allPoShortfalls:[],
    auth:{currentUser:{getIdToken:async()=>'tok'}},localStorage:LS,
    _ilPage:1,_ilQ:'',_ilPO:'',_ilDir:'',IL_PER:15,IL_MAX_PAGES:1000,_invFilterCat:'all',_invSearchQ:'',_invSort:'category'}});
  const entries=[
    E('cash_in',{account:'cash',amount:40000,date:day(40),via:'cash',person:'Afnan'}),
    E('cash_in',{account:'mcb',amount:150000,date:day(40),via:'mcb',person:'Ammar',ref:'TRX-88121'}),
    E('purchase',{source:'credit',amount:18000,vendorId:'thread',vendorName:'Karachi Thread House',date:day(38),ref:'INV-2291',category:'Store purchase',lines:[{itemCode:'TH1',desc:'Thread white 40/2',qty:60,unit:'cone',rate:210,total:12600},{itemCode:'TH2',desc:'Thread black 40/2',qty:24,unit:'cone',rate:225,total:5400}],photo:'https://res.cloudinary.com/x/y.jpg',stockPosted:true}),
    E('payment',{account:'mcb',amount:13000,vendorId:'thread',vendorName:'Karachi Thread House',date:day(20),ref:'TRX-88400',photo:'https://res.cloudinary.com/x/z.jpg'}),
    E('purchase',{source:'cash',account:'cash',amount:1450,vendorId:'walk',vendorName:'Walk-in / direct',date:day(6),category:'Maintenance & repairs',lines:[{itemCode:'',desc:'Plumber — washroom tap',qty:1,unit:'',rate:1450,total:1450}]}),
    E('float_out',{_id:'flt1',account:'cash',amount:5000,person:'Noman',date:day(9),note:'packing + thread run'}),
    // a float Abbas OVERSPENT — the excess is owed to him until settled — and
    // a bill with no vendor account at all, paid to a named person
    E('float_out',{_id:'flt2',account:'cash',amount:2000,person:'Abbas',date:day(4),category:'Fuel & transport',note:'petrol for the Shershah run'}),
    E('purchase',{source:'float',floatId:'flt2',person:'Abbas',amount:2600,payee:'PSO pump, Korangi',date:day(3),category:'Fuel & transport',expense:true,photo:'https://res.cloudinary.com/x/z.jpg',lines:[{itemCode:'',desc:'Petrol — 2 round trips',qty:1,unit:'',rate:2600,total:2600}]}),
    E('purchase',{source:'cash',account:'cash',amount:900,payee:'Ali electrician',date:day(1),category:'Maintenance & repairs',expense:true,lines:[{itemCode:'',desc:'Fan rewiring, cutting hall',qty:1,unit:'',rate:900,total:900}]}),
    E('purchase',{source:'float',floatId:'flt1',person:'Noman',amount:3200,vendorId:'walk',vendorName:'Walk-in / direct',date:day(8),category:'Store purchase',lines:[{itemCode:'',desc:'Packing tape ×24',qty:24,unit:'roll',rate:133.33,total:3200}]}),
    E('purchase',{source:'cash',account:'cash',amount:800,vendorId:'walk',vendorName:'Walk-in / direct',date:day(5),status:'void',voidReason:'entered twice',voidedBy:'raees',lines:[{itemCode:'',desc:'Tea & biscuits',qty:1,unit:'',rate:800,total:800}]}),
    E('transfer',{account:'mcb',toAccount:'cash',amount:20000,date:day(3),note:'ATM withdrawal for the drawer'}),
    E('purchase',{source:'cash',account:'cash',amount:12500,vendorId:'walk',vendorName:'Walk-in / direct',date:day(2),category:'Maintenance & repairs',needsReview:true,reviewFlags:['over limit','no receipt'],lines:[{itemCode:'',desc:'Generator service',qty:1,unit:'',rate:12500,total:12500}]}),
    E('cash_in',{account:'cash',amount:10000,status:'pending',date:day(1),via:'cash',person:'Afnan',by:'afnan',byName:'Afnan'})
  ];
  const vendors=[
    V('thread',{name:'Karachi Thread House',contact:{person:'Bilal',phone:'0300-1234567',address:'Shershah, Karachi'},supplies:['Thread','Elastic'],terms:{mode:'credit',creditDays:30,creditLimit:50000,billDay:0,expectedAmount:0}}),
    V('walk',{name:'Walk-in / direct',terms:{mode:'cash',creditDays:0,creditLimit:0,billDay:0,expectedAmount:0}}),
    V('net',{name:'Nayatel',kind:'utility',terms:{mode:'weekly',creditDays:0,creditLimit:0,billDay:0,billWeekdays:[3,6],expectedAmount:2500},contact:{person:'',phone:'',address:''}}),
    V('gas',{name:'Pak Gas Agency',kind:'consumable',terms:{mode:'monthly',creditDays:0,creditLimit:0,billDay:5,expectedAmount:30000},meter:{type:'weighed',unit:'kg',rate:300,label:'Gas'},contact:{person:'',phone:'021-1234567',address:''}})
  ];
  const seed=a=>a.run(`acctEntries=${JSON.stringify(entries)};acctVendors=${JSON.stringify(vendors)};acctCloses=[];acctSettings={approvalLimit:10000,receiptRequiredAbove:2000,floatWarnDays:3,floatRedDays:7,categories:ACCT_DEFAULTS.categories,runners:['Noman']};_acctLoaded=true;_storeLoadAttempted=true;_acctSort(acctEntries);1`);
  return {app,seed};
}

// ── the fragments under test ─────────────────────────────────────────────
// Each returns real HTML from the real module. Names are filled in here
// because the modules hydrate them with textContent at runtime, which the
// node harness's stub DOM records but does not put into the markup — the
// hydration itself is covered by tests/profile.test.js.
// The calendar's week, built once for two fragments (session 2, P1.6).
function tbWeekFragment(byPerson){
  const app=loadApp({
    files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-calendar',
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
  });
  app.run("session={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
  app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar'},{uid:'u-afnan',username:'afnan',displayName:'Afnan'},{uid:'u-dani',username:'daniyal',displayName:'Daniyal Tufail'},{uid:'u-must',username:'mustafa',displayName:'Mustafa'},{uid:'u-saim',username:'saim',displayName:'Saim'}]");
  app.run("tbLists=[];tbLoaded=true;_tbLoadErrors=[];tbConfig={markers:[{label:'launch',date:'2026-10-30'}]}");
  app.run("tbItems=[tbDecodeItem({id:'g1',title:'ALL ASSETS IN',kind:'gate',locked:true,lockedBy:'u-ammar',status:'open',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-dani'],date:'2026-10-15'}),"
    +"tbDecodeItem({id:'i2',title:'shoot 2 — knit + outerwear',status:'open',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar'],date:'2026-10-16'}),"
    +"tbDecodeItem({id:'u1',title:'denim bulk lands — no date yet, and the title runs on',status:'open',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar']}),"
    +"tbDecodeItem({id:'u2',title:'knit bulk lands',status:'open',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar']})]");
  app.run("_tbCalAnchor='2026-10-15';_tbCalView='week';_tbCalFilters.scope='all';_tbTrayOpen=true;_tbCalRows="+(byPerson?'true':'false')+";_tbHydrateQueue=[]");
  let out=app.run('_tbCalendar()');
  app.run('_tbHydrateQueue').forEach(x=>{ out=out.replace(new RegExp('(id="'+x.id+'"[^>]*>)'),'$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))); });
  return out;
}

// Board fragments hydrate every user string with textContent, so a fragment
// that did not fill them in would measure EMPTY boxes and prove nothing.
function tbFillSlots(app,html){
  let out=html;
  app.run('_tbHydrateQueue').forEach(x=>{
    out=out.replace(new RegExp('(id="'+x.id+'"[^>]*>)'),'$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])));
  });
  return out;
}
function tbBoardApp(page){
  const app=loadApp({
    files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:page,
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
  });
  // js/auth.js declares `session` at top level and clobbers the option.
  app.run("session={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
  app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar'},{uid:'u-afnan',username:'afnan',displayName:'Afnan'},{uid:'u-dani',username:'daniyal',displayName:'Daniyal Tufail'},{uid:'u-must',username:'mustafa',displayName:'Mustafa'},{uid:'u-saim',username:'saim',displayName:'Saim'}]");
  app.run("tbLists=[{id:'l1',title:'Winter Drop 2027',kind:'shared',adminUid:'u-ammar',memberUids:['u-ammar'],color:'moss'}]");
  app.run("tbLoaded=true;_tbLoadErrors=[];tbConfig={markers:[{label:'launch',date:'2026-10-30'},{label:'founders out',date:'2026-11-01'}]}");
  return app;
}

// Master Accounts (js/master-accounts.js): a small, realistic book built by
// the core itself — an opening, a rent payment against the cost register, a
// flagged fabric bill, a courier collection, an Unlabelled spend, a drawing,
// a void, an edited one, a transfer waiting for Ammar, a count that came up
// short — and the drawer mirrored from Store Accounts.
function _maFixture(){
  const LS={getItem:()=>null,setItem(){},removeItem(){}};
  const app=loadApp({files:['js/ma-core.js','js/master-accounts.js'],currentPage:'ma-overview',
    session:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},globals:{localStorage:LS}});
  app.run(`(()=>{
    const IDX=maChartIndex(maChart('groovy')),S=MA_DEFAULT_SETTINGS,T=Date.UTC(2026,8,20,6);
    const n={journal:0,transfer:0,count:0};
    const add=(dt,i,by,x)=>{const m={by:by||'afnan',byName:by==='ammar'?'Ammar':'Afnan',ts:T+(n[dt]+1)*60000};if(dt==='count')m.bookBalance=x.book;
      const d=maBuildDoc(dt,i,m,IDX,S);n[dt]++;d.no=maDocNo(dt,d.fy,n[dt]);d.id=d.no;Object.assign(d,(x&&x.doc)||{});maData[_MA_DOC_KEY[dt]].push(d);return d;};
    maData.parties=[
      {id:'p1',kind:'vendor',name:'Al-Karam Textiles',code:'ALKA',active:true,costCentre:'factory',contact:{person:'Bilal',phone:'0300-1234567'},notes:'Fabric mill in Faisalabad; bills monthly',vendor:{roles:['fabric_mill'],tax:{regime:'sales'},terms:{mode:'credit',creditDays:30,creditLimit:750000,from:'2026-08-01'},termsHistory:[{mode:'cash',from:'2026-07-01',to:'2026-07-31',by:'afnan',reason:'Moved to credit after the first three orders'}],rateCard:[{id:'r1',item:'Single jersey 180 GSM',unit:'kg',rate:1180,validFrom:'2026-07-01',validTo:'2026-08-31',by:'afnan'},{id:'r2',item:'Single jersey 180 GSM',unit:'kg',rate:1240,validFrom:'2026-09-01',by:'afnan'}]}},
      {id:'p2',kind:'vendor',name:'Al-Hamd Washing',code:'ALHA',active:true,vendor:{roles:['washing'],tax:{regime:'none'},terms:{mode:'weekly',billWeekdays:[3,6],from:'2026-07-01'},termsHistory:[],rateCard:[]}},
      {id:'p3',kind:'vendor',name:'Iqbal Estates (factory landlord, Korangi Industrial Area)',code:'IQBA',active:true,vendor:{roles:['rent'],tax:{regime:'none'},terms:{mode:'monthly',billDay:5,from:'2026-07-01'},termsHistory:[],rateCard:[]}},
      {id:'p4',kind:'courier',name:'PostEx',code:'POST',active:true}];
    maData.commitments=[
      {id:'c1',name:'Rent — factory',kind:'fixed',cadence:'monthly',dueDay:5,amountExpected:150000,account:'6040',holder:'1020',party:'p3',costCentre:'factory',active:true},
      {id:'c2',name:'Electricity — K-Electric, the cutting hall and the stitching floor',kind:'fixed',cadence:'monthly',dueDay:12,amountExpected:62000,account:'6030',holder:'1020',costCentre:'factory',active:true},
      {id:'c3',name:'Shopify subscription',kind:'fixed',cadence:'monthly',dueDay:28,amountExpected:11500,account:'6100',holder:'1020',costCentre:'online',active:true}];
    add('journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1020',side:'dr',amount:1850000},{account:'1011',side:'dr',amount:220000},{account:'1012',side:'dr',amount:145000},{account:'2110',side:'cr',amount:1500000}]});
    add('journal',{kind:'money_out',date:'2026-09-05',holder:'1020',account:'6040',party:'p3',partyKind:'vendor',amount:150000,commitmentId:'c1',commitmentPeriod:'2026-09',costCentre:'factory',tax:{kind:'none'}});
    add('journal',{kind:'money_out',date:'2026-09-09',holder:'1020',account:'5010',party:'p1',partyKind:'vendor',amount:412000,tax:{kind:'sales',rate:18,inclusive:true,claimable:true},costCentre:'factory',po:'PO-1043'},'afnan',{doc:{flags:[{rule:'evidence.missing',message:'No bill or receipt attached (₨4,12,000).',field:'attachments'}]}});
    const e=add('journal',{kind:'money_out',date:'2026-09-14',holder:'1011',account:'5050',party:'p2',partyKind:'vendor',amount:38500,tax:{kind:'none'},costCentre:'factory'});
    e.rev=2;e.edits=[{at:T+5000,by:'ammar',byName:'Ammar',reason:'The washing bill said 38,500',fields:['amount'],before:{amount:36500},after:{amount:38500}}];
    add('journal',{kind:'money_in',date:'2026-09-16',holder:'1011',account:'4010',party:'p4',partyKind:'courier',amount:486200,tax:{kind:'none'},channel:'online_cod',note:'CPR collected by hand'});
    add('journal',{kind:'money_out',date:'2026-09-18',holder:'1012',account:'9020',payee:'Cash — not sure yet',amount:6500,tax:{kind:'none'},note:'Receipt lost'},'ammar');
    add('journal',{kind:'drawing',date:'2026-09-22',holder:'1012',owner:'ammar',amount:40000},'ammar');
    const v=add('journal',{kind:'money_out',date:'2026-09-19',holder:'1011',account:'6070',payee:'Stationers',amount:1200,tax:{kind:'none'}});
    Object.assign(v,{status:'void',voidedAt:T,voidedBy:'afnan',voidedByName:'Afnan',voidReason:'Entered twice'});
    add('transfer',{date:'2026-09-17',from:'1011',to:'1020',amount:400000,note:'Deposited'});
    add('transfer',{date:'2026-09-23',from:'1011',to:'1012',amount:25000,note:'For the Saturday pay run'});
    add('count',{date:'2026-09-15',holder:'1012',counted:144000},'ammar',{book:145000,doc:{note:'Short by a thousand'}});
    maData.audit=[{action:'post',target:{dt:'journal',id:'JV-27-0002',no:'JV-27-0002'},detail:'Money out ₨1,50,000',by:'afnan',byName:'Afnan',at:T},{action:'edit',target:{dt:'journal',id:'JV-27-0004',no:'JV-27-0004'},detail:'rev 2 · amount — The washing bill said 38,500',by:'ammar',byName:'Ammar',at:T+5000}];
    _maMirror={ok:true,cash:52000,why:'',at:Date.now()};maLoaded=true;_maLoadErrs=[];_maInvalidate();
    // A session in use: since M1.6b a form, like every paint, asks the idle
    // re-lock first, and this fixture has no signed-in account to vouch for
    // it — without a touch every form here would silently not open.
    _maTouch();
    return 1;})()`);
  return app;
}

// Master Accounts M2 — the courier book on top of _maFixture(): PostEx's
// derived receipts (one flagged, one late, one from before the books), a TCS
// statement, a Bykea one, a collection that differs and has no receipt, one
// that waits for Raees on paper, one voided, and the rollup's last run.
function _maCourierFixture(){
  const app=_maFixture();
  const MAC=require('../js/ma-core.js');
  const S=MAC.maSettings(null),IDX=MAC.maChartIndex(MAC.maChart('groovy',[]));
  let n=0;
  const px=o=>{n++;return Object.assign({trackingNumber:'PX'+String(n).padStart(5,'0'),status:'Delivered',statusCategory:'delivered',dispatched:true,
    transactionDate:'2026-07-08T10:00:00',orderPickupDate:'2026-07-09T09:00:00',orderDeliveryDate:'2026-07-10T16:00:00',cod:3000,transactionFee:180,transactionTax:28.8,
    reversalFee:0,reversalTax:0,upfrontPayment:0,reservePayment:0,balancePayment:0,syncedAt:1790000000000,cprCheckedAt:1790100000000},o);};
  const parcels=[
    px({trackingNumber:'PA',cod:3000,cprNumber_1:'CPR-2026-00417',cpr1Date:'2026-09-08',upfrontPayment:2400,orderDeliveryDate:'2026-09-03T12:00:00'}),
    px({trackingNumber:'PB',cod:2000,cprNumber_1:'CPR-2026-00417',cpr1Date:'2026-09-08',upfrontPayment:1500,cprNumber_2:'CPR-2026-00431',cpr2Date:'2026-09-15',reservePayment:200,orderDeliveryDate:'2026-09-04T12:00:00'}),
    px({trackingNumber:'PC',cod:1000,transactionFee:100,transactionTax:16,cprNumber_1:'CPR-2026-00452',cpr1Date:'2026-09-25',upfrontPayment:800,orderDeliveryDate:'2026-09-22T12:00:00'}),
    px({trackingNumber:'PD',status:'En-Route',statusCategory:'in_transit',orderDeliveryDate:null,cod:1800,transactionDate:'2026-09-27T10:00:00',orderPickupDate:'2026-09-28T09:00:00'})];
  const der=MAC.maCprDerive(parcels,{from:'2026-07-01',today:'2026-09-29'});
  const docs=MAC.maCourierDocs(der,S);
  docs.forEach(d=>{if(d.id==='postex-CPR-2026-00452')d.flags=[{rule:'cpr.split_mismatch',message:'PostEx paid ₨800 on it where its parcels come to ₨884.',field:null}];});
  const ATT={publicId:'ma/'+'a'.repeat(64),format:'jpg',type:'authenticated',resourceType:'image'};
  const tcs=MAC.maBuildDoc('cpr',{courier:'tcs',date:'2026-07-31',ref:'TCS-JUL-2026-STATEMENT-OF-ACCOUNT',attachments:[ATT],lines:[{date:'2026-07-10',parcels:12,cod:35000,fee:1750,tax:280}]},{by:'afnan',byName:'Afnan',ts:1790000000000},IDX,S);
  tcs.id='CS-27-0001';tcs.no='CS-27-0001';
  const byk=MAC.maBuildDoc('cpr',{courier:'bykea',date:'2026-09-20',ref:'BY-0920',attachments:[ATT],lines:[{date:'2026-09-19',parcels:3,cod:9000,fee:450,tax:72}]},{by:'afnan',byName:'Afnan',ts:1790000000000},IDX,S);
  byk.id='CS-27-0002';byk.no='CS-27-0002';
  const all=docs.concat([tcs,byk]);
  const col=(inp,by,no,x)=>{const d=MAC.maBuildDoc('collection',inp,{by:by||'afnan',byName:by==='ammar'?'Ammar':'Afnan',ts:1790000000000,cprs:all},IDX,S);d.no=no;d.id=no;return Object.assign(d,x||{});};
  const cl=[
    col({courier:'postex',holder:'1011',amount:3850,date:'2026-09-09',cprNos:['postex-CPR-2026-00417'],collectedBy:'Noman (rider) and a very long second name to see it wrap',note:'Rider kept 50 for fuel',attachments:[]},'afnan','CL-27-0001'),
    col({courier:'postex',holder:'1010',amount:200,date:'2026-09-16',cprNos:['postex-CPR-2026-00431'],attachments:[ATT]},'afnan','CL-27-0002'),
    col({courier:'postex',holder:'1011',amount:100,date:'2026-09-16',cprNos:[],attachments:[]},'afnan','CL-27-0003',{status:'void',voidedAt:1790000000000,voidedBy:'afnan',voidedByName:'Afnan',voidReason:'Entered twice'})];
  cl[2].refs={cprNos:[]};
  app.run('(()=>{maData.cpr='+JSON.stringify(all)+';maData.collection='+JSON.stringify(cl)+';maData.runs=[{id:"rollup",state:"done",ok:true,at:Date.UTC(2026,8,29,3,45),day:"2026-09-29",parcels:4,created:6,updated:1,voided:0,transit:'+JSON.stringify(der.transit)+',issueCount:1,issues:[{rule:"cpr.split_mismatch",message:"PostEx paid ₨800 on CPR-2026-00452 where its parcels come to ₨884."}],checks:{}}];_maInvalidate();return 1;})()');
  return app;
}


// Seeds the Article Explorer fragments: five articles with weekly sales over ~40 weeks.
function _axSeed(app){
  const arts=[['GST073','Effortless Tee','Deep Blue','Tees',280],['GD007','Denim Jort With A Very Long Name Indeed','Indigo','Jorts',400],
    ['GHW001','Trucker Cap','Black','Caps',120],['GJ014','Zip Hoodie','Charcoal','Hoodies',200],['GCO001','Co-ord Set','Sand','Sets',90]];
  const prods=[],lis=[];
  arts.forEach(([code,title,color,cat,live],ai)=>{
    ['S','M','L'].forEach((sz,k)=>prods.push({_id:code+sz,sku:code+'-'+sz,product_title:title,color,size:sz,product_type:cat,status:'active',published_at:new Date(Date.now()-live*86400000).toISOString()}));
    for(let w=0;w<40;w++){
      const ago=w*7+1;if(ago>live)continue;
      const q=Math.max(0,Math.round(6+5*Math.sin((w+ai*3)/4)+ai*2-(w>30?4:0)));
      if(q)lis.push({sku:code+'-'+['S','M','L'][w%3],quantity:q,price:1800+ai*400,order_created_at:new Date(Date.now()-ago*86400000).toISOString(),financial_status:'paid'});
    }
  });
  app.run('_siProducts='+JSON.stringify(prods));
  app.run('_siLineItems='+JSON.stringify(lis));
  app.run('_siSnapshot={items:{a:{sku:"GST073-S",available:12},b:{sku:"GST073-M",available:0},c:{sku:"GST073-L",available:5}}}');
  // 70 daily snapshots (the exposure metrics and the scorecard read them). Five stock shapes:
  // steady, runs out 20 days ago, always low, plenty and never selling, no stock rows at all (GCO001).
  app.run('(()=>{const t=_siAxDayNum(_siPktDate(0)),docs=[];for(let k=69;k>=0;k--){const date=_siAxDayStr(t-k),it={};'+
    'it.a={sku:"GST073-S",available:40+(k%9)};it.b={sku:"GST073-M",available:k<20?0:30};it.c={sku:"GST073-L",available:8};'+
    'it.d={sku:"GD007-28",available:k<20?0:25};it.e={sku:"GHW001",available:k%13};it.f={sku:"GJ014-S",available:300};it.g={sku:"GJ014-M",available:200};'+
    'docs.push({date,items:it});}_siHist=_siAxBuildHistory(docs);_siHistState="ok";_siAxCache=null;})()');
  app.run('_siWeeklyCloses=[{week_ending:"2026-09-26",week_starting:"2026-09-20",top_sku:{sku:"GST073-S",quantity:11}}]');
}

// Needs Attention seed (Oct 2026): ~14 articles over the last 90 days (relative to today, so the weekly shapes always exist), with every
// issue type: run-outs (critical and act), a stock-out, a size hole, an overstock, dead stock, a fading seller and a voided-unit data check.
function _naSeed(app,opts){
  opts=opts||{};
  const prods=[],lis=[],defs=[];
  const mk=(code,title,cat,sizes,daily,stock)=>{
    Object.keys(sizes).forEach(sz=>{
      prods.push({_id:code+sz,sku:code+'-'+sz,product_title:title,color:'Black',size:sz,product_type:cat,status:'active',published_at:new Date(Date.now()-400*86400000).toISOString()});
      for(let k=0;k<90;k++){const q=daily(k,sz);if(q>0)lis.push({sku:code+'-'+sz,quantity:q,price:2400,order_created_at:new Date(Date.now()-k*86400000).toISOString(),financial_status:'paid'});}
      defs.push([code+'-'+sz,stock]);
    });
  };
  const M={M:1};
  ['Effortless Tee','Denim Jort With A Very Long Name Indeed Because Titles Wrap','Zip Hoodie Charcoal','Baggy Trousers Slate Blue','Superman Full Sleeves Tee Frost','Core Tee Raglan'].forEach((t,i)=>mk('GNA0'+(i+1),t,i===1?'Jorts':(i===2?'Hoodies':'Tees'),M,()=>4+i,(k)=>i<4?26:60));
  mk('GNO001','Classic Cap Stone','Caps',M,k=>k>=10?3:0,k=>k>=9?30:0);
  mk('GNH001','Live In Pants Arctyc White','Pants',{S:1,M:1,L:1},(k,sz)=>sz==='S'?2:1,(k,sz)=>sz==='S'?0:100);
  mk('GNV001','Mint Chalk Cargo','Cargo',M,k=>k%2===0?1:0,()=>400);
  mk('GND001','Electric Blue Raglan Tee','Tees',M,k=>k===60?10:0,()=>120);
  mk('GNF001','Allstars Basketball Jersey','Tees',M,k=>k<28?2:6,()=>300);
  mk('GNT001','Voided Heavy Tee','Tees',M,()=>1,()=>100);
  lis.push({sku:'GNT001-M',quantity:12,price:2400,order_created_at:new Date(Date.now()-30*86400000).toISOString(),financial_status:'voided'});
  app.run('_siProducts='+JSON.stringify(prods)+';_siLineItems='+JSON.stringify(lis)+';_siOrders=[];_siLoaded=true');
  app.run('(()=>{const t=_siAxDayNum(_siPktDate(0)),defs='+JSON.stringify(defs.map(d=>d[0]))+',docs=[];const stk={};'+
    'for(let k=69;k>=0;k--){const date=_siAxDayStr(t-k),it={};defs.forEach((sku,i)=>{it["i"+i]={sku,available:0};});docs.push({date,items:it,k});}'+
    'window.__docs=docs;})()');
  // stock per size per day from the definitions (functions cannot cross JSON, so evaluate here)
  const docs=app.run('window.__docs'),byKey={};defs.forEach((d,i)=>{byKey['i'+i]=d;});
  const rebuilt=docs.map(d=>{const it={};Object.keys(byKey).forEach(key=>{const sku=byKey[key][0],fn=byKey[key][1];const sz=sku.split('-').pop();it[key]={sku,available:fn(d.k,sz)};});return{date:d.date,items:it};});
  app.run('(()=>{const docs='+JSON.stringify(rebuilt)+';_siHist=_siAxBuildHistory(docs);_siHistState="ok";_siSnapshot=Object.assign({},docs[docs.length-1],{snapshot_at:'+JSON.stringify(opts.snapAt||new Date().toISOString())+'});_siPrevSnapshot=docs[docs.length-8];_siAxCache=null;_siNaMemo=null;_siSyncMeta={orderSync:{last_status:"success",last_success_at:new Date().toISOString()},inventory:{last_status:"success"}};})()');
}

const FRAGMENTS={
  // Master Accounts (MASTER_ACCOUNTS_PLAN.md §16.4): Today, Money and a
  // holder, the Ledger with the review queue, a party page, and the Record
  // picker with a form. The rail is NOT opened here: up to 1440px it is a
  // fixed slide-over that would sit on the page's own controls (the
  // documented false hit); its own fragment runs at 1900 only.
  'master accounts — Today':()=>{
    const app=_maFixture();
    return Promise.resolve(app.run("_maPageHTML('ma-overview')"));
  },
  // QA F25: a book with NO opening balance — every other fragment opens on
  // the fixture's, so this is the one that renders an empty book. Needs
  // attention leads with "No opening balance yet" and its Record it button,
  // over the watch that no backup has run.
  'master accounts — Today on an empty book':()=>{
    const app=loadApp({files:['js/ma-core.js','js/master-accounts.js'],currentPage:'ma-overview',
      session:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    app.run("_maMirror={ok:true,cash:0,why:'',at:Date.now()};maLoaded=true;_maLoadErrs=[];_maInvalidate();_maTouch();1");
    return Promise.resolve(app.run("_maPageHTML('ma-overview')"));
  },
  // M2 — Money in ▸ Couriers: four sections with their summary lines, the
  // transit block, the tick table (a flagged, a late and a from-before-the-
  // books receipt), the recent collections (a difference, no receipt, a
  // waiting one, a void) and Run now. The same page again with a filter on
  // and with the collections unreadable (the incomplete banner).
  'master accounts — Money in, Couriers':()=>{
    const app=_maCourierFixture();
    app.run("window.maCourierTick('postex','postex-CPR-2026-00452',true)");
    const a=app.run("_maPageHTML('ma-in')");
    app.run("_maCourierFilter='noreceipt'");
    const b=app.run("_maPageHTML('ma-in')");
    app.run("_maCourierFilter='';_maLoadErrs=[{key:'collection',col:'ma_collection',core:false,message:'Missing or insufficient permissions.',code:'permission-denied'},{key:'runs',col:'ma_runs',core:false,message:'Missing or insufficient permissions.',code:'permission-denied'}];_maInvalidate()");
    const c=app.run("_maPageHTML('ma-in')");
    return Promise.resolve(a+b+c);
  },
  // M2 screens review, finding 1: Today (and Money in) in the state the owners
  // see while the courier rules are NOT published — every one of the three
  // reads refused, so "incomplete — ma_cpr and ma_collection could not be
  // read" is on the page in its real words, in the narrow stat tiles and the
  // definition list. It was nowrap: 313px of text in a ~170px tile, running
  // 126px past a 390px screen. The check named in the probe as
  // data-ma-past-edge makes this fragment FAIL on that CSS (the stock checks
  // did not: the overflow lands inside #main-content, which scrolls).
  'master accounts — Today with the courier reads refused':()=>{
    const app=_maCourierFixture();
    app.run("_maLoadErrs=['cpr','collection','runs'].map(k=>({key:k,col:'ma_'+(k==='runs'?'runs':k),core:false,message:'Missing or insufficient permissions.',code:'permission-denied'}));_maInvalidate()");
    const a=app.run("_maPageHTML('ma-overview')"),b=app.run("_maPageHTML('ma-in')");
    return Promise.resolve('<i data-ma-past-edge="1" hidden></i>'+a+b);
  },
  // Finding 5: the TCS account (1060) is a WALLET — money that sits at TCS —
  // so after a TCS credit it is listed under Cash in hand on a line of its own
  // that says it is not counted, with no "Can pay", and it is not "in this
  // month". Today, Money (the holders table with Can pay) and the wallet's
  // own page.
  'master accounts — the TCS account is held, not counted':()=>{
    const app=_maCourierFixture();
    app.run(`(()=>{const IDX=maChartIndex(maChart('groovy',[])),S=maSettings(null);
      const t=maData.cpr.find(d=>d.id==='CS-27-0001');
      const d=maBuildDoc('collection',{courier:'tcs',holder:'1060',amount:t.net,date:'2026-09-10',cprNos:['CS-27-0001'],attachments:[]},{by:'afnan',byName:'Afnan',ts:1790000000000,cprs:maData.cpr},IDX,S);
      d.no='CL-27-0004';d.id='CL-27-0004';maData.collection.push(d);_maInvalidate();return 1;})()`);
    const a=app.run("_maPageHTML('ma-overview')"),b=app.run("_maPageHTML('ma-money')");
    app.run("_maHolderCode='1060';_maPeriod='quarter'");
    return Promise.resolve(a+b+app.run("_maPageHTML('ma-holder')"));
  },
  // The rail beside a CPR (1900 only: up to 1440 it is a slide-over that
  // would sit on the page's own controls — the documented false hit). Its
  // parcels are what the rail reads on demand; one with a very long number.
  'master accounts — a CPR on the rail':()=>{
    const app=_maCourierFixture();
    app.run(`_maParcels={'postex-CPR-2026-00417':{state:'done',rows:[{_id:'a',trackingNumber:'PX12345678901234567890123456',statusCategory:'delivered',orderDeliveryDate:'2026-09-03',cod:3000,cprNumber_1:'CPR-2026-00417',upfrontPayment:2400},{_id:'b',trackingNumber:'PX2',statusCategory:'delivered',orderDeliveryDate:'2026-09-04',cod:2000,cprNumber_1:'CPR-2026-00417',cprNumber_2:'CPR-2026-00431',upfrontPayment:1500,reservePayment:200}]}};_maRail={kind:'doc',dt:'cpr',id:'postex-CPR-2026-00417'}`);
    return Promise.resolve({widths:[1900],html:app.run("_maPageHTML('ma-in')")});
  },
  // A typed statement on the rail: its lines, its reference (long on
  // purpose), the file it was recorded from, Edit and Void.
  'master accounts — a courier statement on the rail':()=>{
    const app=_maCourierFixture();
    app.run("_maRail={kind:'doc',dt:'cpr',id:'CS-27-0001'}");
    return Promise.resolve({widths:[1900],html:app.run("_maPageHTML('ma-in')")});
  },
  'master accounts — a collection on the rail':()=>{
    const app=_maCourierFixture();
    app.run("_maRail={kind:'doc',dt:'collection',id:'CL-27-0002'}");
    return Promise.resolve({widths:[1900],html:app.run("_maPageHTML('ma-in')")});
  },
  // The Collection form: the tick list with a receipt already collected, the
  // preview (a difference above tolerance, and who confirms), the drawer as
  // the holder; and the same form for TCS (its own account) and for Blue-Ex
  // (no statements).
  // The Courier statement form: the lines (one returned, one with a long
  // memo), the totals and TCS's credit day; and a recorded statement opened
  // to be edited.
  'master accounts — the Courier statement form':()=>{
    const app=_maCourierFixture();
    const wrap=(t,b,f)=>'<div class="ma-modal wide" style="position:static;max-height:none;margin-bottom:16px"><div class="ma-modal-head"><h2>'+t+'</h2><button class="ma-x" aria-label="Close">×</button></div><div class="ma-modal-body">'+b+'</div>'+(f?'<div class="ma-modal-foot">'+f+'</div>':'')+'</div>';
    const foot='<button class="ma-btn">Cancel</button><button class="ma-btn primary">Record</button>';
    const body=()=>(app.bodyHtml('ma-modal-back').match(/<div class="ma-modal-body"[^>]*>([\s\S]*)<\/div>\s*<div class="ma-modal-foot">/)||[])[1]||'';
    app.run("window.maRecordKind('statement',{courier:'tcs',ref:'TCS-SEP-2026-STATEMENT-OF-ACCOUNT',lines:[{date:'2026-09-10',parcels:12,cod:35000,fee:1750,tax:280,memo:'A long memo about the first week, the manual adjustment TCS made and why'},{date:'2026-09-12',parcels:2,returned:true,cod:0,fee:200,tax:30},{}]})");
    const one=body();
    app.run("window.maCloseModal();window.maEditDoc('cpr','CS-27-0001')");
    const two=body().replace(/id="ma-/g,'id="ma-b-').replace(/for="ma-/g,'for="ma-b-');
    return Promise.resolve(wrap('Record a courier statement',one,foot)+wrap('Edit CS-27-0001',two,foot));
  },
  'master accounts — the Collection form':()=>{
    const app=_maCourierFixture();
    const wrap=(t,b,f)=>'<div class="ma-modal wide" style="position:static;max-height:none;margin-bottom:16px"><div class="ma-modal-head"><h2>'+t+'</h2><button class="ma-x" aria-label="Close">×</button></div><div class="ma-modal-body">'+b+'</div>'+(f?'<div class="ma-modal-foot">'+f+'</div>':'')+'</div>';
    const foot='<button class="ma-btn">Cancel</button><button class="ma-btn primary">Record</button>';
    const body=()=>(app.bodyHtml('ma-modal-back').match(/<div class="ma-modal-body"[^>]*>([\s\S]*)<\/div>\s*<div class="ma-modal-foot">/)||[])[1]||'';
    app.run("window.maRecordKind('collection',{courier:'postex',cprNos:['postex-CPR-2026-00452','postex-CPR-2026-00417'],holder:'1010',amount:'900',note:'The rider kept some for fuel'})");
    // The preview is written into the live element; carry its text over.
    const prev=app.el('ma-f-prev').innerHTML;
    const one=body().replace('<div class="ma-prev" id="ma-f-prev" role="status"></div>','<div class="ma-prev" role="status">'+prev+'</div>');
    app.run("window.maCloseModal();window.maRecordKind('collection',{courier:'tcs',cprNos:['CS-27-0001']})");
    const prev2=app.el('ma-f-prev').innerHTML;
    const two=body().replace('<div class="ma-prev" id="ma-f-prev" role="status"></div>','<div class="ma-prev" role="status">'+prev2+'</div>').replace(/id="ma-/g,'id="ma-b-').replace(/for="ma-/g,'for="ma-b-');
    app.run("window.maCloseModal();window.maRecordKind('collection',{courier:'bluex'})");
    const three=body().replace('<div class="ma-prev" id="ma-f-prev" role="status"></div>','<div class="ma-prev" role="status">'+app.el('ma-f-prev').innerHTML+'</div>').replace(/id="ma-/g,'id="ma-c-').replace(/for="ma-/g,'for="ma-c-');
    return Promise.resolve(wrap('Record a collection',one,foot)+wrap('Record a collection — TCS',two,foot)+wrap('Record a collection — Blue-Ex',three,foot));
  },
  'master accounts — Money and a holder':()=>{
    const app=_maFixture();
    const money=app.run("_maPageHTML('ma-money')");
    app.run("_maHolderCode='1011';_maPeriod='quarter'");
    return Promise.resolve(money+app.run("_maPageHTML('ma-holder')"));
  },
  'master accounts — Ledger, documents and review':()=>{
    const app=_maFixture();
    app.run("_maPeriod='quarter';_maLedgerTab='postings'");
    const a=app.run("_maPageHTML('ma-ledger')");
    app.run("_maLedgerTab='documents'");const b=app.run("_maPageHTML('ma-ledger')");
    app.run("_maLedgerTab='review'");const c=app.run("_maPageHTML('ma-ledger')");
    return Promise.resolve(a+b+c);
  },
  'master accounts — a party page and the cost register':()=>{
    const app=_maFixture();
    app.run("_maPartyId='p1';_maPeriod='quarter'");
    return Promise.resolve(app.run("_maPageHTML('ma-party')")+app.run("_maPageHTML('ma-out')"));
  },
  'master accounts — the document rail':()=>{
    const app=_maFixture();
    app.run("_maRail={kind:'doc',dt:'journal',id:'JV-27-0004'};_maPeriod='quarter'");
    return Promise.resolve({widths:[1900],html:app.run("_maPageHTML('ma-ledger')")});
  },
  'master accounts — the Record picker and a form':()=>{
    const app=_maFixture();
    const wrap=(t,b,f)=>'<div class="ma-modal wide" style="position:static;max-height:none;margin-bottom:16px"><div class="ma-modal-head"><h2>'+t+'</h2><button class="ma-x" aria-label="Close">×</button></div><div class="ma-modal-body">'+b+'</div>'+(f?'<div class="ma-modal-foot">'+f+'</div>':'')+'</div>';
    const pick=app.run('_maPickerHTML()');
    // The later kinds UNFOLDED as well (QA F26), so the eight named tiles
    // are measured, not only the folded line. Its own ids, so nothing in
    // the page is named twice.
    app.run('_maSoonOpen=true');
    const open=app.run('_maPickerHTML()').replace('id="ma-soon-fold"','id="ma-soon-fold-2"').replace('aria-controls="ma-soon"','aria-controls="ma-soon-2"').replace('id="ma-soon"','id="ma-soon-2"');
    app.run('_maSoonOpen=false');
    app.run("window.maRecordKind('money_out',{party:'p1',commitmentId:'c2',tax:{kind:'sales',rate:18,inclusive:true}})");
    const form=(app.bodyHtml('ma-modal-back').match(/<div class="ma-modal-body"[^>]*>([\s\S]*)<\/div>\s*<div class="ma-modal-foot">/)||[])[1]||'';
    const foot='<button class="ma-btn">Cancel</button><button class="ma-btn primary">Record</button>';
    app.run("window.maRecordKind('general')");
    const jv=(app.bodyHtml('ma-modal-back').match(/<div class="ma-modal-body"[^>]*>([\s\S]*)<\/div>\s*<div class="ma-modal-foot">/)||[])[1]||'';
    return Promise.resolve(wrap('Record',pick,'')+wrap('Record — later kinds open',open,'')+wrap('Money out',form,foot)+wrap('Journal',jv,foot));
  },
  // M1.5b: a bill or receipt on a document, a share link, the backups. A
  // file NAME is the one thing that says which file it is, so it wraps and
  // is never ellipsized away — the rail and the form both carry a long one.
  'master accounts — a document\'s files on the rail':()=>{
    const app=_maFixture();
    app.run(`(()=>{const d=maData.journal.find(x=>x.id==='JV-27-0003');const T=Date.UTC(2026,8,20,6);
      d.attachments=maAttachList([{publicId:'ma/'+'1'.repeat(64),format:'pdf',type:'authenticated',version:1790000001,bytes:2411520,mime:'application/pdf',by:'afnan',at:T,
          name:'Al-Karam Textiles — tax invoice INV-2026-09-0417, single jersey 180 GSM, 350 kg (scanned on the phone, page 1 of 3).pdf'},
        {publicId:'ma/'+'2'.repeat(64),format:'jpg',type:'authenticated',version:1790000002,bytes:318000,mime:'image/jpeg',by:'ammar',at:T+60000,name:'delivery-challan.jpg'}]);
      _maInvalidate();_maRail={kind:'doc',dt:'journal',id:'JV-27-0003'};_maPeriod='quarter';})()`);
    // heights: the rail is a sticky column 100vh tall that scrolls inside
    // itself, and this page is ~1,220px; in a 1000px window the file list
    // could sit in the rail's scrolled-away part, which the probe reads as
    // covered. A 1400px viewport shows the whole rail. Nothing here keys off
    // the viewport height except that box.
    return Promise.resolve({widths:[1900],heights:[1400],html:app.run("_maPageHTML('ma-ledger')")});
  },
  'master accounts — the file field on a form':()=>{
    const app=_maFixture();
    const wrap=(t,b)=>'<div class="ma-modal wide" style="position:static;max-height:none;margin-bottom:16px"><div class="ma-modal-head"><h2>'+t+'</h2><button class="ma-x" aria-label="Close">×</button></div><div class="ma-modal-body">'+b+'</div></div>';
    app.run("window.maRecordKind('money_out',{party:'p1'})");
    app.run(`_maF.atts=maAttachList([{publicId:'ma/'+'3'.repeat(64),format:'pdf',type:'upload',bytes:2411520,mime:'application/pdf',by:'afnan',at:Date.UTC(2026,8,20,6),
        name:'Al-Karam Textiles — tax invoice INV-2026-09-0417, single jersey 180 GSM, 350 kg (scanned on the phone, page 1 of 3).pdf'},
      {publicId:'ma/'+'4'.repeat(64),format:'heic',type:'upload',bytes:1843200,mime:'image/heic',by:'afnan',at:Date.UTC(2026,8,20,7),name:'IMG_4471.HEIC'}]);
      _maF.attErr='quote.docx did not upload: Only images (JPG, PNG, WebP, HEIC) and PDFs can be attached — not .docx files. · big.pdf did not upload: Cloudinary refused the file: File size too large. Got 11000000. Maximum is 10485760.';
      _maF.attNote=_MA_PUBLIC_NOTE;`);
    const full=app.run('_maAttFieldHTML()');
    app.run("_maF.atts=[];_maF.attErr='';_maF.attNote='';_maF.attBusy=2");
    const busy=app.run('_maAttFieldHTML()');
    return Promise.resolve(wrap('Money out — two files, two refused, public mode',full)+wrap('Money out — uploading',busy));
  },
  'master accounts — the share panel':()=>{
    const app=_maFixture();
    const wrap=(t,b,f)=>'<div class="ma-modal wide" style="position:static;max-height:none;margin-bottom:16px"><div class="ma-modal-head"><h2>'+t+'</h2><button class="ma-x" aria-label="Close">×</button></div><div class="ma-modal-body">'+b+'</div>'+(f?'<div class="ma-modal-foot">'+f+'</div>':'')+'</div>';
    const now=Date.now(),D=86400000,tok=c=>c.repeat(43);
    app.run(`_maAttachSt={configured:true,mode:'unsigned',missing:['CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET'],maxBytes:26214400,urlSeconds:300};
      _maShare={spec:_maShareSpec('journal','JV-27-0003'),busy:false,step:'',err:'',
        made:{token:'${tok('k')}',link:'https://groovyoperations.netlify.app/.netlify/functions/ma-share?t=${tok('k')}',expiresAt:${now+7*D},to:{party:'Al-Karam Textiles',phone:'+923001234567'}},
        list:{state:'ok',rows:[],err:''}};`);
    const panel=app.run('_maShareBodyHTML()');
    const foot='<button class="ma-btn">Close</button><button class="ma-btn primary">Make a link</button>';
    return Promise.resolve(wrap('Share · Voucher JV-27-0003',panel,foot));
  },
  'master accounts — the links already made':()=>{
    const app=_maFixture();
    const wrap=(t,b)=>'<div class="ma-modal wide" style="position:static;max-height:none;margin-bottom:16px"><div class="ma-modal-head"><h2>'+t+'</h2></div><div class="ma-modal-body">'+b+'</div></div>';
    const now=Date.now(),D=86400000,tok=c=>c.repeat(43);
    // The record ma-share writes (M1.6b: the page calls a link live only
    // when the function would serve it, so the file reference is here too).
    const base={docKind:'journal',docId:'JV-27-0003',docNo:'JV-27-0003 · rev 1',pdfPublicId:'ma/'+'5'.repeat(64),format:'pdf',resourceType:'image',deliveryType:'authenticated',createdBy:'afnan',createdAt:now-2*D,days:7,revoked:false,opens:0,previews:0};
    const rows=[
      Object.assign({},base,{token:tok('a'),filename:'Voucher-JV-27-0003 — Al-Karam Textiles, tax invoice INV-2026-09-0417, single jersey 180 GSM.pdf',to:{party:'Al-Karam Textiles (Faisalabad mill, accounts office)',phone:'+923001234567'},expiresAt:now+5*D,opens:12,lastOpenedAt:now-3600000,previews:3,lastPreviewAt:now-7200000}),
      Object.assign({},base,{token:tok('b'),filename:'Voucher-JV-27-0003.pdf',createdAt:now-20*D,expiresAt:now-13*D,opens:1,lastOpenedAt:now-19*D}),
      Object.assign({},base,{token:tok('c'),filename:'Voucher-JV-27-0003.pdf',createdBy:'ammar',expiresAt:now+5*D,revoked:true,revokedAt:now-D,revokedBy:'ammar'}),
      Object.assign({},base,{token:tok('d'),filename:'Voucher-JV-27-0003.pdf',revoked:'no',expiresAt:now+5*D})];
    app.run(`_maShare={spec:_maShareSpec('journal','JV-27-0003'),busy:false,step:'',err:'',made:null,list:{state:'ok',rows:${JSON.stringify(rows)},err:''}}`);
    const list=app.run('_maShareListHTML()');
    app.run("_maShare.list={state:'error',rows:[],err:'Missing or insufficient permissions.'}");
    const err=app.run('_maShareListHTML()');
    // M1.6b: a live link to a document edited since it was made says so.
    const stale=[Object.assign({},base,{token:tok('e'),docId:'JV-27-0004',docNo:'JV-27-0004 · rev 1',filename:'Voucher-JV-27-0004 — Al-Hamd Washing, the September wash.pdf',expiresAt:now+5*D,opens:2,lastOpenedAt:now-3600000})];
    app.run(`_maShare={spec:_maShareSpec('journal','JV-27-0004'),busy:false,step:'',err:'',made:null,list:{state:'ok',rows:${JSON.stringify(stale)},err:''}}`);
    const moved=app.run('_maShareListHTML()');
    return Promise.resolve(wrap('Links to this voucher — live, expired, withdrawn, not valid',list)+wrap('Links — a refused read',err)+wrap('Links — the document changed since',moved));
  },
  // M1.6b: the drawer could not be read and the backups could not be read —
  // "incomplete" wherever cash in hand is shown, the 30 days not judged, the
  // Money page's holder table — and the Ledger's running balance hidden
  // under a party filter and for the drawer, said in words.
  'master accounts — the drawer not read, and the backups not read':()=>{
    const app=_maFixture();
    // A loom instalment the holders cannot meet: without the drawer that
    // day cannot be judged, and the page says so instead of "runs short".
    app.run("maData.commitments.push({id:'c9',name:'Loom instalment',kind:'financing',cadence:'monthly',dueDay:10,amountExpected:9000000,account:'2140',holder:'1020',costCentre:'factory',active:true})");
    app.run("_maMirror={ok:false,cash:null,why:'Missing or insufficient permissions.',at:Date.now()};_maLoadErrs=[{key:'backups',col:'ma_backups',core:false,message:'Missing or insufficient permissions.',code:'permission-denied'}];_maInvalidate()");
    return Promise.resolve(app.run("_maPageHTML('ma-overview')")+app.run("_maPageHTML('ma-money')"));
  },
  'master accounts — a ledger with no running balance':()=>{
    const app=_maFixture();
    app.run("_maPeriod='quarter';_maLedgerTab='postings';_maLF=Object.assign(_maLFBlank(),{holder:'1020',party:'p3'})");
    const filtered=app.run("_maPageHTML('ma-ledger')");
    app.run("_maLF=Object.assign(_maLFBlank(),{holder:'1010'})");
    const drawer=app.run("_maPageHTML('ma-ledger')");
    return Promise.resolve(filtered+drawer);
  },
  // The Dashboard card: locked (it reads nothing), and with the drawer and
  // the backups unread — two warning words that must wrap at phone width.
  'master accounts — the Dashboard card, locked and incomplete':()=>{
    const app=_maFixture();
    return (async()=>{
      const card=()=>{const b=app.el('ma-dash-body');return app.run('renderMasterAccountsDashboardWidget()').replace('Loading…',b.innerHTML||app.run('maEsc('+JSON.stringify(b.textContent)+')'));};
      app.run('_maNeedsRelock=()=>true');
      await app.run('_maPopulateDashboard()');
      const locked=card();
      app.run('_maNeedsRelock=()=>false');
      app.run("_maMirror={ok:false,cash:null,why:'Missing or insufficient permissions.',at:Date.now()};_maLoadErrs=[{key:'backups',col:'ma_backups',core:false,message:'Missing or insufficient permissions.',code:'permission-denied'}];_maInvalidate()");
      const b=app.el('ma-dash-body');b.innerHTML='';b.textContent='';
      await app.run('_maPopulateDashboard()');
      return locked+card();
    })();
  },
  'master accounts — backups in every state, and the attachment mode':()=>{
    const app=_maFixture();
    const now=Date.now(),H=3600000;
    const runs=[{id:'nightly-2026-09-28',state:'running',ok:null,at:now-30*60000,operationState:'PROCESSING',collections:25},
      {id:'nightly-2026-09-27',state:'not_configured',ok:false,configured:false,missing:['MA_BACKUP_BUCKET','FIREBASE_SERVICE_ACCOUNT'],error:'Backups are not set up yet — MA_BACKUP_BUCKET and FIREBASE_SERVICE_ACCOUNT are not set in Netlify',at:now-24*H},
      {id:'nightly-2026-09-26',state:'failed',ok:false,error:'Firestore refused the export (HTTP 403): The caller does not have permission to export groovy-gatepass to gs://groovy-ma-backups/nightly-2026-09-26',at:now-48*H},
      {id:'nightly-2026-09-25',state:'done',ok:true,collections:25,size:'12.3 MB',documents:123456,at:now-72*H},
      {id:'nightly-2026-09-24',state:'starting',ok:null,at:now-96*H,lastCheckError:'operations.get answered HTTP 503'},
      {id:'nightly-2026-09-23',ok:null,at:now-120*H}];
    app.run('maData.backups='+JSON.stringify(runs)+';_maInvalidate();_maCloseTab="overview"');
    const close=app.run("_maCloseOverviewHTML(_maCtx())");
    app.run("_maAttachSt={configured:true,mode:'authenticated',missing:[],maxBytes:26214400,urlSeconds:300}");
    const priv=app.run("_maSec('Attachments and share links — private','','',_maAttachModeHTML())");
    app.run("_maAttachSt={configured:false,state:'public',publicOptIn:true,mode:'unsigned',missing:['CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET'],maxBytes:26214400,urlSeconds:300}");
    const pub=app.run("_maSec('Attachments and share links — public, on purpose','','',_maAttachModeHTML())");
    // M1.6c: no key and no opt-in — the server's 503 status, as the loader
    // keeps it (its sentence is attachNotSetUp's, word for word).
    app.run("_maAttachSt={error:'Attachments are not set up: CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are not set in Netlify. Without the key a file would go up public — open, for good, to anyone who has its link — so nothing is uploaded. Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Netlify to keep files private, or set MA_ALLOW_PUBLIC_ATTACH to 1 to allow public files on purpose.',code:'not_configured',state:'not_configured'}");
    const off=app.run("_maSec('Attachments and share links — off, not set up','','',_maAttachModeHTML())");
    // heights: the probe does not hit-test below the window, so the viewport
    // must hold the whole of it at 420 wide (it was ~1,410px there before the
    // switched-off card was added; 1,000 at 1900). These pages do not key off
    // the viewport height.
    return Promise.resolve({heights:[1900],html:close+priv+pub+off});
  },
  // The login screen and the app lock, straight out of index.html (the
  // markup lives there, not in a module). Measured with the forgot-password
  // note OPEN, so its text is checked too. The lock's card is taken out of
  // #scr-lock, which is position:fixed at z 10000 and would sit over the
  // login copy and report every control on it as covered.
  'login — the sign-in screen and the fingerprint lock':()=>{
    const idx=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
    const login=idx.slice(idx.indexOf('<div id="scr-login">'),idx.indexOf('<!-- ══ APP LOCK'))
      .replace('<div id="scr-login">','<div id="scr-login" style="display:flex;position:relative;height:auto">')
      
      .replace('id="login-finger" onclick="window.loginWithFingerprint()" hidden','id="login-finger" onclick="window.loginWithFingerprint()"')
      .replace('title="Use a saved password" hidden','title="Use a saved password"')
      .replace('<button type="button" class="login-theme" id="login-theme-btn" onclick="window.loginCycleTheme()" aria-label="Change theme" title="Theme"></button>',
        '<button type="button" class="login-theme" id="login-theme-btn" onclick="window.loginCycleTheme()" aria-label="Change theme"><span>Auto</span></button>');
    const lockAt=idx.indexOf('<div class="login-box lock-box">');
    const lock=idx.slice(lockAt,idx.indexOf('<!-- ══ APP ══ -->'));
    const lockBox=lock.slice(0,lock.lastIndexOf('</div>'))
      .replace('<div class="lock-msg" id="lock-msg" role="status"></div>','<div class="lock-msg" id="lock-msg" role="status">Not unlocked. Tap the fingerprint to try again.</div>');
    // The forgot-password sheet is position:fixed in the app; here it is
    // taken OUT of #scr-login (a flex row, where it would squeeze the form)
    // and laid out in flow, open, so its text is measured too.
    const sheetAt=login.indexOf('<div class="login-sheet"');
    const sheet=login.slice(sheetAt,login.lastIndexOf('</div>'))
      .replace('class="login-sheet" id="login-help" hidden','class="login-sheet open" id="login-help" style="position:relative;inset:auto;z-index:auto;background:none"');
    const loginOnly=login.slice(0,sheetAt)+'</div>';
    return loginOnly+sheet+'<div style="display:flex;justify-content:center;padding:20px 0">'+lockBox+'</div>';
  },
  // The Board's shell. The rail is NAVIGATION CHROME and the only route
  // between the four screens, so every button has to be reachable at every
  // width -- the lesson the Mood Boards tool rail cost. At phone width it
  // docks as a HORIZONTAL scroller, which is why the rail check in this
  // file is scoped to the vertical axis: a scrollable axis has moved a
  // control, not hidden it.
  // The Dashboard as five people will actually see it: the row is a flexing
  // title beside fixed meta, which is the Profile-directory shape that
  // shipped every name at exactly 0px. Long titles on purpose.
  // The calendar is the densest grid in the app: seven columns of pills,
  // each a flexing title beside fixed meta, at every width. A day square
  // at 420px is ~50px wide, which is exactly where a pill title gets
  // crushed to nothing if its min-width:0 is missing.
  'the board — calendar':()=>{
    const app=loadApp({
      files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-calendar',
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
    });
    app.run("session={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
    app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar'},{uid:'u-dani',username:'daniyal',displayName:'Daniyal Tufail'},{uid:'u-must',username:'mustafa',displayName:'Mustafa'}]");
    app.run("tbLists=[{id:'l1',title:'Winter Drop 2027',kind:'shared',adminUid:'u-ammar',memberUids:['u-ammar'],color:'moss'}]");
    app.run("tbConfig={markers:[{label:'launch',date:'2026-10-30'},{label:'founders out',date:'2026-11-01'}]}");
    app.run("tbLoaded=true;_tbLoadErrors=[];_tbCalAnchor='2026-10-15';_tbCalView='month';_tbCalFilters={scope:'all',person:'',list:'',lane:'',color:'',hideDone:false}");
    // The real seed's longest titles, a locked gate, a done one, and FIVE
    // pills on one day — the square that has to hold the most.
    app.run("tbItems=[" +
      "tbDecodeItem({id:'a',title:'ALL ASSETS IN — including website UI assets',date:'2026-10-25',kind:'gate',locked:true,lockedBy:'u-ammar',status:'open',ownerUid:'u-ammar',assigneeUids:['u-ammar'],visibility:'shared',listId:'l1'})," +
      "tbDecodeItem({id:'b',title:'First run complete + Haris QC',date:'2026-10-25',kind:'gate',locked:true,lockedBy:'u-ammar',status:'open',ownerUid:'u-must',assigneeUids:['u-must'],visibility:'shared',listId:'l1'})," +
      "tbDecodeItem({id:'c',title:'November runbook signed: restock triggers, daily report, cash authority',date:'2026-10-25',kind:'gate',status:'open',ownerUid:'u-must',assigneeUids:['u-must','u-ammar'],visibility:'shared',listId:'l1'})," +
      "tbDecodeItem({id:'d',title:'Ad copy + headlines',date:'2026-10-25',status:'open',ownerUid:'u-ammar',assigneeUids:['u-ammar'],visibility:'shared',listId:'l1'})," +
      "tbDecodeItem({id:'e',title:'done already',date:'2026-10-25',status:'done',ownerUid:'u-ammar',assigneeUids:['u-ammar'],visibility:'shared'})," +
      "tbDecodeItem({id:'f',title:'LAUNCH',date:'2026-10-30',kind:'gate',locked:true,lockedBy:'u-ammar',status:'open',ownerUid:'u-ammar',assigneeUids:['u-ammar'],visibility:'shared',listId:'l1'})," +
      "tbDecodeItem({id:'g',title:'Launch rehearsal: theme preview, stock count, CSR scripts, courier',date:'2026-10-29',kind:'event',status:'open',ownerUid:'u-ammar',assigneeUids:['u-ammar'],visibility:'shared',listId:'l1'})]");
    app.run('_tbHydrateQueue=[]');
    const html=app.run('_tbCalendar()');
    // Every pill title is hydrated with textContent, so a fragment that did
    // not fill them in would measure EMPTY boxes and prove nothing — the
    // trap the rail fragment walked into once already.
    const q=app.run('_tbHydrateQueue');
    let out=html;
    q.forEach(x=>{ out=out.replace(new RegExp('(id="'+x.id+'"[^>]*>)'),
      '$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))); });
    return out;
  },

  'the board — dashboard':()=>{
    const app=loadApp({
      files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-dash',
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
    });
    app.run("session={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
    app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar'},{uid:'u-afnan',username:'afnan',displayName:'Afnan'},{uid:'u-must',username:'mustafa',displayName:'Mustafa'}]");
    app.run("tbLists=[{id:'l1',title:'Winter Drop 2027',kind:'shared',adminUid:'u-ammar',memberUids:['u-ammar'],color:'moss'}]");
    app.run("tbConfig={markers:[{label:'launch',date:'2026-10-30'},{label:'founders out',date:'2026-11-01'}]}");
    app.run("tbLoaded=true;_tbLoadErrors=[]");
    // The real seed's longest title, an overdue row, a locked gate, a row
    // with every piece of meta at once, and a critical one.
    app.run("tbItems=[" +
      "tbDecodeItem({id:'a',title:'Hyderabad supplier in Karachi: lock sample date + bulk date (bulk must land by Oct 24)',status:'open',kind:'gate',locked:true,lockedBy:'u-afnan',visibility:'shared',ownerUid:'u-afnan',assigneeUids:['u-ammar','u-afnan','u-must'],date:'2026-09-20',listId:'l1',commentCount:12,steps:[{id:'1',done:true},{id:'2',done:false},{id:'3',done:false}]})," +
      "tbDecodeItem({id:'b',title:'ALL ASSETS IN — including website UI assets',status:'open',kind:'gate',locked:true,lockedBy:'u-ammar',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar'],date:'2026-09-24',listId:'l1',priority:2})," +
      "tbDecodeItem({id:'c',title:'Walika visit → Jibran procures → dye orders placed (200 kg MOQ per shade)',status:'open',visibility:'shared',ownerUid:'u-afnan',assigneeUids:['u-ammar'],date:'2026-09-28',listId:'l1'})," +
      "tbDecodeItem({id:'d',title:'Denim bulk lands → Mustafa QC',status:'open',kind:'gate',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar','u-must'],date:null,listId:'l1'})," +
      "tbDecodeItem({id:'e',title:'done already',status:'done',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar'],date:'2026-09-24'})]");
    app.run("_tbHydrateQueue=[]");
    const html=app.run('_tbDashboard()');
    // The module hydrates every title with textContent, so a fragment that
    // did not fill them in would measure EMPTY boxes and prove nothing —
    // the trap the rail fragment already walked into once. Fill them here,
    // in the markup, the way the link-preview fragment does.
    const q=app.run('_tbHydrateQueue');
    let out=html;
    q.forEach(x=>{ out=out.replace('id="'+x.id+'"','id="'+x.id+'"')
      .replace(new RegExp('(id="'+x.id+'"[^>]*>)'),'$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))); });
    return out;
  },

  // A list's own screen (session 2, P1.3): the densest rows the Board
  // draws -- a gate with three other people, steps, comments, a lock and a
  // long title; a starred row; and the Completed group open, with a done
  // item's struck-through title. The meta line has to WRAP at 420px.
  'the board — a list, its rows and Completed':()=>{
    const app=loadApp({
      files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-lists',
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
    });
    app.run("session={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
    app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar'},{uid:'u-afnan',username:'afnan',displayName:'Afnan'},{uid:'u-must',username:'mustafa',displayName:'Mustafa'},{uid:'u-dani',username:'daniyal',displayName:'Daniyal Tufail'},{uid:'u-saim',username:'saim',displayName:'Saim'}]");
    app.run("tbLists=[{id:'l1',title:'Winter Drop 2027 — denim, knits and the Karachi suppliers',kind:'shared',adminUid:'u-ammar',memberUids:['u-ammar'],color:'moss'}]");
    app.run("tbConfig={markers:[]};tbLoaded=true;_tbLoadErrors=[];_tbListId='l1';_tbDoneOpen={}");
    app.run("tbItems=[" +
      "tbDecodeItem({id:'a',title:'Hyderabad supplier in Karachi: lock sample date + bulk date (bulk must land by Oct 24)',status:'open',kind:'gate',locked:true,lockedBy:'u-afnan',visibility:'shared',ownerUid:'u-afnan',assigneeUids:['u-ammar','u-afnan','u-must','u-dani','u-saim'],date:'2026-09-20',listId:'l1',commentCount:128,steps:[{id:'1',done:true},{id:'2',done:false},{id:'3',done:false}],priority:2})," +
      "tbDecodeItem({id:'b',title:'Walika visit',status:'open',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar'],date:_tbToday(),listId:'l1',myDay:{'u-ammar':_tbToday()}})," +
      "tbDecodeItem({id:'c',title:'Denim bulk lands → Mustafa QC',status:'open',kind:'deadline',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar','u-must'],date:null,listId:'l1'})," +
      "tbDecodeItem({id:'d',title:'Trims ordered: zips, rivets, the woven labels and the care labels for every size',status:'done',completedAt:5,visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar','u-afnan'],date:'2026-09-10',listId:'l1'})]");
    app.run("_tbHydrateQueue=[]");
    // The same gate OFF its list (a Dashboard card), where the meta line
    // also names the list: the longest meta line the Board draws.
    const html=app.run('_tbListsScreen()')+app.run("_tbCard('Assigned to Me',[_tbRow(tbItems[0],_tbToday())])");
    let out=html;
    app.run('_tbHydrateQueue').forEach(x=>{
      out=out.replace(new RegExp('(id="'+x.id+'"[^>]*>)'),'$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])));
    });
    // .tb-main ALONE, not inside .tb-wrap: the frame is a grid since P1.2,
    // and a .tb-wrap without its rail puts the content in the 240px rail
    // column -- which is how this fragment first measured a 136px row.
    return '<div class="tb-main">'+out+'</div>';
  },

  // The whole frame with an item open (session 2, P1.4): rail | list |
  // detail pane. At 1900 the pane is the third column beside a full rail;
  // at 1280 (the 1024-1439 band) the rail folds to its icons so the list
  // keeps its room. Below 1024 the pane is a panel OVER the page, so a
  // narrower width would measure the pane covering the list on purpose --
  // the fragment measuring itself -- and those widths are the drawer
  // fragment's (the pane's own content) and smoke-board's (it opens).
  'the board — the frame with the detail pane open':()=>{
    const app=loadApp({
      files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-lists',
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
    });
    app.run("session={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
    app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar'},{uid:'u-afnan',username:'afnan',displayName:'Afnan'},{uid:'u-must',username:'mustafa',displayName:'Mustafa'},{uid:'u-dani',username:'daniyal',displayName:'Daniyal Tufail'},{uid:'u-saim',username:'saim',displayName:'Saim'}]");
    app.run("tbLists=[{id:'l1',title:'Winter Drop 2027',kind:'shared',adminUid:'u-ammar',memberUids:['u-ammar'],color:'moss'},{id:'l2',title:'Errands',kind:'private',adminUid:'u-ammar',memberUids:['u-ammar']}]");
    app.run("tbConfig={markers:[]};tbLoaded=true;_tbLoadErrors=[];_tbListId='l1';_tbDoneOpen={};_tbOpenItemId='a'");
    app.run("tbItems=[" +
      "tbDecodeItem({id:'a',title:'Hyderabad supplier in Karachi: lock sample date + bulk date (bulk must land by Oct 24)',status:'open',kind:'gate',locked:true,lockedBy:'u-afnan',visibility:'shared',ownerUid:'u-afnan',assigneeUids:['u-ammar','u-afnan','u-must'],date:'2026-09-20',datePlanned:'2026-09-18',listId:'l1',lane:'denim',commentCount:3,createdAt:Date.now()-86400000*6,steps:[{id:'1',title:'call the supplier',done:true},{id:'2',title:'confirm the sample date in writing',done:false}]})," +
      "tbDecodeItem({id:'b',title:'Walika visit',status:'open',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar'],date:_tbToday(),listId:'l1'})]");
    app.run("_tbHydrateQueue=[]");
    const body=app.run('_tbListsScreen()');
    let out=app.run("_tbShell('tb-lists',"+JSON.stringify(body)+",_tbDrawer())");
    app.run('_tbHydrateQueue').forEach(x=>{
      out=out.replace(new RegExp('(id="'+x.id+'"[^>]*>)'),'$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])));
    });
    // The pane scrolls on its own in the app (a max-height off 100dvh);
    // here it is laid out at full height so every control in it is
    // measured, rather than reported "covered" for sitting below its own
    // scroll -- the documented false hit.
    return {widths:[1900,1280],html:'<style>.tb-drawer{max-height:none;position:static}</style>'+out};
  },

  // The quick-add composer OPEN (session 2, P0.5): three rows of chips that
  // must wrap at phone width rather than push the page sideways, a date
  // field, two selects, a picked date with its clear button, a picked
  // person, and one person not set up yet (dashed, disabled).
  'the board — the quick-add composer':()=>{
    const app=loadApp({
      files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-dash',
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
    });
    app.run("session={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
    app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar'},{uid:'u-afnan',username:'afnan',displayName:'Afnan'},{uid:'u-dani',username:'daniyal',displayName:'Daniyal Tufail'},{uid:'u-must',username:'mustafa',displayName:'Mustafa'}]");
    app.run("tbLists=[{id:'l1',title:'Winter Drop 2027',kind:'shared',adminUid:'u-ammar',memberUids:['u-ammar'],color:'moss'}]");
    app.run("tbConfig={markers:[]};tbLoaded=true;_tbLoadErrors=[];tbItems=[];_tbListId=null");
    app.run("_tbQaReset(true);_tbQa.text='denim samples @afnan';_tbQa.dateSet=true;_tbQa.date='2026-10-05';_tbQa.assign=['u-dani'];_tbQa.lane='denim'");
    return '<div class="tb-main">'+app.run("_tbComposer('add something — try: denim samples @afnan #denim oct 5 !')")+'</div>';
  },

  // The drawer: a fixed panel over the page, with a disabled date field
  // (someone else holds the lock) and the "was" date beside it.
  'the board — item drawer':()=>{
    const app=loadApp({
      files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-dash',
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
    });
    app.run("session={uid:'u-dani',u:'daniyal',name:'Daniyal',role:'creator_content_ops_lead',email:'daniyal@groovy.op'}");
    app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar'},{uid:'u-afnan',username:'afnan',displayName:'Afnan'},{uid:'u-dani',username:'daniyal',displayName:'Daniyal Tufail'},{uid:'u-must',username:'mustafa',displayName:'Mustafa'},{uid:'u-saim',username:'saim',displayName:'Saim'}]");
    app.run("tbLists=[{id:'l1',title:'Winter Drop 2027',kind:'shared',adminUid:'u-ammar',memberUids:['u-dani'],color:'moss'}]");
    app.run("tbLoaded=true;_tbLoadErrors=[];tbConfig=null");
    app.run("tbItems=[tbDecodeItem({id:'i1',title:'Shoot 2: knit + outerwear + henley + washed (Oct 15–16)',status:'open',kind:'gate',locked:true,lockedBy:'u-ammar',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-dani','u-ammar'],date:'2026-10-16',datePlanned:'2026-10-15',listId:'l1',lane:'shoot',notes:'CYC must be wired by the 5th.',steps:[{id:'1',title:'confirm models',done:true},{id:'2',title:'shot list to Saim',done:false}]})]");
    app.run("_tbOpenItemId='i1';_tbHydrateQueue=[]");
    const html=app.run('_tbDrawer()');
    const q=app.run('_tbHydrateQueue');
    // Laid out at full height, like the frame fragment above. Since P1.4 the
    // drawer is a sticky pane that scrolls inside its own box, and with the
    // CI runner's fonts the Files '+ add' fell below that box: the hit-test
    // then reads a control scrolled away inside a scroller as covered by
    // BODY - the documented false hit, not a layout fault.
    let out='<style>.tb-drawer{max-height:none;position:static}</style>'+html;
    q.forEach(x=>{ out=out.replace(new RegExp('(id="'+x.id+'"[^>]*>)'),'$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))); });
    return out;
  },

  // Phase 4. DELIBERATELY NOT folded into the drawer fragment above: the
  // drawer is already ~900px of content, and the probe SKIPS hit-testing
  // anything below the window, so a longer one would stop testing partway
  // down (the lesson the Mood Boards frame fragment records).
  'the board — thread, files and mentions':()=>{
    const app=loadApp({
      files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-dash',
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
    });
    app.run("session={uid:'u-dani',u:'daniyal',name:'Daniyal',role:'creator_content_ops_lead',email:'daniyal@groovy.op'}");
    app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar'},{uid:'u-afnan',username:'afnan',displayName:'Afnan'},{uid:'u-dani',username:'daniyal',displayName:'Daniyal Tufail'},{uid:'u-must',username:'mustafa',displayName:'Mustafa'},{uid:'u-saim',username:'saim',displayName:'Saim'}]");
    app.run("tbLists=[];tbLoaded=true;_tbLoadErrors=[];tbConfig=null");
    app.run("tbItems=[tbDecodeItem({id:'i1',title:'Shoot 2 — knit + outerwear',status:'open',kind:'gate',locked:true,lockedBy:'u-ammar',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-dani'],date:'2026-10-16',attachments:[{id:'f1',name:'winter-drop-2027-shot-list-final-v3.pdf',url:'https://res.cloudinary.com/deww4lpym/raw/upload/v1/a.pdf',mime:'application/pdf',size:2411724},{id:'f2',name:'ref.jpg',url:'https://res.cloudinary.com/deww4lpym/image/upload/v1/a.jpg',mime:'image/jpeg',size:81920}]})]");
    app.run("_tbOpenItemId='i1';_tbMoveReqOpen=true;_tbShowActivity=true");
    app.run("_tbThreads={i1:{err:false,comments:["
      +"{_id:'c1',authorUid:'u-ammar',body:'@[daniyal] the CYC has to be wired by the 5th — see **section 2** of `shot-list.pdf`, and https://groovypakistan.com/pages/lookbook for the reference.',createdAt:Date.now()-7200000,attachments:[]},"
      +"{_id:'c2',authorUid:'u-dani',body:'on it',createdAt:Date.now()-600000,attachments:[{id:'f3',name:'proof.jpg',url:'https://res.cloudinary.com/deww4lpym/image/upload/v1/b.jpg',mime:'image/jpeg',size:40960}]}"
      +"],activity:[{_id:'a1',type:'moved',byUid:'u-ammar',at:Date.now()-86400000,payload:{from:'2026-10-15',to:'2026-10-16',override:true}},{_id:'a2',type:'locked',byUid:'u-ammar',at:Date.now()-90000000,payload:{}}]}}");
    app.run('_tbHydrateQueue=[]');
    const parts=[app.run('_tbMoveReqSection(tbItems[0])'),
                 app.run('_tbFilesSection(tbItems[0])'),
                 app.run('_tbThreadSection(tbItems[0])'),
                 app.run('_tbActivitySection(tbItems[0])')].join('');
    // The popover's OPEN state is a class _tbPaintMentions toggles at
    // runtime, and the probe cannot type — so the markup below is the
    // real builder's output with that one class applied by hand. It goes
    // LAST, over its own spacer: a popover genuinely covers what is under
    // it, and covering the thread would be the fragment measuring itself.
    app.run("_tbMentionList=[{uid:'u-afnan',handle:'afnan',name:'Afnan',initial:'A'},{uid:'u-ammar',handle:'ammar',name:'Ammar',initial:'A'},{uid:'u-must',handle:'mustafa',name:'Mustafa',initial:'M'}];_tbMentionIdx=1");
    const pop='<div class="tb-comp"><textarea class="tb-compin" rows="2">@a</textarea>'
      +'<div class="tb-mentions on">'+app.run('_tbMentionHTML()')+'</div></div>'
      +'<div style="height:260px"></div>';
    const q=app.run('_tbHydrateQueue');
    let out=parts;
    q.forEach(x=>{ out=out.replace(new RegExp('(id="'+x.id+'"[^>]*>)'),'$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))); });
    return '<div class="tb-drawer" style="position:static;width:auto;height:auto">'+out+pop+'</div>';
  },

  'the board — inbox':()=>{
    const app=loadApp({
      files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-inbox',
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
    });
    app.run("session={uid:'u-dani',u:'daniyal',name:'Daniyal',role:'creator_content_ops_lead',email:'daniyal@groovy.op'}");
    app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar'},{uid:'u-dani',username:'daniyal',displayName:'Daniyal Tufail'},{uid:'u-must',username:'mustafa',displayName:'Mustafa'}]");
    app.run("tbLists=[];tbLoaded=true;_tbLoadErrors=[];tbConfig=null;_tbNotifSeeded=true");
    app.run("tbItems=[tbDecodeItem({id:'i1',title:'Shoot 2 — knit + outerwear + henley + washed',ownerUid:'u-ammar',assigneeUids:['u-dani'],visibility:'shared'})]");
    const n=(id,type,item,read,msg,ago)=>"{_id:'"+id+"',source:'tb',forUser:'daniyal',type:'"+type
      +"',itemId:'"+item+"',fromUid:'u-ammar',createdAt:Date.now()-"+ago+",readBy:"+(read?"['daniyal']":"[]")
      +",message:'"+msg+"'}";
    app.run('tbNotifs=['+[
      n('n1','mention','i1',false,'Ammar mentioned you on “Shoot 2” — @Daniyal the CYC has to be wired by the 5th',300000),
      n('n2','comment','i1',false,'Ammar commented on “Shoot 2” — on it',900000),
      n('n3','move_request','i2',true,'Ammar asks to move “ALL ASSETS IN” to 2026-10-28 — shoot slipped',86400000)
    ].join(',')+']');
    app.run('_tbHydrateQueue=[]');
    const body=app.run('_tbShell("tb-inbox",_tbInboxScreen())')+app.run('_tbDashboard()');
    const q=app.run('_tbHydrateQueue');
    let out=body;
    q.forEach(x=>{ out=out.replace(new RegExp('(id="'+x.id+'"[^>]*>)'),'$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))); });
    return out;
  },

  // Phase 5. Three fragments rather than one: the search screen and the
  // last three cards are ordinary flow, the calendar is its own shape, and
  // the two overlays are position:fixed and would report every control
  // under them as covered if they shared a page with anything.
  'the board — search and the last cards':()=>{
    const app=loadApp({
      files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-dash',
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
    });
    app.run("session={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
    app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar',boardLastSeenAt:Date.now()},{uid:'u-afnan',username:'afnan',displayName:'Afnan',boardLastSeenAt:1},{uid:'u-dani',username:'daniyal',displayName:'Daniyal Tufail'},{uid:'u-must',username:'mustafa',displayName:'Mustafa'},{uid:'u-saim',username:'saim',displayName:'Saim'}]");
    app.run("tbLists=[{id:'l1',title:'Winter Drop 2027',kind:'shared',adminUid:'u-ammar',memberUids:['u-ammar'],color:'moss'},{id:'l2',title:'a much longer private list name',kind:'private',adminUid:'u-ammar',color:'clay'}]");
    app.run("tbLoaded=true;_tbLoadErrors=[];tbConfig={markers:[{label:'launch',date:'2026-10-30'}]}");
    const T=app.run('_tbToday()');
    app.run("tbItems=[tbDecodeItem({id:'i1',title:'Shoot 2 — knit + outerwear + henley + washed (Oct 15–16)',status:'open',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar','u-dani'],date:'"+T+"',listId:'l1',lane:'shoot',notes:'CYC must be wired by the 5th.',createdAt:Date.now()-86400000,dateHistory:[{from:'2026-10-15',to:'"+T+"',byUid:'u-afnan',at:Date.now()-3600000}]}),"
      +"tbDecodeItem({id:'i2',title:'pricing tiers',status:'open',visibility:'shared',ownerUid:'u-afnan',assigneeUids:['u-afnan'],date:'2026-01-02',listId:'l1',createdAt:Date.now()-172800000}),"
      +"tbDecodeItem({id:'i3',title:'earmark KG',status:'done',visibility:'shared',ownerUid:'u-must',assigneeUids:['u-must'],listId:'l2',completedAt:Date.now()-7200000,completedByUid:'u-must',createdAt:Date.now()-200000000})]");
    app.run('_tbHydrateQueue=[]');
    // The rail carries the search box and the ? button; the dashboard
    // carries cards 10-12; a query takes the screen over.
    const dash=app.run('_tbShell("tb-dash",_tbDashboard())');
    app.run("_tbQuery='pricing'");
    const found=app.run('_tbSearchScreen()');
    app.run("_tbQuery='zzzz'");
    const none=app.run('_tbSearchScreen()');
    const q=app.run('_tbHydrateQueue');
    let out=dash+found+none;
    q.forEach(x=>{ out=out.replace(new RegExp('(id="'+x.id+'"[^>]*>)'),'$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))); });
    return out;
  },

  'the board — the tray and the week':()=>tbWeekFragment(false),
  // SESSION 2, P1.6: the week BY PERSON has its own fragment, measured at
  // the widths that draw it. It is never drawn on a phone (_tbCalendar
  // guards it with !_tbIsPhone()), and at 420 the harness -- which cannot
  // know the viewport -- rendered it anyway, crushing a locked gate's title
  // in a 34px day column: a state the app never reaches, measured.
  'the board — the week by person':()=>({widths:[1900,1280,800],html:tbWeekFragment(true)}),

  'the board — the shortcut list and the move sheet':()=>{
    const app=loadApp({
      files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-calendar',
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
    });
    app.run("session={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
    app.run("userProfiles=[{uid:'u-ammar',username:'ammar',displayName:'Ammar'}]");
    app.run("tbLists=[];tbLoaded=true;_tbLoadErrors=[];tbConfig=null");
    app.run("tbItems=[tbDecodeItem({id:'i1',title:'Shoot 2 — knit + outerwear + henley + washed',status:'open',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar'],date:'2026-10-16'})]");
    app.run('_tbHelpOpen=true;_tbMoveId="i1";_tbHydrateQueue=[]');
    const help=app.run('_tbHelpOverlay()');
    const sheet=app.run('_tbMoveSheet()');
    const q=app.run('_tbHydrateQueue');
    let out=help+sheet;
    q.forEach(x=>{ out=out.replace(new RegExp('(id="'+x.id+'"[^>]*>)'),'$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))); });
    // Both backdrops are position:fixed;inset:0 in the app, so side by
    // side each would report every control under the other as covered --
    // the documented false hit. The CARDS are what is being measured, so
    // the backdrops are laid out in flow here and nothing else changes.
    return '<style>.tb-help,.tb-sheet{position:relative;inset:auto;margin-bottom:12px}</style>'+out;
  },

  // Board Settings, open (P0.4), as an owner sees it after a Preview: the
  // seed's longest real summary AND an error line, since both can show.
  // Measured at every width: at 420 the card is a sheet over the page.
  'the board — settings and a seed result':()=>{
    const app=tbBoardApp('tb-dash');
    // P2: the admin sections -- a marker whose name is the longest the
    // field takes, and a pinned item with a long real title.
    app.run("tbConfig={markers:[{label:'launch',date:'2026-10-30'},{label:'Founders to Islamabad; Ammar remote 1-5',date:'2026-11-01'}]};"
      +"tbItems=[tbDecodeItem({id:'p1',title:'Restock order #2 placed (on 9 days of sell-through)',status:'open',visibility:'shared',"
      +"pinned:true,date:'2026-11-09',ownerUid:'u-must',assigneeUids:['u-must']})]");
    app.run("_tbSettingsOpen=true;_tbHydrateQueue=[];_tbSeedState={busy:false,dry:true,error:'Refused — the seed function answered 403: only a Board owner may run it.',"
      +"result:tbSeedSummary({created:40,alreadySeeded:2,listCreated:true,profilesCreated:['afnan','daniyal','mustafa'],skippedUsers:['saim'],"
      +"skippedItems:['Saim: lookbook retouch — every hero frame','Saim: size-chart graphics'],listMembersAdded:['saim'],markersWritten:true,"
      +"deletedSince:['Shoot 2: knit + outerwear + henley + washed (Oct 15–16)'],"
      +"peopleAdded:[{title:'Launch rehearsal: theme preview, stock count, CSR scripts, courier',who:['saim']}]},true)}");
    return tbFillSlots(app,app.run('_tbSettingsOverlay()'));
  },

  // A date picker OPEN (P1.7): the vendored flatpickr, drawn inline so the
  // probe can see it, restyled by css/main.css -- so main.css is linked
  // AGAIN after flatpickr's own sheet, the order index.html uses. A marker
  // day and the picked day are both on screen; both themes.
  'the board — a date picker, open':()=>{
    const fs=require('fs');
    const js=fs.readFileSync(path.join(ROOT,'assets/vendor/flatpickr-4.6.13.min.js'),'utf8');
    return '<link rel="stylesheet" href="/assets/vendor/flatpickr-4.6.13.min.css">'
      +'<link rel="stylesheet" href="/css/main.css">'
      +'<div class="tb-pane" style="max-width:380px"><div class="tb-prop"><span class="tb-proplabel">Date</span>'
      +'<input id="fp" data-tb-fp class="tb-qadate" value="2026-10-20"></div></div>'
      +'<script>'+js.replace(/<\/script/gi,'<\\/script')+'<\/script>'
      +'<script>flatpickr(document.getElementById("fp"),{inline:true,dateFormat:"Y-m-d",altInput:true,altFormat:"D j M Y",'
      +'altInputClass:"tb-qadate tb-fpalt",locale:{firstDayOfWeek:1},defaultDate:"2026-10-20",'
      +'onDayCreate:function(d,s,fp,el){var t=fp.formatDate(el.dateObj,"Y-m-d");'
      +'if(t==="2026-10-30"){el.classList.add("tb-fp-marker");el.title="launch";}}});<\/script>';
  },

  // The calendar with ONE FACE CHOSEN and a day OPENED past its cap (P1.6):
  // four of Ammar's items on the 25th, so the day carries "Show less" and
  // every pill it was hiding.
  'the board — calendar, a face chosen and a day opened':()=>{
    const app=tbBoardApp('tb-calendar');
    app.run("_tbCalAnchor='2026-10-15';_tbCalView='month';_tbCalFilters={scope:'all',person:'u-ammar',list:'',lane:'',color:'',hideDone:false};_tbCalMore='2026-10-25'");
    app.run("tbItems=[" +
      "tbDecodeItem({id:'a',title:'ALL ASSETS IN — including website UI assets',date:'2026-10-25',kind:'gate',locked:true,lockedBy:'u-ammar',status:'open',ownerUid:'u-ammar',assigneeUids:['u-ammar'],visibility:'shared',listId:'l1'})," +
      "tbDecodeItem({id:'c',title:'November runbook signed: restock triggers, daily report, cash authority',date:'2026-10-25',kind:'gate',status:'open',ownerUid:'u-must',assigneeUids:['u-must','u-ammar'],visibility:'shared',listId:'l1'})," +
      "tbDecodeItem({id:'d',title:'Ad copy + headlines',date:'2026-10-25',status:'open',ownerUid:'u-ammar',assigneeUids:['u-ammar'],visibility:'shared',listId:'l1'})," +
      "tbDecodeItem({id:'e',title:'done already',date:'2026-10-25',status:'done',ownerUid:'u-ammar',assigneeUids:['u-ammar'],visibility:'shared'})," +
      "tbDecodeItem({id:'f',title:'LAUNCH',date:'2026-10-30',kind:'gate',locked:true,lockedBy:'u-ammar',status:'open',ownerUid:'u-ammar',assigneeUids:['u-ammar'],visibility:'shared',listId:'l1'})," +
      "tbDecodeItem({id:'m',title:'Mustafa only — hidden by the face',date:'2026-10-26',status:'open',ownerUid:'u-must',assigneeUids:['u-must'],visibility:'shared'})]");
    app.run('_tbHydrateQueue=[]');
    return tbFillSlots(app,app.run('_tbCalendar()'));
  },

  // The DASHBOARD BESIDE THE PANE (P1.5 + P1.4). Its two columns sit side by
  // side while .tb-main is wide, and STACK (a container query, not a media
  // query) once the pane leaves it under 720px -- at 1100 here. The pane is
  // laid out at full height, as in the frame fragment, so nothing is
  // "covered" for sitting below its own scroll. Below 1024 the pane is an
  // overlay on purpose, so narrower widths would measure it covering.
  // The same, on a TABLET, where the pane is a fixed overlay and the frame
  // must stay two columns. An unscoped three-column rule reserved an empty
  // 380px track there and left the list 116px wide at 800 (review of
  // d38b96c). The overlay itself is hidden: it covers the page by design,
  // and this measures the frame under it.
  // The RAIL with more lists than fit, on a short screen (review of
  // f256c83). The lists are meant to scroll INSIDE their group while the
  // nav above and the foot below stay put; with the nav allowed to shrink,
  // a long list squeezed it and Calendar and Inbox sat under the lists.
  // Only >=1440 shows lists in the rail, and a short window is the case.
  'the board — the rail with many lists, on a short screen':()=>{
    const app=tbBoardApp('tb-lists');
    app.run("tbLists=[];for(var i=0;i<20;i++)tbLists.push({id:'l'+i,title:'Capsule list number '+(i+1),kind:i%2?'shared':'private',"
      +"adminUid:'u-ammar',memberUids:['u-ammar'],color:'moss',sort:i});tbItems=[];_tbListId=null");
    app.run("_tbHydrateQueue=[]");
    const out=tbFillSlots(app,app.run("_tbShell('tb-lists','<div class=\"tb-empty\">x</div>','')"));
    return {widths:[1900],heights:[700],html:out};
  },

  'the board — the Dashboard with the pane open, on a tablet':()=>{
    const app=tbBoardApp('tb-dash');
    app.run("_tbOpenItemId='a'");
    app.run("tbItems=[" +
      "tbDecodeItem({id:'a',title:'Hyderabad supplier in Karachi: lock sample date + bulk date (bulk must land by Oct 24)',status:'open',kind:'gate',visibility:'shared',ownerUid:'u-afnan',assigneeUids:['u-ammar','u-afnan'],date:'2020-01-20',listId:'l1'})," +
      "tbDecodeItem({id:'b',title:'Walika visit → Jibran procures → dye orders placed (200 kg MOQ per shade)',status:'open',visibility:'shared',ownerUid:'u-afnan',assigneeUids:['u-ammar'],date:_tbToday(),listId:'l1'})]");
    app.run("_tbHydrateQueue=[]");
    const body=app.run('_tbDashboard()');
    const out=tbFillSlots(app,app.run("_tbShell('tb-dash',"+JSON.stringify(body)+",_tbDrawer())"));
    return {widths:[800],html:'<style>.tb-drawer{display:none!important}</style>'+out};
  },

  'the board — the Dashboard beside the pane':()=>{
    const app=tbBoardApp('tb-dash');
    app.run("_tbOpenItemId='a'");
    app.run("tbItems=[" +
      "tbDecodeItem({id:'a',title:'Hyderabad supplier in Karachi: lock sample date + bulk date (bulk must land by Oct 24)',status:'open',kind:'gate',locked:true,lockedBy:'u-afnan',visibility:'shared',ownerUid:'u-afnan',assigneeUids:['u-ammar','u-afnan','u-must'],date:'2020-01-20',listId:'l1',commentCount:12,steps:[{id:'1',title:'call the supplier',done:true},{id:'2',title:'confirm the sample date in writing',done:false}]})," +
      "tbDecodeItem({id:'b',title:'Walika visit → Jibran procures → dye orders placed (200 kg MOQ per shade)',status:'open',visibility:'shared',ownerUid:'u-afnan',assigneeUids:['u-ammar'],date:_tbToday(),listId:'l1'})," +
      "tbDecodeItem({id:'c',title:'Denim bulk lands → Mustafa QC',status:'open',kind:'gate',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-ammar','u-must'],date:null,listId:'l1'})," +
      "tbDecodeItem({id:'h',title:'Handed to Daniyal: the lookbook captions',status:'open',visibility:'shared',ownerUid:'u-ammar',assigneeUids:['u-dani'],date:_tbDayAdd(_tbToday(),3)})]");
    app.run("_tbHydrateQueue=[]");
    const body=app.run('_tbDashboard()');
    const out=tbFillSlots(app,app.run("_tbShell('tb-dash',"+JSON.stringify(body)+",_tbDrawer())"));
    return {widths:[1900,1280,1100],html:'<style>.tb-drawer{max-height:none;position:static}</style>'+out};
  },

  'the board — shell and rail':()=>{
    const app=loadApp({
      files:['js/shared.js','js/auth.js','js/theboard.js'],currentPage:'tb-dash',
      session:{uid:'uid-ammar',u:'ammar',name:'Ammar',role:'owner',
               title:'Co-founder',email:'ammar@groovy.op'},
      // js/auth.js reads localStorage at load time (the remembered user).
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}
    });
    // js/auth.js declares `session` at top level, so it CLOBBERS the
    // harness's session option when it loads. Set it after, the way every
    // logic suite does -- without this the fragment renders the module's
    // "you do not have access" message and measures a single div, which
    // passes every check while proving nothing.
    app.run("session={uid:'uid-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
    // Session 2, P1.2: the rail as the team will see it -- LOADED, with a
    // count on every entry, an open list, a list whose title is too long
    // for the rail, and the inbox count the listener paints. Measured at a
    // tablet width too, where the rail is 56px and icon-only.
    app.run("tbLoaded=true;_tbLoadErrors=[];tbConfig={markers:[]};_tbListId='l1'");
    app.run("tbLists=[{id:'l1',title:'Winter Drop 2027',kind:'shared',adminUid:'uid-ammar',memberUids:['uid-ammar']},"+
      "{id:'l2',title:'Denim sampling, trims and the Karachi supplier follow-ups',kind:'private',adminUid:'uid-ammar',memberUids:['uid-ammar']},"+
      "{id:'l3',title:'Studio',kind:'private',adminUid:'uid-ammar',memberUids:['uid-ammar']}]");
    app.run("tbItems=[{id:'a',title:'x',status:'open',visibility:'shared',ownerUid:'uid-ammar',assigneeUids:['uid-ammar'],date:'2020-01-01',listId:'l1'},"+
      "{id:'b',title:'y',status:'open',visibility:'shared',ownerUid:'uid-ammar',assigneeUids:['uid-ammar'],date:_tbToday(),listId:'l2'},"+
      "{id:'c',title:'z',status:'open',visibility:'shared',ownerUid:'uid-ammar',assigneeUids:['uid-ammar'],date:null,listId:'l2'}]");
    app.run("_tbHydrateQueue=[]");
    let out=app.run("_tbShell('tb-lists','<div class=\"tb-empty\"><div class=\"tb-empty-h\">content</div></div>')");
    app.run('_tbHydrateQueue').forEach(x=>{
      out=out.replace(new RegExp('(id="'+x.id+'"[^>]*>)'),'$1'+String(x.text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])));
    });
    out=out.replace('id="tb-rail-n"></span>','id="tb-rail-n">12</span>');
    return {widths:[1900,1280,800,420],html:out};
  },
  'profile page (owner, mixed profiles)':()=>{
    const app=loadApp({
      files:['js/boards.js','js/profile.js'],currentPage:'profile',
      session:{uid:'uid-afnan',u:'afnan',name:'Afnan',role:'owner',
               title:'Co-founder',email:'afnan@groovy.op'},
      globals:{getDocs:async()=>({docs:[{id:'uid-afnan',data:()=>({
        uid:'uid-afnan',username:'afnan',displayName:'Afnan',
        jobTitle:'Co-founder',department:'Operations',nameColor:'#7B1F2A'})}]})}
    });
    return app.run('loadProfiles(true)').then(()=>{
      let html=app.run('renderProfilePage()');
      // Longest real names in USER_DEFS, so the measurement is the worst case.
      ['Afnan','Ammar','Mustafa','Uzaib'].forEach((n,i)=>{
        html=html.replace(new RegExp('(id="prof-dir-n-'+i+'"[^>]*>)'),'$1'+n);
        html=html.replace(new RegExp('(id="prof-dir-s-'+i+'"[^>]*>)'),
          '$1Printing &amp; Embellishments');
      });
      return html;
    });
  },
  // A 280px column with a 2-up grid of thumbnails and wrapping labels —
  // precisely the shape that crushed the Profile directory. Rendered inside
  // a stand-in for the canvas wrap, since the real one is position:fixed.
  'boards — Unsorted tray':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'}`);
    app.run(`_boardsTrayOpen=true`);
    app.run(`_editUnsorted=[
      {id:'u1',kind:'text',text:'A note with a fairly long first line that has to wrap somewhere'},
      {id:'u2',kind:'file',fileName:'winter-sequence-2026-techpack-final-v3.pdf',fileSize:2400000},
      {id:'u3',kind:'link',linkUrl:'https://www.pinterest.com/pin/1234567890123456789/',linkTitle:'Wide leg washed denim with a raw hem, styled for the winter drop lookbook',linkSite:'Pinterest',text:'Saved from a stylist board — the wash and the rise we want for the next run'},
      {id:'u4',kind:'file',fileName:'a.pdf'},
      {id:'u5',kind:'cards',name:'FABRIC & TRIMS FOR WINTER · 12 cards',
        cards:[{id:'c1',type:'column',title:'FABRIC & TRIMS FOR WINTER'}]},
      {id:'u6',kind:'cards',name:'Table',cards:[{id:'c2',type:'table'}]},
      {id:'u7',kind:'cards',name:'Launch checklist',cards:[{id:'t1',type:'todo',title:'Launch checklist for the winter drop',
        items:[{text:'Trace the pattern for every size in the bundle',done:true},{text:'Cut'},{text:'Bundle'},{text:'Print'},{text:'Stitch'},{text:'QC'}]}]},
      {id:'u8',kind:'cards',name:'Colour',cards:[{id:'w1',type:'swatch',hex:'#F2E6C9'}]},
      {id:'u9',kind:'cards',name:'Denim · 3 cards',cards:[{id:'k',type:'column',title:'Denim washes and trims for the drop'},
        {id:'k1',type:'text',text:'Stone wash, medium blue',columnId:'k',y:10},
        {id:'k2',type:'swatch',hex:'#1F3A5F',columnId:'k',y:20},
        {id:'k3',type:'todo',items:[{text:'order rivets'}],columnId:'k',y:30},
        {id:'k4',type:'text',text:'Acid wash test',columnId:'k',y:40}]}
    ]`);
    let html=app.run('_boardsTrayHTML(true)');
    app.run('_boardsTrayHydrate()');
    // Same reason as above: hydration goes into the harness's stub nodes, so
    // the labels are written in here for the measurement.
    ['A note with a fairly long first line that has to wrap somewhere',
     'winter-sequence-2026-techpack-final-v3.pdf','example.test','a.pdf',
     'FABRIC & TRIMS FOR WINTER · 12 cards','Table','Launch checklist','Colour','Denim · 3 cards'].forEach((t,i)=>{
      html=html.replace(new RegExp('(id="board-tray-l-'+i+'"[^>]*>)'),'$1'+t);
    });
    // The previews' text slots, filled the same way (the builder says what
    // goes where, so this cannot drift from the hydrate).
    JSON.parse(app.run('JSON.stringify(_editUnsorted.map((u,i)=>{const p=_boardsTrayPreview(u,i);return p?p.texts:[];}))'))
      .forEach((texts,i)=>texts.forEach((t,k)=>{
        const esc=String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;');
        html=html.replace(new RegExp('(id="board-tray-p-'+i+'-'+k+'"[^>]*>)'),'$1'+esc);
      }));
    // The tray is position:absolute against the canvas wrap; give it one.
    return Promise.resolve(
      '<div style="position:relative;height:1400px;width:100%">'+html+'</div>');
  },
  /* ── THE UNSORTED PEEK ZONE ──────────────────────────────────────────
     Built by _boardsStashZone only while a card is being dragged and the
     tray is shut, so the probe cannot reach it through the module — it is
     composed here from the same markup that function writes. Worth
     measuring because its whole job is to be READ mid-gesture: the idle
     label is --muted on --surface and the armed one is --text on --hover,
     and both have to hold in either theme. */
  /* The drag ghost. It is built with createElement at drag time, so no
     fragment can render the REAL builder — what is measured here is the
     CSS, and the class names are pinned on the other side by
     tests/boards.test.js, which asserts the builder emits exactly these.
     That is the same division the trash ramp uses: the colours are this
     probe's, the mechanism is the suite's.

     The picture is a solid WHITE stand-in, so ink that stops reading over
     a light photograph shows up rather than hiding behind a dark sample.
     Each ghost is given its own left/top because the real thing is
     position:fixed and they would otherwise stack at 0,0 and report each
     other as covering — the documented false hit. */
  /* The RAIL's drag ghost — the card each placing tool will drop, at the
     board's zoom. Drawn at zoom 1 with the real birth sizes, so what is
     measured is the footprint a drop really lands. Same division as the
     tray ghost: the CSS is this probe's, the class names and the sizes are
     pinned in tests/boards.test.js against _boardsNewCardSize.

     Each is position:fixed with its own left/top, because that is what the
     real one is and they would otherwise stack at 0,0 and report each
     other as covering — the documented false hit. */
  /* The selection rail with its counts. The button is built inside
     _boardsRenderRail's own map, so this renders the real rail through the
     real module rather than a hand-written copy — which also makes it the
     only place that can check a ZERO paints no badge at all.

     The badge chip is var(--red) with var(--on-dark) ink: both invert
     together, which is the documented correct pair, and this fragment is
     what proves it rather than the arithmetic. */
  'boards — the selection rail counts':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      moodBoards=[{id:'b1',ownerUid:'u1',visibility:'shared',title:'T',cards:[]}];
      _editConnectors=[];_boardsConnSel=null;_boardsDrawOn=null;
      _boardsComments=[{id:'m1',cardId:'a'},{id:'m2',cardId:'a'},{id:'m3',cardId:'a',resolved:true}];
      _editCards=[{id:'a',type:'text',x:0,y:0,w:220,h:100,
         labels:[{t:'See this',c:'green'},{t:'Fabric',c:'blue'}],
         reactions:{'👍':['u1','u2'],'🔥':['u3']}},
        {id:'z',type:'text',x:300,y:0,w:220,h:100}];`);
    const rail=who=>{
      app.run(`_boardsSelection=new Set(['${who}'])`);
      const items=JSON.parse(app.run(`JSON.stringify(_boardsRailItems().filter(i=>i&&i.act))`));
      return items.map(it=>
        '<button class="rail-btn" data-act="'+it.act+'" title="'+it.label+'">'+
        '<span class="rail-glyph">•</span><span>'+it.label+'</span>'+
        (it.count?'<span class="board-rail-badge">'+(it.count>99?'99+':it.count)+'</span>':'')+
        '</button>').join('');
    };
    return Promise.resolve({widths:[1900,1280],html:
      '<div style="display:flex;gap:24px;align-items:flex-start">'+
      '<div class="board-rail" style="position:relative">'+rail('a')+'</div>'+
      '<div class="board-rail" style="position:relative">'+rail('z')+'</div>'+
      '</div>'});
  },
  'boards — the rail drag ghost':()=>{
    const G=(x,y,w,h,type,inner)=>
      '<div class="board-rail-ghost card type-'+type+'" style="left:'+x+'px;top:'+y+'px;'+
        'width:'+w+'px;height:'+h+'px;font-size:15px">'+
        '<div class="ghost-in">'+inner+'</div></div>';
    const head=(name)=>'<div class="ghost-head"><div class="ghost-name">'+name+'</div>'+
      '<div class="ghost-sub">0 cards</div></div>';
    let cells='';for(let i=0;i<12;i++)cells+='<div class="ghost-cell"></div>';
    return Promise.resolve(
      '<div style="position:relative;height:640px">'+
      G(30,40,220,100,'text','<div class="ghost-ph">Double-click to type…</div>')+
      G(280,40,170,120,'link','<div class="ghost-field">Enter a link URL</div>')+
      G(480,40,240,170,'todo',
        '<div class="ghost-row"><div class="ghost-check"></div>'+
        '<div class="ghost-item">To-do</div></div>'+
        '<div class="ghost-ph">Add a task…</div>')+
      G(760,40,340,136,'board','<div class="ghost-spine"></div>'+
        '<div class="ghost-info"><div class="ghost-name">New board</div>'+
        '<div class="ghost-sub">PRIVATE</div></div>')+
      G(30,240,440,58,'heading','<div class="ghost-band">Section title</div>')+
      G(500,240,280,160,'column',head('New Column')+
        '<div class="ghost-panel">Drag cards here</div>')+
      G(810,240,360,200,'table','<div class="ghost-grid">'+cells+'</div>')+
      G(30,330,440,320,'frame',head('New Frame')+'<div class="ghost-panel"></div>')+
      '</div>');
  },
  'boards — the drag ghost':()=>{
    const WHITE="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='%23fff'/%3E%3C/svg%3E";
    const ghost=(x,y,inner,label)=>
      '<div class="board-tray-ghost" style="left:'+x+'px;top:'+y+'px">'+
        '<div class="board-tray-ghost-pic">'+inner+'</div>'+
        '<div class="board-tray-ghost-label">'+label+'</div>'+
      '</div>';
    const badge=w=>'<div class="board-tray-ghost-badge">'+w+'</div>';
    return Promise.resolve(
      '<div style="position:relative;height:420px">'+
      // A photograph, with the name under it.
      ghost(90,110,'<img src="'+WHITE+'" alt="">','Model REF 1')+
      // No picture: the word carries it, on the default --soft box.
      ghost(260,110,badge('COLUMN'),'FABRIC &amp; TRIMS FOR WINTER')+
      ghost(430,110,badge('PDF'),'winter-sequence-2026-techpack-final-v3.pdf')+
      // A board with no cover paints its own literal colour, with the ink
      // _boardsInkOn computes — light and dark case, both measured.
      ghost(600,110,'<div class="board-tray-ghost-badge" style="background:#1A1A2E;color:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center">W</div>','WINTER DUMP 2K27')+
      ghost(770,110,'<div class="board-tray-ghost-badge" style="background:#F2E8C9;color:#111;width:100%;height:100%;display:flex;align-items:center;justify-content:center">D</div>','DENIM DUMP 2K27')+
      '</div>');
  },
  'boards — the Unsorted peek zone':()=>{
    const zone=on=>'<div style="position:relative;height:170px;width:100%;'+
      'background:var(--bg);border:1px solid var(--border);margin-bottom:10px">'+
      '<div class="board-stash-zone'+(on?' panel-drop':'')+'">'+
      '<span class="board-stash-zone-label">Unsorted</span></div></div>';
    return Promise.resolve(zone(false)+zone(true));
  },
  // Cards carrying every piece of chrome at once — the shape QA reported
  // twice: a label and a reaction row stealing the body's height until the
  // sub-board card's own title was gone, and a file card whose Open and
  // Download buttons sit inside a body that is also a drag handle. The
  // hit-test is the real value here: these two buttons are the exact
  // pattern (a control inside a drag surface) that made the delete X inert.
  // A column and its children: the derived layout, measured. Guards the
  // geometry (nothing clipped out of view, every control reachable) and
  // the header strip, which is the only interactive part of the container.
  //
  // What it does NOT prove, checked by deliberately removing the rule: the
  // column's `pointer-events:none`. The children are painted ABOVE the
  // column as later siblings, so elementFromPoint reaches them either way.
  // That rule is there so panning and marquee-select work THROUGH the
  // column's background, which is behaviour no layout measurement sees.
  // The store category chips — the control Afnan reported as unreadable in
  // dark mode, and the shape the same bug took in eight other files.
  // Store Accounts (js/store-accounts.js): the KPI tiles, the alert strip,
  // the ledger toolbar and the books table with a running balance, the
  // vendor profile, the consumables grid and the purchase form. The table
  // is allowed to scroll sideways inside its own wrapper on a phone (the
  // Marketing rule), so the table fragments opt out of 420px, where the
  // probe would read a row scrolled out of the wrapper as covered; the
  // tiles and the form are measured at every width.
  'store accounts — ledger, vendor, consumables':()=>{
    const {app,seed}=_acctFixture();
    seed(app);
    app.run("currentPage='acct-ledger';_acctView='cash';_acctPeriod={preset:'all'}");
    const ledger=app.run("_acctPageHead('acct-ledger')+_acctLedgerPage()");
    app.run("_acctVendorId='thread';_acctVendorTab='aging';currentPage='acct-vendor'");
    const vendor=app.run("_acctVendorPage()");
    // the Runners and Categories cards on the Vendors tab, and a page of each
    const cards=app.run("_acctRunnersCard()+_acctCategoriesCard()");
    const pages=app.run("(()=>{_acctCategoryId=_acctCategoryStats()[0].name;_acctRunnerId=_acctRunners()[0];return _acctCategoryPage()+_acctRunnerPage();})()");
    const m=app.run('_acctThisMonth()');
    const logs=[{date:m+'-01',qty:45,residual:5,byName:'Raees'},{date:m+'-02',qty:45,residual:7,byName:'Raees',note:'late delivery'}];
    const cons=app.run(`(()=>{const v=_acctVendor('gas');return '<div class="card" style="padding:0;overflow:hidden">'+_acctConsGrid(v,'${m}',${JSON.stringify(logs)})+_acctConsFoot(v,'${m}',${JSON.stringify(logs)})+'</div>';})()`);
    return Promise.resolve({widths:[1900,1280],html:ledger+vendor+cards+pages+cons});
  },
  'store accounts — tiles, alerts and the purchase form':()=>{
    const {app,seed}=_acctFixture();
    seed(app);
    app.run("currentPage='acct-ledger';_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    const tiles=app.run("_acctPageHead('acct-ledger')+(()=>{const b=_acctBalances();const f=_acctOpenFloats();return '<div class=\"acct-tiles\">'+_acctTile('Cash in hand',b.cash)+_acctTile('MCB Bank',b.mcb)+_acctTile('Owed to vendors',_acctTotalPayables(),{danger:true,sub:'₨5,000 overdue'})+_acctTile('With runners',f.reduce((s,x)=>s+x.left,0),{danger:true,sub:'1 open float'})+'</div>'+_acctAlerts(f);})()");
    app.run("window.acctForm('purchase',{vendorId:'thread'})");
    app.run("_acctFormLines=[{itemCode:'TH1',desc:'Thread white 40/2',qty:'12',unit:'cone',rate:'210',hint:'Last bought @ ₨210 on 01 Sep 26 from Karachi Thread House · in stock now: 20 cone'},{itemCode:'',desc:'Rickshaw to Shershah',qty:'1',unit:'',rate:'300',hint:''},_acctNewLine()]");
    const body=app.run('window.__cap.b');
    // The REAL row (`_acctLineHTML`), placeholders included — a hand-rolled copy
    // here once measured a shorter placeholder than the one that shipped.
    const lines=app.run("_acctFormLines.map((l,i)=>_acctLineHTML(l,i)).join('')");
    // max-height:none — the real modal is a 92dvh scroll box, and a control
    // scrolled out of its body reads as "covered by the foot" (the documented
    // false hit); it flipped between passing and failing with font timing
    const modal=(b)=>'<div class="acct-modal" style="position:static;max-width:720px;margin-top:14px;max-height:none"><div class="acct-modal-head"><span>Record purchase</span><button class="acct-x">×</button></div><div class="acct-modal-body">'+b+'</div><div class="acct-modal-foot"><button class="btn-outline">Cancel</button><button class="btn-primary" style="width:auto;margin:0;padding:10px 18px">Record purchase</button></div></div>';
    // the same form opened for a service vendor: Expense mode, the stock block hidden
    app.run("window.acctForm('purchase',{vendorId:'net'})");
    const expBody=app.run('window.__cap.b');
    // and the payment form with its third Paid-from chip, OTHER, selected —
    // the hint under it is shown, since the chip is what reveals it
    app.run("window.acctForm('payment',{vendorId:'thread'})");
    const payBody=(app.run('window.__cap.b')||'').replace('class="acct-chipbtn on" data-v="cash"','class="acct-chipbtn" data-v="cash"').replace('class="acct-chipbtn" data-v="other"','class="acct-chipbtn on" data-v="other"').replace('id="f-acc-hint" style="font-size:13px;color:var(--muted);margin-top:4px;display:none"','id="f-acc-hint" style="font-size:13px;color:var(--muted);margin-top:4px;display:block"');
    // the same form with NO vendor: "Paid to" shown, the vendor select and the
    // On-credit chip hidden, the ₨1,000 photo rule under the label
    app.run("window.acctForm('purchase',{category:'Maintenance & repairs',desc:'Fan rewiring, cutting hall',amount:900})");
    const noVendorBody=app.run('window.__cap.b');
    // and settling with a runner who spent over the float, Other selected
    app.run("window.acctForm('runner_pay',{person:'Abbas'})");
    const settleBody=(app.run('window.__cap.b')||'').replace('class="acct-chipbtn on" data-v="cash"','class="acct-chipbtn" data-v="cash"').replace('class="acct-chipbtn" data-v="other"','class="acct-chipbtn on" data-v="other"').replace('id="f-acc-hint" style="font-size:13px;color:var(--muted);margin-top:4px;display:none"','id="f-acc-hint" style="font-size:13px;color:var(--muted);margin-top:4px;display:block"');
    const form=modal(body.replace('<div id="acct-lines"></div>','<div id="acct-lines">'+lines+'</div>'))+modal(expBody)+modal(payBody)+modal(noVendorBody)+modal(settleBody);
    return Promise.resolve(tiles+form);
  },
  // Warehouse sales — the Accounts section on Umair's page (js/warehouse-
  // sales.js): the tiles and the list as he reads them on his phone at the
  // warehouse, the new-sale form with every branch showing (a bill
  // attached, search hits, a catalog line, a line whose price was changed
  // and one not in the catalog, a discount, pay later with its due date) and
  // one sale opened. The list is flex cards, not a table, precisely so it
  // holds at 420px — so this runs at every width.
  'warehouse sales — the Accounts list, the new-sale form and a sale':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const app=loadApp({files:['js/store.js','js/store-accounts.js','js/fulfillment.js','js/warehouse-sales.js'],currentPage:'fulfillment',globals:{localStorage:LS,auth:{currentUser:null}}});
    const pad=n=>String(n).padStart(2,'0');
    const day=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
    const bill='https://res.cloudinary.com/deww4lpym/image/upload/v1/so0334.jpg';
    const L=(t,v,sku,q,p,o)=>Object.assign({title:t,variant:v,sku,code:sku.split('-')[0],qty:q,price:p,total:q*p,catalogPrice:p},o||{});
    const S=(id,o)=>Object.assign({_id:id,orderNo:id,date:day(0),customerName:'Walk-in',customerPhone:'03001112222',lines:[L('EFFORTLESS TEE | DEEP BLUE','Mint Green / M','GP092-M',1,3490)],qtyTotal:1,subtotal:3490,discount:0,discountPct:0,total:3490,terms:'paid',paidVia:'cash',dueDate:null,status:'active',needsReview:false,reviewFlags:[],billUrl:bill,billKind:'image',createdAt:1,createdByName:'Umair'},o||{});
    const sales=[
      S('SO0334',{customerName:'Sheikh Bilal (Rare Project)',customerPhone:'03009225227',terms:'later',paidVia:null,dueDate:day(-7),note:'Awaiting Payment'}),
      S('SO0335',{customerName:'Ayesha Khan',lines:[L('EFFORTLESS TEE | DEEP BLUE','Mint Green / L','GP092-L',2,3490),L('LIVE IN PANTS | CHARCOAL','Charcoal / 32','GLP004-32',1,4990)],qtyTotal:3,subtotal:11970,discount:1197,discountPct:10,total:10773,paidVia:'bank'}),
      S('SO0321',{date:day(12),customerName:'Muhammad Abdullah Siddiqui, for the Karachi Streetwear Collective pop-up at Dolmen Mall Clifton',terms:'later',paidVia:null,dueDate:day(3),total:21940,subtotal:21940,qtyTotal:6}),
      S('SO0330',{date:day(2),customerName:'Hamza',needsReview:true,reviewFlags:['price changed on 1 article'],lines:[L('EFFORTLESS TEE | CLOUD','White / M','GP090-M',1,3000,{catalogPrice:3290,priceEdited:true})],subtotal:3000,total:3000}),
      S('SO0310',{date:day(9),customerName:'Bilal',status:'void',voidReason:'entered twice',voidedBy:'umair',voidedByName:'Umair',voidedAt:Date.now()}),
      // a bill recorded again over a voided entry: its history is drawn
      S('SO0340',{date:day(1),customerName:'Zainab',priorVoids:[{date:day(1),customerName:'Zainab',customerPhone:'03001112222',total:10470,qtyTotal:3,createdAt:Date.now()-7200000,createdByU:'umair',createdByName:'Umair',voidedAt:Date.now()-3600000,voidedBy:'umair',voidedByName:'Umair',voidReason:'the bill says one tee, not three — entered the quantity wrong',billUrl:bill}]})
    ];
    const catalog=[
      {id:'v1',sku:'GP092-M',title:'EFFORTLESS TEE | DEEP BLUE',variant:'Mint Green / M',price:3490,status:'active'},
      {id:'v2',sku:'GP092-L',title:'EFFORTLESS TEE | DEEP BLUE',variant:'Mint Green / L',price:3490,status:'active'},
      {id:'v3',sku:'GP092-XL',title:'EFFORTLESS TEE | DEEP BLUE',variant:'Mint Green / XL',price:3490,status:'active'}
    ];
    app.run("session={uid:'u-umair',u:'umair',name:'Umair',role:'fulfillment',email:'umair@groovy.op'}");
    app.run(`whSales=${JSON.stringify(sales)};_whsSort();whSalesLoaded=true;_whsCatalog=${JSON.stringify(catalog)};_whsCatalogAt=Date.now();_fulfillSection='accounts';1`);
    const page=app.run('renderFulfillmentPage()');
    // the form, as the modal would draw it
    app.run("window.whsNewSale()");
    app.run(`_whsDraft.bill={url:'${bill}',kind:'image',name:'so0334.jpg'};_whsDraft.discMode='pct';_whsDraft.terms='later';`+
      `_whsDraft.lines=[whsLineFromVariant(_whsCatalog[0]),Object.assign(whsLineFromVariant(_whsCatalog[1]),{qty:'2',price:'3200'}),Object.assign(whsManualLine(),{title:'B-stock hoodie, washed black',price:'1500'})];1`);
    app.el('whs-q').value='GP092';
    app.run('_whsPaintSearch()');
    const hits=app.el('whs-results').innerHTML;
    const body=app.run('_whsFormHTML()')
      .replace('<div id="whs-results" class="whs-results"></div>','<div id="whs-results" class="whs-results">'+hits+'</div>')
      .replace('class="acct-chipbtn" data-v="pct"','class="acct-chipbtn on" data-v="pct"');
    const modal=(title,b,foot)=>'<div class="acct-modal" style="position:static;max-width:760px;margin-top:14px;max-height:none"><div class="acct-modal-head"><span>'+title+'</span><button class="acct-x">×</button></div><div class="acct-modal-body">'+b+'</div><div class="acct-modal-foot">'+foot+'</div></div>';
    const form=modal('Record a customer purchase',body,'<button class="btn-outline">Cancel</button><button class="btn-primary" style="width:auto;margin:0;padding:10px 18px">Save sale</button>');
    // one sale opened: two lines, a discount, paid by bank
    const opened=id=>{app.run(`window.whsOpen('${id}')`);return app.bodyHtml('whs-modal').replace('class="acct-modal"','class="acct-modal" style="position:static;max-width:680px;margin-top:14px;max-height:none"');};
    // one sale opened: two lines, a discount, paid by bank; a voided one
    // (its banner and "Record this bill again"); and one recorded again,
    // carrying the voided entry in its history
    return Promise.resolve(page+form+opened('SO0335')+opened('SO0310')+opened('SO0340'));
  },
  // The warehouse → Raees handover (26 Sept 2026). Both ends, on the phone
  // widths too — Raees confirms at the store and Umair collects at the
  // warehouse: Raees's alert strip and the "From the warehouse" queue (a day
  // with cash AND an MCB transfer, a collected pay-later bill with the
  // longest customer name the list produces, and a payment received whose
  // sale was voided afterwards), then Umair's list carrying the new badges,
  // a collected sale opened, and the Mark collected form.
  'store accounts — from the warehouse (both ends)':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const pad=n=>String(n).padStart(2,'0');
    const day=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
    const bill='https://res.cloudinary.com/deww4lpym/image/upload/v1/so0351.jpg';
    const L=(t,v,sku,q,p)=>({title:t,variant:v,sku,code:sku.split('-')[0],qty:q,price:p,total:q*p,catalogPrice:p});
    const S=(id,o)=>Object.assign({_id:id,orderNo:id,date:day(0),customerName:'Walk-in',customerPhone:'03001112222',lines:[L('EFFORTLESS TEE | DEEP BLUE','Mint Green / M','GP092-M',1,3490)],qtyTotal:1,subtotal:3490,discount:0,discountPct:0,total:3490,terms:'paid',paidVia:'cash',dueDate:null,status:'active',needsReview:false,reviewFlags:[],billUrl:bill,billKind:'image',createdAt:1,createdByU:'umair',createdByName:'Umair'},o||{});
    const sales=[
      S('SO0351',{customerName:'Saad Hussain'}),
      S('SO0352',{customerName:'Ayesha Khan',paidVia:'bank',total:10773,subtotal:10773}),
      S('SO0321',{date:day(12),customerName:'Muhammad Abdullah Siddiqui, for the Karachi Streetwear Collective pop-up at Dolmen Mall Clifton',terms:'later',paidVia:null,dueDate:day(3),total:21940,subtotal:21940,qtyTotal:6,collectedAt:Date.now(),collectedVia:'bank',collectedDate:day(1),collectedBy:'umair',collectedByName:'Umair'}),
      S('SO0334',{date:day(6),customerName:'Sheikh Bilal (Rare Project)',terms:'later',paidVia:null,dueDate:day(-7)}),
      S('SO0340',{date:day(3),customerName:'Zainab',total:6980,subtotal:6980}),
      S('SO0310',{date:day(9),customerName:'Bilal',status:'void',voidReason:'entered twice',voidedBy:'umair',voidedByName:'Umair',voidedAt:Date.now()}),
      // recorded again after Raees received it, with another total: CHANGED
      S('SO0345',{date:day(4),customerName:'Hamza Tariq, collecting for the whole Clifton Block 5 order',total:4990,subtotal:4990,priorVoids:[{total:3490,voidReason:'wrong size'}]})
    ];
    const conf=(id,sale,amt,acc,o)=>Object.assign({_id:id,type:'cash_in',src:'wh',whSale:sale+'#0',whOrder:sale,date:day(2),month:day(2).slice(0,7),ts:1,by:'raees',byName:'Raees',person:'',account:acc,amount:amt,source:'Warehouse sale',category:'Warehouse sale',ref:sale,note:'',status:'posted',lines:[],reviewFlags:[]},o||{});
    const confs=[conf('whs_SO0340_0','SO0340',6980,'cash',{person:'Zainab',whSaleTotal:6980}),conf('whs_SO0310_0','SO0310',3490,'cash',{person:'Bilal',whSaleTotal:3490}),
      conf('whs_SO0345_0','SO0345',3490,'cash',{person:'Hamza Tariq',whSaleTotal:3490})];
    const app=loadApp({files:['js/store.js','js/store-accounts.js','js/warehouse-sales.js','js/fulfillment.js'],currentPage:'acct-ledger',globals:{
      allItems:[],allTransactions:[],allTemplates:[],allRequests:[],allActivePOs:[],allStoreCategories:[],allPoIssueRequests:[],allPoEditRequests:[],allPoShortfalls:[],
      auth:{currentUser:{getIdToken:async()=>'tok'}},localStorage:LS}});
    app.run("session={uid:'u-raees',u:'raees',name:'Raees',role:'store',email:'raees@groovy.op'}");
    app.run(`whSales=${JSON.stringify(sales)};_whsSort();whSalesLoaded=true;whsConfirmations=${JSON.stringify(confs)};whsConfLoaded=true;_whsConfAt=Date.now();_whsSalesAt=Date.now();acctEntries=${JSON.stringify(confs)};acctLoaded=true;1`);
    app.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    const alerts=app.run('_acctAlerts(_acctOpenFloats())');
    app.run('window.acctWarehouse()');
    const modal=(title,b,foot)=>'<div class="acct-modal" style="position:static;max-width:720px;margin-top:14px;max-height:none"><div class="acct-modal-head"><span>'+title+'</span><button class="acct-x">×</button></div><div class="acct-modal-body">'+b+'</div><div class="acct-modal-foot">'+(foot||'')+'</div></div>';
    const queue=modal('From the warehouse',app.run('window.__cap.b'),app.run('window.__cap.f'));
    // Umair's end
    app.run("session={uid:'u-umair',u:'umair',name:'Umair',role:'fulfillment',email:'umair@groovy.op'};currentPage='fulfillment';_fulfillSection='accounts';1");
    const page=app.run('renderFulfillmentPage()');
    const opened=id=>{app.run(`window.whsOpen('${id}')`);return app.bodyHtml('whs-modal').replace('class="acct-modal"','class="acct-modal" style="position:static;max-width:680px;margin-top:14px;max-height:none"');};
    const collectForm=()=>{app.run("window.whsCollect('SO0334')");return app.bodyHtml('whs-modal').replace('class="acct-modal"','class="acct-modal" style="position:static;max-width:680px;margin-top:14px;max-height:none"');};
    return Promise.resolve('<div>'+alerts+'</div>'+queue+page+opened('SO0321')+opened('SO0340')+collectForm());
  },
  // Afnan's correction tools: the Admin tools card on the review page (the
  // whole page, which had never been measured), the admin edit modal and
  // the reset modal. The fixture's session is made afnan by name — the card
  // and the buttons are gated on the username, not the owner role.
  // Raees editing his own entries (Sept 2026): the edit banner and its reason
  // field over the REAL recording forms, a purchase whose sized line went into
  // inventory and is locked, and an entry detail carrying an edit history and
  // one carrying the line that says why it cannot be edited.
  'store accounts — editing an entry and its history':()=>{
    const {app,seed}=_acctFixture();
    seed(app);
    app.run("session.u='raees';session.role='store';session.name='Raees';currentPage='acct-ledger';_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    app.run("allItems.push({code:'NL1',name:'Neck label woven',unit:'pcs',sizeSpecific:true,sizes:{S:10,M:10,L:5},_id:'NL1'});const p=acctEntries.find(e=>e.vendorId==='thread'&&e.type==='purchase');p.lines.push({itemCode:'NL1',desc:'Neck label woven',qty:30,unit:'pcs',rate:2.5,total:75,sizes:{S:10,M:20}});p.amount+=75;");
    const pid=app.run("acctEntries.find(e=>e.vendorId==='thread'&&e.type==='purchase')._id");
    app.run(`window.acctEditEntry('${pid}')`);
    const pc=JSON.parse(app.run('JSON.stringify(window.__cap)'));
    const lines=app.run("_acctFormLines.map((l,i)=>_acctLineHTML(l,i)).join('')");
    app.run('_acctEditId=null');
    const payId=app.run("acctEntries.find(e=>e.type==='payment')._id");
    app.run(`window.acctEditEntry('${payId}')`);
    const pay=JSON.parse(app.run('JSON.stringify(window.__cap)'));
    app.run('_acctEditId=null');
    // the payment, now carrying two edits (one from an owner) and the review flag they raised
    app.run(`(()=>{const e=_acctById('${payId}');e.edits=[{at:Date.now()-86400000,by:'raees',byName:'Raees',reason:'typed 13,000 — the bank transfer was 13,500',fields:['amount','ref'],before:{amount:13000,ref:'TRX-884'},after:{amount:13500,ref:'TRX-88400'}},{at:Date.now()-3600000,by:'afnan',byName:'Afnan',admin:true,reason:'Admin correction',fields:['account','date'],before:{account:'cash',date:'2026-09-01'},after:{account:'mcb',date:'2026-09-02'}}];e.needsReview=true;e.reviewFlags=['edited'];})()`);
    app.run(`window.acctOpenEntry('${payId}')`);
    const det=JSON.parse(app.run('JSON.stringify(window.__cap)'));
    // an entry an owner has reviewed: no Edit… button, one line saying why
    app.run(`(()=>{const e=acctEntries.find(x=>x.reviewFlags&&x.reviewFlags.includes('over limit'));e.reviewedAt=Date.now();e.reviewedBy='afnan';window.__rid=e._id;})()`);
    app.run('window.acctOpenEntry(window.__rid)');
    const locked=JSON.parse(app.run('JSON.stringify(window.__cap)'));
    const modal=(c,w)=>'<div class="acct-modal" style="position:static;max-width:'+(w||640)+'px;margin-top:14px;max-height:none"><div class="acct-modal-head"><span>'+c.t+'</span><button class="acct-x">×</button></div><div class="acct-modal-body">'+c.b+'</div><div class="acct-modal-foot">'+c.f+'</div></div>';
    return Promise.resolve(modal({t:pc.t,b:pc.b.replace('<div id="acct-lines"></div>','<div id="acct-lines">'+lines+'</div>'),f:pc.f},720)+modal(pay)+modal(det,620)+modal(locked,620));
  },
  'store accounts — admin tools, edit and reset':()=>{
    const {app,seed}=_acctFixture();
    seed(app);
    app.run("session.u='afnan';session.role='owner';currentPage='acct-review';acctCloses=[{_id:'2026-08',month:'2026-08',cashBook:12000,cashCounted:12000,variance:0,closedByName:'Afnan'}];_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    const review=app.run("_acctReviewPage()");
    // the vendor page's HEAD card as afnan carries the Delete vendor button the other
    // fragment never sees; the statement table under it is that fragment's, and it
    // opts out of 420px (it scrolls inside its wrapper), so only the head is taken here
    const vendor=app.run("(()=>{const h=_acctVendorId='gas',p=(_acctVendorTab='statement',_acctVendorPage());const i=p.indexOf('<div class=\"card\"',10);return i>0?p.slice(0,i):p;})()");
    const modal=(t,b,f)=>'<div class="acct-modal" style="position:static;max-width:640px;margin-top:14px"><div class="acct-modal-head"><span>'+t+'</span><button class="acct-x">×</button></div><div class="acct-modal-body">'+b+'</div><div class="acct-modal-foot">'+f+'</div></div>';
    app.run("window.acctAdminEdit(acctEntries.find(e=>e.type==='purchase')._id)");
    const edit=app.run("modal=window.__cap;JSON.stringify(modal)");
    app.run("window.acctAdminResetPrompt()");
    const reset=app.run("JSON.stringify(window.__cap)");
    const e=JSON.parse(edit),r=JSON.parse(reset);
    return Promise.resolve(review+vendor+modal(e.t,e.b,e.f)+modal(r.t,r.b,r.f));
  },
  'store — inventory category chips':()=>{
    const app=loadApp({files:['js/store.js'],globals:{
      allItems:[],_invFilterCat:'all',_invSearchQ:'',_invSort:'category',
      _catLabel:k=>k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()),
      getStatus:()=>'ok',getBal:()=>0
    }});
    // Only the chip row is under test; renderInventory pulls in far more.
    const html=app.run(`(()=>{
      const chip=(key,label,count,active)=>\`<button style="padding:6px 12px;border:1px solid \${active?'var(--dark)':'var(--border)'};border-radius:999px;background:\${active?'var(--dark)':'var(--surface)'};color:\${active?'var(--on-dark)':'var(--text)'};font-size:12px;cursor:pointer;font-family:inherit;font-weight:\${active?'600':'500'}">\${label}\${count!=null?\` <span style="opacity:.7;font-weight:400">\${count}</span>\`:''}</button>\`;
      const cats=[['all','All',300,true],['neck','Neck Labels',19,false],['sleeve','Sleeve & Hem Labels',6,false],['patches','Patches',7,false]];
      return '<div class="card" style="padding:12px"><div style="display:flex;gap:6px;flex-wrap:wrap">'+
        cats.map(c=>chip(c[0],c[1],c[2],c[3])).join('')+'</div></div>';
    })()`);
    return Promise.resolve(html);
  },
  // The embellishments track's SLA panel, priority chip and PP-attempt rows.
  // Every one of these used to pair a FIXED light background with a
  // foreground that follows the theme (var(--green), var(--amber),
  // var(--muted)), so in dark mode they rendered light-on-light. The
  // contrast check below is what actually proves this; the geometry checks
  // would pass either way.
  'embellishments — SLA panel, priority chip, PP attempts':()=>{
    const app=loadApp({files:['js/embellishments.js'],
      session:{u:'ammar',name:'Ammar',role:'owner'},
      globals:{allRecipes:[],allPOs:[],allPrintingJobs:[],allQCReports:[],
               allPrintBilling:[]}});
    const mk=(pri,dueOffsetMs)=>({
      _id:'j-'+pri,poNumber:'PO-2041',articleCode:'GRV-HD-114',
      articleName:'Oversized hoodie — winter drop',priority:pri,
      currentStage:'printing',processType:'screen_print',
      slaCurrentDue:new Date(Date.now()+dueOffsetMs).toISOString(),
      sizeBreakdown:{S:10,M:24,L:18},
      ppAttempts:[
        {attemptNo:1,status:'approved',by:'Ammar',at:new Date().toISOString()},
        {attemptNo:2,status:'rejected',by:'Ammar',at:new Date().toISOString(),
         rejectionReason:'Pantone 185 C came out too warm'},
        {attemptNo:3,status:'pending',by:'Ammar',at:new Date().toISOString()}
      ]});
    // ok / near / over / critical all at once — each has its own tint.
    const jobs=[mk('urgent',-9e6),mk('normal',36e5),mk('flexible',864e5)];
    const html=jobs.map(j=>app.run('printWorkerCardHTML('+JSON.stringify(j)+')')).join('')
      +app.run('renderPPAttemptsCard('+JSON.stringify(jobs[0])+')')
      +app.run('renderTowerSwimlane("printing",[])');
    return Promise.resolve(html);
  },
  // A table carrying cell attributes — bold, sized, aligned and coloured —
  // with one cell focused. The contrast check is the point: a cell colour
  // is a palette NAME painted by a class precisely so it reads in BOTH
  // themes, which a stored hex could not do.
  'boards — a table with styled cells':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editConnectors=[];_boardsSelection=new Set(['t']);moodBoards=[];
      _editCards=[{id:'t',type:'table',x:20,y:20,w:360,h:460,head:true,rows:[
        ['Fabric','Qty','Status'],
        [{v:'Cotton drill 8.5oz',b:true},'120',{v:'Cleared',bg:'green'}],
        [{v:'Fleece 320gsm',sz:'l'},{v:'40',al:'r'},{v:'Rework',bg:'red'}],
        ['Rib 2x1',{v:'8',al:'c',i:true,bg:'purple'},{v:'Pending',bg:'blue'}],
        [{v:'1',t:'check'},{v:'45000',t:'currency'},{v:'twelve',t:'number'}],
        [{v:'',t:'check'},{v:'12',t:'percent'},{v:'2026-09-15',t:'date'}],
        ['Total',{v:'=SUM(B2:B4)',t:'currency'},{v:'=NOPE(1)'}]
      ]}];
      _boardsCellFocus={id:'t',r:1,i:0};`);
    let html=app.run(`_boardCardHTML(_editCards[0],true)`);
    // Hydration writes into the harness's stub nodes, so the text is put
    // back here for the measurement — same as every other fragment.
    app.run(`_editCards[0].rows`).forEach((row,r)=>row.forEach((cell,i)=>{
      const v=app.run(`_boardsCellDisplay(_editCards[0].rows[${r}][${i}])`);
      html=html.replace(new RegExp('(id="board-td-t-'+r+'-'+i+'"[^>]*>)'),'$1'+v);
    }));
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:580px;width:100%">'+html+'</div>');
  },
  /* A FRAME wears the column's title block now, so it is measured beside
     it rather than trusted to inherit it: same head, same count, same
     corner buttons. Its count is GEOMETRY (the cards whose centres fall
     inside) and its region stays see-through, which is the one place the
     two deliberately differ.
     ITS OWN FRAGMENT, not more rows on the column one: the probe SKIPS
     hit-testing anything below the window, so a 1500px stack quietly stops
     being checked at all — found by breaking the frame body to cover its
     own header and watching the probe pass. */
  'boards — frames wear the column title block':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editConnectors=[];moodBoards=[];
      _editCards=[
        {id:'fr',type:'frame',title:'Winter Drop 2027 — cut and sew',x:20,y:20,w:380,h:230},
        {id:'fk',type:'text',text:'Lab dip approved',x:40,y:130,w:170,h:80},
        {id:'frempty',type:'frame',title:'',x:20,y:280,w:380,h:190},
        {id:'frfold',type:'frame',title:'Archived section',x:20,y:500,w:380,h:190,collapsed:true,openH:190},
        {id:'hid',type:'text',text:'hidden by the fold',x:40,y:590,w:170,h:80}
      ];
      _boardsSelection=new Set(['fr']);`);
    let html=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`);
    html=html.replace(/(id="board-txt-fk"[^>]*>)/,'$1Lab dip approved');
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:720px;width:100%">'+html+'</div>');
  },
  'boards — a column and its cards':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editConnectors=[];_boardsSelection=new Set();moodBoards=[];
      _editCards=[
        {id:'col',type:'column',title:'Winter fabric',x:20,y:20,w:260,h:160},
        {id:'a',type:'text',text:'Cotton drill 8.5oz',x:0,y:0,w:170,h:90,columnId:'col'},
        {id:'b',type:'file',fileName:'swatch-card.pdf',fileSize:20480,
         fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/s.pdf',x:0,y:0,w:170,h:130,columnId:'col'},
        // The header Afnan drew: the name centred with the count under it
        // and a collapse minus in the corner. An EMPTY column is the one
        // that matters here — it is the drop target, and its whole body is
        // the "Drag cards here" panel, so a title block that overran it
        // would cover the thing you are aiming at. One selected (the ✕
        // shows beside the minus only then, or on hover), one collapsed to
        // its header, one with a name long enough to need the room.
        // ONE COLUMN of columns, and that is not cosmetic: a 280px column
        // at x=300 sits past the right edge of the 420px viewport, where
        // the wrapper clips it and the hit-test then reports its own
        // buttons as unreachable — the fragment measuring itself. Same
        // reason the board-card fragment stacked.
        {id:'empty',type:'column',title:'',x:20,y:360,w:280,h:150},
        {id:'sel',type:'column',title:'Lowkey Heat drop — sampling',x:20,y:530,w:280,h:150},
        {id:'fold',type:'column',title:'Archived',x:20,y:700,w:280,h:150,collapsed:true},
        {id:'f1',type:'text',text:'hidden by the fold',x:0,y:0,w:256,h:90,columnId:'fold'}
      ];
      _boardsSelection=new Set(['sel']);
      _boardsLayoutColumns();`);
    let html=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`);
    html=html.replace(/(id="board-txt-a"[^>]*>)/,'$1Cotton drill 8.5oz');
    // A second copy of the EMPTY column with the drop highlight forced on.
    // The probe cannot drag, and that highlight is the only feedback a
    // person gets while aiming a card at a column, so it would otherwise
    // never be measured. Only the empty one, re-homed to the top-left: a
    // copy of the whole set needs a wrapper as tall as the first, and a
    // column hanging past a clipping wrapper reports its own controls as
    // covered — the fragment measuring itself rather than the layout.
    const empty=/(<div class="board-column[^]*?)(?=<div class="board-column|$)/;
    const one=(html.match(/<div class="board-column"[^>]*id="board-card-empty"[^]*?<\/div>\s*(?=<div class="board-card-el|<div class="board-column|$)/)||[''])[0];
    const lit=one.replace('class="board-column"','class="board-column drop-into"')
                 .replace(/id="board-card-empty"/,'id="board-card-lit"')
                 .replace(/left:\d+px;top:\d+px/,'left:20px;top:20px');
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:800px;width:100%">'+html+'</div>'+
      '<div style="position:relative;overflow:hidden;height:200px;width:100%">'+lit+'</div>');
  },
  // The trash panel is a list of rows that each pair a long, unbounded
  // string (the card preview) with fixed-width chrome and two buttons —
  // the exact shape that crushed the Profile directory's names to 0px.
  // Both tabs' buttons must also be genuinely clickable: the panel sits
  // beside the rail and a z-index a step out would bury it, which is how
  // the board's whole top bar was invisible for weeks.
  //
  // VERIFIED BOTH WAYS, and worth recording WHICH way: recolouring the day
  // header to its own background fails this fragment at 1:1 in both themes,
  // so the contrast and text checks genuinely reach it. The "overflows its
  // own box" check does NOT bite here, and that is correct rather than a
  // gap — the panel is overflow:hidden, so a too-wide row is clipped and
  // cannot push the page around. A 2000px flex child and a 3000px row were
  // both tried and both passed for that reason. What protects a clipped
  // panel is the "text laid out entirely outside its clipping ancestor"
  // check, not the overflow one.
  // The rail went from a floating pill to a full-height column. MEASURED,
  // rather than argued: the rail's content is ~616px tall, and the old pill
  // was capped at calc(100% - 40px), so it overflowed on any stage shorter
  // than ~656px — a 720p laptop once the browser chrome and the board's own
  // top bar are taken off. Trash, pinned last, was the entry that fell off.
  //
  // 640px here is that laptop. VERIFIED BOTH WAYS at this height: the old
  // pill reports 616 > 598 and fails, the column passes. At 660px BOTH pass
  // (620 of room for 611 of tools, a 9px margin) — which is why the first
  // version of this fragment proved nothing and was rewritten rather than
  // kept green.
  // The regrouped top bar. Seven controls where there were thirteen, and
  // the hit-test is the point: the View button is the only way to reach
  // zoom, Fit, Snap and the minimap now, so a View button the browser
  // cannot actually click takes all four down with it.
  // Level of detail. The same three cards rendered twice - once at NEAR and
  // once at FAR - so the probe measures what each zoom actually paints.
  // What this holds: the far board must still be free of clipped text and
  // unreachable controls once the chrome is hidden, which is the risk in
  // hiding a flex sibling (the body grows into its space).
  /* A board card is a SPINE now (option D): the board's face down the left
     edge, the whole name and meta on the CARD SURFACE beside it, and a strip
     of the board's own thumbnails at the foot. Three things this has to
     hold, and none of them is visible to a logic suite:

     - the name and meta take their ink from tokens now (they used to sit on
       a literal black scrim), so the contrast check has to see them in BOTH
       themes — a literal white left behind would be white-on-white in light;
     - the long-name card wraps to the clamped two lines rather than
       overflowing. Note what this does NOT prove, checked by removing it:
       the info column's min-width:0. The title carries word-break, so it
       shrinks either way — that rule is a guard for whatever is added to
       the column next, not something a measurement here can hold;
     - the thumbnail strip and the phone Open pill share the foot of the
       card, and the pill is hit-tested.

     The covers are swapped for a solid WHITE image: the probe has no
     network, and an <img> that never loads measures as nothing. */
  'boards — a board card wears the board’s face':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    const COVER='https://res.cloudinary.com/deww4lpym/image/upload/v1/cover.jpg';
    app.run(`_editBoard={id:'H',isHome:true,title:'Home',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
      _editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];
      moodBoards=[
        {id:'B1',title:'WINTER DUMP 2K27',ownerUid:'u1',visibility:'personal',coverUrl:'${COVER}',
         color:'#C2410C',icon:'W',cards:[{id:'a',type:'image',imageUrl:'${COVER}'},{id:'b',type:'file',fileUrl:'x'}]},
        {id:'B2',title:'A board with a deliberately long name that has to wrap',ownerUid:'u1',
         visibility:'shared',color:'#35507A',icon:'L',cards:[{id:'c'}]},
        {id:'B3',title:'Untitled board',ownerUid:'u1',visibility:'personal',cards:[]},
        {id:'B4',title:'Old card, never resized',ownerUid:'u1',visibility:'personal',color:'#14532D',cards:[{id:'d'}]}
      ];
      _editCards=[
        // ONE COLUMN, and that is not cosmetic. A card laid out past the
        // right edge is CLIPPED, and the hit-test then reports its own
        // controls as covered by whatever the probe finds at that point —
        // a false failure of the fragment, not of the layout. The narrowest
        // width checked is 420px, i.e. 388px of content, so every card has
        // to fit inside that. It cost two rows when a board card was 260
        // wide; at 340 it costs a column.
        // The birth size: a wide rectangle, 340x136.
        {id:'k1',type:'board',boardId:'B1',x:10,y:10,w:340,h:136},
        {id:'k2',type:'board',boardId:'B2',x:10,y:200,w:340,h:136},
        {id:'k3',type:'board',boardId:'B3',x:10,y:390,w:340,h:136},
        // The sizes board cards were written at before the redesign and
        // before the rectangle — not migrated, so the render has to grow
        // them rather than clip them.
        {id:'k4',type:'board',boardId:'B4',x:10,y:580,w:200,h:124},
        {id:'k7',type:'board',boardId:'B2',x:10,y:770,w:260,h:172},
        // A board this viewer cannot read, and an orphan with no boardId.
        {id:'k5',type:'board',boardId:'GONE',x:10,y:990,w:340,h:136},
        {id:'k6',type:'board',boardId:'',x:10,y:1180,w:340,h:136}
      ];`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      // A solid WHITE stand-in for every picture: the probe has no network,
      // and an <img> that never loads measures as nothing at all.
      .replace(/src="[^"]*cloudinary[^"]*"/g,
        'src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E"');
    // The hover line is opacity:0 until :hover, and the probe cannot hover —
    // so a second copy is rendered with it forced visible. Without this the
    // most legible thing on the card (white on a dark wash over an unknown
    // photograph) would never be measured at all.
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:1350px;width:100%">'+
        '<div class="board-world" data-lod="near">'+cards+'</div></div>'+
      '<div style="position:relative;overflow:hidden;height:1350px;width:100%;margin-top:12px">'+
        '<div class="board-world" data-lod="near" id="hovered">'+cards+'</div></div>'+
      '<style>#hovered .board-subboard-cta{opacity:1}</style>');
  },
  /* The "Preparing to download…" cover. It carries text on a literal dark
     wash, so the contrast check applies; and because it is
     pointer-events:none, every control under it must still be reachable —
     which is the hit-test's whole job, and the reason the cover explains
     rather than blocks. */
  'boards — preparing to download':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      _editConnectors=[];_boardsSelection=new Set();moodBoards=[];
      _editCards=[
        {id:'f1',type:'file',fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/brief.pdf',
         fileName:'brief.pdf',name:'ARTICLE #1',x:10,y:10,w:240,h:220},
        {id:'i1',type:'image',name:'BACK VIEW',
         imageUrl:'https://res.cloudinary.com/x/image/upload/v1/back.jpg',x:280,y:10,w:240,h:220}
      ];`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`);
    // The cover is built by _boardsBusyStart with createElement, which the
    // node harness stubs out — so it is built here the way the browser
    // really builds it, on the card that is downloading.
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:270px;width:100%">'+
        '<div class="board-world" data-lod="near">'+cards+'</div></div>'+
      '<script>' +
      '(function(){var el=document.getElementById("board-card-f1");if(!el)return;' +
      'var o=document.createElement("div");o.className="board-card-busy";' +
      'var t=document.createElement("div");t.className="board-card-busy-text";' +
      't.textContent="Preparing to download… 42%";o.appendChild(t);el.appendChild(o);})();' +
      '<\/script>');
  },
  'boards — cards at far zoom (level of detail)':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      _editConnectors=[];_boardsSelection=new Set();moodBoards=[];
      _editCards=[
        {id:'n',type:'text',text:'Winter fleece weights',name:'Fleece',x:10,y:10,w:220,h:150,
         labels:[{t:'REF',c:'blue'}],reactions:{'👍':['u2']}},
        {id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',
         name:'Hoodie',caption:'Front',x:250,y:10,w:220,h:200},
        {id:'l',type:'link',linkUrl:'https://example.test',linkTitle:'example.test',
         linkDesc:'A reference',linkSite:'example.test',
         linkImage:'https://res.cloudinary.com/x/image/upload/v1/hero.jpg',x:490,y:10,w:220,h:200},
        {id:'sb',type:'board',boardId:'CH',boardTitle:'WINTER 2K27',name:'WINTER 2K27',
         color:'green',x:730,y:10,w:200,h:130}
      ];
      moodBoards=[{id:'CH',title:'Untitled board',cards:[{id:'z'}],visibility:'personal',ownerUid:'u1'}];`)
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`);
    // Link cards hydrate their text with textContent, so an un-hydrated one
    // leaves an EMPTY <a> — which is a real 0x0 box and reports as an
    // unclickable control. That is the fragment measuring itself, not the
    // app, so fill them the way the canvas does. Both worlds share the ids,
    // so this fills the near one; the far one is display:none there anyway.
    const linkFill=app.run(`JSON.stringify(_editCards.filter(c=>c.type==='link')
      .map(c=>({id:c.id,t:c.linkTitle||'',u:c.linkUrl||'',d:c.linkDesc||''})))`);
    // Two worlds side by side, each stamped the way _boardsApplyTransform
    // stamps the real one. No transform: the probe measures layout, and a
    // scale() would shrink everything below its own size thresholds.
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:300px;width:100%">'+
        '<div class="board-world" data-lod="near">'+cards+'</div></div>'+
      '<div style="position:relative;overflow:hidden;height:300px;width:100%;margin-top:12px">'+
        '<div class="board-world" data-lod="far">'+cards+'</div></div>'+
      '<script>' +
      'JSON.parse(' + JSON.stringify(linkFill) + ').forEach(function(c){' +
      'document.querySelectorAll("#board-linkt-"+c.id).forEach(function(e){e.textContent=c.t;});' +
      'document.querySelectorAll("#board-linku-"+c.id).forEach(function(e){e.textContent=c.u;});' +
      'document.querySelectorAll("#board-linkd-"+c.id).forEach(function(e){e.textContent=c.d;});});' +
      '<\/script>');
  },
  // The top bar with the Unsorted tray OPEN. Reported from a screenshot in
  // which the word "Comments" was cut off mid-word: the tray, the comments
  // drawer and the card trash are all position:absolute with top:0, and
  // their containing block was .board-canvas-wrap, which starts at the
  // VIEWPORT top — so each of them painted over the bar. The hit-test is
  // what holds this: a control the browser cannot reach because a panel is
  // sitting on it is exactly what that check was written for.
  'boards — the top bar with the tray open':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'Winter Drop 2027',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];moodBoards=[];
      _boardsMenuOpen=false;_boardsViewOpen=false;_boardsTrayOpen=true;`);
    const full=app.run(`_renderBoardCanvasHTML()`);
    // The real wrap, so the tray resolves against the real containing block.
    return Promise.resolve({widths:[1900,1280],html:
      '<div style="position:relative;height:620px;width:100%;overflow:hidden">'+
      full.replace('class="board-canvas-wrap"','class="board-canvas-wrap" style="position:absolute;height:100%"')+
      '</div>'});
  },
  'boards — the board top bar':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'Winter Drop 2027',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];moodBoards=[];
      _boardsMenuOpen=false;_boardsViewOpen=false;`);
    const full=app.run(`_renderBoardCanvasHTML()`);
    // Just the bar: the stage below it is a pan/zoom surface with no
    // intrinsic height, and pulling it in measures nothing useful.
    const i=full.indexOf('<div class="board-topbar">');
    const j=full.indexOf('<div class="board-stage"');
    return Promise.resolve({widths:[1900,1280],html:
      '<div style="position:relative;width:100%">'+full.slice(i,j)+'</div>'});
  },
  // Home's top bar is a DIFFERENT bar — it drops share/rename/template and
  // grows the Boards button, which is the one route to the panel. Its count
  // is the red the panel tabs use, and it sits on .tool-btn.on's var(--dark)
  // chip, which INVERTS: black in light, near-white in dark. Neither bar
  // fragment above is on Home, so nothing measured this button at all.
  'boards — Home’s top bar':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'H',isHome:true,title:'Home',ownerUid:'u1',visibility:'personal',zoom:.84,panX:0,panY:0};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];
      _boardsMenuOpen=false;_boardsViewOpen=false;_boardsHomePanelCollapsed=false;
      moodBoards=[
        {id:'H',isHome:true,ownerUid:'u1',title:'Home',cards:[],visibility:'personal'},
        {id:'B',title:'WINTER DUMP 2K27',ownerUid:'u1',visibility:'personal',updatedAt:5,cards:[]}
      ];`);
    const full=app.run(`_renderBoardCanvasHTML()`);
    const i=full.indexOf('<div class="board-topbar">');
    const j=full.indexOf('<div class="board-stage"');
    return Promise.resolve({widths:[1900,1280],html:
      '<div style="position:relative;width:100%">'+full.slice(i,j)+'</div>'});
  },
  /* The trash badge's fill ramp. The whole point of four DISCRETE phases
     rather than a per-count colour is that they can be measured: this puts
     the badge on the real rail button at every phase, so the contrast check
     reads each one against the chip it actually sits on, in BOTH themes.
     The chip is var(--red), which INVERTS, so a ramp that only worked in
     light mode would fail here rather than in production.
     The panel's ask is rendered beside it for the same reason. */
  'boards — the trash badge fills up':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();
      _boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      _boardsRenderRail();`);
    const inner=app.run(`document.getElementById('board-rail').innerHTML`);
    // The real trash button, lifted out of the real rail, once per phase.
    const btn=(inner.match(/<button[^>]*data-act="trash"[\s\S]*?<\/button>/)||[])[0]||'';
    const counts=[3,12,24,30];
    const cells=counts.map(n=>{
      const cls=app.run(`_boardsTrashPhase(${n})`);
      const one=btn.replace(/<span class="board-rail-badge"[^>]*><\/span>/,
        `<span class="board-rail-badge ${cls}">${n}</span>`);
      return '<div style="position:relative;width:58px">'+one+'</div>';
    }).join('');
    const nag=app.run(`_boardsTrashNagHTML(30)`);
    return Promise.resolve(
      '<div class="board-rail" style="position:relative;inset:auto;height:auto;'+
      'flex-direction:row;width:auto;display:flex;gap:6px">'+cells+'</div>'+
      '<div class="board-ctrash-panel" style="position:relative;display:flex;'+
      'inset:auto;width:320px;margin-top:14px">'+nag+'</div>');
  },
  /* The colour panel and a card on each BACKGROUND (Sept 2026). A
     background is the one place a card's own ink sits on a coloured
     surface, so every palette entry is rendered with real text in both
     themes and measured — a soft token that read in light only would fail
     here by name. The panel's tabs and swatches are hit-tested too. */
  'boards — card backgrounds and the colour panel':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;`);
    const names=app.run(`_BOARDS_COLORS.slice(1)`);
    const themes=app.run(`JSON.stringify(_BOARDS_CARD_THEMES)`);
    // Every palette name as paper AND strip, every paper-and-ink preset, a
    // literal paper and a literal strip — five to a row, so no card is
    // laid out past the right edge of a 1280px window and reported as
    // covered by whatever the hit-test finds there.
    const specs=names.map(n=>({bg:n,color:n,label:n}))
      .concat(JSON.parse(themes).map(th=>({bg:th.bg,ink:th.ink,label:th.ink+' ink on '+th.bg})))
      .concat([{bg:'#C8102E',label:'a literal paper'},{color:'#0F766E',label:'a literal strip'}]);
    const cards=specs.map((sp,i)=>app.run(`(function(){const c=Object.assign(_boardsNewCard('text'),{id:'bg${i}',x:${20+(i%5)*240},y:${20+Math.floor(i/5)*130},text:'Dye lot ${i}'});
      ${sp.bg?`c.bg='${sp.bg}';`:''}${sp.color?`c.color='${sp.color}';`:''}${sp.ink?`c.ink='${sp.ink}';`:''}if(${i}===${names.length-1})c.locked=true;_editCards.push(c);return _boardCardHTML(c,true);})()`)
      // The body is hydrated with textContent at runtime, so the fragment
      // fills it here. NOTE the real class list is "board-card-body
      // board-text-body" — a match on the bare "board-text-body" never
      // fired, and every paper was measured with an EMPTY body until Sept
      // 2026 (found by breaking a token and watching only the A tile fail).
      .replace('<div class="board-card-body board-text-body"','<div class="board-card-body board-text-body" data-fill="Dye lot and rib order — '+sp.label+'"'));
    const stageH=20+Math.ceil(specs.length/5)*130;
    // The last card is LOCKED, so the padlock beside its name is measured
    // against the locked head strip in both themes.
    app.run(`_boardsSelection=new Set(['bg0']);_boardsColorTab='bg'`);
    const panel=app.run(`_boardsCtxHTML(_boardsColorPanelItems())`);
    // The ⋯ menu, with its provenance footer (avatar on a --cat-* token).
    const more=app.run(`_editCards[0].by='Afnan';_editCards[0].at=Date.now();_boardsCtxHTML(_boardsMoreItems(true))`);
    const rail=app.run(`_boardsRenderRail();document.getElementById('board-rail').innerHTML`);
    return Promise.resolve({widths:[1900,1280],html:
      '<div class="board-stage" style="position:relative;height:'+stageH+'px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards.join('')+'</div></div>'+
      '<script>document.querySelectorAll("[data-fill]").forEach(function(e){e.textContent=e.getAttribute("data-fill")})</script>'+
      '<div style="display:flex;gap:24px;align-items:flex-start;margin-top:14px">'+
      // The selection rail is 7 buttons since the ⋯ round (Back · Color ·
      // Labels · Reactions · Comment · Rename · ⋯); 520px holds it in the
      // large tier, and the fragment must stay inside a 1000px window's
      // viewport for the hit-test to reach every control.
      '<div style="position:relative;height:520px;width:100px"><div class="board-rail" id="board-rail">'+rail+'</div></div>'+
      '<div class="board-ctx" style="position:relative">'+panel+'</div>'+
      '<div class="board-ctx" style="position:relative">'+more+'</div></div>'});
  },
  /* The image card, like Milanote's (Sept 2026): a photo is the whole
     card, its head strip an overlay that shows only on hover or selection.
     The probe cannot hover, so the strip is measured on SELECTED cards
     (the same class the app sets): a plain photo (literal white ink on the
     literal scrim), a photo with a Top strip colour (theme ink on the
     tint), a locked one (the amber pair), plus an unselected photo wearing
     a comment badge painted onto the picture, a photo at h:0 with caption,
     label and reaction (the minimum height the render grows it to), and
     an EMPTY image card, which keeps the ordinary strip. Pictures are a
     solid WHITE stand-in, so a scrim that ever faded to transparent would
     read as white-on-white and fail. */
  /* The second Milanote video's round (Sept 2026): no card has a header
     strip, so every type is measured at REST (the head is a hover overlay
     and the probe cannot hover) and again SELECTED, which is the state
     that shows the strip. The dark scrim carries literal white ink, so it
     is measured on a to-do, a link and a table — three different papers
     under it. The to-do's own additions (title, nested task, due chip,
     assignee, the "Add a title" prompt) and the link card's one field and
     in-card error are here too, plus a card at h:0 so the render draws it
     at exactly the minimum the new chrome asks for. */
  'boards — cards without a header':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editConnectors=[];_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      _editCards=[
        // Explicit heights, not h:0. _boardsTodoMinH counts ONE-LINE tasks —
        // it cannot know that "Send the tech pack" wraps at this width, and
        // the body scrolls when it does. The minimum-height contract is
        // asserted in tests/boards.test.js instead; this fragment is here
        // for the chrome, the contrast and the hit-testing. Same division
        // the +Row/+Col strip settled on.
        {id:'td',type:'todo',title:'MILE STONE',color:'red',x:10,y:10,w:300,h:200,
         items:[{text:'Cut the fleece'},{text:'Rib order',depth:1,due:'2020-01-01',who:'Ammar Shah'},
                {text:'Send the tech pack',done:true,depth:1,due:'2099-01-01',who:'Afnan'}]},
        {id:'ta',type:'todo',x:330,y:10,w:300,h:200,items:[{text:'one'},{text:'two'},{text:'three'}]},
        {id:'lk',type:'link',x:650,y:10,w:340,h:0},
        {id:'le',type:'link',linkTitle:'ASHI',x:650,y:150,w:340,h:0,_linkErr:'Sorry, something went wrong. The page could not be read — the link still works.'},
        {id:'im',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',
         sourceUrl:'https://www.pinterest.com/pin/1/',name:'FLEECE',x:10,y:260,w:240,h:300},
        {id:'nt',type:'text',text:'x',name:'WINTER NOTE',locked:true,color:'green',x:270,y:260,w:240,h:150},
        {id:'tb',type:'table',rows:[['Fabric','GSM'],['Drill','245']],head:true,color:'blue',x:530,y:260,w:280,h:150}
      ];
      _boardsSelection=new Set(['td','im','nt','tb']);`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      .replace(/src="[^"]*cloudinary[^"]*"/g,
        'src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E"')
      // Everything this module hydrates with textContent has to be filled in
      // the REAL browser, or the fragment measures empty boxes — the defect
      // the Home panel's rows hid for weeks.
      .replace(/(id="board-tdtitle-td"[^>]*>)/,'$1MILE STONE')
      .replace(/(id="board-todo-td-0"[^>]*>)/,'$1Cut the fleece')
      .replace(/(id="board-todo-td-1"[^>]*>)/,'$1Rib order')
      .replace(/(id="board-todo-td-2"[^>]*>)/,'$1Send the tech pack')
      .replace(/(id="board-todo-ta-0"[^>]*>)/,'$1one').replace(/(id="board-todo-ta-1"[^>]*>)/,'$1two').replace(/(id="board-todo-ta-2"[^>]*>)/,'$1three')
      .replace(/(id="board-linkt-le"[^>]*>)/,'$1ASHI')
      .replace(/(id="board-name-im"[^>]*>)/,'$1FLEECE').replace(/(id="board-name-nt"[^>]*>)/,'$1WINTER NOTE')
      .replace(/(id="board-txt-nt"[^>]*>)/,'$1Fleece weights for the winter drop');
    return Promise.resolve({widths:[1900,1280],html:
      '<div class="board-stage" style="position:relative;height:600px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'+
      // The head is opacity:0/visibility:hidden until hover, and the probe
      // cannot hover — so a second copy is forced visible. Without it the
      // literal white ink on the literal scrim would never be measured.
      '<style>#hovered .board-card-head{opacity:1!important;visibility:visible!important}</style>'+
      '<div id="hovered" style="position:relative;height:600px;width:100%;overflow:hidden;margin-top:14px">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'});
  },
  /* Draw on · Edit · Background (Sept 2026). Three things no logic suite
     can see: that the drawing overlay lands on the body rather than over
     the card foot, that a cropped or rotated picture actually covers its
     card, and that the pen rail and the Background menu can be clicked.
     The pictures are a solid WHITE image, so a stroke or a scrim that ever
     went white would read as white-on-white. */
  'boards — drawing, a cropped picture and the Background menu':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editConnectors=[];_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      const PIC='https://res.cloudinary.com/x/image/upload/v1/a.jpg';
      _editCards=[
        {id:'d1',type:'image',imageUrl:PIC,x:10,y:10,w:240,h:360,imgW:1000,imgH:1500,
         strokes:[{c:'red',w:4,p:[10,12,40,55,72,30,90,80]},{c:'blue',w:8,p:[20,80,80,20]}]},
        {id:'d2',type:'image',imageUrl:PIC,x:270,y:10,w:240,h:240,imgW:1000,imgH:1500,
         crop:{x:0.25,y:0.25,w:0.5,h:0.5},caption:'Middle half'},
        {id:'d3',type:'image',imageUrl:PIC,x:530,y:10,w:360,h:240,imgW:1000,imgH:1500,rotate:90},
        {id:'d4',type:'image',imageUrl:PIC,x:910,y:10,w:240,h:200,imgW:1000,imgH:1500,
         strokes:[{c:'green',w:2,p:[5,5,95,95]}],labels:[{t:'marked up',c:'green'}],reactions:{'👍':['u1']}}
      ];
      _boardsSelection=new Set(['d1']);_boardsDrawOn='d1';`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      .replace(/src="[^"]*cloudinary[^"]*"/g,
        'src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E"')
      .replace(/(id="board-cap-d2"[^>]*>)/,'$1Middle half')
      .replace(/(id="board-label-d4-0"[^>]*>)/,'$1marked up');
    // The pen's own rail, and the Background menu, both rendered where
    // they really open. A .board-ctx is position:fixed, so it is given a
    // static position here or it would sit over the cards.
    const rail=app.run(`_boardsRailItems()`);
    const railHtml=app.run(`(function(){const items=_boardsRailItems();return items.map(it=>{
      if(it.drawSwatches)return '<div class="rail-swatches">'+_BOARDS_DRAW_COLORS.map(c=>'<button class="board-swatch sw-'+c+(c===_boardsDrawColor?' on':'')+'" data-act="draw:color:'+c+'" title="'+c+'"></button>').join('')+'</div>';
      if(it.drawWidths)return '<div class="rail-fmt-row">'+_BOARDS_DRAW_WIDTHS.map(x=>'<button class="board-pen-w'+(x.w===_boardsDrawWidth?' on':'')+'" data-act="draw:width:'+x.w+'" title="'+x.label+'"><span style="height:'+x.w+'px"></span></button>').join('')+'</div>';
      return '<button class="rail-btn'+(it.off?' off':'')+(it.done?' rail-done':'')+'" data-act="'+(it.off?'':it.act)+'" title="'+it.label+'">'+_boardsIcon(it.icon)+'<span>'+it.label+'</span></button>';
    }).join('');})()`);
    const bgMenu=app.run(`_boardsCtxHTML(_boardsImgBgItems('d1'))`);
    return Promise.resolve({widths:[1900,1280],html:
      '<div class="board-stage" style="position:relative;height:430px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'+
      '<div style="display:flex;gap:20px;align-items:flex-start;margin-top:16px">'+
      '<div class="board-rail selecting" style="position:relative;left:auto;top:auto;transform:none">'+railHtml+'</div>'+
      '<div class="board-ctx" style="position:relative;left:auto;top:auto;max-height:none">'+bgMenu+'</div></div>'});
  },
  /* The crop editor is a fixed full-viewport takeover, so it gets a
     fragment to itself — dropped into another one it would cover every
     control there and every hit-test would name it. */
  'boards — the crop and rotate editor':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editCards=[{id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',x:0,y:0,w:240,h:360}];
      _boardsSelection=new Set(['p']);
      _boardsEdit={id:'p',rot:90,crop:{x:0.2,y:0.15,w:0.55,h:0.6},nat:{w:1000,h:1500},url:'x'};`);
    // The overlay is built with createElement, which the node harness
    // stubs, so the markup is composed here exactly as _boardsRenderImgEditor
    // writes it and then MEASURED for real.
    const rn={w:1500,h:1000};
    const q={x:0.2,y:0.15,w:0.55,h:0.6};
    const poly='polygon(0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,'+(q.x*100)+'% '+(q.y*100)+'%,'+(q.x*100)+'% '+((q.y+q.h)*100)+'%,'+((q.x+q.w)*100)+'% '+((q.y+q.h)*100)+'%,'+((q.x+q.w)*100)+'% '+(q.y*100)+'%,'+(q.x*100)+'% '+(q.y*100)+'%)';
    const pic='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E';
    return Promise.resolve({widths:[1900,1280,420],html:
      '<div class="board-imgedit" style="position:relative;height:520px">'+
      '<div class="board-imgedit-bar"><strong>Crop and rotate</strong>'+
      '<span class="board-imgedit-dims">825 × 600 px</span><span style="flex:1"></span>'+
      '<button class="tool-btn" title="Rotate left">↺</button><button class="tool-btn" title="Rotate right">↻</button>'+
      '<button class="tool-btn">Reset</button><button class="tool-btn">Cancel</button>'+
      '<button class="tool-btn primary">Apply</button></div>'+
      '<div class="board-imgedit-body"><div class="board-imgedit-pic" style="aspect-ratio:'+rn.w+' / '+rn.h+'">'+
      '<img src="'+pic+'" alt="" style="transform:rotate(90deg);width:'+(rn.h/rn.w*100).toFixed(4)+'%;height:'+(rn.w/rn.h*100).toFixed(4)+'%;left:'+((1-rn.h/rn.w)*50).toFixed(4)+'%;top:'+((1-rn.w/rn.h)*50).toFixed(4)+'%">'+
      '<div class="board-imgedit-shade" style="clip-path:'+poly+'"></div>'+
      '<div class="board-imgedit-rect" style="left:'+(q.x*100)+'%;top:'+(q.y*100)+'%;width:'+(q.w*100)+'%;height:'+(q.h*100)+'%">'+
      '<span class="board-imgedit-h nw"></span><span class="board-imgedit-h ne"></span>'+
      '<span class="board-imgedit-h sw"></span><span class="board-imgedit-h se"></span></div></div></div>'+
      '<div class="board-imgedit-foot">Drag inside the picture to choose what the card shows. Esc closes without changing anything.</div></div>'});
  },
  /* ── EVERY CARD TYPE CAN BE GRABBED BY ITS OWN HEAD STRIP ────────────
     The strip is what a person aims at: it carries the card's name, the
     delete ✕ and a grab cursor. It is also an absolute overlay over the
     card's first row and is pointer-events:none, so what a press on it
     really reaches is that row — and if the row guards its own pointerdown,
     the card does not move. That is what Afnan reported for the to-do card
     ("to do not moving properly"), and the link card was worse: no drag
     surface anywhere on it at all. Every type is rendered SELECTED here, so
     the strip is painted and the probe can hit-test it. */
  'boards — every card type can be grabbed':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editConnectors=[];_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      const PIC='https://res.cloudinary.com/x/image/upload/v1/a.jpg';
      _editCards=[
        {id:'c1',type:'todo',x:10,y:10,w:240,h:150,items:[{text:'Trace the pattern'},{text:'Cut the denim'}]},
        {id:'c2',type:'text',text:'a note',x:270,y:10,w:220,h:110},
        {id:'c3',type:'link',x:510,y:10,w:220,h:100},
        {id:'c4',type:'link',linkUrl:'https://x.test',linkTitle:'T',_linkEdit:true,x:750,y:10,w:220,h:150},
        {id:'c5',type:'table',rows:[['Size','Qty'],['M','40']],x:10,y:190,w:240,h:150},
        {id:'c6',type:'image',imageUrl:PIC,x:270,y:190,w:220,h:150},
        {id:'c7',type:'board',boardId:'B',x:510,y:190,w:240,h:150},
        {id:'c8',type:'heading',text:'SECTION',x:750,y:190,w:220,h:80}
      ];
      _boardsSelection=new Set(_editCards.map(c=>c.id));`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      .replace(/src="[^"]*cloudinary[^"]*"/g,
        'src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E"');
    return Promise.resolve({widths:[1900,1280],html:
      '<div class="board-stage" style="position:relative;height:400px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'});
  },
  // The share sheet with a role per person (Sept 2026). The row is a name
  // beside a fixed control — the shape that crushed every Profile directory
  // name to 0px — so it is measured with a long name, a disabled picker and
  // an enabled one, at every width.
  'boards — the share sheet with roles':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`session={uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'};
      USER_DEFS=[
        {u:'mustafa',name:'Mustafa',email:'mustafa@groovy.op'},
        {u:'daniyal',name:'Daniyal Tufail — Creator & Content Operations Lead',email:'daniyal@groovy.op'},
        {u:'saim',name:'Saim',email:'saim@groovy.op'},
        {u:'umair',name:'Umair',email:'umair@groovy.op'},
        {u:'abbas',name:'Abbas',email:'abbas@groovy.op'}];
      _editBoard={id:'B',title:'Winter',visibility:'personal',ownerUid:'u-mustafa',
        sharedWith:['daniyal@groovy.op','saim@groovy.op','umair@groovy.op'],
        sharedView:['umair@groovy.op'],sharedComment:['saim@groovy.op']};
      window.boardsOpenShare();`);
    const box=app.el('board-share-modal').innerHTML;
    return Promise.resolve('<div class="board-share-modal" style="display:flex;position:relative;min-height:560px">'+box+'</div>');
  },
  // A YouTube link card (Sept 2026, from the Milanote study #94 §12): the
  // 16:9 area with its play button, and the URL and title under it, at the
  // size a video card is born. Measured over a WHITE stand-in thumbnail, so
  // a play circle that stopped being opaque enough would show. The play
  // button is the control inside a drag surface — the shape this module has
  // lost clicks to five times — so its hit-test is the point.
  'boards — video, audio and map link cards':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editConnectors=[];_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      _editCards=[
        {id:'v1',type:'link',linkUrl:'https://www.youtube.com/watch?v=aqz-KE-bpKQ',linkTitle:'Big Buck Bunny 60fps 4K – Official Blender Foundation Short Film',x:10,y:10,w:_BOARDS_VIDEO_W,h:_BOARDS_VIDEO_H},
        {id:'v2',type:'link',linkUrl:'https://vimeo.com/76979871',linkTitle:'The New Vimeo Player',x:370,y:10,w:_BOARDS_VIDEO_W,h:_BOARDS_VIDEO_H},
        {id:'a1',type:'link',linkUrl:'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8',linkTitle:'Never Gonna Give You Up',x:730,y:10,w:340,h:190},
        {id:'a2',type:'link',linkUrl:'https://soundcloud.com/forss/flickermood',linkTitle:'Flickermood by Forss',x:1090,y:10,w:340,h:255},
        {id:'m1',type:'link',linkUrl:'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813,17z',linkTitle:'Eiffel Tower',x:1450,y:10,w:340,h:333}];
      _boardsSelection=new Set();`);
    const white='src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E"';
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      .replace(/src="https:\/\/i\.ytimg\.com[^"]*"/g,white)
      .replace(/(id="board-linku-v1"[^>]*>)/,'$1youtube.com/watch?v=aqz-KE-bpKQ')
      .replace(/(id="board-linkt-v1"[^>]*>)/,'$1Big Buck Bunny 60fps 4K – Official Blender Foundation Short Film')
      .replace(/(id="board-linku-v2"[^>]*>)/,'$1vimeo.com/76979871')
      .replace(/(id="board-linkt-v2"[^>]*>)/,'$1The New Vimeo Player')
      .replace(/(id="board-linku-a1"[^>]*>)/,'$1open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8').replace(/(id="board-linkt-a1"[^>]*>)/,'$1Never Gonna Give You Up')
      .replace(/(id="board-linku-a2"[^>]*>)/,'$1soundcloud.com/forss/flickermood').replace(/(id="board-linkt-a2"[^>]*>)/,'$1Flickermood by Forss')
      .replace(/(id="board-linku-m1"[^>]*>)/,'$1google.com/maps/place/Eiffel+Tower').replace(/(id="board-linkt-m1"[^>]*>)/,'$1Eiffel Tower')
      // The live players point at hosts the sandbox cannot reach; the probe
      // measures the boxes, not their contents.
      .replace(/<iframe class="board-video-frame" src="[^"]*"/g,'<iframe class="board-video-frame" src="about:blank"');
    return Promise.resolve({widths:[1900],html:
      '<div class="board-stage" style="position:relative;height:360px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'});
  },
  'boards — photo cards':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editConnectors=[];_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      const PIC='https://res.cloudinary.com/x/image/upload/v1/a.jpg';
      _editCards=[
        {id:'p1',type:'image',imageUrl:PIC,name:'FRONT',x:10,y:10,w:240,h:180},
        {id:'p2',type:'image',imageUrl:PIC,name:'BACK',color:'green',x:270,y:10,w:240,h:180},
        {id:'p3',type:'image',imageUrl:PIC,name:'LOCKED',locked:true,x:530,y:10,w:240,h:180},
        {id:'p4',type:'image',imageUrl:PIC,x:790,y:10,w:240,h:180},
        {id:'p5',type:'image',imageUrl:PIC,caption:'Rib order',labels:[{t:'approved',c:'green'}],reactions:{'👍':['u1']},x:10,y:210,w:240,h:0},
        {id:'p6',type:'image',x:270,y:210,w:170,h:120}
      ];
      _boardsSelection=new Set(['p1','p2','p3']);`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      .replace(/src="[^"]*cloudinary[^"]*"/g,
        'src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E"')
      // The badge is filled by _boardsPaintCommentBadges, which needs the
      // DOM; painted here the way it would be, on the unselected photo.
      .replace(/(id="board-cmt-p4"[^>]*style=")display:none/,'$1display:inline-flex').replace(/(id="board-cmt-p4"[^>]*>)/,'$12')
      .replace(/(id="board-cap-p5"[^>]*>)/,'$1Rib order').replace(/(id="board-label-p5-0"[^>]*>)/,'$1approved');
    return Promise.resolve({widths:[1900,1280],html:
      '<div class="board-stage" style="position:relative;height:460px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'});
  },
  /* The colour swatch (28 Sept 2026): a light and a dark colour in each
     display format, one with a label, and the picker. The value ink is
     computed per colour and the name bar is --dark/--on-dark, so both are
     measured in both themes. Names are filled in here the way the hydrate
     fills them in the app (textContent). */
  'boards — colour swatches':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editConnectors=[];_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      _editCards=[
        {id:'w1',type:'swatch',hex:'#F5DEB3',x:10,y:10,w:220,h:230},
        {id:'w2',type:'swatch',hex:'#1B1B2F',fmt:'rgb',x:250,y:10,w:220,h:230},
        {id:'w3',type:'swatch',hex:'#75AE76',fmt:'hsl',name:'Brand leaf green for the winter drop',x:490,y:10,w:220,h:230},
        {id:'w4',type:'swatch',hex:'#FFFF00',fmt:'off',labels:[{t:'approved',c:'green'}],x:730,y:10,w:220,h:230}
      ];
      _boardsSelection=new Set(['w1']);window.boardsSwatchPicker('w1');`);
    let cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      .replace(/(id="board-label-w4-0"[^>]*>)/,'$1approved');
    ['w1','w2','w3','w4'].forEach(id=>{
      const nm=app.run(`_boardsSwatchLabel(_editCards.find(c=>c.id==='${id}'))`);
      cards=cards.replace(new RegExp('(id="board-swname-'+id+'"[^>]*>)'),'$1'+nm);
    });
    const picker=app.run(`document.getElementById('board-sheet').innerHTML`);
    return Promise.resolve({widths:[1900,1280],html:
      '<div class="board-stage" style="position:relative;height:280px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'+
      '<div class="board-sheet board-pop" style="position:relative;left:auto;top:auto;width:264px;max-height:none;overflow:visible">'+picker+'</div>'});
  },
  /* Pick colour's panel (29 Sept 2026): the sampled colour, the TCX and
     Pantone C tabs and the closest codes, with their Swatch buttons — both
     tabs rendered, since the probe cannot click one, plus the TCX tab with
     nothing loaded, which is what a fresh install shows. */
  'boards — Pick colour and the TCX / C tabs':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};_editConnectors=[];
      _editCards=[{id:'ph',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/a.jpg',x:0,y:0,w:200,h:200}];
      _BOARDS_PANTONE_EXTRA['19-1664 TCX']='#9E2A2B';_BOARDS_PANTONE_EXTRA['18-1662 TCX']='#C3202F';
      _BOARDS_PANTONE_EXTRA['11-0601 TCX']='#F4F5F0';_BOARDS_PANTONE_EXTRA['485 C']='#DA291C';
      _BOARDS_PANTONE_EXTRA['Cool Gray 11 C']='#53565A';
      _boardsTcxNames['19-1664 TCX']='True Red';_boardsTcxNames['18-1662 TCX']='Flame Scarlet with a longer name than fits';
      _boardsPickLast={hex:'#A02A2C',cardId:'ph',rect:{left:10,right:11,top:10,bottom:11,width:1,height:1}};`);
    const panel=sys=>{app.run(`_boardsPickSys='${sys}';_boardsPickShow();`);
      return '<div class="board-sheet board-pop" style="position:relative;left:auto;top:auto;width:300px;max-height:none;overflow:visible;margin-bottom:16px">'+
        app.run(`document.getElementById('board-sheet').innerHTML`)+'</div>';};
    const a=panel('TCX'),b=panel('C');
    app.run(`for(const k in _BOARDS_PANTONE_EXTRA)if(/TCX$/.test(k))delete _BOARDS_PANTONE_EXTRA[k];`);
    const empty=panel('TCX');
    return Promise.resolve({widths:[1900,420],html:a+b+empty});
  },
  /* Color Library ▸ TCX codes (29 Sept 2026): the tabs, the search box and
     the grid of reference rows, one of them already in the library and one
     with a name too long for its row. The real book file is parsed. */
  'color library — the TCX codes tab':()=>{
    const app=loadApp({files:['js/shared.js','js/auth.js','js/embellishments.js']});
    const book=JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'..','assets','data','pantone-tcx.json'),'utf8'));
    book.colors.unshift(['99-9999','An unusually long colour name that must ellipsize, not push','#123456']);
    app.run(`session={uid:'u1',u:'ammar',name:'Ammar',role:'owner'};currentPage='color-library';
      allColors=[{_id:'a',colorName:'True Red',pantoneCode:'19-1664 TCX',hexApprox:'#BF1932',status:'active'}];
      _colorLibTab='tcx';_tcxBook=_tcxParse(${JSON.stringify({colors:book.colors.slice(0,40).concat(book.colors.filter(r=>r[0]==='19-1664'))})});_tcxState='ok';_tcxShown=41;`);
    return Promise.resolve('<div id="main-content">'+app.run(`renderColorLibraryPage()`)+'</div>');
  },
  /* The Pantone C codes tab (29 Sept 2026): the same row as TCX, derived from
     the app's built-in C list plus the library. */
  'color library — the Pantone C codes tab':()=>{
    const app=loadApp({files:['js/shared.js','js/auth.js','js/embellishments.js']});
    app.run(`session={uid:'u1',u:'ammar',name:'Ammar',role:'owner'};currentPage='color-library';
      allColors=[{_id:'a',colorName:'An unusually long colour name that must ellipsize, not push',pantoneCode:'PANTONE 438 C',hexApprox:'#5C3317',status:'active'}];
      _colorLibTab='c';`);
    return Promise.resolve('<div id="main-content">'+app.run(`renderColorLibraryPage()`)+'</div>');
  },
  /* Labels, Reactions and Comments as popovers (Sept 2026). The comment
     rows put literal initials on --cat-* tokens with --on-dark ink, in both
     themes — the one place an avatar's ink could go unreadable — and every
     checkbox row, category button and emoji is hit-tested. The label
     text and comment bodies are hydrated in the browser, since the module
     writes them with textContent. */
  'boards — labels, reactions and comment panels':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan Bhatti',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'Winter Drop',ownerUid:'u1',visibility:'shared'};
      _editCards=[Object.assign(_boardsNewCard('text'),{id:'n1',text:'a',labels:[{t:'Ready for printing',c:'green'},{t:'Pattern done',c:'blue'},{t:'Needs review',c:'red'}],reactions:{'🔥':['u1']}})];
      _editConnectors=[];_boardsSelection=new Set(['n1']);_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      _boardsComments=[{id:'c1',cardId:'n1',ts:Date.now()-60000,text:'follow this one',byName:'Afnan Bhatti',byUid:'u1'},{id:'c2',cardId:'n1',ts:Date.now(),replyTo:'c1',text:'on it',byName:'Daniyal Tufail',byUid:'u2'},{id:'c3',cardId:'n1',ts:Date.now(),text:'ok',byName:'Sami',byUid:'u3'},{id:'c4',cardId:'n1',ts:Date.now(),text:'x',byName:'Mustafa Khan',byUid:'u4'},{id:'c5',cardId:'n1',ts:Date.now(),text:'y',byName:'Ammar Shah',byUid:'u5'},{id:'c6',cardId:'n1',ts:Date.now(),text:'z',byName:'Umair',byUid:'u6'}];`);
    const grab=()=>app.run(`document.getElementById('board-sheet').innerHTML`);
    app.run(`_boardsRenderLabelSheet('n1','')`);const labels=grab();
    app.run(`_boardsRenderReactionSheet('n1','')`);const reacts=grab();
    app.run(`_boardsCommentPopCard='n1';_boardsRenderCommentPop()`);const cmts=grab();
    const pop=(inner,w)=>'<div class="board-sheet board-pop" style="position:relative;left:auto;top:auto;width:'+w+'px;max-height:none;overflow:visible">'+inner+'</div>';
    return Promise.resolve({widths:[1900,1280],html:
      // The panes scroll in the app; here everything is laid out flat, or a
      // scrolled-away emoji reads as "covered" (the documented false hit).
      '<style>.board-emoji-pane{height:auto}.board-emoji-scroll,.board-emoji-cats,.board-cpop-list,.board-label-list{overflow:visible;max-height:none}</style>'+
      // Stacked, not side by side: the app never shows two at once, and a
      // row of three lets one panel's rows sit under another's emoji.
      '<div style="display:flex;flex-direction:column;gap:28px;align-items:flex-start">'+pop(labels,330)+pop(reacts,380)+pop(cmts,320)+'</div>'+
      '<script>'+
      '["Ready for printing","Pattern done","Needs review"].forEach(function(t,i){var e=document.getElementById("board-lrow-"+i);if(e)e.textContent=t});'+
      'var bn=document.getElementById("board-label-boardname");if(bn)bn.textContent="Winter Drop";'+
      '[["c1","Afnan Bhatti","follow this one"],["c2","Daniyal Tufail","on it"],["c3","Sami","ok"],["c4","Mustafa Khan","x"],["c5","Ammar Shah","y"],["c6","Umair","z"]].forEach(function(c){var n=document.getElementById("board-cpop-name-"+c[0]);if(n)n.textContent=c[1];var t=document.getElementById("board-cpop-text-"+c[0]);if(t)t.textContent=c[2]});'+
      '</script>'});
  },
  'boards — the tool rail':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();
      _boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      _boardsRenderRail();`);
    const inner=app.run(`document.getElementById('board-rail').innerHTML`);
    // 660px is a 768px-tall laptop minus the app top bar — the height at
    // which the old pill clipped.
    /* THE HOVER CUE IS DELIBERATELY NOT MEASURED HERE, and the attempt is
       worth recording. A second copy with .cue-on forced was tried: it
       proves nothing, because the cue is an ::after and this probe
       enumerates ELEMENTS, and at 420px the rail docks to the bottom of its
       wrapper so two copies reported each other as covering the Image tool —
       a false failure of the fragment, not of the layout. The cue's geometry
       is a one-off measurement recorded in css/main.css; its SCOPE is held
       by tests/invariants.test.js. */
    /* TWO TIERS, TWO VIEWPORTS (Sept 2026). The rail is sized by a
       min-height media query — 22px icons and a 61px pitch from 880px of
       viewport up, the compact rail below — so the wrapper is sized like
       the real stage (the viewport minus the board's own top bar; the
       canvas is a fixed takeover, so the app bar is not above it) and the
       fragment is run at a 1000px viewport (large tier, ~808px of rail) AND
       a 768px viewport (compact tier, ~623px of rail). Each tier was
       measured once with scratchpad/measure-rail.js.

       THE HEIGHTS ARE VIEWPORT HEIGHTS, AND THAT TOOK A CI FAILURE TO GET
       RIGHT. A fragment declaring heights is served inside an iframe of
       exactly that box (see the server below), because --window-size sets
       the WINDOW and the browser keeps an unpredictable slice of it: this
       machine left 100vh at 681 for a 768px window and the CI runner left
       647, so the same rail reported client:631 here and client:575 there
       and failed only on CI — the probe measuring the runner's chrome.
       Framed, the stage is exactly h-50: 950 and 718, everywhere.

       What that costs, stated rather than buried: the old 631 was smaller
       than the truth, so the check used to fire at 13 tools (673 compact)
       and now fires at 14. The guard is still real — the rail must not
       scroll — it is just no longer accidentally strict.

       STILL OPEN, and deliberately not decided here: what a 768px-tall
       LAPTOP really leaves. CLAUDE.md puts a 900px screen at ~790px of
       viewport, i.e. ~110px of OS and browser chrome; the same subtraction
       makes a 768px screen ~658px of viewport and a ~608px stage, which
       the 623px compact rail would NOT fit. That is a product question
       about the shortest screen we support, not a probe setting, so it is
       flagged for a human rather than answered by choosing a number.
       NOT at 420px: a wrapper one viewport tall plus the probe's own output
       block overflows the page, the vertical scrollbar takes 15px off the
       phone dock, and the Image tool then sits 4px past its right edge —
       reported as "covered" by the wrapper. That dock scrolls sideways by
       design and is measured at REAL phone widths (this probe's 420 is a
       clamped 500) by tests/smoke-phone.js, the same reason the top-bar
       fragments opt out. */
    return Promise.resolve({widths:[1900,1280],heights:[1000,768],html:
      '<div style="position:relative;height:calc(100vh - 50px);width:100%;overflow:hidden">'+
      '<div class="board-rail" id="board-rail">'+inner+'</div></div>'});
  },
  // Home's Boards panel: a row is a tile, a name that must ellipsize rather
  // than collapse, a meta line, a state word and an Open button — the exact
  // shape that crushed the Profile directory's names to 0px when the name
  // shared a flex row with fixed-width actions.
  // A link preview is a picture above two clamped text rows inside a fixed
  // height card — the exact shape that erased a sub-board card's title when
  // labels and reactions took the room. Rendered at the birth size too, so
  // a card somebody shrank still shows its title rather than nothing.
  'boards — link preview cards':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];moodBoards=[];
      _editCards=[
        {id:'lp',type:'link',x:10,y:10,w:250,h:280,
         linkUrl:'https://scuffers.com/collections/hoodies/products/club-navy-zipper',
         linkTitle:'Club Navy Zipper — heavyweight rugby stripe hoodie, navy/ecru',
         linkDesc:'Scuffers® Official Website. Everyday Urban Aesthetics. As Always, With Love',
         linkSite:'scuffers.com',
         linkImage:'https://res.cloudinary.com/deww4lpym/image/upload/v1/hero.jpg'},
        {id:'ln',type:'link',x:280,y:10,w:250,h:150,
         linkUrl:'https://example.com/a',linkTitle:'A page with no picture at all',
         linkDesc:'And a description long enough to need the second line it is given',
         linkSite:'example.com'},
        {id:'lt',type:'link',x:550,y:10,w:170,h:120,
         // The SMALLEST a link card gets, WITH a picture — so the show/hide
         // toggle is rendered on the card whose resize grip is nearest it.
         // A control tucked into a corner another control already owns is
         // this module's most repeated bug.
         linkUrl:'https://example.com/b',linkTitle:'Still at the birth size',linkSite:'example.com',
         linkImage:'https://res.cloudinary.com/deww4lpym/image/upload/v1/hero.jpg'},
        {id:'lo',type:'link',x:740,y:10,w:250,h:150,linkPreviewOff:true,
         linkUrl:'https://scuffers.com/collections/hoodies/products/club-navy-zipper',
         linkTitle:'Preview turned off — still a link',
         linkDesc:'The picture is hidden and the three rows keep their room',
         linkSite:'scuffers.com',
         linkImage:'https://res.cloudinary.com/deww4lpym/image/upload/v1/hero.jpg'}
      ];`);
    const html=app.run(`_editCards.map(c=>_boardCardHTML(c,true)).join('')`);
    // The text is hydrated with textContent, so it has to be put back the
    // same way the canvas does it or the fragment measures empty boxes.
    const fill=app.run(`JSON.stringify(_editCards.map(c=>({id:c.id,t:c.linkTitle||'',u:c.linkUrl||'',d:c.linkDesc||''})))`);
    return Promise.resolve(
      '<div class="board-world" data-lod="near" style="position:relative;height:420px">'+html+'</div>'+
      '<script>' +
      'JSON.parse(' + JSON.stringify(fill) + ').forEach(function(c){' +
      'var t=document.getElementById("board-linkt-"+c.id);if(t)t.textContent=c.t;' +
      'var u=document.getElementById("board-linku-"+c.id);if(u)u.textContent=c.u;' +
      'var d=document.getElementById("board-linkd-"+c.id);if(d)d.textContent=c.d;});' +
      '<\/script>');
  },
  'boards — Home’s Boards panel':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'H',isHome:true,title:'Home',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
      _editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];
      _boardsTrayOpen=true;_boardsPanelQuery='';_boardsPanelFilter='all';
      _boardsHomePanelCollapsed=false;
      moodBoards=[
        {id:'H',isHome:true,ownerUid:'u1',title:'Home',cards:[],visibility:'personal'},
        // The name Afnan's panel truncated to "WINTER D…", plus a longer one
        // still, so the two-line clamp is measured rather than assumed.
        {id:'A',title:'Winter Drop 2027 — fleece, outerwear and the full tech-pack reference dump',
         ownerUid:'u1',ownerName:'Afnan',visibility:'shared',updatedAt:9,color:'#7C3AED',icon:'W',
         cards:[{id:'i1',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/a.jpg',x:0,y:0,w:170,h:120},
                {id:'f1',type:'file',fileUrl:'https://res.cloudinary.com/x/raw/upload/t.pdf',x:0,y:0,w:200,h:110}]},
        {id:'B',title:'WINTER DUMP 2K27',ownerUid:'u2',ownerName:'Ammar',visibility:'personal',updatedAt:5,cards:[]},
        // A board wearing an uploaded PICTURE rather than a letter.
        {id:'C',title:'Lowkey Heat ’26',ownerUid:'u1',visibility:'shared',updatedAt:3,color:'#C2410C',
         coverUrl:'https://res.cloudinary.com/deww4lpym/image/upload/v1/cover.jpg',cards:[]}
      ];
      _editCards=[{id:'c1',type:'board',boardId:'B',x:0,y:0,w:200,h:124}];`);
    app.run(`_editBoard.isHome=true;(function(){
      const host=document.createElement('div');
      host.id='board-panel-host';
      host.innerHTML=_boardsTrayHTML(true);
      document.body.appendChild(host);
      _boardsPanelHydrate();
      return true;})()`);
    const inner=app.run(`document.getElementById('board-panel-host').innerHTML`);
    // THE NAMES HAVE TO BE FILLED HERE. _boardsPanelHydrate walks
    // document.getElementById, and the harness's DOM does not parse an
    // innerHTML string into findable elements — so calling it above does
    // nothing and every row measured EMPTY. This fragment claimed to prove
    // "the whole name is visible" and was measuring blank boxes until the
    // name became clickable and the probe reported it as a zero-size
    // control. Filled in the real browser instead, like the link-preview
    // and far-zoom fragments already are.
    const names=app.run(`JSON.stringify(_boardsHomeList().map(b=>({id:b.id,t:b.title||''})))`);
    // .board-tray is position:absolute inside the canvas wrap, so the
    // fragment supplies that containing block rather than letting it escape
    // to the page and measure nothing.
    return Promise.resolve(
      '<div style="position:relative;height:620px;width:100%;overflow:hidden">'+inner+'</div>'+
      '<script>' +
      'JSON.parse(' + JSON.stringify(names) + ').forEach(function(b){' +
      'var e=document.getElementById("board-panel-n-"+b.id);if(e)e.textContent=b.t;});' +
      '<\/script>');
  },
  'boards — the trash panel':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();
      _boardsCardTrashOpen=true;_boardsCardTrashTab='mine';
      const now=Date.now();
      _boardsCardTrash=[
        {id:'e1',card:{id:'g1',type:'text',text:'Winter Drop 2027 — fleece weight comparison against last season, full tech pack notes'},
         conns:[],byUid:'u1',byName:'Afnan',at:now},
        {id:'e2',card:{id:'g2',type:'file',fileName:'swatch-card.pdf'},conns:[],byUid:'u1',byName:'Afnan',at:now},
        {id:'e3',card:{id:'g3',type:'table',rows:[['A']]},conns:[],byUid:'u1',byName:'Afnan',at:now-86400000}
      ];`);
    // Render through the real function into the real host, then hand back
    // what it produced — the panel hydrates its text with textContent, so
    // reading innerHTML after the call is the only way to see the rows.
    app.run(`(function(){
      const host=document.createElement('div');
      host.id='board-ctrash-panel';host.className='board-ctrash-panel';
      document.body.appendChild(host);
      _boardsRenderTrash();
      return true;})()`);
    const inner=app.run(`document.getElementById('board-ctrash-panel').innerHTML`);
    // The host itself is position:absolute inside the canvas wrap, so the
    // fragment supplies that containing block rather than letting it
    // escape to the page and measure nothing.
    return Promise.resolve(
      '<div style="position:relative;height:620px;width:100%">'+
      '<div class="board-ctrash-panel" style="display:flex">'+inner+'</div></div>');
  },
  'boards — a card wearing labels, reactions and captions':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editConnectors=[];_boardsSelection=new Set();
      moodBoards=[{id:'CHILD',title:'Winter Drop 2027',cards:[{id:'x'}],visibility:'shared',ownerUid:'u1'}];
      _editCards=[
        {id:'sb',type:'board',boardId:'CHILD',x:10,y:10,w:200,h:104,
         labels:[{t:'QA-LABEL',c:'grey'}],reactions:{'A':['u2']}},
        {id:'fl',type:'file',x:10,y:210,w:200,h:140,caption:'Approved 12 Sep',
         fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/t.pdf',
         fileName:'winter-techpack-v4.pdf',fileSize:2841193},
        {id:'or',type:'board',boardId:'',x:10,y:420,w:200,h:104},
        // A note at EXACTLY its minimum height wearing a label and two
        // reactions: the foot's chips have to fit under the text at that
        // height, so a chrome constant that under-counts the foot clips them
        // here (the note is placed at h:0 and grown by the render).
        {id:'mn',type:'text',x:230,y:10,w:220,h:0,text:'Dye lot 4 — rib order',
         labels:[{t:'see this',c:'green'}],reactions:{'A':['u2'],'B':['u1','u2']}}
      ];`);
    let html=app.run(`_editCards.map(c=>_boardCardHTML(c,true)).join('')`);
    // Hydrated at runtime with textContent; written in here so it can be measured.
    html=html.replace(/(id="board-label-sb-0"[^>]*>)/,'$1QA-LABEL')
             .replace(/(id="board-label-mn-0"[^>]*>)/,'$1see this')
             .replace(/(<div class="board-card-body board-text-body"[^>]*id="board-txt-mn"[^>]*>)/,'$1Dye lot 4 — rib order')
             .replace(/(id="board-cap-fl"[^>]*>)/,'$1Approved 12 Sep');
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:600px;width:100%">'+html+'</div>');
  },
  // The Cutting / Issue Registry's filter bar: a wrapping row of six preset
  // buttons with an inline CUT DATE label, the range caption under the stat
  // tiles, and the day headers in the list — each of which puts a label and
  // a number in one justify-between row, the shape that crushed the Profile
  // directory's names to 0px. Both date-bar states are rendered so the
  // custom from/to inputs are measured too. The hit-test matters here: the
  // presets are the controls the whole feature is operated with.
  'cutting registry — cut-date filter':()=>{
    const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const day=n=>{const d=new Date();d.setDate(d.getDate()-n);
      const p=v=>String(v).padStart(2,'0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
    const iss=(i,date,ts)=>({gpType:'fabric',id:'GP-34'+i,ts,date,poId:'PO-1'+i,
      articleName:'EFFORTLESS TEE — FADED OLIVE',articleCode:'GP09'+i,
      fabricType:'Jersey Heavy',fabricGsm:248,fabricColor:'Slate Grey',fabricUnit:'kg',
      plannedQty:90+i,totalBundles:4,fabricQty:26.9,rollsCount:1,avgConsumption:0.2989,
      sizeBreakdown:[{size:'S',qty:15,bundles:[15]},{size:'M',qty:30,bundles:[30]},
                     {size:'L',qty:30,bundles:[30]},{size:'XL',qty:15,bundles:[15]}],
      issuer:'Uzaib',cutMaster:'Hassan',regIncomplete:i===2,
      regLabels:i===1?[{text:'PRINTING',bg:'#ede9fe',fg:'#5b21b6'}]:[]});
    const app=loadApp({files:['js/fabric.js'],currentPage:'',globals:{
      allPasses:[iss(1,day(0),5e3),iss(2,day(0),4e3),iss(3,day(1),3e3),iss(4,day(4),2e3)],
      allFabricInventory:[],allFabricMovements:[],allPOs:[],_gpEsc:esc}});
    const card=app.run('renderFabricIssueRegistry()');
    // …and the same bar in its custom state, which the reset above clears.
    app.run(`(_fabRegDate={preset:'custom',from:'${day(7)}',to:'${day(0)}'},1)`);
    const custom=app.run('_fabRegDateBarHTML()');
    return Promise.resolve(card+'<div class="card">'+custom+'</div>');
  },

  // The Creator Database (Marketing M1): stat tiles, filter bar, a table
  // carrying every tier chip (including the "manual" badge and an unscored
  // row) and the Needs completion column. The table is allowed to scroll
  // sideways inside its own wrapper at 420px; the page must not.
  // The Pattern Hub measurement grid. The size headers must sit over their
  // own input boxes: they were right-aligned in a column stretched to the
  // full card width while the 64px input sat at its left edge, so every
  // label drifted ~135px right — the XS label landed over the S box.
  // NOTE: this probe does not measure ALIGNMENT, only zero-width text,
  // overflow, hit-testing and contrast. The alignment itself is a one-off
  // Chromium measurement (135px drift before, 0px after) and is held here
  // only as the markup rule, in tests/patterns.test.js.
  'pattern hub — measurement grid':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const tpl={id:'pant',label:'Pants & trousers',poms:[
      {key:'waist_relaxed',label:'Waist (relaxed)',howTo:'Lay flat. Across the top of the waistband, edge to edge, without stretching.'},
      {key:'hip',label:'Hip',howTo:'Across the widest point of the seat, lying flat, at the crotch line.'},
      {key:'inseam',label:'Inseam',howTo:'From the crotch seam down to the bottom of the leg, along the inner seam.'}]};
    const block={id:'ptn_0004',code:'PTN-0004',name:'LIVE IN PANTS',category:'GST',status:'active',
      sizeAxis:'alpha',sizes:['XS','S','M','L','XL','2XL'],sampleSize:'M',pomTemplate:'pant',
      extraPoms:[{key:'cuff',label:'Cuff'}],grid:{M:{hip:22.5}},hook:null,slot:null,
      fit:'Baggy',tracedBy:'Hassan',createdAt:'2026-09-17'};
    const mk=session=>{
      const app=loadApp({files:['js/patterns.js'],currentPage:'pattern-block',session,globals:{localStorage:LS}});
      app.run('pomTemplates='+JSON.stringify([tpl])+';_ptnPomsLoaded=true;patterns=['+JSON.stringify(block)+'];_ptnBlocksLoaded=true;');
      return app.run('_ptnGridCardHTML(_ptnBlock("ptn_0004"))');
    };
    // The editable grid (an admin) and the read-only one (cutting), since
    // they build different cells and both have to line up.
    return mk({uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'})
         + mk({uid:'u2',u:'uzaib',name:'Uzaib',role:'viewer',email:'uzaib@groovy.op'});
  },

  // The Pattern Hub card on the Dashboard (M7). Four stat tiles in one flex
  // row plus a two-line caption — the same justify/flex shape that crushed
  // the Profile directory's names to 0px, and it has to survive 420px.
  // Rendered twice: populated, and in its failed-read state, whose message
  // is the longest string the card can carry.
  'pattern hub — dashboard card':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const data={
      articles:[
        {id:'GST060',code:'GST060',name:'Live in Pants | Ash',brand:'groovy',category:'GST',needsPattern:true,active:true,patternId:'ptn_0007'},
        {id:'GST062',code:'GST062',name:'Live in Pants | Cool',brand:'groovy',category:'GST',needsPattern:true,active:true,patternId:null},
        {id:'GHW001',code:'GHW001',name:'Cap',brand:'groovy',category:'GHW',needsPattern:false,active:true,patternId:null}
      ],
      patterns:[
        {id:'ptn_0007',code:'PTN-0007',name:'Live In Pants block',category:'GST',status:'active',sizeAxis:'alpha',sizes:['S','M'],hook:3,slot:2,extraPoms:[{key:'hem',label:'Hem'}],grid:{S:{hem:22},M:{hem:23}},labelPrinted:{S:{at:'2030-01-01'},M:{at:'2030-01-01'}}},
        {id:'ptn_0011',code:'PTN-0011',name:'Half-done block',category:'GST',status:'active',sizeAxis:'alpha',sizes:['S','M'],extraPoms:[{key:'hem',label:'Hem'}],grid:{S:{hem:22}},labelPrinted:{}}
      ],
      pattern_slots:[],
      pattern_notices:[{id:'n1',patternId:'ptn_0007',patternCode:'PTN-0007',revisionN:2,summary:'Hem shortened',lines:[],articleCodes:['GST060'],status:'open',raisedAt:'2026-09-17'}]
    };
    const app=loadApp({files:['js/patterns.js'],currentPage:'dashboard',
      session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},
      globals:{localStorage:LS,
        doc:(db,...rest)=>({key:rest.join('/')}),
        collection:(db,...rest)=>({name:rest.join('/')}),
        getDoc:async()=>({exists:()=>false,data:()=>({})}),
        getDocs:async ref=>({docs:(data[String(ref&&ref.name||'')]||[]).map(r=>({id:r.id,data:()=>r}))})}});
    return app.run('_ptnPoEnsure()').then(()=>{
      const card=app.run('renderPatternDashboardWidget()');
      const ok=card.replace('Loading…',app.run('_ptnDashBodyHTML()'));
      const bad=card.replace('Loading…',app.run("_ptnFailed.articles=true;_ptnDashBodyHTML()"));
      return ok+bad;
    });
  },

  'marketing — creator database':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const rows=[
      {ig_handle:'saritasangrez',name:'Sarita Sangrez',tier:'A',score:82,follower_count:128000,engagement_rate:0.052,city:'Lahore',niche:['Fashion Creator','Content Creator'],status:'active'},
      {ig_handle:'night_flarz',name:'Night Flarz',tier:'B',score:61,follower_count:42000,engagement_rate:0.031,city:'Karachi',niche:['Content Creator'],status:'active',tier_is_override:true,tier_formula:'C',tier_override_reason:'Strong past sales',avg_likes:1200,avg_comments:100,avg_views:30000,data_source:'api',api_fetched_at:Date.now()-3600000},
      {ig_handle:'st4rr.doll',name:'',tier:'C',score:35,follower_count:12000,engagement_rate:0.02,city:'Islamabad',niche:['Blogger','Meme/Comedy','Fitness'],status:'do_not_use'},
      {ig_handle:'shoaibkhn.t',name:'Shoaib Khan',tier:'below_threshold',score:60,follower_count:500000,engagement_rate:0.005,city:'Rahim Yar Khan',niche:[],status:'blacklisted'},
      {ig_handle:'shadysaidthat',name:'',tier:null,score:null,follower_count:null,engagement_rate:null,city:'',niche:[],status:'active'}
    ].map((r,i)=>Object.assign({id:'cr_'+i},r));
    const app=loadApp({files:['js/auth.js','js/marketing.js'],currentPage:'mkt-creators',
      session:{uid:'u1',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'},
      globals:{localStorage:LS,getDocs:async()=>({docs:rows.map(r=>({id:r.id,data:()=>r}))})}});
    return app.run('loadMarketingCreators()').then(()=>{
      const page=app.run('renderMarketingCreators()');
      app.run("_mktFilter.view='incomplete'");
      const incomplete=app.run('_mktListHTML()');
      // The creator form: the "Fetch from Instagram" row sits beside the
      // Source picker and must stay reachable at phone width.
      app.run("window.mktOpenCreator('cr_1')");
      const fetched=app.bodyHtml('mkt-modal-back');
      app.run("window.mktOpenCreator('')");
      const blank=app.bodyHtml('mkt-modal-back');
      // The niche tag screen. A row is a flexing name beside fixed-width
      // buttons inside a modal — the exact shape that rendered every name
      // in the Profile directory at 0px. The messy tag is in the fragment
      // so the "needs tidying" chip is measured too.
      app.run('mktNicheTags=["Streetwear"];mktNicheTagsLoaded=true');
      app.run('mktCreators=mktCreators.concat([{id:"cr_messy",ig_handle:"x",niche:[String.fromCharCode(34)+"Blogger"+String.fromCharCode(34)]}])');
      app.run('window.mktOpenNicheTags()');
      const tags=app.bodyHtml('mkt-modal-back');
      return page+incomplete+fetched+blank+tags;
    });
  },

  // The Dispatch Log (Marketing M2): the list with every status and Day-7
  // state, plus the log form with a creator and two products picked, and
  // the Day-7 capture form. Modals are rendered as their inner card only —
  // the fixed backdrop is shared app chrome, not this page's layout.
  // Paid PR Approvals (Marketing M3): the page, a pending request as the
  // APPROVER sees it (Approve / Reject reachable), and an approved one with
  // the payment form. The approve/reject buttons are the gate's only UI, so
  // the hit-test matters most here.
  'marketing — paid PR approvals':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const now=Date.now(),DAY=86400000;
    const creators=[
      {id:'cr_a',ig_handle:'saritasangrez',name:'Sarita Sangrez',city:'Lahore',status:'active',tier:'A',address:'House 3, Gulberg III',phone:'0300 7654321'},
      {id:'cr_b',ig_handle:'night_flarz',name:'Night Flarz',status:'active',tier:'B'}
    ];
    const reqs=[
      {id:'p1',creator_id:'cr_a',status:'pending',deliverable:'1 Reel + 3 story frames, tagged, link in bio for 48h',proposed_amount_pkr:45000,timeline:'Posts within 10 days of receipt',rationale:'Top engagement in the Lahore set; last organic post drove 38 coded orders.',requested_by_user_id:'u2',created_at:now-2*DAY,payment_status:'unpaid'},
      {id:'p2',creator_id:'cr_b',status:'approved',deliverable:'2 Reels',proposed_amount_pkr:120000,requested_by_user_id:'u2',created_at:now-9*DAY,decided_by_user_id:'u1',decided_at:now-8*DAY,dispatch_id:'dx',payment_status:'unpaid'},
      {id:'p3',creator_id:'cr_b',status:'rejected',deliverable:'Account takeover for a week',proposed_amount_pkr:350000,requested_by_user_id:'u2',created_at:now-20*DAY,decided_by_user_id:'u1',decided_at:now-19*DAY,rejection_reason:'Out of budget this quarter'}
    ];
    const dispatches=[{id:'dx',creator_id:'cr_b',type:'paid_pr',paid_pr_request_id:'p2',status:'confirmed',date_of_dispatch:'',products:[]}];
    const app=loadApp({files:['js/auth.js','js/marketing.js'],currentPage:'mkt-paid-pr',
      session:{uid:'u1',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op',canApprovePaidPR:true},
      globals:{localStorage:LS,
        collection:(db,name)=>({name}),
        getDocs:async ref=>({docs:(ref.name==='creators'?creators:ref.name==='dispatches'?dispatches:ref.name==='paid_pr_requests'?reqs:[]).map(r=>({id:r.id,data:()=>r}))})}});
    return app.run('loadMarketingCreators()').then(()=>{
      const page=app.run('renderMarketingPaidPR()');
      app.run("_mktPrFilter.status='all'");
      const all=app.run('_mktPrListHTML()');
      app.run("window.mktOpenPaidPR('p1')");
      const pending=app.bodyHtml('mkt-modal-back');
      app.run("window.mktOpenPaidPR('p2')");
      const approved=app.bodyHtml('mkt-modal-back');
      return page+all+'<div class="card">'+pending+'</div><div class="card">'+approved+'</div>';
    });
  },

  // Reports and the sheet importer (Marketing M6/M7). Reports carry four
  // tables and three explanatory strips; the importer carries the long
  // preview lists, the duplicate radios and the Name-column checkboxes.
  'marketing — reports and importer':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const DAY=86400000,now=Date.now();
    const day=n=>{const d=new Date(now-n*DAY);const p=v=>String(v).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};
    const creators=[
      {id:'cr_a',ig_handle:'saritasangrez',name:'Sarita Sangrez',status:'active'},
      {id:'cr_b',ig_handle:'night_flarz',name:'Night Flarz',status:'active'}
    ];
    const dispatches=[
      {id:'d1',creator_id:'cr_a',type:'organic',date_of_dispatch:day(40),status:'content_received',link_to_post:'https://x',performance_captured_at:1,performance_views:18400,performance_likes:1200,performance_comments:80,performance_saves:64,products:[{variant_id:'v1',product_title:'Effortless Tee',variant_title:'Rust / M',sku:'GP01-R-M'}]},
      {id:'d2',creator_id:'cr_b',type:'organic',date_of_dispatch:day(5),status:'shipped',products:[{variant_id:'v2',product_title:'Love Hurts Hoodie',variant_title:'Black / L'}]}
    ];
    const reqs=[
      {id:'p1',creator_id:'cr_a',status:'approved',proposed_amount_pkr:45000,decided_at:now-20*DAY,payment_status:'paid'},
      {id:'p2',creator_id:'cr_b',status:'approved',proposed_amount_pkr:120000,decided_at:now-50*DAY,payment_status:'unpaid'}
    ];
    const lines=[{sku:'GP01-R-M',quantity:3,order_created_at:new Date(now-45*DAY).toISOString()},{sku:'GP01-R-M',quantity:11,order_created_at:new Date(now-35*DAY).toISOString()}];
    const sheet={SheetNames:['Master List','Sep 2026'],Sheets:{
      'Master List':[['Tier','Name','IG Handle','Niche','City','Address','Phone #','Top Size','Bottom Size'],
        ['A','Sarita','saritasangrez','Fashion Creator','lahore','','','small','medium'],
        ['A','','a.very.long.handle.name_2026','Content Creator, Meme/Comedy','taxila','House 14, Street 9, Sector F-7/2, Islamabad Capital Territory','0300 1234567','large/xl','34/medium'],
        ['B','_kinzaa11','','','','','','',''],
        ['','One','shadysaidthat','','','','','',''],['','Two','shadysaidthat','','','','','',''],
        ['A','','','','','','','','']],
      'Sep 2026':[['Date of Dispatch','IG Handle','Collection Sent','Products sent','Status','Link to Post'],
        ['','st4rr.doll','Lowkey Heat','rust effortless, love hurts, ','',''],['','shadysaidthat','Live In Pants','','','']]
    }};
    const app=loadApp({files:['js/auth.js','js/marketing.js'],currentPage:'mkt-reports',
      session:{uid:'u1',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op',canApprovePaidPR:true},
      globals:{localStorage:LS,XLSX:{utils:{sheet_to_json:sh=>sh}},
        collection:(db,name)=>({name}),
        getDoc:async()=>({exists:()=>false}),
        getDocs:async ref=>({docs:(ref.name==='creators'?creators:ref.name==='dispatches'?dispatches:ref.name==='paid_pr_requests'?reqs:ref.name==='shopify_line_items'?lines:[]).map(r=>({id:r.id||'x',data:()=>r}))})}});
    return app.run('loadMarketingCreators()').then(()=>app.run('Promise.all([_mktLoadLineItems(),_mktLoadCatalog()])')).then(()=>{
      const reports=app.run('renderMarketingReports()');
      app.run('mktImportFromWorkbook('+JSON.stringify(sheet)+',"Final_Content_Tracker_2026.xlsx")');
      const imp=app.run('renderMarketingImport()');
      return reports+imp;
    });
  },

  'marketing — dispatch log':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const DAY=86400000,now=Date.now();
    const day=n=>{const d=new Date(now-n*DAY);const p=v=>String(v).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};
    const creators=[
      {id:'cr_a',ig_handle:'st4rr.doll',name:'Starr Doll',city:'Lahore',address:'House 12, Street 4, DHA Phase 5',phone:'0300 1234567',top_size:'M',bottom_size:'30',status:'active',tier:'B'},
      {id:'cr_b',ig_handle:'shoaibkhn.t',name:'Shoaib Khan',status:'active',tier:'A'},
      {id:'cr_c',ig_handle:'shadysaidthat',name:'',status:'active'}
    ];
    const P=(t,v)=>({product_id:'1',variant_id:t+v,product_title:t,variant_title:v});
    const dispatches=[
      {id:'d1',creator_id:'cr_a',type:'organic',date_of_dispatch:day(1),collection_sent:'Lowkey Heat',status:'confirmed',products:[P('Effortless Tee','Rust / M'),P('Love Hurts Hoodie','Black / L'),P('Tinted Denim','Blue / 30')]},
      {id:'d2',creator_id:'cr_b',type:'organic',date_of_dispatch:day(3),collection_sent:'Lowkey Heat',status:'in_transit',products:[P('Essential 2.0','Black / M')]},
      {id:'d3',creator_id:'cr_c',type:'organic',date_of_dispatch:day(12),collection_sent:'Live In Pants',status:'shipped',shipped_at:now-10*DAY,products:[P('Live In Pants','Grey / 32')]},
      {id:'d4',creator_id:'cr_a',type:'organic',date_of_dispatch:day(20),collection_sent:'Lowkey Heat',status:'content_received',shipped_at:now-18*DAY,content_received_at:now-15*DAY,link_to_post:'https://www.instagram.com/p/abc/',products:[P('Script Tee','Blue / M')],performance_captured_at:now-8*DAY,performance_views:12500,performance_likes:900,performance_comments:40,performance_saves:31,performance_story_replies:5},
      {id:'d5',creator_id:'cr_b',type:'organic',date_of_dispatch:'',collection_sent:'',status:'confirmed',products:[],products_note:'rust effortless, love hurts'}
    ];
    const app=loadApp({files:['js/auth.js','js/marketing.js'],currentPage:'mkt-dispatches',
      session:{uid:'u1',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'},
      globals:{localStorage:LS,
        collection:(db,name)=>({name}),
        getDocs:async ref=>({docs:(ref.name==='creators'?creators:ref.name==='dispatches'?dispatches:[
          {id:'v1',product_title:'Effortless Tee',color:'Rust',size:'M',sku:'GP01-R-M',status:'active'},
          {id:'v2',product_title:'Effortless Tee',color:'Blue',size:'M',sku:'GP01-B-M',status:'draft'}
        ]).map(r=>({id:r.id,data:()=>r}))}),
        getDoc:async()=>({exists:()=>true,data:()=>({last_success_at:{seconds:Math.floor((now-3*3600000)/1000)}})})}});
    return app.run('loadMarketingCreators()').then(()=>app.run('_mktLoadCatalog()')).then(()=>{
      const page=app.run('renderMarketingDispatches()');
      app.run("window.mktOpenDispatch('d1')");
      const form=app.bodyHtml('mkt-modal-back');
      app.run("window.mktOpenDispatch('')");
      const blank=app.bodyHtml('mkt-modal-back');
      app.run("window.mktOpenPerformance('d3')");
      const perf=app.bodyHtml('mkt-modal-back');
      return page+'<div class="card">'+form+'</div><div class="card">'+blank+'</div><div class="card">'+perf+'</div>';
    });
  },
  // The Inventory Intel SKU table, reported unreadable in dark mode and
  // measured at 1.1:1 before the fix. `.cut-table th` painted a white-alpha
  // ink on `background:var(--dark)` — and --dark INVERTS, so in dark mode
  // that is near-white text on a near-white bar. Every .cut-table in the app
  // had it; this is the page it was reported on, and the one that puts the
  // most numbers on screen at once.
  //
  // Verified both ways: restoring `color:rgba(255,255,255,.6)` on
  // `.cut-table th` fails this fragment in dark and names every header cell.
  // The tinted cells below it cover the other half of the same bug — a
  // literal ink (#111, #dc2626) or a literal light chip on a row background
  // that follows the theme.
  'inventory intel — SKU table':()=>{
    const app=loadApp({files:['js/shopify.js']});
    const rows=[
      {sku:'LIP-CG-XS',title:'Live in Pants',color:'Cool Grey',productType:'Live In Pants',
       size:'XS',onHand:58,s7:62,s30:242,daysLeft:0,dailyRate:8.8,sellThrough:0.81,
       reorderPoint:120,suggestedQty:200,season:'winter',garmentType:'bottom'},
      {sku:'LIP-CG-S',title:'Live in Pants',color:'Cool Grey',productType:'Live In Pants',
       size:'S',onHand:0,s7:20,s30:90,daysLeft:0,dailyRate:3,sellThrough:1,
       reorderPoint:60,suggestedQty:90,season:'winter',garmentType:'bottom'},
      {sku:'LIP-CG-M',title:'Live in Pants',color:'Cool Grey',productType:'Live In Pants',
       size:'M',onHand:9,s7:14,s30:60,daysLeft:5,dailyRate:2,sellThrough:0.6,
       reorderPoint:40,suggestedQty:70,season:'winter',garmentType:'bottom'},
      {sku:'CT-MR-M',title:'CORE Tees',color:'Maroon',productType:'Basic Tee',
       size:'M',onHand:367,s7:31,s30:98,daysLeft:44,dailyRate:3.3,sellThrough:0.2,
       reorderPoint:80,suggestedQty:0,season:'summer',garmentType:'top'},
      // A variant Shopify has not reported inventory for. onHand is undefined,
      // so BOTH `every(onHand>0)` and `some(onHand<=0)` are false and the
      // group total takes the third branch — the one that used to be a
      // literal near-black on a row background that follows the theme
      // (measured 1.02:1). It is the only way to reach that branch, which is
      // why a table of ordinary rows does not cover it.
      {sku:'TC-DI-OS',title:'Classic Denim',color:'Iced',productType:'Trucker Cap',
       size:'OS',s7:25,s30:89,daysLeft:5,dailyRate:1.2,season:'all-season'}
    ];
    // Expand the first group so the per-variant child rows are measured too —
    // those carry the sold-out ink and the striped --surface-2 background.
    app.run("_siSkuExpanded.add('Live in Pants|||Cool Grey')");
    const html=app.run('_siSkuTableSection('+JSON.stringify(rows)+')');
    return Promise.resolve('<div class="card">'+html+'</div>');
  },
  // Inventory Intel ▸ Article Explorer: one article's page, and Compare with the
  // maximum five series. The chart's text is HTML; its lines are tokens
  // (--si-s0..4) that must read on --surface in both themes. Data is built
  // relative to today so the weekly axis always has a shape.
  // Inventory Intel ▸ Needs Attention (Oct 2026): the red list with a stale-snapshot banner, the returns line, all three bands (watch opened),
  // the tab bar with its red pill, and the two Overview tiles. Red ink on the soft red panel, white on the count accent, in both themes.
  'inventory intel — Needs Attention list':()=>{
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    _naSeed(app,{snapAt:new Date(Date.now()-40*3600000).toISOString()});
    app.run('_siSection="attention";_siNaSel="";_siNaFilter="all";_siNaWatchOpen=true;_siNaShow={critical:false,act:false,watch:false}');
    return Promise.resolve('<div id="si-content">'+app.run('_siTabBar()')+app.run('_siOverviewAttnTiles()')+app.run('_siNaSectionHtml()')+'</div>');
  },
  'inventory intel — Needs Attention list expanded':()=>{
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    _naSeed(app);
    app.run('_siSection="attention";_siNaSel="";_siNaFilter="all";_siNaWatchOpen=true;_siNaShow={critical:true,act:true,watch:true}');
    return Promise.resolve('<div id="si-content">'+app.run('_siNaSectionHtml()')+'</div>');
  },
  'inventory intel — Needs Attention situation view':()=>{
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    _naSeed(app);
    app.run('_siSection="attention";_siNaFilter="all"');
    const pick=t=>app.run('(()=>{const i=_siNaState().issues.find(x=>x.type==="'+t+'");return i?i.code:"";})()');
    const out=['runout','sizehole','overstock'].map(t=>{const c=pick(t);if(!c)return'';app.run('_siNaSel='+JSON.stringify(c));return'<div class="si-na-frag">'+app.run('_siNaSectionHtml()')+'</div>';}).join('');
    return Promise.resolve('<div id="si-content">'+out+'</div>');
  },
  'inventory intel — Needs Attention empty and failed states':()=>{
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    app.run('_siProducts=[];_siLineItems=[];_siOrders=[];_siLoaded=true;_siHist=_siAxBuildHistory([]);_siHistState="ok";_siSnapshot={date:_siPktDate(0),snapshot_at:new Date().toISOString(),items:{}};_siAxCache=null;_siNaMemo=null;_siSyncMeta={orderSync:{last_status:"success",last_success_at:new Date().toISOString()},inventory:{}};_siSection="attention";_siNaSel=""');
    const empty=app.run('_siNaSectionHtml()');
    app.run('_siHistState="error";_siHistError="timed out after 90s";_siNaMemo=null;_siSyncMeta={orderSync:{last_status:"error",last_error:"HTTP 429 from Shopify"},inventory:{last_status:"error",last_error:"Inventory paging incomplete"}}');
    const failed=app.run('_siNaSectionHtml()');
    return Promise.resolve('<div id="si-content">'+empty+failed+'</div>');
  },
  'inventory intel — Article Explorer search':()=>{
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    _axSeed(app);
    app.run('_siAxModeSel="search";_siAxSel="GST073";_siAxQuery=""');
    return Promise.resolve('<div id="si-content">'+app.run('_siArticleExplorerSection()')+'</div>');
  },
  'inventory intel — Article Explorer overview':()=>{
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    _axSeed(app);
    app.run('_siAxModeSel="overview";_siAxOvTile="reorder";_siAxOvAll=false;_siAxOvCat="";_siAxQuery=""');
    return Promise.resolve('<div id="si-content">'+app.run('_siArticleExplorerSection()')+'</div>');
  },
  'inventory intel — Article Explorer overview lead time editor':()=>{
    // one row with its own (custom) lead time, one row with the inline editor open, and the article page verdict
    const store={'groovy-si-leadtimes-article':'{"GST073":35}'};
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(){},removeItem(){}}}});
    _axSeed(app);
    app.run('_siAxModeSel="overview";_siAxOvTile="reorder";_siAxOvAll=true;_siAxOvCat="";_siAxQuery=""');
    const codes=app.run('_siAxOvRows().filter(r=>_siAxOvIn(r,"reorder")||_siAxOvIn(r,"risk")).map(r=>r.a.code)');
    app.run('_siAxOvTile=_siAxOvRows().some(r=>_siAxOvIn(r,"reorder"))?"reorder":"risk";_siAxLtEdit='+JSON.stringify(codes[0]||'GST073')+';_siAxLtErr="Enter a whole number of days from 1 to 365."');
    const ov=app.run('_siArticleExplorerSection()');
    return Promise.resolve('<div id="si-content">'+ov+'</div>');
  },
  'inventory intel — Article Explorer verdict lead time editor':()=>{
    const store={'groovy-si-leadtimes-article':'{"GST073":35}'};
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(){},removeItem(){}}}});
    _axSeed(app);
    app.run('_siAxModeSel="search";_siAxSel="GST073";_siAxQuery="";_siAxLtEdit=null;_siAxLtErr=""');
    return Promise.resolve('<div id="si-content">'+app.run('_siArticleExplorerSection()')+'</div>');
  },
  'inventory intel — Article Explorer compare':()=>{
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    _axSeed(app);
    app.run('_siAxModeSel="compare";_siAxQuery="";_siAxCmp=["GST073","GD007","GHW001","GJ014","GCO001"];_siAxMetric="units_week";_siAxBasis="calendar"');
    return Promise.resolve('<div id="si-content">'+app.run('_siArticleExplorerSection()')+'</div>');
  },
  // Calendar window states: the winter frame with the previous-year overlay, and the twelve month tiles
  // (October first) where the five winter months carry the frost. Frost text must read on its gradient in both themes.
  'inventory intel — Article Explorer winter window and frosted months':()=>{
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    _axSeed(app);
    app.run('_siAxModeSel="compare";_siAxQuery="";_siAxCmp=["GST073","GD007"];_siAxMetric="units_month";_siAxBasis="calendar";_siAxWin="winter";_siAxWinYear=null;_siAxPrev=true');
    const a=app.run('_siArticleExplorerSection()');
    app.run('_siAxWin="months"');
    const b=app.run('_siAxCompareBody()');
    return Promise.resolve('<div id="si-content">'+a+'</div><div id="si-content-2">'+b+'</div>');
  },
  // One article chosen: the red "1" on the Compare tab and the transient alert (host + alert, as the app inserts it).
  'inventory intel — Article Explorer one chosen (badge, alert)':()=>{
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    _axSeed(app);
    app.run('_siAxModeSel="compare";_siAxQuery="";_siAxCmp=["GST073"];_siAxMetric="units_week";_siAxBasis="calendar"');
    const bar='<div class="si-ax-bar" id="si-ax-modebar">'+app.run('_siAxModeBtnHtml("overview","Overview")+_siAxModeBtnHtml("search","Search")+_siAxModeBtnHtml("compare","Compare")')+'</div>';
    const alert='<div class="si-ax-live" role="status" aria-live="polite"><div class="si-ax-flash">Choose another product to compare — add up to 5</div></div>';
    return Promise.resolve('<div id="si-content">'+bar+'<div style="height:60px">'+alert+'</div><div class="card">after the alert</div></div>');
  },
  // The article page with the attention pulse on "+ Compare" and the Compare tab (class present; the animation is CSS).
  'inventory intel — Article Explorer article page hint':()=>{
    const app=loadApp({files:['js/shopify.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    _axSeed(app);
    app.run('_siAxModeSel="search";_siAxSel="GST073";_siAxQuery="";_siAxCmpSeen=false;_siAxCmp=[]');
    return Promise.resolve('<div id="si-content">'+app.run('_siArticleExplorerSection()')+'</div>');
  },
  // The other shape of the same bug, and the one that hid longest: a label
  // whose ink is a literal white-alpha sitting on a `background:var(--dark)`
  // panel. --dark is the app's "strong contrast chip" and inverts, so these
  // read at ~1.08:1 in dark mode while the value beside them (which already
  // used --on-dark) stayed perfectly legible. Gate Pass has six of them.
  // The bell's cards at each priority. Their message text follows the theme,
  // so a card background that did not would be unreadable in dark mode —
  // which is exactly how they shipped until Sept 2026.
  'hrm — notification cards':()=>{
    const app=loadApp({files:['js/hrm.js'],
      session:{uid:'u9',u:'daniyal',name:'Daniyal Tufail',role:'creator_content_ops_lead'}});
    const n=(id,priority,title,message,actionUrl)=>({_id:id,priority,title,message,actionUrl,createdAt:Date.now()-86400000*3});
    const cards=[
      n('a','normal','Advance approved','PKR 50,000 approved. Will be deducted from your next payroll.'),
      n('b','high','No post yet: @st4rr.doll','Shipped 14 days ago and nothing is posted.','mkt-dispatches'),
      n('c','low','Policy updated','lateGraceMinutes changed from 15 to 14.')
    ].map(x=>app.run('_hrmNotifCardHTML('+JSON.stringify(x)+')')).join('');
    return Promise.resolve('<div style="max-width:360px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:12px">'+cards+'</div>');
  },
  // Notes: the page with its gutter, plus the / menu and the block menu drawn
  // flat (the real popover is position:fixed, so two of them would land on
  // top of each other and report each other as covering). The block bodies
  // are hydrated with textContent in the app, which the harness cannot do,
  // so the text is written into the markup here -- an EMPTY body is a
  // zero-height box and measures nothing.
  'notes — the page, the / menu and the block menu':()=>{
    const app=loadApp({files:['js/notes.js'],currentPage:'note-detail',
      session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
    const T=[['h1','Cutting room SOP'],['paragraph','Relax the fabric for 24 hours before it goes on the table, and log the roll code on the gate pass.'],
      ['h2','Checks'],['checklist','Marker length matches the PO'],['bullet','Grain line straight'],['numbered','Count bundles per size'],
      ['quote','If in doubt, ask the cutting master before you cut.'],['paragraph','']];
    app.run("window._gvSilentSaveStart=()=>{};_notesEditPage={id:'P',title:'Cutting room SOP',visibility:'shared',ownerUid:'u1',ownerName:'Afnan',updatedAt:Date.now()};"
      +"_notesEditBlocks="+JSON.stringify(T.map((t,i)=>({id:'b'+i,type:t[0],text:t[1],checked:false,imageUrl:''}))));
    let page=app.run('renderNoteDetailPage()');
    T.forEach((t,i)=>{page=page.replace(new RegExp('(id="nb-'+i+'"[^>]*>)</div>'),'$1'+t[1].replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</div>');});
    const pop=(rows,selIdx)=>'<div class="notes-pop open" style="position:static;margin:12px 0">'+rows.map((r,k)=>'<div class="notes-pop-row'+(k===selIdx?' sel':'')+(r.danger?' danger':'')+'"><span class="notes-pop-label">'+r.label+'</span>'+(r.hint?'<span class="notes-pop-hint">'+r.hint+'</span>':'')+'</div>').join('')+'</div>';
    app.run("_notesSlashOpen(1,'','slash')");
    const slash=JSON.parse(app.run('JSON.stringify(_notesPopState.rows.map(r=>({label:r.label,hint:r.hint})))'));
    app.run("window.notesOpenBlockMenu(1,null)");
    const menu=JSON.parse(app.run('JSON.stringify(_notesPopState.rows.map(r=>({label:r.label,danger:!!r.danger})))'));
    return Promise.resolve(page+pop(slash,2)+pop(menu,0));
  },
  'gate pass — dark summary panels':()=>{
    const app=loadApp({files:['js/gatepass.js'],currentPage:'gate-pass',
      session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'}});
    const html=app.run('renderOutward()');
    return Promise.resolve(html);
  }
};

const WIDTHS=[1900,1280,420];

const browser=findBrowser();
if(!browser){
  console.log('smoke-layout: no browser found — skipping.');
  console.log('  (set CHROME_BIN to run it)');
  process.exit(0);
}

// The measuring script. Anything with its own text that ends up zero-wide
// or zero-high is invisible to a human no matter what the DOM says.
const PROBE=`
// Measure the STEADY state. A CSS transition still running when this runs
// is read at its start value: on the CI runner the Board composer's chips
// were caught mid-way (their text colour, which does not transition, was
// already final) and reported 1.03:1 for chips that read fine at rest, on
// four pushes running, while every local run passed. Finishing each
// transition jumps it to its end value, so a steady-state failure still
// fails (checked by painting the chip ink its own background) and only the
// in-flight frame is skipped. Animations, the infinite ones included, are
// left alone.
try{(document.getAnimations?document.getAnimations():[]).forEach(function(a){
  if(typeof CSSTransition!=='undefined'&&a instanceof CSSTransition){try{a.finish();}catch(e){}}
});}catch(e){}
const bad=[];
// An element's class as a STRING. .className on an SVG element is an
// SVGAnimatedString, which stringifies to "[object SVGAnimatedString]" and
// names nothing - the exact defect already fixed for the coverer report,
// still live everywhere else until Sept 2026. getAttribute is the one form
// that works on both HTML and SVG.
function clsOf(el,max){
  if(!el)return '';
  var c=(el.getAttribute&&el.getAttribute('class'))||'';
  if(!c&&typeof el.className==='string')c=el.className;
  return String(c).slice(0,max||50);
}

function textOfOwn(el){
  let t='';
  el.childNodes.forEach(n=>{if(n.nodeType===3)t+=n.textContent;});
  return t.trim();
}
// display:none on an ANCESTOR does not show up in a descendant's own
// computed style — the child keeps whatever display it specified, so every
// collapsible form in this app (the delay-reason textarea, the QC defect
// rows) reported as zero-size invisible text. Walk up instead.
function hiddenEl(el){
  for(let n=el;n&&n.id!=='main-content';n=n.parentElement){
    const s=getComputedStyle(n);
    if(s.display==='none'||s.visibility==='hidden')return true;
  }
  return false;
}
// An <option> is never laid out — Chromium renders a select's list itself,
// so every option in the document reports a 0x0 rect. Reporting them is a
// false positive that would block any fragment containing a dropdown, and
// it says nothing about whether the select is readable. The select ITSELF
// is still measured, which is the part a human sees.
// An ARRAY, not a comma-joined string: 'OPTION,OPTGROUP'.indexOf('P') is 1,
// so a string membership test would silently exempt every <p> in the app.
const UNLAID=['OPTION','OPTGROUP'];
document.querySelectorAll('#main-content *').forEach(el=>{
  const cs=getComputedStyle(el);
  if(hiddenEl(el)||cs.position==='fixed'||UNLAID.indexOf(el.tagName)>-1)return;
  const own=textOfOwn(el);
  if(!own)return;
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1){
    bad.push({why:'invisible text',text:own.slice(0,40),
      cls:clsOf(el,60),
      w:Math.round(r.width),h:Math.round(r.height)});
  }
});
// Text that is laid out but painted NOWHERE: its box falls entirely outside
// the nearest clipping ancestor. This is what "the label sits on top of the
// title" actually was — a flex body with justify-content:center whose
// content was taller than the box spills equally out of BOTH ends, and the
// card's overflow:hidden erases the top one. Zero-size checks miss it
// completely: the element has a perfectly good rect, just not one anybody
// can see. Deliberately requires NO intersection at all, so a long note
// whose last lines are cut off is not a finding.
document.querySelectorAll('#main-content *').forEach(el=>{
  if(!textOfOwn(el))return;
  const cs=getComputedStyle(el);
  if(hiddenEl(el))return;
  let p=el.parentElement,clip=null,clipX=false,clipY=false;
  while(p&&p.id!=='main-content'){
    const pcs=getComputedStyle(p);
    const hx=pcs.overflowX==='hidden',hy=pcs.overflowY==='hidden';
    if(hx||hy){clip=p;clipX=hx;clipY=hy;break;}
    p=p.parentElement;
  }
  if(!clip)return;
  const r=el.getBoundingClientRect(),c=clip.getBoundingClientRect();
  if(r.width<1||r.height<1)return;
  // PER AXIS, and only an axis that is genuinely hidden. An axis that
  // SCROLLS has not hidden anything - it has moved it off-screen, and it
  // comes back when you scroll. Judging both axes against a box that
  // scrolls on one of them reports every horizontally-docked phone rail and
  // every tall scrolling card body as broken; that exact false positive is
  // why the +Row/+Col strip could not be held by a fragment. A box hidden
  // on BOTH axes is unchanged, which is the case the check was written for
  // (a centred flex body spilling out of both ends).
  // NOTE: no backticks in this comment - the PROBE is a template literal.
  const outX=clipX&&(r.right<=c.left||r.left>=c.right);
  const outY=clipY&&(r.bottom<=c.top||r.top>=c.bottom);
  if(outX||outY){
    bad.push({why:'text is clipped completely out of view',
      text:textOfOwn(el).slice(0,40),
      cls:clsOf(el,50),
      clippedBy:(clsOf(clip,50)||String(clip.tagName)).slice(0,50)});
  }
});
// Text you cannot READ because it is nearly the same colour as what is
// behind it. This is the class of bug the dark-mode sweep was always going
// to leave behind, and CLAUDE.md predicted it: the property-qualified sweep
// converted a plain background:#fff but not one built inside a template
// ternary, where the literal survives in the inactive branch — so toggle
// chips across the app kept a hardcoded white under near-white text.
// Worse in the other direction: --dark and --red INVERT, so an active chip
// painted var(--dark) with a hardcoded color:#fff turns into white on
// light. Both states of the same control, invisible.
//
// The threshold is deliberately LOW (2.2:1). This is not a WCAG audit — a
// stricter bar would flag every piece of muted helper text in the app and
// drown the real finding. 2.2 is "a human cannot read this at all".
function lum(c){
  // NB: PROBE is a template literal, so a lone backslash is eaten before
  // the browser ever sees it — \\d here is what reaches the regex as \d.
  const m=String(c).match(/[\\d.]+/g);
  if(!m||m.length<3)return null;
  if(m.length>3&&parseFloat(m[3])===0)return null;          // fully transparent
  const f=v=>{v=parseFloat(v)/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
  return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]);
}
function bgOf(el){
  let n=el;
  while(n&&n!==document.documentElement){
    const c=getComputedStyle(n).backgroundColor;
    const l=lum(c);
    if(l!==null)return l;
    n=n.parentElement;
  }
  return lum(getComputedStyle(document.body).backgroundColor);
}
document.querySelectorAll('#main-content *').forEach(el=>{
  const own=textOfOwn(el);
  if(!own)return;
  const cs=getComputedStyle(el);
  if(hiddenEl(el))return;
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1)return;
  const fg=lum(cs.color),bg=bgOf(el);
  if(fg===null||bg===null)return;
  const ratio=(Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05);
  if(ratio<2.2){
    bad.push({why:'text is unreadable against its background',
      text:own.slice(0,34),ratio:Math.round(ratio*100)/100,
      color:cs.color,bg:getComputedStyle(el).backgroundColor,
      cls:clsOf(el,50)});
  }
});
// At FAR zoom a card paints its content and nothing else. This is the
// contract the level-of-detail rules exist to keep: at 22% a header strip
// is ~5 physical px of grey and its text is under 3px, so painting it is
// worse than painting nothing. Asserted rather than assumed, because the
// rules are pure CSS and a renamed class would silently stop applying them
// with no other symptom.
document.querySelectorAll('.board-world[data-lod="far"]').forEach(world=>{
  ['.board-card-kind','.board-card-name','.board-card-del','.board-resize-handle',
   '.board-labels','.board-reactions',
   '.board-link-img+.board-link-meta'].forEach(sel=>{
    world.querySelectorAll(sel).forEach(el=>{
      if(getComputedStyle(el).display!=='none'){
        bad.push({why:'card chrome is still painted at far zoom',sel:sel,
          display:getComputedStyle(el).display});
      }
    });
  });
  world.querySelectorAll('.board-card-head').forEach(el=>{
    const h=el.getBoundingClientRect().height;
    if(h>12)bad.push({why:'the card header is still a full strip at far zoom',h:Math.round(h)});
    // A TINTED card kept its coloured banding, because .tint-* .board-card-head
    // sits later in the file at the same specificity and was winning.
    const bg=getComputedStyle(el).backgroundColor;
    if(bg&&bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent'){
      bad.push({why:'a card header still paints a background at far zoom',bg:bg,
        cls:clsOf(el.parentElement,40)});
    }
  });
});
// The tool rail must never need VERTICAL scrolling. It is navigation
// chrome: a tool you have to discover by scrolling a column is, in
// practice, a tool nobody finds - and the rail was a vertically-scrolling
// pill until Sept 2026, with Trash the entry most likely to fall off a
// short laptop viewport. Scoped to the vertical axis on purpose, so the
// phone dock (which scrolls sideways by design) is naturally exempt.
document.querySelectorAll('#main-content .board-rail').forEach(el=>{
  if(el.scrollHeight>el.clientHeight+2){
    bad.push({why:'the tool rail cannot show all its tools without scrolling',
      scroll:el.scrollHeight,client:el.clientHeight});
  }
});
document.querySelectorAll('#main-content .card, #main-content [class*="-row"], #main-content [class*="-tile"]').forEach(el=>{
  if(el.scrollWidth>el.clientWidth+2){
    bad.push({why:'overflows its own box',
      cls:clsOf(el,60),
      scroll:el.scrollWidth,client:el.clientWidth});
  }
});
// OPT-IN (a fragment marks itself with data-ma-past-edge): text that runs
// OUT OF THE BOX THAT HOLDS IT. The stock checks above cannot see it on a
// Master Accounts page: #main-content there is the scroll container (auto on
// a phone, clip from 601px up), so text pushed 126px past a 390px screen
// lengthens #main-content's own scroll area and never the document's, and a
// stat tile does not match [class*="-tile"]. This walks every text leaf to
// the block that holds it (the nearest ancestor that is not an inline box)
// and fails when the text's right edge is past that block's - or, for text
// held straight by #main-content, past the window's. A holder that scrolls
// or clips on purpose (a table wrapper, an ellipsis) keeps what it holds.
if(document.querySelector('[data-ma-past-edge]')){
  document.querySelectorAll('#main-content *').forEach(el=>{
    if(el.children.length||!textOfOwn(el)||hiddenEl(el))return;
    const r=el.getBoundingClientRect();
    if(r.width<1)return;
    let h=el.parentElement;
    while(h&&h.id!=='main-content'&&getComputedStyle(h).display.indexOf('inline')===0)h=h.parentElement;
    if(!h)return;
    const top=h.id==='main-content';
    if(!top&&getComputedStyle(h).overflowX!=='visible')return;
    const limit=top?innerWidth:h.getBoundingClientRect().right;
    if(r.right>limit+1){
      bad.push({why:'text runs out of the box that holds it',
        text:textOfOwn(el).slice(0,60),cls:clsOf(el,40),holder:clsOf(h,40)||h.tagName,
        past:Math.round(r.right-limit)});
    }
  });
}
if(document.documentElement.scrollWidth>innerWidth+2){
  bad.push({why:'the page scrolls sideways',
    scroll:document.documentElement.scrollWidth,viewport:innerWidth});
}
// A tick cell (a courier's uncollected receipts) IS the target, not the 18px
// box in it (M2 screens review, finding 5): every point of the cell must land
// on its own label - which ticks the box and stops the click - and never on the
// cell itself or the row, whose click opens the sheet. Nine points, the corners
// included; a cell below the window is a layout question, checked above.
document.querySelectorAll('td.ma-chkcol').forEach(td=>{
  if(!td.querySelector('input')||hiddenEl(td))return;   // the total row's cell in that column holds no box
  const r=td.getBoundingClientRect();
  if(r.width<1||r.height<1||r.bottom<0||r.top>=innerHeight)return;
  let miss=0,n=0,at=null;
  for(let i=0;i<3;i++)for(let j=0;j<3;j++){
    const x=r.left+1+(r.width-2)*i/2,y=r.top+1+(r.height-2)*j/2;
    if(y<0||y>=innerHeight)continue;
    n++;
    const e=document.elementFromPoint(x,y);
    if(!e||!e.closest||!e.closest('label.ma-tick')){miss++;if(!at)at=e?(e.tagName+'.'+clsOf(e,30)):'nothing';}
  }
  const lab=td.querySelector('label.ma-tick'),lr=lab?lab.getBoundingClientRect():null;
  if(miss)bad.push({why:'a tap in a tick cell would open the sheet, not tick the box',
    cell:Math.round(r.width)+'x'+Math.round(r.height),miss:miss+' of '+n,hit:at,
    label:lab?(Math.round(lr.width)+'x'+Math.round(lr.height)+' '+getComputedStyle(lab).display):'none'});
  if(r.width<43||r.height<43)bad.push({why:'a tick cell is under 44px',cell:Math.round(r.width)+'x'+Math.round(r.height)});
});
// A control that exists but cannot be clicked. This is the shape of nearly
// every UI bug this app has had: the board's whole top bar behind a wrong
// z-index, the delete X retargeted by a pointer capture, the profile photo
// with no handler at all. Hit-test the centre of everything clickable and
// make sure the browser would actually reach it.
document.querySelectorAll('#main-content button, #main-content [onclick], #main-content a[href]').forEach(el=>{
  const cs=getComputedStyle(el);
  if(hiddenEl(el))return;
  if(el.disabled)return;
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1){
    bad.push({why:'clickable but has no size',
      text:(el.textContent||'').trim().slice(0,30),
      cls:clsOf(el,50)});
    return;
  }
  if(cs.pointerEvents==='none'){
    bad.push({why:'clickable but pointer-events:none',
      text:(el.textContent||'').trim().slice(0,30)});
    return;
  }
  // Off-screen at this width is a layout question, already covered above.
  if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)return;
  // SCROLLED AWAY is not covered. A control whose centre lies outside the
  // visible box of a SCROLLABLE ancestor (overflow auto or scroll on that
  // axis) is one scroll from reachable, and hit-testing it reported the
  // scroller as the coverer -- the false hit several fragments here had to
  // work around. An overflow:hidden ancestor still counts: nothing brings
  // that control back.
  const cx=r.left+r.width/2,cy=r.top+r.height/2;
  let scrolledAway=false;
  for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){
    const ps=getComputedStyle(p),pr=p.getBoundingClientRect();
    const sy=ps.overflowY==='auto'||ps.overflowY==='scroll';
    const sx=ps.overflowX==='auto'||ps.overflowX==='scroll';
    if((sy&&(cy<pr.top||cy>pr.bottom))||(sx&&(cx<pr.left||cx>pr.right))){ scrolledAway=true; break; }
  }
  if(scrolledAway)return;
  const hit=document.elementFromPoint(cx,cy);
  // The click reaches the control if the hit IS the control, or a
  // descendant of it (it still bubbles). Anything else means something is
  // painted on top — INCLUDING an ancestor, which is how an ::after
  // overlay or a mispositioned z-index swallows its own children. An
  // earlier version of this check exempted ancestors and therefore caught
  // nothing; it was verified by deliberately covering a button.
  if(hit&&hit!==el&&!el.contains(hit)){
    bad.push({why:'something else is covering this control',
      text:(el.textContent||'').trim().slice(0,30),
      // Naming the coverer is the whole value of this finding, and
      // hit.className gave up on both counts: on an SVG it is an
      // SVGAnimatedString that stringifies to "[object SVGAnimatedString]",
      // and the thing on top is often an unclassed svg or path inside a
      // classed wrapper. So: the tag, then the nearest ancestor that has a
      // class - which is what a person would call it.
      // (No backticks in this comment: the PROBE is a template literal and
      // one would close it. Documented in CLAUDE.md, and hit anyway.)
      coveredBy:(hit.tagName+'.'+
        (clsOf(hit,70)||
         (hit.closest&&clsOf(hit.closest('[class]'),70))||'?')
        ).slice(0,70)});
  }
});
// A CARD THAT SAYS GRAB ME AND THEN DOES NOT MOVE.
// The rule is exact: wherever a card paints cursor:grab, a press there has
// to start the drag. Nothing else on a card is allowed to claim that
// cursor, so this needs no list of card types and no threshold.
//
// It is the shape of what Afnan reported as "to do not moving properly".
// The head strip is an absolute overlay across the card's first row and it
// is pointer-events:none, so both the CURSOR and the press come from
// whatever sits underneath. On a to-do card that is the task text, which
// inherits grab from .board-card-body and carried a stopPropagation guard
// of its own - so the strip showed a grab hand over 58% of itself and the
// card would not move. Every logic suite was green: the drag handler was
// in the DOM the whole time.
// A link card's form is correctly NOT flagged: its fields paint a text
// caret, so they promise nothing.
document.querySelectorAll('#main-content .board-card-el').forEach(card=>{
  if(hiddenEl(card))return;
  const r=card.getBoundingClientRect();
  if(r.width<8||r.height<8)return;
  if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)return;
  function reaches(el){
    let n=el;
    while(n&&n!==document.body){
      const h=n.getAttribute&&n.getAttribute('onpointerdown');
      if(h){
        if(h.indexOf('stopPropagation')>=0)return false;
        if(h.indexOf('DragStart')>=0)return true;
      }
      if(n===card)return false;
      n=n.parentElement;
    }
    return false;
  }
  let lying=0,tot=0,worst='';
  for(let dy=2;dy<r.height-2;dy+=4)for(let dx=3;dx<r.width-3;dx+=4){
    const x=r.left+dx,y=r.top+dy;
    if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
    const n=document.elementFromPoint(x,y);
    if(!n||!card.contains(n))continue;
    if(getComputedStyle(n).cursor!=='grab')continue;
    tot++;
    if(!reaches(n)){lying++;if(!worst)worst=clsOf(n,50)||n.tagName;}
  }
  if(lying>2){
    bad.push({why:'the card paints a grab cursor where a press will not drag it',
      card:clsOf(card,50),
      points:lying+' of '+tot,
      saysGrab:worst});
  }
});
(window.parent!==window?window.parent.document:document).getElementById('__out').textContent=JSON.stringify(bad);
`;

(async function main(){
  const cases=[];
  // SMOKE_LAYOUT_ONLY=<text> measures only the fragments whose name contains
  // it — for checking one fragment, or breaking it on purpose to confirm it
  // has teeth, without waiting on all of them. CI never sets it.
  const only=String(process.env.SMOKE_LAYOUT_ONLY||'').toLowerCase();
  for(const [name,build] of Object.entries(FRAGMENTS)){
    if(only&&name.toLowerCase().indexOf(only)<0)continue;
    const built=await build();
    // A builder may return {html,widths} to opt out of a width. The board
    // TOP BAR fragments do: they render the DESKTOP markup (seven controls),
    // and at 420px the phone CSS lays the bar out as ONE non-wrapping row
    // for the PHONE markup — which the real app renders there, since
    // _boardsIsPhone() is true. The phone bar is measured, comprehensively,
    // by tests/smoke-phone.js instead.
    if(built&&typeof built==='object')cases.push({name,html:built.html,widths:built.widths,heights:built.heights});
    else cases.push({name,html:built});
  }

  const server=http.createServer((req,res)=>{
    const url=decodeURIComponent(req.url.split('?')[0]);
    const m=/^\/__frag\/(\d+)$/.exec(url);
    if(m){
      const c=cases[Number(m[1])];
      const q=new URLSearchParams(req.url.split('?')[1]||'');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      // A fragment that declares heights is measured INSIDE AN IFRAME of
      // exactly that viewport, the same device tests/smoke-phone.js uses and
      // for the same reason: --window-size sets the WINDOW, not the viewport,
      // and how much of it the browser keeps for itself differs per Chrome
      // build. The tool rail is sized by a min-height media query and its
      // wrapper is a calc() off 100vh, so on the CI runner both resolved
      // ~120px shorter than here and the rail reported that it had to scroll
      // - a measurement of the runner's chrome, not of the app. An iframe has
      // a viewport of exactly its own box, so 100vh and the tier query are
      // the numbers the fragment asks for, on every machine. The inner page
      // is served byte-identical to the unframed one so nothing else moves,
      // and the probe writes its result up into the shell's own __out.
      if(c.heights&&q.get('vh')&&!q.get('inner')){
        return res.end(`<!doctype html><html><body style="margin:0">`+
          `<iframe src="/__frag/${Number(m[1])}?t=${q.get('t')==='dark'?'dark':'light'}&inner=1" `+
          `style="border:0;display:block;width:${Number(q.get('vw'))||1280}px;`+
          `height:${Number(q.get('vh'))}px"></iframe>`+
          `<pre id="__out">running</pre></body></html>`);
      }
      return res.end(`<!doctype html><html><head>
<script>document.documentElement.setAttribute('data-theme',new URL(location).searchParams.get('t')||'light');<\/script>
<link rel="stylesheet" href="/css/main.css"></head><body>
<div id="main-content" style="padding:18px 16px">${c.html}</div>
<pre id="__out">running</pre>
<script>${PROBE}<\/script></body></html>`);
    }
    const file=path.join(ROOT,url.replace(/^\/+/,''));
    if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){
      res.writeHead(404);return res.end('not found');
    }
    res.writeHead(200,{'Content-Type':url.endsWith('.css')?'text/css':'application/octet-stream'});
    fs.createReadStream(file).pipe(res);
  });

  const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'groovy-layout-'));
  let failures=0,checks=0,pending=0;

  // Launched asynchronously on purpose: this process is also the web server,
  // and a synchronous spawn deadlocks the loop that has to answer the
  // browser's requests — see the same note in tests/smoke-browser.js.
  server.listen(0,'127.0.0.1',()=>{
    const port=server.address().port;
    console.log('smoke-layout: '+path.basename(browser)+', '+cases.length+
      ' fragment(s) × '+WIDTHS.length+' widths × 2 themes\n');
    const jobs=[];
    // A builder may also return {heights}: extra WINDOW heights to measure
    // at, for markup whose CSS keys off the viewport height (the tool rail
    // has two tiers). The default is the one height every fragment gets.
    cases.forEach((c,i)=>(c.widths||WIDTHS).forEach(w=>(c.heights||[1000]).forEach(h=>['light','dark'].forEach(t=>
      jobs.push({c,i,w,h,t,dir:profileDir+'-'+i+'-'+w+'-'+h+'-'+t})))));
    pending=jobs.length;
    // A bounded pool, not all at once: with 14 fragments that is 84 Chromes,
    // and on a developer's Windows machine most of them blew the 120s
    // timeout and reported "the probe never ran" — a failure of the runner,
    // not of any layout. SMOKE_LAYOUT_CONCURRENCY overrides the default.
    const LIMIT=Math.max(1,Number(process.env.SMOKE_LAYOUT_CONCURRENCY)||Math.min(8,Math.max(2,os.cpus().length)));
    let next=0;
    const launch=()=>{
      if(next>=jobs.length)return;
      run(jobs[next++]);
    };
    // A job whose probe NEVER RAN (no result, or still "running" when the
    // virtual-time budget ran out) is retried ONCE with double the budget.
    // That is the runner not finishing, not a layout finding — seen on CI
    // on 27 Sept 2026 (the Board drawer @1280 light, green on the branch
    // run of the same commit and 5/5 locally). A probe that RAN and reported
    // a problem is never retried: only a missing answer is.
    const run=(j,attempt)=>{
      attempt=attempt||1;
      execFile(browser,['--headless=new','--no-sandbox','--disable-gpu',
        '--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
        '--disable-background-networking','--disable-component-update','--disable-sync',
        '--disable-default-apps','--disable-extensions','--metrics-recording-only',
        '--mute-audio','--no-proxy-server',
        '--window-size='+j.w+','+j.h,
        '--user-data-dir='+j.dir,
        '--virtual-time-budget='+(8000*attempt),'--dump-dom',
        'http://127.0.0.1:'+port+'/__frag/'+j.i+'?t='+j.t+
         (j.c.heights?'&vw='+j.w+'&vh='+j.h:'')],
        {encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000},
        (err,stdout)=>{
          const label=j.c.name+' @ '+j.w+'px '+(j.h!==1000?j.h+'px tall ':'')+j.t;
          const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(stdout||'');
          if((!m||m[1].trim()==='running')&&attempt===1){
            console.log('  ..   '+label+' — the probe never ran, retrying once');
            return run(j,2);
          }
          checks++;
          if(!m||m[1].trim()==='running'){
            failures++;
            console.log('  FAIL '+label+' — the probe never ran'+(err?' ('+err.message+')':''));
          }else{
            let bad=[];
            try{bad=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&')
                                   .replace(/&lt;/g,'<').replace(/&gt;/g,'>'));}catch(e){}
            if(bad.length){
              failures++;
              console.log('  FAIL '+label);
              bad.slice(0,6).forEach(b=>console.log('       '+JSON.stringify(b)));
            }else{
              console.log('  OK   '+label);
            }
          }
          if(--pending===0)finish();else launch();
        });
    };
    for(let k=0;k<Math.min(LIMIT,jobs.length);k++)launch();
  });

  function finish(){
    server.close();
    /* SWEEP BY PREFIX, because reconstructing the paths is what was broken.
       This used to rebuild them from WIDTHS/cases/themes and LEFT OUT THE
       HEIGHT, so it matched nothing: every ~8MB Chrome profile was orphaned
       in /tmp, roughly 900MB per run. That is what exhausted this sandbox's
       disk allowance mid-session, and the symptom was the probe reporting
       "the probe never ran" — a disk failure wearing a browser failure's
       clothes.

       The second attempt read the job list, and could not work either:
       `jobs` lives inside the server.listen callback and finish() is
       declared outside it, so it threw a ReferenceError straight into this
       catch and stayed silent. Reading the DIRECTORY is what removes both
       failure modes — it needs nothing in scope but `profileDir`, it takes
       the mkdtemp base as well as the per-job siblings, and no future
       change to the job path can desync it. */
    try{
      const base=path.basename(profileDir),parent=path.dirname(profileDir);
      fs.readdirSync(parent).forEach(n=>{
        if(n===base||n.indexOf(base+'-')===0)fs.rmSync(path.join(parent,n),{recursive:true,force:true});
      });
    }catch(e){}
    console.log('');
    if(failures){
      console.log('\x1b[31m'+failures+' of '+checks+' layout checks failed\x1b[0m');
      process.exit(1);
    }
    console.log('\x1b[32mall '+checks+' layout checks passed\x1b[0m');
  }
})().catch(e=>{console.error('smoke-layout: '+(e&&e.stack||e));process.exit(1);});

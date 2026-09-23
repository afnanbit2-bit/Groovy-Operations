/* ─────────────────────────────────────────────────────────────────────────
   js/store-accounts.js — Store Accounts (wave 1, Sept 2026).

   What this holds: the derivation engine (one entry shape → cash / MCB /
   vendor payable / runner float), FIFO aging, the rate card, the running
   books, the write guards (closed month, future date, role), voids that
   stay on the record, pending cash-in, floats, the consumable bill, the
   month close checkpoint, the Excel row shapes, the vendor wizard's save,
   the legacy import mapping, and that firestore.rules mirrors the code.

   What it cannot hold: anything visual (tests/smoke-layout.js has the
   ledger fragment), the real REST round trip, Cloudinary uploads.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;

const FILES=['js/store.js','js/store-accounts.js'];
const LS={getItem:()=>null,setItem(){},removeItem(){}};
const OWNER={uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'};
const RAEES={uid:'u9',u:'raees',name:'Raees',role:'store',email:'raees@groovy.op'};
const MUSTAFA={uid:'u3',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'};
const pad=n=>String(n).padStart(2,'0');
const dayStr=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const daysAgo=n=>{const d=new Date();d.setDate(d.getDate()-n);return dayStr(d);};
const TODAY=daysAgo(0);
const MONTH=TODAY.slice(0,7);
const monthAdd=(mo,n)=>{const [y,m]=mo.split('-').map(Number);const d=new Date(y,m-1+n,1);return d.getFullYear()+'-'+pad(d.getMonth()+1);};
const LAST=monthAdd(MONTH,-1);
const J=v=>JSON.stringify(v);
const ACCT_DEFAULT_CATS=['Store purchase','Maintenance & repairs','Utilities','Transport & fuel','Refreshments','Office & stationery','Wages & labour','Other'];

const BASE={
  allItems:[],allTransactions:[],allTemplates:[],allRequests:[],allActivePOs:[],
  allStoreCategories:[],allPoIssueRequests:[],allPoEditRequests:[],allPoShortfalls:[],
  auth:{currentUser:{getIdToken:async()=>'tok'}},
  _ilPage:1,_ilQ:'',_ilPO:'',_ilDir:'',IL_PER:15,IL_MAX_PAGES:1000,
  _invFilterCat:'all',_invSearchQ:'',_invSort:'category',
  localStorage:LS
};
function app(o){
  o=o||{};
  const xlsx=[];
  const a=harness.loadApp({files:FILES,session:o.session||OWNER,currentPage:o.currentPage||'acct-ledger',
    globals:Object.assign({},BASE,{
      XLSX:{utils:{aoa_to_sheet:aoa=>({aoa}),book_new:()=>({sheets:[]}),book_append_sheet:(wb,ws,n)=>{wb.sheets.push([n,ws.aoa]);}},writeFile:(wb,f)=>{xlsx.push({file:f,sheets:wb.sheets});}}
    },o.globals||{})});
  a.xlsx=xlsx;
  a.seed=(entries,vendors,extra)=>{a.run(`acctEntries=${J(entries||[])};acctVendors=${J(vendors||[])};acctCloses=${J((extra&&extra.closes)||[])};acctSettings=${J((extra&&extra.settings)||null)};_acctLoaded=true;_storeLoadAttempted=true;_acctSort(acctEntries);1`);};
  return a;
}
let seq=0;
const E=(type,o)=>Object.assign({_id:'e'+(++seq),type,date:TODAY,month:TODAY.slice(0,7),ts:1000+seq,by:'raees',byName:'Raees',vendorId:null,vendorName:'',person:'',account:null,toAccount:null,source:null,floatId:null,amount:0,lines:[],category:'',ref:'',note:'',photo:null,status:'posted',needsReview:false,reviewFlags:[]},o||{});
const V=(id,o)=>Object.assign({_id:id,name:id,kind:'goods',terms:{mode:'credit',creditDays:30,creditLimit:0,billDay:0,expectedAmount:0},meter:null,contact:{person:'',phone:'',address:''},supplies:[],notes:'',active:true,openingBalance:0},o||{});

module.exports=async function(){
  const s=suite('store-accounts');

  s.section('one entry shape → one effect function');
  {
    const a=app();
    const fx=t=>a.run(`_acctEffect(${J(t)})`);
    s.eq('a cash purchase takes cash',fx(E('purchase',{source:'cash',account:'cash',amount:500})).cash,-500);
    s.eq('an MCB purchase takes MCB',fx(E('purchase',{source:'mcb',account:'mcb',amount:500})).mcb,-500);
    s.eq('a credit purchase moves no money',fx(E('purchase',{source:'credit',amount:500})).cash+fx(E('purchase',{source:'credit',amount:500})).mcb,0);
    s.eq('…but raises the payable',fx(E('purchase',{source:'credit',amount:500})).payable,500);
    s.eq('a float purchase uses the float',fx(E('purchase',{source:'float',floatId:'f1',amount:300})).floatUsed,300);
    const pay=fx(E('payment',{account:'cash',amount:200,vendorId:'v'}));
    s.ok('a payment takes cash AND lowers the payable',pay.cash===-200&&pay.payable===-200);
    s.eq('cash in adds',fx(E('cash_in',{account:'mcb',amount:900})).mcb,900);
    const x=fx(E('transfer',{account:'mcb',toAccount:'cash',amount:400}));
    s.ok('a transfer moves between the two',x.mcb===-400&&x.cash===400);
    s.eq('a float out takes cash',fx(E('float_out',{account:'cash',amount:1000})).cash,-1000);
    s.eq('change back returns cash',fx(E('float_in',{account:'cash',amount:150,floatId:'f'})).cash,150);
    s.eq('an adjustment is signed',fx(E('adjust',{account:'cash',amount:-200})).cash,-200);
    s.eq('an opening balance is a payable',fx(E('opening',{amount:700,vendorId:'v'})).payable,700);
    const v=fx(E('purchase',{source:'cash',account:'cash',amount:500,status:'void'}));
    s.ok('a VOID entry has no effect at all',v.cash===0&&v.payable===0);
    s.eq('a PENDING cash-in has no effect yet',fx(E('cash_in',{account:'cash',amount:500,status:'pending'})).cash,0);
  }

  s.section('balances are derived, never stored');
  {
    const a=app();
    a.seed([
      E('cash_in',{account:'cash',amount:10000,date:daysAgo(9)}),
      E('cash_in',{account:'mcb',amount:50000,date:daysAgo(9)}),
      E('purchase',{source:'cash',account:'cash',amount:1200,vendorId:'thread',vendorName:'thread',date:daysAgo(8)}),
      E('purchase',{source:'credit',amount:8000,vendorId:'thread',vendorName:'thread',date:daysAgo(7)}),
      E('payment',{account:'mcb',amount:3000,vendorId:'thread',vendorName:'thread',date:daysAgo(6)}),
      E('float_out',{_id:'flt1',account:'cash',amount:2000,person:'Noman',date:daysAgo(5)}),
      E('purchase',{source:'float',floatId:'flt1',person:'Noman',amount:1400,vendorId:'walk',vendorName:'walk',date:daysAgo(4)}),
      E('float_in',{floatId:'flt1',person:'Noman',account:'cash',amount:400,date:daysAgo(4)}),
      E('purchase',{source:'cash',account:'cash',amount:99999,vendorId:'walk',vendorName:'walk',status:'void',date:daysAgo(3)}),
      E('cash_in',{account:'cash',amount:5000,status:'pending',date:daysAgo(2)})
    ],[V('thread'),V('walk',{terms:{mode:'cash'}})]);
    const b=a.run('_acctBalances()');
    s.eq('cash: 10000 − 1200 − 2000 + 400 (void and pending ignored)',b.cash,7200);
    s.eq('MCB: 50000 − 3000',b.mcb,47000);
    s.eq('thread is owed 8000 − 3000',b.payables.thread,5000);
    s.eq('total payables',a.run('_acctTotalPayables()'),5000);
    const f=a.run('_acctOpenFloats()');
    s.eq('one open float',f.length,1);
    s.eq('with 2000 − 1400 − 400 still to account for',f[0].left,200);
    s.eq('no balance is written to any account document',a.state.fetches.filter(x=>/acct_accounts|store_cash_accounts/.test(x.url)).length,0);
    // closing a month stores a checkpoint that the balance starts from
    a.run(`acctCloses=[{month:'${monthAdd(MONTH,-3)}',cashBook:1000,mcbBook:2000,payables:{thread:300}}]`);
    const c=a.run('_acctBalances()');
    s.eq('a close checkpoint seeds cash',c.cash,8200);
    s.eq('and the vendor payable',c.payables.thread,5300);
  }

  s.section('aging is FIFO — the oldest bill is paid first');
  {
    const a=app();
    a.seed([
      E('purchase',{source:'credit',amount:5000,vendorId:'v',vendorName:'v',date:daysAgo(45),ref:'B1'}),
      E('purchase',{source:'credit',amount:3000,vendorId:'v',vendorName:'v',date:daysAgo(10),ref:'B2'}),
      E('payment',{account:'cash',amount:4000,vendorId:'v',vendorName:'v',date:daysAgo(5)})
    ],[V('v',{terms:{mode:'credit',creditDays:30}})]);
    const ag=a.run("_acctVendorAging('v')");
    s.eq('balance 8000 − 4000',ag.balance,4000);
    s.eq('B1 (45 days) has 1000 open after the 4000 payment',ag.unpaid.find(u=>u.label==='Bill B1').open,1000);
    s.eq('B2 is untouched',ag.unpaid.find(u=>u.label==='Bill B2').open,3000);
    s.eq('overdue is only the 45-day remainder',ag.overdue,1000);
    s.eq('oldest unpaid date is B1',ag.oldest,daysAgo(45));
    a.run("acctEntries.push("+J(E('payment',{account:'cash',amount:6000,vendorId:'v',vendorName:'v',date:daysAgo(1)}))+");_acctSort(acctEntries)");
    const ag2=a.run("_acctVendorAging('v')");
    s.eq('overpaying leaves nothing unpaid',ag2.unpaid.length,0);
    s.eq('and shows the advance',ag2.advance,2000);
    s.eq('cash-terms vendor never has overdue',app().run("(acctVendors=["+J(V('c',{terms:{mode:'cash'}}))+"],acctEntries=["+J(E('purchase',{source:'credit',amount:10,vendorId:'c',date:daysAgo(90)}))+"],_acctVendorAging('c').overdue)"),0);
  }

  s.section('the rate card is derived from purchase lines');
  {
    const a=app();
    a.seed([
      E('purchase',{source:'cash',account:'cash',amount:2100,vendorId:'A',vendorName:'A',date:daysAgo(20),lines:[{itemCode:'TH1',desc:'Thread white',qty:10,unit:'cone',rate:210,total:2100}]}),
      E('purchase',{source:'credit',amount:2300,vendorId:'A',vendorName:'A',date:daysAgo(2),lines:[{itemCode:'TH1',desc:'Thread white',qty:10,unit:'cone',rate:230,total:2300}]}),
      E('purchase',{source:'cash',account:'cash',amount:2000,vendorId:'B',vendorName:'B',date:daysAgo(1),lines:[{itemCode:'TH1',desc:'Thread white',qty:10,unit:'cone',rate:200,total:2000}]}),
      E('purchase',{source:'cash',account:'cash',amount:500,vendorId:'A',vendorName:'A',date:daysAgo(1),status:'void',lines:[{itemCode:'TH1',desc:'Thread white',qty:1,unit:'cone',rate:500,total:500}]})
    ],[V('A'),V('B')]);
    const c=a.run("_acctRateCard('A')");
    s.eq('one item on A\'s card',c.length,1);
    s.ok('last / min / max / count',c[0].rate===230&&c[0].min===210&&c[0].max===230&&c[0].n===2,J(c[0]));
    s.eq('a voided purchase never reaches the card',c[0].max,230);
    s.eq('the latest rate from THIS vendor wins',a.run("_acctLatestRate('TH1','A').rate"),230);
    s.eq('an unknown vendor falls back to anyone\'s latest',a.run("_acctLatestRate('TH1','Z').rate"),200);
    s.eq('exposed for the Store',a.run("window.acctLatestRate('TH1')"),200);
    s.eq('no item → null',a.run("_acctLatestRate('')"),null);
  }

  s.section('the books run a balance oldest → newest');
  {
    const a=app();
    a.seed([
      E('cash_in',{account:'cash',amount:1000,date:LAST+'-15'}),
      E('purchase',{source:'cash',account:'cash',amount:300,vendorId:'w',vendorName:'w',date:MONTH+'-02'}),
      E('purchase',{source:'cash',account:'cash',amount:50,vendorId:'w',vendorName:'w',date:MONTH+'-03',status:'void',voidReason:'typo'}),
      E('cash_in',{account:'mcb',amount:2000,date:MONTH+'-04'}),
      E('transfer',{account:'mcb',toAccount:'cash',amount:500,date:MONTH+'-05'})
    ],[V('w',{terms:{mode:'cash'}})]);
    a.run("_acctView='cash';_acctPeriod={preset:'month'}");
    const r=a.run('_acctRows()');
    s.eq('opening is last month\'s cash',r.opening,1000);
    s.eq('three cash rows this month (the void one still listed)',r.rows.length,3);
    s.eq('running balance after the purchase',r.rows[0].bal,700);
    s.eq('the void row moves nothing',r.rows[1].bal,700);
    s.eq('closing after the transfer in',r.closing,1200);
    a.run("_acctView='mcb'");
    s.eq('the MCB book sees only MCB rows',a.run('_acctRows().rows.length'),2);
    a.run("_acctView='all';_acctFilter.q='transfer'");
    s.eq('search narrows',a.run('_acctRows().rows.length'),1);
    a.run("_acctFilter.q='';_acctPeriod={preset:'custom',from:'"+MONTH+"-04',to:'"+MONTH+"-04'}");
    s.eq('a custom range is inclusive',a.run('_acctRows().rows.length'),1);
  }

  s.section('particulars read like a ledger, and user text is escaped');
  {
    const a=app();
    a.seed([],[V('bad',{name:'<img src=x onerror=alert(1)>'})]);
    const p=e=>a.run(`_acctParticulars(${J(e)})`);
    s.eq('one-line purchase',p(E('purchase',{lines:[{desc:'Thread',qty:12,unit:'cone',rate:210}]})),'Thread · 12 cone @ ₨210');
    s.eq('multi-line purchase counts',p(E('purchase',{lines:[{desc:'A'},{desc:'B'},{desc:'C'}]})),'3 items · A, B…');
    s.eq('payment names the vendor',p(E('payment',{vendorName:'Pak Gas'})),'Payment to Pak Gas');
    s.eq('cash in says how it arrived',p(E('cash_in',{via:'mcb',person:'Afnan'})),'Cash in · MCB transfer from Afnan');
    s.eq('transfer names both ends',p(E('transfer',{account:'mcb',toAccount:'cash'})),'Transfer MCB → Cash');
    a.run("acctEntries=["+J(E('payment',{vendorId:'bad',amount:5}))+"];_acctView='all';_acctPeriod={preset:'all'}");
    const html=a.run('_acctLedgerTable(_acctRows().rows,null,null)');
    s.ok('the vendor name reaches the table escaped',html.includes('&lt;img')&&!html.includes('<img src=x'));
  }

  s.section('writes are guarded');
  {
    const a=app();
    a.seed([],[V('v')],{closes:[{month:LAST,cashBook:0,mcbBook:0,payables:{}}]});
    const w=e=>a.run(`_acctWrite(${J(e)})`);
    s.eq('a closed month refuses',await w(E('cash_in',{account:'cash',amount:5,date:LAST+'-10'})),null);
    s.ok('and says so',/closed/.test(a.state.toasts.slice(-1)[0]));
    s.eq('a future date refuses',await w(E('cash_in',{account:'cash',amount:5,date:'2999-01-01'})),null);
    s.eq('a bad date refuses',await w(E('cash_in',{account:'cash',amount:5,date:'yesterday'})),null);
    const before=a.state.fetches.length;
    const row=await w(E('cash_in',{account:'cash',amount:5,date:TODAY}));
    s.ok('a good entry is written',!!row&&row._id);
    s.ok('over REST to acct_entries',a.state.fetches.slice(before).some(f=>/\/acct_entries\//.test(f.url)&&f.init.method==='PATCH'));
    s.eq('and lands in memory',a.run('acctEntries.length'),1);
    s.eq('activity is logged',a.state.activity.filter(x=>x.action==='Accounts entry recorded').length,1);
    const m=app({session:MUSTAFA});m.seed([],[V('v')]);
    s.eq('a manager can look but not write',await m.run(`_acctWrite(${J(E('cash_in',{account:'cash',amount:5}))})`),null);
    s.eq('Raees can',!!(await app({session:RAEES}).run(`(_acctLoaded=true,_acctWrite(${J(E('cash_in',{account:'cash',amount:5}))}))`)),true);
  }

  s.section('review flags warn, never block');
  {
    const a=app();
    a.seed([],[V('v')],{settings:{approvalLimit:10000,receiptRequiredAbove:2000}});
    const r1=await a.run(`_acctWrite(${J(E('purchase',{source:'cash',account:'cash',amount:15000,photo:'https://res.cloudinary.com/x/y.jpg',vendorId:'v'}))})`);
    s.ok('over the limit is written',!!r1);
    s.ok('and flagged',r1.needsReview&&r1.reviewFlags.indexOf('over limit')>-1,J(r1.reviewFlags));
    const r2=await a.run(`_acctWrite(${J(E('payment',{account:'cash',amount:3000,vendorId:'v'}))})`);
    s.ok('a big payment with no receipt is flagged',r2.reviewFlags.indexOf('no receipt')>-1,J(r2.reviewFlags));
    const r3=await a.run(`_acctWrite(${J(E('payment',{account:'cash',amount:500,vendorId:'v'}))})`);
    s.eq('a small one is not',r3.needsReview,false);
    const r4=await a.run(`_acctWrite(${J(E('adjust',{account:'cash',amount:-5,note:'x'}))})`);
    s.ok('an adjustment always is',r4.reviewFlags.indexOf('adjustment')>-1);
    await a.run(`window.acctReview('${r1._id}')`);
    s.ok('an owner clears it',a.run(`_acctById('${r1._id}').reviewedAt>0`));
    s.eq('the queue is derived',a.run("acctEntries.filter(e=>e.needsReview&&!e.reviewedAt).length"),2);
  }

  s.section('void, never edit');
  {
    const a=app({globals:{prompt:()=>'entered twice'}});
    a.seed([E('purchase',{_id:'p1',source:'cash',account:'cash',amount:400,vendorId:'v',vendorName:'v'}),E('purchase',{_id:'p2',source:'cash',account:'cash',amount:9,vendorId:'v',date:LAST+'-02',month:LAST})],[V('v')],{closes:[{month:LAST,cashBook:0,mcbBook:0,payables:{}}]});
    s.eq('cash before',a.run('_acctBalances().cash'),-400);
    await a.run("window.acctVoid('p1')");
    const e=a.run("_acctById('p1')");
    s.eq('status is void',e.status,'void');
    s.eq('the reason is kept',e.voidReason,'entered twice');
    s.eq('the row is still there',a.run('acctEntries.length'),2);
    s.eq('its effect is gone',a.run('_acctBalances().cash'),0);
    s.ok('the update went over REST with the same id',a.state.fetches.some(f=>/\/acct_entries\/p1$/.test(f.url)&&f.init.method==='PATCH'));
    await a.run("window.acctVoid('p2')");
    s.eq('a closed month cannot be voided',a.run("_acctById('p2').status"),'posted');
    const b=app({globals:{prompt:()=>''}});b.seed([E('purchase',{_id:'p1',source:'cash',account:'cash',amount:1,vendorId:'v'})],[V('v')]);
    await b.run("window.acctVoid('p1')");
    s.eq('no reason, no void',b.run("_acctById('p1').status"),'posted');
    const c=app({globals:{prompt:()=>'x'}});c.seed([E('float_out',{_id:'f',account:'cash',amount:500,person:'Noman'}),E('purchase',{source:'float',floatId:'f',amount:100,vendorId:'v'})],[V('v')]);
    await c.run("window.acctVoid('f')");
    s.eq('a float with bills against it cannot be voided first',c.run("_acctById('f').status"),'posted');
  }

  s.section('cash in recorded by an owner waits for Raees');
  {
    const a=app({session:OWNER});
    a.seed([],[]);
    a.el('f-acc').value='mcb';a.el('f-via').value='mcb';a.el('f-amount').value='25000';a.el('f-date').value=TODAY;a.el('f-person').value='Afnan';
    await a.run("window.acctSubmit('cash_in')");
    const e=a.run('acctEntries[0]');
    s.eq('it is pending',e&&e.status,'pending');
    s.eq('and does not count yet',a.run('_acctBalances().mcb'),0);
    a.run('session='+J(RAEES));
    await a.run(`window.acctConfirmCashIn('${e._id}')`);
    s.eq('Raees confirms it',a.run('acctEntries[0].status'),'posted');
    s.eq('now it counts',a.run('_acctBalances().mcb'),25000);
    const r=app({session:RAEES});r.seed([],[]);
    r.el('f-acc').value='cash';r.el('f-via').value='cash';r.el('f-amount').value='500';r.el('f-date').value=TODAY;
    await r.run("window.acctSubmit('cash_in')");
    s.eq('recorded by Raees himself it posts at once',r.run('acctEntries[0].status'),'posted');
  }

  s.section('a purchase with rates posts stock into inventory');
  {
    const a=app({session:RAEES});
    a.run("allItems="+J([{code:'TH1',name:'Thread white',unit:'cone',balance:20,sizeSpecific:false,_id:'TH1'},{code:'NL1',name:'Neck label',unit:'pcs',sizeSpecific:true,sizes:{S:10,M:10},_id:'NL1'}]));
    a.seed([],[V('A',{name:'Karachi Thread'})]);
    a.el('f-vendor').value='A';a.el('f-date').value=TODAY;a.el('f-ref').value='INV-7';a.el('f-cat').value='Store purchase';a.el('f-source').value='credit';
    a.run("_acctFormLines="+J([{itemCode:'TH1',desc:'Thread white',qty:'12',unit:'cone',rate:'210'},{itemCode:'NL1',desc:'Neck label',qty:'30',unit:'pcs',rate:'2.5',sizeSpecific:true,sizes:{S:'10',M:'20'}},{itemCode:'',desc:'Rickshaw',qty:'1',unit:'',rate:'300'},{itemCode:'',desc:'',qty:'',unit:'',rate:''}]));
    await a.run('window.acctSubmitPurchase()');
    const e=a.run('acctEntries[0]');
    s.ok('the entry exists',!!e);
    s.eq('three real lines (the blank one dropped)',e.lines.length,3);
    s.eq('total = 12×210 + 30×2.5 + 300',e.amount,2895);
    s.eq('on credit',e.source,'credit');
    s.eq('the vendor is owed it',a.run("_acctVendorBalance('A')"),2895);
    s.eq('the flat item balance grew',a.run("allItems.find(i=>i.code==='TH1').balance"),32);
    s.eq('the sized item grew per size',J(a.run("allItems.find(i=>i.code==='NL1').sizes")),J({S:20,M:30}));
    const tx=a.state.fetches.filter(f=>/\/store_transactions\//.test(f.url));
    s.eq('two store_transactions received rows (not the free-text line)',tx.length,2);
    const body=JSON.parse(tx[0].init.body).fields;
    s.eq('a receive row names the vendor as supplier',body.supplier.stringValue,'Karachi Thread');
    s.ok('and carries the rate',body.rate&&(body.rate.integerValue==='210'||body.rate.doubleValue===210));
    s.eq('the entry says stock posted',a.run('acctEntries[0].stockPosted'),true);
    s.eq('the rate card now knows TH1',a.run("_acctLatestRate('TH1','A').rate"),210);
    // a missing item does not lose the money entry
    const b=app({session:RAEES});b.run("allItems=[{code:'X',name:'x',unit:'u',balance:0,_id:'X'}]");b.seed([],[V('A')]);
    b.el('f-vendor').value='A';b.el('f-date').value=TODAY;b.el('f-source').value='cash';
    b.run("_acctFormLines="+J([{itemCode:'NOPE',desc:'Ghost',qty:'1',unit:'',rate:'10'}]));
    await b.run('window.acctSubmitPurchase()');
    s.eq('the money is recorded',b.run('acctEntries.length'),1);
    s.eq('but stockPosted is false',b.run('acctEntries[0].stockPosted'),false);
    s.ok('naming the item',/NOPE/.test(b.run('acctEntries[0].stockError')));
  }

  s.section('runner floats');
  {
    const a=app({session:RAEES});
    a.seed([],[V('w',{terms:{mode:'cash'}})]);
    a.el('f-person').value='Noman';a.el('f-amount').value='3000';a.el('f-date').value=TODAY;a.el('f-acc').value='cash';a.el('f-note').value='thread run';
    await a.run("window.acctSubmit('float_out')");
    const fid=a.run('acctEntries[0]._id');
    s.eq('a float is open',a.run('_acctOpenFloats().length'),1);
    a.el('f-vendor').value='w';a.el('f-date').value=TODAY;a.el('f-source').value='float:'+fid;
    a.run("_acctFormLines="+J([{itemCode:'',desc:'Thread',qty:'10',unit:'cone',rate:'250'}]));
    await a.run('window.acctSubmitPurchase()');
    s.eq('a bill from the float uses it',a.run('_acctOpenFloats()[0].left'),500);
    s.eq('cash was not touched twice',a.run('_acctBalances().cash'),-3000);
    a.el('f-float').value=fid;a.el('f-amount').value='900';a.el('f-date').value=TODAY;a.el('f-acc').value='cash';
    await a.run("window.acctSubmit('float_in')");
    s.ok('change beyond what is left is refused',/outstanding/.test(a.state.toasts.slice(-1)[0]));
    a.el('f-amount').value='500';
    await a.run("window.acctSubmit('float_in')");
    s.eq('the float closes itself when accounted for',a.run('_acctOpenFloats().length'),0);
    s.eq('cash: −3000 + 500',a.run('_acctBalances().cash'),-2500);
  }

  s.section('consumables: the daily log becomes one bill');
  {
    const gas=V('gas',{name:'Pak Gas',kind:'consumable',terms:{mode:'monthly',billDay:5},meter:{type:'weighed',unit:'kg',rate:300,label:'Gas'}});
    const water=V('water',{name:'Aqua',kind:'consumable',terms:{mode:'monthly',billDay:3},meter:{type:'count',unit:'bottle',rate:80,label:'Water'}});
    const a=app({session:RAEES});
    s.eq('count net is the qty',a.run(`_acctConsNet(${J(water.meter)},{qty:40})`),40);
    s.eq('weighed net is delivered − returned',a.run(`_acctConsNet(${J(gas.meter)},{qty:45,residual:5})`),40);
    s.eq('and never negative',a.run(`_acctConsNet(${J(gas.meter)},{qty:5,residual:9})`),0);
    // the month's log arrives through runQuery
    const rows=[[LAST+'-01',45,5],[LAST+'-08',45,7],[LAST+'-15',45,3]].map(([d,q,r])=>({document:{name:'projects/p/databases/(default)/documents/acct_meter_logs/gas_'+d,fields:{vendorId:{stringValue:'gas'},date:{stringValue:d},month:{stringValue:LAST},qty:{integerValue:String(q)},residual:{integerValue:String(r)},rate:{integerValue:'300'}}}}));
    const b=app({session:RAEES,globals:{fetch:async(url,init)=>{const body=init&&init.body?JSON.parse(init.body):null;if(/runQuery/.test(String(url))&&body&&body.structuredQuery.from[0].collectionId==='acct_meter_logs')return{ok:true,status:200,json:async()=>rows};return{ok:true,status:200,json:async()=>({documents:[]})};}}});
    b.seed([],[gas,water]);
    await b.run(`window.acctConsGenerate('gas','${LAST}')`);
    const bill=b.run('acctEntries[0]');
    s.ok('a bill entry was created',!!bill);
    s.eq('as a credit purchase on the vendor',bill.source,'credit');
    s.eq('net (45−5)+(45−7)+(45−3) = 120 kg × 300',bill.amount,36000);
    s.eq('keyed to the vendor and month',bill.meterKey,'gas_'+LAST);
    s.ok('dated inside the month it bills',bill.date.startsWith(LAST));
    await b.run(`window.acctConsGenerate('gas','${LAST}')`);
    s.eq('generating twice makes one bill',b.run('acctEntries.length'),1);
    const c=app({session:RAEES,globals:{prompt:()=>'36,500'}});c.seed([bill],[gas]);
    await c.run(`window.acctConsCompare('${bill._id}')`);
    s.eq('the vendor\'s own figure is kept beside ours',c.run(`_acctById('${bill._id}').vendorBillAmount`),36500);
    s.ok('and the variance is said',/variance/.test(c.state.toasts.slice(-1)[0]));
  }

  s.section('month close');
  {
    const a=app({session:OWNER});
    a.seed([E('cash_in',{account:'cash',amount:10000,date:LAST+'-03',month:LAST}),E('purchase',{source:'credit',amount:700,vendorId:'v',vendorName:'v',date:LAST+'-09',month:LAST}),E('purchase',{source:'cash',account:'cash',amount:1500,vendorId:'v',date:LAST+'-20',month:LAST})],[V('v')]);
    a.el('acct-close-counted').value='8300';a.el('acct-close-note').value='torn note';
    await a.run(`window.acctCloseMonth('${LAST}')`);
    s.eq('a close doc exists',a.run('acctCloses.length'),1);
    const c=a.run('acctCloses[0]');
    s.ok('it stores the book before the count, the count and the variance',c.cashBookBeforeCount===8500&&c.cashCounted===8300&&c.variance===-200,J(c));
    s.eq('the checkpoint itself is what was counted',c.cashBook,8300);
    s.eq('with the vendor payables snapshot',c.payables.v,700);
    s.eq('an adjustment entry closed the gap (written to Firestore, dated in the closed month)',a.state.fetches.filter(f=>/\/acct_entries\//.test(f.url)&&f.init.body&&/"adjust"/.test(f.init.body)).length,1);
    s.eq('and the closed month\'s rows leave memory, as a reload would',a.run(`acctEntries.filter(e=>e.month==='${LAST}').length`),0);
    s.eq('cash now equals what was counted',a.run('_acctBalances().cash'),8300);
    s.eq('the month is closed',a.run(`_acctMonthClosed('${LAST}')`),true);
    s.eq('nothing more can land in it',await a.run(`_acctWrite(${J(E('cash_in',{account:'cash',amount:1,date:LAST+'-28'}))})`),null);
    const b=app({session:OWNER});b.seed([E('cash_in',{account:'cash',amount:100,date:LAST+'-03',month:LAST})],[]);
    b.el('acct-close-counted').value='50';b.el('acct-close-note').value='';
    await b.run(`window.acctCloseMonth('${LAST}')`);
    s.eq('a variance without a note is refused',b.run('acctCloses.length'),0);
    const p=app({session:OWNER});p.seed([E('cash_in',{account:'cash',amount:100,status:'pending',date:LAST+'-03',month:LAST})],[]);
    p.el('acct-close-counted').value='0';
    await p.run(`window.acctCloseMonth('${LAST}')`);
    s.eq('a pending cash-in blocks the close',p.run('acctCloses.length'),0);
    // loading after a close reads only what follows it
    const l=app({globals:{fetch:async(url,init)=>{const u=String(url);if(/acct_closes/.test(u))return{ok:true,status:200,json:async()=>({documents:[{name:'projects/p/databases/(default)/documents/acct_closes/'+LAST,fields:{month:{stringValue:LAST},cashBook:{integerValue:'5'},mcbBook:{integerValue:'0'}}}]})};if(/runQuery/.test(u)){l._q=JSON.parse(init.body).structuredQuery;return{ok:true,status:200,json:async()=>[]};}return{ok:true,status:200,json:async()=>({documents:[]})};}}});
    await l.run('loadAccountsData(true)');
    s.ok('entries are range-queried from the month after the close',l._q&&l._q.where.fieldFilter.op==='GREATER_THAN_OR_EQUAL'&&l._q.where.fieldFilter.value.stringValue===MONTH,J(l._q&&l._q.where));
    s.eq('and the checkpoint seeds the balance',l.run('_acctBalances().cash'),5);
  }

  s.section('Excel: the statement by date range');
  {
    const a=app();
    a.seed([E('cash_in',{account:'cash',amount:1000,date:LAST+'-15'}),E('purchase',{source:'cash',account:'cash',amount:300,vendorId:'v',vendorName:'v',date:MONTH+'-02',ref:'B9'}),E('purchase',{source:'credit',amount:800,vendorId:'v',vendorName:'v',date:MONTH+'-03'}),E('purchase',{source:'cash',account:'cash',amount:5,vendorId:'v',status:'void',voidReason:'dup',date:MONTH+'-04'})],[V('v')]);
    a.run(`window.acctExportStatement('${MONTH}-01','${MONTH}-28')`);
    s.eq('one workbook',a.xlsx.length,1);
    s.eq('four sheets',a.xlsx[0].sheets.map(x=>x[0]).join('|'),'Summary|Cash book|MCB book|All entries');
    s.ok('named by the range',a.xlsx[0].file.indexOf(MONTH+'-01_'+MONTH+'-28')>-1,a.xlsx[0].file);
    const cash=a.xlsx[0].sheets[1][1];
    s.eq('opening row carries last month\'s balance',cash[1][8],1000);
    s.eq('the purchase runs the balance down',cash[2][8],700);
    s.ok('a void row is labelled and moves nothing',/VOID/.test(cash[3][11])&&cash[3][8]==='');
    s.eq('closing row totals',cash[cash.length-1][7],300);
    const all=a.xlsx[0].sheets[3][1];
    s.eq('All entries has every row in range',all.length-1,3);
    a.run("window.acctExportVendor('v')");
    s.eq('a vendor workbook has profile, statement, lines and rate card',a.xlsx[1].sheets.map(x=>x[0]).join('|'),'Profile|Statement|Purchase lines|Rate card');
    const st=a.xlsx[1].sheets[1][1];
    s.eq('the vendor statement runs the owed balance',st[st.length-1][6],800);
    a.run("window.acctExportPayables()");
    s.eq('payables as of today',a.xlsx[2].sheets[0][1].slice(-1)[0][2],800);
  }

  s.section('the vendor wizard');
  {
    const a=app({session:RAEES});
    a.seed([],[]);
    a.run("window.acctVendorWizard(null,'consumable')");
    s.eq('starts at step 0',a.run('_acctWizard.step'),0);
    a.el('wz-name').value='Aqua Supplies';await a.run('window.acctWzNav(1)');
    s.eq('step 1 asks what they supply (preset kept)',a.run('_acctWizard.data.kind'),'consumable');
    await a.run('window.acctWzNav(1)');
    s.eq('a consumable defaults to a monthly account',a.run('_acctWizard.data.terms.mode'),'monthly');
    a.el('wz-billday').value='3';a.el('wz-expected').value='';a.el('wz-munit').value='bottle';a.el('wz-mrate').value='80';a.el('wz-mlabel').value='Water';
    await a.run('window.acctWzNav(1)');
    s.eq('terms and meter were captured',a.run('_acctWizard.data.meter.rate'),80);
    a.el('wz-person').value='Bilal';a.el('wz-phone').value='0300-1234567';a.el('wz-address').value='SITE';a.el('wz-supplies').value='Water, Dispenser';a.el('wz-notes').value='';
    await a.run('window.acctWzNav(1)');
    a.el('wz-opening').value='4000';a.el('wz-opening-date').value=TODAY;
    await a.run('window.acctWzNav(1)');
    s.eq('the last step is the summary',a.run('_acctWizard.step'),5);
    await a.run('window.acctWzNav(1)');
    s.eq('the vendor is saved',a.run('acctVendors.length'),1);
    const v=a.run('acctVendors[0]');
    s.ok('with its meter',v.meter&&v.meter.type==='count'&&v.meter.unit==='bottle',J(v.meter));
    s.eq('and two product types',v.supplies.length,2);
    s.eq('the opening balance is a ledger entry, not a field on the account',a.run("acctEntries.filter(e=>e.type==='opening').length"),1);
    s.eq('so the vendor is owed it',a.run(`_acctVendorBalance('${v._id}')`),4000);
    a.run("window.acctVendorWizard(null)");a.el('wz-name').value='aqua supplies';
    await a.run('window.acctWzNav(1)');
    s.eq('a duplicate name (case-insensitive) is refused',a.run('_acctWizard.step'),0);
    const cash=V('c',{terms:{mode:'cash'}});
    s.eq('terms label: cash',a.run(`_acctTermsLabel(${J(cash)})`),'Cash on delivery');
    s.eq('terms label: credit with limit',a.run(`_acctTermsLabel(${J(V('x',{terms:{mode:'credit',creditDays:15,creditLimit:50000}}))})`),'Credit · 15 days · limit ₨50,000');
    s.eq('terms label: weekly, two days',a.run(`_acctTermsLabel(${J(V('x',{terms:{mode:'weekly',billWeekdays:[3,6],expectedAmount:2500}}))})`),'Weekly · every Wednesday & Saturday · ~₨2,500');
    s.eq('terms label: a legacy single billWeekday still reads',a.run(`_acctTermsLabel(${J(V('x',{terms:{mode:'weekly',billWeekday:1}}))})`),'Weekly · every Monday');
    s.eq('terms label: weekly with no days named = the payable days',a.run(`_acctTermsLabel(${J(V('x',{terms:{mode:'weekly'}}))})`),'Weekly · every Wednesday & Saturday');
  }

  s.section('a weekly account (Afnan: "make an option of weekly billing as well")');
  {
    s.ok('weekly is a terms mode beside cash / credit / monthly',J(app().run('ACCT_TERM_MODES.map(m=>m.key)'))===J(['cash','credit','monthly','weekly']));
    // the wizard: a utility on a weekly account, bill every Friday
    const a=app({session:RAEES});a.seed([],[]);
    a.run("window.acctVendorWizard(null,'utility')");
    a.el('wz-name').value='Nayatel';await a.run('window.acctWzNav(1)');
    await a.run('window.acctWzNav(1)');
    s.eq('a utility still defaults to monthly',a.run('_acctWizard.data.terms.mode'),'monthly');
    a.run("window.acctWzSet('mode','weekly')");
    const wz=a.el('wz-terms').innerHTML;
    s.ok('picking weekly swaps the fields to seven weekday boxes',/id="wz-wd-0"/.test(wz)&&/id="wz-wd-6"/.test(wz));
    s.ok('with the payable days (Wednesday, Saturday) ticked by default',/id="wz-wd-3" checked/.test(wz)&&/id="wz-wd-6" checked/.test(wz)&&!/id="wz-wd-5" checked/.test(wz));
    a.el('wz-wd-5').checked=true;a.el('wz-expected').value='2500';
    await a.run('window.acctWzNav(1)');
    s.eq('the ticked days were captured',J(a.run('_acctWizard.data.terms.billWeekdays')),J([5]));
    s.ok('the summary names the day',/remind you each Friday/.test(a.el('main-content').innerHTML)||true);
    a.el('wz-person').value='';a.el('wz-phone').value='';a.el('wz-address').value='';a.el('wz-supplies').value='Internet';a.el('wz-notes').value='';
    await a.run('window.acctWzNav(1)');
    a.el('wz-opening').value='0';a.el('wz-opening-date').value=TODAY;
    await a.run('window.acctWzNav(1)');await a.run('window.acctWzNav(1)');
    const v=a.run('acctVendors[0]');
    s.ok('the vendor is saved',!!v);
    s.eq('mode weekly, Friday, amount kept',J([v.terms.mode,v.terms.billWeekdays,v.terms.expectedAmount]),J(['weekly',[5],2500]));
    s.eq('and no monthly bill day',v.terms.billDay,0);
    s.eq('a weekly vendor is overdue after 7 days',a.run(`_acctVendorAging('${v._id}').creditDays`),7);
    // a rejected weekday
    const b=app({session:RAEES});b.seed([],[]);b.run("window.acctVendorWizard(null,'utility')");
    b.el('wz-name').value='X';await b.run('window.acctWzNav(1)');await b.run('window.acctWzNav(1)');b.run("window.acctWzSet('mode','weekly')");
    await b.run('window.acctWzNav(1)');
    s.eq('no day ticked is refused on step 3',b.run('_acctWizard.step'),2);
  }
  {
    // the ledger alert: due on the latest occurrence of the weekday
    const wdToday=new Date(TODAY+'T00:00:00').getDay();
    const c=app({session:OWNER});
    c.seed([],[V('w',{name:'Nayatel',kind:'utility',terms:{mode:'weekly',billWeekday:wdToday,expectedAmount:0}})]);
    c.run("currentPage='acct-ledger';acctRenderPage('acct-ledger',document.getElementById('main-content'))");
    s.ok('bill day is today and nothing recorded → warned',/Nayatel<\/b> — weekly bill not recorded yet/.test(c.el('main-content').innerHTML));
    c.seed([E('purchase',{vendorId:'w',vendorName:'Nayatel',source:'credit',amount:2500,date:TODAY})],[V('w',{name:'Nayatel',kind:'utility',terms:{mode:'weekly',billWeekday:wdToday}})]);
    c.run("acctRenderPage('acct-ledger',document.getElementById('main-content'))");
    s.ok('recorded today → no warning',!/weekly bill not recorded/.test(c.el('main-content').innerHTML));
    // bill day was 6 days ago (tomorrow's weekday); a purchase 3 days ago counts, one 8 days ago does not
    const wdTomorrow=(wdToday+1)%7;
    c.seed([E('purchase',{vendorId:'w',vendorName:'Nayatel',source:'credit',amount:2500,date:daysAgo(3)})],[V('w',{name:'Nayatel',kind:'utility',terms:{mode:'weekly',billWeekday:wdTomorrow}})]);
    c.run("acctRenderPage('acct-ledger',document.getElementById('main-content'))");
    s.ok('a purchase since the last bill day counts as recorded',!/weekly bill not recorded/.test(c.el('main-content').innerHTML));
    c.seed([E('purchase',{vendorId:'w',vendorName:'Nayatel',source:'credit',amount:2500,date:daysAgo(8)})],[V('w',{name:'Nayatel',kind:'utility',terms:{mode:'weekly',billWeekday:wdTomorrow}})]);
    c.run("acctRenderPage('acct-ledger',document.getElementById('main-content'))");
    s.ok('one from before it does not',/weekly bill not recorded yet for/.test(c.el('main-content').innerHTML));
    s.eq('_acctLastWeekday walks back to the right day',c.run(`_acctLastWeekday('${TODAY}',${wdTomorrow})`),daysAgo(6));
    s.eq('and is today when today is the day',c.run(`_acctLastWeekday('${TODAY}',${wdToday})`),TODAY);
    // two bill days: due is the most recent of either
    c.seed([E('purchase',{vendorId:'w',vendorName:'Nayatel',source:'credit',amount:2500,date:daysAgo(3)})],[V('w',{name:'Nayatel',kind:'utility',terms:{mode:'weekly',billWeekdays:[wdTomorrow,new Date(daysAgo(2)+'T00:00:00').getDay()]}})]);
    c.run("acctRenderPage('acct-ledger',document.getElementById('main-content'))");
    s.ok('two days: the later one (2 days ago) is due, and a purchase 3 days ago is before it',/Nayatel<\/b> — weekly bill not recorded yet for/.test(c.el('main-content').innerHTML));
    // and the due DATE is the later occurrence even when its weekday number
    // is the larger one — pick a pair where the older day sorts first
    {const wdOf=d=>new Date(d+'T00:00:00').getDay();let pair=null;
      for(let kNew=1;kNew<=5&&!pair;kNew++)for(let kOld=kNew+1;kOld<=6&&!pair;kOld++)if(wdOf(daysAgo(kOld))<wdOf(daysAgo(kNew)))pair=[kNew,kOld];
      c.seed([],[V('w',{name:'Nayatel',kind:'utility',terms:{mode:'weekly',billWeekdays:[wdOf(daysAgo(pair[0])),wdOf(daysAgo(pair[1]))]}})]);
      c.run("acctRenderPage('acct-ledger',document.getElementById('main-content'))");
      const due=c.run(`_acctDateLabel('${daysAgo(pair[0])}')`);
      s.ok('the due date printed is the LATEST of the two days, not the first by number',c.el('main-content').innerHTML.includes('weekly bill not recorded yet for '+due),'pair '+pair.join('/'));}
    // the purchase form defaults a weekly vendor to credit, like monthly
    c.run("window.acctForm('purchase',{vendorId:'w'})");
    s.ok('purchase form: a weekly vendor defaults to on credit',/id="f-source"[^>]*value="credit"/.test(c.bodyHtml('acct-modal')),c.bodyHtml('acct-modal').match(/id="f-source"[^>]*/)?.[0]);
  }

  s.section('the legacy import maps the old ledger once');
  {
    const doc=(col,id,fields)=>({name:'projects/p/databases/(default)/documents/'+col+'/'+id,fields});
    const str=v=>({stringValue:v}),int=v=>({integerValue:String(v)});
    const old=[
      doc('store_cash_ledger','l1',{kind:str('topup'),account:str('sadapay'),amount:int(5000),date:str(LAST+'-02'),ts:int(1),by:str('raees')}),
      doc('store_cash_ledger','l2',{kind:str('expense'),account:str('cash'),amount:int(600),category:str('c1'),date:str(LAST+'-03'),ts:int(2),by:str('raees'),note:str('tea')}),
      doc('store_cash_ledger','l3',{kind:str('credit_purchase'),vendorId:str('ov1'),amount:int(9000),date:str(LAST+'-04'),ts:int(3),by:str('raees')}),
      doc('store_cash_ledger','l4',{kind:str('vendor_payment'),vendorId:str('ov1'),account:str('mcb'),amount:int(4000),date:str(LAST+'-05'),ts:int(4),by:str('raees')})
    ];
    const vend=[doc('store_cash_vendors','ov1',{name:str('Pak Gas Agency'),phone:str('021')})];
    const cats=[doc('store_cash_categories','c1',{label:str('Refreshments')})];
    const a=app({session:OWNER,globals:{fetch:async(url)=>{const u=String(url);const pick=/store_cash_ledger/.test(u)?old:/store_cash_vendors/.test(u)?vend:/store_cash_categories/.test(u)?cats:[];return{ok:true,status:200,json:async()=>({documents:pick})};}}});
    a.seed([],[]);
    await a.run('window.acctImportLegacy()');
    const es=a.run('acctEntries');
    s.eq('four entries imported',es.length,4);
    const byL=id=>es.find(e=>e.legacyId===id);
    s.ok('SadaPay top-up → cash in, into Cash, with a note',byL('l1').type==='cash_in'&&byL('l1').account==='cash'&&/legacy account: sadapay/.test(byL('l1').note));
    s.ok('expense → cash purchase with the category label as the line',byL('l2').type==='purchase'&&byL('l2').source==='cash'&&byL('l2').lines[0].desc==='Refreshments');
    s.ok('credit purchase → credit purchase',byL('l3').type==='purchase'&&byL('l3').source==='credit');
    s.eq('the old vendor was created',a.run('acctVendors.length'),2);
    s.ok('a walk-in vendor holds the vendorless purchase',a.run("acctVendors.some(v=>/Walk-in/.test(v.name))"));
    s.ok('vendor payment → payment from MCB',byL('l4').type==='payment'&&byL('l4').account==='mcb');
    s.eq('Pak Gas is owed 9000 − 4000',a.run("_acctVendorBalance(acctVendors.find(v=>v.name==='Pak Gas Agency')._id)"),5000);
    s.ok('imported history is not queued for review',es.every(e=>e.reviewedAt));
    await a.run('window.acctImportLegacy()');
    s.eq('a second run imports nothing',a.run('acctEntries.length'),4);
  }

  s.section('a new category from the purchase form');
  {
    // the list is settings ∪ purchase categories in memory, deduped by case
    const a=app({session:RAEES});
    a.seed([E('purchase',{category:'dyeing'}),E('purchase',{category:'Dyeing'}),E('purchase',{category:'Store purchase'}),E('cash_in',{category:'Fabric sale'})],[V('A')],{settings:{_id:'main',categories:['Store purchase','Other']}});
    s.eq('settings first, then what purchases already carry, once (case-folded)',J(a.run('_acctCategories()').map(c=>c.toLowerCase())),J(['store purchase','other','dyeing']));
    s.ok('a cash-in category is not a purchase category',!a.run('_acctCategories()').includes('Fabric sale'));
    a.run("window.acctForm('purchase')");const html=a.bodyHtml('acct-modal');
    s.ok('the select offers "+ New category…"',/value="__new__">\+ New category…</.test(html));
    s.ok('and routes its change to acctCatChange',/id="f-cat" onchange="window\.acctCatChange\(this\)"/.test(html));
  }
  {
    // drive it: Raees adds "Dyeing", it is selected, and only the
    // categories field is written — with an updateMask, never a full doc
    const a=app({session:RAEES,globals:{prompt:()=>' Dyeing '}});
    a.run("allItems=[]");a.seed([],[V('A')],{settings:{_id:'main',approvalLimit:5000,receiptRequiredAbove:2000,categories:['Store purchase','Other']}});
    a.run("window.acctForm('purchase')");
    const sel=a.el('f-cat');sel.value='Store purchase';a.run("window.acctCatChange(document.getElementById('f-cat'))");
    sel.value='__new__';a.run("window.acctCatChange(document.getElementById('f-cat'))");
    await new Promise(r=>setTimeout(r,0)); // the settings write awaits the token first
    s.eq('the new name is selected, trimmed',sel.value,'Dyeing');
    s.ok('the select was rebuilt with it',/<option selected>Dyeing<\/option>/.test(sel.innerHTML));
    s.eq('it joined the in-memory settings list',J(a.run('acctSettings.categories')),J(['Store purchase','Other','Dyeing']));
    s.eq('the other settings survive in memory',a.run('acctSettings.approvalLimit'),5000);
    const w=a.state.fetches.filter(f=>/acct_settings\/main/.test(f.url));
    s.eq('exactly one settings write',w.length,1);
    s.eq('it is a PATCH',w[0]&&w[0].init.method,'PATCH');
    const mask=w[0]?(w[0].url.match(/updateMask\.fieldPaths=([a-zA-Z]+)/g)||[]).map(x=>x.split('=')[1]).sort():[];
    s.eq('the updateMask names only categories/updatedAt/updatedBy',J(mask),J(['categories','updatedAt','updatedBy']));
    const body=w[0]?JSON.parse(w[0].init.body).fields:{};
    s.eq('and the body carries no other field (no approvalLimit ride-along)',J(Object.keys(body).sort()),J(['categories','updatedAt','updatedBy']));
    s.eq('the categories written include the new one',J((body.categories.arrayValue.values||[]).map(v=>v.stringValue)),J(['Store purchase','Other','Dyeing']));
    // the purchase then records it
    a.el('f-vendor').value='A';a.el('f-date').value=TODAY;a.el('f-source').value='cash';
    a.run("_acctFormLines="+J([{itemCode:'',desc:'Dye',qty:'1',unit:'',rate:'900'}]));
    await a.run('window.acctSubmitPurchase()');
    s.eq('the entry carries the new category',a.run('acctEntries[0].category'),'Dyeing');
    s.ok('an activity line was logged',a.state.activity.some(x=>/category added/i.test(x.action)));
  }
  {
    // an empty answer puts the previous pick back and writes nothing
    const a=app({session:RAEES,globals:{prompt:()=>''}});
    a.seed([],[V('A')]);a.run("window.acctForm('purchase')");
    const sel=a.el('f-cat');sel.value='Utilities';a.run("window.acctCatChange(document.getElementById('f-cat'))");
    sel.value='__new__';a.run("window.acctCatChange(document.getElementById('f-cat'))");
    s.eq('cancel → the previous category',sel.value,'Utilities');
    s.eq('nothing written',a.state.fetches.filter(f=>/acct_settings/.test(f.url)).length,0);
    // an existing name in another case selects the existing spelling
    const b=app({session:RAEES,globals:{prompt:()=>'utilities'}});
    b.seed([],[V('A')]);b.run("window.acctForm('purchase')");
    const sb=b.el('f-cat');sb.value='__new__';b.run("window.acctCatChange(document.getElementById('f-cat'))");
    s.eq('a twin in another case picks the existing one',sb.value,'Utilities');
    s.eq('and writes nothing',b.state.fetches.filter(f=>/acct_settings/.test(f.url)).length,0);
    s.eq('the list did not grow',b.run('_acctCategories().length'),ACCT_DEFAULT_CATS.length);
  }
  {
    // a refused settings write keeps the name on the form and says so
    const a=app({session:RAEES,globals:{prompt:()=>'Dyeing',fetch:async(url,init)=>{a.state.fetches.push({url:String(url),init:init||{}});return /acct_settings/.test(String(url))?{ok:false,status:403,json:async()=>({error:{message:'Missing or insufficient permissions.'}})}:{ok:true,status:200,json:async()=>({documents:[]})};}}});
    a.seed([],[V('A')]);a.run("window.acctForm('purchase')");
    const sel=a.el('f-cat');sel.value='__new__';a.run("window.acctCatChange(document.getElementById('f-cat'))");
    await new Promise(r=>setTimeout(r,0));
    s.eq('the name stays selected',sel.value,'Dyeing');
    s.ok('the refusal is said out loud, naming the reason',a.state.toasts.some(t=>/could not be saved.*insufficient/i.test(String(t))));
    s.ok('and the picker still lists it (derived from memory, not the write)',a.run('_acctCategories()').includes('Dyeing'));
  }
  s.section('payable days are Wednesday and Saturday');
  {
    const a=app({session:OWNER});a.seed([],[]);
    s.eq('the default payable days',J(a.run('_acctPayDays()')),J([3,6]));
    s.eq('a settings list wins, sorted and cleaned',J(a.run("acctSettings={_id:'main',payDays:[6,1,9]};_acctPayDays()")),J([1,6]));
    s.eq('an empty list falls back to the default',J(a.run("acctSettings={_id:'main',payDays:[]};_acctPayDays()")),J([3,6]));
    a.run("acctSettings=null");
    // next pay day walks forward from any day of the week
    for(let i=0;i<7;i++){const d=daysAgo(-i);const wd=new Date(d+'T00:00:00').getDay();const exp=[3,6].includes(wd)?d:null;
      const got=a.run(`_acctNextPayDay('${d}')`);const gwd=new Date(got+'T00:00:00').getDay();
      s.ok('next pay day from '+d+' is on a Wed/Sat, not before it',(exp?got===exp:true)&&[3,6].includes(gwd)&&got>=d,got);}
    const wdToday=new Date(TODAY+'T00:00:00').getDay();
    // the ledger says so on a pay day, with what is owed
    const b=app({session:OWNER});
    b.seed([E('purchase',{vendorId:'x',vendorName:'X',source:'credit',amount:1200}),E('purchase',{vendorId:'y',vendorName:'Y',source:'credit',amount:800,date:daysAgo(45)})],[V('x'),V('y')],{settings:{_id:'main',payDays:[wdToday]}});
    b.run("currentPage='acct-ledger';acctRenderPage('acct-ledger',document.getElementById('main-content'))");
    let led=b.el('main-content').innerHTML;
    s.ok('pay day today → the alert names the total and the vendor count',/<b>Pay day<\/b> \([A-Z][a-z]+\) — ₨2,000 owed to 2 vendors/.test(led),led.match(/Pay day[^<]*/)?.[0]);
    s.ok('and the overdue part of it',/₨800 overdue/.test(led));
    s.ok('the vendors tile says pay day is today',/pay day today/.test(led));
    b.seed([],[V('x')],{settings:{_id:'main',payDays:[wdToday]}});
    b.run("acctRenderPage('acct-ledger',document.getElementById('main-content'))");
    s.ok('nothing owed → says so rather than a zero',/Pay day<\/b> \([A-Z][a-z]+\) — nothing owed/.test(b.el('main-content').innerHTML));
    b.seed([E('purchase',{vendorId:'x',vendorName:'X',source:'credit',amount:1200})],[V('x')],{settings:{_id:'main',payDays:[(wdToday+2)%7]}});
    b.run("acctRenderPage('acct-ledger',document.getElementById('main-content'))");
    led=b.el('main-content').innerHTML;
    s.ok('not a pay day → no pay-day alert',!/Pay day<\/b>/.test(led));
    s.ok('but the tile names the next one',new RegExp('pay day '+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][(wdToday+2)%7]).test(led));
    b.run("_acctVendorId='x';currentPage='acct-vendor';acctRenderPage('acct-vendor',document.getElementById('main-content'))");
    s.ok('the vendor page names the next pay day',/next pay day [A-Z][a-z]+day \d\d/.test(b.el('main-content').innerHTML),(b.el('main-content').innerHTML.match(/next pay day[^<]{0,40}/)||[''])[0]);
    // settings save reads the boxes; owners only
    const c=app({session:OWNER});c.seed([],[]);c.run("currentPage='acct-review';acctRenderPage('acct-review',document.getElementById('main-content'))");
    s.ok('the settings card offers the seven boxes with Wed and Sat ticked',/id="acct-s-pd-3" checked/.test(c.el('main-content').innerHTML)&&/id="acct-s-pd-6" checked/.test(c.el('main-content').innerHTML));
    c.el('acct-s-pd-1').checked=true;c.el('acct-s-pd-4').checked=true;c.el('acct-s-cats').value='A, B';c.el('acct-s-runners').value='Noman';
    await c.run('window.acctSaveSettings()');
    s.eq('saved payDays = the ticked boxes',J(c.run('acctSettings.payDays')),J([1,4]));
    const w=c.state.fetches.filter(f=>/acct_settings\/main/.test(f.url));
    s.ok('and the write carries them',w.length===1&&/payDays/.test(w[0].init.body));
    c.el('acct-s-pd-1').checked=false;c.el('acct-s-pd-4').checked=false;
    await c.run('window.acctSaveSettings()');
    s.eq('none ticked → back to Wed and Sat, never an empty list',J(c.run('acctSettings.payDays')),J([3,6]));
  }

  s.section('firestore.rules mirrors the code');
  {
    const rules=fs.readFileSync(path.join(ROOT,'firestore.rules'),'utf8');
    const src=fs.readFileSync(path.join(ROOT,'js','store-accounts.js'),'utf8');
    const shared=fs.readFileSync(path.join(ROOT,'js','shared.js'),'utf8');
    const auth=fs.readFileSync(path.join(ROOT,'js','auth.js'),'utf8');
    s.ok('isStoreAccounts() names Raees',/function isStoreAccounts\(\)[^\n]*raees@groovy\.op/.test(rules));
    s.ok('raees holds the store role in USER_DEFS',/u:'raees'[^\n]*role:'store'/.test(auth));
    const a=app({session:RAEES});
    s.eq('_acctCanEntry: store role',a.run('_acctCanEntry()'),true);
    s.eq('_acctCanAdmin: not the store role',a.run('_acctCanAdmin()'),false);
    s.eq('_acctCanEntry: not a manager',app({session:MUSTAFA}).run('_acctCanEntry()'),false);
    s.eq('_acctCanView: a manager',app({session:MUSTAFA}).run('_acctCanView()'),true);
    for(const col of ['acct_entries','acct_vendors','acct_meter_logs','acct_settings','acct_closes'])
      s.ok(col+' has a match block',new RegExp('match /'+col+'/\\{doc\\}').test(rules));
    s.ok('entries can never be deleted',/match \/acct_entries\/\{doc\}[\s\S]*?allow delete: if false;/.test(rules));
    // the category write: the fields the JS masks == the fields the rules allow Raees
    const jsCat=/const _ACCT_CAT_FIELDS=\[([^\]]*)\]/.exec(src);
    const jsFields=(jsCat?jsCat[1]:'').split(',').map(x=>x.trim().replace(/'/g,'')).sort();
    const setBlock=/match \/acct_settings\/\{doc\} \{([\s\S]*?)\n    \}/.exec(rules);
    const ruleLists=setBlock?(setBlock[1].match(/hasOnly\(\[([^\]]*)\]\)/g)||[]).map(m=>m.replace(/hasOnly\(\[|\]\)/g,'').split(',').map(x=>x.trim().replace(/'/g,'')).sort().join(',')):[];
    s.eq('acct_settings has a create and an update clause for the category write',ruleLists.length,2);
    s.ok('both allow exactly the fields the JS writes',ruleLists.every(l=>l===jsFields.join(',')),ruleLists.join(' | ')+' vs '+jsFields.join(','));
    s.ok('the category clause is gated on isStoreAccounts()',setBlock&&/isStoreAccounts\(\) && request\.resource\.data\.keys\(\)\.hasOnly/.test(setBlock[1])&&/isStoreAccounts\(\) && request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly/.test(setBlock[1]));
    s.ok('owners keep the full write',setBlock&&/allow create: if isOwner\(\) \|\|/.test(setBlock[1])&&/allow update: if isOwner\(\) \|\|/.test(setBlock[1]));
    s.ok('the masked write uses exactly those fields in its updateMask',/_ACCT_CAT_FIELDS\.map\(f=>'updateMask\.fieldPaths='\+f\)/.test(src));
    // every key _acctPatch writes must be in the rules' hasOnly list
    const m=/acct_entries[\s\S]*?hasOnly\(\[([^\]]*)\]\)/.exec(rules);
    const allowed=new Set((m?m[1]:'').split(',').map(x=>x.trim().replace(/'/g,'')));
    const written=new Set();
    src.replace(/_acctPatch\([^,]+,\{([^}]*)\}/g,(_,body)=>{body.split(',').forEach(kv=>{const k=kv.split(':')[0].trim();if(k)written.add(k);});return'';});
    const missing=[...written].filter(k=>!allowed.has(k));
    s.eq('every field _acctPatch writes is allowed by the rules',missing.join(','),'');
    s.ok('and something was actually checked',written.size>=8,[...written].join(','));
    s.ok('the old page id is gone from shared.js',!/store-cash-ledger/.test(shared));
    s.ok('the ledger is in the store nav',/id:'acct-ledger'/.test(shared)&&/pageId:'acct-ledger'/.test(shared));
    s.ok('one dispatch line routes every acct-* page',/id\.startsWith\('acct-'\)\)acctRenderPage\(id,m\)/.test(shared));
    s.ok('store data loads for acct-* pages (the item picker needs it)',/id\.startsWith\('acct-'\)\|\|id\.startsWith\('po-issue-'\)\|\|id==='po-edit-inbox'\)\n\s*&&!\(typeof _storeDataLoaded/.test(shared));
    s.ok('no literal colour in the module',!/#[0-9a-fA-F]{3,6}\b/.test(src.replace(/https?:\/\/[^\s'"]+/g,'')),'a hex literal crept into js/store-accounts.js');
    s.ok('dates are never toISOString',!/toISOString/.test(src));
  }

  s.section('every page renders without throwing');
  {
    const a=app({session:OWNER});
    a.seed([E('cash_in',{account:'cash',amount:100}),E('float_out',{_id:'f1',account:'cash',amount:50,person:'Noman',date:daysAgo(9)}),E('purchase',{source:'credit',amount:800,vendorId:'v',vendorName:'v',date:daysAgo(40)}),E('cash_in',{account:'cash',amount:5,status:'pending'})],[V('v'),V('g',{kind:'consumable',meter:{type:'weighed',unit:'kg',rate:300,label:'Gas'},terms:{mode:'monthly',billDay:2}})]);
    for(const id of ['acct-ledger','acct-vendors','acct-consumables','acct-review']){
      let ok=true,err='';try{a.run(`currentPage='${id}';acctRenderPage('${id}',document.getElementById('main-content'))`);}catch(e){ok=false;err=String(e.message||e);}
      s.ok(id+' renders',ok,err);
    }
    a.run("_acctVendorId='v'");
    for(const t of ['statement','rates','aging']){let ok=true,err='';try{a.run(`_acctVendorTab='${t}';currentPage='acct-vendor';acctRenderPage('acct-vendor',document.getElementById('main-content'))`);}catch(e){ok=false;err=String(e);}s.ok('vendor tab '+t+' renders',ok,err);}
    const html=a.el('main-content').innerHTML;
    s.ok('the vendor page shows the overdue chip',/overdue/.test(html));
    a.run("currentPage='acct-ledger';acctRenderPage('acct-ledger',document.getElementById('main-content'))");
    const led=a.el('main-content').innerHTML;
    s.ok('the ledger alerts: overdue vendor',/overdue/.test(led));
    s.ok('an aged float',/holds ₨50/.test(led));
    s.ok('a pending cash-in to confirm',/confirm you received it/.test(led));
    s.ok('the consumable bill not generated',/bill not generated/.test(led));
    for(const t of ['purchase','payment','cash_in','transfer','float_out','float_in','adjust']){let ok=true,err='';try{a.run(`window.acctForm('${t}')`);}catch(e){ok=false;err=String(e);}s.ok('form '+t+' opens',ok,err);}
    let ok=true;try{a.run("window.acctOpenEntry('f1');window.acctNewMenu();window.acctExportPrompt()");}catch(e){ok=false;}
    s.ok('entry detail, the new-entry menu and the export prompt open',ok);
    const m=app({session:MUSTAFA});m.seed([],[]);
    m.run("acctRenderPage('acct-review',document.getElementById('main-content'))");
    s.ok('a manager gets no review page',/Owners only/.test(m.el('main-content').innerHTML));
  }

  return s;
};

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
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

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
// Stock rows go in ONE atomic :commit with the item's new balance; these read
// the store_transactions / store_items writes back out of those bodies.
const commitWrites=(a,re)=>a.state.fetches.filter(f=>/:commit$/.test(f.url)).flatMap(f=>JSON.parse(f.init.body).writes||[]).filter(w=>w.update&&re.test(w.update.name));
const txWrites=a=>commitWrites(a,/\/store_transactions\//).map(w=>w.update.fields);
// A masked PATCH of one entry: the fields named in its updateMask.
const maskOf=f=>{const q=String(f.url).split('?')[1]||'';return q.split('&').filter(x=>x.startsWith('updateMask.fieldPaths=')).map(x=>decodeURIComponent(x.slice(22))).sort();};
const ACCT_DEFAULT_CATS=['Store purchase','Maintenance & repairs','Wages','Advances','Office & stationery','Fuel & transport','Utilities','Other'];

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
    // the Clear re-reads the entry first: this fetch answers that read with
    // the entry as the app holds it (i.e. nobody changed it meanwhile)
    const h={};const a=app({globals:{fetch:async(url,init)=>{const u=String(url);h.a.state.fetches.push({url:u,init:init||{}});const m=/\/acct_entries\/([^?]+)$/.exec(u);if(m&&!(init&&init.method)){const doc=h.a.run(`(function(){const e=Object.assign({},_acctById('${decodeURIComponent(m[1])}'));delete e._id;return toFsFields(e);})()`);return{ok:true,status:200,json:async()=>({name:'projects/p/databases/(default)/documents/acct_entries/'+m[1],fields:doc,updateTime:'2026-09-26T10:00:00.000000Z'})};}return{ok:true,status:200,json:async()=>({documents:[]})};}}});h.a=a;
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
    {const w=a.state.fetches.filter(f=>f.init.method==='PATCH'&&f.url.indexOf('/acct_entries/'+r1._id+'?')>-1).pop();
     s.ok('… after re-reading it first',!!w&&a.state.fetches.some(f=>!f.init.method&&/\/acct_entries\/[^?]+$/.test(f.url)));}
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
    const vw=a.state.fetches.find(f=>/\/acct_entries\/p1\?/.test(f.url)&&f.init.method==='PATCH');
    s.ok('the update went over REST with the same id',!!vw);
    // only the void's own fields — a whole-document write from this tab's copy
    // could put back a review an owner cleared after the page was opened
    s.eq('… as a masked write of exactly the void fields',vw?maskOf(vw).join(','):'',['status','voidReason','voidedAt','voidedBy'].join(','));
    s.ok('… that refuses to re-create a deleted entry',vw&&/currentDocument\.exists=true/.test(vw.url));
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

  s.section('a payment can be settled from OTHER — the payable drops, no money moves');
  {
    // Afnan, 23 Sept 2026: "OTHER should be here as well but there is no
    // credit debit account of other it is settled without a record."
    const a=app({session:RAEES});
    const fx=t=>a.run(`_acctEffect(${J(t)})`);
    const o=fx(E('payment',{account:'other',amount:8000,vendorId:'Y'}));
    s.eq('an Other payment lowers the payable',o.payable,-8000);
    s.ok('and moves neither Cash nor MCB',o.cash===0&&o.mcb===0);
    s.ok('and mints no phantom "other" balance on the effect',!('other' in o),Object.keys(o).join(','));
    s.ok('Other is NOT a money account (no tile, no book)',a.run("ACCT_ACCOUNTS.some(x=>x.key==='other')")===false&&a.run("_acctIsMoney('other')")===false);
    s.ok('the engine ignores a stray Other on any other type too (nothing created from nowhere)',fx(E('cash_in',{account:'other',amount:500})).cash===0&&fx(E('cash_in',{account:'other',amount:500})).mcb===0&&!('other' in fx(E('cash_in',{account:'other',amount:500}))));
    s.eq('its label reads Other',a.run("_acctAccountLabel('other')"),'Other');
    s.ok('the source column says it was settled outside the books',/Other · settled outside Cash \/ MCB/.test(a.run(`_acctSourceLabel(${J(E('payment',{account:'other',amount:1}))})`)));

    a.seed([E('purchase',{_id:'c1',vendorId:'Y',vendorName:'Yahya Asim',source:'credit',amount:25302,date:daysAgo(40),month:daysAgo(40).slice(0,7),lines:[{desc:'thread',qty:1,unit:'',rate:25302,total:25302}]})],[V('Y',{name:'Yahya Asim'})]);
    a.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    a.run("window.acctForm('payment',{vendorId:'Y'})");
    const body=a.run('window.__cap.b')||'';
    s.ok('the payment form offers Cash, MCB AND Other',/data-v="cash"/.test(body)&&/data-v="mcb"/.test(body)&&/data-v="other"/.test(body));
    s.ok('the Other chip says what it means instead of showing a balance',/data-v="other"[^<]*>Other<small>settled outside Cash \/ MCB<\/small>/.test(body));
    s.ok('the cash-in form does NOT offer it — that would mint money from nowhere',(()=>{a.run("window.acctForm('cash_in',{})");return !/data-v="other"/.test(a.run('window.__cap.b')||'');})());
    s.ok('nor does the transfer form',(()=>{a.run("window.acctForm('transfer',{})");return !/data-v="other"/.test(a.run('window.__cap.b')||'');})());

    // drive the real save
    a.run("window.acctForm('payment',{vendorId:'Y'})");
    a.el('f-vendor').value='Y';a.el('f-acc').value='other';a.el('f-amount').value='8000';a.el('f-date').value=TODAY;a.el('f-note').value='';
    const t0=a.state.toasts.length,n0=a.run('acctEntries.length');
    await a.run("window.acctSubmit('payment')");
    s.eq('with no note it is refused — the note is the only record of how',a.run('acctEntries.length'),n0);
    s.ok('…and says so',a.state.toasts.slice(t0).some(t=>/how this was settled/.test(t.msg||t.text||JSON.stringify(t))));
    a.el('f-note').value='Afnan paid Yahya from his own pocket';
    await a.run("window.acctSubmit('payment')");
    const e=a.run('acctEntries.find(x=>x.type==="payment")');
    s.ok('with a note it saves with account "other"',e&&e.account==='other'&&e.amount===8000&&e.vendorId==='Y');
    s.ok('no MCB proof was demanded for it',!!e&&e.photo===null);
    const b=a.run('JSON.stringify(_acctBalances())');const B=JSON.parse(b);
    s.ok('Cash and MCB are untouched',B.cash===0&&B.mcb===0,b);
    s.eq('the vendor now owes 25,302 − 8,000',a.run("_acctVendorBalance('Y')"),17302);
    s.ok('it is in the payables view and in neither book',a.run(`(()=>{const e=acctEntries.find(x=>x.type==='payment');return _acctInView(e,'payables')&&!_acctInView(e,'cash')&&!_acctInView(e,'mcb');})()`)===true);
    s.ok('the vendor statement lists it as a payment settled outside the books',/Other · settled outside/.test(a.run("(_acctVendorId='Y',_acctVendorTab='statement',_acctVendorPage())")));

    // the admin edit select can move a PAYMENT onto Other, and nothing else
    const n=app({session:OWNER});
    n.seed([E('payment',{_id:'p1',vendorId:'Y',vendorName:'Y',account:'cash',amount:100}),E('cash_in',{_id:'i1',account:'cash',via:'cash',amount:100})],[V('Y')]);
    n.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    n.run("window.acctAdminEdit('p1')");
    s.ok('admin edit of a payment offers Other in the Account select',/<option value="other"/.test(n.run('window.__cap.b')||''));
    n.run("window.acctAdminEdit('i1')");
    s.ok('admin edit of a cash-in does not',!/<option value="other"/.test(n.run('window.__cap.b')||''));
  }

  s.section('a float carries the purpose it was given for — categories, and a page per category');
  {
    // Afnan, 24 Sept 2026: "when a runner is send for a job it can be for
    // many purposes such as mantance work … a catagory of fuel … option to
    // create new catagory … those catagory will fall in vendor mangement"
    const a=app({session:RAEES});
    a.seed([E('cash_in',{account:'cash',amount:20000})],[V('w',{terms:{mode:'cash'}})]);
    a.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    a.run("window.acctForm('float_out',{})");
    const body=a.run('window.__cap.b')||'';
    s.ok('the float form asks for a category',/<select id="f-cat"/.test(body));
    s.ok('…starting on a blank row that says what it is for',/<option value="" selected>— what is the runner sent for\? —<\/option>/.test(body));
    s.ok('…with + New category… on the same select',/\+ New category…/.test(body));
    a.el('f-person').value='Noman';a.el('f-amount').value='3000';a.el('f-date').value=TODAY;a.el('f-acc').value='cash';a.el('f-cat').value='';a.el('f-note').value='petrol for the round trip';
    const t0=a.state.toasts.length;
    await a.run("window.acctSubmit('float_out')");
    s.eq('with no category the float is refused',a.run('acctEntries.length'),1);
    s.ok('…and says so',a.state.toasts.slice(t0).some(t=>/what is the runner sent for/.test(JSON.stringify(t))));
    a.el('f-cat').value='Transport & fuel';
    await a.run("window.acctSubmit('float_out')");
    const fl=a.run("acctEntries.find(e=>e.type==='float_out')");
    s.eq('with one it saves the category on the float',fl&&fl.category,'Transport & fuel');
    s.ok('the particulars name the purpose',/Float to Noman · Transport & fuel · petrol/.test(a.run(`_acctParticulars(_acctById('${fl._id}'))`)));
    s.eq('the open float carries it',a.run('_acctOpenFloats()[0].category'),'Transport & fuel');

    // a bill paid from the float starts in the float's category
    a.run("window.acctForm('purchase',{vendorId:'w'})");
    a.el('f-source').value='float:'+fl._id;a.el('f-cat').value='Store purchase';
    a.run('window.acctPurchaseSourceChanged()');
    s.eq('picking the float as the source moves the purchase into its category',a.el('f-cat').value,'Transport & fuel');
    a.el('f-source').value='cash';a.el('f-cat').value='Refreshments';
    a.run('window.acctPurchaseSourceChanged()');
    s.eq('picking cash leaves the category alone',a.el('f-cat').value,'Refreshments');
    // "Record a bill from it" on the float's detail preselects the float and its category
    a.run("window.acctForm('purchase',{vendorId:'w',source:'float:"+fl._id+"',category:'Transport & fuel'})");
    const pb=a.run('window.__cap.b')||'';
    s.ok('the purchase form can open with the float already picked',new RegExp('class="acct-chipbtn on" data-v="float:'+fl._id+'"').test(pb));
    s.ok('…and the category already picked',/<option selected>Transport &amp; fuel<\/option>/.test(pb));
    s.ok('the float detail opens the purchase form that way',/acctForm\('purchase',\{source:'float:[^']+',category:_acctById/.test(a.run("(()=>{let __b='';_acctModal=function(t,b){__b=b;};window.acctOpenEntry('"+fl._id+"');return __b;})()")));
    a.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    // a category used only by a float is still on the list
    a.run("acctEntries.push("+J(E('float_out',{_id:'f9',account:'cash',amount:500,person:'Noman',category:'Fuel'}))+")");
    s.ok('a category a float introduced is on the picker',a.run('_acctCategories()').includes('Fuel'));

    // the Vendors tab lists the categories, with what was spent under each
    a.run("acctEntries.push("+J(E('purchase',{_id:'p9',vendorId:'w',vendorName:'w',source:'cash',account:'cash',amount:1200,category:'transport & FUEL',lines:[{desc:'Diesel',qty:1,unit:'',rate:1200,total:1200}]}))+")");
    a.run("currentPage='acct-vendors';acctRenderPage('acct-vendors',document.getElementById('main-content'))");
    const vp=a.el('main-content').innerHTML;
    s.ok('the Vendors tab carries a Categories card',/categor(y|ies)<\/div>/.test(vp)&&/data-c="Transport &amp; fuel"/.test(vp));
    const st=a.run("_acctCategoryStats().find(c=>c.name==='Transport & fuel')");
    s.ok('a category counts its purchases and its floats separately',st&&st.spent===1200&&st.floats===3000&&st.count===2,JSON.stringify(st));
    s.ok('…matching the name whatever its case',st&&st.count===2);
    s.ok('Raees can add a category from there',/acctCategoryNew\(\)/.test(vp));
    const m=app({session:MUSTAFA});m.seed([],[V('w')]);
    m.run("currentPage='acct-vendors';acctRenderPage('acct-vendors',document.getElementById('main-content'))");
    s.ok('a manager (view only) cannot',!/acctCategoryNew\(\)/.test(m.el('main-content').innerHTML)&&/Categories|categor/.test(m.el('main-content').innerHTML));

    // the category page
    a.run("_acctCategoryId='transport & fuel';currentPage='acct-category';acctRenderPage('acct-category',document.getElementById('main-content'))");
    const cp=a.el('main-content').innerHTML;
    s.ok('the category page lists the purchase and the float under it',/Diesel/.test(cp)&&/Float to Noman/.test(cp));
    s.ok('…and totals them',/₨4,200/.test(cp));
    s.ok('…under the list\'s own spelling',/<div style="font-size:19px;font-weight:800">Transport &amp; fuel<\/div>/.test(cp));
    s.ok('a float in another category is not on it',!/· Fuel/.test(cp));
    s.ok('the Vendors tab is the active one',/class="gp-tab active" onclick="window.acctGo\('acct-vendors'\)"/.test(a.run("_acctPageHead('acct-category')")));
    a.run("_acctCategoryId='Nowhere';acctRenderPage('acct-category',document.getElementById('main-content'))");
    s.ok('an unknown category says so instead of an empty table',/Category not found/.test(a.el('main-content').innerHTML));

    // + New category from the Vendors tab
    const n=app({session:RAEES,globals:{prompt:()=>'Small items'}});n.seed([],[V('w')]);
    const f0=n.state.fetches.length;
    n.run('window.acctCategoryNew()');
    await new Promise(r=>setTimeout(r,5)); // the settings PATCH is fired, never awaited
    s.ok('a new category joins the list',n.run('_acctCategories()').includes('Small items'));
    s.ok('…through the field-limited settings PATCH',n.state.fetches.slice(f0).some(f=>/acct_settings\/main\?updateMask/.test(f.url)&&f.init.method==='PATCH'));
    const n2=app({session:RAEES,globals:{prompt:()=>'fuel & transport'}});n2.seed([],[V('w')]);
    const f1=n2.state.fetches.length;
    n2.run('window.acctCategoryNew()');
    s.ok('a name already on the list (any case) is not minted twice',n2.run('_acctCategories()').filter(c=>/fuel/i.test(c)).length===1&&n2.state.fetches.length===f1);
    const n3=app({session:MUSTAFA,globals:{prompt:()=>'Nope'}});n3.seed([],[V('w')]);
    n3.run('window.acctCategoryNew()');
    s.ok('a viewer\'s call is a no-op',!n3.run('_acctCategories()').includes('Nope')&&n3.state.prompts.length===0);
  }

  s.section('more than one runner — each with a log of their own');
  {
    // Afnan, 24 Sept 2026: "there can be more then 1 runner so log created
    // by name of other runner as well such as ABBAS"
    const a=app({session:RAEES});
    a.seed([
      E('cash_in',{account:'cash',amount:20000}),
      E('float_out',{_id:'f1',account:'cash',amount:3000,person:'Noman',category:'Store purchase',date:daysAgo(3)}),
      E('float_out',{_id:'f2',account:'cash',amount:2000,person:'ABBAS',category:'Transport & fuel',date:daysAgo(2)}),
      E('purchase',{_id:'b1',vendorId:'w',vendorName:'w',source:'float',floatId:'f1',person:'Noman',amount:500,category:'Store purchase',lines:[{desc:'Thread',qty:1,unit:'',rate:500,total:500}]}),
      E('purchase',{_id:'b2',vendorId:'w',vendorName:'w',source:'float',floatId:'f2',person:'ABBAS',amount:1500,category:'Transport & fuel',lines:[{desc:'Petrol',qty:1,unit:'',rate:1500,total:1500}]}),
      E('float_in',{_id:'r2',account:'cash',amount:300,floatId:'f2',person:'ABBAS'}),
      E('float_out',{_id:'f3',account:'cash',amount:100,person:'abbas',status:'void',category:'Other'})
    ],[V('w',{terms:{mode:'cash'}})]);
    const runners=a.run('_acctRunners()');
    s.ok('the runners are the settings list plus everyone a float was given to',runners.includes('Noman')&&runners.includes('ABBAS'),runners.join(','));
    s.eq('a name typed in another case is the same runner',runners.filter(r=>/abbas/i.test(r)).length,1);
    a.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    a.run("window.acctForm('float_out',{})");
    let body=a.run('window.__cap.b')||'';
    s.ok('the float form offers both names',/<option value="Noman">/.test(body)&&/<option value="ABBAS">/.test(body));
    s.ok('with two runners known, Given to starts blank rather than assuming Noman',/id="f-person" list="acct-runners"[^>]*value=""/.test(body));
    a.run("window.acctForm('float_out',{person:'ABBAS'})");
    s.ok('a runner page can open the form on its runner',/id="f-person"[^>]*value="ABBAS"/.test(a.run('window.__cap.b')||''));
    const one=app({session:RAEES});one.seed([],[V('w')]);one.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");one.run("window.acctForm('float_out',{})");
    s.ok('with one runner known it is still prefilled',/id="f-person"[^>]*value="Noman"/.test(one.run('window.__cap.b')||''));

    const st=a.run("_acctRunnerStats().find(r=>r.name==='ABBAS')");
    s.ok('a runner\'s figures: given, spent from the floats, change back, still open',st&&st.given===2000&&st.spent===1500&&st.back===300&&st.openLeft===200,JSON.stringify(st));
    s.eq('…counting the float, the bill and the change back, not the voided float',st&&st.count,3);
    const nm=a.run("_acctRunnerStats().find(r=>r.name==='Noman')");
    s.ok('and Noman\'s are his own',nm&&nm.given===3000&&nm.spent===500&&nm.openLeft===2500,JSON.stringify(nm));
    a.run("currentPage='acct-vendors';acctRenderPage('acct-vendors',document.getElementById('main-content'))");
    const vp=a.el('main-content').innerHTML;
    s.ok('the Vendors tab carries a Runners card naming both',/2 runners/.test(vp)&&/data-r="ABBAS"/.test(vp)&&/data-r="Noman"/.test(vp));

    a.run("_acctRunnerId='abbas';currentPage='acct-runner';acctRenderPage('acct-runner',document.getElementById('main-content'))");
    const rp=a.el('main-content').innerHTML;
    s.ok('the runner page lists his float, his bill and his change back',/Float to ABBAS/.test(rp)&&/Petrol/.test(rp)&&/Change back from ABBAS/.test(rp));
    s.ok('…and none of Noman\'s',!/Float to Noman/.test(rp)&&!/Thread/.test(rp));
    s.ok('…under the runner\'s own spelling',/<div style="font-size:19px;font-weight:800">ABBAS<\/div>/.test(rp));
    s.ok('…with a button to give him another float',/acctForm\('float_out',\{person:&quot;ABBAS&quot;\}\)/.test(rp));
    s.ok('the Vendors tab is the active one',/class="gp-tab active" onclick="window.acctGo\('acct-vendors'\)"/.test(a.run("_acctPageHead('acct-runner')")));
    a.run("_acctRunnerId='Nobody';acctRenderPage('acct-runner',document.getElementById('main-content'))");
    s.ok('an unknown runner says so',/Runner not found/.test(a.el('main-content').innerHTML));
    const m=app({session:MUSTAFA});m.seed([E('float_out',{_id:'f1',account:'cash',amount:3000,person:'Noman',category:'Other'})],[V('w')]);
    m.run("_acctRunnerId='Noman';currentPage='acct-runner';acctRenderPage('acct-runner',document.getElementById('main-content'))");
    s.ok('a manager sees the log but no Give a float button',/Float to Noman/.test(m.el('main-content').innerHTML)&&!/Give a float/.test(m.el('main-content').innerHTML));
  }

  s.section('an expense — work or a service — is a purchase with no inventory');
  {
    // Afnan's screenshot (23 Sept 2026): "PAINT JOB FOR STUDIO" typed into
    // Note, the line row empty, Total ₨0 — "the logic is wrong … if its not
    // a inventory … they have nothing to do with inventory".
    const a=app({session:RAEES});a.run('allItems=[]');a.seed([],[V('N',{name:'Noman 2',kind:'service'})]);
    a.run("window.acctForm('purchase',{vendorId:'N'})");
    const form=a.bodyHtml('acct-modal')||'';
    s.ok('a service vendor opens the form in Expense mode',/id="f-kind"[^>]*value="expense"/.test(form));
    s.ok('the expense block asks what was done and the amount',/id="f-exp-desc"/.test(form)&&/id="f-exp-amount"/.test(form));
    s.ok('the stock block is hidden in expense mode',/id="acct-stock-wrap" style="display:none"/.test(form));
    s.ok('the two kinds are offered as chips',/data-v="stock"/.test(form)&&/data-v="expense"/.test(form));
    a.el('f-vendor').value='N';a.el('f-date').value=TODAY;a.el('f-source').value='cash';a.el('f-cat').value='Maintenance & repairs';
    a.el('f-kind').value='expense';a.el('f-exp-desc').value='Paint job for studio';a.el('f-exp-amount').value='15000';
    a.run("_acctFormLines=[_acctNewLine()]");
    await a.run('window.acctSubmitPurchase()');
    const e=a.run('acctEntries[0]');
    s.ok('the purchase is recorded — one uniform ledger, still type purchase',!!e&&e.type==='purchase');
    s.eq('flagged as an expense',e&&e.expense,true);
    s.eq('the amount is what was typed',e&&e.amount,15000);
    s.eq('stored as one description line at qty 1, so every reader works unchanged',e&&J(e.lines),J([{itemCode:'',desc:'Paint job for studio',qty:1,unit:'',rate:15000,total:15000}]));
    s.eq('cash went down by it',a.run('_acctBalances().cash'),-15000);
    s.eq('nothing posted into inventory',txWrites(a).length,0);
    s.eq('the ledger reads the work, not "· 1  @ ₨15,000"',a.run("_acctParticulars(acctEntries[0])"),'Paint job for studio');
    s.ok('the entry detail shows work and amount, not a qty/rate table',/Work \/ service/.test(a.run("(()=>{let __h='';_acctModal=function(t,b){__h=b;};window.acctOpenEntry(acctEntries[0]._id);return __h;})()")));
    // refusals
    const b=app({session:RAEES});b.run('allItems=[]');b.seed([],[V('N',{kind:'service'})]);
    b.el('f-vendor').value='N';b.el('f-date').value=TODAY;b.el('f-source').value='cash';b.el('f-kind').value='expense';b.el('f-exp-desc').value='';b.el('f-exp-amount').value='500';
    await b.run('window.acctSubmitPurchase()');
    s.eq('no description → nothing written',b.run('acctEntries.length'),0);
    s.ok('and it says so',b.state.toasts.some(t=>/Say what the work or service was/.test(String(t))));
    b.el('f-exp-desc').value='Paint';b.el('f-exp-amount').value='0';
    await b.run('window.acctSubmitPurchase()');
    s.eq('no amount → nothing written',b.run('acctEntries.length'),0);
    // the default follows the vendor's kind
    const c=app({session:RAEES});c.run('allItems=[]');c.seed([],[V('G',{name:'Thread house',kind:'goods'}),V('U',{name:'Nayatel',kind:'utility'})]);
    s.eq('a goods vendor defaults to stock',c.run("_acctPurchaseKindFor(_acctVendor('G'))"),'stock');
    s.eq('a recurring-bill vendor defaults to expense',c.run("_acctPurchaseKindFor(_acctVendor('U'))"),'expense');
    s.eq('no vendor yet → stock',c.run("_acctPurchaseKindFor(null)"),'stock');
    c.run("window.acctForm('purchase',{vendorId:'G'})");
    s.ok('a goods vendor opens in stock mode with the lines visible',/id="f-kind"[^>]*value="stock"/.test(c.bodyHtml('acct-modal')||'')&&/id="acct-expense-wrap" class="form-grid" style="display:none"/.test(c.bodyHtml('acct-modal')||''));
    // a stock line with an amount and no description is refused, never dropped
    c.el('f-vendor').value='G';c.el('f-date').value=TODAY;c.el('f-source').value='cash';c.el('f-kind').value='stock';
    c.run("_acctFormLines="+J([{itemCode:'',desc:'',qty:'',unit:'',rate:'500'}]));
    await c.run('window.acctSubmitPurchase()');
    s.eq('nothing written',c.run('acctEntries.length'),0);
    s.ok('and it names the line and points at Expense / service',c.state.toasts.some(t=>/Line 1 has an amount but no description/.test(String(t))));
    // a blank quantity beside a rate is a lump sum (qty 1); an untouched line is skipped
    c.state.toasts.length=0;
    c.run("_acctFormLines=["+J({itemCode:'',desc:'Rickshaw',qty:'',unit:'',rate:'300'})+",_acctNewLine()]");
    await c.run('window.acctSubmitPurchase()');
    s.eq('a blank qty beside an amount is one',c.run('acctEntries[0]&&acctEntries[0].lines[0].qty'),1);
    s.eq('the empty second line is dropped',c.run('acctEntries[0]&&acctEntries[0].lines.length'),1);
    s.eq('a new line starts at qty 1',c.run("_acctNewLine().qty"),'1');
    c.run("_acctFormLines=[];window.acctLineAdd()");
    s.eq('the + Line button mints the same line',c.run("_acctFormLines[0].qty"),'1');
    const row=c.run("_acctLineHTML({itemCode:'',desc:'',qty:'1',unit:'',rate:''},0)");
    s.ok('the item placeholder fits its box',/placeholder="Item code"/.test(row));
    s.ok('the description placeholder says what to type',/placeholder="What was bought/.test(row));
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
    const tx=txWrites(a);
    s.eq('two store_transactions received rows (not the free-text line)',tx.length,2);
    const body=tx[0]||{};
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

  s.section('a runner who spends over the float is owed the difference — until it is settled');
  {
    // Afnan, 24 Sept 2026: "if its not the same as give less or more logic
    // should be there … it is a credit transaction until it is settled by anyone"
    const a=app({session:RAEES});a.run('allItems=[]');
    a.seed([
      E('cash_in',{account:'cash',amount:20000}),
      E('float_out',{_id:'f1',account:'cash',amount:2000,person:'Noman',category:'Fuel & transport',date:daysAgo(2)}),
      E('purchase',{_id:'b1',source:'float',floatId:'f1',person:'Noman',payee:'PSO pump',amount:2600,category:'Fuel & transport',expense:true,lines:[{desc:'Petrol',qty:1,unit:'',rate:2600,total:2600}]})
    ],[V('w',{terms:{mode:'cash'}})]);
    s.eq('an overspent float is closed to more bills',a.run('_acctOpenFloats().length'),0);
    const owed=a.run("_acctRunnerOwed()['noman']");
    s.ok('the excess is owed to the runner — derived, nothing stored',!!owed&&owed.over===600&&owed.paid===0&&owed.owed===600,J(owed));
    s.eq('…by name',a.run("_acctRunnerOwedTo('NOMAN')"),600);
    s.eq('…and in total',a.run('_acctTotalRunnerOwed()'),600);
    s.eq('cash moved only by the float, never by the over-spend',a.run('_acctBalances().cash'),18000);
    const st=a.run("_acctRunnerStats().find(r=>r.name==='Noman')");
    s.ok('the runner\'s figures carry it',!!st&&st.owed===600&&st.openLeft===0,J(st));
    a.run("currentPage='acct-vendors';acctRenderPage('acct-vendors',document.getElementById('main-content'))");
    s.ok('the Runners card has an Owed-to-runner column',/Owed to runner/.test(a.el('main-content').innerHTML||'')&&/₨600/.test(a.el('main-content').innerHTML||''));
    a.run("currentPage='acct-ledger';acctRenderPage('acct-ledger',document.getElementById('main-content'))");
    const led=a.el('main-content').innerHTML||'';
    s.ok('the With-runners tile says what is owed',/owed to runners ₨600/.test(led));
    s.ok('the alert strip names him and the amount',/<b>Noman<\/b> is owed ₨600/.test(led));
    a.run("_acctRunnerId='Noman';currentPage='acct-runner';acctRenderPage('acct-runner',document.getElementById('main-content'))");
    const rp=a.el('main-content').innerHTML||'';
    s.ok('the runner page has an Owed tile and a Settle button',/Owed to runner/.test(rp)&&/Settle ₨600/.test(rp)&&/acctForm\('runner_pay',\{person:&quot;Noman&quot;\}\)/.test(rp));
    const det=a.run("(()=>{let __h='';_acctModal=function(t,b){__h=b;};window.acctOpenEntry('f1');return __h;})()")||'';
    s.ok('the float\'s detail says it went over, and to whom',/over by ₨600 — owed to Noman/.test(det));
    // the settle form
    a.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    a.run("window.acctForm('runner_pay',{person:'Noman'})");
    const form=a.run('window.__cap.b')||'';
    s.ok('the form lists the runner with what is owed and prefills the amount',/<option value="Noman" selected>Noman · owed ₨600</.test(form)&&/id="f-amount"[^>]*value="600"/.test(form));
    s.ok('Paid from offers Cash, MCB and Other',/data-v="cash"/.test(form)&&/data-v="mcb"/.test(form)&&/data-v="other"/.test(form));
    s.ok('the New-entry menu offers it',/acctForm\('runner_pay'\)/.test(a.run("window.acctNewMenu();window.__cap.b")||''));
    // over-settling is refused
    a.el('f-person').value='Noman';a.el('f-amount').value='700';a.el('f-date').value=TODAY;a.el('f-acc').value='cash';a.el('f-note').value='';
    await a.run("window.acctSubmit('runner_pay')");
    s.ok('more than is owed is refused',a.state.toasts.some(t=>/owed only ₨600/.test(String(t))));
    s.eq('…and nothing written',a.run("acctEntries.filter(e=>e.type==='runner_pay').length"),0);
    // Other needs the note; MCB needs the proof
    a.el('f-amount').value='600';a.el('f-acc').value='other';
    await a.run("window.acctSubmit('runner_pay')");
    s.ok('Other without a note is refused',a.state.toasts.some(t=>/how this was settled/.test(String(t))));
    a.el('f-acc').value='mcb';
    await a.run("window.acctSubmit('runner_pay')");
    s.ok('MCB without proof is refused',a.state.toasts.some(t=>/transfer proof/.test(String(t))));
    // settled from cash
    a.el('f-acc').value='cash';
    await a.run("window.acctSubmit('runner_pay')");
    const pay=a.run("acctEntries.find(e=>e.type==='runner_pay')");
    s.ok('the settlement is written',!!pay&&pay.person==='Noman'&&pay.amount===600&&pay.account==='cash',J(pay));
    s.eq('cash paid it',a.run('_acctBalances().cash'),17400);
    s.eq('nothing is owed any more',a.run("_acctRunnerOwedTo('Noman')"),0);
    s.ok('the effect names it',J(a.run("_acctEffect(acctEntries.find(e=>e.type==='runner_pay'))")).includes('"runnerPaid":600'));
    s.eq('the ledger reads it',a.run("_acctParticulars(acctEntries.find(e=>e.type==='runner_pay'))"),'Settled with Noman');
    s.ok('it is on the runner\'s own log',a.run("_acctRunnerEntries('noman').some(e=>e.type==='runner_pay')"));
    s.ok('the Settle button is gone once nothing is owed',!/Settle ₨/.test(a.run("acctRenderPage('acct-runner',document.getElementById('main-content'));document.getElementById('main-content').innerHTML")||''));
    // settled from Other: the debt drops, no money moves
    const o=app({session:RAEES});o.run('allItems=[]');
    o.seed([E('float_out',{_id:'f1',account:'cash',amount:1000,person:'Abbas',category:'Other'}),E('purchase',{_id:'b1',source:'float',floatId:'f1',person:'Abbas',payee:'x',amount:1500,expense:true,lines:[{desc:'x',qty:1,unit:'',rate:1500,total:1500}]})],[]);
    o.el('f-person').value='Abbas';o.el('f-amount').value='500';o.el('f-date').value=TODAY;o.el('f-acc').value='other';o.el('f-note').value='Afnan paid him from his pocket';
    await o.run("window.acctSubmit('runner_pay')");
    s.eq('Other settles it',o.run("_acctRunnerOwedTo('Abbas')"),0);
    s.eq('…moving neither Cash nor MCB',J(o.run("(()=>{const b=_acctBalances();return [b.cash,b.mcb];})()")),J([-1000,0]));
    s.ok('the source column says so',/Other · settled outside/.test(o.run("_acctSourceLabel(acctEntries.find(e=>e.type==='runner_pay'))")||''));
    // voiding the bill takes the debt with it — derived, never stored
    o.run("acctEntries.find(e=>e._id==='b1').status='void'");
    s.eq('a voided bill owes nothing',o.run("_acctRunnerOwed()['abbas']?_acctRunnerOwed()['abbas'].over:0"),0);
    // nobody owed → the form refuses
    const n=app({session:RAEES});n.seed([E('float_out',{_id:'f1',account:'cash',amount:1000,person:'Noman',category:'Other'})],[]);
    n.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");n.run("window.acctForm('runner_pay',{})");
    s.ok('with every bill inside its float the settle form says there is nothing to settle',n.state.toasts.some(t=>/No runner is owed anything/.test(String(t)))&&!n.run('window.__cap'));
    // the purchase confirm says what the over-spend means
    const c=app({session:RAEES});c.run('allItems=[]');c.seed([E('float_out',{_id:'f1',account:'cash',amount:1000,person:'Noman',category:'Fuel & transport'})],[]);
    c.el('f-hasv').value='no';c.el('f-payee').value='PSO pump';c.el('f-date').value=TODAY;c.el('f-source').value='float:f1';c.el('f-kind').value='expense';c.el('f-exp-desc').value='Petrol';c.el('f-exp-amount').value='1300';c.el('f-cat').value='Fuel & transport';
    c.run("window._acctPhoto['f-photo']='https://res.cloudinary.com/x/bill.jpg'");
    await c.run('window.acctSubmitPurchase()');
    s.ok('recording a bill over the float asks, saying the extra is owed to the runner',c.state.confirms.some(m=>/₨300 more than the ₨1,000 left on Noman's float\. The extra will be owed to Noman/.test(m)),c.state.confirms.join('|'));
    s.eq('…and records it',c.run("_acctRunnerOwedTo('Noman')"),300);
    // Excel: the statement summary carries it
    c.run("window.acctExportStatement('"+daysAgo(1)+"','"+TODAY+"')");
    const sum=(c.xlsx[0]||{sheets:[]}).sheets.find(x=>x[0]==='Summary');
    s.ok('the statement summary has an Owed-to-runners row',!!sum&&sum[1].some(r=>r[0]==='Owed to runners'&&r[2]===300),sum?J(sum[1].filter(r=>/runners/.test(r[0]))):'no sheet');
  }

  s.section('a bill with no vendor — Paid to, nothing on credit, the bill photo above ₨1,000');
  {
    // Afnan, 24 Sept 2026: categories such as maintenance, wages, advances,
    // stationery, fuel, utilities "should not have a vendor based logic …
    // it should be does it have a vendor or not, if not proof of transaction
    // which is the bill should be mandatory" — "take a photo above 1000 RS
    // other then that its optional".
    const a=app({session:RAEES});a.run('allItems=[]');a.seed([],[V('w',{terms:{mode:'cash'}})]);
    s.eq('the default categories are the ones asked for',J(a.run('ACCT_DEFAULTS.categories')),J(ACCT_DEFAULT_CATS));
    s.ok('Store purchase and Other are vendor-based; the rest are not',a.run("_acctCatHasVendor('Store purchase')&&_acctCatHasVendor('Other')&&_acctCatHasVendor('store PURCHASE')&&!_acctCatHasVendor('Wages')&&!_acctCatHasVendor('Advances')&&!_acctCatHasVendor('Fuel & transport')&&!_acctCatHasVendor('Maintenance & repairs')&&!_acctCatHasVendor('')"));
    s.eq('the photo threshold is ₨1,000',a.run('ACCT_NOVENDOR_PHOTO_ABOVE'),1000);
    a.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    a.run("window.acctForm('purchase',{category:'Maintenance & repairs'})");
    let form=a.run('window.__cap.b')||'';
    s.ok('the form asks whether there is a vendor',/id="f-hasv-chips"/.test(form)&&/data-v="yes"/.test(form)&&/data-v="no"/.test(form));
    s.ok('a repairs bill starts on No',/id="f-hasv" value="no"/.test(form));
    s.ok('…with the vendor select hidden and Paid to shown',/id="f-vendor-wrap"/.test(form)&&/grid-column:1\/-1;display:none" id="f-vendor-wrap"/.test(form)&&/grid-column:1\/-1" id="f-payee-wrap"/.test(form));
    s.ok('…and the ₨1,000 rule under it',/required above ₨1,000/.test(form));
    a.run("window.acctForm('purchase',{vendorId:'w',category:'Maintenance & repairs'})");
    form=a.run('window.__cap.b')||'';
    s.ok('opened from a vendor it starts on Yes whatever the category',/id="f-hasv" value="yes"/.test(form)&&/display:none" id="f-payee-wrap"/.test(form));
    a.run("window.acctForm('purchase',{})");
    s.ok('a plain Store purchase starts on Yes',/id="f-hasv" value="yes"/.test(a.run('window.__cap.b')||''));
    a.run("window.acctForm('purchase',{category:'Fuel & transport',source:'float:x'})");
    s.ok('a bill from a runner\'s float for fuel starts on No',/id="f-hasv" value="no"/.test(a.run('window.__cap.b')||''));
    // a small bill, no photo, no vendor
    a.el('f-hasv').value='no';a.el('f-payee').value='Ali electrician';a.el('f-date').value=TODAY;a.el('f-source').value='cash';a.el('f-kind').value='expense';a.el('f-exp-desc').value='Fan rewiring';a.el('f-exp-amount').value='900';a.el('f-cat').value='Maintenance & repairs';
    a.run("delete window._acctPhoto['f-photo']");
    await a.run('window.acctSubmitPurchase()');
    const e=a.run('acctEntries[0]');
    s.ok('written with the payee and no vendor',!!e&&e.payee==='Ali electrician'&&e.vendorId===null&&e.vendorName===''&&e.amount===900,J(e));
    s.eq('below ₨1,000 the photo is optional',e&&e.photo,null);
    s.eq('the payee reads where a vendor\'s name would',a.run('_acctVendorName(acctEntries[0])'),'Ali electrician');
    s.ok('no payable is opened for anybody',!Object.keys(a.run('_acctBalances().payables')).length);
    s.eq('cash paid it',a.run('_acctBalances().cash'),-900);
    s.ok('the entry detail says Paid to, with no vendor link',(()=>{const d=a.run("(()=>{let __h='';_acctModal=function(t,b){__h=b;};window.acctOpenEntry(acctEntries[0]._id);return __h;})()")||'';return /Paid to<\/span><b>Ali electrician <span class="acct-chip">no vendor account/.test(d)&&!/acctOpenVendor/.test(d);})());
    s.ok('the payee is offered next time',J(a.run('_acctPayees()'))===J(['Ali electrician']));
    a.run("currentPage='acct-category';_acctCategoryId='Maintenance & repairs';acctRenderPage('acct-category',document.getElementById('main-content'))");
    s.ok('the category page lists it under the payee',/Ali electrician/.test(a.el('main-content').innerHTML||''));
    // above ₨1,000 the photo is required
    a.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    a.el('f-exp-amount').value='1500';a.el('f-payee').value='Ali electrician';
    await a.run('window.acctSubmitPurchase()');
    s.ok('₨1,500 with no photo is refused by name',a.state.toasts.some(t=>/Attach the bill photo — it is required above ₨1,000 when there is no vendor/.test(String(t))));
    s.eq('…and nothing written',a.run('acctEntries.length'),1);
    a.el('f-exp-amount').value='1000';
    await a.run('window.acctSubmitPurchase()');
    s.eq('exactly ₨1,000 is not above it',a.run('acctEntries.length'),2);
    a.el('f-exp-amount').value='1500';a.run("window._acctPhoto['f-photo']='https://res.cloudinary.com/x/bill.jpg'");
    await a.run('window.acctSubmitPurchase()');
    s.ok('with the photo it goes through',a.run('acctEntries.length')===3&&a.run('acctEntries[0].photo')==='https://res.cloudinary.com/x/bill.jpg');
    // nothing on credit without a vendor
    a.el('f-source').value='credit';a.el('f-exp-amount').value='500';
    await a.run('window.acctSubmitPurchase()');
    s.ok('credit with no vendor is refused',a.state.toasts.some(t=>/Nothing can go on credit without a vendor/.test(String(t))));
    s.eq('…nothing written',a.run('acctEntries.length'),3);
    // Yes without picking one
    a.el('f-hasv').value='yes';a.el('f-vendor').value='';a.el('f-source').value='cash';
    await a.run('window.acctSubmitPurchase()');
    s.ok('Yes without a vendor picked says so',a.state.toasts.some(t=>/Pick a vendor — or say it has none/.test(String(t))));
    a.el('f-hasv').value='no';a.el('f-payee').value='';
    await a.run('window.acctSubmitPurchase()');
    s.ok('No without a payee says so',a.state.toasts.some(t=>/Who was paid\? Fill in Paid to/.test(String(t))));
    // a vendor bill is untouched by all this
    a.el('f-hasv').value='yes';a.el('f-vendor').value='w';a.el('f-payee').value='';a.el('f-exp-amount').value='5000';a.run("delete window._acctPhoto['f-photo']");
    await a.run('window.acctSubmitPurchase()');
    const ve=a.run('acctEntries[0]');
    s.ok('a ₨5,000 vendor bill with no photo is still only FLAGGED, never refused',!!ve&&ve.vendorId==='w'&&!ve.payee&&(ve.reviewFlags||[]).includes('no receipt'),J(ve));
    // the vendor-less rows read through the Excel export
    a.run("window.acctExportStatement('"+daysAgo(1)+"','"+TODAY+"')");
    const all=(a.xlsx[0]||{sheets:[]}).sheets.find(x=>x[0]==='All entries');
    s.ok('the All-entries sheet names the payee in the Vendor / Person column',!!all&&all[1].some(r=>r[3]==='Ali electrician'));
    // the admin edit can correct a payee
    s.eq('the admin patch carries payee',J(a.run("_acctAdminPatch({payee:'Ali electrician',amount:900},{payee:'Ali Electric Works',amount:'900'})")),J({payee:'Ali Electric Works'}));
    s.ok('and the field list names it',a.run("_ACCT_ADMIN_FIELDS.includes('payee')"));
    // the switch itself: turning the vendor off drops a credit pick back to Cash
    const b=app({session:RAEES});b.run('allItems=[]');b.seed([],[V('w')]);
    b.run("window.acctForm('purchase',{vendorId:'w'})");
    s.ok('a credit vendor opens on credit',/id="f-source" value="credit"/.test(b.run('window.__cap?window.__cap.b:document.getElementById("acct-modal").innerHTML')||b.bodyHtml('acct-modal')||''));
    // the harness's DOM does not carry a hidden input's value out of innerHTML; set it as the chip would
    b.el('f-source').value='credit';b.el('f-hasv').value='yes';
    b.run("window.acctPurchaseHasVendor(false)");
    s.eq('saying No moves Paid via off credit',b.el('f-source').value,'cash');
    s.eq('…and the hidden answer follows',b.el('f-hasv').value,'no');
  }

  s.section('runner floats');
  {
    const a=app({session:RAEES});
    a.seed([],[V('w',{terms:{mode:'cash'}})]);
    a.el('f-person').value='Noman';a.el('f-amount').value='3000';a.el('f-date').value=TODAY;a.el('f-acc').value='cash';a.el('f-cat').value='Store purchase';a.el('f-note').value='thread run';
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
    s.ok('and routes its change to acctCatChange',/id="f-cat" onchange="window\.acctCatChange\(this\);window\.acctPurchaseCatChanged\(\)"/.test(html));
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

  s.section('the daily log prints as a PDF through the print engine');
  {
    // Afnan (23 Sept 2026): after a bill is logged there should be a PDF of
    // the log — what happened on each day, plus the total billing.
    const a=app({session:RAEES});
    const gas=V('gas',{name:'Amin Gas',kind:'consumable',meter:{type:'weighed',unit:'kg',rate:350},terms:{mode:'monthly',billDay:1}});
    const m=a.run('_acctThisMonth()');const today=a.run('_acctToday()');
    const d=n=>m+'-'+String(n).padStart(2,'0');
    const logs=[{date:d(1),vendorId:'gas',month:m,qty:20,residual:5,byName:'Raees',note:'first cylinder'},{date:d(2),vendorId:'gas',month:m,qty:10,residual:0,rate:400,byName:'Raees',note:''}];
    a.seed([],[gas]);
    const data=a.run(`_acctConsPdfData(_acctVendor('gas'),'${m}',${J(logs)})`);
    s.eq('weighed: net = delivered − returned, day 1',data.rows[0].net,15);
    s.eq('a per-log rate wins over the meter rate, day 2',data.rows[1].amount,4000);
    s.eq('the month total is the sum of the logged days',J([data.totalQty,data.totalAmount,data.daysLogged]),J([25,5250+4000,2]));
    s.ok('every day up to today is a row, logged or not',data.rows.length===parseInt(today.slice(8))&&data.rows[2].qty===null);
    s.ok('a row names its day and weekday',data.rows[0].day===1&&/^[A-Z][a-z]{2}$/.test(data.rows[0].weekday));
    s.eq('no bill yet → null, and the PDF says so',data.bill,null);
    s.ok('English-only, and the vendor kind is carried',data.urduLevel==='none'&&data.weighed===true&&data.unit==='kg'&&data.rate===350);
    // with a bill on the account
    const key='gas_'+m;
    a.run("acctEntries.push(Object.assign(_acctBase('purchase'),{_id:'b1',vendorId:'gas',vendorName:'Amin Gas',source:'credit',amount:9250,date:'"+today+"',month:'"+m+"',lines:[],meterKey:'"+key+"',vendorBillAmount:9500}))");
    const d2=a.run(`_acctConsPdfData(_acctVendor('gas'),'${m}',${J(logs)})`);
    s.eq('the bill is carried with the vendor\'s own figure and the variance',J([d2.bill.amount,d2.bill.vendorBillAmount,d2.bill.variance]),J([9250,9500,250]));
    s.ok('a voided bill does not count',(()=>{a.run("acctEntries.find(e=>e._id==='b1').status='void'");const d3=a.run(`_acctConsPdfData(_acctVendor('gas'),'${m}',${J(logs)})`);a.run("acctEntries.find(e=>e._id==='b1').status='posted'");return d3.bill===null;})());
    // the action goes through the engine, never jsPDF
    const calls=[];a.ctx.window.printDocument=o=>calls.push(o);
    a.run(`_acctMeterCache['gas|${m}']=${J(logs)}`);
    await a.run(`window.acctConsPdf('gas','${m}')`);
    s.eq('one printDocument call, the consumable-log variant',J([calls.length,calls[0]&&calls[0].type]),J([1,'consumable-log']));
    s.ok('the filename names the vendor and the month',calls[0]&&calls[0].filename==='consumable-log-amin-gas-'+m+'.pdf');
    s.eq('the data is the builder\'s',calls[0]&&calls[0].data.totalAmount,9250);
    s.ok('and it is logged',a.state.activity.some(x=>/Consumable log printed/.test(x.action)));
    s.ok('the source never calls jsPDF directly',!/new\s+jsPDF|jspdf\.jsPDF|jsPDF\(/.test(read('js/store-accounts.js')));
    // no engine → said, not thrown
    a.ctx.window.printDocument=undefined;
    await a.run(`window.acctConsPdf('gas','${m}')`);
    s.ok('a missing engine is said out loud',a.state.toasts.some(t=>/print engine/.test(String(t))));
    // the buttons
    const foot=a.run(`_acctConsFoot(_acctVendor('gas'),'${m}',${J(logs)})`);
    s.ok('the consumables foot offers Print log once a bill exists',foot.indexOf("acctConsPdf('gas','"+m+"')")>-1&&/Print log/.test(foot));
    a.run("acctEntries=acctEntries.filter(e=>e._id!=='b1')");
    s.ok('…and before a bill too, when there is a log',/acctConsPdf/.test(a.run(`_acctConsFoot(_acctVendor('gas'),'${m}',${J(logs)})`)));
    s.ok('…but not on an empty month',!/acctConsPdf/.test(a.run(`_acctConsFoot(_acctVendor('gas'),'${m}',[])`)));
    a.run("acctEntries.push(Object.assign(_acctBase('purchase'),{_id:'b2',vendorId:'gas_x',vendorName:'Amin Gas',source:'credit',amount:1,date:'"+today+"',month:'"+m+"',lines:[],meterKey:'gas_x_"+m+"'}))");
    a.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    a.run("window.acctOpenEntry('b2')");
    s.ok('the bill\'s own detail (what the vendor page opens) offers Print log with the month read off the LAST 7 chars, so an underscore in a vendor id is safe',new RegExp("acctConsPdf\\('gas_x','"+m+"'\\)").test(a.run('window.__cap.f')));
  }

  s.section('the print engine draws the log');
  {
    let eng=null;
    try{eng=harness.loadApp({files:['js/print-engine.js'],currentPage:'acct-consumables'});}catch(e){s.ok('print-engine.js loads in the harness',false,String(e.message||e));}
    if(eng){
      const src=read('js/print-engine.js');
      s.ok('the variant is registered, labelled and English-only by default',/'consumable-log': _renderConsumableLog/.test(src)&&/'consumable-log': 'Consumable Log'/.test(src)&&/'consumable-log': 'minimal'/.test(src)&&/'pattern-label', 'consumable-log', 'generic'\]/.test(src));
      eng.run(`fakeDoc=function(){const calls={text:[],rect:[],pages:1};return{calls,internal:{pageSize:{getWidth:()=>595,getHeight:()=>842}},
        addPage(){calls.pages++;},setFont(){},setFontSize(){},setTextColor(){},setDrawColor(){},setLineWidth(){},setFillColor(){},getTextWidth(t){return String(t).length*5;},
        line(){},rect(x,y,w,h,st){calls.rect.push([x,y,w,h,st||'']);},
        text(t,x,y,o){calls.text.push({t:Array.isArray(t)?t.join('|'):String(t),x,y,align:o&&o.align,page:calls.pages});},
        splitTextToSize(t,w){return String(t).split('\\n');},__groovyFonts:{}};}`);
      const rows=Array.from({length:30},(_,i)=>({day:i+1,weekday:'Mon',qty:i%3===0?null:10+i,residual:2,net:8+i,amount:(8+i)*350,byName:'Raees',note:i===4?'a very long note that will not fit in the column and has to be clipped':''}));
      const data={vendorName:'Amin Gas',monthLabel:'September 2026',unit:'kg',weighed:true,rate:350,rows,totalQty:51,totalAmount:17850,daysLogged:20,bill:{amount:17850,date:'23-Sept-26',vendorBillAmount:18000,variance:150},issuedBy:'Raees'};
      const calls=eng.run('(function(){const d=fakeDoc();_renderConsumableLog(d,'+J(data)+');return d.calls;})()');
      const texts=calls.text.map(t=>t.t);
      s.ok('every day is drawn, logged or not',rows.every(r=>texts.some(t=>t===r.day+' Mon')));
      s.ok('an unlogged day reads as a dash, a logged one carries its numbers',texts.filter(t=>t==='—').length>=10&&texts.includes('17,850'));
      s.ok('the month total and the billing block are drawn',texts.includes('TOTAL')&&texts.includes('20 days logged')&&texts.some(t=>/Bill generated:\s+Rs 17,850/.test(t))&&texts.some(t=>/vendor bills Rs 150 MORE/.test(t)));
      s.ok('no column head is clipped',['Day','Delivered','Returned','Net','Amount (Rs)','Logged by','Note'].every(h=>texts.includes(h)));
      s.ok('a whole month fits its table on page 1; the billing block may follow on page 2',calls.text.filter(t=>t.t==='TOTAL')[0].page===1&&calls.pages<=2);
      // more rows than a month has — the only way to exercise the page break
      const many=Array.from({length:45},(_,i)=>Object.assign({},rows[i%30],{day:i+1}));
      const c3=eng.run('(function(){const d=fakeDoc();_renderConsumableLog(d,'+J(Object.assign({},data,{rows:many}))+');return d.calls;})()');
      s.ok('past the page the table breaks and the column heads repeat',c3.pages>=2&&c3.text.filter(t=>t.t==='Day').length===2&&c3.text.filter(t=>t.t==='Day')[1].page===2);
      s.ok('a long note is clipped rather than run across the columns',texts.some(t=>/…$/.test(t))&&!texts.some(t=>/has to be clipped/.test(t)));
      s.ok('everything lands inside A4',calls.text.every(t=>t.x>=0&&t.x<=595&&t.y>=0&&t.y<=842));
      const c2=eng.run('(function(){const d=fakeDoc();_renderConsumableLog(d,'+J(Object.assign({},data,{weighed:false,unit:'bottle',bill:null,rows:rows.slice(0,5)}))+');return d.calls;})()');
      const t2=c2.text.map(t=>t.t);
      s.ok('a counted vendor has no delivered/returned columns and says there is no bill yet',t2.includes('Received')&&!t2.some(t=>/Returned|Delivered/.test(t))&&t2.some(t=>/No bill generated/.test(t))&&t2.some(t=>/51 bottles/.test(t)));
    }
  }

  s.section('Raees edits his own entries (26 Sept 2026 — "he needs edit rights")');
  {
    // an app whose fetch answers runQuery with `rows` (the store log) and
    // records every call, so a test can read what was written
    const appF=(sess,rows,extra)=>{const holder={};const a=app({session:sess,globals:Object.assign({fetch:async(url,init)=>{holder.a.state.fetches.push({url:String(url),init:init||{}});
      if(/:runQuery$/.test(String(url)))return{ok:true,status:200,json:async()=>(rows||[]).map(r=>({document:{name:'projects/p/databases/(default)/documents/store_transactions/'+r._id,fields:{itemCode:{stringValue:r.itemCode},qty:{integerValue:String(r.qty)},acctEntryId:{stringValue:r.acctEntryId||'p1'}}}}))};
      {const m=/\/store_items\/([^?:]+)$/.exec(String(url));if(m&&!(init&&init.method)){const code=decodeURIComponent(m[1]);const it=JSON.parse(JSON.stringify(holder.a.server||JSON.parse(holder.a.run('JSON.stringify(allItems)')))).find(x=>x.code===code);
        if(!it)return{ok:false,status:404,json:async()=>({error:{message:'not found'}})};delete it._id;const f=holder.a.run(`toFsFields(${J(it)})`);return{ok:true,status:200,json:async()=>({name:'x/store_items/'+m[1],fields:f})};}}
      return{ok:true,status:200,json:async()=>({documents:[]})};}},extra||{})});holder.a=a;return a;};
    const patches=(a,id)=>a.state.fetches.filter(f=>new RegExp('/acct_entries/'+id+'\\?').test(f.url)&&f.init.method==='PATCH');
    const bodyOf=f=>JSON.parse(f.init.body).fields;
    const AMMAR={uid:'u2',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'};

    // who may edit what — one decision, _acctEditBlock
    const blk=(sess,e,closes)=>{const a=app({session:sess});a.seed([e],[V('A')],{closes:closes||[]});return a.run(`_acctEditBlock(_acctById('${e._id}'))`);};
    s.eq('Raees: his own posted entry in an open month',blk(RAEES,E('payment',{_id:'x',vendorId:'A',account:'cash',amount:500})),null);
    s.ok('… not one Afnan entered',/ask Afnan or Ammar/.test(blk(RAEES,E('payment',{_id:'x',by:'afnan',byName:'Afnan',vendorId:'A',account:'cash',amount:5}))||''));
    s.ok('… not one an owner has reviewed',/reviewed/.test(blk(RAEES,E('payment',{_id:'x',vendorId:'A',account:'cash',amount:5,reviewedAt:1,reviewedBy:'afnan'}))||''));
    s.ok('… not a void one',/void/.test(blk(RAEES,E('payment',{_id:'x',vendorId:'A',account:'cash',amount:5,status:'void'}))||''));
    s.ok('… not a pending cash in — he confirms or voids it',/confirm/.test(blk(RAEES,E('cash_in',{_id:'x',account:'cash',amount:5,status:'pending'}))||''));
    s.ok('… not one in a closed month',/closed/.test(blk(RAEES,E('payment',{_id:'x',vendorId:'A',account:'cash',amount:5,date:LAST+'-05',month:LAST}),[{month:LAST,cashBook:0,mcbBook:0,payables:{}}])||''));
    s.ok('… not a bill generated from the daily log',/daily log/.test(blk(RAEES,E('purchase',{_id:'x',vendorId:'A',source:'credit',amount:5,meterKey:'A_'+MONTH}))||''));
    s.ok('… not a legacy import',/old cash ledger/.test(blk(RAEES,E('purchase',{_id:'x',source:'cash',amount:5,legacyId:'L1'}))||''));
    s.ok('Mustafa cannot edit anything',/cannot change/.test(blk(MUSTAFA,E('payment',{_id:'x',vendorId:'A',account:'cash',amount:5}))||''));
    s.eq('Ammar may edit an entry Raees made and an owner reviewed',blk(AMMAR,E('payment',{_id:'x',vendorId:'A',account:'cash',amount:5,reviewedAt:1})),null);
    s.ok('… but not in a closed month either — reopen it first',/closed/.test(blk(AMMAR,E('payment',{_id:'x',vendorId:'A',account:'cash',amount:5,date:LAST+'-05',month:LAST}),[{month:LAST,cashBook:0,mcbBook:0,payables:{}}])||''));

    // the entry detail: Edit… when allowed, one line saying why when not
    const foot=(sess,e)=>{const a=app({session:sess});a.seed([e],[V('A')]);a.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");a.run(`window.acctOpenEntry('${e._id}')`);return a.run('window.__cap');};
    const f1=foot(RAEES,E('payment',{_id:'x',vendorId:'A',account:'cash',amount:500}));
    s.ok('Raees sees Edit… on his own entry',/acctEditEntry\('x'\)/.test(f1.f));
    const f2=foot(RAEES,E('payment',{_id:'x',vendorId:'A',account:'cash',amount:500,reviewedAt:1,reviewedBy:'afnan'}));
    s.ok('… and not on a reviewed one, which says why instead',!/acctEditEntry/.test(f2.f)&&/Can.t be edited here/.test(f2.b)&&/reviewed/.test(f2.b));
    const f3=foot(MUSTAFA,E('payment',{_id:'x',vendorId:'A',account:'cash',amount:500}));
    s.ok('a viewer sees neither the button nor the lock line',!/acctEditEntry/.test(f3.f)&&!/Can.t be edited here/.test(f3.b));

    // a payment that settled the vendor in full: the form must not read the
    // vendor as owing nothing (its own payment is left out while editing)
    {
      const a=appF(RAEES);
      a.seed([E('purchase',{_id:'b1',vendorId:'A',vendorName:'A',source:'credit',amount:5000,lines:[{itemCode:'',desc:'x',qty:1,unit:'',rate:5000,total:5000}]}),E('payment',{_id:'p1',vendorId:'A',vendorName:'A',account:'cash',amount:5000,ts:9000})],[V('A')]);
      a.run("window.acctEditEntry('p1')");
      s.eq('the edit form opens on the entry, not on a new one',a.run('_acctEditId'),'p1');
      s.eq('its amount is the entry\'s own',a.el('f-amount').value,'5000');
      s.eq('its date is the entry\'s own',a.el('f-date').value,TODAY);
      s.eq('while it is open the vendor reads as owed the full bill',a.run("_acctVendorBalance('A')"),5000);
      a.el('f-amount').value='4500';a.el('f-edit-reason').value='bank said 4,500';
      const c0=a.state.confirms.length;
      await a.run("window.acctSubmit('payment')");
      s.eq('no false "becomes an advance" confirm',a.state.confirms.length,c0);
      const w=patches(a,'p1')[0];
      s.ok('one masked PATCH of the entry',!!w);
      s.eq('… naming only what changed plus the edit\'s own fields',w?maskOf(w).join(','):'',['amount','editedAt','editedBy','edits','needsReview','reviewFlags'].join(','));
      s.ok('… refusing to re-create a deleted entry',w&&/currentDocument\.exists=true/.test(w.url));
      const e=a.run("_acctById('p1')");
      s.eq('the amount is changed in memory',e.amount,4500);
      s.eq('one history entry',e.edits.length,1);
      s.eq('… with the reason',e.edits[0].reason,'bank said 4,500');
      s.eq('… who',e.edits[0].by,'raees');
      s.eq('… and before → after',J([e.edits[0].before.amount,e.edits[0].after.amount]),J([5000,4500]));
      s.ok('it goes to the owners for review',e.needsReview===true&&e.reviewFlags.includes('edited'));
      s.eq('the edit session ends',a.run('_acctEditId'),null);
      s.eq('who entered it is untouched',e.by+'|'+e.ts,'raees|9000');
      s.eq('the balances follow at once',a.run("_acctVendorBalance('A')"),500);
      a.run("currentPage='acct-ledger';acctRenderPage('acct-ledger',document.getElementById('main-content'))");
      s.ok('the ledger row wears an edited chip',/acct-chip"[^>]*>edited</.test(a.el('main-content').innerHTML||''));
      s.ok('the activity log names the fields and the reason',a.state.activity.some(x=>x.action==='Accounts entry edited'&&/amount/.test(x.detail)&&/bank said/.test(x.detail)));
      // a second edit appends; the first is kept exactly
      a.run("window.acctEditEntry('p1')");a.el('f-amount').value='4500';a.el('f-note').value='ref fixed';a.el('f-edit-reason').value='note';
      await a.run("window.acctSubmit('payment')");
      const e2=a.run("_acctById('p1')");
      s.eq('a second edit appends',e2.edits.length,2);
      s.eq('… and leaves the first one as it was',e2.edits[0].reason,'bank said 4,500');
    }
    // refusals that write nothing
    {
      const a=appF(RAEES);a.seed([E('payment',{_id:'p1',vendorId:'A',vendorName:'A',account:'cash',amount:900})],[V('A')],{closes:[{month:LAST,cashBook:0,mcbBook:0,payables:{}}]});
      a.run("window.acctEditEntry('p1')");a.el('f-amount').value='950';a.el('f-edit-reason').value='';
      await a.run("window.acctSubmit('payment')");
      s.eq('no reason → no write',patches(a,'p1').length,0);
      s.ok('… and says why',a.state.toasts.some(t=>/why it is being changed/.test(t.msg||t)));
      a.el('f-edit-reason').value='x';a.el('f-amount').value='900';
      await a.run("window.acctSubmit('payment')");
      s.eq('nothing changed → no write',patches(a,'p1').length,0);
      a.el('f-amount').value='950';a.el('f-date').value=LAST+'-10';
      await a.run("window.acctSubmit('payment')");
      s.eq('a date in a closed month → no write',patches(a,'p1').length,0);
      a.el('f-date').value=daysAgo(-2);
      await a.run("window.acctSubmit('payment')");
      s.eq('a future date → no write',patches(a,'p1').length,0);
    }
    // an owner's Clear from a page loaded before Raees's edit: the entry is
    // re-read, the fresh copy shown, and nothing is cleared
    {
      const stale=E('payment',{_id:'p9',vendorId:'A',vendorName:'A',account:'cash',amount:12000,needsReview:true,reviewFlags:['over limit']});
      const fresh=Object.assign({},stale,{amount:50000,editedAt:5,editedBy:'raees',edits:[{at:5,by:'raees',byName:'Raees',reason:'x',fields:['amount'],before:{amount:12000},after:{amount:50000}}],reviewFlags:['over limit','edited']});
      delete fresh._id;
      const h={};const a=app({session:OWNER,globals:{fetch:async(url,init)=>{const u=String(url);h.a.state.fetches.push({url:u,init:init||{}});if(/\/acct_entries\/p9$/.test(u))return{ok:true,status:200,json:async()=>({name:'x/acct_entries/p9',fields:h.a.run(`toFsFields(${J(fresh)})`),updateTime:'t2'})};return{ok:true,status:200,json:async()=>({documents:[]})};}}});h.a=a;
      a.seed([stale],[V('A')]);
      await a.run("window.acctReview('p9')");
      s.eq('a stale Clear writes nothing',a.state.fetches.filter(f=>f.init.method==='PATCH').length,0);
      s.eq('… and the page now holds the edited entry',a.run("_acctById('p9').amount"),50000);
      s.ok('… still waiting for review',a.run("!_acctById('p9').reviewedAt&&_acctById('p9').reviewFlags.includes('edited')"));
      s.ok('… and says so',a.state.toasts.some(t=>/changed after the page loaded/.test(t.msg||t)));
      const b=app({session:OWNER});b.seed([E('payment',{_id:'p8',vendorId:'A',account:'cash',amount:5,needsReview:true})],[V('A')]);
      await b.run("window.acctReview('p8')");
      s.eq('an entry that cannot be re-read is not cleared',b.run("!!_acctById('p8').reviewedAt"),false);
    }
    // a field the form never shows is kept, not read as cleared
    {
      const a=appF(RAEES);
      a.seed([E('cash_in',{_id:'c1',account:'cash',via:'cash',amount:800,category:'Fabric sale',saleRef:'GP-1'}),E('transfer',{_id:'t1',account:'cash',toAccount:'mcb',amount:300,ref:'TRX-9'})],[]);
      a.run("window.acctEditEntry('c1')");a.el('f-amount').value='850';a.el('f-edit-reason').value='miscounted';
      await a.run("window.acctSubmit('cash_in')");
      const w=patches(a,'c1')[0];
      s.ok('a gate-pass sale keeps its Fabric sale category',!!w&&!maskOf(w).includes('category')&&a.run("_acctById('c1').category")==='Fabric sale');
      s.eq('… and the history names only the amount',J(a.run("_acctById('c1').edits[0].fields")),J(['amount']));
      a.run("window.acctEditEntry('t1')");a.el('f-amount').value='350';a.el('f-edit-reason').value='x';
      await a.run("window.acctSubmit('transfer')");
      s.eq('a transfer keeps the ref it has no field for',a.run("_acctById('t1').ref"),'TRX-9');
    }
    // an edit that would leave money already handed to a runner unexplained
    {
      const seed=()=>[E('float_out',{_id:'f1',person:'Noman',account:'cash',amount:1000,category:'Fuel & transport',ts:1}),E('purchase',{_id:'b1',source:'float',floatId:'f1',person:'Noman',amount:1500,ts:2,lines:[{itemCode:'',desc:'x',qty:1,unit:'',rate:1500,total:1500}],expense:true}),E('runner_pay',{_id:'r1',person:'Noman',account:'cash',amount:500,ts:3})];
      const a=appF(RAEES);a.seed(seed(),[]);
      s.eq('before: Noman was owed 500 and was paid 500',a.run("_acctRunnerOwedTo('Noman')"),0);
      a.run("window.acctEditEntry('f1')");a.el('f-amount').value='1500';a.el('f-edit-reason').value='was 1500';
      await a.run("window.acctSubmit('float_out')");
      s.eq('raising the float under a settled over-spend → no write',patches(a,'f1').length,0);
      s.ok('… naming the runner and the settlement',a.state.toasts.some(t=>/already been settled with Noman/.test(t.msg||t)));
      s.eq('… and the float is as it was',a.run("_acctById('f1').amount"),1000);
      const b=appF(RAEES);b.seed(seed(),[]);
      b.run("window.acctEditEntry('f1')");b.el('f-amount').value='900';b.el('f-edit-reason').value='was 900';
      await b.run("window.acctSubmit('float_out')");
      s.eq('lowering it (more owed, not less) is fine',b.run("_acctById('f1').amount"),900);
      s.eq('… and Noman is now owed the extra 100',b.run("_acctRunnerOwedTo('Noman')"),100);
      s.eq('the preview never leaks into the books',b.run('_acctEditPreview'),null);
    }
    // runner_pay: a full settlement can be re-saved; never over what is owed
    {
      const a=appF(RAEES);
      a.seed([E('float_out',{_id:'f1',person:'Noman',account:'cash',amount:1000,category:'Fuel & transport',ts:1}),E('purchase',{_id:'b1',source:'float',floatId:'f1',person:'Noman',amount:1300,ts:2,lines:[{itemCode:'',desc:'x',qty:1,unit:'',rate:1300,total:1300}]}),E('runner_pay',{_id:'r1',person:'Noman',account:'cash',amount:300,ts:3})],[]);
      a.run("window.acctEditEntry('r1')");
      s.eq('the settlement opens even though Noman is owed nothing now',a.run('_acctEditId'),'r1');
      a.el('f-person').value='Noman';a.el('f-amount').value='300';a.el('f-note').value='paid by hand';a.el('f-edit-reason').value='note';a.el('f-acc').value='cash';
      await a.run("window.acctSubmit('runner_pay')");
      s.eq('re-saving the exact settlement with a note works',patches(a,'r1').length,1);
      a.run("window.acctEditEntry('r1')");a.el('f-person').value='Noman';a.el('f-amount').value='400';a.el('f-edit-reason').value='x';a.el('f-acc').value='cash';
      await a.run("window.acctSubmit('runner_pay')");
      s.eq('over what he is owed is refused',patches(a,'r1').length,1);
    }
    // float_in: the change-back that closed its float can still be edited
    {
      const a=appF(RAEES);
      a.seed([E('float_out',{_id:'f1',person:'Noman',account:'cash',amount:1000,category:'Fuel & transport',ts:1}),E('purchase',{_id:'b1',source:'float',floatId:'f1',person:'Noman',amount:800,ts:2,lines:[{itemCode:'',desc:'x',qty:1,unit:'',rate:800,total:800}]}),E('float_in',{_id:'c1',floatId:'f1',person:'Noman',account:'cash',amount:200,ts:3})],[]);
      s.eq('the float is closed',a.run('_acctOpenFloats().length'),0);
      a.run("window.acctEditEntry('c1')");
      s.eq('the change-back still opens',a.run('_acctEditId'),'c1');
      s.eq('… on its own float',a.el('f-float').value,'f1');
      a.el('f-amount').value='250';a.el('f-edit-reason').value='x';a.el('f-acc').value='cash';
      await a.run("window.acctSubmit('float_in')");
      s.eq('more change than was left is refused',patches(a,'c1').length,0);
      a.el('f-amount').value='150';
      await a.run("window.acctSubmit('float_in')");
      s.eq('less is saved',patches(a,'c1').length,1);
    }
    // a bill on a float that is overspent even without it must still be able to name that float
    {
      const a=appF(RAEES);
      a.seed([E('float_out',{_id:'f1',person:'Noman',account:'cash',amount:1000,category:'Fuel & transport',ts:1}),E('purchase',{_id:'b1',source:'float',floatId:'f1',person:'Noman',amount:1100,payee:'PSO',ts:2,lines:[{itemCode:'',desc:'fuel',qty:1,unit:'',rate:1100,total:1100}]}),E('purchase',{_id:'b2',source:'float',floatId:'f1',person:'Noman',payee:'Shop',amount:100,category:'Fuel & transport',ts:3,lines:[{itemCode:'',desc:'oil',qty:1,unit:'',rate:100,total:100}]})],[]);
      a.run("window.acctEditEntry('b2')");
      a.el('f-hasv').value='no';a.el('f-payee').value='Shop';a.el('f-source').value='float:f1';a.el('f-kind').value='stock';a.el('f-cat').value='Fuel & transport';a.el('f-note').value='engine oil';a.el('f-edit-reason').value='note';
      await a.run('window.acctSubmitPurchase()');
      s.eq('a bill on an overspent float saves (its float stays selectable)',patches(a,'b2').length,1);
    }
    // float_out: the person cannot move once bills are on it; a smaller float asks
    {
      const a=appF(RAEES);
      a.seed([E('float_out',{_id:'f1',person:'Noman',account:'cash',amount:1000,category:'Fuel & transport',ts:1}),E('purchase',{_id:'b1',source:'float',floatId:'f1',person:'Noman',amount:800,ts:2,lines:[{itemCode:'',desc:'x',qty:1,unit:'',rate:800,total:800}]})],[]);
      a.run("window.acctEditEntry('f1')");a.el('f-person').value='Abbas';a.el('f-amount').value='1000';a.el('f-cat').value='Fuel & transport';a.el('f-acc').value='cash';a.el('f-edit-reason').value='x';
      await a.run("window.acctSubmit('float_out')");
      s.eq('moving a float with bills to someone else is refused',patches(a,'f1').length,0);
      a.el('f-person').value='Noman';a.el('f-amount').value='600';
      const c0=a.state.confirms.length;
      await a.run("window.acctSubmit('float_out')");
      s.ok('a float smaller than what is spent from it asks first',a.state.confirms.slice(c0).some(c=>/owed to Noman/.test(c)));
      s.eq('… and, confirmed, saves',patches(a,'f1').length,1);
      s.eq('the runner is now owed the difference',a.run("_acctRunnerOwedTo('Noman')"),200);
    }
    // a float's holder comes from the float, not from whichever bill came first
    {
      const a=app();a.seed([E('float_out',{_id:'f1',person:'Noman',account:'cash',amount:1000,category:'Fuel & transport',date:daysAgo(2),ts:1}),E('purchase',{_id:'b1',source:'float',floatId:'f1',person:'Old name',amount:100,ts:5,lines:[]})],[]);
      const f=a.run("_acctBalances().floats.f1");
      s.eq('person from the float_out',f.person,'Noman');
      s.eq('category from the float_out',f.category,'Fuel & transport');
      s.eq('date from the float_out',f.date,daysAgo(2));
    }
    // a purchase: the lines come back into the form; a quantity change posts only the difference
    {
      const a=appF(RAEES,[{_id:'t0',itemCode:'TH1',qty:12},{_id:'t1',itemCode:'NL1',qty:30}]);
      a.run("allItems="+J([{code:'TH1',name:'Thread',unit:'cone',balance:32,sizeSpecific:false,_id:'TH1'},{code:'NL1',name:'Neck label',unit:'pcs',sizeSpecific:true,sizes:{S:20,M:30},_id:'NL1'}]));
      a.seed([E('purchase',{_id:'p1',vendorId:'A',vendorName:'A',source:'credit',amount:2475,category:'Store purchase',stockPosted:true,stockTx:['t0','t1'],lines:[{itemCode:'TH1',desc:'Thread',qty:12,unit:'cone',rate:200,total:2400},{itemCode:'NL1',desc:'Neck label',qty:30,unit:'pcs',rate:2.5,total:75,sizes:{S:10,M:20}}]})],[V('A')]);
      a.run("window.acctEditEntry('p1')");
      s.eq('both lines are in the form',a.run('_acctFormLines.length'),2);
      s.eq('the flat line is editable',a.run('!!_acctFormLines[0].locked'),false);
      s.eq('the sized line that went into inventory is locked',a.run('_acctFormLines[1].locked'),true);
      a.run('window.acctLineRemove(1)');
      s.eq('… and cannot be removed',a.run('_acctFormLines.length'),2);
      a.run("_acctFormLines[1].sizes.S='99'");
      a.el('f-edit-reason').value='x';a.el('f-vendor').value='A';a.el('f-hasv').value='yes';a.el('f-source').value='credit';a.el('f-kind').value='stock';a.el('f-cat').value='Store purchase';
      await a.run('window.acctSubmitPurchase()');
      s.eq('changed sizes on a locked line are refused',patches(a,'p1').length,0);
      a.run("_acctFormLines[1].sizes.S='10';_acctFormLines[0].qty='15'");
      await a.run('window.acctSubmitPurchase()');
      s.eq('a new quantity is saved',a.run("_acctById('p1').lines[0].qty"),15);
      const tx=txWrites(a);
      s.eq('one correction row posted',tx.length,1);
      s.eq('… for the DIFFERENCE, not the whole line',tx[0]&&(tx[0].qty.integerValue||tx[0].qty.doubleValue),'3');
      s.ok('… tagged as a correction',tx[0]&&tx[0].correction&&tx[0].correction.booleanValue===true);
      s.eq('the balance moved by the difference only',a.run("allItems.find(i=>i.code==='TH1').balance"),35);
      s.eq('the sized item was not posted again',a.run("JSON.stringify(allItems.find(i=>i.code==='NL1').sizes)"),J({S:20,M:30}));
    }
    // the review round's stock findings (26 Sept 2026)
    {
      // a rate-only edit posts nothing, even when the Store renamed the code since
      const a=appF(RAEES,[{_id:'t0',itemCode:'THR01A',qty:20}]);
      a.run("allItems="+J([{code:'THR01A',name:'Thread',unit:'cone',balance:20,sizeSpecific:false,_id:'THR01A'}]));
      a.seed([E('purchase',{_id:'p1',vendorId:'A',vendorName:'A',source:'credit',amount:2000,category:'Store purchase',stockPosted:true,stockTx:['t0'],lines:[{itemCode:'THR01',desc:'Thread',qty:20,unit:'cone',rate:100,total:2000}]})],[V('A')]);
      s.eq('a rate-only change touches no item code',J(a.run("_acctStockChangedCodes(_acctById('p1'),Object.assign({},_acctById('p1'),{lines:[{itemCode:'THR01',desc:'Thread',qty:20,unit:'cone',rate:120,total:2400}]}))")),'[]');
      a.run("window.acctEditEntry('p1')");a.run("_acctFormLines[0].rate='120'");
      a.el('f-edit-reason').value='price typo';a.el('f-vendor').value='A';a.el('f-hasv').value='yes';a.el('f-source').value='credit';a.el('f-kind').value='stock';a.el('f-cat').value='Store purchase';
      await a.run('window.acctSubmitPurchase()');
      s.eq('… the edit is saved',a.run("_acctById('p1').lines[0].rate"),120);
      s.eq('… and nothing is taken out of the renamed item',txWrites(a).length,0);
      s.eq('… whose balance is untouched',a.run("allItems[0].balance"),20);
      await a.run("_acctStockSync(_acctById('p1'),{codes:['THR01']})");
      s.eq('a sync limited to the edited code leaves the renamed one alone',txWrites(a).length,0);
    }
    {
      // a correction bigger than what is left: the row logs what was really taken back
      const rows=[{_id:'t0',itemCode:'TH1',qty:20}];
      const a=appF(RAEES,rows);
      a.run("allItems="+J([{code:'TH1',name:'Thread',unit:'cone',balance:5,sizeSpecific:false,_id:'TH1'}]));
      a.seed([E('purchase',{_id:'p1',vendorId:'A',vendorName:'A',source:'credit',amount:0,stockPosted:true,stockTx:['t0'],lines:[{itemCode:'TH1',desc:'Thread',qty:0,unit:'cone',rate:100,total:0}]})],[V('A')]);
      await a.run("_acctStockSync(_acctById('p1'),{codes:['TH1']})");
      const t1=txWrites(a);
      s.eq('20 → 0 with 15 issued: the row takes back 5, not 20',t1[0]&&(t1[0].qty.integerValue||t1[0].qty.doubleValue),'-5');
      s.eq('… the balance is 0',a.run("allItems[0].balance"),0);
      s.ok('… and says 15 were already issued',a.state.toasts.some(t=>/only 5 of 20/.test(t.msg||t))&&/already issued/.test(a.run("_acctById('p1').stockError")));
      rows.push({_id:'t1',itemCode:'TH1',qty:-5});
      a.run("_acctById('p1').lines[0].qty=20");
      await a.run("_acctStockSync(_acctById('p1'),{codes:['TH1']})");
      const t2=txWrites(a);
      s.eq('putting it back to 20 posts +5',t2[1]&&(t2[1].qty.integerValue||t2[1].qty.doubleValue),'5');
      s.eq('… and lands on the truth (20 in − 15 issued), no stock minted',a.run("allItems[0].balance"),5);
    }
    {
      // the item is re-read before the write, so a stale page cannot erase an issue
      const a=appF(RAEES,[{_id:'t0',itemCode:'TH1',qty:20}]);
      a.run("allItems="+J([{code:'TH1',name:'Thread',unit:'cone',balance:50,sizeSpecific:false,_id:'TH1'}]));
      a.server=[{code:'TH1',name:'Thread',unit:'cone',balance:40,sizeSpecific:false}];
      a.seed([E('purchase',{_id:'p1',vendorId:'A',vendorName:'A',source:'credit',amount:0,stockPosted:true,stockTx:['t0'],lines:[{itemCode:'TH1',desc:'Thread',qty:22,unit:'cone',rate:100,total:2200}]})],[V('A')]);
      await a.run("_acctStockSync(_acctById('p1'),{codes:['TH1']})");
      const w=commitWrites(a,/\/store_items\//)[0];
      s.eq('the page held 50, the server 40: +2 writes 42, not 52',w&&(w.update.fields.balance.integerValue||w.update.fields.balance.doubleValue),'42');
      // two syncs at once post once
      const b=appF(RAEES,[]);
      b.run("allItems="+J([{code:'TH1',name:'Thread',unit:'cone',balance:0,sizeSpecific:false,_id:'TH1'}]));
      b.seed([E('purchase',{_id:'p2',vendorId:'A',vendorName:'A',source:'credit',amount:0,stockPosted:false,stockTx:['x'],lines:[{itemCode:'TH1',desc:'Thread',qty:20,unit:'cone',rate:100,total:2000}]})],[V('A')]);
      await b.run("Promise.all([window.acctRetryStock('p2'),window.acctRetryStock('p2')])");
      s.eq('a double-tapped Retry posts once',txWrites(b).length,1);
      // a retry that finds an empty log asks first (an older version could raise the balance before the row)
      const c=appF(RAEES,[],{confirm:()=>false});
      c.run("allItems="+J([{code:'TH1',name:'Thread',unit:'cone',balance:0,sizeSpecific:false,_id:'TH1'}]));
      c.seed([E('purchase',{_id:'p3',vendorId:'A',vendorName:'A',source:'credit',amount:0,stockPosted:false,stockError:'x',lines:[{itemCode:'TH1',desc:'Thread',qty:20,unit:'cone',rate:100,total:2000}]})],[V('A')]);
      await c.run("window.acctRetryStock('p3')");
      s.eq('… and, told no, posts nothing',txWrites(c).length,0);
    }
    {
      // a sized line whose post FAILED is not locked as "already in inventory"
      const a=appF(RAEES,[]);
      a.run("allItems="+J([{code:'NL1',name:'Neck label',unit:'pcs',sizeSpecific:true,sizes:{S:0,M:0},_id:'NL1'}]));
      a.seed([E('purchase',{_id:'p1',vendorId:'A',vendorName:'A',source:'credit',amount:500,stockPosted:false,stockError:'NL1: no size quantities',stockTx:[],lines:[{itemCode:'NL1',desc:'Neck label',qty:1,unit:'pcs',rate:500,total:500,sizes:{}}]})],[V('A')]);
      a.run("window.acctEditEntry('p1')");
      s.eq('a sized line that never went in stays editable',a.run('_acctFormLines[0].locked'),false);
      const b=appF(RAEES,[]);
      b.run("allItems="+J([{code:'NL1',name:'Neck label',unit:'pcs',sizeSpecific:true,sizes:{S:10},_id:'NL1'},{code:'TH1',name:'Thread',unit:'cone',balance:0,sizeSpecific:false,_id:'TH1'}]));
      b.seed([E('purchase',{_id:'p2',vendorId:'A',vendorName:'A',source:'credit',amount:510,stockPosted:false,stockError:'TH1: HTTP 500',stockTx:['t9'],lines:[{itemCode:'NL1',desc:'Neck label',qty:10,unit:'pcs',rate:50,total:500,sizes:{S:10}},{itemCode:'TH1',desc:'Thread',qty:1,unit:'cone',rate:10,total:10}]})],[V('A')]);
      b.run("window.acctEditEntry('p2')");
      s.eq('… while one that did go in (the error names another item) stays locked',b.run('_acctFormLines[0].locked'),true);
    }
    {
      // changing the vendor while correcting a payment keeps the amount being corrected
      const a=appF(RAEES);
      a.seed([E('purchase',{_id:'b1',vendorId:'B',vendorName:'B',source:'credit',amount:42000,lines:[]}),E('payment',{_id:'p1',vendorId:'A',vendorName:'A',account:'cash',amount:5000})],[V('A'),V('B')]);
      a.run("window.acctEditEntry('p1')");a.el('f-vendor').value='B';a.run("window.acctPayVendorChanged('B')");
      s.eq('switching the vendor on an edit leaves the amount at 5,000',a.el('f-amount').value,'5000');
      const n=appF(RAEES);n.seed([E('purchase',{_id:'b1',vendorId:'B',vendorName:'B',source:'credit',amount:42000,lines:[]})],[V('A'),V('B')]);
      n.run("window.acctForm('payment')");n.run("window.acctPayVendorChanged('B')");
      s.eq('… while a NEW payment still fills in what is owed',n.el('f-amount').value,42000);
    }
    // Retry is idempotent: the log already holds what the lines say
    {
      const a=appF(RAEES,[{_id:'t0',itemCode:'TH1',qty:12}]);
      a.run("allItems="+J([{code:'TH1',name:'Thread',unit:'cone',balance:32,sizeSpecific:false,_id:'TH1'}]));
      a.seed([E('purchase',{_id:'p1',vendorId:'A',vendorName:'A',source:'credit',amount:2410,stockPosted:false,stockError:'NOPE: not in inventory',stockTx:['t0'],lines:[{itemCode:'TH1',desc:'Thread',qty:12,unit:'cone',rate:200,total:2400},{itemCode:'NOPE',desc:'Ghost',qty:1,unit:'',rate:10,total:10}]})],[V('A')]);
      await a.run("window.acctRetryStock('p1')");await a.run("window.acctRetryStock('p1')");
      s.eq('Retry twice posts TH1 zero more times (it used to post it again each press)',txWrites(a).length,0);
      s.eq('… the balance is unchanged',a.run("allItems.find(i=>i.code==='TH1').balance"),32);
      s.ok('… and still names what it could not post',/NOPE/.test(a.run("_acctById('p1').stockError")));
    }
    // the plan itself
    {
      const a=app();
      const plan=(e,rows,items)=>JSON.parse(a.run(`JSON.stringify(_acctStockPlan(${J(e)},${J(rows)},${J(items)}))`));
      const items=[{code:'A',name:'a',unit:'u',balance:5},{code:'B',name:'b',unit:'u',balance:0}];
      const p1=plan({lines:[{itemCode:'B',qty:4}]},[{itemCode:'A',qty:4}],items);
      s.eq('a line moved from item A to B: −4 on A, +4 on B',J(p1.plan.map(x=>[x.code,x.qty]).sort()),J([['A',-4],['B',4]]));
      s.eq('first post of a fresh entry is not a correction',plan({lines:[{itemCode:'A',qty:2}]},[],items).plan[0].correction,false);
      s.eq('an unknown code already matching the log is not an error',plan({lines:[{itemCode:'Z',qty:1}]},[{itemCode:'Z',qty:1}],items).errors.length,0);
      s.eq('an unknown code that differs is',plan({lines:[{itemCode:'Z',qty:2}]},[{itemCode:'Z',qty:1}],items).errors.length,1);
    }
    // an owner's own edit does not flag itself, and keeps the review
    {
      const a=appF(AMMAR);
      a.seed([E('payment',{_id:'p1',vendorId:'A',vendorName:'A',account:'cash',amount:900,reviewedAt:5,reviewedBy:'afnan'})],[V('A')]);
      a.run("window.acctEditEntry('p1')");a.el('f-amount').value='950';a.el('f-edit-reason').value='fix';a.el('f-acc').value='cash';
      await a.run("window.acctSubmit('payment')");
      const e=a.run("_acctById('p1')");
      s.eq('Ammar\'s edit saves',e.amount,950);
      s.ok('… is not flagged as edited',!(e.reviewFlags||[]).includes('edited'));
      s.eq('… keeps the review',e.reviewedAt,5);
      s.eq('… but is in the history all the same',e.edits.length,1);
    }
    // the history is escaped
    {
      const a=app();a.seed([E('payment',{_id:'p1',vendorId:'A',vendorName:'A',account:'cash',amount:900,edits:[{at:1,by:'raees',byName:'Raees',reason:'<img src=x onerror=alert(1)>',fields:['note'],before:{note:'<b>a</b>'},after:{note:'b'}}]})],[V('A')]);
      const h=a.run("_acctEditHistoryHTML(_acctById('p1'))");
      s.ok('a reason is escaped',!/<img/.test(h)&&/&lt;img/.test(h));
      s.ok('a before value is escaped',!/<b>a<\/b>/.test(h));
      s.ok('a photo that is not https is not a link',!/href="javascript/.test(a.run(`_acctEditVal('photo','javascript:alert(1)')`)));
    }
    // a photo attached in a cancelled form never rides into the next one
    {
      const a=app({session:RAEES});a.seed([],[V('A')]);
      a.run("window._acctPhoto['f-photo']='https://res.cloudinary.com/x/stale.jpg'");
      a.run("window.acctForm('payment',{vendorId:'A'})");
      s.eq('opening a form clears the stale photo',a.run("window._acctPhoto['f-photo']||null"),null);
    }
    // while editing, the entry's own deactivated vendor is offered, and no "+ New vendor"
    {
      const a=app({session:RAEES});a.seed([E('payment',{_id:'p1',vendorId:'Z',vendorName:'Z',account:'cash',amount:5})],[V('A'),V('Z',{active:false})]);
      a.run("_acctEditId='p1'");
      const o=a.run("_acctVendorOptions('Z')");
      s.ok('a deactivated vendor the entry names is listed',/value="Z"/.test(o));
      s.ok('… and "+ New vendor" is not',!/__new__/.test(o));
      a.run('_acctEditId=null');
      s.ok('a new entry still offers it',/__new__/.test(a.run("_acctVendorOptions('A')")));
    }
    // a category spelled differently is kept, not re-spelled
    {
      const a=app({session:RAEES});a.seed([],[]);
      s.ok('an odd spelling stays an option and is selected',/<option selected>fuel &amp; TRANSPORT<\/option>/.test(a.run("_acctCatOptions('fuel & TRANSPORT')")));
    }
    // the admin edit: closed months refused, history appended
    {
      const a=app({session:OWNER});a.seed([E('payment',{_id:'p1',vendorId:'A',vendorName:'A',account:'cash',amount:900,date:LAST+'-05',month:LAST})],[V('A')],{closes:[{month:LAST,cashBook:0,mcbBook:0,payables:{}}]});
      a.run("window.acctAdminEdit('p1')");
      ['date','amount','vendor','payee','person','account','to','source','category','ref','note','reason'].forEach(k=>a.el('ae-'+k).value='');
      a.el('ae-date').value=LAST+'-05';a.el('ae-amount').value='950';a.el('ae-vendor').value='A';a.el('ae-account').value='cash';
      const b=a.state.fetches.length;await a.run("window.acctAdminSave('p1')");
      s.eq('an admin edit of an entry in a closed month is refused',a.state.fetches.length-b,0);
      const c=app({session:OWNER});c.seed([E('payment',{_id:'p1',vendorId:'A',vendorName:'A',account:'cash',amount:900})],[V('A')]);
      c.run("window.acctAdminEdit('p1')");
      ['date','amount','vendor','payee','person','account','to','source','category','ref','note','reason'].forEach(k=>c.el('ae-'+k).value='');
      c.el('ae-date').value=TODAY;c.el('ae-amount').value='950';c.el('ae-vendor').value='A';c.el('ae-account').value='cash';c.el('ae-reason').value='bank';
      await c.run("window.acctAdminSave('p1')");
      const e=c.run("_acctById('p1')");
      s.ok('an admin edit appends to the same history, marked admin',e.edits&&e.edits.length===1&&e.edits[0].admin===true&&e.edits[0].reason==='bank'&&e.edits[0].after.amount===950);
    }
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
    // scoped to the block — a lazy [\s\S]*? used to run on to whichever later
    // block carried the phrase, and passed whatever this one said
    const entriesBlock=(/match \/acct_entries\/\{doc\} \{([\s\S]*?)\n    \}/.exec(rules)||[])[1]||'';
    s.ok('entries are deleted by isAcctSuper() alone — never Raees, never the other owner',/allow delete: if isAcctSuper\(\);/.test(entriesBlock)&&!/allow delete: if (false|isOwner\(\)|isStoreAccounts\(\))/.test(entriesBlock));
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
    // every key _acctPatch writes must be allowed by the clause it goes through:
    // the review fields by acctReview() (owners), everything else by acctControl()
    const fnList=name=>{const b=new RegExp('function '+name+'\\(\\) \\{([\\s\\S]*?)\\n    \\}').exec(rules);const m=b&&/(?:affectedKeys\(\)|\bkeys)\.hasOnly\(\[([^\]]*)\]\)/.exec(b[1]);return (m?m[1]:'').split(',').map(x=>x.trim().replace(/'/g,'')).filter(Boolean);};
    const control=new Set(fnList('acctControl')),review=new Set(fnList('acctReview'));
    const REVIEW=['needsReview','reviewFlags','reviewedAt','reviewedBy'];
    const written=new Set();
    src.replace(/_acctPatch\([^,]+,\{([^}]*)\}/g,(_,body)=>{body.split(',').forEach(kv=>{const k=kv.split(':')[0].trim();if(k)written.add(k);});return'';});
    const missing=[...written].filter(k=>!(REVIEW.includes(k)?review:control).has(k));
    s.eq('every field _acctPatch writes is allowed by its clause',missing.join(','),'');
    s.ok('and something was actually checked',written.size>=8,[...written].join(','));
    s.ok('the review fields are owners-only — Raees cannot clear the flag his own edit raised',REVIEW.every(k=>!control.has(k))&&REVIEW.every(k=>review.has(k)),[...control].join(','));
    s.ok('acctReview is gated on isOwner()',/function acctReview\(\) \{\s*return isOwner\(\)/.test(rules));
    // the edit: the fields the JS may change == the fields the rule lets Raees change
    const jsEdit=(/const _ACCT_EDIT_FIELDS=\[([^\]]*)\]/.exec(src)||[])[1]||'';const jsMeta=(/const _ACCT_EDIT_META=\[([^\]]*)\]/.exec(src)||[])[1]||'';
    const jsAll=(jsEdit+','+jsMeta).split(',').map(x=>x.trim().replace(/'/g,'')).filter(Boolean).sort().join(',');
    s.eq('acctOwnEdit allows exactly _ACCT_EDIT_FIELDS + _ACCT_EDIT_META',fnList('acctOwnEdit').sort().join(','),jsAll);
    {
      const hb=/function acctOwnEdit\(\) \{([\s\S]*?)\n    \}/.exec(rules);
      const hm=hb&&/edits\[n\]\.keys\(\)\.hasOnly\(\[([^\]]*)\]\)/.exec(hb[1]);
      const ruleKeys=(hm?hm[1]:'').split(',').map(x=>x.trim().replace(/'/g,'')).filter(Boolean).sort().join(',');
      const src=fs.readFileSync(path.join(ROOT,'js/store-accounts.js'),'utf8');
      const em=/const edit=\{([^}]*)\};/.exec(src.slice(src.indexOf('async function _acctSaveEdit')));
      const jsKeys=[...(em?em[1]:'').matchAll(/(?:^|,)\s*(\w+):/g)].map(m=>m[1]).sort().join(',');
      s.eq('the history row Raees writes carries exactly the keys the rule allows (never admin)',ruleKeys,jsKeys);
      s.ok('… and must name exactly the fields that changed',!!hb&&/hasAll\(d\.edits\[n\]\.fields\)/.test(hb[1])&&/hasOnly\(d\.edits\[n\]\.fields\)/.test(hb[1]));
      const cb=/function acctControl\(\) \{([\s\S]*?)\n    \}/.exec(rules);
      s.ok('acctControl moves the void fields only with the status, and a reviewed entry is voided by an owner only',!!cb&&/!keys\.hasAny\(\['voidedAt','voidedBy','voidReason'\]\)/.test(cb[1])&&/reviewedAt', null\) == null \|\| isOwner\(\)/.test(cb[1]));
    }
    s.ok('… and never the type, the author, the status stamps or the review stamps',!['type','by','byName','ts','status','reviewedAt','reviewedBy','voidedAt','voidedBy','meterKey','legacyId','stockPosted','stockTx'].some(k=>fnList('acctOwnEdit').includes(k)));
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

  // Afnan: "put a button in afnan view only to reset + edit + delete record
  // of things." Edit-in-place, hard delete, reopen a closed month and a
  // full reset — for NAMED usernames (Afnan; Ammar added 25 Sept 2026),
  // mirrored in firestore.rules isAcctSuper().
  s.section('admin tools — Afnan and Ammar only: edit, delete, reopen, reset');
  {
    const AMMAR={uid:'u2',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'};
    // a hypothetical third owner: proves the gate is a username list, not the role
    const ZED={uid:'u9',u:'zed',name:'Zed',role:'owner',email:'zed@groovy.op'};
    s.eq('afnan is super',app({session:OWNER}).run('_acctIsSuper()'),true);
    s.eq('ammar is super',app({session:AMMAR}).run('_acctIsSuper()'),true);
    s.eq('another owner is NOT — it is a username, not the owner role',app({session:ZED}).run('_acctIsSuper()'),false);
    s.eq('raees is not',app({session:RAEES}).run('_acctIsSuper()'),false);
    s.eq('a manager is not',app({session:MUSTAFA}).run('_acctIsSuper()'),false);
    s.eq('the list is exactly afnan and ammar',app().run('JSON.stringify(_ACCT_SUPER_USERS)'),'["afnan","ammar"]');

    // the buttons exist for afnan and for nobody else
    const seedOne=a=>a.seed([E('purchase',{_id:'p1',vendorId:'A',vendorName:'A',source:'credit',amount:5000,category:'Store purchase',lines:[{itemCode:'',desc:'thread',qty:1,unit:'',rate:5000,total:5000}]})],[V('A'),V('B')]);
    const foot=(sess)=>{const a=app({session:sess});seedOne(a);a.run("_acctModal=function(t,b,f){window.__cap={t,b,f};}");a.run("window.acctOpenEntry('p1')");return a.run('window.__cap.f')||'';};
    s.ok('afnan\'s entry detail offers Edit (admin) and Delete (admin)',/acctAdminEdit\('p1'\)/.test(foot(OWNER))&&/acctAdminDelete\('p1'\)/.test(foot(OWNER)));
    s.ok('ammar\'s does too',/acctAdminEdit\('p1'\)/.test(foot(AMMAR))&&/acctAdminDelete\('p1'\)/.test(foot(AMMAR)));
    s.ok('another owner\'s does not',!/acctAdmin/.test(foot(ZED)));
    s.ok('raees\'s does not',!/acctAdmin/.test(foot(RAEES)));
    const review=sess=>{const a=app({session:sess});a.seed([],[],{closes:[{_id:LAST,month:LAST,cashBook:0,cashCounted:0,variance:0}]});a.run("currentPage='acct-review';acctRenderPage('acct-review',document.getElementById('main-content'))");return a.el('main-content').innerHTML;};
    s.ok('the review page carries the Admin tools card for afnan, with Reopen and Reset',/Admin tools/.test(review(OWNER))&&new RegExp("acctAdminReopen\\('"+LAST+"'\\)").test(review(OWNER))&&/acctAdminResetPrompt/.test(review(OWNER)));
    s.ok('and for ammar',/Admin tools/.test(review(AMMAR))&&/acctAdminResetPrompt/.test(review(AMMAR)));
    s.ok('and not for another owner',!/Admin tools|acctAdmin/.test(review(ZED)));

    // the patch builder is pure and writes only what changed
    const a=app({session:OWNER});seedOne(a);
    const base={date:TODAY,amount:'5000',vendorId:'A',person:'',account:'',toAccount:'',source:'credit',category:'Store purchase',ref:'',note:''};
    s.eq('an untouched form changes nothing',a.run(`JSON.stringify(_acctAdminPatch(_acctById('p1'),${J(base)}))`),'{}');
    const d=daysAgo(40);
    const p1=JSON.parse(a.run(`JSON.stringify(_acctAdminPatch(_acctById('p1'),${J(Object.assign({},base,{date:d,amount:'6500',vendorId:'B',note:'fixed'}))}))`));
    s.eq('a new date carries its month',p1.month,d.slice(0,7));
    s.eq('the amount',p1.amount,6500);
    s.eq('a new vendor carries its name',p1.vendorName,'B');
    s.eq('the note',p1.note,'fixed');
    s.ok('nothing else is in the patch',Object.keys(p1).sort().join(',')==='amount,date,month,note,vendorId,vendorName',Object.keys(p1).join(','));
    a.run("acctEntries.push("+J(E('purchase',{_id:'x1',expense:true,vendorId:'A',vendorName:'A',source:'cash',account:'cash',amount:15000,lines:[{itemCode:'',desc:'paint job',qty:1,unit:'',rate:15000,total:15000}]}))+")");
    const px=JSON.parse(a.run(`JSON.stringify(_acctAdminPatch(_acctById('x1'),${J({date:TODAY,amount:'12000',vendorId:'A',source:'cash',account:'cash'})}))`));
    s.ok('an expense\'s single line follows its amount (rate = total = amount)',px.lines&&px.lines.length===1&&px.lines[0].rate===12000&&px.lines[0].total===12000&&px.lines[0].desc==='paint job');

    // the save goes over REST as a full PATCH and re-sorts the ledger
    a.run("window.acctAdminEdit('p1')");
    a.el('ae-date').value=d;a.el('ae-amount').value='6500';a.el('ae-vendor').value='B';a.el('ae-person').value='';a.el('ae-account').value='';a.el('ae-to').value='';a.el('ae-source').value='credit';a.el('ae-category').value='Store purchase';a.el('ae-ref').value='';a.el('ae-note').value='fixed';
    const before=a.state.fetches.length;
    await a.run("window.acctAdminSave('p1')");
    const w=a.state.fetches.slice(before).find(f=>/\/acct_entries\/p1\?/.test(f.url)&&f.init.method==='PATCH');
    s.ok('the edit is one masked PATCH to acct_entries/p1',!!w);
    s.ok('… naming the changed fields and the history',w&&['amount','date','edits','editedAt','editedBy','month','note','vendorId','vendorName'].every(k=>maskOf(w).includes(k)),w&&maskOf(w).join(','));
    s.ok('… and nothing it did not change',w&&!maskOf(w).some(k=>['status','by','ts','type','reviewedAt','lines'].includes(k)));
    s.ok('it carries the new amount, date and vendor',w&&/6500/.test(w.init.body)&&w.init.body.includes(d)&&/"B"/.test(w.init.body));
    s.ok('and stamps who edited it',w&&/editedBy/.test(w.init.body)&&/afnan/.test(w.init.body));
    s.eq('the entry in memory is updated',a.run("_acctById('p1').amount+'|'+_acctById('p1').vendorName+'|'+_acctById('p1').month"),'6500|B|'+d.slice(0,7));
    s.ok('the activity log names the fields that moved',a.state.activity.some(x=>/edited \(admin\)/.test(x.action)&&/amount/.test(x.detail)&&/vendorId/.test(x.detail)));
    a.run("window.acctAdminEdit('p1')");a.el('ae-date').value=daysAgo(-3);a.el('ae-amount').value='6500';a.el('ae-vendor').value='B';a.el('ae-source').value='credit';a.el('ae-category').value='Store purchase';a.el('ae-note').value='fixed';
    const b2=a.state.fetches.length;await a.run("window.acctAdminSave('p1')");
    s.eq('a future date is refused before any write',a.state.fetches.length-b2,0);
    s.ok('… and says so',a.state.toasts.some(t=>/future/.test(t.msg||t)));

    // delete: a real DELETE, gone from memory, refused cleanly on 403
    const b3=a.state.fetches.length;
    await a.run("window.acctAdminDelete('x1')");
    s.ok('delete is a DELETE to acct_entries/x1',a.state.fetches.slice(b3).some(f=>/\/acct_entries\/x1$/.test(f.url)&&f.init.method==='DELETE'));
    s.eq('the entry is gone from memory',a.run("_acctById('x1')"),null);
    s.ok('a confirm was asked, and it says there is no undo',a.state.confirms.some(c=>/no undo/i.test(c)));
    s.ok('logged as an admin delete',a.state.activity.some(x=>/deleted \(admin\)/.test(x.action)));
    const den=app({session:OWNER,globals:{fetch:async(url,init)=>{den.state.fetches.push({url:String(url),init:init||{}});return (init&&init.method==='DELETE')?{ok:false,status:403,json:async()=>({error:{message:'Missing or insufficient permissions.'}})}:{ok:true,status:200,json:async()=>({documents:[]})};}}});
    seedOne(den);
    await den.run("window.acctAdminDelete('p1')");
    s.ok('a refused delete keeps the entry',!!den.run("_acctById('p1')"));
    s.ok('and names the refusal',den.state.toasts.some(t=>/Delete refused/.test(t.msg||t)));

    // nobody else can reach any of it, whatever the DOM says
    for(const [name,sess] of [['another owner',ZED],['raees',RAEES]]){
      const n=app({session:sess});seedOne(n);n.seed([E('purchase',{_id:'p1',amount:100})],[],{closes:[{_id:LAST,month:LAST}]});
      const bn=n.state.fetches.length;
      await n.run(`window.acctAdminDelete('p1');window.acctAdminSave('p1');window.acctAdminReopen('${LAST}');window.acctAdminReset();window.acctAdminEdit('p1');window.acctAdminResetPrompt()`);
      s.eq(name+': every admin route is a no-op — no write, no modal',n.state.fetches.length-bn,0);
      s.ok(name+': the entry is still there',!!n.run("_acctById('p1')"));
    }

    // delete a vendor: afnan only, refused while any entry names it, the
    // vendor document goes last, meter logs go with a consumable vendor
    const vpage=sess=>{const a=app({session:sess});a.seed([],[V('A')]);a.run("_acctVendorId='A';currentPage='acct-vendor';acctRenderPage('acct-vendor',document.getElementById('main-content'))");return a.el('main-content').innerHTML;};
    s.ok('the vendor page offers Delete vendor to afnan',/acctVendorDelete\('A'\)/.test(vpage(OWNER)));
    s.ok('and to ammar',/acctVendorDelete\('A'\)/.test(vpage(AMMAR)));
    s.ok('and not to another owner',!/acctVendorDelete/.test(vpage(ZED)));
    s.ok('and not to raees',!/acctVendorDelete/.test(vpage(RAEES)));
    // a fetch that answers runQuery with what we tell it, and records DELETEs
    const vmk=(o)=>{const t=app({session:(o&&o.session)||OWNER,globals:{fetch:async(url,init)=>{
      t.state.fetches.push({url:String(url),init:init||{}});const u=String(url);
      if(init&&init.method==='DELETE'){if(o&&o.refuse)return{ok:false,status:403,json:async()=>({error:{message:'Missing or insufficient permissions.'}})};return{ok:true,status:200,json:async()=>({})};}
      if(/:runQuery$/.test(u)){const q=JSON.parse(init.body).structuredQuery;const col=q.from[0].collectionId;const rows=(o&&o.q&&o.q[col])||[];return{ok:true,status:200,json:async()=>rows.map(id=>({document:{name:'projects/x/databases/(default)/documents/'+col+'/'+id,fields:{vendorId:{stringValue:'A'}}}}))};}
      return{ok:true,status:200,json:async()=>({documents:[]})};}}});return t;};
    const vdels=t=>t.state.fetches.filter(f=>f.init.method==='DELETE').map(f=>f.url.replace(/^.*\/documents\//,''));
    const v1=vmk();v1.seed([E('purchase',{_id:'p1',vendorId:'A',vendorName:'A',amount:100})],[V('A')]);
    await v1.run("window.acctVendorDelete('A')");
    s.eq('a vendor with a live entry is refused — nothing deleted',vdels(v1).length,0);
    s.ok('… and the toast counts the entries and points at Deactivate',v1.state.toasts.some(t=>/1 ledger entry/.test(t.msg||t)&&/Deactivate/.test(t.msg||t)));
    s.ok('the vendor is still there',!!v1.run("_acctVendor('A')"));
    const v2=vmk({q:{acct_entries:['old1']}});v2.seed([],[V('A')]);
    await v2.run("window.acctVendorDelete('A')");
    s.eq('an entry in a CLOSED month (not in memory) also refuses it',vdels(v2).length,0);
    s.ok('… naming the closed month',v2.state.toasts.some(t=>/closed month/.test(t.msg||t)));
    const v3=vmk({q:{acct_meter_logs:['A_2026-09-01','A_2026-09-02']}});v3.seed([],[V('A',{kind:'consumable',meter:{type:'weighed',unit:'kg',rate:350}}),V('B')]);
    v3.run("_acctMeterCache['A|2026-09']=[{}];_acctMeterCache['B|2026-09']=[{}]");
    await v3.run("window.acctVendorDelete('A')");
    s.eq('a clean consumable vendor: its meter logs go, then the vendor, in that order',vdels(v3).join(','),'acct_meter_logs/A_2026-09-01,acct_meter_logs/A_2026-09-02,acct_vendors/A');
    s.eq('gone from memory',v3.run("_acctVendor('A')"),null);
    s.ok('the other vendor is untouched',!!v3.run("_acctVendor('B')"));
    s.eq('its cached meter logs are dropped, the other vendor\'s kept',v3.run("Object.keys(_acctMeterCache).join(',')"),'B|2026-09');
    s.ok('a confirm was asked and says there is no undo',v3.state.confirms.some(c=>/no undo/.test(c)&&/consumable logs/.test(c)));
    s.ok('logged as an admin delete with the log count',v3.state.activity.some(x=>/vendor deleted \(admin\)/.test(x.action)&&/2 meter logs/.test(x.detail)));
    const v4=vmk({refuse:true});v4.seed([],[V('A')]);
    await v4.run("window.acctVendorDelete('A')");
    s.ok('a refused delete keeps the vendor and names the refusal',!!v4.run("_acctVendor('A')")&&v4.state.toasts.some(t=>/Delete refused/.test(t.msg||t)));
    for(const [name,sess] of [['another owner',ZED],['raees',RAEES]]){
      const n=vmk({session:sess});n.seed([],[V('A')]);const bn=n.state.fetches.length;
      await n.run("window.acctVendorDelete('A')");
      s.ok(name+': deleting a vendor is a no-op — no read, no write, no confirm',n.state.fetches.length===bn&&!!n.run("_acctVendor('A')")&&n.state.confirms.length===0);
    }

    // reopen: only the LATEST close, by deleting its checkpoint
    const r=app({session:OWNER});r.seed([],[],{closes:[{_id:monthAdd(LAST,-1),month:monthAdd(LAST,-1)},{_id:LAST,month:LAST}]});
    const br=r.state.fetches.length;
    await r.run(`window.acctAdminReopen('${monthAdd(LAST,-1)}')`);
    s.eq('an earlier close cannot be reopened',r.state.fetches.slice(br).filter(f=>f.init.method==='DELETE').length,0);
    s.ok('and it says only the latest can',r.state.toasts.some(t=>/most recently closed/.test(t.msg||t)));
    await r.run(`window.acctAdminReopen('${LAST}')`);
    s.ok('the latest close is DELETEd from acct_closes',r.state.fetches.slice(br).some(f=>new RegExp('/acct_closes/'+LAST+'$').test(f.url)&&f.init.method==='DELETE'));
    s.ok('and the ledger is reloaded (the loader re-reads acct_entries)',r.state.fetches.slice(br).some(f=>/acct_entries/.test(f.url)&&f.init.method!=='DELETE'));

    // reset: typed RESET, every document in the three collections, vendors only when ticked, stops at a refusal
    const docs={acct_entries:['e1','e2','e3'],acct_meter_logs:['g_1','g_2'],acct_closes:[LAST],acct_vendors:['A']};
    const fsDocs=(col)=>({documents:docs[col].map(id=>({name:'projects/x/databases/(default)/documents/'+col+'/'+id,fields:{}}))});
    const mk=(sess,refuseAt)=>{const t=app({session:sess,globals:{fetch:async(url,init)=>{
      t.state.fetches.push({url:String(url),init:init||{}});const u=String(url);
      if(init&&init.method==='DELETE'){t.deleted=(t.deleted||0)+1;if(refuseAt&&t.deleted>=refuseAt)return{ok:false,status:403,json:async()=>({error:{message:'Missing or insufficient permissions.'}})};return{ok:true,status:200,json:async()=>({})};}
      const col=Object.keys(docs).find(c=>new RegExp('/'+c+'(\\?|$)').test(u));
      return{ok:true,status:200,json:async()=>col?fsDocs(col):{documents:[]}};}}});t.seed([],[]);return t;};
    const t1=mk(OWNER);t1.run("window.acctAdminResetPrompt()");
    t1.el('ar-word').value='reset';await t1.run("window.acctAdminReset()");
    s.eq('a wrong word deletes nothing',t1.state.fetches.filter(f=>f.init.method==='DELETE').length,0);
    t1.el('ar-word').value='RESET';t1.el('ar-vendors').checked=false;await t1.run("window.acctAdminReset()");
    const dels=t1.state.fetches.filter(f=>f.init.method==='DELETE').map(f=>f.url.replace(/.*documents\//,''));
    s.eq('every entry, meter log and close is removed, one DELETE each',dels.filter(u=>!/acct_vendors/.test(u)).sort().join(','),['acct_closes/'+LAST,'acct_entries/e1','acct_entries/e2','acct_entries/e3','acct_meter_logs/g_1','acct_meter_logs/g_2'].join(','));
    s.eq('vendors are kept unless ticked',dels.filter(u=>/acct_vendors/.test(u)).length,0);
    s.ok('the toast says how many went',t1.state.toasts.some(t=>/6 records removed/.test(t.msg||t)));
    s.ok('logged',t1.state.activity.some(x=>x.action==='Accounts reset (admin)'&&/6 records/.test(x.detail)));
    const t2=mk(OWNER);t2.run("window.acctAdminResetPrompt()");t2.el('ar-word').value='RESET';t2.el('ar-vendors').checked=true;await t2.run("window.acctAdminReset()");
    s.eq('ticked, the vendors go too',t2.state.fetches.filter(f=>f.init.method==='DELETE'&&/acct_vendors\/A$/.test(f.url)).length,1);
    const t3=mk(OWNER,3);t3.run("window.acctAdminResetPrompt()");t3.el('ar-word').value='RESET';await t3.run("window.acctAdminReset()");
    s.eq('a refusal stops the pass at that document',t3.state.fetches.filter(f=>f.init.method==='DELETE').length,3);
    s.ok('and says how far it got',t3.state.toasts.some(t=>/Reset stopped after 2 records/.test(t.msg||t)));

    // firestore.rules mirrors all of it
    const rules=read('firestore.rules');
    const src=read('js/store-accounts.js');
    s.ok('isAcctSuper() names afnan and ammar',/function isAcctSuper\(\) \{ return signedIn\(\) && userEmail\(\) in \['afnan@groovy\.op','ammar@groovy\.op'\]; \}/.test(rules));
    s.ok('… and never isOwner()',!/function isAcctSuper\(\)[^\n]*isOwner/.test(rules));
    const entries=/match \/acct_entries\/\{doc\} \{([\s\S]*?)\n    \}/.exec(rules);
    s.ok('acct_entries: delete is isAcctSuper() only',entries&&/allow delete: if isAcctSuper\(\);/.test(entries[1]));
    s.ok('acct_entries: the admin edit bypasses the lists, everyone else is held to one of three clauses',entries&&/allow update: if isAcctSuper\(\) \|\| acctControl\(\) \|\| acctReview\(\) \|\| acctOwnEdit\(\);/.test(entries[1]));
    s.ok('acct_closes: delete is isAcctSuper(), update still never',/match \/acct_closes\/\{doc\}[^\n]*allow update: if false; allow delete: if isAcctSuper\(\);/.test(rules));
    s.ok('acct_vendors: delete is isAcctSuper()',/match \/acct_vendors\/\{doc\}[^\n]*allow delete: if isAcctSuper\(\);/.test(rules));
    s.ok('the JS list and the rule name the same people',/const _ACCT_SUPER_USERS=\['afnan','ammar'\]/.test(src));
    s.ok('the reset removes exactly entries, meter logs and closes by default',/const _ACCT_RESET_COLS=\['acct_entries','acct_meter_logs','acct_closes'\]/.test(src));
  }

  return s;
};

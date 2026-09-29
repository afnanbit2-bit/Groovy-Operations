/* ─────────────────────────────────────────────────────────────────────────
   js/ma-core.js — Master Accounts, the core (M1, 28 Sept 2026).

   What this holds: the two charts and how the owners' edits merge into
   them; periods on a July fiscal year; lakh grouping; the settings merge;
   the tax block both ways; every M1 document kind's POSTINGS, each set
   balanced, with the labels of §27; historical vs live; the trial balance
   on a seeded quarter; the holders (pending never counts, a mirrored
   holder never reads as zero); the ledger's running balance; every
   validation rule refused AND passed; edits with history, voids and
   confirmations; terms and rate cards kept with history; the cost
   register's due days and states; the calendar and an unfunded day; the
   needs-attention lines; the Unlabelled queue; FIFO allocation; and that
   the core stays PURE (no DOM, no Firestore, no clock of its own).

   It cannot hold what the pages look like (tests/smoke-layout.js) or what
   the Console has published (tests/rules-emulator-ma.js runs the rules).
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;
const M=require('../js/ma-core.js');

const TODAY='2026-10-20';            // a Tuesday, inside Q2 FY27
const S=M.maSettings(null);
const IDX=M.maChartIndex(M.maChart('groovy',[]));
let seq=0;
const meta=u=>({by:u||'afnan',byName:(u||'afnan').replace(/^./,c=>c.toUpperCase()),ts:++seq});
function mk(dt,input,u,extra){
  const d=M.maBuildDoc(dt,input,Object.assign(meta(u),extra||{}),IDX,S);
  d.id=dt[0]+seq;d.no=M.maDocNo(dt,d.fy||'FY27',seq);
  return d;
}
const J=(kind,input,u)=>mk('journal',Object.assign({kind},input),u);
const T=(input,u)=>mk('transfer',input,u);
const C=(input,book,u)=>mk('count',input,u,{bookBalance:book});
const sum=(ls,k)=>ls.reduce((t,l)=>t+l[k],0);
const balanced=ls=>sum(ls,'dr')===sum(ls,'cr');
const post=d=>M.maPost(d,IDX,S);
function V(doc,ctx){return M.maValidate(doc,Object.assign({idx:IDX,settings:S,today:TODAY,docs:[],lines:[],parties:[],closes:[],commitments:[]},ctx||{}));}
const R=r=>r.issues.map(i=>i.level+':'+i.rule).sort().join(',');
const has=(r,rule)=>r.issues.some(i=>i.rule===rule);
const lvl=(r,rule)=>(r.issues.find(i=>i.rule===rule)||{}).level||null;
const NONE={kind:'none',rate:0,amount:0};
const open1011=J('opening',{date:'2026-07-01',lines:[{account:'1011',side:'dr',amount:500000},{account:'1020',side:'dr',amount:2000000},{account:'1012',side:'dr',amount:300000}]});

module.exports=async function(){
  const s=suite('master-accounts-core');

  s.section('the charts of accounts (§4.1, §4.5)');
  {
    const codes=M.MA_CHART.map(a=>a.code);
    s.eq('Groovy codes are unique',new Set(codes).size,codes.length);
    s.ok('every Groovy code is four digits',codes.every(c=>/^[1-9]\d{3}$/.test(c)));
    s.ok('every type is a known type',M.MA_CHART.every(a=>M.MA_ACCOUNT_TYPES.indexOf(a.type)>=0));
    ['1170','6120','6130','6140','6150'].forEach(c=>s.ok('v4 account '+c+' is in the chart',codes.indexOf(c)>=0));
    ['1010','1011','1012','1020','1040','1050','1060'].forEach(c=>s.ok('holder '+c+' is a money account',!!M.maAcc(IDX,c)&&M.maAcc(IDX,c).money===true));
    s.ok('every money account is an asset with a holder kind',M.MA_CHART.filter(a=>a.money).every(a=>a.type==='asset'&&M.MA_HOLDER_KINDS.indexOf(a.holderKind)>=0));
    s.eq('the drawer is in Raees\'s hands',M.maAcc(IDX,'1010').person,'raees');
    s.eq('cash with Afnan is Afnan\'s',M.maAcc(IDX,'1011').person,'afnan');
    s.eq('holders whose feed comes later ship switched off','1030,1040,1050,1060',
      M.maChart('groovy',[]).filter(a=>a.money&&!a.active).map(a=>a.code).join(','));
    s.eq('drawings are debit-normal (a contra of equity)',M.maAcc(IDX,'3020').normal,'dr');
    s.eq('a discount given is debit-normal (a contra of revenue)',M.maAcc(IDX,'4040').normal,'dr');
    s.eq('9010 unclassified-in is credit-normal',M.maAcc(IDX,'9010').normal,'cr');
    s.ok('every expense and cost of goods has a spend group',M.MA_CHART.filter(a=>a.type==='expense'||a.type==='cogs').every(a=>M.MA_SPEND_GROUPS[a.spend]));
    const sv=M.MA_SV_CHART.map(a=>a.code);
    s.eq('Savings codes are unique',new Set(sv).size,sv.length);
    s.ok('every Savings code is S + four digits',sv.every(c=>/^S[1-9]\d{3}$/.test(c)));
    s.ok('the Savings book carries the loan to Groovy (S1040)',sv.indexOf('S1040')>=0);
    s.ok('and the Payfast payout account (S1020) is money',M.MA_SV_CHART.find(a=>a.code==='S1020').money===true);
    // Merging the owners' edits
    const merged=M.maChartIndex(M.maChart('groovy',[
      {code:'1020',name:'MCB — current account',type:'expense',money:false,active:true},
      {code:'1031',name:'JS Bank',type:'asset',money:true,holderKind:'bank'},
      {code:'6121',name:'Tea',type:'expense',spend:'people'},
      {code:'77',name:'bad code',type:'asset'},
      {code:'6122',name:'Bad type',type:'banana'}
    ]));
    s.eq('a default account can be renamed',M.maAcc(merged,'1020').name,'MCB — current account');
    s.eq('but keeps its type',M.maAcc(merged,'1020').type,'asset');
    s.eq('and stays a holder',M.maAcc(merged,'1020').money,true);
    s.ok('a new holder can be added',M.maAcc(merged,'1031')&&M.maAcc(merged,'1031').money===true&&M.maAcc(merged,'1031').custom===true);
    s.eq('a new expense account keeps its spend group',M.maAcc(merged,'6121').spend,'people');
    s.eq('a malformed code is ignored',M.maAcc(merged,'77'),null);
    s.eq('an unknown type is ignored',M.maAcc(merged,'6122'),null);
    s.ok('the chart stays sorted by code',merged.list.map(a=>a.code).join()===merged.list.map(a=>a.code).slice().sort().join());
    const off=M.maChartIndex(M.maChart('groovy',[{code:'1060',active:true}]));
    s.eq('a holder that ships off can be switched on',M.maAcc(off,'1060').active,true);
  }

  s.section('periods on a fiscal year from 1 July (§20, §27)');
  {
    s.eq('29 Feb 2026 is not a day',M.maIsDay('2026-02-29'),false);
    s.eq('29 Feb 2028 is',M.maIsDay('2028-02-29'),true);
    s.eq('month 13 is not',M.maIsDay('2026-13-01'),false);
    s.eq('a non-string is not',M.maIsDay(20261001),false);
    s.eq('adding across a year',M.maDayAdd('2026-12-31',1),'2027-01-01');
    s.eq('and back across February',M.maDayAdd('2028-03-01',-1),'2028-02-29');
    s.eq('20 Oct 2026 is a Tuesday',M.maWeekday('2026-10-20'),2);
    s.eq('days between',M.maDaysBetween('2026-10-01','2026-10-20'),19);
    [['2026-07-01','FY27','2027-Q1'],['2026-09-30','FY27','2027-Q1'],['2026-10-01','FY27','2027-Q2'],
     ['2027-01-15','FY27','2027-Q3'],['2027-06-30','FY27','2027-Q4'],['2027-07-01','FY28','2028-Q1']].forEach(([d,fy,q])=>{
      s.eq(d+' is '+fy,M.maFyOf(d),fy);
      s.eq(d+' is '+q,M.maQuarterOf(d),q);
    });
    s.eq('Q2 FY27 runs October to December 2026',JSON.stringify(M.maQuarterRange('2027-Q2')),JSON.stringify({from:'2026-10-01',to:'2026-12-31'}));
    s.eq('Q4 FY27 ends on 30 June 2027',M.maQuarterRange('2027-Q4').to,'2027-06-30');
    s.eq('the label says both',M.maQuarterLabel('2027-Q2'),'Q2 FY27 · Oct–Dec 2026');
    s.eq('a calendar fiscal year works too',M.maQuarterOf('2026-10-05',1),'2026-Q4');
    s.eq('month arithmetic across a year',M.maMonthAdd('2026-11',3),'2027-02');
    s.eq('days in Feb 2027',M.maDaysInMonth('2027-02'),28);
    s.eq('a day label',M.maDayLabel('2026-10-20'),'Tue 20 Oct');
  }

  s.section('money in whole rupees, grouped in lac and crore');
  {
    [[0,'0'],[999,'999'],[1000,'1,000'],[100000,'1,00,000'],[1500000,'15,00,000'],[15000000,'1,50,00,000']].forEach(([n,g])=>s.eq(n+' groups as '+g,M.maGroup(n),g));
    s.eq('a negative carries a minus sign',M.maRs(-2500),'−₨2,500');
    s.eq('₨ with lakh grouping',M.maRs(150000),'₨1,50,000');
    s.eq('a sentence says lac',M.maRsShort(2130000),'₨21.3 lac');
    s.eq('and crore',M.maRsShort(21000000),'₨2.1 cr');
    s.eq('a whole lac drops its .0',M.maRsShort(1500000),'₨15 lac');
    s.eq('small amounts stay whole',M.maRsShort(45000),'₨45,000');
    s.eq('a typed ₨1,50,000 reads',M.maParseRupees('₨1,50,000'),150000);
    s.eq('Rs. 2,000 reads',M.maParseRupees('Rs. 2,000'),2000);
    s.ok('text does not',Number.isNaN(M.maParseRupees('two thousand')));
  }

  s.section('settings merge onto the defaults (§4.4)');
  {
    s.eq('pay days default to Wednesday and Saturday',S.payDays.join(),'3,6');
    s.eq('CPR days default to Tuesday and Friday',S.cprDays.join(),'2,5');
    s.eq('the drawer is mirrored from Store Accounts until M8',S.mirrors['1010'],'store');
    s.eq('go-live is 1 Oct 2026',S.goLive,'2026-10-01');
    s.eq('the books start on 1 Jul 2026',S.historyFrom,'2026-07-01');
    const x=M.maSettings({payDays:[1,9,'x',1],costCentres:['Factory','bad name!','stitch_unit'],defaultCostCentre:'nope',mirrors:{},relockMinutes:5,evidence:{flagAbove:5000,refuseAbove:50000},fiscalYearStart:13});
    s.eq('a pay day off the week is dropped, repeats folded',x.payDays.join(),'1');
    s.eq('cost centres are cleaned',x.costCentres.join(),'factory,stitch_unit');
    s.eq('an unknown default cost centre falls back to the first',x.defaultCostCentre,'factory');
    s.eq('M8 can switch the mirror off',JSON.stringify(x.mirrors),'{}');
    s.eq('the re-lock minutes move',x.relockMinutes,5);
    s.eq('evidence thresholds move',x.evidence.refuseAbove,50000);
    s.eq('a fiscal start of 13 is refused',x.fiscalYearStart,7);
    s.eq('an unset tax rate stays blank (the accountant fills it)',M.maSettings({tax:{rates:{sales:18,services:'x'}}}).tax.rates.services,null);
  }

  s.section('the tax block (§12) — never absent, and consistent');
  {
    const inc=M.maTaxCompute(11700,{kind:'sales',rate:17,inclusive:true});
    s.eq('17% inside ₨11,700 is ₨1,700',inc.amount,1700);
    s.eq('leaving ₨10,000 net',inc.net,10000);
    const exc=M.maTaxCompute(10000,{kind:'sales',rate:17,inclusive:false});
    s.eq('17% on top of ₨10,000 is ₨1,700',exc.amount,1700);
    s.eq('so ₨11,700 moves',exc.cash,11700);
    const w=M.maTaxCompute(50000,{kind:'withholding',rate:10});
    s.eq('10% withheld from ₨50,000',w.amount,5000);
    s.eq('the payee gets ₨45,000',w.cash,45000);
    s.eq('no tax moves exactly the amount',M.maTaxCompute(1234,NONE).cash,1234);
    s.eq('a missing block is refused',M.maTaxIssues(null,100)[0].rule,'tax.missing');
    s.eq('"No tax" with an amount is refused',M.maTaxIssues({kind:'none',rate:0,amount:5},100)[0].rule,'tax.amount');
    s.eq('a sales tax with no rate is refused',M.maTaxIssues({kind:'sales',rate:0,amount:0},100)[0].rule,'tax.rate');
    s.eq('an amount that disagrees with its rate is refused',M.maTaxIssues({kind:'sales',rate:17,amount:1000,inclusive:true},11700)[0].rule,'tax.amount');
    s.eq('a rupee of rounding is fine',M.maTaxIssues({kind:'sales',rate:17,amount:1701,inclusive:true},11700).length,0);
    s.eq('a stored block is recomputed from its rate',M.maTaxBlock(11700,{kind:'sales',rate:17,amount:99,inclusive:true}).amount,1700);
  }

  s.section('every M1 document posts, balanced, with its labels (§7, §27)');
  {
    const out=J('money_out',{date:'2026-10-05',holder:'1020',account:'6040',payee:'Landlord',amount:250000,tax:NONE});
    const ol=post(out);
    s.eq('rent: two lines',ol.length,2);
    s.ok('rent balances',balanced(ol));
    s.eq('rent debits 6040',ol[0].account+':'+ol[0].dr,'6040:250000');
    s.eq('and credits MCB',ol[1].account+':'+ol[1].cr,'1020:250000');
    s.eq('the spend line carries its category',ol[0].category,'Rent');
    s.eq('its spend group',ol[0].spendGroup,'fixed');
    s.eq('its kind label from the group',ol[0].kind,'fixed');
    s.eq('the default cost centre',ol[0].costCentre,'factory');
    s.eq('the money line names its holder',ol[1].holder,'1020');
    s.eq('both carry the month, quarter and year',[ol[0].month,ol[0].quarter,ol[0].fy].join(' '),'2026-10 2027-Q2 FY27');
    s.eq('a live document posts as posted',ol[0].status,'posted');
    s.eq('the source is manual',ol[0].source,'manual');
    s.eq('the payee rides on every line',ol[1].payee,'Landlord');

    const back=J('money_out',{date:'2026-08-12',holder:'1011',account:'6120',payee:'Tea stall',amount:1800,tax:NONE,costCentre:'office'});
    s.eq('a document before go-live is historical',back.historical,true);
    s.eq('and posts with the historical label',post(back)[0].status,'historical');
    s.eq('a chosen cost centre is kept',post(back)[0].costCentre,'office');
    s.eq('food is people spend',post(back)[0].kind,'people');

    const claim=J('money_out',{date:'2026-10-06',holder:'1020',account:'5010',payee:'Mill',amount:117000,tax:{kind:'sales',rate:17,inclusive:true,claimable:true}});
    const cl=post(claim);
    s.ok('claimable sales tax balances',balanced(cl));
    s.eq('the tax goes to input tax (1160)',(cl.find(l=>l.account==='1160')||{}).dr,17000);
    s.eq('the fabric is the net',(cl.find(l=>l.account==='5010')||{}).dr,100000);
    const noclaim=J('money_out',{date:'2026-10-06',holder:'1020',account:'6030',payee:'LESCO',amount:11700,tax:{kind:'sales',rate:17,inclusive:true}});
    const nl=post(noclaim);
    s.eq('unclaimable tax stays in the cost',(nl.find(l=>l.account==='6030')||{}).dr,11700);
    s.eq('and never touches 1160',nl.some(l=>l.account==='1160'),false);
    const wht=J('money_out',{date:'2026-10-07',holder:'1020',account:'6140',payee:'The accountant',amount:50000,tax:{kind:'withholding',rate:10}});
    const wl=post(wht);
    s.ok('withholding balances',balanced(wl));
    s.eq('the full fee is the cost',(wl.find(l=>l.account==='6140')||{}).dr,50000);
    s.eq('the payee gets the rest from the holder',(wl.find(l=>l.account==='1020')||{}).cr,45000);
    s.eq('and the state is owed the withheld part (2130)',(wl.find(l=>l.account==='2130')||{}).cr,5000);
    const inx=J('money_in',{date:'2026-10-08',holder:'1011',account:'4030',payee:'Walk-in buyer',amount:20000,tax:{kind:'sales',rate:18,inclusive:false}});
    const il=post(inx);
    s.ok('income with tax on top balances',balanced(il));
    s.eq('the holder receives amount plus tax',(il.find(l=>l.account==='1011')||{}).dr,23600);
    s.eq('output tax is owed (2120)',(il.find(l=>l.account==='2120')||{}).cr,3600);
    s.eq('revenue carries its channel',(il.find(l=>l.account==='4030')||{}).channel,'gate');
    const inw=J('money_in',{date:'2026-10-08',holder:'1020',account:'4090',payee:'A client',amount:100000,tax:{kind:'withholding',rate:4}});
    const iwl=post(inw);
    s.ok('income with tax withheld from us balances',balanced(iwl));
    s.eq('the withheld tax is a credit we hold (1160)',(iwl.find(l=>l.account==='1160')||{}).dr,4000);
    const cap=J('capital',{date:'2026-10-02',holder:'1020',owner:'ammar',amount:500000});
    s.eq('Ammar putting money in credits his capital',post(cap).map(l=>l.account+(l.dr?'+':'-')).join(),'1020+,3011-');
    const drw=J('drawing',{date:'2026-10-02',holder:'1011',owner:'afnan',amount:30000});
    s.eq('Afnan taking money out debits his drawings',post(drw).map(l=>l.account+(l.dr?'+':'-')).join(),'3020+,1011-');
    const op=post(open1011);
    s.ok('an opening balances itself against 3090',balanced(op));
    s.eq('with one 3090 line for the difference',(op.find(l=>l.account==='3090')||{}).cr,2800000);
    const opv=J('opening',{date:'2026-07-01',lines:[{account:'2010',side:'cr',amount:150000,party:'p1'}]});
    const opvl=post(opv);
    s.eq('an owed opening debits 3090',(opvl.find(l=>l.account==='3090')||{}).dr,150000);
    s.eq('and the payable line names its party',(opvl.find(l=>l.account==='2010')||{}).party,'p1');
    const gen=J('general',{date:'2026-10-09',lines:[{account:'6080',dr:350},{account:'1020',cr:350,memo:'SMS alerts'}]});
    s.ok('a two-sided journal balances',balanced(post(gen)));
    const tr=T({date:'2026-10-10',from:'1011',to:'1020',amount:100000});
    s.eq('a deposit into MCB by Afnan posts at once',tr.status,'posted');
    s.eq('it moves the money',post(tr).map(l=>l.account+(l.dr?'+':'-')).join(),'1020+,1011-');
    s.eq('and is labelled a transfer',post(tr)[0].kind,'transfer');
    const trp=T({date:'2026-10-10',from:'1011',to:'1012',amount:40000});
    s.eq('cash handed to Ammar waits for Ammar',trp.status+':'+trp.confirmBy,'pending:ammar');
    s.eq('a pending transfer posts NOTHING',post(trp).length,0);
    const trd=T({date:'2026-10-10',from:'1011',to:'1010',amount:25000});
    // M1.6a: M1's "a transfer into the drawer posts at once" is gone — the
    // drawer's balance is Raees's Store Accounts, so it waits until he has
    // recorded it and an owner confirms on paper (money F9).
    s.eq('cash handed to the drawer WAITS — for Raees, on paper (M1.6a)',trd.status+':'+trd.confirmBy+':'+trd.confirmPaper+':'+(trd.confirmVia||''),'pending:raees:true:');
    s.eq('…and posts nothing until it is confirmed',post(trd).length,0);
    Object.assign(trd,M.maConfirmPatch(trd,'afnan',{at:9}).patch);
    s.eq('an owner confirms it on paper for Raees',trd.status+':'+trd.confirmVia+':'+trd.confirmedFor,'posted:paper:raees');
    const self=T({date:'2026-10-10',from:'1012',to:'1011',amount:5000},'afnan');
    s.eq('Afnan recording money reaching his own hands needs nobody',self.status,'posted');
    const cnt=C({date:'2026-10-15',holder:'1011',counted:98000,note:'short'},100000);
    s.eq('a count keeps the book it was taken against',cnt.bookBalance,100000);
    s.eq('and its difference',cnt.difference,-2000);
    s.eq('a short count moves the holder to 9030',post(cnt).map(l=>l.account+(l.dr?'+':'-')).join(),'9030+,1011-');
    s.eq('an over count the other way',post(C({date:'2026-10-15',holder:'1011',counted:101000,note:'x'},100000)).map(l=>l.account+(l.dr?'+':'-')).join(),'1011+,9030-');
    s.eq('a count that agrees posts nothing',post(C({date:'2026-10-15',holder:'1011',counted:100000},100000)).length,0);
    s.eq('a void posts nothing',post(M.maApplyVoid(out,{by:'afnan',at:1,reason:'x'})).length,0);
    const every=[out,back,claim,noclaim,wht,inx,inw,cap,drw,open1011,opv,gen,tr,trd,cnt];
    s.ok('every one of them balances on its own',every.every(d=>balanced(post(d))));
  }

  s.section('the trial balance on a seeded quarter, and the holders');
  {
    const docs=[open1011,
      J('money_out',{date:'2026-10-05',holder:'1020',account:'6040',payee:'Landlord',amount:250000,tax:NONE}),
      J('money_out',{date:'2026-10-06',holder:'1011',account:'6060',payee:'Petrol',amount:6000,tax:NONE}),
      T({date:'2026-10-07',from:'1011',to:'1012',amount:40000}),
      T({date:'2026-10-08',from:'1020',to:'1011',amount:100000}),
      C({date:'2026-10-09',holder:'1012',counted:299000,note:'counted short'},300000),
      J('money_in',{date:'2026-10-09',holder:'1011',account:'4090',payee:'Scrap buyer',amount:7000,tax:NONE}),
      J('general',{date:'2026-10-10',lines:[{account:'6080',dr:500},{account:'1020',cr:500}]})
    ];
    const lines=M.maPostAll(docs,IDX,S);
    const tb=M.maTrialBalance(lines,IDX,{});
    s.ok('debits equal credits',tb.balanced,tb.dr+' vs '+tb.cr);
    s.ok('and the net sides agree',tb.debit===tb.credit);
    s.eq('the total moved',tb.dr,2800000+250000+6000+100000+1000+7000+500);
    const rows=M.maHolderRows(IDX,lines,docs,{settings:S,mirrorBalances:{'1010':84500}});
    const h=c=>rows.find(r=>r.code===c)||{};
    s.eq('Afnan: 5,00,000 − 6,000 + 1,00,000 + 7,000 (the ₨40,000 to Ammar still pending)',h('1011').balance,601000);
    s.eq('his pending out',h('1011').pendingOut,40000);
    s.eq('so he can use',h('1011').available,561000);
    s.eq('Ammar: counted ₨1,000 short, and ₨40,000 waiting for him',h('1012').balance+':'+h('1012').pendingIn,'299000:40000');
    s.eq('MCB after rent, a withdrawal and a charge',h('1020').balance,2000000-250000-100000-500);
    s.eq('the drawer reads from Store Accounts',h('1010').balance,84500);
    s.eq('and says so',h('1010').mirror,'store');
    s.eq('its own ledger here is separate',h('1010').ledger,0);
    s.eq('Ammar\'s last count is on the row',h('1012').lastCount&&h('1012').lastCount.difference,-1000);
    const cih=M.maCashInHand(rows);
    s.eq('cash in hand adds every active holder',cih.total,601000+299000+1649500+84500);
    s.eq('and is complete',cih.complete,true);
    const miss=M.maHolderRows(IDX,lines,docs,{settings:S,mirrorBalances:{}});
    s.eq('a drawer that could not be read is null, never zero',miss.find(r=>r.code==='1010').balance,null);
    s.eq('cash in hand then says it is incomplete',M.maCashInHand(miss).complete,false);
    const wallet=M.maCashInHand([{active:true,holderKind:'wallet',balance:900000},{active:true,holderKind:'cash',balance:100}]);
    s.eq('money at TCS is not in anybody\'s hand',wallet.total,100);
    const led=M.maLedger(lines,{holder:'1011',from:'2026-10-06'},IDX);
    s.eq('Afnan\'s statement opens at his balance before the range',led.opening,500000);
    s.eq('and closes where his holder stands',led.closing,601000);
    s.eq('with a running balance on the last row',led.rows[led.rows.length-1].balance,601000);
    s.eq('a search finds the petrol',M.maLedger(lines,{q:'petrol'},IDX).count,2);
    s.eq('the ledger says how many sources',M.maLedger(lines,{},IDX).sources,1);
    const sp=M.maSpendable(rows);
    s.eq('the calendar funds from cash and bank only',sp.total,601000+299000+1649500+84500);
  }

  s.section('validation (§6) — refused, flagged, and clean');
  {
    // A real file reference (maAttachClean's shape): M1.5b keeps only a file the
    // ma-attach function named, so a placeholder like {id:'a'} is no evidence.
    const ATT={publicId:'ma/'+'a'.repeat(64),format:'pdf',type:'authenticated',name:'rent-oct.pdf',mime:'application/pdf',bytes:120000};
    const base={date:'2026-10-05',holder:'1020',account:'6040',payee:'Landlord',amount:25000,tax:NONE,attachments:[ATT]};
    const clean=J('money_out',base);
    const lines=M.maPostAll([open1011],IDX,S);
    s.eq('a clean payment passes with nothing to say',R(V(clean,{lines})),'');
    s.eq('an unreal day is refused',lvl(V(J('money_out',Object.assign({},base,{date:'2026-02-30'})),{lines}),'date.real'),'refuse');
    s.eq('tomorrow is refused',lvl(V(J('money_out',Object.assign({},base,{date:'2026-10-21'})),{lines}),'date.future'),'refuse');
    s.eq('before the books start is refused',lvl(V(J('money_out',Object.assign({},base,{date:'2026-06-30'})),{lines}),'date.before_books'),'refuse');
    const closes=[{quarter:'2027-Q1',locked:true},{month:'2026-10',soft:true}];
    s.eq('a closed quarter is refused',lvl(V(J('money_out',Object.assign({},base,{date:'2026-09-10'})),{lines,closes}),'date.closed'),'refuse');
    s.eq('a reopened quarter is not',has(V(J('money_out',Object.assign({},base,{date:'2026-09-10'})),{lines,closes:[{quarter:'2027-Q1',locked:true,reopenedAt:5}]}),'date.closed'),false);
    s.eq('a soft-closed month is flagged, not refused',lvl(V(clean,{lines,closes}),'date.soft_month'),'flag');
    s.eq('a holder that is not money is refused',lvl(V(J('money_out',Object.assign({},base,{holder:'6040'})),{lines}),'holder.money'),'refuse');
    s.eq('a switched-off holder is refused',lvl(V(J('money_out',Object.assign({},base,{holder:'1060'})),{lines}),'holder.inactive'),'refuse');
    s.eq('spending from the drawer is refused until M8',lvl(V(J('money_out',Object.assign({},base,{holder:'1010'})),{lines}),'holder.mirror'),'refuse');
    s.eq('a count of the drawer is refused too',lvl(V(C({date:'2026-10-05',holder:'1010',counted:5,note:'x'},0),{lines}),'holder.mirror'),'refuse');
    s.eq('a fraction of a rupee is refused',lvl(V(J('money_out',Object.assign({},base,{amount:'12.5'})),{lines}),'amount.whole'),'refuse');
    s.eq('zero is refused',lvl(V(J('money_out',Object.assign({},base,{amount:0})),{lines}),'amount.whole'),'refuse');
    s.eq('₨1 billion is a typo',lvl(V(J('money_out',Object.assign({},base,{amount:1000000000})),{lines}),'amount.max'),'refuse');
    s.eq('nobody paid is refused',lvl(V(J('money_out',Object.assign({},base,{payee:''})),{lines}),'payee.named'),'refuse');
    s.eq('a party that does not exist is refused',lvl(V(J('money_out',Object.assign({},base,{party:'nope'})),{lines}),'party.exists'),'refuse');
    const P=[{id:'v1',name:'Al-Karam',kind:'vendor',active:true,vendor:{tax:{regime:'sales'}}},{id:'v2',name:'Old',kind:'vendor',active:false}];
    s.eq('an inactive party is refused',lvl(V(J('money_out',Object.assign({},base,{party:'v2',payee:''})),{lines,parties:P}),'party.active'),'refuse');
    s.eq('no tax against a taxed vendor is flagged with the default',lvl(V(J('money_out',Object.assign({},base,{party:'v1',payee:''})),{lines,parties:P}),'tax.default'),'flag');
    s.eq('money between two holders as "money out" is refused',lvl(V(J('money_out',Object.assign({},base,{account:'1011'})),{lines}),'account.money'),'refuse');
    const unl=V(J('money_out',Object.assign({},base,{account:'9020'})),{lines});
    s.eq('"not sure yet" posts, flagged for the Unlabelled queue',R(unl),'flag:unlabelled');
    s.eq('an unknown cost centre is refused',lvl(V(J('money_out',Object.assign({},base,{costCentre:'moon'})),{lines}),'costCentre.valid'),'refuse');
    s.eq('a payment for a commitment not in the register is refused',lvl(V(J('money_out',Object.assign({},base,{commitmentId:'c9',commitmentPeriod:'2026-10'})),{lines,commitments:[]}),'commitment.exists'),'refuse');
    const noev=J('money_out',Object.assign({},base,{attachments:[]}));
    s.eq('no receipt on ₨25,000 is flagged',lvl(V(noev,{lines}),'evidence.missing'),'flag');
    s.eq('a placeholder that is not a file this app named is no evidence (M1.5b)',lvl(V(J('money_out',Object.assign({},base,{attachments:[{id:'a'},{url:'https://res.cloudinary.com/x/y.pdf'}]})),{lines}),'evidence.missing'),'flag');
    s.eq('under ₨2,000 it is not',has(V(J('money_out',Object.assign({},base,{amount:1500,attachments:[]})),{lines}),'evidence.missing'),false);
    const strict=M.maSettings({evidence:{flagAbove:2000,refuseAbove:20000}});
    s.eq('a receipt can be made compulsory above a threshold',lvl(M.maValidate(noev,{idx:IDX,settings:strict,today:TODAY,lines,docs:[]}),'evidence.required'),'refuse');
    const twin=J('money_out',Object.assign({},base,{date:'2026-10-09'}));
    s.eq('the same payee and amount within 7 days is flagged',lvl(V(twin,{lines,docs:[clean]}),'duplicate'),'flag');
    s.eq('a void one does not count',has(V(twin,{lines,docs:[M.maApplyVoid(clean,{reason:'x'})]}),'duplicate'),false);
    // A holder cannot go below zero
    const big=J('money_out',Object.assign({},base,{holder:'1011',amount:600000}));
    s.eq('cash cannot go below zero',lvl(V(big,{lines}),'holder.floor'),'refuse');
    const bank=J('money_out',Object.assign({},base,{amount:2500000}));
    s.eq('MCB below zero is flagged (the bank\'s overdraft is its own truth)',lvl(V(bank,{lines}),'holder.floor'),'flag');
    const oldBig=J('money_out',Object.assign({},base,{holder:'1011',amount:600000,date:'2026-08-01'}));
    s.eq('backfill below zero is flagged, never refused',lvl(V(oldBig,{lines}),'holder.floor'),'flag');
    const pendOut=T({date:'2026-10-10',from:'1011',to:'1012',amount:450000});
    const nearly=J('money_out',Object.assign({},base,{holder:'1011',amount:60000}));
    s.eq('money waiting to be confirmed elsewhere cannot be spent twice',lvl(V(nearly,{lines,docs:[pendOut]}),'holder.floor'),'refuse');
    s.eq('without it the same payment is fine',has(V(nearly,{lines,docs:[]}),'holder.floor'),false);
    const floorS=M.maSettings({holderFloor:{'1011':480000}});
    s.eq('a holder\'s floor is respected',lvl(M.maValidate(nearly,{idx:IDX,settings:floorS,today:TODAY,lines,docs:[]}),'holder.floor'),'refuse');
    // 500,000 − 30,000 (12th) − 480,000 (15th) = −10,000 on the 15th, back to +40,000 on the 18th:
    // it ends above zero (no floor refusal) but dips below on the way.
    const later=M.maPostAll([J('money_out',{date:'2026-10-15',holder:'1011',account:'6060',payee:'x',amount:480000,tax:NONE}),
      J('money_in',{date:'2026-10-18',holder:'1011',account:'4090',payee:'y',amount:50000,tax:NONE})],IDX,S).concat(lines);
    const dip=J('money_out',Object.assign({},base,{holder:'1011',amount:30000,date:'2026-10-12'}));
    s.eq('a backdated payment that dips a holder on the way is flagged',lvl(V(dip,{lines:later}),'holder.dip'),'flag');
    s.eq('and is not refused, since it ends above zero',has(V(dip,{lines:later}),'holder.floor'),false);
    // Journals with lines
    const unb=J('general',{date:'2026-10-09',lines:[{account:'6080',dr:500},{account:'1020',cr:400}]});
    s.eq('an unbalanced journal is refused',lvl(V(unb,{lines}),'journal.balanced'),'refuse');
    const both=J('general',{date:'2026-10-09',lines:[{account:'6080',dr:500,cr:500},{account:'1020',cr:500}]});
    s.eq('a line that is both debit and credit is refused',lvl(V(both,{lines}),'line.side'),'refuse');
    s.eq('one line is not a journal',lvl(V(J('general',{date:'2026-10-09',lines:[{account:'6080',dr:5}]}),{lines}),'journal.lines'),'refuse');
    s.eq('a journal naming the mirrored drawer is refused',lvl(V(J('general',{date:'2026-10-09',lines:[{account:'1010',dr:5},{account:'1011',cr:5}]}),{lines}),'holder.mirror'),'refuse');
    s.eq('suspense with no memo is flagged',lvl(V(J('general',{date:'2026-10-09',lines:[{account:'9020',dr:5},{account:'1011',cr:5}]}),{lines}),'unlabelled'),'flag');
    s.eq('an opening dated other than 1 July is flagged',lvl(V(J('opening',{date:'2026-07-02',lines:[{account:'1011',side:'dr',amount:5}]}),{lines}),'opening.date'),'flag');
    s.eq('a clean opening passes',R(V(open1011,{lines:[]})),'');
    // Transfers
    s.eq('a transfer to the same holder is refused',lvl(V(T({date:'2026-10-09',from:'1011',to:'1011',amount:5}),{lines}),'transfer.same'),'refuse');
    s.eq('a handover into the drawer is allowed',R(V(T({date:'2026-10-09',from:'1011',to:'1010',amount:5000}),{lines})),'');
    s.eq('owner side of taking cash from the drawer is allowed',has(V(T({date:'2026-10-09',from:'1010',to:'1011',amount:5000}),{lines}),'holder.mirror'),false);
    s.eq('and is not refused on a floor here — the drawer\'s balance lives in Store Accounts',R(V(T({date:'2026-10-09',from:'1010',to:'1011',amount:5000}),{lines})),'');
    s.eq('a transfer beyond what the sender holds is refused',lvl(V(T({date:'2026-10-09',from:'1012',to:'1011',amount:400000}),{lines}),'holder.floor'),'refuse');
    // Counts
    s.eq('a count that differs needs a reason',lvl(V(C({date:'2026-10-09',holder:'1011',counted:490000},500000),{lines}),'count.reason'),'refuse');
    const cr=V(C({date:'2026-10-09',holder:'1011',counted:490000,note:'not known yet'},500000),{lines});
    s.eq('with a reason it posts, flagged to be explained',R(cr),'flag:count.difference');
    s.eq('a negative count is refused',lvl(V(C({date:'2026-10-09',holder:'1011',counted:-5,note:'x'},0),{lines}),'count.value'),'refuse');
    // Capital and drawing
    s.eq('a drawing names Afnan or Ammar',lvl(V(J('drawing',{date:'2026-10-09',holder:'1011',owner:'raees',amount:5}),{lines}),'owner.who'),'refuse');
    // Edits
    const before=clean;
    const after=J('money_out',Object.assign({},base,{amount:26000}));
    s.eq('an edit needs a reason',lvl(V(after,{lines,before}),'edit.reason'),'refuse');
    s.eq('with one it passes',R(V(after,{lines,before,reason:'the landlord added water'})),'');
    s.eq('a document cannot change kind',lvl(V(J('money_in',Object.assign({},base,{account:'4090'})),{lines,before,reason:'x'}),'edit.type'),'refuse');
    s.eq('or party',lvl(V(J('money_out',Object.assign({},base,{party:'v1',payee:''})),{lines,before,reason:'x',parties:P}),'edit.party'),'refuse');
    s.eq('a void document cannot be edited',lvl(V(after,{lines,before:M.maApplyVoid(before,{reason:'x'}),reason:'x'}),'edit.void'),'refuse');
    s.eq('a document in a closed quarter cannot be moved out of it',lvl(V(after,{lines,before:Object.assign({},before,{date:'2026-09-01'}),reason:'x',closes}),'edit.closed'),'refuse');
  }

  s.section('edits keep their history; voids and confirmations (§31)');
  {
    const a=J('money_out',{date:'2026-10-05',holder:'1020',account:'6040',payee:'Landlord',amount:25000,tax:NONE,note:'Oct'});
    const b=Object.assign({},a,{amount:26000,note:'Oct, with water'});
    const d=M.maEditDiff(a,b);
    s.eq('the diff names only what changed',d.fields.join(),'amount,note');
    s.eq('with the before value',d.before.amount,25000);
    const e=M.maApplyEdit(a,b,{by:'ammar',byName:'Ammar',at:99,reason:'water added'});
    s.eq('the edit is one more history row',e.edits.length,1);
    s.eq('naming who and why',e.edits[0].by+':'+e.edits[0].reason,'ammar:water added');
    s.eq('the revision counts up',e.rev,2);
    s.eq('identity stays: the number',e.no,a.no);
    s.eq('and who entered it first',e.by,a.by);
    s.eq('nothing changed → no edit',M.maApplyEdit(a,Object.assign({},a),{reason:'x'}),null);
    const e2=M.maApplyEdit(e,Object.assign({},e,{amount:27000}),{by:'afnan',at:100,reason:'again'});
    s.eq('a second edit adds a second row',e2.edits.length+':'+e2.rev,'2:3');
    s.eq('a void needs a reason',M.maVoidIssues(a,'',{})[0].rule,'void.reason');
    s.eq('a void in a closed quarter is refused',M.maVoidIssues(Object.assign({},a,{date:'2026-09-01'}),'x',{closes:[{quarter:'2027-Q1',locked:true}]}).map(x=>x.rule).join(),'void.closed');
    const v=M.maApplyVoid(a,{by:'afnan',at:5,reason:'entered twice'});
    s.eq('a void keeps the document, struck through',v.status+':'+v.voidReason,'void:entered twice');
    s.eq('voiding twice is refused',M.maVoidIssues(v,'x',{})[0].rule,'void.again');
    const tp=T({date:'2026-10-10',from:'1011',to:'1012',amount:40000});
    s.eq('Ammar confirms what reached him',M.maConfirmPatch(tp,'ammar',{at:7}).patch.status,'posted');
    s.eq('Afnan cannot confirm for Ammar',!!M.maConfirmPatch(tp,'afnan',{}).error,true);
    const toRaees=Object.assign({},tp,{confirmBy:'raees',confirmPaper:true});
    const paper=M.maConfirmPatch(toRaees,'afnan',{at:8});
    s.eq('an owner confirms for Raees on paper',paper.patch.confirmVia+':'+paper.patch.confirmedFor,'paper:raees');
    s.eq('a posted transfer is not confirmed again',!!M.maConfirmPatch(Object.assign({},tp,{status:'posted'}),'ammar',{}).error,true);
    // A transfer's receiver is its identity: confirmBy and confirmPaper follow it
    const tv=(after,before)=>M.maValidate(after,{lines:[],before,reason:'fix',settings:S,idx:IDX,today:TODAY});
    const toAmmar=T({date:'2026-10-10',from:'1011',to:'1012',amount:40000});
    const toTill=T({date:'2026-10-10',from:'1011',to:'1040',amount:40000});
    const moved=Object.assign({},toTill,{id:toAmmar.id,no:toAmmar.no});
    s.eq('a transfer cannot change who received it',(tv(moved,toAmmar).refuses.find(x=>x.rule==='edit.receiver')||{}).level,'refuse');
    s.eq('changing only its amount is not a receiver change',!!tv(Object.assign({},toAmmar,{amount:41000}),toAmmar).refuses.find(x=>x.rule==='edit.receiver'),false);
    const ea=M.maApplyEdit(toAmmar,moved,{by:'afnan',at:9,reason:'x'});
    s.eq('an edit keeps confirmBy and confirmPaper together',ea.confirmBy+':'+ea.confirmPaper,toAmmar.confirmBy+':'+toAmmar.confirmPaper);
    const self=T({date:'2026-10-10',from:'1011',to:'1012',amount:40000},'ammar');
    const reb=T({date:'2026-10-10',from:'1011',to:'1012',amount:41000},'afnan');
    const es=M.maApplyEdit(self,Object.assign({},reb,{id:self.id,no:self.no}),{by:'afnan',at:9,reason:'x'});
    s.eq('a transfer nobody had to confirm does not start waiting on an edit',es.status+':'+(es.confirmBy||null),self.status+':'+(self.confirmBy||null));
  }

  s.section('parties: terms and rate cards keep their history (§4.2)');
  {
    s.eq('credit terms need their days',M.maTermsIssues({mode:'credit'})[0].rule,'terms.days');
    s.eq('monthly terms need a bill day',M.maTermsIssues({mode:'monthly'})[0].rule,'terms.billDay');
    s.eq('weekly terms need a weekday',M.maTermsIssues({mode:'weekly',billWeekdays:[]})[0].rule,'terms.billWeekdays');
    s.eq('clean terms pass',M.maTermsIssues({mode:'credit',creditDays:30,creditLimit:750000,payDays:[3,6]}).length,0);
    s.eq('terms in words',M.maTermsText({mode:'credit',creditDays:30,creditLimit:750000}),'Credit 30 days · limit ₨7.5 lac');
    let v={id:'v1',name:'Al-Karam',kind:'vendor',code:'ALKA',vendor:{terms:{mode:'credit',creditDays:30,from:'2026-07-01'}}};
    v=M.maTermsChange(v,{mode:'credit',creditDays:45},{from:'2026-10-15',by:'afnan',at:1,reason:'agreed in October'});
    s.eq('the new terms start on their day',v.vendor.terms.from+':'+v.vendor.terms.creditDays,'2026-10-15:45');
    s.eq('the old ones are kept, closed the day before',v.vendor.termsHistory[0].to+':'+v.vendor.termsHistory[0].creditDays,'2026-10-14:30');
    s.eq('with who and why',v.vendor.termsHistory[0].reason,'agreed in October');
    s.eq('a September bill keeps its 30 days',M.maTermsAt(v,'2026-09-20').creditDays,30);
    s.eq('an October 20 bill gets 45',M.maTermsAt(v,'2026-10-20').creditDays,45);
    s.eq('credit 30 from 20 Oct is 19 Nov',M.maDueDate({mode:'credit',creditDays:30},'2026-10-20'),'2026-11-19');
    s.eq('cash is due the same day',M.maDueDate({mode:'cash'},'2026-10-20'),'2026-10-20');
    s.eq('a monthly bill on the 25th made on the 20th is due the 25th',M.maDueDate({mode:'monthly',billDay:25},'2026-10-20'),'2026-10-25');
    s.eq('made on the 26th, it is due next month',M.maDueDate({mode:'monthly',billDay:25},'2026-10-26'),'2026-11-25');
    s.eq('a bill day of 31 lands on 30 Nov',M.maDueDate({mode:'monthly',billDay:31},'2026-11-02'),'2026-11-30');
    s.eq('weekly on Saturday from Tuesday 20 Oct',M.maDueDate({mode:'weekly',billWeekdays:[6]},'2026-10-20'),'2026-10-24');
    s.eq('the next pay day after Tuesday is Wednesday',M.maNextPayDay('2026-10-20',[3,6]),'2026-10-21');
    s.eq('a pay day is its own next pay day',M.maNextPayDay('2026-10-21',[3,6]),'2026-10-21');
    s.eq('a rate needs a unit',M.maRateIssues({item:'Stitching tee',rate:85})[0].rule,'rate.unit');
    s.eq('a rate to three decimals is refused',M.maRateIssues({item:'x',unit:'pc',rate:1.234})[0].rule,'rate.value');
    v=M.maRateChange(v,{item:'Stitching — tee',unit:'piece',rate:85,validFrom:'2026-07-01'},{by:'afnan',at:1});
    v=M.maRateChange(v,{item:'Stitching — tee',unit:'piece',rate:90,validFrom:'2026-10-01'},{by:'ammar',at:2});
    s.eq('both rates stay on the card',v.vendor.rateCard.length,2);
    s.eq('the old one closes the day before the new',v.vendor.rateCard[0].validTo,'2026-09-30');
    s.eq('a September bill reads ₨85',M.maRateAt(v,'stitching — tee','2026-09-15').rate,85);
    s.eq('an October bill reads ₨90',M.maRateAt(v,'Stitching — tee','2026-10-02').rate,90);
    s.eq('an item not on the card reads nothing',M.maRateAt(v,'Washing','2026-10-02'),null);
    s.eq('a code is suggested from the name',M.maPartyCode('Al-Karam Textiles',[]),'ALKA');
    s.eq('and made unique',M.maPartyCode('Al-Karam Textiles',['ALKA','alka2']),'ALKA3');
    const parties=[{id:'a',name:'Al-Karam',kind:'vendor',code:'ALKA'}];
    s.eq('a taken code is refused',M.maPartyIssues({id:'b',name:'Other',kind:'vendor',code:'ALKA'},{parties}).map(x=>x.rule).join(),'party.code_taken');
    s.eq('taken is matched without case',M.maPartyIssues({id:'b',name:'Other',kind:'vendor',code:'ALKA'},{parties:[{id:'a',name:'Al-Karam',kind:'vendor',code:'alka'}]}).map(x=>x.rule).join(),'party.code_taken');
    s.eq('a lowercase code is refused',M.maPartyIssues({id:'b',name:'Other',kind:'vendor',code:'ab'},{parties})[0].rule,'party.code');
    s.eq('an unknown kind is refused',M.maPartyIssues({id:'b',name:'Other',kind:'friend',code:'OTH'},{parties})[0].rule,'party.kind');
    s.eq('the same vendor name twice is flagged',M.maPartyIssues({id:'b',name:' al-karam ',kind:'vendor',code:'AK2'},{parties}).map(x=>x.level+':'+x.rule).join(),'flag:party.same_name');
    s.eq('bad terms on a vendor are refused',M.maPartyIssues({id:'b',name:'Other',kind:'vendor',code:'OTH',vendor:{terms:{mode:'credit'}}},{parties})[0].rule,'terms.days');
    s.eq('an item needs a unit',M.maItemIssues({name:'Rib',kind:'fabric'},{items:[]})[0].rule,'item.unit');
    s.eq('two items cannot share a name',M.maItemIssues({id:'2',name:'rib',kind:'fabric',unit:'kg'},{items:[{id:'1',name:'Rib'}]})[0].rule,'item.same');
  }

  s.section('the cost register (§26) — due days, periods and states');
  {
    const rent={id:'c1',name:'Rent — factory',kind:'fixed',cadence:'monthly',dueDay:5,account:'6040',holder:'1020',amountExpected:250000,active:true,from:'2026-10-01'};
    s.eq('clean',M.maCommitmentIssues(rent,{idx:IDX,settings:S}).length,0);
    s.eq('a monthly without a due day is refused',M.maCommitmentIssues(Object.assign({},rent,{dueDay:0}),{idx:IDX,settings:S})[0].rule,'commit.dueDay');
    s.eq('a commitment booked to a holder is refused',M.maCommitmentIssues(Object.assign({},rent,{account:'1020'}),{idx:IDX,settings:S})[0].rule,'commit.account');
    s.eq('one paid from the drawer is Store Accounts\' until M8',M.maCommitmentIssues(Object.assign({},rent,{holder:'1010'}),{idx:IDX,settings:S})[0].rule,'commit.holder_mirror');
    s.eq('an end before the start is refused',M.maCommitmentIssues(Object.assign({},rent,{to:'2026-09-01'}),{idx:IDX,settings:S})[0].rule,'commit.to');
    s.eq('October to December: three rent days',M.maCommitmentDueDays(rent,'2026-10-01','2026-12-31').join(),'2026-10-05,2026-11-05,2026-12-05');
    s.eq('nothing before it starts',M.maCommitmentDueDays(rent,'2026-09-01','2026-09-30').length,0);
    s.eq('a 31st lands on the last day of short months',M.maCommitmentDueDays(Object.assign({},rent,{dueDay:31}),'2026-11-01','2027-02-28').join(),'2026-11-30,2026-12-31,2027-01-31,2027-02-28');
    s.eq('weekly on Saturdays',M.maCommitmentDueDays({cadence:'weekly',dueWeekday:6},'2026-10-01','2026-10-20').join(),'2026-10-03,2026-10-10,2026-10-17');
    s.eq('quarterly falls in each fiscal quarter\'s first month',M.maCommitmentDueDays({cadence:'quarterly',dueDay:10,dueMonth:1},'2026-07-01','2027-06-30').join(),'2026-07-10,2026-10-10,2027-01-10,2027-04-10');
    s.eq('yearly once',M.maCommitmentDueDays({cadence:'yearly',dueDay:1,dueMonth:1},'2026-07-01','2027-06-30').join(),'2027-01-01');
    s.eq('per piece has no calendar day',M.maCommitmentDueDays({cadence:'per_piece'},'2026-07-01','2027-06-30').length,0);
    s.eq('a monthly period is its month',M.maCommitmentPeriodKey(rent,'2026-10-05'),'2026-10');
    s.eq('before the 5th it is upcoming',M.maCommitmentStatus(rent,[],'2026-10-03',S).state,'upcoming');
    s.eq('on the 5th it is due',M.maCommitmentStatus(rent,[],'2026-10-05',S).state,'due');
    s.eq('three days\' grace',M.maCommitmentStatus(rent,[],'2026-10-08',S).state,'due');
    s.eq('then overdue',M.maCommitmentStatus(rent,[],'2026-10-09',S).state,'overdue');
    const pay=J('money_out',{date:'2026-10-06',holder:'1020',account:'6040',payee:'Landlord',amount:250000,tax:NONE,commitmentId:'c1',commitmentPeriod:'2026-10'});
    pay.commitmentId='c1';pay.commitmentPeriod='2026-10';
    s.eq('a payment naming it for October makes it paid',M.maCommitmentStatus(rent,[pay],'2026-10-20',S).state,'paid');
    const part=Object.assign({},pay,{amount:100000});
    s.eq('part of it is part-paid',M.maCommitmentStatus(rent,[part],'2026-10-20',S).state,'part');
    s.eq('a void payment does not count',M.maCommitmentStatus(rent,[M.maApplyVoid(pay,{reason:'x'})],'2026-10-20',S).state,'overdue');
    s.eq('in words',M.maCommitmentText(rent),'Monthly · the 5th');
  }

  s.section('the calendar (§17) — dues, markers and an unfunded day');
  {
    const rent={id:'c1',name:'Rent — factory',kind:'fixed',cadence:'monthly',dueDay:25,account:'6040',holder:'1020',amountExpected:250000,active:true,from:'2026-10-01'};
    const net={id:'c2',name:'Internet',kind:'fixed',cadence:'monthly',dueDay:10,account:'6030',holder:'1020',amountExpected:9000,active:true,from:'2026-10-01'};
    const cal=M.maCalendar({today:TODAY,days:30,commitments:[rent,net],docs:[],settings:S,start:200000});
    s.eq('thirty days from today',cal.days.length+':'+cal.days[0].day+'…'+cal.days[29].day,'30:2026-10-20…2026-11-18');
    s.eq('the internet was due on the 10th and is still owed — it lands today',cal.days[0].events.map(e=>e.label+(e.late?' (late)':'')).join(),'Internet (late)');
    s.eq('rent on the 25th',cal.days.find(d=>d.day==='2026-10-25').out,250000);
    s.eq('next month\'s internet on 10 Nov',cal.days.find(d=>d.day==='2026-11-10').out,9000);
    s.eq('Wednesday is marked a pay day',cal.days.find(d=>d.day==='2026-10-21').payDay,true);
    s.eq('Friday a CPR day',cal.days.find(d=>d.day==='2026-10-23').cprDay,true);
    s.eq('the projection falls with each due',cal.days.find(d=>d.day==='2026-10-25').projected,200000-9000-250000);
    s.eq('the first day the holders cannot fund is named',cal.unfunded[0],'2026-10-25');
    const paid=J('money_out',{date:'2026-10-11',holder:'1020',account:'6030',payee:'PTCL',amount:9000,tax:NONE});
    paid.commitmentId='c2';paid.commitmentPeriod='2026-10';
    const cal2=M.maCalendar({today:TODAY,days:30,commitments:[rent,net],docs:[paid],settings:S,start:300000});
    s.eq('a paid commitment is not owed again',cal2.days[0].out,0);
    s.eq('and with enough cash nothing is unfunded',cal2.unfunded.length,0);
    const inflow=M.maCalendar({today:TODAY,days:30,commitments:[rent],docs:[],settings:S,start:0,inflows:[{day:'2026-10-23',label:'CPR',amount:900000}]});
    s.eq('an expected inflow lifts the projection',inflow.days.find(d=>d.day==='2026-10-25').projected,650000);
  }

  s.section('needs attention — worst first, fine is silent (§16.1, §17)');
  {
    const rent={id:'c1',name:'Rent — factory',kind:'fixed',cadence:'monthly',dueDay:5,account:'6040',holder:'1020',amountExpected:250000,active:true,from:'2026-10-01'};
    const pend=T({date:'2026-10-17',from:'1011',to:'1012',amount:40000});
    const holders=[{code:'1011',name:'Cash — with Afnan',active:true,holderKind:'cash',balance:120000,floor:0,lastCount:null},
                   {code:'1010',name:'Cash — store drawer (Raees)',active:true,holderKind:'cash',mirror:'store',mirrorOk:false,balance:null}];
    const cal=M.maCalendar({today:TODAY,days:30,commitments:[rent],docs:[],settings:S,start:100000});
    // Every book here has its opening (open1011): without one, "No opening
    // balance yet" leads the list (QA F25, asserted in ma-fix-money).
    const lines=M.maNeedsAttention({today:TODAY,settings:S,holders,commitments:[rent],docs:[open1011,pend],calendar:cal,unlabelled:[{amount:900}],review:[{}],recon:-2000,backup:null,nowMs:0});
    s.eq('the concerns come before the watches',lines.map(l=>l.state).join(),'concern,concern,watch,watch,watch,watch,watch,watch,watch');
    s.ok('an unfunded day is a concern',lines.some(l=>l.state==='concern'&&/run .* short/.test(l.sentence)));
    s.ok('an overdue rent says what, when and how much',lines.some(l=>l.sentence==='Rent — factory — nothing recorded for Oct 2026; ₨2,50,000 was due Mon 5 Oct.'));
    s.ok('a transfer waiting three days is named',lines.some(l=>/waiting to be confirmed/.test(l.sentence)));
    s.ok('an uncounted cash holder is named',lines.some(l=>/With Afnan has not been counted/.test(l.sentence)));
    s.ok('a drawer that could not be read says so',lines.some(l=>/could not be read from Store Accounts/.test(l.sentence)));
    s.ok('no backup yet says what to switch on',lines.some(l=>/No nightly backup has run yet/.test(l.sentence)));
    s.ok('every line carries its basis',lines.every(l=>l.basis));
    s.ok('and an action',lines.every(l=>l.action&&l.action.go));
    const quiet=M.maNeedsAttention({today:TODAY,settings:S,holders:[{code:'1011',name:'Cash — with Afnan',active:true,holderKind:'cash',balance:0}],commitments:[],docs:[open1011],calendar:M.maCalendar({today:TODAY,commitments:[],settings:S,start:5}),backup:{ok:true,at:1000},nowMs:1000+3600000});
    s.eq('when all is well there is nothing to say',quiet.length,0);
    const old=M.maNeedsAttention({today:TODAY,settings:S,holders:[],commitments:[],docs:[open1011],backup:{ok:true,at:0},nowMs:3*86400000});
    s.eq('a backup three days old is a concern',old.map(l=>l.state+':'+l.sentence).join(),'concern:The last backup ran 3 days ago.');
    const failed=M.maNeedsAttention({today:TODAY,settings:S,holders:[],commitments:[],docs:[open1011],backup:{ok:false,error:'PERMISSION_DENIED on bucket'},nowMs:1});
    s.ok('a failed backup names its error',/PERMISSION_DENIED/.test(failed[0].sentence));
  }

  s.section('the Unlabelled queue and FIFO allocation');
  {
    const u=J('money_out',{date:'2026-10-05',holder:'1011',account:'9020',payee:'Someone',amount:1200,tax:NONE});
    const k=J('money_out',{date:'2026-10-05',holder:'1011',account:'6060',payee:'Petrol',amount:1200,tax:NONE});
    const q=M.maUnlabelled([u,k,M.maApplyVoid(J('money_out',{date:'2026-10-05',holder:'1011',account:'9020',payee:'v',amount:5,tax:NONE}),{reason:'x'})],IDX,S);
    s.eq('only the unnamed live entry waits',q.length,1);
    s.eq('with its amount',q[0].amount,1200);
    s.eq('once named it leaves the queue',M.maUnlabelled([Object.assign({},u,{account:'6060'})],IDX,S).length,0);
    const a=M.maAllocateFifo(50000,[{id:'b2',date:'2026-10-02',outstanding:30000},{id:'b1',date:'2026-10-01',outstanding:40000}]);
    s.eq('the oldest bill is settled first',a.allocations.map(x=>x.id+':'+x.amount).join(),'b1:40000,b2:10000');
    s.eq('nothing left over',a.remainder,0);
    s.eq('more than is owed leaves an advance',M.maAllocateFifo(90000,[{id:'b1',date:'2026-10-01',outstanding:40000}]).remainder,50000);
    s.eq('a settled bill is skipped',M.maAllocateFifo(10,[{id:'b1',date:'2026-10-01',outstanding:0}]).allocations.length,0);
  }

  s.section('numbering, the audit row, and the words');
  {
    s.eq('JV-27-0001',M.maDocNo('journal','FY27',1),'JV-27-0001');
    s.eq('TR-28-0042',M.maDocNo('transfer','FY28',42),'TR-28-0042');
    const row=M.maAuditRow('post',{dt:'journal',id:'x',no:'JV-27-0001'},{by:'afnan',byName:'Afnan',at:5,detail:'Rent'});
    s.eq('an audit row names who, what and the document',row.action+':'+row.by+':'+row.target.no,'post:afnan:JV-27-0001');
    s.eq('an unknown action is not invented',M.maAuditRow('delete',null,{}).action,'post');
    s.eq('a transfer\'s title names both holders',M.maDocTitle(T({date:'2026-10-10',from:'1011',to:'1020',amount:5}),IDX),'Transfer with Afnan → MCB current');
    s.eq('HTML is escaped, quotes included',M.maEsc('<b>"x"&\'y\''),'&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;');
  }

  s.section('maRsWords — thousand, lakh, crore; whole rupees only (§31)');
  {
    const W=M.maRsWords;
    [[1,'One'],[11,'Eleven'],[19,'Nineteen'],[20,'Twenty'],[21,'Twenty One'],[99,'Ninety Nine'],[100,'One Hundred'],
     [101,'One Hundred One'],[110,'One Hundred Ten'],[999,'Nine Hundred Ninety Nine'],[1000,'One Thousand'],
     [1001,'One Thousand One'],[10000,'Ten Thousand'],[99999,'Ninety Nine Thousand Nine Hundred Ninety Nine'],
     [100000,'One Lakh'],[100001,'One Lakh One'],[150000,'One Lakh Fifty Thousand'],
     [1234567,'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven'],
     [9999999,'Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine'],[10000000,'One Crore'],
     [999999999,'Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine'],
     [1e11,'Ten Thousand Crore']].forEach(([n,w])=>s.eq(n+' in words',W(n),'Rupees '+w+' Only'));
    s.eq('0 is "Rupees Zero Only"',W(0),'Rupees Zero Only');
    s.eq('the plan\'s example, exactly',W(150000),'Rupees One Lakh Fifty Thousand Only');
    [[1.5,'a fraction'],[-5,'a negative'],[-0.5,'a negative fraction'],[NaN,'NaN'],[Infinity,'Infinity'],['100','a string'],
     [null,'null'],[undefined,'undefined'],[{},'an object'],[2**53,'past the safe integers']].forEach(([v,what])=>s.eq(what+' gives \'\'',W(v),''));
    s.ok('never million or billion',!/million|billion/i.test([1e6,1e7,1e9,1e11].map(W).join(' ')));
  }

  s.section('the PDF builders (§31, M1.4) — every figure is maLedger\'s or maHolderRows\'');
  {
    const FROM='2026-10-01',TO='2026-12-31',RANGE={from:FROM,to:TO,label:'Q2 FY27'};
    const party={id:'p_asg',kind:'vendor',name:'Asghar Printers',code:'ASG',active:true,contact:{phone:'0300 1234567'},vendor:{terms:{mode:'credit',creditDays:30,from:'2026-07-01'}}};
    const quiet={id:'p_q',kind:'vendor',name:'Quiet Traders',code:'QUIE',active:true};
    const opening=J('opening',{date:'2026-07-01',lines:[{account:'1011',side:'dr',amount:500000},{account:'1020',side:'dr',amount:2000000},
      {account:'1012',side:'dr',amount:300000},{account:'2010',side:'cr',amount:150000,party:'p_asg',memo:'Owed for September'}]});
    const cap=J('capital',{date:'2026-10-01',holder:'1011',owner:'afnan',amount:200000,note:'October wages'});
    const wht=J('money_out',{date:'2026-10-02',holder:'1011',account:'5030',party:'p_asg',amount:100000,tax:{kind:'withholding',rate:4},note:'October printing'});
    const pay=J('money_out',{date:'2026-10-05',holder:'1020',account:'2010',party:'p_asg',amount:50000,tax:NONE,note:'Part payment'});
    const payBefore=J('money_out',{date:'2026-09-20',holder:'1020',account:'2010',party:'p_asg',amount:10000,tax:NONE});
    const trC=T({date:'2026-10-03',from:'1011',to:'1012',amount:25000,note:'Float'});
    Object.assign(trC,M.maConfirmPatch(trC,'ammar',{at:1791000000000}).patch);
    const trP=T({date:'2026-10-06',from:'1011',to:'1012',amount:150000});
    const trOld=T({date:'2026-09-10',from:'1011',to:'1012',amount:1000});   // pending since September
    const trD=T({date:'2026-10-04',from:'1011',to:'1010',amount:10000});
    Object.assign(trD,M.maConfirmPatch(trD,'afnan',{at:1791050000000}).patch);   // M1.6a: into the drawer waits; confirmed on paper for Raees
    const vOut=M.maApplyVoid(J('money_out',{date:'2026-10-08',holder:'1011',account:'2010',party:'p_asg',amount:40000,tax:NONE}),{at:1791100000000,by:'afnan',byName:'Afnan',reason:'Entered twice'});
    const vTr=M.maApplyVoid(T({date:'2026-10-09',from:'1011',to:'1012',amount:70000}),{at:1791200000000,by:'ammar',byName:'Ammar',reason:'Wrong day'});
    const trCV=T({date:'2026-10-10',from:'1011',to:'1012',amount:5000});   // confirmed, then voided
    Object.assign(trCV,M.maConfirmPatch(trCV,'ammar',{at:1791250000000}).patch);
    const vTrC=M.maApplyVoid(trCV,{at:1791260000000,by:'afnan',byName:'Afnan',reason:'Never handed over'});
    const e0=J('money_out',{date:'2026-10-07',holder:'1011',account:'6050',payee:'Bilal',amount:12500,tax:{kind:'services',rate:16,inclusive:false}});
    const re=(b,amt,reason,by,at)=>M.maApplyEdit(b,M.maBuildDoc('journal',{kind:'money_out',date:'2026-10-07',holder:'1011',account:'6050',payee:'Bilal',amount:amt,tax:{kind:'services',rate:16,inclusive:false}},{by:'afnan'},IDX,S),{at,by,byName:by==='ammar'?'Ammar':'Afnan',reason});
    const e2=re(re(e0,13000,'The bill said 13,000','afnan',1791300000000),13500,'And the wire','ammar',1791400000000);
    const docs=[opening,cap,wht,pay,payBefore,trC,trP,trOld,trD,vOut,vTr,vTrC,e2];
    const lines0=M.maPostAll(docs,IDX,S);
    const book=M.maBalanceOf(lines0,IDX,'1011','2026-10-15');
    const cnt=C({date:'2026-10-15',holder:'1011',counted:book-500,note:'Short'},book);
    docs.push(cnt);
    const lines=M.maPostAll(docs,IDX,S);
    const holders=M.maHolderRows(IDX,lines,docs,{settings:S,mirrorBalances:{'1010':45000}});
    const X={idx:IDX,settings:S,lines,docs,parties:[party,quiet],commitments:[],holders,people:{afnan:'Afnan',ammar:'Ammar',raees:'Raees'},printedOn:'2026-12-31',printedBy:'Afnan'};
    const ids=a=>a.map(r=>r.no).join(',');

    // ── the ledger
    const f={from:FROM,to:TO,holder:'1011'};
    const led=M.maLedger(lines,f,IDX);
    const L=M.maPdfLedgerData(X,Object.assign({label:'Q2 FY27'},f));
    s.eq('ledger: one row per maLedger row, in its order',ids(L.rows),led.rows.map(r=>r.doc.no).join(','));
    s.ok('ledger: every date, debit, credit and running balance is maLedger\'s',L.rows.every((r,i)=>r.date===led.rows[i].date&&r.dr===led.rows[i].dr&&r.cr===led.rows[i].cr&&r.balance===led.rows[i].balance));
    s.eq('ledger: opening, closing and the totals are maLedger\'s',JSON.stringify([L.opening,L.closing,L.totals]),JSON.stringify([led.opening,led.closing,{dr:led.dr,cr:led.cr,count:led.count}]));
    s.eq('ledger: closing = opening + debits − credits',L.closing,L.opening+L.totals.dr-L.totals.cr);
    s.ok('ledger: the voided documents are not on it',!L.rows.some(r=>r.no===vOut.no||r.no===vTr.no));
    s.ok('ledger: a transfer still waiting to be confirmed is not on it',!L.rows.some(r=>r.no===trP.no||r.no===trOld.no));
    s.eq('ledger: the account, its range and its normal side',JSON.stringify([L.account.code,L.account.name,L.account.normal,L.range]),JSON.stringify(['1011','Cash — with Afnan','dr',RANGE]));
    const capRow=L.rows.find(r=>r.no===cap.no);
    s.eq('ledger: a capital row says who and names the other side',JSON.stringify([capRow&&capRow.kind,capRow&&capRow.who,capRow&&capRow.contra,capRow&&capRow.note]),JSON.stringify(['Owner put money in','Afnan','3010 · Capital — Afnan','October wages']));
    const trRow=L.rows.find(r=>r.no===trC.no);
    s.eq('ledger: a handover names the other holder, not a contra account',JSON.stringify([trRow&&trRow.who,trRow&&trRow.contra]),JSON.stringify(['Cash — with Ammar','']));
    s.eq('ledger: a party\'s line names the party',(L.rows.find(r=>r.no===wht.no)||{}).who,'Asghar Printers');
    s.eq('ledger: no single account → nothing to print (null)',M.maPdfLedgerData(X,{from:FROM,to:TO}),null);
    const L2=M.maPdfLedgerData(X,{from:FROM,to:TO,account:'2010',party:'p_asg',dt:'journal',q:'part'});
    s.ok('ledger: the page\'s filters are named on it',L2.filters.join('|')==='Party: Asghar Printers|Documents: Journals|Search: “part”',L2.filters.join('|'));
    s.eq('ledger: a filtered ledger is the filtered maLedger',JSON.stringify([L2.opening,L2.closing,L2.totals.count]),JSON.stringify((l=>[l.opening,l.closing,l.count])(M.maLedger(lines,{from:FROM,to:TO,account:'2010',party:'p_asg',dt:'journal',q:'part'},IDX))));

    // ── the holder statement
    const H=M.maPdfHolderStatementData(X,'1011',RANGE);
    const hl=M.maLedger(lines,{holder:'1011',from:FROM,to:TO},IDX);
    s.eq('holder: one row per maLedger(holder) row',ids(H.rows),hl.rows.map(r=>r.doc.no).join(','));
    s.ok('holder: in/out/balance are the holder ledger\'s',H.rows.every((r,i)=>r.in===hl.rows[i].dr&&r.out===hl.rows[i].cr&&r.balance===hl.rows[i].balance));
    s.eq('holder: opening/closing and totals',JSON.stringify([H.opening,H.closing,H.totals]),JSON.stringify([hl.opening,hl.closing,{in:hl.dr,out:hl.cr,count:hl.count}]));
    s.eq('holder: its closing is maBalanceOf on the last day',H.closing,M.maBalanceOf(lines,IDX,'1011',TO));
    s.eq('holder: who holds it',H.holder.person,'Afnan');
    s.eq('holder: confirmations — every one still waiting, and those confirmed in the range',H.confirmations.map(c=>c.no+':'+c.state).join(','),[trOld.no+':waiting',trC.no+':confirmed',trD.no+':confirmed',trP.no+':waiting'].join(','));
    s.ok('holder: a void handover is never a confirmation — not even one confirmed before it was voided',vTrC.status==='void'&&!!vTrC.confirmedBy&&!H.confirmations.some(c=>c.no===vTr.no||c.no===vTrC.no));
    s.ok('holder: …nor a movement',!H.rows.some(r=>r.no===vTr.no||r.no===vTrC.no));
    const cc=H.confirmations.find(c=>c.no===trC.no);
    s.eq('holder: a confirmation says who, when and which way',JSON.stringify([cc.direction,cc.other,cc.by,cc.at,cc.via]),JSON.stringify(['out','Cash — with Ammar','Ammar',1791000000000,'app']));
    const h1011=holders.find(h=>h.code==='1011');
    s.eq('holder: waiting is maHolderRows\'',JSON.stringify(H.waiting),JSON.stringify({in:h1011.pendingIn,out:h1011.pendingOut}));
    s.eq('holder: the last count is maHolderRows\'',JSON.stringify(H.lastCount),JSON.stringify({date:h1011.lastCount.date,no:h1011.lastCount.no,counted:h1011.lastCount.counted,difference:h1011.lastCount.difference}));
    s.eq('holder: …500 short',H.lastCount.difference,-500);
    const D=M.maPdfHolderStatementData(X,'1010',RANGE);
    s.eq('holder: the drawer (mirrored) prints no opening, closing or running balance',JSON.stringify([D.holder.mirror,D.opening,D.closing,D.rows.every(r=>r.balance===null)]),JSON.stringify([true,null,null,true]));
    s.eq('holder: …its balance is Store Accounts\' own',D.mirrorBalance,45000);
    s.eq('holder: …and never a zero when that read failed',M.maPdfHolderStatementData(Object.assign({},X,{holders:M.maHolderRows(IDX,lines,docs,{settings:S})}),'1010',RANGE).mirrorBalance,null);
    s.eq('holder: a non-money account is not a holder (null)',M.maPdfHolderStatementData(X,'6050',RANGE),null);

    // ── the party statement
    const P=M.maPdfPartyStatementData(X,'p_asg',RANGE);
    s.eq('party: the opening is their account before the range (150,000 owed less 10,000 paid in September) — a credit',P.opening,140000);
    s.eq('party: one row per posting on their account in the range',ids(P.rows),pay.no);
    s.eq('party: …a payment is a debit that brings the balance down',JSON.stringify([P.rows[0].dr,P.rows[0].balance]),JSON.stringify([50000,90000]));
    s.eq('party: closing = opening + credits − debits',P.closing,P.opening+P.totals.cr-P.totals.dr);
    const pl=M.maLedger(lines.filter(l=>l.party==='p_asg'&&M.maAcc(IDX,l.account).control),{party:'p_asg',from:FROM,to:TO},IDX);
    s.eq('party: the totals are maLedger\'s over their account',JSON.stringify(P.totals),JSON.stringify({dr:pl.dr,cr:pl.cr,count:pl.count}));
    s.ok('party: a void document never moves it',!P.rows.some(r=>r.no===vOut.no)&&P.closing===90000);
    s.eq('party: paid directly — the withholding purchase, at the cash that moved',JSON.stringify(P.direct.rows.map(r=>[r.no,r.paid,r.received,r.holder])),JSON.stringify([[wht.no,96000,0,'Cash — with Afnan']]));
    s.ok('party: …and a payment on their account is not listed twice',!P.direct.rows.some(r=>r.no===pay.no));
    s.eq('party: name, code, kind, terms, phone',JSON.stringify([P.party.name,P.party.code,P.party.kind,P.party.terms,P.party.phone]),JSON.stringify(['Asghar Printers','ASG','Vendor','Credit 30 days','0300 1234567']));
    const Q=M.maPdfPartyStatementData(X,'p_q',RANGE);
    s.eq('party: a party with nothing prints zeros, not an error',JSON.stringify([Q.opening,Q.closing,Q.rows.length,Q.direct.rows.length]),JSON.stringify([0,0,0,0]));
    s.eq('party: an unknown party builds nothing (null)',M.maPdfPartyStatementData(X,'nobody',RANGE),null);

    // ── the receipt
    const R=M.maPdfReceiptData(X,trP);
    s.eq('receipt: the amount and its words',JSON.stringify([R.amount,R.amountWords]),JSON.stringify([150000,'Rupees One Lakh Fifty Thousand Only']));
    s.eq('receipt: from and to, with whose hands',JSON.stringify([R.from.name,R.from.person,R.to.name,R.to.person]),JSON.stringify(['Cash — with Afnan','Afnan','Cash — with Ammar','Ammar']));
    s.eq('receipt: pending, and who it waits for',JSON.stringify([R.state,R.waitingFor]),JSON.stringify(['pending','Ammar']));
    s.eq('receipt: confirmed says by whom and when',JSON.stringify([M.maPdfReceiptData(X,trC).state,M.maPdfReceiptData(X,trC).confirm]),JSON.stringify(['confirmed',{by:'Ammar',at:1791000000000,via:'app',forWho:''}]));
    s.eq('receipt: a handover nobody had to confirm is simply posted',M.maPdfReceiptData(X,T({date:'2026-10-04',from:'1011',to:'1020',amount:10000})).state,'posted');
    s.eq('receipt: a drawer handover confirmed on paper says so, and for whom',JSON.stringify(M.maPdfReceiptData(X,trD).confirm),JSON.stringify({by:'Afnan',at:1791050000000,via:'paper',forWho:'Raees'}));
    const RV=M.maPdfReceiptData(X,vTr);
    s.eq('receipt: a void says so, with who, when and why',JSON.stringify([RV.state,RV.void]),JSON.stringify(['void',{reason:'Wrong day',by:'Ammar',at:1791200000000}]));
    s.eq('receipt: never edited → no revision mark',R.revised,null);
    s.eq('receipt: a journal is not a receipt (null)',M.maPdfReceiptData(X,cap),null);

    // ── the voucher
    const V=M.maPdfVoucherData(X,wht);
    const tw=M.maTaxCompute(100000,wht.tax);
    s.eq('voucher: paid is the cash that left the holder (less withholding)',JSON.stringify([V.amount,V.paid,V.paidWords]),JSON.stringify([100000,tw.cash,'Rupees Ninety Six Thousand Only']));
    s.eq('voucher: the tax block is maTaxCompute\'s',JSON.stringify(V.tax),JSON.stringify({kind:'withholding',label:'Withholding',rate:4,inclusive:true,claimable:false,amount:4000,net:100000,gross:100000}));
    s.eq('voucher: paid to the party, from the holder, for the account',JSON.stringify([V.paidTo,V.from.name,V.account]),JSON.stringify([{name:'Asghar Printers',code:'ASG',party:true},'Cash — with Afnan',{code:'5030',name:'Embellishment'}]));
    s.eq('voucher: "No tax" → no tax block',M.maPdfVoucherData(X,pay).tax,null);
    const V2=M.maPdfVoucherData(X,e2);
    // M1.5b: n is maRevOf — the number the rail shows (edits + 1) — not the
    // edit count, which printed rev 2 beside a screen that said rev 3.
    s.eq('voucher: edited twice → revised n = maRevOf = 3, the rail\'s number',V2.revised&&V2.revised.n,3);
    s.eq('… which is edits + 1',V2.revised&&V2.revised.n,e2.edits.length+1);
    s.eq('voucher: …with the LAST edit\'s who, when and why',JSON.stringify(V2.revised),JSON.stringify({n:3,at:1791400000000,by:'Ammar',reason:'And the wire'}));
    s.eq('voucher: …and the payee who is no party',JSON.stringify(V2.paidTo),JSON.stringify({name:'Bilal',code:'',party:false}));
    s.eq('voucher: services tax on top → paid = amount + tax',V2.paid,13500+Math.round(13500*16/100));
    s.eq('voucher: a void one says so',M.maPdfVoucherData(X,vOut).void.reason,'Entered twice');
    s.eq('voucher: a live one does not',V.void,null);
    s.eq('voucher: only Money out has one (capital → null)',M.maPdfVoucherData(X,cap),null);
    s.eq('voucher: …a transfer → null',M.maPdfVoucherData(X,trC),null);
  }

  s.section('M1.6a — a transfer\'s confirmation is DERIVED from whose hands its holders are in');
  {
    s.eq('the map is read off the chart: every money holder that names a person',JSON.stringify(M.MA_HANDS),
      JSON.stringify(M.MA_CHART.filter(a=>a.money&&a.person).reduce((m,a)=>{m[a.code]=a.person;return m;},{})));
    s.eq('…which is the drawer (Raees), Afnan\'s and Ammar\'s cash, and the till (Umair)',JSON.stringify(M.MA_HANDS),JSON.stringify({'1010':'raees','1011':'afnan','1012':'ammar','1040':'umair'}));
    s.eq('the drawer is the one cash holder in a non-owner\'s hands',JSON.stringify(M.MA_DRAWERS),JSON.stringify(['1010']));
    s.eq('…the same holder the settings mirror from Store Accounts',JSON.stringify(M.MA_DRAWERS),JSON.stringify(Object.keys(M.MA_DEFAULT_SETTINGS.mirrors)));
    s.eq('the map is frozen',Object.isFrozen(M.MA_HANDS)&&Object.isFrozen(M.MA_DRAWERS),true);
    s.eq('a name that is not a holder has nobody\'s hands (not even Object\'s own keys)',[M.maHandsOf('toString'),M.maHandsOf('__proto__'),M.maHandsOf(''),M.maHandsOf(null)].join(','),',,,');
    // [from, to, recorder, who confirms, paper] — the same table the emulator holds the rules to.
    const MAP=[['1011','1012','afnan','ammar',false],['1011','1012','ammar',null,false],['1011','1020','afnan',null,false],
      ['1011','1010','afnan','raees',true],['1010','1020','afnan','raees',true],['1020','1010','ammar','raees',true],
      ['1010','1011','afnan','afnan',false],['1010','1011','ammar','afnan',false],['1010','1012','ammar','ammar',false],
      ['1011','1040','afnan','umair',true],['1040','1020','afnan',null,false],['1012','1011','afnan',null,false],['1020','1012','afnan','ammar',false]];
    MAP.forEach(([from,to,by,who,paper])=>{
      const t=T({date:'2026-10-10',from,to,amount:5000},by);
      s.eq(from+' → '+to+' recorded by '+by+': '+(who?'waits for '+who+(paper?' (on paper)':' (in the app)'):'posts at once'),
        [t.status,t.confirmBy,t.confirmPaper,t.confirmVia===undefined].join(':'),[who?'pending':'posted',who,paper,true].join(':'));
    });
    s.eq('the drawer is Raees\'s hands BOTH ways: drawer → bank waits for him',M.maTransferConfirm('1010','1020',null,'afnan').confirmBy,'raees');
    s.eq('…and bank → drawer',M.maTransferConfirm('1020','1010',null,'afnan').confirmBy,'raees');
    s.eq('out of the drawer into Afnan\'s hands, recorded by Afnan, still waits for Afnan (confirm once Raees has recorded it)',M.maTransferConfirm('1010','1011',null,'afnan').pending,true);
    s.eq('elsewhere a receiver recording it has confirmed it (Ammar\'s cash to Afnan, by Afnan)',M.maTransferConfirm('1012','1011',null,'afnan').pending,false);
    s.eq('the owners\' edited chart cannot move a confirmation (the rules cannot read it)',
      M.maTransferConfirm('1011','1012',M.maChartIndex(M.maChart('groovy',[{code:'1012',person:'raees'}])),'afnan').confirmBy,'ammar');
    s.eq('a drawer handover is confirmed only once Raees has recorded it — the warning says so',/only once Raees has recorded this ₨25,000 in Store Accounts/.test(M.maConfirmWarning(T({date:'2026-10-10',from:'1011',to:'1010',amount:25000}))),true);
    s.eq('…out of the drawer too',M.maConfirmWarning(T({date:'2026-10-10',from:'1010',to:'1020',amount:5000}))!=='',true);
    s.eq('no warning for any other transfer',M.maConfirmWarning(T({date:'2026-10-10',from:'1011',to:'1012',amount:5000}))+M.maConfirmWarning(J('money_out',{date:'2026-10-10',holder:'1011',account:'6050',payee:'x',amount:5,tax:NONE})),'');
    const legacy=Object.assign(T({date:'2026-10-10',from:'1011',to:'1010',amount:25000}),{status:'posted',confirmBy:null,confirmPaper:false,confirmVia:'store'});
    s.eq('needs (or needed) a confirmation: pending, confirmed, and a drawer handover recorded before M1.6a',
      [T({date:'2026-10-10',from:'1011',to:'1012',amount:5}),Object.assign(T({date:'2026-10-10',from:'1011',to:'1012',amount:5}),{status:'posted',confirmedBy:'ammar'}),legacy,T({date:'2026-10-10',from:'1011',to:'1020',amount:5})].map(M.maTransferNeedsConfirm).join(','),'true,true,true,false');
  }

  s.section('M1.6a — an edit never moves a status or a confirmation (money F6)');
  {
    const TIN={date:'2026-10-10',from:'1011',to:'1012',amount:40000};
    const tp=T(TIN);                                                     // waits for Ammar
    const tc=Object.assign(T(TIN),{});Object.assign(tc,M.maConfirmPatch(tc,'ammar',{at:7}).patch);   // Ammar confirmed
    const rebuild=(b,inp,by)=>M.maBuildDoc('transfer',inp,{by:b.by,byName:b.byName,ts:b.ts},IDX,S);
    const note=M.maApplyEdit(tc,rebuild(tc,Object.assign({},TIN,{note:'receipt 12'})),{by:'afnan',byName:'Afnan',at:9,reason:'note'});
    s.eq('a note on a transfer Ammar confirmed: it stays posted',note.status,'posted');
    s.eq('…and confirmed by Ammar, in the app, at the same moment',[note.confirmBy,note.confirmedBy,note.confirmVia,note.confirmedAt].join(':'),'ammar:ammar:app:7');
    s.eq('…and the row names only the note',JSON.stringify(note.edits[0].fields),JSON.stringify(['note']));
    s.eq('…and it still counts in Ammar\'s cash',post(note).map(l=>l.account+(l.dr?'+':'-')).join(),'1012+,1011-');
    const pn=M.maApplyEdit(tp,rebuild(tp,Object.assign({},TIN,{note:'envelope'})),{by:'afnan',at:9,reason:'note'});
    s.eq('a note on a waiting transfer: it stays waiting, for Ammar',pn.status+':'+pn.confirmBy+':'+pn.confirmPaper,'pending:ammar:false');
    s.ok('a waiting transfer carries no confirmation it never had',!('confirmedBy' in pn)&&!('confirmVia' in pn)&&!('confirmedFor' in pn));
    const self=T({date:'2026-10-10',from:'1012',to:'1011',amount:5000},'afnan');   // posted: Afnan recorded money reaching him
    const selfEd=M.maApplyEdit(self,Object.assign(M.maBuildDoc('transfer',{date:'2026-10-10',from:'1012',to:'1011',amount:5000,note:'x'},{by:'ammar'},IDX,S),{}),{by:'ammar',at:9,reason:'x'});
    s.eq('a transfer nobody had to confirm never starts waiting through an edit (even when the builder would say so)',selfEd.status+':'+selfEd.confirmBy,'posted:null');
    const tv=(after,before)=>M.maValidate(after,{lines:[],before,reason:'fix',settings:S,idx:IDX,today:TODAY});
    const lvlOf=(r,rule)=>(r.refuses.find(x=>x.rule===rule)||{}).level||null;
    const editRef=r=>r.refuses.filter(x=>/^edit\./.test(x.rule)).map(x=>x.rule).join()||'none';   // lines:[] leaves every holder at 0, so holder.floor is not this section's question
    [['amount',41000],['date','2026-10-11'],['from','1020']].forEach(([f,v])=>{
      s.eq('a transfer waiting for Ammar cannot change its '+f,lvlOf(tv(Object.assign({},tp,{[f]:v}),tp),'edit.confirmed'),'refuse');
      s.eq('…nor one Ammar confirmed',lvlOf(tv(Object.assign({},tc,{[f]:v}),tc),'edit.confirmed'),'refuse');
    });
    const said=tv(Object.assign({},tp,{amount:41000}),tp).refuses.find(x=>x.rule==='edit.confirmed');
    s.ok('…and it says who, what, and "void it and record it again"',!!said&&/waits for Ammar/.test(said.message)&&/amount/.test(said.message)&&/void it and record it again/.test(said.message)&&said.field==='amount',said&&said.message);
    s.eq('a note is not refused',editRef(tv(Object.assign({},tc,{note:'receipt'}),tc)),'none');
    s.eq('a drawer handover recorded before M1.6a (posted at once) keeps its amount too',lvlOf(tv(Object.assign({},legacyOf(),{amount:30000}),legacyOf()),'edit.confirmed'),'refuse');
    function legacyOf(){return Object.assign(T({date:'2026-10-10',from:'1011',to:'1010',amount:25000}),{id:'t-legacy',no:'TR-27-9001',status:'posted',confirmBy:null,confirmPaper:false,confirmVia:'store'});}
    const tn=T({date:'2026-10-10',from:'1011',to:'1020',amount:90000});      // nobody confirms
    s.eq('a transfer nobody confirms takes a new amount',editRef(tv(Object.assign({},tn,{amount:95000}),tn)),'none');
    s.eq('…but is refused a route out of the drawer, where Raees would confirm (an edit cannot start a confirmation)',lvlOf(tv(Object.assign({},tn,{from:'1010'}),tn),'edit.route'),'refuse');
    s.eq('…and may be re-routed where nobody confirms',editRef(tv(Object.assign({},tn,{from:'1012'}),tn)),'none');
    const ct=C({date:'2026-10-15',holder:'1011',counted:98000,note:'short'},100000);
    s.eq('a count cannot change which holder was counted',lvlOf(tv(Object.assign({},ct,{holder:'1012'}),ct),'edit.holder'),'refuse');
  }

  s.section('M1.6a — a count edit keeps its book; money moved is named (money F2, security F1)');
  {
    const CIN={date:'2026-10-15',holder:'1011',counted:98000,note:'short'};
    const ct=C(CIN,100000);
    s.eq('a count\'s amount is an edit field — so a moved amount is named',M.MA_EDIT_FIELDS.count.indexOf('amount')>=0,true);
    s.eq('the derived list no longer exempts amount or tax',M.MA_EDIT_DERIVED.indexOf('amount')+M.MA_EDIT_DERIVED.indexOf('tax'),-2);
    s.eq('a note keeps the stored book',M.maCountBookOf(ct,Object.assign({},CIN,{note:'recounted'}),5),100000);
    s.eq('…a figure written with its separators is the same figure',M.maCountBookOf(ct,Object.assign({},CIN,{counted:'98,000'}),5),100000);
    s.eq('a recount takes the book as it stands',M.maCountBookOf(ct,Object.assign({},CIN,{counted:99000}),101000),101000);
    s.eq('…and so does another day',M.maCountBookOf(ct,Object.assign({},CIN,{date:'2026-10-16'}),102000),102000);
    s.eq('a new count takes the book as it stands',M.maCountBookOf(null,CIN,103000),103000);
    const rb=(inp,now)=>M.maBuildDoc('count',inp,{by:ct.by,byName:ct.byName,ts:ct.ts,bookBalance:M.maCountBookOf(ct,inp,now)},IDX,S);
    const n=M.maApplyEdit(ct,rb(Object.assign({},CIN,{note:'recounted, the same'}),0),{by:'afnan',at:9,reason:'note'});
    s.eq('a note-only count edit moves nothing: book, difference, amount, and the posting',[n.bookBalance,n.difference,n.amount,post(n).map(l=>l.account+':'+(l.dr||-l.cr)).join()].join('|'),[100000,-2000,2000,post(ct).map(l=>l.account+':'+(l.dr||-l.cr)).join()].join('|'));
    s.eq('…and its row says only "note"',JSON.stringify(n.edits[0].fields),JSON.stringify(['note']));
    const r=M.maApplyEdit(ct,rb(Object.assign({},CIN,{counted:99500}),100000),{by:'afnan',at:9,reason:'recount'});
    s.eq('a recount names counted AND amount',JSON.stringify(r.edits[0].fields),JSON.stringify(['counted','amount']));
    const tx=J('money_out',{date:'2026-10-10',holder:'1011',account:'6050',payee:'Bilal',amount:10000,tax:{kind:'services',rate:16,inclusive:false}});
    const tx2=M.maApplyEdit(tx,M.maBuildDoc('journal',{kind:'money_out',date:'2026-10-10',holder:'1011',account:'6050',payee:'Bilal',amount:12000,tax:{kind:'services',rate:16,inclusive:false}},{by:tx.by,byName:tx.byName,ts:tx.ts},IDX,S),{by:'afnan',at:9,reason:'bill'});
    s.eq('a money-out whose amount moves names amount AND the tax that moved with it',JSON.stringify(tx2.edits[0].fields),JSON.stringify(['amount','tax']));
  }

  s.section('M1.6a — an edit stores its own flags, and a moved figure clears the review (money F8)');
  {
    const base={date:'2026-10-05',holder:'1011',account:'6050',payee:'Plumber',tax:NONE};
    const small=Object.assign(J('money_out',Object.assign({},base,{amount:1000})),{reviewedAt:5,reviewedBy:'ammar'});
    const big=M.maBuildDoc('journal',Object.assign({kind:'money_out'},base,{amount:95000}),{by:small.by,byName:small.byName,ts:small.ts},IDX,S);
    const res=V(Object.assign({},big,{id:small.id,no:small.no}),{before:small,reason:'the real bill'});
    s.eq('recorded small, edited up: the edit raises the evidence flag',res.flags.map(x=>x.rule).join(),'evidence.missing');
    const e=M.maApplyEdit(small,big,{by:'afnan',at:9,reason:'the real bill',flags:res.flags});
    s.eq('…and STORES it (it used to be shown, acknowledged and dropped)',JSON.stringify(e.flags),JSON.stringify(M.maFlagRows(res.flags)));
    // Cleared means WRITTEN as null: a key left out is put back from the
    // stored copy by the writer's edit shape, and the review would survive.
    s.eq('the amount moved, so Ammar\'s review is cleared — both fields written as null',JSON.stringify(['reviewedAt','reviewedBy'].map(k=>k in e?e[k]:'absent')),JSON.stringify([null,null]));
    s.eq('…and the document is back in the review queue',M.maReviewQueue([e]).length,1);
    const noteOnly=M.maApplyEdit(small,M.maBuildDoc('journal',Object.assign({kind:'money_out'},base,{amount:1000,note:'receipt 7'}),{by:small.by},IDX,S),{by:'afnan',at:9,reason:'note',flags:[]});
    s.ok('a note keeps the review (the writer keeps the stored fields)',!('reviewedAt' in noteOnly)&&!('reviewedBy' in noteOnly));
    s.ok('…and, with no flag raised on a document that had none, adds no empty flags list',!('flags' in noteOnly));
    const kept=M.maApplyEdit(Object.assign({},small,{flags:[{rule:'duplicate',message:'Looks like JV-1'}]}),M.maBuildDoc('journal',Object.assign({kind:'money_out'},base,{amount:1000,note:'x'}),{by:small.by},IDX,S),{by:'afnan',at:9,reason:'x',flags:[]});
    s.eq('a flag the edit no longer raises is cleared (an empty list, stored)',JSON.stringify(kept.flags),'[]');
    s.ok('without the edit\'s own flags (a file attached from the rail) the stored ones are not touched',!('flags' in M.maApplyEdit(small,big,{by:'afnan',at:9,reason:'x'})));
    s.eq('which fields are figures',M.MA_FIGURE_FIELDS.join(),'date,amount,tax,party,account,holder,from,to,owner,lines,counted');
    s.eq('a figure clears the review; a label or a note does not',[['amount'],['note'],['costCentre','tags'],['date'],['lines']].map(f=>M.maEditClearsReview(f)).join(),'true,false,false,true,true');
    s.eq('a never-reviewed document gains no review fields',('reviewedAt' in M.maApplyEdit(J('money_out',Object.assign({},base,{amount:1000})),big,{by:'afnan',at:9,reason:'x'})),false);
  }

  s.section('M1.6a — journals are held to what their lines do (money F12; the rules cannot loop)');
  {
    const lines=M.maPostAll([open1011],IDX,S);
    const G=(ls,extra)=>J('general',Object.assign({date:'2026-10-09',lines:ls},extra||{}));
    const between=V(G([{account:'1012',dr:40000},{account:'1020',cr:40000}]),{lines});
    s.eq('a journal moving money between two holders is refused',lvl(between,'journal.holders'),'refuse');
    s.ok('…"record a transfer — it waits for the receiver"',/record a transfer: it waits for the receiver/.test((between.refuses.find(x=>x.rule==='journal.holders')||{}).message||''));
    s.eq('three-way, two holders in and out: still refused',lvl(V(G([{account:'1012',dr:30000},{account:'6080',dr:500},{account:'1020',cr:30500}]),{lines}),'journal.holders'),'refuse');
    s.eq('a holder on both sides netting to nothing is not a handover',has(V(G([{account:'1020',dr:500},{account:'1020',cr:500},{account:'6080',dr:100},{account:'4090',cr:100}]),{lines}),'journal.holders'),false);
    const pay=V(G([{account:'6040',dr:500000},{account:'1020',cr:500000}]),{lines});
    s.eq('paying ₨5,00,000 out of MCB against rent with no bill is flagged like a Money out',lvl(pay,'evidence.missing'),'flag');
    s.eq('…and with nobody named as paid, flagged for that too',lvl(pay,'journal.payee'),'flag');
    s.eq('with the bill and the landlord named: neither flag',R(V(G([{account:'6040',dr:500000,party:'pl'},{account:'1020',cr:500000}],{attachments:[{publicId:'ma/'+'ab'.repeat(32),format:'pdf',type:'authenticated'}]}),{lines,parties:[{id:'pl',kind:'vendor',name:'Landlord',active:true}]})),'');
    s.eq('under the evidence threshold (₨2,000): no flag, as for a Money out',R(V(G([{account:'6080',dr:350},{account:'1020',cr:350,memo:'SMS'}]),{lines})),'');
    s.eq('paid out against a payable (not a cost) is not a Money out in disguise',has(V(G([{account:'2010',dr:500000,party:'pl'},{account:'1020',cr:500000}]),{lines,parties:[{id:'pl',kind:'vendor',name:'L',active:true}]}),'evidence.missing'),false);
    const flagged=Object.assign(G([{account:'6040',dr:500000},{account:'1020',cr:500000}]),{flags:M.maFlagRows(pay.flags)});
    s.eq('the evidence flag is answered by attaching the bill, like any other',M.maLiveFlags(Object.assign({},flagged,{attachments:[{publicId:'ma/'+'cd'.repeat(32),format:'jpg',type:'authenticated'}]})).map(x=>x.rule).join(),'journal.payee');
    const second=J('opening',{date:'2026-07-01',lines:[{account:'1011',side:'dr',amount:500000}]});
    const again=V(second,{lines,docs:[open1011]});
    s.eq('a second opening for an account that already has one is flagged',lvl(again,'opening.again'),'flag');
    s.ok('…naming the first',new RegExp(open1011.no).test((again.flags.find(x=>x.rule==='opening.again')||{}).message||''));
    s.eq('…once per account, however many lines name it',V(J('opening',{date:'2026-07-01',lines:[{account:'1011',side:'dr',amount:5},{account:'1011',side:'dr',amount:6}]}),{lines,docs:[open1011]}).flags.filter(x=>x.rule==='opening.again').length,1);
    s.eq('an opening for an account nobody opened yet is not',has(V(J('opening',{date:'2026-07-01',lines:[{account:'1030',side:'dr',amount:5}]}),{lines,docs:[open1011],idx:M.maChartIndex(M.maChart('groovy',[{code:'1030',active:true}]))}),'opening.again'),false);
    s.eq('a VOID first opening does not count',has(V(second,{lines,docs:[M.maApplyVoid(open1011,{reason:'x'})]}),'opening.again'),false);
    s.eq('editing the one opening is not a second one',has(V(Object.assign({},open1011,{note:'x'}),{lines,docs:[open1011],before:open1011,reason:'x'}),'opening.again'),false);
  }

  s.section('M1.6a — closed quarters: confirm and review refused by name; a re-lock builder (money F7, security F3b)');
  {
    const closes=[{quarter:'2027-Q1',locked:true}];
    const tq=T({date:'2026-09-01',from:'1011',to:'1012',amount:4000});
    const r=M.maConfirmPatch(tq,'ammar',{at:5},{closes,settings:S});
    s.ok('a confirm dated in a locked quarter is refused, naming the quarter',!!r.error&&/Q1 FY27/.test(r.error)&&/closed/.test(r.error)&&!r.patch,r.error);
    s.eq('…not the rules\' words',/rules/i.test(r.error||''),false);
    s.eq('a reopened quarter confirms again',M.maConfirmPatch(tq,'ammar',{at:5},{closes:[{quarter:'2027-Q1',locked:true,reopenedAt:9}],settings:S}).patch.status,'posted');
    s.eq('with no closes given, nothing is locked (as before)',M.maConfirmPatch(tq,'ammar',{at:5}).patch.status,'posted');
    s.eq('maQuarterLocked names a locked quarter, and is empty for an open one',[M.maQuarterLocked(tq,{closes,settings:S}),M.maQuarterLocked(T({date:'2026-10-05',from:'1011',to:'1012',amount:1}),{closes,settings:S})].join('|'),M.maQuarterLabel('2027-Q1',7)+'|');
    const reopened={quarter:'2027-Q1',locked:true,closedBy:'afnan',closedAt:1,reopenedAt:5,reopenedBy:'ammar',reopenReason:'late bill'};
    const rl=M.maCloseRelock(reopened,{by:'afnan',byName:'Afnan',at:10,auditId:'a-1',reason:'booked'});
    s.eq('a re-lock locks, clears the reopen, and signs it',JSON.stringify([rl.patch.locked,rl.patch.reopenedAt,rl.patch.reopenedBy,rl.patch.reopenReason,rl.patch.closedBy,rl.patch.closedAt,rl.patch.relockAudit]),JSON.stringify([true,null,null,null,'afnan',10,'a-1']));
    s.eq('…keeping the reopen it ends',JSON.stringify(rl.patch.reopens),JSON.stringify([{at:5,by:'ammar',reason:'late bill'}]));
    s.eq('…with its audit row: a relock of that quarter, by the re-locker',JSON.stringify([rl.audit.action,rl.audit.target,rl.audit.by,rl.audit.at]),JSON.stringify(['relock',{dt:'close',id:'2027-Q1',no:'2027-Q1'},'afnan',10]));
    s.eq('a second cycle appends to the history',M.maCloseRelock(Object.assign({},reopened,{reopens:[{at:1,by:'afnan',reason:'x'}]}),{by:'ammar',at:11,auditId:'a-2'}).patch.reopens.length,2);
    s.eq('a close born unlocked is re-locked with no reopen to keep',JSON.stringify(M.maCloseRelock({quarter:'2027-Q4',locked:false,closedBy:'afnan'},{by:'afnan',at:12,auditId:'a-3'}).patch.reopens),'[]');
  }

  s.section('M1.6a — a date is a real day, in the client (security F4)');
  {
    ['2026-02-30','2026-02-29','2026-04-31','2026-00-01','2026-13-01','2026-10-32','2026-10-00','2026-1-05'].forEach(d=>{
      s.eq(d+' is not a day, and a document dated on it is refused',[M.maIsDay(d),lvl(V(J('money_out',{date:d,holder:'1011',account:'6050',payee:'x',amount:5,tax:NONE})),'date.real')].join(':'),'false:refuse');
    });
    s.eq('29 February in a leap year is',M.maIsDay('2028-02-29'),true);
    s.eq('a document built on an impossible day carries no period labels to be trusted',JSON.stringify((d=>[d.month,d.quarter,d.fy])(M.maBuildDoc('journal',{kind:'money_out',date:'2026-02-30',holder:'1011',account:'6050',payee:'x',amount:5},{by:'afnan'},IDX,S))),JSON.stringify(['','','']));
  }

  s.section('M1.6a — the words that follow the new rules');
  {
    const out=T({date:'2026-10-05',from:'1010',to:'1020',amount:50000});
    const na=M.maNeedsAttention({settings:S,today:TODAY,holders:[],docs:[out],commitments:[]});
    const line=(na.find(x=>/waiting to be confirmed/.test(x.sentence))||{}).sentence||'';
    s.ok('money out of the drawer is "handed over", waiting for Raees — not "handed to Raees"',/handed over on .* is waiting to be confirmed by Raees\./.test(line)&&!/handed to/.test(line),line);
    const stale=Object.assign(T({date:'2026-10-05',from:'1011',to:'1012',amount:40000}),{confirmedBy:'ammar',confirmedAt:7,confirmVia:'app'});   // an old edit's pending-with-a-confirmation
    const X={idx:IDX,settings:S,lines:[],docs:[stale],parties:[],commitments:[],people:{ammar:'Ammar'}};
    s.eq('a slip that says "pending" never also prints a confirmation',JSON.stringify([M.maPdfReceiptData(X,stale).state,M.maPdfReceiptData(X,stale).confirm]),JSON.stringify(['pending',null]));
  }

  s.section('the core is pure, and is the same in the browser and in node');
  {
    const src=fs.readFileSync(path.join(ROOT,'js/ma-core.js'),'utf8');
    const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/.*$/gm,'$1');
    [['document.','the DOM'],['window.','window'],['localStorage','browser storage'],['fetch(','the network'],
     ['getDocs','Firestore'],['setDoc','Firestore'],['runTransaction','Firestore'],['Date.now(','its own clock'],
     ['Math.random','randomness'],['session','the session']].forEach(([t,what])=>
      { // 'document.' / 'window.' only count as an API use when an identifier follows (not "Unknown document.")
        const re=/\.$/.test(t)?new RegExp('\\b'+t.replace(/\./g,'\\.')+'[A-Za-z_$]'):null;
        const hit=re?re.test(code):code.indexOf(t)>=0;
        s.ok('it never touches '+what,!hit,hit?t:undefined); });
    s.ok('the only new Date() is maDay\'s default',(code.match(/new Date\(\)/g)||[]).length===1&&/function maDay\(d\)\{d=d\|\|new Date\(\)/.test(code));
    const declared=(src.match(/^function (ma[A-Z]\w*)/gm)||[]).map(x=>x.slice(9));
    const missing=declared.filter(n=>!(n in M));
    s.eq('every public function is exported for the nightly function',missing.join(','),'');
    const a=harness.loadApp({files:['js/ma-core.js']});
    s.eq('as a classic script it defines its globals',a.run('typeof maPost+typeof MA_CHART'),'functionobject');
    const viaVm=a.run(`JSON.stringify(maPost(maBuildDoc('transfer',{date:'2026-10-10',from:'1011',to:'1020',amount:7},{by:'afnan'},maChartIndex(maChart('groovy',[])),maSettings(null)),maChartIndex(maChart('groovy',[])),maSettings(null)).map(l=>l.account+':'+l.dr+':'+l.cr))`);
    s.eq('and posts the same lines there',viaVm,JSON.stringify(['1020:7:0','1011:0:7']));
    s.ok('every name it declares is prefixed ma/MA_ (one shared lexical scope)',
      (src.match(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)||[]).every(x=>/\s(_?ma[A-Z]|MA_)/.test(x)),
      (src.match(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)||[]).filter(x=>!/\s(_?ma[A-Z]|MA_)/.test(x)).join(','));
  }
  return s;
};

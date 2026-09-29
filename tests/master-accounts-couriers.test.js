/* ─────────────────────────────────────────────────────────────────────────
   js/ma-core.js — Master Accounts M2.3: couriers in the books (29 Sept 2026).

   What this holds, all through the pure core (no page, no Firestore):
   the documents the nightly rollup writes, built by maCourierDocs from
   maCprDerive's answer (a PostEx day, the opening, one per receipt, the
   receipts dated before the books start); how each kind posts; a typed TCS
   or Bykea statement posting each line on its own day; a collection and its
   snapshot, its difference into 9030, and the opening pair of a receipt
   from before the books; who confirms a collection; the V4 rule for a
   collection waiting to go into the drawer; every rule maValidate raises
   for a statement or a collection, and decision 3 (attachments refused
   once they are on, flagged while they are off); the edit and void rules;
   the calendar's courier inflows; Needs attention's courier lines; the
   rollup's merge (unchanged → no write, a review kept or cleared, a locked
   quarter never written, an owner's typed document never touched); and
   1120 against the parcels.

   A worked example posts every courier through the books and balances.

   It cannot hold what a real CPR says (the derivation's net is its own
   definition until one CPR PDF is compared) or anything on a screen.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {suite}=require('./harness');
const M=require('../js/ma-core.js');

const J=v=>JSON.stringify(v);
const TODAY='2026-10-20';                 // a Tuesday — a CPR day
const S=M.maSettings(null);
const IDX=M.maChartIndex(M.maChart('groovy',[]));
const ATT={publicId:'ma/'+'a'.repeat(64),format:'jpg',type:'authenticated',resourceType:'image'};
let seq=0;
const meta=(u,extra)=>Object.assign({by:u||'afnan',byName:(u||'afnan').replace(/^./,c=>c.toUpperCase()),ts:++seq},extra||{});
function mk(dt,input,u,extra){
  const d=M.maBuildDoc(dt,input,meta(u,extra),IDX,S);
  d.id=(dt==='cpr'?'st':dt[0])+seq;d.no=M.maDocNo(dt,d.fy||'FY27',seq);
  return d;
}
const post=d=>M.maPost(d,IDX,S);
const bal=(lines,code)=>M.maBalanceOf(lines,IDX,code);
const sum=(ls,k)=>ls.reduce((t,l)=>t+l[k],0);
const balanced=ls=>sum(ls,'dr')===sum(ls,'cr');
function V(doc,ctx){return M.maValidate(doc,Object.assign({idx:IDX,settings:S,today:TODAY,docs:[],lines:[],parties:[],closes:[],commitments:[]},ctx||{}));}
const lvl=(r,rule)=>((r&&r.issues||[]).find(i=>i.rule===rule)||{}).level||null;
const rules=r=>(r&&r.issues||[]).map(i=>i.level+':'+i.rule).sort().join(',');
const byAcc=(ls,code)=>ls.filter(l=>l.account===code);

/* A parcel as netlify/lib/postex-core.js writes it (the M2.2 fixtures). */
let pseq=0;
function px(o){
  pseq++;
  return Object.assign({trackingNumber:'PX'+String(pseq).padStart(5,'0'),orderRefNumber:String(40000+pseq),
    status:'Delivered',statusCategory:'delivered',dispatched:true,
    transactionDate:'2026-09-01T11:20:00',orderPickupDate:'2026-09-02T09:05:00',orderDeliveryDate:'2026-09-04T16:40:00',
    cityName:'Lahore',items:1,orderDetail:'GST073-M',
    cod:3000,transactionFee:180,transactionTax:28.8,reversalFee:0,reversalTax:0,
    upfrontPayment:0,upfrontPaymentDate:null,reservePayment:0,balancePayment:0,invoiceDivision:0,
    merchantName:'GROOVY',courier:'postex',syncedAt:1790000000000},o);
}
const paid=o=>Object.assign(px({cprCheckedAt:1790100000000}),o);
const returned=o=>paid(Object.assign({status:'Returned',statusCategory:'returned',cod:2000,reversalFee:120,reversalTax:19.2},o));
const onRoad=o=>px(Object.assign({status:'En-Route',statusCategory:'in_transit',orderDeliveryDate:null},o));

/* The M2.2 opening fixture: books from 1 July 2026, today 20 July. */
const june=(day,o)=>paid(Object.assign({transactionDate:'2026-06-'+String(day-3).padStart(2,'0')+'T10:00:00',orderPickupDate:'2026-06-'+String(day-2).padStart(2,'0')+'T10:00:00',orderDeliveryDate:'2026-06-'+String(day).padStart(2,'0')+'T15:00:00'},o));
const PARCELS=[
  june(20,{trackingNumber:'JA',cprNumber_1:'JUN-1',cpr1Date:'2026-06-26',upfrontPayment:2200,cprNumber_2:'JUL-2',cpr2Date:'2026-07-07',reservePayment:591.2,settle:true,settlementDate:'2026-07-07'}),
  june(29,{trackingNumber:'JB',cod:1500,transactionFee:150,transactionTax:24}),
  june(27,{trackingNumber:'JC',cod:2000,cprNumber_1:'JUL-1',cpr1Date:'2026-07-03',upfrontPayment:1400}),
  returned({trackingNumber:'JD',transactionDate:'2026-06-22T10:00:00',orderPickupDate:'2026-06-23T10:00:00',orderDeliveryDate:'2026-06-28T12:00:00',cprNumber_2:'JUL-2',cpr2Date:'2026-07-07',reservePayment:-139.2,settle:true,settlementDate:'2026-07-07'}),
  paid({trackingNumber:'JE',cod:2500,transactionDate:'2026-06-28T10:00:00',orderPickupDate:'2026-06-29T10:00:00',orderDeliveryDate:'2026-07-02T15:00:00',cprNumber_1:'JUL-1',cpr1Date:'2026-07-03',upfrontPayment:1600}),
  onRoad({trackingNumber:'JF',cod:1800,transactionDate:'2026-07-15T10:00:00',orderPickupDate:'2026-07-16T10:00:00'}),
  paid({trackingNumber:'JG',cod:1000,transactionFee:100,transactionTax:16,transactionDate:'2026-07-07T10:00:00',orderPickupDate:'2026-07-08T10:00:00',orderDeliveryDate:'2026-07-10T15:00:00'})
];
const DER=M.maCprDerive(PARCELS,{from:'2026-07-01',today:'2026-07-20'});

module.exports=function(){
  const s=suite('master-accounts-couriers');
  const DOCS=M.maCourierDocs(DER,S);
  const get=id=>DOCS.find(d=>d.id===id)||null;

  s.section('the derived documents (maCourierDocs)');
  {
    s.eq('a day per delivery day, the opening, one per receipt, and the receipt from before the books',
      DOCS.map(d=>d.id+':'+d.kind+':'+d.status).join(' '),
      'postex-day-2026-07-02:day:posted postex-day-2026-07-10:day:posted postex-opening:opening:posted postex-JUL-1:upfront:posted postex-JUL-2:reserve:posted postex-JUN-1:upfront:before');
    s.ok('every one is derived, PostEx\'s, written by the rollup',DOCS.every(d=>d.derived===true&&d.courier==='postex'&&d.dt==='cpr'&&d.by===M.MA_ROLLUP_BY&&d.source==='postex'));
    s.eq('numbers: PX-<yymmdd>, PX-OPEN, and a receipt\'s own number',DOCS.map(d=>d.no).join(','),'PX-260702,PX-260710,PX-OPEN,JUL-1,JUL-2,JUN-1');
    const d=get('postex-day-2026-07-02')||{};
    s.eq('the day carries COD, the delivery fee and tax, whole rupees',J([d.delivered,d.returned,d.net]),J([{parcels:1,cod:2500,fee:180,tax:29},{parcels:0,fee:0,tax:0},2291]));
    s.eq('… period labels from its date (historical: before go-live)',J([d.month,d.fy,d.historical]),J(['2026-07','FY27',true]));
    s.eq('the opening is dated the day the books start, for what PostEx owed then',J([(get('postex-opening')||{}).date,(get('postex-opening')||{}).amount]),J(['2026-07-01',3569]));
    const b=get('postex-JUN-1')||{};
    s.eq('a receipt dated before the books is kept as `before`, opening on the first day',J([b.status,b.date,b.openAt,b.net]),J(['before','2026-06-26','2026-07-01',2200]));
    s.eq('… and posts nothing',post(b).length,0);
    const out=M.maCourierDocs(DER,Object.assign({},S,{couriers:Object.assign({},S.couriers,{postex:Object.assign({},S.couriers.postex,{beforeWindowDays:3})})}));
    s.ok('a receipt older than the before-window is left out',!out.some(x=>x.id==='postex-JUN-1'));
    s.eq('an undated receipt is `undated`, and posts nothing',(()=>{const r=M.maCourierDocs({cprs:[{id:'postex-X',number:'X',date:'',kind:'upfront',net:500,parts:{}}]},S)[0];return r?r.status+':'+post(r).length:'none';})(),'undated:0');
    const again=M.maCourierDocs(DER,S);
    s.eq('the same data gives the same sig',again.map(x=>x.sig).join(),DOCS.map(x=>x.sig).join());
    const moved=M.maCprDerive(PARCELS.map(p=>p.trackingNumber==='JG'?Object.assign({},p,{cod:1100}):p),{from:'2026-07-01',today:'2026-07-20'});
    const m2=M.maCourierDocs(moved,S).find(x=>x.id==='postex-day-2026-07-10');
    s.ok('a moved figure moves the sig',!!m2&&m2.sig!==(get('postex-day-2026-07-10')||{}).sig);
    s.eq('a data issue on a receipt rides on it as a flag',M.maCourierDocs({cprs:[{id:'postex-Y',number:'Y',date:'2026-07-10',kind:'upfront',net:1,parts:{}}],issues:[{rule:'parcel.duplicate',message:'twice',refs:{receipts:['Y']}}]},S)[0].flags.map(f=>f.rule).join(),'parcel.duplicate');
  }

  s.section('how PostEx posts: days, the opening, receipts — and 1120 against the parcels');
  {
    const L=M.maPostAll(DOCS,IDX,S);
    s.ok('every derived document balances',DOCS.every(d=>balanced(post(d))));
    const day=post(get('postex-day-2026-07-02'));
    s.eq('a day: COD into 1120 against 4010, fee and tax to 5060 out of 1120',
      day.map(l=>l.account+':'+l.dr+'/'+l.cr).join(' '),'1120:2500/0 4010:0/2500 5060:180/0 5060:29/0 1120:0/209');
    s.eq('the opening: 1120 against 3090',post(get('postex-opening')).map(l=>l.account+':'+l.dr+'/'+l.cr).join(' '),'1120:3569/0 3090:0/3569');
    s.eq('a receipt moves its net from 1120 to 1121 (issued, not collected)',post(get('postex-JUL-1')).map(l=>l.account+':'+l.dr+'/'+l.cr).join(' '),'1121:3000/0 1120:0/3000');
    s.eq('1120 after it all',bal(L,'1120'),3292);
    s.eq('… is exactly what the parcels say PostEx owes today',DER.transit.owed,3292);
    s.eq('maCourier1120Check: no difference',J(M.maCourier1120Check(L,IDX,DER)),J({ledger1120:3292,transit1120:3292,diff:0}));
    s.eq('… and it says so when they differ',M.maCourier1120Check(L.slice(1),IDX,DER).diff,-2500);
    s.eq('4010 holds every delivered parcel\'s COD inside the books',bal(L,'4010'),3500);
    s.eq('the lines carry the courier',L.every(l=>l.courier==='postex'),true);
    // A return inside the books: its reversal fee and tax are 5070, not 5060.
    const r=M.maCprDerive([returned({trackingNumber:'R1',orderDeliveryDate:'2026-09-10T12:00:00'})],{from:'2026-07-01',today:'2026-09-20'});
    const rd=M.maCourierDocs(r,S).find(x=>x.kind==='day');
    const rl=rd?post(rd):[];
    s.eq('a day\'s returns are charged to 5070, reversals — never 5060',rl.map(l=>l.account+':'+l.dr+'/'+l.cr).join(' '),'5070:120/0 5070:19/0 1120:0/139');
    // Courier GST: not claimable by default; the setting moves it to 1160.
    const claim=Object.assign({},S,{couriers:Object.assign({},S.couriers,{postex:Object.assign({},S.couriers.postex,{taxClaimable:true})})});
    const cd=M.maCourierDocs(DER,claim).find(x=>x.id==='postex-day-2026-07-02');
    s.eq('taxClaimable on: the tax goes to 1160, the fee stays a cost',M.maPost(cd,IDX,claim).map(l=>l.account+':'+l.dr+'/'+l.cr).join(' '),'1120:2500/0 4010:0/2500 5060:180/0 1160:29/0 1120:0/209');
    s.eq('off (the default): no 1160 line',byAcc(day,'1160').length,0);
  }

  s.section('a typed TCS or Bykea statement: each line on its own day');
  {
    const st=mk('cpr',{courier:'tcs',date:'2026-07-31',ref:'TCS-JUL',attachments:[ATT],lines:[
      {date:'2026-07-10',parcels:2,cod:5000,fee:250,tax:40},
      {date:'2026-07-12',parcels:1,returned:true,cod:900,fee:100,tax:16,memo:'refused at the door'}]});
    s.eq('its kind, courier, and figures',J([st.kind,st.courier,st.derived,st.amount,st.net,st.parcels,st.fees,st.taxes]),J(['statement','tcs',false,5000,4594,3,350,56]));
    s.eq('a returned line carries no COD, whatever was typed',st.lines[1].cod,0);
    s.eq('its number is CS',M.MA_DOC_TYPES.cpr.prefix,'CS');
    const L=post(st);
    s.ok('it balances',balanced(L));
    s.eq('each line posts on its OWN day',L.map(l=>l.date).join(','),'2026-07-10,2026-07-10,2026-07-10,2026-07-10,2026-07-10,2026-07-12,2026-07-12,2026-07-12');
    s.eq('delivered: 1122 against 4010, fee and tax to 5060; returned: 5070',L.map(l=>l.account+':'+l.dr+'/'+l.cr).join(' '),
      '1122:5000/0 4010:0/5000 5060:250/0 5060:40/0 1122:0/290 5070:100/0 5070:16/0 1122:0/116');
    s.eq('… the memo rides on its lines',L[5].memo,'refused at the door');
    s.eq('1122 holds the net',bal(L,'1122'),4594);
    s.eq('clean with the file attached',rules(V(st,{attach:'signed'})),'');
  }

  s.section('a collection: the snapshot, the difference, and a receipt from before the books');
  {
    const recv=DOCS.filter(d=>['postex-JUL-1','postex-JUL-2','postex-JUN-1'].indexOf(d.id)>=0);
    const cl=mk('collection',{courier:'postex',holder:'1011',amount:3440,date:'2026-07-08',cprNos:['postex-JUL-1','postex-JUL-2'],collectedBy:'Noman',attachments:[ATT]},'afnan',{cprs:recv});
    s.eq('its snapshot: each receipt as it stood',J(cl.covers),J([{id:'postex-JUL-1',no:'JUL-1',date:'2026-07-03',net:3000},{id:'postex-JUL-2',no:'JUL-2',date:'2026-07-07',net:452}]));
    s.eq('expected is their net, the difference what was counted less it',J([cl.expected,cl.difference,cl.status]),J([3452,-12,'posted']));
    s.eq('it posts: the holder, 1121 by the net, 9030 the difference',post(cl).map(l=>l.account+':'+l.dr+'/'+l.cr).join(' '),'1011:3440/0 1121:0/3452 9030:12/0');
    s.eq('within the tolerance: clean',rules(V(cl,{docs:DOCS,attach:'signed'})),'');
    const later=Object.assign({},get('postex-JUL-2'),{net:500});
    s.eq('a receipt that moves AFTER it was collected leaves the collection as it was',post(mk('collection',{courier:'postex',holder:'1011',amount:3440,date:'2026-07-08',cprNos:['postex-JUL-1','postex-JUL-2']},'afnan',{covers:cl.covers,cprs:[later]})).map(l=>l.dr+l.cr).join(','),'3440,3452,12');
    const bf=mk('collection',{courier:'postex',holder:'1020',amount:2200,date:'2026-07-02',cprNos:['postex-JUN-1'],attachments:[ATT]},'afnan',{cprs:recv});
    s.eq('a receipt from before the books keeps its openAt in the snapshot',J(bf.covers[0]),J({id:'postex-JUN-1',no:'JUN-1',date:'2026-06-26',net:2200,openAt:'2026-07-01'}));
    const bl=post(bf);
    s.ok('it balances',balanced(bl));
    s.eq('… it posts the cash, and the opening pair on the first day (still to collect then)',bl.map(l=>l.account+':'+l.date+':'+l.dr+'/'+l.cr).join(' '),
      '1020:2026-07-02:2200/0 1121:2026-07-02:0/2200 1121:2026-07-01:2200/0 3090:2026-07-01:0/2200');
    s.eq('clean',rules(V(bf,{docs:DOCS,attach:'signed'})),'');
    s.eq('a collection\'s number is CL',M.MA_DOC_TYPES.collection.prefix,'CL');
  }

  s.section('who confirms a collection (MA_HANDS — the transfer rule with no "from")');
  {
    const c=(h,u)=>{const x=M.maCollectionConfirm(h,u);return x.pending+':'+x.confirmBy+':'+x.paper;};
    s.eq('into MCB (nobody\'s hands): posts at once',c('1020','afnan'),'false:null:false');
    s.eq('into the TCS account: posts at once',c('1060','ammar'),'false:null:false');
    s.eq('into Afnan\'s cash, recorded by Afnan: he has confirmed by recording it',c('1011','afnan'),'false:null:false');
    s.eq('into Afnan\'s cash, recorded by Ammar: waits for Afnan, in the app',c('1011','ammar'),'true:afnan:false');
    s.eq('into the drawer: waits for Raees, on paper — even when an owner records it',c('1010','afnan'),'true:raees:true');
    const pend=mk('collection',{courier:'bykea',holder:'1010',amount:1140,date:'2026-08-06',cprNos:['x']},'afnan',{cprs:[]});
    s.eq('a pending collection posts nothing',J([pend.status,post(pend).length]),J(['pending',0]));
    s.eq('Raees cannot sign in; an owner confirms on paper',J(M.maConfirmPatch(pend,'ammar',{at:5}).patch),J({status:'posted',confirmedBy:'ammar',confirmedAt:5,confirmedFor:'raees',confirmVia:'paper'}));
    s.ok('… and is warned to wait for Raees\'s cash in first',/Raees has recorded/.test(M.maConfirmWarning(pend)));
    const ap=mk('collection',{courier:'postex',holder:'1011',amount:100,date:'2026-08-06',cprNos:['x']},'ammar',{cprs:[]});
    s.ok('Afnan\'s cash, recorded by Ammar: Ammar cannot confirm it',!!M.maConfirmPatch(ap,'ammar',{}).error);
    s.eq('… Afnan does, in the app',(M.maConfirmPatch(ap,'afnan',{at:7}).patch||{}).confirmVia,'app');
    s.ok('a posted collection is not confirmed again',!!M.maConfirmPatch(Object.assign({},ap,{status:'posted'}),'afnan',{}).error);
    s.ok('not in a locked quarter',/closed/.test(M.maConfirmPatch(ap,'afnan',{},{closes:[{quarter:M.maQuarterOf('2026-08-06',S.fiscalYearStart),locked:true}],settings:S}).error||''));
    // V4: a collection waiting to go INTO the drawer is out of the drawer's figure.
    const rows=M.maHolderRows(IDX,[],[pend],{settings:S,mirrorBalances:{'1010':50000}});
    const dr=rows.find(r=>r.code==='1010')||{};
    s.eq('V4: it is the drawer\'s pendingIn',dr.pendingIn,1140);
    s.eq('… so maHolderCash takes it out of Store Accounts\' figure',J(M.maHolderCash(dr)),J({amount:48860,waiting:1140}));
    const af=rows.find(r=>r.code==='1011')||{};
    s.eq('a pending collection into Afnan\'s cash counts as pendingIn there too',M.maHolderRows(IDX,[],[ap],{settings:S}).find(r=>r.code==='1011').pendingIn,100);
    s.eq('… and nowhere else',af.pendingIn,0);
  }

  s.section('the statement\'s rules (maValidate)');
  {
    const base={courier:'tcs',date:'2026-08-31',ref:'T-1',attachments:[ATT],lines:[{date:'2026-08-10',parcels:1,cod:1000,fee:50,tax:8}]};
    const st=i=>mk('cpr',Object.assign({},base,i));
    s.eq('clean',rules(V(st({}),{attach:'signed'})),'');
    s.eq('PostEx is never typed',lvl(V(st({courier:'postex'})),'statement.courier'),'refuse');
    s.eq('Blue-Ex opens on the opening balance, not a statement',lvl(V(st({courier:'bluex'})),'statement.courier'),'refuse');
    s.eq('a derived document is never validated as typed',lvl(V(DOCS[0]),'cpr.derived'),'refuse');
    s.eq('no lines: refused',lvl(V(st({lines:[]})),'statement.lines'),'refuse');
    s.eq('too many lines: refused',lvl(V(st({lines:Array(201).fill(base.lines[0])})),'statement.lines'),'refuse');
    s.eq('a line with no day: refused',lvl(V(st({lines:[{parcels:1,cod:1000}]})),'statement.lines'),'refuse');
    s.eq('a line before the books: refused',lvl(V(st({lines:[{date:'2026-06-20',parcels:1,cod:1000}]})),'statement.lines'),'refuse');
    s.eq('a line after the statement\'s date: refused',lvl(V(st({lines:[{date:'2026-09-02',parcels:1,cod:1000}]})),'statement.lines'),'refuse');
    s.eq('a line in a closed quarter: refused',lvl(V(st({date:'2026-10-02',lines:[{date:'2026-08-10',parcels:1,cod:1000}]}),{closes:[{quarter:M.maQuarterOf('2026-08-10',S.fiscalYearStart),locked:true}]}),'statement.lines'),'refuse');
    s.eq('no parcel count: refused',lvl(V(st({lines:[{date:'2026-08-10',cod:1000}]})),'statement.parcels'),'refuse');
    s.eq('a fraction of a rupee: refused',lvl(V(st({lines:[{date:'2026-08-10',parcels:1,cod:1000.5}]})),'statement.lines'),'refuse');
    s.eq('only returns: nothing to collect — a Money out',lvl(V(st({lines:[{date:'2026-08-10',parcels:1,returned:true,fee:50}]})),'statement.amount'),'refuse');
    const d1=st({});d1.id='cs-a';
    s.eq('the same courier reference twice: flagged',lvl(V(st({}),{docs:[d1]}),'statement.ref_dup'),'flag');
    // Decision 3.
    const bare=st({attachments:[]});
    s.eq('decision 3: attachments ON (signed) — the statement file is required',lvl(V(bare,{attach:'signed'}),'statement.attach'),'refuse');
    s.eq('… ON (public) too',lvl(V(bare,{attach:'public'}),'statement.attach'),'refuse');
    s.eq('… OFF (not set up): saved and flagged',lvl(V(bare,{attach:'not_configured'}),'statement.attach'),'flag');
    s.eq('… state unknown: flagged, never refused',lvl(V(bare,{}),'statement.attach'),'flag');
    const flagged=Object.assign({},bare,{flags:[{rule:'statement.attach',message:'x'}]});
    s.eq('attaching the file later answers the flag',M.maLiveFlags(Object.assign({},flagged,{attachments:[ATT]})).length,0);
    s.eq('… until then it stands',M.maLiveFlags(flagged).length,1);
  }

  s.section('the collection\'s rules (maValidate)');
  {
    const tcs=mk('cpr',{courier:'tcs',date:'2026-07-31',ref:'TCS-JUL',attachments:[ATT],lines:[{date:'2026-07-10',parcels:2,cod:5000,fee:250,tax:40}]});
    tcs.id='cs-tcs';
    const bk=mk('cpr',{courier:'bykea',date:'2026-08-05',attachments:[ATT],lines:[{date:'2026-08-03',parcels:1,cod:1200,fee:60,tax:0}]});
    bk.id='cs-bk';
    const zero=Object.assign({},get('postex-JUL-2'),{id:'postex-Z',net:0,no:'Z'});
    const docs=DOCS.concat([tcs,bk,zero]);
    const CL=(i,u)=>mk('collection',Object.assign({courier:'postex',holder:'1011',date:'2026-07-08',attachments:[ATT]},i),u||'afnan',{cprs:docs});
    const VC=(d,ctx)=>V(d,Object.assign({docs,attach:'signed'},ctx||{}));
    s.eq('an unknown courier: refused',lvl(VC(CL({courier:'dhl',cprNos:['postex-JUL-1'],amount:3000})),'collection.courier'),'refuse');
    s.eq('a PostEx collection names its CPRs',lvl(VC(CL({cprNos:[],amount:3000})),'collection.covers'),'refuse');
    s.eq('at most 40',lvl(VC(CL({cprNos:Array.from({length:41},(_,i)=>'x'+i),amount:3000})),'collection.covers'),'refuse');
    s.eq('a CPR not in the books: refused',lvl(VC(CL({cprNos:['postex-NOPE'],amount:3000})),'collection.cpr_exists'),'refuse');
    s.eq('a day is not a statement: refused',lvl(VC(CL({cprNos:['postex-day-2026-07-02'],amount:3000})),'collection.cpr_exists'),'refuse');
    s.eq('an undated receipt cannot be collected yet',lvl(V(CL({cprNos:['postex-U'],amount:3000}),{docs:docs.concat([Object.assign({},get('postex-JUL-1'),{id:'postex-U',status:'undated'})]),attach:'signed'}),'collection.cpr_exists'),'refuse');
    s.eq('one collection is one courier\'s cash',lvl(VC(CL({cprNos:['postex-JUL-1','cs-tcs'],amount:3000})),'collection.mixed'),'refuse');
    const one=CL({cprNos:['postex-JUL-1'],amount:3000});one.id='cl-one';
    s.eq('a CPR collected once: a second collection is refused',lvl(V(CL({cprNos:['postex-JUL-1'],amount:3000}),{docs:docs.concat([one]),attach:'signed'}),'collection.once'),'refuse');
    s.eq('… a void one does not count',lvl(V(CL({cprNos:['postex-JUL-1'],amount:3000}),{docs:docs.concat([Object.assign({},one,{status:'void'})]),attach:'signed'}),'collection.once'),null);
    s.eq('… nor the collection itself, on an edit',lvl(V(Object.assign({},one,{note:'x'}),{docs:docs.concat([one]),before:one,attach:'signed'}),'collection.once'),null);
    s.eq('collected before the CPR was issued: refused',lvl(VC(CL({cprNos:['postex-JUL-2'],amount:452,date:'2026-07-05'})),'collection.date'),'refuse');
    s.eq('a receipt from before the books, its opening quarter closed: refused',
      lvl(VC(CL({cprNos:['postex-JUN-1'],amount:2200,date:'2026-10-02'}),{closes:[{quarter:M.maQuarterOf('2026-07-01',S.fiscalYearStart),locked:true}]}),'collection.before_closed'),'refuse');
    s.eq('TCS\'s credits go into the TCS account only',lvl(VC(CL({courier:'tcs',cprNos:['cs-tcs'],amount:4710,holder:'1020',date:'2026-10-15'})),'collection.holder'),'refuse');
    s.eq('… and nothing else goes there',lvl(VC(CL({cprNos:['postex-JUL-1'],amount:3000,holder:'1060'})),'collection.holder'),'refuse');
    s.eq('a TCS credit into 1060: clean',rules(VC(CL({courier:'tcs',cprNos:['cs-tcs'],amount:4710,holder:'1060',date:'2026-10-15'}))),'');
    s.eq('credited before TCS\'s 90 days: flagged',lvl(VC(CL({courier:'tcs',cprNos:['cs-tcs'],amount:4710,holder:'1060',date:'2026-08-01'})),'collection.tcs_early'),'flag');
    s.eq('a receipt that nets nothing: nothing to collect',lvl(VC(CL({cprNos:['postex-Z'],amount:10})),'collection.nothing'),'refuse');
    s.eq('Bykea into the drawer is allowed (it waits for Raees)',rules(VC(CL({courier:'bykea',cprNos:['cs-bk'],amount:1140,holder:'1010',date:'2026-08-06'}))),'');
    const far=CL({cprNos:['postex-JUL-1'],amount:2800});
    s.eq('a difference past the tolerance: flagged …',lvl(V(Object.assign({},far,{note:'short'}),{docs,attach:'signed'}),'collection.difference'),'flag');
    s.eq('… and a reason is required',lvl(VC(far),'collection.reason'),'refuse');
    s.eq('within the tolerance (1%): nothing',lvl(VC(CL({cprNos:['postex-JUL-1'],amount:2980})),'collection.difference'),null);
    s.eq('the holder must be money',lvl(VC(CL({cprNos:['postex-JUL-1'],amount:3000,holder:'4010'})),'holder.money'),'refuse');
    // Decision 3.
    const bare=CL({cprNos:['postex-JUL-1'],amount:3000,attachments:[]});
    s.eq('decision 3: the receipt is required once attachments are on',lvl(V(bare,{docs,attach:'signed'}),'collection.receipt'),'refuse');
    s.eq('… flagged while they are off',lvl(V(bare,{docs,attach:'not_configured'}),'collection.receipt'),'flag');
    s.eq('… flagged when the state is unknown',lvl(V(bare,{docs}),'collection.receipt'),'flag');
    // Blue-Ex: against its opening balance.
    const oj=mk('journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1123',side:'dr',amount:10000}]});
    const OL=post(oj);
    const bx=i=>mk('collection',Object.assign({courier:'bluex',holder:'1020',date:'2026-08-10',amount:4000,attachments:[ATT]},i),'afnan',{cprs:[]});
    s.eq('Blue-Ex names no statements',lvl(VC(bx({cprNos:['postex-JUL-1']})),'collection.covers'),'refuse');
    s.eq('Blue-Ex expects what was collected, so no difference',J([bx({}).expected,bx({}).difference]),J([4000,0]));
    s.eq('it posts the holder against 1123',post(bx({})).map(l=>l.account+':'+l.dr+'/'+l.cr).join(' '),'1020:4000/0 1123:0/4000');
    s.eq('before Blue-Ex\'s opening: flagged',lvl(V(bx({}),{docs:[],attach:'signed'}),'collection.bluex_opening'),'flag');
    s.eq('with it: clean',rules(V(bx({}),{docs:[oj],lines:OL,attach:'signed'})),'');
    s.eq('more than Blue-Ex still owes: flagged',lvl(V(bx({amount:12000}),{docs:[oj],lines:OL,attach:'signed'}),'collection.bluex_over'),'flag');
    const prev=bx({});prev.id='bx-1';
    s.eq('the same amount again within a week: flagged',lvl(V(bx({date:'2026-08-12'}),{docs:[oj,prev],lines:OL,attach:'signed'}),'duplicate'),'flag');
  }

  s.section('the opening balance and money in: what the rollup already books');
  {
    const oj=l=>mk('journal',{kind:'opening',date:'2026-07-01',lines:l});
    s.eq('a 1120 line on the opening: flagged — PostEx opens from its parcels',lvl(V(oj([{account:'1120',side:'dr',amount:500}])),'opening.derived'),'flag');
    s.eq('… so is 1121',lvl(V(oj([{account:'1121',side:'dr',amount:500}])),'opening.derived'),'flag');
    s.eq('Blue-Ex\'s 1123 is typed there: never flagged',lvl(V(oj([{account:'1123',side:'dr',amount:500}])),'opening.derived'),null);
    s.eq('a Money in to 4010 (online COD): flagged',lvl(V(mk('journal',{kind:'money_in',date:'2026-10-05',holder:'1020',account:'4010',amount:100,note:'x'})),'account.derived'),'flag');
    s.eq('TCS\'s account (1060) is switched on',M.maAcc(IDX,'1060').active,true);
  }

  s.section('edits and voids');
  {
    const tcs=mk('cpr',{courier:'tcs',date:'2026-07-31',ref:'TCS-JUL',attachments:[ATT],lines:[{date:'2026-07-10',parcels:2,cod:5000,fee:250,tax:40}]});tcs.id='cs-t';
    const docs=[tcs];
    const cl=mk('collection',{courier:'tcs',holder:'1060',amount:4710,date:'2026-10-15',cprNos:['cs-t'],attachments:[ATT]},'afnan',{cprs:docs});cl.id='cl-t';
    const all=docs.concat([cl]);
    const edit=(b,i,extra)=>Object.assign(M.maBuildDoc(b.dt,Object.assign({},b,{cprNos:(b.refs||{}).cprNos},i),meta(b.by,Object.assign({covers:b.covers},extra||{})),IDX,S),{id:b.id,no:b.no});
    s.eq('an edit keeps the snapshot it was recorded with',J(edit(cl,{note:'x'}).covers),J(cl.covers));
    s.eq('a note edit is clean',rules(V(edit(cl,{note:'from TCS'}),{docs:all,before:cl,reason:'typo',attach:'signed'})),'');
    s.eq('what it covers cannot change',lvl(V(Object.assign({},cl,{covers:[]}),{docs:all,before:cl,attach:'signed'}),'edit.covers'),'refuse');
    const pend=mk('collection',{courier:'postex',holder:'1011',amount:3000,date:'2026-07-08',cprNos:['postex-JUL-1'],attachments:[ATT]},'ammar',{cprs:DOCS});pend.id='cl-p';
    s.eq('a collection that waits for someone keeps its amount',lvl(V(Object.assign({},pend,{amount:2990,difference:-10}),{docs:DOCS.concat([pend]),before:pend,attach:'signed'}),'edit.confirmed'),'refuse');
    const mcb=mk('collection',{courier:'postex',holder:'1020',amount:3000,date:'2026-07-08',cprNos:['postex-JUL-1'],attachments:[ATT]},'afnan',{cprs:DOCS});mcb.id='cl-m';
    s.eq('an edit cannot send a posted one to a holder that waits',lvl(V(Object.assign({},mcb,{holder:'1010'}),{docs:DOCS.concat([mcb]),before:mcb,attach:'signed'}),'edit.route'),'refuse');
    s.eq('a statement\'s courier cannot change',lvl(V(Object.assign({},tcs,{courier:'bykea'}),{docs:all,before:tcs,attach:'signed'}),'edit.courier'),'refuse');
    const moved=Object.assign({},tcs,{lines:[{date:'2026-07-10',parcels:2,cod:5100,fee:250,tax:40}],amount:5100,net:4810});
    s.eq('a collected statement\'s figures cannot change',lvl(V(moved,{docs:all,before:tcs,attach:'signed'}),'edit.collected'),'refuse');
    s.eq('… its note can',lvl(V(Object.assign({},tcs,{note:'x'}),{docs:all,before:tcs,attach:'signed'}),'edit.collected'),null);
    s.ok('the edit fields: a statement\'s lines, a collection\'s holder and amount',M.MA_EDIT_FIELDS.cpr.indexOf('lines')>=0&&M.MA_EDIT_FIELDS.collection.indexOf('amount')>=0&&M.MA_EDIT_FIELDS.collection.indexOf('cprNos')<0);
    const vr=(d,c)=>M.maVoidIssues(d,'wrong',Object.assign({settings:S,docs:all},c||{})).map(i=>i.rule).join(',');
    s.eq('a derived document is never voided by hand — it is disputed',vr(DOCS[0]),'void.derived');
    s.eq('a statement a live collection covers: void the collection first',vr(tcs),'void.collected');
    s.eq('… once that is void, it can be',vr(tcs,{docs:[tcs,Object.assign({},cl,{status:'void'})]}),'');
  }

  s.section('disputes (the one thing an owner changes on a derived document)');
  {
    const d=DOCS[3];
    s.eq('an owner opens one, with a reason',J((M.maDisputePatch(d,'afnan',{state:'open',reason:'short by 50'},{at:3}).patch||{}).dispute),J({state:'open',reason:'short by 50',by:'afnan',at:3}));
    s.ok('no reason, no dispute',!!M.maDisputePatch(d,'afnan',{state:'open'}).error);
    s.ok('not by anyone else',!!M.maDisputePatch(d,'raees',{state:'open',reason:'x'}).error);
    s.ok('not on a typed statement',!!M.maDisputePatch(mk('cpr',{courier:'tcs',date:'2026-08-01',lines:[]}),'afnan',{state:'open',reason:'x'}).error);
    const open=Object.assign({},d,{dispute:{state:'open',reason:'x',by:'afnan',at:1}});
    s.eq('resolved by the other owner, the reason kept',J((M.maDisputePatch(open,'ammar',{state:'resolved',note:'paid'},{at:9}).patch||{}).dispute),J({state:'resolved',reason:'x',by:'afnan',at:1,resolvedBy:'ammar',resolvedAt:9,note:'paid'}));
    s.ok('nothing open, nothing to resolve',!!M.maDisputePatch(d,'ammar',{state:'resolved'}).error);
    s.eq('the owner fields are the review and the dispute',M.MA_DERIVED_OWNER_FIELDS.join(),'reviewedAt,reviewedBy,dispute');
  }

  s.section('the rollup\'s merge: stored against new');
  {
    const locked=q=>q===M.maQuarterOf('2026-07-01',S.fiscalYearStart);
    const n=get('postex-JUL-1');
    s.eq('nothing stored: create',M.maCourierMerge(null,n,{at:5}).action,'create');
    s.eq('… not into a locked quarter',J(M.maCourierMerge(null,n,{at:5,locked})),J({action:'skip',why:'locked',quarter:n.quarter}));
    const stored=Object.assign({},n,{ts:4,reviewedAt:9,reviewedBy:'ammar',dispute:{state:'open',reason:'x'}});
    s.eq('the same sig: no write at all',M.maCourierMerge(stored,n,{at:5}).action,'none');
    const flagOnly=Object.assign({},n,{flags:[{rule:'parcel.duplicate',message:'twice',field:null}],sig:'v1:other'});
    const f=M.maCourierMerge(stored,flagOnly,{at:6});
    s.eq('a changed flag: an update …',J([f.action,f.fields]),J(['update',['flags']]));
    s.eq('… that keeps the review (no figure moved) and the dispute',J([f.doc.reviewedAt,f.doc.reviewedBy,f.doc.dispute]),J([9,'ammar',{state:'open',reason:'x'}]));
    s.eq('… one more revision, created when it was',J([f.doc.rev,f.doc.ts]),J([2,4]));
    const e=(f.doc.edits||[]).slice(-1)[0]||{};
    s.eq('… with an edit row by the nightly rollup',J([e.by,e.byName,e.at,e.fields]),J(['ma-rollup','Nightly courier rollup',6,['flags']]));
    const netMoved=Object.assign({},n,{net:3100,amount:3100,sig:'v1:moved'});
    const g=M.maCourierMerge(stored,netMoved,{at:7});
    s.eq('a figure moved: the review is cleared (an owner reviewed the old figures)',J([g.doc.reviewedAt,g.doc.reviewedBy]),J([null,null]));
    s.eq('… the dispute stays',J(g.doc.dispute),J({state:'open',reason:'x'}));
    s.eq('a locked quarter is never written',J(M.maCourierMerge(stored,netMoved,{at:7,locked})),J({action:'skip',why:'locked',quarter:n.quarter}));
    s.eq('a document an owner typed at that id is never touched',J(M.maCourierMerge(Object.assign({},stored,{derived:false}),netMoved,{})),J({action:'skip',why:'typed'}));
    s.eq('a voided one PostEx reports again is written back',M.maCourierMerge(Object.assign({},stored,{status:'void',sig:'void'}),n,{}).action,'update');
    s.eq('gone from the data: voided, never deleted',J([M.maCourierGone(stored,{at:8}).action,(M.maCourierGone(stored,{at:8}).doc||{}).voidedBy]),J(['void','ma-rollup']));
    const col={dt:'collection',status:'posted',refs:{cprNos:[n.id]}};
    s.eq('… unless a live collection covers it',M.maCourierGone(stored,{docs:[col]}).why,'collected');
    s.eq('… or its quarter is locked',M.maCourierGone(stored,{locked}).why,'locked');
    const plan=M.maCourierPlan(DOCS.slice(0,4).concat([Object.assign({},stored,{id:'postex-OLD',sig:'v1:x'}),Object.assign({},stored,{id:'cs-typed',derived:false})]),DOCS,{at:10});
    s.eq('the plan: unchanged, created, voided — the typed one left alone',J([plan.unchanged,plan.created,plan.updated,plan.voided,plan.writes.map(w=>w.action+':'+w.id).join(' ')]),
      J([4,2,0,1,'create:postex-JUL-2 create:postex-JUN-1 void:postex-OLD']));
    const again=M.maCourierPlan(DOCS,M.maCourierDocs(DER,S),{at:11});
    s.eq('a second run over the same data writes nothing',J([again.writes.length,again.unchanged]),J([0,DOCS.length]));
  }

  s.section('the calendar: what the couriers still owe in the next 30 days');
  {
    const rc=(id,date,net)=>Object.assign({},get('postex-JUL-1'),{id,no:id,ref:id,date,net});
    const tcs=mk('cpr',{courier:'tcs',date:'2026-07-31',lines:[{date:'2026-07-25',parcels:1,cod:2000,fee:100,tax:0}]});tcs.id='cs-c';
    const docs=[rc('late','2026-10-09',1000),rc('soon','2026-10-23',2000),tcs,rc('done','2026-10-16',400),
      {dt:'collection',status:'posted',refs:{cprNos:['done']}}];
    const f=M.maCourierInflows({docs,today:TODAY,settings:S,run:{transit:{awaitingUpfront:{amount:5000}}}});
    const pick=cpr=>f.find(x=>x.cpr===cpr)||{};
    s.eq('a CPR not collected by its day lands on TODAY, late',J([pick('late').day,pick('late').late,pick('late').due]),J([TODAY,true,'2026-10-10']));
    s.eq('one still to come: on its day + PostEx\'s collect lag',J([pick('soon').day,pick('soon').late]),J(['2026-10-24',false]));
    s.eq('a collected one is not expected',f.some(x=>x.cpr==='done'),false);
    s.eq('TCS: its last line + 90 days, into the TCS account — never spendable',J([pick('cs-c').day,pick('cs-c').spendable]),J(['2026-10-23',false]));
    const up=f.find(x=>x.estimate)||{};
    s.eq('only transit\'s expected UPFRONT, on the next CPR day + the lag, marked an estimate',J([up.amount,up.cprDay,up.day]),J([5000,'2026-10-20','2026-10-21']));
    const cal=M.maCalendar({today:TODAY,settings:S,start:0,commitments:[],docs:[],inflows:f});
    const day=d=>cal.days.find(c=>c.day===d)||{};
    s.eq('the calendar adds a PostEx CPR to what can be spent',day('2026-10-24').in,2000);
    s.eq('… never the TCS credit, though it is shown',J([day('2026-10-23').in,day('2026-10-23').events.length]),J([0,1]));
    s.eq('the late one counts today',day(TODAY).in,1000);
  }

  s.section('Needs attention: the couriers\' lines');
  {
    const rc=(id,date,net)=>Object.assign({},get('postex-JUL-1'),{id,no:id,ref:id,date,net});
    const na=(docs,x)=>M.maCourierConcerns(Object.assign({docs,today:TODAY,settings:S},x||{}));
    const one=na([rc('A','2026-10-09',1000)]);
    s.eq('one uncollected CPR: one line, naming it',one.length+':'+/CPR A/.test((one[0]||{}).sentence||''),'1:true');
    const two=na([rc('A','2026-10-09',1000),rc('B','2026-10-13',500)]);
    s.eq('two in one month: ONE line, with a count and a total',two.length+':'+/2 CPRs/.test((two[0]||{}).sentence||''),'1:true');
    s.eq('not old enough yet (3 days for PostEx): nothing',na([rc('C','2026-10-19',100)]).length,0);
    const cl={dt:'collection',status:'posted',no:'CL-1',amount:500,difference:-10,refs:{cprNos:['A']},covers:[{id:'A',net:1000}],attachments:[]};
    const rs=na([rc('A','2026-10-09',1000),cl]).map(x=>x.sentence).join(' | ');
    s.ok('a collection with no receipt, a difference, a statement that changed after — each said',/no receipt/.test(rs)&&/differs/.test(rs)&&!/changed after/.test(rs),rs);
    s.ok('… a statement that moved after it was collected is named',/changed after/.test(na([rc('A','2026-10-09',1100),cl]).map(x=>x.sentence).join(' ')));
    const twice=na([rc('A','2026-10-09',1000),cl,Object.assign({},cl,{no:'CL-2',id:'cl-2'})]);
    s.eq('collected twice: a concern',twice.filter(x=>x.state==='concern'&&/collected twice/.test(x.sentence)).length,1);
    s.ok('the rollup has not run',/not run yet/.test(na([],{run:null}).map(x=>x.sentence).join()));
    s.ok('the rollup failed: a concern',na([],{run:{state:'failed',error:'boom',at:1}}).some(x=>x.state==='concern'&&/failed: boom/.test(x.sentence)));
    s.ok('the rollup is stale: a concern',na([],{run:{state:'done',at:0},nowMs:40*3600000}).some(x=>/40 hours ago/.test(x.sentence)));
    s.ok('1120 against the parcels, when they differ: a concern',na([],{run:{state:'done',at:1,checks:{ledger1120:10,transit1120:12}},nowMs:2}).some(x=>/owes/.test(x.sentence)));
    s.ok('a refused ma_cpr read is said, never a zero',na([],{missing:['ma_cpr']}).some(x=>/ma_cpr could not be read/.test(x.sentence)));
    const pend={dt:'collection',status:'pending',courier:'bykea',holder:'1010',amount:1140,date:'2026-08-06',confirmBy:'raees',confirmPaper:true,no:'CL-3',id:'cl-3'};
    const all=M.maNeedsAttention({docs:[pend],today:TODAY,settings:S,idx:IDX,lines:[],closes:[],commitments:[]});
    s.ok('a collection waiting for Raees is on Needs attention',all.some(x=>/collected from Bykea/.test(x.sentence||'')),all.map(x=>x.sentence).join(' | '));
  }

  s.section('a worked example: every courier through the books');
  {
    const recv=DOCS;
    const cl1=mk('collection',{courier:'postex',holder:'1020',amount:2200,date:'2026-07-02',cprNos:['postex-JUN-1'],attachments:[ATT]},'afnan',{cprs:recv});
    const cl2=mk('collection',{courier:'postex',holder:'1011',amount:3440,date:'2026-07-08',cprNos:['postex-JUL-1','postex-JUL-2'],attachments:[ATT]},'afnan',{cprs:recv});
    const st1=mk('cpr',{courier:'tcs',date:'2026-07-31',attachments:[ATT],lines:[{date:'2026-07-10',parcels:2,cod:5000,fee:250,tax:40},{date:'2026-07-12',parcels:1,returned:true,fee:100,tax:16}]});
    const cl3=mk('collection',{courier:'tcs',holder:'1060',amount:4594,date:'2026-10-15',cprNos:[st1.id],attachments:[ATT]},'afnan',{cprs:[st1]});
    const st2=mk('cpr',{courier:'bykea',date:'2026-08-05',attachments:[ATT],lines:[{date:'2026-08-03',parcels:1,cod:1200,fee:60,tax:0}]});
    const cl4p=mk('collection',{courier:'bykea',holder:'1010',amount:1140,date:'2026-08-06',cprNos:[st2.id],attachments:[ATT]},'afnan',{cprs:[st2]});
    const cl4=Object.assign({},cl4p,M.maConfirmPatch(cl4p,'ammar',{at:1}).patch);
    const oj=mk('journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1123',side:'dr',amount:10000},{account:'1020',side:'dr',amount:100000}]});
    const cl5=mk('collection',{courier:'bluex',holder:'1020',amount:4000,date:'2026-08-10',attachments:[ATT]},'afnan',{cprs:[]});
    const docs=DOCS.concat([cl1,cl2,st1,cl3,st2,cl4,oj,cl5]);
    const L=M.maPostAll(docs,IDX,S);
    const want={'1020':106200,'1011':3440,'1060':4594,'1010':1140,'1120':3292,'1121':0,'1122':0,'1123':6000,'1124':0,
      '4010':9700,'5060':675,'5070':116,'9030':12,'3090':115769};
    const got={};Object.keys(want).forEach(k=>{got[k]=bal(L,k);});
    s.eq('every account as worked by hand',J(got),J(want));
    const tb=M.maTrialBalance(L,IDX);
    s.eq('the trial balance balances',tb.balanced,true);
    s.eq('… its balances: ₨1,25,469 debit, ₨1,25,469 credit',tb.debit+'/'+tb.credit,'125469/125469');
    s.eq('the pending Bykea collection posted nothing until it was confirmed',post(cl4p).length,0);
    s.eq('1120 still matches the parcels',M.maCourier1120Check(L,IDX,DER).diff,0);
    s.eq('titles say what each is',[DOCS[0],DOCS[2],DOCS[3],st1,cl2].map(d=>M.maDocTitle(d,IDX)).join(' | '),
      'PostEx · delivered Thu 2 Jul | PostEx · owed when the books started | PostEx CPR JUL-1 | TCS statement | Collection · PostEx');
    s.ok('a collection is found by the CPRs it covers',M.maDocText(cl2,IDX).indexOf('jul-1')>=0);
  }

  s.section('M2.4: before the courier pages exist — nothing courier-related shows on Today or the dashboard');
  {
    // js/master-accounts.js does not load ma_cpr, ma_collection or ma_runs
    // yet, and passes no `run`, `missing`, `inflows` or `couriers` — exactly
    // what _maAttention, _maCalendarOf and the loader hand over today. With the
    // books' own documents only (an opening, so that concern is not the one
    // raised), no courier line may appear anywhere a page reads.
    const open=mk('journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1011',side:'dr',amount:50000},{account:'3010',side:'cr',amount:50000}]});
    const docs=[open];
    const lines=M.maPostAll(docs,IDX,S);
    const rows=M.maHolderRows(IDX,lines,docs,{settings:S,mirrorBalances:{'1010':1000}});
    s.ok('the TCS account (1060) is not a holder row while the couriers are not loaded',!rows.some(r=>r.code==='1060'),J(rows.map(r=>r.code)));
    s.ok('…and the four M1 holders still are',['1010','1011','1012','1020'].every(c=>rows.some(r=>r.code===c)));
    s.ok('once the couriers are loaded (opts.couriers), it is listed',M.maHolderRows(IDX,lines,docs,{settings:S,couriers:true}).some(r=>r.code==='1060'));
    const tcsLines=lines.concat([{account:'1060',dr:500,cr:0,date:'2026-10-01',book:'groovy'}]);
    s.ok('…and with money through it, it is listed whatever the page loaded',M.maHolderRows(IDX,tcsLines,docs,{settings:S}).some(r=>r.code==='1060'));
    const cal=M.maCalendar({settings:S,today:TODAY,commitments:[],docs,start:M.maSpendable(rows).total,complete:true});
    s.ok('the 30 days carry no courier inflow',!cal.days.some(d=>d.events.some(e=>e.dir==='in')),J(cal.in));
    const na=M.maNeedsAttention({settings:S,today:TODAY,holders:rows,calendar:cal,commitments:[],docs,unlabelled:[],review:[],recon:0,nowMs:Date.parse(TODAY)});
    const courierWords=/courier|CPR|PostEx|TCS|Bykea|Blue-Ex|rollup|collection|ma_cpr|ma_runs/i;
    s.eq('Needs attention says nothing courier-related — no "rollup has not run", no stale rollup, no unread collections',na.filter(x=>courierWords.test(x.sentence)).map(x=>x.sentence).join(' | '),'');
    s.eq('maCourierConcerns alone, with no run passed, is empty',M.maCourierConcerns({settings:S,today:TODAY,docs}).length,0);
    s.ok('…while a page that passes `run: null` (the rollup never ran) does get the line',M.maCourierConcerns({settings:S,today:TODAY,docs,run:null}).some(x=>/has not run yet/.test(x.sentence)));
  }

  return s;
};

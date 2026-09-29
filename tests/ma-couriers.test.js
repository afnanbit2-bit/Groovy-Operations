/* ─────────────────────────────────────────────────────────────────────────
   js/ma-core.js — Master Accounts M2, the courier derivation (29 Sept 2026).

   What this holds: the couriers and the chart codes their money moves
   through (MA_COURIERS — every code one MA_CHART has, of the type its role
   needs); that the derivation reads only fields netlify/lib/postex-core.js
   writes; the document-id sanitizer (maIdSafe / maCprId: injective, never
   empty, never a forbidden id); what one parcel is worth and how it splits
   between its receipts (maCprSplit); maCprNet as THE definition every
   derived CPR is netted by; one CPR per receipt NUMBER — a parcel on an
   upfront and a reserve receipt gives both parts and is never counted
   twice, and a number can carry both kinds (`mixed`); the 1 July opening
   (parcels delivered in late June, receipts dated in July); the three
   transit buckets; the day rows; whole-rupee rounding; `sig` (stable in any
   order, moved by any figure); every data issue by its stable name; and
   empty input.

   The fixtures are parcels shaped exactly as postex-core writes them —
   `normalize` for every parcel, `enrichPayments` once PostEx has paid.

   It cannot hold what a real CPR PDF says (MASTER_ACCOUNTS_PLAN.md §24):
   every "net" here is the derivation's own definition, UNVERIFIED against
   PostEx's paper until one CPR PDF is compared.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {suite,ROOT}=require('./harness');
const M=require('../js/ma-core.js');

const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=v=>JSON.stringify(v);

/* A parcel as `normalize` writes it (every field it writes, PII-free). */
let seq=0;
function px(o){
  seq++;
  return Object.assign({trackingNumber:'PX'+String(seq).padStart(5,'0'),orderRefNumber:String(40000+seq),
    status:'Delivered',statusCategory:'delivered',dispatched:true,
    transactionDate:'2026-09-01T11:20:00',orderPickupDate:'2026-09-02T09:05:00',orderDeliveryDate:'2026-09-04T16:40:00',
    cityName:'Lahore',items:1,orderDetail:'GST073-M',
    cod:3000,transactionFee:180,transactionTax:28.8,reversalFee:0,reversalTax:0,
    upfrontPayment:0,upfrontPaymentDate:null,reservePayment:0,balancePayment:0,invoiceDivision:0,
    merchantName:'GROOVY',courier:'postex',syncedAt:1790000000000},o);
}
/* …and what `enrichPayments` merges onto it once PostEx's payment status
   has been read. Since M2.1 (cprUpdate) a field PostEx did not send is not
   written at all — never null, never blanked — and settle is written only as
   true, so a MISSING settle means not settled. The receipts, their dates and
   settle come in through `o`. */
function paid(o){
  return Object.assign(px({cprCheckedAt:1790100000000}),o);
}
const returned=o=>paid(Object.assign({status:'Returned',statusCategory:'returned',cod:2000,reversalFee:120,reversalTax:19.2},o));
const onRoad=o=>px(Object.assign({status:'En-Route',statusCategory:'in_transit',orderDeliveryDate:null},o));
const derive=(ps,from,today)=>M.maCprDerive(ps,{from:from||'2026-09-01',today:today||'2026-09-30'});
const cprOf=(r,no)=>r.cprs.find(c=>c.number===no)||null;
const rulesOf=r=>r.issues.map(i=>i.rule);
const issueOf=(r,rule)=>r.issues.find(i=>i.rule===rule)||null;
const issueOfAll=(r,rule)=>[].concat.apply([],r.issues.filter(i=>i.rule===rule).map(i=>i.refs.parcels));
const raised=new Set();              // every rule any fixture raised — checked against MA_CPR_ISSUE_RULES at the end
const seen=r=>{(r&&r.issues||[]).forEach(i=>raised.add(i.rule));return r;};

module.exports=function(){
  const s=suite('ma-couriers');

  s.section('the couriers and the accounts their money moves through (MA_COURIERS)');
  {
    const C=M.MA_COURIERS,IDX=M.maChartIndex(M.maChart('groovy',[]));
    s.eq('four couriers: PostEx, TCS, Blue-Ex, Bykea',Object.keys(C).join(','),'postex,tcs,bluex,bykea');
    s.eq('each has its cycle (§4.2, §8)',Object.keys(C).map(k=>C[k].cycle).join(','),'cpr,account,legacy,manual');
    s.ok('every cycle is one MA_COURIER_CYCLES names',Object.keys(C).every(k=>M.MA_COURIER_CYCLES.indexOf(C[k].cycle)>=0));
    s.ok('a courier key is letters only, and is its own `key` (so the first - of an id ends it)',Object.keys(C).every(k=>/^[a-z]+$/.test(k)&&C[k].key===k));
    const need={receivable:a=>a.type==='asset'&&a.control==='courier',statement:a=>a.type==='asset'&&a.control==='courier',
      wallet:a=>a.money===true&&a.holderKind==='wallet',collectInto:a=>a.money===true&&a.holderKind==='cash',
      revenue:a=>a.type==='revenue',fees:a=>a.type==='cogs',reversals:a=>a.type==='cogs',difference:a=>a.type==='suspense'};
    const bad=[];
    Object.keys(C).forEach(k=>Object.keys(C[k].accounts).forEach(role=>{
      const code=C[k].accounts[role],a=M.maAcc(IDX,code);
      if(!need[role])bad.push(k+'.'+role+' is not a known role');
      else if(!a)bad.push(k+'.'+role+' '+code+' is not in MA_CHART');
      else if(!need[role](a))bad.push(k+'.'+role+' '+code+' ('+a.name+') is the wrong kind of account');
    }));
    s.eq('every code is in MA_CHART, of the type its role needs — none invented',bad.join('; '),'');
    s.eq('each courier has its own receivable (1120 · 1122 · 1123 · 1124)',Object.keys(C).map(k=>C[k].accounts.receivable).join(','),'1120,1122,1123,1124');
    s.eq('PostEx: CPRs issued, not collected — 1121',C.postex.accounts.statement,'1121');
    s.eq('TCS: its account, the money that sits at TCS — 1060',C.tcs.accounts.wallet,'1060');
    s.eq('Bykea collects into the drawer, 1010 …',C.bykea.accounts.collectInto,'1010');
    s.eq('… so Raees confirms it — read from MA_HANDS, not a second field',M.maHandsOf(C.bykea.accounts.collectInto),'raees');
    s.ok('every courier books COD to 4010, fees to 5060, reversals to 5070, differences to 9030',
      Object.keys(C).every(k=>{const a=C[k].accounts;return a.revenue==='4010'&&a.fees==='5060'&&a.reversals==='5070'&&a.difference==='9030';}));
    s.eq('PostEx is fed from postex_orders',C.postex.feed,'postex_orders');
    s.ok('frozen, all the way down — a stray write cannot change a later derivation',
      Object.isFrozen(C)&&Object.keys(C).every(k=>Object.isFrozen(C[k])&&Object.isFrozen(C[k].accounts)));
  }

  s.section('the derivation reads only what netlify/lib/postex-core.js writes');
  {
    const core=read('netlify/lib/postex-core.js');
    const slice=(a,b)=>{const i=core.indexOf(a);return i<0?'':core.slice(i,core.indexOf(b,i));};
    const keys=t=>(t.match(/^\s*([A-Za-z_]\w*)\s*:/gm)||[]).map(x=>x.trim().replace(/\s*:$/,''));
    // enrichPayments writes through cprUpdate (M2.1): only what PostEx gave —
    // put("field", …) — settle only as true, and the stamp {cprCheckedAt,
    // cprRecheckedAt}. Read from the source, so a renamed field fails here.
    const upd=slice('function cprUpdate(','\n}\n'),stampLine=slice('c.recheck ?','\n');
    const enrich=(upd.match(/\b(?:put|putNumber)\("([A-Za-z_]\w*)"/g)||[]).map(x=>x.replace(/^\w+\("|"$/g,''))
      .concat((upd.match(/\bupd\.([A-Za-z_]\w*)\s*=/g)||[]).map(x=>x.replace(/^upd\.|\s*=$/g,'')))
      .concat((stampLine.match(/([A-Za-z_]\w*)\s*:\s*t\b/g)||[]).map(x=>x.replace(/\s*:.*$/,'')));
    s.eq('cprUpdate writes the receipts, their dates, settle, the two stamps and a conflict note',Array.from(new Set(enrich)).sort().join(','),
      'cpr1Date,cpr2Date,cprCheckedAt,cprConflict,cprNumber_1,cprNumber_2,cprRecheckedAt,settle,settlementDate');
    const written=new Set(keys(slice('function normalize(order)','\n}\n')).concat(enrich));
    s.ok('postex-core\'s normalize and enrichPayments were found and read',written.has('cod')&&written.has('cprNumber_2')&&written.size>=25,written.size);
    const src=read('js/ma-core.js');
    const sec=src.slice(src.indexOf('/* ── PostEx: parcels into CPRs'),src.indexOf('if(typeof module'));
    const fields=new Set((sec.match(/\bp\.([A-Za-z_]\w*)/g)||[]).map(x=>x.slice(2))
      .concat((sec.match(/'([a-z][A-Za-z0-9]*(?:_\d)?)'/g)||[]).map(x=>x.slice(1,-1)).filter(x=>/[A-Z]|_\d/.test(x))));
    const unknown=Array.from(fields).filter(f=>!written.has(f));
    s.ok('the PostEx section reads '+fields.size+' parcel fields …',fields.size>=18,Array.from(fields).sort().join(','));
    s.eq('… every one of them a field postex-core writes',unknown.join(','),'');
    const fx=Object.keys(Object.assign({},paid({}),returned({}),onRoad({}))).filter(k=>!written.has(k));
    s.eq('the fixtures here carry exactly postex-core\'s field names',fx.join(','),'');
    const lookback=/const LOOKBACK_DAYS\s*=\s*(\d+)/.exec(read('netlify/functions/postex-sync-background.js'));
    s.eq('MA_POSTEX_SYNC_DAYS is the sync\'s LOOKBACK_DAYS',M.MA_POSTEX_SYNC_DAYS,lookback?+lookback[1]:null);
  }

  s.section('the document id: maIdSafe / maCprId');
  {
    s.eq('a plain receipt number reads as itself',M.maCprId('postex','CPR-118842'),'postex-CPR-118842');
    s.eq('anything else is escaped, `_` + four hex digits',M.maCprId('postex','CPR 118/842'),'postex-CPR_0020118_002f842');
    const nos=['CPR-118842','CPR 118842','CPR/118842','CPR_118842','CPR118842','CPR.118842','cpr-118842','CPR-118842 ','CPR–118842'];
    const ids=nos.map(n=>M.maCprId('postex',n));
    s.eq('numbers that differ only in what a strip would remove get different ids',new Set(ids).size,nos.length);
    s.eq('`_` itself is escaped, so it only ever opens an escape',M.maIdSafe('a_b')+' '+M.maIdSafe('a/b'),'a_005fb a_002fb');
    s.eq('never empty: the empty text is a lone `_`',[M.maIdSafe(''),M.maIdSafe(null),M.maIdSafe(undefined)].join(','),'_,_,_');
    s.eq('no Firestore-reserved id can come out of it',[M.maIdSafe('.'),M.maIdSafe('..'),M.maIdSafe('__x__')].join(' '),'_002e _002e_002e _005f_005fx_005f_005f');
    s.eq('beyond ASCII, one escape per UTF-16 unit',M.maIdSafe('ü😀'),'_00fc_d83d_de00');
    // Injective, by proof: every output reads back to exactly one input.
    const decode=id=>id==='_'?'':id.replace(/_([0-9a-f]{4})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));
    let rnd=12345;const next=()=>{rnd=(rnd*1103515245+12345)%2147483648;return rnd;};
    const alpha='aZ09-_ ./ü–#%';
    const pool=[''];for(let i=0;i<3000;i++){let t='';const n=next()%7;for(let j=0;j<n;j++)t+=alpha[next()%alpha.length];pool.push(t);}
    const uniq=Array.from(new Set(pool));
    const outs=uniq.map(M.maIdSafe);
    s.ok('3,000 random texts: only [A-Za-z0-9_-] …',outs.every(o=>/^[A-Za-z0-9_-]+$/.test(o)));
    s.ok('… never a `__`, never empty',outs.every(o=>o&&o.indexOf('__')<0));
    s.eq('… and every id decodes back to its text, so no two texts share one',uniq.filter((t,i)=>decode(outs[i])!==t).length,0);
    s.eq('… '+uniq.length+' texts, '+uniq.length+' ids',new Set(outs).size,uniq.length);
    const r=derive([paid({cprNumber_1:'A 1',cpr1Date:'2026-09-05',upfrontPayment:100}),paid({cprNumber_1:'A/1',cpr1Date:'2026-09-05',upfrontPayment:200})]);
    s.eq('two receipts a strip would merge stay two CPRs, with two ids',r.cprs.map(c=>c.id).join(' '),'postex-A_00201 postex-A_002f1');
  }

  s.section('one parcel: what it is worth and how it splits (maCprSplit)');
  {
    const d=M.maCprSplit(px({cod:3000,transactionFee:180,transactionTax:28.8}));
    s.eq('delivered: its share is COD less the delivery fee and tax',d.share,2791.2);
    s.eq('no receipt yet and ₨0 on record: the whole share is expected on the upfront — never ₨0',J([d.upfront,d.reserve]),J([2791.2,0]));
    s.eq('… both parts computed, not PostEx\'s figures',J(d.basis),J({upfront:'computed',reserve:'computed'}));
    const r=M.maCprSplit(returned({reversalFee:120,reversalTax:19.2}));
    s.eq('returned: its share is minus the reversal fee and tax (the COD tab\'s charges)',r.share,-139.2);
    const b=M.maCprSplit(paid({cprNumber_1:'U',upfrontPayment:2000,cprNumber_2:'R',reservePayment:791.2}));
    s.eq('both paid: PostEx\'s own figures, whatever the share says',J([b.upfront,b.reserve,b.basis.upfront,b.basis.reserve]),J([2000,791.2,'field','field']));
    const w=M.maCprSplit(paid({cprNumber_1:'U',upfrontPayment:2000}));
    s.eq('upfront paid, reserve not yet: the reserve expected is the share less the upfront',w.reserve,791.2);
    const z=M.maCprSplit(paid({cprNumber_1:'U',upfrontPayment:0}));
    s.eq('on a receipt a 0 is what PostEx paid — it is kept, and the rest is expected on the reserve',J([z.upfront,z.reserve,z.basis.upfront]),J([0,2791.2,'field']));
    const planned=M.maCprSplit(paid({upfrontPayment:1500}));
    s.eq('before its receipt, a figure PostEx did send is its own',J([planned.upfront,planned.reserve,planned.basis.upfront]),J([1500,1291.2,'field']));
    const m=M.maCprSplit(paid({cprNumber_1:'U',upfrontPayment:null,cprNumber_2:'R',reservePayment:600}));
    s.eq('a paid part PostEx sent no figure for falls back to the share less the other part',J([m.upfront,m.basis.upfront]),J([2191.2,'computed']));
    const n=M.maCprSplit(paid({cprNumber_1:'U',upfrontPayment:null,cprNumber_2:'R',reservePayment:undefined}));
    s.eq('neither figure, both paid: the whole share on the first receipt — counted once',J([n.upfront,n.reserve]),J([2791.2,0]));
    const o=M.maCprSplit(returned({cprNumber_2:'R',reservePayment:null}));
    s.eq('neither figure, only the reserve paid: the whole share on the reserve',J([o.upfront,o.reserve]),J([0,-139.2]));
    s.eq('a string holding a number is read; anything else is not a figure',M.maCprSplit(paid({cprNumber_1:'U',upfrontPayment:'1999.5'})).upfront,1999.5);
    s.eq('in transit: worth nothing yet',M.maCprSplit(onRoad({})).share,0);
  }

  // Shared by the next sections: three parcels, one upfront receipt, one reserve receipt.
  const A1=paid({trackingNumber:'A1',cprNumber_1:'U100',cpr1Date:'2026-09-05',upfrontPayment:2000,cprNumber_2:'R200',cpr2Date:'2026-09-12',reservePayment:791.2,settle:true,settlementDate:'2026-09-12'});
  const A2=paid({trackingNumber:'A2',cod:1500,transactionFee:150,transactionTax:24,cprNumber_1:'U100',cpr1Date:'2026-09-05',upfrontPayment:1000});
  const A3=paid({trackingNumber:'A3',cod:2000,cprNumber_1:'U100',cpr1Date:'2026-09-05',upfrontPayment:1200,cprNumber_2:'R200',cpr2Date:'2026-09-12',reservePayment:591.2,settle:true,settlementDate:'2026-09-12'});
  const AS=[A1,A2,A3];

  s.section('a parcel on an upfront AND a reserve receipt: both parts, never counted twice');
  {
    const r=seen(derive(AS));
    const u=cprOf(r,'U100'),v=cprOf(r,'R200');
    s.eq('one CPR per receipt NUMBER',r.cprs.map(c=>c.number).join(','),'U100,R200');
    s.eq('U100 is the upfront of A1, A2 and A3',J([u.kind,u.parts.upfront.parcels,u.parts.upfront.amount,u.parts.reserve.parcels]),J(['upfront',['A1','A2','A3'],4200,[]]));
    s.eq('R200 is the reserve of A1 and A3 — rounded once: 791.2 + 591.2 = 1,382',J([v.kind,v.parts.reserve.parcels,v.parts.reserve.amount]),J(['reserve',['A1','A3'],1382]));
    s.eq('the money across receipts is each part once: 4,200 + 1,382',r.cprs.reduce((t,c)=>t+c.net,0),5582);
    s.eq('the day counts each parcel once — 3 delivered, ₨6,500 of COD',J([r.days.length,r.days[0].delivered,r.days[0].grossCod]),J([1,3,6500]));
    s.eq('… while each receipt DESCRIBES the parcels it pays (A1 and A3 on both)',u.grossCod+v.grossCod,11500);
    s.eq('A1 and A3 are in no transit bucket; A2 waits for its reserve (1,326 − 1,000)',J([r.transit.awaitingUpfront.parcels,r.transit.awaitingReserve.parcels,r.transit.awaitingReserve.amount]),J([0,1,326]));
    s.eq('settled only when every parcel on it is',J([u.settled,v.settled]),J([false,true]));
    s.eq('the id is postex-<number>',J([u.id,u.courier]),J(['postex-U100','postex']));
    s.eq('the receipt\'s date is its parcels\' cpr1Date / cpr2Date',J([u.date,v.date]),J(['2026-09-05','2026-09-12']));
    s.eq('the descriptive figures: fees and tax of its delivered parcels',J([u.deliveryFee,u.deliveryTax,u.delivered,u.returned]),J([510,82,3,0]));
    s.ok('no issue on clean data',r.issues.length===0,r.issues.length?J(r.issues):undefined);
  }

  s.section('one receipt number carrying upfront parts for some parcels and reserve parts for others');
  {
    const B1=paid({trackingNumber:'B1',cod:1000,transactionFee:100,transactionTax:16,cprNumber_1:'M300',cpr1Date:'2026-09-15',upfrontPayment:600});
    const B2=paid({trackingNumber:'B2',cod:1200,transactionFee:100,transactionTax:16,cprNumber_1:'U101',cpr1Date:'2026-09-08',upfrontPayment:800,cprNumber_2:'M300',cpr2Date:'2026-09-15',reservePayment:284});
    const B3=paid({trackingNumber:'B3',cod:900,transactionFee:100,transactionTax:16,cprNumber_1:'M300',cpr1Date:'2026-09-15',upfrontPayment:500,cprNumber_2:'M300',cpr2Date:'2026-09-15',reservePayment:284});
    const r=seen(derive([B1,B2,B3]));
    const m=cprOf(r,'M300');
    s.eq('M300 is mixed',m.kind,'mixed');
    s.eq('its upfront side: B1 and B3',J([m.parts.upfront.parcels,m.parts.upfront.amount]),J([['B1','B3'],1100]));
    s.eq('its reserve side: B2 and B3',J([m.parts.reserve.parcels,m.parts.reserve.amount]),J([['B2','B3'],568]));
    s.eq('net = both sides (1,100 + 568)',m.net,1668);
    s.eq('B3, on both sides of one receipt, is ONE of its parcels — 3 delivered, ₨3,100 of COD',J([m.delivered,m.grossCod]),J([3,3100]));
    s.eq('B2\'s upfront is its own receipt',J([cprOf(r,'U101').kind,cprOf(r,'U101').net]),J(['upfront',800]));
    s.eq('B1 waits for its reserve: 884 − 600',r.transit.awaitingReserve.amount,284);
  }

  s.section('maCprNet is THE definition: every derived CPR is its answer');
  {
    const B=[paid({trackingNumber:'N1',cprNumber_1:'X1',cpr1Date:'2026-09-05',upfrontPayment:1234.4}),
      paid({trackingNumber:'N2',cprNumber_1:'X1',cpr1Date:'2026-09-05',upfrontPayment:null}),
      returned({trackingNumber:'N3',cprNumber_2:'X1',cpr2Date:'2026-09-05',reservePayment:-139.2})];
    const all=AS.concat(B);
    const r=seen(derive(all));
    const off=r.cprs.filter(c=>{const n=M.maCprNet({number:c.number,parcels:all});return n.net!==c.net||J(n.parts)!==J(c.parts);});
    s.eq('for every receipt, maCprNet over ALL the parcels gives the same parts and net',off.map(c=>c.number).join(','),'');
    s.eq('X1: its upfront side 1,234.4 + N2\'s computed 2,791.2 → 4,026, its reserve side −139.2 → −139',J([cprOf(r,'X1').kind,cprOf(r,'X1').parts.upfront.amount,cprOf(r,'X1').parts.reserve.amount,cprOf(r,'X1').net]),J(['mixed',4026,-139,3887]));
    s.eq('maCprNet picks a receipt\'s parcels out of all of them by number',M.maCprNet({number:'R200',parcels:all}).parts.reserve.parcels.join(','),'A1,A3');
    s.eq('a number with nothing on it is worth nothing',J(M.maCprNet({number:'NOPE',parcels:all}).parts),J({upfront:{parcels:[],amount:0},reserve:{parcels:[],amount:0}}));
    s.eq('duplicates handed to maCprNet are counted once',M.maCprNet({number:'U100',parcels:AS.concat([Object.assign({},A2)])}).net,4200);
  }

  s.section('the 1 July 2026 opening: parcels delivered in late June, receipts dated in July');
  {
    // The books start on 1 July 2026 (from '2026-07-01'); today is 20 July.
    const june=(day,o)=>paid(Object.assign({transactionDate:'2026-06-'+String(day-3).padStart(2,'0')+'T10:00:00',orderPickupDate:'2026-06-'+String(day-2).padStart(2,'0')+'T10:00:00',orderDeliveryDate:'2026-06-'+String(day).padStart(2,'0')+'T15:00:00'},o));
    const A=june(20,{trackingNumber:'JA',cprNumber_1:'JUN-1',cpr1Date:'2026-06-26',upfrontPayment:2200,cprNumber_2:'JUL-2',cpr2Date:'2026-07-07',reservePayment:591.2,settle:true,settlementDate:'2026-07-07'});
    const B=june(29,{trackingNumber:'JB',cod:1500,transactionFee:150,transactionTax:24});
    const C=june(27,{trackingNumber:'JC',cod:2000,cprNumber_1:'JUL-1',cpr1Date:'2026-07-03',upfrontPayment:1400});
    const D=returned({trackingNumber:'JD',transactionDate:'2026-06-22T10:00:00',orderPickupDate:'2026-06-23T10:00:00',orderDeliveryDate:'2026-06-28T12:00:00',cprNumber_2:'JUL-2',cpr2Date:'2026-07-07',reservePayment:-139.2,settle:true,settlementDate:'2026-07-07'});
    const E=paid({trackingNumber:'JE',cod:2500,transactionDate:'2026-06-28T10:00:00',orderPickupDate:'2026-06-29T10:00:00',orderDeliveryDate:'2026-07-02T15:00:00',cprNumber_1:'JUL-1',cpr1Date:'2026-07-03',upfrontPayment:1600});
    const F=onRoad({trackingNumber:'JF',cod:1800,transactionDate:'2026-07-15T10:00:00',orderPickupDate:'2026-07-16T10:00:00'});
    const G=paid({trackingNumber:'JG',cod:1000,transactionFee:100,transactionTax:16,transactionDate:'2026-07-07T10:00:00',orderPickupDate:'2026-07-08T10:00:00',orderDeliveryDate:'2026-07-10T15:00:00'});
    const ALL=[A,B,C,D,E,F,G];
    const r=seen(derive(ALL,'2026-07-01','2026-07-20'));
    s.eq('the June receipt is left out of the books …',r.cprs.map(c=>c.number).join(','),'JUL-1,JUL-2');
    s.eq('… and summarised: 1 receipt, 1 parcel, ₨2,200, 26 June',J(r.excluded),J({receipts:1,parcels:1,net:2200,first:'2026-06-26',last:'2026-06-26',numbers:['JUN-1'],
      list:[{id:'postex-JUN-1',number:'JUN-1',date:'2026-06-26',net:2200,kind:'upfront',parts:{upfront:{parcels:['JA'],amount:2200},reserve:{parcels:[],amount:0}}}]}));
    s.eq('the opening is as the books start, the morning of 1 July',r.opening.asOf,'2026-07-01');
    s.eq('JE, picked up 29 June and delivered 2 July, was on the road — not owed: its income falls inside the books',J(r.opening.onRoad),J({parcels:1,cod:2500}));
    s.eq('no upfront receipt by 1 July: JB (1,326), JC (its July upfront, 1,400) and the return JD (0) — with 391.2 − 139.2 of reserve to follow',
      J(r.opening.awaitingUpfront),J({parcels:3,returned:1,amount:2726,reserveAfter:252}));
    s.eq('upfront paid in June, reserve in July: JA\'s 591.2',J(r.opening.awaitingReserve),J({parcels:1,returned:0,amount:591}));
    s.eq('PostEx owed ₨3,569 on 1 July — the PostEx part of the opening balance',r.opening.owed,3569);
    // Every June parcel's worth is either paid on a June receipt or owed at the opening.
    const worth=[A,B,C,D].reduce((t,p)=>{const x=M.maCprSplit(p);return t+x.upfront+x.reserve;},0);
    s.eq('… which is everything the June parcels are worth (5,769.2) less what June receipts paid (2,200), to the rupee',Math.round(worth-r.excluded.net),r.opening.owed);
    s.eq('JUL-2 settles JA\'s reserve and charges JD\'s return: 591.2 − 139.2',J([cprOf(r,'JUL-2').net,cprOf(r,'JUL-2').delivered,cprOf(r,'JUL-2').returned,cprOf(r,'JUL-2').reversalFee]),J([452,1,1,120]));
    s.eq('the days start on 1 July: JE on the 2nd, JG on the 10th',r.days.map(d=>d.day+':'+d.delivered+':'+d.grossCod).join(' '),'2026-07-02:1:2500 2026-07-10:1:1000');
    s.eq('today: JF on the road',J(r.transit.onRoad),J({parcels:1,cod:1800}));
    s.eq('today: JB and JG have no upfront receipt — JD, a return settled on its one receipt, waits for nothing (M2.1)',J(r.transit.awaitingUpfront),J({parcels:2,returned:0,amount:2210,reserveAfter:0}));
    s.eq('today: JC and JE wait for their reserves (391.2 + 691.2)',J(r.transit.awaitingReserve),J({parcels:2,returned:0,amount:1082}));
    s.eq('owed today: 2,210 + 1,082',r.transit.owed,3292);
    s.eq('no issue: a return charged on one receipt (JD) is not "a reserve with no upfront" — M2.1 finishes a return on one receipt',rulesOf(r).join(','),'');
  }

  s.section('what PostEx still owes, as the parcels stand today (transit)');
  {
    const T=[
      onRoad({trackingNumber:'T1',cod:2500,transactionDate:'2026-09-25T10:00:00',orderPickupDate:'2026-09-26T10:00:00'}),
      onRoad({trackingNumber:'T2',cod:1800,transactionDate:'2026-09-10T10:00:00',orderPickupDate:'2026-09-11T10:00:00'}),
      paid({trackingNumber:'T3'}),
      paid({trackingNumber:'T4',cod:2000,transactionFee:150,transactionTax:24,upfrontPayment:1500}),
      paid({trackingNumber:'T5',cod:2500,cprNumber_1:'U7',cpr1Date:'2026-09-20',upfrontPayment:2000}),
      px({trackingNumber:'T6',status:'Unbooked',statusCategory:'pending',dispatched:false,orderPickupDate:null,orderDeliveryDate:null}),
      px({trackingNumber:'T7',status:'Cancelled',statusCategory:'cancelled',dispatched:false,orderDeliveryDate:null}),
      returned({trackingNumber:'T8',orderDeliveryDate:'2026-09-20T12:00:00'})];
    const r=seen(derive(T));
    s.eq('as of today',r.transit.asOf,'2026-09-30');
    s.eq('on the road: dispatched, not delivered or returned — count and COD',J(r.transit.onRoad),J({parcels:2,cod:4300}));
    s.eq('delivered or returned, no upfront receipt: T3 (its share), T4 (PostEx\'s own 1,500), T8 (−139.2)',
      J(r.transit.awaitingUpfront),J({parcels:3,returned:1,amount:4152,reserveAfter:326}));
    s.eq('upfront received, reserve not: T5 (2,291.2 − 2,000)',J(r.transit.awaitingReserve),J({parcels:1,returned:0,amount:291}));
    s.eq('owed: the three amounts',r.transit.owed,4769);
    s.ok('booked, not picked up, and cancelled parcels are in no bucket',r.transit.onRoad.parcels===2&&r.transit.awaitingUpfront.parcels+r.transit.awaitingReserve.parcels===4);
  }

  s.section('the days: every delivered or returned parcel once, on the day it ended');
  {
    const r=seen(derive([
      paid({trackingNumber:'D1',orderDeliveryDate:'2026-09-03T10:00:00'}),
      paid({trackingNumber:'D2',cod:1500,transactionFee:150,transactionTax:24,orderDeliveryDate:'2026-09-03T18:00:00'}),
      returned({trackingNumber:'D3',orderDeliveryDate:'2026-09-03T12:00:00'}),
      paid({trackingNumber:'D4',orderDeliveryDate:'2026-08-31T10:00:00'}),
      paid({trackingNumber:'D5',orderDeliveryDate:'2026-09-30T23:00:00'}),
      onRoad({trackingNumber:'D6',transactionDate:'2026-09-28T10:00:00',orderPickupDate:'2026-09-29T10:00:00'})]));
    s.eq('one row per day a parcel ended on, in order, from `from` to `today`',r.days.map(d=>d.day).join(','),'2026-09-03,2026-09-30');
    s.eq('a row counts what was delivered and returned that day, the COD, fee and tax, and the reversal fee and tax',
      J(r.days[0]),J({day:'2026-09-03',delivered:2,grossCod:4500,deliveryFee:330,deliveryTax:53,returned:1,reversalFee:120,reversalTax:19}));
    s.ok('a parcel that ended before the books start is in no row (it is the opening\'s)',!r.days.some(d=>d.day<'2026-09-01'));
    s.eq('a return\'s COD is not income: it is in no row\'s COD',r.days[0].grossCod,3000+1500);
  }

  s.section('the PostEx receivable clears: days less charges equal the receipts\' nets');
  {
    // Whole-rupee figures, so a per-day round and a per-receipt round cannot
    // differ; every receipt is in, and PostEx's own part figures (where sent)
    // add up to the share. A figure PostEx did not send is null here: on a
    // receipt a 0 is what PostEx paid (the header), so it cannot stand for one.
    const Z=[
      paid({trackingNumber:'Z1',cod:3000,transactionFee:180,transactionTax:29,orderDeliveryDate:'2026-09-03T12:00:00',
        cprNumber_1:'ZU-1',cpr1Date:'2026-09-05',upfrontPayment:2000,cprNumber_2:'ZR-1',cpr2Date:'2026-09-12',reservePayment:791,settle:true}),
      paid({trackingNumber:'Z2',cod:1500,transactionFee:150,transactionTax:24,orderDeliveryDate:'2026-09-03T15:00:00',
        cprNumber_1:'ZU-1',cpr1Date:'2026-09-05',upfrontPayment:1000,cprNumber_2:'ZR-1',cpr2Date:'2026-09-12',reservePayment:null}),   // reserve computed: 326
      paid({trackingNumber:'Z3',cod:2200,transactionFee:160,transactionTax:26,orderDeliveryDate:'2026-09-06T11:00:00',
        cprNumber_1:'ZU-2',cpr1Date:'2026-09-08',cprNumber_2:'ZR-2',cpr2Date:'2026-09-15',upfrontPayment:null,reservePayment:null}),   // neither sent: whole share upfront
      returned({trackingNumber:'Z4',orderDeliveryDate:'2026-09-06T17:00:00',reversalFee:120,reversalTax:19,          // forward fee 180 + 28.8 stays out
        cprNumber_1:'ZU-2',cpr1Date:'2026-09-08',upfrontPayment:-139,settle:true})];                             // a return on ONE receipt
    const r=seen(derive(Z,'2026-09-01','2026-09-30'));
    const dayNet=r.days.reduce((t,d)=>t+d.grossCod-d.deliveryFee-d.deliveryTax-d.reversalFee-d.reversalTax,0);
    const cprNet=r.cprs.reduce((t,c)=>t+c.net,0);
    s.eq('every receipt is in, and nothing is owed',J([r.cprs.map(c=>c.number).join(','),r.transit.owed]),J(['ZU-1,ZU-2,ZR-1,ZR-2',0]));
    s.eq('Σ days (COD − charges) − Σ receipts\' nets = 0',dayNet-cprNet,0);
    s.eq('… both sides are ₨5,992: 2,791 + 1,326 + 2,014 − 139',J([dayNet,cprNet]),J([5992,5992]));
    const other=x=>rulesOf(x).filter(k=>k!=='cpr.field_missing');
    s.eq('no issue but cpr.field_missing, which names the computed parts (Z2, Z3)',J([other(r),Array.from(new Set(issueOfAll(r,'cpr.field_missing'))).sort()]),J([[],['Z2','Z3']]));
    const d6=r.days.find(d=>d.day==='2026-09-06');
    s.eq('a return is charged its reversal fee and tax on its day — its forward fee is NOT in the day\'s delivery fee',
      J([d6.deliveryFee,d6.deliveryTax,d6.reversalFee,d6.reversalTax]),J([160,26,120,19]));
    s.eq('… exactly what its share deducts',M.maCprSplit(Z[3]).share,-139);
    // PostEx's own figures disagree with the share: named, never absorbed.
    const Zb=Z.map(p=>p.trackingNumber==='Z1'?Object.assign({},p,{reservePayment:841}):p);
    const rb=seen(derive(Zb,'2026-09-01','2026-09-30'));
    const cprNetB=rb.cprs.reduce((t,c)=>t+c.net,0),dayNetB=rb.days.reduce((t,d)=>t+d.grossCod-d.deliveryFee-d.deliveryTax-d.reversalFee-d.reversalTax,0);
    s.eq('when PostEx\'s parts overshoot the share by ₨50, the receipts count PostEx\'s figures …',cprNetB-cprNet,50);
    s.eq('… the days do not move, so the receivable is left ₨50 short of clearing …',dayNetB-cprNetB,-50);
    const mm=issueOf(rb,'cpr.split_mismatch');
    s.ok('… and the difference is an issue, never silent: cpr.split_mismatch names Z1, both receipts and +₨50',
      !!mm&&J(mm.refs)===J({receipts:['ZR-1','ZU-1'],parcels:['Z1']})&&mm.message.indexOf('+₨50')>=0,mm&&mm.message);
    s.eq('only one PostEx figure sent: the other is computed from the share, so it always clears (Z2)',M.maCprSplit(Z[1]).upfront+M.maCprSplit(Z[1]).reserve,M.maCprSplit(Z[1]).share);
    const rc=derive(Z.map(p=>p.trackingNumber==='Z1'?Object.assign({},p,{reservePayment:741}):p),'2026-09-01','2026-09-30');
    s.eq('an undershoot is named the same way (−₨50)',J([other(rc).join(','),(issueOf(rc,'cpr.split_mismatch')||{message:''}).message.indexOf('−₨50')>=0]),J(['cpr.split_mismatch',true]));
  }

  s.section('M2.1: a missing settle is not settled; a return may take one receipt');
  {
    const a=paid({trackingNumber:'S1',cprNumber_1:'SS-1',cpr1Date:'2026-09-05',cprNumber_2:'SS-2',cpr2Date:'2026-09-12'});
    s.ok('the fixture carries no settle field at all, as cprUpdate writes it',!('settle' in a));
    s.eq('a missing settle reads as not settled',derive([a]).cprs.map(c=>c.settled).join(','),'false,false');
    s.eq('an old record\'s settle:false reads the same',derive([Object.assign({},a,{settle:false})]).cprs.map(c=>c.settled).join(','),'false,false');
    s.eq('settle:true is settled',derive([Object.assign({},a,{settle:true})]).cprs.map(c=>c.settled).join(','),'true,true');
    s.ok('cprRecheckedAt on a record changes nothing the derivation says',
      J(derive([a]))===J(derive([Object.assign({},a,{cprRecheckedAt:1790200000000})])));
    const ret1=returned({trackingNumber:'S2',cprNumber_1:'SS-3',cpr1Date:'2026-09-05',upfrontPayment:-139.2,settle:true});
    const r=derive([ret1]);
    s.eq('a return settled on its one (upfront) receipt: owed nothing, waiting for nothing',J([r.transit.awaitingUpfront.parcels,r.transit.awaitingReserve.parcels,r.transit.owed]),J([0,0,0]));
    s.eq('… its whole charge is on that receipt',cprOf(r,'SS-3').net,-139);
    const ret2=returned({trackingNumber:'S3',cprNumber_1:'SS-4',cpr1Date:'2026-09-05',upfrontPayment:null});
    s.eq('… the same before PostEx marks it settled — its whole share is on the receipt it is on',derive([ret2]).transit.awaitingReserve.parcels,0);
    const del=paid({trackingNumber:'S4',cprNumber_1:'SS-5',cpr1Date:'2026-09-05',upfrontPayment:2000,settle:true});
    const rd=derive([del]);
    s.eq('a DELIVERED parcel marked settled while its reserve (791.2) never came stays owed — a settle excuses no amount',
      J([rd.transit.awaitingReserve.parcels,rd.transit.awaitingReserve.amount]),J([1,791]));
  }

  s.section('excluded receipts, one by one: a receipt dated just before the books start');
  {
    // 30 June 2026 was a Tuesday — a CPR day — and the books start on 1 July.
    s.eq('30 June 2026 is a Tuesday',M.maWeekday('2026-06-30'),2);
    const E1=paid({trackingNumber:'EX1',transactionDate:'2026-06-24T10:00:00',orderPickupDate:'2026-06-25T10:00:00',orderDeliveryDate:'2026-06-27T12:00:00',
      cprNumber_1:'CPR-0630',cpr1Date:'2026-06-30',upfrontPayment:2000,cprNumber_2:'CPR-0707',cpr2Date:'2026-07-07',reservePayment:791.2});
    const E2=paid({trackingNumber:'EX2',cod:1500,transactionFee:150,transactionTax:24,transactionDate:'2026-06-20T10:00:00',orderPickupDate:'2026-06-21T10:00:00',orderDeliveryDate:'2026-06-23T12:00:00',
      cprNumber_1:'JUN-26A',cpr1Date:'2026-06-26',cprNumber_2:'CPR-0630',cpr2Date:'2026-06-30',upfrontPayment:null,reservePayment:null});
    const r=seen(derive([E1,E2],'2026-07-01','2026-07-20'));
    s.eq('both June receipts are left out of the books',r.cprs.map(c=>c.number).join(','),'CPR-0707');
    s.eq('the summary is kept: 2 receipts, 2 parcels, first and last day',J([r.excluded.receipts,r.excluded.parcels,r.excluded.first,r.excluded.last,r.excluded.numbers]),
      J([2,2,'2026-06-26','2026-06-30',['CPR-0630','JUN-26A']]));
    s.eq('… and each one is listed on its own, by DATE (not number): JUN-26A then CPR-0630',r.excluded.list.map(c=>c.number).join(','),'JUN-26A,CPR-0630');
    s.eq('… each as {id, number, date, net, kind, parts}',
      J(r.excluded.list.map(c=>Object.keys(c).join(','))),J(['id,number,date,net,kind,parts','id,number,date,net,kind,parts']));
    const t=r.excluded.list[1]||{};
    s.eq('the 30 June receipt can be collected: its id, date, net and kind',J([t.id,t.date,t.net,t.kind]),J(['postex-CPR-0630','2026-06-30',2000,'mixed']));
    s.eq('… with its parts: EX1\'s upfront, and EX2\'s reserve (₨0 — its share went on JUN-26A)',J(t.parts),
      J({upfront:{parcels:['EX1'],amount:2000},reserve:{parcels:['EX2'],amount:0}}));
    s.eq('the list adds up to the summary net',r.excluded.list.reduce((a,c)=>a+c.net,0),r.excluded.net);
    s.eq('each listed receipt is exactly maCprNet over the parcels',
      (r.excluded.list||[]).map(c=>M.maCprNet({number:c.number,parcels:[E1,E2]}).net===c.net).join(','),'true,true');
    const E3=returned({trackingNumber:'EX3',transactionDate:'2026-06-20T10:00:00',orderPickupDate:'2026-06-21T10:00:00',orderDeliveryDate:'2026-06-25T12:00:00',
      cprNumber_1:'CPR-0630',cpr1Date:'2026-06-30',upfrontPayment:-139.2});
    const o3=derive([E3],'2026-07-01','2026-07-20').opening;
    s.eq('a return charged on its one receipt before the books start is owed nothing, and waits for nothing, at the opening',
      J([o3.awaitingUpfront.parcels,o3.awaitingReserve.parcels,o3.owed]),J([0,0,0]));
  }

  s.section('whole rupees, rounded the way M1 rounds (Math.round, once)');
  {
    const r=seen(derive([
      paid({trackingNumber:'W1',cprNumber_1:'RND-1',cpr1Date:'2026-09-05',upfrontPayment:100.25}),
      paid({trackingNumber:'W2',cprNumber_1:'RND-1',cpr1Date:'2026-09-05',upfrontPayment:100.25}),
      paid({trackingNumber:'W3',cprNumber_1:'RND-2',cpr1Date:'2026-09-05',upfrontPayment:100.4}),
      paid({trackingNumber:'W4',cprNumber_1:'RND-2',cpr1Date:'2026-09-05',upfrontPayment:100.4}),
      paid({trackingNumber:'W5',cprNumber_1:'RND-2',cpr1Date:'2026-09-05',upfrontPayment:100.4}),
      returned({trackingNumber:'W6',cprNumber_2:'RND-3',cpr2Date:'2026-09-05',reservePayment:-12.5}),
      returned({trackingNumber:'W7',cprNumber_2:'RND-4',cpr2Date:'2026-09-05',reservePayment:-0.4})]));
    s.eq('a half rupee rounds up: 100.25 + 100.25 = 201',cprOf(r,'RND-1').net,201);
    s.eq('summed to the paisa, then rounded once: 3 × 100.4 = 301 (rounding each would give 300)',cprOf(r,'RND-2').net,301);
    s.eq('a negative half rounds as Math.round does: −12.5 → −12',cprOf(r,'RND-3').net,-12);
    s.ok('never −0: −0.4 is 0',Object.is(cprOf(r,'RND-4').net,0)&&Object.is(cprOf(r,'RND-4').parts.reserve.amount,0));
    s.ok('every figure is a whole number',r.cprs.every(c=>[c.net,c.parts.upfront.amount,c.parts.reserve.amount,c.grossCod,c.deliveryFee,c.deliveryTax,c.reversalFee,c.reversalTax].every(Number.isInteger)));
  }

  s.section('sig: the same in any order, moved by any figure');
  {
    const base=AS.concat([paid({trackingNumber:'S1',cprNumber_1:'U100',cpr1Date:'2026-09-05',upfrontPayment:333.3})]);
    const a=derive(base),b=derive(base.slice().reverse()),c=derive(base.slice(2).concat(base.slice(0,2)));
    s.eq('the whole answer is the same whatever order the parcels come in',J(a)===J(b)&&J(a)===J(c),true);
    const sig=(r,no)=>cprOf(r,no).sig;
    s.ok('a sig is a string',typeof sig(a,'U100')==='string'&&sig(a,'U100').length>20);
    const moved=derive(base.map(p=>p.trackingNumber==='A3'?Object.assign({},p,{reservePayment:592.2}):p));
    s.ok('a changed figure changes its receipt\'s sig …',sig(moved,'R200')!==sig(a,'R200'));
    s.eq('… and no other receipt\'s',sig(moved,'U100'),sig(a,'U100'));
    s.ok('settled changes it',sig(derive(base.map(p=>p.trackingNumber==='A1'?Object.assign({},p,{settle:false}):p)),'R200')!==sig(a,'R200'));
    s.ok('a date changes it',sig(derive(base.map(p=>p.trackingNumber==='A1'?Object.assign({},p,{cpr2Date:'2026-09-13'}):p).map(p=>p.trackingNumber==='A3'?Object.assign({},p,{cpr2Date:'2026-09-13'}):p)),'R200')!==sig(a,'R200'));
    const swapped=derive(base.map(p=>p.trackingNumber==='S1'?Object.assign({},p,{trackingNumber:'S9'}):p));
    s.ok('a parcel swapped for another with the very same figures still changes it',sig(swapped,'U100')!==sig(a,'U100')&&cprOf(swapped,'U100').net===cprOf(a,'U100').net);
  }

  s.section('every data issue, by its stable name');
  {
    const I=(ps,rule,from,today)=>{const r=seen(derive(ps,from,today));return {r,i:issueOf(r,rule)};};
    // derive.opts
    ['2026-07-32',undefined].forEach(f=>{const r=seen(M.maCprDerive([paid({})],{from:f,today:'2026-09-30'}));
      s.eq('from '+J(f)+' is not a real day: one issue, nothing derived',J([rulesOf(r),r.cprs.length,r.days.length]),J([['derive.opts'],0,0]));});
    s.eq('from after today: refused the same way',rulesOf(seen(M.maCprDerive([],{from:'2026-10-01',today:'2026-09-30'}))).join(),'derive.opts');
    s.eq('no opts at all: refused, never read from a clock',rulesOf(seen(M.maCprDerive([paid({})]))).join(),'derive.opts');
    // parcel.no_tracking
    {const x=I([paid({trackingNumber:null}),paid({trackingNumber:'   '}),'junk',null,paid({trackingNumber:'OK1'})],'parcel.no_tracking');
     s.ok('parcel.no_tracking: 4 records that cannot be told apart',!!x.i&&/^4 records/.test(x.i.message),x.i&&x.i.message);
     s.eq('… are in no figure',x.r.days.reduce((t,d)=>t+d.delivered,0),1);}
    // parcel.duplicate
    // The copy checked most recently (X) is the one a content tie-break would
    // NOT pick ('U-A' sorts below 'U-B'), so only cprCheckedAt can choose it.
    {const X=paid({trackingNumber:'DUP-1',cprNumber_1:'U-A',cpr1Date:'2026-09-05',upfrontPayment:1000,cprCheckedAt:200});
     const Y=paid({trackingNumber:'DUP-1',cprNumber_1:'U-B',cpr1Date:'2026-09-06',upfrontPayment:1000,cprCheckedAt:100});
     const a=I([X,Y],'parcel.duplicate'),b=I([Y,X],'parcel.duplicate');
     s.ok('parcel.duplicate: named, with the receipts both copies name',!!a.i&&J(a.i.refs)===J({receipts:['U-A','U-B'],parcels:['DUP-1']}),a.i&&J(a.i.refs));
     s.ok('… and says the copies disagree',!!a.i&&/different receipts/.test(a.i.message));
     s.eq('the copy checked most recently is the one counted, in either order',a.r.cprs.map(c=>c.number).join()+'|'+b.r.cprs.map(c=>c.number).join(),'U-A|U-A');
     s.eq('… once',(a.r.days[0]||{}).delivered,1);
     const P=paid({trackingNumber:'DUP-2',cprNumber_1:'U-C',cpr1Date:'2026-09-05',upfrontPayment:10,cprCheckedAt:5,syncedAt:1});
     const Q=Object.assign({},P,{cprNumber_1:'U-D',syncedAt:2});
     s.eq('a tie on cprCheckedAt goes to the later sync',derive([P,Q]).cprs.map(c=>c.number).join()+'|'+derive([Q,P]).cprs.map(c=>c.number).join(),'U-D|U-D');
     const R=Object.assign({},P,{cprNumber_1:'U-E',syncedAt:1});
     s.eq('a full tie is broken by content, never by order',derive([P,R]).cprs.map(c=>c.number).join(),derive([R,P]).cprs.map(c=>c.number).join());}
    // parcel.status_unknown
    {const x=I([paid({trackingNumber:'SU1',statusCategory:'lost'})],'parcel.status_unknown');
     s.ok('parcel.status_unknown: a status the sync never writes is named …',!!x.i&&x.i.refs.parcels.join()==='SU1'&&/lost/.test(x.i.message));
     s.eq('… and counts as neither delivered nor returned',x.r.days.length+x.r.transit.awaitingUpfront.parcels,0);}
    // parcel.date_fallback
    {const x=I([paid({trackingNumber:'FB1',orderDeliveryDate:null,orderPickupDate:'2026-09-10T10:00:00'}),
       returned({trackingNumber:'FB2',orderDeliveryDate:null,cprNumber_2:'RR-1',cpr2Date:'2026-09-18',reservePayment:-139.2})],'parcel.date_fallback');
     const all=x.r.issues.filter(i=>i.rule==='parcel.date_fallback');
     s.eq('parcel.date_fallback: a delivered parcel with no delivery date is dated by its pickup, and a return by its receipt',
       all.map(i=>i.refs.parcels.join()+':'+/picked up|charged it on a receipt/.exec(i.message)[0]).join(' '),'FB1:picked up FB2:charged it on a receipt');
     s.eq('… and each lands on that day',x.r.days.map(d=>d.day+':'+d.delivered+':'+d.returned).join(' '),'2026-09-10:1:0 2026-09-18:0:1');}
    // parcel.date_missing
    {const x=I([paid({trackingNumber:'DM1',transactionDate:null,orderPickupDate:null,orderDeliveryDate:'yesterday'})],'parcel.date_missing');
     s.ok('parcel.date_missing: a delivered parcel with no readable date is named',!!x.i&&x.i.refs.parcels.join()==='DM1');
     s.eq('… and is in no day and not in the opening',x.r.days.length+x.r.opening.awaitingUpfront.parcels,0);
     s.eq('… though as it stands today it still waits for its upfront',x.r.transit.awaitingUpfront.parcels,1);}
    // parcel.future_date
    {const x=I([paid({trackingNumber:'FD1',orderDeliveryDate:'2026-10-05T10:00:00'})],'parcel.future_date');
     s.ok('parcel.future_date: dated after today — named, and in no day',!!x.i&&x.i.refs.parcels.join()==='FD1'&&!x.r.days.length);}
    // parcel.long_on_road
    {const x=I([onRoad({trackingNumber:'LR1',cod:1800,transactionDate:'2026-09-10T10:00:00'}),onRoad({trackingNumber:'LR2',transactionDate:'2026-09-20T10:00:00'})],'parcel.long_on_road');
     s.ok('parcel.long_on_road: on the road '+M.MA_POSTEX_SYNC_DAYS+'+ days after booking — its status may be stale',!!x.i&&x.i.refs.parcels.join()==='LR1'&&/₨1,800/.test(x.i.message),x.i&&x.i.message);}
    // parcel.paid_before_books
    {const H=paid({trackingNumber:'PB1',transactionDate:'2026-06-27T10:00:00',orderPickupDate:'2026-06-28T10:00:00',orderDeliveryDate:'2026-07-02T10:00:00',cprNumber_1:'JUN-2',cpr1Date:'2026-06-30',upfrontPayment:1500});
     const x=I([H],'parcel.paid_before_books','2026-07-01','2026-07-20');
     s.ok('parcel.paid_before_books: paid on a June receipt, delivered in July — named with the ₨1,500',!!x.i&&x.i.refs.parcels.join()==='PB1'&&/₨1,500/.test(x.i.message),x.i&&x.i.message);
     s.eq('… the June receipt is left out, and the parcel was on the road on 1 July',J([x.r.excluded.numbers,x.r.opening.onRoad.parcels,x.r.opening.owed]),J([['JUN-2'],1,0]));}
    // cpr.number_bad
    {const x=I([paid({trackingNumber:'NB1',cprNumber_1:'X'.repeat(101),cpr1Date:'2026-09-05',upfrontPayment:500})],'cpr.number_bad');
     s.ok('cpr.number_bad: a receipt number over '+M.MA_CPR_NUMBER_MAX+' characters is not one — named, no CPR made',!!x.i&&x.i.refs.parcels.join()==='NB1'&&!x.r.cprs.length);
     s.eq('… its parcel counts as not yet on that receipt',x.r.transit.awaitingUpfront.parcels,1);}
    // cpr.field_missing
    {const x=I([paid({trackingNumber:'FM1',cprNumber_1:'FM-1',cpr1Date:'2026-09-05',upfrontPayment:null}),
       paid({trackingNumber:'FM2',cprNumber_1:'FM-0',cpr1Date:'2026-09-01',upfrontPayment:2000,cprNumber_2:'FM-1',cpr2Date:'2026-09-05'})].map(p=>{if(p.trackingNumber==='FM2')delete p.reservePayment;return p;}),'cpr.field_missing');
     const all=x.r.issues.filter(i=>i.rule==='cpr.field_missing');
     s.eq('cpr.field_missing: one per receipt side — FM-1\'s upfront (FM1) and its reserve (FM2, no field at all)',all.map(i=>i.refs.parcels.join()+':'+(/upfront payment/.test(i.message)?'up':'res')).sort().join(' '),'FM1:up FM2:res');
     s.eq('… each counted at its computed share: 2,791.2 + (2,791.2 − 2,000)',cprOf(x.r,'FM-1').net,3582);
     s.ok('… and the message says how much',all.some(i=>/₨2,791 in all/.test(i.message)),all.map(i=>i.message).join(' | '));}
    // cpr.zero_part
    {const x=I([paid({trackingNumber:'Z1',cprNumber_1:'Z-1',cpr1Date:'2026-09-05',upfrontPayment:0}),paid({trackingNumber:'Z2',cprNumber_1:'Z-1',cpr1Date:'2026-09-05',upfrontPayment:0})],'cpr.zero_part');
     s.ok('cpr.zero_part: every parcel on a side shows ₨0 while they are worth ₨5,582 — named',!!x.i&&x.i.refs.parcels.join()==='Z1,Z2'&&/₨5,582/.test(x.i.message),x.i&&x.i.message);
     s.eq('… and the receipt counts ₨0 — a zero on a receipt is never replaced by a guess',cprOf(x.r,'Z-1').net,0);
     s.eq('not raised when one parcel on the side shows a figure',rulesOf(derive([paid({trackingNumber:'Z3',cprNumber_1:'Z-2',cpr1Date:'2026-09-05',upfrontPayment:0}),paid({trackingNumber:'Z4',cprNumber_1:'Z-2',cpr1Date:'2026-09-05',upfrontPayment:5})])).indexOf('cpr.zero_part'),-1);}
    // cpr.date_disagree
    {const D=(t,d)=>paid({trackingNumber:t,cprNumber_1:'DD-1',cpr1Date:d,upfrontPayment:100});
     const x=I([D('DA','2026-09-05'),D('DB','2026-09-05'),D('DC','2026-09-06')],'cpr.date_disagree');
     s.ok('cpr.date_disagree: named, with the dates and how many carry each',!!x.i&&/Sat 5 Sep 2026 \(2\), Sun 6 Sep 2026 \(1\)/.test(x.i.message),x.i&&x.i.message);
     s.eq('… and dated by the date most of them carry, which the message says',(cprOf(x.r,'DD-1')||{}).date+' '+(/It is dated ([^,]+),/.exec(x.i?x.i.message:'')||[])[1],'2026-09-05 Sat 5 Sep 2026');
     const y=derive([D('DD','2026-09-05'),D('DE','2026-09-06')]);
     s.eq('a tie goes to the later date',cprOf(y,'DD-1').date,'2026-09-06');}
    // cpr.date_fallback
    {const x=I([paid({trackingNumber:'DF1',cprNumber_1:'DF-1',cpr1Date:null,upfrontPaymentDate:'2026-09-09T10:00:00',upfrontPayment:100})],'cpr.date_fallback');
     s.ok('cpr.date_fallback: no receipt date — dated from the payment date, and named',!!x.i&&cprOf(x.r,'DF-1').date==='2026-09-09');}
    // cpr.date_missing
    {const x=I([paid({trackingNumber:'NM1',cprNumber_1:'NM-1',upfrontPayment:100}),paid({trackingNumber:'NM2',cprNumber_1:'NM-0',cpr1Date:'2026-09-05',upfrontPayment:100})],'cpr.date_missing');
     s.ok('cpr.date_missing: named, and still counted — never dropped as "before the books"',!!x.i&&cprOf(x.r,'NM-1').date===''&&!x.r.excluded.receipts);
     s.eq('… sorted after every dated receipt',x.r.cprs.map(c=>c.number).join(),'NM-0,NM-1');}
    // cpr.not_final
    {const x=I([onRoad({trackingNumber:'NF1',transactionDate:'2026-09-25T10:00:00',cprNumber_1:'NF-1',cpr1Date:'2026-09-26',upfrontPayment:900})],'cpr.not_final');
     s.ok('cpr.not_final: a parcel on a receipt while still in transit is named, with its status',!!x.i&&/in_transit/.test(x.i.message)&&x.i.refs.receipts.join()==='NF-1');
     s.eq('… PostEx\'s figure still counts on the receipt it is on',cprOf(x.r,'NF-1').net,900);}
    // cpr.return_paid
    {const x=I([returned({trackingNumber:'RP1',cprNumber_1:'RP-1',cpr1Date:'2026-09-05',upfrontPayment:500})],'cpr.return_paid');
     s.ok('cpr.return_paid: a returned parcel paid as if delivered — named with the ₨500',!!x.i&&/₨500/.test(x.i.message)&&x.i.refs.parcels.join()==='RP1');
     s.eq('not raised for a return charged its reversal',rulesOf(derive([returned({trackingNumber:'RP2',cprNumber_1:'RP-2',cpr1Date:'2026-09-05',upfrontPayment:-139.2})])).indexOf('cpr.return_paid'),-1);}
    // cpr.reserve_before_upfront
    {const x=I([paid({trackingNumber:'RB1',cprNumber_1:'UB-1',cpr1Date:'2026-09-10',upfrontPayment:2000,cprNumber_2:'RB-1',cpr2Date:'2026-09-08',reservePayment:791.2})],'cpr.reserve_before_upfront');
     s.ok('cpr.reserve_before_upfront: named with both receipts',!!x.i&&J(x.i.refs)===J({receipts:['RB-1','UB-1'],parcels:['RB1']}));
     s.eq('not raised when the reserve comes after',rulesOf(derive([paid({trackingNumber:'RB2',cprNumber_1:'UB-2',cpr1Date:'2026-09-08',upfrontPayment:2000,cprNumber_2:'RB-2',cpr2Date:'2026-09-10',reservePayment:791.2})])).length,0);}
    // cpr.reserve_without_upfront
    {const x=I([paid({trackingNumber:'RW1',cprNumber_2:'RW-1',cpr2Date:'2026-09-08',reservePayment:791.2})],'cpr.reserve_without_upfront');
     s.ok('cpr.reserve_without_upfront: a delivered parcel, named with its receipt',!!x.i&&J(x.i.refs)===J({receipts:['RW-1'],parcels:['RW1']}));
     s.eq('not raised for a return on its one (reserve) receipt',rulesOf(derive([returned({trackingNumber:'RW2',cprNumber_2:'RW-2',cpr2Date:'2026-09-08',reservePayment:-139.2})])).indexOf('cpr.reserve_without_upfront'),-1);}
    // cpr.split_mismatch
    {const x=I([paid({trackingNumber:'SM1',cprNumber_1:'SU-1',cpr1Date:'2026-09-08',upfrontPayment:2000,cprNumber_2:'SR-1',cpr2Date:'2026-09-15',reservePayment:841.2})],'cpr.split_mismatch');
     s.ok('cpr.split_mismatch: named with both receipts, the parcel and the +₨50',!!x.i&&J(x.i.refs)===J({receipts:['SR-1','SU-1'],parcels:['SM1']})&&x.i.message.indexOf('+₨50')>=0,x.i&&x.i.message);}
    const r=derive(AS.concat([paid({trackingNumber:'Q1',statusCategory:'lost'}),paid({trackingNumber:'Q2',orderDeliveryDate:null})]));
    s.ok('every issue is {rule, message, refs:{receipts, parcels}}, sorted',r.issues.length>=2&&r.issues.every(i=>Object.keys(i).join()==='rule,message,refs'&&Object.keys(i.refs).join()==='receipts,parcels'&&typeof i.message==='string'&&i.message.length>20));
    // A 'lost' parcel raises parcel.status_unknown before any receipt is read;
    // a reserve-only receipt raises cpr.reserve_without_upfront after. Sorted,
    // the cpr.* rule comes first — and either input order gives one answer.
    const so=[paid({trackingNumber:'SO1',statusCategory:'lost'}),paid({trackingNumber:'SO2',cprNumber_2:'SO-R',cpr2Date:'2026-09-08',reservePayment:791.2})];
    const r1=derive(so),r2=derive(so.slice().reverse());
    s.eq('… in rule order, the same whatever order the parcels came in',J([r1.issues.map(i=>i.rule),J(r1.issues)===J(r2.issues)]),
      J([['cpr.reserve_without_upfront','parcel.long_on_road','parcel.status_unknown'],true]));
  }

  s.section('empty input');
  {
    const zero={asOf:'2026-09-30',onRoad:{parcels:0,cod:0},awaitingUpfront:{parcels:0,returned:0,amount:0,reserveAfter:0},awaitingReserve:{parcels:0,returned:0,amount:0},owed:0};
    const want=J({cprs:[],days:[],transit:zero,opening:Object.assign({},zero,{asOf:'2026-09-01'}),excluded:{receipts:0,parcels:0,net:0,first:'',last:'',numbers:[],list:[]},issues:[]});
    s.eq('no parcels: every list empty, every figure 0, no issue',J(derive([])),want);
    s.eq('… the same for undefined',J(derive(undefined)),want);
    s.eq('… and for something that is not a list',J(derive({})),want);
    s.eq('maCprNet of nothing is nothing',J(M.maCprNet()),J({number:'',net:0,parts:{upfront:{parcels:[],amount:0},reserve:{parcels:[],amount:0}},issues:[]}));
    s.eq('maCprSplit of nothing is nothing',J(M.maCprSplit()),J({share:0,upfront:0,reserve:0,basis:{upfront:'computed',reserve:'computed'}}));
  }

  s.section('the rules raised are exactly MA_CPR_ISSUE_RULES');
  {
    const listed=M.MA_CPR_ISSUE_RULES;
    s.eq('no rule listed twice',new Set(listed).size,listed.length);
    s.eq('every listed rule is raised by a fixture above',listed.filter(x=>!raised.has(x)).join(','),'');
    s.eq('nothing is raised that is not listed',Array.from(raised).filter(x=>listed.indexOf(x)<0).join(','),'');
  }
  return s;
};

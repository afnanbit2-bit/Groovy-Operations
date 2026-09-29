/* ─────────────────────────────────────────────────────────────────────────
   PostEx payment enrichment — enrichPayments in netlify/lib/postex-core.js

   A parcel used to be skipped for good the moment it held EITHER CPR number,
   so its reserve receipt (cprNumber_2, cpr2Date), settle and settlementDate
   never arrived — and Master Accounts M2 derives CPRs from all of them. It is
   now asked about until it is finished, at bounded cost, and a later answer
   can never blank a stored value. The give-up window (120 days from the first
   receipt — an assumption: reserve timing is not known) closes only on a
   parcel asked again at least once since that receipt appeared, because the
   books start on 1 July 2026 and every parcel enriched before this change has
   only ever had the check that FOUND its receipt.

   Driven end to end: the real enrichPayments against the in-memory Firestore
   of tests/ma-fake-admin.js (firebase-admin replaced through Module._load; its
   select() is a real projection, so a field the decision reads but the scan
   does not select is missing here just as it would be in production), with a
   scripted Payment Status API handed in through the `fetchStatus` seam and a
   fixed clock through `now`. The last section runs the DEFAULT path — the real
   fetchPaymentStatus over a stubbed global fetch — and the scheduled handler.

   Cannot prove: what the live API sends (its field names, its date format,
   whether a return gets one receipt or two, how long a reserve receipt takes).
   The first scheduled run after deploy is the test; its summary is
   postex_sync_meta/payments_run.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {suite,ROOT}=require('./harness');
const {loadFn,FAKE_SA,withEnv,clone}=require('./ma-fake-admin');
const J=v=>JSON.stringify(v);

const T=Date.UTC(2026,9,5,3,0,0);                 // Mon 5 Oct 2026, 03:00 UTC — the daily run
const DAY=86400000,HOUR=3600000,MIN=60000;
// A date as the parcels hold them ("2026-07-16T10:00:00"; js/fulfillment.js
// reads the first ten characters as the day).
const at=ms=>new Date(ms).toISOString().slice(0,19);

// A delivered parcel with nothing from the Payment Status API yet, booked
// 20 days back.
function parcel(tn,o){
  return Object.assign({trackingNumber:tn,orderRefNumber:'#'+tn,status:'Delivered',statusCategory:'delivered',
    transactionDate:at(T-20*DAY),cod:2500},o||{});
}
// One holding only its upfront receipt, as the OLD code wrote every answer
// (null and settle:false for whatever the answer lacked): the receipt 10 days
// back, last asked 4 days ago.
function upfront(tn,o){
  return parcel(tn,Object.assign({settle:false,settlementDate:null,cprNumber_1:'CPR-'+tn,cpr1Date:at(T-10*DAY),
    cprNumber_2:null,cpr2Date:null,cprCheckedAt:T-4*DAY},o||{}));
}
const ok=dist=>({httpStatus:200,data:{statusCode:'200',statusMessage:'OK',dist}});

// A scripted Payment Status API. answers[tn] is an answer, a function (what
// it returns, or throws), or nothing — a 404.
function postex(answers){
  const calls=[],tokens=[];
  const fn=async(token,tn)=>{
    calls.push(tn);tokens.push(token);
    const a=answers[tn];
    if(typeof a==='function')return a();
    if(a===undefined)return{httpStatus:404,data:{statusCode:'404',statusMessage:'Not found'}};
    return clone(a);
  };
  return{fn,calls,tokens};
}

// Every world made here, so the suite can end by naming any run that threw.
const WORLDS=[];
function world(parcels,answers){
  const st={docs:{}};
  Object.keys(parcels).forEach(id=>{st.docs['postex_orders/'+id]=clone(parcels[id]);});
  const w={st,core:loadFn('netlify/lib/postex-core.js',st),api:postex(answers||{}),thrown:[]};
  WORLDS.push(w);
  return w;
}
// One run of the real enrichPayments. A run that throws is a finding to NAME,
// not a crash that silences the rest of the suite.
async function enrich(w,o){
  try{
    return await withEnv({FIREBASE_SERVICE_ACCOUNT:FAKE_SA},()=>w.core.enrichPayments(
      Object.assign({token:'tok-test',fetchStatus:w.api.fn,now:()=>T,concurrency:1},o||{})));
  }catch(e){const m=String(e&&e.message||e);w.thrown.push(m);return{threw:m};}
}
// What one more run asks about.
async function asks(w,o){const from=w.api.calls.length;await enrich(w,o);return w.api.calls.slice(from);}
const P=(w,id)=>w.st.docs['postex_orders/'+id]||{};
const answerAll=seed=>{const a={};Object.keys(seed).forEach(k=>{a[k]=ok({trackingNumber:k});});return a;};

module.exports=async function(){
  const s=suite('postex-core');

  s.section('the scan — one query, as before, projected to the fields the decision reads');
  {
    const w=world({A:parcel('A'),X:parcel('X',{status:'Out For Delivery',statusCategory:'in_transit'})},{A:ok({trackingNumber:'A'})});
    await enrich(w);
    const qs=w.st.queries||[];
    s.eq('one query',qs.length,1);
    const q=qs[0]||{};
    s.eq('on postex_orders',q.collection,'postex_orders');
    s.eq('delivered and returned parcels only, as before',J(q.filters),J([['statusCategory','in',['delivered','returned']]]));
    const need=['trackingNumber','statusCategory','cprNumber_1','cprNumber_2','cprCheckedAt','settle','cpr1Date','cpr2Date','upfrontPaymentDate','transactionDate','cprRecheckedAt'];
    const got=q.fields||[];
    s.ok('projected: the five fields it read before, plus settle, the four window dates and the re-check stamp',need.every(f=>got.indexOf(f)>=0)&&got.length===need.length,J(got));
    s.eq('one read of Firestore in the whole run',w.st.reads,1);
    s.eq('a parcel still in transit is not asked about',J(w.api.calls),J(['A']));
    const src=fs.readFileSync(path.join(ROOT,'netlify/lib/postex-core.js'),'utf8');
    const fnSrc=(src.match(/async function enrichPayments[\s\S]*?\n}\n/)||[''])[0];
    s.ok('no orderBy in the scan — ordering happens in memory, so no composite index is needed',fnSrc.length>0&&!/orderBy\s*\(/.test(fnSrc));
  }

  s.section('a parcel with no receipt number yet — asked every run, first, as before');
  {
    const w=world({
      N1:parcel('N1'),
      N2:parcel('N2',{status:'Returned',statusCategory:'returned',cod:0,cprCheckedAt:T-HOUR}),
      N3:parcel('N3')
    },{
      N1:ok({trackingNumber:'N1',orderRefNumber:'#N1',cpr1:'CPR-7001',cpr1Date:at(T-2*DAY),settle:false}),
      N2:ok({trackingNumber:'N2',orderRefNumber:'#N2'})
      // N3: PostEx does not know it — a 404
    });
    const r=await enrich(w);
    s.eq('all three asked, in the order the query returned them',J(w.api.calls),J(['N1','N2','N3']));
    s.eq('with the token it was given',J(w.api.tokens),J(['tok-test','tok-test','tok-test']));
    s.eq('N1 gains its upfront receipt number',P(w,'N1').cprNumber_1,'CPR-7001');
    s.eq('…and its date',P(w,'N1').cpr1Date,at(T-2*DAY));
    s.eq('…and is stamped checked',P(w,'N1').cprCheckedAt,T);
    s.ok('…and what the answer lacked is not written as a blank',['cprNumber_2','cpr2Date','settle','settlementDate'].every(k=>!(k in P(w,'N1'))),J(P(w,'N1')));
    s.ok('the check that FOUND the receipt is not a re-check: no cprRecheckedAt',['N1','N2','N3'].every(id=>!('cprRecheckedAt' in P(w,id))),J(['N1','N2','N3'].map(id=>P(w,id).cprRecheckedAt)));
    s.eq('a return answered with no receipt is stamped checked',P(w,'N2').cprCheckedAt,T);
    s.ok('a 404 writes nothing, as before',!('cprCheckedAt' in P(w,'N3')),J(P(w,'N3')));
    s.eq('counted: 3 awaiting a receipt, 3 candidates, 3 processed',J([r.awaitingCpr,r.candidates,r.processed]),J([3,3,3]));
    s.eq('enriched 2, cprFound 1, notFound 1, no re-checks, no errors',J([r.enriched,r.cprFound,r.notFound,r.rechecked,r.errors]),J([2,1,1,0,0]));
    s.eq('an hour later the two still without a receipt are asked again — no throttle before the first receipt',J(await asks(w,{now:()=>T+HOUR})),J(['N2','N3']));
  }

  s.section('a parcel holding only its upfront receipt is asked again — and gains the reserve receipt and settle');
  {
    const w=world({U1:upfront('U1')},{
      U1:ok({trackingNumber:'U1',orderRefNumber:'#U1',cpr1:'CPR-U1',cpr1Date:at(T-10*DAY),
        cpr2:'CPR-9001',cpr2Date:at(T-DAY),settle:true,settlementDate:at(T-DAY)})
    });
    const r=await enrich(w);
    s.eq('it is asked (before this change it was skipped for good)',J(w.api.calls),J(['U1']));
    s.eq('its reserve receipt number arrives',P(w,'U1').cprNumber_2,'CPR-9001');
    s.eq('…with its date',P(w,'U1').cpr2Date,at(T-DAY));
    s.eq('settle arrives',P(w,'U1').settle,true);
    s.eq('…with its date',P(w,'U1').settlementDate,at(T-DAY));
    s.eq('its upfront receipt is untouched',J([P(w,'U1').cprNumber_1,P(w,'U1').cpr1Date]),J(['CPR-U1',at(T-10*DAY)]));
    s.eq('stamped checked',P(w,'U1').cprCheckedAt,T);
    s.eq('…and stamped re-checked',P(w,'U1').cprRecheckedAt,T);
    s.eq('counted: 1 due, 1 re-checked, 1 reserve found, 1 settled, none awaiting a first receipt',J([r.recheckDue,r.rechecked,r.reserveFound,r.settled,r.awaitingCpr]),J([1,1,1,1,0]));
    s.eq('four days on it is finished (settled) and not asked again',J(await asks(w,{now:()=>T+4*DAY})),J([]));
  }
  {
    const w=world({U2:upfront('U2')},{U2:ok({trackingNumber:'U2',cpr1:'CPR-U2',cpr2:'CPR-9002',cpr2Date:at(T-DAY)})});
    await enrich(w);
    s.eq('a delivered parcel whose reserve arrives unsettled holds both numbers',J([P(w,'U2').cprNumber_1,P(w,'U2').cprNumber_2]),J(['CPR-U2','CPR-9002']));
    s.eq('…and is finished: not asked again',J(await asks(w,{now:()=>T+4*DAY})),J([]));
  }
  {
    const w=world({U3:upfront('U3')},{U3:ok({trackingNumber:'U3',cpr1:'CPR-U3',cpr1Date:at(T-10*DAY)})});
    await enrich(w);
    s.eq('no reserve yet: stamped checked',P(w,'U3').cprCheckedAt,T);
    s.eq('…not asked the next day',J(await asks(w,{now:()=>T+DAY})),J([]));
    s.eq('…nor the day after',J(await asks(w,{now:()=>T+2*DAY})),J([]));
    s.eq('…asked again on the third day',J(await asks(w,{now:()=>T+3*DAY})),J(['U3']));
  }

  s.section('a finished parcel is not asked about');
  {
    const seed={
      F1:upfront('F1',{settle:true,settlementDate:at(T-2*DAY),cprCheckedAt:T-10*DAY}),      // settled
      F2:upfront('F2',{cprNumber_2:'CPR-8002',cpr2Date:at(T-3*DAY),cprCheckedAt:T-10*DAY}),  // both numbers, not settled
      F3:upfront('F3',{cprCheckedAt:T-10*DAY})                                                // the control: upfront only
    };
    const w=world(seed,{F3:ok({trackingNumber:'F3',cpr1:'CPR-F3'})});
    const r=await enrich(w);
    s.eq('only the unfinished one is asked',J(w.api.calls),J(['F3']));
    s.eq('a settled parcel is left exactly as it was',J(P(w,'F1')),J(seed.F1));
    s.eq('a delivered parcel holding both numbers is left exactly as it was',J(P(w,'F2')),J(seed.F2));
    s.eq('counted: 1 due, 1 candidate, 1 processed',J([r.recheckDue,r.candidates,r.processed]),J([1,1,1]));
  }

  s.section('a returned parcel holding a receipt finishes only when settled or past the window');
  {
    const ret=(tn,o)=>upfront(tn,Object.assign({status:'Returned',statusCategory:'returned',cod:0},o||{}));
    const seed={
      R1:ret('R1',{cprCheckedAt:T-6*DAY}),                                                      // one receipt, not settled
      R2:ret('R2',{cprNumber_2:'CPR-8R2',cpr2Date:at(T-5*DAY),cprCheckedAt:T-5*DAY}),           // both, not settled
      R3:ret('R3',{cprNumber_2:'CPR-8R3',settle:true,cprCheckedAt:T-5*DAY}),                    // both, settled
      R4:ret('R4',{cprNumber_1:null,cpr1Date:null,cprNumber_2:'CPR-8R4',cpr2Date:at(T-121*DAY),cprCheckedAt:T-5*DAY,cprRecheckedAt:T-5*DAY}), // reserve only, 121 days on, re-checked
      R5:ret('R5',{cprNumber_1:null,cpr1Date:null,cprNumber_2:'CPR-8R5',cpr2Date:at(T-10*DAY),cprCheckedAt:T-4*DAY})  // reserve only, 10 days on
    };
    const w=world(seed,answerAll(seed));
    const r=await enrich(w);
    s.eq('asked: the one-receipt return, the unsettled two-receipt return, the recent reserve-only return — least recently checked first',J(w.api.calls),J(['R1','R2','R5']));
    s.ok('a return holding both numbers but not settled is asked (a delivered parcel in that state is finished)',w.api.calls.indexOf('R2')>=0);
    s.ok('a settled return is not asked',w.api.calls.indexOf('R3')<0);
    s.ok('a reserve-only return 121 days past its receipt, re-checked since, is not asked — given up',w.api.calls.indexOf('R4')<0);
    s.eq('counted: 1 given up',r.gaveUp,1);
  }

  s.section('the throttle — a re-check at most once every 3 days (by cprCheckedAt), with an hour of grace for the run itself');
  {
    const seed={
      H1:upfront('H1',{cprCheckedAt:T-DAY}),
      H2:upfront('H2',{cprCheckedAt:T-70*HOUR}),
      H3:upfront('H3',{cprCheckedAt:T-71*HOUR}),
      H4:upfront('H4',{cprCheckedAt:T-3*DAY+4*MIN}),   // stamped 4 minutes after the scan three runs ago
      H5:upfront('H5',{cprCheckedAt:undefined}),       // never stamped
      H6:upfront('H6',{cprCheckedAt:'yesterday'})      // not a time at all
    };
    const w=world(seed,answerAll(seed));
    const r=await enrich(w);
    s.eq('asked: 71 hours ago, 3 days less 4 minutes ago, never, and an unreadable stamp',J(w.api.calls.slice().sort()),J(['H3','H4','H5','H6']));
    s.ok('not a parcel asked a day ago',w.api.calls.indexOf('H1')<0);
    s.ok('nor one asked 70 hours ago',w.api.calls.indexOf('H2')<0);
    s.eq('counted: 2 throttled, 4 due',J([r.throttled,r.recheckDue]),J([2,4]));
    s.eq('a throttled parcel is not touched',P(w,'H1').cprCheckedAt,T-DAY);
  }
  {
    // The cadence the grace is for: this run scans at 03:00 and stamps its
    // parcels minutes later; the run three days on scans at 03:00 again.
    const w=world({K:upfront('K')},{K:ok({trackingNumber:'K',cpr1:'CPR-K'})});
    let n=0;
    await enrich(w,{now:()=>(n++===0?T:T+4*MIN)});
    s.eq('stamped when it was asked, 4 minutes after the scan',P(w,'K').cprCheckedAt,T+4*MIN);
    s.eq('the daily run three days on asks it again — not a day later',J(await asks(w,{now:()=>T+3*DAY})),J(['K']));
  }

  s.section('the give-up window — 120 days from the first receipt, for a parcel re-checked since');
  {
    // Every parcel here has been re-checked since its receipt appeared, so
    // only the window decides; the next section is the re-check rule.
    const rc={cprRecheckedAt:T-4*DAY};
    const seed={
      W1:upfront('W1',Object.assign({cpr1Date:at(T-119*DAY)},rc)),                                  // 119 days: still waiting
      W2:upfront('W2',Object.assign({cpr1Date:at(T-121*DAY)},rc)),                                  // 121 days: given up
      W3:upfront('W3',Object.assign({cpr1Date:null,upfrontPaymentDate:at(T-121*DAY)},rc)),          // no cpr1Date: the order sync's upfront date
      W4:upfront('W4',Object.assign({cpr1Date:at(T-10*DAY),upfrontPaymentDate:at(T-121*DAY)},rc)),  // cpr1Date comes first
      W5:upfront('W5',Object.assign({cpr1Date:'16/08/2026',upfrontPaymentDate:at(T-121*DAY)},rc)),  // an unreadable cpr1Date falls through
      W6:upfront('W6',Object.assign({cpr1Date:null,transactionDate:at(T-121*DAY)},rc)),             // nothing but the booking
      W7:upfront('W7',Object.assign({cpr1Date:null,transactionDate:undefined},rc)),                 // no readable date at all: no window
      // a return paid on its reserve receipt only; its booking stays recent on
      // purpose, so only cpr2Date can close its window
      W8:upfront('W8',Object.assign({status:'Returned',statusCategory:'returned',cprNumber_1:null,cpr1Date:null,cprNumber_2:'CPR-8W8',cpr2Date:at(T-121*DAY)},rc)),
      W9:upfront('W9',Object.assign({cpr1Date:'2026-09-31T10:00:00',upfrontPaymentDate:at(T-121*DAY)},rc)), // 31 September is not a day
      W10:upfront('W10',Object.assign({cpr1Date:at(T-61*DAY)},rc))                                  // 61 days: the old 60-day window no longer closes it
    };
    const w=world(seed,answerAll(seed));
    const r=await enrich(w);
    s.eq('asked: 119 days in, cpr1Date preferred over an older upfront date, the parcel with no date at all, and 61 days in',J(w.api.calls),J(['W1','W4','W7','W10']));
    [['W2','121 days past cpr1Date'],
     ['W3','121 days past upfrontPaymentDate, when cpr1Date is missing'],
     ['W5','121 days past upfrontPaymentDate, when cpr1Date cannot be read'],
     ['W6','121 days past the booking, when no receipt date is readable'],
     ['W8','121 days past cpr2Date, for a return holding only the reserve receipt'],
     ['W9','121 days past upfrontPaymentDate, when cpr1Date names a day that does not exist']]
      .forEach(([id,why])=>s.ok('given up: '+why,w.api.calls.indexOf(id)<0));
    s.eq('counted: 6 given up, none owed a last check',J([r.gaveUp,r.pastWindowUnchecked]),J([6,0]));
    s.eq('a parcel given up on is left exactly as it was',J(P(w,'W2')),J(seed.W2));
  }
  {
    // The boundary: 120 whole days from the start of the receipt's day (UTC).
    const day0=Date.UTC(2026,6,6);
    const mkB=()=>world({B:upfront('B',{cpr1Date:'2026-07-06T15:30:00',cprCheckedAt:day0,cprRecheckedAt:day0})},{B:ok({trackingNumber:'B'})});
    const w1=mkB();await enrich(w1,{now:()=>day0+120*DAY-1});
    s.eq('a millisecond short of 120 days: still asked',J(w1.api.calls),J(['B']));
    const w2=mkB();await enrich(w2,{now:()=>day0+120*DAY});
    s.eq('at 120 days: given up',J(w2.api.calls),J([]));
  }

  s.section('the window closes only on a parcel re-checked since its receipt appeared — the books start on 1 July 2026');
  {
    // What the OLD code left behind: cprCheckedAt is the check that FOUND the
    // upfront receipt, and nothing has asked about the parcel since.
    const seed={
      G1:upfront('G1',{cpr1Date:'2026-05-20T11:00:00',cprCheckedAt:T-90*DAY}),                        // 138 days past its receipt, never re-checked
      G2:upfront('G2',{cpr1Date:'2026-05-20T11:00:00',cprCheckedAt:T-10*DAY,cprRecheckedAt:T-10*DAY}), // the same, re-checked since
      G3:upfront('G3',{cpr1Date:'2026-07-02T09:00:00',cprCheckedAt:T-80*DAY}),                        // July: 95 days, past the old 60
      G4:upfront('G4',{cpr1Date:at(T-130*DAY),cprCheckedAt:T-DAY})                                    // its receipt found only yesterday
    };
    const w=world(seed,answerAll(seed));
    const r1=await enrich(w);
    s.eq('asked: the old parcel whose only check was the one that found its upfront receipt, 138 days past it — and July, past the old 60 days',J(w.api.calls),J(['G1','G3']));
    s.ok('the same parcel already re-checked since is given up',w.api.calls.indexOf('G2')<0);
    s.ok('one whose receipt was found yesterday waits out the throttle before its last check',w.api.calls.indexOf('G4')<0);
    s.eq('counted: 1 given up, 2 owed a last check, 1 throttled',J([r1.gaveUp,r1.pastWindowUnchecked,r1.throttled]),J([1,2,1]));
    s.eq('the last check is stamped as a re-check',J([P(w,'G1').cprCheckedAt,P(w,'G1').cprRecheckedAt]),J([T,T]));
    const r2calls=await asks(w,{now:()=>T+3*DAY});
    s.eq('three days on: G1 has had its last check and is given up; G4 gets its last check, then July again — least recently checked first',J(r2calls),J(['G4','G3']));
    const r3calls=await asks(w,{now:()=>T+6*DAY});
    s.eq('six days on: only July is still asked — it is inside the window',J(r3calls),J(['G3']));
    const meta=w.st.docs['postex_sync_meta/payments_run']||{};
    s.eq('…and three are given up, none owed a last check',J([meta.gaveUp,meta.pastWindowUnchecked]),J([3,0]));
  }
  {
    // An unreadable stamp is no stamp: the cost is one more request, never a lost receipt.
    const w=world({G5:upfront('G5',{cpr1Date:'2026-05-20T11:00:00',cprCheckedAt:T-90*DAY,cprRecheckedAt:'yesterday'})},{G5:ok({trackingNumber:'G5'})});
    s.eq('a re-check stamp that is not a time counts as none: asked once more',J(await asks(w)),J(['G5']));
  }
  {
    // The catch-up never starves a parcel waiting for its first receipt.
    const w=world({G1:upfront('G1',{cpr1Date:'2026-05-20T11:00:00',cprCheckedAt:T-90*DAY}),Gn:parcel('Gn')},{Gn:ok({trackingNumber:'Gn',cpr1:'CPR-Gn'}),G1:ok({trackingNumber:'G1'})});
    s.eq('limit 1: the parcel with no receipt yet goes first, the backlog after',J(await asks(w,{limit:1})),J(['Gn']));
  }

  s.section('priority when the limit is smaller than the list');
  {
    const seed={
      Pa:upfront('Pa',{cprCheckedAt:T-10*DAY}),
      Nb:parcel('Nb'),
      Pb:upfront('Pb',{cprCheckedAt:undefined}),
      Na:parcel('Na'),
      Pc:upfront('Pc',{cprCheckedAt:T-5*DAY}),
      Pd:upfront('Pd',{cprCheckedAt:T-30*DAY})
    };
    // No receipt yet first, in the query's order (not sorted); then the
    // re-checks, never stamped first, then the longest since checked.
    const order=['Nb','Na','Pb','Pd','Pa','Pc'];
    for(const limit of [1,3,4,10]){
      const w=world(seed,answerAll(seed));
      const r=await enrich(w,{limit,concurrency:5});
      s.eq('limit '+limit+': '+order.slice(0,limit).join(', '),J(w.api.calls),J(order.slice(0,limit)));
      if(limit===3)s.eq('limit 3 counted: 6 candidates, 3 processed, 1 of them a re-check, 2 awaiting + 4 due',
        J([r.candidates,r.processed,r.rechecked,r.awaitingCpr,r.recheckDue]),J([6,3,1,2,4]));
    }
  }

  s.section('a later answer that omits a value never erases a stored one');
  {
    const seed={
      E1:upfront('E1'),
      E2:upfront('E2'),
      E3:parcel('E3',{settle:true,settlementDate:at(T-3*DAY),cprCheckedAt:T-DAY}),  // settled, no receipt number: asked, as before
      E4:upfront('E4')
    };
    const w=world(seed,{
      E1:ok({trackingNumber:'E1'}),
      E2:ok({trackingNumber:'E2',cpr1:null,cprNumber_1:'',cpr1Date:'',upfrontPaymentDate:'  ',cpr2:'   ',settle:false,settlementDate:null}),
      E3:ok({trackingNumber:'E3',settle:false}),
      E4:ok({trackingNumber:'E4',cpr1:'CPR-E4',cpr1Date:at(T-9*DAY)})
    });
    await enrich(w);
    s.eq('an answer with nothing: the receipt number and its date stay',J([P(w,'E1').cprNumber_1,P(w,'E1').cpr1Date]),J(['CPR-E1',at(T-10*DAY)]));
    s.eq('…and the check is stamped',P(w,'E1').cprCheckedAt,T);
    s.eq('an answer of blanks: nothing is blanked',J([P(w,'E2').cprNumber_1,P(w,'E2').cpr1Date,P(w,'E2').cprNumber_2]),J(['CPR-E2',at(T-10*DAY),null]));
    s.eq('settle:true stays true when a later answer says false',P(w,'E3').settle,true);
    s.eq('…and its settlement date stays',P(w,'E3').settlementDate,at(T-3*DAY));
    s.eq('a re-check may replace a value with another non-empty one',P(w,'E4').cpr1Date,at(T-9*DAY));
    const toParcels=(w.st.sets||[]).filter(x=>x.path.indexOf('postex_orders/')===0);
    const blank=toParcels.filter(x=>Object.keys(x.data).some(k=>{const v=x.data[k];return v===null||v===false||(typeof v==='string'&&!v.trim());}));
    s.eq('no write to a parcel carries a null, a blank or false',J(blank.map(x=>x.path)),J([]));
    s.ok('every write to a parcel is a merge',toParcels.length===4&&toParcels.every(x=>x.merge),J(toParcels.map(x=>[x.path,x.merge])));
  }

  s.section("a re-check's clock moves whenever PostEx answered — so the throttle holds for a parcel it no longer knows");
  {
    const seed={C1:upfront('C1'),C2:upfront('C2'),C3:upfront('C3'),C4:upfront('C4'),C5:parcel('C5'),C6:parcel('C6')};
    const w=world(seed,{
      // C1: a 404
      C2:{httpStatus:200,data:{statusCode:'200',dist:null}},
      C3:{httpStatus:500,data:{statusCode:'500',statusMessage:'Internal error'}},
      C4:()=>{throw new Error('The operation was aborted due to timeout');},
      // C5: a 404
      C6:{httpStatus:200,data:{statusCode:'200',dist:null}}
    });
    const r=await enrich(w);
    s.eq('a re-check answered 404: stamped checked and re-checked',J([P(w,'C1').cprCheckedAt,P(w,'C1').cprRecheckedAt]),J([T,T]));
    const c1=Object.assign({},P(w,'C1'),{cprCheckedAt:seed.C1.cprCheckedAt});delete c1.cprRecheckedAt;
    s.eq('…and nothing else changes',J(c1),J(seed.C1));
    s.eq('a re-check answered with no payment: stamped checked and re-checked',J([P(w,'C2').cprCheckedAt,P(w,'C2').cprRecheckedAt]),J([T,T]));
    s.ok('a re-check that got an error status: not stamped',P(w,'C3').cprCheckedAt===T-4*DAY&&!('cprRecheckedAt' in P(w,'C3')),J(P(w,'C3')));
    s.ok('a re-check that failed outright: not stamped',P(w,'C4').cprCheckedAt===T-4*DAY&&!('cprRecheckedAt' in P(w,'C4')),J(P(w,'C4')));
    s.ok('a parcel with no receipt answered 404: nothing written, as before',!('cprCheckedAt' in P(w,'C5')),J(P(w,'C5')));
    s.ok('a parcel with no receipt answered with no payment: nothing written, as before',!('cprCheckedAt' in P(w,'C6')),J(P(w,'C6')));
    s.eq('counted: 2 not found, 1 error, nothing enriched',J([r.notFound,r.errors,r.enriched]),J([2,1,0]));
    s.eq('the next day: the failed re-checks and the parcels with no receipt are asked, the answered re-checks are not',
      J((await asks(w,{now:()=>T+DAY})).sort()),J(['C3','C4','C5','C6']));
  }

  s.section('the run summary — every key it had, the new counters, the same meta document');
  {
    const w=world({N:parcel('N'),U:upfront('U')},{N:ok({trackingNumber:'N',cpr1:'CPR-N'}),U:ok({trackingNumber:'U',cpr2:'CPR-9U'})});
    const r=await enrich(w);
    const old=['lastRun','scope','candidates','processed','enriched','settled','cprFound','notFound','errors','durationMs'];
    const added=['awaitingCpr','recheckDue','throttled','gaveUp','pastWindowUnchecked','rechecked','reserveFound'];
    s.ok('every key the summary had is still there',old.every(k=>k in r),J(old.filter(k=>!(k in r))));
    s.ok('the new counters are there, as numbers',added.every(k=>typeof r[k]==='number'),J(added.filter(k=>typeof r[k]!=='number')));
    s.eq('scope is still "payments"',r.scope,'payments');
    s.eq('lastRun from the clock',r.lastRun,T);
    s.eq('written to postex_sync_meta/payments_run, as before',J(w.st.docs['postex_sync_meta/payments_run']),J(r));
    s.eq('…once, as a merge',J((w.st.sets||[]).filter(x=>x.path==='postex_sync_meta/payments_run').map(x=>x.merge)),J([true]));
    s.eq('reserveFound counts the parcel that gained cprNumber_2, not the one that gained cprNumber_1',r.reserveFound,1);
  }

  s.section('production wiring — the real fetch path, and the scheduled handler');
  {
    // enrichPayments with neither seam: the real fetchPaymentStatus, over a
    // stubbed global fetch, and the real clock.
    const TN='TN 12#3';
    const w=world({[TN]:parcel(TN)},{});
    const seen=[];
    const realFetch=global.fetch;
    global.fetch=async(url,init)=>{
      seen.push({url,method:init&&init.method,token:init&&init.headers&&init.headers.token,signal:!!(init&&init.signal)});
      return{status:200,json:async()=>({statusCode:'200',dist:{trackingNumber:TN,cpr1:'CPR-LIVE'}})};
    };
    try{await withEnv({FIREBASE_SERVICE_ACCOUNT:FAKE_SA},()=>w.core.enrichPayments({token:'tok-live'}));}
    catch(e){w.thrown.push(String(e&&e.message||e));}
    finally{global.fetch=realFetch;}
    s.eq('one call to the Payment Status API, the tracking number encoded',J(seen.map(x=>x.url)),J(['https://api.postex.pk/services/integration/api/order/v1/payment-status/TN%2012%233']));
    s.eq('a GET with the token header and an abort signal',J(seen.map(x=>[x.method,x.token,x.signal])),J([['GET','tok-live',true]]));
    s.eq('the answer lands',P(w,TN).cprNumber_1,'CPR-LIVE');
    s.ok('stamped by the real clock',typeof P(w,TN).cprCheckedAt==='number'&&Math.abs(P(w,TN).cprCheckedAt-Date.now())<60000,P(w,TN).cprCheckedAt);
  }
  {
    // The scheduled handler, unchanged, still hands its limit through.
    const st={docs:{}};
    ['S1','S2','S3'].forEach(tn=>{st.docs['postex_orders/'+tn]=parcel(tn);});
    delete require.cache[path.join(ROOT,'netlify/lib/postex-core.js')];
    const handler=loadFn('netlify/functions/postex-payments-background.js',st);
    const realFetch=global.fetch,realLog=console.log,realErr=console.error;
    const logs=[];
    global.fetch=async url=>({status:200,json:async()=>({dist:{trackingNumber:decodeURIComponent(String(url).split('/').pop()),cpr1:'CPR-X'}})});
    try{
      console.log=(...a)=>{logs.push(a.join(' '));};console.error=(...a)=>{logs.push(a.join(' '));};
      await withEnv({POSTEX_API_TOKEN:'tok-live',FIREBASE_SERVICE_ACCOUNT:FAKE_SA},()=>handler.handler({queryStringParameters:{limit:'2'}}));
    }catch(e){logs.push('threw '+(e&&e.message||e));}
    finally{global.fetch=realFetch;console.log=realLog;console.error=realErr;}
    const meta=st.docs['postex_sync_meta/payments_run']||{};
    s.eq('?limit=2 on the scheduled handler: 3 candidates, 2 processed',J([meta.candidates,meta.processed]),J([3,2]));
    s.ok('…and it logs its summary',logs.some(l=>/\[postex-payments\] done/.test(l)),J(logs));
  }

  s.section('no run threw');
  s.eq('every run of enrichPayments completed',J([].concat(...WORLDS.map(w=>w.thrown))),J([]));
  return s;
};

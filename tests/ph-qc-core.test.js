/* ─────────────────────────────────────────────────────────────────────────
   tests/ph-qc-core.test.js — QC reconciliation, the pure decision core (QC1)
   The phQc* functions in js/ph-core.js.

   The owner's rule (Afnan): the cut quantity per size is FINAL once recorded;
   QC must receive the same units from stitching, per size, within 2 %. The
   worked example is a 120-piece athletic PO cut S 20 / M 40 / L 40 / XL 20.

   THE ALLOWANCE (hand-computed, in whole-number arithmetic; "2 in 100,
   rounded to the nearest piece, a half going up"):
       allowance(n) = floor((2n + 50) / 100)
       n = 20  -> floor( 90/100) = 0        n = 40  -> floor(130/100) = 1
       n = 120 -> floor(290/100) = 2        n = 25  -> floor(100/100) = 1  (the half goes UP)
       n = 24  -> floor( 98/100) = 0        n = 74  -> floor(198/100) = 1
       n = 75  -> floor(200/100) = 2        n = 124 -> floor(298/100) = 2
       n = 125 -> floor(300/100) = 3
   so for 20/40/40/20 (total 120): S 0, M 1, L 1, XL 0, total 2.

   Every expected value below is worked out by hand in a comment and compared
   with the module; none is read back from it. The suite also checks that the
   core is TOTAL (junk in, no throw), never changes its input (deep-frozen
   fixtures), and keeps the file's rules (no -0, no NaN, own keys only).

   It cannot hold what a screen looks like: nothing calls this core yet.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;
const P=require('../js/ph-core.js');

const J=x=>JSON.stringify(x);
function deepFreeze(o){
  if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);Object.keys(o).forEach(k=>deepFreeze(o[k]));}
  return o;
}
// No NaN, no Infinity, no -0 anywhere in a result.
function badNumber(o,seen){
  seen=seen||new Set();
  if(typeof o==='number')return(!isFinite(o)||Object.is(o,-0))?String(o):null;
  if(o&&typeof o==='object'){
    if(seen.has(o))return null;seen.add(o);
    for(const k of Object.keys(o)){const b=badNumber(o[k],seen);if(b!==null)return k+'='+b;}
  }
  return null;
}

module.exports=async function(){
  const s=suite('ph-qc-core');
  const deq=(label,a,b)=>s.ok(label,J(a)===J(b),J(a)===J(b)?undefined:'got '+J(a)+', expected '+J(b));

  // The worked PO: 120 pieces, S 20 / M 40 / L 40 / XL 20.
  const CUT=deepFreeze({S:20,M:40,L:40,XL:20});
  const V=(S,M,L,XL)=>P.phQcVerdict(CUT,{S:S,M:M,L:L,XL:XL});
  const st=v=>['S','M','L','XL'].map(k=>v.sizes[k].state).join(',');

  s.section('the public API is there');
  {
    ['phQcAllowance','phQcSizeOrder','phQcReceived','phQcVerdict','phQcLotProblem','phQcExpected','phQcReconcile','phQcGroup'
    ].forEach(n=>s.ok('exports '+n,typeof P[n]==='function'));
    s.eq('PHQC_TOL_PCT is 2',P.PHQC_TOL_PCT,2);
    s.eq('PHQC_OVER_ALLOWED is true (decision D2: an over-receipt inside the allowance is accepted and flagged)',P.PHQC_OVER_ALLOWED,true);
    s.eq('a lot names at most 12 sizes',P.PHQC_MAX_LOT_SIZES,12);
    s.eq('the phases',J(P.PHQC_PHASES),J(['awaiting_cut','awaiting_qc','receiving','ready','short','closed']));
    s.eq('the groups',J(P.PHQC_GROUPS),J(['cutting','line','finishing','ready','closed']));
    s.eq('state ranking: short > over_refused > unexpected > over > within > exact',
      Object.keys(P.PHQC_STATE_RANK).sort((a,b)=>P.PHQC_STATE_RANK[b]-P.PHQC_STATE_RANK[a]).join('>'),'short>over_refused>unexpected>over>within>exact');
  }

  /* ── the allowance ─────────────────────────────────────────────────── */
  s.section('phQcAllowance: 2 in 100, to the nearest piece, a half going up');
  {
    // [n, hand-computed allowance] from floor((2n+50)/100)
    [[0,0],[1,0],[20,0],[24,0],[25,1],[40,1],[49,1],[50,1],[74,1],[75,2],[100,2],[120,2],[124,2],[125,3],[174,3],[175,4]
    ].forEach(([n,a])=>s.eq('allowance('+n+') = '+a,P.phQcAllowance(n),a));
    s.eq('40 pieces allow 1, not 0 (0.8 rounds to 1, it is not floored)',P.phQcAllowance(40),1);
    s.eq('25 pieces allow 1 (0.5 is a half and goes UP, it is not banker\'s rounding)',P.phQcAllowance(25),1);
    s.eq('a size under 25 pieces must be exact: 24 -> 0',P.phQcAllowance(24),0);
    s.eq('a PO of 24 pieces must be exact',P.phQcAllowance(24),0);
    s.eq('a percentage can be passed: 5 % of 100 = 5',P.phQcAllowance(100,5),5);
    s.eq('0 % allows nothing',P.phQcAllowance(40,0),0);
    s.eq('a bad percentage allows nothing (101)',P.phQcAllowance(40,101),0);
    s.eq('a bad percentage allows nothing (-1)',P.phQcAllowance(40,-1),0);
    [null,undefined,NaN,-5,'abc',{},[],Infinity].forEach(x=>s.eq('allowance('+String(x)+') is 0, never NaN',P.phQcAllowance(x),0));
    s.eq('a numeric string is read: "120" -> 2',P.phQcAllowance('120'),2);
    s.ok('allowance(0) is +0, not -0',!Object.is(P.phQcAllowance(0),-0));
  }

  /* ── size order ────────────────────────────────────────────────────── */
  s.section('phQcSizeOrder: the model\'s order, XXL is 2XL, unknown keys last');
  {
    deq('alpha: XL,S,XXL,M -> S,M,XL,2XL',P.phQcSizeOrder('alpha',['XL','S','XXL','M']),['S','M','XL','2XL']);
    deq('alpha: the whole range in order',P.phQcSizeOrder('alpha',['2XL','XL','L','M','S','XS','XXS','XXXS']),['XXXS','XXS','XS','S','M','L','XL','2XL']);
    deq('waist: 32,28,40 -> 28,32,40',P.phQcSizeOrder('waist',['32','28','40']),['28','32','40']);
    deq('free: FREE',P.phQcSizeOrder('free',['free']),['FREE']);
    deq('no model: alpha first, then waist, then free',P.phQcSizeOrder(null,['32','S','FREE','XL']),['S','XL','32','FREE']);
    deq('a lower-case key is read: xl -> XL',P.phQcSizeOrder('alpha',['xl','s']),['S','XL']);
    deq('XXL and 2XL are one size',P.phQcSizeOrder('alpha',['XXL','2XL']),['2XL']);
    deq('unknown keys come last, alphabetically (code-point order), trimmed',P.phQcSizeOrder('alpha',['ZZ','S','AA',' b ']),['S','AA','ZZ','b']);
    deq('a waist key in an alpha model is unknown, so last',P.phQcSizeOrder('alpha',['30','M']),['M','30']);
    deq('an object is read by its keys',P.phQcSizeOrder('alpha',{M:1,S:2}),['S','M']);
    deq('an unknown model name falls back to trying all three',P.phQcSizeOrder('constructor',['M','30']),['M','30']);
    deq('not a list -> []',P.phQcSizeOrder('alpha',null),[]);
    deq('a string is not a list -> []',P.phQcSizeOrder('alpha','S,M'),[]);
  }

  /* ── what was received ─────────────────────────────────────────────── */
  s.section('phQcReceived: live lots add up, void lots are skipped');
  {
    // L1: S10 M20 L20 XL10 = 60 ; L2: M19 L20 XL10 = 49 ; L3 is void (S20) and must not count.
    // S 10+0 = 10 ; M 20+19 = 39 ; L 20+20 = 40 ; XL 10+10 = 20 ; total 10+39+40+20 = 109
    const lots=deepFreeze([
      {id:'L1',status:'live',sizes:{S:10,M:20,L:20,XL:10},total:60},
      {id:'L2',status:'live',sizes:{M:19,L:20,XL:10},total:49},
      {id:'L3',status:'void',sizes:{S:20},total:20}]);
    const r=P.phQcReceived(lots,{model:'alpha'});
    deq('received ignores void lots: sizes',r.sizes,{S:10,M:39,L:40,XL:20});
    s.eq('received ignores void lots: total 109',r.total,109);
    s.eq('two live lots',r.lotsLive,2);
    s.eq('one void lot',r.lotsVoid,1);
    s.ok('ok, no issues',r.ok&&r.issues.length===0);
    deq('the keys are in model order',r.order,['S','M','L','XL']);
    s.eq('no lots at all -> total 0, ok',J([P.phQcReceived([]).total,P.phQcReceived([]).ok,P.phQcReceived([]).lotsLive]),J([0,true,0]));
    s.eq('not a list -> null (unread is not "nothing received")',P.phQcReceived(null),null);
    s.eq('undefined -> null',P.phQcReceived(undefined),null);
    s.eq('a map is not a list -> null',P.phQcReceived({}),null);
    const x=P.phQcReceived([{id:'A',status:'live',sizes:{XXL:3}},{id:'B',status:'live',sizes:{'2XL':4}}],{model:'alpha'});
    deq('XXL and 2XL lots fold onto one size: 3 + 4 = 7',x.sizes,{'2XL':7});
    // invalid rows are reported and NOT counted (a wrong figure is worse than a missing one)
    const bad=P.phQcReceived([{id:'F',status:'live',sizes:{S:1.5}},{id:'G',status:'pending',sizes:{S:5}},{id:'H',status:'live',sizes:{S:5},total:6},{id:'I',status:'live',sizes:{S:-1}},7,null,
      {id:'K',status:'live',sizes:{S:2}}]);
    s.eq('only the readable live lot counts',bad.total,2);
    s.eq('six unreadable rows are reported',bad.issues.length,6);
    s.eq('they are counted as invalid',bad.lotsInvalid,6);
    s.ok('and the result is not ok',bad.ok===false);
    s.ok('a fractional lot is named',bad.issues.some(w=>/lot F: S: the quantity must be a whole number/.test(w)));
    s.ok('an unknown status is named',bad.issues.some(w=>/lot G: status is neither live nor void/.test(w)));
    s.ok('a total that does not match is named',bad.issues.some(w=>/lot H: its total does not match its sizes/.test(w)));
    const stray=P.phQcReceived([{id:'Z',status:'live',sizes:{S:2,ZZ:3}}],{model:'alpha'});
    deq('a size the model does not know is KEPT, not dropped',stray.sizes,{S:2,ZZ:3});
    deq('and listed as a stray',stray.stray,['ZZ']);
    s.eq('and counted in the total',stray.total,5);
  }

  /* ── the verdict: the owner's table ────────────────────────────────── */
  s.section('phQcVerdict: cut 20/40/40/20, received S/M/L/XL (the plan\'s table, hand-computed)');
  {
    // allowances: S 0, M 1, L 1, XL 0 ; total 2.  diff = received - cut.
    let v=V(20,40,40,20);
    // 20/40/40/20: every diff 0 -> exact x4 ; total 120, diff 0 -> exact ; overall exact
    s.eq('20/40/40/20: sizes exact x4',st(v),'exact,exact,exact,exact');
    s.eq('20/40/40/20: total exact (120)',J([v.total.recv,v.total.diff,v.total.state]),J([120,0,'exact']));
    s.eq('20/40/40/20: overall exact',v.state,'exact');
    s.eq('the allowances are S 0, M 1, L 1, XL 0, total 2',J([v.sizes.S.allow,v.sizes.M.allow,v.sizes.L.allow,v.sizes.XL.allow,v.total.allow]),J([0,1,1,0,2]));

    v=V(20,39,40,20);
    // M -1 (<= 1) within ; total 119, diff -1 (<= 2) within ; overall within
    s.eq('20/39/40/20: M within, rest exact',st(v),'exact,within,exact,exact');
    s.eq('20/39/40/20: total 119 within (-1)',J([v.total.recv,v.total.diff,v.total.state]),J([119,-1,'within']));
    s.eq('20/39/40/20: overall within',v.state,'within');

    v=V(20,39,39,20);
    // M -1 within, L -1 within ; total 118, diff -2 (<= 2) within ; overall within
    s.eq('20/39/39/20: M and L within',st(v),'exact,within,within,exact');
    s.eq('20/39/39/20: total 118 within (-2)',J([v.total.recv,v.total.diff,v.total.state]),J([118,-2,'within']));
    s.eq('20/39/39/20: overall within',v.state,'within');

    v=V(20,38,40,20);
    // M -2 > 1 short ; total 118, diff -2 within ; overall short
    s.eq('20/38/40/20: M is short (-2 > allowance 1)',st(v),'exact,short,exact,exact');
    s.eq('20/38/40/20: the total alone would be within',v.total.state,'within');
    s.eq('20/38/40/20 is short (the per-size gate)',v.state,'short');

    v=V(19,40,40,20);
    // S -1 > 0 short ; total 119 within ; overall short
    s.eq('19/40/40/20: S is short (-1 > allowance 0)',st(v),'short,exact,exact,exact');
    s.eq('19/40/40/20: total 119 within',v.total.state,'within');
    s.eq('19/40/40/20 is short',v.state,'short');

    v=V(20,39,39,19);
    // M within, L within, XL -1 > 0 short ; total 117, diff -3 > 2 short ; overall short
    s.eq('20/39/39/19: M, L within and XL short',st(v),'exact,within,within,short');
    s.eq('20/39/39/19: total 117 is short (-3 > 2)',J([v.total.recv,v.total.diff,v.total.state]),J([117,-3,'short']));
    s.eq('20/39/39/19 is short',v.state,'short');

    v=V(20,41,40,20);
    // M +1 <= 1 over ; total 121, diff +1 <= 2 over ; overall over (allowed, flagged)
    s.eq('20/41/40/20: M over (+1, allowed)',st(v),'exact,over,exact,exact');
    s.eq('20/41/40/20: total 121 over (+1)',J([v.total.recv,v.total.diff,v.total.state]),J([121,1,'over']));
    s.eq('20/41/40/20 is over (a flag, not a refusal)',v.state,'over');

    v=V(20,42,40,20);
    // M +2 > 1 over_refused ; total 122, diff +2 <= 2 over ; overall over_refused
    s.eq('20/42/40/20: M beyond the allowance is over_refused',st(v),'exact,over_refused,exact,exact');
    s.eq('20/42/40/20: overall over_refused',v.state,'over_refused');

    v=V(21,40,40,20);
    // S +1 > 0 over_refused ; total 121 over ; overall over_refused
    s.eq('21/40/40/20: S over_refused (allowance 0)',st(v),'over_refused,exact,exact,exact');
    s.eq('21/40/40/20: overall over_refused',v.state,'over_refused');

    v=V(20,40,40,0);
    // XL -20 > 0 short ; total 100, diff -20 > 2 short ; overall short
    s.eq('20/40/40/0 (so far): XL short (-20)',st(v),'exact,exact,exact,short');
    s.eq('20/40/40/0: total 100 short (-20)',J([v.total.recv,v.total.diff,v.total.state]),J([100,-20,'short']));
    s.eq('20/40/40/0: overall short',v.state,'short');

    // "1, 2, 3 units short PER SIZE": every size short by n
    v=V(19,39,39,19);   // S -1 short ; M -1 within ; L -1 within ; XL -1 short ; total 116 diff -4 short
    s.eq('1 short per size: S and XL short',st(v),'short,within,within,short');
    s.eq('1 short per size: total 116 short',J([v.total.diff,v.total.state]),J([-4,'short']));
    s.eq('1 short per size is short',v.state,'short');
    v=V(18,38,38,18);   // S -2 short ; M -2 short ; L -2 short ; XL -2 short ; total 112 diff -8 short
    s.eq('2 short per size: all four short',st(v),'short,short,short,short');
    s.eq('2 short per size is short',v.state,'short');
    v=V(17,37,37,17);   // diffs -3 ; total 108 diff -12
    s.eq('3 short per size: all four short',st(v),'short,short,short,short');
    s.eq('3 short per size: total diff -12',v.total.diff,-12);
    s.eq('3 short per size is short',v.state,'short');

    // "1, 2, 3 units short IN TOTAL" (the shortfall sits where there is an allowance)
    s.eq('1 short in total (M -1): within',V(20,39,40,20).state,'within');
    s.eq('2 short in total (M -1, L -1): within',V(20,39,39,20).state,'within');
    s.eq('2 short in total (M -2): short, because M alone exceeds its allowance',V(20,38,40,20).state,'short');
    s.eq('3 short in total (M -2, L -1): short',V(20,38,39,20).state,'short');
    s.eq('3 short in total (M -1, L -1, XL -1): short',V(20,39,39,19).state,'short');
  }

  s.section('phQcVerdict: the TOTAL gate on its own (every size inside its own allowance, the PO total outside)');
  {
    // cut S/M/L 25 each: each size allows floor(100/100) = 1 ; the total 75 allows floor(200/100) = 2.
    // received 24/24/24: every size -1 (within), total 72, diff -3 > 2 -> the total alone is short.
    const c=deepFreeze({S:25,M:25,L:25});
    let v=P.phQcVerdict(c,{S:24,M:24,L:24});
    s.eq('24/24/24 of 25/25/25: every size within',[v.sizes.S.state,v.sizes.M.state,v.sizes.L.state].join(','),'within,within,within');
    s.eq('the total allowance is 2, not the sum of the sizes (3)',v.total.allow,2);
    s.eq('total 72, diff -3 is short',J([v.total.recv,v.total.diff,v.total.state]),J([72,-3,'short']));
    s.eq('so the PO is short on the total alone',v.state,'short');
    // received 26/26/26: every size +1 (over, allowed), total 78, diff +3 > 2 -> over_refused on the total alone.
    v=P.phQcVerdict(c,{S:26,M:26,L:26});
    s.eq('26/26/26: every size over (+1, allowed)',[v.sizes.S.state,v.sizes.M.state,v.sizes.L.state].join(','),'over,over,over');
    s.eq('26/26/26: total +3 is over_refused',J([v.total.diff,v.total.state]),J([3,'over_refused']));
    s.eq('26/26/26: overall over_refused (the total gate)',v.state,'over_refused');
    // received 24/25/25: S -1 within, total 74, diff -1 within -> within
    s.eq('24/25/25: within on both',P.phQcVerdict(c,{S:24,M:25,L:25}).state,'within');
  }

  s.section('phQcVerdict: unexpected, ranking, options, junk');
  {
    // A size with nothing cut that receives units is 'unexpected'.
    let v=P.phQcVerdict(CUT,{S:20,M:40,L:40,XL:20,XS:1});
    s.eq('a size with 0 cut is unexpected',v.sizes.XS.state,'unexpected');
    s.eq('its cut is 0 and it is listed',J([v.sizes.XS.cut,v.sizes.XS.recv]),J([0,1]));
    // total 121 vs 120 = +1 (<= 2) over ; sizes: XS unexpected -> worst is unexpected (rank 3 > over 2)
    s.eq('overall unexpected outranks the total\'s over',v.state,'unexpected');
    // a cut map that lists XS:0 explicitly behaves the same
    v=P.phQcVerdict({XS:0,S:20,M:40,L:40,XL:20,'2XL':0},{S:20,M:40,L:40,XL:20,XS:1});
    s.eq('an explicit 0 in the cut is the same',v.sizes.XS.state,'unexpected');
    s.eq('a size with 0 cut and 0 received is not a row',Object.keys(P.phQcVerdict({XS:0,S:20},{S:20}).sizes).join(),'S');
    // ranking
    s.eq('short + over_refused -> short (19/42/40/20)',V(19,42,40,20).state,'short');
    s.eq('over_refused + unexpected -> over_refused',P.phQcVerdict(CUT,{S:20,M:42,L:40,XL:20,XS:1}).state,'over_refused');
    s.eq('unexpected + over -> unexpected',P.phQcVerdict(CUT,{S:20,M:41,L:40,XL:20,XS:1}).state,'unexpected');
    s.eq('over + within -> over (20/41/39/20)',V(20,41,39,20).state,'over');
    s.eq('within + exact -> within',V(20,39,40,20).state,'within');
    // options
    v=P.phQcVerdict(CUT,{S:20,M:41,L:40,XL:20},{overAllowed:false});
    s.eq('overAllowed:false: over becomes over_refused (size)',v.sizes.M.state,'over_refused');
    s.eq('overAllowed:false: over becomes over_refused (total)',v.total.state,'over_refused');
    s.eq('overAllowed:false: overall over_refused',v.state,'over_refused');
    s.eq('tolPct:0 -> 20/39/40/20 is short',P.phQcVerdict(CUT,{S:20,M:39,L:40,XL:20},{tolPct:0}).state,'short');
    s.eq('tolPct:5 -> allowances are 1, 2, 2, 1 (floor((n*5+50)/100): 20->1, 40->2)',
      J(['S','M','L','XL'].map(k=>P.phQcVerdict(CUT,{S:20,M:40,L:40,XL:20},{tolPct:5}).sizes[k].allow)),J([1,2,2,1]));
    // flagged lists only the sizes that need a human
    deq('flagged: only short / over_refused / unexpected / over, not within',P.phQcVerdict(CUT,{S:19,M:39,L:42,XL:20,XS:1}).flagged.map(f=>f.size+':'+f.state),['XS:unexpected','S:short','L:over_refused']);
    // order and strays
    deq('rows are in model order',Object.keys(V(20,40,40,20).sizes),['S','M','L','XL']);
    deq('the order field matches',V(20,40,40,20).order,['S','M','L','XL']);
    v=P.phQcVerdict({S:20,ZZ:5},{S:20,ZZ:5});
    deq('a stray size is reported, and still counted (total 25)',[v.stray,v.total.cut],[['ZZ'],25]);
    s.eq('and its row is there, exact',v.sizes.ZZ.state,'exact');
    // junk is refused with a reason, never thrown
    s.ok('a fractional cut -> ok:false',P.phQcVerdict({S:20.5},{S:20}).ok===false);
    s.ok('a negative received -> ok:false',P.phQcVerdict(CUT,{S:-1}).ok===false);
    s.ok('a text quantity -> ok:false',P.phQcVerdict(CUT,{S:'many'}).ok===false);
    s.ok('a null cut -> ok:false',P.phQcVerdict(null,{S:1}).ok===false);
    s.ok('a null received -> ok:false',P.phQcVerdict(CUT,null).ok===false);
    s.ok('an array is not a size map',P.phQcVerdict([20],[20]).ok===false);
    s.ok('a duplicate (XXL and 2XL) in the cut -> ok:false and named',/2XL is given twice/.test(P.phQcVerdict({XXL:3,'2XL':4},{}).why));
    s.eq('a refused verdict has no state (it is not "exact")',P.phQcVerdict(null,null).state,null);
    // keys that are special in JavaScript stay ordinary own keys
    const proto=JSON.parse('{"S":20,"__proto__":3}');
    v=P.phQcVerdict(proto,JSON.parse('{"S":20,"__proto__":3}'));
    s.ok('a key called __proto__ is kept as a stray row',Object.prototype.hasOwnProperty.call(v.sizes,'__proto__')&&v.stray.indexOf('__proto__')>=0);
    s.ok('and the prototype is not polluted',({}).cut===undefined&&({}).recv===undefined);
    s.eq('a size called constructor is a stray, not a model lookup',P.phQcVerdict({constructor:2},{constructor:2}).stray.join(),'constructor');
  }

  /* ── lots ──────────────────────────────────────────────────────────── */
  s.section('phQcLotProblem: what may not be saved');
  {
    const none={};
    const full=deepFreeze({S:20,M:40,L:40,XL:20});
    s.eq('a good first lot is accepted',P.phQcLotProblem(CUT,none,{S:20,M:20,L:20,XL:10}),null);
    s.eq('the whole cut in one lot is accepted',P.phQcLotProblem(CUT,none,{S:20,M:40,L:40,XL:20}),null);
    s.eq('blank boxes count as 0',P.phQcLotProblem(CUT,none,{S:'10',M:'',L:null,XL:undefined}),null);
    s.eq('a lot that takes M to cut+allowance (41) is accepted',P.phQcLotProblem(CUT,full,{M:1}),null);
    s.eq('nothing received yet (recvSoFar null) is read as {}',P.phQcLotProblem(CUT,null,{S:5}),null);
    // 20/42/40/20 from nothing: S 20 ok, M 42 > 40+1 -> refused on M
    s.eq('20/42/40/20 is refused on M (the plan\'s table)',P.phQcLotProblem(CUT,none,{S:20,M:42,L:40,XL:20}),
      'QC cannot receive more than was cut: M has 40 cut, 0 received, this lot adds 42 - the allowance is 1.');
    s.eq('M +2 on top of a full M is refused (42 > 41)',P.phQcLotProblem(CUT,full,{M:2}),
      'QC cannot receive more than was cut: M has 40 cut, 40 received, this lot adds 2 - the allowance is 1.');
    s.eq('21/40/40/20: S +1 is refused, the allowance of S is 0',P.phQcLotProblem(CUT,full,{S:1}),
      'QC cannot receive more than was cut: S has 20 cut, 20 received, this lot adds 1 - the allowance is 0.');
    s.eq('it counts what was already received: M 41 + 1 = 42 > 41',P.phQcLotProblem(CUT,{M:41},{M:1}),
      'QC cannot receive more than was cut: M has 40 cut, 41 received, this lot adds 1 - the allowance is 1.');
    // total gate alone: cut 25/25/25 (total 75, allowance 2); received 25 each; lot +1 each: each size 26 <= 26, total 78 > 77
    s.eq('the total gate refuses on its own (3 x +1 on 25/25/25)',P.phQcLotProblem({S:25,M:25,L:25},{S:25,M:25,L:25},{S:1,M:1,L:1}),
      'QC cannot receive more than was cut in total: 75 cut, 75 received, this lot adds 3 - the allowance is 2.');
    s.eq('overAllowed:false: M +1 over a full M is refused, allowance 0',P.phQcLotProblem(CUT,full,{M:1},{overAllowed:false}),
      'QC cannot receive more than was cut: M has 40 cut, 40 received, this lot adds 1 - the allowance is 0.');
    // shape refusals
    s.ok('a size that was not cut is refused and named',/^XS was not cut on this PO/.test(P.phQcLotProblem(CUT,none,{XS:5})||''));
    s.eq('a 0 on a size that was not cut is harmless',P.phQcLotProblem(CUT,none,{XS:0,S:5}),null);
    s.ok('nothing entered: {}',/^Nothing was entered/.test(P.phQcLotProblem(CUT,none,{})||''));
    s.ok('nothing entered: all zeros',/^Nothing was entered/.test(P.phQcLotProblem(CUT,none,{S:0,M:''})||''));
    s.ok('a fraction is refused',/whole number/.test(P.phQcLotProblem(CUT,none,{S:1.5})||''));
    s.ok('a negative is refused',/negative/.test(P.phQcLotProblem(CUT,none,{S:-1})||''));
    s.ok('text is refused',/whole number/.test(P.phQcLotProblem(CUT,none,{S:'abc'})||''));
    s.ok('a size given twice is refused',/2XL is given twice/.test(P.phQcLotProblem({S:20,'2XL':20},none,{'2XL':1,XXL:1})||''));
    const many={};for(let i=1;i<=13;i++)many['K'+i]=1;
    s.ok('more than 12 sizes is refused',/at most 12 sizes/.test(P.phQcLotProblem(CUT,none,many)||''));
    const twelve={S:1};for(let i=1;i<=11;i++)twelve['K'+i]=0;     // 12 keys, eleven of them 0 on sizes that were not cut
    s.eq('exactly 12 keys are accepted (a 0 on a size that was not cut is harmless)',P.phQcLotProblem(CUT,none,twelve),null);
    s.ok('not a map is refused',/Enter the units received/.test(P.phQcLotProblem(CUT,none,null)||''));
    s.ok('an array is refused',/Enter the units received/.test(P.phQcLotProblem(CUT,none,[1,2])||''));
    // no cut -> nothing can be received
    s.ok('no cut (null) -> not recorded',/cut is not recorded/.test(P.phQcLotProblem(null,none,{S:1})||''));
    s.ok('an empty cut -> not recorded',/cut is not recorded/.test(P.phQcLotProblem({},none,{S:1})||''));
    s.ok('a cut of all zeros -> not recorded',/cut is not recorded/.test(P.phQcLotProblem({S:0},none,{S:1})||''));
    s.ok('a bad received-so-far is named, not guessed',/could not be read/.test(P.phQcLotProblem(CUT,{S:-3},{S:1})||''));
    s.ok('the refusals are text, not objects',typeof P.phQcLotProblem(CUT,none,{XS:5})==='string');
    // waist sizes work the same way
    s.eq('a waist lot within the cut is accepted',P.phQcLotProblem({'30':10,'32':20},{},{'30':10,'32':20},{model:'waist'}),null);
  }

  /* ── the cut the floor is held to ──────────────────────────────────── */
  const CUTQ={XS:0,S:20,M:40,L:40,XL:20,'2XL':0};           // what markCuttingDone writes: all six, zeros kept
  const mkPo=(extra)=>deepFreeze(Object.assign({id:'PO-125',code:'GAT012',poStatus:'in_production',currentStage:'qc',
    sizes:{S:30,M:50,L:50,XL:30},stages:{cutting:{done:true}},cutQty:CUTQ},extra||{}));
  const LOCK=(sizes)=>({status:'locked',cutLock:{sizes:sizes||{S:20,M:40,L:40,XL:20},total:120,source:'first_lot'}});

  s.section('phQcExpected: lock, live, none');
  {
    // live: cutting recorded, no lock yet. sizes are the cut map as written (zeros kept), total 20+40+40+20 = 120
    let e=P.phQcExpected(mkPo(),null);
    s.eq('no lock, cutting recorded -> source live',e.source,'live');
    s.eq('not locked',e.locked,false);
    s.eq('the live total is 120',e.total,120);
    deq('the live sizes are the cut, never the ordered sizes (30/50/50/30)',e.sizes.M,40);
    s.eq('no drift without a lock',e.drift,null);
    // none: ordered sizes exist but nothing was cut
    e=P.phQcExpected(mkPo({stages:{cutting:{done:false}}}),null);
    s.eq('cutting not done -> source none (the ordered sizes are not a cut)',J([e.ok,e.source,e.total,e.sizes]),J([true,'none',0,{}]));
    e=P.phQcExpected(mkPo({stages:{}}),null);
    s.eq('no cutting stage at all -> none',e.source,'none');
    e=P.phQcExpected(mkPo({cutQty:undefined}),null);
    s.eq('cutting done but no cutQty -> none, never po.sizes',J([e.source,e.total]),J(['none',0]));
    e=P.phQcExpected(mkPo({cutQty:{S:0,M:0}}),null);
    s.eq('a cutQty of zeros is no cut',e.source,'none');
    e=P.phQcExpected(mkPo({cutQty:{S:'x'}}),null);
    s.eq('an unreadable live cutQty is no cut',e.source,'none');
    // lock wins over a drifted live cut: live M is 42 (a hand edit), the lock says 40
    const drifted=mkPo({cutQty:{XS:0,S:20,M:42,L:40,XL:20,'2XL':0}});
    e=P.phQcExpected(drifted,LOCK());
    s.eq('a lock wins over the live cut: source lock',e.source,'lock');
    s.eq('M is the locked 40, not the live 42',e.sizes.M,40);
    s.eq('locked',e.locked,true);
    deq('the drift is reported: M lock 40, live 42; totals 120 and 122',e.drift,{sizes:[{size:'M',lock:40,live:42}],lockTotal:120,liveTotal:122});
    e=P.phQcExpected(mkPo(),LOCK());
    s.eq('an unchanged live cut is no drift',e.drift,null);
    e=P.phQcExpected(mkPo({stages:{},cutQty:undefined}),LOCK());
    s.eq('a lock with no live cut still works: source lock, no drift',J([e.source,e.drift,e.total]),J(['lock',null,120]));
    s.ok('a malformed lock is refused (ok:false), not repaired',P.phQcExpected(mkPo(),{cutLock:{sizes:{S:1.5},total:1}}).ok===false);
    s.ok('a lock whose total does not match its sizes is refused',P.phQcExpected(mkPo(),{cutLock:{sizes:{S:20,M:40,L:40,XL:20},total:119}}).ok===false);
    s.ok('a lock with a total of 0 is refused',P.phQcExpected(mkPo(),{cutLock:{sizes:{S:0},total:0}}).ok===false);
    s.ok('a lock that is not an object is refused',P.phQcExpected(mkPo(),{cutLock:'x'}).ok===false);
    s.ok('a null cutLock is "not locked"',P.phQcExpected(mkPo(),{cutLock:null}).source==='live');
    // bundling damage
    const dmg=mkPo({damageSummary:{bySize:{M:3,XL:25}}});
    e=P.phQcExpected(dmg,null);
    s.eq('bundling damage is NOT subtracted by default',J([e.sizes.M,e.total]),J([40,120]));
    e=P.phQcExpected(dmg,null,{minusBundlingDamage:true});
    // M 40-3 = 37 ; XL 20-25 -> floored at 0 ; S 20, L 40 ; total 20+37+40+0 = 97
    s.eq('with minusBundlingDamage: M 37, XL floored at 0, total 97',J([e.sizes.M,e.sizes.XL,e.total]),J([37,0,97]));
    deq('the damage is reported',e.damage,{M:3,XL:25});
    s.ok('junk PO -> ok:false',P.phQcExpected(null,null).ok===false);
    // a waist PO (denim): sizes come out in waist order
    const denim={id:'PO-200',code:'GD007',currentStage:'qc',stages:{cutting:{done:true}},cutQty:{'32':20,'30':10,'28':5}};
    e=P.phQcExpected(denim,null);
    deq('a waist cut is read in waist order',[e.source,e.order,e.total],['live',['28','30','32'],35]);
  }

  /* ── reconcile ─────────────────────────────────────────────────────── */
  s.section('phQcReconcile: the phases');
  {
    const lot=(id,sizes,status)=>({id:id,poId:'PO-125',status:status||'live',sizes:sizes,total:Object.keys(sizes).reduce((t,k)=>t+sizes[k],0)});
    // no cut
    let r=P.phQcReconcile(mkPo({stages:{cutting:{done:false}}}),null,[]);
    s.eq('no cut: ok, awaiting_cut, cutSource none',J([r.ok,r.phase,r.cutSource]),J([true,'awaiting_cut','none']));
    s.eq('no cut: there is no cut and no verdict (the ordered sizes are never used)',J([r.cut,r.verdict]),J([null,null]));
    s.eq('no cut: nobody can close',J(r.canClose),J({floor:false,manager:false}));
    s.eq('no cut: no progress figure',r.progressPct,null);
    // a cut, no lots
    r=P.phQcReconcile(mkPo(),null,[]);
    s.eq('a live cut and no lots: awaiting_qc',J([r.ok,r.phase,r.cutSource,r.locked]),J([true,'awaiting_qc','live',false]));
    s.eq('awaiting_qc: 0 %',r.progressPct,0);
    s.eq('awaiting_qc: cannot close',J(r.canClose),J({floor:false,manager:false}));
    s.eq('the stage is carried (qc)',r.stage,'qc');
    // 109 of 120: S10 M39 L40 XL20 (+ a void lot that must not count)
    const two=[lot('L1',{S:10,M:20,L:20,XL:10}),lot('L2',{M:19,L:20,XL:10}),lot('L3',{S:20},'void')];
    r=P.phQcReconcile(mkPo(),LOCK(),two);
    // S 10 vs 20: -10 short ; total 109, diff -11 > 2 short -> the total is short, so more is expected: receiving
    s.eq('109 of 120: receiving (the total is still short)',r.phase,'receiving');
    s.eq('receiving: the overall verdict is short',r.verdict.state,'short');
    s.eq('receiving: nobody can close',J(r.canClose),J({floor:false,manager:false}));
    // floor(109*100/120) = floor(90.83) = 90
    s.eq('receiving: progress 90 %',r.progressPct,90);
    s.eq('two live lots, one void',J([r.lotsLive,r.lotsVoid]),J([2,1]));
    s.eq('received total 109',r.recv.total,109);
    // the rest arrives: 20/40/40/20
    const three=two.concat([lot('L4',{S:10,M:1,XL:0})]);
    r=P.phQcReconcile(mkPo(),LOCK(),three);
    s.eq('20/40/40/20 received: ready',r.phase,'ready');
    s.eq('ready: the floor may close, and so may a manager',J(r.canClose),J({floor:true,manager:true}));
    s.eq('ready, exact: 100 %',J([r.verdict.state,r.progressPct]),J(['exact',100]));
    // 119: floor(119*100/120) = floor(99.16) = 99
    r=P.phQcReconcile(mkPo(),LOCK(),[lot('A',{S:20,M:39,L:40,XL:20})]);
    s.eq('20/39/40/20: ready (within), 99 %',J([r.phase,r.verdict.state,r.progressPct]),J(['ready','within',99]));
    s.eq('a progress of 99 never rounds up to 100 while a piece is missing',r.progressPct<100,true);
    // 20/38/40/20: total 118 within, M -2 short -> phase short ; floor(118*100/120) = floor(98.33) = 98
    r=P.phQcReconcile(mkPo(),LOCK(),[lot('A',{S:20,M:38,L:40,XL:20})]);
    s.eq('20/38/40/20: the total is in but M is short -> phase short',J([r.phase,r.verdict.state,r.progressPct]),J(['short','short',98]));
    s.eq('short: the floor cannot close, a manager can',J(r.canClose),J({floor:false,manager:true}));
    // 20/40/40/0: floor(100*100/120) = floor(83.33) = 83
    r=P.phQcReconcile(mkPo(),LOCK(),[lot('A',{S:20,M:40,L:40})]);
    s.eq('20/40/40/0: receiving, 83 %, 20 XL still expected',J([r.phase,r.progressPct,r.verdict.sizes.XL.diff]),J(['receiving',83,-20]));
    // over (allowed)
    r=P.phQcReconcile(mkPo(),LOCK(),[lot('A',{S:20,M:41,L:40,XL:20})]);
    s.eq('20/41/40/20: ready, over; the floor may close',J([r.phase,r.verdict.state,r.canClose.floor]),J(['ready','over',true]));
    s.eq('over: progress is capped at 100',r.progressPct,100);
    // over beyond the allowance (a hand-written lot): total 122 over(+2) but M +2 over_refused -> short phase (manager only)
    r=P.phQcReconcile(mkPo(),LOCK(),[lot('A',{S:20,M:42,L:40,XL:20})]);
    s.eq('20/42/40/20 (hand-written): phase short, manager only',J([r.phase,r.verdict.state,r.canClose]),J(['short','over_refused',{floor:false,manager:true}]));
    // closed and reopened
    r=P.phQcReconcile(mkPo(),{status:'closed',cutLock:LOCK().cutLock},[lot('A',{S:20,M:40,L:40,XL:20})]);
    s.eq('a closed reconciliation: phase closed, nobody can close it again',J([r.phase,r.canClose]),J(['closed',{floor:false,manager:false}]));
    r=P.phQcReconcile(mkPo(),{status:'reopened',cutLock:LOCK().cutLock},[lot('A',{S:20,M:40,L:40,XL:20})]);
    s.eq('a reopened one is judged again on its figures: ready, flagged reopened',J([r.phase,r.reopened]),J(['ready',true]));
    // the lock wins over a drifted live cut: live M is 42 -> against the live cut 20/40/40/20 would be M -2 short
    r=P.phQcReconcile(mkPo({cutQty:{XS:0,S:20,M:42,L:40,XL:20,'2XL':0}}),LOCK(),[lot('A',{S:20,M:40,L:40,XL:20})]);
    s.eq('the lock wins over a drifted cutQty: exact against the locked 40',J([r.verdict.state,r.phase,r.cutSource]),J(['exact','ready','lock']));
    s.eq('and the drift is reported',J(r.drift.sizes),J([{size:'M',lock:40,live:42}]));
    // unread data
    r=P.phQcReconcile(mkPo(),LOCK(),null);
    s.ok('lots null -> ok:false, and the reason names po_qc_lots',r.ok===false&&/po_qc_lots/.test(r.why));
    s.eq('unread lots give no phase and no way to close (never "nothing received")',J([r.phase,r.canClose]),J([null,{floor:false,manager:false}]));
    r=P.phQcReconcile(mkPo(),LOCK(),undefined);
    s.ok('lots undefined -> ok:false naming po_qc_lots',r.ok===false&&/po_qc_lots/.test(r.why));
    r=P.phQcReconcile(mkPo(),LOCK(),[],{reconRead:false});
    s.ok('a recon that could not be read -> ok:false naming po_qc_recon',r.ok===false&&/po_qc_recon/.test(r.why));
    r=P.phQcReconcile(mkPo(),null,[lot('A',{S:20})]);
    s.eq('lots with no recon document still count (the live cut)',J([r.ok,r.recv.total]),J([true,20]));
    // unreadable rows fail closed: the PO cannot be closed on a figure that is not right
    r=P.phQcReconcile(mkPo(),LOCK(),[lot('A',{S:20,M:40,L:40,XL:20}),{id:'B',poId:'PO-125',status:'live',sizes:{S:1.5}}]);
    s.ok('a lot with a fractional quantity -> ok:false',r.ok===false&&/could not be read/.test(r.why));
    s.eq('and nobody can close',J(r.canClose),J({floor:false,manager:false}));
    r=P.phQcReconcile(mkPo(),LOCK(),[lot('A',{S:20,M:40,L:40,XL:20}),Object.assign(lot('B',{S:1}),{poId:'PO-999'})]);
    s.ok('a lot of another PO -> ok:false and named',r.ok===false&&/PO-999/.test(r.why));
    r=P.phQcReconcile(mkPo(),LOCK(),[Object.assign(lot('A',{S:20,M:40,L:40,XL:20}),{poId:'125'})]);
    s.eq('a lot whose poId is the bare number matches (the PO key reads 125 as PO-125)',r.ok,true);
    s.ok('a junk PO -> ok:false',P.phQcReconcile(null,null,[]).ok===false);
    // strays
    r=P.phQcReconcile(mkPo(),LOCK(),[lot('A',{S:20,M:40,L:40,XL:20,ZZ:1})]);
    s.eq('a stray size in a lot is reported and judged unexpected',J([r.stray,r.verdict.sizes.ZZ.state]),J([['ZZ'],'unexpected']));
    // bundling damage option
    r=P.phQcReconcile(mkPo({damageSummary:{bySize:{M:3}}}),LOCK(),[lot('A',{S:20,M:40,L:40,XL:20})],{minusBundlingDamage:true});
    // the option takes bundling damage off the expected figure whichever way the cut is known: M 40 - 3 = 37 ; total 20+37+40+20 = 117
    s.eq('minusBundlingDamage:true takes the damage off the locked cut too (M 37, total 117)',J([r.cut.sizes.M,r.cut.total]),J([37,117]));
    r=P.phQcReconcile(mkPo({damageSummary:{bySize:{M:3}}}),LOCK(),[lot('A',{S:20,M:40,L:40,XL:20})]);
    s.eq('and by default it does not (M 40, total 120)',J([r.cut.sizes.M,r.cut.total]),J([40,120]));
    // waist PO end to end
    const denim={id:'PO-200',code:'GD007',currentStage:'qc',stages:{cutting:{done:true}},cutQty:{'28':10,'30':20}};
    r=P.phQcReconcile(denim,null,[{id:'D1',poId:'PO-200',status:'live',sizes:{'28':10,'30':19},total:29}]);
    // total 30, allow floor(110/100)=1 ; 30: -1 vs allow floor(90/100)=0 -> short ; 28: exact ; total 29 diff -1 within -> phase short
    s.eq('a waist PO reconciles in waist order (30 is 1 short with allowance 0)',J([r.ok,r.cut.order,r.verdict.sizes['30'].state,r.phase]),J([true,['28','30'],'short','short']));
  }

  /* ── groups ────────────────────────────────────────────────────────── */
  s.section('phQcGroup: where a PO sits in the Afloat list');
  {
    const g=(stage,phase)=>P.phQcGroup({stage:stage,phase:phase});
    s.eq('cutting, awaiting the cut -> cutting',g('cutting','awaiting_cut'),'cutting');
    ['bundling','stitching','printing','washing'].forEach(st=>s.eq(st+' with no lots -> line',g(st,'awaiting_qc'),'line'));
    s.eq('stitching and receiving -> line',g('stitching','receiving'),'line');
    s.eq('stage qc, awaiting QC -> finishing',g('qc','awaiting_qc'),'finishing');
    s.eq('stage qc, receiving -> finishing',g('qc','receiving'),'finishing');
    s.eq('stage qc, ready -> ready',g('qc','ready'),'ready');
    s.eq('stage qc, short -> ready (flagged inside the group)',g('qc','short'),'ready');
    s.eq('stage qc, closed -> closed',g('qc','closed'),'closed');
    s.eq('stitching with a ready verdict -> ready (lots can arrive before the stage moves)',g('stitching','ready'),'ready');
    s.eq('washing with a short verdict -> ready',g('washing','short'),'ready');
    s.eq('bundling with a ready verdict stays in the line (ready counts from stitching on)',g('bundling','ready'),'line');
    s.eq('cutting never reads as ready',g('cutting','ready'),'cutting');
    s.eq('a completed PO whose reconciliation is closed -> closed',g('completed','closed'),'closed');
    s.eq('a completed PO still receiving stays visible -> finishing',g('completed','receiving'),'finishing');
    s.eq('a completed PO that matches -> ready',g('completed','ready'),'ready');
    s.eq('a stage the core does not know -> unknown',g('weird','awaiting_qc'),'unknown');
    s.eq('cancelled is not afloat -> null',g('cancelled','awaiting_qc'),null);
    s.eq('reserved is not afloat -> null',g('reserved','awaiting_cut'),null);
    s.eq('blank stage -> null',g('','ready'),null);
    s.eq('junk -> null',P.phQcGroup(null),null);
    s.eq('a string -> null',P.phQcGroup('qc'),null);
    // every group the core names is reachable
    const seen={};
    [['cutting','awaiting_cut'],['stitching','awaiting_qc'],['qc','receiving'],['qc','ready'],['qc','closed']].forEach(a=>{seen[g(a[0],a[1])]=1;});
    s.eq('all five groups are reachable',Object.keys(seen).sort().join(),P.PHQC_GROUPS.slice().sort().join());
    // a reconcile result feeds the group directly
    const r=P.phQcReconcile(mkPo(),LOCK(),[{id:'A',poId:'PO-125',status:'live',sizes:{S:20,M:40,L:40,XL:20},total:120}]);
    s.eq('a phQcReconcile result is a valid input (stage qc, phase ready)',P.phQcGroup(r),'ready');
  }

  /* ── total, frozen, clean ──────────────────────────────────────────── */
  s.section('total: junk in never throws, inputs are never changed, no NaN / -0');
  {
    const junk=[undefined,null,0,1,-1,NaN,Infinity,'','x','S',[],[1],{},{S:'x'},{S:1e400},true,()=>1,Symbol('s')];
    let threw=0,calls=0;
    const fns=['phQcAllowance','phQcSizeOrder','phQcReceived','phQcVerdict','phQcLotProblem','phQcExpected','phQcReconcile','phQcGroup'];
    fns.forEach(n=>{
      junk.forEach(a=>junk.slice(0,8).forEach(b=>{
        [[a],[a,b],[a,b,a],[a,b,a,b]].forEach(args=>{calls++;try{P[n].apply(null,args);}catch(e){threw++;console.log('      threw: '+n+' '+e.message);}});
      }));
    });
    s.eq('no phQc function throws on junk ('+calls+' calls)',threw,0);

    // inputs are never changed (deep-frozen fixtures; a write would throw in strict mode)
    const po=mkPo({damageSummary:{bySize:{M:3}}});
    const rc=deepFreeze(Object.assign({status:'locked'},{cutLock:{sizes:{S:20,M:40,L:40,XL:20},total:120}}));
    const lots=deepFreeze([{id:'A',poId:'PO-125',status:'live',sizes:{S:20,M:39,L:40,XL:20},total:119},{id:'B',poId:'PO-125',status:'void',sizes:{S:1},total:1}]);
    const before=J([po,rc,lots,CUT]);
    let err=null;
    try{
      const r=P.phQcReconcile(po,rc,lots,{minusBundlingDamage:true});
      P.phQcVerdict(CUT,{S:20,M:39,L:40,XL:20});P.phQcReceived(lots);P.phQcExpected(po,rc,{minusBundlingDamage:true});
      P.phQcLotProblem(CUT,{S:1},{M:2});P.phQcGroup(r);P.phQcSizeOrder('alpha',Object.keys(CUT));
      s.eq('a full reconcile of frozen inputs: no NaN, no Infinity, no -0 in the result',badNumber(r),null);
    }catch(e){err=e;}
    s.ok('frozen inputs are not written to',err===null,err&&err.message);
    s.eq('and are unchanged afterwards',J([po,rc,lots,CUT]),before);
    // numbers: a difference of nothing is +0, never -0
    const v=P.phQcVerdict({S:5},{S:5});
    s.ok('diff of equal numbers is +0',!Object.is(v.sizes.S.diff,-0)&&!Object.is(v.total.diff,-0));
    s.eq('no NaN or -0 anywhere in a verdict',badNumber(P.phQcVerdict(CUT,{S:3,M:0,L:7,XL:99})),null);
    s.eq('no NaN or -0 anywhere in a received tally',badNumber(P.phQcReceived([{id:'A',status:'live',sizes:{S:0,M:3}}])),null);
    // the results are fresh objects: changing one does not change the next call
    const a=P.phQcVerdict(CUT,{S:20,M:40,L:40,XL:20});a.sizes.S.state='tampered';
    s.eq('a returned verdict is a copy',P.phQcVerdict(CUT,{S:20,M:40,L:40,XL:20}).sizes.S.state,'exact');

    // names: one lexical scope with every other classic script
    const src=fs.readFileSync(path.join(ROOT,'js/ph-core.js'),'utf8');
    const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'').replace(/\/\/ .*$/gm,'');
    const mine=(code.match(/^(?:const|let|var|function)\s+((?:_phQc|phQc|PHQC_)[\w$]*)/gm)||[]).map(x=>x.split(/\s+/)[1]);
    s.ok('the core declares its phQc / _phQc / PHQC_ names',mine.length>=15,String(mine.length));
    const jsDir=path.join(ROOT,'js');
    const others=fs.readdirSync(jsDir).filter(f=>f.endsWith('.js')&&f!=='ph-core.js');
    const clashes=[];
    others.forEach(f=>{
      const t=fs.readFileSync(path.join(jsDir,f),'utf8');
      mine.forEach(n=>{if(new RegExp('^(?:const|let|var|function)\\s+'+n.replace(/\$/g,'\\$')+'\\b','m').test(t))clashes.push(f+':'+n);});
    });
    s.eq('no phQc / _phQc / PHQC_ top-level name is declared in any other js file',clashes.join(),'');
    s.eq('each of them is declared once in the core',mine.length,new Set(mine).size);
    const exported=mine.filter(n=>/^(phQc|PHQC_)/.test(n));
    s.eq('every public phQc function and PHQC_ constant is exported',exported.filter(n=>!(n in P)).join(),'');
    // pure: nothing in the new code touches the clock, the DOM, Firestore or the session
    const start=code.indexOf('const PHQC_TOL_PCT'),end=code.indexOf("if(typeof module!=='undefined'");
    const blk=code.slice(start,end);
    s.ok('the QC block was found',start>0&&end>start,start+'..'+end);
    [['Date',/\bDate\b/],['Math.random',/Math\.random/],['document',/\bdocument\b/],['window',/\bwindow\b/],['Firestore',/getDoc|setDoc|updateDoc|runTransaction|writeBatch|firebase/i],
     ['session',/\bsession\b/],['console',/console\./],['fetch',/\bfetch\s*\(/]].forEach(p=>s.ok('the QC block never touches '+p[0],!p[1].test(blk),(blk.match(p[1])||[])[0]));
    // as a classic script it defines the same functions
    const app=harness.loadApp({files:['js/ph-core.js']});
    s.eq('as a classic script it defines its globals',app.run('typeof phQcReconcile+typeof PHQC_TOL_PCT+typeof phQcAllowance'),'functionnumberfunction');
    s.eq('and gives the same answer there (allowance of 120 is 2)',app.run('phQcAllowance(120)'),2);
  }
  return s;
};

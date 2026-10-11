/* ─────────────────────────────────────────────────────────────────────────
   tests/ph-core.test.js — Production Ops, the pure core (js/ph-core.js)

   What this holds: the PKT day (never the UTC one) at its boundaries; the
   season rule (winter Oct-Jan, summer Feb-Sep, a stored season wins); the
   size models and what a valid breakdown is; gross per piece, the standard,
   the variance at its exact tolerance edges and the benchmark; the capacity
   allocator at 399/400/401 with priorities, skip days, off-weekdays and a
   hand-computed day-by-day fixture; the masters' daily and weekly log; the
   PO stage over the real stage order (read from js/pos.js, not copied) with
   cancelled POs left out; lead time and delay gap across the PKT midnight;
   the completeness gate field by field; the PC-only heuristic; the 70-130 %
   cut gate at 69/70/130/131 (and held equal to PO_CUT_GATE in js/pos.js);
   the report roll-ups, empty input and a date range.

   And three things about the module itself: it is TOTAL (every export is
   called with junk and must not throw), it never changes its input (the
   fixtures are deep-frozen), and it is PURE (no clock, DOM or Firestore in
   its source). Every figure below was worked out by hand in a comment, then
   compared with the module — not read back from it.

   It cannot hold what any screen looks like; there is no screen yet.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;
const P=require('../js/ph-core.js');

const J=x=>JSON.stringify(x);
// Epoch ms of a PKT wall-clock time (PKT is UTC+5).
const pkt=(day,hh,mm)=>Date.UTC(+day.slice(0,4),+day.slice(5,7)-1,+day.slice(8,10),hh||0,mm||0)-5*3600000;
const iso=ms=>new Date(ms).toISOString();
function deepFreeze(o){
  if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);Object.keys(o).forEach(k=>deepFreeze(o[k]));}
  return o;
}

module.exports=async function(){
  const s=suite('ph-core');
  const deq=(label,a,b)=>s.ok(label,J(a)===J(b),J(a)===J(b)?undefined:'got '+J(a)+', expected '+J(b));

  s.section('the public API is there');
  {
    ['phStr','phNum','phWhole','phRound','phUnit','phNorm','phIsDay','phMs','phDay','phDayNum','phDayFromNum','phDayAdd','phDaysBetween','phWeekday','phWeekStart',
     'phSettings','phIsWorkday','phWorkdayNext','phWorkdaysBetween','phSeasonKey','phSeasonOfDay','phSeasonOf','phSeasonLabel','phSizeKey','phSizeModel','phValidateSizes',
     'phSizesTotal','phGrossActual','phStandard','phExpectedGross','phGrossVariance','phMasterKey','phMasterEntry','phMasterFind','phMasterLog','phMastersSummary',
     'phAllocate','phStageOf','phPoUnits','phPipeline','phNextAction','phLeadTime','phDelayGap','phPoComplete','phIsPcOnly','phCutRange','phCutVerdict','phReport'
    ].forEach(n=>s.ok('exports '+n,typeof P[n]==='function'));
    ['PH_VERSION','PH_TZ_OFFSET_MIN','PH_UNITS','PH_SEASON_VALUES','PH_WINTER_MONTHS','PH_SUMMER_MONTHS','PH_SIZE_MODELS','PH_REAL_STAGE_ORDER','PH_STAGES','PH_CUT_GATE_PCT','PH_DEFAULT_SETTINGS'
    ].forEach(n=>s.ok('exports the constant '+n,P[n]!==undefined));
    s.eq('winter and summer months together are all twelve, with none shared',P.PH_WINTER_MONTHS.concat(P.PH_SUMMER_MONTHS).sort((a,b)=>a-b).join(),'1,2,3,4,5,6,7,8,9,10,11,12');
  }

  /* ── dates ─────────────────────────────────────────────────────────── */
  s.section('dates: the PKT day, never the UTC day');
  {
    s.eq('20:30Z on 4 Oct is 01:30 PKT on 5 Oct',P.phDay(Date.UTC(2026,9,4,20,30)),'2026-10-05');
    s.eq('18:59:59.999Z is still 23:59:59 PKT the same UTC day',P.phDay(Date.UTC(2026,9,4,18,59,59,999)),'2026-10-04');
    s.eq('19:00:00Z is PKT midnight: the next day',P.phDay(Date.UTC(2026,9,4,19,0,0)),'2026-10-05');
    s.eq('23:30Z (UTC day 4) is 04:30 PKT on the 5th',P.phDay(Date.UTC(2026,9,4,23,30)),'2026-10-05');
    s.eq('00:30Z (UTC day 5) is 05:30 PKT on the 5th: the same PKT day as 23:30Z the evening before',P.phDay(Date.UTC(2026,9,5,0,30)),'2026-10-05');
    s.eq('an ISO string with a Z is read as UTC then shifted',P.phDay('2026-10-04T20:30:00.000Z'),'2026-10-05');
    s.eq('a Firestore-shaped {seconds} is read',P.phDay({seconds:Date.UTC(2026,9,4,20,30)/1000}),'2026-10-05');
    s.eq('a {toMillis()} is read',P.phDay({toMillis:()=>Date.UTC(2026,9,4,20,30)}),'2026-10-05');
    s.eq('a Date is read',P.phDay(new Date(Date.UTC(2026,9,4,20,30))),'2026-10-05');
    s.eq('a day string passes through unchanged',P.phDay('2026-10-05'),'2026-10-05');
    s.eq('an impossible day (30 Feb) is refused, not rolled into March',P.phDay('2026-02-30'),null);
    s.eq('an impossible day inside an ISO moment is refused',P.phMs('2026-02-30T10:00:00Z'),null);
    s.eq('a 10-digit seconds number is not guessed at',P.phMs(1790000000),null);
    s.eq('garbage has no day',P.phDay('tomorrow'),null);
    s.eq('a throwing toMillis has no day (and does not throw)',P.phDay({toMillis:()=>{throw new Error('x');}}),null);
    s.eq('phIsDay: a real day',P.phIsDay('2028-02-29'),true);
    s.eq('phIsDay: 29 Feb in a non-leap year',P.phIsDay('2027-02-29'),false);
    s.eq('phIsDay: month 13',P.phIsDay('2026-13-01'),false);
    s.eq('phDayAdd across a year end',P.phDayAdd('2026-12-31',1),'2027-01-01');
    s.eq('phDayAdd into a leap day',P.phDayAdd('2028-02-28',1),'2028-02-29');
    s.eq('phDayAdd over a non-leap February',P.phDayAdd('2027-02-28',1),'2027-03-01');
    s.eq('phDayAdd backwards',P.phDayAdd('2026-10-01',-1),'2026-09-30');
    s.eq('phDaysBetween forward',P.phDaysBetween('2026-10-05','2026-10-12'),7);
    s.eq('phDaysBetween backward is signed',P.phDaysBetween('2026-10-12','2026-10-05'),-7);
    s.eq('phDaysBetween with a bad day is null',P.phDaysBetween('2026-10-05','x'),null);
    s.eq('Monday 12 Oct 2026 is weekday 1',P.phWeekday('2026-10-12'),1);
    s.eq('Sunday 11 Oct 2026 is weekday 0',P.phWeekday('2026-10-11'),0);
    s.eq('1 Jan 1970 was a Thursday (4)',P.phWeekday('1970-01-01'),4);
    s.eq('week start of a Wednesday is that Monday',P.phWeekStart('2026-10-07'),'2026-10-05');
    s.eq('week start of a Monday is itself',P.phWeekStart('2026-10-12'),'2026-10-12');
    s.eq('week start of a Sunday is the Monday SIX days before',P.phWeekStart('2026-10-11'),'2026-10-05');
    s.eq('week start of a Saturday',P.phWeekStart('2026-10-10'),'2026-10-05');
    s.eq('week start across a month end',P.phWeekStart('2026-11-01'),'2026-10-26');
  }

  /* ── settings and the working calendar ──────────────────────────────── */
  s.section('settings and the working calendar');
  {
    const D=P.phSettings(null);
    s.eq('capacity defaults to 400 a day',D.dailyCapacity,400);
    deq('the cut gate defaults to 70-130',D.cutGate,[70,130]);
    s.eq('no weekday is off by default',D.offWeekdays.length,0);
    s.eq('a capacity given as a string is read',P.phSettings({dailyCapacity:'250'}).dailyCapacity,250);
    s.eq('capacity 0 falls back to 400',P.phSettings({dailyCapacity:0}).dailyCapacity,400);
    s.eq('capacity above 100000 falls back',P.phSettings({dailyCapacity:100001}).dailyCapacity,400);
    s.eq('capacity 2.5 (not whole) falls back',P.phSettings({dailyCapacity:2.5}).dailyCapacity,400);
    deq('seven off weekdays are not a calendar: dropped',P.phSettings({offWeekdays:[0,1,2,3,4,5,6]}).offWeekdays,[]);
    deq('off weekdays are sorted, unique, 0-6',P.phSettings({offWeekdays:[6,0,0,9,'x',-1]}).offWeekdays,[0,6]);
    deq('a gate of 0-1000 is junk and falls back to 70-130, it does not switch the check off',P.phSettings({cutGate:[0,1000]}).cutGate,[70,130]);
    deq('a sane gate is kept',P.phSettings({cutGate:[80,120]}).cutGate,[80,120]);
    deq('a gate given as {minPct,maxPct} is read',P.phSettings({cutGate:{minPct:75,maxPct:125}}).cutGate,[75,125]);
    s.eq('delay target above the stuck limit falls back to 3',P.phSettings({delayTargetDays:5,stuckDays:3}).delayTargetDays,3);
    s.eq('...and stuck to 7',P.phSettings({delayTargetDays:5,stuckDays:3}).stuckDays,7);
    const cal={offWeekdays:[0],skipDays:['2026-10-14']};
    s.eq('Sunday is off',P.phIsWorkday('2026-10-11',cal),false);
    s.eq('a skip day is off',P.phIsWorkday('2026-10-14',cal),false);
    s.eq('an ordinary Monday is a workday',P.phIsWorkday('2026-10-12',cal),true);
    s.eq('with no calendar every day works (Sunday too)',P.phIsWorkday('2026-10-11',null),true);
    s.eq('next workday from a Sunday off',P.phWorkdayNext('2026-10-11',cal),'2026-10-12');
    s.eq('next workday from a skip day',P.phWorkdayNext('2026-10-14',cal),'2026-10-15');
    s.eq('Mon 12 to Fri 16 with Wed 14 skipped is 3 workdays (13, 15, 16)',P.phWorkdaysBetween('2026-10-12','2026-10-16',{skipDays:['2026-10-14']}),3);
    s.eq('backwards it is -3',P.phWorkdaysBetween('2026-10-16','2026-10-12',{skipDays:['2026-10-14']}),-3);
    s.eq('the same day is 0',P.phWorkdaysBetween('2026-10-12','2026-10-12',cal),0);
    const sk={skipDays:['2026-10-14']};
    s.eq('workdays are additive over a split point',
      P.phWorkdaysBetween('2026-10-12','2026-10-20',sk),
      P.phWorkdaysBetween('2026-10-12','2026-10-15',sk)+P.phWorkdaysBetween('2026-10-15','2026-10-20',sk));
  }

  /* ── seasons ────────────────────────────────────────────────────────── */
  s.section('1  seasons: winter = Oct-Jan, summer = Feb-Sep');
  {
    const k=d=>P.phSeasonOfDay(d).key;
    s.eq('30 Sept is summer of that year',k('2026-09-30'),'summer-2026');
    s.eq('1 Oct is winter, named by its October',k('2026-10-01'),'winter-2026');
    s.eq('31 Dec is winter-2026',k('2026-12-31'),'winter-2026');
    s.eq('1 Jan 2027 is still winter-2026',k('2027-01-01'),'winter-2026');
    s.eq('31 Jan 2027 is still winter-2026 (winter is Oct-JANUARY)',k('2027-01-31'),'winter-2026');
    s.eq('1 Feb 2027 is summer-2027 (summer starts in February)',k('2027-02-01'),'summer-2027');
    s.eq('28 Feb 2027 is summer, not winter',k('2027-02-28'),'summer-2027');
    s.eq('15 Jul is summer',k('2026-07-15'),'summer-2026');
    s.eq('a non-day has no season',k('nope'),null);
    // The boundary by MOMENT: PKT midnight on 1 Oct is 19:00Z on 30 Sept.
    s.eq('18:59Z on 30 Sept is 23:59 PKT: still summer',P.phSeasonOf(Date.UTC(2026,8,30,18,59,59)).key,'summer-2026');
    s.eq('19:00Z on 30 Sept is 00:00 PKT on 1 Oct: winter',P.phSeasonOf(Date.UTC(2026,8,30,19,0,0)).key,'winter-2026');
    deq('the season of a bare day is a date guess',[P.phSeasonOf('2026-11-01').source,P.phSeasonOf('2026-11-01').guess],['date',true]);
    // stored wins
    const stW=P.phSeasonOf({season:'winter',plannedCutDate:'2026-07-10'});
    deq('a stored winter on a PO cut in July is the UPCOMING winter, and stored beats the date',[stW.key,stW.source,stW.guess],['winter-2026','stored',false]);
    s.eq('stored summer, planned in November: summer starts in Feb of the next year',P.phSeasonOf({season:'summer',plannedCutDate:'2026-11-15'}).key,'summer-2027');
    s.eq('stored summer, planned in January: summer starts that February',P.phSeasonOf({season:'summer',plannedCutDate:'2027-01-10'}).key,'summer-2027');
    s.eq('stored summer, planned in July: that summer',P.phSeasonOf({season:'summer',plannedCutDate:'2026-07-10'}).key,'summer-2026');
    s.eq('stored winter, planned in December: that winter',P.phSeasonOf({season:'winter',plannedCutDate:'2026-12-10'}).key,'winter-2026');
    s.eq('stored winter, planned in January 2027: winter-2026',P.phSeasonOf({season:'winter',plannedCutDate:'2027-01-10'}).key,'winter-2026');
    s.eq('a stored seasonYear is honoured',P.phSeasonOf({season:'winter',seasonYear:2025,plannedCutDate:'2026-10-10'}).key,'winter-2025');
    s.eq('a stored seasonKey is honoured with no season field',P.phSeasonOf({seasonKey:'summer-2027'}).key,'summer-2027');
    deq('all-season has no year',(r=>[r.season,r.year,r.key])(P.phSeasonOf({season:'all'})),['all',null,'all']);
    s.eq('stored season is matched case-insensitively',P.phSeasonOf({season:' Winter ',plannedCutDate:'2026-10-10'}).key,'winter-2026');
    s.eq('stored season with no date at all has the bare season for a key (year unknown)',P.phSeasonOf({season:'winter'}).key,'winter');
    deq('no season, planned date: derived and flagged a guess',(r=>[r.key,r.source,r.guess])(P.phSeasonOf({plannedCutDate:'2026-10-07'})),['winter-2026','date',true]);
    s.eq('the date falls back to the issue moment when nothing is planned',P.phSeasonOf({ts:pkt('2026-03-10',10)}).key,'summer-2026');
    deq('no season and no date: none',(r=>[r.key,r.source])(P.phSeasonOf({})),[null,'none']);
    deq('junk: none',(r=>[r.key,r.source])(P.phSeasonOf(null)),[null,'none']);
    s.eq('a bogus stored season is ignored and the date decides',P.phSeasonOf({season:'autumn',plannedCutDate:'2026-10-07'}).source,'date');
    s.eq('label of a winter',P.phSeasonLabel('winter-2026'),'Winter 2026/27');
    s.eq('label of a summer',P.phSeasonLabel('summer-2027'),'Summer 2027');
    s.eq('label of all',P.phSeasonLabel('all'),'All-season');
    s.eq('label of nothing',P.phSeasonLabel(null),'No season');
    s.eq('phSeasonKey rejects a season that is not one',P.phSeasonKey('spring',2026),null);
  }

  /* ── size model ─────────────────────────────────────────────────────── */
  s.section('3  size model: alpha, waist, free');
  {
    deq('alpha keys XXXS..2XL',P.PH_SIZE_MODELS.alpha.keys,['XXXS','XXS','XS','S','M','L','XL','2XL']);
    deq('waist keys 26..40 by two',P.PH_SIZE_MODELS.waist.keys,['26','28','30','32','34','36','38','40']);
    s.eq('a tee is alpha by default',P.phSizeModel({code:'GST073'}).model,'alpha');
    deq('denim GD is waist, by prefix',(r=>[r.model,r.source])(P.phSizeModel({code:'GD007'})),['waist','prefix']);
    s.eq('jorts GJO is waist',P.phSizeModel({code:'GJO001'}).model,'waist');
    s.eq('GC is waist',P.phSizeModel({code:'GC012'}).model,'waist');
    s.eq('GCO (a co-ord) is NOT GC: alpha',P.phSizeModel({code:'GCO001'}).model,'alpha');
    s.eq('the prefix is case-insensitive',P.phSizeModel({code:'gd007'}).model,'waist');
    deq('an explicit axis on the article beats the prefix',(r=>[r.model,r.source])(P.phSizeModel({code:'GD007',sizeModel:'alpha'})),['alpha','article']);
    s.eq('a Pattern Hub style sizeAxis is read too',P.phSizeModel({code:'GST073',sizeAxis:'waist'}).model,'waist');
    s.eq("'none' means free size",P.phSizeModel({sizeAxis:'none'}).model,'free');
    s.eq('junk gives alpha',P.phSizeModel(42).model,'alpha');
    s.eq('XXL is read as 2XL',P.phSizeKey('alpha','xxl'),'2XL');
    s.eq('an alpha size is upper-cased',P.phSizeKey('alpha',' xs '),'XS');
    s.eq('XXXL is not a size of the model',P.phSizeKey('alpha','XXXL'),null);
    s.eq('a waist given as a number',P.phSizeKey('waist',30),'30');
    s.eq('an odd waist is not a size',P.phSizeKey('waist','31'),null);
    const ok=P.phValidateSizes('alpha',{S:100,M:200});
    deq('a valid alpha breakdown',[ok.ok,ok.total,ok.sizes],[true,300,{S:100,M:200}]);
    deq('sizes come out in model order, not input order',Object.keys(P.phValidateSizes('alpha',{L:1,XS:1,M:1}).sizes),['XS','M','L']);
    const x=P.phValidateSizes('alpha',{XXL:50});
    deq('XXL is accepted and normalised',[x.ok,x.sizes],[true,{'2XL':50}]);
    s.eq('an unknown size is refused',P.phValidateSizes('alpha',{S:10,XXXL:5}).ok,false);
    s.ok('...and named',/XXXL/.test(((P.phValidateSizes('alpha',{S:10,XXXL:5}).issues[0])||{}).why||''));
    s.eq('a fractional quantity is refused',P.phValidateSizes('alpha',{S:12.5}).ok,false);
    s.eq('a negative quantity is refused',P.phValidateSizes('alpha',{S:-1,M:5}).ok,false);
    s.eq('all zero is refused: at least one size above zero',P.phValidateSizes('alpha',{S:0,M:0}).ok,false);
    s.eq('an empty breakdown is refused',P.phValidateSizes('alpha',{}).ok,false);
    deq('a blank size counts as zero when another is above zero',(r=>[r.ok,r.total])(P.phValidateSizes('alpha',{S:'',M:'7'})),[true,7]);
    s.eq('a non-numeric quantity is refused',P.phValidateSizes('alpha',{S:'abc'}).ok,false);
    s.eq('XXL and 2XL together are given twice',P.phValidateSizes('alpha',{XXL:1,'2XL':1}).ok,false);
    s.eq('an array is not a size map',P.phValidateSizes('alpha',[{size:'S',qty:3}]).ok,false);
    s.eq('null sizes are refused',P.phValidateSizes('alpha',null).ok,false);
    deq('a valid waist breakdown',(r=>[r.ok,r.total])(P.phValidateSizes('waist',{'30':10,'32':20})),[true,30]);
    s.eq('alpha sizes on a waist article are refused',P.phValidateSizes('waist',{S:10}).ok,false);
    deq('free size is one bucket',(r=>[r.ok,r.total])(P.phValidateSizes('free',{FREE:50})),[true,50]);
    s.eq('free size refuses a named size',P.phValidateSizes('free',{S:50}).ok,false);
    s.eq('the model can be passed as the object phSizeModel returns',P.phValidateSizes(P.phSizeModel({code:'GD007'}),{'30':5}).ok,true);
    s.eq('an unknown model name is refused',P.phValidateSizes('banana',{S:5}).ok,false);
    s.eq('phSizesTotal ignores junk',P.phSizesTotal({S:10,M:'5',L:'x',XL:-3,'2XL':2.5}),15);
  }

  /* ── gross ──────────────────────────────────────────────────────────── */
  s.section('2  gross: consumption per piece, the standard, the variance');
  {
    // 120 kg of fabric over 380 pieces cut = 0.315789... -> 0.3158 (4 dp). Planned basis: 120/400 = 0.3000.
    const a=P.phGrossActual({fabricUsed:120,cutUnits:380,unit:'kg'});
    deq('120 kg over 380 pieces',[a.ok,a.perPiece,a.unit],[true,0.3158,'kg']);
    s.eq('...on 400 planned pieces it is 0.3',P.phGrossActual({fabricUsed:120,cutUnits:400}).perPiece,0.3);
    s.eq("'meters' is read as m",P.phGrossActual({fabricUsed:90,cutUnits:200,unit:'meters'}).unit,'m');
    s.eq('90 m over 200 pieces',P.phGrossActual({fabricUsed:90,cutUnits:200,unit:'m'}).perPiece,0.45);
    deq('no pieces cut: no figure, never 0',(r=>[r.ok,r.perPiece,r.reason])(P.phGrossActual({fabricUsed:120,cutUnits:0})),[false,null,'no_pieces']);
    deq('no fabric: no figure, never 0',(r=>[r.ok,r.perPiece,r.reason])(P.phGrossActual({fabricUsed:0,cutUnits:100})),[false,null,'no_fabric']);
    s.eq('a unit that is not kg or m is refused, not guessed',P.phGrossActual({fabricUsed:5,cutUnits:5,unit:'yards'}).reason,'bad_unit');
    s.eq('a string quantity with a comma is read',P.phGrossActual({fabricUsed:'1,200',cutUnits:'4,000'}).perPiece,0.3);
    s.eq('junk input is a refusal',P.phGrossActual(null).ok,false);
    // the standard
    deq('a standard is cleaned',P.phStandard({unit:'KG',grossPerPiece:'0.3',tolerancePct:3}),{unit:'kg',grossPerPiece:0.3,tolerancePct:3,sizes:null});
    s.eq('a standard with no unit is refused',P.phStandard({grossPerPiece:0.3}),null);
    s.eq('a standard of 0 is refused',P.phStandard({unit:'kg',grossPerPiece:0}),null);
    s.eq('a negative tolerance is dropped',P.phStandard({unit:'kg',grossPerPiece:0.3,tolerancePct:-2}).tolerancePct,null);
    const std={unit:'kg',grossPerPiece:0.34,sizes:{S:0.28,M:0.30,L:0.32}};
    // (100*0.28 + 200*0.30 + 100*0.32) / 400 = (28+60+32)/400 = 0.30
    s.eq('expected gross weights each size by its own standard',P.phExpectedGross(std,{S:100,M:200,L:100}),0.3);
    // (100*0.28 + 100*0.34) / 200 = 0.31   (XL has no size line: the general figure)
    s.eq('a size with no line uses the general figure',P.phExpectedGross(std,{S:100,XL:100}),0.31);
    s.eq('a pieces count uses the general figure',P.phExpectedGross(std,250),0.34);
    s.eq('nothing cut: no expectation',P.phExpectedGross(std,{}),null);
    s.eq('no standard: no expectation',P.phExpectedGross(null,100),null);
    // variance: 0.315789 vs 0.30 = +5.263 % -> over (tolerance 3)
    const v=P.phGrossVariance(a,{unit:'kg',grossPerPiece:0.30,tolerancePct:3});
    deq('golden: 0.3158 against a standard of 0.30',[v.state,v.expected,v.gapPct],['over',0.3,5.26]);
    // edges, judged on the gap rounded to 0.01 %
    const at=x=>P.phGrossVariance(x,{unit:'kg',grossPerPiece:0.30,tolerancePct:3}).state;
    s.eq('exactly +3.00 % is within a 3 % tolerance',at(0.309),'within');
    s.eq('+3.03 % is over',at(0.3091),'over');
    s.eq('exactly -3.00 % is within',at(0.291),'within');
    s.eq('-3.03 % is under',at(0.2909),'under');
    s.eq('a gap of exactly 0 is within, and 0 is a real measurement here',P.phGrossVariance(0.30,{unit:'kg',grossPerPiece:0.30}).gapPct,0);
    // with no tolerance on the standard: over 3 %, under 5 % (settings defaults)
    const d=x=>P.phGrossVariance(x,{unit:'kg',grossPerPiece:0.30}).state;
    s.eq('default: +3.00 % within',d(0.309),'within');
    s.eq('default: +3.03 % over',d(0.3091),'over');
    s.eq('default: -5.00 % within (under tolerance is 5)',d(0.285),'within');
    s.eq('default: -5.03 % under',d(0.2849),'under');
    s.eq('default: -4 % within even though 4 > 3',d(0.288),'within');
    deq('NO standard is a state, never a zero',(r=>[r.state,r.expected,r.gap,r.gapPct])(P.phGrossVariance(0.3,null)),['nostandard',null,null,null]);
    s.eq('no actual figure',P.phGrossVariance(null,{unit:'kg',grossPerPiece:0.3}).state,'noactual');
    s.eq('an actual of 0 is no figure',P.phGrossVariance(0,{unit:'kg',grossPerPiece:0.3}).state,'noactual');
    s.eq('a result object with another unit than the standard',P.phGrossVariance({raw:0.3,unit:'m'},{unit:'kg',grossPerPiece:0.3}).state,'unit_mismatch');
    s.eq('per-size expectation is used when a cut is given',P.phGrossVariance(0.30,std,null,{cut:{S:100,M:200,L:100}}).expected,0.3);
    // benchmark: in-house 238 kg / 780 pieces = 0.30513; 0.315789 is +3.494 % -> 3.49
    const b=P.phGrossVariance(a,{unit:'kg',grossPerPiece:0.30},{perPiece:238/780,n:2});
    deq('golden benchmark: +3.49 % over the in-house average',[b.benchmark.gapPct,b.benchmark.state,b.benchmark.n],[3.49,'over',2]);
    s.eq('no benchmark is a state',P.phGrossVariance(a,{unit:'kg',grossPerPiece:0.3}).benchmark.state,'nobenchmark');
    s.eq('a benchmark of 0 is not a benchmark',P.phGrossVariance(a,{unit:'kg',grossPerPiece:0.3},0).benchmark.state,'nobenchmark');
    s.eq('a benchmark can be a bare number',P.phGrossVariance(0.33,{unit:'kg',grossPerPiece:0.3},0.30).benchmark.gapPct,10);
    s.eq('the benchmark still reads when there is no standard',P.phGrossVariance(0.33,null,0.30).benchmark.gapPct,10);
    s.eq('units normalise read-only: meter, metres, mtr',[P.phUnit('meter'),P.phUnit('Metres'),P.phUnit('mtr')].join(),'m,m,m');
    s.eq('kgs is kg',P.phUnit('KGS'),'kg');
    s.eq('yards is not a unit here',P.phUnit('yards'),null);
  }

  /* ── allocation ─────────────────────────────────────────────────────── */
  s.section('4  capacity and delay allocation');
  {
    const START='2026-10-12';                       // a Monday
    const al=(jobs,o)=>P.phAllocate(jobs,Object.assign({startDay:START},o||{}));
    // 399 fits one day with 1 to spare; 400 fills it; 401 spills 1.
    deq('399 units: one day, 399',al([{id:'A',qty:399}]).byId.A.segments,[{day:'2026-10-12',units:399}]);
    deq('400 units: one day, full',al([{id:'A',qty:400}]).byId.A.segments,[{day:'2026-10-12',units:400}]);
    deq('401 units: 400 then 1',al([{id:'A',qty:401}]).byId.A.segments,[{day:'2026-10-12',units:400},{day:'2026-10-13',units:1}]);
    // A takes 399, B takes the 1 left and 1 on the next day
    const ab=al([{id:'A',qty:399},{id:'B',qty:2}]);
    deq('399 then 2: B takes the last unit of day 1 then day 2',ab.byId.B.segments,[{day:'2026-10-12',units:1},{day:'2026-10-13',units:1}]);
    deq('day loads 400 and 1',ab.days.map(d=>d.units),[400,1]);
    // 1000 alone: 400 + 400 + 200
    const big=al([{id:'X',qty:1000}]).byId.X;
    deq('a job bigger than a day spans days: 400,400,200',big.segments.map(g=>g.units),[400,400,200]);
    deq('...on three consecutive days',[big.startDay,big.finishDay,big.spanDays],['2026-10-12','2026-10-14',3]);
    s.eq('capacity is an option',al([{id:'A',qty:250}],{capacity:100}).byId.A.segments.length,3);
    s.eq('capacity defaults from settings.dailyCapacity',al([{id:'A',qty:250}],{dailyCapacity:100}).byId.A.segments.length,3);
    s.eq('a junk capacity falls back to 400',al([{id:'A',qty:401}],{capacity:'lots'}).byId.A.segments.length,2);

    // Hand-computed fixture. Capacity 400, start Mon 12 Oct, Wed 14 Oct skipped.
    //  P1 prio 1, 700, requested 13th: 12th 400, 13th 300 -> finishes 13th, delay 0.
    //  P2 prio 2, 300, requested 13th: 13th has 100 free -> 100; the 14th is skipped; 15th 200 -> finishes 15th.
    //     delay = working days in (13th, 15th] = {15th} = 1 (calendar days 2).
    //  P3 prio 3, 450, requested 16th: 12th and 13th are full; 15th has 200 free -> 200; 16th 250 -> finishes 16th, delay 0.
    //  Loads: 12th 400, 13th 400, 15th 400, 16th 250.
    // They are passed in the WRONG order on purpose: priority decides, not the list order.
    const fx=al([
      {id:'P3',qty:450,priority:3,requestedDay:'2026-10-16'},
      {id:'P1',qty:700,priority:1,requestedDay:'2026-10-13'},
      {id:'P2',qty:300,priority:2,requestedDay:'2026-10-13'}
    ],{skipDays:['2026-10-14']});
    deq('priority order, not list order',fx.order,['P1','P2','P3']);
    deq('P1 segments',fx.byId.P1.segments,[{day:'2026-10-12',units:400},{day:'2026-10-13',units:300}]);
    deq('P2 segments (the 14th is skipped)',fx.byId.P2.segments,[{day:'2026-10-13',units:100},{day:'2026-10-15',units:200}]);
    deq('P3 segments',fx.byId.P3.segments,[{day:'2026-10-15',units:200},{day:'2026-10-16',units:250}]);
    deq('delay: P1 0 (on time, a real zero), P2 1 working day, P3 0',[fx.byId.P1.delayDays,fx.byId.P2.delayDays,fx.byId.P3.delayDays],[0,1,0]);
    s.eq('P2 is 2 calendar days late',fx.byId.P2.delayCalendarDays,2);
    deq('late flags',[fx.byId.P1.late,fx.byId.P2.late,fx.byId.P3.late],[false,true,false]);
    deq('day loads',fx.days.map(d=>d.day+':'+d.units).join(),['2026-10-12:400','2026-10-13:400','2026-10-15:400','2026-10-16:250'].join());
    s.eq('no day is over capacity',fx.days.every(d=>d.units<=d.capacity),true);
    s.eq('nothing is left unscheduled',fx.allScheduled,true);
    s.eq('P2 spans 2 workdays (13th and 15th)',fx.byId.P2.spanDays,2);
    // a job with no requested day has no delay figure, not 0
    deq('no requested day: delay is null, not 0',(r=>[r.delayDays,r.late])(al([{id:'A',qty:10}]).byId.A),[null,null]);
    deq('an early finish is a negative delay',al([{id:'A',qty:10,requestedDay:'2026-10-15'}]).byId.A.delayDays,-3);
    // off weekday: start Saturday 10 Oct, Sunday off, 500 units: Sat 400, (Sun skipped), Mon 100
    const sat=P.phAllocate([{id:'S',qty:500}],{startDay:'2026-10-10',offWeekdays:[0]});
    deq('a weekly off-day is skipped',sat.byId.S.segments,[{day:'2026-10-10',units:400},{day:'2026-10-12',units:100}]);
    s.eq('a start on an off-day moves to the next workday',P.phAllocate([{id:'S',qty:5}],{startDay:'2026-10-11',offWeekdays:[0]}).byId.S.startDay,'2026-10-12');
    s.eq('earliestDay holds a job back (fabric not out yet)',al([{id:'A',qty:5,earliestDay:'2026-10-14'}]).byId.A.startDay,'2026-10-14');
    s.eq('an earliestDay before the start is ignored',al([{id:'A',qty:5,earliestDay:'2026-10-01'}]).byId.A.startDay,'2026-10-12');
    // ties: same priority -> earlier requested day first, then id
    deq('same priority: the earlier requested day goes first',al([{id:'B',qty:5,requestedDay:'2026-10-20'},{id:'A',qty:5,requestedDay:'2026-10-25'}]).order,['B','A']);
    deq('same priority and day: the id decides',al([{id:'b',qty:5},{id:'a',qty:5}]).order,['a','b']);
    deq('a job with no priority goes after numbered ones',al([{id:'A',qty:5},{id:'Z',qty:5,priority:9}]).order,['Z','A']);
    const shuffled=[{id:'C',qty:120,priority:2},{id:'A',qty:310,priority:1},{id:'B',qty:200,priority:2},{id:'D',qty:90}];
    const r1=J(al(shuffled)),r2=J(al(shuffled.slice().reverse())),r3=J(al([shuffled[2],shuffled[0],shuffled[3],shuffled[1]]));
    s.ok('deterministic: any input order gives the same schedule',r1===r2&&r2===r3);
    // refusals
    const bad=al([{id:'Q',qty:0},{id:'R',qty:1.5},{id:'S',qty:'x'},{id:'',qty:5},{id:'D',qty:5},{id:'D',qty:7},null,'x',{id:'ok',qty:3}]);
    deq('unplaceable jobs are listed with a reason',bad.unscheduled.map(u=>u.id+':'+u.reason),
      ['Q:bad_qty','R:bad_qty','S:bad_qty','#3:no_id','D:duplicate_id','#6:not_an_object','#7:not_an_object']);
    deq('the placeable ones are still placed',bad.order,['D','ok']);
    s.eq('...and allScheduled says it was not all',bad.allScheduled,false);
    deq('a bad start day is a refusal',(r=>[r.ok,r.reason])(P.phAllocate([{id:'A',qty:5}],{startDay:'soon'})),[false,'bad_start_day']);
    deq('jobs that are not a list are a refusal',(r=>[r.ok,r.reason])(P.phAllocate('x',{startDay:START})),[false,'jobs_not_a_list']);
    deq('no jobs is fine and empty',(r=>[r.ok,r.order.length,r.days.length])(al([])),[true,0,0]);
    const skips=[];let d=START;for(let i=0;i<4000;i++){skips.push(d);d=P.phDayAdd(d,1);}
    deq('a calendar with no working day inside the horizon cannot place a job: listed, not looped',
      al([{id:'A',qty:5}],{skipDays:skips}).unscheduled.map(u=>u.reason),['horizon']);
    s.eq('a job id that looks like a prototype key is safe',al([{id:'__proto__',qty:5}]).byId['__proto__'].qty,5);
  }

  /* ── masters ────────────────────────────────────────────────────────── */
  s.section('5  masters: registry, key, daily and weekly log');
  {
    s.eq('key is lower-case',P.phMasterKey('ALAM'),'alam');
    s.eq('key ignores leading and trailing spaces',P.phMasterKey('  Alam '),'alam');
    s.eq('key collapses runs of spaces',P.phMasterKey('Muhammad    Ali'),'muhammad ali');
    s.eq('key is capped at 40',P.phMasterKey('x'.repeat(60)).length,40);
    s.eq('a name that ends on a space at the cap is trimmed',P.phMasterKey('a'.repeat(39)+' b'),'a'.repeat(39));
    s.eq('junk has an empty key',P.phMasterKey(null),'');
    deq('registry entry',P.phMasterEntry({id:'CM-001',name:' Alam ',active:true}),{id:'CM-001',name:'Alam',key:'alam',active:true});
    s.eq('active defaults to true',(P.phMasterEntry({id:'CM-9',name:'X'})||{}).active,true);
    s.eq('active:false is retired',(P.phMasterEntry({id:'CM-9',name:'X',active:false})||{}).active,false);
    s.eq('an entry with no id is no entry',P.phMasterEntry({name:'X'}),null);
    const reg=[{id:'CM-002',name:' Hassan ',active:true},{id:'CM-001',name:'Alam',active:true},{id:'CM-003',name:'Kashif',active:false}];
    s.eq('find by name, any case',(P.phMasterFind(reg,'ALAM')||{}).id,'CM-001');
    s.eq('find by id',(P.phMasterFind(reg,'CM-002')||{}).name,'Hassan');
    s.eq('find a name with stray spaces',(P.phMasterFind(reg,'  hassan')||{}).id,'CM-002');
    s.eq('not found is null',P.phMasterFind(reg,'Nobody'),null);
    s.eq('find in a non-list is null',P.phMasterFind(null,'Alam'),null);

    // Fixture. Standards: GST073 0.30 kg/pc, GD007 0.45 m/pc.
    const jobs=[
      {id:'j1',poId:'PO-1',master:'Alam',cutDay:'2026-10-05',cutUnits:380,fabricUsed:120,unit:'kg',articleCode:'GST073'}, // Mon
      {id:'j2',poId:'PO-2',master:'ALAM ',cutDay:'2026-10-07',cutUnits:400,fabricUsed:118,unit:'kg',articleCode:'GST073'}, // Wed
      {id:'j3',poId:'PO-3',master:'alam',cutDay:'2026-10-12',cutUnits:200,fabricUsed:90,unit:'meters',articleCode:'GD007'}, // next Mon
      {id:'j4',poId:'PO-4',master:'Hassan',cutDay:'2026-10-06',cutUnits:300,fabricUsed:100,unit:'kg',articleCode:'GST073'},
      {id:'j5',poId:'PO-5',master:'Alam',cutDay:'2026-10-11',cutUnits:100,articleCode:'GST073'}                          // Sun, no fabric
    ];
    const std={GST073:{unit:'kg',grossPerPiece:0.30},GD007:{unit:'m',grossPerPiece:0.45}};
    const log=P.phMasterLog(jobs,'alam',{from:'2026-10-05',to:'2026-10-18'},{standards:std});
    s.eq('the log is for the key, any case',log.masterKey,'alam');
    deq('daily rows are only the days with a cut, ascending',log.daily.map(r=>r.key),['2026-10-05','2026-10-07','2026-10-11','2026-10-12']);
    // 5 Oct: 380 pieces, 120 kg -> 0.3158; expected 380 x 0.30 = 114; (120-114)/114 = +5.26 % -> over (default tolerance 3)
    const d5=log.daily[0];
    deq('5 Oct: units, jobs, average',[d5.units,d5.jobs,d5.avgCutQty],[380,1,380]);
    deq('5 Oct: gross kg',d5.gross.kg,{fabric:120,pieces:380,perPiece:0.3158});
    deq('5 Oct: against the standard',[d5.vsStandard.kg.expectedFabric,d5.vsStandard.kg.gapPct,d5.vsStandard.kg.state],[114,5.26,'over']);
    // 7 Oct: 400 pieces, 118 kg = 0.295; expected 120; (118-120)/120 = -1.67 % -> within
    deq('7 Oct: gross and standard',[log.daily[1].gross.kg.perPiece,log.daily[1].vsStandard.kg.gapPct,log.daily[1].vsStandard.kg.state],[0.295,-1.67,'within']);
    // 11 Oct (Sunday): 100 pieces, no fabric recorded: no gross figure, not 0
    deq('11 Oct: a cut with no fabric recorded has no gross, and says so',[log.daily[2].units,log.daily[2].gross.kg,log.daily[2].noFabricJobs,log.daily[2].vsStandard.kg],[100,null,1,null]);
    // 12 Oct: 200 pieces, 90 m = 0.45; expected 90; gap 0 % within (a real zero)
    deq('12 Oct: metres are their own column',[log.daily[3].gross.m.perPiece,log.daily[3].gross.kg,log.daily[3].vsStandard.m.gapPct,log.daily[3].vsStandard.m.state],[0.45,null,0,'within']);
    deq('weekly rows are Mondays',log.weekly.map(r=>r.key),['2026-10-05','2026-10-12']);
    // week of the 5th: j1 + j2 + j5 (Sunday the 11th belongs to this week): units 380+400+100 = 880, jobs 3, avg 293.3
    const w1=log.weekly[0];
    deq('week of 5 Oct holds Mon, Wed and Sunday',[w1.units,w1.jobs,w1.avgCutQty],[880,3,293.3]);
    // kg: fabric 238 over 780 pieces (the 100 with no fabric are not in it) = 0.3051
    deq('week of 5 Oct: weighted gross, not a mean of means',w1.gross.kg,{fabric:238,pieces:780,perPiece:0.3051});
    // expected 114+120 = 234; (238-234)/234 = +1.71 % within; covered 780
    deq('week of 5 Oct: against the standard',[w1.vsStandard.kg.expectedFabric,w1.vsStandard.kg.gapPct,w1.vsStandard.kg.state,w1.vsStandard.kg.coveredPieces],[234,1.71,'within',780]);
    deq('week of 5 Oct ends on Sunday the 11th and is complete',[w1.weekEnd,w1.partial],['2026-10-11',false]);
    deq('week of 12 Oct ends Sunday the 18th and the range ends there too: complete',[log.weekly[1].weekEnd,log.weekly[1].partial],['2026-10-18',false]);
    // totals: 380+400+200+100 = 1080 over 4 jobs = 270
    deq('totals',[log.totals.units,log.totals.jobs,log.totals.avgCutQty,log.totals.gross.kg.perPiece,log.totals.gross.m.perPiece],[1080,4,270,0.3051,0.45]);
    s.eq('kg and m are never added: the kg pieces are only the kg jobs',log.totals.gross.kg.pieces,780);
    const cut=P.phMasterLog(jobs,'alam',{from:'2026-10-06',to:'2026-10-11'},{standards:std});
    deq('a narrower range leaves out the 5th and the 12th',cut.daily.map(r=>r.key),['2026-10-07','2026-10-11']);
    deq('...and the weeks it only partly covers are marked partial',cut.weekly.map(r=>[r.key,r.partial]),[['2026-10-05',true]]);
    const all=P.phMasterLog(jobs,null,{from:null,to:null},{standards:std});
    s.eq('no master key = every master together',all.totals.units,1380);
    const none=P.phMasterLog(jobs,'nobody',{from:'2026-10-05',to:'2026-10-18'});
    deq('a master with no cut: no data, null totals, no rows',[none.state,none.totals,none.daily.length],['no data',null,0]);
    deq('an empty job list is no data',[P.phMasterLog([],'alam',{}).state,P.phMasterLog(null,'alam',{}).totals],['no data',null]);
    deq('a reversed range is a refusal',(r=>[r.ok,r.reason])(P.phMasterLog(jobs,'alam',{from:'2026-10-18',to:'2026-10-05'})),[false,'bad_range']);
    const noStd=P.phMasterLog(jobs,'hassan',{from:'2026-10-01',to:'2026-10-31'});
    deq('fabric but no standard on file: the state says so (not a gap of 0)',[noStd.totals.vsStandard.kg.state,noStd.totals.vsStandard.kg.gapPct],['nostandard',null]);
    const sk=P.phMasterLog([{id:'a',master:'X',cutDay:'bad',cutUnits:5},{id:'b',master:'X',cutDay:'2026-10-05',cutUnits:0},{id:'c',master:'X',cutDay:'2026-10-05',cutUnits:5,cancelled:true},7],'x',{});
    deq('jobs that cannot be used are counted, not hidden',sk.skipped,{junk:1,cancelled:1,noDay:1,noUnits:1});
    // summary: one row per master, most units first
    const sum=P.phMastersSummary(jobs,{from:'2026-10-05',to:'2026-10-18'},{standards:std,masters:reg});
    deq('summary: Alam 1080 first, Hassan 300',sum.rows.map(r=>r.masterKey+':'+r.units),['alam:1080','hassan:300']);
    deq('summary names from the registry (Hassan has stray spaces there too)',sum.rows.map(r=>r.name),['Alam','Hassan']);
    deq('summary says both are registered',sum.rows.map(r=>r.registered),[true,true]);
    // Hassan: 100 kg / 300 = 0.3333; expected 90; (100-90)/90 = 11.11 % -> over
    deq('summary: Hassan against the standard',[sum.rows[1].gross.kg.perPiece,sum.rows[1].vsStandard.kg.gapPct,sum.rows[1].vsStandard.kg.state],[0.3333,11.11,'over']);
    const sum2=P.phMastersSummary(jobs.concat([{id:'j6',master:'Zed',cutDay:'2026-10-08',cutUnits:10}]),{},{masters:reg});
    deq('an unregistered name is shown and flagged',sum2.rows.filter(r=>r.masterKey==='zed').map(r=>[r.name,r.registered]),[['Zed',false]]);
    s.eq('without a registry, registered is unknown (null), not false',P.phMastersSummary(jobs,{}).rows[0].registered,null);
    s.eq('without a registry the name is the first one seen',P.phMastersSummary(jobs,{}).rows[0].name,'Alam');
    const big=P.phMastersSummary(jobs.concat([{id:'j7',master:'Zed',cutDay:'2026-10-08',cutUnits:2000},{id:'j8',master:'Bob',cutDay:'2026-10-08',cutUnits:300}]),{});
    deq('summary: most units first, equal units by key (Zed 2000, Alam 1080, then Bob and Hassan at 300 by key)',big.rows.map(r=>r.masterKey+':'+r.units),['zed:2000','alam:1080','bob:300','hassan:300']);
    deq('a job with no master is Unassigned',P.phMastersSummary([{id:'x',cutDay:'2026-10-05',cutUnits:5}],{}).rows.map(r=>r.name),['Unassigned']);
  }

  /* ── PO queue ───────────────────────────────────────────────────────── */
  s.section('6  PO queue: stage, pipeline, next action, lead time, delay gap');
  {
    const pos=fs.readFileSync(path.join(ROOT,'js/pos.js'),'utf8');
    const m=/const PO_REAL_STAGE_ORDER=\[([^\]]*)\]/.exec(pos);
    const posOrder=m?m[1].split(',').map(x=>x.replace(/['"\s]/g,'')).filter(Boolean):[];
    deq('the stage order is the one in js/pos.js (read from that file)',P.PH_REAL_STAGE_ORDER,posOrder);
    s.ok('js/pos.js still names a cancelled status "cancelled"',/const _PO_CANCELLED='cancelled'/.test(pos));
    // Compare the stage with pos.js's own poStatusOf for every non-cancelled shape.
    const sm=/const PO_STATUS=\{[^}]*\};/.exec(pos),fm=/function poStatusOf\(po\)\{[\s\S]*?\n\}/.exec(pos);
    if(sm&&fm){
      const poStatusOf=new Function(sm[0]+fm[0]+';return poStatusOf;')();
      const shapes=[{},{poStatus:'reserved',currentStage:null},{poStatus:'in_production',currentStage:'cutting'},{currentStage:'stitching'},
        {currentStage:'completed'},{poStatus:'complete',currentStage:'completed'},{poStatus:'in_production',currentStage:'washing'}];
      shapes.forEach(sh=>{
        const mine=P.phStageOf(sh),theirs=poStatusOf(sh);
        const same=theirs==='reserved'?mine==='reserved':theirs==='complete'?mine==='completed':P.PH_REAL_STAGE_ORDER.indexOf(mine)>=0;
        s.ok('phStageOf agrees with poStatusOf for '+J(sh),same,mine+' vs '+theirs);
      });
    }else s.ok('could read poStatusOf from js/pos.js',false);
    const st=x=>P.phStageOf(x);
    s.eq('not yet released',st({poStatus:'reserved',currentStage:null}),'reserved');
    s.eq('an old PO with nothing set is reserved',st({}),'reserved');
    s.eq('a live stage',st({poStatus:'in_production',currentStage:'printing'}),'printing');
    s.eq('a legacy PO with only a stage is in that stage',st({currentStage:'cutting'}),'cutting');
    s.eq('completed by stage',st({currentStage:'completed'}),'completed');
    s.eq('completed by status',st({poStatus:'complete'}),'completed');
    s.eq('cancelled wins over everything (cancelPO clears the stage)',st({poStatus:'cancelled',currentStage:null}),'cancelled');
    s.eq('cancelled with a leftover stage is still cancelled',st({poStatus:'cancelled',currentStage:'cutting'}),'cancelled');
    s.eq('a stage this core does not know is "unknown", not cutting',st({poStatus:'in_production',currentStage:'packing'}),'unknown');
    s.eq('in production with no stage is unknown',st({poStatus:'in_production'}),'unknown');
    s.eq('junk has no stage',st(null),null);
    // Units: ordered, or the ACTUAL cut once cut (cutAt + cutQty), never sizes standing in for it.
    deq('ordered quantity',P.phPoUnits({qty:400}),{units:400,basis:'ordered'});
    deq('actual cut once past cutting',P.phPoUnits({qty:400,currentStage:'bundling',cutAt:'2026-10-09T10:00:00.000Z',cutQty:{M:380}}),{units:380,basis:'cut'});
    deq('a cutQty with no cutAt is not an actual cut',P.phPoUnits({qty:400,currentStage:'bundling',cutQty:{M:380}}),{units:400,basis:'ordered'});
    deq('at cutting the order is what counts',P.phPoUnits({qty:400,currentStage:'cutting',cutAt:'2026-10-09T10:00:00.000Z',cutQty:{M:380}}),{units:400,basis:'ordered'});
    deq('sizes stand in for a missing qty',P.phPoUnits({sizes:{S:100,M:50}}),{units:150,basis:'ordered'});
    deq('nothing known: null',P.phPoUnits({}),{units:null,basis:null});

    // Pipeline fixture:
    //  A reserved 100 | B cutting 400 | C cutting 200 | D bundling 300 but cut 290 (140+150) | E stitching 500, no cut record
    //  F completed 250 cut 240 | G cancelled 999 | H unknown stage 50 | null (junk)
    // counts: reserved 1, cutting 2, bundling 1, stitching 1, completed 1; units: 100, 600, 290, 500, 240.
    // afloat = cutting..qc = 2+1+1 = 4 POs, 600+290+500 = 1390 pieces.
    const cutD={cutAt:'2026-10-09T10:00:00.000Z'};
    const fx=[
      {id:'A',poStatus:'reserved',currentStage:null,qty:100},
      {id:'B',poStatus:'in_production',currentStage:'cutting',qty:400},
      {id:'C',poStatus:'in_production',currentStage:'cutting',qty:200},
      Object.assign({id:'D',poStatus:'in_production',currentStage:'bundling',qty:300,cutQty:{S:140,M:150}},cutD),
      {id:'E',poStatus:'in_production',currentStage:'stitching',qty:500},
      Object.assign({id:'F',poStatus:'complete',currentStage:'completed',qty:250,cutQty:{M:240}},cutD),
      {id:'G',poStatus:'cancelled',currentStage:null,qty:999},
      {id:'H',poStatus:'in_production',currentStage:'packing',qty:50},
      null
    ];
    const pl=P.phPipeline(fx);
    deq('counts per stage',[pl.counts.reserved,pl.counts.cutting,pl.counts.bundling,pl.counts.stitching,pl.counts.printing,pl.counts.washing,pl.counts.qc,pl.counts.completed],[1,2,1,1,0,0,0,1]);
    deq('units per stage',[pl.units.reserved,pl.units.cutting,pl.units.bundling,pl.units.stitching,pl.units.completed],[100,600,290,500,240]);
    deq('units afloat: cutting to qc, 4 POs and 1390 pieces',[pl.afloat.pos,pl.afloat.units],[4,1390]);
    deq('cancelled is left out and counted; unknown and junk are counted apart',[pl.cancelled,pl.unknown,pl.junk],[1,1,1]);
    s.eq('the total is the live POs (7): the cancelled 999 is in no figure',pl.total,7);
    s.eq('cancelled units are in no stage',P.PH_STAGES.reduce((t,k)=>t+pl.units[k],0),1730);
    deq('no POs: no data, null counts (not a row of zeros)',(r=>[r.state,r.total,r.counts,r.afloat])(P.phPipeline([])),['no data',null,null,null]);
    deq('only cancelled POs is also no data',(r=>[r.state,r.cancelled])(P.phPipeline([{poStatus:'cancelled'}])),['no data',1]);
    deq('not a list is no data',P.phPipeline('x').state,'no data');
    // next action
    deq('reserved: release',(r=>[r.action,r.next])(P.phNextAction({poStatus:'reserved'})),['release','cutting']);
    s.eq('cutting with no fabric issue: issue the fabric',P.phNextAction({currentStage:'cutting'},{hasFabricIssue:false}).action,'issue_fabric');
    s.eq('cutting with fabric out: record the cut',P.phNextAction({currentStage:'cutting'},{hasFabricIssue:true}).action,'record_cut');
    s.eq('cutting, issue unknown: record the cut',P.phNextAction({currentStage:'cutting'}).action,'record_cut');
    deq('cutting goes to bundling next',P.phNextAction({currentStage:'cutting'}).next,'bundling');
    deq('bundling goes to stitching',P.phNextAction({currentStage:'bundling'}).next,'stitching');
    deq('stitching goes to PRINTING (the real order, not the display order)',P.phNextAction({currentStage:'stitching'}).next,'printing');
    deq('printing goes to washing',P.phNextAction({currentStage:'printing'}).next,'washing');
    deq('qc goes to completed',P.phNextAction({currentStage:'qc'}).next,'completed');
    s.eq('completed has no action',P.phNextAction({currentStage:'completed'}).action,null);
    s.eq('cancelled has no action and says blocked',P.phNextAction({poStatus:'cancelled'}).blocked,'cancelled');
    s.eq('an unknown stage asks for a review',P.phNextAction({currentStage:'packing'}).action,'review');
    s.eq('junk has no action',P.phNextAction(null).action,null);

    // Lead time. Issued 09:00 PKT on 5 Oct, cut 15:00 PKT on 9 Oct: 4 calendar days, 102.0 hours (4 d 6 h).
    const lt=P.phLeadTime({issuedAt:pkt('2026-10-05',9),cutAt:iso(pkt('2026-10-09',15))});
    deq('lead time: 4 days, 102 hours, late against a 3-day target',[lt.state,lt.days,lt.hours,lt.status],['cut',4,102,'late']);
    s.eq('exactly 3 days is ok',P.phLeadTime({issuedAt:pkt('2026-10-05',9),cutAt:iso(pkt('2026-10-08',9))}).status,'ok');
    s.eq('4 days is late',P.phLeadTime({issuedAt:pkt('2026-10-05',9),cutAt:iso(pkt('2026-10-09',9))}).status,'late');
    // across the PKT midnight: issued 00:30 PKT 6 Oct (= 19:30Z on the 5th), cut 15:00 PKT the same day: 0 days (UTC days would say 1)
    s.eq('issue at 00:30 PKT and cut that afternoon is 0 days, not 1',P.phLeadTime({issuedAt:pkt('2026-10-06',0,30),cutAt:iso(pkt('2026-10-06',15))}).days,0);
    deq('cut before issue is invalid and has no days (it must not be averaged)',(r=>[r.state,r.days,r.quality.indexOf('cut_before_issue')>=0])(P.phLeadTime({issuedAt:pkt('2026-10-09',9),cutAt:iso(pkt('2026-10-05',9))})),['invalid',null,true]);
    deq('no start: none, no days',(r=>[r.state,r.days])(P.phLeadTime({cutAt:iso(pkt('2026-10-05',9))})),['none',null]);
    s.eq('the first fabric issue from the caller beats the PO issue',P.phLeadTime({issuedAt:pkt('2026-10-01',9),cutAt:iso(pkt('2026-10-09',9))},{issueAt:pkt('2026-10-07',9)}).days,2);
    s.ok('a start taken from ts is marked',P.phLeadTime({ts:pkt('2026-10-05',9),cutAt:iso(pkt('2026-10-06',9))}).quality.indexOf('start_from_ts')>=0);
    const open=n=>P.phLeadTime({issuedAt:pkt('2026-10-05',9)},{now:pkt('2026-10-05',9)+n*86400000});
    deq('open PO age 3 days: ok',[open(3).state,open(3).ageDays,open(3).status],['open',3,'ok']);
    s.eq('open PO age 4 days: delayed',open(4).status,'delayed');
    s.eq('open PO age 6 days: delayed',open(6).status,'delayed');
    s.eq('open PO age 7 days: stuck',open(7).status,'stuck');
    s.eq('open with no clock given has no age (never 0)',P.phLeadTime({issuedAt:pkt('2026-10-05',9)}).ageDays,null);
    s.eq('a cancelled PO has no lead time',P.phLeadTime({poStatus:'cancelled',issuedAt:pkt('2026-10-05',9)}).state,'none');

    // Delay gap, planned 9 Oct.
    const gap=(cutMs,extra)=>P.phDelayGap(Object.assign({plannedCutDate:'2026-10-09',cutAt:iso(cutMs)},extra||{}));
    deq('cut on the planned day is on time, gap 0 (a real zero)',(r=>[r.state,r.days])(gap(pkt('2026-10-09',15))),['on_time',0]);
    deq('cut at 01:00 PKT on the 9th (= 20:00Z on the 8th) is the 9th: on time, not early',(r=>[r.state,r.days])(gap(pkt('2026-10-09',1))),['on_time',0]);
    deq('3 days after is late +3',(r=>[r.state,r.days])(gap(pkt('2026-10-12',10))),['late',3]);
    deq('2 days before is early -2',(r=>[r.state,r.days])(gap(pkt('2026-10-07',10))),['early',-2]);
    deq('no planned date: noplan, days null (not 0)',(r=>[r.state,r.days])(P.phDelayGap({cutAt:iso(pkt('2026-10-09',10))})),['noplan',null]);
    deq('open and past due: overdue by days',(r=>[r.state,r.days])(P.phDelayGap({plannedCutDate:'2026-10-09'},undefined,{today:'2026-10-12'})),['overdue',3]);
    deq('open on the planned day: not yet overdue',(r=>[r.state,r.days])(P.phDelayGap({plannedCutDate:'2026-10-09'},undefined,{today:'2026-10-09'})),['open',null]);
    deq('open, no clock: open',P.phDelayGap({plannedCutDate:'2026-10-09'}).state,'open');
    s.eq('the plan can be an allocation record (its finish day)',P.phDelayGap({cutAt:iso(pkt('2026-10-14',10))},{finishDay:'2026-10-13'}).days,1);
    s.eq('the plan can be given as an argument',P.phDelayGap({cutAt:iso(pkt('2026-10-14',10))},'2026-10-12').days,2);
    s.eq('against the requested date',P.phDelayGap({plannedCutDate:'2026-10-09',requestedDate:'2026-10-10',cutAt:iso(pkt('2026-10-12',10))}).vsRequested,2);
    s.eq('a cancelled PO has no gap',P.phDelayGap({poStatus:'cancelled',plannedCutDate:'2026-10-09'}).state,'cancelled');
  }

  /* ── completeness and PC-only ───────────────────────────────────────── */
  s.section('7  completeness gate and the PC-only heuristic');
  {
    const masters=[{id:'CM-001',name:'Alam',active:true},{id:'CM-003',name:'Kashif',active:false}];
    const base={code:'GST073',name:'Effortless Tee',qty:300,sizes:{S:100,M:200},fabric:'Single jersey 180gsm',plannedFabricQty:90,plannedFabricUnit:'kg',
      season:'winter',plannedCutDate:'2026-10-14',cutMaster:'alam',requestedDate:'2026-10-20'};
    const ctx={masters:masters,today:'2026-10-12'};
    const miss=(d,c)=>P.phPoComplete(d,c||ctx).missing.map(x=>x.field);
    const without=k=>{const d=Object.assign({},base);delete d[k];return d;};
    const good=P.phPoComplete(base,ctx);
    deq('a complete draft passes with nothing missing',[good.ok,good.missing.length],[true,0]);
    [['code','code'],['name','name'],['qty','qty'],['sizes','sizes'],['fabric','fabric'],['plannedFabricQty','plannedFabricQty'],['plannedFabricUnit','plannedFabricUnit'],
     ['season','season'],['plannedCutDate','plannedCutDate'],['cutMaster','cutMaster'],['requestedDate','requestedDate']].forEach(function(p){
      const r=P.phPoComplete(without(p[0]),ctx);
      s.ok('a draft without '+p[0]+' is not complete and names '+p[1],!r.ok&&r.missing.some(x=>x.field===p[1]),J(r.missing));
    });
    s.eq('every missing entry carries a reason a person can read',P.phPoComplete({},ctx).missing.every(x=>x.field&&x.why&&x.why.length>5),true);
    s.ok('a quantity that does not match the sizes is named',/add up to 300 but the quantity is 250/.test(P.phPoComplete(Object.assign({},base,{qty:250}),ctx).missing.map(x=>x.why).join()));
    s.ok('a size that does not exist is named',miss(Object.assign({},base,{sizes:{S:100,XXXL:200}})).indexOf('sizes')>=0);
    s.ok('all-zero sizes are not complete',miss(Object.assign({},base,{sizes:{S:0}})).indexOf('sizes')>=0);
    s.ok('a fractional quantity is not complete',miss(Object.assign({},base,{qty:300.5})).indexOf('qty')>=0);
    s.ok('a planned fabric quantity of 0 is missing',miss(Object.assign({},base,{plannedFabricQty:0})).indexOf('plannedFabricQty')>=0);
    s.ok('a fabric unit of yards is refused',miss(Object.assign({},base,{plannedFabricUnit:'yards'})).indexOf('plannedFabricUnit')>=0);
    const fn=Object.assign({},base,{fabricNeed:{qty:90,unit:'meters'}});delete fn.plannedFabricQty;delete fn.plannedFabricUnit;
    s.eq('the contract shape fabricNeed{qty,unit} also counts',P.phPoComplete(fn,ctx).ok,true);
    s.ok('a season that is not winter/summer/all is missing',miss(Object.assign({},base,{season:'autumn'})).indexOf('season')>=0);
    s.eq('a season the date merely suggests does NOT pass (it must be stated)',P.phPoComplete(without('season'),ctx).ok,false);
    s.ok('a planned date that is not a real day is missing',miss(Object.assign({},base,{plannedCutDate:'2026-02-30'})).indexOf('plannedCutDate')>=0);
    s.ok('a requested date that is not a real day is missing',miss(Object.assign({},base,{requestedDate:'next week'})).indexOf('requestedDate')>=0);
    s.ok('a master that is not in the registry is missing',miss(Object.assign({},base,{cutMaster:'Nobody'})).indexOf('cutMaster')>=0);
    s.ok('a retired master is refused',/retired/.test(P.phPoComplete(Object.assign({},base,{cutMaster:'Kashif'}),ctx).missing.map(x=>x.why).join()));
    s.eq('a master chosen by id passes',P.phPoComplete(Object.assign({},without('cutMaster'),{cutMasterId:'CM-001'}),ctx).ok,true);
    s.eq('master name matching ignores case and spaces',P.phPoComplete(Object.assign({},base,{cutMaster:'  ALAM '}),ctx).ok,true);
    s.ok('with no registry given the master cannot be checked, so it is NOT passed',miss(base,{today:'2026-10-12'}).indexOf('cutMaster')>=0);
    s.eq('a waist article takes waist sizes',P.phPoComplete(Object.assign({},base,{code:'GD007',sizes:{'30':100,'32':200}}),ctx).ok,true);
    s.eq('...and refuses alpha sizes',P.phPoComplete(Object.assign({},base,{code:'GD007'}),ctx).ok,false);
    s.eq('the size model used is reported',P.phPoComplete(Object.assign({},base,{code:'GD007',sizes:{'30':300}}),ctx).sizeModel,'waist');
    deq('a planned cut in the past warns (does not block)',(r=>[r.ok,r.warnings.map(w=>w.field)])(P.phPoComplete(Object.assign({},base,{plannedCutDate:'2026-10-10'}),ctx)),[true,['plannedCutDate']]);
    s.eq('a planned cut after the requested date warns',P.phPoComplete(Object.assign({},base,{plannedCutDate:'2026-10-25'}),ctx).warnings.length,1);
    s.eq('no today given: no past-date warning',P.phPoComplete(Object.assign({},base,{plannedCutDate:'2026-10-10'}),{masters:masters}).warnings.length,0);
    deq('not a draft at all',(r=>[r.ok,r.missing[0].field])(P.phPoComplete(null)),[false,'draft']);

    const WIN='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    const MAC='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const IPAD='Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const ANDTAB='Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    const ANDPH='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
    s.eq('Windows desktop, 1920 wide: a PC',P.phIsPcOnly(WIN,1920),true);
    s.eq('Mac desktop: a PC',P.phIsPcOnly(MAC,1440),true);
    s.eq('exactly 1024 wide passes',P.phIsPcOnly(WIN,1024),true);
    s.eq('1023 wide does not',P.phIsPcOnly(WIN,1023),false);
    s.eq('an iPhone is not a PC even in a wide window',P.phIsPcOnly(IPHONE,1920),false);
    s.eq('an iPad is not',P.phIsPcOnly(IPAD,1366),false);
    s.eq('an iPad agent without the word Mobile is still not (the iPad token itself)',P.phIsPcOnly('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Safari/604.1',1366),false);
    s.eq('an Android tablet (no "Mobile" in its agent) is not',P.phIsPcOnly(ANDTAB,1280),false);
    s.eq('an Android phone is not',P.phIsPcOnly(ANDPH,412),false);
    s.eq('unknown width fails closed',P.phIsPcOnly(WIN,undefined),false);
    s.eq('an unknown user agent fails closed',P.phIsPcOnly(undefined,1920),false);
    s.eq('NaN width fails closed',P.phIsPcOnly(WIN,NaN),false);
    s.eq('LIMITATION, stated: an iPad that sends a desktop (Macintosh) agent in a wide window passes',P.phIsPcOnly(MAC,1180),true);
  }

  /* ── cut gate ───────────────────────────────────────────────────────── */
  s.section('8  cut tolerance 70-130 %');
  {
    const v=(p,c,o)=>P.phCutVerdict(p,c,o);
    // planned 100: 70..130 inclusive
    s.eq('69 of 100 needs an override',v(100,69),'needs_override');
    s.eq('70 of 100 is ok',v(100,70),'ok');
    s.eq('100 of 100 is ok',v(100,100),'ok');
    s.eq('130 of 100 is ok',v(100,130),'ok');
    s.eq('131 of 100 needs an override',v(100,131),'needs_override');
    // planned 400: min ceil(280) = 280, max floor(520) = 520
    deq('planned 400: the range is 280..520',(r=>[r.min,r.max])(P.phCutRange(400)),[280,520]);
    s.eq('279 of 400',v(400,279),'needs_override');
    s.eq('280 of 400',v(400,280),'ok');
    s.eq('520 of 400',v(400,520),'ok');
    s.eq('521 of 400',v(400,521),'needs_override');
    // planned 15: min ceil(10.5) = 11, max floor(19.5) = 19  (lower rounds UP, upper DOWN)
    deq('planned 15: 11..19 (lower rounds up, upper down)',(r=>[r.min,r.max])(P.phCutRange(15)),[11,19]);
    s.eq('10 of 15 is below the gate',v(15,10),'needs_override');
    s.eq('20 of 15 is above it',v(15,20),'needs_override');
    s.eq('a cut of 0 is invalid',v(100,0),'invalid');
    s.eq('a negative cut is invalid',v(100,-5),'invalid');
    s.eq('a fractional cut is invalid',v(100,70.5),'invalid');
    s.eq('no planned quantity is invalid',v(0,50),'invalid');
    s.eq('a missing planned quantity is invalid',v(null,50),'invalid');
    s.eq('NaN is invalid',v(100,NaN),'invalid');
    s.eq('junk is invalid',v({},'x'),'invalid');
    s.eq('a quantity typed as a string is read',v('100','70'),'ok');
    s.eq('a custom gate [80,120]: 79',v(100,79,{gate:[80,120]}),'needs_override');
    s.eq('a custom gate [80,120]: 80',v(100,80,{gate:[80,120]}),'ok');
    s.eq('a custom gate [80,120]: 121',v(100,121,{gate:[80,120]}),'needs_override');
    s.eq('a junk gate does not switch the check off: 10 of 100 still needs an override',v(100,10,{gate:[0,1000]}),'needs_override');
    s.eq('a gate that is not a pair falls back to 70-130',v(100,69,{gate:'wide'}),'needs_override');
    // held equal to js/pos.js
    const pos=fs.readFileSync(path.join(ROOT,'js/pos.js'),'utf8');
    const gm=/const PO_CUT_GATE=\{min:([\d.]+),max:([\d.]+)\}/.exec(pos);
    s.ok('js/pos.js still has PO_CUT_GATE as {min,max}',!!gm);
    if(gm){
      const gate=[Math.round(+gm[1]*100),Math.round(+gm[2]*100)];
      deq('PH_CUT_GATE_PCT equals PO_CUT_GATE in js/pos.js (read from that file)',P.PH_CUT_GATE_PCT,gate);
      deq('the default settings gate equals it too',P.phSettings(null).cutGate,gate);
      let diff=0;
      for(let q=1;q<=3000;q++){
        // js/pos.js poCutRange: { min: Math.ceil(target*g.min), max: Math.floor(target*g.max) }
        const a={min:Math.ceil(q*+gm[1]),max:Math.floor(q*+gm[2])},b=P.phCutRange(q);
        if(a.min!==b.min||a.max!==b.max)diff++;
      }
      s.eq('phCutRange gives the same bounds as poCutRange for every planned quantity 1..3000',diff,0);
    }
  }

  /* ── report ─────────────────────────────────────────────────────────── */
  s.section('9  report roll-ups');
  {
    const pos=[
      {id:'PO-001',poStatus:'in_production',currentStage:'bundling',qty:400,ts:pkt('2026-10-05',9),issuedAt:pkt('2026-10-05',9),season:'winter',
        plannedCutDate:'2026-10-08',requestedDate:'2026-10-10',cutAt:iso(pkt('2026-10-09',15)),cutQty:{M:380}},
      {id:'PO-002',poStatus:'in_production',currentStage:'cutting',qty:200,ts:pkt('2026-10-06',10),season:'summer',seasonYear:2027,plannedCutDate:'2026-10-10'},
      {id:'PO-003',poStatus:'in_production',currentStage:'cutting',qty:600,ts:pkt('2026-10-07',11),plannedCutDate:'2026-10-07'},
      {id:'PO-004',poStatus:'cancelled',currentStage:null,qty:1000,ts:pkt('2026-10-05',12)},
      {id:'PO-005',poStatus:'reserved',currentStage:null,qty:100,ts:pkt('2026-10-20',10)}
    ];
    const jobs=[
      {id:'J1',poId:'PO-001',master:'Alam',cutDay:'2026-10-09',cutUnits:380,fabricUsed:120,unit:'kg',articleCode:'gst073'},
      {id:'J2',poId:'PO-004',master:'Hassan',cutDay:'2026-10-08',cutUnits:500,fabricUsed:150,unit:'kg',articleCode:'GST073'},     // a cancelled PO
      {id:'J3',poId:'PO-X',master:'  hassan ',cutDay:'2026-10-10',cutUnits:300,fabricUsed:100,unit:'kg',articleCode:'GST073'},
      {id:'J4',poId:'PO-003',master:'ALAM',cutDay:'2026-10-12',cutUnits:420,fabricUsed:126,unit:'kg',articleCode:'GST073'}
    ];
    const o={standards:{GST073:{unit:'kg',grossPerPiece:0.30}},masters:[{id:'CM-001',name:'Alam',active:true},{id:'CM-002',name:'Hassan',active:true}]};
    const R=P.phReport(pos,jobs,{from:'2026-10-05',to:'2026-10-12'},o);
    // pipeline (a snapshot of all POs): reserved 1, cutting 2 (200+600), bundling 1 (the actual cut 380); cancelled left out
    deq('pipeline counts',[R.pipeline.counts.reserved,R.pipeline.counts.cutting,R.pipeline.counts.bundling,R.pipeline.total,R.pipeline.cancelled],[1,2,1,4,1]);
    deq('units afloat: 200+600+380 over 3 POs',[R.unitsAfloat.pos,R.unitsAfloat.units],[3,1180]);
    // POs issued in range: PO-001, 002, 003 (PO-005 is on the 20th): (400+200+600)/3 = 400.0
    deq('average PO issue quantity',[R.avgPoIssueQty.n,R.avgPoIssueQty.value,R.avgPoIssueQty.total],[3,400,1200]);
    // seasons: PO-001 stored winter (upcoming winter from its planned 8 Oct = winter-2026); PO-003 no season -> by planned date 7 Oct = winter-2026, a guess; PO-002 summer 2027
    deq('season-wise: winter-2026 has 2 POs, 1000 pieces, 1 guessed; summer-2027 has 1 PO, 200',R.seasons.map(r=>[r.key,r.pos,r.units,r.guessed]),[['summer-2027',1,200,0],['winter-2026',2,1000,1]]);
    s.eq('...with a readable label',(R.seasons[1]||{}).label,'Winter 2026/27');
    // average cut: J1 380, J3 300, J4 420 (J2 belongs to the cancelled PO-004) = 1100 / 3 = 366.67 -> 366.7
    deq('average cut quantity leaves out the cancelled PO\'s cut',[R.avgCutQty.n,R.avgCutQty.value,R.cutTotal.units],[3,366.7,1100]);
    s.eq('the cancelled PO\'s cut record is counted as excluded',R.excluded.cancelledJobs,1);
    s.eq('the cancelled PO itself is counted as excluded',R.excluded.cancelledPos,1);
    // delay gap: only PO-001 was cut in range with a plan: cut 9 Oct vs planned 8 Oct = +1
    deq('delay gap: one PO, +1 day, late',[R.delayGap.n,R.delayGap.value,R.delayGap.late,R.delayGap.pctLate],[1,1,1,100]);
    // lead time: PO-001 issued 5 Oct 09:00, cut 9 Oct 15:00 = 4 days, late
    deq('lead time: 4 days',[R.leadTime.n,R.leadTime.value,R.leadTime.late],[1,4,1]);
    // per master: Alam 380+420 = 800 pieces over 2 jobs; Hassan 300
    deq('units cut per master, most first, names from the registry',R.unitsCutPerMaster.map(r=>[r.name,r.units,r.jobs,r.avgCutQty]),[['Alam',800,2,400],['Hassan',300,1,300]]);
    // Alam: 246 kg / 800 = 0.3075; expected 240; +2.5 % within.  Hassan: 100/300 = 0.3333; expected 90; +11.11 % over
    deq('gross per master against the benchmark',R.grossPerMaster.map(r=>[r.name,r.gross.kg.perPiece,r.vsStandard.kg.gapPct,r.vsStandard.kg.state]),
      [['Alam',0.3075,2.5,'within'],['Hassan',0.3333,11.11,'over']]);
    s.eq('overall state',R.state,'ok');
    // narrower range: 10..12 Oct. Cuts J3 (300) + J4 (420) = 360. No PO was issued in range, no PO was cut in range.
    const N=P.phReport(pos,jobs,{from:'2026-10-10',to:'2026-10-12'},o);
    deq('narrower range: average cut 360 over 2',[N.avgCutQty.n,N.avgCutQty.value],[2,360]);
    deq('no PO issued in range: no data, value null (NOT 0)',[N.avgPoIssueQty.n,N.avgPoIssueQty.value,N.avgPoIssueQty.state],[0,null,'no data']);
    deq('no PO cut in range: delay gap has no data, not 0',[N.delayGap.n,N.delayGap.value,N.delayGap.state,N.delayGap.late,N.delayGap.pctLate],[0,null,'no data',null,null]);
    deq('...and lead time',[N.leadTime.n,N.leadTime.value,N.leadTime.state],[0,null,'no data']);
    s.eq('the pipeline is a snapshot: the range does not change it',J(N.pipeline),J(R.pipeline));
    deq('no season rows when no PO was issued in range',N.seasons,[]);
    // open range
    const A=P.phReport(pos,jobs,{},o);
    s.eq('no range = every PO issued: 4 live POs',A.avgPoIssueQty.n,4);
    deq('PO-005 (qty 100) joins: (400+200+600+100)/4 = 325',A.avgPoIssueQty.value,325);
    // empty
    const E=P.phReport([],[],{from:'2026-10-05',to:'2026-10-12'});
    deq('empty input: explicit no data everywhere',[E.state,E.pipeline.state,E.pipeline.total,E.unitsAfloat,E.avgCutQty.value,E.avgCutQty.state,E.avgPoIssueQty.value,E.delayGap.value,E.leadTime.value,E.cutTotal.units,E.cutTotal.state],
      ['no data','no data',null,null,null,'no data',null,null,null,null,'no data']);
    deq('empty input: no master rows',[E.unitsCutPerMaster.length,E.grossPerMaster.length,E.seasons.length],[0,0,0]);
    s.eq('junk input does not throw and is no data',P.phReport(null,null,null).state,'no data');
    deq('a reversed range is a refusal',(r=>[r.ok,r.reason])(P.phReport(pos,jobs,{from:'2026-10-12',to:'2026-10-05'})),[false,'bad_range']);
    // the delay for a PO with a plan and a cut, others with no plan counted apart
    const p2=pos.concat([{id:'PO-006',poStatus:'in_production',currentStage:'bundling',qty:100,ts:pkt('2026-10-05',9),cutAt:iso(pkt('2026-10-10',9)),cutQty:{M:100}}]);
    const G=P.phReport(p2,jobs,{from:'2026-10-05',to:'2026-10-12'},o);
    deq('a cut PO with no planned date is counted apart, not as a zero gap',[G.delayGap.n,G.delayGap.noPlan],[1,1]);
    // season of a single PO with a stored 'all'
    deq('an all-season PO is its own row',P.phReport([{id:'P',poStatus:'in_production',currentStage:'cutting',qty:50,ts:pkt('2026-10-05',9),season:'all'}],[],{}).seasons.map(r=>[r.key,r.label]),[['all','All-season']]);
    deq('a PO with no season and no date is "unassigned", listed last',P.phReport([{id:'P',poStatus:'in_production',currentStage:'cutting',qty:50,ts:pkt('2026-10-05',9),season:'all'},{id:'Q',poStatus:'in_production',currentStage:'cutting',qty:60,createdAt:'x'}],[],{}).seasons.map(r=>r.key),['all']);
  }

  /* ── the module itself ──────────────────────────────────────────────── */
  s.section('the module: total, non-mutating, pure');
  {
    // total: every function, called with junk in every slot, must not throw
    const junk=[undefined,null,NaN,Infinity,-1,0,1.5,10n,'','x','2026-10-05',' ',{},[],[null],{a:{b:1}},()=>1,Symbol('s'),(function(){const c={};c.self=c;return c;})(),
      {id:'A',qty:5},[{id:'A',qty:5}],{from:'2026-10-05'},new Date(NaN)];
    const names=Object.keys(P).filter(k=>typeof P[k]==='function');
    const failed=[];let calls=0;
    names.forEach(function(n){
      const f=P[n];
      const tryIt=args=>{calls++;try{f.apply(null,args);}catch(e){failed.push(n+'('+args.map(a=>typeof a).join(',')+'): '+(e&&e.message));}};
      tryIt([]);
      junk.forEach(a=>tryIt([a]));
      junk.forEach(a=>junk.forEach(b=>tryIt([a,b])));
      // three- and four-argument functions: junk in each slot with the others valid-looking
      for(let i=0;i<junk.length;i++){
        tryIt([junk[i],'alam',{from:'2026-10-05'},{}]);tryIt(['x',junk[i],{from:'2026-10-05'},{}]);
        tryIt([[{id:'A',qty:5}],junk[i],junk[i]]);tryIt([junk[i],junk[i],junk[i]]);
        tryIt([{id:'A'},junk[i],junk[i],junk[i]]);tryIt([[],[],junk[i],junk[i]]);
      }
    });
    s.ok('every exported function ('+names.length+', '+calls+' calls) returns for junk and never throws',failed.length===0,failed.slice(0,3).join(' | '));

    // non-mutating: the fixtures are frozen (strict mode makes any write throw)
    const frozenIn=deepFreeze({
      pos:[{id:'PO-001',poStatus:'in_production',currentStage:'bundling',qty:400,ts:pkt('2026-10-05',9),season:'winter',plannedCutDate:'2026-10-08',cutAt:iso(pkt('2026-10-09',15)),cutQty:{M:380},sizes:{M:400}},
        {id:'PO-002',poStatus:'cancelled',qty:5}],
      jobs:[{id:'J1',poId:'PO-001',master:'Alam',cutDay:'2026-10-09',cutUnits:380,fabricUsed:120,unit:'kg',articleCode:'GST073'},{id:'J2',master:'Hassan',cutDay:'2026-10-09',cutUnits:10}],
      alloc:[{id:'B',qty:500,priority:2,requestedDay:'2026-10-14'},{id:'A',qty:700,priority:1}],
      opts:{startDay:'2026-10-12',skipDays:['2026-10-14'],offWeekdays:[0],standards:{GST073:{unit:'kg',grossPerPiece:0.3,sizes:{M:0.31}}},masters:[{id:'CM-001',name:'Alam',active:true}]},
      draft:{code:'GST073',name:'T',qty:5,sizes:{S:2,M:3},fabric:'f',plannedFabricQty:1,plannedFabricUnit:'kg',season:'winter',plannedCutDate:'2026-10-14',cutMaster:'Alam',requestedDate:'2026-10-20'}
    });
    const f=frozenIn,thrown=[];
    const run=(n,fn)=>{try{return J(fn());}catch(e){thrown.push(n+': '+e.message);return null;}};
    const results={
      alloc:run('phAllocate',()=>P.phAllocate(f.alloc,f.opts)),
      log:run('phMasterLog',()=>P.phMasterLog(f.jobs,'alam',{from:'2026-10-01',to:'2026-10-31'},f.opts)),
      sum:run('phMastersSummary',()=>P.phMastersSummary(f.jobs,{},f.opts)),
      pipe:run('phPipeline',()=>P.phPipeline(f.pos)),
      rep:run('phReport',()=>P.phReport(f.pos,f.jobs,{from:'2026-10-01',to:'2026-10-31'},f.opts)),
      comp:run('phPoComplete',()=>P.phPoComplete(f.draft,{masters:f.opts.masters,today:'2026-10-12'})),
      lead:run('phLeadTime',()=>P.phLeadTime(f.pos[0],{now:pkt('2026-10-20',9)})),
      gap:run('phDelayGap',()=>P.phDelayGap(f.pos[0],undefined,{today:'2026-10-20'})),
      seas:run('phSeasonOf',()=>P.phSeasonOf(f.pos[0])),
      size:run('phValidateSizes',()=>P.phValidateSizes('alpha',f.pos[0].sizes)),
      gross:run('phGrossVariance',()=>P.phGrossVariance(0.31,f.opts.standards.GST073,0.3,{cut:{M:5}})),
      next:run('phNextAction',()=>P.phNextAction(f.pos[0],{})),
      set:run('phSettings',()=>P.phSettings(f.opts)),
      std:run('phStandard',()=>P.phStandard(f.opts.standards.GST073)),
      find:run('phMasterFind',()=>P.phMasterFind(f.opts.masters,'alam'))
    };
    s.ok('no function wrote to a frozen input',thrown.length===0,thrown.join(' | '));
    s.ok('every one of them returned a value',Object.keys(results).every(k=>results[k]!==null&&results[k]!=='undefined'));
    const again=J(P.phAllocate(JSON.parse(J(f.alloc)),JSON.parse(J(f.opts))));
    s.eq('same answer from a thawed copy (no hidden state)',again,results.alloc);
    s.eq('calling twice gives the same answer (deterministic)',J(P.phReport(f.pos,f.jobs,{from:'2026-10-01',to:'2026-10-31'},f.opts)),results.rep);
    s.ok('the constants are frozen',Object.isFrozen(P.PH_DEFAULT_SETTINGS)&&Object.isFrozen(P.PH_SIZE_MODELS.alpha.keys)&&Object.isFrozen(P.PH_REAL_STAGE_ORDER));
    const setA=P.phSettings(null);setA.offWeekdays.push(3);
    s.eq('a returned settings object is a copy: changing it does not change the defaults',P.phSettings(null).offWeekdays.length,0);

    // pure: no clock, no randomness, no DOM, no Firestore, no session in its source
    const src=fs.readFileSync(path.join(ROOT,'js/ph-core.js'),'utf8');
    const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'').replace(/\/\/ .*$/gm,'');
    [['Date.now',/Date\.now\b/],['new Date()',/new Date\(\s*\)/],['Math.random',/Math\.random/],['toISOString',/toISOString|toLocale|getTimezoneOffset/],
     ['document',/\bdocument\b/],['window',/\bwindow\b/],['localStorage',/localStorage|sessionStorage/],['fetch',/\bfetch\s*\(/],
     ['Firestore',/getDoc|setDoc|updateDoc|runTransaction|writeBatch|onSnapshot|firebase/i],['session',/\bsession\b/],['console',/console\./]].forEach(function(p){
      s.ok('its code never touches '+p[0],!p[1].test(code),(code.match(p[1])||[])[0]);
    });
    // prefix: one shared lexical scope with every other classic script
    const tops=(code.match(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)||[]).map(x=>x.split(/\s+/)[1]);
    s.ok('it declares something at top level',tops.length>50,String(tops.length));
    const badNames=tops.filter(n=>!/^(_?ph[A-Z]|PH_)/.test(n));
    s.ok('every top-level name is ph / _ph / PH_ prefixed',badNames.length===0,badNames.join(','));
    // every public function is exported, and every export exists
    const declared=(code.match(/^function (ph[A-Z]\w*)/gm)||[]).map(x=>x.slice(9));
    const missing=declared.filter(n=>!(n in P));
    s.eq('every public function is exported',missing.join(','),'');
    // as a classic script it defines its globals and answers the same
    const app=harness.loadApp({files:['js/ph-core.js']});
    s.eq('as a classic script it defines its globals',app.run('typeof phReport+typeof PH_DEFAULT_SETTINGS+typeof phAllocate'),'functionobjectfunction');
    s.eq('and gives the same answer there',app.run("JSON.stringify(phAllocate([{id:'A',qty:401}],{startDay:'2026-10-12'}).days.map(d=>d.units))"),'[400,1]');
  }

  /* ── wiring ─────────────────────────────────────────────────────────── */
  s.section('wiring: script tag, precache, order');
  {
    const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
    const sw=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
    const iPh=html.indexOf('/js/ph-core.js'),iPb=html.indexOf('/js/prod-backup.js'),iMod=html.indexOf('<script type="module">');
    s.ok('index.html has the ph-core script tag with a ?v tag',/<script src="\/js\/ph-core\.js\?v=[^"]+"><\/script>/.test(html));
    s.ok('it comes after the last existing classic script (prod-backup.js)',iPh>iPb&&iPb>0);
    s.ok('and before the bootstrap module',iPh<iMod&&iMod>0);
    s.ok('it is in PRECACHE_URLS',/PRECACHE_URLS[\s\S]*'\/js\/ph-core\.js'/.test(sw));
    s.ok('CACHE_VERSION is past v309',(v=>v!==null&&+v>309)((/CACHE_VERSION = 'v(\d+)'/.exec(sw)||[])[1]||null));
  }
  return s;
};

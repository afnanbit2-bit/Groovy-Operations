/* ─────────────────────────────────────────────────────────────────────────
   js/ph-core.js — Production Ops (`ph`), the pure core (11 Oct 2026)

   PURE. No DOM, no Firestore, no session, and no clock: "now" and "today"
   are always parameters. Nothing here is called by the app yet; it is the
   one place the decisions of the new first-mile production model are
   written down, so the screens that arrive later only draw what this says.
   A Netlify function or a node test can `require` it (guarded export at the
   foot, the js/ma-core.js shape); in the browser it is a classic script.

   What it decides, once:
     1  seasons       winter = Oct-Jan, summer = Feb-Sep (the app's rule,
                      CLAUDE.md "Type & season feed"); a season stored on a
                      PO wins over a derived one
     2  gross         fabric consumed per piece cut, a standard per article,
                      the variance, a benchmark; "no standard" is a state,
                      never a zero
     3  size model    alpha / waist / free per article, and what a valid
                      size breakdown is (no PO_FLOW_SIZES change)
     4  capacity      400 pieces a day; spreading planned cuts over working
                      days in priority order; the delay against the date
                      the PO asked for
     5  masters       the registry shape, a case/space-insensitive key, the
                      daily and weekly log of each master
     6  PO queue      the stage of a PO over the real stage order, the
                      pipeline, the next action, lead time, delay gap;
                      cancelled POs are excluded everywhere
     7  completeness  what a PO must carry before it may be issued; the
                      PC-only heuristic
     8  cut gate      70-130 % of the planned quantity (the value of
                      PO_CUT_GATE in js/pos.js, held equal by a test)
     9  report        the roll-ups, for any date range

   Rules every function here keeps:
     - TOTAL: junk in gives a clear invalid / null result, never a throw.
     - Missing is null or the word 'no data', never a 0 that could be read
       as a measurement. A real zero (nothing late, a gap of 0.00 %) is 0.
     - A day is a PKT 'YYYY-MM-DD' string computed at a fixed UTC+5. The UTC
       day is wrong between midnight and 05:00 PKT and is never used.
     - Units are 'kg' and 'm' only; kg and m are never added together.
     - Inputs are never changed (tests freeze them).
     - Same input, same output: every order is broken by an id.

   Two delay conventions (do not mix them):
     - phAllocate: `delayDays` = signed WORKING days (weekly off-days and skip
       days do not count) from the requested day to the day the job finishes;
       `delayCalendarDays` = the same gap in calendar days. Both are on every
       allocated job that has a requested day.
     - phDelayGap / phLeadTime / phReport: calendar PKT days.
   Units afloat (owner decision 5, 10 Oct 2026): `afloat` = the ISSUED pieces
   (the ordered quantity as released) of released POs not yet cut done, i.e.
   stage 'cutting'. The wider figure cutting..qc, with the actual cut quantity
   once a PO is past cutting, is `inProduction`. phPipeline and phReport carry both.

   Everything global is prefixed ph / _ph / PH_ — these are classic scripts
   in ONE lexical scope (the `tb` lesson in CLAUDE.md), so a bare name that
   another file also declares takes the whole app down.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';

/* ── Constants (one block; a rule that changes changes here) ───────────── */
const PH_VERSION=1;
const PH_TZ_OFFSET_MIN=300;                       // Pakistan: fixed UTC+5, no DST
const PH_UNITS=Object.freeze(['kg','m']);
const PH_SEASON_VALUES=Object.freeze(['winter','summer','all']);
// SEASONS: winter Oct-Jan, summer Feb-Sep. The architect's contract said Oct-Feb; the
// OWNER's decision recorded in CLAUDE.md ("Type & season feed", Afnan, 6 Oct 2026: winter Oct-Jan, summer
// Feb-Sep, the same split js/shopify.js uses) wins. Do not change this to match the contract.
const PH_WINTER_MONTHS=Object.freeze([10,11,12,1]); // Oct..Jan
const PH_SUMMER_MONTHS=Object.freeze([2,3,4,5,6,7,8,9]); // Feb..Sep
const PH_SIZE_MODELS=Object.freeze({
  alpha:Object.freeze({label:'Alpha',keys:Object.freeze(['XXXS','XXS','XS','S','M','L','XL','2XL'])}),
  waist:Object.freeze({label:'Waist',keys:Object.freeze(['26','28','30','32','34','36','38','40'])}),
  free:Object.freeze({label:'Free size',keys:Object.freeze(['FREE'])})
});
const PH_WAIST_CODE_PREFIXES=Object.freeze(['GD','GJO','GC']); // js/patterns.js: denim, jorts, the 'GC' category
const PH_FREE_KEY='FREE';
// The stage order of the real production chain, as js/pos.js PO_REAL_STAGE_ORDER
// (a test reads that file and holds the two equal).
const PH_REAL_STAGE_ORDER=Object.freeze(['cutting','bundling','stitching','printing','washing','qc']);
const PH_STAGES=Object.freeze(['reserved'].concat(PH_REAL_STAGE_ORDER,['completed']));
const PH_CUT_GATE_PCT=Object.freeze([70,130]);    // = PO_CUT_GATE {min:0.7,max:1.3} in js/pos.js
const PH_PC_MIN_WIDTH=1024;
const PH_MASTER_NAME_MAX=40;                       // js/fabric.js _fabCutMasterNorm
const PH_MAX_HORIZON_DAYS=3650;                    // the allocator never looks further than ten years
const PH_MAX_SPAN_DAYS=20000;
const PH_MAX_DAY_NUM=2932896;                       // 9999-12-31 as a day number
const PH_DEFAULT_SETTINGS=Object.freeze({
  dailyCapacity:400,                // pieces a day (settings.dailyCapacity)
  cutGate:PH_CUT_GATE_PCT,
  offWeekdays:Object.freeze([]),    // 0=Sunday..6=Saturday; none by default
  skipDays:Object.freeze([]),       // explicit days with no work
  delayTargetDays:3,                // issue -> cut done
  stuckDays:7,
  grossOverTolPct:3,                // consumption above the standard by more than this
  grossUnderTolPct:5                // ... below it by more than this
});

/* ── Small helpers ──────────────────────────────────────────────────────── */
function _phObj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function _phHas(o,k){return _phObj(o)&&Object.prototype.hasOwnProperty.call(o,k);}
function phStr(x){return x==null?'':(typeof x==='symbol'?'':String(x));}
function phNum(x){
  if(typeof x==='number')return isFinite(x)?x:null;
  if(typeof x==='string'){
    let t=x.trim();
    // A single comma followed by one or two digits (and no dot) is a decimal comma: '1,5' = 1.5.
    // Three digits after a comma are a thousands group: '12,345' = 12345, '1,234,567' = 1234567.
    if(/^[-+]?\d+,\d{1,2}$/.test(t))t=t.replace(',','.');
    else t=t.replace(/,/g,'');
    if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t))return null;
    const n=Number(t);return isFinite(n)?n:null;
  }
  return null;
}
function phWhole(x){const n=phNum(x);return n!==null&&Math.floor(n)===n?(n===0?0:n):null;}
// Round half away from zero at dp places, without the 1.005 trap. Finite in, finite out (a value
// too large to have a fraction at dp places is returned as it is), and never -0.
function phRound(x,dp){
  const n=phNum(x);if(n===null)return null;
  const d=phWhole(dp);dp=d!==null&&d>=0&&d<=12?d:0;
  const s=n<0?-1:1,a=Math.abs(n),f=Math.pow(10,dp);
  if(a*f>=9007199254740992)return n===0?0:n;               // scaled past 2^53: no fraction left to round
  const str=String(a);
  let r;
  if(str.indexOf('e')>=0)r=Math.round(a*f)/f;               // tiny values (1e-7): the scaled product is safe here
  else r=Number(Math.round(Number(str+'e'+dp))+'e-'+dp);    // the scaled integer is < 2^53, so it prints without an exponent
  if(!isFinite(r))return n;
  return r===0?0:s*r;
}
function _phPad(n,w){let s=String(n);while(s.length<w)s='0'+s;return s;}
function phUnit(u){
  const v=phStr(u).trim().toLowerCase();
  if(v==='kg'||v==='kgs'||v==='kilogram'||v==='kilograms'||v==='kilo'||v==='kilos')return'kg';
  if(v==='m'||v==='mtr'||v==='mtrs'||v==='meter'||v==='meters'||v==='metre'||v==='metres')return'm';
  return null;
}
function _phSum(arr,fn){let t=0;for(let i=0;i<arr.length;i++){const v=fn?fn(arr[i]):arr[i];if(typeof v==='number'&&isFinite(v))t+=v;}return t;}
function _phSortedUnique(arr){return Array.from(new Set(arr)).sort(function(a,b){return a<b?-1:a>b?1:0;});}
function _phCmp(a,b){return a<b?-1:a>b?1:0;}

/* ── Dates (PKT, a fixed offset — never the UTC day) ────────────────────── */
function phIsDay(s){
  if(typeof s!=='string')return false;
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);if(!m)return false;
  const y=+m[1],mo=+m[2],d=+m[3];
  if(y<1900||y>9999||mo<1||mo>12||d<1)return false;
  const t=new Date(Date.UTC(y,mo-1,d));
  return t.getUTCFullYear()===y&&t.getUTCMonth()===mo-1&&t.getUTCDate()===d;
}
// Epoch ms from a number (>= 1e11, so a 10-digit seconds value is not guessed at),
// an ISO string, a Firestore-shaped {seconds} / {toMillis()}, or a Date.
// STRINGS: a date-time with an offset ('Z', '+05:00', '+0500') is read at that offset. A date-time
// with NO offset ('2026-10-05T23:30:00', '2026-10-05 01:30') is read as +05:00 (PKT) — never the
// process timezone. A date-only 'YYYY-MM-DD' is the PKT calendar day (its PKT midnight). Parsed by
// hand: Date.parse of a zone-less string depends on the machine's TZ, so it is not used.
function _phParseStr(s){
  const m=/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/.exec(s);
  if(!m)return null;
  if(!phIsDay(m[1]+'-'+m[2]+'-'+m[3]))return null;
  const hh=m[4]==null?0:+m[4],mi=m[5]==null?0:+m[5],ss=m[6]==null?0:+m[6];
  if(hh>23||mi>59||ss>59)return null;
  if(m[4]==null&&m[8]!=null)return null;                    // an offset on a bare date means nothing
  const frac=m[7]==null?0:Math.floor(+('0.'+m[7])*1000+1e-9);
  let off=PH_TZ_OFFSET_MIN;
  if(m[8]!=null){
    if(m[8]==='Z'||m[8]==='z')off=0;
    else{
      const sg=m[8][0]==='-'?-1:1,dg=m[8].slice(1).replace(':','');
      const oh=+dg.slice(0,2),om=dg.length>2?+dg.slice(2,4):0;
      if(oh>14||om>59)return null;
      off=sg*(oh*60+om);
    }
  }
  const t=Date.UTC(+m[1],+m[2]-1,+m[3],hh,mi,ss,frac)-off*60000;
  return isFinite(t)?t:null;
}
function phMs(x){
  if(x==null||x==='')return null;
  if(typeof x==='number')return isFinite(x)&&x>=1e11&&x<=8.64e15?x:null;
  if(typeof x==='string')return _phParseStr(x.trim());
  if(typeof x==='object'){
    if(Object.prototype.toString.call(x)==='[object Date]'){const t=x.getTime();return isFinite(t)?t:null;}
    if(typeof x.toMillis==='function'){
      try{const t=x.toMillis();return typeof t==='number'&&isFinite(t)?t:null;}catch(e){return null;}
    }
    if(typeof x.seconds==='number'&&isFinite(x.seconds)){
      const ns=typeof x.nanoseconds==='number'&&isFinite(x.nanoseconds)?x.nanoseconds/1e6:0;
      return Math.round(x.seconds*1000+ns);
    }
  }
  return null;
}
function _phFmtShifted(shiftedMs){
  const d=new Date(shiftedMs);
  const y=d.getUTCFullYear();
  if(!isFinite(d.getTime())||y<1900||y>9999)return null;
  return _phPad(y,4)+'-'+_phPad(d.getUTCMonth()+1,2)+'-'+_phPad(d.getUTCDate(),2);
}
// The PKT calendar day of a moment: phDay(Date.UTC(2026,9,4,20,30)) === '2026-10-05' (01:30 PKT).
// A day string passes through unchanged (if it is a real day).
function phDay(x){
  if(typeof x==='string'){const t=x.trim();if(/^\d{4}-\d{2}-\d{2}$/.test(t))return phIsDay(t)?t:null;}
  const ms=phMs(x);if(ms===null)return null;
  return _phFmtShifted(ms+PH_TZ_OFFSET_MIN*60000);
}
function phDayNum(day){
  if(!phIsDay(day))return null;
  return Math.round(Date.UTC(+day.slice(0,4),+day.slice(5,7)-1,+day.slice(8,10))/86400000);
}
function phDayFromNum(n){
  if(typeof n!=='number'||!isFinite(n)||Math.floor(n)!==n||n<-25567||n>2932896)return null;
  return _phFmtShifted(n*86400000);
}
function phDayAdd(day,n){
  const dn=phDayNum(day),k=phWhole(n);
  if(dn===null||k===null)return null;
  return phDayFromNum(dn+k);
}
function phDaysBetween(a,b){const x=phDayNum(a),y=phDayNum(b);return x===null||y===null?null:y-x;}
function _phWdayOfNum(n){return((n+4)%7+7)%7;}        // 1970-01-01 was a Thursday
function phWeekday(day){const n=phDayNum(day);return n===null?null:_phWdayOfNum(n);}  // 0=Sunday
// The Monday of the week a day is in (weeks start Monday; Sat/Sun are the end of the week).
function phWeekStart(day){
  const n=phDayNum(day);if(n===null)return null;
  return phDayFromNum(n-((_phWdayOfNum(n)+6)%7));
}

/* ── Settings (merge + clamp) and the working calendar ──────────────────── */
// The cut gate in whole percent. Accepted shapes: {minPct,maxPct}, [lo,hi] in percent, and the
// app's fraction shape {min:0.7,max:1.3} (js/pos.js PO_CUT_GATE, converted). Anything not sane
// falls back to 70-130 — a junk value must not switch the check off — and says so:
// -> {gate:[lo,hi], fallback:bool}. Nothing supplied (null / undefined) is the default, not a fallback.
function _phGateRead(g){
  if(g==null)return{gate:PH_CUT_GATE_PCT.slice(),fallback:false};
  let lo=null,hi=null;
  if(Array.isArray(g)&&g.length===2){lo=phWhole(g[0]);hi=phWhole(g[1]);}
  else if(_phObj(g)){
    if(g.minPct!=null||g.maxPct!=null){lo=phWhole(g.minPct);hi=phWhole(g.maxPct);}
    else if(g.min!=null||g.max!=null){
      const fl=phNum(g.min),fh=phNum(g.max);
      if(fl!==null&&fh!==null&&fl>0&&fl<=1&&fh>=1&&fh<=3){lo=phWhole(phRound(fl*100,6));hi=phWhole(phRound(fh*100,6));}
    }
  }
  if(lo!==null&&hi!==null&&lo>=50&&lo<100&&hi>100&&hi<=200)return{gate:[lo,hi],fallback:false};
  return{gate:PH_CUT_GATE_PCT.slice(),fallback:true};
}
function _phGateOf(g){return _phGateRead(g).gate;}
function _phBrief(x){
  if(x==null||typeof x==='number'||typeof x==='string'||typeof x==='boolean')return x==null?null:x;
  if(Array.isArray(x))return'list of '+x.length;
  return typeof x;
}
// Settings plus the list of what was REPLACED by a default because the value given was not usable
// (settingsFallback: [{field, given, used, why}]). A value not given at all is not a fallback.
function _phSettingsFb(raw){
  const r=_phObj(raw)?raw:{},D=PH_DEFAULT_SETTINGS,fb=[];
  const note=function(field,given,used,why){fb.push({field:field,given:_phBrief(given),used:used,why:why});};
  const capRaw=r.dailyCapacity!=null?r.dailyCapacity:r.capacity;
  const cap=phWhole(capRaw);
  let dailyCapacity=D.dailyCapacity;
  if(cap!==null&&cap>=1&&cap<=100000)dailyCapacity=cap;
  else if(capRaw!=null)note('dailyCapacity',capRaw,D.dailyCapacity,'the capacity must be a whole number from 1 to 100000');
  let off=[];
  if(Array.isArray(r.offWeekdays)){
    off=_phSortedUnique(r.offWeekdays.map(phWhole).filter(function(v){return v!==null&&v>=0&&v<=6;}));
    if(off.length>=7){note('offWeekdays',r.offWeekdays,[],'all seven weekdays off leaves no working day');off=[];}   // never a calendar with no working day
  }else if(r.offWeekdays!=null)note('offWeekdays',r.offWeekdays,[],'offWeekdays must be a list of weekday numbers 0-6');
  let skip=[];
  if(Array.isArray(r.skipDays))skip=_phSortedUnique(r.skipDays.slice(0,5000).map(function(d){return phIsDay(d)?d:null;}).filter(Boolean));
  const target=phWhole(r.delayTargetDays),stuck=phWhole(r.stuckDays);
  const okDelay=target!==null&&stuck!==null&&target>=0&&stuck>target;
  if(!okDelay&&(r.delayTargetDays!=null||r.stuckDays!=null))
    note('delayTargetDays/stuckDays',[r.delayTargetDays,r.stuckDays],[D.delayTargetDays,D.stuckDays],'the stuck limit must be a whole number above the delay target');
  const over=phNum(r.grossOverTolPct),under=phNum(r.grossUnderTolPct);
  const gate=_phGateRead(r.cutGate);
  if(gate.fallback)note('cutGate',r.cutGate,PH_CUT_GATE_PCT.slice(),'the gate is not a sane percent pair');
  const gOver=over!==null&&over>=0&&over<=100,gUnder=under!==null&&under>=0&&under<=100;
  if(!gOver&&r.grossOverTolPct!=null)note('grossOverTolPct',r.grossOverTolPct,D.grossOverTolPct,'a tolerance must be a percent from 0 to 100');
  if(!gUnder&&r.grossUnderTolPct!=null)note('grossUnderTolPct',r.grossUnderTolPct,D.grossUnderTolPct,'a tolerance must be a percent from 0 to 100');
  return{S:{
    dailyCapacity:dailyCapacity,
    cutGate:gate.gate,
    offWeekdays:off,
    skipDays:skip,
    delayTargetDays:okDelay?target:D.delayTargetDays,
    stuckDays:okDelay?stuck:D.stuckDays,
    grossOverTolPct:gOver?over:D.grossOverTolPct,
    grossUnderTolPct:gUnder?under:D.grossUnderTolPct
  },fallback:fb};
}
function phSettings(raw){return _phSettingsFb(raw).S;}
function _phCalSets(S){
  const skip=new Set();
  S.skipDays.forEach(function(d){const n=phDayNum(d);if(n!==null)skip.add(n);});
  return{off:new Set(S.offWeekdays),skip:skip};
}
function _phIsWorkNum(c,n){return!c.off.has(_phWdayOfNum(n))&&!c.skip.has(n);}
function _phNextWorkNum(c,n){
  for(let i=0;i<=PH_MAX_HORIZON_DAYS;i++){if(_phIsWorkNum(c,n+i))return n+i;}
  return null;
}
// Working day = not a weekly off-day and not an explicit skip day. cal is a settings-shaped object.
function phIsWorkday(day,cal){
  const d=phDay(day);if(d===null)return false;
  return _phIsWorkNum(_phCalSets(phSettings(cal)),phDayNum(d));
}
function phWorkdayNext(day,cal){
  const d=phDay(day);if(d===null)return null;
  const n=_phNextWorkNum(_phCalSets(phSettings(cal)),phDayNum(d));
  return n===null?null:phDayFromNum(n);
}
// WP10: the first working day on or after `from` that still has ROOM for `units` pieces (planned load + units <= daily capacity), looking up to
// `horizon` (default 120) days ahead. An empty day always counts (a PO bigger than a whole day's capacity still needs a day). `load` is a function
// day -> pieces already planned, or a plain {day:pieces} map; a day it cannot answer counts as empty. units unknown/0 = just the first working day.
// If no day within the horizon has room, the first working day is returned (a plan is never left without a default). null only for a bad `from`.
function phNextDayWithRoom(o){
  const x=o&&typeof o==='object'?o:{};
  const from=phDay(x.from);if(from===null)return null;
  const S=phSettings(x.settings||{});
  const cap=S.dailyCapacity;
  const u=phWhole(x.units);
  const horizon=Math.max(1,phWhole(x.horizon)||120);
  const loadOf=function(d){
    let l=0;
    try{l=typeof x.load==='function'?x.load(d):(x.load&&typeof x.load==='object'?x.load[d]:0);}catch(e){l=0;}
    return typeof l==='number'&&isFinite(l)&&l>0?l:0;
  };
  let first=null;
  for(let i=0;i<horizon;i++){
    const d=phDayAdd(from,i);if(d===null)break;
    if(!phIsWorkday(d,x.settings||{}))continue;
    if(first===null)first=d;
    const l=loadOf(d);
    if(u===null||u<=0||typeof cap!=='number'||!(cap>0)||l===0||l+u<=cap)return d;
  }
  return first;
}
// Signed working days from a to b: b after a counts the working days d with a < d <= b;
// b before a is the negative of the days with b < d <= a. Additive: wd(a,c) = wd(a,b) + wd(b,c).
function phWorkdaysBetween(a,b,cal){
  const x=phDayNum(phDay(a)),y=phDayNum(phDay(b));
  if(x===null||y===null||Math.abs(y-x)>PH_MAX_SPAN_DAYS)return null;
  return _phWorkdaysNum(_phCalSets(phSettings(cal)),x,y);
}
function _phWorkdaysNum(c,x,y){
  let n=0;
  if(y>x){for(let d=x+1;d<=y;d++)if(_phIsWorkNum(c,d))n++;return n;}
  if(y<x){for(let d=y+1;d<=x;d++)if(_phIsWorkNum(c,d))n--;return n;}
  return 0;
}

/* ── 1. Seasons ─────────────────────────────────────────────────────────── */
// winter = Oct, Nov, Dec, Jan; summer = Feb..Sep. A winter is named by the year its
// October falls in: 2027-01-15 is in winter-2026. (Afnan, 6 Oct 2026; js/shopify.js.)
function phSeasonKey(season,year){
  if(PH_SEASON_VALUES.indexOf(season)<0)return null;
  if(season==='all')return'all';
  const y=phWhole(year);
  return y!==null&&y>=1900&&y<=2200?season+'-'+y:season;   // year unknown: the bare season
}
function phSeasonOfDay(day){
  const d=phDay(day);
  if(d===null)return{season:null,year:null,key:null};
  const y=+d.slice(0,4),m=+d.slice(5,7);
  if(PH_WINTER_MONTHS.indexOf(m)>=0){const wy=m>=10?y:y-1;return{season:'winter',year:wy,key:'winter-'+wy};}  // January belongs to the winter that began the October before
  if(PH_SUMMER_MONTHS.indexOf(m)>=0)return{season:'summer',year:y,key:'summer-'+y};
  return{season:null,year:null,key:null};
}
// The year of a named season when only the season was stored: the one containing refDay,
// else the next one that starts after it (a winter garment cut in July is the UPCOMING winter).
function _phUpcomingYear(season,refDay){
  const s=phSeasonOfDay(refDay);if(s.season===null)return null;
  if(season==='winter')return s.year;                                // inside winter Y, or Feb-Sep of Y: winter Y starts in October
  return s.season==='summer'?s.year:s.year+1;                        // inside winter Y (Oct-Jan): summer starts in Feb of Y+1
}
function _phSeasonParseKey(k){
  const m=/^(winter|summer)-(\d{4})$/.exec(phStr(k).trim());
  return m?{season:m[1],year:+m[2]}:null;
}
function _phRefDay(po){
  const c=[po.plannedCutDate,po.issuedAt,po.ts,po.releasedAt,po.createdAt];
  for(let i=0;i<c.length;i++){const d=phDay(c[i]);if(d!==null)return d;}
  return null;
}
// phSeasonOf(day | ms | po) -> {season, year, key, source:'stored'|'date'|'none', guess}
// A season stored on a PO (season, with seasonYear or seasonKey) wins. Otherwise the season
// of the planned cut day (else the issue day), marked a guess: a winter garment is cut in
// July-September, so the date alone can mislabel it.
function phSeasonOf(x){
  const none={season:null,year:null,key:null,source:'none',guess:false};
  if(_phObj(x)){
    const st=phStr(x.season).trim().toLowerCase();
    const ref=_phRefDay(x);
    if(PH_SEASON_VALUES.indexOf(st)>=0){
      if(st==='all')return{season:'all',year:null,key:'all',source:'stored',guess:false};
      let y=phWhole(x.seasonYear);
      if(y===null||y<1900||y>2200){const p=_phSeasonParseKey(x.seasonKey);y=p&&p.season===st?p.year:null;}
      if(y===null&&ref!==null)y=_phUpcomingYear(st,ref);
      return{season:st,year:y,key:phSeasonKey(st,y),source:'stored',guess:false};
    }
    const p=_phSeasonParseKey(x.seasonKey);
    if(p)return{season:p.season,year:p.year,key:p.season+'-'+p.year,source:'stored',guess:false};
    if(ref===null)return none;
    const s=phSeasonOfDay(ref);
    return{season:s.season,year:s.year,key:s.key,source:'date',guess:true};
  }
  const d=phDay(x);
  if(d===null)return none;
  const s=phSeasonOfDay(d);
  return{season:s.season,year:s.year,key:s.key,source:'date',guess:true};
}
function phSeasonLabel(key){
  if(key==='all')return'All-season';
  const p=_phSeasonParseKey(key);
  if(p)return p.season==='winter'?'Winter '+p.year+'/'+_phPad((p.year+1)%100,2):'Summer '+p.year;
  if(key==='winter')return'Winter';
  if(key==='summer')return'Summer';
  return'No season';
}

/* ── 3. Size model ──────────────────────────────────────────────────────── */
// Canonical key of a size inside a model, or null. 'XXL' is read as '2XL' (the PO's spelling).
function phSizeKey(model,k){
  if(typeof model!=='string'||!_phHas(PH_SIZE_MODELS,model))return null;
  const s=phStr(k).trim().toUpperCase();
  if(model==='alpha'){const t=s==='XXL'?'2XL':s;return PH_SIZE_MODELS.alpha.keys.indexOf(t)>=0?t:null;}
  if(model==='waist')return PH_SIZE_MODELS.waist.keys.indexOf(s)>=0?s:null;
  if(model==='free')return s===PH_FREE_KEY?PH_FREE_KEY:null;
  return null;
}
// Which size axis an article uses: an explicit sizeModel / sizeAxis on the article ('none' = free),
// else the category prefix (denim GD, jorts GJO, GC are waist sizes; GCO, a co-ord, is not GC),
// else alpha. Returns {model, keys, source:'article'|'prefix'|'default'}.
function phSizeModel(article){
  const a=_phObj(article)?article:{};
  let m=phStr(a.sizeModel!=null&&a.sizeModel!==''?a.sizeModel:a.sizeAxis).trim().toLowerCase();
  if(m==='none')m='free';
  if(_phHas(PH_SIZE_MODELS,m))return{model:m,keys:PH_SIZE_MODELS[m].keys.slice(),source:'article'};   // own property only: 'constructor' / '__proto__' are not models
  const pre=/^([A-Z]+)/.exec(phStr(a.code).trim().toUpperCase());
  if(pre&&PH_WAIST_CODE_PREFIXES.indexOf(pre[1])>=0)return{model:'waist',keys:PH_SIZE_MODELS.waist.keys.slice(),source:'prefix'};
  return{model:'alpha',keys:PH_SIZE_MODELS.alpha.keys.slice(),source:'default'};
}
// A size breakdown is valid when every key is a known size of the model, every quantity is a
// whole number >= 0 (blank = 0), no size is given twice (XXL and 2XL), and at least one is > 0.
// model: 'alpha' | 'waist' | 'free' or the object phSizeModel returns.
function phValidateSizes(model,sizes){
  const name=_phObj(model)?phStr(model.model):phStr(model);
  const known=_phHas(PH_SIZE_MODELS,name);
  const out={ok:false,model:known?name:null,total:0,sizes:{},issues:[]};
  if(!known){out.issues.push({field:'sizeModel',why:'unknown size model'});return out;}
  if(!_phObj(sizes)){out.issues.push({field:'sizes',why:'sizes must be a list of size and quantity'});return out;}
  const got=new Map();
  Object.keys(sizes).sort().forEach(function(raw){
    const k=phSizeKey(name,raw);
    if(k===null){out.issues.push({field:'sizes',size:raw,why:'"'+raw+'" is not a size of this article ('+PH_SIZE_MODELS[name].label.toLowerCase()+')'});return;}
    const v=sizes[raw];
    const q=v===''||v==null?0:phWhole(v);
    if(q===null){out.issues.push({field:'sizes',size:k,why:k+': the quantity must be a whole number'});return;}
    if(q<0){out.issues.push({field:'sizes',size:k,why:k+': the quantity cannot be negative'});return;}
    if(got.has(k)){out.issues.push({field:'sizes',size:k,why:k+' is given twice'});return;}
    got.set(k,q);
  });
  PH_SIZE_MODELS[name].keys.forEach(function(k){if(got.has(k)){out.sizes[k]=got.get(k);out.total+=got.get(k);}});
  if(!out.issues.length&&out.total===0)out.issues.push({field:'sizes',why:'at least one size must be above zero'});
  out.ok=out.issues.length===0;
  return out;
}
// Sum of the usable (whole, >= 0) entries of a {size: qty} map; junk is ignored, not counted.
function phSizesTotal(sizes){
  if(!_phObj(sizes))return 0;
  let t=0;Object.keys(sizes).forEach(function(k){const q=phWhole(sizes[k]);if(q!==null&&q>0)t+=q;});
  return t;
}

/* ── 2. Gross: consumption per piece, the standard, the variance ────────── */
// Gross = fabric consumed / pieces cut, per unit (kg and m never mixed).
// phGrossActual({fabricUsed, cutUnits, unit}) -> {ok, perPiece (4 dp), raw, fabricUsed, cutUnits, unit, reason}
function phGrossActual(input){
  const i=_phObj(input)?input:{};
  const out={ok:false,perPiece:null,raw:null,fabricUsed:null,cutUnits:null,unit:null,reason:null};
  const unitGiven=i.unit!=null&&i.unit!=='';
  const unit=unitGiven?phUnit(i.unit):null;
  const f=phNum(i.fabricUsed),c=phWhole(i.cutUnits);
  out.fabricUsed=f;out.cutUnits=c;out.unit=unit;
  if(unitGiven&&unit===null){out.reason='bad_unit';return out;}
  if(c===null||c<=0){out.reason='no_pieces';return out;}
  if(f===null||f<=0){out.reason='no_fabric';return out;}
  if(unit===null){out.reason='no_unit';return out;}            // kg and m are never mixed: a figure with no unit is not a figure
  out.raw=f/c;out.perPiece=phRound(out.raw,4);out.ok=true;
  return out;
}
// A standard for one article: {unit, grossPerPiece, tolerancePct?, sizes?:{size: gross}}.
// Returns the cleaned standard or null. Idempotent.
function phStandard(raw){
  if(!_phObj(raw))return null;
  const unit=phUnit(raw.unit),g=phNum(raw.grossPerPiece);
  if(unit===null||g===null||g<=0)return null;
  const tol=phNum(raw.tolerancePct);
  let sizes=null;
  if(_phObj(raw.sizes)){
    sizes={};
    Object.keys(raw.sizes).sort().forEach(function(k){
      const v=phNum(raw.sizes[k]);
      if(v!==null&&v>0){const a=phSizeKey('alpha',k);sizes[a!==null?a:phStr(k).trim().toUpperCase()]=v;}
    });
    if(!Object.keys(sizes).length)sizes=null;
  }
  return{unit:unit,grossPerPiece:g,tolerancePct:tol!==null&&tol>=0&&tol<=100?tol:null,sizes:sizes};
}
// Expected consumption per piece for a cut: a pieces count uses grossPerPiece, a {size: qty} map
// weights each size by its own standard (a size without one uses grossPerPiece). null when unknown.
function phExpectedGross(standard,cut){
  const s=phStandard(standard);if(s===null)return null;
  const n=phWhole(cut);
  if(n!==null)return n>0?s.grossPerPiece:null;
  if(!_phObj(cut))return null;
  let pieces=0,fabric=0;
  Object.keys(cut).sort().forEach(function(k){
    const q=phWhole(cut[k]);if(q===null||q<=0)return;
    const a=phSizeKey('alpha',k),key=a!==null?a:phStr(k).trim().toUpperCase();
    const per=s.sizes&&_phHas(s.sizes,key)?s.sizes[key]:s.grossPerPiece;
    pieces+=q;fabric+=q*per;
  });
  return pieces>0?fabric/pieces:null;
}
// Actual consumption against the standard (and, when given, a benchmark such as the in-house
// average). The gap is judged rounded to 0.01 %, so exactly 3.00 % over is within a 3 % tolerance.
// states: 'within' | 'over' | 'under' | 'nostandard' | 'noactual' | 'unit_mismatch'
function phGrossVariance(actual,standard,benchmark,opts){
  const o=_phObj(opts)?opts:{};
  const S=phSettings(o.settings||o);
  const std=phStandard(standard);
  let a=null,aUnit=null;
  if(_phObj(actual)){a=phNum(actual.raw!=null?actual.raw:actual.perPiece);aUnit=phUnit(actual.unit);}
  else a=phNum(actual);
  if(a!==null&&a<=0)a=null;
  let b=null,bn=null;
  if(_phObj(benchmark)){b=phNum(benchmark.perPiece);bn=phWhole(benchmark.n);}else b=phNum(benchmark);
  if(b!==null&&b<=0)b=null;
  const res={state:null,expected:null,actual:a,gap:null,gapPct:null,tolerancePct:null,
    benchmark:{state:'nobenchmark',perPiece:null,n:null,gap:null,gapPct:null}};
  const tol=_phTolOf(std,S),over=tol.over,under=tol.under;
  res.tolerancePct={over:over,under:under};
  const judge=function(gapPct){return gapPct>over?'over':gapPct<-under?'under':'within';};
  if(b!==null&&a!==null){
    const bp=phRound((a-b)/b*100,2);
    res.benchmark={state:judge(bp),perPiece:b,n:bn,gap:phRound(a-b,4),gapPct:bp};
  }else if(b!==null){res.benchmark={state:'noactual',perPiece:b,n:bn,gap:null,gapPct:null};}
  if(std===null){res.state='nostandard';return res;}
  const exp=phExpectedGross(std,o.cut!=null?o.cut:1);
  res.expected=exp===null?std.grossPerPiece:exp;
  if(a===null){res.state='noactual';return res;}
  if(aUnit!==null&&aUnit!==std.unit){res.state='unit_mismatch';return res;}
  res.gap=phRound(a-res.expected,4);
  res.gapPct=phRound((a-res.expected)/res.expected*100,2);
  res.state=judge(res.gapPct);
  return res;
}

/* ── 5. Masters ─────────────────────────────────────────────────────────── */
function phNorm(s){return phStr(s).replace(/\s+/g,' ').trim().slice(0,PH_MASTER_NAME_MAX).trim();}
// Case- and space-insensitive: ' ALAM ' and 'alam' are one master; interior single spaces stay.
function phMasterKey(name){return phNorm(name).toLowerCase();}
// Registry entry (cutting_masters/{id}): {id, name, key, active} or null.
function phMasterEntry(raw){
  if(!_phObj(raw))return null;
  const name=phNorm(raw.name),id=phStr(raw.id).trim();
  if(!name||!id)return null;
  return{id:id,name:name,key:name.toLowerCase(),active:raw.active!==false};
}
function _phRegistry(list){
  const out=[];
  if(!Array.isArray(list))return out;
  list.forEach(function(r){const e=phMasterEntry(r);if(e)out.push(e);});
  return out.sort(function(a,b){return _phCmp(a.id,b.id);});
}
// Find a master in the registry by id or by name (key). Returns the entry or null.
function phMasterFind(registry,nameOrId){
  const reg=_phRegistry(registry);
  const id=phStr(nameOrId).trim(),key=phMasterKey(nameOrId);
  if(!id)return null;
  for(let i=0;i<reg.length;i++)if(reg[i].id===id)return reg[i];
  for(let j=0;j<reg.length;j++)if(reg[j].key===key)return reg[j];
  return null;
}

function _phStandardMap(standards){
  const m=Object.create(null);
  if(!_phObj(standards))return m;
  Object.keys(standards).forEach(function(k){const s=phStandard(standards[k]);if(s)m[phStr(k).trim().toUpperCase()]=s;});
  return m;
}
// The pieces in a {size: qty} map. When the article's size model is KNOWN (an explicit sizeModel /
// sizeAxis on art, or a waist-size category prefix) only the keys that are sizes of that model
// count, and every other key is listed in unknownSizes. When it is not known (the default alpha
// guess) every usable quantity counts, and unknownSizes lists the keys that are no size in ANY model.
// -> {total, any, unknownSizes[], model|null}
function _phCutSumX(o,art){
  const out={total:0,any:false,unknownSizes:[],model:null};
  if(!_phObj(o))return out;
  const sm=_phObj(art)?phSizeModel(art):null;
  const model=sm&&sm.source!=='default'?sm.model:null;
  out.model=model;
  Object.keys(o).sort().forEach(function(k){
    const q=phWhole(o[k]);
    const valid=model!==null?phSizeKey(model,k)!==null
      :(phSizeKey('alpha',k)!==null||phSizeKey('waist',k)!==null||phSizeKey('free',k)!==null);
    if(!valid)out.unknownSizes.push(phStr(k).trim()||phStr(k));
    if(q!==null&&q>0&&(model===null||valid)){out.total+=q;out.any=true;}
  });
  return out;
}
function _phCutSum(o,art){const x=_phCutSumX(o,art);return x.any?x.total:null;}
// A PO / job id compared case- and whitespace-insensitively ('po-004', ' PO 004 ' are one id).
function _phIdKey(x){return phStr(x).replace(/\s+/g,'').toUpperCase();}
// The set of cancelled PO ids: opts.cancelledPoIds (a list of ids) and the cancelled POs inside
// opts.pos / opts.cancelledPos (PO documents; their id and poId count).
function _phCancelledSet(o){
  const set=new Set();
  const add=function(x){const k=_phIdKey(x);if(k)set.add(k);};
  if(Array.isArray(o.cancelledPoIds))o.cancelledPoIds.forEach(add);
  [o.pos,o.cancelledPos].forEach(function(list){
    if(Array.isArray(list))list.forEach(function(p){if(_phObj(p)&&phStageOf(p)==='cancelled'){add(p.id);add(p.poId);}});
  });
  return set;
}
// One cut job -> {id, explicitId, poId, key, name, day, units, fabric, unit, code, cutBySize, cutBySizeTotal,
// unknownSizes[]} or {skip:reason}. A job is cancelled when it says so (cancelled / poStatus) or when
// its poId or id is a cancelled PO supplied in `cancelled`.
function _phJobNorm(j,cancelled){
  if(!_phObj(j))return{skip:'junk'};
  if(j.cancelled===true||phStr(j.poStatus)==='cancelled')return{skip:'cancelled'};
  if(cancelled&&cancelled.size&&(cancelled.has(_phIdKey(j.poId))||cancelled.has(_phIdKey(j.id))))return{skip:'cancelled'};
  const nameRaw=j.master!=null?j.master:(j.cutMaster!=null?j.cutMaster:j.cutMasterName);
  const name=phNorm(nameRaw);
  const key=j.masterKey!=null&&j.masterKey!==''?phMasterKey(j.masterKey):name.toLowerCase();
  const day=phDay(j.cutDay!=null?j.cutDay:j.cutAt);
  const code=phStr(j.articleCode!=null?j.articleCode:j.code).trim().toUpperCase();
  const art={code:code,sizeModel:j.sizeModel,sizeAxis:j.sizeAxis};
  const rawUnits=j.cutUnits!=null?j.cutUnits:(j.units!=null?j.units:j.cutQty);
  const unknown=[];
  let units;
  if(_phObj(rawUnits)){const x=_phCutSumX(rawUnits,art);units=x.any?x.total:null;x.unknownSizes.forEach(function(k){unknown.push(k);});}
  else units=phWhole(rawUnits);
  if(day===null)return{skip:'noDay'};
  if(units===null||units<=0)return{skip:'noUnits'};
  const f=phNum(j.fabricUsed),unit=phUnit(j.unit!=null?j.unit:j.fabricUnit);
  const cbs=_phObj(j.cutBySize)?j.cutBySize:(_phObj(j.cutQty)?j.cutQty:null);
  let cbsTotal=null;
  if(cbs){const x=_phCutSumX(cbs,art);cbsTotal=x.any?x.total:null;if(!_phObj(rawUnits))x.unknownSizes.forEach(function(k){unknown.push(k);});}
  const explicitId=phStr(j.id).trim();
  return{id:phStr(j.id!=null?j.id:j.poId).trim(),explicitId:explicitId,poId:phStr(j.poId).trim().toUpperCase(),key:key,name:name,day:day,units:units,
    fabric:f!==null&&f>0&&unit!==null?f:null,unit:unit,code:code,cutBySize:cbs,cutBySizeTotal:cbsTotal,unknownSizes:unknown};
}
function _phRangeOf(range){
  const r=_phObj(range)?range:{};
  const from=r.from==null||r.from===''?null:phDay(r.from),to=r.to==null||r.to===''?null:phDay(r.to);
  const bad=(r.from!=null&&r.from!==''&&from===null)||(r.to!=null&&r.to!==''&&to===null)||(from!==null&&to!==null&&from>to);
  return{from:from,to:to,bad:bad};
}
function _phInRange(day,rg){return day!==null&&(rg.from===null||day>=rg.from)&&(rg.to===null||day<=rg.to);}
function _phMean(sum,n,dp){return n>0?phRound(sum/n,dp):null;}
// The tolerance a standard is judged by, the ONE rule phGrossVariance and _phBucket share: the
// standard's own tolerancePct (both ways) when it has one, else the settings' over / under.
function _phTolOf(std,S){
  const own=std&&std.tolerancePct!=null?std.tolerancePct:null;
  return{over:own!==null?own:S.grossOverTolPct,under:own!==null?own:S.grossUnderTolPct};
}
// One bucket's figures: units, jobs, average cut quantity, gross per unit, and the standard.
// vsStandard judges the whole bucket's gap with the expected-fabric-weighted tolerance of the
// standards of the jobs it covers: one standard (or one job) is exactly phGrossVariance's tolerance.
function _phBucket(jobs,stdMap,S){
  const units=_phSum(jobs,function(j){return j.units;});
  const out={jobs:jobs.length,jobIds:_phSortedUnique(jobs.map(function(j){return j.id||j.poId;}).filter(Boolean)),units:units,
    avgCutQty:_phMean(units,jobs.length,1),gross:{kg:null,m:null},vsStandard:{kg:null,m:null},noFabricJobs:0,
    unknownSizes:_phSortedUnique(_phFlat(jobs.map(function(j){return j.unknownSizes||[];})))};
  out.noFabricJobs=jobs.filter(function(j){return j.fabric===null;}).length;
  PH_UNITS.forEach(function(u){
    const withF=jobs.filter(function(j){return j.unit===u&&j.fabric!==null;});
    if(!withF.length)return;
    const fabric=_phSum(withF,function(j){return j.fabric;}),pieces=_phSum(withF,function(j){return j.units;});
    out.gross[u]={fabric:phRound(fabric,3),pieces:pieces,perPiece:phRound(fabric/pieces,4)};
    let exp=0,act=0,cov=0,tOver=0,tUnder=0;
    withF.forEach(function(j){
      const s=stdMap[j.code];if(!s||s.unit!==u)return;
      const e=phExpectedGross(s,j.cutBySize&&j.cutBySizeTotal===j.units?j.cutBySize:j.units);
      if(e===null)return;
      const t=_phTolOf(s,S);
      exp+=e*j.units;act+=j.fabric;cov+=j.units;
      tOver+=t.over*e*j.units;tUnder+=t.under*e*j.units;
    });
    if(cov===0){out.vsStandard[u]={unit:u,state:'nostandard',expectedFabric:null,actualFabric:null,gapPct:null,coveredPieces:0,totalPieces:pieces};return;}
    const gp=phRound((act-exp)/exp*100,2);
    const over=phRound(tOver/exp,6),under=phRound(tUnder/exp,6);
    out.vsStandard[u]={unit:u,state:gp>over?'over':gp<-under?'under':'within',tolerancePct:{over:over,under:under},
      expectedFabric:phRound(exp,3),actualFabric:phRound(act,3),gapPct:gp,coveredPieces:cov,totalPieces:pieces};
  });
  return out;
}
function _phFlat(lists){const out=[];lists.forEach(function(l){l.forEach(function(x){out.push(x);});});return out;}
// Every usable job, in day / id order. A job id given twice (an explicit `id`) counts ONCE — the first
// by that order — and the rest are counted in `duplicateJobs` (over all days, so a range does not
// change which copy survives). Jobs with no explicit id are never merged (two cuts of one PO are two jobs).
function _phJobsIn(jobs,masterKey,rg,cancelled){
  const out={list:[],skipped:{junk:0,cancelled:0,noDay:0,noUnits:0},duplicateJobs:0};
  if(!Array.isArray(jobs))return out;
  const mk=masterKey==null||masterKey===''?null:phMasterKey(masterKey);
  const all=[];
  jobs.forEach(function(raw){
    const j=_phJobNorm(raw,cancelled);
    if(j.skip){out.skipped[j.skip]++;return;}
    all.push(j);
  });
  all.sort(function(a,b){return _phCmp(a.day,b.day)||_phCmp(a.id,b.id)||_phCmp(a.key,b.key)||(a.units-b.units);});
  const seen=new Set();
  all.forEach(function(j){
    if(j.explicitId){
      if(seen.has(j.explicitId)){out.duplicateJobs++;return;}
      seen.add(j.explicitId);
    }
    if(!_phInRange(j.day,rg))return;
    if(mk!==null&&j.key!==mk)return;
    out.list.push(j);
  });
  return out;
}
// The log of a master (masterKey falsy = every master together) over a range: daily and weekly
// roll-ups, Monday-start weeks. Days and weeks with no cut are left out, not shown as zero.
// opts: {standards:{CODE:{unit,grossPerPiece,...}}, settings, cancelledPoIds | pos}. Jobs are
// {id|poId, master|masterKey, cutDay|cutAt, cutUnits (or a {size:qty} map), fabricUsed, unit, articleCode}.
// A job of a cancelled PO (flagged, or its poId / id in opts.cancelledPoIds / the cancelled POs of
// opts.pos) is left out; `duplicateJobs` is how many repeats of a job id were not counted.
function phMasterLog(jobs,masterKey,range,opts){
  const o=_phObj(opts)?opts:{},S=phSettings(o.settings||o),rg=_phRangeOf(range);
  const mk=masterKey==null||masterKey===''?null:phMasterKey(masterKey);
  const out={ok:true,reason:null,masterKey:mk,from:rg.from,to:rg.to,state:'no data',daily:[],weekly:[],totals:null,skipped:null,duplicateJobs:0};
  if(rg.bad){out.ok=false;out.reason='bad_range';return out;}
  const g=_phJobsIn(jobs,masterKey,rg,_phCancelledSet(o));
  out.skipped=g.skipped;out.duplicateJobs=g.duplicateJobs;
  const std=_phStandardMap(o.standards);
  const byDay=new Map(),byWeek=new Map();
  g.list.forEach(function(j){
    if(!byDay.has(j.day))byDay.set(j.day,[]);byDay.get(j.day).push(j);
    const w=phWeekStart(j.day);
    if(!byWeek.has(w))byWeek.set(w,[]);byWeek.get(w).push(j);
  });
  Array.from(byDay.keys()).sort().forEach(function(d){
    out.daily.push(Object.assign({key:d,day:d},_phBucket(byDay.get(d),std,S)));
  });
  Array.from(byWeek.keys()).sort().forEach(function(w){
    const end=phDayAdd(w,6);
    const partial=(rg.from!==null&&rg.from>w)||(rg.to!==null&&rg.to<end);
    out.weekly.push(Object.assign({key:w,weekStart:w,weekEnd:end,partial:partial},_phBucket(byWeek.get(w),std,S)));
  });
  if(g.list.length){out.totals=_phBucket(g.list,std,S);out.state='ok';}
  return out;
}
// One row per master over a range, most units first (key breaks ties). opts.masters is the
// registry: it gives the display name and says whether a name in the jobs is registered.
function phMastersSummary(jobs,range,opts){
  const o=_phObj(opts)?opts:{},S=phSettings(o.settings||o),rg=_phRangeOf(range);
  if(rg.bad)return{ok:false,reason:'bad_range',rows:[],duplicateJobs:0};
  const g=_phJobsIn(jobs,null,rg,_phCancelledSet(o)),std=_phStandardMap(o.standards);
  const reg=_phRegistry(o.masters),regOn=Array.isArray(o.masters);
  const groups=new Map();
  g.list.forEach(function(j){if(!groups.has(j.key))groups.set(j.key,[]);groups.get(j.key).push(j);});
  const rows=[];
  groups.forEach(function(list,key){
    const e=reg.filter(function(r){return r.key===key;})[0]||null;
    const disp=e?e.name:(list.map(function(j){return j.name;}).filter(Boolean)[0]||'');   // the list is in day, id order: the first name seen
    rows.push(Object.assign({masterKey:key,name:key===''?'Unassigned':disp,
      registered:regOn?(key===''?false:!!e):null},_phBucket(list,std,S)));
  });
  rows.sort(function(a,b){return(b.units-a.units)||_phCmp(a.masterKey,b.masterKey);});
  return{ok:true,reason:null,rows:rows,skipped:g.skipped,duplicateJobs:g.duplicateJobs};
}

/* ── 4. Capacity and delay allocation ───────────────────────────────────── */
// Spread planned cut quantities over working days, first by priority.
// jobs: [{id, qty, priority?, requestedDay?, earliestDay?}]  (lower priority number = sooner,
// none = after all numbered; ties go to the earlier requested day, then the id).
// opts: {startDay, capacity (default settings.dailyCapacity 400), offWeekdays, skipDays}.
// A job bigger than a day's capacity spans days; no day is ever loaded past capacity.
// delayDays is signed WORKING days from the requested day to the day the job finishes
// (> 0 late, 0 on time, < 0 early); delayCalendarDays is the same gap in calendar days; both are null
// when the job has no requested day. When the requested day is more than PH_MAX_HORIZON_DAYS away
// from the finish day the working-day count is NOT walked day by day: delayDays is null, the job
// carries delayReason 'requested_out_of_range' and delayCalendarDays still says how far. A job that
// cannot be placed is listed in `unscheduled` with the reason, never silently dropped.
// `settingsFallback` lists any setting given but replaced by a default (see _phSettingsFb).
function phAllocate(jobs,opts){
  const o=_phObj(opts)?opts:{},sf=_phSettingsFb(o),S=sf.S;
  const startDay=phDay(o.startDay);
  const out={ok:false,reason:null,capacity:S.dailyCapacity,startDay:startDay,allScheduled:false,order:[],days:[],jobs:[],byId:Object.create(null),unscheduled:[],settingsFallback:sf.fallback};
  if(startDay===null){out.reason='bad_start_day';return out;}
  if(!Array.isArray(jobs)){out.reason='jobs_not_a_list';return out;}
  const cal=_phCalSets(S),cap=S.dailyCapacity,startNum=phDayNum(startDay);
  const seen=new Set(),list=[];
  jobs.forEach(function(j,i){
    if(!_phObj(j)){out.unscheduled.push({id:'#'+i,reason:'not_an_object'});return;}
    const id=phStr(j.id).trim();
    if(!id){out.unscheduled.push({id:'#'+i,reason:'no_id'});return;}
    if(seen.has(id)){out.unscheduled.push({id:id,reason:'duplicate_id'});return;}
    seen.add(id);
    const qty=phWhole(j.qty!=null?j.qty:(j.plannedCutQty!=null?j.plannedCutQty:j.plannedQty));
    if(qty===null||qty<=0){out.unscheduled.push({id:id,reason:'bad_qty'});return;}
    const pr=phNum(j.priority);
    list.push({id:id,qty:qty,priority:pr,requestedDay:phDay(j.requestedDay!=null?j.requestedDay:j.requestedDate),earliestDay:phDay(j.earliestDay)});
  });
  list.sort(function(a,b){
    const pa=a.priority===null?Infinity:a.priority,pb=b.priority===null?Infinity:b.priority;
    if(pa!==pb)return pa<pb?-1:1;
    const ra=a.requestedDay===null?'9999-99-99':a.requestedDay,rb=b.requestedDay===null?'9999-99-99':b.requestedDay;
    return _phCmp(ra,rb)||_phCmp(a.id,b.id);
  });
  const load=new Map(),dayJobs=new Map();
  list.forEach(function(j){
    const earliest=j.earliestDay!==null?Math.max(startNum,phDayNum(j.earliestDay)):startNum;
    let n=_phNextWorkNum(cal,earliest);
    const segs=[];let rem=j.qty,steps=0,failed=n===null||n>PH_MAX_DAY_NUM;
    while(!failed&&rem>0){
      const free=cap-(load.get(n)||0);
      if(free>0){const u=Math.min(free,rem);segs.push({n:n,units:u});rem-=u;}
      if(rem>0){
        if(++steps>PH_MAX_HORIZON_DAYS){failed=true;break;}
        n=_phNextWorkNum(cal,n+1);
        if(n===null||n>PH_MAX_DAY_NUM)failed=true;
      }
    }
    if(failed){out.unscheduled.push({id:j.id,reason:'horizon'});return;}
    segs.forEach(function(s){load.set(s.n,(load.get(s.n)||0)+s.units);if(!dayJobs.has(s.n))dayJobs.set(s.n,[]);dayJobs.get(s.n).push(j.id);});
    const first=segs[0].n,last=segs[segs.length-1].n;
    const finishDay=phDayFromNum(last);
    const rec={id:j.id,qty:j.qty,priority:j.priority,requestedDay:j.requestedDay,
      segments:segs.map(function(s){return{day:phDayFromNum(s.n),units:s.units};}),
      startDay:phDayFromNum(first),finishDay:finishDay,spanDays:_phWorkdaysNum(cal,first-1,last),
      delayDays:null,delayCalendarDays:null,delayReason:null,late:null};
    if(j.requestedDay!==null){
      const rn=phDayNum(j.requestedDay);
      rec.delayCalendarDays=last-rn;
      if(Math.abs(last-rn)>PH_MAX_HORIZON_DAYS){rec.delayReason='requested_out_of_range';rec.late=rec.delayCalendarDays>0;}
      else{rec.delayDays=_phWorkdaysNum(cal,rn,last);rec.late=rec.delayDays>0;}
    }
    out.jobs.push(rec);out.byId[j.id]=rec;out.order.push(j.id);
  });
  Array.from(load.keys()).sort(function(a,b){return a-b;}).forEach(function(n){
    out.days.push({day:phDayFromNum(n),units:load.get(n),capacity:cap,free:cap-load.get(n),jobIds:dayJobs.get(n).slice()});
  });
  out.ok=true;out.allScheduled=out.unscheduled.length===0;
  return out;
}

/* ── 6. PO queue: stage, pipeline, next action, lead time, delay gap ────── */
// The stage of a PO, over PH_REAL_STAGE_ORDER: 'reserved' (not released), a real stage,
// 'completed', 'cancelled', or 'unknown' (a stage this core does not recognise — surfaced,
// never silently counted as cutting). Mirrors js/pos.js poStatusOf + currentStage.
function phStageOf(po){
  if(!_phObj(po))return null;
  const st=phStr(po.poStatus).trim(),cs=phStr(po.currentStage).trim();
  if(st==='cancelled')return'cancelled';
  if(st==='complete'||cs==='completed')return'completed';
  if(PH_REAL_STAGE_ORDER.indexOf(cs)>=0)return cs;
  if(cs)return'unknown';
  if(st===''||st==='reserved')return'reserved';
  return'unknown';
}
function _phHasActualCut(po){return phMs(po.cutAt)!==null&&_phCutSum(po.cutQty,_phPoArt(po))!==null;}
// Pieces a PO stands for: the ACTUAL cut once it is cut (cutAt and a cutQty map — never the
// ordered sizes standing in for it), else the ordered quantity. {units, basis:'cut'|'ordered'|null}.
// When a size map holds keys that are no size of the article, `unknownSizes` lists them (it is
// absent otherwise).
function _phPoArt(po){return{code:po.code!=null?po.code:po.articleCode,sizeModel:po.sizeModel,sizeAxis:po.sizeAxis};}
function phPoUnits(po){
  if(!_phObj(po))return{units:null,basis:null};
  const st=phStageOf(po),art=_phPoArt(po);
  const withUnknown=function(r,x){if(x.unknownSizes.length)r.unknownSizes=x.unknownSizes;return r;};
  if(st!=='reserved'&&st!=='cutting'&&_phHasActualCut(po)){
    const x=_phCutSumX(po.cutQty,art);
    return withUnknown({units:x.total,basis:'cut'},x);
  }
  const q=phWhole(po.qty);
  if(q!==null&&q>0)return{units:q,basis:'ordered'};
  const x=_phCutSumX(po.sizes,art);
  return x.any?withUnknown({units:x.total,basis:'ordered'},x):{units:null,basis:null};
}
// Counts and pieces per stage. Cancelled POs are left out of every figure and only counted
// (`cancelled`); `unknown` is the POs in a stage we do not recognise, and total = the sum of the
// stage counts + unknown (always). Two figures of pieces in flight, not to be confused:
//   afloat       = the ISSUED pieces (ordered quantity as released) of POs not yet cut done, i.e.
//                  stage 'cutting' (owner decision 5)
//   inProduction = pieces of POs from cutting to qc (released, not completed), the actual cut
//                  quantity counting once a PO is past cutting
function phPipeline(pos){
  const counts={},units={};
  PH_STAGES.forEach(function(s){counts[s]=0;units[s]=0;});
  const out={state:'no data',total:null,counts:null,units:null,afloat:null,inProduction:null,cancelled:0,unknown:0,unknownUnits:0,junk:0,noUnits:0};
  if(!Array.isArray(pos))return out;
  let total=0;
  pos.forEach(function(p){
    const st=phStageOf(p);
    if(st===null){out.junk++;return;}
    if(st==='cancelled'){out.cancelled++;return;}
    total++;
    const u=phPoUnits(p).units;
    if(st==='unknown'){out.unknown++;if(u!==null)out.unknownUnits+=u;return;}
    counts[st]++;
    if(u===null)out.noUnits++;else units[st]+=u;
  });
  if(total===0)return out;
  const ipStages=PH_REAL_STAGE_ORDER;
  out.state='ok';out.total=total;out.counts=counts;out.units=units;
  out.afloat={pos:counts.cutting,units:units.cutting,stages:['cutting']};
  out.inProduction={pos:_phSum(ipStages,function(s){return counts[s];}),units:_phSum(ipStages,function(s){return units[s];}),stages:ipStages.slice()};
  return out;
}
// What moves a PO forward. ctx.hasFabricIssue === false at cutting means the fabric is not out yet.
// -> {action, label, stage, next, blocked}
function phNextAction(po,ctx){
  const st=phStageOf(po);
  const c=_phObj(ctx)?ctx:{};
  const res={action:null,label:null,stage:st,next:null,blocked:null};
  if(st===null)return res;
  const i=PH_REAL_STAGE_ORDER.indexOf(st);
  if(i>=0)res.next=i+1<PH_REAL_STAGE_ORDER.length?PH_REAL_STAGE_ORDER[i+1]:'completed';
  if(st==='reserved'){res.action='release';res.label='Release to production';res.next='cutting';return res;}
  if(st==='cutting'){
    if(c.hasFabricIssue===false){res.action='issue_fabric';res.label='Issue the fabric';return res;}
    res.action='record_cut';res.label='Record the cut';return res;
  }
  if(st==='bundling'){res.action='complete_bundling';res.label='Complete bundling';return res;}
  if(st==='stitching'){res.action='complete_stitching';res.label='Complete stitching';return res;}
  if(st==='printing'){res.action='complete_printing';res.label='Complete printing';return res;}
  if(st==='washing'){res.action='complete_washing';res.label='Complete washing';return res;}
  if(st==='qc'){res.action='complete_qc';res.label='Complete final QC';return res;}
  if(st==='completed'){res.label='Done';return res;}
  if(st==='cancelled'){res.label='Cancelled';res.blocked='cancelled';return res;}
  res.action='review';res.label='Stage not recognised — check the PO';res.blocked='unknown_stage';
  return res;
}
// Lead time from issue to cut done, in calendar PKT days (and hours). The start resolves in this
// order: opts.issueAt (the first fabric issue, e.g. the gate pass date) > po.fabricIssuedAt >
// po.issuedAt > po.releasedAt (quality 'start_from_release': release is the nearest recorded moment
// to the issue) > po.ts. PO documents carry no issue date of their own, and `ts` is when the PO was
// CREATED, so a start taken from it is marked 'start_from_ts' and is NOT an issue-to-cut time:
// phLeadTime still returns it for a direct caller (it says what it did), but phReport never
// averages it (it counts it in leadTime.noStart). opts.now (ms) lets an open PO report its age.
// A cut recorded before the start is quality 'cut_before_issue' and has no days: it must not be
// averaged.
// -> {state:'cut'|'open'|'none'|'invalid', startDay, endDay, days, hours, ageDays, status, quality[]}
function phLeadTime(po,opts){
  const o=_phObj(opts)?opts:{},S=phSettings(o.settings||o);
  const res={state:'none',startDay:null,endDay:null,days:null,hours:null,ageDays:null,status:'unknown',quality:[]};
  if(!_phObj(po))return res;
  if(phStageOf(po)==='cancelled'){res.quality.push('cancelled');return res;}
  let sMs=phMs(o.issueAt);
  if(sMs===null)sMs=phMs(po.fabricIssuedAt);
  if(sMs===null)sMs=phMs(po.issuedAt);
  if(sMs===null){sMs=phMs(po.releasedAt);if(sMs!==null)res.quality.push('start_from_release');}
  if(sMs===null){sMs=phMs(po.ts);if(sMs!==null)res.quality.push('start_from_ts');}
  if(sMs===null){res.quality.push('no_issue');return res;}
  res.startDay=phDay(sMs);
  const eMs=phMs(po.cutAt);
  if(eMs===null){
    res.quality.push('no_cutAt');
    const now=phMs(o.now);
    if(now!==null){
      const age=phDaysBetween(res.startDay,phDay(now));
      if(age!==null&&age>=0){res.state='open';res.ageDays=age;res.status=age>=S.stuckDays?'stuck':age>S.delayTargetDays?'delayed':'ok';}
    }
    return res;
  }
  res.endDay=phDay(eMs);
  if(eMs<sMs){res.state='invalid';res.quality.push('cut_before_issue');return res;}
  res.state='cut';
  res.days=phDaysBetween(res.startDay,res.endDay);
  res.hours=phRound((eMs-sMs)/3600000,1);
  res.status=res.days<=S.delayTargetDays?'ok':'late';
  return res;
}
// Cut day against the planned cut day, signed calendar days (> 0 late). `planned` is a day, a
// moment, or an allocation record (its finishDay); default po.plannedCutDate. A PO not yet cut
// is 'overdue' once opts.today / opts.now passes the planned day, else 'open' (days null).
// States: 'on_time' | 'late' | 'early' | 'overdue' | 'open' | 'noplan' | 'cancelled' | 'invalid'.
function phDelayGap(po,planned,opts){
  const o=_phObj(opts)?opts:{};
  const res={state:'noplan',days:null,plannedDay:null,cutDay:null,vsRequested:null};
  if(!_phObj(po))return res;
  if(phStageOf(po)==='cancelled'){res.state='cancelled';return res;}
  const pl=_phObj(planned)?(planned.finishDay!=null?planned.finishDay:planned.day):(planned!=null?planned:po.plannedCutDate);
  res.plannedDay=phDay(pl);
  const cutDay=phDay(po.cutAt);res.cutDay=cutDay;
  const req=phDay(po.requestedDate!=null?po.requestedDate:po.requestedDay);
  if(cutDay!==null&&req!==null)res.vsRequested=phDaysBetween(req,cutDay);
  if(res.plannedDay===null)return res;
  if(cutDay!==null){
    const d=phDaysBetween(res.plannedDay,cutDay);
    res.days=d;res.state=d===0?'on_time':d>0?'late':'early';
    return res;
  }
  const today=o.today!=null?phDay(o.today):phDay(o.now);
  if(today!==null){
    const d=phDaysBetween(res.plannedDay,today);
    if(d>0){res.state='overdue';res.days=d;return res;}
  }
  res.state='open';
  return res;
}

/* ── 7. Completeness gate and the PC-only heuristic ─────────────────────── */
// May this draft be issued? -> {ok, missing:[{field, why}], warnings:[{field, why}], sizeModel}
// draft: {code, name, qty, sizes, sizeModel?, fabric, plannedFabricQty (or fabricNeed.qty),
// plannedFabricUnit (or fabricNeed.unit), season, plannedCutDate, cutMasterId | cutMaster,
// requestedDate}. ctx: {masters: the registry, today}. The season must be STATED: a season
// the date merely suggests is a guess and does not pass.
function phPoComplete(draft,ctx){
  const c=_phObj(ctx)?ctx:{};
  const out={ok:false,missing:[],warnings:[],sizeModel:null};
  if(!_phObj(draft)){out.missing.push({field:'draft',why:'there is no draft'});return out;}
  const miss=function(field,why){out.missing.push({field:field,why:why});};
  const warn=function(field,why){out.warnings.push({field:field,why:why});};
  if(!phStr(draft.code).trim())miss('code','the article code is missing');
  if(!phStr(draft.name).trim())miss('name','the article name is missing');
  const sm=phSizeModel({sizeModel:draft.sizeModel,sizeAxis:draft.sizeAxis,code:draft.code});
  out.sizeModel=sm.model;
  const v=phValidateSizes(sm.model,draft.sizes);
  v.issues.forEach(function(i){miss('sizes',i.why);});
  const qty=phWhole(draft.qty);
  if(qty===null||qty<=0)miss('qty','the quantity must be a whole number above zero');
  else if(v.ok&&v.total!==qty)miss('qty','the sizes add up to '+v.total+' but the quantity is '+qty);
  if(!phStr(draft.fabric).trim())miss('fabric','the fabric is missing');
  const fn=_phObj(draft.fabricNeed)?draft.fabricNeed:{};
  const fq=phNum(draft.plannedFabricQty!=null?draft.plannedFabricQty:fn.qty);
  const fu=phUnit(draft.plannedFabricUnit!=null?draft.plannedFabricUnit:fn.unit);
  if(fq===null||fq<=0)miss('plannedFabricQty','the planned fabric quantity is missing');
  if(fu===null)miss('plannedFabricUnit','the planned fabric unit must be kg or m');
  if(PH_SEASON_VALUES.indexOf(phStr(draft.season).trim().toLowerCase())<0)miss('season','the season is not set (winter, summer or all)');
  const pcd=phDay(draft.plannedCutDate),rq=phDay(draft.requestedDate);
  if(pcd===null)miss('plannedCutDate','the planned cut date is missing');
  if(rq===null)miss('requestedDate','the requested date is missing');
  // The planned cutting master must be a registered, active one.
  const mid=phStr(draft.cutMasterId).trim(),mname=phStr(draft.cutMaster!=null?draft.cutMaster:draft.cutMasterName).trim();
  if(!mid&&!mname)miss('cutMaster','the planned cutting master is missing');
  else if(!Array.isArray(c.masters))miss('cutMaster','the master registry is not available, so the master cannot be checked');
  else{
    const m=(mid?phMasterFind(c.masters,mid):null)||(mname?phMasterFind(c.masters,mname):null);
    if(!m)miss('cutMaster','"'+(mname||mid)+'" is not in the master registry');
    else if(!m.active)miss('cutMaster',m.name+' is retired in the master registry');
  }
  const today=c.today!=null?phDay(c.today):null;
  if(pcd!==null&&today!==null&&pcd<today)warn('plannedCutDate','the planned cut date is already past');
  if(pcd!==null&&rq!==null&&pcd>rq)warn('plannedCutDate','the cut is planned after the date the PO asks for');
  out.ok=out.missing.length===0;
  return out;
}
// Is this a PC? A phone or tablet user agent, or a viewport under 1024 px, is not. LIMITS: it is
// a heuristic read from what the browser says about itself, so it can be spoofed, and an iPad that
// presents a desktop user agent in a wide landscape window passes. The server cannot know the
// device. Fail closed: an unknown width or user agent is not a PC.
function phIsPcOnly(userAgent,viewportWidth){
  if(typeof userAgent!=='string'||!userAgent.trim())return false;
  const w=typeof viewportWidth==='number'&&isFinite(viewportWidth)?viewportWidth:null;
  if(w===null||w<PH_PC_MIN_WIDTH)return false;
  return!/android|iphone|ipad|ipod|mobile|tablet|silk|kindle|blackberry|opera mini|iemobile|webos|windows phone/i.test(userAgent);
}

/* ── 8. Cut tolerance ───────────────────────────────────────────────────── */
// The pieces allowed for a planned quantity: the lower bound rounds UP, the upper DOWN (as
// poCutRange in js/pos.js, in whole-percent arithmetic so 0.7 * q cannot drift).
// gate: {minPct,maxPct} | [lo,hi] in percent | the app's {min:0.7,max:1.3}. A gate that is not sane
// falls back to 70-130 and the result says so (gateFallback:true).
function phCutRange(plannedQty,gate){
  const q=phWhole(plannedQty);if(q===null||q<=0)return null;
  const g=_phGateRead(gate);
  return{min:Math.ceil(q*g.gate[0]/100),max:Math.floor(q*g.gate[1]/100),gate:g.gate,gateFallback:g.fallback};
}
// phCutCheck -> {verdict:'ok'|'needs_override'|'invalid', min, max, gate, gateFallback}
// 'ok' inside the gate, 'needs_override' outside it, 'invalid' for input that cannot be judged
// (no planned quantity, or a cut that is not a whole number above zero).
function phCutCheck(plannedQty,cutQty,opts){
  const o=_phObj(opts)?opts:{};
  const r=phCutRange(plannedQty,o.gate);
  const c=phWhole(cutQty);
  if(r===null||c===null||c<=0)return{verdict:'invalid',min:r?r.min:null,max:r?r.max:null,gate:r?r.gate:_phGateRead(o.gate).gate,gateFallback:_phGateRead(o.gate).fallback};
  return{verdict:c>=r.min&&c<=r.max?'ok':'needs_override',min:r.min,max:r.max,gate:r.gate,gateFallback:r.gateFallback};
}
function phCutVerdict(plannedQty,cutQty,opts){return phCutCheck(plannedQty,cutQty,opts).verdict;}

/* ── 9. Report roll-ups ─────────────────────────────────────────────────── */
function _phMeasure(values,dp){
  const n=values.length,total=_phSum(values);
  return{n:n,total:n?phRound(total,dp):null,value:n?phRound(total/n,dp):null,state:n?'ok':'no data'};
}
// The quantity a PO was ordered for: qty, else the sum of its ordered sizes. null when neither.
function _phOrderedQty(po){const q=phWhole(po.qty);return q!==null&&q>0?q:_phCutSum(po.sizes,_phPoArt(po));}
// {id: iso|ms} -> Map(idKey -> ms). Own, readable entries only; an unreadable date is left out.
function _phIssueMap(m){
  const out=new Map();
  if(!_phObj(m))return out;
  Object.keys(m).forEach(function(k){const ms=phMs(m[k]);const key=_phIdKey(k);if(ms!==null&&key)out.set(key,ms);});
  return out;
}
// The day a RELEASED PO counts as issued, on one basis everywhere: the per-PO issue date from
// opts.issueAtById > fabricIssuedAt > issuedAt > releasedAt, and only for a released PO with none of
// those, its creation moment (ts / createdAt) — marked fromTs. A reserved PO is never dated here.
function _phIssueDay(po,map){
  const id=_phIdKey(po.id);
  const first=[map&&id&&map.has(id)?map.get(id):null,po.fabricIssuedAt,po.issuedAt,po.releasedAt];
  for(let i=0;i<first.length;i++){const d=phDay(first[i]);if(d!==null)return{day:d,fromTs:false};}
  const late=[po.ts,po.createdAt];
  for(let j=0;j<late.length;j++){const d=phDay(late[j]);if(d!==null)return{day:d,fromTs:true};}
  return{day:null,fromTs:false};
}
// phReport(pos, jobs, range, opts) — pos: the PO documents, jobs: the cut records (see
// phMasterLog), range: {from, to} PKT days, inclusive, either may be left out.
// The pipeline, units afloat and units in production are a SNAPSHOT of every PO (not
// range-filtered); the rest is by date: POs by their issue day (see _phIssueDay), cuts by their cut day.
// ONE basis for every issue-based figure: only RELEASED POs (a real stage or completed) count.
// Reserved POs and POs in an unknown stage are in none of them and are counted apart (`reserved`,
// `unknown`). Cancelled POs, and cut records that belong to them, are in no figure.
// Lead time is cut day - issue day with the issue day from opts.issueAtById (id -> ISO / ms, e.g. the
// fabric issue's gate pass date) > fabricIssuedAt > releasedAt; a PO whose only start would be its
// creation moment (ts) is EXCLUDED and counted in leadTime.noStart. Every average carries n and says
// 'no data' when n = 0.
// opts: {standards, masters, settings, today|now, issueAtById, cancelledPoIds}.
function phReport(pos,jobs,range,opts){
  const o=_phObj(opts)?opts:{},rg=_phRangeOf(range);
  const out={ok:true,reason:null,range:{from:rg.from,to:rg.to},state:'no data',
    pipeline:phPipeline(pos),unitsAfloat:null,inProduction:null,seasons:[],avgPoIssueQty:_phMeasure([],1),avgCutQty:_phMeasure([],1),
    delayGap:null,leadTime:null,unitsCutPerMaster:[],grossPerMaster:[],cutTotal:null,reserved:0,unknown:0,duplicateJobs:0,
    excluded:{cancelledPos:0,cancelledJobs:0,junkPos:0,reservedPos:0,unknownPos:0,datedFromTs:0,duplicateJobs:0,skippedJobs:null}};
  out.unitsAfloat=out.pipeline.afloat;out.inProduction=out.pipeline.inProduction;
  out.excluded.cancelledPos=out.pipeline.cancelled;out.excluded.junkPos=out.pipeline.junk;
  out.delayGap={n:0,value:null,total:null,state:'no data',late:null,onTime:null,early:null,pctLate:null,noPlan:0};
  out.leadTime={n:0,value:null,total:null,state:'no data',late:null,invalid:0,noStart:0};
  if(rg.bad){out.ok=false;out.reason='bad_range';return out;}
  const all=Array.isArray(pos)?pos:[];
  const live=[];
  all.forEach(function(p){
    const st=phStageOf(p);
    if(st===null||st==='cancelled')return;
    if(st==='reserved'){out.reserved++;return;}
    if(st==='unknown'){out.unknown++;return;}
    live.push(p);
  });
  out.excluded.reservedPos=out.reserved;out.excluded.unknownPos=out.unknown;
  const cancelled=_phCancelledSet({pos:all,cancelledPoIds:o.cancelledPoIds});
  const imap=_phIssueMap(o.issueAtById);
  // released POs by the day they were issued
  const issued=[];
  live.forEach(function(p){const d=_phIssueDay(p,imap);if(_phInRange(d.day,rg)){issued.push(p);if(d.fromTs)out.excluded.datedFromTs++;}});
  // the quantity the PO was issued for: its ordered quantity (or the sum of its ordered sizes)
  const qtys=[];issued.forEach(function(p){const v=_phOrderedQty(p);if(v!==null)qtys.push(v);});
  out.avgPoIssueQty=_phMeasure(qtys,1);
  // season-wise
  const sm=new Map();
  issued.forEach(function(p){
    const s=phSeasonOf(p),key=s.key||'unassigned';
    if(!sm.has(key))sm.set(key,{key:key,label:s.key?phSeasonLabel(s.key):'No season',pos:0,units:0,noUnits:0,guessed:0});
    const r=sm.get(key),u=_phOrderedQty(p);
    r.pos++;if(u===null)r.noUnits++;else r.units+=u;if(s.guess)r.guessed++;
  });
  out.seasons=Array.from(sm.values()).sort(function(a,b){
    if(a.key==='unassigned')return 1;if(b.key==='unassigned')return-1;return _phCmp(a.key,b.key);
  });
  // delay gap and lead time: released POs cut inside the range
  const gaps=[],leads=[];let late=0,onTime=0,early=0,noPlan=0,invalid=0,noStart=0,leadLate=0;
  live.forEach(function(p){
    if(!_phInRange(phDay(p.cutAt),rg))return;
    const g=phDelayGap(p,undefined,o);
    if(g.state==='noplan')noPlan++;
    else if(g.days!==null){gaps.push(g.days);if(g.state==='late')late++;else if(g.state==='early')early++;else onTime++;}
    const id=_phIdKey(p.id);
    const l=phLeadTime(p,Object.assign({},o,{issueAt:imap.has(id)?imap.get(id):undefined}));
    if(l.quality.indexOf('start_from_ts')>=0||l.quality.indexOf('no_issue')>=0){noStart++;return;}   // never averaged: ts is creation, not issue
    if(l.state==='invalid')invalid++;
    else if(l.state==='cut'){leads.push(l.days);if(l.status==='late')leadLate++;}
  });
  const gm=_phMeasure(gaps,1);
  out.delayGap=Object.assign(gm,{late:gm.n?late:null,onTime:gm.n?onTime:null,early:gm.n?early:null,pctLate:gm.n?phRound(late/gm.n*100,1):null,noPlan:noPlan});
  const lm=_phMeasure(leads,1);
  out.leadTime=Object.assign(lm,{late:lm.n?leadLate:null,invalid:invalid,noStart:noStart});
  // cuts: the jobs, minus those of cancelled POs (by flag, or by poId / id)
  const jo=Object.assign({},o,{cancelledPoIds:Array.from(cancelled)});
  const sum=phMastersSummary(jobs,{from:rg.from,to:rg.to},jo);
  const allJ=_phJobsIn(jobs,null,rg,cancelled);
  out.excluded.skippedJobs=allJ.skipped;out.excluded.cancelledJobs=allJ.skipped.cancelled;
  out.duplicateJobs=allJ.duplicateJobs;out.excluded.duplicateJobs=allJ.duplicateJobs;
  out.avgCutQty=_phMeasure(allJ.list.map(function(j){return j.units;}),1);
  out.cutTotal={n:allJ.list.length,units:allJ.list.length?_phSum(allJ.list,function(j){return j.units;}):null,state:allJ.list.length?'ok':'no data'};
  out.unitsCutPerMaster=sum.rows.map(function(r){return{masterKey:r.masterKey,name:r.name,registered:r.registered,units:r.units,jobs:r.jobs,avgCutQty:r.avgCutQty};});
  out.grossPerMaster=sum.rows.map(function(r){return{masterKey:r.masterKey,name:r.name,gross:r.gross,vsStandard:r.vsStandard,noFabricJobs:r.noFabricJobs};});
  out.state=(live.length||allJ.list.length)?'ok':'no data';
  return out;
}

/* ── 9. One PO key for every spelling of a PO number (14 Oct 2026) ──────────
   Real fabric gate passes spell the PO three ways: 'PO-125' (123 of 208), '125' (71 of 208: bare
   digits) and junk ('Sample', 'SAMPLE', 'Sample & Sleeve', missing). The key is the canonical id
   the `pos` collection uses: 'PO-' + the number, at least three digits ('PO-017', 'PO-125').
   'PO-125', '125', 'po-0125', ' PO 125 ', 'PO_125' and 125 (a number) all give 'PO-125'. Bare
   digits DO map to a PO key; whether that PO exists is the caller's lookup, so '538' gives
   'PO-538' and simply matches no PO. Text that is not a PO number ('Sample', '', null) is null. */
function phPoKey(x){
  if(x===null||x===undefined)return null;
  const s=(typeof x==='number'&&isFinite(x)&&Math.floor(x)===x?String(x):phStr(x)).replace(/\s+/g,'').toUpperCase();
  const m=/^(?:PO[-_]?)?0*([0-9]{1,9})$/.exec(s);
  if(!m)return null;
  const n=parseInt(m[1],10);
  if(!(n>0))return null;
  const d=String(n);
  return'PO-'+(d.length<3?('000'+d).slice(-3):d);
}
// How a stored poId is spelt: 'prefixed' (PO-125, po 125), 'digits' (125), or null (not a PO number).
function phPoSpelling(x){
  if(phPoKey(x)===null)return null;
  return/^\s*PO/i.test(phStr(x))?'prefixed':'digits';
}
// Every spelling worth asking Firestore for when looking up the passes of one PO (an `in` query takes
// at most 10 values): 'PO-125', '125', and the zero-padded digits ('017' for PO-017). [] for a non-PO.
function phPoSpellings(x){
  const k=phPoKey(x);
  if(k===null)return[];
  const n=k.slice(3),bare=String(parseInt(n,10));
  const out=[k,n,bare,'PO-'+bare];
  return out.filter(function(v,i){return out.indexOf(v)===i;});
}

/* ── Standing product instructions (WP3a, 14 Oct 2026) ──────────────────────
   ph_article_instructions/{CODE}: the typed text of the handwritten job copies, per article code.
   Pure: no DOM, no Firestore. The writers (js/ph-write.js) and the rules hold the same caps. */
const PH_INSTR_PLACEMENTS_MAX=12,PH_INSTR_PANTONES_MAX=16,PH_INSTR_EMB_MAX=16;
const PH_INSTR_TEXT_MAX=300,PH_INSTR_NOTE_MAX=1000,PH_INSTR_REASON_MAX=300;
const PH_INSTR_SYSTEMS=Object.freeze(['C','TCX']);
const PH_INSTR_HEX_RE=/^#[0-9A-Fa-f]{6}$/;
function _phInstrS(v,n){return String(v==null?'':v).trim().slice(0,n);}
// A hex colour: exactly #RRGGBB (real data holds '#FFFFF', five digits, which is refused -> '').
function phHexOk(h){return typeof h==='string'&&PH_INSTR_HEX_RE.test(h.trim());}
function phHexNorm(h){return phHexOk(h)?h.trim().toUpperCase():'';}
// Pantone code as typed on the floor: '485 C' / '485c' / '19-1664 TCX' -> {system, code}. Unknown system -> null.
function phPantoneParse(raw,system){
  const t=_phInstrS(raw,40).toUpperCase().replace(/\s+/g,' ');
  if(!t)return null;
  let sys=PH_INSTR_SYSTEMS.indexOf(system)>-1?system:null,code=t;
  const m=/^(.*?)\s*(TCX|TPX|C)$/.exec(t);
  if(m&&m[1]){code=m[1].trim();if(m[2]==='TCX')sys=sys||'TCX';else if(m[2]==='C')sys=sys||'C';}
  if(!sys)sys=/^\d\d-\d{4}$/.test(code)?'TCX':'C';
  return{system:sys,code:code};
}
// Resolve a swatch hex once: libs = {library:[{pantoneCode,hexApprox}], builtin:{'485 C':'#..'}, tcx:{'19-1664':'#..'}}.
// First VALID hex wins (library, then built-in C table, then the TCX book); '' when none.
function phPantoneHex(code,system,libs){
  const L=libs||{};
  const p=phPantoneParse(code,system);
  if(!p)return'';
  const key=p.code+' '+p.system,keyC=p.code+' C';
  const lib=Array.isArray(L.library)?L.library:[];
  for(let i=0;i<lib.length;i++){
    const e=lib[i];
    if(e&&_phInstrS(e.pantoneCode,40).toUpperCase().replace(/\s+/g,' ')===(p.system==='C'?keyC:key)&&phHexOk(e.hexApprox))return phHexNorm(e.hexApprox);
  }
  if(p.system==='C'&&L.builtin&&Object.prototype.hasOwnProperty.call(L.builtin,keyC)&&phHexOk(L.builtin[keyC]))return phHexNorm(L.builtin[keyC]);
  if(p.system==='TCX'&&L.tcx&&Object.prototype.hasOwnProperty.call(L.tcx,p.code)&&phHexOk(L.tcx[p.code]))return phHexNorm(L.tcx[p.code]);
  return'';
}
// Clean one instruction set. Never throws. Returns {value:{placements,pantones,embroidery,notes}, problems:[...]}.
// Rows with nothing in them are dropped; over-cap rows are dropped AND reported; arrays of MAPS only (Firestore refuses nested arrays).
function phInstructionsClean(input){
  const inp=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const problems=[];
  const arr=function(x){return Array.isArray(x)?x:[];};
  const plc=[];
  arr(inp.placements).forEach(function(r){
    if(!r||typeof r!=='object'||Array.isArray(r))return;
    const o={en:_phInstrS(r.en,PH_INSTR_TEXT_MAX),ur:_phInstrS(r.ur,PH_INSTR_TEXT_MAX),side:_phInstrS(r.side,40),templateId:_phInstrS(r.templateId,60)};
    if(!o.en&&!o.ur)return;
    plc.push(o);
  });
  const pan=[];
  arr(inp.pantones).forEach(function(r){
    if(!r||typeof r!=='object'||Array.isArray(r))return;
    const p=phPantoneParse(r.code,r.system);
    if(!p)return;
    let hex='';
    if(r.hex!=null&&String(r.hex).trim()!==''){
      hex=phHexNorm(String(r.hex));
      if(!hex)problems.push('Pantone '+p.code+' '+p.system+': "'+_phInstrS(r.hex,12)+'" is not a #RRGGBB colour - left blank.');
    }
    pan.push({system:p.system,code:p.code,name:_phInstrS(r.name,80),hex:hex,use:_phInstrS(r.use,60)});
  });
  const emb=[];
  arr(inp.embroidery).forEach(function(r){
    if(!r||typeof r!=='object'||Array.isArray(r))return;
    const o={code:_phInstrS(r.code,40),candle:_phInstrS(r.candle,80),shade:_phInstrS(r.shade,80),position:_phInstrS(r.position,80),note:_phInstrS(r.note,200)};
    if(!o.code&&!o.candle&&!o.shade&&!o.position&&!o.note)return;
    emb.push(o);
  });
  if(plc.length>PH_INSTR_PLACEMENTS_MAX)problems.push('At most '+PH_INSTR_PLACEMENTS_MAX+' placements ('+plc.length+' given).');
  if(pan.length>PH_INSTR_PANTONES_MAX)problems.push('At most '+PH_INSTR_PANTONES_MAX+' Pantone colours ('+pan.length+' given).');
  if(emb.length>PH_INSTR_EMB_MAX)problems.push('At most '+PH_INSTR_EMB_MAX+' embroidery rows ('+emb.length+' given).');
  const nt=inp.notes&&typeof inp.notes==='object'&&!Array.isArray(inp.notes)?inp.notes:{};
  return{value:{placements:plc.slice(0,PH_INSTR_PLACEMENTS_MAX),pantones:pan.slice(0,PH_INSTR_PANTONES_MAX),embroidery:emb.slice(0,PH_INSTR_EMB_MAX),
    notes:{en:_phInstrS(nt.en,PH_INSTR_NOTE_MAX),ur:_phInstrS(nt.ur,PH_INSTR_NOTE_MAX)}},problems:problems};
}
function phInstructionsEmpty(v){
  return!v||(!(v.placements||[]).length&&!(v.pantones||[]).length&&!(v.embroidery||[]).length&&!(v.notes&&(v.notes.en||v.notes.ur)));
}
// What changed between two cleaned sets: names of the top-level parts that differ.
function phInstructionsDiff(a,b){
  const x=phInstructionsClean(a).value,y=phInstructionsClean(b).value,out=[];
  ['placements','pantones','embroidery','notes'].forEach(function(k){if(JSON.stringify(x[k])!==JSON.stringify(y[k]))out.push(k);});
  return out;
}
// Import from an article recipe (js/embellishments.js shape). PURE: reads the recipe only; the caller shows the result for review and saves.
// opts: {libs} for swatch hexes. Pantones: printing.pantones (+ locked placements' pantones are not read). Placements: production.visibleInstruction*
// of each placement in recipe.placements, else the draftPlacements' technique/positionSize text. Embroidery: recipe.embroideryCodes.
function phInstructionsFromRecipe(recipe,opts){
  const r=recipe&&typeof recipe==='object'?recipe:{};
  const libs=opts&&opts.libs;
  const pr=r.printing&&typeof r.printing==='object'?r.printing:{};
  const pantones=(Array.isArray(pr.pantones)?pr.pantones:[]).map(function(p){
    if(!p||typeof p!=='object')return null;
    const code=p.pantoneCode||p.code;
    const parsed=phPantoneParse(code,p.system);
    if(!parsed)return null;
    const hex=phHexOk(p.hexApprox)?phHexNorm(p.hexApprox):phPantoneHex(code,parsed.system,libs);
    return{system:parsed.system,code:parsed.code,name:p.colorName||p.name||'',hex:hex,use:p.usage||''};
  }).filter(Boolean);
  const placements=[];
  (Array.isArray(r.placements)?r.placements:[]).forEach(function(pl){
    if(!pl||typeof pl!=='object')return;
    const pd=pl.production&&typeof pl.production==='object'?pl.production:{};
    const en=pd.visibleInstructionEn||pl.templateNameEn||'',ur=pd.visibleInstructionUr||pl.templateNameUr||'';
    if(!_phInstrS(en,5)&&!_phInstrS(ur,5))return;
    placements.push({en:en,ur:ur,side:pl.side||'',templateId:pl.templateId||''});
  });
  if(!placements.length)(Array.isArray(r.draftPlacements)?r.draftPlacements:[]).forEach(function(d){
    if(!d||typeof d!=='object')return;
    const en=[d.placementType,d.positionSize,d.notes].filter(function(x){return x;}).join(' - ');
    if(en)placements.push({en:en,ur:'',side:'',templateId:''});
  });
  const emb=(Array.isArray(r.embroideryCodes)?r.embroideryCodes:[]).filter(function(x){return x&&typeof x==='object'&&!Array.isArray(x);});
  const notes={en:_phInstrS(pr.instructionsEn,PH_INSTR_NOTE_MAX),ur:_phInstrS(pr.instructionsUr,PH_INSTR_NOTE_MAX)};
  return phInstructionsClean({placements:placements,pantones:pantones,embroidery:emb,notes:notes});
}

/* ── Manager marks on a PO (WP2, 18 Oct 2026) ─────────────────────────────────
   po_marks/{PO-nnn}.marks: {priority?, hold?:{reason}, highlight?, label?}. Only what is set is stored; "normal"
   priority is stored as nothing. Pure: no DOM, no Firestore. js/ph-write.js phMarksSave and firestore.rules hold
   the same lists and caps (tests/ph-marks.test.js compares them). A mark is shown with a colour AND a glyph AND a word. */
const PH_MARK_PRIORITIES=Object.freeze(['urgent','high']);
const PH_MARK_COLOURS=Object.freeze(['amber','red','green','blue','purple','teal']);
const PH_MARK_KEYS=Object.freeze(['priority','hold','highlight','label']);
const PH_MARK_LABEL_MAX=60,PH_MARK_HOLD_MAX=200,PH_MARK_NOTE_MAX=500,PH_MARK_LAST_MAX=140;
function _phMkS(v,n){return typeof v==='string'?v.trim():'';}
// -> {value:{...only set keys}, problems:[text]}. A problem is a refusal: the writer will not save while any remain.
function phMarksClean(input){
  const inp=input!==null&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const out={},problems=[];
  const pr=inp.priority;
  if(pr!==undefined&&pr!==null&&pr!==''&&pr!=='normal'){
    if(PH_MARK_PRIORITIES.indexOf(pr)<0)problems.push('Priority must be urgent, high or normal.');
    else out.priority=pr;
  }
  const h=inp.hold;
  if(h!==undefined&&h!==null&&h!==false){
    const r=_phMkS(h&&typeof h==='object'?h.reason:h);
    if(h&&typeof h==='object'&&h.on===false){/* explicitly off */}
    else if(!r)problems.push('A hold needs a reason.');
    else if(r.length>PH_MARK_HOLD_MAX)problems.push('The hold reason is longer than '+PH_MARK_HOLD_MAX+' characters.');
    else out.hold={reason:r};
  }
  const hl=inp.highlight;
  if(hl!==undefined&&hl!==null&&hl!==''){
    if(PH_MARK_COLOURS.indexOf(hl)<0)problems.push('Highlight must be one of: '+PH_MARK_COLOURS.join(', ')+'.');
    else out.highlight=hl;
  }
  const lb=_phMkS(inp.label);
  if(lb){
    if(lb.length>PH_MARK_LABEL_MAX)problems.push('The text mark is longer than '+PH_MARK_LABEL_MAX+' characters.');
    else out.label=lb;
  }
  return{value:out,problems:problems};
}
function phMarksEmpty(m){return!m||typeof m!=='object'||!PH_MARK_KEYS.some(function(k){return m[k]!==undefined&&m[k]!==null;});}
// Which of the four marks differ between two (cleaned) marks maps. Order: PH_MARK_KEYS.
function phMarksDiff(prev,next){
  const a=prev&&typeof prev==='object'?prev:{},b=next&&typeof next==='object'?next:{};
  return PH_MARK_KEYS.filter(function(k){return JSON.stringify(a[k]===undefined?null:a[k])!==JSON.stringify(b[k]===undefined?null:b[k]);});
}
// A comment: trimmed text, 1..500 characters, not blank. -> {ok,text,problem}
function phMarkNoteClean(text){
  const t=typeof text==='string'?text.trim():'';
  if(!t)return{ok:false,text:'',problem:'A comment cannot be empty.'};
  if(t.length>PH_MARK_NOTE_MAX)return{ok:false,text:t,problem:'A comment is at most '+PH_MARK_NOTE_MAX+' characters.'};
  return{ok:true,text:t,problem:''};
}
// The badges a screen draws for a marks map, in the order hold, priority, highlight, label. Each has a glyph, a word key
// (js/ph-i18n.js) and a colour name, so no mark is colour alone. A label carries its own text.
function phMarkBadges(marks){
  const m=marks&&typeof marks==='object'?marks:{},out=[];
  if(m.hold&&typeof m.hold==='object')out.push({kind:'hold',glyph:'\u23F8',key:'marks.b_hold',colour:'red',text:typeof m.hold.reason==='string'?m.hold.reason:''});
  if(m.priority==='urgent')out.push({kind:'priority',glyph:'\u203C',key:'marks.b_urgent',colour:'red',text:''});
  else if(m.priority==='high')out.push({kind:'priority',glyph:'\u25B2',key:'marks.b_high',colour:'amber',text:''});
  if(PH_MARK_COLOURS.indexOf(m.highlight)>-1)out.push({kind:'highlight',glyph:'\u25C6',key:'marks.hl_'+m.highlight,colour:m.highlight,text:''});
  if(typeof m.label==='string'&&m.label)out.push({kind:'label',glyph:'\u270E',key:'',colour:'blue',text:m.label});
  return out;
}

/* A PO is ON HOLD when its po_marks row carries a hold. A hold is a note: it takes the PO out of the stuck and delay-attention
   counts (Monitor, PO Queue) and nothing else (planning and issuing are not blocked). Pure. */
function phMarkOnHold(row){
  const m=row&&typeof row==='object'&&row.marks&&typeof row.marks==='object'?row.marks:null;
  return !!(m&&m.hold&&typeof m.hold==='object');
}

/* ── QC reconciliation (QC1, 15 Oct 2026): the pure decision core ────────────
   The owner's rule (Afnan): the cut quantity per size is FINAL once recorded; QC must receive the same units from
   stitching, per size, within 2 %. Nothing calls this yet (no screen, no collection, no writer); it only decides.
   Names are phQc / _phQc / PHQC_ (the screen file that comes later uses the lower-case phqc, a different name).

   THE TOLERANCE (default R1): two in every hundred, rounded to the NEAREST piece, a half going UP, worked per size AND on
   the PO total. allowance(n) = floor((n*2+50)/100) in whole-number arithmetic, so there is no float trap at 25:
   0-24 -> 0 (exact), 25-74 -> 1, 75-124 -> 2, 125-174 -> 3. The 20/40/40/20 PO (120) gets S 0, M 1, L 1, XL 0, total 2.
   A SHORT receipt inside the allowance is 'within'; an OVER receipt inside it is 'over' (allowed, flagged); beyond the
   allowance a short size is 'short' and an over size is 'over_refused'. Received means every unit handed to QC, good or
   bad: rejects and B-stock count as received (quality is the disposition's business, not this core's).

   THE CUT: if the reconciliation holds a cutLock, that snapshot is the cut ('lock'); the live po.cutQty is looked at only
   to report drift, never adopted. Before any lock, a PO whose cutting is recorded (stages.cutting.done and a cutQty
   summing above 0) is held to that live cut ('live' - the figure the first lot will lock). Otherwise there is NO cut
   ('none'): the ORDERED sizes are never a stand-in (the js/pos.js poCutBySize fallback is the trap this avoids).

   Rules kept: TOTAL (junk in gives ok:false and a reason, never a throw); inputs never changed; size maps are
   {size: whole number} objects (never an array of arrays); own-property lookups only; a size key the model does not know
   is a STRAY - reported and still counted, never dropped; whole finite numbers, never -0. */
const PHQC_TOL_PCT=2;                     // "2 in every 100"
const PHQC_OVER_ALLOWED=true;             // an over-receipt inside the allowance is accepted and flagged (decision D2)
const PHQC_MAX_LOT_SIZES=12;              // a lot names at most twelve sizes
const PHQC_STATE_RANK=Object.freeze({exact:0,within:1,over:2,unexpected:3,over_refused:4,short:5});
const PHQC_PHASES=Object.freeze(['awaiting_cut','awaiting_qc','receiving','ready','short','closed']);
const PHQC_GROUPS=Object.freeze(['cutting','line','finishing','ready','closed']);

// Whole pieces allowed either way for n pieces at the tolerance (opts: a pct override for tests, 0..100).
function phQcAllowance(n,pct){
  const v=phNum(n),p=pct===undefined?PHQC_TOL_PCT:phNum(pct);
  if(v===null||v<=0||p===null||p<0||p>100)return 0;
  return Math.floor((v*p+50)/100);
}
function _phQcSet(o,k,v){Object.defineProperty(o,k,{value:v,enumerable:true,writable:true,configurable:true});} // a key like '__proto__' stays an own key
function _phQcCanon(model,raw){
  const m=typeof model==='string'&&_phHas(PH_SIZE_MODELS,model)?[model]:['alpha','waist','free'];
  for(let i=0;i<m.length;i++){const k=phSizeKey(m[i],raw);if(k!==null)return k;}
  return null;
}
// The keys of a cut map in the model's order (alpha XXXS..2XL, waist 26..40, free); 'XXL' is '2XL'; keys the model does not
// know come last, alphabetically (trimmed, case kept). With no usable model the three models are tried in that order.
function phQcSizeOrder(model,keys){
  const list=Array.isArray(keys)?keys:(_phObj(keys)?Object.keys(keys):[]);
  const known=[],stray=[];
  list.forEach(function(raw){
    const c=_phQcCanon(model,raw);
    if(c!==null){if(known.indexOf(c)<0)known.push(c);}
    else{const t=phStr(raw).trim();if(stray.indexOf(t)<0)stray.push(t);}
  });
  const pos=function(c){
    const names=typeof model==='string'&&_phHas(PH_SIZE_MODELS,model)?[model]:['alpha','waist','free'];
    let base=0;
    for(let i=0;i<names.length;i++){const ix=PH_SIZE_MODELS[names[i]].keys.indexOf(c);if(ix>=0)return base+ix;base+=PH_SIZE_MODELS[names[i]].keys.length;}
    return base;
  };
  known.sort(function(a,b){return pos(a)-pos(b);});
  stray.sort(_phCmp);
  return known.concat(stray);
}
// Reads a {size: quantity} map: canonical keys, whole numbers >= 0. -> {ok, sizes, order, total, stray, issues}.
// A key the model does not know is kept (and listed in stray); a bad value or a size given twice is an issue.
function _phQcMap(input,opts){
  const o=_phObj(opts)?opts:{};
  const out={ok:false,sizes:{},order:[],total:0,stray:[],issues:[]};
  if(!_phObj(input)){out.issues.push('the sizes must be a map of size and quantity');return out;}
  const got={},seen=[];
  Object.keys(input).forEach(function(raw){
    const c=_phQcCanon(o.model,raw);
    const key=c!==null?c:phStr(raw).trim();
    if(key===''){out.issues.push('a size has no name');return;}
    if(c===null&&out.stray.indexOf(key)<0)out.stray.push(key);
    const v=input[raw];
    const q=o.blankIsZero&&(v===''||v===null||v===undefined)?0:phWhole(v);
    if(q===null){out.issues.push(key+': the quantity must be a whole number');return;}
    if(q<0){out.issues.push(key+': the quantity cannot be negative');return;}
    if(seen.indexOf(key)>=0){out.issues.push(key+' is given twice');return;}
    seen.push(key);_phQcSet(got,key,q);
  });
  out.order=phQcSizeOrder(o.model,seen);
  out.order.forEach(function(k){_phQcSet(out.sizes,k,got[k]);out.total+=got[k];});
  out.stray.sort(_phCmp);
  out.ok=out.issues.length===0;
  return out;
}
// What the lots add up to. lots: this PO's po_qc_lots rows ({sizes,status,total?,id?}); a 'void' lot is skipped (counted
// in lotsVoid); only 'live' lots count; a row with any other status, or with unreadable sizes, is an issue and is NOT counted.
// -> null when lots is not a list; else {ok, sizes, order, total, lotsLive, lotsVoid, lotsInvalid, stray, issues}.
function phQcReceived(lots,opts){
  if(!Array.isArray(lots))return null;
  const o=_phObj(opts)?opts:{};
  const acc={},out={ok:false,sizes:{},order:[],total:0,lotsLive:0,lotsVoid:0,lotsInvalid:0,stray:[],issues:[]};
  lots.forEach(function(lot,ix){
    const id=_phObj(lot)&&lot.id!=null?phStr(lot.id):'#'+(ix+1);
    if(!_phObj(lot)){out.lotsInvalid++;out.issues.push('lot '+id+': not a lot');return;}
    if(lot.status==='void'){out.lotsVoid++;return;}
    if(lot.status!=='live'){out.lotsInvalid++;out.issues.push('lot '+id+': status is neither live nor void');return;}
    const m=_phQcMap(lot.sizes,{model:o.model});
    if(!m.ok){out.lotsInvalid++;m.issues.forEach(function(w){out.issues.push('lot '+id+': '+w);});return;}
    if(lot.total!==undefined&&phWhole(lot.total)!==m.total){out.lotsInvalid++;out.issues.push('lot '+id+': its total does not match its sizes');return;}
    out.lotsLive++;
    m.order.forEach(function(k){_phQcSet(acc,k,(_phHas(acc,k)?acc[k]:0)+m.sizes[k]);});
    m.stray.forEach(function(k){if(out.stray.indexOf(k)<0)out.stray.push(k);});
  });
  out.order=phQcSizeOrder(o.model,Object.keys(acc));
  out.order.forEach(function(k){_phQcSet(out.sizes,k,acc[k]);out.total+=acc[k];});
  out.stray.sort(_phCmp);
  out.ok=out.issues.length===0;
  return out;
}
function _phQcState(cut,recv,allow,overAllowed){
  if(cut===0&&recv>0)return'unexpected';          // received on a size nothing was cut for
  const d=recv-cut;
  if(d===0)return'exact';
  if(d<0)return-d<=allow?'within':'short';
  return overAllowed&&d<=allow?'over':'over_refused';
}
function _phQcWorst(states){
  let w='exact';
  states.forEach(function(s){if(PHQC_STATE_RANK[s]>PHQC_STATE_RANK[w])w=s;});
  return w;
}
// The verdict of what was received against the cut, per size AND on the total; the overall state is the worst of them
// (short > over_refused > unexpected > over > within > exact). cut / recv are {size: quantity} maps.
// opts: overAllowed (default PHQC_OVER_ALLOWED), tolPct (default PHQC_TOL_PCT), model.
// -> {ok, why, issues, state, sizes:{S:{cut,recv,diff,allow,state}}, order, total:{cut,recv,diff,allow,state}, stray, flagged}.
// Only sizes with something cut or received are listed (a 0-cut, 0-received size is not a row).
function phQcVerdict(cut,recv,opts){
  const o=_phObj(opts)?opts:{};
  const overAllowed=o.overAllowed===undefined?PHQC_OVER_ALLOWED:o.overAllowed===true;
  const pct=o.tolPct===undefined?PHQC_TOL_PCT:o.tolPct;
  const bad=function(why,issues){return{ok:false,why:why,issues:issues||[why],state:null,sizes:{},order:[],total:null,stray:[],flagged:[]};};
  const c=_phQcMap(cut,{model:o.model}),r=_phQcMap(recv,{model:o.model});
  if(!c.ok)return bad('the cut could not be read: '+c.issues.join('; '),c.issues);
  if(!r.ok)return bad('what was received could not be read: '+r.issues.join('; '),r.issues);
  const keys=phQcSizeOrder(o.model,Object.keys(c.sizes).concat(Object.keys(r.sizes)));
  const out={ok:true,why:'',issues:[],state:'exact',sizes:{},order:[],total:null,stray:c.stray.concat(r.stray.filter(function(k){return c.stray.indexOf(k)<0;})).sort(_phCmp),flagged:[]};
  keys.forEach(function(k){
    const cu=_phHas(c.sizes,k)?c.sizes[k]:0,re=_phHas(r.sizes,k)?r.sizes[k]:0;
    if(cu===0&&re===0)return;
    const allow=phQcAllowance(cu,pct);
    const row={cut:cu,recv:re,diff:re-cu,allow:allow,state:_phQcState(cu,re,allow,overAllowed)};
    _phQcSet(out.sizes,k,row);out.order.push(k);
    if(row.state!=='exact'&&row.state!=='within')out.flagged.push({size:k,state:row.state});
  });
  const tAllow=phQcAllowance(c.total,pct);
  out.total={cut:c.total,recv:r.total,diff:r.total-c.total,allow:tAllow,state:_phQcState(c.total,r.total,tAllow,overAllowed)};
  out.state=_phQcWorst(out.order.map(function(k){return out.sizes[k].state;}).concat([out.total.state]));
  return out;
}
// Why a lot may not be saved (null = it may). cut = the final cut map, recvSoFar = the live lots' sizes (phQcReceived().sizes),
// lotSizes = the lot being typed (a blank box counts as 0). Refuses: not a map, more than twelve sizes, a bad quantity
// (fraction, negative, text), a size given twice, a size that was not cut, nothing entered, and any size - or the PO
// total - that would end above cut + allowance. opts: overAllowed, tolPct, model.
function phQcLotProblem(cut,recvSoFar,lotSizes,opts){
  const o=_phObj(opts)?opts:{};
  const overAllowed=o.overAllowed===undefined?PHQC_OVER_ALLOWED:o.overAllowed===true;
  const pct=o.tolPct===undefined?PHQC_TOL_PCT:o.tolPct;
  const c=_phQcMap(cut,{model:o.model});
  if(!c.ok||c.total<=0)return'The cut is not recorded, so nothing can be received yet.';
  const r=_phQcMap(recvSoFar===null||recvSoFar===undefined?{}:recvSoFar,{model:o.model});
  if(!r.ok)return'What was received so far could not be read: '+r.issues[0]+'.';
  if(!_phObj(lotSizes))return'Enter the units received for each size.';
  if(Object.keys(lotSizes).length>PHQC_MAX_LOT_SIZES)return'A lot names at most '+PHQC_MAX_LOT_SIZES+' sizes.';
  const l=_phQcMap(lotSizes,{model:o.model,blankIsZero:true});
  if(!l.ok)return l.issues[0]+'.';
  let lotTotal=0;
  for(let i=0;i<l.order.length;i++){
    const k=l.order[i],add=l.sizes[k];
    if(add===0)continue;                                   // nothing is received on this size
    lotTotal+=add;
    const cu=_phHas(c.sizes,k)?c.sizes[k]:0;
    if(cu===0)return k+' was not cut on this PO, so QC cannot receive it.';
    const have=_phHas(r.sizes,k)?r.sizes[k]:0,allow=overAllowed?phQcAllowance(cu,pct):0;
    if(have+add>cu+allow)return'QC cannot receive more than was cut: '+k+' has '+cu+' cut, '+have+' received, this lot adds '+add+' - the allowance is '+allow+'.';
  }
  if(lotTotal===0)return'Nothing was entered - enter the units received for at least one size.';
  const tAllow=overAllowed?phQcAllowance(c.total,pct):0;
  if(r.total+lotTotal>c.total+tAllow)return'QC cannot receive more than was cut in total: '+c.total+' cut, '+r.total+' received, this lot adds '+lotTotal+' - the allowance is '+tAllow+'.';
  return null;
}
function _phQcLiveCut(po,model){
  const done=_phObj(po)&&_phObj(po.stages)&&_phObj(po.stages.cutting)&&po.stages.cutting.done===true;
  if(!done||!_phObj(po.cutQty))return null;
  const m=_phQcMap(po.cutQty,{model:model});
  return m.ok&&m.total>0?m:null;
}
// The figure the floor is held to. -> {ok, why, source:'lock'|'live'|'none', locked, sizes, order, total, stray, issues, drift, damage}
// 'lock' = recon.cutLock.sizes; 'live' = po.cutQty once cutting is recorded and no lock exists yet; 'none' = no cut (never the ordered
// sizes). drift lists the sizes where a live cut differs from the lock (the lock still wins). opts.minusBundlingDamage (default false)
// takes po.damageSummary.bySize off each size's expected figure (never below 0).
function phQcExpected(po,recon,opts){
  const o=_phObj(opts)?opts:{};
  const none=function(ok,why,issues){return{ok:ok,why:why,source:'none',locked:false,sizes:{},order:[],total:0,stray:[],issues:issues||[],drift:null,damage:null};};
  if(!_phObj(po))return none(false,'no PO was given');
  let model=o.model;
  if(model===undefined){const a=phSizeModel(_phPoArt(po));model=a.source==='default'?null:a.model;}
  const lock=_phObj(recon)&&recon.cutLock!==undefined&&recon.cutLock!==null?recon.cutLock:null;
  let out;
  if(lock!==null){
    const m=_phObj(lock)?_phQcMap(lock.sizes,{model:model}):null;
    if(!m||!m.ok||m.total<=0)return none(false,'the locked cut could not be read',m?m.issues:['the lock is not a map']);
    if(lock.total!==undefined&&phWhole(lock.total)!==m.total)return none(false,'the locked cut total does not match its sizes',['cutLock.total does not match its sizes']);
    out={ok:true,why:'',source:'lock',locked:true,sizes:m.sizes,order:m.order,total:m.total,stray:m.stray,issues:[],drift:null,damage:null};
    const live=_phQcLiveCut(po,model);
    if(live){
      const rows=[];
      phQcSizeOrder(model,Object.keys(m.sizes).concat(Object.keys(live.sizes))).forEach(function(k){
        const a=_phHas(m.sizes,k)?m.sizes[k]:0,b=_phHas(live.sizes,k)?live.sizes[k]:0;
        if(a!==b)rows.push({size:k,lock:a,live:b});
      });
      if(rows.length)out.drift={sizes:rows,lockTotal:m.total,liveTotal:live.total};
    }
  }else{
    const live=_phQcLiveCut(po,model);
    if(!live)return none(true,'cutting is not recorded on this PO');
    out={ok:true,why:'',source:'live',locked:false,sizes:live.sizes,order:live.order,total:live.total,stray:live.stray,issues:[],drift:null,damage:null};
  }
  if(o.minusBundlingDamage===true&&_phObj(po.damageSummary)&&_phObj(po.damageSummary.bySize)){
    const dmg=_phQcMap(po.damageSummary.bySize,{model:model});
    if(dmg.ok){
      const sizes={};let total=0;
      out.order.forEach(function(k){
        const d=_phHas(dmg.sizes,k)?dmg.sizes[k]:0,v=Math.max(0,out.sizes[k]-d);
        _phQcSet(sizes,k,v);total+=v;
      });
      out.damage=dmg.sizes;out.sizes=sizes;out.total=total;
    }
  }
  return out;
}
// One call for a screen: the cut the PO is held to, what QC has received, the verdict and the phase.
//   po     the PO document (stage, cutQty, stages.cutting.done, damageSummary)
//   recon  the po_qc_recon document, or null/undefined when there is none yet; opts.reconRead===false says it could not be read
//   lots   this PO's po_qc_lots rows; null / not a list = they could not be read -> ok:false naming po_qc_lots
// phase: awaiting_cut (no cut) | awaiting_qc (a cut, no live lot) | receiving (lots, but the total is still short beyond the allowance:
// more units are expected) | ready (exact / within / over: the floor may close) | short (the total is in but a size is short,
// unexpected or over beyond its allowance: a manager may close it) | closed.
// canClose: floor = ready only; manager = ready or short. progressPct = floor(received / cut, capped at 100), null with no cut.
function phQcReconcile(po,recon,lots,opts){
  const o=_phObj(opts)?opts:{};
  const fail=function(why,extra){
    const r={ok:false,why:why,stage:_phObj(po)?phStageOf(po):null,cutSource:'none',locked:false,reopened:false,status:null,cut:null,recv:null,verdict:null,lotsLive:0,lotsVoid:0,
      canClose:{floor:false,manager:false},phase:null,progressPct:null,drift:null,stray:[],issues:[why]};
    if(extra)Object.keys(extra).forEach(function(k){r[k]=extra[k];});
    return r;
  };
  if(!_phObj(po))return fail('no PO was given');
  if(o.reconRead===false)return fail('po_qc_recon could not be read');
  if(!Array.isArray(lots))return fail('po_qc_lots could not be read');
  let model=o.model;
  if(model===undefined){const a=phSizeModel(_phPoArt(po));model=a.source==='default'?null:a.model;}
  const rc=_phObj(recon)?recon:null;
  const exp=phQcExpected(po,rc,{model:model,minusBundlingDamage:o.minusBundlingDamage===true});
  if(!exp.ok)return fail(exp.why,{issues:exp.issues.length?exp.issues:[exp.why]});
  const pid=phPoKey(po.id!==undefined?po.id:po.poId);
  const mine=[],foreign=[];
  lots.forEach(function(l,ix){
    const lp=_phObj(l)&&l.poId!==undefined?phPoKey(l.poId):null;
    if(pid!==null&&lp!==null&&lp!==pid)foreign.push('lot '+(_phObj(l)&&l.id!=null?phStr(l.id):'#'+(ix+1))+' belongs to '+lp+', not '+pid);
    else mine.push(l);
  });
  const recv=phQcReceived(mine,{model:model});
  const issues=foreign.concat(recv.issues);
  const status=rc?phStr(rc.status):'';
  const stage=phStageOf(po);
  const base={stage:stage,cutSource:exp.source,locked:exp.locked,reopened:status==='reopened',status:status||null,drift:exp.drift,stray:_phSortedUnique(exp.stray.concat(recv.stray)),
    lotsLive:recv.lotsLive,lotsVoid:recv.lotsVoid};
  if(issues.length)return fail('what was received could not be read: '+issues[0],Object.assign(base,{issues:issues,recv:recv,cut:exp.source==='none'?null:exp}));
  if(exp.source==='none')return Object.assign({ok:true,why:'',cut:null,recv:recv,verdict:null,canClose:{floor:false,manager:false},phase:status==='closed'?'closed':'awaiting_cut',progressPct:null,issues:[]},base);
  const verdict=phQcVerdict(exp.sizes,recv.sizes,{model:model,overAllowed:o.overAllowed,tolPct:o.tolPct});
  if(!verdict.ok)return fail(verdict.why,Object.assign(base,{issues:verdict.issues,recv:recv,cut:exp}));
  let phase;
  if(status==='closed')phase='closed';
  else if(recv.lotsLive===0)phase='awaiting_qc';
  else if(verdict.total.state==='short')phase='receiving';
  else if(verdict.state==='exact'||verdict.state==='within'||verdict.state==='over')phase='ready';
  else phase='short';
  const pct=exp.total>0?Math.min(100,Math.floor(recv.total*100/exp.total)):null;
  return Object.assign({ok:true,why:'',cut:exp,recv:recv,verdict:verdict,
    canClose:{floor:phase==='ready',manager:phase==='ready'||phase==='short'},phase:phase,progressPct:pct,issues:[]},base);
}
// Which group of the Afloat list a PO sits in. rec = {stage, phase} (a phQcReconcile result carries both).
// 'closed' (phase closed) | 'ready' (phase ready / short, from the stitching stage on) | 'cutting' (stage cutting) |
// 'finishing' (stage qc, or a completed PO whose reconciliation is not closed, still waiting for units) | 'line' (bundling, stitching,
// printing, washing). A stage this core does not know is 'unknown'; cancelled, reserved and junk are null (not afloat).
function phQcGroup(rec){
  if(!_phObj(rec))return null;
  const st=phStr(rec.stage).trim(),ph=phStr(rec.phase).trim();
  if(st===''||st==='cancelled'||st==='reserved')return null;
  const idx=PH_REAL_STAGE_ORDER.indexOf(st);
  if(idx<0&&st!=='completed')return'unknown';
  if(ph==='closed')return'closed';
  if((ph==='ready'||ph==='short')&&(st==='completed'||idx>=PH_REAL_STAGE_ORDER.indexOf('stitching')))return'ready';
  if(st==='cutting')return'cutting';
  if(st==='completed'||st==='qc')return'finishing';
  return'line';
}

if(typeof module!=='undefined'&&module.exports){
  module.exports={phMarkOnHold,PH_VERSION,PH_TZ_OFFSET_MIN,PH_UNITS,PH_SEASON_VALUES,PH_WINTER_MONTHS,PH_SUMMER_MONTHS,PH_SIZE_MODELS,
    PH_WAIST_CODE_PREFIXES,PH_FREE_KEY,PH_REAL_STAGE_ORDER,PH_STAGES,PH_CUT_GATE_PCT,PH_PC_MIN_WIDTH,PH_MASTER_NAME_MAX,
    PH_MAX_HORIZON_DAYS,PH_DEFAULT_SETTINGS,
    phStr,phNum,phWhole,phRound,phUnit,phNorm,phIsDay,phMs,phDay,phDayNum,phDayFromNum,phDayAdd,phDaysBetween,phWeekday,
    phWeekStart,phSettings,phIsWorkday,phWorkdayNext,phNextDayWithRoom,phWorkdaysBetween,
    phSeasonKey,phSeasonOfDay,phSeasonOf,phSeasonLabel,
    phSizeKey,phSizeModel,phValidateSizes,phSizesTotal,
    phGrossActual,phStandard,phExpectedGross,phGrossVariance,
    phMasterKey,phMasterEntry,phMasterFind,phMasterLog,phMastersSummary,
    phAllocate,
    phStageOf,phPoUnits,phPipeline,phNextAction,phLeadTime,phDelayGap,
    phPoComplete,phIsPcOnly,phCutRange,phCutCheck,phCutVerdict,phReport,
    phPoKey,phPoSpelling,phPoSpellings,
    PH_INSTR_PLACEMENTS_MAX,PH_INSTR_PANTONES_MAX,PH_INSTR_EMB_MAX,PH_INSTR_SYSTEMS,phHexOk,phHexNorm,phPantoneParse,phPantoneHex,
    phInstructionsClean,phInstructionsEmpty,phInstructionsDiff,phInstructionsFromRecipe,
    PH_MARK_PRIORITIES,PH_MARK_COLOURS,PH_MARK_KEYS,PH_MARK_LABEL_MAX,PH_MARK_HOLD_MAX,PH_MARK_NOTE_MAX,PH_MARK_LAST_MAX,
    phMarksClean,phMarksEmpty,phMarksDiff,phMarkNoteClean,phMarkBadges,
    PHQC_TOL_PCT,PHQC_OVER_ALLOWED,PHQC_MAX_LOT_SIZES,PHQC_STATE_RANK,PHQC_PHASES,PHQC_GROUPS,
    phQcAllowance,phQcSizeOrder,phQcReceived,phQcVerdict,phQcLotProblem,phQcExpected,phQcReconcile,phQcGroup};
}

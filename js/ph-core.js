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
    const t=x.replace(/,/g,'').trim();
    if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t))return null;
    const n=Number(t);return isFinite(n)?n:null;
  }
  return null;
}
function phWhole(x){const n=phNum(x);return n!==null&&Math.floor(n)===n?(n===0?0:n):null;}
// Round half away from zero at dp places, without the 1.005 trap.
function phRound(x,dp){
  const n=phNum(x);if(n===null)return null;
  const d=phWhole(dp);dp=d!==null&&d>=0&&d<=12?d:0;
  const s=n<0?-1:1,a=Math.abs(n);
  const str=String(a);
  if(str.indexOf('e')>=0){const f=Math.pow(10,dp);return s*Math.round(a*f)/f;}
  const r=Number(Math.round(Number(str+'e'+dp))+'e-'+dp);
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
function phMs(x){
  if(x==null||x==='')return null;
  if(typeof x==='number')return isFinite(x)&&x>=1e11&&x<=8.64e15?x:null;
  if(typeof x==='string'){
    const s=x.trim();
    if(!/^\d{4}-\d{2}-\d{2}/.test(s)||!phIsDay(s.slice(0,10)))return null;
    const t=Date.parse(s);return isFinite(t)?t:null;
  }
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
function _phGateOf(g){
  let lo=null,hi=null;
  if(Array.isArray(g)&&g.length===2){lo=phWhole(g[0]);hi=phWhole(g[1]);}
  else if(_phObj(g)){lo=phWhole(g.minPct);hi=phWhole(g.maxPct);}
  // A gate that is not sane falls back to 70-130: a junk value must not switch the check off.
  if(lo!==null&&hi!==null&&lo>=50&&lo<100&&hi>100&&hi<=200)return[lo,hi];
  return PH_CUT_GATE_PCT.slice();
}
function phSettings(raw){
  const r=_phObj(raw)?raw:{},D=PH_DEFAULT_SETTINGS;
  const cap=phWhole(r.dailyCapacity!=null?r.dailyCapacity:r.capacity);
  let off=[];
  if(Array.isArray(r.offWeekdays))off=_phSortedUnique(r.offWeekdays.map(phWhole).filter(function(v){return v!==null&&v>=0&&v<=6;}));
  if(off.length>=7)off=[];                                  // never a calendar with no working day
  let skip=[];
  if(Array.isArray(r.skipDays))skip=_phSortedUnique(r.skipDays.slice(0,5000).map(function(d){return phIsDay(d)?d:null;}).filter(Boolean));
  const target=phWhole(r.delayTargetDays),stuck=phWhole(r.stuckDays);
  const okDelay=target!==null&&stuck!==null&&target>=0&&stuck>target;
  const over=phNum(r.grossOverTolPct),under=phNum(r.grossUnderTolPct);
  return{
    dailyCapacity:cap!==null&&cap>=1&&cap<=100000?cap:D.dailyCapacity,
    cutGate:_phGateOf(r.cutGate),
    offWeekdays:off,
    skipDays:skip,
    delayTargetDays:okDelay?target:D.delayTargetDays,
    stuckDays:okDelay?stuck:D.stuckDays,
    grossOverTolPct:over!==null&&over>=0&&over<=100?over:D.grossOverTolPct,
    grossUnderTolPct:under!==null&&under>=0&&under<=100?under:D.grossUnderTolPct
  };
}
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
  if(m==='alpha'||m==='waist'||m==='free')return{model:m,keys:PH_SIZE_MODELS[m].keys.slice(),source:'article'};
  const pre=/^([A-Z]+)/.exec(phStr(a.code).trim().toUpperCase());
  if(pre&&PH_WAIST_CODE_PREFIXES.indexOf(pre[1])>=0)return{model:'waist',keys:PH_SIZE_MODELS.waist.keys.slice(),source:'prefix'};
  return{model:'alpha',keys:PH_SIZE_MODELS.alpha.keys.slice(),source:'default'};
}
// A size breakdown is valid when every key is a known size of the model, every quantity is a
// whole number >= 0 (blank = 0), no size is given twice (XXL and 2XL), and at least one is > 0.
// model: 'alpha' | 'waist' | 'free' or the object phSizeModel returns.
function phValidateSizes(model,sizes){
  const name=_phObj(model)?phStr(model.model):phStr(model);
  const out={ok:false,model:PH_SIZE_MODELS[name]?name:null,total:0,sizes:{},issues:[]};
  if(!PH_SIZE_MODELS[name]){out.issues.push({field:'sizeModel',why:'unknown size model'});return out;}
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
  const over=std&&std.tolerancePct!=null?std.tolerancePct:S.grossOverTolPct;
  const under=std&&std.tolerancePct!=null?std.tolerancePct:S.grossUnderTolPct;
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
function _phCutSum(o){
  if(!_phObj(o))return null;
  let t=0,any=false;
  Object.keys(o).forEach(function(k){const q=phWhole(o[k]);if(q!==null&&q>0){t+=q;any=true;}});
  return any?t:null;
}
// One cut job -> {id, poId, key, name, day, units, fabric, unit, code, cutBySize} or {skip:reason}.
function _phJobNorm(j){
  if(!_phObj(j))return{skip:'junk'};
  if(j.cancelled===true||phStr(j.poStatus)==='cancelled')return{skip:'cancelled'};
  const nameRaw=j.master!=null?j.master:(j.cutMaster!=null?j.cutMaster:j.cutMasterName);
  const name=phNorm(nameRaw);
  const key=j.masterKey!=null&&j.masterKey!==''?phMasterKey(j.masterKey):name.toLowerCase();
  const day=phDay(j.cutDay!=null?j.cutDay:j.cutAt);
  const rawUnits=j.cutUnits!=null?j.cutUnits:(j.units!=null?j.units:j.cutQty);
  const units=_phObj(rawUnits)?_phCutSum(rawUnits):phWhole(rawUnits);
  if(day===null)return{skip:'noDay'};
  if(units===null||units<=0)return{skip:'noUnits'};
  const f=phNum(j.fabricUsed),unit=phUnit(j.unit!=null?j.unit:j.fabricUnit);
  return{id:phStr(j.id!=null?j.id:j.poId).trim(),poId:phStr(j.poId).trim().toUpperCase(),key:key,name:name,day:day,units:units,
    fabric:f!==null&&f>0&&unit!==null?f:null,unit:unit,code:phStr(j.articleCode!=null?j.articleCode:j.code).trim().toUpperCase(),
    cutBySize:_phObj(j.cutBySize)?j.cutBySize:(_phObj(j.cutQty)?j.cutQty:null)};
}
function _phRangeOf(range){
  const r=_phObj(range)?range:{};
  const from=r.from==null||r.from===''?null:phDay(r.from),to=r.to==null||r.to===''?null:phDay(r.to);
  const bad=(r.from!=null&&r.from!==''&&from===null)||(r.to!=null&&r.to!==''&&to===null)||(from!==null&&to!==null&&from>to);
  return{from:from,to:to,bad:bad};
}
function _phInRange(day,rg){return day!==null&&(rg.from===null||day>=rg.from)&&(rg.to===null||day<=rg.to);}
function _phMean(sum,n,dp){return n>0?phRound(sum/n,dp):null;}
// One bucket's figures: units, jobs, average cut quantity, gross per unit, and the standard.
function _phBucket(jobs,stdMap,S){
  const units=_phSum(jobs,function(j){return j.units;});
  const out={jobs:jobs.length,jobIds:_phSortedUnique(jobs.map(function(j){return j.id||j.poId;}).filter(Boolean)),units:units,
    avgCutQty:_phMean(units,jobs.length,1),gross:{kg:null,m:null},vsStandard:{kg:null,m:null},noFabricJobs:0};
  out.noFabricJobs=jobs.filter(function(j){return j.fabric===null;}).length;
  PH_UNITS.forEach(function(u){
    const withF=jobs.filter(function(j){return j.unit===u&&j.fabric!==null;});
    if(!withF.length)return;
    const fabric=_phSum(withF,function(j){return j.fabric;}),pieces=_phSum(withF,function(j){return j.units;});
    out.gross[u]={fabric:phRound(fabric,3),pieces:pieces,perPiece:phRound(fabric/pieces,4)};
    let exp=0,act=0,cov=0;
    withF.forEach(function(j){
      const s=stdMap[j.code];if(!s||s.unit!==u)return;
      const e=phExpectedGross(s,j.cutBySize&&_phCutSum(j.cutBySize)===j.units?j.cutBySize:j.units);
      if(e===null)return;
      exp+=e*j.units;act+=j.fabric;cov+=j.units;
    });
    if(cov===0){out.vsStandard[u]={unit:u,state:'nostandard',expectedFabric:null,actualFabric:null,gapPct:null,coveredPieces:0,totalPieces:pieces};return;}
    const gp=phRound((act-exp)/exp*100,2);
    out.vsStandard[u]={unit:u,state:gp>S.grossOverTolPct?'over':gp<-S.grossUnderTolPct?'under':'within',
      expectedFabric:phRound(exp,3),actualFabric:phRound(act,3),gapPct:gp,coveredPieces:cov,totalPieces:pieces};
  });
  return out;
}
function _phJobsIn(jobs,masterKey,rg){
  const out={list:[],skipped:{junk:0,cancelled:0,noDay:0,noUnits:0}};
  if(!Array.isArray(jobs))return out;
  const mk=masterKey==null||masterKey===''?null:phMasterKey(masterKey);
  jobs.forEach(function(raw){
    const j=_phJobNorm(raw);
    if(j.skip){out.skipped[j.skip]++;return;}
    if(!_phInRange(j.day,rg))return;
    if(mk!==null&&j.key!==mk)return;
    out.list.push(j);
  });
  out.list.sort(function(a,b){return _phCmp(a.day,b.day)||_phCmp(a.id,b.id)||_phCmp(a.key,b.key)||(a.units-b.units);});
  return out;
}
// The log of a master (masterKey falsy = every master together) over a range: daily and weekly
// roll-ups, Monday-start weeks. Days and weeks with no cut are left out, not shown as zero.
// opts: {standards:{CODE:{unit,grossPerPiece,...}}, settings}. Jobs are
// {id|poId, master|masterKey, cutDay|cutAt, cutUnits (or a {size:qty} map), fabricUsed, unit, articleCode}.
function phMasterLog(jobs,masterKey,range,opts){
  const o=_phObj(opts)?opts:{},S=phSettings(o.settings||o),rg=_phRangeOf(range);
  const mk=masterKey==null||masterKey===''?null:phMasterKey(masterKey);
  const out={ok:true,reason:null,masterKey:mk,from:rg.from,to:rg.to,state:'no data',daily:[],weekly:[],totals:null,skipped:null};
  if(rg.bad){out.ok=false;out.reason='bad_range';return out;}
  const g=_phJobsIn(jobs,masterKey,rg);
  out.skipped=g.skipped;
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
  if(rg.bad)return{ok:false,reason:'bad_range',rows:[]};
  const g=_phJobsIn(jobs,null,rg),std=_phStandardMap(o.standards);
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
  return{ok:true,reason:null,rows:rows,skipped:g.skipped};
}

/* ── 4. Capacity and delay allocation ───────────────────────────────────── */
// Spread planned cut quantities over working days, first by priority.
// jobs: [{id, qty, priority?, requestedDay?, earliestDay?}]  (lower priority number = sooner,
// none = after all numbered; ties go to the earlier requested day, then the id).
// opts: {startDay, capacity (default settings.dailyCapacity 400), offWeekdays, skipDays}.
// A job bigger than a day's capacity spans days; no day is ever loaded past capacity.
// delayDays is signed WORKING days from the requested day to the day the job finishes
// (> 0 late, 0 on time, < 0 early); null when the job has no requested day. A job that cannot
// be placed is listed in `unscheduled` with the reason, never silently dropped.
function phAllocate(jobs,opts){
  const o=_phObj(opts)?opts:{},S=phSettings(o);
  const startDay=phDay(o.startDay);
  const out={ok:false,reason:null,capacity:S.dailyCapacity,startDay:startDay,allScheduled:false,order:[],days:[],jobs:[],byId:Object.create(null),unscheduled:[]};
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
    const segs=[];let rem=j.qty,steps=0,failed=n===null;
    while(!failed&&rem>0){
      const free=cap-(load.get(n)||0);
      if(free>0){const u=Math.min(free,rem);segs.push({n:n,units:u});rem-=u;}
      if(rem>0){
        if(++steps>PH_MAX_HORIZON_DAYS){failed=true;break;}
        n=_phNextWorkNum(cal,n+1);
        if(n===null)failed=true;
      }
    }
    if(failed){out.unscheduled.push({id:j.id,reason:'horizon'});return;}
    segs.forEach(function(s){load.set(s.n,(load.get(s.n)||0)+s.units);if(!dayJobs.has(s.n))dayJobs.set(s.n,[]);dayJobs.get(s.n).push(j.id);});
    const first=segs[0].n,last=segs[segs.length-1].n;
    const finishDay=phDayFromNum(last);
    const rec={id:j.id,qty:j.qty,priority:j.priority,requestedDay:j.requestedDay,
      segments:segs.map(function(s){return{day:phDayFromNum(s.n),units:s.units};}),
      startDay:phDayFromNum(first),finishDay:finishDay,spanDays:_phWorkdaysNum(cal,first-1,last),
      delayDays:null,delayCalendarDays:null,late:null};
    if(j.requestedDay!==null){
      rec.delayDays=_phWorkdaysNum(cal,phDayNum(j.requestedDay),last);
      rec.delayCalendarDays=last-phDayNum(j.requestedDay);
      rec.late=rec.delayDays>0;
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
function _phHasActualCut(po){return phMs(po.cutAt)!==null&&_phCutSum(po.cutQty)!==null;}
// Pieces a PO stands for: the ACTUAL cut once it is cut (cutAt and a cutQty map — never the
// ordered sizes standing in for it), else the ordered quantity. {units, basis:'cut'|'ordered'|null}.
function phPoUnits(po){
  if(!_phObj(po))return{units:null,basis:null};
  const st=phStageOf(po);
  if(st!=='reserved'&&st!=='cutting'&&_phHasActualCut(po))return{units:_phCutSum(po.cutQty),basis:'cut'};
  const q=phWhole(po.qty);
  if(q!==null&&q>0)return{units:q,basis:'ordered'};
  const s=_phCutSum(po.sizes);
  return s!==null?{units:s,basis:'ordered'}:{units:null,basis:null};
}
// Counts and pieces per stage. Cancelled POs are left out of every figure and only counted
// (`cancelled`); `unknown` is the POs in a stage we do not recognise; units afloat = the
// pieces of POs from cutting to qc (released, not yet completed).
function phPipeline(pos){
  const counts={},units={};
  PH_STAGES.forEach(function(s){counts[s]=0;units[s]=0;});
  const out={state:'no data',total:null,counts:null,units:null,afloat:null,cancelled:0,unknown:0,junk:0,noUnits:0};
  if(!Array.isArray(pos))return out;
  let total=0;
  pos.forEach(function(p){
    const st=phStageOf(p);
    if(st===null){out.junk++;return;}
    if(st==='cancelled'){out.cancelled++;return;}
    total++;
    const u=phPoUnits(p).units;
    if(st==='unknown'){out.unknown++;return;}
    counts[st]++;
    if(u===null)out.noUnits++;else units[st]+=u;
  });
  if(total===0)return out;
  const aStages=PH_REAL_STAGE_ORDER;
  out.state='ok';out.total=total;out.counts=counts;out.units=units;
  out.afloat={pos:_phSum(aStages,function(s){return counts[s];}),units:_phSum(aStages,function(s){return units[s];}),stages:aStages.slice()};
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
// Lead time from issue to cut done, in calendar PKT days (and hours). The start is opts.issueAt
// (the first fabric issue), else the PO's fabricIssuedAt / issuedAt / ts. opts.now (ms) lets an
// open PO report its age. A cut recorded before the issue is quality 'cut_before_issue' and
// has no days: it must not be averaged.
// -> {state:'cut'|'open'|'none'|'invalid', startDay, endDay, days, hours, ageDays, status, quality[]}
function phLeadTime(po,opts){
  const o=_phObj(opts)?opts:{},S=phSettings(o.settings||o);
  const res={state:'none',startDay:null,endDay:null,days:null,hours:null,ageDays:null,status:'unknown',quality:[]};
  if(!_phObj(po))return res;
  if(phStageOf(po)==='cancelled'){res.quality.push('cancelled');return res;}
  let sMs=phMs(o.issueAt);
  if(sMs===null)sMs=phMs(po.fabricIssuedAt);
  if(sMs===null)sMs=phMs(po.issuedAt);
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
function phCutRange(plannedQty,gate){
  const q=phWhole(plannedQty);if(q===null||q<=0)return null;
  const g=_phGateOf(gate);
  return{min:Math.ceil(q*g[0]/100),max:Math.floor(q*g[1]/100),gate:g};
}
// 'ok' inside the gate, 'needs_override' outside it, 'invalid' for input that cannot be judged
// (no planned quantity, or a cut that is not a whole number above zero).
function phCutVerdict(plannedQty,cutQty,opts){
  const o=_phObj(opts)?opts:{};
  const r=phCutRange(plannedQty,o.gate);
  const c=phWhole(cutQty);
  if(r===null||c===null||c<=0)return'invalid';
  return c>=r.min&&c<=r.max?'ok':'needs_override';
}

/* ── 9. Report roll-ups ─────────────────────────────────────────────────── */
function _phMeasure(values,dp){
  const n=values.length,total=_phSum(values);
  return{n:n,total:n?phRound(total,dp):null,value:n?phRound(total/n,dp):null,state:n?'ok':'no data'};
}
// The quantity a PO was ordered for: qty, else the sum of its ordered sizes. null when neither.
function _phOrderedQty(po){const q=phWhole(po.qty);return q!==null&&q>0?q:_phCutSum(po.sizes);}
function _phIssueDay(po){
  const c=[po.issuedAt,po.ts,po.releasedAt,po.createdAt];
  for(let i=0;i<c.length;i++){const d=phDay(c[i]);if(d!==null)return d;}
  return null;
}
// phReport(pos, jobs, range, opts) — pos: the PO documents, jobs: the cut records (see
// phMasterLog), range: {from, to} PKT days, inclusive, either may be left out.
// The pipeline and the units afloat are a SNAPSHOT of every PO (not range-filtered); the rest is
// by date: POs by their issue day, cuts by their cut day. Cancelled POs, and cut records that
// belong to them, are in no figure. Every average carries n and says 'no data' when n = 0.
// opts: {standards, masters, settings, today|now}.
function phReport(pos,jobs,range,opts){
  const o=_phObj(opts)?opts:{},rg=_phRangeOf(range);
  const out={ok:true,reason:null,range:{from:rg.from,to:rg.to},state:'no data',
    pipeline:phPipeline(pos),unitsAfloat:null,seasons:[],avgPoIssueQty:_phMeasure([],1),avgCutQty:_phMeasure([],1),
    delayGap:null,leadTime:null,unitsCutPerMaster:[],grossPerMaster:[],cutTotal:null,
    excluded:{cancelledPos:0,cancelledJobs:0,junkPos:0,skippedJobs:null}};
  out.unitsAfloat=out.pipeline.afloat;
  out.excluded.cancelledPos=out.pipeline.cancelled;out.excluded.junkPos=out.pipeline.junk;
  out.delayGap={n:0,value:null,total:null,state:'no data',late:null,onTime:null,early:null,pctLate:null,noPlan:0};
  out.leadTime={n:0,value:null,total:null,state:'no data',late:null,invalid:0,noStart:0};
  if(rg.bad){out.ok=false;out.reason='bad_range';return out;}
  const list=Array.isArray(pos)?pos.filter(function(p){const s=phStageOf(p);return s!==null&&s!=='cancelled';}):[];
  const cancelledIds=new Set((Array.isArray(pos)?pos:[]).filter(function(p){return phStageOf(p)==='cancelled';})
    .map(function(p){return phStr(p.id).trim().toUpperCase();}).filter(Boolean));
  // POs by the day they were issued
  const issued=list.filter(function(p){return _phInRange(_phIssueDay(p),rg);});
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
  // delay gap and lead time: POs cut inside the range
  const gaps=[],leads=[];let late=0,onTime=0,early=0,noPlan=0,invalid=0,noStart=0,leadLate=0;
  list.forEach(function(p){
    if(!_phInRange(phDay(p.cutAt),rg))return;
    const g=phDelayGap(p,undefined,o);
    if(g.state==='noplan')noPlan++;
    else if(g.days!==null){gaps.push(g.days);if(g.state==='late')late++;else if(g.state==='early')early++;else onTime++;}
    const l=phLeadTime(p,o);
    if(l.state==='invalid')invalid++;
    else if(l.state==='cut'){leads.push(l.days);if(l.status==='late')leadLate++;}
    else if(l.quality.indexOf('no_issue')>=0)noStart++;
  });
  const gm=_phMeasure(gaps,1);
  out.delayGap=Object.assign(gm,{late:gm.n?late:null,onTime:gm.n?onTime:null,early:gm.n?early:null,pctLate:gm.n?phRound(late/gm.n*100,1):null,noPlan:noPlan});
  const lm=_phMeasure(leads,1);
  out.leadTime=Object.assign(lm,{late:lm.n?leadLate:null,invalid:invalid,noStart:noStart});
  // cuts: the jobs, minus those of cancelled POs
  const live=[];let cj=0;
  (Array.isArray(jobs)?jobs:[]).forEach(function(j){
    if(_phObj(j)&&cancelledIds.has(phStr(j.poId).trim().toUpperCase())){cj++;return;}
    live.push(j);
  });
  out.excluded.cancelledJobs=cj;
  const sum=phMastersSummary(live,{from:rg.from,to:rg.to},o);
  const allJ=_phJobsIn(live,null,rg);
  out.excluded.skippedJobs=allJ.skipped;
  out.avgCutQty=_phMeasure(allJ.list.map(function(j){return j.units;}),1);
  out.cutTotal={n:allJ.list.length,units:allJ.list.length?_phSum(allJ.list,function(j){return j.units;}):null,state:allJ.list.length?'ok':'no data'};
  out.unitsCutPerMaster=sum.rows.map(function(r){return{masterKey:r.masterKey,name:r.name,registered:r.registered,units:r.units,jobs:r.jobs,avgCutQty:r.avgCutQty};});
  out.grossPerMaster=sum.rows.map(function(r){return{masterKey:r.masterKey,name:r.name,gross:r.gross,vsStandard:r.vsStandard,noFabricJobs:r.noFabricJobs};});
  out.state=(list.length||allJ.list.length)?'ok':'no data';
  return out;
}

if(typeof module!=='undefined'&&module.exports){
  module.exports={PH_VERSION,PH_TZ_OFFSET_MIN,PH_UNITS,PH_SEASON_VALUES,PH_WINTER_MONTHS,PH_SUMMER_MONTHS,PH_SIZE_MODELS,
    PH_WAIST_CODE_PREFIXES,PH_FREE_KEY,PH_REAL_STAGE_ORDER,PH_STAGES,PH_CUT_GATE_PCT,PH_PC_MIN_WIDTH,PH_MASTER_NAME_MAX,
    PH_MAX_HORIZON_DAYS,PH_DEFAULT_SETTINGS,
    phStr,phNum,phWhole,phRound,phUnit,phNorm,phIsDay,phMs,phDay,phDayNum,phDayFromNum,phDayAdd,phDaysBetween,phWeekday,
    phWeekStart,phSettings,phIsWorkday,phWorkdayNext,phWorkdaysBetween,
    phSeasonKey,phSeasonOfDay,phSeasonOf,phSeasonLabel,
    phSizeKey,phSizeModel,phValidateSizes,phSizesTotal,
    phGrossActual,phStandard,phExpectedGross,phGrossVariance,
    phMasterKey,phMasterEntry,phMasterFind,phMasterLog,phMastersSummary,
    phAllocate,
    phStageOf,phPoUnits,phPipeline,phNextAction,phLeadTime,phDelayGap,
    phPoComplete,phIsPcOnly,phCutRange,phCutVerdict,phReport};
}

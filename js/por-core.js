/* ─────────────────────────────────────────────────────────────────────────
   js/por-core.js — the PO Registry's PURE core (RG1, Oct 2026).

   No DOM, no Firestore, no session and no clock unless a caller passes `now`. A guarded module.exports at the foot
   lets node require it. Every decision the PO Registry screen (js/po-registry.js) draws lives here ONCE: which
   stage a PO is at, how far along it is, how old it is, why it needs attention, which saved view it belongs to,
   how a search matches, how the list sorts and groups. The screen arranges these answers and decides nothing.

   It REUSES ph-core when loaded (phPoKey, phStageOf, phMs, phDay, phSeasonOf, phDelayGap) through `typeof`, and
   carries a small copy of the id and stage rules so it still answers when ph-core is absent (node, a parse failure).
   The copies are held equal to ph-core by tests/por-core.test.js.

   Honest states (the Store lesson): a side collection that was NOT read is never "none". porIndex marks it
   (passesOk / marksOk / jobsOk / reconOk false) and every fact that depends on it says 'unread', never 0 or "no".

   Globals are por / _por / POR_ prefixed (classic scripts share one lexical scope).
   ───────────────────────────────────────────────────────────────────────── */

const POR_REAL_STAGES=Object.freeze(['cutting','bundling','stitching','printing','washing','qc']);
const POR_STAGE_LABELS=Object.freeze({reserved:'Reserved',cutting:'Cutting',bundling:'Bundling',stitching:'Stitching',printing:'Printing',
  washing:'Washing',qc:'Final QC',completed:'Completed',cancelled:'Cancelled',unknown:'Stage not recognised'});
const POR_VIEWS=Object.freeze([
  {id:'active',label:'Active'},
  {id:'attention',label:'Needs attention'},
  {id:'cutting',label:'Cutting floor'},
  {id:'finishing',label:'Finishing'},
  {id:'done',label:'Done'},
  {id:'cancelled',label:'Cancelled'},
  {id:'all',label:'All'}
]);
const POR_SORTS=Object.freeze([
  {id:'age',label:'Oldest at this stage'},
  {id:'newest',label:'Newest'},
  {id:'oldest',label:'Oldest created'},
  {id:'delay',label:'Most delayed'},
  {id:'qty',label:'Quantity'},
  {id:'number',label:'PO number'}
]);
const POR_GROUPS=Object.freeze([
  {id:'none',label:'No grouping'},
  {id:'stage',label:'Stage'},
  {id:'article',label:'Article code'},
  {id:'season',label:'Season'},
  {id:'month',label:'Month created'}
]);
// The owner's defaults (yes to the plan's defaults, Oct 2026): no fabric 7 days after release; stuck from ph_settings.stuckDays (7).
const POR_DEFAULTS=Object.freeze({noFabricDays:7,stuckDays:7,gateMin:0.7,gateMax:1.3});
// "Needs attention" reasons in order of severity, with their words.
const POR_NEEDS=Object.freeze([
  {id:'no_fabric',label:'fabric not issued'},
  {id:'stuck',label:'stuck'},
  {id:'hold',label:'on hold'},
  {id:'urgent',label:'urgent'},
  {id:'high',label:'high priority'},
  {id:'qty_mismatch',label:'qty ≠ sizes'},
  {id:'over_gate',label:'cut outside the gate'},
  {id:'no_photo',label:'no photo'}
]);
const POR_STEPS=Object.freeze(['created','released','fabric','cut','bundled','stitched','qc']);
const POR_SIZES=Object.freeze(['XS','S','M','L','XL','2XL']);
const _POR_DAY_MS=86400000,_POR_PKT_MS=5*3600000;

/* ── small readers (ph-core when loaded, else an own copy) ─────────────── */
function _porObj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function _porStr(x){return x==null?'':(typeof x==='symbol'?'':String(x));}
function _porWhole(x){
  if(typeof x==='number')return isFinite(x)&&Math.floor(x)===x?(x===0?0:x):null;
  if(typeof x==='string'&&/^\s*-?\d+\s*$/.test(x))return parseInt(x,10);
  return null;
}
function _porMsOwn(x){
  if(x==null||x==='')return null;
  if(typeof x==='number')return isFinite(x)&&x>=1e11&&x<=8.64e15?x:null;
  if(typeof x==='string'){
    const t=x.trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(t)){const v=Date.parse(t+'T00:00:00+05:00');return isFinite(v)?v:null;}
    if(!/^\d{4}-\d{2}-\d{2}T/.test(t))return null;
    const v=Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)?t:t+'+05:00');return isFinite(v)?v:null;
  }
  if(_porObj(x)){
    if(typeof x.toMillis==='function'){try{const t=x.toMillis();return typeof t==='number'&&isFinite(t)?t:null;}catch(e){return null;}}
    if(typeof x.seconds==='number'&&isFinite(x.seconds))return Math.round(x.seconds*1000+(typeof x.nanoseconds==='number'?x.nanoseconds/1e6:0));
  }
  return null;
}
function porMs(x){return typeof phMs==='function'?phMs(x):_porMsOwn(x);}
function _porDayOwn(x){
  if(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x.trim()))return x.trim();
  const ms=_porMsOwn(x);
  return ms===null?null:new Date(ms+_POR_PKT_MS).toISOString().slice(0,10);
}
function porDay(x){return typeof phDay==='function'?phDay(x):_porDayOwn(x);}
function _porDayNum(d){return typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)?Math.round(Date.UTC(+d.slice(0,4),+d.slice(5,7)-1,+d.slice(8,10))/_POR_DAY_MS):null;}
function porDaysBetween(a,b){const x=_porDayNum(porDay(a)),y=_porDayNum(porDay(b));return x===null||y===null?null:y-x;}
// The one PO-id rule: ph-core's phPoKey (every spelling of a PO number -> 'PO-nnn'). The copy below is held equal by the tests.
function _porKeyOwn(x){
  if(x===null||x===undefined)return null;
  const s=(typeof x==='number'&&isFinite(x)&&Math.floor(x)===x?String(x):_porStr(x)).replace(/\s+/g,'').toUpperCase();
  const m=/^(?:PO[-_]?)?0*([0-9]{1,9})$/.exec(s);
  if(!m)return null;
  const n=parseInt(m[1],10);
  if(!(n>0))return null;
  const d=String(n);
  return'PO-'+(d.length<3?('000'+d).slice(-3):d);
}
function porKey(x){return typeof phPoKey==='function'?phPoKey(x):_porKeyOwn(x);}
function _porStageOwn(po){
  if(!_porObj(po))return null;
  const st=_porStr(po.poStatus).trim(),cs=_porStr(po.currentStage).trim();
  if(st==='cancelled')return'cancelled';
  if(st==='complete'||cs==='completed')return'completed';
  if(POR_REAL_STAGES.indexOf(cs)>=0)return cs;
  if(cs)return'unknown';
  if(st===''||st==='reserved')return'reserved';
  return'unknown';
}
function porStageOf(po){return typeof phStageOf==='function'?phStageOf(po):_porStageOwn(po);}
function porStageLabel(st){return POR_STAGE_LABELS[st]||POR_STAGE_LABELS.unknown;}
function _porSum(map){
  if(!_porObj(map))return null;
  let t=0,any=false;
  Object.keys(map).forEach(function(k){const n=_porWhole(map[k]);if(n!==null){t+=n;any=true;}});
  return any?t:null;
}
function _porIdOf(po){return _porStr(po&&po.id).trim()||_porStr(po&&po.fbKey).trim();}
function _porPassPo(g){return g.poId!=null?g.poId:(g.poRef!=null?g.poRef:g.poNumber);}
function _porPassMs(g){const d=porMs(g&&g.date);return d!==null?d:porMs(g&&g.ts);}

/* ── the index of side collections, by PO key ────────────────────────── */
// inp: {passes, bundles, marks, jobs, recon} — each an array, or null/absent = NOT READ.
// -> {byKey:{key:{passes:[{gp,ms}], bundles:[], mark, job, recon}}, junkPasses:[gp], passesOk, bundlesOk, marksOk, jobsOk, reconOk}
function porIndex(inp){
  const I=_porObj(inp)?inp:{};
  const out={byKey:Object.create(null),junkPasses:[],passesOk:Array.isArray(I.passes),bundlesOk:Array.isArray(I.bundles),
    marksOk:Array.isArray(I.marks),jobsOk:Array.isArray(I.jobs),reconOk:Array.isArray(I.recon)};
  const slot=function(k){return out.byKey[k]||(out.byKey[k]={passes:[],bundles:[],mark:null,job:null,recon:null});};
  if(out.passesOk)I.passes.forEach(function(g){
    if(!_porObj(g)||_porStr(g.gpType)!=='fabric')return;
    const k=porKey(_porPassPo(g));
    if(k===null){out.junkPasses.push(g);return;}
    slot(k).passes.push({gp:g,ms:_porPassMs(g)});
  });
  Object.keys(out.byKey).forEach(function(k){out.byKey[k].passes.sort(function(a,b){return(a.ms===null?Infinity:a.ms)-(b.ms===null?Infinity:b.ms);});});
  if(out.bundlesOk)I.bundles.forEach(function(b){const k=_porObj(b)?porKey(b.poId):null;if(k!==null)slot(k).bundles.push(b);});
  if(out.marksOk)I.marks.forEach(function(r){const k=_porObj(r)?porKey(r.fbKey!=null?r.fbKey:r.poId):null;if(k!==null)slot(k).mark=r;});
  if(out.jobsOk)I.jobs.forEach(function(j){const k=_porObj(j)?porKey(j.fbKey!=null?j.fbKey:j.poId):null;if(k!==null)slot(k).job=j;});
  if(out.reconOk)I.recon.forEach(function(r){const k=_porObj(r)?porKey(r.fbKey!=null?r.fbKey:r.poId):null;if(k!==null)slot(k).recon=r;});
  return out;
}
// Cached on the identity of the arrays (a search keystroke must not rebuild it).
let _porIdxCache=null;
function porIndexCached(inp){
  const I=_porObj(inp)?inp:{};
  const c=_porIdxCache;
  if(c&&c.passes===I.passes&&c.bundles===I.bundles&&c.marks===I.marks&&c.jobs===I.jobs&&c.recon===I.recon)return c.idx;
  const idx=porIndex(I);
  _porIdxCache={passes:I.passes,bundles:I.bundles,marks:I.marks,jobs:I.jobs,recon:I.recon,idx:idx};
  return idx;
}

/* ── the facts of one PO ─────────────────────────────────────────────── */
// po: the pos document (fbKey). idx: porIndex(). o: {now}. -> plain facts, every "not recorded" is null, every "not read" is 'unread'.
function porFacts(po,idx,o){
  const P=_porObj(po)?po:{},X=_porObj(idx)?idx:porIndex({}),O=_porObj(o)?o:{};
  const id=_porIdOf(P),key=porKey(id),side=key!==null&&X.byKey[key]?X.byKey[key]:{passes:[],bundles:[],mark:null,job:null,recon:null};
  const stage=porStageOf(P);
  const ordered=_porWhole(P.qty),sizesSum=_porSum(P.sizes);
  const cutMs=porMs(P.cutAt);
  const cutSum=_porSum(P.cutQty);
  const cut=cutMs!==null&&cutSum!==null?cutSum:null;
  const rec=Array.isArray(P.packingReceipts)&&P.packingReceipts.length?P.packingReceipts.reduce(function(a,e){const n=_porWhole(e&&e.qty);return a+(n===null?0:n);},0):null;
  const releaseMs=porMs(P.releasedAt);
  const createdMs=porMs(P.ts)!==null?porMs(P.ts):porMs(P.createdAt);
  let fabric;
  if(!X.passesOk)fabric={state:'unread',passes:null,firstMs:null,day:null,master:'',weight:null};
  else{
    const l=side.passes;
    const first=l.filter(function(x){return x.ms!==null;})[0]||null;
    let w=0,anyW=false;
    l.forEach(function(x){const n=Number(x.gp.totalWeight!=null?x.gp.totalWeight:x.gp.fabricQty);if(isFinite(n)&&n>0){w+=n;anyW=true;}});
    fabric={state:l.length?'issued':'none',passes:l.map(function(x){return x.gp;}),firstMs:first?first.ms:null,day:first?porDay(first.ms):null,
      master:l.length?_porStr(l[0].gp.cutMaster).trim():'',weight:anyW?Math.round(w*10)/10:null};
  }
  let mark;
  if(!X.marksOk)mark={state:'unread',hold:null,priority:null,row:null};
  else{
    const r=side.mark,m=r&&_porObj(r.marks)?r.marks:{};
    mark={state:r?'marked':'none',hold:_porObj(m.hold)?{reason:_porStr(m.hold.reason)}:null,priority:m.priority==='urgent'||m.priority==='high'?m.priority:null,row:r};
  }
  const job=X.jobsOk?side.job:'unread';
  const recon=X.reconOk?side.recon:'unread';
  const qcDone=_porObj(P.stages)&&_porObj(P.stages.qc)?porMs(P.stages.qc.doneAt):null;
  // The moment the PO entered the stage it is at (for the age at that stage).
  const enteredMs=(function(){
    if(stage==='cutting')return fabric.firstMs!==null?fabric.firstMs:releaseMs;
    const i=POR_REAL_STAGES.indexOf(stage);
    if(i>0){
      for(let j=i-1;j>=0;j--){
        const s=POR_REAL_STAGES[j];
        const d=_porObj(P.stages)&&_porObj(P.stages[s])?porMs(P.stages[s].doneAt):null;
        if(d!==null)return d;
        if(s==='cutting'&&cutMs!==null)return cutMs;
      }
      return releaseMs;
    }
    return null;
  })();
  let season={key:null,label:'',guess:false};
  if(typeof phSeasonOf==='function'){
    try{
      const jp=_porObj(job)?_porStr(job.plannedCutDate):'';
      const s=phSeasonOf(Object.assign({},P,jp?{plannedCutDate:jp}:{}));
      if(s&&s.key)season={key:s.key,label:typeof phSeasonLabel==='function'?phSeasonLabel(s.key):s.key,guess:!!s.guess};
    }catch(e){}
  }
  const b=X.bundlesOk?{n:side.bundles.length,stitched:side.bundles.filter(function(x){return x&&x.stitchingDone===true;}).length}:null;
  return{
    fb:_porStr(P.fbKey).trim()||id,id:id,key:key,stage:stage,stageLabel:porStageLabel(stage),
    code:_porStr(P.code).trim(),name:_porStr(P.name).trim(),fabricName:_porStr(P.fabric).trim(),creator:_porStr(P.createdBy).trim(),
    ordered:ordered,sizesSum:sizesSum,qtyMismatch:ordered!==null&&sizesSum!==null&&ordered!==sizesSum,
    cut:cut,cutMs:cutMs,received:rec,
    releaseMs:releaseMs,releasedType:P.releasedAt==null||P.releasedAt===''?null:typeof P.releasedAt,
    createdMs:createdMs,createdDay:porDay(P.createdAt)||(createdMs!==null?porDay(createdMs):null),
    enteredMs:enteredMs,completedMs:stage==='completed'?qcDone:null,
    cancelled:stage==='cancelled'?{at:porMs(P.cancelledAt),by:_porStr(P.cancelledBy),reason:_porStr(P.cancelledReason)}:null,
    fabric:fabric,mark:mark,job:job,recon:recon,bundles:b,season:season,
    hasPhoto:!!(_porStr(P.imgFront).trim()||_porStr(P.imgBack).trim()),
    damageFlagged:P.damageFlagged===true,cutOverride:_porObj(P.cutOverride),
    embRequired:!!(_porObj(P.embellishment)&&P.embellishment.required===true),
    printed:Array.isArray(P.printLog)?P.printLog.length:0,
    ts:porMs(P.ts),num:(function(){const m=/(\d+)$/.exec(key||'');return m?parseInt(m[1],10):null;})(),
    po:P
  };
}

/* ── progress: 7 steps ───────────────────────────────────────────────── */
function porProgress(f){
  const F=_porObj(f)?f:{};
  const st=F.stage,si=POR_REAL_STAGES.indexOf(st);
  const done=st==='completed';
  const past=function(s){const k=POR_REAL_STAGES.indexOf(s);return done||(si>k&&k>=0);};
  const steps=[
    {id:'created',done:F.createdMs!=null},
    {id:'released',done:st!=='reserved'&&(F.releaseMs!=null||si>=0||done)},
    {id:'fabric',done:(F.fabric&&F.fabric.state==='issued')||past('cutting')},
    {id:'cut',done:F.cut!=null||past('cutting')},
    {id:'bundled',done:past('bundling')},
    {id:'stitched',done:past('stitching')},
    {id:'qc',done:done}
  ];
  return{done:steps.filter(function(s){return s.done;}).length,of:steps.length,steps:steps};
}

/* ── age, with honest words ──────────────────────────────────────────── */
function _porDaysWord(n){return n+(n===1?' day':' days');}
function porAge(f,now){
  const F=_porObj(f)?f:{},N=porMs(now);
  const since=function(ms){return ms===null||ms===undefined||N===null?null:porDaysBetween(ms,N);};
  if(F.stage==='cancelled'){const d=F.cancelled&&F.cancelled.at!=null?porDay(F.cancelled.at):null;return{days:null,since:'cancelled',words:d?'cancelled '+d:'cancelled'};}
  if(F.stage==='completed'){const d=F.completedMs!=null?porDay(F.completedMs):null;return{days:since(F.completedMs),since:'completed',words:d?'completed '+d:'completed'};}
  if(F.stage==='reserved'){const n=since(F.createdMs);return{days:n,since:'created',words:n===null?'not released':'created '+_porDaysWord(n)+' ago · not released'};}
  if(F.stage==='cutting'){
    if(F.fabric&&F.fabric.firstMs!=null){const n=since(F.fabric.firstMs);return{days:n,since:'fabric',words:n===null?'':_porDaysWord(n)+' since fabric issue'};}
    if(F.releaseMs!=null){const n=since(F.releaseMs);return{days:n,since:'release',words:n===null?'':_porDaysWord(n)+' since release'};}
    const n=since(F.createdMs);return{days:n,since:'created',words:n===null?'':'created '+_porDaysWord(n)+' ago'};
  }
  if(F.enteredMs!=null){const n=since(F.enteredMs);return{days:n,since:'stage',words:n===null?'':_porDaysWord(n)+' at '+(F.stageLabel||'this stage').toLowerCase()};}
  if(F.releaseMs!=null){const n=since(F.releaseMs);return{days:n,since:'release',words:n===null?'':_porDaysWord(n)+' since release'};}
  const n=since(F.createdMs);return{days:n,since:'created',words:n===null?'':'created '+_porDaysWord(n)+' ago'};
}

/* ── delay against a planned cut day (only when a plan exists) ───────── */
function porDelay(f,o){
  const F=_porObj(f)?f:{},O=_porObj(o)?o:{};
  if(F.job==='unread')return{state:'unread',days:null,words:''};
  const plan=_porObj(F.job)?_porStr(F.job.plannedCutDate).trim():'';
  if(!plan||typeof phDelayGap!=='function')return{state:'noplan',days:null,words:''};
  let g;try{g=phDelayGap(F.po||{},plan,{today:porDay(O.now)});}catch(e){return{state:'noplan',days:null,words:''};}
  const d=g&&g.days;
  const w=g.state==='overdue'?'planned '+plan+' · '+_porDaysWord(d)+' late':g.state==='late'?'cut '+_porDaysWord(d)+' after the plan':g.state==='on_time'?'cut on the planned day':g.state==='early'?'cut early':'planned '+plan;
  return{state:g.state,days:typeof d==='number'?d:null,words:w};
}

/* ── needs attention ─────────────────────────────────────────────────── */
// -> ids from POR_NEEDS, in that order. o: {now, noFabricDays, stuckDays}.
function porNeeds(f,o){
  const F=_porObj(f)?f:{},O=_porObj(o)?o:{};
  const nf=_porWhole(O.noFabricDays)!==null?_porWhole(O.noFabricDays):POR_DEFAULTS.noFabricDays;
  const sd=_porWhole(O.stuckDays)!==null?_porWhole(O.stuckDays):POR_DEFAULTS.stuckDays;
  const live=POR_REAL_STAGES.indexOf(F.stage)>=0||F.stage==='unknown';
  if(!live&&F.stage!=='reserved')return[];
  const out=new Set();
  const held=F.mark&&F.mark.hold;
  if(F.stage==='cutting'&&F.fabric&&F.fabric.state==='none'){
    const start=F.releaseMs!=null?F.releaseMs:F.createdMs;
    const n=start==null||O.now==null?null:porDaysBetween(start,O.now);
    if(n!==null&&n>=nf)out.add('no_fabric');
  }
  if(live&&!held&&F.stage!=='unknown'){
    const age=porAge(F,O.now);
    // A PO at cutting whose fabric state was not read cannot be dated from its fabric: its age is from release, and is
    // only judged when the release is known (never from the creation time).
    if(age.days!==null&&age.days>=sd&&(age.since==='fabric'||age.since==='release'||age.since==='stage'))out.add('stuck');
  }
  if(held)out.add('hold');
  if(F.mark&&F.mark.priority==='urgent')out.add('urgent');
  if(F.mark&&F.mark.priority==='high')out.add('high');
  if(F.qtyMismatch)out.add('qty_mismatch');
  if(F.cut!=null&&F.ordered&&!F.cutOverride){const r=F.cut/F.ordered;if(r<POR_DEFAULTS.gateMin||r>POR_DEFAULTS.gateMax)out.add('over_gate');}
  if(F.hasPhoto===false)out.add('no_photo');
  return POR_NEEDS.map(function(n){return n.id;}).filter(function(id){return out.has(id);});
}
function porNeedLabel(id){const n=POR_NEEDS.filter(function(x){return x.id===id;})[0];return n?n.label:id;}

/* ── saved views ─────────────────────────────────────────────────────── */
function porViewOf(view,f){
  const st=f&&f.stage;
  const active=POR_REAL_STAGES.indexOf(st)>=0||st==='reserved'||st==='unknown';
  if(view==='active')return active;
  if(view==='attention')return active&&Array.isArray(f.needs)&&f.needs.length>0;
  if(view==='cutting')return st==='cutting';
  if(view==='finishing')return['stitching','printing','washing','qc'].indexOf(st)>=0;
  if(view==='done')return st==='completed';
  if(view==='cancelled')return st==='cancelled';
  if(view==='all')return true;
  return false;
}

/* ── search, sort, group ─────────────────────────────────────────────── */
function _porFold(s){return _porStr(s).toLowerCase().replace(/\s+/g,' ').trim();}
function porMatches(f,q){
  const words=_porFold(q).split(' ').filter(Boolean);
  if(!words.length)return true;
  const hay=[f.id,f.code,f.name,f.fabricName,f.creator].map(_porFold).join(' \u0001 ');
  const k=f.key||'';
  return words.every(function(w){
    if(hay.indexOf(w)>=0)return true;
    const wk=_porKeyOwn(w);                 // '125' and 'po125' find PO-125
    return wk!==null&&wk===k;
  });
}
// Stable; nulls (unknown values) always last.
function porSort(list,by){
  const arr=(Array.isArray(list)?list:[]).map(function(f,i){return{f:f,i:i};});
  const val={
    age:function(f){return f.age&&typeof f.age.days==='number'?f.age.days:null;},
    newest:function(f){return f.ts;},
    oldest:function(f){return f.ts;},
    delay:function(f){return f.delay&&typeof f.delay.days==='number'&&(f.delay.state==='overdue'||f.delay.state==='late')?f.delay.days:null;},
    qty:function(f){return f.ordered;},
    number:function(f){return f.num;}
  }[by]||function(f){return f.ts;};
  const asc=by==='oldest'||by==='number';
  arr.sort(function(a,b){
    const x=val(a.f),y=val(b.f);
    const xn=x===null||x===undefined,yn=y===null||y===undefined;
    if(xn&&yn)return a.i-b.i;
    if(xn)return 1;if(yn)return-1;
    if(x!==y)return asc?x-y:y-x;
    return a.i-b.i;
  });
  return arr.map(function(x){return x.f;});
}
const _POR_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function porGroupKey(f,by){
  if(by==='stage')return{key:f.stage||'unknown',label:f.stage==='reserved'?'Reserved (legacy)':porStageLabel(f.stage)};
  if(by==='article')return f.code?{key:'a:'+f.code,label:f.code}:{key:'a:',label:'No article code'};
  if(by==='season')return f.season&&f.season.key?{key:'s:'+f.season.key,label:f.season.label||f.season.key}:{key:'s:',label:'No season'};
  if(by==='month'){const d=f.createdDay;return d?{key:'m:'+d.slice(0,7),label:_POR_MONTHS[+d.slice(5,7)-1]+' '+d.slice(0,4)}:{key:'m:',label:'No date'};}
  return{key:'',label:''};
}
// -> [{key,label,rows,ordered,collapsed}] in a stable, meaningful order.
function porGroup(rows,by){
  if(!by||by==='none')return[{key:'',label:'',rows:rows.slice(),ordered:_porTotal(rows),collapsed:false}];
  const m=new Map();
  rows.forEach(function(f){const g=porGroupKey(f,by);if(!m.has(g.key))m.set(g.key,{key:g.key,label:g.label,rows:[]});m.get(g.key).rows.push(f);});
  let groups=Array.from(m.values());
  const order=['cutting','bundling','stitching','printing','washing','qc','unknown','completed','reserved','cancelled'];
  groups.sort(function(a,b){
    if(by==='stage')return order.indexOf(a.key)-order.indexOf(b.key);
    const ae=/:$/.test(a.key),be=/:$/.test(b.key);
    if(ae!==be)return ae?1:-1;
    if(by==='month')return a.key<b.key?1:a.key>b.key?-1:0;   // newest month first
    return a.label<b.label?-1:a.label>b.label?1:0;
  });
  return groups.map(function(g){return Object.assign(g,{ordered:_porTotal(g.rows),collapsed:by==='stage'&&(g.key==='reserved'||g.key==='cancelled')});});
}
function _porTotal(rows){let t=0;rows.forEach(function(f){if(typeof f.ordered==='number')t+=f.ordered;});return t;}

/* ── the model ───────────────────────────────────────────────────────── */
// pos: the PO documents. idx: porIndex(). o: {now, noFabricDays, stuckDays}. -> {rows, counts:{view:n}, total, junkPasses}
function porModel(pos,idx,o){
  const O=_porObj(o)?o:{};
  const rows=(Array.isArray(pos)?pos:[]).filter(_porObj).map(function(po){
    const f=porFacts(po,idx,O);
    f.progress=porProgress(f);
    f.age=porAge(f,O.now);
    f.delay=porDelay(f,O);
    f.needs=porNeeds(f,O);
    return f;
  });
  const counts={};
  POR_VIEWS.forEach(function(v){counts[v.id]=rows.filter(function(f){return porViewOf(v.id,f);}).length;});
  return{rows:rows,counts:counts,total:rows.length,junkPasses:_porObj(idx)&&Array.isArray(idx.junkPasses)?idx.junkPasses.length:0};
}
// One list: view, then search, then sort. -> rows (cancelled last in 'all').
function porSelect(model,s){
  const S=_porObj(s)?s:{};
  let rows=(model&&model.rows||[]).filter(function(f){return porViewOf(S.view||'active',f)&&porMatches(f,S.q||'');});
  rows=porSort(rows,S.sort||'age');
  if((S.view||'active')==='all')rows=rows.filter(function(f){return f.stage!=='cancelled';}).concat(rows.filter(function(f){return f.stage==='cancelled';}));
  return rows;
}
// The per-size table of the detail page: ordered / cut / bundles / stitched / received, the six sizes (2XL always included)
// plus any other size the PO carries. Unrecorded rows are null.
function porSizeTable(po,bundles){
  const P=_porObj(po)?po:{};
  const extra=[];
  [P.sizes,P.cutQty].forEach(function(m){if(_porObj(m))Object.keys(m).forEach(function(k){if(POR_SIZES.indexOf(k)<0&&extra.indexOf(k)<0)extra.push(k);});});
  const sizes=POR_SIZES.concat(extra);
  const cutOk=porMs(P.cutAt)!==null&&_porObj(P.cutQty);
  const recv={};let anyRecv=false;
  (Array.isArray(P.packingReceipts)?P.packingReceipts:[]).forEach(function(e){if(e&&e.size){const n=_porWhole(e.qty);if(n!==null){recv[e.size]=(recv[e.size]||0)+n;anyRecv=true;}}});
  const B=Array.isArray(bundles)?bundles:null;
  const row=function(fn){const r={};let t=0,any=false;sizes.forEach(function(sz){const v=fn(sz);r[sz]=v;if(typeof v==='number'){t+=v;any=true;}});r.total=any?t:null;return r;};
  return{
    sizes:sizes,
    ordered:row(function(sz){return _porObj(P.sizes)?_porWhole(P.sizes[sz]):null;}),
    cut:cutOk?row(function(sz){const n=_porWhole(P.cutQty[sz]);return n===null?0:n;}):null,
    bundles:B?row(function(sz){return B.filter(function(b){return b&&b.size===sz;}).length;}):null,
    stitched:B?row(function(sz){return B.filter(function(b){return b&&b.size===sz&&b.stitchingDone===true;}).reduce(function(a,b){const n=_porWhole(b.units);return a+(n===null?0:n);},0);}):null,
    received:anyRecv?row(function(sz){return recv[sz]||0;}):null
  };
}

if(typeof module!=='undefined'&&module.exports)module.exports={POR_REAL_STAGES,POR_VIEWS,POR_SORTS,POR_GROUPS,POR_DEFAULTS,POR_NEEDS,POR_STEPS,POR_SIZES,
  porKey,porStageOf,porStageLabel,porMs,porDay,porDaysBetween,porIndex,porIndexCached,porFacts,porProgress,porAge,porDelay,porNeeds,porNeedLabel,
  porViewOf,porMatches,porSort,porGroup,porGroupKey,porModel,porSelect,porSizeTable,_porKeyOwn,_porStageOwn,_porMsOwn,_porDayOwn};

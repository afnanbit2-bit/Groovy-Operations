/* ─────────────────────────────────────────────────────────────────────────
   js/ph-mod-monitor.js — Production Ops: the MONITOR and OVERVIEW tabs (12 Oct 2026).

   Registers the 'monitor' and 'overview' tabs of the shell (js/ph-ui.js phRegisterTab). READ-ONLY: this file calls no Firestore write API and
   no ph-write.js function (a test scans the source and records every write). The only read of its own is `pos` (phmLoadPos), because
   js/ph-data.js loads the Production Ops collections and not the PO documents; the other inputs (po_cut_jobs, ph_settings) come from the
   shell's data layer through ctx.get().

   EVERY RULE IS js/ph-core.js's, none is rewritten here:
     stage of a PO ............ phStageOf          pieces of a PO ........... phPoUnits
     pipeline / afloat ........ phPipeline         lead time / stuck / delayed phLeadTime
     issue / cut / season / lead / delay roll-ups . phReport (called per range)
     planned load vs capacity . phAllocate         the cut gate ............. phCutCheck
     planned-day delay ........ phDelayGap         settings and their defaults phSettings
   What this file adds is only the choice of what to put on a tile and the list of POs behind it. Membership of a list is read OFF ph-core:
   each PO is run through phReport on its own and the question "did it count?" is asked of the report, so a list can never use a different
   rule than the number beside it. A tile whose list length differs from its number says so on screen (tile.warn).

   Honest states (CLAUDE.md "Loading must never hang", the Store lesson):
     - a collection that FAILED never prints a number: the tile reads `unavailable — <collection>`.
     - no data is `no data yet` (or `No cut recorded yet`), never 0. A real zero (nothing stuck) is 0.
     - missing settings use ph-core's documented defaults and are SHOWN as defaults.
     - a PO with no real start date is counted apart (`no start date`) and never averaged or judged.
   Date range: today / this week / this month / all / custom, PKT days. It moves the range tiles (issue, cut, lead, delay); the "now" tiles
   (pipeline, afloat, stuck, load) are snapshots and say so.

   Globals are phm / _phm / PHM_ prefixed (classic scripts share ONE lexical scope with ph-core, ph-data, ph-write, ph-ui).
   ───────────────────────────────────────────────────────────────────────── */

const PHM_CAP_DAYS=14;                       // the load window, today + 13
const PHM_MAX_POS=1000;                      // one bounded read of `pos`; a list that hit it says so
const PHM_READ_TIMEOUT_MS=20000;
const PHM_STALE_MS=5*60*1000;                // a cached read older than this is read again when a tab opens
const PHM_STAGE_LABEL=Object.freeze({reserved:phI18nD('ov.stage_reserved'),cutting:phI18nD('queue.lane_cutting'),bundling:phI18nD('queue.lane_bundling'),stitching:phI18nD('queue.lane_stitching'),printing:phI18nD('queue.lane_printing'),washing:phI18nD('queue.lane_washing'),qc:phI18nD('queue.lane_qc'),completed:phI18nD('queue.lane_completed'),unknown:phI18nD('ov.stage_unknown')});
const PHM_MONTHS=Object.freeze(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']);
const PHM_RANGES=Object.freeze([['today','Today'],['week','This week'],['month','This month'],['all','All time'],['custom','Custom']]);
const PHM_KIND_LABEL=Object.freeze({stuck:phI18nD('ov.reason_stuck'),delayed:phI18nD('ov.reason_delayed'),overgate:phI18nD('ov.reason_gate')});
const PHM_KIND_RANK=Object.freeze({stuck:3,overgate:2,delayed:1});
const PHM_OVERVIEW_TILES=Object.freeze(['pipeline','afloat','inProduction','reserved','stuck','attention']);
const PHM_NOW_TILES=Object.freeze(['pipeline','afloat','inProduction','reserved','stuck','capacity','queueDelay']);
const PHM_RANGE_TILES=Object.freeze(['seasons','avgIssue','avgCut','leadTime','cutGap']);

/* ── small helpers ─────────────────────────────────────────────────────── */
function _phmObj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function _phmHas(o,k){return _phmObj(o)&&Object.prototype.hasOwnProperty.call(o,k)&&o[k]!==null&&o[k]!==undefined;}
function _phmKey(x){return phStr(x).replace(/\s+/g,'').toUpperCase();}
function _phmId(po){const i=phStr(po&&po.id).trim();return i||phStr(po&&po.fbKey).trim();}
// 12345.6 -> "12,345.6"; null / junk -> an em dash (never a 0)
function _phmN(n){
  const v=phNum(n);if(v===null)return'—';
  const neg=v<0,parts=String(Math.abs(v)).split('.');
  return(neg?'-':'')+parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,',')+(parts[1]?'.'+parts[1]:'');
}
function _phmSigned(n){const v=phNum(n);if(v===null)return'—';return(v>0?'+':'')+_phmN(v);}
function _phmPlural(n,one,many){return _phmN(n)+' '+(n===1?one:(many||one+'s'));}
// The Urdu pair of a PO count, e.g. 3 POs. kind: 'po' | 'openpo'
function _phmPoD(n,kind){return phI18nD(kind==='openpo'?(n===1?'ov.openpo_one':'ov.openpo_many'):(n===1?'ov.po_one':'ov.po_many'),{n:_phmN(n)});}
function _phmDaysD(n){return phI18nD(n===1?'ov.n_day_one':'ov.n_day_many',{n:_phmN(n)});}
function _phmJoinD(list,key){return list.reduce(function(a,b){return a===null?b:phI18nD(key,{a:a,b:b});},null);}
function _phmDefD(sv,k){return sv.isDefault[k]?phI18nD('ov.default_sp'):'';}
function _phmDayLabel(d){return(typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d))?(+d.slice(8,10))+' '+PHM_MONTHS[(+d.slice(5,7))-1]:'—';}
function _phmTime(ms){   // PKT clock time, fixed UTC+5
  if(typeof ms!=='number'||!isFinite(ms))return'';
  const d=new Date(ms+PH_TZ_OFFSET_MIN*60000),p=function(x){return x<10?'0'+x:String(x);};
  return p(d.getUTCHours())+':'+p(d.getUTCMinutes());
}
function _phmTitle(ep){
  const code=phStr(ep.code!=null?ep.code:ep.articleCode).trim(),name=phStr(ep.name).trim();
  return[code,name].filter(Boolean).join(' · ')||'(no name)';
}
function _phmStageLabel(st){return PHM_STAGE_LABEL[st]||phStr(st)||'—';}

/* ── date range ────────────────────────────────────────────────────────── */
// -> {from,to,label,bad,error}. from/to are inclusive PKT days; `all` has neither.
function phmRangeFor(preset,custom,today){
  const t=phDay(today);
  const out={preset:preset,from:null,to:null,label:'',bad:false,error:''};
  if(t===null){out.bad=true;out.error='There is no valid today.';return out;}
  if(preset==='today'){out.from=t;out.to=t;out.label='Today ('+_phmDayLabel(t)+')';return out;}
  if(preset==='week'){out.from=phWeekStart(t);out.to=t;out.label='This week ('+_phmDayLabel(out.from)+' – '+_phmDayLabel(t)+')';return out;}
  if(preset==='month'){out.from=t.slice(0,8)+'01';out.to=t;out.label='This month ('+_phmDayLabel(out.from)+' – '+_phmDayLabel(t)+')';return out;}
  if(preset==='custom'){
    const c=_phmObj(custom)?custom:{};
    const f=c.from?phDay(c.from):null,e=c.to?phDay(c.to):null;
    if((c.from&&f===null)||(c.to&&e===null)){out.bad=true;out.error='Use real dates (YYYY-MM-DD).';return out;}
    if(f!==null&&e!==null&&f>e){out.bad=true;out.error='The start is after the end.';return out;}
    out.from=f;out.to=e;
    out.label=f===null&&e===null?'All time':(f?_phmDayLabel(f):'the beginning')+' – '+(e?_phmDayLabel(e):'today');
    return out;
  }
  out.label='All time';
  return out;
}

/* ── settings, with what is a default said out loud ────────────────────── */
// raw: the ph_settings/main document ({} when nothing is saved), or null when it could not be read.
function _phmSettingsView(raw,failedText){
  const known=_phmObj(raw);
  const S=phSettings(known?raw:{});
  const fbFields=new Set();
  if(known&&typeof _phSettingsFb==='function'){
    try{_phSettingsFb(raw).fallback.forEach(function(f){String(f.field).split('/').forEach(function(x){fbFields.add(x);});});}catch(e){}
  }
  const given=function(k){return known&&_phmHas(raw,k)&&!fbFields.has(k);};
  const isDef={
    dailyCapacity:!(given('dailyCapacity')||given('capacity')),
    delayTargetDays:!given('delayTargetDays'),
    stuckDays:!given('stuckDays'),
    cutGate:!given('cutGate'),
    offWeekdays:!given('offWeekdays')
  };
  const allDefault=!known||Object.keys(isDef).every(function(k){return isDef[k];});
  return{S:S,known:known,isDefault:isDef,failedText:known?'':(failedText||'ph_settings could not be read'),
    source:!known?'defaults — ph_settings could not be read':(allDefault?'defaults — nothing saved yet':'saved settings (a field not set there is a default)')};
}
function _phmDef(sv,k){return sv.isDefault[k]?' (default)':'';}

/* ── rows (one per PO behind a number) ─────────────────────────────────── */
function _phmRow(ep,detail,extra){
  const u=phPoUnits(ep);
  return Object.assign({id:ep.id,fbKey:phStr(ep.fbKey).trim()||ep.id,title:_phmTitle(ep),stage:phStageOf(ep),units:u.units,basis:u.basis,detail:detail||''},extra||{});
}
function _phmByIdRows(list,fn){return list.map(function(ep){return _phmRow(ep,fn?fn(ep):'');});}
function _phmSumUnits(rows){let t=0,k=0;rows.forEach(function(r){if(typeof r.units==='number'&&isFinite(r.units)){t+=r.units;k++;}});return{total:t,known:k,unknown:rows.length-k};}

/* ── tiles ─────────────────────────────────────────────────────────────── */
function _phmT(id,label,scope,state,o){
  return Object.assign({id:id,label:label,scope:scope,state:state,value:'',sub:'',cap:'',lines:[],count:0,rows:[],links:[],sum:null,sumLabel:'',unavailable:null,warn:''},o||{});
}
function _phmUnavail(id,label,scope,names){
  return _phmT(id,label,scope,'unavailable',{value:phI18nD('ov.unavailable_x',{names:names.join(', ')}),unavailable:names.slice(),cap:phI18nD('ov.unavailable_needs_x',{names:names.join(' and ')})});
}
function _phmNoData(id,label,scope,text,o){return _phmT(id,label,scope,'nodata',Object.assign({value:text},o||{}));}
function _phmFinish(t){   // a number and the list behind it must agree; if they do not, the tile says so
  if(t.state!=='unavailable'&&t.count!==t.rows.length)t.warn=phI18nD('ov.list_mismatch',{rows:t.rows.length,count:t.count});
  return t;
}

/* ── the model (pure; the DOM below only draws it) ─────────────────────── */
// inp: {now:ms, range:{from,to}, pos:[PO docs]|null, jobs:[po_cut_jobs rows]|null, settingsRaw:{…}|null, errors:{pos,po_cut_jobs,ph_settings}, truncated}
// -> {now,today,range,settings,tiles:{id:tile},attention:{items,rows,count,…},quality,members,rep}
function phmBuildModel(inp){
  const I=_phmObj(inp)?inp:{};
  const now=typeof I.now==='number'&&isFinite(I.now)?I.now:Date.now();
  const today=phDay(now);
  const rg={from:_phmObj(I.range)&&I.range.from?I.range.from:null,to:_phmObj(I.range)&&I.range.to?I.range.to:null};
  const posOk=Array.isArray(I.pos),jobsOk=Array.isArray(I.jobs);
  const sv=_phmSettingsView(_phmObj(I.settingsRaw)?I.settingsRaw:null,I.errors&&I.errors.ph_settings);
  const S=sv.S,rawS=sv.known?I.settingsRaw:{};
  const M={now:now,today:today,range:rg,settings:sv,tiles:{},attention:{items:[],rows:[],count:0,unavailable:null,note:''},quality:{cancelled:0,unknown:0,junk:0,truncated:!!I.truncated,jobsTruncated:!!I.jobsTruncated},members:null,rep:null,avail:{pos:posOk,po_cut_jobs:jobsOk,ph_settings:sv.known}};
  const all=function(names){names.forEach(function(id){M.tiles[id]=_phmUnavail(id,PHM_LABELS[id],PHM_RANGE_TILES.indexOf(id)>-1?'range':'now',['pos']);});};
  if(!posOk){all(PHM_NOW_TILES.concat(PHM_RANGE_TILES,['attention']));M.attention.unavailable=['pos'];return M;}

  const jobsMap=new Map();
  if(jobsOk)I.jobs.forEach(function(j){if(_phmObj(j))jobsMap.set(_phmKey(j.fbKey!=null?j.fbKey:j.poId),j);});
  const eps=[];
  I.pos.forEach(function(po){
    if(!_phmObj(po))return;
    const e=Object.assign({},po);e.id=_phmId(po);
    const job=jobsMap.get(_phmKey(e.id));
    if(e.plannedCutDate==null&&job&&job.plannedCutDate!=null)e.plannedCutDate=job.plannedCutDate;   // the planned day lives on po_cut_jobs
    eps.push(e);
  });
  const O={settings:rawS,now:now,today:today};
  const stageOf=function(e){return phStageOf(e);};
  const inProd=function(e){return PH_REAL_STAGE_ORDER.indexOf(stageOf(e))>-1;};
  const pl=phPipeline(eps);
  M.quality.cancelled=pl.cancelled;M.quality.unknown=pl.unknown;M.quality.junk=pl.junk;
  const byStage={};eps.forEach(function(e){const s=stageOf(e);(byStage[s]=byStage[s]||[]).push(e);});
  const at=function(s){return byStage[s]||[];};
  const inProdList=eps.filter(inProd);

  /* pipeline / afloat / in production / reserved */
  {
    const cnt=_phmJoinD(PH_REAL_STAGE_ORDER.map(function(s){return phI18nD('ov.stage_n',{s:_phmStageLabel(s),n:at(s).length});}),'ov.join_dot');
    const t=_phmT('pipeline',phI18nD('ov.t_pipeline'),'now','ok',{value:_phmN(pl.state==='ok'?pl.inProduction.pos:0),sub:cnt,
      cap:phI18nD('ov.t_pipeline_cap'),count:pl.state==='ok'?pl.inProduction.pos:0,
      rows:_phmByIdRows(inProdList,function(e){return phI18nD('ov.at_stage',{stage:_phmStageLabel(stageOf(e))});})});
    const unk=at('unknown');
    if(unk.length)t.links.push({label:phI18nD('ov.unrecognised_link',{po:_phmPoD(unk.length,'po')}),count:unk.length,rows:_phmByIdRows(unk,function(e){return phI18nD('ov.stage_colon',{v:phStr(e.currentStage).trim()||phStr(e.poStatus).trim()||'—'});})});
    M.tiles.pipeline=_phmFinish(t);
  }
  {
    const list=at('cutting'),rows=_phmByIdRows(list,function(e){const u=phPoUnits(e);return u.units===null?phI18nD('ov.no_qty_on_po'):phI18nD('ov.pcs_ordered',{n:_phmN(u.units)});});
    const sm=_phmSumUnits(rows);
    const t=_phmT('afloat',phI18nD('ov.t_afloat'),'now','ok',{value:_phmN(pl.state==='ok'?pl.afloat.units:0),sub:sm.unknown?phI18nD('ov.sub_afloat_noqty',{po:_phmPoD(list.length,'po'),noq:phI18nD('ov.n_po_noqty',{po:_phmPoD(sm.unknown,'po')})}):phI18nD('ov.t_afloat_sub',{po:_phmPoD(list.length,'po')}),
      cap:phI18nD('ov.t_afloat_cap'),count:pl.state==='ok'?pl.afloat.pos:0,rows:rows,sum:sm.total,sumLabel:phI18nD('ov.sum_pieces_ordered')});
    M.tiles.afloat=_phmFinish(t);
    if(pl.state==='ok'&&pl.afloat.units!==sm.total)M.tiles.afloat.warn=phI18nD('ov.sum_differs',{n:_phmN(sm.total)});
  }
  {
    const rows=_phmByIdRows(inProdList,function(e){const u=phPoUnits(e);return u.units===null?phI18nD('ov.no_qty'):phI18nD('ov.pcs_actual_or_ordered',{n:_phmN(u.units),basis:phI18nD(u.basis==='cut'?'ov.basis_cut':'ov.basis_ordered')});});
    const sm=_phmSumUnits(rows);
    const t=_phmT('inProduction',phI18nD('ov.t_inprod'),'now','ok',{value:_phmN(pl.state==='ok'?pl.inProduction.units:0),sub:sm.unknown?phI18nD('ov.sub_inprod_noqty',{po:_phmPoD(inProdList.length,'po'),noq:phI18nD('ov.n_po_noqty',{po:_phmPoD(sm.unknown,'po')})}):phI18nD('ov.t_inprod_sub',{po:_phmPoD(inProdList.length,'po')}),
      cap:phI18nD('ov.t_inprod_cap'),count:pl.state==='ok'?pl.inProduction.pos:0,rows:rows,sum:sm.total,sumLabel:phI18nD('ov.sum_pieces_actual')});
    M.tiles.inProduction=_phmFinish(t);
    if(pl.state==='ok'&&pl.inProduction.units!==sm.total)M.tiles.inProduction.warn=phI18nD('ov.sum_differs',{n:_phmN(sm.total)});
  }
  {
    const list=at('reserved');
    M.tiles.reserved=_phmFinish(_phmT('reserved',phI18nD('ov.t_reserved'),'now','ok',{value:_phmN(list.length),sub:phI18nD('ov.t_reserved_sub'),
      cap:phI18nD('ov.t_reserved_cap'),count:pl.state==='ok'?pl.counts.reserved:0,rows:_phmByIdRows(list,function(e){const u=phPoUnits(e);return u.units===null?phI18nD('ov.no_qty'):phI18nD('ov.pcs_reserved',{n:_phmN(u.units)});})}));
  }

  /* stuck / delayed / over the cut gate */
  const items=[],noStart=[],unjudged=[];
  const fiMap=_phmObj(I.firstIssueById)?I.firstIssueById:null,basis={issue:0,release:0,passesOk:!!I.passesOk};
  inProdList.forEach(function(ep){
    const st=stageOf(ep),sl=_phmStageLabel(st);
    let l=null,since='';
    if(st==='cutting'){
      // start: the FIRST fabric-issue gate pass when there is one (matched through phPoKey, so '125' and 'PO-125' agree), else the release date
      const pk=phPoKey(ep.id),fi=pk!==null&&fiMap&&Object.prototype.hasOwnProperty.call(fiMap,pk)?fiMap[pk]:null;
      l=phLeadTime(ep,fi!==null?Object.assign({},O,{issueAt:fi}):O);
      if(l.quality.indexOf('start_from_ts')>-1||l.quality.indexOf('no_issue')>-1){noStart.push(ep);return;}
      if(fi!==null){since=phI18nD('ov.since_issue');basis.issue++;}else{since=phI18nD('ov.since_release');basis.release++;}
    }else{
      const prev=PH_REAL_STAGE_ORDER[PH_REAL_STAGE_ORDER.indexOf(st)-1];
      const sg=_phmObj(ep.stages)?ep.stages[prev]:null;
      let entry=sg&&phMs(sg.doneAt)!==null?sg.doneAt:null;
      if(entry===null&&prev==='cutting'&&phMs(ep.cutAt)!==null)entry=ep.cutAt;
      if(entry===null){noStart.push(ep);return;}
      l=phLeadTime({id:ep.id,fabricIssuedAt:entry},O);
      since=phI18nD('ov.done_'+prev);
    }
    if(l.state!=='open'){unjudged.push(ep);return;}
    const reasons=[];
    let kind=null;
    if(l.status==='stuck'){kind='stuck';reasons.push(phI18nD('ov.r_stuck',{days:_phmDaysD(l.ageDays),stage:sl,day:_phmDayLabel(l.startDay),since:since,lim:S.stuckDays,def:_phmDefD(sv,'stuckDays')}));}
    else if(st==='cutting'&&l.status==='delayed'){kind='delayed';reasons.push(phI18nD('ov.r_delayed',{days:_phmDaysD(l.ageDays),since:since,day:_phmDayLabel(l.startDay),tgt:S.delayTargetDays,def:_phmDefD(sv,'delayTargetDays')}));}
    if(st==='cutting'&&jobsOk){
      const g=phDelayGap(ep,undefined,O);
      if(g.state==='overdue'){kind=kind||'delayed';reasons.push(phI18nD('ov.r_planned_passed',{day:_phmDayLabel(g.plannedDay),days:_phmDaysD(g.days)}));}
    }
    if(kind)items.push({kind:kind,ep:ep,age:l.ageDays,text:_phmJoinD(reasons,'ov.join_semi')});
  });
  inProdList.forEach(function(ep){   // a PO already completed is history: nothing can still be done about its cut
    const u=phPoUnits(ep),qty=phWhole(ep.qty);
    if(u.basis!=='cut'||qty===null||qty<=0)return;
    const c=phCutCheck(qty,u.units,{gate:S.cutGate});
    if(c.verdict!=='needs_override')return;
    if(_phmObj(ep.cutOverride)&&ep.cutOverride.by)return;   // approved by an owner: it is on record
    items.push({kind:'overgate',ep:ep,age:0,text:phI18nD('ov.r_overgate',{u:_phmN(u.units),q:_phmN(qty),pct:phRound(u.units/qty*100,0),lo:c.gate[0],hi:c.gate[1],min:_phmN(c.min),max:_phmN(c.max),def:_phmDefD(sv,'cutGate')})});
  });
  items.sort(function(a,b){return(PHM_KIND_RANK[b.kind]-PHM_KIND_RANK[a.kind])||(b.age-a.age)||(a.ep.id<b.ep.id?-1:a.ep.id>b.ep.id?1:0);});
  const attRows=items.map(function(it){return _phmRow(it.ep,it.text,{kind:it.kind,kindLabel:PHM_KIND_LABEL[it.kind]});});
  const nStuck=items.filter(function(i){return i.kind==='stuck';}).length,nDelayed=items.filter(function(i){return i.kind==='delayed';}).length,nGate=items.filter(function(i){return i.kind==='overgate';}).length;
  M.stuckBasis=basis;
  M.attention={items:items,rows:attRows,count:items.length,counts:{stuck:nStuck,delayed:nDelayed,overgate:nGate},unavailable:null,noStart:noStart.length,
    note:jobsOk?'':phI18nD('ov.jobs_unread_delays')};
  {
    const stuckRows=attRows.filter(function(r){return r.kind==='stuck';});
    const t=_phmT('stuck',phI18nD('ov.t_stuck'),'now','ok',{value:_phmN(nStuck),sub:phI18nD(sv.isDefault.stuckDays?'ov.stuck_sub_def':'ov.t_stuck_sub',{n:S.stuckDays}),
      cap:basis.passesOk?phI18nD('ov.stuck_cap_ok',{a:_phmPoD(basis.issue,'po'),b:_phmPoD(basis.release,'po')}):phI18nD('ov.stuck_cap_nopass'),count:nStuck,rows:stuckRows});
    if(noStart.length)t.links.push({label:phI18nD('ov.nostart_link',{po:_phmPoD(noStart.length,'openpo')}),count:noStart.length,rows:_phmByIdRows(noStart,function(e){return phI18nD('ov.r_at_no_date',{stage:_phmStageLabel(stageOf(e))});})});
    M.tiles.stuck=_phmFinish(t);
  }
  {
    const sub=phI18nD('ov.attention_summary',{stuck:nStuck,delayed:nDelayed,gate:nGate});
    M.tiles.attention=_phmFinish(_phmT('attention',phI18nD('ov.t_attention'),'now','ok',{value:_phmN(items.length),sub:sub,
      cap:jobsOk?phI18nD('ov.attn_cap2',{n:S.delayTargetDays,def:_phmDefD(sv,'delayTargetDays')}):phI18nD('ov.attn_cap2_note',{cap:phI18nD('ov.attn_cap2',{n:S.delayTargetDays,def:_phmDefD(sv,'delayTargetDays')}),note:M.attention.note}),count:items.length,rows:attRows}));
  }

  /* load against capacity for the next 14 days */
  const cutting=at('cutting');
  const allocIn=cutting.map(function(e){return{id:e.id,qty:phPoUnits(e).units,requestedDay:e.plannedCutDate!=null?e.plannedCutDate:e.requestedDate};});
  const alloc=phAllocate(allocIn,Object.assign({},rawS,{startDay:today}));
  let epById=new Map();eps.forEach(function(e){if(!epById.has(e.id))epById.set(e.id,e);});
  M.alloc=alloc;
  if(!alloc.ok){
    M.tiles.capacity=_phmUnavail('capacity','Load, next '+PHM_CAP_DAYS+' days','now',['pos']);
    M.tiles.capacity.value='cannot be planned ('+alloc.reason+')';
  }else{
    const endDay=phDayAdd(today,PHM_CAP_DAYS-1);
    let wd=0;for(let i=0;i<PHM_CAP_DAYS;i++){if(phIsWorkday(phDayAdd(today,i),rawS))wd++;}
    let load=0,spill=0;alloc.days.forEach(function(d){if(d.day<=endDay)load+=d.units;else spill+=d.units;});
    const capIn=S.dailyCapacity*wd,queued=load+spill;
    const rows=[];
    alloc.order.forEach(function(id){
      const e=epById.get(id),r=alloc.byId[id];if(!e)return;
      rows.push(_phmRow(e,'starts '+_phmDayLabel(r.startDay)+', finishes '+_phmDayLabel(r.finishDay)+(r.finishDay>endDay?' — after the '+PHM_CAP_DAYS+'-day window':''),{after:r.finishDay>endDay}));
    });
    alloc.unscheduled.forEach(function(u){const e=epById.get(u.id);if(e)rows.push(_phmRow(e,'not planned: '+(u.reason==='bad_qty'?'no quantity on the PO':u.reason)));});
    const status=queued===0?'Nothing queued for cutting':(spill>0?'Over capacity by '+_phmN(spill)+' pcs — work spills past '+_phmDayLabel(endDay):'Within capacity');
    const t=_phmT('capacity','Load, next '+PHM_CAP_DAYS+' days','now',capIn>0?'ok':'nodata',{
      value:capIn>0?phRound(load/capIn*100,0)+'%':'—',
      sub:_phmN(load)+' of '+_phmN(capIn)+' pcs capacity ('+_phmN(S.dailyCapacity)+'/day'+_phmDef(sv,'dailyCapacity')+' × '+wd+' working days)',
      cap:'POs at cutting, planned in order of requested day from today; ordered quantity. '+status+'.',count:cutting.length,rows:rows,status:status,over:spill>0,spill:spill,load:load,capacity:capIn,queued:queued,windowEnd:endDay,workdays:wd});
    M.tiles.capacity=_phmFinish(t);
  }
  /* queue delay: working days vs calendar days against the requested / planned day */
  if(!jobsOk){M.tiles.queueDelay=_phmUnavail('queueDelay','Queue delay vs requested day','now',['po_cut_jobs']);}
  else{
    const withReq=alloc.ok?alloc.jobs.filter(function(j){return j.delayDays!==null||j.delayCalendarDays!==null;}):[];
    const wk=withReq.filter(function(j){return j.delayDays!==null;}).map(function(j){return j.delayDays;}),cal=withReq.map(function(j){return j.delayCalendarDays;}).filter(function(v){return v!==null;});
    if(!withReq.length)M.tiles.queueDelay=_phmNoData('queueDelay','Queue delay vs requested day','now','no data yet',{sub:'no PO at cutting has a planned or requested cut day',cap:'Working days skip the weekly off days and skip days in the settings; calendar days do not.'});
    else{
      const mw=wk.length?phRound(wk.reduce(function(a,b){return a+b;},0)/wk.length,1):null,mc=phRound(cal.reduce(function(a,b){return a+b;},0)/cal.length,1);
      const late=withReq.filter(function(j){return j.late===true;}).length;
      const rows=withReq.map(function(j){const e=epById.get(j.id);return _phmRow(e,'requested '+_phmDayLabel(j.requestedDay)+', finishes '+_phmDayLabel(j.finishDay)+': '+(j.delayDays===null?'— working':_phmSigned(j.delayDays)+' working days')+' / '+_phmSigned(j.delayCalendarDays)+' calendar days');});
      M.tiles.queueDelay=_phmFinish(_phmT('queueDelay','Queue delay vs requested day','now','ok',{value:_phmSigned(mw)+' working days',sub:_phmSigned(mc)+' calendar days · average of '+_phmPlural(withReq.length,'PO')+' · '+late+' late',
        cap:'How far the planned finish of each PO at cutting is from its planned or requested cut day: + is late. Working days skip the weekly off days and skip days ('+(S.offWeekdays.length?S.offWeekdays.length+' off weekday(s)':'no weekly off days')+_phmDef(sv,'offWeekdays')+'); calendar days do not.',count:withReq.length,rows:rows,late:late,workingAvg:mw,calendarAvg:mc}));
    }
  }

  /* range tiles: phReport, with the list of POs behind each number read off phReport itself */
  const jobDOf=function(ep){
    if(phMs(ep.cutAt)===null||!_phmObj(ep.cutQty))return null;
    const jb=jobsMap.get(_phmKey(ep.id));
    return{id:ep.id,poId:ep.id,master:jb?phStr(jb.masterName):'',cutAt:ep.cutAt,cutUnits:ep.cutQty,articleCode:ep.code,sizeModel:ep.sizeModel,sizeAxis:ep.sizeAxis};
  };
  const jobsD=[];eps.forEach(function(e){const j=jobDOf(e);if(j)jobsD.push(j);});
  const rep=phReport(eps,jobsD,rg,O);
  M.rep=rep;
  if(rep.ok===false){
    PHM_RANGE_TILES.forEach(function(id){M.tiles[id]=_phmUnavail(id,PHM_LABELS[id],'range',['a valid date range']);});
    return M;
  }
  const mem={issued:[],issueQty:[],cut:[],lead:[],noStart:[],invalid:[],gap:[],noPlan:[]};
  eps.forEach(function(ep){
    const jd=jobDOf(ep),r=phReport([ep],jd?[jd]:[],rg,O);
    if(!r||r.ok===false)return;
    if(r.seasons.reduce(function(a,s){return a+s.pos;},0)>0)mem.issued.push(ep);
    if(r.avgPoIssueQty.n>0)mem.issueQty.push(ep);
    if(r.avgCutQty.n>0)mem.cut.push(ep);
    if(r.leadTime.n>0)mem.lead.push(ep);
    if(r.leadTime.noStart>0)mem.noStart.push(ep);
    if(r.leadTime.invalid>0)mem.invalid.push(ep);
    if(r.delayGap.n>0)mem.gap.push(ep);
    if(r.delayGap.noPlan>0)mem.noPlan.push(ep);
  });
  M.members=mem;
  const allTime=(rg.from===null&&rg.to===null)?rep:phReport(eps,jobsD,{},O);
  const rangeWord=(rg.from===null&&rg.to===null)?'':' in this range';
  const startTxt=function(ep){const l=phLeadTime(ep,O);return l.startDay?(_phmDayLabel(l.startDay)+(l.quality.indexOf('start_from_ts')>-1?' (creation date, no release date)':'')):'—';};
  // seasons
  {
    const total=rep.seasons.reduce(function(a,s){return a+s.pos;},0);
    if(!total)M.tiles.seasons=_phmNoData('seasons','Season split','range','no data yet',{sub:'no PO was issued'+rangeWord});
    else{
      const t=_phmT('seasons','Season split','range','ok',{value:_phmPlural(total,'PO'),sub:'issued'+rangeWord+', by season',
        cap:'A season stored on the PO is used. Otherwise it is guessed from the dates and marked guessed: a winter garment is cut in the summer, so the date alone can mislabel it.',count:total,
        rows:_phmByIdRows(mem.issued,function(e){const s=phSeasonOf(e);return'issued '+startTxt(e)+' · '+(s.key?phSeasonLabel(s.key):phI18nD('queue.no_season'))+(s.guess?' (guessed)':s.key?' (stored)':'');})});
      rep.seasons.forEach(function(s){t.lines.push({text:s.label+' · '+_phmPlural(s.pos,'PO')+' · '+(s.units?_phmN(s.units)+' pcs':phI18nD('ov.no_qty'))+(s.noUnits&&s.units?' (+'+s.noUnits+' with none)':''),flag:s.guessed?(s.guessed===s.pos?'all guessed':s.guessed+' guessed'):''});});
      M.tiles.seasons=_phmFinish(t);
    }
  }
  // average issue quantity
  {
    const m=rep.avgPoIssueQty;
    if(!m.n)M.tiles.avgIssue=_phmNoData('avgIssue','Average PO issue quantity','range','no data yet',{sub:'no issued PO with a quantity'+rangeWord});
    else M.tiles.avgIssue=_phmFinish(_phmT('avgIssue','Average PO issue quantity','range','ok',{value:_phmN(m.value)+' pcs',sub:'n = '+m.n+' issued POs · total '+_phmN(m.total)+' pcs',
      cap:'Ordered quantity of released POs issued'+(rangeWord||' in any period')+'. Issued = the release date (the PO has no issue date of its own).',count:m.n,
      rows:_phmByIdRows(mem.issueQty,function(e){const u=phPoUnits(e);return'issued '+startTxt(e)+' · '+_phmN(phWhole(e.qty)!==null?phWhole(e.qty):u.units)+' pcs ordered';})}));
  }
  // average cut quantity
  {
    const m=rep.avgCutQty;
    if(!m.n){
      const none=!allTime.avgCutQty.n;
      M.tiles.avgCut=_phmNoData('avgCut','Average cut quantity','range',none?'No cut recorded yet':'No cut recorded in this range',{sub:none?'no PO has a recorded cut (cut date and cut quantity)':_phmPlural(allTime.avgCutQty.n,'cut')+' on record in other periods'});
    }else{
      M.tiles.avgCut=_phmFinish(_phmT('avgCut','Average cut quantity','range','ok',{value:_phmN(m.value)+' pcs',sub:'n = '+m.n+' cuts · total '+_phmN(m.total)+' pcs',
        cap:'The actual cut quantity recorded on cut POs, by cut day'+rangeWord+'.',count:m.n,
        rows:_phmByIdRows(mem.cut,function(e){const u=phPoUnits(e);return'cut '+_phmDayLabel(phDay(e.cutAt))+' · '+_phmN(u.basis==='cut'?u.units:null)+' pcs cut';})}));
    }
  }
  // lead time
  {
    const m=rep.leadTime;
    const links=[];
    if(m.noStart)links.push({label:_phmPlural(m.noStart,'PO')+' with no start date — not averaged',count:m.noStart,rows:_phmByIdRows(mem.noStart,function(e){return'cut '+_phmDayLabel(phDay(e.cutAt))+', but the PO has no release or issue date';})});
    if(m.invalid)links.push({label:_phmPlural(m.invalid,'PO')+' cut before its start date — not averaged',count:m.invalid,rows:_phmByIdRows(mem.invalid,function(e){return'cut '+_phmDayLabel(phDay(e.cutAt))+' is before its start date';})});
    if(!m.n){
      const t=_phmNoData('leadTime','Lead time','range','no data yet',{sub:'no cut PO with a real start date'+rangeWord+(m.noStart?' · '+m.noStart+' with no start date':''),links:links});
      M.tiles.leadTime=t;
    }else{
      M.tiles.leadTime=_phmFinish(_phmT('leadTime','Lead time','range','ok',{value:_phmN(m.value)+' days',sub:'n = '+m.n+' cut POs'+(m.late?' · '+m.late+' over the '+S.delayTargetDays+'-day target'+_phmDef(sv,'delayTargetDays'):'')+(m.noStart?' · '+m.noStart+' with no start date':''),
        cap:'Calendar days from the start to the cut day, by cut day'+rangeWord+'. The start is the PO\'s release date; a PO with no real start date is counted apart and never averaged.',count:m.n,links:links,
        rows:_phmByIdRows(mem.lead,function(e){const l=phLeadTime(e,O);return _phmDayLabel(l.startDay)+' → '+_phmDayLabel(l.endDay)+' = '+_phmPlural(l.days,'day');})}));
    }
  }
  // delay gap, cut day vs planned day (calendar days)
  if(!jobsOk)M.tiles.cutGap=_phmUnavail('cutGap','Delay gap, cut vs planned','range',['po_cut_jobs']);
  else{
    const m=rep.delayGap;
    const links=[];
    if(m.noPlan)links.push({label:_phmPlural(m.noPlan,'cut PO')+' with no planned cut day',count:m.noPlan,rows:_phmByIdRows(mem.noPlan,function(e){return'cut '+_phmDayLabel(phDay(e.cutAt))+', no planned day to compare with';})});
    if(!m.n)M.tiles.cutGap=_phmNoData('cutGap','Delay gap, cut vs planned','range','no data yet',{sub:'no cut PO with a planned cut day'+rangeWord+(m.noPlan?' · '+m.noPlan+' with no planned day':''),links:links});
    else M.tiles.cutGap=_phmFinish(_phmT('cutGap','Delay gap, cut vs planned','range','ok',{value:_phmSigned(m.value)+' days',sub:'n = '+m.n+' · '+m.late+' late · '+m.onTime+' on time · '+m.early+' early · '+m.pctLate+'% late',
      cap:'Cut day minus the planned cut day, in calendar days (+ is late), by cut day'+rangeWord+'. Working-day delay of the open queue is the tile "Queue delay".',count:m.n,links:links,
      rows:_phmByIdRows(mem.gap,function(e){const g=phDelayGap(e,undefined,O);return'planned '+_phmDayLabel(g.plannedDay)+', cut '+_phmDayLabel(g.cutDay)+': '+_phmSigned(g.days)+' days ('+g.state.replace('_',' ')+')';})}));
  }
  return M;
}
const PHM_LABELS=Object.freeze({pipeline:phI18nD('ov.t_pipeline'),afloat:phI18nD('ov.t_afloat'),inProduction:phI18nD('ov.t_inprod'),reserved:phI18nD('ov.t_reserved'),stuck:phI18nD('ov.t_stuck'),attention:phI18nD('ov.t_attention'),
  capacity:'Load, next '+PHM_CAP_DAYS+' days',queueDelay:'Queue delay vs requested day',seasons:'Season split',avgIssue:'Average PO issue quantity',avgCut:'Average cut quantity',leadTime:'Lead time',cutGap:'Delay gap, cut vs planned'});

/* ── the read of `pos` (the data layer does not load PO documents) ─────── */
let _phmPos={state:'idle',rows:null,at:null,err:null,errText:'',truncated:false,p:null,refreshing:false};
function _phmErrInfo(e){
  const code=e&&e.code?String(e.code):'';
  const message=e&&e.message?String(e.message):(e==null?'unknown error':String(e));
  return{code:code,message:message,permission:code==='permission-denied'||message.indexOf('permissions')>-1,quota:code==='resource-exhausted'||/429|quota/i.test(message)};
}
function _phmErrText(i){
  if(i.permission)return'pos: could not be read - permission denied. Check the firestore.rules block for pos and that the published rules match the repo, then retry.';
  if(i.quota)return'pos: the Firestore read quota is used up - retry later.';
  if(i.code==='from-cache')return'pos: only this device\'s offline copy was available, so it was not read - get a connection and retry.';
  if(i.code==='timeout')return'pos: the read did not finish in '+Math.round(PHM_READ_TIMEOUT_MS/1000)+'s - check the connection and retry.';
  return'pos: read failed ('+(i.message||i.code||'unknown')+').';
}
function _phmWithTimeout(p,ms){
  let t;
  const timeout=new Promise(function(_,rej){t=setTimeout(function(){const e=new Error('read timed out');e.code='timeout';rej(e);},ms);});
  return Promise.race([p,timeout]).then(function(v){clearTimeout(t);return v;},function(e){clearTimeout(t);throw e;});
}
async function _phmReadPosOnce(){
  const snap=await _phmWithTimeout(getDocs(query(collection(db,'pos'),orderBy('ts','desc'),limit(PHM_MAX_POS))),PHM_READ_TIMEOUT_MS);
  if(snap&&snap.metadata&&snap.metadata.fromCache===true){const e=new Error('the read was answered from this device\'s offline copy, not from the server');e.code='from-cache';throw e;}
  const docs=(snap&&snap.docs)||[];
  return{rows:docs.map(function(d){return Object.assign({},d.data(),{fbKey:d.id});}),truncated:docs.length>=PHM_MAX_POS};
}
// Never rejects. A fresh read is reused for PHM_STALE_MS; a read in flight is shared; `force` re-reads.
function phmLoadPos(force){
  if(_phmPos.p)return _phmPos.p;
  if(!force&&_phmPos.state==='ok'&&_phmPos.at!==null&&Date.now()-_phmPos.at<PHM_STALE_MS)return Promise.resolve(_phmPos);
  if(_phmPos.state!=='ok')_phmPos.state='loading';else _phmPos.refreshing=true;
  const p=(async function(){
    let r,err=null;
    try{r=await _phmReadPosOnce();}
    catch(e){
      err=_phmErrInfo(e);
      if(err.permission&&typeof auth!=='undefined'&&auth&&auth.currentUser&&typeof auth.currentUser.getIdToken==='function'){
        try{await auth.currentUser.getIdToken(true);r=await _phmReadPosOnce();err=null;}catch(e2){err=_phmErrInfo(e2);}
      }
    }
    if(err){
      _phmPos={state:'error',rows:null,at:Date.now(),err:err,errText:_phmErrText(err),truncated:false,p:null,refreshing:false};
      if(typeof console!=='undefined')console.warn('[ph-mod-monitor] pos failed:',err.code||err.message);
    }else{
      _phmPos={state:'ok',rows:r.rows,at:Date.now(),err:null,errText:'',truncated:r.truncated,p:null,refreshing:false};
    }
    return _phmPos;
  })().catch(function(e){_phmPos={state:'error',rows:null,at:Date.now(),err:_phmErrInfo(e),errText:_phmErrText(_phmErrInfo(e)),truncated:false,p:null,refreshing:false};return _phmPos;});
  _phmPos.p=p;
  return p;
}
function phmReset(){_phmPos={state:'idle',rows:null,at:null,err:null,errText:'',truncated:false,p:null,refreshing:false};_phmRange={preset:'month',from:'',to:'',error:''};_phmDrawer=null;}

/* ── open a PO's detail page from a row (managers only) ────────────────── */
// openPODetail (js/pos.js) bypasses page scoping and sets currentPage itself, so the takeover comes down first (the same
// order ph-mod-queue's phqOpenPO uses). Managers only: Kashif's Overview rows are plain text, and this refuses him too.
function phmCanOpenPO(u){
  const w=u!==undefined?(typeof u==='string'?u:''):((typeof session!=='undefined'&&session&&typeof session.u==='string')?session.u:'');
  return typeof phCanManage==='function'&&phCanManage(w)===true&&typeof window!=='undefined'&&!!window&&typeof window.openPODetail==='function';
}
function phmOpenPO(fbKey){
  const k=phStr(fbKey).trim();
  if(!phmCanOpenPO()||!/^[A-Za-z0-9_-]{1,60}$/.test(k))return false;
  phmCloseDrawer(false);
  try{if(typeof _phTkLeave==='function')_phTkLeave();}catch(e){}
  window.openPODetail(k);
  return true;
}
function _phmOpenBtn(r){
  const b=phEl('button','ph-btn phm-open',phI18nD('queue.open',{po:r.id}));
  b.setAttribute('type','button');b.setAttribute('data-act','open-po');b.setAttribute('data-po',r.fbKey||r.id);
  b.setAttribute('aria-label',phI18nAttr(phI18nD('ov.open_detail_aria',{po:r.id})));
  b.addEventListener('click',function(){phmOpenPO(r.fbKey||r.id);});
  return b;
}

/* ── drawer: the POs behind a number ───────────────────────────────────── */
let _phmDrawer=null;     // {el, opener}
function phmCloseDrawer(restore){
  const d=_phmDrawer;_phmDrawer=null;
  if(!d||!d.el)return false;
  try{if(d.el.parentNode)d.el.parentNode.removeChild(d.el);}catch(e){}
  if(restore&&d.opener&&typeof d.opener.focus==='function'){try{d.opener.focus();}catch(e){}}
  return true;
}
function _phmEscape(){return _phmDrawer&&_phmDrawer.el&&_phmDrawer.el.parentNode?phmCloseDrawer(true):false;}
function phmOpenDrawer(host,spec,opener){
  phmCloseDrawer(false);
  const E=phEl;
  const wrap=E('div','phm-drawer-wrap');
  const scrim=E('button','phm-scrim');scrim.setAttribute('type','button');scrim.setAttribute('aria-label',phI18nAttr(phI18nD('ov.close_list')));scrim.setAttribute('tabindex','-1');
  scrim.addEventListener('click',function(){phmCloseDrawer(true);});
  const panel=E('div','phm-drawer');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',phI18nAttr(phI18nD('ov.pos_behind',{title:spec.title})));
  const head=E('div','phm-drawer-head');
  const ttl=E('div','phm-drawer-title',spec.title);
  const cnt=E('span','ph-chip phm-drawer-count',_phmPoD(spec.rows.length,'po'));
  const close=E('button','ph-btn phm-drawer-close',phI18nD('ov.btn_close'));close.setAttribute('type','button');close.addEventListener('click',function(){phmCloseDrawer(true);});
  head.appendChild(ttl);head.appendChild(cnt);head.appendChild(close);
  panel.appendChild(head);
  if(spec.note)panel.appendChild(E('p','phm-drawer-note',spec.note));
  if(spec.sum!==null&&spec.sum!==undefined)panel.appendChild(E('p','phm-drawer-sum',phI18nD('ov.sum_of_list2',{n:_phmN(spec.sum),label:spec.sumLabel||phI18nD('ov.pieces')})));
  const ul=E('ul','phm-rows');
  if(!spec.rows.length)ul.appendChild(E('li','phm-row phm-row-empty',phI18nD('ov.no_pos_behind')));
  spec.rows.forEach(function(r){
    const li=E('li','phm-row');
    const top=E('div','phm-row-top');
    top.appendChild(E('span','phm-row-id',r.id));
    if(r.kindLabel)top.appendChild(E('span','ph-chip phm-kind phm-kind-'+r.kind,r.kindLabel));
    top.appendChild(E('span','ph-chip phm-stage',_phmStageLabel(r.stage)));
    top.appendChild(E('span','phm-row-units',r.units===null||r.units===undefined?phI18nD('ov.no_qty'):phI18nD('queue.pcs',{n:_phmN(r.units)})));
    li.appendChild(top);
    li.appendChild(E('div','phm-row-title',r.title));
    if(r.detail)li.appendChild(E('div','phm-row-detail',r.detail));
    if(typeof phmkApply==='function')phmkApply(li,r.fbKey||r.id);
    if(spec.openable&&phmCanOpenPO())li.appendChild(_phmOpenBtn(r));
    ul.appendChild(li);
  });
  panel.appendChild(ul);
  panel.addEventListener('keydown',function(ev){
    if(ev.key!=='Tab')return;
    if(ev.preventDefault)ev.preventDefault();close.focus();   // the dialog has one focusable control: keep focus inside it
  });
  wrap.appendChild(scrim);wrap.appendChild(panel);
  host.appendChild(wrap);
  _phmDrawer={el:wrap,opener:opener||null};
  try{close.focus();}catch(e){}
  return wrap;
}

/* ── drawing ───────────────────────────────────────────────────────────── */
let _phmRange={preset:'month',from:'',to:'',error:''};
function _phmTileEl(t,host){
  const E=phEl;
  const box=E('div','phm-tile phm-st-'+t.state+(t.state==='ok'&&t.id==='capacity'&&t.over?' phm-over':''));
  box.setAttribute('data-tile',t.id);
  const clickable=t.state!=='unavailable';
  const main=E(clickable?'button':'div','phm-tile-main');
  if(clickable){
    main.setAttribute('type','button');
    main.setAttribute('aria-label',phI18nAttr(phI18nD('ov.tile_aria',{label:t.label,value:t.value,po:_phmPoD(t.rows.length,'po')})));
  }
  const top=E('div','phm-tile-top');
  top.appendChild(E('span','phm-tile-label',t.label));
  top.appendChild(E('span','phm-scope phm-scope-'+t.scope,t.scope==='range'?phI18nD('ov.scope_in_range'):phI18nD('ov.scope_now')));
  main.appendChild(top);
  main.appendChild(E('div','phm-tile-val'+(t.state==='ok'?'':' phm-val-soft'),t.value));
  if(t.sub)main.appendChild(E('div','phm-tile-sub',t.sub));
  if(t.lines.length){
    const ul=E('ul','phm-tile-lines');
    t.lines.forEach(function(l){const li=E('li','phm-tile-line',l.text);if(l.flag)li.appendChild(E('span','phm-guess',' '+(l.flag.indexOf('guess')>-1?'~ ':'')+l.flag));ul.appendChild(li);});
    main.appendChild(ul);
  }
  if(t.cap)main.appendChild(E('div','phm-tile-cap',t.cap));
  if(clickable)main.appendChild(E('div','phm-tile-foot',phI18nD('ov.show_pos_foot',{po:_phmPoD(t.rows.length,'po')})));
  if(clickable)main.addEventListener('click',function(){phmOpenDrawer(host,{title:t.label,rows:t.rows,note:t.cap,sum:t.sum,sumLabel:t.sumLabel,openable:t.id==='attention'},main);});
  box.appendChild(main);
  t.links.forEach(function(l){
    const b=E('button','phm-sublink',phI18nD('ov.sublink',{label:l.label}));b.setAttribute('type','button');
    b.addEventListener('click',function(){phmOpenDrawer(host,{title:phI18nD('ov.drawer_title_link',{t:t.label,l:l.label}),rows:l.rows,note:''},b);});
    box.appendChild(b);
  });
  if(t.warn){const w=E('div','phm-warn',t.warn);w.setAttribute('role','alert');box.appendChild(w);}
  return box;
}
function _phmTilesEl(ids,M,host){
  const g=phEl('div','phm-grid');
  ids.forEach(function(id){if(M.tiles[id])g.appendChild(_phmTileEl(M.tiles[id],host));});
  return g;
}
function _phmAttentionCard(M,host,opts){
  const E=phEl,o=opts||{};
  const card=E('section','ph-card phm-att');
  card.appendChild(E('h3','ph-card-title',phI18nD('ov.t_attention')));
  if(M.attention.unavailable){
    card.appendChild(E('p','phm-val-soft',phI18nD('ov.unavailable_x',{names:M.attention.unavailable.join(', ')})));
    return card;
  }
  const rows=M.attention.rows;
  if(!rows.length)card.appendChild(E('p','ph-note',M.attention.noStart?phI18nD('ov.attention_none_judged'):phI18nD('ov.attention_none')));
  const ul=E('ul','phm-att-list');
  rows.slice(0,o.limit||rows.length).forEach(function(r){
    const li=E('li','phm-att-row');
    const top=E('div','phm-row-top');
    top.appendChild(E('span','ph-chip phm-kind phm-kind-'+r.kind,r.kindLabel));
    top.appendChild(E('span','phm-row-id',r.id));
    top.appendChild(E('span','ph-chip phm-stage',_phmStageLabel(r.stage)));
    li.appendChild(top);
    li.appendChild(E('div','phm-row-title',r.title));
    li.appendChild(E('div','phm-row-detail',r.detail));
    if(typeof phmkApply==='function')phmkApply(li,r.fbKey||r.id);
    if(phmCanOpenPO())li.appendChild(_phmOpenBtn(r));
    ul.appendChild(li);
  });
  card.appendChild(ul);
  if(rows.length>(o.limit||rows.length)){
    const b=E('button','ph-btn phm-more',phI18nD('ov.show_all',{n:rows.length}));b.setAttribute('type','button');
    b.addEventListener('click',function(){phmOpenDrawer(host,{title:phI18nD('ov.t_attention'),rows:rows,note:M.tiles.attention?M.tiles.attention.cap:'',openable:true},b);});
    card.appendChild(b);
  }
  if(M.attention.note)card.appendChild(E('p','phm-note-soft',M.attention.note));
  if(M.attention.noStart)card.appendChild(E('p','phm-note-soft',phI18nD('ov.attention_no_start2',{po:_phmPoD(M.attention.noStart,'openpo')})));
  return card;
}
function _phmStageLine(row){   // the shell's per-collection status line, same classes
  const E=phEl,li=E('li','ph-line');
  li.appendChild(E('span','ph-line-name',row.label));
  li.appendChild(E('code','ph-code',row.name));
  let chip,txt;
  if(row.state==='ok'){
    chip=E('span','ph-chip ph-chip-ok',phI18nD('shell.chip_loaded'));
    txt=row.doc?(row.n?phI18nD('shell.saved'):phI18nD('shell.none_saved_defaults')):phI18nD(row.n===1?'shell.record_one':'shell.record_many',{n:row.n});
  }else if(row.state==='error'){chip=E('span','ph-chip ph-chip-bad',phI18nD('shell.chip_failed'));txt=row.text?phI18nErr(row.text):phI18nD('shell.read_failed');}
  else{chip=E('span','ph-chip ph-chip-wait',phI18nD('shell.chip_loading'));txt=phI18nD('shell.not_loaded_yet');}
  li.appendChild(chip);li.appendChild(E('span','ph-line-txt',txt));
  return li;
}
function _phmPosLine(){
  const p=_phmPos;
  return _phmStageLine({label:phI18nD('ov.purchase_orders'),name:'pos',state:p.state==='ok'?'ok':(p.state==='error'?'error':'wait'),n:p.rows?p.rows.length:0,truncated:p.truncated,doc:false,text:p.errText});
}
function _phmInputs(ctx,range){
  const gj=ctx.get('jobs'),gs=ctx.get('settings');
  const fim=typeof phhFirstIssueNow==='function'?phhFirstIssueNow():null;
  return{now:Date.now(),range:range,firstIssueById:fim,passesOk:fim!==null,pos:_phmPos.state==='ok'?_phmPos.rows:null,jobs:gj&&gj.ok&&Array.isArray(gj.rows)?gj.rows:null,
    settingsRaw:gs&&gs.ok&&_phmObj(gs.rows)?gs.rows:null,truncated:_phmPos.truncated,jobsTruncated:!!(gj&&gj.ok&&gj.truncated),
    errors:{pos:_phmPos.errText,po_cut_jobs:gj&&gj.text,ph_settings:gs&&gs.text}};
}
function _phmHead(ctx,title,blurb,extra){
  const E=phEl,h=E('header','ph-head'),row=E('div','ph-head-row',null,[E('h2','ph-title',title)]);
  if(ctx.readOnly)row.appendChild(E('span','ph-chip ph-chip-view',phI18nD('shell.view_only')));
  if(extra)row.appendChild(extra);
  h.appendChild(row);
  if(blurb)h.appendChild(E('p','ph-blurb',blurb));
  return h;
}
function _phmCurrent(ctx){return typeof _phUiTab==='undefined'||_phUiTab===ctx.tab.id;}
// Kick the read of `pos` (once) and repaint the tab that asked when it settles. Never throws.
function _phmEnsure(ctx,force){
  if(typeof phhEnsure==='function'&&typeof phhSources==='function'){   // the gate passes (the stuck basis): once, or again on Refresh
    const S=phhSources();
    if(force||S.pos.state==='idle'||S.gatepasses.state==='idle')phhEnsure(!!force).then(function(){try{if(_phmCurrent(ctx))ctx.repaint();}catch(e){}});
  }
  const wasOk=_phmPos.state==='ok',stale=wasOk&&_phmPos.at!==null&&Date.now()-_phmPos.at>=PHM_STALE_MS;
  if(!force&&(_phmPos.p||(wasOk&&!stale)||_phmPos.state==='error'))return;
  phmLoadPos(!!force).then(function(){try{if(_phmCurrent(ctx))ctx.repaint();}catch(e){}});
}
function _phmFooterNote(M,ctx){
  const E=phEl,c=E('div','phm-foot');
  const bits=[];
  if(M.quality.cancelled)bits.push(phI18nD('ov.q_cancelled2',{po:phI18nD(M.quality.cancelled===1?'ov.q_cancelled_po_one':'ov.q_cancelled_po_many',{n:_phmN(M.quality.cancelled)})}));
  if(M.quality.unknown)bits.push(phI18nD('ov.q_unknown',{po:_phmPoD(M.quality.unknown,'po')}));
  if(M.quality.junk)bits.push(phI18nD('ov.q_junk_ignored',{x:phI18nD(M.quality.junk===1?'ov.q_junk_one':'ov.q_junk_many',{n:_phmN(M.quality.junk)})}));
  if(M.quality.truncated)bits.push(phI18nD('ov.q_trunc2',{n:PHM_MAX_POS}));
  if(M.quality.jobsTruncated)bits.push(phI18nD('ov.q_jobs_trunc'));
  if(bits.length)c.appendChild(E('p','phm-note-soft',phI18nD('ov.quality2',{bits:_phmJoinD(bits,'ov.join_dot')})));
  return c;
}

/* ── Overview ──────────────────────────────────────────────────────────── */
// The per-collection status lines. Collapsed under a small disclosure while everything read fine; OPEN (and marked)
// when anything failed, so a failed collection is never hidden behind a click.
function _phmSourcesCard(ctx){
  const E=phEl,strip=E('ul','ph-lines');
  (ctx.status.stages||[]).forEach(function(r){strip.appendChild(_phmStageLine(r));});
  if(!(ctx.status.stages||[]).length)(ctx.status.failed||[]).forEach(function(f){strip.appendChild(_phmStageLine({label:f.label,name:f.name,state:'error',text:f.text}));});
  strip.appendChild(_phmPosLine());
  const failed=(ctx.status.failed||[]).length>0||(ctx.status.stages||[]).some(function(r){return r&&r.state==='error';})||_phmPos.state==='error';
  const d=E('details','ph-card phm-sources'+(failed?' phm-sources-bad':''));
  d.setAttribute('data-sources',failed?'failed':'ok');
  if(failed)d.setAttribute('open','');
  d.appendChild(E('summary','phm-sources-sum',phI18nD(failed?'ov.sources_failed':'ov.sources_ok')));
  d.appendChild(strip);
  return d;
}
function _phmRenderOverview(host,ctx){
  const E=phEl;
  _phmEnsure(ctx,false);
  host.appendChild(_phmHead(ctx,phI18nD('shell.tab_overview'),phI18nD('ov.blurb')));
  if(_phmPos.state==='idle'||_phmPos.state==='loading'){host.appendChild(_phmSkeleton());host.appendChild(_phmSourcesCard(ctx));return;}
  const M=phmBuildModel(_phmInputs(ctx,{}));
  if(_phmPos.state==='error')host.appendChild(_phmPosError(ctx));
  host.appendChild(_phmTilesEl(PHM_OVERVIEW_TILES,M,host));
  host.appendChild(_phmAttentionCard(M,host,{limit:5}));
  if(typeof phhOverviewCard==='function'){try{host.appendChild(phhOverviewCard(ctx));}catch(e){}}
  const foot=phEl('div','phm-actions');
  if(ctx.canManage)foot.appendChild(_phmBtn('ph-btn',phI18nD('shell.open_monitor'),function(){if(typeof phGoTab==='function')phGoTab('monitor');}));
  foot.appendChild(_phmBtn('ph-btn',phI18nD('shell.refresh'),function(){phmCloseDrawer(false);_phmEnsure(ctx,true);ctx.repaint();Promise.resolve(ctx.reload()).then(function(){try{if(_phmCurrent(ctx))ctx.repaint();}catch(e){}});}));
  host.appendChild(foot);
  host.appendChild(_phmFooterNote(M,ctx));
  host.appendChild(_phmSourcesCard(ctx));
  if(ctx.readOnly)host.appendChild(phEl('p','ph-note',phI18nD('shell.readonly_note')));
}
function _phmSkeleton(){
  if(typeof _phUiSkeleton==='function')return _phUiSkeleton();
  const w=phEl('div','ph-skelwrap');w.setAttribute('aria-busy','true');w.setAttribute('role','status');w.setAttribute('aria-label',phI18nAttr(phI18nD('shell.loading_short')));return w;
}
function _phmBtn(cls,text,fn,attrs){
  const b=phEl('button',cls,text);b.setAttribute('type','button');
  if(attrs)Object.keys(attrs).forEach(function(k){b.setAttribute(k,attrs[k]);});
  if(fn)b.addEventListener('click',fn);
  return b;
}
function _phmPosError(ctx){
  const c=phEl('section','ph-card ph-card-err');c.setAttribute('role','alert');
  c.appendChild(phEl('h3','ph-card-title',phI18nD('ov.pos_failed')));
  c.appendChild(phEl('p','ph-note',_phmPos.errText?phI18nErr(_phmPos.errText):phI18nD('ov.pos_read_failed')));
  c.appendChild(phEl('p','ph-note',phI18nD('ov.pos_failed_note')));
  c.appendChild(_phmBtn('ph-btn ph-btn-primary',phI18nD('shell.retry'),function(){_phmEnsure(ctx,true);ctx.repaint();}));
  return c;
}

/* ── Monitor ───────────────────────────────────────────────────────────── */
function _phmRangeBar(ctx,rg){
  const E=phEl,bar=E('div','phm-range');
  bar.setAttribute('role','group');bar.setAttribute('aria-label','Date range');
  PHM_RANGES.forEach(function(r){
    const on=_phmRange.preset===r[0];
    const b=_phmBtn('phm-chip-btn'+(on?' on':''),r[1],function(){_phmRange.preset=r[0];_phmRange.error='';phmCloseDrawer(false);ctx.repaint();},{'aria-pressed':on?'true':'false'});
    bar.appendChild(b);
  });
  if(_phmRange.preset==='custom'){
    const f=E('input','phm-date');f.setAttribute('type','date');f.setAttribute('aria-label','From');f.value=_phmRange.from;
    const t=E('input','phm-date');t.setAttribute('type','date');t.setAttribute('aria-label','To');t.value=_phmRange.to;
    bar.appendChild(f);bar.appendChild(E('span','phm-dash','–'));bar.appendChild(t);
    bar.appendChild(_phmBtn('ph-btn','Apply',function(){_phmRange.from=f.value||'';_phmRange.to=t.value||'';ctx.repaint();}));
  }
  const cap=E('div','phm-range-cap',(rg.bad?rg.error:'Showing: '+rg.label+'.')+' The "In range" tiles follow this; the "Now" tiles are snapshots and do not.');
  if(rg.bad)cap.className+=' phm-bad';
  const wrap=E('div','phm-range-wrap');wrap.appendChild(bar);wrap.appendChild(cap);
  return wrap;
}
function _phmSettingsCard(M){
  const E=phEl,sv=M.settings,S=sv.S,ul=E('ul','ph-lines');
  const line=function(k,v){ul.appendChild(E('li','ph-line',null,[E('span','ph-line-name',k),E('span','ph-line-txt',v)]));};
  line('Source',sv.source);
  line('Daily capacity',_phmN(S.dailyCapacity)+' pcs a day'+_phmDef(sv,'dailyCapacity'));
  line('Delay target',S.delayTargetDays+' days, issue to cut'+_phmDef(sv,'delayTargetDays'));
  line('Stuck after',S.stuckDays+' days at one stage'+_phmDef(sv,'stuckDays'));
  line('Cut gate',S.cutGate[0]+'–'+S.cutGate[1]+'% of the ordered quantity'+_phmDef(sv,'cutGate'));
  line('Weekly off days',S.offWeekdays.length?S.offWeekdays.map(function(d){return['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d];}).join(', '):'none'+_phmDef(sv,'offWeekdays'));
  return E('section','ph-card',null,[E('h3','ph-card-title','Settings in use'),ul]);
}
function _phmStageBars(M){
  const E=phEl,t=M.tiles.pipeline;
  const card=E('section','ph-card');card.appendChild(E('h3','ph-card-title','Pipeline by stage'));
  if(!t||t.state==='unavailable'){card.appendChild(E('p','phm-val-soft',t?t.value:'unavailable — pos'));return card;}
  const counts=PH_REAL_STAGE_ORDER.map(function(s){return[s,t.rows.filter(function(r){return r.stage===s;}).length];});
  const max=Math.max.apply(null,counts.map(function(c){return c[1];}).concat([1]));
  const ul=E('ul','phm-bars');
  counts.forEach(function(c){
    const li=E('li','phm-bar-row');
    li.appendChild(E('span','phm-bar-label',_phmStageLabel(c[0])));
    const track=E('span','phm-bar-track');const fill=E('span','phm-bar-fill');fill.style.width=Math.round(c[1]/max*100)+'%';track.appendChild(fill);
    li.appendChild(track);li.appendChild(E('span','phm-bar-n',String(c[1])));
    ul.appendChild(li);
  });
  card.appendChild(ul);
  return card;
}
function _phmRenderMonitor(host,ctx){
  const E=phEl;
  _phmEnsure(ctx,false);
  const rgv=phmRangeFor(_phmRange.preset,{from:_phmRange.from,to:_phmRange.to},phDay(Date.now()));
  const refresh=_phmBtn('ph-btn phm-refresh',phI18nD('shell.refresh'),function(){phmCloseDrawer(false);_phmEnsure(ctx,true);ctx.repaint();Promise.resolve(ctx.reload()).then(function(){try{if(_phmCurrent(ctx))ctx.repaint();}catch(e){}});});
  host.appendChild(_phmHead(ctx,'Monitor','Pipeline, units afloat, delays and what needs attention. Every number opens the list of POs behind it, so each figure can be checked.',refresh));
  if(_phmPos.state==='idle'||_phmPos.state==='loading'){host.appendChild(_phmSkeleton());return;}
  host.appendChild(_phmRangeBar(ctx,rgv));
  const M=phmBuildModel(_phmInputs(ctx,rgv.bad?{from:'invalid',to:'invalid'}:{from:rgv.from,to:rgv.to}));   // an impossible range makes the range tiles unavailable, never a number for some other range
  if(_phmPos.state==='error')host.appendChild(_phmPosError(ctx));
  else host.appendChild(E('p','phm-asof','Purchase orders read at '+_phmTime(_phmPos.at)+' (PKT)'+(_phmPos.refreshing?phI18nD('ov.refreshing_suffix'):'')+'.'));
  host.appendChild(E('h3','phm-sec',phI18nD('ov.right_now')));
  host.appendChild(_phmTilesEl(PHM_NOW_TILES,M,host));
  host.appendChild(E('h3','phm-sec',phI18nD('ov.in_range')));
  host.appendChild(_phmTilesEl(PHM_RANGE_TILES,M,host));
  host.appendChild(_phmStageBars(M));
  host.appendChild(_phmAttentionCard(M,host,{limit:8}));
  if(typeof phhSection==='function'){try{host.appendChild(phhSection(ctx));}catch(e){}}
  host.appendChild(_phmSettingsCard(M));
  host.appendChild(_phmFooterNote(M,ctx));
}

/* ── registration (replaces the shell's placeholders; roles are the shell's) ── */
if(typeof phRegisterTab==='function'){
  phRegisterTab('overview',{render:_phmRenderOverview});
  phRegisterTab('monitor',{render:_phmRenderMonitor});
}
if(typeof phAddEscapeGuard==='function')phAddEscapeGuard(_phmEscape);

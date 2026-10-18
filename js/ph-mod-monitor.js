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
/* QC reconciliation touch points (QC8). The plan (§6.8/§7.4) fixes WHAT is shown, not the day counts, so these two are stated defaults, not facts:
   PHM_QC_IDLE_DAYS    a PO at QC with no lot yet, or one still receiving whose newest live lot is this old, is listed as "no new lot" (default 3)
   PHM_QC_RECENT_DAYS  "closed with a shortfall" and "lots voided" look back this many days (default 7 = js/ph-mod-afloat.js PHAF_CLOSED_DAYS, so a
                       closed PO listed here is still on the Afloat tab's closed list when it is opened; a test holds the two equal) */
const PHM_QC_IDLE_DAYS=3;
const PHM_QC_RECENT_DAYS=7;
const PHM_QC_LIST_LIMIT=5;                    // rows per QC group on the Monitor's Needs attention card before "more"
const PHM_QC_NEED=Object.freeze({ready:['pos','po_qc_recon','po_qc_lots'],short:['pos','po_qc_recon','po_qc_lots'],receiving:['pos','po_qc_recon','po_qc_lots'],
  idle:['pos','po_qc_recon','po_qc_lots'],drift:['pos','po_qc_recon','po_qc_lots'],closedShort:['po_qc_recon'],voided:['po_qc_lots']});
const PHM_QC_KEYS=Object.freeze(['ready','short','receiving','idle','drift','closedShort','voided']);
const PHM_QC_ATTENTION=Object.freeze(['short','drift','idle','closedShort','voided']);   // ready and receiving are normal flow: on the Overview card only
const PHM_QC_LABEL=Object.freeze({ready:'● Ready to close',short:'✗ Short beyond tolerance',receiving:'◐ Receiving',idle:'◷ No new lot for '+PHM_QC_IDLE_DAYS+'+ days',
  drift:'△ Cut changed after lock',closedShort:'✗ Closed with a shortfall (last '+PHM_QC_RECENT_DAYS+' days)',voided:'↺ Lots voided (last '+PHM_QC_RECENT_DAYS+' days)'});
const PHM_QC_TONE=Object.freeze({short:'stuck',drift:'stuck',closedShort:'stuck',idle:'delayed',voided:'delayed'});   // reuses the stuck (red) / delayed (amber) chip colours

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
  {   // QC reconciliation (QC8): its own model, so a PO read that failed makes the QC lines say so and nothing else moves
    const qi=_phmObj(I.qc)?I.qc:{};
    M.qc=phmQcBuild({now:now,pos:posOk?I.pos:null,recon:qi.recon,lots:qi.lots,loading:qi.loading,errors:qi.errors,truncated:Object.assign({pos:!!I.truncated},_phmObj(qi.truncated)?qi.truncated:{})});
  }
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
    if(kind&&typeof phPoOnHold==='function'&&phPoOnHold(ep.id)){M.heldSkipped=(M.heldSkipped||0)+1;kind=null;}   // a hold takes the PO out of stuck / delayed attention
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
  /* WP10: POs a manager put ON HOLD (and POs marked urgent / high that are not on hold) get their own lines in Needs attention, with the reason and how long ago
     the mark was last saved. A hold still removes a PO from the stuck / delayed counts above; it is shown here instead of vanishing. Marks unread = no line. */
  const heldRows=[],markedRows=[];
  if(typeof phMarkOf==='function'&&typeof phMarksState==='function'&&phMarksState().ok){
    eps.filter(function(e){return inProd(e)||stageOf(e)==='reserved';}).forEach(function(ep){
      const row=phMarkOf(ep.id),mk=row&&_phmObj(row.marks)?row.marks:null;
      if(!mk)return;
      const upd=typeof row.updatedAt==='number'&&isFinite(row.updatedAt)?row.updatedAt:null;
      const days=upd!==null?phDaysBetween(phDay(upd),today):null;
      const age=days===null||days<=0?phI18nD('ov.hold_age_today'):phI18nD(days===1?'ov.hold_age_day':'ov.hold_age_days',{n:days});
      if(_phmObj(mk.hold)){
        const pri=mk.priority==='urgent'||mk.priority==='high'?phI18nD(mk.priority==='urgent'?'marks.b_urgent':'marks.b_high'):null;
        const why=phStr(mk.hold.reason).trim()||phI18nD('ov.hold_no_reason');
        heldRows.push(_phmRow(ep,phI18nD(pri?'ov.r_hold_pri':'ov.r_hold',{why:why,age:age,pri:pri||''}),{kind:'hold',kindLabel:phI18nD('ov.k_hold'),age:days===null?-1:days}));
      }else if(mk.priority==='urgent'||mk.priority==='high'){
        markedRows.push(_phmRow(ep,phI18nD('ov.r_marked',{pri:phI18nD(mk.priority==='urgent'?'marks.b_urgent':'marks.b_high'),age:age}),{kind:'marked',kindLabel:phI18nD(mk.priority==='urgent'?'marks.b_urgent':'marks.b_high'),age:days===null?-1:days}));
      }
    });
    const byAge=function(a,b){return(b.age-a.age)||(a.id<b.id?-1:a.id>b.id?1:0);};
    heldRows.sort(byAge);markedRows.sort(byAge);
  }
  M.stuckBasis=basis;
  M.attention={held:heldRows,marked:markedRows,items:items,rows:attRows,count:items.length,counts:{stuck:nStuck,delayed:nDelayed,overgate:nGate},unavailable:null,noStart:noStart.length,
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

/* ── QC reconciliation model (QC8) ──────────────────────────────────────────
   Pure. EVERY decision is ph-core's: phQcReconcile gives each PO its phase (ready / short / receiving / awaiting_qc / closed) and its drift,
   phQcGroup says whether it is afloat at all. This function only sorts the POs into the lists below and words each row.
     ready        phase ready: received the cut inside the allowance, the floor (or a manager) may close it
     short        phase short: the total is in but a size is short / over beyond its allowance / unexpected - a manager closes it, with a reason
     receiving    phase receiving: lots in, the total still short beyond the allowance (normal flow: units are still arriving)
     idle         a PO at QC with no live lot, or one receiving whose newest live lot is PHM_QC_IDLE_DAYS+ days old
     drift        the live cut on the PO differs from the locked snapshot (phQcReconcile().drift)
     closedShort  a reconciliation closed WITH a close_short override in the last PHM_QC_RECENT_DAYS days (read off po_qc_recon alone)
     voided       POs with a lot voided in the last PHM_QC_RECENT_DAYS days (read off po_qc_lots alone)
   Honest states: a list whose inputs were not read has count null (never 0) and names the collections in Q.unavail[key]; Q.failed / Q.pending say which
   collections failed and which are still being read. ready / short / receiving / idle / drift need pos + po_qc_recon + po_qc_lots; closedShort needs
   po_qc_recon; voided needs po_qc_lots. A PO ph-core cannot judge is listed in Q.notJudged with the reason, never silently dropped.
   inp: {now, pos:[PO docs]|null, recon:[po_qc_recon rows]|null, lots:[po_qc_lots rows]|null, loading:{po_qc_recon,po_qc_lots:true while being read},
         errors:{po_qc_recon,po_qc_lots: text}, truncated:{pos,po_qc_recon,po_qc_lots}} */
function _phmQcNum(id){const m=/(\d+)/.exec(phStr(id));return m?parseInt(m[1],10):Infinity;}
function _phmQcCmpId(a,b){const x=_phmQcNum(a.id),y=_phmQcNum(b.id);return x!==y?(x<y?-1:1):(a.id<b.id?-1:a.id>b.id?1:0);}
function _phmQcAgo(ms,now){
  const a=typeof ms==='number'&&isFinite(ms)?phDay(ms):null,b=phDay(now);
  const d=a!==null&&b!==null?phDaysBetween(a,b):null;
  if(d===null)return'on an unknown day';
  return d<=0?'today':(d===1?'yesterday':d+' days ago');
}
function _phmQcCause(c){return phStr(c).replace(/_/g,' ');}
// "20 XL, 5 M still expected" - the largest gaps first, at most three sizes
function _phmQcStill(v){
  const gaps=v.order.map(function(k){return{k:k,n:-v.sizes[k].diff};}).filter(function(g){return g.n>0;}).sort(function(a,b){return b.n-a.n;});
  if(!gaps.length)return'';
  return gaps.slice(0,3).map(function(g){return g.n+' '+g.k;}).join(', ')+(gaps.length>3?', …':'')+' still expected';
}
// Why a short PO is short: every size beyond its allowance, then the total if that is short too
function _phmQcShortWords(v){
  const out=[];
  v.order.forEach(function(k){
    const s=v.sizes[k];
    if(s.state==='short')out.push(k+' is '+(-s.diff)+' short (allowance '+s.allow+')');
    else if(s.state==='over_refused')out.push(k+' is '+s.diff+' over (allowance '+s.allow+')');
    else if(s.state==='unexpected')out.push(k+': '+s.recv+' received but none cut');
  });
  if(v.total.state==='short')out.push('the total is '+(-v.total.diff)+' short (allowance '+v.total.allow+')');
  return out.join('; ');
}
function _phmQcOverBy(v){
  if(v.total.diff>0)return v.total.diff;
  let n=0;v.order.forEach(function(k){if(v.sizes[k].diff>n)n=v.sizes[k].diff;});
  return n;
}
function _phmQcReadyWords(v){
  const pct=typeof PHQC_TOL_PCT==='number'?PHQC_TOL_PCT:2;
  if(v.state==='exact')return'exact';
  if(v.state==='over')return _phmQcOverBy(v)+' over, inside the '+pct+' % allowance';
  return(v.total.diff<0?(-v.total.diff)+' short, ':'')+'inside the '+pct+' % allowance';
}
function phmQcBuild(inp){
  const I=_phmObj(inp)?inp:{};
  const now=typeof I.now==='number'&&isFinite(I.now)?I.now:Date.now();
  const today=phDay(now);
  const avail={pos:Array.isArray(I.pos),po_qc_recon:Array.isArray(I.recon),po_qc_lots:Array.isArray(I.lots)};
  const loading=_phmObj(I.loading)?I.loading:{},errors=_phmObj(I.errors)?I.errors:{},trunc=_phmObj(I.truncated)?I.truncated:{};
  const Q={now:now,avail:avail,counts:{},lists:{},unavail:{},failed:[],pending:[],errors:{},truncated:[],notJudged:[],lotsVoided:0,idleNoDate:0,state:'ok'};
  ['pos','po_qc_recon','po_qc_lots'].forEach(function(n){
    if(avail[n])return;
    if(loading[n]===true)Q.pending.push(n);else{Q.failed.push(n);Q.errors[n]=phStr(errors[n]);}
  });
  ['pos','po_qc_recon','po_qc_lots'].forEach(function(n){if(avail[n]&&trunc[n]===true)Q.truncated.push(n);});
  PHM_QC_KEYS.forEach(function(k){Q.lists[k]=[];Q.counts[k]=null;});
  const rcBy=Object.create(null),lotsBy=Object.create(null),posBy=Object.create(null);
  if(avail.po_qc_recon)I.recon.forEach(function(r){if(!_phmObj(r))return;const k=phPoKey(r.fbKey!=null?r.fbKey:r.poId);if(k)rcBy[k]=r;});
  if(avail.po_qc_lots)I.lots.forEach(function(l){if(!_phmObj(l))return;const k=phPoKey(l.poId);if(!k)return;(lotsBy[k]=lotsBy[k]||[]).push(Object.assign({},l,{id:l.id!=null?l.id:l.fbKey}));});
  if(avail.pos)I.pos.forEach(function(p){if(!_phmObj(p))return;const k=phPoKey(_phmId(p));if(k&&!posBy[k])posBy[k]=p;});
  const epOf=function(p,id){const e=Object.assign({},p);e.id=id;return e;};
  const stubRow=function(id,detail){return{id:id,fbKey:id,title:id,stage:null,units:null,basis:null,detail:detail};};
  const recentMs=PHM_QC_RECENT_DAYS*86400000;

  /* the POs: ready / short / receiving / idle / drift */
  if(avail.pos&&avail.po_qc_recon&&avail.po_qc_lots){
    I.pos.forEach(function(p){
      if(!_phmObj(p))return;
      const st=phStageOf(p);
      if(st===null||st==='cancelled'||st==='reserved')return;
      const id=_phmId(p),key=phPoKey(id);
      if(!key)return;
      const rc=rcBy[key]||null;
      if(st==='completed'&&!rc)return;                       // the classic flow completed it and QC never reconciled it: not this card's business
      const rec=phQcReconcile(p,rc,lotsBy[key]||[],{reconRead:true});
      if(!rec.ok){Q.notJudged.push(Object.assign(_phmRow(epOf(p,id),'Not judged: '+phStr(rec.why)),{key:key}));return;}
      const group=phQcGroup({stage:st,phase:rec.phase});
      if(group===null)return;
      if(group==='unknown'){Q.notJudged.push(Object.assign(_phmRow(epOf(p,id),'Not judged: the stage "'+st+'" is not one QC reconciles'),{key:key}));return;}
      if(rec.phase==='closed')return;
      const ep=epOf(p,id),v=rec.verdict;
      if(rec.drift){
        const d=rec.drift;
        Q.lists.drift.push(_phmRow(ep,'Locked cut '+d.lockTotal+'; the PO now records '+d.liveTotal+' ('+d.sizes.map(function(s){return s.size+' '+s.lock+' → '+s.live;}).join(', ')+')'));
      }
      if(rec.phase==='awaiting_qc'){
        if(st!=='qc')return;                                  // a PO that has not reached QC is not late with its lots
        const prev=PH_REAL_STAGE_ORDER[PH_REAL_STAGE_ORDER.indexOf(st)-1];
        const sg=_phmObj(p.stages)?p.stages[prev]:null,entry=sg?phMs(sg.doneAt):null;
        const days=entry!==null&&today!==null?phDaysBetween(phDay(entry),today):null;
        if(days===null){Q.idleNoDate++;return;}
        if(days>=PHM_QC_IDLE_DAYS)Q.lists.idle.push(_phmRow(ep,'At QC for '+days+' days (since '+_phmDayLabel(phDay(entry))+') and no lot received yet; '+rec.cut.total+' cut',{idleDays:days}));
        return;
      }
      if(!v)return;                                           // awaiting_cut: no cut recorded yet, nothing to judge
      const base=v.total.recv+' of '+v.total.cut+' received';
      if(rec.phase==='ready')Q.lists.ready.push(_phmRow(ep,base+' — '+_phmQcReadyWords(v)));
      else if(rec.phase==='short')Q.lists.short.push(_phmRow(ep,base+' — '+_phmQcShortWords(v)));
      else if(rec.phase==='receiving'){
        const still=_phmQcStill(v);
        Q.lists.receiving.push(_phmRow(ep,base+(still?' — '+still:'')));
        const last=(lotsBy[key]||[]).reduce(function(m,l){return l.status==='live'&&typeof l.at==='number'&&l.at>m?l.at:m;},0);
        const days=last&&today!==null?phDaysBetween(phDay(last),today):null;
        if(days!==null&&days>=PHM_QC_IDLE_DAYS)Q.lists.idle.push(_phmRow(ep,'No new lot for '+days+' days (last '+_phmDayLabel(phDay(last))+'); '+base+(still?' — '+still:''),{idleDays:days}));
      }
    });
    ['ready','short','receiving','drift'].forEach(function(k){Q.lists[k].sort(_phmQcCmpId);});
    Q.lists.idle.sort(function(a,b){return(b.idleDays-a.idleDays)||_phmQcCmpId(a,b);});
  }

  /* closed with a shortfall: a close_short override, closed in the last PHM_QC_RECENT_DAYS days (a close with no date is listed, marked) */
  if(avail.po_qc_recon){
    const rows=[];
    I.recon.forEach(function(rc){
      if(!_phmObj(rc)||rc.status!=='closed')return;
      const ovs=Array.isArray(rc.overrides)?rc.overrides.filter(function(o){return _phmObj(o)&&o.kind==='close_short';}):[];
      if(!ovs.length)return;
      const id=phStr(rc.poId!=null?rc.poId:rc.fbKey).trim()||phStr(rc.fbKey).trim(),key=phPoKey(id);
      if(!key)return;
      const at=typeof rc.closedAt==='number'&&isFinite(rc.closedAt)?rc.closedAt:null;
      if(at!==null&&now-at>recentMs)return;
      const ov=ovs[ovs.length-1],t=_phmObj(rc.closeVerdict)&&_phmObj(rc.closeVerdict.total)?rc.closeVerdict.total:null;
      const diff=t&&typeof t.diff==='number'?t.diff:null;
      const who=phStr(rc.closedByName||rc.closedBy).trim()||'someone';
      const detail='Closed by '+who+' '+(at!==null?_phmQcAgo(at,now):'(date not recorded)')
        +(t&&typeof t.recv==='number'&&typeof t.cut==='number'?' with '+t.recv+' of '+t.cut+' received'+(diff===null?'':diff<0?' ('+(-diff)+' short)':diff>0?' ('+diff+' over)':' (exact)'):'')
        +' — '+(_phmQcCause(ov.cause)||'no cause recorded')+(phStr(ov.reason).trim()?': '+phStr(ov.reason).trim():'');
      const p=posBy[key];
      const row=p?_phmRow(epOf(p,_phmId(p)),detail):stubRow(id,detail);
      row.closedAt=at;
      rows.push(row);
    });
    rows.sort(function(a,b){return((b.closedAt||0)-(a.closedAt||0))||_phmQcCmpId(a,b);});
    Q.lists.closedShort=rows;
  }

  /* lots voided in the last PHM_QC_RECENT_DAYS days, one row per PO */
  if(avail.po_qc_lots){
    const by=Object.create(null);
    I.lots.forEach(function(l){
      if(!_phmObj(l)||l.status!=='void'||typeof l.voidedAt!=='number'||!isFinite(l.voidedAt)||now-l.voidedAt>recentMs)return;
      const k=phPoKey(l.poId);
      if(!k)return;
      Q.lotsVoided++;
      const g=by[k]=by[k]||{key:k,id:phStr(l.poId).trim(),n:0,latest:null};
      g.n++;
      if(g.latest===null||l.voidedAt>g.latest.voidedAt)g.latest=l;
    });
    Q.lists.voided=Object.keys(by).map(function(k){
      const g=by[k],l=g.latest,p=posBy[k];
      const detail=g.n+(g.n===1?' lot':' lots')+' voided in the last '+PHM_QC_RECENT_DAYS+' days — latest '+_phmQcAgo(l.voidedAt,now)+' by '+(phStr(l.voidedBy).trim()||'someone')
        +(phStr(l.voidReason).trim()?': '+phStr(l.voidReason).trim():'')+(typeof l.total==='number'?' ('+l.total+(l.total===1?' unit':' units')+')':'');
      const row=p?_phmRow(epOf(p,_phmId(p)),detail):stubRow(g.id,detail);
      row.voidedAt=l.voidedAt;row.lots=g.n;
      return row;
    }).sort(function(a,b){return(b.voidedAt-a.voidedAt)||_phmQcCmpId(a,b);});
  }

  /* a count exists only when everything it needs was read */
  PHM_QC_KEYS.forEach(function(k){
    const miss=PHM_QC_NEED[k].filter(function(n){return!avail[n];});
    if(miss.length){Q.counts[k]=null;Q.lists[k]=[];Q.unavail[k]=miss;}
    else Q.counts[k]=Q.lists[k].length;
  });
  const have=PHM_QC_KEYS.filter(function(k){return Q.counts[k]!==null;}).length;
  Q.state=have===0?(Q.failed.length?'unavailable':'loading'):(have<PHM_QC_KEYS.length?'partial':'ok');
  return Q;
}

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

/* ── open a PO in the Afloat POs tab (QC8; managers) ───────────────────── */
// The tab is `afloat` (deep link #prodops/afloat, which phGoTab writes itself); the PO's detail is opened by js/ph-mod-afloat.js phqcOpen(id). Afloat DROPS an
// opened PO it cannot find a tile for, and it builds its tiles from its OWN read of `pos`, so that read is awaited first (phqcLoadPos, shared and never rejecting).
// If it fails, Afloat shows its list and its own error - the PO is then one tap away. Returns true when the jump was started.
function phmQcCanOpen(u){
  const w=u!==undefined?(typeof u==='string'?u:''):((typeof session!=='undefined'&&session&&typeof session.u==='string')?session.u:'');
  return typeof phCanManage==='function'&&phCanManage(w)===true&&typeof phGoTab==='function';
}
function phmQcOpen(poId){
  const id=phStr(poId).trim();
  if(!phmQcCanOpen()||!/^[A-Za-z0-9_-]{1,60}$/.test(id))return false;
  phmCloseDrawer(false);
  const go=function(){
    if(phGoTab('afloat')!==true)return false;
    if(typeof phqcOpen==='function'){try{phqcOpen(id);}catch(e){}}
    return true;
  };
  if(typeof phqcLoadPos==='function'){Promise.resolve(phqcLoadPos(false)).then(go,go);return true;}
  return go();
}
function _phmQcOpenBtn(r){
  const b=phEl('button','ph-btn phm-open','Open '+r.id+' in Afloat POs');
  b.setAttribute('type','button');b.setAttribute('data-act','open-qc');b.setAttribute('data-po',r.fbKey||r.id);
  b.setAttribute('aria-label','Open '+r.id+' in the Afloat POs tab');
  b.addEventListener('click',function(){phmQcOpen(r.fbKey||r.id);});
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
    if(spec.openQc&&phmQcCanOpen())li.appendChild(_phmQcOpenBtn(r));
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
  const mkRow=function(r){
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
    return li;
  };
  const ul=E('ul','phm-att-list');
  rows.slice(0,o.limit||rows.length).forEach(function(r){ul.appendChild(mkRow(r));});
  card.appendChild(ul);
  [['held','ov.t_on_hold','hold'],['marked','ov.t_marked','marked']].forEach(function(g){
    const list=M.attention[g[0]];
    if(!list||!list.length)return;
    const sec=E('div','phm-att-group phm-att-group-'+g[2]);
    sec.setAttribute('data-att-group',g[2]);
    sec.appendChild(E('h4','phm-att-gh',phI18nD(g[1],{n:list.length})));
    const gl=E('ul','phm-att-list');
    list.slice(0,o.limit||list.length).forEach(function(r){gl.appendChild(mkRow(r));});
    sec.appendChild(gl);
    if(list.length>(o.limit||list.length))sec.appendChild(E('p','phm-note-soft',phI18nD('ov.group_more',{n:list.length-(o.limit||list.length)})));
    card.appendChild(sec);
  });
  if(o.qc&&M.qc)_phmQcAttention(card,M.qc,host);
  if(rows.length>(o.limit||rows.length)){
    const b=E('button','ph-btn phm-more',phI18nD('ov.show_all',{n:rows.length}));b.setAttribute('type','button');
    b.addEventListener('click',function(){phmOpenDrawer(host,{title:phI18nD('ov.t_attention'),rows:rows,note:M.tiles.attention?M.tiles.attention.cap:'',openable:true},b);});
    card.appendChild(b);
  }
  if(M.attention.note)card.appendChild(E('p','phm-note-soft',M.attention.note));
  if(M.attention.noStart)card.appendChild(E('p','phm-note-soft',phI18nD('ov.attention_no_start2',{po:_phmPoD(M.attention.noStart,'openpo')})));
  return card;
}
/* ── QC reconciliation: the Monitor's Needs attention groups and the Overview card (QC8) ── */
// "unavailable — po_qc_lots" for a list whose inputs failed, "reading QC receipts…" while they are still being read; '' when the list was read.
function _phmQcLack(Q,k){
  const miss=Q.unavail[k];
  if(!miss||!miss.length)return'';
  const failed=miss.filter(function(n){return Q.failed.indexOf(n)>-1;});
  return failed.length?'unavailable — '+failed.join(', '):'reading QC receipts…';
}
// Lines under a QC block that a reader must not miss: what could not be read, what was cut off by a read limit, what could not be judged.
function _phmQcNotes(Q,host){
  const E=phEl,out=[];
  const failed=Q.failed.map(function(n){return Q.errors[n]?Q.errors[n]:n+': could not be read.';});
  if(failed.length){const p=E('p','phm-note-soft phm-bad',failed.join(' '));p.setAttribute('role','alert');out.push(p);}
  else if(Q.pending.length)out.push(E('p','phm-note-soft','Reading QC receipts…'));
  if(Q.truncated.length)out.push(E('p','phm-note-soft',Q.truncated.join(', ')+' hit '+(Q.truncated.length===1?'its':'their')+' read limit, so these counts may be incomplete.'));
  if(Q.notJudged.length)out.push(E('p','phm-note-soft',_phmPlural(Q.notJudged.length,'PO')+' could not be judged by QC reconciliation: '+Q.notJudged.slice(0,5).map(function(r){return r.id;}).join(', ')+(Q.notJudged.length>5?', …':'')+' (open Afloat POs for the reason).'));
  if(Q.idleNoDate)out.push(E('p','phm-note-soft',_phmPlural(Q.idleNoDate,'PO')+' at QC with no lot could not be dated (the washing stage has no finish date), so "no new lot" does not judge '+(Q.idleNoDate===1?'it':'them')+'.'));
  return out;
}
function _phmQcAttRow(r,k){
  const E=phEl,li=E('li','phm-qc-att-row phm-row');li.setAttribute('data-qc-po',r.id);
  const top=E('div','phm-row-top');
  top.appendChild(E('span','ph-chip phm-kind phm-kind-'+PHM_QC_TONE[k],PHM_QC_LABEL[k]));
  top.appendChild(E('span','phm-row-id',r.id));
  top.appendChild(E('span','ph-chip phm-stage',_phmStageLabel(r.stage)));
  li.appendChild(top);
  li.appendChild(E('div','phm-row-title',r.title));
  li.appendChild(E('div','phm-row-detail',r.detail));
  if(phmQcCanOpen())li.appendChild(_phmQcOpenBtn(r));
  return li;
}
// The Monitor card: one group per problem kind with rows, each row able to open the PO in Afloat POs.
function _phmQcAttention(card,Q,host){
  const E=phEl;
  PHM_QC_ATTENTION.forEach(function(k){
    const list=Q.lists[k];
    if(!list.length)return;
    const sec=E('div','phm-att-group phm-att-group-qc');
    sec.setAttribute('data-att-group','qc-'+k);
    sec.appendChild(E('h4','phm-att-gh',PHM_QC_LABEL[k]+' ('+list.length+')'));
    const ul=E('ul','phm-att-list');
    list.slice(0,PHM_QC_LIST_LIMIT).forEach(function(r){ul.appendChild(_phmQcAttRow(r,k));});
    sec.appendChild(ul);
    if(list.length>PHM_QC_LIST_LIMIT){
      const b=E('button','ph-btn phm-more','Show all '+list.length);b.setAttribute('type','button');
      b.addEventListener('click',function(){phmOpenDrawer(host,{title:PHM_QC_LABEL[k],rows:list,note:'',openQc:true},b);});
      sec.appendChild(b);
    }
    card.appendChild(sec);
  });
  // a kind whose inputs could not be read is named, never shown as an empty group
  const lacking=PHM_QC_ATTENTION.filter(function(k){return Q.unavail[k];});
  if(lacking.length){
    const names=[];lacking.forEach(function(k){Q.unavail[k].forEach(function(n){if(names.indexOf(n)<0)names.push(n);});});
    const failed=names.filter(function(n){return Q.failed.indexOf(n)>-1;});
    card.appendChild(E('p','phm-note-soft'+(failed.length?' phm-bad':''),'QC reconciliation: '+lacking.map(function(k){return PHM_QC_LABEL[k].replace(/^\S+\s/,'');}).join(', ')+' — '+(failed.length?'unavailable — '+failed.join(', '):'reading QC receipts…')+'.'));
  }
  _phmQcNotes(Q,host).forEach(function(n){card.appendChild(n);});
}
// The Overview card (managers): the counts, each one opening the list of POs behind it. A real zero reads 0; a list that was not read never does.
function _phmQcCard(M,host,ctx){
  const E=phEl,Q=M.qc,card=E('section','ph-card phm-qc');
  card.setAttribute('data-card','qc');
  card.appendChild(E('h3','ph-card-title','QC reconciliation'));
  card.appendChild(E('p','ph-note','Units QC has received against each PO\'s final cut, within '+(typeof PHQC_TOL_PCT==='number'?PHQC_TOL_PCT:2)+' %. A PO can appear on more than one line.'));
  const ul=E('ul','phm-att-list');
  PHM_QC_KEYS.forEach(function(k){
    const li=E('li','phm-row');li.setAttribute('data-qc-line',k);
    const top=E('div','phm-row-top');
    top.appendChild(E('span','phm-row-id',PHM_QC_LABEL[k]));
    const n=Q.counts[k];
    if(n===null){
      top.appendChild(E('span','ph-chip ph-chip-bad',_phmQcLack(Q,k)));
    }else{
      const cls=n===0?'ph-chip ph-chip-wait':(PHM_QC_TONE[k]?'ph-chip phm-kind phm-kind-'+PHM_QC_TONE[k]:(k==='ready'?'ph-chip ph-chip-ok':'ph-chip ph-chip-wait'));
      let txt=String(n);
      if(k==='voided'&&n>0)txt=n+(n===1?' PO · ':' POs · ')+Q.lotsVoided+(Q.lotsVoided===1?' lot':' lots');
      top.appendChild(E('span',cls,txt));
      if(n>0){
        const b=E('button','ph-btn phm-open','Show the POs');b.setAttribute('type','button');b.setAttribute('data-act','qc-list');b.setAttribute('data-list',k);
        b.setAttribute('aria-label','Show the POs: '+PHM_QC_LABEL[k].replace(/^\S+\s/,''));
        b.addEventListener('click',function(){phmOpenDrawer(host,{title:'QC reconciliation: '+PHM_QC_LABEL[k].replace(/^\S+\s/,''),rows:Q.lists[k],note:'',openQc:true},b);});
        top.appendChild(b);
      }
    }
    li.appendChild(top);
    ul.appendChild(li);
  });
  card.appendChild(ul);
  _phmQcNotes(Q,host).forEach(function(n){card.appendChild(n);});
  const act=E('div','phm-actions');
  if(Q.failed.some(function(n){return n!=='pos';}))act.appendChild(_phmBtn('ph-btn','Retry the QC reads',function(){   // re-read only what failed (a stage that was read keeps its data)
    ['recon','lots'].forEach(function(s){if(typeof phLoadFailed==='function'&&phLoadFailed(s))phLoadStage(s,{force:true}).then(function(){try{if(_phmCurrent(ctx))ctx.repaint();}catch(e){}});});
    if(_phmPos.state==='error')_phmEnsure(ctx,true);
    ctx.repaint();
  },{'data-act':'qc-retry'}));
  if(typeof phGoTab==='function')act.appendChild(_phmBtn('ph-btn','Open Afloat POs',function(){phGoTab('afloat');},{'data-act':'open-afloat'}));
  card.appendChild(act);
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
// The QC stages (po_qc_recon, po_qc_lots) are LAZY in the data layer: the shell's first load does not read them, _phmQcEnsure does, for managers only.
function _phmQcInputs(ctx){
  const gr=ctx.get('recon'),gl=ctx.get('lots');
  const ok=function(g){return!!(g&&g.ok&&Array.isArray(g.rows));};
  const idle=function(s){const x=typeof phLoadState==='function'?phLoadState(s):null;return!x||x.state==='idle';};
  return{recon:ok(gr)?gr.rows:null,lots:ok(gl)?gl.rows:null,
    loading:{po_qc_recon:!ok(gr)&&idle('recon'),po_qc_lots:!ok(gl)&&idle('lots')},
    errors:{po_qc_recon:gr&&gr.text,po_qc_lots:gl&&gl.text},
    truncated:{po_qc_recon:!!(ok(gr)&&gr.truncated),po_qc_lots:!!(ok(gl)&&gl.truncated)}};
}
function _phmInputs(ctx,range){
  const gj=ctx.get('jobs'),gs=ctx.get('settings');
  const fim=typeof phhFirstIssueNow==='function'?phhFirstIssueNow():null;
  return{qc:_phmQcInputs(ctx),now:Date.now(),range:range,firstIssueById:fim,passesOk:fim!==null,pos:_phmPos.state==='ok'?_phmPos.rows:null,jobs:gj&&gj.ok&&Array.isArray(gj.rows)?gj.rows:null,
    settingsRaw:gs&&gs.ok&&_phmObj(gs.rows)?gs.rows:null,truncated:_phmPos.truncated,jobsTruncated:!!(gj&&gj.ok&&gj.truncated),
    errors:{pos:_phmPos.errText,po_cut_jobs:gj&&gj.text,ph_settings:gs&&gs.text}};
}
function _phmHead(ctx,title,blurb,extra){
  const E=phEl,h=E('header','ph-head'),row=E('div','ph-head-row',null,[E('h2','ph-title',title)]);
  if(typeof phViewChipOn==='function'?phViewChipOn(ctx):ctx.readOnly)row.appendChild(E('span','ph-chip ph-chip-view',phI18nD('shell.view_only')));
  if(extra)row.appendChild(extra);
  h.appendChild(row);
  if(blurb)h.appendChild(E('p','ph-blurb',blurb));
  return h;
}
function _phmCurrent(ctx){return typeof _phUiTab==='undefined'||_phUiTab===ctx.tab.id;}
// QC8: read the two lazy QC stages (managers only; Kashif's and Faizan's tabs never get here). A stage that is read is not read again until Refresh /
// Retry (force); one that FAILED is not retried by a repaint (that would loop on a persistent refusal). Never throws.
function _phmQcEnsure(ctx,force){
  if(!ctx||!ctx.canManage||typeof phLoadStage!=='function'||typeof phLoadState!=='function')return;
  ['recon','lots'].forEach(function(s){
    const st=phLoadState(s);
    if(!force&&st&&st.state!=='idle')return;
    phLoadStage(s,{force:!!force}).then(function(){try{if(_phmCurrent(ctx))ctx.repaint();}catch(e){}});
  });
}
// Kick the read of `pos` (once) and repaint the tab that asked when it settles. Never throws.
function _phmEnsure(ctx,force){
  _phmQcEnsure(ctx,force);
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
  let qcFailed=false;
  if(ctx.canManage&&typeof phLoadState==='function'&&typeof PH_COLLECTIONS!=='undefined'){   // QC8: the two lazy QC stages, as two more rows (managers only)
    ['recon','lots'].forEach(function(s){
      const col=PH_COLLECTIONS[s],x=phLoadState(s);
      if(!col||!x)return;
      if(x.state==='error')qcFailed=true;
      strip.appendChild(_phmStageLine({label:col.label,name:col.col,state:x.state==='ok'?'ok':(x.state==='error'?'error':'wait'),n:x.n||0,doc:false,text:x.state==='error'&&typeof phErrText==='function'?phErrText(s,x.err):''}));
    });
  }
  strip.appendChild(_phmPosLine());
  const failed=(ctx.status.failed||[]).length>0||(ctx.status.stages||[]).some(function(r){return r&&r.state==='error';})||_phmPos.state==='error'||qcFailed;
  const d=E('details','ph-card phm-sources'+(failed?' phm-sources-bad':''));
  d.setAttribute('data-sources',failed?'failed':'ok');
  if(failed)d.setAttribute('open','');
  d.appendChild(E('summary','phm-sources-sum',phI18nD(failed?'ov.sources_failed':'ov.sources_ok')));
  d.appendChild(strip);
  return d;
}
// WP10: the cutting floor's Overview is SHORT - today's jobs and the overdue ones, and one button to Today's Cutting. He lands on that tab; this
// page is only the summary behind it. It reads only the cut-job stage the shell already loaded (no pos read, no counts of stages he cannot open).
function _phmFloorOverview(host,ctx){
  const E=phEl;
  host.appendChild(_phmHead(ctx,phI18nD('shell.tab_overview'),phI18nD('ov.floor_blurb')));
  const chip=typeof phChipFor==='function'?phChipFor(ctx.user):null;
  if(chip&&chip.show){   // the top-bar chip is hidden on a phone: its words live here instead
    const c=E('p','phm-floor-role',null);
    c.appendChild(E('span','ph-chip ph-chip-view',chip.key?phI18nD(chip.key):chip.text));
    host.appendChild(c);
  }
  const jobs=ctx.get('jobs');
  const card=E('section','ph-card phm-floor');
  if(!jobs||!jobs.ok){
    card.classList.add('ph-card-err');card.setAttribute('role','alert');
    card.appendChild(E('h3','ph-card-title',phI18nD('cut.jobs_failed')));
    card.appendChild(E('p','ph-note',(jobs&&jobs.text)?phI18nErr(jobs.text):phI18nD('cut.jobs_not_loaded')));
  }else{
    const today=typeof phkToday==='function'?phkToday():phDay(Date.now());
    const sp=typeof phkSplitJobs==='function'?phkSplitJobs(jobs.rows,today):{today:[],overdue:[]};
    const w=function(n,one,many){return phI18nD('cut.n_w',{n:n,w:phI18nD(n===1?one:many)});};
    const line=E('p','phm-floor-line',phI18nD('cut.bar_text',{today:w(sp.today.length,'cut.w_job_one','cut.w_job_many'),overdue:sp.overdue.length}));
    line.setAttribute('data-floor-line','1');
    card.appendChild(line);
    if(sp.overdue.length)card.appendChild(E('p','phm-floor-late',phI18nD('ov.floor_overdue_note')));
  }
  const go=E('button','ph-btn ph-btn-primary phm-floor-go',phI18nD('ov.floor_open'));
  go.setAttribute('type','button');
  go.addEventListener('click',function(){if(typeof phGoTab==='function')phGoTab('cutting');});
  card.appendChild(go);
  host.appendChild(card);
  // the Data health card stays on his Overview (an earlier owner decision: he sees the total, never the "Open the checks" button)
  if(typeof phhOverviewCard==='function'){try{host.appendChild(phhOverviewCard(ctx));}catch(e){}}
}
function _phmRenderOverview(host,ctx){
  const E=phEl;
  if(!ctx.canManage)return _phmFloorOverview(host,ctx);
  _phmEnsure(ctx,false);
  host.appendChild(_phmHead(ctx,phI18nD('shell.tab_overview'),phI18nD('ov.blurb')));
  if(_phmPos.state==='idle'||_phmPos.state==='loading'){host.appendChild(_phmSkeleton());host.appendChild(_phmSourcesCard(ctx));return;}
  const M=phmBuildModel(_phmInputs(ctx,{}));
  if(_phmPos.state==='error')host.appendChild(_phmPosError(ctx));
  host.appendChild(_phmTilesEl(PHM_OVERVIEW_TILES,M,host));
  host.appendChild(_phmAttentionCard(M,host,{limit:5}));
  host.appendChild(_phmQcCard(M,host,ctx));
  if(typeof phhOverviewCard==='function'){try{host.appendChild(phhOverviewCard(ctx));}catch(e){}}
  host.appendChild(phmRestockCard());
  const foot=phEl('div','phm-actions');
  if(ctx.canManage)foot.appendChild(_phmBtn('ph-btn',phI18nD('shell.open_monitor'),function(){if(typeof phGoTab==='function')phGoTab('monitor');}));
  foot.appendChild(_phmBtn('ph-btn',phI18nD('shell.refresh'),function(){phmCloseDrawer(false);_phmEnsure(ctx,true);ctx.repaint();Promise.resolve(ctx.reload()).then(function(){try{if(_phmCurrent(ctx))ctx.repaint();}catch(e){}});}));
  host.appendChild(foot);
  host.appendChild(_phmFooterNote(M,ctx));
  host.appendChild(_phmSourcesCard(ctx));
  if(ctx.readOnly)host.appendChild(phEl('p','ph-note',phI18nD('shell.readonly_note')));
}
/* ── Restock card (WP3): reads the per-device snapshot Inventory Intel wrote (groovy-si-restock-last). No Firestore read. ──
   It says "as of <day>, from this device", never claims fresh, and an unread / missing / malformed snapshot is never an empty list. */
const PHM_RESTOCK_KEY='groovy-si-restock-last';
function phmRestockRead(){
  let raw=null;
  try{raw=localStorage.getItem(PHM_RESTOCK_KEY);}catch(e){return{state:'unreadable'};}
  if(raw==null||raw==='')return{state:'none'};
  let r=null;
  try{r=JSON.parse(raw);}catch(e){return{state:'unreadable'};}
  if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.day)||typeof r.n!=='number'||!isFinite(r.n)||!Array.isArray(r.rows))return{state:'unreadable'};
  const rows=r.rows.filter(function(x){return x&&typeof x.code==='string'&&typeof x.hi==='number';}).slice(0,5);
  if(r.n>0&&!rows.length)return{state:'unreadable'};
  return{state:r.n>0?'ok':'empty',day:r.day,n:r.n,rows:rows};
}
function phmRestockCard(){
  const E=phEl,card=E('section','ph-card phm-rs');card.setAttribute('data-card','restock');
  card.appendChild(E('h3','ph-card-title',phI18nD('ov.restock_title')));
  const R=phmRestockRead();
  if(R.state==='none'||R.state==='unreadable'){
    const p=E('p','ph-note',phI18nD(R.state==='none'?'ov.restock_none_yet':'ov.restock_unreadable'));
    if(R.state==='unreadable')p.setAttribute('role','alert');
    card.appendChild(p);
  }else{
    if(R.state==='empty')card.appendChild(E('p','ph-note',phI18nD('ov.restock_empty')));
    else{
      const ul=E('ul','phm-rs-list');
      R.rows.forEach(function(x){ul.appendChild(E('li','phm-rs-row',phI18nD('ov.restock_row',{code:x.code,name:typeof x.label==='string'?x.label:'',hi:x.hi})));});
      card.appendChild(ul);
      if(R.n>R.rows.length)card.appendChild(E('p','phm-rs-asof',phI18nD('ov.restock_more',{n:R.n,shown:R.rows.length})));
    }
    card.appendChild(E('p','phm-rs-asof',phI18nD('ov.restock_asof',{day:R.day})));
    let today=null;try{today=phDay(Date.now());}catch(e){today=null;}
    if(today&&R.day<today)card.appendChild(E('p','phm-rs-old',phI18nD('ov.restock_older')));
  }
  const b=_phmBtn('ph-btn phm-rs-go',phI18nD('ov.restock_open'),function(){
    try{if(typeof _phTkLeave==='function')_phTkLeave();}catch(e){}
    if(typeof showPage==='function')showPage('shopify-intel');
  });
  b.setAttribute('data-act','open-intel');
  card.appendChild(b);
  return card;
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
  host.appendChild(_phmAttentionCard(M,host,{limit:8,qc:true,ctx:ctx}));
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

/* ─────────────────────────────────────────────────────────────────────────
   Production Ops ▸ Reports tab (12 Oct 2026).  js/ph-mod-reports.js

   A READ-ONLY report over the POs and the cutting records: daily, weekly or a
   custom range, filtered by master, season and article. It writes NOTHING (a
   recorded-write test and a source scan hold it): every figure is read, nothing
   is saved, no ph-write function is called.

   WHERE THE FIGURES COME FROM, and who decides them:
     - EVERY rule lives in js/ph-core.js. This file calls phReport / phMasterLog /
       phMastersSummary / phGrossVariance / phSeasonOf and only arranges what they
       return; it reimplements none of them. (A PO's membership of a row is asked of
       phReport itself, one PO at a time, so a row's PO list can never disagree with
       the figure beside it.)
     - A "cut record" is a PO with cutAt and cut quantities (what markCuttingDone
       writes). Its master and fabric come from the PO's fabric-issue gate pass(es)
       (gpType 'fabric', the Cutting / Issue Registry): cutMaster, fabricUsed, the
       first pass's date is the issue day (phReport's issueAtById). A PO with no pass
       falls back to its planned master; fabric then reads "not recorded".
     - POs and gate passes are the classic app's own lists (allPOs / allPasses) when
       they hold anything; when they are empty this tab reads the two collections once
       itself, so a refused read is NAMED ("unavailable — pos") and is never an empty
       report. Standards, masters and settings come from js/ph-data.js (ctx.get).

   HONESTY (CLAUDE.md "Loading must never hang", the Store lesson): a failed or unread
   collection prints "unavailable — <collection>", never a number; a cut-based figure
   with no cut record behind it prints "no data yet", never 0 (a real zero is printed
   once cut records exist). Nothing here rejects.

   Everything global is phr/_phr/PHR_ prefixed (classic scripts, ONE lexical scope).
   ───────────────────────────────────────────────────────────────────────── */

const PHR_NO_DATA='no data yet';
const PHR_READ_TIMEOUT_MS=20000;
const PHR_POS_LIMIT=2000;
const PHR_PASS_LIMIT=4000;
const PHR_MODES=Object.freeze(['day','week','custom','all']);
const PHR_SEASON_FILTERS=Object.freeze(['','winter','summer','all','none']);
const PHR_NONE_MASTER='__none';
const PHR_SHEETS=Object.freeze({summary:'Summary',seasons:'By season',cutMaster:'Cut per master',cutDay:'Cut per day',cutWeek:'Cut per week',grossProduct:'Gross per product',grossMaster:'Gross per master',averages:'Averages',lead:'Lead time and delay',overrides:'Cut gate overrides'});

/* ── small helpers ─────────────────────────────────────────────────────── */
// ONE key for a PO number in any spelling ('PO-125', '125', 'po-0125'): ph-core's phPoKey. 71 of 208 real fabric passes store the
// bare digits, and matching them as text left those POs with no master and no fabric. Not a PO number -> the squashed upper-case text.
function _phrIdKey(x){const k=typeof phPoKey==='function'?phPoKey(x):null;return k!==null?k:phStr(x).replace(/\s+/g,'').toUpperCase();}
function _phrN(x,dp){
  if(typeof x!=='number'||!isFinite(x))return'';
  const neg=x<0,a=Math.abs(x);
  const s=dp==null?String(Math.round(a*1e6)/1e6):a.toFixed(dp);
  const p=s.split('.');p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return(neg?'-':'')+p.join('.');
}
function _phrPct(x){return typeof x==='number'&&isFinite(x)?(x>0?'+':'')+_phrN(x,2)+'%':'';}
function _phrUnavail(cols){return'unavailable — '+cols.join(', ');}
function _phrPush(map,k,v){if(!map.has(k))map.set(k,[]);map.get(k).push(v);}
function _phrSum(a,f){let t=0;a.forEach(function(x){const v=f(x);if(typeof v==='number'&&isFinite(v))t+=v;});return t;}
function _phrCmp(a,b){return a<b?-1:a>b?1:0;}
function _phrToday(){return phDay(Date.now());}
function _phrObj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}

/* ── filters and the range ─────────────────────────────────────────────── */
let _phrF={mode:'week',day:'',from:'',to:'',master:'',season:'',article:''};
let _phrSel=null;      // {sec,key}: the row whose POs are shown
const PHR_VERDICT={within:'✓ Within',over:'▲ Over',under:'▼ Under',nostandard:'No standard',noactual:'No actual',unit_mismatch:'Unit differs',single:'Only one master',none:'Not recorded'};

function _phrNormFilters(f,today){
  const o=_phrObj(f)?f:{};
  const mode=PHR_MODES.indexOf(o.mode)>-1?o.mode:'week';
  const day=phIsDay(o.day)?o.day:(today||'');
  const season=PHR_SEASON_FILTERS.indexOf(o.season)>-1?o.season:'';
  const out={mode:mode,day:day,from:phStr(o.from).trim(),to:phStr(o.to).trim(),master:phStr(o.master).trim().toLowerCase()===PHR_NONE_MASTER?PHR_NONE_MASTER:phMasterKey(o.master),season:season,article:phStr(o.article).trim().toUpperCase()};
  let from=null,to=null,bad=false,why=null;
  if(mode==='day'||mode==='week'){
    if(!phIsDay(day)){bad=true;why='Pick a valid day.';}
    else if(mode==='day'){from=day;to=day;}
    else{from=phWeekStart(day);to=phDayAdd(from,6);}
  }else if(mode==='custom'){
    from=out.from===''?null:(phIsDay(out.from)?out.from:undefined);
    to=out.to===''?null:(phIsDay(out.to)?out.to:undefined);
    if(from===undefined||to===undefined){bad=true;why='A date is not a real day (use YYYY-MM-DD).';from=to=null;}
    else if(from!==null&&to!==null&&from>to){bad=true;why='"From" is after "To".';from=to=null;}
  }
  out.range={from:from,to:to,bad:bad,why:why};
  return out;
}
function _phrRangeText(F){
  const r=F.range;
  if(r.bad)return'invalid range';
  if(r.from===null&&r.to===null)return'all dates';
  if(r.from===null)return'up to '+r.to;
  if(r.to===null)return'from '+r.from;
  return r.from===r.to?r.from:r.from+' to '+r.to;
}
function _phrFilterText(F,names){
  const bits=[];
  bits.push(F.master===''?'all masters':F.master===PHR_NONE_MASTER?'master: unassigned':'master: '+((names&&names[F.master])||F.master));
  bits.push(F.season===''?'all seasons':F.season==='none'?'season: none set':'season: '+F.season);
  bits.push(F.article===''?'all articles':'article: '+F.article+'*');
  return bits.join(' · ');
}

/* ── the sources: the classic app's lists, else one read of our own ─────── */
function _phrSrcFresh(){return{state:'idle',rows:null,err:null,text:null,from:null,truncated:false,at:null};}
let _phrSrc={pos:_phrSrcFresh(),gatepasses:_phrSrcFresh()};
let _phrVer=0;
let _phrLoadP=null;
let _phrCtx=null;
function _phrAppRows(col){
  try{
    if(col==='pos'&&typeof allPOs!=='undefined'&&Array.isArray(allPOs)&&allPOs.length)return allPOs;
    if(col==='gatepasses'&&typeof allPasses!=='undefined'&&Array.isArray(allPasses)&&allPasses.length)return allPasses;
  }catch(e){}
  return null;
}
function _phrTimeout(p,ms){
  let t;
  const to=new Promise(function(_,rej){t=setTimeout(function(){const e=new Error('read timed out');e.code='timeout';rej(e);},ms);});
  return Promise.race([p,to]).then(function(v){clearTimeout(t);return v;},function(e){clearTimeout(t);throw e;});
}
function _phrErrText(col,e){
  const i=typeof phErrInfo==='function'?phErrInfo(e):{code:'',message:String(e&&e.message||e),permission:false,quota:false};
  if(i.permission)return col+': could not be read (permission denied) - check the published firestore.rules, then retry.';
  if(i.quota)return col+': the Firestore read quota is used up - retry later.';
  if(i.code==='from-cache')return col+': only this device\'s offline copy was available, so it was not read - get a connection and retry.';
  if(i.code==='timeout')return col+': the read did not finish in '+Math.round(PHR_READ_TIMEOUT_MS/1000)+'s - retry.';
  return col+': read failed ('+(i.message||i.code||'unknown')+').';
}
// One bounded read. NEVER rejects: {ok:true,rows,truncated} or {ok:false,err,text}.
async function _phrReadOwn(col,lim){
  try{
    if(typeof getDocs!=='function'||typeof query!=='function'||typeof collection!=='function'||typeof db==='undefined')throw new Error('Firestore is not available');
    const snap=await _phrTimeout(getDocs(query(collection(db,col),orderBy('ts','desc'),limit(lim))),PHR_READ_TIMEOUT_MS);
    if(snap&&snap.metadata&&snap.metadata.fromCache===true){const e=new Error('answered from the offline copy');e.code='from-cache';throw e;}
    const rows=((snap&&snap.docs)||[]).map(function(d){return Object.assign({},d.data(),{fbKey:d.id});});
    return{ok:true,rows:rows,truncated:rows.length>=lim};
  }catch(e){
    return{ok:false,err:e,text:_phrErrText(col,e)};
  }
}
// Fill pos and gatepasses once. force: re-read both from the server (the app's lists may be old). only: a list of names.
function _phrEnsure(force,only){
  if(_phrLoadP&&!force)return _phrLoadP;
  const names=(Array.isArray(only)&&only.length?only:['pos','gatepasses']).filter(function(n){return n==='pos'||n==='gatepasses';});
  // an error is retried only when asked (Retry / Reload): a failed read must not re-read itself on every repaint
  const todo=names.filter(function(n){return force||_phrSrc[n].state==='idle';});
  if(!todo.length)return Promise.resolve(true);
  const own=[];
  todo.forEach(function(n){
    const app=force?null:_phrAppRows(n);
    if(app){_phrSrc[n]={state:'ok',rows:app.slice(),err:null,text:null,from:'app',truncated:false,at:Date.now()};_phrVer++;}
    else{_phrSrc[n]=Object.assign(_phrSrcFresh(),{state:'loading'});own.push(n);}
  });
  if(!own.length)return Promise.resolve(true);
  const p=Promise.all(own.map(async function(n){
    const r=await _phrReadOwn(n,n==='pos'?PHR_POS_LIMIT:PHR_PASS_LIMIT);
    _phrSrc[n]=r.ok?{state:'ok',rows:r.rows,err:null,text:null,from:'own',truncated:r.truncated,at:Date.now()}:{state:'error',rows:null,err:r.err,text:r.text,from:'own',truncated:false,at:Date.now()};
  })).catch(function(e){
    own.forEach(function(n){if(_phrSrc[n].state==='loading')_phrSrc[n]={state:'error',rows:null,err:e,text:_phrErrText(n,e),from:'own',truncated:false,at:Date.now()};});
  }).then(function(){_phrLoadP=null;_phrVer++;return true;});
  _phrLoadP=p;
  return p;
}
function phrResetSources(){_phrSrc={pos:_phrSrcFresh(),gatepasses:_phrSrcFresh()};_phrLoadP=null;_phrVer++;_phrSel=null;_phrMemo=null;}

/* ── THE BUILD: pure. sources + filters in, a model of sections out ─────── */
// inp: {today, filters, pos:{state,rows,truncated,text,from}, passes:{...}, standards:{ok,rows,text}, masters:{ok,rows,text}, settings:{ok,rows,text}}
function phrBuild(inp){
  const I=_phrObj(inp)?inp:{};
  const today=phIsDay(I.today)?I.today:_phrToday();
  const F=_phrNormFilters(I.filters,today);
  const range={from:F.range.from,to:F.range.to};
  const P=I.pos||{state:'idle'},G=I.passes||{state:'idle'};
  const stdOk=!!(I.standards&&I.standards.ok),mstOk=!!(I.masters&&I.masters.ok),setOk=!!(I.settings&&I.settings.ok);
  const m={filters:F,range:range,badRange:F.range.bad,rangeText:_phrRangeText(F),today:today,
    srcState:{pos:P.state||'idle',gatepasses:G.state||'idle',ph_standards:stdOk?'ok':'error',cutting_masters:mstOk?'ok':'error',ph_settings:setOk?'ok':'error'},
    notices:[],sections:[],counts:{},report:null,members:Object.create(null),poIndex:Object.create(null),masterNames:Object.create(null),
    exportable:false,loading:false};
  const notice=function(level,text){m.notices.push({level:level,text:text});};
  if(P.state==='loading'||P.state==='idle'||G.state==='loading'||G.state==='idle'){m.loading=true;}
  const posOk=P.state==='ok'&&Array.isArray(P.rows);
  const passOk=G.state==='ok'&&Array.isArray(G.rows);
  if(P.state==='error')notice('bad',P.text||'pos: read failed.');
  if(G.state==='error')notice('bad',G.text||'gatepasses: read failed.');
  if(!stdOk)notice('warn',(I.standards&&I.standards.text)||'ph_standards: not loaded - the standard and the verdicts are unavailable.');
  if(!mstOk)notice('warn',(I.masters&&I.masters.text)||'cutting_masters: not loaded - masters are shown as recorded, not checked against the registry.');
  const rawSettings=setOk&&_phrObj(I.settings.rows)?I.settings.rows:{};
  if(!setOk)notice('warn',(I.settings&&I.settings.text)||'ph_settings: not loaded - the default tolerances apply (3% over, 5% under).');
  if(P.truncated)notice('warn','pos: the list was cut at '+PHR_POS_LIMIT+' newest POs - older POs are not in this report.');
  if(G.truncated)notice('warn','gatepasses: the list was cut at '+PHR_PASS_LIMIT+' newest passes - older fabric issues are not in this report.');
  if(F.range.bad){notice('bad',F.range.why||'The range is not valid.');}

  // the registry, aliases, standards
  const regRows=mstOk&&Array.isArray(I.masters.rows)?I.masters.rows.map(function(r){return Object.assign({id:r.fbKey},r);}):null;
  const aliasMap=Object.create(null);
  if(regRows)regRows.forEach(function(r){const e=phMasterEntry(r);if(e&&Array.isArray(r.aliases))r.aliases.forEach(function(a){const k=phMasterKey(a);if(k&&!aliasMap[k])aliasMap[k]=e.name;});});
  const stdMap=Object.create(null);
  if(stdOk&&Array.isArray(I.standards.rows))I.standards.rows.forEach(function(r){stdMap[phStr(r.fbKey).trim().toUpperCase()]=r;});
  const coreOpts={standards:stdMap,settings:rawSettings,today:today};
  if(regRows)coreOpts.masters=regRows;
  const tol=phSettings(rawSettings);
  m.tolerance={over:tol.grossOverTolPct,under:tol.grossUnderTolPct,known:setOk};
  const resolveMaster=function(name,id){
    const n=phNorm(name);
    if(regRows){
      let e=id?phMasterFind(regRows,id):null;
      if(!e&&n)e=phMasterFind(regRows,n);
      if(e)return e.name;
      if(n&&aliasMap[n.toLowerCase()])return aliasMap[n.toLowerCase()];
    }
    return n;
  };

  // gate passes -> per PO: the master and the fabric
  const passIdx=new Map();
  if(passOk)G.rows.forEach(function(gp){
    if(!_phrObj(gp)||phStr(gp.gpType)!=='fabric')return;
    const k=_phrIdKey(gp.poId!=null?gp.poId:(gp.poRef!=null?gp.poRef:gp.poNumber));
    if(!k)return;
    const ms=phMs(gp.date)!==null?phMs(gp.date):phMs(gp.ts);
    _phrPush(passIdx,k,{gp:gp,ms:ms});
  });
  passIdx.forEach(function(list){list.sort(function(a,b){return(a.ms===null?Infinity:a.ms)-(b.ms===null?Infinity:b.ms);});});

  // the PO infos
  const infos=[];
  let junk=0,multiMaster=0,mixedUnit=0,anyCutEver=false,releasedEver=false,noFabricCut=0;
  const issueAtById={};
  if(posOk)P.rows.forEach(function(po){
    const stage=phStageOf(po);
    if(stage===null){junk++;return;}
    const id=phStr(po.id!=null?po.id:po.fbKey).trim();
    const fb=phStr(po.fbKey!=null?po.fbKey:id);
    const list=passIdx.get(_phrIdKey(id))||[];
    let mname='',msrc='none';
    const names={};
    list.forEach(function(x){const n=resolveMaster(x.gp.cutMaster,x.gp.cutMasterId);if(n){names[n.toLowerCase()]=1;if(!mname){mname=n;msrc='pass';}}});
    if(Object.keys(names).length>1)multiMaster++;
    if(!mname){const n=resolveMaster(po.cutMasterName,po.cutMasterId);if(n){mname=n;msrc='planned';}}
    const first=list.length&&list[0].ms!==null?list[0].ms:null;
    if(first!==null)issueAtById[id]=first;
    // fabric used: the sum of the PO's fabric-issue passes, one unit only (kg and m are never added)
    const byUnit={};
    list.forEach(function(x){
      const f=phNum(x.gp.fabricUsed!=null?x.gp.fabricUsed:x.gp.fabricQty),u=phUnit(x.gp.fabricUnit!=null?x.gp.fabricUnit:x.gp.unit);
      if(f!==null&&f>0&&u!==null)byUnit[u]=(byUnit[u]||0)+f;
    });
    const units=Object.keys(byUnit);
    let fabric=null,funit=null;
    if(units.length===1){fabric=byUnit[units[0]];funit=units[0];}
    else if(units.length>1)mixedUnit++;
    const code=phStr(po.code!=null?po.code:po.articleCode).trim().toUpperCase();
    const info={po:po,id:id,fb:fb,stage:stage,code:code,master:mname,masterKey:phMasterKey(mname),masterSrc:msrc,season:phSeasonOf(po),fabric:fabric,funit:funit,jobs:[],cutDay:null};
    if(stage!=='cancelled'){
      const hasCutAt=phMs(po.cutAt)!==null;
      let cutArg=null,cbs;
      if(_phrObj(po.cutQty)){const any=Object.keys(po.cutQty).some(function(k){const q=phWhole(po.cutQty[k]);return q!==null&&q>0;});if(any){cutArg=po.cutQty;cbs=po.cutQty;}}
      else{const q=phWhole(po.cutQty);if(q!==null&&q>0)cutArg=q;}
      if(hasCutAt&&cutArg!==null){
        const job={id:id,poId:id,master:mname,cutDay:po.cutAt,cutUnits:cutArg,articleCode:code,sizeModel:po.sizeModel,sizeAxis:po.sizeAxis};
        if(cbs)job.cutBySize=cbs;
        if(fabric!==null){job.fabricUsed=fabric;job.unit=funit;}
        info.jobs.push(job);info.cutDay=phDay(po.cutAt);anyCutEver=true;
        if(fabric===null)noFabricCut++;
      }
      if(stage!=='reserved'&&stage!=='unknown')releasedEver=true;
    }
    infos.push(info);
    m.poIndex[fb]=info;
  });
  infos.forEach(function(i){if(i.master&&!m.masterNames[i.masterKey])m.masterNames[i.masterKey]=i.master;});
  if(regRows)regRows.forEach(function(r){const e=phMasterEntry(r);if(e)m.masterNames[e.key]=e.name;});

  // filters
  const passSA=function(i){
    if(F.article&&i.code.indexOf(F.article)!==0)return false;
    if(F.season){const s=i.season.season===null?'none':i.season.season;if(s!==F.season)return false;}
    return true;
  };
  const passM=function(i){
    if(F.master==='')return true;
    return F.master===PHR_NONE_MASTER?i.masterKey==='':i.masterKey===F.master;
  };
  const teamInfos=infos.filter(passSA);
  const filtered=teamInfos.filter(passM);
  const pos=filtered.map(function(i){return i.po;});
  const jobs=[];filtered.forEach(function(i){i.jobs.forEach(function(j){jobs.push(j);});});
  const teamJobs=[];teamInfos.forEach(function(i){i.jobs.forEach(function(j){teamJobs.push(j);});});
  m.counts={posLoaded:posOk?P.rows.length:null,junk:junk,filtered:filtered.length,withCutRecord:filtered.filter(function(i){return i.jobs.length>0;}).length,anyCutEver:anyCutEver,releasedEver:releasedEver,multiMaster:multiMaster,mixedUnit:mixedUnit,cutWithoutFabric:noFabricCut};
  if(multiMaster)notice('info',multiMaster+(multiMaster===1?' PO has':' POs have')+' fabric issues under more than one cutting master; the first issue\'s master is used for it.');
  if(mixedUnit)notice('info',mixedUnit+(mixedUnit===1?' PO has':' POs have')+' fabric issued in both kg and metres; its gross consumption is not computed (the two are never added).');

  const needPos=!posOk;
  const needMaster=!passOk;
  if(F.range.bad||needPos){
    m.sections=_phrUnavailableSections(needPos?_phrUnavail(['pos']):('invalid range — '+(F.range.why||'')));
    return m;
  }

  // the figures: phReport once for the whole set, then once per PO so every row can list its POs
  const report=phReport(pos,jobs,range,Object.assign({issueAtById:issueAtById},coreOpts));
  m.report=report;
  const mem=m.members;
  filtered.forEach(function(i){
    if(i.stage==='cancelled')return;
    const one=phReport([i.po],i.jobs,range,Object.assign({issueAtById:issueAtById},coreOpts));
    const x={fb:i.fb,id:i.id,code:i.code,masterKey:i.masterKey,master:i.master,issued:false,seasonKey:null,seasonLabel:'',guessed:false,issueQty:null,cut:false,cutDay:null,cutUnits:null,lead:null,leadDays:null,gap:null,gapDays:null,funit:i.funit};
    const sea=_phrSum(one.seasons,function(r){return r.pos;});
    if(sea>0){x.issued=true;x.seasonKey=one.seasons[0].key;x.seasonLabel=one.seasons[0].label;x.guessed=one.seasons[0].guessed>0;x.issueQty=one.avgPoIssueQty.n===1?one.avgPoIssueQty.total:null;}
    if(one.cutTotal.n>0){x.cut=true;x.cutDay=i.cutDay;x.cutUnits=one.cutTotal.units;}
    x.lead=one.leadTime.n?'counted':one.leadTime.noStart?'noStart':one.leadTime.invalid?'invalid':null;
    x.leadDays=one.leadTime.n?one.leadTime.value:null;
    x.gap=one.delayGap.n?(one.delayGap.late?'late':one.delayGap.early?'early':'ontime'):(one.delayGap.noPlan?'noplan':null);
    x.gapDays=one.delayGap.n?one.delayGap.value:null;
    mem[i.fb]=x;
  });
  const ids=function(pred){return Object.keys(mem).filter(function(k){return pred(mem[k]);}).sort(function(a,b){return _phrCmp(mem[a].id,mem[b].id);});};

  // team (all masters under the other filters): the benchmark
  const teamLog=phMasterLog(teamJobs,null,range,coreOpts);
  const teamGross=teamLog.totals?teamLog.totals.gross:{kg:null,m:null};
  const teamSum=phMastersSummary(teamJobs,range,coreOpts);

  // ─ sections ─
  const pushSec=function(id,title,o){m.sections.push(Object.assign({id:id,title:title,sheet:PHR_SHEETS[id],state:'ok',message:'',columns:[],rows:[],foot:null,notes:[]},o));};
  const cutNoData=!anyCutEver;
  const cutEmptyMsg=cutNoData?PHR_NO_DATA+' — no PO has a recorded cut (cutAt with cut quantities)':'nothing was cut in this range with these filters';
  const cutBlank=function(){return{state:cutNoData?'nodata':'empty',message:cutEmptyMsg};};
  const masterBlock=needMaster?{state:'unavailable',message:_phrUnavail(['gatepasses'])+' — the cutting master of each PO comes from its fabric issue'}:null;
  const issuedAll=ids(function(x){return x.issued;});
  const cutAll=ids(function(x){return x.cut;});

  // 1 summary
  {
    const relNone=!releasedEver;
    const stagePos=function(st){return filtered.filter(function(i){return st.indexOf(i.stage)>-1&&mem[i.fb];}).map(function(i){return i.fb;}).sort(function(a,b){return _phrCmp(mem[a].id,mem[b].id);});};
    const issuedN=_phrSum(report.seasons,function(r){return r.pos;}),issuedU=_phrSum(report.seasons,function(r){return r.units;});
    const noU=_phrSum(report.seasons,function(r){return r.noUnits;});
    const cutVal=function(v){return cutNoData?PHR_NO_DATA:v;};
    const rows=[
      {key:'issued',cells:['POs issued',relNone?PHR_NO_DATA:issuedN,relNone?'no released PO yet':(report.excluded.datedFromTs?report.excluded.datedFromTs+' dated from creation (no release date)':'released POs by issue day')],pos:issuedAll},
      {key:'units',cells:['Units issued',relNone?PHR_NO_DATA:issuedU,noU?noU+' PO(s) with no quantity are not counted':'ordered pieces of those POs'],pos:issuedAll},
      {key:'cut',cells:['Units cut',cutVal(report.cutTotal.units===null?0:report.cutTotal.units),cutNoData?'no PO has a recorded cut':report.cutTotal.n+' cut record(s) in range'],pos:cutAll},
      {key:'afloat',cells:['Units afloat (snapshot)',report.pipeline.state==='ok'?report.unitsAfloat.units:PHR_NO_DATA,'issued pieces of released POs still at cutting - all dates'],pos:stagePos(['cutting'])},
      {key:'prod',cells:['Units in production (snapshot)',report.pipeline.state==='ok'?report.inProduction.units:PHR_NO_DATA,'cutting to QC, actual cut once cut - all dates'],pos:stagePos(PH_REAL_STAGE_ORDER)}
    ];
    pushSec('summary','Summary',{columns:[{k:'m',l:'Measure'},{k:'v',l:'Value',n:true,f:'int'},{k:'d',l:'Detail'}],rows:rows});
  }
  // 2 seasons
  {
    const sec={rows:[],notes:[],foot:null,columns:[{k:'s',l:'Season'},{k:'p',l:'POs',n:true,f:'int'},{k:'u',l:'Units',n:true,f:'int'},{k:'b',l:'',bar:true},{k:'st',l:'Stored',n:true,f:'int'},{k:'g',l:'Guessed from date',n:true,f:'int'},{k:'nu',l:'No quantity',n:true,f:'int'}]};
    if(!report.seasons.length)Object.assign(sec,{state:releasedEver?'empty':'nodata',message:releasedEver?'no PO was issued in this range':PHR_NO_DATA+' — no released PO yet'});
    else{
      const max=Math.max.apply(null,report.seasons.map(function(r){return r.units;}).concat([1]));
      report.seasons.forEach(function(r){
        sec.rows.push({key:r.key,cells:[r.label,r.pos,r.units,r.units/max,r.pos-r.guessed,r.guessed,r.noUnits],flag:r.guessed>0,pos:ids(function(x){return x.issued&&x.seasonKey===r.key;})});
      });
      sec.notes.push('"Guessed" means the PO has no stored season, so ph-core read it from the planned cut / issue date (Oct-Jan winter, Feb-Sep summer). A guess can mislabel a winter garment cut in summer - set the season on the PO to fix it.');
    }
    pushSec('seasons','By season',sec);
  }
  // 3 cut per master
  {
    const sec={rows:[],notes:[],foot:null,columns:[{k:'ms',l:'Master'},{k:'u',l:'Units cut',n:true,f:'int'},{k:'b',l:'',bar:true},{k:'j',l:'Cut jobs',n:true,f:'int'},{k:'a',l:'Avg cut qty',n:true,f:'d1'},{k:'r',l:'In registry'}]};
    if(masterBlock)Object.assign(sec,masterBlock);
    else if(!report.unitsCutPerMaster.length)Object.assign(sec,cutBlank());
    else{
      const max=Math.max.apply(null,report.unitsCutPerMaster.map(function(r){return r.units;}).concat([1]));
      report.unitsCutPerMaster.forEach(function(r){
        sec.rows.push({key:r.masterKey,cells:[r.name,r.units,r.units/max,r.jobs,r.avgCutQty,r.registered===null?(mstOk?'':_phrUnavail(['cutting_masters'])):(r.masterKey===''?'—':r.registered?'yes':'no - not in registry')],flag:r.registered===false,pos:ids(function(x){return x.cut&&x.masterKey===r.masterKey;})});
      });
      sec.foot={cells:['All masters',report.cutTotal.units,null,report.cutTotal.n,report.avgCutQty.value,'']};
    }
    pushSec('cutMaster','Cut per master',sec);
  }
  // 4/5 cut per day / per week, one column per master
  {
    const cols=report.unitsCutPerMaster.map(function(r){return r;});
    const groups=new Map();
    jobs.forEach(function(j){_phrPush(groups,phMasterKey(j.master),j);});
    const logs=new Map();
    cols.forEach(function(r){logs.set(r.masterKey,phMasterLog(groups.get(r.masterKey)||[],null,range,coreOpts));});
    const all=phMasterLog(jobs,null,range,coreOpts);
    const mk=function(kind){
      const sec={rows:[],notes:[],foot:null,columns:[{k:'d',l:kind==='day'?'Day':'Week (Monday start)'}]};
      cols.forEach(function(r,i){sec.columns.push({k:'m'+i,l:r.name,n:true,f:'int'});});
      sec.columns.push({k:'t',l:'Total',n:true,f:'int'});
      if(masterBlock){Object.assign(sec,masterBlock);return sec;}
      if(!all.totals){Object.assign(sec,cutBlank());return sec;}
      const list=kind==='day'?all.daily:all.weekly;
      list.forEach(function(b){
        const cells=[kind==='day'?b.day:(b.weekStart+' to '+b.weekEnd+(b.partial?' (partial)':''))];
        cols.forEach(function(r){
          const lg=logs.get(r.masterKey),arr=lg?(kind==='day'?lg.daily:lg.weekly):[];
          const hit=arr.filter(function(x){return x.key===b.key;})[0];
          cells.push(hit?hit.units:null);
        });
        cells.push(b.units);
        sec.rows.push({key:b.key,cells:cells,pos:ids(function(x){return x.cut&&(kind==='day'?x.cutDay===b.key:phWeekStart(x.cutDay)===b.key);})});
      });
      sec.foot={cells:['Total'].concat(cols.map(function(r){const lg=logs.get(r.masterKey);return lg&&lg.totals?lg.totals.units:null;})).concat([all.totals.units])};
      if(kind==='week')sec.notes.push('Weeks start on Monday (Saturday and Sunday end the week). "(partial)" = the range cuts the week short.');
      sec.notes.push('A blank cell means that master cut nothing that '+(kind==='day'?'day':'week')+' - it is not a recorded zero.');
      return sec;
    };
    pushSec('cutDay','Cut per day',mk('day'));
    pushSec('cutWeek','Cut per week',mk('week'));
  }
  // 6 gross per product vs the standard
  {
    const sec={rows:[],notes:[],foot:null,columns:[{k:'c',l:'Article'},{k:'u',l:'Unit'},{k:'j',l:'Cut jobs',n:true,f:'int'},{k:'p',l:'Pieces with fabric',n:true,f:'int'},{k:'f',l:'Fabric used',n:true,f:'d2'},{k:'g',l:'Avg gross / piece',n:true,f:'d4'},{k:'s',l:'Standard / piece',n:true,f:'d4'},{k:'gap',l:'Gap',n:true,f:'pct'},{k:'t',l:'Tolerance'},{k:'v',l:'Verdict',f:'verdict'}]};
    const byCode=new Map();
    jobs.forEach(function(j){_phrPush(byCode,j.articleCode||'(no code)',j);});
    if(!byCode.size)Object.assign(sec,cutBlank());
    else{
      const rows=[];
      byCode.forEach(function(list,code){
        const lg=phMasterLog(list,null,range,coreOpts);
        if(!lg.totals)return;
        const t=lg.totals,std=stdOk?phStandard(stdMap[code]):null;
        const pos0=ids(function(x){return x.cut&&x.code===code;});
        let any=false;
        PH_UNITS.forEach(function(u){
          const g=t.gross[u];if(!g)return;any=true;
          const vs=t.vsStandard[u];
          const stdHere=std&&std.unit===u?std.grossPerPiece:null;
          let verdict,gap=null,tolTxt='';
          if(!stdOk)verdict=_phrUnavail(['ph_standards']);
          else{
            verdict=vs.state==='nostandard'?'nostandard':vs.state;
            if(vs.gapPct!==null&&vs.gapPct!==undefined){gap=vs.gapPct;tolTxt='+'+vs.tolerancePct.over+'% / -'+vs.tolerancePct.under+'%';}
            if(vs.coveredPieces&&vs.totalPieces&&vs.coveredPieces<vs.totalPieces)verdict={t:PHR_VERDICT[vs.state]+' (judged on '+vs.coveredPieces+' of '+vs.totalPieces+' pieces)',key:vs.state};
          }
          rows.push({key:code+'|'+u,cells:[code,u,t.jobs,g.pieces,g.fabric,g.perPiece,stdHere,gap,tolTxt,verdict],pos:pos0.filter(function(k){return mem[k].funit===u;}),sortUnits:g.pieces,flag:vs.state==='over'||vs.state==='under'});
        });
        if(!any)rows.push({key:code+'|-',cells:[code,'—',t.jobs,null,null,null,std?std.grossPerPiece:null,null,'','none'],pos:pos0,sortUnits:-1,note:true});
      });
      rows.sort(function(a,b){return(b.sortUnits-a.sortUnits)||_phrCmp(a.cells[0],b.cells[0]);});
      if(!rows.length)Object.assign(sec,cutBlank());
      else{
        sec.rows=rows;
        sec.notes.push('Tolerance: the standard\'s own, else the settings ('+tol.grossOverTolPct+'% over, '+tol.grossUnderTolPct+'% under'+(setOk?'':' - defaults, ph_settings did not load')+'). Pieces with fabric = pieces of cuts whose fabric issue recorded kg or metres; a cut with no fabric recorded is counted in Cut jobs only.');
        if(noFabricCut)sec.notes.push(noFabricCut+' cut PO(s) have no fabric issue recorded, so they have no gross consumption.');
      }
    }
    pushSec('grossProduct','Gross per product',sec);
  }
  // 7 gross per master, against the standard and the team average
  {
    const sec={rows:[],notes:[],foot:null,columns:[{k:'ms',l:'Master'},{k:'u',l:'Unit'},{k:'p',l:'Pieces with fabric',n:true,f:'int'},{k:'f',l:'Fabric used',n:true,f:'d2'},{k:'g',l:'Avg gross / piece',n:true,f:'d4'},{k:'gs',l:'vs standard',n:true,f:'pct'},{k:'vs',l:'Standard verdict',f:'verdict'},{k:'tm',l:'Team avg / piece',n:true,f:'d4'},{k:'gt',l:'vs team',n:true,f:'pct'},{k:'vt',l:'Team verdict',f:'verdict'}]};
    if(masterBlock)Object.assign(sec,masterBlock);
    else if(!report.grossPerMaster.length)Object.assign(sec,cutBlank());
    else{
      const nTeam={};
      PH_UNITS.forEach(function(u){nTeam[u]=teamSum.rows.filter(function(r){return r.gross[u];}).length;});
      report.grossPerMaster.forEach(function(r){
        let any=false;
        PH_UNITS.forEach(function(u){
          const g=r.gross[u];if(!g)return;any=true;
          const vs=r.vsStandard[u];
          const team=teamGross[u];
          let tv='single',gt=null,tm=team?team.perPiece:null;
          if(team&&nTeam[u]>=2){
            const b=phGrossVariance({perPiece:g.perPiece,unit:u},null,{perPiece:team.perPiece,n:team.pieces},coreOpts);
            tv=b.benchmark.state;gt=b.benchmark.gapPct;
          }
          const sv=!stdOk?_phrUnavail(['ph_standards']):vs.state;
          sec.rows.push({key:r.masterKey+'|'+u,cells:[r.name,u,g.pieces,g.fabric,g.perPiece,stdOk?vs.gapPct:null,sv,tm,gt,tv],pos:ids(function(x){return x.cut&&x.masterKey===r.masterKey&&x.funit===u;}),flag:vs.state==='over'||vs.state==='under'||tv==='over'||tv==='under'});
        });
        if(!any)sec.rows.push({key:r.masterKey+'|-',cells:[r.name,'—',null,null,null,null,'none',null,null,'none'],pos:ids(function(x){return x.cut&&x.masterKey===r.masterKey;}),note:true});
      });
      sec.notes.push('Team average = every master\'s fabric ÷ pieces under the same season / article / range filters. With only one master with fabric in a unit there is nothing to compare, and it says so.');
    }
    pushSec('grossMaster','Gross per master',sec);
  }
  // 8 averages
  {
    const none=function(me){return me.n?me.value:PHR_NO_DATA;};
    const rows=[];
    rows.push({key:'issue',cells:['Average PO issue qty (pieces)',none(report.avgPoIssueQty),report.avgPoIssueQty.n,report.avgPoIssueQty.total],pos:ids(function(x){return x.issued&&x.issueQty!==null;})});
    rows.push({key:'cut',cells:['Average cut qty (pieces per cut)',cutNoData?PHR_NO_DATA:none(report.avgCutQty),cutNoData?null:report.avgCutQty.n,cutNoData?null:report.avgCutQty.total],pos:cutAll});
    pushSec('averages','Averages',{columns:[{k:'m',l:'Measure'},{k:'v',l:'Average',n:true,f:'d1'},{k:'n',l:'POs counted',n:true,f:'int'},{k:'t',l:'Total pieces',n:true,f:'int'}],rows:rows});
  }
  // 9 lead time and delay
  {
    const lt=report.leadTime,dg=report.delayGap;
    const cv=function(v){return cutNoData?PHR_NO_DATA:v;};
    const rows=[
      {key:'lead',cells:['Average lead time, issue to cut (days)',cutNoData?PHR_NO_DATA:(lt.n?lt.value:PHR_NO_DATA),cutNoData?null:lt.n,'POs cut in range with a known issue day'],pos:ids(function(x){return x.lead==='counted';})},
      {key:'leadlate',cells:['  of which later than the delay target',cv(lt.n?lt.late:PHR_NO_DATA),cutNoData?null:lt.n,'target '+tol.delayTargetDays+' day(s)'],pos:ids(function(x){return x.lead==='counted'&&x.leadDays>tol.delayTargetDays;})},
      {key:'nostart',cells:['Excluded: no issue / release date',cv(lt.noStart),null,'only the creation time is known - never averaged'],pos:ids(function(x){return x.lead==='noStart';})},
      {key:'invalid',cells:['Excluded: cut dated before the issue',cv(lt.invalid),null,'not averaged'],pos:ids(function(x){return x.lead==='invalid';})},
      {key:'gap',cells:['Average delay gap, cut vs planned day (days, + = late)',cutNoData?PHR_NO_DATA:(dg.n?dg.value:PHR_NO_DATA),cutNoData?null:dg.n,'POs cut in range that had a planned cut day'],pos:ids(function(x){return x.gap==='late'||x.gap==='early'||x.gap==='ontime';})},
      {key:'late',cells:['  Cut late',cv(dg.n?dg.late:PHR_NO_DATA),cutNoData?null:dg.n,dg.pctLate!==null?dg.pctLate+'% of those':''],pos:ids(function(x){return x.gap==='late';})},
      {key:'ontime',cells:['  Cut on the planned day',cv(dg.n?dg.onTime:PHR_NO_DATA),cutNoData?null:dg.n,''],pos:ids(function(x){return x.gap==='ontime';})},
      {key:'early',cells:['  Cut early',cv(dg.n?dg.early:PHR_NO_DATA),cutNoData?null:dg.n,''],pos:ids(function(x){return x.gap==='early';})},
      {key:'noplan',cells:['Excluded: no planned cut day',cv(dg.noPlan),null,'no plan to be late against'],pos:ids(function(x){return x.gap==='noplan';})}
    ];
    pushSec('lead','Lead time and delay',{columns:[{k:'m',l:'Measure'},{k:'v',l:'Value',n:true,f:'d1'},{k:'n',l:'POs',n:true,f:'int'},{k:'d',l:'Detail'}],rows:rows});
  }
  // 10 cut-gate overrides
  {
    const sec={rows:[],notes:[],foot:null,columns:[{k:'p',l:'PO'},{k:'c',l:'Article'},{k:'by',l:'Approved by'},{k:'d',l:'Day'},{k:'s',l:'Status'},{k:'r',l:'Reason'},{k:'a',l:'Cut total',n:true,f:'int'},{k:'q',l:'Ordered',n:true,f:'int'},{k:'pc',l:'% of ordered',n:true,f:'d1'}]};
    const rows=[];
    filtered.forEach(function(i){
      const co=i.po.cutOverride;
      if(i.stage==='cancelled'||!_phrObj(co)||!phStr(co.by).trim())return;
      const used=phDay(co.usedAt)!==null,day=used?phDay(co.usedAt):phDay(co.at);
      if(day===null)return;
      if((range.from!==null&&day<range.from)||(range.to!==null&&day>range.to))return;
      rows.push({key:i.fb,cells:[i.id,i.code,phStr(co.byName||co.by),day,used?'used on the cut':'approved, not used yet',phStr(co.reason),phNum(co.actualTotal),phWhole(i.po.qty),phNum(co.pct)],pos:[i.fb],sortDay:day});
    });
    rows.sort(function(a,b){return _phrCmp(a.sortDay,b.sortDay)||_phrCmp(a.cells[0],b.cells[0]);});
    if(!rows.length)Object.assign(sec,{state:cutNoData?'nodata':'empty',message:cutNoData?PHR_NO_DATA+' — no PO has a recorded cut':'no cut-gate override in this range'});
    else sec.rows=rows;
    pushSec('overrides','Cut gate overrides',sec);
  }
  if(report.excluded.datedFromTs)notice('info',report.excluded.datedFromTs+' issued PO(s) have no release or fabric-issue date and are dated from creation.');
  if(report.reserved)notice('info',report.reserved+' reserved PO(s) are not in the issue-based figures.');
  if(report.unknown)notice('info',report.unknown+' PO(s) are in a stage ph-core does not recognise and are left out.');
  if(report.duplicateJobs)notice('info',report.duplicateJobs+' repeated cut record(s) counted once.');
  if(junk)notice('info',junk+' document(s) in pos are not POs and were ignored.');
  m.exportable=true;
  return m;
}
function _phrUnavailableSections(msg){
  return Object.keys(PHR_SHEETS).map(function(id){return{id:id,title:PHR_SHEETS[id],sheet:PHR_SHEETS[id],state:'unavailable',message:msg,columns:[],rows:[],foot:null,notes:[]};});
}

/* ── cell text ─────────────────────────────────────────────────────────── */
function _phrVerdictText(v){
  if(v&&typeof v==='object')return v.t;
  return PHR_VERDICT[v]||phStr(v);
}
function _phrCellText(col,v){
  if(v===null||v===undefined||v==='')return'—';
  if(col.f==='verdict')return _phrVerdictText(v);
  if(typeof v==='number'){
    if(col.f==='pct')return _phrPct(v);
    const dp=col.f==='d1'?1:col.f==='d2'?2:col.f==='d3'?3:col.f==='d4'?4:col.f==='int'?0:null;
    return _phrN(v,dp);
  }
  return phStr(v);
}
function _phrXVal(col,v){
  if(v===null||v===undefined)return'';
  if(col.f==='verdict')return _phrVerdictText(v);
  if(typeof v==='number')return v;
  return phStr(v);
}
function phrAoa(sec){
  if(sec.state!=='ok'){return[[sec.title],[sec.message||PHR_NO_DATA]];}
  const cols=sec.columns.filter(function(c){return!c.bar;});
  const idx=sec.columns.map(function(c,i){return c.bar?-1:i;}).filter(function(i){return i>=0;});
  const out=[cols.map(function(c){return c.l;})];
  sec.rows.forEach(function(r){out.push(idx.map(function(i){return _phrXVal(sec.columns[i],r.cells[i]);}));});
  if(sec.foot)out.push(idx.map(function(i){return _phrXVal(sec.columns[i],sec.foot.cells[i]);}));
  return out;
}
function phrFileBase(model){
  const r=model.range;
  const span=r.from===null&&r.to===null?'all-dates':(r.from||'start')+'_to_'+(r.to||'today');
  return'Production-Report-'+span;
}

/* ── exports: Excel (SheetJS) and PDF (the print engine, 'generic') ────── */
function _phrToast(msg,err){try{if(typeof showToast==='function')showToast(msg,!!err);}catch(e){}}
function _phrCanExport(model){
  if(!(typeof phCanManage==='function'&&phCanManage()===true)){_phrToast('Exports are for the managers.',true);return false;}
  if(!model||!model.exportable){_phrToast('Nothing to export - the report has no data to show (see the notices).',true);return false;}
  return true;
}
function phrInfoRows(model){
  const rows=[['Production Ops report'],['Range',model.rangeText],['Filters',_phrFilterText(model.filters,model.masterNames)],['Generated',new Date().toISOString()],[]];
  [['pos','pos'],['gatepasses','gatepasses'],['ph_standards','ph_standards'],['cutting_masters','cutting_masters'],['ph_settings','ph_settings']].forEach(function(p){rows.push(['Source '+p[0],model.srcState[p[1]]==='ok'?'read':'unavailable']);});
  model.notices.forEach(function(n){rows.push(['Notice',n.text]);});
  return rows;
}
function phrExportXlsx(model){
  if(!_phrCanExport(model))return false;
  if(typeof XLSX==='undefined'||!XLSX.utils){_phrToast('The spreadsheet library did not load - refresh and try again.',true);return false;}
  try{
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(phrInfoRows(model)),'Info');
    model.sections.forEach(function(sec){XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(phrAoa(sec)),sec.sheet);});
    XLSX.writeFile(wb,phrFileBase(model)+'.xlsx');
    return true;
  }catch(e){_phrToast('Could not build the Excel file: '+(e&&e.message||e),true);return false;}
}
function _phrPdfText(s){return phStr(s).replace(/[<>]/g,'').replace(/\s+/g,' ').trim();}
function phrPdfBody(model){
  const L=[];
  L.push('Range: '+model.rangeText);
  L.push('Filters: '+_phrPdfText(_phrFilterText(model.filters,model.masterNames)));
  model.notices.forEach(function(n){L.push('Note: '+_phrPdfText(n.text));});
  model.sections.forEach(function(sec){
    L.push('');L.push(_phrPdfText(sec.title).toUpperCase());
    if(sec.state!=='ok'){L.push('   '+_phrPdfText(sec.message||PHR_NO_DATA));return;}
    const cols=sec.columns.map(function(c,i){return{c:c,i:i};}).filter(function(x){return!x.c.bar;});
    L.push('   '+cols.map(function(x){return _phrPdfText(x.c.l);}).join(' | '));
    sec.rows.forEach(function(r){L.push('   '+cols.map(function(x){return _phrPdfText(_phrCellText(x.c,r.cells[x.i]));}).join(' | '));});
    if(sec.foot)L.push('   '+cols.map(function(x){return _phrPdfText(_phrCellText(x.c,sec.foot.cells[x.i]));}).join(' | '));
  });
  return L.join('\n');
}
function phrExportPdf(model){
  if(!_phrCanExport(model))return false;
  if(typeof window==='undefined'||typeof window.printDocument!=='function'){_phrToast('The print engine did not load - refresh and try again.',true);return false;}
  try{
    window.printDocument({type:'generic',filename:phrFileBase(model)+'.pdf',data:{documentNumber:'PROD-'+(model.range.from||'ALL'),title:'Production Report',subtitle:model.rangeText+' · '+_phrPdfText(_phrFilterText(model.filters,model.masterNames)),bodyHtml:phrPdfBody(model),urduLevel:'none'}});
    return true;
  }catch(e){_phrToast('Could not build the PDF: '+(e&&e.message||e),true);return false;}
}

/* ── the tab ───────────────────────────────────────────────────────────── */
let _phrMemo=null;
function _phrInput(ctx){
  const g=function(s){return ctx.get(s);};
  const st=g('standards'),ms=g('masters'),se=g('settings');
  return{today:_phrToday(),filters:_phrF,pos:_phrSrc.pos,passes:_phrSrc.gatepasses,
    standards:{ok:st.ok,rows:st.rows,text:st.text},masters:{ok:ms.ok,rows:ms.rows,text:ms.text},settings:{ok:se.ok,rows:se.rows,text:se.text}};
}
function _phrModelFor(ctx){
  const inp=_phrInput(ctx);
  const lk=function(s){return typeof phLoadState==='function'?((phLoadState(s)||{}).at||0)+':'+((phLoadState(s)||{}).state||''):'';};
  const key=JSON.stringify([_phrF,_phrVer,inp.today,lk('standards'),lk('masters'),lk('settings'),_phrSrc.pos.state,_phrSrc.gatepasses.state]);
  if(_phrMemo&&_phrMemo.key===key)return _phrMemo.model;
  const model=phrBuild(inp);
  _phrMemo={key:key,model:model};
  return model;
}
function _phrRepaint(){
  const c=_phrCtx;if(!c)return;
  try{
    const root=typeof document!=='undefined'?document.getElementById('phr-root'):null;
    if(root&&typeof c.repaint==='function')c.repaint();
  }catch(e){}
}
function phrSetFilter(key,val){
  if(['master','season','article','day','from','to'].indexOf(key)<0)return false;
  _phrF=Object.assign({},_phrF);_phrF[key]=phStr(val);
  _phrSel=null;_phrRepaint();return true;
}
function phrSetMode(mode){
  if(PHR_MODES.indexOf(mode)<0)return false;
  const cur=_phrNormFilters(_phrF,_phrToday());
  _phrF=Object.assign({},_phrF,{mode:mode});
  if(!phIsDay(_phrF.day))_phrF.day=_phrToday();
  if(mode==='custom'&&!_phrF.from&&!_phrF.to&&!cur.range.bad){_phrF.from=cur.range.from||'';_phrF.to=cur.range.to||'';}
  _phrSel=null;_phrRepaint();return true;
}
function phrStep(dir){
  const F=_phrNormFilters(_phrF,_phrToday());
  if(F.mode!=='day'&&F.mode!=='week')return false;
  const n=phDayAdd(F.day,(dir<0?-1:1)*(F.mode==='week'?7:1));
  if(n===null)return false;
  _phrF=Object.assign({},_phrF,{day:n});_phrSel=null;_phrRepaint();return true;
}
function phrResetFilters(){_phrF={mode:'week',day:'',from:'',to:'',master:'',season:'',article:''};_phrSel=null;_phrRepaint();return true;}
function phrSelect(sec,key){
  _phrSel=_phrSel&&_phrSel.sec===sec&&_phrSel.key===key?null:{sec:sec,key:key};
  _phrRepaint();return true;
}
function phrReload(){
  _phrSel=null;
  const p=_phrEnsure(true);_phrRepaint();
  return p.then(function(){_phrRepaint();return true;});
}
function phrRetrySources(){
  const bad=['pos','gatepasses'].filter(function(n){return _phrSrc[n].state==='error';});
  const p=_phrEnsure(true,bad);_phrRepaint();
  return p.then(function(){_phrRepaint();return true;});
}
// Click-through: leave the Production Ops takeover first (it never strands), then open the PO in the classic detail page.
function phrOpenPo(fb){
  if(typeof window==='undefined'||typeof window.openPODetail!=='function'){_phrToast('The PO page is not available here.',true);return false;}
  try{if(typeof phExit==='function')phExit();}catch(e){}
  try{window.openPODetail(fb);return true;}catch(e){_phrToast('Could not open the PO.',true);return false;}
}

/* DOM builders ... every stored string goes in through textContent (phEl) */
function _phrBtn(cls,text,fn,attrs){
  const b=phEl('button',cls,text);b.setAttribute('type','button');
  if(attrs)Object.keys(attrs).forEach(function(k){b.setAttribute(k,attrs[k]);});
  if(fn)b.addEventListener('click',fn);
  return b;
}
function _phrField(label,control){return phEl('label','phr-field',null,[phEl('span','phr-lab',label),control]);}
function _phrSelect(current,options,onchange,aria){
  const s=phEl('select','phr-in');
  options.forEach(function(o){const op=phEl('option','',o[1]);op.value=o[0];op.setAttribute('value',o[0]);if(o[0]===current)op.setAttribute('selected','selected');s.appendChild(op);});
  s.value=current;
  if(aria)s.setAttribute('aria-label',aria);
  s.addEventListener('change',function(){onchange(s.value);});
  return s;
}
function _phrInEl(type,value,onchange,aria){
  const i=phEl('input','phr-in');i.setAttribute('type',type);i.value=value;
  if(aria)i.setAttribute('aria-label',aria);
  i.addEventListener('change',function(){onchange(i.value);});
  return i;
}
function _phrMasterOptions(model){
  const seen=Object.create(null),opts=[['','All masters']];
  const add=function(k,n){if(!k||seen[k])return;seen[k]=1;opts.push([k,n]);};
  Object.keys(model.masterNames).sort().forEach(function(k){add(k,model.masterNames[k]);});
  opts.push([PHR_NONE_MASTER,'Unassigned (no master recorded)']);
  return opts;
}
function _phrFilters(model){
  const F=model.filters;
  const bar=phEl('section','ph-card phr-filters');bar.setAttribute('aria-label','Report filters');
  const modes=phEl('div','phr-modes');modes.setAttribute('role','group');modes.setAttribute('aria-label','Range');
  [['day','Day'],['week','Week'],['custom','Custom'],['all','All dates']].forEach(function(m){
    const b=_phrBtn('phr-mode'+(F.mode===m[0]?' on':''),m[1],function(){phrSetMode(m[0]);},{'aria-pressed':F.mode===m[0]?'true':'false','data-mode':m[0]});
    modes.appendChild(b);
  });
  bar.appendChild(modes);
  const row=phEl('div','phr-row');
  if(F.mode==='day'||F.mode==='week'){
    row.appendChild(_phrBtn('phr-step','←',function(){phrStep(-1);},{'aria-label':'Previous '+F.mode,'data-step':'-1'}));
    row.appendChild(_phrField(F.mode==='day'?'Day':'Week containing',_phrInEl('date',phIsDay(F.day)?F.day:'',function(v){phrSetFilter('day',v);},F.mode==='day'?'Day':'A day in the week')));
    row.appendChild(_phrBtn('phr-step','→',function(){phrStep(1);},{'aria-label':'Next '+F.mode,'data-step':'1'}));
  }else if(F.mode==='custom'){
    row.appendChild(_phrField('From',_phrInEl('date',F.from,function(v){phrSetFilter('from',v);},'From')));
    row.appendChild(_phrField('To',_phrInEl('date',F.to,function(v){phrSetFilter('to',v);},'To')));
  }
  row.appendChild(_phrField('Master',_phrSelect(F.master,_phrMasterOptions(model),function(v){phrSetFilter('master',v);},'Master')));
  row.appendChild(_phrField('Season',_phrSelect(F.season,[['','All seasons'],['winter','Winter'],['summer','Summer'],['all','All-season'],['none','No season set']],function(v){phrSetFilter('season',v);},'Season')));
  row.appendChild(_phrField('Article code',_phrInEl('text',F.article,function(v){phrSetFilter('article',v);},'Article code (starts with)')));
  bar.appendChild(row);
  const act=phEl('div','phr-row phr-actions');
  act.appendChild(phEl('p','phr-range','Showing: '+model.rangeText+' · '+_phrFilterText(F,model.masterNames)));
  act.appendChild(_phrBtn('ph-btn','Reset filters',function(){phrResetFilters();}));
  act.appendChild(_phrBtn('ph-btn','Reload from server',function(){phrReload();}));
  act.appendChild(_phrBtn('ph-btn ph-btn-primary','Export Excel',function(){phrExportXlsx(model);},{'data-act':'xlsx'}));
  act.appendChild(_phrBtn('ph-btn ph-btn-primary','Export PDF',function(){phrExportPdf(model);},{'data-act':'pdf'}));
  bar.appendChild(act);
  return bar;
}
function _phrNotices(model){
  if(!model.notices.length)return null;
  const bad=model.notices.some(function(n){return n.level==='bad';});
  const c=phEl('section','ph-card phr-notices'+(bad?' ph-card-err':''));c.setAttribute('role',bad?'alert':'status');
  c.appendChild(phEl('h3','ph-card-title',bad?'Some data could not be read':'Notes on these figures'));
  const ul=phEl('ul','ph-lines');
  model.notices.forEach(function(n){ul.appendChild(phEl('li','ph-line',null,[phEl('span','ph-chip '+(n.level==='bad'?'ph-chip-bad':'ph-chip-wait'),n.level==='bad'?'✕ Unavailable':n.level==='warn'?'! Check':'i Note'),phEl('span','ph-line-txt',n.text)]));});
  c.appendChild(ul);
  if(['pos','gatepasses'].some(function(k){return _phrSrc[k].state==='error';}))c.appendChild(_phrBtn('ph-btn ph-btn-primary','Retry',function(){phrRetrySources();},{'data-act':'retry'}));
  return c;
}
function _phrCell(col,v,sec){
  const td=phEl('td',col.n?'phr-num':'');
  if(col.bar){
    const track=phEl('div','phr-bar');track.setAttribute('aria-hidden','true');
    const fill=phEl('i');
    const pct=typeof v==='number'&&isFinite(v)?Math.max(0,Math.min(100,Math.round(v*100))):0;
    fill.setAttribute('style','width:'+pct+'%');
    track.appendChild(fill);td.appendChild(track);td.className='phr-barcell';
    return td;
  }
  if(col.f==='verdict'){
    const key=v&&typeof v==='object'?v.key:v;
    const t=_phrCellText(col,v);
    if(key==='within'||key==='over'||key==='under')td.appendChild(phEl('span','phr-v phr-v-'+key,t));
    else td.appendChild(phEl('span',/^unavailable/.test(t)?'phr-v phr-v-na':'phr-v',t));
    return td;
  }
  td.textContent=_phrCellText(col,v);
  if(typeof v==='string'&&v===PHR_NO_DATA)td.className=(col.n?'phr-num ':'')+'phr-nodata';
  return td;
}
function _phrTable(sec){
  const wrap=phEl('div','phr-scroll');wrap.setAttribute('tabindex','0');wrap.setAttribute('role','region');wrap.setAttribute('aria-label',sec.title+' table');
  const t=phEl('table','phr-table');
  t.setAttribute('aria-label',sec.title);
  const head=phEl('tr');
  sec.columns.forEach(function(c){const th=phEl('th',c.n?'phr-num':'',c.bar?'':c.l);th.setAttribute('scope','col');head.appendChild(th);});
  const th=phEl('th','phr-poh','POs');th.setAttribute('scope','col');head.appendChild(th);
  t.appendChild(phEl('thead','',null,[head]));
  const body=phEl('tbody');
  sec.rows.forEach(function(r){
    const on=_phrSel&&_phrSel.sec===sec.id&&_phrSel.key===r.key;
    const tr=phEl('tr','phr-row-tr'+(r.flag?' phr-flag':'')+(on?' on':''));
    tr.setAttribute('data-key',r.key);
    sec.columns.forEach(function(c,i){tr.appendChild(_phrCell(c,r.cells[i],sec));});
    const td=phEl('td','phr-pocell');
    if(r.pos&&r.pos.length){
      const b=_phrBtn('phr-pobtn'+(on?' on':''),'POs ('+r.pos.length+')',function(e){if(e&&e.stopPropagation)e.stopPropagation();phrSelect(sec.id,r.key);},{'aria-expanded':on?'true':'false','aria-label':'Show the '+r.pos.length+' PO(s) behind '+phStr(r.cells[0]),'data-sec':sec.id});
      td.appendChild(b);
      tr.addEventListener('click',function(){phrSelect(sec.id,r.key);});
      tr.className+=' phr-click';
    }else td.appendChild(phEl('span','phr-nopos','—'));
    tr.appendChild(td);
    body.appendChild(tr);
  });
  if(sec.foot){
    const tr=phEl('tr','phr-foot');
    sec.columns.forEach(function(c,i){tr.appendChild(_phrCell(c,sec.foot.cells[i],sec));});
    tr.appendChild(phEl('td','phr-pocell'));
    body.appendChild(tr);
  }
  t.appendChild(body);wrap.appendChild(t);
  return wrap;
}
function _phrPoPanel(model,sec,row){
  const panel=phEl('div','phr-pos');panel.setAttribute('role','region');panel.setAttribute('aria-label','POs behind '+phStr(row.cells[0]));
  const head=phEl('div','phr-pos-head',null,[phEl('h4','phr-pos-title','POs behind: '+phStr(row.cells[0])+' ('+row.pos.length+')'),_phrBtn('ph-btn','Close',function(){phrSelect(sec.id,row.key);},{'data-act':'close-pos'})]);
  panel.appendChild(head);
  const wrap=phEl('div','phr-scroll');wrap.setAttribute('tabindex','0');
  const t=phEl('table','phr-table');
  const hr=phEl('tr');['PO','Article','Name','Ordered','Stage','Master','Cut day','Cut pieces','Season',''].forEach(function(h,i){const th=phEl('th',i===3||i===7?'phr-num':'',h);th.setAttribute('scope','col');hr.appendChild(th);});
  t.appendChild(phEl('thead','',null,[hr]));
  const body=phEl('tbody');
  row.pos.forEach(function(fb){
    const info=model.poIndex[fb],mm=model.members[fb];
    if(!info)return;
    const tr=phEl('tr','phr-row-tr');
    const q=phWhole(info.po.qty);
    [info.id,info.code||'—',phStr(info.po.name),q===null?'—':_phrN(q,0),info.stage,info.master||'Unassigned',mm&&mm.cutDay?mm.cutDay:'—',mm&&mm.cutUnits!=null?_phrN(mm.cutUnits,0):'—',info.season.key?phSeasonLabel(info.season.key)+(info.season.guess?' (guessed)':''):'No season'].forEach(function(v,i){tr.appendChild(phEl('td',i===3||i===7?'phr-num':'',v));});
    const td=phEl('td','phr-pocell');
    td.appendChild(_phrBtn('phr-pobtn','Open PO',function(){phrOpenPo(info.fb);},{'aria-label':'Open '+info.id,'data-fb':info.fb}));
    tr.appendChild(td);body.appendChild(tr);
  });
  t.appendChild(body);wrap.appendChild(t);panel.appendChild(wrap);
  return panel;
}
function _phrSection(model,sec){
  const card=phEl('section','ph-card phr-sec');card.setAttribute('data-sec',sec.id);
  const h=phEl('div','phr-sec-head',null,[phEl('h3','ph-card-title',sec.title)]);
  card.appendChild(h);
  if(sec.state!=='ok'){
    const cls=sec.state==='unavailable'?'phr-state phr-state-bad':'phr-state';
    const p=phEl('p',cls,sec.message||PHR_NO_DATA);
    if(sec.state==='unavailable')p.setAttribute('role','alert');
    card.appendChild(p);
    return card;
  }
  card.appendChild(_phrTable(sec));
  sec.notes.forEach(function(n){card.appendChild(phEl('p','phr-note',n));});
  if(_phrSel&&_phrSel.sec===sec.id){
    const row=sec.rows.filter(function(r){return r.key===_phrSel.key;})[0];
    if(row&&row.pos&&row.pos.length)card.appendChild(_phrPoPanel(model,sec,row));
  }
  return card;
}
function phrRender(host,ctx){
  _phrCtx=ctx;
  const root=phEl('div','phr-root');root.id='phr-root';
  host.appendChild(root);
  const head=phEl('header','ph-head');
  head.appendChild(phEl('div','ph-head-row',null,[phEl('h2','ph-title','Reports')]));
  head.appendChild(phEl('p','ph-blurb','Cutting by day, week and master; consumption against the standard; season, lead time and delay. Read-only - nothing here changes a PO.'));
  root.appendChild(head);
  if(!ctx.canManage){
    root.appendChild(phEl('section','ph-card ph-card-err',null,[phEl('h3','ph-card-title','No access'),phEl('p','ph-note','Reports are for Afnan, Ammar and Mustafa.')]));
    return;
  }
  // start (or finish) reading the POs and gate passes; the tab repaints when they settle
  const ensure=_phrEnsure(false);
  if(_phrSrc.pos.state==='loading'||_phrSrc.gatepasses.state==='loading'||_phrSrc.pos.state==='idle'||_phrSrc.gatepasses.state==='idle'){
    const c=phEl('section','ph-card');c.setAttribute('role','status');c.setAttribute('aria-busy','true');
    c.appendChild(phEl('h3','ph-card-title','Reading POs and gate passes…'));
    c.appendChild(phEl('div','gv-skel ph-skel ph-skel-a'));
    root.appendChild(c);
    ensure.then(function(){_phrRepaint();});
    return;
  }
  const model=_phrModelFor(ctx);
  root.appendChild(_phrFilters(model));
  const n=_phrNotices(model);if(n)root.appendChild(n);
  model.sections.forEach(function(sec){root.appendChild(_phrSection(model,sec));});
}
if(typeof phRegisterTab==='function')phRegisterTab('reports',{render:phrRender});

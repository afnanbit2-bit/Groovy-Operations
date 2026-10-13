/* ─────────────────────────────────────────────────────────────────────────
   Production Ops ▸ PO Queue (12 Oct 2026) -- the tile board.  Tab id `queue` in js/ph-ui.js's PH_TABS.

   What it is: every RELEASED PO as a tile, in a column per real stage (cutting, bundling, stitching,
   printing, washing, final QC -- the order of js/pos.js PO_REAL_STAGE_ORDER). Reserved POs (not
   released) and completed ones sit in collapsed lanes below the board; cancelled POs are hidden (and
   counted). Each tile: PO number, article code and name, quantity, season (ph-core: stored, else
   guessed from the planned date and FLAGGED as a guess), the planned cut day and master from
   po_cut_jobs, an age / delay badge (ph-core phLeadTime, phDelayGap, phAllocate) and an "Afloat" mark
   (units afloat = ISSUED pieces of POs still at cutting, ph-core owner decision 5).

   What it writes -- and ONLY this:
     PLAN   js/ph-write.js phSaveCutJob(): po_cut_jobs/{PO-nnn} plus the pos/{id}/history row, in one
            transaction. Managers only (afnan, ammar, mustafa). Nothing else here ever writes.
     ADVANCE  NOT a write path of this file. "Force-advance" calls the EXISTING guarded
            window.ownerAdvance(fbKey, stage) in js/pos.js (its own confirm, its own role check, its own
            transaction that re-judges poForceAdvancePlan on the live document). It is offered to
            owners + Mustafa (_poCanEdit) only, never for cutting (poForceAdvancePlan refuses it: the
            cut is recorded on the cutting screen), and ownerAdvance's trailing renderDetailPage() is
            held off while it runs, because that function would otherwise paint a PO page over this tab
            or navigate to the registry.
   The cutting floor's Kashif (login `uzaib`, a viewer) sees this tab too, but only to ENTER DRAFTS (the
   Drafts sub-panel, js/ph-mod-drafts.js phDraftsPanel) and to look at the board READ-ONLY: no Plan, no
   Force-advance button is ever drawn for him and both entry points refuse him.

   Honesty rules (CLAUDE.md "Loading must never hang"): the pos read is this file's own, bounded and
   timed out; it NEVER rejects; a read that failed is named and prints no number and no tiles, and a
   refresh that failed keeps the old tiles but says so and when they are from. Cut plans / masters that
   failed to load read "not loaded", never "unassigned". Days are PKT strings (ph-core). Every stored
   string reaches the page through textContent; nothing here parses a string as HTML. Globals are
   phq / _phq / PHQ_ prefixed (classic scripts, ONE lexical scope with ph-core / ph-data / ph-write /
   ph-ui, which this file reuses and does not copy or edit).
   ───────────────────────────────────────────────────────────────────────── */

const PHQ_LANES=Object.freeze([
  Object.freeze({id:'cutting',  label:'Cutting'}),
  Object.freeze({id:'bundling', label:'Bundling'}),
  Object.freeze({id:'stitching',label:'Stitching'}),
  Object.freeze({id:'printing', label:'Printing'}),
  Object.freeze({id:'washing',  label:'Washing'}),
  Object.freeze({id:'qc',       label:'Final QC'})
]);
const PHQ_SIDE_LANES=Object.freeze([
  Object.freeze({id:'reserved', label:'Reserved (not released yet)'}),
  Object.freeze({id:'completed',label:'Completed'}),
  Object.freeze({id:'unknown',  label:'Stage not recognised'})
]);
const PHQ_LANE_CAP=40;            // tiles drawn per lane before "Show more"
const PHQ_POS_LIMIT=1000;         // newest POs read
const PHQ_STALE_MS=60000;         // a visit to the tab after this long re-reads the POs
const PHQ_TIMEOUT_MS=20000;
const PHQ_MONTHS=Object.freeze(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']);

/* ── who ──────────────────────────────────────────────────────────────── */
function _phqUser(u){
  if(u!==undefined)return typeof u==='string'?u:'';
  return(typeof session!=='undefined'&&session&&typeof session.u==='string')?session.u:'';
}
// Plan = write a cut plan: managers only. Fails closed when the data layer did not load.
function phqCanPlan(u){return typeof phCanManage==='function'&&phCanManage(_phqUser(u))===true;}
// Force-advance = delegate to js/pos.js: owners + Mustafa (its own helper) AND a manager of this module.
// Any piece missing (an older cached pos.js, a failed parse) = no button and a refusal.
function phqCanAdvance(u){
  if(!phqCanPlan(u))return false;
  if(typeof _poCanEdit!=='function')return false;
  try{if(_poCanEdit()!==true)return false;}catch(e){return false;}
  return typeof window!=='undefined'&&!!window&&typeof window.ownerAdvance==='function'&&typeof poForceAdvancePlan==='function';
}

/* ── small helpers (pure) ──────────────────────────────────────────────── */
function _phqStr(x){return typeof phStr==='function'?phStr(x):(x==null?'':String(x));}
function _phqDayLabel(day,today){
  if(typeof phIsDay!=='function'||!phIsDay(day))return'';
  const y=day.slice(0,4),m=+day.slice(5,7),d=+day.slice(8,10);
  return d+' '+PHQ_MONTHS[m-1]+(today&&today.slice(0,4)!==y?' '+y:'');
}
// HH:MM in Pakistan time (fixed UTC+5) for a moment in ms.
function _phqClock(ms){
  if(typeof ms!=='number'||!isFinite(ms))return'';
  const d=new Date(ms+5*3600000);
  const p=function(n){return(n<10?'0':'')+n;};
  return p(d.getUTCHours())+':'+p(d.getUTCMinutes());
}
function _phqLaneLabel(id){
  const all=PHQ_LANES.concat(PHQ_SIDE_LANES);
  for(let i=0;i<all.length;i++)if(all[i].id===id)return all[i].label;
  return id;
}
// The id a PO is stored under (= its document id). Plan / advance need the PO-nnn shape.
function _phqIdOf(po){return _phqStr(po&&(po.fbKey||po.id)).trim();}
function _phqPlannable(id){return /^PO-[0-9]{3,}$/.test(id);}

/* ── the model: ONE pure function, no DOM, no clock unless given ───────── */
// phqModel(pos, jobs, o) -> {tiles:[...all non-cancelled], pipeline, cancelled, lanes:{id:[tile]}}
//   pos: array of PO docs (with fbKey) | jobs: array of po_cut_jobs rows (with fbKey) or null (not loaded)
//   o: {now(ms), settings (resolved), jobsLoaded}
function phqModel(pos,jobs,o){
  const x=o||{};
  const now=typeof x.now==='number'&&isFinite(x.now)?x.now:Date.now();
  const today=phDay(now);
  const S=typeof phSettings==='function'?phSettings(x.settings||{}):(x.settings||{});
  const list=Array.isArray(pos)?pos:[];
  const jobBy=Object.create(null);
  (Array.isArray(jobs)?jobs:[]).forEach(function(j){if(j&&j.fbKey)jobBy[j.fbKey]=j;});
  const pipeline=phPipeline(list);
  // 1. the released POs still at cutting are placed against capacity, in plan-day order (phAllocate)
  const cut=[];
  list.forEach(function(p){
    if(phStageOf(p)!=='cutting')return;
    const id=_phqIdOf(p),j=jobBy[id]||null;
    const units=phPoUnits(p).units;
    if(units===null||units<=0)return;
    cut.push({id:id,qty:units,requestedDay:j&&phIsDay(j.plannedCutDate)?j.plannedCutDate:null});
  });
  const alloc=today!==null&&cut.length?phAllocate(cut,Object.assign({},S,{startDay:today})):null;
  const tiles=[];
  let cancelled=0;
  list.forEach(function(p){
    const st=phStageOf(p);
    if(st===null)return;
    if(st==='cancelled'){cancelled++;return;}
    tiles.push(phqTileOf(p,jobBy[_phqIdOf(p)]||null,{today:today,now:now,S:S,alloc:alloc,jobsLoaded:x.jobsLoaded!==false&&Array.isArray(jobs),firstIssue:x.firstIssueById}));
  });
  const lanes={};
  PHQ_LANES.concat(PHQ_SIDE_LANES).forEach(function(l){lanes[l.id]=[];});
  tiles.forEach(function(t){(lanes[t.lane]||lanes.unknown).push(t);});
  Object.keys(lanes).forEach(function(k){lanes[k].sort(_phqTileCmp);});
  return{tiles:tiles,pipeline:pipeline,cancelled:cancelled,lanes:lanes,today:today,settings:S,alloc:alloc};
}
function _phqTileCmp(a,b){
  const pa=a.plan.day||'9999-99-99',pb=b.plan.day||'9999-99-99';
  if(pa!==pb)return pa<pb?-1:1;
  if(a.ts!==b.ts)return a.ts<b.ts?-1:1;
  return a.id<b.id?-1:a.id>b.id?1:0;
}
function phqTileOf(po,job,x){
  const stage=phStageOf(po);
  const id=_phqIdOf(po);
  const planDay=job&&phIsDay(job.plannedCutDate)?job.plannedCutDate:null;
  const lane=PHQ_LANES.some(function(l){return l.id===stage;})?stage:(stage==='reserved'||stage==='completed'?stage:'unknown');
  const u=phPoUnits(po);
  const season=phSeasonOf(Object.assign({},po,{plannedCutDate:planDay||po.plannedCutDate}));
  const tile={
    id:id,po:_phqStr(po.id||id),fbKey:id,code:_phqStr(po.code!=null?po.code:po.articleCode).trim(),name:_phqStr(po.name).trim(),
    stage:stage,lane:lane,units:u.units,unitsBasis:u.basis,
    ts:phMs(po.ts)||0,
    season:{key:season.key,label:season.key?phSeasonLabel(season.key):'No season',guess:!!season.guess&&season.key!==null},
    afloat:stage==='cutting',
    plan:{day:planDay,masterId:job&&job.masterId?_phqStr(job.masterId):null,masterName:job?_phqStr(job.masterName).trim():'',status:job?_phqStr(job.status):'',rev:job&&typeof job.rev==='number'?job.rev:null,exists:!!job},
    age:null,delay:{level:'none',text:'',delayed:false}
  };
  if(stage==='cutting'){
    // the age at cutting starts at the FIRST fabric-issue gate pass when there is one (matched through phPoKey), else the release date
    const fk=typeof phPoKey==='function'?phPoKey(id):null,fi=fk!==null&&x.firstIssue&&Object.prototype.hasOwnProperty.call(x.firstIssue,fk)?x.firstIssue[fk]:null;
    const lt=phLeadTime(po,fi!==null?{now:x.now,settings:x.S,issueAt:fi}:{now:x.now,settings:x.S});
    if(lt.state==='open'){
      const basis=lt.quality.indexOf('start_from_ts')>-1?'created':lt.quality.indexOf('start_from_release')>-1?'released':'issued';
      tile.age={days:lt.ageDays,basis:basis,status:lt.status,text:lt.ageDays+'d since '+basis};
    }
    // 1. the plan day passed and the PO is not cut: a fact, not an estimate
    const gap=phDelayGap(po,planDay,{today:x.today});
    if(planDay!==null&&gap.state==='overdue'){
      tile.delay={level:'overdue',text:'Plan passed '+gap.days+'d ago',delayed:true};
    }else{
      // 2. capacity: if cut in plan-day order at the daily capacity, does this one finish after its plan?
      const rec=x.alloc&&x.alloc.byId?x.alloc.byId[id]:null;
      if(planDay!==null&&rec&&rec.delayDays!==null&&rec.delayDays>0){
        tile.delay={level:'late',text:'Capacity: finishes '+_phqDayLabel(rec.finishDay,x.today)+', +'+rec.delayDays+'d after plan',delayed:true};
      }else if(tile.age&&tile.age.basis!=='created'&&(tile.age.status==='stuck'||tile.age.status==='delayed')){
        // 3. age since the fabric was issued / the PO released. Age since CREATED is not an issue-to-cut time
        //    (ph-core refuses to average it) so it is shown but never counted as a delay.
        tile.delay={level:tile.age.status,text:(tile.age.status==='stuck'?'Stuck ':'Slow ')+tile.age.days+'d',delayed:true};
      }
    }
  }else if(PHQ_LANES.some(function(l){return l.id===stage;})){
    // later lanes: how long here, from the previous stage's recorded finish (neutral, never a delay verdict)
    const i=PHQ_LANES.findIndex(function(l){return l.id===stage;});
    const prev=i>0&&po.stages&&po.stages[PHQ_LANES[i-1].id]?po.stages[PHQ_LANES[i-1].id]:null;
    const d=prev?phDay(prev.doneAt):null;
    const n=d!==null&&x.today?phDaysBetween(d,x.today):null;
    if(n!==null&&n>=0)tile.age={days:n,basis:'stage',status:'ok',text:n+'d here'};
  }
  return tile;
}

/* ── filters (pure) ────────────────────────────────────────────────────── */
// f: {season:'' | 'none' | key, master:'' | '__none' | masterKey, q:'', delayed:false}
function phqFilterTiles(tiles,f){
  const F=f||{};
  const q=_phqStr(F.q).trim().toLowerCase();
  return tiles.filter(function(t){
    if(F.season){if(F.season==='none'){if(t.season.key!==null)return false;}else if(t.season.key!==F.season)return false;}
    if(F.master){
      if(F.master==='__none'){if(t.plan.masterName)return false;}
      else if(phMasterKey(t.plan.masterName)!==F.master)return false;
    }
    if(q&&(t.code+' '+t.name+' '+t.po+' '+t.id).toLowerCase().indexOf(q)<0)return false;
    if(F.delayed&&!t.delayed&&!t.delay.delayed)return false;
    return true;
  });
}

/* ── state ─────────────────────────────────────────────────────────────── */
let _phqPos={state:'idle',rows:null,at:0,err:null,truncated:false,stale:false};
let _phqPosP=null;
let _phqSub='';                 // '' = the person's default sub-tab
let _phqF={season:'',master:'',q:'',delayed:false};
let _phqCollapsed={reserved:true,completed:true,unknown:false};
let _phqShowAll={};
let _phqDlg=null;               // the open body-level dialog {node, opener}
let _phqAdvBusy=false;
let _phqBoardEl=null;
let _phqCountEl=null;

function _phqTimeout(p,ms){
  if(typeof _phWithTimeout==='function')return _phWithTimeout(p,ms);
  return p;
}
function _phqErr(e){
  if(typeof phErrInfo==='function')return phErrInfo(e);
  return{code:e&&e.code?String(e.code):'',message:e&&e.message?String(e.message):String(e),permission:false,quota:false};
}
async function _phqReadPos(){
  const snap=await _phqTimeout(getDocs(query(collection(db,'pos'),orderBy('ts','desc'),limit(PHQ_POS_LIMIT))),PHQ_TIMEOUT_MS);
  // an answer from this device's offline copy is not a read of the collection
  if(snap&&snap.metadata&&snap.metadata.fromCache===true){const e=new Error('the read was answered from this device\'s offline copy');e.code='from-cache';throw e;}
  const docs=(snap&&snap.docs)||[];
  return{rows:docs.map(function(d){return Object.assign({},d.data(),{fbKey:d.id});}),truncated:docs.length>=PHQ_POS_LIMIT};
}
// Read the POs (the existing `pos` collection, read-only). NEVER rejects. A failed read keeps older rows (if any)
// and records the error; it never turns into an empty list. Concurrent calls share one read.
function phqLoadPos(force){
  if(_phqPosP)return _phqPosP;
  if(!force&&_phqPos.state==='ok'&&!_phqPos.stale&&Date.now()-_phqPos.at<PHQ_STALE_MS)return Promise.resolve(_phqPos);
  _phqPos.state='loading';
  const p=(async function(){
    let r=null,err=null;
    try{r=await _phqReadPos();}
    catch(e){
      err=_phqErr(e);
      // one retry behind a forced token refresh, for a permission failure only (ph-data.js, js/pos.js loadData)
      if(err.permission&&typeof auth!=='undefined'&&auth&&auth.currentUser&&typeof auth.currentUser.getIdToken==='function'){
        try{await auth.currentUser.getIdToken(true);r=await _phqReadPos();err=null;}catch(e2){err=_phqErr(e2);}
      }
    }
    if(err){
      _phqPos={state:'error',rows:_phqPos.rows,at:_phqPos.at,err:err,truncated:_phqPos.truncated,stale:true};
      if(typeof console!=='undefined')console.warn('[ph-mod-queue] pos read failed:',err.code||err.message);
    }else{
      _phqPos={state:'ok',rows:r.rows,at:Date.now(),err:null,truncated:r.truncated,stale:false};
    }
    return _phqPos;
  })().catch(function(e){
    _phqPos={state:'error',rows:_phqPos.rows,at:_phqPos.at,err:_phqErr(e),truncated:_phqPos.truncated,stale:true};
    return _phqPos;
  }).then(function(v){_phqPosP=null;return v;});
  _phqPosP=p;
  return p;
}
function _phqPosErrText(){
  const e=_phqPos.err;if(!e)return'';
  if(e.permission)return'pos: could not be read - the signed-in account is refused. Retry; if it persists, check the published firestore.rules.';
  if(e.code==='from-cache')return'pos: only this device\'s offline copy was available, so it was not read - get a connection and retry.';
  if(e.code==='timeout')return'pos: the read did not finish in '+Math.round(PHQ_TIMEOUT_MS/1000)+'s - check the connection and retry.';
  if(e.quota)return'pos: the Firestore read quota is used up - retry later.';
  return'pos: read failed ('+(e.message||e.code||'unknown')+').';
}
// Is the queue still the tab on screen? (A read that settles after the person left repaints nothing.)
function _phqIsHere(){
  return typeof _phUiTab==='undefined'||_phUiTab==='queue';
}

/* ── the tab ───────────────────────────────────────────────────────────── */
function _phqSubDefault(manage){return manage?'board':'drafts';}
let _phqSeenUser='';
function phqRender(host,ctx){
  _phqCloseDlg();
  // another person on the same page load (sign out / in without a reload) starts from their own defaults
  if(_phqSeenUser&&_phqSeenUser!==ctx.user){_phqSub='';_phqF={season:'',master:'',q:'',delayed:false};_phqPos={state:'idle',rows:null,at:0,err:null,truncated:false,stale:false};}
  _phqSeenUser=ctx.user;
  const manage=phqCanPlan(ctx.user)&&ctx.canManage!==false;
  const sub=_phqSub||_phqSubDefault(manage);
  const el=ctx.el;
  const head=el('header','ph-head');
  const row=el('div','ph-head-row',null,[el('h2','ph-title','PO Queue')]);
  if(!manage)row.appendChild(el('span','ph-chip ph-chip-view','View only'));
  head.appendChild(row);
  head.appendChild(el('p','ph-blurb',manage
    ?'Every released PO as a tile, by stage. Plan a cut day and master; owners and Mustafa can force a PO forward past cutting.'
    :'Enter PO drafts here. The board is for looking: your account cannot plan or move a PO.'));
  host.appendChild(head);
  // sub-tabs: the board and the drafts panel
  const tabs=el('div','phq-subtabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','PO Queue sections');
  [['board','Board'],['drafts','Drafts']].forEach(function(s){
    const b=el('button','phq-subtab'+(sub===s[0]?' on':''),s[1]);
    b.setAttribute('type','button');b.setAttribute('role','tab');b.setAttribute('aria-selected',sub===s[0]?'true':'false');b.setAttribute('data-sub',s[0]);
    b.addEventListener('click',function(){_phqSub=s[0];ctx.repaint();});
    tabs.appendChild(b);
  });
  host.appendChild(tabs);
  const body=el('div','phq-body');host.appendChild(body);
  if(sub==='drafts')_phqDrafts(body,ctx);
  else _phqBoard(body,ctx,manage);
}
// The Drafts sub-panel is another file's (js/ph-mod-drafts.js, phDraftsPanel). Looked up at render time,
// so a build without it says so; a panel that throws draws an error card, never a blank.
function _phqDrafts(body,ctx){
  if(typeof phDraftsPanel!=='function'){
    body.appendChild(_phqCard('Drafts',[ctx.el('p','ph-note','The drafts panel is not part of this build yet.')]));
    return;
  }
  try{phDraftsPanel(body,ctx);}
  catch(e){
    ctx.clear(body);
    body.appendChild(_phqErrCard('The drafts panel could not be drawn',String(e&&e.message||e)));
    if(typeof console!=='undefined')console.warn('[ph-mod-queue] drafts panel failed:',e);
  }
  if(!body.firstChild)body.appendChild(_phqErrCard('Drafts','The drafts panel drew nothing.'));
}
function _phqCard(title,kids){
  const c=phEl('section','ph-card');
  if(title)c.appendChild(phEl('h3','ph-card-title',title));
  (kids||[]).forEach(function(k){if(k)c.appendChild(k);});
  return c;
}
function _phqErrCard(title,msg,btn){
  const c=phEl('section','ph-card ph-card-err');c.setAttribute('role','alert');
  c.appendChild(phEl('h3','ph-card-title',title));
  c.appendChild(phEl('p','ph-note',msg));
  if(btn)c.appendChild(btn);
  return c;
}
function _phqBtn(cls,text,onclick,attrs){
  const b=phEl('button',cls,text);b.setAttribute('type','button');
  if(attrs)Object.keys(attrs).forEach(function(k){b.setAttribute(k,attrs[k]);});
  if(onclick)b.addEventListener('click',onclick);
  return b;
}

/* ── the board sub-tab ─────────────────────────────────────────────────── */
function _phqBoard(body,ctx,manage){
  // start (or refresh) the read; the tab repaints itself when it settles
  // A failed read is NOT retried on its own (that would loop on a persistent refusal): only the Retry button re-reads.
  const due=_phqPos.state==='idle'||(_phqPos.state==='ok'&&(_phqPos.stale||Date.now()-_phqPos.at>=PHQ_STALE_MS));
  if(due&&!_phqPosP){
    phqLoadPos(false).then(function(){if(_phqIsHere())ctx.repaint();});
  }
  const loading=!!_phqPosP;
  if(typeof phhEnsure==='function'&&typeof phhSources==='function'&&phhSources().gatepasses.state==='idle')phhEnsure(false).then(function(){if(_phqIsHere())ctx.repaint();});   // the gate passes date a PO's time at cutting
  if(_phqPos.rows===null){
    if(_phqPos.state==='error'&&!loading){
      body.appendChild(_phqErrCard('Could not read the POs',_phqPosErrText(),_phqBtn('ph-btn ph-btn-primary','Retry',function(){phqLoadPos(true).then(function(){ctx.repaint();});ctx.repaint();})));
    }else{
      const w=phEl('div','ph-skelwrap');w.setAttribute('aria-busy','true');w.setAttribute('role','status');w.setAttribute('aria-label','Loading the POs');
      ['ph-skel-t','ph-skel-a','ph-skel-b'].forEach(function(c){w.appendChild(phEl('div','gv-skel ph-skel '+c));});
      body.appendChild(w);
    }
    return;
  }
  if(_phqPos.state==='error'&&!loading){
    body.appendChild(_phqErrCard('Could not refresh the POs',_phqPosErrText()+' Showing the POs read at '+_phqClock(_phqPos.at)+' (Pakistan time).',
      _phqBtn('ph-btn','Retry',function(){phqLoadPos(true).then(function(){ctx.repaint();});ctx.repaint();})));
  }
  const settingsInfo=typeof phSettingsInfo==='function'?phSettingsInfo():{known:false,settings:{}};
  const jobsG=ctx.get('jobs'),mastersG=ctx.get('masters');
  const m=phqModel(_phqPos.rows,jobsG.ok?jobsG.rows:null,{settings:settingsInfo.settings,jobsLoaded:jobsG.ok,firstIssueById:typeof phhFirstIssueNow==='function'?phhFirstIssueNow():null});
  // 1. read state notes (a stage that failed says so; it never reads as "none")
  const notes=phEl('div','phq-notes');
  if(_phqPos.truncated)notes.appendChild(phEl('p','phq-note phq-warn','Only the newest '+PHQ_POS_LIMIT+' POs were read; older ones are not on the board.'));
  if(!jobsG.ok)notes.appendChild(phEl('p','phq-note phq-warn','Cut plans (po_cut_jobs) are not loaded, so planned days and masters are not shown and plans cannot be changed. Use Retry in the banner above.'));
  if(!mastersG.ok)notes.appendChild(phEl('p','phq-note phq-warn','Cutting masters are not loaded, so a master cannot be picked.'));
  if(!settingsInfo.known)notes.appendChild(phEl('p','phq-note','Settings are not loaded: delay thresholds and capacity use the built-in defaults.'));
  if(notes.firstChild)body.appendChild(notes);
  // 2. the pipeline strip (all POs, before any filter)
  body.appendChild(_phqPipelineStrip(m,loading));
  // 3. filters
  body.appendChild(_phqFilters(m,ctx,mastersG,jobsG));
  // 4. the board
  const boardEl=phEl('div','phq-boardwrap');boardEl.id='phq-board';
  body.appendChild(boardEl);
  _phqBoardEl=boardEl;
  _phqPaintBoard(m,ctx,manage,jobsG.ok);
  body.appendChild(phEl('p','phq-foot','Cutting moves on when the cut is recorded on the cutting screen; the other stages are completed by their own queues. Force-advance is an owner override and asks first. Delay is judged for POs at cutting; age since "created" is shown but never counted as a delay.'));
}
function _phqPipelineStrip(m,loading){
  const p=m.pipeline;
  const strip=phEl('div','phq-strip');strip.setAttribute('role','group');strip.setAttribute('aria-label','Pipeline');
  const chip=function(cls,text,title){const c=phEl('span','ph-chip '+cls,text);if(title)c.setAttribute('title',title);return c;};
  if(p.state!=='ok'){strip.appendChild(chip('ph-chip-wait','No POs read'));return strip;}
  strip.appendChild(chip('ph-chip-wait','Afloat '+p.afloat.pos+' PO'+(p.afloat.pos===1?'':'s')+' · '+p.afloat.units.toLocaleString('en-US')+' pcs','Units afloat: the issued pieces of released POs still at cutting'));
  strip.appendChild(chip('ph-chip-wait','In production '+p.inProduction.pos+' · '+p.inProduction.units.toLocaleString('en-US')+' pcs','Released POs from cutting to final QC'));
  strip.appendChild(chip('ph-chip-wait','Reserved '+p.counts.reserved));
  strip.appendChild(chip('ph-chip-wait','Completed '+p.counts.completed));
  if(m.cancelled)strip.appendChild(chip('ph-chip-wait','Cancelled '+m.cancelled+' (hidden)'));
  if(p.unknown)strip.appendChild(chip('ph-chip-bad','Unrecognised stage '+p.unknown));
  if(p.noUnits)strip.appendChild(chip('ph-chip-wait',p.noUnits+' without a quantity'));
  if(loading)strip.appendChild(chip('ph-chip-wait','Refreshing…'));
  return strip;
}
function _phqSeasonOptions(m){
  const seen=Object.create(null),out=[];
  m.tiles.forEach(function(t){
    const k=t.season.key===null?'none':t.season.key;
    if(!seen[k]){seen[k]=true;out.push({key:k,label:t.season.label});}
  });
  out.sort(function(a,b){return a.label<b.label?-1:a.label>b.label?1:0;});
  return out;
}
function _phqMasterOptions(m,mastersG){
  const seen=Object.create(null),out=[];
  const add=function(name){const n=_phqStr(name).trim();if(!n)return;const k=phMasterKey(n);if(!seen[k]){seen[k]=true;out.push({key:k,label:n});}};
  if(mastersG.ok)mastersG.rows.forEach(function(r){add(r.name);});
  m.tiles.forEach(function(t){add(t.plan.masterName);});
  out.sort(function(a,b){return a.label<b.label?-1:a.label>b.label?1:0;});
  return out;
}
function _phqFilters(m,ctx,mastersG,jobsG){
  const bar=phEl('div','phq-filters');bar.setAttribute('role','search');bar.setAttribute('aria-label','Filter the board');
  const field=function(label,node){const f=phEl('label','phq-field');f.appendChild(phEl('span','phq-flabel',label));f.appendChild(node);return f;};
  const mkSel=function(cls,opts,cur,onchange){
    const s=phEl('select','phq-sel '+cls);
    opts.forEach(function(o){const op=phEl('option','',o.label);op.setAttribute('value',o.key);if(o.key===cur)op.setAttribute('selected','selected');s.appendChild(op);});
    s.value=cur;
    s.addEventListener('change',function(){onchange(s.value);});
    return s;
  };
  const sOpts=[{key:'',label:'All seasons'}].concat(_phqSeasonOptions(m));
  const seasonSel=mkSel('phq-f-season',sOpts,_phqF.season,function(v){_phqF.season=v;_phqRepaintBoard(ctx);});
  const mOpts=[{key:'',label:'All masters'},{key:'__none',label:jobsG.ok?'Unassigned':'Unassigned (plans not loaded)'}].concat(_phqMasterOptions(m,mastersG));
  const masterSel=mkSel('phq-f-master',mOpts,_phqF.master,function(v){_phqF.master=v;_phqRepaintBoard(ctx);});
  const q=phEl('input','phq-in phq-f-q');q.setAttribute('type','search');q.setAttribute('placeholder','Article code or name');q.setAttribute('aria-label','Search article code or name');
  q.value=_phqF.q;
  const onq=function(){_phqF.q=q.value;_phqRepaintBoard(ctx);};
  q.addEventListener('input',onq);
  const dl=phEl('label','phq-check');
  const cb=phEl('input','phq-f-delayed');cb.setAttribute('type','checkbox');if(_phqF.delayed){cb.setAttribute('checked','checked');cb.checked=true;}
  cb.addEventListener('change',function(){_phqF.delayed=!!cb.checked;_phqRepaintBoard(ctx);});
  dl.appendChild(cb);dl.appendChild(phEl('span','','Delayed only'));
  const refresh=_phqBtn('ph-btn phq-refresh','Refresh',function(){phqLoadPos(true).then(function(){ctx.repaint();});ctx.repaint();});
  const count=phEl('span','phq-count');count.id='phq-count';count.setAttribute('role','status');_phqCountEl=count;
  bar.appendChild(field('Season',seasonSel));bar.appendChild(field('Master',masterSel));bar.appendChild(field('Search',q));
  bar.appendChild(dl);bar.appendChild(refresh);bar.appendChild(count);
  return bar;
}
// A filter changed: repaint the board only (the inputs, and the caret in the search box, stay where they are).
function _phqRepaintBoard(ctx){
  if(!_phqBoardEl||_phqPos.rows===null)return;
  const settingsInfo=typeof phSettingsInfo==='function'?phSettingsInfo():{known:false,settings:{}};
  const jobsG=ctx.get('jobs');
  const m=phqModel(_phqPos.rows,jobsG.ok?jobsG.rows:null,{settings:settingsInfo.settings,jobsLoaded:jobsG.ok,firstIssueById:typeof phhFirstIssueNow==='function'?phhFirstIssueNow():null});
  _phqPaintBoard(m,ctx,phqCanPlan(ctx.user)&&ctx.canManage!==false,jobsG.ok);
}
function _phqPaintBoard(m,ctx,manage,jobsOk){
  const host=_phqBoardEl;if(!host)return;
  phClear(host);
  let shown=0,total=m.tiles.length;
  const filtered={};
  PHQ_LANES.concat(PHQ_SIDE_LANES).forEach(function(l){filtered[l.id]=phqFilterTiles(m.lanes[l.id],_phqF);shown+=filtered[l.id].length;});
  const cnt=_phqCountEl;
  if(cnt)cnt.textContent=(shown===total?total+' PO'+(total===1?'':'s'):shown+' of '+total+' POs');
  if(!total){host.appendChild(_phqCard('No POs',[phEl('p','ph-note','The POs were read and there are none (cancelled POs are not shown).')]));return;}
  const board=phEl('div','phq-board');board.setAttribute('role','list');board.setAttribute('aria-label','Released POs by stage');
  PHQ_LANES.forEach(function(l){board.appendChild(_phqLane(l,m.lanes[l.id],filtered[l.id],ctx,manage,jobsOk,m,false));});
  host.appendChild(board);
  const side=phEl('div','phq-side');
  PHQ_SIDE_LANES.forEach(function(l){
    if(l.id==='unknown'&&!m.lanes.unknown.length)return;
    side.appendChild(_phqLane(l,m.lanes[l.id],filtered[l.id],ctx,manage,jobsOk,m,true));
  });
  host.appendChild(side);
}
function _phqLane(l,all,list,ctx,manage,jobsOk,m,side){
  const lane=phEl('section','phq-lane'+(side?' phq-lane-side':''));lane.setAttribute('data-lane',l.id);lane.setAttribute('role','listitem');
  const open=side?_phqCollapsed[l.id]===false:_phqCollapsed[l.id]!==true;
  const count=list.length===all.length?String(all.length):list.length+' of '+all.length;
  const hb=_phqBtn('phq-lane-head',null,function(){_phqCollapsed[l.id]=open;_phqPaintBoard(m,ctx,manage,jobsOk);},{'aria-expanded':open?'true':'false'});
  hb.appendChild(phEl('span','phq-lane-name',l.label));
  hb.appendChild(phEl('span','phq-lane-count',count));
  lane.appendChild(hb);
  if(!open)return lane;
  const ul=phEl('ul','phq-tiles');
  if(!list.length){ul.appendChild(phEl('li','phq-empty',all.length?'No POs match the filters.':'Nothing here.'));}
  const cap=_phqShowAll[l.id]?list.length:PHQ_LANE_CAP;
  list.slice(0,cap).forEach(function(t){ul.appendChild(_phqTile(t,ctx,manage,jobsOk,m));});
  lane.appendChild(ul);
  if(list.length>cap){
    lane.appendChild(_phqBtn('ph-btn phq-more','Show '+(list.length-cap)+' more',function(){_phqShowAll[l.id]=true;_phqPaintBoard(m,ctx,manage,jobsOk);}));
  }
  return lane;
}
function _phqTile(t,ctx,manage,jobsOk,m){
  const li=phEl('li','phq-tile phq-lvl-'+(t.delay.level||'none'));
  li.setAttribute('data-po',t.id);li.setAttribute('data-lane',t.lane);
  const top=phEl('div','phq-t-top');
  top.appendChild(phEl('span','phq-po',t.po));
  const chips=phEl('span','phq-chips');
  if(t.afloat){const a=phEl('span','ph-chip phq-afloat','Afloat');a.setAttribute('title','Issued pieces not yet cut: units afloat');chips.appendChild(a);}
  const sc=phEl('span','ph-chip phq-season',(t.season.guess?'~ ':'')+t.season.label);
  sc.setAttribute('title',t.season.guess?'Guessed from the planned day, not stored on the PO':(t.season.key?'Season stored on the PO':'No season stored and no day to guess from'));
  chips.appendChild(sc);
  top.appendChild(chips);
  li.appendChild(top);
  const art=phEl('div','phq-t-art');
  art.appendChild(phEl('strong','phq-code',t.code||'(no article code)'));
  if(t.name)art.appendChild(phEl('span','phq-name',t.name));
  li.appendChild(art);
  const meta=phEl('div','phq-t-meta');
  meta.appendChild(phEl('span','phq-qty',t.units===null?'quantity unknown':t.units.toLocaleString('en-US')+' pcs'+(t.unitsBasis==='cut'?' (cut)':'')));
  let plan;
  if(t.lane==='cutting'||t.plan.exists){
    if(!jobsOk)plan='Plan: not loaded';
    else if(t.plan.day||t.plan.masterName)plan=[t.plan.day?'Cut '+_phqDayLabel(t.plan.day,m.today):'No cut day',t.plan.masterName||'no master'].join(' · ');
    else plan='Not planned';
    meta.appendChild(phEl('span','phq-plan',plan));
  }
  li.appendChild(meta);
  const badges=phEl('div','phq-t-badges');
  if(t.delay.text){const b=phEl('span','phq-badge phq-b-'+t.delay.level,t.delay.text);badges.appendChild(b);}
  if(t.age){const b=phEl('span','phq-badge phq-b-age',t.age.text);b.setAttribute('title',t.age.basis==='created'?'Days since the PO was created: there is no recorded fabric-issue date':(t.age.basis==='released'?'Days since the PO was released':(t.age.basis==='issued'?'Days since the fabric was issued':'Days since the previous stage finished')));badges.appendChild(b);}
  if(badges.firstChild)li.appendChild(badges);
  // actions
  const act=phEl('div','phq-t-act');
  if(phqCanOpen(ctx.user)){
    act.appendChild(_phqBtn('ph-btn phq-btn phq-open','Open',function(){phqOpenPO(t.fbKey);},{'aria-label':'Open '+t.po}));
  }
  const planWhy=manage&&t.lane==='cutting'&&jobsOk&&_phqPlannable(t.id)&&t.plan.exists?phqPlanProblem({status:t.plan.status},ctx.user):null;
  if(planWhy&&t.plan.status!=='done'){
    // locked for this person (an overridden plan, non-owner): say so instead of offering a button that would be refused
    const lk=phEl('span','phq-plan-locked','Plan locked');lk.setAttribute('title',planWhy);
    act.appendChild(lk);
  }else if(manage&&t.lane==='cutting'&&jobsOk&&_phqPlannable(t.id)&&t.plan.status!=='done'){
    act.appendChild(_phqBtn('ph-btn phq-btn phq-plan-btn',t.plan.exists?'Change plan':'Plan cut',function(ev){_phqOpenPlan(t,ctx,ev&&ev.currentTarget);},{'aria-label':'Plan the cut of '+t.po}));
  }
  if(manage&&phqCanAdvance()&&PHQ_LANES.some(function(l){return l.id===t.lane;})&&t.lane!=='cutting'){
    const i=PHQ_LANES.findIndex(function(l){return l.id===t.lane;});
    const nxt=i+1<PHQ_LANES.length?PHQ_LANES[i+1].label:'Completed';
    act.appendChild(_phqBtn('ph-btn phq-btn phq-adv','Force-advance → '+nxt,function(){phqAdvance(t.fbKey,ctx);},
      {'aria-label':'Force-advance '+t.po+' from '+_phqLaneLabel(t.lane)+' to '+nxt,'title':'Owner override: marks '+_phqLaneLabel(t.lane)+' done and moves the PO to '+nxt+'. Asks to confirm.'}));
  }
  if(act.firstChild)li.appendChild(act);
  return li;
}

/* ── open the PO (the existing detail page) ────────────────────────────── */
// openPODetail sets currentPage itself and does not go through showPage, so the takeover has to come
// down first or the PO page would paint inside a fixed Production Ops frame.
// The PO detail page is for the managers: openPODetail BYPASSES page scoping (it sets currentPage itself), so for Kashif
// (uzaib) the button is not drawn and this refuses him as well.
function phqCanOpen(u){
  return phqCanPlan(u)&&typeof window!=='undefined'&&!!window&&typeof window.openPODetail==='function';
}
function phqOpenPO(fbKey){
  if(!phqCanOpen())return false;
  _phqCloseDlg();
  try{if(typeof _phTkLeave==='function')_phTkLeave();}catch(e){}
  window.openPODetail(fbKey);
  return true;
}

/* ── PLAN: the one write of this file (js/ph-write.js phSaveCutJob) ────── */
function phqPlanInput(job,form){
  // form: {day:'' | 'YYYY-MM-DD', master:'' | '__keep' | 'CM-nnn', masters:[{fbKey,name}]}; returns only the keys that CHANGED
  const out={};
  const day=_phqStr(form.day).trim();
  const curDay=job&&job.plannedCutDate?job.plannedCutDate:'';
  if(day!==curDay){
    if(day&&!phIsDay(day))return{error:'The cut day must be a real day, YYYY-MM-DD.'};
    out.plannedCutDate=day||null;
  }
  const curId=job&&job.masterId?job.masterId:'';
  const sel=_phqStr(form.master);
  if(sel!=='__keep'&&sel!==curId){
    if(sel===''){out.masterId=null;out.masterName='';}
    else{
      const m=(form.masters||[]).filter(function(r){return r.fbKey===sel;})[0];
      if(!m)return{error:'That cutting master is not in the registry.'};
      out.masterId=sel;out.masterName=_phqStr(m.name);
    }
  }
  return{input:out,changed:Object.keys(out).length>0};
}
function _phqOpenPlan(t,ctx,opener){
  if(!phqCanPlan(ctx.user))return;
  _phqCloseDlg();
  const jobsG=ctx.get('jobs');
  if(!jobsG.ok)return;
  const job=jobsG.rows.filter(function(r){return r.fbKey===t.id;})[0]||null;
  const lockWhy=phqPlanProblem(job,ctx.user);
  if(lockWhy){if(typeof showToast==='function')showToast(lockWhy,true);return;}   // refused before the dialog, let alone the writer
  const mastersG=ctx.get('masters');
  const masters=mastersG.ok?mastersG.rows.filter(function(r){return r.active!==false;}).sort(function(a,b){return a.fbKey<b.fbKey?-1:a.fbKey>b.fbKey?1:0;}):[];
  const ov=phEl('div','phq-ov');
  const dlg=phEl('div','phq-dlg');dlg.setAttribute('role','dialog');dlg.setAttribute('aria-modal','true');dlg.setAttribute('aria-labelledby','phq-dlg-title');
  const title=phEl('h3','phq-dlg-title','Plan the cut · '+t.po);title.id='phq-dlg-title';
  dlg.appendChild(title);
  dlg.appendChild(phEl('p','phq-dlg-sub',[t.code,t.name].filter(Boolean).join(' · ')+(t.units!==null?' · '+t.units.toLocaleString('en-US')+' pcs':'')));
  const dayIn=phEl('input','phq-in phq-d-day');dayIn.setAttribute('type','date');dayIn.value=job&&job.plannedCutDate?job.plannedCutDate:'';
  const dayF=phEl('label','phq-field phq-field-block');dayF.appendChild(phEl('span','phq-flabel','Planned cut day (leave empty for none)'));dayF.appendChild(dayIn);
  dlg.appendChild(dayF);
  const sel=phEl('select','phq-sel phq-d-master');
  const opt=function(v,label,selected){const o=phEl('option','',label);o.setAttribute('value',v);if(selected)o.setAttribute('selected','selected');sel.appendChild(o);};
  const curId=job&&job.masterId?_phqStr(job.masterId):'';
  const curName=job?_phqStr(job.masterName).trim():'';
  const inReg=curId&&masters.some(function(r){return r.fbKey===curId;});
  opt('','— No master —',!curId&&!curName);
  if((curId||curName)&&!inReg)opt('__keep',(curName||curId)+' (current, not in the active list)',true);
  masters.forEach(function(r){opt(r.fbKey,_phqStr(r.name),r.fbKey===curId);});
  sel.value=(curId||curName)&&!inReg?'__keep':curId;
  const mF=phEl('label','phq-field phq-field-block');mF.appendChild(phEl('span','phq-flabel','Cutting master'));mF.appendChild(sel);
  if(!mastersG.ok){sel.setAttribute('disabled','disabled');mF.appendChild(phEl('span','phq-hint','Cutting masters could not be read, so the master cannot be changed now.'));}
  dlg.appendChild(mF);
  const msg=phEl('p','phq-dlg-msg');msg.setAttribute('role','alert');dlg.appendChild(msg);
  const foot=phEl('div','phq-dlg-foot');
  let busy=false;
  const save=_phqBtn('ph-btn ph-btn-primary phq-d-save','Save plan',async function(){
    if(busy)return;
    const r=phqPlanInput(job,{day:dayIn.value,master:sel.value,masters:masters});
    if(r.error){msg.textContent=r.error;return;}
    if(!r.changed){msg.textContent='Nothing changed.';return;}
    busy=true;save.setAttribute('disabled','disabled');msg.textContent='Saving…';
    const res=await phqSavePlan(t.id,r.input,job);
    busy=false;
    if(res&&res.ok){
      _phqCloseDlg();
      if(typeof showToast==='function')showToast('Plan saved for '+t.po+' ✓');
      ctx.repaint();
      return;
    }
    save.removeAttribute('disabled');
    msg.textContent=(res&&res.error)||'Could not save the plan.';
    if(res&&res.code==='stale'){
      // someone else changed it: re-read the plans so the tile shows theirs; the person reopens the dialog to see them
      if(typeof phLoadStage==='function')phLoadStage('jobs',{force:true}).then(function(){ctx.repaint();});
      msg.textContent+=' The plans were re-read: close this and open it again.';
    }
  });
  const cancel=_phqBtn('ph-btn phq-d-cancel','Cancel',function(){_phqCloseDlg();});
  foot.appendChild(cancel);foot.appendChild(save);dlg.appendChild(foot);
  ov.appendChild(dlg);
  ov.addEventListener('click',function(e){if(e.target===ov)_phqCloseDlg();});
  document.body.appendChild(ov);
  _phqDlg={node:ov,opener:opener||null};
  if(typeof phAddEscapeGuard==='function')phAddEscapeGuard(_phqEscape);
  try{dayIn.focus();}catch(e){}
}
function _phqEscape(){if(_phqDlg){_phqCloseDlg();return true;}return false;}
function _phqCloseDlg(){
  const d=_phqDlg;_phqDlg=null;
  if(!d)return;
  try{if(d.node.parentNode)d.node.parentNode.removeChild(d.node);}catch(e){}
  try{if(d.opener&&typeof d.opener.focus==='function')d.opener.focus();}catch(e){}
}
// Can this job's plan be changed by this person? null = yes (or no job yet: Plan creates one), else the reason.
// Reuses ph-write.js's phJobMoveProblem on the open -> open style step (status -> the same status): an 'overridden' job is an
// OWNER's, a 'done' job is never changed again, an unknown status has no step.
function phqPlanProblem(job,u){
  if(!job||typeof job!=='object'||!job.status)return null;
  if(typeof phJobMoveProblem!=='function')return null;   // the writer (and its own check) is not loaded: phqSavePlan refuses first
  const st=_phqStr(job.status);
  const p=phJobMoveProblem(st,st,_phqUser(u));
  return p?(st==='overridden'?'This plan is overridden - only an owner (Afnan or Ammar) can change it.':p):null;
}
// The freshest loaded copy of a PO's cut job (the data layer's rows), or null.
function _phqLiveJob(poId){
  try{
    if(typeof phGet!=='function')return null;
    const g=phGet('jobs');
    if(!g||!g.ok||!Array.isArray(g.rows))return null;
    return g.rows.filter(function(r){return r&&r.fbKey===poId;})[0]||null;
  }catch(e){return null;}
}
// The only function in this file that writes. Gated again here (the button is not the boundary).
async function phqSavePlan(poId,input,job){
  if(!phqCanPlan())return{ok:false,code:'forbidden',error:'Planning is for the Production Ops managers (Afnan, Ammar, Mustafa).'};
  if(typeof phSaveCutJob!=='function')return{ok:false,code:'failed',error:'The Production Ops writers did not load - refresh the page.'};
  if(!_phqPlannable(poId))return{ok:false,code:'invalid',error:'Not a PO id: '+poId};
  // PRE-CHECK against the job as it is NOW (the freshest loaded copy, else the one the dialog opened on): an overridden job
  // for a non-owner, a done job, a status with no step. Said here, before the writer is called (the writer and the rules agree).
  const live=_phqLiveJob(poId)||job;
  const why=phqPlanProblem(live,_phqUser());
  if(why)return{ok:false,code:'forbidden',error:why};
  const opts={};
  const cd=typeof phCutJobChangeData==='function'?phCutJobChangeData(live,input):null;   // structured from/to for the history row
  if(cd)opts.data=cd;
  if(job&&typeof job.rev==='number')opts.expectedRev=job.rev;
  try{return await phSaveCutJob(poId,input,opts);}
  catch(e){return{ok:false,code:'failed',error:'Could not save the plan ('+(e&&e.message||e)+').'};}
}

/* ── ADVANCE: delegated, never written here ────────────────────────────── */
// Calls the EXISTING guarded window.ownerAdvance(fbKey, stage) (js/pos.js): it asks its own confirm, checks its own
// role, and runs a transaction that judges poForceAdvancePlan again on the live document. This function only
// (1) refuses early for anyone who may not, and for cutting; (2) holds off ownerAdvance's trailing renderDetailPage(),
// which would paint a PO page over this tab or navigate to the registry; (3) re-reads the POs afterwards.
function _phqAppHas(fbKey){return typeof allPOs!=='undefined'&&Array.isArray(allPOs)&&allPOs.some(function(p){return p&&p.fbKey===fbKey;});}
async function phqAdvance(fbKey,ctx){
  if(!phqCanAdvance())return{ok:false,code:'forbidden',error:'Only owners and Mustafa can force a PO forward.'};
  if(_phqAdvBusy)return{ok:false,code:'busy',error:'Another move is still running.'};
  const rows=_phqPos.rows||[];
  const po=rows.filter(function(p){return _phqIdOf(p)===fbKey;})[0];
  if(!po)return{ok:false,code:'missing',error:'That PO is not on the board - refresh and try again.'};
  const stage=_phqStr(po.currentStage);
  const plan=poForceAdvancePlan(po,stage);
  if(!plan.ok){if(typeof showToast==='function')showToast(plan.msg,true);return{ok:false,code:'refused',error:plan.msg};}
  _phqAdvBusy=true;
  // ownerAdvance looks the PO up in the app's own list (allPOs) and returns silently when it is not there: make sure it is.
  if(!_phqAppHas(fbKey)){
    if(typeof loadData==='function'){try{await loadData();}catch(e){}}
    if(!_phqAppHas(fbKey)){
      _phqAdvBusy=false;
      const msg=fbKey+' is not in the app\'s loaded PO list yet - reload the page and try again.';
      if(typeof showToast==='function')showToast(msg,true);
      return{ok:false,code:'missing',error:msg};
    }
  }
  // globalThis, not window: ownerAdvance calls renderDetailPage by its bare (global) name, and in a browser the two are one object
  const prev=globalThis.renderDetailPage;
  globalThis.renderDetailPage=function(){};
  try{
    await window.ownerAdvance(fbKey,stage);
  }catch(e){
    if(typeof showToast==='function')showToast('Could not advance: '+(e&&e.message||e),true);
  }finally{
    if(prev===undefined)delete globalThis.renderDetailPage;else globalThis.renderDetailPage=prev;
    _phqAdvBusy=false;
  }
  _phqPos.stale=true;
  await phqLoadPos(true);
  if(ctx&&typeof ctx.repaint==='function'&&_phqIsHere())ctx.repaint();
  // whether it moved is the live document's answer (ownerAdvance may have been declined at its confirm or refused on the live stage)
  const now=(_phqPos.rows||[]).filter(function(p){return _phqIdOf(p)===fbKey;})[0];
  return{ok:true,code:'delegated',moved:!!now&&_phqStr(now.currentStage)!==stage};
}

/* ── registration ──────────────────────────────────────────────────────── */
// The tab is visible to the whole Production Ops audience: managers get the board, Kashif (uzaib) gets Drafts
// and the read-only board. The render adapts to the username; the shell still checks the audience first.
if(typeof phRegisterTab==='function'){
  phRegisterTab('queue',{render:phqRender,roles:function(u){return typeof phCanSee==='function'&&phCanSee(u)===true;}});
}
(function(){   // a dialog never outlives the page: any route out of Production Ops closes it
  if(typeof window==='undefined'||!window)return;
  if(typeof window.showPage==='function'&&!window.showPage.__phq){
    const o=window.showPage;
    const w=function(){const r=o.apply(this,arguments);try{if(typeof currentPage==='undefined'||currentPage!=='prod-ops')_phqCloseDlg();}catch(e){}return r;};
    w.__phq=true;
    if(o.__phTk)w.__phTk=true;
    window.showPage=w;
  }
})();

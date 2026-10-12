/* ─────────────────────────────────────────────────────────────────────────
   Production Ops — the CALENDAR tab (12 Oct 2026).  File js/ph-mod-calendar.js.

   Registered with phRegisterTab('calendar', ...) from js/ph-ui.js. It draws each PO's planned cut date
   (po_cut_jobs.plannedCutDate) on a month or week calendar (weeks start Monday, days are PKT), the load of
   every day against the daily capacity, the POs that are released but have no planned date (the tray), and
   today's planned jobs. A chip or a tray item is moved to another day by DRAG or by the "Move to..." menu.

   WRITES: only phSaveCutJob(poId,{plannedCutDate}) from js/ph-write.js -- ONE transaction that writes
   po_cut_jobs/{poId} and the pos/{poId}/history row. Never the `pos` document. This file calls no other
   Firestore function (a test scans the source for that).

   The decisions are PURE functions (phcPlanMove, phcCheckDay, phcLockReason, phcBuildModel, phcRange) so
   the screen and the tests read one rule. The load per day is the sum of the planned pieces of the jobs
   planned for that day (over capacity = more than the daily capacity); js/ph-core.js phAllocate is then run
   over the same jobs (earliest day = the planned day) to say where an over-full day SPILLS to and by how
   many working days (delayDays) / calendar days (delayCalendarDays).

   Drag, the Board / Mood Boards lessons applied: the pointer is tracked on the DOCUMENT from pointerdown;
   nothing is captured until the pointer has moved 4px (an eager capture retargets the click that follows to
   the capturing element); a drag arms a click suppressor so the click that ends it does not open the menu;
   the drop day comes from ONE function (_phcDayFromPoint) so a test can replace it; touch input never drags
   (a tap opens the "Move to..." menu: a 4px threshold is not a gesture a thumb can land); Escape cancels.

   Rules held: loaders never reject (the shell's data load); a collection that failed to read is NAMED and the
   calendar is not drawn (never an empty grid); PKT days only (never toISOString().slice(0,10)); stored text
   only ever reaches the page through textContent; every global is ph/_ph/PH_ prefixed and unique.
   ───────────────────────────────────────────────────────────────────────── */

const PH_CAL_MON=Object.freeze(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']);
const PH_CAL_MONTH_FULL=Object.freeze(['January','February','March','April','May','June','July','August','September','October','November','December']);
const PH_CAL_WD=Object.freeze(['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);                  // index = phWeekday (0 = Sunday)
const PH_CAL_WD_FULL=Object.freeze(['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']);
const PH_CAL_GRID_WD=Object.freeze(['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);             // the grid's column heads
const PH_CAL_DRAG_PX=4;
const PH_CAL_MONTH_CHIPS=3;           // chips drawn in a month cell before "+N more"
const PH_CAL_TRAY_MAX=40;             // tray items drawn (the count says the rest)
const PH_CAL_PHONE_QUERY='(max-width:640px)';
const _PHC_PO_RE=/^PO-[0-9]{3,}$/;

/* ── pure: days, labels, ranges ────────────────────────────────────────── */
function phcDayLabel(day,withWd){
  if(!phIsDay(day))return String(day==null?'':day);
  return(withWd?PH_CAL_WD[phWeekday(day)]+' ':'')+(+day.slice(8,10))+' '+PH_CAL_MON[+day.slice(5,7)-1];
}
function phcMonthLabel(day){return phIsDay(day)?PH_CAL_MONTH_FULL[+day.slice(5,7)-1]+' '+day.slice(0,4):'';}
// first day of the month n months from the month of `day`
function phcMonthAdd(day,n){
  const t=(+day.slice(0,4))*12+(+day.slice(5,7)-1)+n;
  return Math.floor(t/12)+'-'+_phPad(t%12+1,2)+'-01';
}
// {from, days:[YYYY-MM-DD...], month:'YYYY-MM'|null, label}. A month view is whole Monday-start weeks.
function phcRange(view,anchor){
  const a=phIsDay(anchor)?anchor:null;
  if(a===null)return{from:null,days:[],month:null,label:''};
  let from,n,month=null,label;
  if(view==='week'){
    from=phWeekStart(a);n=7;
    const to=phDayAdd(from,6);
    label=phcDayLabel(from)+' - '+phcDayLabel(to)+' '+to.slice(0,4);
  }else{
    const first=a.slice(0,8)+'01';
    const last=phDayAdd(phcMonthAdd(first,1),-1);
    from=phWeekStart(first);n=phDaysBetween(from,phWeekStart(last))+7;
    month=a.slice(0,7);label=phcMonthLabel(a);
  }
  const days=[];for(let i=0;i<n;i++)days.push(phDayAdd(from,i));
  return{from:from,days:days,month:month,label:label};
}

/* ── pure: what may happen to a job ────────────────────────────────────── */
// Why a job's date is fixed, or null. The database rules refuse a change to a 'done' job; 'overridden' and
// "already cut" are refused by this screen only (the rules do not look at them).
function phcLockReason(job,po){
  if(job&&job.status==='done')return'Done: the cut is recorded, so its date is fixed.';
  if(job&&job.status==='overridden')return'Overridden by an owner: its date is fixed here.';
  if(po){
    const st=phStageOf(po);
    if(st&&st!=='cutting'&&st!=='reserved'&&st!=='cancelled'&&st!=='unknown')return'Already cut (the PO is at '+(st==='completed'?'completed':st)+'): its cut date is no longer planned here.';
  }
  return null;
}
// May this day take a planned cut? {ok, why}. S = resolved settings (js/ph-core.js phSettings).
function phcCheckDay(day,S,today){
  if(!phIsDay(day))return{ok:false,why:'Pick a real date (YYYY-MM-DD).'};
  const wd=phWeekday(day);
  if(S&&Array.isArray(S.skipDays)&&S.skipDays.indexOf(day)>-1)return{ok:false,why:phcDayLabel(day,true)+' is a skip day (no work): nothing can be planned on it.'};
  if(S&&Array.isArray(S.offWeekdays)&&S.offWeekdays.indexOf(wd)>-1)return{ok:false,why:phcDayLabel(day,true)+' is a weekly off day ('+PH_CAL_WD_FULL[wd]+'s are not worked): nothing can be planned on it.'};
  if(phIsDay(today)&&day<today)return{ok:false,why:phcDayLabel(day,true)+' is before today ('+phcDayLabel(today,true)+'): a cut cannot be planned in the past.'};
  return{ok:true,why:null};
}
// The ONE decision for "plan or move this PO to this day". inp: {canManage, jobsOk, settings:{known,failed,settings},
// job (the loaded cut job or null), po (the loaded PO or null), poId, to, today}.
// -> {ok:false, why, same?} | {ok:true, from, to, create, rev}
function phcPlanMove(inp){
  const i=inp||{};
  if(!i.canManage)return{ok:false,why:'View only: only the Production Ops managers can plan cutting.'};
  if(!i.jobsOk)return{ok:false,why:'The cutting jobs could not be read, so nothing can be planned safely. Retry the load first.'};
  const si=i.settings||{};
  if(!si.known||si.failed)return{ok:false,why:'The Production Ops settings could not be read, so skip days and capacity are unknown: planning is off until they load.'};
  if(!_PHC_PO_RE.test(String(i.poId)))return{ok:false,why:'Not a PO id: '+i.poId+'.'};
  const job=i.job||null,po=i.po||null;
  const lock=phcLockReason(job,po);
  if(lock)return{ok:false,why:lock};
  if(!job){
    if(!po)return{ok:false,why:i.poId+' is not loaded on this device, so it cannot be planned from here. Reload the POs and try again.'};
    const st=phStageOf(po);
    if(st!=='cutting')return{ok:false,why:i.poId+' is '+(st==='reserved'?'reserved (not released)':'at stage '+st)+': only a released PO that is waiting to be cut can be planned.'};
  }
  if(!phIsDay(i.to))return{ok:false,why:'Pick a real date (YYYY-MM-DD).'};
  if(job&&job.plannedCutDate===i.to)return{ok:false,same:true,why:i.poId+' is already planned for '+phcDayLabel(i.to,true)+'.'};
  const d=phcCheckDay(i.to,si.settings,i.today);
  if(!d.ok)return{ok:false,why:d.why};
  return{ok:true,from:job&&phIsDay(job.plannedCutDate)?job.plannedCutDate:null,to:i.to,create:!job,rev:job&&typeof job.rev==='number'?job.rev:undefined};
}

/* ── pure: the model the screen draws ──────────────────────────────────── */
function phcPoIndex(pos){
  const m=Object.create(null);
  (Array.isArray(pos)?pos:[]).forEach(function(p){
    if(!p||typeof p!=='object')return;
    const k=typeof p.fbKey==='string'&&p.fbKey?p.fbKey:(typeof p.id==='string'?p.id:'');
    if(k&&!m[k])m[k]=p;
  });
  return m;
}
function phcUnitsOf(po){
  if(!po)return null;
  const u=phPoUnits(po).units;
  return typeof u==='number'&&u>0?u:null;
}
// inp: {jobs (rows of po_cut_jobs, each with fbKey), pos (allPOs), S (resolved settings), capKnown, today}
function phcBuildModel(inp){
  const S=inp.S,today=inp.today,capKnown=inp.capKnown!==false;
  const idx=phcPoIndex(inp.pos);
  const out={chips:[],byDay:Object.create(null),jobByPo:Object.create(null),tray:[],todayChips:[],cancelled:0,alloc:null,capKnown:capKnown,posKnown:Array.isArray(inp.pos)&&inp.pos.length>0};
  const items=[];let minDay=null;
  (Array.isArray(inp.jobs)?inp.jobs:[]).forEach(function(j){
    if(!j||typeof j.fbKey!=='string')return;
    out.jobByPo[j.fbKey]=j;
    const day=phIsDay(j.plannedCutDate)?j.plannedCutDate:null;
    if(day===null)return;
    const po=idx[j.fbKey]||null;
    if(po&&phStageOf(po)==='cancelled'){out.cancelled++;return;}
    const units=phcUnitsOf(po);
    const chip={poId:j.fbKey,job:j,po:po,day:day,units:units,lock:phcLockReason(j,po),master:typeof j.masterName==='string'?j.masterName:'',
      article:po?String(po.name||po.code||''):'',code:po?String(po.code||''):'',status:j.status||'open',alloc:null,spill:null,workday:phcIsWork(day,S)};
    out.chips.push(chip);
    (out.byDay[day]=out.byDay[day]||[]).push(chip);
    if(units!==null){items.push({id:j.fbKey,qty:units,earliestDay:day,requestedDay:day});if(minDay===null||day<minDay)minDay=day;}
  });
  Object.keys(out.byDay).forEach(function(d){out.byDay[d].sort(function(a,b){return a.poId<b.poId?-1:a.poId>b.poId?1:0;});});
  // where an over-full day spills to (phAllocate): earliest day = the planned day, in planned-day order
  if(capKnown&&items.length){
    const start=minDay!==null&&phIsDay(today)&&today<minDay?today:(minDay||today);
    try{out.alloc=phAllocate(items,{startDay:start,dailyCapacity:S.dailyCapacity,offWeekdays:S.offWeekdays,skipDays:S.skipDays});}catch(e){out.alloc=null;}
    if(out.alloc&&out.alloc.ok){
      out.chips.forEach(function(c){
        const r=out.alloc.byId[c.poId];if(!r)return;
        c.alloc={finishDay:r.finishDay,startDay:r.startDay,delayDays:r.delayDays,delayCalendarDays:r.delayCalendarDays};
        if(r.finishDay&&r.finishDay>c.day){
          c.spill=c.workday
            ?'Over capacity: finishes '+phcDayLabel(r.finishDay,true)+(r.delayDays>0?' (+'+r.delayDays+' working day'+(r.delayDays===1?'':'s')+')':'')
            :'On a non-working day: allocated to '+phcDayLabel(r.startDay,true)+(r.finishDay!==r.startDay?' to '+phcDayLabel(r.finishDay,true):'');
        }
      });
    }
  }
  // released POs still at cutting with no planned date (reserved POs are never listed)
  (Array.isArray(inp.pos)?inp.pos:[]).forEach(function(p){
    if(!p||typeof p!=='object')return;
    const id=typeof p.fbKey==='string'&&p.fbKey?p.fbKey:(typeof p.id==='string'?p.id:'');
    if(!_PHC_PO_RE.test(id)||phStageOf(p)!=='cutting')return;
    const j=out.jobByPo[id]||null;
    if(j&&phIsDay(j.plannedCutDate))return;
    if(j&&j.status==='done')return;
    out.tray.push({poId:id,po:p,job:j,units:phcUnitsOf(p),article:String(p.name||p.code||''),lock:phcLockReason(j,p),requested:phIsDay(p.requestedDate)?p.requestedDate:(phIsDay(p.requestedDay)?p.requestedDay:null)});
  });
  out.tray.sort(function(a,b){return a.poId<b.poId?-1:a.poId>b.poId?1:0;});
  out.todayChips=(out.byDay[today]||[]).slice();
  return out;
}
function phcIsWork(day,S){
  if(!S)return true;
  if(Array.isArray(S.skipDays)&&S.skipDays.indexOf(day)>-1)return false;
  if(Array.isArray(S.offWeekdays)&&S.offWeekdays.indexOf(phWeekday(day))>-1)return false;
  return true;
}
// One day as the screen draws it.
function phcDayInfo(model,S,day){
  const chips=model.byDay[day]||[];
  let planned=0,unknown=0;
  chips.forEach(function(c){if(c.units===null)unknown++;else planned+=c.units;});
  const cap=model.capKnown?S.dailyCapacity:null;
  const wd=phWeekday(day);
  const skip=Array.isArray(S.skipDays)&&S.skipDays.indexOf(day)>-1;
  const off=Array.isArray(S.offWeekdays)&&S.offWeekdays.indexOf(wd)>-1;
  return{day:day,chips:chips,planned:planned,unknown:unknown,cap:cap,over:cap!==null&&planned>cap,overBy:cap!==null&&planned>cap?planned-cap:0,
    work:!skip&&!off,why:skip?'Skip day':(off?'Off ('+PH_CAL_WD_FULL[wd]+')':null)};
}

/* ── state ─────────────────────────────────────────────────────────────── */
let _phcView='month',_phcAnchor=null,_phcMsg=null,_phcBusy=false,_phcDrag=null,_phcDialog=null,_phcCtx=null,_phcLast=null;
let _phcJustDragged=false,_phcCells={},_phcChipEls={},_phcFocusPo='',_phcMsgEl=null,_phcEscWired=false;

function _phcToday(){return phDay(Date.now());}
function _phcIsPhone(){try{return typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia(PH_CAL_PHONE_QUERY).matches===true;}catch(e){return false;}}
function _phcPosList(){return typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:null;}
function _phcRepaint(){try{if(_phcCtx&&typeof _phcCtx.repaint==='function')_phcCtx.repaint();}catch(e){}}
function _phcSay(kind,text){
  _phcMsg=text?{kind:kind,text:text}:null;
  if(_phcMsgEl){_phcMsgEl.className='phc-msg'+(_phcMsg?' '+_phcMsg.kind:'');_phcMsgEl.textContent=_phcMsg?_phcMsgGlyph(_phcMsg.kind)+_phcMsg.text:'';}
}
function _phcMsgGlyph(kind){return kind==='ok'?'✓ ':kind==='bad'?'✕ ':kind==='wait'?'… ':'';}

// The plan for a PO on a day, from the data as loaded now.
function _phcPlanFor(poId,day){
  const ctx=_phcCtx;
  const jg=ctx&&typeof ctx.get==='function'?ctx.get('jobs'):{ok:false,rows:null};
  const job=jg.ok?(jg.rows.filter(function(r){return r.fbKey===poId;})[0]||null):null;
  return phcPlanMove({canManage:!!(ctx&&ctx.canManage),jobsOk:!!jg.ok,settings:phSettingsInfo(),job:job,po:phcPoIndex(_phcPosList())[poId]||null,poId:poId,to:day,today:_phcToday()});
}
function _phcWarnLoad(poId,day){
  if(!_phcLast||!_phcLast.capKnown)return'';
  const S=phSettingsNow();
  const info=phcDayInfo(_phcLast,S,day);
  const po=phcPoIndex(_phcPosList())[poId]||null;
  const u=phcUnitsOf(po)||0;
  const already=info.chips.some(function(c){return c.poId===poId;});
  const after=info.planned+(already?0:u);
  return after>S.dailyCapacity?' '+phcDayLabel(day,true)+' is now over capacity ('+after+' of '+S.dailyCapacity+'): the excess spills to the next working day.':'';
}

/* ── the write ─────────────────────────────────────────────────────────── */
// Plan or move a PO to a day. Never throws; resolves {ok:true,...} or {ok:false,why|error}. The ONLY write on this tab.
async function _phcApply(poId,day){
  const plan=_phcPlanFor(poId,day);
  if(!plan.ok){_phcSay(plan.same?'info':'bad',plan.why);_phcRepaint();return plan;}
  if(_phcBusy)return{ok:false,why:'Another save is still in progress.'};
  if(typeof phSaveCutJob!=='function'){_phcSay('bad','The Production Ops write layer did not load - refresh the page.');_phcRepaint();return{ok:false,why:'no writer'};}
  const warn=_phcWarnLoad(poId,day);
  _phcBusy=true;_phcFocusPo=poId;
  _phcSay('wait','Saving '+poId+'...');
  let r;
  try{
    const o={reason:('Calendar: planned cut date '+(plan.from||'none')+' -> '+plan.to).slice(0,500)};
    if(plan.rev!==undefined)o.expectedRev=plan.rev;
    r=await phSaveCutJob(poId,{plannedCutDate:plan.to},o);
  }catch(e){r={ok:false,code:'failed',error:'Could not save ('+String(e&&e.message||e)+').'};}
  _phcBusy=false;
  if(r&&r.ok){
    _phcSay('ok',poId+(plan.create?' planned for ':' moved to ')+phcDayLabel(plan.to,true)+(plan.from?' (was '+phcDayLabel(plan.from,true)+')':'')+'.'+warn);
    _phcDialog=null;
    _phcRepaint();
    return{ok:true,plan:plan,result:r};
  }
  const text=(r&&r.error)||'Could not save.';
  _phcSay('bad',text);
  if(_phcDialog)_phcDialog.error=text;
  if(r&&r.code==='stale'&&_phcCtx&&typeof _phcCtx.reload==='function'){try{_phcCtx.reload();}catch(e){}return{ok:false,error:text,code:'stale'};}
  _phcRepaint();
  return{ok:false,error:text,code:r&&r.code};
}

/* ── drag ──────────────────────────────────────────────────────────────── */
// The ONE place a pointer position becomes a day (tests replace this). Walks up from the element under the point.
function _phcDayFromPoint(x,y){
  if(typeof document==='undefined'||typeof document.elementFromPoint!=='function')return null;
  let n=null;
  try{n=document.elementFromPoint(x,y);}catch(e){return null;}
  for(;n;n=n.parentNode){
    const d=n.getAttribute?n.getAttribute('data-phc-day'):null;
    if(d&&phIsDay(d))return d;
  }
  return null;
}
function _phcDragLabel(d){
  const m=_phcLast,c=m&&m.chips.filter(function(x){return x.poId===d.poId;})[0],t=m&&m.tray.filter(function(x){return x.poId===d.poId;})[0];
  const u=c?c.units:(t?t.units:null);
  return d.poId+(u!==null&&u!==undefined?' · '+u+' pcs':'');
}
function _phcDown(e,el,poId,kind){
  const ctx=_phcCtx;
  if(!ctx||!ctx.canManage||_phcBusy||_phcDrag||_phcDialog)return;
  if(e.button!==undefined&&e.button!==0)return;
  if(e.pointerType==='touch')return;                       // a tap opens the menu; a thumb cannot land a 4px threshold
  _phcDrag={poId:poId,kind:kind,id:e.pointerId,x0:e.clientX,y0:e.clientY,started:false,over:null,el:el,ghost:null};
  document.addEventListener('pointermove',_phcMove);
  document.addEventListener('pointerup',_phcUp);
  document.addEventListener('pointercancel',_phcCancel);
}
function _phcClearHover(){
  const d=_phcDrag;if(!d||!d.over)return;
  const cell=_phcCells[d.over];
  if(cell){cell.classList.remove('drop-ok');cell.classList.remove('drop-bad');}
  d.over=null;
}
function _phcMove(e){
  const d=_phcDrag;if(!d||e.pointerId!==d.id)return;
  if(e.buttons===0){_phcEnd(false);return;}                // the release was lost off the window: end, never keep a ghost
  if(!d.started){
    if(Math.hypot(e.clientX-d.x0,e.clientY-d.y0)<PH_CAL_DRAG_PX)return;
    d.started=true;
    try{if(d.el&&typeof d.el.setPointerCapture==='function'&&d.id!==undefined)d.el.setPointerCapture(d.id);}catch(x){}   // captured LATE, past the threshold
    try{document.body.classList.add('phc-dragging');}catch(x){}
    if(d.el)d.el.classList.add('dragging');
    const g=phEl('div','phc-ghost',_phcDragLabel(d));
    g.setAttribute('aria-hidden','true');
    d.ghost=g;try{document.body.appendChild(g);}catch(x){}
  }
  if(d.ghost){d.ghost.style.left=(e.clientX+12)+'px';d.ghost.style.top=(e.clientY+12)+'px';}
  const day=_phcDayFromPoint(e.clientX,e.clientY);
  if(day!==d.over){
    _phcClearHover();
    if(day){
      const plan=_phcPlanFor(d.poId,day);
      d.over=day;
      const cell=_phcCells[day];
      if(cell)cell.classList.add(plan.ok||plan.same?'drop-ok':'drop-bad');
      if(!plan.ok&&!plan.same)_phcSay('bad',plan.why);else _phcSay('info',plan.same?plan.why:'Drop to '+(plan.create?'plan ':'move ')+d.poId+' on '+phcDayLabel(day,true)+'.');
    }else _phcSay('info','');
  }
}
function _phcEnd(drop,e){
  const d=_phcDrag;if(!d)return null;
  _phcDrag=null;
  document.removeEventListener('pointermove',_phcMove);
  document.removeEventListener('pointerup',_phcUp);
  document.removeEventListener('pointercancel',_phcCancel);
  let day=null;
  if(d.started){
    if(drop&&e)day=_phcDayFromPoint(e.clientX,e.clientY);
    const cell=d.over?_phcCells[d.over]:null;
    if(cell){cell.classList.remove('drop-ok');cell.classList.remove('drop-bad');}
    if(d.ghost&&d.ghost.parentNode)d.ghost.parentNode.removeChild(d.ghost);
    if(d.el)d.el.classList.remove('dragging');
    try{document.body.classList.remove('phc-dragging');}catch(x){}
    try{if(d.el&&typeof d.el.releasePointerCapture==='function'&&d.id!==undefined)d.el.releasePointerCapture(d.id);}catch(x){}
    _phcJustDragged=true;setTimeout(function(){_phcJustDragged=false;},0);     // the click that ends a drag opens nothing
  }
  return{drag:d,day:day};
}
function _phcUp(e){
  const d=_phcDrag;if(!d||e.pointerId!==d.id)return;
  const r=_phcEnd(true,e);
  if(!r||!r.drag.started)return;                           // never moved past the threshold: it is a click
  if(r.day)_phcApply(r.drag.poId,r.day);
  else{_phcSay('info','Dropped outside the calendar: nothing changed.');}
}
function _phcCancel(e){
  const d=_phcDrag;if(!d||(e&&e.pointerId!==d.id))return;
  _phcEnd(false);_phcSay('info','Move cancelled.');
}
// Escape cancels a drag or closes the dialog before the shell's own Escape (leaving the page) sees it.
function _phcEscape(){
  if(_phcDrag&&_phcDrag.started){_phcEnd(false);_phcSay('info','Move cancelled.');return true;}
  if(_phcDialog){_phcCloseDialog();return true;}
  return false;
}

/* ── the "Move to..." / "Plan..." dialog (the keyboard and phone route) ─── */
function _phcOpenDialog(poId,mode){
  const ctx=_phcCtx;if(!ctx)return;
  _phcFocusPo=poId;
  const jg=ctx.get('jobs'),job=jg.ok?(jg.rows.filter(function(r){return r.fbKey===poId;})[0]||null):null;
  const po=phcPoIndex(_phcPosList())[poId]||null;
  const lock=phcLockReason(job,po);
  if(!ctx.canManage){_phcSay('info','View only: only the Production Ops managers can plan cutting.');_phcRepaint();return;}
  if(lock){_phcSay('bad',poId+': '+lock);_phcRepaint();return;}
  let value=job&&phIsDay(job.plannedCutDate)?job.plannedCutDate:null;
  if(!value){const n=phWorkdayNext(_phcToday(),phSettingsNow());value=n||_phcToday();}
  _phcDialog={poId:poId,mode:mode,value:value,error:null,focused:false};
  _phcMsg=null;
  _phcRepaint();
}
function _phcCloseDialog(){
  const d=_phcDialog;_phcDialog=null;
  if(d)_phcFocusPo=d.poId;
  _phcRepaint();
}
async function _phcConfirm(){
  const d=_phcDialog;if(!d||_phcBusy)return;
  const plan=_phcPlanFor(d.poId,d.value);
  if(!plan.ok){d.error=plan.why;_phcRepaint();return;}
  d.error=null;
  await _phcApply(d.poId,d.value);
}
function _phcDialogEl(){
  const d=_phcDialog,m=_phcLast;
  const chip=m&&m.chips.filter(function(c){return c.poId===d.poId;})[0],tray=m&&m.tray.filter(function(c){return c.poId===d.poId;})[0];
  const po=(chip&&chip.po)||(tray&&tray.po)||null;
  const back=phEl('div','phc-dialog-back');
  const box=phEl('div','phc-dialog');
  box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby','phc-dlg-title');
  const title=phEl('h3','phc-dlg-title',(d.mode==='plan'?'Plan ':'Move ')+d.poId);title.id='phc-dlg-title';
  box.appendChild(title);
  const bits=[];
  if(po&&(po.name||po.code))bits.push(String(po.name||po.code));
  const u=chip?chip.units:(tray?tray.units:null);
  bits.push(u!=null?u+' pcs':'quantity not known');
  if(chip&&chip.day)bits.push('planned '+phcDayLabel(chip.day,true));
  if(chip&&chip.master)bits.push('master '+chip.master);
  box.appendChild(phEl('p','phc-dlg-sum',bits.join(' · ')));
  const lab=phEl('label','phc-dlg-lab',d.mode==='plan'?'Plan for':'Move to');lab.setAttribute('for','phc-dlg-date');
  const inp=phEl('input','phc-dlg-date');inp.id='phc-dlg-date';inp.setAttribute('type','date');inp.value=d.value||'';
  const today=_phcToday();if(today)inp.setAttribute('min',today);
  box.appendChild(lab);box.appendChild(inp);
  const hint=phEl('div','phc-hint');hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');
  const paintHint=function(){
    const plan=_phcPlanFor(d.poId,d.value);
    const txt=d.error||(plan.ok?'Will be '+(plan.create?'planned for ':'moved to ')+phcDayLabel(d.value,true)+'.'+_phcWarnLoad(d.poId,d.value):plan.why);
    hint.textContent=(plan.ok&&!d.error?'':'✕ ')+txt;
    hint.className='phc-hint'+(plan.ok&&!d.error?' ok':' bad');
  };
  paintHint();
  const onVal=function(){d.value=inp.value;d.error=null;paintHint();};
  inp.addEventListener('input',onVal);inp.addEventListener('change',onVal);
  box.appendChild(hint);
  const acts=phEl('div','phc-dlg-acts');
  const go=_phcBtn('phc-btn phc-btn-primary',d.mode==='plan'?'Plan':'Move',function(){_phcConfirm();});
  go.id='phc-dlg-go';
  if(_phcBusy){go.setAttribute('aria-disabled','true');go.textContent='Saving...';}
  acts.appendChild(go);
  acts.appendChild(_phcBtn('phc-btn','Cancel',function(){_phcCloseDialog();}));
  box.appendChild(acts);
  box.addEventListener('keydown',function(e){
    if(e.key==='Escape'){if(e.preventDefault)e.preventDefault();_phcCloseDialog();}
    else if(e.key==='Enter'&&e.target===inp){if(e.preventDefault)e.preventDefault();_phcConfirm();}
  });
  back.appendChild(box);
  back.addEventListener('click',function(e){if(e.target===back)_phcCloseDialog();});
  d.inputEl=inp;
  return back;
}

/* ── drawing ───────────────────────────────────────────────────────────── */
function _phcBtn(cls,text,onclick,attrs){
  const b=phEl('button',cls,text);b.setAttribute('type','button');
  if(attrs)Object.keys(attrs).forEach(function(k){b.setAttribute(k,attrs[k]);});
  if(onclick)b.addEventListener('click',onclick);
  return b;
}
function _phcChipEl(c,isTray){
  const ctx=_phcCtx,canDrag=!!(ctx&&ctx.canManage)&&!c.lock;
  const b=phEl('button','phc-chip'+(isTray?' tray':'')+(c.lock?' locked':'')+(c.spill?' spill':'')+(!isTray&&c.workday===false?' nonwork':'')+(canDrag?' draggable':''));
  b.setAttribute('type','button');b.setAttribute('data-phc-po',c.poId);
  const art=c.article||(c.po?'':'(PO not loaded)');
  const row1=phEl('span','phc-chip-top',null,[phEl('span','phc-chip-po',c.poId),phEl('span','phc-chip-qty',c.units!==null&&c.units!==undefined?c.units+' pcs':'qty ?')]);
  b.appendChild(row1);
  b.appendChild(phEl('span','phc-chip-art',art));
  if(!isTray)b.appendChild(phEl('span','phc-chip-mst',c.master||'No master'));
  const tags=phEl('span','phc-tags');
  if(c.lock)tags.appendChild(phEl('span','phc-tag lock','Locked'));
  if(c.spill)tags.appendChild(phEl('span','phc-tag warn','▲ Spills'));
  if(!isTray&&c.workday===false)tags.appendChild(phEl('span','phc-tag warn','Non-working day'));
  if(isTray&&c.requested)tags.appendChild(phEl('span','phc-tag','Wanted '+phcDayLabel(c.requested)));
  if(tags.firstChild)b.appendChild(tags);
  const full=c.poId+', '+(c.article||'article not loaded')+', '+(c.units!==null&&c.units!==undefined?c.units+' pieces':'quantity not known')+(isTray?', not planned yet':(c.master?', master '+c.master:', no master')+', planned '+phcDayLabel(c.day,true))+(c.lock?'. '+c.lock:'')+(c.spill?'. '+c.spill:'');
  b.setAttribute('aria-label',full+(canDrag?'. Press Enter for the Move menu.':''));
  b.setAttribute('title',full);
  if(c.lock)b.setAttribute('aria-disabled','true');
  b.addEventListener('pointerdown',function(e){if(canDrag)_phcDown(e,b,c.poId,isTray?'tray':'chip');});
  b.addEventListener('click',function(){
    if(_phcJustDragged)return;
    _phcFocusPo=c.poId;
    if(c.lock){_phcSay('bad',c.poId+': '+c.lock);_phcRepaint();return;}
    _phcOpenDialog(c.poId,isTray?'plan':'move');
  });
  _phcChipEls[c.poId+(isTray?'#t':'')]=b;
  return b;
}
function _phcLoadEl(info){
  const w=phEl('div','phc-load'+(info.over?' over':''));
  if(info.cap===null){
    w.appendChild(phEl('span','phc-load-txt',info.planned+' pcs planned (capacity unknown)'));
  }else{
    const pct=info.cap>0?Math.min(100,Math.round(info.planned/info.cap*100)):0;
    w.appendChild(phEl('span','phc-load-txt',info.planned+' / '+info.cap+' pcs'));
    const bar=phEl('span','phc-load-bar');bar.setAttribute('aria-hidden','true');
    const fill=phEl('i','phc-load-fill');fill.style.width=pct+'%';bar.appendChild(fill);w.appendChild(bar);
    if(info.over)w.appendChild(phEl('span','phc-over','▲ Over capacity by '+info.overBy));
  }
  if(info.unknown)w.appendChild(phEl('span','phc-load-unk',info.unknown+(info.unknown===1?' job':' jobs')+' with quantity not known'));
  return w;
}
function _phcCellEl(model,S,day,range,view,today){
  const info=phcDayInfo(model,S,day);
  const cell=phEl('div','phc-cell'+(day===today?' today':'')+(view==='month'&&range.month&&day.slice(0,7)!==range.month?' out':'')+(info.work?'':' off')+(info.over?' over':''));
  cell.setAttribute('data-phc-day',day);cell.setAttribute('role','group');
  cell.setAttribute('aria-label',phcDayLabel(day,true)+(day===today?', today':'')+(info.why?', '+info.why:'')+', '+info.planned+' pieces planned'+(info.cap!==null?' of '+info.cap:'')+(info.over?', over capacity by '+info.overBy:''));
  const head=phEl('div','phc-cell-head');
  head.appendChild(phEl('span','phc-date',phcDayLabel(day,view==='week')));
  if(day===today)head.appendChild(phEl('span','phc-today','Today'));
  if(info.why)head.appendChild(phEl('span','phc-off','— '+info.why));
  cell.appendChild(head);
  if(info.chips.length||info.planned)cell.appendChild(_phcLoadEl(info));
  const list=phEl('div','phc-chips');
  const lim=view==='month'?PH_CAL_MONTH_CHIPS:info.chips.length;
  info.chips.slice(0,lim).forEach(function(c){list.appendChild(_phcChipEl(c,false));});
  if(info.chips.length>lim){
    const more=_phcBtn('phc-more','+'+(info.chips.length-lim)+' more',function(){_phcView='week';_phcAnchor=day;_phcRepaint();});
    more.setAttribute('aria-label',(info.chips.length-lim)+' more jobs on '+phcDayLabel(day,true)+': open the week');
    list.appendChild(more);
  }
  cell.appendChild(list);
  _phcCells[day]=cell;
  return cell;
}
function _phcNav(dir){
  const today=_phcToday();
  const a=_phcAnchor||today;
  if(dir==='today')_phcAnchor=today;
  else if(_phcView==='week'||_phcIsPhone())_phcAnchor=phDayAdd(a,dir==='next'?7:-7);
  else _phcAnchor=phcMonthAdd(a,dir==='next'?1:-1);
  _phcRepaint();
}
function _phcTodayCard(model,today){
  const card=phEl('section','ph-card phc-card');
  card.appendChild(phEl('h3','ph-card-title','Today in cutting · '+phcDayLabel(today,true)));
  const ul=phEl('ul','phc-today-list');
  if(!model.todayChips.length)ul.appendChild(phEl('li','phc-empty','Nothing is planned for today.'));
  model.todayChips.forEach(function(c){
    ul.appendChild(phEl('li','phc-today-row',null,[
      phEl('span','phc-chip-po',c.poId),
      phEl('span','phc-today-art',(c.article||'(PO not loaded)')+' · '+(c.units!==null?c.units+' pcs':'qty ?')+' · '+(c.master||'no master')+' · '+c.status)
    ]));
  });
  card.appendChild(ul);
  if(typeof phGoTab==='function')card.appendChild(_phcBtn('phc-btn','Open Today\'s Cutting →',function(){phGoTab('cutting');}));
  return card;
}
function _phcTrayCard(model,posList){
  const card=phEl('section','ph-card phc-card');
  card.appendChild(phEl('h3','ph-card-title','Not planned yet ('+(posList&&posList.length?model.tray.length:'?')+')'));
  if(!posList||!posList.length){
    card.appendChild(phEl('p','phc-empty','No POs are loaded on this device, so this list cannot be built. It is not "nothing to plan".'));
    if(typeof loadData==='function')card.appendChild(_phcBtn('phc-btn','Reload POs',function(){try{loadData();}catch(e){}}));
    return card;
  }
  card.appendChild(phEl('p','phc-sub','Released POs still waiting to be cut, with no planned date. Reserved POs are not listed. Drag one onto a day, or press it to choose a date.'));
  if(!model.tray.length)card.appendChild(phEl('p','phc-empty','Every released PO waiting to be cut has a planned date.'));
  const list=phEl('div','phc-tray');
  model.tray.slice(0,PH_CAL_TRAY_MAX).forEach(function(t){list.appendChild(_phcChipEl(t,true));});
  card.appendChild(list);
  if(model.tray.length>PH_CAL_TRAY_MAX)card.appendChild(phEl('p','phc-sub','and '+(model.tray.length-PH_CAL_TRAY_MAX)+' more (the first '+PH_CAL_TRAY_MAX+' are shown).'));
  return card;
}

function phcRender(host,ctx){
  _phcCtx=ctx;_phcCells={};_phcChipEls={};_phcMsgEl=null;
  const wrap=phEl('div','phc-wrap');host.appendChild(wrap);
  const head=phEl('header','ph-head');
  const hrow=phEl('div','ph-head-row',null,[phEl('h2','ph-title','Calendar')]);
  if(!ctx.canManage)hrow.appendChild(phEl('span','ph-chip ph-chip-view','View only'));
  head.appendChild(hrow);
  head.appendChild(phEl('p','ph-blurb','Planned cut dates by day against the daily capacity and the skip days. Drag a PO onto a day, or press it for the Move menu.'));
  wrap.appendChild(head);
  const jg=ctx.get('jobs');
  if(!jg||!jg.ok){
    const c=phEl('section','ph-card ph-card-err');c.setAttribute('role','alert');
    c.appendChild(phEl('h3','ph-card-title','The calendar cannot be drawn'));
    c.appendChild(phEl('p','ph-note',(jg&&jg.text)||'po_cut_jobs could not be read.'));
    c.appendChild(phEl('p','ph-note','An empty calendar would look like "nothing is planned", so nothing is drawn until the cutting jobs are read. Nothing can be planned meanwhile.'));
    c.appendChild(_phcBtn('phc-btn phc-btn-primary','Retry',function(){ctx.reload();}));
    wrap.appendChild(c);
    return;
  }
  const info=phSettingsInfo();
  const S=info.settings,capKnown=info.known&&!info.failed;
  const today=_phcToday();
  const phone=_phcIsPhone();
  const view=phone?'week':_phcView;
  if(!_phcAnchor)_phcAnchor=today;
  const pos=_phcPosList();
  const model=phcBuildModel({jobs:jg.rows,pos:pos||[],S:S,capKnown:capKnown,today:today});
  _phcLast=model;
  if(!capKnown){
    const w=phEl('section','ph-card ph-card-err');w.setAttribute('role','alert');
    w.appendChild(phEl('h3','ph-card-title','Capacity and skip days unknown'));
    w.appendChild(phEl('p','ph-note',(phGet('settings').text||'ph_settings could not be read.')+' Jobs are shown, but their load is not compared with a capacity and planning is off until the settings are read.'));
    w.appendChild(_phcBtn('phc-btn phc-btn-primary','Retry',function(){ctx.reload();}));
    wrap.appendChild(w);
  }
  if(jg.truncated)wrap.appendChild(phEl('p','phc-sub','The list of cutting jobs was cut at its limit, so the oldest jobs may be missing.'));
  if(model.cancelled)wrap.appendChild(phEl('p','phc-sub',model.cancelled+(model.cancelled===1?' planned job belongs':' planned jobs belong')+' to cancelled POs and '+(model.cancelled===1?'is':'are')+' not shown.'));
  const msg=phEl('div','phc-msg'+(_phcMsg?' '+_phcMsg.kind:''),_phcMsg?_phcMsgGlyph(_phcMsg.kind)+_phcMsg.text:'');
  msg.setAttribute('role','status');msg.setAttribute('aria-live','polite');
  _phcMsgEl=msg;wrap.appendChild(msg);
  const top=phEl('div','phc-top');top.appendChild(_phcTodayCard(model,today));top.appendChild(_phcTrayCard(model,pos));wrap.appendChild(top);
  const range=phcRange(view,_phcAnchor);
  const bar=phEl('div','phc-toolbar');
  const nav=phEl('div','phc-nav');
  nav.appendChild(_phcBtn('phc-btn phc-nav-btn','‹',function(){_phcNav('prev');},{'aria-label':view==='week'?'Previous week':'Previous month'}));
  nav.appendChild(_phcBtn('phc-btn','Today',function(){_phcNav('today');}));
  nav.appendChild(_phcBtn('phc-btn phc-nav-btn','›',function(){_phcNav('next');},{'aria-label':view==='week'?'Next week':'Next month'}));
  bar.appendChild(nav);
  bar.appendChild(phEl('h3','phc-range',range.label));
  if(!phone){
    const tog=phEl('div','phc-toggle');tog.setAttribute('role','group');tog.setAttribute('aria-label','Calendar view');
    ['month','week'].forEach(function(v){
      tog.appendChild(_phcBtn('phc-btn'+(view===v?' on':''),v==='month'?'Month':'Week',function(){_phcView=v;_phcRepaint();},{'aria-pressed':view===v?'true':'false'}));
    });
    bar.appendChild(tog);
  }
  wrap.appendChild(bar);
  const grid=phEl('div','phc-grid '+view);
  grid.setAttribute('role','group');grid.setAttribute('aria-label','Planned cuts, '+range.label);
  const wds=phEl('div','phc-wds');wds.setAttribute('aria-hidden','true');
  PH_CAL_GRID_WD.forEach(function(w){wds.appendChild(phEl('span','phc-wd',w));});
  grid.appendChild(wds);
  const cells=phEl('div','phc-cells');
  range.days.forEach(function(d){cells.appendChild(_phcCellEl(model,S,d,range,view,today));});
  grid.appendChild(cells);
  wrap.appendChild(grid);
  if(_phcDialog)wrap.appendChild(_phcDialogEl());
  // focus: the dialog's date field when it opens, else back on the chip that was just used
  try{
    if(_phcDialog&&_phcDialog.inputEl&&!_phcDialog.focused){_phcDialog.focused=true;_phcDialog.inputEl.focus();}
    else if(_phcFocusPo&&!_phcDialog){const el=_phcChipEls[_phcFocusPo]||_phcChipEls[_phcFocusPo+'#t'];if(el&&typeof el.focus==='function')el.focus();}
  }catch(e){}
}

/* ── registration ──────────────────────────────────────────────────────── */
(function(){
  if(typeof phRegisterTab==='function')phRegisterTab('calendar',{render:phcRender});
  if(typeof phAddEscapeGuard==='function'&&!_phcEscWired){_phcEscWired=true;phAddEscapeGuard(_phcEscape);}
})();

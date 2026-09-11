/* Groovy Operations — activity.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */

async function loadActivity(){
  const m=document.getElementById('main-content');
  m.innerHTML='<div class="page-head"><div class="page-title">Activity Log</div></div><div class="empty">Loading…</div>';
  try{
    const snap=await getDocs(query(collection(db,'activity'),orderBy('ts','desc'),limit(150)));
    const items=snap.docs.map(d=>d.data());
    m.innerHTML=`<div class="page-head"><div class="page-title">Activity Log</div><div class="page-sub">${items.length} recent actions</div></div>
    <div class="card">${items.length?items.map(a=>`<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #f5f5f5">
      <div style="width:28px;height:28px;border-radius:50%;background:var(--dark);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">${(a.user||'?')[0].toUpperCase()}</div>
      <div style="flex:1"><div style="font-size:13px"><strong>${a.user||'?'}</strong> <span style="color:var(--muted)">— ${a.action||''}</span></div>
        <div style="font-size:11px;color:var(--muted)">${a.detail||''}</div>
        <div style="font-size:10px;color:#aaa;margin-top:1px">${a.ts?new Date(a.ts).toLocaleString('en-GB'):a.date||''}</div>
      </div></div>`).join(''):'<div class="empty">No activity yet.</div>'}
    </div><div style="height:80px"></div>`;
  }catch(e){m.innerHTML=`<div class="empty">Error: ${e.message}</div>`;}
}

// ── Monitor (owner-only): activity grouped by person ──
// Built alongside Sept 2026's expanded permissions for Mustafa (loan
// create/pause/resume, payslip override/mark-paid, fabric delete/edit/
// correct). Same `activity` collection loadActivity() already reads — this
// just groups it per person and flags Mustafa's use of those specific new
// powers with a red marker, so an owner can scan for it at a glance instead
// of reading the whole flat log. Flagging is scoped to Mustafa specifically,
// not every owner-level action by everyone — the point is watching new
// power, not re-litigating what owners already always could do.
const _MONITOR_WATCH_ACTIONS=new Set([
  'Fabric In deleted','Fabric In edited','Fabric roll deleted','Fabric roll edited',
  'Fabric corrected','Fabric issue deleted','Fabric issue edited','Fabric issues cleared',
  'Loan created','Loan paused','Loan resumed',
  'Payslip override','Payslip paid'
]);
const _MONITOR_WATCH_USER='Mustafa';
const _MONITOR_PER_PERSON_CAP=15;

async function loadMonitor(){
  const m=document.getElementById('main-content');
  if(!session||session.role!=='owner'){m.innerHTML='<div class="empty">Owners only.</div>';return;}
  m.innerHTML='<div class="page-head"><div class="page-title">Monitor</div></div><div class="empty">Loading…</div>';
  try{
    const snap=await getDocs(query(collection(db,'activity'),orderBy('ts','desc'),limit(400)));
    const items=snap.docs.map(d=>d.data());
    const byUser=new Map();
    for(const a of items){
      const key=a.user||'Unknown';
      if(!byUser.has(key))byUser.set(key,[]);
      byUser.get(key).push(a);
    }
    const groups=[...byUser.entries()].sort((x,y)=>(y[1][0]?.ts||0)-(x[1][0]?.ts||0));
    const watchedCount=items.filter(a=>a.user===_MONITOR_WATCH_USER&&_MONITOR_WATCH_ACTIONS.has(a.action)).length;
    m.innerHTML=`<div class="page-head"><div class="page-title">Monitor</div><div class="page-sub">${items.length} recent actions across ${groups.length} accounts${watchedCount?` · <span style="color:#dc2626;font-weight:700">${watchedCount} watched action${watchedCount===1?'':'s'} from ${_MONITOR_WATCH_USER}</span>`:''}</div></div>
    ${groups.length?groups.map(([user,actions])=>{
      const shown=actions.slice(0,_MONITOR_PER_PERSON_CAP);
      const extra=actions.length-shown.length;
      return `<div class="card" style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--dark);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0">${(user||'?')[0].toUpperCase()}</div>
          <div style="flex:1"><div style="font-weight:700;font-size:14px">${user}</div><div style="font-size:11px;color:var(--muted)">${actions.length} action${actions.length===1?'':'s'} in this window</div></div>
        </div>
        ${shown.map(a=>{
          const flagged=user===_MONITOR_WATCH_USER&&_MONITOR_WATCH_ACTIONS.has(a.action);
          return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid #f5f5f5;${flagged?'border-left:3px solid #dc2626;padding-left:8px;background:#fef2f2':''}">
            <div style="flex:1">
              <div style="font-size:13px">${flagged?'<span style="color:#dc2626;font-weight:700">⚠ </span>':''}<span style="color:var(--muted)">${a.action||''}</span></div>
              <div style="font-size:11px;color:var(--muted)">${a.detail||''}</div>
              <div style="font-size:10px;color:#aaa;margin-top:1px">${a.ts?new Date(a.ts).toLocaleString('en-GB'):a.date||''}</div>
            </div>
          </div>`;
        }).join('')}
        ${extra>0?`<div style="font-size:11px;color:var(--muted);padding-top:8px">+${extra} more not shown</div>`:''}
      </div>`;
    }).join(''):'<div class="empty">No activity yet.</div>'}
    <div style="height:80px"></div>`;
  }catch(e){m.innerHTML=`<div class="empty">Error: ${e.message}</div>`;}
}

// ── Users page ──

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

// ── Monitor (owner-only): summary dashboard + per-person drill-down ──
// Built alongside Sept 2026's expanded permissions for Mustafa (loan
// create/pause/resume, payslip override/mark-paid, fabric delete/edit/
// correct). Reads the same `activity` collection loadActivity() reads.
//
// Two views, both driven off the same fetched+filtered item set:
//   Overview   — stat tiles, a pinned "watched activity" panel, and every
//                person as a clickable summary card grouped by role tier
//                (owners → managers → everyone else).
//   Drilldown  — one person's full log (still respecting the active date
//                filter), grouped by action category, logins collapsed to
//                one line, every other entry collapsed to one line with
//                click-to-expand for the detail/timestamp.
//
// Design decisions from the Sept 2026 planning round (Afnan): logins
// collapse rather than list one-per-block; summary-first with drill-down;
// watched items get their own pinned panel, not just an inline marker;
// date range incl. a custom calendar range; search is mandatory; people
// sort by role tier; entries group by category within a person; entries
// collapse-by-default with click-to-expand; categories get a colour/icon
// so the page scans visually; a compact version lives on the Dashboard.

// Category buckets. Order matters — money/approval is checked before edit
// so "Edit request approved/rejected" lands with the other approvals, not
// with edits (see js/activity.js comment in loadMonitor for the node
// script that validated this against every real logActivity() string).
const _MONITOR_CATEGORIES=[
  {key:'auth',   label:'Sign-in',        color:'#6b7280', icon:'🔑', match:a=>/^Login$/.test(a)||/^Password/.test(a)},
  {key:'delete', label:'Delete',         color:'#dc2626', icon:'🗑️', match:a=>/delet|remov|cleared|cleanup/i.test(a)},
  {key:'money',  label:'Approve / Money',color:'#059669', icon:'💰', match:a=>/approv|rejected|paid|processed|^Loan |^Advance |withhold|billing/i.test(a)},
  {key:'edit',   label:'Edit',           color:'#d97706', icon:'✎',  match:a=>/edit|correct|override|renamed|dedup|overwritten|reconstructed|policy chang/i.test(a)},
  {key:'create', label:'Create',         color:'#2563eb', icon:'➕', match:a=>/^Fabric In$|created|issued|added|submitted|reserved|restocked|reported|import|recorded/i.test(a)},
  {key:'other',  label:'Process',        color:'#7c3aed', icon:'⚙️', match:()=>true}
];
function _monitorCategorize(action){
  for(const c of _MONITOR_CATEGORIES){ if(c.key!=='other'&&c.match(action||'')) return c; }
  return _MONITOR_CATEGORIES[_MONITOR_CATEGORIES.length-1];
}

// Rows matching this action set, from this specific person, get the red
// ⚠ marker — his Sept 2026 grants. Scoped to him and these actions only;
// not a blanket flag on every owner-level action by anyone. If another
// grant like this happens later, add its logActivity() string(s) here and
// widen _MONITOR_WATCH_USER to an array if watching more than one person.
const _MONITOR_WATCH_ACTIONS=new Set([
  'Fabric In deleted','Fabric In edited','Fabric roll deleted','Fabric roll edited',
  'Fabric corrected','Fabric issue deleted','Fabric issue edited','Fabric issues cleared',
  'Loan created','Loan paused','Loan resumed',
  'Payslip override','Payslip paid'
]);
const _MONITOR_WATCH_USER='Mustafa';
const _MONITOR_FETCH_LIMIT=1000; // single orderBy('ts','desc') query, no composite index needed
const _MONITOR_WATCHED_PANEL_CAP=8;

let _monitorItems=[];       // raw fetch, ts desc, {..., _id}
let _monitorLoaded=false;
let _monitorFilter={preset:'today',from:'',to:''};
let _monitorSearch='';
let _monitorPerson=null;    // display name (activity doc's `user` field), or null = overview
let _monitorExpanded=new Set();      // expanded entry _ids, drilldown
let _monitorAuthExpanded=false;      // login block expanded, drilldown (reset per person)

async function loadMonitor(){
  const m=document.getElementById('main-content');
  if(!session||session.role!=='owner'){m.innerHTML='<div class="empty">Owners only.</div>';return;}
  m.innerHTML='<div class="page-head"><div class="page-title">Monitor</div></div><div class="empty">Loading…</div>';
  try{
    const snap=await getDocs(query(collection(db,'activity'),orderBy('ts','desc'),limit(_MONITOR_FETCH_LIMIT)));
    _monitorItems=snap.docs.map(d=>({...d.data(),_id:d.id}));
    _monitorLoaded=true;
    _monitorFilter={preset:'today',from:'',to:''};
    _monitorSearch='';
    _monitorPerson=null;
    _monitorExpanded=new Set();
    _monitorAuthExpanded=false;
    _renderMonitorPage();
  }catch(e){m.innerHTML=`<div class="empty">Error: ${e.message}</div>`;}
}

function _monitorRangeMs(){
  const f=_monitorFilter,now=Date.now();
  if(f.preset==='today'){const d=new Date();d.setHours(0,0,0,0);return[d.getTime(),now];}
  if(f.preset==='week')return[now-7*86400000,now];
  if(f.preset==='month'){const d=new Date();d.setDate(1);d.setHours(0,0,0,0);return[d.getTime(),now];}
  if(f.preset==='custom'){
    const from=f.from?new Date(f.from+'T00:00:00').getTime():0;
    const to=f.to?new Date(f.to+'T23:59:59').getTime():now;
    return[from,to];
  }
  return[0,now]; // 'all'
}
function _monitorRangeItems(){
  const[from,to]=_monitorRangeMs();
  return _monitorItems.filter(a=>a.ts>=from&&a.ts<=to);
}
function _monitorRoleTier(name){
  const u=(typeof USER_DEFS!=='undefined'?USER_DEFS:[]).find(x=>x.name===name);
  if(!u)return 2;
  if(u.role==='owner')return 0;
  if(u.role==='manager')return 1;
  return 2;
}
const _MONITOR_TIER_LABELS=['Owners','Managers','Everyone else'];
function _monitorAvatar(name,size){
  size=size||32;
  return`<div style="width:${size}px;height:${size}px;border-radius:50%;background:var(--dark);display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.38)}px;font-weight:700;color:#fff;flex-shrink:0">${(name||'?')[0].toUpperCase()}</div>`;
}
function _monitorFmtTime(a){ return a.ts?new Date(a.ts).toLocaleString('en-GB'):a.date||''; }
function _monitorEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function _renderMonitorPage(){
  const m=document.getElementById('main-content');
  if(!m)return;
  if(!_monitorLoaded){m.innerHTML='<div class="empty">Loading…</div>';return;}
  const rangeItems=_monitorRangeItems();
  const oldestFetched=_monitorItems.length?_monitorItems[_monitorItems.length-1].ts:Date.now();
  const[rangeFrom]=_monitorRangeMs();
  const mayBeIncomplete=_monitorItems.length>=_MONITOR_FETCH_LIMIT&&rangeFrom<oldestFetched;
  const filterBar=_monitorFilterBarHTML(mayBeIncomplete);
  m.innerHTML=`<div class="page-head"><div class="page-title">Monitor</div><div class="page-sub">Who's doing what, grouped by person</div></div>
    ${filterBar}
    ${_monitorPerson?_monitorDrilldownHTML(rangeItems):_monitorOverviewHTML(rangeItems)}
    <div style="height:80px"></div>`;
}

function _monitorFilterBarHTML(mayBeIncomplete){
  const f=_monitorFilter;
  const btn=(preset,label)=>`<button onclick="window.monitorSetPreset('${preset}')" style="padding:7px 13px;border:1px solid ${f.preset===preset?'var(--dark)':'var(--border)'};border-radius:8px;background:${f.preset===preset?'var(--dark)':'#fff'};color:${f.preset===preset?'#fff':'var(--text)'};font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">${label}</button>`;
  return`<div class="card" style="margin-bottom:14px">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:${f.preset==='custom'?'10px':'0'}">
      ${btn('today','Today')}${btn('week','This Week')}${btn('month','This Month')}${btn('all','All Time')}${btn('custom','Custom ▾')}
    </div>
    ${f.preset==='custom'?`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <label style="font-size:11px;color:var(--muted)">From <input type="date" id="mon-from" value="${f.from}" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;margin-left:4px"></label>
      <label style="font-size:11px;color:var(--muted)">To <input type="date" id="mon-to" value="${f.to}" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;margin-left:4px"></label>
      <button class="btn-primary" style="width:auto;padding:7px 14px;margin-top:0;font-size:12px" onclick="window.monitorApplyCustom()">Apply</button>
    </div>`:''}
    ${mayBeIncomplete?`<div style="font-size:11px;color:var(--muted);margin-top:8px">Showing the most recent ${_MONITOR_FETCH_LIMIT} platform-wide actions (back to ${new Date((_monitorItems[_monitorItems.length-1]||{}).ts||Date.now()).toLocaleDateString('en-GB')}). Older activity in this range is not included.</div>`:''}
  </div>`;
}

function _monitorOverviewHTML(rangeItems){
  const q=_monitorSearch.trim().toLowerCase();
  const byUser=new Map();
  for(const a of rangeItems){
    const key=a.user||'Unknown';
    if(!byUser.has(key))byUser.set(key,[]);
    byUser.get(key).push(a);
  }
  const watchedItems=rangeItems.filter(a=>a.user===_MONITOR_WATCH_USER&&_MONITOR_WATCH_ACTIONS.has(a.action));
  const activePeople=byUser.size;

  const statsHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <div class="card" style="flex:1;min-width:120px;text-align:center;padding:14px 10px">
      <div style="font-size:22px;font-weight:800">${rangeItems.length}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">Actions in range</div>
    </div>
    <div class="card" style="flex:1;min-width:120px;text-align:center;padding:14px 10px">
      <div style="font-size:22px;font-weight:800">${activePeople}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">Active accounts</div>
    </div>
    <div class="card" style="flex:1;min-width:120px;text-align:center;padding:14px 10px;${watchedItems.length?'border:1px solid #fca5a5;background:#fef2f2':''}">
      <div style="font-size:22px;font-weight:800;color:${watchedItems.length?'#dc2626':'inherit'}">${watchedItems.length}</div>
      <div style="font-size:11px;color:${watchedItems.length?'#dc2626':'var(--muted)'};margin-top:2px;font-weight:${watchedItems.length?'700':'400'}">Watched (${_MONITOR_WATCH_USER})</div>
    </div>
  </div>`;

  const watchedPanel=watchedItems.length?`<div class="card" style="margin-bottom:14px;border:1px solid #fca5a5;background:#fef2f2">
    <div style="font-weight:700;font-size:13px;color:#dc2626;margin-bottom:8px">⚠ Recent watched activity — ${_MONITOR_WATCH_USER}</div>
    ${watchedItems.slice(0,_MONITOR_WATCHED_PANEL_CAP).map(a=>{
      const cat=_monitorCategorize(a.action);
      return`<div style="cursor:pointer;padding:7px 0;border-bottom:1px solid #fecaca" onclick="window.monitorOpenPerson('${_monitorEsc(_MONITOR_WATCH_USER)}')">
        <div style="font-size:12px">${cat.icon} <strong>${_monitorEsc(a.action||'')}</strong></div>
        <div style="font-size:11px;color:var(--muted)">${_monitorEsc(a.detail||'')}</div>
        <div style="font-size:10px;color:#aaa;margin-top:1px">${_monitorFmtTime(a)}</div>
      </div>`;
    }).join('')}
    ${watchedItems.length>_MONITOR_WATCHED_PANEL_CAP?`<div style="font-size:11px;color:var(--muted);padding-top:6px">+${watchedItems.length-_MONITOR_WATCHED_PANEL_CAP} more — open ${_MONITOR_WATCH_USER}'s profile to see all</div>`:''}
  </div>`:'';

  const searchHTML=`<div style="margin-bottom:14px"><input id="mon-search" value="${_monitorEsc(_monitorSearch)}" placeholder="Search people…" oninput="window.monitorSearchInput(this.value)" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;outline:none"></div>`;

  let people=[...byUser.entries()];
  if(q)people=people.filter(([name])=>name.toLowerCase().includes(q));
  people.sort((x,y)=>{
    const t=_monitorRoleTier(x[0])-_monitorRoleTier(y[0]);
    if(t!==0)return t;
    return(y[1][0]?.ts||0)-(x[1][0]?.ts||0);
  });
  const tiers=[[],[],[]];
  for(const p of people)tiers[_monitorRoleTier(p[0])].push(p);

  const cardHTML=([name,actions])=>{
    const catCounts=new Map();
    for(const a of actions){const c=_monitorCategorize(a.action);catCounts.set(c.key,(catCounts.get(c.key)||0)+1);}
    const chips=_MONITOR_CATEGORIES.filter(c=>catCounts.has(c.key)).map(c=>`<span style="font-size:10px;color:${c.color};font-weight:600;background:${c.color}18;padding:2px 7px;border-radius:10px;margin-right:4px">${c.icon} ${catCounts.get(c.key)}</span>`).join('');
    const watchedN=name===_MONITOR_WATCH_USER?actions.filter(a=>_MONITOR_WATCH_ACTIONS.has(a.action)).length:0;
    return`<div class="card" style="margin-bottom:10px;cursor:pointer;${watchedN?'border:1px solid #fca5a5':''}" onclick="window.monitorOpenPerson('${_monitorEsc(name)}')">
      <div style="display:flex;align-items:center;gap:10px">
        ${_monitorAvatar(name)}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px">${_monitorEsc(name)}${watchedN?` <span style="color:#dc2626;font-size:11px;font-weight:700">⚠ ${watchedN} watched</span>`:''}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px">${actions.length} action${actions.length===1?'':'s'} · last ${_monitorFmtTime(actions[0])}</div>
          <div style="margin-top:6px">${chips}</div>
        </div>
        <div style="color:var(--muted);font-size:18px;flex-shrink:0">›</div>
      </div>
    </div>`;
  };

  const tierHTML=tiers.map((list,i)=>list.length?`<div style="margin-bottom:6px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:14px 0 8px">${_MONITOR_TIER_LABELS[i]}</div>${list.map(cardHTML).join('')}</div>`:'').join('');

  return statsHTML+watchedPanel+searchHTML+(people.length?tierHTML:'<div class="empty">No matching accounts.</div>');
}

function _monitorDrilldownHTML(rangeItems){
  const name=_monitorPerson;
  const all=rangeItems.filter(a=>(a.user||'Unknown')===name);
  const q=_monitorSearch.trim().toLowerCase();
  const filtered=q?all.filter(a=>(a.action||'').toLowerCase().includes(q)||(a.detail||'').toLowerCase().includes(q)):all;

  const headerHTML=`<button class="btn-outline" style="margin-bottom:12px;font-size:12px" onclick="window.monitorBackToOverview()">← All profiles</button>
  <div class="card" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;gap:12px">
      ${_monitorAvatar(name,40)}
      <div><div style="font-weight:700;font-size:16px">${_monitorEsc(name)}</div><div style="font-size:12px;color:var(--muted)">${all.length} action${all.length===1?'':'s'} in range</div></div>
    </div>
  </div>
  <div style="margin-bottom:14px"><input id="mon-search" value="${_monitorEsc(_monitorSearch)}" placeholder="Search ${_monitorEsc(name)}'s actions…" oninput="window.monitorSearchInput(this.value)" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;outline:none"></div>`;

  if(!filtered.length)return headerHTML+'<div class="empty">No matching actions.</div>';

  const byCat=new Map();
  for(const a of filtered){
    const c=_monitorCategorize(a.action);
    if(!byCat.has(c.key))byCat.set(c.key,[]);
    byCat.get(c.key).push(a);
  }

  const entryRow=(a)=>{
    const flagged=name===_MONITOR_WATCH_USER&&_MONITOR_WATCH_ACTIONS.has(a.action);
    const expanded=_monitorExpanded.has(a._id);
    return`<div style="padding:8px 0;border-bottom:1px solid #f5f5f5;cursor:pointer;${flagged?'border-left:3px solid #dc2626;padding-left:8px;background:#fef2f2':''}" onclick="window.monitorToggleEntry('${a._id}')">
      <div style="font-size:13px">${flagged?'<span style="color:#dc2626;font-weight:700">⚠ </span>':''}${_monitorEsc(a.action||'')}<span style="color:#bbb;float:right;font-size:11px">${expanded?'▾':'▸'}</span></div>
      ${expanded?`<div style="font-size:11px;color:var(--muted);margin-top:4px">${_monitorEsc(a.detail||'')}</div><div style="font-size:10px;color:#aaa;margin-top:1px">${_monitorFmtTime(a)}</div>`:''}
    </div>`;
  };

  const sectionsHTML=_MONITOR_CATEGORIES.filter(c=>byCat.has(c.key)).map(c=>{
    const entries=byCat.get(c.key);
    const sectionHead=`<div style="display:flex;align-items:center;gap:6px;margin:14px 0 6px"><span>${c.icon}</span><span style="font-size:12px;font-weight:700;color:${c.color}">${c.label}</span><span style="font-size:11px;color:var(--muted)">· ${entries.length}</span></div>`;
    if(c.key==='auth'&&entries.length>1){
      const last=entries[0];
      return`<div class="card" style="margin-bottom:10px">${sectionHead}
        <div style="cursor:pointer" onclick="window.monitorToggleAuth()">
          <div style="font-size:13px">${entries.length} sign-ins · last ${_monitorFmtTime(last)} <span style="color:#bbb;float:right;font-size:11px">${_monitorAuthExpanded?'▾':'▸'}</span></div>
        </div>
        ${_monitorAuthExpanded?entries.map(entryRow).join(''):''}
      </div>`;
    }
    return`<div class="card" style="margin-bottom:10px">${sectionHead}${entries.map(entryRow).join('')}</div>`;
  }).join('');

  return headerHTML+sectionsHTML;
}

window.monitorSetPreset=function(preset){
  _monitorFilter={preset,from:_monitorFilter.from,to:_monitorFilter.to};
  _renderMonitorPage();
};
window.monitorApplyCustom=function(){
  const from=document.getElementById('mon-from')?.value||'';
  const to=document.getElementById('mon-to')?.value||'';
  _monitorFilter={preset:'custom',from,to};
  _renderMonitorPage();
};
window.monitorSearchInput=function(v){
  _monitorSearch=v||'';
  clearTimeout(window._monitorSearchTo);
  window._monitorSearchTo=setTimeout(()=>{
    _renderMonitorPage();
    const i=document.getElementById('mon-search');
    if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}
  },180);
};
window.monitorOpenPerson=function(name){
  _monitorPerson=name;
  _monitorSearch='';
  _monitorExpanded=new Set();
  _monitorAuthExpanded=false;
  _renderMonitorPage();
};
window.monitorBackToOverview=function(){
  _monitorPerson=null;
  _monitorSearch='';
  _renderMonitorPage();
};
window.monitorToggleEntry=function(id){
  if(_monitorExpanded.has(id))_monitorExpanded.delete(id);else _monitorExpanded.add(id);
  _renderMonitorPage();
};
window.monitorToggleAuth=function(){
  _monitorAuthExpanded=!_monitorAuthExpanded;
  _renderMonitorPage();
};

// ── Monitor Dashboard widget (owner-only) ──
// Compact version of the "watched activity" panel, injected into the
// owner's home Dashboard. Placeholder rendered synchronously by
// renderMonitorDashboardWidget() (called from renderDashboard() in
// js/embellishments.js, guarded with typeof since embellishments.js loads
// before activity.js); populated async by _monitorPopulateDashboard(),
// hooked into the 'dashboard' page dispatch in js/shared.js next to
// _hrmPopulateDashboard / _fulfillDashboardInject.
function renderMonitorDashboardWidget(){
  if(!session||session.role!=='owner')return'';
  return`<div class="card" id="monitor-dash-widget" style="margin-bottom:14px;cursor:pointer" onclick="window.showPage('monitor')">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="font-weight:700;font-size:13px">👁 Monitor</div>
      <div style="font-size:11px;color:var(--muted)">View all ›</div>
    </div>
    <div id="monitor-dash-body" style="font-size:12px;color:var(--muted);margin-top:6px">Loading…</div>
  </div>`;
}
async function _monitorPopulateDashboard(){
  if(!session||session.role!=='owner')return;
  const body=document.getElementById('monitor-dash-body');
  if(!body)return;
  try{
    const dayStart=new Date();dayStart.setHours(0,0,0,0);
    const snap=await getDocs(query(collection(db,'activity'),orderBy('ts','desc'),limit(300)));
    const items=snap.docs.map(d=>d.data()).filter(a=>a.ts>=dayStart.getTime());
    const watched=items.filter(a=>a.user===_MONITOR_WATCH_USER&&_MONITOR_WATCH_ACTIONS.has(a.action));
    const activePeople=new Set(items.map(a=>a.user)).size;
    body.innerHTML=watched.length
      ?`<span style="color:#dc2626;font-weight:700">⚠ ${watched.length} watched action${watched.length===1?'':'s'} from ${_MONITOR_WATCH_USER} today</span> · ${items.length} total · ${activePeople} active`
      :`${items.length} action${items.length===1?'':'s'} today · ${activePeople} active · no watched activity`;
  }catch(e){body.textContent='Could not load.';}
}

// ── Users page ──
